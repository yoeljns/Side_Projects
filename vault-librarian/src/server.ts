// MCP server: tools prefixed vault_, plus prompts for the weekly review and the essay source packs.
import { completable, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { daysBetween } from './dates.js';
import type { Note, ResolvedLink, VaultIndex } from './indexer.js';
import type { Librarian } from './librarian.js';
import { renderPack, resolveTopic } from './pack.js';
import { sectionRange } from './parse.js';
import { searchNotes } from './search.js';
import { related } from './similarity.js';

export const SERVER_NAME = 'vault-librarian';
export const SERVER_VERSION = '0.1.0';
/** Tool results stay under this many characters; lists return fewer items rather than cut text. */
export const CHARACTER_LIMIT = 25_000;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
/** Tools that may save a report into the vault's output folder. They never touch the owner's notes. */
const WRITES_REPORT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const format = z.enum(['markdown', 'json']).default('markdown').describe("'markdown' for readable text, 'json' for structured data");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const noteRef = z
  .string()
  .min(1)
  .max(400)
  .describe('Vault-relative path ("Notes/Cycles/Minsky moment.md") or a note name or alias ("Minsky moment"). Use the path when two notes share a name.');

type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown> };

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const json = (data: Record<string, unknown>): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });

function noteSummary(n: Note) {
  return { path: n.path, title: n.title, created: n.created, modified: n.modified, tags: n.tags, words: n.wordCount };
}

function page<T>(all: T[], offset: number, limit: number) {
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  return { total: all.length, count: items.length, offset, has_more: all.length > next, next_offset: all.length > next ? next : undefined, items };
}

/** Renders a page; while the text is over the limit, halves the number of items and renders again. */
function fit<T>(all: T[], offset: number, limit: number, render: (p: ReturnType<typeof page<T>>) => string): { text: string; page: ReturnType<typeof page<T>> } {
  let size = limit;
  for (;;) {
    const p = page(all, offset, size);
    const out = render(p);
    if (out.length <= CHARACTER_LIMIT || p.count <= 1) return { text: out, page: p };
    size = Math.ceil(p.count / 2);
  }
}

function linkRow(index: VaultIndex, l: ResolvedLink, side: 'from' | 'to') {
  const other = side === 'from' ? index.byPath.get(l.from) : l.to ? index.byPath.get(l.to) : undefined;
  return {
    path: side === 'from' ? l.from : l.to,
    title: other?.title ?? null,
    line: l.raw.line,
    target_as_written: l.raw.target,
    subpath: l.raw.subpath,
    alias: l.raw.alias,
    embed: l.raw.embed,
    kind: l.raw.kind,
    attachment: l.attachment,
    resolved: l.to !== null || l.attachment !== null,
    anchor_found: l.anchorOk,
    via: l.via,
  };
}

function linkLine(row: ReturnType<typeof linkRow>): string {
  const anchor = row.subpath ? `#${row.subpath}` : '';
  const where = `line ${row.line}`;
  if (row.attachment) return `- ${row.embed ? 'embeds' : 'links'} attachment ${row.attachment} (${where})`;
  if (!row.resolved) return `- [[${row.target_as_written}${anchor}]] is unresolved (${where})`;
  const flags = [row.embed ? 'embed' : '', row.via === 'alias' ? 'by alias' : '', row.anchor_found ? '' : 'anchor not found'].filter(Boolean);
  return `- ${row.path}${anchor} (${where}${flags.length ? `; ${flags.join(', ')}` : ''})`;
}

