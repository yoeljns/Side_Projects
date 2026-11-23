// Day counts. Stays in, day-by-day presence per country out, measured against
// editable rules. Pure: `today` is always passed in.
//
// Conventions
//   'midnights': a day counts if you are in the country at the end of it, so the
//                arrival day counts and the departure day does not.
//   'any-part' : a day counts if you are there for any part of it, so arrival
//                and departure days both count.
// An open-ended stay (depart: null) is counted up to today only: the app does
// not guess how long you will stay.
import { addDays, daysBetween, maxDay, minDay } from './dates.ts';
import type { Day } from './dates.ts';

export interface Stay {
  id: string;
  city: string;
  /** ISO-2 country code. */
  country: string;
  arrive: Day;
  depart: Day | null;
  source: 'manual' | 'ics' | 'email';
  note?: string;
}

export type Convention = 'midnights' | 'any-part';
export type Period = { kind: 'uk-tax-year' } | { kind: 'calendar-year' } | { kind: 'rolling'; windowDays: number };

export interface Rule {
  id: string;
  label: string;
  /** One country, or a group counted together (e.g. the Schengen states). */
  countries: string[];
  convention: Convention;
  period: Period;
  /** The most days you allow yourself. null = not set: count only. */
  limit: number | null;
}

export type Span = [Day, Day];

export const sortStays = (stays: Stay[]): Stay[] => [...stays].sort((a, b) => a.arrive.localeCompare(b.arrive) || a.id.localeCompare(b.id));

/** The last day a stay counts under a convention, or null when it counts no day at all. */
export function lastCountedDay(stay: Stay, convention: Convention, today: Day): Day | null {
  if (stay.depart === null) return maxDay(today, stay.arrive);
  const last = convention === 'any-part' ? stay.depart : addDays(stay.depart, -1);
  return last < stay.arrive ? null : last;
}

