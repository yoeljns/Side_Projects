// The rules both counterparts play under. The model proposes; this file decides.
import { lastOffer, roundOf, scriptedReply, withinLimits } from './counterpart.js';
import { isScenarioRef } from './scenarios.js';
import type { Offer, Scenario, ScenarioRef, Turn } from './types.js';
import { isCompleteOffer } from './utility.js';

export interface OfferItem {
  issue: string;
  value: number;
}

/** What the model returns (see api/negotiate.ts for the matching schema). */
export interface ModelMove {
  message: string;
  /** The terms the player stated in their last message, if any. */
  player_offer: OfferItem[] | null;
  decision: 'counter' | 'accept' | 'reject' | 'walk';
  /** The counterpart's own offer when the decision is 'counter'. */
  offer: OfferItem[] | null;
}

export interface PlayerInput {
  text: string;
  /** From the form. When present it wins over anything parsed from the text. */
  offer: Offer | null;
  /** True when the player asks the other side to speak first instead of offering. */
  action: 'offer' | 'message';
}

export interface Resolved {
  playerTurn: Turn;
  reply: Turn;
  /** Why the model's move was not used, when it was not. */
  replaced: null | 'no-model' | 'below-reservation' | 'hard-cap' | 'incomplete-offer' | 'nothing-to-accept' | 'early-walk' | 'past-final-round';
}

const MAX_TEXT = 2000;
const MAX_TURNS = 60;

/**
 * Turn issue/value pairs into option indices: each value snaps to the nearest option,
 * missing issues come from `base`. Null if an issue is unknown or still missing.
 */
export function snapOffer(sc: Scenario, items: OfferItem[] | null | undefined, base?: Offer): Offer | null {
  if (!items || !items.length) return null;
  const offer: Offer = { ...(base ?? {}) };
  for (const item of items) {
    const key = String(item.issue).trim().toLowerCase();
    const issue = sc.issues.find((i) => i.id === key || i.label.toLowerCase() === key);
    if (!issue || typeof item.value !== 'number' || !Number.isFinite(item.value)) return null;
    let best = 0;
    issue.options.forEach((o, k) => {
      if (Math.abs(o.value - item.value) < Math.abs(issue.options[best].value - item.value)) best = k;
    });
    offer[issue.id] = best;
  }
  return isCompleteOffer(sc.issues, offer) ? offer : null;
}

/**
 * Apply one round. `log` is the transcript before the player's turn. With `model` null
 * the script plays. A model move that breaks the counterpart's reservation or hard cap,
 * accepts nothing, or walks before its final round is thrown away for the scripted move.
 */
export function resolveRound(sc: Scenario, log: Turn[], input: PlayerInput, model: ModelMove | null): Resolved {
  const round = roundOf(log) + 1;
  const text = input.text.trim().slice(0, MAX_TEXT);
  // A partial offer in free text is completed from the player's last offer, else the terms on the table.
  const parsed = model ? snapOffer(sc, model.player_offer, lastOffer(log, 'player') ?? lastOffer(log, 'counterpart')) : null;
  const offer = input.action === 'offer' ? (input.offer ?? parsed) : null;
  const playerTurn: Turn = { by: 'player', round, action: offer ? 'offer' : 'message', text, ...(offer ? { offer } : {}) };
  const after = [...log, playerTurn];
  const scripted = (replaced: Resolved['replaced']): Resolved => ({ playerTurn, reply: scriptedReply(sc, after), replaced });
  if (!model) return scripted('no-model');

  const say = (action: Turn['action'], o?: Offer): Resolved => ({
    playerTurn,
    reply: { by: 'counterpart', round, action, text: model.message.trim().slice(0, MAX_TEXT), ...(o ? { offer: o } : {}), source: 'ai' },
    replaced: null,
  });
  const cap = sc.hidden.hardCap;
  const breach = (o: Offer): Resolved['replaced'] => (o[cap.issue] < cap.min || o[cap.issue] > cap.max ? 'hard-cap' : 'below-reservation');

  if (model.decision === 'accept') {
    const standing = lastOffer(after, 'player');
    if (!standing) return scripted('nothing-to-accept');
    return withinLimits(sc, standing) ? say('accept', standing) : scripted(breach(standing));
  }
  // One round after its final offer the counterpart walks unless it can sign.
  if (round > sc.hidden.maxRounds) return scripted('past-final-round');
  if (model.decision === 'walk') return round >= sc.hidden.maxRounds ? say('walk') : scripted('early-walk');
  if (model.decision === 'reject') return say('message');

  const counter = snapOffer(sc, model.offer, lastOffer(log, 'counterpart'));
  if (!counter) return scripted('incomplete-offer');
  return withinLimits(sc, counter) ? say('offer', counter) : scripted(breach(counter));
}

