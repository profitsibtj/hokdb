import React, { useMemo, useState } from "react";
import { Match, LeaguePreset, GamePlayerStats } from "../types";
import { Crown, Swords, Users } from "lucide-react";

interface HeadToHeadProps {
  matches: Match[];
  leaguePresets: LeaguePreset[];
  isDarkMode: boolean;
}

interface PlayerEntry {
  id: string;
  name: string;
  team: string;
  gamesPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  heroDamage: number;
  mvpCount: number;
  avgKDA: number;
  avgGold: number;
  avgHeroDamage: number;
}

interface TeamEntry {
  id: string;
  name: string;
  matches: number;
  matchesWon: number;
  gamesWon: number;
  gamesLost: number;
  winRate: number;
  gameWinRate: number;
}

const accumulate = (agg: Omit<PlayerEntry, "id" | "name" | "team" | "avgKDA" | "avgGold" | "avgHeroDamage">, p: GamePlayerStats) => ({
  gamesPlayed: agg.gamesPlayed + 1,
  kills: agg.kills + p.kills,
  deaths: agg.deaths + p.deaths,
  assists: agg.assists + p.assists,
  goldEarned: agg.goldEarned + p.goldEarned,
  heroDamage: agg.heroDamage + p.heroDamage,
  mvpCount: agg.mvpCount + (p.mvp ? 1 : 0)
});

