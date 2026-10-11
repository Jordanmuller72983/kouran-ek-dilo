// Mauritius is UTC+4 all year (no daylight saving), so a fixed offset is exact.
export const MU_OFFSET_HOURS = 4;

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Epoch ms for a wall-clock time in Mauritius. Month is 1-12. */
export function muTime(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour - MU_OFFSET_HOURS, minute);
}

/** Current date parts as seen in Mauritius. */
export function muToday(now = Date.now()): { year: number; month: number; day: number } {
  const d = new Date(now + MU_OFFSET_HOURS * HOUR);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
