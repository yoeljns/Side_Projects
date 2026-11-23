import { describe, expect, it } from 'vitest';
import { addDays, diffDays, isDate, monthsIn, weekStart } from './dates';
import { birthdayIn, defaultEndYear, endYearContaining, elapsedDays, elapsedEnd, inWindow, isBirthday, latestEndYear, yearWindow } from './window';

describe('dates', () => {
  it('validates real calendar days only', () => {
    expect(isDate('2024-02-29')).toBe(true);
    expect(isDate('2025-02-29')).toBe(false);
    expect(isDate('2025-13-01')).toBe(false);
    expect(isDate('2025-3-01')).toBe(false);
    expect(isDate(20250301)).toBe(false);
  });
  it('adds and subtracts across leap days and year ends', () => {
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(diffDays('2024-01-01', '2025-01-01')).toBe(366);
    expect(diffDays('2025-03-10', '2025-03-09')).toBe(-1);
  });
  it('finds the Monday of a week', () => {
    expect(weekStart('2025-03-10')).toBe('2025-03-10'); // a Monday
    expect(weekStart('2025-03-16')).toBe('2025-03-10'); // the Sunday after
    expect(weekStart('2026-01-01')).toBe('2025-12-29'); // a Thursday
  });
  it('lists the months a range touches', () => {
    expect(monthsIn('2025-11-20', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(monthsIn('2025-03-10', '2026-03-10')).toHaveLength(13);
    expect(monthsIn('2025-03-01', '2026-03-01')).toHaveLength(12);
    expect(monthsIn('2025-03-10', '2025-03-10')).toEqual([]);
  });
});

describe('year window', () => {
  it('runs from one birthday up to the day before the next', () => {
    const w = yearWindow({ month: 3, day: 10 }, 2026);
    expect(w).toEqual({ endYear: 2026, key: '2026', start: '2025-03-10', end: '2026-03-10', last: '2026-03-09', days: 365 });
    expect(inWindow('2025-03-10', w)).toBe(true);
    expect(inWindow('2025-03-09', w)).toBe(false);
    expect(inWindow('2026-03-09', w)).toBe(true);
    expect(inWindow('2026-03-10', w)).toBe(false);
  });
  it('has 366 days when it contains a 29 February', () => {
    expect(yearWindow({ month: 3, day: 10 }, 2024).days).toBe(366); // 10 Mar 2023 to 9 Mar 2024 holds 29 Feb 2024
    expect(yearWindow({ month: 3, day: 10 }, 2024).start).toBe('2023-03-10');
    expect(diffDays('2023-03-10', '2024-03-10')).toBe(366);
  });
  it('crosses the calendar year for a January birthday', () => {
    const w = yearWindow({ month: 1, day: 1 }, 2026);
    expect([w.start, w.last, w.days]).toEqual(['2025-01-01', '2025-12-31', 365]);
    const dec = yearWindow({ month: 12, day: 31 }, 2025);
    expect([dec.start, dec.last, dec.days]).toEqual(['2024-12-31', '2025-12-30', 365]);
  });
  it('observes a 29 February birthday on 1 March in other years', () => {
    const b = { month: 2, day: 29 };
    expect(birthdayIn(b, 2024)).toBe('2024-02-29');
    expect(birthdayIn(b, 2025)).toBe('2025-03-01');
    expect(birthdayIn(b, 2100)).toBe('2100-03-01'); // 2100 is not a leap year
    expect(birthdayIn(b, 2000)).toBe('2000-02-29');
    // 29 Feb 2024 to 28 Feb 2025: 366 days. 1 Mar 2025 to 28 Feb 2026: 365. 1 Mar 2027 to 28 Feb 2028: 365.
    expect(yearWindow(b, 2025)).toMatchObject({ start: '2024-02-29', end: '2025-03-01', last: '2025-02-28', days: 366 });
    expect(yearWindow(b, 2026)).toMatchObject({ start: '2025-03-01', end: '2026-03-01', days: 365 });
    expect(yearWindow(b, 2028)).toMatchObject({ start: '2027-03-01', end: '2028-02-29', last: '2028-02-28', days: 365 });
    expect(yearWindow(b, 2029)).toMatchObject({ start: '2028-02-29', end: '2029-03-01', days: 366 });
  });
  it('leaves no gap and no overlap between consecutive years', () => {
    for (const b of [{ month: 2, day: 29 }, { month: 3, day: 10 }, { month: 12, day: 31 }]) {
      for (let y = 2020; y < 2032; y++) expect(yearWindow(b, y).end).toBe(yearWindow(b, y + 1).start);
    }
  });
  it('rejects impossible birthdays', () => {
    expect(isBirthday({ month: 2, day: 29 })).toBe(true);
    expect(isBirthday({ month: 2, day: 30 })).toBe(false);
    expect(isBirthday({ month: 4, day: 31 })).toBe(false);
    expect(isBirthday({ month: 0, day: 1 })).toBe(false);
    expect(isBirthday(null)).toBe(false);
  });
});

describe('which year to open on', () => {
  const b = { month: 3, day: 10 };
  it('offers the year that just closed for 45 days after the birthday', () => {
    expect(defaultEndYear(b, '2026-03-10')).toBe(2026); // the birthday itself
    expect(defaultEndYear(b, '2026-04-24')).toBe(2026); // day 45
    expect(defaultEndYear(b, '2026-04-25')).toBe(2027); // day 46
  });
  it('otherwise offers the year in progress', () => {
    expect(defaultEndYear(b, '2026-11-23')).toBe(2027);
    expect(defaultEndYear(b, '2026-03-09')).toBe(2026); // the day before the birthday: still inside the 2026 year
    expect(defaultEndYear(b, '2026-01-02')).toBe(2026);
  });
  it('handles a birthday late in December', () => {
    expect(defaultEndYear({ month: 12, day: 20 }, '2026-01-15')).toBe(2025); // 26 days after 20 Dec 2025
    expect(defaultEndYear({ month: 12, day: 20 }, '2026-02-10')).toBe(2026);
  });
  it('knows the latest year that has started', () => {
    expect(latestEndYear(b, '2026-03-09')).toBe(2026);
    expect(latestEndYear(b, '2026-03-10')).toBe(2027);
  });
  it('finds the year a date belongs to', () => {
    expect(endYearContaining(b, '2024-01-05')).toBe(2024);
    expect(endYearContaining(b, '2024-03-09')).toBe(2024);
    expect(endYearContaining(b, '2024-03-10')).toBe(2025);
    expect(endYearContaining({ month: 2, day: 29 }, '2025-02-28')).toBe(2025);
    expect(endYearContaining({ month: 2, day: 29 }, '2025-03-01')).toBe(2026);
    for (const d of ['2023-12-31', '2024-02-29', '2025-03-01', '2026-07-04']) {
      const w = yearWindow({ month: 2, day: 29 }, endYearContaining({ month: 2, day: 29 }, d));
      expect(inWindow(d, w)).toBe(true);
    }
  });
  it('measures how much of a year has happened', () => {
    const w = yearWindow(b, 2027); // 10 Mar 2026 to 9 Mar 2027
    expect(elapsedEnd(w, '2026-11-23')).toBe('2026-11-24');
    expect(elapsedDays(w, '2026-11-23')).toBe(259);
    expect(elapsedDays(w, '2026-03-10')).toBe(1);
    expect(elapsedDays(w, '2026-03-09')).toBe(0);
    expect(elapsedDays(w, '2025-01-01')).toBe(0);
    expect(elapsedDays(w, '2027-03-09')).toBe(365);
    expect(elapsedDays(w, '2030-01-01')).toBe(365);
  });
});
