import { useState } from 'react';
import { allTags, annotationProblem, annotationYears, filterAnnotations, lagPhrase, linkLag, linkTargets, parseTags, refKey, type AnnotationFilter } from '../lib/model';
import { CONFIDENCES, STATUSES, type Annotation, type ItemRef, type Status, type Track } from '../lib/types';
import { Markdown } from './Markdown';

interface Props {
  annotations: Annotation[];
  tracks: Track[];
  nowYear: number;
  draft: Annotation | null;
  setDraft: (a: Annotation | null) => void;
  isNew: boolean;
  filter: AnnotationFilter;
  setFilter: (f: AnnotationFilter) => void;
  selectedId: string | null;
  onOpen: (a: Annotation) => void;
  onSave: (a: Annotation) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, s: Status) => void;
  onNew: (kind: Annotation['kind']) => void;
}

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

export function describeWhen(a: Annotation, tracks: Track[], nowYear: number): string {
  if (a.kind === 'pin') return `Pin at ${a.year}`;
  if (a.kind === 'span') return `Span ${a.start} to ${a.end} (${a.end - a.start} years)`;
  const l = linkLag(tracks, a.from, a.to, nowYear);
  if (!l) return 'Link to an item that no longer exists';
  return `${l.from.trackName}: ${l.from.label} (${l.from.year}) ${lagPhrase(l.lag)} ${l.to.trackName}: ${l.to.label} (${l.to.year})`;
}

