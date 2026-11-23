import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildConfig } from '../src/config.js';
import { buildIndex } from '../src/indexer.js';
import { Librarian } from '../src/librarian.js';
import { buildPack, renderPack, resolveTopic, TopicError } from '../src/pack.js';
import { CUT_MARK, excerpt, unquote } from '../src/quote.js';
import { buildModel } from '../src/similarity.js';
import { emptyState } from '../src/state.js';
import { cleanup, copyFixture, fixtureConfig, loadFixture, TODAY } from './helpers.js';

afterAll(cleanup);

describe('source packs', () => {
  const { index, model, config } = loadFixture();
  const cycles = buildPack(index, model, config, emptyState(), 'cycles', { today: TODAY });
  const desire = buildPack(index, model, config, emptyState(), 'desire', { today: TODAY });
  const group = (pack: typeof cycles, name: string) => pack.groups.find((g) => g.name === name)?.sources.map((s) => s.note.basename) ?? [];

  it('collects notes by tag, by links from the seed notes and by text, and says why', () => {
    const got = cycles.sources.map((s) => s.note.basename);
    expect(got).toEqual(
      expect.arrayContaining(['Long debt cycle', 'Minsky moment', 'Deleveraging', 'Commodity supercycle', 'Capex cycle in mining', 'Technology surges', 'Kondratiev waves', 'Hype cycle', 'Borç döngüsü', 'Speculative manias']),
    );
    for (const off of ['Sourdough starter', 'Bike maintenance', 'Tomato pruning', 'Işık ve gölge', 'Hedonic treadmill', 'Empty', 'Regex cheatsheet']) expect(got).not.toContain(off);
    const why = (name: string) => cycles.sources.find((s) => s.note.basename === name)!.reasons.join('; ');
    expect(why('Long debt cycle')).toMatch(/^seed note; tagged #cycles\/debt; uses /);
    expect(why('Hype cycle')).toMatch(/^tagged #cycles\/technology; uses /); // by tag and text only: it has no links
    expect(why('Minsky moment')).toContain('linked with seed [[Long debt cycle]]');
    expect(why('Speculative manias')).toContain('two links from seed [[Long debt cycle]] by way of [[Minsky moment]]');
    expect(why('Scarcity and luxury')).toMatch(/^linked with seed \[\[Commodity supercycle\]\]/); // not tagged cycles
    expect(cycles.sources.map((s) => s.relevance)).toEqual([...cycles.sources.map((s) => s.relevance)].sort((a, b) => b - a));
    expect(cycles.sources[cycles.sources.length - 1].relevance).toBeGreaterThanOrEqual(config.packs.minRelevance);
  });

  it('groups by the sub-themes the topic defines, and keeps cross-cutting notes apart', () => {
    expect(cycles.groups.map((g) => g.name)).toEqual(['Debt', 'Commodities', 'Technology', 'Across sub-themes', 'Maps and indexes']);
    expect(group(cycles, 'Debt')).toEqual(expect.arrayContaining(['Long debt cycle', 'Minsky moment', 'Deleveraging', 'Borç döngüsü']));
    expect(group(cycles, 'Commodities')).toEqual(['Commodity supercycle', 'Capex cycle in mining', 'Scarcity and luxury']);
    expect(group(cycles, 'Technology')).toEqual(['Technology surges', 'Kondratiev waves', 'Hype cycle']);
    expect(group(cycles, 'Across sub-themes')).toEqual(expect.arrayContaining(['Is desire cyclical', 'Speculative manias']));
    expect(group(cycles, 'Maps and indexes')).toEqual(['Index']);
    // Every source is in exactly one group.
    expect(cycles.groups.flatMap((g) => g.sources).length).toBe(cycles.sources.length);
    expect(new Set(cycles.groups.flatMap((g) => g.sources.map((s) => s.note.path))).size).toBe(cycles.sources.length);
  });

  it('groups by shared tags, then shared terms, when the topic defines no sub-themes', () => {
    expect(desire.groups.map((g) => g.name)).toEqual(['#theory', '#economics', '#psychology', '"essay"', 'Other', 'Maps and indexes']);
    expect(group(desire, '#theory')).toEqual(['Mimetic desire', 'Desire as lack', 'Desire as production']);
    expect(group(desire, '#psychology')).toEqual(['Hedonic treadmill', 'The wanting-liking split']);
    expect(desire.groups.find((g) => g.name === '#theory')!.why).toBe('Grouped by the shared tag #theory.');
    // The seed tag itself is never a group: every source would be in it.
    expect(desire.groups.some((g) => g.name.startsWith('#desire'))).toBe(false);
    expect(desire.sources.find((s) => s.note.basename === 'Arzu ve taklit')!.reasons[0]).toBe('tagged #desire/mimetic');
  });

  it('quotes excerpts exactly, in reading order, with heading context', () => {
    for (const pack of [cycles, desire]) {
      for (const s of pack.sources) {
        if (s.map) {
          expect(s.excerpts).toEqual([]);
          continue;
        }
        expect(s.excerpts.length).toBeGreaterThanOrEqual(1);
        expect(s.excerpts.length).toBeLessThanOrEqual(config.packs.excerptsPerSource);
        const file = fs.readFileSync(path.join(config.vault, s.note.path), 'utf8');
        let last = 0;
        for (const e of s.excerpts) {
          const text = e.text.endsWith(CUT_MARK) ? e.text.slice(0, -CUT_MARK.length) : e.text;
          expect(file).toContain(text);
          expect(file.split('\n').slice(e.passage.startLine - 1, e.passage.endLine).join('\n')).toBe(e.passage.text);
          expect(e.passage.startLine).toBeGreaterThan(last);
          last = e.passage.endLine;
        }
      }
    }
    const debt = cycles.sources.find((s) => s.note.basename === 'Long debt cycle')!;
    expect(debt.excerpts.map((e) => e.passage.headingPath.join(' > '))).toEqual(['Long debt cycle', 'Long debt cycle', 'Long debt cycle > Top']);
    expect(debt.excerpts[1].text).toBe('The long debt cycle is the multi-decade rise and fall of total debt relative to income. ^debt-def');
  });

  it('quotes one relevant bullet of a daily note without its unrelated neighbours', () => {
    const daily = cycles.sources.find((s) => s.note.basename === '2026-08-03')!;
    const quoted = daily.excerpts.map((e) => e.text).join('\n');
    expect(quoted).toContain('the long debt cycle and the commodity boom');
    expect(quoted).not.toContain('Bread came out flat');
  });

  it('falls back to a passage that links to the topic when no key term matches', () => {
    const reading = cycles.sources.find((s) => s.note.basename === 'Reading list')!;
    expect(reading.excerpts.map((e) => e.passage.headingPath[1])).toEqual(['For the cycles essay']);
    expect(reading.excerpts[0].text).toBe('- A history of financial crises, for [[Minsky moment]]\n- A history of technological revolutions and financial capital, for [[Technology surges]]');
  });

  it('lists open questions: missing notes, question notes, open tasks and question sentences', () => {
    expect(cycles.open.unresolved.map((u) => u.target)).toEqual(expect.arrayContaining(['Reflexivity', 'Dutch disease']));
    expect(cycles.open.questionNotes.map((n) => n.basename)).toEqual(['Is desire cyclical']);
    expect(cycles.open.tasks.map((t) => t.task.text)).toEqual([
      'Work out whether the three cycles share one clock or only rhyme',
      'Write the paragraph on why every generation forgets the last bust',
    ]);
    expect(cycles.open.questions.map((q) => q.text)).toContain('Does collective wanting have its own cycle, with a boom of appetite and a bust of revulsion?');
    expect(desire.open.unresolved.map((u) => [u.target, u.sources.length])).toEqual([['Positional goods', 4]]);
    for (const q of [...cycles.open.questions, ...desire.open.questions]) expect(q.note.body).toContain(q.text);
  });

  it('renders one Markdown pack: outline, sources with wikilinks and dates, verbatim quotes', () => {
    const md = renderPack(cycles, index);
    expect(md).toContain('# Source pack: Cycles (2026-11-23)');
    expect(md).toContain('- **Technology** (3): [[Technology surges]], [[Kondratiev waves]], [[Hype cycle]]');
    expect(md).toContain('#### [[Long debt cycle]]\n\ncreated 2023-02-01 · modified 2024-04-15 · 133 words · #cycles/debt #macro');
    expect(md).toContain('[[Notes/Cycles/Index|Index]]'); // the duplicate name is linked by path
    expect(md).toContain('This is the first saved pack for this topic');
    expect(md.indexOf('## Outline')).toBeLessThan(md.indexOf('## Sources'));
    expect(md.indexOf('## Sources')).toBeLessThan(md.indexOf('## Open questions'));
    const corpus = index.notes.map((n) => n.body);
    const quotes = md.split('\n\n').filter((b) => b.startsWith('>'));
    expect(quotes.length).toBe(cycles.sources.reduce((n, s) => n + s.excerpts.length, 0));
    for (const q of quotes) expect(corpus.some((body) => body.includes(unquote(q))), q).toBe(true);
    expect(renderPack(buildPack(index, model, config, emptyState(), 'cycles', { today: TODAY }), index)).toBe(md); // deterministic
  });

  it('pages the sources without losing the outline', () => {
    const first = renderPack(cycles, index, { sourceOffset: 0, sourceLimit: 3 });
    const second = renderPack(cycles, index, { sourceOffset: 3, sourceLimit: 3 });
    expect(first).toContain('Showing sources 1 to 3 of');
    expect(second).toContain('Showing sources 4 to 6 of');
    expect((first.match(/^#### /gm) ?? []).length).toBe(3);
    expect(second).toContain('## Outline');
    expect(second).not.toContain('## Open questions');
  });

  it('takes a free query with optional #tags', () => {
    const adhoc = buildPack(index, model, config, emptyState(), 'envy of the neighbour', { today: TODAY });
    expect(adhoc.topic).toMatchObject({ adhoc: true, key: 'adhoc:envy of the neighbour' });
    expect(adhoc.sources[0].note.basename).toBe('Envy and the neighbour');
    expect(adhoc.sources.map((s) => s.note.basename)).toContain('Speculative manias');
    const tagged = buildPack(index, model, config, emptyState(), '#türkçe', { today: TODAY });
    expect(tagged.sources.map((s) => s.note.basename).sort()).toEqual(['Arzu ve taklit', 'Borç döngüsü', 'Işık ve gölge', 'Kredi genişlemesi']);
    expect(() => buildPack(index, model, config, emptyState(), 'zzzz qqqq', { today: TODAY })).toThrow(TopicError);
    expect(() => buildPack(index, model, config, emptyState(), '   ', { today: TODAY })).toThrow(TopicError);
  });

  it('uses the built-in desire and cycles topics when the vault has no config file', () => {
    const copy = copyFixture();
    fs.rmSync(path.join(copy.vault, 'vault-librarian.config.json'));
    const bare = buildConfig(copy.vault, {}, null, { XDG_CACHE_HOME: copy.cache });
    expect(Object.keys(bare.topics)).toEqual(['desire', 'cycles']);
    const bareIndex = buildIndex(bare, { cache: false });
    const pack = buildPack(bareIndex, buildModel(bareIndex, bare), bare, emptyState(), 'cycles', { today: TODAY });
    expect(pack.topic.seedNotes).toEqual([]);
    expect(pack.sources.map((s) => s.note.basename)).toEqual(expect.arrayContaining(['Long debt cycle', 'Commodity supercycle', 'Technology surges']));
    expect(resolveTopic(index, buildConfig(copy.vault, { topics: { desire: { seedNotes: ['No such note', 'Index'] } } }), 'desire').missingSeeds).toEqual(['No such note', 'Index']);
  });
});

describe('saving packs and what is new since the last one', () => {
  it('writes the pack as a note and reports new and changed sources next time', () => {
    const copy = copyFixture();
    const librarian = new Librarian(fixtureConfig(copy), { cache: false, refreshMs: 0 });
    const first = librarian.pack('desire', { today: '2026-11-01', write: true });
    expect(first.written).toBe('Librarian/Source packs/desire 2026-11-01.md');
    expect(fs.readFileSync(path.join(copy.vault, first.written!), 'utf8')).toBe(first.markdown);
    expect(first.pack.news.previousDate).toBeNull();

    // Same day again: still compared with packs from earlier days only, so the result does not change.
    expect(librarian.pack('desire', { today: '2026-11-01', write: true }).markdown).toBe(first.markdown);

    fs.writeFileSync(
      path.join(copy.vault, 'Notes', 'Desire', 'Boredom.md'),
      '---\ncreated: 2026-11-10\nmodified: 2026-11-10\ntags: [desire]\n---\n# Boredom\n\nBoredom is desire with no object: the wanting is there and nothing answers it.\n',
    );
    const lack = path.join(copy.vault, 'Notes', 'Desire', 'Desire as lack.md');
    fs.writeFileSync(lack, fs.readFileSync(lack, 'utf8').replace('modified: 2024-03-09', 'modified: 2026-11-12'));

    const second = librarian.pack('desire', { today: TODAY, write: true });
    expect(second.pack.news.previousDate).toBe('2026-11-01');
    expect(second.pack.news.added.map((n) => n.basename)).toEqual(['Boredom']);
    expect(second.pack.news.changed.map((c) => [c.note.basename, c.was])).toEqual([['Desire as lack', '2024-03-09']]);
    expect(second.pack.news.dropped).toEqual([]);
    expect(second.markdown).toContain('- New: [[Boredom]] (created 2026-11-10, modified 2026-11-10)');
    expect(second.markdown).toContain('- Changed: [[Desire as lack]] (modified 2026-11-12; was 2024-03-09)');
    expect(fs.readdirSync(path.join(copy.vault, 'Librarian', 'Source packs')).sort()).toEqual(['desire 2026-11-01.md', 'desire 2026-11-23.md']);

    // The librarian's own packs are not sources for the next pack.
    expect(second.pack.sources.some((s) => s.note.path.startsWith('Librarian/'))).toBe(false);
    // A free query is saved under a safe file name.
    const adhoc = librarian.pack('../../escape: "envy"/neighbour?', { today: TODAY, write: true, maxSources: 3 });
    expect(adhoc.written).toBe('Librarian/Source packs/escape envy neighbour 2026-11-23.md');
    expect(fs.existsSync(path.join(copy.vault, adhoc.written!))).toBe(true);
  });
});

describe('excerpt', () => {
  it('returns short text untouched and cuts long text at a sentence end, marked', () => {
    expect(excerpt('Short.', 100)).toBe('Short.');
    const long = 'First sentence here. Second sentence is a little longer. Third one never fits in the limit at all.';
    expect(excerpt(long, 70)).toBe('First sentence here. Second sentence is a little longer. […]');
    expect(excerpt('nopunctuationatallbutaverylongsinglerunofletters and more words here', 30)).toBe('nopunctuationatallbutaverylong […]');
    const cut = excerpt(long, 70);
    expect(long.startsWith(cut.slice(0, -CUT_MARK.length))).toBe(true);
  });
});
