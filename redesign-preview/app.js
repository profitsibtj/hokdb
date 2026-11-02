const pageLabels = {
  matches: "Matches",
  tournaments: "Tournaments",
  standings: "Standings",
  players: "Player stats",
  roster: "Roster",
  compare: "Head to head",
  awards: "Achievements",
};

const pageContent = document.querySelector("#page-content");
const startingContent = pageContent.innerHTML;
const navItems = [...document.querySelectorAll(".nav-item")];
const modal = document.querySelector("#match-modal");
const adminAccessModal = document.querySelector("#admin-access-modal");
const detailModal = document.querySelector("#detail-modal");
const appShell = document.querySelector("#app-shell");
const accessGate = document.querySelector("#access-gate");
const toast = document.querySelector("#toast");
const databaseModal = document.querySelector("#database-modal");
const databaseStatus = document.querySelector("#database-status");
const databaseConnectionError = document.querySelector("#database-connect-error");
let previewViewerPassword = "viewer-preview";
let previewAdminPassword = "admin-preview";
const databaseSessionKey = "hokdb_redesign_supabase_session_v2";
let productionDatabaseAdapter = null;
let productionMode = false;
let toastTimeout;
let hasAdminAccess = false;
let currentDetailMatchId = "";
const collapsedGames = new Set();
let currentEntryGame = 1;
let entryGameDrafts = [];
let pendingAdminAction = null;
let leagueTeams = {
  "Honor of Kings Indonesia League": ["Alter Ego", "Bigetron Esports", "EVOS", "ONIC Esports", "RRQ"],
  "Honor of Kings Invitational": ["Bigetron Esports", "EVOS", "RRQ", "Team RRQ"],
};
let tournamentSettings = {
  "Honor of Kings Indonesia League": {
    format: "BO5",
    globalBanPick: false,
    participants: [
      { team: "Alter Ego", abbreviation: "AE", route: "Invited" },
      { team: "Bigetron Esports", abbreviation: "BTR", route: "Invited" },
      { team: "EVOS", abbreviation: "EVOS", route: "Closed Qualifier" },
      { team: "ONIC Esports", abbreviation: "ONIC", route: "Open Qualifier" },
      { team: "RRQ", abbreviation: "RRQ", route: "Invited" },
    ],
  },
  "Honor of Kings Invitational": {
    format: "BO5",
    globalBanPick: true,
    participants: [
      { team: "Bigetron Esports", abbreviation: "BTR", route: "Invited" },
      { team: "EVOS", abbreviation: "EVOS", route: "Wildcard" },
      { team: "RRQ", abbreviation: "RRQ", route: "Invited" },
      { team: "Team RRQ", abbreviation: "TR", route: "Open Qualifier" },
    ],
  },
};
const teamRosters = new Map();
let sampleTournamentNames = new Set(["Honor of Kings Indonesia League", "Honor of Kings Invitational"]);
const qualificationRoutes = ["Open Qualifier", "Invited", "Wildcard", "Closed Qualifier", "Group Stage"];

const lanes = ["Clash Lane", "Jungle", "Mid Lane", "Farm Lane", "Roam"];
const playerNames = {
  "Alter Ego": ["Pai", "Nino", "YukTzy", "Celiboy", "Rasy"],
  RRQ: ["Rinz", "Xyve", "Idok", "Sionz", "Vyn"],
  "ONIC Esports": ["Kairi", "CW", "Sanz", "Butsss", " Kiboy"],
  EVOS: ["Tazz", "DreamS", "Cr1te", "Branz", "Dream"],
  "Bigetron Esports": ["Super Kenn", "Kyy", "Moreno", "Vaanstrong", "Falah"],
  "Team RRQ": ["Rinz", "Xyve", "Idok", "Sionz", "Vyn"],
};
const heroDrafts = [
  [["Dharma", "Lam", "Lady Zhen", "Marco Polo", "Zhang Fei"], ["Biron", "Augran", "Mai Shiranui", "Loong", "Da Qiao"]],
  [["Dolia", "Jing", "Angela", "Hou Yi", "Kui"], ["Sun Ce", "Pei", "Gan & Mo", "Consort Yu", "Guiguzi"]],
  [["Allain", "Musashi", "Shangguan", "Luban No. 7", "Donghuang"], ["Charlotte", "Lam", "Daji", "Arli", "Liu Shan"]],
  [["Mayene", "Nakoruru", "Shangguan", "Garo", "Dyadia"], ["Biron", "Augran", "Lady Zhen", "Loong", "Zhang Fei"]],
  [["Li Xin", "Jing", "Angela", "Marco Polo", "Dolia"], ["Dharma", "Pei", "Mai Shiranui", "Arli", "Kui"]],
];
const heroOptions = [...new Set([
  ...heroDrafts.flat(2),
  "Arthur", "Bian Que", "Cai Wenji", "Diao Chan", "Erin", "Gongsun Li", "Han Xin",
  "Li Bai", "Lu Bu", "Luna", "Mulan", "Mozi", "Nezha", "Sun Bin", "Wukong",
  "Xiang Yu", "Ying", "Yuhuan", "Zhuang Zhou", "Zilong", "Dun", "Huang Zhong",
  "Liu Bang", "Zhou Yu", "Dian Wei", "Xiahou Dun", "Lady Sun", "Ming", "Sima Yi",
  "Zhang Liang", "Zhang Fei", "Donghuang", "Yaria", "Lam", "Dolia", "Augran",
])].sort();
const statLinesA = [[3, 1, 7, 11200, 18500, 12100], [7, 2, 9, 14300, 25800, 9700], [5, 2, 8, 13100, 22800, 10500], [4, 1, 10, 12400, 17600, 16200], [1, 3, 13, 9300, 9800, 20400]];
const statLinesB = [[2, 3, 4, 10500, 14200, 15800], [4, 4, 5, 11900, 19300, 13800], [3, 3, 5, 11700, 20100, 11900], [4, 4, 3, 12600, 21100, 11700], [1, 6, 8, 9000, 8800, 23800]];

function createPlayers(tournament, team, heroes, gameNumber, side, isWinner) {
  const statLines = side === "A" ? statLinesA : statLinesB;
  return lanes.map((lane, index) => {
    const [baseKills, deaths, assists, gold, damage, damageTaken] = statLines[index];
    const offset = gameNumber - 1;
    const rosterMember = getTeamRoster(tournament, team).find((player) => player.role === lane)
      || getTeamRoster(tournament, team)[index]
      || { id: `${rosterKey(tournament, team)}|${index}`, name: playerNames[team]?.[index]?.trim() || `${team} Player ${index + 1}` };
    return {
      playerId: rosterMember.id,
      lane,
      player: rosterMember.name,
      hero: heroes[index],
      kills: Math.max(0, baseKills + (offset % 2)),
      deaths: Math.max(0, deaths + ((offset + index) % 2)),
      assists: assists + (offset % 3),
      gold: gold + offset * 230,
      damage: damage + offset * 740,
      damageTaken: damageTaken + offset * 380,
      multiKills: { 1: index === 1 ? 1 : 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      firstBlood: gameNumber === 1 && side === "A" && index === 1,
      mvp: isWinner && index === (side === "A" ? (gameNumber - 1) % 5 : (gameNumber + 1) % 5),
    };
  });
}

function calculatePlayerKp(players, player) {
  const teamKills = players.reduce((total, entry) => total + (Number(entry.kills) || 0), 0);
  return teamKills ? Math.round(((Number(player.kills) + Number(player.assists)) / teamKills) * 100) : 0;
}

function createGame(tournament, teamA, teamB, gameNumber, winner, picks) {
  const [heroesA, heroesB] = picks;
  const winnerIsA = winner === teamA;
  const objectivesA = { Tyrant: winnerIsA ? 2 : 1, "Shadow Tyrant": winnerIsA ? 1 : 0, Overlord: winnerIsA ? 1 : 0, Towers: winnerIsA ? 7 : 4 };
  const objectivesB = { Tyrant: winnerIsA ? 1 : 2, "Shadow Tyrant": winnerIsA ? 0 : 1, Overlord: winnerIsA ? 0 : 1, Towers: winnerIsA ? 4 : 7 };
  return {
    gameNumber,
    winner,
    scoreA: winnerIsA ? 1 : 0,
    scoreB: winnerIsA ? 0 : 1,
    duration: ["18:42", "21:16", "16:53", "23:08", "19:37"][(gameNumber - 1) % 5],
    blueSide: gameNumber % 2 === 1 ? "A" : "B",
    bansA: ["Augran", "Loong", "Yaria", "Lam"],
    bansB: ["Dolia", "Jing", "Lady Zhen", "Marco Polo"],
    objectivesA,
    objectivesB,
    playersA: createPlayers(tournament, teamA, heroesA, gameNumber, "A", winnerIsA),
    playersB: createPlayers(tournament, teamB, heroesB, gameNumber, "B", !winnerIsA),
  };
}

function createSeries(tournament, teamA, teamB, winners) {
  return winners.map((winner, index) => createGame(tournament, teamA, teamB, index + 1, winner, heroDrafts[index]));
}

let matchDetails = {
  "ae-rrq": {
    league: "Honor of Kings Indonesia League", teamA: "Alter Ego", teamB: "RRQ", scoreA: 3, scoreB: 1, format: "BO5",
    stage: "Upper Bracket", date: "Sunday, Oct 25, 2026 · 7:30 PM WIB", finished: true,
    phase: "Playoffs", tournamentId: "Honor of Kings Indonesia League", streamUrl: "",
    games: createSeries("Honor of Kings Indonesia League", "Alter Ego", "RRQ", ["Alter Ego", "RRQ", "Alter Ego", "Alter Ego"]),
  },
  "onic-evos": {
    league: "Honor of Kings Indonesia League", teamA: "ONIC Esports", teamB: "EVOS", scoreA: 2, scoreB: 3, format: "BO5",
    stage: "Lower Bracket", date: "Saturday, Oct 24, 2026 · 4:00 PM WIB", finished: true,
    phase: "Playoffs", tournamentId: "Honor of Kings Indonesia League", streamUrl: "",
    games: createSeries("Honor of Kings Indonesia League", "ONIC Esports", "EVOS", ["ONIC Esports", "EVOS", "ONIC Esports", "EVOS", "EVOS"]),
  },
  "btr-rrq": {
    league: "Honor of Kings Invitational", teamA: "Bigetron Esports", teamB: "RRQ", scoreA: 3, scoreB: 2, format: "BO5",
    stage: "Quarterfinal", date: "Friday, Oct 23, 2026 · 8:00 PM WIB", finished: true,
    phase: "Playoffs", tournamentId: "Honor of Kings Invitational", streamUrl: "",
    games: createSeries("Honor of Kings Invitational", "Bigetron Esports", "RRQ", ["Bigetron Esports", "RRQ", "RRQ", "Bigetron Esports", "Bigetron Esports"]),
  },
  "ae-btr": {
    league: "Honor of Kings Indonesia League", teamA: "Alter Ego", teamB: "Bigetron Esports", format: "BO5", stage: "Grand Final",
    date: "Saturday, Oct 31, 2026 · 7:00 PM WIB", dateISO: "2026-10-31", time: "19.00", phase: "Playoffs", finished: false,
  },
  "rrq-onic": {
    league: "Honor of Kings Indonesia League", teamA: "RRQ", teamB: "ONIC Esports", format: "BO3", stage: "Lower Bracket",
    date: "Sunday, Nov 1, 2026 · 4:00 PM WIB", dateISO: "2026-11-01", time: "16.00", phase: "Playoffs", finished: false,
  },
  "evos-rrq": {
    league: "Honor of Kings Invitational", teamA: "EVOS", teamB: "Team RRQ", format: "BO3", stage: "Upper Bracket",
    date: "Monday, Nov 2, 2026 · 7:00 PM WIB", dateISO: "2026-11-02", time: "19.00", phase: "Group Stage", finished: false,
  },
};

let leagueOptions = Object.keys(leagueTeams);
let liveDataMode = false;
let activePage = "matches";

function rosterKey(tournament, team) {
  return `${tournament}|${team}`;
}

function getTeamRoster(tournament, team) {
  const key = rosterKey(tournament, team);
  if (!teamRosters.has(key)) {
    const players = sampleTournamentNames.has(tournament) ? (playerNames[team] || []) : [];
    teamRosters.set(key, players.map((name, index) => ({
      id: `${key}|${index}|${name}`,
      name: name.trim(),
      role: lanes[index] || "Substitute",
    })));
  }
  return teamRosters.get(key);
}

function formatDatabaseDate(value, includeTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dateText = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Jakarta"
  }).format(date);
  if (!includeTime) return dateText;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "Asia/Jakarta"
  }).format(date);
}

function normalizeMatchFormat(format) {
  const normalized = String(format || "BO1").replace(/\s/g, "").toUpperCase();
  return ["BO1", "BO3", "BO5", "BO7"].includes(normalized) ? normalized : "BO1";
}

function mapDatabaseGame(rawGame, match, index, rosterByTeam) {
  const game = typeof rawGame === "string" ? JSON.parse(rawGame) : rawGame;
  const gameWinner = game.winner === "A" ? match.teamA : game.winner === "B" ? match.teamB : game.winner || "";
  const mapPlayers = (entries, side) => (Array.isArray(entries) ? entries : []).map((player, playerIndex) => {
    const rosterMember = rosterByTeam.get(rosterKey(match.league, side === "A" ? match.teamA : match.teamB))
      ?.find((member) => member.name === player.playerName);
    return {
      playerId: rosterMember?.id || "",
      player: player.playerName || "Unknown player",
      lane: player.position || lanes[playerIndex],
      hero: player.hero || "—",
      kills: Number(player.kills) || 0,
      deaths: Number(player.deaths) || 0,
      assists: Number(player.assists) || 0,
      gold: Number(player.goldEarned) || 0,
      damage: Number(player.heroDamage) || 0,
      damageTaken: Number(player.damageTaken) || 0,
      multiKills: {
        1: Number(player.singleKills) || 0,
        2: Number(player.doubleKills) || 0,
        3: Number(player.tripleKills) || 0,
        4: Number(player.quadraKills) || 0,
        5: Number(player.pentaKills) || 0,
      },
      mvp: !!player.mvp,
      firstBlood: !!player.firstBlood,
    };
  });
  const objectives = (values = {}) => ({
    Tyrant: Number(values.tyrant) || 0,
    "Shadow Tyrant": Number(values.shadowTyrant) || 0,
    Tempest: Number(values.tempest) || 0,
    Overlord: Number(values.overlord) || 0,
    "Shadow Overlord": Number(values.shadowOverlord) || 0,
    Towers: Number(values.towers) || 0,
  });
  return {
    gameNumber: Number(game.gameNumber) || index + 1,
    winner: gameWinner,
    scoreA: gameWinner === match.teamA ? 1 : 0,
    scoreB: gameWinner === match.teamB ? 1 : 0,
    duration: game.duration || "—",
    blueSide: game.blueSide || "A",
    bansA: Array.isArray(game.bansA) ? game.bansA : [],
    bansB: Array.isArray(game.bansB) ? game.bansB : [],
    objectivesA: objectives(game.objectivesA),
    objectivesB: objectives(game.objectivesB),
    playersA: mapPlayers(game.teamAPlayers, "A"),
    playersB: mapPlayers(game.teamBPlayers, "B"),
  };
}

