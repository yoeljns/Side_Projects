import { describe, expect, it } from 'vitest';
import { parseIcs, writeIcs } from './ics.ts';
import type { Stay } from './ledger.ts';
import { DEFAULT_SALE, canAttend, feedUrl, fixturesFromIcs, kickoffLondon, mapFeed, matchCity, mergeFixtures, saleAlerts, saleCategory, saleWindowEvents, saleWindows, seasonFor, whereOn } from './matchday.ts';

// The shape fixturedownload.com serves; opponents and times are made up for the test.
const FEED = [
  { MatchNumber: 5, RoundNumber: 1, DateUtc: '2026-08-15 14:00:00Z', Location: 'Stamford Bridge', HomeTeam: 'Chelsea', AwayTeam: 'Fulham', Group: null, HomeTeamScore: 2, AwayTeamScore: 1 },
  { MatchNumber: 14, RoundNumber: 2, DateUtc: '2026-08-22 16:30:00Z', Location: 'Emirates Stadium', HomeTeam: 'Arsenal', AwayTeam: 'Chelsea', Group: null, HomeTeamScore: null, AwayTeamScore: null },
  { MatchNumber: 131, RoundNumber: 14, DateUtc: '2026-12-05 15:00:00Z', Location: 'Stamford Bridge', HomeTeam: 'Chelsea', AwayTeam: 'Everton', Group: null, HomeTeamScore: null, AwayTeamScore: null },
  { MatchNumber: 140, RoundNumber: 15, DateUtc: '2026-12-12 20:00:00Z', Location: 'St. James\' Park', HomeTeam: 'Newcastle', AwayTeam: 'Chelsea', Group: null, HomeTeamScore: null, AwayTeamScore: null },
  { MatchNumber: 201, RoundNumber: 21, DateUtc: '2027-01-16 15:00:00Z', Location: 'Stamford Bridge', HomeTeam: 'Chelsea', AwayTeam: 'Liverpool', Group: null, HomeTeamScore: null, AwayTeamScore: null },
  { MatchNumber: 999, RoundNumber: 1, DateUtc: '2026-08-15 14:00:00Z', Location: 'Elsewhere', HomeTeam: 'Leeds', AwayTeam: 'Everton' },
  { MatchNumber: 'bad' },
];

const stay = (id: string, city: string, country: string, arrive: string, depart: string | null): Stay => ({ id, city, country, arrive, depart, source: 'manual' });
const STAYS = [stay('B', 'london', 'GB', '2026-11-10', '2026-12-12'), stay('C', 'istanbul', 'TR', '2026-12-12', '2027-01-04'), stay('D', 'london', 'GB', '2027-01-04', null)];
const TODAY = '2026-11-23';

