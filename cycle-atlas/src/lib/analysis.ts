// Descriptive helpers over tracks. Everything here is a count on a handful of
// cycles: each result carries its `n` so the UI can say how small the sample is.
import { phaseEnd } from './model';
import { EVENT_KIND_LABEL, KIND_LABEL, type CycleEvent, type EventKind, type Phase, type PhaseKind, type Track } from './types';

export interface Stats {
  n: number;
  mean: number;
  min: number;
  max: number;
  /** Sample standard deviation (n - 1). Null when n < 2. */
  sd: number | null;
}

export function stats(values: number[]): Stats | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n < 2 ? null : Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  return { n, mean, min: Math.min(...values), max: Math.max(...values), sd };
}

/** A phase covers [start, end): its end year belongs to whatever comes next. Open phases cover up to and including `nowYear`. */
export function covers(p: Phase, year: number, nowYear: number): boolean {
  return p.end === null ? year >= p.start && year <= Math.max(nowYear, p.start) : year >= p.start && year < p.end;
}

/** Every phase of the track that covers the year (chronologies can overlap), earliest start first. */
export function phasesAt(track: Track, year: number, nowYear: number): Phase[] {
  return track.phases.filter((p) => covers(p, year, nowYear)).sort((a, b) => a.start - b.start);
}

// ---------- the year readout ----------

export interface ReadoutRow {
  trackId: string;
  trackName: string;
  author: string;
  phases: { phase: Phase; yearsIn: number; length: number | null }[];
  /** Events in exactly this year. */
  events: CycleEvent[];
  /** Events within `near` years either side, nearest first. offset = event year - year. */
  near: { event: CycleEvent; offset: number }[];
}

export function readout(tracks: Track[], year: number, nowYear: number, near = 2): ReadoutRow[] {
  const y = Math.round(year);
  return tracks.map((t) => ({
    trackId: t.id,
    trackName: t.name,
    author: t.author,
    phases: phasesAt(t, y, nowYear).map((phase) => ({ phase, yearsIn: y - phase.start, length: phase.end === null ? null : phase.end - phase.start })),
    events: t.events.filter((e) => e.year === y),
    near: t.events
      .filter((e) => e.year !== y && Math.abs(e.year - y) <= near)
      .map((event) => ({ event, offset: event.year - y }))
      .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || a.offset - b.offset),
  }));
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One readable clause for a track at a year: "turning point (4th: turning point, year 3 of 14); Peak of … this year". */
export function readoutClause(row: ReadoutRow): string {
  const parts: string[] = [];
  for (const { phase, yearsIn, length } of row.phases) {
    const where = length === null ? `${plural(yearsIn, 'year')} in, still open` : `year ${yearsIn + 1} of ${length}`;
    parts.push(`${phase.name} (${KIND_LABEL[phase.kind].toLowerCase()}, ${where})`);
  }
  for (const e of row.events) parts.push(`${e.label} this year`);
  for (const { event, offset } of row.near) {
    parts.push(`${event.label} ${plural(Math.abs(offset), 'year')} ${offset > 0 ? 'later' : 'earlier'}`);
  }
  return parts.length ? parts.join('; ') : 'nothing dated';
}

export function readoutText(rows: ReadoutRow[], year: number): string {
  const shown = rows.filter((r) => r.phases.length || r.events.length || r.near.length);
  if (!shown.length) return `In ${Math.round(year)}: nothing dated on the visible tracks.`;
  return `In ${Math.round(year)}: ${shown.map((r) => `${r.trackName} (${r.author}): ${readoutClause(r)}`).join('. ')}.`;
}

// ---------- overlap ----------

export interface Interval {
  start: number;
  end: number;
}

export interface OverlapCell {
  kindA: PhaseKind;
  kindB: PhaseKind;
  years: number;
  intervals: Interval[];
}

