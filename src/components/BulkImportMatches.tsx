import React, { useState } from "react";
import { Match, LeaguePreset, RosterPlayer, MatchFormat } from "../types";
import { getLeagueTeamList, formatDateDMY } from "../utils";
import { parseBulkMatchSheet, ParsedMatchGroup } from "../bulkImportParser";
import { X, ClipboardPaste, AlertTriangle, CheckCircle2, XCircle, RefreshCw, UploadCloud } from "lucide-react";

const FORMATS: MatchFormat[] = ["Bo1", "Bo3", "Bo5", "Bo7"];

interface BulkImportMatchesProps {
  leaguePresets: LeaguePreset[];
  roster: RosterPlayer[];
  matches: Match[];
  isDarkMode: boolean;
  onSaveMatch: (match: Match) => Promise<void>;
  onClose: () => void;
}

type RowStatus = "idle" | "pending" | "success" | "error";

// Same league+teams+stage+date already sitting in the database - a strong hint this exact match
// was imported before (or entered manually already), since re-importing rows the app has already
// seen creates a duplicate Match row rather than updating the old one.
const findExistingMatch = (matches: Match[], group: ParsedMatchGroup, league: string): Match | undefined =>
  matches.find(
    (m) =>
      (m.league || "").trim().toLowerCase() === league.trim().toLowerCase() &&
      m.teamA === group.teamA &&
      m.teamB === group.teamB &&
      (m.scheduledAt || "").slice(0, 10) === group.date
  );

