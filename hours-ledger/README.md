# Hours ledger

Light tracking of where the week goes across company, Masters, training and builds, with a one-page summary on Sunday. It is not a timesheet: logging is one tap, a timer, or one typed line, and nothing asks for a start and end time.

- **Today**: per category, `+15m` `+30m` `+1h` `+2h` chips with an undo toast; a timer (one at a time); a quick line (`masters 1h30 reading`); today's and the week's totals with a stacked bar per day. Chips can be pointed at yesterday or any earlier day of this week.
- **Week**: a day by category grid, editable cell by cell, with the week's entries underneath for corrections.
- **Sunday summary**: the week on one page: total, a bar by category with hours and share, each category against its target, last week and the 4-week average in plain sentences, the day-by-day strip, and three writing boxes saved per week. Prints as one sheet; "Copy as markdown" gives the same thing as text. Earlier weeks are on the arrows.
- **Trends**: stacked hours per week for the last 12 weeks, a line per category against its target, and totals by month or quarter.
- **Settings**: categories (rename, add, archive, colour, target as a floor or a ceiling, extra words for the quick line), the Sunday reminder, the timer cap, CSV export, backup and sync.

## Commands

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests for src/lib (Vitest)
npm run build    # type-check and build to dist/
npm run preview  # serve the production build
```

Deploys to Vercel as a static Vite app: set the project's Root Directory to `hours-ledger`.

## Layout

```
src/lib/   pure TypeScript, no DOM and no hidden clock: dates, model, parser, timer, summary, ics, tests
src/ui/    React: App (state and actions), Today, Week, Summary, Trends, Settings, common pieces
```

`store.ts`, `sync.ts` and `SyncPanel.tsx` are the shared template. The document lives in localStorage under `hours-ledger:v1`:

```ts
entries:     { id, day: 'YYYY-MM-DD', category: <category id>, minutes, note? }[]
categories:  { id, label, color, weeklyTargetHours?, targetKind?: 'floor' | 'ceiling', aliases?, archived? }[]
timer:       { category, startedAt: epoch ms } | null
reflections: { [monday]: { went, leaked, change } }
settings:    { timerCapHours, reminderTime }
```

## How it works

**Dates.** An entry belongs to a calendar date, not an instant. "Today" is the device's local date when you log, and after that the entry is just `2026-11-18`: flying between London and Istanbul never moves it. Weeks run Monday to Sunday and are numbered by ISO week. All date arithmetic is on the strings, in UTC.

**Timer.** Only the start timestamp is stored, so the timer survives reloads, a closed tab and a sleeping phone. Stopping asks nothing and rounds to the nearest 5 minutes; under 2.5 minutes logs nothing. A timer that crosses midnight is split at the device's local midnight (rounded cumulatively, so the parts add up to the rounded total). Starting a second timer stops and logs the first. A timer older than the cap (default 6 hours) is never logged as it stands: the Today tab flags it and asks how long it really was, counted from its start.

**Quick line.** `parseLine` in `src/lib/parser.ts`. The category, the duration and an optional day may come in any order at the start of the line; the rest is the note. A day word may also be the last word.

- Category: exact name, id or alias, otherwise a prefix (`mas`, `b`). An ambiguous prefix is refused with the candidates listed.
- Duration: `1h`, `1h30`, `1h30m`, `1.5h`, `45m`, `90min`, `1:30`, or `1h 30m` as two words. A bare number is refused ("45m or 45h?") rather than guessed.
- Day: `today`, `yesterday`, a weekday (`mon`, `tuesday`: the most recent one that is not in the future) or a full date. Future days are refused.

**Week summary.** `weekSummary` in `src/lib/summary.ts`. Share is a category's minutes over the week's tracked total. A floor is met at or above the target, a ceiling at or below it, and a ceiling only counts in a week where something was tracked at all. "Last week" and "the 4-week average" look back only as far as the first week with any entry; inside that span an untouched week counts as zero, and with fewer than four earlier weeks the sentence says "3-week average". A streak is the number of consecutive weeks, ending with the one shown, that met the target. The sentences are built from these numbers by rule; differences under 2.5 minutes read as "level".

**Trends.** The charts end on the last finished week and take in the current week on its Sunday, so a half-logged week does not look like a collapse. Month and quarter totals count each entry in the period of its own day.

**Reminder.** The app cannot notify when it is closed. Settings downloads an `.ics` with one event repeating every Sunday at the chosen time and a display alarm at the start. The time is floating (no timezone), so it rings at the same clock time in either city. On Sundays, and on Monday if last week has entries and empty boxes, the Today tab also shows a prompt.

## Configuring

Nothing is required. Device sync is optional and shared with Morning Board: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (see `.env.example`); without them everything stays in the browser and the backup file is the way to move it.

## Known limits

- The summary fits one A4 or Letter sheet with the default four categories and short answers (checked by rendering a PDF). Many categories or long answers will run to a second page. On a phone the numbers fill about one screen and the three boxes are a scroll below, so it is two screenshots, not one.
- A timer is split at midnight using the device's offset when it is stopped. A timer that runs through a flight between timezones, or through a clock change, is split at the destination's midnight.
- In the quick line a weekday at the very start or very end is read as the day: `training 1h sun` logs Sunday. Inside a note (`reading sun tzu`) it is left alone.
- Lowering a cell in the week grid trims the newest entries for that day and category first; use the entries list to change a specific one.
- Categories can be archived, and deleted only when they have no entries. Trends has no date range control: it is always the last 12 weeks.
- Sync replaces the whole document with the newer copy; two devices edited offline at the same time will lose one side's changes.
