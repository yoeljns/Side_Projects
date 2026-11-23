# Strategy Arena

Strategies play repeated games, auctions and bargaining against each other in a round-robin tournament. Every run is reproducible from its seed and plays back as a 9:16 animation you can record for a short.

- **Repeated games**: Prisoner's Dilemma, Stag Hunt, Chicken. Editable payoffs, rounds and trembling-hand noise.
- **Auctions**: every selected bidder sits in one room for a first-price or second-price sealed-bid auction, with private values redrawn each auction. Score is cumulative surplus. The same seed and bidders are also run under the other format, so the seller's average revenue can be compared side by side (revenue equivalence).
- **Bargaining**: ultimatum, or alternating offers over a shrinking pie. Score is the share of the pie won.

The page shows a leaderboard, a head-to-head heatmap, and a round-by-round view of any match. The auction room has no pairings, so it shows per-bidder stats (wins, surplus, bid-to-value ratio), seller revenue under both formats, and a drill-down into any single auction. The run's settings live in the URL, so a link replays the exact same tournament.

Repeated games have two extras:

- **Build your own**: up to four memory-one strategies, each a first move plus the chance of cooperating after CC, CD, DC and DD (my move, then theirs). Presets include Extort-2 (a zero-determinant extortioner), a generous zero-determinant strategy, and Win-Stay-Lose-Shift, Tit for Tat and Grim as vectors. They are plain numbers, stored in the URL; no user code is run.
- **Evolution**: an ecological tournament in the style of Axelrod's second analysis. Everyone starts with an equal population share; each generation a strategy grows in proportion to its average payoff against the current mix (`replicator()` in `src/engine/evolution.ts`, 200 generations, fed by the head-to-head payoff matrix). It can be added as a closing segment of the video.

## Commands

```bash
npm install
npm run dev      # local dev server
npm test         # engine unit tests (Vitest)
npm run build    # type-check and build to dist/
npm run preview  # serve the production build
```

Deploys to Vercel as a static Vite app: set the project's Root Directory to `strategy-arena`.

## Layout

```
src/engine/   pure TypeScript, no UI: seeded RNG, the three arenas, evolution, tournament, URL config, tests
src/ui/       React page, plus animation.ts (canvas renderer) and Player.tsx (playback and recording)
```

`drawFrame(ctx, timeline, t)` in `src/ui/animation.ts` paints any frame from the time alone, so scrubbing and recording always agree. Record uses `canvas.captureStream()` and `MediaRecorder`. It saves MP4 (H.264) when the browser can record it, which Instagram and TikTok accept, and falls back to WebM otherwise (Firefox today). The note under the player says which one you will get.

## Adding a strategy

Add one entry to the list in the arena's file. It appears in the UI automatically.

```ts
// src/engine/games.ts, in GAME_STRATEGIES
{
  id: 'tf3t',                       // short and unique: it goes in the URL
  name: 'Tit for Three Tats',
  blurb: 'Retaliates only after three defections in a row.',
  create: () => (c) => (c.their.slice(-3).join('') === 'DDD' ? 'D' : 'C'),
},
```

`create()` is called once per match, so a closure can keep state. Use `c.rng()` for randomness, never `Math.random()`, or runs stop being reproducible. For a memory-one strategy you do not need code at all: use the builder, or add a preset to `MEMORY_ONE_PRESETS`. Auction strategies (`src/engine/auction.ts`) return a bid from `{ value, format, n, history }`, where `n` is the number of bidders in the room; bargaining strategies (`src/engine/bargain.ts`) implement `propose` and `respond`.
