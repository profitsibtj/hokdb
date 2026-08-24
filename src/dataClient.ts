import { Match, Game, RosterPlayer, ScheduleEntry, LeaguePreset, MatchFormat } from "./types";
import { getBrowserSupabase } from "./supabaseBrowserClient";

const mapMatchFromDb = (row: any): Match => {
  return {
    id: String(row.id),
    league: row.league || "",
    stage: row.stage || "",
    format: row.format || "Bo1",
    teamA: row.team_a || "",
    teamB: row.team_b || "",
    scoreA: row.score_a || 0,
    scoreB: row.score_b || 0,
    winner: row.winner || undefined,
    scheduledAt: row.scheduled_at || "",
    liveLink: row.live_link || "",
    patch: row.patch || "",
    isPlayoff: !!row.is_playoff,
    isFinished: !!row.is_finished,
    games: row.games || [],
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
};

const mapMatchToDb = (data: any) => {
  return {
    league: data.league || null,
    stage: data.stage || null,
    format: data.format || null,
    team_a: data.teamA || null,
    team_b: data.teamB || null,
    score_a: data.scoreA || 0,
    score_b: data.scoreB || 0,
    winner: data.winner || null,
    scheduled_at: data.scheduledAt || null,
    live_link: data.liveLink || null,
    patch: data.patch || null,
    is_playoff: !!data.isPlayoff,
    is_finished: !!data.isFinished,
    games: data.games || [],
  };
};

const mapRosterFromDb = (row: any): RosterPlayer => {
  return {
    id: String(row.id),
    name: row.name || "",
    position: row.position || "Clash Lane",
    secondaryPosition: row.secondary_position || undefined,
    team: row.team || "",
    league: row.league || "",
    previousNames: row.previous_names || [],
    realName: row.real_name || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
};

const mapRosterToDb = (player: any) => {
  return {
    name: player.name || "",
    position: player.position || null,
    secondary_position: player.secondaryPosition || null,
    team: player.team || null,
    league: player.league || null,
    previous_names: player.previousNames || [],
    real_name: player.realName || null,
  };
};

const mapScheduleFromDb = (row: any): ScheduleEntry => {
  return {
    id: String(row.id),
    league: row.league || "",
    matchCode: row.match_code || "",
    teamA: row.team_a || "",
    teamB: row.team_b || "",
    format: row.format || "Bo1",
    scheduledAt: row.scheduled_at || "",
    liveLink: row.live_link || "",
    isFinished: !!row.is_finished,
    createdAt: row.created_at || "",
  };
};

const mapScheduleToDb = (data: any) => {
  return {
    league: data.league || null,
    match_code: data.matchCode || null,
    team_a: data.teamA || null,
    team_b: data.teamB || null,
    format: data.format || null,
    scheduled_at: data.scheduledAt || null,
    live_link: data.liveLink || null,
    is_finished: !!data.isFinished,
  };
};

// League presets are stored as one row per league (name, default format, fearless draft toggle,
// team list, abbreviations), the whole preset kept as a single jsonb blob - the shape is defined
// and versioned entirely on the frontend (see LeaguePreset).
const mapLeaguePresetFromDb = (row: any): LeaguePreset => {
  return { id: row.id, ...(row.data || {}) };
};

const REQUIRED_WINS: Record<MatchFormat, number> = { Bo1: 1, Bo3: 2, Bo5: 3, Bo7: 4 };

// Recomputes scoreA/scoreB/winner/isFinished from the nested games array, the same way pubgmdb's
// formatMatchData recomputes placement points/WWCD from raw team data - derived fields are never
// trusted from stale stored values, only from the games actually entered.
export const formatMatchData = (match: any): Match => {
  const games: Game[] = match.games || [];
  const scoreA = games.filter((g) => g.winner === "A").length;
  const scoreB = games.filter((g) => g.winner === "B").length;
  const required = REQUIRED_WINS[match.format as MatchFormat] || 1;
  let winner: string | undefined;
  if (scoreA >= required) winner = match.teamA;
  else if (scoreB >= required) winner = match.teamB;
  return { ...match, games, scoreA, scoreB, winner, isFinished: !!winner };
};

// Sort matches by scheduled/created date, most recent first.
export const sortMatches = (matchList: Match[]): Match[] => {
  return [...matchList].sort((a, b) => {
    const ad = a.scheduledAt || a.createdAt || "";
    const bd = b.scheduledAt || b.createdAt || "";
    return bd.localeCompare(ad);
  });
};

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

  addMatch: async (matchData: any): Promise<string> => {
    const dbObj: any = mapMatchToDb(formatMatchData(matchData));
    dbObj.created_at = new Date().toISOString();
    const { data, error } = await getBrowserSupabase().from("matches").insert([dbObj]).select("id").single();
    if (error) throw error;
    return String(data.id);
  },

  updateMatch: async (id: string, matchData: any): Promise<void> => {
    const dbObj: any = mapMatchToDb(formatMatchData(matchData));
    dbObj.updated_at = new Date().toISOString();
    const { error } = await getBrowserSupabase().from("matches").update(dbObj).eq("id", id);
    if (error) throw error;
  },

  deleteMatch: async (id: string): Promise<void> => {
    const { error } = await getBrowserSupabase().from("matches").delete().eq("id", id);
    if (error) throw error;
    // Reclaim the ID if it was the highest one - lets the next insert reuse it instead of
    // leaving a permanent gap. Best-effort: an old database without this SQL function
    // shouldn't block the delete itself from succeeding.
    try {
      await getBrowserSupabase().rpc("reset_matches_id_seq");
    } catch (e) {}
  },

  getRoster: async (): Promise<RosterPlayer[]> => {
    const { data: rawRoster, error } = await getBrowserSupabase().from("roster").select("*");
    if (error) throw error;
    return (rawRoster || []).map((r: any) => mapRosterFromDb(r));
  },

  saveRosterPlayer: async (player: any): Promise<string> => {
    if (player.id) {
      const dbObj: any = mapRosterToDb(player);
      dbObj.updated_at = new Date().toISOString();
      const { error } = await getBrowserSupabase().from("roster").update(dbObj).eq("id", player.id);
      if (error) throw error;
      return player.id;
    }
    const dbObj: any = mapRosterToDb(player);
    dbObj.created_at = new Date().toISOString();
    const { data: inserted, error } = await getBrowserSupabase().from("roster").insert([dbObj]).select("id").single();
    if (error) throw error;
    return String(inserted.id);
  },

  deleteRosterPlayer: async (id: string): Promise<void> => {
    const { error } = await getBrowserSupabase().from("roster").delete().eq("id", id);
    if (error) throw error;
    try {
      await getBrowserSupabase().rpc("reset_roster_id_seq");
    } catch (e) {}
  },

  getSchedules: async (): Promise<ScheduleEntry[]> => {
    const { data: rawSchedules, error } = await getBrowserSupabase().from("schedules").select("*");
    if (error) throw error;
    return (rawSchedules || []).map((s: any) => mapScheduleFromDb(s));
  },

  addSchedule: async (scheduleData: any): Promise<string> => {
    const dbObj: any = mapScheduleToDb(scheduleData);
    dbObj.created_at = new Date().toISOString();
    const { data, error } = await getBrowserSupabase().from("schedules").insert([dbObj]).select("id").single();
    if (error) throw error;
    return String(data.id);
  },

  updateSchedule: async (id: string, scheduleData: any): Promise<void> => {
    const dbObj: any = mapScheduleToDb(scheduleData);
    const { error } = await getBrowserSupabase().from("schedules").update(dbObj).eq("id", id);
    if (error) throw error;
  },

  deleteSchedule: async (id: string): Promise<void> => {
    const { error } = await getBrowserSupabase().from("schedules").delete().eq("id", id);
    if (error) throw error;
    try {
      await getBrowserSupabase().rpc("reset_schedules_id_seq");
    } catch (e) {}
  },

  getLeaguePresets: async (): Promise<LeaguePreset[]> => {
    const { data, error } = await getBrowserSupabase().from("tournaments").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => mapLeaguePresetFromDb(row));
  },

  // Full sync: upserts every league preset passed in and deletes any row not present in the list.
  saveLeaguePresets: async (presets: LeaguePreset[]): Promise<void> => {
    const nowIso = new Date().toISOString();
    const rows = presets.map((p: any) => {
      const { id, ...rest } = p;
      return { id: String(id), data: rest, updated_at: nowIso };
    });
    const { error: upsertError } = await getBrowserSupabase().from("tournaments").upsert(rows, { onConflict: "id" });
    if (upsertError) throw upsertError;

    const keepIds = rows.map((r: any) => r.id);
    const { error: deleteError } = await getBrowserSupabase().from("tournaments").delete().not("id", "in", `(${keepIds.join(",")})`);
    if (deleteError) throw deleteError;
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
