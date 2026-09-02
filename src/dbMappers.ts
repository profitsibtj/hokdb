// Pure snake_case-DB <-> camelCase-frontend row mapping, shared verbatim between the browser
// (dataClient.ts, used by the static/GitHub Pages build) and the local dev server (server.ts) -
// previously each kept its own near-identical copy of every function here, which had already
// drifted out of sync once (server.ts's roster mappers were missing secondaryPosition/
// secondary_position entirely). None of this touches the DOM or Node-only APIs, so one copy works
// in both environments.
import { Match, Game, RosterPlayer, ScheduleEntry, LeaguePreset, MatchFormat } from "./types";

export const mapMatchFromDb = (row: any): Match => {
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

export const mapMatchToDb = (data: any) => {
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

export const mapRosterFromDb = (row: any): RosterPlayer => {
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

export const mapRosterToDb = (player: any) => {
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

export const mapScheduleFromDb = (row: any): ScheduleEntry => {
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

export const mapScheduleToDb = (data: any) => {
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
export const mapLeaguePresetFromDb = (row: any): LeaguePreset => {
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
