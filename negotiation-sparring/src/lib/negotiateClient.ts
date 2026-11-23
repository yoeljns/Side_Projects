// The only place the page talks to /api/negotiate. Every failure comes back as a
// reason, never a throw, so the caller can fall back to the scripted counterpart.
import { parseResponse, roundOf, type NegotiateResponse, type PlayerInput, type Scenario, type Turn } from '../engine/index.js';

const URL = '/api/negotiate';

export type Unavailable = 'no-function' | 'no-key' | 'bad-key' | 'rate-limited' | 'unreachable' | 'bad-reply' | 'failed';

const KNOWN: Unavailable[] = ['no-key', 'bad-key', 'rate-limited', 'unreachable'];

export function explain(reason: Unavailable): string {
  switch (reason) {
    case 'no-function':
      return 'no AI function is running here';
    case 'no-key':
      return 'ANTHROPIC_API_KEY is not set on the server';
    case 'bad-key':
      return 'the API key was rejected';
    case 'rate-limited':
      return 'the API is rate limited right now';
    case 'unreachable':
      return 'the Claude API could not be reached';
    case 'bad-reply':
      return 'the AI function sent a reply that could not be read';
    default:
      return 'the AI function failed';
  }
}

async function readJson(res: Response): Promise<unknown> {
  // A static host answers unknown paths with the page itself: HTML, not JSON.
  try {
    return JSON.parse(await res.text());
  } catch {
    return undefined;
  }
}

function errorOf(status: number, body: unknown): Unavailable {
  const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof code === 'string' && (KNOWN as string[]).includes(code)) return code as Unavailable;
  if (body === undefined || status === 404 || status === 405) return 'no-function';
  return 'failed';
}

/** Is there an AI counterpart behind this page? */
export async function probeAi(fetchFn: typeof fetch = fetch): Promise<{ ai: true } | { ai: false; reason: Unavailable }> {
  try {
    const res = await fetchFn(URL, { method: 'GET' });
    const body = await readJson(res);
    if (res.ok && typeof body === 'object' && body !== null && 'ai' in body) {
      return (body as { ai: unknown }).ai === true ? { ai: true } : { ai: false, reason: 'no-key' };
    }
    return { ai: false, reason: errorOf(res.status, body) };
  } catch {
    return { ai: false, reason: 'no-function' };
  }
}

export type RoundResult = { ok: true; turns: [Turn, Turn] } | { ok: false; reason: Unavailable };

/** The player's turn and the reply, as the transcript stores them. */
export function turnsFromResponse(log: Turn[], input: PlayerInput, res: NegotiateResponse): [Turn, Turn] {
  const round = roundOf(log) + 1;
  const { playerOffer, reply } = res;
  return [
    { by: 'player', round, action: playerOffer ? 'offer' : 'message', text: input.text.trim(), ...(playerOffer ? { offer: playerOffer } : {}) },
    { by: 'counterpart', round, action: reply.action, text: reply.text, ...(reply.offer ? { offer: reply.offer } : {}), source: reply.source },
  ];
}

/** Ask the AI counterpart to play one round. */
export async function requestRound(sc: Scenario, log: Turn[], input: PlayerInput, fetchFn: typeof fetch = fetch): Promise<RoundResult> {
  try {
    const res = await fetchFn(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: sc.ref, log, input }),
    });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, reason: errorOf(res.status, body) };
    const parsed = parseResponse(sc, body);
    if (!parsed) return { ok: false, reason: body === undefined ? 'no-function' : 'bad-reply' };
    return { ok: true, turns: turnsFromResponse(log, input, parsed) };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
