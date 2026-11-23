import { describe, expect, it } from 'vitest';
import { countIn, countedSpans, dayTable, dayTableCsv, evaluateAll, evaluateRule, moveBoundary, plannedStays, rollingRule, stayOutlook, ukTaxYear, whatIf } from './ledger.ts';
import type { Rule, Stay } from './ledger.ts';

const stay = (id: string, city: string, country: string, arrive: string, depart: string | null): Stay => ({ id, city, country, arrive, depart, source: 'manual' });

// A year split between the two cities. Hand-counted below.
const A = stay('A', 'london', 'GB', '2026-04-01', '2026-04-20');
const B = stay('B', 'london', 'GB', '2026-11-10', '2026-12-12');
const C = stay('C', 'istanbul', 'TR', '2026-12-12', '2027-01-04');
const D = stay('D', 'london', 'GB', '2027-01-04', '2027-01-20');
const STAYS = [A, B, C, D];
const TODAY = '2026-11-23';

const UK: Rule = { id: 'uk', label: 'UK', countries: ['GB'], convention: 'midnights', period: { kind: 'uk-tax-year' }, limit: 90 };
const TR: Rule = { id: 'tr', label: 'Turkey', countries: ['TR'], convention: 'any-part', period: { kind: 'calendar-year' }, limit: 183 };

describe('counting conventions', () => {
  it('counts arrival and departure days under any-part, and midnights only under midnights', () => {
    const s = [stay('s', 'london', 'GB', '2026-11-01', '2026-11-10')];
    expect(countIn(countedSpans(s, ['GB'], 'any-part', TODAY), '2026-01-01', '2026-12-31')).toBe(10);
    expect(countIn(countedSpans(s, ['GB'], 'midnights', TODAY), '2026-01-01', '2026-12-31')).toBe(9);
  });

  it('counts nothing for a day trip under midnights, one day under any-part', () => {
    const s = [stay('s', 'paris', 'FR', '2026-06-03', '2026-06-03')];
    expect(countedSpans(s, ['FR'], 'midnights', TODAY)).toEqual([]);
    expect(countedSpans(s, ['FR'], 'any-part', TODAY)).toEqual([['2026-06-03', '2026-06-03']]);
  });

  it('does not double count overlapping or back-to-back stays in the same country', () => {
    const s = [stay('a', 'london', 'GB', '2026-06-01', '2026-06-10'), stay('b', 'manchester', 'GB', '2026-06-10', '2026-06-15'), stay('c', 'london', 'GB', '2026-06-12', '2026-06-20')];
    expect(countedSpans(s, ['GB'], 'any-part', TODAY)).toEqual([['2026-06-01', '2026-06-20']]);
    expect(countIn(countedSpans(s, ['GB'], 'midnights', TODAY), '2026-06-01', '2026-06-30')).toBe(19);
  });

  it('counts an open-ended stay up to today only', () => {
    const s = [stay('o', 'london', 'GB', '2026-11-20', null)];
    expect(countedSpans(s, ['GB'], 'midnights', TODAY)).toEqual([['2026-11-20', '2026-11-23']]);
    // Not started yet: its arrival day is all that is known.
    expect(countedSpans([stay('f', 'london', 'GB', '2026-12-01', null)], ['GB'], 'any-part', TODAY)).toEqual([['2026-12-01', '2026-12-01']]);
    expect(evaluateRule(UK, s, TODAY).openEnded).toBe(true);
  });

  it('groups countries', () => {
    const s = [stay('a', 'paris', 'FR', '2026-03-01', '2026-03-05'), stay('b', 'rome', 'IT', '2026-03-05', '2026-03-08'), stay('c', 'london', 'GB', '2026-03-08', '2026-03-20')];
    expect(countIn(countedSpans(s, ['FR', 'IT'], 'any-part', TODAY), '2026-01-01', '2026-12-31')).toBe(8);
  });
});

describe('periods', () => {
  it('puts 5 April in the old UK tax year and 6 April in the new one', () => {
    expect(ukTaxYear('2026-04-05')).toEqual(['2025-04-06', '2026-04-05']);
    expect(ukTaxYear('2026-04-06')).toEqual(['2026-04-06', '2027-04-05']);
    expect(ukTaxYear('2027-01-15')).toEqual(['2026-04-06', '2027-04-05']);
  });
});

