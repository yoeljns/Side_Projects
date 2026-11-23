import { type Rng, fork } from './rng';
import type { MatchPlay, RoundRecord, StrategyInfo } from './types';

export type Move = 'C' | 'D';

/** R: both cooperate. S: I cooperate, they defect. T: I defect, they cooperate. P: both defect. */
export interface Payoffs {
  R: number;
  S: number;
  T: number;
  P: number;
}

export type GamePreset = 'pd' | 'stag' | 'chicken';

export interface GameParams {
  preset: GamePreset;
  payoffs: Payoffs;
  /** Trembling hand: chance that an intended move is flipped. */
  noise: number;
}

export const GAME_PRESETS: Record<GamePreset, { name: string; c: string; d: string; payoffs: Payoffs }> = {
  pd: { name: "Prisoner's Dilemma", c: 'cooperate', d: 'defect', payoffs: { R: 3, S: 0, T: 5, P: 1 } },
  stag: { name: 'Stag Hunt', c: 'hunt stag', d: 'hunt hare', payoffs: { R: 4, S: 0, T: 3, P: 2 } },
  chicken: { name: 'Chicken', c: 'swerve', d: 'drive straight', payoffs: { R: 3, S: 1, T: 5, P: 0 } },
};

export interface GameCtx {
  /** Moves actually played so far (after noise), mine and theirs. */
  my: Move[];
  their: Move[];
  round: number;
  rng: Rng;
}

export interface GameStrategy extends StrategyInfo {
  /** Returns a fresh player; closures may keep per-match state. */
  create(): (ctx: GameCtx) => Move;
}

const last = <T,>(xs: T[], n = 1): T | undefined => xs[xs.length - n];
const stateless = (f: (ctx: GameCtx) => Move) => () => f;

export const GAME_STRATEGIES: GameStrategy[] = [
  { id: 'tft', name: 'Tit for Tat', blurb: 'Starts nice, then copies your last move.', create: stateless((c) => last(c.their) ?? 'C') },
  { id: 'allc', name: 'Always Cooperate', blurb: 'Cooperates no matter what.', create: stateless(() => 'C') },
  { id: 'alld', name: 'Always Defect', blurb: 'Defects no matter what.', create: stateless(() => 'D') },
  {
    id: 'tf2t',
    name: 'Tit for Two Tats',
    blurb: 'Retaliates only after two defections in a row.',
    create: stateless((c) => (last(c.their) === 'D' && last(c.their, 2) === 'D' ? 'D' : 'C')),
  },
  {
    id: 'grim',
    name: 'Grim Trigger',
    blurb: 'Cooperates until you defect once, then never again.',
    create: stateless((c) => (c.their.includes('D') ? 'D' : 'C')),
  },
  {
    id: 'pavlov',
    name: 'Pavlov',
    blurb: 'Win-stay, lose-shift: cooperates when the last moves matched.',
    create: stateless((c) => (c.round === 0 || last(c.my) === last(c.their) ? 'C' : 'D')),
  },
  {
    id: 'gtft',
    name: 'Generous TFT',
    blurb: 'Tit for Tat that forgives a defection one time in three.',
    create: stateless((c) => (last(c.their) === 'D' && c.rng() >= 1 / 3 ? 'D' : 'C')),
  },
  {
    id: 'stft',
    name: 'Suspicious TFT',
    blurb: 'Tit for Tat that opens with a defection.',
    create: stateless((c) => last(c.their) ?? 'D'),
  },
  {
    id: 'joss',
    name: 'Joss',
    blurb: 'Tit for Tat that sneaks in a defection 10% of the time.',
    create: stateless((c) => (last(c.their) === 'D' || c.rng() < 0.1 ? 'D' : 'C')),
  },
  {
    id: 'prober',
    name: 'Prober',
    blurb: 'Tests you with D, C, C. Exploits you if you never punished, else plays Tit for Tat.',
    create: stateless((c) => {
      if (c.round < 3) return c.round === 0 ? 'D' : 'C';
      const punished = c.their[1] === 'D' || c.their[2] === 'D';
      return punished ? (last(c.their) as Move) : 'D';
    }),
  },
  { id: 'alt', name: 'Alternator', blurb: 'Cooperate, defect, cooperate, defect.', create: stateless((c) => (c.round % 2 === 0 ? 'C' : 'D')) },
  { id: 'random', name: 'Random', blurb: 'Flips a fair coin every round.', create: stateless((c) => (c.rng() < 0.5 ? 'C' : 'D')) },
];

