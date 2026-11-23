import { useState } from 'react';
import { diffDays, formatDate, relativeDay } from '../lib/dates';
import { fromDraft, resolve, reviewQueue, type Decision, type Doc } from '../lib/model';
import { newId } from '../lib/store';
import { blankDraft, DecisionForm } from './DecisionForm';
import { pct } from './format';
import { ResolveFlow, ResultCard } from './Resolve';

interface Props {
  doc: Doc;
  today: string;
  update: (fn: (d: Doc) => Doc) => void;
}

export function forecastLine(d: Decision) {
  if (d.scenarios) {
    return (
      <span className="num">
        {d.scenarios.map((s) => `${s.label} ${pct(s.probability)}`).join(' · ')}
      </span>
    );
  }
  return (
    <>
      <b className="num">{pct(d.probability)}</b> {d.statement ? `that ${d.statement}` : 'that it works out'}
    </>
  );
}

export function Today({ doc, today, update }: Props) {
  const [results, setResults] = useState<string[]>([]);
  const [saved, setSaved] = useState<{ title: string; reviewOn: string } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const queue = reviewQueue(doc.decisions, today);
  const due = [...queue.overdue, ...queue.dueToday];
  const patch = (id: string, fn: (d: Decision) => Decision) => update((s) => ({ ...s, decisions: s.decisions.map((d) => (d.id === id ? fn(d) : d)) }));

  return (
    <>
      {results.map((id) => (
        <section className="card" key={id}>
          <ResultCard decisions={doc.decisions} id={id} onDismiss={() => setResults((r) => r.filter((x) => x !== id))} />
        </section>
      ))}

      <section className="card">
        <div className="card-head">
          <h2>Reviews due</h2>
          {due.length > 0 && (
            <span className="muted small num">
              {queue.overdue.length} overdue, {queue.dueToday.length} due today
            </span>
          )}
        </div>
        {due.length === 0 ? (
          <p className="empty">
            {doc.decisions.length === 0
              ? 'No decisions yet. Log your first call below: a title, what "works out" means, and how likely you think it is.'
              : queue.upcoming.length
                ? `Nothing to review today. Next: ${queue.upcoming[0].title}, ${formatDate(queue.upcoming[0].reviewOn)} (${relativeDay(queue.upcoming[0].reviewOn, today)}).`
                : 'Nothing to review, and nothing open. Log a new call below.'}
          </p>
        ) : (
          <ul className="list reviews">
            {due.map((d) => {
              const late = diffDays(d.reviewOn, today);
              return (
                <li key={d.id}>
                  <div className="review-head">
                    <div>
                      <h3>{d.title}</h3>
                      <p>{forecastLine(d)}</p>
                      <p className="muted small">
                        Decided {formatDate(d.madeOn)} · {d.category} · {d.stakes} stakes
                      </p>
                      {d.changeMind && <p className="muted small">Would change my mind: {d.changeMind}</p>}
                    </div>
                    <span className={`chip ${late > 0 ? 'bad' : 'warn'}`}>{late > 0 ? `${late} ${late === 1 ? 'day' : 'days'} overdue` : 'Due today'}</span>
                  </div>
                  <ResolveFlow
                    decision={d}
                    today={today}
                    onResolve={(result, on, review) => {
                      patch(d.id, (x) => resolve(x, result, on, review));
                      setResults((r) => [d.id, ...r]);
                    }}
                    onSnooze={(reviewOn) => patch(d.id, (x) => ({ ...x, reviewOn }))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Log a call</h2>
          {saved && (
            <span className="small good" role="status">
              Logged "{saved.title}". Review on {formatDate(saved.reviewOn)}.
            </span>
          )}
        </div>
        <DecisionForm
          key={formKey}
          initial={blankDraft(today, doc.categories[0])}
          categories={doc.categories}
          submitLabel="Log it"
          onSubmit={(draft) => {
            const d = fromDraft(draft, newId());
            update((s) => ({ ...s, decisions: [...s.decisions, d] }));
            setSaved({ title: d.title, reviewOn: d.reviewOn });
            setFormKey((k) => k + 1);
          }}
        />
      </section>

      {queue.upcoming.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Coming up</h2>
            <span className="muted small num">{queue.upcoming.length} open</span>
          </div>
          <ul className="list">
            {queue.upcoming.slice(0, 5).map((d) => (
              <li key={d.id}>
                <span className="grow">
                  {d.title} <span className="muted small num">{d.scenarios ? 'scenarios' : pct(d.probability)}</span>
                </span>
                <span className="muted small num">
                  {formatDate(d.reviewOn)} · {relativeDay(d.reviewOn, today)}
                </span>
              </li>
            ))}
          </ul>
          {queue.upcoming.length > 5 && <p className="muted small">The rest are in the Journal tab.</p>}
        </section>
      )}
    </>
  );
}
