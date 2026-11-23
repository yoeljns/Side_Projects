// Walks the vault, parses notes (re-using a cache keyed by mtime and size), resolves links and builds the graph.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { CONFIG_FILE } from './config.js';
import { isIsoDate, localDate } from './dates.js';
import { parseNote, type ParsedNote, type RawLink } from './parse.js';
import { globToRegExp, toPosix, writeFileAtomic } from './paths.js';
import { fold } from './text.js';

/** Bump when parseNote's output changes shape or meaning, so stale caches are thrown away. */
const CACHE_VERSION = 4;

export type DateSource = 'frontmatter' | 'filename' | 'file';

export interface Note extends ParsedNote {
  /** Vault-relative path with forward slashes, e.g. 'Notes/Cycles/Minsky moment.md'. */
  path: string;
  /** File name without '.md': what Obsidian shows and what links use. */
  basename: string;
  folder: string;
  /** Frontmatter title, else the basename. */
  title: string;
  created: string;
  createdFrom: DateSource;
  modified: string;
  modifiedFrom: DateSource;
  mtimeMs: number;
  size: number;
  isDaily: boolean;
}

export interface ResolvedLink {
  from: string;
  /** Path of the note the link points at, or null. */
  to: string | null;
  /** Path of the attachment the link points at, or null. */
  attachment: string | null;
  /** How the note was found. 'alias' is a librarian extension: Obsidian itself only matches file names. */
  via: 'self' | 'path' | 'basename' | 'alias' | null;
  /** False when the note exists but the #heading or ^block does not. */
  anchorOk: boolean;
  raw: RawLink;
}

export interface Unresolved {
  /** Target as first written. */
  target: string;
  sources: string[];
  /** True when the target looks like a file (image, PDF) rather than a note waiting to be written. */
  attachment: boolean;
}

export interface IndexStats {
  parsed: number;
  reused: number;
  removed: number;
  skippedSymlinks: number;
  cacheFile: string | null;
  ms: number;
}

export interface VaultIndex {
  root: string;
  /** Notes sorted by path. */
  notes: Note[];
  byPath: Map<string, Note>;
  attachments: string[];
  outgoing: Map<string, ResolvedLink[]>;
  backlinks: Map<string, ResolvedLink[]>;
  /** Distinct notes linked to or from each note (links in either direction, self-links left out). */
  neighbours: Map<string, Set<string>>;
  unresolved: Unresolved[];
  /** Changes when any note changes; lets callers cache work derived from the index. */
  fingerprint: string;
  stats: IndexStats;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: ParsedNote;
}

interface CacheFile {
  version: number;
  root: string;
  notes: Record<string, CacheEntry>;
}

const ATTACHMENT_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif|pdf|mp3|mp4|wav|m4a|mov|webm|ogg|flac|canvas|base|csv|xlsx?|docx?|pptx?|zip|excalidraw)$/i;

const key = (s: string) => s.normalize('NFC').toLowerCase();

export function cacheFileFor(config: Config): string {
  const id = createHash('sha256').update(config.vault).digest('hex').slice(0, 16);
  return path.join(config.cacheDir, `index-${id}.json`);
}

interface Walked {
  rel: string;
  abs: string;
  stat: fs.Stats;
}

function walk(config: Config): { notes: Walked[]; attachments: string[]; skippedSymlinks: number } {
  const ignore = config.ignore.map(globToRegExp);
  const output = config.outputFolder.toLowerCase();
  const notes: Walked[] = [];
  const attachments: string[] = [];
  let skippedSymlinks = 0;

  const visit = (dirAbs: string, dirRel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return; // unreadable folder: leave it out rather than fail the whole index
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue; // .obsidian, .trash, .git …
      const rel = toPosix(dirRel ? `${dirRel}/${entry.name}` : entry.name);
      const abs = path.join(dirAbs, entry.name);
      if (entry.isSymbolicLink()) {
        skippedSymlinks++; // never followed: a link could point outside the vault
        continue;
      }
      if (rel.toLowerCase() === output || ignore.some((re) => re.test(rel))) continue;
      if (entry.isDirectory()) {
        visit(abs, rel);
      } else if (entry.isFile()) {
        if (rel === CONFIG_FILE) continue;
        if (/\.md$/i.test(entry.name)) {
          try {
            notes.push({ rel, abs, stat: fs.statSync(abs) });
          } catch {
            /* vanished while walking */
          }
        } else attachments.push(rel);
      }
    }
  };
  visit(config.vault, '');
  return { notes, attachments, skippedSymlinks };
}

