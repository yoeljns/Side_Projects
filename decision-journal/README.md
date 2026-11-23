# Decision journal

Every meaningful call gets a probability and a review date. When the date comes round you record what happened, and the journal scores the forecast. Over time that gives a calibration score: when you say 80%, does it happen about 80% of the time?

- **Today**: reviews that are overdue or due, then a fast form to log a call (title, what "works out" means, a probability, a review date from presets).
- **Journal**: every decision, with search, filters by status and category, edit, resolve, reopen and delete.
- **Calibration**: Brier and log score in plain words, a reliability diagram, the score over time, and breakdowns by category and stakes.
- **Settings**: categories, an .ics export of open review dates, example data, backup and device sync.

Resolving is two taps (what happened, then save). The app then shows what that one result did to the average. A lesson, a good call / bad call verdict that is separate from the result, and a hindsight note are optional.

## Commands

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests for the logic (Vitest)
npm run build    # type-check and build to dist/
npm run preview  # serve the production build
```

Deploys to Vercel as a static Vite app: set the project's Root Directory to `decision-journal`.

## Layout

```
src/lib/scoring.ts   every scoring formula, in one file
src/lib/model.ts     the decision record, validation, resolve/reopen, review queue, categories
src/lib/dates.ts     'YYYY-MM-DD' arithmetic in UTC, review presets
src/lib/ics.ts       iCalendar text for open review dates
src/lib/example.ts   the made-up records behind "Load example data"
src/lib/store.ts     the one JSON document in localStorage, with optional sync (shared template)
src/ui/              React: Today, Journal, Calibration, Settings, the form and the resolve flow
```

The logic takes `today` as an argument and never reads the clock; the UI reads it once and passes it down.

## How it scores

These are the standard proper scoring rules for probability forecasts. The quant engine's code is not in this repository, so this was written from the textbook definitions rather than copied from it. **All formulas are in `src/lib/scoring.ts`**; if the quant engine differs (a different log base, a 0 to 1 scaling of the multi-outcome Brier, different bins), that is the one file to change, and its tests hold the hand-worked numbers.

With `p` the stated probability and `o` = 1 if it happened, 0 if not:

- **Brier score**, yes/no: `(p - o)^2`. 0 is perfect, 1 is certain and wrong, always saying 50% scores 0.25.
- **Brier score**, scenarios: the sum over outcomes of `(p_i - o_i)^2`. Range 0 to 2. For two outcomes this is twice the yes/no form.
- **Log score**: `ln` of the probability given to what happened (natural log). 0 is perfect, always saying 50% scores -0.693. Probabilities are clamped to 0.001..0.999 before the log, so a 100% miss scores -6.91 rather than minus infinity.
- **Skill**: `1 - Brier / reference`, against always saying 50% (reference 0.25) and against the base rate (reference `b(1 - b)`, where `b` is how often things happened in the same set, so it is known only in hindsight).
- **Murphy decomposition** over ten equal probability bins: `Brier = reliability - resolution + uncertainty`. Reliability is the gap between what a bin said and how often it happened (lower is better), resolution is how far the bins' hit rates spread from the base rate (higher is better), uncertainty is `b(1 - b)`. When forecasts inside a bin differ, the identity has a small remainder, which is shown rather than hidden.
- **Calibration table and diagram**: per bin, the count, the mean stated probability, the share that happened, and a 95% Wilson interval on that share.
- **Overconfidence**: mean confidence minus hit rate, after folding forecasts under 50% onto the side they leaned (30% becomes 70% confident it will not happen). An exact 50% counts as half a hit.
- **Over time**: the mean Brier of the last 10 resolved decisions, in order of resolution date.

Void decisions are kept but never scored. Below 20 scored decisions the numbers are shown with a "too few to read" label; the same threshold greys out rows in the breakdown tables.

### Scenario decisions

A decision can use named scenarios (bear, base, bull, or your own) whose probabilities must sum to 100%, with exactly one resolving true. Its `probability` field is the top scenario's probability and its `outcome` is whether that scenario happened (the first scenario wins a tie for top). That yes/no reading is what enters the headline scores, the reliability diagram and the breakdowns. The full-distribution Brier (0 to 2) and log score are reported separately on the Calibration tab and on the result card.

## Data

One JSON document in localStorage under `decision-journal:v1`: `{ decisions, categories }`. Each decision carries the cross-app contract fields (`id`, `title`, `category`, `madeOn`, `probability`, `reviewOn`, `outcome?`, `resolvedOn?`, `notes?`) plus extras (`call`, `statement`, `stakes`, `changeMind`, `voided`, `lesson`, `quality`, `hindsight`, `scenarios`, `resolvedScenarioId`). `category` is the category's name; renaming a category renames it on its decisions.

"Download backup" in Settings saves that document as a file; "Restore from file" replaces everything with a file's contents. Records in a restored file that are not valid decisions are ignored.

## Configuring

Nothing is required. Optional sync between devices uses the same Supabase functions as Morning Board: copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (on Vercel, as Environment Variables). Without them the app works fully in one browser and Settings says so.

## Known limits

- The scoring has not been checked against the quant engine's output, only against hand-worked numbers.
- No reminders. The .ics file is a snapshot you import by hand; download it again after logging more calls. Whether a re-import updates or duplicates events depends on the calendar app.
- The base-rate comparison uses the base rate of the same decisions, which you could not have known in advance, so it is a hard benchmark. Outcomes also depend on how each question is framed ("works out" is nearly always the hoped-for side), so the base rate is not a neutral 50%.
- Editing the probability of a resolved decision changes its score; nothing stops you, and no history of edits is kept.
- Sync replaces the whole document with the newer copy, so two devices edited offline at the same time will lose one side's changes.
- "Load example data" adds made-up decisions that count in every score until removed (a banner says so while they are loaded).
