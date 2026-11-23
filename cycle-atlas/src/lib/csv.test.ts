import { describe, expect, it } from 'vitest';
import { parseSeriesCsv, parseValue, parseYear } from './csv';

describe('parseYear', () => {
  it('reads years, decimal years, months and days', () => {
    expect(parseYear('1973')).toBe(1973);
    expect(parseYear(' 1973.5 ')).toBe(1973.5);
    expect(parseYear('1973-01')).toBe(1973);
    // 1 July 1973 is day 181 of 365
    expect(parseYear('1973-07')).toBeCloseTo(1973 + 181 / 365, 3);
    expect(parseYear('1973-07-01')).toBe(parseYear('1973-07'));
    // leap year: 31 Dec 2024 is day 365 of 366
    expect(parseYear('2024-12-31')).toBeCloseTo(2024.997, 3);
  });
  it('rejects anything else', () => {
    for (const bad of ['', '73', '19730', '1973-13', '1973-02-30', 'Q1 1973', '01/07/1973', 'year']) expect(parseYear(bad)).toBeNull();
  });
});

describe('parseValue', () => {
  it('reads plain numbers only', () => {
    expect(parseValue('12')).toBe(12);
    expect(parseValue('-0.5')).toBe(-0.5);
    expect(parseValue('.5')).toBe(0.5);
    expect(parseValue('1e3')).toBe(1000);
    expect(parseValue('"42.0"')).toBe(42);
    for (const bad of ['', '1,234', '12%', 'n/a', '$5', '--1', 'Infinity']) expect(parseValue(bad)).toBeNull();
  });
});

describe('parseSeriesCsv', () => {
  it('reads a header and rows, sorted by year', () => {
    const r = parseSeriesCsv('year,value\n1972,101.5\n1970,100\n1971,98\n');
    expect(r.headerSkipped).toBe(true);
    expect(r.points).toEqual([{ year: 1970, value: 100 }, { year: 1971, value: 98 }, { year: 1972, value: 101.5 }]);
    expect(r.problems).toEqual([]);
  });
  it('accepts semicolons, tabs, CRLF, a BOM, comments, blank lines and extra columns', () => {
    const r = parseSeriesCsv('﻿Date;Index;Note\r\n# sourced by hand\r\n\r\n1900;50;x\r\n1901\t55\r\n"1902","60"\r\n');
    expect(r.points).toEqual([{ year: 1900, value: 50 }, { year: 1901, value: 55 }, { year: 1902, value: 60 }]);
    expect(r.problems).toEqual([]);
  });
  it('reports bad lines with their line numbers and carries on', () => {
    const r = parseSeriesCsv('1900,1\n1901,n/a\nabc,3\n1903\n1904,4');
    expect(r.points.map((p) => p.year)).toEqual([1900, 1904]);
    expect(r.problems).toEqual([
      { line: 2, text: '1901,n/a', why: 'the second column is not a number' },
      { line: 3, text: 'abc,3', why: 'the first column is not a year' },
      { line: 4, text: '1903', why: 'needs two columns' },
    ]);
    expect(r.headerSkipped).toBe(false);
  });
  it('skips only one header line, and only before any data', () => {
    const r = parseSeriesCsv('year,value\nyear,value\n1900,1');
    expect(r.headerSkipped).toBe(true);
    expect(r.problems.map((p) => p.line)).toEqual([2]);
  });
  it('keeps the last value for a repeated year and says so', () => {
    const r = parseSeriesCsv('1900,1\n1901,2\n1900,3');
    expect(r.points).toEqual([{ year: 1900, value: 3 }, { year: 1901, value: 2 }]);
    expect(r.duplicates).toEqual([1900]);
  });
  it('returns nothing for empty text', () => {
    expect(parseSeriesCsv('  \n')).toEqual({ points: [], problems: [], duplicates: [], headerSkipped: false });
  });
});
