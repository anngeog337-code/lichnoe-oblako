import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isConfigured = Boolean(url && key);

export const supabase = isConfigured
  ? createSupabaseClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error("Supabase не настроен.");
  return supabase;
}

export const publicConfig = { url, key };
