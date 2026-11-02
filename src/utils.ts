const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;

export const gmt7ToIso = (dateStr: string, timeStr: string): string => {
  if (!dateStr || !timeStr) return "";
  const date = new Date(`${dateStr}T${timeStr}:00+07:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

export const isoToGmt7Parts = (iso: string): { date: string; time: string } | null => {
  if (!iso) return null;
  const utcMs = new Date(iso).getTime();
  if (Number.isNaN(utcMs)) return null;
  const shifted = new Date(utcMs + GMT7_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
};
