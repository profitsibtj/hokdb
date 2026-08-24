import React, { useMemo, useState } from "react";
import { Match, LeaguePreset } from "../types";
import { calculateStandings, formatDateDMY } from "../utils";
import { Trophy, Network, History, X } from "lucide-react";
import { Bracket } from "./Bracket";

interface StandingsProps {
  matches: Match[];
  leaguePresets: LeaguePreset[];
  onUpdateLeaguePresets: (updated: LeaguePreset[]) => void;
  isDarkMode: boolean;
  actionPasswordVerified: boolean;
  // Jumps to a specific match in Match Results - wired through to a team-history entry's click
  // here, and to Bracket's own "View Match" link when this component is showing the Bracket tab.
  onViewMatch?: (matchId: string) => void;
}

export const Standings: React.FC<StandingsProps> = ({
  matches,
  leaguePresets,
  onUpdateLeaguePresets,
  isDarkMode,
  actionPasswordVerified,
  onViewMatch
}) => {
  const [viewMode, setViewMode] = useState<"standings" | "bracket">("standings");
  const [selectedLeague, setSelectedLeague] = useState(() => leaguePresets[0]?.name || "");
  const [selectedStage, setSelectedStage] = useState("ALL");
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  // Right column (selected team's match history) is capped to the left column's own measured
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
    if (leaguePresets.length > 0 && !leaguePresets.some((p) => p.name === selectedLeague)) {
      setSelectedLeague(leaguePresets[0].name);
    }
  }, [leaguePresets, selectedLeague]);

  // A previously-selected team's history panel doesn't carry over correctly once the league,
  // stage, or the view itself changes - drop it rather than show a stale team under a filter it
  // no longer matches.
  React.useEffect(() => {
    setSelectedTeam(null);
  }, [selectedLeague, selectedStage, viewMode]);

  // Playoff-tagged stages are left out - calculateStandings already excludes those matches
  // entirely, so offering them as a filter here would just be a dead option that always empties
  // the table.
  const stages = useMemo(() => {
    const list = matches.filter((m) => m.league === selectedLeague && !m.isPlayoff).map((m) => m.stage).filter(Boolean) as string[];
    return ["ALL", ...Array.from(new Set(list))];
  }, [matches, selectedLeague]);

  const standings = useMemo(
    () => calculateStandings(matches, selectedLeague, selectedStage === "ALL" ? undefined : selectedStage),
    [matches, selectedLeague, selectedStage]
  );

  const teamHistory = useMemo(() => {
    if (!selectedTeam) return [];
    return matches
      .filter((m) =>
        m.league === selectedLeague && m.isFinished &&
        (selectedStage === "ALL" || m.stage === selectedStage) &&
        (m.teamA === selectedTeam || m.teamB === selectedTeam)
      )
      .sort((a, b) => (b.scheduledAt || "").localeCompare(a.scheduledAt || ""));
  }, [matches, selectedLeague, selectedStage, selectedTeam]);

  return (
    <div className="space-y-4 font-mono text-xs animate-fadeIn">
      <div className={`p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 transition-all ${
        isDarkMode ? "bg-slate-900/50" : "bg-white border border-slate-200 shadow-sm"
      }`}>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className={`text-sm font-extrabold uppercase tracking-tight flex items-center gap-2 ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
            <Trophy className="w-4 h-4 text-blue-500" />
            Regular Season
          </h2>
          <div className="flex items-center gap-1 border border-slate-800/20 p-1 rounded-xl bg-slate-950/20">
            <button
              type="button"
              onClick={() => setViewMode("standings")}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === "standings" ? "bg-blue-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Trophy className="w-3 h-3" /> Standings
            </button>
            <button
              type="button"
              onClick={() => setViewMode("bracket")}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === "bracket" ? "bg-blue-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Network className="w-3 h-3" /> Bracket
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[10px] font-bold uppercase">League:</span>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              className={`p-2 rounded-lg border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-900"}`}
            >
              {leaguePresets.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          {/* Stage doesn't apply to a bracket (it's its own standalone structure, not stage-tagged
              like a Match is) - hidden rather than shown-but-ignored while Bracket is active. */}
          {viewMode === "standings" && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 text-[10px] font-bold uppercase">Stage:</span>
              <select
                value={selectedStage}
                onChange={(e) => setSelectedStage(e.target.value)}
                className={`p-2 rounded-lg border font-bold cursor-pointer ${isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-900"}`}
              >
                {stages.map((s) => <option key={s} value={s}>{s === "ALL" ? "ALL STAGES" : s}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {viewMode === "bracket" ? (
        <Bracket
          league={selectedLeague}
          matches={matches}
          leaguePresets={leaguePresets}
          onUpdateLeaguePresets={onUpdateLeaguePresets}
          isDarkMode={isDarkMode}
          actionPasswordVerified={actionPasswordVerified}
          onViewMatch={onViewMatch}
        />
      ) : standings.length === 0 ? (
        <div className={`text-center py-12 border border-dashed rounded-2xl text-slate-500 ${isDarkMode ? "border-slate-850 bg-slate-950/20" : "border-slate-200"}`}>
          No finished matches yet for {selectedLeague}.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 columns: standings table */}
          <div ref={leftColumnRef} className="lg:col-span-2">
          <div className={`overflow-x-auto rounded-xl border ${isDarkMode ? "border-slate-800/40 bg-slate-950/10" : "border-slate-200 bg-white"}`}>
            <table className="w-full text-left font-mono border-collapse">
              <thead>
                <tr className={`text-[10px] uppercase tracking-wider font-bold border-b ${
                  isDarkMode ? "bg-slate-950 text-slate-400 border-slate-800" : "bg-slate-100 text-slate-600 border-slate-200"
                }`}>
                  <th className="py-3 px-3 text-center w-12">#</th>
                  <th className="py-3 px-4 text-left">Team</th>
                  <th className="py-3 px-4 text-center">Match W-L</th>
                  <th className="py-3 px-4 text-center">Game W-L</th>
                  <th className="py-3 px-4 text-center">Game Diff</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? "divide-slate-850/30" : "divide-slate-100"}`}>
                {standings.map((s, idx) => {
                  const rank = idx + 1;
                  const isSelected = selectedTeam === s.team;
                  return (
                    <tr
                      key={s.team}
                      onClick={() => setSelectedTeam(isSelected ? null : s.team)}
                      title="Click to view this team's match history"
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
                      <td className={`py-3 px-4 font-bold uppercase tracking-tight ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{s.team}</td>
                      <td className="py-3 px-4 text-center font-bold text-blue-500">{s.matchesWon}-{s.matchesLost}</td>
                      <td className={`py-3 px-4 text-center ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{s.gamesWon}-{s.gamesLost}</td>
                      <td className="py-3 px-4 text-center font-bold">
                        <span className={s.gamesWon - s.gamesLost >= 0 ? "text-emerald-500" : "text-red-500"}>
                          {s.gamesWon - s.gamesLost > 0 ? "+" : ""}{s.gamesWon - s.gamesLost}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>

          {/* Right column: selected team's match history, height-capped to the table on the left
              (see leftColumnHeight above) with its own internal scroll so a long history never
              pushes the page down. */}
          <div className="space-y-6">
            <div
              style={leftColumnHeight ? { maxHeight: `${leftColumnHeight}px` } : undefined}
              className={`p-5 rounded-2xl border flex flex-col ${leftColumnHeight ? "" : "h-full"} ${
                isDarkMode ? "bg-slate-900/40 border-slate-900" : "bg-white border-slate-200 shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-800/40 pb-3 mb-3 shrink-0">
                <h3 className="text-sm font-black text-blue-500 uppercase tracking-tight flex items-center gap-1.5 min-w-0 truncate">
                  <History className="w-4 h-4 shrink-0" /> {selectedTeam ? `${selectedTeam} - Match History` : "Match History"}
                </h3>
                {selectedTeam && (
                  <button
                    type="button"
                    onClick={() => setSelectedTeam(null)}
                    className={`p-1 rounded-lg cursor-pointer shrink-0 ${isDarkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {!selectedTeam ? (
                <div className="text-center py-16 text-slate-500 flex flex-col items-center justify-center space-y-3 flex-1">
                  <div className={`p-3 rounded-full border ${isDarkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-200"}`}>
                    <Trophy className="w-6 h-6 text-slate-600" />
                  </div>
                  <span className="text-[10px] max-w-[200px] leading-relaxed uppercase">
                    Click a team in the standings table to view its match history
                  </span>
                </div>
              ) : teamHistory.length === 0 ? (
                <p className="text-center text-slate-500 py-6">
                  No finished matches found for {selectedTeam}{selectedStage !== "ALL" ? ` in ${selectedStage}` : ""}.
                </p>
              ) : (
                <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
                  {teamHistory.map((m) => {
                    const isTeamA = m.teamA === selectedTeam;
                    const opponent = isTeamA ? m.teamB : m.teamA;
                    const teamScore = isTeamA ? m.scoreA : m.scoreB;
                    const oppScore = isTeamA ? m.scoreB : m.scoreA;
                    const won = m.winner === selectedTeam;
                    return (
                      <div
                        key={m.id}
                        onClick={() => onViewMatch && m.id && onViewMatch(m.id)}
                        title={onViewMatch ? "Open this match in Match Results" : undefined}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${onViewMatch ? "cursor-pointer hover:opacity-80" : ""} ${
                          won
                            ? isDarkMode ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200"
                            : isDarkMode ? "bg-red-500/10 border-red-500/20" : "bg-red-50 border-red-200"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                              won ? "bg-emerald-500 text-slate-950" : "bg-red-500 text-slate-950"
                            }`}>
                              {won ? "Win" : "Loss"}
                            </span>
                            <strong className={`truncate ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>vs {opponent}</strong>
                          </div>
                          <div className="text-[9px] text-slate-500 mt-1">
                            {m.stage ? `${m.stage} • ` : ""}{m.format} • {formatDateDMY((m.scheduledAt || "").slice(0, 10))}
                          </div>
                        </div>
                        <div className={`text-sm font-black shrink-0 ${won ? "text-emerald-500" : "text-red-500"}`}>
                          {teamScore}-{oppScore}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
