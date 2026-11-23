import { describe, expect, it } from 'vitest';
import { covers, cycleLengths, kindIntervals, lags, markerTypes, mergeIntervals, overlap, phasesAt, readout, readoutClause, readoutText, sampleNote, stats, whereNow } from './analysis';
import { REFERENCE_TRACKS } from './reference';
import type { CycleEvent, EventKind, Phase, PhaseKind, Track } from './types';

const P = (id: string, start: number, end: number | null, kind: PhaseKind, name = id): Phase => ({ id, name, start, end, kind, source: 'test' });
const E = (id: string, year: number, kind: EventKind, label = id): CycleEvent => ({ id, year, kind, label, source: 'test' });
const T = (id: string, phases: Phase[], events: CycleEvent[] = []): Track => ({ id, name: id, author: 'me', group: 'own', color: 0, phases, events });
const ref = (id: string): Track => REFERENCE_TRACKS.find((t) => t.id === id) as Track;

describe('stats', () => {
  it('gives mean, range and sample sd', () => {
    const s = stats([34, 44, 56]);
    expect(s).toMatchObject({ n: 3, min: 34, max: 56 });
    expect(s?.mean).toBeCloseTo(44.667, 3);
    // deviations -10.667, -0.667, 11.333 -> squares sum 242.667 -> /2 = 121.333 -> sqrt 11.015
    expect(s?.sd).toBeCloseTo(11.015, 3);
  });
  it('has no spread for a single value and nothing for none', () => {
    expect(stats([7])).toEqual({ n: 1, mean: 7, min: 7, max: 7, sd: null });
    expect(stats([])).toBeNull();
  });
});

describe('phasesAt', () => {
  const t = T('a', [P('x', 1900, 1910, 'expansion'), P('y', 1910, 1925, 'contraction'), P('z', 1920, null, 'expansion')]);
  it('treats the end year as belonging to the next phase', () => {
    expect(phasesAt(t, 1909, 2026).map((p) => p.id)).toEqual(['x']);
    expect(phasesAt(t, 1910, 2026).map((p) => p.id)).toEqual(['y']);
    expect(phasesAt(t, 1899, 2026)).toEqual([]);
  });
  it('returns every overlapping phase, earliest first', () => {
    expect(phasesAt(t, 1922, 2026).map((p) => p.id)).toEqual(['y', 'z']);
  });
  it('lets an open phase cover the current year but not the future', () => {
    expect(covers(t.phases[2], 2026, 2026)).toBe(true);
    expect(covers(t.phases[2], 2027, 2026)).toBe(false);
  });
});

describe('readout', () => {
  const tracks = REFERENCE_TRACKS;
  const rows = readout(tracks, 1973, 2026);
  const row = (id: string) => rows.find((r) => r.trackId === id)!;

  it('reads across every track for 1973', () => {
    // Perez: 4th deployment 1943-74 and 5th installation 1971-2001 overlap in 1973.
    expect(row('ref-perez').phases.map((p) => p.phase.id)).toEqual(['pz4d', 'pz5i']);
    expect(row('ref-perez').phases[0]).toMatchObject({ yearsIn: 30, length: 31 });
    expect(row('ref-perez').phases[1]).toMatchObject({ yearsIn: 2, length: 30 });
    // Commodities: 1973 is the end of the 1971-73 upswing, so it is the first year of the downswing, and the peak year.
    expect(row('ref-commodities').phases.map((p) => p.phase.id)).toEqual(['s3d']);
    expect(row('ref-commodities').events.map((e) => e.id)).toEqual(['sp3']);
    // Oil: the embargo is that year; nothing else within two years (1979 is six away).
    expect(row('ref-oil').events.map((e) => e.id)).toEqual(['o2']);
    expect(row('ref-oil').near).toEqual([]);
    // Context: floating since 1971, with the Nixon shock two years earlier.
    expect(row('ref-context').phases[0].phase.id).toBe('m6');
    expect(row('ref-context').near.map((n) => [n.event.id, n.offset])).toEqual([['w9', -2]]);
  });

  it('rounds a fractional cursor year', () => {
    expect(readout(tracks, 1972.6, 2026).find((r) => r.trackId === 'ref-oil')?.events.map((e) => e.id)).toEqual(['o2']);
  });

  it('orders nearby events nearest first, earlier before later on a tie', () => {
    const t = T('t', [], [E('a', 1998, 'crisis'), E('b', 2002, 'crisis'), E('c', 2001, 'crisis'), E('d', 2003, 'crisis')]);
    expect(readout([t], 2000, 2026)[0].near.map((n) => n.event.id)).toEqual(['c', 'a', 'b']);
  });

  it('writes a sentence', () => {
    const t = T('Mine', [P('p', 1970, 1980, 'turning', 'Stall'), P('q', 2020, null, 'expansion', 'Boom')], [E('e', 1973, 'peak', 'Top'), E('f', 1974, 'shock', 'Jolt')]);
    expect(readoutClause(readout([t], 1973, 2026)[0])).toBe('Stall (turning point, year 4 of 10); Top this year; Jolt 1 year later');
    expect(readoutClause(readout([t], 2021, 2026)[0])).toBe('Boom (expansion, 1 year in, still open)');
    expect(readoutText(readout([t], 1973, 2026), 1973)).toBe('In 1973: Mine (me): Stall (turning point, year 4 of 10); Top this year; Jolt 1 year later.');
    expect(readoutText(readout([t], 1950, 2026), 1950)).toBe('In 1950: nothing dated on the visible tracks.');
  });
});

