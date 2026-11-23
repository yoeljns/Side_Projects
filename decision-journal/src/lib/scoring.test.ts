import { describe, expect, it } from 'vitest';
import type { Decision } from './model';
import {
  binIndex,
  breakdown,
  brierBinary,
  brierMulti,
  brierWords,
  calibrationBins,
  gapWords,
  impactOf,
  LOG_FLOOR,
  logScoreBinary,
  logScoreMulti,
  MIN_READABLE,
  multiSummary,
  murphy,
  overconfidence,
  probabilityWords,
  qualityMatrix,
  rollingBrier,
  scoredForecasts,
  skillScore,
  summarise,
  wilson,
  type Forecast,
} from './scoring';

let seq = 0;
const f = (p: number, o: 0 | 1, extra: Partial<Forecast> = {}): Forecast => ({
  id: `f${++seq}`,
  p,
  o,
  madeOn: '2026-01-01',
  resolvedOn: '2026-02-01',
  category: 'Company',
  stakes: 'medium',
  ...extra,
});
const many = (p: number, hits: number, misses: number, extra: Partial<Forecast> = {}): Forecast[] => [
  ...Array.from({ length: hits }, () => f(p, 1, extra)),
  ...Array.from({ length: misses }, () => f(p, 0, extra)),
];

// Ten forecasts used throughout. Worked by hand:
//   A  p 0.9, 3 hit 1 miss   Brier terms 3(0.01) + 0.81       = 0.84
//   B  p 0.6, 2 hit 2 miss   Brier terms 2(0.16) + 2(0.36)    = 1.04
//   C  p 0.2, 1 hit 1 miss   Brier terms 0.64 + 0.04          = 0.68
//   total 2.56 over 10 -> 0.256; 6 of 10 happened -> base rate 0.6
const TEN = [...many(0.9, 3, 1, { category: 'Company' }), ...many(0.6, 2, 2, { category: 'Money' }), ...many(0.2, 1, 1, { category: 'Money', stakes: 'high' })];

describe('single-forecast scores', () => {
  it('binary Brier is the squared miss', () => {
    expect(brierBinary(0.7, true)).toBeCloseTo(0.09, 12);
    expect(brierBinary(0.7, false)).toBeCloseTo(0.49, 12);
    expect(brierBinary(0.5, 1)).toBe(0.25);
    expect(brierBinary(1, 1)).toBe(0);
    expect(brierBinary(1, 0)).toBe(1);
  });

  it('multi-outcome Brier sums over outcomes and runs 0..2', () => {
    // bear 0.2, base 0.5, bull 0.3, base happens: 0.04 + 0.25 + 0.09
    expect(brierMulti([0.2, 0.5, 0.3], 1)).toBeCloseTo(0.38, 12);
    // bull happens instead: 0.04 + 0.25 + 0.49
    expect(brierMulti([0.2, 0.5, 0.3], 2)).toBeCloseTo(0.78, 12);
    expect(brierMulti([0, 1, 0], 1)).toBe(0);
    expect(brierMulti([1, 0, 0], 1)).toBe(2);
  });

  it('multi-outcome Brier of a two-way forecast is twice the binary form', () => {
    expect(brierMulti([0.7, 0.3], 0)).toBeCloseTo(2 * brierBinary(0.7, 1), 12);
    expect(brierMulti([0.7, 0.3], 1)).toBeCloseTo(2 * brierBinary(0.7, 0), 12);
  });

  it('log score is ln of the probability given to what happened', () => {
    expect(logScoreBinary(0.7, 1)).toBeCloseTo(-0.356675, 6);
    expect(logScoreBinary(0.7, 0)).toBeCloseTo(-1.203973, 6);
    expect(logScoreBinary(0.5, 0)).toBeCloseTo(-0.693147, 6);
    expect(logScoreMulti([0.2, 0.5, 0.3], 2)).toBeCloseTo(-1.203973, 6);
    expect(logScoreMulti([0.7, 0.3], 0)).toBeCloseTo(logScoreBinary(0.7, 1), 12);
  });

  it('log score is floored instead of going to minus infinity', () => {
    expect(LOG_FLOOR).toBe(0.001);
    expect(logScoreBinary(1, 0)).toBeCloseTo(-6.907755, 6);
    expect(logScoreBinary(0, 1)).toBeCloseTo(-6.907755, 6);
    // A certain call that came true is capped just below zero: ln(0.999).
    expect(logScoreBinary(1, 1)).toBeCloseTo(-0.0010005, 6);
    expect(logScoreMulti([1, 0], 1)).toBeCloseTo(-6.907755, 6);
  });

  it('skill score', () => {
    expect(skillScore(0.2, 0.25)).toBeCloseTo(0.2, 12);
    expect(skillScore(0.25, 0.25)).toBe(0);
    expect(skillScore(0.3, 0.25)).toBeCloseTo(-0.2, 12);
    expect(skillScore(0, 0.25)).toBe(1);
    expect(skillScore(0.1, 0)).toBeNull();
  });
});

