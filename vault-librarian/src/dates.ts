// Dates are 'YYYY-MM-DD' strings; arithmetic is done in UTC so it never depends on the machine's zone.

const DAY_MS = 86_400_000;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** b - a in whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** ISO 8601 week label, e.g. 2026-11-23 -> '2026-W48'. Weeks start on Monday; week 1 holds 4 January. */
export function isoWeek(date: string): string {
  const d = new Date(toUtc(date));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Dow * DAY_MS;
  const week = 1 + Math.round((d.getTime() - 3 * DAY_MS - week1Monday) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday of an ISO week label, or null when the label is not a real week. */
export function isoWeekMonday(week: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const monday = new Date(jan4 - jan4Dow * DAY_MS + (n - 1) * 7 * DAY_MS).toISOString().slice(0, 10);
  return isoWeek(monday) === week ? monday : null;
}

/** Whole weeks from ISO week a to ISO week b (negative when b is earlier). */
export function weeksBetween(a: string, b: string): number {
  const ma = isoWeekMonday(a);
  const mb = isoWeekMonday(b);
  if (!ma || !mb) return Number.POSITIVE_INFINITY;
  return Math.round(daysBetween(ma, mb) / 7);
}

/** Calendar date of a timestamp in the machine's local zone (what the owner sees in the file browser). */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Reads a date out of a frontmatter value: 'YYYY-MM-DD', an ISO timestamp, or a Date. */
export function coerceDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(value.trim());
  return m && isIsoDate(m[1]) ? m[1] : null;
}
