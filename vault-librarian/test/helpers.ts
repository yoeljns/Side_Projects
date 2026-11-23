import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from '../src/config.js';
import { buildIndex, link, type Note, type VaultIndex } from '../src/indexer.js';
import { parseNote } from '../src/parse.js';
import { buildModel, type Model } from '../src/similarity.js';

export const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'vault');
/** The date the fixture vault is written around: a Monday, ISO week 2026-W48. */
export const TODAY = '2026-11-23';

const made: string[] = [];

/**
 * Copies the fixture vault to a temp folder and gives every file the same old mtime, so dates that fall
 * back to file times do not depend on when the repository was checked out.
 */
export function copyFixture(): { root: string; vault: string; cache: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-librarian-'));
  made.push(root);
  const vault = path.join(root, 'vault');
  fs.cpSync(FIXTURE, vault, { recursive: true });
  fs.rmSync(path.join(vault, 'Librarian'), { recursive: true, force: true });
  const old = new Date('2025-01-15T12:00:00Z');
  const touch = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) touch(p);
      else fs.utimesSync(p, old, old);
    }
  };
  touch(vault);
  return { root, vault, cache: path.join(root, 'cache') };
}

export function cleanup(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function fixtureConfig(copy: { vault: string; cache: string }): Config {
  return loadConfig({ vault: copy.vault, env: { XDG_CACHE_HOME: copy.cache }, cwd: copy.vault });
}

export function loadFixture(): { copy: ReturnType<typeof copyFixture>; config: Config; index: VaultIndex; model: Model } {
  const copy = copyFixture();
  const config = fixtureConfig(copy);
  const index = buildIndex(config, { cache: false });
  return { copy, config, index, model: buildModel(index, config) };
}

/** Builds an index from note texts alone, for hand-checked cases. */
export function miniIndex(files: Record<string, string | { text: string; modified?: string; created?: string }>, attachments: string[] = []): VaultIndex {
  const notes: Note[] = Object.entries(files).map(([p, value]) => {
    const spec = typeof value === 'string' ? { text: value } : value;
    const parsed = parseNote(spec.text);
    const basename = p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');
    const modified = spec.modified ?? parsed.frontmatterModified ?? '2024-01-01';
    return {
      ...parsed,
      path: p,
      basename,
      folder: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '',
      title: parsed.frontmatterTitle ?? basename,
      created: spec.created ?? parsed.frontmatterCreated ?? modified,
      createdFrom: 'frontmatter',
      modified,
      modifiedFrom: 'frontmatter',
      mtimeMs: 0,
      size: spec.text.length,
      isDaily: false,
    };
  });
  return link('/mini', notes, attachments);
}
