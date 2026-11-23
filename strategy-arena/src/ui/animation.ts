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

export interface Timeline {
  result: TournamentResult;
  title: string;
  subtitle: string;
  unit: string;
  intro: number;
  matchDur: number;
  outro: number;
  total: number;
  /** before[k][p]: player p's score when match k starts (one extra row for the final totals). */
  before: number[][];
  /** gain[k]: running score added to players i and j after each round of match k. */
  gain: { i: number[]; j: number[] }[];
  maxFinal: number;
}

export function buildTimeline(result: TournamentResult): Timeline {
  const n = result.players.length;
  const before: number[][] = [new Array(n).fill(0)];
  const gain: Timeline['gain'] = [];
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
  const intro = 2.8;
  const outro = 5;
  const matchDur = Math.min(3, Math.max(1, 45 / Math.max(1, result.matches.length)));
  const d = describeConfig(result.config);
  return {
    result,
    ...d,
    intro,
    matchDur,
    outro,
    total: intro + matchDur * result.matches.length + outro,
    before,
    gain,
    maxFinal: Math.max(1e-9, ...before[before.length - 1]),
  };
}

interface Moment {
  /** Index of the match on screen (clamped). */
  k: number;
  /** Rounds revealed in that match, fractional. */
  shown: number;
  scores: number[];
}

function momentAt(tl: Timeline, t: number): Moment {
  const nm = tl.result.matches.length;
  const x = (t - tl.intro) / tl.matchDur;
  if (x <= 0) return { k: 0, shown: 0, scores: tl.before[0] };
  if (x >= nm) return { k: nm - 1, shown: tl.result.matches[nm - 1].rounds.length, scores: tl.before[nm] };
  const k = Math.floor(x);
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

function drawOutro(ctx: Ctx, tl: Timeline, t: number) {
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
  footer(ctx, tl, t);
}

/** Paint the frame for time t (seconds). Pure: any frame can be drawn at any time, in any order. */
export function drawFrame(ctx: Ctx, tl: Timeline, t: number) {
  const { result } = tl;
  ctx.save();
  ctx.globalAlpha = 1;
  const endOfMatches = tl.intro + tl.matchDur * result.matches.length;
  const fade = 0.5;
  if (t < tl.intro - fade || result.matches.length === 0) {
    drawIntro(ctx, tl);
    if (result.matches.length) footer(ctx, tl, t);
  } else if (t >= endOfMatches + fade) {
    drawOutro(ctx, tl, t);
  } else {
    background(ctx);
    const mo = momentAt(tl, t);
    const m = result.matches[mo.k];
    text(ctx, tl.title, W / 2, 130, 64, INK, { align: 'center', weight: 850, maxWidth: 960 });
    text(ctx, tl.subtitle, W / 2, 186, 30, MUTED, { align: 'center', maxWidth: 960 });
    drawMatch(ctx, tl, mo);
    text(ctx, 'LEADERBOARD', 60, 1085, 28, MUTED, { spacing: 4, weight: 700 });
    text(ctx, tl.unit.toUpperCase(), 1020, 1085, 28, MUTED, { spacing: 4, weight: 700, align: 'right' });
    drawBoard(ctx, tl, t, mo, 1120, 1830, [m.i, m.j]);
    footer(ctx, tl, t);
    // Cross-fade from the title card and into the result card.
    if (t < tl.intro) {
      ctx.globalAlpha = (tl.intro - t) / fade;
      drawIntro(ctx, tl);
      footer(ctx, tl, t);
    } else if (t > endOfMatches) {
      ctx.globalAlpha = (t - endOfMatches) / fade;
      drawOutro(ctx, tl, t);
    }
  }
  ctx.restore();
}