export const BulkImportMatches: React.FC<BulkImportMatchesProps> = ({ leaguePresets, roster, matches, isDarkMode, onSaveMatch, onClose }) => {
  const [rawText, setRawText] = useState("");
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>(() => leaguePresets[0]?.id || "");
  const [isPlayoff, setIsPlayoff] = useState(false);
  const [groups, setGroups] = useState<ParsedMatchGroup[] | null>(null);
  const [globalError, setGlobalError] = useState("");
  const [optionalColumnsMissing, setOptionalColumnsMissing] = useState<string[]>([]);
  const [included, setIncluded] = useState<boolean[]>([]);
  const [statuses, setStatuses] = useState<RowStatus[]>([]);
  const [statusErrors, setStatusErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const activeLeague = leaguePresets.find((p) => p.id === selectedLeagueId) || leaguePresets[0];

  const card = isDarkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-200";
  const inputCls = `w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
    isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"
  }`;

  const handleParse = () => {
    if (!activeLeague) return;
    const leagueRoster = roster.filter((r) => r.league.trim().toLowerCase() === activeLeague.name.trim().toLowerCase());
    const teamList = getLeagueTeamList(activeLeague);
    const result = parseBulkMatchSheet(rawText, activeLeague.defaultFormat, leagueRoster, teamList, activeLeague.teamAbbreviations);

    if (!result.ok) {
      setGlobalError(result.globalError || "Gagal parse data.");
      setGroups(null);
      return;
    }
    setGlobalError("");
    setOptionalColumnsMissing(result.optionalColumnsMissing);
    setGroups(result.groups);
    setIncluded(
      result.groups.map((g) => g.errors.length === 0 && !findExistingMatch(matches, g, activeLeague.name))
    );
    setStatuses(result.groups.map(() => "idle"));
    setStatusErrors(result.groups.map(() => ""));
  };

  const updateGroup = (idx: number, updates: Partial<ParsedMatchGroup>) => {
    setGroups((prev) => (prev ? prev.map((g, i) => (i === idx ? { ...g, ...updates } : g)) : prev));
  };

  const handleImport = async () => {
    if (!groups || !activeLeague) return;
    setIsImporting(true);
    const nextStatuses = [...statuses];
    const nextErrors = [...statusErrors];
    for (let i = 0; i < groups.length; i++) {
      if (!included[i] || groups[i].errors.length > 0) continue;
      nextStatuses[i] = "pending";
      setStatuses([...nextStatuses]);
      try {
        const g = groups[i];
        const match: Match = {
          league: activeLeague.name,
          stage: g.stage.trim(),
          format: g.format,
          teamA: g.teamA,
          teamB: g.teamB,
          scoreA: 0,
          scoreB: 0,
          scheduledAt: g.date ? new Date(g.date).toISOString() : "",
          liveLink: "",
          patch: "",
          isPlayoff,
          games: g.games
        };
        await onSaveMatch(match);
        nextStatuses[i] = "success";
      } catch (err: any) {
        nextStatuses[i] = "error";
        nextErrors[i] = err?.message || "Gagal menyimpan.";
      }
      setStatuses([...nextStatuses]);
      setStatusErrors([...nextErrors]);
    }
    setIsImporting(false);
  };

  const includedCount = included.filter(Boolean).length;
  const doneCount = statuses.filter((s) => s === "success").length;
  const failCount = statuses.filter((s) => s === "error").length;

  return (
    <div className={`w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
      <div className="p-6 space-y-6 text-xs">
        <div className="flex items-center justify-between border-b pb-4 border-slate-800">
          <h2 className={`text-lg font-bold font-display uppercase tracking-tight flex items-center gap-2 ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
            <UploadCloud className="w-5 h-5 text-blue-500" />
            Bulk Import Match dari Spreadsheet
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/20 cursor-pointer" title="Tutup">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-slate-500 leading-relaxed">
          Select range di spreadsheet stats kamu (termasuk baris judul kolom), <strong>Ctrl+C</strong>, lalu paste di kotak bawah. Satu baris = satu pemain di satu game
          (10 baris per game). Kolom dicocokkan lewat namanya, jadi kolom bantu/formula lain di sheet kamu aman diikutkan, bakal diabaikan otomatis.
        </p>

        <div className={`p-4 rounded-xl border grid grid-cols-1 md:grid-cols-2 gap-4 ${card}`}>
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">League/Competition:</label>
            <select value={selectedLeagueId} onChange={(e) => setSelectedLeagueId(e.target.value)} className={`${inputCls} cursor-pointer`}>
              {leaguePresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Playoff Match (semua match di batch ini):</label>
            <div className="flex gap-1.5">
              {[{ v: false, l: "No" }, { v: true, l: "Yes" }].map((opt) => (
                <button
                  key={String(opt.v)}
                  type="button"
                  onClick={() => setIsPlayoff(opt.v)}
                  className={`flex-1 p-2 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                    isPlayoff === opt.v ? "bg-blue-500 border-blue-400 text-slate-950" : isDarkMode ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-600"
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-mono font-bold text-slate-500 uppercase flex items-center gap-1.5">
            <ClipboardPaste className="w-3.5 h-3.5" /> Paste data di sini:
          </label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="DATE&#9;MATCH&#9;TEAM&#9;GAME&#9;RESULTS&#9;SIDE&#9;BANNED&#9;PICKED&#9;PLAYER&#9;...&#10;11/04/25&#9;W1D1M1&#9;RRQ&#9;GAME1&#9;LOSS&#9;BLUE&#9;Mayene&#9;Sun Ce&#9;Nightmare&#9;..."
            rows={8}
            className={`w-full p-3 rounded-xl text-[11px] font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 whitespace-pre ${
              isDarkMode ? "bg-slate-950 border-slate-800 text-slate-200" : "bg-white border-slate-300 text-slate-900"
            }`}
          />
          <button
            type="button"
            onClick={handleParse}
            disabled={!rawText.trim() || !activeLeague}
            className="px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold font-mono text-xs rounded-xl shadow-lg shadow-blue-500/10 transition-all cursor-pointer disabled:opacity-50"
          >
            Parse Data
          </button>
        </div>

        {globalError && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-xs font-mono flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{globalError}</span>
          </div>
        )}

        {groups && (
          <div className="space-y-4">
            {optionalColumnsMissing.length > 0 && (
              <p className="text-[10px] text-slate-500 italic">
                Kolom opsional tidak ketemu (dilewati, isi 0/kosong): {optionalColumnsMissing.join(", ")}
              </p>
            )}
            <div className="flex items-center justify-between">
              <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                {groups.length} match ketemu - {includedCount} dicentang untuk diimport
              </h3>
              {(doneCount > 0 || failCount > 0) && (
                <span className="text-[10px] font-mono text-slate-500">Berhasil: {doneCount} · Gagal: {failCount}</span>
              )}
            </div>

            <div className="space-y-3">
              {groups.map((g, idx) => {
                const existing = activeLeague ? findExistingMatch(matches, g, activeLeague.name) : undefined;
                const hasErrors = g.errors.length > 0;
                const status = statuses[idx] || "idle";
                return (
                  <div key={idx} className={`p-3 rounded-xl border ${hasErrors ? "border-red-500/30 bg-red-500/5" : isDarkMode ? "bg-slate-950/30 border-slate-900" : "bg-white border-slate-200"}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!included[idx]}
                        disabled={hasErrors}
                        onChange={(e) => setIncluded((prev) => prev.map((v, i) => (i === idx ? e.target.checked : v)))}
                        className="w-4 h-4 accent-blue-500 cursor-pointer shrink-0 disabled:opacity-40"
                      />
                      <span className="font-mono font-bold text-slate-400 shrink-0">{g.matchCode}</span>
                      <span className="text-slate-500 shrink-0">{g.date ? formatDateDMY(g.date) : "(tanggal?)"}</span>
                      <span className={`font-bold shrink-0 ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{g.teamA || "?"} vs {g.teamB || "?"}</span>
                      <span className="text-slate-500 shrink-0">{g.games.length} game</span>

                      <input
                        type="text"
                        value={g.stage}
                        onChange={(e) => updateGroup(idx, { stage: e.target.value })}
                        placeholder="Stage (mis. Week 1)"
                        className={`w-32 p-1.5 rounded-lg text-[10px] font-mono border shrink-0 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                      />
                      <select
                        value={g.format}
                        onChange={(e) => updateGroup(idx, { format: e.target.value as MatchFormat })}
                        className={`p-1.5 rounded-lg text-[10px] font-mono font-bold border cursor-pointer shrink-0 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                      >
                        {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>

                      <span className="ml-auto shrink-0">
                        {status === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                        {status === "error" && <XCircle className="w-4 h-4 text-red-400" />}
                        {status === "pending" && <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />}
                      </span>
                    </div>

                    {existing && !hasErrors && (
                      <p className="text-[10px] text-amber-500 mt-1.5">⚠ Kelihatannya match ini sudah ada di database (league/tim/tanggal sama) - dicentang otomatis dimatikan, centang manual kalau memang mau tetap diimport sebagai entry baru.</p>
                    )}
                    {g.warnings.map((w, wi) => (
                      <p key={wi} className="text-[10px] text-amber-500 mt-1">⚠ {w}</p>
                    ))}
                    {g.errors.map((er, ei) => (
                      <p key={ei} className="text-[10px] text-red-400 mt-1">✕ {er}</p>
                    ))}
                    {status === "error" && <p className="text-[10px] text-red-400 mt-1">✕ Gagal simpan: {statusErrors[idx]}</p>}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 justify-end pt-3 border-t border-slate-850">
              <button
                type="button"
                onClick={onClose}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold font-mono border cursor-pointer transition-all ${
                  isDarkMode ? "bg-slate-950 hover:bg-slate-900 text-slate-400 border-slate-800" : "bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200"
                }`}
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={isImporting || includedCount === 0}
                className="px-6 py-2.5 bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold font-mono text-xs rounded-xl shadow-lg shadow-blue-500/10 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Mengimport...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4 shrink-0" />
                    <span>Import {includedCount} Match</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
