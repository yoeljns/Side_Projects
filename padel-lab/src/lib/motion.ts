// Finds far-side players by what moves. The camera is fixed, so anything that
// differs from a slowly-updated picture of the empty scene is a player (or a
// ball, or a reflection: the tracker's gates deal with those).
//
// On real phone footage from behind the glass, far players are ~70 px tall
// and partly hidden by the net; the neural detector finds them in about half
// the frames, this finds them in about 80%.
import type { Box } from './tracker';

export type Region = { x: number; y: number; w: number; h: number };

const BG_FRAMES = 13; // background = per-pixel median of this many frames...
const BG_EVERY = 2; // ...taken this many seconds apart
const MIN_BG = 4;
const DIFF = 24; // grey levels a pixel must differ by to count as changed

export class MotionFinder {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  private scale: number;
  private w: number;
  private h: number;
  private history: Uint8Array[] = [];
  private bg: Uint8Array | null = null;
  private lastAdd = -Infinity;
  private unit: number; // expected height in canvas px of a player at the far wall

  /** @param farPlayerPx height in frame pixels of a standing player at the far wall */
  constructor(private region: Region, farPlayerPx: number) {
    this.scale = Math.min(1, 800 / region.w);
    this.w = Math.max(8, Math.round(region.w * this.scale));
    this.h = Math.max(8, Math.round(region.h * this.scale));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.unit = Math.max(12, farPlayerPx * this.scale);
  }

  private grab(frame: CanvasImageSource): Uint8Array {
    const { x, y, w, h } = this.region;
    this.ctx.drawImage(frame, x, y, w, h, 0, 0, this.w, this.h);
    const px = this.ctx.getImageData(0, 0, this.w, this.h).data;
    const g = new Uint8Array(this.w * this.h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
    return g;
  }

  private rebuild(): void {
    const n = this.history.length, len = this.w * this.h;
    const bg = this.bg ?? new Uint8Array(len);
    const v = new Uint8Array(n);
    for (let p = 0; p < len; p++) {
      for (let k = 0; k < n; k++) {
        // insertion sort: n is tiny
        const val = this.history[k][p];
        let j = k;
        while (j > 0 && v[j - 1] > val) { v[j] = v[j - 1]; j--; }
        v[j] = val;
      }
      bg[p] = v[n >> 1];
    }
    this.bg = bg;
  }

  /**
   * @param hide boxes (frame px) of players already known to be in front of this
   *   region, i.e. the near pair; their columns are ignored
   * @returns boxes in frame pixels around moving, player-sized shapes
   */
  find(frame: CanvasImageSource, t: number, hide: Box[]): Box[] {
    const g = this.grab(frame);
    if (t - this.lastAdd >= BG_EVERY || t < this.lastAdd) {
      this.lastAdd = t;
      this.history.push(g);
      if (this.history.length > BG_FRAMES) this.history.shift();
      if (this.history.length >= MIN_BG) this.rebuild();
    }
    const bg = this.bg;
    if (!bg) return [];
    const { w, h, unit, scale, region } = this;

    const blocked = new Uint8Array(w);
    for (const b of hide) {
      const a = Math.max(0, Math.floor((b.x - b.w * 0.15 - region.x) * scale));
      const z = Math.min(w, Math.ceil((b.x + b.w * 1.15 - region.x) * scale));
      for (let x = a; x < z; x++) blocked[x] = 1;
    }
    const mask = new Uint8Array(w * h);
    const col = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0, p = y * w; x < w; x++, p++) {
        if (blocked[x]) continue;
        const d = g[p] - bg[p];
        if (d > DIFF || d < -DIFF) { mask[p] = 1; col[x]++; }
      }
    }
    // Players are upright: look for runs of columns with enough changed pixels.
    const k = Math.max(1, Math.round(unit * 0.05));
    const need = unit * 0.13, minW = unit * 0.12, maxW = unit * 1.3, minH = unit * 0.4;
    const smooth = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let q = Math.max(0, x - k); q <= Math.min(w - 1, x + k); q++) { s += col[q]; n++; }
      smooth[x] = s / n;
    }
    const out: Box[] = [];
    for (let x = 0; x < w; ) {
      if (smooth[x] < need) { x++; continue; }
      let x2 = x;
      while (x2 < w && smooth[x2] >= need) x2++;
      const bw = x2 - x;
      if (bw >= minW && bw <= maxW) {
        let top = -1, bot = -1, filled = 0;
        for (let y = 0; y < h; y++) {
          let c = 0;
          for (let q = x; q < x2; q++) c += mask[y * w + q];
          if (c >= 2) { if (top < 0) top = y; bot = y; }
          if (top >= 0) filled += c;
        }
        const bh = bot - top + 1;
        if (top >= 0 && bh >= minH && filled / (bw * bh) > 0.18) {
          out.push({ x: region.x + x / scale, y: region.y + top / scale, w: bw / scale, h: bh / scale, score: 0.25 });
        }
      }
      x = x2;
    }
    return out;
  }
}
