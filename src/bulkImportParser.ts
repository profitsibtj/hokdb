// Parses a block of tab-separated match/game/player-stat rows (pasted straight from a spreadsheet,
// e.g. Google Sheets/Excel selection copied with Ctrl+C) into ready-to-save Match objects, so a
// whole backlog of already-played matches can be entered in one paste instead of one game/one
// player at a time through DraftBoard. Columns are matched by HEADER NAME (case-insensitive), not
// position, so hidden/reordered/extra columns in the source sheet (helper columns the sheet owner
// keeps for their own formulas, a running season-wide game counter, KP%/DMG%/TKN% formulas, etc.)
// are simply ignored instead of breaking the import.
//
// Handles one thing a plain-text paste can't represent on its own: a merged cell (e.g. one TEAM
// name spanning a whole 5-row block) pastes as a value in only the first row of that block and
// blank in the rest. Every column that's naturally constant across a block of rows (date, match
// code, team, game, win/loss, side, duration, objectives) is forward-filled from the last non-blank
// value above it; columns that are genuinely per-player (player name, hero, K/D/A, gold, damage,
// etc.) never are.
import { Game, GameObjectives, GamePlayerStats, LanePosition, MatchFormat, ObjectiveType, OBJECTIVE_TYPES, RosterPlayer, Side, LANE_POSITIONS } from "./types";
import { canonicalizePlayerName, canonicalizeTeamName } from "./utils";

type Row = Record<string, string>;

// Canonical column keys this parser understands, and every header spelling in the wild that should
// map to each one. Matched case-insensitively with whitespace collapsed - see normalizeHeader().
const HEADER_ALIASES: Record<string, string[]> = {
  DATE: ["DATE"],
  MATCH: ["MATCH", "MATCH CODE"],
  TEAM: ["TEAM"],
  GAME: ["GAME"],
  RESULTS: ["RESULTS", "RESULT", "WIN LOSS", "WIN/LOSS"],
  SIDE: ["SIDE"],
  BANNED: ["BANNED", "BAN"],
  PICKED: ["PICKED", "PICK", "HERO"],
  PLAYER: ["PLAYER"],
  FIRST_BLOOD: ["FIRST BLOOD", "FB"],
  TIME: ["TIME", "DURATION"],
  POM: ["POM", "MVP"],
  K: ["K", "KILLS"],
  D: ["D", "DEATHS"],
  A: ["A", "ASSISTS"],
  GOLD: ["GOLD"],
  DAMAGE: ["DAMAGE", "HERO DAMAGE"],
  TAKEN: ["TAKEN", "DAMAGE TAKEN"],
  TOTAL_GOLD: ["TOTAL GOLD"],
  TYRANT: ["TYRANT"],
  SDW_TYRANT: ["SDW TYRANT", "SHADOW TYRANT"],
  TEMPEST: ["TEMPEST"],
  OVERLORD: ["OVERLORD"],
  SDW_OVERLORD: ["SDW OVERLORD", "SHADOW OVERLORD"],
  TOWERS: ["TOWERS"],
  SOLO: ["SOLO", "SINGLE"],
  DOUBLE: ["DOUBLE"],
  TRIPLE: ["TRIPLE"],
  QUADRA: ["QUADRA"],
  PENTA: ["PENTA"]
};

// Every match/game/player needs these to build a valid Game - everything else in HEADER_ALIASES is
// optional and just defaults to blank/0/false when the column isn't present in the pasted data.
const REQUIRED_KEYS = ["DATE", "MATCH", "TEAM", "GAME", "RESULTS", "SIDE", "PICKED", "PLAYER", "K", "D", "A", "GOLD", "DAMAGE", "TAKEN"];

const OBJECTIVE_KEY_MAP: Record<ObjectiveType, string> = {
  tyrant: "TYRANT",
  shadowTyrant: "SDW_TYRANT",
  tempest: "TEMPEST",
  overlord: "OVERLORD",
  shadowOverlord: "SDW_OVERLORD",
  towers: "TOWERS"
};

// Columns that are constant across a whole block of rows in the source sheet (one team's 5-player
// block, one game's 10-row block, or a whole match's worth of rows) and so paste in blank for every
// row but the block's first whenever that column was a merged cell in the sheet. Forward-filled
// from the last non-blank value seen - see the module comment above.
const BLOCK_LEVEL_KEYS = ["DATE", "MATCH", "TEAM", "GAME", "RESULTS", "SIDE", "TIME", "TOTAL_GOLD", "TYRANT", "SDW_TYRANT", "TEMPEST", "OVERLORD", "SDW_OVERLORD", "TOWERS"];

