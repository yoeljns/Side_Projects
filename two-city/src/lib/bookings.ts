// "Fills itself from bookings": flight segments read from calendar files and
// pasted confirmation emails, turned into stays, with a plan to review before
// anything is saved. Nothing here talks to an inbox or an airline.
import { AIRPORT, AIRPORT_NAMES, cityKey, fold } from './airports.ts';
import { addDays, isDay } from './dates.ts';
import type { Day } from './dates.ts';
import { dateInZone } from './ics.ts';
import type { IcsEvent } from './ics.ts';
import { sortStays } from './ledger.ts';
import type { Stay } from './ledger.ts';

export interface Segment {
  /** IATA codes. */
  from: string;
  to: string;
  /** Local date of departure and of arrival. */
  depart: Day;
  arrive: Day;
  flight: string | null;
}

// ---------------------------------------------------------------- text scanning

const MONTH_WORDS: Record<string, number> = {};
[
  ['jan', 'january', 'ocak', 'oca'], ['feb', 'february', 'subat', 'sub'], ['mar', 'march', 'mart'], ['apr', 'april', 'nisan', 'nis'],
  ['may', 'mayis'], ['jun', 'june', 'haziran', 'haz'], ['jul', 'july', 'temmuz', 'tem'], ['aug', 'august', 'agustos', 'agu'],
  ['sep', 'sept', 'september', 'eylul', 'eyl'], ['oct', 'october', 'ekim', 'eki'], ['nov', 'november', 'kasim', 'kas'], ['dec', 'december', 'aralik', 'ara'],
].forEach((names, i) => names.forEach((n) => (MONTH_WORDS[n] = i + 1)));

const pad = (n: number) => String(n).padStart(2, '0');
const mk = (y: number, m: number, d: number): Day | null => {
  const day = `${y}-${pad(m)}-${pad(d)}`;
  return isDay(day) ? day : null;
};

interface Found<T> {
  pos: number;
  value: T;
}

