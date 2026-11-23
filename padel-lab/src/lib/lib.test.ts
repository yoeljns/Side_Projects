import { describe, expect, it } from 'vitest';
import { EnvelopeBuilder } from './audio';
import { computeStats } from './stats';
import { homography, isConvexQuad, project } from './homography';
import { detectHits, ENV_BIN, groupRallies, summariseRallies } from './hits';
import { buildTiles, mergeBoxes } from './tiles';
import { onCourt, Tracker } from './tracker';

function envelope(seconds: number, hitTimes: number[]): Float32Array {
  const env = new Float32Array(Math.round(seconds / ENV_BIN));
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < env.length; i++) env[i] = 1e-6 * (0.5 + rnd());
  for (const t of hitTimes) {
    const k = Math.round(t / ENV_BIN);
    env[k] = 1e-3;
    env[k + 1] = 2e-4;
    env[k + 2] = 3e-5;
  }
  return env;
}

describe('hits', () => {
  it('finds impulsive peaks and ignores sustained noise', () => {
    const times = [2, 3.2, 4.5, 5.6, 20, 21.3, 22.1];
    const env = envelope(30, times);
    // 2 s of sustained shouting: loud, but no sharp onset after the first bin ramp.
    for (let k = Math.round(10 / ENV_BIN), i = 0; i < 80; i++) env[k + i] = 1e-6 * Math.min(300, 1.15 ** i);
    const hits = detectHits(env);
    expect(hits.length).toBe(times.length);
    hits.forEach((h, i) => expect(Math.abs(h - times[i])).toBeLessThan(0.05));
  });

  it('groups hits into rallies and drops lone hits', () => {
    const rallies = groupRallies([2, 3.2, 4.5, 5.6, 12, 20, 21.3, 22.1]);
    expect(rallies).toEqual([
      { start: 2, end: 5.6, hits: 4 },
      { start: 20, end: 22.1, hits: 3 },
    ]);
    const s = summariseRallies(rallies);
    expect(s.count).toBe(2);
    expect(s.longestSec).toBeCloseTo(4.6);
    expect(s.buckets).toEqual([2, 0, 0, 0, 0]);
  });
});

describe('homography', () => {
  const img = [{ x: 300, y: 900 }, { x: 1600, y: 900 }, { x: 1250, y: 400 }, { x: 650, y: 400 }];
  const court = [{ x: 0, y: 3.05 }, { x: 10, y: 3.05 }, { x: 10, y: 16.95 }, { x: 0, y: 16.95 }];
  it('maps the calibration points and inverts', () => {
    const h = homography(img, court)!;
    const inv = homography(court, img)!;
    img.forEach((p, i) => {
      const q = project(h, p)!;
      expect(q.x).toBeCloseTo(court[i].x, 6);
      expect(q.y).toBeCloseTo(court[i].y, 6);
    });
    const mid = project(inv, { x: 5, y: 10 })!;
    const back = project(h, mid)!;
    expect(back.x).toBeCloseTo(5, 6);
    expect(back.y).toBeCloseTo(10, 6);
  });
  it('keeps depth positive when the frame origin is above the horizon', () => {
    // Elevated side-on view: the top-left of the frame is sky, beyond the floor's horizon.
    const px = [{ x: 400, y: 548 }, { x: 612, y: 408 }, { x: 1295, y: 530 }, { x: 1262, y: 812 }];
    const full = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    const h = homography(px, full)!;
    const centre = project(h, { x: 830, y: 550 });
    expect(centre).not.toBeNull();
    expect(centre!.y).toBeGreaterThan(5);
    expect(centre!.y).toBeLessThan(15);
  });
  it('rejects crossed quads', () => {
    expect(isConvexQuad(img)).toBe(true);
    expect(isConvexQuad([img[0], img[2], img[1], img[3]])).toBe(false);
  });
  it('builds tiles inside the frame, with more for the far half', () => {
    const tiles = buildTiles(homography(court, img)!, 1920, 1080);
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(1920.001);
      expect(t.y + t.h).toBeLessThanOrEqual(1080.001);
    }
  });
});

describe('tracking', () => {
  const det = (x: number, y: number) => ({ p: { x, y }, box: { x: 0, y: 0, w: 10, h: 30, score: 0.8 } });
  it('keeps identities through a side switch', () => {
    const tr = new Tracker();
    // Near pair swaps sides gradually; far pair stays.
    for (let i = 0; i <= 20; i++) {
      const f = i / 20;
      tr.update(i * 0.2, [det(2 + 6 * f, 3 + 4 * f), det(8 - 6 * f, 7 - 4 * f), det(3, 15), det(7, 17)]);
    }
    expect(tr.samples[0].at(-1)).toMatchObject({ x: 8, y: 7 });
    expect(tr.samples[1].at(-1)).toMatchObject({ x: 2, y: 3 });
    expect(tr.samples[2].length).toBe(21);
    expect(tr.samples[3].length).toBe(21);
  });
  it('drops people off the court', () => {
    expect(onCourt({ x: -3, y: 5 })).toBeNull();
    expect(onCourt({ x: 5, y: 26 })).toBeNull();
    expect(onCourt({ x: 10.4, y: -1 })).toEqual({ x: 10, y: 0 });
  });
  it('merges duplicate boxes from overlapping tiles', () => {
    const a = { x: 100, y: 100, w: 40, h: 100, score: 0.9 };
    expect(mergeBoxes([a, { ...a, x: 104, score: 0.6 }, { ...a, x: 400, score: 0.5 }]).length).toBe(2);
  });
  it('computes zone shares, optionally in play only', () => {
    const samples = [];
    for (let i = 0; i < 100; i++) samples.push({ t: i * 0.2, x: 5, y: i < 50 ? 8 : 1 }); // 10 s net, 10 s back
    const all = computeStats(samples);
    expect(all.seenSec).toBeCloseTo(20, 0);
    expect(all.zonePct.net).toBeCloseTo(0.5, 1);
    expect(all.zonePct.back).toBeCloseTo(0.5, 1);
    const inPlay = computeStats(samples, [{ start: 2, end: 8, hits: 4 }]);
    expect(inPlay.zonePct.net).toBeCloseTo(1, 5);
    expect(inPlay.seenSec).toBeCloseTo(8, 0);
  });
});

describe('envelope builder', () => {
  it('places hops in media time at any playback rate', () => {
    const eb = new EnvelopeBuilder(60);
    const rate = 4, hop = 256 / 48000;
    // Audio clock starts at 100 s; media plays from 0 at 4x.
    for (let c = 100; c <= 110; c += 0.03) eb.addSync(c, (c - 100) * rate);
    const total = Math.floor(9.5 / hop);
    for (let i = 0; i < total; i += 16) {
      const v = new Float32Array(16).fill(1e-6);
      for (let k = 0; k < 16; k++) {
        const media = ((i + k) * hop) * rate;
        if (Math.abs(media - 12) < hop * rate) v[k] = 1e-3;
      }
      eb.addBatch({ t: 100 + i * hop, hop, v });
    }
    eb.addSync(111, 44);
    const env = eb.finish(36);
    const hits = detectHits(env);
    expect(hits.length).toBe(1);
    expect(Math.abs(hits[0] - 12)).toBeLessThan(0.08);
  });
});