describe('overlap', () => {
  it('merges intervals that touch or overlap', () => {
    expect(mergeIntervals([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 7, end: 9 }, { start: 2, end: 2 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 9 },
    ]);
  });

  const a = T('a', [P('a1', 1900, 1920, 'expansion'), P('a2', 1920, 1930, 'contraction'), P('a3', 1930, 1950, 'expansion')]);
  const b = T('b', [P('b1', 1910, 1925, 'expansion'), P('b2', 1925, 1940, 'contraction'), P('b3', 1945, 1960, 'expansion')]);

  it('counts years by kind pair', () => {
    const o = overlap(a, b, 2026);
    // A covers 1900-1950, B covers 1910-1940 and 1945-1960 -> common = 30 + 5.
    expect(o.common).toBe(35);
    const cell = (ka: PhaseKind, kb: PhaseKind) => o.cells.find((c) => c.kindA === ka && c.kindB === kb);
    // exp/exp: 1910-1920 (a1,b1) and 1945-1950 (a3,b3) = 15
    expect(cell('expansion', 'expansion')).toMatchObject({ years: 15, intervals: [{ start: 1910, end: 1920 }, { start: 1945, end: 1950 }] });
    // con/con: 1925-1930 = 5
    expect(cell('contraction', 'contraction')).toMatchObject({ years: 5, intervals: [{ start: 1925, end: 1930 }] });
    // A contraction with B expansion: 1920-1925 = 5; A expansion with B contraction: 1930-1940 = 10
    expect(cell('contraction', 'expansion')?.years).toBe(5);
    expect(cell('expansion', 'contraction')?.years).toBe(10);
    expect(o.sameKind).toBe(20);
    expect(o.cells.reduce((s, c) => s + c.years, 0)).toBe(35);
    expect(o.cells[0]).toMatchObject({ kindA: 'expansion', kindB: 'expansion' });
  });

  it('gives phases that only touch no shared time', () => {
    const o = overlap(T('x', [P('x1', 1900, 1910, 'peak')]), T('y', [P('y1', 1910, 1920, 'peak')]), 2026);
    expect(o).toEqual({ common: 0, sameKind: 0, cells: [] });
  });

  it('clips to a window and runs open phases to the current year', () => {
    const x = T('x', [P('x1', 2000, null, 'expansion')]);
    const y = T('y', [P('y1', 1990, null, 'expansion')]);
    expect(overlap(x, y, 2026).sameKind).toBe(26);
    expect(overlap(x, y, 2026, { start: 2010, end: 2015 }).sameKind).toBe(5);
    expect(kindIntervals(x, 2026, { start: 1900, end: 1950 }).size).toBe(0);
  });

  it('does not double count same-kind years when a track overlaps itself', () => {
    const x = T('x', [P('x1', 1900, 1920, 'expansion'), P('x2', 1910, 1930, 'expansion')]);
    const y = T('y', [P('y1', 1905, 1925, 'expansion')]);
    expect(overlap(x, y, 2026).sameKind).toBe(20);
  });

  it('on the built-in set: Kondratiev downswings against commodity downswings', () => {
    const o = overlap(ref('ref-kondratiev'), ref('ref-commodities'), 2026);
    const c = o.cells.find((x) => x.kindA === 'contraction' && x.kindB === 'contraction')!;
    // K: 1815-48, 1873-93, 1917-45, 1971-88, 2008-now. Commodities: 1917-32, 1951-71, 1973-99, 2010-now.
    // 1917-32 (15) + 1973-88 (15) + 2010-2026 (16) = 46
    expect(c.intervals).toEqual([{ start: 1917, end: 1932 }, { start: 1973, end: 1988 }, { start: 2010, end: 2026 }]);
    expect(c.years).toBe(46);
  });
});

