import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildConfig } from '../src/config.js';
import { buildIndex, cacheFileFor, findNote, linkTarget, wikilink } from '../src/indexer.js';
import { cleanup, copyFixture, fixtureConfig, loadFixture, miniIndex } from './helpers.js';

afterAll(cleanup);

describe('walking the vault', () => {
  const { index, copy, config } = loadFixture();
  const paths = index.notes.map((n) => n.path);

  it('indexes notes and attachments and skips .obsidian, .trash, ignored globs and the config file', () => {
    expect(index.notes).toHaveLength(35);
    expect(index.attachments).toEqual(['Attachments/cycle-diagram.svg', 'Attachments/debt-chart.png']);
    expect(paths.some((p) => p.startsWith('Templates/') || p.startsWith('.'))).toBe(false);
    expect(paths).toContain('Notes/Türkçe/Işık ve gölge.md');
    expect(paths).toContain('Notes/Empty.md');
  });

  it('never indexes its own output folder', () => {
    fs.mkdirSync(path.join(copy.vault, 'Librarian', 'Weekly links'), { recursive: true });
    fs.writeFileSync(path.join(copy.vault, 'Librarian', 'Weekly links', '2026-W01.md'), '[[Mimetic desire]] and [[Hype cycle]]');
    const again = buildIndex(config, { cache: false });
    expect(again.notes).toHaveLength(35);
    expect(again.backlinks.get('Notes/Cycles/Hype cycle.md')).toEqual([]);
    fs.rmSync(path.join(copy.vault, 'Librarian'), { recursive: true });
  });

  it('never follows symlinks, whether they point outside or inside the vault', () => {
    const outside = path.join(copy.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'Secret.md'), '# Secret\n\nMust not be read. [[Mimetic desire]]');
    fs.symlinkSync(outside, path.join(copy.vault, 'Linked folder'));
    fs.symlinkSync(path.join(outside, 'Secret.md'), path.join(copy.vault, 'Notes', 'Linked note.md'));
    const again = buildIndex(config, { cache: false });
    expect(again.notes).toHaveLength(35);
    expect(again.stats.skippedSymlinks).toBe(2);
    expect(again.notes.some((n) => n.body.includes('Must not be read'))).toBe(false);
    fs.rmSync(path.join(copy.vault, 'Linked folder'));
    fs.rmSync(path.join(copy.vault, 'Notes', 'Linked note.md'));
  });

  it('takes dates from frontmatter first, then the daily-note file name, then file times', () => {
    const mimetic = index.byPath.get('Notes/Desire/Mimetic desire.md')!;
    expect([mimetic.created, mimetic.createdFrom, mimetic.modified, mimetic.modifiedFrom]).toEqual(['2023-04-11', 'frontmatter', '2024-02-18', 'frontmatter']);
    const daily = index.byPath.get('Daily/2026-11-17.md')!;
    expect([daily.created, daily.createdFrom, daily.isDaily]).toEqual(['2026-11-17', 'filename', true]);
    expect(daily.modified).toBe('2026-11-17'); // the file time (2025-01-15) is older than the day in its name
    const empty = index.byPath.get('Notes/Empty.md')!;
    expect([empty.created, empty.createdFrom, empty.modified, empty.modifiedFrom, empty.wordCount]).toEqual(['2025-01-15', 'file', '2025-01-15', 'file', 0]);
  });
});

