// Timer arithmetic. A timer is only a start timestamp; everything here is
// computed from (start, end) so nothing depends on the page staying open.
import type { Day } from './dates';

const MIN = 60_000;
const DAY_MIN = 1440;

export const round5 = (minutes: number): number => Math.round(minutes / 5) * 5;

export const elapsedMinutes = (startedAt: number, now: number): number => Math.max(0, (now - startedAt) / MIN);

export const overCap = (startedAt: number, now: number, capHours: number): boolean =>
  elapsedMinutes(startedAt, now) > capHours * 60;

/** "0:07", "1:42" */
export function fmtClock(minutes: number): string {
  const m = Math.floor(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export interface TimerSlice {
  day: Day;
  minutes: number;
}

/**
 * Split the span [startMs, endMs) at local midnights and round to 5 minutes.
 * `utcOffsetMinutes` is the device's offset when the timer is stopped
 * (minutes east of UTC: London winter 0, Istanbul 180); the whole span is read
 * in that one offset. Rounding is cumulative, so the slices always add up to
 * the rounded total and no day is rounded twice. Slices that round to zero are
 * dropped; a span under 2.5 minutes yields nothing.
 */
export function splitTimer(startMs: number, endMs: number, utcOffsetMinutes: number): TimerSlice[] {
  if (!(endMs > startMs)) return [];
  const shift = utcOffsetMinutes * MIN;
  const start = (startMs + shift) / MIN; // local minutes since the epoch
  const end = (endMs + shift) / MIN;
  const out: TimerSlice[] = [];
  let cursor = start;
  let cum = 0;
  let cumRounded = 0;
  while (cursor < end) {
    const dayIndex = Math.floor(cursor / DAY_MIN);
    const sliceEnd = Math.min(end, (dayIndex + 1) * DAY_MIN);
    cum += sliceEnd - cursor;
    const rounded = round5(cum);
    if (rounded > cumRounded) {
      out.push({ day: new Date(dayIndex * DAY_MIN * MIN).toISOString().slice(0, 10), minutes: rounded - cumRounded });
      cumRounded = rounded;
    }
    cursor = sliceEnd;
  }
  return out;
}

/** For a timer that was left running: log `minutes` counted from when it started. */
export const sliceFromStart = (startMs: number, minutes: number, utcOffsetMinutes: number): TimerSlice[] =>
  splitTimer(startMs, startMs + Math.max(0, minutes) * MIN, utcOffsetMinutes);
