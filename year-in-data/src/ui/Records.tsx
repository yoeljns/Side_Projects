// Where the record comes from: the other apps' documents, the chess sites, GitHub, and the lists kept here.
import { useRef, useState } from 'react';
import { importBooksCsv, mergeBooks } from '../lib/books';
import { gamesInWindow } from '../lib/chess';
import { fetchChessYear, mergeAfterFetch } from '../lib/chessFetch';
import { fmtDate, isDate, msToDate } from '../lib/dates';
import { fetchRepoYear, isRepoName, proposeBuilds } from '../lib/github';
import { type SourceId, SOURCE_APP, parseSource, sourceCount } from '../lib/sources';
import { newId, type Store } from '../lib/store';
import { isSyncCode, pull, syncAvailable } from '../lib/sync';
import type { Book, Build, Doc, SourceVia } from '../lib/types';
import { type YearWindow, elapsedEnd, inWindow } from '../lib/window';
import { githubToken, setGithubToken, setSourceCode, sourceCodes } from './local';

interface Props {
  store: Store<Doc>;
  window: YearWindow;
  today: string;
}

const yearLabel = (w: YearWindow) => `${fmtDate(w.start)} to ${fmtDate(w.last)}`;
const when = (ms: number) => fmtDate(msToDate(ms));
const message = (e: unknown, fallback: string) => (e instanceof Error && !(e instanceof TypeError) && e.message ? e.message : fallback);

function SourceRow({ id, store }: { id: SourceId; store: Store<Doc> }) {
  const app = SOURCE_APP[id];
  const have = store.state.imported[id];
  const [code, setCode] = useState(() => sourceCodes()[id] ?? '');
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const take = (raw: unknown, via: SourceVia) => {
    const { data, dropped } = parseSource(id, raw);
    store.update((s) => ({ ...s, imported: { ...s.imported, [id]: { importedAt: Date.now(), via, data } } }));
    setNote({ text: `Loaded ${sourceCount(id, data)}.${dropped ? ` ${dropped} rows did not fit the expected shape and were left out.` : ''}` });
  };
  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      take(JSON.parse(await f.text()), 'file');
    } catch (e) {
      setNote({ text: e instanceof SyntaxError ? 'That file is not JSON. Use the backup file downloaded from the app.' : message(e, 'That file could not be read.'), bad: true });
    }
  };
  const fromCode = async () => {
    setBusy(true);
    setNote(null);
    try {
      const doc = await pull<unknown>(code);
      if (!doc) throw new Error('Nothing is stored under that code.');
      take(doc, 'sync');
      setSourceCode(id, code);
    } catch (e) {
      setNote({ text: message(e, 'Could not reach the sync service.'), bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <div className="item-main stack-tight">
        <div>
          <span className="strong">{app.title}</span> <span className="muted small">{app.gives}</span>
        </div>
        <div className="small muted">
          {have ? `${sourceCount(id, have.data)}, loaded ${when(have.importedAt)} from ${have.via === 'file' ? 'a backup file' : 'its sync code'}.` : `Not loaded. Use the backup file from ${app.title} (Download backup)${syncAvailable ? ', or paste its sync code' : ''}.`}
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={() => file.current?.click()}>{have ? 'Load a newer backup file' : 'Load backup file'}</button>
          <input ref={file} type="file" accept="application/json,.json" hidden aria-label={`${app.title} backup file`} onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = ''; }} />
          {syncAvailable && (
            <>
              <input aria-label={`${app.title} sync code`} placeholder={`${app.title} sync code`} value={code} onChange={(e) => setCode(e.target.value.trim())} style={{ flex: '1 1 160px' }} autoComplete="off" />
              <button className="btn small" disabled={busy || !isSyncCode(code)} onClick={() => void fromCode()}>{busy ? 'Pulling…' : have?.via === 'sync' ? 'Pull again' : 'Pull'}</button>
            </>
          )}
          {have && <button className="btn small danger" onClick={() => { if (confirm(`Remove the ${app.title} records from this app? The other app is not touched.`)) { store.update((s) => { const imported = { ...s.imported }; delete imported[id]; return { ...s, imported }; }); setSourceCode(id, null); setCode(''); setNote(null); } }}>Remove</button>}
        </div>
        {note && <p className={`notice small${note.bad ? ' bad' : ''}`} role="status">{note.text}</p>}
      </div>
    </li>
  );
}

