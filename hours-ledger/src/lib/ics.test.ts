import { describe, expect, it } from 'vitest';
import { foldLine, isTime, reminderIcs } from './ics';

const created = Date.parse('2026-11-23T08:15:30Z');

describe('reminder .ics', () => {
  it('produces the exact calendar text', () => {
    // 23 Nov 2026 is a Monday, so the first Sunday is the 29th.
    expect(reminderIcs({ time: '18:00', from: '2026-11-23', createdAt: created })).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//hours-ledger//weekly summary reminder//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:weekly-summary@hours-ledger',
        'DTSTAMP:20261123T081530Z',
        'DTSTART:20261129T180000',
        'DTEND:20261129T181500',
        'RRULE:FREQ=WEEKLY;BYDAY=SU',
        'SUMMARY:Hours ledger: weekly summary',
        'DESCRIPTION:Ten minutes: read the week\\, fill in the three boxes.',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Hours ledger: weekly summary',
        'TRIGGER:PT0M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('starts today when today is a Sunday', () => {
    const ics = reminderIcs({ time: '09:30', from: '2026-11-22', createdAt: created });
    expect(ics).toContain('DTSTART:20261122T093000\r\n');
    expect(ics).toContain('DTEND:20261122T094500\r\n');
  });

  it('uses floating local time: no Z and no TZID on the event times', () => {
    const ics = reminderIcs({ time: '18:00', from: '2026-11-23', createdAt: created });
    expect(ics).not.toMatch(/DTSTART[^\r]*Z\r/);
    expect(ics).not.toContain('TZID');
  });

  it('does not run past midnight', () => {
    const ics = reminderIcs({ time: '23:50', from: '2026-11-23', createdAt: created });
    expect(ics).toContain('DTSTART:20261129T235000\r\n');
    expect(ics).toContain('DTEND:20261129T235900\r\n');
  });

  it('adds the app link and folds long lines at 75 octets', () => {
    const url = 'https://example.test/some/quite/long/path/to/the/app/that/pushes/the/line/over';
    const ics = reminderIcs({ time: '18:00', from: '2026-11-23', createdAt: created, url });
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // Unfolding gives the original content back.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`URL:${url}\r\n`);
    expect(unfolded).toContain(`DESCRIPTION:Ten minutes: read the week\\, fill in the three boxes.\\n${url}\r\n`);
  });

  it('folds by bytes, not characters', () => {
    const folded = foldLine('SUMMARY:' + 'é'.repeat(60)); // 8 + 120 bytes
    const parts = folded.split('\r\n ');
    expect(parts.length).toBe(2);
    expect(new TextEncoder().encode(parts[0]).length).toBeLessThanOrEqual(75);
    expect(parts.join('')).toBe('SUMMARY:' + 'é'.repeat(60));
    expect(foldLine('SHORT:line')).toBe('SHORT:line');
  });

  it('checks the time', () => {
    expect(isTime('18:00')).toBe(true);
    expect(isTime('7:00')).toBe(false);
    expect(isTime('24:00')).toBe(false);
    expect(() => reminderIcs({ time: '6pm', from: '2026-11-23', createdAt: created })).toThrow();
  });
});
