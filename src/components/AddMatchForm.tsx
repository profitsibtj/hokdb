import React, { useState, useMemo } from "react";
import { Match, ScheduleEntry, LeaguePreset, RosterPlayer, MatchFormat, Game } from "../types";
import { getTeamUsedHeroes, canonicalizeTeamName, getLeagueTeamList, getBracketStageOptions, gmt7ToIso, isoToGmt7Parts } from "../utils";
import { DraftBoard, createEmptyGame } from "./DraftBoard";
import { Plus, Trash2, X, AlertTriangle, Save, RefreshCw, CalendarClock } from "lucide-react";

const FORMATS: MatchFormat[] = ["Bo1", "Bo3", "Bo5", "Bo7"];
const REQUIRED_WINS: Record<MatchFormat, number> = { Bo1: 1, Bo3: 2, Bo5: 3, Bo7: 4 };
const MAX_GAMES: Record<MatchFormat, number> = { Bo1: 1, Bo3: 3, Bo5: 5, Bo7: 7 };
// Common ways a team can reach a league - editable per-team as a display tag in League Settings.
// Free-form, not exhaustive - a league with a different structure can still leave this blank.
const QUALIFICATION_OPTIONS = ["Invited", "Open Qualifier", "Closed Qualifier", "Group Stage", "Wildcard"];

interface AddMatchFormProps {
  onSave: (match: Match) => Promise<void>;
  onClose: () => void;
  isDarkMode: boolean;
  editingMatch?: Match | null;
  leaguePresets: LeaguePreset[];
  onUpdateLeaguePresets: (updated: LeaguePreset[]) => void;
  roster: RosterPlayer[];
  // Deep-link from Match Schedule's "Enter Match Result" so league/teams/format/date don't have
  // to be retyped after already being entered once in the schedule.
  matchPrefill?: { league?: string; teamA?: string; teamB?: string; format?: MatchFormat; date?: string } | null;
  onConsumedMatchPrefill?: () => void;
  // Lets a brand-new match be saved as a not-yet-played Schedule entry instead of a full result,
  // from this same form - one place to add a match either way.
  onSaveSchedule?: (schedule: ScheduleEntry) => Promise<void>;
  // Existing schedule entries - used only to auto-backfill a Finished one for a match saved
  // directly as a full result (see handleSubmit), so Match Schedule's "N match belum ada jadwal"
  // catch-up list never grows for anything entered from now on. Omitted (along with
  // onSaveSchedule) by the Edit Match modal instance of this form, which has no reason to do this.
  schedules?: ScheduleEntry[];
  // Deep-link from Match Schedule's "Edit" action - reopens this same not-yet-played entry here
  // (in schedule-only mode, locked) instead of Match Schedule's own separate edit screen, so
  // there's only ever one place to create or edit a scheduled match. Saving updates this same
  // entry (by id) instead of creating a duplicate.
  editingSchedule?: ScheduleEntry | null;
  // "Back" button behavior - separate from onClose (which also fires after a successful save, and
  // for this form's other host, the Edit Match modal, just closes the popup). Falls back to
  // onClose when not given, so callers that don't need the distinction can skip it.
  onCancel?: () => void;
}

const getTodayDateString = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const findPresetByLeagueName = (leaguePresets: LeaguePreset[], name?: string): LeaguePreset | undefined => {
  const trimmed = (name || "").trim().toLowerCase();
  if (!trimmed) return undefined;
  return leaguePresets.find((p) => p.name.trim().toLowerCase() === trimmed);
};

