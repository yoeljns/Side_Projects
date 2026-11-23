# Negotiation sparring

Practise negotiating against a counterpart with hidden constraints. Pick a scenario and a side, trade offers over several rounds, and at the end (a deal, or someone walks) the other side's numbers are revealed and the result is scored against the game-theory benchmarks.

- **Four scenario families**, each playable from either side: a supply contract, a vehicle purchase from a dealer, a distribution agreement, a contractor rate. Four or five issues each (price, volume, payment terms, warranty, territory and so on).
- **A new draw every session.** Both sides' priorities, walk-away points and the counterpart's hidden constraints come from a random seed: a hard limit on one issue, a deadline after which it concedes faster and then walks, and one issue it barely cares about.
- **Debrief**: grade and score, the revealed constraints, a plot of the utility space (Pareto frontier, Nash point, Kalai-Smorodinsky point, both alternatives, the deal, the path of offers), the trade that would have left both sides better off, concession sizes per round, and two or three lessons taken from the offer log.
- **History**: every finished session with its score, and the trend.

Two counterparts play under the same rules. The **scripted** one needs nothing and is what runs under `npm run dev`. The **AI** one is Claude, through a Vercel function, and needs an API key. The page says which one is playing.

## Commands

```bash
npm install
npm run dev      # local dev server (scripted counterpart only)
npm test         # engine, guard and API-handler tests (Vitest)
npm run build    # type-check src/ and api/, then build to dist/
npm run preview  # serve the production build
```

## How it works

Every issue has a short list of options. Each side's utility for a package is additive: a weight per issue times a value curve over that issue's options, on a 0 to 100 scale. Walking away is worth a fixed number of points (the BATNA, or reservation utility). The player's brief shows their own side in money: points times the scenario's stake.

**Benchmarks** (`src/engine/benchmarks.ts`) come from enumerating every package inside the counterpart's hard limit (a few thousand):

- *Pareto frontier*: packages no other package beats for both sides.
- *Nash bargaining solution*: the package maximising (your gain over your BATNA) x (their gain over theirs). Deals only, no lotteries over deals.
- *Kalai-Smorodinsky*: the package where the smaller of the two sides' gains, each as a fraction of the most that side could get from a deal the other would still sign, is largest.
- *Price alone*: with every other issue at its middle option, the prices each side would still sign (the ZOPA), and the Rubinstein alternating-offers split of that zone with the player proposing first: share (1 - d_them) / (1 - d_you x d_them) from the two per-round discount factors, applied linearly in price.

**Score** (`src/engine/score.ts`): 100 x your gain over your BATNA / the gain the Nash solution gives you, capped to -100..150. Grades: A from 95, B from 75, C from 50, D from 25, E from 0, F below. No deal when one was possible scores 0. If no package beats both alternatives, walking away scores 100 and a deal scores -10 per point below your BATNA. The breakdown adds your share of the joint gain, the value left on the table (and the trade across the fewest issues that would have recovered some), who made the first offer, each side's concessions per round in its own points, and concessions that cost you much and gave them little.

**Scripted counterpart** (`src/engine/counterpart.ts`): each round it holds out for an aspiration that falls from its best package towards its reservation: 5% of the range per round until its deadline round, then faster, ending 62% to 85% of the way down by difficulty. Against a player whose offers have not moved it makes only 60% of those concessions. Its offer is the package closest to your last ask among those worth at least its aspiration, which makes it give way first on the issue it cares least about. It accepts any offer worth its aspiration, makes a final offer in its last round, and walks one round later. Its lines come from templates in four tones.

**AI counterpart** (`api/negotiate.ts`): the function is stateless. The browser sends the scenario's seed and settings plus the transcript; the server rebuilds the hidden side from the seed, gives it to Claude in the system prompt with instructions to stay in role and never reveal it, and asks for structured output: a message, the terms read out of your free text, and accept / counter / reject / walk with an optional offer. The engine then checks the move (`src/engine/guard.ts`). An accept or counter-offer below the counterpart's reservation or past its hard limit, an accept with nothing on the table, a walk before its final round, or anything after it are thrown away and replaced by the scripted move, so the character cannot be talked into an impossible deal. Only the two new turns go back to the browser.

With the AI you can write free text ("same terms but 60 days") or use the form. With the scripted counterpart offers go through the form; the message is kept in the transcript but not read.

## Configuring the AI counterpart

Deploy to Vercel with the project's Root Directory set to `negotiation-sparring`. Then in the project's Settings, Environment Variables, add `ANTHROPIC_API_KEY` (see `.env.example`; no `VITE_` prefix, it must stay on the server) and redeploy. `vercel.json` gives the function 60 seconds. The model is `claude-opus-5-5` at low effort, set in `api/negotiate.ts`; each round is one API call, so use costs money per message.

Without the key, when the function is missing (plain `vite dev` or `vite preview`), or when a call fails, the scripted counterpart plays that turn and the note above the transcript says why. `vercel dev` runs the function locally if you want the AI on your own machine.

Optional device sync uses the two `VITE_SUPABASE_*` values in `.env.example`, as in the other side projects. History and the session in progress live in the browser (localStorage key `negotiation-sparring:v1`), with backup and restore under Settings.

## Layout

```
src/engine/   pure TypeScript: scenarios, utility, benchmarks, scripted counterpart, guard, prompt, scoring, tests
src/lib/      store and sync (shared template), negotiateClient.ts (the only fetch to /api/negotiate)
src/ui/       React: setup, session, debrief, plot, history
api/          negotiate.ts, the Vercel function
```

Engine files import each other with `.js` extensions so the same sources load in Vite and in the Node function.

## Known limits

- The browser also rebuilds the hidden side from the seed, for the debrief. Anyone who opens the dev tools can read the counterpart's numbers mid-session. That is fine for a personal practice tool and would not be for anything competitive. The function has no login or rate limit either: anyone with the URL can spend the key, so keep the deployment private or protected.
- The guard checks the AI's moves, not its words. The prompt tells it never to reveal its numbers; nothing in code stops it from saying one.
- The AI path has been tested against a stubbed SDK, not the live API.
- The debrief lesson about waiting for a later round quotes what the scripted counterpart would have offered; the AI may have played it differently.
- Discount factors feed only the Rubinstein benchmark. The score does not shrink with the number of rounds.
- Benchmarks are over whole packages. The Nash and Kalai-Smorodinsky points are the best discrete packages, not points on a convexified frontier, and the price-alone view treats the zone as linear in price although the value curves are not.
- Scenarios are stylised. Weights and curves are drawn at random around a template per family, so the money figures are for practice, not a model of any real deal.
