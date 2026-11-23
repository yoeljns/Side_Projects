// Books: the list kept in this app, the two CSV importers, and the year's counts.
import { csvRecords } from './csv';
import { type ISODate, isDate, makeDate, monthKey, monthsIn } from './dates';
import type { Book } from './types';
import { type YearWindow, inWindow } from './window';

export type BookFormat = 'goodreads' | 'storygraph';
export type NewBook = Omit<Book, 'id'>;

export interface BookImport {
  format: BookFormat;
  books: NewBook[];
  /** Rows on other shelves (to read, currently reading, did not finish). */
  notRead: number;
  /** Read books with no finish date: imported, but they cannot be placed in a year until a date is added. */
  undated: number;
}

/** '2024/03/15', '2024-03-15', '2024/3/5' -> '2024-03-15'. Anything else -> undefined. */
export function looseDate(s: string): ISODate | undefined {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s.trim());
  if (!m) return undefined;
  const d = makeDate(+m[1], +m[2], +m[3]);
  return isDate(d) ? d : undefined;
}

const rating = (s: string): number | undefined => {
  const n = Number(s);
  return s !== '' && Number.isFinite(n) && n > 0 && n <= 5 ? n : undefined; // 0 means "not rated" in both exports
};
const pages = (s: string): number | undefined => {
  const n = Number(s);
  return s !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
};
const oneLine = (s: string): string | undefined => {
  const t = s.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  return t ? (t.length > 200 ? `${t.slice(0, 199)}…` : t) : undefined;
};
const tidy = (b: NewBook): NewBook => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as NewBook;

export function detectBookFormat(header: string[]): BookFormat | null {
  const has = (h: string) => header.includes(h);
  if (has('Title') && has('Exclusive Shelf') && has('Date Read')) return 'goodreads';
  if (has('Title') && has('Read Status') && (has('Last Date Read') || has('Dates Read'))) return 'storygraph';
  return null;
}

/** Read a Goodreads library export or a StoryGraph export. Throws when the columns match neither. */
export function importBooksCsv(text: string): BookImport {
  const { header, records } = csvRecords(text);
  const format = detectBookFormat(header);
  if (!format) throw new Error('This CSV is neither a Goodreads library export nor a StoryGraph export (expected columns such as Title, Date Read and Exclusive Shelf).');
  const books: NewBook[] = [];
  let notRead = 0;
  let undated = 0;
  for (const r of records) {
    if (!r.Title) continue;
    const read = format === 'goodreads' ? r['Exclusive Shelf'] === 'read' : r['Read Status'] === 'read';
    if (!read) { notRead += 1; continue; }
    let finished: ISODate | undefined;
    if (format === 'goodreads') finished = looseDate(r['Date Read'] ?? '');
    else {
      // 'Dates Read' holds 'start-end' ranges separated by commas; the last end is the latest finish.
      const lastRange = (r['Dates Read'] ?? '').split(',').pop() ?? '';
      finished = looseDate(r['Last Date Read'] ?? '') ?? looseDate(lastRange.split('-').pop() ?? '');
    }
    if (!finished) undated += 1;
    books.push(tidy({
      title: r.Title,
      author: (format === 'goodreads' ? r.Author : r.Authors) ?? '',
      finished,
      rating: rating((format === 'goodreads' ? r['My Rating'] : r['Star Rating']) ?? ''),
      pages: format === 'goodreads' ? pages(r['Number of Pages'] ?? '') : undefined,
      note: format === 'goodreads' ? oneLine(r['My Review'] ?? '') : oneLine(r.Review ?? ''),
    }));
  }
  return { format, books, notRead, undated };
}

const bookKey = (b: NewBook) => `${b.title.trim().toLowerCase()}|${b.author.trim().toLowerCase()}`;

/** Add imported books that are not already listed (same title and author, any case). */
export function mergeBooks(existing: Book[], incoming: NewBook[], newId: () => string): { books: Book[]; added: number; skipped: number } {
  const seen = new Set(existing.map(bookKey));
  const books = [...existing];
  let added = 0;
  for (const b of incoming) {
    if (seen.has(bookKey(b))) continue;
    seen.add(bookKey(b));
    books.push({ id: newId(), ...b });
    added += 1;
  }
  return { books, added, skipped: incoming.length - added };
}

export interface BookStats {
  count: number;
  list: Book[];
  /** Sum of the page counts that are known. */
  pages: number;
  withPages: number;
  rated: number;
  avgRating: number | null;
  /** Highest rating first, then earliest finished; at most five. */
  topRated: Book[];
  byMonth: { month: string; count: number }[];
  /** Books on the list with no finish date (not counted in any year). */
  undated: number;
}

export function bookStats(books: Book[], w: YearWindow): BookStats {
  const list = books
    .filter((b) => b.finished !== undefined && inWindow(b.finished, w))
    .sort((a, b) => (a.finished! < b.finished! ? -1 : a.finished! > b.finished! ? 1 : a.title.localeCompare(b.title)));
  const months = new Map<string, number>(monthsIn(w.start, w.end).map((m) => [m, 0]));
  for (const b of list) months.set(monthKey(b.finished!), months.get(monthKey(b.finished!))! + 1);
  const rated = list.filter((b) => b.rating !== undefined);
  const withPages = list.filter((b) => b.pages !== undefined);
  return {
    count: list.length,
    list,
    pages: withPages.reduce((s, b) => s + b.pages!, 0),
    withPages: withPages.length,
    rated: rated.length,
    avgRating: rated.length ? rated.reduce((s, b) => s + b.rating!, 0) / rated.length : null,
    topRated: [...rated].sort((a, b) => b.rating! - a.rating!).slice(0, 5),
    byMonth: [...months].map(([month, count]) => ({ month, count })),
    undated: books.filter((b) => b.finished === undefined).length,
  };
}
