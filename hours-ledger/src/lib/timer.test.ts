import { describe, expect, it } from 'vitest';
import { elapsedMinutes, fmtClock, overCap, round5, sliceFromStart, splitTimer } from './timer';

const at = (iso: string) => Date.parse(iso); // tests write instants in UTC

describe('timer', () => {
  it('rounds to the nearest five minutes', () => {
    expect(round5(42)).toBe(40);
    expect(round5(43)).toBe(45);
    expect(round5(2.4)).toBe(0);
    expect(round5(2.5)).toBe(5);
    expect(round5(57.5)).toBe(60);
  });

  it('measures elapsed time from the stored start, whatever happened in between', () => {
    expect(elapsedMinutes(at('2026-11-23T09:00:00Z'), at('2026-11-23T10:42:30Z'))).toBe(102.5);
    expect(elapsedMinutes(at('2026-11-23T09:00:00Z'), at('2026-11-23T08:00:00Z'))).toBe(0); // clock moved back
    expect(fmtClock(102.5)).toBe('1:42');
    expect(fmtClock(7)).toBe('0:07');
  });

  it('flags a timer only once it is past the cap', () => {
    const start = at('2026-11-23T09:00:00Z');
    expect(overCap(start, at('2026-11-23T15:00:00Z'), 6)).toBe(false);
    expect(overCap(start, at('2026-11-23T15:00:01Z'), 6)).toBe(true);
    expect(overCap(start, at('2026-11-23T11:30:00Z'), 2)).toBe(true);
  });

  it('logs a same-day timer as one rounded slice', () => {
    // 14:05 to 15:28 is 83 minutes, which rounds to 85.
    expect(splitTimer(at('2026-11-23T14:05:00Z'), at('2026-11-23T15:28:00Z'), 0)).toEqual([{ day: '2026-11-23', minutes: 85 }]);
  });

  it('drops a timer that rounds to nothing', () => {
    expect(splitTimer(at('2026-11-23T14:05:00Z'), at('2026-11-23T14:07:00Z'), 0)).toEqual([]);
    expect(splitTimer(at('2026-11-23T14:05:00Z'), at('2026-11-23T14:05:00Z'), 0)).toEqual([]);
    expect(splitTimer(at('2026-11-23T14:05:00Z'), at('2026-11-23T14:07:30Z'), 0)).toEqual([{ day: '2026-11-23', minutes: 5 }]);
  });

  it('splits at midnight', () => {
    // 22:40 to 01:20: 80 minutes before midnight, 80 after.
    expect(splitTimer(at('2026-11-22T22:40:00Z'), at('2026-11-23T01:20:00Z'), 0)).toEqual([
      { day: '2026-11-22', minutes: 80 },
      { day: '2026-11-23', minutes: 80 },
    ]);
  });

  it('rounds cumulatively so the slices add up to the rounded total', () => {
    // 23:48 to 00:19 is 12 + 19 = 31 minutes → 30 in all. Day one rounds 12 → 10, day two gets the remaining 20.
    expect(splitTimer(at('2026-11-22T23:48:00Z'), at('2026-11-23T00:19:00Z'), 0)).toEqual([
      { day: '2026-11-22', minutes: 10 },
      { day: '2026-11-23', minutes: 20 },
    ]);
    // 23:59 to 00:30: one minute before midnight rounds away; all 30 land on the second day.
    expect(splitTimer(at('2026-11-22T23:59:00Z'), at('2026-11-23T00:30:00Z'), 0)).toEqual([{ day: '2026-11-23', minutes: 30 }]);
  });

  it('uses the local midnight of the offset given', () => {
    // 20:30Z to 22:00Z. In London (UTC+0) that is one evening.
    const a = at('2026-11-22T20:30:00Z');
    const b = at('2026-11-22T22:00:00Z');
    expect(splitTimer(a, b, 0)).toEqual([{ day: '2026-11-22', minutes: 90 }]);
    // In Istanbul (UTC+3) it is 23:30 to 01:00: 30 minutes on the 22nd, 60 on the 23rd.
    expect(splitTimer(a, b, 180)).toEqual([
      { day: '2026-11-22', minutes: 30 },
      { day: '2026-11-23', minutes: 60 },
    ]);
    // West of UTC: at UTC−5, 02:00Z to 03:00Z is still the evening before.
    expect(splitTimer(at('2026-11-23T02:00:00Z'), at('2026-11-23T03:00:00Z'), -300)).toEqual([{ day: '2026-11-22', minutes: 60 }]);
  });

  it('spans more than two days when left running', () => {
    expect(splitTimer(at('2026-11-20T23:00:00Z'), at('2026-11-22T01:00:00Z'), 0)).toEqual([
      { day: '2026-11-20', minutes: 60 },
      { day: '2026-11-21', minutes: 1440 },
      { day: '2026-11-22', minutes: 60 },
    ]);
  });

  it('logs a corrected length from the start for a timer that was left on', () => {
    // Started 21:00 in Istanbul (18:00Z), actually worked 4 hours: 3h on the day, 1h after midnight.
    expect(sliceFromStart(at('2026-11-22T18:00:00Z'), 240, 180)).toEqual([
      { day: '2026-11-22', minutes: 180 },
      { day: '2026-11-23', minutes: 60 },
    ]);
    expect(sliceFromStart(at('2026-11-22T18:00:00Z'), 0, 180)).toEqual([]);
  });
});
