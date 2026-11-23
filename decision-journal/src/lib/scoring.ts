// Forecast scoring. Every formula the app uses is in this one file, so it can
// be lined up with the quant engine if that scores differently.
//
// Conventions
//   p   stated probability (0..1) that the outcome happens
//   o   what happened: 1 or 0
//   Brier (binary)  (p - o)^2                       0 best, 1 worst, 0.25 = always saying 50%
//   Brier (multi)   sum over outcomes (p_i - o_i)^2  0 best, 2 worst (for two outcomes this is twice the binary form)
//   Log score       ln(probability given to what happened), natural log
//                   0 best, more negative is worse, ln(0.5) = -0.693 = always saying 50%
//   Means are plain averages over scored decisions. Void decisions are never scored.
//
// A scenario decision enters the yes/no numbers through its contract fields:
// the top scenario's probability and whether that scenario happened. Its full
// scenario scores are reported separately (multiSummary).
import type { Decision, Stakes } from './model';
import { statusOf } from './model';

/** Probabilities are clamped to [LOG_FLOOR, 1 - LOG_FLOOR] before taking logs, so a 0% or 100% miss scores ln(0.001) = -6.91 instead of minus infinity. */
export const LOG_FLOOR = 0.001;

/** Below this many scored decisions the numbers are shown but labelled as too few to read. */
export const MIN_READABLE = 20;

/** Default number of equal-width probability bins. */
export const DEFAULT_BINS = 10;

export const brierBinary = (p: number, o: boolean | 0 | 1): number => (p - (o ? 1 : 0)) ** 2;

/** Multi-category Brier score: sum over outcomes of (p_i - o_i)^2. Range 0..2. */
export function brierMulti(probs: number[], happened: number): number {
  return probs.reduce((sum, p, i) => sum + (p - (i === happened ? 1 : 0)) ** 2, 0);
}

const clampP = (p: number) => Math.min(1 - LOG_FLOOR, Math.max(LOG_FLOOR, p));

/** ln of the probability given to what happened. */
export const logScoreBinary = (p: number, o: boolean | 0 | 1): number => Math.log(clampP(o ? p : 1 - p));

export const logScoreMulti = (probs: number[], happened: number): number => Math.log(clampP(probs[happened]));

/** 1 - score / reference: 0 = no better than the reference, 1 = perfect, negative = worse. Null when the reference is already perfect. */
export const skillScore = (score: number, reference: number): number | null => (reference > 0 ? 1 - score / reference : null);

export interface Forecast {
  id: string;
  p: number;
  o: 0 | 1;
  madeOn: string;
  resolvedOn: string;
  category: string;
  stakes: Stakes;
}

