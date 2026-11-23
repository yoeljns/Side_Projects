# Two City

One app for a life split between London and Istanbul: a city switch, a day-count ledger, a Chelsea matchday desk and dream-trip triggers. Four tabs share one document, so the ledger's London dates decide which matches you can attend and when the switch offers itself.

- **Switch**: one action flips London or Istanbul mode: the big switch in the header, `Shift` + `S`, or `npm run switch -- istanbul` in a terminal. It shows that city's routine in its order as today's plan, puts its court, gym and other defaults in front of you, and deals a fresh packing list (for the journey there) and landing list (on landing, first morning, first week), keeping the previous lists as history. The routine exports as an `.ics` of weekly recurring events in that city's timezone. If the ledger has a stay in the other city starting today or tomorrow, or already under way, a banner offers the flip.
- **Ledger**: stays in, day counts out. Each rule shows days used to date, days booked ahead and days remaining, with a bar; each planned stay shows what is left under every applicable rule at its end and the latest date it could be extended to; stays that go over a limit are flagged. A what-if moves one flight and shows every rule and later stay before and after without saving. A year strip colours each day by country, and the day-by-day table exports as CSV.
- **Matchday**: Chelsea fixtures crossed with the ledger: in London, away from London, or no plans yet; away matches show the city they are played in. Ticket sale windows per match and phase, with a banner, optional browser notifications, and an `.ics` of sale windows with reminders.
- **Trips**: a watcher per dream trip: date triggers (something opens N days before the season or travel date, decide by, book by) and fare triggers on a route (target price, or a drop against the trailing median of a fare log). A combined "what matters next" list and an `.ics` of upcoming dates with alarms. Ships one optional template, the Norway orca season.

Everything is stored in the browser (`two-city:v1` in localStorage), with a backup file and optional device sync in Settings. First run is empty apart from generic starter templates for the two city profiles, which are meant to be edited.

## Commands

```bash
npm install
npm run dev               # local dev server (no /api: see Matchday below)
npm test                  # unit tests (Vitest)
npm run build             # type-check and build to dist/
npm run preview           # serve the production build
npm run switch -- london  # the city switch from a terminal
```

Deploys to Vercel as a Vite app with one serverless function: set the project's Root Directory to `two-city`.

## The `city` command

```bash
npm run switch -- istanbul            # or: node cli/switch.mjs istanbul
npm link && city london               # optional: puts `city` on your PATH
city istanbul --file ~/Downloads/two-city-2026-11-23.json --out ~/Desktop/switch
```

It prints the routine order, the court and gym defaults and the packing and landing checklists, and writes `checklist-<city>-<date>.md` and `routine-<city>.ics` to the output directory (default `./out`, gitignored). Options: `--file <backup.json>`, `--out <dir>`, `--date YYYY-MM-DD` (default: today in the destination city), `--no-sync`, `--help`.

Where the document comes from, in order:

1. `SUPABASE_URL`, `SUPABASE_KEY` and `TWO_CITY_SYNC_CODE` set in the shell: the synced document is pulled, flipped and pushed back (the same `board_get` / `board_put` functions the app uses). The app follows the next time it is opened or brought to the front. The sync code is in Settings, "Copy code".
2. `--file`: a backup downloaded from Settings. The app is not changed; the flipped document is written next to the checklists as `two-city-<date>.json`, which you can restore in Settings.
3. Neither: the starter templates, so the command is useful for a look but knows nothing of your edits.

The command is plain Node with no build step: `cli/switch.mjs` imports `src/lib/cli.ts` directly and Node strips the types. That needs Node 22.18 or newer (tested on 22.23); on 22.6 to 22.17 run `node --experimental-strip-types cli/switch.mjs`. This is why files under `src/lib` import each other with explicit `.ts` extensions and use no enums.

## How it works

```
src/lib/    pure TypeScript, no DOM, `today` always passed in; shared by the app and the CLI
  dates.ts      day arithmetic on YYYY-MM-DD strings, city clocks
  ics.ts        the one iCalendar reader and writer
  ledger.ts     presence, rules, planned-stay outlook, what-if, CSV
  bookings.ts   flights from calendar files and pasted confirmations, flights to stays, import plan
  airports.ts   airport table (code, city, country, timezone) and name aliases in English and Turkish
  matchday.ts   feed mapper, refresh/merge, crossing with stays, sale windows and alerts
  triggers.ts   season windows, date and fare triggers, fare input parsing, orca template
  switch.ts     flip, today's plan, routine .ics, checklist Markdown, switch suggestion
  next.ts       "what matters next" across the three areas
  cli.ts        core of the city command (all I/O injected)
  model.ts      the document and starter profiles
src/ui/     React: App (header, switch, tabs) and one file per tab
api/fixtures.ts   Vercel function that fetches the league fixtures
cli/switch.mjs    the command
```

**Day counts.** A rule is a set of countries, a convention, a period and a limit. Under `midnights` a day counts if you are there at the end of it (arrival day yes, departure day no); under `any-part` both travel days count, so a travel day counts in two countries. Stays become merged spans of counted days per rule; a count is the overlap of those spans with a period. Periods are the UK tax year (6 April to 5 April), the calendar year, or any rolling window of M days, for which the figure that matters is the fullest window from today onward. "Remaining" is limit minus used minus booked. For a planned stay, "left at the end" counts everything up to its last day, and the latest extension is found by binary search on the departure date (counts only grow as it moves out), stopping at the limit or at the next booked stay. An open-ended stay (no departure) is counted up to today only.

