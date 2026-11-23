import { describe, expect, it } from 'vitest';
import { writeIcs } from './ics.ts';
import { blankTrip, evaluateTrigger, evaluateTrip, fareStats, median, orcaTemplate, parseFares, parsePrice, seasonWindow, triggerDate, triggerEvents, whatMattersNext } from './triggers.ts';
import type { DateTrigger, Fare, FareTrigger, Trip } from './triggers.ts';

const ORCA = { from: '10-25', to: '01-25' };
const trip = (over: Partial<Trip> = {}): Trip => ({ ...blankTrip('t1'), name: 'Orcas', destination: 'Tromsø', season: ORCA, ...over });
const fare = (on: string, price: number, over: Partial<Fare> = {}): Fare => ({ id: on, on, from: 'LHR', to: 'TOS', price, currency: 'GBP', source: 'test', ...over });

describe('season', () => {
  it('finds the season under way or the next one, across New Year', () => {
    expect(seasonWindow(ORCA, '2026-11-23')).toEqual({ start: '2026-10-25', end: '2027-01-25' });
    expect(seasonWindow(ORCA, '2026-01-10')).toEqual({ start: '2025-10-25', end: '2026-01-25' });
    expect(seasonWindow(ORCA, '2026-01-26')).toEqual({ start: '2026-10-25', end: '2027-01-25' });
    expect(seasonWindow({ from: '06-01', to: '08-31' }, '2026-09-01')).toEqual({ start: '2027-06-01', end: '2027-08-31' });
    expect(seasonWindow({ from: '02-29', to: '03-10' }, '2027-01-01')).toEqual({ start: '2027-02-28', end: '2027-03-10' });
  });
});

describe('date triggers', () => {
  const book: DateTrigger = { id: 'b', kind: 'book', label: 'Book', anchor: 'season', daysBefore: 120 };
  const opens: DateTrigger = { id: 'o', kind: 'opens', label: 'Schedules open', anchor: 'season', daysBefore: 330 };
  const t = trip({ triggers: [book, opens] });

  it('counts back from the season start', () => {
    // 25 Oct minus 120 days = 27 Jun; minus 330 days = 29 Nov the year before.
    expect(triggerDate(t, book, '2026-02-01')).toBe('2026-06-27');
    expect(triggerDate(t, opens, '2026-02-01')).toBe('2025-11-29');
  });

  it('walks a deadline through waiting, coming up, due, missed and done', () => {
    expect(evaluateTrigger(t, book, '2026-02-01')).toMatchObject({ status: 'waiting', date: '2026-06-27' });
    expect(evaluateTrigger(t, book, '2026-06-13')).toMatchObject({ status: 'coming-up', date: '2026-06-27' });
    expect(evaluateTrigger(t, book, '2026-06-12').status).toBe('waiting');
    expect(evaluateTrigger(t, book, '2026-06-27')).toMatchObject({ status: 'open-now', detail: 'Due today.' });
    expect(evaluateTrigger(t, book, '2026-06-28').status).toBe('missed');
    expect(evaluateTrigger(t, { ...book, doneOn: '2026-06-20' }, '2026-06-28').status).toBe('fired');
    // Done for last season does not count for the next one.
    expect(evaluateTrigger(t, { ...book, doneOn: '2026-06-20' }, '2027-06-20').status).toBe('coming-up');
  });

  it('keeps an "opens" trigger open until the season ends, then rolls to next year', () => {
    expect(evaluateTrigger(t, opens, '2026-02-01')).toMatchObject({ status: 'open-now', date: '2026-10-25' });
    expect(evaluateTrigger(t, opens, '2026-12-01')).toMatchObject({ status: 'open-now', date: '2027-01-25' });
    // Next season starts 25 Oct 2027, so its schedules open 29 Nov 2026.
    expect(evaluateTrigger(t, opens, '2027-01-26')).toMatchObject({ status: 'open-now', date: '2027-10-25' });
  });

  it('uses the travel date and a hand-set date when given', () => {
    const fixed = trip({ travel: { from: '2027-11-10', to: '2027-11-17' } });
    const decide: DateTrigger = { id: 'd', kind: 'decide', label: 'Decide', anchor: 'travel', daysBefore: 100 };
    expect(triggerDate(fixed, decide, '2026-11-23')).toBe('2027-08-02');
    const op: DateTrigger = { id: 'op', kind: 'opens', label: 'Operator opens', anchor: 'travel', daysBefore: 0, fixedDate: '2027-03-01' };
    expect(evaluateTrigger(fixed, op, '2027-02-20')).toMatchObject({ status: 'coming-up', date: '2027-03-01' });
    expect(evaluateTrigger(fixed, op, '2027-03-02')).toMatchObject({ status: 'open-now', date: '2027-11-10' });
    expect(evaluateTrigger(fixed, op, '2027-11-18').status).toBe('missed');
  });
});

