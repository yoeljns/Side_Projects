# Side Projects

One folder per project. Each project is self-contained (its own `package.json`) and deploys as its own
Vercel project.

| Project | What it is |
| --- | --- |
| [`morning-board`](morning-board) | A timed morning training session: spaced-repetition cards from your own chess blunders (Stockfish in the browser), endgame studies, and backgammon cube decisions with rollouts and a Shorts maker. Follows London and Istanbul mornings. |
| [`strategy-arena`](strategy-arena) | Strategies play repeated games, auctions and bargaining against each other, tournament style, with an animated 9:16 playback of every run. |

## Deploying on Vercel

Create one Vercel project per folder, all pointing at this repository:

1. Add New → Project → import this repository.
2. Set **Root Directory** to the project folder (for example `morning-board`).
3. Leave the framework preset on Vite; the default build command and output directory work.

Repeat for each folder. Each project's `vercel.json` skips the build when a push did not touch that folder,
so changing one project does not redeploy the others.

GitHub Actions runs every project's tests and build on each push (`.github/workflows/ci.yml`).

## Adding a project

Create a new top-level folder with its own `package.json`, add a row to the table above, add the folder to
the matrix in `.github/workflows/ci.yml`, copy a `vercel.json` into it, and create a Vercel project with
that folder as its Root Directory.
