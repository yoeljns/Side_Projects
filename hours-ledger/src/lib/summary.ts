// Week summaries, streaks, roll-ups, and the sentences and markdown built from
// them. Pure: everything is a function of the entries, the categories and the
// dates passed in.
import {
  addDays,
  fmtDur,
  fmtWeekRange,
  isoWeek,
  monthKey,
  quarterKey,
  weekDays,
  weekStart,
  weekdayName,
  weekdayShort,
  type Day,
} from './dates';
import type { Category, Entry, Reflection } from './model';

export type MinutesByCategory = Record<string, number>;

/** week start → category id → minutes */
export type WeekIndex = Map<Day, MinutesByCategory>;

export function indexByWeek(entries: Entry[]): WeekIndex {
  const idx: WeekIndex = new Map();
  for (const e of entries) {
    const w = weekStart(e.day);
    const row = idx.get(w) ?? {};
    row[e.category] = (row[e.category] ?? 0) + e.minutes;
    idx.set(w, row);
  }
  return idx;
}

const sum = (row: MinutesByCategory | undefined): number => Object.values(row ?? {}).reduce((a, b) => a + b, 0);

/** The Monday of the week holding the earliest entry, or null with no entries. */
export function firstWeek(entries: Entry[]): Day | null {
  let min: Day | null = null;
  for (const e of entries) if (min === null || e.day < min) min = e.day;
  return min ? weekStart(min) : null;
}

/**
 * Did `minutes` meet the target? Null without a target. A ceiling only counts
 * as kept in a week where something was tracked at all (`weekTotal` > 0), so
 * weeks the ledger was not used do not look like discipline.
 */
export function hitTarget(cat: Category, minutes: number, weekTotal: number): boolean | null {
  if (cat.weeklyTargetHours === undefined) return null;
  const target = cat.weeklyTargetHours * 60;
  if (cat.targetKind === 'ceiling') return weekTotal > 0 && minutes <= target;
  return minutes >= target;
}

/** Consecutive weeks, ending with `week` itself, in which the category met its target. */
export function streak(idx: WeekIndex, cat: Category, week: Day): number {
  if (cat.weeklyTargetHours === undefined) return 0;
  let n = 0;
  // 520 weeks is a safety stop: a floor of 0 hours is met in every week back to the dawn of time.
  for (let w = week; n < 520; w = addDays(w, -7)) {
    const row = idx.get(w);
    if (!hitTarget(cat, row?.[cat.id] ?? 0, sum(row))) break;
    n += 1;
  }
  return n;
}

export interface CategoryRow {
  id: string;
  label: string;
  color: number;
  minutes: number;
  /** Share of the week's tracked total, 0..1. */
  share: number;
  targetMinutes: number | null;
  targetKind: 'floor' | 'ceiling';
  /** minutes − target; null without a target. */
  vsTarget: number | null;
  hit: boolean | null;
  /** Null when there is no earlier week to compare with. */
  prevMinutes: number | null;
  deltaPrev: number | null;
  avg4: number | null;
  deltaAvg4: number | null;
  /** Consecutive weeks on target ending with this week, and ending with the week before. */
  streak: number;
  streakBefore: number;
}

export interface DayRow {
  day: Day;
  total: number;
  byCategory: MinutesByCategory;
}

export interface WeekSummary {
  weekStart: Day;
  isoYear: number;
  isoWeek: number;
  totalMinutes: number;
  prevTotal: number | null;
  deltaPrevTotal: number | null;
  avg4Total: number | null;
  deltaAvg4Total: number | null;
  /** How many earlier weeks the average covers (1..4), 0 when there are none. */
  avgWeeks: number;
  categories: CategoryRow[];
  days: DayRow[];
  /** The day with the most tracked time (the earliest on a tie); null in an empty week. */
  longestDay: { day: Day; minutes: number } | null;
  /** Days with nothing logged, leaving out days after `today`. */
  emptyDays: Day[];
}