describe('link resolution on the fixture vault', () => {
  const { index } = loadFixture();
  const out = (from: string) => index.outgoing.get(from)!;
  const target = (from: string, written: string) => out(from).find((l) => l.raw.target === written)!;

  it('resolves a bare name to the note beside the source when names clash', () => {
    expect(target('Essays/Desire essay outline.md', 'Index').to).toBe('Notes/Cycles/Index.md'); // neither is beside it: shortest path, then alphabetical
    expect(target('Essays/Cycles essay outline.md', 'Notes/Cycles/Index')).toMatchObject({ to: 'Notes/Cycles/Index.md', via: 'path' });
    const mini = miniIndex({ 'A/Index.md': 'a', 'B/Index.md': 'b', 'Index.md': 'root', 'B/From.md': '[[Index]]', 'C/From.md': '[[Index]] [[A/Index]] [[b/index]]' });
    expect(mini.outgoing.get('B/From.md')![0].to).toBe('B/Index.md');
    expect(mini.outgoing.get('C/From.md')!.map((l) => l.to)).toEqual(['Index.md', 'A/Index.md', 'B/Index.md']);
  });

  it('resolves aliases, markdown links, headings and block references', () => {
    expect(target('Notes/Türkçe/Borç döngüsü.md', 'debt supercycle')).toMatchObject({ to: 'Notes/Cycles/Long debt cycle.md', via: 'alias' });
    expect(target('Notes/Cycles/Commodity supercycle.md', 'Kondratiev waves.md')).toMatchObject({ to: 'Notes/Cycles/Kondratiev waves.md', via: 'path' });
    expect(target('Essays/Cycles essay outline.md', 'Kondratiev waves').raw.alias).toBe('long waves');
    const del = out('Notes/Cycles/Deleveraging.md');
    expect(del.map((l) => [l.to, l.raw.subpath, l.anchorOk, l.raw.embed])).toEqual([
      ['Notes/Cycles/Long debt cycle.md', '^debt-def', true, false],
      ['Notes/Cycles/Minsky moment.md', 'The moment', true, false],
      ['Notes/Cycles/Minsky moment.md', 'Three stages', true, true],
    ]);
    const tr = out('Notes/Türkçe/Arzu ve taklit.md');
    expect(tr.map((l) => [l.raw.subpath, l.anchorOk])).toEqual([
      ['Rivalry', true],
      ['Nonexistent heading', false],
    ]);
  });

  it('resolves embeds of attachments and does not call them unresolved', () => {
    expect(target('Notes/Cycles/Long debt cycle.md', 'debt-chart.png')).toMatchObject({ to: null, attachment: 'Attachments/debt-chart.png' });
    expect(index.unresolved.filter((u) => u.attachment)).toEqual([]);
    const mini = miniIndex({ 'a.md': '![[missing.png]] [[Missing note]]' });
    expect(mini.unresolved.map((u) => [u.target, u.attachment])).toEqual([
      ['Missing note', false],
      ['missing.png', true],
    ]);
  });

  it('builds backlinks and lists unresolved targets by how many notes point at them', () => {
    expect(index.backlinks.get('Notes/Cycles/Minsky moment.md')!.map((l) => l.from).sort()).toEqual([
      'Essays/Cycles essay outline.md',
      'Notes/Cycles/Deleveraging.md',
      'Notes/Cycles/Deleveraging.md',
      'Notes/Cycles/Index.md',
      'Notes/Cycles/Long debt cycle.md',
      'Notes/Cycles/Speculative manias.md',
      'Reading/Reading list.md',
    ]);
    expect(index.unresolved.map((u) => [u.target, u.sources.length])).toEqual([
      ['Positional goods', 4],
      ['Reflexivity', 3],
      ['Dutch disease', 1],
    ]);
    expect([...index.neighbours.get('Notes/Desire/Envy and the neighbour.md')!]).toEqual([]);
    expect(index.neighbours.get('Notes/Cycles/Hype cycle.md')!.size).toBe(0);
  });

  it('ignores links inside code and in the trash', () => {
    expect(out('Notes/Snippets/Regex cheatsheet.md')).toEqual([]);
    expect(index.backlinks.get('Notes/Desire/Mimetic desire.md')!.some((l) => l.from.includes('trash'))).toBe(false);
  });

  it('does not let a relative link climb out of the vault', () => {
    const mini = miniIndex({ 'a/From.md': '[up](../../etc/passwd.md) [[../../Outside]] [ok](../b/To.md)', 'b/To.md': 'x' });
    expect(mini.outgoing.get('a/From.md')!.map((l) => l.to)).toEqual([null, null, 'b/To.md']);
  });

  it('finds notes by path, name or alias and reports ambiguity', () => {
    expect(findNote(index, 'Notes/Cycles/Minsky moment.md').note?.basename).toBe('Minsky moment');
    expect(findNote(index, 'minsky moment').note?.path).toBe('Notes/Cycles/Minsky moment.md');
    expect(findNote(index, 'financial instability hypothesis').note?.path).toBe('Notes/Cycles/Minsky moment.md');
    expect(findNote(index, 'ışık ve gölge').note?.path).toBe('Notes/Türkçe/Işık ve gölge.md');
    const ambiguous = findNote(index, 'Index');
    expect(ambiguous.note).toBeNull();
    expect(ambiguous.candidates.map((c) => c.path)).toEqual(['Notes/Cycles/Index.md', 'Notes/Desire/Index.md']);
    expect(findNote(index, 'No such note')).toEqual({ note: null, candidates: [] });
  });

  it('writes links that Obsidian resolves to the same note', () => {
    const dup = index.byPath.get('Notes/Desire/Index.md')!;
    const plain = index.byPath.get('Notes/Desire/Mimetic desire.md')!;
    expect(linkTarget(index, dup)).toBe('Notes/Desire/Index');
    expect(wikilink(index, dup)).toBe('[[Notes/Desire/Index|Index]]');
    expect(wikilink(index, plain)).toBe('[[Mimetic desire]]');
    expect(wikilink(index, plain, 'Rivalry')).toBe('[[Mimetic desire#Rivalry|Mimetic desire › Rivalry]]');
    expect(wikilink(index, plain, 'Mimetic desire')).toBe('[[Mimetic desire]]'); // its own top heading
  });
});

