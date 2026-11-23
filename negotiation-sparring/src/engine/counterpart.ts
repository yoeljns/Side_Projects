import type { Offer, Outcome, Scenario, Turn } from './types.js';
import { counterpartUtility, feasibleOutcomes, sameOffer, withinCap } from './utility.js';

/** The counterpart never signs below its reservation plus this margin when it plays from the script. */
const MARGIN = 1;
/** Share of its range the script gives up per round before the deadline round. */
const EARLY_STEP = 0.05;

export const lastOffer = (log: Turn[], by: Turn['by']): Offer | undefined =>
  [...log].reverse().find((t) => t.by === by && t.offer)?.offer;

/** The round about to be played or being answered: one per player turn. */
export const roundOf = (log: Turn[]) => log.filter((t) => t.by === 'player').length;

/** The most the counterpart could get from any deal it can sign. */
export function openingUtility(sc: Scenario): number {
  return Math.max(...feasibleOutcomes(sc).map((o) => o.c));
}

/** With a player who never moves, the script makes only this share of its planned concessions. */
const STONEWALL = 0.6;

/**
 * How far the player has moved towards the counterpart, 0..1: the gain in the
 * counterpart's utility from the player's first ask to their best ask so far, against
 * a quarter of the counterpart's own range. Never falls as the log grows.
 */
export function reciprocity(sc: Scenario, log: Turn[]): number {
  const asks = log.filter((t) => t.by === 'player' && t.offer).map((t) => counterpartUtility(sc, t.offer!));
  if (asks.length < 2) return 0;
  const top = openingUtility(sc);
  const range = Math.max(1, top - Math.min(top, sc.counterpart.batna + MARGIN));
  return Math.min(1, Math.max(0, Math.max(...asks) - asks[0]) / (0.25 * range));
}

/**
 * Time-dependent concession: the utility the counterpart holds out for in a round.
 * A small fixed step per round until the deadline round, then faster, ending
 * `finalConcession` of the way from its opening to its reservation when the player has
 * moved too (`moved` = 1), and 60% of that against a player who has not (`moved` = 0).
 * Never rises from one round to the next.
 */
export function aspiration(sc: Scenario, round: number, moved = 1): number {
  const { deadlineRound: n, maxRounds: m, finalConcession } = sc.hidden;
  const top = openingUtility(sc);
  const floor = Math.min(top, sc.counterpart.batna + MARGIN);
  const r = Math.min(Math.max(round, 1), m);
  const early = EARLY_STEP * (Math.min(r, n) - 1);
  const f = r <= n ? early : early + ((finalConcession - early) * (r - n)) / (m - n);
  return floor + (top - floor) * (1 - f * (STONEWALL + (1 - STONEWALL) * moved));
}

/** Mean distance between two offers, 0 (same) to 1 (opposite ends on every issue). */
export function distance(sc: Scenario, x: Offer, y: Offer): number {
  let d = 0;
  for (const i of sc.issues) d += Math.abs(x[i.id] - y[i.id]) / Math.max(1, i.options.length - 1);
  return d / sc.issues.length;
}

/**
 * The offer the script would put forward this round: among deals worth at least its
 * aspiration, the one closest to what the player last asked for. Because closeness
 * ignores its own weights, it gives way first on the issues that cost it least.
 * `previous` is its own last offer.
 */
export function proposal(sc: Scenario, round: number, playerAsk: Offer | undefined, moved = 1, previous?: Offer): Outcome {
  const target = aspiration(sc, round, moved);
  const all = feasibleOutcomes(sc);
  let pool = all.filter((o) => o.c >= target - 1e-9);
  if (!pool.length) pool = [all.reduce((best, o) => (o.c > best.c ? o : best))];
  if (!playerAsk) return pool.reduce((best, o) => (o.c > best.c ? o : best));
  if (previous) {
    // Where it can, it does not take back ground already given on any issue.
    const kept = pool.filter((o) => sc.issues.every((i) => Math.abs(o.offer[i.id] - playerAsk[i.id]) <= Math.abs(previous[i.id] - playerAsk[i.id])));
    if (kept.length) pool = kept;
  }
  return pool.reduce((best, o) => {
    const d = distance(sc, o.offer, playerAsk) - distance(sc, best.offer, playerAsk);
    return d < -1e-9 || (Math.abs(d) <= 1e-9 && o.c > best.c) ? o : best;
  });
}

/** Would the script sign this offer in this round? */
export function acceptable(sc: Scenario, round: number, offer: Offer, moved = 1): boolean {
  return withinCap(sc.hidden.hardCap, offer) && counterpartUtility(sc, offer) >= aspiration(sc, round, moved) - 1e-9;
}

/** The hard limits no counterpart, scripted or AI, may cross. */
export function withinLimits(sc: Scenario, offer: Offer): boolean {
  return withinCap(sc.hidden.hardCap, offer) && counterpartUtility(sc, offer) >= sc.counterpart.batna - 1e-9;
}

