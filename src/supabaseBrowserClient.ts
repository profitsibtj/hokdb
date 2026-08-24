import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Browser-side counterpart to supabaseClient.ts (which is server-only and reads process.env via
// dotenv). Used by dataClient.ts in static/GitHub Pages mode, where there is no server to proxy
// Supabase calls through. VITE_SUPABASE_ANON_KEY is safe to expose publicly - it identifies the
// app, it does not grant elevated access on its own.
let supabaseInstance: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. Set both as GitHub Actions repository secrets for the static build."
    );
  }

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  return supabaseInstance;
}
