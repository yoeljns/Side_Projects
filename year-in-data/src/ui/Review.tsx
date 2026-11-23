import { useEffect, useState } from 'react';
import { wordCount } from '../lib/questions';
import type { YearRecord } from '../lib/record';
import { type Question, SECTION_LABEL } from '../lib/types';
import { SectionPanel } from './Panels';

interface Props {
  record: YearRecord;
  questions: Question[];
  answers: Record<string, string>;
  onAnswer: (questionId: string, text: string) => void;
  onEditQuestions: () => void;
  exportBar: React.ReactNode;
}

export function Review({ record, questions, answers, onAnswer, onEditQuestions, exportBar }: Props) {
  const [at, setAt] = useState(0);
  const index = Math.min(at, Math.max(0, questions.length - 1));
  const q = questions[index];
  // A new question starts at the top of its record.
  useEffect(() => { document.getElementById('question-top')?.scrollIntoView?.({ block: 'nearest' }); }, [index]);

  if (!q) {
    return (
      <section className="card">
        <p className="empty">There are no questions yet.</p>
        <div className="btn-row"><button className="btn primary" onClick={onEditQuestions}>Write your questions</button></div>
      </section>
    );
  }
  const answer = answers[q.id] ?? '';
  const answered = questions.filter((x) => (answers[x.id] ?? '').trim()).length;

  return (
    <div className="stack">
      <section className="card" id="question-top">
        <div className="card-head">
          <span className="muted small strong">Question {index + 1} of {questions.length}</span>
          <span className="muted small num">{answered} of {questions.length} answered</span>
        </div>
        <nav className="steps" aria-label="Questions">
          {questions.map((x, i) => (
            <button key={x.id} className={i === index ? 'on' : (answers[x.id] ?? '').trim() ? 'done' : ''} aria-current={i === index ? 'step' : undefined} aria-label={`Question ${i + 1}: ${x.text}${(answers[x.id] ?? '').trim() ? ' (answered)' : ''}`} onClick={() => setAt(i)}>
              {i + 1}
            </button>
          ))}
        </nav>
        <h2 className="question">{q.text}</h2>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>The record</h2>
          <span className="muted small">{q.sections.length ? q.sections.map((s) => SECTION_LABEL[s]).join(', ') : 'Nothing attached'}</span>
        </div>
        {q.sections.length === 0 && (
          <p className="muted">No part of the record sits beside this question. <button className="btn small" onClick={onEditQuestions}>Change</button></p>
        )}
        {q.sections.map((id) => <SectionPanel key={id} id={id} record={record} />)}
      </section>

      <section className="card answer">
        <label className="field">
          <span>Your answer to: {q.text}</span>
          <textarea value={answer} onChange={(e) => onAnswer(q.id, e.target.value)} placeholder="Write here. It is saved as you type." />
        </label>
        <div className="card-head">
          <span className="muted small num">{wordCount(answer)} words{answer.trim() ? ', saved in this browser' : ''}</span>
          <div className="btn-row">
            <button className="btn" disabled={index === 0} onClick={() => setAt(index - 1)}>Previous</button>
            <button className="btn primary" disabled={index === questions.length - 1} onClick={() => setAt(index + 1)}>Next question</button>
          </div>
        </div>
      </section>

      {index === questions.length - 1 && (
        <section className="card">
          <div className="card-head"><h2>Take it away</h2></div>
          <p className="muted">The markdown file holds the record tables and your answers. Print gives a clean paper copy, one question to a page.</p>
          <div className="btn-row">{exportBar}</div>
        </section>
      )}
    </div>
  );
}