describe('lags', () => {
  const a = T('a', [], [E('a1', 1900, 'peak'), E('a2', 1950, 'peak'), E('a3', 2000, 'peak'), E('ax', 1960, 'trough')]);
  const b = T('b', [P('b1', 1912, 1930, 'contraction'), P('b2', 1945, 1970, 'contraction'), P('b3', 1975, 1990, 'expansion')], [E('bx', 1901, 'peak')]);

  it('pairs each marker with the nearest of the chosen type', () => {
    const r = lags(a, 'event:peak', b, 'start:contraction');
    // 1900 -> 1912 (+12); 1950 -> 1945 (-5); 2000 -> 1945 (-55)
    expect(r.pairs.map((p) => [p.from.year, p.to.year, p.lag])).toEqual([[1900, 1912, 12], [1950, 1945, -5], [2000, 1945, -55]]);
    expect(r.stats).toMatchObject({ n: 3, min: -55, max: 12 });
    expect(r.stats?.mean).toBeCloseTo(-16, 6);
    // deviations 28, 11, -39 -> 784 + 121 + 1521 = 2426 -> /2 = 1213 -> sqrt 34.828
    expect(r.stats?.sd).toBeCloseTo(34.828, 3);
    expect(r.reused).toBe(1);
  });

  it('drops matches outside the window and reports them', () => {
    const r = lags(a, 'event:peak', b, 'start:contraction', 20);
    expect(r.pairs.map((p) => p.lag)).toEqual([12, -5]);
    expect(r.unmatched.map((m) => m.itemId)).toEqual(['a3']);
    expect(r.stats?.mean).toBeCloseTo(3.5, 6);
    expect(r.reused).toBe(0);
  });

  it('breaks a tie towards the later marker', () => {
    const x = T('x', [], [E('x1', 1950, 'peak')]);
    const y = T('y', [], [E('y1', 1940, 'peak'), E('y2', 1960, 'peak')]);
    expect(lags(x, 'event:peak', y, 'event:peak').pairs[0].lag).toBe(10);
  });

  it('handles a type that does not occur', () => {
    const r = lags(a, 'event:peak', b, 'event:shock');
    expect(r.pairs).toEqual([]);
    expect(r.stats).toBeNull();
    expect(r.unmatched).toHaveLength(3);
    expect(lags(a, 'event:crisis', b, 'event:peak')).toMatchObject({ pairs: [], unmatched: [] });
  });

  it('on the built-in set: Perez big-bangs against the nearest Kondratiev peak', () => {
    const r = lags(ref('ref-perez'), 'event:start', ref('ref-kondratiev'), 'event:peak');
    // 1771 -> 1815 (+44), 1829 -> 1815 (-14), 1875 -> 1873 (-2), 1908 -> 1917 (+9), 1971 -> 1971 (0)
    expect(r.pairs.map((p) => p.lag)).toEqual([44, -14, -2, 9, 0]);
    expect(r.stats?.mean).toBeCloseTo(7.4, 6);
    expect(r.reused).toBe(1);
  });

  it('lists marker types with counts', () => {
    expect(markerTypes(b)).toEqual([{ type: 'start:contraction', count: 2 }, { type: 'event:peak', count: 1 }, { type: 'start:expansion', count: 1 }]);
  });
});

