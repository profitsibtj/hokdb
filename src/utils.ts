import { Match, Side, LeaguePreset, BracketPreset, BracketMatch, SingleEliminationBracketPreset, DoubleEliminationBracketPreset } from "./types";

// Displays a stored date as DD-MM-YYYY (the convention used everywhere on this site), matching
// how the native date input (AddMatchForm) already renders under an id-ID/en-GB locale. Only
// touches strings that actually look like a stored "YYYY-MM-DD" date - passed through unchanged
// otherwise, since some callers reuse the same field for a non-date label.
export const formatDateDMY = (dateStr?: string | null): string => {
  if (!dateStr) return "";
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
};

// Match Schedule's date/time is always meant as Indonesia local time (GMT+7, WIB - no DST), the
// league's home timezone, regardless of which timezone the admin's own device happens to be set
// to. Stored as a UTC instant (scheduledAt) so the countdown/live logic itself is unaffected, and
// so each viewer's own browser can render it back in their own local time automatically
// (`toLocaleString()` already does this without help) - only the admin-facing input/edit forms
// need to consistently mean GMT+7 rather than "whatever timezone this browser happens to be in".
const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;

// Combines a GMT+7 wall-clock date+time into the UTC ISO instant it represents. Parsing
// "YYYY-MM-DDTHH:mm" directly (with no offset) would instead assume the *browser's* local
// timezone - correct only when the admin's device happens to already be set to WIB.
export const gmt7ToIso = (dateStr: string, timeStr: string): string => {
  if (!dateStr || !timeStr) return "";
  const dt = new Date(`${dateStr}T${timeStr}:00+07:00`);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
};

// Splits a UTC ISO instant back into the GMT+7 wall-clock date/time it represents. Reading it via
// Date's local getters (getHours(), getFullYear(), ...) would instead return the *browser's* local
// time - wrong whenever the admin viewing/editing it isn't themselves in WIB.
export const isoToGmt7Parts = (iso: string): { date: string; time: string } | null => {
  if (!iso) return null;
  const utcMs = new Date(iso).getTime();
  if (Number.isNaN(utcMs)) return null;
  const shifted = new Date(utcMs + GMT7_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  };
};

// Pulls just the Week number out of a match's stage label, e.g. "Week 2" -> "Week 2" (already
// normalized) or "W2" -> "Week 2". Returns null when no week is encoded (not every league/stage
// uses a week structure).
export const getMatchWeekLabel = (match: Match): string | null => {
  const stage = (match.stage || "").toUpperCase();
  const weekMatch = stage.match(/W(?:EEK)?\s*(\d+)/);
  return weekMatch ? `Week ${weekMatch[1]}` : null;
};

// Extracts the canonical list of team names configured for a league preset, used to reconcile
// team-name variants (e.g. an abbreviation typed instead of the full name) back to one consistent
// name for stats/standings aggregation.
export const getLeagueTeamList = (preset: LeaguePreset | undefined | null): string[] => {
  if (!preset) return [];
  const teamNames = (preset.teamsText || "").split("\n").map((t) => t.trim()).filter(Boolean);
  return Array.from(new Set(teamNames));
};

// Reconciles a raw team-name string (which may be an abbreviation, or differently-cased entry)
// back to the league's canonical team name, using the configured team list plus any registered
// ABBR mapping. Falls back to the trimmed input unchanged when no match is found, so unrecognized/
// custom team names still pass through untouched.
export const canonicalizeTeamName = (
  rawName: string,
  teamList: string[],
  teamAbbreviations?: Record<string, string>
): string => {
  const trimmed = (rawName || "").trim();
  if (!trimmed) return trimmed;
  const upper = trimmed.toUpperCase();

  const exact = teamList.find((t) => t.toUpperCase().trim() === upper);
  if (exact) return exact;

  if (teamAbbreviations) {
    for (const teamKeyUpper of Object.keys(teamAbbreviations)) {
      if ((teamAbbreviations[teamKeyUpper] || "").toUpperCase().trim() === upper) {
        const canonical = teamList.find((t) => t.toUpperCase().trim() === teamKeyUpper);
        if (canonical) return canonical;
      }
    }
  }

  return trimmed;
};

