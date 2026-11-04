export type LanePosition = "Clash Lane" | "Jungle" | "Mid Lane" | "Farm Lane" | "Roam" | "Flex";
export type StaffRole = "Coach" | "Analyst" | "Manager";
export type MatchFormat = "Bo1" | "Bo3" | "Bo5" | "Bo7";
export type Side = "A" | "B";

export interface GamePlayerStats {
  playerName: string;
  position: LanePosition;
  hero: string;
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  heroDamage: number;
  damageTaken: number;
  mvp?: boolean;
  firstBlood?: boolean;
  singleKills?: number;
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
}

export type ObjectiveType = "tyrant" | "shadowTyrant" | "tempest" | "overlord" | "shadowOverlord" | "towers";
export type GameObjectives = Record<ObjectiveType, number>;

export interface Game {
  gameNumber: number;
  winner: Side | null;
  bansA: string[];
  bansB: string[];
  teamAPlayers: GamePlayerStats[];
  teamBPlayers: GamePlayerStats[];
  blueSide?: Side;
  duration?: string;
  objectivesA?: GameObjectives;
  objectivesB?: GameObjectives;
}

export interface Match {
  id?: string;
  league?: string;
  stage?: string;
  isPlayoff?: boolean;
  format: MatchFormat;
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
  winner?: string;
  scheduledAt?: string;
  liveLink?: string;
  patch?: string;
  isFinished?: boolean;
  games: Game[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RosterPlayer {
  id?: string;
  name: string;
  position: LanePosition | StaffRole | "Substitute";
  secondaryPosition?: LanePosition;
  team: string;
  league: string;
  previousNames?: string[];
  realName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduleEntry {
  id?: string;
  league?: string;
  matchCode: string;
  teamA?: string;
  teamB?: string;
  format?: MatchFormat;
  scheduledAt: string;
  liveLink?: string;
  isFinished?: boolean;
  createdAt?: string;
}

export interface LeaguePreset {
  id: string;
  name: string;
  defaultFormat?: MatchFormat;
  fearlessDraft: boolean;
  teamsText: string;
  teamAbbreviations?: Record<string, string>;
  teamQualifications?: Record<string, string>;
  playoffsEnabled?: boolean;
  bracketFormat?: "single-elimination" | "double-elimination";
  playInEnabled?: boolean;
  brackets?: unknown[];
}
