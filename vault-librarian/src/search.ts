// Search over the index: text (ranked), tags, path and dates. Pure.
import type { Note, VaultIndex } from './indexer.js';
import { globToRegExp } from './paths.js';
import type { Model } from './similarity.js';
import { fold, stems } from './text.js';

export interface SearchParams {
  query?: string;
  /** Every tag must be present; a parent tag matches its children ('cycles' matches 'cycles/debt'). */
  tags?: string[];
  /** Folder prefix ('Notes/Cycles') or glob ('Daily/2026-*'). */
  path?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  createdAfter?: string;
  createdBefore?: string;
  sort?: 'relevance' | 'modified' | 'created' | 'title';
}

export interface SearchHit {
  note: Note;
  score: number;
  /** Query words found in the note. */
  matched: string[];
  /** The line that best matches, as written, with its 1-based line number. */
  snippet: { line: number; text: string } | null;
}

function bestLine(note: Note, wanted: Set<string>, phrases: string[]): SearchHit['snippet'] {
  const lines = note.body.split('\n');
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const folded = fold(line);
    let score = phrases.filter((p) => folded.includes(p)).length * 3;
    if (wanted.size) score += new Set(stems(line).filter((s) => wanted.has(s))).size;
    if (/^\s*#{1,6}\s/.test(line)) score *= 0.6; // prefer a sentence to a heading
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best === -1) return null;
  const text = lines[best].trim();
  return { line: best + note.bodyStartLine + 1, text: text.length > 240 ? `${text.slice(0, 240)} […]` : text };
}

export function searchNotes(index: VaultIndex, model: Model, params: SearchParams): SearchHit[] {
  const wantedTags = (params.tags ?? []).map((t) => fold(t.trim().replace(/^#/, '').replace(/\/+$/, ''))).filter(Boolean);
  const pathFilter = params.path?.trim();
  const pathRe = pathFilter ? globToRegExp(pathFilter.replace(/^\/+/, '')) : null;

  const query = params.query?.trim() ?? '';
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => fold(m[1]).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const queryStems = [...new Set(stems(query.replace(/"/g, ' ')))];
  // A query of stop words or symbols only ("the", "C++") falls back to a plain substring match.
  const literal = query && !phrases.length && !queryStems.length ? fold(query) : null;
  const wanted = new Set(queryStems);

  const hits: SearchHit[] = [];
  for (const note of index.notes) {
    if (pathRe && !pathRe.test(note.path)) continue;
    if (params.modifiedAfter && note.modified < params.modifiedAfter) continue;
    if (params.modifiedBefore && note.modified > params.modifiedBefore) continue;
    if (params.createdAfter && note.created < params.createdAfter) continue;
    if (params.createdBefore && note.created > params.createdBefore) continue;
    const tagSet = model.tagSets.get(note.path) ?? new Set<string>();
    if (!wantedTags.every((t) => tagSet.has(t))) continue;

    let score = 0;
    const matched: string[] = [];
    if (query) {
      const haystack = `${fold(note.title)} ${fold(note.aliases.join(' '))} ${fold(note.plainText).replace(/\s+/g, ' ')}`;
      if (phrases.some((p) => !haystack.includes(p))) continue;
      if (literal !== null && !haystack.includes(literal)) continue;
      const counts = model.counts.get(note.path) ?? new Map<string, number>();
      const titleStems = new Set(stems([note.title, ...note.aliases].join(' ')));
      for (const s of queryStems) {
        const c = counts.get(s) ?? 0;
        const inTitle = titleStems.has(s);
        if (c === 0 && !inTitle) continue;
        const idf = Math.max(model.idf.get(s) ?? 0, 0.05);
        score += idf * (c / (c + 1.2)) + (inTitle ? 1.5 * idf : 0);
        matched.push(model.surface.get(s) ?? s);
      }
      if (queryStems.length && matched.length === 0) continue;
      // Notes that hold every query word come before notes that hold some.
      score += matched.length * 100 + phrases.length * 10;
    }
    hits.push({ note, score, matched, snippet: query ? bestLine(note, wanted, literal ? [literal] : phrases) : null });
  }

  const sort = params.sort ?? (query ? 'relevance' : 'modified');
  const byPath = (a: SearchHit, b: SearchHit) => (a.note.path < b.note.path ? -1 : a.note.path > b.note.path ? 1 : 0);
  hits.sort((a, b) => {
    if (sort === 'relevance') return b.score - a.score || byPath(a, b);
    if (sort === 'modified') return (a.note.modified < b.note.modified ? 1 : a.note.modified > b.note.modified ? -1 : 0) || byPath(a, b);
    if (sort === 'created') return (a.note.created < b.note.created ? 1 : a.note.created > b.note.created ? -1 : 0) || byPath(a, b);
    return a.note.title.localeCompare(b.note.title) || byPath(a, b);
  });
  return hits;
}