// Reconciles a raw player-name string back to that player's current roster name, using each
// roster player's registered "previous names" - so stats logged under an old nickname (before a
// rename) still accumulate onto the same player instead of appearing as a separate person. Falls
// back to the trimmed input unchanged when no match is found.
export const canonicalizePlayerName = (
  rawName: string,
  rosterForTeam: { name: string; previousNames?: string[] }[]
): string => {
  const trimmed = (rawName || "").trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();

  const exact = rosterForTeam.find((r) => r.name.trim().toLowerCase() === lower);
  if (exact) return exact.name.trim();

  for (const r of rosterForTeam) {
    if ((r.previousNames || []).some((pn) => pn.trim().toLowerCase() === lower)) {
      return r.name.trim();
    }
  }

  return trimmed;
};

// Fearless draft (per-team/"soft" rule, not the shared-global variant): a hero picked by a side
// earlier in this match can't be picked again by that SAME side, but the other side is
// unaffected - e.g. if Team A picks Zhang Fei in Game 1, Team A can't repick him later in the
// match, but Team B still can (until Team B themselves pick him). Only actual picks count, not
// bans. Used by DraftBoard as a soft warning, not a hard block.
export const getTeamUsedHeroes = (match: Match, uptoGameNumber: number, side: Side): string[] => {
  const heroes = new Set<string>();
  (match.games || [])
    .filter((g) => g.gameNumber < uptoGameNumber)
    .forEach((g) => {
      const players = side === "A" ? g.teamAPlayers : g.teamBPlayers;
      (players || []).forEach((p) => {
        if (p.hero && p.hero.trim()) heroes.add(p.hero.trim());
      });
    });
  return Array.from(heroes);
};

export interface TeamStanding {
  team: string;
  matchesWon: number;
  matchesLost: number;
  gamesWon: number;
  gamesLost: number;
}

// Standings: ranked by match W-L record, tiebroken by game differential (games won minus games
// lost across all their matches) - the common LPL/KPL pattern the user asked for, unlike PUBGM's
// weekly-rank-to-points conversion (there's no per-week ranking concept in a head-to-head league).
export const calculateStandings = (
  matchList: Match[],
  league: string,
  stageFilter?: string
): TeamStanding[] => {
  // Playoff matches are deliberately excluded - a bracket result shouldn't inflate a team's
  // regular-season league record. Playoff standing (if ever wanted) is a different question the
  // Bracket view already answers on its own.
  const relevant = matchList.filter(
    (m) => m.league === league && m.isFinished && !m.isPlayoff && (!stageFilter || m.stage === stageFilter)
  );

  const teamAgg: Record<string, TeamStanding> = {};

  const ensure = (team: string): TeamStanding => {
    if (!teamAgg[team]) {
      teamAgg[team] = { team, matchesWon: 0, matchesLost: 0, gamesWon: 0, gamesLost: 0 };
    }
    return teamAgg[team];
  };

  relevant.forEach((m) => {
    const a = ensure(m.teamA);
    const b = ensure(m.teamB);
    a.gamesWon += m.scoreA;
    a.gamesLost += m.scoreB;
    b.gamesWon += m.scoreB;
    b.gamesLost += m.scoreA;

    if (m.winner === m.teamA) {
      a.matchesWon += 1;
      b.matchesLost += 1;
    } else if (m.winner === m.teamB) {
      b.matchesWon += 1;
      a.matchesLost += 1;
    }
  });

  return Object.values(teamAgg).sort((x, y) => {
    if (y.matchesWon !== x.matchesWon) return y.matchesWon - x.matchesWon;
    const diffX = x.gamesWon - x.gamesLost;
    const diffY = y.gamesWon - y.gamesLost;
    if (diffY !== diffX) return diffY - diffX;
    return y.gamesWon - x.gamesWon;
  });
};