The presets are UK days in the tax year (midnights, limit empty) and Turkey days in the calendar year (any part, limit 183), plus an add-on rolling rule (Schengen, 90 in any 180). The limit means "the most days you allow yourself": if a threshold reads "fewer than 46", enter 45. The app counts days. It does not know your ties, treaties or exceptional-circumstance days and does not give tax advice.

**Bookings.** Calendar files: events with a flight number or the word "flight" and two known airports (in the title, or destination in the title and origin in the location, as Gmail writes them) become flight segments; a UTC time is converted to the departure airport's local date. Confirmation emails: the text is scanned line by line for airports (codes in brackets, bare codes, or city and airport names) and dates (English and Turkish month names, `15.08.2026`, `15/08/2026` day-first, ISO); airports pair up in reading order and each pair takes the date on its own lines, else the nearest dated line below or above. Consecutive flights become stays; the last landing becomes an open-ended stay; a same-day onward flight is treated as a connection. The review step shows the flights read, the stays to be created or changed and anything skipped; stays already present with the same dates are left alone, and a rebooked flight changes the existing stay.

**Sale windows.** The club announces on-sale dates match by match and there is no feed. Each match has the phases set in Settings (season-ticket holders, members with loyalty points, members, general sale); a phase's date is "match date minus an offset" (separate offsets for home league, away, and home cup) and is labelled estimated until you type the confirmed date on the match. The shipped offsets are guesses, not the club's policy. Alerts cover the phase you say is yours, for matches played in London on dates the ledger has you in London, until you mark "I have a ticket" or "Not going".

**Triggers.** A season is a month-day range that recurs yearly (it may wrap over New Year); a date trigger is the season start, or the target travel date, minus N days, or a date set by hand. Status: waiting, coming up (within 14 days), open now, fired (marked done, or a fare hit), missed. A fare trigger looks at the log for its route and currency: it fires when the latest fare is at or below the target price, or at least N% below the median of the earlier fares in the look-back window (at least three are needed), and only while that observation is at most 7 days old.

## What needs configuring

- **Nothing**, to use it in one browser.
- **Device sync** (optional): the Supabase project and functions from `morning-board/supabase/migrations`, with `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` set at build time (see `.env.example`). For the CLI to flip the synced copy, also export `SUPABASE_URL`, `SUPABASE_KEY` and `TWO_CITY_SYNC_CODE` in your shell.
- **League fixtures**: `api/fixtures.ts` runs on Vercel (or `vercel dev`). Under `npm run dev` or `npm run preview` there is no `/api`, the Load button says so, and fixtures can still be imported from an `.ics` or added by hand.
- **Your profiles**: Settings, City profiles. The starter routine, packing and landing lists are generic.
- **Your limits**: the UK limit is empty until you set it.

## Fares from a scheduled Claude task

No fare API is bundled. Fares reach the log by typing, pasting lines, or pasting JSON. If you use Claude with an airline connector, a scheduled task can do the looking; paste what it returns into Trips, "Paste or import several". A prompt to start from:

```
Every Monday and Thursday morning: using the Turkish Airlines connector, find the
cheapest return economy fare for these routes for travel in the dates given, and
reply with ONLY a JSON array, one object per route, in exactly this shape:
[{"on":"<today, YYYY-MM-DD>","from":"IST","to":"TOS","price":12450,"currency":"TRY","source":"THY connector"}]
Routes and dates:
- IST to TOS, out between 10 and 20 November, back 5 to 8 days later
- LHR to TOS (via IST), same dates
Use the currency the airline returns and do not convert it. If no fare is found
for a route, leave that route out. No commentary before or after the JSON.
```

A fare trigger compares like with like only: same route, same currency.

## Known limits

- It reads calendar files and pasted confirmations. It does not log into an inbox, an airline account or the club's site.
- Confirmation parsing is tested against Turkish Airlines, British Airways and Pegasus layouts written for the tests, in English and Turkish, not against every real email. Year-less dates (`15 AUG`) are not read. If an email gives no arrival date, an overnight flight is assumed to land the same day: check the review step and edit the stay if needed. The airport table is small (about 100 airports); an unknown code is ignored.
- Days between stays are "no record": the ledger does not guess where you were. Two home cities are first-class; other places are stays with a city name and country code.
- The fixture feed could not be reached from the build sandbox. The mapper is tested against data in the feed's documented shape and the failure path is visible, but the live fetch has not been exercised.
- Cup and European fixtures come from an `.ics` you supply, with titles like "Chelsea v Arsenal". Away grounds are mapped to cities for English clubs only.
- Browser notifications appear only while the app is open in a tab, and some phone browsers do not show them at all. The calendar file with reminders is the reliable alert, and it is a snapshot: after changing dates, download and import it again.
- The routine `.ics` is a file to import. The app does not host a calendar feed to subscribe to, and does not hide the other city's calendar for you: keep one calendar per city and toggle it.
- The CLI's push makes its copy the newest; an edit made on a device in the same minute, before that device next syncs, would be overwritten. Sync is last-writer-wins on the whole document.
- "Today" is the date in the city the app is switched to.
