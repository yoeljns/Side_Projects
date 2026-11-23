// Turns per-frame person detections (already projected onto the court floor)
// into four stable player tracks: two per side of the net.
//
// Each track runs a constant-velocity (alpha-beta) filter. Detections are
// matched to tracks by solving the whole assignment at once, with a cost made
// of distance from the predicted position plus shirt-colour difference, and
// with hard gates: a player cannot teleport, and cannot cross the net.
import { COURT_L, COURT_W, NET_Y, type Pt, type Team } from './court';

export type Box = { x: number; y: number; w: number; h: number; score: number };
/** A detection on the court floor. `app` is a colour histogram of the torso. */
export type CourtDet = {
  p: Pt;
  box: Box;
  app?: Float32Array | null;
  /** Found by motion only, not by the person detector: may continue a track but not start one. */
  weak?: boolean;
};
export type Sample = { t: number; x: number; y: number };

/** Slots 0,1 are the near pair (camera side); 2,3 the far pair. */
export const SLOTS = [0, 1, 2, 3] as const;
export const SLOT_NAME = ['A', 'B', 'C', 'D'];
export const slotTeam = (slot: number): Team => (slot < 2 ? 'near' : 'far');
export const partnerOf = (slot: number): number => slot ^ 1;

/** How far outside the lines a detection may land and still count (metres). */
const MARGIN_X = 0.3; // spectators stand right against the side glass
const MARGIN_NEAR = 2.5; // feet are often cut off at the bottom of the frame
const MARGIN_FAR = 0.8;

const MAX_SPEED = 7.5; // m/s
const GATE_BASE = 1.6; // metres of slack on top of what speed allows
const STALE_SEC = 3; // after this long unseen, a track may be re-acquired anywhere on its side
const NET_SLACK = 1.0; // projection error allowed across the net line
const MISS_COST = 5; // leaving a track unmatched
const UNSEEN_COST = 3; // starting a track
const WEAK_COST = 0.8; // a real detection is preferred over a motion-only one this much closer
const APP_WEIGHT = 3; // metres of cost for a completely different shirt colour
const ALPHA = 0.65, BETA = 0.25;

/** Keep detections whose feet are on (or just off) the court, clamped onto it. */
export function onCourt(p: Pt | null): Pt | null {
  if (!p) return null;
  if (p.x < -MARGIN_X || p.x > COURT_W + MARGIN_X) return null;
  if (p.y < -MARGIN_NEAR || p.y > COURT_L + MARGIN_FAR) return null;
  return { x: Math.min(COURT_W, Math.max(0, p.x)), y: Math.min(COURT_L, Math.max(0, p.y)) };
}

/** Bhattacharyya distance between two normalised histograms, 0 (same) .. 1. */
export function appearanceDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i]);
  return Math.max(0, 1 - s);
}

export type Assignment = { slot: number; det: CourtDet };

type Track = { pos: Pt; vel: Pt; t: number; app: Float32Array | null };

export class Tracker {
  tracks: (Track | null)[] = [null, null, null, null];
  samples: Sample[][] = [[], [], [], []];

  private predict(tr: Track, t: number): Pt {
    const dt = Math.min(1, Math.max(0, t - tr.t));
    return { x: tr.pos.x + tr.vel.x * dt, y: tr.pos.y + tr.vel.y * dt };
  }

  private cost(slot: number, d: CourtDet, t: number): number {
    const near = slot < 2;
    const tr = this.tracks[slot];
    if (d.weak && (!tr || t - tr.t >= STALE_SEC)) return Infinity;
    if (!tr) {
      if (near ? d.p.y >= NET_Y : d.p.y < NET_Y) return Infinity;
      // First sighting: the left player of a pair takes the pair's first slot.
      const prefX = slot % 2 === 0 ? COURT_W * 0.25 : COURT_W * 0.75;
      return UNSEEN_COST + 0.3 * Math.abs(d.p.x - prefX);
    }
    if (near ? d.p.y > NET_Y + NET_SLACK : d.p.y < NET_Y - NET_SLACK) return Infinity;
    const dt = t - tr.t;
    const pred = this.predict(tr, t);
    const dist = Math.hypot(d.p.x - pred.x, d.p.y - pred.y);
    if (dt < STALE_SEC && dist > GATE_BASE + MAX_SPEED * dt) return Infinity;
    const app = tr.app && d.app ? APP_WEIGHT * appearanceDistance(tr.app, d.app) : 0;
    // A long-lost track is found again mostly by colour, not by where it was.
    return Math.min(dist, dt < STALE_SEC ? Infinity : 4) + app + (d.weak ? WEAK_COST : 0);
  }

  /** Cheapest assignment of detections to the four slots (each det used once). */
  private solve(costs: number[][], nDets: number): number[] {
    let best = Infinity;
    let bestPick = [-1, -1, -1, -1];
    const pick = [-1, -1, -1, -1];
    const used = new Array<boolean>(nDets).fill(false);
    const go = (slot: number, total: number): void => {
      if (total >= best) return;
      if (slot === 4) { best = total; bestPick = pick.slice(); return; }
      for (let j = 0; j < nDets; j++) {
        const c = costs[slot][j];
        if (used[j] || !isFinite(c)) continue;
        used[j] = true; pick[slot] = j;
        go(slot + 1, total + c);
        used[j] = false;
      }
      pick[slot] = -1;
      go(slot + 1, total + MISS_COST);
    };
    go(0, 0);
    return bestPick;
  }

  update(t: number, all: CourtDet[]): Assignment[] {
    const dets = all.slice().sort((a, b) => b.box.score - a.box.score).slice(0, 8);
    const costs = SLOTS.map((s) => dets.map((d) => this.cost(s, d, t)));
    const pick = this.solve(costs, dets.length);
    const out: Assignment[] = [];
    for (const slot of SLOTS) {
      if (pick[slot] < 0) continue;
      const det = dets[pick[slot]];
      const tr = this.tracks[slot];
      if (!tr || t - tr.t >= STALE_SEC) {
        this.tracks[slot] = { pos: { ...det.p }, vel: { x: 0, y: 0 }, t, app: det.app ?? tr?.app ?? null };
      } else {
        const dt = Math.max(1e-3, t - tr.t);
        const pred = this.predict(tr, t);
        const rx = det.p.x - pred.x, ry = det.p.y - pred.y;
        tr.pos = { x: pred.x + ALPHA * rx, y: pred.y + ALPHA * ry };
        let vx = tr.vel.x + (BETA / dt) * rx, vy = tr.vel.y + (BETA / dt) * ry;
        const sp = Math.hypot(vx, vy);
        if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; }
        tr.vel = { x: vx, y: vy };
        tr.t = t;
        if (det.app) {
          if (!tr.app) tr.app = det.app;
          else for (let i = 0; i < tr.app.length; i++) tr.app[i] += 0.08 * (det.app[i] - tr.app[i]);
        }
      }
      const p = this.tracks[slot]!.pos;
      this.samples[slot].push({
        t,
        x: Math.min(COURT_W, Math.max(0, p.x)),
        y: Math.min(COURT_L, Math.max(0, p.y)),
      });
      out.push({ slot, det });
    }
    return out;
  }
}