export const AddMatchForm: React.FC<AddMatchFormProps> = ({
  onSave,
  onClose,
  onCancel,
  isDarkMode,
  editingMatch,
  leaguePresets,
  onUpdateLeaguePresets,
  roster,
  matchPrefill,
  onConsumedMatchPrefill,
  onSaveSchedule,
  schedules,
  editingSchedule
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Set once a brand-new entry has been deep-linked from a Schedule's "Enter Match Result" button
  // (matchPrefill) - keeps this form in full-result mode from then on, overriding the date/time
  // auto-detection below, since that action always means "enter the real result now" regardless
  // of whether the scheduled time has technically passed yet.
  const [forceFullResultMode, setForceFullResultMode] = useState(false);

  // Tracked by ID (not name) so renaming a league in the settings panel below doesn't lose track
  // of which preset is selected - meta.league (the match's own field) is kept in sync imperatively
  // wherever this changes, rather than via a reactive effect that could clobber an in-progress edit.
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>(() => leaguePresets[0]?.id || "");
  const [showLeagueSettings, setShowLeagueSettings] = useState(false);

  const [meta, setMeta] = useState({
    league: leaguePresets[0]?.name || "",
    stage: "",
    teamA: "",
    teamB: "",
    format: "Bo3" as MatchFormat,
    date: getTodayDateString(),
    time: "",
    liveLink: "",
    patch: "",
    isPlayoff: false
  });

  // Auto-detects "hasn't happened yet" straight from the Date/Time fields instead of a separate
  // manual toggle - a match dated/timed in the future is always a schedule entry, so there's only
  // one thing to fill in instead of a field plus a checkbox that could disagree with it. No Time
  // filled in falls back to comparing Date alone, so "today" without a time defaults to a real
  // result (the common case: entering today's match after it's already been played).
  const isFutureSchedule = (): boolean => {
    if (!meta.date) return false;
    if (meta.time) {
      const dt = new Date(`${meta.date}T${meta.time}`);
      if (!Number.isNaN(dt.getTime())) return dt.getTime() > Date.now();
    }
    return meta.date > getTodayDateString();
  };

  // Deep-linking in from "Enter Match Result" (forceFullResultMode) or editing an already-saved
  // match (editingMatch) always overrides the auto-detection above; editing an existing schedule
  // entry (editingSchedule) always forces it on, regardless of what its date/time say. Starts
  // correct immediately for editingSchedule so there's no flash of the wrong form on mount.
  const [isScheduleOnly, setIsScheduleOnly] = useState(() => !!editingSchedule);

  // Applies the mode above, debounced for the plain auto-detect case: typing a Time fires onChange
  // more than once as the browser's HH/MM segments fill in, and switching which form is rendered
  // mid-keystroke unmounts the focused input, stealing/misdirecting whatever's still being typed.
  // Waiting for a short pause in typing avoids that; the forced cases below don't need to wait
  // since they're not driven by fast typing.
  React.useEffect(() => {
    if (editingMatch) {
      setIsScheduleOnly(false);
      return;
    }
    if (editingSchedule) {
      setIsScheduleOnly(true);
      return;
    }
    if (forceFullResultMode || !onSaveSchedule) {
      setIsScheduleOnly(false);
      return;
    }
    const timeout = setTimeout(() => setIsScheduleOnly(isFutureSchedule()), 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.date, meta.time, editingMatch, editingSchedule, forceFullResultMode, onSaveSchedule]);

  const [games, setGames] = useState<Game[]>([createEmptyGame(1)]);

  // Keep the selection valid if the league list changes underneath us (e.g. synced from another
  // browser tab) - does not touch meta.league, only prevents the dropdown from pointing at a
  // preset that no longer exists.
  React.useEffect(() => {
    if (leaguePresets.length > 0 && !leaguePresets.some((p) => p.id === selectedLeagueId)) {
      setSelectedLeagueId(leaguePresets[0].id);
    }
  }, [leaguePresets, selectedLeagueId]);

  const activeLeaguePreset = leaguePresets.find((p) => p.id === selectedLeagueId) || leaguePresets[0];
  const teamsForLeague = useMemo(() => getLeagueTeamList(activeLeaguePreset), [activeLeaguePreset]);

  // Valid Stage slot names for whichever bracket this league already has set up (Standings ->
  // Bracket -> "New Bracket") - lets a Playoff match be tagged by picking the exact slot from a
  // dropdown instead of free-typing text that has to match the bracket's parser exactly (a typo
  // like "Quarter Final 1" would otherwise silently fail to link, with no error shown anywhere).
  // Empty when this league has no bracket yet - the Stage field then falls back to free text.
  const playoffStageOptions = useMemo(() => {
    const bracket = activeLeaguePreset?.brackets?.[0];
    return bracket ? getBracketStageOptions(bracket) : [];
  }, [activeLeaguePreset]);

  const handleLeagueDropdownChange = (id: string) => {
    setSelectedLeagueId(id);
    const preset = leaguePresets.find((p) => p.id === id);
    // Also pulls this league's configured Default Format into the match's own Format field, so
    // switching league doesn't leave the two disagreeing (Format above stays editable per-match
    // afterward - e.g. a Grand Final that's Bo5 in an otherwise-Bo3 league).
    if (preset) setMeta((prev) => ({ ...prev, league: preset.name, format: preset.defaultFormat }));
  };

  const handleCreateLeague = () => {
    const newId = `league_${Date.now()}`;
    const newPreset: LeaguePreset = {
      id: newId,
      name: `New League ${leaguePresets.length + 1}`,
      defaultFormat: "Bo3",
      fearlessDraft: true,
      teamsText: ["Team 1", "Team 2", "Team 3", "Team 4"].join("\n")
    };
    onUpdateLeaguePresets([...leaguePresets, newPreset]);
    setSelectedLeagueId(newId);
    setMeta((prev) => ({ ...prev, league: newPreset.name, format: newPreset.defaultFormat }));
    setSuccessMsg("New league created successfully!");
    setTimeout(() => setSuccessMsg(""), 2000);
  };

  const handleDeleteLeague = () => {
    if (leaguePresets.length <= 1) {
      setErrorMsg("Failed to delete! At least 1 league must remain registered.");
      setTimeout(() => setErrorMsg(""), 3000);
      return;
    }
    const remaining = leaguePresets.filter((p) => p.id !== selectedLeagueId);
    onUpdateLeaguePresets(remaining);
    setSelectedLeagueId(remaining[0].id);
    setMeta((prev) => ({ ...prev, league: remaining[0].name, format: remaining[0].defaultFormat }));
    setSuccessMsg("League deleted successfully!");
    setTimeout(() => setSuccessMsg(""), 2000);
  };

  const updateActiveLeaguePreset = (updates: Partial<LeaguePreset>) => {
    const updated = leaguePresets.map((p) => (p.id === selectedLeagueId ? { ...p, ...updates } : p));
    onUpdateLeaguePresets(updated);
    if (updates.name !== undefined) {
      setMeta((prev) => ({ ...prev, league: updates.name! }));
    }
  };

  // One row per team (backed by the shared "league-team-list" datalist), instead of a plain
  // textarea - mirrors pubgmdb's own team-list editor UI/UX. Distinguishes "no rows yet" ([])
  // from "has rows, possibly with a blank one mid-edit" the same way pubgmdb's stage team rows
  // do: split() on a non-empty (possibly single-line) string always returns at least one entry.
  const getTeamRows = (preset?: LeaguePreset): string[] => {
    const text = preset?.teamsText;
    return !text ? [] : text.split("\n");
  };

  const handleTeamRowChange = (index: number, value: string) => {
    const rows = [...getTeamRows(activeLeaguePreset)];
    const oldName = (rows[index] || "").trim();
    const newName = value.trim();
    rows[index] = value;
    const updates: Partial<LeaguePreset> = { teamsText: rows.join("\n") };
    // Keeps this row's qualification tag attached when its team name is edited, instead of
    // orphaning it under the old name (teamQualifications is keyed by team name, same pattern as
    // teamAbbreviations).
    if (oldName && oldName !== newName && activeLeaguePreset?.teamQualifications?.[oldName]) {
      const nextQuals = { ...activeLeaguePreset.teamQualifications };
      const tag = nextQuals[oldName];
      delete nextQuals[oldName];
      if (newName) nextQuals[newName] = tag;
      updates.teamQualifications = nextQuals;
    }
    updateActiveLeaguePreset(updates);
  };

  const handleAddTeamRow = () => {
    updateActiveLeaguePreset({ teamsText: [...getTeamRows(activeLeaguePreset), ""].join("\n") });
  };

  const handleRemoveTeamRow = (index: number) => {
    const rows = getTeamRows(activeLeaguePreset);
    const removedName = (rows[index] || "").trim();
    const nextRows = rows.filter((_, i) => i !== index);
    const updates: Partial<LeaguePreset> = { teamsText: nextRows.join("\n") };
    if (removedName && activeLeaguePreset?.teamQualifications?.[removedName]) {
      const nextQuals = { ...activeLeaguePreset.teamQualifications };
      delete nextQuals[removedName];
      updates.teamQualifications = nextQuals;
    }
    updateActiveLeaguePreset(updates);
  };

  const handleTeamQualificationChange = (teamName: string, value: string) => {
    const trimmed = teamName.trim();
    if (!trimmed) return;
    const nextQuals = { ...(activeLeaguePreset?.teamQualifications || {}) };
    if (value) {
      nextQuals[trimmed] = value;
    } else {
      delete nextQuals[trimmed];
    }
    updateActiveLeaguePreset({ teamQualifications: nextQuals });
  };

  const prevEditingRef = React.useRef<Match | null>(null);
  React.useEffect(() => {
    const prev = prevEditingRef.current;
    prevEditingRef.current = editingMatch || null;

    if (editingMatch) {
      if (!prev || prev.id !== editingMatch.id) {
        const gmt7Parts = isoToGmt7Parts(editingMatch.scheduledAt || "");
        setMeta({
          league: editingMatch.league || leaguePresets[0]?.name || "",
          stage: editingMatch.stage || "",
          teamA: editingMatch.teamA || "",
          teamB: editingMatch.teamB || "",
          format: editingMatch.format || "Bo3",
          date: gmt7Parts?.date || getTodayDateString(),
          time: gmt7Parts?.time || "",
          liveLink: editingMatch.liveLink || "",
          patch: editingMatch.patch || "",
          isPlayoff: !!editingMatch.isPlayoff
        });
        setGames(editingMatch.games && editingMatch.games.length > 0 ? editingMatch.games : [createEmptyGame(1)]);
        const matched = findPresetByLeagueName(leaguePresets, editingMatch.league);
        if (matched) setSelectedLeagueId(matched.id);
      }
    } else if (prev !== null) {
      setMeta({
        league: leaguePresets[0]?.name || "",
        stage: "",
        teamA: "",
        teamB: "",
        format: "Bo3",
        date: getTodayDateString(),
        time: "",
        liveLink: "",
        patch: "",
        isPlayoff: false
      });
      setGames([createEmptyGame(1)]);
    }
  }, [editingMatch, leaguePresets]);

  // Deep-link from a Match Schedule entry's "Edit" action: load that entry's own data into the
  // schedule-only fields (locked into schedule mode via the isScheduleOnly effect above) instead of
  // Match Schedule's own separate edit form, so there's one place to create or edit a not-yet-played
  // match. Guarded by id so it doesn't re-stomp an in-progress edit if the parent's schedules list
  // happens to re-render with a new object for the same entry.
  const prevEditingScheduleIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = editingSchedule?.id || null;
    if (!editingSchedule || prevEditingScheduleIdRef.current === id) return;
    prevEditingScheduleIdRef.current = id;
    const matched = findPresetByLeagueName(leaguePresets, editingSchedule.league);
    if (matched) setSelectedLeagueId(matched.id);
    const gmt7Parts = isoToGmt7Parts(editingSchedule.scheduledAt);
    setMeta((prev) => ({
      ...prev,
      league: editingSchedule.league || prev.league,
      stage: editingSchedule.matchCode || "",
      teamA: editingSchedule.teamA || "",
      teamB: editingSchedule.teamB || "",
      format: editingSchedule.format || prev.format,
      ...(gmt7Parts ? { date: gmt7Parts.date } : {}),
      time: gmt7Parts?.time || "",
      liveLink: editingSchedule.liveLink || ""
    }));
  }, [editingSchedule, leaguePresets]);

  // Consume a one-time prefill deep-linked from Match Schedule's "Enter Match Result".
  React.useEffect(() => {
    if (!matchPrefill) return;
    setForceFullResultMode(true);
    setMeta((prev) => ({
      ...prev,
      ...(matchPrefill.league ? { league: matchPrefill.league } : {}),
      ...(matchPrefill.teamA ? { teamA: matchPrefill.teamA } : {}),
      ...(matchPrefill.teamB ? { teamB: matchPrefill.teamB } : {}),
      ...(matchPrefill.format ? { format: matchPrefill.format } : {}),
      ...(matchPrefill.date ? { date: matchPrefill.date } : {})
    }));
    if (matchPrefill.league) {
      const matched = findPresetByLeagueName(leaguePresets, matchPrefill.league);
      if (matched) setSelectedLeagueId(matched.id);
    }
    if (onConsumedMatchPrefill) onConsumedMatchPrefill();
  }, [matchPrefill]);

  const rosterA = useMemo(
    () => roster.filter((r) => r.team.trim().toLowerCase() === meta.teamA.trim().toLowerCase()),
    [roster, meta.teamA]
  );
  const rosterB = useMemo(
    () => roster.filter((r) => r.team.trim().toLowerCase() === meta.teamB.trim().toLowerCase()),
    [roster, meta.teamB]
  );

  // Live snapshot of the match being edited right now, used only to compute the fearless-draft
  // "already used this hero" warning per game as the admin types - not persisted mid-edit.
  const liveMatch: Match = { ...meta, teamA: meta.teamA, teamB: meta.teamB, scoreA: 0, scoreB: 0, games };
  const fearlessDraftEnabled = !!activeLeaguePreset?.fearlessDraft;

  const maxGames = MAX_GAMES[meta.format];

  const handleAddGame = () => {
    if (games.length >= maxGames) return;
    setGames((prev) => [...prev, createEmptyGame(prev.length + 1)]);
  };

  const handleRemoveGame = (idx: number) => {
    setGames((prev) => prev.filter((_, i) => i !== idx).map((g, i) => ({ ...g, gameNumber: i + 1 })));
  };

  const handleGameChange = (idx: number, updated: Game) => {
    setGames((prev) => prev.map((g, i) => (i === idx ? updated : g)));
  };

  const handleSubmitSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    if (!onSaveSchedule) {
      setErrorMsg("Schedule saving isn't available right now.");
      return;
    }
    setIsSubmitting(true);
    try {
      const teamA = canonicalizeTeamName(meta.teamA, teamsForLeague, activeLeaguePreset?.teamAbbreviations);
      const teamB = canonicalizeTeamName(meta.teamB, teamsForLeague, activeLeaguePreset?.teamAbbreviations);
      const scheduledAtIso = gmt7ToIso(meta.date, meta.time);

      await onSaveSchedule({
        id: editingSchedule?.id,
        league: meta.league.trim(),
        matchCode: meta.stage.trim() || `${teamA} vs ${teamB}`,
        teamA,
        teamB,
        format: meta.format,
        scheduledAt: scheduledAtIso,
        liveLink: meta.liveLink.trim(),
        isFinished: editingSchedule?.isFinished ?? false
      });
      setSuccessMsg(editingSchedule ? "Schedule updated successfully!" : "Match scheduled successfully!");
      setTimeout(() => onClose(), 1200);
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred while saving the schedule.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setIsSubmitting(true);

    try {
      if (!meta.teamA.trim() || !meta.teamB.trim()) {
        throw new Error("Both team names must be filled in.");
      }
      if (meta.teamA.trim().toLowerCase() === meta.teamB.trim().toLowerCase()) {
        throw new Error("Team A and Team B must be different.");
      }

      const newMatch: Match = {
        id: editingMatch?.id,
        league: meta.league.trim(),
        stage: meta.stage.trim(),
        format: meta.format,
        teamA: meta.teamA.trim(),
        teamB: meta.teamB.trim(),
        scoreA: 0,
        scoreB: 0,
        scheduledAt: meta.date ? (meta.time ? gmt7ToIso(meta.date, meta.time) : new Date(meta.date).toISOString()) : "",
        liveLink: meta.liveLink.trim(),
        patch: meta.patch.trim(),
        isPlayoff: meta.isPlayoff,
        games
      };

      await onSave(newMatch);

      // Keep Match Schedule's own record in sync with whatever was just saved here - covers both
      // a match saved directly (never went through Match Schedule at all) and a match that DID
      // have a schedule entry but just got edited (date/teams/stage corrected), which used to
      // leave that entry stale forever since there's no stored link between the two records, only
      // a league+teams+date match computed on the fly. onSaveSchedule/schedules are both omitted
      // by the Edit Match modal instance of this form when it doesn't want this at all, so this is
      // a no-op there.
      if (onSaveSchedule && schedules) {
        // Look up by the match's PRE-edit details (editingMatch, not newMatch) first - if the
        // admin just changed the date or a team name, searching by the new values would miss the
        // entry that actually needs updating and create an orphaned duplicate instead.
        const priorDay = editingMatch?.scheduledAt ? editingMatch.scheduledAt.slice(0, 10) : "";
        const linkedSchedule = editingMatch && priorDay
          ? schedules.find((s) =>
              s.league === editingMatch.league && s.teamA === editingMatch.teamA && s.teamB === editingMatch.teamB &&
              s.scheduledAt && isoToGmt7Parts(s.scheduledAt)?.date === priorDay
            )
          : undefined;

        if (linkedSchedule) {
          await onSaveSchedule({
            ...linkedSchedule,
            league: newMatch.league || "",
            matchCode: newMatch.stage.trim() || `${newMatch.teamA} vs ${newMatch.teamB}`,
            teamA: newMatch.teamA,
            teamB: newMatch.teamB,
            format: newMatch.format,
            scheduledAt: newMatch.scheduledAt || "",
            isFinished: true
          });
        } else {
          const day = newMatch.scheduledAt ? newMatch.scheduledAt.slice(0, 10) : "";
          const alreadyScheduled = day && schedules.some((s) =>
            s.league === newMatch.league && s.teamA === newMatch.teamA && s.teamB === newMatch.teamB &&
            s.scheduledAt && isoToGmt7Parts(s.scheduledAt)?.date === day
          );
          if (!alreadyScheduled) {
            await onSaveSchedule({
              league: newMatch.league || "",
              matchCode: newMatch.stage || `${newMatch.teamA} vs ${newMatch.teamB}`,
              teamA: newMatch.teamA,
              teamB: newMatch.teamB,
              format: newMatch.format,
              scheduledAt: newMatch.scheduledAt || "",
              liveLink: newMatch.liveLink || "",
              isFinished: true
            });
          }
        }
      }

      setSuccessMsg("Match saved successfully!");
      setTimeout(() => onClose(), 1200);
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred while processing the data.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const required = REQUIRED_WINS[meta.format];
  const scoreA = games.filter((g) => g.winner === "A").length;
  const scoreB = games.filter((g) => g.winner === "B").length;

  return (
    <div className={`p-6 rounded-2xl shadow-xl transition-all ${isDarkMode ? "bg-slate-900/50" : "bg-white border border-slate-200"}`}>
      <div className="border-b pb-4 mb-4 border-slate-800">
        <h2 className={`text-lg font-bold font-display uppercase tracking-tight ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
          {editingMatch ? "EDIT MATCH RECORD" : editingSchedule ? "EDIT SCHEDULED MATCH" : "ADD NEW MATCH DATA"}
        </h2>
      </div>

      {/* Not-yet-played mode is auto-detected from Date/Time below instead of a manual toggle - a
          future date/time always saves as a Schedule entry, a today-or-earlier one (or no time at
          all) always saves as a real result, so there's nothing to remember to check separately.
          Only shown for a brand-new entry - editing an already-saved result (or an existing
          schedule entry, locked into schedule mode via editingSchedule) is always the real thing. */}
      {!editingMatch && !editingSchedule && onSaveSchedule && (
        <div className={`flex items-center gap-2.5 p-3 mb-4 rounded-xl border text-[11px] font-mono font-bold uppercase ${
          isScheduleOnly
            ? "bg-blue-500/10 border-blue-500/30 text-blue-500"
            : isDarkMode ? "bg-slate-950/40 border-slate-850 text-slate-400" : "bg-slate-50 border-slate-200 text-slate-600"
        }`}>
          <CalendarClock className="w-4 h-4 shrink-0" />
          {isScheduleOnly
            ? "Otomatis disimpan sebagai jadwal - Date/Time yang diisi masih di masa depan"
            : "Otomatis disimpan sebagai hasil match - isi Date/Time yang masih di masa depan untuk jadikan ini jadwal"}
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-xs font-mono flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-xl text-xs font-mono text-center mb-4">
          {successMsg}
        </div>
      )}

      {isScheduleOnly && !editingMatch ? (
        <form onSubmit={handleSubmitSchedule} className="space-y-6 text-xs">
          <div className={`p-4 rounded-xl border grid grid-cols-1 md:grid-cols-2 gap-4 ${isDarkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-200"}`}>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">League/Competition:</label>
              <select
                value={selectedLeagueId}
                onChange={(e) => handleLeagueDropdownChange(e.target.value)}
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              >
                {leaguePresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Stage/Title:</label>
              <input
                type="text"
                value={meta.stage}
                onChange={(e) => setMeta((prev) => ({ ...prev, stage: e.target.value }))}
                placeholder="Week 1 - Match 3"
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Team A:</label>
              <input
                type="text"
                value={meta.teamA}
                onChange={(e) => setMeta((prev) => ({ ...prev, teamA: e.target.value }))}
                list="league-team-list"
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Team B:</label>
              <input
                type="text"
                value={meta.teamB}
                onChange={(e) => setMeta((prev) => ({ ...prev, teamB: e.target.value }))}
                list="league-team-list"
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                required
              />
            </div>
            <datalist id="league-team-list">
              {teamsForLeague.map((t) => <option key={t} value={t} />)}
            </datalist>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Scheduled Date:</label>
              <div className="flex gap-1">
                <input
                  type="date"
                  value={meta.date}
                  onChange={(e) => setMeta((prev) => ({ ...prev, date: e.target.value }))}
                  className={`flex-1 p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setMeta((prev) => ({ ...prev, date: getTodayDateString() }))}
                  className="px-2 bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold font-mono text-[10px] rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  Today
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Scheduled Time:</label>
              <input
                type="time"
                value={meta.time}
                onChange={(e) => setMeta((prev) => ({ ...prev, time: e.target.value }))}
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase" title="Pre-fills from the league's Default Format (League Settings below) whenever a different league is picked - override it here just for this one match if it needs to differ, e.g. a Bo5 Grand Final in an otherwise Bo3 league.">Format (this match):</label>
              <select
                value={meta.format}
                onChange={(e) => setMeta((prev) => ({ ...prev, format: e.target.value as MatchFormat }))}
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              >
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Live Stream Link (optional):</label>
              <input
                type="text"
                value={meta.liveLink}
                onChange={(e) => setMeta((prev) => ({ ...prev, liveLink: e.target.value }))}
                placeholder="https://youtube.com/..."
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              />
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-3 border-t border-slate-850">
            <button
              type="button"
              onClick={onCancel || onClose}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold font-mono border cursor-pointer transition-all ${
                isDarkMode
                  ? "bg-slate-950 hover:bg-slate-900 text-slate-400 border-slate-800"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200"
              }`}
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold font-mono text-xs rounded-xl shadow-lg shadow-blue-500/10 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Saving data...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 shrink-0" />
                  <span>Save Schedule</span>
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6 text-xs">
          <div className={`p-4 rounded-xl border grid grid-cols-1 md:grid-cols-3 gap-4 ${isDarkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-200"}`}>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">League/Competition:</label>
              <select
                value={selectedLeagueId}
                onChange={(e) => handleLeagueDropdownChange(e.target.value)}
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              >
                {leaguePresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase" title='Kalau "Playoff Match" di bawah dinyalain dan league ini udah punya bracket, pilih slotnya langsung dari daftar - nggak perlu ketik teks yang harus persis sama.'>Stage:</label>
              {meta.isPlayoff && playoffStageOptions.length > 0 ? (
                <select
                  value={meta.stage}
                  onChange={(e) => setMeta((prev) => ({ ...prev, stage: e.target.value }))}
                  className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                >
                  <option value="">-- Pilih slot bracket --</option>
                  {playoffStageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <>
                  <input
                    type="text"
                    value={meta.stage}
                    onChange={(e) => setMeta((prev) => ({ ...prev, stage: e.target.value }))}
                    placeholder="Week 1"
                    className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                  />
                  {meta.isPlayoff && (
                    <p className="text-[9px] text-amber-500">
                      League ini belum punya bracket - bikin dulu di Standings → Bracket → "New Bracket", baru slotnya bisa dipilih dari daftar di sini.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase" title="Dikecualikan dari Match Standings, dan otomatis ngisi slot Bracket di tab Standings - pilih slotnya dari dropdown Stage di samping begitu ini dinyalain.">Playoff Match:</label>
              <div className="flex gap-1.5">
                {[{ v: false, l: "No" }, { v: true, l: "Yes" }].map((opt) => (
                  <button
                    key={String(opt.v)}
                    type="button"
                    onClick={() => setMeta((prev) => ({ ...prev, isPlayoff: opt.v }))}
                    className={`flex-1 p-2 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                      meta.isPlayoff === opt.v
                        ? "bg-blue-500 border-blue-400 text-slate-950"
                        : isDarkMode ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-600"
                    }`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase" title="Pre-fills from the league's Default Format (League Settings below) whenever a different league is picked - override it here just for this one match if it needs to differ, e.g. a Bo5 Grand Final in an otherwise Bo3 league.">Format (this match):</label>
              <select
                value={meta.format}
                onChange={(e) => setMeta((prev) => ({ ...prev, format: e.target.value as MatchFormat }))}
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              >
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Team A:</label>
              <input
                type="text"
                value={meta.teamA}
                onChange={(e) => setMeta((prev) => ({ ...prev, teamA: e.target.value }))}
                list="league-team-list"
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Team B:</label>
              <input
                type="text"
                value={meta.teamB}
                onChange={(e) => setMeta((prev) => ({ ...prev, teamB: e.target.value }))}
                list="league-team-list"
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                required
              />
            </div>
            <datalist id="league-team-list">
              {teamsForLeague.map((t) => <option key={t} value={t} />)}
            </datalist>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Date:</label>
              <div className="flex gap-1">
                <input
                  type="date"
                  value={meta.date}
                  onChange={(e) => setMeta((prev) => ({ ...prev, date: e.target.value }))}
                  className={`flex-1 p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                />
                <button
                  type="button"
                  onClick={() => setMeta((prev) => ({ ...prev, date: getTodayDateString() }))}
                  className="px-2 bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold font-mono text-[10px] rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  Today
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase" title="Optional - leave blank if the exact start time isn't known/relevant for a finished match">Time (optional):</label>
              <input
                type="time"
                value={meta.time}
                onChange={(e) => setMeta((prev) => ({ ...prev, time: e.target.value }))}
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase" title="The game client version/patch this match was played on, e.g. S15.a">Patch (optional):</label>
              <input
                type="text"
                value={meta.patch}
                onChange={(e) => setMeta((prev) => ({ ...prev, patch: e.target.value }))}
                placeholder="e.g. S15.a"
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">Live Stream Link (optional):</label>
              <input
                type="text"
                value={meta.liveLink}
                onChange={(e) => setMeta((prev) => ({ ...prev, liveLink: e.target.value }))}
                placeholder="https://youtube.com/..."
                className={`w-full p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
              />
            </div>
          </div>

          {/* LEAGUE SETTINGS: create/rename/delete a league, set its default format, toggle
              fearless draft, and edit the team list that feeds every Team A/B dropdown, Match
              Schedule, and Squad Roster team picker throughout the app. */}
          <div className={`p-5 rounded-2xl transition-all ${isDarkMode ? "bg-slate-950/40" : "bg-slate-50 border border-slate-200"}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-4 mb-4">
              <span className="text-sm font-black font-mono text-blue-500 tracking-tight uppercase">
                ⚙️ League Settings
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreateLeague}
                  className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-slate-950 rounded-lg text-xs font-black font-mono flex items-center gap-1 transition-all cursor-pointer shadow"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create New League
                </button>
                <button
                  type="button"
                  onClick={() => setShowLeagueSettings(!showLeagueSettings)}
                  className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg border transition-all cursor-pointer ${
                    showLeagueSettings
                      ? "bg-slate-800 text-slate-200 border-slate-700"
                      : "bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/20"
                  }`}
                >
                  {showLeagueSettings ? "✕ Close" : "⚙️ Open Settings"}
                </button>
              </div>
            </div>

            {showLeagueSettings && (
              <div className="space-y-4 animate-fadeIn">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start bg-slate-950/20 p-4 rounded-xl border border-slate-850/60">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Select League to Edit</label>
                    <div className="flex gap-1.5">
                      <select
                        value={selectedLeagueId}
                        onChange={(e) => handleLeagueDropdownChange(e.target.value)}
                        className={`flex-1 p-2 rounded-lg text-xs font-mono font-bold border focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                      >
                        {leaguePresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={handleDeleteLeague}
                        className="p-2 bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/40 rounded-lg transition-colors cursor-pointer shrink-0"
                        title="Delete This League"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">League Name</label>
                    <input
                      type="text"
                      value={activeLeaguePreset?.name || ""}
                      onChange={(e) => updateActiveLeaguePreset({ name: e.target.value })}
                      className={`w-full p-2 rounded-lg text-xs font-mono font-bold border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Default Format</label>
                    <div className="flex flex-wrap gap-1.5">
                      {FORMATS.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => updateActiveLeaguePreset({ defaultFormat: f })}
                          className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                            activeLeaguePreset?.defaultFormat === f
                              ? "border-blue-500 bg-blue-500 text-slate-950"
                              : isDarkMode ? "border-slate-700 bg-slate-950 text-slate-400" : "border-slate-300 bg-white text-slate-600"
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Fearless Draft</label>
                    <label className="flex items-center gap-2 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={!!activeLeaguePreset?.fearlessDraft}
                        onChange={(e) => updateActiveLeaguePreset({ fearlessDraft: e.target.checked })}
                        className="w-4 h-4 accent-blue-500 cursor-pointer shrink-0"
                      />
                      <span className="text-[9px] text-slate-500 normal-case leading-tight">Soft/per-team hero-reuse warning in the Draft Board below</span>
                    </label>
                  </div>
                </div>

                <div className="bg-slate-950/20 p-4 rounded-xl border border-slate-850/60 space-y-2">
                  <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Teams</label>
                  <div className="space-y-1.5">
                    {getTeamRows(activeLeaguePreset).length === 0 && (
                      <p className="text-[9px] text-slate-500 italic">No teams added yet.</p>
                    )}
                    {getTeamRows(activeLeaguePreset).map((team, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-slate-500 w-5 shrink-0">{idx + 1}.</span>
                        <input
                          type="text"
                          value={team}
                          onChange={(e) => handleTeamRowChange(idx, e.target.value)}
                          placeholder="Team name"
                          className={`flex-1 p-2 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                        />
                        <select
                          value={activeLeaguePreset?.teamQualifications?.[team.trim()] || ""}
                          onChange={(e) => handleTeamQualificationChange(team, e.target.value)}
                          title="How this team reached the league - purely a display tag"
                          className={`w-36 shrink-0 p-2 rounded-lg text-[10px] font-mono font-bold border focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-300 text-slate-700"}`}
                        >
                          <option value="">— No tag —</option>
                          {QUALIFICATION_OPTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemoveTeamRow(idx)}
                          className="text-slate-600 hover:text-red-400 cursor-pointer shrink-0"
                          title="Remove"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddTeamRow}
                      className="px-2.5 py-1 bg-slate-800/60 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer border border-slate-700/60"
                    >
                      <Plus className="w-3 h-3" />
                      Add Team
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-500 leading-relaxed">
                    Daftar ini yang muncul di dropdown/autocomplete Team A &amp; Team B di atas, di Match Schedule, dan di pilihan tim Squad Roster. Tag kualifikasi di samping tiap tim (Invited/Open Qualifier/dll) cuma penanda tampilan, tidak dipakai untuk logika apa pun.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* GAMES */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                Games ({games.length}/{maxGames}) — Match Score: {scoreA} - {scoreB} {scoreA >= required || scoreB >= required ? "(Decided)" : ""}
              </h3>
              {games.length < maxGames && (
                <button
                  type="button"
                  onClick={handleAddGame}
                  className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-slate-950 text-[10px] font-bold uppercase cursor-pointer transition-all flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Game
                </button>
              )}
            </div>

            {games.map((g, idx) => {
              // Game 7 of a Bo7 is HOK's "Ultimate Battle" decider - no ban phase, and the
              // fearless-reuse rule stops applying (a hero used earlier in the series is fair
              // game again), regardless of whether Fearless Draft is on for this league.
              const isUltimateBattle = meta.format === "Bo7" && g.gameNumber === 7;
              return (
              <div key={g.gameNumber} className={`p-3 rounded-xl border relative ${isDarkMode ? "bg-slate-950/30 border-slate-900" : "bg-white border-slate-200"}`}>
                {games.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveGame(idx)}
                    className="absolute top-2 right-2 p-1 rounded-lg text-red-400 hover:bg-red-950/30 cursor-pointer"
                    title="Remove this game"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <DraftBoard
                  game={g}
                  onChange={(updated) => handleGameChange(idx, updated)}
                  teamA={meta.teamA || "Team A"}
                  teamB={meta.teamB || "Team B"}
                  usedHeroesA={fearlessDraftEnabled && !isUltimateBattle ? getTeamUsedHeroes(liveMatch, g.gameNumber, "A") : []}
                  usedHeroesB={fearlessDraftEnabled && !isUltimateBattle ? getTeamUsedHeroes(liveMatch, g.gameNumber, "B") : []}
                  rosterA={rosterA}
                  rosterB={rosterB}
                  isUltimateBattle={isUltimateBattle}
                  isDarkMode={isDarkMode}
                />
              </div>
              );
            })}
          </div>

          <div className="flex gap-3 justify-end pt-3 border-t border-slate-850">
            <button
              type="button"
              onClick={onCancel || onClose}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold font-mono border cursor-pointer transition-all ${
                isDarkMode
                  ? "bg-slate-950 hover:bg-slate-900 text-slate-400 border-slate-800"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200"
              }`}
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold font-mono text-xs rounded-xl shadow-lg shadow-blue-500/10 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Saving data...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 shrink-0" />
                  <span>Save Match</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
