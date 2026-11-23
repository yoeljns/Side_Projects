// Dates are 'YYYY-MM-DD' strings. All arithmetic is done in UTC so a day is
// always 24 hours and nothing depends on the device's time zone.

const DAY_MS = 86_400_000;

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number): string => fromMs(toMs(d) + n * DAY_MS);

/** Whole days from `a` to `b` (positive when b is later). */
export const diffDays = (a: string, b: string): number => Math.round((toMs(b) - toMs(a)) / DAY_MS);

/** Calendar months later, keeping the day of month and clamping to the month's end (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromMs(Date.UTC(ny, nm, Math.min(day, last)));
}

/** The local calendar day of a Date as 'YYYY-MM-DD'. The UI calls this once and passes `today` down. */
export function localDay(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-03-05' -> '5 Mar 2026'. */
export function formatDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/** "today", "in 3 days", "12 days ago". */
export function relativeDay(d: string, today: string): string {
  const n = diffDays(today, d);
  if (n === 0) return 'today';
  const a = Math.abs(n);
  const unit = a === 1 ? 'day' : 'days';
  return n > 0 ? `in ${a} ${unit}` : `${a} ${unit} ago`;
}

export interface ReviewPreset {
  id: string;
  label: string;
  from: (d: string) => string;
}

export const REVIEW_PRESETS: ReviewPreset[] = [
  { id: '1w', label: '1 week', from: (d) => addDays(d, 7) },
  { id: '1m', label: '1 month', from: (d) => addMonths(d, 1) },
  { id: '3m', label: '3 months', from: (d) => addMonths(d, 3) },
  { id: '6m', label: '6 months', from: (d) => addMonths(d, 6) },
  { id: '1y', label: '1 year', from: (d) => addMonths(d, 12) },
];