describe('cycleLengths', () => {
  it('measures peak to peak and start to start on the commodity track', () => {
    const c = cycleLengths(ref('ref-commodities'));
    const peak = c.find((x) => x.type === 'event:peak')!;
    // 1917, 1951, 1973, 2010 -> 34, 22, 37
    expect(peak.gaps).toEqual([34, 22, 37]);
    expect(peak.stats).toMatchObject({ n: 3, min: 22, max: 37 });
    expect(peak.stats.mean).toBeCloseTo(31, 6);
    const start = c.find((x) => x.type === 'start:expansion')!;
    // 1894, 1932, 1971, 1999 -> 38, 39, 28
    expect(start.gaps).toEqual([38, 39, 28]);
    expect(start.stats.mean).toBeCloseTo(35, 6);
  });
  it('measures big-bang to big-bang for Perez', () => {
    const c = cycleLengths(ref('ref-perez')).find((x) => x.type === 'event:start')!;
    expect(c.gaps).toEqual([58, 46, 33, 63]);
    expect(c.stats.mean).toBeCloseTo(50, 6);
  });
  it('needs at least two markers of a type', () => {
    expect(cycleLengths(T('t', [P('a', 1900, 1910, 'expansion')], [E('e', 1905, 'peak')]))).toEqual([]);
  });
});

describe('whereNow', () => {
  it('compares the open phase with earlier completed ones of the same kind', () => {
    const r = whereNow(ref('ref-commodities'), 2026);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.phase.id).toBe('s4d');
    expect(row.yearsIn).toBe(16);
    // earlier downswings: 1917-32 (15), 1951-71 (20), 1973-99 (26)
    expect(row.history).toMatchObject({ n: 3, min: 15, max: 26 });
    expect(row.history?.mean).toBeCloseTo(20.333, 3);
    expect(row.ratio).toBeCloseTo(16 / 20.3333, 3);
    expect(row.against).toBe('within');
  });
  it('says when the current phase has outrun every earlier one', () => {
    const row = whereNow(ref('ref-perez'), 2026).rows[0];
    expect(row.phase.id).toBe('pz5t');
    expect(row.yearsIn).toBe(25);
    // earlier turning points: 5, 2, 2, 14 years
    expect(row.history).toMatchObject({ n: 4, min: 2, max: 14 });
    expect(row.against).toBe('longer');
  });
  it('has no history for a first-of-its-kind phase and no rows when nothing is current', () => {
    const t = T('t', [P('a', 1990, 2000, 'expansion'), P('b', 2020, null, 'trough')]);
    expect(whereNow(t, 2026).rows[0]).toMatchObject({ yearsIn: 6, history: null, ratio: null, against: null });
    expect(whereNow(t, 2010).rows).toEqual([]);
    expect(whereNow(ref('ref-oil'), 2026).rows).toEqual([]);
  });
  it('ignores phases that end in the future when building history', () => {
    const t = T('t', [P('a', 1990, 2000, 'expansion'), P('b', 2020, 2040, 'expansion'), P('c', 2022, null, 'expansion')]);
    const row = whereNow(t, 2026).rows.find((r) => r.phase.id === 'c')!;
    expect(row.history).toMatchObject({ n: 1, mean: 10 });
    expect(row.against).toBe('shorter');
  });
});

describe('sampleNote', () => {
  it('always states n and warns', () => {
    expect(sampleNote(1)).toContain('n = 1');
    expect(sampleNote(4)).toBe('n = 4: far too few to generalise');
    expect(sampleNote(12)).toContain('small sample');
  });
});

describe('the built-in reference set', () => {
  it('has unique ids, sources on every item and sane dates', () => {
    const ids = new Set<string>();
    for (const t of REFERENCE_TRACKS) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      const seen = new Set<string>();
      for (const p of t.phases) {
        expect(seen.has(p.id)).toBe(false);
        seen.add(p.id);
        expect(p.source.length).toBeGreaterThan(5);
        expect(p.start).toBeGreaterThanOrEqual(1770);
        if (p.end !== null) expect(p.end).toBeGreaterThan(p.start);
        if (p.approximate) expect(p.note, `${p.id} is approximate and should say why`).toBeTruthy();
      }
      for (const e of t.events) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
        expect(e.source.length).toBeGreaterThan(5);
        expect(e.year).toBeGreaterThanOrEqual(1770);
        expect(e.year).toBeLessThanOrEqual(2026);
      }
    }
  });
  it('keeps the Perez big-bang years', () => {
    expect(ref('ref-perez').events.map((e) => e.year)).toEqual([1771, 1829, 1875, 1908, 1971]);
  });
  it('has at most one open phase per track', () => {
    for (const t of REFERENCE_TRACKS) expect(t.phases.filter((p) => p.end === null).length).toBeLessThanOrEqual(1);
  });
});
