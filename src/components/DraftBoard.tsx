import React from "react";
import { Game, GamePlayerStats, GameObjectives, LANE_POSITIONS, OBJECTIVE_TYPES, OBJECTIVE_LABELS, RosterPlayer, Side } from "../types";
import { HOK_HEROES } from "../heroes";
import { AlertTriangle, Ban, Star, Droplet, Swords } from "lucide-react";

interface DraftBoardProps {
  game: Game;
  onChange: (updated: Game) => void;
  teamA: string;
  teamB: string;
  // Heroes this side has already picked earlier in the match (soft/per-team fearless rule) -
  // used to show a warning, never to block the input.
  usedHeroesA: string[];
  usedHeroesB: string[];
  rosterA: RosterPlayer[];
  rosterB: RosterPlayer[];
  // True for game 7 of a Bo7 - HOK's "Ultimate Battle" decider, which drops both the per-team
  // ban phase and the fearless-reuse rule (a hero banned/picked earlier in the series is fair
  // game again). usedHeroesA/usedHeroesB are expected to already be passed in empty by the
  // caller when this is true - this prop only controls what's drawn here (hiding the ban row).
  isUltimateBattle?: boolean;
  isDarkMode: boolean;
}

const emptyPlayerStats = (position: typeof LANE_POSITIONS[number]): GamePlayerStats => ({
  playerName: "",
  position,
  hero: "",
  kills: 0,
  deaths: 0,
  assists: 0,
  goldEarned: 0,
  heroDamage: 0,
  damageTaken: 0,
  mvp: false,
  firstBlood: false,
  singleKills: 0,
  doubleKills: 0,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0
});

const emptyObjectives = (): GameObjectives => ({
  tyrant: 0, shadowTyrant: 0, tempest: 0, overlord: 0, shadowOverlord: 0, towers: 0
});

// Left-to-right column order for the stat grid below - drives both header rendering and where a
// pasted spreadsheet block lands (see handlePasteGrid). Lane isn't here since it's fixed by the
// row itself (LANE_POSITIONS), not a free-typed/pasteable value. Ordered to mirror a typical
// manual tracking spreadsheet's own column order (Hero/Picked, Player, First Blood, MVP/POM, then
// the raw K/D/A/Gold/Damage/Taken numbers, then multi-kill counts) so a copied block from one
// lines up with as few separate paste actions as possible - see the paste-range note near the
// bottom of this file for exactly which spreadsheet columns map to which paste target here.
const STAT_COLUMNS: { key: keyof GamePlayerStats; label: string; type: "text" | "number" | "boolean" }[] = [
  { key: "hero", label: "Hero", type: "text" },
  { key: "playerName", label: "Player", type: "text" },
  { key: "firstBlood", label: "FB", type: "boolean" },
  { key: "mvp", label: "MVP", type: "boolean" },
  { key: "kills", label: "K", type: "number" },
  { key: "deaths", label: "D", type: "number" },
  { key: "assists", label: "A", type: "number" },
  { key: "goldEarned", label: "Gold", type: "number" },
  { key: "heroDamage", label: "Hero Dmg", type: "number" },
  { key: "damageTaken", label: "Dmg Taken", type: "number" },
  { key: "singleKills", label: "1K", type: "number" },
  { key: "doubleKills", label: "2K", type: "number" },
  { key: "tripleKills", label: "3K", type: "number" },
  { key: "quadraKills", label: "4K", type: "number" },
  { key: "pentaKills", label: "5K", type: "number" }
];

// How a pasted cell's raw text becomes a boolean (firstBlood/mvp) - covers Google Sheets/Excel's
// own checkbox-cell export ("TRUE"/"FALSE") plus a few common manual conventions.
const parseBooleanCell = (raw: string): boolean => {
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y" || v === "✓";
};

export const createEmptyGame = (gameNumber: number): Game => ({
  gameNumber,
  winner: null,
  bansA: [],
  bansB: [],
  teamAPlayers: LANE_POSITIONS.map(emptyPlayerStats),
  teamBPlayers: LANE_POSITIONS.map(emptyPlayerStats),
  duration: "",
  objectivesA: emptyObjectives(),
  objectivesB: emptyObjectives()
});

const inputCls = (isDarkMode: boolean, extra = "") =>
  `rounded-md p-1.5 text-[11px] focus:outline-none border focus:ring-1 focus:ring-blue-500 ${
    isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-slate-50 border-slate-200 text-slate-900"
  } ${extra}`;

