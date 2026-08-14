import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";
import { compare, hash } from "npm:bcryptjs@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const S3_ENDPOINT = Deno.env.get("S3_ENDPOINT") ?? "";
const S3_REGION = Deno.env.get("S3_REGION") ?? "";
const S3_BUCKET = Deno.env.get("S3_BUCKET") ?? "";
const S3_ACCESS_KEY_ID = Deno.env.get("S3_ACCESS_KEY_ID") ?? "";
const S3_SECRET_ACCESS_KEY = Deno.env.get("S3_SECRET_ACCESS_KEY") ?? "";
const SHARE_TOKEN_SECRET = Deno.env.get("SHARE_TOKEN_SECRET") ?? "";
const PUBLIC_APP_URL = (Deno.env.get("PUBLIC_APP_URL") ?? "https://anngeog337-code.github.io/lichnoe-oblako").replace(/\/$/, "");

const ALLOWED_ORIGINS = new Set([
  "https://anngeog337-code.github.io",
  "http://localhost:5173",
  "http://localhost:3000",
]);

class HttpError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_ERROR") { super(message); }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://anngeog337-code.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-share-unlock",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function fail(request: Request, error: unknown) {
  if (error instanceof HttpError) return json(request, { error: error.code, message: error.message }, error.status);
  console.error("cloud-api", error);
  const message = error instanceof Error && /quota_exceeded/.test(error.message)
    ? "Недостаточно свободного места."
    : "Не удалось выполнить операцию.";
  return json(request, { error: "INTERNAL_ERROR", message }, 500);
}

function envReady() {
  return [SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, SHARE_TOKEN_SECRET].every(Boolean);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let s3: S3Client | null = null;
function storage() {
  s3 ??= new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  });
  return s3;
}

type UserContext = { user: { id: string; email?: string }; supabase: SupabaseClient };
async function requireUser(request: Request): Promise<UserContext> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Войдите в аккаунт.", "UNAUTHORIZED");
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Войдите в аккаунт.", "UNAUTHORIZED");
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", data.user.id).single();
  if (!profile?.is_active) throw new HttpError(403, "Аккаунт не активирован администратором.", "ACCOUNT_DISABLED");
  return { user: { id: data.user.id, email: data.user.email }, supabase };
}

async function requireAdmin(request: Request) {
  const context = await requireUser(request);
  const { data } = await context.supabase.from("profiles").select("role").eq("id", context.user.id).single();
  if (data?.role !== "admin") throw new HttpError(403, "Недостаточно прав.", "FORBIDDEN");
  return context;
}

function parseTarget(request: Request) {
  const target = new URL(new URL(request.url).searchParams.get("path") ?? "/", "https://cloud.local");
  return { pathname: target.pathname.replace(/\/+$/, "") || "/", search: target.searchParams };
}

async function body(request: Request) {
  try { return await request.json() as Record<string, unknown>; }
  catch { throw new HttpError(400, "Проверьте введённые данные.", "VALIDATION_ERROR"); }
}

