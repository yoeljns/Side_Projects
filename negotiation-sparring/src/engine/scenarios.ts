import { between, intBetween, makeRng, pick, type Rng } from './rng.js';
import type { Difficulty, FamilyId, Hidden, Issue, Option, Scenario, ScenarioRef, Side, SideProfile } from './types.js';
import { enumerateAll, withinCap } from './utility.js';

type Dir = 'low' | 'high';

interface IssueSpec {
  id: string;
  label: string;
  options: Option[];
  /** Which end of the range each side wants. */
  a: Dir;
  b: Dir;
  /** Base weights before jitter. */
  wa: number;
  wb: number;
}

interface FamilySpec {
  title: string;
  roles: Record<Side, string>;
  setting: (rng: Rng) => { text: string; issues: IssueSpec[]; price: string; stake: number };
  batna: Record<Side, string[]>;
  capStory: (label: string) => string;
}

const money = (n: number, digits = 0) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const nums = (values: number[], label: (v: number) => string): Option[] => values.map((v) => ({ value: v, label: label(v) }));
const named = (labels: string[]): Option[] => labels.map((label, value) => ({ value, label }));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
/** Nine price points from -20% to +20% of a base. */
const ladder = (base: number, stepPct: number, step: number) =>
  Array.from({ length: 9 }, (_, k) => roundTo(base * (1 + ((k - 4) * stepPct) / 100), step));