describe('fare triggers', () => {
  const drop: FareTrigger = { id: 'f', kind: 'fare', label: 'Drop', from: 'LHR', to: 'TOS', currency: 'GBP', dropPct: 20, medianDays: 60 };
  const base = [fare('2026-11-01', 400), fare('2026-11-05', 420), fare('2026-11-10', 410), fare('2026-11-15', 430)];

  it('computes a median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([400, 420, 410, 430])).toBe(415);
  });

  it('fires on a drop against the trailing median', () => {
    // Median of the four earlier fares is 415; 20% below is 332.
    const s = fareStats([...base, fare('2026-11-20', 320)], drop);
    expect(s.median).toBe(415);
    expect(s.threshold).toBe(332);
    expect(s.hit).toBe(true);
    const tr = trip({ fares: [...base, fare('2026-11-20', 320)], triggers: [drop] });
    expect(evaluateTrigger(tr, drop, '2026-11-23').status).toBe('fired');
    // The same observation a fortnight later is stale.
    expect(evaluateTrigger(tr, drop, '2026-12-05').status).toBe('missed');
  });

  it('waits above the line and warms up within 10% of it', () => {
    const at = (price: number) => evaluateTrigger(trip({ fares: [...base, fare('2026-11-20', price)], triggers: [drop] }), drop, '2026-11-23').status;
    expect(at(380)).toBe('waiting'); // 332 * 1.1 = 365.2
    expect(at(360)).toBe('coming-up');
    expect(at(332)).toBe('fired');
  });

  it('needs three earlier fares before a drop can be judged, but a target price works at once', () => {
    const few = [fare('2026-11-10', 410), fare('2026-11-20', 200)];
    expect(fareStats(few, drop)).toMatchObject({ median: null, threshold: null, hit: false });
    const target: FareTrigger = { ...drop, dropPct: undefined, targetPrice: 250 };
    expect(fareStats(few, target)).toMatchObject({ threshold: 250, hit: true });
    // Both set: whichever line is higher fires first.
    expect(fareStats([...base, fare('2026-11-20', 340)], { ...drop, targetPrice: 350 })).toMatchObject({ threshold: 350, hit: true });
  });

  it('looks only at its own route and currency, and only inside the window', () => {
    const noisy = [...base, fare('2026-11-20', 100, { to: 'OSL' }), fare('2026-11-21', 5000, { currency: 'TRY' }), fare('2026-11-22', 405)];
    expect(fareStats(noisy, drop)).toMatchObject({ median: 415, hit: false });
    expect(fareStats(noisy, drop).log).toHaveLength(5);
    // With a 10-day window only 15 Nov is in range of the 22 Nov fare: too few to compare.
    expect(fareStats(noisy, { ...drop, medianDays: 10 }).median).toBeNull();
  });

  it('waits when nothing is logged', () => {
    expect(evaluateTrigger(trip({ triggers: [drop] }), drop, '2026-11-23')).toMatchObject({ status: 'waiting', date: null });
  });
});

