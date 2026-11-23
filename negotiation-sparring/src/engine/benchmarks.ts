import type { Offer, Point, Scenario } from './types.js';
import { counterpartUtility, feasibleOutcomes, playerUtility, withinCap } from './utility.js';

const EPS = 1e-9;

/** Points no other point beats on both axes, sorted by player utility, descending. */
export function paretoFrontier<T extends Point>(points: T[]): T[] {
  const sorted = [...points].sort((x, y) => y.p - x.p || y.c - x.c);
  const out: T[] = [];
  let bestC = -Infinity;
  for (const pt of sorted) {
    if (pt.c > bestC + EPS) {
      out.push(pt);
      bestC = pt.c;
    }
  }
  return out;
}

/** Points at least as good as the disagreement point for both sides. */
export function rational<T extends Point>(points: T[], d: Point): T[] {
  return points.filter((pt) => pt.p >= d.p - EPS && pt.c >= d.c - EPS);
}

/**
 * Nash bargaining solution over a finite set of deals: the point that maximises the
 * product of both sides' gains over the disagreement point. No lotteries over deals.
 */
export function nashSolution<T extends Point>(points: T[], d: Point): T | null {
  let best: T | null = null;
  let bestProduct = -1;
  for (const pt of rational(points, d)) {
    const product = (pt.p - d.p) * (pt.c - d.c);
    if (product > bestProduct + EPS || (Math.abs(product - bestProduct) <= EPS && best && pt.p + pt.c > best.p + best.c)) {
      best = pt;
      bestProduct = product;
    }
  }
  return best;
}

/** Each side's best outcome among deals the other would still accept. */
export function idealPoint(points: Point[], d: Point): Point | null {
  const ok = rational(points, d);
  if (!ok.length) return null;
  return { p: Math.max(...ok.map((x) => x.p)), c: Math.max(...ok.map((x) => x.c)) };
}

/**
 * Kalai-Smorodinsky over a finite set: the point where the smaller of the two sides'
 * gains, each as a fraction of its ideal gain, is largest (equal relative concessions).
 */
export function kalaiSmorodinsky<T extends Point>(points: T[], d: Point): T | null {
  const ideal = idealPoint(points, d);
  if (!ideal) return null;
  const share = (gain: number, max: number) => (max > EPS ? gain / max : 1);
  let best: T | null = null;
  let bestMin = -1;
  for (const pt of rational(points, d)) {
    const m = Math.min(share(pt.p - d.p, ideal.p - d.p), share(pt.c - d.c, ideal.c - d.c));
    if (m > bestMin + EPS || (Math.abs(m - bestMin) <= EPS && best && pt.p + pt.c > best.p + best.c)) {
      best = pt;
      bestMin = m;
    }
  }
  return best;
}

/** First proposer's share of the pie in Rubinstein's infinite alternating-offers game. */
export function rubinsteinShare(deltaProposer: number, deltaResponder: number): number {
  const denom = 1 - deltaProposer * deltaResponder;
  // Two perfectly patient sides: the limit of equal discount factors is an even split.
  return denom < EPS ? 0.5 : (1 - deltaResponder) / denom;
}

/**
 * The same game cut off after k offers (backward induction). With one offer left the
 * proposer takes everything. With equal discount factors this is 1 - d*v(k-1).
 */
export function finiteProposerShare(k: number, deltaProposer: number, deltaResponder: number): number {
  let v = 1;
  for (let i = 1; i < k; i++) {
    // With i offers left the proposer is the first proposer when k - i is even;
    // one step earlier that same side is the responder, weighing what waiting is worth.
    const responderWaits = (k - i) % 2 === 0 ? deltaProposer : deltaResponder;
    v = 1 - responderWaits * v;
  }
  return v;
}

export interface Zopa {
  exists: boolean;
  /** The buyer's highest acceptable price and the seller's lowest. */
  buyerMax: number;
  sellerMin: number;
  width: number;
}

