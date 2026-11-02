import type { Game, Match, MatchFormat, RosterPlayer, ScheduleEntry } from "./types";

export const mapMatchFromDb = (row: any): Match => ({
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
});

export const mapMatchToDb = (data: Match) => ({
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
});

export const mapRosterToDb = (player: RosterPlayer) => ({
  name: player.name || "",
  position: player.position || null,
  secondary_position: player.secondaryPosition || null,
  team: player.team || null,
  league: player.league || null,
  previous_names: player.previousNames || [],
  real_name: player.realName || null,
});

export const mapScheduleFromDb = (row: any): ScheduleEntry => ({
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
});

export const mapScheduleToDb = (data: ScheduleEntry) => ({
  league: data.league || null,
  match_code: data.matchCode || null,
  team_a: data.teamA || null,
  team_b: data.teamB || null,
  format: data.format || null,
  scheduled_at: data.scheduledAt || null,
  live_link: data.liveLink || null,
  is_finished: !!data.isFinished,
});

const REQUIRED_WINS: Record<MatchFormat, number> = { Bo1: 1, Bo3: 2, Bo5: 3, Bo7: 4 };

export const formatMatchData = (match: Match): Match => {
  const games: Game[] = match.games || [];
  const scoreA = games.filter((game) => game.winner === "A").length;
  const scoreB = games.filter((game) => game.winner === "B").length;
  const requiredWins = REQUIRED_WINS[match.format] || 1;
  const winner = scoreA >= requiredWins ? match.teamA : scoreB >= requiredWins ? match.teamB : undefined;
  return { ...match, games, scoreA, scoreB, winner, isFinished: !!winner };
};
