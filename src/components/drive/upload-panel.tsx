import { Check, ChevronDown, Loader2, UploadCloud, X } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "@/lib/format";
import type { UploadItem } from "@/features/uploads/use-upload-queue";

export function UploadPanel({ items, onCancel, onDismiss }: { items: UploadItem[]; onCancel: (id: string) => void; onDismiss: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!items.length) return null;
  const active = items.filter((item) => ["waiting", "preparing", "uploading"].includes(item.state)).length;
  return (
    <aside className={`upload-panel ${collapsed ? "collapsed" : ""}`} aria-label="Загрузки">
      <header><span><UploadCloud size={18} /> Загрузки {active > 0 && <b>{active}</b>}</span><button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label="Свернуть"><ChevronDown size={18} /></button></header>
      {!collapsed && <div className="upload-list">
        {items.slice(0, 8).map((item) => (
          <article key={item.id} className="upload-item">
            <div className={`upload-state ${item.state}`}>
              {item.state === "completed" ? <Check size={15} /> : item.state === "uploading" || item.state === "preparing" ? <Loader2 size={15} className="spin" /> : <UploadCloud size={15} />}
            </div>
            <div className="upload-info"><strong title={item.name}>{item.name}</strong><span>
              {item.state === "preparing" ? "Подготовка…" : item.state === "completed" ? "Завершено" : item.state === "error" ? item.error : item.state === "cancelled" ? "Отменено" : `${formatBytes(item.loaded)} из ${formatBytes(item.size)} · ${formatBytes(item.speed)}/с`}
            </span><div className="mini-progress"><i style={{ width: `${item.progress}%` }} /></div></div>
            <button className="icon-button" onClick={() => ["completed", "error", "cancelled"].includes(item.state) ? onDismiss(item.id) : onCancel(item.id)} aria-label="Убрать или отменить"><X size={16} /></button>
          </article>
        ))}
      </div>}
    </aside>
  );
}
