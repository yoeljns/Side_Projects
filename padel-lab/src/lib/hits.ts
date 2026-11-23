// Hit detection from a loudness envelope, and grouping hits into rallies.
// The envelope is high-passed signal energy in fixed bins of media time.

/** Seconds of media time per envelope bin. */
export const ENV_BIN = 0.025;

export type HitOptions = {
  /** How far (dB) a peak must stand above the local background. Lower = more sensitive. */
  thresholdDb: number;
  /** Minimum time between two hits, seconds. */
  minGap: number;
};

export const DEFAULT_HIT_OPTIONS: HitOptions = { thresholdDb: 14, minGap: 0.3 };

/** Map a 0..100 sensitivity slider onto a dB threshold (100 = most sensitive). */
export const sensitivityToDb = (s: number): number => 24 - (Math.min(100, Math.max(0, s)) / 100) * 16;
export const DEFAULT_SENSITIVITY = 62; // ≈ 14 dB

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * Find impulsive peaks (racket hits, and loud bounces off glass) in the envelope.
 * Returns hit times in seconds of media time.
 */
export function detectHits(env: Float32Array, opts: HitOptions = DEFAULT_HIT_OPTIONS, bin = ENV_BIN): number[] {
  const n = env.length;
  if (n < 8) return [];
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) db[i] = 10 * Math.log10(env[i] + 1e-12);

  // Local background: median over ±1.5 s, sampled every `step` bins.
  const half = Math.round(1.5 / bin);
  const step = Math.max(1, Math.round(0.25 / bin));
  const base = new Float32Array(Math.ceil(n / step));
  for (let j = 0; j < base.length; j++) {
    const c = j * step;
    const win: number[] = [];
    for (let k = Math.max(0, c - half); k < Math.min(n, c + half); k += 2) win.push(db[k]);
    base[j] = median(win);
  }

  const peakR = Math.max(1, Math.round(0.15 / bin)); // must be the local max within ±0.15 s
  const riseR = Math.max(2, Math.round(0.075 / bin)); // and rise sharply within 75 ms
  const minGapBins = Math.round(opts.minGap / bin);
  const hits: number[] = [];
  let last = -Infinity;
  for (let i = riseR; i < n; i++) {
    const v = db[i];
    if (v - base[Math.min(base.length - 1, Math.floor(i / step))] < opts.thresholdDb) continue;
    let isMax = true;
    for (let k = Math.max(0, i - peakR); k <= Math.min(n - 1, i + peakR); k++) {
      if (db[k] > v || (db[k] === v && k < i)) { isMax = false; break; }
    }
    if (!isMax) continue;
    let before = Infinity;
    for (let k = i - riseR; k < i; k++) before = Math.min(before, db[k]);
    if (v - before < 6) continue; // sustained sound (voices, music), not an impact
    if (i - last < minGapBins) continue;
    hits.push(i * bin);
    last = i;
  }
  return hits;
}

export type Rally = { start: number; end: number; hits: number };

export type RallyOptions = {
  /** Longest silence between two shots of the same rally, seconds. */
  maxGap: number;
  /** A rally needs at least this many hits. */
  minHits: number;
};

export const DEFAULT_RALLY_OPTIONS: RallyOptions = { maxGap: 4.5, minHits: 2 };

/** Group hits into rallies: consecutive hits closer than maxGap belong together. */
export function groupRallies(hits: number[], opts: RallyOptions = DEFAULT_RALLY_OPTIONS): Rally[] {
  const rallies: Rally[] = [];
  let i = 0;
  while (i < hits.length) {
    let j = i;
    while (j + 1 < hits.length && hits[j + 1] - hits[j] <= opts.maxGap) j++;
    const count = j - i + 1;
    if (count >= opts.minHits) rallies.push({ start: hits[i], end: hits[j], hits: count });
    i = j + 1;
  }
  return rallies;
}

export const RALLY_BUCKETS: { label: string; max: number }[] = [
  { label: '<5 s', max: 5 },
  { label: '5–10 s', max: 10 },
  { label: '10–20 s', max: 20 },
  { label: '20–30 s', max: 30 },
  { label: '30 s+', max: Infinity },
];

export type RallySummary = {
  count: number;
  avgSec: number;
  medianSec: number;
  longestSec: number;
  avgHits: number;
  /** Rally durations in seconds, in match order. */
  durations: number[];
  buckets: number[];
};

/** Rally duration: first to last hit, plus a second for the ball to die. */
export const rallyDuration = (r: Rally): number => r.end - r.start + 1;

export function summariseRallies(rallies: Rally[]): RallySummary {
  const durations = rallies.map((r) => Math.round(rallyDuration(r) * 10) / 10);
  const buckets = RALLY_BUCKETS.map(() => 0);
  for (const d of durations) buckets[RALLY_BUCKETS.findIndex((b) => d < b.max)]++;
  const count = rallies.length;
  const sum = durations.reduce((a, b) => a + b, 0);
  return {
    count,
    avgSec: count ? sum / count : 0,
    medianSec: count ? median(durations) : 0,
    longestSec: count ? Math.max(...durations) : 0,
    avgHits: count ? rallies.reduce((a, r) => a + r.hits, 0) / count : 0,
    durations,
    buckets,
  };
}
