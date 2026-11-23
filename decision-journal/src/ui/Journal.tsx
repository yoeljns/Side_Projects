import { useMemo, useState } from 'react';
import { formatDate, relativeDay } from '../lib/dates';
import { applyDraft, reopen, resolve, statusOf, toDraft, type Decision, type Doc } from '../lib/model';
import { DecisionForm } from './DecisionForm';
import { ResolveFlow, ResultCard } from './Resolve';
import { forecastLine } from './Today';

interface Props {
  doc: Doc;
  today: string;
  update: (fn: (d: Doc) => Doc) => void;
}

type Filter = 'all' | 'open' | 'due' | 'resolved' | 'void';
type Mode = 'view' | 'edit' | 'resolve' | 'result';

function StatusChip({ d, today }: { d: Decision; today: string }) {
  const s = statusOf(d);
  if (s === 'void') return <span className="chip">Void</span>;
  if (s === 'resolved') {
    if (d.scenarios) return <span className="chip">{d.scenarios.find((x) => x.id === d.resolvedScenarioId)?.label ?? 'Resolved'}</span>;
    return <span className={`chip ${d.outcome ? 'good' : 'bad'}`}>{d.outcome ? 'Happened' : 'Did not happen'}</span>;
  }
  if (d.reviewOn < today) return <span className="chip bad">Overdue</span>;
  if (d.reviewOn === today) return <span className="chip warn">Due today</span>;
  return <span className="chip">Open</span>;
}

const QUALITY_LABEL = { good: 'Good call', bad: 'Bad call', unsure: 'Not sure' } as const;

export function Journal({ doc, today, update }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return doc.decisions
      .filter((d) => {
        // The entry being worked on stays put even if resolving it takes it out of the filter.
        if (d.id === openId) return true;
        const s = statusOf(d);
        if (filter === 'due' ? !(s === 'open' && d.reviewOn <= today) : filter !== 'all' && s !== filter) return false;
        if (category && d.category !== category) return false;
        if (!q) return true;
        return [d.title, d.call, d.statement, d.notes, d.changeMind, d.lesson, d.hindsight, ...(d.scenarios?.map((s) => s.label) ?? [])].some((t) => t?.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        // Open first, soonest review at the top; then reviewed, most recent first.
        const ao = statusOf(a) === 'open';
        const bo = statusOf(b) === 'open';
        if (ao !== bo) return ao ? -1 : 1;
        if (ao) return a.reviewOn.localeCompare(b.reviewOn) || a.title.localeCompare(b.title);
        return (b.resolvedOn ?? b.reviewOn).localeCompare(a.resolvedOn ?? a.reviewOn) || a.title.localeCompare(b.title);
      });
  }, [doc.decisions, filter, category, query, today, openId]);

  const patch = (id: string, fn: (d: Decision) => Decision) => update((s) => ({ ...s, decisions: s.decisions.map((d) => (d.id === id ? fn(d) : d)) }));
  const toggle = (id: string) => {
    setOpenId(openId === id ? null : id);
    setMode('view');
  };

  if (doc.decisions.length === 0) {
    return (
      <section className="card">
        <h2>Journal</h2>
        <p className="empty">Nothing here yet. Log a call on the Today tab and it will appear in this list.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Journal</h2>
        <span className="muted small num">
          {rows.length} of {doc.decisions.length}
        </span>
      </div>
      <div className="filters">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search decisions" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="due">Due or overdue</option>
          <option value="resolved">Resolved</option>
          <option value="void">Void</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {doc.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No decisions match.</p>
      ) : (
        <ul className="list journal">
          {rows.map((d) => {
            const open = openId === d.id;
            const s = statusOf(d);
            return (
              <li key={d.id}>
                <button className="entry" aria-expanded={open} onClick={() => toggle(d.id)}>
                  <span className="entry-main">
                    <span className="strong">{d.title}</span>
                    <span className="muted small">{forecastLine(d)}</span>
                  </span>
                  <span className="entry-side">
                    <StatusChip d={d} today={today} />
                    <span className="muted small num">{s === 'open' ? `Review ${formatDate(d.reviewOn)}` : formatDate(d.resolvedOn ?? d.reviewOn)}</span>
                  </span>
                </button>

                {open && mode === 'view' && (
                  <div className="detail">
                    <dl>
                      {d.call && (
                        <>
                          <dt>The call</dt>
                          <dd>{d.call}</dd>
                        </>
                      )}
                      <dt>Decided</dt>
                      <dd className="num">
                        {formatDate(d.madeOn)} · {d.category} · {d.stakes} stakes{d.example ? ' · example data' : ''}
                      </dd>
                      <dt>Review</dt>
                      <dd className="num">
                        {formatDate(d.reviewOn)}
                        {s === 'open' ? ` (${relativeDay(d.reviewOn, today)})` : ''}
                      </dd>
                      {d.changeMind && (
                        <>
                          <dt>Would change my mind</dt>
                          <dd>{d.changeMind}</dd>
                        </>
                      )}
                      {d.notes && (
                        <>
                          <dt>Notes</dt>
                          <dd>{d.notes}</dd>
                        </>
                      )}
                      {s !== 'open' && (
                        <>
                          <dt>Reviewed</dt>
                          <dd className="num">
                            {formatDate(d.resolvedOn ?? d.reviewOn)}
                            {d.quality ? ` · ${QUALITY_LABEL[d.quality]}` : ''}
                          </dd>
                        </>
                      )}
                      {d.lesson && (
                        <>
                          <dt>Lesson</dt>
                          <dd>{d.lesson}</dd>
                        </>
                      )}
                      {d.hindsight && (
                        <>
                          <dt>Hindsight</dt>
                          <dd>{d.hindsight}</dd>
                        </>
                      )}
                    </dl>
                    <div className="btn-row">
                      {s === 'open' ? (
                        <button className="btn primary small" onClick={() => setMode('resolve')}>
                          Resolve
                        </button>
                      ) : (
                        <>
                          <button className="btn small" onClick={() => setMode('result')}>
                            Show score
                          </button>
                          <button className="btn small" onClick={() => confirm('Reopen this decision? Its review (result, lesson, hindsight) will be cleared.') && patch(d.id, reopen)}>
                            Reopen
                          </button>
                        </>
                      )}
                      <button className="btn small" onClick={() => setMode('edit')}>
                        Edit
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => {
                          if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
                          update((st) => ({ ...st, decisions: st.decisions.filter((x) => x.id !== d.id) }));
                          setOpenId(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {open && mode === 'edit' && (
                  <div className="detail">
                    <DecisionForm
                      initial={toDraft(d)}
                      categories={doc.categories}
                      submitLabel="Save changes"
                      expanded
                      onCancel={() => setMode('view')}
                      onSubmit={(draft) => {
                        patch(d.id, (x) => applyDraft(x, draft));
                        setMode('view');
                      }}
                    />
                    {s === 'resolved' && <p className="muted small">Changing the probability of a resolved decision changes its score. Changing which scenarios exist can reopen it.</p>}
                  </div>
                )}

                {open && mode === 'resolve' && s === 'open' && (
                  <div className="detail">
                    <ResolveFlow
                      decision={d}
                      today={today}
                      onCancel={() => setMode('view')}
                      onResolve={(result, on, review) => {
                        patch(d.id, (x) => resolve(x, result, on, review));
                        setMode('result');
                      }}
                    />
                  </div>
                )}

                {open && mode === 'result' && (
                  <div className="detail">
                    <ResultCard decisions={doc.decisions} id={d.id} onDismiss={() => setMode('view')} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
