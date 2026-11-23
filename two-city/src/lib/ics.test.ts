import { describe, expect, it } from 'vitest';
import { durationText, escapeText, foldLine, parseIcs, parseLine, parseTime, unescapeText, unfold, writeIcs } from './ics.ts';

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('reading', () => {
  it('unfolds lines continued with a space or a tab, with CRLF or LF endings', () => {
    expect(unfold('SUMMARY:Flight to\r\n  Istanbul\r\nLOCATION:Lon\n\tdon\n')).toEqual(['SUMMARY:Flight to Istanbul', 'LOCATION:London']);
  });

  it('splits a content line at the first colon outside quotes', () => {
    expect(parseLine('DTSTART;TZID="Europe/London";X=1:20260815T150000')).toEqual({ name: 'DTSTART', params: { TZID: 'Europe/London', X: '1' }, value: '20260815T150000' });
    expect(parseLine('ATTENDEE;CN="Smith: J":mailto:a@b.c')?.value).toBe('mailto:a@b.c');
    expect(parseLine('no colon here')).toBeNull();
  });

  it('reads the three DTSTART forms', () => {
    expect(parseTime('20260815', { VALUE: 'DATE' })).toEqual({ date: '2026-08-15', time: null, tzid: null, utc: false, instant: null });
    expect(parseTime('20260815T140000Z')).toEqual({ date: '2026-08-15', time: '14:00', tzid: null, utc: true, instant: Date.UTC(2026, 7, 15, 14, 0) });
    // 15:00 in London in August is BST, one hour ahead of UTC.
    expect(parseTime('20260815T150000', { TZID: 'Europe/London' })).toEqual({ date: '2026-08-15', time: '15:00', tzid: 'Europe/London', utc: false, instant: Date.UTC(2026, 7, 15, 14, 0) });
    // Istanbul is UTC+3 all year: 01:30 on 2 July is 22:30 UTC on 1 July.
    expect(parseTime('20260702T013000', { TZID: 'Europe/Istanbul' })?.instant).toBe(Date.UTC(2026, 6, 1, 22, 30));
    // Floating local time, and a zone name the runtime does not know.
    expect(parseTime('20260815T150000')?.instant).toBeNull();
    expect(parseTime('20260815T150000', { TZID: 'GMT Standard Time' })).toMatchObject({ date: '2026-08-15', instant: null });
    expect(parseTime('garbage')).toBeNull();
    expect(parseTime('20261345')).toBeNull();
  });

  it('parses events, unescapes text and skips alarms inside them', () => {
    const text = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:abc-1', 'SUMMARY:Chelsea v Arsenal\\, London derby', 'DESCRIPTION:Line one\\nLine two\; done \\\\ ok',
      'LOCATION:Stamford Bridge', 'CATEGORIES:FA Cup,Football', 'DTSTART:20270109T173000Z', 'DTEND:20270109T193000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:this must not replace the event description', 'TRIGGER:-PT1H', 'END:VALARM',
      'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20270110', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [a, b] = parseIcs(text);
    expect(a).toMatchObject({
      uid: 'abc-1', summary: 'Chelsea v Arsenal, London derby', description: 'Line one\nLine two; done \\ ok', location: 'Stamford Bridge',
      categories: ['FA Cup', 'Football'], rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    expect(a.start?.date).toBe('2027-01-09');
    expect(a.end?.time).toBe('19:30');
    expect(b).toMatchObject({ uid: null, summary: 'All day', start: { date: '2027-01-10', time: null } });
  });

  it('returns nothing for text that is not a calendar', () => {
    expect(parseIcs('hello\nworld')).toEqual([]);
    expect(parseIcs('')).toEqual([]);
  });
});

describe('writing', () => {
  it('escapes and unescapes symmetrically', () => {
    const s = 'a, b; c\\d\nnext';
    expect(escapeText(s)).toBe('a\\, b\\; c\\\\d\\nnext');
    expect(unescapeText(escapeText(s))).toBe(s);
  });

  it('folds at 75 octets without splitting a multi-byte character', () => {
    const line = `SUMMARY:${'İstanbul’a uçuş için ödeme günü, '.repeat(6)}`;
    const folded = foldLine(line).split('\r\n');
    expect(folded.length).toBeGreaterThan(2);
    for (const l of folded) expect(bytes(l)).toBeLessThanOrEqual(75);
    for (const l of folded.slice(1)) expect(l.startsWith(' ')).toBe(true);
    expect(unfold(folded.join('\r\n'))).toEqual([line]);
    // Exactly 75 ASCII octets stay on one line; 76 fold once.
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
    expect(foldLine('x'.repeat(76))).toBe(`${'x'.repeat(75)}\r\n x`);
  });

  it('writes durations and alarm triggers', () => {
    expect(durationText(-90)).toBe('-PT1H30M');
    expect(durationText(540)).toBe('PT9H');
    expect(durationText(-1440)).toBe('-P1D');
    expect(durationText(-1500)).toBe('-P1DT1H');
    expect(durationText(45)).toBe('PT45M');
    expect(durationText(0)).toBe('PT0M');
  });

  it('writes timed, all-day and recurring events with alarms', () => {
    const text = writeIcs(
      [
        { uid: 'r1@two-city', summary: 'Court', start: { date: '2026-11-24', time: '18:30', tzid: 'Europe/London' }, durationMin: 90, rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' },
        { uid: 's1@two-city', summary: 'Tickets: Chelsea v Arsenal', start: { date: '2026-12-01' }, alarms: [{ offsetMin: -360, text: 'Tomorrow' }, { offsetMin: 540 }], url: 'https://example.org/t' },
        { uid: 'u1@two-city', summary: 'Kick-off', start: { date: '2026-12-05', time: '15:00', utc: true } },
      ],
      { name: 'Test, calendar', stamp: '2026-11-23T10:00:00.000Z' },
    );
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const lines = text.split('\r\n');
    expect(lines).toContain('X-WR-CALNAME:Test\\, calendar');
    expect(lines).toContain('TZID:Europe/London');
    expect(lines).toContain('DTSTAMP:20261123T100000Z');
    expect(lines).toContain('DTSTART;TZID=Europe/London:20261124T183000');
    expect(lines).toContain('DURATION:PT1H30M');
    expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH');
    expect(lines).toContain('DTSTART;VALUE=DATE:20261201');
    expect(lines).toContain('DTEND;VALUE=DATE:20261202');
    expect(lines).toContain('TRIGGER:-PT6H');
    expect(lines).toContain('TRIGGER:PT9H');
    expect(lines).toContain('DESCRIPTION:Tomorrow');
    expect(lines).toContain('DTSTART:20261205T150000Z');
    expect(lines.filter((l) => l === 'BEGIN:VALARM')).toHaveLength(2);
    // Only the zone that is used gets a VTIMEZONE block.
    expect(text).not.toContain('Europe/Istanbul');
  });

  it('round-trips through the reader', () => {
    const text = writeIcs(
      [{ uid: 'x@two-city', summary: 'Norway orca season: Book boat; flights, etc.', description: 'Skjervøy\nTromsø', location: 'Tromsø, Norway', start: { date: '2027-06-27' }, alarms: [{ offsetMin: 540 }] }],
      { name: 'Trips', stamp: '2026-11-23T10:00:00Z' },
    );
    const [e] = parseIcs(text);
    expect(e).toMatchObject({ uid: 'x@two-city', summary: 'Norway orca season: Book boat; flights, etc.', description: 'Skjervøy\nTromsø', location: 'Tromsø, Norway' });
    expect(e.start).toMatchObject({ date: '2027-06-27', time: null });
    expect(e.end?.date).toBe('2027-06-28');
  });
});
