// Operations on the atlas document. Pure: every function returns a new value,
// ids and today's date are passed in.
import { REFERENCE_IDS, REFERENCE_TRACKS } from './reference';
import {
  MIN_YEAR,
  type Annotation,
  type AtlasDoc,
  type Confidence,
  type CycleEvent,
  type ItemRef,
  type Phase,
  type Status,
  type Track,
} from './types';

export const yearOf = (date: string): number => Number(date.slice(0, 4));

/** '2026-07-02' -> 2026.5 (UTC, day of year over days in the year). */
export function decimalYear(date: string): number {
  const y = yearOf(date);
  const t = Date.parse(`${date}T00:00:00Z`);
  const a = Date.UTC(y, 0, 1);
  const b = Date.UTC(y + 1, 0, 1);
  return y + (t - a) / (b - a);
}

export const isBuiltin = (trackId: string): boolean => REFERENCE_IDS.has(trackId);

/** Built-in tracks first, then the owner's, in stored order. */
export function allTracks(doc: AtlasDoc): Track[] {
  return [...REFERENCE_TRACKS, ...doc.tracks];
}

export function visibleTracks(doc: AtlasDoc): Track[] {
  return allTracks(doc).filter((t) => !doc.trackPrefs[t.id]?.hidden);
}

export function findTrack(doc: AtlasDoc, id: string): Track | undefined {
  return allTracks(doc).find((t) => t.id === id);
}

/** End of a phase for arithmetic: an open phase runs to `nowYear`. */
export const phaseEnd = (p: Phase, nowYear: number): number => (p.end === null ? Math.max(nowYear, p.start) : p.end);

export function setTrackPref(doc: AtlasDoc, id: string, pref: { hidden?: boolean; dimmed?: boolean }): AtlasDoc {
  const next = { ...doc.trackPrefs[id], ...pref };
  const prefs = { ...doc.trackPrefs };
  if (!next.hidden && !next.dimmed) delete prefs[id];
  else prefs[id] = { ...(next.hidden ? { hidden: true } : {}), ...(next.dimmed ? { dimmed: true } : {}) };
  return { ...doc, trackPrefs: prefs };
}

/** Show every built-in track again at full strength. The owner's tracks and copies are left alone. */
export function restoreBuiltins(doc: AtlasDoc): AtlasDoc {
  const prefs = Object.fromEntries(Object.entries(doc.trackPrefs).filter(([id]) => !isBuiltin(id)));
  return { ...doc, trackPrefs: prefs };
}

/**
 * Copy a track into the owner's layer so it can be edited. Items keep their
 * citations; ids are new so links to the original still point at the original.
 */
export function duplicateTrack(doc: AtlasDoc, sourceId: string, newId: () => string): { doc: AtlasDoc; id: string } | null {
  const src = findTrack(doc, sourceId);
  if (!src) return null;
  const id = `own-${newId()}`;
  const copy: Track = {
    ...src,
    id,
    name: `${src.name} (my copy)`,
    author: isBuiltin(src.id) ? `Edited from ${src.author}` : src.author,
    group: 'own',
    copiedFrom: src.copiedFrom ?? src.id,
    phases: src.phases.map((p) => ({ ...p, id: newId() })),
    events: src.events.map((e) => ({ ...e, id: newId() })),
  };
  return { doc: { ...doc, tracks: [...doc.tracks, copy] }, id };
}

export function newTrack(doc: AtlasDoc, name: string, color: number, newId: () => string): { doc: AtlasDoc; id: string } {
  const id = `own-${newId()}`;
  const track: Track = { id, name: name.trim() || 'Untitled track', author: 'Mine', group: 'own', color, phases: [], events: [] };
  return { doc: { ...doc, tracks: [...doc.tracks, track] }, id };
}

/** Change one of the owner's tracks. Built-in tracks are never changed. */
export function updateTrack(doc: AtlasDoc, id: string, fn: (t: Track) => Track): AtlasDoc {
  if (isBuiltin(id)) return doc;
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === id ? fn(t) : t)) };
}

