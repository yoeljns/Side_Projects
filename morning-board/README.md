# Morning Board

A short daily board for the chess slot of a morning routine:

- **Chess puzzles from your own blunders.** It reads your latest public games from Lichess or Chess.com,
  runs Stockfish over them in the browser, and turns the moves that cost you most into "find what you
  missed" puzzles. Any move that is about as good as the engine's is accepted. Missed puzzles come back
  the next day; solved ones return after a few days, then weeks.
- **Backgammon cube decisions.** A few positions a day: double or not, take or pass, too good. About two
  thirds are middle-game positions (contact and races) from GNU Backgammon self-play, judged by GNU
  Backgammon at 2-ply; the rest are small bearoffs with exact equities computed by full recursion
  (`src/lib/bearoff.ts`).
- **London and Istanbul mornings.** The board follows the city you wake up in (detected from the device
  time zone, or fixed in Settings), shows both clocks, and deals a new board at 04:00 local time.

When the board is done you can deal another round, which reaches further back through your games. On a
phone, "Add to Home Screen" installs it as an app.

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
| `src/lib/analysis.ts` | Finds blunders (win-percentage drop, confirmed at higher depth) |
| `src/lib/bearoff.ts` | Exact cube equities for bearoff positions |
| `src/lib/day.ts` | City detection, clocks and the 04:00 day rollover |
| `src/lib/store.ts` | Local storage, review schedule, streak, merging two devices |
| `src/lib/sync.ts` | Optional Supabase sync |

## Licence

Stockfish and the `stockfish` npm package are GPL-3.0, so this app is distributed under
GPL-3.0-or-later as well.
