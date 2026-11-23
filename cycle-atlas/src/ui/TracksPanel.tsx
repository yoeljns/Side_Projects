import { useRef, useState } from 'react';
import { parseSeriesCsv, type CsvResult } from '../lib/csv';
import { allTracks, duplicateTrack, isBuiltin, newTrack, removeItem, removeTrack, restoreBuiltins, setTrackPref, updateTrack, upsertEvent, upsertPhase } from '../lib/model';
import { newId } from '../lib/store';
import { EVENT_KINDS, EVENT_KIND_LABEL, KIND_LABEL, PALETTE_NAMES, PHASE_KINDS, type AtlasDoc, type CycleEvent, type EventKind, type Phase, type PhaseKind, type Series, type Track } from '../lib/types';
import { colorVar, years } from './marks';

interface Props {
  doc: AtlasDoc;
  update: (fn: (d: AtlasDoc) => AtlasDoc) => void;
  nowYear: number;
  editTrackId: string | null;
  setEditTrackId: (id: string | null) => void;
  editItemId: string | null;
  setEditItemId: (id: string | null) => void;
}

function Palette({ value, onChange, name }: { value: number; onChange: (n: number) => void; name: string }) {
  return (
    <div className="palette" role="radiogroup" aria-label="Colour">
      {PALETTE_NAMES.map((label, i) => (
        <label key={label}>
          <input type="radio" name={name} checked={value === i} onChange={() => onChange(i)} />
          <span className="swatch" style={{ background: colorVar(i) }} />
          {label}
        </label>
      ))}
    </div>
  );
}

