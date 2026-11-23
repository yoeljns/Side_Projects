import { describe, expect, it } from 'vitest';
import { addDays, coerceDate, daysBetween, isIsoDate, isoWeek, isoWeekMonday, weeksBetween } from '../src/dates.js';
import { fold, rawTokens, stem, stems, terms } from '../src/text.js';

describe('dates', () => {
  it('labels ISO weeks, including the year boundaries', () => {
    expect(isoWeek('2026-11-23')).toBe('2026-W48'); // Monday
    expect(isoWeek('2026-11-29')).toBe('2026-W48'); // Sunday of the same week
    expect(isoWeek('2026-01-01')).toBe('2026-W01'); // a Thursday, so week 1
    expect(isoWeek('2027-01-01')).toBe('2026-W53'); // Friday: still the last week of 2026
    expect(isoWeek('2024-12-30')).toBe('2025-W01'); // Monday of the week that holds 2 January 2025
    expect(isoWeek('2021-01-03')).toBe('2020-W53');
  });

  it('finds the Monday of a week and rejects weeks that do not exist', () => {
    expect(isoWeekMonday('2026-W48')).toBe('2026-11-23');
    expect(isoWeekMonday('2026-W01')).toBe('2025-12-29');
    expect(isoWeekMonday('2025-W53')).toBeNull(); // 2025 has 52 weeks
    expect(isoWeekMonday('2026-48')).toBeNull();
  });

  it('does day and week arithmetic in UTC', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(daysBetween('2024-02-18', '2026-11-23')).toBe(1009);
    expect(weeksBetween('2026-W48', '2027-W02')).toBe(7); // 2026 has 53 weeks
    expect(weeksBetween('2026-W48', '2026-W48')).toBe(0);
  });

  it('accepts only real dates', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(coerceDate('2024-05-06T10:00:00+03:00')).toBe('2024-05-06');
    expect(coerceDate('2024-05-06 10:00')).toBe('2024-05-06');
    expect(coerceDate('{{date}}')).toBeNull();
    expect(coerceDate(20240506)).toBeNull();
  });
});

describe('text', () => {
  it('folds case and diacritics so Turkish and keyboard-English spellings meet', () => {
    expect(fold('İstanbul')).toBe('istanbul');
    expect(fold('Istanbul')).toBe('istanbul');
    expect(fold('IŞIK')).toBe('isik');
    expect(fold('ışık')).toBe('isik');
    expect(fold('Döngü')).toBe(fold('dongu'));
    expect(fold('Borç')).toBe('borc');
  });

  it('stems English plurals only', () => {
    expect(stem('cycles')).toBe('cycle');
    expect(stem('economies')).toBe('economy');
    expect(stem('prices')).toBe('price');
    expect(stem('debts')).toBe('debt');
    expect(stem('crisis')).toBe('crisis');
    expect(stem('status')).toBe('status');
    expect(stem('boss')).toBe('boss');
    expect(stem('gas')).toBe('gas'); // three letters: left alone
    expect(stem('dongu')).toBe('dongu');
  });

  it('drops stop words in both languages, short numbers and apostrophe suffixes', () => {
    expect(stems("The neighbour's envy and the cycles of 2008, 12 times")).toEqual(['neighbour', 'envy', 'cycle', '2008', 'time']);
    // Turkish 'not' (a note) collides with the English stop word and is dropped: one cost of a shared list.
    expect(stems("Minsky'nin borç döngüsü ve kredi için bir not")).toEqual(['minsky', 'borc', 'dongusu', 'kredi']);
  });

  it('keeps offsets and the spelling as written', () => {
    const toks = rawTokens('Borç döngüsü');
    expect(toks.map((t) => [t.t, t.start, t.end])).toEqual([
      ['borc', 0, 4],
      ['dongusu', 5, 12],
    ]);
    expect(terms('IŞIK ve Gölge').map((t) => t.surface)).toEqual(['ışık', 'gölge']);
    expect(terms('Inflation').map((t) => t.surface)).toEqual(['inflation']);
  });
});