describe('rules', () => {
  it('measures the UK tax year: used to date, booked ahead, remaining', () => {
    // A: midnights 1-19 Apr, of which 6-19 Apr fall in 2026/27 = 14.
    // B: midnights 10 Nov-11 Dec = 32, of which 10-23 Nov (14) are used and 18 are ahead.
    // D: midnights 4-19 Jan = 16.
    const s = evaluateRule(UK, STAYS, TODAY);
    expect(s.period).toEqual(['2026-04-06', '2027-04-05']);
    expect(s.used).toBe(28);
    expect(s.booked).toBe(34);
    expect(s.remaining).toBe(28);
    expect(s.breached).toBe(false);
  });

  it('measures Turkey per calendar year, counting the travel days', () => {
    // C: 12-31 Dec 2026 = 20 days, 1-4 Jan 2027 = 4 days.
    const all = evaluateAll([TR], STAYS, TODAY);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ period: ['2026-01-01', '2026-12-31'], used: 0, booked: 20, remaining: 163 });
    expect(all[1]).toMatchObject({ period: ['2027-01-01', '2027-12-31'], used: 0, booked: 4, remaining: 179 });
  });

  it('leaves remaining empty when no limit is set', () => {
    const s = evaluateRule({ ...UK, limit: null }, STAYS, TODAY);
    expect(s.remaining).toBeNull();
    expect(s.breached).toBe(false);
    expect(s.used + s.booked).toBe(62);
  });

  it('flags a breach', () => {
    expect(evaluateRule({ ...UK, limit: 45 }, STAYS, TODAY)).toMatchObject({ remaining: -17, breached: true });
  });

  it('evaluates a rolling window at its fullest point', () => {
    // 1 Jan-1 Mar = 60 days, 1 May-9 Jun = 40 days. Any 180 days ending 9 Jun (from 12 Dec) hold all 100.
    const fr = [stay('x', 'paris', 'FR', '2026-01-01', '2026-03-01'), stay('y', 'paris', 'FR', '2026-05-01', '2026-06-09')];
    const s = evaluateRule(rollingRule('r'), fr, '2026-04-01');
    expect(s.period).toBeNull();
    expect(s.used).toBe(60);
    expect(s.booked).toBe(40);
    expect(s.peak).toBe(100);
    expect(s.peakOn).toBe('2026-06-09');
    expect(s.remaining).toBe(-10);
    expect(s.breached).toBe(true);
    // Six months later the first trip has rolled out of the window.
    expect(evaluateRule(rollingRule('r'), fr, '2026-10-15')).toMatchObject({ used: 40, peak: 40, remaining: 50 });
  });
});

describe('planned stays', () => {
  it('lists stays under way or still to come', () => {
    expect(plannedStays(STAYS, TODAY).map((s) => s.id)).toEqual(['B', 'C', 'D']);
  });

  it('shows what is left at the end of a stay and how far it could stretch', () => {
    // By 20 Jan: 14 + 32 + 16 = 62 of 90, so 28 left. 28 more midnights from 20 Jan end on a 17 Feb departure.
    const d = stayOutlook(D, STAYS, [UK, TR], TODAY);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ ruleId: 'uk', countAtEnd: 62, remainingAtEnd: 28, extendTo: '2027-02-17', extendStop: 'limit', breach: false });
    // One day later would be day 91.
    const longer = STAYS.map((s) => (s.id === 'D' ? { ...s, depart: '2027-02-18' } : s));
    expect(evaluateRule(UK, longer, TODAY).remaining).toBe(-1);
  });

  it('stops an extension at the next booked stay', () => {
    const b = stayOutlook(B, STAYS, [UK], TODAY);
    expect(b.rows[0]).toMatchObject({ countAtEnd: 46, remainingAtEnd: 44, extendTo: '2026-12-12', extendStop: 'next-stay' });
  });

  it('splits a stay that crosses a period boundary', () => {
    const c = stayOutlook(C, STAYS, [UK, TR], TODAY);
    expect(c.rows.map((r) => [r.period?.[0], r.countAtEnd, r.remainingAtEnd])).toEqual([
      ['2026-01-01', 20, 163],
      ['2027-01-01', 4, 179],
    ]);
  });

  it('flags a planned stay that breaches and offers no extension', () => {
    const d = stayOutlook(D, STAYS, [{ ...UK, limit: 50 }], TODAY);
    expect(d.breach).toBe(true);
    expect(d.rows[0]).toMatchObject({ remainingAtEnd: -12, extendTo: null });
    // The earlier stay is still inside the limit at its own end, but cannot grow: the year as booked is already over.
    const b = stayOutlook(B, STAYS, [{ ...UK, limit: 50 }], TODAY);
    expect(b.breach).toBe(false);
    expect(b.rows[0]).toMatchObject({ remainingAtEnd: 4, extendTo: null });
  });

  it('extends under a rolling rule up to the limit', () => {
    // 60 days already inside the window; 30 more (1-30 May) make 90.
    const fr = [stay('x', 'paris', 'FR', '2026-01-01', '2026-03-01'), stay('y', 'paris', 'FR', '2026-05-01', '2026-05-10')];
    const y = stayOutlook(fr[1], fr, [rollingRule('r')], '2026-04-01');
    expect(y.rows[0]).toMatchObject({ countAtEnd: 70, remainingAtEnd: 20, extendTo: '2026-05-30', extendStop: 'limit' });
  });

  it('gives no extension date when the rule has no limit', () => {
    expect(stayOutlook(D, STAYS, [{ ...UK, limit: null }], TODAY).rows[0]).toMatchObject({ remainingAtEnd: null, extendTo: null, extendStop: null });
  });
});

