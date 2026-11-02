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

type TournamentData = Omit<LeaguePreset, "defaultFormat"> & {
  defaultFormat: string;
};

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

async function saveSchedule(match: PreviewMatch): Promise<void> {
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
    ...(existing?.id ? { id: existing.id } : {}),
  };
  if (existing?.id) await clientDb.updateSchedule(existing.id, entry);
  else await clientDb.addSchedule(entry);
}

const productionAdapter = {
  canWrite: false,
  load: loadDatabaseRows,
  signIn: signInWithPassword,
  signInAdmin: signInWithPassword,
  getSession: restoreAccessSession,
  signOut,
  saveSchedule: async (match: PreviewMatch) => {
    await saveSchedule(match);
  },
  saveMatch: async (previewMatch: PreviewMatch) => {
    if (!previewMatch.finished) throw new Error("Only completed matches can be saved as results.");
    const existingMatches = await clientDb.getMatches();
    const existing = existingMatches.find((match) => {
      const sameTeams = (match.teamA === previewMatch.teamA && match.teamB === previewMatch.teamB)
        || (match.teamA === previewMatch.teamB && match.teamB === previewMatch.teamA);
      return match.league === previewMatch.league
        && sameTeams
        && match.stage === previewMatch.stage
        && isoToGmt7Parts(match.scheduledAt || "")?.date === previewMatch.dateISO;
    });
    const match = toMatch(previewMatch);
    if (existing?.id) await clientDb.updateMatch(existing.id, match);
    else await clientDb.addMatch(match);
    await saveSchedule(previewMatch);
  },
  saveRoster: async (player: { name: string; identity: string; role: string; tournament: string; team: string }) => {
    const record: RosterPlayer = {
      name: player.name,
      realName: player.identity,
      position: player.role as RosterPlayer["position"],
      league: player.tournament,
      team: player.team,
    };
    return clientDb.saveRosterPlayer(record);
  },
  deleteRoster: async (id: string) => {
    await clientDb.deleteRosterPlayer(id);
  },
  saveTournaments: async (tournaments: TournamentData[]) => {
    const presets: LeaguePreset[] = tournaments.map((tournament) => ({
      ...tournament,
      defaultFormat: formatMap[tournament.defaultFormat] || "Bo5",
    }));
    await clientDb.saveLeaguePresets(presets);
  },
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
