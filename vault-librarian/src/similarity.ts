// Similarity between notes without any outside service: TF-IDF cosine over the prose, plus shared tags
// and shared neighbours in the link graph. Pure functions over a VaultIndex.
import type { Config } from './config.js';
import type { Note, VaultIndex } from './indexer.js';
import { maskCode, maskLinks, passages, type Passage } from './parse.js';
import { fold, terms } from './text.js';

export type Vector = Map<string, number>;

export interface Model {
  index: VaultIndex;
  weights: { text: number; tags: number; neighbours: number };
  /** L2-normalised TF-IDF vector per note path. Title and aliases count three times. */
  vectors: Map<string, Vector>;
  /** Raw term counts of the body per note path (for search). */
  counts: Map<string, Map<string, number>>;
  idf: Map<string, number>;
  /** Most common spelling of each stem, for display. */
  surface: Map<string, string>;
  /** Tags of each note with parents added ('a/b' also gives 'a'). */
  tagSets: Map<string, Set<string>>;
  tagIdf: Map<string, number>;
  /** Folded tag -> the tag as written in the vault. */
  tagDisplay: Map<string, string>;
  /** Sum of the weights of each note's tags, and of each note's neighbours (precomputed for speed). */
  tagSum: Map<string, number>;
  neighbourSum: Map<string, number>;
  /** Weight of a note as somebody's neighbour: hubs count less. */
  nodeWeight: Map<string, number>;
  /** Notes with any text at all. */
  docCount: number;
}

/** The numbers of a pair, without the explanation. */
export interface PairNumbers {
  a: string;
  b: string;
  score: number;
  text: number;
  tags: number;
  neighbours: number;
}

/**
 * score: weighted mean of the three components, 0..1.
 * text: TF-IDF cosine, 0..1.
 * tags: IDF-weighted Jaccard of the tag sets, 0..1.
 * neighbours: degree-weighted Jaccard of the link neighbourhoods (co-citation and bibliographic
 * coupling), shrunk when few are shared, 0..1.
 */
export interface PairScore extends PairNumbers {
  sharedTerms: string[];
  sharedTags: string[];
  /** Paths of notes linked with both. */
  commonNeighbours: string[];
}

const TITLE_BOOST = 3;

function expandTags(tags: string[], display?: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    const parts = fold(tag).split('/');
    const written = tag.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const k = parts.slice(0, i).join('/');
      out.add(k);
      if (display && !display.has(k)) display.set(k, written.slice(0, i).join('/'));
    }
  }
  return out;
}

