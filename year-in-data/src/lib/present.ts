// Turn a year's record into plain statements and tables. The page, the print view
// and the markdown export all read from here, so they always say the same thing.
// Facts only: nothing here interprets or comments.
import type { ChessGame, SectionId } from './types';
import { SECTION_LABEL } from './types';
import { fmtDate, fmtDay, fmtMonth } from './dates';
import { gameDay } from './chess';
import type { YearRecord } from './record';
import { BUCKET_LABEL, cityName } from './trips';

export interface Fact {
  label: string;
  value: string;
}
export interface Table {
  title: string;
  head: string[];
  /** Column indexes that hold numbers (right-aligned). */
  numeric: number[];
  rows: string[][];
}
export interface SectionView {
  id: SectionId;
  title: string;
  /** Set when the source is not loaded: says what is missing and where to add it. */
  missing: string | null;
  facts: Fact[];
  tables: Table[];
}

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-GB');
export const fmtNum = (n: number, digits: number): string => n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtHours = (minutes: number): string => `${fmtNum(minutes / 60, 1)} h`;
const pct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%');
const plural = (n: number, one: string, many = `${one}s`): string => `${fmtInt(n)} ${n === 1 ? one : many}`;
const range = (from: string, toExclusive: string): string => `${fmtDay(from)} to ${fmtDate(toExclusive)}`;
const stars = (r: number | undefined): string => (r === undefined ? '' : `${r}/5`);
const game = (g: ChessGame): string => `${g.opp}${g.oppRating !== undefined ? ` (${g.oppRating})` : ''}, ${g.speed}, ${fmtDate(gameDay(g))}`;

function trips(r: YearRecord): SectionView {
  const v: SectionView = { id: 'trips', title: SECTION_LABEL.trips, missing: null, facts: [], tables: [] };
  const t = r.trips;
  if (!t) return { ...v, missing: 'No Two City document is loaded. Add it under Records to see nights by city.' };
  const recorded = t.nights - t.buckets.unrecorded;
  v.facts.push({ label: 'Nights recorded', value: `${fmtInt(recorded)} of ${fmtInt(t.nights)}` });
  if (recorded === 0) return v;
  for (const b of ['london', 'istanbul', 'elsewhere'] as const) v.facts.push({ label: `Nights ${b === 'elsewhere' ? 'elsewhere' : `in ${BUCKET_LABEL[b]}`}`, value: `${fmtInt(t.buckets[b])} (${pct(t.buckets[b], recorded)} of recorded)` });
  v.facts.push({ label: 'Moves between cities', value: fmtInt(t.moves) });
  if (t.longest) v.facts.push({ label: 'Longest unbroken stay', value: `${cityName(t.longest.city)}, ${plural(t.longest.nights, 'night')} (${range(t.longest.from, t.longest.to)})` });
  v.facts.push({ label: 'Countries', value: t.byCountry.map((c) => `${c.country} ${fmtInt(c.nights)}`).join(', ') });
  if (t.newPlaces) v.facts.push({ label: 'Places with no earlier stay on record', value: t.newPlaces.length ? t.newPlaces.map(cityName).join(', ') : 'None' });
  v.tables.push({ title: 'Nights by city', head: ['City', 'Country', 'Nights'], numeric: [2], rows: t.byCity.map((c) => [cityName(c.city), c.country, fmtInt(c.nights)]) });
  if (t.away.length) v.tables.push({ title: 'Away from London and Istanbul', head: ['Place', 'From', 'To', 'Nights'], numeric: [3], rows: t.away.map((a) => [cityName(a.city), fmtDate(a.from), fmtDate(a.to), fmtInt(a.nights)]) });
  v.tables.push({
    title: 'Nights by month',
    head: ['Month', 'London', 'Istanbul', 'Elsewhere', 'Not recorded'],
    numeric: [1, 2, 3, 4],
    rows: t.months.filter((m) => m.london + m.istanbul + m.elsewhere + m.unrecorded > 0).map((m) => [fmtMonth(m.month), fmtInt(m.london), fmtInt(m.istanbul), fmtInt(m.elsewhere), fmtInt(m.unrecorded)]),
  });
  return v;
}

function matches(r: YearRecord): SectionView {
  const v: SectionView = { id: 'matches', title: SECTION_LABEL.matches, missing: null, facts: [], tables: [] };
  const m = r.matches;
  if (!m) return { ...v, missing: 'No Two City document is loaded. Add it under Records to see matches attended.' };
  const line = (f: NonNullable<typeof m.first>) => `${fmtDate(f.date)}, ${f.opponent} (${f.home ? 'home' : 'away'}), ${f.competition}`;
  v.facts.push({ label: 'Matches attended', value: fmtInt(m.count) });
  if (m.count === 0) return v;
  v.facts.push({ label: 'Home and away', value: `${fmtInt(m.home)} home, ${fmtInt(m.away)} away` });
  v.facts.push({ label: 'By competition', value: m.byCompetition.map((c) => `${c.competition} ${fmtInt(c.count)}`).join(', ') });
  v.facts.push({ label: 'First of the year', value: line(m.first!) });
  v.facts.push({ label: 'Last of the year', value: line(m.last!) });
  v.tables.push({ title: 'Matches attended', head: ['Date', 'Opponent', 'Where', 'Competition'], numeric: [], rows: m.list.map((f) => [fmtDate(f.date), f.opponent, f.home ? 'Home' : `Away${f.venue ? `, ${f.venue}` : ''}`, f.competition]) });
  return v;
}

