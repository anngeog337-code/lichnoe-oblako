import { publicConfig, requireSupabase } from "@/lib/supabase";

function edgeUrl(path: string) {
  const url = new URL(`${publicConfig.url}/functions/v1/cloud-api`);
  url.searchParams.set("path", path);
  return url.toString();
}

export async function apiFetch(path: string, init?: RequestInit) {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  headers.set("apikey", publicConfig.key);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(edgeUrl(path), { ...init, headers, cache: "no-store" });
}

export async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new Error(body.message ?? "Не удалось выполнить операцию.");
  return body as T;
}
