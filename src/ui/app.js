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
let productionDatabaseAdapter = null;
let toastTimeout;
let realtimeRefreshTimer;
let refreshInProgress = false;
let editingMatchId = "";
let currentDetailMatchId = "";
const collapsedGames = new Set();
let currentEntryGame = 1;
let entryGameDrafts = [];
let pendingAdminAction = null;
let leagueTeams = {};
let tournamentSettings = {};
const teamRosters = new Map();
const qualificationRoutes = ["Open Qualifier", "Invited", "Wildcard", "Closed Qualifier", "Group Stage"];

const lanes = ["Clash Lane", "Jungle", "Mid Lane", "Farm Lane", "Roam"];
const playerRoles = [...lanes, "Fill"];
const rosterRoles = [...playerRoles, "Coach", "Analyst", "Manager"];
const laneIconKeys = {
  "Clash Lane": "clash",
  Jungle: "jungle",
  "Mid Lane": "mid",
  "Farm Lane": "farm",
  Roam: "roam",
  Fill: "fill",
};
const heroOptions = [...new Set([
  "Allain", "Angela", "Arli", "Augran", "Biron", "Charlotte", "Consort Yu", "Da Qiao",
  "Daji", "Dharma", "Dolia", "Dyadia", "Gan & Mo", "Garo", "Guiguzi", "Hou Yi", "Jing",
  "Kui", "Lady Zhen", "Li Xin", "Liu Shan", "Loong", "Luban No. 7", "Mai Shiranui",
  "Marco Polo", "Mayene", "Musashi", "Nakoruru", "Pei", "Shangguan", "Sun Ce", "Zhang Fei",
  "Arthur", "Bian Que", "Cai Wenji", "Diao Chan", "Erin", "Gongsun Li", "Han Xin",
  "Li Bai", "Lu Bu", "Luna", "Mulan", "Mozi", "Nezha", "Sun Bin", "Wukong",
  "Xiang Yu", "Ying", "Yuhuan", "Zhuang Zhou", "Zilong", "Dun", "Huang Zhong",
  "Liu Bang", "Zhou Yu", "Dian Wei", "Xiahou Dun", "Lady Sun", "Ming", "Sima Yi",
  "Zhang Liang", "Zhang Fei", "Donghuang", "Yaria", "Lam", "Dolia", "Augran",
])].sort();

function renderLaneLabel(lane, short = false) {
  const label = short ? String(lane).replace(" Lane", "") : String(lane);
  const iconKey = laneIconKeys[lane];
  if (!iconKey) return escapeHTML(label);
  return `<span class="lane-label"><span class="lane-icon lane-icon-${iconKey}" aria-hidden="true"></span><span>${escapeHTML(label)}</span></span>`;
}

function normalizeRosterRole(role) {
  if (role === "Substitute" || role === "Flex") return "Fill";
  return rosterRoles.includes(role) ? role : "Fill";
}

function normalizeSecondaryRole(role, primaryRole) {
  const normalized = role === "Flex" ? "Fill" : role;
  return playerRoles.includes(normalized) && normalized !== primaryRole ? normalized : "";
}

function renderRoleOptions(selectedRole, includeStaff = true) {
  const options = includeStaff ? rosterRoles : playerRoles;
  return options.map((role) => `<option value="${escapeHTML(role)}" ${role === selectedRole ? "selected" : ""}>${escapeHTML(role)}</option>`).join("");
}

function renderSecondaryRoleOptions(selectedRole = "", primaryRole = "") {
  return `<option value="">No second role</option>${playerRoles.map((role) => `<option value="${escapeHTML(role)}" ${role === selectedRole ? "selected" : ""} ${role === primaryRole ? "disabled" : ""}>${escapeHTML(role)}</option>`).join("")}`;
}

function canPlayLane(player, lane) {
  return player.role === lane || player.secondaryRole === lane || player.role === "Fill" || player.secondaryRole === "Fill";
}

function findRosterPlayerForLane(roster, lane, usedIds = new Set()) {
  const available = roster.filter((player) => !usedIds.has(player.id) && canPlayLane(player, lane));
  return available.find((player) => !player.isSubstitute && player.role === lane)
    || available.find((player) => !player.isSubstitute && player.secondaryRole === lane)
    || available.find((player) => !player.isSubstitute)
    || available.find((player) => player.role === lane)
    || available.find((player) => player.secondaryRole === lane)
    || available[0];
}

function calculatePlayerKp(players, player) {
  const teamKills = players.reduce((total, entry) => total + (Number(entry.kills) || 0), 0);
  return teamKills ? Math.round(((Number(player.kills) + Number(player.assists)) / teamKills) * 100) : 0;
}

let matchDetails = {};
let leagueOptions = [];
let activePage = "matches";
let standingsStage = "group";
let playerStatsSort = { key: "kda", direction: "desc" };
const playerStatsFilters = {};
const themeStorageKey = "hokdb_color_theme";

function rosterKey(tournament, team) {
  return `${tournament}|${team}`;
}

function getTeamRoster(tournament, team) {
  const key = rosterKey(tournament, team);
  if (!teamRosters.has(key)) teamRosters.set(key, []);
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
    hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: "Asia/Jakarta"
  }).format(date);
}

