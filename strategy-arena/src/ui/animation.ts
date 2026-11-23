import { describeConfig, type Match, type Tone, type TournamentResult } from '../engine';
import { colorOf, fmt } from './colors';

/** Internal resolution: 9:16 vertical video. */
export const W = 1080;
export const H = 1920;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const INK = '#f1f2fa';
const MUTED = '#8f96b8';
const ACCENT = '#f2b84b';
const TONE: Record<Tone, string> = { good: '#4fd1a1', bad: '#f0686a', neutral: '#566090' };

type SceneKind = 'intro' | 'play' | 'outro' | 'evolution';
interface Scene {
  kind: SceneKind;
  start: number;
  end: number;
}

export interface Timeline {
  result: TournamentResult;
  title: string;
  subtitle: string;
  unit: string;
  scenes: Scene[];
  /** Seconds per match (pairwise arenas) or per auction (auction room). */
  unitDur: number;
  total: number;
  /** before[k][p]: player p's score when unit k starts (one extra row for the final totals). */
  before: number[][];
  /** Pairwise arenas: running score added to players i and j after each round of match k. */
  gain: { i: number[]; j: number[] }[];
  maxFinal: number;
}

const FADE = 0.5;

export function buildTimeline(result: TournamentResult): Timeline {
  const n = result.players.length;
  const before: number[][] = [new Array(n).fill(0)];
  const gain: Timeline['gain'] = [];
  const room = result.auction?.[result.config.auction.format];
  if (room) {
    for (const r of room.rounds) {
      const next = [...before[before.length - 1]];
      next[r.winner] += r.surplus;
      before.push(next);
    }
  }
  for (const m of result.matches) {
    const self = m.i === m.j;
    let a = 0;
    let b = 0;
    const gi: number[] = [];
    const gj: number[] = [];
    for (const r of m.rounds) {
      a += r.a.payoff;
      b += r.b.payoff;
      gi.push(self ? (a + b) / 2 : a);
      gj.push(self ? 0 : b);
    }
    gain.push({ i: gi, j: gj });
    const next = [...before[before.length - 1]];
    next[m.i] += gi[gi.length - 1] ?? 0;
    if (!self) next[m.j] += gj[gj.length - 1] ?? 0;
    before.push(next);
  }
  const units = before.length - 1;
  const unitDur = room ? Math.min(1.6, Math.max(0.25, 45 / Math.max(1, units))) : Math.min(3, Math.max(1, 45 / Math.max(1, units)));
  const scenes: Scene[] = [];
  const add = (kind: SceneKind, dur: number) => {
    const start = scenes.length ? scenes[scenes.length - 1].end : 0;
    scenes.push({ kind, start, end: start + dur });
  };
  add('intro', 2.8);
  if (units) add('play', unitDur * units + FADE);
  add('outro', 5);
  if (result.evolution && result.config.evolution) add('evolution', 9);
  return {
    result,
    ...describeConfig(result.config),
    scenes,
    unitDur,
    total: scenes[scenes.length - 1].end,
    before,
    gain,
    maxFinal: Math.max(1e-9, ...before[before.length - 1]),
  };
}

interface Moment {
  /** Index of the match or auction on screen (clamped). */
  k: number;
  /** Pairwise: rounds revealed in that match, fractional. Auction: progress through the round, 0..1. */
  shown: number;
  scores: number[];
}

/** Auction rounds reveal bids first; the winner is paid once the round is this far along. */
const SETTLE = 0.55;

