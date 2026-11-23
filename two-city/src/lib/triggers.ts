// Dream-trip triggers. A trip has a season that recurs every year, routes to
// watch and a fare log; each trigger is evaluated by a pure function of `today`
// and the trip's logged data. No fare API is bundled: fares are typed, pasted
// or imported.
import { addDays, daysBetween, fmtDay, isDay } from './dates.ts';
import type { Day } from './dates.ts';
import { findDates } from './bookings.ts';
import type { IcsOutEvent } from './ics.ts';

export interface Route {
  from: string;
  to: string;
}

export interface Fare {
  id: string;
  /** Date the price was observed. */
  on: Day;
  from: string;
  to: string;
  price: number;
  currency: string;
  source: string;
}

export interface DateTrigger {
  id: string;
  /** 'opens': something becomes bookable. 'decide' and 'book': deadlines. */
  kind: 'opens' | 'decide' | 'book';
  label: string;
  /** Counted back from the season start, or from the target travel date when one is set. */
  anchor: 'season' | 'travel';
  daysBefore: number;
  /** A date the owner set by hand; overrides the offset. */
  fixedDate?: Day;
  doneOn?: Day;
}

export interface FareTrigger {
  id: string;
  kind: 'fare';
  label: string;
  from: string;
  to: string;
  currency: string;
  /** Fires when the latest fare is at or below this. */
  targetPrice?: number;
  /** Fires when the latest fare is this many percent below the trailing median. */
  dropPct?: number;
  /** How far back the trailing median looks, in days. */
  medianDays: number;
}

export type Trigger = DateTrigger | FareTrigger;

export interface Trip {
  id: string;
  name: string;
  destination: string;
  /** Recurring yearly window, 'MM-DD' to 'MM-DD' (may wrap over New Year). */
  season: { from: string; to: string };
  routes: Route[];
  travel?: { from: Day; to?: Day };
  notes: string;
  /** True while the trip still carries template dates nobody has confirmed. */
  template?: boolean;
  triggers: Trigger[];
  fares: Fare[];
}

export type Status = 'waiting' | 'coming-up' | 'open-now' | 'fired' | 'missed';

export const STATUS_LABEL: Record<Status, string> = { waiting: 'Waiting', 'coming-up': 'Coming up', 'open-now': 'Open now', fired: 'Fired', missed: 'Missed' };

/** Days ahead at which a date trigger turns from waiting to coming up. */
export const SOON_DAYS = 14;
/** A fare observation older than this no longer counts as live. */
export const FRESH_DAYS = 7;

const mmdd = (year: number, md: string): Day => {
  const day = `${year}-${md}`;
  return isDay(day) ? day : `${year}-02-28`; // 29 Feb in a common year
};

/** The season under way on `today`, or the next one to start. */
export function seasonWindow(season: Trip['season'], today: Day): { start: Day; end: Day } {
  const y = Number(today.slice(0, 4));
  for (const year of [y - 1, y, y + 1]) {
    const start = mmdd(year, season.from);
    const end = season.to >= season.from ? mmdd(year, season.to) : mmdd(year + 1, season.to);
    if (end >= today) return { start, end };
  }
  return { start: mmdd(y + 1, season.from), end: mmdd(y + 2, season.to) };
}

/** What a date trigger counts back from: the travel dates when set, else the season. */
export function anchorWindow(trip: Trip, anchor: DateTrigger['anchor'], today: Day): { start: Day; end: Day } {
  if (anchor === 'travel' && trip.travel && isDay(trip.travel.from)) return { start: trip.travel.from, end: trip.travel.to && isDay(trip.travel.to) ? trip.travel.to : trip.travel.from };
  return seasonWindow(trip.season, today);
}

export const triggerDate = (trip: Trip, t: DateTrigger, today: Day): Day => (t.fixedDate && isDay(t.fixedDate) ? t.fixedDate : addDays(anchorWindow(trip, t.anchor, today).start, -t.daysBefore));

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface FareStats {
  /** Observations for the trigger's route and currency, oldest first. */
  log: Fare[];
  latest: Fare | null;
  /** Median of earlier observations inside the look-back window; needs at least three. */
  median: number | null;
  /** The price at or below which the trigger fires: the higher of the target and the drop line. */
  threshold: number | null;
  hit: boolean;
}