function games(r: YearRecord): SectionView {
  const v: SectionView = { id: 'games', title: SECTION_LABEL.games, missing: null, facts: [], tables: [] };
  const c = r.chess;
  if (!c && r.counters.length === 0) return { ...v, missing: 'No chess games fetched for this year and no hand-kept tallies. Add a username or a tally under Records.' };
  if (c) {
    v.facts.push({ label: 'Chess games', value: fmtInt(c.total) });
    if (c.total > 0) {
      v.facts.push({ label: 'Won, drawn, lost', value: `${fmtInt(c.win)} won, ${fmtInt(c.draw)} drawn, ${fmtInt(c.loss)} lost` });
      if (c.bestWin) v.facts.push({ label: 'Highest-rated opponent beaten', value: game(c.bestWin) });
      if (c.streak) v.facts.push({ label: 'Longest winning streak', value: `${plural(c.streak.length, 'game')} (${c.streak.from === c.streak.to ? fmtDate(c.streak.from) : `${fmtDay(c.streak.from)} to ${fmtDate(c.streak.to)}`})` });
      if (c.busiest) v.facts.push({ label: 'Busiest day', value: `${fmtDate(c.busiest.day)}, ${plural(c.busiest.games, 'game')}` });
      const anyAfter = c.bySpeed.some((s) => s.startIsAfterFirstGame && s.start !== undefined);
      v.tables.push({
        title: `Chess by time control${anyAfter ? ' (Chess.com start rating is the rating after the first rated game)' : ''}`,
        head: ['Time control', 'Games', 'Won', 'Drawn', 'Lost', 'Rating at start', 'Rating at end'],
        numeric: [1, 2, 3, 4, 5, 6],
        rows: c.bySpeed.map((s) => [s.label, fmtInt(s.games), fmtInt(s.win), fmtInt(s.draw), fmtInt(s.loss), s.start === undefined ? '' : String(s.start), s.end === undefined ? '' : String(s.end)]),
      });
    }
  }
  if (r.counters.length) {
    v.tables.push({ title: 'Other games (hand-kept tallies)', head: ['Game', 'Played', 'Won'], numeric: [1, 2], rows: r.counters.map((x) => [x.label, fmtInt(x.played), fmtInt(x.won)]) });
  }
  return v;
}

function books(r: YearRecord): SectionView {
  const v: SectionView = { id: 'books', title: SECTION_LABEL.books, missing: null, facts: [], tables: [] };
  const b = r.books;
  v.facts.push({ label: 'Books finished', value: fmtInt(b.count) });
  if (b.undated > 0) v.facts.push({ label: 'On the list with no finish date', value: `${fmtInt(b.undated)} (not counted in any year)` });
  if (b.count === 0) return v;
  if (b.withPages > 0) v.facts.push({ label: 'Pages', value: `${fmtInt(b.pages)} across the ${plural(b.withPages, 'book')} with a page count` });
  if (b.avgRating !== null) v.facts.push({ label: 'Average rating', value: `${fmtNum(b.avgRating, 2)} across ${plural(b.rated, 'rated book')}` });
  if (b.topRated.length) v.facts.push({ label: 'Highest rated', value: b.topRated.map((x) => `${x.title} (${stars(x.rating)})`).join('; ') });
  const busiest = b.byMonth.reduce((best, m) => (m.count > best.count ? m : best), b.byMonth[0]);
  if (busiest.count > 1) v.facts.push({ label: 'Month with most finished', value: `${fmtMonth(busiest.month)}, ${fmtInt(busiest.count)}` });
  v.tables.push({ title: 'Books finished', head: ['Finished', 'Title', 'Author', 'Rating', 'Note'], numeric: [], rows: b.list.map((x) => [fmtDate(x.finished!), x.title, x.author, stars(x.rating), x.note ?? '']) });
  return v;
}

