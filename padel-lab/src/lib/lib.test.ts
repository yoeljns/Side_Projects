import { describe, expect, it } from 'vitest';
import { EnvelopeBuilder } from './audio';
import { homography, isConvexQuad, project } from './homography';
import { autoThresholdDb, detectHits, ENV_BIN, findPeaks, groupRallies, selectHits, summariseRallies } from './hits';
import { computeStats, computeTeam, positionAt, refineTrack, STEP } from './stats';
import { buildTiles, mergeBoxes, roiTile, truncatedByTile } from './tiles';
import { onCourt, Tracker, type CourtDet } from './tracker';

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function envelope(seconds: number, hits: [number, number][]): Float32Array {
  const env = new Float32Array(Math.round(seconds / ENV_BIN));
  for (let i = 0; i < env.length; i++) env[i] = 1e-6 * (0.5 + rnd());
  for (const [t, amp] of hits) {
    const k = Math.round(t / ENV_BIN);
    env[k] = amp;
    env[k + 1] = amp / 5;
    env[k + 2] = amp / 30;
  }
  return env;
}

describe('hits', () => {
  it('finds impulsive peaks and ignores sustained noise', () => {
    const times = [2, 3.2, 4.5, 5.6, 20, 21.3, 22.1];
    const env = envelope(30, times.map((t) => [t, 1e-3]));
    // 2 s of sustained shouting: loud, but no sharp onset.
    for (let k = Math.round(10 / ENV_BIN), i = 0; i < 80; i++) env[k + i] = 1e-6 * Math.min(300, 1.15 ** i);
    const hits = detectHits(env);
    expect(hits.length).toBe(times.length);
    hits.forEach((h, i) => expect(Math.abs(h - times[i])).toBeLessThan(0.05));
  });

  it('auto-threshold separates own-court hits from the next court', () => {
    const loud: [number, number][] = [], quiet: [number, number][] = [];
    for (let i = 0; i < 60; i++) loud.push([5 + i * 3, 1e-3 * (0.6 + rnd())]); // ~28–32 dB up
    for (let i = 0; i < 80; i++) quiet.push([6.3 + i * 2.2, 2e-5 * (0.6 + rnd())]); // ~11–15 dB up
    const peaks = findPeaks(envelope(200, [...loud, ...quiet]));
    expect(peaks.length).toBeGreaterThan(120);
    const db = autoThresholdDb(peaks);
    expect(db).toBeGreaterThan(15);
    expect(db).toBeLessThan(23);
    expect(selectHits(peaks, db).length).toBe(60);
  });

  it('groups hits into rallies and summarises play and rest', () => {
    const rallies = groupRallies([2, 3.2, 4.5, 5.6, 12, 20, 21.3, 22.1]);
    expect(rallies).toEqual([
      { start: 2, end: 5.6, hits: 4 },
      { start: 20, end: 22.1, hits: 3 },
    ]);
    const s = summariseRallies(rallies, 30);
    expect(s.count).toBe(2);
    expect(s.longestSec).toBeCloseTo(4.6);
    expect(s.buckets).toEqual([2, 0, 0, 0, 0]);
    expect(s.playPct).toBeCloseTo(7.7 / 30, 2);
    expect(s.avgRestSec).toBeCloseTo(13.4, 1);
    expect(s.list[1]).toEqual([20, 3.1, 3]);
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
    const back = project(h, project(inv, { x: 5, y: 10 })!)!;
    expect(back.x).toBeCloseTo(5, 6);
    expect(back.y).toBeCloseTo(10, 6);
  });
  it('keeps depth positive when the frame origin is above the horizon', () => {
    const px = [{ x: 400, y: 548 }, { x: 612, y: 408 }, { x: 1295, y: 530 }, { x: 1262, y: 812 }];
    const full = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    const centre = project(homography(px, full)!, { x: 830, y: 550 });
    expect(centre).not.toBeNull();
    expect(centre!.y).toBeGreaterThan(5);
    expect(centre!.y).toBeLessThan(15);
  });
  it('rejects crossed quads', () => {
    expect(isConvexQuad(img)).toBe(true);
    expect(isConvexQuad([img[0], img[2], img[1], img[3]])).toBe(false);
  });
  it('builds tiles inside the frame', () => {
    const tiles = buildTiles(homography(court, img)!, 1920, 1080);
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(1920.001);
      expect(t.y + t.h).toBeLessThanOrEqual(1080.001);
    }
  });
  it('rejects half-people cut off by the bottom of the far-court strip', () => {
    const tiles = buildTiles(homography(court, img)!, 1920, 1080);
    const far = tiles[tiles.length - 1];
    expect(far.innerB).toBe(true);
    // A near player's torso seen in the far strip: its box ends at the strip's bottom edge.
    expect(truncatedByTile({ x: far.x + 40, y: far.y + 10, w: 60, h: far.h - 10, score: 0.9 }, far)).toBe(true);
    expect(truncatedByTile({ x: far.x + 40, y: far.y + 10, w: 30, h: far.h * 0.6, score: 0.9 }, far)).toBe(false);
  });
  it('zooms on a tracked player and flags boxes cut by the zoom edge', () => {
    const b = { x: 900, y: 400, w: 30, h: 70, score: 0.8 };
    const t = roiTile(b, 1920, 1080);
    expect(t.w).toBeCloseTo(154, 0);
    expect(truncatedByTile(b, t)).toBe(false);
    expect(truncatedByTile({ ...b, x: t.x + 0.5 }, t)).toBe(true);
    const edge = roiTile({ x: 0, y: 1000, w: 60, h: 80, score: 0.8 }, 1920, 1080);
    expect(edge.x).toBe(0);
    expect(edge.innerL).toBe(false); // the frame edge is not a cut
  });
});