export function createServer(librarian: Librarian): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Read-only librarian over one Obsidian vault. It finds, quotes and cites notes; it does not edit them. ' +
        'The only files it writes are its own reports (weekly link suggestions, source packs) in one output folder, and only when a tool is called with write: true. ' +
        'Excerpts it returns are verbatim. When helping with the essays, quote the notes exactly and cite them as [[wikilinks]]; do not paraphrase a note as if it were a quote.',
    },
  );
  const topicNames = () => Object.keys(librarian.config.topics);

  server.registerTool(
    'vault_search_notes',
    {
      title: 'Search notes',
      description: `Search the vault's notes by text, tag, folder and date. Returns one page of matches with path, dates, tags and the best-matching line.

Text search is ranked (notes with every query word first), ignores case, diacritics and English plurals, and takes "quoted phrases" as exact. With no query, notes are listed newest first.

Examples:
  - "What do I have on envy?" -> query="envy"
  - "Notes tagged cycles/debt changed this year" -> tags=["cycles/debt"], modified_after="2026-01-01"
  - "Everything in the daily folder for November" -> path="Daily/2026-11-*"
Use vault_read_note to read a hit, vault_related_notes to find notes similar to one.`,
      inputSchema: z.strictObject({
        query: z.string().max(300).optional().describe('Words to look for, e.g. "mimetic rivalry"; wrap an exact phrase in double quotes'),
        tags: z.array(z.string().min(1).max(100)).max(10).optional().describe('Tags every result must have, without "#". A parent tag matches nested ones: "cycles" matches "cycles/debt"'),
        path: z.string().max(300).optional().describe('Folder ("Notes/Cycles") or glob ("Daily/2026-*") the note path must match'),
        modified_after: isoDate.optional().describe('Only notes modified on or after this date (YYYY-MM-DD)'),
        modified_before: isoDate.optional().describe('Only notes modified on or before this date'),
        created_after: isoDate.optional().describe('Only notes created on or after this date'),
        created_before: isoDate.optional().describe('Only notes created on or before this date'),
        sort: z.enum(['relevance', 'modified', 'created', 'title']).optional().describe('Default: relevance with a query, otherwise modified (newest first)'),
        limit: z.number().int().min(1).max(50).default(20).describe('Maximum number of notes to return'),
        offset: z.number().int().min(0).default(0).describe('Number of matches to skip, for pagination'),
        response_format: format,
      }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const { index, model } = librarian.load();
      const hits = searchNotes(index, model, {
        query: a.query,
        tags: a.tags,
        path: a.path,
        modifiedAfter: a.modified_after,
        modifiedBefore: a.modified_before,
        createdAfter: a.created_after,
        createdBefore: a.created_before,
        sort: a.sort,
      });
      const rows = hits.map((h) => ({ ...noteSummary(h.note), matched: h.matched, snippet: h.snippet }));
      const { text: out, page: p } = fit(rows, a.offset, a.limit, (pg) => {
        if (a.response_format === 'json') return JSON.stringify({ ...pg, notes: pg.items, items: undefined }, null, 2);
        if (pg.total === 0) return 'No notes match. Try fewer or different words, drop a filter, or check tag names with vault_stats.';
        const lines = [`Showing ${pg.offset + 1} to ${pg.offset + pg.count} of ${pg.total} notes.`, ''];
        for (const r of pg.items) {
          lines.push(`## ${r.title} (${r.path})`);
          lines.push(`created ${r.created}, modified ${r.modified}, ${r.words} words${r.tags.length ? `, ${r.tags.map((t) => `#${t}`).join(' ')}` : ''}`);
          if (r.snippet) lines.push(`line ${r.snippet.line}: ${r.snippet.text}`);
          lines.push('');
        }
        if (pg.has_more) lines.push(`More results: call again with offset=${pg.next_offset}.`);
        return lines.join('\n').trimEnd();
      });
      if (a.response_format === 'json') {
        const { items, ...rest } = p;
        return json({ ...rest, notes: items });
      }
      return text(out);
    },
  );

  server.registerTool(
    'vault_read_note',
    {
      title: 'Read a note',
      description: `Read one note exactly as written: the whole note, or one heading's section. Also returns its dates, tags, aliases, headings, and (unless include_links is false) its outgoing links and backlinks.

Long notes come in pages of max_chars characters cut at a line break; the result says how to get the next page.

Examples:
  - note="Minsky moment"
  - note="Notes/Desire/Mimetic desire.md", heading="Rivalry"
Use vault_search_notes first when you do not know the name.`,
      inputSchema: z.strictObject({
        note: noteRef,
        heading: z.string().max(300).optional().describe('Return only the section under this heading (to the next heading of the same or a higher level), e.g. "Three stages"'),
        include_links: z.boolean().default(true).describe('Also list outgoing links and backlinks (up to 40 each)'),
        max_chars: z.number().int().min(500).max(20_000).default(12_000).describe('Maximum characters of note text to return'),
        offset: z.number().int().min(0).default(0).describe('Character offset to start from, for pagination; use next_offset from the previous call'),
        response_format: format,
      }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const note = librarian.note(a.note);
      const { index } = librarian.load();
      const raw = librarian.readNote(note);
      let content = raw;
      let section: { heading: string; start_line: number; end_line: number } | null = null;
      if (a.heading) {
        const lines = raw.split('\n');
        const range = sectionRange(note.headings, a.heading, lines.length);
        if (!range) {
          const known = note.headings.map((h) => `"${h.text}"`).join(', ') || 'none';
          throw new Error(`"${note.path}" has no heading "${a.heading}". Its headings: ${known}.`);
        }
        content = lines.slice(range.start - 1, range.end).join('\n');
        section = { heading: note.headings.find((h) => h.line === range.start)!.text, start_line: range.start, end_line: range.end };
      }
      if (a.offset > content.length) throw new Error(`offset ${a.offset} is past the end of the text (${content.length} characters).`);
      let end = Math.min(content.length, a.offset + a.max_chars);
      if (end < content.length) {
        const lineBreak = content.lastIndexOf('\n', end);
        if (lineBreak > a.offset) end = lineBreak + 1;
      }
      const slice = content.slice(a.offset, end);
      const hasMore = end < content.length;

      const outgoing = (index.outgoing.get(note.path) ?? []).filter((l) => l.to !== note.path).map((l) => linkRow(index, l, 'to'));
      const backlinks = (index.backlinks.get(note.path) ?? []).map((l) => linkRow(index, l, 'from'));
      const data = {
        ...noteSummary(note),
        aliases: note.aliases,
        created_from: note.createdFrom,
        modified_from: note.modifiedFrom,
        headings: note.headings,
        section,
        total_chars: content.length,
        offset: a.offset,
        has_more: hasMore,
        ...(hasMore ? { next_offset: end } : {}),
        content: slice,
        ...(a.include_links
          ? { outgoing_total: outgoing.length, outgoing: outgoing.slice(0, 40), backlinks_total: backlinks.length, backlinks: backlinks.slice(0, 40) }
          : {}),
      };
      if (a.response_format === 'json') return json(data);
      const L = [`# ${note.title} (${note.path})`, ''];
      L.push(
        `created ${note.created} (from ${note.createdFrom}), modified ${note.modified} (from ${note.modifiedFrom}), ${note.wordCount} words` +
          (note.tags.length ? `, ${note.tags.map((t) => `#${t}`).join(' ')}` : '') +
          (note.aliases.length ? `, aliases: ${note.aliases.join(', ')}` : ''),
      );
      if (section) L.push(`Section "${section.heading}", lines ${section.start_line} to ${section.end_line}.`);
      L.push('', '----- note text, verbatim -----', slice.replace(/\n$/, ''), '----- end of note text -----');
      if (hasMore) L.push('', `The text continues (${content.length - end} more characters): call again with offset=${end}.`);
      if (a.include_links) {
        L.push('', `Outgoing links (${outgoing.length}):`, ...outgoing.slice(0, 40).map(linkLine));
        L.push('', `Backlinks (${backlinks.length}):`, ...backlinks.slice(0, 40).map(linkLine));
        if (outgoing.length > 40 || backlinks.length > 40) L.push('', 'Only the first 40 of each are shown; use vault_list_links for the rest.');
      }
      return text(L.join('\n'));
    },
  );

  server.registerTool(
    'vault_list_links',
    {
      title: 'List links',
      description: `List links in the vault's link graph.

  - direction="backlinks": notes that link to the given note.
  - direction="outgoing": what the given note links to (notes, attachments, unresolved targets).
  - direction="unresolved": links that point at notes that do not exist. With a note, only that note's; without, the whole vault grouped by target, most-linked first (these are notes waiting to be written).

Links are resolved as Obsidian does: by file name, the shortest path when names clash, and (an extension) by alias.`,
      inputSchema: z.strictObject({
        direction: z.enum(['backlinks', 'outgoing', 'unresolved']).describe('Which links to list'),
        note: noteRef.optional().describe('The note. Required for backlinks and outgoing; optional for unresolved. A vault-relative path or a note name'),
        limit: z.number().int().min(1).max(100).default(30).describe('Maximum number of links to return'),
        offset: z.number().int().min(0).default(0).describe('Number of links to skip, for pagination'),
        response_format: format,
      }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const { index } = librarian.load();
      if (a.direction === 'unresolved' && !a.note) {
        const rows = index.unresolved.map((u) => ({ target: u.target, looks_like_attachment: u.attachment, sources: u.sources }));
        const { text: out, page: p } = fit(rows, a.offset, a.limit, (pg) => {
          if (a.response_format === 'json') return JSON.stringify({ ...pg, targets: pg.items, items: undefined }, null, 2);
          if (pg.total === 0) return 'Every link in the vault resolves.';
          const L = [`Unresolved link targets ${pg.offset + 1} to ${pg.offset + pg.count} of ${pg.total}, most-linked first.`, ''];
          for (const r of pg.items) L.push(`- [[${r.target}]]${r.looks_like_attachment ? ' (missing attachment)' : ''}: ${r.sources.length} note(s): ${r.sources.join(', ')}`);
          if (pg.has_more) L.push('', `More: call again with offset=${pg.next_offset}.`);
          return L.join('\n');
        });
        if (a.response_format === 'json') {
          const { items, ...rest } = p;
          return json({ ...rest, targets: items });
        }
        return text(out);
      }
      if (!a.note) throw new Error(`direction="${a.direction}" needs a note. Pass note="<path or name>".`);
      const note = librarian.note(a.note);
      const all =
        a.direction === 'backlinks'
          ? (index.backlinks.get(note.path) ?? []).map((l) => linkRow(index, l, 'from'))
          : (index.outgoing.get(note.path) ?? [])
              .map((l) => linkRow(index, l, 'to'))
              .filter((r) => (a.direction === 'unresolved' ? !r.resolved : true));
      const { text: out, page: p } = fit(all, a.offset, a.limit, (pg) => {
        if (a.response_format === 'json') return JSON.stringify({ note: note.path, direction: a.direction, ...pg, links: pg.items, items: undefined }, null, 2);
        if (pg.total === 0) return `${note.path} has no ${a.direction === 'unresolved' ? 'unresolved links' : a.direction === 'backlinks' ? 'backlinks' : 'outgoing links'}.`;
        const L = [`${a.direction === 'backlinks' ? 'Backlinks to' : a.direction === 'outgoing' ? 'Outgoing links of' : 'Unresolved links in'} ${note.path}: ${pg.offset + 1} to ${pg.offset + pg.count} of ${pg.total}.`, ''];
        L.push(...pg.items.map(linkLine));
        if (pg.has_more) L.push('', `More: call again with offset=${pg.next_offset}.`);
        return L.join('\n');
      });
      if (a.response_format === 'json') {
        const { items, ...rest } = p;
        return json({ note: note.path, direction: a.direction, ...rest, links: items });
      }
      return text(out);
    },
  );

  server.registerTool(
    'vault_related_notes',
    {
      title: 'Related notes',
      description: `Notes most similar to one note, with the reasons. The score (0 to 1) combines three parts, each reported: text (TF-IDF cosine of the prose), tags (shared tags, rare ones count more) and neighbours (notes linked with both). Computed locally; no outside service.

Each result says whether the two notes are already linked. Set only_unlinked=true to see candidates for a new link.
Example: note="Speculative manias", only_unlinked=true`,
      inputSchema: z.strictObject({
        note: noteRef,
        only_unlinked: z.boolean().default(false).describe('Leave out notes already linked with this one in either direction'),
        limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of related notes to return'),
        offset: z.number().int().min(0).default(0).describe('Number of results to skip, for pagination'),
        response_format: format,
      }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const note = librarian.note(a.note);
      const { index, model } = librarian.load();
      const around = index.neighbours.get(note.path) ?? new Set<string>();
      const rows = related(model, note.path, (n) => n.wordCount > 0)
        .map((p) => {
          const other = index.byPath.get(p.a === note.path ? p.b : p.a)!;
          return {
            ...noteSummary(other),
            linked: around.has(other.path),
            score: Number(p.score.toFixed(3)),
            text: Number(p.text.toFixed(3)),
            tag_overlap: Number(p.tags.toFixed(3)),
            neighbour_overlap: Number(p.neighbours.toFixed(3)),
            shared_terms: p.sharedTerms,
            shared_tags: p.sharedTags,
            common_neighbours: p.commonNeighbours,
          };
        })
        .filter((r) => !a.only_unlinked || !r.linked);
      const { text: out, page: p } = fit(rows, a.offset, a.limit, (pg) => {
        if (a.response_format === 'json') return JSON.stringify({ note: note.path, ...pg, related: pg.items, items: undefined }, null, 2);
        if (pg.total === 0) return `Nothing in the vault is measurably related to ${note.path}${note.wordCount === 0 ? ' (the note has no text)' : ''}.`;
        const L = [`Notes related to ${note.path}: ${pg.offset + 1} to ${pg.offset + pg.count} of ${pg.total}.`, ''];
        for (const r of pg.items) {
          L.push(`## ${r.title} (${r.path})`);
          L.push(`score ${r.score.toFixed(2)} (text ${r.text.toFixed(2)}, tags ${r.tag_overlap.toFixed(2)}, neighbours ${r.neighbour_overlap.toFixed(2)}); ${r.linked ? 'already linked' : 'not linked'}; modified ${r.modified}`);
          if (r.shared_terms.length) L.push(`shared terms: ${r.shared_terms.join(', ')}`);
          if (r.shared_tags.length) L.push(`shared tags: ${r.shared_tags.map((t) => `#${t}`).join(' ')}`);
          if (r.common_neighbours.length) L.push(`linked with both: ${r.common_neighbours.join(', ')}`);
          L.push('');
        }
        if (pg.has_more) L.push(`More: call again with offset=${pg.next_offset}.`);
        return L.join('\n').trimEnd();
      });
      if (a.response_format === 'json') {
        const { items, ...rest } = p;
        return json({ note: note.path, ...rest, related: items });
      }
      return text(out);
    },
  );

  server.registerTool(
    'vault_weekly_links',
    {
      title: 'Weekly link suggestions',
      description: `Build the weekly review: pairs of notes that are similar but not linked in either direction, biased toward an old note (untouched for old_after_days) meeting a note created or modified in the last 7 days; then orphans worth rescuing, missing notes that several notes link to, and plain-text mentions of another note's title or alias.

Every suggestion has an id (p-…, o-…, u-…, m-…) and a reason: shared terms, shared tags, common neighbours and the best-matching passage from each note, quoted verbatim. Dismissed suggestions are left out (see vault_dismiss_suggestion). The same vault, state and date always give the same report.

Returns the report as Markdown (or JSON). With write=true it is also saved as "<output folder>/Weekly links/YYYY-Www.md" (replacing that week's file if it exists) and the pairs shown are remembered so the next weeks do not repeat them. Without write nothing is changed.`,
      inputSchema: z.strictObject({
        write: z.boolean().default(false).describe('Also save the report into the vault output folder'),
        limit: z.number().int().min(1).max(30).optional().describe('Maximum number of note pairs (default from config, 10)'),
        old_after_days: z.number().int().min(1).max(3650).optional().describe('A note counts as old when not modified for this many days (default from config, 90)'),
        today: isoDate.optional().describe('Date to treat as today, YYYY-MM-DD, to reproduce a past week. Default: the current date'),
        response_format: format,
      }),
      annotations: WRITES_REPORT,
    },
    async (a) => {
      const { report, markdown, written } = librarian.weekly({ today: a.today, limit: a.limit, oldAfterDays: a.old_after_days, write: a.write });
      if (a.response_format === 'json') {
        const quote = (p: { text: string; headingPath: string[]; startLine: number } | null) => (p ? { heading_path: p.headingPath, line: p.startLine, text: p.text } : null);
        const build = (pairLimit: number) => ({
          week: report.week,
          today: report.today,
          window_start: report.windowStart,
          old_after_days: report.oldAfterDays,
          written,
          touched: report.touched.map((n) => n.path),
          pairs_total: report.pairs.length,
          pairs: report.pairs.slice(0, pairLimit).map((s) => ({
            id: s.id,
            kind: s.kind,
            older: noteSummary(s.older),
            newer: noteSummary(s.newer),
            days_since_older_modified: daysBetween(s.older.modified, report.today),
            score: Number(s.pair.score.toFixed(3)),
            text: Number(s.pair.text.toFixed(3)),
            tag_overlap: Number(s.pair.tags.toFixed(3)),
            neighbour_overlap: Number(s.pair.neighbours.toFixed(3)),
            shared_terms: s.pair.sharedTerms,
            shared_tags: s.pair.sharedTags,
            common_neighbours: s.pair.commonNeighbours,
            older_passage: quote(s.olderPassage),
            newer_passage: quote(s.newerPassage),
          })),
          orphans: report.orphans.map((o) => ({ id: o.id, note: o.note.path, closest: o.candidates.map((c) => ({ note: c.note.path, score: Number(c.pair.score.toFixed(3)) })) })),
          unresolved: report.unresolved.map((u) => ({ id: u.id, target: u.target, sources: u.sources.map((n) => n.path) })),
          mentions: report.mentions.map((m) => ({ id: m.id, source: m.source.path, target: m.target.path, name: m.name, line: m.lineNumber, text: m.line, count: m.count })),
          mentions_total: report.mentionsTotal,
          held_back: report.heldBack,
          dismissed_skipped: report.dismissedSkipped,
        });
        let n = report.pairs.length;
        let data = build(n);
        while (JSON.stringify(data, null, 2).length > CHARACTER_LIMIT && n > 1) data = build((n = Math.ceil(n / 2)));
        return json(data);
      }
      const header = written ? `Saved to ${written}.\n\n` : '';
      if (markdown.length + header.length <= CHARACTER_LIMIT) return text(header + markdown);
      // Too long for one result: rebuild with fewer pairs. The saved file, if any, has the full report.
      let n = report.pairs.length;
      let shorter = markdown;
      while (shorter.length + header.length + 200 > CHARACTER_LIMIT && n > 1) {
        n = Math.ceil(n / 2);
        shorter = librarian.weekly({ today: a.today, limit: n, oldAfterDays: a.old_after_days }).markdown;
      }
      return text(`${header}${shorter}\nOnly the first ${n} of ${report.pairs.length} pairs are shown to keep this result short${written ? `; the saved file has all of them` : '; call with write=true to save the full report'}.`);
    },
  );

  server.registerTool(
    'vault_dismiss_suggestion',
    {
      title: 'Dismiss a suggestion',
      description: `Stop a weekly suggestion from coming back, or restore one with undo=true. Give the id printed next to the suggestion (p-… pair, o-… orphan, u-… unresolved link, m-… mention), or the two notes of a pair.

Dismissals are remembered in librarian-state.json in the vault's output folder. No note is changed.
Examples: id="p-1a2b3c4d"; or note_a="Hype cycle", note_b="Technology surges"`,
      inputSchema: z.strictObject({
        id: z.string().max(20).optional().describe('Suggestion id from the weekly report, e.g. "p-1a2b3c4d"'),
        note_a: noteRef.optional().describe('First note of a pair (instead of id)'),
        note_b: noteRef.optional().describe('Second note of a pair (instead of id)'),
        undo: z.boolean().default(false).describe('Restore the suggestion instead of dismissing it'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a) => {
      if (!a.id && !a.note_a && !a.note_b) throw new Error('Give an id, or note_a and note_b.');
      const result = librarian.dismiss({ id: a.id, noteA: a.note_a, noteB: a.note_b }, { undo: a.undo });
      return text(`${result.dismissed ? 'Dismissed' : 'Restored'} ${result.id} (${result.label}).${result.dismissed ? ' Undo with undo=true.' : ''}`);
    },
  );

  server.registerTool(
    'vault_build_source_pack',
    {
      title: 'Build a source pack',
      description: `Assemble everything the vault holds on a topic into one Markdown pack for essay writing: an outline grouped by sub-theme; for each source note its wikilink, dates, why it was included, and its most relevant passages quoted exactly with their heading; then open questions (missing notes, question-tagged notes, open tasks, question sentences) and what is new since the last saved pack.

topic is a preset name (see vault_list_topics; the essay presets are "desire" and "cycles") or any free query, optionally with #tags, e.g. "boredom and attention" or "#cycles/debt inflation". Notes are selected by tag, by link distance from the topic's seed notes, and by text score against its key terms.

The pack only assembles and cites. Quotes are verbatim; " […]" marks a cut. It does not summarise or write prose.

With write=true the full pack is saved as "<output folder>/Source packs/<topic> YYYY-MM-DD.md" and recorded, so the next pack can say what is new. If the pack is too long for one result, the result holds the first sources and says how to get the rest with source_offset.`,
      inputSchema: z.strictObject({
        topic: z.string().min(1).max(200).describe('Preset name ("desire", "cycles") or a free query, optionally with #tags'),
        write: z.boolean().default(false).describe('Also save the pack into the vault output folder'),
        max_sources: z.number().int().min(1).max(60).optional().describe('Maximum number of source notes (default from config, 25)'),
        excerpts_per_source: z.number().int().min(1).max(6).optional().describe('Maximum excerpts quoted per source (default from config, 3)'),
        source_offset: z.number().int().min(0).default(0).describe('Skip this many sources in the returned text, for pagination'),
        today: isoDate.optional().describe('Date to treat as today, YYYY-MM-DD. Default: the current date'),
      }),
      annotations: WRITES_REPORT,
    },
    async (a) => {
      const { index } = librarian.load();
      const { pack, written } = librarian.pack(a.topic, { today: a.today, write: a.write && a.source_offset === 0, maxSources: a.max_sources, excerptsPerSource: a.excerpts_per_source });
      if (pack.sources.length === 0) {
        return text(`No notes match the topic "${pack.topic.title}". Try other words, a #tag, or check the topic with vault_get_topic.`);
      }
      if (a.source_offset >= pack.sources.length) throw new Error(`source_offset ${a.source_offset} is past the last source (${pack.sources.length} sources).`);
      let limit = pack.sources.length - a.source_offset;
      let out = renderPack(pack, index, { sourceOffset: a.source_offset, sourceLimit: limit });
      while (out.length + 300 > CHARACTER_LIMIT && limit > 1) {
        limit = Math.ceil(limit / 2);
        out = renderPack(pack, index, { sourceOffset: a.source_offset, sourceLimit: limit });
      }
      const next = a.source_offset + limit;
      const notes: string[] = [];
      if (written) notes.push(`Saved to ${written}.`);
      if (next < pack.sources.length) notes.push(`${pack.sources.length - next} more sources: call again with source_offset=${next}${written ? ' (the saved file has them all)' : ''}.`);
      return text(notes.length ? `${out}\n${notes.join(' ')}` : out);
    },
  );

  server.registerTool(
    'vault_list_topics',
    {
      title: 'List topics',
      description: 'List the source-pack topics defined for this vault (built-in "desire" and "cycles", plus any in vault-librarian.config.json) with their titles and the number of seed tags, seed notes and key terms. Use vault_get_topic for the full definition and vault_build_source_pack to build a pack.',
      inputSchema: z.strictObject({ response_format: format }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const topics = Object.values(librarian.config.topics).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description ?? null,
        seed_tags: t.seedTags.length,
        seed_notes: t.seedNotes.length,
        key_terms: t.keyTerms.length,
        sub_themes: t.subThemes.map((s) => s.name),
      }));
      if (a.response_format === 'json') return json({ topics });
      return text(
        topics
          .map((t) => `- ${t.name}: ${t.title}${t.description ? `. ${t.description}` : ''} (${t.seed_tags} seed tags, ${t.seed_notes} seed notes, ${t.key_terms} key terms${t.sub_themes.length ? `; sub-themes: ${t.sub_themes.join(', ')}` : ''})`)
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'vault_get_topic',
    {
      title: 'Show a topic definition',
      description: 'Show how one source-pack topic is defined: seed tags, seed notes (and which of them exist in the vault), key terms and sub-themes. Topics are edited in vault-librarian.config.json in the vault root; this tool does not change them.',
      inputSchema: z.strictObject({
        topic: z.string().min(1).max(100).describe('Topic name, e.g. "desire" or "cycles"'),
        response_format: format,
      }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const def = librarian.config.topics[a.topic.trim().toLowerCase()];
      if (!def) throw new Error(`No topic "${a.topic}". Topics: ${topicNames().join(', ')}. A free query can be passed straight to vault_build_source_pack.`);
      const { index } = librarian.load();
      const resolved = resolveTopic(index, librarian.config, def.name);
      const data = {
        name: def.name,
        title: def.title,
        description: def.description ?? null,
        seed_tags: def.seedTags,
        seed_notes: resolved.seedNotes.map((n) => n.path),
        seed_notes_not_found: resolved.missingSeeds,
        key_terms: def.keyTerms,
        sub_themes: def.subThemes,
        defined_in: librarian.config.configPath ?? 'built-in defaults',
      };
      if (a.response_format === 'json') return json(data);
      const L = [`# ${data.title} (${data.name})`, ''];
      if (data.description) L.push(data.description, '');
      L.push(`Seed tags: ${data.seed_tags.map((t) => `#${t}`).join(' ') || 'none'}`);
      L.push(`Seed notes: ${data.seed_notes.join(', ') || 'none'}`);
      if (data.seed_notes_not_found.length) L.push(`Seed notes not found in the vault: ${data.seed_notes_not_found.join(', ')}`);
      L.push(`Key terms: ${data.key_terms.join(', ') || 'none'}`);
      for (const s of data.sub_themes) L.push(`Sub-theme ${s.name}: tags ${s.tags.map((t) => `#${t}`).join(' ') || 'none'}; terms ${s.terms.join(', ') || 'none'}`);
      L.push('', `Defined in: ${data.defined_in}`);
      return text(L.join('\n'));
    },
  );

  server.registerTool(
    'vault_stats',
    {
      title: 'Vault statistics',
      description: 'Counts for the vault as indexed: notes, words, links, unresolved links, orphans, attachments, the most used tags, the date range, configured topics, and how the last index run went (files parsed against files reused from the cache). Use it to check that the right vault is connected and to see which tags exist.',
      inputSchema: z.strictObject({ response_format: format }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const s = librarian.stats();
      if (a.response_format === 'json') return json(s as unknown as Record<string, unknown>);
      const L = [
        `Vault: ${s.vault}`,
        `Config: ${s.configFile ?? 'none (defaults)'}; output folder: ${s.outputFolder}`,
        `Notes: ${s.notes} (${s.dailyNotes} daily, ${s.emptyNotes} without text); attachments: ${s.attachments}; words: ${s.words}; distinct terms: ${s.distinctTerms}`,
        `Links: ${s.links} resolved (${s.brokenAnchors} with a heading or block that was not found); ${s.unresolvedTargets} missing notes linked; ${s.missingAttachments} missing attachments; ${s.orphans} orphan notes`,
        `Modified between ${s.oldestModified ?? 'n/a'} and ${s.newestModified ?? 'n/a'}`,
        `Top tags: ${s.topTags.map((t) => `#${t.tag} (${t.count})`).join(', ') || 'none'}`,
        `Topics: ${s.topics.join(', ')}; dismissed suggestions: ${s.dismissed}`,
        `Last index: ${s.index.parsed} parsed, ${s.index.reused} from cache, ${s.index.skippedSymlinks} symlinks skipped, ${s.index.ms} ms`,
      ];
      if (s.frontmatterErrors.length) L.push(`Frontmatter that could not be parsed: ${s.frontmatterErrors.join(', ')}`);
      return text(L.join('\n'));
    },
  );

  // ---- prompts ----
  server.registerPrompt(
    'weekly_review',
    {
      title: 'Prepare the weekly review',
      description: 'Run the weekly link suggestions, save the report into the vault, and walk through the suggestions.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Prepare my weekly vault review. Call vault_weekly_links with write=true. Then go through the pairs in order: for each, name the two notes, ' +
              'show the two quoted passages exactly as returned, and say in one sentence what a link between them would be about, based only on those passages. ' +
              'Do not edit any note. After the pairs, list the orphans, the notes waiting to be written and the unlinked mentions briefly. ' +
              'If I say a suggestion is not useful, dismiss it with vault_dismiss_suggestion.',
          },
        },
      ],
    }),
  );

  const packPrompt = (topic: string) =>
    `Prepare a source pack for "${topic}". Call vault_build_source_pack with topic="${topic}" and write=true; if the result says more sources remain, fetch them with source_offset. ` +
    'Then give me the outline by sub-theme, what is new since the last pack, and the open questions. ' +
    'Quote my notes only verbatim, with the [[wikilink]] of the note each quote comes from, and do not write essay prose for me or paraphrase a note as if it were a quote. ' +
    'If a sub-theme looks thin, say which notes are missing rather than filling the gap yourself.';

  for (const topic of Object.values(librarian.config.topics)) {
    server.registerPrompt(
      `source_pack_${topic.name.replace(/-/g, '_')}`,
      {
        title: `Prepare a source pack for the ${topic.title.toLowerCase()} essay`,
        description: `Build and save the "${topic.name}" source pack and summarise its outline, what is new, and the open questions.`,
      },
      () => ({ messages: [{ role: 'user', content: { type: 'text', text: packPrompt(topic.name) } }] }),
    );
  }

  server.registerPrompt(
    'source_pack',
    {
      title: 'Prepare a source pack for a topic',
      description: 'Build and save a source pack for a preset topic or any free query.',
      argsSchema: z.object({
        topic: completable(z.string().describe('Preset name or free query'), (value) => topicNames().filter((n) => n.startsWith(value.toLowerCase()))),
      }),
    },
    ({ topic }) => ({ messages: [{ role: 'user', content: { type: 'text', text: packPrompt(topic) } }] }),
  );

  return server;
}
