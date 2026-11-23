// Matchday: fixtures in, crossed with the ledger's London dates, plus ticket
// sale windows. The club publishes on-sale dates match by match and there is no
// feed of them, so windows are estimates from editable offsets until the owner
// types the confirmed date.
import { addDays, clockIn, dayIn, daysBetween, fmtDay } from './dates.ts';
import type { Day } from './dates.ts';
import { fold } from './airports.ts';
import type { IcsEvent, IcsOutEvent } from './ics.ts';
import type { Stay } from './ledger.ts';

export interface Fixture {
  id: string;
  /** Date of the match in London. */
  date: Day;
  /** ISO instant, when the kick-off time is known. */
  kickoffUtc?: string;
  opponent: string;
  home: boolean;
  competition: string;
  venue?: string;
  attended?: boolean;
  /** Confirmed on-sale dates typed by the owner, by phase id. Missing = estimated. */
  saleDates?: Record<string, Day>;
  /** 'have' or 'skip' silences sale alerts for this match. */
  ticket?: 'have' | 'skip';
}

export const TEAM = 'Chelsea';
export const TICKETS_URL = 'https://www.chelseafc.com/en/tickets';

/** Season start year for a date: the season turns over on 1 July. */
export const seasonFor = (today: Day): number => (today.slice(5) >= '07-01' ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1);

export const feedUrl = (season: number): string => `https://fixturedownload.com/feed/json/epl-${season}/chelsea`;

interface FeedRow {
  MatchNumber: number;
  RoundNumber?: number;
  DateUtc: string;
  Location?: string;
  HomeTeam: string;
  AwayTeam: string;
}

const isFeedRow = (r: unknown): r is FeedRow => {
  const o = r as Record<string, unknown> | null;
  return !!o && typeof o === 'object' && typeof o.MatchNumber === 'number' && typeof o.DateUtc === 'string' && typeof o.HomeTeam === 'string' && typeof o.AwayTeam === 'string';
};

