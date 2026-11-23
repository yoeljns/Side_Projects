import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildConfig, ConfigError, loadConfig } from '../src/config.js';
import { Librarian, NoteNotFoundError } from '../src/librarian.js';
import { cleanRelative, globToRegExp, PathError, resolveInside, safeFileName } from '../src/paths.js';
import { cleanup, copyFixture, fixtureConfig, TODAY } from './helpers.js';

afterAll(cleanup);

/** Every file under a folder, relative, sorted. */
function tree(dir: string, base = dir): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? tree(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]))
    .sort();
}

describe('path checks', () => {
  it('refuses absolute paths, drive letters, home shortcuts, NUL bytes and any ".." segment', () => {
    for (const bad of ['/etc/passwd', '../outside.md', 'Notes/../../outside.md', 'a/b/../../../c', '..', 'C:\\Windows\\x.md', '~/secrets.md', 'Notes\\..\\..\\x', 'a\0b']) {
      expect(() => cleanRelative(bad), bad).toThrow(PathError);
    }
    expect(cleanRelative('./Notes//Cycles/./Index.md')).toBe('Notes/Cycles/Index.md');
    expect(cleanRelative('Notes\\Cycles\\Index.md')).toBe('Notes/Cycles/Index.md');
    expect(cleanRelative('Notes/a..b/c...md')).toBe('Notes/a..b/c...md'); // dots inside a name are fine
  });

  it('proves a resolved path is inside the root even through symlinks', () => {
    const copy = copyFixture();
    const outside = path.join(copy.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.md'), 'secret');
    fs.symlinkSync(outside, path.join(copy.vault, 'Escape'));
    expect(resolveInside(copy.vault, 'Notes/Empty.md')).toBe(path.join(fs.realpathSync(copy.vault), 'Notes', 'Empty.md'));
    expect(resolveInside(copy.vault, 'Librarian/Weekly links/new.md')).toContain(`${path.sep}Librarian${path.sep}`); // not there yet: still fine
    expect(() => resolveInside(copy.vault, 'Escape/secret.md')).toThrow(/leaves the vault/);
    expect(() => resolveInside(copy.vault, 'Escape/new folder/new.md')).toThrow(/leaves the vault/);
    expect(() => resolveInside(copy.vault, '../outside/secret.md')).toThrow(PathError);
  });

  it('makes safe file names', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n')).toBe('a b c d e f g h i j k l m n');
    expect(safeFileName('../../etc/passwd')).toBe('etc passwd');
    expect(safeFileName('   ')).toBe('untitled');
    expect(safeFileName('Borç döngüsü: İstanbul')).toBe('Borç döngüsü İstanbul');
    expect(safeFileName('x'.repeat(200), 60)).toHaveLength(60);
  });

  it('matches ignore globs', () => {
    expect(globToRegExp('Templates/**').test('Templates/a/b.md')).toBe(true);
    expect(globToRegExp('Templates').test('Templates/a.md')).toBe(true);
    expect(globToRegExp('Templates').test('Notes/Templates/a.md')).toBe(true); // no slash: any depth
    expect(globToRegExp('Templates/**').test('Notes/Templates/a.md')).toBe(false);
    expect(globToRegExp('*.canvas').test('Boards/Plan.canvas')).toBe(true);
    expect(globToRegExp('Notes/*/Index.md').test('Notes/Cycles/Index.md')).toBe(true);
    expect(globToRegExp('Notes/*/Index.md').test('Notes/a/b/Index.md')).toBe(false);
    expect(globToRegExp('Notes/**/Index.md').test('Notes/a/b/Index.md')).toBe(true);
    expect(globToRegExp('Daily/2026-1?-*').test('Daily/2026-11-17.md')).toBe(true);
    expect(globToRegExp('a.b').test('aXb')).toBe(false);
  });
});

