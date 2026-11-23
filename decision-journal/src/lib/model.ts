// The journal's data and the rules for changing it. Pure: no DOM, no clock.
// `decisions` keeps the cross-app contract fields (id, title, category, madeOn,
// probability, reviewOn, outcome?, resolvedOn?, notes?) so Year in Data can
// read a backup file; everything else is extra.
import { isDate } from './dates';

export type Stakes = 'low' | 'medium' | 'high';
export const STAKES: Stakes[] = ['low', 'medium', 'high'];

/** Hindsight on the decision itself, separate from how it turned out. */
export type Quality = 'good' | 'bad' | 'unsure';

export interface Scenario {
  id: string;
  label: string;
  /** 0..1. A decision's scenarios sum to 1. */
  probability: number;
}

export interface Decision {
  id: string;
  title: string;
  /** What was actually decided. */
  call?: string;
  /** The outcome being forecast: "this works out as: ...". */
  statement?: string;
  category: string;
  stakes: Stakes;
  madeOn: string;
  /** 0..1, that the stated outcome happens. With scenarios: the top scenario's probability. */
  probability: number;
  reviewOn: string;
  notes?: string;
  /** What would change my mind. */
  changeMind?: string;
  /** Set on review. With scenarios: whether the top scenario is the one that happened. */
  outcome?: boolean;
  resolvedOn?: string;
  /** Reviewed but not scoreable (ambiguous, or the question stopped making sense). Never scored. */
  voided?: boolean;
  lesson?: string;
  quality?: Quality;
  hindsight?: string;
  /** Multi-outcome mode: named scenarios, exactly one of which resolves true. */
  scenarios?: Scenario[];
  resolvedScenarioId?: string;
  /** Marks records created by "Load example data" so they can be removed in one go. */
  example?: boolean;
}

export interface Doc {
  decisions: Decision[];
  categories: string[];
}

export const DEFAULT_CATEGORIES = ['Company', 'Masters', 'Money', 'Health', 'Relationships', 'Other'];
export const BLANK: Doc = { decisions: [], categories: DEFAULT_CATEGORIES };

export type Status = 'open' | 'resolved' | 'void';

export function statusOf(d: Decision): Status {
  if (d.voided) return 'void';
  return typeof d.outcome === 'boolean' ? 'resolved' : 'open';
}

export const SUM_TOLERANCE = 1e-6;

export const scenarioSum = (s: Scenario[]): number => s.reduce((a, x) => a + x.probability, 0);

/** The scenario given the highest probability; the first one wins a tie. */
export function topScenario(s: Scenario[]): Scenario | undefined {
  let best: Scenario | undefined;
  for (const x of s) if (!best || x.probability > best.probability) best = x;
  return best;
}

export interface Draft {
  title: string;
  call: string;
  statement: string;
  probability: number;
  category: string;
  stakes: Stakes;
  madeOn: string;
  reviewOn: string;
  notes: string;
  changeMind: string;
  scenarios?: Scenario[];
}

/** Problems that stop a draft being saved, in plain words. Empty means it is fine. */
export function validateDraft(d: Draft): string[] {
  const errors: string[] = [];
  if (!d.title.trim()) errors.push('Give it a title.');
  if (!isDate(d.madeOn)) errors.push('The decision date is not a valid date.');
  if (!isDate(d.reviewOn)) errors.push('Pick a review date.');
  else if (isDate(d.madeOn) && d.reviewOn < d.madeOn) errors.push('The review date is before the decision date.');
  if (d.scenarios) {
    const s = d.scenarios;
    if (s.length < 2) errors.push('Scenarios need at least two outcomes.');
    if (s.some((x) => !x.label.trim())) errors.push('Every scenario needs a name.');
    const names = s.map((x) => x.label.trim().toLowerCase());
    if (new Set(names).size !== names.length) errors.push('Scenario names must be different.');
    if (s.some((x) => !Number.isFinite(x.probability) || x.probability < 0 || x.probability > 1)) {
      errors.push('Each scenario probability must be between 0% and 100%.');
    } else if (Math.abs(scenarioSum(s) - 1) > SUM_TOLERANCE) {
      errors.push(`Scenario probabilities must add up to 100% (now ${Math.round(scenarioSum(s) * 1000) / 10}%).`);
    }
  } else if (!Number.isFinite(d.probability) || d.probability < 0 || d.probability > 1) {
    errors.push('The probability must be between 0% and 100%.');
  }
  return errors;
}

