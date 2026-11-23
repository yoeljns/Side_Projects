import { useState } from 'react';
import { monthName } from '../lib/dates';
import { DEFAULT_QUESTIONS, move } from '../lib/questions';
import { newId, type Store } from '../lib/store';
import { type Doc, type Question, SECTION_IDS, SECTION_LABEL } from '../lib/types';
import { type Birthday, isBirthday } from '../lib/window';
import { SyncPanel } from './SyncPanel';

export function BirthdayForm({ value, onSave, first }: { value: Birthday | null; onSave: (b: Birthday) => void; first?: boolean }) {
  const [month, setMonth] = useState(value?.month ?? 1);
  const [day, setDay] = useState(value?.day ?? 1);
  const draft = { month, day };
  const valid = isBirthday(draft);
  const changed = !value || value.month !== month || value.day !== day;
  return (
    <section className="card">
      <div className="card-head"><h2>{first ? 'Start with your birthday' : 'Birthday'}</h2></div>
      <p className="muted">
        The year under review runs from one birthday to the day before the next. Only the month and day are kept, in this browser and in your own sync document if you turn sync on.
      </p>
      <div className="btn-row">
        <label className="field">
          <span>Day</span>
          <select value={day} onChange={(e) => setDay(+e.target.value)}>
            {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Month</span>
          <select value={month} onChange={(e) => setMonth(+e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
          </select>
        </label>
        <button className="btn primary" style={{ alignSelf: 'end' }} disabled={!valid || !changed} onClick={() => onSave(draft)}>{first ? 'Set birthday' : 'Save'}</button>
      </div>
      {!valid && <p className="small bad" role="alert">That month has no such day.</p>}
      {valid && month === 2 && day === 29 && <p className="muted small">In years without a 29 February, the year turns on 1 March.</p>}
    </section>
  );
}

function QuestionEditor({ store }: { store: Store<Doc> }) {
  const questions = store.state.questions;
  const set = (fn: (q: Question[]) => Question[]) => store.update((s) => ({ ...s, questions: fn(s.questions) }));
  const patch = (id: string, p: Partial<Question>) => set((qs) => qs.map((q) => (q.id === id ? { ...q, ...p } : q)));
  const hasAnswers = (id: string) => Object.values(store.state.answers).some((a) => (a[id] ?? '').trim());
  return (
    <section className="card">
      <div className="card-head">
        <h2>Questions</h2>
        <span className="muted small">Asked in this order, every year</span>
      </div>
      <p className="muted">These are a neutral starting set. Replace them with your own, and tick which parts of the record sit beside each.</p>
      <div>
        {questions.map((q, i) => (
          <div className="q-edit" key={q.id}>
            <div className="btn-row">
              <span className="muted small strong num">{i + 1}</span>
              <input className="item-main" aria-label={`Question ${i + 1}`} value={q.text} onChange={(e) => patch(q.id, { text: e.target.value })} />
              <button className="btn small" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => set((qs) => move(qs, i, i - 1))}>Up</button>
              <button className="btn small" aria-label={`Move question ${i + 1} down`} disabled={i === questions.length - 1} onClick={() => set((qs) => move(qs, i, i + 1))}>Down</button>
              <button className="btn small danger" aria-label={`Remove question ${i + 1}`} onClick={() => { if (!hasAnswers(q.id) || confirm('This question has written answers. They stay in your backup but will no longer be shown. Remove it?')) set((qs) => qs.filter((x) => x.id !== q.id)); }}>Remove</button>
            </div>
            <div className="checks" role="group" aria-label={`Record beside question ${i + 1}`}>
              {SECTION_IDS.map((sec) => (
                <label key={sec}>
                  <input type="checkbox" checked={q.sections.includes(sec)} onChange={(e) => patch(q.id, { sections: SECTION_IDS.filter((x) => (x === sec ? e.target.checked : q.sections.includes(x))) })} />
                  {SECTION_LABEL[sec]}
                </label>
              ))}
            </div>
          </div>
        ))}
        {questions.length === 0 && <p className="empty">No questions. Add your first.</p>}
      </div>
      <div className="btn-row">
        <button className="btn primary" onClick={() => set((qs) => [...qs, { id: `q-${newId()}`, text: 'New question', sections: [] }])}>Add a question</button>
        <button className="btn" onClick={() => { if (confirm('Put the starting set of questions back? Your own questions are removed; answers stay in your backup.')) set(() => DEFAULT_QUESTIONS); }}>Back to the starting set</button>
      </div>
    </section>
  );
}

export function Settings({ store }: { store: Store<Doc> }) {
  return (
    <div className="stack">
      <BirthdayForm value={store.state.birthday} onSave={(b) => store.update((s) => ({ ...s, birthday: b }))} />
      <QuestionEditor store={store} />
      <SyncPanel store={store} filename="year-in-data" />
      <section className="card">
        <div className="card-head"><h2>What is kept where</h2></div>
        <ul className="list small">
          <li><span className="item-main">This app's document (and its sync, if on): birthday, questions, answers, books, builds, tallies, usernames, fetched chess games, commit counts, and the copies of the other apps' records you loaded.</span></li>
          <li><span className="item-main">This browser only, never synced or backed up: the other apps' sync codes and the GitHub token.</span></li>
          <li><span className="item-main">Never kept: commit messages, author names, and anything beyond the contract fields of the other apps' documents (their notes are dropped on import).</span></li>
        </ul>
      </section>
    </div>
  );
}