function loadCache(file: string, root: string): CacheFile | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheFile;
    if (data.version !== CACHE_VERSION || data.root !== root || typeof data.notes !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

export interface BuildOptions {
  /** Read and write the on-disk cache (default true). */
  cache?: boolean;
  /** Called with problems that do not stop indexing (unreadable file, cache not writable). */
  warn?: (message: string) => void;
}

export function buildIndex(config: Config, options: BuildOptions = {}): VaultIndex {
  const started = performance.now();
  const useCache = options.cache !== false;
  const cacheFile = useCache ? cacheFileFor(config) : null;
  const cached = cacheFile ? loadCache(cacheFile, config.vault) : null;
  const { notes: files, attachments, skippedSymlinks } = walk(config);

  const nextCache: CacheFile = { version: CACHE_VERSION, root: config.vault, notes: {} };
  const notes: Note[] = [];
  let parsedCount = 0;
  let reused = 0;
  const daily = config.dailyNotesFolder?.toLowerCase() ?? null;

  for (const file of files) {
    const hit = cached?.notes[file.rel];
    let parsed: ParsedNote;
    if (hit && hit.mtimeMs === file.stat.mtimeMs && hit.size === file.stat.size) {
      parsed = hit.parsed;
      reused++;
    } else {
      try {
        parsed = parseNote(fs.readFileSync(file.abs, 'utf8'));
      } catch (e) {
        options.warn?.(`Skipped ${file.rel}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      parsedCount++;
    }
    nextCache.notes[file.rel] = { mtimeMs: file.stat.mtimeMs, size: file.stat.size, parsed };

    const basename = file.rel.slice(file.rel.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    const folder = file.rel.includes('/') ? file.rel.slice(0, file.rel.lastIndexOf('/')) : '';
    const inDaily = daily !== null && (folder.toLowerCase() === daily || folder.toLowerCase().startsWith(`${daily}/`));
    const nameDate = isIsoDate(basename.slice(0, 10)) && (inDaily || basename.length === 10) ? basename.slice(0, 10) : null;
    const birth = file.stat.birthtimeMs > 0 && file.stat.birthtimeMs <= file.stat.mtimeMs ? file.stat.birthtimeMs : file.stat.mtimeMs;

    const modified = parsed.frontmatterModified ?? localDate(file.stat.mtimeMs);
    let created = parsed.frontmatterCreated ?? nameDate ?? localDate(birth);
    if (created > modified) created = parsed.frontmatterCreated || nameDate ? created : modified;

    notes.push({
      ...parsed,
      path: file.rel,
      basename,
      folder,
      title: parsed.frontmatterTitle ?? basename,
      created,
      createdFrom: parsed.frontmatterCreated ? 'frontmatter' : nameDate ? 'filename' : 'file',
      modified: modified < created ? created : modified,
      modifiedFrom: parsed.frontmatterModified ? 'frontmatter' : 'file',
      mtimeMs: file.stat.mtimeMs,
      size: file.stat.size,
      isDaily: inDaily || nameDate !== null,
    });
  }

  const removed = cached ? Object.keys(cached.notes).filter((p) => !(p in nextCache.notes)).length : 0;
  if (cacheFile && (parsedCount > 0 || removed > 0 || !cached)) {
    try {
      writeFileAtomic(cacheFile, JSON.stringify(nextCache), 0o600);
    } catch (e) {
      options.warn?.(`Could not write the index cache (${cacheFile}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const index = link(config.vault, notes, attachments);
  index.stats = { parsed: parsedCount, reused, removed, skippedSymlinks, cacheFile, ms: Math.round(performance.now() - started) };
  return index;
}

function anchorText(s: string): string {
  return s.replace(/[#|^:%[\]]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasAnchor(note: Note, subpath: string | null): boolean {
  if (!subpath) return true;
  if (subpath.startsWith('^')) return note.blockIds.includes(subpath.slice(1));
  const wanted = subpath.split('#').map(anchorText).filter(Boolean);
  let from = 0;
  for (const w of wanted) {
    const idx = note.headings.findIndex((h, i) => i >= from && anchorText(h.text) === w);
    if (idx === -1) return false;
    from = idx + 1;
  }
  return true;
}

/** Resolves links and builds the graph. Pure: takes notes and attachment paths, touches no files. */
export function link(root: string, notes: Note[], attachments: string[]): VaultIndex {
  notes = [...notes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const byPathKey = new Map<string, Note>();
  const byBasename = new Map<string, Note[]>();
  const byAlias = new Map<string, Note[]>();
  const push = <T>(map: Map<string, T[]>, k: string, v: T) => {
    const list = map.get(k);
    if (list) list.push(v);
    else map.set(k, [v]);
  };
  for (const n of notes) {
    byPathKey.set(key(n.path.replace(/\.md$/i, '')), n);
    push(byBasename, key(n.basename), n);
    for (const a of n.aliases) push(byAlias, key(a), n);
    if (n.frontmatterTitle && key(n.frontmatterTitle) !== key(n.basename)) push(byAlias, key(n.frontmatterTitle), n);
  }
  const attachmentByPath = new Map(attachments.map((a) => [key(a), a]));
  const attachmentByName = new Map<string, string[]>();
  for (const a of attachments) push(attachmentByName, key(a.slice(a.lastIndexOf('/') + 1)), a);

  const depth = (p: string) => p.split('/').length;
  /** Obsidian's tie-break for a bare name: the note beside the source, else the shortest path. */
  const best = <T extends { path: string }>(cands: T[], fromFolder: string): T =>
    [...cands].sort((a, b) => {
      const af = a.path.slice(0, Math.max(0, a.path.lastIndexOf('/'))) === fromFolder ? 0 : 1;
      const bf = b.path.slice(0, Math.max(0, b.path.lastIndexOf('/'))) === fromFolder ? 0 : 1;
      return af - bf || depth(a.path) - depth(b.path) || a.path.length - b.path.length || (a.path < b.path ? -1 : 1);
    })[0];

  const relativeTo = (folder: string, target: string): string | null => {
    const joined = path.posix.normalize(folder ? `${folder}/${target}` : target);
    return joined.startsWith('..') ? null : joined;
  };

  const resolveNote = (raw: RawLink, from: Note): { note: Note; via: ResolvedLink['via'] } | null => {
    let t = raw.target.replace(/\\/g, '/').normalize('NFC').trim().replace(/\.md$/i, '');
    if (!t) return { note: from, via: 'self' };
    const explicitRelative = t.startsWith('./') || t.startsWith('../');
    t = t.replace(/^\/+/, '');
    const rel = relativeTo(from.folder, t);
    const viaRelative = rel ? byPathKey.get(key(rel)) : undefined;
    if (explicitRelative) return viaRelative ? { note: viaRelative, via: 'path' } : null;
    if (raw.kind === 'markdown' && viaRelative) return { note: viaRelative, via: 'path' };
    if (t.includes('/')) {
      const exact = byPathKey.get(key(t));
      if (exact) return { note: exact, via: 'path' };
      if (viaRelative) return { note: viaRelative, via: 'path' };
      const suffix = `/${key(t)}`;
      const cands = notes.filter((n) => key(n.path.replace(/\.md$/i, '')).endsWith(suffix));
      return cands.length ? { note: best(cands, from.folder), via: 'path' } : null;
    }
    const named = byBasename.get(key(t));
    if (named) return { note: best(named, from.folder), via: 'basename' };
    const aliased = byAlias.get(key(t));
    if (aliased) return { note: best(aliased, from.folder), via: 'alias' };
    return null;
  };

  const resolveAttachment = (raw: RawLink, from: Note): string | null => {
    const t = raw.target.replace(/\\/g, '/').normalize('NFC').trim().replace(/^\/+/, '');
    if (!t) return null;
    const rel = relativeTo(from.folder, t);
    const direct = attachmentByPath.get(key(t)) ?? (rel ? attachmentByPath.get(key(rel)) : undefined);
    if (direct) return direct;
    if (t.includes('/')) {
      const suffix = `/${key(t)}`;
      const cands = attachments.filter((a) => key(a).endsWith(suffix)).map((p) => ({ path: p }));
      return cands.length ? best(cands, from.folder).path : null;
    }
    const named = attachmentByName.get(key(t));
    return named ? best(named.map((p) => ({ path: p })), from.folder).path : null;
  };

  const outgoing = new Map<string, ResolvedLink[]>();
  const backlinks = new Map<string, ResolvedLink[]>();
  const neighbours = new Map<string, Set<string>>();
  const unresolved = new Map<string, { target: string; sources: Set<string>; attachment: boolean }>();
  for (const n of notes) {
    outgoing.set(n.path, []);
    backlinks.set(n.path, []);
    neighbours.set(n.path, new Set());
  }

  for (const from of notes) {
    for (const raw of from.links) {
      const hit = resolveNote(raw, from);
      const attachment = hit ? null : resolveAttachment(raw, from);
      const resolved: ResolvedLink = {
        from: from.path,
        to: hit ? hit.note.path : null,
        attachment,
        via: hit ? hit.via : null,
        anchorOk: hit ? hasAnchor(hit.note, raw.subpath) : true,
        raw,
      };
      outgoing.get(from.path)!.push(resolved);
      if (hit) {
        if (hit.note.path !== from.path) {
          backlinks.get(hit.note.path)!.push(resolved);
          neighbours.get(from.path)!.add(hit.note.path);
          neighbours.get(hit.note.path)!.add(from.path);
        }
      } else if (!attachment) {
        const display = raw.target.replace(/\.md$/i, '').trim();
        const k = key(display.replace(/^\/+/, ''));
        const entry = unresolved.get(k) ?? { target: display, sources: new Set<string>(), attachment: ATTACHMENT_EXT.test(display) };
        entry.sources.add(from.path);
        unresolved.set(k, entry);
      }
    }
  }

  const fingerprint = createHash('sha256')
    .update(notes.map((n) => `${n.path}\0${n.mtimeMs}\0${n.size}`).join('\n'))
    .update(attachments.join('\n'))
    .digest('hex')
    .slice(0, 16);

  return {
    root,
    notes,
    byPath,
    attachments: [...attachments].sort(),
    outgoing,
    backlinks,
    neighbours,
    unresolved: [...unresolved.values()]
      .map((u) => ({ target: u.target, sources: [...u.sources].sort(), attachment: u.attachment }))
      .sort((a, b) => b.sources.length - a.sources.length || (a.target < b.target ? -1 : 1)),
    fingerprint,
    stats: { parsed: 0, reused: 0, removed: 0, skippedSymlinks: 0, cacheFile: null, ms: 0 },
  };
}

/**
 * Finds the note a caller means: an exact vault path, or a name resolved the way a [[link]] would be.
 * Returns the candidates when a bare name is ambiguous.
 */
export function findNote(index: VaultIndex, ref: string): { note: Note | null; candidates: Note[] } {
  const cleaned = ref.replace(/\\/g, '/').normalize('NFC').trim().replace(/^\[\[|\]\]$/g, '').replace(/^\/+/, '');
  const withoutExt = cleaned.replace(/\.md$/i, '');
  const exact = index.notes.find((n) => key(n.path.replace(/\.md$/i, '')) === key(withoutExt));
  if (exact) return { note: exact, candidates: [exact] };
  const k = key(withoutExt);
  const named = index.notes.filter((n) => key(n.basename) === k);
  if (named.length === 1) return { note: named[0], candidates: named };
  if (named.length > 1) return { note: null, candidates: named };
  const aliased = index.notes.filter((n) => n.aliases.some((a) => key(a) === k) || key(n.title) === k);
  if (aliased.length === 1) return { note: aliased[0], candidates: aliased };
  if (aliased.length > 1) return { note: null, candidates: aliased };
  const suffix = index.notes.filter((n) => key(n.path.replace(/\.md$/i, '')).endsWith(`/${k}`));
  if (suffix.length === 1) return { note: suffix[0], candidates: suffix };
  if (suffix.length > 1) return { note: null, candidates: suffix };
  // Last, forgive diacritics and the Turkish dotted/dotless i: 'isik ve golge' finds 'Işık ve gölge'.
  const f = fold(withoutExt);
  const loose = index.notes.filter((n) => fold(n.basename) === f || fold(n.path.replace(/\.md$/i, '')) === f);
  return { note: loose.length === 1 ? loose[0] : null, candidates: loose };
}

/** Link text that Obsidian resolves to exactly this note: the bare name when it is unique, else the full path. */
export function linkTarget(index: VaultIndex, note: Note): string {
  const k = key(note.basename);
  const clash = index.notes.some((n) => n.path !== note.path && key(n.basename) === k);
  return clash ? note.path.replace(/\.md$/i, '') : note.basename;
}

/** A wikilink to a note, optionally to one heading, readable when the path had to be spelled out. */
export function wikilink(index: VaultIndex, note: Note, heading?: string | null): string {
  const target = linkTarget(index, note);
  // The note's own top heading adds nothing: link to the note itself.
  if (heading && (heading === note.title || heading === note.basename || note.headings[0]?.text === heading)) heading = null;
  const anchor = heading ? `#${heading.replace(/[#|^[\]]/g, ' ').replace(/\s+/g, ' ').trim()}` : '';
  const label = heading ? `${note.title} › ${heading}` : note.title;
  const plain = `${target}${anchor}`;
  return plain === label ? `[[${plain}]]` : `[[${plain}|${label.replace(/[|\]]/g, ' ')}]]`;
}
