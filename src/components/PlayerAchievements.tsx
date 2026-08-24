import React, { useState, useMemo } from "react";
import { Match } from "../types";
import { LeaguePreset } from "../types";
import { formatDateDMY } from "../utils";
import { Medal, Gamepad2, Swords, Handshake, Crown } from "lucide-react";

interface PlayerAchievementsProps {
  matches: Match[];
  leaguePresets: LeaguePreset[];
  isDarkMode: boolean;
  onViewMatch?: (matchId: string) => void;
}

type StatKey = "games" | "kills" | "assists" | "wins";
type Scope = "career" | "league" | "playoffs";

// Tier ladder per stat - deliberately spaced far enough apart that a single game essentially never
// crosses two tiers of the same stat at once (kills/assists especially), so each milestone reads
// as a genuinely separate moment rather than a burst of near-duplicate entries.
const MILESTONES: Record<StatKey, number[]> = {
  games: [50, 100, 200, 300, 500, 750, 1000],
  kills: [100, 250, 500, 1000, 2000],
  assists: [100, 250, 500, 1000, 2000],
  wins: [25, 50, 100, 200, 500]
};

const STAT_LABELS: Record<StatKey, string> = { games: "Games", kills: "Kills", assists: "Assists", wins: "Wins" };
const STAT_ICONS: Record<StatKey, React.ElementType> = { games: Gamepad2, kills: Swords, assists: Handshake, wins: Crown };

interface AchievementEntry {
  key: string;
  playerName: string;
  team: string;
  league: string;
  stat: StatKey;
  value: number;
  matchId?: string;
  scheduledAt: string;
  stage?: string;
}

interface Totals { games: number; kills: number; assists: number; wins: number; }

// Walks every game in scopedMatches in the order it was actually played and builds up each
// player's running totals game by game - a milestone entry is emitted the instant a tier is
// crossed, so its date is genuinely "the match where this first became true", not just a snapshot
// of current totals. "Wins" counts individual GAME wins (same granularity as "games played"),
// not whole-series match wins - a player who wins 2 games in a Bo3 series gets +2 here.
const computeAchievements = (scopedMatches: Match[]): AchievementEntry[] => {
  const ordered = [...scopedMatches].sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""));
  const totals: Record<string, Totals> = {};
  const entries: AchievementEntry[] = [];

  ordered.forEach((m) => {
    const sortedGames = [...m.games].sort((a, b) => a.gameNumber - b.gameNumber);
    sortedGames.forEach((g) => {
      (["A", "B"] as const).forEach((side) => {
        const players = side === "A" ? g.teamAPlayers : g.teamBPlayers;
        const team = side === "A" ? m.teamA : m.teamB;
        const won = g.winner === side;
        players.forEach((p) => {
          const name = p.playerName.trim();
          if (!name) return;
          const key = `${team}::${name}`;
          if (!totals[key]) totals[key] = { games: 0, kills: 0, assists: 0, wins: 0 };
          const t = totals[key];
          const before: Totals = { ...t };
          t.games += 1;
          t.kills += p.kills;
          t.assists += p.assists;
          if (won) t.wins += 1;

          (Object.keys(MILESTONES) as StatKey[]).forEach((stat) => {
            MILESTONES[stat].forEach((tier) => {
              if (before[stat] < tier && t[stat] >= tier) {
                entries.push({
                  key: `${key}::${stat}::${tier}::${m.id}::${g.gameNumber}`,
                  playerName: name,
                  team,
                  league: m.league || "",
                  stat,
                  value: tier,
                  matchId: m.id,
                  scheduledAt: m.scheduledAt || "",
                  stage: m.stage
                });
              }
            });
          });
        });
      });
    });
  });

  return entries.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
};

export const PlayerAchievements: React.FC<PlayerAchievementsProps> = ({ matches, leaguePresets, isDarkMode, onViewMatch }) => {
  const [scope, setScope] = useState<Scope>("career");
  const [selectedLeague, setSelectedLeague] = useState(() => leaguePresets[0]?.name || "");

  const leagues = useMemo(() => leaguePresets.map((p) => p.name).filter(Boolean), [leaguePresets]);

  React.useEffect(() => {
    if (leagues.length > 0 && !leagues.includes(selectedLeague)) {
      setSelectedLeague(leagues[0]);
    }
  }, [leagues, selectedLeague]);

  const scopedMatches = useMemo(() => {
    if (scope === "career") return matches;
    if (scope === "league") return matches.filter((m) => m.league === selectedLeague && !m.isPlayoff);
    return matches.filter((m) => m.league === selectedLeague && m.isPlayoff);
  }, [matches, scope, selectedLeague]);

  const entries = useMemo(() => computeAchievements(scopedMatches), [scopedMatches]);

  const scopeOptions: { id: Scope; label: string }[] = [
    { id: "career", label: "Career Total" },
    { id: "league", label: "League" },
    { id: "playoffs", label: "Playoffs" }
  ];

  return (
    <div className="space-y-4 font-mono text-xs animate-fadeIn">
      <div className={`p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 transition-all ${
        isDarkMode ? "bg-slate-900/50" : "bg-white border border-slate-200 shadow-sm"
      }`}>
        <h2 className={`text-sm font-extrabold uppercase tracking-tight flex items-center gap-2 ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
          <Medal className="w-4 h-4 text-blue-500" />
          Achievement Log
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`flex items-center gap-1 border p-1 rounded-xl ${isDarkMode ? "border-slate-800/60 bg-slate-950/20" : "border-slate-200 bg-slate-50"}`}>
            {scopeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScope(opt.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer ${
                  scope === opt.id
                    ? "bg-blue-500 text-slate-950"
                    : isDarkMode ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {scope !== "career" && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 text-[10px] font-bold uppercase">League:</span>
              <select
                value={selectedLeague}
                onChange={(e) => setSelectedLeague(e.target.value)}
                className={`p-2 rounded-lg border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-900"}`}
              >
                {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? "bg-slate-900/30 border-slate-900" : "bg-white border-slate-200 shadow-sm"}`}>
        {entries.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No milestones reached yet for this scope.
          </div>
        ) : (
          <div className={`divide-y ${isDarkMode ? "divide-slate-900/60" : "divide-slate-100"}`}>
            {entries.map((e) => {
              const Icon = STAT_ICONS[e.stat];
              const isViewable = !!onViewMatch && !!e.matchId;
              return (
                <div
                  key={e.key}
                  onClick={isViewable ? () => onViewMatch!(e.matchId!) : undefined}
                  title={isViewable ? "Click to view this match" : undefined}
                  className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isViewable ? "cursor-pointer" : ""} ${
                    isDarkMode ? "hover:bg-slate-950/40" : "hover:bg-slate-50"
                  }`}
                >
                  <span className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-lg ${isDarkMode ? "bg-blue-500/10" : "bg-blue-50"}`}>
                    <Icon className="w-3.5 h-3.5 text-blue-500" />
                  </span>
                  <span className="min-w-0 truncate">
                    <span className={`font-extrabold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{e.playerName}</span>
                    <span className={`ml-1.5 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                      reached <span className="text-blue-500 font-extrabold">{e.value.toLocaleString()}</span> {STAT_LABELS[e.stat]}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-[9px] text-slate-500 whitespace-nowrap">
                    {formatDateDMY((e.scheduledAt || "").slice(0, 10))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