const text = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);

function draftFields(d: Draft) {
  const scenarios = d.scenarios?.map((s) => ({ ...s, label: s.label.trim() }));
  return {
    title: d.title.trim(),
    call: text(d.call),
    statement: text(d.statement),
    category: d.category,
    stakes: d.stakes,
    madeOn: d.madeOn,
    probability: scenarios ? topScenario(scenarios)!.probability : d.probability,
    reviewOn: d.reviewOn,
    notes: text(d.notes),
    changeMind: text(d.changeMind),
    scenarios,
  };
}

/** A new open decision. Throws if the draft is not valid: call validateDraft first. */
export function fromDraft(d: Draft, id: string): Decision {
  const errors = validateDraft(d);
  if (errors.length) throw new Error(errors[0]);
  return clean({ id, ...draftFields(d) });
}

/**
 * Edit a decision, keeping its review. If its scenarios changed, the contract
 * `outcome` is recomputed; if the scenario that resolved true was removed, the
 * decision is reopened.
 */
export function applyDraft(old: Decision, d: Draft): Decision {
  const errors = validateDraft(d);
  if (errors.length) throw new Error(errors[0]);
  let next: Decision = { ...old, ...draftFields(d) };
  if (statusOf(old) === 'resolved' && (old.scenarios || next.scenarios)) {
    const winner = next.scenarios?.find((s) => s.id === old.resolvedScenarioId);
    if (!winner) next = reopen(next);
    else next.outcome = topScenario(next.scenarios!)!.id === winner.id;
  }
  return clean(next);
}

export function toDraft(d: Decision): Draft {
  return {
    title: d.title,
    call: d.call ?? '',
    statement: d.statement ?? '',
    probability: d.probability,
    category: d.category,
    stakes: d.stakes,
    madeOn: d.madeOn,
    reviewOn: d.reviewOn,
    notes: d.notes ?? '',
    changeMind: d.changeMind ?? '',
    scenarios: d.scenarios?.map((s) => ({ ...s })),
  };
}

export type Result = { kind: 'outcome'; outcome: boolean } | { kind: 'scenario'; scenarioId: string } | { kind: 'void' };

export interface ReviewNotes {
  lesson?: string;
  quality?: Quality;
  hindsight?: string;
}

/** Record the review. A binary decision takes an outcome, a scenario decision takes the scenario that happened. */
export function resolve(d: Decision, result: Result, resolvedOn: string, review: ReviewNotes = {}): Decision {
  const base: Decision = {
    ...reopen(d),
    resolvedOn,
    lesson: text(review.lesson ?? ''),
    quality: review.quality,
    hindsight: text(review.hindsight ?? ''),
  };
  if (result.kind === 'void') return clean({ ...base, voided: true });
  if (d.scenarios) {
    if (result.kind !== 'scenario') throw new Error('A scenario decision resolves to one of its scenarios.');
    if (!d.scenarios.some((s) => s.id === result.scenarioId)) throw new Error('Unknown scenario.');
    return clean({ ...base, resolvedScenarioId: result.scenarioId, outcome: topScenario(d.scenarios)!.id === result.scenarioId });
  }
  if (result.kind !== 'outcome') throw new Error('A yes/no decision resolves to an outcome.');
  return clean({ ...base, outcome: result.outcome });
}

/** Undo a review: back to open, forecast untouched. */
export function reopen(d: Decision): Decision {
  const { outcome: _o, resolvedOn: _r, voided: _v, lesson: _l, quality: _q, hindsight: _h, resolvedScenarioId: _s, ...rest } = d;
  return rest;
}