export interface NegotiateRequest {
  ref: ScenarioRef;
  log: Turn[];
  input: PlayerInput;
}

function isTurn(sc: Scenario, x: unknown): x is Turn {
  if (typeof x !== 'object' || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    (t.by === 'player' || t.by === 'counterpart') &&
    Number.isInteger(t.round) &&
    (t.action === 'offer' || t.action === 'message' || t.action === 'accept' || t.action === 'walk') &&
    typeof t.text === 'string' &&
    t.text.length <= MAX_TEXT &&
    (t.offer === undefined || isCompleteOffer(sc.issues, t.offer))
  );
}

/** Check a request body. `build` regenerates the scenario from the ref so offers can be checked against it. */
export function parseRequest(body: unknown, build: (ref: ScenarioRef) => Scenario): { request: NegotiateRequest; scenario: Scenario } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isScenarioRef(b.ref)) return null;
  const ref: ScenarioRef = { family: b.ref.family, seed: b.ref.seed, difficulty: b.ref.difficulty, role: b.ref.role };
  const scenario = build(ref);
  if (!Array.isArray(b.log) || b.log.length > MAX_TURNS || !b.log.every((t) => isTurn(scenario, t))) return null;
  if (b.log.some((t: Turn) => t.action === 'accept' || t.action === 'walk')) return null;
  const input = b.input as Record<string, unknown> | null;
  if (typeof input !== 'object' || input === null) return null;
  if (typeof input.text !== 'string' || input.text.length > MAX_TEXT) return null;
  if (input.action !== 'offer' && input.action !== 'message') return null;
  if (input.offer !== null && !isCompleteOffer(scenario.issues, input.offer)) return null;
  return {
    scenario,
    request: { ref, log: b.log as Turn[], input: { text: input.text, offer: (input.offer as Offer | null) ?? null, action: input.action } },
  };
}

export interface NegotiateResponse {
  playerOffer: Offer | null;
  reply: { action: Turn['action']; text: string; offer: Offer | null; source: 'ai' | 'scripted' };
}

/** What goes back to the browser: the two turns and nothing about the hidden side. */
export function toResponse(r: Resolved): NegotiateResponse {
  return {
    playerOffer: r.playerTurn.offer ?? null,
    reply: { action: r.reply.action, text: r.reply.text, offer: r.reply.offer ?? null, source: r.reply.source ?? 'scripted' },
  };
}

/** Check a response on the client before trusting it. */
export function parseResponse(sc: Scenario, body: unknown): NegotiateResponse | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const reply = b.reply as Record<string, unknown> | null;
  if (typeof reply !== 'object' || reply === null) return null;
  const okOffer = (o: unknown) => o === null || isCompleteOffer(sc.issues, o);
  if (!okOffer(b.playerOffer) || !okOffer(reply.offer)) return null;
  if (reply.action !== 'offer' && reply.action !== 'message' && reply.action !== 'accept' && reply.action !== 'walk') return null;
  if (typeof reply.text !== 'string' || (reply.source !== 'ai' && reply.source !== 'scripted')) return null;
  if ((reply.action === 'offer' || reply.action === 'accept') && reply.offer === null) return null;
  return {
    playerOffer: b.playerOffer as Offer | null,
    reply: { action: reply.action, text: reply.text, offer: reply.offer as Offer | null, source: reply.source },
  };
}
