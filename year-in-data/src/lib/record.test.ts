import { describe, expect, it } from 'vitest';
import chessComRaw from '../../test/fixtures/chesscom-2025-06.json?raw';
import decisionsRaw from '../../test/fixtures/decision-journal.json?raw';
import goodreads from '../../test/fixtures/goodreads.csv?raw';
import hoursRaw from '../../test/fixtures/hours-ledger.json?raw';
import lichessRaw from '../../test/fixtures/lichess.ndjson?raw';
import twoCityRaw from '../../test/fixtures/two-city.json?raw';
import { importBooksCsv, mergeBooks } from './books';
import { parseChessCom, parseLichess } from './chess';
import { BLANK, earliestDate, yearsWithContent } from './doc';
import { mdTable, reviewFilename, reviewMarkdown } from './markdown';
import { coverage, sectionView, yearTitle } from './present';
import { move, wordCount } from './questions';
import { buildRecord, compareYears, hasAnyRecord, headlines } from './record';
import { parseDecisions, parseHours, parseTwoCity } from './sources';
import type { Doc } from './types';
import { yearWindow } from './window';

const B = { month: 3, day: 10 };
const W = yearWindow(B, 2026);
const TODAY = '2026-11-23';
let n = 0;

const full: Doc = {
  ...BLANK,
  birthday: B,
  books: mergeBooks([], importBooksCsv(goodreads).books, () => `b${++n}`).books,
  builds: [
    { id: 'x1', name: 'Tide table', shipped: '2025-06-30', link: 'https://example.invalid/tide', note: 'Harmonic model | offline' },
    { id: 'x2', name: 'Paper ledger', shipped: '2026-01-05' },
    { id: 'x3', name: 'Later thing', shipped: '2026-05-01' },
  ],
  counters: [{ id: 'c1', label: 'Backgammon matches', byYear: { '2026': { played: 40, won: 23 }, '2025': { played: 12, won: 5 } } }],
  chess: { lichess: 'testpawn', chesscom: 'testpawn', cache: { '2026': { fetchedAt: 1, notes: [], games: [...parseLichess(lichessRaw, 'testpawn'), ...parseChessCom(JSON.parse(chessComRaw), 'testpawn')] } } },
  github: {
    repos: ['test-owner/test-repo'],
    cache: { '2026': { 'test-owner/test-repo': { repo: 'test-owner/test-repo', fetchedAt: 1, total: 7, truncated: false, byMonth: { '2025-06': 3, '2025-07': 0, '2026-01': 4 }, folders: [{ name: 'tide-table', commits: 4, first: '2025-06-01', isNew: true }, { name: 'idle', commits: 0, isNew: false }] } } },
  },
  imported: {
    twoCity: { importedAt: 1, via: 'file', data: parseTwoCity(JSON.parse(twoCityRaw)).data },
    hours: { importedAt: 1, via: 'file', data: parseHours(JSON.parse(hoursRaw)).data },
    decisions: { importedAt: 1, via: 'sync', data: parseDecisions(JSON.parse(decisionsRaw)).data },
  },
  answers: { '2026': { 'q-where': 'Mostly on the ferry.\n\nSecond paragraph.' } },
};

