import type { Game, LeaguePreset, Match, MatchFormat, RosterPlayer, ScheduleEntry } from "./types";
import { accessApi } from "./accessClient";

const mapMatchFromDb = (row: any): Match => ({
  id: String(row.id),
  league: row.league || "",
  stage: row.stage || "",
  format: row.format || "Bo1",
  teamA: row.team_a || "",
  teamB: row.team_b || "",
  scoreA: 0,
  scoreB: 0,
  scheduledAt: row.scheduled_at || "",
  liveLink: row.live_link || "",
  isPlayoff: !!row.is_playoff,
  games: row.games || [],
});

const mapMatchToDb = (data: Match) => ({
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
  is_playoff: !!data.isPlayoff,
  is_finished: !!data.isFinished,
  games: data.games || [],
});

const mapRosterToDb = (player: RosterPlayer) => ({
  name: player.name || "",
  position: player.position || null,
  team: player.team || null,
  league: player.league || null,
  previous_names: player.previousNames || [],
  real_name: player.realName || null,
});

const mapScheduleFromDb = (row: any): ScheduleEntry => ({
  id: String(row.id),
  league: row.league || "",
  matchCode: row.match_code || "",
  teamA: row.team_a || "",
  teamB: row.team_b || "",
  format: row.format || "Bo1",
  scheduledAt: row.scheduled_at || "",
  liveLink: row.live_link || "",
  isFinished: !!row.is_finished,
});

const mapScheduleToDb = (data: ScheduleEntry) => ({
  league: data.league || null,
  match_code: data.matchCode || null,
  team_a: data.teamA || null,
  team_b: data.teamB || null,
  format: data.format || null,
  scheduled_at: data.scheduledAt || null,
  live_link: data.liveLink || null,
  is_finished: !!data.isFinished,
});

const requiredWins: Record<MatchFormat, number> = { Bo1: 1, Bo3: 2, Bo5: 3, Bo7: 4 };

const formatMatchData = (match: Match): Match => {
  const games: Game[] = match.games || [];
  const scoreA = games.filter((game) => game.winner === "A").length;
  const scoreB = games.filter((game) => game.winner === "B").length;
  const winsNeeded = requiredWins[match.format] || 1;
  const winner = scoreA >= winsNeeded ? match.teamA : scoreB >= winsNeeded ? match.teamB : undefined;
  return { ...match, games, scoreA, scoreB, winner, isFinished: !!winner };
};

export const clientDb = {
  getMatches: async (): Promise<Match[]> => {
    const rows = await accessApi<unknown[]>("list_matches");
    return rows.map((row) => formatMatchData(mapMatchFromDb(row)));
  },

  addMatch: async (match: Match): Promise<string> => {
    const id = await accessApi<number>("save_match", {
      row: mapMatchToDb(formatMatchData(match)),
    });
    return String(id);
  },

  updateMatch: async (id: string, match: Match): Promise<void> => {
    await accessApi("save_match", {
      id,
      row: mapMatchToDb(formatMatchData(match)),
    });
  },

  deleteMatch: async (id: string): Promise<void> => {
    await accessApi("delete_match", { id });
  },

  saveRosterPlayer: async (player: RosterPlayer): Promise<string> => {
    const id = await accessApi<number>("save_roster", {
      ...(player.id ? { id: player.id } : {}),
      row: mapRosterToDb(player),
    });
    return String(id);
  },

  deleteRosterPlayer: async (id: string): Promise<void> => {
    await accessApi("delete_roster", { id });
  },

  getSchedules: async (): Promise<ScheduleEntry[]> => {
    const rows = await accessApi<unknown[]>("list_schedules");
    return rows.map(mapScheduleFromDb);
  },

  addSchedule: async (schedule: ScheduleEntry): Promise<string> => {
    const id = await accessApi<number>("save_schedule", {
      row: mapScheduleToDb(schedule),
    });
    return String(id);
  },

  updateSchedule: async (id: string, schedule: ScheduleEntry): Promise<void> => {
    await accessApi("save_schedule", {
      id,
      row: mapScheduleToDb(schedule),
    });
  },

  deleteSchedule: async (id: string): Promise<void> => {
    await accessApi("delete_schedule", { id });
  },

  saveLeaguePresets: async (presets: LeaguePreset[]): Promise<void> => {
    const rows = presets.map(({ id, ...data }) => ({ id: String(id), data }));
    await accessApi("sync_tournaments", { rows });
  },
};