export function fareStats(fares: Fare[], t: FareTrigger): FareStats {
  const log = fares
    .filter((f) => f.from === t.from && f.to === t.to && f.currency === t.currency && Number.isFinite(f.price))
    .sort((a, b) => a.on.localeCompare(b.on));
  const latest = log[log.length - 1] ?? null;
  if (!latest) return { log, latest, median: null, threshold: t.targetPrice ?? null, hit: false };
  const prior = log.filter((f) => f.on < latest.on && f.on >= addDays(latest.on, -t.medianDays)).map((f) => f.price);
  const med = prior.length >= 3 ? median(prior) : null;
  const dropLine = med !== null && t.dropPct ? med * (1 - t.dropPct / 100) : null;
  const lines = [t.targetPrice, dropLine].filter((x): x is number => typeof x === 'number');
  const threshold = lines.length ? Math.max(...lines) : null;
  return { log, latest, median: med, threshold, hit: threshold !== null && latest.price <= threshold };
}

export interface TriggerState {
  tripId: string;
  tripName: string;
  trigger: Trigger;
  status: Status;
  /** The next date that matters for this trigger, if there is one. */
  date: Day | null;
  detail: string;
}

const money = (n: number, currency: string) => `${Math.round(n * 100) / 100} ${currency}`;

export function evaluateTrigger(trip: Trip, t: Trigger, today: Day): TriggerState {
  const base = { tripId: trip.id, tripName: trip.name, trigger: t };
  if (t.kind === 'fare') {
    const s = fareStats(trip.fares, t);
    if (!s.latest) return { ...base, status: 'waiting', date: null, detail: 'No fares logged for this route yet.' };
    const age = daysBetween(s.latest.on, today);
    const seen = `${money(s.latest.price, t.currency)} seen ${fmtDay(s.latest.on, { weekday: false })}`;
    const versus = s.median !== null ? `, median ${money(s.median, t.currency)}` : '';
    if (s.hit && age <= FRESH_DAYS) return { ...base, status: 'fired', date: s.latest.on, detail: `${seen}: at or below ${money(s.threshold!, t.currency)}${versus}.` };
    if (s.hit) return { ...base, status: 'missed', date: s.latest.on, detail: `${seen} hit the threshold, but that was ${age} days ago. Log a fresh fare.` };
    if (s.threshold === null) return { ...base, status: 'waiting', date: null, detail: `${seen}. ${t.dropPct && !t.targetPrice ? 'A drop needs three earlier fares in the window to compare against.' : 'No threshold set.'}` };
    const close = s.latest.price <= s.threshold * 1.1;
    return { ...base, status: close ? 'coming-up' : 'waiting', date: null, detail: `${seen}; fires at ${money(s.threshold, t.currency)}${versus}.` };
  }
  const window = anchorWindow(trip, t.anchor, today);
  const date = triggerDate(trip, t, today);
  if (t.doneOn && t.doneOn > addDays(window.end, -365)) return { ...base, status: 'fired', date: null, detail: `Done on ${fmtDay(t.doneOn, { weekday: false })}.` };
  const days = daysBetween(today, date);
  if (days > SOON_DAYS) return { ...base, status: 'waiting', date, detail: `${fmtDay(date)}, in ${days} days.` };
  if (days > 0) return { ...base, status: 'coming-up', date, detail: `${fmtDay(date)}, in ${days} ${days === 1 ? 'day' : 'days'}.` };
  if (t.kind === 'opens') {
    if (today <= window.end) return { ...base, status: 'open-now', date: window.start >= today ? window.start : window.end, detail: `Open since ${fmtDay(date, { weekday: false })}.` };
    return { ...base, status: 'missed', date: null, detail: `Opened ${fmtDay(date, { weekday: false })}; the dates have passed.` };
  }
  if (days === 0) return { ...base, status: 'open-now', date, detail: 'Due today.' };
  return { ...base, status: 'missed', date, detail: `Was due ${fmtDay(date, { weekday: false })}.` };
}

