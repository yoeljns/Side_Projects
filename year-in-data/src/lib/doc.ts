import { DEFAULT_QUESTIONS } from './questions';
import type { Doc } from './types';

export const STORE_KEY = 'year-in-data:v1';

export const BLANK: Doc = {
  birthday: null,
  questions: DEFAULT_QUESTIONS,
  answers: {},
  books: [],
  builds: [],
  counters: [],
  chess: { lichess: '', chesscom: '', cache: {} },
  github: { repos: [], cache: {} },
  imported: {},
};

/** Years that hold anything the owner wrote or fetched, newest first. */
export function yearsWithContent(doc: Doc): number[] {
  const keys = new Set<string>();
  for (const [k, a] of Object.entries(doc.answers)) if (Object.values(a).some((t) => t.trim())) keys.add(k);
  for (const k of Object.keys(doc.chess.cache)) keys.add(k);
  for (const k of Object.keys(doc.github.cache)) keys.add(k);
  for (const c of doc.counters) for (const k of Object.keys(c.byYear)) keys.add(k);
  return [...keys].map(Number).filter(Number.isInteger).sort((a, b) => b - a);
}

/** The earliest date in any record, to know how far back the year picker should go. */
export function earliestDate(doc: Doc): string | null {
  const dates: string[] = [];
  const two = doc.imported.twoCity?.data;
  if (two) dates.push(...two.stays.map((s) => s.arrive), ...two.fixtures.filter((f) => f.attended).map((f) => f.date));
  if (doc.imported.hours) dates.push(...doc.imported.hours.data.entries.map((e) => e.day));
  if (doc.imported.decisions) dates.push(...doc.imported.decisions.data.decisions.map((d) => d.madeOn));
  dates.push(...doc.books.flatMap((b) => (b.finished ? [b.finished] : [])), ...doc.builds.map((b) => b.shipped));
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}
