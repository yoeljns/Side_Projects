# Strategy Arena

Strategies play repeated games, auctions and bargaining against each other in a round-robin tournament. Every run is reproducible from its seed and plays back as a 9:16 animation you can record for a short.

- **Repeated games**: Prisoner's Dilemma, Stag Hunt, Chicken. Editable payoffs, rounds and trembling-hand noise.
- **Auctions**: first-price and second-price sealed-bid duels with private values redrawn every round. Score is cumulative surplus.
- **Bargaining**: ultimatum, or alternating offers over a shrinking pie. Score is the share of the pie won.

The page shows a leaderboard, a head-to-head heatmap, and a round-by-round view of any match. The run's settings live in the URL, so a link replays the exact same tournament.

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
src/engine/   pure TypeScript, no UI: seeded RNG, the three arenas, tournament, URL config, tests
src/ui/       React page, plus animation.ts (canvas renderer) and Player.tsx (playback and recording)
```

`drawFrame(ctx, timeline, t)` in `src/ui/animation.ts` paints any frame from the time alone, so scrubbing and recording always agree. Record uses `canvas.captureStream()` and `MediaRecorder`, and downloads a WebM (Chrome, Edge and Firefox; convert to MP4 if a platform needs it).

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

`create()` is called once per match, so a closure can keep state. Use `c.rng()` for randomness, never `Math.random()`, or runs stop being reproducible. Auction strategies (`src/engine/auction.ts`) return a bid from `{ value, format, n, history }`; bargaining strategies (`src/engine/bargain.ts`) implement `propose` and `respond`.