// Finds the real Match a bracket slot represents - matched by league + isPlayoff + the same two
// teams (order-agnostic, since a bracket slot doesn't track which side was "home"), not by any
// stored link. Bracket slots deliberately don't store a match id (see BracketMatch in types.ts),
// so this is always a best-effort lookup. Restricting to isPlayoff matches (rather than the old
// "most recently scheduled" heuristic) means a regular-season meeting between the same two teams
// can never be mistaken for their playoff one - the two pools don't overlap at all anymore. If
// they somehow met twice within playoffs itself (e.g. a replayed match), the most recently
// scheduled one is still the tiebreak.
export const findMatchByTeams = (matches: Match[], league: string, teamA: string, teamB: string): Match | undefined => {
  const a = teamA.trim().toLowerCase();
  const b = teamB.trim().toLowerCase();
  if (!a || !b) return undefined;
  const candidates = matches.filter((m) =>
    m.league === league && m.isFinished && m.isPlayoff &&
    ((m.teamA.trim().toLowerCase() === a && m.teamB.trim().toLowerCase() === b) ||
     (m.teamA.trim().toLowerCase() === b && m.teamB.trim().toLowerCase() === a))
  );
  if (candidates.length === 0) return undefined;
  return candidates.sort((x, y) => (y.scheduledAt || "").localeCompare(x.scheduledAt || ""))[0];
};

// Builds a fresh single-elimination bracket: `size` (must be a power of 2, e.g. 4/8/16) Round 1
// slots seeded with placeholder names, and an empty BracketMatch for every slot in every round
// (size/2 in Round 1, halving down to 1 in the Final). Every round after Round 1 starts blank -
// their team names are always DERIVED from earlier rounds' winners (see resolveBracketTeam), not
// stored, so there's nothing to pre-fill here.
export const createBracket = (league: string, name: string, size: number): SingleEliminationBracketPreset => {
  const seeds = Array.from({ length: size }, (_, i) => `Seed ${i + 1}`);
  const matches: BracketMatch[][] = [];
  let roundSize = size / 2;
  while (roundSize >= 1) {
    matches.push(Array.from({ length: roundSize }, () => ({})));
    roundSize = roundSize / 2;
  }
  return { id: `bracket_${Date.now()}`, league, name, seeds, matches };
};

// The team name occupying `side` of round `round`'s match `matchIndex` (both 0-indexed, round 0
// = Round 1). Round 0 reads straight from `seeds`; any later round recurses into the match that
// feeds it and returns "" (still TBD) until that earlier match has a winner set - so a bracket
// only ever shows a name once it's actually been decided, never a guess.
export const resolveBracketTeam = (bracket: SingleEliminationBracketPreset, round: number, matchIndex: number, side: Side): string => {
  if (round === 0) {
    const idx = side === "A" ? matchIndex * 2 : matchIndex * 2 + 1;
    return (bracket.seeds[idx] || "").trim();
  }
  const prevRound = round - 1;
  const prevIndex = side === "A" ? matchIndex * 2 : matchIndex * 2 + 1;
  const prevMatch = bracket.matches[prevRound]?.[prevIndex];
  if (!prevMatch?.winner) return "";
  return resolveBracketTeam(bracket, prevRound, prevIndex, prevMatch.winner);
};

// Standard tournament naming for a round based on how many matches remain in it (1 = Final, 2 =
// Semifinal, 4 = Quarterfinal, otherwise "Round of N" counting teams, not matches).
export const getBracketRoundLabel = (matchesInRound: number): string => {
  if (matchesInRound === 1) return "Final";
  if (matchesInRound === 2) return "Semifinal";
  if (matchesInRound === 4) return "Quarterfinal";
  return `Round of ${matchesInRound * 2}`;
};

