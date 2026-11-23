import { describe, expect, it } from 'vitest';
import { foldLine, reviewsToIcs } from './ics';
import type { Decision } from './model';

const d = (id: string, extra: Partial<Decision> = {}): Decision => ({ id, title: `Decision ${id}`, category: 'Other', stakes: 'low', madeOn: '2026-01-10', probability: 0.7, reviewOn: '2026-04-10', ...extra });

describe('reviewsToIcs', () => {
  it('writes the exact file for one open decision', () => {
    const ics = reviewsToIcs([d('abc', { title: 'Raise prices; new customers, only', statement: 'sign-ups hold', call: 'Go up 10%' })], '2026-01-11');
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//decision-journal//review dates//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Decision reviews',
        'BEGIN:VEVENT',
        'UID:abc@decision-journal',
        'DTSTAMP:20260111T000000Z',
        'DTSTART;VALUE=DATE:20260410',
        'DTEND;VALUE=DATE:20260411',
        'SUMMARY:Review: Raise prices\; new customers\\, only',
        'DESCRIPTION:The call: Go up 10%\\nForecast: 70% that sign-ups hold\\nDecided ',
        ' on 2026-01-10.',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('leaves out resolved and void decisions and sorts by review date', () => {
    const ics = reviewsToIcs(
      [
        d('late', { reviewOn: '2026-09-01' }),
        d('done', { outcome: true, resolvedOn: '2026-04-10' }),
        d('void', { voided: true, resolvedOn: '2026-04-10' }),
        d('soon', { reviewOn: '2026-02-01' }),
      ],
      '2026-01-11',
    );
    expect(ics.match(/^UID:.*$/gm)).toEqual(['UID:soon@decision-journal\r', 'UID:late@decision-journal\r'].map((s) => s.trim()));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('the all-day event ends the next day, across a month end', () => {
    const ics = reviewsToIcs([d('x', { reviewOn: '2026-12-31' })], '2026-01-11');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n');
  });

  it('lists scenarios instead of a single probability', () => {
    const ics = reviewsToIcs(
      [d('m', { probability: 0.5, scenarios: [{ id: 'a', label: 'Bear', probability: 0.2 }, { id: 'b', label: 'Base', probability: 0.5 }, { id: 'c', label: 'Bull', probability: 0.3 }] })],
      '2026-01-11',
    );
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('DESCRIPTION:Scenarios: Bear 20%\\, Base 50%\\, Bull 30%\\nDecided on 2026-01-10.');
  });

  it('escapes backslashes and newlines in notes', () => {
    const ics = reviewsToIcs([d('x', { changeMind: 'a\\b\nsecond line' })], '2026-01-11').replace(/\r\n /g, '');
    expect(ics).toContain('What would change my mind: a\\\\b\\nsecond line');
  });

  it('every line is at most 75 bytes and ends with CRLF', () => {
    const long = 'İstanbul ya da Londra — hangisi? '.repeat(12);
    const ics = reviewsToIcs([d('x', { title: long, statement: long })], '2026-01-11');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = ics.split('\r\n');
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // unfolding gives the text back
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:Review: ${long.trim()}`);
  });

  it('an empty journal is still a valid empty calendar', () => {
    const ics = reviewsToIcs([], '2026-01-11');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toContain('VEVENT');
  });
});

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
  });
  it('folds at 75 bytes with a leading space on continuations', () => {
    expect(foldLine('x'.repeat(76))).toBe(`${'x'.repeat(75)}\r\n x`);
    expect(foldLine('x'.repeat(75 + 74 + 1))).toBe(`${'x'.repeat(75)}\r\n ${'x'.repeat(74)}\r\n x`);
  });
  it('does not split a multi-byte character', () => {
    // 74 ASCII bytes then a 2-byte character: it must move to the next line whole.
    expect(foldLine(`${'x'.repeat(74)}é`)).toBe(`${'x'.repeat(74)}\r\n é`);
  });
});