/** Robertson/Spärck Jones IDF as used in BM25: near zero for words in every note, never negative. */
function idfOf(df: number, n: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export function buildModel(index: VaultIndex, config: Pick<Config, 'similarity'>): Model {
  const counts = new Map<string, Map<string, number>>();
  const boosted = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  const surfaceCounts = new Map<string, Map<string, number>>();
  let docCount = 0;

  for (const note of index.notes) {
    const body = new Map<string, number>();
    for (const t of terms(note.plainText)) {
      body.set(t.stem, (body.get(t.stem) ?? 0) + 1);
      let forms = surfaceCounts.get(t.stem);
      if (!forms) surfaceCounts.set(t.stem, (forms = new Map()));
      forms.set(t.surface, (forms.get(t.surface) ?? 0) + 1);
    }
    counts.set(note.path, body);
    const all = new Map(body);
    if (body.size > 0) {
      // Title and aliases only add weight to notes that have prose; an empty note is not "about" its file name.
      for (const t of terms([note.title, ...note.aliases].join(' '))) {
        all.set(t.stem, (all.get(t.stem) ?? 0) + TITLE_BOOST);
        if (!surfaceCounts.has(t.stem)) surfaceCounts.set(t.stem, new Map([[t.surface, 1]]));
      }
      docCount++;
    }
    boosted.set(note.path, all);
    for (const stem of all.keys()) df.set(stem, (df.get(stem) ?? 0) + 1);
  }

  const idf = new Map<string, number>();
  for (const [stem, n] of df) idf.set(stem, idfOf(n, docCount));

  const vectors = new Map<string, Vector>();
  for (const [p, all] of boosted) {
    const v: Vector = new Map();
    let norm = 0;
    for (const [stem, c] of all) {
      const w = (1 + Math.log(c)) * (idf.get(stem) ?? 0);
      if (w > 0) {
        v.set(stem, w);
        norm += w * w;
      }
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [stem, w] of v) v.set(stem, w / norm);
    vectors.set(p, v);
  }

  const surface = new Map<string, string>();
  for (const [stem, forms] of surfaceCounts) {
    const bestForm = [...forms.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    surface.set(stem, bestForm);
  }

  const tagSets = new Map<string, Set<string>>();
  const tagDf = new Map<string, number>();
  const tagDisplay = new Map<string, string>();
  for (const note of index.notes) {
    const set = expandTags(note.tags, tagDisplay);
    tagSets.set(note.path, set);
    for (const t of set) tagDf.set(t, (tagDf.get(t) ?? 0) + 1);
  }
  const tagIdf = new Map<string, number>();
  for (const [t, n] of tagDf) tagIdf.set(t, Math.log(1 + index.notes.length / n));

  const tagSum = new Map<string, number>();
  for (const [p, set] of tagSets) {
    let sum = 0;
    for (const t of set) sum += tagIdf.get(t) ?? 0;
    tagSum.set(p, sum);
  }
  // A hub (an index note, a daily note that links to everything) says less than a note with three links.
  const nodeWeight = new Map<string, number>();
  for (const [p, around] of index.neighbours) nodeWeight.set(p, 1 / Math.log(1 + Math.max(1, around.size)));
  const neighbourSum = new Map<string, number>();
  for (const [p, around] of index.neighbours) {
    let sum = 0;
    for (const z of around) sum += nodeWeight.get(z) ?? 0;
    neighbourSum.set(p, sum);
  }

  const s = config.similarity;
  const total = s.textWeight + s.tagWeight + s.neighbourWeight || 1;
  return {
    index,
    weights: { text: s.textWeight / total, tags: s.tagWeight / total, neighbours: s.neighbourWeight / total },
    vectors,
    counts,
    idf,
    surface,
    tagSets,
    tagIdf,
    tagDisplay,
    tagSum,
    neighbourSum,
    nodeWeight,
    docCount,
  };
}

export function dot(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [k, w] of small) {
    const o = large.get(k);
    if (o !== undefined) sum += w * o;
  }
  return sum;
}

const NO_TAGS: ReadonlySet<string> = new Set();

/** The three components and the combined score. `text` may be passed in when the cosine is already known. */
export function pairNumbers(model: Model, pathA: string, pathB: string, knownText?: number): PairNumbers {
  const [a, b] = pathA < pathB ? [pathA, pathB] : [pathB, pathA];
  const text = Math.min(1, knownText ?? dot(model.vectors.get(a) ?? new Map(), model.vectors.get(b) ?? new Map()));

  // Weighted Jaccard = shared / (sumA + sumB - shared), walking only the smaller set.
  let ta = model.tagSets.get(a) ?? NO_TAGS;
  let tb = model.tagSets.get(b) ?? NO_TAGS;
  if (ta.size > tb.size) [ta, tb] = [tb, ta];
  let tagShared = 0;
  for (const t of ta) if (tb.has(t)) tagShared += model.tagIdf.get(t) ?? 0;
  const tagUnion = (model.tagSum.get(a) ?? 0) + (model.tagSum.get(b) ?? 0) - tagShared;
  const tags = tagShared > 0 && tagUnion > 0 ? Math.min(1, tagShared / tagUnion) : 0;

  const na = model.index.neighbours.get(a) ?? NO_TAGS;
  const nb = model.index.neighbours.get(b) ?? NO_TAGS;
  const [small, large] = na.size <= nb.size ? [na, nb] : [nb, na];
  let nShared = 0;
  let common = 0;
  for (const z of small) {
    if (z !== a && z !== b && large.has(z)) {
      nShared += model.nodeWeight.get(z) ?? 0;
      common++;
    }
  }
  let neighbours = 0;
  if (common > 0) {
    // The two notes themselves are left out of each other's neighbourhood.
    const sumA = (model.neighbourSum.get(a) ?? 0) - (na.has(b) ? (model.nodeWeight.get(b) ?? 0) : 0);
    const sumB = (model.neighbourSum.get(b) ?? 0) - (nb.has(a) ? (model.nodeWeight.get(a) ?? 0) : 0);
    // One common neighbour is thin evidence however small the two neighbourhoods are: shrink by n / (n + 1).
    neighbours = Math.min(1, nShared / (sumA + sumB - nShared)) * (common / (common + 1));
  }
  const w = model.weights;
  return { a, b, score: w.text * text + w.tags * tags + w.neighbours * neighbours, text, tags, neighbours };
}

/** A pair's numbers together with the reasons: shared terms, shared tags, common neighbours. */
export function scorePair(model: Model, pathA: string, pathB: string): PairScore {
  const numbers = pairNumbers(model, pathA, pathB);
  const { a, b } = numbers;
  const va = model.vectors.get(a) ?? new Map<string, number>();
  const vb = model.vectors.get(b) ?? new Map<string, number>();
  const shared: [string, number][] = [];
  for (const [k, w] of va) {
    const o = vb.get(k);
    if (o !== undefined) shared.push([k, w * o]);
  }
  shared.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));

  const ta = model.tagSets.get(a) ?? NO_TAGS;
  const tb = model.tagSets.get(b) ?? NO_TAGS;
  const sharedTagList = [...ta].filter((t) => tb.has(t));
  const na = model.index.neighbours.get(a) ?? NO_TAGS;
  const nb = model.index.neighbours.get(b) ?? NO_TAGS;
  return {
    ...numbers,
    sharedTerms: shared.slice(0, 6).map(([k]) => model.surface.get(k) ?? k),
    // Only the most specific shared tags: 'cycles/debt' already says 'cycles'.
    sharedTags: sharedTagList
      .filter((t) => !sharedTagList.some((o) => o.startsWith(`${t}/`)))
      .sort()
      .map((t) => model.tagDisplay.get(t) ?? t),
    commonNeighbours: [...na].filter((z) => z !== a && z !== b && nb.has(z)).sort(),
  };
}

