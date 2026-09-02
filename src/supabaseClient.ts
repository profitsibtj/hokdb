// Server-only Supabase client (server.ts) - deliberately separate from
// supabaseBrowserClient.ts's browser client, which uses the public anon key instead.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  // Must be the SERVICE ROLE key, not the anon key - see the SUPABASE_ANON_KEY comment in
  // .env.example. server.ts already authenticates every write itself (checkAuth/checkAdminAuth)
  // before it ever reaches here, and RLS now denies the anon key any write at all.
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "SUPABASE_URL environment variable is not configured. Please add SUPABASE_URL to your env variables to connect to your Supabase project."
    );
  }

  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_ANON_KEY environment variable is not configured. Please add SUPABASE_ANON_KEY to your env variables to connect to your Supabase project."
    );
  }

  supabaseInstance = createClient(supabaseUrl, supabaseKey);
  return supabaseInstance;
}