export const evaluateTrip = (trip: Trip, today: Day): TriggerState[] => trip.triggers.map((t) => evaluateTrigger(trip, t, today));

const RANK: Record<Status, number> = { fired: 0, 'open-now': 1, 'coming-up': 2, missed: 3, waiting: 4 };

/** Across all trips: everything that needs attention now, then the next waiting date per trip. */
export function whatMattersNext(trips: Trip[], today: Day): TriggerState[] {
  const all = trips.flatMap((t) => evaluateTrip(t, today));
  const live = all.filter((s) => s.status !== 'waiting' && !(s.status === 'fired' && s.trigger.kind !== 'fare'));
  const waiting = trips
    .map((trip) => all.filter((s) => s.tripId === trip.id && s.status === 'waiting' && s.date).sort((a, b) => a.date!.localeCompare(b.date!))[0])
    .filter((s): s is TriggerState => Boolean(s));
  return [...live, ...waiting].sort((a, b) => RANK[a.status] - RANK[b.status] || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

/** Calendar events for trigger dates still ahead, with a reminder at 09:00 the day before and on the day. */
export function triggerEvents(trips: Trip[], today: Day): IcsOutEvent[] {
  const out: IcsOutEvent[] = [];
  for (const trip of trips) {
    for (const t of trip.triggers) {
      if (t.kind === 'fare' || t.doneOn) continue;
      const date = triggerDate(trip, t, today);
      if (date < today) continue;
      const summary = `${trip.name}: ${t.label}`;
      out.push({
        uid: `trigger-${trip.id}-${t.id}@two-city`,
        summary,
        description: `${trip.destination}${trip.template ? '\nTemplate dates: confirm with the operator.' : ''}`,
        start: { date },
        alarms: [
          { offsetMin: -900, text: `Tomorrow: ${summary}` },
          { offsetMin: 540, text: summary },
        ],
      });
    }
  }
  return out.sort((a, b) => a.start.date.localeCompare(b.start.date));
}

// ---------------------------------------------------------------- fare log input

const CURRENCY_SIGNS: Record<string, string> = { '£': 'GBP', '€': 'EUR', $: 'USD', '₺': 'TRY', TL: 'TRY', KR: 'NOK' };

/** '1,234.50', '1.234,50', '12.450', '412' -> number. */
export function parsePrice(s: string): number | null {
  let t = s.replace(/\s/g, '');
  const comma = t.lastIndexOf(',');
  const dot = t.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (comma >= 0) t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
  else if (dot >= 0 && /\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface FareInput {
  fares: Omit<Fare, 'id'>[];
  errors: string[];
}

/**
 * Fares from pasted text. Either JSON (a list of { on, from, to, price, currency, source })
 * or one fare per line, e.g. "2026-11-23, LHR-TOS, 412 GBP, airline site".
 * A line without a route or currency takes the defaults.
 */
export function parseFares(text: string, defaults: { from: string; to: string; currency: string }): FareInput {
  const fares: Omit<Fare, 'id'>[] = [];
  const errors: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { fares, errors };
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return { fares, errors: ['That looks like JSON but does not parse.'] };
    }
    const rows = Array.isArray(json) ? json : Array.isArray((json as { fares?: unknown }).fares) ? (json as { fares: unknown[] }).fares : [json];
    rows.forEach((r, i) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const on = o.on ?? o.date;
      const route = typeof o.route === 'string' ? /([A-Za-z]{3})\W+([A-Za-z]{3})/.exec(o.route) : null;
      const from = String(o.from ?? route?.[1] ?? defaults.from).toUpperCase();
      const to = String(o.to ?? route?.[2] ?? defaults.to).toUpperCase();
      const price = typeof o.price === 'number' ? o.price : parsePrice(String(o.price ?? ''));
      if (!isDay(on) || price === null || !(price > 0)) {
        errors.push(`Item ${i + 1}: needs "on" (YYYY-MM-DD) and a positive "price".`);
        return;
      }
      fares.push({ on, from, to, price, currency: String(o.currency ?? defaults.currency).toUpperCase(), source: String(o.source ?? 'import') });
    });
    return { fares, errors };
  }
  trimmed.split(/\r\n|\n|\r/).forEach((line, i) => {
    if (!line.trim()) return;
    let rest = line;
    const date = findDates(line)[0];
    if (!date) {
      errors.push(`Line ${i + 1}: no date found.`);
      return;
    }
    rest = rest.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4}|\d{1,2}\s+\p{L}{3,9}\.?,?\s+\d{4}/u, ' ');
    const route = /\b([A-Z]{3})\s*(?:-|–|>|→|\/|\bto\b)\s*([A-Z]{3})\b/.exec(rest);
    if (route) rest = rest.replace(route[0], ' ');
    const CUR = '(GBP|EUR|USD|TRY|NOK|TL|£|€|\\$|₺)';
    const before = new RegExp(`${CUR}\\s*(\\d[\\d.,]*)`, 'i').exec(rest);
    const after = before ? null : new RegExp(`(\\d[\\d.,]*?)[\\s,;|]*${CUR}(?![A-Za-z])`, 'i').exec(rest);
    const bare = before || after ? null : /\d[\d.,]*/.exec(rest);
    const priced = before ?? after ?? bare;
    const price = priced ? parsePrice((before ? before[2] : after ? after[1] : bare![0]).replace(/[.,]+$/, '')) : null;
    if (!priced || price === null) {
      errors.push(`Line ${i + 1}: no price found.`);
      return;
    }
    const cur = (before ? before[1] : after ? after[2] : defaults.currency).toUpperCase();
    rest = rest.replace(priced[0], ' ');
    const source = rest.replace(/^[\s,;|\t-]+|[\s,;|\t-]+$/g, '').replace(/\s*[,;|\t]\s*/g, ' ').trim();
    fares.push({ on: date.value, from: route ? route[1] : defaults.from, to: route ? route[2] : defaults.to, price, currency: CURRENCY_SIGNS[cur] ?? cur, source: source || 'pasted' });
  });
  return { fares, errors };
}

