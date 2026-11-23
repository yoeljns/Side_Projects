// Hit detection from a loudness envelope, and grouping hits into rallies.
// The envelope is high-passed signal energy in fixed bins of media time.

/** Seconds of media time per envelope bin. */
export const ENV_BIN = 0.025;

/** An impulsive sound: when, and how far (dB) it stands above the background. */
export type Peak = { t: number; prom: number };

const PEAK_FLOOR_DB = 8; // quietest peak worth keeping as a candidate
export const MIN_DB = 9, MAX_DB = 25, FALLBACK_DB = 14;
const MIN_GAP = 0.3; // seconds between two hits

/** Map a 0..100 sensitivity slider onto a dB threshold (100 = most sensitive). */
export const sensitivityToDb = (s: number): number => MAX_DB - (Math.min(100, Math.max(0, s)) / 100) * (MAX_DB - MIN_DB);
export const dbToSensitivity = (db: number): number => Math.round(((MAX_DB - db) / (MAX_DB - MIN_DB)) * 100);

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * Find every impulsive peak in the envelope: sharp onsets that are local
 * maxima and stand above the local background. Choosing which of them count
 * as hits is a separate, instant step (see selectHits).
 */
export function findPeaks(env: Float32Array, bin = ENV_BIN): Peak[] {
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

  const peakR = Math.max(1, Math.round(0.15 / bin)); // local max within ±0.15 s
  const riseR = Math.max(2, Math.round(0.075 / bin)); // sharp rise within 75 ms
  const peaks: Peak[] = [];
  for (let i = riseR; i < n; i++) {
    const v = db[i];
    const prom = v - base[Math.min(base.length - 1, Math.floor(i / step))];
    if (prom < PEAK_FLOOR_DB) continue;
    let isMax = true;
    for (let k = Math.max(0, i - peakR); k <= Math.min(n - 1, i + peakR); k++) {
      if (db[k] > v || (db[k] === v && k < i)) { isMax = false; break; }
    }
    if (!isMax) continue;
    let before = Infinity;
    for (let k = i - riseR; k < i; k++) before = Math.min(before, db[k]);
    if (v - before < 6) continue; // sustained sound (voices, music), not an impact
    peaks.push({ t: i * bin, prom });
  }
  return peaks;
}

/**
 * Pick the loudness threshold from the recording itself. Impacts on your own
 * court are much louder than the next court's or footsteps, so peak loudness
 * falls into two groups; Otsu's method finds the split between them.
 */
export function autoThresholdDb(peaks: Peak[]): number {
  if (peaks.length < 24) return FALLBACK_DB;
  const lo = PEAK_FLOOR_DB, hi = 45, bins = 74;
  const hist = new Array<number>(bins).fill(0);
  for (const p of peaks) hist[Math.min(bins - 1, Math.max(0, Math.floor(((p.prom - lo) / (hi - lo)) * bins)))]++;
  const total = peaks.length;
  let sumAll = 0;
  hist.forEach((c, i) => (sumAll += c * i));
  let w0 = 0, sum0 = 0, best = -1, bestI = -1;
  for (let i = 0; i < bins - 1; i++) {
    w0 += hist[i];
    sum0 += hist[i] * i;
    const w1 = total - w0;
    if (w0 === 0 || w1 === 0) continue;
    const m0 = sum0 / w0, m1 = (sumAll - sum0) / w1;
    const between = w0 * w1 * (m0 - m1) ** 2;
    if (between > best) { best = between; bestI = i; }
  }
  if (bestI < 0) return FALLBACK_DB;
  const db = lo + ((bestI + 1) / bins) * (hi - lo);
  return Math.min(MAX_DB - 3, Math.max(MIN_DB + 1, db));
}

/** Hits = peaks above the threshold, at least MIN_GAP apart (the louder one wins). */
export function selectHits(peaks: Peak[], thresholdDb: number): number[] {
  const hits: Peak[] = [];
  for (const p of peaks) {
    if (p.prom < thresholdDb) continue;
    const last = hits[hits.length - 1];
    if (last && p.t - last.t < MIN_GAP) {
      if (p.prom > last.prom) hits[hits.length - 1] = p;
      continue;
    }
    hits.push(p);
  }
  return hits.map((p) => p.t);
}

export const detectHits = (env: Float32Array, thresholdDb = FALLBACK_DB): number[] => selectHits(findPeaks(env), thresholdDb);

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
  /** Share of the analysed video spent in rallies, 0..1. */
  playPct: number;
  /** Average pause between consecutive rallies, seconds. */
  avgRestSec: number;
  /** Hits per second of rally: how fast the exchanges are. */
  tempo: number;
  /** [start, duration, hits] per rally, for the timeline. */
  list: [number, number, number][];
};

/** Rally duration: first to last hit, plus a second for the ball to die. */
export const rallyDuration = (r: Rally): number => r.end - r.start + 1;

export function summariseRallies(rallies: Rally[], analysedSec = 0): RallySummary {
  const durations = rallies.map((r) => Math.round(rallyDuration(r) * 10) / 10);
  const buckets = RALLY_BUCKETS.map(() => 0);
  for (const d of durations) buckets[RALLY_BUCKETS.findIndex((b) => d < b.max)]++;
  const count = rallies.length;
  const sum = durations.reduce((a, b) => a + b, 0);
  const hits = rallies.reduce((a, r) => a + r.hits, 0);
  const rests: number[] = [];
  for (let i = 1; i < count; i++) rests.push(rallies[i].start - rallies[i - 1].end - 1);
  return {
    count,
    avgSec: count ? sum / count : 0,
    medianSec: count ? median(durations) : 0,
    longestSec: count ? Math.max(...durations) : 0,
    avgHits: count ? hits / count : 0,
    durations,
    buckets,
    playPct: analysedSec > 0 ? Math.min(1, sum / analysedSec) : 0,
    avgRestSec: rests.length ? Math.max(0, rests.reduce((a, b) => a + b, 0) / rests.length) : 0,
    tempo: sum > 0 ? hits / sum : 0,
    list: rallies.map((r, i) => [Math.round(r.start * 10) / 10, durations[i], r.hits]),
  };
}
