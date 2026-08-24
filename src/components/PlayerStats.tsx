import React, { useMemo, useState } from "react";
import { Match, LeaguePreset, GamePlayerStats } from "../types";
import { formatDateDMY } from "../utils";
import { Users, Search, User, History, X, ArrowUp, ArrowDown } from "lucide-react";

interface PlayerStatsProps {
  matches: Match[];
  leaguePresets: LeaguePreset[];
  isDarkMode: boolean;
  onViewMatch?: (matchId: string) => void;
}

interface AggregatedPlayer {
  playerName: string;
  team: string;
  gamesPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  heroDamage: number;
  damageTaken: number;
  mvpCount: number;
  heroesPlayed: Set<string>;
}

// Identifies one row in the table / one selection - name alone isn't enough since two different
// registered players can share a nickname across different teams (e.g. two "Zhe"s), so team is
// always carried alongside the name rather than trusting the name string in isolation.
interface PlayerIdentity {
  name: string;
  team: string;
}

// Kills/Deaths/Assists sort by their raw totals (matching how they're named, with no "Avg" prefix
// - unlike goldEarned/heroDamage/damageTaken below, which sort by the per-game average since that's
// what their own column headers say and show). KDA sorts by the same ratio shown in the KDA column.
type SortKey = "name" | "gp" | "kda" | "kills" | "deaths" | "assists" | "avgGold" | "avgHeroDmg" | "avgDmgTaken" | "mvp" | "heroPool";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "gp", label: "Matches" },
  { key: "kda", label: "KDA" },
  { key: "kills", label: "Kills" },
  { key: "deaths", label: "Deaths" },
  { key: "assists", label: "Assists" },
  { key: "avgGold", label: "Avg Gold" },
  { key: "avgHeroDmg", label: "Avg Hero Dmg" },
  { key: "avgDmgTaken", label: "Avg Dmg Taken" },
  { key: "mvp", label: "MVPs" },
  { key: "heroPool", label: "Hero Pool" }
];

// "Name" reads more naturally A-Z by default; every numeric stat reads more naturally
// highest-first - so each key gets its own sensible default whenever the sort key itself changes
// (the user can still flip it with the direction toggle right after).
const defaultDirFor = (key: SortKey): SortDir => (key === "name" ? "asc" : "desc");

const getSortValue = (p: AggregatedPlayer, key: SortKey): number | string => {
  const gp = Math.max(p.gamesPlayed, 1);
  switch (key) {
    case "name": return p.playerName.toLowerCase();
    case "gp": return p.gamesPlayed;
    case "kda": return p.deaths > 0 ? (p.kills + p.assists) / p.deaths : p.kills + p.assists;
    case "kills": return p.kills;
    case "deaths": return p.deaths;
    case "assists": return p.assists;
    case "avgGold": return p.goldEarned / gp;
    case "avgHeroDmg": return p.heroDamage / gp;
    case "avgDmgTaken": return p.damageTaken / gp;
    case "mvp": return p.mvpCount;
    case "heroPool": return p.heroesPlayed.size;
  }
};

// One row of a selected player's per-game history panel.
interface PlayerGameEntry {
  matchId?: string;
  opponent: string;
  hero: string;
  stats: GamePlayerStats;
  won: boolean;
  stage?: string;
  scheduledAt?: string;
}

