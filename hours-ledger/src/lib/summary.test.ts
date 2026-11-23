import { describe, expect, it } from 'vitest';
import type { Category, Entry } from './model';
import {
  categorySentence,
  daySentence,
  firstWeek,
  hitTarget,
  indexByWeek,
  isWritten,
  rollup,
  streak,
  streakNote,
  summaryMarkdown,
  summaryPrompt,
  totalSentence,
  trendEndWeek,
  weekSummary,
  weeklySeries,
} from './summary';

const cats: Category[] = [
  { id: 'company', label: 'Company', color: 0, weeklyTargetHours: 20, targetKind: 'ceiling' },
  { id: 'masters', label: 'Masters', color: 1, weeklyTargetHours: 10 },
  { id: 'training', label: 'Training', color: 2, weeklyTargetHours: 2, targetKind: 'floor' },
  { id: 'builds', label: 'Builds', color: 3 },
];

let n = 0;
const e = (day: string, category: string, minutes: number): Entry => ({ id: `e${(n += 1)}`, day, category, minutes });

// The week under test: Mon 16 to Sun 22 Nov 2026 (ISO week 47).
//            company  masters  training  builds   day total
// Mon 16       240       90                         330
// Tue 17       300                                  300
// Wed 18       270      120       60                450
// Thu 19                180       90                270
// Fri 20       180                         120      300
// Sat, Sun   nothing
// total        990      390      150       120     1650
const WEEK = '2026-11-16';
const thisWeek = [
  e('2026-11-16', 'company', 240), e('2026-11-16', 'masters', 90),
  e('2026-11-17', 'company', 300),
  e('2026-11-18', 'company', 270), e('2026-11-18', 'masters', 120), e('2026-11-18', 'training', 60),
  e('2026-11-19', 'masters', 180), e('2026-11-19', 'training', 90),
  e('2026-11-20', 'company', 180), e('2026-11-20', 'builds', 120),
];
// Four earlier weeks, one lump each:
//            company  masters  training  builds   total
// 9 Nov        900      510      120        0     1530
// 2 Nov       1260      600      180        0     2040
// 26 Oct       600      300      120      240     1260
// 19 Oct       840      490        0       60     1390
// mean         900      475      105       75     1555
const earlier = [
  e('2026-11-09', 'company', 900), e('2026-11-11', 'masters', 510), e('2026-11-15', 'training', 120),
  e('2026-11-02', 'company', 1260), e('2026-11-03', 'masters', 600), e('2026-11-04', 'training', 180),
  e('2026-10-26', 'company', 600), e('2026-10-27', 'masters', 300), e('2026-10-28', 'training', 120), e('2026-11-01', 'builds', 240),
  e('2026-10-19', 'company', 840), e('2026-10-20', 'masters', 490), e('2026-10-25', 'builds', 60),
];
const all = [...thisWeek, ...earlier];
const s = weekSummary(all, cats, WEEK, '2026-11-22');
const row = (id: string) => s.categories.find((c) => c.id === id)!;

