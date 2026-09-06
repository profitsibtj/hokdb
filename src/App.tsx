import { useState, useEffect, useRef } from "react";
import {
  Activity, Users, ArrowRightLeft, LogOut, Sun, Moon, Lock, Award, Trophy, Medal, UploadCloud
} from "lucide-react";
import { Match, RosterPlayer, ScheduleEntry, LeaguePreset, MatchFormat } from "./types";
import { AuthScreen } from "./components/AuthScreen";
import { AddMatchForm } from "./components/AddMatchForm";
import { MatchExplorer } from "./components/MatchExplorer";
import { MatchSchedule } from "./components/MatchSchedule";
import { Standings } from "./components/Standings";
import { PlayerStats } from "./components/PlayerStats";
import { HeadToHead } from "./components/HeadToHead";
import { RosterManager } from "./components/RosterManager";
import { PlayerAchievements } from "./components/PlayerAchievements";
import { BulkImportMatches } from "./components/BulkImportMatches";
import { clientDb, isTableMissingError } from "./dataClient";
import { isoToGmt7Parts } from "./utils";

const HOK_LOGO_URL = "https://www.honorofkings.com/assets/favicon-CaeYdbfs.ico";

const SUPABASE_SETUP_SQL = `create table if not exists public.matches (
  id bigint generated always as identity primary key,
  league text, stage text, format text,
  team_a text, team_b text,
  score_a int default 0, score_b int default 0, winner text,
  scheduled_at timestamptz, live_link text, patch text, is_playoff boolean default false,
  is_finished boolean default false,
  games jsonb,
  created_at timestamptz default now(), updated_at timestamptz
);

create table if not exists public.roster (
  id bigint generated always as identity primary key,
  name text not null, position text, secondary_position text, team text, league text,
  previous_names jsonb, real_name text,
  created_at timestamptz default now(), updated_at timestamptz
);

-- Re-running this script on a database that already has these tables is safe - these add columns
-- (real_name disambiguates two registered players sharing the same nickname; secondary_position is
-- a lane player's optional second-best lane; patch is the game client version a match was played
-- on) without touching anything else if missing, and are a no-op if already there.
alter table public.roster add column if not exists real_name text;
alter table public.roster add column if not exists secondary_position text;
alter table public.matches add column if not exists patch text;
alter table public.matches add column if not exists is_playoff boolean default false;

create table if not exists public.schedules (
  id bigint generated always as identity primary key,
  league text, match_code text, team_a text, team_b text, format text,
  scheduled_at timestamptz, live_link text, is_finished boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.tournaments (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now(), updated_at timestamptz
);

create or replace function reset_matches_id_seq() returns void as $$
begin
  perform setval(pg_get_serial_sequence('matches', 'id'), coalesce((select max(id) from matches), 0) + 1, false);
end;
$$ language plpgsql;

create or replace function reset_roster_id_seq() returns void as $$
begin
  perform setval(pg_get_serial_sequence('roster', 'id'), coalesce((select max(id) from roster), 0) + 1, false);
end;
$$ language plpgsql;

create or replace function reset_schedules_id_seq() returns void as $$
begin
  perform setval(pg_get_serial_sequence('schedules', 'id'), coalesce((select max(id) from schedules), 0) + 1, false);
end;
$$ language plpgsql;`;

// The RLS + password-gated-write migration (app_settings table, upsert_*/delete_*/sync_tournaments
// functions) already ran directly against the live Supabase project and isn't repeated in the
// in-app "Copy SQL Script" banner above anymore - dataClient.ts's writes call those functions by
// name (e.g. .rpc("upsert_match", ...)), so they must still exist in the database for any save/
// delete to work. If this project's Supabase database is ever recreated from scratch, that
// migration needs to be reapplied by hand (ask for it again, or pull it from an earlier chat/
// commit) before SUPABASE_SETUP_SQL above alone is enough to make the app fully work again.

const LEAGUE_PRESETS_KEY = "hok_league_presets_v1";

const defaultLeaguePresets = (): LeaguePreset[] => [
  {
    id: "hok_indonesia",
    name: "Liga Honor of Kings Indonesia",
    defaultFormat: "Bo3",
    fearlessDraft: true,
    teamsText: ["Team 1", "Team 2", "Team 3", "Team 4"].join("\n")
  }
];

