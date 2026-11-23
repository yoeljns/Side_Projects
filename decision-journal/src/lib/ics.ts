// An iCalendar (RFC 5545) file with one all-day event per open review date.
import { addDays } from './dates';
import type { Decision } from './model';
import { statusOf } from './model';

const escapeText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const compact = (d: string): string => d.replace(/-/g, '');

/** Fold a content line at 75 octets (RFC 5545 3.1) without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    // Continuation lines start with a space, which counts towards their 75.
    if (bytes + size > 75) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

const pct = (p: number): string => `${Math.round(p * 100)}%`;

function describe(d: Decision): string {
  const lines: string[] = [];
  if (d.call) lines.push(`The call: ${d.call}`);
  if (d.scenarios) lines.push(`Scenarios: ${d.scenarios.map((s) => `${s.label} ${pct(s.probability)}`).join(', ')}`);
  else lines.push(`Forecast: ${pct(d.probability)}${d.statement ? ` that ${d.statement}` : ''}`);
  if (d.changeMind) lines.push(`What would change my mind: ${d.changeMind}`);
  lines.push(`Decided on ${d.madeOn}.`);
  return lines.join('\n');
}

/**
 * `today` stamps the events (DTSTAMP) so the output is the same for the same
 * inputs. UIDs are stable per decision, so importing a newer file updates the
 * events in calendars that honour UIDs instead of duplicating them.
 */
export function reviewsToIcs(decisions: Decision[], today: string): string {
  const open = decisions.filter((d) => statusOf(d) === 'open').sort((a, b) => a.reviewOn.localeCompare(b.reviewOn) || a.id.localeCompare(b.id));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//decision-journal//review dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Decision reviews'];
  for (const d of open) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}@decision-journal`,
      `DTSTAMP:${compact(today)}T000000Z`,
      `DTSTART;VALUE=DATE:${compact(d.reviewOn)}`,
      `DTEND;VALUE=DATE:${compact(addDays(d.reviewOn, 1))}`,
      `SUMMARY:${escapeText(`Review: ${d.title}`)}`,
      `DESCRIPTION:${escapeText(describe(d))}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