describe('loading', () => {
  it('knows the season and the feed address', () => {
    expect(seasonFor('2026-11-23')).toBe(2026);
    expect(seasonFor('2027-06-30')).toBe(2026);
    expect(seasonFor('2027-07-01')).toBe(2027);
    expect(feedUrl(2026)).toBe('https://fixturedownload.com/feed/json/epl-2026/chelsea');
  });

  it('maps the feed to fixtures', () => {
    const fx = mapFeed(FEED, 2026);
    expect(fx).toHaveLength(5);
    expect(fx[0]).toEqual({ id: 'epl-2026-5', date: '2026-08-15', kickoffUtc: '2026-08-15T14:00:00Z', opponent: 'Fulham', home: true, competition: 'Premier League', venue: 'Stamford Bridge' });
    expect(fx[1]).toMatchObject({ id: 'epl-2026-14', opponent: 'Arsenal', home: false, venue: 'Emirates Stadium' });
    // 14:00 UTC in August is 15:00 in London; 15:00 UTC in December is 15:00.
    expect(kickoffLondon(fx[0])).toBe('15:00');
    expect(kickoffLondon(fx[2])).toBe('15:00');
  });

  it('uses the London date when a late kick-off crosses midnight UTC', () => {
    const [f] = mapFeed([{ MatchNumber: 1, DateUtc: '2026-08-20 23:30:00Z', HomeTeam: 'Chelsea', AwayTeam: 'Leeds' }], 2026);
    expect(f.date).toBe('2026-08-21');
  });

  it('fails loudly on a payload that is not the feed', () => {
    expect(() => mapFeed({ error: 'nope' }, 2026)).toThrow(/did not return a list/);
    expect(() => mapFeed([{ foo: 1 }], 2026)).toThrow(/no Chelsea matches/);
  });

  it('refreshes: moves kick-offs by match identity, keeps marks, reports what changed', () => {
    const first = mapFeed(FEED, 2026).map((f) => (f.id === 'epl-2026-5' ? { ...f, attended: true } : f.id === 'epl-2026-131' ? { ...f, saleDates: { members: '2026-11-02' } } : f));
    const moved = FEED.map((r) => (r.MatchNumber === 131 ? { ...r, DateUtc: '2026-12-06 16:30:00Z' } : r));
    const { fixtures, changes, added } = mergeFixtures(first, [...mapFeed(moved, 2026), { id: 'epl-2026-250', date: '2027-02-06', opponent: 'Brentford', home: true, competition: 'Premier League' }]);
    expect(added).toBe(1);
    expect(changes).toEqual([{ id: 'epl-2026-131', opponent: 'Everton', home: true, from: { date: '2026-12-05', kickoffUtc: '2026-12-05T15:00:00Z' }, to: { date: '2026-12-06', kickoffUtc: '2026-12-06T16:30:00Z' } }]);
    expect(fixtures).toHaveLength(6);
    expect(fixtures.find((f) => f.id === 'epl-2026-131')).toMatchObject({ date: '2026-12-06', saleDates: { members: '2026-11-02' } });
    expect(fixtures.find((f) => f.id === 'epl-2026-5')?.attended).toBe(true);
    expect(mergeFixtures(first, mapFeed(FEED, 2026))).toMatchObject({ changes: [], added: 0 });
  });

  it('reads cup fixtures from a calendar file', () => {
    const ics = [
      'BEGIN:VEVENT', 'UID:fa-3', 'SUMMARY:Chelsea v Millwall', 'LOCATION:Stamford Bridge', 'DTSTART:20270109T173000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Barcelona vs Chelsea (Champions League)', 'CATEGORIES:Champions League', 'DTSTART;TZID=Europe/Madrid:20270216T210000', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Arsenal v Spurs', 'DTSTART:20270110T140000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Board meeting', 'DTSTART:20270111T090000Z', 'END:VEVENT',
    ].join('\n');
    const { fixtures, skipped } = fixturesFromIcs(parseIcs(ics), 'FA Cup');
    expect(skipped).toBe(2);
    expect(fixtures).toEqual([
      { id: 'ics-fa-3', date: '2027-01-09', kickoffUtc: '2027-01-09T17:30:00Z', opponent: 'Millwall', home: true, competition: 'FA Cup', venue: 'Stamford Bridge' },
      { id: 'ics-champions-league-barcelona-a-2027-02-16', date: '2027-02-16', kickoffUtc: '2027-02-16T20:00:00Z', opponent: 'Barcelona', home: false, competition: 'Champions League', venue: undefined },
    ]);
  });
});

describe('crossing with the ledger', () => {
  const fx = mapFeed(FEED, 2026);
  const byId = (n: number) => fx.find((f) => f.id === `epl-2026-${n}`)!;

  it('says where the ledger has you on a date', () => {
    expect(whereOn('2026-12-05', STAYS)).toEqual({ where: 'in-london', city: 'london' });
    expect(whereOn('2026-12-20', STAYS)).toEqual({ where: 'away', city: 'istanbul' });
    expect(whereOn('2026-08-15', STAYS)).toEqual({ where: 'no-plans', city: null });
    // A travel day that touches London counts as in London.
    expect(whereOn('2026-12-12', STAYS).where).toBe('in-london');
    // An open-ended stay runs on until another stay begins.
    expect(whereOn('2027-03-01', STAYS).where).toBe('in-london');
    expect(whereOn('2027-03-01', [...STAYS, stay('E', 'istanbul', 'TR', '2027-02-01', '2027-04-01')]).where).toBe('away');
  });

  it('knows which away grounds are in London', () => {
    expect(matchCity(byId(131))).toBe('London');
    expect(matchCity(byId(14))).toBe('London');
    expect(matchCity(byId(140))).toBe('Newcastle');
    expect(matchCity({ ...byId(140), opponent: 'Newcastle United' })).toBe('Newcastle');
    expect(matchCity({ ...byId(140), opponent: 'Barcelona' })).toBeNull();
  });

  it('marks the matches you can attend', () => {
    expect(canAttend(byId(131), STAYS)).toBe(true); // home, in London
    expect(canAttend(byId(140), STAYS)).toBe(false); // in London that day, but the match is in Newcastle
    expect(canAttend(byId(201), STAYS)).toBe(true); // back in London, open-ended
    expect(canAttend({ ...byId(131), date: '2026-12-20' }, STAYS)).toBe(false); // in Istanbul
  });
});

