import { type Rng, fork } from './rng';
import { clamp, type MatchPlay, type RoundRecord, type StrategyInfo } from './types';

export type AuctionFormat = 'first' | 'second';

export interface AuctionParams {
  format: AuctionFormat;
}

/** Private values are uniform on [0, VALUE_MAX], redrawn every round. */
export const VALUE_MAX = 100;

export interface AuctionMemory {
  value: number;
  bid: number;
  won: boolean;
  /** Price paid by whoever won. */
  price: number;
  surplus: number;
}

export interface BidCtx {
  value: number;
  format: AuctionFormat;
  /** Number of bidders in the room. */
  n: number;
  history: AuctionMemory[];
  rng: Rng;
}

export interface AuctionStrategy extends StrategyInfo {
  create(): (ctx: BidCtx) => number;
}

const stateless = (f: (ctx: BidCtx) => number) => () => f;

export const AUCTION_STRATEGIES: AuctionStrategy[] = [
  { id: 'truthful', name: 'Truthful', blurb: 'Bids exactly what the item is worth to it.', create: stateless((c) => c.value) },
  {
    id: 'equilibrium',
    name: 'Equilibrium',
    blurb: 'Textbook play: shades to (n-1)/n of value in first-price, truthful in second-price.',
    create: stateless((c) => (c.format === 'first' ? (c.value * (c.n - 1)) / c.n : c.value)),
  },
  { id: 'shade20', name: 'Shade 20%', blurb: 'Always bids 80% of its value.', create: stateless((c) => c.value * 0.8) },
  { id: 'lowball', name: 'Lowballer', blurb: 'Bids a third of its value and hopes.', create: stateless((c) => c.value / 3) },
  { id: 'overbid', name: 'Overbidder', blurb: 'Hates losing: bids 120% of its value.', create: stateless((c) => c.value * 1.2) },
  { id: 'random', name: 'Random', blurb: 'Bids a random amount between zero and its value.', create: stateless((c) => c.value * c.rng()) },
  {
    id: 'adaptive',
    name: 'Adaptive Learner',
    blurb: 'Shades more after each win, less after losing an item it could have afforded.',
    create: () => {
      let factor = 0.8;
      let seen = 0;
      return (c) => {
        for (; seen < c.history.length; seen++) {
          const h = c.history[seen];
          if (h.won) factor -= 0.02;
          else if (h.value > h.price) factor += 0.04;
          factor = clamp(factor, 0.3, 1);
        }
        return c.value * factor;
      };
    },
  },
];

export function playAuctionMatch(a: AuctionStrategy, b: AuctionStrategy, params: AuctionParams, rounds: number, rng: Rng): MatchPlay {
  // Values are drawn up front so they depend only on the seed, never on who is bidding.
  const values: [number, number][] = [];
  for (let r = 0; r < rounds; r++) values.push([rng() * VALUE_MAX, rng() * VALUE_MAX]);
  const rngA = fork(rng);
  const rngB = fork(rng);
  const tieRng = fork(rng);
  const pa = a.create();
  const pb = b.create();
  const ha: AuctionMemory[] = [];
  const hb: AuctionMemory[] = [];
  const out: RoundRecord[] = [];
  let scoreA = 0;
  let scoreB = 0;
  for (let r = 0; r < rounds; r++) {
    const [va, vb] = values[r];
    const ba = Math.max(0, pa({ value: va, format: params.format, n: 2, history: ha, rng: rngA }));
    const bb = Math.max(0, pb({ value: vb, format: params.format, n: 2, history: hb, rng: rngB }));
    const aWins = ba === bb ? tieRng() < 0.5 : ba > bb;
    const price = params.format === 'first' ? Math.max(ba, bb) : Math.min(ba, bb);
    const xa = aWins ? va - price : 0;
    const xb = aWins ? 0 : vb - price;
    scoreA += xa;
    scoreB += xb;
    ha.push({ value: va, bid: ba, won: aWins, price, surplus: xa });
    hb.push({ value: vb, bid: bb, won: !aWins, price, surplus: xb });
    const tone = (won: boolean, x: number) => (won ? (x >= 0 ? 'good' : 'bad') : 'neutral');
    out.push({
      a: { label: String(Math.round(ba)), payoff: xa, tone: tone(aWins, xa) },
      b: { label: String(Math.round(bb)), payoff: xb, tone: tone(!aWins, xb) },
      note: `values ${Math.round(va)} / ${Math.round(vb)}, price ${Math.round(price)}`,
    });
  }
  return { rounds: out, scoreA, scoreB };
}
