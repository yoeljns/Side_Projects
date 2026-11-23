// Turns per-frame person detections (already projected onto the court floor)
// into four stable player tracks: two per side of the net.
import { COURT_L, COURT_W, NET_Y, type Pt, type Team } from './court';

export type Box = { x: number; y: number; w: number; h: number; score: number };
export type CourtDet = { p: Pt; box: Box };
export type Sample = { t: number; x: number; y: number };

/** Slots 0,1 are the near pair (camera side); 2,3 the far pair. */
export const SLOTS = [0, 1, 2, 3] as const;
export const SLOT_NAME = ['A', 'B', 'C', 'D'];
export const slotTeam = (slot: number): Team => (slot < 2 ? 'near' : 'far');

/** How far outside the lines a detection may land and still count (metres). */
const MARGIN_X = 0.5;
const MARGIN_NEAR = 2.5; // feet are often cut off at the bottom of the frame
const MARGIN_FAR = 0.8;
const UNSEEN_COST = 3; // metres; cost of handing a detection to a slot never seen

/** Keep detections whose feet are on (or just off) the court, clamped onto it. */
export function onCourt(p: Pt | null): Pt | null {
  if (!p) return null;
  if (p.x < -MARGIN_X || p.x > COURT_W + MARGIN_X) return null;
  if (p.y < -MARGIN_NEAR || p.y > COURT_L + MARGIN_FAR) return null;
  return { x: Math.min(COURT_W, Math.max(0, p.x)), y: Math.min(COURT_L, Math.max(0, p.y)) };
}

export type Assignment = { slot: number; det: CourtDet };

export class Tracker {
  last: (Pt | null)[] = [null, null, null, null];
  samples: Sample[][] = [[], [], [], []];

  update(t: number, dets: CourtDet[]): Assignment[] {
    const out: Assignment[] = [];
    for (const team of ['near', 'far'] as Team[]) {
      const slots = team === 'near' ? [0, 1] : [2, 3];
      const mine = dets
        .filter((d) => (d.p.y < NET_Y ? 'near' : 'far') === team)
        .sort((a, b) => b.box.score - a.box.score)
        .slice(0, 2);
      if (mine.length === 0) continue;
      const [s0, s1] = slots;
      const cost = (d: CourtDet, s: number): number => {
        const l = this.last[s];
        return l ? Math.hypot(d.p.x - l.x, d.p.y - l.y) : UNSEEN_COST;
      };
      if (mine.length === 2) {
        let [a, b] = mine;
        if (!this.last[s0] && !this.last[s1]) {
          // First sighting of the pair: left player takes the first slot.
          if (a.p.x > b.p.x) [a, b] = [b, a];
        } else if (cost(a, s0) + cost(b, s1) > cost(a, s1) + cost(b, s0)) {
          [a, b] = [b, a];
        }
        out.push({ slot: s0, det: a }, { slot: s1, det: b });
      } else {
        const d = mine[0];
        let slot: number;
        if (!this.last[s0] && !this.last[s1]) slot = d.p.x <= COURT_W / 2 ? s0 : s1;
        else slot = cost(d, s0) <= cost(d, s1) ? s0 : s1;
        out.push({ slot, det: d });
      }
    }
    for (const { slot, det } of out) {
      this.last[slot] = det.p;
      this.samples[slot].push({ t, x: det.p.x, y: det.p.y });
    }
    return out;
  }
}