describe('config', () => {
  it('refuses an output folder outside the vault, at its root, or hidden', () => {
    const copy = copyFixture();
    for (const bad of ['../Librarian', '/tmp/out', '.', '.obsidian/librarian', 'Notes/../../x']) {
      expect(() => buildConfig(copy.vault, { outputFolder: bad }), bad).toThrow(ConfigError);
    }
    expect(buildConfig(copy.vault, { outputFolder: 'Meta/Librarian/' }).outputFolder).toBe('Meta/Librarian');
  });

  it('names the field when the config file is wrong', () => {
    const copy = copyFixture();
    expect(() => buildConfig(copy.vault, { weekly: { oldAfterDays: 0 } })).toThrow(/weekly\.oldAfterDays/);
    expect(() => buildConfig(copy.vault, { outputFolderr: 'x' })).toThrow(/outputFolderr/);
    expect(() => buildConfig(copy.vault, { topics: { 'Bad Name': {} } })).toThrow(/topics/);
    fs.writeFileSync(path.join(copy.vault, 'vault-librarian.config.json'), '{ broken');
    expect(() => fixtureConfig(copy)).toThrow(ConfigError);
  });

  it('finds the vault from --vault, VAULT_PATH, a config file, or the working folder', () => {
    const copy = copyFixture();
    const real = fs.realpathSync(copy.vault);
    expect(loadConfig({ vault: copy.vault, env: {} }).vault).toBe(real);
    expect(loadConfig({ env: { VAULT_PATH: copy.vault } }).vault).toBe(real);
    expect(loadConfig({ env: {}, cwd: copy.vault }).vault).toBe(real); // holds vault-librarian.config.json
    const external = path.join(copy.root, 'elsewhere.json');
    fs.writeFileSync(external, JSON.stringify({ vault: './vault', outputFolder: 'Out' }));
    const viaFile = loadConfig({ configFile: external, env: {}, cwd: copy.root });
    expect([viaFile.vault, viaFile.outputFolder, viaFile.configPath]).toEqual([real, 'Out', external]);
    expect(() => loadConfig({ env: {}, cwd: copy.root })).toThrow(/No vault given/);
    expect(() => loadConfig({ vault: path.join(copy.root, 'missing'), env: {} })).toThrow(/not found/);
    expect(loadConfig({ vault: copy.vault, env: { XDG_CACHE_HOME: '/x/cache' } }).cacheDir).toBe('/x/cache/vault-librarian');
  });

  it('merges topics from the file over the built-in ones', () => {
    const copy = copyFixture();
    const c = fixtureConfig(copy);
    expect(c.topics.desire.seedNotes).toEqual(['Mimetic desire', 'Desire as lack']);
    expect(c.topics.cycles.subThemes.map((s) => s.name)).toEqual(['Debt', 'Commodities', 'Technology']);
    const extra = buildConfig(copy.vault, { topics: { boredom: { seedTags: ['boredom'] } } });
    expect(Object.keys(extra.topics)).toEqual(['desire', 'cycles', 'boredom']);
    expect(extra.topics.boredom.title).toBe('Boredom');
  });
});

describe('the librarian only writes in its output folder', () => {
  it('refuses note references that leave the vault', () => {
    const copy = copyFixture();
    fs.writeFileSync(path.join(copy.root, 'outside.md'), '# Outside\n\nNot in the vault.');
    const librarian = new Librarian(fixtureConfig(copy), { cache: false });
    for (const bad of ['../outside.md', '../outside', '/etc/passwd', 'Notes/../../outside.md', path.join(copy.root, 'outside.md'), '..\\outside.md', 'C:\\x.md']) {
      expect(() => librarian.note(bad), bad).toThrow(NoteNotFoundError);
    }
    expect(() => librarian.note('.obsidian/app.json')).toThrow(/No note called/);
    expect(() => librarian.note('.trash/Old draft')).toThrow(/No note called/);
    expect(() => librarian.note('Index')).toThrow(/matches 2 notes.*Notes\/Cycles\/Index\.md/);
    expect(librarian.readNote(librarian.note('Mimetic desire'))).toContain('# Mimetic desire');
  });

  it('writes reports, packs and state under the output folder and touches nothing else', () => {
    const copy = copyFixture();
    const before = tree(copy.vault);
    const stamp = (files: string[]) => files.map((f) => `${f}:${fs.statSync(path.join(copy.vault, f)).mtimeMs}:${fs.statSync(path.join(copy.vault, f)).size}`);
    const beforeStamp = stamp(before);
    const librarian = new Librarian(fixtureConfig(copy), { refreshMs: 0 });
    const weekly = librarian.weekly({ today: TODAY, write: true });
    librarian.pack('cycles', { today: TODAY, write: true });
    librarian.pack('wanting and liking', { today: TODAY, write: true });
    librarian.dismiss({ id: weekly.report.pairs[0].id }, { today: TODAY });
    const after = tree(copy.vault);
    expect(after.filter((f) => !before.includes(f))).toEqual([
      'Librarian/Source packs/cycles 2026-11-23.md',
      'Librarian/Source packs/wanting and liking 2026-11-23.md',
      'Librarian/Weekly links/2026-W48.md',
      'Librarian/librarian-state.json',
    ]);
    expect(stamp(before)).toEqual(beforeStamp); // no note was modified
    expect(tree(copy.cache)).toHaveLength(1); // the index cache, outside the vault
    expect(tree(copy.root).filter((f) => !f.startsWith('vault') && !f.startsWith('cache'))).toEqual([]);
  });

  it('refuses to write when the output folder is a symlink out of the vault', () => {
    const copy = copyFixture();
    const outside = path.join(copy.root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(copy.vault, 'Librarian'));
    const librarian = new Librarian(fixtureConfig(copy), { cache: false });
    expect(() => librarian.weekly({ today: TODAY, write: true })).toThrow(/leaves the vault/);
    expect(() => librarian.pack('desire', { today: TODAY, write: true })).toThrow(/leaves the vault/);
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(librarian.weekly({ today: TODAY }).report.pairs.length).toBeGreaterThan(0); // reading still works
  });

  it('honours a different output folder', () => {
    const copy = copyFixture();
    const config = buildConfig(copy.vault, { outputFolder: 'Meta/Librarian', cacheDir: copy.cache });
    const librarian = new Librarian(config, { cache: false });
    expect(librarian.weekly({ today: TODAY, write: true }).written).toBe('Meta/Librarian/Weekly links/2026-W48.md');
    expect(fs.existsSync(path.join(copy.vault, 'Librarian'))).toBe(false);
    expect(librarian.load(true).index.notes.some((n) => n.path.startsWith('Meta/'))).toBe(false);
  });
});