function mapDatabaseMatch(row, rosterByTeam) {
  const scheduledAt = row.scheduled_at || "";
  const match = {
    league: row.league || "Unassigned tournament",
    teamA: row.team_a || "Team A",
    teamB: row.team_b || "Team B",
    scoreA: Number(row.score_a) || 0,
    scoreB: Number(row.score_b) || 0,
    format: normalizeMatchFormat(row.format),
    stage: row.stage || "Match",
    phase: row.is_playoff ? "Playoffs" : "Group Stage",
    date: formatDatabaseDate(scheduledAt),
    dateISO: scheduledAt ? new Date(scheduledAt).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) : "",
    time: formatDatabaseDate(scheduledAt, true),
    streamUrl: row.live_link || "",
    status: row.is_finished ? "Completed" : "Scheduled",
    finished: !!row.is_finished,
    globalBanPick: false,
    games: [],
  };
  const games = Array.isArray(row.games) ? row.games : typeof row.games === "string" ? JSON.parse(row.games) : [];
  match.games = games.map((game, index) => mapDatabaseGame(game, match, index, rosterByTeam));
  if (match.games.length) {
    match.scoreA = match.games.filter((game) => game.winner === match.teamA).length;
    match.scoreB = match.games.filter((game) => game.winner === match.teamB).length;
  }
  const id = `db-match-${row.id}`;
  return [id, match];
}

function mapDatabaseSchedule(row) {
  const scheduledAt = row.scheduled_at || "";
  const date = scheduledAt ? new Date(scheduledAt) : null;
  return {
    league: row.league || "Unassigned tournament",
    teamA: row.team_a || "Team A",
    teamB: row.team_b || "Team B",
    format: normalizeMatchFormat(row.format),
    stage: row.match_code || "Scheduled match",
    phase: "Stage",
    date: formatDatabaseDate(scheduledAt),
    dateISO: date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) : "",
    time: formatDatabaseDate(scheduledAt, true),
    streamUrl: row.live_link || "",
    status: "Scheduled",
    finished: false,
    games: [],
  };
}

function getMatchIdentity(match) {
  const teams = [match.teamA.trim().toLowerCase(), match.teamB.trim().toLowerCase()].sort();
  return `${match.league.trim().toLowerCase()}|${teams.join("|")}|${match.dateISO}`;
}

