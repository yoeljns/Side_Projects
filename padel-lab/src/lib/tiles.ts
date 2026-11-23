// Detection tiles. Far-side players are tiny in a wide phone shot, so instead of
// one pass over the whole frame the detector runs on crops that follow the court:
// one or two for the near half, up to three for the far half.
import { COURT_L, COURT_W, NET_Y } from './court';
import { project, type H } from './homography';
import type { Box } from './tracker';

/** A crop of the frame. `inner*` marks edges that cut through the scene rather than ending at the frame. */
export type Tile = { x: number; y: number; w: number; h: number; innerL: boolean; innerR: boolean; innerT?: boolean; innerB?: boolean };

const PLAYER_H = 2.1; // metres of headroom above the feet
const SIDE_PAD = 0.9;

type Region = { x0: number; y0: number; x1: number; y1: number };

function region(hCourtToImg: H, yFrom: number, yTo: number, W: number, Hh: number): Region | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let open = false; // part of this half lies outside what the homography can place
  for (let y = yFrom; y <= yTo + 1e-6; y += 2.5) {
    for (let x = 0; x <= COURT_W + 1e-6; x += 2.5) {
      const p = project(hCourtToImg, { x, y });
      const q = project(hCourtToImg, { x: x + 1, y });
      if (!p || !q) { open = true; continue; }
      const scale = Math.hypot(q.x - p.x, q.y - p.y); // px per metre at this depth
      if (scale > W) { open = true; continue; }
      x0 = Math.min(x0, p.x - SIDE_PAD * scale);
      x1 = Math.max(x1, p.x + SIDE_PAD * scale);
      y0 = Math.min(y0, p.y - PLAYER_H * scale);
      y1 = Math.max(y1, p.y + 0.3 * scale);
    }
  }
  if (open) { x0 = 0; x1 = W; y1 = Hh; if (!isFinite(y0)) y0 = 0; }
  const r = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(W, x1), y1: Math.min(Hh, y1) };
  return r.x1 - r.x0 >= 24 && r.y1 - r.y0 >= 24 ? r : null;
}

function split(r: Region, maxN: number, overlap: number, aspect: number): Tile[] {
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const n = Math.min(maxN, Math.max(1, Math.round(w / h / aspect)));
  const tw = w / (n - (n - 1) * overlap);
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) {
    tiles.push({ x: r.x0 + i * tw * (1 - overlap), y: r.y0, w: tw, h, innerL: i > 0, innerR: i < n - 1 });
  }
  return tiles;
}

export function buildTiles(hCourtToImg: H, W: number, Hh: number): Tile[] {
  const tiles: Tile[] = [];
  const near = region(hCourtToImg, 0, NET_Y, W, Hh);
  const far = region(hCourtToImg, NET_Y, COURT_L, W, Hh);
  if (near) tiles.push(...split(near, 2, 0.35, 1.6));
  if (far) tiles.push(...split(far, 3, 0.25, 1));
  if (tiles.length === 0) tiles.push({ x: 0, y: 0, w: W, h: Hh, innerL: false, innerR: false });
  return tiles;
}

/** A box cut off by a tile's inner edge is dropped: another tile sees it whole. */
export function truncatedByTile(b: Box, t: Tile): boolean {
  const ex = t.w * 0.015, ey = t.h * 0.015;
  return (
    (t.innerL && b.x - t.x < ex) ||
    (t.innerR && t.x + t.w - (b.x + b.w) < ex) ||
    (!!t.innerT && b.y - t.y < ey) ||
    (!!t.innerB && t.y + t.h - (b.y + b.h) < ey)
  );
}

/**
 * A zoomed crop around where a tracked player was last seen. Running the
 * detector on these gives it several times more pixels per player than the
 * court-wide tiles, which is what makes far-side tracking hold up.
 */
export function roiTile(b: Box, W: number, Hh: number): Tile {
  const side = Math.min(Math.max(b.h * 2.2, b.w * 3.2, 112), Math.min(W, Hh));
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const x = Math.min(W - side, Math.max(0, cx - side / 2));
  const y = Math.min(Hh - side, Math.max(0, cy - side / 2));
  return { x, y, w: side, h: side, innerL: x > 0.5, innerR: x + side < W - 0.5, innerT: y > 0.5, innerB: y + side < Hh - 0.5 };
}

/** Non-maximum suppression across tiles. */
export function mergeBoxes(boxes: Box[]): Box[] {
  const sorted = boxes.slice().sort((a, b) => b.score - a.score);
  const keep: Box[] = [];
  for (const b of sorted) {
    const dup = keep.some((k) => {
      const ix = Math.max(0, Math.min(k.x + k.w, b.x + b.w) - Math.max(k.x, b.x));
      const iy = Math.max(0, Math.min(k.y + k.h, b.y + b.h) - Math.max(k.y, b.y));
      const inter = ix * iy;
      const a1 = k.w * k.h, a2 = b.w * b.h;
      return inter / (a1 + a2 - inter) > 0.45 || inter / Math.min(a1, a2) > 0.7;
    });
    if (!dup) keep.push(b);
  }
  return keep;
}