// Every valid Stage label a Playoff match can be tagged with to land in one specific slot of this
// bracket - shown as a dropdown in AddMatchForm (see playoffStageOptions there) so an admin picks
// the exact slot instead of free-typing text that has to happen to match parseStageForBracketSlot
// / parseStageForDoubleEliminationSlot's pattern exactly. Kept here (not duplicated in the form)
// since it has to stay in lockstep with however those two parsers actually read Stage text.
export const getBracketStageOptions = (bracket: BracketPreset): string[] => {
  if (bracket.type === "double") {
    const options: string[] = [];
    if (bracket.playInCount >= 1) options.push("Play-In 1");
    if (bracket.playInCount >= 2) options.push("Play-In 2");
    options.push(
      "Upper Bracket Semifinal 1", "Upper Bracket Semifinal 2", "Upper Bracket Final",
      "Lower Bracket Semifinal", "Lower Bracket Final", "Grand Final"
    );
    return options;
  }
  const options: string[] = [];
  bracket.matches.forEach((round) => {
    const label = getBracketRoundLabel(round.length);
    if (round.length === 1) {
      options.push(label);
    } else {
      for (let i = 1; i <= round.length; i++) options.push(`${label} ${i}`);
    }
  });
  return options;
};

// Which bracket round+slot a playoff match's Stage text refers to - matched against this same
// bracket's own round names (see getBracketRoundLabel), e.g. "Quarterfinal 2" -> the Quarterfinal
// round's 2nd slot (1-indexed in the text, 0-indexed in the return value). A round name with no
// trailing number (plain "Final") resolves to slot 0, the only slot a 1-match round ever has.
// Returns null if the Stage text doesn't recognizably name one of this bracket's own rounds, or
// names a slot number the bracket doesn't have (e.g. "Quarterfinal 5" in a size-8 bracket).
export const parseStageForBracketSlot = (
  stage: string | undefined,
  bracket: SingleEliminationBracketPreset
): { round: number; matchIndex: number } | null => {
  if (!stage) return null;
  const trimmed = stage.trim();
  if (!trimmed) return null;
  for (let round = 0; round < bracket.matches.length; round++) {
    const label = getBracketRoundLabel(bracket.matches[round].length);
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    const re = new RegExp(`\\b${escapedLabel}\\b[\\s\\-#]*(\\d+)?`, "i");
    const match = trimmed.match(re);
    if (!match) continue;
    const matchIndex = match[1] ? parseInt(match[1], 10) - 1 : 0;
    if (matchIndex >= 0 && matchIndex < bracket.matches[round].length) {
      return { round, matchIndex };
    }
  }
  return null;
};