describe('week summary', () => {
  it('totals the week and labels it', () => {
    expect(s.totalMinutes).toBe(1650);
    expect([s.isoYear, s.isoWeek]).toEqual([2026, 47]);
    expect(s.categories.map((c) => [c.id, c.minutes])).toEqual([['company', 990], ['masters', 390], ['training', 150], ['builds', 120]]);
  });

  it('gives each category its share of the tracked total', () => {
    expect(row('company').share).toBeCloseTo(0.6, 10);
    expect(row('masters').share).toBeCloseTo(390 / 1650, 10);
    expect(s.categories.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 10);
  });

  it('totals each day and finds the longest and the empty ones', () => {
    expect(s.days.map((d) => d.total)).toEqual([330, 300, 450, 270, 300, 0, 0]);
    expect(s.days[2].byCategory).toEqual({ company: 270, masters: 120, training: 60 });
    expect(s.longestDay).toEqual({ day: '2026-11-18', minutes: 450 });
    expect(s.emptyDays).toEqual(['2026-11-21', '2026-11-22']);
  });

  it('does not call days that have not happened yet empty', () => {
    const midweek = weekSummary(thisWeek.filter((x) => x.day !== '2026-11-17'), cats, WEEK, '2026-11-19');
    expect(midweek.emptyDays).toEqual(['2026-11-17']);
  });

  it('compares with targets: floors and ceilings', () => {
    expect(row('masters')).toMatchObject({ targetMinutes: 600, targetKind: 'floor', vsTarget: -210, hit: false });
    expect(row('training')).toMatchObject({ targetMinutes: 120, vsTarget: 30, hit: true });
    expect(row('company')).toMatchObject({ targetMinutes: 1200, targetKind: 'ceiling', vsTarget: -210, hit: true });
    expect(row('builds')).toMatchObject({ targetMinutes: null, vsTarget: null, hit: null });
  });

  it('compares with last week and the 4-week average', () => {
    expect(row('masters')).toMatchObject({ prevMinutes: 510, deltaPrev: -120, avg4: 475, deltaAvg4: -85 });
    expect(row('company')).toMatchObject({ prevMinutes: 900, deltaPrev: 90, avg4: 900, deltaAvg4: 90 });
    expect(row('training')).toMatchObject({ prevMinutes: 120, deltaPrev: 30, avg4: 105, deltaAvg4: 45 });
    expect(row('builds')).toMatchObject({ prevMinutes: 0, deltaPrev: 120, avg4: 75, deltaAvg4: 45 });
    expect(s).toMatchObject({ prevTotal: 1530, deltaPrevTotal: 120, avg4Total: 1555, deltaAvg4Total: 95, avgWeeks: 4 });
  });

  it('counts streaks of weeks on target', () => {
    // Training (floor 2h): 150, 120, 180, 120 all reach it; 19 Oct has none.
    expect(row('training')).toMatchObject({ streak: 4, streakBefore: 3 });
    // Company (ceiling 20h): 990 and 900 are inside; 2 Nov at 1260 is over.
    expect(row('company')).toMatchObject({ streak: 2, streakBefore: 1 });
    // Masters (floor 10h): missed this week and last; the week of 2 Nov hit exactly 600.
    expect(row('masters')).toMatchObject({ streak: 0, streakBefore: 0 });
    expect(streak(indexByWeek(all), cats[1], '2026-11-02')).toBe(1);
    expect(row('builds')).toMatchObject({ streak: 0, streakBefore: 0 });
  });

  it('only looks back as far as the ledger goes', () => {
    // First week ever: nothing to compare with.
    const first = weekSummary(thisWeek, cats, WEEK, '2026-11-22');
    expect(first).toMatchObject({ prevTotal: null, deltaPrevTotal: null, avg4Total: null, avgWeeks: 0 });
    expect(first.categories[1]).toMatchObject({ prevMinutes: null, deltaPrev: null, avg4: null });
    // Two earlier weeks: the average is over those two, (1530 + 2040) / 2 = 1785.
    const three = weekSummary(all.filter((x) => x.day >= '2026-11-02'), cats, WEEK, '2026-11-22');
    expect(three).toMatchObject({ avgWeeks: 2, avg4Total: 1785, deltaAvg4Total: -135 });
    expect(three.categories[1].avg4).toBe(555);
  });

  it('counts a skipped week inside the ledger as zero', () => {
    // Only 19 Oct before this week: weeks of 9 Nov, 2 Nov, 26 Oct are zeros. Masters mean = 490 / 4 = 122.5.
    const gap = weekSummary([...thisWeek, ...earlier.filter((x) => x.day <= '2026-10-25')], cats, WEEK, '2026-11-22');
    expect(gap.avgWeeks).toBe(4);
    expect(gap.categories[1]).toMatchObject({ prevMinutes: 0, deltaPrev: 390, avg4: 122.5 });
  });

  it('handles an empty week', () => {
    const empty = weekSummary([], cats, WEEK, '2026-11-22');
    expect(empty.totalMinutes).toBe(0);
    expect(empty.longestDay).toBeNull();
    expect(empty.emptyDays).toHaveLength(7);
    expect(empty.categories.every((c) => c.share === 0)).toBe(true);
    expect(totalSentence(empty)).toBe('Nothing tracked this week.');
    expect(daySentence(empty)).toBe('');
  });

  it('shows archived categories only in weeks where they have time, and keeps orphaned entries', () => {
    const withArchived = cats.map((c) => (c.id === 'builds' ? { ...c, archived: true } : c));
    expect(weekSummary(all, withArchived, WEEK, '2026-11-22').categories.map((c) => c.id)).toContain('builds');
    expect(weekSummary(all, withArchived, '2026-11-09', '2026-11-22').categories.map((c) => c.id)).not.toContain('builds');
    const orphan = weekSummary([...thisWeek, e('2026-11-21', 'deleted', 30)], cats, WEEK, '2026-11-22');
    expect(orphan.totalMinutes).toBe(1680);
    expect(orphan.categories[4]).toMatchObject({ id: 'deleted', label: 'deleted', minutes: 30 });
  });
});