/** Text overlap below this counts as none when deciding whether a pair is worth showing. */
export const TEXT_FLOOR = 0.06;
const STRUCTURE_FLOOR = 0.3;

/**
 * A pair needs real text overlap, or strong agreement of both tags and graph (which is how notes in
 * different languages can still meet). Shared tags alone, or one shared index note, never qualify.
 */
export function hasEvidence(p: PairNumbers): boolean {
  return p.text >= TEXT_FLOOR || (p.tags >= STRUCTURE_FLOOR && p.neighbours >= STRUCTURE_FLOOR);
}

const HUB_DEGREE = 60;

/**
 * Every pair of notes with some evidence of a connection, scored, best first. Pairs are found through
 * an inverted index (shared words) and through shared neighbours, so the cost follows the number of
 * related pairs rather than the square of the vault.
 */
export function allPairs(model: Model, eligible: (note: Note) => boolean = () => true, minScore = 0): PairNumbers[] {
  const paths = model.index.notes.filter(eligible).map((n) => n.path);
  const position = new Map(paths.map((p, i) => [p, i]));
  const vectors = paths.map((p) => model.vectors.get(p) ?? new Map<string, number>());
  const postings = new Map<string, number[]>();
  // In a large vault, words found in more than half the notes are skipped while collecting candidates
  // (their IDF is near zero); the cosine of each candidate is then computed in full.
  const commonCap = paths.length > 200 ? paths.length * 0.5 : Infinity;
  vectors.forEach((v, i) => {
    for (const stem of v.keys()) {
      const list = postings.get(stem);
      if (list) list.push(i);
      else postings.set(stem, [i]);
    }
  });

  const out: PairNumbers[] = [];
  const seen = new Set<number>();
  const n = paths.length;
  const consider = (i: number, j: number, text?: number) => {
    const pair = pairNumbers(model, paths[i], paths[j], text);
    if (pair.score >= minScore && hasEvidence(pair)) out.push(pair);
  };
  // Postings carry the weights, and the running sums live in one typed array, to keep the inner loop tight.
  const weightsOf = new Map<string, Float64Array>();
  for (const [stem, list] of postings) weightsOf.set(stem, Float64Array.from(list, (j) => vectors[j].get(stem)!));
  const acc = new Float64Array(n);
  const touched: number[] = [];
  let capped = false;
  vectors.forEach((v, i) => {
    for (const [stem, w] of v) {
      const list = postings.get(stem)!;
      if (list.length > commonCap) {
        capped = true;
        continue;
      }
      const ws = weightsOf.get(stem)!;
      for (let k = list.length - 1; k >= 0; k--) {
        const j = list[k];
        if (j <= i) break; // postings are in ascending order
        if (acc[j] === 0) touched.push(j);
        acc[j] += w * ws[k];
      }
    }
    touched.sort((x, y) => x - y);
    for (const j of touched) {
      const sum = acc[j];
      acc[j] = 0;
      if (sum < TEXT_FLOOR * 0.5) continue;
      seen.add(i * n + j);
      consider(i, j, capped ? undefined : sum);
    }
    touched.length = 0;
  });
  // Pairs with no words in common can still qualify through tags and shared neighbours together.
  for (const note of model.index.notes) {
    const around = [...(model.index.neighbours.get(note.path) ?? [])]
      .map((p) => position.get(p))
      .filter((i): i is number => i !== undefined)
      .sort((x, y) => x - y);
    if (around.length > HUB_DEGREE) continue;
    for (let x = 0; x < around.length; x++) {
      for (let y = x + 1; y < around.length; y++) {
        const k = around[x] * n + around[y];
        if (seen.has(k)) continue;
        seen.add(k);
        consider(around[x], around[y]);
      }
    }
  }
  return out.sort(byScore);
}