function RefPicker({ label, value, tracks, nowYear, onChange }: { label: string; value: ItemRef; tracks: Track[]; nowYear: number; onChange: (r: ItemRef) => void }) {
  const track = tracks.find((t) => t.id === value.trackId);
  const targets = track ? linkTargets(track, nowYear) : [];
  return (
    <div className="row">
      <label className="field">
        <span>{label}: track</span>
        <select value={value.trackId} onChange={(e) => onChange({ trackId: e.target.value, itemId: '' })}>
          <option value="">Choose…</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{label}: item</span>
        <select
          value={value.itemId ? refKey(value) : ''}
          disabled={!track}
          onChange={(e) => {
            const t = targets.find((x) => refKey(x.ref) === e.target.value);
            onChange(t ? t.ref : { trackId: value.trackId, itemId: '' });
          }}
        >
          <option value="">Choose…</option>
          {targets.map((t) => (
            <option key={refKey(t.ref)} value={refKey(t.ref)}>
              {t.year} · {t.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Editor({ draft, setDraft, isNew, tracks, nowYear, onSave, onDelete }: Pick<Props, 'setDraft' | 'isNew' | 'tracks' | 'nowYear' | 'onSave' | 'onDelete'> & { draft: Annotation }) {
  const [tagText, setTagText] = useState(draft.tags.join(', '));
  const [tried, setTried] = useState(false);
  const withTags = { ...draft, tags: parseTags(tagText) } as Annotation;
  const problem = annotationProblem(withTags, tracks, nowYear);
  const lag = draft.kind === 'link' ? linkLag(tracks, draft.from, draft.to, nowYear) : null;

  const setKind = (kind: Annotation['kind']) => {
    if (kind === draft.kind) return;
    const { id, title, body, tags, confidence, status, createdOn, updatedOn, log } = draft;
    const base = { id, title, body, tags, confidence, status, createdOn, updatedOn, log };
    const y = draft.kind === 'pin' ? draft.year : draft.kind === 'span' ? draft.start : (lag?.from.year ?? nowYear);
    const trackId = draft.kind === 'link' ? undefined : draft.trackId;
    if (kind === 'pin') setDraft({ ...base, kind, year: y, trackId });
    else if (kind === 'span') setDraft({ ...base, kind, start: y, end: y + 10, trackId });
    else setDraft({ ...base, kind, from: { trackId: trackId ?? '', itemId: '' }, to: { trackId: '', itemId: '' } });
  };

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!problem) onSave(withTags);
      }}
    >
      <div className="card-head">
        <h2>{isNew ? 'New annotation' : 'Edit annotation'}</h2>
        <div className="seg" role="group" aria-label="Kind of annotation">
          {(['pin', 'span', 'link'] as const).map((k) => (
            <button type="button" key={k} className={draft.kind === k ? 'on' : ''} aria-pressed={draft.kind === k} onClick={() => setKind(k)}>
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Title</span>
        <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="What you think is going on here" />
      </label>
      {draft.kind === 'pin' && (
        <div className="row">
          <label className="field">
            <span>Year</span>
            <input type="number" className="num" value={Number.isFinite(draft.year) ? draft.year : ''} onChange={(e) => setDraft({ ...draft, year: num(e.target.value) })} />
          </label>
          <LanePicker value={draft.trackId} tracks={tracks} onChange={(trackId) => setDraft({ ...draft, trackId })} />
        </div>
      )}
      {draft.kind === 'span' && (
        <div className="rows3">
          <label className="field">
            <span>From year</span>
            <input type="number" className="num" value={Number.isFinite(draft.start) ? draft.start : ''} onChange={(e) => setDraft({ ...draft, start: num(e.target.value) })} />
          </label>
          <label className="field">
            <span>To year</span>
            <input type="number" className="num" value={Number.isFinite(draft.end) ? draft.end : ''} onChange={(e) => setDraft({ ...draft, end: num(e.target.value) })} />
          </label>
          <LanePicker value={draft.trackId} tracks={tracks} onChange={(trackId) => setDraft({ ...draft, trackId })} />
        </div>
      )}
      {draft.kind === 'link' && (
        <>
          <RefPicker label="From" value={draft.from} tracks={tracks} nowYear={nowYear} onChange={(from) => setDraft({ ...draft, from })} />
          <RefPicker label="To" value={draft.to} tracks={tracks} nowYear={nowYear} onChange={(to) => setDraft({ ...draft, to })} />
          <p className="note-small" role="status">
            {lag ? (
              <>
                The first item <b className="num">{lagPhrase(lag.lag)}</b> ({lag.from.year} to {lag.to.year}). One pair of dates is an observation, not a regularity.
              </>
            ) : (
              'Pick an item on each of two tracks to see the lag in years. You can also select an item on the timeline and use "Link from".'
            )}
          </p>
        </>
      )}
      <label className="field">
        <span>Notes (markdown: **bold**, *italic*, - lists, [links](https://…))</span>
        <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4} />
      </label>
      <label className="field">
        <span>Tags, separated by commas</span>
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="lags, oil" />
      </label>
      <div className="row">
        <label className="field">
          <span>Status</span>
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Confidence</span>
          <select value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: e.target.value as Annotation['confidence'] })}>
            {CONFIDENCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {tried && problem && (
        <p className="bad small" role="alert">
          {problem}
        </p>
      )}
      <div className="btn-row">
        <button className="btn primary" type="submit">
          Save
        </button>
        <button className="btn" type="button" onClick={() => setDraft(null)}>
          Cancel
        </button>
        {!isNew && (
          <button
            className="btn danger"
            type="button"
            onClick={() => {
              if (confirm('Delete this annotation for good? To keep a record of an idea that did not hold up, set its status to dropped instead.')) onDelete(draft.id);
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

function LanePicker({ value, tracks, onChange }: { value: string | undefined; tracks: Track[]; onChange: (id: string | undefined) => void }) {
  return (
    <label className="field">
      <span>Lane</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">All lanes</option>
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AnnotationsPanel(p: Props) {
  const { annotations, tracks, nowYear, draft, filter, setFilter, selectedId } = p;
  const tags = allTags(annotations);
  const shown = filterAnnotations(annotations, filter)
    .map((a) => ({ a, y: annotationYears(a, tracks, nowYear)?.start ?? Infinity }))
    .sort((x, y) => x.y - y.y)
    .map((x) => x.a);
  const droppedCount = annotations.filter((a) => a.status === 'dropped').length;

  return (
    <>
      {draft ? (
        <section className="card">
          <Editor key={draft.id} draft={draft} setDraft={p.setDraft} isNew={p.isNew} tracks={tracks} nowYear={nowYear} onSave={p.onSave} onDelete={p.onDelete} />
        </section>
      ) : (
        <section className="card">
          <div className="card-head">
            <h2>Add an annotation</h2>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => p.onNew('pin')}>Pin at a year</button>
            <button className="btn" onClick={() => p.onNew('span')}>Span of years</button>
            <button className="btn" onClick={() => p.onNew('link')}>Link two items</button>
          </div>
          <p className="note-small">Or click an empty part of a lane to pin that year, or select an item and link from it.</p>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Annotations</h2>
          <span className="muted small num">
            {shown.length} of {annotations.length} shown
          </span>
        </div>
        {annotations.length === 0 ? (
          <p className="empty">Nothing yet. Annotations are your layer over the published chronologies: a pin marks a year, a span marks a stretch, a link ties two items on different tracks and shows the lag between them.</p>
        ) : (
          <>
            <div className="rows3">
              <label className="field">
                <span>Status</span>
                <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as AnnotationFilter['status'] })}>
                  <option value="active">Active (not dropped)</option>
                  <option value="all">All</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Tag</span>
                <select value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value })}>
                  <option value="">Any tag</option>
                  {tags.map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag} ({t.count})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Search</span>
                <input value={filter.text ?? ''} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
              </label>
            </div>
            <p className="note-small">
              The timeline shows the same selection.
              {droppedCount > 0 && filter.status === 'active' && (
                <>
                  {' '}
                  <button className="linkish" onClick={() => setFilter({ ...filter, status: 'dropped' })}>
                    {droppedCount} dropped {droppedCount === 1 ? 'idea is' : 'ideas are'} kept on record
                  </button>
                  .
                </>
              )}
            </p>
            {shown.length === 0 && <p className="empty">No annotation matches this filter.</p>}
            <div className="stack">
              {shown.map((a) => (
                <article key={a.id} className={`item${a.status === 'dropped' ? ' dropped' : ''}${selectedId === a.id ? ' sel' : ''}`}>
                  <button className="item-title" onClick={() => p.onOpen(a)} title="Show on the timeline">
                    {a.title}
                  </button>
                  <div className="meta num">{describeWhen(a, tracks, nowYear)}</div>
                  <div className="meta">
                    <span className={`chip status-${a.status}`}>{a.status}</span>
                    <span>{a.confidence} confidence</span>
                    {a.tags.map((t) => (
                      <span key={t} className="chip">
                        <button onClick={() => setFilter({ ...filter, tag: t })} title={`Show only #${t}`}>
                          #{t}
                        </button>
                      </span>
                    ))}
                  </div>
                  <Markdown text={a.body} />
                  {a.log.length > 1 && (
                    <details>
                      <summary>History ({a.log.length})</summary>
                      <ul className="plain-list num">
                        {a.log.map((l, i) => (
                          <li key={i}>
                            <span>{l.change}</span>
                            <span className="muted">{l.on}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="btn-row">
                    <button className="btn small" onClick={() => p.setDraft(a)}>
                      Edit
                    </button>
                    <select aria-label={`Status of ${a.title}`} value={a.status} onChange={(e) => p.onStatus(a.id, e.target.value as Status)} style={{ padding: '3px 6px', fontSize: 12.5 }}>
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    {a.status !== 'dropped' && (
                      <button className="btn small" onClick={() => p.onStatus(a.id, 'dropped')}>
                        Drop
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
