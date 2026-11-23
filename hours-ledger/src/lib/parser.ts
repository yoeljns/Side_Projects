// The quick line: "masters 1h30 reading", "company 45m", "2h builds yesterday",
// "training 1.5h mon". Category, duration and day may come in any order at the
// start of the line; whatever follows is the note. A day word may also be the
// very last word.
import { addDays, isDay, weekdayIndex, type Day } from './dates';
import { activeCategories, type Category } from './model';

export type ParseResult =
  | { ok: true; category: string; day: Day; minutes: number; note?: string }
  | { ok: false; message: string };

const HOUR_UNITS = 'h|hr|hrs|hour|hours';
const MIN_UNITS = 'm|min|mins|minute|minutes';
const RE_HOURS = new RegExp(`^(\\d+(?:[.,]\\d+)?|[.,]\\d+)(?:${HOUR_UNITS})(?:(\\d{1,2})(?:${MIN_UNITS})?)?$`);
const RE_MINS = new RegExp(`^(\\d+)(?:${MIN_UNITS})$`);
const RE_CLOCK = /^(\d{1,2}):([0-5]\d)$/;
const RE_BARE = /^\d+(?:[.,]\d+)?$/;

/**
 * Minutes from one token: 1h, 1h30, 1h30m, 1.5h, 45m, 90min, 1:30. Null when the
 * token is not a duration. With `bareMinutes`, a plain number counts as minutes.
 */
export function parseDuration(token: string, bareMinutes = false): number | null {
  const t = token.trim().toLowerCase();
  let m = RE_HOURS.exec(t);
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 60) + (m[2] ? Number(m[2]) : 0);
  m = RE_MINS.exec(t);
  if (m) return Number(m[1]);
  m = RE_CLOCK.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (bareMinutes && /^\d+$/.test(t)) return Number(t);
  return null;
}

/** Several tokens added up ("1h 30m"); null if any of them is not a duration. */
export function parseDurationText(text: string, bareMinutes = false): number | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let total = 0;
  for (const t of tokens) {
    const v = parseDuration(t, bareMinutes && tokens.length === 1);
    if (v === null) return null;
    total += v;
  }
  return total;
}

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_ALIASES: Record<string, number> = { tues: 1, weds: 2, thur: 3, thurs: 3 };

/**
 * A day word against `today`: today, yesterday, a weekday name (the most recent
 * one that is not in the future, so on a Wednesday "wed" is today and "thu" is
 * last Thursday), or a full date. 'future' when a date lies after today.
 */
export function parseDayWord(token: string, today: Day): Day | 'future' | null {
  const t = token.toLowerCase();
  if (t === 'today' || t === 'tod') return today;
  if (t === 'yesterday' || t === 'yest' || t === 'yday') return addDays(today, -1);
  if (t === 'tomorrow') return 'future';
  if (isDay(t)) return t > today ? 'future' : t;
  let idx = DAY_NAMES.findIndex((n) => n === t || n.slice(0, 3) === t);
  if (idx < 0 && t in DAY_ALIASES) idx = DAY_ALIASES[t];
  if (idx < 0) return null;
  return addDays(today, -((weekdayIndex(today) - idx + 7) % 7));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Every word a category answers to: its label (whole and first word), its id and its aliases. */
function namesOf(c: Category): string[] {
  const words = c.label.toLowerCase().split(/\s+/);
  return [norm(c.label), norm(words[0] ?? ''), norm(c.id), ...(c.aliases ?? []).map(norm)].filter(Boolean);
}

export type CategoryMatch = { kind: 'one'; category: Category } | { kind: 'many'; categories: Category[] } | { kind: 'none' };

/** Exact name or alias first; otherwise any category with a name the token is a prefix of. */
export function matchCategory(token: string, cats: Category[]): CategoryMatch {
  const t = norm(token);
  if (!t) return { kind: 'none' };
  const active = activeCategories(cats);
  const exact = active.filter((c) => namesOf(c).includes(t));
  if (exact.length === 1) return { kind: 'one', category: exact[0] };
  if (exact.length > 1) return { kind: 'many', categories: exact };
  const prefix = active.filter((c) => namesOf(c).some((n) => n.startsWith(t)));
  if (prefix.length === 1) return { kind: 'one', category: prefix[0] };
  if (prefix.length > 1) return { kind: 'many', categories: prefix };
  return { kind: 'none' };
}

const orList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const fail = (message: string): ParseResult => ({ ok: false, message });

export function parseLine(text: string, cats: Category[], today: Day): ParseResult {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return fail('Type a category and a duration, like "masters 1h30 reading".');
  const labels = activeCategories(cats).map((c) => c.label);

  let category: Category | null = null;
  let minutes: number | null = null;
  let day: Day | null = null;
  let ambiguous: { token: string; categories: Category[] } | null = null;
  let future = false;

  // The head: leading tokens that are a duration, a day or the category.
  let i = 0;
  for (; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const dur = parseDuration(tok);
    if (dur !== null) {
      minutes = (minutes ?? 0) + dur;
      continue;
    }
    if (minutes === null && RE_BARE.test(tok)) return fail(`Is "${tok}" minutes or hours? Write ${tok}m or ${tok}h.`);
    if (day === null) {
      const d = parseDayWord(tok, today);
      if (d === 'future') {
        future = true;
        break;
      }
      if (d !== null) {
        day = d;
        continue;
      }
    }
    if (category === null) {
      const m = matchCategory(tok, cats);
      if (m.kind === 'one') {
        category = m.category;
        continue;
      }
      if (m.kind === 'many') ambiguous = { token: tok, categories: m.categories };
    }
    break;
  }
  if (future) return fail('That day is in the future. Log it once it has happened.');

  // A day word may also close the line: "masters 1h30 reading yesterday".
  let rest = tokens.slice(i);
  if (day === null && rest.length > 0) {
    const d = parseDayWord(rest[rest.length - 1], today);
    if (d === 'future') return fail('That day is in the future. Log it once it has happened.');
    if (d !== null) {
      day = d;
      rest = rest.slice(0, -1);
    }
  }

  if (category === null) {
    if (ambiguous) {
      return fail(`"${ambiguous.token}" could be ${orList(ambiguous.categories.map((c) => c.label))}. Type a few more letters.`);
    }
    if (labels.length === 0) return fail('There are no categories yet. Add one in Settings.');
    const stray = tokens[i];
    const later = rest.find((t) => matchCategory(t, cats).kind === 'one');
    if (later && stray) {
      return fail(`Put the category at the start, next to the duration: "${later.toLowerCase()} 1h ${stray} …".`);
    }
    return fail(
      stray
        ? `No category starts with "${stray}". Use ${orList(labels)}.`
        : `Which category? Add ${orList(labels)}.`,
    );
  }

  if (minutes === null) {
    return fail(`How long? Add a duration such as 45m, 1h30 or 1.5h after "${category.label.toLowerCase()}".`);
  }
  if (minutes <= 0) return fail('The duration has to be more than zero.');
  if (minutes > 1440) return fail('That is more than 24 hours in one day. Split it across days.');

  const note = rest.join(' ');
  return { ok: true, category: category.id, day: day ?? today, minutes, ...(note ? { note } : {}) };
}
