// The review year runs from one birthday to the next.
import { type ISODate, addDays, diffDays, isLeap, makeDate } from './dates';

export interface Birthday {
  month: number; // 1-12
  day: number; // 1-31
}

export interface YearWindow {
  /** The calendar year in which the closing birthday falls; also the storage key. */
  endYear: number;
  key: string;
  /** First day: the opening birthday. */
  start: ISODate;
  /** The closing birthday. Not part of the year. */
  end: ISODate;
  /** Last day of the year (the day before the closing birthday). */
  last: ISODate;
  days: number;
}

export function isBirthday(b: unknown): b is Birthday {
  if (!b || typeof b !== 'object') return false;
  const { month, day } = b as Birthday;
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  return day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** The date the birthday is observed in a given year. 29 February is observed on 1 March in years without one. */
export function birthdayIn(b: Birthday, year: number): ISODate {
  if (b.month === 2 && b.day === 29 && !isLeap(year)) return makeDate(year, 3, 1);
  return makeDate(year, b.month, b.day);
}

export function yearWindow(b: Birthday, endYear: number): YearWindow {
  const start = birthdayIn(b, endYear - 1);
  const end = birthdayIn(b, endYear);
  return { endYear, key: String(endYear), start, end, last: addDays(end, -1), days: diffDays(start, end) };
}

/** Days after a birthday during which the year that just closed is still the one offered first. */
export const REVIEW_GRACE_DAYS = 45;

/**
 * Which year to open on. For 45 days after a birthday it is the year that just
 * closed (the review is being written); after that, the year in progress.
 */
export function defaultEndYear(b: Birthday, today: ISODate): number {
  const y = +today.slice(0, 4);
  const thisYears = birthdayIn(b, y);
  const recentYear = thisYears <= today ? y : y - 1;
  const recent = birthdayIn(b, recentYear);
  return diffDays(recent, today) <= REVIEW_GRACE_DAYS ? recentYear : recentYear + 1;
}

/** The latest year that has started: the one ending at the next birthday. */
export function latestEndYear(b: Birthday, today: ISODate): number {
  const y = +today.slice(0, 4);
  return birthdayIn(b, y) <= today ? y + 1 : y;
}

/** The end year of the review year that holds a given date. */
export function endYearContaining(b: Birthday, date: ISODate): number {
  const y = +date.slice(0, 4);
  return date < birthdayIn(b, y) ? y : y + 1;
}

export const inWindow = (d: ISODate, w: { start: ISODate; end: ISODate }): boolean => d >= w.start && d < w.end;

/** The part of the year that has happened: [start, elapsedEnd). Equals `end` for a finished year. */
export function elapsedEnd(w: YearWindow, today: ISODate): ISODate {
  const tomorrow = addDays(today, 1);
  if (tomorrow <= w.start) return w.start;
  return tomorrow < w.end ? tomorrow : w.end;
}

export const elapsedDays = (w: YearWindow, today: ISODate): number => diffDays(w.start, elapsedEnd(w, today));
