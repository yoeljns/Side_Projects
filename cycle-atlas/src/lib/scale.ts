// The time axis: a view is a range of years mapped onto a pixel width.

export interface View {
  start: number;
  end: number;
}

export interface Limits {
  min: number;
  max: number;
  /** Narrowest span that can be zoomed to, in years. */
  minSpan: number;
}

export const span = (v: View): number => v.end - v.start;

export function yearToX(v: View, width: number, year: number): number {
  return ((year - v.start) / span(v)) * width;
}

export function xToYear(v: View, width: number, x: number): number {
  return v.start + (x / width) * span(v);
}

/** Keep a view inside the limits without changing its span unless it has to. */
export function clampView(v: View, l: Limits): View {
  const s = Math.min(Math.max(span(v), l.minSpan), l.max - l.min);
  let start = v.start;
  if (start < l.min) start = l.min;
  if (start + s > l.max) start = l.max - s;
  return { start, end: start + s };
}

/**
 * Zoom by `factor` (below 1 zooms in) keeping `anchor` (a year) at the same
 * place on screen, as far as the limits allow.
 */
export function zoomAround(v: View, anchor: number, factor: number, l: Limits): View {
  const s = Math.min(Math.max(span(v) * factor, l.minSpan), l.max - l.min);
  const t = (anchor - v.start) / span(v);
  return clampView({ start: anchor - t * s, end: anchor - t * s + s }, l);
}

export function pan(v: View, years: number, l: Limits): View {
  return clampView({ start: v.start + years, end: v.end + years }, l);
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/** Round-number ticks with at least `minGap` pixels between them. */
export function ticks(v: View, width: number, minGap = 64): { step: number; years: number[] } {
  const perPx = span(v) / Math.max(width, 1);
  const step = STEPS.find((s) => s / perPx >= minGap) ?? STEPS[STEPS.length - 1];
  const years: number[] = [];
  for (let y = Math.ceil(v.start / step) * step; y <= v.end; y += step) years.push(y);
  return { step, years };
}

// ---------- layout helpers for labels ----------

export interface Box {
  id: string;
  x1: number;
  x2: number;
}

/**
 * Put boxes on as few rows as possible so none overlap on a row (first fit,
 * left to right). Returns the row for each id and the number of rows used.
 */
export function packRows(boxes: Box[], gap = 6): { rows: Map<string, number>; count: number } {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const b of [...boxes].sort((p, q) => p.x1 - q.x1 || p.x2 - q.x2)) {
    let r = ends.findIndex((e) => e + gap <= b.x1);
    if (r === -1) {
      r = ends.length;
      ends.push(b.x2);
    } else ends[r] = b.x2;
    rows.set(b.id, r);
  }
  return { rows, count: ends.length };
}

/** Rough width of a label in pixels at a font size, good enough for collision checks. */
export const textWidth = (s: string, size = 11): number => s.length * size * 0.56;

/** Cut a label to fit a width, with an ellipsis. Empty string if not even three characters fit. */
export function fitText(s: string, width: number, size = 11): string {
  if (textWidth(s, size) <= width) return s;
  const n = Math.floor(width / (size * 0.56)) - 1;
  return n >= 3 ? `${s.slice(0, n).trimEnd()}…` : '';
}

// ---------- data series ----------

export interface YScale {
  min: number;
  max: number;
  log: boolean;
  /** 0 at the bottom of the lane, 1 at the top. */
  at: (value: number) => number;
}

/**
 * Value axis for one series lane. On a log scale values at or below zero
 * cannot be placed: `at` returns NaN for them and the caller skips the point.
 */
export function yScale(values: number[], log: boolean): YScale | null {
  const usable = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  if (!usable.length) return null;
  let min = Math.min(...usable);
  let max = Math.max(...usable);
  if (min === max) {
    if (log) {
      min = min / 2;
      max = max * 2;
    } else {
      min -= 1;
      max += 1;
    }
  }
  const f = (v: number): number => (log ? Math.log(v) : v);
  const lo = f(min);
  const hi = f(max);
  return { min, max, log, at: (v) => (log && v <= 0 ? NaN : (f(v) - lo) / (hi - lo)) };
}