function text(value: unknown, name: string, max = 255) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new HttpError(400, `Проверьте поле «${name}».`, "VALIDATION_ERROR");
  return value.trim();
}
function uuid(value: unknown, name = "идентификатор") {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, `Неверный ${name}.`, "VALIDATION_ERROR");
  return value;
}
function safeFilename(name: string) { return name.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "download"; }
function mapFile(row: Record<string, unknown>) { return { id: String(row.id), kind: "file", name: String(row.original_name), ownerId: String(row.owner_id), folderId: row.folder_id ? String(row.folder_id) : null, mimeType: row.mime_type ? String(row.mime_type) : null, extension: row.extension ? String(row.extension) : null, sizeBytes: Number(row.size_bytes ?? 0), status: String(row.upload_status), isFavorite: Boolean(row.is_favorite), isShared: Boolean(row.is_shared), deletedAt: row.deleted_at ? String(row.deleted_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapFolder(row: Record<string, unknown>) { return { id: String(row.id), kind: "folder", name: String(row.name), ownerId: String(row.owner_id), folderId: row.parent_id ? String(row.parent_id) : null, mimeType: null, extension: null, sizeBytes: 0, status: "ready", isFavorite: Boolean(row.is_favorite), isShared: Boolean(row.is_shared), deletedAt: row.deleted_at ? String(row.deleted_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }

async function listResources(request: Request, search: URLSearchParams) {
  const { user, supabase } = await requireUser(request);
  const view = search.get("view") ?? "files";
  if (!["files", "recent", "favorites", "shared", "trash"].includes(view)) throw new HttpError(400, "Неизвестный раздел.");
  const folderId = search.get("folderId");
  const query = (search.get("q") ?? "").trim().slice(0, 100);
  const limit = Math.min(100, Math.max(1, Number(search.get("limit") ?? 50)));
  const fileOffset = Math.max(0, Number(search.get("fileOffset") ?? 0));
  const folderOffset = Math.max(0, Number(search.get("folderOffset") ?? 0));
  const fileFields = "id,owner_id,folder_id,original_name,mime_type,extension,size_bytes,upload_status,is_favorite,deleted_at,created_at,updated_at";
  const folderFields = "id,owner_id,parent_id,name,is_favorite,deleted_at,created_at,updated_at";
  let filesQuery = supabase.from("files").select(fileFields).eq("upload_status", "ready");
  let foldersQuery = supabase.from("folders").select(folderFields);
  if (view === "trash") {
    filesQuery = filesQuery.not("deleted_at", "is", null); foldersQuery = foldersQuery.not("deleted_at", "is", null);
  } else {
    filesQuery = filesQuery.is("deleted_at", null); foldersQuery = foldersQuery.is("deleted_at", null);
    if (view === "files" && !query) { filesQuery = folderId ? filesQuery.eq("folder_id", folderId) : filesQuery.is("folder_id", null); foldersQuery = folderId ? foldersQuery.eq("parent_id", folderId) : foldersQuery.is("parent_id", null); }
    if (view === "favorites") { filesQuery = filesQuery.eq("is_favorite", true); foldersQuery = foldersQuery.eq("is_favorite", true); }
    if (query) { filesQuery = filesQuery.ilike("original_name", `%${query.replace(/[%_]/g, "\\$&")}%`); foldersQuery = foldersQuery.ilike("name", `%${query.replace(/[%_]/g, "\\$&")}%`); }
    if (view === "shared") {
      const { data: permissions } = await supabase.from("resource_grants").select("resource_id,resource_type").eq("grantee_id", user.id);
      const fileIds = (permissions ?? []).filter((item) => item.resource_type === "file").map((item) => item.resource_id);
      const folderIds = (permissions ?? []).filter((item) => item.resource_type === "folder").map((item) => item.resource_id);
      filesQuery = filesQuery.in("id", fileIds.length ? fileIds : [crypto.randomUUID()]);
      foldersQuery = foldersQuery.in("id", folderIds.length ? folderIds : [crypto.randomUUID()]);
    }
  }
  const [filesResult, foldersResult, usageResult, quotaResult, profileResult] = await Promise.all([
    filesQuery.order("updated_at", { ascending: false }).range(fileOffset, fileOffset + limit - 1),
    foldersQuery.order("updated_at", { ascending: false }).range(folderOffset, folderOffset + limit - 1),
    supabase.from("storage_usage").select("used_bytes,reserved_bytes").eq("user_id", user.id).single(),
    supabase.from("user_quotas").select("quota_bytes").eq("user_id", user.id).single(),
    supabase.from("profiles").select("display_name,email,role,is_active").eq("id", user.id).single(),
  ]);
  if (filesResult.error) throw filesResult.error; if (foldersResult.error) throw foldersResult.error;
  const resources = [...(foldersResult.data ?? []).map((row) => mapFolder(row)), ...(filesResult.data ?? []).map((row) => mapFile(row))].sort((a, b) => view === "files" && a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const breadcrumbs: Array<{ id: string | null; name: string }> = [{ id: null, name: "Мои файлы" }];
  let currentFolderOwnerId: string | null = null;
  if (folderId && view === "files") {
    const trail: Array<{ id: string; name: string; parent_id: string | null; owner_id: string }> = [];
    let cursor: string | null = folderId;
    for (let depth = 0; cursor && depth < 50; depth += 1) {
      const { data: folder } = await supabase.from("folders").select("id,name,parent_id,owner_id").eq("id", cursor).single();
      if (!folder) break; if (depth === 0) currentFolderOwnerId = folder.owner_id; trail.unshift(folder); cursor = folder.parent_id;
    }
    breadcrumbs.push(...trail.map((folder) => ({ id: folder.id, name: folder.name })));
  }
  return json(request, { resources, breadcrumbs, currentFolderOwnerId, hasMore: (filesResult.data?.length ?? 0) === limit || (foldersResult.data?.length ?? 0) === limit, usage: { usedBytes: Number(usageResult.data?.used_bytes ?? 0), reservedBytes: Number(usageResult.data?.reserved_bytes ?? 0), quotaBytes: Number(quotaResult.data?.quota_bytes ?? 0) }, profile: { id: user.id, ...profileResult.data } });
}

async function folders(request: Request, method: string, id?: string) {
  const { user, supabase } = await requireUser(request);
  if (!id && method === "GET") { const { data, error } = await supabase.from("folders").select("id,name,parent_id").is("deleted_at", null).order("name").limit(5000); if (error) throw error; return json(request, { folders: data }); }
  if (!id && method === "POST") { const input = await body(request); const name = text(input.name, "Название"); const parentId = input.parentId == null ? null : uuid(input.parentId, "идентификатор папки"); const { data, error } = await supabase.from("folders").insert({ owner_id: user.id, parent_id: parentId, name }).select("id,name,parent_id,created_at,updated_at").single(); if (error) throw error; return json(request, { folder: data }, 201); }
  if (!id || method !== "PATCH") throw new HttpError(405, "Метод не поддерживается.");
  const folderId = uuid(id); const input = await body(request); const action = text(input.action, "Действие", 40);
  const { data: current, error: readError } = await supabase.from("folders").select("id,parent_id,previous_parent_id,deleted_at").eq("id", folderId).single();
  if (readError || !current) throw new HttpError(404, "Папка не найдена.");
  if (action === "trash" || action === "restore") { const { error } = await supabase.rpc(action === "trash" ? "trash_folder_tree" : "restore_folder_tree", { p_folder_id: folderId }); if (error) throw error; return json(request, { ok: true }); }
  if (action === "delete-permanently") {
    if (!current.deleted_at) throw new HttpError(409, "Сначала переместите папку в корзину.");
    const { data: objects, error } = await supabase.rpc("prepare_folder_purge", { p_folder_id: folderId }); if (error) throw error;
    await deleteMany((objects ?? []).map((item: { object_key: string }) => item.object_key));
    const purge = await supabase.rpc("purge_folder_records", { p_folder_id: folderId }); if (purge.error) throw purge.error; return json(request, { ok: true });
  }
  const update: Record<string, unknown> = action === "rename" ? { name: text(input.name, "Название") } : action === "move" ? { parent_id: input.folderId == null ? null : uuid(input.folderId) } : action === "favorite" && typeof input.value === "boolean" ? { is_favorite: input.value } : {};
  if (!Object.keys(update).length) throw new HttpError(400, "Неизвестное действие.");
  const { data, error } = await supabase.from("folders").update(update).eq("id", folderId).select().single();
  if (error?.message.includes("folder_cycle")) throw new HttpError(409, "Нельзя переместить папку внутрь самой себя."); if (error) throw error;
  return json(request, { folder: data });
}

async function files(request: Request, method: string, id: string, download: boolean, search: URLSearchParams) {
  const { supabase } = await requireUser(request); const fileId = uuid(id);
  if (download && method === "GET") {
    const { data: file, error } = await supabase.from("files").select("id,object_key,original_name,mime_type,upload_status,deleted_at").eq("id", fileId).single();
    if (error || !file || file.upload_status !== "ready") throw new HttpError(404, "Файл не найден."); if (file.deleted_at) throw new HttpError(409, "Сначала восстановите файл из корзины.");
    const url = await downloadUrl(file.object_key, file.original_name, file.mime_type, search.get("inline") === "1");
    await supabase.from("files").update({ last_opened_at: new Date().toISOString() }).eq("id", fileId); await supabase.rpc("log_file_download", { p_file_id: fileId });
    return json(request, { url, expiresIn: 300 });
  }
  if (method !== "PATCH") throw new HttpError(405, "Метод не поддерживается.");
  const input = await body(request); const action = text(input.action, "Действие", 40);
  const { data: current, error: readError } = await supabase.from("files").select("id,folder_id,previous_folder_id,deleted_at,object_key,upload_status").eq("id", fileId).single();
  if (readError || !current) throw new HttpError(404, "Файл не найден.");
  if (action === "delete-permanently") { if (!current.deleted_at || current.upload_status !== "ready") throw new HttpError(409, "Сначала переместите файл в корзину."); await storage().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: current.object_key })); const result = await supabase.rpc("purge_file_record", { p_file_id: fileId }); if (result.error) throw result.error; return json(request, { ok: true }); }
  let update: Record<string, unknown> = {};
  if (action === "rename") update = { original_name: text(input.name, "Название") };
  else if (action === "move") update = { folder_id: input.folderId == null ? null : uuid(input.folderId) };
  else if (action === "favorite" && typeof input.value === "boolean") update = { is_favorite: input.value };
  else if (action === "trash") update = { deleted_at: new Date().toISOString(), previous_folder_id: current.folder_id, folder_id: null };
  else if (action === "restore") { let folderId = current.previous_folder_id; if (folderId) { const { data: folder } = await supabase.from("folders").select("id").eq("id", folderId).is("deleted_at", null).maybeSingle(); if (!folder) folderId = null; } update = { deleted_at: null, folder_id: folderId, previous_folder_id: null }; }
  else throw new HttpError(400, "Неизвестное действие.");
  const { data, error } = await supabase.from("files").update(update).eq("id", fileId).select().single(); if (error) throw error; return json(request, { file: data });
}

const PART_SIZE = 64_000_000;
function partSize(size: number) { return Math.max(PART_SIZE, Math.ceil(size / 10_000 / 5_000_000) * 5_000_000); }
async function uploads(request: Request, method: string, pathname: string) {
  const { user, supabase } = await requireUser(request);
  if (pathname === "/api/uploads/init" && method === "POST") {
    const input = await body(request); const name = text(input.name, "Название"); const size = Number(input.size); if (!Number.isSafeInteger(size) || size <= 0) throw new HttpError(400, "Неверный размер файла.");
    const mimeType = typeof input.mimeType === "string" && input.mimeType ? input.mimeType.slice(0, 200) : "application/octet-stream"; const folderId = input.folderId == null ? null : uuid(input.folderId);
    const fileId = crypto.randomUUID(); const uploadId = crypto.randomUUID(); const objectKey = `users/${user.id}/objects/${fileId}`; const extension = name.includes(".") ? name.split(".").pop()?.slice(0, 32) ?? "" : ""; const sizePerPart = partSize(size); const count = Math.ceil(size / sizePerPart);
    const reservation = await supabase.rpc("start_multipart_upload", { p_file_id: fileId, p_upload_id: uploadId, p_folder_id: folderId, p_name: name, p_mime_type: mimeType, p_size_bytes: size, p_extension: extension, p_bucket: S3_BUCKET, p_object_key: objectKey, p_part_size: sizePerPart, p_part_count: count });
    if (reservation.error) { if (reservation.error.message.includes("quota_exceeded")) throw new HttpError(409, "Недостаточно свободного места.", "QUOTA_EXCEEDED"); throw reservation.error; }
    let providerId: string | undefined;
    try { const created = await storage().send(new CreateMultipartUploadCommand({ Bucket: S3_BUCKET, Key: objectKey, ContentType: mimeType, Metadata: { owner: user.id, file: fileId } })); providerId = created.UploadId; if (!providerId) throw new Error("Missing upload id"); const attach = await supabase.rpc("attach_provider_upload", { p_upload_id: uploadId, p_provider_upload_id: providerId }); if (attach.error) throw attach.error; }
    catch (error) { if (providerId) await storage().send(new AbortMultipartUploadCommand({ Bucket: S3_BUCKET, Key: objectKey, UploadId: providerId })).catch(() => undefined); await supabase.rpc("abort_multipart_upload", { p_upload_id: uploadId, p_reason: "initialization_failed" }); throw error; }
    return json(request, { uploadId, fileId, partSize: sizePerPart, partCount: count }, 201);
  }
  const match = pathname.match(/^\/api\/uploads\/([0-9a-f-]+)\/(parts|complete|abort)$/i); if (!match || method !== "POST") throw new HttpError(404, "Адрес не найден."); const uploadId = uuid(match[1]); const operation = match[2];
  const { data: upload, error } = await supabase.from("multipart_uploads").select("id,file_id,object_key,provider_upload_id,part_count,total_size_bytes,status").eq("id", uploadId).single(); if (error || !upload) throw new HttpError(404, "Загрузка не найдена.");
  if (operation === "parts") {
    if (upload.status !== "uploading" || !upload.provider_upload_id) throw new HttpError(409, "Загрузка уже завершена или отменена."); const input = await body(request); const numbers = Array.isArray(input.partNumbers) ? input.partNumbers.map(Number) : []; if (!numbers.length || numbers.length > 100 || numbers.some((part) => !Number.isInteger(part) || part < 1 || part > upload.part_count)) throw new HttpError(400, "Неверный номер части файла.");
    const urls = await Promise.all(numbers.map(async (number) => ({ partNumber: number, url: await getSignedUrl(storage(), new UploadPartCommand({ Bucket: S3_BUCKET, Key: upload.object_key, UploadId: upload.provider_upload_id, PartNumber: number }), { expiresIn: 900 }) }))); return json(request, { urls });
  }
  if (operation === "abort") { if (upload.provider_upload_id && upload.status !== "completed") await storage().send(new AbortMultipartUploadCommand({ Bucket: S3_BUCKET, Key: upload.object_key, UploadId: upload.provider_upload_id })).catch(() => undefined); const result = await supabase.rpc("abort_multipart_upload", { p_upload_id: uploadId, p_reason: "cancelled_by_user" }); if (result.error) throw result.error; return json(request, { ok: true }); }
  if (upload.status === "completed") return json(request, { fileId: upload.file_id, size: Number(upload.total_size_bytes) }); if (upload.status !== "uploading" || !upload.provider_upload_id) throw new HttpError(409, "Загрузка уже завершена или отменена.");
  const input = await body(request); const parts = Array.isArray(input.parts) ? input.parts.map((item) => ({ partNumber: Number((item as Record<string, unknown>).partNumber), etag: String((item as Record<string, unknown>).etag ?? "") })) : []; const unique = new Set(parts.map((part) => part.partNumber)); if (parts.length !== upload.part_count || unique.size !== upload.part_count || parts.some((part) => !part.etag || part.partNumber < 1 || part.partNumber > upload.part_count)) throw new HttpError(400, "Не все части файла загружены.");
  const completed = await storage().send(new CompleteMultipartUploadCommand({ Bucket: S3_BUCKET, Key: upload.object_key, UploadId: upload.provider_upload_id, MultipartUpload: { Parts: parts.sort((a, b) => a.partNumber - b.partNumber).map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) } }));
  const metadata = await storage().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: upload.object_key })); if (Number(metadata.ContentLength ?? 0) !== Number(upload.total_size_bytes)) { await storage().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: upload.object_key })).catch(() => undefined); await supabase.rpc("abort_multipart_upload", { p_upload_id: uploadId, p_reason: "size_mismatch" }); throw new HttpError(422, "Размер загруженного файла не совпал. Попробуйте снова."); }
  const result = await supabase.rpc("complete_multipart_upload", { p_upload_id: uploadId, p_etag: completed.ETag ?? metadata.ETag ?? "" }); if (result.error) throw result.error; return json(request, { fileId: result.data ?? upload.file_id, size: Number(metadata.ContentLength ?? 0) });
}