describe('wilson interval', () => {
  it('matches the textbook value for 7 of 10', () => {
    const w = wilson(7, 10);
    expect(w.lo).toBeCloseTo(0.3968, 4);
    expect(w.hi).toBeCloseTo(0.8922, 4);
  });
  it('does not collapse to a point at 0 of 5 or 5 of 5', () => {
    expect(wilson(0, 5).lo).toBe(0);
    expect(wilson(0, 5).hi).toBeCloseTo(0.4345, 4);
    expect(wilson(5, 5).lo).toBeCloseTo(0.5655, 4);
    expect(wilson(5, 5).hi).toBe(1);
  });
  it('one result says almost nothing', () => {
    const w = wilson(1, 1);
    expect(w.lo).toBeCloseTo(0.2065, 4);
    expect(w.hi).toBe(1);
  });
  it('is the whole range with no data', () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
  it('narrows as n grows', () => {
    const small = wilson(7, 10);
    const big = wilson(70, 100);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
    expect(big.lo).toBeCloseTo(0.60415, 4);
    expect(big.hi).toBeCloseTo(0.78105, 4);
  });
});

describe('bins', () => {
  it('puts edges in the upper bin and 100% in the last one', () => {
    expect([0, 0.05, 0.1, 0.29, 0.3, 0.6, 0.7, 0.95, 1].map((p) => binIndex(p))).toEqual([0, 0, 1, 2, 3, 6, 7, 9, 9]);
    // every typed whole percent lands where arithmetic says it should
    for (let pc = 0; pc <= 100; pc++) expect(binIndex(pc / 100)).toBe(Math.min(9, Math.floor(pc / 10)));
    expect(binIndex(0.5, 5)).toBe(2);
    expect(binIndex(0.39, 5)).toBe(1);
  });

  it('counts, hit rates and mean forecasts per bin', () => {
    const bins = calibrationBins(TEN);
    expect(bins).toHaveLength(10);
    expect(bins.filter((b) => b.n).map((b) => [b.index, b.n, b.hits])).toEqual([
      [2, 2, 1],
      [6, 4, 2],
      [9, 4, 3],
    ]);
    expect(bins[9].meanP).toBeCloseTo(0.9, 12);
    expect(bins[9].rate).toBe(0.75);
    expect(bins[9].lo).toBeCloseTo(0.9, 12);
    expect(bins[9].ci).toEqual(wilson(3, 4));
    expect(bins[0]).toMatchObject({ n: 0, meanP: null, rate: null, ci: null });
  });

  it('averages different forecasts inside one bin', () => {
    const bins = calibrationBins([f(0.61, 1), f(0.69, 0)]);
    expect(bins[6].meanP).toBeCloseTo(0.65, 12);
    expect(bins[6].rate).toBe(0.5);
  });
});

describe('Murphy decomposition', () => {
  it('splits the hand-worked set into reliability, resolution and uncertainty', () => {
    const m = murphy(TEN)!;
    // reliability 0.4(0.15^2) + 0.4(0.1^2) + 0.2(0.3^2) = 0.009 + 0.004 + 0.018
    expect(m.reliability).toBeCloseTo(0.031, 12);
    // resolution 0.4(0.15^2) + 0.4(0.1^2) + 0.2(0.1^2) = 0.009 + 0.004 + 0.002
    expect(m.resolution).toBeCloseTo(0.015, 12);
    expect(m.uncertainty).toBeCloseTo(0.24, 12);
    expect(m.withinBin).toBeCloseTo(0, 12);
    expect(m.reliability - m.resolution + m.uncertainty).toBeCloseTo(0.256, 12);
  });

  it('reports the within-bin remainder when forecasts in a bin differ', () => {
    // Brier (0.39^2 + 0.69^2)/2 = 0.3141; bin says 0.65, half happened:
    // reliability 0.0225, resolution 0, uncertainty 0.25 -> 0.2725, remainder 0.0416
    const m = murphy([f(0.61, 1), f(0.69, 0)])!;
    expect(m.reliability).toBeCloseTo(0.0225, 12);
    expect(m.resolution).toBe(0);
    expect(m.uncertainty).toBe(0.25);
    expect(m.withinBin).toBeCloseTo(0.0416, 12);
  });

  it('always adds back up to the Brier score', () => {
    const set = [f(0.05, 0), f(0.33, 1), f(0.37, 0), f(0.52, 1), f(0.58, 1), f(0.71, 0), f(0.78, 1), f(0.99, 1)];
    const s = summarise(set)!;
    const m = s.murphy;
    expect(m.reliability - m.resolution + m.uncertainty + m.withinBin).toBeCloseTo(s.brier, 12);
  });

  it('a perfectly calibrated forecaster has zero reliability', () => {
    const m = murphy([...many(0.8, 4, 1), ...many(0.2, 1, 4)])!;
    expect(m.reliability).toBeCloseTo(0, 12);
    // hit rates 0.8 and 0.2 around a base rate of 0.5
    expect(m.resolution).toBeCloseTo(0.09, 12);
  });

  it('is null with nothing to score', () => {
    expect(murphy([])).toBeNull();
  });
});

describe('overconfidence', () => {
  it('folds forecasts under 50% onto the side they leaned', () => {
    // confidence (4(0.9) + 4(0.6) + 2(0.8)) / 10 = 0.76; right 3 + 2 + 1 of 10
    const o = overconfidence(TEN)!;
    expect(o.confidence).toBeCloseTo(0.76, 12);
    expect(o.hitRate).toBeCloseTo(0.6, 12);
    expect(o.gap).toBeCloseTo(0.16, 12);
  });
  it('is negative for an underconfident forecaster', () => {
    expect(overconfidence(many(0.6, 9, 1))!.gap).toBeCloseTo(-0.3, 12);
  });
  it('a 20% call that does not happen is a hit at 80% confidence', () => {
    expect(overconfidence([f(0.2, 0)])).toEqual({ confidence: 0.8, hitRate: 1, gap: expect.closeTo(-0.2, 12) });
  });
  it('an exact 50% call counts as half a hit either way', () => {
    expect(overconfidence([f(0.5, 1)])!.gap).toBe(0);
    expect(overconfidence([f(0.5, 0)])!.gap).toBe(0);
  });
  it('is null with nothing to score', () => {
    expect(overconfidence([])).toBeNull();
  });
});

describe('summarise', () => {
  it('the hand-worked set', () => {
    const s = summarise(TEN)!;
    expect(s.n).toBe(10);
    expect(s.brier).toBeCloseTo(0.256, 12);
    // (3 ln 0.9 + ln 0.1 + 2 ln 0.6 + 2 ln 0.4 + ln 0.2 + ln 0.8) / 10
    expect(s.logScore).toBeCloseTo(-0.730548, 6);
    expect(s.baseRate).toBeCloseTo(0.6, 12);
    expect(s.meanP).toBeCloseTo(0.64, 12);
    expect(s.brierBaseRate).toBeCloseTo(0.24, 12);
    // 1 - 0.256/0.24 and 1 - 0.256/0.25
    expect(s.skillVsBaseRate).toBeCloseTo(-0.066667, 6);
    expect(s.skillVsFifty).toBeCloseTo(-0.024, 12);
    expect(s.readable).toBe(false);
  });

  it('has no base-rate skill when everything happened', () => {
    const s = summarise(many(0.8, 5, 0))!;
    expect(s.brier).toBeCloseTo(0.04, 12);
    expect(s.skillVsBaseRate).toBeNull();
    expect(s.skillVsFifty).toBeCloseTo(0.84, 12);
  });

  it('labels small samples as not readable', () => {
    expect(MIN_READABLE).toBe(20);
    expect(summarise(many(0.7, 13, 6))!.readable).toBe(false);
    expect(summarise(many(0.7, 14, 6))!.readable).toBe(true);
  });

  it('is null with nothing to score', () => {
    expect(summarise([])).toBeNull();
  });
});

describe('rolling score', () => {
  const set = [
    f(0.9, 1, { id: 'c', resolvedOn: '2026-03-01' }), // 0.01
    f(0.6, 0, { id: 'a', resolvedOn: '2026-01-01' }), // 0.36
    f(0.8, 1, { id: 'b', resolvedOn: '2026-02-01' }), // 0.04
    f(0.5, 1, { id: 'd', resolvedOn: '2026-04-01' }), // 0.25
  ];

  it('orders by resolution date and averages the last N', () => {
    const r = rollingBrier(set, 2);
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.map((x) => x.n)).toEqual([1, 2, 2, 2]);
    const rolling = [0.36, 0.2, 0.025, 0.13];
    const cumulative = [0.36, 0.2, 0.41 / 3, 0.165];
    r.forEach((x, i) => {
      expect(x.rolling).toBeCloseTo(rolling[i], 12);
      expect(x.cumulative).toBeCloseTo(cumulative[i], 12);
    });
  });

  it('a window wider than the data is the cumulative mean', () => {
    const r = rollingBrier(set, 10);
    r.forEach((x) => expect(x.rolling).toBeCloseTo(x.cumulative, 12));
    expect(r[3].n).toBe(4);
  });

  it('breaks ties on the same day by decision date then id', () => {
    const r = rollingBrier([f(0.5, 1, { id: 'z', madeOn: '2026-01-01' }), f(0.5, 1, { id: 'y', madeOn: '2026-01-01' }), f(0.5, 1, { id: 'x', madeOn: '2026-01-05' })]);
    expect(r.map((x) => x.id)).toEqual(['y', 'z', 'x']);
  });

  it('is empty with nothing to score', () => {
    expect(rollingBrier([])).toEqual([]);
  });
});