export interface Overlap {
  /** Years in which both tracks have a phase at all (the window the comparison can speak about). */
  common: number;
  /** Years in which the two tracks are in a phase of the same kind. */
  sameKind: number;
  /** Every kind pairing that co-occurs, most years first. */
  cells: OverlapCell[];
}

/** Merge touching or overlapping intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

const totalYears = (list: Interval[]): number => list.reduce((a, i) => a + (i.end - i.start), 0);

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return mergeIntervals(out);
}

/** Where a track is in each kind of phase, merged, clipped to an optional window. Open phases run to `nowYear`. */
export function kindIntervals(track: Track, nowYear: number, window?: Interval): Map<PhaseKind, Interval[]> {
  const m = new Map<PhaseKind, Interval[]>();
  for (const p of track.phases) {
    let start = p.start;
    let end = phaseEnd(p, nowYear);
    if (window) {
      start = Math.max(start, window.start);
      end = Math.min(end, window.end);
    }
    if (end > start) m.set(p.kind, [...(m.get(p.kind) ?? []), { start, end }]);
  }
  for (const [k, v] of m) m.set(k, mergeIntervals(v));
  return m;
}

/**
 * Co-occurrence of phase kinds between two tracks, in years. Intervals are
 * half-open, so two phases that only touch share no time. A year in which a
 * track is in two overlapping phases of different kinds counts under both.
 */
export function overlap(a: Track, b: Track, nowYear: number, window?: Interval): Overlap {
  const ka = kindIntervals(a, nowYear, window);
  const kb = kindIntervals(b, nowYear, window);
  const cells: OverlapCell[] = [];
  let sameKind: Interval[] = [];
  for (const [kindA, ia] of ka) {
    for (const [kindB, ib] of kb) {
      const intervals = intersect(ia, ib);
      const years = totalYears(intervals);
      if (years > 0) {
        cells.push({ kindA, kindB, years, intervals });
        if (kindA === kindB) sameKind = sameKind.concat(intervals);
      }
    }
  }
  const anyA = mergeIntervals([...ka.values()].flat());
  const anyB = mergeIntervals([...kb.values()].flat());
  cells.sort((x, y) => y.years - x.years || x.kindA.localeCompare(y.kindA) || x.kindB.localeCompare(y.kindB));
  return { common: totalYears(intersect(anyA, anyB)), sameKind: totalYears(mergeIntervals(sameKind)), cells };
}

// ---------- markers, lags and cycle lengths ----------

/** A dated point on a track: an event of some kind, or the start of a phase of some kind. */
export interface Marker {
  year: number;
  /** 'event:peak', 'start:installation', … */
  type: string;
  label: string;
  itemId: string;
}

export function markerTypeLabel(type: string): string {
  const [what, kind] = type.split(':');
  if (what === 'event') return `${EVENT_KIND_LABEL[kind as EventKind] ?? kind} events`;
  return `Start of ${(KIND_LABEL[kind as PhaseKind] ?? kind).toLowerCase()} phases`;
}

export function markers(track: Track): Marker[] {
  const out: Marker[] = [];
  for (const e of track.events) out.push({ year: e.year, type: `event:${e.kind}`, label: e.label, itemId: e.id });
  for (const p of track.phases) out.push({ year: p.start, type: `start:${p.kind}`, label: `Start of ${p.name}`, itemId: p.id });
  return out.sort((a, b) => a.year - b.year);
}