/** Removes the track, its display preference, and any link annotation that pointed into it. */
export function removeTrack(doc: AtlasDoc, id: string): AtlasDoc {
  if (isBuiltin(id)) return doc;
  const prefs = { ...doc.trackPrefs };
  delete prefs[id];
  const gone = new Set(
    doc.annotations.filter((a) => a.kind === 'link' && (a.from.trackId === id || a.to.trackId === id)).map((a) => a.id),
  );
  return {
    ...doc,
    tracks: doc.tracks.filter((t) => t.id !== id),
    trackPrefs: prefs,
    annotations: doc.annotations
      .filter((a) => !gone.has(a.id))
      .map((a) => (a.kind !== 'link' && a.trackId === id ? { ...a, trackId: undefined } : a)),
    notes: doc.notes.map((n) => ({ ...n, refs: n.refs.filter((r) => !gone.has(r)) })),
  };
}

const sortPhases = (ps: Phase[]): Phase[] => [...ps].sort((a, b) => a.start - b.start || (a.end ?? Infinity) - (b.end ?? Infinity));
const sortEvents = (es: CycleEvent[]): CycleEvent[] => [...es].sort((a, b) => a.year - b.year);

export const clampYear = (y: number, nowYear: number): number => Math.min(Math.max(Math.round(y), MIN_YEAR), nowYear + 50);

/** Tidy a phase so it is at least one year long and inside the allowed range. */
export function normalisePhase(p: Phase, nowYear: number): Phase {
  const start = clampYear(p.start, nowYear);
  const end = p.end === null ? null : Math.max(clampYear(p.end, nowYear), start + 1);
  return { ...p, start, end, name: p.name.trim() || 'Untitled phase' };
}

export function upsertPhase(track: Track, phase: Phase, nowYear: number): Track {
  const p = normalisePhase(phase, nowYear);
  const exists = track.phases.some((x) => x.id === p.id);
  return { ...track, phases: sortPhases(exists ? track.phases.map((x) => (x.id === p.id ? p : x)) : [...track.phases, p]) };
}

export function upsertEvent(track: Track, event: CycleEvent, nowYear: number): Track {
  const e = { ...event, year: clampYear(event.year, nowYear), label: event.label.trim() || 'Untitled event' };
  const exists = track.events.some((x) => x.id === e.id);
  return { ...track, events: sortEvents(exists ? track.events.map((x) => (x.id === e.id ? e : x)) : [...track.events, e]) };
}

export function removeItem(track: Track, itemId: string): Track {
  return { ...track, phases: track.phases.filter((p) => p.id !== itemId), events: track.events.filter((e) => e.id !== itemId) };
}

/**
 * Move one edge of a phase to `year` (dragging on the timeline).
 *
 * Rules:
 * - years are whole and stay within MIN_YEAR .. nowYear + 50;
 * - a phase stays at least one year long;
 * - the end of an open phase cannot be dragged (close it in the form first);
 * - if another phase shared that boundary before the move (its end sat on this
 *   start, or its start on this end), the neighbour's edge moves with it, and
 *   the neighbour must also stay at least one year long. Phases that merely
 *   overlap are left alone: published chronologies do overlap.
 */