describe('breakdown', () => {
  it('by category, biggest group first', () => {
    const g = breakdown(TEN, (x) => x.category);
    expect(g.map((x) => [x.key, x.n])).toEqual([
      ['Money', 6],
      ['Company', 4],
    ]);
    // Money: (1.04 + 0.68) / 6; Company: 0.84 / 4
    expect(g[0].brier).toBeCloseTo(1.72 / 6, 12);
    expect(g[1].brier).toBeCloseTo(0.21, 12);
    expect(g[1].baseRate).toBe(0.75);
    // Company: confidence 0.9, right 3 of 4
    expect(g[1].gap).toBeCloseTo(0.15, 12);
    // Money: confidence (4(0.6) + 2(0.8))/6 = 0.6667, right (2 + 1)/6 = 0.5
    expect(g[0].gap).toBeCloseTo(1 / 6, 12);
  });
  it('by stakes', () => {
    const g = breakdown(TEN, (x) => x.stakes);
    expect(g.map((x) => [x.key, x.n])).toEqual([
      ['medium', 8],
      ['high', 2],
    ]);
    expect(g[1].brier).toBeCloseTo(0.34, 12);
  });
});

// ----- from decisions -----

const dec = (id: string, p: number, extra: Partial<Decision> = {}): Decision => ({
  id,
  title: id,
  category: 'Company',
  stakes: 'medium',
  madeOn: '2026-01-01',
  probability: p,
  reviewOn: '2026-02-01',
  ...extra,
});

