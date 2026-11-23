// A weekly Sunday reminder as an iCalendar file. The app cannot notify when it
// is closed, so the phone's calendar does it instead.
import { addDays, weekStart, type Day } from './dates';

export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545: lines are at most 75 octets; continuation lines start with a space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // the leading space counts
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export interface ReminderOptions {
  /** 'HH:MM' local time. */
  time: string;
  /** Any day; the series starts on the first Sunday on or after it. */
  from: Day;
  /** When the file was made, as epoch milliseconds (DTSTAMP). */
  createdAt: number;
  /** Link back to the app, put in the event so the reminder opens it. */
  url?: string;
}

/**
 * One event repeating every Sunday with an alarm at the start. The times are
 * "floating" (no timezone), so the reminder fires at the same wall-clock time
 * in London and in Istanbul.
 */
export function reminderIcs(o: ReminderOptions): string {
  if (!isTime(o.time)) throw new Error('Time must be HH:MM');
  const sunday = addDays(weekStart(o.from), 6);
  const d = sunday.replace(/-/g, '');
  const [h, m] = o.time.split(':').map(Number);
  const start = `${d}T${o.time.replace(':', '')}00`;
  const endMin = h * 60 + m + 15;
  const pad = (n: number) => String(n).padStart(2, '0');
  // A reminder at 23:50 ends just before midnight rather than spilling into Monday.
  const end = endMin >= 1440 ? `${d}T235900` : `${d}T${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`;
  const stamp = new Date(o.createdAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const description = `Ten minutes: read the week, fill in the three boxes.${o.url ? `\n${o.url}` : ''}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//hours-ledger//weekly summary reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:weekly-summary@hours-ledger',
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'RRULE:FREQ=WEEKLY;BYDAY=SU',
    `SUMMARY:${escapeText('Hours ledger: weekly summary')}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(o.url ? [`URL:${o.url}`] : []),
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText('Hours ledger: weekly summary')}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