/** The marker types a track has, with how many of each, most frequent first. */
export function markerTypes(track: Track): { type: string; count: number }[] {
  const m = new Map<string, number>();
  for (const k of markers(track)) m.set(k.type, (m.get(k.type) ?? 0) + 1);
  return [...m.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export interface LagPair {
  from: Marker;
  to: Marker;
  /** to.year - from.year. Positive: the first track's marker comes first. */
  lag: number;
}

export interface LagResult {
  pairs: LagPair[];
  /** Markers in A with no marker in B inside the window. */
  unmatched: Marker[];
  stats: Stats | null;
  /** How many markers in B were the nearest for more than one marker in A. */
  reused: number;
}

/**
 * For each marker of `typeA` in track A, the nearest marker of `typeB` in
 * track B, and the lag between them. Ties go to the later one (A leads).
 * `maxLag` drops matches further apart than that many years. The match is
 * nearest-neighbour, not one-to-one: a marker in B can be picked twice.
 */
export function lags(a: Track, typeA: string, b: Track, typeB: string, maxLag = Infinity): LagResult {
  const ma = markers(a).filter((m) => m.type === typeA);
  const mb = markers(b).filter((m) => m.type === typeB);
  const pairs: LagPair[] = [];
  const unmatched: Marker[] = [];
  const used = new Map<string, number>();
  for (const from of ma) {
    let best: Marker | null = null;
    for (const to of mb) {
      if (!best) {
        best = to;
        continue;
      }
      const d = Math.abs(to.year - from.year);
      const bd = Math.abs(best.year - from.year);
      if (d < bd || (d === bd && to.year > best.year)) best = to;
    }
    if (!best || Math.abs(best.year - from.year) > maxLag) unmatched.push(from);
    else {
      pairs.push({ from, to: best, lag: best.year - from.year });
      used.set(best.itemId, (used.get(best.itemId) ?? 0) + 1);
    }
  }
  return { pairs, unmatched, stats: stats(pairs.map((p) => p.lag)), reused: [...used.values()].filter((n) => n > 1).length };
}

export interface CycleLength {
  type: string;
  /** The years of the markers, in order. */
  years: number[];
  /** Gaps between consecutive markers. */
  gaps: number[];
  stats: Stats;
}

/**
 * Cycle lengths for a track: for every marker type that occurs at least twice,
 * the gaps between consecutive occurrences. 'event:peak' gives peak to peak,
 * 'start:expansion' gives start to start, and so on.
 */
export function cycleLengths(track: Track): CycleLength[] {
  const byType = new Map<string, number[]>();
  for (const m of markers(track)) byType.set(m.type, [...(byType.get(m.type) ?? []), m.year]);
  const out: CycleLength[] = [];
  for (const [type, years] of byType) {
    if (years.length < 2) continue;
    const gaps = years.slice(1).map((y, i) => y - years[i]);
    out.push({ type, years, gaps, stats: stats(gaps) as Stats });
  }
  return out.sort((x, y) => y.gaps.length - x.gaps.length || x.type.localeCompare(y.type));
}

// ---------- where are we now ----------

export interface NowRow {
  phase: Phase;
  yearsIn: number;
  /** Lengths of the track's earlier, completed phases of the same kind. */
  history: Stats | null;
  /** yearsIn over the historical mean. Null without history. */
  ratio: number | null;
  /** Position against the historical range: 'within' includes the ends. */
  against: 'shorter' | 'within' | 'longer' | null;
}

export interface NowResult {
  trackId: string;
  trackName: string;
  author: string;
  rows: NowRow[];
}

export function whereNow(track: Track, nowYear: number): NowResult {
  const rows = phasesAt(track, nowYear, nowYear).map((phase): NowRow => {
    const yearsIn = nowYear - phase.start;
    const lengths = track.phases
      .filter((p) => p.id !== phase.id && p.kind === phase.kind && p.end !== null && p.end <= nowYear)
      .map((p) => (p.end as number) - p.start);
    const history = stats(lengths);
    return {
      phase,
      yearsIn,
      history,
      ratio: history && history.mean > 0 ? yearsIn / history.mean : null,
      against: !history ? null : yearsIn < history.min ? 'shorter' : yearsIn > history.max ? 'longer' : 'within',
    };
  });
  return { trackId: track.id, trackName: track.name, author: track.author, rows };
}

/** "n = 3" with the right warning attached, for anywhere a statistic is shown. */
export function sampleNote(n: number): string {
  if (n <= 1) return `n = ${n}: a single case, not a pattern`;
  if (n < 8) return `n = ${n}: far too few to generalise`;
  return `n = ${n}: still a small sample`;
}
