// Numbers derived from the player tracks.
import { COURT_W, GRID_L, GRID_W, NET_Y, NET_ZONE_M, ZONES, cellIndex, zoneOf, type Zone } from './court';
import type { Rally } from './hits';
import type { Sample } from './tracker';

/** Tracks are resampled onto this grid (seconds). */
export const STEP = 0.2;
/** A gap up to this long is bridged by interpolation (a brief occlusion). */
const FILL_GAP = 1.6;
const MAX_SPEED = 8; // m/s; faster steps are tracking glitches
const RALLY_PAD = 1; // seconds either side of a rally that still count as in play

/**
 * Cleans a raw track: resamples onto a regular grid, bridges short gaps and
 * lightly smooths. Everything downstream works on the result.
 */
export function refineTrack(samples: Sample[]): Sample[] {
  if (samples.length === 0) return [];
  const grid: Sample[] = [];
  let j = 0;
  const k0 = Math.ceil(samples[0].t / STEP), k1 = Math.floor(samples[samples.length - 1].t / STEP);
  for (let k = k0; k <= k1; k++) {
    const t = k * STEP;
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j], b = samples[Math.min(samples.length - 1, j + 1)];
    if (b.t < t || a.t > t) { if (Math.abs(a.t - t) < STEP / 2) grid.push({ t, x: a.x, y: a.y }); continue; }
    if (b.t - a.t > FILL_GAP) continue;
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    grid.push({ t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  if (grid.length === 0) return samples.map((s) => ({ ...s }));
  // 1-2-1 smoothing across neighbours that are actually adjacent in time.
  return grid.map((s, i) => {
    const p = grid[i - 1], n = grid[i + 1];
    if (!p || !n || s.t - p.t > STEP * 1.5 || n.t - s.t > STEP * 1.5) return s;
    return { t: s.t, x: (p.x + 2 * s.x + n.x) / 4, y: (p.y + 2 * s.y + n.y) / 4 };
  });
}

export type PlayerStats = {
  /** Seconds this player was tracked (within the chosen time filter). */
  seenSec: number;
  zoneSec: Record<Zone, number>;
  /** Share of tracked time per zone, 0..1. */
  zonePct: Record<Zone, number>;
  distanceM: number;
  /** Seconds per heatmap cell, row-major GRID_L × GRID_W. */
  heat: number[];
  /** Sustained top speed (95th percentile), m/s. */
  topSpeed: number;
  /** Average speed while tracked, m/s. */
  avgSpeed: number;
  /** Share of time on the player's own left-hand side of the court, 0..1. */
  leftPct: number;
  /** Times the player moved up from behind and settled at the net. */
  netApproaches: number;
  /** Average distance from the net, metres. */
  avgNetDist: number;
};

export function emptyStats(): PlayerStats {
  return {
    seenSec: 0,
    zoneSec: { net: 0, mid: 0, back: 0 },
    zonePct: { net: 0, mid: 0, back: 0 },
    distanceM: 0,
    heat: new Array(GRID_L * GRID_W).fill(0),
    topSpeed: 0,
    avgSpeed: 0,
    leftPct: 0,
    netApproaches: 0,
    avgNetDist: 0,
  };
}

/** Builds a fast "is t inside a rally" test over sorted rallies (ascending t only). */
function inPlayTest(rallies: Rally[] | null): (t: number) => boolean {
  if (!rallies) return () => true;
  let i = 0;
  return (t) => {
    while (i < rallies.length && rallies[i].end + RALLY_PAD < t) i++;
    return i < rallies.length && rallies[i].start - RALLY_PAD <= t;
  };
}

/**
 * @param track a refined track (see refineTrack)
 * @param rallies when given, only time during rallies counts ("in play only")
 * @param nearSide which side of the net the player is on, for left/right
 */
export function computeStats(track: Sample[], rallies: Rally[] | null = null, nearSide = true): PlayerStats {
  const s = emptyStats();
  const inPlay = inPlayTest(rallies);
  const speeds: number[] = [];
  let prev: Sample | null = null;
  let leftSec = 0, netDistSum = 0;
  // Net-approach state machine with hysteresis.
  let atNet = false, since = 0, armed = false;
  for (const cur of track) {
    if (!inPlay(cur.t)) { prev = null; continue; }
    const gap: number = prev ? cur.t - prev.t : Infinity;
    const adjacent = gap <= STEP * 1.5;
    const dt = STEP;
    s.seenSec += dt;
    s.zoneSec[zoneOf(cur.y)] += dt;
    s.heat[cellIndex(cur)] += dt;
    const d = Math.abs(cur.y - NET_Y);
    netDistSum += d * dt;
    if (nearSide ? cur.x < COURT_W / 2 : cur.x > COURT_W / 2) leftSec += dt;
    if (adjacent && prev) {
      const step = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const v = step / gap;
      if (v <= MAX_SPEED) { s.distanceM += step; speeds.push(v); }
    }
    if (!adjacent) { atNet = d <= NET_ZONE_M; since = cur.t; armed = false; }
    else if (atNet && d > NET_ZONE_M + 0.5) { atNet = false; since = cur.t; }
    else if (!atNet && d <= NET_ZONE_M) {
      if (cur.t - since >= 1) armed = true; // was properly behind before coming up
      atNet = true; since = cur.t;
    } else if (atNet && armed && cur.t - since >= 1) { s.netApproaches++; armed = false; }
    prev = cur;
  }
  if (s.seenSec > 0) {
    for (const z of ZONES) s.zonePct[z] = s.zoneSec[z] / s.seenSec;
    s.leftPct = leftSec / s.seenSec;
    s.avgNetDist = netDistSum / s.seenSec;
    s.avgSpeed = s.distanceM / s.seenSec;
  }
  if (speeds.length >= 5) {
    // Speed over ~0.6 s windows, so one jittery step can't set the record.
    const win: number[] = [];
    for (let i = 2; i < speeds.length; i++) win.push((speeds[i] + speeds[i - 1] + speeds[i - 2]) / 3);
    win.sort((a, b) => a - b);
    s.topSpeed = win[Math.floor(win.length * 0.95)] ?? 0;
  }
  s.heat = s.heat.map((v) => Math.round(v * 10) / 10);
  return s;
}

export type TeamStats = {
  /** Seconds both partners were tracked together. */
  bothSec: number;
  /** Shares of that time, 0..1. */
  bothNetPct: number;
  splitPct: number; // one up, one back
  bothBackPct: number;
  /** Average distance between the partners, metres. */
  gapM: number;
};

/** How a pair moved together. Both tracks must be refined (same time grid). */
export function computeTeam(a: Sample[], b: Sample[], rallies: Rally[] | null = null): TeamStats {
  const key = (t: number) => Math.round(t / STEP);
  const other = new Map<number, Sample>();
  for (const s of b) other.set(key(s.t), s);
  const inPlay = inPlayTest(rallies);
  let both = 0, bothNet = 0, split = 0, bothBack = 0, gap = 0;
  for (const s of a) {
    if (!inPlay(s.t)) continue;
    const o = other.get(key(s.t));
    if (!o) continue;
    both += STEP;
    const an = Math.abs(s.y - NET_Y) <= NET_ZONE_M, bn = Math.abs(o.y - NET_Y) <= NET_ZONE_M;
    if (an && bn) bothNet += STEP;
    else if (an || bn) split += STEP;
    else bothBack += STEP;
    gap += Math.hypot(s.x - o.x, s.y - o.y) * STEP;
  }
  return both > 0
    ? { bothSec: both, bothNetPct: bothNet / both, splitPct: split / both, bothBackPct: bothBack / both, gapM: gap / both }
    : { bothSec: 0, bothNetPct: 0, splitPct: 0, bothBackPct: 0, gapM: 0 };
}

/** Position on a refined track at time t, or null if the player wasn't tracked then. */
export function positionAt(track: Sample[], t: number): Sample | null {
  let lo = 0, hi = track.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = track[lo], b = track[lo + 1];
  if (a.t > t) return a.t - t < STEP * 2 ? a : null;
  if (!b || b.t - a.t > STEP * 2) return t - a.t < STEP * 2 ? a : null;
  const f = (t - a.t) / (b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