describe('which decisions are scored', () => {
  const decisions = [
    dec('open', 0.7),
    dec('yes', 0.7, { outcome: true, resolvedOn: '2026-02-03' }),
    dec('no', 0.9, { outcome: false, resolvedOn: '2026-02-02' }),
    dec('void', 0.6, { voided: true, resolvedOn: '2026-02-02' }),
    dec('void-with-outcome', 0.6, { voided: true, outcome: true, resolvedOn: '2026-02-02' }),
    dec('no-date', 0.8, { outcome: true }),
  ];

  it('skips open and void decisions', () => {
    const fs = scoredForecasts(decisions);
    expect(fs.map((x) => [x.id, x.p, x.o])).toEqual([
      ['yes', 0.7, 1],
      ['no', 0.9, 0],
      ['no-date', 0.8, 1],
    ]);
  });

  it('falls back to the review date when a resolved decision has no resolvedOn', () => {
    expect(scoredForecasts(decisions).find((x) => x.id === 'no-date')!.resolvedOn).toBe('2026-02-01');
  });
});

describe('what one result did', () => {
  const decisions = [
    dec('a', 0.6, { outcome: false, resolvedOn: '2026-02-01' }), // 0.36
    dec('b', 0.8, { outcome: true, resolvedOn: '2026-02-02' }), // 0.04
    dec('c', 0.9, { outcome: true, resolvedOn: '2026-02-03' }), // 0.01
    dec('open', 0.5),
    dec('void', 0.5, { voided: true, resolvedOn: '2026-02-03' }),
  ];

  it('compares the average with and without it', () => {
    const i = impactOf(decisions, 'c')!;
    expect(i.brier).toBeCloseTo(0.01, 12);
    expect(i.logScore).toBeCloseTo(Math.log(0.9), 12);
    expect(i.brierBefore).toBeCloseTo(0.2, 12);
    expect(i.brierAfter).toBeCloseTo(0.41 / 3, 12);
    expect(i.delta).toBeCloseTo(0.41 / 3 - 0.2, 12);
    expect(i.n).toBe(3);
    expect(i.o).toBe(1);
  });

  it('a bad miss pulls the average up', () => {
    const i = impactOf(decisions, 'a')!;
    expect(i.brierBefore).toBeCloseTo(0.025, 12);
    expect(i.delta!).toBeGreaterThan(0);
  });

  it('has no "before" for the first scored decision', () => {
    const i = impactOf([dec('only', 0.7, { outcome: true, resolvedOn: '2026-02-01' })], 'only')!;
    expect(i.brierBefore).toBeNull();
    expect(i.delta).toBeNull();
    expect(i.brierAfter).toBeCloseTo(0.09, 12);
    expect(i.n).toBe(1);
  });

  it('is null for open, void and unknown decisions', () => {
    expect(impactOf(decisions, 'open')).toBeNull();
    expect(impactOf(decisions, 'void')).toBeNull();
    expect(impactOf(decisions, 'nope')).toBeNull();
  });
});

