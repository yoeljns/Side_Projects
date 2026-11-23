// Calendar dates are 'YYYY-MM-DD' strings and all arithmetic on them is done in
// UTC, so a date never shifts when the device changes timezone. The only place
// a timezone enters is `localDay`, which reads the device's calendar date.

export type Day = string;

const MS_DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export const isDay = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

const toMs = (d: Day) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: Day, n: number): Day => fromMs(toMs(d) + n * MS_DAY);
export const diffDays = (a: Day, b: Day): number => Math.round((toMs(a) - toMs(b)) / MS_DAY);

/** 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (d: Day): number => (new Date(toMs(d)).getUTCDay() + 6) % 7;

/** The Monday of the week containing `d`. */
export const weekStart = (d: Day): Day => addDays(d, -weekdayIndex(d));

/** Monday to Sunday. */
export const weekDays = (start: Day): Day[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** ISO 8601 week: the week belongs to the year that holds its Thursday. */
export function isoWeek(d: Day): { year: number; week: number } {
  const thursday = addDays(weekStart(d), 3);
  const year = Number(thursday.slice(0, 4));
  const firstThursdayWeek = weekStart(`${year}-01-04`);
  return { year, week: diffDays(weekStart(d), firstThursdayWeek) / 7 + 1 };
}

/** The device's calendar date at instant `at`. */
export const localDay = (at: Date): Day => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

export const monthKey = (d: Day): string => d.slice(0, 7);
export const quarterKey = (d: Day): string => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekdayName = (d: Day): string => WEEKDAYS[weekdayIndex(d)];
export const weekdayShort = (d: Day): string => WEEKDAYS_SHORT[weekdayIndex(d)];

/** "18 Nov" */
export const fmtDayShort = (d: Day): string => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** "Wed 18 Nov" */
export const fmtDay = (d: Day): string => `${weekdayShort(d)} ${fmtDayShort(d)}`;

/** "16–22 Nov 2026", "30 Nov – 6 Dec 2026", "28 Dec 2026 – 3 Jan 2027" */
export function fmtWeekRange(start: Day): string {
  const end = addDays(start, 6);
  const ys = start.slice(0, 4);
  const ye = end.slice(0, 4);
  if (ys !== ye) return `${fmtDayShort(start)} ${ys} – ${fmtDayShort(end)} ${ye}`;
  if (monthKey(start) === monthKey(end)) return `${Number(start.slice(8))}–${fmtDayShort(end)} ${ye}`;
  return `${fmtDayShort(start)} – ${fmtDayShort(end)} ${ye}`;
}

/** "Nov 2026" from "2026-11"; "Q4 2026" from "2026-Q4". */
export function fmtPeriod(key: string): string {
  const q = /^(\d{4})-Q(\d)$/.exec(key);
  if (q) return `Q${q[2]} ${q[1]}`;
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/** "6h 30m", "45m", "10h", "0m". */
export function fmtDur(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Hours with at most one decimal, for axes and tight cells: 90 → "1.5", 600 → "10". */
export const fmtHours = (minutes: number): string => String(Math.round(minutes / 6) / 10);