export function redatePhase(track: Track, phaseId: string, edge: 'start' | 'end', year: number, nowYear: number): Track {
  const p = track.phases.find((x) => x.id === phaseId);
  if (!p) return track;
  if (edge === 'end' && p.end === null) return track;
  const old = edge === 'start' ? p.start : (p.end as number);
  let lo = MIN_YEAR;
  let hi = nowYear + 50;
  if (edge === 'start') hi = Math.min(hi, p.end === null ? nowYear : p.end - 1);
  else lo = Math.max(lo, p.start + 1);
  const neighbours = track.phases.filter((x) => x.id !== phaseId && (edge === 'start' ? x.end === old : x.start === old));
  for (const n of neighbours) {
    if (edge === 'start') lo = Math.max(lo, n.start + 1);
    else if (n.end !== null) hi = Math.min(hi, n.end - 1);
  }
  if (lo > hi) return track;
  const y = Math.min(Math.max(Math.round(year), lo), hi);
  if (y === old) return track;
  const ids = new Set(neighbours.map((n) => n.id));
  return {
    ...track,
    phases: sortPhases(
      track.phases.map((x) => {
        if (x.id === phaseId) return edge === 'start' ? { ...x, start: y } : { ...x, end: y };
        if (ids.has(x.id)) return edge === 'start' ? { ...x, end: y } : { ...x, start: y };
        return x;
      }),
    ),
  };
}

// ---------- annotations ----------

export interface ResolvedRef {
  year: number;
  label: string;
  trackId: string;
  trackName: string;
}

/** The year and a readable label for an item reference, or null if the item is gone. */
export function resolveRef(tracks: Track[], ref: ItemRef, nowYear: number): ResolvedRef | null {
  const t = tracks.find((x) => x.id === ref.trackId);
  if (!t) return null;
  const e = t.events.find((x) => x.id === ref.itemId);
  if (e) return { year: e.year, label: e.label, trackId: t.id, trackName: t.name };
  const p = t.phases.find((x) => x.id === ref.itemId);
  if (!p) return null;
  if (ref.edge === 'end') {
    return { year: phaseEnd(p, nowYear), label: `end of ${p.name}${p.end === null ? ' (still open)' : ''}`, trackId: t.id, trackName: t.name };
  }
  return { year: p.start, label: `start of ${p.name}`, trackId: t.id, trackName: t.name };
}

export interface LinkLag {
  from: ResolvedRef;
  to: ResolvedRef;
  /** to.year - from.year. Positive: the first item leads the second. */
  lag: number;
}

export function linkLag(tracks: Track[], from: ItemRef, to: ItemRef, nowYear: number): LinkLag | null {
  const a = resolveRef(tracks, from, nowYear);
  const b = resolveRef(tracks, to, nowYear);
  if (!a || !b) return null;
  return { from: a, to: b, lag: b.year - a.year };
}

export function lagPhrase(lag: number): string {
  const n = Math.abs(lag);
  const y = n === 1 ? 'year' : 'years';
  if (lag === 0) return 'same year';
  return lag > 0 ? `leads by ${n} ${y}` : `lags by ${n} ${y}`;
}

/** Why an annotation cannot be saved, or null if it can. */
export function annotationProblem(a: Annotation, tracks: Track[], nowYear: number): string | null {
  if (!a.title.trim()) return 'Give it a title.';
  if (a.kind === 'pin' && !Number.isFinite(a.year)) return 'Enter a year.';
  if (a.kind === 'span') {
    if (!Number.isFinite(a.start) || !Number.isFinite(a.end)) return 'Enter a start and an end year.';
    if (a.end <= a.start) return 'The end year must be after the start year.';
  }
  if (a.kind === 'link') {
    if (!a.from.itemId || !a.to.itemId) return 'Pick an item on each track.';
    if (a.from.trackId === a.to.trackId) return 'A link joins items on two different tracks.';
    if (!linkLag(tracks, a.from, a.to, nowYear)) return 'One of the linked items no longer exists.';
  }
  return null;
}

export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const t = raw.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Save an annotation. A change of status or confidence is added to its log with today's date. */
export function upsertAnnotation(doc: AtlasDoc, next: Annotation, today: string): AtlasDoc {
  const prev = doc.annotations.find((a) => a.id === next.id);
  if (!prev) {
    const created = { ...next, title: next.title.trim(), createdOn: today, updatedOn: today, log: [{ on: today, change: `created as ${next.status}, ${next.confidence} confidence` }] };
    return { ...doc, annotations: [...doc.annotations, created] };
  }
  const log = [...prev.log];
  if (prev.status !== next.status) log.push({ on: today, change: `status ${prev.status} to ${next.status}` });
  if (prev.confidence !== next.confidence) log.push({ on: today, change: `confidence ${prev.confidence} to ${next.confidence}` });
  const saved = { ...next, title: next.title.trim(), createdOn: prev.createdOn, updatedOn: today, log };
  return { ...doc, annotations: doc.annotations.map((a) => (a.id === next.id ? saved : a)) };
}

