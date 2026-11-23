// Per-player numbers derived from track samples.
import { GRID_L, GRID_W, ZONES, cellIndex, zoneOf, type Zone } from './court';
import type { Rally } from './hits';
import type { Sample } from './tracker';

/** A gap longer than this between two sightings is not credited as time on court. */
const MAX_DT = 1;
const NOMINAL_DT = 0.2;
const MAX_SPEED = 8; // m/s; faster steps are tracking glitches
const RALLY_PAD = 1; // seconds either side of a rally that still count as in play

export type PlayerStats = {
  /** Seconds this player was tracked (within the chosen time filter). */
  seenSec: number;
  zoneSec: Record<Zone, number>;
  /** Share of tracked time per zone, 0..1. */
  zonePct: Record<Zone, number>;
  distanceM: number;
  /** Seconds per heatmap cell, row-major GRID_L × GRID_W. */
  heat: number[];
};

export function emptyStats(): PlayerStats {
  return {
    seenSec: 0,
    zoneSec: { net: 0, mid: 0, back: 0 },
    zonePct: { net: 0, mid: 0, back: 0 },
    distanceM: 0,
    heat: new Array(GRID_L * GRID_W).fill(0),
  };
}

/** Builds a fast "is t inside a rally" test over sorted rallies. */
function inPlayTest(rallies: Rally[]): (t: number) => boolean {
  let i = 0;
  return (t) => {
    while (i < rallies.length && rallies[i].end + RALLY_PAD < t) i++;
    return i < rallies.length && rallies[i].start - RALLY_PAD <= t;
  };
}

/**
 * @param rallies when given, only samples during rallies count ("in play only").
 */
export function computeStats(samples: Sample[], rallies: Rally[] | null = null): PlayerStats {
  const s = emptyStats();
  const inPlay = rallies ? inPlayTest(rallies) : () => true;
  let prev: Sample | null = null;
  let sx = 0, sy = 0; // smoothed position, for distance
  for (const cur of samples) {
    if (!inPlay(cur.t)) { prev = null; continue; }
    const gap: number = prev ? cur.t - prev.t : Infinity;
    const dt = gap <= MAX_DT ? gap : NOMINAL_DT;
    s.seenSec += dt;
    s.zoneSec[zoneOf(cur.y)] += dt;
    s.heat[cellIndex(cur)] += dt;
    if (gap <= MAX_DT) {
      const nx = sx + 0.5 * (cur.x - sx), ny = sy + 0.5 * (cur.y - sy);
      const step = Math.hypot(nx - sx, ny - sy);
      if (step <= MAX_SPEED * gap) s.distanceM += step;
      sx = nx; sy = ny;
    } else {
      sx = cur.x; sy = cur.y;
    }
    prev = cur;
  }
  if (s.seenSec > 0) for (const z of ZONES) s.zonePct[z] = s.zoneSec[z] / s.seenSec;
  s.heat = s.heat.map((v) => Math.round(v * 10) / 10);
  return s;
}
