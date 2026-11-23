import { useMemo, useState } from 'react';
import { fmtDate } from '../lib/dates';
import { BLANK, STORE_KEY, earliestDate, yearsWithContent } from '../lib/doc';
import { reviewFilename, reviewMarkdown } from '../lib/markdown';
import { buildRecord, compareYears, hasAnyRecord } from '../lib/record';
import { useStore } from '../lib/store';
import type { Doc } from '../lib/types';
import { defaultEndYear, endYearContaining, latestEndYear, yearWindow } from '../lib/window';
import { download, localToday } from './local';
import { Overview } from './Overview';
import { PrintView } from './Panels';
import { Records } from './Records';
import { Review } from './Review';
import { BirthdayForm, Settings } from './Settings';
import { SyncPanel } from './SyncPanel';

type Tab = 'overview' | 'review' | 'records' | 'settings';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['review', 'Review'], ['records', 'Records'], ['settings', 'Questions and settings']];

export function App() {
  const store = useStore<Doc>(STORE_KEY, BLANK);
  const doc = store.state;
  const [tab, setTab] = useState<Tab>('overview');
  const [picked, setPicked] = useState<number | null>(null);
  const today = localToday();
  const birthday = doc.birthday;

  const view = useMemo(() => {
    if (!birthday) return null;
    const latest = latestEndYear(birthday, today);
    const endYear = Math.min(picked ?? defaultEndYear(birthday, today), latest);
    const first = earliestDate(doc);
    const oldest = Math.min(latest - 1, endYear, ...yearsWithContent(doc), first ? endYearContaining(birthday, first) : latest);
    const years = Array.from({ length: latest - oldest + 1 }, (_, i) => latest - i);
    const window = yearWindow(birthday, endYear);
    const record = buildRecord(doc, window, today);
    const before = buildRecord(doc, yearWindow(birthday, endYear - 1), today);
    return { window, record, years, latest, comparison: hasAnyRecord(before) ? compareYears(record, before) : null };
  }, [birthday, doc, picked, today]);

  if (!birthday || !view) {
    return (
      <div className="app">
        <header className="top">
          <div>
            <h1>Year in Data</h1>
            <p className="muted">The year's own record, question by question, before you write the reflective part.</p>
          </div>
        </header>
        <BirthdayForm first value={null} onSave={(b) => store.update((s) => ({ ...s, birthday: b }))} />
        <SyncPanel store={store} filename="year-in-data" />
      </div>
    );
  }

  const { window, record, years, latest, comparison } = view;
  const answers = doc.answers[window.key] ?? {};
  const exportMd = () => download(reviewFilename(record), reviewMarkdown({ record, questions: doc.questions, answers, comparison }), 'text/markdown');
  const exportBar = (
    <>
      <button className="btn" onClick={exportMd}>Download markdown</button>
      <button className="btn" onClick={() => globalThis.print()}>Print</button>
    </>
  );

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Year in Data</h1>
          <p className="muted">The year's own record, question by question, before you write the reflective part.</p>
        </div>
        <div className="year-pick">
          <button className="btn small" aria-label="Earlier year" disabled={window.endYear <= years[years.length - 1]} onClick={() => setPicked(window.endYear - 1)}>Earlier</button>
          <select aria-label="Year under review" value={window.endYear} onChange={(e) => setPicked(+e.target.value)}>
            {years.map((y) => {
              const w = yearWindow(birthday, y);
              return <option key={y} value={y}>{fmtDate(w.start)} to {fmtDate(w.last)}{y === latest ? ' (in progress)' : ''}</option>;
            })}
          </select>
          <button className="btn small" aria-label="Later year" disabled={window.endYear >= latest} onClick={() => setPicked(window.endYear + 1)}>Later</button>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        {TABS.map(([id, label]) => <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

      {tab === 'overview' && <Overview record={record} comparison={comparison} onRecords={() => setTab('records')} onReview={() => setTab('review')} exportBar={exportBar} />}
      {tab === 'review' && (
        <Review
          key={window.key}
          record={record}
          questions={doc.questions}
          answers={answers}
          onAnswer={(id, text) => store.update((s) => ({ ...s, answers: { ...s.answers, [window.key]: { ...s.answers[window.key], [id]: text } } }))}
          onEditQuestions={() => setTab('settings')}
          exportBar={exportBar}
        />
      )}
      {tab === 'records' && <Records store={store} window={window} today={today} />}
      {tab === 'settings' && <Settings store={store} />}

      <PrintView record={record} questions={doc.questions} answers={answers} comparison={comparison} />
    </div>
  );
}