describe('what-if', () => {
  it('moves a flight and the neighbouring stay with it', () => {
    const { stays, error } = moveBoundary(STAYS, { stayId: 'B', edge: 'depart', to: '2026-12-19' });
    expect(error).toBeNull();
    expect(stays.find((s) => s.id === 'B')?.depart).toBe('2026-12-19');
    expect(stays.find((s) => s.id === 'C')?.arrive).toBe('2026-12-19');
    expect(STAYS.find((s) => s.id === 'B')?.depart).toBe('2026-12-12'); // input untouched
  });

  it('refuses a move that turns a stay inside out', () => {
    expect(moveBoundary(STAYS, { stayId: 'B', edge: 'depart', to: '2026-11-01' }).error).toMatch(/london stay end before it starts/);
    expect(moveBoundary(STAYS, { stayId: 'B', edge: 'depart', to: '2027-01-10' }).error).toMatch(/istanbul stay/);
    expect(moveBoundary([stay('o', 'london', 'GB', '2026-11-01', null)], { stayId: 'o', edge: 'depart', to: '2026-12-01' }).error).toMatch(/no departure/);
  });

  it('compares every rule and later stay before and after, without saving', () => {
    // A week longer in London: 7 more UK midnights (remaining 28 -> 21), 7 fewer Turkey days in 2026 (20 -> 13).
    const w = whatIf(STAYS, [UK, TR], TODAY, { stayId: 'B', edge: 'depart', to: '2026-12-19' });
    expect(w.error).toBeNull();
    const uk = w.rules.find((r) => r.key === 'uk|2026-04-06')!;
    expect([uk.before?.remaining, uk.after?.remaining]).toEqual([28, 21]);
    const tr26 = w.rules.find((r) => r.key === 'tr|2026-01-01')!;
    expect([tr26.before?.booked, tr26.after?.booked]).toEqual([20, 13]);
    const d = w.stays.find((s) => s.stay.id === 'D')!;
    expect([d.before?.rows[0].remainingAtEnd, d.after.rows[0].remainingAtEnd]).toEqual([28, 21]);
    expect(d.after.rows[0].extendTo).toBe('2027-02-10');
  });

  it('reports the error instead of a comparison', () => {
    const w = whatIf(STAYS, [UK], TODAY, { stayId: 'nope', edge: 'arrive', to: '2026-12-01' });
    expect(w.error).toBeTruthy();
    expect(w.after).toBe(STAYS);
  });
});

describe('day table', () => {
  it('shows both countries on a travel day and where the night was spent', () => {
    const rows = dayTable(STAYS, '2026-12-11', '2026-12-13', TODAY);
    expect(rows).toEqual([
      { date: '2026-12-11', cities: ['london'], countries: ['GB'], midnight: 'GB' },
      { date: '2026-12-12', cities: ['london', 'istanbul'], countries: ['GB', 'TR'], midnight: 'TR' },
      { date: '2026-12-13', cities: ['istanbul'], countries: ['TR'], midnight: 'TR' },
    ]);
    expect(dayTable(STAYS, '2026-05-01', '2026-05-01', TODAY)[0]).toEqual({ date: '2026-05-01', cities: [], countries: [], midnight: null });
  });

  it('exports CSV with a running count per rule', () => {
    const csv = dayTableCsv(STAYS, [UK, TR], '2026-12-11', '2026-12-13', TODAY).trim().split('\n');
    expect(csv[0]).toBe('date,cities,countries_any_part,country_at_midnight,UK (running),Turkey (running)');
    // UK midnights so far in 2026/27: 14 + (10 Nov..11 Dec = 32) = 46; 12 Dec is not a UK midnight.
    expect(csv[1]).toBe('2026-12-11,london,GB,GB,46,0');
    expect(csv[2]).toBe('2026-12-12,london / istanbul,GB / TR,TR,46,1');
    expect(csv[3]).toBe('2026-12-13,istanbul,TR,TR,46,2');
  });
});
