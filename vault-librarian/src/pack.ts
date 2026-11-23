// Source packs: everything the vault holds on a topic, selected by tag, graph distance from seed notes
// and text score, grouped by sub-theme, with verbatim excerpts. The librarian assembles and cites; it
// writes no prose of its own beyond labels.
import type { Config, SubTheme, Topic } from './config.js';
import { findNote, wikilink, type Note, type VaultIndex } from './indexer.js';
import { maskCode, maskLinks, passages, type Passage, type Task } from './parse.js';
import { blockquote, excerpt } from './quote.js';
import { dot, leadPassage, proseTerms, queryVector, scorePassages, type Model } from './similarity.js';
import type { PackRecord, State } from './state.js';
import { fold, stems, terms } from './text.js';

export interface ResolvedTopic {
  /** Preset name, or 'adhoc:<query>' for a free query. Keys the pack history. */
  key: string;
  title: string;
  description: string | null;
  adhoc: boolean;
  seedTags: string[];
  seedNotes: Note[];
  /** Seed notes named in the config that the vault does not have (or that are ambiguous). */
  missingSeeds: string[];
  keyTerms: string[];
  subThemes: SubTheme[];
}

export interface PackExcerpt {
  passage: Passage;
  /** The passage as written, cut with ' […]' when longer than the limit. */
  text: string;
  /** True when nothing in the note matched the key terms and the opening passage is shown instead. */
  lead: boolean;
}

export interface PackSource {
  note: Note;
  relevance: number;
  tag: number;
  graph: number;
  text: number;
  reasons: string[];
  excerpts: PackExcerpt[];
  /** True for a note that is only a list of links (an index, a map of content): cited, not quoted. */
  map: boolean;
}

export interface PackGroup {
  name: string;
  why: string;
  sources: PackSource[];
}

export interface Pack {
  topic: ResolvedTopic;
  date: string;
  sources: PackSource[];
  /** Notes above the relevance threshold, before the maxSources cut. */
  matched: number;
  groups: PackGroup[];
  open: {
    unresolved: { target: string; sources: Note[] }[];
    questionNotes: Note[];
    tasks: { note: Note; task: Task }[];
    questions: { note: Note; text: string }[];
  };
  news: {
    previousDate: string | null;
    added: Note[];
    changed: { note: Note; was: string }[];
    dropped: string[];
  };
}

const WEIGHTS = { tag: 0.4, graph: 0.3, text: 0.3 };
const GRAPH_SCORE = [1, 0.6, 0.25];
const HUB_DEGREE = 40;
/** Fewer content words than this outside links and headings makes a note a map of links. */
const MAP_NOTE_TERMS = 12;

export class TopicError extends Error {}

export function resolveTopic(index: VaultIndex, config: Config, ref: string): ResolvedTopic {
  const name = ref.trim();
  if (!name) throw new TopicError('Topic is empty. Use a preset name (see vault_list_topics) or a free query.');
  const preset: Topic | undefined = config.topics[name.toLowerCase()];
  if (preset) {
    const seedNotes: Note[] = [];
    const missingSeeds: string[] = [];
    for (const seed of preset.seedNotes) {
      const found = findNote(index, seed).note;
      if (found) {
        if (!seedNotes.includes(found)) seedNotes.push(found);
      } else missingSeeds.push(seed);
    }
    return {
      key: preset.name,
      title: preset.title,
      description: preset.description ?? null,
      adhoc: false,
      seedTags: preset.seedTags.map((t) => t.replace(/^#/, '')),
      seedNotes,
      missingSeeds,
      keyTerms: preset.keyTerms,
      subThemes: preset.subThemes,
    };
  }
  const tags = [...name.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]);
  const words = name.replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, ' ').trim();
  return {
    key: `adhoc:${fold(name).replace(/\s+/g, ' ')}`,
    title: name,
    description: null,
    adhoc: true,
    seedTags: tags,
    seedNotes: [],
    missingSeeds: [],
    keyTerms: words ? [words] : [],
    subThemes: [],
  };
}

