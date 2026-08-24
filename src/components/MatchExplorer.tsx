import React, { useState, useMemo, useEffect } from "react";
import { Match, Game, GameObjectives, OBJECTIVE_TYPES, OBJECTIVE_LABELS } from "../types";
import { isoToGmt7Parts, formatDateDMY } from "../utils";
import {
  ChevronDown, ChevronUp, Search, Calendar, Trash2, Edit2, Play, RefreshCw, Star, Ban, Droplet, Swords, Clock
} from "lucide-react";
import { LANE_ICON_URLS } from "../laneIcons";

// Best multi-kill a player got this game, HOK-broadcast style (only the highest is shown, not
// every tier they hit along the way) - undefined if they didn't get at least a double kill.
const bestMultiKillLabel = (p: Game["teamAPlayers"][number]): string | null => {
  if (p.pentaKills) return `PENTA x${p.pentaKills}`;
  if (p.quadraKills) return `QUADRA x${p.quadraKills}`;
  if (p.tripleKills) return `TRIPLE x${p.tripleKills}`;
  if (p.doubleKills) return `DOUBLE x${p.doubleKills}`;
  return null;
};

// Compact "Tyrant x2 · Towers x5" summary of whichever objectives a side actually took this game
// - zero-count types are left out entirely rather than cluttering the row with "Tempest x0".
const renderObjectivesSummary = (objectives?: GameObjectives) => {
  if (!objectives) return null;
  const taken = OBJECTIVE_TYPES.filter((t) => objectives[t] > 0);
  if (taken.length === 0) return null;
  return (
    <span className="flex items-center gap-1 normal-case font-semibold text-slate-500 truncate">
      <Swords className="w-3 h-3 shrink-0" />
      {taken.map((t) => `${OBJECTIVE_LABELS[t]} x${objectives[t]}`).join(" · ")}
    </span>
  );
};

interface MatchExplorerProps {
  matches: Match[];
  isLoading: boolean;
  onDeleteMatch: (id: string) => Promise<void>;
  onEditMatch: (match: Match) => void;
  isDarkMode: boolean;
  actionPasswordVerified: boolean;
  // Set from Match Schedule when a finished entry is clicked - clears any active filters, expands
  // and scrolls to the matching match. token makes re-clicking the same match re-trigger the scroll.
  focusRequest?: { id: string; token: number } | null;
}

