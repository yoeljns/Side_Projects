// Day arithmetic on 'YYYY-MM-DD' strings (always UTC) and the two cities' clocks.
// No hidden clock: anything that needs "now" takes it as an argument.

export type Day = string;
export type City = 'london' | 'istanbul';

export const CITIES: Record<City, { label: string; tz: string; country: string }> = {
  london: { label: 'London', tz: 'Europe/London', country: 'GB' },
  istanbul: { label: 'Istanbul', tz: 'Europe/Istanbul', country: 'TR' },
};
export const otherCity = (c: City): City => (c === 'london' ? 'istanbul' : 'london');
export const isCity = (s: unknown): s is City => s === 'london' || s === 'istanbul';

const MS = 86400000;

export function isDay(s: unknown): s is Day {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export const addDays = (day: Day, n: number): Day => new Date(Date.parse(day) + n * MS).toISOString().slice(0, 10);
/** Whole days from a to b (positive when b is later). */
export const daysBetween = (a: Day, b: Day): number => Math.round((Date.parse(b) - Date.parse(a)) / MS);
export const minDay = (a: Day, b: Day): Day => (a <= b ? a : b);
export const maxDay = (a: Day, b: Day): Day => (a >= b ? a : b);
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (day: Day): number => ((new Date(Date.parse(day)).getUTCDay() + 6) % 7) + 1;

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Mon 23 Nov 2026', or 'Mon 23 Nov' with year: false. */
export function fmtDay(day: Day, opts: { year?: boolean; weekday?: boolean } = {}): string {
  if (!isDay(day)) return day;
  const [y, m, d] = day.split('-').map(Number);
  const parts = [opts.weekday === false ? '' : WEEKDAYS[isoWeekday(day) - 1], String(d), MONTHS[m - 1], opts.year === false ? '' : String(y)];
  return parts.filter(Boolean).join(' ');
}

/** "in 3 days", "today", "2 days ago". */
export function relDay(day: Day, today: Day): string {
  const n = daysBetween(today, day);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Minutes a timezone is ahead of UTC at an instant. Throws on an unknown zone. */
export function offsetMinutes(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(at).map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

const shifted = (tz: string, at: Date) => new Date(at.getTime() + offsetMinutes(tz, at) * 60000);
/** The calendar date in a timezone at an instant. */
export const dayIn = (tz: string, at: Date): Day => shifted(tz, at).toISOString().slice(0, 10);
/** 'HH:MM' wall clock in a timezone at an instant. */
export const clockIn = (tz: string, at: Date): string => shifted(tz, at).toISOString().slice(11, 16);

/** The instant (ms) of a wall-clock time in a timezone. */
export function zonedToUtcMs(day: Day, time: string, tz: string): number {
  const [h, m] = time.split(':').map(Number);
  const wall = Date.parse(day) + (h * 60 + m) * 60000;
  let guess = wall - offsetMinutes(tz, new Date(wall)) * 60000;
  guess = wall - offsetMinutes(tz, new Date(guess)) * 60000;
  return guess;
}

/** 'HH:MM' plus minutes, wrapping past midnight. */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Small id for list items (UI call sites only; pure functions derive ids from their inputs). */
export const uid = (): string => Math.random().toString(36).slice(2, 10);