export const FAMILIES: Record<FamilyId, FamilySpec> = {
  supplier: {
    title: 'Supply contract',
    roles: { a: 'Buyer', b: 'Supplier' },
    setting: (rng) => {
      const part = pick(rng, ['machined housings', 'printed packaging', 'control boards', 'woven fabric rolls']);
      const base = pick(rng, [4, 6.5, 9, 12, 18]);
      const volumes = [10, 15, 20, 25, 30].map((k) => k * 1000);
      return {
        text: `A one-year supply contract for ${part}. The buyer needs a dependable source; the supplier has capacity to fill.`,
        price: 'price',
        stake: roundTo(base * 20000 * 0.6, 1000),
        issues: [
          { id: 'price', label: 'Unit price', options: nums(ladder(base, 5, 0.05), (v) => money(v, 2)), a: 'low', b: 'high', wa: 0.4, wb: 0.4 },
          { id: 'volume', label: 'Committed volume', options: nums(volumes, (v) => `${v.toLocaleString('en-GB')} units`), a: 'low', b: 'high', wa: 0.12, wb: 0.2 },
          { id: 'payment', label: 'Payment terms', options: nums([15, 30, 45, 60, 90], (v) => `${v} days`), a: 'high', b: 'low', wa: 0.2, wb: 0.1 },
          { id: 'lead', label: 'Delivery lead time', options: nums([2, 3, 4, 6, 8], (v) => `${v} weeks`), a: 'low', b: 'high', wa: 0.18, wb: 0.12 },
          { id: 'exclusive', label: 'Exclusivity', options: named(['None', 'Preferred supplier', 'Sole supplier']), a: 'low', b: 'high', wa: 0.1, wb: 0.18 },
        ],
      };
    },
    batna: {
      a: ['A second supplier has quoted for the same part.', 'You could keep the current supplier for another year.'],
      b: ['Another customer wants the same production slot.', 'You could sell the capacity on the spot market.'],
    },
    capStory: (label) => `Head office has set a firm limit on ${label.toLowerCase()}.`,
  },
  dealer: {
    title: 'Vehicle purchase',
    roles: { a: 'Buyer', b: 'Dealer' },
    setting: (rng) => {
      const what = pick(rng, ['a two-year-old estate car', 'a new delivery van', 'a compact excavator', 'a nearly new hatchback']);
      const base = pick(rng, [18000, 24000, 32000, 45000]);
      const tradeIn = roundTo(base * 0.2, 500);
      return {
        text: `Buying ${what} from a dealership, with an older vehicle offered in part exchange.`,
        price: 'price',
        stake: roundTo(base * 0.25, 500),
        issues: [
          { id: 'price', label: 'Price', options: nums(ladder(base, 2.5, 50), (v) => money(v)), a: 'low', b: 'high', wa: 0.42, wb: 0.4 },
          { id: 'tradein', label: 'Trade-in allowance', options: nums([0.7, 0.85, 1, 1.15, 1.3].map((k) => roundTo(tradeIn * k, 50)), (v) => money(v)), a: 'high', b: 'low', wa: 0.2, wb: 0.2 },
          { id: 'warranty', label: 'Warranty', options: nums([1, 2, 3, 5], (v) => `${v} year${v === 1 ? '' : 's'}`), a: 'high', b: 'low', wa: 0.14, wb: 0.1 },
          { id: 'apr', label: 'Finance rate', options: nums([0, 2.9, 4.9, 6.9, 8.9], (v) => `${v.toFixed(1)}% APR`), a: 'low', b: 'high', wa: 0.14, wb: 0.18 },
          { id: 'service', label: 'Servicing included', options: named(['None', '1 year', '3 years']), a: 'high', b: 'low', wa: 0.1, wb: 0.12 },
        ],
      };
    },
    batna: {
      a: ['Another dealer across town has a similar one in stock.', 'You could keep the current vehicle for another year.'],
      b: ['Someone else is booked to view it at the weekend.', 'The stock can go to trade auction at the end of the month.'],
    },
    capStory: (label) => `The dealership's manager will not sign past a set point on ${label.toLowerCase()}.`,
  },
  distribution: {
    title: 'Distribution agreement',
    roles: { a: 'Distributor', b: 'Brand' },
    setting: (rng) => {
      const what = pick(rng, ['a speciality coffee brand', 'a range of power tools', 'a skincare line', 'a cycling accessories brand']);
      const unit = pick(rng, [2000, 3000, 5000]);
      return {
        text: `A distribution agreement for ${what} entering a new market. The distributor sells on; the brand supplies stock and support.`,
        price: 'margin',
        stake: unit * 40,
        issues: [
          { id: 'margin', label: 'Distributor margin', options: nums([20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40], (v) => `${v}%`), a: 'high', b: 'low', wa: 0.38, wb: 0.36 },
          { id: 'territory', label: 'Territory', options: named(['One city', 'One region', 'Whole country', 'Country, exclusive']), a: 'high', b: 'low', wa: 0.2, wb: 0.2 },
          { id: 'minimum', label: 'Minimum annual order', options: nums([1, 1.5, 2, 2.5, 3].map((k) => k * unit), (v) => `${v.toLocaleString('en-GB')} units`), a: 'low', b: 'high', wa: 0.16, wb: 0.2 },
          { id: 'marketing', label: 'Brand marketing contribution', options: nums([0, 1, 2, 3, 5], (v) => `${v}% of sales`), a: 'high', b: 'low', wa: 0.14, wb: 0.12 },
          { id: 'term', label: 'Contract length', options: nums([1, 2, 3, 5], (v) => `${v} year${v === 1 ? '' : 's'}`), a: 'high', b: 'low', wa: 0.12, wb: 0.12 },
        ],
      };
    },
    batna: {
      a: ['A competing brand has offered you its line.', 'You could put the shelf space behind your existing lines.'],
      b: ['A second distributor has asked for the market.', 'You could sell direct online and skip a distributor.'],
    },
    capStory: (label) => `The board has fixed how far the company can go on ${label.toLowerCase()}.`,
  },
  rate: {
    title: 'Contractor rate',
    roles: { a: 'Client', b: 'Contractor' },
    setting: (rng) => {
      const what = pick(rng, ['a data platform rebuild', 'an interim finance role', 'a product design engagement', 'a compliance programme']);
      const base = pick(rng, [450, 550, 700, 850]);
      return {
        text: `A contract for ${what}. The client needs the work done; the contractor is choosing between engagements.`,
        price: 'rate',
        stake: base * 40,
        issues: [
          { id: 'rate', label: 'Day rate', options: nums(ladder(base, 5, 10), (v) => money(v)), a: 'low', b: 'high', wa: 0.42, wb: 0.4 },
          { id: 'days', label: 'Days per week', options: nums([2, 3, 4, 5], (v) => `${v} days`), a: 'high', b: 'low', wa: 0.14, wb: 0.14 },
          { id: 'length', label: 'Contract length', options: nums([3, 6, 9, 12], (v) => `${v} months`), a: 'low', b: 'high', wa: 0.14, wb: 0.2 },
          { id: 'notice', label: 'Notice period', options: nums([1, 2, 4, 8], (v) => `${v} week${v === 1 ? '' : 's'}`), a: 'low', b: 'high', wa: 0.12, wb: 0.12 },
          { id: 'onsite', label: 'On-site days per week', options: nums([0, 1, 2, 3, 4], (v) => `${v} on site`), a: 'high', b: 'low', wa: 0.18, wb: 0.14 },
        ],
      };
    },
    batna: {
      a: ['Another contractor is available at short notice.', 'You could cover the work with the existing team, slowly.'],
      b: ['Another client has an engagement on offer.', 'You could stay in the current contract a little longer.'],
    },
    capStory: (label) => `A commitment elsewhere limits what is possible on ${label.toLowerCase()}.`,
  },
};

export const FAMILY_IDS = Object.keys(FAMILIES) as FamilyId[];

const BATNA_RANGE: Record<Difficulty, [number, number]> = { easy: [28, 36], medium: [38, 46], hard: [47, 54] };
/** Chance that no deal can satisfy both sides, so walking away is correct. */
const NO_ZOPA_CHANCE: Record<Difficulty, number> = { easy: 0, medium: 0.1, hard: 0.25 };
const FINAL_CONCESSION: Record<Difficulty, number> = { easy: 0.85, medium: 0.75, hard: 0.62 };

