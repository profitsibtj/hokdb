import React, { useState, useMemo } from "react";
import { LeaguePreset, BracketPreset, Match, Side } from "../types";
import {
  createBracket, createDoubleEliminationBracket, resolveBracketTeam, getBracketRoundLabel,
  findMatchByTeams, deriveBracketView, deriveDoubleEliminationView, DoubleEliminationSlotView
} from "../utils";
import { Plus, Trash2, Crown, ExternalLink } from "lucide-react";

interface BracketProps {
  // Controlled by the parent (Standings) so switching the shared League selector there also
  // switches which league's bracket shows here - there's only ever one League picker on screen.
  league: string;
  matches: Match[];
  leaguePresets: LeaguePreset[];
  onUpdateLeaguePresets: (updated: LeaguePreset[]) => void;
  isDarkMode: boolean;
  actionPasswordVerified: boolean;
  // Jumps to a bracket slot's real logged match in Match Results, when one can be found (best-
  // effort lookup by the two team names - see findMatchByTeams). Silently does nothing if no
  // matching finished match exists yet.
  onViewMatch?: (matchId: string) => void;
}

const BRACKET_SIZES = [4, 8, 16];
const PLAY_IN_OPTIONS: (0 | 1 | 2)[] = [0, 1, 2];
const BOX_WIDTH = 192; // px, matches the w-48 match box below
const CONNECTOR_WIDTH = 24; // px, matches the w-6 connector column below

// Shape both bracket types resolve down to for a single match box - see deriveBracketView (single-
// elimination) and deriveDoubleEliminationView (double-elimination) in utils.ts. Letting both
// share one box renderer means "how a match box looks" only has to be right in one place.
interface ResolvedSlot {
  teamA: string;
  teamB: string;
  winner?: Side;
  scoreA?: number;
  scoreB?: number;
  matchId?: string;
}

