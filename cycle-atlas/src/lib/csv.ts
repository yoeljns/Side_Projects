// CSV import for a data series: two columns, a year and a value.
import type { SeriesPoint } from './types';

export interface CsvResult {
  points: SeriesPoint[];
  /** Lines that could not be read, with their 1-based line numbers. */
  problems: { line: number; text: string; why: string }[];
  /** Years that appeared more than once: the last value was kept. */
  duplicates: number[];
  headerSkipped: boolean;
}

/**
 * Reads the first column as a year: 1973, 1973.5, 1973-10 (month) or
 * 1973-10-17 (day). Months and days become a fraction of the year.
 */
export function parseYear(raw: string): number | null {
  const s = raw.trim();
  let m = /^(\d{4})(\.\d+)?$/.exec(s);
  if (m) return Number(s);
  m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = m[3] === undefined ? 1 : Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  if (new Date(t).getUTCMonth() !== mo - 1) return null;
  const a = Date.UTC(y, 0, 1);
  const b = Date.UTC(y + 1, 0, 1);
  return Math.round((y + (t - a) / (b - a)) * 1000) / 1000;
}

/** Plain numbers only: optional sign, digits, optional decimals or exponent. "1,234" is rejected as ambiguous. */
export function parseValue(raw: string): number | null {
  const s = raw.trim().replace(/^"(.*)"$/, '$1').trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function splitLine(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
}

/**
 * Parse "year,value" text. Commas, semicolons or tabs separate the columns;
 * extra columns are ignored; one header line is skipped; blank lines and lines
 * starting with # are ignored. Points come back sorted by year.
 */
export function parseSeriesCsv(text: string): CsvResult {
  const problems: CsvResult['problems'] = [];
  const byYear = new Map<number, number>();
  const dup = new Set<number>();
  let headerSkipped = false;
  let seenData = false;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cells = splitLine(line);
    const year = parseYear(cells[0] ?? '');
    const value = cells.length > 1 ? parseValue(cells[1]) : null;
    if (year === null || value === null) {
      // A first non-numeric line is a header, not an error.
      if (!seenData && !headerSkipped && year === null && /[a-z]/i.test(cells[0] ?? '')) {
        headerSkipped = true;
        return;
      }
      const why = cells.length < 2 ? 'needs two columns' : year === null ? 'the first column is not a year' : 'the second column is not a number';
      problems.push({ line: i + 1, text: line.slice(0, 60), why });
      return;
    }
    seenData = true;
    if (byYear.has(year)) dup.add(year);
    byYear.set(year, value);
  });
  const points = [...byYear.entries()].map(([year, value]) => ({ year, value })).sort((a, b) => a.year - b.year);
  return { points, problems, duplicates: [...dup].sort((a, b) => a - b), headerSkipped };
}