/**
 * A memory-one strategy: a first move, then a probability of cooperating that depends only on
 * the previous round. p is ordered by (my move, their move): CC, CD, DC, DD.
 */
export interface MemoryOneSpec {
  id: string;
  name: string;
  first: Move;
  p: [number, number, number, number];
}

export const MEMORY_ONE_PRESETS: { name: string; first: Move; p: MemoryOneSpec['p']; note: string }[] = [
  { name: 'Extort-2', first: 'C', p: [0.8889, 0.5, 0.3333, 0], note: "Press and Dyson's zero-determinant extortioner: its gain over mutual defection is always twice yours." },
  { name: 'WSLS vector', first: 'C', p: [1, 0, 0, 1], note: 'Win-Stay-Lose-Shift (Pavlov) written as a memory-one vector.' },
  { name: 'TFT vector', first: 'C', p: [1, 0, 1, 0], note: 'Tit for Tat as a memory-one vector.' },
  { name: 'Generous-2', first: 'C', p: [1, 0.3, 0.8, 0.2], note: 'A generous zero-determinant strategy: its own shortfall from mutual cooperation is always twice yours.' },
  { name: 'Grim vector', first: 'C', p: [1, 0, 0, 0], note: 'Cooperates only after mutual cooperation.' },
  { name: 'Coin flip', first: 'C', p: [0.5, 0.5, 0.5, 0.5], note: 'A blank slate to edit.' },
];

export function memoryOneStrategy(spec: MemoryOneSpec): GameStrategy {
  const pct = spec.p.map((x) => `${Math.round(x * 100)}%`).join(' / ');
  return {
    id: spec.id,
    name: spec.name,
    blurb: `Custom memory-one: opens ${spec.first}, then cooperates ${pct} of the time after CC / CD / DC / DD.`,
    create: stateless((c) => {
      if (c.round === 0) return spec.first;
      const state = (last(c.my) === 'C' ? 0 : 2) + (last(c.their) === 'C' ? 0 : 1);
      return c.rng() < spec.p[state] ? 'C' : 'D';
    }),
  };
}

export const gameStrategies = (custom: MemoryOneSpec[] = []): GameStrategy[] => [...GAME_STRATEGIES, ...custom.map(memoryOneStrategy)];

export function payoff(p: Payoffs, mine: Move, theirs: Move): number {
  if (mine === 'C') return theirs === 'C' ? p.R : p.S;
  return theirs === 'C' ? p.T : p.P;
}

export function playGameMatch(a: GameStrategy, b: GameStrategy, params: GameParams, rounds: number, rng: Rng): MatchPlay {
  const rngA = fork(rng);
  const rngB = fork(rng);
  const noiseRng = fork(rng);
  const pa = a.create();
  const pb = b.create();
  const ha: Move[] = [];
  const hb: Move[] = [];
  const out: RoundRecord[] = [];
  let scoreA = 0;
  let scoreB = 0;
  const flip = (m: Move): Move => (m === 'C' ? 'D' : 'C');
  for (let round = 0; round < rounds; round++) {
    let ma = pa({ my: ha, their: hb, round, rng: rngA });
    let mb = pb({ my: hb, their: ha, round, rng: rngB });
    let note: string | undefined;
    if (params.noise > 0) {
      const fa = noiseRng() < params.noise;
      const fb = noiseRng() < params.noise;
      if (fa) ma = flip(ma);
      if (fb) mb = flip(mb);
      if (fa || fb) note = 'slip';
    }
    const xa = payoff(params.payoffs, ma, mb);
    const xb = payoff(params.payoffs, mb, ma);
    ha.push(ma);
    hb.push(mb);
    scoreA += xa;
    scoreB += xb;
    out.push({
      a: { label: ma, payoff: xa, tone: ma === 'C' ? 'good' : 'bad' },
      b: { label: mb, payoff: xb, tone: mb === 'C' ? 'good' : 'bad' },
      note,
    });
  }
  return { rounds: out, scoreA, scoreB };
}
