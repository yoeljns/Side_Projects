import { describe, expect, it } from 'vitest';
import { cellMinutes, entriesCsv, nextColor, setCellMinutes, slugId, DEFAULT_CATEGORIES, type Entry } from './model';

const D = '2026-11-18';
const entries: Entry[] = [
  { id: 'a', day: D, category: 'masters', minutes: 60, note: 'reading' },
  { id: 'b', day: D, category: 'company', minutes: 30 },
  { id: 'c', day: D, category: 'masters', minutes: 45 },
  { id: 'd', day: '2026-11-19', category: 'masters', minutes: 15 },
];

describe('cells', () => {
  it('totals one day and category', () => {
    expect(cellMinutes(entries, D, 'masters')).toBe(105);
    expect(cellMinutes(entries, D, 'builds')).toBe(0);
  });

  it('raises a cell by adding one entry for the difference', () => {
    const out = setCellMinutes(entries, D, 'masters', 150, 'new');
    expect(out).toHaveLength(5);
    expect(out[4]).toEqual({ id: 'new', day: D, category: 'masters', minutes: 45 });
    expect(cellMinutes(out, D, 'masters')).toBe(150);
  });

  it('lowers a cell by trimming the newest entry first', () => {
    // 105 → 90: the 45m entry loses 15, the 60m one with the note is untouched.
    const out = setCellMinutes(entries, D, 'masters', 90, 'x');
    expect(out.map((e) => [e.id, e.minutes])).toEqual([['a', 60], ['b', 30], ['c', 30], ['d', 15]]);
  });

  it('removes whole entries when it has to, and keeps order', () => {
    // 105 → 40: c (45) goes, a (60) is cut to 40.
    const out = setCellMinutes(entries, D, 'masters', 40, 'x');
    expect(out.map((e) => [e.id, e.minutes])).toEqual([['a', 40], ['b', 30], ['d', 15]]);
    expect(out[0].note).toBe('reading');
  });

  it('clears a cell at zero without touching other cells, and never goes negative', () => {
    expect(setCellMinutes(entries, D, 'masters', 0, 'x').map((e) => e.id)).toEqual(['b', 'd']);
    expect(setCellMinutes(entries, D, 'masters', -30, 'x').map((e) => e.id)).toEqual(['b', 'd']);
  });

  it('returns the same array when nothing changes', () => {
    expect(setCellMinutes(entries, D, 'masters', 105, 'x')).toBe(entries);
  });
});

describe('categories', () => {
  it('makes unique ids from labels', () => {
    expect(slugId('Deep Work', [])).toBe('deep-work');
    expect(slugId('Masters', ['masters'])).toBe('masters-2');
    expect(slugId('Masters', ['masters', 'masters-2'])).toBe('masters-3');
    expect(slugId('  !!  ', [])).toBe('category');
  });

  it('offers the least used colour', () => {
    expect(nextColor(DEFAULT_CATEGORIES)).toBe(4);
    expect(nextColor([{ id: 'a', label: 'A', color: 1 }])).toBe(0);
    // Archived categories free their colour.
    expect(nextColor(DEFAULT_CATEGORIES.map((c) => (c.id === 'masters' ? { ...c, archived: true } : c)))).toBe(1);
  });
});

describe('csv', () => {
  it('sorts by day, uses labels and quotes awkward notes', () => {
    const csv = entriesCsv(
      [
        { id: '1', day: '2026-11-19', category: 'masters', minutes: 90, note: 'ch. 3, "methods"' },
        { id: '2', day: '2026-11-18', category: 'company', minutes: 45 },
        { id: '3', day: '2026-11-18', category: 'gone', minutes: 20, note: 'plain' },
      ],
      DEFAULT_CATEGORIES,
    );
    expect(csv).toBe(
      'day,category,minutes,hours,note\r\n' +
        '2026-11-18,Company,45,0.75,\r\n' +
        '2026-11-18,gone,20,0.33,plain\r\n' +
        '2026-11-19,Masters,90,1.50,"ch. 3, ""methods"""\r\n',
    );
  });

  it('is just the header with no entries', () => {
    expect(entriesCsv([], DEFAULT_CATEGORIES)).toBe('day,category,minutes,hours,note\r\n');
  });
});
