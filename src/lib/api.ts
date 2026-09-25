import { publicConfig, requireSupabase } from "@/lib/supabase";

function edgeUrl(path: string) {
  const url = new URL(`${publicConfig.url}/functions/v1/cloud-api`);
  url.searchParams.set("path", path);
  return url.toString();
}

export async function apiFetch(path: string, init?: RequestInit) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
  try {
    const session = requireSupabase().auth.getSession();
    const { data } = await Promise.race([
      session,
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    ]);
    const token = data.session?.access_token;
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
    headers.set("apikey", publicConfig.key);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return await fetch(edgeUrl(path), { ...init, headers, signal, cache: "no-store" });
  } catch (error) {
    if (timeout.signal.aborted) throw new Error("Сервер не ответил за 30 секунд. Проверьте соединение и повторите попытку.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new Error(body.message ?? "Не удалось выполнить операцию.");
  return body as T;
}

