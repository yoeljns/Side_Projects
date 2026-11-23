// One analysis step: find the players in a frame and update their tracks.
// Shared by the live analyzer and the offline accuracy harness.
import { COURT_L, COURT_W, NET_Y, type Pt } from './court';
import type { PersonDetector } from './detector';
import { project, type H } from './homography';
import { MotionFinder } from './motion';
import { farRegion, roiTile, type Tile } from './tiles';
import { onCourt, Tracker, type Assignment, type Box, type CourtDet } from './tracker';

/** The whole court is re-scanned at least every this many samples. */
const FULL_SCAN_EVERY = 5;
const PLAYER_M = 1.7; // typical standing height
const FEET_NOISE_PX = 4; // how well the bottom of a box marks the feet
const SIZE_NOISE = 0.12; // how well a box's height marks a player's size (posture varies)
const TABLE_STEP = 0.125;

export class Sampler {
  readonly tracker = new Tracker();
  frames = 0;
  /** Where each player was in the previous sample (frame pixels), if seen. */
  private lastBox: (Box | null)[] = [null, null, null, null];
  private motion: MotionFinder | null = null;
  /** Along the court's centre line: image row and pixels-per-metre at each depth. */
  private rowAt: number[] = [];
  private pxPerM: number[] = [];

  constructor(
    private detector: PersonDetector,
    private toCourt: H,
    toImage: H,
    private tiles: Tile[],
    private W: number,
    private Hh: number,
  ) {
    for (let y = 0; y <= COURT_L + 1e-6; y += TABLE_STEP) {
      const a = project(toImage, { x: COURT_W / 2 - 0.5, y }), b = project(toImage, { x: COURT_W / 2 + 0.5, y });
      this.rowAt.push(a && b ? (a.y + b.y) / 2 : NaN);
      this.pxPerM.push(a && b ? Math.hypot(b.x - a.x, b.y - a.y) : NaN);
    }
    const far = farRegion(toImage, W, Hh);
    const farScale = this.pxPerM[this.pxPerM.length - 1];
    if (far && isFinite(farScale)) this.motion = new MotionFinder(far, farScale * PLAYER_M);
  }

  /**
   * Where a box's owner stands. The bottom of the box gives the feet, but from
   * a low camera the far half of the court spans only a few dozen pixel rows
   * (and the net hides legs), so a few pixels of error is metres of depth.
   * The box's height is a second, independent depth cue. The two are combined
   * by how much each one can be trusted at that spot; from a high camera the
   * feet win outright.
   */
  private locate(box: Box): Pt | null {
    const cx = box.x + box.w / 2;
    const feet = project(this.toCourt, { x: cx, y: box.y + box.h });
    if (!feet) return null;
    const n = this.rowAt.length;
    const i = Math.min(n - 2, Math.max(1, Math.round(feet.y / TABLE_STEP)));
    if (!isFinite(this.rowAt[i - 1]) || !isFinite(this.rowAt[i + 1])) return feet;
    const rowSlope = Math.abs(this.rowAt[i + 1] - this.rowAt[i - 1]) / (2 * TABLE_STEP); // px of row per metre of depth
    const sizeSlope = (Math.abs(this.pxPerM[i + 1] - this.pxPerM[i - 1]) / (2 * TABLE_STEP)) * PLAYER_M; // px of height per metre
    // Depth at which a standing player would appear exactly this tall.
    let best = -1, bestErr = Infinity;
    const side = feet.y < NET_Y ? [0, NET_Y] : [NET_Y, COURT_L];
    for (let k = Math.round(side[0] / TABLE_STEP); k <= Math.round(side[1] / TABLE_STEP); k++) {
      const e = Math.abs(this.pxPerM[k] * PLAYER_M - box.h);
      if (e < bestErr) { bestErr = e; best = k; }
    }
    if (best < 0) return feet;
    const wFeet = (rowSlope / FEET_NOISE_PX) ** 2, wSize = (sizeSlope / (SIZE_NOISE * box.h)) ** 2;
    const y = (wFeet * feet.y + wSize * best * TABLE_STEP) / (wFeet + wSize);
    // Slide along the line of sight: same image column, the row of the fused depth.
    const row = this.rowAt[Math.min(n - 1, Math.max(0, Math.round(y / TABLE_STEP)))];
    const p = isFinite(row) ? project(this.toCourt, { x: cx, y: row }) : null;
    return p ? { x: p.x, y } : { x: feet.x, y };
  }

  step(frame: CanvasImageSource, t: number): Assignment[] {
    // Zoom in on each player we already follow; scan the whole court as well
    // whenever someone is missing, and periodically regardless.
    const rois = this.lastBox.filter((b): b is Box => !!b).map((b) => roiTile(b, this.W, this.Hh));
    const fullScan = rois.length < 4 || this.frames % FULL_SCAN_EVERY === 0;
    this.frames++;
    const boxes = this.detector.detect(frame, fullScan ? [...rois, ...this.tiles] : rois);
    const dets: CourtDet[] = [];
    for (const box of boxes) {
      const p = onCourt(this.locate(box));
      if (p) dets.push({ p, box, app: this.detector.appearance(frame, box) });
    }

    if (this.motion) {
      // Near players stand in front of the far court in the image: hide them.
      const hide = dets.filter((d) => d.p.y < NET_Y).map((d) => d.box);
      for (const s of [0, 1]) if (this.lastBox[s]) hide.push(this.lastBox[s]!);
      for (const box of this.motion.find(frame, t, hide)) {
        const covered = dets.some((d) => {
          const ix = Math.min(d.box.x + d.box.w, box.x + box.w) - Math.max(d.box.x, box.x);
          return ix > 0.4 * Math.min(d.box.w, box.w);
        });
        if (covered) continue;
        const p = onCourt(this.locate(box));
        if (p && p.y >= NET_Y) dets.push({ p, box, app: this.detector.appearance(frame, box), weak: true });
      }
    }

    const assignments = this.tracker.update(t, dets);
    this.lastBox = [null, null, null, null];
    for (const a of assignments) this.lastBox[a.slot] = a.det.box;
    return assignments;
  }
}
