import { describe, expect, it } from 'vitest';
import goodreads from '../../test/fixtures/goodreads.csv?raw';
import storygraph from '../../test/fixtures/storygraph.csv?raw';
import { bookStats, detectBookFormat, importBooksCsv, looseDate, mergeBooks } from './books';
import { csvRecords, parseCsv } from './csv';
import type { Book } from './types';
import { yearWindow } from './window';

describe('CSV reader', () => {
  it('reads quoted fields holding commas, quotes and line breaks', () => {
    expect(parseCsv('a,b,c\n"one, two","say ""hi""","line 1\nline 2"\n')).toEqual([['a', 'b', 'c'], ['one, two', 'say "hi"', 'line 1\nline 2']]);
  });
  it('accepts CRLF, a byte-order mark, empty fields and no final newline', () => {
    expect(parseCsv('﻿a,b\r\n1,\r\n,2')).toEqual([['a', 'b'], ['1', ''], ['', '2']]);
  });
  it('drops blank lines but keeps a quoted empty line inside a field', () => {
    expect(parseCsv('a\n\n"x\n\ny"\n\n')).toEqual([['a'], ['x\n\ny']]);
  });
  it('keys rows by trimmed header and fills short rows', () => {
    expect(csvRecords(' Title ,Author\nX').records).toEqual([{ Title: 'X', Author: '' }]);
    expect(csvRecords('')).toEqual({ header: [], records: [] });
  });
});

describe('book imports', () => {
  it('reads loose dates', () => {
    expect(looseDate('2025/04/18')).toBe('2025-04-18');
    expect(looseDate('2025-4-8')).toBe('2025-04-08');
    expect(looseDate('2025/02/30')).toBeUndefined();
    expect(looseDate('18/04/2025')).toBeUndefined();
    expect(looseDate('')).toBeUndefined();
  });
  it('tells the two exports apart and rejects anything else', () => {
    expect(detectBookFormat(csvRecords(goodreads).header)).toBe('goodreads');
    expect(detectBookFormat(csvRecords(storygraph).header)).toBe('storygraph');
    expect(() => importBooksCsv('name,when\nx,y\n')).toThrow(/neither a Goodreads/);
  });
  it('imports a Goodreads library export', () => {
    const r = importBooksCsv(goodreads);
    expect(r).toMatchObject({ format: 'goodreads', notRead: 1, undated: 1 });
    expect(r.books).toHaveLength(6);
    // Title with a comma; review with doubled quotes and a line break, folded to one line.
    expect(r.books[0]).toEqual({ title: 'The Salt Road, Revisited', author: 'Imogen Farrow', finished: '2025-04-18', rating: 5, pages: 312, note: 'Slow start, then "unputdownable". Second half is the better half.' });
    // Rating 0 means not rated; no page count.
    expect(r.books[2]).toEqual({ title: 'Ledger of Winds', author: 'Imogen Farrow', finished: '2025-11-30' });
    // Read, but no Date Read.
    expect(r.books[3]).toEqual({ title: 'The Quiet Engine', author: 'Marek Dvorsky', rating: 3, pages: 401 });
    expect(r.books[4].title).toBe('Maps, Margins');
  });
  it('imports a StoryGraph export', () => {
    const r = importBooksCsv(storygraph);
    expect(r).toMatchObject({ format: 'storygraph', notRead: 2, undated: 1 });
    expect(r.books).toEqual([
      { title: 'The Glass Estuary', author: 'Henrik Solvang', finished: '2025-05-20', rating: 4.25, note: 'Good on tides, weak on people.' },
      // No Last Date Read: the end of the last range in Dates Read is used. Title and authors both hold commas.
      { title: 'Winter, Counted', author: 'Asel Nurlan, Pia Brandt', finished: '2025-09-19', rating: 3.5 },
      { title: 'The Salt Road, Revisited', author: 'Imogen Farrow' },
    ]);
  });
  it('merges without duplicating a title and author already listed', () => {
    let n = 0;
    const id = () => `b${++n}`;
    const first = mergeBooks([], importBooksCsv(goodreads).books, id);
    expect([first.added, first.skipped]).toEqual([6, 0]);
    const second = mergeBooks(first.books, importBooksCsv(storygraph).books, id);
    expect([second.added, second.skipped]).toEqual([2, 1]);
    expect(second.books).toHaveLength(8);
    expect(mergeBooks(second.books, importBooksCsv(goodreads).books, id).added).toBe(0);
  });
});

describe('the year in books', () => {
  const W = yearWindow({ month: 3, day: 10 }, 2026);
  let n = 0;
  const all: Book[] = mergeBooks(mergeBooks([], importBooksCsv(goodreads).books, () => `b${++n}`).books, importBooksCsv(storygraph).books, () => `b${++n}`).books;
  const s = bookStats(all, W);
  it('counts books finished inside the year', () => {
    // Apr, May, Jul, Sep, Nov 2025 and Feb 2026. "Half a Season" (Aug 2024) and the undated one are outside.
    expect(s.count).toBe(6);
    expect(s.list.map((b) => b.finished)).toEqual(['2025-04-18', '2025-05-20', '2025-07-02', '2025-09-19', '2025-11-30', '2026-02-14']);
    expect(s.undated).toBe(1);
  });
  it('sums pages only where known, and averages only rated books', () => {
    expect([s.pages, s.withPages]).toEqual([312 + 208 + 156, 3]);
    expect(s.rated).toBe(5);
    expect(s.avgRating).toBeCloseTo((5 + 4.25 + 4 + 3.5 + 5) / 5, 10); // 4.35
  });
  it('ranks by rating, earliest finished first among equals', () => {
    expect(s.topRated.map((b) => b.title)).toEqual(['The Salt Road, Revisited', 'Maps, Margins', 'The Glass Estuary', 'Notes on a Small Harbour', 'Winter, Counted']);
  });
  it('counts by month', () => {
    expect(s.byMonth).toHaveLength(13);
    expect(s.byMonth.filter((m) => m.count).map((m) => m.month)).toEqual(['2025-04', '2025-05', '2025-07', '2025-09', '2025-11', '2026-02']);
  });
  it('treats the birthday boundaries correctly', () => {
    const b = (finished: string): Book => ({ id: finished, title: finished, author: '', finished });
    expect(bookStats([b('2025-03-09'), b('2025-03-10'), b('2026-03-09'), b('2026-03-10')], W).list.map((x) => x.finished)).toEqual(['2025-03-10', '2026-03-09']);
    expect(bookStats([], W)).toMatchObject({ count: 0, pages: 0, avgRating: null, topRated: [] });
  });
});
