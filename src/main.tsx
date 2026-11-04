import redesignDocument from "../redesign-preview/index.html?raw";
import "../redesign-preview/styles.css";
import { accessApi, restoreAccessSession, signInWithPassword, signOut } from "./accessClient";
import { clientDb } from "./dataClient";
import { gmt7ToIso, isoToGmt7Parts } from "./utils";
import type { Game, GameObjectives, LeaguePreset, Match, MatchFormat, RosterPlayer, ScheduleEntry } from "./types";

type PreviewPlayer = {
  playerId: string;
  player: string;
  lane: string;
  hero: string;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damage: number;
  damageTaken: number;
  multiKills: Record<number, number>;
  mvp: boolean;
  firstBlood: boolean;
};

type PreviewGame = {
  gameNumber: number;
  winner: string;
  duration: string;
  blueSide: "A" | "B";
  bansA: string[];
  bansB: string[];
  objectivesA: Record<string, number>;
  objectivesB: Record<string, number>;
  playersA: PreviewPlayer[];
  playersB: PreviewPlayer[];
};

type PreviewMatch = {
  league: string;
  teamA: string;
  teamB: string;
  format: string;
  stage: string;
  phase: string;
  dateISO: string;
  time: string;
  streamUrl: string;
  finished: boolean;
  games: PreviewGame[];
};

type TournamentData = Omit<LeaguePreset, "defaultFormat">;

type DatabaseRosterRow = {
  id: string | number;
  league: string;
  team: string;
  name?: string;
  position?: unknown;
  real_name?: string;
  previous_names?: unknown;
};

function isDatabaseRosterRow(value: unknown): value is DatabaseRosterRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (typeof row.id === "string" || typeof row.id === "number")
    && typeof row.league === "string"
    && typeof row.team === "string"
    && (row.name === undefined || typeof row.name === "string")
    && (row.real_name === undefined || typeof row.real_name === "string");
}

function isRosterPosition(value: unknown): value is RosterPlayer["position"] {
  return ["Clash Lane", "Jungle", "Mid Lane", "Farm Lane", "Roam", "Flex", "Substitute", "Coach", "Analyst", "Manager"].includes(String(value));
}

function getRosterPosition(value: unknown): RosterPlayer["position"] {
  if (value === undefined || value === null || value === "") return "Substitute";
  if (!isRosterPosition(value)) throw new Error(`Unsupported roster role in Supabase: ${String(value)}`);
  return value;
}

function getPreviousNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

const formatMap: Record<string, MatchFormat> = {
  BO1: "Bo1",
  BO3: "Bo3",
  BO5: "Bo5",
  BO7: "Bo7",
};

function toObjectives(values: Record<string, number>): GameObjectives {
  return {
    tyrant: values.Tyrant || 0,
    shadowTyrant: values["Shadow Tyrant"] || 0,
    tempest: values.Tempest || 0,
    overlord: values.Overlord || 0,
    shadowOverlord: values["Shadow Overlord"] || 0,
    towers: values.Towers || 0,
  };
}

function toGame(match: PreviewMatch, game: PreviewGame): Game {
  const playerStats = (players: PreviewPlayer[]) => players.map((player) => ({
    playerName: player.player,
    position: player.lane as Game["teamAPlayers"][number]["position"],
    hero: player.hero,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    goldEarned: player.gold,
    heroDamage: player.damage,
    damageTaken: player.damageTaken,
    singleKills: player.multiKills[1] || 0,
    doubleKills: player.multiKills[2] || 0,
    tripleKills: player.multiKills[3] || 0,
    quadraKills: player.multiKills[4] || 0,
    pentaKills: player.multiKills[5] || 0,
    mvp: player.mvp,
    firstBlood: player.firstBlood,
  }));
  return {
    gameNumber: game.gameNumber,
    winner: game.winner === match.teamA ? "A" : game.winner === match.teamB ? "B" : null,
    duration: game.duration,
    blueSide: game.blueSide,
    bansA: game.bansA,
    bansB: game.bansB,
    objectivesA: toObjectives(game.objectivesA),
    objectivesB: toObjectives(game.objectivesB),
    teamAPlayers: playerStats(game.playersA),
    teamBPlayers: playerStats(game.playersB),
  };
}

function toMatch(match: PreviewMatch): Match {
  const scheduledAt = gmt7ToIso(match.dateISO, match.time || "00:00");
  return {
    league: match.league,
    stage: match.stage,
    format: formatMap[match.format] || "Bo1",
    teamA: match.teamA,
    teamB: match.teamB,
    scoreA: 0,
    scoreB: 0,
    scheduledAt,
    liveLink: match.streamUrl,
    isPlayoff: match.phase === "Playoffs",
    games: match.games.map((game) => toGame(match, game)),
  };
}

function toSchedule(match: PreviewMatch, finished: boolean): ScheduleEntry {
  return {
    league: match.league,
    matchCode: match.stage || `${match.teamA} vs ${match.teamB}`,
    teamA: match.teamA,
    teamB: match.teamB,
    format: formatMap[match.format] || "Bo1",
    scheduledAt: gmt7ToIso(match.dateISO, match.time || "00:00"),
    liveLink: match.streamUrl,
    isFinished: finished,
  };
}

async function loadDatabaseRows() {
  return accessApi<{
    matchRows: unknown[];
    scheduleRows: unknown[];
    rosterRows: unknown[];
    tournamentRows: unknown[];
  }>("load");
}