async function fetchDatabaseTable(projectUrl, anonKey, accessToken, table) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(`${projectUrl}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(`${table}: ${body.message || body.error || `HTTP ${response.status}`}`);
    }
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`${table}: unexpected response from Supabase.`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function applyDatabaseRows({ matchRows, scheduleRows, rosterRows, tournamentRows }) {
  const nextRosters = new Map();
  rosterRows.forEach((row) => {
    const tournament = row.league || "Unassigned tournament";
    const team = row.team || "Unassigned team";
    const key = rosterKey(tournament, team);
    const members = nextRosters.get(key) || [];
    members.push({
      id: String(row.id),
      name: row.name || "Unknown player",
      role: row.position || "Substitute",
      identity: row.real_name || "",
      secondaryRole: row.secondary_position || "",
    });
    nextRosters.set(key, members);
  });
  const nextMatches = Object.fromEntries(matchRows.map((row) => mapDatabaseMatch(row, nextRosters)));
  const recordedMatchIdentities = new Set(Object.values(nextMatches).map(getMatchIdentity));
  scheduleRows.filter((row) => !row.is_finished).forEach((row) => {
    const schedule = mapDatabaseSchedule(row);
    if (!recordedMatchIdentities.has(getMatchIdentity(schedule))) {
      nextMatches[`db-schedule-${row.id}`] = schedule;
      recordedMatchIdentities.add(getMatchIdentity(schedule));
    }
  });

  const nextSettings = {};
  tournamentRows.forEach((row) => {
    const data = row.data && typeof row.data === "object" ? row.data : {};
    const name = data.name || row.id;
    const teams = String(data.teamsText || "").split("\n").map((team) => team.trim()).filter(Boolean);
    const participants = teams.map((team) => ({
      team,
      abbreviation: data.teamAbbreviations?.[team] || team.slice(0, 3).toUpperCase(),
      route: data.teamQualifications?.[team] || "",
    }));
    nextSettings[name] = {
      id: String(row.id),
      rawData: data,
      format: normalizeMatchFormat(data.defaultFormat),
      globalBanPick: !!(data.globalBanPick ?? data.fearlessDraft),
      participants,
    };
  });
  Object.values(nextMatches).forEach((match) => {
    if (!nextSettings[match.league]) {
      nextSettings[match.league] = { format: match.format, globalBanPick: false, participants: [] };
    }
    const participants = nextSettings[match.league].participants;
    [match.teamA, match.teamB].forEach((team) => {
      if (team && !participants.some((participant) => participant.team === team)) {
        participants.push({ team, abbreviation: team.slice(0, 3).toUpperCase(), route: "" });
      }
    });
  });
  nextRosters.forEach((_, key) => {
    const separator = key.indexOf("|");
    const league = key.slice(0, separator);
    const team = key.slice(separator + 1);
    if (!nextSettings[league]) nextSettings[league] = { format: "BO5", globalBanPick: false, participants: [] };
    if (!nextSettings[league].participants.some((participant) => participant.team === team)) {
      nextSettings[league].participants.push({ team, abbreviation: team.slice(0, 3).toUpperCase(), route: "" });
    }
  });
  return { matches: nextMatches, rosters: nextRosters, settings: nextSettings };
}

async function loadDatabaseSnapshot(projectUrl, anonKey, accessToken) {
  const [matchRows, scheduleRows, rosterRows, tournamentRows] = await Promise.all([
    fetchDatabaseTable(projectUrl, anonKey, accessToken, "matches"),
    fetchDatabaseTable(projectUrl, anonKey, accessToken, "schedules"),
    fetchDatabaseTable(projectUrl, anonKey, accessToken, "roster"),
    fetchDatabaseTable(projectUrl, anonKey, accessToken, "tournaments"),
  ]);
  return applyDatabaseRows({ matchRows, scheduleRows, rosterRows, tournamentRows });
}

async function refreshProductionData() {
  if (!productionDatabaseAdapter) return;
  const rows = await productionDatabaseAdapter.load();
  const snapshot = applyDatabaseRows(rows);
  matchDetails = snapshot.matches;
  teamRosters.clear();
  snapshot.rosters.forEach((members, key) => teamRosters.set(key, members));
  tournamentSettings = snapshot.settings;
  leagueTeams = Object.fromEntries(Object.entries(snapshot.settings).map(([league, config]) => [
    league, config.participants.map((participant) => participant.team)
  ]));
  sampleTournamentNames = new Set();
  leagueOptions = Object.keys(tournamentSettings);
  liveDataMode = true;
  hasAdminAccess = !!productionDatabaseAdapter.canWrite;
  document.querySelector("#role-indicator").textContent = hasAdminAccess ? "Admin mode" : "Viewer mode";
  updateDatabaseStatus(true, `Supabase · ${Object.keys(matchDetails).length} records · ${hasAdminAccess ? "admin access" : "read only"}`);
  setPage(activePage);
}

export function configureProduction(adapter) {
  document.title = "HOK Database · Level Up Indonesia";
  productionDatabaseAdapter = adapter;
  productionMode = true;
  previewViewerPassword = "";
  previewAdminPassword = "";
  document.querySelector("#access-preview-note")?.remove();
  document.querySelector("#admin-preview-note")?.remove();
  document.querySelector("#access-form label[for='access-password']").textContent = "Viewer or admin password";
  document.querySelector("#access-gate .access-panel > p:not(.eyebrow)").textContent = "Enter the viewer password to browse, or the admin password to unlock match input and editing.";
  document.querySelector("#access-password").focus();
  document.querySelector("#connect-database-button").hidden = true;
  document.querySelector("#continue-to-entry").textContent = "Save scheduled match →";
  document.querySelector("#save-match-button").textContent = "Save completed match →";
  const notice = document.querySelector("#database-status");
  notice.innerHTML = '<span>SUPABASE · LIVE</span> Sign in to load current database records';
  restoreProductionSession();
}

async function restoreProductionSession() {
  try {
    const session = await productionDatabaseAdapter.getSession();
    if (!session) return;
    productionDatabaseAdapter.canWrite = session.isAdmin;
    await refreshProductionData();
    accessGate.hidden = true;
    appShell.hidden = false;
  } catch (error) {
    const accessError = document.querySelector("#access-error");
    accessError.textContent = `Could not restore Supabase session: ${error.message}`;
    accessError.hidden = false;
  }
}

function isReadOnlyDatabase() {
  return liveDataMode && (!productionDatabaseAdapter || !productionDatabaseAdapter.canWrite);
}

function getTournamentPayload() {
  return leagueOptions.map((name) => {
    const config = tournamentSettings[name];
    const abbreviations = {};
    const qualifications = {};
    config.participants.forEach((participant) => {
      abbreviations[participant.team] = participant.abbreviation;
      qualifications[participant.team] = participant.route;
    });
    return {
      ...(config.rawData || {}),
      id: config.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name,
      defaultFormat: config.format,
      fearlessDraft: !!config.globalBanPick,
      teamsText: config.participants.map((participant) => participant.team).join("\n"),
      teamAbbreviations: abbreviations,
      teamQualifications: qualifications,
    };
  });
}

async function persistTournamentChanges() {
  if (!productionDatabaseAdapter?.canWrite) return;
  await productionDatabaseAdapter.saveTournaments(getTournamentPayload());
}

async function finishDatabaseWrite(successMessage) {
  try {
    await refreshProductionData();
    showToast(successMessage);
  } catch (error) {
    showToast(`Saved, but refreshing Supabase failed: ${error.message}`);
  }
}

async function showDatabaseWriteError(scope, error) {
  showToast(`${scope} was not saved: ${error.message}`);
  try {
    await refreshProductionData();
  } catch (refreshError) {
    showToast(`Could not reload Supabase after the failed save: ${refreshError.message}`);
  }
}

function validatePublicAnonKey(key) {
  if (key.startsWith("sb_secret_")) throw new Error("A secret/service_role key is not allowed. Use the public anon or publishable key.");
  const tokenPart = key.split(".")[1];
  if (!tokenPart) return;
  try {
    const normalized = tokenPart.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    if (payload.role === "service_role") {
      throw new Error("A service_role key is not allowed. Use the public anon or publishable key.");
    }
  } catch (error) {
    if (error.message.includes("service_role")) throw error;
  }
}

function updateDatabaseStatus(connected, message) {
  databaseStatus.classList.toggle("connected", connected);
  const dataMode = productionMode
    ? (productionDatabaseAdapter?.canWrite ? "ADMIN ACCESS" : "READ ONLY")
    : "READ ONLY";
  document.querySelector(".preview-notice").innerHTML = connected
    ? `<span>LIVE DATA · ${dataMode}</span> ${escapeHTML(message)}`
    : `<span>UI CONCEPT</span> ${escapeHTML(message === "Connection failed · sample data" ? message : "Sample data · Preview only")}`;
  document.querySelector("#connect-database-button").textContent = connected ? "Refresh" : "Connect Supabase";
}

async function connectToDatabase(projectUrl, anonKey, credentials) {
  const normalizedUrl = projectUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalizedUrl)) {
    throw new Error("Enter a valid https://<project>.supabase.co URL.");
  }
  const publicKey = anonKey.trim();
  if (!publicKey) throw new Error("Enter the project's public anon key.");
  validatePublicAnonKey(publicKey);
  let session = credentials?.accessToken ? credentials : null;
  if (!session) {
    const response = await fetch(`${normalizedUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: publicKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: credentials.email.trim(), password: credentials.password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      throw new Error(result.msg || result.message || result.error_description || `Supabase sign-in failed (HTTP ${response.status}).`);
    }
    session = { accessToken: result.access_token, refreshToken: result.refresh_token };
  }
  let snapshot;
  try {
    snapshot = await loadDatabaseSnapshot(normalizedUrl, publicKey, session.accessToken);
  } catch (error) {
    if (!session.refreshToken || !error.message.includes("HTTP 401")) throw error;
    const response = await fetch(`${normalizedUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: publicKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      throw new Error(result.msg || result.message || result.error_description || `Supabase session refresh failed (HTTP ${response.status}).`);
    }
    session = { accessToken: result.access_token, refreshToken: result.refresh_token };
    snapshot = await loadDatabaseSnapshot(normalizedUrl, publicKey, session.accessToken);
  }
  sessionStorage.setItem(databaseSessionKey, JSON.stringify({
    url: normalizedUrl,
    anonKey: publicKey,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  }));
  matchDetails = snapshot.matches;
  teamRosters.clear();
  snapshot.rosters.forEach((members, key) => teamRosters.set(key, members));
  tournamentSettings = snapshot.settings;
  leagueTeams = Object.fromEntries(Object.entries(snapshot.settings).map(([league, config]) => [
    league, config.participants.map((participant) => participant.team)
  ]));
  sampleTournamentNames = new Set();
  leagueOptions = Object.keys(tournamentSettings);
  liveDataMode = true;
  hasAdminAccess = false;
  document.querySelector("#role-indicator").textContent = "Viewer mode";
  updateDatabaseStatus(true, `Supabase · ${Object.keys(matchDetails).length} records · read only`);
  setPage(activePage);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setPage(page) {
  const label = pageLabels[page];
  if (!label) return;
  activePage = page;
  navItems.forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.title = `${label} - HOK Database UI Preview`;

  if (page === "matches") {
    pageContent.innerHTML = startingContent;
    bindMatchPage();
    return;
  }
  if (page === "tournaments") {
    renderTournamentPage();
    return;
  }

  renderModulePage(page);
}

function getCompletedMatches(league = "all") {
  return Object.values(matchDetails).filter((match) =>
    match.finished && (league === "all" || match.league === league)
  );
}

function getLeagueTeams(league) {
  return leagueTeams[league] || [];
}

function renderModuleHeading(page, description) {
  const pageTitles = {
    standings: "Standings", players: "Player stats", roster: "Roster",
    compare: "Head to head", awards: "Achievements", tournaments: "Tournaments"
  };
  const options = [...leagueOptions, "All leagues"].map((league) =>
    `<option value="${escapeHTML(league === "All leagues" ? "all" : league)}">${escapeHTML(league)}</option>`
  ).join("");
  return `<section class="page-heading module-page-heading">
    <div><p class="eyebrow">CURRENT SEASON · INDONESIA</p><h1>${pageTitles[page]}</h1><p class="heading-copy">${description}</p></div>
    <label class="select-wrap"><span class="sr-only">Filter by league</span><select data-module-league aria-label="Filter by league">${options}</select><span class="select-chevron">⌄</span></label>
  </section>`;
}

function collectPlayerStats(league) {
  const players = new Map();
  getCompletedMatches(league).forEach((match) => match.games.forEach((game) => {
    [["A", game.playersA], ["B", game.playersB]].forEach(([side, entries]) => entries.forEach((player) => {
      const team = side === "A" ? match.teamA : match.teamB;
      const key = player.playerId || `${match.league}|${team}|${player.player}`;
      const entry = players.get(key) || {
        name: player.player, team, lane: player.lane, games: 0,
        kills: 0, deaths: 0, assists: 0, gold: 0, damage: 0, damageTaken: 0,
        teamKills: 0, multiKills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, mvp: 0, firstBlood: 0
      };
      entry.games += 1;
      entry.kills += player.kills || 0;
      entry.deaths += player.deaths || 0;
      entry.assists += player.assists || 0;
      entry.gold += player.gold || 0;
      entry.damage += player.damage || 0;
      entry.damageTaken += player.damageTaken || 0;
      entry.teamKills += (side === "A" ? game.playersA : game.playersB).reduce((sum, teammate) => sum + (teammate.kills || 0), 0);
      Object.keys(entry.multiKills).forEach((count) => {
        entry.multiKills[count] += player.multiKills?.[count] || 0;
      });
      entry.mvp += player.mvp ? 1 : 0;
      entry.firstBlood += player.firstBlood ? 1 : 0;
      players.set(key, entry);
    }));
  }));
  return [...players.entries()].map(([id, player]) => ({
    ...player,
    id,
    kda: player.deaths ? ((player.kills + player.assists) / player.deaths).toFixed(2) : (player.kills + player.assists).toFixed(2),
    kp: player.teamKills ? Math.round(((player.kills + player.assists) / player.teamKills) * 100) : 0,
  })).sort((a, b) => b.kda - a.kda || b.kills - a.kills);
}

function getStandings(league) {
  const standings = new Map(getLeagueTeams(league).map((team) => [team, {
    team, played: 0, wins: 0, losses: 0, gameWins: 0, gameLosses: 0
  }]));
  getCompletedMatches(league).forEach((match) => {
    [match.teamA, match.teamB].forEach((team) => {
      if (!standings.has(team)) standings.set(team, { team, played: 0, wins: 0, losses: 0, gameWins: 0, gameLosses: 0 });
    });
    const a = standings.get(match.teamA);
    const b = standings.get(match.teamB);
    a.played += 1; b.played += 1;
    a.gameWins += match.scoreA; a.gameLosses += match.scoreB;
    b.gameWins += match.scoreB; b.gameLosses += match.scoreA;
    if (match.scoreA > match.scoreB) { a.wins += 1; b.losses += 1; }
    else { b.wins += 1; a.losses += 1; }
  });
  return [...standings.values()].map((row) => ({ ...row, gameDiff: row.gameWins - row.gameLosses }))
    .sort((a, b) => b.wins - a.wins || b.gameDiff - a.gameDiff);
}

function renderStandings(league) {
  const standings = getStandings(league);
  return `<section class="content-card module-card">
    <div class="section-heading"><div><h2>League table</h2><p>${liveDataMode ? "Standings calculated from live Supabase match results." : "Sample standings calculated from recorded match results."}</p></div><span class="sample-tag">${liveDataMode ? "LIVE DATA" : "SAMPLE"}</span></div>
    <div class="module-table-wrap"><table class="module-table"><thead><tr><th>#</th><th>TEAM</th><th>MP</th><th>W</th><th>L</th><th>GAME SCORE</th><th>GAME DIFF</th></tr></thead>
      <tbody>${standings.map((row, index) => `<tr><td class="rank-cell">${String(index + 1).padStart(2, "0")}</td><td><strong class="module-team-name">${escapeHTML(row.team)}</strong></td><td>${row.played}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.gameWins}-${row.gameLosses}</td><td><strong>${row.gameDiff > 0 ? "+" : ""}${row.gameDiff}</strong></td></tr>`).join("")}</tbody>
    </table></div>
    <p class="module-footnote">Game diff = games won − games lost. Standings are sorted by series wins, then game diff.</p>
  </section>`;
}

function renderPlayerStats(league) {
  const players = collectPlayerStats(league);
  return `<section class="content-card module-card">
    <div class="section-heading"><div><h2>Player leaderboard</h2><p>Aggregate K/D/A and MVPs across completed ${liveDataMode ? "live" : "sample"} games.</p></div><span class="sample-tag">${liveDataMode ? "LIVE DATA" : "SAMPLE"}</span></div>
    <div class="module-table-wrap"><table class="module-table player-module-table"><thead><tr><th>PLAYER</th><th>TEAM</th><th>GAMES</th><th>K/D/A</th><th>KDA</th><th>KP</th><th>GOLD</th><th>HERO DMG</th><th>DMG TAKEN</th><th>1K</th><th>2K</th><th>3K</th><th>4K</th><th>5K</th><th>MVP</th><th>FIRST BLOOD</th></tr></thead>
      <tbody>${players.slice(0, 12).map((player, index) => `<tr><td><span class="player-rank">${String(index + 1).padStart(2, "0")}</span><strong class="module-team-name">${escapeHTML(player.name)}</strong><small class="table-sub">${escapeHTML(player.lane)}</small></td><td>${escapeHTML(player.team)}</td><td>${player.games}</td><td>${player.kills}/${player.deaths}/${player.assists}</td><td><strong>${player.kda}</strong></td><td>${player.kp}%</td><td>${Math.round(player.gold / player.games).toLocaleString("en-US")}</td><td>${Math.round(player.damage / player.games).toLocaleString("en-US")}</td><td>${Math.round(player.damageTaken / player.games).toLocaleString("en-US")}</td>${[1, 2, 3, 4, 5].map((count) => `<td>${player.multiKills[count]}</td>`).join("")}<td>${player.mvp}</td><td>${player.firstBlood}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="module-footnote">KP = (kills + assists) ÷ team kills. Gold, hero damage, and damage taken are per-game averages; K/D/A and award counts are totals.</p>
  </section>`;
}

function collectRoster(league) {
  return (league === "all" ? leagueOptions : [league]).flatMap((tournament) =>
    getLeagueTeams(tournament).flatMap((team) => getTeamRoster(tournament, team).map((player) => ({
      ...player, team, tournament, name: player.name, lane: player.role
    })))
  );
}

function renderRoster(league) {
  const roster = collectRoster(league);
  const tournaments = league === "all" ? leagueOptions : [league];
  const teams = tournaments.flatMap((tournament) => getLeagueTeams(tournament).map((team) => ({ team, tournament })));
  const management = isReadOnlyDatabase()
    ? `<div class="management-actions"><p>Supabase roster is shown in read-only mode. Adding and removing players is disabled.</p></div>`
    : hasAdminAccess
    ? `<div class="management-actions"><p>Add players to the selected event roster. Each registration has its own identity, even when nicknames repeat.</p></div>`
    : `<div class="management-actions"><p>Admin access is required to add or remove roster members.</p><button type="button" class="button button-secondary" data-admin-tools>Unlock admin tools</button></div>`;
  return `<section class="roster-summary-grid"><article class="roster-summary"><span>TEAMS</span><strong>${teams.length}</strong><small>In selected league</small></article><article class="roster-summary"><span>REGISTERED PLAYERS</span><strong>${roster.length}</strong><small>${liveDataMode ? "From Supabase" : "Across sample team rosters"}</small></article><article class="roster-summary"><span>LANES</span><strong>5</strong><small>Standard HOK roles</small></article></section>
    <section class="content-card module-card"><div class="section-heading"><div><h2>Team rosters</h2><p>${liveDataMode ? "Live roster grouped by tournament and team." : "Sample lineup grouped by team and lane."}</p></div><span class="sample-tag">${liveDataMode ? "LIVE DATA" : "SAMPLE"}</span></div>
      <div class="roster-team-grid">${teams.map(({ team, tournament }) => {
        const members = roster.filter((player) => player.team === team && player.tournament === tournament);
        const memberRows = members.map((player) => {
          const used = Object.values(matchDetails).some((match) => match.league === tournament && match.games?.some((game) =>
            [...game.playersA, ...game.playersB].some((entry) => entry.playerId === player.id)
          ));
          return `<div><span>${escapeHTML(player.lane.replace(" Lane", ""))}</span><strong title="${escapeHTML(player.identity || player.id)}">${escapeHTML(player.name)}${player.identity ? ` <small>· ${escapeHTML(player.identity)}</small>` : ""}</strong>${hasAdminAccess && !isReadOnlyDatabase() ? `<button type="button" class="danger-button" data-remove-roster="${escapeHTML(player.id)}" data-roster-team="${escapeHTML(team)}" data-roster-tournament="${escapeHTML(tournament)}" ${used ? "disabled title=\"This roster identity appears in match history.\"" : ""}>Remove</button>` : ""}</div>`;
        }).join("");
        const addForm = hasAdminAccess && !isReadOnlyDatabase() ? `<form class="roster-add-form" data-add-roster="${escapeHTML(tournament)}" data-roster-team="${escapeHTML(team)}">
          <label>Nickname<input name="name" required maxlength="40" placeholder="Player nickname" /></label>
          <label>Identity note<input name="identity" maxlength="60" placeholder="Optional distinguisher" /></label>
          <label>Role<select name="role">${[...lanes, "Substitute", "Coach", "Analyst"].map((role) => `<option>${escapeHTML(role)}</option>`).join("")}</select></label>
          <button type="submit" class="button button-secondary">Add to roster</button>
        </form>` : "";
        return `<article class="roster-team-card"><header><span class="team-monogram">${escapeHTML(team.slice(0, 2).toUpperCase())}</span><div><strong>${escapeHTML(team)}</strong><small>${escapeHTML(tournament)} · ${members.length} roster members</small></div></header>
          <div class="roster-player-list">${memberRows || "<p>No roster members registered yet.</p>"}</div>${addForm}</article>`;
      }).join("")}</div>
      <p class="module-footnote">Rosters are tournament-specific. A player identity belongs to that event/team registration; repeated nicknames remain separate records.</p>
    </section>
    <section class="content-card module-card"><div class="section-heading"><div><h2>Roster management</h2><p>Select a tournament above, then add a nickname and role to the correct team.</p></div></div>${management}</section>`;
}

function getHeadToHead(teamA, teamB, league) {
  return getCompletedMatches(league).filter((match) =>
    (match.teamA === teamA && match.teamB === teamB) || (match.teamA === teamB && match.teamB === teamA)
  ).map((match) => ({
    ...match,
    winner: match.scoreA > match.scoreB ? match.teamA : match.teamB,
    gamesA: match.teamA === teamA ? match.scoreA : match.scoreB,
    gamesB: match.teamA === teamA ? match.scoreB : match.scoreA
  }));
}

function renderHeadToHead(league) {
  const teams = getLeagueTeams(league);
  const first = teams[0] || "";
  const second = teams.find((team) => getHeadToHead(first, team, league).length > 0) || teams[1] || "";
  const matches = getHeadToHead(first, second, league);
  const winsA = matches.filter((match) => match.winner === first).length;
  const winsB = matches.filter((match) => match.winner === second).length;
  const players = collectPlayerStats(league);
  const playerA = players[0];
  const playerB = players.find((player) => player.team !== playerA?.team && getPlayerHeadToHead(playerA?.id, player.id, league).length) || players.find((player) => player.team !== playerA?.team);
  const playerGames = getPlayerHeadToHead(playerA?.id, playerB?.id, league);
  const playerWinsA = playerGames.filter((entry) => entry.playerAWonGame).length;
  const playerWinsB = playerGames.filter((entry) => entry.playerBWonGame).length;
  const playerOptions = (selectedId) => players.map((player) => `<option value="${escapeHTML(player.id)}" ${player.id === selectedId ? "selected" : ""}>${escapeHTML(player.name)} · ${escapeHTML(player.team)} · ${escapeHTML(player.lane)}</option>`).join("");
  return `<section class="content-card module-card">
    <div class="section-heading"><div><h2>Head-to-head comparison</h2><p>Compare event results between teams or players.</p></div><span class="sample-tag">${liveDataMode ? "LIVE DATA" : "SAMPLE"}</span></div>
    <div class="h2h-mode-switch" role="group" aria-label="Comparison type"><button type="button" class="active" data-h2h-mode="teams" aria-pressed="true">Team vs team</button><button type="button" data-h2h-mode="players" aria-pressed="false">Player vs player</button></div>
    <div class="h2h-panel" data-h2h-panel="teams">
      <div class="compare-controls"><label class="field-label">Team A<select id="compare-team-a">${teams.map((team) => `<option>${escapeHTML(team)}</option>`).join("")}</select></label><span>VS</span><label class="field-label">Team B<select id="compare-team-b">${teams.map((team, index) => `<option ${index === 1 ? "selected" : ""}>${escapeHTML(team)}</option>`).join("")}</select></label></div>
      <div class="compare-score-card" id="compare-results"><div><strong id="compare-name-a">${escapeHTML(first)}</strong><span>Series wins</span></div><b id="compare-score">${winsA} : ${winsB}</b><div><strong id="compare-name-b">${escapeHTML(second)}</strong><span>Series wins</span></div></div>
      <div class="compare-match-list" id="compare-match-list">${renderComparedMatches(matches)}</div>
    </div>
    <div class="h2h-panel" data-h2h-panel="players" hidden>
      <div class="compare-controls"><label class="field-label">Player A<select id="compare-player-a">${playerOptions(playerA?.id)}</select></label><span>VS</span><label class="field-label">Player B<select id="compare-player-b">${playerOptions(playerB?.id)}</select></label></div>
      <div class="compare-score-card" id="player-compare-results"><div><strong id="compare-player-name-a">${escapeHTML(playerA?.name || "No player data")}</strong><span id="compare-player-team-a">${escapeHTML(playerA?.team || "")}</span></div><b id="compare-player-score">${playerWinsA} : ${playerWinsB}</b><div><strong id="compare-player-name-b">${escapeHTML(playerB?.name || "Select player")}</strong><span id="compare-player-team-b">${escapeHTML(playerB?.team || "")}</span></div></div>
      <div class="compare-match-list" id="player-compare-list">${renderPlayerComparedGames(playerGames)}</div>
    </div>
  </section>`;
}

function getPlayerHeadToHead(playerAId, playerBId, league) {
  if (!playerAId || !playerBId || playerAId === playerBId) return [];
  const games = [];
  getCompletedMatches(league).forEach((match) => match.games.forEach((game) => {
    const playerA = game.playersA.find((player) => player.playerId === playerAId);
    const playerB = game.playersB.find((player) => player.playerId === playerBId);
    if (playerA && playerB) {
      games.push({ match, game, playerA, playerB, playerATeam: match.teamA, playerBTeam: match.teamB,
        playerAWonGame: game.winner === match.teamA, playerBWonGame: game.winner === match.teamB });
      return;
    }
    const reverseA = game.playersB.find((player) => player.playerId === playerAId);
    const reverseB = game.playersA.find((player) => player.playerId === playerBId);
    if (reverseA && reverseB) {
      games.push({ match, game, playerA: reverseA, playerB: reverseB, playerATeam: match.teamB, playerBTeam: match.teamA,
        playerAWonGame: game.winner === match.teamB, playerBWonGame: game.winner === match.teamA });
    }
  }));
  return games;
}

function renderPlayerComparedGames(games) {
  return games.length ? games.map(({ match, game, playerA, playerB, playerATeam, playerBTeam, playerAWonGame, playerBWonGame }) =>
    `<div class="compare-match-row"><span>${escapeHTML(match.stage)} · Game ${game.gameNumber}</span>
      <strong>${escapeHTML(playerA.player)} (${escapeHTML(playerATeam)}) ${playerAWonGame ? "W" : "L"} · ${playerA.kills}/${playerA.deaths}/${playerA.assists} vs ${escapeHTML(playerB.player)} (${escapeHTML(playerBTeam)}) ${playerBWonGame ? "W" : "L"} · ${playerB.kills}/${playerB.deaths}/${playerB.assists}</strong>
      <small>${escapeHTML(match.date)} · KP ${calculatePlayerKp(game.playersA.includes(playerA) ? game.playersA : game.playersB, playerA)}% vs ${calculatePlayerKp(game.playersA.includes(playerB) ? game.playersA : game.playersB, playerB)}% · ${playerA.mvp ? "MVP" : ""}${playerA.firstBlood ? " · First Blood" : ""}</small>
    </div>`).join("")
    : `<p class="module-footnote">These players have no recorded games against each other in this tournament yet.</p>`;
}

function renderComparedMatches(matches) {
  return matches.length ? matches.map((match) => `<div class="compare-match-row"><span>${escapeHTML(match.league)}</span><strong>${escapeHTML(match.teamA)} ${match.scoreA} : ${match.scoreB} ${escapeHTML(match.teamB)}</strong><small>${escapeHTML(match.stage)} · ${escapeHTML(match.date)}</small></div>`).join("")
    : `<p class="module-footnote">No direct ${liveDataMode ? "recorded" : "sample"} match between these teams in this league yet.</p>`;
}

function renderAchievements(league) {
  const players = collectPlayerStats(league);
  const matches = getCompletedMatches(league);
  const mvpLeader = [...players].sort((a, b) => b.mvp - a.mvp)[0];
  const seriesWins = new Map();
  matches.forEach((match) => {
    const winner = match.scoreA > match.scoreB ? match.teamA : match.teamB;
    seriesWins.set(winner, (seriesWins.get(winner) || 0) + 1);
  });
  const teamLeader = [...seriesWins.entries()].sort((a, b) => b[1] - a[1])[0];
  const awards = [
    { icon: "★", title: "MVP leader", recipient: mvpLeader?.name || "No MVP yet", detail: `${mvpLeader?.mvp || 0} game MVP awards · ${mvpLeader?.team || ""}` },
    { icon: "⚔", title: "Series leader", recipient: teamLeader?.[0] || "No results yet", detail: `${teamLeader?.[1] || 0} series wins in this league` },
    { icon: "◎", title: "Top KDA", recipient: players[0]?.name || "No player data", detail: `${players[0]?.kda || "0.00"} KDA · ${players[0]?.team || ""}` },
    { icon: "♧", title: "First blood", recipient: players.sort((a, b) => b.firstBlood - a.firstBlood)[0]?.name || "No first blood yet", detail: `${players.sort((a, b) => b.firstBlood - a.firstBlood)[0]?.firstBlood || 0} first bloods recorded` }
  ];
  return `<section class="achievement-grid">${awards.map((award, index) => `<article class="achievement-card"><span class="achievement-icon achievement-icon-${index}">${award.icon}</span><small>${escapeHTML(award.title)}</small><strong>${escapeHTML(award.recipient)}</strong><p>${escapeHTML(award.detail)}</p><span class="sample-tag">${liveDataMode ? "LIVE DATA" : "SAMPLE AWARD"}</span></article>`).join("")}</section>
    <section class="content-card module-card"><div class="section-heading"><div><h2>Milestone board</h2><p>Highlights are calculated from ${liveDataMode ? "live Supabase match records" : "the sample match records"}.</p></div></div>
      <div class="milestone-list"><div><strong>${matches.length}</strong><span>series recorded</span></div><div><strong>${players.reduce((sum, player) => sum + player.mvp, 0)}</strong><span>MVP awards assigned</span></div><div><strong>${players.reduce((sum, player) => sum + player.firstBlood, 0)}</strong><span>first bloods recorded</span></div></div></section>`;
}

function renderModulePage(page, league = leagueOptions[0]) {
  const title = pageLabels[page];
  const descriptions = {
    standings: "League table built from recorded results.",
    players: "Performance leaders across games in the selected league.",
    roster: "View registered players and manage leagues and team entries.",
    compare: "Compare direct team series and player game records.",
    awards: liveDataMode ? "Player and team achievements from recorded live results." : "Sample player and team achievements from the season."
  };
  pageContent.innerHTML = `${renderModuleHeading(page, descriptions[page])}
    <div class="module-content" id="module-content">${renderModuleContent(page, league)}</div>
    <footer class="page-footer"><span>HOK Database · Level Up Indonesia</span><span>${liveDataMode ? "Live Supabase data · Read only" : "Sample data · Preview only"}</span></footer>`;
  pageContent.querySelector("[data-module-league]").value = league;
  pageContent.querySelector("[data-module-league]").addEventListener("change", (event) => {
    renderModulePage(page, event.target.value);
  });
  if (page === "roster") bindRosterManagement();
  if (page === "compare") bindCompareControls(league);
}

function renderModuleContent(page, league) {
  if (page === "standings") return renderStandings(league);
  if (page === "players") return renderPlayerStats(league);
  if (page === "roster") return renderRoster(league);
  if (page === "compare") return renderHeadToHead(league);
  return renderAchievements(league);
}

function renderTournamentPage() {
  const tournamentCards = leagueOptions.map((tournament) => {
    const config = tournamentSettings[tournament];
    const teamRows = (config?.participants || []).map((participant) => {
      const usedByMatch = Object.values(matchDetails).some((match) =>
        match.league === tournament && (match.teamA === participant.team || match.teamB === participant.team)
      );
      const hasRoster = getTeamRoster(tournament, participant.team).length > 0;
      const cannotRemove = usedByMatch || hasRoster;
      return `<tr><td><strong>${escapeHTML(participant.team)}</strong></td><td>${escapeHTML(participant.abbreviation)}</td><td>${escapeHTML(participant.route)}</td><td>${usedByMatch ? "Match history" : hasRoster ? "Roster registered" : "No history"}</td><td>${hasAdminAccess && !isReadOnlyDatabase() ? `<button type="button" class="danger-button" data-remove-participant="${escapeHTML(participant.team)}" data-tournament="${escapeHTML(tournament)}" ${cannotRemove ? `disabled title="${usedByMatch ? "This team has match history" : "Remove the team's roster first"}."` : ""}>Remove</button>` : ""}</td></tr>`;
    }).join("");
    const fields = isReadOnlyDatabase()
      ? `<p class="module-footnote">Supabase is connected in read-only mode. Tournament changes are disabled.</p>`
      : hasAdminAccess
      ? `<form class="tournament-edit-form" data-edit-tournament="${escapeHTML(tournament)}">
          <label>Tournament name<input name="name" required maxlength="80" value="${escapeHTML(tournament)}" /></label>
          <label>Series format<select name="format">${["BO1", "BO3", "BO5", "BO7"].map((format) => `<option ${config.format === format ? "selected" : ""}>${format}</option>`).join("")}</select></label>
          <label class="checkbox-field"><input name="globalBanPick" type="checkbox" ${config.globalBanPick ? "checked" : ""} /> Global Ban & Pick</label>
          <button type="submit" class="button button-secondary">Save tournament</button>
          <button type="button" class="danger-button" data-delete-tournament="${escapeHTML(tournament)}" ${Object.values(matchDetails).some((match) => match.league === tournament) || [...teamRosters.keys()].some((key) => key.startsWith(`${tournament}|`) && teamRosters.get(key).length) ? "disabled title=\"Remove roster and match history before deleting this tournament.\"" : ""}>Delete tournament</button>
        </form>
        <form class="participant-add-form" data-add-participant="${escapeHTML(tournament)}">
          <label>Participating team<input name="team" required maxlength="60" placeholder="Team name" /></label>
          <label>Team abbreviation<input name="abbreviation" required maxlength="10" placeholder="BTR" /></label>
          <label>Qualification route<select name="route">${qualificationRoutes.map((route) => `<option>${escapeHTML(route)}</option>`).join("")}</select></label>
          <button type="submit" class="button button-primary">Add participant</button>
        </form>`
      : `<p class="module-footnote">Unlock admin tools to edit tournament settings and participants.</p>`;
    return `<article class="content-card tournament-card"><header class="section-heading"><div><h2>${escapeHTML(tournament)}</h2><p>${config?.format || "BO5"} · ${config?.globalBanPick ? "Global Ban & Pick" : "Standard draft"} · ${(config?.participants || []).length} participants</p></div><span class="sample-tag">${liveDataMode ? "LIVE DATA" : hasAdminAccess ? "ADMIN" : "SAMPLE"}</span></header>
      ${fields}
      <div class="module-table-wrap"><table class="module-table participant-table"><thead><tr><th>TEAM</th><th>ABBR</th><th>QUALIFICATION ROUTE</th><th>HISTORY</th><th></th></tr></thead><tbody>${teamRows || '<tr><td colspan="5">No participants added yet.</td></tr>'}</tbody></table></div>
    </article>`;
  }).join("");
  const createForm = isReadOnlyDatabase()
    ? `<div class="management-actions"><p>Supabase is connected in read-only mode. Tournament creation is disabled.</p></div>`
    : hasAdminAccess
    ? `<form id="create-tournament-form" class="tournament-create-form">
        <label>Tournament name<input name="name" required maxlength="80" placeholder="e.g. HOK Spring Cup" /></label>
        <label>Series format<select name="format"><option>BO1</option><option>BO3</option><option selected>BO5</option><option>BO7</option></select></label>
        <label class="checkbox-field"><input name="globalBanPick" type="checkbox" /> Global Ban & Pick</label>
        <button type="submit" class="button button-primary">Create tournament</button>
      </form>`
    : `<div class="management-actions"><p>Admin access is required to create tournaments or edit participants.</p><button type="button" class="button button-secondary" data-unlock-tournaments>Unlock admin tools</button></div>`;
  pageContent.innerHTML = `<section class="page-heading module-page-heading"><div><p class="eyebrow">EVENT WORKSPACE · SETUP FIRST</p><h1>Tournaments</h1><p class="heading-copy">Set up an event before registering its rosters and entering matches.</p></div></section>
    <section class="content-card module-card"><div class="section-heading"><div><h2>Competition setup</h2><p>1. Create a tournament · 2. Register teams and qualification routes · 3. Add each team’s event roster · 4. Record matches.</p></div><span class="sample-tag">EVENT SETUP</span></div>${createForm}</section>
    <div class="module-content tournament-list">${tournamentCards}</div>
    <details class="content-card tournament-help"><summary>How to add, edit, and delete tournaments or teams</summary><ol>
      <li>Unlock admin tools, enter the tournament name, choose BO1/BO3/BO5/BO7, and enable Global Ban & Pick if that tournament uses it.</li>
      <li>In that tournament card, add every participating team. Enter its abbreviation manually and select its entry route.</li>
      <li>To rename or change the format, edit the tournament settings and save. Rename is blocked when roster or match history already refers to the tournament.</li>
      <li>Use Remove on a participant only before it has match history. A tournament with match history cannot be deleted, protecting results.</li>
      <li>Register the tournament-specific roster from the Roster page. Nicknames are stored as distinct roster entries per tournament/team.</li>
    </ol><p>${productionDatabaseAdapter?.canWrite ? "Changes are saved to Supabase after admin verification." : "All changes in this preview are temporary and stay in browser memory."}</p></details>
    <footer class="page-footer"><span>HOK Database · Level Up Indonesia</span><span>${liveDataMode ? "Live Supabase data · Read only" : "Sample data · Preview only"}</span></footer>`;
  bindTournamentControls();
}

function bindTournamentControls() {
  document.querySelector("[data-unlock-tournaments]")?.addEventListener("click", () => requestAdminAccess(() => renderTournamentPage()));
  document.querySelector("#create-tournament-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.namedItem("name").value.trim();
    if (leagueOptions.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      showToast("A tournament with that name already exists.");
      return;
    }
    leagueOptions.push(name);
    leagueTeams[name] = [];
    tournamentSettings[name] = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), format: form.elements.namedItem("format").value, globalBanPick: form.elements.namedItem("globalBanPick").checked, participants: [] };
    if (productionDatabaseAdapter?.canWrite) {
      try {
        await persistTournamentChanges();
        await finishDatabaseWrite("Tournament created in Supabase.");
      } catch (error) {
        await showDatabaseWriteError("Tournament", error);
      }
      return;
    }
    renderTournamentPage();
    showToast("Tournament created in this preview.");
  });
  document.querySelectorAll("[data-edit-tournament]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const oldName = form.dataset.editTournament;
    const newName = form.elements.namedItem("name").value.trim();
    if (newName !== oldName && leagueOptions.some((entry) => entry.toLowerCase() === newName.toLowerCase())) {
      showToast("A tournament with that name already exists.");
      return;
    }
    if (newName !== oldName && (Object.values(matchDetails).some((match) => match.league === oldName)
      || [...teamRosters.keys()].some((key) => key.startsWith(`${oldName}|`) && teamRosters.get(key).length))) {
      showToast("Rename is blocked while rosters or match history refer to this tournament.");
      return;
    }
    const config = tournamentSettings[oldName];
    config.format = form.elements.namedItem("format").value;
    config.globalBanPick = form.elements.namedItem("globalBanPick").checked;
    if (newName !== oldName) {
      const teams = leagueTeams[oldName];
      leagueOptions[leagueOptions.indexOf(oldName)] = newName;
      delete leagueTeams[oldName];
      leagueTeams[newName] = teams;
      delete tournamentSettings[oldName];
      tournamentSettings[newName] = config;
      Object.values(matchDetails).forEach((match) => {
        if (match.league === oldName) {
          match.league = newName;
          match.tournamentId = newName;
          match.games?.forEach((game) => [...game.playersA, ...game.playersB].forEach((player) => {
            if (player.playerId) player.playerId = player.playerId.replace(oldName, newName);
          }));
        }
      });
      for (const [key, roster] of teamRosters) {
        if (key.startsWith(`${oldName}|`)) {
          teamRosters.delete(key);
          const team = key.slice(oldName.length + 1);
          teamRosters.set(rosterKey(newName, team), roster.map((player) => ({ ...player, id: player.id.replace(oldName, newName) })));
        }
      }
    }
    if (productionDatabaseAdapter?.canWrite) {
      try {
        await persistTournamentChanges();
        await finishDatabaseWrite("Tournament settings saved to Supabase.");
      } catch (error) {
        await showDatabaseWriteError("Tournament settings", error);
      }
      return;
    }
    renderTournamentPage();
    showToast("Tournament settings saved in this preview.");
  }));
  document.querySelectorAll("[data-add-participant]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tournament = form.dataset.addParticipant;
    const team = form.elements.namedItem("team").value.trim();
    const abbreviation = form.elements.namedItem("abbreviation").value.trim().toUpperCase();
    const participants = tournamentSettings[tournament].participants;
    if (participants.some((participant) => participant.team.toLowerCase() === team.toLowerCase())) {
      showToast("This team is already in the tournament.");
      return;
    }
    participants.push({ team, abbreviation, route: form.elements.namedItem("route").value });
    leagueTeams[tournament].push(team);
    teamRosters.set(rosterKey(tournament, team), []);
    if (productionDatabaseAdapter?.canWrite) {
      try {
        await persistTournamentChanges();
        await finishDatabaseWrite("Team added to tournament in Supabase.");
      } catch (error) {
        await showDatabaseWriteError("Team registration", error);
      }
      return;
    }
    renderTournamentPage();
    showToast("Tournament participant added.");
  }));
  document.querySelectorAll("[data-remove-participant]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const tournament = button.dataset.tournament;
    const team = button.dataset.removeParticipant;
    tournamentSettings[tournament].participants = tournamentSettings[tournament].participants.filter((participant) => participant.team !== team);
    leagueTeams[tournament] = leagueTeams[tournament].filter((participant) => participant !== team);
    teamRosters.delete(rosterKey(tournament, team));
    if (productionDatabaseAdapter?.canWrite) {
      try {
        await persistTournamentChanges();
        await finishDatabaseWrite("Team removed from tournament in Supabase.");
      } catch (error) {
        await showDatabaseWriteError("Team removal", error);
      }
      return;
    }
    renderTournamentPage();
    showToast("Participant removed from this preview.");
  }));
  document.querySelectorAll("[data-delete-tournament]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const tournament = button.dataset.deleteTournament;
    if (!window.confirm(`Delete ${tournament} and its participants?`)) return;
    leagueOptions.splice(leagueOptions.indexOf(tournament), 1);
    delete leagueTeams[tournament];
    delete tournamentSettings[tournament];
    for (const key of teamRosters.keys()) if (key.startsWith(`${tournament}|`)) teamRosters.delete(key);
    if (productionDatabaseAdapter?.canWrite) {
      try {
        await persistTournamentChanges();
        await finishDatabaseWrite("Tournament deleted from Supabase.");
      } catch (error) {
        await showDatabaseWriteError("Tournament deletion", error);
      }
      return;
    }
    renderTournamentPage();
    showToast("Tournament deleted from this preview.");
  }));
}

