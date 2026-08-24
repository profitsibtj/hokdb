/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ACCESS_PASSWORD: string;
  readonly VITE_ACTION_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
