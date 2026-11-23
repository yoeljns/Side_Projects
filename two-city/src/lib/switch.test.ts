import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics.ts';
import { blankDoc } from './model.ts';
import type { Doc } from './model.ts';
import { HISTORY_LIMIT, checklistMarkdown, daysText, flip, openChecklists, planFor, routineEvents, routineIcs, suggestSwitch, switchSummary } from './switch.ts';

const TODAY = '2026-11-23'; // a Monday

describe('flip', () => {
  it('changes mode and deals fresh packing and landing lists from that city’s templates', () => {
    const doc = flip(blankDoc(), 'istanbul', TODAY);
    expect(doc.mode).toBe('istanbul');
    expect(doc.switchedOn).toBe(TODAY);
    const open = openChecklists(doc);
    expect(open.map((c) => [c.kind, c.city, c.createdOn])).toEqual([['packing', 'istanbul', TODAY], ['landing', 'istanbul', TODAY]]);
    expect(open[0].items.map((i) => i.text)).toEqual(blankDoc().profiles.istanbul.packing.map((i) => i.text));
    expect(open[0].items.every((i) => !i.done)).toBe(true);
    expect(open[1].items[0]).toEqual({ id: 'il1', text: 'Switch phone to the Turkish SIM', when: 'landing', done: false });
  });

  it('keeps the previous lists as history, ticks and all', () => {
    let doc = flip(blankDoc(), 'istanbul', TODAY);
    doc = { ...doc, checklists: doc.checklists.map((c) => ({ ...c, items: c.items.map((i, n) => ({ ...i, done: n === 0 })) })) };
    doc = flip(doc, 'london', '2026-12-20');
    expect(doc.mode).toBe('london');
    expect(doc.checklists).toHaveLength(4);
    const old = doc.checklists.filter((c) => c.archived);
    expect(old.map((c) => c.city)).toEqual(['istanbul', 'istanbul']);
    expect(old[0].items[0].done).toBe(true);
    expect(openChecklists(doc).map((c) => c.city)).toEqual(['london', 'london']);
    expect(new Set(doc.checklists.map((c) => c.id)).size).toBe(4);
  });

  it('caps the history', () => {
    let doc = blankDoc();
    for (let i = 0; i < 30; i++) doc = flip(doc, i % 2 ? 'london' : 'istanbul', TODAY);
    expect(doc.checklists).toHaveLength(HISTORY_LIMIT);
    expect(openChecklists(doc)).toHaveLength(2);
  });

  it('skips blank template lines and does not touch the input', () => {
    const start = blankDoc();
    start.profiles.london.packing = [{ id: 'a', text: 'Keys' }, { id: 'b', text: '   ' }];
    const doc = flip(start, 'london', TODAY);
    expect(openChecklists(doc)[0].items.map((i) => i.text)).toEqual(['Keys']);
    expect(start.checklists).toEqual([]);
  });
});

