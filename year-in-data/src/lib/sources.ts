// Read the other apps' documents (a backup file, or the document behind a sync code).
// Only the contract fields are kept; rows that do not fit the contract are dropped and counted.
import { isDate } from './dates';
import type { Decision, DecisionData, Fixture, HoursCategory, HoursData, HoursEntry, Stay, TwoCityData } from './types';

export type SourceId = 'twoCity' | 'hours' | 'decisions';
export const SOURCE_APP: Record<SourceId, { app: string; title: string; gives: string }> = {
  twoCity: { app: 'two-city', title: 'Two City', gives: 'Trips and matches' },
  hours: { app: 'hours-ledger', title: 'Hours Ledger', gives: 'Hours' },
  decisions: { app: 'decision-journal', title: 'Decision Journal', gives: 'Decisions' },
};

export interface Parsed<T> {
  data: T;
  /** Rows left out because a required field was missing or malformed. */
  dropped: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function rows<T>(doc: Record<string, unknown>, field: string, pick: (r: Record<string, unknown>, i: number) => T | null): { kept: T[]; dropped: number } {
  const raw = doc[field];
  if (!Array.isArray(raw)) return { kept: [], dropped: 0 };
  const kept: T[] = [];
  let dropped = 0;
  raw.forEach((r, i) => {
    const row = isObj(r) ? pick(r, i) : null;
    if (row) kept.push(row);
    else dropped += 1;
  });
  return { kept, dropped };
}

const idOf = (r: Record<string, unknown>, i: number) => (str(r.id) ? r.id : `row-${i}`);

export function parseTwoCity(doc: unknown): Parsed<TwoCityData> {
  if (!isObj(doc) || (!Array.isArray(doc.stays) && !Array.isArray(doc.fixtures))) throw new Error('That is not a Two City document: it has no stays or fixtures.');
  const stays = rows<Stay>(doc, 'stays', (r, i) => {
    if (!str(r.city) || !isDate(r.arrive)) return null;
    const depart = r.depart === null || r.depart === undefined || r.depart === '' ? null : r.depart;
    if (depart !== null && (!isDate(depart) || depart < r.arrive)) return null;
    return { id: idOf(r, i), city: r.city.trim(), country: str(r.country) ? r.country.trim().toUpperCase() : '??', arrive: r.arrive, depart };
  });
  const fixtures = rows<Fixture>(doc, 'fixtures', (r, i) => {
    if (!isDate(r.date) || !str(r.opponent)) return null;
    return {
      id: idOf(r, i),
      date: r.date,
      opponent: r.opponent.trim(),
      home: r.home === true,
      competition: str(r.competition) ? r.competition.trim() : 'Other',
      ...(str(r.venue) ? { venue: r.venue.trim() } : {}),
      attended: r.attended === true,
    };
  });
  return { data: { stays: stays.kept, fixtures: fixtures.kept }, dropped: stays.dropped + fixtures.dropped };
}

export function parseHours(doc: unknown): Parsed<HoursData> {
  if (!isObj(doc) || !Array.isArray(doc.entries)) throw new Error('That is not an Hours Ledger document: it has no entries.');
  const entries = rows<HoursEntry>(doc, 'entries', (r, i) => {
    if (!isDate(r.day) || !str(r.category) || typeof r.minutes !== 'number' || !Number.isFinite(r.minutes) || r.minutes < 0) return null;
    return { id: idOf(r, i), day: r.day, category: r.category, minutes: r.minutes };
  });
  const categories = rows<HoursCategory>(doc, 'categories', (r) => (str(r.id) && str(r.label) ? { id: r.id, label: r.label.trim() } : null));
  return { data: { entries: entries.kept, categories: categories.kept }, dropped: entries.dropped + categories.dropped };
}

export function parseDecisions(doc: unknown): Parsed<DecisionData> {
  if (!isObj(doc) || !Array.isArray(doc.decisions)) throw new Error('That is not a Decision Journal document: it has no decisions.');
  const decisions = rows<Decision>(doc, 'decisions', (r, i) => {
    const p = r.probability;
    if (!str(r.title) || !isDate(r.madeOn) || typeof p !== 'number' || !(p >= 0 && p <= 1)) return null;
    // An outcome with no resolved date is dated to its review date; with neither, it stays open.
    const resolvedOn = isDate(r.resolvedOn) ? r.resolvedOn : isDate(r.reviewOn) ? r.reviewOn : null;
    const resolved = typeof r.outcome === 'boolean' && resolvedOn !== null;
    return {
      id: idOf(r, i),
      title: r.title.trim(),
      category: str(r.category) ? r.category : '',
      madeOn: r.madeOn,
      probability: p,
      ...(isDate(r.reviewOn) ? { reviewOn: r.reviewOn } : {}),
      ...(resolved ? { outcome: r.outcome as boolean, resolvedOn: resolvedOn as string } : {}),
    };
  });
  return { data: { decisions: decisions.kept }, dropped: decisions.dropped };
}

export function parseSource(id: SourceId, doc: unknown): Parsed<TwoCityData | HoursData | DecisionData> {
  return id === 'twoCity' ? parseTwoCity(doc) : id === 'hours' ? parseHours(doc) : parseDecisions(doc);
}

export function sourceCount(id: SourceId, data: TwoCityData | HoursData | DecisionData): string {
  if (id === 'twoCity') {
    const d = data as TwoCityData;
    return `${d.stays.length} stays, ${d.fixtures.length} fixtures`;
  }
  if (id === 'hours') return `${(data as HoursData).entries.length} entries`;
  return `${(data as DecisionData).decisions.length} decisions`;
}