export function zopa(buyerMax: number, sellerMin: number): Zopa {
  return { exists: buyerMax >= sellerMin, buyerMax, sellerMin, width: Math.max(0, buyerMax - sellerMin) };
}

export interface PriceView {
  issue: string;
  /** The other issues held fixed for this view. */
  base: Offer;
  /** Option indices each side would still sign at, best-for-them first; empty if none. */
  playerOk: number[];
  counterpartOk: number[];
  /** Price values at each side's limit, or null if that side would refuse every price. */
  playerLimit: number | null;
  counterpartLimit: number | null;
  exists: boolean;
  /** Width of the overlap in price units. */
  width: number;
  /** Price the Rubinstein split points to, with the player proposing first. Null without a zone. */
  rubinsteinPrice: number | null;
  playerShare: number;
}

/** The package with every issue at its middle option, pulled inside the hard cap. */
export function middlePackage(sc: Scenario): Offer {
  const offer: Offer = {};
  for (const i of sc.issues) offer[i.id] = Math.floor((i.options.length - 1) / 2);
  const cap = sc.hidden.hardCap;
  offer[cap.issue] = Math.min(cap.max, Math.max(cap.min, offer[cap.issue]));
  return offer;
}

/**
 * Single-issue view: hold everything but the price issue at `base` and ask which prices
 * each side would sign. The Rubinstein price splits the overlap linearly in price.
 */
export function priceView(sc: Scenario, base: Offer = middlePackage(sc)): PriceView {
  const issue = sc.issues.find((i) => i.id === sc.priceIssue)!;
  const idx = issue.options.map((_, k) => k);
  const at = (k: number): Offer => ({ ...base, [issue.id]: k });
  const playerOk = idx.filter((k) => playerUtility(sc, at(k)) >= sc.player.batna);
  const counterpartOk = idx.filter((k) => withinCap(sc.hidden.hardCap, at(k)) && counterpartUtility(sc, at(k)) >= sc.counterpart.batna);
  // The player's values fall in one direction along the price options.
  const playerWantsLow = sc.player.values[issue.id][0] > sc.player.values[issue.id][issue.options.length - 1];
  const price = (k: number) => issue.options[k].value;
  const playerLimit = playerOk.length ? price(playerWantsLow ? Math.max(...playerOk) : Math.min(...playerOk)) : null;
  const counterpartLimit = counterpartOk.length ? price(playerWantsLow ? Math.min(...counterpartOk) : Math.max(...counterpartOk)) : null;
  const playerShare = rubinsteinShare(sc.player.discount, sc.counterpart.discount);
  let exists = false;
  let width = 0;
  let rubinsteinPrice: number | null = null;
  if (playerLimit !== null && counterpartLimit !== null) {
    const z = playerWantsLow ? zopa(playerLimit, counterpartLimit) : zopa(counterpartLimit, playerLimit);
    exists = z.exists;
    width = z.width;
    // The player's share of the zone is measured from the player's own limit.
    if (exists) rubinsteinPrice = playerLimit + (counterpartLimit - playerLimit) * playerShare;
  }
  return { issue: issue.id, base, playerOk, counterpartOk, playerLimit, counterpartLimit, exists, width, rubinsteinPrice, playerShare };
}

export interface Benchmarks {
  disagreement: Point;
  zopaExists: boolean;
  frontier: ReturnType<typeof feasibleOutcomes>;
  nash: ReturnType<typeof feasibleOutcomes>[number] | null;
  ks: ReturnType<typeof feasibleOutcomes>[number] | null;
  ideal: Point | null;
  price: PriceView;
}

export function benchmarks(sc: Scenario): Benchmarks {
  const all = feasibleOutcomes(sc);
  const d = { p: sc.player.batna, c: sc.counterpart.batna };
  const nash = nashSolution(all, d);
  return {
    disagreement: d,
    zopaExists: nash !== null,
    frontier: paretoFrontier(all),
    nash,
    ks: kalaiSmorodinsky(all, d),
    ideal: idealPoint(all, d),
    price: priceView(sc),
  };
}
