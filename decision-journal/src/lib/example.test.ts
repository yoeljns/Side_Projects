import { describe, expect, it } from 'vitest';
import { exampleDecisions, hasExamples, withoutExamples } from './example';
import { normaliseDoc, scenarioSum, statusOf, toDraft, validateDraft, type Decision } from './model';
import { MIN_READABLE, scoredForecasts } from './scoring';

describe('example data', () => {
  const today = '2026-11-23';
  const ex = exampleDecisions(today);

  it('every record is a valid decision, flagged as an example', () => {
    for (const d of ex) {
      expect(validateDraft(toDraft(d))).toEqual([]);
      expect(d.example).toBe(true);
      if (d.resolvedOn) expect(d.resolvedOn <= today).toBe(true);
      if (d.scenarios) expect(scenarioSum(d.scenarios)).toBeCloseTo(1, 12);
    }
    expect(new Set(ex.map((d) => d.id)).size).toBe(ex.length);
    expect(normaliseDoc({ decisions: ex, categories: ['Other'] }).decisions).toEqual(ex);
  });

  it('has enough resolved decisions to read, and some still open', () => {
    expect(scoredForecasts(ex).length).toBeGreaterThanOrEqual(MIN_READABLE);
    expect(ex.filter((d) => statusOf(d) === 'open').length).toBeGreaterThan(0);
  });

  it('can be removed without touching real decisions', () => {
    const mine: Decision = { id: 'mine', title: 'Mine', category: 'Other', stakes: 'low', madeOn: today, probability: 0.6, reviewOn: today };
    expect(hasExamples([mine, ...ex])).toBe(true);
    expect(withoutExamples([mine, ...ex])).toEqual([mine]);
    expect(hasExamples([mine])).toBe(false);
  });
});