// ---------------------------------------------------------------- starter template

/** Norway orca season. A template: the dates are approximate and must be confirmed with the operator. */
export function orcaTemplate(id: string): Trip {
  return {
    id,
    name: 'Norway orca season',
    destination: 'Skjervøy and Tromsø, northern Norway',
    season: { from: '10-25', to: '01-25' },
    routes: [
      { from: 'LHR', to: 'TOS' },
      { from: 'IST', to: 'TOS' },
    ],
    notes: 'Orcas follow the herring into the fjords around Skjervøy from roughly late October to late January; the dates shift year to year. Confirm season dates and the booking window with the operator, then edit the triggers.',
    template: true,
    triggers: [
      { id: 'schedule', kind: 'opens', label: 'Airline schedules open for the start of the season', anchor: 'season', daysBefore: 330 },
      { id: 'operator', kind: 'opens', label: 'Operator booking window opens (set the real date)', anchor: 'season', daysBefore: 270 },
      { id: 'decide', kind: 'decide', label: 'Decide whether this is the year', anchor: 'season', daysBefore: 150 },
      { id: 'book', kind: 'book', label: 'Book boat and flights', anchor: 'season', daysBefore: 120 },
      { id: 'fare-lhr', kind: 'fare', label: 'Fare drop, London to Tromsø', from: 'LHR', to: 'TOS', currency: 'GBP', dropPct: 20, medianDays: 60 },
      { id: 'fare-ist', kind: 'fare', label: 'Fare drop, Istanbul to Tromsø', from: 'IST', to: 'TOS', currency: 'TRY', dropPct: 20, medianDays: 60 },
    ],
    fares: [],
  };
}

export const blankTrip = (id: string): Trip => ({ id, name: '', destination: '', season: { from: '06-01', to: '08-31' }, routes: [], notes: '', triggers: [], fares: [] });
