# Morning Board

A short daily board for the chess slot of a morning routine:

- **Chess puzzles from your own blunders.** It reads your latest public games from Lichess or Chess.com,
  runs Stockfish over them in the browser, and turns the moves that cost you most into "find what you
  missed" puzzles. Any move that is about as good as the engine's is accepted. Missed puzzles come back
  the next day; solved ones return after a few days, then weeks.
- **Backgammon cube decisions.** A few bearoff positions a day: double or not, take or pass. The answers
  are exact equities computed by full recursion (`src/lib/bearoff.ts`), not estimates.
- **London and Istanbul mornings.** The board follows the city you wake up in (detected from the device
  time zone, or fixed in Settings), shows both clocks, and deals a new board at 04:00 local time.

When the board is done you can deal another round, which reaches further back through your games. On a
phone, "Add to Home Screen" installs it as an app.

There is no backend and no account. Progress lives in the browser's local storage, so each device keeps
its own puzzle pool and streak.

## Commands

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run build      # production build in dist/
npm run gen:cube   # regenerate src/data/cubePositions.json (takes about a minute)
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
| `src/lib/store.ts` | Local storage, review schedule, streak |

## Licence

Stockfish and the `stockfish` npm package are GPL-3.0, so this app is distributed under
GPL-3.0-or-later as well.