async function downloadUrl(key: string, filename: string, contentType?: string | null, inline = false) {
  return getSignedUrl(storage(), new GetObjectCommand({ Bucket: S3_BUCKET, Key: key, ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeFilename(filename))}`, ...(contentType ? { ResponseContentType: contentType } : {}) }), { expiresIn: 300 });
}
async function deleteMany(keys: string[]) { for (let index = 0; index < keys.length; index += 1000) await storage().send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Quiet: true, Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })) } })); }

const encoder = new TextEncoder();
function hex(bytes: Uint8Array) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function tokenHash(token: string) { return `\\x${hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${SHARE_TOKEN_SECRET}:${token}`))))}`; }
async function sign(value: string) { const key = await crypto.subtle.importKey("raw", encoder.encode(SHARE_TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))); }
async function unlockToken(shareId: string) { const expires = Date.now() + 3_600_000; const payload = `${shareId}.${expires}`; return `${payload}.${await sign(payload)}`; }
async function unlocked(value: string | null, shareId: string) { if (!value) return false; const [id, expires, signature] = value.split("."); if (id !== shareId || Number(expires) < Date.now() || !signature) return false; return signature === await sign(`${id}.${expires}`); }
async function getShare(token: string) { if (token.length < 32 || token.length > 100) throw new HttpError(404, "Ссылка не найдена."); const { data: share } = await admin.from("shares").select("id,resource_id,resource_type,owner_id,expires_at,password_hash,is_active,max_downloads,download_count").eq("token_hash", await tokenHash(token)).maybeSingle(); if (!share || !share.is_active || (share.expires_at && new Date(share.expires_at) <= new Date())) throw new HttpError(404, "Ссылка недействительна или срок её действия закончился."); if (share.max_downloads && Number(share.download_count) >= Number(share.max_downloads)) throw new HttpError(410, "Лимит скачиваний исчерпан."); return share; }
async function folderInside(folderId: string, rootId: string, ownerId: string) { let cursor: string | null = folderId; for (let depth = 0; cursor && depth < 50; depth += 1) { if (cursor === rootId) return true; const { data } = await admin.from("folders").select("parent_id").eq("id", cursor).eq("owner_id", ownerId).single(); cursor = data?.parent_id ?? null; } return false; }

async function shares(request: Request, method: string, pathname: string, search: URLSearchParams) {
  const publicMatch = pathname.match(/^\/api\/public\/([^/]+)(?:\/(download))?$/);
  if (publicMatch) {
    const token = decodeURIComponent(publicMatch[1]); const download = publicMatch[2] === "download"; const share = await getShare(token); const isUnlocked = !share.password_hash || await unlocked(request.headers.get("X-Share-Unlock"), share.id);
    if (method === "POST" && !download) { if (!share.password_hash) return json(request, { ok: true }); const input = await body(request); if (typeof input.password !== "string" || !await compare(input.password, share.password_hash)) throw new HttpError(401, "Неверный пароль."); return json(request, { ok: true, unlockToken: await unlockToken(share.id) }); }
    if (!isUnlocked) return json(request, { passwordRequired: true }, 401);
    if (download && method === "GET") { const fileId = search.get("fileId") ?? share.resource_id; const { data: file } = await admin.from("files").select("id,owner_id,folder_id,object_key,original_name,mime_type,upload_status,deleted_at").eq("id", fileId).eq("owner_id", share.owner_id).single(); if (!file || file.deleted_at || file.upload_status !== "ready") throw new HttpError(404, "Файл не найден."); if (share.resource_type === "file" && file.id !== share.resource_id) throw new HttpError(403, "Нет доступа к файлу."); if (share.resource_type === "folder" && (!file.folder_id || !await folderInside(file.folder_id, share.resource_id, share.owner_id))) throw new HttpError(403, "Нет доступа к файлу."); const url = await downloadUrl(file.object_key, file.original_name, file.mime_type, search.get("inline") === "1"); await admin.from("shares").update({ download_count: Number(share.download_count) + 1 }).eq("id", share.id); return json(request, { url, expiresIn: 300 }); }
    if (method !== "GET") throw new HttpError(405, "Метод не поддерживается.");
    if (share.resource_type === "file") { const { data: file } = await admin.from("files").select("id,original_name,mime_type,size_bytes,updated_at,upload_status,deleted_at").eq("id", share.resource_id).eq("owner_id", share.owner_id).single(); if (!file || file.deleted_at || file.upload_status !== "ready") throw new HttpError(404, "Файл больше недоступен."); return json(request, { passwordRequired: false, type: "file", resource: file }); }
    const folderId = search.get("folderId") ?? share.resource_id; const { data: folder } = await admin.from("folders").select("id,name,parent_id,updated_at,deleted_at").eq("id", folderId).eq("owner_id", share.owner_id).single(); if (!folder || folder.deleted_at) throw new HttpError(404, "Папка больше недоступна."); if (!await folderInside(folder.id, share.resource_id, share.owner_id)) throw new HttpError(403, "Нет доступа к этой папке."); const [foldersResult, filesResult] = await Promise.all([admin.from("folders").select("id,name,parent_id,updated_at").eq("owner_id", share.owner_id).eq("parent_id", folder.id).is("deleted_at", null).order("name"), admin.from("files").select("id,original_name,mime_type,size_bytes,folder_id,updated_at").eq("owner_id", share.owner_id).eq("folder_id", folder.id).eq("upload_status", "ready").is("deleted_at", null).order("original_name")]); return json(request, { passwordRequired: false, type: "folder", resource: folder, rootId: share.resource_id, folders: foldersResult.data, files: filesResult.data });
  }
  const { supabase } = await requireUser(request);
  if (pathname === "/api/shares" && method === "GET") { const { data, error } = await supabase.from("shares").select("id,resource_id,resource_type,expires_at,is_active,download_count,max_downloads,created_at").order("created_at", { ascending: false }); if (error) throw error; return json(request, { shares: data }); }
  if (pathname === "/api/shares" && method === "POST") { const input = await body(request); const resourceId = uuid(input.resourceId); const resourceType = input.resourceType === "folder" ? "folder" : input.resourceType === "file" ? "file" : null; if (!resourceType) throw new HttpError(400, "Неверный тип объекта."); const table = resourceType === "file" ? "files" : "folders"; const { data: resource } = await supabase.from(table).select("id,deleted_at").eq("id", resourceId).single(); if (!resource || resource.deleted_at) throw new HttpError(404, "Файл или папка не найдены."); const bytes = crypto.getRandomValues(new Uint8Array(32)); const token = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); const passwordHash = typeof input.password === "string" && input.password ? await hash(input.password, 12) : null; const result = await supabase.rpc("create_public_share", { p_token_hash: await tokenHash(token), p_resource_id: resourceId, p_resource_type: resourceType, p_expires_at: typeof input.expiresAt === "string" ? input.expiresAt : null, p_password_hash: passwordHash }); if (result.error) throw result.error; return json(request, { share: result.data, url: `${PUBLIC_APP_URL}/?share=${encodeURIComponent(token)}` }, 201); }
  const revoke = pathname.match(/^\/api\/shares\/([0-9a-f-]+)$/i); if (revoke && method === "DELETE") { const result = await supabase.rpc("disable_public_share", { p_share_id: uuid(revoke[1]) }); if (result.error) throw result.error; return json(request, { ok: true }); }
  throw new HttpError(404, "Адрес не найден.");
}

