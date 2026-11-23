# Year in Data

The annual birthday questions, answered first by the year's own record. For each question the page puts the relevant record in front of you (trips, matches, games played, books, builds shipped, hours, decisions) as plain facts, a small chart and the notable items, and only then gives you the box to write in. The record panel is evidence only: nothing is generated, interpreted or commented on.

- **Overview**: one screen of headline numbers, a day-by-day strip of the year coloured by city with markers for matches, books and builds, and the same numbers set against the year before.
- **Review**: one question at a time. The record beside it, then your answer, saved per year as you type.
- **Records**: where the record comes from. Every source is optional; anything missing is named, not hidden.
- **Questions and settings**: your birthday, your own ordered list of questions and which parts of the record sit beside each, backup and device sync.
- **Export**: a markdown file with the record tables and your answers (front matter included, ready for an Obsidian vault), and a print stylesheet that lays the review out one question to a page.

Past years stay browsable from the year picker.

## Commands

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests for everything in src/lib (Vitest)
npm run build    # type-check and build to dist/
npm run preview  # serve the production build
```

Deploys to Vercel as a static Vite app: set the project's Root Directory to `year-in-data`.

## How it works

**The year** runs from one birthday to the day before the next (`src/lib/window.ts`). Only the month and day are stored. A 29 February birthday is observed on 1 March in years without one, so consecutive years never overlap or leave a gap. The page opens on the year that just closed for 45 days after a birthday, and on the year in progress otherwise. A year in progress is counted up to today and says so.

**Every number** is a pure function of the year window and the records, with `today` passed in:

| Section | Source | What is worked out (`src/lib/`) |
|---|---|---|
| Trips | Two City `stays` | A stay covers the nights `arrive <= night < depart`; an open stay runs to today; where stays overlap the later arrival wins. Nights per city and country, London / Istanbul / elsewhere / not recorded, moves (a change of city from one recorded night to the next), longest unbroken stay, places with no earlier stay on record, nights by month. `trips.ts` |
| Matches | Two City `fixtures` with `attended: true` | Count, home and away, by competition, first and last, the list. `matches.ts` |
| Games | Lichess and Chess.com public APIs; hand-kept tallies | Games by site and time control, won / drawn / lost, rating at start and end, highest-rated opponent beaten, longest winning streak, busiest day (UTC days). `chess.ts`, `chessFetch.ts` |
| Books | A list kept here, with CSV import | Count, pages where known, average and highest rated, by month. `books.ts`, `csv.ts` |
| Builds | A list kept here; GitHub REST API | Builds by date; per repository, commits by month and by top-level folder. `record.ts`, `github.ts` |
| Hours | Hours Ledger `entries`, `categories` | Totals by category, weekly average (hours / (days so far / 7)), heaviest and lightest of the whole Monday-to-Sunday weeks inside the year. `hours.ts` |
| Decisions | Decision Journal `decisions` | Calls made in the year; for calls resolved in the year, the Brier score: the mean of (probability - outcome)^2, with the smallest and largest single errors. `decisions.ts` |

`present.ts` turns those numbers into the statements and tables that the page, the print view and the markdown export all share, so the three always agree.

**Other apps' records** are loaded as a copy, either from that app's backup file or by pasting its sync code. Only the contract fields are kept (notes are dropped); rows that do not fit the contract are left out and counted. Load again to refresh.

**Chess** is fetched from the browser for the usernames you enter and cached in the document per year, so the page does not refetch on load. If one site fails, the other is kept, the failure is shown, and games cached earlier from the failed site stay. Lichess gives the rating before each game; Chess.com only the rating after, so its "rating at start" is the rating after the first rated game, and the table says so.

**GitHub**: for `owner/repo` the app lists top-level folders, then the year's commits for the repository and for each folder, and asks whether each folder had any commit before the year. Folders whose first commit falls in the year are proposed as builds; you confirm each one. Only counts and dates are kept: no commit messages, no author names.

**Book CSVs**: a Goodreads library export (`Title`, `Author`, `My Rating`, `Number of Pages`, `Date Read`, `Exclusive Shelf`, `My Review`) or a StoryGraph export (`Title`, `Authors`, `Read Status`, `Last Date Read`, `Dates Read`, `Star Rating`, `Review`). Only books marked read are taken, a rating of 0 means not rated, and a book already listed (same title and author) is not added twice.

## What is kept where

- This app's document, in localStorage under `year-in-data:v1` (and in your sync document if sync is on): birthday, questions, answers, books, builds, tallies, usernames, fetched chess games, commit counts, and the copies of the other apps' records.
- This browser only, never in backups or sync: the other apps' sync codes (`year-in-data:v1:source-codes`) and the GitHub token (`year-in-data:v1:github-token`). The token is sent only to `api.github.com` and is never logged.

## Configuring

Nothing is required. Optional:

- **Device sync and pulling other apps by sync code**: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` as in the other projects (see `.env.example`). Without them the app works from backup files and says so.
- **Private repositories**: a GitHub personal access token with read access to the repository's contents, entered under Records.

## Layout

```
src/lib/        pure TypeScript and its tests: window, derivations, parsers, fetchers (network injected), export
src/ui/         React page: App, Overview, Review, Records, Settings, Panels (record panels, print view), Charts (hand-written SVG)
test/fixtures/  invented documents and API responses used by the tests; not bundled into the app
```

## Known limits

- The live calls to Lichess, Chess.com, GitHub and the sync service could not be exercised from the build sandbox. Their response parsing and request building are tested against fixtures in each API's shape, and the page was driven against the same fixtures served in place of the real hosts. Both chess APIs and GitHub allow browser requests today; if one stops doing so the fetch fails with a visible message.
- "Moves between cities" counts changes of city, not flights: the stays do not say how you travelled, and a day trip with no night away is not a move.
- Lichess is asked for at most 5,000 games a year; past that the earliest games are missing and a note says so. Chess variants are left out on both sites.
- GitHub: a commit that touches two top-level folders counts in both; folders deleted before today are not seen; dot-folders are skipped; each listing stops at 2,000 commits and is then marked "or more". Without a token GitHub allows 60 requests an hour, and a repository costs about two per top-level folder. Commit days are UTC.
- Heaviest and lightest weeks only consider whole Monday-to-Sunday weeks inside the year, so the partial weeks at either end are not ranked.
- A resolved decision with no resolved date is dated to its review date.
- The comparison shows a change only where both years have the number. Against a year in progress it compares a part year with a whole one, and says so.
- Fetched chess games live in the document, so a heavy year adds a few hundred kilobytes to localStorage and to each sync push.
- Removing a question hides its answers from the page and the export; they remain in the document and in backups.