export const PlayerStats: React.FC<PlayerStatsProps> = ({ matches, leaguePresets, isDarkMode, onViewMatch }) => {
  const [selectedLeague, setSelectedLeague] = useState(() => leaguePresets[0]?.name || "");
  const [selectedStage, setSelectedStage] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerIdentity | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("gp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Right column (selected player's game history) is capped to the left column's own measured
  // height instead of growing past it - same fix pubgmdb's TournamentStandings.tsx uses, since
  // CSS Grid's row-stretch alone would otherwise stretch the shorter side to match a long history
  // list and leave a dangling gap under whichever side is actually shorter.
  const leftColumnRef = React.useRef<HTMLDivElement>(null);
  const [leftColumnHeight, setLeftColumnHeight] = useState<number | null>(null);
  React.useEffect(() => {
    const el = leftColumnRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setLeftColumnHeight(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (selectedLeague !== "ALL" && leaguePresets.length > 0 && !leaguePresets.some((p) => p.name === selectedLeague)) {
      setSelectedLeague(leaguePresets[0].name);
    }
  }, [leaguePresets, selectedLeague]);

  React.useEffect(() => {
    setSelectedPlayer(null);
  }, [selectedLeague, selectedStage]);

  // Team name -> ABBR, merged from whichever league preset(s) are in scope (every preset's own
  // map when "ALL" leagues is selected, since a team's abbreviation is configured per-league).
  // Falls back to the full name unchanged for any team with no ABBR registered.
  const teamAbbrMap = useMemo(() => {
    const map: Record<string, string> = {};
    const relevantPresets = selectedLeague === "ALL" ? leaguePresets : leaguePresets.filter((p) => p.name === selectedLeague);
    relevantPresets.forEach((p) => {
      Object.entries(p.teamAbbreviations || {}).forEach(([teamUpper, abbr]) => {
        if (abbr) map[teamUpper] = abbr;
      });
    });
    return map;
  }, [leaguePresets, selectedLeague]);
  const getTeamLabel = (team: string): string => teamAbbrMap[team.toUpperCase().trim()] || team;

  // "ALL" is also the League filter's own all-time option (career totals across every league ever
  // entered, not just the currently selected one) - Period/Stage is scoped to whatever League
  // filter is active, so it naturally spans every league's stages too once League is "ALL".
  const stages = useMemo(() => {
    const list = matches
      .filter((m) => selectedLeague === "ALL" || m.league === selectedLeague)
      .map((m) => m.stage)
      .filter(Boolean) as string[];
    return ["ALL", ...Array.from(new Set(list))];
  }, [matches, selectedLeague]);

  const relevantMatches = useMemo(
    () => matches.filter((m) => (selectedLeague === "ALL" || m.league === selectedLeague) && (selectedStage === "ALL" || m.stage === selectedStage)),
    [matches, selectedLeague, selectedStage]
  );

  const aggregated = useMemo(() => {
    // Keyed by team+name, not name alone - otherwise two different players who happen to share a
    // nickname on different teams get silently merged into one row, with the `team` column
    // showing whichever of the two teams' games happened to be processed last.
    const byPlayer: Record<string, AggregatedPlayer> = {};

    const accumulate = (p: GamePlayerStats, team: string) => {
      const name = p.playerName.trim();
      if (!name) return;
      const key = `${team}::${name}`;
      if (!byPlayer[key]) {
        byPlayer[key] = {
          playerName: name, team, gamesPlayed: 0, kills: 0, deaths: 0, assists: 0,
          goldEarned: 0, heroDamage: 0, damageTaken: 0,
          mvpCount: 0, heroesPlayed: new Set()
        };
      }
      const agg = byPlayer[key];
      agg.gamesPlayed += 1;
      agg.kills += p.kills;
      agg.deaths += p.deaths;
      agg.assists += p.assists;
      agg.goldEarned += p.goldEarned;
      agg.heroDamage += p.heroDamage;
      agg.damageTaken += p.damageTaken;
      if (p.mvp) agg.mvpCount += 1;
      if (p.hero.trim()) agg.heroesPlayed.add(p.hero.trim());
    };

    relevantMatches.forEach((m) => {
      m.games.forEach((g) => {
        g.teamAPlayers.forEach((p) => accumulate(p, m.teamA));
        g.teamBPlayers.forEach((p) => accumulate(p, m.teamB));
      });
    });

    return Object.values(byPlayer)
      .filter((p) => p.playerName.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => {
        const va = getSortValue(a, sortKey);
        const vb = getSortValue(b, sortKey);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [relevantMatches, searchTerm, sortKey, sortDir]);

  // Every individual game the selected player appeared in, most recent match first - the
  // per-game detail behind that player's aggregated row above. Matched on name AND team side, so
  // a same-named player on the opposing team never leaks into this list.
  const playerHistory = useMemo((): PlayerGameEntry[] => {
    if (!selectedPlayer) return [];
    const entries: (PlayerGameEntry & { scheduledAt: string })[] = [];
    relevantMatches.forEach((m) => {
      const isTeamA = m.teamA === selectedPlayer.team;
      const isTeamB = m.teamB === selectedPlayer.team;
      if (!isTeamA && !isTeamB) return;
      m.games.forEach((g) => {
        const roster = isTeamA ? g.teamAPlayers : g.teamBPlayers;
        const stats = roster.find((p) => p.playerName.trim() === selectedPlayer.name);
        if (!stats) return;
        entries.push({
          matchId: m.id,
          opponent: isTeamA ? m.teamB : m.teamA,
          hero: stats.hero,
          stats,
          won: g.winner === (isTeamA ? "A" : "B"),
          stage: m.stage,
          scheduledAt: m.scheduledAt || ""
        });
      });
    });
    return entries.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  }, [relevantMatches, selectedPlayer]);

  // Shared body of the "selected player's per-game history" panel - used both by the desktop side
  // panel (lg+, see the hidden lg:block column below) and the mobile inline row that opens right
  // under whichever player row was tapped (a friend's mobile feedback: on a phone the side panel
  // used to only ever land at the very bottom of the whole table, well below the fold, since
  // grid-cols-1 just stacks it after every row instead of next to the one you actually clicked).
  const renderHistoryPanelBody = () => (
    <>
      <div className="flex items-center justify-between border-b border-slate-800/40 pb-3 mb-3 shrink-0">
        <h3 className="text-sm font-black text-blue-500 uppercase tracking-tight flex items-center gap-1.5 min-w-0 truncate">
          <History className="w-4 h-4 shrink-0" />
          {selectedPlayer ? (
            <span className="truncate">{selectedPlayer.name} <span className="text-slate-500 font-normal normal-case">({getTeamLabel(selectedPlayer.team)})</span></span>
          ) : "Game History"}
        </h3>
        {selectedPlayer && (
          <button
            type="button"
            onClick={() => setSelectedPlayer(null)}
            className={`p-1 rounded-lg cursor-pointer shrink-0 ${isDarkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {!selectedPlayer ? (
        <div className="text-center py-16 text-slate-500 flex flex-col items-center justify-center space-y-3 flex-1">
          <div className={`p-3 rounded-full border ${isDarkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-200"}`}>
            <User className="w-6 h-6 text-slate-600" />
          </div>
          <span className="text-[10px] max-w-[200px] leading-relaxed uppercase">
            Click a player in the table to view their per-game history
          </span>
        </div>
      ) : playerHistory.length === 0 ? (
        <p className="text-center text-slate-500 py-6">No games found for {selectedPlayer.name}.</p>
      ) : (
        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
          {playerHistory.map((h, idx) => (
            <div
              key={`${h.matchId}-${idx}`}
              onClick={() => onViewMatch && h.matchId && onViewMatch(h.matchId)}
              title={onViewMatch && h.matchId ? "Open this match in Match Results" : undefined}
              className={`p-3 rounded-xl border transition-all ${onViewMatch && h.matchId ? "cursor-pointer hover:opacity-80" : ""} ${
                h.won
                  ? isDarkMode ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200"
                  : isDarkMode ? "bg-red-500/10 border-red-500/20" : "bg-red-50 border-red-200"
              }`}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${h.won ? "bg-emerald-500 text-slate-950" : "bg-red-500 text-slate-950"}`}>
                  {h.won ? "Win" : "Loss"}
                </span>
                <strong className={`truncate ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{h.hero || "-"}</strong>
                <span className="text-slate-500 truncate">vs {getTeamLabel(h.opponent)}</span>
                {h.stats.mvp && <span className="px-1.5 py-0.5 rounded bg-blue-500 text-slate-950 font-black text-[8px] tracking-wide uppercase">MVP</span>}
              </div>
              <div className="text-[9px] text-slate-500 mt-1">
                {h.stage ? `${h.stage} • ` : ""}{formatDateDMY((h.scheduledAt || "").slice(0, 10))}
              </div>

              <div className={`grid grid-cols-3 gap-1.5 mt-2.5 pt-2.5 border-t text-center ${isDarkMode ? "border-slate-900" : "border-slate-200"}`}>
                <div>
                  <span className="text-[8px] text-slate-500 uppercase block">K/D/A</span>
                  <strong className="text-blue-500 text-[11px]">{h.stats.kills}/{h.stats.deaths}/{h.stats.assists}</strong>
                </div>
                <div>
                  <span className="text-[8px] text-slate-500 uppercase block">Gold</span>
                  <strong className={`text-[11px] ${isDarkMode ? "text-slate-200" : "text-slate-800"}`}>{h.stats.goldEarned.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="text-[8px] text-slate-500 uppercase block">Hero Dmg</span>
                  <strong className={`text-[11px] ${isDarkMode ? "text-slate-200" : "text-slate-800"}`}>{h.stats.heroDamage.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="text-[8px] text-slate-500 uppercase block">Dmg Taken</span>
                  <strong className={`text-[11px] ${isDarkMode ? "text-slate-200" : "text-slate-800"}`}>{h.stats.damageTaken.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="text-[8px] text-slate-500 uppercase block">Position</span>
                  <strong className={`text-[11px] ${isDarkMode ? "text-slate-200" : "text-slate-800"}`}>{h.stats.position}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-4 font-mono text-xs animate-fadeIn">
      <div className={`p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 transition-all ${
        isDarkMode ? "bg-slate-900/50" : "bg-white border border-slate-200 shadow-sm"
      }`}>
        <h2 className={`text-sm font-extrabold uppercase tracking-tight flex items-center gap-2 ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
          <Users className="w-4 h-4 text-blue-500" />
          Player Stats
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[10px] font-bold uppercase">League:</span>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              className={`p-2 rounded-lg border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-900"}`}
            >
              <option value="ALL">ALL-TIME (ALL LEAGUES)</option>
              {leaguePresets.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[10px] font-bold uppercase">Period:</span>
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className={`p-2 rounded-lg border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-900"}`}
            >
              {stages.map((s) => <option key={s} value={s}>{s === "ALL" ? "Total" : s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[10px] font-bold uppercase">Sort:</span>
            <select
              value={sortKey}
              onChange={(e) => {
                const key = e.target.value as SortKey;
                setSortKey(key);
                setSortDir(defaultDirFor(key));
              }}
              className={`p-2 rounded-lg border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-900"}`}
            >
              {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={sortDir === "asc" ? "Ascending - click to sort descending" : "Descending - click to sort ascending"}
              className={`p-2 rounded-lg border cursor-pointer transition-all ${isDarkMode ? "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-900" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-100"}`}
            >
              {sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search player..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`pl-8 pr-3 py-2 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-300 text-slate-900"}`}
            />
          </div>
        </div>
      </div>

      {aggregated.length === 0 ? (
        <div className={`text-center py-12 border border-dashed rounded-2xl text-slate-500 ${isDarkMode ? "border-slate-850 bg-slate-950/20" : "border-slate-200"}`}>
          No player stats found for this selection.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 columns: aggregated table */}
          <div ref={leftColumnRef} className="lg:col-span-2">
            <div className={`overflow-x-auto rounded-xl border ${isDarkMode ? "border-slate-800/40 bg-slate-950/10" : "border-slate-200 bg-white"}`}>
              <table className="w-full text-left font-mono border-collapse">
                <thead>
                  <tr className={`text-[10px] uppercase tracking-wider font-bold border-b ${
                    isDarkMode ? "bg-slate-950 text-slate-400 border-slate-800" : "bg-slate-100 text-slate-600 border-slate-200"
                  }`}>
                    <th className="py-3 px-3 text-center w-12">#</th>
                    <th className="py-3 px-3 text-left">Player</th>
                    <th className="py-3 px-3 text-left">Team</th>
                    <th className="py-3 px-3 text-center">GP</th>
                    <th className="py-3 px-3 text-center">KDA</th>
                    <th className="py-3 px-3 text-center">Avg Gold</th>
                    <th className="py-3 px-3 text-center">Avg Hero Dmg</th>
                    <th className="py-3 px-3 text-center">Avg Dmg Taken</th>
                    <th className="py-3 px-3 text-center">MVPs</th>
                    <th className="py-3 px-3 text-center">Hero Pool</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? "divide-slate-850/30" : "divide-slate-100"}`}>
                  {aggregated.map((p, idx) => {
                    const rank = idx + 1;
                    const gp = Math.max(p.gamesPlayed, 1);
                    const kda = p.deaths > 0 ? ((p.kills + p.assists) / p.deaths).toFixed(2) : (p.kills + p.assists).toFixed(2);
                    const isSelected = selectedPlayer?.name === p.playerName && selectedPlayer?.team === p.team;
                    return (
                    <React.Fragment key={`${p.team}::${p.playerName}`}>
                      <tr
                        onClick={() => setSelectedPlayer(isSelected ? null : { name: p.playerName, team: p.team })}
                        title="Click to view this player's per-game history"
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? isDarkMode ? "bg-blue-500/10" : "bg-blue-500/5"
                            : isDarkMode ? "hover:bg-slate-950/60 text-slate-300" : "hover:bg-slate-50 text-slate-800"
                        }`}
                      >
                        <td className="py-3 px-3 text-center w-12">
                          <span className={`w-6 h-6 rounded-md inline-flex items-center justify-center font-extrabold text-[10px] ${
                            rank === 1
                              ? "bg-blue-500 text-slate-950"
                              : rank === 2
                                ? "bg-slate-300 text-slate-950"
                                : rank === 3
                                  ? "bg-blue-800 text-slate-100"
                                  : isDarkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                          }`}>
                            {rank}
                          </span>
                        </td>
                        <td className={`py-3 px-3 font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{p.playerName}</td>
                        <td className={`py-3 px-3 uppercase ${isDarkMode ? "text-slate-400" : "text-slate-600"}`} title={p.team}>{getTeamLabel(p.team)}</td>
                        <td className="py-3 px-3 text-center">{p.gamesPlayed}</td>
                        <td className="py-3 px-3 text-center font-bold text-blue-500">
                          {p.kills}/{p.deaths}/{p.assists}
                          <span className="text-slate-500 font-normal ml-1">({kda})</span>
                        </td>
                        <td className="py-3 px-3 text-center">{Math.round(p.goldEarned / gp).toLocaleString()}</td>
                        <td className="py-3 px-3 text-center">{Math.round(p.heroDamage / gp).toLocaleString()}</td>
                        <td className="py-3 px-3 text-center">{Math.round(p.damageTaken / gp).toLocaleString()}</td>
                        <td className="py-3 px-3 text-center font-bold text-blue-500">{p.mvpCount}</td>
                        <td className={`py-3 px-3 text-center ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{p.heroesPlayed.size}</td>
                      </tr>
                      {/* Mobile/tablet only (lg:hidden) - opens right under the row that was
                         tapped instead of only ever appearing after the entire table, which on a
                         phone could be well below the fold for anyone past the first couple rows. */}
                      {isSelected && (
                        <tr className="lg:hidden">
                          <td colSpan={10} className="p-0">
                            <div className={`p-4 flex flex-col ${isDarkMode ? "bg-slate-950/40 border-y border-slate-900" : "bg-slate-50 border-y border-slate-200"}`}>
                              {renderHistoryPanelBody()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right column: selected player's per-game history, height-capped to the table on the
              left (see leftColumnHeight above) with its own internal scroll so a long history
              never pushes the page down. Hidden below lg - that breakpoint gets the inline mobile
              row inside the table instead (see isSelected above), so this doesn't also duplicate
              it at the bottom of the page. */}
          <div className="space-y-6 hidden lg:block">
            <div
              style={leftColumnHeight ? { maxHeight: `${leftColumnHeight}px` } : undefined}
              className={`p-5 rounded-2xl border flex flex-col ${leftColumnHeight ? "" : "h-full"} ${
                isDarkMode ? "bg-slate-900/40 border-slate-900" : "bg-white border-slate-200 shadow-sm"
              }`}
            >
              {renderHistoryPanelBody()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
