import type { LeaguePreset, Match, RosterPlayer, ScheduleEntry } from "./types";
import { accessApi } from "./accessClient";
import {
  formatMatchData,
  mapMatchFromDb,
  mapMatchToDb,
  mapRosterToDb,
  mapScheduleFromDb,
  mapScheduleToDb,
} from "./dbMappers";

export const clientDb = {
  getMatches: async (): Promise<Match[]> => {
    const rows = await accessApi<unknown[]>("list_matches");
    return rows.map((row) => formatMatchData(mapMatchFromDb(row)));
  },

  addMatch: async (match: Match): Promise<string> => {
    const id = await accessApi<number>("save_match", {
      row: mapMatchToDb(formatMatchData(match)),
    });
    return String(id);
  },

  updateMatch: async (id: string, match: Match): Promise<void> => {
    await accessApi("save_match", {
      id,
      row: mapMatchToDb(formatMatchData(match)),
    });
  },

  saveRosterPlayer: async (player: RosterPlayer): Promise<string> => {
    const id = await accessApi<number>("save_roster", {
      ...(player.id ? { id: player.id } : {}),
      row: mapRosterToDb(player),
    });
    return String(id);
  },

  deleteRosterPlayer: async (id: string): Promise<void> => {
    await accessApi("delete_roster", { id });
  },

  getSchedules: async (): Promise<ScheduleEntry[]> => {
    const rows = await accessApi<unknown[]>("list_schedules");
    return rows.map(mapScheduleFromDb);
  },

  addSchedule: async (schedule: ScheduleEntry): Promise<string> => {
    const id = await accessApi<number>("save_schedule", {
      row: mapScheduleToDb(schedule),
    });
    return String(id);
  },

  updateSchedule: async (id: string, schedule: ScheduleEntry): Promise<void> => {
    await accessApi("save_schedule", {
      id,
      row: mapScheduleToDb(schedule),
    });
  },

  saveLeaguePresets: async (presets: LeaguePreset[]): Promise<void> => {
    const rows = presets.map(({ id, ...data }) => ({ id: String(id), data }));
    await accessApi("sync_tournaments", { rows });
  },
};
