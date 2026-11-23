import { useState } from 'react';
import { newId } from '../lib/store';
import type { Annotation, TheoryNote } from '../lib/types';
import { Markdown } from './Markdown';

interface Props {
  notes: TheoryNote[];
  annotations: Annotation[];
  today: string;
  onSave: (n: TheoryNote) => void;
  onDelete: (id: string) => void;
  onOpenAnnotation: (a: Annotation) => void;
}

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function NotesPanel({ notes, annotations, today, onSave, onDelete, onOpenAnnotation }: Props) {
  const [draft, setDraft] = useState<TheoryNote | null>(null);
  const sorted = [...notes].sort((a, b) => b.date.localeCompare(a.date));
  const start = () => setDraft({ id: newId(), date: today, title: '', body: '', refs: [] });
  const isNew = draft ? !notes.some((n) => n.id === draft.id) : false;
  const ok = draft ? isDate(draft.date) && (draft.title.trim() !== '' || draft.body.trim() !== '') : false;

  return (
    <>
      <section className="card">
        {draft ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ok) return;
              onSave({ ...draft, title: draft.title.trim() });
              setDraft(null);
            }}
          >
            <h2>{isNew ? 'New entry' : 'Edit entry'}</h2>
            <div className="row">
              <label className="field">
                <span>Date</span>
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label className="field">
                <span>Title</span>
                <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Where the theory stands (markdown)</span>
              <textarea rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </label>
            {annotations.length > 0 && (
              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="note-small strong">Annotations this entry refers to</legend>
                <div className="stack" style={{ maxHeight: 160, overflow: 'auto', gap: 4 }}>
                  {annotations.map((a) => (
                    <label key={a.id} className="check">
                      <input
                        type="checkbox"
                        checked={draft.refs.includes(a.id)}
                        onChange={(e) => setDraft({ ...draft, refs: e.target.checked ? [...draft.refs, a.id] : draft.refs.filter((r) => r !== a.id) })}
                      />
                      <span>
                        {a.title} <span className="muted small">({a.status})</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="btn-row">
              <button className="btn primary" type="submit" disabled={!ok}>
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
                    if (confirm('Delete this entry?')) {
                      onDelete(draft.id);
                      setDraft(null);
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        ) : (
          <>
            <div className="card-head">
              <h2>Theory notes</h2>
              <button className="btn primary" onClick={start}>
                New entry
              </button>
            </div>
            <p className="note-small">A dated log of how the theory is developing. Write a new entry when your thinking changes, rather than rewriting an old one, so the path stays on record.</p>
          </>
        )}
      </section>

      <section className="card">
        {sorted.length === 0 ? (
          <p className="empty">No entries yet. A first entry might say what you expect to find before you look.</p>
        ) : (
          <div className="stack">
            {sorted.map((n) => (
              <article key={n.id} className="item">
                <div className="card-head">
                  <h3>{n.title || 'Untitled entry'}</h3>
                  <span className="muted small num">{n.date}</span>
                </div>
                <Markdown text={n.body} />
                {n.refs.length > 0 && (
                  <div className="meta">
                    <span>Refers to</span>
                    {n.refs.map((id) => {
                      const a = annotations.find((x) => x.id === id);
                      return a ? (
                        <span key={id} className={`chip status-${a.status}`}>
                          <button onClick={() => onOpenAnnotation(a)}>{a.title}</button>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
                <div className="btn-row">
                  <button className="btn small" onClick={() => setDraft(n)}>
                    Edit
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
