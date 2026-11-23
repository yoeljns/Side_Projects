// The document and the small operations on it. No DOM, no clock.
import type { Day } from './dates';

export interface Category {
  id: string;
  label: string;
  /** Index into the fixed palette (0..7). */
  color: number;
  weeklyTargetHours?: number;
  /** A floor is something to reach, a ceiling something to stay under. Default floor. */
  targetKind?: 'floor' | 'ceiling';
  /** Extra words the quick line accepts for this category. */
  aliases?: string[];
  archived?: boolean;
}

export interface Entry {
  id: string;
  day: Day;
  /** A category id. */
  category: string;
  minutes: number;
  note?: string;
}

export interface RunningTimer {
  category: string;
  /** Epoch milliseconds. Storing the start, not a counter, is what survives reloads and sleep. */
  startedAt: number;
}

export interface Reflection {
  went: string;
  leaked: string;
  change: string;
}

export interface Settings {
  timerCapHours: number;
  /** 'HH:MM', local time, for the Sunday reminder. */
  reminderTime: string;
}

export interface Doc {
  entries: Entry[];
  categories: Category[];
  timer: RunningTimer | null;
  /** Keyed by the Monday of the week. */
  reflections: Record<Day, Reflection>;
  settings: Settings;
}

export const PALETTE_SIZE = 8;
export const PALETTE_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Magenta', 'Green', 'Violet', 'Red'];

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'company', label: 'Company', color: 0 },
  { id: 'masters', label: 'Masters', color: 1 },
  { id: 'training', label: 'Training', color: 2 },
  { id: 'builds', label: 'Builds', color: 3 },
];

export const BLANK: Doc = {
  entries: [],
  categories: DEFAULT_CATEGORIES,
  timer: null,
  reflections: {},
  settings: { timerCapHours: 6, reminderTime: '18:00' },
};

export const BLANK_REFLECTION: Reflection = { went: '', leaked: '', change: '' };

export const activeCategories = (cats: Category[]): Category[] => cats.filter((c) => !c.archived);

export const categoryLabel = (cats: Category[], id: string): string => cats.find((c) => c.id === id)?.label ?? id;

/** A URL-ish id from a label, made unique against the ids already taken. */
export function slugId(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** The palette slot used least by the active categories (lowest index on a tie). */
export function nextColor(cats: Category[]): number {
  const counts = Array.from({ length: PALETTE_SIZE }, () => 0);
  for (const c of activeCategories(cats)) counts[c.color % PALETTE_SIZE] += 1;
  return counts.indexOf(Math.min(...counts));
}

export const cellMinutes = (entries: Entry[], day: Day, category: string): number =>
  entries.reduce((sum, e) => (e.day === day && e.category === category ? sum + e.minutes : sum), 0);

/**
 * Make the total for one day and category equal `target`. Raising it adds one
 * entry for the difference; lowering it trims the most recently added entries
 * first, so older notes survive as long as they can.
 */
export function setCellMinutes(entries: Entry[], day: Day, category: string, target: number, id: string): Entry[] {
  const goal = Math.max(0, Math.round(target));
  const current = cellMinutes(entries, day, category);
  if (goal === current) return entries;
  if (goal > current) return [...entries, { id, day, category, minutes: goal - current }];
  let toRemove = current - goal;
  const out: Entry[] = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (toRemove > 0 && e.day === day && e.category === category) {
      if (e.minutes <= toRemove) {
        toRemove -= e.minutes;
        continue;
      }
      out.push({ ...e, minutes: e.minutes - toRemove });
      toRemove = 0;
    } else {
      out.push(e);
    }
  }
  return out.reverse();
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Every entry, oldest day first, as CSV with a header row. */
export function entriesCsv(entries: Entry[], cats: Category[]): string {
  const rows = [...entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.day < b.e.day ? -1 : a.e.day > b.e.day ? 1 : a.i - b.i))
    .map(({ e }) =>
      [e.day, csvCell(categoryLabel(cats, e.category)), String(e.minutes), (e.minutes / 60).toFixed(2), csvCell(e.note ?? '')].join(','),
    );
  return ['day,category,minutes,hours,note', ...rows].join('\r\n') + '\r\n';
}