export function setStatus(doc: AtlasDoc, id: string, status: Status, today: string): AtlasDoc {
  const a = doc.annotations.find((x) => x.id === id);
  return a && a.status !== status ? upsertAnnotation(doc, { ...a, status }, today) : doc;
}

/** Permanent removal, for mistakes. Ideas that did not hold up should be set to "dropped" instead. */
export function deleteAnnotation(doc: AtlasDoc, id: string): AtlasDoc {
  return {
    ...doc,
    annotations: doc.annotations.filter((a) => a.id !== id),
    notes: doc.notes.map((n) => ({ ...n, refs: n.refs.filter((r) => r !== id) })),
  };
}

export interface AnnotationFilter {
  /** Empty: every tag. */
  tag: string;
  /** 'active' hides dropped ideas; 'all' shows everything. */
  status: Status | 'active' | 'all';
  text?: string;
}

export function filterAnnotations(list: Annotation[], f: AnnotationFilter): Annotation[] {
  const q = (f.text ?? '').trim().toLowerCase();
  return list.filter((a) => {
    if (f.status === 'active' ? a.status === 'dropped' : f.status !== 'all' && a.status !== f.status) return false;
    if (f.tag && !a.tags.includes(f.tag)) return false;
    if (q && !`${a.title}\n${a.body}\n${a.tags.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function allTags(list: Annotation[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const a of list) for (const t of a.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The year an annotation sits at, for sorting and for jumping the view to it. */
export function annotationYears(a: Annotation, tracks: Track[], nowYear: number): { start: number; end: number } | null {
  if (a.kind === 'pin') return { start: a.year, end: a.year };
  if (a.kind === 'span') return { start: a.start, end: a.end };
  const l = linkLag(tracks, a.from, a.to, nowYear);
  return l ? { start: Math.min(l.from.year, l.to.year), end: Math.max(l.from.year, l.to.year) } : null;
}

export function blankAnnotation(kind: Annotation['kind'], id: string, today: string, at: { year: number; trackId?: string }): Annotation {
  const base = { id, title: '', body: '', tags: [], confidence: 'low' as Confidence, status: 'hunch' as Status, createdOn: today, updatedOn: today, log: [] };
  if (kind === 'pin') return { ...base, kind, year: at.year, trackId: at.trackId };
  if (kind === 'span') return { ...base, kind, start: at.year, end: at.year + 10, trackId: at.trackId };
  return { ...base, kind, from: { trackId: at.trackId ?? '', itemId: '' }, to: { trackId: '', itemId: '' } };
}

/** Every dated thing on a track that a link can attach to, in date order. */
export function linkTargets(track: Track, nowYear: number): { ref: ItemRef; year: number; label: string }[] {
  const out: { ref: ItemRef; year: number; label: string }[] = [];
  for (const e of track.events) out.push({ ref: { trackId: track.id, itemId: e.id }, year: e.year, label: e.label });
  for (const p of track.phases) {
    out.push({ ref: { trackId: track.id, itemId: p.id, edge: 'start' }, year: p.start, label: `Start of ${p.name}` });
    if (p.end !== null) out.push({ ref: { trackId: track.id, itemId: p.id, edge: 'end' }, year: phaseEnd(p, nowYear), label: `End of ${p.name}` });
  }
  return out.sort((a, b) => a.year - b.year);
}

export const refKey = (r: ItemRef): string => `${r.trackId}|${r.itemId}|${r.edge ?? ''}`;
