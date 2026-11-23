// Vercel function (Node runtime). Plays the counterpart with Claude.
// Stateless: the browser sends the scenario ref and the transcript; the hidden side is
// rebuilt here from the seed, and only the two new turns go back.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { parseRequest, resolveRound, toResponse, type ModelMove } from '../src/engine/guard.js';
import { buildMessages, buildSystemPrompt } from '../src/engine/prompt.js';
import { generateScenario } from '../src/engine/scenarios.js';

const OfferItems = z.array(z.object({ issue: z.string(), value: z.number() }));
const Move = z.object({
  message: z.string(),
  player_offer: OfferItems.nullable(),
  decision: z.enum(['counter', 'accept', 'reject', 'walk']),
  offer: OfferItems.nullable(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** Ask the model for its move. Null means "use the script": refusal, cut-off or unparseable output. */
async function askModel(system: string, messages: Anthropic.Beta.BetaMessageParam[]): Promise<ModelMove | null> {
  const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    // If a safety classifier declines the request, the API retries it on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(Move) },
    system,
    messages,
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  return response.parsed_output ?? null;
}

export default {
  async fetch(request: Request): Promise<Response> {
    // The page asks once whether an AI counterpart is available.
    if (request.method === 'GET') return json({ ok: true, ai: hasKey() });
    if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
    if (!hasKey()) return json({ error: 'no-key' }, 503);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    const parsed = parseRequest(body, generateScenario);
    if (!parsed) return json({ error: 'bad-request' }, 400);
    const { scenario, request: req } = parsed;

    let move: ModelMove | null;
    try {
      move = await askModel(buildSystemPrompt(scenario, req.log), buildMessages(scenario, req.log, req.input));
    } catch (err) {
      // The browser falls back to the scripted counterpart on any error and shows this code.
      if (err instanceof Anthropic.AuthenticationError) return json({ error: 'bad-key' }, 502);
      if (err instanceof Anthropic.RateLimitError) return json({ error: 'rate-limited' }, 502);
      if (err instanceof Anthropic.APIConnectionError) return json({ error: 'unreachable' }, 502);
      if (err instanceof Anthropic.APIError) return json({ error: `api-${err.status ?? 'error'}` }, 502);
      return json({ error: 'failed' }, 502);
    }
    // The engine has the last word: a move that breaks the hidden limits becomes the scripted move.
    return json(toResponse(resolveRound(scenario, req.log, req.input, move)));
  },
};
