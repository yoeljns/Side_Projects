// The weekly review: unlinked pairs of similar notes (old meets new), orphans worth rescuing, notes
// waiting to be written, and plain-text mentions that could be links. Pure: the same vault state,
// librarian state and date always give the same report.
import { createHash } from 'node:crypto';
import type { Config } from './config.js';
import { addDays, daysBetween, isoWeek, weeksBetween } from './dates.js';
import { wikilink, type Note, type VaultIndex } from './indexer.js';
import { maskCode, maskLinks, type Passage } from './parse.js';
import { blockquote, excerpt } from './quote.js';
import { allPairs, leadPassage, related, scorePair, scorePassages, type Model, type PairNumbers, type PairScore } from './similarity.js';
import type { State } from './state.js';
import { rawTokens, STOP_WORDS } from './text.js';

export interface PairSuggestion {
  id: string;
  kind: 'old-meets-new' | 'archive';
  /** The note that has been untouched longer. */
  older: Note;
  newer: Note;
  pair: PairScore;
  olderPassage: Passage | null;
  newerPassage: Passage | null;
}

export interface OrphanSuggestion {
  id: string;
  note: Note;
  candidates: { note: Note; pair: PairScore }[];
}

export interface UnresolvedSuggestion {
  id: string;
  target: string;
  sources: Note[];
}

export interface MentionSuggestion {
  id: string;
  source: Note;
  target: Note;
  /** The name as it appears in the target's title or aliases. */
  name: string;
  /** The line of the source note that holds the mention, as written. */
  line: string;
  lineNumber: number;
  count: number;
}

export interface WeeklyReport {
  week: string;
  today: string;
  windowStart: string;
  oldAfterDays: number;
  /** Notes created or modified inside the window. */
  touched: Note[];
  pairs: PairSuggestion[];
  orphans: OrphanSuggestion[];
  /** Orphans with enough text but nothing similar enough to suggest. */
  orphansWithoutCandidates: number;
  unresolved: UnresolvedSuggestion[];
  mentions: MentionSuggestion[];
  mentionsTotal: number;
  /** Pairs left out because they were dismissed. */
  dismissedSkipped: number;
  /** Pairs left out because a saved report showed them in the last `repeatAfterWeeks` weeks. */
  heldBack: number;
}

export interface WeeklyOptions {
  today: string;
  limit?: number;
  oldAfterDays?: number;
  /** Show everything, dismissed and recently shown included (used to look an id up). */
  ignoreState?: boolean;
}

