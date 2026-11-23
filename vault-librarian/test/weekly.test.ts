import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Librarian } from '../src/librarian.js';
import { unquote } from '../src/quote.js';
import { emptyState, loadState } from '../src/state.js';
import { findMentions, generateWeekly, pairId, renderWeekly } from '../src/weekly.js';
import { cleanup, copyFixture, fixtureConfig, loadFixture, TODAY } from './helpers.js';

afterAll(cleanup);

const names = (pairs: { older: { basename: string }; newer: { basename: string } }[]) => pairs.map((p) => `${p.older.basename} + ${p.newer.basename}`);

describe('weekly link suggestions', () => {
  const { index, model, config } = loadFixture();
  const report = generateWeekly(index, model, config, emptyState(), { today: TODAY });
  const fresh = report.pairs.filter((p) => p.kind === 'old-meets-new');
  const archive = report.pairs.filter((p) => p.kind === 'archive');

  it('covers the seven days ending today and names the ISO week', () => {
    expect([report.week, report.windowStart, report.today]).toEqual(['2026-W48', '2026-11-17', '2026-11-23']);
    expect(report.touched.map((n) => n.basename)).toEqual(['2026-11-17', '2026-11-19', 'Desire essay outline', 'Speculative manias', 'Scarcity and luxury']);
  });

  it('leads with old notes that meet this week\'s notes', () => {
    expect(names(fresh).slice(0, 3)).toEqual([
      'Mimetic desire + Speculative manias',
      'Advertising and manufactured wants + Scarcity and luxury',
      'Envy and the neighbour + Speculative manias',
    ]);
    // Old-meets-new pairs come first even when an archive pair scores higher.
    expect(report.pairs.indexOf(fresh[fresh.length - 1])).toBeLessThan(report.pairs.indexOf(archive[0]));
    expect(archive[0].pair.score).toBeGreaterThan(fresh[0].pair.score);
    for (const p of fresh) {
      const touched = [p.older, p.newer].filter((n) => n.modified >= report.windowStart || n.created >= report.windowStart);
      expect(touched.length).toBeGreaterThanOrEqual(1);
      expect(p.older.modified <= '2026-08-25').toBe(true); // 90 days before today
    }
  });

  it('fills up from the archive with pairs in which neither note was touched', () => {
    expect(names(archive).slice(0, 2)).toEqual(['Borç döngüsü + Kredi genişlemesi', 'Technology surges + Hype cycle']);
    for (const p of archive) {
      expect([p.older, p.newer].some((n) => n.modified >= report.windowStart)).toBe(false);
      expect(p.older.modified <= '2026-08-25').toBe(true);
    }
  });

  it('never suggests linked pairs, thin notes, daily notes, or one note more than twice', () => {
    const count = new Map<string, number>();
    for (const p of report.pairs) {
      expect(index.neighbours.get(p.older.path)!.has(p.newer.path)).toBe(false);
      expect(p.pair.score).toBeGreaterThanOrEqual(config.weekly.minScore);
      for (const n of [p.older, p.newer]) {
        expect(n.isDaily).toBe(false);
        expect(n.wordCount).toBeGreaterThanOrEqual(config.weekly.minWords);
        count.set(n.path, (count.get(n.path) ?? 0) + 1);
      }
    }
    expect(Math.max(...count.values())).toBeLessThanOrEqual(2);
    expect(new Set(report.pairs.map((p) => p.id)).size).toBe(report.pairs.length);
  });

  it('gives each pair a reason with passages quoted verbatim', () => {
    const top = fresh[0];
    expect(top.pair.sharedTerms).toEqual(expect.arrayContaining(['crowd', 'rivalry']));
    expect(top.olderPassage!.headingPath).toEqual(['Mimetic desire', 'Rivalry']);
    expect(top.newerPassage!.headingPath).toEqual(['Speculative manias', 'Imitation']);
    for (const p of report.pairs) {
      expect(p.older.body).toContain(p.olderPassage!.text);
      expect(p.newer.body).toContain(p.newerPassage!.text);
    }
    const tech = archive.find((p) => p.newer.basename === 'Hype cycle')!;
    expect(tech.pair.sharedTags).toEqual(['cycles/technology', 'technology']);
  });

  it('lists orphans worth rescuing with the notes they sit closest to', () => {
    expect(report.orphans.map((o) => [o.note.basename, o.candidates[0].note.basename])).toEqual([
      ['Kredi genişlemesi', 'Borç döngüsü'],
      ['Hype cycle', 'Technology surges'],
      ['Envy and the neighbour', 'Speculative manias'],
    ]);
    expect(report.orphansWithoutCandidates).toBe(2); // the photography and bike notes; empty and code-only notes are not counted
  });

  it('lists missing notes that several notes point to', () => {
    expect(report.unresolved.map((u) => [u.target, u.sources.length])).toEqual([
      ['Positional goods', 4],
      ['Reflexivity', 3],
    ]);
  });

  it('finds titles and aliases written out without a link', () => {
    expect(report.mentions.map((m) => [m.source.basename, m.name, m.target.basename, m.line])).toEqual([
      ['2026-11-17', 'Hedonic treadmill', 'Hedonic treadmill', '- Thought on the train: the hedonic treadmill is a cycle too, just a private one.'],
      ['2026-11-17', 'mimetic theory', 'Mimetic desire', '- [ ] Ask whether mimetic theory says anything about markets #todo'],
      ['2026-08-03', 'Long debt cycle', 'Long debt cycle', '- Idea: the long debt cycle and the commodity boom of the same decade should be drawn on one chart. #idea'],
    ]);
    for (const m of findMentions(index)) {
      expect(m.source.body).toContain(m.line);
      expect(index.outgoing.get(m.source.path)!.some((l) => l.to === m.target.path)).toBe(false);
    }
  });

  it('renders a report whose every quote is found word for word in a note', () => {
    const md = renderWeekly(report, index, config);
    expect(md).toContain('# Weekly links 2026-W48');
    expect(md).toContain('### 1. [[Mimetic desire]] and [[Speculative manias]]');
    expect(md).toContain('[[Mimetic desire#Rivalry|Mimetic desire › Rivalry]]');
    const quotes = md.split('\n\n').filter((block) => block.trimStart().startsWith('>'));
    expect(quotes.length).toBeGreaterThanOrEqual(report.pairs.length * 2);
    const corpus = index.notes.map((n) => n.body);
    for (const q of quotes) {
      const text = unquote(q.replace(/^ {2}/gm, ''));
      expect(corpus.some((body) => body.includes(text)), text).toBe(true);
    }
  });

  it('is deterministic for a vault state and date', () => {
    const again = loadFixture();
    const other = generateWeekly(again.index, again.model, again.config, emptyState(), { today: TODAY });
    expect(renderWeekly(other, again.index, again.config)).toBe(renderWeekly(report, index, config));
  });

  it('falls back to archive pairs in a week when nothing was touched', () => {
    const quiet = generateWeekly(index, model, config, emptyState(), { today: '2026-10-05' });
    expect(quiet.touched).toEqual([]);
    expect(quiet.pairs.length).toBeGreaterThan(0);
    expect(quiet.pairs.every((p) => p.kind === 'archive')).toBe(true);
    expect(renderWeekly(quiet, index, config)).toContain('No notes were created or modified in the window');
  });

  it('honours limit and old_after_days', () => {
    expect(generateWeekly(index, model, config, emptyState(), { today: TODAY, limit: 2 }).pairs).toHaveLength(2);
    // With "old" meaning four years untouched, nothing in the fixture is old.
    expect(generateWeekly(index, model, config, emptyState(), { today: TODAY, oldAfterDays: 1500 }).pairs).toEqual([]);
  });
});

