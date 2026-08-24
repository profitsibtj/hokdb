export type LanePosition = "Clash Lane" | "Jungle" | "Mid Lane" | "Farm Lane" | "Roam" | "Flex";
export type StaffRole = "Coach" | "Analyst" | "Manager";
export type MatchFormat = "Bo1" | "Bo3" | "Bo5" | "Bo7";
export type Side = "A" | "B";

// Exactly the 5 in-game lane slots - DraftBoard relies on this array being length 5 to build a
// game's teamAPlayers/teamBPlayers, so "Flex" (a roster-only label, not an in-game slot) is
// deliberately NOT included here. Roster's own position picker adds it in separately - see
// POSITION_OPTIONS in RosterManager.tsx.
export const LANE_POSITIONS: LanePosition[] = ["Clash Lane", "Jungle", "Mid Lane", "Farm Lane", "Roam"];
export const STAFF_ROLES: StaffRole[] = ["Coach", "Analyst", "Manager"];

export interface GamePlayerStats {
  playerName: string;
  position: LanePosition;
  hero: string; // the pick for this game - doubles as the draft record, no separate picks array needed
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  heroDamage: number;
  damageTaken: number;
  mvp?: boolean;
  // At most one player across all 10 in a game should have this true, same as mvp - enforced by
  // DraftBoard's exclusive-toggle handler (unchecking every other player when one is set), not by
  // the type itself, since the data shape has no way to express "exactly one of these 10".
  firstBlood?: boolean;
  singleKills?: number;
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
}

// HOK's jungle/epic objectives plus towers, tallied per side per game. A plain count (not a
// boolean or timeline) since a side can take the same objective more than once in one game (e.g.
// Tyrant respawns), and exact timing isn't tracked anywhere else in this data model either.
export const OBJECTIVE_TYPES = ["tyrant", "shadowTyrant", "tempest", "overlord", "shadowOverlord", "towers"] as const;
export type ObjectiveType = typeof OBJECTIVE_TYPES[number];
export const OBJECTIVE_LABELS: Record<ObjectiveType, string> = {
  tyrant: "Tyrant",
  shadowTyrant: "Shadow Tyrant",
  tempest: "Tempest",
  overlord: "Overlord",
  shadowOverlord: "Shadow Overlord",
  towers: "Towers"
};
export type GameObjectives = Record<ObjectiveType, number>;

// A single game within a Bo1/Bo3/Bo5 match. Bans are tracked per side (not tied to a player slot);
// picks live on each player's `hero` field in teamAPlayers/teamBPlayers.
export interface Game {
  gameNumber: number; // 1, 2, 3...
  winner: Side | null;
  bansA: string[]; // up to 4 hero names
  bansB: string[];
  teamAPlayers: GamePlayerStats[]; // 5 players
  teamBPlayers: GamePlayerStats[]; // 5 players
  // Which side (A or B) played Blue this game - the other side played Red. Undefined until an
  // admin picks one; sides commonly swap game-to-game within the same match, so this is tracked
  // per game, not once per match.
  blueSide?: Side;
  duration?: string; // "MM:SS" free text, not capped at 59 minutes since some games run longer
  objectivesA?: GameObjectives;
  objectivesB?: GameObjectives;
}