describe('scenario decisions', () => {
  const scenarios = [
    { id: 'bear', label: 'Bear', probability: 0.2 },
    { id: 'base', label: 'Base', probability: 0.5 },
    { id: 'bull', label: 'Bull', probability: 0.3 },
  ];

  it('scores the full distribution and compares with an even split', () => {
    const m = multiSummary([
      dec('s1', 0.5, { scenarios, resolvedScenarioId: 'base', outcome: true, resolvedOn: '2026-02-01' }), // 0.38
      dec('s2', 0.5, { scenarios, resolvedScenarioId: 'bull', outcome: false, resolvedOn: '2026-02-01' }), // 0.78
      dec('two-way', 0.7, {
        scenarios: [
          { id: 'x', label: 'X', probability: 0.7 },
          { id: 'y', label: 'Y', probability: 0.3 },
        ],
        resolvedScenarioId: 'x',
        outcome: true,
        resolvedOn: '2026-02-01',
      }), // 0.18
      dec('binary', 0.7, { outcome: true, resolvedOn: '2026-02-01' }),
      dec('open', 0.5, { scenarios }),
      dec('void', 0.5, { scenarios, voided: true, resolvedOn: '2026-02-01' }),
    ])!;
    expect(m.n).toBe(3);
    expect(m.brier).toBeCloseTo((0.38 + 0.78 + 0.18) / 3, 12);
    expect(m.logScore).toBeCloseTo((Math.log(0.5) + Math.log(0.3) + Math.log(0.7)) / 3, 12);
    // even split: 1 - 1/3 twice and 1 - 1/2 once
    expect(m.brierUniform).toBeCloseTo((2 / 3 + 2 / 3 + 1 / 2) / 3, 12);
  });

  it('is null when no scenario decision is resolved', () => {
    expect(multiSummary([dec('binary', 0.7, { outcome: true, resolvedOn: '2026-02-01' })])).toBeNull();
  });
});