async function grants(request: Request, method: string, search: URLSearchParams) {
  const { supabase } = await requireUser(request);
  if (method === "GET") { const resourceId = uuid(search.get("resourceId")); const resourceType = search.get("resourceType"); if (resourceType !== "file" && resourceType !== "folder") throw new HttpError(400, "Неверный тип объекта."); const [candidates, grants] = await Promise.all([supabase.rpc("list_share_candidates"), supabase.from("resource_grants").select("id,grantee_id,can_download").eq("resource_id", resourceId).eq("resource_type", resourceType)]); if (candidates.error) throw candidates.error; if (grants.error) throw grants.error; return json(request, { candidates: candidates.data, grants: grants.data }); }
  if (method === "POST") { const input = await body(request); const resourceType = input.resourceType === "file" || input.resourceType === "folder" ? input.resourceType : null; if (!resourceType) throw new HttpError(400, "Неверный тип объекта."); const result = await supabase.rpc("grant_resource_access", { p_resource_id: uuid(input.resourceId), p_resource_type: resourceType, p_grantee_id: uuid(input.granteeId) }); if (result.error) throw result.error; return json(request, { grantId: result.data }, 201); }
  if (method === "DELETE") { const result = await supabase.rpc("revoke_resource_access", { p_grant_id: uuid(search.get("id")) }); if (result.error) throw result.error; return json(request, { ok: true }); }
  throw new HttpError(405, "Метод не поддерживается.");
}

