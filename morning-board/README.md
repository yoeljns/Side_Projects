# Morning Board

A timed morning training session built from your own games, plus backgammon cube work.

## The session

A session is 15, 30 or 45 minutes (30 by default) and runs in five blocks:

1. **Warm-up.** Positions you already know, or easy endgame studies. These do not affect the schedule.
2. **Blunder review.** Cards that are due again. Missed cards come back the next day; solved ones after
   3, 7 and 21 days.
3. **Fresh tactics.** New cards from your latest public games on Lichess or Chess.com. Stockfish finds
   the moves that gave away at least 20 points of winning chances. If one move was clearly best, the card
   asks you to find it. If several moves were fine, you get a **punish card** instead: switch sides and
   find the reply that refutes what you played.
4. **Endgames.** Your own endgame blunders first, topped up from 40 pawn-endgame studies where exactly
   one king move wins or draws (generated and checked with Stockfish, `scripts/gen-endgames.mjs`).
5. **Backgammon cube.** Double or not, take or pass, too good. About two thirds are middle-game
   positions from GNU Backgammon self-play judged at 2-ply; the rest are small bearoffs solved exactly
   (`src/lib/bearoff.ts`). Missed positions come back like chess cards do.

Progress is measured as **blunders per 100 moves**, not rating. The Progress view shows the rolling
rate over your analysed games, where your cards stand, and recent sessions.

The board follows London or Istanbul mornings (detected from the device time zone, or fixed in Settings),
shows both clocks, and deals a new session at 04:00 local time. When a session is done you can deal
another round, which reaches further back through your games. On a phone, "Add to Home Screen" installs
it as an app.

## Backgammon extras

After answering a cube position you can:

- **Run a rollout** (races and bearoffs only): 20,000 Monte Carlo games in a worker with a simple racing
  policy, shown as a win percentage with its 95% range next to the engine's figure.
- See the **Keith count** for races, labelled as a rule of thumb, and whether it agrees with the engine.
- See the **tavla** reading: what the position is worth with no cube and a mars scoring 2.
- **Make a Short**: a 1080x1920 "double or no double?" animation of the position with a countdown and
  reveal, recorded as MP4 (WebM where the browser cannot encode H.264).

## Chess engine

Stockfish 19 runs in the browser as WebAssembly. On a computer the app loads the full engine (full
network, multi-threaded, a 94 MB download that the browser caches); on a phone it uses the lite network.
Settings can force either. Threads need a cross-origin isolated page, so `vercel.json` and
`vite.config.ts` send the COOP/COEP headers; without them the app falls back to single-threaded lite.
If the host rejects the 94 MB file, build with `SKIP_FULL_ENGINE=1`.

## Sync between devices (optional)

Without a backend, progress lives in each browser's local storage. To share one board between phone and
laptop, give the app a Supabase database:

1. Create a Supabase database (on Vercel: Storage → Create → Supabase).
2. Run `supabase/migrations/0001_boards.sql` in its SQL editor.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (the publishable key) as environment variables and
   redeploy. See `.env.example`.

Settings then shows "Sync between devices": start syncing on one device and open the link (or paste the
code) on the other. There are no accounts; the random code is the only credential, the database stores
only its hash, and the table is unreachable except through two functions that require the code.

## Commands

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run build      # production build in dist/
npm run gen:cube   # regenerate the exact bearoff positions (about a minute)
/usr/games/gnubg -t -q -p scripts/gen-gnubg-cube.py   # regenerate the middle-game positions (needs gnubg)
```

`dev` and `build` first copy the Stockfish WASM engine from `node_modules` into `public/engine`
(git-ignored).

## Layout

| Path | What it does |
| --- | --- |
| `src/lib/games.ts` | Fetches and normalises games from Lichess and Chess.com |
| `src/lib/engine.ts` | Promise wrapper around the Stockfish web worker |
| `src/lib/analysis.ts` | Finds blunders and decides between an avoid card and a punish card |
| `src/lib/bearoff.ts` | Exact cube equities for bearoff positions |
| `src/lib/day.ts` | City detection, clocks and the 04:00 day rollover |
| `src/lib/store.ts` | Session blocks, review schedule, stats, merging two devices |
| `src/lib/endgames.ts` | The endgame study set |
| `src/lib/rollout.ts` | Monte Carlo race rollouts |
| `src/lib/raceCount.ts`, `src/lib/tavla.ts` | Keith count and tavla scoring |
| `src/lib/sync.ts` | Optional Supabase sync |

## Licence

Stockfish and the `stockfish` npm package are GPL-3.0, so this app is distributed under
GPL-3.0-or-later as well.