function builds(r: YearRecord): SectionView {
  const v: SectionView = { id: 'builds', title: SECTION_LABEL.builds, missing: null, facts: [], tables: [] };
  v.facts.push({ label: 'Builds shipped', value: fmtInt(r.builds.count) });
  if (r.builds.count) v.tables.push({ title: 'Builds shipped', head: ['Shipped', 'Name', 'Link', 'Note'], numeric: [], rows: r.builds.list.map((b) => [fmtDate(b.shipped), b.name, b.link ?? '', b.note ?? '']) });
  for (const repo of r.repos) {
    v.facts.push({ label: `Commits in ${repo.repo}`, value: `${fmtInt(repo.total)}${repo.truncated ? ' or more (the listing was cut off)' : ''}` });
    const active = repo.folders.filter((f) => f.commits > 0);
    if (active.length) v.tables.push({
      title: `Commits by top-level folder in ${repo.repo}`,
      head: ['Folder', 'Commits', 'First commit in the year', 'New this year'],
      numeric: [1],
      rows: active.map((f) => [f.name, fmtInt(f.commits), f.first ? fmtDate(f.first) : '', f.isNew ? 'Yes' : 'No']),
    });
    v.tables.push({ title: `Commits by month in ${repo.repo}`, head: ['Month', 'Commits'], numeric: [1], rows: Object.entries(repo.byMonth).filter(([, n]) => n > 0).map(([m, n]) => [fmtMonth(m), fmtInt(n)]) });
  }
  return v;
}

function hours(r: YearRecord): SectionView {
  const v: SectionView = { id: 'hours', title: SECTION_LABEL.hours, missing: null, facts: [], tables: [] };
  const h = r.hours;
  if (!h) return { ...v, missing: 'No Hours Ledger document is loaded. Add it under Records to see hours by category.' };
  v.facts.push({ label: 'Hours logged', value: fmtHours(h.totalMinutes) });
  if (h.entries === 0) return v;
  const week = (w: { start: string; minutes: number }) => `week of ${fmtDate(w.start)}, ${fmtHours(w.minutes)}`;
  v.facts.push({ label: 'Weekly average', value: `${fmtHours(h.weeklyAvgHours * 60)} over ${fmtNum(r.elapsedDays / 7, 1)} weeks` });
  if (h.heaviest) v.facts.push({ label: 'Heaviest week', value: week(h.heaviest) });
  if (h.lightest) v.facts.push({ label: 'Lightest week', value: week(h.lightest) });
  v.tables.push({ title: 'Hours by category', head: ['Category', 'Hours', 'Per week', 'Share'], numeric: [1, 2, 3], rows: h.byCategory.map((c) => [c.label, fmtNum(c.minutes / 60, 1), fmtNum(c.weeklyAvgHours, 1), pct(c.minutes, h.totalMinutes)]) });
  return v;
}

function decisions(r: YearRecord): SectionView {
  const v: SectionView = { id: 'decisions', title: SECTION_LABEL.decisions, missing: null, facts: [], tables: [] };
  const d = r.decisions;
  if (!d) return { ...v, missing: 'No Decision Journal document is loaded. Add it under Records to see calls made and how they resolved.' };
  const p = (x: number) => `${Math.round(x * 100)}%`;
  const call = (s: NonNullable<typeof d.best>) => `${s.decision.title}: said ${p(s.decision.probability)}, ${s.decision.outcome ? 'it happened' : 'it did not happen'} (squared error ${fmtNum(s.error, 3)})`;
  v.facts.push({ label: 'Calls made', value: `${fmtInt(d.made.length)}${d.made.length ? `, of which ${fmtInt(d.open)} still open` : ''}` });
  v.facts.push({ label: 'Calls resolved', value: `${fmtInt(d.resolved.length)}${d.resolved.length ? `, of which ${fmtInt(d.happened)} happened` : ''}` });
  if (d.brier !== null) {
    v.facts.push({ label: 'Brier score', value: `${fmtNum(d.brier, 3)} (0 is perfect; always saying 50% scores 0.250)` });
    v.facts.push({ label: 'Smallest error', value: call(d.best!) });
    v.facts.push({ label: 'Largest error', value: call(d.worst!) });
    v.tables.push({
      title: 'Calls resolved',
      head: ['Resolved', 'Call', 'Probability', 'Outcome', 'Squared error'],
      numeric: [2, 4],
      rows: d.resolved.map((s) => [fmtDate(s.decision.resolvedOn!), s.decision.title, p(s.decision.probability), s.decision.outcome ? 'Happened' : 'Did not happen', fmtNum(s.error, 3)]),
    });
  }
  if (d.made.length) v.tables.push({ title: 'Calls made', head: ['Made', 'Call', 'Probability', 'Status'], numeric: [2], rows: d.made.map((x) => [fmtDate(x.madeOn), x.title, p(x.probability), typeof x.outcome === 'boolean' ? (x.outcome ? 'Happened' : 'Did not happen') : 'Open']) });
  return v;
}

const VIEWS: Record<SectionId, (r: YearRecord) => SectionView> = { trips, matches, games, books, builds, hours, decisions };

export const sectionView = (id: SectionId, r: YearRecord): SectionView => VIEWS[id](r);

export const yearTitle = (r: YearRecord): string => `${fmtDate(r.window.start)} to ${fmtDate(r.window.last)}`;

/** One line on how much of the year the record covers. */
export function coverage(r: YearRecord): string {
  if (r.notStarted) return 'This year has not started.';
  if (r.inProgress) return `Year in progress: day ${fmtInt(r.elapsedDays)} of ${fmtInt(r.window.days)}, through ${fmtDate(r.today)}.`;
  return `${fmtInt(r.window.days)} days.`;
}
