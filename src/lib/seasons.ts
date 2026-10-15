import type { Season } from "@/config/store";

/**
 * Dates of the holidays the shops are built around, and of the Danish public holidays (when
 * nothing is sent). All dates are calendar dates in Danish time, as "YYYY-MM-DD".
 */

/** Easter Sunday (Gregorian calendar, Anonymous algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

/** Fastelavnssøndag: seven weeks before Easter Sunday. */
export function fastelavn(year: number): string {
  return addDays(easterSunday(year), -49);
}

export function halloween(year: number): string {
  return isoDate(year, 10, 31);
}

/** The season's next day on or after `today` (the day itself counts). */
export function nextOccurrence(season: Season, today: string): string {
  const year = Number(today.slice(0, 4));
  const day = season === "fastelavn" ? fastelavn : halloween;
  const thisYear = day(year);
  return thisYear >= today ? thisYear : day(year + 1);
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Days on which nothing is sent: the Danish public holidays, plus Grundlovsdag, juleaften and
 * nytårsaften, when shops and warehouses are closed too.
 */
export function closedDays(year: number): Set<string> {
  const easter = easterSunday(year);
  return new Set([
    isoDate(year, 1, 1),
    addDays(easter, -3), // Skærtorsdag
    addDays(easter, -2), // Langfredag
    easter,
    addDays(easter, 1), // 2. påskedag
    addDays(easter, 39), // Kristi himmelfartsdag
    addDays(easter, 49), // Pinsedag
    addDays(easter, 50), // 2. pinsedag
    isoDate(year, 6, 5), // Grundlovsdag
    isoDate(year, 12, 24),
    isoDate(year, 12, 25),
    isoDate(year, 12, 26),
    isoDate(year, 12, 31),
  ]);
}

/** The date and time of day in Denmark for an instant. */
export function danishTime(now: Date): { date: string; weekday: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Copenhagen",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays.indexOf(parts.weekday ?? "") + 1, // 1 = Monday … 7 = Sunday
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** "søndag 7. februar" */
export function formatDanishDate(date: string, options: { weekday?: boolean; year?: boolean } = {}): string {
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: "UTC",
    weekday: options.weekday === false ? undefined : "long",
    day: "numeric",
    month: "long",
    year: options.year ? "numeric" : undefined,
  }).format(new Date(`${date}T12:00:00Z`));
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
