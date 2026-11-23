# Side Projects

One folder per project. Each project is self-contained (its own `package.json`) and deploys as its own
Vercel project.

| Project | What it is |
| --- | --- |
| [`morning-board`](morning-board) | Daily chess puzzles made from your own blunders (Stockfish in the browser), plus backgammon cube decisions. Follows London and Istanbul mornings. |
| [`strategy-arena`](strategy-arena) | Strategies play repeated games, auctions and bargaining against each other, tournament style, with an animated 9:16 playback of every run. |

## Deploying on Vercel

Create one Vercel project per folder, all pointing at this repository:

1. Add New → Project → import this repository.
2. Set **Root Directory** to the project folder (for example `morning-board`).
3. Leave the framework preset on Vite; the default build command and output directory work.

Repeat for each folder. To stop a push that only touches one project from rebuilding the others, set each
project's Ignored Build Step to `git diff --quiet HEAD^ HEAD -- .`

## Adding a project

Create a new top-level folder with its own `package.json`, add a row to the table above, and create a
Vercel project with that folder as its Root Directory.
