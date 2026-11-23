# Side Projects

One repo, one folder per project. Each folder is a self-contained app with its own
`package.json` and deploys to Vercel as its own project.

| Project | Folder | What it is |
| --- | --- | --- |
| Padel Lab | [`padel-lab/`](padel-lab/) | Position heatmaps, net time and rally lengths from a phone video of a padel match |

## Deploying a project on Vercel

Every project gets its own Vercel project pointing at this repo:

1. Vercel → **Add New… → Project** → import this repository.
2. Set **Root Directory** to the project's folder (e.g. `padel-lab`).
3. Leave the build settings on auto-detect and deploy.

Each folder's `vercel.json` has an `ignoreCommand`, so a push that only touches
another project does not rebuild this one.

## Adding a project

Create a new top-level folder with its own `package.json` and `vercel.json`
(copy `padel-lab/vercel.json` and adjust `framework`), add a row to the table
above, and import the repo into Vercel again with the new Root Directory.
