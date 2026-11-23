// Path safety. Everything the librarian reads is inside the vault; everything it writes is inside the
// vault's output folder or the cache directory.
import fs from 'node:fs';
import path from 'node:path';

export class PathError extends Error {}

/** Vault paths are stored with forward slashes and NFC-normalised so macOS (NFD) and Linux names compare equal. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/').normalize('NFC');
}

/**
 * Checks a vault-relative path given by a caller. Refuses absolute paths, drive letters, NUL bytes and
 * any '..' segment, and returns the cleaned forward-slash form.
 */
export function cleanRelative(input: string): string {
  if (typeof input !== 'string' || input.includes('\0')) throw new PathError('Path is not valid.');
  const unified = input.replace(/\\/g, '/').normalize('NFC');
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified) || unified.startsWith('~')) {
    throw new PathError(`Path must be relative to the vault root, got "${input}".`);
  }
  const parts = unified.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) {
    throw new PathError(`Path must stay inside the vault ("..": not allowed), got "${input}".`);
  }
  return parts.join('/');
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Real path of the deepest part of `p` that exists, with the missing tail re-attached. */
function realpathOfExisting(p: string): string {
  let current = p;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return p;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves a vault-relative path to an absolute one and proves, after following any symlinks that
 * exist on the way, that it is still inside `root`.
 */
export function resolveInside(root: string, relative: string): string {
  const clean = cleanRelative(relative);
  const realRoot = fs.realpathSync(root);
  const abs = path.resolve(realRoot, clean);
  if (!isInside(realRoot, abs) || !isInside(realRoot, realpathOfExisting(abs))) {
    throw new PathError(`Path leaves the vault: "${relative}".`);
  }
  return abs;
}

/** File names the librarian creates: no separators or characters Obsidian and Windows refuse. */
export function safeFileName(name: string, maxLength = 80): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#^[\]\0-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, maxLength)
    .trim();
  return cleaned || 'untitled';
}

/** Writes a file atomically (temp file, then rename), creating parent folders. `abs` must already be checked. */
export function writeFileAtomic(abs: string, content: string, mode?: number): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, mode === undefined ? 'utf8' : { encoding: 'utf8', mode });
  fs.renameSync(tmp, abs);
}

/** Minimal glob: '*' within a segment, '**' across segments, '?' one character. Matching ignores case. */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/').replace(/^\.?\//, '').normalize('NFC');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // 'Templates' or 'Templates/' also covers everything below it.
  // A pattern without a slash ('*.canvas', 'Archive') matches at any depth, as in .gitignore.
  const anyDepth = g.includes('/') ? '' : '(?:.*/)?';
  return new RegExp(`^${anyDepth}${re.replace(/\/$/, '')}(?:/.*)?$`, 'iu');
}
