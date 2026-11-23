// One iCalendar (RFC 5545) reader and writer for the whole app: flights and
// fixtures come in through parseIcs, the routine, sale windows and trip
// triggers go out through writeIcs.
import { addDays, dayIn, zonedToUtcMs } from './dates.ts';
import type { Day } from './dates.ts';

export interface IcsTime {
  /** The date as written: local to `tzid`, UTC when `utc`, floating otherwise. */
  date: Day;
  /** 'HH:MM', or null for an all-day (date-only) value. */
  time: string | null;
  tzid: string | null;
  utc: boolean;
  /** Epoch ms when the value pins down an instant (UTC, or a TZID this runtime knows). */
  instant: number | null;
}

export interface IcsEvent {
  uid: string | null;
  summary: string;
  description: string;
  location: string;
  categories: string[];
  start: IcsTime | null;
  end: IcsTime | null;
  rrule: string | null;
}

/** Join folded lines: a line starting with a space or tab continues the one before. */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else if (line !== '') out.push(line);
  }
  return out;
}

export function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\n|\r/g, '\\n');
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Split 'NAME;PARAM="a:b";P2=c:value' at the first colon that is not inside quotes. */
export function parseLine(line: string): ContentLine | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const head = line.slice(0, colon);
  const parts: string[] = [];
  let cur = '';
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** DTSTART/DTEND value in its three forms: date-only, UTC ('…Z'), local with or without TZID. */
export function parseTime(value: string, params: Record<string, string> = {}): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (Number.isNaN(Date.parse(date))) return null;
  if (m[4] === undefined) return { date, time: null, tzid: null, utc: false, instant: null };
  const time = `${m[4]}:${m[5]}`;
  if (m[7]) return { date, time, tzid: null, utc: true, instant: Date.parse(`${date}T${time}:00Z`) };
  const tzid = params.TZID ?? null;
  let instant: number | null = null;
  if (tzid) {
    try {
      instant = zonedToUtcMs(date, time, tzid);
    } catch {
      instant = null; // a zone name this runtime does not know: keep the wall-clock date
    }
  }
  return { date, time, tzid, utc: false, instant };
}

/** Every VEVENT in the text. Nested components (VALARM) are skipped; broken lines are ignored. */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: IcsEvent | null = null;
  let nested = 0;
  for (const raw of unfold(text)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === 'BEGIN') {
      if (line.value.toUpperCase() === 'VEVENT' && !cur) {
        cur = { uid: null, summary: '', description: '', location: '', categories: [], start: null, end: null, rrule: null };
        nested = 0;
      } else if (cur) nested++;
      continue;
    }
    if (line.name === 'END') {
      if (cur && nested > 0) nested--;
      else if (cur && line.value.toUpperCase() === 'VEVENT') {
        events.push(cur);
        cur = null;
      }
      continue;
    }
    if (!cur || nested > 0) continue;
    switch (line.name) {
      case 'UID': cur.uid = line.value.trim(); break;
      case 'SUMMARY': cur.summary = unescapeText(line.value); break;
      case 'DESCRIPTION': cur.description = unescapeText(line.value); break;
      case 'LOCATION': cur.location = unescapeText(line.value); break;
      case 'CATEGORIES': cur.categories = line.value.split(/(?<!\\),/).map((c) => unescapeText(c).trim()).filter(Boolean); break;
      case 'DTSTART': cur.start = parseTime(line.value, line.params); break;
      case 'DTEND': cur.end = parseTime(line.value, line.params); break;
      case 'RRULE': cur.rrule = line.value.trim(); break;
      default:
    }
  }
  return events;
}

/** The calendar date of an event time as seen in `tz` (falls back to the date as written). */
export function dateInZone(t: IcsTime, tz: string | null): Day {
  if (t.instant === null || !tz) return t.date;
  try {
    return dayIn(tz, new Date(t.instant));
  } catch {
    return t.date;
  }
}

// ---------------------------------------------------------------- writing

export interface IcsAlarm {
  /** Minutes relative to the start: negative is before, positive after (useful on all-day events: 540 = 09:00 that day). */
  offsetMin: number;
  text?: string;
}

export interface IcsOutEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  /** No time = all-day. With a time: `utc`, or local to `tzid`, or floating. */
  start: { date: Day; time?: string; tzid?: string; utc?: boolean };
  /** Length of a timed event. All-day events last one day. */
  durationMin?: number;
  rrule?: string;
  alarms?: IcsAlarm[];
}

const utf8 = new TextEncoder();

/** Fold at 75 octets (not characters), never inside a multi-byte character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = utf8.encode(ch).length;
    if (bytes + n > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const compact = (day: Day) => day.replace(/-/g, '');
const compactTime = (time: string) => `${time.replace(':', '')}00`;

/** RFC 5545 duration: -90 -> '-PT1H30M', 540 -> 'PT9H', -1440 -> '-P1D'. */
export function durationText(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const time = h || m ? `T${h ? `${h}H` : ''}${m ? `${m}M` : ''}` : '';
  return `${minutes < 0 ? '-' : ''}P${d ? `${d}D` : ''}${time || (d ? '' : 'T0M')}`;
}

/** Stamp for DTSTAMP from an ISO instant: '2026-11-23T10:00:00.000Z' -> '20261123T100000Z'. */
export const icsStamp = (iso: string): string => `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;

// The two zones the app writes local times in. Calendars that know IANA names
// ignore these blocks; strict ones need them.
const VTIMEZONES: Record<string, string[]> = {
  'Europe/London': [
    'BEGIN:VTIMEZONE', 'TZID:Europe/London',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:BST', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ],
  'Europe/Istanbul': [
    'BEGIN:VTIMEZONE', 'TZID:Europe/Istanbul',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'TZNAME:+03', 'DTSTART:19700101T000000', 'END:STANDARD',
    'END:VTIMEZONE',
  ],
};

/** A complete VCALENDAR. `stamp` is the creation instant (ISO), passed in so output is reproducible. */
export function writeIcs(events: IcsOutEvent[], opts: { name: string; stamp: string }): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//two-city//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(opts.name)}`];
  const zones = [...new Set(events.map((e) => e.start.tzid).filter((z): z is string => Boolean(z)))];
  for (const z of zones) if (VTIMEZONES[z]) lines.push(...VTIMEZONES[z]);
  const stamp = icsStamp(opts.stamp);
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    const { date, time, tzid, utc } = e.start;
    if (!time) {
      lines.push(`DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`);
    } else {
      if (utc) lines.push(`DTSTART:${compact(date)}T${compactTime(time)}Z`);
      else if (tzid) lines.push(`DTSTART;TZID=${tzid}:${compact(date)}T${compactTime(time)}`);
      else lines.push(`DTSTART:${compact(date)}T${compactTime(time)}`);
      lines.push(`DURATION:${durationText(Math.max(1, e.durationMin ?? 60))}`);
    }
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    for (const a of e.alarms ?? []) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(a.text ?? e.summary)}`, `TRIGGER:${durationText(a.offsetMin)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