function bindRosterManagement() {
  document.querySelector("[data-admin-tools]")?.addEventListener("click", () => {
    const activeLeague = document.querySelector("[data-module-league]").value;
    requestAdminAccess(() => renderModulePage("roster", activeLeague));
  });
  document.querySelectorAll("[data-add-roster]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tournament = form.dataset.addRoster;
    const team = form.dataset.rosterTeam;
    const name = form.elements.namedItem("name").value.trim();
    const identity = form.elements.namedItem("identity").value.trim();
    const role = form.elements.namedItem("role").value;
    const members = getTeamRoster(tournament, team);
    const sameNameAndRole = members.filter((member) => member.name.toLowerCase() === name.toLowerCase() && member.role === role);
    if (sameNameAndRole.length && (!identity || sameNameAndRole.some((member) => member.identity?.toLowerCase() === identity.toLowerCase()))) {
      showToast("This nickname and role already exist. Add a unique identity note to distinguish this player.");
      return;
    }
    const newMember = { id: `${rosterKey(tournament, team)}|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, name, identity, role };
    if (productionDatabaseAdapter?.canWrite) {
      try {
        const id = await productionDatabaseAdapter.saveRoster({
          name, identity, role, tournament, team
        });
        newMember.id = String(id);
        members.push(newMember);
        await finishDatabaseWrite("Roster member saved to Supabase.");
      } catch (error) {
        await showDatabaseWriteError("Roster member", error);
      }
      return;
    }
    members.push(newMember);
    const activeTournament = document.querySelector("[data-module-league]").value;
    renderModulePage("roster", activeTournament);
    showToast("Roster member added in this preview.");
  }));
  document.querySelectorAll("[data-remove-roster]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const tournament = button.dataset.rosterTournament;
    const team = button.dataset.rosterTeam;
    const id = button.dataset.removeRoster;
    if (productionDatabaseAdapter?.canWrite) {
      try {
        await productionDatabaseAdapter.deleteRoster(id);
        await finishDatabaseWrite("Roster member removed from Supabase.");
      } catch (error) {
        await showDatabaseWriteError("Roster deletion", error);
      }
      return;
    }
    teamRosters.set(rosterKey(tournament, team), getTeamRoster(tournament, team).filter((player) => player.id !== id));
    renderModulePage("roster", document.querySelector("[data-module-league]").value);
    showToast("Roster member removed from this preview.");
  }));
}

function renderCompetitionManager() {
  const management = document.querySelector("#competition-manager");
  if (!management || !hasAdminAccess) return;
  const leagueCards = leagueOptions.map((league) => {
    const teams = getLeagueTeams(league);
    const hasMatches = Object.values(matchDetails).some((match) => match.league === league);
    return `<article class="competition-league-card">
      <header><div><strong>${escapeHTML(league)}</strong><small>${teams.length} teams · ${hasMatches ? "has match history" : "no match history"}</small></div>
        <button type="button" class="danger-button" data-delete-league="${escapeHTML(league)}" ${hasMatches ? "disabled title=\"League has match history and cannot be deleted.\"" : ""}>Delete league</button></header>
      <div class="managed-team-list">${teams.map((team) => {
        const hasHistory = Object.values(matchDetails).some((match) => match.league === league && (match.teamA === team || match.teamB === team));
        return `<div><span>${escapeHTML(team)}${hasHistory ? '<small> · history</small>' : ""}</span><button type="button" class="danger-button" data-delete-team="${escapeHTML(team)}" data-team-league="${escapeHTML(league)}" ${hasHistory ? "disabled title=\"Team has match history and cannot be removed.\"" : ""}>Remove</button></div>`;
      }).join("")}</div>
      <form class="add-team-form" data-add-team="${escapeHTML(league)}"><label>Add a team<input name="team" required maxlength="60" placeholder="e.g. Team Nova" /></label><button type="submit" class="button button-secondary">Add team</button></form>
    </article>`;
  }).join("");
  management.innerHTML = `<div class="competition-manager">
    <div class="manager-intro"><strong>Competition management</strong><p>Add leagues and assign teams. Deletion is blocked when historical matches depend on that entry.</p></div>
    <form id="add-league-form" class="add-league-form"><label>New league name<input name="league" required maxlength="80" placeholder="e.g. HOK Spring Cup" /></label><button type="submit" class="button button-primary">Add league</button></form>
    <div class="competition-league-list">${leagueCards}</div>
    <p class="module-footnote">These controls demonstrate the intended admin workflow. Changes stay in this browser preview and are not saved to Supabase.</p>
  </div>`;
  management.querySelector("#add-league-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("league");
    const name = input.value.trim();
    if (!name || leagueOptions.some((league) => league.toLowerCase() === name.toLowerCase())) {
      showToast("Enter a unique league name.");
      return;
    }
    leagueOptions.push(name);
    leagueTeams[name] = [];
    renderCompetitionManager();
    renderModulePage("roster", name);
    showToast("League added in this preview.");
  });
  management.querySelectorAll(".add-team-form").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const league = form.dataset.addTeam;
    const input = form.elements.namedItem("team");
    const name = input.value.trim();
    if (!name || getLeagueTeams(league).some((team) => team.toLowerCase() === name.toLowerCase())) {
      showToast("Enter a unique team name for this league.");
      return;
    }
    leagueTeams[league].push(name);
    renderModulePage("roster", league);
    showToast("Team added to the league in this preview.");
  }));
  management.querySelectorAll("[data-delete-team]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    const league = button.dataset.teamLeague;
    const team = button.dataset.deleteTeam;
    if (!window.confirm(`Remove ${team} from ${league}?`)) return;
    leagueTeams[league] = getLeagueTeams(league).filter((entry) => entry !== team);
    renderModulePage("roster", league);
    showToast("Team removed from this preview.");
  }));
  management.querySelectorAll("[data-delete-league]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    const league = button.dataset.deleteLeague;
    if (!window.confirm(`Delete ${league} and its teams?`)) return;
    delete leagueTeams[league];
    leagueOptions.splice(leagueOptions.indexOf(league), 1);
    renderModulePage("roster", leagueOptions[0] || "all");
    showToast("League deleted from this preview.");
  }));
}

function bindCompareControls(league) {
  const update = () => {
    const teamA = document.querySelector("#compare-team-a").value;
    const teamB = document.querySelector("#compare-team-b").value;
    const matches = getHeadToHead(teamA, teamB, league);
    const winsA = matches.filter((match) => match.winner === teamA).length;
    const winsB = matches.filter((match) => match.winner === teamB).length;
    document.querySelector("#compare-name-a").textContent = teamA;
    document.querySelector("#compare-name-b").textContent = teamB;
    document.querySelector("#compare-score").textContent = `${winsA} : ${winsB}`;
    document.querySelector("#compare-match-list").innerHTML = renderComparedMatches(matches);
  };
  document.querySelector("#compare-team-a").addEventListener("change", update);
  document.querySelector("#compare-team-b").addEventListener("change", update);
  const updatePlayers = () => {
    const playerA = document.querySelector("#compare-player-a");
    const playerB = document.querySelector("#compare-player-b");
    const idA = playerA.value;
    const idB = playerB.value;
    const entryA = collectPlayerStats(league).find((player) => player.id === idA);
    const entryB = collectPlayerStats(league).find((player) => player.id === idB);
    const games = getPlayerHeadToHead(idA, idB, league);
    document.querySelector("#compare-player-name-a").textContent = entryA?.name || "Select player";
    document.querySelector("#compare-player-team-a").textContent = entryA?.team || "";
    document.querySelector("#compare-player-name-b").textContent = entryB?.name || "Select player";
    document.querySelector("#compare-player-team-b").textContent = entryB?.team || "";
    document.querySelector("#compare-player-score").textContent = `${games.filter((entry) => entry.playerAWonGame).length} : ${games.filter((entry) => entry.playerBWonGame).length}`;
    document.querySelector("#player-compare-list").innerHTML = renderPlayerComparedGames(games);
  };
  document.querySelector("#compare-player-a").addEventListener("change", updatePlayers);
  document.querySelector("#compare-player-b").addEventListener("change", updatePlayers);
  document.querySelectorAll("[data-h2h-mode]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-h2h-mode]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-h2h-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.h2hPanel !== button.dataset.h2hMode;
    });
  }));
}

function bindMatchPage() {
  document.querySelector("#add-match-button").addEventListener("click", () => requestAdminAccess());
  document.querySelector("#match-search").addEventListener("input", updateResults);
  document.querySelector("#result-filter").addEventListener("change", updateResults);
  document.querySelector("#league-select").addEventListener("change", updateLeagueView);
  document.querySelector("#schedule-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-match-id]");
    if (button) openMatchDetails(button.dataset.matchId);
  });
  document.querySelector("#results-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-match-id]");
    if (button) openMatchDetails(button.dataset.matchId);
  });
  document.querySelectorAll("button[data-match-id]").forEach((button) => {
    button.addEventListener("click", () => openMatchDetails(button.dataset.matchId));
  });
  syncMatchLeagueOptions();
  updateLeagueView();
}

function syncMatchLeagueOptions() {
  const selector = document.querySelector("#league-select");
  if (!selector) return;
  const selected = selector.value;
  selector.innerHTML = `${leagueOptions.map((league) => `<option>${escapeHTML(league)}</option>`).join("")}<option value="All leagues">All leagues</option>`;
  selector.value = leagueOptions.includes(selected) || selected === "All leagues" ? selected : (leagueOptions[0] || "All leagues");
}

function updateResults() {
  const query = document.querySelector("#match-search").value.trim().toLowerCase();
  const filter = document.querySelector("#result-filter").value;
  const selectedLeague = getSelectedLeague();
  const rows = [...document.querySelectorAll("#results-body tr")];
  let visibleCount = 0;
  rows.forEach((row) => {
    const matchesText = row.dataset.teams.includes(query);
    const match = matchDetails[row.dataset.matchId];
    const winner = match.winner || (match.scoreA > match.scoreB ? match.teamA : match.teamB);
    const matchesFilter = filter !== "win" || winner === (liveDataMode ? match.teamA : "Alter Ego");
    const matchesLeague = selectedLeague === "all" || row.dataset.league === selectedLeague;
    const visible = matchesText && matchesFilter && matchesLeague;
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  document.querySelector("#result-count").textContent = `${visibleCount} ${visibleCount === 1 ? "match" : "matches"}`;
  document.querySelector("#no-results").hidden = visibleCount > 0;
}

function getSelectedLeague() {
  const selected = document.querySelector("#league-select").value;
  return selected === "All leagues" ? "all" : selected;
}

function getFilteredSchedules() {
  const league = getSelectedLeague();
  return Object.entries(matchDetails)
    .filter(([, match]) => !match.finished && (league === "all" || match.league === league))
    .map(([id, match]) => ({ id, ...match }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

function dateFromISO(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getThisWeekRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function updateLeagueView() {
  const league = getSelectedLeague();
  if (liveDataMode) renderLiveMatchRows(league);
  const finishedMatches = Object.values(matchDetails).filter((match) =>
    match.finished && (league === "all" || match.league === league)
  );
  const scheduledMatches = getFilteredSchedules();
  const participatingTeams = new Set();
  [...finishedMatches, ...scheduledMatches].forEach((match) => {
    participatingTeams.add(match.teamA);
    participatingTeams.add(match.teamB);
  });

  const { start, end } = getThisWeekRange();
  const weekSchedules = scheduledMatches.filter((match) => {
    const date = dateFromISO(match.dateISO);
    return date >= start && date <= end;
  });
  const totalMatches = finishedMatches.length + scheduledMatches.length;
  document.querySelector('[data-stat="total-matches"]').textContent = totalMatches;
  document.querySelector('[data-stat="weekly-schedules"]').textContent = weekSchedules.length;
  document.querySelector('[data-stat="teams"]').textContent = participatingTeams.size;
  document.querySelector('[data-stat="recorded"]').textContent = finishedMatches.length;
  document.querySelector('[data-stat="remaining"]').textContent = scheduledMatches.length;
  const selectedLeagueCount = league === "all" ? leagueOptions.length : 1;
  document.querySelector('[data-stat="leagues"]').textContent = `${selectedLeagueCount} ${selectedLeagueCount === 1 ? "league" : "leagues"} selected`;

  document.querySelectorAll("#schedule-list .schedule-row").forEach((row) => {
    row.hidden = league !== "all" && row.dataset.league !== league;
  });
  document.querySelectorAll("#results-body tr").forEach((row) => {
    row.hidden = league !== "all" && row.dataset.league !== league;
  });
  if (liveDataMode) {
    document.querySelector("#result-filter option[value='win']").textContent = "Team A wins";
    document.querySelector("#page-content .page-footer span:last-child").textContent = "Live Supabase data · Read only";
  }
  updateResults();
  updateFeaturedMatch(scheduledMatches[0]);
}

function renderLiveMatchRows(league) {
  const allMatches = Object.entries(matchDetails).map(([id, match]) => ({ id, ...match }));
  const scheduled = allMatches.filter((match) => !match.finished
    && (league === "all" || match.league === league))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const completed = allMatches.filter((match) => match.finished
    && (league === "all" || match.league === league))
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  document.querySelector("#schedule-list").innerHTML = scheduled.map((match) => {
    const [year, month, day] = (match.dateISO || "").split("-").map(Number);
    const monthName = day && month ? new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day))).toUpperCase() : "TBD";
    return `<article class="schedule-row" data-match-id="${escapeHTML(match.id)}" data-league="${escapeHTML(match.league)}" data-date="${escapeHTML(match.dateISO)}">
      <div class="schedule-date"><strong>${day ? String(day).padStart(2, "0") : "—"}</strong><span>${monthName}</span></div>
      <div class="schedule-time">${escapeHTML(match.time || "Time TBD")}${match.time ? " WIB" : ""}</div>
      <div class="schedule-teams"><strong>${escapeHTML(match.teamA)}</strong><span class="schedule-vs">vs</span><strong>${escapeHTML(match.teamB)}</strong></div>
      <span class="stage-pill">${escapeHTML(match.stage)}</span><span class="format-pill">${escapeHTML(match.format)}</span>
      <button class="row-action" data-match-id="${escapeHTML(match.id)}" aria-label="View ${escapeHTML(match.teamA)} vs ${escapeHTML(match.teamB)} details" title="Match details">↗</button>
    </article>`;
  }).join("");
  document.querySelector("#results-body").innerHTML = completed.map((match) => {
    const teamAWon = match.scoreA > match.scoreB;
    const matchDate = match.date || "Date not set";
    return `<tr data-teams="${escapeHTML(`${match.teamA} ${match.teamB}`.toLowerCase())}" data-match-id="${escapeHTML(match.id)}" data-league="${escapeHTML(match.league)}">
      <td><div class="result-teams"><strong>${escapeHTML(match.teamA)}</strong><span class="score ${teamAWon ? "winner-score" : ""}">${match.scoreA}</span><span class="score-separator">-</span><span class="score ${!teamAWon ? "winner-score" : ""}">${match.scoreB}</span><strong class="loser-name">${escapeHTML(match.teamB)}</strong></div></td>
      <td><strong class="table-main">${escapeHTML(match.league)}</strong><small class="table-sub">${escapeHTML(match.stage)}</small></td>
      <td><span class="table-main">${escapeHTML(matchDate)}</span><small class="table-sub">${escapeHTML(match.time)}${match.time ? " WIB" : ""}</small></td>
      <td><span class="result-badge complete-badge">Completed</span></td><td><span class="format-pill">${escapeHTML(match.format)}</span></td>
      <td><button class="row-action detail-row-button" data-match-id="${escapeHTML(match.id)}" aria-label="View ${escapeHTML(match.teamA)} vs ${escapeHTML(match.teamB)} details">Details <span>↗</span></button></td>
    </tr>`;
  }).join("");
  if (!completed.length) {
    document.querySelector("#no-results").hidden = false;
    document.querySelector("#no-results").textContent = "No completed matches in this selection.";
  } else {
    document.querySelector("#no-results").textContent = "No matches found.";
  }
}

function updateFeaturedMatch(match) {
  const card = document.querySelector("#next-match-card");
  card.hidden = !match;
  if (!match) return;
  card.querySelector(".match-format").textContent = `${match.stage.toUpperCase()} · ${match.format}`;
  const teamBlocks = card.querySelectorAll(".team-copy strong");
  teamBlocks[0].textContent = match.teamA;
  teamBlocks[1].textContent = match.teamB;
  card.querySelector(".match-details").innerHTML = `
    <button type="button" class="text-button" id="next-match-detail">View match details <span>→</span></button>`;
  card.querySelector("#next-match-detail").addEventListener("click", () => openMatchDetails(match.id));
}

function openModal() {
  syncEntryLeagueOptions();
  showEntryStep(1);
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  modal.querySelector("select").focus();
}

function syncEntryLeagueOptions() {
  const selector = document.querySelector("#entry-league");
  if (!selector) return;
  const currentLeague = selector.value;
  selector.innerHTML = `<option value="">Select a league</option>${leagueOptions.map((league) => `<option>${escapeHTML(league)}</option>`).join("")}`;
  if (leagueOptions.includes(currentLeague)) selector.value = currentLeague;
  else selector.value = leagueOptions[0] || "";
  const format = document.querySelector("#entry-format");
  if (format && tournamentSettings[selector.value]) format.value = tournamentSettings[selector.value].format;
  syncEntryTeamOptions();
}

function syncEntryTeamOptions() {
  const league = document.querySelector("#entry-league").value;
  ["#entry-team-a", "#entry-team-b"].forEach((selectorId) => {
    const selector = document.querySelector(selectorId);
    const currentTeam = selector.value;
    selector.innerHTML = `<option value="">Select a team</option>${getLeagueTeams(league).map((team) => `<option>${escapeHTML(team)}</option>`).join("")}`;
    if (getLeagueTeams(league).includes(currentTeam)) selector.value = currentTeam;
  });
}

function closeAdminAccess() {
  adminAccessModal.hidden = true;
  document.body.style.overflow = "";
  document.querySelector("#admin-access-form").reset();
  document.querySelector("#admin-access-error").hidden = true;
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
}

function showEntryStep(step) {
  document.querySelector("#entry-step-one").hidden = step !== 1;
  document.querySelector("#entry-step-two").hidden = step !== 2;
  document.querySelector("#step-one-number").classList.toggle("step-current", step === 1);
  document.querySelector("#step-one-number").classList.toggle("step-next", step !== 1);
  document.querySelector("#step-two-number").classList.toggle("step-current", step === 2);
  document.querySelector("#step-two-number").classList.toggle("step-next", step !== 2);
  document.querySelector(".step-label-current").classList.toggle("active-step-label", step === 1);
  document.querySelector(".step-label-next").classList.toggle("active-step-label", step === 2);
}

function selectedTeamNames() {
  return {
    teamA: document.querySelector("#entry-team-a").value,
    teamB: document.querySelector("#entry-team-b").value
  };
}

async function prepareEntryStepTwo() {
  const form = document.querySelector("#match-form");
  if (!form.reportValidity()) return;
  const { teamA, teamB } = selectedTeamNames();
  if (teamA === teamB) {
    showToast("Choose two different teams.");
    return;
  }
  if (document.querySelector("#entry-status").value === "Scheduled") {
    if (productionDatabaseAdapter?.canWrite) {
      const button = document.querySelector("#continue-to-entry");
      button.disabled = true;
      try {
        await productionDatabaseAdapter.saveSchedule(buildEntryPreviewMatch());
        closeModal();
        await finishDatabaseWrite("Match schedule saved to Supabase.");
      } catch (error) {
        showToast(`Schedule was not saved: ${error.message}`);
      } finally {
        button.disabled = false;
      }
      return;
    }
    matchDetails["entry-preview"] = buildEntryPreviewMatch();
    closeModal();
    openMatchDetails("entry-preview");
    showToast("Scheduled match preview only — nothing was saved.");
    return;
  }
  const maxGames = Number(document.querySelector("#entry-format").value.match(/\d+/)?.[0]) || 1;
  const seriesWinsNeeded = Math.floor(maxGames / 2) + 1;
  const tournament = document.querySelector("#entry-league").value;
  const rosterA = getTeamRoster(tournament, teamA);
  const rosterB = getTeamRoster(tournament, teamB);
  const globalBanPick = tournamentSettings[tournament]?.globalBanPick || false;
  const usedHeroes = { A: new Set(), B: new Set() };
  const seedHero = (gameIndex, side, laneIndex) => {
    const preferred = heroDrafts[gameIndex % heroDrafts.length][side === "A" ? 0 : 1][laneIndex];
    if (!globalBanPick) return preferred;
    const hero = [preferred, ...heroOptions].find((candidate) => !usedHeroes[side].has(candidate)) || preferred;
    usedHeroes[side].add(hero);
    return hero;
  };
  entryGameDrafts = Array.from({ length: maxGames }, (_, index) => ({
    winner: index < seriesWinsNeeded ? teamA : "",
    duration: "",
    blueSide: index % 2 === 0 ? "A" : "B",
    bansA: ["", "", "", ""],
    bansB: ["", "", "", ""],
    objectivesA: { Tyrant: 1, "Shadow Tyrant": 0, Tempest: 0, Overlord: 0, "Shadow Overlord": 0, Towers: 3 },
    objectivesB: { Tyrant: 0, "Shadow Tyrant": 0, Tempest: 0, Overlord: 1, "Shadow Overlord": 0, Towers: 1 },
    picksA: lanes.map((lane, laneIndex) => ({
      playerId: rosterA.find((player) => player.role === lane)?.id || "",
      lane,
      hero: seedHero(index, "A", laneIndex),
      player: rosterA.find((player) => player.role === lane)?.name || "",
      kills: statLinesA[laneIndex][0], deaths: statLinesA[laneIndex][1], assists: statLinesA[laneIndex][2],
      gold: statLinesA[laneIndex][3], damage: statLinesA[laneIndex][4], damageTaken: statLinesA[laneIndex][5],
      multiKills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, mvp: false, firstBlood: false
    })),
    picksB: lanes.map((lane, laneIndex) => ({
      playerId: rosterB.find((player) => player.role === lane)?.id || "",
      lane,
      hero: seedHero(index, "B", laneIndex),
      player: rosterB.find((player) => player.role === lane)?.name || "",
      kills: statLinesB[laneIndex][0], deaths: statLinesB[laneIndex][1], assists: statLinesB[laneIndex][2],
      gold: statLinesB[laneIndex][3], damage: statLinesB[laneIndex][4], damageTaken: statLinesB[laneIndex][5],
      multiKills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, mvp: false, firstBlood: false
    }))
  }));
  currentEntryGame = 1;
  renderEntryGameTabs();
  renderEntryGamePanel();
  updateEntrySeriesScore();
  showEntryStep(2);
  document.querySelector("#entry-game-tabs button")?.focus();
}

function renderEntryGameTabs() {
  document.querySelector("#entry-game-tabs").innerHTML = entryGameDrafts.map((_, index) =>
    `<button type="button" role="tab" data-entry-game="${index + 1}" aria-selected="${currentEntryGame === index + 1}">Game ${index + 1}</button>`
  ).join("");
}

function calculateEntryKp(game, side, index) {
  const players = game[`picks${side}`];
  const teamKills = players.reduce((total, player) => total + (Number(player.kills) || 0), 0);
  const player = players[index];
  return teamKills ? Math.round(((Number(player.kills) + Number(player.assists)) / teamKills) * 100) : 0;
}

function renderEntryGamePanel() {
  const { teamA, teamB } = selectedTeamNames();
  const game = entryGameDrafts[currentEntryGame - 1];
  const winnerOptions = `<option value="">Not played</option><option value="${escapeHTML(teamA)}" ${game.winner === teamA ? "selected" : ""}>${escapeHTML(teamA)}</option><option value="${escapeHTML(teamB)}" ${game.winner === teamB ? "selected" : ""}>${escapeHTML(teamB)}</option>`;
  const renderPlayerTable = (side, team) => `<div class="entry-team-stats"><h3>${escapeHTML(team)} · ${side === game.blueSide ? "BLUE SIDE" : "RED SIDE"}</h3><div class="entry-stats-scroll"><table class="entry-stats-table"><thead><tr><th>ROLE</th><th>PLAYER</th><th>HERO</th><th>K/D/A</th><th>GOLD</th><th>HERO DMG</th><th>DMG TAKEN</th><th>KP</th><th>1K</th><th>2K</th><th>3K</th><th>4K</th><th>5K</th><th>MVP</th><th>FIRST BLOOD</th></tr></thead><tbody>${lanes.map((lane, index) => {
    const pick = game[`picks${side}`][index];
    const roster = getTeamRoster(document.querySelector("#entry-league").value, team).filter((player) => player.role === lane);
    const selectedMemberId = pick.playerId || roster.find((member) => member.name === pick.player)?.id || "";
    const playerOptions = roster.map((player) => `<option value="${escapeHTML(player.id)}" ${player.id === selectedMemberId ? "selected" : ""}>${escapeHTML(player.identity ? `${player.name} · ${player.identity}` : player.name)}</option>`).join("");
    const heroSelectOptions = heroOptions.map((hero) => {
      const unavailable = isEntryHeroUnavailable(currentEntryGame - 1, side, index, hero);
      return `<option ${hero === pick.hero ? "selected" : ""} ${unavailable && hero !== pick.hero ? "disabled" : ""}>${escapeHTML(hero)}</option>`;
    }).join("");
    return `<tr><th scope="row">${escapeHTML(lane.replace(" Lane", ""))}</th>
      <td><select aria-label="${escapeHTML(team)} ${escapeHTML(lane)} player" data-entry-side="${side}" data-entry-lane="${index}" data-entry-pick="playerId">${playerOptions || '<option value="">Add this role to roster first</option>'}</select></td>
      <td><select aria-label="${escapeHTML(team)} ${escapeHTML(lane)} hero" data-entry-side="${side}" data-entry-lane="${index}" data-entry-pick="hero">${heroSelectOptions}</select></td>
      <td><input aria-label="${escapeHTML(team)} ${escapeHTML(lane)} K/D/A" data-entry-side="${side}" data-entry-lane="${index}" data-entry-pick="kda" value="${pick.kills}/${pick.deaths}/${pick.assists}" inputmode="numeric" pattern="\\d+/\\d+/\\d+" /></td>
      ${["gold", "damage", "damageTaken"].map((stat) => `<td><input type="number" min="0" aria-label="${escapeHTML(team)} ${escapeHTML(lane)} ${stat}" data-entry-side="${side}" data-entry-lane="${index}" data-entry-pick="${stat}" value="${pick[stat]}" /></td>`).join("")}
      <td class="entry-kp-cell" data-entry-kp="${side}-${index}">${calculateEntryKp(game, side, index)}%</td>
      ${[1, 2, 3, 4, 5].map((count) => `<td><input type="number" min="0" aria-label="${escapeHTML(team)} ${escapeHTML(lane)} ${count} kill streaks" data-entry-side="${side}" data-entry-lane="${index}" data-entry-multi-kill="${count}" value="${pick.multiKills?.[count] || 0}" /></td>`).join("")}
      <td><input type="radio" name="entry-game-mvp" aria-label="${escapeHTML(team)} ${escapeHTML(lane)} MVP" data-entry-side="${side}" data-entry-lane="${index}" data-entry-award="mvp" ${pick.mvp ? "checked" : ""} /></td>
      <td><input type="radio" name="entry-game-firstblood" aria-label="${escapeHTML(team)} ${escapeHTML(lane)} first blood" data-entry-side="${side}" data-entry-lane="${index}" data-entry-award="firstBlood" ${pick.firstBlood ? "checked" : ""} /></td></tr>`;
  }).join("")}</tbody></table></div></div>`;
  const sidePicker = `<div class="side-choice-row" role="group" aria-label="Choose the blue-side team">
    <span>BLUE SIDE</span>
    <button type="button" class="side-choice ${game.blueSide === "A" ? "selected-blue" : ""}" data-blue-side="A" aria-pressed="${game.blueSide === "A"}">${escapeHTML(teamA)}</button>
    <button type="button" class="side-choice ${game.blueSide === "B" ? "selected-blue" : ""}" data-blue-side="B" aria-pressed="${game.blueSide === "B"}">${escapeHTML(teamB)}</button>
    <small>The other team automatically starts on Red.</small>
  </div>`;
  const objectives = ["Tyrant", "Shadow Tyrant", "Tempest", "Overlord", "Shadow Overlord", "Towers"];
  const renderObjectives = (side, team) => `<div class="entry-objective-team"><strong>${escapeHTML(team)}</strong>${objectives.map((objective) =>
    `<label>${escapeHTML(objective)}<input type="number" min="0" max="99" data-entry-side="${side}" data-entry-objective="${escapeHTML(objective)}" value="${game[`objectives${side}`][objective] || 0}" /></label>`
  ).join("")}</div>`;
  document.querySelector("#entry-game-panel").innerHTML = `
    <div class="entry-game-toolbar">
      <label class="field-label">Game winner<select data-entry-field="winner">${winnerOptions}</select></label>
      <label class="field-label">Duration<input data-entry-field="duration" value="${escapeHTML(game.duration)}" placeholder="e.g. 18:42" /></label>
    </div>
    ${sidePicker}
    <p class="input-helper">Enter K/D/A as kills/deaths/assists (for example 4/2/7). KP is calculated automatically as (kills + assists) ÷ team kills.${tournamentSettings[document.querySelector("#entry-league").value]?.globalBanPick ? " Global Ban & Pick prevents each team from reusing its own earlier picks in this series." : ""}</p>
    ${renderPlayerTable("A", teamA)}${renderPlayerTable("B", teamB)}
    <div class="entry-bans-grid">
      ${["A", "B"].map((side) => {
        const team = side === "A" ? teamA : teamB;
        const bans = game[`bans${side}`].join(", ");
        return `<label class="field-label">${escapeHTML(team)} bans<input data-entry-side="${side}" data-entry-field="bans" value="${escapeHTML(bans)}" placeholder="Separate heroes with commas" /></label>`;
      }).join("")}
    </div>
    <section class="entry-objectives"><div class="entry-objective-heading"><strong>OBJECTIVES TAKEN</strong><span>Enter the count secured by each team this game.</span></div>
      ${renderObjectives("A", teamA)}${renderObjectives("B", teamB)}
    </section>`;
}

function isEntryHeroUnavailable(gameIndex, side, laneIndex, hero) {
  if (!tournamentSettings[document.querySelector("#entry-league").value]?.globalBanPick) return false;
  const usedPreviously = entryGameDrafts.slice(0, gameIndex).some((game) =>
    game[`picks${side}`].some((player) => player.hero === hero)
  );
  const alreadyPickedThisGame = entryGameDrafts[gameIndex][`picks${side}`]
    .some((player, index) => index !== laneIndex && player.hero === hero);
  return usedPreviously || alreadyPickedThisGame;
}

function updateEntrySeriesScore() {
  const { teamA, teamB } = selectedTeamNames();
  const scoreA = entryGameDrafts.filter((game) => game.winner === teamA).length;
  const scoreB = entryGameDrafts.filter((game) => game.winner === teamB).length;
  document.querySelector("#entry-score-label-a").textContent = teamA;
  document.querySelector("#entry-score-label-b").textContent = teamB;
  document.querySelector("#entry-score-a").value = scoreA;
  document.querySelector("#entry-score-b").value = scoreB;
  const winnerText = scoreA === scoreB
    ? "Select game winners to calculate the series result"
    : `${scoreA > scoreB ? teamA : teamB} leads ${Math.max(scoreA, scoreB)}-${Math.min(scoreA, scoreB)}`;
  document.querySelector("#entry-series-winner").textContent = winnerText;
}

function buildEntryPreviewMatch() {
  const { teamA, teamB } = selectedTeamNames();
  const isCompleted = document.querySelector("#entry-status").value === "Completed";
  const games = isCompleted ? entryGameDrafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ draft }) => draft.winner)
    .map(({ draft, index }) => ({
      gameNumber: index + 1,
      winner: draft.winner,
      scoreA: draft.winner === teamA ? 1 : 0,
      scoreB: draft.winner === teamB ? 1 : 0,
      duration: draft.duration || "—",
      blueSide: draft.blueSide,
      bansA: draft.bansA.join(",").split(",").map((hero) => hero.trim()).filter(Boolean),
      bansB: draft.bansB.join(",").split(",").map((hero) => hero.trim()).filter(Boolean),
      objectivesA: draft.objectivesA,
      objectivesB: draft.objectivesB,
      playersA: draft.picksA.map((player) => ({ ...player, multiKills: { ...player.multiKills }, kills: player.kills, deaths: player.deaths, assists: player.assists })),
      playersB: draft.picksB.map((player) => ({ ...player, multiKills: { ...player.multiKills }, kills: player.kills, deaths: player.deaths, assists: player.assists }))
    })) : [];
  const scoreA = games.filter((game) => game.winner === teamA).length;
  const scoreB = games.filter((game) => game.winner === teamB).length;
  const rawDate = document.querySelector("#match-form input[type='date']").value;
  const formattedDate = rawDate
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(dateFromISO(rawDate))
    : "";
  return {
    league: document.querySelector("#entry-league").value,
    teamA, teamB, scoreA: isCompleted ? scoreA : null, scoreB: isCompleted ? scoreB : null,
    status: isCompleted ? "Completed" : "Scheduled",
    format: document.querySelector("#entry-format").value,
    phase: document.querySelector("#entry-phase").value,
    stage: document.querySelector("#entry-stage").value.trim() || document.querySelector("#entry-phase").value,
    time: document.querySelector("#entry-time").value,
    streamUrl: document.querySelector("#entry-stream").value.trim(),
    tournamentId: document.querySelector("#entry-league").value,
    globalBanPick: tournamentSettings[document.querySelector("#entry-league").value]?.globalBanPick || false,
    date: formattedDate,
    finished: isCompleted,
    games
  };
}

function renderDraftSide(teamName, players, winner, side, blueSide) {
  const picks = players.map((player) => `
    <div class="draft-pick ${player.mvp ? "mvp-pick" : ""}">
      <span class="pick-lane">${escapeHTML(player.lane.replace(" Lane", ""))}</span>
      <span class="pick-hero">${escapeHTML(player.hero)}</span>
      <span class="pick-player">${escapeHTML(player.player)}${player.mvp ? '<b class="pick-tag mvp-flag">MVP</b>' : ""}${player.firstBlood ? '<b class="pick-tag first-blood">FIRST BLOOD</b>' : ""}</span>
      <span class="pick-kda">${player.kills}<i>K</i> ${player.deaths}<i>D</i> ${player.assists}<i>A</i></span>
      <span class="pick-extra-stats">KP ${calculatePlayerKp(players, player)}% · ${Number(player.gold || 0).toLocaleString("en-US")} gold · ${Number(player.damage || 0).toLocaleString("en-US")} hero dmg · ${Number(player.damageTaken || 0).toLocaleString("en-US")} taken</span>
      <span class="pick-multikills">${[1, 2, 3, 4, 5].map((count) => `${count}K ${player.multiKills?.[count] || 0}`).join(" · ")}</span>
    </div>`).join("");
  return `<section class="draft-side ${winner === teamName ? "winning-side" : ""}">
    <header class="draft-side-heading">
      <div><strong>${escapeHTML(teamName)}</strong><span>${winner === teamName ? "GAME WINNER" : "TEAM STATS"}</span></div>
      <b class="${side === blueSide ? "blue-side" : "red-side"}">${side === blueSide ? "BLUE" : "RED"}</b>
    </header>
    <div class="draft-picks">${picks}</div>
  </section>`;
}

function renderObjectiveSummary(objectives) {
  return Object.entries(objectives)
    .filter(([, count]) => count > 0)
    .map(([objective, count]) => `<span class="objective-chip">${objective}<b>×${count}</b></span>`)
    .join("");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderGameHeader(match, game) {
  const teamA = escapeHTML(match.teamA);
  const teamB = escapeHTML(match.teamB);
  const winner = escapeHTML(game.winner);
  const expanded = !collapsedGames.has(game.gameNumber);
  return `<button type="button" class="game-toggle" data-game-toggle="${game.gameNumber}"
      aria-expanded="${expanded}" aria-controls="game-detail-${game.gameNumber}">
    <span class="game-card-heading">
      <span class="game-heading-label"><strong>GAME ${game.gameNumber}</strong><span>${escapeHTML(game.duration)}</span></span>
      <span class="game-score-strip">
        <span class="${game.winner === match.teamA ? "game-winner-name" : ""}">${teamA}</span>
        <strong>${game.scoreA}<i>:</i>${game.scoreB}</strong>
        <span class="${game.winner === match.teamB ? "game-winner-name" : ""}">${teamB}</span>
      </span>
      <span class="winner-pill">${winner} wins</span>
      <span class="game-chevron" aria-hidden="true">${expanded ? "−" : "+"}</span>
    </span>
  </button>`;
}

function renderBroadcastGame(match, game) {
  return `<article class="game-card">
    ${renderGameHeader(match, game)}
    <div class="game-details" id="game-detail-${game.gameNumber}" ${collapsedGames.has(game.gameNumber) ? "hidden" : ""}>
      <div class="game-bans">
        <div class="ban-side"><span>BANNED</span><b>${escapeHTML(match.teamA)}</b>${game.bansA.map((hero) => `<i>${escapeHTML(hero)}</i>`).join("")}</div>
        <div class="ban-side"><span>BANNED</span><b>${escapeHTML(match.teamB)}</b>${game.bansB.map((hero) => `<i>${escapeHTML(hero)}</i>`).join("")}</div>
      </div>
      <div class="draft-matchup">
        ${renderDraftSide(match.teamA, game.playersA, game.winner, "A", game.blueSide)}
        <div class="draft-divider"><span>VS</span></div>
        ${renderDraftSide(match.teamB, game.playersB, game.winner, "B", game.blueSide)}
      </div>
      <footer class="game-footer">
        <span class="objective-label">OBJECTIVES TAKEN</span>
        <div class="objective-team"><strong>${escapeHTML(match.teamA)}</strong>${renderObjectiveSummary(game.objectivesA)}</div>
        <div class="objective-team"><strong>${escapeHTML(match.teamB)}</strong>${renderObjectiveSummary(game.objectivesB)}</div>
      </footer>
    </div>
  </article>`;
}

function renderGameList(match) {
  const allCollapsed = match.games.every((game) => collapsedGames.has(game.gameNumber));
  return `<div class="detail-game-actions"><span>GAME-BY-GAME BREAKDOWN <b>${match.games.length} games · ${escapeHTML(match.format)}</b></span><button type="button" data-games-action>${allCollapsed ? "Show all games" : "Hide all games"}</button></div>
    <div class="game-list" id="game-list">${match.games.map((game) => renderBroadcastGame(match, game)).join("")}</div>`;
}

function renderMatchDetails() {
  const match = matchDetails[currentDetailMatchId];
  if (!match) return;
  const hasResult = match.finished && Number.isInteger(match.scoreA) && Number.isInteger(match.scoreB);
  detailModal.querySelector(".eyebrow").textContent = liveDataMode ? "MATCH BREAKDOWN · LIVE DATA" : "MATCH BREAKDOWN · SAMPLE DATA";
  const gamesMarkup = hasResult
    ? renderGameList(match)
    : `<div class="detail-empty">This match has not started yet. Game scores, drafts, and player stats will appear here after the result is recorded.</div>`;
  document.querySelector("#detail-title").textContent = `${match.teamA} vs ${match.teamB}`;
  document.querySelector("#detail-content").innerHTML = `
    <div class="detail-summary">
      <div class="detail-team"><strong>${escapeHTML(match.teamA)}</strong><small>${hasResult ? (match.scoreA > match.scoreB ? "SERIES WINNER" : "RUNNER-UP") : "TEAM A"}</small></div>
      <div class="detail-score">${hasResult ? `<strong>${match.scoreA}</strong><span>:</span><strong>${match.scoreB}</strong>` : `<span class="upcoming-label">VS</span>`}</div>
      <div class="detail-team"><strong>${escapeHTML(match.teamB)}</strong><small>${hasResult ? (match.scoreB > match.scoreA ? "SERIES WINNER" : "RUNNER-UP") : "TEAM B"}</small></div>
    </div>
    <div class="detail-meta"><span>${escapeHTML(match.status || (match.finished ? "Completed" : "Scheduled"))}</span><span>${escapeHTML(match.league)}</span><span>${escapeHTML(match.phase || "Stage")}: ${escapeHTML(match.stage)}</span><span>${escapeHTML(match.date)}${match.time ? ` · ${escapeHTML(match.time)} WIB` : ""}</span>${match.globalBanPick || tournamentSettings[match.league]?.globalBanPick ? "<span>GLOBAL BAN & PICK</span>" : ""}${match.streamUrl ? `<a href="${escapeHTML(match.streamUrl)}" target="_blank" rel="noopener noreferrer">Watch live stream ↗</a>` : ""}</div>
    ${gamesMarkup}`;
}

function openMatchDetails(matchId) {
  const match = matchDetails[matchId];
  if (!match) return;
  currentDetailMatchId = matchId;
  collapsedGames.clear();
  renderMatchDetails();
  detailModal.hidden = false;
  document.body.style.overflow = "hidden";
  detailModal.querySelector(".close-detail").focus();
}

function closeMatchDetails() {
  detailModal.hidden = true;
  document.body.style.overflow = "";
}

function requestAdminAccess(afterUnlock = openModal) {
  if (productionMode) {
    if (!productionDatabaseAdapter?.canWrite) {
      pendingAdminAction = afterUnlock;
      adminAccessModal.hidden = false;
      document.body.style.overflow = "hidden";
      document.querySelector("#admin-password").focus();
      return;
    }
    afterUnlock();
    return;
  }
  if (isReadOnlyDatabase()) {
    showToast("Supabase is connected in read-only mode. Database edits are disabled.");
    return;
  }
  if (hasAdminAccess) {
    afterUnlock();
    return;
  }
  pendingAdminAction = afterUnlock;
  adminAccessModal.hidden = false;
  document.body.style.overflow = "hidden";
  document.querySelector("#admin-password").focus();
}

navItems.forEach((item) => item.addEventListener("click", () => setPage(item.dataset.page)));
document.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", closeModal));
document.querySelectorAll(".close-admin-modal").forEach((button) => button.addEventListener("click", closeAdminAccess));
document.querySelectorAll(".close-detail").forEach((button) => button.addEventListener("click", closeMatchDetails));
document.querySelectorAll(".close-database-modal").forEach((button) => button.addEventListener("click", () => {
  databaseModal.hidden = true;
  databaseConnectionError.hidden = true;
  document.body.style.overflow = "";
}));
document.querySelector("#connect-database-button").addEventListener("click", () => {
  const savedConnection = sessionStorage.getItem(databaseSessionKey);
  if (savedConnection) {
    const config = JSON.parse(savedConnection);
    document.querySelector("#database-project-url").value = config.url;
    document.querySelector("#database-anon-key").value = config.anonKey;
  }
  databaseModal.hidden = false;
  document.body.style.overflow = "hidden";
  document.querySelector("#database-email").focus();
});
document.querySelector("#database-connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#database-connect-submit");
  submit.disabled = true;
  submit.textContent = "Connecting…";
  databaseConnectionError.hidden = true;
  try {
    await connectToDatabase(
      document.querySelector("#database-project-url").value,
      document.querySelector("#database-anon-key").value,
      {
        email: document.querySelector("#database-email").value,
        password: document.querySelector("#database-password").value,
      }
    );
    databaseModal.hidden = true;
    document.body.style.overflow = "";
    document.querySelector("#database-anon-key").value = "";
    document.querySelector("#database-password").value = "";
    showToast("Connected to Supabase with viewer access.");
  } catch (error) {
    databaseConnectionError.textContent = `Could not connect: ${error.message}`;
    databaseConnectionError.hidden = false;
    updateDatabaseStatus(liveDataMode, liveDataMode
      ? "Supabase · using last successful read"
      : "Connection failed · sample data");
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Sign in and connect <span>→</span>';
  }
});
document.querySelector("#continue-to-entry").addEventListener("click", prepareEntryStepTwo);
document.querySelector("#entry-status").addEventListener("change", (event) => {
  document.querySelector("#continue-to-entry").innerHTML = event.target.value === "Scheduled"
    ? `${productionDatabaseAdapter?.canWrite ? "Save scheduled match" : "Preview scheduled match"} <span>→</span>`
    : 'Continue to results <span>→</span>';
  document.querySelector("#save-match-button").textContent = productionDatabaseAdapter?.canWrite
    ? "Save completed match"
    : "Preview result";
});
document.querySelector("#back-to-entry").addEventListener("click", () => showEntryStep(1));
document.querySelector("#entry-league").addEventListener("change", () => {
  const tournament = document.querySelector("#entry-league").value;
  document.querySelector("#entry-format").value = tournamentSettings[tournament]?.format || "BO5";
  syncEntryTeamOptions();
});
document.querySelector("#entry-game-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-entry-game]");
  if (!tab) return;
  currentEntryGame = Number(tab.dataset.entryGame);
  renderEntryGameTabs();
  renderEntryGamePanel();
});
document.querySelector("#entry-game-panel").addEventListener("input", (event) => {
  const input = event.target;
  const game = entryGameDrafts[currentEntryGame - 1];
  if (input.dataset.entryField === "winner" || input.dataset.entryField === "duration") {
    game[input.dataset.entryField] = input.value;
    if (input.dataset.entryField === "winner") updateEntrySeriesScore();
    return;
  }
  if (input.dataset.entryField === "bans") {
    game[`bans${input.dataset.entrySide}`] = input.value.split(",").map((hero) => hero.trim()).filter(Boolean);
    return;
  }
  if (input.dataset.entryPick) {
    const side = input.dataset.entrySide;
    const laneIndex = Number(input.dataset.entryLane);
    if (input.dataset.entryPick === "kda") {
      const values = input.value.match(/^(\d+)\/(\d+)\/(\d+)$/);
      if (values) {
        ["kills", "deaths", "assists"].forEach((stat, index) => {
          game[`picks${side}`][laneIndex][stat] = Number(values[index + 1]);
        });
        input.setCustomValidity("");
        document.querySelector(`[data-entry-kp="${side}-${laneIndex}"]`).textContent = `${calculateEntryKp(game, side, laneIndex)}%`;
      } else {
        input.setCustomValidity("Enter K/D/A as three non-negative whole numbers, for example 4/2/7.");
      }
      return;
    }
    const pick = game[`picks${side}`][laneIndex];
    if (input.dataset.entryPick === "playerId") {
      pick.playerId = input.value;
      pick.player = getTeamRoster(document.querySelector("#entry-league").value, selectedTeamNames()[side === "A" ? "teamA" : "teamB"])
        .find((member) => member.id === input.value)?.name || "";
    } else {
      pick[input.dataset.entryPick] = input.type === "number" ? Number(input.value) : input.value;
    }
    if (["kills", "assists"].includes(input.dataset.entryPick)) {
      document.querySelector(`[data-entry-kp="${side}-${laneIndex}"]`).textContent = `${calculateEntryKp(game, side, laneIndex)}%`;
    }
  }
  if (input.dataset.entryMultiKill) {
    const { entrySide, entryLane, entryMultiKill } = input.dataset;
    game[`picks${entrySide}`][Number(entryLane)].multiKills[entryMultiKill] = Number(input.value) || 0;
  }
  if (input.dataset.entryObjective) {
    const count = Number(input.value);
    if (Number.isInteger(count) && count >= 0) {
      game[`objectives${input.dataset.entrySide}`][input.dataset.entryObjective] = count;
    }
  }
});
document.querySelector("#entry-game-panel").addEventListener("change", (event) => {
  if (event.target.dataset.entryField === "winner") updateEntrySeriesScore();
  if (event.target.dataset.entryPick === "playerId") {
    const side = event.target.dataset.entrySide;
    const laneIndex = Number(event.target.dataset.entryLane);
    const playerId = event.target.value;
    const team = selectedTeamNames()[side === "A" ? "teamA" : "teamB"];
    const player = getTeamRoster(document.querySelector("#entry-league").value, team).find((member) => member.id === playerId);
    entryGameDrafts[currentEntryGame - 1][`picks${side}`][laneIndex].playerId = playerId;
    entryGameDrafts[currentEntryGame - 1][`picks${side}`][laneIndex].player = player?.name || "";
  }
  if (event.target.dataset.entryAward && event.target.checked) {
    const { entrySide, entryLane, entryAward } = event.target.dataset;
    ["A", "B"].forEach((side) => entryGameDrafts[currentEntryGame - 1][`picks${side}`].forEach((player, index) => {
      player[entryAward] = side === entrySide && index === Number(entryLane);
    }));
  }
  if (event.target.dataset.entryPick === "hero") {
    const side = event.target.dataset.entrySide;
    const laneIndex = Number(event.target.dataset.entryLane);
    entryGameDrafts[currentEntryGame - 1][`picks${side}`][laneIndex].hero = event.target.value;
    renderEntryGamePanel();
  }
});
document.querySelector("#entry-game-panel").addEventListener("click", (event) => {
  const blueSideButton = event.target.closest("[data-blue-side]");
  if (blueSideButton) {
    entryGameDrafts[currentEntryGame - 1].blueSide = blueSideButton.dataset.blueSide;
    renderEntryGamePanel();
  }
});
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});
adminAccessModal.addEventListener("click", (event) => {
  if (event.target === adminAccessModal) closeAdminAccess();
});
detailModal.addEventListener("click", (event) => {
  if (event.target === detailModal) closeMatchDetails();
  const allGamesButton = event.target.closest("[data-games-action]");
  if (allGamesButton) {
    const match = matchDetails[currentDetailMatchId];
    const shouldCollapse = !match.games.every((game) => collapsedGames.has(game.gameNumber));
    if (shouldCollapse) match.games.forEach((game) => collapsedGames.add(game.gameNumber));
    else collapsedGames.clear();
    document.querySelector("#game-list").innerHTML = match.games.map((game) => renderBroadcastGame(match, game)).join("");
    allGamesButton.textContent = shouldCollapse ? "Show all games" : "Hide all games";
    return;
  }
  const gameButton = event.target.closest("[data-game-toggle]");
  if (gameButton) {
    const gameNumber = Number(gameButton.dataset.gameToggle);
    const details = document.querySelector(`#game-detail-${gameNumber}`);
    const expanded = details.hidden;
    if (expanded) collapsedGames.delete(gameNumber);
    else collapsedGames.add(gameNumber);
    details.hidden = !expanded;
    gameButton.setAttribute("aria-expanded", String(expanded));
    gameButton.querySelector(".game-chevron").textContent = expanded ? "−" : "+";
    const match = matchDetails[currentDetailMatchId];
    const allCollapsed = match.games.every((game) => collapsedGames.has(game.gameNumber));
    detailModal.querySelector("[data-games-action]").textContent = allCollapsed ? "Show all games" : "Hide all games";
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!detailModal.hidden) closeMatchDetails();
    else if (!databaseModal.hidden) {
      databaseModal.hidden = true;
      databaseConnectionError.hidden = true;
      document.body.style.overflow = "";
    }
    else if (!modal.hidden) closeModal();
    else if (!adminAccessModal.hidden) closeAdminAccess();
  }
});
document.querySelector("#access-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const passwordInput = document.querySelector("#access-password");
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  const accessError = document.querySelector("#access-error");
  if (productionMode) {
    submitButton.disabled = true;
    accessError.hidden = true;
    try {
      productionDatabaseAdapter.canWrite = await productionDatabaseAdapter.signIn(passwordInput.value);
      await refreshProductionData();
      accessGate.hidden = true;
      appShell.hidden = false;
      passwordInput.value = "";
    } catch (error) {
      accessError.textContent = `Could not sign in: ${error.message}`;
      accessError.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
    return;
  }
  if (!previewViewerPassword || passwordInput.value !== previewViewerPassword) {
    accessError.hidden = false;
    passwordInput.select();
    return;
  }
  submitButton.disabled = true;
  accessGate.hidden = true;
  appShell.hidden = false;
  accessError.hidden = true;
  passwordInput.value = "";
  submitButton.disabled = false;
  const savedConnection = sessionStorage.getItem(databaseSessionKey);
  if (savedConnection) {
    try {
      const { url, anonKey, accessToken, refreshToken } = JSON.parse(savedConnection);
      connectToDatabase(url, anonKey, { accessToken, refreshToken }).catch((error) => {
        updateDatabaseStatus(false, "Connection failed · sample data");
        showToast(`Could not restore Supabase connection: ${error.message}`);
      });
    } catch (error) {
      sessionStorage.removeItem(databaseSessionKey);
      showToast(`Saved Supabase session is invalid: ${error.message}`);
    }
  }
});
document.querySelector("#admin-access-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const passwordInput = document.querySelector("#admin-password");
  if (productionMode) {
    const submitButton = event.currentTarget.querySelector("button[type='submit']");
    submitButton.disabled = true;
    const errorMessage = document.querySelector("#admin-access-error");
    errorMessage.hidden = true;
    try {
      const isAdmin = await productionDatabaseAdapter.signInAdmin(passwordInput.value);
      if (!isAdmin) {
        errorMessage.textContent = "Incorrect admin password. Try again.";
        errorMessage.hidden = false;
        passwordInput.select();
        return;
      }
      productionDatabaseAdapter.canWrite = true;
      hasAdminAccess = true;
      await refreshProductionData();
      document.querySelector("#role-indicator").textContent = "Admin mode";
      const action = pendingAdminAction || openModal;
      pendingAdminAction = null;
      closeAdminAccess();
      action();
    } catch (error) {
      errorMessage.textContent = `Could not verify admin access: ${error.message}`;
      errorMessage.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
    return;
  }
  if (!previewAdminPassword || passwordInput.value !== previewAdminPassword) {
    document.querySelector("#admin-access-error").hidden = false;
    passwordInput.select();
    return;
  }
  hasAdminAccess = true;
  document.querySelector("#role-indicator").textContent = "Admin mode";
  const action = pendingAdminAction || openModal;
  pendingAdminAction = null;
  closeAdminAccess();
  action();
});
document.querySelector("#sign-out-button").addEventListener("click", () => {
  if (productionMode) {
    productionDatabaseAdapter.signOut().then(() => {
      productionDatabaseAdapter.canWrite = false;
      hasAdminAccess = false;
      sessionStorage.removeItem(databaseSessionKey);
      appShell.hidden = true;
      accessGate.hidden = false;
      document.querySelector("#role-indicator").textContent = "Viewer mode";
      document.body.style.overflow = "";
      document.querySelector("#access-form").reset();
      document.querySelector("#access-error").hidden = true;
    }).catch((error) => showToast(`Could not sign out: ${error.message}`));
    return;
  }
  hasAdminAccess = false;
  sessionStorage.removeItem(databaseSessionKey);
  appShell.hidden = true;
  accessGate.hidden = false;
  document.querySelector("#role-indicator").textContent = "Viewer mode";
  document.body.style.overflow = "";
  document.querySelector("#access-form").reset();
  document.querySelector("#access-error").hidden = true;
});
document.querySelector("#match-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const previewMatch = buildEntryPreviewMatch();
  if (previewMatch.streamUrl && !/^https?:\/\//i.test(previewMatch.streamUrl)) {
    showToast("Use an http or https link for the live stream.");
    return;
  }
  if (previewMatch.globalBanPick) {
    const usedHeroes = { A: new Set(), B: new Set() };
    for (const game of previewMatch.games) {
      for (const side of ["A", "B"]) {
        const team = side === "A" ? previewMatch.teamA : previewMatch.teamB;
        for (const player of game[`players${side}`]) {
          if (usedHeroes[side].has(player.hero)) {
            showToast(`${team} already picked ${player.hero}. Global Ban & Pick does not allow a team to reuse its own picks in a series.`);
            return;
          }
          usedHeroes[side].add(player.hero);
        }
      }
    }
  }
  if (previewMatch.games.some((game) => [...game.playersA, ...game.playersB].some((player) => !player.playerId))) {
    showToast("Register all five active-role players for both teams before entering match stats.");
    return;
  }
  if (!previewMatch.games.length || previewMatch.scoreA === previewMatch.scoreB) {
    showToast("Choose game winners that produce a series winner.");
    return;
  }
  const requiredWins = Math.floor(entryGameDrafts.length / 2) + 1;
  if (Math.max(previewMatch.scoreA, previewMatch.scoreB) < requiredWins) {
    showToast(`Select results until one team wins ${requiredWins} games.`);
    return;
  }
  let winsA = 0;
  let winsB = 0;
  let seriesDecidedAt = -1;
  entryGameDrafts.forEach((game, index) => {
    if (seriesDecidedAt !== -1 || !game.winner) return;
    if (game.winner === previewMatch.teamA) winsA += 1;
    if (game.winner === previewMatch.teamB) winsB += 1;
    if (Math.max(winsA, winsB) === requiredWins) seriesDecidedAt = index;
  });
  if (seriesDecidedAt < entryGameDrafts.length - 1 && entryGameDrafts.slice(seriesDecidedAt + 1).some((game) => game.winner)) {
    showToast("Remove game results after the series is decided.");
    return;
  }
  if (productionDatabaseAdapter?.canWrite) {
    const saveButton = document.querySelector("#save-match-button");
    saveButton.disabled = true;
    try {
      await productionDatabaseAdapter.saveMatch(previewMatch);
      closeModal();
      await finishDatabaseWrite("Match result and game stats saved to Supabase.");
    } catch (error) {
      showToast(`Match was not saved: ${error.message}`);
    } finally {
      saveButton.disabled = false;
    }
    return;
  }
  matchDetails["entry-preview"] = previewMatch;
  closeModal();
  openMatchDetails("entry-preview");
  showToast("Sample result preview only — nothing was saved.");
});
document.querySelector("#theme-button").addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");
  showToast(document.body.classList.contains("dark-mode") ? "Dark mode enabled." : "Light mode enabled.");
});

bindMatchPage();
