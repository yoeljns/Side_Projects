import { describe, expect, it } from 'vitest';
import {
  allTags, allTracks, annotationProblem, annotationYears, blankAnnotation, decimalYear, deleteAnnotation, duplicateTrack, filterAnnotations,
  lagPhrase, linkLag, linkTargets, newTrack, normalisePhase, parseTags, redatePhase, removeTrack, resolveRef, restoreBuiltins, setStatus,
  setTrackPref, updateTrack, upsertAnnotation, upsertEvent, upsertPhase, visibleTracks,
} from './model';
import { REFERENCE_TRACKS } from './reference';
import { BLANK_DOC, type Annotation, type AtlasDoc, type LinkAnnotation, type Phase, type PhaseKind, type Track } from './types';

const P = (id: string, start: number, end: number | null, kind: PhaseKind = 'expansion'): Phase => ({ id, name: id, start, end, kind, source: 'test' });
const T = (phases: Phase[]): Track => ({ id: 'own-t', name: 't', author: 'Mine', group: 'own', color: 0, phases, events: [] });
const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const NOW = 2026;

describe('decimalYear', () => {
  it('places a date within its year in UTC', () => {
    expect(decimalYear('2026-01-01')).toBe(2026);
    expect(decimalYear('2026-07-02')).toBeCloseTo(2026 + 182 / 365, 6);
    expect(decimalYear('2024-12-31')).toBeCloseTo(2024 + 365 / 366, 6);
  });
});

describe('tracks', () => {
  it('hides and dims without touching the built-in data, and restores', () => {
    let doc = setTrackPref(BLANK_DOC, 'ref-oil', { hidden: true });
    doc = setTrackPref(doc, 'ref-perez', { dimmed: true });
    expect(visibleTracks(doc).some((t) => t.id === 'ref-oil')).toBe(false);
    expect(doc.trackPrefs).toEqual({ 'ref-oil': { hidden: true }, 'ref-perez': { dimmed: true } });
    expect(setTrackPref(doc, 'ref-oil', { hidden: false }).trackPrefs).toEqual({ 'ref-perez': { dimmed: true } });
    const own = newTrack(doc, ' Mine ', 3, ids());
    const hiddenOwn = setTrackPref(own.doc, own.id, { hidden: true });
    const restored = restoreBuiltins(hiddenOwn);
    expect(restored.trackPrefs).toEqual({ [own.id]: { hidden: true } });
    expect(restored.tracks).toHaveLength(1);
  });

  it('duplicates a built-in track into an editable copy and leaves the original alone', () => {
    const r = duplicateTrack(BLANK_DOC, 'ref-commodities', ids())!;
    const copy = r.doc.tracks[0];
    const orig = REFERENCE_TRACKS.find((t) => t.id === 'ref-commodities')!;
    expect(copy).toMatchObject({ id: r.id, group: 'own', copiedFrom: 'ref-commodities', author: 'Edited from Erten and Ocampo' });
    expect(copy.phases.map((p) => [p.start, p.end, p.source])).toEqual(orig.phases.map((p) => [p.start, p.end, p.source]));
    expect(copy.phases[0].id).not.toBe(orig.phases[0].id);
    const edited = updateTrack(r.doc, r.id, (t) => redatePhase(t, t.phases[0].id, 'start', 1890, NOW));
    expect(edited.tracks[0].phases[0].start).toBe(1890);
    expect(orig.phases[0].start).toBe(1894);
    expect(allTracks(edited)).toHaveLength(REFERENCE_TRACKS.length + 1);
    // a copy of a copy still remembers the original
    expect(duplicateTrack(r.doc, r.id, ids())!.doc.tracks[1].copiedFrom).toBe('ref-commodities');
    expect(duplicateTrack(BLANK_DOC, 'nope', ids())).toBeNull();
  });

  it('refuses to edit or remove a built-in track', () => {
    expect(updateTrack(BLANK_DOC, 'ref-perez', (t) => ({ ...t, name: 'x' }))).toBe(BLANK_DOC);
    expect(removeTrack(BLANK_DOC, 'ref-perez')).toBe(BLANK_DOC);
  });

  it('removing a track drops links into it and unpins annotations from it', () => {
    const made = newTrack(BLANK_DOC, 'A', 0, ids());
    let doc = updateTrack(made.doc, made.id, (t) => upsertPhase(t, P('p1', 1950, 1960), NOW));
    const base = blankAnnotation('link', 'L', '2026-01-01', { year: 0 }) as LinkAnnotation;
    const link: Annotation = { ...base, title: 'l', from: { trackId: made.id, itemId: 'p1', edge: 'start' }, to: { trackId: 'ref-oil', itemId: 'o1' } };
    const pin: Annotation = { ...blankAnnotation('pin', 'N', '2026-01-01', { year: 1955, trackId: made.id }), title: 'p' };
    doc = upsertAnnotation(upsertAnnotation(doc, link, '2026-01-01'), pin, '2026-01-01');
    doc = { ...doc, notes: [{ id: 'n', date: '2026-01-02', title: '', body: '', refs: ['L', 'N'] }] };
    const after = removeTrack(doc, made.id);
    expect(after.annotations.map((a) => a.id)).toEqual(['N']);
    expect(after.annotations[0]).toMatchObject({ kind: 'pin', trackId: undefined });
    expect(after.notes[0].refs).toEqual(['N']);
  });
});