const LINES = {
  brisk: {
    open: ['Here is where I need to be.', 'Let me put a full proposal down.'],
    counter: ['I can move on {moved}. The rest stands.', 'Closer. I have shifted {moved}.'],
    hold: ['That does not work for me. My offer stands.', 'Nothing has changed on my side. Same terms.'],
    cap: ['What you ask on {cap} is past what I can sign.'],
    final: ['This is my last offer. Take it or we stop here.'],
    accept: ['Done. We have a deal.'],
    walk: ['We are too far apart. I am going with my alternative.'],
    vague: ['Give me numbers and I will answer them. Until then, this is my position.'],
  },
  warm: {
    open: ['Thanks for making the time. Here is what I had in mind.', 'Let me share a starting point we can work from.'],
    counter: ['I hear you. I have found some room on {moved}.', 'Let me meet you part of the way on {moved}.'],
    hold: ['I wish I could, but that is too far for me. My last proposal still stands.', 'I cannot make that work, I am afraid. Same terms from me.'],
    cap: ['I would like to help, but {cap} at that level is beyond what I can sign.'],
    final: ['I have stretched as far as I can. This is my final offer.'],
    accept: ['That works for me. Glad we got there.'],
    walk: ['I am sorry, I do not think we can close this. I will take my other option.'],
    vague: ['Happy to talk it through. Could you put specific terms to me? Here is where I stand meanwhile.'],
  },
  formal: {
    open: ['Our proposal is as follows.', 'We would propose these terms.'],
    counter: ['We have revised our position on {moved}.', 'In light of your proposal we can adjust {moved}.'],
    hold: ['We are unable to accept those terms. Our proposal is unchanged.', 'Those terms fall outside what we can agree. Our position stands.'],
    cap: ['We are not in a position to agree to {cap} at that level.'],
    final: ['This is our final proposal.'],
    accept: ['We accept. Agreed on those terms.'],
    walk: ['We do not see a basis for agreement and will pursue our alternative.'],
    vague: ['We would need specific terms to respond to. Our current proposal is below.'],
  },
  blunt: {
    open: ['Here is the deal.', 'This is what it takes.'],
    counter: ['Fine. I will give you {moved}. That is it for now.', 'I have moved on {moved}. Your turn.'],
    hold: ['No. Same offer.', 'Not happening. My offer has not changed.'],
    cap: ['Forget {cap} at that level. I cannot sign it, whatever else moves.'],
    final: ['Last offer. Yes or no.'],
    accept: ['Deal.'],
    walk: ['No deal. I have a better option.'],
    vague: ['Talk is cheap. Give me terms. Mine are below.'],
  },
} as const;

type LineKind = keyof (typeof LINES)['brisk'];

function line(sc: Scenario, kind: LineKind, round: number, fill: Record<string, string> = {}): string {
  const options = LINES[sc.hidden.tone][kind];
  let text: string = options[round % options.length];
  for (const [k, v] of Object.entries(fill)) text = text.replace(`{${k}}`, v);
  return text;
}

const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The scripted counterpart's reply. `log` must end with the player's turn for this round.
 * Accepts when the player's offer meets its aspiration, makes a final offer in its last
 * round, and walks one round later.
 */
export function scriptedReply(sc: Scenario, log: Turn[]): Turn {
  const round = roundOf(log);
  const playerTurn = log[log.length - 1];
  const ask = lastOffer(log, 'player');
  const mine = lastOffer(log, 'counterpart');
  const reply = (action: Turn['action'], text: string, offer?: Offer): Turn => ({
    by: 'counterpart',
    round,
    action,
    text,
    ...(offer ? { offer } : {}),
    source: 'scripted',
  });
  const { maxRounds } = sc.hidden;
  const standing = playerTurn?.by === 'player' ? playerTurn.offer : undefined;
  const moved = reciprocity(sc, log);

  if (standing && acceptable(sc, Math.min(round, maxRounds), standing, moved)) return reply('accept', line(sc, 'accept', round), standing);
  if (round > maxRounds) return reply('walk', line(sc, 'walk', round));

  const next = proposal(sc, round, ask, moved, mine).offer;
  const cap = sc.hidden.hardCap;
  const capLabel = sc.issues.find((i) => i.id === cap.issue)!.label.toLowerCase();
  const parts: string[] = [];
  // Said once, the first time the player asks for something past the hard limit.
  const breaches = log.filter((t) => t.by === 'player' && t.offer && !withinCap(cap, t.offer)).length;
  if (standing && !withinCap(cap, standing) && breaches === 1) parts.push(line(sc, 'cap', round, { cap: capLabel }));
  if (round === maxRounds) {
    parts.push(line(sc, 'final', round));
  } else if (!mine) {
    parts.push(line(sc, playerTurn?.offer || !playerTurn?.text ? 'open' : 'vague', round));
  } else if (sameOffer(sc.issues, mine, next)) {
    parts.push(line(sc, standing ? 'hold' : 'vague', round));
  } else {
    const moved = sc.issues.filter((i) => mine[i.id] !== next[i.id]).map((i) => i.label.toLowerCase());
    parts.push(line(sc, 'counter', round, { moved: listOf(moved) }));
  }
  return reply('offer', parts.join(' '), next);
}
