import { useCallback, useRef, useState } from "react";
import type { UploadInitResponse } from "@/lib/types";
import { apiFetch, apiJson } from "@/lib/api";

export type UploadState = "waiting" | "preparing" | "uploading" | "completed" | "error" | "cancelled";
export type UploadItem = {
  id: string;
  name: string;
  size: number;
  loaded: number;
  progress: number;
  speed: number;
  state: UploadState;
  error?: string;
  uploadId?: string;
};

type ActiveUpload = { uploadId?: string; aborters: Set<XMLHttpRequest>; cancelled: boolean };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  return apiJson<T>(url, init);
}

function putPart(url: string, blob: Blob, signalSet: Set<XMLHttpRequest>, onProgress: (loaded: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    signalSet.add(xhr);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded);
    xhr.onerror = () => { signalSet.delete(xhr); reject(new Error("Соединение прервано")); };
    xhr.onabort = () => { signalSet.delete(xhr); reject(new DOMException("Отменено", "AbortError")); };
    xhr.onload = () => {
      signalSet.delete(xhr);
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`Хранилище ответило ${xhr.status}`));
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) return reject(new Error("Хранилище не вернуло ETag. Проверьте CORS-настройки B2."));
      onProgress(blob.size);
      resolve(etag);
    };
    xhr.send(blob);
  });
}

async function withRetry<T>(operation: () => Promise<T>, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
    }
  }
  throw lastError;
}

export function useUploadQueue(onCompleted: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const active = useRef(new Map<string, ActiveUpload>());

  const patch = useCallback((id: string, update: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }, []);

  const uploadOne = useCallback(async (file: File, folderId: string | null, id: string) => {
    const controller: ActiveUpload = { aborters: new Set(), cancelled: false };
    active.current.set(id, controller);
    const startedAt = performance.now();
    const partLoaded = new Map<number, number>();
    try {
      patch(id, { state: "preparing" });
      const init = await api<UploadInitResponse>("/api/uploads/init", {
        method: "POST",
        body: JSON.stringify({ name: file.name, folderId, size: file.size, mimeType: file.type || "application/octet-stream" }),
      });
      controller.uploadId = init.uploadId;
      patch(id, { state: "uploading", uploadId: init.uploadId });
      localStorage.setItem(`cloud-upload-${id}`, JSON.stringify({ uploadId: init.uploadId, name: file.name, size: file.size, lastModified: file.lastModified }));

      const partNumbers = Array.from({ length: init.partCount }, (_, index) => index + 1);
      const signed = new Map<number, string>();
      for (let index = 0; index < partNumbers.length; index += 40) {
        const batch = partNumbers.slice(index, index + 40);
        const result = await api<{ urls: Array<{ partNumber: number; url: string }> }>(`/api/uploads/${init.uploadId}/parts`, {
          method: "POST", body: JSON.stringify({ partNumbers: batch }),
        });
        result.urls.forEach((entry) => signed.set(entry.partNumber, entry.url));
      }

      const completed: Array<{ partNumber: number; etag: string }> = [];
      let cursor = 0;
      const updateProgress = (partNumber: number, loaded: number) => {
        partLoaded.set(partNumber, loaded);
        const totalLoaded = Array.from(partLoaded.values()).reduce((sum, value) => sum + value, 0);
        const elapsed = Math.max(0.2, (performance.now() - startedAt) / 1000);
        patch(id, { loaded: totalLoaded, progress: Math.min(100, (totalLoaded / file.size) * 100), speed: totalLoaded / elapsed });
      };
      const worker = async () => {
        while (cursor < partNumbers.length && !controller.cancelled) {
          const partNumber = partNumbers[cursor++];
          const start = (partNumber - 1) * init.partSize;
          const blob = file.slice(start, Math.min(file.size, start + init.partSize));
          const url = signed.get(partNumber);
          if (!url) throw new Error("Не получена ссылка для части файла");
          const etag = await withRetry(() => putPart(url, blob, controller.aborters, (loaded) => updateProgress(partNumber, loaded)));
          completed.push({ partNumber, etag });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, init.partCount) }, () => worker()));
      if (controller.cancelled) throw new DOMException("Отменено", "AbortError");
      await api(`/api/uploads/${init.uploadId}/complete`, { method: "POST", body: JSON.stringify({ parts: completed }) });
      localStorage.removeItem(`cloud-upload-${id}`);
      patch(id, { state: "completed", loaded: file.size, progress: 100, speed: 0 });
      onCompleted();
    } catch (error) {
      if (controller.cancelled || (error instanceof DOMException && error.name === "AbortError")) {
        patch(id, { state: "cancelled", error: undefined });
      } else {
        patch(id, { state: "error", error: error instanceof Error ? error.message : "Не удалось загрузить файл." });
      }
    } finally {
      active.current.delete(id);
    }
  }, [onCompleted, patch]);

  const addFiles = useCallback((files: File[], folderId: string | null) => {
    const additions = files.filter((file) => file.size > 0).map((file) => ({
      file,
      item: { id: crypto.randomUUID(), name: file.name, size: file.size, loaded: 0, progress: 0, speed: 0, state: "waiting" as const },
    }));
    setItems((current) => [...additions.map(({ item }) => item), ...current]);
    additions.forEach(({ file, item }) => void uploadOne(file, folderId, item.id));
  }, [uploadOne]);

  const cancel = useCallback(async (id: string) => {
    const controller = active.current.get(id);
    if (!controller) return;
    controller.cancelled = true;
    controller.aborters.forEach((xhr) => xhr.abort());
    if (controller.uploadId) await apiFetch(`/api/uploads/${controller.uploadId}/abort`, { method: "POST" }).catch(() => undefined);
    localStorage.removeItem(`cloud-upload-${id}`);
    patch(id, { state: "cancelled" });
  }, [patch]);

  const dismiss = useCallback((id: string) => setItems((current) => current.filter((item) => item.id !== id)), []);
  return { items, addFiles, cancel, dismiss };
}