describe('targets', () => {
  it('needs some tracking in the week before a ceiling counts as kept', () => {
    expect(hitTarget(cats[0], 0, 0)).toBe(false);
    expect(hitTarget(cats[0], 0, 60)).toBe(true);
    expect(hitTarget(cats[0], 1200, 1200)).toBe(true);
    expect(hitTarget(cats[0], 1201, 1201)).toBe(false);
    expect(hitTarget(cats[1], 600, 600)).toBe(true);
    expect(hitTarget(cats[1], 599, 599)).toBe(false);
    expect(hitTarget(cats[3], 500, 500)).toBeNull();
  });

  it('stops a ceiling streak at an untracked week', () => {
    const idx = indexByWeek([e('2026-11-16', 'company', 600), e('2026-11-02', 'company', 600)]);
    expect(streak(idx, cats[0], '2026-11-16')).toBe(1);
  });

  it('does not loop forever on a zero-hour floor', () => {
    expect(streak(indexByWeek([]), { id: 'x', label: 'X', color: 0, weeklyTargetHours: 0 }, WEEK)).toBe(520);
  });
});

describe('sentences', () => {
  it('writes the category lines from the numbers', () => {
    expect(categorySentence(row('masters'), 4)).toBe('Masters: 6h 30m, 3h 30m under the 10h target, down 2h on last week, 1h 25m below the 4-week average.');
    expect(categorySentence(row('company'), 4)).toBe('Company: 16h 30m, 3h 30m inside the 20h ceiling, up 1h 30m on last week, 1h 30m above the 4-week average.');
    expect(categorySentence(row('training'), 4)).toBe('Training: 2h 30m, 30m over the 2h target, up 30m on last week, 45m above the 4-week average.');
    expect(categorySentence(row('builds'), 4)).toBe('Builds: 2h, up 2h on last week, 45m above the 4-week average.');
  });

  it('covers exact, over-ceiling and level cases', () => {
    const base = row('masters');
    expect(categorySentence({ ...base, minutes: 600, vsTarget: 0, deltaPrev: 0, deltaAvg4: 2 }, 4)).toBe(
      'Masters: 10h, right on the 10h target, level with last week, level with the 4-week average.',
    );
    expect(categorySentence({ ...row('company'), minutes: 1290, vsTarget: 90, deltaPrev: null, deltaAvg4: null }, 0)).toBe(
      'Company: 21h 30m, 1h 30m over the 20h ceiling.',
    );
    expect(categorySentence({ ...row('company'), minutes: 1200, vsTarget: 0, deltaPrev: null, deltaAvg4: null }, 0)).toBe(
      'Company: 20h, right at the 20h ceiling.',
    );
  });

  it('names a shorter average honestly and skips it when it is just last week', () => {
    expect(categorySentence({ ...row('builds'), deltaAvg4: 45 }, 3)).toBe('Builds: 2h, up 2h on last week, 45m above the 3-week average.');
    expect(categorySentence(row('builds'), 1)).toBe('Builds: 2h, up 2h on last week.');
  });

  it('writes the total, the day line and streak notes', () => {
    expect(totalSentence(s)).toBe('27h 30m tracked, up 2h on last week, 1h 35m above the 4-week average.');
    expect(totalSentence(weekSummary(thisWeek, cats, WEEK, '2026-11-22'))).toBe('27h 30m tracked, the first week in the ledger.');
    expect(daySentence(s)).toBe('Longest day: Wednesday, 7h 30m. Nothing logged on Saturday and Sunday.');
    expect(streakNote(row('training'))).toBe('4 weeks on target in a row');
    expect(streakNote(row('company'))).toBe('2 weeks inside the ceiling in a row');
    expect(streakNote(row('masters'))).toBeNull();
    expect(streakNote(row('builds'))).toBeNull();
    expect(streakNote({ ...row('training'), streak: 0, streakBefore: 3 })).toBe('ends a run of 3 weeks');
  });

  it('says so when every day has something', () => {
    const full = weekSummary([...thisWeek, e('2026-11-21', 'training', 60), e('2026-11-22', 'builds', 30)], cats, WEEK, '2026-11-22');
    expect(daySentence(full)).toBe('Longest day: Wednesday, 7h 30m. Something logged every day.');
  });
});