// One row per match (Bo1/Bo3/Bo5) between exactly 2 teams - `games` nests every game played in it,
// mirroring how pubgmdb nests Team[]/Player[] inside a single match row.
export interface Match {
  id?: string;
  league?: string;
  stage?: string; // e.g. "Week 1", "Quarterfinal 2" - parsed for period breakdown in Player Stats,
                  // and (when isPlayoff) for which Bracket slot this match auto-fills - see
                  // parseStageForBracketSlot in utils.ts
  // True for a playoff/bracket match, false or unset for a regular-season one - excluded from
  // Standings (calculateStandings) so a playoff result doesn't inflate a team's league record, and
  // used to auto-seed the Bracket (see Bracket.tsx) instead of typing team names in by hand.
  isPlayoff?: boolean;
  format: MatchFormat;
  teamA: string;
  teamB: string;
  scoreA: number; // games won by teamA, computed on save
  scoreB: number; // games won by teamB, computed on save
  winner?: string; // teamA's or teamB's name once decided
  scheduledAt?: string;
  liveLink?: string;
  patch?: string; // e.g. "S15.a" - the game client patch/version this match was played on
  isFinished?: boolean;
  games: Game[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RosterPlayer {
  id?: string;
  name: string;
  position: LanePosition | StaffRole;
  // A second lane this player can also cover, e.g. main Clash Lane who can fill in for Jungle -
  // only meaningful when `position` is one of the 5 real lanes (never Flex or a staff role).
  secondaryPosition?: LanePosition;
  team: string;
  league: string;
  // Old nicknames this player used before a rename, so stats logged under the old name still
  // get reconciled onto this player instead of showing up as a separate person.
  previousNames?: string[];
  // Disambiguates two different registered players who happen to share the same in-game
  // nickname (e.g. two "Zhe"s) - shown alongside the nickname in the roster grid. Purely a
  // display aid, not used for stats reconciliation (that's still keyed on `name`/`previousNames`).
  realName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduleEntry {
  id?: string;
  league?: string;
  matchCode: string; // e.g. "Week 1 - BOOM vs RRQ"
  teamA?: string;
  teamB?: string;
  format?: MatchFormat;
  scheduledAt: string; // ISO datetime string - when the match is set to start
  liveLink?: string;
  isFinished?: boolean; // Manually flagged by an admin once the match wraps up
  createdAt?: string;
}

// League/season configuration preset - stored as a single jsonb blob per league (see `tournaments`
// table), same pattern as pubgmdb's TournamentPreset. Shape is defined and versioned on the frontend.
export interface LeaguePreset {
  id: string;
  name: string;
  defaultFormat: MatchFormat;
  fearlessDraft: boolean; // whether the per-team "soft" fearless rule applies to this league
  teamsText: string; // newline-separated list of participating team names
  teamAbbreviations?: Record<string, string>; // team name (uppercased) -> ABBR
  // How each team reached this league (e.g. "Invited", "Open Qualifier") - purely a display tag,
  // keyed by exact team name (as it appears in teamsText). Optional/sparse: a team with no entry
  // here just shows no tag.
  teamQualifications?: Record<string, string>;
  // Playoff brackets configured for this league - a league can have more than one over time (a
  // new split/season starts a fresh bracket rather than overwriting the old one).
  brackets?: BracketPreset[];
}

// One single-elimination playoff slot. Deliberately does NOT store team names for rounds after
// the first - those are always DERIVED from earlier rounds' winners (see resolveBracketTeam in
// utils.ts) so there's exactly one source of truth and a round-2 slot can never disagree with
// what round 1 actually decided. Standalone from Match/DraftBoard on purpose: not every playoff
// game a league has ever played was necessarily logged in full match-by-match detail, so the
// bracket tracks only the outcome of each slot (and an optional score), not a link to a real
// Match record.
export interface BracketMatch {
  scoreA?: number;
  scoreB?: number;
  winner?: Side; // "A" once teamA (this slot's top side) is confirmed to have won, "B" otherwise
}

export interface SingleEliminationBracketPreset {
  id: string;
  league: string;
  name: string; // e.g. "Playoffs", "Grand Finals"
  // Absent/undefined on every bracket created before double-elimination support existed - treated
  // the same as "single" everywhere, so old stored data keeps working unchanged.
  type?: "single";
  // Round 1 team names in bracket order, length is always a power of 2 (4/8/16/...) - "" means a
  // bye/TBD slot. seeds[0] & seeds[1] feed round-1 match 0, seeds[2] & seeds[3] feed match 1, etc.
  seeds: string[];
  // matches[r][i] = round r+1's match i (0-indexed rounds: 0 is Round 1). matches[0] has
  // seeds.length/2 entries, each later round has half as many as the one before, down to 1 (the
  // Final/Grand Final).
  matches: BracketMatch[][];
}

// The fixed double-elimination shape actually used by Indonesian HOK leagues (IKL etc, see
// Bracket.tsx's research notes): a 4-team Upper Bracket (Semifinal x2 -> Final) with a matching
// Lower Bracket (Semifinal x1 -> Final, fed by Upper Bracket's losers) converging into one Grand
// Final, plus an optional Play-In stage ahead of the Upper Bracket. Deliberately NOT a general
// N-team double-elimination generator (that lower-bracket topology gets genuinely gnarly past 4
// teams) - every real one of these leagues' playoffs is exactly this 4-team shape.
//
// Unlike the single-elimination shape above, nothing here is stored at all beyond which slots
// exist (playInCount) - every slot's teams/winner/score is resolved live from whichever isPlayoff
// match has a Stage tagged for that exact slot (see parseStageForDoubleEliminationSlot in
// utils.ts), the same "derive, don't persist" approach deriveBracketView uses. There's no
// "seeds" concept to type in by hand: each slot's own real logged match already says who's in it.
export interface DoubleEliminationBracketPreset {
  id: string;
  league: string;
  name: string;
  type: "double";
  // How many Play-In matches feed into the Upper Bracket Semifinal (0 = no Play-In stage at all -
  // all 4 Upper Bracket Semifinal participants come from direct seeding).
  playInCount: 0 | 1 | 2;
}

export type BracketPreset = SingleEliminationBracketPreset | DoubleEliminationBracketPreset;
