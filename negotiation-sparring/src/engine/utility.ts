import type { HardCap, Issue, Offer, Outcome, Scenario, SideProfile } from './types.js';

/** Additive utility on a 0..100 scale. */
export function utility(profile: SideProfile, issues: Issue[], offer: Offer): number {
  let u = 0;
  for (const issue of issues) u += profile.weights[issue.id] * profile.values[issue.id][offer[issue.id]];
  return 100 * u;
}

export function isCompleteOffer(issues: Issue[], offer: unknown): offer is Offer {
  if (typeof offer !== 'object' || offer === null) return false;
  const o = offer as Record<string, unknown>;
  return issues.every((i) => Number.isInteger(o[i.id]) && (o[i.id] as number) >= 0 && (o[i.id] as number) < i.options.length);
}

export const withinCap = (cap: HardCap, offer: Offer) => offer[cap.issue] >= cap.min && offer[cap.issue] <= cap.max;

/** Every combination of options, with both sides' utilities. */
export function enumerateAll(issues: Issue[], player: SideProfile, counterpart: SideProfile): Outcome[] {
  let partial: Offer[] = [{}];
  for (const issue of issues) {
    const next: Offer[] = [];
    for (const o of partial) for (let k = 0; k < issue.options.length; k++) next.push({ ...o, [issue.id]: k });
    partial = next;
  }
  return partial.map((offer) => ({ offer, p: utility(player, issues, offer), c: utility(counterpart, issues, offer) }));
}

const cache = new WeakMap<Scenario, Outcome[]>();

/** Deals the counterpart could sign at all: everything inside its hard cap. */
export function feasibleOutcomes(sc: Scenario): Outcome[] {
  let hit = cache.get(sc);
  if (!hit) {
    hit = enumerateAll(sc.issues, sc.player, sc.counterpart).filter((o) => withinCap(sc.hidden.hardCap, o.offer));
    cache.set(sc, hit);
  }
  return hit;
}

export const playerUtility = (sc: Scenario, offer: Offer) => utility(sc.player, sc.issues, offer);
export const counterpartUtility = (sc: Scenario, offer: Offer) => utility(sc.counterpart, sc.issues, offer);

/** Money worth of a number of the player's utility points. */
export const pointsToMoney = (sc: Scenario, points: number) => (points * sc.stake) / 100;

export function formatMoney(sc: Scenario, amount: number): string {
  const rounded = Math.round(Math.abs(amount) / 10) * 10;
  return `${amount < 0 ? '-' : ''}${sc.currency}${rounded.toLocaleString('en-GB')}`;
}

export function describeOffer(issues: Issue[], offer: Offer): string {
  return issues.map((i) => `${i.label}: ${i.options[offer[i.id]].label}`).join('; ');
}

export const sameOffer = (issues: Issue[], a: Offer, b: Offer) => issues.every((i) => a[i.id] === b[i.id]);