describe('index cache', () => {
  it('re-uses unchanged notes, re-parses changed ones and lives outside the vault', () => {
    const copy = copyFixture();
    const config = fixtureConfig(copy);
    const first = buildIndex(config);
    expect([first.stats.parsed, first.stats.reused]).toEqual([35, 0]);
    const file = cacheFileFor(config);
    expect(file.startsWith(copy.cache)).toBe(true);
    expect(path.relative(copy.vault, file).startsWith('..')).toBe(true);
    expect(fs.statSync(file).mode & 0o077).toBe(0);

    const second = buildIndex(config);
    expect([second.stats.parsed, second.stats.reused]).toEqual([0, 35]);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.notes.map((n) => [n.path, n.modified, n.tags, n.links.length])).toEqual(first.notes.map((n) => [n.path, n.modified, n.tags, n.links.length]));

    fs.appendFileSync(path.join(copy.vault, 'Notes', 'Bike maintenance.md'), '\nNew line with [[Sourdough starter]].\n');
    fs.rmSync(path.join(copy.vault, 'Notes', 'Empty.md'));
    const third = buildIndex(config);
    expect([third.stats.parsed, third.stats.reused, third.stats.removed]).toEqual([1, 33, 1]);
    expect(third.fingerprint).not.toBe(first.fingerprint);
    expect(third.neighbours.get('Notes/Bike maintenance.md')!.has('Notes/Sourdough starter.md')).toBe(true);

    fs.writeFileSync(file, '{ not json');
    expect(buildIndex(config).stats.parsed).toBe(34); // a damaged cache is rebuilt, not fatal
  });

  it('respects ignore globs from the config', () => {
    const copy = copyFixture();
    const config = buildConfig(copy.vault, { ignore: ['Daily', '*.svg', 'Notes/**/Index.md'], cacheDir: copy.cache });
    const index = buildIndex(config, { cache: false });
    expect(index.notes.some((n) => n.path.startsWith('Daily/') || n.path.endsWith('Index.md'))).toBe(false);
    expect(index.notes.some((n) => n.path.startsWith('Templates/'))).toBe(true); // no longer ignored
    expect(index.attachments).toEqual(['Attachments/debt-chart.png']);
  });
});