// Computes what a bracket should show RIGHT NOW, purely from the current match list - nothing
// here is ever written back to storage, so there's no persisted copy that can go stale (e.g. keep
// showing a team/winner after its underlying Match gets deleted or un-flagged as isPlayoff). Every
// call recomputes the whole thing from scratch: `bracket` only supplies the shape (league, name,
// how many seeds/rounds) via createBracket - its own .seeds/.matches content is ignored on input.
//
// Round 1 seeds: for every slot, picks whichever isPlayoff match in this league has a Stage that
// parses (see parseStageForBracketSlot) to that exact slot - looks at every playoff match
// regardless of isFinished, since an in-progress Bo3 still tells you who's playing. Ties (two
// matches whose Stage resolves to the same slot, e.g. a replayed match) go to whichever was
// scheduled most recently. A slot with no matching playoff match at all resolves to "" (shown as
// TBD), not a leftover placeholder.
//
// Every round's winner/score: derived the same way as before (see findMatchByTeams) - a slot with
// no matching *finished* playoff match stays blank, walked Round 1 first since each round's team
// names depend on the previous round's derived winner.
export const deriveBracketView = (bracket: SingleEliminationBracketPreset, matches: Match[]): SingleEliminationBracketPreset => {
  const seeds = bracket.seeds.map(() => "");
  const playoffMatches = matches.filter((m) => m.league === bracket.league && m.isPlayoff);
  const bySlot: Record<number, Match> = {};
  playoffMatches.forEach((m) => {
    const slot = parseStageForBracketSlot(m.stage, bracket);
    if (!slot || slot.round !== 0) return;
    const existing = bySlot[slot.matchIndex];
    if (!existing || (m.scheduledAt || "") > (existing.scheduledAt || "")) {
      bySlot[slot.matchIndex] = m;
    }
  });
  Object.entries(bySlot).forEach(([idxStr, m]) => {
    const idx = Number(idxStr);
    seeds[idx * 2] = m.teamA;
    seeds[idx * 2 + 1] = m.teamB;
  });

  const derivedRounds: BracketMatch[][] = bracket.matches.map((r) => r.map(() => ({} as BracketMatch)));
  const working: SingleEliminationBracketPreset = { ...bracket, seeds, matches: derivedRounds };

  for (let round = 0; round < derivedRounds.length; round++) {
    for (let matchIndex = 0; matchIndex < derivedRounds[round].length; matchIndex++) {
      const teamAName = resolveBracketTeam(working, round, matchIndex, "A");
      const teamBName = resolveBracketTeam(working, round, matchIndex, "B");
      if (!teamAName || !teamBName) continue;
      const linked = findMatchByTeams(matches, bracket.league, teamAName, teamBName);
      if (!linked || !linked.winner) continue;
      const linkedWinnerIsSlotA = linked.winner.trim().toLowerCase() === teamAName.trim().toLowerCase();
      const linkedTeamAIsSlotA = linked.teamA.trim().toLowerCase() === teamAName.trim().toLowerCase();
      derivedRounds[round][matchIndex] = {
        winner: linkedWinnerIsSlotA ? "A" : "B",
        scoreA: linkedTeamAIsSlotA ? linked.scoreA : linked.scoreB,
        scoreB: linkedTeamAIsSlotA ? linked.scoreB : linked.scoreA,
      };
    }
  }
  return working;
};

// --- Double-elimination bracket (see DoubleEliminationBracketPreset in types.ts) ---
//
// Every slot in this fixed 4-team shape is resolved completely independently, by finding whichever
// isPlayoff match in this league has a Stage tagged for that exact slot - there is no seeding or
// round-to-round derivation to get right (unlike the single-elimination bracket above), since each
// slot's own real logged match already declares its two actual teams. An admin just needs to give
// each playoff match the matching Stage text below (case-insensitive, extra spacing/punctuation
// tolerated) for it to appear in the right box - same "tag the match, it shows up" workflow as the
// single-elimination bracket's "Quarterfinal 1" convention.
export type DoubleEliminationSlotKey =
  | "playIn0" | "playIn1"
  | "upperSemi0" | "upperSemi1"
  | "upperFinal" | "lowerSemi" | "lowerFinal" | "grandFinal";

