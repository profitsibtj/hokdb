type AccessSession = {
  token: string;
  isAdmin: boolean;
};

type ApiError = Error & { status: number };

const sessionKey = "hokdb_access_session_v1";

function getConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be configured.");
  }
  return { url: url.replace(/\/+$/, ""), anonKey };
}

function storedToken(): string | null {
  const stored = sessionStorage.getItem(sessionKey);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as AccessSession;
    return typeof session.token === "string" ? session.token : null;
  } catch {
    sessionStorage.removeItem(sessionKey);
    return null;
  }
}

async function request<T>(
  action: string,
  payload: Record<string, unknown> = {},
  useSession = true,
): Promise<T> {
  const { url, anonKey } = getConfig();
  const token = useSession ? storedToken() : null;
  const headers: Record<string, string> = {
    apikey: anonKey,
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${url}/functions/v1/hokdb-api`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && useSession) sessionStorage.removeItem(sessionKey);
    const error = new Error(result.error || `Supabase request failed (${response.status}).`) as ApiError;
    error.status = response.status;
    throw error;
  }
  return result as T;
}

export async function signInWithPassword(password: string): Promise<boolean> {
  const session = await request<AccessSession>("sign_in", { password }, false);
  sessionStorage.setItem(sessionKey, JSON.stringify(session));
  return session.isAdmin;
}

export async function restoreAccessSession(): Promise<{ isAdmin: boolean } | null> {
  if (!storedToken()) return null;
  try {
    return await request<{ isAdmin: boolean }>("session");
  } catch (error) {
    if ((error as ApiError).status === 401) return null;
    throw error;
  }
}

export async function signOut(): Promise<void> {
  sessionStorage.removeItem(sessionKey);
}

export function accessApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return request<T>(action, payload);
}