export const HeadToHead: React.FC<HeadToHeadProps> = ({ matches, leaguePresets, isDarkMode }) => {
  const [compType, setCompType] = useState<"player" | "team">("player");
  const [selectedLeague, setSelectedLeague] = useState(() => leaguePresets[0]?.name || "");
  const [target1, setTarget1] = useState("");
  const [target2, setTarget2] = useState("");

  React.useEffect(() => {
    if (leaguePresets.length > 0 && !leaguePresets.some((p) => p.name === selectedLeague)) {
      setSelectedLeague(leaguePresets[0].name);
    }
  }, [leaguePresets, selectedLeague]);

  const leagueMatches = useMemo(() => matches.filter((m) => m.league === selectedLeague), [matches, selectedLeague]);

  // Every player's overall record across this league (not just games against one specific
  // opponent), so two entities can be compared even if they've never actually faced each other -
  // same data shape as Player Stats' own aggregation.
  const playersData = useMemo(() => {
    const byPlayer: Record<string, Omit<PlayerEntry, "avgKDA" | "avgGold" | "avgHeroDamage">> = {};
    leagueMatches.forEach((m) => {
      m.games.forEach((g) => {
        g.teamAPlayers.forEach((p) => {
          const key = p.playerName.trim();
          if (!key) return;
          if (!byPlayer[key]) byPlayer[key] = { id: key, name: key, team: m.teamA, gamesPlayed: 0, kills: 0, deaths: 0, assists: 0, goldEarned: 0, heroDamage: 0, mvpCount: 0 };
          byPlayer[key] = { ...byPlayer[key], team: m.teamA, ...accumulate(byPlayer[key], p) };
        });
        g.teamBPlayers.forEach((p) => {
          const key = p.playerName.trim();
          if (!key) return;
          if (!byPlayer[key]) byPlayer[key] = { id: key, name: key, team: m.teamB, gamesPlayed: 0, kills: 0, deaths: 0, assists: 0, goldEarned: 0, heroDamage: 0, mvpCount: 0 };
          byPlayer[key] = { ...byPlayer[key], team: m.teamB, ...accumulate(byPlayer[key], p) };
        });
      });
    });
    return Object.values(byPlayer).map((p) => ({
      ...p,
      avgKDA: p.deaths > 0 ? Math.round(((p.kills + p.assists) / p.deaths) * 100) / 100 : p.kills + p.assists,
      avgGold: p.gamesPlayed > 0 ? Math.round(p.goldEarned / p.gamesPlayed) : 0,
      avgHeroDamage: p.gamesPlayed > 0 ? Math.round(p.heroDamage / p.gamesPlayed) : 0
    }));
  }, [leagueMatches]);

  // Every team's overall record across this league (not just their head-to-head matchups against
  // one specific opponent).
  const teamsData = useMemo(() => {
    const byTeam: Record<string, TeamEntry> = {};
    const ensure = (name: string) => {
      if (!byTeam[name]) byTeam[name] = { id: name, name, matches: 0, matchesWon: 0, gamesWon: 0, gamesLost: 0, winRate: 0, gameWinRate: 0 };
      return byTeam[name];
    };
    leagueMatches.forEach((m) => {
      if (m.teamA) {
        const t = ensure(m.teamA);
        t.matches += 1;
        t.gamesWon += m.scoreA;
        t.gamesLost += m.scoreB;
        if (m.winner === m.teamA) t.matchesWon += 1;
      }
      if (m.teamB) {
        const t = ensure(m.teamB);
        t.matches += 1;
        t.gamesWon += m.scoreB;
        t.gamesLost += m.scoreA;
        if (m.winner === m.teamB) t.matchesWon += 1;
      }
    });
    return Object.values(byTeam).map((t) => ({
      ...t,
      winRate: t.matches > 0 ? Math.round((t.matchesWon / t.matches) * 100) : 0,
      gameWinRate: t.gamesWon + t.gamesLost > 0 ? Math.round((t.gamesWon / (t.gamesWon + t.gamesLost)) * 100) : 0
    }));
  }, [leagueMatches]);

  const activeData: (PlayerEntry | TeamEntry)[] = compType === "player" ? playersData : teamsData;

  // Reset selections when switching Player <-> Team, since the name spaces don't overlap.
  React.useEffect(() => {
    setTarget1("");
    setTarget2("");
  }, [compType]);

  // Set initial selections when data changes (e.g. switching the League filter). Resolved
  // together, not independently, so a fallback pick never lands both slots on the same entry.
  React.useEffect(() => {
    if (activeData.length < 2) return;
    const t1Valid = !!target1 && activeData.some((p) => p.id === target1);
    const t2Valid = !!target2 && activeData.some((p) => p.id === target2);
    if (t1Valid && t2Valid) return;
    if (!t1Valid && !t2Valid) {
      setTarget1(activeData[0].id);
      setTarget2(activeData[1].id);
    } else if (!t1Valid) {
      setTarget1((activeData.find((p) => p.id !== target2) || activeData[0]).id);
    } else {
      setTarget2((activeData.find((p) => p.id !== target1) || activeData[1]).id);
    }
  }, [activeData]);

  const obj1 = useMemo(() => activeData.find((p) => p.id === target1), [activeData, target1]);
  const obj2 = useMemo(() => activeData.find((p) => p.id === target2), [activeData, target2]);

  const p1 = obj1 as any;
  const p2 = obj2 as any;

  const renderBar = (label: string, val1: number, val2: number, unit: string, fmt: (v: number) => string) => (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-mono">
        <span className={`text-left flex items-center justify-start gap-1 ${val1 > val2 ? "text-blue-500 font-bold" : "text-slate-400"}`}>
          {val1 > val2 && <Crown className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
          {fmt(val1)} {unit}
        </span>
        <span className="text-slate-500 font-bold uppercase text-[10px]">{label}</span>
        <span className={`text-right flex items-center justify-end gap-1 ${val2 > val1 ? "text-teal-400 font-bold" : "text-slate-400"}`}>
          {val2 > val1 && <Crown className="w-3.5 h-3.5 text-teal-400 shrink-0" />}
          {fmt(val2)} {unit}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-slate-950 flex border border-slate-900">
        <div className="bg-blue-500 h-full border-r border-slate-950 transition-all duration-300" style={{ width: `${val1 + val2 > 0 ? (val1 / (val1 + val2)) * 100 : 50}%` }} />
        <div className="bg-teal-500 h-full transition-all duration-300" style={{ width: `${val1 + val2 > 0 ? (val2 / (val1 + val2)) * 100 : 50}%` }} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn font-mono">
      {/* SELECTION ROW */}
      <div className={`p-5 rounded-2xl flex flex-col md:flex-row gap-5 justify-between items-start md:items-center transition-all ${
        isDarkMode ? "bg-slate-900/50" : "bg-white border border-slate-200 shadow-sm"
      }`}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-black font-mono text-blue-500 tracking-tight uppercase">
            ⚔️ {compType === "player" ? "Player vs Player" : "Team vs Team"} Comparison
          </span>
          <div className="flex items-center gap-1 border border-slate-800/20 p-1 rounded-xl bg-slate-950/20">
            <button
              type="button"
              onClick={() => setCompType("player")}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer ${
                compType === "player" ? "bg-blue-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Player
            </button>
            <button
              type="button"
              onClick={() => setCompType("team")}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer ${
                compType === "team" ? "bg-blue-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Team
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto text-xs">
          <div className="flex-1 md:flex-none">
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">LEAGUE</span>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              className={`w-full p-2 rounded-xl border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-300 text-slate-700"}`}
            >
              {leaguePresets.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>

          <div className="flex-1 md:flex-none">
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">COMPETITOR 1</span>
            <select
              value={target1}
              onChange={(e) => setTarget1(e.target.value)}
              className={`w-full p-2 rounded-xl border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-blue-500" : "bg-white border-slate-300 text-blue-600"}`}
            >
              {activeData.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === target2}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="text-slate-600 font-bold shrink-0 self-end mb-2">VS</div>

          <div className="flex-1 md:flex-none">
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">COMPETITOR 2</span>
            <select
              value={target2}
              onChange={(e) => setTarget2(e.target.value)}
              className={`w-full p-2 rounded-xl border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-teal-400" : "bg-white border-slate-300 text-teal-600"}`}
            >
              {activeData.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === target1}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* DASHBOARD DETAILS */}
      {!obj1 || !obj2 ? (
        <div className={`py-16 px-6 text-center rounded-2xl flex flex-col items-center justify-center gap-2 ${
          isDarkMode ? "bg-slate-900/50 text-slate-400" : "bg-white border border-slate-200 text-slate-600"
        }`}>
          {compType === "player" ? <Users className="w-10 h-10 text-blue-500/80 mb-2 animate-pulse" /> : <Swords className="w-10 h-10 text-blue-500/80 mb-2 animate-pulse" />}
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-slate-400">Not Enough Data</p>
          <p className="max-w-md text-[11px] leading-relaxed text-slate-500 font-mono">
            At least 2 {compType === "player" ? "players" : "teams"} with recorded match data are needed to show this tactical comparison.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* SVG RADAR CHART */}
          <div className={`p-6 rounded-3xl flex flex-col items-center justify-center transition-colors ${
            isDarkMode ? "bg-slate-900/40" : "bg-white border border-slate-200 shadow-sm"
          }`}>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Tactical Radar Grid</h3>
            {(() => {
              const center = 150;
              const r = 90;
              const size = 300;

              const metrics = compType === "player"
                ? [
                    { label: "AVG KDA", val1: p1.avgKDA, val2: p2.avgKDA, max: 8.0, display: (v: number) => v.toFixed(2) },
                    { label: "AVG GOLD", val1: p1.avgGold, val2: p2.avgGold, max: 15000, display: (v: number) => Math.round(v).toLocaleString() },
                    { label: "AVG HERO DMG", val1: p1.avgHeroDamage, val2: p2.avgHeroDamage, max: 80000, display: (v: number) => Math.round(v).toLocaleString() },
                    { label: "MVPS", val1: p1.mvpCount, val2: p2.mvpCount, max: 10, display: (v: number) => `${v}x` },
                    { label: "GAMES", val1: p1.gamesPlayed, val2: p2.gamesPlayed, max: 15, display: (v: number) => `${v}x` }
                  ]
                : [
                    { label: "MATCH WIN%", val1: p1.winRate, val2: p2.winRate, max: 100, display: (v: number) => `${v}%` },
                    { label: "GAME WIN%", val1: p1.gameWinRate, val2: p2.gameWinRate, max: 100, display: (v: number) => `${v}%` },
                    { label: "MATCHES WON", val1: p1.matchesWon, val2: p2.matchesWon, max: 15, display: (v: number) => `${v}x` },
                    { label: "GAMES WON", val1: p1.gamesWon, val2: p2.gamesWon, max: 30, display: (v: number) => `${v}x` },
                    { label: "MATCHES", val1: p1.matches, val2: p2.matches, max: 15, display: (v: number) => `${v}x` }
                  ];

              const count = metrics.length;
              const getCoords = (idx: number, val: number, max: number) => {
                const angle = (idx * 2 * Math.PI) / count - Math.PI / 2;
                const pct = Math.max(0.1, Math.min(1.0, val / max));
                return { x: center + pct * r * Math.cos(angle), y: center + pct * r * Math.sin(angle) };
              };

              const bgPolygons = [0.2, 0.4, 0.6, 0.8, 1.0].map((frac) =>
                metrics.map((_, idx) => {
                  const angle = (idx * 2 * Math.PI) / count - Math.PI / 2;
                  return `${center + frac * r * Math.cos(angle)},${center + frac * r * Math.sin(angle)}`;
                }).join(" ")
              );

              const p1PointsStr = metrics.map((m, idx) => { const c = getCoords(idx, m.val1, m.max); return `${c.x},${c.y}`; }).join(" ");
              const p2PointsStr = metrics.map((m, idx) => { const c = getCoords(idx, m.val2, m.max); return `${c.x},${c.y}`; }).join(" ");

              return (
                <div className="flex flex-col items-center w-full">
                  <div className="relative w-[300px] h-[300px] flex items-center justify-center">
                    <svg width={size} height={size} className="overflow-visible">
                      {bgPolygons.map((points, idx) => (
                        <polygon key={idx} points={points} fill="none" stroke={isDarkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"} strokeWidth="1" />
                      ))}

                      {metrics.map((_, idx) => {
                        const angle = (idx * 2 * Math.PI) / count - Math.PI / 2;
                        return (
                          <line
                            key={idx}
                            x1={center} y1={center}
                            x2={center + r * Math.cos(angle)} y2={center + r * Math.sin(angle)}
                            stroke={isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}
                            strokeWidth="1.5"
                            strokeDasharray="2,2"
                          />
                        );
                      })}

                      <polygon points={p1PointsStr} fill="rgba(59, 130, 246, 0.22)" stroke="rgba(59, 130, 246, 0.9)" strokeWidth="2.5" />
                      <polygon points={p2PointsStr} fill="rgba(20, 184, 166, 0.22)" stroke="rgba(20, 184, 166, 0.9)" strokeWidth="2.5" />

                      {metrics.map((m, idx) => {
                        const angle = (idx * 2 * Math.PI) / count - Math.PI / 2;
                        const labelR = r + 24;
                        const x = center + labelR * Math.cos(angle);
                        const y = center + labelR * Math.sin(angle) + 4;
                        let textAnchor: "middle" | "start" | "end" = "middle";
                        if (Math.cos(angle) > 0.1) textAnchor = "start";
                        else if (Math.cos(angle) < -0.1) textAnchor = "end";

                        return (
                          <g key={idx} className="font-mono text-[9px] font-bold">
                            <text x={x} y={y - 6} fill={isDarkMode ? "#94a3b8" : "#475569"} textAnchor={textAnchor} className="uppercase tracking-wider font-semibold">
                              {m.label}
                            </text>
                            <text x={x} y={y + 4} textAnchor={textAnchor}>
                              <tspan fill="#3b82f6" fontWeight="extrabold">{m.display(m.val1)}</tspan>
                              <tspan fill={isDarkMode ? "#475569" : "#cbd5e1"}> / </tspan>
                              <tspan fill="#14b8a6" fontWeight="extrabold">{m.display(m.val2)}</tspan>
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  <div className="flex items-center gap-6 mt-4 text-[10px] font-bold uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-blue-500" />
                      <span className="text-blue-500">{obj1.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-teal-500" />
                      <span className="text-teal-400">{obj2.name}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* SIDE-BY-SIDE BARS + GENERAL RECORDS */}
          <div className="space-y-4">
            <div className={`p-5 rounded-3xl space-y-4 transition-all ${isDarkMode ? "bg-slate-900/40" : "bg-white border border-slate-200 shadow-sm"}`}>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center border-b border-slate-800/40 pb-2">Statistics Comparison</h3>

              {compType === "player" ? (
                <>
                  {renderBar("AVG KDA", p1.avgKDA, p2.avgKDA, "KDA", (v) => v.toFixed(2))}
                  {renderBar("AVG GOLD", p1.avgGold, p2.avgGold, "gold", (v) => Math.round(v).toLocaleString())}
                  {renderBar("AVG HERO DMG", p1.avgHeroDamage, p2.avgHeroDamage, "dmg", (v) => Math.round(v).toLocaleString())}
                  {renderBar("MVPS", p1.mvpCount, p2.mvpCount, "MVPs", (v) => `${v}`)}
                </>
              ) : (
                <>
                  {renderBar("MATCH WIN RATE", p1.winRate, p2.winRate, "%", (v) => `${v}`)}
                  {renderBar("GAME WIN RATE", p1.gameWinRate, p2.gameWinRate, "%", (v) => `${v}`)}
                  {renderBar("MATCHES WON", p1.matchesWon, p2.matchesWon, "wins", (v) => `${v}`)}
                  {renderBar("GAMES WON", p1.gamesWon, p2.gamesWon, "games", (v) => `${v}`)}
                </>
              )}
            </div>

            <div className={`p-5 rounded-3xl space-y-3 transition-colors ${isDarkMode ? "bg-slate-900/40" : "bg-white border border-slate-200 shadow-sm"}`}>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">General Records</h3>
              <div className="space-y-2 text-xs">
                {compType === "player" ? (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Games Played:</span>
                      <span className="text-slate-200 font-extrabold">{p1.gamesPlayed} vs {p2.gamesPlayed}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Total Kills:</span>
                      <span className="text-slate-200 font-extrabold">{p1.kills} vs {p2.kills}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Total Deaths:</span>
                      <span className="text-slate-200 font-extrabold">{p1.deaths} vs {p2.deaths}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Total Assists:</span>
                      <span className="text-slate-200 font-extrabold">{p1.assists} vs {p2.assists}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Total Matches:</span>
                      <span className="text-slate-200 font-extrabold">{p1.matches} vs {p2.matches}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Matches Won:</span>
                      <span className="text-slate-200 font-extrabold">{p1.matchesWon} vs {p2.matchesWon}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Games Won:</span>
                      <span className="text-slate-200 font-extrabold">{p1.gamesWon} vs {p2.gamesWon}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Games Lost:</span>
                      <span className="text-slate-200 font-extrabold">{p1.gamesLost} vs {p2.gamesLost}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
