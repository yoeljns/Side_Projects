// Markdown note parser for the parts of Obsidian's syntax the librarian needs. Pure: text in, facts out.
import { parse as parseYaml } from 'yaml';
import { coerceDate } from './dates.js';
import { lowerSurface, rawTokens } from './text.js';

export interface Heading {
  level: number;
  text: string;
  /** 1-based line in the file. */
  line: number;
}

export interface RawLink {
  kind: 'wikilink' | 'markdown';
  embed: boolean;
  /** Link path as written, without the #subpath. Empty for a link into the same note. */
  target: string;
  /** 'Heading', 'Heading#Sub' or '^block-id'. */
  subpath: string | null;
  alias: string | null;
  /** 1-based line in the file. */
  line: number;
}

export interface Passage {
  /** Headings above the passage, outermost first. */
  headingPath: string[];
  /** The block exactly as written in the note. */
  text: string;
  startLine: number;
  endLine: number;
  blockId: string | null;
  kind: 'paragraph' | 'list' | 'quote' | 'table';
}

export interface Task {
  text: string;
  line: number;
}

export interface ParsedNote {
  frontmatterTitle: string | null;
  aliases: string[];
  /** Lower-cased, without '#', frontmatter and inline together, sorted. */
  tags: string[];
  frontmatterCreated: string | null;
  frontmatterModified: string | null;
  frontmatterError: string | null;
  headings: Heading[];
  blockIds: string[];
  links: RawLink[];
  /** Unchecked '- [ ]' items. */
  tasks: Task[];
  /** Number of lines taken by the frontmatter block (0 when there is none). */
  bodyStartLine: number;
  /** The note without its frontmatter. */
  body: string;
  /** Prose for similarity: no code, no link syntax, no tags. */
  plainText: string;
  wordCount: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function splitFrontmatter(content: string): { yaml: string | null; body: string; bodyStartLine: number } {
  const text = content.startsWith('﻿') ? content.slice(1) : content;
  if (!/^---[ \t]*\r?\n/.test(text)) return { yaml: null, body: text, bodyStartLine: 0 };
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*\r?$/.test(lines[i])) {
      return {
        yaml: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
        bodyStartLine: i + 1,
      };
    }
  }
  return { yaml: null, body: text, bodyStartLine: 0 };
}

function blank(s: string): string {
  return s.replace(/[^\n]/g, ' ');
}

/** For each line: is it inside (or the delimiter of) a fenced code block? */
export function fencedLines(lines: string[]): boolean[] {
  const inFence: boolean[] = new Array(lines.length).fill(false);
  let open: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (open) {
      inFence[i] = true;
      if (m && m[1][0] === open.char && m[1].length >= open.len && lines[i].trim() === m[1]) open = null;
    } else if (m) {
      inFence[i] = true;
      open = { char: m[1][0], len: m[1].length };
    }
  }
  return inFence;
}

/** Replaces fenced code, inline code and %%comments%% with spaces; length and line breaks are unchanged. */
export function maskCode(body: string): string {
  const lines = body.split('\n');
  const inFence = fencedLines(lines);
  const masked = lines.map((line, i) => (inFence[i] ? blank(line) : line)).join('\n');
  return masked
    .replace(/(`+)[^`\n]+?\1/g, (m) => blank(m))
    .replace(/%%[\s\S]*?%%/g, (m) => blank(m))
    .replace(/<!--[\s\S]*?-->/g, (m) => blank(m));
}

