import { useState } from 'react';
import { exampleDecisions, hasExamples, withoutExamples } from '../lib/example';
import { reviewsToIcs } from '../lib/ics';
import { addCategory, removeCategory, renameCategory, statusOf, type Doc } from '../lib/model';
import type { Store } from '../lib/store';
import { downloadText } from './format';
import { SyncPanel } from './SyncPanel';

interface Props {
  doc: Doc;
  today: string;
  update: (fn: (d: Doc) => Doc) => void;
  store: Store<Doc>;
}

function CategoryRow({ name, count, canRemove, onRename, onRemove }: { name: string; count: number; canRemove: boolean; onRename: (to: string) => void; onRemove: () => void }) {
  const [text, setText] = useState(name);
  const commit = () => {
    if (text.trim() && text.trim() !== name) onRename(text);
    else setText(name);
  };
  return (
    <li>
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={`Rename category ${name}`} maxLength={40} className="grow" />
      <span className="muted small num">
        {count} {count === 1 ? 'decision' : 'decisions'}
      </span>
      <button className="btn small" disabled={!canRemove} onClick={onRemove} aria-label={`Remove category ${name}`}>
        Remove
      </button>
    </li>
  );
}

export function Settings({ doc, today, update, store }: Props) {
  const [draft, setDraft] = useState('');
  const open = doc.decisions.filter((d) => statusOf(d) === 'open').length;
  const examples = hasExamples(doc.decisions);

  const remove = (name: string) => {
    const count = doc.decisions.filter((d) => d.category === name).length;
    const fallback = doc.categories.includes('Other') && name !== 'Other' ? 'Other' : doc.categories.find((c) => c !== name)!;
    if (count > 0 && !confirm(`Remove "${name}"? Its ${count} ${count === 1 ? 'decision moves' : 'decisions move'} to "${fallback}".`)) return;
    update((s) => removeCategory(s, name, fallback));
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    update((s) => addCategory(s, draft));
    setDraft('');
  };

  return (
    <>
      <section className="card">
        <h2>Categories</h2>
        <ul className="list cats">
          {doc.categories.map((c) => (
            <CategoryRow
              key={c}
              name={c}
              count={doc.decisions.filter((d) => d.category === c).length}
              canRemove={doc.categories.length > 1}
              onRename={(to) => update((s) => renameCategory(s, c, to))}
              onRemove={() => remove(c)}
            />
          ))}
        </ul>
        <form className="btn-row" onSubmit={add}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New category" aria-label="New category name" maxLength={40} />
          <button className="btn" type="submit" disabled={!draft.trim()}>
            Add
          </button>
        </form>
        <p className="muted small">Renaming a category renames it on every decision that uses it.</p>
      </section>

      <section className="card">
        <h2>Review dates in your calendar</h2>
        <p className="muted small">
          Downloads an .ics file with one all-day event per open review date ({open} now). Import it into your calendar. It is a snapshot: download it again after logging more calls. Calendars that match events by ID will update the old ones instead of duplicating them.
        </p>
        <div className="btn-row">
          <button className="btn" disabled={open === 0} onClick={() => downloadText('decision-reviews.ics', reviewsToIcs(doc.decisions, today), 'text/calendar;charset=utf-8')}>
            Download review dates (.ics)
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Example data</h2>
        <p className="muted small">
          {examples
            ? 'Made-up example decisions are loaded and are counted in every score. Remove them before reading your own calibration.'
            : 'Loads made-up decisions so you can see the Calibration tab working. They are marked as examples and can be removed in one go without touching your own.'}
        </p>
        <div className="btn-row">
          {examples ? (
            <button className="btn" onClick={() => update((s) => ({ ...s, decisions: withoutExamples(s.decisions) }))}>
              Remove example data
            </button>
          ) : (
            <button className="btn" onClick={() => update((s) => ({ ...s, decisions: [...s.decisions, ...exampleDecisions(today)] }))}>
              Load example data
            </button>
          )}
        </div>
      </section>

      <SyncPanel store={store} filename="decision-journal" />
    </>
  );
}