const DOUBLE_ELIM_STAGE_PATTERNS: { key: DoubleEliminationSlotKey; pattern: RegExp }[] = [
  // Checked in this order deliberately: the more specific/longer phrases first, so e.g. "Lower
  // Bracket Semifinal" is never mistaken for a bare "Final" (it isn't anyway, since none of these
  // patterns are just "\bfinal\b" alone - each requires its own distinguishing words together).
  { key: "grandFinal", pattern: /\bgrand\s*final\b/i },
  { key: "upperFinal", pattern: /\bupper\s*bracket\s*final\b/i },
  { key: "lowerFinal", pattern: /\blower\s*bracket\s*final\b/i },
  { key: "lowerSemi", pattern: /\blower\s*bracket\s*semi\s*-?\s*final\b/i },
  { key: "upperSemi0", pattern: /\bupper\s*bracket\s*semi\s*-?\s*final\b[\s\-#]*1\b/i },
  { key: "upperSemi1", pattern: /\bupper\s*bracket\s*semi\s*-?\s*final\b[\s\-#]*2\b/i },
  { key: "upperSemi0", pattern: /\bupper\s*bracket\s*semi\s*-?\s*final\b/i }, // no number -> slot 0
  { key: "playIn0", pattern: /\bplay[\s-]?in\b[\s\-#]*1\b/i },
  { key: "playIn1", pattern: /\bplay[\s-]?in\b[\s\-#]*2\b/i },
  { key: "playIn0", pattern: /\bplay[\s-]?in\b/i } // no number -> slot 0
];

export const parseStageForDoubleEliminationSlot = (stage: string | undefined): DoubleEliminationSlotKey | null => {
  if (!stage) return null;
  const trimmed = stage.trim();
  if (!trimmed) return null;
  const found = DOUBLE_ELIM_STAGE_PATTERNS.find(({ pattern }) => pattern.test(trimmed));
  return found ? found.key : null;
};

// One resolved box - team names, winner/score (once the tagged match is finished), and which
// real Match to jump to via "View Match". Blank teamA/teamB (both "") means no match has been
// tagged for this slot yet, rendered as TBD/TBD the same way an empty single-elimination slot is.
export interface DoubleEliminationSlotView {
  teamA: string;
  teamB: string;
  winner?: Side;
  scoreA?: number;
  scoreB?: number;
  matchId?: string;
}

const findMatchForDoubleEliminationSlot = (matches: Match[], league: string, slotKey: DoubleEliminationSlotKey): Match | undefined => {
  const candidates = matches.filter((m) => m.league === league && m.isPlayoff && parseStageForDoubleEliminationSlot(m.stage) === slotKey);
  if (candidates.length === 0) return undefined;
  // Tiebreak for the unlikely case two matches both got tagged for the same slot (e.g. a replay) -
  // most recently scheduled wins, same convention as findMatchByTeams.
  return candidates.sort((a, b) => (b.scheduledAt || "").localeCompare(a.scheduledAt || ""))[0];
};

const resolveDoubleEliminationSlot = (matches: Match[], league: string, slotKey: DoubleEliminationSlotKey): DoubleEliminationSlotView => {
  const linked = findMatchForDoubleEliminationSlot(matches, league, slotKey);
  if (!linked) return { teamA: "", teamB: "" };
  const hasWinner = !!linked.winner;
  return {
    teamA: linked.teamA,
    teamB: linked.teamB,
    winner: hasWinner ? (linked.winner!.trim().toLowerCase() === linked.teamA.trim().toLowerCase() ? "A" : "B") : undefined,
    scoreA: linked.scoreA,
    scoreB: linked.scoreB,
    matchId: linked.id
  };
};

export interface DoubleEliminationView {
  playIn: DoubleEliminationSlotView[]; // length === bracket.playInCount
  upperSemifinal: DoubleEliminationSlotView[]; // always length 2
  upperFinal: DoubleEliminationSlotView;
  lowerSemifinal: DoubleEliminationSlotView;
  lowerFinal: DoubleEliminationSlotView;
  grandFinal: DoubleEliminationSlotView;
}

export const deriveDoubleEliminationView = (bracket: DoubleEliminationBracketPreset, matches: Match[]): DoubleEliminationView => {
  const playIn: DoubleEliminationSlotView[] = [];
  if (bracket.playInCount >= 1) playIn.push(resolveDoubleEliminationSlot(matches, bracket.league, "playIn0"));
  if (bracket.playInCount >= 2) playIn.push(resolveDoubleEliminationSlot(matches, bracket.league, "playIn1"));
  return {
    playIn,
    upperSemifinal: [
      resolveDoubleEliminationSlot(matches, bracket.league, "upperSemi0"),
      resolveDoubleEliminationSlot(matches, bracket.league, "upperSemi1")
    ],
    upperFinal: resolveDoubleEliminationSlot(matches, bracket.league, "upperFinal"),
    lowerSemifinal: resolveDoubleEliminationSlot(matches, bracket.league, "lowerSemi"),
    lowerFinal: resolveDoubleEliminationSlot(matches, bracket.league, "lowerFinal"),
    grandFinal: resolveDoubleEliminationSlot(matches, bracket.league, "grandFinal")
  };
};

export const createDoubleEliminationBracket = (league: string, name: string, playInCount: 0 | 1 | 2): DoubleEliminationBracketPreset => ({
  id: `bracket_${Date.now()}`,
  league,
  name,
  type: "double",
  playInCount
});