const WIKILINK = /(!?)\[\[([^[\]|#\n]*)(#[^[\]|\n]*)?(?:\|([^[\]\n]*))?\]\]/g;
const MD_LINK = /(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\s*\)/g;

/** Replaces every link (wiki and markdown) with spaces; expects text that already went through maskCode. */
export function maskLinks(masked: string): string {
  return masked.replace(WIKILINK, (m) => blank(m)).replace(MD_LINK, (m) => blank(m));
}

function lineOf(text: string, offset: number, lineStarts: number[]): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function toList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap((v) => toList(v));
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  return [];
}

export function normaliseTag(raw: string): string {
  return lowerSurface(raw.trim().replace(/^#/, '').replace(/\/+$/, '')).normalize('NFC');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseNote(content: string): ParsedNote {
  const { yaml, body, bodyStartLine } = splitFrontmatter(content.replace(/\r\n/g, '\n'));

  let fm: Record<string, unknown> = {};
  let frontmatterError: string | null = null;
  if (yaml !== null) {
    try {
      const parsed: unknown = parseYaml(yaml, { logLevel: 'error' });
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fm = parsed as Record<string, unknown>;
    } catch (e) {
      frontmatterError = e instanceof Error ? e.message.split('\n')[0] : 'invalid YAML';
    }
  }

  const aliases = [...toList(fm.aliases), ...toList(fm.alias)].map((a) => a.trim()).filter(Boolean);
  const tagSet = new Set<string>();
  for (const raw of [...toList(fm.tags), ...toList(fm.tag)]) {
    for (const part of raw.split(/[,\s]+/)) {
      const tag = normaliseTag(part);
      if (tag) tagSet.add(tag);
    }
  }

  const masked = maskCode(body);
  const lines = body.split('\n');
  const maskedLines = masked.split('\n');
  const lineStarts: number[] = [0];
  for (let i = 0; i < body.length; i++) if (body[i] === '\n') lineStarts.push(i + 1);
  const fileLine = (offset: number) => lineOf(body, offset, lineStarts) + bodyStartLine + 1;

  const links: RawLink[] = [];
  for (const m of masked.matchAll(WIKILINK)) {
    const target = (m[2] ?? '').trim();
    const subpath = m[3] ? m[3].slice(1).trim() : null;
    if (!target && !subpath) continue;
    links.push({
      kind: 'wikilink',
      embed: m[1] === '!',
      target,
      subpath: subpath || null,
      alias: m[4]?.trim() || null,
      line: fileLine(m.index),
    });
  }
  for (const m of masked.matchAll(MD_LINK)) {
    const url = (m[3] ?? m[4] ?? '').trim();
    if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) continue; // external
    const hash = url.indexOf('#');
    const target = safeDecode(hash === -1 ? url : url.slice(0, hash));
    const subpath = hash === -1 ? null : safeDecode(url.slice(hash + 1)) || null;
    if (!target && !subpath) continue;
    links.push({
      kind: 'markdown',
      embed: m[1] === '!',
      target,
      subpath,
      alias: m[2].trim() || null,
      line: fileLine(m.index),
    });
  }
  links.sort((a, b) => a.line - b.line);

  const noLinks = maskLinks(masked);
  for (const m of noLinks.matchAll(/(?<![\p{L}\p{N}_/#&])#([\p{L}\p{N}_/-]+)/gu)) {
    if (/^[\d/_-]+$/.test(m[1])) continue; // '#1', '#2024' are not tags
    const tag = normaliseTag(m[1]);
    if (tag) tagSet.add(tag);
  }

  const headings: Heading[] = [];
  const blockIdSet = new Set<string>();
  const tasks: Task[] = [];
  for (let i = 0; i < maskedLines.length; i++) {
    const line = maskedLines[i];
    const h = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (h) headings.push({ level: h[1].length, text: h[2].trim(), line: i + bodyStartLine + 1 });
    const b = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/.exec(line);
    if (b) blockIdSet.add(b[1]);
    const t = /^\s*[-*+][ \t]+\[ \][ \t]+(.+?)\s*$/.exec(line);
    if (t) tasks.push({ text: lines[i].replace(/^\s*[-*+][ \t]+\[ \][ \t]+/, '').trimEnd(), line: i + bodyStartLine + 1 });
  }

  const plainText = masked
    .replace(WIKILINK, (_m, bang: string, target: string, _sub: string, alias: string | undefined) => {
      if (bang === '!') return ' ';
      return alias?.trim() || (target ?? '').split('/').pop() || ' ';
    })
    .replace(MD_LINK, (_m, bang: string, text: string) => (bang === '!' ? ' ' : text))
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/(?<![\p{L}\p{N}_/#&])#[\p{L}\p{N}_/-]+/gu, ' ')
    .replace(/(^|\s)\^[A-Za-z0-9-]+[ \t]*$/gm, ' ')
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return {
    frontmatterTitle: typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : null,
    aliases: [...new Set(aliases)],
    tags: [...tagSet].sort(),
    frontmatterCreated: coerceDate(fm.created) ?? coerceDate(fm.date),
    frontmatterModified: coerceDate(fm.modified) ?? coerceDate(fm.updated),
    frontmatterError,
    headings,
    blockIds: [...blockIdSet],
    links,
    tasks,
    bodyStartLine,
    body,
    plainText,
    wordCount: rawTokens(plainText).length,
  };
}

function blockKind(firstLine: string): Passage['kind'] {
  if (/^\s*([-*+]|\d+[.)])[ \t]/.test(firstLine)) return 'list';
  if (/^\s*>/.test(firstLine)) return 'quote';
  if (/^\s*\|/.test(firstLine)) return 'table';
  return 'paragraph';
}

/**
 * Splits a note body into quotable blocks (paragraphs, list items, quotes, tables) with their heading
 * context. Code blocks, headings and rules are not passages. Text is returned exactly as written.
 */
export function passages(body: string, bodyStartLine = 0): Passage[] {
  const lines = body.split('\n');
  const inFence = fencedLines(lines);
  const out: Passage[] = [];
  const path: { level: number; text: string }[] = [];
  let start = -1;

  const emit = (from: number, endExclusive: number) => {
    const blockLines = lines.slice(from, endExclusive);
    const text = blockLines.join('\n').replace(/\s+$/, '');
    if (!text.trim()) return;
    const id = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/.exec(text);
    out.push({
      headingPath: path.map((h) => h.text),
      text,
      startLine: from + bodyStartLine + 1,
      endLine: from + text.split('\n').length + bodyStartLine,
      blockId: id ? id[1] : null,
      kind: blockKind(blockLines[0]),
    });
  };

  const flush = (endExclusive: number) => {
    if (start === -1) return;
    const from = start;
    start = -1;
    if (blockKind(lines[from]) !== 'list') {
      emit(from, endExclusive);
      return;
    }
    // A list is quoted item by item (each top-level item with its children), so that one relevant
    // bullet can be cited without its unrelated neighbours.
    const indent = /^\s*/.exec(lines[from])![0].length;
    let itemStart = from;
    for (let i = from + 1; i < endExclusive; i++) {
      const m = /^(\s*)([-*+]|\d+[.)])[ \t]/.exec(lines[i]);
      if (m && m[1].length <= indent) {
        emit(itemStart, i);
        itemStart = i;
      }
    }
    emit(itemStart, endExclusive);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFence[i]) {
      flush(i);
      continue;
    }
    const h = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (h) {
      flush(i);
      const level = h[1].length;
      while (path.length && path[path.length - 1].level >= level) path.pop();
      path.push({ level, text: h[2].trim() });
      continue;
    }
    if (!line.trim() || /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) {
      flush(i);
      continue;
    }
    if (start === -1) start = i;
  }
  flush(lines.length);
  return out;
}

/** The lines of one heading's section: from the heading to the next heading of the same or a higher level. */
export function sectionRange(headings: Heading[], heading: string, totalLines: number): { start: number; end: number } | null {
  const wanted = heading.replace(/^#+\s*/, '').trim().toLowerCase();
  const idx = headings.findIndex((h) => h.text.toLowerCase() === wanted);
  if (idx === -1) return null;
  const next = headings.slice(idx + 1).find((h) => h.level <= headings[idx].level);
  return { start: headings[idx].line, end: next ? next.line - 1 : totalLines };
}