function momentAt(tl: Timeline, t: number): Moment {
  const units = tl.before.length - 1;
  const start = tl.scenes.find((s) => s.kind === 'play')?.start ?? 0;
  const x = (t - start) / tl.unitDur;
  const room = tl.result.auction;
  if (x <= 0 || units === 0) return { k: 0, shown: 0, scores: tl.before[0] };
  if (x >= units) return { k: units - 1, shown: room ? 1 : tl.result.matches[units - 1].rounds.length, scores: tl.before[units] };
  const k = Math.floor(x);
  if (room) {
    const phase = tl.unitDur < 0.5 ? 1 : x - k; // too fast to animate inside a round: show it settled
    return { k, shown: phase, scores: tl.before[phase >= SETTLE ? k + 1 : k] };
  }
  const m = tl.result.matches[k];
  const shown = Math.min(1, (x - k) / 0.8) * m.rounds.length;
  const done = Math.floor(shown);
  const scores = [...tl.before[k]];
  if (done > 0) {
    scores[m.i] += tl.gain[k].i[done - 1];
    if (m.i !== m.j) scores[m.j] += tl.gain[k].j[done - 1];
  }
  return { k, shown, scores };
}

/** Rank positions averaged over a short trailing window, so bars glide past each other. */
function smoothRanks(tl: Timeline, t: number): number[] {
  const n = tl.result.players.length;
  const acc = new Array(n).fill(0);
  const samples = 8;
  for (let s = 0; s < samples; s++) {
    const { scores } = momentAt(tl, t - s * 0.06);
    const order = scores.map((v, p) => [v, p]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    order.forEach(([, p], rank) => (acc[p] += rank / samples));
  }
  return acc;
}

type Ctx = CanvasRenderingContext2D;

function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, opts: { weight?: number; align?: CanvasTextAlign; maxWidth?: number; spacing?: number } = {}) {
  const weight = opts.weight ?? 600;
  let px = size;
  ctx.font = `${weight} ${px}px ${FONT}`;
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${opts.spacing ?? 0}px`;
  if (opts.maxWidth) {
    while (px > 12 && ctx.measureText(s).width > opts.maxWidth) {
      px -= 2;
      ctx.font = `${weight} ${px}px ${FONT}`;
    }
  }
  ctx.fillStyle = color;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), h, rr);
}

function background(ctx: Ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0d1024');
  g.addColorStop(1, '#191c3d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.8, 120, 0, W * 0.8, 120, 900);
  glow.addColorStop(0, 'rgba(110,168,254,0.16)');
  glow.addColorStop(1, 'rgba(110,168,254,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function footer(ctx: Ctx, tl: Timeline, t: number) {
  text(ctx, `STRATEGY ARENA  ·  SEED ${tl.result.config.seed.toUpperCase()}`, W / 2, 1876, 24, MUTED, { align: 'center', spacing: 3, maxWidth: 900 });
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, H - 12, W, 12);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, H - 12, W * Math.min(1, t / tl.total), 12);
}

function drawMatch(ctx: Ctx, tl: Timeline, mo: Moment) {
  const { result } = tl;
  const m: Match = result.matches[mo.k];
  const done = Math.floor(mo.shown);
  rrect(ctx, 50, 240, 980, 770, 36);
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  ctx.fill();
  text(ctx, `MATCH ${mo.k + 1} OF ${result.matches.length}`, 90, 305, 28, MUTED, { spacing: 4, weight: 700 });
  text(ctx, `ROUND ${Math.min(m.rounds.length, done + (done < m.rounds.length ? 1 : 0))} / ${m.rounds.length}`, 990, 305, 28, MUTED, { spacing: 4, weight: 700, align: 'right' });

  const sides = [
    { p: m.i, y: 385, run: done ? sumTo(m, done, 'a') : 0 },
    { p: m.j, y: 455, run: done ? sumTo(m, done, 'b') : 0 },
  ];
  for (const s of sides) {
    ctx.fillStyle = colorOf(s.p);
    ctx.beginPath();
    ctx.arc(104, s.y - 16, 14, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, result.players[s.p].name, 136, s.y, 48, INK, { weight: 750, maxWidth: 640 });
    text(ctx, fmt(s.run), 990, s.y, 48, colorOf(s.p), { weight: 800, align: 'right' });
  }

  // Rounds wrap into blocks of two rows (first player on top); pick the column count that gives the biggest cells.
  const gx = 90, gy = 500, gw = 900, gh = 430;
  const n = m.rounds.length;
  let best = { cols: n, size: 0, blocks: 1 };
  for (let cols = Math.min(n, 4); cols <= Math.min(n, 50); cols++) {
    const blocks = Math.ceil(n / cols);
    const gap = Math.max(3, Math.min(10, gw / cols / 8));
    const size = Math.min((gw + gap) / cols - gap, ((gh + 18) / blocks - 18 - gap) / 2);
    if (size > best.size) best = { cols, size, blocks };
  }
  const size = Math.min(best.size, 120);
  const gap = Math.max(3, Math.min(10, size / 7));
  const blockH = size * 2 + gap + 18;
  const usedW = best.cols * (size + gap) - gap;
  const x0 = gx + (gw - usedW) / 2;
  const y0 = gy + (gh - (best.blocks * blockH - 18)) / 2;
  const fontPx = size * (size >= 60 ? 0.42 : 0.5);
  for (let r = 0; r < n; r++) {
    const cx = x0 + (r % best.cols) * (size + gap);
    const by = y0 + Math.floor(r / best.cols) * blockH;
    const rec = m.rounds[r];
    [rec.a, rec.b].forEach((side, row) => {
      const cy = by + row * (size + gap);
      if (r >= mo.shown) {
        rrect(ctx, cx, cy, size, size, size * 0.22);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fill();
        return;
      }
      const pop = Math.min(1, mo.shown - r); // newest cell grows in
      const s = size * (0.55 + 0.45 * pop);
      rrect(ctx, cx + (size - s) / 2, cy + (size - s) / 2, s, s, s * 0.22);
      ctx.fillStyle = TONE[side.tone];
      ctx.fill();
      if (size >= 30 && side.label.length <= 3) {
        text(ctx, side.label, cx + size / 2, cy + size / 2 + fontPx * 0.36, fontPx, side.tone === 'neutral' ? INK : '#10142a', { weight: 800, align: 'center', maxWidth: size - 6 });
      }
    });
  }
  const note = done > 0 ? m.rounds[Math.min(n, done) - 1].note : undefined;
  if (note) text(ctx, note, W / 2, 985, 28, MUTED, { align: 'center', maxWidth: 900 });
}

function sumTo(m: Match, rounds: number, side: 'a' | 'b'): number {
  let s = 0;
  for (let r = 0; r < rounds && r < m.rounds.length; r++) s += m.rounds[r][side].payoff;
  return s;
}

function drawBoard(ctx: Ctx, tl: Timeline, t: number, mo: Moment, top: number, bottom: number, active: number[]) {
  const { players } = tl.result;
  const n = players.length;
  const ranks = smoothRanks(tl, t);
  const rowH = Math.min(96, (bottom - top) / n);
  const nameSize = Math.min(38, rowH * 0.44);
  const barH = Math.max(8, rowH * 0.24);
  for (let p = 0; p < n; p++) {
    const y = top + ranks[p] * rowH;
    const hot = active.length === 0 || active.includes(p);
    ctx.globalAlpha *= hot ? 1 : 0.72;
    text(ctx, players[p].name, 60, y + nameSize, nameSize, INK, { weight: hot ? 750 : 600, maxWidth: 700 });
    text(ctx, fmt(mo.scores[p]), 1020, y + nameSize, nameSize, INK, { weight: 800, align: 'right' });
    const by = y + nameSize + rowH * 0.12;
    rrect(ctx, 60, by, 960, barH, barH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    rrect(ctx, 60, by, Math.max(barH, (960 * Math.max(0, mo.scores[p])) / tl.maxFinal), barH, barH / 2);
    ctx.fillStyle = colorOf(p);
    ctx.fill();
    ctx.globalAlpha /= hot ? 1 : 0.72;
  }
}

function drawAuction(ctx: Ctx, tl: Timeline, mo: Moment) {
  const { result } = tl;
  const room = result.auction![result.config.auction.format];
  const r = room.rounds[mo.k];
  const n = result.players.length;
  const settled = mo.shown >= SETTLE;
  const grow = Math.min(1, mo.shown / 0.35);
  rrect(ctx, 50, 240, 980, 770, 36);
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  ctx.fill();
  text(ctx, `AUCTION ${mo.k + 1} OF ${room.rounds.length}`, 90, 305, 28, MUTED, { spacing: 4, weight: 700 });
  const seen = mo.k + (settled ? 1 : 0);
  let revenue = 0;
  for (let i = 0; i < seen; i++) revenue += room.rounds[i].price;
  text(ctx, `AVG PRICE ${seen ? fmt(Math.round(revenue / seen)) : '–'}`, 990, 305, 28, MUTED, { spacing: 4, weight: 700, align: 'right' });

  const top = 340;
  const rowH = Math.min(120, 580 / n);
  const nameSize = Math.min(36, rowH * 0.36);
  const barH = Math.max(10, rowH * 0.2);
  const scale = 900 / Math.max(100, ...room.rounds.map((x) => Math.max(...x.bids))); // overbidders can pass 100
  for (let i = 0; i < n; i++) {
    const y = top + i * rowH;
    const won = settled && i === r.winner;
    if (won) {
      rrect(ctx, 66, y - 4, 948, rowH - 6, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fill();
    }
    ctx.globalAlpha *= settled && !won ? 0.5 : 1;
    ctx.fillStyle = colorOf(i);
    ctx.beginPath();
    ctx.arc(100, y + nameSize * 0.7, nameSize * 0.28, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, result.players[i].name, 122, y + nameSize, nameSize, INK, { weight: won ? 800 : 650, maxWidth: 430 });
    text(ctx, `worth ${Math.round(r.values[i])}   bids ${Math.round(r.bids[i] * grow)}`, 990, y + nameSize, nameSize * 0.82, won ? INK : MUTED, { weight: 650, align: 'right', maxWidth: 420 });
    const by = y + nameSize + rowH * 0.13;
    rrect(ctx, 90, by, 900, barH, barH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    rrect(ctx, 90, by, Math.max(barH, r.bids[i] * grow * scale), barH, barH / 2);
    ctx.fillStyle = colorOf(i);
    ctx.fill();
    ctx.fillStyle = INK; // tick: what the item is really worth to this bidder
    ctx.fillRect(90 + r.values[i] * scale - 3, by - 7, 6, barH + 14);
    ctx.globalAlpha /= settled && !won ? 0.5 : 1;
  }
  if (settled) {
    const px = 90 + r.price * scale;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(px, top - 4);
    ctx.lineTo(px, top + n * rowH - 8);
    ctx.stroke();
    ctx.setLineDash([]);
    const gainTxt = `${r.surplus >= 0 ? '+' : '−'}${fmt(Math.abs(Math.round(r.surplus)))}`;
    text(ctx, `${result.players[r.winner].name} wins, pays ${Math.round(r.price)}: ${gainTxt}`, W / 2, 985, 34, r.surplus >= 0 ? TONE.good : TONE.bad, { align: 'center', weight: 750, maxWidth: 900 });
  } else {
    text(ctx, 'Sealed bids coming in…', W / 2, 985, 30, MUTED, { align: 'center' });
  }
}

function drawEvolution(ctx: Ctx, tl: Timeline, u: number) {
  background(ctx);
  const evo = tl.result.evolution!;
  const { players } = tl.result;
  const gens = evo.length - 1;
  const g = Math.min(gens, Math.max(0, (u / 0.72) * gens));
  const gi = Math.floor(g);
  text(ctx, 'EVOLUTION', W / 2, 150, 34, ACCENT, { align: 'center', spacing: 10, weight: 800 });
  text(ctx, 'Now let winners multiply', W / 2, 250, 76, INK, { align: 'center', weight: 850, maxWidth: 960 });
  text(ctx, 'Each generation, a strategy grows in step with its score against the crowd', W / 2, 312, 30, MUTED, { align: 'center', maxWidth: 960 });
  const x0 = 150, y0 = 400, w = 850, h = 640;
  rrect(ctx, 50, y0 - 40, 980, h + 120, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  ctx.fill();
  const top = Math.min(1, Math.ceil(Math.max(...evo.flat()) * 10) / 10);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  for (let k = 0; k <= 4; k++) {
    const y = y0 + h - (h * k) / 4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
    text(ctx, `${Math.round((top * k * 100) / 4)}%`, x0 - 16, y + 9, 26, MUTED, { align: 'right' });
  }
  const at = (p: number, gen: number) => {
    const lo = Math.min(gens, Math.floor(gen));
    const hi = Math.min(gens, lo + 1);
    return evo[lo][p] + (evo[hi][p] - evo[lo][p]) * (gen - lo);
  };
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  players.forEach((_, p) => {
    ctx.strokeStyle = colorOf(p);
    ctx.beginPath();
    for (let k = 0; k <= gi; k++) ctx[k ? 'lineTo' : 'moveTo'](x0 + (w * k) / gens, y0 + h - (h * evo[k][p]) / top);
    ctx.lineTo(x0 + (w * g) / gens, y0 + h - (h * at(p, g)) / top);
    ctx.stroke();
  });
  text(ctx, `GENERATION ${gi}`, W / 2, y0 + h + 52, 28, MUTED, { align: 'center', spacing: 4, weight: 700 });
  // Current population, largest first.
  const order = players.map((_, p) => p).sort((a, b) => at(b, g) - at(a, g) || a - b);
  const listTop = 1180;
  const rowH = Math.min(80, 640 / players.length);
  const size = Math.min(36, rowH * 0.5);
  order.forEach((p, rank) => {
    const y = listTop + rank * rowH;
    const share = at(p, g);
    ctx.globalAlpha *= share < 0.005 ? 0.4 : 1;
    text(ctx, players[p].name, 60, y + size, size, INK, { weight: rank === 0 ? 800 : 600, maxWidth: 430 });
    rrect(ctx, 510, y + size * 0.25, Math.max(8, 380 * (share / top)), size * 0.7, size * 0.35);
    ctx.fillStyle = colorOf(p);
    ctx.fill();
    text(ctx, `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`, 1020, y + size, size, INK, { weight: 800, align: 'right' });
    ctx.globalAlpha /= share < 0.005 ? 0.4 : 1;
  });
}

function drawIntro(ctx: Ctx, tl: Timeline) {
  background(ctx);
  text(ctx, 'STRATEGY ARENA', W / 2, 560, 34, ACCENT, { align: 'center', spacing: 10, weight: 800 });
  text(ctx, tl.title, W / 2, 730, 124, INK, { align: 'center', weight: 850, maxWidth: 960 });
  text(ctx, tl.subtitle, W / 2, 810, 38, MUTED, { align: 'center', maxWidth: 960 });
  text(ctx, 'Who comes out on top?', W / 2, 990, 64, INK, { align: 'center', weight: 750, maxWidth: 960 });
  // Contestant chips, wrapped and centred.
  ctx.font = `700 34px ${FONT}`;
  const chips = tl.result.players.map((p, i) => ({ name: p.name, w: ctx.measureText(p.name).width + 76, i }));
  const rows: (typeof chips)[] = [[]];
  let rowW = 0;
  for (const c of chips) {
    if (rowW + c.w > 960 && rows[rows.length - 1].length) {
      rows.push([]);
      rowW = 0;
    }
    rows[rows.length - 1].push(c);
    rowW += c.w + 16;
  }
  rows.forEach((row, ri) => {
    let x = (W - (row.reduce((s, c) => s + c.w + 16, 0) - 16)) / 2;
    const y = 1110 + ri * 82;
    for (const c of row) {
      rrect(ctx, x, y, c.w, 64, 32);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.fillStyle = colorOf(c.i);
      ctx.beginPath();
      ctx.arc(x + 32, y + 32, 11, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, c.name, x + 54, y + 44, 34, INK, { weight: 700 });
      x += c.w + 16;
    }
  });
}

function drawOutro(ctx: Ctx, tl: Timeline) {
  background(ctx);
  const lb = tl.result.leaderboard;
  const win = lb[0];
  text(ctx, tl.title.toUpperCase(), W / 2, 250, 32, MUTED, { align: 'center', spacing: 6, weight: 700, maxWidth: 960 });
  text(ctx, 'WINNER', W / 2, 400, 40, ACCENT, { align: 'center', spacing: 14, weight: 800 });
  text(ctx, win.name, W / 2, 550, 128, colorOf(win.index), { align: 'center', weight: 850, maxWidth: 960 });
  text(ctx, `${fmt(win.total)} ${tl.unit}`, W / 2, 640, 44, INK, { align: 'center', weight: 600 });
  const top = 760;
  const rowH = Math.min(96, (1800 - top) / lb.length);
  const size = Math.min(40, rowH * 0.46);
  const max = Math.max(1e-9, win.total);
  lb.forEach((s, rank) => {
    const y = top + rank * rowH;
    text(ctx, String(rank + 1), 60, y + size, size, MUTED, { weight: 800 });
    text(ctx, s.name, 130, y + size, size, INK, { weight: rank === 0 ? 800 : 600, maxWidth: 640 });
    text(ctx, fmt(s.total), 1020, y + size, size, INK, { weight: 800, align: 'right' });
    const barH = Math.max(8, rowH * 0.2);
    const by = y + size + rowH * 0.12;
    rrect(ctx, 130, by, Math.max(barH, (890 * Math.max(0, s.total)) / max), barH, barH / 2);
    ctx.fillStyle = colorOf(s.index);
    ctx.fill();
  });
  const auction = tl.result.auction;
  if (auction) {
    const line = `Seller's average price: ${fmt(auction.first.avgRevenue)} first-price, ${fmt(auction.second.avgRevenue)} second-price`;
    text(ctx, line, W / 2, 700, 30, MUTED, { align: 'center', maxWidth: 960 });
  }
}