/** Drop undefined fields so the saved JSON stays tidy. */
function clean(d: Decision): Decision {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as unknown as Decision;
}

export interface ReviewQueue {
  /** Review date has passed, oldest first. */
  overdue: Decision[];
  dueToday: Decision[];
  /** Still to come, soonest first. */
  upcoming: Decision[];
}

export function reviewQueue(decisions: Decision[], today: string): ReviewQueue {
  const open = decisions.filter((d) => statusOf(d) === 'open').sort((a, b) => a.reviewOn.localeCompare(b.reviewOn) || a.madeOn.localeCompare(b.madeOn));
  return {
    overdue: open.filter((d) => d.reviewOn < today),
    dueToday: open.filter((d) => d.reviewOn === today),
    upcoming: open.filter((d) => d.reviewOn > today),
  };
}

// ----- categories -----

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function addCategory(doc: Doc, name: string): Doc {
  const n = name.trim();
  if (!n || doc.categories.some((c) => sameName(c, n))) return doc;
  return { ...doc, categories: [...doc.categories, n] };
}

/** Rename a category and move its decisions with it. No-op if the new name is empty or already taken. */
export function renameCategory(doc: Doc, from: string, to: string): Doc {
  const n = to.trim();
  if (!n || n === from || doc.categories.some((c) => c !== from && sameName(c, n))) return doc;
  return {
    ...doc,
    categories: doc.categories.map((c) => (c === from ? n : c)),
    decisions: doc.decisions.map((d) => (d.category === from ? { ...d, category: n } : d)),
  };
}

/** Remove a category; its decisions move to `fallback`. The last category cannot be removed. */
export function removeCategory(doc: Doc, name: string, fallback: string): Doc {
  if (doc.categories.length <= 1 || name === fallback || !doc.categories.includes(fallback)) return doc;
  return {
    ...doc,
    categories: doc.categories.filter((c) => c !== name),
    decisions: doc.decisions.map((d) => (d.category === name ? { ...d, category: fallback } : d)),
  };
}

// ----- reading a saved or restored document -----

function validDecision(x: unknown): x is Decision {
  if (!x || typeof x !== 'object') return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.title === 'string' &&
    isDate(d.madeOn) &&
    isDate(d.reviewOn) &&
    typeof d.probability === 'number' &&
    d.probability >= 0 &&
    d.probability <= 1
  );
}

/**
 * Make whatever came out of storage or a restored file safe to render: drop
 * records that are not decisions, fill in missing extras, and keep every
 * category that a decision uses in the list.
 */
export function normaliseDoc(raw: Partial<Doc>): Doc {
  const decisions = (Array.isArray(raw.decisions) ? raw.decisions : []).filter(validDecision).map((d) => {
    const stakes: Stakes = STAKES.includes(d.stakes) ? d.stakes : 'medium';
    const category = typeof d.category === 'string' && d.category.trim() ? d.category : 'Other';
    const reviewed = typeof d.outcome === 'boolean' || d.voided === true;
    // The contract allows an outcome without a resolvedOn: fall back to the review date.
    const resolvedOn = reviewed ? (isDate(d.resolvedOn) ? d.resolvedOn : d.reviewOn) : undefined;
    const scenarios = Array.isArray(d.scenarios) && d.scenarios.length >= 2 ? d.scenarios : undefined;
    return clean({ ...d, stakes, category, resolvedOn, scenarios, outcome: typeof d.outcome === 'boolean' && !d.voided ? d.outcome : undefined, voided: d.voided === true ? true : undefined });
  });
  const categories = (Array.isArray(raw.categories) ? raw.categories : DEFAULT_CATEGORIES).filter((c): c is string => typeof c === 'string' && !!c.trim());
  for (const d of decisions) if (!categories.includes(d.category)) categories.push(d.category);
  return { ...raw, decisions, categories: categories.length ? categories : ['Other'] };
}