function hashId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 8)}`;
}

export const pairId = (a: string, b: string) => hashId('p', ...[a, b].sort());
export const orphanId = (p: string) => hashId('o', p);
export const unresolvedId = (target: string) => hashId('u', target.normalize('NFC').toLowerCase());
export const mentionId = (source: string, target: string) => hashId('m', source, target);

const byPath = (a: Note, b: Note) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function generateWeekly(index: VaultIndex, model: Model, config: Config, state: State, options: WeeklyOptions): WeeklyReport {
  const { today } = options;
  const w = config.weekly;
  const limit = options.limit ?? w.limit;
  const oldAfterDays = options.oldAfterDays ?? w.oldAfterDays;
  const week = isoWeek(today);
  const windowStart = addDays(today, -(w.windowDays - 1));

  const inWindow = (d: string) => d >= windowStart && d <= today;
  const isTouched = (n: Note) => inWindow(n.modified) || inWindow(n.created);
  const isOld = (n: Note) => daysBetween(n.modified, today) >= oldAfterDays;
  const eligible = (n: Note) => n.wordCount >= w.minWords && (w.includeDailyNotes || !n.isDaily);
  const dismissed = (id: string) => !options.ignoreState && id in state.dismissed;
  const shownRecently = (id: string) => {
    if (options.ignoreState || w.repeatAfterWeeks === 0) return false;
    const seen = state.suggested[id];
    if (!seen || seen.last >= week) return false; // this week's own report, or a later one: not a repeat
    return weeksBetween(seen.last, week) < w.repeatAfterWeeks;
  };

  const touched = index.notes.filter((n) => isTouched(n)).sort(byPath);
  const anyTouched = touched.some(eligible);

  // --- pairs ---
  let dismissedSkipped = 0;
  let heldBack = 0;
  const fresh: PairNumbers[] = [];
  const archive: PairNumbers[] = [];
  for (const pair of allPairs(model, eligible, w.minScore)) {
    if (index.neighbours.get(pair.a)?.has(pair.b)) continue; // already linked, in either direction
    const a = index.byPath.get(pair.a)!;
    const b = index.byPath.get(pair.b)!;
    if (!isOld(a) && !isOld(b)) continue;
    const id = pairId(pair.a, pair.b);
    if (dismissed(id)) {
      dismissedSkipped++;
      continue;
    }
    if (shownRecently(id)) {
      heldBack++;
      continue;
    }
    const meets = (isOld(a) && isTouched(b)) || (isOld(b) && isTouched(a));
    if (meets) fresh.push(pair);
    else if (!isTouched(a) && !isTouched(b)) archive.push(pair);
  }

  const perNote = new Map<string, number>();
  const pairs: PairSuggestion[] = [];
  const take = (list: PairNumbers[], kind: PairSuggestion['kind']) => {
    for (const pair of list) {
      if (pairs.length >= limit) return;
      if ((perNote.get(pair.a) ?? 0) >= w.maxPerNote || (perNote.get(pair.b) ?? 0) >= w.maxPerNote) continue;
      perNote.set(pair.a, (perNote.get(pair.a) ?? 0) + 1);
      perNote.set(pair.b, (perNote.get(pair.b) ?? 0) + 1);
      const a = index.byPath.get(pair.a)!;
      const b = index.byPath.get(pair.b)!;
      const [older, newer] = a.modified < b.modified || (a.modified === b.modified && a.path < b.path) ? [a, b] : [b, a];
      pairs.push({
        id: pairId(pair.a, pair.b),
        kind,
        older,
        newer,
        pair: scorePair(model, pair.a, pair.b),
        olderPassage: scorePassages(model, older, model.vectors.get(newer.path) ?? new Map())[0]?.passage ?? leadPassage(older),
        newerPassage: scorePassages(model, newer, model.vectors.get(older.path) ?? new Map())[0]?.passage ?? leadPassage(newer),
      });
    }
  };
  // Old meets new first. When nothing was touched this week, or too little came of it, the archive fills in.
  if (anyTouched) take(fresh, 'old-meets-new');
  take(archive, 'archive');

  // --- orphans ---
  const orphanAll: OrphanSuggestion[] = [];
  let orphansWithoutCandidates = 0;
  for (const note of index.notes) {
    if (!eligible(note) || (index.neighbours.get(note.path)?.size ?? 0) > 0) continue;
    const id = orphanId(note.path);
    if (dismissed(id)) continue;
    const candidates = related(model, note.path, eligible)
      .filter((p) => p.score >= w.minScore * 0.75)
      .slice(0, 2)
      .map((pair) => ({ note: index.byPath.get(pair.a === note.path ? pair.b : pair.a)!, pair }));
    if (candidates.length === 0) orphansWithoutCandidates++;
    else orphanAll.push({ id, note, candidates });
  }
  orphanAll.sort((x, y) => y.candidates[0].pair.score - x.candidates[0].pair.score || byPath(x.note, y.note));

  // --- unresolved ---
  const unresolved: UnresolvedSuggestion[] = index.unresolved
    .filter((u) => !u.attachment && u.sources.length >= w.unresolvedMinSources)
    .map((u) => ({ id: unresolvedId(u.target), target: u.target, sources: u.sources.map((p) => index.byPath.get(p)!) }))
    .filter((u) => !dismissed(u.id))
    .slice(0, 10);

  // --- mentions ---
  const allMentions = findMentions(index)
    .filter((m) => !dismissed(m.id))
    .sort(
      (x, y) =>
        Number(isTouched(y.source)) - Number(isTouched(x.source)) ||
        rawTokens(y.name).length - rawTokens(x.name).length ||
        (x.source.modified < y.source.modified ? 1 : x.source.modified > y.source.modified ? -1 : 0) ||
        byPath(x.source, y.source) ||
        byPath(x.target, y.target),
    );

  return {
    week,
    today,
    windowStart,
    oldAfterDays,
    touched,
    pairs,
    orphans: orphanAll.slice(0, w.orphanLimit),
    orphansWithoutCandidates,
    unresolved,
    mentions: allMentions.slice(0, w.mentionLimit),
    mentionsTotal: allMentions.length,
    dismissedSkipped,
    heldBack,
  };
}

/**
 * Places where a note's title or alias is written out in another note that does not link to it.
 * Matching is on whole words, ignoring case and diacritics. Names that are a single common or short
 * word, and names shared by several notes, are left out.
 */
export function findMentions(index: VaultIndex): MentionSuggestion[] {
  interface Name {
    tokens: string[];
    note: Note;
    name: string;
  }
  const byKey = new Map<string, Name[]>();
  for (const note of index.notes) {
    if (note.isDaily) continue;
    for (const name of new Set([note.basename, note.title, ...note.aliases])) {
      const tokens = rawTokens(name).map((t) => t.t);
      if (tokens.length === 0) continue;
      const content = tokens.filter((t) => !STOP_WORDS.has(t));
      if (content.length === 0 || tokens.join('').length < 5) continue;
      if (tokens.length === 1 && tokens[0].length < 6) continue;
      const k = tokens.join(' ');
      const list = byKey.get(k) ?? [];
      if (!list.some((n) => n.note.path === note.path)) list.push({ tokens, note, name });
      byKey.set(k, list);
    }
  }
  const byFirst = new Map<string, Name[]>();
  for (const list of byKey.values()) {
    if (list.length !== 1) continue; // ambiguous: several notes answer to this name
    const n = list[0];
    const bucket = byFirst.get(n.tokens[0]);
    if (bucket) bucket.push(n);
    else byFirst.set(n.tokens[0], [n]);
  }
  for (const bucket of byFirst.values()) bucket.sort((a, b) => b.tokens.length - a.tokens.length);

  const out: MentionSuggestion[] = [];
  for (const source of index.notes) {
    if (!source.body.trim()) continue;
    const text = maskLinks(maskCode(source.body));
    const toks = rawTokens(text);
    const linked = new Set((index.outgoing.get(source.path) ?? []).map((l) => l.to).filter((p): p is string => p !== null));
    const found = new Map<string, MentionSuggestion>();
    for (let i = 0; i < toks.length; i++) {
      const bucket = byFirst.get(toks[i].t);
      if (!bucket) continue;
      for (const name of bucket) {
        if (name.note.path === source.path || linked.has(name.note.path)) continue;
        let ok = i + name.tokens.length <= toks.length;
        for (let k = 1; ok && k < name.tokens.length; k++) {
          const gap = text.slice(toks[i + k - 1].end, toks[i + k].start);
          ok = toks[i + k].t === name.tokens[k] && /^[ \t\-–'’]{1,3}$/.test(gap);
        }
        if (!ok) continue;
        const existing = found.get(name.note.path);
        if (existing) {
          existing.count++;
        } else {
          const lineStart = source.body.lastIndexOf('\n', toks[i].start - 1) + 1;
          const lineEndRaw = source.body.indexOf('\n', toks[i].start);
          const lineEnd = lineEndRaw === -1 ? source.body.length : lineEndRaw;
          found.set(name.note.path, {
            id: mentionId(source.path, name.note.path),
            source,
            target: name.note,
            name: name.name,
            line: source.body.slice(lineStart, lineEnd).trim(),
            lineNumber: lineNumberAt(source, lineStart),
            count: 1,
          });
        }
        i += name.tokens.length - 1;
        break;
      }
    }
    out.push(...found.values());
  }
  return out;
}

function lineNumberAt(note: Note, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (note.body.charCodeAt(i) === 10) line++;
  return line + note.bodyStartLine;
}

// ---------- rendering ----------

function fmt(n: number): string {
  return n.toFixed(2);
}

function passageBlock(index: VaultIndex, note: Note, passage: Passage | null, maxChars: number): string[] {
  if (!passage) return [];
  const heading = passage.headingPath[passage.headingPath.length - 1] ?? null;
  return [`From ${wikilink(index, note, heading)}:`, '', blockquote(excerpt(passage.text, maxChars)), ''];
}

function ageLine(note: Note, today: string): string {
  const days = daysBetween(note.modified, today);
  const age = days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  return `last modified ${note.modified} (${age})`;
}

export function renderWeekly(report: WeeklyReport, index: VaultIndex, config: Config): string {
  const L: string[] = [];
  const link = (n: Note) => wikilink(index, n);
  L.push('---', 'librarian: weekly-links', `week: ${report.week}`, `generated: ${report.today}`, '---', '');
  L.push(`# Weekly links ${report.week}`, '');
  L.push(
    `Window: ${report.windowStart} to ${report.today}. "Old" means not modified for ${report.oldAfterDays} days or more. ` +
      'Every pair below is similar and not linked in either direction. Quotes are verbatim from the notes.',
    '',
  );
  if (report.touched.length) {
    const shown = report.touched.slice(0, 15).map(link).join(', ');
    const more = report.touched.length > 15 ? ` and ${report.touched.length - 15} more` : '';
    L.push(`Touched in the window (${report.touched.length}): ${shown}${more}.`, '');
  } else {
    L.push('No notes were created or modified in the window, so the pairs come from the archive.', '');
  }

  const fresh = report.pairs.filter((p) => p.kind === 'old-meets-new');
  const archive = report.pairs.filter((p) => p.kind === 'archive');
  const section = (title: string, intro: string, list: PairSuggestion[], startAt: number) => {
    L.push(`## ${title}`, '', intro, '');
    list.forEach((s, i) => {
      const p = s.pair;
      L.push(`### ${startAt + i}. ${link(s.older)} and ${link(s.newer)}`, '');
      const newerNote =
        s.kind === 'old-meets-new'
          ? s.newer.created >= report.windowStart && s.newer.created <= report.today
            ? `created ${s.newer.created}`
            : `modified ${s.newer.modified}`
          : ageLine(s.newer, report.today);
      L.push(`- ${link(s.older)}: ${ageLine(s.older, report.today)}. ${link(s.newer)}: ${newerNote}.`);
      L.push(`- Score ${fmt(p.score)} (text ${fmt(p.text)}, tags ${fmt(p.tags)}, neighbours ${fmt(p.neighbours)})`);
      if (p.sharedTerms.length) L.push(`- Shared terms: ${p.sharedTerms.join(', ')}`);
      if (p.sharedTags.length) L.push(`- Shared tags: ${p.sharedTags.map((t) => `#${t}`).join(' ')}`);
      if (p.commonNeighbours.length) {
        L.push(`- Linked with both: ${p.commonNeighbours.slice(0, 6).map((n) => link(index.byPath.get(n)!)).join(', ')}`);
      }
      L.push(`- Id: \`${s.id}\``, '');
      L.push(...passageBlock(index, s.older, s.olderPassage, 500));
      L.push(...passageBlock(index, s.newer, s.newerPassage, 500));
    });
  };

  if (fresh.length) {
    section('Old notes that meet this week\'s notes', 'One side was created or modified in the window; the other has been left alone for a long time.', fresh, 1);
  }
  if (archive.length) {
    section(
      'From the archive',
      report.touched.length
        ? 'Pairs in which neither note was touched in the window and at least one is old.'
        : 'Neither note was touched in the window and at least one is old.',
      archive,
      fresh.length + 1,
    );
  }
  if (report.pairs.length === 0) {
    L.push('## Link suggestions', '', 'No unlinked pairs scored above the threshold this week.', '');
  }
  const notes: string[] = [];
  if (report.heldBack) notes.push(`${report.heldBack} pair(s) held back because a report in the last ${config.weekly.repeatAfterWeeks} weeks already showed them`);
  if (report.dismissedSkipped) notes.push(`${report.dismissedSkipped} dismissed pair(s) left out`);
  if (notes.length) L.push(`${notes.join('; ')}.`, '');

  L.push('## Orphans worth rescuing', '');
  if (report.orphans.length === 0) L.push('No orphan notes with an obvious home.', '');
  else {
    L.push('Notes with no links in or out, and the notes they sit closest to.', '');
    for (const o of report.orphans) {
      const cands = o.candidates
        .map((c) => `${link(c.note)} (score ${fmt(c.pair.score)}${c.pair.sharedTerms.length ? `; ${c.pair.sharedTerms.slice(0, 4).join(', ')}` : ''})`)
        .join('; ');
      L.push(`- ${link(o.note)}, ${ageLine(o.note, report.today)}. Closest: ${cands}. Id: \`${o.id}\``);
    }
    L.push('');
  }
  if (report.orphansWithoutCandidates) {
    L.push(`${report.orphansWithoutCandidates} more orphan note(s) have nothing similar enough to suggest.`, '');
  }

  L.push('## Notes waiting to be written', '');
  if (report.unresolved.length === 0) {
    L.push(`No missing note is linked from ${config.weekly.unresolvedMinSources} or more notes.`, '');
  } else {
    L.push('Links that point at a note that does not exist yet, from several places.', '');
    for (const u of report.unresolved) {
      L.push(`- [[${u.target}]]: linked from ${u.sources.length} notes: ${u.sources.map(link).join(', ')}. Id: \`${u.id}\``);
    }
    L.push('');
  }

  L.push('## Mentioned but not linked', '');
  if (report.mentions.length === 0) L.push('No plain-text mentions of another note\'s title or alias.', '');
  else {
    L.push('A note\'s title or alias written out in a note that does not link to it. The line is quoted as written.', '');
    for (const m of report.mentions) {
      const times = m.count > 1 ? ` (${m.count} times)` : '';
      L.push(`- ${link(m.source)} mentions "${m.name}"${times}, which is ${link(m.target)}. Id: \`${m.id}\``, '', blockquote(excerpt(m.line, 300)).replace(/^/gm, '  '), '');
    }
    if (report.mentionsTotal > report.mentions.length) L.push(`${report.mentionsTotal - report.mentions.length} more not shown.`, '');
  }

  L.push('## Dismissing', '');
  L.push(
    'To stop seeing a suggestion, dismiss it by id: ask the librarian ("dismiss p-…") or run `vault-librarian dismiss <id>`. ' +
      `Dismissals are kept in \`${config.outputFolder}/librarian-state.json\`.`,
    '',
  );
  return `${L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** Records, for a saved report, which suggestions it showed, so later weeks do not repeat them at once. */
export function recordShown(state: State, report: WeeklyReport): void {
  for (const p of report.pairs) {
    const seen = state.suggested[p.id];
    if (!seen) state.suggested[p.id] = { first: report.week, last: report.week };
    else if (report.week > seen.last) seen.last = report.week;
  }
}

/** Human label for any suggestion id that the current vault can produce, or null. */
export function describeSuggestion(report: WeeklyReport, id: string): { kind: 'pair' | 'orphan' | 'unresolved' | 'mention'; label: string } | null {
  const pair = report.pairs.find((p) => p.id === id);
  if (pair) return { kind: 'pair', label: [pair.older.path, pair.newer.path].sort().join(' <-> ') };
  const orphan = report.orphans.find((o) => o.id === id);
  if (orphan) return { kind: 'orphan', label: orphan.note.path };
  const unresolved = report.unresolved.find((u) => u.id === id);
  if (unresolved) return { kind: 'unresolved', label: `[[${unresolved.target}]]` };
  const mention = report.mentions.find((m) => m.id === id);
  if (mention) return { kind: 'mention', label: `${mention.source.path} mentions ${mention.target.path}` };
  return null;
}
