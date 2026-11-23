import { afterAll, describe, expect, it } from 'vitest';
import { allPairs, buildModel, hasEvidence, queryVector, related, scorePair, scorePassages } from '../src/similarity.js';
import { cleanup, loadFixture, miniIndex } from './helpers.js';

afterAll(cleanup);

const WEIGHTS = { similarity: { textWeight: 0.7, tagWeight: 0.15, neighbourWeight: 0.15 } };

describe('scores on hand-checked cases', () => {
  it('gives identical prose a cosine of 1 and unrelated prose 0', () => {
    const index = miniIndex({
      'a.md': 'copper mine supply shortage',
      'b.md': 'copper mine supply shortage',
      'c.md': 'sourdough starter flour water',
      'd.md': 'bicycle chain tyre brake',
    });
    const model = buildModel(index, WEIGHTS);
    const ab = scorePair(model, 'a.md', 'b.md');
    expect(ab.text).toBeCloseTo(1, 6);
    expect(ab.score).toBeCloseTo(0.7, 6); // text only: no tags, no links
    expect(scorePair(model, 'a.md', 'c.md')).toMatchObject({ text: 0, tags: 0, neighbours: 0, score: 0, sharedTerms: [] });
    expect(scorePair(model, 'b.md', 'a.md')).toEqual(ab); // symmetric
  });

  it('computes the TF-IDF cosine by the stated formula', () => {
    // Three notes, body only (single-letter titles are dropped as too short).
    // df: copper 2, mine 1, price 2, bread 1; n = 3; idf = ln(1 + (n - df + 0.5) / (df + 0.5)).
    const index = miniIndex({ 'a.md': 'copper mine', 'b.md': 'copper price price', 'c.md': 'bread price' });
    const model = buildModel(index, WEIGHTS);
    const idf = (df: number) => Math.log(1 + (3 - df + 0.5) / (df + 0.5));
    const a = { copper: idf(2), mine: idf(1) };
    const b = { copper: idf(2), price: (1 + Math.log(2)) * idf(2) };
    const expected = (a.copper * b.copper) / (Math.hypot(a.copper, a.mine) * Math.hypot(b.copper, b.price));
    expect(scorePair(model, 'a.md', 'b.md').text).toBeCloseTo(expected, 10);
    expect(expected).toBeCloseTo(0.2198, 4); // 0.2209 / (1.0876 * 0.9242), worked by hand
    expect(scorePair(model, 'a.md', 'b.md').sharedTerms).toEqual(['copper']);
  });

  it('weights tags by rarity and counts a parent tag for nested tags', () => {
    const index = miniIndex({
      'a.md': '---\ntags: [cycles/debt, rare]\n---\nalpha',
      'b.md': '---\ntags: [cycles/tech, rare]\n---\nbeta',
      'c.md': '---\ntags: [cycles]\n---\ngamma',
      'd.md': '---\ntags: [cycles]\n---\ndelta',
    });
    const model = buildModel(index, WEIGHTS);
    const ab = scorePair(model, 'a.md', 'b.md');
    expect(ab.sharedTags).toEqual(['cycles', 'rare']);
    // weights ln(1 + 4/df): cycles (df 4) ln 2, rare (df 2) ln 3, cycles/debt and cycles/tech (df 1) ln 5
    const expected = (Math.log(2) + Math.log(3)) / (Math.log(2) + Math.log(3) + 2 * Math.log(5));
    expect(ab.tags).toBeCloseTo(expected, 10);
    expect(scorePair(model, 'c.md', 'd.md').tags).toBeCloseTo(1, 10);
    expect(scorePair(model, 'a.md', 'c.md').sharedTags).toEqual(['cycles']);
  });

  it('scores shared neighbours (cited together, or citing the same note) and shrinks thin evidence', () => {
    const index = miniIndex({
      'a.md': 'apple [[hub]] [[x]]',
      'b.md': 'banana [[hub]] [[x]]',
      'c.md': 'cherry [[hub]]',
      'hub.md': 'hub text',
      'x.md': 'x text',
      'citer.md': 'citing [[d]] and [[e]]',
      'd.md': 'date',
      'e.md': 'elder',
    });
    const model = buildModel(index, WEIGHTS);
    const ab = scorePair(model, 'a.md', 'b.md');
    expect(ab.commonNeighbours).toEqual(['hub.md', 'x.md']);
    expect(ab.neighbours).toBeCloseTo(2 / 3, 10); // identical neighbourhoods (Jaccard 1) times 2 / (2 + 1)
    const ac = scorePair(model, 'a.md', 'c.md');
    // hub has 3 neighbours, x has 2: weights 1/ln 4 and 1/ln 3. Jaccard = w(hub) / (w(hub) + w(x)), halved for one shared.
    const wHub = 1 / Math.log(4);
    const wX = 1 / Math.log(3);
    expect(ac.neighbours).toBeCloseTo((wHub / (wHub + wX)) * 0.5, 10);
    expect(scorePair(model, 'd.md', 'e.md')).toMatchObject({ commonNeighbours: ['citer.md'], neighbours: 0.5 }); // co-citation
    // One note citing both is not, alone, a reason to link two notes with no words or tags in common.
    expect(hasEvidence(scorePair(model, 'd.md', 'e.md'))).toBe(false);
  });
});

