import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Cloud, Download, File, FileImage, FileText, FileVideo, Folder, KeyRound, Loader2 } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { apiFetch } from "@/lib/api";

type SharedData = {
  passwordRequired: false;
  type: "file" | "folder";
  resource: Record<string, unknown>;
  rootId?: string;
  folders?: Array<{ id: string; name: string; parent_id: string; updated_at: string }>;
  files?: Array<{ id: string; original_name: string; mime_type: string; size_bytes: number; folder_id: string; updated_at: string }>;
};

export function SharedView({ token }: { token: string }) {
  const [data, setData] = useState<SharedData | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [unlockToken, setUnlockToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const response = await apiFetch(`/api/public/${token}${folderId ? `?folderId=${folderId}` : ""}`, { cache: "no-store", headers: unlockToken ? { "X-Share-Unlock": unlockToken } : undefined });
    const body = await response.json().catch(() => ({})) as SharedData & { message?: string };
    if (response.status === 401) { setPasswordRequired(true); setLoading(false); return; }
    if (!response.ok) { setError(body.message ?? "Ссылка недоступна."); setLoading(false); return; }
    setPasswordRequired(false); setData(body); setLoading(false);
  }, [folderId, token, unlockToken]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function unlock(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(null);
    const response = await apiFetch(`/api/public/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const body = await response.json().catch(() => ({})) as { message?: string; unlockToken?: string };
    if (!response.ok) { setError(body.message ?? "Неверный пароль."); setLoading(false); return; }
    setUnlockToken(body.unlockToken ?? "");
  }

  async function download(fileId?: string, inline = false) {
    const params = new URLSearchParams(); if (fileId) params.set("fileId", fileId); if (inline) params.set("inline", "1");
    const response = await apiFetch(`/api/public/${token}/download?${params}`, { headers: unlockToken ? { "X-Share-Unlock": unlockToken } : undefined });
    const body = await response.json().catch(() => ({})) as { message?: string; url?: string };
    if (!response.ok) return setError(body.message ?? "Не удалось скачать файл.");
    if (body.url) window.location.assign(body.url);
  }

  if (loading && !data) return <main className="shared-page"><div className="shared-loading"><Loader2 className="spin" />Проверяем ссылку…</div></main>;
  if (passwordRequired) return <main className="shared-page"><section className="unlock-card"><span className="brand-mark large"><KeyRound /></span><p className="eyebrow">ЗАЩИЩЁННАЯ ССЫЛКА</p><h1>Введите пароль</h1><p>Владелец защитил файл или папку паролем.</p><form onSubmit={unlock}><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required /><button className="primary-button">Открыть</button></form>{error && <p className="form-message">{error}</p>}</section></main>;
  if (error && !data) return <main className="shared-page"><section className="unlock-card"><span className="brand-mark large"><Cloud /></span><h1>Ссылка недоступна</h1><p>{error}</p></section></main>;
  if (!data) return null;

  if (data.type === "file") {
    const file = data.resource as { id: string; original_name: string; mime_type: string; size_bytes: number; updated_at: string };
    return <main className="shared-page"><header className="shared-header"><div><span className="brand-mark"><Cloud size={19} /></span>Личное облако</div><span>Общий файл</span></header><section className="shared-file-card"><SharedFileIcon mime={file.mime_type} /><h1>{file.original_name}</h1><p>{formatBytes(file.size_bytes)} · изменён {new Intl.DateTimeFormat("ru", { dateStyle: "medium" }).format(new Date(file.updated_at))}</p><button className="primary-button" onClick={() => void download()}><Download size={18} />Скачать файл</button><small>Ссылка действует ограниченное время. Адрес хранилища скрыт.</small></section></main>;
  }

  const folder = data.resource as { id: string; name: string; parent_id: string | null };
  return <main className="shared-page"><header className="shared-header"><div><span className="brand-mark"><Cloud size={19} /></span>Личное облако</div><span>Общая папка</span></header><section className="shared-browser"><div className="shared-title">{history.length > 0 && <button className="icon-button" onClick={() => { const next = [...history]; const previous = next.pop() ?? null; setHistory(next); setFolderId(previous); }}><ArrowLeft /></button>}<Folder size={28} fill="currentColor" /><div><h1>{folder.name}</h1><p>{(data.folders?.length ?? 0) + (data.files?.length ?? 0)} объектов</p></div></div><div className="shared-list">
    {data.folders?.map((item) => <button className="shared-row" key={item.id} onClick={() => { setHistory((current) => [...current, folderId ?? data.rootId ?? ""]); setFolderId(item.id); }}><Folder className="folder-icon" fill="currentColor" /><strong>{item.name}</strong><span>Папка</span></button>)}
    {data.files?.map((item) => <div className="shared-row" key={item.id}><SharedFileIcon mime={item.mime_type} /><strong>{item.original_name}</strong><span>{formatBytes(item.size_bytes)}</span><button className="secondary-button" onClick={() => void download(item.id)}><Download size={16} />Скачать</button></div>)}
    {!data.folders?.length && !data.files?.length && <div className="empty-state"><Folder size={30} /><h2>Папка пуста</h2></div>}
  </div>{error && <p className="form-message">{error}</p>}</section></main>;
}

function SharedFileIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) return <FileImage className="image-icon" />;
  if (mime.startsWith("video/")) return <FileVideo className="video-icon" />;
  if (mime === "application/pdf") return <FileText className="pdf-icon" />;
  return <File className="file-icon" />;
}
