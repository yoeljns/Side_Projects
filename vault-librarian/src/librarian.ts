// The librarian: one object that owns the config, keeps the index fresh, and does the few writes.
// The CLI and the MCP server are thin layers over it.
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { isIsoDate, localDate } from './dates.js';
import { buildIndex, findNote, type Note, type VaultIndex } from './indexer.js';
import { buildPack, recordPack, renderPack, type Pack } from './pack.js';
import { resolveInside, safeFileName, toPosix, writeFileAtomic } from './paths.js';
import { buildModel, type Model } from './similarity.js';
import { loadState, saveState, type Dismissal } from './state.js';
import { describeSuggestion, generateWeekly, pairId, recordShown, renderWeekly, type WeeklyReport } from './weekly.js';

export class NoteNotFoundError extends Error {}

export interface LibrarianOptions {
  cache?: boolean;
  warn?: (message: string) => void;
  /** Re-walk the vault at most this often (ms). 0 re-walks on every call. */
  refreshMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class Librarian {
  private index: VaultIndex | null = null;
  private model: Model | null = null;
  private lastWalk = 0;

  constructor(
    readonly config: Config,
    private readonly options: LibrarianOptions = {},
  ) {}

  /** Today's date: an explicit value, else VAULT_LIBRARIAN_TODAY, else the machine's local date. */
  today(explicit?: string): string {
    const value = explicit ?? (this.options.env ?? process.env).VAULT_LIBRARIAN_TODAY;
    if (value !== undefined && value !== '') {
      if (!isIsoDate(value)) throw new Error(`Not a date: "${value}". Use YYYY-MM-DD.`);
      return value;
    }
    return localDate(Date.now());
  }

  /** The current index and similarity model; re-walks the vault when the last walk is stale. */
  load(force = false): { index: VaultIndex; model: Model } {
    const now = Date.now();
    if (force || !this.index || now - this.lastWalk >= (this.options.refreshMs ?? 2000)) {
      const next = buildIndex(this.config, { cache: this.options.cache, warn: this.options.warn });
      if (!this.index || next.fingerprint !== this.index.fingerprint) this.model = null;
      this.index = next;
      this.lastWalk = now;
    }
    this.model ??= buildModel(this.index, this.config);
    return { index: this.index, model: this.model };
  }

  /** Finds a note by vault path or by name, or throws an error that says what to try instead. */
  note(ref: string): Note {
    const { index } = this.load();
    const cleaned = ref.replace(/\\/g, '/');
    if (cleaned.includes('\0') || cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned) || cleaned.split('/').includes('..')) {
      throw new NoteNotFoundError(`"${ref}" is not a path inside the vault. Give a vault-relative path such as "Notes/Example.md", or a note name.`);
    }
    const { note, candidates } = findNote(index, ref);
    if (note) return note;
    if (candidates.length > 1) {
      throw new NoteNotFoundError(`"${ref}" matches ${candidates.length} notes. Use the full path: ${candidates.map((c) => `"${c.path}"`).join(', ')}.`);
    }
    throw new NoteNotFoundError(`No note called "${ref}". Use vault_search_notes to find the right path.`);
  }

  /** The note file as it is on disk. The path comes from the index and is checked again before reading. */
  readNote(note: Note): string {
    return fs.readFileSync(resolveInside(this.config.vault, note.path), 'utf8').replace(/\r\n/g, '\n');
  }

  private write(relative: string, content: string): string {
    const rel = `${this.config.outputFolder}/${relative}`;
    writeFileAtomic(resolveInside(this.config.vault, rel), content);
    return toPosix(rel);
  }

  weekly(options: { today?: string; limit?: number; oldAfterDays?: number; write?: boolean } = {}): { report: WeeklyReport; markdown: string; written: string | null } {
    const { index, model } = this.load();
    const state = loadState(this.config);
    const report = generateWeekly(index, model, this.config, state, {
      today: this.today(options.today),
      limit: options.limit,
      oldAfterDays: options.oldAfterDays,
    });
    const markdown = renderWeekly(report, index, this.config);
    let written: string | null = null;
    if (options.write) {
      written = this.write(`Weekly links/${report.week}.md`, markdown);
      recordShown(state, report);
      saveState(this.config, state);
    }
    return { report, markdown, written };
  }

