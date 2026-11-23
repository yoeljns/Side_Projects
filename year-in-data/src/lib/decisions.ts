// Calls made and resolved, from the decision-journal app.
import type { Decision } from './types';
import { type YearWindow, inWindow } from './window';

export interface ScoredCall {
  decision: Decision;
  /** (probability - outcome)^2, outcome 1 when it happened and 0 when it did not. */
  error: number;
}

export interface DecisionStats {
  made: Decision[];
  /** Made this year and not yet resolved. */
  open: number;
  /** Resolved this year (whenever they were made), in date order. */
  resolved: ScoredCall[];
  happened: number;
  /** Mean squared error of the calls resolved this year. Null when none resolved. */
  brier: number | null;
  best: ScoredCall | null;
  worst: ScoredCall | null;
}

export const squaredError = (probability: number, outcome: boolean): number => (probability - (outcome ? 1 : 0)) ** 2;

export function decisionStats(decisions: Decision[], w: YearWindow): DecisionStats {
  const byDate = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const made = decisions.filter((d) => inWindow(d.madeOn, w)).sort((a, b) => byDate(a.madeOn, b.madeOn));
  const resolved = decisions
    .filter((d) => typeof d.outcome === 'boolean' && d.resolvedOn !== undefined && inWindow(d.resolvedOn, w))
    .sort((a, b) => byDate(a.resolvedOn!, b.resolvedOn!))
    .map((decision) => ({ decision, error: squaredError(decision.probability, decision.outcome!) }));
  const brier = resolved.length ? resolved.reduce((s, r) => s + r.error, 0) / resolved.length : null;
  // Ties go to the earliest resolved.
  const best = resolved.reduce<ScoredCall | null>((b, r) => (!b || r.error < b.error ? r : b), null);
  const worst = resolved.reduce<ScoredCall | null>((b, r) => (!b || r.error > b.error ? r : b), null);
  return {
    made,
    open: made.filter((d) => typeof d.outcome !== 'boolean').length,
    resolved,
    happened: resolved.filter((r) => r.decision.outcome).length,
    brier,
    best,
    worst,
  };
}
