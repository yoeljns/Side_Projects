// One analysis step: find the players in a frame and update their tracks.
// Shared by the live analyzer and the offline accuracy harness.
import type { PersonDetector } from './detector';
import { project, type H } from './homography';
import { roiTile, type Tile } from './tiles';
import { onCourt, Tracker, type Assignment, type Box, type CourtDet } from './tracker';

/** The whole court is re-scanned at least every this many samples. */
const FULL_SCAN_EVERY = 5;

export class Sampler {
  readonly tracker = new Tracker();
  frames = 0;
  /** Where each player was in the previous sample (frame pixels), if seen. */
  private lastBox: (Box | null)[] = [null, null, null, null];

  constructor(
    private detector: PersonDetector,
    private toCourt: H,
    private tiles: Tile[],
    private W: number,
    private Hh: number,
  ) {}

  step(frame: CanvasImageSource, t: number): Assignment[] {
    // Zoom in on each player we already follow; scan the whole court as well
    // whenever someone is missing, and periodically regardless.
    const rois = this.lastBox.filter((b): b is Box => !!b).map((b) => roiTile(b, this.W, this.Hh));
    const fullScan = rois.length < 4 || this.frames % FULL_SCAN_EVERY === 0;
    this.frames++;
    const boxes = this.detector.detect(frame, fullScan ? [...rois, ...this.tiles] : rois);
    const dets: CourtDet[] = [];
    for (const box of boxes) {
      const feet = onCourt(project(this.toCourt, { x: box.x + box.w / 2, y: box.y + box.h }));
      if (feet) dets.push({ p: feet, box, app: this.detector.appearance(frame, box) });
    }
    const assignments = this.tracker.update(t, dets);
    this.lastBox = [null, null, null, null];
    for (const a of assignments) this.lastBox[a.slot] = a.det.box;
    return assignments;
  }
}