describe('dismissing and repeating', () => {
  it('leaves a dismissed pair out, by id or by naming the two notes, and can restore it', () => {
    const copy = copyFixture();
    const librarian = new Librarian(fixtureConfig(copy), { cache: false, refreshMs: 0 });
    const before = librarian.weekly({ today: TODAY }).report;
    const top = before.pairs[0];
    expect(names([top])).toEqual(['Mimetic desire + Speculative manias']);
    expect(fs.existsSync(path.join(copy.vault, 'Librarian'))).toBe(false); // nothing is written without write: true

    const done = librarian.dismiss({ id: top.id }, { today: TODAY });
    expect(done).toMatchObject({ id: top.id, dismissed: true });
    expect(done.label).toContain('Mimetic desire.md');
    const after = librarian.weekly({ today: TODAY }).report;
    expect(after.pairs.some((p) => p.id === top.id)).toBe(false);
    expect(after.dismissedSkipped).toBe(1);
    // The slot is taken by the next candidate rather than left empty.
    expect(after.pairs.length).toBeGreaterThanOrEqual(before.pairs.length - 1);

    const byNames = librarian.dismiss({ noteA: 'Hype cycle', noteB: 'Technology surges' }, { today: TODAY });
    expect(byNames.id).toBe(pairId('Notes/Cycles/Hype cycle.md', 'Notes/Cycles/Technology surges.md'));
    const state = loadState(librarian.config);
    expect(Object.keys(state.dismissed).sort()).toEqual([top.id, byNames.id].sort());
    expect(state.dismissed[top.id]).toMatchObject({ kind: 'pair', on: TODAY });

    librarian.dismiss({ id: top.id }, { undo: true });
    expect(librarian.weekly({ today: TODAY }).report.pairs[0].id).toBe(top.id);
  });

  it('dismisses orphans, missing notes and mentions too, and refuses unknown ids', () => {
    const copy = copyFixture();
    const librarian = new Librarian(fixtureConfig(copy), { cache: false, refreshMs: 0 });
    const r = librarian.weekly({ today: TODAY }).report;
    librarian.dismiss({ id: r.orphans[0].id }, { today: TODAY });
    librarian.dismiss({ id: r.unresolved[0].id }, { today: TODAY });
    librarian.dismiss({ id: r.mentions[0].id }, { today: TODAY });
    const after = librarian.weekly({ today: TODAY }).report;
    expect(after.orphans.map((o) => o.note.basename)).toEqual(['Hype cycle', 'Envy and the neighbour']);
    expect(after.unresolved.map((u) => u.target)).toEqual(['Reflexivity']);
    expect(after.mentions).toHaveLength(2);
    expect(() => librarian.dismiss({ id: 'p-00000000' })).toThrow(/No current suggestion/);
    expect(() => librarian.dismiss({ id: '../../etc/passwd' })).toThrow(/not a suggestion id/);
    expect(() => librarian.dismiss({ noteA: 'Hype cycle' })).toThrow(/both note_a and note_b/);
  });

  it('saves the report, and holds shown pairs back in later weeks but not in the same week', () => {
    const copy = copyFixture();
    const librarian = new Librarian(fixtureConfig(copy), { cache: false, refreshMs: 0 });
    const first = librarian.weekly({ today: TODAY, write: true });
    expect(first.written).toBe('Librarian/Weekly links/2026-W48.md');
    const file = path.join(copy.vault, first.written!);
    expect(fs.readFileSync(file, 'utf8')).toBe(first.markdown);

    // Same week again: same report, written or not.
    expect(librarian.weekly({ today: TODAY }).markdown).toBe(first.markdown);
    expect(librarian.weekly({ today: '2026-11-23', write: true }).markdown).toBe(first.markdown);

    // Next week: everything shown in W48 is held back for six weeks.
    const next = librarian.weekly({ today: '2026-11-30' }).report;
    const shown = new Set(first.report.pairs.map((p) => p.id));
    expect(next.heldBack).toBe(shown.size);
    expect(next.pairs.some((p) => shown.has(p.id))).toBe(false);

    // Six weeks on they may come back.
    const later = librarian.weekly({ today: '2027-01-04' }).report; // 2027-W01, six weeks after 2026-W48
    expect(later.heldBack).toBe(0);
    expect(later.pairs.some((p) => shown.has(p.id))).toBe(true);
  });
});
