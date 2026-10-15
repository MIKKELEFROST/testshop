import { closedDays, danishTime } from "./seasons";

/** Orders placed before this time (Danish time) on a working day are sent the same day. */
export const CUTOFF_MINUTES = 19 * 60;

/**
 * Minutes left to order for same-day dispatch, or null when nothing is sent today (after
 * 19:00, weekends and the days in `closedDays`). No delivery date is promised.
 */
export function minutesToCutoff(now: Date): number | null {
  const { date, weekday, minutes } = danishTime(now);
  if (weekday > 5 || closedDays(Number(date.slice(0, 4))).has(date)) return null;
  return minutes < CUTOFF_MINUTES ? CUTOFF_MINUTES - minutes : null;
}

/** "3 t 12 min", "45 min" */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} t` : `${hours} t ${rest} min`;
}