describe('the year record', () => {
  const r = buildRecord(full, W, TODAY);
  const value = (id: string) => headlines(r).find((h) => h.id === id)?.value;

  it('gathers every source for the year', () => {
    expect([r.elapsedDays, r.inProgress, r.notStarted]).toEqual([365, false, false]);
    expect(r.days).toHaveLength(365);
    expect(value('london')).toBe(173);
    expect(value('istanbul')).toBe(176);
    expect(value('elsewhere')).toBe(12);
    expect(value('moves')).toBe(8);
    expect(value('matches')).toBe(4);
    expect(value('games')).toBe(12 + 40); // chess plus the backgammon tally
    expect(value('books')).toBe(4); // Goodreads only here: Apr, Jul, Nov 2025 and Feb 2026
    expect(value('builds')).toBe(2);
    expect(value('commits')).toBe(7);
    expect(value('decisions')).toBe(5);
    expect(value('brier')).toBeCloseTo(0.348, 10);
    expect(r.counters).toEqual([{ label: 'Backgammon matches', played: 40, won: 23 }]);
  });

  it('has empty headline numbers, not zeros, where a source is missing', () => {
    const empty = buildRecord({ ...BLANK, birthday: B }, W, TODAY);
    expect(headlines(empty).every((h) => h.value === null)).toBe(true);
    expect(hasAnyRecord(empty)).toBe(false);
    expect(hasAnyRecord(r)).toBe(true);
    for (const id of ['trips', 'matches', 'games', 'hours', 'decisions'] as const) expect(sectionView(id, empty).missing).toMatch(/Records/);
    expect(sectionView('books', empty)).toMatchObject({ missing: null, facts: [{ label: 'Books finished', value: '0' }], tables: [] });
    expect(sectionView('builds', empty).facts).toEqual([{ label: 'Builds shipped', value: '0' }]);
  });

  it('sets the year against the one before, only where both have the number', () => {
    const prev = buildRecord(full, yearWindow(B, 2025), TODAY); // 10 Mar 2024 to 9 Mar 2025
    const c = Object.fromEntries(compareYears(r, prev).map((x) => [x.id, x]));
    // The year before: London 10 Mar-19 Jun (102) + 1 Sep-19 Feb (172) = 274; Istanbul 20 Jun-31 Aug (73) + 20 Feb-9 Mar (18) = 91.
    expect(c.london).toMatchObject({ current: 173, previous: 274, delta: -101 });
    expect(c.istanbul).toMatchObject({ current: 176, previous: 91, delta: 85 });
    expect(c.matches).toMatchObject({ current: 4, previous: 2, delta: 2 }); // 5 Oct 2024 and 9 Mar 2025
    expect(c.books).toMatchObject({ current: 4, previous: 1, delta: 3 });
    expect(c.games).toMatchObject({ current: 52, previous: 12, delta: 40 }); // no chess fetched for the year before, only the tally
    expect(c.builds).toMatchObject({ current: 2, previous: null, delta: null });
    expect(c.commits).toMatchObject({ current: 7, previous: null, delta: null });
  });

  it('describes a year in progress and stops its record at today', () => {
    const now = buildRecord(full, yearWindow(B, 2027), TODAY);
    expect([now.elapsedDays, now.inProgress]).toEqual([259, true]);
    expect(now.days).toHaveLength(259);
    expect(now.days[258]).toMatchObject({ date: '2026-11-23', city: 'london' }); // the open stay
    expect(coverage(now)).toBe('Year in progress: day 259 of 365, through 23 Nov 2026.');
    expect(coverage(r)).toBe('365 days.');
    expect(coverage(buildRecord(full, yearWindow(B, 2029), TODAY))).toBe('This year has not started.');
    expect(yearTitle(r)).toBe('10 Mar 2025 to 9 Mar 2026');
  });

  it('states facts in plain words', () => {
    const facts = (id: Parameters<typeof sectionView>[0]) => Object.fromEntries(sectionView(id, r).facts.map((f) => [f.label, f.value]));
    expect(facts('trips')).toMatchObject({
      'Nights recorded': '361 of 365',
      'Nights in London': '173 (48% of recorded)',
      'Nights in Istanbul': '176 (49% of recorded)',
      'Nights elsewhere': '12 (3% of recorded)',
      'Moves between cities': '8',
      'Longest unbroken stay': 'London, 83 nights (9 Apr to 1 Jul 2025)',
      Countries: 'TR 176, GB 173, PT 7, GE 5',
      'Places with no earlier stay on record': 'Lisbon, Tbilisi',
    });
    expect(facts('matches')).toMatchObject({ 'Matches attended': '4', 'Home and away': '3 home, 1 away', 'First of the year': '12 Apr 2025, Northbridge Rovers (home), League', 'Last of the year': '17 Jan 2026, Westvale Athletic (home), Cup' });
    expect(facts('games')).toMatchObject({ 'Chess games': '12', 'Won, drawn, lost': '7 won, 2 drawn, 3 lost', 'Highest-rated opponent beaten': 'Endgamer (1710), blitz, 9 Sep 2025', 'Longest winning streak': '4 games (21 Jun to 10 Sep 2025)', 'Busiest day': '15 Mar 2025, 3 games' });
    expect(facts('books')).toMatchObject({ 'Books finished': '4', Pages: '676 across the 3 books with a page count', 'Average rating': '4.67 across 3 rated books', 'On the list with no finish date': '1 (not counted in any year)' });
    expect(facts('decisions')).toMatchObject({ 'Calls made': '5, of which 1 still open', 'Calls resolved': '5, of which 2 happened', 'Smallest error': 'Move the office: said 20%, it did not happen (squared error 0.040)' });
    expect(facts('decisions')['Brier score']).toMatch(/^0\.348 /);
    expect(facts('builds')).toEqual({ 'Builds shipped': '2', 'Commits in test-owner/test-repo': '7' });
  });
});