/**
 * Everything the Sunday page shows for the week starting on `week` (a Monday).
 * Comparisons look back only as far as the first week that has any entry: the
 * "4-week average" is the mean of up to four preceding weeks inside that span,
 * counting weeks with nothing logged as zero.
 */
export function weekSummary(entries: Entry[], cats: Category[], week: Day, today: Day): WeekSummary {
  const idx = indexByWeek(entries);
  const first = firstWeek(entries);
  const row = idx.get(week) ?? {};
  const total = sum(row);

  const earlier: Day[] = [];
  for (let k = 1; k <= 4; k += 1) {
    const w = addDays(week, -7 * k);
    if (first !== null && w >= first) earlier.push(w);
  }
  const hasPrev = earlier.length > 0;
  const avgOf = (pick: (r: MinutesByCategory | undefined) => number): number | null =>
    hasPrev ? earlier.reduce((a, w) => a + pick(idx.get(w)), 0) / earlier.length : null;

  const known = new Set(cats.map((c) => c.id));
  const shown: Category[] = [
    ...cats.filter((c) => !c.archived || (row[c.id] ?? 0) > 0),
    // Entries whose category no longer exists still count; they show under their id.
    ...Object.keys(row).filter((id) => !known.has(id)).sort().map((id) => ({ id, label: id, color: 7 })),
  ];

  const categories: CategoryRow[] = shown.map((c) => {
    const minutes = row[c.id] ?? 0;
    const targetMinutes = c.weeklyTargetHours === undefined ? null : c.weeklyTargetHours * 60;
    const prevMinutes = hasPrev ? idx.get(earlier[0])?.[c.id] ?? 0 : null;
    const avg4 = avgOf((r) => r?.[c.id] ?? 0);
    return {
      id: c.id,
      label: c.label,
      color: c.color,
      minutes,
      share: total > 0 ? minutes / total : 0,
      targetMinutes,
      targetKind: c.targetKind ?? 'floor',
      vsTarget: targetMinutes === null ? null : minutes - targetMinutes,
      hit: hitTarget(c, minutes, total),
      prevMinutes,
      deltaPrev: prevMinutes === null ? null : minutes - prevMinutes,
      avg4,
      deltaAvg4: avg4 === null ? null : minutes - avg4,
      streak: streak(idx, c, week),
      streakBefore: streak(idx, c, addDays(week, -7)),
    };
  });

  const days: DayRow[] = weekDays(week).map((day) => ({ day, total: 0, byCategory: {} }));
  for (const e of entries) {
    if (e.day < week || e.day > days[6].day) continue;
    const d = days[(Date.parse(`${e.day}T00:00:00Z`) - Date.parse(`${week}T00:00:00Z`)) / 86_400_000];
    d.total += e.minutes;
    d.byCategory[e.category] = (d.byCategory[e.category] ?? 0) + e.minutes;
  }
  let longestDay: WeekSummary['longestDay'] = null;
  for (const d of days) if (d.total > 0 && (longestDay === null || d.total > longestDay.minutes)) longestDay = { day: d.day, minutes: d.total };

  const prevTotal = hasPrev ? sum(idx.get(earlier[0])) : null;
  const avg4Total = avgOf(sum);
  const iso = isoWeek(week);
  return {
    weekStart: week,
    isoYear: iso.year,
    isoWeek: iso.week,
    totalMinutes: total,
    prevTotal,
    deltaPrevTotal: prevTotal === null ? null : total - prevTotal,
    avg4Total,
    deltaAvg4Total: avg4Total === null ? null : total - avg4Total,
    avgWeeks: earlier.length,
    categories,
    days,
    longestDay,
    emptyDays: days.filter((d) => d.total === 0 && d.day <= today).map((d) => d.day),
  };
}

// ---------------------------------------------------------------- roll-ups

export interface SeriesPoint {
  weekStart: Day;
  total: number;
  byCategory: MinutesByCategory;
}