describe('sale windows', () => {
  const fx = mapFeed(FEED, 2026);
  const everton = fx.find((f) => f.opponent === 'Everton')!; // home league, 5 Dec
  const liverpool = fx.find((f) => f.opponent === 'Liverpool')!; // home league, 16 Jan

  it('picks the offsets by category', () => {
    expect(saleCategory(everton)).toBe('homeLeague');
    expect(saleCategory(fx[1])).toBe('away');
    expect(saleCategory({ ...everton, competition: 'FA Cup' })).toBe('cup');
    expect(saleCategory({ ...everton, competition: 'FA Cup', home: false })).toBe('away');
  });

  it('estimates each phase from the offsets and lets a typed date win', () => {
    // 5 Dec minus 49, 42, 35, 21 days.
    expect(saleWindows(everton, DEFAULT_SALE).map((w) => [w.phase.id, w.opens, w.confirmed])).toEqual([
      ['sth', '2026-10-17', false],
      ['points', '2026-10-24', false],
      ['members', '2026-10-31', false],
      ['general', '2026-11-14', false],
    ]);
    const typed = saleWindows({ ...everton, saleDates: { members: '2026-11-03' } }, DEFAULT_SALE);
    expect(typed[2]).toMatchObject({ opens: '2026-11-03', confirmed: true });
    expect(typed[3].confirmed).toBe(false);
  });

  it('alerts for windows open now or opening within N days, on attendable matches only', () => {
    // Members: Everton opened 31 Oct (open now). Liverpool (16 Jan) opens 12 Dec: 19 days away, outside 7.
    const alerts = saleAlerts(fx, STAYS, DEFAULT_SALE, TODAY);
    expect(alerts.map((a) => [a.fixture.opponent, a.state, a.inDays])).toEqual([['Everton', 'open-now', -23]]);
    // On 6 Dec Everton is past and Liverpool is 6 days off.
    expect(saleAlerts(fx, STAYS, DEFAULT_SALE, '2026-12-06').map((a) => [a.fixture.opponent, a.state, a.inDays])).toEqual([['Liverpool', 'opens-soon', 6]]);
    // A wider horizon picks Liverpool up today; "have a ticket" silences Everton.
    const wide = saleAlerts(fx.map((f) => (f === everton ? { ...f, ticket: 'have' as const } : f)), STAYS, { ...DEFAULT_SALE, alertDays: 30 }, TODAY);
    expect(wide.map((a) => a.fixture.opponent)).toEqual(['Liverpool']);
    // No London stays, no alerts.
    expect(saleAlerts(fx, [], DEFAULT_SALE, TODAY)).toEqual([]);
  });

  it('exports upcoming windows as all-day events with two reminders', () => {
    const events = saleWindowEvents([everton, liverpool], DEFAULT_SALE, TODAY);
    // Everton's members window is already open, so only Liverpool's is still ahead.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uid: 'sale-epl-2026-201-members@two-city', summary: 'Tickets: Chelsea v Liverpool (Members, estimated)', start: { date: '2026-12-12' } });
    const text = writeIcs(events, { name: 'Ticket sales', stamp: '2026-11-23T10:00:00Z' });
    expect(text).toContain('DTSTART;VALUE=DATE:20261212');
    expect(text).toContain('TRIGGER:-PT6H');
    expect(text).toContain('TRIGGER:PT9H');
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2);
    const confirmed = saleWindowEvents([{ ...liverpool, saleDates: { members: '2026-12-15' } }], DEFAULT_SALE, TODAY);
    expect(confirmed[0]).toMatchObject({ summary: 'Tickets: Chelsea v Liverpool (Members)', start: { date: '2026-12-15' } });
  });
});
