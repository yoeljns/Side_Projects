import { type Rng, fork } from './rng';
import { clamp, type StrategyInfo } from './types';

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

export interface AuctionRound {
  values: number[];
  bids: number[];
  winner: number;
  /** What the winner pays, i.e. the seller's revenue this round. */
  price: number;
  /** The winner's surplus: value minus price. Everyone else gets zero. */
  surplus: number;
}

export interface BidderStats {
  wins: number;
  surplus: number;
  /** Average bid as a fraction of value. */
  bidRatio: number;
}

export interface AuctionRoom {
  format: AuctionFormat;
  rounds: AuctionRound[];
  /** Cumulative surplus per bidder. */
  scores: number[];
  stats: BidderStats[];
  avgRevenue: number;
}

/** Every bidder bids in the same sealed-bid auction, once per round. */
export function playAuctionRoom(bidders: AuctionStrategy[], params: AuctionParams, rounds: number, rng: Rng): AuctionRoom {
  const n = bidders.length;
  // Values are drawn up front so they depend only on the seed and room size, never on who is bidding or the format.
  const values: number[][] = [];
  for (let r = 0; r < rounds; r++) values.push(bidders.map(() => rng() * VALUE_MAX));
  const rngs = bidders.map(() => fork(rng));
  const tieRng = fork(rng);
  const players = bidders.map((b) => b.create());
  const memory: AuctionMemory[][] = bidders.map(() => []);
  const scores = bidders.map(() => 0);
  const stats: BidderStats[] = bidders.map(() => ({ wins: 0, surplus: 0, bidRatio: 0 }));
  const ratioCount = bidders.map(() => 0);
  const out: AuctionRound[] = [];
  let revenue = 0;
  for (let r = 0; r < rounds; r++) {
    const vals = values[r];
    const bids = players.map((p, i) => Math.max(0, p({ value: vals[i], format: params.format, n, history: memory[i], rng: rngs[i] })));
    const top = Math.max(...bids);
    const tied = bids.flatMap((b, i) => (b === top ? [i] : []));
    const winner = tied.length === 1 ? tied[0] : tied[Math.floor(tieRng() * tied.length)];
    const second = n > 1 ? Math.max(...bids.filter((_, i) => i !== winner)) : 0;
    const price = params.format === 'first' ? top : second;
    const surplus = vals[winner] - price;
    scores[winner] += surplus;
    stats[winner].wins++;
    stats[winner].surplus += surplus;
    revenue += price;
    bids.forEach((bid, i) => {
      memory[i].push({ value: vals[i], bid, won: i === winner, price, surplus: i === winner ? surplus : 0 });
      if (vals[i] > 1e-9) {
        stats[i].bidRatio += bid / vals[i];
        ratioCount[i]++;
      }
    });
    out.push({ values: vals, bids, winner, price, surplus });
  }
  stats.forEach((s, i) => (s.bidRatio = ratioCount[i] ? s.bidRatio / ratioCount[i] : 0));
  return { format: params.format, rounds: out, scores, stats, avgRevenue: rounds ? revenue / rounds : 0 };
}

/** Expected revenue with n risk-neutral bidders and uniform values, in either format: (n-1)/(n+1) of the top value. */
export const theoreticalRevenue = (n: number): number => (VALUE_MAX * (n - 1)) / (n + 1);