/** The decisions that count: reviewed with a yes/no outcome, not void. */
export function scoredForecasts(decisions: Decision[]): Forecast[] {
  return decisions
    .filter((d) => statusOf(d) === 'resolved')
    .map((d) => ({ id: d.id, p: d.probability, o: d.outcome ? 1 : 0, madeOn: d.madeOn, resolvedOn: d.resolvedOn ?? d.reviewOn, category: d.category, stakes: d.stakes }));
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

// ----- calibration bins -----

/** Wilson score interval for a proportion: stays inside 0..1 and is honest at small n. z = 1.96 is 95%. */
export function wilson(hits: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const ph = hits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (ph + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((ph * (1 - ph)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** Bin index for a probability: equal-width bins, lower edge included, 1.0 in the last bin. */
export function binIndex(p: number, bins = DEFAULT_BINS): number {
  return Math.min(bins - 1, Math.max(0, Math.floor(p * bins + 1e-9)));
}

export interface Bin {
  index: number;
  lo: number;
  hi: number;
  n: number;
  hits: number;
  /** Mean stated probability in the bin (null when empty). */
  meanP: number | null;
  /** Share that happened (null when empty). */
  rate: number | null;
  /** 95% Wilson interval on `rate`. */
  ci: { lo: number; hi: number } | null;
}

export function calibrationBins(fs: Forecast[], bins = DEFAULT_BINS): Bin[] {
  const out: Bin[] = Array.from({ length: bins }, (_, i) => ({ index: i, lo: i / bins, hi: (i + 1) / bins, n: 0, hits: 0, meanP: null, rate: null, ci: null }));
  const sumP = new Array<number>(bins).fill(0);
  for (const f of fs) {
    const b = out[binIndex(f.p, bins)];
    b.n += 1;
    b.hits += f.o;
    sumP[b.index] += f.p;
  }
  for (const b of out) {
    if (!b.n) continue;
    b.meanP = sumP[b.index] / b.n;
    b.rate = b.hits / b.n;
    b.ci = wilson(b.hits, b.n);
  }
  return out;
}

// ----- Murphy decomposition -----

export interface Murphy {
  /** Mean squared gap between what each bin said and what happened in it. 0 is perfectly calibrated. Lower is better. */
  reliability: number;
  /** How far the bins' hit rates spread from the base rate. Higher is better: the forecasts sort cases apart. */
  resolution: number;
  /** baseRate * (1 - baseRate): how hard the questions were. Not under the forecaster's control. */
  uncertainty: number;
  /** Brier - (reliability - resolution + uncertainty). Zero when every forecast in a bin is the same number; otherwise the spread of forecasts inside bins. */
  withinBin: number;
}

/** Brier = reliability - resolution + uncertainty (+ withinBin when forecasts differ inside a bin). */
export function murphy(fs: Forecast[], bins = DEFAULT_BINS): Murphy | null {
  if (!fs.length) return null;
  const n = fs.length;
  const base = mean(fs.map((f) => f.o));
  let reliability = 0;
  let resolution = 0;
  for (const b of calibrationBins(fs, bins)) {
    if (!b.n) continue;
    reliability += (b.n / n) * (b.meanP! - b.rate!) ** 2;
    resolution += (b.n / n) * (b.rate! - base) ** 2;
  }
  const uncertainty = base * (1 - base);
  const brier = mean(fs.map((f) => brierBinary(f.p, f.o)));
  return { reliability, resolution, uncertainty, withinBin: brier - (reliability - resolution + uncertainty) };
}

// ----- overconfidence -----

/**
 * Mean stated confidence minus hit rate, after folding every forecast onto the
 * side it leaned: p below 50% becomes confidence 1 - p in "it will not happen".
 * Positive = overconfident, negative = underconfident. A forecast of exactly
 * 50% leans neither way and counts as half a hit.
 */
export function overconfidence(fs: Forecast[]): { confidence: number; hitRate: number; gap: number } | null {
  if (!fs.length) return null;
  const confidence = mean(fs.map((f) => Math.max(f.p, 1 - f.p)));
  const hitRate = mean(fs.map((f) => (f.p === 0.5 ? 0.5 : f.p > 0.5 ? f.o : 1 - f.o)));
  return { confidence, hitRate, gap: confidence - hitRate };
}

// ----- summary -----

export interface Summary {
  n: number;
  /** n >= MIN_READABLE. */
  readable: boolean;
  brier: number;
  logScore: number;
  /** Share of outcomes that happened. */
  baseRate: number;
  meanP: number;
  /** Brier of always forecasting the base rate of these same decisions (known only in hindsight): baseRate * (1 - baseRate). */
  brierBaseRate: number;
  /** Skill against that base-rate forecast. Null when every outcome was the same. */
  skillVsBaseRate: number | null;
  /** Skill against always saying 50% (Brier 0.25). */
  skillVsFifty: number;
  murphy: Murphy;
  overconfidence: { confidence: number; hitRate: number; gap: number };
}

export const BRIER_FIFTY = 0.25;
export const LOG_FIFTY = Math.log(0.5);

export function summarise(fs: Forecast[], bins = DEFAULT_BINS): Summary | null {
  if (!fs.length) return null;
  const brier = mean(fs.map((f) => brierBinary(f.p, f.o)));
  const baseRate = mean(fs.map((f) => f.o));
  const brierBaseRate = baseRate * (1 - baseRate);
  return {
    n: fs.length,
    readable: fs.length >= MIN_READABLE,
    brier,
    logScore: mean(fs.map((f) => logScoreBinary(f.p, f.o))),
    baseRate,
    meanP: mean(fs.map((f) => f.p)),
    brierBaseRate,
    skillVsBaseRate: skillScore(brier, brierBaseRate),
    skillVsFifty: skillScore(brier, BRIER_FIFTY)!,
    murphy: murphy(fs, bins)!,
    overconfidence: overconfidence(fs)!,
  };
}

// ----- over time -----

export interface RollingPoint {
  id: string;
  resolvedOn: string;
  /** Brier of this one decision. */
  brier: number;
  /** Mean Brier of this and the previous decisions, at most `window` of them. */
  rolling: number;
  /** How many decisions are in `rolling`. Less than the window at the start. */
  n: number;
  /** Mean Brier of everything resolved so far. */
  cumulative: number;
}

/** In order of resolution (ties: decision date, then id). */
export function byResolution(fs: Forecast[]): Forecast[] {
  return [...fs].sort((a, b) => a.resolvedOn.localeCompare(b.resolvedOn) || a.madeOn.localeCompare(b.madeOn) || a.id.localeCompare(b.id));
}

export function rollingBrier(fs: Forecast[], window = 10): RollingPoint[] {
  const sorted = byResolution(fs);
  const scores = sorted.map((f) => brierBinary(f.p, f.o));
  let total = 0;
  return sorted.map((f, i) => {
    total += scores[i];
    const slice = scores.slice(Math.max(0, i - window + 1), i + 1);
    return { id: f.id, resolvedOn: f.resolvedOn, brier: scores[i], rolling: mean(slice), n: slice.length, cumulative: total / (i + 1) };
  });
}

// ----- breakdowns -----

export interface Group {
  key: string;
  n: number;
  brier: number;
  logScore: number;
  /** Share that happened. */
  baseRate: number;
  meanP: number;
  /** Folded confidence minus hit rate: see overconfidence(). */
  gap: number;
}

/** One row per distinct key, most decisions first (ties by name). */
export function breakdown(fs: Forecast[], key: (f: Forecast) => string): Group[] {
  const groups = new Map<string, Forecast[]>();
  for (const f of fs) groups.set(key(f), [...(groups.get(key(f)) ?? []), f]);
  return [...groups.entries()]
    .map(([k, g]) => {
      const s = summarise(g)!;
      return { key: k, n: s.n, brier: s.brier, logScore: s.logScore, baseRate: s.baseRate, meanP: s.meanP, gap: s.overconfidence.gap };
    })
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

// ----- scenario decisions -----

export interface MultiSummary {
  n: number;
  /** Mean multi-category Brier, 0..2. */
  brier: number;
  /** Mean ln(probability given to the scenario that happened). */
  logScore: number;
  /** Mean Brier of giving every scenario the same probability, for comparison: 1 - 1/k per decision. */
  brierUniform: number;
}

/** Full scenario scores for resolved multi-outcome decisions. */
export function multiSummary(decisions: Decision[]): MultiSummary | null {
  const rows = decisions.flatMap((d) => {
    if (statusOf(d) !== 'resolved' || !d.scenarios) return [];
    const happened = d.scenarios.findIndex((s) => s.id === d.resolvedScenarioId);
    if (happened < 0) return [];
    const probs = d.scenarios.map((s) => s.probability);
    return [{ brier: brierMulti(probs, happened), log: logScoreMulti(probs, happened), uniform: 1 - 1 / probs.length }];
  });
  if (!rows.length) return null;
  return { n: rows.length, brier: mean(rows.map((r) => r.brier)), logScore: mean(rows.map((r) => r.log)), brierUniform: mean(rows.map((r) => r.uniform)) };
}

// ----- one result -----

export interface Impact {
  p: number;
  o: 0 | 1;
  /** This decision's own scores. */
  brier: number;
  logScore: number;
  /** Mean Brier of every other scored decision; null if this is the first. */
  brierBefore: number | null;
  /** Mean Brier including this one. */
  brierAfter: number;
  /** after - before. Negative means the average got better. */
  delta: number | null;
  /** Scored decisions including this one. */
  n: number;
}

/** What one resolved decision did to the average. Null if it is not scored (open or void). */
export function impactOf(decisions: Decision[], id: string): Impact | null {
  const all = scoredForecasts(decisions);
  const f = all.find((x) => x.id === id);
  if (!f) return null;
  const others = all.filter((x) => x.id !== id).map((x) => brierBinary(x.p, x.o));
  const own = brierBinary(f.p, f.o);
  const before = others.length ? mean(others) : null;
  const after = (others.reduce((a, b) => a + b, 0) + own) / all.length;
  return { p: f.p, o: f.o, brier: own, logScore: logScoreBinary(f.p, f.o), brierBefore: before, brierAfter: after, delta: before === null ? null : after - before, n: all.length };
}

// ----- decision quality against outcome -----

export interface QualityMatrix {
  goodWorked: number;
  /** Good call, bad result: bad luck. */
  goodFailed: number;
  /** Bad call, good result: got away with it. */
  badWorked: number;
  badFailed: number;
  /** Resolved decisions with no good/bad verdict. */
  unrated: number;
}

export function qualityMatrix(decisions: Decision[]): QualityMatrix {
  const m: QualityMatrix = { goodWorked: 0, goodFailed: 0, badWorked: 0, badFailed: 0, unrated: 0 };
  for (const d of decisions) {
    if (statusOf(d) !== 'resolved') continue;
    if (d.quality === 'good') m[d.outcome ? 'goodWorked' : 'goodFailed'] += 1;
    else if (d.quality === 'bad') m[d.outcome ? 'badWorked' : 'badFailed'] += 1;
    else m.unrated += 1;
  }
  return m;
}

// ----- words -----

/** A plain-words reading of a stated probability. */
export function probabilityWords(p: number): string {
  if (p < 0.05) return 'almost certainly not';
  if (p < 0.2) return 'very unlikely';
  if (p < 0.45) return 'unlikely';
  if (p <= 0.55) return 'about even';
  if (p <= 0.8) return 'likely';
  if (p <= 0.95) return 'very likely';
  return 'almost certain';
}

/** What a mean binary Brier score amounts to, against the always-50% yardstick. */
export function brierWords(brier: number): string {
  if (brier <= 0.1) return 'Sharp: confident calls that mostly came true.';
  if (brier <= 0.2) return 'Better than always saying 50%.';
  if (brier <= 0.25) return 'Close to what always saying 50% would score.';
  return 'Worse than always saying 50%: confident calls went the wrong way.';
}

/** What the overconfidence gap amounts to. Within 5 points either way is called calibrated. */
export function gapWords(gap: number): string {
  if (gap > 0.05) return 'Overconfident';
  if (gap < -0.05) return 'Underconfident';
  return 'About right';
}
