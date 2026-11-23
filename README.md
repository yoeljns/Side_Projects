# Side Projects

One folder per project. Each project is self-contained (its own `package.json`) and deploys as its own
Vercel project.

| Project | What it is |
| --- | --- |
| [`morning-board`](morning-board) | Daily chess puzzles made from your own blunders (Stockfish in the browser), plus backgammon cube decisions. Follows London and Istanbul mornings. |
| [`strategy-arena`](strategy-arena) | Strategies play repeated games, auctions and bargaining against each other, tournament style, with an animated 9:16 playback of every run. |
| [`negotiation-sparring`](negotiation-sparring) | Negotiate against a dealer or supplier with hidden constraints, then see the outcome scored against the Nash bargaining solution and the Pareto frontier. |
| [`decision-journal`](decision-journal) | Every meaningful call gets a probability and a review date; resolved calls build a calibration record (Brier and log score). |
| [`two-city`](two-city) | London and Istanbul in one place: the city switch (app and `npm run switch`), the day-count ledger, the Chelsea matchday desk and dream-trip triggers. |
| [`vault-librarian`](vault-librarian) | An MCP server over an Obsidian vault: weekly link suggestions between old notes and source packs for essays. Runs on your own machine, not on Vercel. |
| [`cycle-atlas`](cycle-atlas) | A zoomable timeline overlaying long debt, commodity and technology cycles, with your own annotations and theory notes on top. |
| [`year-in-data`](year-in-data) | The annual birthday questions, each with the year's record beside it (trips, matches, games, books, builds) before you write. |
| [`hours-ledger`](hours-ledger) | A few seconds a day to log where the week goes across company, Masters, training and builds, with a one-page Sunday summary. |

## How the projects share data

Each web app keeps one JSON document in the browser and can download or restore it as a backup file.
Device sync is optional and reuses Morning Board's Supabase setup: apply
`morning-board/supabase/migrations/0001_boards.sql` once, then give every app the same
`VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`. Each app gets its own sync code, so they do not see each
other's data unless you paste a code across; Year in Data does exactly that to read Two City, Hours
Ledger and Decision Journal.

## Deploying on Vercel

Create one Vercel project per folder, all pointing at this repository:

1. Add New → Project → import this repository.
2. Set **Root Directory** to the project folder (for example `morning-board`).
3. Leave the framework preset on Vite; the default build command and output directory work.

`vault-librarian` is the exception: it is a local MCP server and is not deployed.

Repeat for each folder. Each project's `vercel.json` skips the build when a push did not touch that folder,
so changing one project does not redeploy the others.

GitHub Actions runs every project's tests and build on each push (`.github/workflows/ci.yml`).

## Adding a project

Create a new top-level folder with its own `package.json`, add a row to the table above, add the folder to
the matrix in `.github/workflows/ci.yml`, copy a `vercel.json` into it, and create a Vercel project with
that folder as its Root Directory.