describe('markdown', () => {
  it('produces the whole summary as text', () => {
    const md = summaryMarkdown(s, { went: 'Company stayed inside its box.', leaked: '', change: 'Two Masters mornings.\nBefore email.' });
    expect(md).toBe(
      [
        '# Hours: Week 47, 16–22 Nov 2026',
        '',
        '**27h 30m tracked, up 2h on last week, 1h 35m above the 4-week average.**',
        '',
        '| Category | Hours | Share | Target |',
        '| --- | ---: | ---: | --- |',
        '| Company | 16h 30m | 60% | at most 20h: met |',
        '| Masters | 6h 30m | 24% | at least 10h: missed |',
        '| Training | 2h 30m | 9% | at least 2h: met |',
        '| Builds | 2h | 7% |  |',
        '',
        '- Company: 16h 30m, 3h 30m inside the 20h ceiling, up 1h 30m on last week, 1h 30m above the 4-week average. 2 weeks inside the ceiling in a row.',
        '- Masters: 6h 30m, 3h 30m under the 10h target, down 2h on last week, 1h 25m below the 4-week average.',
        '- Training: 2h 30m, 30m over the 2h target, up 30m on last week, 45m above the 4-week average. 4 weeks on target in a row.',
        '- Builds: 2h, up 2h on last week, 45m above the 4-week average.',
        '',
        'By day: Mon 5h 30m · Tue 5h · Wed 7h 30m · Thu 4h 30m · Fri 5h · Sat – · Sun –',
        '',
        'Longest day: Wednesday, 7h 30m. Nothing logged on Saturday and Sunday.',
        '',
        '## What went where it should',
        '',
        'Company stayed inside its box.',
        '',
        '## What leaked',
        '',
        '_Not written yet._',
        '',
        '## One change for next week',
        '',
        'Two Masters mornings.',
        'Before email.',
        '',
      ].join('\n'),
    );
  });

  it('keeps an empty week short', () => {
    const md = summaryMarkdown(weekSummary([], cats, WEEK, '2026-11-22'), undefined);
    expect(md).toContain('**Nothing tracked this week.**');
    expect(md).not.toContain('| Category |');
    expect(md).toContain('## What leaked');
  });
});

describe('roll-ups', () => {
  it('lists the last weeks oldest first, with empty weeks as zero', () => {
    const series = weeklySeries(all, WEEK, 6);
    expect(series.map((p) => p.weekStart)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    expect(series.map((p) => p.total)).toEqual([0, 1390, 1260, 2040, 1530, 1650]);
    expect(series[2].byCategory).toEqual({ company: 600, masters: 300, training: 120, builds: 240 });
    expect(firstWeek(all)).toBe('2026-10-19');
    expect(firstWeek([])).toBeNull();
  });

  it('ends the trend charts on the last finished week, or on this one on its Sunday', () => {
    expect(trendEndWeek('2026-11-23')).toBe('2026-11-16'); // Monday
    expect(trendEndWeek('2026-11-28')).toBe('2026-11-16'); // Saturday
    expect(trendEndWeek('2026-11-29')).toBe('2026-11-23'); // Sunday
  });

  it('rolls up by calendar month, by the day of each entry', () => {
    // October: 19 Oct week (1390) + 26, 27, 28 Oct (600 + 300 + 120 = 1020) = 2410.
    // The 240 of builds on 1 Nov belongs to November even though its week began in October.
    const months = rollup(all, 'month');
    expect(months.map((m) => [m.key, m.total])).toEqual([['2026-11', 1650 + 1530 + 2040 + 240], ['2026-10', 2410]]);
    expect(months[1].byCategory).toEqual({ company: 1440, masters: 790, training: 120, builds: 60 });
  });

  it('rolls up by quarter', () => {
    const quarters = rollup([...all, e('2026-09-30', 'masters', 60), e('2027-01-01', 'masters', 30)], 'quarter');
    expect(quarters.map((q) => [q.key, q.total])).toEqual([['2027-Q1', 30], ['2026-Q4', 7870], ['2026-Q3', 60]]);
    expect(rollup([], 'month')).toEqual([]);
  });
});

describe('summary prompt on the Today tab', () => {
  const blank = { went: '', leaked: '  ', change: '' };
  const written = { went: 'ok', leaked: '', change: '' };

  it('knows a written reflection from a blank one', () => {
    expect(isWritten(undefined)).toBe(false);
    expect(isWritten(blank)).toBe(false);
    expect(isWritten(written)).toBe(true);
  });

  it('points at this week on a Sunday until it is written', () => {
    expect(summaryPrompt(all, {}, '2026-11-22')).toEqual({ week: '2026-11-16', when: 'sunday' });
    expect(summaryPrompt([], {}, '2026-11-22')).toEqual({ week: '2026-11-16', when: 'sunday' });
    expect(summaryPrompt(all, { '2026-11-16': written }, '2026-11-22')).toBeNull();
  });

  it('points at last week on a Monday if it has entries and is unwritten', () => {
    expect(summaryPrompt(all, {}, '2026-11-23')).toEqual({ week: '2026-11-16', when: 'monday' });
    expect(summaryPrompt(all, { '2026-11-16': blank }, '2026-11-23')).toEqual({ week: '2026-11-16', when: 'monday' });
    expect(summaryPrompt(all, { '2026-11-16': written }, '2026-11-23')).toBeNull();
    expect(summaryPrompt(earlier.filter((x) => x.day < '2026-11-09'), {}, '2026-11-23')).toBeNull(); // nothing logged last week
  });

  it('stays quiet midweek', () => {
    expect(summaryPrompt(all, {}, '2026-11-18')).toBeNull();
    expect(summaryPrompt(all, {}, '2026-11-24')).toBeNull();
  });
});
