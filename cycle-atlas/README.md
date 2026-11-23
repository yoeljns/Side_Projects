# Cycle atlas

A working surface for a theory of long cycles. Published chronologies of technology, debt and commodity cycles sit on one time axis from about 1770 to today; your own annotations, links, tracks and dated theory notes go on top and stay on record as your thinking changes.

- **Timeline**: one zoomable, pannable SVG. Each track is a lane: phases are bands, events are marks, the crosshair reads across every lane at one year. Colour marks the track; the fill pattern and the label mark the kind of phase.
- **Built-in reference set** (`src/lib/reference.ts`): Perez's five technological revolutions, a commonly cited Kondratiev dating, a long-term debt cycle in the spirit of Dalio, the US interest-rate regime, Reinhart and Rogoff's default clusters, Erten and Ocampo's commodity super-cycles, oil shocks, and monetary regimes and wars for orientation. Every item carries a citation. These are each author's periodisation, not fact: items marked approximate say why in their note. Built-in tracks can be hidden, dimmed or duplicated; a duplicate is yours to edit and the original is never changed.
- **Your layer**: your own tracks and phases (drag the ends of a phase to re-date it), and annotations of three kinds: a pin at a year, a span of years, and a link between two items on different tracks, which shows the lag in years. Each has a title, markdown-ish notes, tags, a confidence level and a status (hunch, claim, tested, dropped). Status and confidence changes are logged with their date. Dropped ideas stay in the list behind a filter.
- **Theory notes**: dated entries on where the theory stands, each able to point at annotations.
- **Compare**: phase overlap between two tracks, lags between a chosen kind of marker in one track and the nearest in the other, cycle lengths, and where each track is now against its own history.
- **Data series**: paste or import `year,value` CSV to draw a line in its own lane, linear or log. None are bundled.
- **Export**: the view as SVG, a markdown summary with your annotations for the essay, the whole atlas as JSON, and the usual backup file.

## Commands

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests for the model and helpers (Vitest)
npm run build    # type-check and build to dist/
npm run preview  # serve the production build
```

Deploys to Vercel as a static Vite app: set the project's Root Directory to `cycle-atlas`.

## Layout

```
src/lib/   pure TypeScript, no DOM: types, the reference set, document operations (model.ts),
           analysis helpers, the time scale, CSV parsing, markdown export, tests
src/ui/    React: Timeline.tsx (the SVG and its pointer handling), marks.tsx (patterns and
           shapes), one file per panel tab, exportFiles.ts (download and SVG serialising)
```

Everything is one JSON document in localStorage under `cycle-atlas:v1`: `tracks` (yours only), `trackPrefs`, `annotations`, `notes`, `series`. The built-in tracks live in code and are not stored.

## How the numbers are made

- **Phases** cover `[start, end)` in whole years: the end year belongs to whatever comes next. An open phase runs to the current year. Tracks may overlap themselves (Perez's surges do), so a year can sit in two phases of one track.
- **Overlap** intersects the two tracks' phase intervals kind by kind and reports years for every pairing, plus the years where both are in the same kind. Phases that only touch share no time.
- **Lags**: each track has markers, which are its events (by kind) and its phase starts (by kind). For every marker of the chosen type in A the nearest marker of the chosen type in B is found (a tie goes to the later one) and the lag is B minus A, so positive means A comes first. Mean, range and sample standard deviation are shown. The match is nearest-neighbour, not one-to-one, so lags are small by construction; an optional limit drops distant matches.
- **Cycle lengths** are the gaps between consecutive markers of one type: peak events give peak to peak, phase starts give start to start.
- **Where are we now** takes each open phase, counts years into it, and sets that against the lengths of the same track's earlier completed phases of the same kind.
- **Re-dating**: a dragged edge snaps to whole years, a phase stays at least one year long, the end of an open phase cannot be dragged, and a boundary shared by two phases moves both (each keeping at least a year). Phases that merely overlap are left alone.

All of this is description of four or five cycles per track, dated by judgement. The sample size is printed next to every statistic for that reason.

## Configuring

Nothing is needed. Optional device sync uses the shared Supabase functions from Morning Board: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (see `.env.example`). Without them the app keeps everything in this browser and says so.

## Known limits

- The reference dates were entered from the cited works from memory of their published tables, not machine-checked against the texts. Check a date against the source before quoting it in the essay. The Dalio track in particular is an interpretation: he describes a mechanism and case studies, not a phase table.
- Phases and events are whole years. Data series may use fractions of a year.
- One-finger drag on a phone pans the timeline sideways and scrolls the page vertically; there is no native horizontal scrollbar.
- Wheel zoom takes over the scroll wheel while the pointer is on the timeline.
- Hover cards need a mouse. On touch, tap an item: the same card appears under the timeline. The Tracks tab lists every item and source as text.
- The SVG export is the view as drawn, in the current light or dark theme, without the crosshair. Links are only drawn when both of their tracks are shown.
- Sync replaces the whole document with the newer copy; there is no merge.
- Markdown in notes is a small subset: paragraphs, `-` lists, `>` quotes, bold, italic, code and http(s) links.
