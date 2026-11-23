import { type Rng, fork } from './rng';
import { clamp, type MatchPlay, type RoundRecord, type StrategyInfo } from './types';

export type BargainMode = 'ultimatum' | 'rubinstein';

export interface BargainParams {
  mode: BargainMode;
  /** Rubinstein: the pie keeps this fraction of its size after each rejected offer. */
  delta: number;
  /** Rubinstein: offers allowed before the pie is lost. */
  maxStages: number;
}

/** The pie split each round. */
export const PIE = 100;

export interface BargainMemory {
  /** Did I make the opening offer this round? */
  opened: boolean;
  /** Share of the pie on the table when the round ended, as offered to the responder (0..1). */
  offer: number;
  deal: boolean;
  payoff: number;
}

export interface BargainCtx {
  /** 0 for the opening offer; grows with each rejection (always 0 in ultimatum). */
  stage: number;
  /** Offers left including this one (1 = last chance). */
  stagesLeft: number;
  delta: number;
  history: BargainMemory[];
  rng: Rng;
}

export interface Bargainer {
  /** Share of the current pie (0..1) to offer the other side. */
  propose(ctx: BargainCtx): number;
  /** Accept this share of the current pie? */
  respond(offer: number, ctx: BargainCtx): boolean;
}

export interface BargainStrategy extends StrategyInfo {
  create(): Bargainer;
}

/** Proposer's share of the current pie under backward induction with k offers left. */
export function speProposerShare(k: number, delta: number): number {
  let v = 1;
  for (let i = 1; i < k; i++) v = 1 - delta * v;
  return v;
}

const fixed = (offer: number, accept: number) => (): Bargainer => ({
  propose: () => offer,
  respond: (o) => o >= accept - 1e-9,
});

export const BARGAIN_STRATEGIES: BargainStrategy[] = [
  { id: 'fair', name: 'Fair Splitter', blurb: 'Offers half, accepts 45% or more.', create: fixed(0.5, 0.45) },
  { id: 'greedy', name: 'Greedy', blurb: 'Offers 20%, but will take 20% too.', create: fixed(0.2, 0.2) },
  { id: 'tough', name: 'Tough Responder', blurb: 'Offers 35% and refuses anything under half.', create: fixed(0.35, 0.5) },
  {
    id: 'spe',
    name: 'Equilibrium',
    blurb: 'Backward induction: offers exactly what a rational responder would get by waiting, accepts the same.',
    create: () => {
      const reservation = (c: BargainCtx) => (c.stagesLeft <= 1 ? 0.01 : c.delta * speProposerShare(c.stagesLeft - 1, c.delta));
      return { propose: (c) => reservation(c), respond: (o, c) => o >= reservation(c) - 1e-9 };
    },
  },
  {
    id: 'conceder',
    name: 'Conceder',
    blurb: 'Opens greedy, then gives ground with every rejection.',
    create: () => ({
      propose: (c) => clamp(0.2 + 0.1 * c.stage, 0, 0.6),
      respond: (o, c) => o >= clamp(0.5 - 0.08 * c.stage, 0.1, 0.5) - 1e-9,
    }),
  },
  {
    id: 'adaptive',
    name: 'Adaptive',
    blurb: 'Offers less after each deal and more after each breakdown; lowers its own demands when talks fail.',
    create: () => {
      let offer = 0.5;
      let accept = 0.4;
      let seen = 0;
      const learn = (c: BargainCtx) => {
        for (; seen < c.history.length; seen++) {
          const h = c.history[seen];
          if (h.opened) offer = clamp(offer + (h.deal ? -0.03 : 0.06), 0.05, 0.6);
          else accept = clamp(accept + (h.deal ? 0.01 : -0.05), 0.05, 0.5);
        }
      };
      return {
        propose: (c) => (learn(c), offer),
        respond: (o, c) => (learn(c), o >= accept - 1e-9),
      };
    },
  },
  {
    id: 'random',
    name: 'Random',
    blurb: 'Offers 10 to 60% at random and accepts on a whim.',
    create: () => ({
      propose: (c) => 0.1 + 0.5 * c.rng(),
      respond: (o, c) => o >= 0.1 + 0.4 * c.rng(),
    }),
  },
];

export function playBargainMatch(a: BargainStrategy, b: BargainStrategy, params: BargainParams, rounds: number, rng: Rng): MatchPlay {
  const rngs = [fork(rng), fork(rng)];
  const players = [a.create(), b.create()];
  const memory: BargainMemory[][] = [[], []];
  const stages = params.mode === 'ultimatum' ? 1 : Math.max(1, Math.floor(params.maxStages));
  const delta = params.mode === 'ultimatum' ? 1 : params.delta;
  const out: RoundRecord[] = [];
  const score = [0, 0];
  for (let r = 0; r < rounds; r++) {
    const opener = r % 2; // the right to open alternates between rounds
    let deal = false;
    let offer = 0;
    let proposer = opener;
    let stage = 0;
    for (; stage < stages; stage++) {
      proposer = (opener + stage) % 2;
      const responder = 1 - proposer;
      const ctx = (who: number): BargainCtx => ({ stage, stagesLeft: stages - stage, delta, history: memory[who], rng: rngs[who] });
      offer = clamp(players[proposer].propose(ctx(proposer)), 0, 1);
      if (players[responder].respond(offer, ctx(responder))) {
        deal = true;
        break;
      }
    }
    const pie = deal ? PIE * Math.pow(delta, stage) : 0;
    const pay = [0, 0];
    pay[proposer] = pie * (1 - offer);
    pay[1 - proposer] = pie * offer;
    for (const who of [0, 1]) {
      score[who] += pay[who];
      memory[who].push({ opened: who === opener, offer, deal, payoff: pay[who] });
    }
    const side = (who: number) => ({
      label: who === proposer ? String(Math.round(offer * 100)) : deal ? 'ok' : 'no',
      payoff: pay[who],
      tone: deal ? ('good' as const) : ('bad' as const),
    });
    const offers = deal ? stage + 1 : stages;
    out.push({
      a: side(0),
      b: side(1),
      note: `${proposer === 0 ? a.name : b.name} offers ${Math.round(offer * 100)}%: ${deal ? 'deal' : 'no deal'}${stages > 1 ? ` after ${offers} offer${offers > 1 ? 's' : ''}` : ''}`,
    });
  }
  return { rounds: out, scoreA: score[0], scoreB: score[1] };
}