/** The `count` weeks ending with `endWeek`, oldest first. */
export function weeklySeries(entries: Entry[], endWeek: Day, count: number): SeriesPoint[] {
  const idx = indexByWeek(entries);
  return Array.from({ length: count }, (_, i) => {
    const w = addDays(endWeek, -7 * (count - 1 - i));
    const byCategory = idx.get(w) ?? {};
    return { weekStart: w, total: sum(byCategory), byCategory };
  });
}

/**
 * The last week the trend charts should show: the current week only on its
 * Sunday, otherwise the week before, so a half-finished week never reads as a
 * collapse.
 */
export const trendEndWeek = (today: Day): Day => (addDays(weekStart(today), 6) === today ? weekStart(today) : addDays(weekStart(today), -7));

export interface PeriodRow {
  /** '2026-11' or '2026-Q4' */
  key: string;
  total: number;
  byCategory: MinutesByCategory;
}

/** Totals by calendar month or quarter of the entry's own day, newest first. Empty periods are left out. */
export function rollup(entries: Entry[], by: 'month' | 'quarter'): PeriodRow[] {
  const keyOf = by === 'month' ? monthKey : quarterKey;
  const map = new Map<string, PeriodRow>();
  for (const e of entries) {
    const key = keyOf(e.day);
    const r = map.get(key) ?? { key, total: 0, byCategory: {} };
    r.total += e.minutes;
    r.byCategory[e.category] = (r.byCategory[e.category] ?? 0) + e.minutes;
    map.set(key, r);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

// ---------------------------------------------------------------- sentences

/** Differences under 2.5 minutes are called level: the average is a fraction and timers round to 5. */
const roundDelta = (d: number) => Math.round(d / 5) * 5;

function vsPrev(delta: number | null): string | null {
  if (delta === null) return null;
  const d = roundDelta(delta);
  if (d === 0) return 'level with last week';
  return `${d > 0 ? 'up' : 'down'} ${fmtDur(d)} on last week`;
}

function vsAvg(delta: number | null, weeks: number): string | null {
  if (delta === null) return null;
  if (weeks === 1) return null; // the same number as "last week"; do not say it twice
  const name = `the ${weeks}-week average`;
  const d = roundDelta(delta);
  if (d === 0) return `level with ${name}`;
  return `${fmtDur(d)} ${d > 0 ? 'above' : 'below'} ${name}`;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function targetClause(r: CategoryRow): string | null {
  if (r.targetMinutes === null || r.vsTarget === null) return null;
  const t = fmtDur(r.targetMinutes);
  if (r.targetKind === 'ceiling') {
    if (r.vsTarget > 0) return `${fmtDur(r.vsTarget)} over the ${t} ceiling`;
    if (r.vsTarget === 0) return `right at the ${t} ceiling`;
    return `${fmtDur(r.vsTarget)} inside the ${t} ceiling`;
  }
  if (r.vsTarget === 0) return `right on the ${t} target`;
  return `${fmtDur(r.vsTarget)} ${r.vsTarget > 0 ? 'over' : 'under'} the ${t} target`;
}

/** The comparisons alone: "3h 30m under the 10h target, down 2h on last week, 1h below the 4-week average". */
export function categoryClauses(r: CategoryRow, avgWeeks: number): string {
  return [targetClause(r), vsPrev(r.deltaPrev), vsAvg(r.deltaAvg4, avgWeeks)].filter(Boolean).join(', ');
}

/** "Masters: 6h 30m, 3h 30m under the 10h target, down 2h on last week, 1h below the 4-week average." */
export function categorySentence(r: CategoryRow, avgWeeks: number): string {
  const clauses = categoryClauses(r, avgWeeks);
  return `${r.label}: ${fmtDur(r.minutes)}${clauses ? `, ${clauses}` : ''}.`;
}

/** "3 weeks on target in a row", or null when there is nothing to say. */
export function streakNote(r: CategoryRow): string | null {
  if (r.targetMinutes === null) return null;
  if (r.streak >= 2) return `${plural(r.streak, 'week')} ${r.targetKind === 'ceiling' ? 'inside the ceiling' : 'on target'} in a row`;
  if (r.streak === 0 && r.streakBefore >= 2) return `ends a run of ${plural(r.streakBefore, 'week')}`;
  return null;
}

export function totalSentence(s: WeekSummary): string {
  if (s.totalMinutes === 0) return 'Nothing tracked this week.';
  const parts = [`${fmtDur(s.totalMinutes)} tracked`, vsPrev(s.deltaPrevTotal), vsAvg(s.deltaAvg4Total, s.avgWeeks)].filter(Boolean);
  const text = parts.join(', ');
  return `${text}${s.prevTotal === null ? ', the first week in the ledger' : ''}.`;
}

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Longest day: Wednesday, 7h 30m. Nothing logged on Saturday and Sunday." */
export function daySentence(s: WeekSummary): string {
  if (!s.longestDay) return '';
  const longest = `Longest day: ${weekdayName(s.longestDay.day)}, ${fmtDur(s.longestDay.minutes)}.`;
  const empty = s.emptyDays.length === 0 ? 'Something logged every day.' : `Nothing logged on ${andList(s.emptyDays.map(weekdayName))}.`;
  return `${longest} ${empty}`;
}

export const weekTitle = (s: WeekSummary): string => `Week ${s.isoWeek}, ${fmtWeekRange(s.weekStart)}`;

export const PROMPTS: { key: keyof Reflection; label: string }[] = [
  { key: 'went', label: 'What went where it should' },
  { key: 'leaked', label: 'What leaked' },
  { key: 'change', label: 'One change for next week' },
];

/** The Sunday page as markdown, for pasting into a notes vault. */
export function summaryMarkdown(s: WeekSummary, reflection: Reflection | undefined): string {
  const lines: string[] = [`# Hours: ${weekTitle(s)}`, '', `**${totalSentence(s)}**`, ''];
  if (s.totalMinutes > 0) {
    lines.push('| Category | Hours | Share | Target |', '| --- | ---: | ---: | --- |');
    for (const r of s.categories) {
      const target =
        r.targetMinutes === null ? '' : `${r.targetKind === 'ceiling' ? 'at most' : 'at least'} ${fmtDur(r.targetMinutes)}: ${r.hit ? 'met' : 'missed'}`;
      lines.push(`| ${r.label} | ${fmtDur(r.minutes)} | ${pct(r.share)} | ${target} |`);
    }
    lines.push('');
    for (const r of s.categories) {
      const note = streakNote(r);
      lines.push(`- ${categorySentence(r, s.avgWeeks)}${note ? ` ${note[0].toUpperCase()}${note.slice(1)}.` : ''}`);
    }
    lines.push('', `By day: ${s.days.map((d) => `${weekdayShort(d.day)} ${d.total > 0 ? fmtDur(d.total) : '–'}`).join(' · ')}`, '', daySentence(s), '');
  }
  for (const p of PROMPTS) {
    lines.push(`## ${p.label}`, '', reflection?.[p.key]?.trim() || '_Not written yet._', '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** True when any of the three boxes has text. */
export const isWritten = (r: Reflection | undefined): boolean =>
  Boolean(r && (r.went.trim() || r.leaked.trim() || r.change.trim()));

/**
 * Which week's summary the Today tab should nudge towards, if any: this week's
 * on a Sunday, last week's on a Monday when that week has entries and nothing
 * has been written for it.
 */
export function summaryPrompt(entries: Entry[], reflections: Record<Day, Reflection>, today: Day): { week: Day; when: 'sunday' | 'monday' } | null {
  const thisWeek = weekStart(today);
  if (addDays(thisWeek, 6) === today) return isWritten(reflections[thisWeek]) ? null : { week: thisWeek, when: 'sunday' };
  if (thisWeek === today) {
    const last = addDays(thisWeek, -7);
    const used = entries.some((e) => e.day >= last && e.day < thisWeek);
    if (used && !isWritten(reflections[last])) return { week: last, when: 'monday' };
  }
  return null;
}
