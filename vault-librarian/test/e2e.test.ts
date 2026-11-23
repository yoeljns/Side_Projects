// End to end: start the built server (dist/cli.js) over stdio and talk to it with the SDK client.
// `npm test` builds first (pretest).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unquote } from '../src/quote.js';
import { CHARACTER_LIMIT } from '../src/server.js';
import { cleanup, copyFixture, TODAY } from './helpers.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
const copy = copyFixture();
let client: Client;

type Result = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean; data: Record<string, unknown> | undefined }> {
  const result = (await client.callTool({ name, arguments: args })) as Result;
  return { text: result.content.map((c) => c.text ?? '').join('\n'), isError: result.isError === true, data: result.structuredContent };
}

function tree(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? tree(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]))
    .sort();
}

beforeAll(async () => {
  expect(fs.existsSync(CLI), 'dist/cli.js is missing: run npm run build').toBe(true);
  client = new Client({ name: 'vault-librarian-e2e', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'serve', '--vault', copy.vault],
      env: { ...getDefaultEnvironment(), XDG_CACHE_HOME: copy.cache, VAULT_LIBRARIAN_TODAY: TODAY },
      stderr: 'ignore',
    }),
  );
});

afterAll(async () => {
  await client?.close();
  cleanup();
});

describe('MCP server over stdio', () => {
  it('lists its tools with descriptions, schemas and honest annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'vault_build_source_pack',
      'vault_dismiss_suggestion',
      'vault_get_topic',
      'vault_list_links',
      'vault_list_topics',
      'vault_read_note',
      'vault_related_notes',
      'vault_search_notes',
      'vault_stats',
      'vault_weekly_links',
    ]);
    const writers = ['vault_build_source_pack', 'vault_dismiss_suggestion', 'vault_weekly_links'];
    for (const t of tools) {
      expect(t.description!.length, t.name).toBeGreaterThan(80);
      expect(t.title, t.name).toBeTruthy();
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations?.readOnlyHint, t.name).toBe(!writers.includes(t.name));
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
      for (const [prop, schema] of Object.entries(t.inputSchema.properties ?? {})) {
        expect((schema as { description?: string }).description, `${t.name}.${prop}`).toBeTruthy();
      }
    }
  });

  it('reports vault statistics', async () => {
    const { data } = await call('vault_stats', { response_format: 'json' });
    expect(data).toMatchObject({ notes: 35, attachments: 2, dailyNotes: 3, unresolvedTargets: 3, brokenAnchors: 1, outputFolder: 'Librarian', topics: ['desire', 'cycles'] });
    const { text } = await call('vault_stats');
    expect(text).toContain('Notes: 35 (3 daily, 2 without text)');
  });

  it('searches by text, tag, path and date, with pagination', async () => {
    const envy = await call('vault_search_notes', { query: 'envy neighbour', response_format: 'json' });
    const notes = envy.data!.notes as { path: string; snippet: { text: string } }[];
    expect(notes[0].path).toBe('Notes/Desire/Envy and the neighbour.md');
    expect(notes.map((n) => n.path)).toContain('Notes/Cycles/Speculative manias.md');
    expect(notes[0].snippet.text).toMatch(/envy/i);

    const debt = await call('vault_search_notes', { tags: ['cycles/debt'], sort: 'title', response_format: 'json' });
    expect((debt.data!.notes as { title: string }[]).map((n) => n.title)).toEqual(['Borç döngüsü', 'Deleveraging', 'Long debt cycle', 'Minsky moment']);
    const parent = await call('vault_search_notes', { tags: ['cycles'], limit: 5, response_format: 'json' });
    expect(parent.data).toMatchObject({ total: 13, count: 5, has_more: true, next_offset: 5 }); // nested cycles/* tags count
    const rest = await call('vault_search_notes', { tags: ['cycles'], limit: 5, offset: 10, response_format: 'json' });
    expect(rest.data).toMatchObject({ total: 13, count: 3, has_more: false });

    const daily = await call('vault_search_notes', { path: 'Daily/2026-11-*' });
    expect(daily.text).toContain('Showing 1 to 2 of 2 notes.');
    const recent = await call('vault_search_notes', { modified_after: '2026-11-18', response_format: 'json' });
    expect((recent.data!.notes as { path: string }[]).map((n) => n.path)).toEqual([
      'Notes/Desire/Scarcity and luxury.md',
      'Essays/Desire essay outline.md',
      'Daily/2026-11-19.md',
      'Notes/Cycles/Speculative manias.md',
    ]);
    const turkish = await call('vault_search_notes', { query: 'borc dongusu', response_format: 'json' }); // typed without Turkish letters
    expect((turkish.data!.notes as { path: string }[])[0].path).toBe('Notes/Türkçe/Borç döngüsü.md');
    const phrase = await call('vault_search_notes', { query: '"stability is destabilising"', response_format: 'json' });
    expect((phrase.data!.notes as { path: string }[]).map((n) => n.path)).toEqual(['Notes/Cycles/Minsky moment.md']);
    expect((await call('vault_search_notes', { query: 'xylophone' })).text).toMatch(/^No notes match/);
  });

  it('reads a note verbatim, one section of it, and its links', async () => {
    const whole = await call('vault_read_note', { note: 'Minsky moment', response_format: 'json' });
    const file = fs.readFileSync(path.join(copy.vault, 'Notes/Cycles/Minsky moment.md'), 'utf8');
    expect(whole.data!.content).toBe(file);
    expect(whole.data).toMatchObject({ path: 'Notes/Cycles/Minsky moment.md', aliases: ['financial instability hypothesis'], has_more: false, backlinks_total: 7 });
    expect((whole.data!.outgoing as { target_as_written: string; resolved: boolean }[]).map((l) => [l.target_as_written, l.resolved])).toEqual([
      ['Reflexivity', false],
      ['Long debt cycle', true],
    ]);

    const section = await call('vault_read_note', { note: 'Notes/Cycles/Minsky moment.md', heading: 'three stages', include_links: false });
    expect(section.text).toContain('1. Hedge finance: income covers interest and principal.');
    expect(section.text).toContain('3. Ponzi finance');
    expect(section.text).not.toContain('The moment is the point');
    expect(section.text).not.toContain('Backlinks');

    const paged = await call('vault_read_note', { note: 'Mimetic desire', max_chars: 500, include_links: false, response_format: 'json' });
    expect(paged.data).toMatchObject({ has_more: true, offset: 0 });
    const next = await call('vault_read_note', { note: 'Mimetic desire', max_chars: 20000, offset: paged.data!.next_offset, include_links: false, response_format: 'json' });
    expect(`${paged.data!.content as string}${next.data!.content as string}`).toBe(fs.readFileSync(path.join(copy.vault, 'Notes/Desire/Mimetic desire.md'), 'utf8'));

    const missingHeading = await call('vault_read_note', { note: 'Minsky moment', heading: 'Nope' });
    expect(missingHeading.isError).toBe(true);
    expect(missingHeading.text).toContain('Its headings: "Minsky moment", "Three stages", "The moment"');
    const ambiguous = await call('vault_read_note', { note: 'Index' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain('"Notes/Cycles/Index.md", "Notes/Desire/Index.md"');
  });

  it('refuses path traversal in every tool argument that names a note or folder', async () => {
    fs.writeFileSync(path.join(copy.root, 'outside.md'), '# Outside\n\nTOP SECRET outside the vault.');
    const attempts: [string, Record<string, unknown>][] = [
      ['vault_read_note', { note: '../outside.md' }],
      ['vault_read_note', { note: '../outside' }],
      ['vault_read_note', { note: 'Notes/../../outside.md' }],
      ['vault_read_note', { note: path.join(copy.root, 'outside.md') }],
      ['vault_read_note', { note: '/etc/passwd' }],
      ['vault_read_note', { note: '..\\outside.md' }],
      ['vault_read_note', { note: '.obsidian/app.json' }],
      ['vault_list_links', { direction: 'backlinks', note: '../outside.md' }],
      ['vault_related_notes', { note: '../../etc/hosts' }],
      ['vault_dismiss_suggestion', { note_a: '../outside.md', note_b: 'Minsky moment' }],
      ['vault_dismiss_suggestion', { id: '../../x' }],
    ];
    for (const [name, args] of attempts) {
      const r = await call(name, args);
      expect(r.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(r.text).not.toContain('TOP SECRET');
      expect(r.text).not.toContain('root:');
    }
    // A path filter is only a filter: it matches nothing outside the index.
    expect((await call('vault_search_notes', { path: '../**' })).text).toMatch(/^No notes match/);
    expect((await call('vault_search_notes', { query: 'SECRET' })).text).toMatch(/^No notes match/);
    // Unknown arguments are rejected rather than ignored.
    expect((await call('vault_weekly_links', { output: '/tmp/elsewhere.md' })).isError).toBe(true);
    expect((await call('vault_weekly_links', { today: '23-11-2026' })).isError).toBe(true);
    expect(tree(copy.vault).some((f) => f.startsWith('Librarian'))).toBe(false);
  });

  it('lists backlinks, outgoing and unresolved links', async () => {
    const back = await call('vault_list_links', { direction: 'backlinks', note: 'Long debt cycle', response_format: 'json' });
    expect((back.data!.links as { path: string; via: string }[]).map((l) => [l.path, l.via])).toEqual(
      expect.arrayContaining([
        ['Notes/Türkçe/Borç döngüsü.md', 'alias'],
        ['Notes/Cycles/Deleveraging.md', 'basename'],
      ]),
    );
    const out = await call('vault_list_links', { direction: 'outgoing', note: 'Long debt cycle' });
    expect(out.text).toContain('- Notes/Cycles/Minsky moment.md (line 19)');
    expect(out.text).toContain('- embeds attachment Attachments/debt-chart.png (line 25)');
    const anchors = await call('vault_list_links', { direction: 'outgoing', note: 'Arzu ve taklit' });
    expect(anchors.text).toContain('#Nonexistent heading (line 18; anchor not found)');
    const unresolved = await call('vault_list_links', { direction: 'unresolved', response_format: 'json' });
    expect((unresolved.data!.targets as { target: string; sources: string[] }[]).map((t) => [t.target, t.sources.length])).toEqual([
      ['Positional goods', 4],
      ['Reflexivity', 3],
      ['Dutch disease', 1],
    ]);
    const one = await call('vault_list_links', { direction: 'unresolved', note: 'Hype cycle' });
    expect(one.text).toContain('[[Reflexivity]] is unresolved');
    expect((await call('vault_list_links', { direction: 'backlinks' })).isError).toBe(true);
  });

  it('finds related notes with the score broken down', async () => {
    const r = await call('vault_related_notes', { note: 'Speculative manias', only_unlinked: true, limit: 2, response_format: 'json' });
    const rows = r.data!.related as { path: string; linked: boolean; score: number; text: number; shared_terms: string[] }[];
    expect(rows.map((x) => x.path).sort()).toEqual(['Notes/Desire/Envy and the neighbour.md', 'Notes/Desire/Mimetic desire.md']);
    expect(rows.every((x) => !x.linked && x.score > 0.1 && x.text > 0.15)).toBe(true);
    expect(r.data).toMatchObject({ count: 2, has_more: true, next_offset: 2 });
    const all = await call('vault_related_notes', { note: 'Deleveraging', limit: 1 });
    expect(all.text).toContain('## Long debt cycle (Notes/Cycles/Long debt cycle.md)');
    expect(all.text).toContain('already linked');
    expect((await call('vault_related_notes', { note: 'Notes/Empty.md' })).text).toContain('the note has no text');
  });

  it('builds the weekly suggestions, saves them on request, and remembers a dismissal', async () => {
    const dry = await call('vault_weekly_links', {});
    expect(dry.text).toContain('# Weekly links 2026-W48');
    expect(dry.text).toContain('### 1. [[Mimetic desire]] and [[Speculative manias]]');
    expect(dry.text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(tree(path.join(copy.vault, 'Librarian'))).toEqual([]); // write defaults to false

    const asJson = await call('vault_weekly_links', { response_format: 'json', limit: 3 });
    const pairs = asJson.data!.pairs as { id: string; older: { path: string }; newer: { path: string }; older_passage: { text: string } }[];
    expect(pairs).toHaveLength(3);
    expect([pairs[0].older.path, pairs[0].newer.path]).toEqual(['Notes/Desire/Mimetic desire.md', 'Notes/Cycles/Speculative manias.md']);
    expect(fs.readFileSync(path.join(copy.vault, pairs[0].older.path), 'utf8')).toContain(pairs[0].older_passage.text);

    const saved = await call('vault_weekly_links', { write: true });
    expect(saved.text.startsWith('Saved to Librarian/Weekly links/2026-W48.md.')).toBe(true);
    const onDisk = fs.readFileSync(path.join(copy.vault, 'Librarian/Weekly links/2026-W48.md'), 'utf8');
    expect(saved.text).toContain(onDisk);
    expect(onDisk).toBe(dry.text);

    const dismissed = await call('vault_dismiss_suggestion', { id: pairs[0].id });
    expect(dismissed.text).toMatch(/^Dismissed p-[0-9a-f]{8} \(Notes\/Cycles\/Speculative manias\.md <-> Notes\/Desire\/Mimetic desire\.md\)/);
    const after = await call('vault_weekly_links', {});
    expect(after.text).not.toContain('[[Mimetic desire]] and [[Speculative manias]]');
    expect(after.text).toContain('1 dismissed pair(s) left out');
    const restored = await call('vault_dismiss_suggestion', { id: pairs[0].id, undo: true });
    expect(restored.text).toMatch(/^Restored/);
    expect((await call('vault_weekly_links', {})).text).toBe(dry.text);
  });

  it('builds a source pack, pages a long one, and saves it on request', async () => {
    const topics = await call('vault_list_topics', { response_format: 'json' });
    expect((topics.data!.topics as { name: string }[]).map((t) => t.name)).toEqual(['desire', 'cycles']);
    const topic = await call('vault_get_topic', { topic: 'cycles' });
    expect(topic.text).toContain('Seed notes: Notes/Cycles/Long debt cycle.md, Notes/Cycles/Commodity supercycle.md, Notes/Cycles/Technology surges.md');
    expect((await call('vault_get_topic', { topic: 'nope' })).text).toContain('Topics: desire, cycles');

    const pack = await call('vault_build_source_pack', { topic: 'cycles' });
    expect(pack.isError).toBe(false);
    expect(pack.text).toContain('# Source pack: Cycles (2026-11-23)');
    expect(pack.text).toContain('### Debt');
    expect(pack.text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    const corpus = tree(copy.vault).filter((f) => f.endsWith('.md') && !f.startsWith('Librarian')).map((f) => fs.readFileSync(path.join(copy.vault, f), 'utf8'));
    const quotes = pack.text.split('\n\n').filter((b) => b.startsWith('>'));
    expect(quotes.length).toBeGreaterThan(15);
    for (const q of quotes) expect(corpus.some((c) => c.includes(unquote(q))), q).toBe(true);
    expect(tree(path.join(copy.vault, 'Librarian', 'Source packs'))).toEqual([]);

    const small = await call('vault_build_source_pack', { topic: 'cycles', max_sources: 4, excerpts_per_source: 1, source_offset: 2 });
    expect(small.text).toContain('Showing sources 3 to 4 of 4');
    expect((await call('vault_build_source_pack', { topic: 'cycles', source_offset: 99 })).isError).toBe(true);

    const saved = await call('vault_build_source_pack', { topic: 'desire', write: true });
    expect(saved.text).toContain('Saved to Librarian/Source packs/desire 2026-11-23.md.');
    expect(tree(path.join(copy.vault, 'Librarian', 'Source packs'))).toEqual(['desire 2026-11-23.md']);
    const adhoc = await call('vault_build_source_pack', { topic: 'sourdough bread #cooking' });
    expect(adhoc.text).toContain('#### [[Sourdough starter]]');
    const nothing = await call('vault_build_source_pack', { topic: 'xylophone' });
    expect(nothing.isError).toBe(true);
    expect(nothing.text).toContain('Try other words');
  });

  it('sees a note added while the server is running', async () => {
    fs.writeFileSync(path.join(copy.vault, 'Notes', 'Xylophone.md'), '# Xylophone\n\nA note about a xylophone, added while the server runs.\n');
    await new Promise((resolve) => setTimeout(resolve, 2100)); // the server re-walks the vault at most every two seconds
    const found = await call('vault_search_notes', { query: 'xylophone', response_format: 'json' });
    expect((found.data!.notes as { path: string }[]).map((n) => n.path)).toEqual(['Notes/Xylophone.md']);
  });

  it('offers prompts for the weekly review and for each essay topic', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['source_pack', 'source_pack_cycles', 'source_pack_desire', 'weekly_review']);
    const weekly = await client.getPrompt({ name: 'weekly_review' });
    expect((weekly.messages[0].content as { text: string }).text).toContain('vault_weekly_links with write=true');
    const desire = await client.getPrompt({ name: 'source_pack_desire' });
    expect((desire.messages[0].content as { text: string }).text).toContain('topic="desire"');
    const custom = await client.getPrompt({ name: 'source_pack', arguments: { topic: 'boredom' } });
    expect((custom.messages[0].content as { text: string }).text).toContain('topic="boredom"');
  });

  it('wrote only inside the output folder and the cache', () => {
    const written = tree(copy.vault).filter((f) => f.startsWith('Librarian'));
    expect(written).toEqual(['Librarian/Source packs/desire 2026-11-23.md', 'Librarian/Weekly links/2026-W48.md', 'Librarian/librarian-state.json']);
    expect(tree(copy.root).filter((f) => !f.startsWith('vault') && !f.startsWith('cache'))).toEqual(['outside.md']);
  });
});