export default function App() {
  // Access credentials intentionally live only in memory. A refresh locks the app again.
  const [token, setToken] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem("hokdb_theme");
    return saved ? saved === "dark" : true;
  });
  const [activeTab, setActiveTab] = useState<string>("matches");

  const [matches, setMatches] = useState<Match[]>([]);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [supabaseSetupNeeded, setSupabaseSetupNeeded] = useState(false);

  const [leaguePresets, setLeaguePresets] = useState<LeaguePreset[]>(() => {
    const stored = localStorage.getItem(LEAGUE_PRESETS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error("Failed to parse league presets", e);
      }
    }
    const defaults = defaultLeaguePresets();
    localStorage.setItem(LEAGUE_PRESETS_KEY, JSON.stringify(defaults));
    return defaults;
  });

  const leaguePresetSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistLeaguePresets = async (updated: LeaguePreset[]) => {
    try {
      if (clientDb.getIsStatic()) {
        await clientDb.saveLeaguePresets(updated, actionPassword);
        return;
      }
      const tokenToUse = actionPassword || token || "";
      const res = await fetch("/api/tournaments", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenToUse}` },
        body: JSON.stringify({ tournaments: updated })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || "Failed to save league preset to the database.", "error");
      }
    } catch (err: any) {
      try {
        await clientDb.saveLeaguePresets(updated, actionPassword);
      } catch (dbErr: any) {
        showToast("Failed to save league preset: " + err.message, "error");
      }
    }
  };

  // League config is shared across every browser that logs in, so edits made in the admin panel
  // need to reach the database, not just this browser's localStorage. Local state + localStorage
  // update instantly for a responsive UI; the network write is debounced so rapid edits (typing a
  // team name) don't fire a request per keystroke.
  const handleUpdateLeaguePresets = (updated: LeaguePreset[]) => {
    setLeaguePresets(updated);
    localStorage.setItem(LEAGUE_PRESETS_KEY, JSON.stringify(updated));

    if (leaguePresetSaveTimeoutRef.current) clearTimeout(leaguePresetSaveTimeoutRef.current);
    leaguePresetSaveTimeoutRef.current = setTimeout(() => persistLeaguePresets(updated), 800);
  };

  const fetchLeaguePresets = async () => {
    if (!token) return;
    try {
      if (clientDb.getIsStatic()) {
        const data = await clientDb.getLeaguePresets();
        if (data && data.length > 0) {
          setLeaguePresets(data);
          localStorage.setItem(LEAGUE_PRESETS_KEY, JSON.stringify(data));
        } else {
          await persistLeaguePresets(leaguePresets);
        }
        return;
      }
      const res = await fetch("/api/tournaments", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          setLeaguePresets(data);
          localStorage.setItem(LEAGUE_PRESETS_KEY, JSON.stringify(data));
        } else {
          persistLeaguePresets(leaguePresets);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "DATABASE_SETUP_NEEDED") {
          setSupabaseSetupNeeded(true);
        } else {
          showToast(errData.message || errData.error || "Failed to load league config from the database.", "error");
        }
      }
    } catch (err: any) {
      if (isTableMissingError(err)) {
        setSupabaseSetupNeeded(true);
        return;
      }
      try {
        const data = await clientDb.getLeaguePresets();
        if (data && data.length > 0) {
          setLeaguePresets(data);
          localStorage.setItem(LEAGUE_PRESETS_KEY, JSON.stringify(data));
        } else {
          await persistLeaguePresets(leaguePresets);
        }
      } catch (clientErr: any) {
        if (isTableMissingError(clientErr)) {
          setSupabaseSetupNeeded(true);
        } else {
          console.error("Error fetching league presets:", err);
        }
      }
    }
  };

  // Administrative verification
  const [actionPasswordVerified, setActionPasswordVerified] = useState(false);
  const [actionPassword, setActionPassword] = useState("");

  // Edit match state
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);

  // Deep-link from a Match Schedule entry's "Enter Match Result" button.
  const [matchPrefill, setMatchPrefill] = useState<{ league?: string; teamA?: string; teamB?: string; format?: MatchFormat; date?: string } | null>(null);
  const [scheduleToFinishOnSaveId, setScheduleToFinishOnSaveId] = useState<string | null>(null);

  const handleEnterScheduleResults = (schedule: ScheduleEntry) => {
    const dateStr = isoToGmt7Parts(schedule.scheduledAt || "")?.date;
    setMatchPrefill({ league: schedule.league, teamA: schedule.teamA, teamB: schedule.teamB, format: schedule.format, date: dateStr });
    setScheduleToFinishOnSaveId(schedule.id || null);
    setEditingScheduleEntry(null);
    setActiveTab("admin");
  };

  // Deep-link from a Match Schedule entry's "Edit" (pencil) button into Add New Match Data's own
  // schedule-only mode, instead of Match Schedule having its own separate edit form - one place to
  // create or edit a not-yet-played match, so nothing needs entering twice.
  const [editingScheduleEntry, setEditingScheduleEntry] = useState<ScheduleEntry | null>(null);

  const handleEditScheduleEntry = (schedule: ScheduleEntry) => {
    setEditingScheduleEntry(schedule);
    setMatchPrefill(null);
    setScheduleToFinishOnSaveId(null);
    setActiveTab("admin");
  };

  // Bumped to force Add New Match Data (the embedded, non-modal instance) to remount with a blank
  // slate on "Back" - simpler and more reliable than resetting each of its many internal fields by
  // hand.
  const [addMatchFormResetKey, setAddMatchFormResetKey] = useState(0);

  // Rendered as a fixed overlay outside the tab-switch area below (like the Edit Match Modal) so it
  // survives handleSaveMatch's own setActiveTab("matches") call after each match it saves - a bulk
  // import saves many matches in a row, and switching tabs on the first success would otherwise
  // unmount this mid-import.
  const [showBulkImport, setShowBulkImport] = useState(false);

  // Deep-link from a finished Match Schedule entry down into its posted result in Match Explorer.
  // Matched by league + date, same pairing used everywhere else a schedule is tied to a match.
  const [matchFocusRequest, setMatchFocusRequest] = useState<{ id: string; token: number } | null>(null);

  const handleViewScheduledMatch = (schedule: ScheduleEntry) => {
    const dateStr = isoToGmt7Parts(schedule.scheduledAt || "")?.date || "";
    const match = matches.find((m) =>
      (m.league || "").trim().toLowerCase() === (schedule.league || "").trim().toLowerCase() &&
      (m.scheduledAt || "").slice(0, 10) === dateStr
    );
    if (match?.id) setMatchFocusRequest({ id: match.id, token: Date.now() });
  };

  // Shared jump-to-match handler for anywhere else in the app that already knows a specific
  // match's id (Standings' team history drill-down, Bracket's slot click) and just needs to land
  // on Match Results with it expanded/highlighted - same focus mechanism as handleViewScheduledMatch.
  const handleJumpToMatch = (matchId: string) => {
    setMatchFocusRequest({ id: matchId, token: Date.now() });
    setActiveTab("matches");
  };

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.remove("light");
      localStorage.setItem("hokdb_theme", "dark");
    } else {
      root.classList.add("light");
      localStorage.setItem("hokdb_theme", "light");
    }
  }, [isDarkMode]);

  const handleLogin = (newToken: string) => {
    setToken(newToken);
    showToast("Welcome! Successfully signed in to the database.", "success");
  };

  const handleLogout = () => {
    setToken(null);
    setActionPasswordVerified(false);
    setActionPassword("");
    showToast("Successfully signed out.", "info");
  };

  const fetchMatches = async () => {
    if (!token) return;
    setIsLoadingMatches(true);
    try {
      if (clientDb.getIsStatic()) {
        const data = await clientDb.getMatches();
        setMatches(data);
        setSupabaseSetupNeeded(false);
        return;
      }
      const res = await fetch("/api/matches", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setMatches(data);
        setSupabaseSetupNeeded(false);
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleLogout();
        } else {
          if (errData.error === "DATABASE_SETUP_NEEDED" || (errData.error && (errData.error.includes("schema cache") || errData.error.includes("relation")))) {
            setSupabaseSetupNeeded(true);
          }
          showToast(errData.message || errData.error || "Failed to load match data.", "error");
        }
      }
    } catch (err: any) {
      if (isTableMissingError(err)) {
        setSupabaseSetupNeeded(true);
        return;
      }
      if (clientDb.getIsStatic()) {
        showToast("Network error: " + err.message, "error");
        return;
      }
      try {
        const data = await clientDb.getMatches();
        setMatches(data);
        setSupabaseSetupNeeded(false);
      } catch (clientErr: any) {
        if (isTableMissingError(clientErr)) {
          setSupabaseSetupNeeded(true);
        } else {
          showToast("Network error: " + err.message, "error");
        }
      }
    } finally {
      setIsLoadingMatches(false);
    }
  };

  const fetchRoster = async () => {
    if (!token) return;
    setIsLoadingRoster(true);
    try {
      if (clientDb.getIsStatic()) {
        const data = await clientDb.getRoster();
        setRoster(data);
        setSupabaseSetupNeeded(false);
        return;
      }
      const res = await fetch("/api/roster", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setRoster(data);
        setSupabaseSetupNeeded(false);
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "DATABASE_SETUP_NEEDED" || (errData.error && (errData.error.includes("schema cache") || errData.error.includes("relation")))) {
          setSupabaseSetupNeeded(true);
        }
      }
    } catch (err: any) {
      if (isTableMissingError(err)) {
        setSupabaseSetupNeeded(true);
        return;
      }
      if (clientDb.getIsStatic()) {
        console.error("Error fetching roster:", err);
        return;
      }
      try {
        const data = await clientDb.getRoster();
        setRoster(data);
        setSupabaseSetupNeeded(false);
      } catch (clientErr: any) {
        if (isTableMissingError(clientErr)) {
          setSupabaseSetupNeeded(true);
        } else {
          console.error("Error fetching roster:", clientErr);
        }
      }
    } finally {
      setIsLoadingRoster(false);
    }
  };

  const fetchSchedules = async () => {
    if (!token) return;
    setIsLoadingSchedules(true);
    try {
      if (clientDb.getIsStatic()) {
        const data = await clientDb.getSchedules();
        setSchedules(data);
        setSupabaseSetupNeeded(false);
        return;
      }
      const res = await fetch("/api/schedules", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSchedules(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "DATABASE_SETUP_NEEDED" || (errData.error && (errData.error.includes("schema cache") || errData.error.includes("relation")))) {
          setSupabaseSetupNeeded(true);
        } else if (errData.error !== "DATABASE_SETUP_NEEDED") {
          console.error("Error fetching schedules:", errData);
        }
      }
    } catch (err: any) {
      if (isTableMissingError(err)) {
        setSupabaseSetupNeeded(true);
        return;
      }
      if (clientDb.getIsStatic()) {
        console.error("Error fetching schedules:", err);
        return;
      }
      try {
        const data = await clientDb.getSchedules();
        setSchedules(data);
      } catch (clientErr: any) {
        if (isTableMissingError(clientErr)) {
          setSupabaseSetupNeeded(true);
        } else {
          console.error("Error fetching schedules:", clientErr);
        }
      }
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchMatches();
      fetchRoster();
      fetchSchedules();
      fetchLeaguePresets();
    }
  }, [token]);

  const verifyActionPassword = async (password: string): Promise<boolean> => {
    try {
      if (clientDb.getIsStatic()) {
        const isValid = await clientDb.verifyActionPassword(password);
        if (isValid) {
          setActionPasswordVerified(true);
          setActionPassword(password);
          showToast("Verification successful! Admin mode active.", "success");
          return true;
        }
        return false;
      }
      const res = await fetch("/api/verify-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        setActionPasswordVerified(true);
        setActionPassword(password);
        showToast("Verification successful! Admin mode active.", "success");
        return true;
      }
      return false;
    } catch (err) {
      const isValid = await clientDb.verifyActionPassword(password);
      if (isValid) {
        setActionPasswordVerified(true);
        setActionPassword(password);
        showToast("Verification successful! Admin mode active.", "success");
        return true;
      }
      return false;
    }
  };

  const handleSaveMatch = async (matchData: Match) => {
    const isEdit = !!matchData.id;
    const successMessage = isEdit ? "Successfully updated the match record." : "Successfully added a new match to the database.";

    const saveViaClientDb = async () => {
      if (isEdit) {
        await clientDb.updateMatch(matchData.id!, matchData, actionPassword);
      } else {
        await clientDb.addMatch(matchData, actionPassword);
      }
    };

    const finalizeSuccess = () => {
      setEditingMatch(null);
      fetchMatches();
      setActiveTab("matches");
      if (!isEdit) {
        const linkedSchedule = scheduleToFinishOnSaveId
          ? schedules.find((s) => s.id === scheduleToFinishOnSaveId)
          : schedules.find((s) => !s.isFinished && s.league === matchData.league && s.teamA === matchData.teamA && s.teamB === matchData.teamB);
        if (linkedSchedule) handleSaveSchedule({ ...linkedSchedule, isFinished: true });
        setScheduleToFinishOnSaveId(null);
      }
    };

    try {
      if (clientDb.getIsStatic()) {
        await saveViaClientDb();
        showToast(successMessage, "success");
        finalizeSuccess();
        return;
      }

      const tokenToUse = actionPassword || token || "";
      const url = isEdit ? `/api/matches/${matchData.id}` : "/api/matches";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenToUse}` },
        body: JSON.stringify(matchData)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save the match.");
      }

      showToast(successMessage, "success");
      finalizeSuccess();
    } catch (err: any) {
      try {
        await saveViaClientDb();
        showToast(`${successMessage} (Static fallback).`, "success");
        finalizeSuccess();
      } catch (dbErr: any) {
        showToast("Error saving match: " + err.message, "error");
        throw err;
      }
    }
  };

  const handleDeleteMatch = async (id: string) => {
    try {
      if (clientDb.getIsStatic()) {
        await clientDb.deleteMatch(id, actionPassword);
        showToast("Match record permanently deleted.", "success");
        fetchMatches();
        return;
      }
      const tokenToUse = actionPassword || token || "";
      const res = await fetch(`/api/matches/${id}?password=${encodeURIComponent(tokenToUse)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenToUse}`, "x-password": tokenToUse }
      });
      if (res.ok) {
        showToast("Match record permanently deleted.", "success");
        fetchMatches();
      } else {
        const errData = await res.json();
        if (res.status === 401) {
          setActionPasswordVerified(false);
          setActionPassword("");
        }
        showToast(errData.error || "Failed to delete the match.", "error");
      }
    } catch (err: any) {
      try {
        await clientDb.deleteMatch(id, actionPassword);
        showToast("Match record permanently deleted.", "success");
        fetchMatches();
      } catch (dbErr: any) {
        showToast("Error deleting match: " + err.message, "error");
      }
    }
  };

  const handleSaveSchedule = async (scheduleData: ScheduleEntry) => {
    const isEdit = !!scheduleData.id;

    const saveViaClientDb = async () => {
      if (isEdit) {
        await clientDb.updateSchedule(scheduleData.id!, scheduleData, actionPassword);
      } else {
        await clientDb.addSchedule(scheduleData, actionPassword);
      }
    };

    try {
      if (clientDb.getIsStatic()) {
        await saveViaClientDb();
        showToast(isEdit ? "Schedule updated." : "Schedule added.", "success");
        fetchSchedules();
        return;
      }

      const tokenToUse = actionPassword || token || "";
      const url = isEdit ? `/api/schedules/${scheduleData.id}` : "/api/schedules";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenToUse}` },
        body: JSON.stringify(scheduleData)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save the schedule.");
      }

      showToast(isEdit ? "Schedule updated." : "Schedule added.", "success");
      fetchSchedules();
    } catch (err: any) {
      try {
        await saveViaClientDb();
        showToast(`${isEdit ? "Schedule updated" : "Schedule added"} (Static fallback).`, "success");
        fetchSchedules();
      } catch (dbErr: any) {
        showToast("Error saving schedule: " + err.message, "error");
        throw err;
      }
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      if (clientDb.getIsStatic()) {
        await clientDb.deleteSchedule(id, actionPassword);
        showToast("Schedule entry deleted.", "success");
        fetchSchedules();
        return;
      }
      const tokenToUse = actionPassword || token || "";
      const res = await fetch(`/api/schedules/${id}?password=${encodeURIComponent(tokenToUse)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenToUse}`, "x-password": tokenToUse }
      });
      if (res.ok) {
        showToast("Schedule entry deleted.", "success");
        fetchSchedules();
      } else {
        const errData = await res.json();
        showToast(errData.error || "Failed to delete the schedule entry.", "error");
      }
    } catch (err: any) {
      try {
        await clientDb.deleteSchedule(id, actionPassword);
        showToast("Schedule entry deleted.", "success");
        fetchSchedules();
      } catch (dbErr: any) {
        showToast("Error deleting schedule: " + err.message, "error");
      }
    }
  };

  const handleSaveRosterPlayer = async (player: RosterPlayer) => {
    try {
      if (clientDb.getIsStatic()) {
        await clientDb.saveRosterPlayer(player, actionPassword);
        showToast("Roster successfully updated.", "success");
        fetchRoster();
        return;
      }
      const pass = actionPassword;
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pass, player })
      });
      if (res.ok) {
        showToast("Roster successfully updated.", "success");
        fetchRoster();
      } else {
        const errData = await res.json();
        showToast(errData.error || "Failed to save the roster player.", "error");
      }
    } catch (err: any) {
      try {
        await clientDb.saveRosterPlayer(player, actionPassword);
        showToast("Roster successfully updated.", "success");
        fetchRoster();
      } catch (dbErr: any) {
        showToast("Error saving roster: " + err.message, "error");
      }
    }
  };

  const handleDeleteRosterPlayer = async (id: string) => {
    try {
      if (clientDb.getIsStatic()) {
        await clientDb.deleteRosterPlayer(id, actionPassword);
        showToast("Player successfully removed from the roster.", "success");
        fetchRoster();
        return;
      }
      const pass = actionPassword;
      const res = await fetch(`/api/roster/${id}?password=${encodeURIComponent(pass)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pass}`, "x-password": pass },
        body: JSON.stringify({ password: pass })
      });
      if (res.ok) {
        showToast("Player successfully removed from the roster.", "success");
        fetchRoster();
      } else {
        const errData = await res.json();
        if (res.status === 401) {
          setActionPasswordVerified(false);
          setActionPassword("");
        }
        showToast(errData.error || "Failed to delete the roster player.", "error");
      }
    } catch (err: any) {
      try {
        await clientDb.deleteRosterPlayer(id, actionPassword);
        showToast("Player successfully removed from the roster.", "success");
        fetchRoster();
      } catch (dbErr: any) {
        showToast("Error deleting roster: " + err.message, "error");
      }
    }
  };

  const handleTriggerEditMatch = (m: Match) => {
    setEditingMatch(m);
  };

  if (!token) {
    return <AuthScreen onLogin={handleLogin} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />;
  }

  return (
    <div className={`min-h-screen transition-colors duration-200 selection:bg-blue-500/30 font-sans ${
      isDarkMode ? "bg-[#0b0f19] text-slate-100" : "bg-slate-50 text-slate-900"
    }`}>
      {/* HEADER */}
      <header className={`sticky top-0 z-50 backdrop-blur-md transition-all ${
        isDarkMode ? "bg-[#0b0f19]/85 border-b border-slate-900" : "bg-white/85 shadow-sm"
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={HOK_LOGO_URL}
              alt="Honor of Kings"
              className="h-10 w-10 object-contain"
            />
            <div>
              <h1 className={`font-black font-display text-sm tracking-tight flex items-center gap-1.5 uppercase ${isDarkMode ? "text-slate-100" : "text-slate-950"}`}>
                HOK DATABASE
              </h1>
              <p className="text-[10px] text-slate-500 font-mono tracking-wide">LEVEL UP INDONESIA</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                isDarkMode ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-white" : "bg-slate-200/60 border-slate-200 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={() => {
                setActiveTab("admin");
                if (editingMatch) setEditingMatch(null);
              }}
              className={`p-2.5 rounded-xl border font-bold text-xs cursor-pointer transition-all flex items-center gap-1.5 ${
                activeTab === "admin"
                  ? "bg-blue-500 border-blue-400 text-slate-950"
                  : isDarkMode
                    ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    : "bg-slate-200/60 border-slate-200 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span className="font-mono">Admin</span>
            </button>

            <button
              onClick={handleLogout}
              className={`p-2.5 rounded-xl border font-semibold text-xs cursor-pointer transition-all flex items-center gap-1.5 ${
                isDarkMode ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-white" : "bg-slate-200/60 border-slate-200 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline font-mono">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* NAVIGATION TABS */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className={`p-4 rounded-3xl border transition-all ${
          isDarkMode ? "bg-slate-900/30 border-slate-900" : "bg-white border-slate-200 shadow-sm"
        }`}>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin whitespace-nowrap">
            {[
              { id: "matches", label: "Match Results", icon: Activity },
              { id: "standings", label: "Match Standings", icon: Trophy },
              { id: "playerStats", label: "Player Stats", icon: Users },
              { id: "rosterManager", label: "Rosters", icon: Award },
              { id: "headToHead", label: "Comparisons", icon: ArrowRightLeft },
              { id: "achievements", label: "Achievements", icon: Medal }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (editingMatch) setEditingMatch(null);
                  }}
                  className={`px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer border ${
                    isActive
                      ? "bg-blue-500 text-slate-950 border-blue-400 shadow-md shadow-blue-500/10 font-extrabold"
                      : isDarkMode
                        ? "bg-slate-950/40 border-slate-850 text-slate-400 hover:text-white hover:bg-slate-800/40"
                        : "bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-white"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {supabaseSetupNeeded && (
          <div className={`mb-8 p-6 rounded-3xl border transition-all ${
            isDarkMode ? "bg-blue-950/20 border-blue-500/30 text-blue-100" : "bg-blue-50 border-blue-200 text-blue-900"
          }`}>
            <div className="flex flex-col lg:flex-row gap-5 items-start justify-between">
              <div className="space-y-2 flex-1">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-blue-500 animate-pulse" />
                  Supabase Database Setup Required
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The <code className="font-mono bg-slate-900 px-1 py-0.5 rounded text-blue-400">matches</code>, <code className="font-mono bg-slate-900 px-1 py-0.5 rounded text-blue-400">roster</code>, <code className="font-mono bg-slate-900 px-1 py-0.5 rounded text-blue-400">schedules</code>, or <code className="font-mono bg-slate-900 px-1 py-0.5 rounded text-blue-400">tournaments</code> table was not found in your Supabase database.
                  Copy the SQL script below, run it in your Supabase dashboard's <strong>SQL Editor</strong>, then refresh this page.
                </p>
                <div className="mt-4 relative bg-slate-950 p-4 rounded-xl border border-slate-850 font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto whitespace-pre select-all">
                  {SUPABASE_SETUP_SQL}
                </div>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
                  showToast("SQL script copied!", "success");
                }}
                className="px-4 py-2.5 rounded-xl bg-blue-500 text-slate-950 font-mono text-xs font-bold hover:bg-blue-400 cursor-pointer shadow-md shadow-blue-500/10 shrink-0 self-start lg:self-center"
              >
                Copy SQL Script
              </button>
            </div>
          </div>
        )}

        {activeTab === "matches" && (
          <div className="space-y-8">
            <MatchSchedule
              schedules={schedules}
              isLoading={isLoadingSchedules}
              onSaveSchedule={handleSaveSchedule}
              onDeleteSchedule={handleDeleteSchedule}
              onEnterResults={handleEnterScheduleResults}
              onEditSchedule={handleEditScheduleEntry}
              onViewMatch={handleViewScheduledMatch}
              matches={matches}
              isDarkMode={isDarkMode}
              actionPasswordVerified={actionPasswordVerified}
            />
            <MatchExplorer
              matches={matches}
              isLoading={isLoadingMatches}
              onDeleteMatch={handleDeleteMatch}
              onEditMatch={handleTriggerEditMatch}
              isDarkMode={isDarkMode}
              actionPasswordVerified={actionPasswordVerified}
              focusRequest={matchFocusRequest}
            />
          </div>
        )}

        {activeTab === "standings" && (
          <Standings
            matches={matches}
            leaguePresets={leaguePresets}
            onUpdateLeaguePresets={handleUpdateLeaguePresets}
            isDarkMode={isDarkMode}
            actionPasswordVerified={actionPasswordVerified}
            onViewMatch={handleJumpToMatch}
          />
        )}

        {activeTab === "playerStats" && (
          <PlayerStats matches={matches} leaguePresets={leaguePresets} isDarkMode={isDarkMode} onViewMatch={handleJumpToMatch} />
        )}

        {activeTab === "headToHead" && (
          <HeadToHead matches={matches} leaguePresets={leaguePresets} isDarkMode={isDarkMode} />
        )}

        {activeTab === "achievements" && (
          <PlayerAchievements matches={matches} leaguePresets={leaguePresets} isDarkMode={isDarkMode} onViewMatch={handleJumpToMatch} />
        )}

        {activeTab === "rosterManager" && (
          <RosterManager
            roster={roster}
            isLoading={isLoadingRoster}
            onSavePlayer={handleSaveRosterPlayer}
            onDeletePlayer={handleDeleteRosterPlayer}
            isDarkMode={isDarkMode}
            actionPasswordVerified={actionPasswordVerified}
            leaguePresets={leaguePresets}
            onUpdateLeaguePresets={handleUpdateLeaguePresets}
          />
        )}

        {activeTab === "admin" && (
          !actionPasswordVerified ? (
            <div className={`p-8 rounded-3xl max-w-sm mx-auto text-center font-mono my-12 transition-all ${
              isDarkMode ? "bg-slate-900/60 border border-slate-800" : "bg-white shadow-xl shadow-slate-100/80"
            }`}>
              <div className="inline-flex p-4 rounded-3xl bg-blue-500/10 text-blue-500 mb-4 animate-bounce">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className={`text-base font-bold uppercase tracking-tight ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>Access Restricted</h3>
              <p className="text-[10px] text-slate-400 mt-2 mb-6 leading-relaxed uppercase">
                This page requires the action password to access.
              </p>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const formEl = e.currentTarget;
                const inputEl = formEl.elements.namedItem("actionPassword") as HTMLInputElement;
                const isOk = await verifyActionPassword(inputEl.value);
                if (!isOk) {
                  showToast("Incorrect action password!", "error");
                }
              }} className="space-y-4">
                <input
                  type="password"
                  name="actionPassword"
                  placeholder="Action Password"
                  className={`w-full rounded-xl py-2.5 px-4 text-center text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all ${
                    isDarkMode ? "bg-slate-950 border border-slate-800 text-slate-100" : "bg-slate-100 text-slate-900"
                  }`}
                  required
                />
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-slate-950 font-bold text-xs tracking-wide transition-all shadow-lg cursor-pointer"
                >
                  UNLOCK ACCESS
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowBulkImport(true)}
                  className="px-4 py-2.5 rounded-xl border font-bold text-xs cursor-pointer transition-all flex items-center gap-1.5 bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/20"
                  title="Import banyak match sekaligus dari spreadsheet stats, biar gak input satu-satu"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span className="font-mono">Bulk Import dari Spreadsheet</span>
                </button>
              </div>
              <AddMatchForm
              key={addMatchFormResetKey}
              onSave={handleSaveMatch}
              onClose={() => {
                setEditingMatch(null);
                setActiveTab("matches");
                setMatchPrefill(null);
                setScheduleToFinishOnSaveId(null);
                setEditingScheduleEntry(null);
              }}
              onCancel={() => {
                setMatchPrefill(null);
                setScheduleToFinishOnSaveId(null);
                setEditingScheduleEntry(null);
                setAddMatchFormResetKey((k) => k + 1);
              }}
              isDarkMode={isDarkMode}
              editingMatch={null}
              leaguePresets={leaguePresets}
              onUpdateLeaguePresets={handleUpdateLeaguePresets}
              roster={roster}
              matchPrefill={matchPrefill}
              onConsumedMatchPrefill={() => setMatchPrefill(null)}
              onSaveSchedule={handleSaveSchedule}
              schedules={schedules}
              editingSchedule={editingScheduleEntry}
              />
            </div>
          )
        )}
      </main>

      {/* EDIT MATCH MODAL */}
      {editingMatch && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/90 overflow-y-auto animate-fadeIn">
          <div className={`w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border ${
            isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
          }`}>
            <AddMatchForm
              onSave={handleSaveMatch}
              onClose={() => setEditingMatch(null)}
              isDarkMode={isDarkMode}
              editingMatch={editingMatch}
              leaguePresets={leaguePresets}
              onUpdateLeaguePresets={handleUpdateLeaguePresets}
              roster={roster}
              onSaveSchedule={handleSaveSchedule}
              schedules={schedules}
            />
          </div>
        </div>
      )}

      {/* BULK IMPORT MODAL */}
      {showBulkImport && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/90 overflow-y-auto animate-fadeIn">
          <BulkImportMatches
            leaguePresets={leaguePresets}
            roster={roster}
            matches={matches}
            isDarkMode={isDarkMode}
            onSaveMatch={handleSaveMatch}
            onClose={() => setShowBulkImport(false)}
          />
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[200] max-w-sm animate-fadeIn">
          <div className={`border rounded-xl px-4 py-3.5 shadow-xl font-mono text-xs flex items-center gap-3 ${
            toast.type === "success"
              ? "bg-emerald-950/95 border-emerald-500 text-emerald-400"
              : toast.type === "error"
                ? "bg-red-950/95 border-red-500 text-red-400"
                : "bg-slate-900/95 border-blue-500 text-blue-500"
          }`}>
            <div className="shrink-0 p-1 bg-white/10 rounded-lg">
              <Activity className="w-4 h-4" />
            </div>
            <p className="font-semibold leading-normal">{toast.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