function drawPlay(ctx: Ctx, tl: Timeline, t: number) {
  background(ctx);
  const mo = momentAt(tl, t);
  text(ctx, tl.title, W / 2, 130, 64, INK, { align: 'center', weight: 850, maxWidth: 960 });
  text(ctx, tl.subtitle, W / 2, 186, 30, MUTED, { align: 'center', maxWidth: 960 });
  let active: number[];
  if (tl.result.auction) {
    drawAuction(ctx, tl, mo);
    active = mo.shown >= SETTLE ? [tl.result.auction[tl.result.config.auction.format].rounds[mo.k].winner] : [];
  } else {
    const m = tl.result.matches[mo.k];
    drawMatch(ctx, tl, mo);
    active = [m.i, m.j];
  }
  text(ctx, 'LEADERBOARD', 60, 1085, 28, MUTED, { spacing: 4, weight: 700 });
  text(ctx, tl.unit.toUpperCase(), 1020, 1085, 28, MUTED, { spacing: 4, weight: 700, align: 'right' });
  drawBoard(ctx, tl, t, mo, 1120, 1830, active);
}

function drawScene(ctx: Ctx, tl: Timeline, scene: Scene, t: number) {
  if (scene.kind === 'intro') drawIntro(ctx, tl);
  else if (scene.kind === 'play') drawPlay(ctx, tl, t);
  else if (scene.kind === 'outro') drawOutro(ctx, tl);
  else drawEvolution(ctx, tl, (t - scene.start) / (scene.end - scene.start));
  footer(ctx, tl, t);
}

/** Paint the frame for time t (seconds). Pure: any frame can be drawn at any time, in any order. */
export function drawFrame(ctx: Ctx, tl: Timeline, t: number) {
  ctx.save();
  ctx.globalAlpha = 1;
  const idx = Math.max(0, tl.scenes.findIndex((s, i) => t < s.end || i === tl.scenes.length - 1));
  const scene = tl.scenes[idx];
  drawScene(ctx, tl, scene, t);
  // Cross-fade into the next scene over the last half second.
  const next = tl.scenes[idx + 1];
  if (next && t > scene.end - FADE) {
    ctx.globalAlpha = (t - (scene.end - FADE)) / FADE;
    drawScene(ctx, tl, next, next.start);
  }
  ctx.restore();
}