export const Bracket: React.FC<BracketProps> = ({ league, matches, leaguePresets, onUpdateLeaguePresets, isDarkMode, actionPasswordVerified, onViewMatch }) => {
  const selectedLeague = league;
  const activePreset = leaguePresets.find((p) => p.name === selectedLeague);
  const bracketsForLeague = useMemo(() => activePreset?.brackets || [], [activePreset]);

  const [selectedBracketId, setSelectedBracketId] = useState("");
  React.useEffect(() => {
    if (bracketsForLeague.length === 0) {
      if (selectedBracketId) setSelectedBracketId("");
      return;
    }
    if (!bracketsForLeague.some((b) => b.id === selectedBracketId)) {
      setSelectedBracketId(bracketsForLeague[0].id);
    }
  }, [bracketsForLeague, selectedBracketId]);

  const storedBracket = bracketsForLeague.find((b) => b.id === selectedBracketId) || null;
  const isDouble = storedBracket?.type === "double";

  // Nothing about a bracket's content (which teams, who won, what the score was) is ever stored
  // or edited by hand anymore - it's recomputed fresh on every render straight from the current
  // (isPlayoff-tagged) matches (see deriveBracketView / deriveDoubleEliminationView). This is what
  // makes deleting or un-tagging a match reflect immediately: there's no persisted copy left
  // behind to go stale. Only the bracket's *shape* (id/name/size, or for double-elimination just
  // its Play-In count) is actually stored, via createBracket/createDoubleEliminationBracket below.
  const activeSingleBracket = useMemo(
    () => (storedBracket && storedBracket.type !== "double" ? deriveBracketView(storedBracket, matches) : null),
    [storedBracket, matches]
  );
  const activeDoubleView = useMemo(
    () => (storedBracket && storedBracket.type === "double" ? deriveDoubleEliminationView(storedBracket, matches) : null),
    [storedBracket, matches]
  );

  const [isCreating, setIsCreating] = useState(false);
  const [newBracketType, setNewBracketType] = useState<"single" | "double">("single");
  const [newBracketName, setNewBracketName] = useState("Playoffs");
  const [newBracketSize, setNewBracketSize] = useState(8);
  const [newPlayInCount, setNewPlayInCount] = useState<0 | 1 | 2>(0);

  // The single-elimination round-label header row used to guess each column's pixel position by
  // hand (BOX_WIDTH + CONNECTOR_WIDTH math) separately from the tree's own layout, and the two
  // could drift apart - exactly the kind of thing that's easy to get subtly wrong and hard to
  // notice without a live browser (this sandbox can't run one). Measuring the ACTUAL rendered box
  // instead removes the guesswork entirely: matchIndex 0 always exists in every round (see
  // renderSubtree's recursion, which always follows the matchIndex*2 branch down to 0), so that
  // box is used as each round's position anchor - wherever it really lands is exactly where that
  // round's label goes. Double-elimination doesn't use this - it's a connected tree too (see
  // renderDoubleEliminationBracket's renderChain/renderMerge), but its round labels are simple
  // inline text prefixes ("Upper"/"Lower") on each row rather than a separate header row that has
  // to line up with columns below it, so there's nothing to keep in sync there.
  const bracketAreaRef = React.useRef<HTMLDivElement>(null);
  const roundAnchorRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const [roundLabelRects, setRoundLabelRects] = useState<{ left: number; width: number }[]>([]);

  React.useLayoutEffect(() => {
    if (!activeSingleBracket) {
      setRoundLabelRects([]);
      return;
    }
    const recompute = () => {
      setRoundLabelRects(
        activeSingleBracket.matches.map((_, round) => {
          const el = roundAnchorRefs.current[round];
          return el ? { left: el.offsetLeft, width: el.offsetWidth } : { left: 0, width: BOX_WIDTH };
        })
      );
    };
    recompute();
    // Also re-measure on resize - the tree can reflow (e.g. hitting a narrower viewport) even
    // when the bracket data itself hasn't changed.
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [activeSingleBracket]);

  // The outer Upper+Lower -> Grand Final merge is the one connector CSS's centering trick gets
  // visibly wrong: `justify-content`/`align-items: center` centers Grand Final relative to the
  // TOTAL height of the stacked Upper+Lower column, not the true midpoint between Upper Final's
  // own center and Lower Final's own center - and those two heights are never equal (Upper always
  // has at least one more row than Lower), so the naive CSS-only version pulls Grand Final and its
  // connector line noticeably toward whichever branch is taller. Confirmed by literally rendering
  // this component's exact markup in a standalone mockup and measuring it - the drift was ~30px in
  // a plausible bracket, not subtle. Measuring the two real anchor boxes (like the single-
  // elimination header fix above) and computing the true midpoint fixes it exactly.
  const doubleElimAreaRef = React.useRef<HTMLDivElement>(null);
  const upperFinalAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const lowerFinalAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const [grandFinalConnector, setGrandFinalConnector] = useState<{ lineTop: number; lineHeight: number; midpoint: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!isDouble || !activeDoubleView) {
      setGrandFinalConnector(null);
      return;
    }
    const recompute = () => {
      const container = doubleElimAreaRef.current;
      const upperEl = upperFinalAnchorRef.current;
      const lowerEl = lowerFinalAnchorRef.current;
      if (!container || !upperEl || !lowerEl) return;
      const containerRect = container.getBoundingClientRect();
      const upperFinalRect = upperEl.getBoundingClientRect();
      const upperCenter = upperFinalRect.top + upperEl.offsetHeight / 2 - containerRect.top;
      const lowerCenter = lowerEl.getBoundingClientRect().top + lowerEl.offsetHeight / 2 - containerRect.top;
      setGrandFinalConnector({ lineTop: upperCenter, lineHeight: lowerCenter - upperCenter, midpoint: (upperCenter + lowerCenter) / 2 });
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [isDouble, activeDoubleView]);

  const updateLeagueBrackets = (updater: (brackets: BracketPreset[]) => BracketPreset[]) => {
    if (!activePreset) return;
    const updatedBrackets = updater(activePreset.brackets || []);
    onUpdateLeaguePresets(leaguePresets.map((p) => (p.name === selectedLeague ? { ...p, brackets: updatedBrackets } : p)));
  };

  const handleCreateBracket = () => {
    if (!newBracketName.trim()) return;
    const bracket = newBracketType === "double"
      ? createDoubleEliminationBracket(selectedLeague, newBracketName.trim(), newPlayInCount)
      : createBracket(selectedLeague, newBracketName.trim(), newBracketSize);
    updateLeagueBrackets((brackets) => [...brackets, bracket]);
    setSelectedBracketId(bracket.id);
    setIsCreating(false);
    setNewBracketName("Playoffs");
  };

  const handleDeleteBracket = (id: string) => {
    updateLeagueBrackets((brackets) => brackets.filter((b) => b.id !== id));
  };

  // Shared match-box look for both bracket types (see ResolvedSlot above) - a single-elimination
  // slot and a double-elimination slot both boil down to the same "two team rows, maybe a winner
  // crown, maybe a score, maybe a real match to jump to" shape once resolved.
  const renderSlotBox = (slot: ResolvedSlot, anchorRef?: (el: HTMLDivElement | null) => void) => {
    const linkedMatch = slot.matchId ? { id: slot.matchId } : undefined;
    const boxIsViewClickable = !!onViewMatch && !!linkedMatch;

    const renderSide = (side: Side) => {
      const teamName = side === "A" ? slot.teamA : slot.teamB;
      const isWinner = slot.winner === side;
      const score = side === "A" ? slot.scoreA : slot.scoreB;

      return (
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 ${isWinner ? "bg-blue-500/15" : ""}`}>
          <span className={`flex-1 min-w-0 truncate text-xs font-mono font-bold ${
            isWinner ? "text-blue-500" : teamName ? (isDarkMode ? "text-slate-100" : "text-slate-900") : "text-slate-500"
          }`}>
            {teamName || "TBD"}
          </span>
          {isWinner && <Crown className="w-3 h-3 text-blue-500 shrink-0" />}
          {score !== undefined && (
            <span className={`w-6 shrink-0 text-center text-[10px] font-mono ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
              {score}
            </span>
          )}
        </div>
      );
    };

    return (
      <div
        ref={anchorRef}
        style={{ width: BOX_WIDTH }}
        onClick={() => boxIsViewClickable && onViewMatch!(linkedMatch!.id)}
        title={boxIsViewClickable ? "View this match's result" : undefined}
        className={`rounded-lg border overflow-hidden divide-y shrink-0 transition-colors ${
          boxIsViewClickable ? "cursor-pointer" : ""
        } ${
          isDarkMode
            ? `bg-slate-900/60 border-slate-800 divide-slate-800 ${boxIsViewClickable ? "hover:border-blue-800 hover:bg-slate-900" : ""}`
            : `bg-white border-slate-200 divide-slate-200 ${boxIsViewClickable ? "hover:border-blue-300 hover:bg-slate-50" : ""}`
        }`}
      >
        {renderSide("A")}
        {renderSide("B")}
        {/* Always shown once both sides are resolved, so it's clear WHY nothing happens on click
           when the footer wouldn't otherwise appear ("no match logged yet" vs a dead click). */}
        {onViewMatch && slot.teamA && slot.teamB && (
          linkedMatch ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onViewMatch(linkedMatch.id); }}
              title="Open this match in Match Results"
              className={`w-full flex items-center justify-center gap-1 py-1 text-[9px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                isDarkMode ? "text-blue-400 hover:bg-slate-800/60" : "text-blue-600 hover:bg-slate-50"
              }`}
            >
              <ExternalLink className="w-2.5 h-2.5" /> View Match
            </button>
          ) : (
            <div className={`w-full flex items-center justify-center gap-1 py-1 text-[9px] font-bold uppercase tracking-wide ${
              isDarkMode ? "text-slate-600" : "text-slate-400"
            }`}>
              No match logged yet
            </div>
          )
        )}
      </div>
    );
  };

  const renderSingleEliminationMatchBox = (round: number, matchIndex: number) => {
    if (!activeSingleBracket) return null;
    const match = activeSingleBracket.matches[round][matchIndex];
    const teamAName = resolveBracketTeam(activeSingleBracket, round, matchIndex, "A");
    const teamBName = resolveBracketTeam(activeSingleBracket, round, matchIndex, "B");
    const linkedMatch = teamAName && teamBName ? findMatchByTeams(matches, selectedLeague, teamAName, teamBName) : undefined;
    const slot: ResolvedSlot = {
      teamA: teamAName, teamB: teamBName,
      winner: match.winner, scoreA: match.scoreA, scoreB: match.scoreB,
      matchId: linkedMatch?.id
    };
    return renderSlotBox(slot, matchIndex === 0 ? (el) => { roundAnchorRefs.current[round] = el; } : undefined);
  };

  // Builds the single-elimination bracket left-to-right by recursing from the Final backward: a
  // match box's two children (the earlier-round matches that feed it) are stacked and centered via
  // flexbox, so every round lines up correctly without any manual pixel math - the browser's own
  // `justify-content: space-around` centering does the work.
  const renderSubtree = (round: number, matchIndex: number): React.ReactNode => {
    const box = renderSingleEliminationMatchBox(round, matchIndex);
    if (round === 0) return box;
    return (
      <div className="flex items-center">
        <div className="flex flex-col justify-around gap-6">
          {renderSubtree(round - 1, matchIndex * 2)}
          {renderSubtree(round - 1, matchIndex * 2 + 1)}
        </div>
        <div style={{ width: CONNECTOR_WIDTH }} className="relative self-stretch shrink-0">
          <div className={`absolute left-0 top-1/4 bottom-1/4 w-px ${isDarkMode ? "bg-slate-700" : "bg-slate-300"}`} />
          <div className={`absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 ${isDarkMode ? "bg-slate-700" : "bg-slate-300"}`} />
        </div>
        {box}
      </div>
    );
  };

  const numRounds = activeSingleBracket?.matches.length || 0;

  // Same connector-line visual language as the single-elimination tree above (renderSubtree),
  // generalized into two reusable shapes instead of being baked into one recursive round-walk:
  //   - renderChain: a straight 1-to-1 connector (box -> line -> box), for a relationship that's
  //     just "this winner moves on to exactly one place" (Play-In -> its Upper Semifinal slot,
  //     Lower Semifinal -> Lower Final).
  //   - renderMerge: the exact two-boxes-stack-plus-connector shape renderSubtree already uses,
  //     for a real 2-into-1 merge (both Upper Semifinal boxes -> Upper Final; Upper Final + Lower
  //     Final -> Grand Final).
  const renderConnectorLine = () => (
    <div style={{ width: CONNECTOR_WIDTH }} className="relative self-stretch shrink-0">
      <div className={`absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 ${isDarkMode ? "bg-slate-700" : "bg-slate-300"}`} />
    </div>
  );
  const renderChain = (left: React.ReactNode, right: React.ReactNode) => (
    <div className="flex items-center">
      {left}
      {renderConnectorLine()}
      {right}
    </div>
  );
  const renderMerge = (top: React.ReactNode, bottom: React.ReactNode, right: React.ReactNode) => (
    <div className="flex items-center">
      {/* items-end: when one branch is a Play-In chain and the other is a bare match box (or the
         Upper stack is wider than the Lower chain below), the narrower row would otherwise sit
         flush-left with dead space on its right - leaving it visually disconnected from this
         merge's connector, which always starts right after the stack's widest row. Right-aligning
         both rows keeps every row's real box flush against the connector regardless of width. */}
      <div className="flex flex-col justify-around gap-6 items-end">
        {top}
        {bottom}
      </div>
      <div style={{ width: CONNECTOR_WIDTH }} className="relative self-stretch shrink-0">
        <div className={`absolute left-0 top-1/4 bottom-1/4 w-px ${isDarkMode ? "bg-slate-700" : "bg-slate-300"}`} />
        <div className={`absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 ${isDarkMode ? "bg-slate-700" : "bg-slate-300"}`} />
      </div>
      {right}
    </div>
  );

  // Double-elimination as one connected diagram, same visual language as single-elimination -
  // except for one relationship that's genuinely not drawable the same way: Upper Bracket Final's
  // LOSER also feeds Lower Bracket Final (alongside Lower Semifinal's winner), so that box has two
  // real incoming connections from two places that are already busy being someone else's output
  // (Upper Final's box already has an outgoing line to Grand Final for its winner). A plain
  // parent/child tree can't express a box having two different downstream destinations, so that
  // one link is left undrawn - the data is still 100% correct (Lower Final's second slot always
  // shows the right team), there's just no line pointing at it.
  const renderDoubleEliminationBracket = () => {
    if (!activeDoubleView) return null;

    const upperSemiWithPlayIn = (i: 0 | 1) => {
      const semiBox = renderSlotBox(activeDoubleView.upperSemifinal[i]);
      const playInSlot = activeDoubleView.playIn[i];
      return playInSlot ? renderChain(renderSlotBox(playInSlot), semiBox) : semiBox;
    };

    const labeledRow = (label: string, content: React.ReactNode) => (
      <div className="flex items-center gap-3">
        <span className={`text-[9px] font-bold uppercase tracking-wider shrink-0 w-14 ${isDarkMode ? "text-slate-500" : "text-slate-500"}`}>{label}</span>
        {content}
      </div>
    );

    const upperTree = labeledRow("Upper", renderMerge(
      upperSemiWithPlayIn(0),
      upperSemiWithPlayIn(1),
      renderSlotBox(activeDoubleView.upperFinal, (el) => { upperFinalAnchorRef.current = el; })
    ));
    const lowerTree = labeledRow("Lower", renderChain(
      renderSlotBox(activeDoubleView.lowerSemifinal),
      renderSlotBox(activeDoubleView.lowerFinal, (el) => { lowerFinalAnchorRef.current = el; })
    ));
    const lineColor = isDarkMode ? "bg-slate-700" : "bg-slate-300";

    return (
      <div className="space-y-3">
        <div ref={doubleElimAreaRef} className="relative flex items-center">
          {/* Same items-end reasoning as renderMerge above: Upper's tree is wider than Lower's
             whenever there's a Play-In (Lower never has one), so without right-aligning, Lower
             Final would sit short of the Grand Final connector below instead of flush against it. */}
          <div className="flex flex-col justify-around gap-6 items-end">
            {upperTree}
            {lowerTree}
          </div>
          <div style={{ width: CONNECTOR_WIDTH }} className="relative self-stretch shrink-0">
            {/* Line endpoints/midpoint come from grandFinalConnector (measured off the real Upper
               Final / Lower Final boxes above) instead of a 25%/75% CSS split - see the comment
               on that state for why the CSS-only version draws this specific line in the wrong
               place once Upper and Lower are different heights, which they always are. */}
            {grandFinalConnector && (
              <>
                <div className={`absolute left-0 w-px ${lineColor}`} style={{ top: grandFinalConnector.lineTop, height: grandFinalConnector.lineHeight }} />
                <div className={`absolute left-0 right-0 h-px ${lineColor}`} style={{ top: grandFinalConnector.midpoint }} />
              </>
            )}
          </div>
          <div style={{ width: BOX_WIDTH }} className="relative shrink-0 self-stretch">
            <div style={grandFinalConnector ? { position: "absolute", top: grandFinalConnector.midpoint, transform: "translateY(-50%)", width: BOX_WIDTH } : undefined}>
              {renderSlotBox(activeDoubleView.grandFinal)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const activeBracketExists = !!(activeSingleBracket || activeDoubleView);

  return (
    <div className="space-y-4 font-mono text-xs animate-fadeIn">
      <div className={`p-4 rounded-2xl flex flex-wrap items-center justify-end gap-3 transition-all ${
        isDarkMode ? "bg-slate-900/50" : "bg-white border border-slate-200 shadow-sm"
      }`}>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Only ever one live bracket per league (auto-assembled from playoff matches), so
             there's nothing to switch between - just name it plainly instead of a dropdown with
             one permanent option. */}
          {storedBracket && (
            <span className="text-slate-500 text-[10px] font-bold uppercase">
              {storedBracket.name} ({isDouble ? "Double Elimination" : `${activeSingleBracket?.seeds.length} teams`})
            </span>
          )}
          {actionPasswordVerified && bracketsForLeague.length === 0 && (
            <button
              type="button"
              onClick={() => setIsCreating((v) => !v)}
              className="px-3 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-slate-950 text-[10px] font-bold uppercase cursor-pointer transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> New Bracket
            </button>
          )}
          {storedBracket && actionPasswordVerified && (
            <button
              type="button"
              onClick={() => handleDeleteBracket(storedBracket.id)}
              className="p-2 rounded-xl border text-red-400 border-red-900/40 bg-red-950/20 hover:bg-red-900/30 cursor-pointer transition-all"
              title="Delete this bracket"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <div className={`p-4 rounded-2xl border space-y-3 ${isDarkMode ? "bg-slate-900/50 border-slate-850" : "bg-white border-slate-200"}`}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Bracket Name:</label>
              <input
                type="text"
                value={newBracketName}
                onChange={(e) => setNewBracketName(e.target.value)}
                placeholder="Playoffs"
                className={`w-48 p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Format:</label>
              <div className="flex gap-1.5">
                {([{ v: "single" as const, l: "Single Elim" }, { v: "double" as const, l: "Double Elim" }]).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setNewBracketType(opt.v)}
                    className={`px-3 py-2 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                      newBracketType === opt.v
                        ? "bg-blue-500 border-blue-400 text-slate-950"
                        : isDarkMode ? "bg-slate-950 border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-600"
                    }`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>
            {newBracketType === "single" ? (
              <div className="space-y-1">
                <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Teams:</label>
                <div className="flex gap-1.5">
                  {BRACKET_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setNewBracketSize(size)}
                      className={`px-3 py-2 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                        newBracketSize === size
                          ? "bg-blue-500 border-blue-400 text-slate-950"
                          : isDarkMode ? "bg-slate-950 border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-600"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-[10px] font-mono font-bold text-slate-500 uppercase" title="Berapa dari 2 slot Upper Bracket Semifinal yang diisi lewat Play-In dulu (0 = langsung 4 tim seed, nggak ada Play-In)">Play-In:</label>
                <div className="flex gap-1.5">
                  {PLAY_IN_OPTIONS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setNewPlayInCount(count)}
                      className={`px-3 py-2 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                        newPlayInCount === count
                          ? "bg-blue-500 border-blue-400 text-slate-950"
                          : isDarkMode ? "bg-slate-950 border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-600"
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={handleCreateBracket}
              className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-slate-950 text-xs font-bold cursor-pointer transition-all"
            >
              Create
            </button>
          </div>
          {newBracketType === "single" && (
            <p className="text-[9px] text-slate-500 leading-relaxed">
              Slot-nya bakal keisi otomatis begitu ada match yang ditandai "Playoff Match" di form input, dengan Stage yang cocok (contoh: "Quarterfinal 1", "Quarterfinal 2", "Semifinal 1", "Final").
            </p>
          )}
        </div>
      )}

      {!activeBracketExists ? (
        <div className={`text-center py-16 border rounded-2xl text-slate-500 ${isDarkMode ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"}`}>
          No bracket set up yet for {selectedLeague || "this league"}.
          {actionPasswordVerified && " Click \"New Bracket\" above to create one."}
        </div>
      ) : isDouble ? (
        <div className={`p-5 rounded-2xl border overflow-x-auto ${isDarkMode ? "bg-slate-900/30 border-slate-900" : "bg-white border-slate-200 shadow-sm"}`}>
          {renderDoubleEliminationBracket()}
        </div>
      ) : (
        <div className={`p-5 rounded-2xl border overflow-x-auto ${isDarkMode ? "bg-slate-900/30 border-slate-900" : "bg-white border-slate-200 shadow-sm"}`}>
          <div ref={bracketAreaRef} className="relative inline-block">
            {/* Positioned from roundLabelRects (measured off each round's real anchor box, set
               above) instead of assumed width math - guaranteed to line up with the tree below
               regardless of box/connector sizing, since it's reading the tree's actual layout.
               No explicit width needed here - every label is position:absolute (out of normal
               flow), so this row's own box size doesn't affect where they actually render. */}
            <div className="relative h-5 mb-3">
              {activeSingleBracket!.matches.map((round, idx) => (
                <div
                  key={idx}
                  style={{ position: "absolute", left: roundLabelRects[idx]?.left ?? 0, width: roundLabelRects[idx]?.width ?? BOX_WIDTH, top: 0 }}
                  className={`text-center text-[10px] font-mono font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}
                >
                  {getBracketRoundLabel(round.length)}
                </div>
              ))}
            </div>
            <div className="inline-flex items-center">
              {renderSubtree(numRounds - 1, 0)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