async function saveSchedule(match: PreviewMatch, scheduleId?: string): Promise<void> {
  const existingSchedules = await clientDb.getSchedules();
  const matchDate = match.dateISO;
  const existing = existingSchedules.find((entry) => {
    const sameTeams = (entry.teamA === match.teamA && entry.teamB === match.teamB)
      || (entry.teamA === match.teamB && entry.teamB === match.teamA);
    return entry.league === match.league
      && sameTeams
      && isoToGmt7Parts(entry.scheduledAt)?.date === matchDate;
  });
  const entry = {
    ...toSchedule(match, match.finished),
    ...(scheduleId ? { id: scheduleId } : existing?.id ? { id: existing.id } : {}),
  };
  if (entry.id) await clientDb.updateSchedule(entry.id, entry);
  else await clientDb.addSchedule(entry);
}

const productionAdapter = {
  canWrite: false,
  load: loadDatabaseRows,
  signIn: signInWithPassword,
  signInAdmin: signInWithPassword,
  getSession: restoreAccessSession,
  signOut,
  saveSchedule: async (match: PreviewMatch, id?: string) => {
    const scheduleId = id?.startsWith("db-schedule-") ? id.slice("db-schedule-".length) : undefined;
    await saveSchedule(match, scheduleId);
  },
  saveMatch: async (previewMatch: PreviewMatch, id?: string) => {
    if (!previewMatch.finished) throw new Error("Only completed matches can be saved as results.");
    const existingMatches = await clientDb.getMatches();
    const matchIdFromKey = id?.startsWith("db-match-") ? id.slice("db-match-".length) : undefined;
    const existing = matchIdFromKey
      ? existingMatches.find((match) => match.id === matchIdFromKey)
      : existingMatches.find((match) => {
      const sameTeams = (match.teamA === previewMatch.teamA && match.teamB === previewMatch.teamB)
        || (match.teamA === previewMatch.teamB && match.teamB === previewMatch.teamA);
      return match.league === previewMatch.league
        && sameTeams
        && match.stage === previewMatch.stage
        && isoToGmt7Parts(match.scheduledAt || "")?.date === previewMatch.dateISO;
    });
    if (matchIdFromKey && !existing) throw new Error("The match being edited no longer exists in Supabase.");
    const match = toMatch(previewMatch);
    const matchId = existing?.id;
    if (matchId) await clientDb.updateMatch(matchId, match);
    else await clientDb.addMatch(match);
    const schedules = await clientDb.getSchedules();
    const scheduleIdFromKey = id?.startsWith("db-schedule-") ? id.slice("db-schedule-".length) : undefined;
    const oldSchedule = scheduleIdFromKey
      ? schedules.find((schedule) => schedule.id === scheduleIdFromKey)
      : existing && schedules.find((schedule) => {
        const sameTeams = (schedule.teamA === existing.teamA && schedule.teamB === existing.teamB)
          || (schedule.teamA === existing.teamB && schedule.teamB === existing.teamA);
        return schedule.league === existing.league
          && sameTeams
          && isoToGmt7Parts(schedule.scheduledAt)?.date === isoToGmt7Parts(existing.scheduledAt || "")?.date;
      });
    await saveSchedule(previewMatch, oldSchedule?.id);
  },
  saveRoster: async (player: { id?: string; name: string; identity: string; role: string; tournament: string; team: string }) => {
    if (!isRosterPosition(player.role)) throw new Error(`Unsupported roster role: ${player.role}`);
    const record: RosterPlayer = {
      ...(player.id ? { id: player.id } : {}),
      name: player.name,
      realName: player.identity,
      position: player.role,
      league: player.tournament,
      team: player.team,
    };
    return clientDb.saveRosterPlayer(record);
  },
  deleteRoster: async (id: string) => {
    await clientDb.deleteRosterPlayer(id);
  },
  renameTeam: async (tournament: string, oldName: string, newName: string) => {
    const rows = await loadDatabaseRows();
    const rosterPlayers = rows.rosterRows.filter((row): row is DatabaseRosterRow => isDatabaseRosterRow(row)
      && row.league === tournament && row.team === oldName);
    for (const row of rosterPlayers) {
      await clientDb.saveRosterPlayer({
        id: String(row.id),
        name: row.name || "",
        position: getRosterPosition(row.position),
        team: newName,
        league: tournament,
        realName: row.real_name || "",
        previousNames: getPreviousNames(row.previous_names),
      });
    }

    const matches = await clientDb.getMatches();
    for (const match of matches) {
      if (match.league !== tournament || (match.teamA !== oldName && match.teamB !== oldName)) continue;
      if (match.teamA === oldName) match.teamA = newName;
      if (match.teamB === oldName) match.teamB = newName;
      if (match.winner === oldName) match.winner = newName;
      if (match.id) await clientDb.updateMatch(match.id, match);
    }

    const schedules = await clientDb.getSchedules();
    for (const schedule of schedules) {
      if (schedule.league !== tournament || (schedule.teamA !== oldName && schedule.teamB !== oldName)) continue;
      if (schedule.teamA === oldName) schedule.teamA = newName;
      if (schedule.teamB === oldName) schedule.teamB = newName;
      if (schedule.id) await clientDb.updateSchedule(schedule.id, schedule);
    }
  },
  saveTournaments: async (tournaments: TournamentData[]) => clientDb.saveLeaguePresets(tournaments),
};

async function startRedesign() {
  const parsed = new DOMParser().parseFromString(redesignDocument, "text/html");
  parsed.querySelector('link[href="./styles.css"]')?.remove();
  parsed.querySelectorAll("script").forEach((script) => script.remove());
  document.body.replaceWith(parsed.body.cloneNode(true));

  const { configureProduction } = await import("../redesign-preview/app.js");
  configureProduction(productionAdapter);
}

void startRedesign();
