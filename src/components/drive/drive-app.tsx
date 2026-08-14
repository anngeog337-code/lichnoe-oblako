import {
  ArchiveRestore, ChevronDown, ChevronRight, Clock3, Cloud, Download, File, FileImage, FileText,
  FileVideo, Folder, FolderInput, Grid2X2, Heart, Link2, List, Loader2, LogOut, Menu, Moon,
  MoreHorizontal, Move, Plus, RefreshCw, Search, Share2, ShieldCheck, Star, Sun, Trash2, Upload, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatBytes } from "@/lib/format";
import type { DriveResource, Usage } from "@/lib/types";
import { useUploadQueue } from "@/features/uploads/use-upload-queue";
import { UploadPanel } from "./upload-panel";
import { apiJson } from "@/lib/api";
import { requireSupabase } from "@/lib/supabase";

type View = "files" | "recent" | "favorites" | "shared" | "trash";
type ResourceResponse = {
  resources: DriveResource[];
  breadcrumbs: Array<{ id: string | null; name: string }>;
  usage: Usage;
  profile: { id: string; email: string; display_name: string | null; role: string; is_active: boolean };
  currentFolderOwnerId: string | null;
  hasMore: boolean;
};
type ShareCandidate = { id: string; email: string; display_name: string | null };
type ResourceGrant = { id: string; grantee_id: string; can_download: boolean };
type Modal =
  | { type: "create-folder" }
  | { type: "rename"; resource: DriveResource }
  | { type: "move"; resources: DriveResource[] }
  | { type: "share"; resource: DriveResource }
  | { type: "admin" }
  | { type: "preview"; resource: DriveResource; url: string }
  | null;

const NAV: Array<{ id: View; label: string; icon: typeof Folder }> = [
  { id: "files", label: "Мои файлы", icon: Folder },
  { id: "recent", label: "Недавние", icon: Clock3 },
  { id: "favorites", label: "Избранное", icon: Star },
  { id: "shared", label: "Общие", icon: Share2 },
  { id: "trash", label: "Корзина", icon: Trash2 },
];

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  return apiJson<T>(url, init);
}

function ResourceIcon({ resource, size = 20 }: { resource: DriveResource; size?: number }) {
  if (resource.kind === "folder") return <Folder size={size} className="folder-icon" fill="currentColor" />;
  if (resource.mimeType?.startsWith("image/")) return <FileImage size={size} className="image-icon" />;
  if (resource.mimeType?.startsWith("video/")) return <FileVideo size={size} className="video-icon" />;
  if (resource.mimeType === "application/pdf") return <FileText size={size} className="pdf-icon" />;
  return <File size={size} className="file-icon" />;
}