describe('phases and events', () => {
  it('keeps phases sorted, at least a year long and in range', () => {
    let t = T([]);
    t = upsertPhase(t, P('b', 1950, 1960), NOW);
    t = upsertPhase(t, P('a', 1900.4, 1900), NOW);
    t = upsertPhase(t, { ...P('c', 1200, 1300), name: '  ' }, NOW);
    expect(t.phases.map((p) => [p.id, p.start, p.end])).toEqual([['c', 1700, 1701], ['a', 1900, 1901], ['b', 1950, 1960]]);
    expect(t.phases[0].name).toBe('Untitled phase');
    expect(normalisePhase(P('z', 3000, null), NOW)).toMatchObject({ start: 2076, end: null });
    t = upsertPhase(t, P('b', 1890, 1895), NOW);
    expect(t.phases.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });
  it('keeps events sorted', () => {
    let t = T([]);
    t = upsertEvent(t, { id: 'e2', year: 1990, label: 'x', kind: 'peak', source: '' }, NOW);
    t = upsertEvent(t, { id: 'e1', year: 1980.6, label: ' ', kind: 'peak', source: '' }, NOW);
    expect(t.events.map((e) => [e.id, e.year, e.label])).toEqual([['e1', 1981, 'Untitled event'], ['e2', 1990, 'x']]);
  });
});

describe('redatePhase', () => {
  const base = T([P('a', 1900, 1920), P('b', 1920, 1940, 'contraction'), P('c', 1950, 1960), P('d', 2010, null)]);
  const dates = (t: Track) => t.phases.map((p) => [p.id, p.start, p.end]);

  it('moves a free edge and rounds to whole years', () => {
    expect(dates(redatePhase(base, 'c', 'start', 1944.6, NOW))).toContainEqual(['c', 1945, 1960]);
    expect(dates(redatePhase(base, 'c', 'end', 1971.2, NOW))).toContainEqual(['c', 1950, 1971]);
  });

  it('never lets a phase get shorter than one year', () => {
    expect(dates(redatePhase(base, 'c', 'start', 1980, NOW))).toContainEqual(['c', 1959, 1960]);
    expect(dates(redatePhase(base, 'c', 'end', 1900, NOW))).toContainEqual(['c', 1950, 1951]);
  });

  it('moves a shared boundary on both phases', () => {
    const t = redatePhase(base, 'a', 'end', 1925, NOW);
    expect(dates(t)).toEqual([['a', 1900, 1925], ['b', 1925, 1940], ['c', 1950, 1960], ['d', 2010, null]]);
    const u = redatePhase(base, 'b', 'start', 1912, NOW);
    expect(dates(u).slice(0, 2)).toEqual([['a', 1900, 1912], ['b', 1912, 1940]]);
  });

  it('stops a shared boundary one year short of the far edge of either phase', () => {
    // dragging a's end right: b (1920-1940) must keep a year -> 1939
    expect(dates(redatePhase(base, 'a', 'end', 1990, NOW)).slice(0, 2)).toEqual([['a', 1900, 1939], ['b', 1939, 1940]]);
    // dragging b's start left: a (1900-1920) must keep a year -> 1901
    expect(dates(redatePhase(base, 'b', 'start', 1800, NOW)).slice(0, 2)).toEqual([['a', 1900, 1901], ['b', 1901, 1940]]);
  });

  it('lets phases overlap when they did not share the boundary', () => {
    expect(dates(redatePhase(base, 'c', 'start', 1930, NOW))).toEqual([['a', 1900, 1920], ['b', 1920, 1940], ['c', 1930, 1960], ['d', 2010, null]]);
  });

  it('handles open phases: the start moves up to this year, the end cannot be dragged', () => {
    expect(dates(redatePhase(base, 'd', 'start', 2090, NOW))).toContainEqual(['d', 2026, null]);
    expect(redatePhase(base, 'd', 'end', 2020, NOW)).toBe(base);
    // an open neighbour does not cap the drag except by the global limit
    const t = T([P('x', 2000, 2010), P('y', 2010, null)]);
    expect(dates(redatePhase(t, 'x', 'end', 2200, NOW))).toEqual([['x', 2000, 2076], ['y', 2076, null]]);
  });

  it('clamps to the earliest allowed year and re-sorts', () => {
    const t = redatePhase(base, 'c', 'start', 1500, NOW);
    expect(dates(t)[0]).toEqual(['c', 1700, 1960]);
  });

  it('returns the same object when nothing changes or the phase is unknown', () => {
    expect(redatePhase(base, 'a', 'end', 1920, NOW)).toBe(base);
    expect(redatePhase(base, 'zzz', 'end', 1920, NOW)).toBe(base);
  });
});

describe('links', () => {
  const tracks = REFERENCE_TRACKS;
  it('resolves events and either edge of a phase', () => {
    expect(resolveRef(tracks, { trackId: 'ref-perez', itemId: 'pzb4' }, NOW)).toMatchObject({ year: 1908, trackName: 'Technological revolutions' });
    expect(resolveRef(tracks, { trackId: 'ref-perez', itemId: 'pz4t', edge: 'start' }, NOW)).toMatchObject({ year: 1929, label: 'start of 4th: turning point' });
    expect(resolveRef(tracks, { trackId: 'ref-perez', itemId: 'pz4t', edge: 'end' }, NOW)?.year).toBe(1943);
    expect(resolveRef(tracks, { trackId: 'ref-perez', itemId: 'pz5t', edge: 'end' }, NOW)).toMatchObject({ year: 2026, label: 'end of 5th: turning point (still open)' });
    expect(resolveRef(tracks, { trackId: 'ref-perez', itemId: 'gone' }, NOW)).toBeNull();
    expect(resolveRef(tracks, { trackId: 'gone', itemId: 'pzb4' }, NOW)).toBeNull();
  });
  it('computes the lag in years, signed', () => {
    // Perez 4th turning point starts 1929; commodity 2nd peak 1951
    const l = linkLag(tracks, { trackId: 'ref-perez', itemId: 'pz4t', edge: 'start' }, { trackId: 'ref-commodities', itemId: 'sp2' }, NOW)!;
    expect(l.lag).toBe(22);
    expect(lagPhrase(l.lag)).toBe('leads by 22 years');
    expect(linkLag(tracks, { trackId: 'ref-commodities', itemId: 'sp2' }, { trackId: 'ref-perez', itemId: 'pz4t', edge: 'start' }, NOW)!.lag).toBe(-22);
    expect(lagPhrase(-1)).toBe('lags by 1 year');
    expect(lagPhrase(0)).toBe('same year');
  });
  it('lists link targets in date order, without the end of an open phase', () => {
    const t = linkTargets(tracks.find((x) => x.id === 'ref-rates')!, NOW);
    expect(t[0]).toMatchObject({ year: 1920, label: 'Start of Falling yields' });
    expect(t.map((x) => x.year)).toEqual([...t.map((x) => x.year)].sort((a, b) => a - b));
    expect(t.some((x) => x.ref.itemId === 'r4' && x.ref.edge === 'end')).toBe(false);
  });
});

describe('annotations', () => {
  const mk = (id: string, over: Partial<Annotation> = {}): Annotation => ({ ...blankAnnotation('pin', id, '2026-01-01', { year: 1973 }), title: id, ...over }) as Annotation;

  it('validates each kind', () => {
    const t = REFERENCE_TRACKS;
    expect(annotationProblem(mk('a', { title: ' ' }), t, NOW)).toBe('Give it a title.');
    expect(annotationProblem(mk('a'), t, NOW)).toBeNull();
    const span = { ...blankAnnotation('span', 's', '2026-01-01', { year: 1970 }), title: 's' };
    expect(annotationProblem(span, t, NOW)).toBeNull();
    expect(annotationProblem({ ...span, end: 1970 } as Annotation, t, NOW)).toBe('The end year must be after the start year.');
    const link = { ...blankAnnotation('link', 'l', '2026-01-01', { year: 0 }), title: 'l' } as LinkAnnotation;
    expect(annotationProblem(link, t, NOW)).toBe('Pick an item on each track.');
    const same: Annotation = { ...link, from: { trackId: 'ref-oil', itemId: 'o1' }, to: { trackId: 'ref-oil', itemId: 'o2' } };
    expect(annotationProblem(same, t, NOW)).toBe('A link joins items on two different tracks.');
    const ok: Annotation = { ...link, from: { trackId: 'ref-oil', itemId: 'o2' }, to: { trackId: 'ref-commodities', itemId: 'sp3' } };
    expect(annotationProblem(ok, t, NOW)).toBeNull();
    expect(annotationProblem({ ...ok, to: { trackId: 'ref-commodities', itemId: 'zz' } } as Annotation, t, NOW)).toBe('One of the linked items no longer exists.');
    expect(annotationYears(ok, t, NOW)).toEqual({ start: 1973, end: 1973 });
    expect(annotationYears(span, t, NOW)).toEqual({ start: 1970, end: 1980 });
  });

  it('logs status and confidence changes with the date, and keeps the creation date', () => {
    let doc: AtlasDoc = upsertAnnotation(BLANK_DOC, mk('a'), '2026-03-01');
    expect(doc.annotations[0].log).toEqual([{ on: '2026-03-01', change: 'created as hunch, low confidence' }]);
    doc = upsertAnnotation(doc, { ...doc.annotations[0], body: 'more' }, '2026-03-05');
    expect(doc.annotations[0].log).toHaveLength(1);
    expect(doc.annotations[0]).toMatchObject({ createdOn: '2026-03-01', updatedOn: '2026-03-05' });
    doc = upsertAnnotation(doc, { ...doc.annotations[0], status: 'claim', confidence: 'medium' }, '2026-04-01');
    doc = setStatus(doc, 'a', 'dropped', '2026-05-01');
    expect(doc.annotations[0].log.map((l) => `${l.on} ${l.change}`)).toEqual([
      '2026-03-01 created as hunch, low confidence',
      '2026-04-01 status hunch to claim',
      '2026-04-01 confidence low to medium',
      '2026-05-01 status claim to dropped',
    ]);
    expect(setStatus(doc, 'a', 'dropped', '2026-06-01')).toBe(doc);
    expect(doc.annotations).toHaveLength(1);
  });

  it('filters by status, tag and text; dropped ideas are hidden only by the active filter', () => {
    const list = [mk('a', { tags: ['oil'] }), mk('b', { status: 'dropped', tags: ['oil', 'debt'] }), mk('c', { status: 'tested', body: 'Kindleberger' })];
    expect(filterAnnotations(list, { tag: '', status: 'active' }).map((a) => a.id)).toEqual(['a', 'c']);
    expect(filterAnnotations(list, { tag: '', status: 'all' }).map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(filterAnnotations(list, { tag: '', status: 'dropped' }).map((a) => a.id)).toEqual(['b']);
    expect(filterAnnotations(list, { tag: 'oil', status: 'all' }).map((a) => a.id)).toEqual(['a', 'b']);
    expect(filterAnnotations(list, { tag: 'oil', status: 'active' }).map((a) => a.id)).toEqual(['a']);
    expect(filterAnnotations(list, { tag: '', status: 'all', text: 'kindle' }).map((a) => a.id)).toEqual(['c']);
    expect(allTags(list)).toEqual([{ tag: 'oil', count: 2 }, { tag: 'debt', count: 1 }]);
  });

  it('deleting removes references from theory notes', () => {
    let doc = upsertAnnotation(BLANK_DOC, mk('a'), '2026-03-01');
    doc = { ...doc, notes: [{ id: 'n', date: '2026-03-02', title: '', body: '', refs: ['a'] }] };
    const after = deleteAnnotation(doc, 'a');
    expect(after.annotations).toEqual([]);
    expect(after.notes[0].refs).toEqual([]);
  });

  it('parses tags', () => {
    expect(parseTags(' #Oil, debt cycle,oil ,, Lag\nfoo')).toEqual(['oil', 'debt-cycle', 'lag', 'foo']);
    expect(parseTags('')).toEqual([]);
  });
});