function getMatchInstant(match) {
  if (match.scheduledAt) {
    const instant = new Date(match.scheduledAt);
    if (!Number.isNaN(instant.getTime())) return instant;
  }
  const date = match.dateISO || toDateInputValue(match.date);
  const rawTime = String(match.entryTime || match.time || "").trim();
  const time = rawTime.match(/(\d{1,2})[:.](\d{2})(?:\s*(AM|PM))?/i);
  if (!date || !time) return null;
  let hours = Number(time[1]);
  if (time[3]) {
    hours %= 12;
    if (time[3].toUpperCase() === "PM") hours += 12;
  }
  const instant = new Date(`${date}T${String(hours).padStart(2, "0")}:${time[2]}:00+07:00`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function getMatchLocalDate(match) {
  const instant = getMatchInstant(match);
  return instant ? formatDatabaseDate(instant) : match.date || "";
}

function getMatchLocalTime(match) {
  const instant = getMatchInstant(match);
  return instant ? formatDatabaseDate(instant, true) : match.time || "";
}

function getMatchLocalDateParts(match) {
  const instant = getMatchInstant(match);
  if (!instant) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Jakarta"
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function getGmt7Parts(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function normalizeMatchFormat(format) {
  const normalized = String(format || "BO1").replace(/\s/g, "").toUpperCase();
  return ["BO1", "BO3", "BO5", "BO7"].includes(normalized) ? normalized : "BO1";
}

function isPlayoffStage(stage) {
  return /\b(play[\s-]?ins?|playoffs?|upper bracket|lower bracket|quarter ?finals?|semi ?finals?|grand final)\b/i.test(String(stage || ""));
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
    scheduledAt,
    league: row.league || "Unassigned tournament",
    teamA: row.team_a || "Team A",
    teamB: row.team_b || "Team B",
    scoreA: Number(row.score_a) || 0,
    scoreB: Number(row.score_b) || 0,
    format: normalizeMatchFormat(row.format),
    stage: row.stage || "Match",
    phase: row.is_playoff || isPlayoffStage(row.stage) ? "Playoffs" : "Group Stage",
    date: formatDatabaseDate(scheduledAt),
    dateISO: getGmt7Parts(scheduledAt)?.date || "",
    entryTime: getGmt7Parts(scheduledAt)?.time || "",
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
  const stage = row.match_code || "Scheduled match";
  const phase = isPlayoffStage(stage)
    ? "Playoffs"
    : "Group Stage";
  return {
    scheduledAt,
    league: row.league || "Unassigned tournament",
    teamA: row.team_a || "Team A",
    teamB: row.team_b || "Team B",
    format: normalizeMatchFormat(row.format),
    stage,
    phase,
    date: formatDatabaseDate(scheduledAt),
    dateISO: getGmt7Parts(scheduledAt)?.date || "",
    entryTime: getGmt7Parts(scheduledAt)?.time || "",
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

function applyDatabaseRows({ matchRows, scheduleRows, rosterRows, tournamentRows }) {
  const nextRosters = new Map();
  rosterRows.forEach((row) => {
    const tournament = row.league || "Unassigned tournament";
    const team = row.team || "Unassigned team";
    const key = rosterKey(tournament, team);
    const members = nextRosters.get(key) || [];
    const legacySubstitute = row.position === "Substitute";
    const role = normalizeRosterRole(row.position);
    members.push({
      id: String(row.id),
      name: row.name || "Unknown player",
      role,
      secondaryRole: normalizeSecondaryRole(row.secondary_position, role),
      isSubstitute: legacySubstitute || row.is_substitute === true,
      identity: row.real_name || "",
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
      globalBanPick: !!(data.globalBanPick ?? data.fearlessDraft),
      playoffsEnabled: !!data.playoffsEnabled,
      bracketFormat: data.bracketFormat === "single-elimination" ? "single-elimination" : "double-elimination",
      playInEnabled: !!data.playInEnabled || Object.values(nextMatches).some((match) =>
        match.league === name && /\bplay[\s-]?in/i.test(match.stage || "")
      ),
      participants,
    };
  });
  Object.values(nextMatches).forEach((match) => {
    if (!nextSettings[match.league]) {
      nextSettings[match.league] = { globalBanPick: false, playoffsEnabled: false, bracketFormat: "double-elimination", playInEnabled: false, participants: [] };
    }
    if (match.phase === "Playoffs") {
      nextSettings[match.league].playoffsEnabled = true;
      if (/\bplay[\s-]?in/i.test(match.stage || "")) nextSettings[match.league].playInEnabled = true;
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
    if (!nextSettings[league]) nextSettings[league] = { globalBanPick: false, playoffsEnabled: false, bracketFormat: "double-elimination", playInEnabled: false, participants: [] };
    if (!nextSettings[league].participants.some((participant) => participant.team === team)) {
      nextSettings[league].participants.push({ team, abbreviation: team.slice(0, 3).toUpperCase(), route: "" });
    }
  });
  return { matches: nextMatches, rosters: nextRosters, settings: nextSettings };
}

async function refreshProductionData() {
  if (!productionDatabaseAdapter || refreshInProgress) return;
  refreshInProgress = true;
  const selectedLeague = activePage === "matches"
    ? document.querySelector("#league-select")?.value
    : document.querySelector("[data-module-league]")?.value;
  try {
    const rows = await productionDatabaseAdapter.load();
    const snapshot = applyDatabaseRows(rows);
    matchDetails = snapshot.matches;
    teamRosters.clear();
    snapshot.rosters.forEach((members, key) => teamRosters.set(key, members));
    tournamentSettings = snapshot.settings;
    leagueTeams = Object.fromEntries(Object.entries(snapshot.settings).map(([league, config]) => [
      league, config.participants.map((participant) => participant.team)
    ]));
    leagueOptions = Object.keys(tournamentSettings);
    updateAdminControls();
    setPage(activePage);
    if (selectedLeague && activePage === "matches") {
      const selector = document.querySelector("#league-select");
      if ([...selector.options].some((option) => option.value === selectedLeague)) {
        selector.value = selectedLeague;
        updateLeagueView();
      }
    } else if (selectedLeague && activePage !== "tournaments" && leagueOptions.includes(selectedLeague)) {
      renderModulePage(activePage, selectedLeague);
    }
  } finally {
    refreshInProgress = false;
  }
}

function canRefreshRealtimeData() {
  return productionDatabaseAdapter
    && !appShell.hidden
    && document.visibilityState === "visible"
    && modal.hidden
    && adminAccessModal.hidden
    && detailModal.hidden;
}

function startRealtimeRefresh() {
  clearInterval(realtimeRefreshTimer);
  realtimeRefreshTimer = setInterval(() => {
    if (canRefreshRealtimeData()) refreshProductionData().catch(() => {});
  }, 15000);
}

function stopRealtimeRefresh() {
  clearInterval(realtimeRefreshTimer);
  realtimeRefreshTimer = undefined;
}

function updateAdminControls() {
  const canEdit = !!productionDatabaseAdapter?.canWrite;
  const tournamentTab = document.querySelector('.nav-item[data-page="tournaments"]');
  if (tournamentTab) tournamentTab.hidden = !canEdit;
  const addMatchButton = document.querySelector("#add-match-button");
  if (addMatchButton) addMatchButton.hidden = !canEdit;
  const adminButton = document.querySelector("#admin-toggle-button");
  if (adminButton) {
    adminButton.hidden = accessGate && !accessGate.hidden;
    adminButton.textContent = canEdit ? "Admin ✓" : "Admin";
    adminButton.setAttribute("aria-pressed", String(canEdit));
  }
}

export function configureProduction(adapter) {
  document.title = "HOK Database · Level Up Indonesia";
  productionDatabaseAdapter = adapter;
  document.querySelector("#access-form label[for='access-password']").textContent = "Viewer password";
  document.querySelector("#access-gate .access-panel > p:not(.eyebrow)").textContent = "Enter the viewer password to browse match results, drafts, and team stats.";
  document.querySelector("#access-password").focus();
  document.querySelector("#continue-to-entry").textContent = "Enter results →";
  document.querySelector("#save-match-button").textContent = "Save completed match →";
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
    updateAdminControls();
    startRealtimeRefresh();
  } catch (error) {
    const accessError = document.querySelector("#access-error");
    accessError.textContent = `Could not restore Supabase session: ${error.message}`;
    accessError.hidden = false;
  }
}

function getTournamentPayload() {
  return leagueOptions.map((name) => {
    const config = tournamentSettings[name];
    const rawData = { ...(config.rawData || {}) };
    delete rawData.defaultFormat;
    const abbreviations = {};
    const qualifications = {};
    config.participants.forEach((participant) => {
      abbreviations[participant.team] = participant.abbreviation;
      qualifications[participant.team] = participant.route;
    });
    return {
      ...rawData,
      id: config.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name,
      fearlessDraft: !!config.globalBanPick,
      playoffsEnabled: !!config.playoffsEnabled,
      bracketFormat: config.bracketFormat || "double-elimination",
      playInEnabled: !!config.playInEnabled,
      teamsText: config.participants.map((participant) => participant.team).join("\n"),
      teamAbbreviations: abbreviations,
      teamQualifications: qualifications,
    };
  });
}

async function persistTournamentChanges() {
  if (!productionDatabaseAdapter?.canWrite) throw new Error("Admin database access is required.");
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setPage(page) {
  const label = pageLabels[page];
  if (!label) return;
  if (page === "tournaments" && !productionDatabaseAdapter?.canWrite) return;
  activePage = page;
  navItems.forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.title = `${label} · HOK Database`;

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
  if (league !== "all") return leagueTeams[league] || [];
  return [...new Set(leagueOptions.flatMap((tournament) => getLeagueTeams(tournament)))];
}

function getTeamAbbreviation(tournament, team) {
  return tournamentSettings[tournament]?.participants.find((participant) => participant.team === team)?.abbreviation
    || team.split(/\s+/).map((part) => part[0]).join("").slice(0, 5).toUpperCase();
}

function getPlayoffStageOptions(tournament) {
  const config = tournamentSettings[tournament] || {};
  const stages = config.bracketFormat === "single-elimination"
    ? ["Round 1", "Quarterfinals", "Semifinals", "Grand Final"]
    : ["Upper Bracket Quarterfinals", "Upper Bracket Semifinals", "Upper Bracket Final", "Lower Bracket Round 1", "Lower Bracket Quarterfinals", "Lower Bracket Semifinals", "Lower Bracket Final", "Grand Final"];
  return config.playInEnabled ? ["Play-In Stage", ...stages] : stages;
}

function normalizeBracketStage(stage, phase) {
  const label = String(stage || "").trim();
  if (!label) return phase === "Playoffs" ? "Playoffs" : "Group Stage";
  const normalized = label.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\bplay[\s-]?in(s)?\b/.test(normalized)) return "Play-In Stage";
  if (/\bgrand final\b/.test(normalized)) return "Grand Final";
  if (/\bupper\b/.test(normalized) && /\bquarter ?finals?\b/.test(normalized)) return "Upper Bracket Quarterfinals";
  if (/\bupper\b/.test(normalized) && /\bsemi ?finals?\b/.test(normalized)) return "Upper Bracket Semifinals";
  if (/\bupper\b/.test(normalized) && /\bfinal\b/.test(normalized)) return "Upper Bracket Final";
  if (/\blower\b/.test(normalized) && /\bround\s*1\b/.test(normalized)) return "Lower Bracket Round 1";
  if (/\blower\b/.test(normalized) && /\bquarter ?finals?\b/.test(normalized)) return "Lower Bracket Quarterfinals";
  if (/\blower\b/.test(normalized) && /\bsemi ?finals?\b/.test(normalized)) return "Lower Bracket Semifinals";
  if (/\blower\b/.test(normalized) && /\bfinal\b/.test(normalized)) return "Lower Bracket Final";
  if (/\bquarter ?finals?\b/.test(normalized)) return "Quarterfinals";
  if (/\bsemi ?finals?\b/.test(normalized)) return "Semifinals";
  if (/^round\s+\d+$/.test(normalized)) return `Round ${normalized.match(/\d+$/)[0]}`;
  if (/^playoffs?\s+round\s+\d+$/.test(normalized)) return `Playoffs Round ${normalized.match(/\d+$/)[0]}`;
  if (/^(group|group stage)(\s|$)/.test(normalized)) return label.replace(/^group$/i, "Group Stage");
  return label;
}

function getBracketStageOrder(stage) {
  const order = [
    "Play-In Stage", "Round 1", "Playoffs Round 1", "Upper Bracket Quarterfinals",
    "Lower Bracket Round 1", "Upper Bracket Semifinals", "Lower Bracket Quarterfinals",
    "Upper Bracket Final", "Lower Bracket Semifinals",
    "Lower Bracket Final", "Final", "Grand Final",
  ];
  const index = order.indexOf(stage);
  return index < 0 ? order.length : index;
}

function renderModuleHeading() {
  const options = [...leagueOptions, "All leagues"].map((league) =>
    `<option value="${escapeHTML(league === "All leagues" ? "all" : league)}">${escapeHTML(league)}</option>`
  ).join("");
  return `<section class="page-heading module-page-heading">
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
        name: player.player, team, tournament: match.league, lane: player.lane, games: 0,
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
  const phaseMatches = Object.values(matchDetails).filter((match) =>
    (league === "all" || match.league === league)
    && match.phase !== "Playoffs"
  );
  const teams = getLeagueTeams(league);
  const standings = new Map(teams.map((team) => [team, {
    team, played: 0, wins: 0, losses: 0, gameWins: 0, gameLosses: 0
  }]));
  phaseMatches.forEach((match) => {
    [match.teamA, match.teamB].forEach((team) => {
      if (!standings.has(team)) standings.set(team, { team, played: 0, wins: 0, losses: 0, gameWins: 0, gameLosses: 0 });
    });
    const a = standings.get(match.teamA);
    const b = standings.get(match.teamB);
    if (!match.finished) return;
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
  const playoffAvailable = league === "all"
    ? leagueOptions.some((tournament) => tournamentSettings[tournament]?.playoffsEnabled)
    : !!tournamentSettings[league]?.playoffsEnabled;
  if (!playoffAvailable && standingsStage === "playoffs") standingsStage = "group";
  const stageSelector = `<label class="select-wrap"><span class="sr-only">Standings stage</span><select data-standings-stage aria-label="Standings stage"><option value="group" ${standingsStage === "group" ? "selected" : ""}>Group Stage</option>${playoffAvailable ? `<option value="playoffs" ${standingsStage === "playoffs" ? "selected" : ""}>Playoffs</option>` : ""}</select><span class="select-chevron">⌄</span></label>`;
  if (standingsStage === "playoffs") return renderPlayoffBrackets(league, stageSelector);
  const standings = getStandings(league);
  return `<section class="content-card module-card">
    <div class="section-heading standings-heading"><div><h2>Group Stage standings</h2></div>${stageSelector}</div>
    <div class="module-table-wrap"><table class="module-table"><thead><tr><th>#</th><th>TEAM</th><th>MP</th><th>W</th><th>L</th><th>GAME SCORE</th><th>GAME DIFF</th></tr></thead>
      <tbody>${standings.map((row, index) => `<tr><td class="rank-cell">${String(index + 1).padStart(2, "0")}</td><td><strong class="module-team-name">${escapeHTML(row.team)}</strong></td><td>${row.played}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.gameWins}-${row.gameLosses}</td><td><strong>${row.gameDiff > 0 ? "+" : ""}${row.gameDiff}</strong></td></tr>`).join("")}</tbody>
    </table></div>
  </section>`;
}

function renderPlayoffBrackets(league, stageSelector) {
  const tournaments = league === "all"
    ? leagueOptions.filter((entry) => tournamentSettings[entry]?.playoffsEnabled)
    : [league];
  const brackets = tournaments.map((tournament) => {
    const matches = Object.entries(matchDetails)
      .filter(([, match]) => match.league === tournament && match.phase === "Playoffs")
      .map(([id, match]) => ({ ...match, id }));
    const rounds = new Map();
    matches.forEach((match) => {
      const stage = normalizeBracketStage(match.stage, match.phase);
      if (!rounds.has(stage)) rounds.set(stage, []);
      rounds.get(stage).push(match);
    });
    const sortedRounds = [...rounds.entries()].sort(([stageA], [stageB]) =>
      getBracketStageOrder(stageA) - getBracketStageOrder(stageB) || stageA.localeCompare(stageB)
    );
    const roundMarkup = sortedRounds.map(([stage, stageMatches]) => `<section class="bracket-round">
      <header><span>${escapeHTML(stage)}</span><small>${stageMatches.length} ${stageMatches.length === 1 ? "match" : "matches"}</small></header>
      <div class="bracket-round-matches">${stageMatches.sort((a, b) => getMatchInstant(a) - getMatchInstant(b)).map((match) => {
        const completed = match.finished && Number.isInteger(match.scoreA) && Number.isInteger(match.scoreB);
        const winner = completed ? (match.scoreA > match.scoreB ? match.teamA : match.teamB) : "";
        return `<article class="bracket-match" data-open-match="${escapeHTML(match.id)}" tabindex="0" role="button" aria-label="Open ${escapeHTML(match.teamA)} versus ${escapeHTML(match.teamB)} details">
          <div class="bracket-match-meta"><span>${escapeHTML(getMatchLocalDate(match) || "Date TBD")}</span><span>${escapeHTML(match.format || "")}</span></div>
          <div class="bracket-team ${winner === match.teamA ? "bracket-winner" : ""}"><span>${escapeHTML(match.teamA)}</span><strong>${completed ? match.scoreA : "–"}</strong></div>
          <div class="bracket-team ${winner === match.teamB ? "bracket-winner" : ""}"><span>${escapeHTML(match.teamB)}</span><strong>${completed ? match.scoreB : "–"}</strong></div>
        </article>`;
      }).join("")}</div>
    </section>`).join("");
    return `<section class="playoff-tournament"><div class="playoff-tournament-heading"><h3>${escapeHTML(tournament)}</h3><span>${tournamentSettings[tournament]?.bracketFormat === "single-elimination" ? "Single elimination" : "Double elimination"}</span></div>
      ${roundMarkup ? `<div class="playoff-bracket-scroll"><div class="playoff-bracket">${roundMarkup}</div></div>` : '<p class="bracket-empty">No playoff matches have been scheduled yet.</p>'}
    </section>`;
  }).join("");
  return `<section class="content-card module-card playoff-module">
    <div class="section-heading standings-heading"><div><h2>Playoffs bracket</h2><p>Rounds and results are built from playoff matches.</p></div>${stageSelector}</div>
    ${brackets || '<p class="bracket-empty">No playoff tournament is available.</p>'}
  </section>`;
}

function renderPlayerStats(league) {
  const columns = [
    { key: "name", label: "PLAYER", numeric: false }, { key: "team", label: "TEAM", numeric: false },
    { key: "games", label: "GAMES", numeric: true }, { key: "kdaLine", label: "K/D/A", numeric: false },
    { key: "kda", label: "KDA", numeric: true }, { key: "kp", label: "KP", numeric: true },
    { key: "goldAverage", label: "GOLD", numeric: true }, { key: "damageAverage", label: "HERO DMG", numeric: true },
    { key: "damageTakenAverage", label: "DMG TAKEN", numeric: true },
    ...[1, 2, 3, 4, 5].map((count) => ({ key: `multi${count}`, label: `${count}K`, numeric: true })),
    { key: "mvp", label: "MVP", numeric: true }, { key: "firstBlood", label: "FIRST BLOOD", numeric: true },
  ];
  const players = collectPlayerStats(league).map((player) => ({
    ...player,
    teamLabel: getTeamAbbreviation(player.tournament, player.team),
    kdaLine: `${player.kills}/${player.deaths}/${player.assists}`,
    goldAverage: Math.round(player.gold / player.games),
    damageAverage: Math.round(player.damage / player.games),
    damageTakenAverage: Math.round(player.damageTaken / player.games),
    ...Object.fromEntries([1, 2, 3, 4, 5].map((count) => [`multi${count}`, player.multiKills[count]])),
  }));
  const valueFor = (player, key) => key === "team" ? player.teamLabel : player[key];
  players.sort((a, b) => {
    const column = columns.find((entry) => entry.key === playerStatsSort.key) || columns[0];
    const valueA = valueFor(a, column.key);
    const valueB = valueFor(b, column.key);
    const comparison = column.numeric
      ? Number(valueA) - Number(valueB)
      : String(valueA).localeCompare(String(valueB), undefined, { numeric: true, sensitivity: "base" });
    return playerStatsSort.direction === "asc" ? comparison : -comparison;
  });
  const sortHeader = (column) => {
    const active = playerStatsSort.key === column.key;
    const direction = active ? playerStatsSort.direction : "none";
    const icon = active ? (direction === "asc" ? "↑" : "↓") : "↕";
    return `<button type="button" class="player-sort-button ${active ? "active" : ""}" data-player-sort="${column.key}" data-numeric="${column.numeric}" aria-label="Sort ${escapeHTML(column.label)} ${direction === "asc" ? "descending" : "ascending"}">${escapeHTML(column.label)} <span>${icon}</span></button>`;
  };
  const filterRow = columns.map((column) => `<th><input class="player-column-filter" data-player-filter="${column.key}" value="${escapeHTML(playerStatsFilters[column.key] || "")}" placeholder="Filter" aria-label="Filter ${escapeHTML(column.label)}" /></th>`).join("");
  return `<section class="content-card module-card">
    <div class="section-heading player-stats-heading"><div><h2>Player leaderboard</h2><p id="player-filter-count">${players.length} players</p></div><button type="button" class="button button-secondary" id="clear-player-filters">Clear filters</button></div>
    <div class="module-table-wrap"><table class="module-table player-module-table"><thead><tr>${columns.map(sortHeader).map((header) => `<th>${header}</th>`).join("")}</tr><tr class="player-filter-row">${filterRow}</tr></thead>
      <tbody>${players.map((player, index) => {
        const values = columns.map((column) => String(valueFor(player, column.key)));
        const valueAttributes = values.map((value, columnIndex) => ` data-filter-value="${escapeHTML(value.toLowerCase())}" data-filter-column="${columns[columnIndex].key}"`);
        return `<tr class="player-stat-row"><td${valueAttributes[0]}><span class="player-rank">${String(index + 1).padStart(2, "0")}</span><strong class="module-team-name">${escapeHTML(player.name)}</strong><small class="table-sub">${renderLaneLabel(player.lane)}</small></td><td${valueAttributes[1]}>${escapeHTML(player.teamLabel)}</td><td${valueAttributes[2]}>${player.games}</td><td${valueAttributes[3]}>${player.kdaLine}</td><td${valueAttributes[4]}><strong>${player.kda}</strong></td><td${valueAttributes[5]}>${player.kp}%</td><td${valueAttributes[6]}>${player.goldAverage.toLocaleString("en-US")}</td><td${valueAttributes[7]}>${player.damageAverage.toLocaleString("en-US")}</td><td${valueAttributes[8]}>${player.damageTakenAverage.toLocaleString("en-US")}</td>${[1, 2, 3, 4, 5].map((count, offset) => `<td${valueAttributes[9 + offset]}>${player[`multi${count}`]}</td>`).join("")}<td${valueAttributes[14]}>${player.mvp}</td><td${valueAttributes[15]}>${player.firstBlood}</td></tr>`;
      }).join("")}</tbody>
    </table></div>
  </section>`;
}

function bindPlayerStatsControls(league) {
  const applyFilters = () => {
    const filters = [...document.querySelectorAll("[data-player-filter]")].map((input) => {
      const value = input.value.trim().toLowerCase();
      playerStatsFilters[input.dataset.playerFilter] = input.value;
      return { key: input.dataset.playerFilter, value };
    });
    let visible = 0;
    document.querySelectorAll(".player-stat-row").forEach((row) => {
      const matches = filters.every(({ key, value }) => !value || row.querySelector(`[data-filter-column="${key}"]`)?.dataset.filterValue.includes(value));
      row.hidden = !matches;
      if (matches) {
        visible += 1;
        row.querySelector(".player-rank").textContent = String(visible).padStart(2, "0");
      }
    });
    document.querySelector("#player-filter-count").textContent = `${visible} players`;
  };
  document.querySelectorAll("[data-player-filter]").forEach((input) => input.addEventListener("input", applyFilters));
  document.querySelectorAll("[data-player-sort]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.playerSort;
    playerStatsSort = playerStatsSort.key === key
      ? { key, direction: playerStatsSort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: button.dataset.numeric === "true" ? "desc" : "asc" };
    renderModulePage("players", league);
  }));
  document.querySelector("#clear-player-filters")?.addEventListener("click", () => {
    Object.keys(playerStatsFilters).forEach((key) => delete playerStatsFilters[key]);
    document.querySelectorAll("[data-player-filter]").forEach((input) => { input.value = ""; });
    applyFilters();
  });
  applyFilters();
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
  const canEdit = !!productionDatabaseAdapter?.canWrite;
  return `<section class="roster-summary-grid"><article class="roster-summary"><span>TEAMS</span><strong>${teams.length}</strong><small>In selected league</small></article><article class="roster-summary"><span>REGISTERED PLAYERS</span><strong>${roster.length}</strong><small>Players</small></article></section>
    <section class="content-card module-card"><div class="section-heading"><div><h2>Team rosters</h2><p>Roster grouped by tournament and team.</p></div></div>
      <div class="roster-team-grid">${teams.map(({ team, tournament }) => {
        const members = roster.filter((player) => player.team === team && player.tournament === tournament);
        const qualificationRoute = tournamentSettings[tournament]?.participants
          .find((participant) => participant.team === team)?.route || "Route not set";
        const memberRows = members.map((player) => {
          const primaryRole = normalizeRosterRole(player.lane);
          const secondaryRole = normalizeSecondaryRole(player.secondaryRole, primaryRole);
          const secondaryLabel = secondaryRole
            ? `<small class="roster-secondary-role"><b>2ND</b>${renderLaneLabel(secondaryRole, true)}</small>`
            : "";
          const statusBadge = player.isSubstitute ? '<small class="roster-status-sub">SUBS</small>' : "";
          return `<div class="roster-player-row"><span class="roster-role">${renderLaneLabel(primaryRole, true)}${secondaryLabel}</span><strong title="${escapeHTML(player.identity || player.id)}"><span>${escapeHTML(player.name)}${player.identity ? ` <small>· ${escapeHTML(player.identity)}</small>` : ""}</span>${statusBadge}</strong>${canEdit ? `<button type="button" class="roster-edit-toggle" data-toggle-roster-edit="${escapeHTML(player.id)}" aria-expanded="false">Edit</button><button type="button" class="danger-button" data-remove-roster="${escapeHTML(player.id)}" data-roster-team="${escapeHTML(team)}" data-roster-tournament="${escapeHTML(tournament)}">Remove</button><form class="roster-edit-form" data-edit-roster="${escapeHTML(player.id)}" data-roster-team="${escapeHTML(team)}" data-roster-tournament="${escapeHTML(tournament)}" hidden><label>Nickname<input name="name" required maxlength="40" value="${escapeHTML(player.name)}" /></label><label>Identity note<input name="identity" maxlength="60" value="${escapeHTML(player.identity || "")}" /></label><label>Primary role<select name="role">${renderRoleOptions(primaryRole)}</select></label><label><span>Second role <small>Optional</small></span><select name="secondaryRole">${renderSecondaryRoleOptions(secondaryRole, primaryRole)}</select></label><label>Roster status<select name="status"><option value="starter" ${player.isSubstitute ? "" : "selected"}>Starter</option><option value="substitute" ${player.isSubstitute ? "selected" : ""}>Substitute</option></select></label><button type="submit" class="button button-secondary">Save player</button></form>` : ""}</div>`;
        }).join("");
        const addForm = canEdit ? `<form class="roster-add-form" data-add-roster="${escapeHTML(tournament)}" data-roster-team="${escapeHTML(team)}">
          <label>Nickname<input name="name" required maxlength="40" placeholder="Player nickname" /></label>
          <label>Identity note<input name="identity" maxlength="60" placeholder="Optional distinguisher" /></label>
          <label>Primary role<select name="role">${renderRoleOptions(lanes[0])}</select></label>
          <label><span>Second role <small>Optional</small></span><select name="secondaryRole">${renderSecondaryRoleOptions("", lanes[0])}</select></label>
          <label>Roster status<select name="status"><option value="starter">Starter</option><option value="substitute">Substitute</option></select></label>
          <button type="submit" class="button button-secondary">Add to roster</button>
        </form>` : "";
        return `<article class="roster-team-card"><header><span class="team-monogram">${escapeHTML(getTeamAbbreviation(tournament, team))}</span><div><strong>${escapeHTML(team)}</strong><span class="roster-card-meta"><small>${escapeHTML(tournament)} · ${members.length} roster members</small><span class="roster-route">${escapeHTML(qualificationRoute)}</span></span></div></header>
          <div class="roster-player-list">${memberRows || "<p>No roster members registered yet.</p>"}</div>${addForm}</article>`;
      }).join("")}</div>
    </section>`;
}

function getHeadToHead(teamA, teamB, league) {
  return getCompletedMatches(league).filter((match) =>
    (match.teamA === teamA && match.teamB === teamB) || (match.teamA === teamB && match.teamB === teamA)
  ).map((match) => ({
    ...match,
    winner: match.scoreA > match.scoreB ? match.teamA : match.teamB
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
    <div class="section-heading"><div><h2>Head-to-head comparison</h2><p>Compare event results between teams or players.</p></div></div>
    <div class="h2h-mode-switch" role="group" aria-label="Comparison type"><button type="button" class="active" data-h2h-mode="teams" aria-pressed="true">Team vs team</button><button type="button" data-h2h-mode="players" aria-pressed="false">Player vs player</button></div>
    <div class="h2h-panel" data-h2h-panel="teams">
      <div class="compare-controls"><label class="field-label">Team A<select id="compare-team-a">${teams.map((team) => `<option ${team === first ? "selected" : ""}>${escapeHTML(team)}</option>`).join("")}</select></label><span>VS</span><label class="field-label">Team B<select id="compare-team-b">${teams.map((team) => `<option ${team === second ? "selected" : ""}>${escapeHTML(team)}</option>`).join("")}</select></label></div>
      <div class="compare-score-card"><div><strong id="compare-name-a">${escapeHTML(first)}</strong><span>Series wins</span></div><b id="compare-score">${winsA} : ${winsB}</b><div><strong id="compare-name-b">${escapeHTML(second)}</strong><span>Series wins</span></div></div>
      <div class="compare-match-list" id="compare-match-list">${renderComparedMatches(matches)}</div>
    </div>
    <div class="h2h-panel" data-h2h-panel="players" hidden>
      <div class="compare-controls"><label class="field-label">Player A<select id="compare-player-a">${playerOptions(playerA?.id)}</select></label><span>VS</span><label class="field-label">Player B<select id="compare-player-b">${playerOptions(playerB?.id)}</select></label></div>
      <div class="compare-score-card"><div><strong id="compare-player-name-a">${escapeHTML(playerA?.name || "No player data")}</strong><span id="compare-player-team-a">${escapeHTML(playerA?.team || "")}</span></div><b id="compare-player-score">${playerWinsA} : ${playerWinsB}</b><div><strong id="compare-player-name-b">${escapeHTML(playerB?.name || "Select player")}</strong><span id="compare-player-team-b">${escapeHTML(playerB?.team || "")}</span></div></div>
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
    : `<p class="module-footnote">No direct recorded match between these teams in this league yet.</p>`;
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
  const firstBloodLeader = [...players].sort((a, b) => b.firstBlood - a.firstBlood)[0];
  const awards = [
    { icon: "★", title: "MVP leader", recipient: mvpLeader?.name || "No MVP yet", detail: `${mvpLeader?.mvp || 0} game MVP awards · ${mvpLeader?.team || ""}` },
    { icon: "⚔", title: "Series leader", recipient: teamLeader?.[0] || "No results yet", detail: `${teamLeader?.[1] || 0} series wins in this league` },
    { icon: "◎", title: "Top KDA", recipient: players[0]?.name || "No player data", detail: `${players[0]?.kda || "0.00"} KDA · ${players[0]?.team || ""}` },
    { icon: "♧", title: "First blood", recipient: firstBloodLeader?.name || "No first blood yet", detail: `${firstBloodLeader?.firstBlood || 0} first bloods recorded` }
  ];
  return `<section class="achievement-grid">${awards.map((award, index) => `<article class="achievement-card"><span class="achievement-icon achievement-icon-${index}">${award.icon}</span><small>${escapeHTML(award.title)}</small><strong>${escapeHTML(award.recipient)}</strong><p>${escapeHTML(award.detail)}</p></article>`).join("")}</section>
    <section class="content-card module-card"><div class="section-heading"><div><h2>Milestone board</h2><p>Highlights are calculated from live Supabase match records.</p></div></div>
      <div class="milestone-list"><div><strong>${matches.length}</strong><span>series recorded</span></div><div><strong>${players.reduce((sum, player) => sum + player.mvp, 0)}</strong><span>MVP awards assigned</span></div><div><strong>${players.reduce((sum, player) => sum + player.firstBlood, 0)}</strong><span>first bloods recorded</span></div></div></section>`;
}

function renderModulePage(page, league = leagueOptions[0]) {
  pageContent.innerHTML = `${renderModuleHeading()}
    <div class="module-content" id="module-content">${renderModuleContent(page, league)}</div>
    <footer class="page-footer"><span>© 2026 Level Up Indonesia</span></footer>`;
  pageContent.querySelector("[data-module-league]").value = league;
  pageContent.querySelector("[data-module-league]").addEventListener("change", (event) => {
    renderModulePage(page, event.target.value);
  });
  pageContent.querySelector("[data-standings-stage]")?.addEventListener("change", (event) => {
    standingsStage = event.target.value;
    renderModulePage(page, pageContent.querySelector("[data-module-league]").value);
  });
  if (page === "roster") bindRosterManagement();
  if (page === "players") bindPlayerStatsControls(league);
  if (page === "standings" && standingsStage === "playoffs") {
    pageContent.querySelectorAll("[data-open-match]").forEach((card) => {
      const open = () => openMatchDetails(card.dataset.openMatch);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }
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
      return `<tr><td><strong>${escapeHTML(participant.team)}</strong></td><td>${escapeHTML(participant.abbreviation)}</td><td>${escapeHTML(participant.route)}</td><td>${usedByMatch ? "Match history" : hasRoster ? "Roster registered" : "No history"}</td><td><button type="button" class="participant-edit-toggle" data-toggle-participant="${escapeHTML(participant.team)}" aria-expanded="false">Edit</button><button type="button" class="danger-button" data-remove-participant="${escapeHTML(participant.team)}" data-tournament="${escapeHTML(tournament)}" ${cannotRemove ? `disabled title="${usedByMatch ? "This team has match history" : "Remove the team's roster first"}."` : ""}>Remove</button></td></tr><tr class="participant-edit-row" data-participant-edit-row="${escapeHTML(participant.team)}" hidden><td colspan="5"><form class="participant-edit-form" data-edit-participant="${escapeHTML(participant.team)}" data-tournament="${escapeHTML(tournament)}"><label>Team name<input name="team" required maxlength="60" value="${escapeHTML(participant.team)}" /></label><label>ABBR<input name="abbreviation" required maxlength="10" value="${escapeHTML(participant.abbreviation)}" /></label><label>Qualification route<select name="route">${qualificationRoutes.map((route) => `<option ${participant.route === route ? "selected" : ""}>${escapeHTML(route)}</option>`).join("")}</select></label><button type="submit" class="button button-secondary">Save team</button><button type="button" class="participant-edit-cancel" data-cancel-participant="${escapeHTML(participant.team)}">Cancel</button></form></td></tr>`;
    }).join("");
    const fields = `<form class="tournament-edit-form" data-edit-tournament="${escapeHTML(tournament)}">
          <label>Tournament name<input name="name" required maxlength="80" value="${escapeHTML(tournament)}" /></label>
          <label class="checkbox-field"><input name="globalBanPick" type="checkbox" ${config.globalBanPick ? "checked" : ""} /> Global Ban & Pick</label>
          <label class="checkbox-field"><input name="playoffsEnabled" type="checkbox" ${config.playoffsEnabled ? "checked" : ""} /> Include playoffs</label>
          <label>Playoff format<select name="bracketFormat"><option value="double-elimination" ${config.bracketFormat !== "single-elimination" ? "selected" : ""}>Double elimination</option><option value="single-elimination" ${config.bracketFormat === "single-elimination" ? "selected" : ""}>Single elimination</option></select></label>
          <label class="checkbox-field"><input name="playInEnabled" type="checkbox" ${config.playInEnabled ? "checked" : ""} /> Include Play-In stage</label>
          <button type="submit" class="button button-secondary">Save tournament</button>
          <button type="button" class="danger-button" data-delete-tournament="${escapeHTML(tournament)}" ${Object.values(matchDetails).some((match) => match.league === tournament) || [...teamRosters.keys()].some((key) => key.startsWith(`${tournament}|`) && teamRosters.get(key).length) ? "disabled title=\"Remove roster and match history before deleting this tournament.\"" : ""}>Delete tournament</button>
        </form>
        <form class="participant-add-form" data-add-participant="${escapeHTML(tournament)}">
          <label>Participating team<input name="team" required maxlength="60" placeholder="Team name" /></label>
          <label>Team abbreviation<input name="abbreviation" required maxlength="10" placeholder="BTR" /></label>
          <label>Qualification route<select name="route">${qualificationRoutes.map((route) => `<option>${escapeHTML(route)}</option>`).join("")}</select></label>
          <button type="submit" class="button button-primary">Add participant</button>
        </form>`;
    const playoffDescription = config?.playoffsEnabled
      ? `${config.bracketFormat === "single-elimination" ? "Single elimination" : "Double elimination"}${config.playInEnabled ? " · Play-in" : ""}`
      : "Group Stage only";
    return `<article class="content-card tournament-card"><header class="section-heading"><div><h2>${escapeHTML(tournament)}</h2><p>${escapeHTML(playoffDescription)} · ${config?.globalBanPick ? "Global Ban & Pick" : "Standard draft"} · ${(config?.participants || []).length} participants</p></div></header>
      ${fields}
      <div class="module-table-wrap"><table class="module-table participant-table"><thead><tr><th>TEAM</th><th>ABBR</th><th>QUALIFICATION ROUTE</th><th>HISTORY</th><th></th></tr></thead><tbody>${teamRows || '<tr><td colspan="5">No participants added yet.</td></tr>'}</tbody></table></div>
    </article>`;
  }).join("");
  const createForm = `<form id="create-tournament-form" class="tournament-create-form">
        <label>Tournament name<input name="name" required maxlength="80" placeholder="e.g. HOK Spring Cup" /></label>
        <label class="checkbox-field"><input name="globalBanPick" type="checkbox" /> Global Ban & Pick</label>
        <label class="checkbox-field"><input name="playoffsEnabled" type="checkbox" checked /> Include playoffs</label>
        <label>Playoff format<select name="bracketFormat"><option value="double-elimination" selected>Double elimination</option><option value="single-elimination">Single elimination</option></select></label>
        <label class="checkbox-field"><input name="playInEnabled" type="checkbox" /> Include Play-In stage</label>
        <button type="submit" class="button button-primary">Create tournament</button>
      </form>`;
  pageContent.innerHTML = `<section class="page-heading module-page-heading"><div><p class="eyebrow">EVENT WORKSPACE · SETUP FIRST</p><h1>Tournaments</h1><p class="heading-copy">Set up an event before registering its rosters and entering matches.</p></div></section>
    <section class="content-card module-card"><div class="section-heading"><div><h2>Competition setup</h2><p>1. Create a tournament · 2. Register teams and qualification routes · 3. Add each team’s event roster · 4. Record matches.</p></div><span class="section-tag">EVENT SETUP</span></div>${createForm}</section>
    <div class="module-content tournament-list">${tournamentCards}</div>
    <footer class="page-footer"><span>© 2026 Level Up Indonesia</span></footer>`;
  bindTournamentControls();
}

function bindTournamentControls() {
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
    tournamentSettings[name] = {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      globalBanPick: form.elements.namedItem("globalBanPick").checked,
      playoffsEnabled: form.elements.namedItem("playoffsEnabled").checked,
      bracketFormat: form.elements.namedItem("bracketFormat").value,
      playInEnabled: form.elements.namedItem("playInEnabled").checked,
      participants: []
    };
    try {
      await persistTournamentChanges();
      await finishDatabaseWrite("Tournament created in Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Tournament", error);
    }
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
    config.globalBanPick = form.elements.namedItem("globalBanPick").checked;
    config.playoffsEnabled = form.elements.namedItem("playoffsEnabled").checked;
    config.bracketFormat = form.elements.namedItem("bracketFormat").value;
    config.playInEnabled = form.elements.namedItem("playInEnabled").checked;
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
    try {
      await persistTournamentChanges();
      await finishDatabaseWrite("Tournament settings saved to Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Tournament settings", error);
    }
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
    try {
      await persistTournamentChanges();
      await finishDatabaseWrite("Team added to tournament in Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Team registration", error);
    }
  }));
  document.querySelectorAll("[data-toggle-participant]").forEach((button) => button.addEventListener("click", () => {
    const team = button.dataset.toggleParticipant;
    const row = document.querySelector(`[data-participant-edit-row="${CSS.escape(team)}"]`);
    if (!row) return;
    row.hidden = !row.hidden;
    button.setAttribute("aria-expanded", String(!row.hidden));
  }));
  document.querySelectorAll("[data-cancel-participant]").forEach((button) => button.addEventListener("click", () => {
    const row = button.closest("[data-participant-edit-row]");
    if (row) row.hidden = true;
    document.querySelector(`[data-toggle-participant="${CSS.escape(button.dataset.cancelParticipant)}"]`)?.setAttribute("aria-expanded", "false");
  }));
  document.querySelectorAll("[data-edit-participant]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tournament = form.dataset.tournament;
    const oldName = form.dataset.editParticipant;
    const newName = form.elements.namedItem("team").value.trim();
    const abbreviation = form.elements.namedItem("abbreviation").value.trim().toUpperCase();
    const route = form.elements.namedItem("route").value;
    const participants = tournamentSettings[tournament].participants;
    if (participants.some((participant) => participant.team !== oldName && participant.team.toLowerCase() === newName.toLowerCase())) {
      showToast("This team already exists in the tournament.");
      return;
    }
    if (newName !== oldName) {
      try {
        await productionDatabaseAdapter.renameTeam(tournament, oldName, newName);
      } catch (error) {
        await showDatabaseWriteError("Team rename", error);
        return;
      }
    }
    participants.forEach((participant) => {
      if (participant.team === oldName) {
        participant.team = newName;
        participant.abbreviation = abbreviation;
        participant.route = route;
      }
    });
    if (newName !== oldName) {
      leagueTeams[tournament] = leagueTeams[tournament].map((team) => team === oldName ? newName : team);
      const roster = teamRosters.get(rosterKey(tournament, oldName));
      if (roster) {
        teamRosters.delete(rosterKey(tournament, oldName));
        teamRosters.set(rosterKey(tournament, newName), roster.map((player) => ({ ...player, team: newName })));
      }
      Object.values(matchDetails).forEach((match) => {
        if (match.league !== tournament) return;
        if (match.teamA === oldName) match.teamA = newName;
        if (match.teamB === oldName) match.teamB = newName;
        match.games?.forEach((game) => {
          if (game.winner === oldName) game.winner = newName;
        });
      });
    }
    try {
      await persistTournamentChanges();
      await finishDatabaseWrite("Team details saved to Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Team details", error);
    }
  }));
  document.querySelectorAll("[data-remove-participant]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const tournament = button.dataset.tournament;
    const team = button.dataset.removeParticipant;
    tournamentSettings[tournament].participants = tournamentSettings[tournament].participants.filter((participant) => participant.team !== team);
    leagueTeams[tournament] = leagueTeams[tournament].filter((participant) => participant !== team);
    teamRosters.delete(rosterKey(tournament, team));
    try {
      await persistTournamentChanges();
      await finishDatabaseWrite("Team removed from tournament in Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Team removal", error);
    }
  }));
  document.querySelectorAll("[data-delete-tournament]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const tournament = button.dataset.deleteTournament;
    if (!window.confirm(`Delete ${tournament} and its participants?`)) return;
    leagueOptions.splice(leagueOptions.indexOf(tournament), 1);
    delete leagueTeams[tournament];
    delete tournamentSettings[tournament];
    for (const key of teamRosters.keys()) if (key.startsWith(`${tournament}|`)) teamRosters.delete(key);
    try {
      await persistTournamentChanges();
      await finishDatabaseWrite("Tournament deleted from Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Tournament deletion", error);
    }
  }));
}

function syncRosterRoleFields(form) {
  const roleSelect = form.elements.namedItem("role");
  const secondarySelect = form.elements.namedItem("secondaryRole");
  const statusSelect = form.elements.namedItem("status");
  if (!roleSelect || !secondarySelect || !statusSelect) return;
  const isPlayer = playerRoles.includes(roleSelect.value);
  secondarySelect.disabled = !isPlayer;
  statusSelect.disabled = !isPlayer;
  [...secondarySelect.options].forEach((option) => {
    option.disabled = !!option.value && option.value === roleSelect.value;
  });
  if (!isPlayer || secondarySelect.value === roleSelect.value) secondarySelect.value = "";
  if (!isPlayer) statusSelect.value = "starter";
}

function getRosterFormRoles(form) {
  const role = form.elements.namedItem("role").value;
  const isPlayer = playerRoles.includes(role);
  const secondaryRole = isPlayer ? form.elements.namedItem("secondaryRole").value : "";
  return {
    role,
    secondaryRole,
    isSubstitute: isPlayer && form.elements.namedItem("status").value === "substitute",
  };
}

function bindRosterManagement() {
  document.querySelectorAll(".roster-add-form, .roster-edit-form").forEach((form) => {
    syncRosterRoleFields(form);
    form.elements.namedItem("role")?.addEventListener("change", () => syncRosterRoleFields(form));
  });
  document.querySelectorAll("[data-add-roster]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tournament = form.dataset.addRoster;
    const team = form.dataset.rosterTeam;
    const name = form.elements.namedItem("name").value.trim();
    const identity = form.elements.namedItem("identity").value.trim();
    const { role, secondaryRole, isSubstitute } = getRosterFormRoles(form);
    if (secondaryRole === role) {
      showToast("Second role must be different from the primary role.");
      return;
    }
    const members = getTeamRoster(tournament, team);
    const sameNameAndRole = members.filter((member) => member.name.toLowerCase() === name.toLowerCase() && member.role === role);
    if (sameNameAndRole.length && (!identity || sameNameAndRole.some((member) => member.identity?.toLowerCase() === identity.toLowerCase()))) {
      showToast("This nickname and role already exist. Add a unique identity note to distinguish this player.");
      return;
    }
    try {
      await productionDatabaseAdapter.saveRoster({ name, identity, role, secondaryRole, isSubstitute, tournament, team });
      await finishDatabaseWrite("Roster member saved to Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Roster member", error);
    }
  }));
  document.querySelectorAll("[data-toggle-roster-edit]").forEach((button) => button.addEventListener("click", () => {
    const form = document.querySelector(`[data-edit-roster="${CSS.escape(button.dataset.toggleRosterEdit)}"]`);
    if (!form) return;
    form.hidden = !form.hidden;
    button.setAttribute("aria-expanded", String(!form.hidden));
  }));
  document.querySelectorAll("[data-edit-roster]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = form.dataset.editRoster;
    const tournament = form.dataset.rosterTournament;
    const team = form.dataset.rosterTeam;
    const name = form.elements.namedItem("name").value.trim();
    const identity = form.elements.namedItem("identity").value.trim();
    const { role, secondaryRole, isSubstitute } = getRosterFormRoles(form);
    if (secondaryRole === role) {
      showToast("Second role must be different from the primary role.");
      return;
    }
    const members = getTeamRoster(tournament, team);
    const duplicate = members.some((member) => member.id !== id && member.name.toLowerCase() === name.toLowerCase() && member.role === role
      && (!identity || member.identity?.toLowerCase() === identity.toLowerCase()));
    if (duplicate) {
      showToast("This nickname and role already exist. Add a unique identity note to distinguish this player.");
      return;
    }
    try {
      await productionDatabaseAdapter.saveRoster({ id, name, identity, role, secondaryRole, isSubstitute, tournament, team });
      await finishDatabaseWrite("Roster member updated in Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Roster member", error);
    }
  }));
  document.querySelectorAll("[data-remove-roster]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const id = button.dataset.removeRoster;
    try {
      await productionDatabaseAdapter.deleteRoster(id);
      await finishDatabaseWrite("Roster member removed from Supabase.");
    } catch (error) {
      await showDatabaseWriteError("Roster deletion", error);
    }
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
  update();
  updatePlayers();
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
  const addMatchButton = document.querySelector("#add-match-button");
  addMatchButton.hidden = !productionDatabaseAdapter?.canWrite;
  addMatchButton.addEventListener("click", () => requestAdminAccess());
  document.querySelector("#match-search").addEventListener("input", updateResults);
  document.querySelector("#result-filter").addEventListener("change", (event) => {
    document.querySelector("#league-select").value = event.target.value;
    updateLeagueView();
  });
  document.querySelector("#league-select").addEventListener("change", () => {
    syncResultLeagueOptions();
    updateLeagueView();
  });
  document.querySelector("#schedule-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-match-id]");
    if (button) openMatchDetails(button.dataset.matchId);
  });
  document.querySelector("#results-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-match-id]");
    if (button) openMatchDetails(button.dataset.matchId);
  });
  syncMatchLeagueOptions();
  updateLeagueView();
}

function syncMatchLeagueOptions() {
  const selector = document.querySelector("#league-select");
  if (!selector) return;
  const selected = selector.value;
  selector.innerHTML = `<option value="All leagues">All leagues</option>${leagueOptions.map((league) => `<option>${escapeHTML(league)}</option>`).join("")}`;
  selector.value = leagueOptions.includes(selected) || selected === "All leagues" ? selected : "All leagues";
  syncResultLeagueOptions();
}

function syncResultLeagueOptions() {
  const selector = document.querySelector("#league-select");
  const resultFilter = document.querySelector("#result-filter");
  if (!selector || !resultFilter) return;
  resultFilter.innerHTML = [...selector.options].map((option) =>
    `<option value="${escapeHTML(option.value)}">${escapeHTML(option.textContent)}</option>`
  ).join("");
  resultFilter.value = selector.value;
}

function updateResults() {
  const query = document.querySelector("#match-search").value.trim().toLowerCase();
  const selectedLeague = document.querySelector("#result-filter").value === "All leagues"
    ? "all"
    : document.querySelector("#result-filter").value;
  const rows = [...document.querySelectorAll("#results-body .result-row")];
  let visibleCount = 0;
  rows.forEach((row) => {
    const matchesText = row.dataset.teams.includes(query);
    const matchesLeague = selectedLeague === "all" || row.dataset.league === selectedLeague;
    const visible = matchesText && matchesLeague;
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
  syncResultLeagueOptions();
  renderLiveMatchRows(league);
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
    const date = getMatchInstant(match) || dateFromISO(match.dateISO);
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
  document.querySelectorAll("#results-body .result-row").forEach((row) => {
    row.hidden = league !== "all" && row.dataset.league !== league;
  });
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
    .sort((a, b) => {
      const timeA = getMatchInstant(a)?.getTime() || 0;
      const timeB = getMatchInstant(b)?.getTime() || 0;
      return timeB - timeA;
    });
  document.querySelector("#schedule-list").innerHTML = scheduled.map((match) => {
    const { year, month, day } = getMatchLocalDateParts(match) || {};
    const monthName = day && month ? new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(year, month - 1, day)).toUpperCase() : "TBD";
    return `<article class="schedule-row" data-match-id="${escapeHTML(match.id)}" data-league="${escapeHTML(match.league)}">
      <div class="schedule-date"><strong>${day ? String(day).padStart(2, "0") : "—"}</strong><span>${monthName}</span></div>
      <div class="schedule-time">${escapeHTML(getMatchLocalTime(match) || "Time TBD")}</div>
      <div class="schedule-teams"><strong>${escapeHTML(match.teamA)}</strong><span class="schedule-vs">vs</span><strong>${escapeHTML(match.teamB)}</strong></div>
      <div class="schedule-league">${escapeHTML(match.league)}</div>
      <span class="stage-pill">${escapeHTML(match.stage)}</span><span class="format-pill">${escapeHTML(match.format)}</span>
      <button class="row-action" data-match-id="${escapeHTML(match.id)}" aria-label="View ${escapeHTML(match.teamA)} vs ${escapeHTML(match.teamB)} details" title="Match details">↗</button>
    </article>`;
  }).join("");
  document.querySelector("#results-body").innerHTML = completed.map((match) => {
    const teamAWon = match.scoreA > match.scoreB;
    const { year, month, day } = getMatchLocalDateParts(match) || {};
    const monthName = day && month ? new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(year, month - 1, day)).toUpperCase() : "TBD";
    return `<article class="schedule-row result-row" data-teams="${escapeHTML(`${match.teamA} ${match.teamB}`.toLowerCase())}" data-match-id="${escapeHTML(match.id)}" data-league="${escapeHTML(match.league)}">
      <div class="schedule-date"><strong>${day ? String(day).padStart(2, "0") : "—"}</strong><span>${monthName}</span></div>
      <div class="schedule-time">${escapeHTML(getMatchLocalTime(match) || "Time TBD")}</div>
      <div class="schedule-teams result-schedule-teams"><strong class="${teamAWon ? "result-winner" : ""}">${escapeHTML(match.teamA)}</strong><span class="result-score">${match.scoreA}</span><span class="score-separator">–</span><span class="result-score">${match.scoreB}</span><strong class="${!teamAWon ? "result-winner" : ""}">${escapeHTML(match.teamB)}</strong></div>
      <div class="schedule-league">${escapeHTML(match.league)}</div>
      <span class="stage-pill">${escapeHTML(match.stage)}</span><span class="format-pill">${escapeHTML(match.format)}</span>
      <button class="row-action" data-match-id="${escapeHTML(match.id)}" aria-label="View ${escapeHTML(match.teamA)} vs ${escapeHTML(match.teamB)} details" title="Match details">↗</button>
    </article>`;
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

function updateEntryPrimaryAction() {
  const continueButton = document.querySelector("#continue-to-entry");
  continueButton.innerHTML = editingMatchId && entryGameDrafts.length
    ? 'Edit game results <span>→</span>'
    : 'Enter results <span>→</span>';
  document.querySelector("#save-match-button").textContent = editingMatchId ? "Save match changes" : "Save completed match";
}

function openModal(matchId = "") {
  document.querySelector("#match-form").reset();
  entryGameDrafts = [];
  syncEntryLeagueOptions();
  if (matchId) {
    const match = matchDetails[matchId];
    if (!match) {
      showToast("This match is no longer available.");
      return;
    }
    editingMatchId = matchId;
    document.querySelector("#entry-league").value = match.league;
    if (match.phase === "Playoffs" && tournamentSettings[match.league]) tournamentSettings[match.league].playoffsEnabled = true;
    syncEntryPhaseOptions(match.league);
    syncEntryTeamOptions();
    document.querySelector("#entry-team-a").value = match.teamA;
    document.querySelector("#entry-team-b").value = match.teamB;
    document.querySelector("#entry-phase").value = match.phase === "Playoffs" ? "Playoffs" : "Group Stage";
    syncEntryStageOptions(match.league);
    if (match.stage && match.stage !== match.phase) setEntryStageValue(match.stage);
    document.querySelector("#entry-format").value = match.format;
    document.querySelector("#entry-date").value = match.dateISO || toDateInputValue(match.date);
    document.querySelector("#entry-time").value = match.entryTime || toTimeInputValue(match.time || match.date);
    document.querySelector("#entry-stream").value = match.streamUrl || "";
    entryGameDrafts = (match.games || []).map((game) => ({
      winner: game.winner || "",
      duration: game.duration === "—" ? "" : game.duration,
      blueSide: game.blueSide || "A",
      bansA: [...(game.bansA || [])],
      bansB: [...(game.bansB || [])],
      objectivesA: { Tyrant: 0, "Shadow Tyrant": 0, Tempest: 0, Overlord: 0, "Shadow Overlord": 0, Towers: 0, ...(game.objectivesA || {}) },
      objectivesB: { Tyrant: 0, "Shadow Tyrant": 0, Tempest: 0, Overlord: 0, "Shadow Overlord": 0, Towers: 0, ...(game.objectivesB || {}) },
      picksA: game.playersA.map((player) => ({ ...player, playerId: player.playerId || getTeamRoster(match.league, match.teamA).find((member) => member.name === player.player && canPlayLane(member, player.lane))?.id || "", multiKills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...(player.multiKills || {}) } })),
      picksB: game.playersB.map((player) => ({ ...player, playerId: player.playerId || getTeamRoster(match.league, match.teamB).find((member) => member.name === player.player && canPlayLane(member, player.lane))?.id || "", multiKills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...(player.multiKills || {}) } })),
    }));
    document.querySelector("#modal-title").textContent = "Edit match";
    updateEntryPrimaryAction();
  } else {
    editingMatchId = "";
    document.querySelector("#modal-title").textContent = "Add a match";
    updateEntryPrimaryAction();
  }
  const showExistingResults = entryGameDrafts.length > 0;
  if (showExistingResults) {
    syncEntryGameDraftCount();
    currentEntryGame = 1;
    renderEntryGameTabs();
    renderEntryGamePanel();
    updateEntrySeriesScore();
  }
  showEntryStep(showExistingResults ? 2 : 1);
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  const entryModal = modal.querySelector(".entry-modal");
  const closeButton = modal.querySelector(".modal-heading .close-modal");
  requestAnimationFrame(() => {
    entryModal.scrollTop = 0;
    closeButton.focus({ preventScroll: true });
  });
}

function toTimeInputValue(value) {
  const text = String(value || "").trim();
  if (/^\d{2}:\d{2}$/.test(text)) return text;
  const wallTime = text.match(/^(\d{1,2})\.(\d{2})$/);
  if (wallTime) return `${wallTime[1].padStart(2, "0")}:${wallTime[2]}`;
  const match = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*WIB)?$/i);
  if (!match) return "";
  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hours += 12;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

function toDateInputValue(value) {
  const match = String(value || "").match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (!match) return "";
  const date = new Date(`${match[1]} ${match[2]}, ${match[3]} 12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function syncEntryLeagueOptions() {
  const selector = document.querySelector("#entry-league");
  if (!selector) return;
  const currentLeague = selector.value;
  selector.innerHTML = `<option value="">Select a league</option>${leagueOptions.map((league) => `<option>${escapeHTML(league)}</option>`).join("")}`;
  if (leagueOptions.includes(currentLeague)) selector.value = currentLeague;
  else selector.value = leagueOptions[0] || "";
  syncEntryPhaseOptions(selector.value);
  syncEntryTeamOptions();
}

function syncEntryPhaseOptions(tournament) {
  const playoffOption = document.querySelector("#entry-phase option[value='Playoffs']");
  if (playoffOption) playoffOption.disabled = !tournamentSettings[tournament]?.playoffsEnabled;
  if (playoffOption?.disabled && document.querySelector("#entry-phase").value === "Playoffs") {
    document.querySelector("#entry-phase").value = "Group Stage";
  }
  syncEntryStageOptions(tournament);
}

function syncEntryStageOptions(tournament) {
  const stageSelect = document.querySelector("#entry-stage");
  const customInput = document.querySelector("#entry-custom-stage");
  if (!stageSelect || !customInput) return;
  const currentStage = getEntryStageValue();
  const isPlayoffs = document.querySelector("#entry-phase").value === "Playoffs";
  const stages = isPlayoffs ? getPlayoffStageOptions(tournament) : ["Group Stage"];
  stageSelect.innerHTML = `${stages.map((stage) => `<option value="${escapeHTML(stage)}">${escapeHTML(stage)}</option>`).join("")}<option value="__custom__">Custom stage…</option>`;
  if (stages.includes(currentStage)) {
    stageSelect.value = currentStage;
    customInput.value = "";
  } else if (currentStage && currentStage !== "Group Stage") {
    stageSelect.value = "__custom__";
    customInput.value = currentStage;
  } else {
    stageSelect.value = stages[0];
    customInput.value = "";
  }
  customInput.hidden = stageSelect.value !== "__custom__";
  customInput.required = !customInput.hidden;
}

function getEntryStageValue() {
  const stageSelect = document.querySelector("#entry-stage");
  if (!stageSelect) return "";
  return stageSelect.value === "__custom__"
    ? document.querySelector("#entry-custom-stage").value.trim()
    : stageSelect.value;
}

function setEntryStageValue(stage) {
  const stageSelect = document.querySelector("#entry-stage");
  const customInput = document.querySelector("#entry-custom-stage");
  const normalizedStage = String(stage || "").trim();
  if ([...stageSelect.options].some((option) => option.value === normalizedStage)) {
    stageSelect.value = normalizedStage;
    customInput.value = "";
    customInput.hidden = true;
    customInput.required = false;
  } else {
    stageSelect.value = "__custom__";
    customInput.value = normalizedStage;
    customInput.hidden = false;
    customInput.required = true;
  }
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
  modal.querySelector(".entry-modal").scrollTop = 0;
  modal.hidden = true;
  document.body.style.overflow = "";
  editingMatchId = "";
}

function showEntryStep(step) {
  document.querySelector("#entry-step-two").hidden = step !== 2;
  document.querySelector(".entry-info-actions").hidden = step === 2;
}

function selectedTeamNames() {
  return {
    teamA: document.querySelector("#entry-team-a").value,
    teamB: document.querySelector("#entry-team-b").value
  };
}

function createBlankEntryGame(index) {
  const tournament = document.querySelector("#entry-league").value;
  const { teamA, teamB } = selectedTeamNames();
  const rosterA = getTeamRoster(tournament, teamA);
  const rosterB = getTeamRoster(tournament, teamB);
  const createPicks = (roster) => {
    const usedIds = new Set();
    return lanes.map((lane) => {
      const player = findRosterPlayerForLane(roster, lane, usedIds);
      if (player?.id) usedIds.add(player.id);
      return {
        playerId: player?.id || "",
        lane,
        hero: "",
        player: player?.name || "",
        kills: 0, deaths: 0, assists: 0, gold: 0, damage: 0, damageTaken: 0,
        multiKills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, mvp: false, firstBlood: false
      };
    });
  };
  return {
    winner: "",
    duration: "",
    blueSide: index % 2 === 0 ? "A" : "B",
    bansA: ["", "", "", ""],
    bansB: ["", "", "", ""],
    objectivesA: { Tyrant: 0, "Shadow Tyrant": 0, Tempest: 0, Overlord: 0, "Shadow Overlord": 0, Towers: 0 },
    objectivesB: { Tyrant: 0, "Shadow Tyrant": 0, Tempest: 0, Overlord: 0, "Shadow Overlord": 0, Towers: 0 },
    picksA: createPicks(rosterA),
    picksB: createPicks(rosterB)
  };
}

function syncEntryGameDraftCount() {
  if (!entryGameDrafts.length) return false;
  const maxGames = Number(document.querySelector("#entry-format").value.match(/\d+/)?.[0]) || 1;
  const previousLength = entryGameDrafts.length;
  if (previousLength < maxGames) {
    for (let index = previousLength; index < maxGames; index += 1) entryGameDrafts.push(createBlankEntryGame(index));
  } else if (previousLength > maxGames) {
    entryGameDrafts = entryGameDrafts.slice(0, maxGames);
  }
  if (entryGameDrafts.length === previousLength) return false;
  currentEntryGame = Math.min(currentEntryGame, entryGameDrafts.length);
  renderEntryGameTabs();
  renderEntryGamePanel();
  updateEntrySeriesScore();
  return true;
}

function prepareEntryStepTwo() {
  const form = document.querySelector("#match-form");
  if (!form.reportValidity()) return;
  const { teamA, teamB } = selectedTeamNames();
  if (teamA === teamB) {
    showToast("Choose two different teams.");
    return;
  }
  if (editingMatchId && entryGameDrafts.length) {
    syncEntryGameDraftCount();
    currentEntryGame = 1;
    renderEntryGameTabs();
    renderEntryGamePanel();
    updateEntrySeriesScore();
    showEntryStep(2);
    return;
  }
  const maxGames = Number(document.querySelector("#entry-format").value.match(/\d+/)?.[0]) || 1;
  entryGameDrafts = Array.from({ length: maxGames }, (_, index) => createBlankEntryGame(index));
  currentEntryGame = 1;
  renderEntryGameTabs();
  renderEntryGamePanel();
  updateEntrySeriesScore();
  showEntryStep(2);
  document.querySelector("#entry-game-tabs button")?.focus();
}

async function saveEntrySchedule(button) {
  const form = document.querySelector("#match-form");
  if (!form.reportValidity()) return;
  const { teamA, teamB } = selectedTeamNames();
  if (teamA === teamB) {
    showToast("Choose two different teams.");
    return;
  }
  if (entrySeriesHasWinner()) {
    showToast("This match already has a series winner. Use Save match changes to record it as completed.");
    return;
  }
  button.disabled = true;
  try {
    const preview = buildEntryPreviewMatch();
    await productionDatabaseAdapter.saveSchedule({ ...preview, finished: false, games: [] }, editingMatchId);
    closeModal();
    await finishDatabaseWrite("Match schedule saved to Supabase.");
  } catch (error) {
    showToast(`Schedule was not saved: ${error.message}`);
  } finally {
    button.disabled = false;
  }
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

function refreshEntryKpCells(game, side) {
  game[`picks${side}`].forEach((_, index) => {
    const cell = document.querySelector(`[data-entry-kp="${side}-${index}"]`);
    if (cell) cell.textContent = `${calculateEntryKp(game, side, index)}%`;
  });
}

function renderEntryGamePanel() {
  const { teamA, teamB } = selectedTeamNames();
  const game = entryGameDrafts[currentEntryGame - 1];
  const winnerOptions = `<option value="">Not played</option><option value="${escapeHTML(teamA)}" ${game.winner === teamA ? "selected" : ""}>${escapeHTML(teamA)}</option><option value="${escapeHTML(teamB)}" ${game.winner === teamB ? "selected" : ""}>${escapeHTML(teamB)}</option>`;
  const renderPlayerTable = (side, team) => `<div class="entry-team-stats"><h3>${escapeHTML(team)} · ${side === game.blueSide ? "BLUE SIDE" : "RED SIDE"}</h3><div class="entry-stats-scroll"><table class="entry-stats-table"><thead><tr><th>ROLE</th><th>PLAYER</th><th>HERO</th><th>K</th><th>D</th><th>A</th><th>GOLD</th><th title="Hero damage">DMG</th><th title="Damage taken">TAKEN</th><th>KP</th><th>1K</th><th>2K</th><th>3K</th><th>4K</th><th>5K</th><th>MVP</th><th title="First Blood">FB</th></tr></thead><tbody>${lanes.map((lane, index) => {
    const pick = game[`picks${side}`][index];
    const roster = getTeamRoster(document.querySelector("#entry-league").value, team).filter((player) => canPlayLane(player, lane));
    const playerListId = `entry-player-options-${side}-${index}`;
    const playerOptions = roster.map((player) => {
      const roleNote = [player.role, player.secondaryRole, player.isSubstitute ? "SUBS" : ""].filter(Boolean).join(" · ");
      return `<option value="${escapeHTML(player.name)}" label="${escapeHTML(player.identity ? `${player.identity} · ${roleNote}` : roleNote)}"></option>`;
    }).join("");
    return `<tr><th scope="row">${renderLaneLabel(lane, true)}</th>
      <td><input list="${playerListId}" autocomplete="off" placeholder="Type player" aria-label="${escapeHTML(team)} ${escapeHTML(lane)} player" data-entry-side="${side}" data-entry-lane="${index}" data-entry-pick="player" value="${escapeHTML(pick.player || "")}" /><datalist id="${playerListId}">${playerOptions}</datalist></td>
      <td><input list="entry-hero-options" autocomplete="off" placeholder="Type hero" aria-label="${escapeHTML(team)} ${escapeHTML(lane)} hero" data-entry-side="${side}" data-entry-lane="${index}" data-entry-pick="hero" value="${escapeHTML(pick.hero || "")}" /></td>
      ${["kills", "deaths", "assists"].map((stat) => `<td><input type="number" min="0" step="1" aria-label="${escapeHTML(team)} ${escapeHTML(lane)} ${stat}" data-entry-side="${side}" data-entry-lane="${index}" data-entry-pick="${stat}" value="${pick[stat]}" /></td>`).join("")}
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
  const renderBans = (side, team) => `<div class="entry-ban-team"><strong>${escapeHTML(team)}</strong><div class="entry-ban-selects">${Array.from({ length: 4 }, (_, index) => {
    const selectedHero = game[`bans${side}`][index] || "";
    return `<label><span>Ban ${index + 1}</span><input list="entry-hero-options" autocomplete="off" placeholder="Type hero" value="${escapeHTML(selectedHero)}" data-entry-side="${side}" data-entry-ban-index="${index}" aria-label="${escapeHTML(team)} banned hero ${index + 1}" /></label>`;
  }).join("")}</div></div>`;
  const heroDatalist = `<datalist id="entry-hero-options">${heroOptions.map((hero) => `<option value="${escapeHTML(hero)}"></option>`).join("")}</datalist>`;
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
    ${heroDatalist}
    <section class="entry-bans-section"><div class="entry-bans-heading"><strong>BANNED HEROES</strong><span>Type or choose four banned heroes for each team.</span></div><div class="entry-bans-grid">${renderBans("A", teamA)}${renderBans("B", teamB)}</div></section>
    <p class="input-helper">Edit each cell directly, or paste tab-separated rows from a spreadsheet. KP is recalculated automatically and skipped during paste.${tournamentSettings[document.querySelector("#entry-league").value]?.globalBanPick ? " Global Ban & Pick prevents each team from reusing its own earlier picks in this series." : ""}</p>
    ${renderPlayerTable("A", teamA)}${renderPlayerTable("B", teamB)}
    <section class="entry-objectives"><div class="entry-objective-heading"><strong>OBJECTIVES TAKEN</strong><span>Enter counts directly or paste spreadsheet rows.</span></div>
      ${renderObjectives("A", teamA)}${renderObjectives("B", teamB)}
    </section>`;
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

function entrySeriesHasWinner() {
  const { teamA, teamB } = selectedTeamNames();
  const maxGames = Number(document.querySelector("#entry-format").value.match(/\d+/)?.[0]) || 1;
  const requiredWins = Math.floor(maxGames / 2) + 1;
  const winsA = entryGameDrafts.filter((game) => game.winner === teamA).length;
  const winsB = entryGameDrafts.filter((game) => game.winner === teamB).length;
  return Math.max(winsA, winsB) >= requiredWins;
}

function buildEntryPreviewMatch() {
  const { teamA, teamB } = selectedTeamNames();
  const isCompleted = entrySeriesHasWinner();
  const games = isCompleted ? entryGameDrafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ draft }) => draft.winner)
    .map(({ draft, index }) => ({
      gameNumber: index + 1,
      winner: draft.winner,
      duration: draft.duration || "—",
      blueSide: draft.blueSide,
      bansA: draft.bansA.slice(0, 4).map((hero) => String(hero || "").trim()).filter(Boolean),
      bansB: draft.bansB.slice(0, 4).map((hero) => String(hero || "").trim()).filter(Boolean),
      objectivesA: draft.objectivesA,
      objectivesB: draft.objectivesB,
      playersA: draft.picksA.map((player) => ({ ...player, multiKills: { ...player.multiKills }, kills: player.kills, deaths: player.deaths, assists: player.assists })),
      playersB: draft.picksB.map((player) => ({ ...player, multiKills: { ...player.multiKills }, kills: player.kills, deaths: player.deaths, assists: player.assists }))
    })) : [];
  const scoreA = games.filter((game) => game.winner === teamA).length;
  const scoreB = games.filter((game) => game.winner === teamB).length;
  const rawDate = document.querySelector("#match-form input[type='date']").value;
  const stage = getEntryStageValue() || document.querySelector("#entry-phase").value;
  const phase = document.querySelector("#entry-phase").value === "Playoffs" || isPlayoffStage(stage) ? "Playoffs" : "Group Stage";
  return {
    league: document.querySelector("#entry-league").value,
    teamA, teamB, scoreA: isCompleted ? scoreA : null, scoreB: isCompleted ? scoreB : null,
    format: document.querySelector("#entry-format").value,
    phase,
    stage,
    time: document.querySelector("#entry-time").value,
    streamUrl: document.querySelector("#entry-stream").value.trim(),
    globalBanPick: tournamentSettings[document.querySelector("#entry-league").value]?.globalBanPick || false,
    dateISO: rawDate,
    finished: isCompleted,
    games
  };
}

function renderDraftSide(teamName, players, winner, side, blueSide) {
  const picks = players.map((player) => {
    const multikills = [1, 2, 3, 4, 5]
      .filter((count) => Number(player.multiKills?.[count]) > 0)
      .map((count) => `<b class="pick-multikill"><span>${count}K</span> ×${player.multiKills[count]}</b>`)
      .join("");
    return `<div class="draft-pick ${player.mvp ? "mvp-pick" : ""}">
      <span class="pick-lane">${renderLaneLabel(player.lane, true)}</span>
      <span class="pick-identity"><span class="pick-player">${escapeHTML(player.player)}${player.mvp ? '<b class="pick-tag mvp-flag">MVP</b>' : ""}${player.firstBlood ? '<b class="pick-tag first-blood">FIRST BLOOD</b>' : ""}</span><span class="pick-hero">${escapeHTML(player.hero)}</span></span>
      <span class="pick-kda"><b>${player.kills}</b><i>/</i><b>${player.deaths}</b><i>/</i><b>${player.assists}</b></span>
      <span class="pick-extra-stats"><span><b>KP</b> ${calculatePlayerKp(players, player)}%</span><span><b>GOLD</b> ${Number(player.gold || 0).toLocaleString("en-US")}</span><span><b>HERO DMG</b> ${Number(player.damage || 0).toLocaleString("en-US")}</span><span><b>TAKEN</b> ${Number(player.damageTaken || 0).toLocaleString("en-US")}</span></span>
      ${multikills ? `<span class="pick-multikills">${multikills}</span>` : ""}
    </div>`;
  }).join("");
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
      <section class="game-bans-section">
        <span class="game-section-label">BANNED HEROES</span>
        <div class="game-bans">
          <div class="ban-side"><b>${escapeHTML(match.teamA)}</b>${game.bansA.map((hero) => `<i>${escapeHTML(hero)}</i>`).join("")}</div>
          <div class="ban-side"><b>${escapeHTML(match.teamB)}</b>${game.bansB.map((hero) => `<i>${escapeHTML(hero)}</i>`).join("")}</div>
        </div>
      </section>
      <footer class="game-footer">
        <span class="objective-label">OBJECTIVES TAKEN</span>
        <div class="objective-grid">
          <div class="objective-team"><strong>${escapeHTML(match.teamA)}</strong>${renderObjectiveSummary(game.objectivesA)}</div>
          <div class="objective-team"><strong>${escapeHTML(match.teamB)}</strong>${renderObjectiveSummary(game.objectivesB)}</div>
        </div>
      </footer>
      <div class="draft-matchup">
        ${renderDraftSide(match.teamA, game.playersA, game.winner, "A", game.blueSide)}
        <div class="draft-divider"><span>VS</span></div>
        ${renderDraftSide(match.teamB, game.playersB, game.winner, "B", game.blueSide)}
      </div>
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
  detailModal.querySelector(".eyebrow").textContent = "MATCH BREAKDOWN";
  const canEdit = !!productionDatabaseAdapter?.canWrite;
  const gamesMarkup = hasResult
    ? renderGameList(match)
    : `<div class="detail-empty">This match has not started yet. Game scores, drafts, and player stats will appear here after the result is recorded.</div>`;
  document.querySelector("#detail-title").textContent = `${match.teamA} vs ${match.teamB}`;
  document.querySelector("#detail-content").innerHTML = `
    <div class="detail-summary">
      <div class="detail-team"><strong>${escapeHTML(match.teamA)}</strong><small>${hasResult ? (match.scoreA > match.scoreB ? "WIN" : "LOSE") : "TEAM A"}</small></div>
      <div class="detail-score"><div class="detail-score-main">${hasResult ? `<strong>${match.scoreA}</strong><span>:</span><strong>${match.scoreB}</strong>` : `<span class="upcoming-label">VS</span>`}</div><small class="match-status">${escapeHTML(match.status || (match.finished ? "Completed" : "Scheduled"))}</small></div>
      <div class="detail-team"><strong>${escapeHTML(match.teamB)}</strong><small>${hasResult ? (match.scoreB > match.scoreA ? "WIN" : "LOSE") : "TEAM B"}</small></div>
    </div>
    <div class="detail-meta"><span>${escapeHTML(match.league)}</span><span>${escapeHTML(match.phase || "Stage")}: ${escapeHTML(match.stage)}</span><span>${escapeHTML(getMatchLocalDate(match))}${getMatchLocalTime(match) ? ` · ${escapeHTML(getMatchLocalTime(match))}` : ""}</span>${match.globalBanPick || tournamentSettings[match.league]?.globalBanPick ? "<span>GLOBAL BAN & PICK</span>" : ""}${match.streamUrl ? `<a class="stream-play-link" href="${escapeHTML(match.streamUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open stream or replay" title="Open stream or replay"></a>` : ""}${canEdit ? `<button type="button" class="button button-secondary edit-match-button" data-edit-match="${escapeHTML(currentDetailMatchId)}">Edit match</button><button type="button" class="danger-button delete-match-button" data-delete-match="${escapeHTML(currentDetailMatchId)}">Delete match</button>` : ""}</div>
    ${gamesMarkup}`;
}

function openMatchDetails(matchId) {
  const match = matchDetails[matchId];
  if (!match) return;
  currentDetailMatchId = matchId;
  collapsedGames.clear();
  renderMatchDetails();
  detailModal.querySelector(".detail-modal").scrollTop = 0;
  detailModal.hidden = false;
  document.body.style.overflow = "hidden";
  detailModal.querySelector(".close-detail").focus();
}

function closeMatchDetails() {
  detailModal.hidden = true;
  document.body.style.overflow = "";
}

function requestAdminAccess(afterUnlock = openModal) {
  if (productionDatabaseAdapter?.canWrite) {
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
document.querySelector("#continue-to-entry").addEventListener("click", prepareEntryStepTwo);
document.querySelectorAll(".save-schedule-button").forEach((button) => button.addEventListener("click", () => saveEntrySchedule(button)));
document.querySelector("#entry-league").addEventListener("change", () => {
  const tournament = document.querySelector("#entry-league").value;
  syncEntryPhaseOptions(tournament);
  syncEntryTeamOptions();
});
document.querySelector("#entry-phase").addEventListener("change", () => {
  syncEntryStageOptions(document.querySelector("#entry-league").value);
});
document.querySelector("#entry-format").addEventListener("change", () => {
  if (syncEntryGameDraftCount()) showToast("Game tabs adjusted to the selected match format.");
});
document.querySelector("#entry-stage").addEventListener("change", (event) => {
  const customInput = document.querySelector("#entry-custom-stage");
  customInput.hidden = event.target.value !== "__custom__";
  customInput.required = !customInput.hidden;
  if (!customInput.hidden) customInput.focus();
});
document.querySelector("#entry-game-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-entry-game]");
  if (!tab) return;
  currentEntryGame = Number(tab.dataset.entryGame);
  renderEntryGameTabs();
  renderEntryGamePanel();
});
document.querySelector("#entry-game-panel").addEventListener("paste", (event) => {
  const target = event.target.closest(".entry-stats-table input, .entry-stats-table select, .entry-ban-selects input, .entry-objective-team input");
  if (!target) return;
  const clipboardText = event.clipboardData?.getData("text/plain") || "";
  if (!clipboardText.includes("\t") && !/[\r\n]/.test(clipboardText)) return;
  const pastedRows = clipboardText.replace(/\r/g, "").split("\n");
  if (pastedRows.at(-1) === "") pastedRows.pop();
  const values = pastedRows.map((row) => row.split("\t"));
  let editorRows;
  let startRowIndex;
  let startColumnIndex;
  const table = target.closest(".entry-stats-table");
  if (table) {
    editorRows = [...table.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll('input:not([type="hidden"]), select')]
    );
    const targetRow = target.closest("tr");
    startRowIndex = [...table.querySelectorAll("tbody tr")].indexOf(targetRow);
    startColumnIndex = editorRows[startRowIndex].indexOf(target);
  } else {
    const isObjective = !!target.closest(".entry-objective-team");
    const section = target.closest(isObjective ? ".entry-objectives" : ".entry-bans-grid");
    const rowSelector = isObjective ? ".entry-objective-team" : ".entry-ban-selects";
    const editorGroups = [...section.querySelectorAll(rowSelector)];
    editorRows = editorGroups.map((group) => [...group.querySelectorAll("input")]);
    const targetGroup = target.closest(rowSelector);
    startRowIndex = editorGroups.indexOf(targetGroup);
    startColumnIndex = editorRows[startRowIndex].indexOf(target);
  }
  if (startRowIndex < 0 || startColumnIndex < 0) return;
  event.preventDefault();
  let pastedCellCount = 0;
  let lastEditor = target;
  values.forEach((rowValues, rowOffset) => {
    const editors = editorRows[startRowIndex + rowOffset];
    if (!editors) return;
    rowValues.forEach((rawValue, columnOffset) => {
      const editor = editors[startColumnIndex + columnOffset];
      if (!editor) return;
      const value = rawValue.trim();
      if (editor.type === "radio" || editor.type === "checkbox") {
        editor.checked = /^(1|true|yes|y|x|mvp|first blood)$/i.test(value);
      } else if (editor.type === "number") {
        editor.value = value.replace(/,/g, "");
      } else {
        editor.value = value;
      }
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      pastedCellCount += 1;
      lastEditor = editor;
    });
  });
  lastEditor.focus({ preventScroll: true });
  showToast(`${pastedCellCount} spreadsheet cells pasted.`);
});
document.querySelector("#entry-game-panel").addEventListener("input", (event) => {
  const input = event.target;
  const game = entryGameDrafts[currentEntryGame - 1];
  if (input.dataset.entryField === "winner" || input.dataset.entryField === "duration") {
    game[input.dataset.entryField] = input.value;
    if (input.dataset.entryField === "winner") updateEntrySeriesScore();
    return;
  }
  if (input.dataset.entryBanIndex !== undefined) {
    game[`bans${input.dataset.entrySide}`][Number(input.dataset.entryBanIndex)] = input.value;
    return;
  }
  if (input.dataset.entryPick) {
    const side = input.dataset.entrySide;
    const laneIndex = Number(input.dataset.entryLane);
    const pick = game[`picks${side}`][laneIndex];
    if (input.dataset.entryPick === "player") {
      const team = selectedTeamNames()[side === "A" ? "teamA" : "teamB"];
      const typedName = input.value.trim();
      const rosterMember = getTeamRoster(document.querySelector("#entry-league").value, team)
        .find((member) => canPlayLane(member, pick.lane) && member.name.toLowerCase() === typedName.toLowerCase());
      pick.player = input.value;
      pick.playerId = rosterMember?.id || "";
    } else {
      pick[input.dataset.entryPick] = input.type === "number" ? Number(input.value) : input.value;
    }
    if (["kills", "assists"].includes(input.dataset.entryPick)) {
      refreshEntryKpCells(game, side);
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
  if (event.target.dataset.entryAward && event.target.checked) {
    const { entrySide, entryLane, entryAward } = event.target.dataset;
    ["A", "B"].forEach((side) => entryGameDrafts[currentEntryGame - 1][`picks${side}`].forEach((player, index) => {
      player[entryAward] = side === entrySide && index === Number(entryLane);
    }));
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
  const editMatchButton = event.target.closest("[data-edit-match]");
  if (editMatchButton) {
    const matchId = editMatchButton.dataset.editMatch;
    closeMatchDetails();
    openModal(matchId);
    return;
  }
  const deleteMatchButton = event.target.closest("[data-delete-match]");
  if (deleteMatchButton) {
    const matchId = deleteMatchButton.dataset.deleteMatch;
    const match = matchDetails[matchId];
    if (!match || !window.confirm(`Delete ${match.teamA} vs ${match.teamB}? This cannot be undone.`)) return;
    deleteMatchButton.disabled = true;
    productionDatabaseAdapter.deleteMatch(matchId).then(async () => {
      closeMatchDetails();
      await finishDatabaseWrite("Match deleted from Supabase.");
    }).catch(async (error) => {
      deleteMatchButton.disabled = false;
      await showDatabaseWriteError("Match deletion", error);
    });
    return;
  }
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
    else if (!modal.hidden) closeModal();
    else if (!adminAccessModal.hidden) closeAdminAccess();
  }
});
document.querySelector("#access-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const passwordInput = document.querySelector("#access-password");
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  const accessError = document.querySelector("#access-error");
  submitButton.disabled = true;
  accessError.hidden = true;
  try {
    const isAdmin = await productionDatabaseAdapter.signIn(passwordInput.value);
    if (isAdmin) {
      await productionDatabaseAdapter.signOut();
      throw new Error("Use the Admin button after signing in with the viewer password.");
    }
    productionDatabaseAdapter.canWrite = false;
    await refreshProductionData();
    accessGate.hidden = true;
    appShell.hidden = false;
    updateAdminControls();
    startRealtimeRefresh();
    passwordInput.value = "";
  } catch (error) {
    accessError.textContent = `Could not sign in: ${error.message}`;
    accessError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});
document.querySelector("#admin-access-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const passwordInput = document.querySelector("#admin-password");
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
    updateAdminControls();
    await refreshProductionData();
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
});
document.querySelector("#sign-out-button").addEventListener("click", () => {
  productionDatabaseAdapter.signOut().then(() => {
    stopRealtimeRefresh();
    productionDatabaseAdapter.canWrite = false;
    matchDetails = {};
    tournamentSettings = {};
    leagueTeams = {};
    leagueOptions = [];
    teamRosters.clear();
    updateAdminControls();
    appShell.hidden = true;
    accessGate.hidden = false;
    document.body.style.overflow = "";
    document.querySelector("#access-form").reset();
    document.querySelector("#access-error").hidden = true;
  }).catch((error) => showToast(`Could not sign out: ${error.message}`));
});
document.querySelector("#admin-toggle-button").addEventListener("click", () => {
  const canEdit = !!productionDatabaseAdapter?.canWrite;
  if (canEdit) {
    showToast("Admin access is active for this session.");
    return;
  }
  requestAdminAccess(() => updateAdminControls());
});
document.querySelector("#match-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  syncEntryGameDraftCount();
  const previewMatch = buildEntryPreviewMatch();
  if (previewMatch.streamUrl && !/^https?:\/\//i.test(previewMatch.streamUrl)) {
    showToast("Use an http or https link for the live stream.");
    return;
  }
  if (previewMatch.games.some((game) => [...game.playersA, ...game.playersB].some((player) => !player.hero.trim()))) {
    showToast("Enter a hero for every player before saving the result.");
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
  for (const game of previewMatch.games) {
    for (const side of ["A", "B"]) {
      const team = side === "A" ? previewMatch.teamA : previewMatch.teamB;
      const bans = game[`bans${side}`];
      if (bans.length !== 4 || new Set(bans).size !== 4) {
        showToast(`Choose four different banned heroes for ${team} in Game ${game.gameNumber}.`);
        return;
      }
    }
  }
  if (previewMatch.games.some((game) => [...game.playersA, ...game.playersB].some((player) => !player.player.trim()))) {
    showToast("Enter all five player names for both teams before saving the result.");
    return;
  }
  for (const game of previewMatch.games) {
    for (const side of ["A", "B"]) {
      const players = game[`players${side}`].map((player) => player.player.trim().toLowerCase());
      if (new Set(players).size !== players.length) {
        const team = side === "A" ? previewMatch.teamA : previewMatch.teamB;
        showToast(`${team} cannot use the same player in more than one role in Game ${game.gameNumber}.`);
        return;
      }
    }
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
  const saveButton = document.querySelector("#save-match-button");
  saveButton.disabled = true;
  try {
    await productionDatabaseAdapter.saveMatch(previewMatch, editingMatchId);
    closeModal();
    await finishDatabaseWrite("Match result and game stats saved to Supabase.");
  } catch (error) {
    showToast(`Match was not saved: ${error.message}`);
  } finally {
    saveButton.disabled = false;
  }
});
function setTheme(isDark, notify = false) {
  document.body.classList.toggle("dark-mode", isDark);
  localStorage.setItem(themeStorageKey, isDark ? "dark" : "light");
  if (notify) showToast(isDark ? "Dark mode enabled." : "Light mode enabled.");
}

function toggleTheme() {
  setTheme(!document.body.classList.contains("dark-mode"), true);
}

setTheme(localStorage.getItem(themeStorageKey) === "dark");
document.querySelector("#theme-button").addEventListener("click", toggleTheme);
document.querySelector("#gate-theme-button").addEventListener("click", toggleTheme);

document.addEventListener("visibilitychange", () => {
  if (canRefreshRealtimeData()) refreshProductionData().catch(() => {});
});

window.addEventListener("focus", () => {
  if (canRefreshRealtimeData()) refreshProductionData().catch(() => {});
});

