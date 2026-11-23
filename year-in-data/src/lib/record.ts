// Everything the year's record holds, computed for one window from the document.
import { bookStats, type BookStats } from './books';
import { chessStats, type ChessStats } from './chess';
import { type ISODate, monthKey, monthsIn } from './dates';
import { decisionStats, type DecisionStats } from './decisions';
import { hoursStats, type HoursStats } from './hours';
import { matchStats, type MatchStats } from './matches';
import { type DayPlace, dayPlaces, tripStats, type TripStats } from './trips';
import type { Build, Doc, RepoSummary } from './types';
import { type YearWindow, elapsedDays, elapsedEnd, inWindow } from './window';

export interface BuildStats {
  count: number;
  list: Build[];
  byMonth: { month: string; count: number }[];
}

export function buildStats(builds: Build[], w: YearWindow): BuildStats {
  const list = builds.filter((b) => inWindow(b.shipped, w)).sort((a, b) => (a.shipped < b.shipped ? -1 : a.shipped > b.shipped ? 1 : a.name.localeCompare(b.name)));
  const months = new Map<string, number>(monthsIn(w.start, w.end).map((m) => [m, 0]));
  for (const b of list) months.set(monthKey(b.shipped), months.get(monthKey(b.shipped))! + 1);
  return { count: list.length, list, byMonth: [...months].map(([month, count]) => ({ month, count })) };
}

export interface YearRecord {
  window: YearWindow;
  today: ISODate;
  /** Days of the year that have happened. Less than window.days while the year is in progress. */
  elapsedDays: number;
  inProgress: boolean;
  notStarted: boolean;
  /** Null when no Two City document is loaded. */
  trips: TripStats | null;
  matches: MatchStats | null;
  /** One entry per night that has happened; empty without a Two City document. */
  days: DayPlace[];
  /** Null until chess games have been fetched for this year. */
  chess: ChessStats | null;
  chessFetchedAt: number | null;
  counters: { label: string; played: number; won: number }[];
  books: BookStats;
  builds: BuildStats;
  repos: RepoSummary[];
  hours: HoursStats | null;
  decisions: DecisionStats | null;
}

export function buildRecord(doc: Doc, w: YearWindow, today: ISODate): YearRecord {
  const two = doc.imported.twoCity?.data;
  const hrs = doc.imported.hours?.data;
  const dec = doc.imported.decisions?.data;
  const cache = doc.chess.cache[w.key];
  const days = elapsedDays(w, today);
  return {
    window: w,
    today,
    elapsedDays: days,
    inProgress: days > 0 && days < w.days,
    notStarted: days === 0,
    trips: two ? tripStats(two.stays, w, today) : null,
    matches: two ? matchStats(two.fixtures, w) : null,
    days: two ? dayPlaces(two.stays, w.start, elapsedEnd(w, today), today) : [],
    chess: cache ? chessStats(cache.games, w) : null,
    chessFetchedAt: cache?.fetchedAt ?? null,
    counters: doc.counters
      .map((c) => ({ label: c.label, played: c.byYear[w.key]?.played ?? 0, won: c.byYear[w.key]?.won ?? 0 }))
      .filter((c) => c.played > 0 || c.won > 0),
    books: bookStats(doc.books, w),
    builds: buildStats(doc.builds, w),
    repos: doc.github.repos.map((r) => doc.github.cache[w.key]?.[r]).filter((s): s is RepoSummary => Boolean(s)),
    hours: hrs ? hoursStats(hrs.entries, hrs.categories, w, today) : null,
    decisions: dec ? decisionStats(dec.decisions, w) : null,
  };
}

// --- headline numbers, and one year set against another ---
export interface Headline {
  id: string;
  label: string;
  /** Null when the year has no rows from that source at all. */
  value: number | null;
  digits: number;
  unit?: string;
}

export function headlines(r: YearRecord): Headline[] {
  const t = r.trips && r.trips.nights - r.trips.buckets.unrecorded > 0 ? r.trips : null;
  const games = (r.chess?.total ?? 0) + r.counters.reduce((s, c) => s + c.played, 0);
  const commits = r.repos.reduce((s, x) => s + x.total, 0);
  return [
    { id: 'london', label: 'Nights in London', value: t ? t.buckets.london : null, digits: 0 },
    { id: 'istanbul', label: 'Nights in Istanbul', value: t ? t.buckets.istanbul : null, digits: 0 },
    { id: 'elsewhere', label: 'Nights elsewhere', value: t ? t.buckets.elsewhere : null, digits: 0 },
    { id: 'moves', label: 'Moves between cities', value: t ? t.moves : null, digits: 0 },
    { id: 'matches', label: 'Matches attended', value: r.matches && r.matches.count > 0 ? r.matches.count : null, digits: 0 },
    { id: 'games', label: 'Games played', value: games > 0 ? games : null, digits: 0 },
    { id: 'books', label: 'Books finished', value: r.books.count > 0 ? r.books.count : null, digits: 0 },
    { id: 'builds', label: 'Builds shipped', value: r.builds.count > 0 ? r.builds.count : null, digits: 0 },
    { id: 'commits', label: 'Commits', value: r.repos.length > 0 ? commits : null, digits: 0 },
    { id: 'hours', label: 'Hours logged', value: r.hours && r.hours.entries > 0 ? r.hours.totalMinutes / 60 : null, digits: 0, unit: 'h' },
    { id: 'decisions', label: 'Calls made', value: r.decisions && r.decisions.made.length > 0 ? r.decisions.made.length : null, digits: 0 },
    { id: 'brier', label: 'Brier score', value: r.decisions?.brier ?? null, digits: 3 },
  ];
}

export interface Comparison {
  id: string;
  label: string;
  current: number | null;
  previous: number | null;
  /** current - previous, only when both years have the number. */
  delta: number | null;
  digits: number;
  unit?: string;
}

export function compareYears(current: YearRecord, previous: YearRecord): Comparison[] {
  const prev = new Map(headlines(previous).map((h) => [h.id, h.value]));
  return headlines(current).map((h) => {
    const p = prev.get(h.id) ?? null;
    return { id: h.id, label: h.label, current: h.value, previous: p, delta: h.value !== null && p !== null ? h.value - p : null, digits: h.digits, unit: h.unit };
  });
}

/** True when the record has anything at all to show. */
export const hasAnyRecord = (r: YearRecord): boolean => headlines(r).some((h) => h.value !== null);
