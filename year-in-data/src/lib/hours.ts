// Hours by category, from the hours-ledger app's entries.
import { type ISODate, addDays, diffDays, monthKey, monthsIn, weekStart } from './dates';
import type { HoursCategory, HoursEntry } from './types';
import { type YearWindow, elapsedEnd, inWindow } from './window';

export interface HoursStats {
  totalMinutes: number;
  entries: number;
  /** Total hours divided by the weeks of the year that have happened (days / 7). */
  weeklyAvgHours: number;
  byCategory: { id: string; label: string; minutes: number; weeklyAvgHours: number }[];
  /** Monday-to-Sunday weeks that lie wholly inside the year so far, including weeks with nothing logged. */
  weeks: { start: ISODate; minutes: number }[];
  heaviest: { start: ISODate; minutes: number } | null;
  lightest: { start: ISODate; minutes: number } | null;
  byMonth: { month: string; minutes: number }[];
}

export function hoursStats(entries: HoursEntry[], categories: HoursCategory[], w: YearWindow, today: ISODate): HoursStats {
  const until = elapsedEnd(w, today);
  const days = diffDays(w.start, until);
  const weeksElapsed = days / 7;
  const inYear = entries.filter((e) => inWindow(e.day, w) && e.minutes > 0);
  const label = (cat: string) => categories.find((c) => c.id === cat)?.label ?? categories.find((c) => c.label === cat)?.label ?? cat;

  const cats = new Map<string, number>();
  const months = new Map<string, number>(monthsIn(w.start, w.end).map((m) => [m, 0]));
  const weekTotals = new Map<ISODate, number>();
  let first = weekStart(w.start);
  if (first < w.start) first = addDays(first, 7);
  for (let s = first; addDays(s, 7) <= until; s = addDays(s, 7)) weekTotals.set(s, 0);

  let total = 0;
  for (const e of inYear) {
    total += e.minutes;
    const key = label(e.category);
    cats.set(key, (cats.get(key) ?? 0) + e.minutes);
    months.set(monthKey(e.day), (months.get(monthKey(e.day)) ?? 0) + e.minutes);
    const ws = weekStart(e.day);
    if (weekTotals.has(ws)) weekTotals.set(ws, weekTotals.get(ws)! + e.minutes);
  }

  const weeks = [...weekTotals].map(([start, minutes]) => ({ start, minutes }));
  // Ties go to the earliest week.
  const heaviest = weeks.reduce<HoursStats['heaviest']>((b, x) => (!b || x.minutes > b.minutes ? x : b), null);
  const lightest = weeks.reduce<HoursStats['lightest']>((b, x) => (!b || x.minutes < b.minutes ? x : b), null);
  const perWeek = (minutes: number) => (weeksElapsed > 0 ? minutes / 60 / weeksElapsed : 0);

  return {
    totalMinutes: total,
    entries: inYear.length,
    weeklyAvgHours: perWeek(total),
    byCategory: [...cats]
      .map(([l, minutes]) => ({ id: l, label: l, minutes, weeklyAvgHours: perWeek(minutes) }))
      .sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label)),
    weeks,
    heaviest,
    lightest,
    byMonth: [...months].map(([month, minutes]) => ({ month, minutes })),
  };
}
