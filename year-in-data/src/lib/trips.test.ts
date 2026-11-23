import { describe, expect, it } from 'vitest';
import raw from '../../test/fixtures/two-city.json?raw';
import { matchStats } from './matches';
import { parseTwoCity } from './sources';
import { cityName, dayPlaces, tripStats } from './trips';
import type { Stay } from './types';
import { yearWindow } from './window';

const stay = (city: string, country: string, arrive: string, depart: string | null): Stay => ({ id: `${city}-${arrive}`, city, country, arrive, depart });
const W = yearWindow({ month: 3, day: 10 }, 2026); // 10 Mar 2025 to 9 Mar 2026
const AFTER = '2026-11-23';

describe('nights by place', () => {
  it('counts the nights arrive <= night < depart', () => {
    const days = dayPlaces([stay('London', 'GB', '2025-03-10', '2025-03-13')], '2025-03-09', '2025-03-15', AFTER);
    expect(days.map((d) => d.bucket)).toEqual(['unrecorded', 'london', 'london', 'london', 'unrecorded', 'unrecorded']);
  });
  it('clips stays that straddle either end of the year', () => {
    const t = tripStats([stay('Istanbul', 'TR', '2025-02-20', '2025-03-20'), stay('London', 'GB', '2025-03-20', '2026-03-01'), stay('Istanbul', 'TR', '2026-03-01', '2026-05-01')], W, AFTER);
    // Istanbul: 10-19 Mar 2025 (10 nights) + 1-9 Mar 2026 (9 nights). London: the other 346.
    expect(t.buckets).toEqual({ london: 346, istanbul: 19, elsewhere: 0, unrecorded: 0 });
    expect(t.nights).toBe(365);
    expect(t.moves).toBe(2);
    expect(t.longest).toMatchObject({ city: 'london', nights: 346, from: '2025-03-20', to: '2026-03-01' });
    expect(t.runs[0]).toMatchObject({ city: 'istanbul', from: '2025-03-10', to: '2025-03-20', nights: 10 });
  });
  it('runs an open stay to today and stops the year there', () => {
    const w = yearWindow({ month: 3, day: 10 }, 2027);
    const t = tripStats([stay('london', 'GB', '2026-03-01', '2026-03-20'), stay('Istanbul', 'TR', '2026-03-20', null)], w, '2026-03-31');
    // 10-31 March is 22 nights so far: London 10-19 (10), Istanbul 20-31 (12).
    expect(t.nights).toBe(22);
    expect(t.buckets).toMatchObject({ london: 10, istanbul: 12, unrecorded: 0 });
    expect(t.months[0]).toEqual({ month: '2026-03', london: 10, istanbul: 12, elsewhere: 0, unrecorded: 0 });
  });
  it('lets the later arrival win where two stays overlap, and ignores case in city names', () => {
    const t = tripStats([stay('London', 'GB', '2025-03-10', '2025-03-30'), stay('PARIS', 'fr', '2025-03-15', '2025-03-18'), stay(' london ', 'GB', '2025-03-30', '2025-04-02')], W, AFTER);
    expect(t.byCity).toEqual([{ city: 'london', country: 'GB', nights: 20 }, { city: 'paris', country: 'FR', nights: 3 }]);
    expect(t.moves).toBe(2); // London to Paris and back; the second London stay is no move
    expect(t.away).toEqual([{ city: 'paris', country: 'FR', from: '2025-03-15', to: '2025-03-18', nights: 3 }]);
    expect(t.buckets.unrecorded).toBe(365 - 23);
  });
  it('does not count a move across an unrecorded gap in the same city, and does across a gap to another', () => {
    const t = tripStats([stay('London', 'GB', '2025-04-01', '2025-04-05'), stay('London', 'GB', '2025-04-10', '2025-04-12'), stay('Istanbul', 'TR', '2025-05-01', '2025-05-03')], W, AFTER);
    expect(t.moves).toBe(1);
    expect(t.runs.map((r) => r.nights)).toEqual([4, 2, 2]);
  });
  it('names new places only when there is an earlier record to compare with', () => {
    const inYear = [stay('London', 'GB', '2025-03-10', '2025-06-01'), stay('Lisbon', 'PT', '2025-06-01', '2025-06-05')];
    expect(tripStats(inYear, W, AFTER).newPlaces).toBeNull();
    expect(tripStats([stay('London', 'GB', '2024-01-01', '2025-03-10'), ...inYear], W, AFTER).newPlaces).toEqual(['lisbon']);
  });
  it('formats city keys for display', () => {
    expect(cityName('new york')).toBe('New York');
    expect(cityName('i̇zmir'.normalize())).toMatch(/zmir$/);
    expect(cityName('stratford-upon-avon')).toBe('Stratford-Upon-Avon');
  });
});