describe('ranking on the fixture vault', () => {
  const { index, model } = loadFixture();
  const P = (name: string) => index.notes.find((n) => n.basename === name)!.path;
  const top = (name: string, n: number, onlyUnlinked = false) =>
    related(model, P(name))
      .map((p) => (p.a === P(name) ? p.b : p.a))
      .filter((p) => !onlyUnlinked || !index.neighbours.get(P(name))!.has(p))
      .slice(0, n)
      .map((p) => index.byPath.get(p)!.basename);

  it('puts the expected notes first', () => {
    expect(top('Speculative manias', 2, true).sort()).toEqual(['Envy and the neighbour', 'Mimetic desire']);
    expect(top('Kredi genişlemesi', 1)).toEqual(['Borç döngüsü']);
    expect(top('Hype cycle', 1)).toEqual(['Technology surges']);
    expect(top('Capex cycle in mining', 1)).toEqual(['Commodity supercycle']);
    expect(top('Hedonic treadmill', 1)).toEqual(['The wanting-liking split']);
    expect(top('Deleveraging', 2)).toEqual(['Long debt cycle', 'Minsky moment']);
  });

  it('finds nothing for unrelated, empty and code-only notes', () => {
    const none = (a: string, b: string) => expect(hasEvidence(scorePair(model, P(a), P(b)))).toBe(false);
    none('Sourdough starter', 'Minsky moment');
    none('Bike maintenance', 'Mimetic desire');
    none('Işık ve gölge', 'Long debt cycle');
    expect(related(model, 'Notes/Empty.md')).toEqual([]);
    expect(related(model, 'Notes/Snippets/Regex cheatsheet.md')).toEqual([]);
  });

  it('keeps every component within 0..1 and lists pairs best first, deterministically', () => {
    const pairs = allPairs(model);
    expect(pairs.length).toBeGreaterThan(20);
    for (const p of pairs) {
      for (const v of [p.score, p.text, p.tags, p.neighbours]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(p.a < p.b).toBe(true);
      expect(p.score).toBeCloseTo(0.7 * p.text + 0.15 * p.tags + 0.15 * p.neighbours, 10);
    }
    expect(pairs.map((p) => p.score)).toEqual([...pairs.map((p) => p.score)].sort((x, y) => y - x));
    expect(allPairs(model)).toEqual(pairs);
    // allPairs finds its candidates through an inverted index; it must agree with the direct pairwise scan.
    const direct = new Set<string>();
    for (const a of index.notes) for (const b of index.notes) if (a.path < b.path && hasEvidence(scorePair(model, a.path, b.path))) direct.add(`${a.path}|${b.path}`);
    expect(new Set(pairs.map((p) => `${p.a}|${p.b}`))).toEqual(direct);
  });

  it('shows Turkish terms as written, not folded', () => {
    const pair = scorePair(model, P('Borç döngüsü'), P('Kredi genişlemesi'));
    expect(pair.sharedTerms).toContain('borç');
    expect(pair.sharedTags).toEqual(['türkçe']);
    expect(pair.text).toBeGreaterThan(0.3);
  });

  it('picks the passage that carries the overlap, and skips lines that are only links', () => {
    const mimetic = index.byPath.get(P('Mimetic desire'))!;
    const manias = index.byPath.get(P('Speculative manias'))!;
    const best = scorePassages(model, mimetic, model.vectors.get(manias.path)!)[0];
    expect(best.passage.headingPath).toEqual(['Mimetic desire', 'Rivalry']);
    expect(best.passage.blockId).toBe('rivalry-def');
    const all = scorePassages(model, mimetic, queryVector(model, 'lack positional goods'));
    expect(all.some((s) => s.passage.text.startsWith('Related:'))).toBe(false);
  });

  it('matches a query typed without Turkish letters', () => {
    const v = queryVector(model, 'borc dongusu');
    expect(v.size).toBeGreaterThan(0);
    expect([...v.keys()]).toEqual([...queryVector(model, 'Borç DÖNGÜSÜ').keys()]);
  });
});