describe('routine', () => {
  const london = blankDoc().profiles.london;

  it('shows the blocks for the weekday in the profile’s order', () => {
    expect(planFor(london, TODAY).map((b) => b.label)).toEqual(['Morning walk', 'Deep work', 'Gym', 'Calls and admin', 'Study']); // Monday
    expect(planFor(london, '2026-11-24').map((b) => b.label)).toEqual(['Morning walk', 'Deep work', 'Calls and admin', 'Court', 'Study']); // Tuesday
    expect(planFor(london, '2026-11-29').map((b) => b.label)).toEqual(['Morning walk', 'Weekly review']); // Sunday
    const reordered = { ...london, routine: [...london.routine].reverse() };
    expect(planFor(reordered, TODAY).map((b) => b.label)).toEqual(['Study', 'Calls and admin', 'Gym', 'Deep work', 'Morning walk']);
  });

  it('describes days of the week', () => {
    expect(daysText([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(daysText([7, 6])).toBe('Weekends');
    expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    expect(daysText([4, 2])).toBe('Tue, Thu');
    expect(daysText([])).toBe('Never');
  });

  it('exports weekly recurring events in the city’s timezone, starting on the first matching day', () => {
    const events = routineEvents(london, 'london', TODAY);
    expect(events).toHaveLength(7);
    // Court is Tue/Thu: first occurrence on or after Monday 23 Nov is Tuesday 24 Nov.
    expect(events.find((e) => e.summary === 'Court')).toEqual({
      uid: 'routine-london-l5@two-city', summary: 'Court', description: 'London routine',
      start: { date: '2026-11-24', time: '18:30', tzid: 'Europe/London' }, durationMin: 90, rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
    });
    // Weekly review is Sunday only.
    expect(events.find((e) => e.summary === 'Weekly review')?.start.date).toBe('2026-11-29');
    // A block with no days or a broken time is left out.
    expect(routineEvents({ ...london, routine: [{ id: 'x', label: 'X', start: '9am', minutes: 30, days: [1] }, { id: 'y', label: 'Y', start: '09:00', minutes: 30, days: [] }] }, 'london', TODAY)).toEqual([]);
  });

  it('writes the calendar text', () => {
    const text = routineIcs(blankDoc().profiles.istanbul, 'istanbul', TODAY, '2026-11-23T08:00:00.000Z');
    const lines = text.split('\r\n');
    expect(lines.slice(0, 6)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//two-city//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Istanbul routine']);
    const at = lines.indexOf('UID:routine-istanbul-i2@two-city');
    expect(lines.slice(at - 1, at + 8)).toEqual([
      'BEGIN:VEVENT',
      'UID:routine-istanbul-i2@two-city',
      'DTSTAMP:20261123T080000Z',
      'DTSTART;TZID=Europe/Istanbul:20261124T120000',
      'DURATION:PT1H30M',
      'RRULE:FREQ=WEEKLY;BYDAY=TU,TH,SA',
      'SUMMARY:Court',
      'DESCRIPTION:Istanbul routine',
      'END:VEVENT',
    ]);
    expect(lines).toContain('TZID:Europe/Istanbul');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(7);
    // And it reads back: 12:00 in Istanbul is 09:00 UTC.
    const court = parseIcs(text).find((e) => e.summary === 'Court')!;
    expect(court.start?.instant).toBe(Date.UTC(2026, 10, 24, 9, 0));
    expect(court.rrule).toBe('FREQ=WEEKLY;BYDAY=TU,TH,SA');
  });
});

describe('output', () => {
  it('writes the checklists as Markdown with due dates on landing items', () => {
    const doc = flip(blankDoc(), 'london', TODAY);
    doc.profiles.london.court = { name: 'Park courts', slot: 'Tue and Thu 18:30' };
    const md = checklistMarkdown(doc, 'london', TODAY);
    expect(md).toContain('# London: switch on Mon 23 Nov 2026');
    expect(md).toContain('## Packing for London\n\n- [ ] Passport and residence documents');
    expect(md).toContain('- [ ] Switch phone to the UK SIM (on landing, Mon 23 Nov)');
    expect(md).toContain('- [ ] Food shop (first morning, Tue 24 Nov)');
    expect(md).toContain('- [ ] Check the next ticket sale windows (first week, Mon 30 Nov)');
    expect(md).toContain('- Court: Park courts, Tue and Thu 18:30');
    expect(md).toContain('- Gym: not set');
    expect(md).toContain('1. 07:00-07:30  Morning walk (Every day)');
  });

  it('prints a terminal summary in routine order', () => {
    const text = switchSummary(flip(blankDoc(), 'istanbul', TODAY), 'istanbul', TODAY);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Istanbul mode, switched on Mon 23 Nov 2026');
    expect(lines[3]).toBe('   1. 08:30-11:30  Deep work  [Weekdays]  today');
    expect(lines[4]).toBe('   2. 12:00-13:30  Court  [Tue, Thu, Sat]');
    expect(text).toContain('Packing for Istanbul\n  [ ] Passport and ID card');
    expect(text).toContain('Landing\n  [ ] Switch phone to the Turkish SIM  (on landing)');
  });
});

describe('suggestion', () => {
  const withStay = (arrive: string, depart: string | null, over: Partial<Doc> = {}): Doc => ({
    ...blankDoc(), mode: 'london', switchedOn: '2026-11-01',
    stays: [{ id: 's1', city: 'istanbul', country: 'TR', arrive, depart, source: 'manual' }],
    ...over,
  });

  it('offers the flip when a stay in the other city starts today or tomorrow', () => {
    expect(suggestSwitch(withStay('2026-11-24', '2026-12-10'), TODAY)).toEqual({ city: 'istanbul', stayId: 's1', arrive: '2026-11-24', when: 'tomorrow' });
    expect(suggestSwitch(withStay('2026-11-23', null), TODAY)?.when).toBe('today');
    expect(suggestSwitch(withStay('2026-11-25', '2026-12-10'), TODAY)).toBeNull();
  });

  it('also offers it when that stay is already under way', () => {
    expect(suggestSwitch(withStay('2026-11-15', '2026-12-10'), TODAY)?.when).toBe('under way');
    expect(suggestSwitch(withStay('2026-11-01', '2026-11-20'), TODAY)).toBeNull(); // over
  });

  it('stays quiet when already in that mode, dismissed, or switched by hand since', () => {
    expect(suggestSwitch(withStay('2026-11-24', null, { mode: 'istanbul' }), TODAY)).toBeNull();
    expect(suggestSwitch(withStay('2026-11-24', null, { dismissedSuggestion: 's1' }), TODAY)).toBeNull();
    expect(suggestSwitch(withStay('2026-11-15', '2026-12-10', { switchedOn: '2026-11-18' }), TODAY)).toBeNull();
  });
});