function Sources({ store }: { store: Store<Doc> }) {
  return (
    <section className="card">
      <div className="card-head"><h2>From the other apps</h2></div>
      <p className="muted">
        Each is a copy taken when you load it; load again to refresh. Only the fields this app counts are kept.
        {syncAvailable ? ' A sync code you paste stays in this browser and is not part of this app\'s own document.' : ' Pulling by sync code needs sync to be configured for this build (see the README), so use backup files.'}
      </p>
      <ul className="list">
        {(Object.keys(SOURCE_APP) as SourceId[]).map((id) => <SourceRow key={id} id={id} store={store} />)}
      </ul>
    </section>
  );
}

function Games({ store, window: w, today }: Props) {
  const { chess, counters } = store.state;
  const cache = chess.cache[w.key];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[] | null>(null);
  const [label, setLabel] = useState('');
  const until = elapsedEnd(w, today);
  const canFetch = (chess.lichess.trim() || chess.chesscom.trim()) && until > w.start;

  const run = async () => {
    setBusy(true);
    setFailed(null);
    const result = await fetchChessYear((url, init) => fetch(url, init), chess, w.start, until);
    setBusy(false);
    const games = mergeAfterFetch(cache?.games ?? [], result);
    if (result.failedSites.length && !cache && result.games.length === 0) {
      setFailed(result.notes); // nothing to keep: do not pretend the year was fetched
      return;
    }
    store.update((s) => ({ ...s, chess: { ...s.chess, cache: { ...s.chess.cache, [w.key]: { fetchedAt: Date.now(), notes: result.notes, games } } } }));
  };
  const setName = (site: 'lichess' | 'chesscom', v: string) => store.update((s) => ({ ...s, chess: { ...s.chess, [site]: v } }));
  const setTally = (id: string, field: 'played' | 'won', v: string) => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    store.update((s) => ({ ...s, counters: s.counters.map((c) => (c.id === id ? { ...c, byYear: { ...c.byYear, [w.key]: { ...(c.byYear[w.key] ?? { played: 0, won: 0 }), [field]: n } } } : c)) }));
  };

  return (
    <section className="card">
      <div className="card-head"><h2>Games played</h2></div>
      <h3>Chess</h3>
      <p className="muted small">Games are read from the public Lichess and Chess.com APIs for the usernames below, straight from this browser, and kept in this app's document so the page does not fetch again on every load.</p>
      <div className="form-grid">
        <label className="field"><span>Lichess username</span><input value={chess.lichess} onChange={(e) => setName('lichess', e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} /></label>
        <label className="field"><span>Chess.com username</span><input value={chess.chesscom} onChange={(e) => setName('chesscom', e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} /></label>
        <button className="btn primary" disabled={!canFetch || busy} onClick={() => void run()}>{busy ? 'Fetching…' : cache ? 'Fetch games again' : 'Fetch games for this year'}</button>
      </div>
      {cache ? (
        <div className="stack-tight">
          <p className="small"><span className="num">{gamesInWindow(cache.games, w).length}</span> games on record for {yearLabel(w)}, fetched {when(cache.fetchedAt)}.</p>
          {cache.notes.map((n) => <p key={n} className={`notice small${/failed/.test(n) ? ' bad' : ''}`}>{n}{/failed/.test(n) ? ' Games fetched earlier from that site were kept.' : ''}</p>)}
          <div className="btn-row"><button className="btn small danger" onClick={() => { if (confirm('Forget the chess games fetched for this year?')) store.update((s) => { const next = { ...s.chess.cache }; delete next[w.key]; return { ...s, chess: { ...s.chess, cache: next } }; }); }}>Forget this year's games</button></div>
        </div>
      ) : (
        <p className="muted small">{until <= w.start ? 'This year has not started.' : 'No games fetched for this year yet.'}</p>
      )}
      {failed && failed.map((n) => <p key={n} className="notice small bad" role="alert">{n}</p>)}

      <h3>Other games</h3>
      <p className="muted small">For games with no feed, such as backgammon matches, keep a tally by hand. The numbers below are for {yearLabel(w)}.</p>
      {counters.length > 0 && (
        <ul className="list">
          {counters.map((c) => (
            <li key={c.id}>
              <span className="item-main strong">{c.label}</span>
              <div className="btn-row">
                <label className="field"><span>Played</span><input className="inline-num num" type="number" min={0} inputMode="numeric" aria-label={`${c.label} played`} value={c.byYear[w.key]?.played ?? 0} onChange={(e) => setTally(c.id, 'played', e.target.value)} /></label>
                <label className="field"><span>Won</span><input className="inline-num num" type="number" min={0} inputMode="numeric" aria-label={`${c.label} won`} value={c.byYear[w.key]?.won ?? 0} onChange={(e) => setTally(c.id, 'won', e.target.value)} /></label>
                <button className="btn small danger" style={{ alignSelf: 'end' }} aria-label={`Remove ${c.label}`} onClick={() => { if (confirm(`Remove the ${c.label} tally for every year?`)) store.update((s) => ({ ...s, counters: s.counters.filter((x) => x.id !== c.id) })); }}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        <input aria-label="Name of a game to tally" placeholder="Backgammon matches" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: '1 1 180px' }} />
        <button className="btn" disabled={!label.trim()} onClick={() => { store.update((s) => ({ ...s, counters: [...s.counters, { id: newId(), label: label.trim(), byYear: {} }] })); setLabel(''); }}>Add a tally</button>
      </div>
    </section>
  );
}

const BLANK_BOOK = { title: '', author: '', finished: '', rating: '', pages: '', note: '' };

function Books({ store, window: w }: Props) {
  const [form, setForm] = useState(BLANK_BOOK);
  const [editing, setEditing] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const books = store.state.books;
  const inYear = books.filter((b) => b.finished && inWindow(b.finished, w));
  const undated = books.filter((b) => !b.finished);
  const list = (all ? books : [...inYear, ...undated]).slice().sort((a, b) => (a.finished ?? '9').localeCompare(b.finished ?? '9'));
  const set = (k: keyof typeof BLANK_BOOK) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.title.trim() !== '' && (form.finished === '' || isDate(form.finished));

  const save = () => {
    const pages = Math.floor(Number(form.pages));
    const book: Book = {
      id: editing ?? newId(),
      title: form.title.trim(),
      author: form.author.trim(),
      ...(form.finished ? { finished: form.finished } : {}),
      ...(form.rating ? { rating: Number(form.rating) } : {}),
      ...(pages > 0 ? { pages } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    };
    store.update((s) => ({ ...s, books: editing ? s.books.map((b) => (b.id === editing ? book : b)) : [...s.books, book] }));
    setForm(BLANK_BOOK);
    setEditing(null);
  };
  const edit = (b: Book) => {
    setEditing(b.id);
    setForm({ title: b.title, author: b.author, finished: b.finished ?? '', rating: b.rating ? String(b.rating) : '', pages: b.pages ? String(b.pages) : '', note: b.note ?? '' });
    document.getElementById('book-form')?.scrollIntoView?.({ block: 'nearest' });
  };
  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = importBooksCsv(await f.text());
      const merged = mergeBooks(store.state.books, r.books, newId);
      store.update((s) => ({ ...s, books: mergeBooks(s.books, r.books, newId).books }));
      const parts = [`${r.format === 'goodreads' ? 'Goodreads' : 'StoryGraph'} export: ${merged.added} books added.`];
      if (merged.skipped) parts.push(`${merged.skipped} already on the list.`);
      if (r.notRead) parts.push(`${r.notRead} rows on other shelves left out.`);
      if (r.undated) parts.push(`${r.undated} read with no finish date: add a date to count them in a year.`);
      setNote({ text: parts.join(' ') });
    } catch (e) {
      setNote({ text: message(e, 'That file could not be read.'), bad: true });
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Books</h2>
        <span className="muted small num">{inYear.length} finished in this year, {books.length} on the list</span>
      </div>
      <div className="form-grid" id="book-form">
        <label className="field"><span>Title</span><input value={form.title} onChange={set('title')} /></label>
        <label className="field"><span>Author</span><input value={form.author} onChange={set('author')} /></label>
        <label className="field"><span>Finished</span><input type="date" value={form.finished} onChange={set('finished')} /></label>
        <label className="field"><span>Rating</span>
          <select value={form.rating} onChange={set('rating')}>
            <option value="">Not rated</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} of 5</option>)}
            {form.rating && !Number.isInteger(Number(form.rating)) && <option value={form.rating}>{form.rating} of 5</option>}
          </select>
        </label>
        <label className="field"><span>Pages (optional)</span><input type="number" min={1} inputMode="numeric" value={form.pages} onChange={set('pages')} /></label>
        <label className="field span"><span>One-line note</span><input value={form.note} onChange={set('note')} maxLength={200} /></label>
        <div className="btn-row span">
          <button className="btn primary" disabled={!valid} onClick={save}>{editing ? 'Save book' : 'Add book'}</button>
          {editing && <button className="btn" onClick={() => { setEditing(null); setForm(BLANK_BOOK); }}>Cancel</button>}
          <button className="btn" onClick={() => file.current?.click()}>Import CSV</button>
          <input ref={file} type="file" accept=".csv,text/csv" hidden aria-label="Books CSV file" onChange={(e) => { void importCsv(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
      <p className="muted small">CSV import reads a Goodreads library export or a StoryGraph export. Only books marked read are taken, and a book already on the list (same title and author) is not added twice.</p>
      {note && <p className={`notice small${note.bad ? ' bad' : ''}`} role="status">{note.text}</p>}
      {list.length === 0 ? <p className="empty">{books.length ? 'No books finished in this year.' : 'No books yet. Add the first, or import a CSV.'}</p> : (
        <ul className="list">
          {list.map((b) => (
            <li key={b.id}>
              <div className="item-main">
                <span className="strong">{b.title}</span>{b.author && <span className="muted"> {b.author}</span>}
                <div className="small muted num">
                  {b.finished ? fmtDate(b.finished) : 'No finish date'}{b.rating ? `, ${b.rating} of 5` : ''}{b.pages ? `, ${b.pages} pages` : ''}{b.note ? `. ${b.note}` : ''}
                </div>
              </div>
              <div className="btn-row">
                <button className="btn small" aria-label={`Edit ${b.title}`} onClick={() => edit(b)}>Edit</button>
                <button className="btn small danger" aria-label={`Remove ${b.title}`} onClick={() => store.update((s) => ({ ...s, books: s.books.filter((x) => x.id !== b.id) }))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {books.length > inYear.length + undated.length && <div className="btn-row"><button className="btn small" onClick={() => setAll(!all)}>{all ? 'Show this year only' : `Show all ${books.length} books`}</button></div>}
    </section>
  );
}

const BLANK_BUILD = { name: '', shipped: '', link: '', note: '' };

function Builds({ store, window: w, today }: Props) {
  const [form, setForm] = useState(BLANK_BUILD);
  const [editing, setEditing] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState(githubToken);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { builds, github } = store.state;
  const inYear = builds.filter((b) => inWindow(b.shipped, w));
  const list = (all ? builds : inYear).slice().sort((a, b) => a.shipped.localeCompare(b.shipped));
  const set = (k: keyof typeof BLANK_BUILD) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.name.trim() !== '' && isDate(form.shipped);
  const until = elapsedEnd(w, today);

  const save = () => {
    const build: Build = { id: editing ?? newId(), name: form.name.trim(), shipped: form.shipped, ...(form.link.trim() ? { link: form.link.trim() } : {}), ...(form.note.trim() ? { note: form.note.trim() } : {}) };
    store.update((s) => ({ ...s, builds: editing ? s.builds.map((b) => (b.id === editing ? build : b)) : [...s.builds, build] }));
    setForm(BLANK_BUILD);
    setEditing(null);
  };
  const fetchRepo = async (name: string) => {
    setBusy(name);
    setErrors((e) => ({ ...e, [name]: '' }));
    try {
      const summary = await fetchRepoYear((url, init) => fetch(url, init), name, w, until, token.trim() || null, Date.now());
      store.update((s) => ({ ...s, github: { ...s.github, cache: { ...s.github.cache, [w.key]: { ...s.github.cache[w.key], [name]: summary } } } }));
    } catch (e) {
      setErrors((x) => ({ ...x, [name]: message(e, 'Could not reach GitHub.') }));
    } finally {
      setBusy(null);
    }
  };
  const removeRepo = (name: string) => store.update((s) => ({
    ...s,
    github: { repos: s.github.repos.filter((r) => r !== name), cache: Object.fromEntries(Object.entries(s.github.cache).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([r]) => r !== name))])) },
  }));

  return (
    <section className="card">
      <div className="card-head">
        <h2>Builds shipped</h2>
        <span className="muted small num">{inYear.length} in this year, {builds.length} on the list</span>
      </div>
      <div className="form-grid">
        <label className="field"><span>Name</span><input value={form.name} onChange={set('name')} /></label>
        <label className="field"><span>Shipped</span><input type="date" value={form.shipped} onChange={set('shipped')} /></label>
        <label className="field"><span>Link (optional)</span><input type="url" value={form.link} onChange={set('link')} placeholder="https://" /></label>
        <label className="field span"><span>One line</span><input value={form.note} onChange={set('note')} maxLength={200} /></label>
        <div className="btn-row span">
          <button className="btn primary" disabled={!valid} onClick={save}>{editing ? 'Save build' : 'Add build'}</button>
          {editing && <button className="btn" onClick={() => { setEditing(null); setForm(BLANK_BUILD); }}>Cancel</button>}
        </div>
      </div>
      {list.length === 0 ? <p className="empty">{builds.length ? 'No builds shipped in this year.' : 'No builds yet. Add one, or propose them from a repository below.'}</p> : (
        <ul className="list">
          {list.map((b) => (
            <li key={b.id}>
              <div className="item-main">
                <span className="strong">{b.name}</span>
                <div className="small muted">{fmtDate(b.shipped)}{b.note ? `. ${b.note}` : ''} {b.link && <a href={b.link} target="_blank" rel="noreferrer">Link</a>}</div>
              </div>
              <div className="btn-row">
                <button className="btn small" aria-label={`Edit ${b.name}`} onClick={() => { setEditing(b.id); setForm({ name: b.name, shipped: b.shipped, link: b.link ?? '', note: b.note ?? '' }); }}>Edit</button>
                <button className="btn small danger" aria-label={`Remove ${b.name}`} onClick={() => store.update((s) => ({ ...s, builds: s.builds.filter((x) => x.id !== b.id) }))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {builds.length > inYear.length && <div className="btn-row"><button className="btn small" onClick={() => setAll(!all)}>{all ? 'Show this year only' : `Show all ${builds.length} builds`}</button></div>}

      <h3>From GitHub</h3>
      <p className="muted small">
        For a repository, this counts the year's commits by month and by top-level folder, and proposes as builds the folders whose first commit falls in the year. You confirm each one. Commit messages and author names are not kept.
      </p>
      <div className="form-grid">
        <label className="field"><span>Repository (owner/name)</span><input value={repo} onChange={(e) => setRepo(e.target.value.trim())} placeholder="owner/name" autoCapitalize="off" spellCheck={false} /></label>
        <button className="btn" disabled={!isRepoName(repo) || github.repos.includes(repo)} onClick={() => { store.update((s) => ({ ...s, github: { ...s.github, repos: [...s.github.repos, repo] } })); setRepo(''); }}>Add repository</button>
        <label className="field"><span>Access token (optional, for private repositories)</span><input type="password" value={token} onChange={(e) => { setToken(e.target.value); setGithubToken(e.target.value); }} autoComplete="off" spellCheck={false} /></label>
      </div>
      <p className="muted small">The token is kept in this browser only. It is not in backups, not synced, and is sent only to api.github.com. Without one, GitHub allows 60 requests an hour, and a repository needs about two per top-level folder.</p>
      {github.repos.length > 0 && (
        <ul className="list">
          {github.repos.map((name) => {
            const sum = github.cache[w.key]?.[name];
            const proposals = sum ? proposeBuilds(sum, builds) : [];
            return (
              <li key={name}>
                <div className="item-main stack-tight">
                  <div className="strong wrap-any">{name}</div>
                  <div className="small muted num">{sum ? `${sum.total}${sum.truncated ? ' or more' : ''} commits in this year across ${sum.folders.filter((f) => f.commits > 0).length} folders, fetched ${when(sum.fetchedAt)}.` : 'Not fetched for this year.'}</div>
                  {errors[name] && <p className="notice small bad" role="alert">{errors[name]}</p>}
                  {proposals.length > 0 && (
                    <div className="stack-tight">
                      <div className="tbl-title">Folders first committed to in this year</div>
                      {proposals.map((p) => (
                        <div className="btn-row" key={p.name}>
                          <span className="item-main small"><span className="strong">{p.name}</span> <span className="muted">first commit {fmtDate(p.shipped)}</span></span>
                          <button className="btn small" onClick={() => store.update((s) => ({ ...s, builds: [...s.builds, { id: newId(), ...p }] }))}>Add to builds</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="btn-row">
                  <button className="btn small" disabled={busy !== null || until <= w.start} onClick={() => void fetchRepo(name)}>{busy === name ? 'Fetching…' : sum ? 'Fetch again' : 'Fetch this year'}</button>
                  <button className="btn small danger" aria-label={`Remove ${name}`} onClick={() => removeRepo(name)}>Remove</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Records(props: Props) {
  return (
    <div className="stack">
      <p className="muted">Records for <span className="strong">{yearLabel(props.window)}</span>. Every source is optional; the review shows what is here and says what is not.</p>
      <Sources store={props.store} />
      <Games {...props} />
      <Books {...props} />
      <Builds {...props} />
    </div>
  );
}