function ItemsTable({ track }: { track: Track }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {track.phases.map((p) => (
            <tr key={p.id}>
              <td className="small num" style={{ whiteSpace: 'nowrap' }}>{years(p)}</td>
              <td className="small">
                {p.name} <span className="muted">[{KIND_LABEL[p.kind].toLowerCase()}]</span>
                {p.note && <div className="muted">{p.note}</div>}
              </td>
              <td className="small muted">{p.source}</td>
            </tr>
          ))}
          {track.events.map((e) => (
            <tr key={e.id}>
              <td className="small num" style={{ whiteSpace: 'nowrap' }}>{e.approximate ? 'c. ' : ''}{e.year}</td>
              <td className="small">
                {e.label} <span className="muted">[{EVENT_KIND_LABEL[e.kind].toLowerCase()} event]</span>
                {e.note && <div className="muted">{e.note}</div>}
              </td>
              <td className="small muted">{e.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ItemDraft = { what: 'phase'; v: Phase; endText: string } | { what: 'event'; v: CycleEvent };

function ItemForm({ draft, setDraft, onSave, onDelete, isNew }: { draft: ItemDraft; setDraft: (d: ItemDraft | null) => void; onSave: () => void; onDelete: () => void; isNew: boolean }) {
  const set = (patch: Partial<Omit<Phase, 'kind'>> & Partial<Omit<CycleEvent, 'kind'>> & { kind?: PhaseKind | EventKind }) => setDraft({ ...draft, v: { ...draft.v, ...patch } } as ItemDraft);
  return (
    <form
      className="stack"
      style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <label className="field">
        <span>{draft.what === 'phase' ? 'Phase name' : 'Event label'}</span>
        <input autoFocus value={draft.what === 'phase' ? draft.v.name : draft.v.label} onChange={(e) => set(draft.what === 'phase' ? { name: e.target.value } : { label: e.target.value })} />
      </label>
      {draft.what === 'phase' ? (
        <div className="rows3">
          <label className="field">
            <span>Start year</span>
            <input type="number" className="num" value={draft.v.start} onChange={(e) => set({ start: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>End year</span>
            <input type="number" className="num" value={draft.endText} placeholder="open" onChange={(e) => setDraft({ ...draft, endText: e.target.value })} />
          </label>
          <label className="field">
            <span>Kind</span>
            <select value={draft.v.kind} onChange={(e) => set({ kind: e.target.value as PhaseKind })}>
              {PHASE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="row">
          <label className="field">
            <span>Year</span>
            <input type="number" className="num" value={draft.v.year} onChange={(e) => set({ year: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Kind</span>
            <select value={draft.v.kind} onChange={(e) => set({ kind: e.target.value as EventKind })}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label className="field">
        <span>Source citation</span>
        <input value={draft.v.source} onChange={(e) => set({ source: e.target.value })} placeholder="Author (year), title, page" />
      </label>
      <label className="field">
        <span>Note</span>
        <input value={draft.v.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={Boolean(draft.v.approximate)} onChange={(e) => set({ approximate: e.target.checked || undefined })} />
        Approximate or disputed date
      </label>
      <div className="btn-row">
        <button className="btn primary small" type="submit">
          Save
        </button>
        <button className="btn small" type="button" onClick={() => setDraft(null)}>
          Cancel
        </button>
        {!isNew && (
          <button className="btn danger small" type="button" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

function TrackEditor({ track, update, nowYear, editItemId, setEditItemId, onDone }: { track: Track; update: Props['update']; nowYear: number; editItemId: string | null; setEditItemId: (id: string | null) => void; onDone: () => void }) {
  const [fresh, setFresh] = useState<ItemDraft | null>(null);
  const [edit, setEdit] = useState<ItemDraft | null>(null);
  const change = (fn: (t: Track) => Track) => update((d) => updateTrack(d, track.id, fn));

  // Open the form for the item chosen on the timeline or in the list.
  const current: ItemDraft | null = (() => {
    if (fresh) return fresh;
    if (!editItemId) return null;
    if (edit && edit.v.id === editItemId) return edit;
    const p = track.phases.find((x) => x.id === editItemId);
    if (p) return { what: 'phase', v: p, endText: p.end === null ? '' : String(p.end) };
    const e = track.events.find((x) => x.id === editItemId);
    return e ? { what: 'event', v: e } : null;
  })();
  const setCurrent = (d: ItemDraft | null) => {
    if (fresh) setFresh(d);
    else {
      setEdit(d);
      if (!d) setEditItemId(null);
    }
  };
  const save = () => {
    if (!current) return;
    if (current.what === 'phase') {
      const end = current.endText.trim() === '' ? null : Number(current.endText);
      change((t) => upsertPhase(t, { ...current.v, end: end !== null && Number.isFinite(end) ? end : null }, nowYear));
    } else change((t) => upsertEvent(t, current.v, nowYear));
    setFresh(null);
    setEdit(null);
    setEditItemId(null);
  };
  const lastEnd = track.phases.reduce((m, p) => Math.max(m, p.end ?? p.start), 0) || nowYear - 20;
  const lastSource = track.phases[track.phases.length - 1]?.source ?? track.events[track.events.length - 1]?.source ?? '';

  return (
    <div className="stack">
      <div className="row">
        <label className="field">
          <span>Track name</span>
          <input value={track.name} onChange={(e) => change((t) => ({ ...t, name: e.target.value }))} />
        </label>
        <label className="field">
          <span>Whose dating</span>
          <input value={track.author} onChange={(e) => change((t) => ({ ...t, author: e.target.value }))} />
        </label>
      </div>
      <Palette name={`colour-${track.id}`} value={track.color} onChange={(color) => change((t) => ({ ...t, color }))} />
      <div className="stack" style={{ gap: 4 }}>
        {track.phases.length + track.events.length === 0 && <p className="note-small">No phases or events yet. Add the first one below.</p>}
        <ul className="plain-list">
          {track.phases.map((p) => (
            <li key={p.id}>
              <button className="linkish" onClick={() => { setFresh(null); setEdit(null); setEditItemId(p.id); }}>
                <span className="num">{years(p)}</span> · {p.name}
              </button>
              <span className="muted small">{KIND_LABEL[p.kind].toLowerCase()}</span>
            </li>
          ))}
          {track.events.map((e) => (
            <li key={e.id}>
              <button className="linkish" onClick={() => { setFresh(null); setEdit(null); setEditItemId(e.id); }}>
                <span className="num">{e.year}</span> · {e.label}
              </button>
              <span className="muted small">{EVENT_KIND_LABEL[e.kind].toLowerCase()} event</span>
            </li>
          ))}
        </ul>
      </div>
      {current && (
        <ItemForm
          key={current.v.id}
          draft={current}
          setDraft={setCurrent}
          isNew={Boolean(fresh)}
          onSave={save}
          onDelete={() => {
            change((t) => removeItem(t, current.v.id));
            setEdit(null);
            setEditItemId(null);
          }}
        />
      )}
      <div className="btn-row">
        <button className="btn small" onClick={() => { setEditItemId(null); setFresh({ what: 'phase', v: { id: newId(), name: '', start: lastEnd, end: lastEnd + 10, kind: 'expansion', source: lastSource }, endText: String(lastEnd + 10) }); }}>
          Add phase
        </button>
        <button className="btn small" onClick={() => { setEditItemId(null); setFresh({ what: 'event', v: { id: newId(), label: '', year: lastEnd, kind: 'peak', source: lastSource } }); }}>
          Add event
        </button>
        <button className="btn small" onClick={onDone}>
          Done
        </button>
        <button
          className="btn small danger"
          onClick={() => {
            if (confirm(`Delete the track "${track.name}"? Links into it are deleted too.`)) {
              update((d) => removeTrack(d, track.id));
              onDone();
            }
          }}
        >
          Delete track
        </button>
      </div>
      <p className="note-small">On the timeline, drag the dark handles at the ends of a phase to re-date it. A boundary shared by two phases moves both.</p>
    </div>
  );
}

function SeriesSection({ doc, update }: Pick<Props, 'doc' | 'update'>) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [log, setLog] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const parsed: CsvResult | null = text.trim() ? parseSeriesCsv(text) : null;
  const ok = Boolean(parsed && parsed.points.length >= 2 && name.trim());
  const patch = (id: string, p: Partial<Series>) => update((d) => ({ ...d, series: d.series.map((s) => (s.id === id ? { ...s, ...p } : s)) }));

  return (
    <section className="card">
      <h2>Data series</h2>
      {doc.series.length === 0 ? (
        <p className="note-small">None yet, and none are bundled: add a series you have sourced yourself (a commodity price index, debt to GDP) and it is drawn as a line in its own lane, with its own value scale.</p>
      ) : (
        <div className="stack">
          {doc.series.map((s) => (
            <div key={s.id} className="item">
              <div className="meta">
                <span className="swatch" style={{ background: colorVar(s.color) }} />
                <span className="strong" style={{ color: 'var(--text)' }}>{s.name}</span>
                <span className="num">
                  {s.points.length} points, {Math.floor(s.points[0]?.year ?? 0)} to {Math.floor(s.points[s.points.length - 1]?.year ?? 0)}
                </span>
              </div>
              {s.source && <div className="note-small">Source: {s.source}</div>}
              <div className="btn-row">
                <label className="check small">
                  <input type="checkbox" checked={s.log} onChange={(e) => patch(s.id, { log: e.target.checked })} /> Log scale
                </label>
                <label className="check small">
                  <input type="checkbox" checked={!s.hidden} onChange={(e) => patch(s.id, { hidden: !e.target.checked })} /> Shown
                </label>
                <button className="btn small danger" onClick={() => { if (confirm(`Delete the series "${s.name}"?`)) update((d) => ({ ...d, series: d.series.filter((x) => x.id !== s.id) })); }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <details>
        <summary>Add a series from CSV</summary>
        <div className="stack">
          <div className="row">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Source</span>
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Where the numbers come from" />
            </label>
          </div>
          <label className="field">
            <span>Rows of year,value (a header line is fine)</span>
            <textarea rows={5} className="num" value={text} onChange={(e) => setText(e.target.value)} placeholder={'year,value\n1970,100\n1971,104.2\n1972-06,110'} />
          </label>
          <p className="note-small">The year can be 1973, 1973.5, 1973-10 or 1973-10-17. Commas, semicolons or tabs separate the two columns; extra columns are ignored. Values must be plain numbers.</p>
          {parsed && (
            <div className="note-small" role="status">
              <span className="num">{parsed.points.length} points read</span>
              {parsed.points.length > 0 && <span className="num">, {parsed.points[0].year} to {parsed.points[parsed.points.length - 1].year}</span>}
              {parsed.headerSkipped && ', header skipped'}
              {parsed.duplicates.length > 0 && `, ${parsed.duplicates.length} repeated ${parsed.duplicates.length === 1 ? 'year' : 'years'} (last value kept)`}.
              {parsed.problems.length > 0 && (
                <ul className="bad" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {parsed.problems.slice(0, 5).map((p) => (
                    <li key={p.line}>
                      Line {p.line}: {p.why} ("{p.text}")
                    </li>
                  ))}
                  {parsed.problems.length > 5 && <li>and {parsed.problems.length - 5} more lines</li>}
                </ul>
              )}
              {log && parsed.points.some((p) => p.value <= 0) && <div className="warn">Values at or below zero cannot be drawn on a log scale and will be skipped.</div>}
            </div>
          )}
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={!ok}
              onClick={() => {
                if (!parsed) return;
                update((d) => ({ ...d, series: [...d.series, { id: newId(), name: name.trim(), source: source.trim(), log, color: (5 + d.series.length) % 8, points: parsed.points }] }));
                setName('');
                setSource('');
                setText('');
              }}
            >
              Add series
            </button>
            <button className="btn" onClick={() => file.current?.click()}>
              Import a CSV file
            </button>
            <input
              ref={file}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void f.text().then(setText);
                  if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
                }
                e.target.value = '';
              }}
            />
            <label className="check">
              <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale
            </label>
          </div>
          {!ok && parsed && <p className="note-small">{!name.trim() ? 'Give the series a name.' : 'At least two points are needed to draw a line.'}</p>}
        </div>
      </details>
    </section>
  );
}

export function TracksPanel({ doc, update, nowYear, editTrackId, setEditTrackId, editItemId, setEditItemId }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(5);
  const tracks = allTracks(doc);
  const anyBuiltinChanged = Object.keys(doc.trackPrefs).some(isBuiltin);

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Tracks</h2>
          {anyBuiltinChanged && (
            <button className="btn small" onClick={() => update(restoreBuiltins)}>
              Restore built-in tracks
            </button>
          )}
        </div>
        <p className="note-small">Built-in tracks are published chronologies, each one author's dating rather than established fact. They cannot be edited: duplicate one to get a copy that is yours to re-date. The original stays as it was.</p>
        <div className="stack">
          {tracks.map((t) => {
            const pref = doc.trackPrefs[t.id] ?? {};
            const own = !isBuiltin(t.id);
            const editing = editTrackId === t.id;
            return (
              <div key={t.id} className={`item${editing ? ' sel' : ''}`}>
                <div className="meta">
                  <span className="swatch" style={{ background: colorVar(t.color) }} />
                  <span className="strong" style={{ color: 'var(--text)', fontSize: 14 }}>{t.name}</span>
                  <span className="chip">{own ? (t.copiedFrom ? 'My copy' : 'Mine') : 'Built-in'}</span>
                  {pref.hidden && <span className="chip">Hidden</span>}
                  {pref.dimmed && !pref.hidden && <span className="chip">Dimmed</span>}
                </div>
                <div className="note-small">{t.author}</div>
                <div className="btn-row">
                  <button className="btn small" aria-pressed={!pref.hidden} onClick={() => update((d) => setTrackPref(d, t.id, { hidden: !pref.hidden }))}>
                    {pref.hidden ? 'Show' : 'Hide'}
                  </button>
                  <button className="btn small" aria-pressed={Boolean(pref.dimmed)} onClick={() => update((d) => setTrackPref(d, t.id, { dimmed: !pref.dimmed }))}>
                    {pref.dimmed ? 'Undim' : 'Dim'}
                  </button>
                  <button
                    className="btn small"
                    onClick={() => {
                      let id: string | null = null;
                      update((d) => {
                        const r = duplicateTrack(d, t.id, newId);
                        id = r?.id ?? null;
                        return r ? r.doc : d;
                      });
                      if (id) setEditTrackId(id);
                    }}
                  >
                    {own ? 'Duplicate' : 'Duplicate to edit'}
                  </button>
                  {own && !editing && (
                    <button className="btn small" onClick={() => { setEditItemId(null); setEditTrackId(t.id); }}>
                      Edit
                    </button>
                  )}
                </div>
                {editing && own ? (
                  <TrackEditor track={t} update={update} nowYear={nowYear} editItemId={editItemId} setEditItemId={setEditItemId} onDone={() => { setEditTrackId(null); setEditItemId(null); }} />
                ) : (
                  <details>
                    <summary>
                      {t.phases.length} phases, {t.events.length} events, with sources
                    </summary>
                    {t.description && <p className="small" style={{ marginBottom: 8 }}>{t.description}</p>}
                    <ItemsTable track={t} />
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>New track</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            let id = '';
            update((d) => {
              const r = newTrack(d, name, color, newId);
              id = r.id;
              return r.doc;
            });
            setName('');
            setEditItemId(null);
            setEditTrackId(id);
          }}
        >
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My long cycle" />
          </label>
          <Palette name="colour-new" value={color} onChange={setColor} />
          <div className="btn-row">
            <button className="btn primary" type="submit" disabled={!name.trim()}>
              Create track
            </button>
          </div>
        </form>
      </section>

      <SeriesSection doc={doc} update={update} />
    </>
  );
}