export function byScore(x: PairNumbers, y: PairNumbers): number {
  return y.score - x.score || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1);
}

/** Notes most related to one note, best first. */
export function related(model: Model, notePath: string, eligible: (note: Note) => boolean = () => true): PairScore[] {
  const out: PairScore[] = [];
  for (const other of model.index.notes) {
    if (other.path === notePath || !eligible(other)) continue;
    const numbers = pairNumbers(model, notePath, other.path);
    if (hasEvidence(numbers) && numbers.score > 0) out.push(scorePair(model, notePath, other.path));
  }
  return out.sort(byScore);
}

/** A normalised vector for free text (a query, a topic's key terms). Words the vault never uses are dropped. */
export function queryVector(model: Model, text: string): Vector {
  const v: Vector = new Map();
  let norm = 0;
  for (const t of terms(text)) {
    const idf = model.idf.get(t.stem);
    if (idf === undefined || idf <= 0 || v.has(t.stem)) continue;
    v.set(t.stem, idf);
    norm += idf * idf;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (const [k, w] of v) v.set(k, w / norm);
  return v;
}

export interface ScoredPassage {
  passage: Passage;
  score: number;
  /** Stems of the target that the passage contains. */
  matched: string[];
}

const MIN_PASSAGE_TERMS = 5;

/**
 * Scores each quotable block of a note against a target vector (another note, or a query): TF-IDF
 * cosine between the block and the target. Blocks with fewer than five content words are skipped.
 */
export function scorePassages(model: Model, note: Note, target: Vector): ScoredPassage[] {
  const scored: ScoredPassage[] = [];
  for (const passage of passages(note.body, note.bodyStartLine)) {
    const counts = new Map<string, number>();
    let total = 0;
    // Link targets are left out: a line of links ("See [[A]], [[B]]") is a pointer, not a passage worth quoting.
    for (const t of terms(maskLinks(maskCode(passage.text)))) {
      counts.set(t.stem, (counts.get(t.stem) ?? 0) + 1);
      total++;
    }
    let sum = 0;
    let norm = 0;
    const matched: string[] = [];
    for (const [stem, c] of counts) {
      const w = (1 + Math.log(c)) * (model.idf.get(stem) ?? 0);
      norm += w * w;
      const tw = target.get(stem);
      if (tw !== undefined && w > 0) {
        sum += w * tw;
        matched.push(stem);
      }
    }
    if (sum <= 0 || norm <= 0) continue;
    if (total < MIN_PASSAGE_TERMS) continue;
    scored.push({ passage, score: sum / Math.sqrt(norm), matched });
  }
  return scored.sort((x, y) => y.score - x.score || x.passage.startLine - y.passage.startLine);
}

/** Content words of a note outside its links: near zero for an index note that is only a list of links. */
export function proseTerms(note: Note): number {
  return terms(maskLinks(maskCode(note.body)).replace(/^ {0,3}#{1,6}[ \t].*$/gm, ' ')).length;
}

/** The first block of prose with some substance: what to quote from a note when nothing matches better. */
export function leadPassage(note: Note): Passage | null {
  const all = passages(note.body, note.bodyStartLine);
  const size = (p: Passage) => terms(maskLinks(maskCode(p.text))).length;
  return all.find((p) => p.kind === 'paragraph' && size(p) >= MIN_PASSAGE_TERMS) ?? all.find((p) => size(p) >= MIN_PASSAGE_TERMS) ?? all[0] ?? null;
}