const normalizeHeader = (cell: string): string => cell.trim().toUpperCase().replace(/\s+/g, " ");

const truthy = (v: string | undefined): boolean => !!v && ["true", "1", "yes", "y", "ya", "x", "✓", "√"].includes(v.trim().toLowerCase());

const toInt = (v: string | undefined): number => {
  if (!v) return 0;
  const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
};

// "11/04/25" / "11-04-2025" -> "2025-04-11" (day-first, the Indonesian convention this app already
// uses everywhere else - see formatDateDMY in utils.ts). Returns "" if it doesn't look like a date.
export const parseSheetDate = (raw: string): string => {
  const trimmed = (raw || "").trim();
  const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return "";
  const [, d, mo, yRaw] = m;
  const y = yRaw.length === 2 ? (Number(yRaw) < 70 ? `20${yRaw}` : `19${yRaw}`) : yRaw;
  const dd = d.padStart(2, "0");
  const mm = mo.padStart(2, "0");
  const day = Number(dd), month = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${y}-${mm}-${dd}`;
};

// "Week 1" out of a "W1D1M1"-style match code - anything it can't recognize this way is left blank
// for the reviewer to fill in by hand (still just as easy to edit as everything else in the review
// table).
const guessStage = (matchCode: string): string => {
  const m = matchCode.trim().toUpperCase().match(/^W(?:EEK)?\s*0*(\d+)/);
  return m ? `Week ${m[1]}` : "";
};

export interface ParsedMatchGroup {
  matchCode: string;
  date: string; // "YYYY-MM-DD", "" if unparseable
  teamA: string;
  teamB: string;
  stage: string; // pre-filled best-effort guess, editable in the review UI
  format: MatchFormat; // pre-filled from the league's default format, editable in the review UI
  games: Game[];
  warnings: string[];
  errors: string[]; // non-empty => this group can't be imported as-is
}

export interface ParseResult {
  ok: boolean;
  globalError?: string; // header row problems - nothing else could even be attempted
  optionalColumnsMissing: string[]; // human-readable column keys, for a single up-front notice
  groups: ParsedMatchGroup[];
}

interface RawTeamBlock { teamName: string; rows: Row[] }
interface RawGameBlock { gameLabel: string; teamBlocks: RawTeamBlock[] }
interface RawMatchBlock { matchCode: string; date: string; games: RawGameBlock[] }

export function parseBulkMatchSheet(
  rawText: string,
  defaultFormat: MatchFormat,
  roster: RosterPlayer[],
  teamList: string[],
  teamAbbreviations?: Record<string, string>
): ParseResult {
  const lines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    return { ok: false, globalError: "Belum ada data - paste baris judul kolom plus minimal 1 baris data dulu.", optionalColumnsMissing: [], groups: [] };
  }

  const headerCells = lines[0].split("\t").map(normalizeHeader);
  const colIndex: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headerCells.findIndex((h) => aliases.includes(h));
    if (idx !== -1) colIndex[key] = idx;
  }

  const missingRequired = REQUIRED_KEYS.filter((k) => !(k in colIndex));
  if (missingRequired.length > 0) {
    return {
      ok: false,
      globalError: `Kolom wajib tidak ketemu di baris judul: ${missingRequired.join(", ")}. Pastikan baris pertama yang di-paste adalah baris header, bukan data.`,
      optionalColumnsMissing: [],
      groups: []
    };
  }
  const optionalColumnsMissing = Object.keys(HEADER_ALIASES).filter((k) => !REQUIRED_KEYS.includes(k) && !(k in colIndex));

  // Parse every data row into a Row keyed by our canonical column names, then forward-fill the
  // block-level columns so a merged cell that only pasted a value into the first row of its block
  // reads as that same value on every row of the block.
  const rows: Row[] = lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Row = {};
    for (const key of Object.keys(HEADER_ALIASES)) {
      const idx = colIndex[key];
      row[key] = idx !== undefined ? (cells[idx] ?? "").trim() : "";
    }
    return row;
  });

  const lastSeen: Record<string, string> = {};
  for (const row of rows) {
    for (const key of BLOCK_LEVEL_KEYS) {
      if (row[key]) lastSeen[key] = row[key];
      else row[key] = lastSeen[key] || "";
    }
  }

  // Rows with no MATCH value even after forward-fill are blank spacer rows some sheets have
  // between matches - drop them rather than starting a bogus empty group.
  const dataRows = rows.filter((r) => r.MATCH);

  const matchBlocks: RawMatchBlock[] = [];
  let curMatch: RawMatchBlock | null = null;
  let curGame: RawGameBlock | null = null;
  let curTeam: RawTeamBlock | null = null;
  for (const row of dataRows) {
    if (!curMatch || curMatch.matchCode !== row.MATCH) {
      curMatch = { matchCode: row.MATCH, date: row.DATE, games: [] };
      matchBlocks.push(curMatch);
      curGame = null;
      curTeam = null;
    }
    if (!curGame || curGame.gameLabel !== row.GAME) {
      curGame = { gameLabel: row.GAME, teamBlocks: [] };
      curMatch.games.push(curGame);
      curTeam = null;
    }
    if (!curTeam || curTeam.teamName !== row.TEAM) {
      curTeam = { teamName: row.TEAM, rows: [] };
      curGame.teamBlocks.push(curTeam);
    }
    curTeam.rows.push(row);
  }

  const groups = matchBlocks.map((block) => buildGroup(block, defaultFormat, roster, teamList, teamAbbreviations));
  return { ok: true, optionalColumnsMissing, groups };
}

function buildObjectives(row: Row): GameObjectives {
  const obj = {} as GameObjectives;
  for (const type of OBJECTIVE_TYPES) obj[type] = toInt(row[OBJECTIVE_KEY_MAP[type]]);
  return obj;
}

function buildGroup(
  block: RawMatchBlock,
  defaultFormat: MatchFormat,
  roster: RosterPlayer[],
  teamList: string[],
  teamAbbreviations?: Record<string, string>
): ParsedMatchGroup {
  const warnings: string[] = [];
  const errors: string[] = [];
  const date = parseSheetDate(block.date);
  if (!date) warnings.push(`Tanggal "${block.date}" tidak dikenali (harusnya DD/MM/YY) - isi manual di review.`);

  const firstGame = block.games[0];
  if (!firstGame || firstGame.teamBlocks.length !== 2) {
    errors.push(`Game pertama harus punya persis 2 tim (ketemu ${firstGame?.teamBlocks.length ?? 0}) - cek pengelompokan barisnya.`);
    return { matchCode: block.matchCode, date, teamA: "", teamB: "", stage: guessStage(block.matchCode), format: defaultFormat, games: [], warnings, errors };
  }

  const teamA = canonicalizeTeamName(firstGame.teamBlocks[0].teamName, teamList, teamAbbreviations);
  const teamB = canonicalizeTeamName(firstGame.teamBlocks[1].teamName, teamList, teamAbbreviations);
  if (!teamA || !teamB || teamA.toLowerCase() === teamB.toLowerCase()) {
    errors.push(`Nama tim Game 1 tidak valid ("${firstGame.teamBlocks[0].teamName}" / "${firstGame.teamBlocks[1].teamName}").`);
  }

  const rosterA = roster.filter((r) => r.team.trim().toLowerCase() === teamA.trim().toLowerCase());
  const rosterB = roster.filter((r) => r.team.trim().toLowerCase() === teamB.trim().toLowerCase());

  const games: Game[] = [];
  block.games.forEach((gb, gIdx) => {
    const gameNumber = (() => {
      const m = gb.gameLabel.match(/(\d+)/);
      return m ? parseInt(m[1], 10) : gIdx + 1;
    })();

    if (gb.teamBlocks.length !== 2) {
      errors.push(`Game ${gameNumber}: ketemu ${gb.teamBlocks.length} tim, harusnya 2.`);
      return;
    }

    const sideOf = (teamBlock: RawTeamBlock): Side | null => {
      const canon = canonicalizeTeamName(teamBlock.teamName, teamList, teamAbbreviations);
      if (canon.toLowerCase() === teamA.toLowerCase()) return "A";
      if (canon.toLowerCase() === teamB.toLowerCase()) return "B";
      return null;
    };

    const sideBlocks: Partial<Record<Side, RawTeamBlock>> = {};
    let sideMismatch = false;
    for (const tb of gb.teamBlocks) {
      const side = sideOf(tb);
      if (!side) {
        errors.push(`Game ${gameNumber}: nama tim "${tb.teamName}" beda dari Game 1 (${teamA} / ${teamB}).`);
        sideMismatch = true;
        break;
      }
      sideBlocks[side] = tb;
    }
    if (sideMismatch || !sideBlocks.A || !sideBlocks.B) {
      if (!sideMismatch) errors.push(`Game ${gameNumber}: tidak bisa nentuin sisi A/B masing-masing tim.`);
      return;
    }
    const blockA = sideBlocks.A;
    const blockB = sideBlocks.B;

    if (blockA.rows.length !== 5 || blockB.rows.length !== 5) {
      errors.push(`Game ${gameNumber}: jumlah baris pemain ${blockA.rows.length} vs ${blockB.rows.length}, harusnya 5 vs 5.`);
      return;
    }

    const buildPlayers = (tb: RawTeamBlock, rosterForTeam: RosterPlayer[], teamName: string): GamePlayerStats[] =>
      tb.rows.map((row, idx) => {
        const rawName = row.PLAYER;
        const name = canonicalizePlayerName(rawName, rosterForTeam);
        const found = rosterForTeam.find((r) => r.name.trim().toLowerCase() === name.toLowerCase());
        let position: LanePosition;
        if (found && (LANE_POSITIONS as string[]).includes(found.position)) {
          position = found.position as LanePosition;
        } else {
          position = LANE_POSITIONS[idx % LANE_POSITIONS.length];
          warnings.push(`Game ${gameNumber} - ${teamName}: posisi "${rawName}" ditebak dari urutan baris (${position}) karena tidak ketemu di roster - cek lagi.`);
        }
        return {
          playerName: name,
          position,
          hero: row.PICKED,
          kills: toInt(row.K),
          deaths: toInt(row.D),
          assists: toInt(row.A),
          goldEarned: toInt(row.GOLD),
          heroDamage: toInt(row.DAMAGE),
          damageTaken: toInt(row.TAKEN),
          mvp: truthy(row.POM),
          firstBlood: truthy(row.FIRST_BLOOD),
          singleKills: toInt(row.SOLO),
          doubleKills: toInt(row.DOUBLE),
          tripleKills: toInt(row.TRIPLE),
          quadraKills: toInt(row.QUADRA),
          pentaKills: toInt(row.PENTA)
        };
      });

    const collectBans = (tb: RawTeamBlock): string[] => {
      const bans = tb.rows.map((r) => r.BANNED).filter(Boolean);
      if (bans.length > 4) warnings.push(`Game ${gameNumber} - ${tb.teamName}: ketemu ${bans.length} ban, cuma 4 pertama dipakai.`);
      return bans.slice(0, 4);
    };

    const resultOf = (tb: RawTeamBlock): string => (tb.rows[0]?.RESULTS || "").trim().toUpperCase();
    let winner: Side | null = null;
    if (resultOf(blockA) === "WIN" && resultOf(blockB) !== "WIN") winner = "A";
    else if (resultOf(blockB) === "WIN" && resultOf(blockA) !== "WIN") winner = "B";
    else warnings.push(`Game ${gameNumber}: kolom RESULTS tidak jelas siapa menang (harus persis satu tim "WIN").`);

    const isBlue = (tb: RawTeamBlock): boolean => (tb.rows[0]?.SIDE || "").trim().toUpperCase() === "BLUE";
    let blueSide: Side | undefined;
    if (isBlue(blockA) && !isBlue(blockB)) blueSide = "A";
    else if (isBlue(blockB) && !isBlue(blockA)) blueSide = "B";

    const checkGoldTotal = (tb: RawTeamBlock, label: string) => {
      const sum = tb.rows.reduce((s, r) => s + toInt(r.GOLD), 0);
      const reported = toInt(tb.rows[0]?.TOTAL_GOLD);
      if (reported && Math.abs(sum - reported) > 1) {
        warnings.push(`Game ${gameNumber} - ${label}: Total Gold (${reported}) tidak cocok sama jumlah gold per-pemain (${sum}) - cek lagi datanya.`);
      }
    };
    checkGoldTotal(blockA, teamA);
    checkGoldTotal(blockB, teamB);

    games.push({
      gameNumber,
      winner,
      bansA: collectBans(blockA),
      bansB: collectBans(blockB),
      teamAPlayers: buildPlayers(blockA, rosterA, teamA),
      teamBPlayers: buildPlayers(blockB, rosterB, teamB),
      blueSide,
      duration: blockA.rows[0]?.TIME || undefined,
      objectivesA: buildObjectives(blockA.rows[0]),
      objectivesB: buildObjectives(blockB.rows[0])
    });
  });

  return { matchCode: block.matchCode, date, teamA, teamB, stage: guessStage(block.matchCode), format: defaultFormat, games, warnings, errors };
}