function tagMatches(tagSet: Set<string>, wanted: string[]): string[] {
  return wanted.filter((t) => tagSet.has(fold(t.replace(/^#/, ''))));
}

/** Breadth-first distances from the seed notes, up to two links away. Hubs and daily notes are not walked through. */
function seedDistances(index: VaultIndex, seeds: Note[]): Map<string, { d: number; seed: string; via: string | null }> {
  const dist = new Map<string, { d: number; seed: string; via: string | null }>();
  let frontier: string[] = [];
  for (const s of seeds) {
    dist.set(s.path, { d: 0, seed: s.path, via: null });
    frontier.push(s.path);
  }
  for (let d = 1; d <= 2; d++) {
    const next: string[] = [];
    for (const p of frontier) {
      const from = dist.get(p)!;
      const note = index.byPath.get(p)!;
      const around = index.neighbours.get(p) ?? new Set<string>();
      if (from.d > 0 && (note.isDaily || around.size > HUB_DEGREE)) continue;
      for (const q of [...around].sort()) {
        if (dist.has(q)) continue;
        dist.set(q, { d, seed: from.seed, via: from.d === 0 ? null : p });
        next.push(q);
      }
    }
    frontier = next;
  }
  return dist;
}

export interface PackOptions {
  today: string;
  maxSources?: number;
  excerptsPerSource?: number;
}

export function buildPack(index: VaultIndex, model: Model, config: Config, state: State, topicRef: string, options: PackOptions): Pack {
  const topic = resolveTopic(index, config, topicRef);
  const maxSources = options.maxSources ?? config.packs.maxSources;
  const perSource = options.excerptsPerSource ?? config.packs.excerptsPerSource;
  const link = (n: Note) => wikilink(index, n);

  const qv = queryVector(model, topic.keyTerms.join(' '));
  const dist = seedDistances(index, topic.seedNotes);
  const use = {
    tag: topic.seedTags.length ? WEIGHTS.tag : 0,
    graph: topic.seedNotes.length ? WEIGHTS.graph : 0,
    text: qv.size ? WEIGHTS.text : 0,
  };
  const totalWeight = use.tag + use.graph + use.text;
  if (totalWeight === 0) {
    throw new TopicError(
      topic.adhoc
        ? `Nothing in the vault matches "${topic.title}": none of its words occur in any note. Try other words, or a #tag.`
        : `Topic "${topic.key}" has no seed tags, no seed notes found in the vault, and no key terms that occur in any note. Edit it in vault-librarian.config.json.`,
    );
  }

  const textRaw = new Map<string, number>();
  let textMax = 0;
  if (qv.size) {
    for (const note of index.notes) {
      const s = dot(qv, model.vectors.get(note.path) ?? new Map());
      textRaw.set(note.path, s);
      if (s > textMax) textMax = s;
    }
  }

  const candidates: PackSource[] = [];
  for (const note of index.notes) {
    if (note.wordCount === 0) continue;
    const tagHits = tagMatches(model.tagSets.get(note.path) ?? new Set(), topic.seedTags);
    const tag = tagHits.length ? 1 : 0;
    const g = dist.get(note.path);
    const graph = g ? GRAPH_SCORE[g.d] : 0;
    const text = textMax > 0 ? (textRaw.get(note.path) ?? 0) / textMax : 0;
    const relevance = (use.tag * tag + use.graph * graph + use.text * text) / totalWeight;
    if (relevance < config.packs.minRelevance) continue;

    const reasons: string[] = [];
    if (g?.d === 0) reasons.push('seed note');
    if (tagHits.length) {
      // Name the note's own most specific tag under the seed tag, e.g. #desire/mimetic for seed #desire.
      const own = note.tags.filter((t) => tagHits.some((h) => fold(t) === fold(h) || fold(t).startsWith(`${fold(h)}/`)));
      reasons.push(`tagged ${(own.length ? own : tagHits).map((t) => `#${t}`).join(' ')}`);
    }
    if (g?.d === 1) reasons.push(`linked with seed ${link(index.byPath.get(g.seed)!)}`);
    if (g?.d === 2 && g.via) reasons.push(`two links from seed ${link(index.byPath.get(g.seed)!)} by way of ${link(index.byPath.get(g.via)!)}`);
    const v = model.vectors.get(note.path) ?? new Map<string, number>();
    const matchedTerms = [...qv.keys()]
      .filter((k) => v.has(k))
      .sort((x, y) => v.get(y)! * qv.get(y)! - v.get(x)! * qv.get(x)! || (x < y ? -1 : 1))
      .slice(0, 6)
      .map((k) => model.surface.get(k) ?? k);
    if (matchedTerms.length) reasons.push(`uses ${matchedTerms.join(', ')}`);
    candidates.push({ note, relevance, tag, graph, text, reasons, excerpts: [], map: false });
  }
  candidates.sort((x, y) => y.relevance - x.relevance || (x.note.path < y.note.path ? -1 : 1));
  const sources = candidates.slice(0, maxSources);

  // Notes the topic is built on: a passage that links to one of them is on topic even without a key term.
  const core = new Set<string>(topic.seedNotes.map((n) => n.path));
  for (const c of candidates) if (c.tag) core.add(c.note.path);
  const queryStems = new Set(qv.keys());

  for (const source of sources) {
    if (proseTerms(source.note) < MAP_NOTE_TERMS) {
      source.map = true; // an index of links: listed, not quoted
      continue;
    }
    const byLine = new Map<number, { passage: Passage; score: number }>();
    for (const s of qv.size ? scorePassages(model, source.note, qv) : []) byLine.set(s.passage.startLine, s);
    if (byLine.size === 0) {
      // No key term anywhere in the note. Next best: a passage under a heading that names the topic, or
      // one that links to a note the topic is built on. Better than quoting an unrelated opening paragraph.
      const linksOut = (index.outgoing.get(source.note.path) ?? []).filter((l) => l.to && l.to !== source.note.path && core.has(l.to));
      for (const p of passages(source.note.body, source.note.bodyStartLine)) {
        if (terms(maskLinks(maskCode(p.text))).length < 3) continue;
        const underTopicHeading = p.headingPath.slice(1).some((h) => stems(h).some((st) => queryStems.has(st)));
        const linksToCore = linksOut.some((l) => l.raw.line >= p.startLine && l.raw.line <= p.endLine);
        if (underTopicHeading || linksToCore) byLine.set(p.startLine, { passage: p, score: underTopicHeading && linksToCore ? 2 : 1 });
      }
    }
    const ranked = [...byLine.values()].sort((x, y) => y.score - x.score || x.passage.startLine - y.passage.startLine);
    const floor = ranked.length ? ranked[0].score * 0.25 : 0;
    const chosen = ranked.filter((s) => s.score >= floor).slice(0, perSource).map((s) => s.passage);
    let lead = false;
    if (!chosen.length) {
      const first = leadPassage(source.note);
      if (first) chosen.push(first);
      lead = true;
    }
    // Reading order, and neighbouring blocks (list items, usually) joined back into one quote.
    chosen.sort((x, y) => x.startLine - y.startLine);
    const merged: Passage[] = [];
    for (const p of chosen) {
      const last = merged[merged.length - 1];
      if (last && p.startLine === last.endLine + 1 && p.kind === 'list' && last.kind === 'list') {
        merged[merged.length - 1] = { ...last, text: `${last.text}\n${p.text}`, endLine: p.endLine, blockId: p.blockId };
      } else merged.push(p);
    }
    source.excerpts = merged.map((p) => ({ passage: p, text: excerpt(p.text, config.packs.maxExcerptChars), lead }));
  }

  const groups = groupSources(model, topic, sources, config);

  // --- open questions ---
  const sourcePaths = new Set(sources.map((s) => s.note.path));
  const questionTags = config.questionTags.map((t) => fold(t.replace(/^#/, '')));
  const unresolved = index.unresolved
    .filter((u) => !u.attachment && u.sources.some((p) => sourcePaths.has(p)))
    .map((u) => ({ target: u.target, sources: u.sources.filter((p) => sourcePaths.has(p)).map((p) => index.byPath.get(p)!) }));
  const questionNotes = candidates
    .filter((c) => questionTags.some((t) => model.tagSets.get(c.note.path)?.has(t)))
    .map((c) => c.note);
  const tasks: Pack['open']['tasks'] = [];
  const questions: Pack['open']['questions'] = [];
  for (const s of sources) {
    for (const task of s.note.tasks) if (tasks.length < 20) tasks.push({ note: s.note, task });
    for (const p of passages(s.note.body, s.note.bodyStartLine)) {
      if (p.kind === 'table') continue;
      for (const m of p.text.matchAll(/[^.!?\n]*[^\s.!?\n]\?/g)) {
        const text = m[0].replace(/^[\s>*+-]+(\[.\]\s*)?/, '');
        if (text.length >= 20 && questions.length < 15 && p.text.includes(text) && !/^\s*[-*+][ \t]+\[ \]/.test(p.text)) questions.push({ note: s.note, text });
      }
    }
  }

  // --- what is new since the last pack ---
  const history = (state.packs[topic.key] ?? []).filter((r) => r.date < options.today);
  const previous: PackRecord | undefined = history[history.length - 1];
  const news: Pack['news'] = { previousDate: previous?.date ?? null, added: [], changed: [], dropped: [] };
  if (previous) {
    for (const s of sources) {
      const was = previous.sources[s.note.path];
      if (was === undefined) news.added.push(s.note);
      else if (s.note.modified > was) news.changed.push({ note: s.note, was });
    }
    news.dropped = Object.keys(previous.sources).filter((p) => !sourcePaths.has(p)).sort();
  }

  return { topic, date: options.today, sources, matched: candidates.length, groups, open: { unresolved, questionNotes, tasks, questions }, news };
}

function groupSources(model: Model, topic: ResolvedTopic, sources: PackSource[], config: Config): PackGroup[] {
  const groups: PackGroup[] = [];
  let rest = [...sources];

  const maps = rest.filter((s) => s.map);
  rest = rest.filter((s) => !s.map);

  // 1. Sub-themes the topic defines. A tag counts 2, a term 1 (1.5 when used three times or more).
  // A note joins a sub-theme only when it clearly belongs to one; outlines that touch all of them do not.
  if (topic.subThemes.length) {
    const buckets = topic.subThemes.map(() => [] as PackSource[]);
    const across: PackSource[] = [];
    for (const s of rest) {
      const tagSet = model.tagSets.get(s.note.path) ?? new Set<string>();
      const counts = model.counts.get(s.note.path) ?? new Map<string, number>();
      const scores = topic.subThemes.map((theme) => {
        let score = 2 * tagMatches(tagSet, theme.tags).length;
        for (const stem of new Set(stems(theme.terms.join(' ')))) {
          const c = counts.get(stem) ?? 0;
          if (c > 0) score += c >= 3 ? 1.5 : 1;
        }
        return score;
      });
      const bestScore = Math.max(...scores);
      const bestIdx = scores.indexOf(bestScore);
      const second = Math.max(0, ...scores.filter((_, i) => i !== bestIdx));
      if (bestScore >= 2 && bestScore >= second + 1) buckets[bestIdx].push(s);
      else across.push(s);
    }
    topic.subThemes.forEach((theme, i) => {
      if (!buckets[i].length) return;
      const parts = [theme.tags.length ? `tags ${theme.tags.map((t) => `#${t}`).join(' ')}` : '', theme.terms.length ? `terms ${theme.terms.join(', ')}` : ''].filter(Boolean);
      groups.push({ name: theme.name, why: `Sub-theme defined in the topic (${parts.join('; ')}).`, sources: buckets[i] });
    });
    if (across.length) groups.push({ name: 'Across sub-themes', why: 'These notes do not sit clearly in one sub-theme: they touch several, or none strongly.', sources: across });
    rest = [];
  }

  // 2. Shared tags, largest group first. Seed tags and question tags say nothing about sub-theme.
  const skip = new Set([...topic.seedTags, ...config.questionTags].map((t) => fold(t.replace(/^#/, ''))));
  for (const t of [...skip]) {
    const parts = t.split('/');
    for (let i = 1; i < parts.length; i++) skip.add(parts.slice(0, i).join('/'));
  }
  const everyone = rest.length;
  for (let round = 0; round < 6 && rest.length >= 2; round++) {
    const cover = new Map<string, PackSource[]>();
    for (const s of rest) {
      for (const tag of model.tagSets.get(s.note.path) ?? []) {
        if (skip.has(tag)) continue;
        const list = cover.get(tag);
        if (list) list.push(s);
        else cover.set(tag, [s]);
      }
    }
    const ranked = [...cover.entries()]
      // A tag on every source is not a sub-theme.
      .filter(([, list]) => list.length >= 2 && !(list.length === everyone && everyone > 3))
      .sort((x, y) => y[1].length - x[1].length || y[0].split('/').length - x[0].split('/').length || (x[0] < y[0] ? -1 : 1));
    if (!ranked.length) break;
    const [tag, members] = ranked[0];
    const shown = model.tagDisplay.get(tag) ?? tag;
    groups.push({ name: `#${shown}`, why: `Grouped by the shared tag #${shown}.`, sources: members });
    rest = rest.filter((s) => !members.includes(s));
  }

  // 3. Shared distinctive terms among what is left.
  const queryStems = new Set(stems(topic.keyTerms.join(' ')));
  for (let round = 0; round < 4 && rest.length >= 2; round++) {
    const cover = new Map<string, { members: PackSource[]; weight: number }>();
    for (const s of rest) {
      const top = [...(model.vectors.get(s.note.path) ?? new Map<string, number>()).entries()]
        .filter(([stem]) => !queryStems.has(stem))
        .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
        .slice(0, 10);
      for (const [stem, wgt] of top) {
        const entry = cover.get(stem) ?? { members: [], weight: 0 };
        entry.members.push(s);
        entry.weight += wgt;
        cover.set(stem, entry);
      }
    }
    const ranked = [...cover.entries()]
      .filter(([, e]) => e.members.length >= 2)
      .sort((x, y) => y[1].members.length - x[1].members.length || y[1].weight - x[1].weight || (x[0] < y[0] ? -1 : 1));
    if (!ranked.length) break;
    const [stem, entry] = ranked[0];
    const word = model.surface.get(stem) ?? stem;
    groups.push({ name: `"${word}"`, why: `Grouped by a term these notes lean on: ${word}.`, sources: entry.members });
    rest = rest.filter((s) => !entry.members.includes(s));
  }

  if (rest.length) {
    groups.push({ name: groups.length ? 'Other' : 'Sources', why: groups.length ? 'No tag or distinctive term shared with another source.' : '', sources: rest });
  }
  if (maps.length) {
    groups.push({ name: 'Maps and indexes', why: 'Notes that are lists of links rather than prose. They are cited as a way in, not quoted.', sources: maps });
  }
  return groups;
}

export function recordPack(state: State, pack: Pack): void {
  const record: PackRecord = { date: pack.date, sources: Object.fromEntries(pack.sources.map((s) => [s.note.path, s.note.modified])) };
  const history = (state.packs[pack.topic.key] ?? []).filter((r) => r.date !== pack.date);
  history.push(record);
  history.sort((a, b) => (a.date < b.date ? -1 : 1));
  state.packs[pack.topic.key] = history.slice(-12);
}

export interface RenderPackOptions {
  /** Render only sources [offset, offset + limit) in ranked order; the outline always lists all of them. */
  sourceOffset?: number;
  sourceLimit?: number;
}

export function renderPack(pack: Pack, index: VaultIndex, options: RenderPackOptions = {}): string {
  const link = (n: Note) => wikilink(index, n);
  const offset = options.sourceOffset ?? 0;
  const limit = options.sourceLimit ?? pack.sources.length;
  const shown = new Set(pack.sources.slice(offset, offset + limit).map((s) => s.note.path));
  const partial = shown.size < pack.sources.length;
  const t = pack.topic;
  const L: string[] = [];
  const excerptCount = pack.sources.reduce((n, s) => n + s.excerpts.length, 0);

  L.push('---', 'librarian: source-pack', `topic: ${JSON.stringify(t.adhoc ? t.title : t.key)}`, `generated: ${pack.date}`, `sources: ${pack.sources.length}`, '---', '');
  L.push(`# Source pack: ${t.title} (${pack.date})`, '');
  if (t.description) L.push(t.description, '');
  const definition: string[] = [];
  if (t.seedTags.length) definition.push(`tags ${t.seedTags.map((x) => `#${x}`).join(' ')}`);
  if (t.seedNotes.length) definition.push(`seed notes ${t.seedNotes.map(link).join(', ')}`);
  if (t.keyTerms.length) definition.push(`${t.adhoc ? 'query' : 'key terms'}: ${t.keyTerms.join(', ')}`);
  L.push(`Selected by ${definition.join('; ')}.`, '');
  if (t.missingSeeds.length) L.push(`Seed notes not found in the vault: ${t.missingSeeds.map((s) => `"${s}"`).join(', ')}.`, '');
  L.push(
    `${pack.sources.length} sources, ${excerptCount} excerpts.` +
      (pack.matched > pack.sources.length ? ` ${pack.matched} notes matched; the ${pack.sources.length} most relevant are included.` : '') +
      ' Excerpts are copied from the notes word for word; " […]" marks where a long passage was cut. Nothing here is paraphrased.',
    '',
  );

  L.push('## Outline', '');
  for (const g of pack.groups) L.push(`- **${g.name}** (${g.sources.length}): ${g.sources.map((s) => link(s.note)).join(', ')}`);
  L.push('');

  if (offset === 0) {
    L.push('## New since the last pack', '');
    if (!pack.news.previousDate) L.push('This is the first saved pack for this topic, so there is nothing to compare with.', '');
    else if (!pack.news.added.length && !pack.news.changed.length && !pack.news.dropped.length) {
      L.push(`Nothing has changed since the pack of ${pack.news.previousDate}.`, '');
    } else {
      L.push(`Compared with the pack of ${pack.news.previousDate}:`, '');
      for (const n of pack.news.added) L.push(`- New: ${link(n)} (created ${n.created}, modified ${n.modified})`);
      for (const c of pack.news.changed) L.push(`- Changed: ${link(c.note)} (modified ${c.note.modified}; was ${c.was})`);
      for (const p of pack.news.dropped) L.push(`- No longer included: ${index.byPath.has(p) ? link(index.byPath.get(p)!) : `${p} (gone from the vault)`}`);
      L.push('');
    }
  }

  L.push('## Sources', '');
  if (partial) L.push(`Showing sources ${offset + 1} to ${offset + shown.size} of ${pack.sources.length}, most relevant first.`, '');
  for (const g of pack.groups) {
    const members = g.sources.filter((s) => shown.has(s.note.path));
    if (!members.length) continue;
    L.push(`### ${g.name}`, '');
    if (g.why) L.push(g.why, '');
    for (const s of members) {
      const n = s.note;
      L.push(`#### ${link(n)}`, '');
      const meta = [`created ${n.created}`, `modified ${n.modified}`, `${n.wordCount} words`];
      if (n.tags.length) meta.push(n.tags.map((x) => `#${x}`).join(' '));
      L.push(meta.join(' · '), '');
      L.push(`Why included: ${s.reasons.join('; ')}. Relevance ${s.relevance.toFixed(2)}.`, '');
      for (const e of s.excerpts) {
        const heading = e.passage.headingPath[e.passage.headingPath.length - 1] ?? null;
        const where = e.passage.startLine === e.passage.endLine ? `line ${e.passage.startLine}` : `lines ${e.passage.startLine} to ${e.passage.endLine}`;
        L.push(`${wikilink(index, n, heading)}, ${where}${e.lead ? ' (opening passage; no key term matched)' : ''}:`, '', blockquote(e.text), '');
      }
    }
  }

  if (offset === 0) {
    L.push('## Open questions', '');
    const o = pack.open;
    if (!o.unresolved.length && !o.questionNotes.length && !o.tasks.length && !o.questions.length) {
      L.push('None found: no missing notes, question-tagged notes, open tasks or question sentences in these sources.', '');
    }
    if (o.unresolved.length) {
      L.push('### Notes waiting to be written', '');
      for (const u of o.unresolved) L.push(`- [[${u.target}]], linked from ${u.sources.map(link).join(', ')}`);
      L.push('');
    }
    if (o.questionNotes.length) {
      L.push('### Notes tagged as questions', '');
      for (const n of o.questionNotes) L.push(`- ${link(n)} (${n.tags.map((x) => `#${x}`).join(' ')})`);
      L.push('');
    }
    if (o.tasks.length) {
      L.push('### Open tasks in the sources', '');
      for (const { note, task } of o.tasks) L.push(`- ${link(note)}, line ${task.line}: "${task.text}"`);
      L.push('');
    }
    if (o.questions.length) {
      L.push('### Questions asked in the sources', '');
      for (const q of o.questions) L.push(`- ${link(q.note)}: "${q.text}"`);
      L.push('');
    }
  }
  return `${L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
