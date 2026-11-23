import { describe, expect, it } from 'vitest';
import { markdownSummary } from './exportMd';
import { parseBlocks, parseInline } from './markdownish';
import { blankAnnotation, upsertAnnotation } from './model';
import { REFERENCE_TRACKS } from './reference';
import { BLANK_DOC, type Annotation, type AtlasDoc, type LinkAnnotation } from './types';

describe('markdown-ish parsing', () => {
  it('parses inline marks', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.org)')).toEqual([
      { t: 'text', text: 'a ' },
      { t: 'bold', children: [{ t: 'text', text: 'b' }] },
      { t: 'text', text: ' ' },
      { t: 'italic', children: [{ t: 'text', text: 'c' }] },
      { t: 'text', text: ' ' },
      { t: 'code', text: 'd' },
      { t: 'text', text: ' ' },
      { t: 'link', href: 'https://x.org', children: [{ t: 'text', text: 'e' }] },
    ]);
  });
  it('leaves stray asterisks and unsafe links as text', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', text: '2 * 3 * 4' }]);
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ t: 'text', text: '[x](javascript:alert(1))' }]);
  });
  it('parses paragraphs, lists and quotes', () => {
    const b = parseBlocks('one\ntwo\n\n- a\n- b\n> q\n\nlast');
    expect(b.map((x) => x.t)).toEqual(['p', 'ul', 'quote', 'p']);
    expect(b[0]).toEqual({ t: 'p', children: [{ t: 'text', text: 'one two' }] });
    expect(b[1]).toMatchObject({ t: 'ul', items: [[{ t: 'text', text: 'a' }], [{ t: 'text', text: 'b' }]] });
    expect(parseBlocks('')).toEqual([]);
  });
});

describe('markdownSummary', () => {
  const pin: Annotation = { ...blankAnnotation('pin', 'p', '', { year: 1973 }), title: 'Oil and the turn', body: 'Embargo lands **inside** the overlap.', tags: ['oil'] } as Annotation;
  const old: Annotation = { ...blankAnnotation('pin', 'o', '', { year: 1820 }), title: 'Out of view' } as Annotation;
  const dropped: Annotation = { ...blankAnnotation('span', 's', '', { year: 1965 }), title: 'Bad idea', status: 'dropped' } as Annotation;
  const link: Annotation = {
    ...(blankAnnotation('link', 'l', '', { year: 0 }) as LinkAnnotation),
    title: 'Turn before peak',
    from: { trackId: 'ref-perez', itemId: 'pz4t', edge: 'start' },
    to: { trackId: 'ref-commodities', itemId: 'sp2' },
  };
  let doc: AtlasDoc = BLANK_DOC;
  for (const a of [pin, old, dropped, link]) doc = upsertAnnotation(doc, a, '2026-02-01');
  doc = { ...doc, notes: [{ id: 'n', date: '2026-02-03', title: 'First pass', body: 'Lags look unstable.', refs: ['p', 'missing'] }] };
  const tracks = REFERENCE_TRACKS.filter((t) => t.id !== 'ref-oil');
  const md = markdownSummary({ doc, tracks, view: { start: 1925.2, end: 1979.6 }, today: '2026-11-23', includeDropped: true });

  it('heads the summary with the rounded view', () => {
    expect(md.startsWith('# Cycle atlas: 1925 to 1980\n')).toBe(true);
  });
  it('lists phases and events in view with sources and approximate marks', () => {
    expect(md).toContain('### Technological revolutions (Perez)');
    expect(md).toContain('- c. 1929 to c. 1943: 4th: turning point [turning point]. Source: Perez (2002), Technological Revolutions and Financial Capital.');
    expect(md).toContain('- 1951: Peak of 2nd super-cycle. Source: Erten and Ocampo (2013), World Development 44.');
    expect(md).not.toContain('1st: installation');
    expect(md).not.toContain('Oil shocks');
  });
  it('includes annotations in view, the link with its lag, and dropped ideas apart', () => {
    expect(md).toContain('### Oil and the turn\n\n*pin, 1973. Status: hunch. Confidence: low. Tags: #oil.*\n\nEmbargo lands **inside** the overlap.');
    expect(md).toContain('*link, Technological revolutions: start of 4th: turning point (1929) leads by 22 years Commodity super-cycles (non-oil): Peak of 2nd super-cycle (1951).');
    expect(md).not.toContain('Out of view');
    expect(md.indexOf('## Dropped ideas')).toBeGreaterThan(md.indexOf('## Annotations'));
    expect(md).toContain('### Bad idea');
  });
  it('can leave dropped ideas out', () => {
    const without = markdownSummary({ doc, tracks, view: { start: 1925, end: 1980 }, today: '2026-11-23', includeDropped: false });
    expect(without).not.toContain('Bad idea');
  });
  it('includes theory notes with the annotations they refer to', () => {
    expect(md).toContain('### 2026-02-03: First pass\n\nLags look unstable.\n\nRefers to: Oil and the turn.');
  });
  it('states the sample size in the where-are-we-now lines', () => {
    expect(md).toContain('- Commodity super-cycles (non-oil) (Erten and Ocampo): 4th super-cycle: after the peak, 16 years in; earlier contraction phases on this track lasted 15 to 26 years, mean 20.3 (n = 3: far too few to generalise).');
  });
});