export function DriveApp({ initialEmail }: { initialEmail: string }) {
  const [view, setView] = useState<View>("files");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ResourceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({ view, limit: "50", fileOffset: "0", folderOffset: "0" });
    if (folderId && view === "files") params.set("folderId", folderId);
    if (query.trim()) params.set("q", query.trim());
    try { setData(await requestJson<ResourceResponse>(`/api/resources?${params}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось загрузить файлы."); }
    finally { setLoading(false); }
  }, [folderId, query, view]);

  useEffect(() => { const timer = setTimeout(() => void refresh(), 220); return () => clearTimeout(timer); }, [refresh]);
  useEffect(() => {
    const stored = localStorage.getItem("cloud-theme");
    const useDark = stored === "dark" || (!stored && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", useDark);
    queueMicrotask(() => setDark(useDark));
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 3200); return () => clearTimeout(timer); }, [toast]);

  const uploadQueue = useUploadQueue(refresh);
  const resources = useMemo(() => data?.resources ?? [], [data]);
  const canWriteCurrentFolder = !folderId || Boolean(data?.profile?.id && data.currentFolderOwnerId === data.profile.id);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.matches("input,textarea,select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault(); setSelected(new Set(resources.map((resource) => resource.id)));
      } else if (event.key === "Delete" && selected.size) {
        if (resources.some((resource) => selected.has(resource.id) && resource.ownerId !== data?.profile?.id)) showToast("Общие объекты доступны только для просмотра.");
        else void bulkTrash();
      }
      else if (event.key === "Enter" && selected.size === 1) {
        const resource = resources.find((item) => selected.has(item.id)); if (resource) void openResource(resource);
      } else if (event.key === "F2" && selected.size === 1) {
        event.preventDefault(); const resource = resources.find((item) => selected.has(item.id)); if (resource && resource.ownerId === data?.profile?.id) setModal({ type: "rename", resource });
      }
    }
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });

  function showToast(message: string) { setToast(message); }
  function switchView(next: View) { setView(next); setFolderId(null); setQuery(""); setSelected(new Set()); setMenuId(null); setMobileNav(false); }
  function toggleTheme() {
    const next = !dark; setDark(next); document.documentElement.classList.toggle("dark", next); localStorage.setItem("cloud-theme", next ? "dark" : "light");
  }
  function select(id: string, checked: boolean) {
    setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  }

  async function mutate(resource: DriveResource, body: Record<string, unknown>, success: string) {
    const endpoint = resource.kind === "file" ? `/api/files/${resource.id}` : `/api/folders/${resource.id}`;
    try { await requestJson(endpoint, { method: "PATCH", body: JSON.stringify(body) }); showToast(success); setMenuId(null); await refresh(); }
    catch (caught) { showToast(caught instanceof Error ? caught.message : "Операция не выполнена."); }
  }

  async function openResource(resource: DriveResource) {
    setMenuId(null);
    if (resource.kind === "folder") { setView("files"); setFolderId(resource.id); return; }
    try {
      const result = await requestJson<{ url: string }>(`/api/files/${resource.id}/download?inline=1`);
      if (resource.mimeType?.startsWith("image/") || resource.mimeType?.startsWith("video/") || resource.mimeType === "application/pdf") {
        setModal({ type: "preview", resource, url: result.url });
      } else window.location.href = result.url;
    } catch (caught) { showToast(caught instanceof Error ? caught.message : "Файл не открылся."); }
  }

  async function download(resource: DriveResource) {
    if (resource.kind === "folder") return showToast("Скачивание папок архивом появится в следующей версии.");
    try { const result = await requestJson<{ url: string }>(`/api/files/${resource.id}/download`); window.location.href = result.url; }
    catch (caught) { showToast(caught instanceof Error ? caught.message : "Не удалось скачать файл."); }
  }

  async function bulkDownload() {
    const files = resources.filter((resource) => selected.has(resource.id) && resource.kind === "file");
    if (!files.length) return showToast("Выберите хотя бы один файл.");
    try {
      const results = await Promise.all(files.map((file) => requestJson<{ url: string }>(`/api/files/${file.id}/download`)));
      results.forEach((result) => {
        const anchor = document.createElement("a"); anchor.href = result.url; anchor.target = "_blank"; anchor.rel = "noreferrer";
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
      });
      showToast(`Подготовлено файлов: ${results.length}`);
    } catch (caught) { showToast(caught instanceof Error ? caught.message : "Не удалось подготовить скачивание."); }
  }

  async function loadMore() {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    const params = new URLSearchParams({
      view, limit: "50",
      fileOffset: String(resources.filter((item) => item.kind === "file").length),
      folderOffset: String(resources.filter((item) => item.kind === "folder").length),
    });
    if (folderId && view === "files") params.set("folderId", folderId);
    if (query.trim()) params.set("q", query.trim());
    try {
      const next = await requestJson<ResourceResponse>(`/api/resources?${params}`);
      setData((current) => current ? { ...next, resources: [...current.resources, ...next.resources.filter((item) => !current.resources.some((existing) => existing.id === item.id))] } : next);
    } catch (caught) { showToast(caught instanceof Error ? caught.message : "Не удалось загрузить продолжение."); }
    finally { setLoadingMore(false); }
  }

  async function bulkTrash() {
    const chosen = resources.filter((resource) => selected.has(resource.id) && resource.ownerId === data?.profile?.id);
    if (!chosen.length) return showToast("Общие объекты доступны только для просмотра.");
    await Promise.all(chosen.map((resource) => mutate(resource, { action: view === "trash" ? "restore" : "trash" }, view === "trash" ? "Восстановлено" : "Перемещено в корзину")));
    setSelected(new Set());
  }

  async function dropMove(event: React.DragEvent, targetFolderId: string | null) {
    event.preventDefault(); event.stopPropagation();
    const raw = event.dataTransfer.getData("application/x-cloud-resource");
    if (!raw) return;
    const resource = resources.find((item) => item.id === raw); if (!resource || resource.id === targetFolderId) return;
    await mutate(resource, { action: "move", folderId: targetFolderId }, "Объект перемещён");
  }

  function addDroppedFiles(event: React.DragEvent) {
    event.preventDefault(); setDragDepth(0);
    if (!canWriteCurrentFolder) return showToast("В общую папку нельзя загружать файлы.");
    if (event.dataTransfer.files.length) uploadQueue.addFiles(Array.from(event.dataTransfer.files), folderId);
  }

  const usage = data?.usage ?? { usedBytes: 0, reservedBytes: 0, quotaBytes: 0 };
  const usagePercent = usage.quotaBytes ? Math.min(100, ((usage.usedBytes + usage.reservedBytes) / usage.quotaBytes) * 100) : 0;
  const title = NAV.find((item) => item.id === view)?.label ?? "Мои файлы";
  const hasReadOnlySelection = resources.some((resource) => selected.has(resource.id) && resource.ownerId !== data?.profile?.id);

  return (
    <div className="drive-shell" onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) setDragDepth((value) => value + 1); }} onDragLeave={() => setDragDepth((value) => Math.max(0, value - 1))} onDragOver={(event) => event.preventDefault()} onDrop={addDroppedFiles}>
      {dragDepth > 0 && <div className="drop-overlay"><Upload size={38} /><strong>Отпустите файлы для загрузки</strong><span>Они попадут в текущую папку</span></div>}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="sidebar-brand"><span className="brand-mark"><Cloud size={20} /></span><span>Личное облако</span><button className="icon-button mobile-only" onClick={() => setMobileNav(false)}><X size={19} /></button></div>
        <button className="create-button" disabled={!canWriteCurrentFolder} title={!canWriteCurrentFolder ? "Общая папка доступна только для просмотра" : undefined} onClick={() => setModal({ type: "create-folder" })}><Plus size={19} /> Создать <ChevronDown size={16} /></button>
        <nav className="side-nav">{NAV.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => switchView(item.id)}><Icon size={19} />{item.label}</button>; })}</nav>
        <div className="storage-card">
          <div className="storage-title"><span>Использовано</span><HardDriveMini /></div>
          <strong>{formatBytes(usage.usedBytes)} <i>/ {formatBytes(usage.quotaBytes)}</i></strong>
          <div className="storage-progress"><span style={{ width: `${usagePercent}%` }} /></div>
          {usage.reservedBytes > 0 && <small>Зарезервировано: {formatBytes(usage.reservedBytes)}</small>}
        </div>
        {data?.profile?.role === "admin" && <button className="admin-button" onClick={() => setModal({ type: "admin" })}><ShieldCheck size={17} /> Управление хранилищем</button>}
        <div className="account-card"><span>{(data?.profile?.display_name ?? initialEmail).slice(0, 1).toUpperCase()}</span><div><strong>{data?.profile?.display_name ?? "Пользователь"}</strong><small>{data?.profile?.email ?? initialEmail}</small></div><button className="icon-button" title="Выйти" onClick={async () => { await requireSupabase().auth.signOut(); location.reload(); }}><LogOut size={17} /></button></div>
      </aside>
      {mobileNav && <button className="sidebar-backdrop" onClick={() => setMobileNav(false)} aria-label="Закрыть меню" />}

      <main className="drive-main">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileNav(true)}><Menu size={21} /></button>
          <div className="search-box"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по файлам, папкам и расширениям" aria-label="Поиск" />{query && <button className="icon-button" onClick={() => setQuery("")}><X size={16} /></button>}</div>
          <button className="icon-button theme-toggle" onClick={toggleTheme} title="Сменить тему">{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
        </header>
        <section className="drive-content">
          <div className="breadcrumbs">{view === "files" && !query ? data?.breadcrumbs.map((item, index) => <span key={item.id ?? "root"}><button onClick={() => setFolderId(item.id)}>{item.name}</button>{index < (data?.breadcrumbs.length ?? 0) - 1 && <ChevronRight size={15} />}</span>) : <span><strong>{query ? `Поиск: ${query}` : title}</strong></span>}</div>
          <div className="content-heading"><div><h1>{query ? "Результаты поиска" : title}</h1><p>{loading ? "Обновляем список…" : `${resources.length} ${resources.length === 1 ? "объект" : "объектов"}`}</p></div><div className="heading-actions">
            <input ref={fileInput} type="file" multiple hidden onChange={(event) => { uploadQueue.addFiles(Array.from(event.target.files ?? []), folderId); event.currentTarget.value = ""; }} />
            <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { uploadQueue.addFiles(Array.from(event.target.files ?? []), folderId); event.currentTarget.value = ""; }} />
            {canWriteCurrentFolder && <><button className="secondary-button" onClick={() => folderInput.current?.click()}><FolderInput size={18} /><span>Папку</span></button><button className="primary-button" onClick={() => fileInput.current?.click()}><Upload size={18} />Загрузить</button></>}
            <div className="view-toggle"><button className={display === "list" ? "active" : ""} onClick={() => setDisplay("list")}><List size={18} /></button><button className={display === "grid" ? "active" : ""} onClick={() => setDisplay("grid")}><Grid2X2 size={18} /></button></div>
          </div></div>

          {selected.size > 0 && <div className="selection-bar"><strong>Выбрано: {selected.size}</strong>{view !== "trash" && <button onClick={() => void bulkDownload()}><Download size={16} /> Скачать</button>}{!hasReadOnlySelection && <><button onClick={() => setModal({ type: "move", resources: resources.filter((item) => selected.has(item.id)) })}><Move size={16} /> Переместить</button><button onClick={() => void bulkTrash()}>{view === "trash" ? <ArchiveRestore size={16} /> : <Trash2 size={16} />}{view === "trash" ? "Восстановить" : "Удалить"}</button></>} {hasReadOnlySelection && <span className="selection-note">Общие объекты доступны только для просмотра и скачивания</span>}<button className="icon-button" onClick={() => setSelected(new Set())}><X size={16} /></button></div>}

          {error ? <div className="empty-state error-state"><RefreshCw size={30} /><h2>Не удалось показать файлы</h2><p>{error}</p><button className="secondary-button" onClick={() => void refresh()}>Повторить</button></div>
          : loading && !data ? <div className="loading-state"><Loader2 className="spin" /> Загружаем файлы…</div>
          : resources.length === 0 ? <EmptyState view={view} query={query} canWrite={canWriteCurrentFolder} onUpload={() => fileInput.current?.click()} onCreate={() => setModal({ type: "create-folder" })} />
          : display === "list" ? <ResourceTable resources={resources} currentUserId={data?.profile?.id ?? ""} selected={selected} menuId={menuId} view={view} onSelect={select} onMenu={setMenuId} onOpen={openResource} onDownload={download} onAction={(resource, action) => {
            if (action === "rename") setModal({ type: "rename", resource });
            else if (action === "move") setModal({ type: "move", resources: [resource] });
            else if (action === "share") setModal({ type: "share", resource });
            else if (action === "favorite") void mutate(resource, { action: "favorite", value: !resource.isFavorite }, resource.isFavorite ? "Убрано из избранного" : "Добавлено в избранное");
            else if (action === "restore") void mutate(resource, { action: "restore" }, "Объект восстановлен");
            else if (action === "purge") { if (confirm("Удалить навсегда? Это действие нельзя отменить.")) void mutate(resource, { action: "delete-permanently" }, "Удалено навсегда"); }
            else void mutate(resource, { action: "trash" }, "Перемещено в корзину");
          }} onDropMove={dropMove} />
          : <ResourceGrid resources={resources} currentUserId={data?.profile?.id ?? ""} selected={selected} view={view} onSelect={select} onOpen={openResource} onAction={(resource, action) => {
            if (action === "rename") setModal({ type: "rename", resource });
            else if (action === "move") setModal({ type: "move", resources: [resource] });
            else if (action === "share") setModal({ type: "share", resource });
            else if (action === "favorite") void mutate(resource, { action: "favorite", value: !resource.isFavorite }, resource.isFavorite ? "Убрано из избранного" : "Добавлено в избранное");
            else if (action === "restore") void mutate(resource, { action: "restore" }, "Объект восстановлен");
            else if (action === "purge") { if (confirm("Удалить навсегда? Это действие нельзя отменить.")) void mutate(resource, { action: "delete-permanently" }, "Удалено навсегда"); }
            else void mutate(resource, { action: "trash" }, "Перемещено в корзину");
          }} menuId={menuId} onMenu={setMenuId} onDropMove={dropMove} />}
          {data?.hasMore && <div className="load-more"><button className="secondary-button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore && <Loader2 size={16} className="spin" />}Показать ещё</button></div>}
        </section>
      </main>
      <UploadPanel items={uploadQueue.items} onCancel={(id) => void uploadQueue.cancel(id)} onDismiss={uploadQueue.dismiss} />
      {toast && <div className="toast" role="status">{toast}</div>}
      {modal && (modal.type === "admin" ? <AdminModal onClose={() => setModal(null)} /> : <DriveModal modal={modal} currentFolderId={folderId} onClose={() => setModal(null)} onDone={async (message) => { setModal(null); showToast(message); setSelected(new Set()); await refresh(); }} />)}
    </div>
  );
}

function HardDriveMini() { return <Cloud size={16} />; }

function EmptyState({ view, query, canWrite, onUpload, onCreate }: { view: View; query: string; canWrite: boolean; onUpload: () => void; onCreate: () => void }) {
  const copy = query ? ["Ничего не найдено", "Попробуйте изменить запрос."] : view === "trash" ? ["Корзина пуста", "Удалённые файлы появятся здесь."] : view === "favorites" ? ["Пока нет избранного", "Отмечайте важные файлы звёздочкой."] : !canWrite ? ["Папка пока пуста", "У вас есть доступ только для просмотра."] : ["Здесь пока пусто", "Создайте папку или загрузите первый файл."];
  return <div className="empty-state"><div className="empty-icon"><ArchiveRestore size={28} /></div><h2>{copy[0]}</h2><p>{copy[1]}</p>{view === "files" && !query && canWrite && <div><button className="secondary-button" onClick={onCreate}><Plus size={17} />Создать папку</button><button className="primary-button" onClick={onUpload}><Upload size={17} />Загрузить</button></div>}</div>;
}

function ResourceTable(props: { resources: DriveResource[]; currentUserId: string; selected: Set<string>; menuId: string | null; view: View; onSelect: (id: string, value: boolean) => void; onMenu: (id: string | null) => void; onOpen: (resource: DriveResource) => void; onDownload: (resource: DriveResource) => void; onAction: (resource: DriveResource, action: string) => void; onDropMove: (event: React.DragEvent, folderId: string | null) => void }) {
  return <div className="resource-table"><div className="table-head"><span /><span>Название</span><span>Владелец</span><span>Размер</span><span>Изменён</span><span /></div>{props.resources.map((resource) => { const owned = resource.ownerId === props.currentUserId; return <div className={`table-row ${props.selected.has(resource.id) ? "selected" : ""}`} key={resource.id} draggable={owned} onDragStart={(event) => owned && event.dataTransfer.setData("application/x-cloud-resource", resource.id)} onDragOver={(event) => owned && resource.kind === "folder" && event.preventDefault()} onDrop={(event) => owned && resource.kind === "folder" && void props.onDropMove(event, resource.id)} onDoubleClick={() => void props.onOpen(resource)}>
    <input type="checkbox" checked={props.selected.has(resource.id)} onChange={(event) => props.onSelect(resource.id, event.target.checked)} aria-label={`Выбрать ${resource.name}`} />
    <button className="resource-name" onClick={() => void props.onOpen(resource)}><ResourceIcon resource={resource} /><span>{resource.name}</span>{resource.isFavorite && <Star size={13} fill="currentColor" />}</button>
    <span className="muted">{owned ? "Вы" : "Другой пользователь"}</span><span className="muted">{resource.kind === "folder" ? "—" : formatBytes(resource.sizeBytes)}</span><span className="muted">{new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(resource.updatedAt))}</span>
    <div className="row-actions">{resource.kind === "file" && <button className="icon-button quick-action" onClick={() => void props.onDownload(resource)} title="Скачать"><Download size={17} /></button>}{owned && <><button className="icon-button" onClick={() => props.onMenu(props.menuId === resource.id ? null : resource.id)}><MoreHorizontal size={19} /></button>{props.menuId === resource.id && <ContextMenu resource={resource} view={props.view} onAction={(action) => props.onAction(resource, action)} />}</>}</div>
  </div>;})}</div>;
}

function ResourceGrid(props: { resources: DriveResource[]; currentUserId: string; selected: Set<string>; view: View; menuId: string | null; onSelect: (id: string, value: boolean) => void; onOpen: (resource: DriveResource) => void; onAction: (resource: DriveResource, action: string) => void; onMenu: (id: string | null) => void; onDropMove: (event: React.DragEvent, folderId: string | null) => void }) {
  return <div className="resource-grid">{props.resources.map((resource) => { const owned = resource.ownerId === props.currentUserId; return <article className={`resource-card ${props.selected.has(resource.id) ? "selected" : ""}`} key={resource.id} draggable={owned} onDragStart={(event) => owned && event.dataTransfer.setData("application/x-cloud-resource", resource.id)} onDragOver={(event) => owned && resource.kind === "folder" && event.preventDefault()} onDrop={(event) => owned && resource.kind === "folder" && void props.onDropMove(event, resource.id)} onDoubleClick={() => void props.onOpen(resource)}>
    <div className="card-top"><input type="checkbox" checked={props.selected.has(resource.id)} onChange={(event) => props.onSelect(resource.id, event.target.checked)} />{owned && <button className="icon-button" onClick={() => props.onMenu(props.menuId === resource.id ? null : resource.id)}><MoreHorizontal size={18} /></button>}</div>
    <button className="card-body" onClick={() => void props.onOpen(resource)}><ResourceIcon resource={resource} size={42} /><strong>{resource.name}</strong><span>{resource.kind === "folder" ? "Папка" : formatBytes(resource.sizeBytes)}</span></button>
    {owned && props.menuId === resource.id && <ContextMenu resource={resource} view={props.view} onAction={(action) => props.onAction(resource, action)} />}
  </article>;})}</div>;
}

function ContextMenu({ resource, view, onAction }: { resource: DriveResource; view: View; onAction: (action: string) => void }) {
  if (view === "trash") return <div className="context-menu"><button onClick={() => onAction("restore")}><ArchiveRestore size={16} />Восстановить</button><button className="danger" onClick={() => onAction("purge")}><Trash2 size={16} />Удалить навсегда</button></div>;
  return <div className="context-menu"><button onClick={() => onAction("share")}><Link2 size={16} />Поделиться</button><button onClick={() => onAction("rename")}><FileText size={16} />Переименовать</button><button onClick={() => onAction("move")}><Move size={16} />Переместить</button><button onClick={() => onAction("favorite")}><Heart size={16} />{resource.isFavorite ? "Убрать из избранного" : "В избранное"}</button><hr /><button className="danger" onClick={() => onAction("trash")}><Trash2 size={16} />Удалить</button></div>;
}

type AdminData = {
  users: Array<{ id: string; email: string; displayName: string | null; role: string; isActive: boolean; quotaBytes: number; usedBytes: number; reservedBytes: number }>;
  settings: { total_quota_bytes: number; max_users: number; trash_retention_days: number };
  activeUploads: Array<{ id: string; owner_id: string; total_size_bytes: number; status: string; created_at: string }>;
  recentActivity: Array<{ id: number; user_id: string; event: string; resource_type: string | null; created_at: string }>;
};

const EVENT_LABELS: Record<string, string> = { login: "Вход", upload_started: "Загрузка начата", upload: "Файл загружен", download: "Скачивание", folder_created: "Папка создана", rename: "Переименование", move: "Перемещение", trash: "В корзину", restore: "Восстановление", delete_permanently: "Удалено навсегда", share_created: "Доступ создан", share_deleted: "Доступ отозван", upload_aborted: "Загрузка отменена" };

function AdminModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [quotas, setQuotas] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const result = await requestJson<AdminData>("/api/admin/usage");
      setData(result); setQuotas(Object.fromEntries(result.users.map((user) => [user.id, String(user.quotaBytes / 1_000_000_000)])));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось загрузить статистику."); }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function saveQuota(userId: string) {
    const gigabytes = Number(quotas[userId]);
    if (!Number.isFinite(gigabytes) || gigabytes < 0) return setError("Укажите квоту в гигабайтах.");
    setSavingId(userId); setError(null);
    try { await requestJson("/api/admin/usage", { method: "PATCH", body: JSON.stringify({ userId, quotaBytes: Math.round(gigabytes * 1_000_000_000) }) }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось изменить квоту."); }
    finally { setSavingId(null); }
  }

  return <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal admin-modal"><header><div><h2>Управление хранилищем</h2>{data && <small>{formatBytes(data.users.reduce((sum, user) => sum + user.usedBytes + user.reservedBytes, 0))} из {formatBytes(Number(data.settings.total_quota_bytes))}</small>}</div><button className="icon-button" onClick={onClose}><X size={19} /></button></header><div className="modal-content">
    {!data && !error && <div className="loading-state"><Loader2 className="spin" /> Загружаем статистику…</div>}
    {data && <><section className="admin-summary"><div><span>Пользователи</span><strong>{data.users.filter((user) => user.isActive).length} / {data.settings.max_users}</strong></div><div><span>Активные загрузки</span><strong>{data.activeUploads.length}</strong></div><div><span>Корзина</span><strong>{data.settings.trash_retention_days} дней</strong></div></section>
      <section className="admin-section"><h3>Квоты пользователей</h3><div className="admin-users">{data.users.map((user) => <div key={user.id}><span className="admin-avatar">{(user.displayName ?? user.email).slice(0, 1).toUpperCase()}</span><span className="admin-user-copy"><strong>{user.displayName ?? user.email}</strong><small>{user.email} · занято {formatBytes(user.usedBytes)}{user.reservedBytes ? ` + ${formatBytes(user.reservedBytes)} в загрузке` : ""}</small></span><label><input type="number" min="0" max="500" step="1" value={quotas[user.id] ?? ""} onChange={(event) => setQuotas((current) => ({ ...current, [user.id]: event.target.value }))} /><span>ГБ</span></label><button className="secondary-button" disabled={savingId === user.id} onClick={() => void saveQuota(user.id)}>{savingId === user.id ? <Loader2 size={15} className="spin" /> : "Сохранить"}</button></div>)}</div></section>
      {data.activeUploads.length > 0 && <section className="admin-section"><h3>Активные загрузки</h3><div className="activity-list">{data.activeUploads.map((upload) => { const user = data.users.find((candidate) => candidate.id === upload.owner_id); return <div key={upload.id}><span><strong>{formatBytes(Number(upload.total_size_bytes))} · {upload.status}</strong><small>{user?.displayName ?? user?.email ?? "Пользователь"}</small></span><time>{new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(new Date(upload.created_at))}</time></div>; })}</div></section>}
      <section className="admin-section"><h3>Последние действия</h3><div className="activity-list">{data.recentActivity.length ? data.recentActivity.map((item) => { const user = data.users.find((candidate) => candidate.id === item.user_id); return <div key={item.id}><span><strong>{EVENT_LABELS[item.event] ?? item.event}</strong><small>{user?.displayName ?? user?.email ?? "Пользователь"}</small></span><time>{new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(item.created_at))}</time></div>; }) : <p className="modal-note">Действий пока нет.</p>}</div></section></>}
    {error && <p className="form-message">{error}</p>}
  </div><footer><button className="primary-button" onClick={onClose}>Готово</button></footer></div></div>;
}

function DriveModal({ modal, currentFolderId, onClose, onDone }: { modal: Exclude<Modal, null | { type: "admin" }>; currentFolderId: string | null; onClose: () => void; onDone: (message: string) => void }) {
  const [value, setValue] = useState(modal.type === "rename" ? modal.resource.name : "");
  const [folders, setFolders] = useState<Array<{ id: string; name: string; parent_id: string | null }>>([]);
  const [destination, setDestination] = useState(currentFolderId ?? "root");
  const [password, setPassword] = useState("");
  const [expires, setExpires] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareCandidates, setShareCandidates] = useState<ShareCandidate[]>([]);
  const [grants, setGrants] = useState<ResourceGrant[]>([]);
  const [granteeId, setGranteeId] = useState("");
  const [shareAccessLoading, setShareAccessLoading] = useState(modal.type === "share");
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (modal.type === "move") void requestJson<{ folders: typeof folders }>("/api/folders").then((result) => setFolders(result.folders)); }, [modal.type]);
  useEffect(() => {
    if (modal.type !== "share") return;
    let active = true;
    const query = new URLSearchParams({ resourceId: modal.resource.id, resourceType: modal.resource.kind });
    void requestJson<{ candidates: ShareCandidate[]; grants: ResourceGrant[] }>(`/api/grants?${query}`)
      .then((result) => {
        if (!active) return;
        setShareCandidates(result.candidates ?? []);
        setGrants(result.grants ?? []);
        const granted = new Set((result.grants ?? []).map((grant) => grant.grantee_id));
        setGranteeId((result.candidates ?? []).find((candidate) => !granted.has(candidate.id))?.id ?? "");
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "Не удалось загрузить список пользователей."))
      .finally(() => active && setShareAccessLoading(false));
    return () => { active = false; };
  }, [modal]);

  async function grantAccess() {
    if (modal.type !== "share" || !granteeId) return;
    setBusy(true); setError(null); setShareNotice(null);
    try {
      const result = await requestJson<{ grantId: string }>("/api/grants", { method: "POST", body: JSON.stringify({ resourceId: modal.resource.id, resourceType: modal.resource.kind, granteeId }) });
      setGrants((current) => [...current.filter((grant) => grant.grantee_id !== granteeId), { id: result.grantId, grantee_id: granteeId, can_download: true }]);
      setShareNotice("Доступ выдан. Объект появится у пользователя в разделе «Общие».");
      const granted = new Set([...grants.map((grant) => grant.grantee_id), granteeId]);
      setGranteeId(shareCandidates.find((candidate) => !granted.has(candidate.id))?.id ?? "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось выдать доступ."); }
    finally { setBusy(false); }
  }

  async function revokeAccess(grantId: string) {
    setBusy(true); setError(null); setShareNotice(null);
    try {
      await requestJson(`/api/grants?id=${encodeURIComponent(grantId)}`, { method: "DELETE" });
      const removed = grants.find((grant) => grant.id === grantId);
      setGrants((current) => current.filter((grant) => grant.id !== grantId));
      if (removed) setGranteeId((current) => current || removed.grantee_id);
      setShareNotice("Доступ отозван.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось отозвать доступ."); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (modal.type === "create-folder") {
        await requestJson("/api/folders", { method: "POST", body: JSON.stringify({ name: value, parentId: currentFolderId }) });
        await onDone("Папка создана");
      } else if (modal.type === "rename") {
        await requestJson(`/api/${modal.resource.kind === "file" ? "files" : "folders"}/${modal.resource.id}`, { method: "PATCH", body: JSON.stringify({ action: "rename", name: value }) });
        await onDone("Название изменено");
      } else if (modal.type === "move") {
        await Promise.all(modal.resources.map((resource) => requestJson(`/api/${resource.kind === "file" ? "files" : "folders"}/${resource.id}`, { method: "PATCH", body: JSON.stringify({ action: "move", folderId: destination === "root" ? null : destination }) })));
        await onDone("Объекты перемещены");
      } else if (modal.type === "share") {
        const result = await requestJson<{ url: string }>("/api/shares", { method: "POST", body: JSON.stringify({ resourceId: modal.resource.id, resourceType: modal.resource.kind, expiresAt: expires ? new Date(expires).toISOString() : null, password: password || null }) });
        setShareUrl(result.url); await navigator.clipboard.writeText(result.url).catch(() => undefined);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось выполнить операцию."); }
    finally { setBusy(false); }
  }

  if (modal.type === "preview") return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal preview-modal"><header><div><ResourceIcon resource={modal.resource} /><strong>{modal.resource.name}</strong></div><button className="icon-button" onClick={onClose}><X /></button></header><div className="preview-body">{modal.resource.mimeType?.startsWith("image/") ? <img src={modal.url} alt={modal.resource.name} /> : modal.resource.mimeType?.startsWith("video/") ? <video src={modal.url} controls autoPlay /> : <iframe src={modal.url} title={modal.resource.name} />}</div><footer><a className="primary-button" href={modal.url} download><Download size={17} />Скачать</a></footer></div></div>;
  const heading = modal.type === "create-folder" ? "Новая папка" : modal.type === "rename" ? "Переименовать" : modal.type === "move" ? "Куда переместить?" : "Поделиться";
  return <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><header><h2>{heading}</h2><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></header><div className="modal-content">
    {(modal.type === "create-folder" || modal.type === "rename") && <label>Название<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} maxLength={255} required /></label>}
    {modal.type === "move" && <label>Папка назначения<select value={destination} onChange={(event) => setDestination(event.target.value)}><option value="root">Мои файлы</option>{folders.filter((folder) => !modal.resources.some((resource) => resource.id === folder.id)).map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label>}
    {modal.type === "share" && !shareUrl && <>
      <section className="share-section"><h3>Доступ другому аккаунту</h3><p className="modal-note">Пользователь увидит объект в разделе «Общие». Изменять и удалять его сможет только владелец.</p>
        {shareAccessLoading ? <span className="share-loading"><Loader2 size={15} className="spin" /> Загружаем пользователей…</span> : <>
          {shareCandidates.length === 0 ? <p className="modal-note">Сначала активируйте второй аккаунт в панели администратора.</p> : <div className="share-user-row"><select aria-label="Пользователь" value={granteeId} onChange={(event) => setGranteeId(event.target.value)}><option value="">Выберите пользователя</option>{shareCandidates.filter((candidate) => !grants.some((grant) => grant.grantee_id === candidate.id)).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.display_name ? `${candidate.display_name} — ` : ""}{candidate.email}</option>)}</select><button type="button" className="secondary-button" disabled={busy || !granteeId} onClick={() => void grantAccess()}>Дать доступ</button></div>}
          {grants.length > 0 && <div className="grant-list">{grants.map((grant) => { const candidate = shareCandidates.find((item) => item.id === grant.grantee_id); return <div key={grant.id}><span><strong>{candidate?.display_name ?? "Пользователь"}</strong><small>{candidate?.email ?? "Доступ выдан"}</small></span><button type="button" className="text-danger" disabled={busy} onClick={() => void revokeAccess(grant.id)}>Отозвать</button></div>; })}</div>}
        </>}
      </section>
      <div className="share-divider"><span>или</span></div>
      <section className="share-section"><h3>Публичная ссылка</h3><p className="modal-note">Будет создана случайная ссылка, которая не раскрывает адрес хранилища.</p><label>Срок действия (необязательно)<input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} /></label><label>Пароль (необязательно)<input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} /></label></section>
    </>}
    {modal.type === "share" && shareUrl && <div className="share-result"><Link2 size={24} /><strong>Ссылка создана и скопирована</strong><input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="secondary-button" onClick={() => { void navigator.clipboard.writeText(shareUrl); }}>Скопировать ещё раз</button></div>}
    {shareNotice && <p className="form-success">{shareNotice}</p>}{error && <p className="form-message">{error}</p>}
  </div><footer><button type="button" className="secondary-button" onClick={onClose}>{shareUrl ? "Готово" : "Отмена"}</button>{!shareUrl && <button className="primary-button" disabled={busy || ((modal.type === "rename" || modal.type === "create-folder") && !value.trim())}>{busy && <Loader2 size={16} className="spin" />}{modal.type === "share" ? "Создать ссылку" : "Сохранить"}</button>}</footer></form></div>;
}
