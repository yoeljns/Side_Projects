import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, formatDate, isDate, localDay, relativeDay, REVIEW_PRESETS } from './dates';

describe('dates', () => {
  it('accepts only real calendar days', () => {
    expect(isDate('2026-02-28')).toBe(true);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('2026-1-1')).toBe(false);
    expect(isDate('')).toBe(false);
    expect(isDate(undefined)).toBe(false);
  });

  it('adds days across months, years and clock changes', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    // UK clocks go forward on 29 March 2026 and back on 25 October 2026
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31');
  });

  it('counts days between dates', () => {
    expect(diffDays('2026-01-01', '2026-01-01')).toBe(0);
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2026-02-01', '2026-01-25')).toBe(-7);
  });

  it('adds months, clamping to the end of a shorter month', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-08-31', 3)).toBe('2026-11-30');
    expect(addMonths('2026-11-23', 3)).toBe('2027-02-23');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('review presets', () => {
    const from = '2026-11-30';
    expect(REVIEW_PRESETS.map((p) => [p.label, p.from(from)])).toEqual([
      ['1 week', '2026-12-07'],
      ['1 month', '2026-12-30'],
      ['3 months', '2027-02-28'],
      ['6 months', '2027-05-30'],
      ['1 year', '2027-11-30'],
    ]);
  });

  it('formats for reading', () => {
    expect(formatDate('2026-03-05')).toBe('5 Mar 2026');
    expect(relativeDay('2026-03-05', '2026-03-05')).toBe('today');
    expect(relativeDay('2026-03-06', '2026-03-05')).toBe('in 1 day');
    expect(relativeDay('2026-02-21', '2026-03-05')).toBe('12 days ago');
  });

  it('takes the local calendar day from a Date', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
