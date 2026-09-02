import { Match, RosterPlayer, ScheduleEntry, LeaguePreset } from "./types";
import { getBrowserSupabase } from "./supabaseBrowserClient";
import {
  mapMatchFromDb, mapMatchToDb, mapRosterFromDb, mapRosterToDb,
  mapScheduleFromDb, mapScheduleToDb, mapLeaguePresetFromDb, formatMatchData, sortMatches
} from "./dbMappers";

export { formatMatchData, sortMatches };

// True when a Supabase/PostgREST error means the table itself hasn't been created yet (PGRST205,
// or the equivalent "relation ... does not exist" / "schema cache" wording) - used in static mode
// (no server to pre-translate this into a friendly DATABASE_SETUP_NEEDED response) so the UI can
// still show the same "run this SQL" banner instead of a raw network error.
export const isTableMissingError = (error: any): boolean => {
  if (!error) return false;
  const code = (error as any).code;
  const message = (error as any).message || "";
  return code === "PGRST205" || message.includes("schema cache") || message.includes("does not exist");
};

export const clientDb = {
  getIsStatic: () => {
    return window.location.hostname.endsWith(".github.io") || window.location.search.includes("mode=static");
  },

  // Static/GitHub Pages mode has no server, so it talks to Supabase directly from the browser
  // using the (safe-to-expose) anon key - same tables and column mapping as server.ts, so data is
  // shared with everyone, not just the local browser.
  getMatches: async (): Promise<Match[]> => {
    const { data: rawMatches, error } = await getBrowserSupabase().from("matches").select("*");
    if (error) throw error;
    const formatted = (rawMatches || []).map((m: any) => mapMatchFromDb(m));
    return sortMatches(formatted.map((m: any) => formatMatchData(m)));
  },

  // Every write below goes through a password-checked Postgres function (see SUPABASE_SETUP_SQL
  // in App.tsx) instead of writing to the table directly - RLS blocks direct anon writes entirely
  // now, so `password` isn't just a UI nicety here, Postgres itself rejects a wrong/missing one.
  addMatch: async (matchData: any, password: string): Promise<string> => {
    const dbObj: any = mapMatchToDb(formatMatchData(matchData));
    const { data, error } = await getBrowserSupabase().rpc("upsert_match", { p_password: password, p_id: null, p_row: dbObj });
    if (error) throw error;
    return String(data);
  },

  updateMatch: async (id: string, matchData: any, password: string): Promise<void> => {
    const dbObj: any = mapMatchToDb(formatMatchData(matchData));
    const { error } = await getBrowserSupabase().rpc("upsert_match", { p_password: password, p_id: Number(id), p_row: dbObj });
    if (error) throw error;
  },

  deleteMatch: async (id: string, password: string): Promise<void> => {
    // The id-sequence reclaim that used to be a separate best-effort RPC call here now happens
    // inside delete_match itself (see SUPABASE_SETUP_SQL), since it needs to run as the same
    // definer/owner that's allowed to touch the sequence.
    const { error } = await getBrowserSupabase().rpc("delete_match", { p_password: password, p_id: Number(id) });
    if (error) throw error;
  },

  getRoster: async (): Promise<RosterPlayer[]> => {
    const { data: rawRoster, error } = await getBrowserSupabase().from("roster").select("*");
    if (error) throw error;
    return (rawRoster || []).map((r: any) => mapRosterFromDb(r));
  },

  saveRosterPlayer: async (player: any, password: string): Promise<string> => {
    const dbObj: any = mapRosterToDb(player);
    const { data, error } = await getBrowserSupabase().rpc("upsert_roster_player", {
      p_password: password,
      p_id: player.id ? Number(player.id) : null,
      p_row: dbObj
    });
    if (error) throw error;
    return String(data);
  },

  deleteRosterPlayer: async (id: string, password: string): Promise<void> => {
    const { error } = await getBrowserSupabase().rpc("delete_roster_player", { p_password: password, p_id: Number(id) });
    if (error) throw error;
  },

  getSchedules: async (): Promise<ScheduleEntry[]> => {
    const { data: rawSchedules, error } = await getBrowserSupabase().from("schedules").select("*");
    if (error) throw error;
    return (rawSchedules || []).map((s: any) => mapScheduleFromDb(s));
  },

  addSchedule: async (scheduleData: any, password: string): Promise<string> => {
    const dbObj: any = mapScheduleToDb(scheduleData);
    const { data, error } = await getBrowserSupabase().rpc("upsert_schedule", { p_password: password, p_id: null, p_row: dbObj });
    if (error) throw error;
    return String(data);
  },

  updateSchedule: async (id: string, scheduleData: any, password: string): Promise<void> => {
    const dbObj: any = mapScheduleToDb(scheduleData);
    const { error } = await getBrowserSupabase().rpc("upsert_schedule", { p_password: password, p_id: Number(id), p_row: dbObj });
    if (error) throw error;
  },

  deleteSchedule: async (id: string, password: string): Promise<void> => {
    const { error } = await getBrowserSupabase().rpc("delete_schedule", { p_password: password, p_id: Number(id) });
    if (error) throw error;
  },

  getLeaguePresets: async (): Promise<LeaguePreset[]> => {
    const { data, error } = await getBrowserSupabase().from("tournaments").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => mapLeaguePresetFromDb(row));
  },

  // Full sync: upserts every league preset passed in and deletes any row not present in the list.
  saveLeaguePresets: async (presets: LeaguePreset[], password: string): Promise<void> => {
    const rows = presets.map((p: any) => {
      const { id, ...rest } = p;
      return { id: String(id), data: rest };
    });
    const { error } = await getBrowserSupabase().rpc("sync_tournaments", { p_password: password, p_rows: rows });
    if (error) throw error;
  },

  // NOTE: this only gates local-only (per-browser) data in static/GitHub Pages mode. Vite bakes
  // VITE_-prefixed env vars into the public JS bundle at build time, so this is not a real secret
  // and should not be relied on to protect anything sensitive - configure it via a GitHub Actions
  // secret, not by hardcoding a value here.
  verifyAccessPassword: async (password: string): Promise<boolean> => {
    const expected = import.meta.env.VITE_ACCESS_PASSWORD;
    return !!expected && password === expected;
  },

  verifyActionPassword: async (password: string): Promise<boolean> => {
    const expected = import.meta.env.VITE_ACTION_PASSWORD;
    return !!expected && password === expected;
  }
};