async function administration(request: Request, method: string) {
  const { supabase } = await requireAdmin(request);
  if (method === "PATCH") { const input = await body(request); const quota = Number(input.quotaBytes); if (!Number.isInteger(quota) || quota < 0 || quota > 500_000_000_000) throw new HttpError(400, "Проверьте размер квоты."); const result = await supabase.rpc("admin_set_user_quota", { p_user_id: uuid(input.userId), p_quota_bytes: quota }); if (result.error) throw result.error; return json(request, { ok: true }); }
  if (method !== "GET") throw new HttpError(405, "Метод не поддерживается.");
  const [profiles, settings, activeUploads, recentActivity] = await Promise.all([supabase.from("profiles").select("id,email,display_name,role,is_active,user_quotas(quota_bytes),storage_usage(used_bytes,reserved_bytes)").order("created_at"), supabase.from("app_settings").select("total_quota_bytes,max_users,trash_retention_days").single(), supabase.from("multipart_uploads").select("id,owner_id,total_size_bytes,status,created_at").in("status", ["initiating", "uploading", "completing"]).order("created_at", { ascending: false }), supabase.from("activity_log").select("id,user_id,event,resource_type,created_at").order("created_at", { ascending: false }).limit(20)]); for (const result of [profiles, settings, activeUploads, recentActivity]) if (result.error) throw result.error;
  const users = (profiles.data ?? []).map((profile) => { const quota = Array.isArray(profile.user_quotas) ? profile.user_quotas[0] : profile.user_quotas; const usage = Array.isArray(profile.storage_usage) ? profile.storage_usage[0] : profile.storage_usage; return { id: profile.id, email: profile.email, displayName: profile.display_name, role: profile.role, isActive: profile.is_active, quotaBytes: Number(quota?.quota_bytes ?? 0), usedBytes: Number(usage?.used_bytes ?? 0), reservedBytes: Number(usage?.reserved_bytes ?? 0) }; });
  return json(request, { users, settings: settings.data, activeUploads: activeUploads.data ?? [], recentActivity: recentActivity.data ?? [] });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  try {
    if (!envReady()) throw new HttpError(503, "Серверная функция ещё не настроена.", "SETUP_REQUIRED");
    const { pathname, search } = parseTarget(request); const method = request.method.toUpperCase();
    if (pathname === "/api/resources" && method === "GET") return await listResources(request, search);
    if (pathname === "/api/folders") return await folders(request, method);
    const folder = pathname.match(/^\/api\/folders\/([0-9a-f-]+)$/i); if (folder) return await folders(request, method, folder[1]);
    const file = pathname.match(/^\/api\/files\/([0-9a-f-]+)(?:\/(download))?$/i); if (file) return await files(request, method, file[1], file[2] === "download", search);
    if (pathname.startsWith("/api/uploads/")) return await uploads(request, method, pathname);
    if (pathname === "/api/grants") return await grants(request, method, search);
    if (pathname === "/api/admin/usage") return await administration(request, method);
    if (pathname === "/api/auth/event" && method === "POST") { const { supabase } = await requireUser(request); await supabase.rpc("log_login"); return json(request, { ok: true }); }
    if (pathname.startsWith("/api/shares") || pathname.startsWith("/api/public/")) return await shares(request, method, pathname, search);
    throw new HttpError(404, "Адрес не найден.");
  } catch (error) { return fail(request, error); }
});