describe('fare input', () => {
  const d = { from: 'LHR', to: 'TOS', currency: 'GBP' };

  it('parses prices in both decimal styles', () => {
    expect(parsePrice('412')).toBe(412);
    expect(parsePrice('1,234.50')).toBe(1234.5);
    expect(parsePrice('1.234,50')).toBe(1234.5);
    expect(parsePrice('12.450')).toBe(12450);
    expect(parsePrice('412,5')).toBe(412.5);
    expect(parsePrice('abc')).toBeNull();
  });

  it('reads one fare per line, with defaults for what a line leaves out', () => {
    const r = parseFares('2026-11-23, LHR-TOS, 412 GBP, airline site\n23.11.2026 IST-TOS 12.450 TL\n24 Nov 2026  £398\nno date here 400', d);
    expect(r.fares).toEqual([
      { on: '2026-11-23', from: 'LHR', to: 'TOS', price: 412, currency: 'GBP', source: 'airline site' },
      { on: '2026-11-23', from: 'IST', to: 'TOS', price: 12450, currency: 'TRY', source: 'pasted' },
      { on: '2026-11-24', from: 'LHR', to: 'TOS', price: 398, currency: 'GBP', source: 'pasted' },
    ]);
    expect(r.errors).toEqual(['Line 4: no date found.']);
  });

  it('reads JSON', () => {
    const r = parseFares('[{"on":"2026-11-23","from":"lhr","to":"tos","price":412,"currency":"gbp","source":"Claude"},{"date":"2026-11-24","route":"IST-TOS","price":"12.450","currency":"TRY"},{"price":5}]', d);
    expect(r.fares).toEqual([
      { on: '2026-11-23', from: 'LHR', to: 'TOS', price: 412, currency: 'GBP', source: 'Claude' },
      { on: '2026-11-24', from: 'IST', to: 'TOS', price: 12450, currency: 'TRY', source: 'import' },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(parseFares('[{broken', d).errors).toEqual(['That looks like JSON but does not parse.']);
  });
});

describe('across trips', () => {
  it('ships the orca template with dates marked for confirmation', () => {
    const t = orcaTemplate('orca');
    expect(t.template).toBe(true);
    expect(t.routes).toContainEqual({ from: 'LHR', to: 'TOS' });
    const states = evaluateTrip(t, '2026-11-23');
    // In season on 23 Nov: both "opens" triggers are open; decide and book for this season have passed.
    expect(states.map((s) => s.status)).toEqual(['open-now', 'open-now', 'missed', 'missed', 'waiting', 'waiting']);
  });

  it('lists what needs attention first, then the next waiting date per trip', () => {
    const a = orcaTemplate('a');
    const b = trip({ id: 'b', name: 'Summer', season: { from: '06-01', to: '08-31' }, triggers: [{ id: 'bk', kind: 'book', label: 'Book', anchor: 'season', daysBefore: 100 }, { id: 'dc', kind: 'decide', label: 'Decide', anchor: 'season', daysBefore: 150 }] });
    const list = whatMattersNext([a, b], '2026-11-23');
    expect(list.map((s) => `${s.tripId}:${s.trigger.id}:${s.status}`)).toEqual(['a:schedule:open-now', 'a:operator:open-now', 'a:decide:missed', 'a:book:missed', 'b:dc:waiting']);
    expect(list[4].date).toBe('2027-01-02'); // 1 Jun 2027 minus 150 days
  });

  it('exports upcoming trigger dates with reminders', () => {
    const b = trip({ id: 'b', name: 'Summer', season: { from: '06-01', to: '08-31' }, triggers: [{ id: 'bk', kind: 'book', label: 'Book', anchor: 'season', daysBefore: 100 }, { id: 'dc', kind: 'decide', label: 'Decide', anchor: 'season', daysBefore: 150, doneOn: '2026-11-20' }] });
    const events = triggerEvents([orcaTemplate('a'), b], '2026-11-23');
    // Orca dates for the season under way are all behind us; Summer's decide is done.
    expect(events.map((e) => [e.uid, e.start.date])).toEqual([['trigger-b-bk@two-city', '2027-02-21']]);
    const text = writeIcs(events, { name: 'Trips', stamp: '2026-11-23T10:00:00Z' });
    expect(text).toContain('SUMMARY:Summer: Book');
    expect(text).toContain('TRIGGER:-PT15H');
    expect(text).toContain('TRIGGER:PT9H');
  });
});