describe('decision quality against outcome', () => {
  it('counts the four cells and the unrated', () => {
    const r = { resolvedOn: '2026-02-01' };
    expect(
      qualityMatrix([
        dec('1', 0.7, { ...r, outcome: true, quality: 'good' }),
        dec('2', 0.7, { ...r, outcome: false, quality: 'good' }),
        dec('3', 0.7, { ...r, outcome: false, quality: 'good' }),
        dec('4', 0.7, { ...r, outcome: true, quality: 'bad' }),
        dec('5', 0.7, { ...r, outcome: false, quality: 'bad' }),
        dec('6', 0.7, { ...r, outcome: true, quality: 'unsure' }),
        dec('7', 0.7, { ...r, outcome: true }),
        dec('8', 0.7, { ...r, voided: true, quality: 'good' }),
        dec('9', 0.7, { quality: 'good' }),
      ]),
    ).toEqual({ goodWorked: 1, goodFailed: 2, badWorked: 1, badFailed: 1, unrated: 2 });
  });
});

describe('words', () => {
  it('probability words are symmetric around even', () => {
    expect([0.01, 0.1, 0.3, 0.45, 0.5, 0.55, 0.7, 0.8, 0.9, 0.95, 0.99].map(probabilityWords)).toEqual([
      'almost certainly not',
      'very unlikely',
      'unlikely',
      'about even',
      'about even',
      'about even',
      'likely',
      'likely',
      'very likely',
      'very likely',
      'almost certain',
    ]);
  });
  it('Brier words use 0.25 as the yardstick', () => {
    expect(brierWords(0.08)).toMatch(/^Sharp/);
    expect(brierWords(0.18)).toMatch(/^Better/);
    expect(brierWords(0.24)).toMatch(/^Close/);
    expect(brierWords(0.31)).toMatch(/^Worse/);
  });
  it('gap words', () => {
    expect(gapWords(0.16)).toBe('Overconfident');
    expect(gapWords(-0.2)).toBe('Underconfident');
    expect(gapWords(0.03)).toBe('About right');
  });
});