describe('the Two City fixture, 10 Mar 2025 to 9 Mar 2026', () => {
  const { data, dropped } = parseTwoCity(JSON.parse(raw));
  const t = tripStats(data.stays, W, AFTER);
  it('reads every row', () => {
    expect(dropped).toBe(0);
    expect(data.stays).toHaveLength(15);
    expect(data.fixtures).toHaveLength(10);
  });
  it('adds up to the hand count', () => {
    // Istanbul 30 + 76 + 46 + 24, London 83 + 38 + 52, Lisbon 7, Tbilisi 5, gap 10-13 Feb 2026.
    expect(t.buckets).toEqual({ london: 173, istanbul: 176, elsewhere: 12, unrecorded: 4 });
    expect(t.byCountry).toEqual([{ country: 'TR', nights: 176 }, { country: 'GB', nights: 173 }, { country: 'PT', nights: 7 }, { country: 'GE', nights: 5 }]);
    expect(t.moves).toBe(8);
    expect(t.longest).toMatchObject({ city: 'london', nights: 83, from: '2025-04-09', to: '2025-07-01' });
    expect(t.newPlaces).toEqual(['lisbon', 'tbilisi']);
    expect(t.away.map((a) => [a.city, a.nights])).toEqual([['lisbon', 7], ['tbilisi', 5]]);
  });
  it('splits by month, with partial months at both ends', () => {
    expect(t.months).toHaveLength(13);
    expect(t.months[0]).toEqual({ month: '2025-03', london: 0, istanbul: 22, elsewhere: 0, unrecorded: 0 });
    expect(t.months[4]).toEqual({ month: '2025-07', london: 24, istanbul: 0, elsewhere: 7, unrecorded: 0 });
    expect(t.months[11]).toEqual({ month: '2026-02', london: 9, istanbul: 15, elsewhere: 0, unrecorded: 4 });
    expect(t.months[12]).toEqual({ month: '2026-03', london: 0, istanbul: 9, elsewhere: 0, unrecorded: 0 });
    expect(t.months.reduce((s, m) => s + m.london + m.istanbul + m.elsewhere + m.unrecorded, 0)).toBe(365);
  });
  it('counts only attended matches inside the year', () => {
    const m = matchStats(data.fixtures, W);
    // 9 Mar 2025 is the day before the year; 10 Mar 2026 is the next birthday; 2 Aug 2025 was not attended.
    expect([m.count, m.home, m.away]).toEqual([4, 3, 1]);
    expect(m.list.map((f) => f.date)).toEqual(['2025-04-12', '2025-05-03', '2025-12-27', '2026-01-17']);
    expect(m.first?.opponent).toBe('Northbridge Rovers');
    expect(m.last?.opponent).toBe('Westvale Athletic');
    expect(m.byCompetition).toEqual([{ competition: 'League', count: 3 }, { competition: 'Cup', count: 1 }]);
  });
  it('has nothing for a year with no attended matches', () => {
    const m = matchStats(data.fixtures, yearWindow({ month: 3, day: 10 }, 2023));
    expect(m).toMatchObject({ count: 0, first: null, last: null, list: [] });
  });
});
