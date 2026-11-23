import { describe, expect, it } from 'vitest';
import { addDays, diffDays, fmtDur, fmtHours, fmtPeriod, fmtWeekRange, isDay, isoWeek, localDay, monthKey, quarterKey, weekDays, weekStart, weekdayIndex } from './dates';

describe('dates', () => {
  it('validates day strings', () => {
    expect(isDay('2026-11-23')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-2-3')).toBe(false);
    expect(isDay('monday')).toBe(false);
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-11-23', '2026-11-16')).toBe(7);
  });

  it('runs weeks Monday to Sunday', () => {
    // 23 Nov 2026 is a Monday.
    expect(weekdayIndex('2026-11-23')).toBe(0);
    expect(weekdayIndex('2026-11-22')).toBe(6);
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-11-19')).toBe('2026-11-16');
    expect(weekDays('2026-11-16')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  });

  it('numbers ISO weeks, including the awkward year ends', () => {
    expect(isoWeek('2026-11-22')).toEqual({ year: 2026, week: 47 });
    expect(isoWeek('2026-11-23')).toEqual({ year: 2026, week: 48 });
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 }); // a Thursday
    expect(isoWeek('2025-12-29')).toEqual({ year: 2026, week: 1 }); // the Monday of that week
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 }); // a Friday
    expect(isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 });
    expect(isoWeek('2021-01-03')).toEqual({ year: 2020, week: 53 });
  });

  it('reads the calendar date from the local parts of a Date', () => {
    expect(localDay(new Date(2026, 10, 23, 0, 5))).toBe('2026-11-23');
    expect(localDay(new Date(2026, 10, 22, 23, 55))).toBe('2026-11-22');
    expect(localDay(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });

  it('keys months and quarters', () => {
    expect(monthKey('2026-11-23')).toBe('2026-11');
    expect(quarterKey('2026-01-01')).toBe('2026-Q1');
    expect(quarterKey('2026-03-31')).toBe('2026-Q1');
    expect(quarterKey('2026-04-01')).toBe('2026-Q2');
    expect(quarterKey('2026-12-31')).toBe('2026-Q4');
    expect(fmtPeriod('2026-11')).toBe('Nov 2026');
    expect(fmtPeriod('2026-Q4')).toBe('Q4 2026');
  });

  it('formats week ranges', () => {
    expect(fmtWeekRange('2026-11-16')).toBe('16–22 Nov 2026');
    expect(fmtWeekRange('2026-11-30')).toBe('30 Nov – 6 Dec 2026');
    expect(fmtWeekRange('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027');
  });

  it('formats durations', () => {
    expect(fmtDur(0)).toBe('0m');
    expect(fmtDur(45)).toBe('45m');
    expect(fmtDur(60)).toBe('1h');
    expect(fmtDur(390)).toBe('6h 30m');
    expect(fmtDur(-210)).toBe('3h 30m');
    expect(fmtDur(1650)).toBe('27h 30m');
    expect(fmtHours(90)).toBe('1.5');
    expect(fmtHours(600)).toBe('10');
    expect(fmtHours(50)).toBe('0.8');
  });
});
