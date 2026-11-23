import { describe, expect, it } from 'vitest';
import decisionsRaw from '../../test/fixtures/decision-journal.json?raw';
import hoursRaw from '../../test/fixtures/hours-ledger.json?raw';
import { decisionStats, squaredError } from './decisions';
import { hoursStats } from './hours';
import { parseDecisions, parseHours, parseSource, parseTwoCity, sourceCount } from './sources';
import type { Decision, HoursEntry } from './types';
import { yearWindow } from './window';

const B = { month: 3, day: 10 };
const W = yearWindow(B, 2026); // Monday 10 Mar 2025 to Monday 9 Mar 2026

describe('hours', () => {
  const e = (day: string, category: string, minutes: number): HoursEntry => ({ id: `${day}-${category}`, day, category, minutes });
  const entries = [
    e('2025-03-09', 'company', 999), // the day before the year
    e('2025-03-10', 'company', 480),
    e('2025-03-12', 'company', 240),
    e('2025-03-16', 'training', 60), // Sunday of the first week
    e('2025-03-17', 'masters', 120),
    e('2026-03-09', 'company', 600), // last day of the year, in a week that runs past it
    e('2026-03-10', 'company', 999), // the next birthday
  ];
  const s = hoursStats(entries, [{ id: 'company', label: 'Company' }, { id: 'masters', label: 'Masters' }], W, '2026-11-23');
  it('totals the year and averages over its 365 / 7 weeks', () => {
    expect(s.totalMinutes).toBe(1500);
    expect(s.entries).toBe(5);
    expect(s.weeklyAvgHours).toBeCloseTo(25 / (365 / 7), 10); // 0.479 h
  });
  it('totals by category, using the label where there is one', () => {
    expect(s.byCategory.map((c) => [c.label, c.minutes])).toEqual([['Company', 1320], ['Masters', 120], ['training', 60]]);
    expect(s.byCategory[0].weeklyAvgHours).toBeCloseTo(22 / (365 / 7), 10);
  });
  it('ranks only whole Monday-to-Sunday weeks inside the year', () => {
    expect(s.weeks).toHaveLength(52); // weeks starting 10 Mar 2025 to 2 Mar 2026
    expect(s.weeks[0]).toEqual({ start: '2025-03-10', minutes: 780 });
    expect(s.weeks[51]).toEqual({ start: '2026-03-02', minutes: 0 });
    expect(s.heaviest).toEqual({ start: '2025-03-10', minutes: 780 });
    expect(s.lightest).toEqual({ start: '2025-03-24', minutes: 0 }); // the first week with nothing logged
  });
  it('puts each entry in its month', () => {
    expect(s.byMonth.filter((m) => m.minutes).map((m) => [m.month, m.minutes])).toEqual([['2025-03', 900], ['2026-03', 600]]);
  });
  it('averages a year in progress over the days so far', () => {
    const w = yearWindow(B, 2027); // starts Tuesday 10 Mar 2026
    const p = hoursStats([e('2026-03-10', 'company', 420), e('2026-03-18', 'company', 300), e('2026-03-24', 'company', 60)], [], w, '2026-03-25');
    expect(p.weeklyAvgHours).toBeCloseTo(13 / (16 / 7), 10); // 780 minutes over 16 days
    expect(p.weeks).toEqual([{ start: '2026-03-16', minutes: 300 }]); // the only whole week so far
  });
  it('has no weeks and a zero average before the year starts', () => {
    const p = hoursStats(entries, [], yearWindow(B, 2030), '2026-11-23');
    expect(p).toMatchObject({ totalMinutes: 0, weeklyAvgHours: 0, weeks: [], heaviest: null, lightest: null });
  });
  it('reads the fixture document', () => {
    const { data, dropped } = parseHours(JSON.parse(hoursRaw));
    expect(dropped).toBe(0);
    const f = hoursStats(data.entries, data.categories, W, '2026-11-23');
    expect(f.byCategory.map((c) => c.label)).toEqual(['Company', 'Training', 'Masters', 'Writing']);
    // Writing is 3 h on the first Sunday of each month: 12 Sundays from 6 Apr 2025 to 1 Mar 2026.
    expect(f.byCategory[3].minutes).toBe(12 * 180);
    // Nothing is logged from 24 Dec: the week of 22 Dec has Monday (7 h + 1.5 h) and Tuesday (7 h + 2 h) only.
    expect(f.lightest).toEqual({ start: '2025-12-22', minutes: 510 + 540 });
    // A full week: 5 x 7 h company, 2 x 2 h masters, 3 x 1.5 h training, and the first week of the year has no essay Sunday.
    expect(f.weeks[0]).toEqual({ start: '2025-03-10', minutes: 5 * 420 + 240 + 270 });
    expect(f.heaviest).toEqual({ start: '2025-03-31', minutes: 5 * 420 + 240 + 270 + 180 });
  });
});