/** Map the fixturedownload.com feed to fixtures. Throws with a readable message when the payload is not the expected shape. */
export function mapFeed(json: unknown, season: number): Fixture[] {
  if (!Array.isArray(json)) throw new Error('The fixture feed did not return a list.');
  const out: Fixture[] = [];
  for (const row of json) {
    if (!isFeedRow(row)) continue;
    const home = row.HomeTeam === TEAM;
    if (!home && row.AwayTeam !== TEAM) continue;
    const iso = row.DateUtc.trim().replace(' ', 'T');
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    const kickoffUtc = new Date(t).toISOString().replace('.000Z', 'Z');
    out.push({
      id: `epl-${season}-${row.MatchNumber}`,
      date: dayIn('Europe/London', new Date(t)),
      kickoffUtc,
      opponent: home ? row.AwayTeam : row.HomeTeam,
      home,
      competition: 'Premier League',
      venue: row.Location || undefined,
    });
  }
  if (!out.length) throw new Error('The fixture feed had no Chelsea matches in it.');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface FixtureChange {
  id: string;
  opponent: string;
  home: boolean;
  from: { date: Day; kickoffUtc?: string };
  to: { date: Day; kickoffUtc?: string };
}

const sameMatch = (a: Fixture, b: Fixture) =>
  a.id === b.id || (fold(a.opponent) === fold(b.opponent) && a.home === b.home && fold(a.competition) === fold(b.competition) && Math.abs(daysBetween(a.date, b.date)) < 150);

/** Refresh: update dates of matches already known (kick-offs move for TV), add new ones, keep the owner's marks. */
export function mergeFixtures(existing: Fixture[], incoming: Fixture[]): { fixtures: Fixture[]; changes: FixtureChange[]; added: number } {
  const out = [...existing];
  const changes: FixtureChange[] = [];
  let added = 0;
  for (const inc of incoming) {
    const i = out.findIndex((f) => sameMatch(f, inc));
    if (i < 0) {
      out.push(inc);
      added++;
      continue;
    }
    const old = out[i];
    if (old.date !== inc.date || (inc.kickoffUtc && old.kickoffUtc !== inc.kickoffUtc)) {
      changes.push({ id: old.id, opponent: old.opponent, home: old.home, from: { date: old.date, kickoffUtc: old.kickoffUtc }, to: { date: inc.date, kickoffUtc: inc.kickoffUtc } });
    }
    out[i] = { ...old, date: inc.date, kickoffUtc: inc.kickoffUtc ?? old.kickoffUtc, venue: inc.venue ?? old.venue };
  }
  return { fixtures: out.sort((a, b) => a.date.localeCompare(b.date)), changes, added };
}

/** Fixtures from calendar events titled like "Chelsea v Arsenal" or "Arsenal vs Chelsea" (cups, Europe). */
export function fixturesFromIcs(events: IcsEvent[], competition: string): { fixtures: Fixture[]; skipped: number } {
  const fixtures: Fixture[] = [];
  let skipped = 0;
  for (const e of events) {
    const m = /^(.*?)\s+(?:v|vs|vs\.|-|–|—)\s+(.*)$/i.exec(e.summary.replace(/[⚽🏆]/gu, '').trim());
    if (!m || !e.start) {
      skipped++;
      continue;
    }
    const clean = (s: string) => s.replace(/\s*[([].*$/, '').trim();
    const [a, b] = [clean(m[1]), clean(m[2])];
    const home = fold(a).includes('chelsea');
    if (!home && !fold(b).includes('chelsea')) {
      skipped++;
      continue;
    }
    const opponent = home ? b : a;
    const date = e.start.instant !== null ? dayIn('Europe/London', new Date(e.start.instant)) : e.start.date;
    const comp = e.categories[0] || competition || 'Other';
    fixtures.push({
      id: e.uid ? `ics-${e.uid}` : `ics-${fold(comp)}-${fold(opponent)}-${home ? 'h' : 'a'}-${date}`.replace(/[^a-z0-9-]+/g, '-'),
      date,
      kickoffUtc: e.start.instant !== null ? new Date(e.start.instant).toISOString().replace('.000Z', 'Z') : undefined,
      opponent,
      home,
      competition: comp,
      venue: e.location || undefined,
    });
  }
  return { fixtures, skipped };
}

// ---------------------------------------------------------------- crossing with the ledger

/** Where each English top-flight regular plays, for "can I get to this away match from London". */
const CLUB_CITY: Record<string, string> = {
  arsenal: 'London', 'aston villa': 'Birmingham', bournemouth: 'Bournemouth', brentford: 'London', brighton: 'Brighton', burnley: 'Burnley',
  'crystal palace': 'London', everton: 'Liverpool', fulham: 'London', ipswich: 'Ipswich', leeds: 'Leeds', leicester: 'Leicester', liverpool: 'Liverpool',
  'man city': 'Manchester', 'manchester city': 'Manchester', 'man utd': 'Manchester', 'man united': 'Manchester', 'manchester united': 'Manchester',
  newcastle: 'Newcastle', "nott'm forest": 'Nottingham', 'nottingham forest': 'Nottingham', sheffield: 'Sheffield', southampton: 'Southampton',
  spurs: 'London', tottenham: 'London', sunderland: 'Sunderland', 'west ham': 'London', wolves: 'Wolverhampton', wolverhampton: 'Wolverhampton',
  watford: 'Watford', norwich: 'Norwich', 'west brom': 'West Bromwich', millwall: 'London', qpr: 'London', charlton: 'London',
};

/** City the match is played in: London for home games, the opponent's city for away games when known. */
export function matchCity(f: Fixture): string | null {
  if (f.home) return 'London';
  const name = fold(f.opponent);
  const key = Object.keys(CLUB_CITY).find((k) => name === k || name.startsWith(`${k} `));
  return key ? CLUB_CITY[key] : null;
}

export type Whereabouts = 'in-london' | 'away' | 'no-plans';

/** What the ledger says about a date: in London, somewhere else, or nothing booked. */
export function whereOn(date: Day, stays: Stay[]): { where: Whereabouts; city: string | null } {
  // An open-ended stay runs until the next stay begins.
  const covering = stays.filter((s) => s.arrive <= date && (s.depart !== null ? date <= s.depart : !stays.some((o) => o.arrive > s.arrive && o.arrive <= date)));
  if (covering.some((s) => s.city === 'london')) return { where: 'in-london', city: 'london' };
  if (covering.length) return { where: 'away', city: covering[covering.length - 1].city };
  return { where: 'no-plans', city: null };
}

/** A match you can get to: played in London on a date the ledger has you in London. */
export const canAttend = (f: Fixture, stays: Stay[]): boolean => matchCity(f) === 'London' && whereOn(f.date, stays).where === 'in-london';

// ---------------------------------------------------------------- sale windows

export type SaleCategory = 'homeLeague' | 'away' | 'cup';

export interface SalePhase {
  id: string;
  label: string;
}

export interface SaleSettings {
  phases: SalePhase[];
  /** Days before the match each phase is assumed to open, per category, by phase id. */
  offsets: Record<SaleCategory, Record<string, number>>;
  /** The phase that applies to the owner. */
  myPhase: string;
  /** Alert when a window opens within this many days. */
  alertDays: number;
}

export const DEFAULT_SALE: SaleSettings = {
  phases: [
    { id: 'sth', label: 'Season-ticket holders' },
    { id: 'points', label: 'Members with loyalty points' },
    { id: 'members', label: 'Members' },
    { id: 'general', label: 'General sale' },
  ],
  offsets: {
    homeLeague: { sth: 49, points: 42, members: 35, general: 21 },
    away: { sth: 35, points: 30, members: 26, general: 21 },
    cup: { sth: 21, points: 17, members: 14, general: 10 },
  },
  myPhase: 'members',
  alertDays: 7,
};

export const saleCategory = (f: Fixture): SaleCategory => (!f.home ? 'away' : fold(f.competition).includes('premier league') ? 'homeLeague' : 'cup');

export interface SaleWindow {
  phase: SalePhase;
  opens: Day;
  confirmed: boolean;
}

export function saleWindows(f: Fixture, settings: SaleSettings): SaleWindow[] {
  const offsets = settings.offsets[saleCategory(f)] ?? {};
  return settings.phases.map((phase) => {
    const typed = f.saleDates?.[phase.id];
    return typed ? { phase, opens: typed, confirmed: true } : { phase, opens: addDays(f.date, -(offsets[phase.id] ?? 0)), confirmed: false };
  });
}

export interface SaleAlert {
  fixture: Fixture;
  window: SaleWindow;
  state: 'open-now' | 'opens-soon';
  /** Days until it opens (0 or less = open). */
  inDays: number;
}

/** Windows for the owner's phase that are open now or open within `alertDays`, on matches they can attend. */
export function saleAlerts(fixtures: Fixture[], stays: Stay[], settings: SaleSettings, today: Day): SaleAlert[] {
  const out: SaleAlert[] = [];
  for (const f of fixtures) {
    if (f.date < today || f.ticket || !canAttend(f, stays)) continue;
    const window = saleWindows(f, settings).find((w) => w.phase.id === settings.myPhase);
    if (!window) continue;
    const inDays = daysBetween(today, window.opens);
    if (inDays <= 0) out.push({ fixture: f, window, state: 'open-now', inDays });
    else if (inDays <= settings.alertDays) out.push({ fixture: f, window, state: 'opens-soon', inDays });
  }
  return out.sort((a, b) => a.window.opens.localeCompare(b.window.opens) || a.fixture.date.localeCompare(b.fixture.date));
}

export const fixtureTitle = (f: Fixture): string => (f.home ? `${TEAM} v ${f.opponent}` : `${f.opponent} v ${TEAM}`);

/** Calendar events for upcoming sale windows of the owner's phase, each with a reminder the evening before and at 09:00 on the day. */
export function saleWindowEvents(fixtures: Fixture[], settings: SaleSettings, today: Day): IcsOutEvent[] {
  const out: IcsOutEvent[] = [];
  for (const f of fixtures) {
    if (f.date < today || f.ticket) continue;
    const w = saleWindows(f, settings).find((x) => x.phase.id === settings.myPhase);
    if (!w || w.opens < today) continue;
    const summary = `Tickets: ${fixtureTitle(f)} (${w.phase.label}${w.confirmed ? '' : ', estimated'})`;
    out.push({
      uid: `sale-${f.id}-${w.phase.id}@two-city`,
      summary,
      description: `${fixtureTitle(f)}, ${f.competition}, ${fmtDay(f.date)}.\n${w.confirmed ? 'On-sale date confirmed from the club site.' : 'Estimated on-sale date: check the club site and correct it in Two City.'}`,
      url: TICKETS_URL,
      start: { date: w.opens },
      alarms: [
        { offsetMin: -360, text: `Tomorrow: ${summary}` },
        { offsetMin: 540, text: summary },
      ],
    });
  }
  return out;
}

/** Kick-off as 'HH:MM' London time, or '' when unknown. */
export function kickoffLondon(f: Fixture): string {
  if (!f.kickoffUtc) return '';
  const t = Date.parse(f.kickoffUtc);
  return Number.isNaN(t) ? '' : clockIn('Europe/London', new Date(t));
}