function curve(n: number, dir: Dir, gamma: number): number[] {
  return Array.from({ length: n }, (_, k) => {
    const t = n === 1 ? 1 : k / (n - 1);
    return Math.pow(dir === 'high' ? t : 1 - t, gamma);
  });
}

function normalise(w: Record<string, number>): Record<string, number> {
  const total = Object.values(w).reduce((s, x) => s + x, 0);
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total]));
}

/** Deterministic: the same ref always gives the same scenario, hidden side included. */
export function generateScenario(ref: ScenarioRef): Scenario {
  const family = FAMILIES[ref.family];
  const rng = makeRng('negotiation-sparring', ref.family, ref.seed, ref.difficulty, ref.role);
  const base = family.setting(rng);
  const other: Side = ref.role === 'a' ? 'b' : 'a';
  const issues: Issue[] = base.issues.map(({ id, label, options }) => ({ id, label, options }));

  const side = (who: Side) => {
    const weights: Record<string, number> = {};
    const values: Record<string, number[]> = {};
    for (const spec of base.issues) {
      weights[spec.id] = (who === 'a' ? spec.wa : spec.wb) * between(rng, 0.7, 1.3);
      values[spec.id] = curve(spec.options.length, spec[who], between(rng, 0.75, 1.4));
    }
    return { weights, values };
  };
  const mine = side(ref.role);
  const theirs = side(other);

  // Hidden: one side issue the counterpart barely cares about, and a hard cap on another issue.
  const sideIssues = base.issues.filter((s) => s.id !== base.price);
  const cheap = pick(rng, sideIssues);
  theirs.weights[cheap.id] = between(rng, 0.02, 0.04);
  const capSpec = pick(rng, base.issues.filter((s) => s.id !== cheap.id));
  const n = capSpec.options.length;
  // The cap removes the end of the range the player would like most.
  const cut = n >= 7 ? 2 : 1;
  const hardCap = {
    issue: capSpec.id,
    min: capSpec[ref.role] === 'low' ? cut : 0,
    max: capSpec[ref.role] === 'high' ? n - 1 - cut : n - 1,
    story: family.capStory(capSpec.label),
  };

  const deadlineRound = intBetween(rng, 3, 5);
  const hidden: Hidden = {
    hardCap,
    deadlineRound,
    maxRounds: deadlineRound + intBetween(rng, 3, 4),
    finalConcession: FINAL_CONCESSION[ref.difficulty],
    cheapIssue: cheap.id,
    deadlineStory: pick(rng, [
      'They have to report an outcome to their own side soon.',
      'Their alternative expires if they wait too long.',
      'Their quarter closes shortly and they want this settled.',
    ]),
    tone: pick(rng, ['brisk', 'warm', 'formal', 'blunt'] as const),
  };

  const [lo, hi] = BATNA_RANGE[ref.difficulty];
  const player: SideProfile = {
    roleLabel: family.roles[ref.role],
    weights: normalise(mine.weights),
    values: mine.values,
    batna: Math.round(between(rng, lo, hi)),
    batnaStory: pick(rng, family.batna[ref.role]),
    discount: Math.round(between(rng, 0.9, 0.97) * 100) / 100,
  };
  const counterpart: SideProfile = {
    roleLabel: family.roles[other],
    weights: normalise(theirs.weights),
    values: theirs.values,
    batna: Math.round(between(rng, lo, hi)),
    batnaStory: pick(rng, family.batna[other]),
    discount: Math.round(between(rng, 0.88, 0.97) * 100) / 100,
  };

  // Place the reservation points so the bargaining zone is what the difficulty intends.
  const noZopa = rng() < NO_ZOPA_CHANCE[ref.difficulty];
  const feasible = enumerateAll(issues, player, counterpart).filter((o) => withinCap(hardCap, o.offer));
  if (noZopa) {
    const best = Math.max(...feasible.filter((o) => o.p >= player.batna).map((o) => o.c), 0);
    counterpart.batna = Math.max(counterpart.batna, Math.ceil(best) + 3);
    counterpart.batnaStory += ' It is a strong one.';
  } else {
    // Keep at least a few points of joint gain available to each side.
    const room = () => Math.max(...feasible.map((o) => Math.min(o.p - player.batna, o.c - counterpart.batna)));
    while (room() < 5) {
      player.batna -= 1;
      counterpart.batna -= 1;
    }
  }

  return {
    ref,
    title: family.title,
    setting: base.text,
    issues,
    player,
    counterpart,
    hidden,
    currency: '£',
    stake: base.stake,
    priceIssue: base.price,
  };
}

export function isScenarioRef(x: unknown): x is ScenarioRef {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.family === 'string' &&
    FAMILY_IDS.includes(r.family as FamilyId) &&
    Number.isInteger(r.seed) &&
    (r.seed as number) >= 0 &&
    (r.seed as number) <= 0xffffffff &&
    (r.difficulty === 'easy' || r.difficulty === 'medium' || r.difficulty === 'hard') &&
    (r.role === 'a' || r.role === 'b')
  );
}