describe('decisions', () => {
  it('scores a call as (probability - outcome) squared', () => {
    expect(squaredError(0.7, true)).toBeCloseTo(0.09, 12);
    expect(squaredError(0.7, false)).toBeCloseTo(0.49, 12);
    expect(squaredError(1, true)).toBe(0);
    expect(squaredError(0, true)).toBe(1);
  });
  const { data, dropped } = parseDecisions(JSON.parse(decisionsRaw));
  const s = decisionStats(data.decisions, W);
  it('counts calls made in the year and those still open', () => {
    expect(dropped).toBe(0);
    expect(s.made.map((d) => d.id)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    expect(s.open).toBe(1);
  });
  it('scores calls resolved in the year, whenever they were made', () => {
    // d6 was made the year before and resolved on 1 Apr 2025.
    expect(s.resolved.map((r) => r.decision.id)).toEqual(['d6', 'd1', 'd3', 'd2', 'd4']);
    expect(s.happened).toBe(2);
    // 0.64 + 0.09 + 0.16 + 0.81 + 0.04 = 1.74; / 5 = 0.348
    expect(s.brier).toBeCloseTo(0.348, 10);
    expect(s.best?.decision.title).toBe('Move the office'); // said 20%, did not happen: 0.04
    expect(s.worst?.decision.title).toBe('Pilot customer renews'); // said 90%, did not happen: 0.81
  });
  it('has no score when nothing resolved', () => {
    const none = decisionStats(data.decisions, yearWindow(B, 2023));
    expect(none).toMatchObject({ made: [], resolved: [], brier: null, best: null, worst: null });
  });
  it('uses the resolved date, not the date made, and respects the boundaries', () => {
    const d = (id: string, madeOn: string, resolvedOn?: string): Decision => ({ id, title: id, category: '', madeOn, probability: 0.5, ...(resolvedOn ? { outcome: true, resolvedOn } : {}) });
    const x = decisionStats([d('a', '2025-03-09', '2025-03-10'), d('b', '2025-03-10', '2026-03-10'), d('c', '2026-03-09', '2026-03-09')], W);
    expect(x.made.map((m) => m.id)).toEqual(['b', 'c']);
    expect(x.resolved.map((r) => r.decision.id)).toEqual(['a', 'c']);
    expect(x.open).toBe(0); // b is resolved, only later
    expect(x.brier).toBe(0.25);
  });
});

describe('reading other apps documents', () => {
  it('rejects a document from the wrong app', () => {
    expect(() => parseTwoCity({ entries: [] })).toThrow(/not a Two City document/);
    expect(() => parseHours({ stays: [] })).toThrow(/not an Hours Ledger document/);
    expect(() => parseDecisions([])).toThrow(/not a Decision Journal document/);
    expect(() => parseSource('twoCity', 'hello')).toThrow();
  });
  it('drops rows that do not fit the contract and counts them', () => {
    const r = parseTwoCity({
      stays: [
        { id: 'a', city: 'London', country: 'gb', arrive: '2025-01-01', depart: null, source: 'manual', note: 'private note' },
        { id: 'b', city: 'London', country: 'GB', arrive: '2025-02-30', depart: null }, // not a date
        { id: 'c', city: '', country: 'GB', arrive: '2025-01-01', depart: null },
        { id: 'd', city: 'Paris', country: 'FR', arrive: '2025-03-05', depart: '2025-03-01' }, // leaves before arriving
        'nonsense',
      ],
      fixtures: [{ id: 'f', date: '2025-01-04', opponent: 'Harbour City', home: true, competition: 'League', kickoffUtc: '2025-01-04T15:00:00Z' }, { date: 'soon', opponent: 'X' }],
    });
    expect(r.dropped).toBe(5);
    // Only contract fields are kept: no note, no source, no kick-off time.
    expect(r.data.stays).toEqual([{ id: 'a', city: 'London', country: 'GB', arrive: '2025-01-01', depart: null }]);
    expect(r.data.fixtures).toEqual([{ id: 'f', date: '2025-01-04', opponent: 'Harbour City', home: true, competition: 'League', attended: false }]);
    expect(sourceCount('twoCity', r.data)).toBe('1 stays, 1 fixtures');
  });
  it('checks hours and decisions rows', () => {
    const h = parseHours({ entries: [{ id: 'e', day: '2025-01-01', category: 'company', minutes: 30, note: 'private' }, { day: '2025-01-01', category: 'company', minutes: -5 }, { day: '2025-01-01', category: 'company', minutes: '30' }] });
    expect(h.dropped).toBe(2);
    expect(h.data).toEqual({ entries: [{ id: 'e', day: '2025-01-01', category: 'company', minutes: 30 }], categories: [] });
    const d = parseDecisions({
      decisions: [
        { id: 'x', title: 'A', category: 'c', madeOn: '2025-01-01', probability: 0.4, reviewOn: '2025-02-01', outcome: true, notes: 'private' }, // outcome with no resolved date
        { id: 'y', title: 'B', madeOn: '2025-01-01', probability: 1.4 },
        { id: 'z', title: 'C', category: 'c', madeOn: '2025-01-01', probability: 0.4, resolvedOn: '2025-03-01' }, // a date but no outcome
      ],
    });
    expect(d.dropped).toBe(1);
    expect(d.data.decisions[0]).toEqual({ id: 'x', title: 'A', category: 'c', madeOn: '2025-01-01', probability: 0.4, reviewOn: '2025-02-01', outcome: true, resolvedOn: '2025-02-01' });
    expect(d.data.decisions[1]).toEqual({ id: 'z', title: 'C', category: 'c', madeOn: '2025-01-01', probability: 0.4 });
  });
});