/** Merged, sorted spans of counted days for a set of countries. */
export function countedSpans(stays: Stay[], countries: string[], convention: Convention, today: Day): Span[] {
  const raw: Span[] = [];
  for (const s of stays) {
    if (!countries.includes(s.country)) continue;
    const last = lastCountedDay(s, convention, today);
    if (last) raw.push([s.arrive, last]);
  }
  raw.sort((a, b) => a[0].localeCompare(b[0]));
  const out: Span[] = [];
  for (const [from, to] of raw) {
    const prev = out[out.length - 1];
    if (prev && from <= addDays(prev[1], 1)) prev[1] = maxDay(prev[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** Counted days falling inside [from, to]. */
export function countIn(spans: Span[], from: Day, to: Day): number {
  let n = 0;
  for (const [a, b] of spans) {
    const lo = maxDay(a, from);
    const hi = minDay(b, to);
    if (lo <= hi) n += daysBetween(lo, hi) + 1;
  }
  return n;
}

/** UK tax year containing a day: 6 April to 5 April. */
export function ukTaxYear(day: Day): Span {
  const y = Number(day.slice(0, 4));
  const start = day >= `${y}-04-06` ? y : y - 1;
  return [`${start}-04-06`, `${start + 1}-04-05`];
}

export function periodFor(period: Period, day: Day): Span | null {
  if (period.kind === 'uk-tax-year') return ukTaxYear(day);
  if (period.kind === 'calendar-year') return [`${day.slice(0, 4)}-01-01`, `${day.slice(0, 4)}-12-31`];
  return null;
}

export function periodLabel(rule: Rule, span: Span | null): string {
  if (rule.period.kind === 'rolling') return `any ${rule.period.windowDays} days`;
  if (!span) return '';
  if (rule.period.kind === 'calendar-year') return span[0].slice(0, 4);
  return `tax year ${span[0].slice(0, 4)}/${span[1].slice(2, 4)}`;
}

/** Highest count in any window of `windowDays` ending on a day in [from, to]. */
export function peakWindow(spans: Span[], windowDays: number, from: Day, to: Day): { count: number; on: Day } {
  let best = { count: -1, on: from };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = countIn(spans, addDays(d, 1 - windowDays), d);
    if (c > best.count) best = { count: c, on: d };
  }
  return best;
}

export interface RuleStatus {
  rule: Rule;
  /** The fixed period measured, or null for a rolling window. */
  period: Span | null;
  /** Counted days up to and including today (rolling: in the window ending today). */
  used: number;
  /** Counted days after today (fixed: inside the period; rolling: all booked). */
  booked: number;
  /** used + booked for a fixed period; for a rolling rule, the fullest window from today onward. */
  peak: number;
  peakOn: Day | null;
  remaining: number | null;
  breached: boolean;
  /** True when a counted stay has no departure date, so the count runs to today only. */
  openEnded: boolean;
}

const lastEnd = (spans: Span[], fallback: Day): Day => spans.reduce((m, s) => maxDay(m, s[1]), fallback);

/** One rule measured for the period containing `on` (defaults to today). */
export function evaluateRule(rule: Rule, stays: Stay[], today: Day, on: Day = today): RuleStatus {
  const spans = countedSpans(stays, rule.countries, rule.convention, today);
  const openEnded = stays.some((s) => s.depart === null && rule.countries.includes(s.country));
  const period = periodFor(rule.period, on);
  if (period) {
    const used = countIn(spans, period[0], minDay(today, period[1]));
    const booked = countIn(spans, maxDay(period[0], addDays(today, 1)), period[1]);
    const peak = used + booked;
    const remaining = rule.limit === null ? null : rule.limit - peak;
    return { rule, period, used, booked, peak, peakOn: null, remaining, breached: remaining !== null && remaining < 0, openEnded };
  }
  const w = rule.period.kind === 'rolling' ? Math.max(1, rule.period.windowDays) : 1;
  const used = countIn(spans, addDays(today, 1 - w), today);
  const booked = countIn(spans, addDays(today, 1), '9999-12-31');
  const peak = peakWindow(spans, w, today, lastEnd(spans, today));
  const remaining = rule.limit === null ? null : rule.limit - peak.count;
  return { rule, period: null, used, booked, peak: peak.count, peakOn: peak.on, remaining, breached: remaining !== null && remaining < 0, openEnded };
}

/** Every rule for its current period, plus any later fixed period that already has booked days. */
export function evaluateAll(rules: Rule[], stays: Stay[], today: Day): RuleStatus[] {
  const out: RuleStatus[] = [];
  for (const rule of rules) {
    const now = evaluateRule(rule, stays, today);
    out.push(now);
    if (!now.period) continue;
    const horizon = lastEnd(countedSpans(stays, rule.countries, rule.convention, today), today);
    let next = addDays(now.period[1], 1);
    for (let i = 0; i < 5 && next <= horizon; i++) {
      const st = evaluateRule(rule, stays, today, next);
      if (st.booked > 0) out.push(st);
      next = addDays(st.period![1], 1);
    }
  }
  return out;
}

export const statusKey = (s: RuleStatus): string => `${s.rule.id}|${s.period ? s.period[0] : 'rolling'}`;

// ---------------------------------------------------------------- planned stays

export interface OutlookRow {
  ruleId: string;
  label: string;
  period: Span | null;
  /** Days counted under the rule by the end of this stay (rolling: fullest window during it). */
  countAtEnd: number;
  remainingAtEnd: number | null;
  /** Latest departure date before the limit is passed, everything else unchanged. */
  extendTo: Day | null;
  /** Why the search stopped: the limit, the next booked stay, or neither within three years. */
  extendStop: 'limit' | 'next-stay' | 'open' | null;
  breach: boolean;
}

export interface StayOutlook {
  stayId: string;
  rows: OutlookRow[];
  breach: boolean;
}

const EXTEND_HORIZON = 3 * 366;

function withinLimit(rule: Rule, stays: Stay[], stay: Stay, depart: Day, today: Day): boolean {
  if (rule.limit === null) return true;
  const changed = stays.map((s) => (s.id === stay.id ? { ...s, depart } : s));
  const spans = countedSpans(changed, rule.countries, rule.convention, today);
  if (rule.period.kind === 'rolling') {
    const w = Math.max(1, rule.period.windowDays);
    return peakWindow(spans, w, stay.arrive, addDays(depart, w)).count <= rule.limit;
  }
  let p = periodFor(rule.period, stay.arrive)!;
  for (;;) {
    if (countIn(spans, p[0], p[1]) > rule.limit) return false;
    if (p[1] >= depart) return true;
    p = periodFor(rule.period, addDays(p[1], 1))!;
  }
}

/** What is left under each applicable rule when a stay ends, and how far it could be extended. */
export function stayOutlook(stay: Stay, stays: Stay[], rules: Rule[], today: Day): StayOutlook {
  const rows: OutlookRow[] = [];
  const end = stay.depart ?? maxDay(stay.arrive, today);
  const nextArrive = stays
    .filter((s) => s.id !== stay.id && s.arrive > stay.arrive && s.arrive >= end)
    .reduce<Day | null>((m, s) => (m === null || s.arrive < m ? s.arrive : m), null);
  for (const rule of rules) {
    if (!rule.countries.includes(stay.country)) continue;
    const spans = countedSpans(stays, rule.countries, rule.convention, today);

    // Extension: binary search on the departure date (counts only grow as it moves out).
    let extendTo: Day | null = null;
    let extendStop: OutlookRow['extendStop'] = null;
    if (rule.limit !== null && withinLimit(rule, stays, stay, end, today)) {
      const cap = nextArrive ?? addDays(stay.arrive, EXTEND_HORIZON);
      let lo = 0;
      let hi = Math.max(0, daysBetween(end, cap));
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (withinLimit(rule, stays, stay, addDays(end, mid), today)) lo = mid;
        else hi = mid - 1;
      }
      extendTo = addDays(end, lo);
      extendStop = extendTo < cap ? 'limit' : nextArrive ? 'next-stay' : 'open';
    }

    const push = (period: Span | null, countAtEnd: number, breachNow: boolean) => {
      const remainingAtEnd = rule.limit === null ? null : rule.limit - countAtEnd;
      rows.push({ ruleId: rule.id, label: rule.label, period, countAtEnd, remainingAtEnd, extendTo, extendStop, breach: breachNow });
    };
    if (rule.period.kind === 'rolling') {
      const c = peakWindow(spans, Math.max(1, rule.period.windowDays), stay.arrive, end).count;
      push(null, c, rule.limit !== null && c > rule.limit);
    } else {
      let p = periodFor(rule.period, stay.arrive)!;
      for (;;) {
        const c = countIn(spans, p[0], minDay(end, p[1]));
        push(p, c, rule.limit !== null && c > rule.limit);
        if (p[1] >= end) break;
        p = periodFor(rule.period, addDays(p[1], 1))!;
      }
    }
  }
  return { stayId: stay.id, rows, breach: rows.some((r) => r.breach) };
}

/** Stays that have not finished yet: under way or still to come. */
export const plannedStays = (stays: Stay[], today: Day): Stay[] => sortStays(stays).filter((s) => s.depart === null || s.depart > today);

// ---------------------------------------------------------------- what-if

export interface Move {
  stayId: string;
  edge: 'arrive' | 'depart';
  to: Day;
}

/**
 * Move one flight. A flight is the boundary between two stays, so when the
 * neighbouring stay starts (or ends) on the same date it moves too.
 */
export function moveBoundary(stays: Stay[], move: Move): { stays: Stay[]; error: string | null } {
  const target = stays.find((s) => s.id === move.stayId);
  if (!target) return { stays, error: 'That stay no longer exists.' };
  const from = move.edge === 'arrive' ? target.arrive : target.depart;
  if (from === null) return { stays, error: 'This stay has no departure flight yet.' };
  const neighbour = stays.find((s) => s.id !== target.id && (move.edge === 'arrive' ? s.depart === from && s.arrive <= from : s.arrive === from && (s.depart === null || s.depart >= from)));
  const next = stays.map((s) => {
    if (s.id === target.id) return move.edge === 'arrive' ? { ...s, arrive: move.to } : { ...s, depart: move.to };
    if (neighbour && s.id === neighbour.id) return move.edge === 'arrive' ? { ...s, depart: move.to } : { ...s, arrive: move.to };
    return s;
  });
  const bad = next.find((s) => s.depart !== null && s.depart < s.arrive);
  if (bad) return { stays, error: `That would make the ${bad.city} stay end before it starts.` };
  return { stays: next, error: null };
}

export interface WhatIf {
  error: string | null;
  after: Stay[];
  rules: { key: string; before: RuleStatus | null; after: RuleStatus | null }[];
  stays: { stay: Stay; before: StayOutlook | null; after: StayOutlook }[];
}

/** Before and after for every rule and every planned stay, without saving anything. */
export function whatIf(stays: Stay[], rules: Rule[], today: Day, move: Move): WhatIf {
  const moved = moveBoundary(stays, move);
  if (moved.error) return { error: moved.error, after: stays, rules: [], stays: [] };
  const before = evaluateAll(rules, stays, today);
  const after = evaluateAll(rules, moved.stays, today);
  const keys = [...new Set([...before, ...after].map(statusKey))];
  return {
    error: null,
    after: moved.stays,
    rules: keys.map((key) => ({ key, before: before.find((s) => statusKey(s) === key) ?? null, after: after.find((s) => statusKey(s) === key) ?? null })),
    stays: plannedStays(moved.stays, today).map((stay) => {
      const old = stays.find((s) => s.id === stay.id);
      return { stay, before: old ? stayOutlook(old, stays, rules, today) : null, after: stayOutlook(stay, moved.stays, rules, today) };
    }),
  };
}

// ---------------------------------------------------------------- day table

export interface DayRow {
  date: Day;
  cities: string[];
  /** Countries you are in for any part of the day. */
  countries: string[];
  /** Country you are in at the end of the day, if known. */
  midnight: string | null;
}

export function dayTable(stays: Stay[], from: Day, to: Day, today: Day): DayRow[] {
  const sorted = sortStays(stays);
  const rows: DayRow[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const here = sorted.filter((s) => s.arrive <= d && d <= (s.depart ?? maxDay(today, s.arrive)));
    const night = [...here].reverse().find((s) => s.depart === null || d < s.depart);
    rows.push({ date: d, cities: [...new Set(here.map((s) => s.city))], countries: [...new Set(here.map((s) => s.country))], midnight: night ? night.country : null });
  }
  return rows;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Day-by-day CSV: where you were, plus a running count per rule (reset each period; rolling rules show the window count). */
export function dayTableCsv(stays: Stay[], rules: Rule[], from: Day, to: Day, today: Day): string {
  const spans = rules.map((r) => countedSpans(stays, r.countries, r.convention, today));
  const head = ['date', 'cities', 'countries_any_part', 'country_at_midnight', ...rules.map((r) => `${r.label} (running)`)];
  const lines = [head.map(csvCell).join(',')];
  for (const row of dayTable(stays, from, to, today)) {
    const counts = rules.map((r, i) => {
      const p = periodFor(r.period, row.date);
      const start = p ? p[0] : addDays(row.date, 1 - (r.period.kind === 'rolling' ? r.period.windowDays : 1));
      return String(countIn(spans[i], start, row.date));
    });
    lines.push([row.date, row.cities.join(' / '), row.countries.join(' / '), row.midnight ?? '', ...counts].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- presets

export const RULE_PRESETS: Rule[] = [
  { id: 'uk-tax-year', label: 'UK days in the tax year', countries: ['GB'], convention: 'midnights', period: { kind: 'uk-tax-year' }, limit: null },
  { id: 'tr-calendar-year', label: 'Turkey days in the calendar year', countries: ['TR'], convention: 'any-part', period: { kind: 'calendar-year' }, limit: 183 },
];

export const SCHENGEN = ['AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH'];

export const rollingRule = (id: string): Rule => ({ id, label: 'Schengen area, 90 in any 180 days', countries: [...SCHENGEN], convention: 'any-part', period: { kind: 'rolling', windowDays: 180 }, limit: 90 });