/** Dates in a line, in reading order. English and Turkish month names, 15.08.2026, 15/08/2026 (day first), 2026-08-15, 15AUG26. */
export function findDates(line: string): Found<Day>[] {
  const s = fold(line);
  const out: Found<Day>[] = [];
  const add = (pos: number, day: Day | null) => {
    if (day && !out.some((o) => Math.abs(o.pos - pos) < 4)) out.push({ pos, value: day });
  };
  for (const m of s.matchAll(/\b(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const month = MONTH_WORDS[m[2]];
    if (month) add(m.index, mk(Number(m[3]), month, Number(m[1])));
  }
  for (const m of s.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const month = MONTH_WORDS[m[1]];
    if (month) add(m.index, mk(Number(m[3]), month, Number(m[2])));
  }
  for (const m of s.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) add(m.index, mk(Number(m[3]), Number(m[2]), Number(m[1])));
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(m.index, mk(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of s.matchAll(/\b(\d{2})([a-z]{3})(\d{2}|\d{4})\b/g)) {
    const month = MONTH_WORDS[m[2]];
    const y = Number(m[3]);
    if (month) add(m.index, mk(y < 100 ? 2000 + y : y, month, Number(m[1])));
  }
  return out.sort((a, b) => a.pos - b.pos);
}

type AirMode = 'paren' | 'bare' | 'name';

function findAirportsBy(line: string, mode: AirMode): Found<string>[] {
  const out: Found<string>[] = [];
  if (mode === 'paren') {
    for (const m of line.matchAll(/\(([A-Z]{3})\)/g)) if (AIRPORT[m[1]]) out.push({ pos: m.index, value: m[1] });
    return out;
  }
  if (mode === 'bare') {
    for (const m of line.matchAll(/\b[A-Z]{3}\b/g)) if (AIRPORT[m[0]]) out.push({ pos: m.index, value: m[0] });
    return out;
  }
  let s = fold(line);
  for (const [name, code] of AIRPORT_NAMES) {
    const re = new RegExp(`(?<![a-z])${name}(?![a-z])`, 'g');
    for (const m of [...s.matchAll(re)]) {
      out.push({ pos: m.index, value: code });
      s = s.slice(0, m.index) + '#'.repeat(name.length) + s.slice(m.index + name.length);
    }
  }
  out.sort((a, b) => a.pos - b.pos);
  // "Heathrow (London)" names one airport twice: keep the first of neighbours in the same city.
  return out.filter((t, i) => i === 0 || AIRPORT[out[i - 1].value].city !== AIRPORT[t.value].city);
}

const FLIGHT_RE = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z]) ?(\d{2,4})\b/;
const TIME_RE = /\b\d{1,2}[:.]\d{2}\b/;

/** Airports named in one string, best evidence first: (LHR), then bare LHR, then city and airport names. */
export function airportsIn(text: string): string[] {
  const paren = findAirportsBy(text, 'paren');
  if (paren.length >= 2) return paren.map((f) => f.value);
  const bare = findAirportsBy(text, 'bare');
  if (bare.length >= 2) return bare.map((f) => f.value);
  const names = findAirportsBy(text, 'name');
  if (names.length) return names.map((f) => f.value);
  return [...paren, ...bare].slice(0, 1).map((f) => f.value);
}

export interface ParsedFlights {
  segments: Segment[];
  /** Things the reader could not use, in plain words, for the review step. */
  notes: string[];
}

const sameCity = (a: string, b: string) => AIRPORT[a].city === AIRPORT[b].city;

function dedupe(segments: Segment[]): Segment[] {
  const seen = new Set<string>();
  return segments
    .filter((s) => {
      const key = `${s.from}|${s.to}|${s.depart}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.depart.localeCompare(b.depart) || a.arrive.localeCompare(b.arrive));
}

/**
 * Flight segments from the text of a booking confirmation. Works line by line:
 * airports are paired up in reading order and each pair takes the date on its
 * own lines, else the nearest date line below or above it.
 */
export function parseConfirmation(text: string): ParsedFlights {
  const lines = text.split(/\r\n|\n|\r/);
  const notes: string[] = [];
  const dates = lines.map(findDates);

  let mode: AirMode = 'name';
  for (const m of ['paren', 'bare'] as const) {
    if (lines.reduce((n, l) => n + findAirportsBy(l, m).length, 0) >= 2) {
      mode = m;
      break;
    }
  }
  const air: { line: number; pos: number; code: string }[] = [];
  lines.forEach((l, i) => {
    // City names turn up in addresses and footers: only trust them on a line that also carries a date, a time or a flight number.
    if (mode === 'name' && !dates[i].length && !TIME_RE.test(l) && !FLIGHT_RE.test(l)) return;
    for (const f of findAirportsBy(l, mode)) air.push({ line: i, pos: f.pos, code: f.value });
  });
  if (air.length < 2) return { segments: [], notes: ['No flights found. The reader looks for two airports (codes like LHR and IST, or city names) and a date.'] };

  const airLines = new Set(air.map((a) => a.line));
  const pairs: { a: (typeof air)[number]; b: (typeof air)[number] }[] = [];
  for (let i = 0; i + 1 < air.length; i += 2) pairs.push({ a: air[i], b: air[i + 1] });
  if (air.length % 2) notes.push(`An airport (${air[air.length - 1].code}) was left without a partner and was ignored.`);

  const near = (from: number, step: 1 | -1): { line: number; dates: Found<Day>[] } | null => {
    for (let i = from + step, n = 0; i >= 0 && i < lines.length && n < 3; i += step, n++) {
      if (airLines.has(i)) return null;
      if (dates[i].length) return { line: i, dates: dates[i] };
    }
    return null;
  };
  const below = pairs.map((p) => near(p.b.line, 1));
  const above = pairs.map((p) => near(p.a.line, -1));
  const preferAbove = above.every(Boolean) && !below.every(Boolean);

  const segments: Segment[] = [];
  pairs.forEach(({ a, b }, i) => {
    if (sameCity(a.code, b.code)) return;
    let dep: Day | undefined;
    let arr: Day | undefined;
    if (a.line === b.line) {
      [dep, arr] = dates[a.line].map((d) => d.value);
    } else {
      const between: Found<Day>[] = [];
      for (let l = a.line + 1; l < b.line; l++) between.push(...dates[l]);
      dep = [...dates[a.line], ...between][0]?.value;
      arr = dates[b.line][0]?.value;
    }
    let dateLine: number | null = null;
    if (!dep && !arr) {
      const pick = preferAbove ? above[i] : (below[i] ?? above[i]);
      if (pick) {
        dateLine = pick.line;
        [dep, arr] = pick.dates.map((d) => d.value);
      }
    }
    dep ??= arr;
    if (!dep) {
      notes.push(`${a.code} to ${b.code}: no date found near it, so it was skipped.`);
      return;
    }
    if (!arr || arr < dep || arr > addDays(dep, 2)) arr = dep;
    // Flight number: on the pair's own lines, else the line the date came from, else just above, else just below.
    const flightOn = (l: number): string | null => {
      const m = l >= 0 && l < lines.length ? FLIGHT_RE.exec(lines[l]) : null;
      return m ? m[1] + m[2] : null;
    };
    let flight: string | null = null;
    for (let l = a.line; l <= b.line && !flight; l++) flight = flightOn(l);
    if (!flight && dateLine !== null) flight = flightOn(dateLine);
    for (let l = a.line - 1; l >= a.line - 3 && !flight && !airLines.has(l); l--) flight = flightOn(l);
    for (let l = b.line + 1; l <= b.line + 2 && !flight && !airLines.has(l); l++) flight = flightOn(l);
    segments.push({ from: a.code, to: b.code, depart: dep, arrive: arr, flight });
  });
  if (!segments.length && !notes.length) notes.push('Airports were found but no flight between two different cities.');
  return { segments: dedupe(segments), notes };
}

/** Flight events in a calendar file: airline exports, TripIt-style feeds, Gmail's "Flight to …" events. */
export function flightsFromIcs(events: IcsEvent[]): ParsedFlights {
  const segments: Segment[] = [];
  let other = 0;
  for (const e of events) {
    if (!e.start) continue;
    const inSummary = airportsIn(e.summary);
    const looksLikeFlight = FLIGHT_RE.test(e.summary) || /flight|ucus|ucak/.test(fold(e.summary)) || findAirportsBy(e.summary, 'bare').length >= 2 || findAirportsBy(e.summary, 'paren').length >= 2;
    let from: string | undefined;
    let to: string | undefined;
    if (looksLikeFlight) {
      if (inSummary.length >= 2) [from, to] = inSummary;
      else if (inSummary.length === 1) {
        const origin = airportsIn(e.location).find((c) => !sameCity(c, inSummary[0]));
        if (origin) [from, to] = [origin, inSummary[0]];
      }
      if (!from || !to) {
        const inBody = airportsIn(e.description);
        if (inBody.length >= 2) [from, to] = inBody;
      }
    }
    if (!from || !to || sameCity(from, to)) {
      other++;
      continue;
    }
    const depart = dateInZone(e.start, AIRPORT[from].tz);
    let arrive = e.end && e.end.time ? dateInZone(e.end, AIRPORT[to].tz) : depart;
    if (arrive < depart || arrive > addDays(depart, 2)) arrive = depart;
    const m = FLIGHT_RE.exec(e.summary) ?? FLIGHT_RE.exec(e.description);
    segments.push({ from, to, depart, arrive, flight: m ? m[1] + m[2] : null });
  }
  const notes: string[] = [];
  if (other) notes.push(`${other} calendar ${other === 1 ? 'event was' : 'events were'} not a recognisable flight and ${other === 1 ? 'was' : 'were'} ignored.`);
  if (!segments.length) notes.push('No flight events found. The reader looks for a flight number or the word "flight" and two airports it knows.');
  return { segments: dedupe(segments), notes };
}

// ---------------------------------------------------------------- flights to stays

export interface DraftStays {
  stays: Stay[];
  /** Where the first flight leaves from: lets the import close an open stay there. */
  origin: { city: string; depart: Day } | null;
  notes: string[];
}

/** Consecutive flights become stays: land on one, leave on the next. The last landing is an open-ended stay. */
export function segmentsToStays(segments: Segment[], source: Stay['source']): DraftStays {
  const segs = dedupe(segments);
  const notes: string[] = [];
  const stays: Stay[] = [];
  segs.forEach((seg, i) => {
    const dest = AIRPORT[seg.to];
    const city = cityKey(dest.city);
    const next = segs[i + 1];
    const base = { id: `${source}-${city}-${seg.arrive}`, city, country: dest.country, arrive: seg.arrive, source };
    if (!next) {
      stays.push({ ...base, depart: null, note: seg.flight ? `Arrived on ${seg.flight}` : undefined });
      return;
    }
    if (next.depart < seg.arrive) {
      notes.push(`${seg.from} to ${seg.to} on ${seg.depart} overlaps the next flight and was not turned into a stay.`);
      return;
    }
    if (next.depart === seg.arrive && sameCity(next.from, seg.to)) {
      notes.push(`Same-day connection in ${dest.city} on ${seg.arrive}: no stay created.`);
      return;
    }
    const leftFrom = AIRPORT[next.from];
    const note = sameCity(next.from, seg.to) ? (seg.flight ? `Arrived on ${seg.flight}` : undefined) : `Next flight leaves from ${leftFrom.city}; the days between are counted here`;
    stays.push({ ...base, depart: next.depart, note });
  });
  const first = segs[0];
  return { stays, origin: first ? { city: cityKey(AIRPORT[first.from].city), depart: first.depart } : null, notes };
}

export interface ImportPlan {
  create: Stay[];
  update: { before: Stay; after: Stay; why: string }[];
  /** Read from the booking but already in the ledger with the same dates. */
  unchanged: Stay[];
  notes: string[];
}

// An open-ended stay is matched on its arrival date only, so it cannot swallow a later visit to the same city.
const overlaps = (a: Stay, b: Stay) => a.arrive <= (b.depart ?? b.arrive) && b.arrive <= (a.depart ?? a.arrive);

/** What saving an import would do to the ledger: new stays, changed stays, and duplicates left alone. */
export function planImport(existing: Stay[], parsed: ParsedFlights, source: Stay['source']): ImportPlan {
  const draft = segmentsToStays(parsed.segments, source);
  const plan: ImportPlan = { create: [], update: [], unchanged: [], notes: [...parsed.notes, ...draft.notes] };
  const taken = new Set<string>();

  if (draft.origin) {
    const { city, depart } = draft.origin;
    const open = sortStays(existing).reverse().find((s) => s.city === city && s.depart === null && s.arrive <= depart);
    if (open) {
      plan.update.push({ before: open, after: { ...open, depart }, why: 'Departure flight found' });
      taken.add(open.id);
    }
  }
  for (const c of draft.stays) {
    const match = existing.find((e) => !taken.has(e.id) && e.city === c.city && (e.arrive === c.arrive || overlaps(e, c)));
    if (!match) {
      plan.create.push(c);
      continue;
    }
    taken.add(match.id);
    const depart = c.depart ?? match.depart; // a booking with no onward flight does not erase a known departure
    if (match.arrive === c.arrive && match.depart === depart) plan.unchanged.push(match);
    else plan.update.push({ before: match, after: { ...match, arrive: c.arrive, depart }, why: match.arrive !== c.arrive ? 'Arrival date changed' : match.depart === null ? 'Departure flight found' : 'Departure date changed' });
  }
  return plan;
}

export function applyImport(existing: Stay[], plan: ImportPlan): Stay[] {
  const changed = new Map(plan.update.map((u) => [u.before.id, u.after]));
  const ids = new Set(existing.map((s) => s.id));
  const fresh = plan.create.map((s) => (ids.has(s.id) ? { ...s, id: `${s.id}-${existing.length}` } : s));
  return sortStays([...existing.map((s) => changed.get(s.id) ?? s), ...fresh]);
}
