import { createClient } from "npm:@supabase/supabase-js@2";

type Role = "viewer" | "admin";
type SessionClaims = {
  role: Role;
  exp: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const encoder = new TextEncoder();
const sessionLifetimeSeconds = 8 * 60 * 60;

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getSigningKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

async function issueSession(role: Role, secret: string): Promise<string> {
  const claims: SessionClaims = {
    role,
    exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds,
  };
  const encodedClaims = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const key = await getSigningKey(secret, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(encodedClaims)));
  return `${encodedClaims}.${encodeBase64Url(signature)}`;
}

async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  const [encodedClaims, encodedSignature, extra] = token.split(".");
  if (!encodedClaims || !encodedSignature || extra) return null;
  try {
    const key = await getSigningKey(secret, ["verify"]);
    const signatureIsValid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(encodedSignature),
      encoder.encode(encodedClaims),
    );
    if (!signatureIsValid) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedClaims))) as SessionClaims;
    if ((claims.role !== "viewer" && claims.role !== "admin") || claims.exp <= Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

async function passwordMatches(input: string, expected: string): Promise<boolean> {
  const [inputHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(inputHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function requireIntegerId(id: unknown): number {
  const value = typeof id === "string" || typeof id === "number" ? Number(id) : Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("A valid record ID is required.");
  return value;
}

function requireRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("A valid record is required.");
  return row as Record<string, unknown>;
}

function createDatabaseClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Supabase server credentials are not configured.");
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function handleAction(action: string, body: Record<string, unknown>, role: Role) {
  const database = createDatabaseClient();
  if (action === "health") {
    const { error } = await database.from("matches").select("id").limit(1);
    if (error) throw error;
    return { status: "ok" };
  }
  if (action === "session") return { isAdmin: role === "admin" };

  if (action === "load") {
    const [matches, schedules, roster, tournaments] = await Promise.all([
      database.from("matches").select("*"),
      database.from("schedules").select("*"),
      database.from("roster").select("*"),
      database.from("tournaments").select("*").order("created_at", { ascending: true }),
    ]);
    for (const result of [matches, schedules, roster, tournaments]) {
      if (result.error) throw result.error;
    }
    return {
      matchRows: matches.data || [],
      scheduleRows: schedules.data || [],
      rosterRows: roster.data || [],
      tournamentRows: tournaments.data || [],
    };
  }

  if (action === "list_matches") {
    const { data, error } = await database.from("matches").select("*");
    if (error) throw error;
    return data || [];
  }

  if (action === "list_schedules") {
    const { data, error } = await database.from("schedules").select("*");
    if (error) throw error;
    return data || [];
  }

  if (role !== "admin") return respond({ error: "Admin password required." }, 403);

  if (action === "save_match" || action === "save_roster" || action === "save_schedule") {
    const table = action === "save_match" ? "matches" : action === "save_roster" ? "roster" : "schedules";
    const row = requireRow(body.row);
    const query = body.id === undefined
      ? database.from(table).insert(row)
      : database.from(table).update(row).eq("id", requireIntegerId(body.id));
    const { data, error } = await query.select("id").single();
    if (error) throw error;
    return data.id;
  }

  if (action === "delete_roster") {
    const { error } = await database.from("roster").delete().eq("id", requireIntegerId(body.id));
    if (error) throw error;
    return null;
  }

  if (action === "sync_tournaments") {
    if (!Array.isArray(body.rows)) throw new Error("Tournament rows must be an array.");
    const rows = body.rows.map((item) => {
      const tournament = requireRow(item);
      if (typeof tournament.id !== "string" || !tournament.id.trim()) {
        throw new Error("Every tournament requires an ID.");
      }
      return {
        id: tournament.id,
        data: tournament.data && typeof tournament.data === "object" && !Array.isArray(tournament.data)
          ? tournament.data
          : {},
      };
    });

    if (rows.length) {
      const { error } = await database.from("tournaments").upsert(rows, { onConflict: "id" });
      if (error) throw error;
    }

    const keepIds = new Set(rows.map((row) => row.id));
    const { data: existing, error: listError } = await database.from("tournaments").select("id");
    if (listError) throw listError;
    const obsoleteIds = (existing || [])
      .map((row) => row.id as string)
      .filter((id) => !keepIds.has(id));
    if (obsoleteIds.length) {
      const { error } = await database.from("tournaments").delete().in("id", obsoleteIds);
      if (error) throw error;
    }
    return null;
  }

  return respond({ error: "Unknown action." }, 400);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 1_000_000) return respond({ error: "Request is too large." }, 413);
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return respond({ error: "Invalid request." }, 400);
    }

    const viewerPassword = Deno.env.get("VIEWER_PASSWORD") || "";
    const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "";
    const signingSecret = Deno.env.get("SESSION_SIGNING_SECRET") || "";
    if (viewerPassword.length < 16 || adminPassword.length < 16 || signingSecret.length < 32) {
      return respond({ error: "Password access is not configured. Set strong viewer/admin passwords and a signing secret." }, 503);
    }
    if (viewerPassword === adminPassword) {
      return respond({ error: "Viewer and admin passwords must be different." }, 503);
    }

    if (body.action === "sign_in") {
      if (typeof body.password !== "string") return respond({ error: "Enter an access password." }, 400);
      const [isViewer, isAdmin] = await Promise.all([
        passwordMatches(body.password, viewerPassword),
        passwordMatches(body.password, adminPassword),
      ]);
      if (!isViewer && !isAdmin) return respond({ error: "Incorrect password." }, 401);
      const role: Role = isAdmin ? "admin" : "viewer";
      return respond({ token: await issueSession(role, signingSecret), isAdmin: role === "admin" });
    }

    if (body.action === "health") {
      const result = await handleAction(body.action, body, "viewer");
      return respond(result);
    }

    const authorization = request.headers.get("authorization") || "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    const session = await verifySession(token, signingSecret);
    if (!session) return respond({ error: "Session expired. Enter your access password again." }, 401);

    const result = await handleAction(body.action, body, session.role);
    return result instanceof Response ? result : respond(result);
  } catch (error) {
    console.error("HOKDB edge request failed:", error);
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return respond({ error: message }, 500);
  }
});