const RED = Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const BLUE = Float32Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
const det = (x: number, y: number, app?: Float32Array): CourtDet => ({ p: { x, y }, box: { x: 0, y: 0, w: 10, h: 30, score: 0.8 }, app });

describe('tracking', () => {
  it('keeps identities through a side switch', () => {
    const tr = new Tracker();
    for (let i = 0; i <= 20; i++) {
      const f = i / 20;
      tr.update(i * 0.2, [det(2 + 6 * f, 3 + 4 * f), det(8 - 6 * f, 7 - 4 * f), det(3, 15), det(7, 17)]);
    }
    expect(tr.samples[0].at(-1)!.x).toBeGreaterThan(7);
    expect(tr.samples[1].at(-1)!.x).toBeLessThan(3);
    expect(tr.samples[2].length).toBe(21);
    expect(tr.samples[3].length).toBe(21);
  });

  it('uses shirt colour to survive partners crossing while one is hidden', () => {
    const tr = new Tracker();
    let t = 0;
    for (let i = 0; i < 10; i++, t += 0.2) tr.update(t, [det(3, 5, RED), det(7, 5, BLUE)]);
    // They converge; then for a second only one box is found at the meeting point.
    for (let i = 0; i < 5; i++, t += 0.2) tr.update(t, [det(3 + 0.35 * i, 5, RED), det(7 - 0.35 * i, 5, BLUE)]);
    for (let i = 0; i < 5; i++, t += 0.2) tr.update(t, [det(5, 5, i % 2 ? RED : BLUE)]);
    // They come out on swapped sides.
    for (let i = 0; i < 10; i++, t += 0.2) tr.update(t, [det(5 + 0.3 * i, 5, RED), det(5 - 0.3 * i, 5, BLUE)]);
    expect(tr.samples[0].at(-1)!.x).toBeGreaterThan(6.5); // red started left, ends right
    expect(tr.samples[1].at(-1)!.x).toBeLessThan(3.5);
  });

  it('never lets a player jump across the court or the net', () => {
    const tr = new Tracker();
    for (let i = 0; i < 5; i++) tr.update(i * 0.2, [det(2, 4), det(8, 4)]);
    // A spurious detection far away on the same side, and one over the net.
    const a = tr.update(1.0, [det(2, 4), det(8, 4), det(5, 9.5), det(5, 14)]);
    expect(a.find((x) => x.slot === 0)!.det.p).toEqual({ x: 2, y: 4 });
    expect(a.find((x) => x.slot === 1)!.det.p).toEqual({ x: 8, y: 4 });
    expect(a.some((x) => x.slot >= 2 && x.det.p.y === 14)).toBe(true);
    expect(tr.samples[0].every((s) => s.y < 5)).toBe(true);
  });

  it('lets motion-only sightings continue a track but never start one', () => {
    const weak = (x: number, y: number): CourtDet => ({ ...det(x, y), weak: true });
    const tr = new Tracker();
    expect(tr.update(0, [weak(3, 15)])).toEqual([]);
    tr.update(0.2, [det(3, 15), det(8, 17)]);
    const a = tr.update(0.4, [weak(3.2, 15.1), det(8, 17)]);
    expect(a.find((x) => x.slot === 2)!.det.weak).toBe(true);
    // With both on offer for the same player, the real detection wins.
    const b = tr.update(0.6, [weak(3.3, 15.1), det(3.5, 15.3), det(8, 17)]);
    expect(b.find((x) => x.slot === 2)!.det.weak).toBeUndefined();
    // After a long absence, motion alone does not bring the track back.
    expect(tr.update(10, [weak(3.4, 15.2)])).toEqual([]);
  });

  it('drops people off the court', () => {
    expect(onCourt({ x: -3, y: 5 })).toBeNull();
    expect(onCourt({ x: 5, y: 26 })).toBeNull();
    expect(onCourt({ x: 10.2, y: -1 })).toEqual({ x: 10, y: 0 });
    expect(onCourt({ x: 10.5, y: 5 })).toBeNull(); // a spectator against the side glass
  });
  it('merges duplicate boxes from overlapping tiles', () => {
    const a = { x: 100, y: 100, w: 40, h: 100, score: 0.9 };
    expect(mergeBoxes([a, { ...a, x: 104, score: 0.6 }, { ...a, x: 400, score: 0.5 }]).length).toBe(2);
  });
});