describe('markdown export', () => {
  it('escapes pipes and folds line breaks in table cells', () => {
    expect(mdTable({ head: ['Name', 'N'], numeric: [1], rows: [['a | b', '1'], ['two\nlines', '2']] })).toBe('| Name | N |\n| --- | ---: |\n| a \\| b | 1 |\n| two lines | 2 |');
  });

  it('writes a whole small review exactly', () => {
    const doc: Doc = { ...BLANK, birthday: B, books: [{ id: 'b', title: 'Maps, Margins', author: 'Odile Marsh', finished: '2026-02-14', rating: 5, note: 'Short | exact.' }] };
    const record = buildRecord(doc, W, TODAY);
    const md = reviewMarkdown({ record, questions: [{ id: 'a', text: 'What did I learn?', sections: ['books'] }, { id: 'b', text: 'What next?', sections: [] }], answers: { a: '  Less than I hoped.\n\nMore than I feared.  ' }, comparison: null });
    const lines = md.split('\n');
    expect(lines.slice(0, 16)).toEqual([
      '---',
      'type: year-review',
      'year_start: 2025-03-10',
      'year_end: 2026-03-09',
      'exported: 2026-11-23',
      '---',
      '',
      '# Year in data: 10 Mar 2025 to 9 Mar 2026',
      '',
      '365 days.',
      '',
      '## Headline numbers',
      '',
      '|  | This year |',
      '| --- | ---: |',
      '| Books finished | 1 |',
    ]);
    expect(md).toContain('### Trips\n\n_No Two City document is loaded. Add it under Records to see nights by city._\n');
    expect(md).toContain('### Books\n\n- Books finished: 1\n- Average rating: 5.00 across 1 rated book\n- Highest rated: Maps, Margins (5/5)\n\n**Books finished**\n\n| Finished | Title | Author | Rating | Note |\n| --- | --- | --- | --- | --- |\n| 14 Feb 2026 | Maps, Margins | Odile Marsh | 5/5 | Short \\| exact. |\n');
    expect(md.endsWith('## The questions\n\n### 1. What did I learn?\n\n_Record beside this question: books._\n\nLess than I hoped.\n\nMore than I feared.\n\n### 2. What next?\n\n_Not answered yet._\n')).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
  });

  it('carries every section, the comparison and the answers for the full fixture year', () => {
    const record = buildRecord(full, W, TODAY);
    const md = reviewMarkdown({ record, questions: full.questions, answers: full.answers['2026'], comparison: compareYears(record, buildRecord(full, yearWindow(B, 2025), TODAY)) });
    expect(md).toContain('|  | This year | Year before | Change |');
    expect(md).toContain('| Nights in London | 173 | 274 | −101 |');
    expect(md).toContain('| Nights in Istanbul | 176 | 91 | +85 |');
    expect(md).toContain('| Builds shipped | 2 |  |  |');
    expect(md).toContain('| Brier score | 0.348 |');
    for (const h of ['### Trips', '### Matches', '### Games played', '### Books', '### Builds shipped', '### Hours', '### Decisions']) expect(md).toContain(h);
    expect(md).toContain('| Lisbon | 1 Jul 2025 | 8 Jul 2025 | 7 |');
    expect(md).toContain('| 3 May 2025 | Eastfield Town | Away, Eastfield Park | League |');
    expect(md).toContain('| Lichess blitz | 7 | 5 | 0 | 2 | 1500 | 1515 |');
    expect(md).toContain('| Backgammon matches | 40 | 23 |');
    expect(md).toContain('| 30 Jun 2025 | Tide table | https://example.invalid/tide | Harmonic model \\| offline |');
    expect(md).toContain('| tide-table | 4 | 1 Jun 2025 | Yes |');
    expect(md).not.toContain('| idle |');
    expect(md).toContain('### 1. Where was I this year?\n\n_Record beside this question: trips._\n\nMostly on the ferry.\n\nSecond paragraph.\n');
    expect(md).toContain('### 6. What do I want next year?\n\n_Not answered yet._');
    expect(reviewFilename(record)).toBe('year-in-data-2025-03-10-to-2026-03-09.md');
  });
});

describe('small helpers', () => {
  it('reorders questions', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 2, 9)).toEqual(['a', 'b', 'c']);
    expect(move(['a'], 5, 0)).toEqual(['a']);
  });
  it('counts words', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  one  two\nthree ')).toBe(3);
  });
  it('knows which years hold something and how far back the records go', () => {
    expect(yearsWithContent(full)).toEqual([2026, 2025]);
    expect(yearsWithContent(BLANK)).toEqual([]);
    expect(earliestDate(full)).toBe('2024-01-05');
    expect(earliestDate(BLANK)).toBeNull();
  });
});
