// Dates are 'YYYY-MM-DD' strings. All arithmetic is in UTC so a day is always 24 hours.
export type ISODate = string;

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

export const makeDate = (y: number, m: number, d: number): ISODate => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

export function isDate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return msToDate(t) === s;
}

export const toMs = (d: ISODate): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

export function msToDate(ms: number): ISODate {
  const t = new Date(ms);
  return makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const addDays = (d: ISODate, n: number): ISODate => msToDate(toMs(d) + n * DAY);

/** Whole days from a to b (positive when b is later). */
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((toMs(b) - toMs(a)) / DAY);

export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** 'YYYY-MM' */
export const monthKey = (d: ISODate): string => d.slice(0, 7);

/** The Monday on or before d. */
export function weekStart(d: ISODate): ISODate {
  const dow = (new Date(toMs(d)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(d, -dow);
}

/** Every 'YYYY-MM' that has at least one day in [from, toExclusive). */
export function monthsIn(from: ISODate, toExclusive: ISODate): string[] {
  const out: string[] = [];
  if (from >= toExclusive) return out;
  let y = +from.slice(0, 4);
  let m = +from.slice(5, 7);
  const last = monthKey(addDays(toExclusive, -1));
  for (;;) {
    const key = `${y}-${pad(m)}`;
    out.push(key);
    if (key === last) return out;
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
}

/** '14 Mar 2025' */
export const fmtDate = (d: ISODate): string => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
/** '14 Mar' */
export const fmtDay = (d: ISODate): string => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
/** 'Mar 2025' from 'YYYY-MM' */
export const fmtMonth = (m: string): string => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
/** 'Mar' from 'YYYY-MM' */
export const monthShort = (m: string): string => MONTHS[+m.slice(5, 7) - 1];
export const monthName = (m: number): string => MONTHS[m - 1];