describe('stats', () => {
  const still = (n: number, x: number, y: (i: number) => number, t0 = 0) =>
    Array.from({ length: n }, (_, i) => ({ t: t0 + i * STEP, x, y: y(i) }));

  it('bridges short gaps but not long ones', () => {
    const raw = [...still(10, 5, () => 5), ...still(10, 5, () => 5, 3.0), ...still(10, 5, () => 5, 10)];
    const r = refineTrack(raw);
    expect(positionAt(r, 2.4)).not.toBeNull(); // 1.2 s gap: bridged
    expect(positionAt(r, 7)).toBeNull(); // 5 s gap: left empty
  });

  it('computes zone shares, optionally in play only', () => {
    const track = refineTrack(still(100, 5, (i) => (i < 50 ? 8 : 1))); // 10 s net, 10 s back
    const all = computeStats(track);
    expect(all.seenSec).toBeCloseTo(20, 0);
    expect(all.zonePct.net).toBeCloseTo(0.5, 1);
    const inPlay = computeStats(track, [{ start: 2, end: 8, hits: 4 }]);
    expect(inPlay.zonePct.net).toBeCloseTo(1, 5);
    expect(inPlay.seenSec).toBeCloseTo(8, 0);
  });

  it('measures speed, distance, side and net approaches', () => {
    // Stand at the back for 3 s, run to the net at 4 m/s, hold 3 s; on the left.
    const raw = [];
    for (let i = 0; i < 40; i++) {
      const t = i * STEP;
      const y = t < 3 ? 2 : Math.min(8, 2 + (t - 3) * 4);
      raw.push({ t, x: 2, y });
    }
    const s = computeStats(refineTrack(raw));
    expect(s.distanceM).toBeGreaterThan(5.5);
    expect(s.distanceM).toBeLessThan(6.5);
    expect(s.topSpeed).toBeGreaterThan(3);
    expect(s.topSpeed).toBeLessThan(4.5);
    expect(s.netApproaches).toBe(1);
    expect(s.leftPct).toBeCloseTo(1, 5);
    expect(computeStats(refineTrack(raw), null, false).leftPct).toBe(0);
  });

  it('describes how a pair moves together', () => {
    const a = refineTrack(still(100, 3, () => 8)); // always at the net
    const b = refineTrack(still(100, 7, (i) => (i < 50 ? 8 : 1))); // half net, half back
    const team = computeTeam(a, b);
    expect(team.bothNetPct).toBeCloseTo(0.5, 1);
    expect(team.splitPct).toBeCloseTo(0.5, 1);
    expect(team.gapM).toBeGreaterThan(4);
  });
});

describe('envelope builder', () => {
  it('places hops in media time at any playback rate', () => {
    const eb = new EnvelopeBuilder(60);
    const rate = 4, hop = 256 / 48000;
    for (let c = 100; c <= 110; c += 0.03) eb.addSync(c, (c - 100) * rate);
    const total = Math.floor(9.5 / hop);
    for (let i = 0; i < total; i += 16) {
      const v = new Float32Array(16).fill(1e-6);
      for (let k = 0; k < 16; k++) if (Math.abs((i + k) * hop * rate - 12) < hop * rate) v[k] = 1e-3;
      eb.addBatch({ t: 100 + i * hop, hop, v });
    }
    eb.addSync(111, 44);
    const hits = detectHits(eb.finish(36));
    expect(hits.length).toBe(1);
    expect(Math.abs(hits[0] - 12)).toBeLessThan(0.08);
  });
});