  pack(topic: string, options: { today?: string; write?: boolean; maxSources?: number; excerptsPerSource?: number } = {}): { pack: Pack; markdown: string; written: string | null } {
    const { index, model } = this.load();
    const state = loadState(this.config);
    const pack = buildPack(index, model, this.config, state, topic, {
      today: this.today(options.today),
      maxSources: options.maxSources,
      excerptsPerSource: options.excerptsPerSource,
    });
    const markdown = renderPack(pack, index);
    let written: string | null = null;
    if (options.write) {
      const name = safeFileName(pack.topic.adhoc ? pack.topic.title : pack.topic.key, 60);
      written = this.write(`Source packs/${name} ${pack.date}.md`, markdown);
      recordPack(state, pack);
      saveState(this.config, state);
    }
    return { pack, markdown, written };
  }

  /**
   * Dismisses (or restores) a suggestion. Give the id printed in the weekly report, or the two notes of a pair.
   */
  dismiss(target: { id?: string; noteA?: string; noteB?: string }, options: { undo?: boolean; today?: string } = {}): { id: string; label: string; dismissed: boolean } {
    const state = loadState(this.config);
    let id: string;
    let entry: Omit<Dismissal, 'on'>;
    if (target.noteA !== undefined || target.noteB !== undefined) {
      if (!target.noteA || !target.noteB) throw new Error('Give both note_a and note_b to dismiss a pair, or give an id.');
      const a = this.note(target.noteA);
      const b = this.note(target.noteB);
      if (a.path === b.path) throw new Error('note_a and note_b are the same note.');
      id = pairId(a.path, b.path);
      entry = { kind: 'pair', label: [a.path, b.path].sort().join(' <-> ') };
    } else {
      id = (target.id ?? '').trim();
      if (!/^[pomu]-[0-9a-f]{8}$/.test(id)) {
        throw new Error(`"${id}" is not a suggestion id. Ids look like p-1a2b3c4d and are printed in the weekly report.`);
      }
      if (options.undo && state.dismissed[id]) {
        entry = state.dismissed[id];
      } else {
        const { index, model } = this.load();
        const everything = generateWeekly(index, model, { ...this.config, weekly: { ...this.config.weekly, limit: 50, maxPerNote: 1e9, orphanLimit: 50, mentionLimit: 50, minScore: 0 } }, state, {
          today: this.today(options.today),
          limit: 100_000,
          ignoreState: true,
        });
        const found = describeSuggestion(everything, id);
        if (!found) {
          throw new Error(`No current suggestion has the id ${id}. Run vault_weekly_links for the current ids, or dismiss a pair with note_a and note_b.`);
        }
        entry = found;
      }
    }
    if (options.undo) delete state.dismissed[id];
    else state.dismissed[id] = { ...entry, on: this.today(options.today) };
    saveState(this.config, state);
    return { id, label: entry.label, dismissed: !options.undo };
  }

  stats() {
    const { index, model } = this.load();
    const state = loadState(this.config);
    const tagCounts = new Map<string, number>();
    for (const n of index.notes) for (const t of n.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    let links = 0;
    let brokenAnchors = 0;
    for (const list of index.outgoing.values()) {
      for (const l of list) {
        if (l.to) links++;
        if (l.to && !l.anchorOk) brokenAnchors++;
      }
    }
    const dates = index.notes.map((n) => n.modified).sort();
    return {
      vault: this.config.vault,
      configFile: this.config.configPath,
      outputFolder: this.config.outputFolder,
      notes: index.notes.length,
      dailyNotes: index.notes.filter((n) => n.isDaily).length,
      emptyNotes: index.notes.filter((n) => n.wordCount === 0).length,
      attachments: index.attachments.length,
      words: index.notes.reduce((sum, n) => sum + n.wordCount, 0),
      distinctTerms: model.idf.size,
      links,
      brokenAnchors,
      unresolvedTargets: index.unresolved.filter((u) => !u.attachment).length,
      missingAttachments: index.unresolved.filter((u) => u.attachment).length,
      orphans: index.notes.filter((n) => n.wordCount > 0 && (index.neighbours.get(n.path)?.size ?? 0) === 0).length,
      frontmatterErrors: index.notes.filter((n) => n.frontmatterError).map((n) => n.path),
      oldestModified: dates[0] ?? null,
      newestModified: dates[dates.length - 1] ?? null,
      topTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 15).map(([tag, count]) => ({ tag, count })),
      topics: Object.keys(this.config.topics),
      dismissed: Object.keys(state.dismissed).length,
      index: index.stats,
    };
  }
}

/** Absolute path of something the librarian wrote, for messages. */
export function absoluteOutput(config: Config, relative: string): string {
  return path.join(config.vault, relative);
}