const renderGameCard = (game: Game, teamA: string, teamB: string, format: string, isDarkMode: boolean) => {
  const winnerName = game.winner === "A" ? teamA : game.winner === "B" ? teamB : null;
  // Same rule DraftBoard enforces while logging: game 7 of a Bo7 is HOK's "Ultimate Battle"
  // decider - no ban phase, fearless-reuse rule doesn't apply.
  const isUltimateBattle = format === "Bo7" && game.gameNumber === 7;
  const totalGoldA = game.teamAPlayers.reduce((sum, p) => sum + (p.goldEarned || 0), 0);
  const totalGoldB = game.teamBPlayers.reduce((sum, p) => sum + (p.goldEarned || 0), 0);

  // Small "label on top, value below" stat cell - shared by every numeric column in a player row
  // so Hero Dmg/Dmg Taken read as actual labeled columns instead of a cryptic "HD"/"DT" suffix
  // tacked onto a number (the reason a player asked for this: the abbreviations weren't clear).
  const statCell = (label: string, value: string, hint: string) => (
    <div className="text-right shrink-0" title={hint}>
      <div className="text-[7px] text-slate-500 uppercase tracking-wide leading-none mb-0.5">{label}</div>
      <div className="text-[10px] font-bold text-slate-300 leading-none">{value}</div>
    </div>
  );

  const renderPlayerRow = (p: Game["teamAPlayers"][number]) => (
    <div
      key={p.playerName}
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 py-2 px-3 border-b last:border-0 text-xs ${
        isDarkMode ? "border-slate-900/50" : "border-slate-100"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span title={p.position} className={`shrink-0 flex items-center justify-center w-5 h-5 rounded overflow-hidden ${isDarkMode ? "bg-slate-900" : "bg-slate-100"}`}>
          <img src={LANE_ICON_URLS[p.position]} alt={p.position} className="w-3.5 h-3.5 object-contain" />
        </span>
        <span className={`font-bold truncate ${isDarkMode ? "text-slate-200" : "text-slate-800"}`}>
          {p.playerName}
          {p.mvp && <Star className="w-3 h-3 fill-blue-500 text-blue-500 inline ml-1 align-middle" />}
          {p.firstBlood && (
            <span title="First Blood" className="inline-block align-middle ml-1">
              <Droplet className="w-3 h-3 fill-red-500 text-red-500 inline" />
            </span>
          )}
        </span>
        <span className="text-[10px] text-blue-500 font-semibold truncate">{p.hero}</span>
        {bestMultiKillLabel(p) && (
          <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[8px] font-black uppercase shrink-0">
            {bestMultiKillLabel(p)}
          </span>
        )}
      </div>
      <div className="flex items-center flex-wrap gap-3 font-mono pl-6 sm:pl-0">
        {statCell("K/D/A", `${p.kills}/${p.deaths}/${p.assists}`, "Kills / Deaths / Assists")}
        {statCell("Gold", p.goldEarned.toLocaleString(), "Total gold earned this game")}
        {statCell("Hero Dmg", p.heroDamage.toLocaleString(), "Damage dealt to enemy heroes")}
        {statCell("Dmg Taken", p.damageTaken.toLocaleString(), "Damage received from enemy heroes/turrets")}
      </div>
    </div>
  );

  return (
    <div key={game.gameNumber} className={`border rounded-xl overflow-hidden ${isDarkMode ? "bg-slate-950/20 border-slate-900" : "bg-white border-slate-200"}`}>
      <div className={`px-3 py-1.5 border-b font-mono text-[9px] font-bold uppercase tracking-wider flex items-center justify-between flex-wrap gap-1 ${isDarkMode ? "bg-slate-950/60 border-slate-900 text-slate-400" : "bg-slate-50 border-slate-200 text-slate-500"}`}>
        <span className="flex items-center gap-2">
          GAME {game.gameNumber}
          {isUltimateBattle && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[8px] font-black tracking-wide normal-case">
              Ultimate Battle
            </span>
          )}
          {game.duration && (
            <span className="flex items-center gap-1 text-slate-500 normal-case font-semibold">
              <Clock className="w-3 h-3" /> {game.duration}
            </span>
          )}
        </span>
        {winnerName && (
          <span className="text-blue-500 flex items-center gap-1">
            <Star className="w-3 h-3 fill-blue-500" /> {winnerName} WON
          </span>
        )}
      </div>
      {(() => {
        // Filtered to drop blank slots (an older match logged before bans were capped at 4 per
        // side can still have a leftover empty 5th entry) - joining those in raw would print a
        // dangling ", " with nothing after it instead of just stopping at the last real ban.
        const bansA = game.bansA.filter((b) => b.trim());
        const bansB = game.bansB.filter((b) => b.trim());
        if (bansA.length === 0 && bansB.length === 0) return null;
        const renderBanList = (bans: string[], teamName: string) => (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`flex items-center gap-1 shrink-0 font-bold ${isDarkMode ? "text-slate-500" : "text-slate-600"}`}>
              <Ban className="w-3 h-3" /> {teamName}:
            </span>
            {bans.length > 0 ? bans.map((b, i) => (
              <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${isDarkMode ? "bg-slate-900 text-slate-300 border border-slate-800" : "bg-slate-100 text-slate-700 border border-slate-200"}`}>
                {b}
              </span>
            )) : <span className="text-slate-500">-</span>}
          </div>
        );
        return (
          // Same grid-cols-1 md:grid-cols-2 split as the player tables below (not the sm breakpoint
          // this used to switch at) so each team's bans line up under its own half instead of just
          // flowing left-to-right by content width - at the old sm breakpoint the two sides could
          // sit side by side here while the tables below were still stacked single-column.
          <div className={`grid grid-cols-1 md:grid-cols-2 md:divide-x text-[10px] ${isDarkMode ? "border-b border-slate-900 divide-slate-900" : "border-b border-slate-200 divide-slate-200"}`}>
            <div className="px-3 py-2">{renderBanList(bansA, teamA)}</div>
            <div className="px-3 py-2">{renderBanList(bansB, teamB)}</div>
          </div>
        );
      })()}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-900/40">
        <div className={`divide-y ${isDarkMode ? "divide-slate-900/50" : "divide-slate-100"}`}>
          <div className="px-3 py-1 flex items-center justify-between gap-2 text-[9px] font-bold uppercase text-slate-500">
            <span className="flex items-center gap-1.5">
              {teamA}
              {game.blueSide === "A" && <span className="px-1.5 py-0.5 rounded bg-blue-500 text-slate-950 text-[8px]">BLUE</span>}
              {game.blueSide === "B" && <span className="px-1.5 py-0.5 rounded bg-red-500 text-slate-950 text-[8px]">RED</span>}
            </span>
            <span className="flex items-center gap-2 normal-case">
              {totalGoldA > 0 && <span className="text-blue-500 font-semibold">{totalGoldA.toLocaleString()}g</span>}
              {renderObjectivesSummary(game.objectivesA)}
            </span>
          </div>
          {game.teamAPlayers.map(renderPlayerRow)}
        </div>
        <div className={`divide-y ${isDarkMode ? "divide-slate-900/50" : "divide-slate-100"}`}>
          <div className="px-3 py-1 flex items-center justify-between gap-2 text-[9px] font-bold uppercase text-slate-500">
            <span className="flex items-center gap-1.5">
              {teamB}
              {game.blueSide === "B" && <span className="px-1.5 py-0.5 rounded bg-blue-500 text-slate-950 text-[8px]">BLUE</span>}
              {game.blueSide === "A" && <span className="px-1.5 py-0.5 rounded bg-red-500 text-slate-950 text-[8px]">RED</span>}
            </span>
            <span className="flex items-center gap-2 normal-case">
              {totalGoldB > 0 && <span className="text-blue-500 font-semibold">{totalGoldB.toLocaleString()}g</span>}
              {renderObjectivesSummary(game.objectivesB)}
            </span>
          </div>
          {game.teamBPlayers.map(renderPlayerRow)}
        </div>
      </div>
    </div>
  );
};

export const MatchExplorer: React.FC<MatchExplorerProps> = ({
  matches,
  isLoading,
  onDeleteMatch,
  onEditMatch,
  isDarkMode,
  actionPasswordVerified,
  focusRequest
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLeague, setSelectedLeague] = useState("ALL");
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [highlightedMatchId, setHighlightedMatchId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    setSearchTerm("");
    setSelectedLeague("ALL");
    setExpandedMatch(focusRequest.id);
    setHighlightedMatchId(focusRequest.id);
    const timer = setTimeout(() => setHighlightedMatchId(null), 2500);
    // Filters above only take effect on the next render, so the target card doesn't exist in the
    // DOM yet this tick - wait a beat before scrolling to it.
    const scrollTimer = setTimeout(() => {
      document.getElementById(`match-${focusRequest.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => { clearTimeout(timer); clearTimeout(scrollTimer); };
  }, [focusRequest]);

  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ isOpen: boolean; targetId: string }>({
    isOpen: false,
    targetId: ""
  });

  const leaguesList = useMemo(() => {
    const list = matches.map((m) => m.league).filter(Boolean) as string[];
    return ["ALL", ...Array.from(new Set(list))];
  }, [matches]);

  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      const matchesSearch =
        (m.stage || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.teamA.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.teamB.toLowerCase().includes(searchTerm.toLowerCase());
      const leagueFilter = selectedLeague === "ALL" || m.league === selectedLeague;
      return matchesSearch && leagueFilter;
    });
  }, [matches, searchTerm, selectedLeague]);

  const toggleMatch = (id: string) => {
    setExpandedMatch((prev) => (prev === id ? null : id));
  };

  const handleDeleteClick = (id: string) => {
    setDeleteConfirmModal({ isOpen: true, targetId: id });
  };

  return (
    <div className="space-y-6 font-mono text-xs animate-fadeIn">
      {/* SEARCH AND FILTERS */}
      <div className={`p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-start md:items-center justify-between transition-all ${
        isDarkMode ? "bg-slate-900/50" : "bg-white border border-slate-200 shadow-sm"
      }`}>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search Stage or Team Name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pl-10 pr-4 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-300 text-slate-900"
            }`}
          />
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full md:w-auto">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[10px] font-bold uppercase">League:</span>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              className={`p-2 rounded-lg border font-bold cursor-pointer ${
                isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-900"
              }`}
            >
              {leaguesList.map((l) => (
                <option key={l} value={l}>{l === "ALL" ? "ALL LEAGUES" : l}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* MATCHES LIST */}
      {isLoading ? (
        <div className={`flex flex-col items-center justify-center py-16 space-y-3 border rounded-2xl ${
          isDarkMode ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200 shadow-sm"
        }`}>
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-slate-500">Retrieving HOK match logs...</span>
        </div>
      ) : filteredMatches.length === 0 ? (
        <div className={`text-center py-16 border rounded-2xl text-slate-500 ${
          isDarkMode ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"
        }`}>
          No match records found.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMatches.map((m) => {
            const matchId = m.id || "";
            const isExpanded = expandedMatch === matchId;
            const isHighlighted = highlightedMatchId === matchId;
            // Wall-clock GMT+7 (WIB) parts of this match's scheduledAt - used instead of just
            // slicing the raw UTC ISO string, which would show the wrong calendar date for any
            // match scheduled late enough at night WIB to fall on the previous UTC day.
            const scheduledParts = m.scheduledAt ? isoToGmt7Parts(m.scheduledAt) : null;

            return (
              <div
                key={matchId}
                id={`match-${matchId}`}
                className={`rounded-2xl overflow-hidden shadow-sm transition-all duration-200 ${
                  isHighlighted ? "ring-2 ring-blue-500" : ""
                } ${
                  isDarkMode
                    ? isExpanded ? "bg-slate-900" : "bg-slate-900/30 hover:bg-slate-900/50"
                    : isExpanded ? "bg-slate-50 border border-slate-300" : "bg-white border border-slate-200 hover:border-slate-300 hover:shadow"
                }`}
              >
                {/* Collapsed Header Bar */}
                <div
                  onClick={() => toggleMatch(matchId)}
                  className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="bg-blue-500/10 text-blue-500 p-2.5 rounded-xl border border-blue-500/15 font-bold font-mono text-center shrink-0">
                      <Calendar className="w-4 h-4 mx-auto" />
                      <span className="text-[9px] block mt-1 whitespace-nowrap">{scheduledParts ? formatDateDMY(scheduledParts.date).slice(0, 5) : "-"}</span>
                      {scheduledParts && (
                        <span className="text-[7px] block mt-0.5 font-normal opacity-70">{scheduledParts.date.slice(0, 4)}</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <h3 className={`font-bold text-sm tracking-tight flex items-center gap-2 flex-wrap ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                        {m.teamA} vs {m.teamB}
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                          isDarkMode ? "bg-slate-950 text-blue-500 border border-slate-850" : "bg-slate-100 text-slate-700"
                        }`}>
                          {m.league || "League"}
                        </span>
                        {m.isPlayoff && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500 text-slate-950">
                            PLAYOFF
                          </span>
                        )}
                      </h3>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] text-slate-500">
                        <span>Stage: <strong>{m.stage || "-"}</strong></span>
                        <span>•</span>
                        <span>Format: <strong>{m.format}</strong></span>
                        {scheduledParts && (
                          <>
                            <span>•</span>
                            <span>Time: <strong>{scheduledParts.time}</strong></span>
                          </>
                        )}
                        {m.patch && (
                          <>
                            <span>•</span>
                            <span>Patch: <strong>{m.patch}</strong></span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Summary / Controls Column */}
                  <div className="flex items-center gap-4 shrink-0 font-mono text-xs">
                    <div className="hidden sm:flex flex-col items-end text-right">
                      <span className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Score</span>
                      <span className="text-blue-500 font-extrabold text-[13px]">
                        {m.scoreA} - {m.scoreB}
                      </span>
                    </div>

                    {m.winner && (
                      <div className="hidden sm:flex flex-col items-end text-right">
                        <span className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Winner</span>
                        <span className="text-blue-500 font-extrabold flex items-center gap-1 text-[11px] uppercase">
                          <Star className="w-3.5 h-3.5 fill-blue-500 text-blue-500" />
                          {m.winner}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      {m.liveLink && (
                        <a
                          href={m.liveLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className={`p-2 rounded-xl border transition-all flex items-center justify-center ${
                            isDarkMode
                              ? "bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20"
                              : "bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200"
                          }`}
                          title="Watch Match VOD"
                        >
                          <Play className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                        </a>
                      )}
                      {actionPasswordVerified && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onEditMatch(m); }}
                            className={`p-2 rounded-xl border transition-all ${
                              isDarkMode
                                ? "bg-slate-950 hover:bg-slate-850 text-slate-300 border-slate-800"
                                : "bg-white hover:bg-slate-100 text-slate-600 border-slate-200"
                            }`}
                            title="Edit match"
                          >
                            <Edit2 className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeleteClick(matchId); }}
                            className={`p-2 rounded-xl border transition-all ${
                              isDarkMode
                                ? "bg-red-950/20 hover:bg-red-900/30 text-red-400 border-red-900/30"
                                : "bg-red-50 hover:bg-red-100 text-red-600 border-red-200"
                            }`}
                            title="Delete match"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          </button>
                        </>
                      )}
                    </div>

                    <div className="p-1 rounded-lg">
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Details Panel */}
                {isExpanded && (
                  <div className={`p-4 sm:p-5 border-t space-y-3 ${
                    isDarkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-100/50 border-slate-200"
                  }`}>
                    <div className="flex justify-between items-center border-b pb-2 mb-2 border-slate-800">
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">GAMES ({m.games.length})</span>
                    </div>
                    <div className="space-y-3">
                      {[...m.games].sort((a, b) => a.gameNumber - b.gameNumber).map((g) => renderGameCard(g, m.teamA, m.teamB, m.format, isDarkMode))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CUSTOM DELETE CONFIRMATION MODAL */}
      {deleteConfirmModal.isOpen && (
        <div className={`fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[110] p-4 transition-colors duration-200 ${isDarkMode ? "bg-slate-950/80" : "bg-slate-900/40"}`}>
          <div className={`w-full max-w-sm border rounded-2xl shadow-2xl overflow-hidden animate-fadeIn transition-colors duration-200 ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200 text-slate-800"}`}>
            <div className="bg-red-600 p-5 text-white flex flex-col items-center">
              <div className={`p-2.5 rounded-full mb-2 ${isDarkMode ? "bg-slate-950 text-red-500" : "bg-white/40 text-red-600"}`}>
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold tracking-tight text-center uppercase">
                Confirm Match Deletion
              </h3>
              <p className="text-[9px] tracking-wider mt-0.5 opacity-90 text-center uppercase">
                This action cannot be undone!
              </p>
            </div>

            <div className="p-6 space-y-4 text-xs text-center">
              <p className={`${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                Are you sure you want to permanently delete this match record from the database?
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmModal({ isOpen: false, targetId: "" })}
                  className={`flex-1 border rounded-lg py-2 font-bold cursor-pointer transition-all text-center ${isDarkMode ? "bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border-slate-700" : "bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 border-slate-200"}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteMatch(deleteConfirmModal.targetId);
                    setDeleteConfirmModal({ isOpen: false, targetId: "" });
                  }}
                  className="flex-1 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white rounded-lg py-2 font-bold cursor-pointer transition-all flex items-center justify-center gap-1 shadow-lg shadow-red-600/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Yes, Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