export const DraftBoard: React.FC<DraftBoardProps> = ({
  game,
  onChange,
  teamA,
  teamB,
  usedHeroesA,
  usedHeroesB,
  rosterA,
  rosterB,
  isUltimateBattle,
  isDarkMode
}) => {
  const setBans = (side: "A" | "B", idx: number, value: string) => {
    const key = side === "A" ? "bansA" : "bansB";
    const bans = [...(game[key] || [])];
    while (bans.length <= idx) bans.push("");
    bans[idx] = value;
    onChange({ ...game, [key]: bans });
  };

  const setPlayerField = (side: "A" | "B", idx: number, field: keyof GamePlayerStats, value: any) => {
    const key = side === "A" ? "teamAPlayers" : "teamBPlayers";
    const players = [...game[key]];
    players[idx] = { ...players[idx], [field]: value };
    onChange({ ...game, [key]: players });
  };

  // mvp and firstBlood are each "at most one player across all 10 in this game" - clicking a
  // checkbox clears the field on every other player in both teamAPlayers/teamBPlayers before
  // (possibly) setting it on the clicked one, so it behaves like a single radio group spanning
  // both tables instead of 10 independent checkboxes.
  const toggleExclusiveFlag = (side: "A" | "B", idx: number, field: "mvp" | "firstBlood") => {
    const current = !!(side === "A" ? game.teamAPlayers : game.teamBPlayers)[idx][field];
    const newValue = !current;
    const teamAPlayers = game.teamAPlayers.map((p, i) => ({ ...p, [field]: newValue && side === "A" && i === idx }));
    const teamBPlayers = game.teamBPlayers.map((p, i) => ({ ...p, [field]: newValue && side === "B" && i === idx }));
    onChange({ ...game, teamAPlayers, teamBPlayers });
  };

  const setBlueSide = (side: Side) => {
    onChange({ ...game, blueSide: game.blueSide === side ? undefined : side });
  };

  const setDuration = (value: string) => {
    onChange({ ...game, duration: value });
  };

  const setObjective = (side: "A" | "B", type: (typeof OBJECTIVE_TYPES)[number], value: number) => {
    const key = side === "A" ? "objectivesA" : "objectivesB";
    onChange({ ...game, [key]: { ...(game[key] || emptyObjectives()), [type]: value } });
  };

  // Pastes a block copied from a spreadsheet (Excel/Google Sheets) directly into the stat grid,
  // starting at whichever cell it was pasted into - tab-separated columns, newline-separated
  // rows, same clipboard shape any spreadsheet produces. Rows are fixed at 5 (one per lane, see
  // LANE_POSITIONS) - a paste taller than what's left in this side's table just clips at the last
  // row instead of adding new ones. A single-cell paste is left alone so the browser's own default
  // paste behavior still works for a plain one-off edit.
  const handlePasteGrid = (e: React.ClipboardEvent, side: "A" | "B", startRowIdx: number, startColKey: keyof GamePlayerStats, roster: RosterPlayer[] = []) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;

    const rows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
    const grid = rows.map((r) => r.split("\t"));
    if (grid.length === 1 && grid[0].length === 1) return;

    e.preventDefault();

    const startColIdx = STAT_COLUMNS.findIndex((c) => c.key === startColKey);
    if (startColIdx === -1) return;

    const key = side === "A" ? "teamAPlayers" : "teamBPlayers";
    const players = [...game[key]];

    grid.forEach((rowCells, rOffset) => {
      const targetRowIdx = startRowIdx + rOffset;
      if (targetRowIdx >= players.length) return;
      const targetPlayer = { ...players[targetRowIdx] };
      rowCells.forEach((rawValue, cOffset) => {
        const targetColIdx = startColIdx + cOffset;
        if (targetColIdx >= STAT_COLUMNS.length) return;
        const col = STAT_COLUMNS[targetColIdx];
        const value = rawValue.trim();
        if (col.key === "playerName") {
          // Same case-insensitive snap-to-roster as the input's own onBlur - a pasted block
          // rarely blurs each individual cell, so this is the only chance to normalize casing
          // before it's saved (otherwise "izziboii" pasted in would fragment this player's stats
          // away from every "Izziboii" typed by hand elsewhere).
          const match = roster.find((r) => r.name.trim().toLowerCase() === value.toLowerCase());
          (targetPlayer as any)[col.key] = match ? match.name.trim() : value;
        } else {
          (targetPlayer as any)[col.key] = col.type === "number" ? Number(value) || 0 : col.type === "boolean" ? parseBooleanCell(value) : value;
        }
      });
      players[targetRowIdx] = targetPlayer;
    });

    onChange({ ...game, [key]: players });
  };

  // Same idea as handlePasteGrid but for the single-row Objectives strip - a horizontal paste of
  // up to 6 cells (Tyrant/Shadow Tyrant/Tempest/Overlord/Shadow Overlord/Towers, in that order)
  // lands starting at whichever objective cell it was pasted into. Only the first row of a
  // multi-row paste is used (there's only ever one row of objectives per side per game).
  const handlePasteObjectives = (e: React.ClipboardEvent, side: "A" | "B", startType: (typeof OBJECTIVE_TYPES)[number]) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const firstRow = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")[0];
    const cells = firstRow.split("\t");
    if (cells.length === 1) return;
    e.preventDefault();

    const startIdx = OBJECTIVE_TYPES.indexOf(startType);
    const key = side === "A" ? "objectivesA" : "objectivesB";
    const objectives = { ...(game[key] || emptyObjectives()) };
    cells.forEach((rawValue, offset) => {
      const type = OBJECTIVE_TYPES[startIdx + offset];
      if (!type) return;
      objectives[type] = Number(rawValue.trim()) || 0;
    });
    onChange({ ...game, [key]: objectives });
  };

  // Vertical paste for the 4 Ban cells - a spreadsheet ban column copied straight down lands
  // starting at whichever Ban cell it was pasted into. A true single-cell paste (no newline) is
  // left alone so the browser's own default paste still works for a plain one-off edit, same as
  // handlePasteGrid's own single-cell escape hatch above.
  const handlePasteBans = (e: React.ClipboardEvent, side: "A" | "B", startIdx: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const rows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
    if (rows.length === 1) return;
    e.preventDefault();

    const key = side === "A" ? "bansA" : "bansB";
    const bans = [...(game[key] || [])];
    while (bans.length < 4) bans.push("");
    rows.forEach((rawValue, offset) => {
      const targetIdx = startIdx + offset;
      if (targetIdx >= 4) return;
      // Each pasted row might itself be tab-separated if it came from a wider copied block -
      // only the first cell of each row is used, since there's just one ban column per side.
      bans[targetIdx] = rawValue.split("\t")[0].trim();
    });
    onChange({ ...game, [key]: bans });
  };

  const heroListId = `hok-heroes-${game.gameNumber}`;

  const renderBansRow = (side: "A" | "B", teamName: string) => {
    const bans = game[side === "A" ? "bansA" : "bansB"];
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold uppercase shrink-0 flex items-center gap-1 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
          <Ban className="w-3 h-3" /> {teamName} bans:
        </span>
        {[0, 1, 2, 3].map((idx) => (
          <input
            key={idx}
            type="text"
            list={heroListId}
            value={bans[idx] || ""}
            onChange={(e) => setBans(side, idx, e.target.value)}
            onPaste={(e) => handlePasteBans(e, side, idx)}
            placeholder={`Ban ${idx + 1}`}
            className={inputCls(isDarkMode, "w-24")}
          />
        ))}
      </div>
    );
  };

  const renderObjectivesRow = (side: "A" | "B", teamName: string) => {
    const objectives = game[side === "A" ? "objectivesA" : "objectivesB"] || emptyObjectives();
    return (
      <div className={`p-2.5 rounded-xl border flex items-center gap-2 flex-wrap ${isDarkMode ? "border-slate-900 bg-slate-950/20" : "border-slate-200 bg-slate-50"}`}>
        <span className={`text-[10px] font-bold uppercase shrink-0 flex items-center gap-1 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
          <Swords className="w-3 h-3" /> {teamName}:
        </span>
        {OBJECTIVE_TYPES.map((type) => (
          <div key={type} className="flex items-center gap-1">
            <span className="text-[9px] text-slate-500 whitespace-nowrap">{OBJECTIVE_LABELS[type]}</span>
            <input
              type="number"
              min={0}
              value={objectives[type] || 0}
              onChange={(e) => setObjective(side, type, Number(e.target.value) || 0)}
              onPaste={(e) => handlePasteObjectives(e, side, type)}
              className={inputCls(isDarkMode, "w-10 text-center")}
            />
          </div>
        ))}
      </div>
    );
  };

  const renderPlayerTable = (side: "A" | "B", teamName: string, roster: RosterPlayer[], usedHeroes: string[]) => {
    const players = side === "A" ? game.teamAPlayers : game.teamBPlayers;
    const totalGold = players.reduce((sum, p) => sum + (p.goldEarned || 0), 0);
    const totalKills = players.reduce((sum, p) => sum + (p.kills || 0), 0);
    return (
      <div className={`border rounded-xl overflow-x-auto ${isDarkMode ? "border-slate-900" : "border-slate-200"}`}>
        <div className={`px-3 py-1.5 flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? "bg-slate-950/60 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
          <span className="flex items-center gap-1.5">
            {teamName}
            {game.blueSide === side && <span className="px-1.5 py-0.5 rounded bg-blue-500 text-slate-950 text-[8px]">BLUE</span>}
            {game.blueSide && game.blueSide !== side && <span className="px-1.5 py-0.5 rounded bg-red-500 text-slate-950 text-[8px]">RED</span>}
          </span>
          <span className="text-blue-500 normal-case">Total Gold: {totalGold.toLocaleString()}</span>
        </div>
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className={`text-[9px] uppercase tracking-wide font-bold ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
              <th className="px-2 py-1 text-left">Lane</th>
              {STAT_COLUMNS.slice(0, 10).map((col) => (
                <th key={col.key} className={col.type !== "text" ? "px-1 py-1" : "px-2 py-1 text-left"}>{col.label}</th>
              ))}
              <th className="px-1 py-1" title="Kill Participation - (Kills + Assists) / Team Total Kills, computed automatically">KP</th>
              {STAT_COLUMNS.slice(10).map((col) => (
                <th key={col.key} className="px-1 py-1">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p, idx) => {
              const usedByThisTeam = p.hero.trim() && usedHeroes.includes(p.hero.trim());
              return (
                <tr key={p.position} className={isDarkMode ? "border-t border-slate-900/60" : "border-t border-slate-100"}>
                  <td className="px-2 py-1 whitespace-nowrap text-slate-500">{p.position}</td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        list={heroListId}
                        value={p.hero}
                        onChange={(e) => setPlayerField(side, idx, "hero", e.target.value)}
                        onPaste={(e) => handlePasteGrid(e, side, idx, "hero")}
                        className={inputCls(isDarkMode, "w-24")}
                      />
                      {usedByThisTeam && (
                        <span title={`${teamName} already picked this hero earlier in the match`}>
                          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        list={`roster-${side}-${game.gameNumber}`}
                        value={p.playerName}
                        onChange={(e) => setPlayerField(side, idx, "playerName", e.target.value)}
                        onPaste={(e) => handlePasteGrid(e, side, idx, "playerName", roster)}
                        onBlur={(e) => {
                          // Case doesn't matter while typing ("izziboii" is fine as long as
                          // they're really on this team's roster) - but once done, snap it to the
                          // roster's own exact casing, so this player's stats always accumulate
                          // under one single spelling instead of splitting across "Izziboii" and
                          // "izziboii" as if they were two different people.
                          const typed = e.target.value.trim();
                          if (!typed) return;
                          const match = roster.find((r) => r.name.trim().toLowerCase() === typed.toLowerCase());
                          if (match && match.name.trim() !== typed) setPlayerField(side, idx, "playerName", match.name.trim());
                        }}
                        className={inputCls(isDarkMode, "w-24")}
                      />
                      {/* Roster already blocks two players sharing an exact name within the same
                         league (see RosterManager's collision guard), so a typed name that exactly
                         matches one is guaranteed to be that one real player - realName (if set)
                         disambiguates it further in the suggestion list below. What this can't catch
                         is a typo that happens to collide with a *different* real player's name; this
                         warning is the backstop for that - soft, like the fearless-draft hint above,
                         since guest/not-yet-registered players are still a valid thing to log here. */}
                      {p.playerName.trim() && roster.length > 0 && !roster.some((r) => r.name.trim().toLowerCase() === p.playerName.trim().toLowerCase()) && (
                        <span title={`"${p.playerName.trim()}" tidak ada di roster ${teamName} - cek ejaan kalau maksudnya salah satu pemain terdaftar`}>
                          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                        </span>
                      )}
                    </div>
                    <datalist id={`roster-${side}-${game.gameNumber}`}>
                      {roster.map((r) => (
                        <option key={r.id} value={r.name}>{r.realName ? `${r.name} (${r.realName})` : r.name}</option>
                      ))}
                    </datalist>
                  </td>
                  {/* Checkboxes can't natively receive a clipboard paste, so each cell itself is
                     made focusable (tabIndex) and carries the paste handler - click the cell once
                     (not the checkbox) then Ctrl+V to paste a value copied from a spreadsheet. */}
                  <td
                    tabIndex={0}
                    onPaste={(e) => handlePasteGrid(e, side, idx, "firstBlood")}
                    title="Click this cell then Ctrl+V to paste First Blood from a spreadsheet"
                    className="px-1 py-1 text-center focus:outline-none focus:ring-1 focus:ring-red-500 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={!!p.firstBlood}
                      onChange={() => toggleExclusiveFlag(side, idx, "firstBlood")}
                      title="First Blood - only one player per game"
                      className="w-3.5 h-3.5 accent-red-500 cursor-pointer"
                    />
                    {p.firstBlood && <Droplet className="w-3 h-3 fill-red-500 text-red-500 inline ml-1" />}
                  </td>
                  <td
                    tabIndex={0}
                    onPaste={(e) => handlePasteGrid(e, side, idx, "mvp")}
                    title="Click this cell then Ctrl+V to paste MVP from a spreadsheet"
                    className="px-1 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={!!p.mvp}
                      onChange={() => toggleExclusiveFlag(side, idx, "mvp")}
                      title="MVP - only one player per game"
                      className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                    />
                    {p.mvp && <Star className="w-3 h-3 fill-blue-500 text-blue-500 inline ml-1" />}
                  </td>
                  {(["kills", "deaths", "assists"] as const).map((f) => (
                    <td key={f} className="px-1 py-1">
                      <input
                        type="number"
                        value={p[f]}
                        onChange={(e) => setPlayerField(side, idx, f, Number(e.target.value) || 0)}
                        onPaste={(e) => handlePasteGrid(e, side, idx, f)}
                        className={inputCls(isDarkMode, "w-10 text-center")}
                      />
                    </td>
                  ))}
                  {(["goldEarned", "heroDamage", "damageTaken"] as const).map((f) => (
                    <td key={f} className="px-1 py-1">
                      <input
                        type="number"
                        value={p[f]}
                        onChange={(e) => setPlayerField(side, idx, f, Number(e.target.value) || 0)}
                        onPaste={(e) => handlePasteGrid(e, side, idx, f)}
                        className={inputCls(isDarkMode, "w-16 text-center")}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1 text-center text-slate-500">
                    {totalKills > 0 ? `${Math.round(((p.kills + p.assists) / totalKills) * 100)}%` : "-"}
                  </td>
                  {(["singleKills", "doubleKills", "tripleKills", "quadraKills", "pentaKills"] as const).map((f) => (
                    <td key={f} className="px-1 py-1">
                      <input
                        type="number"
                        value={p[f] || 0}
                        onChange={(e) => setPlayerField(side, idx, f, Number(e.target.value) || 0)}
                        onPaste={(e) => handlePasteGrid(e, side, idx, f)}
                        className={inputCls(isDarkMode, "w-9 text-center")}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <datalist id={heroListId}>
        {HOK_HEROES.map((h) => <option key={h} value={h} />)}
      </datalist>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className={`text-xs font-bold uppercase flex items-center gap-2 ${isDarkMode ? "text-slate-200" : "text-slate-800"}`}>
          Game {game.gameNumber}
          {isUltimateBattle && (
            <span
              title="Game 7 di Bo7 - no bans, fearless draft gak berlaku (hero boleh diulang)"
              className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[9px] font-black tracking-wide normal-case"
            >
              Ultimate Battle
            </span>
          )}
        </h4>
        <div className="flex flex-wrap items-center gap-3 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 uppercase font-bold">Duration:</span>
            <input
              type="text"
              value={game.duration || ""}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="MM:SS"
              className={inputCls(isDarkMode, "w-16 text-center")}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 uppercase font-bold">Blue Side:</span>
            {(["A", "B"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setBlueSide(side)}
                title="Klik lagi untuk membatalkan"
                className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all ${
                  game.blueSide === side
                    ? "bg-blue-500 border-blue-400 text-slate-950"
                    : isDarkMode ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-600"
                }`}
              >
                {side === "A" ? teamA : teamB}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 uppercase font-bold">Winner:</span>
            {(["A", "B"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => onChange({ ...game, winner: side })}
                className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all ${
                  game.winner === side
                    ? "bg-blue-500 border-blue-400 text-slate-950"
                    : isDarkMode ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-600"
                }`}
              >
                {side === "A" ? teamA : teamB}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!isUltimateBattle && (
        <>
          {renderBansRow("A", teamA)}
          {renderBansRow("B", teamB)}
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {renderObjectivesRow("A", teamA)}
        {renderObjectivesRow("B", teamB)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {renderPlayerTable("A", teamA, rosterA, usedHeroesA)}
        {renderPlayerTable("B", teamB, rosterB, usedHeroesB)}
      </div>
    </div>
  );
};
