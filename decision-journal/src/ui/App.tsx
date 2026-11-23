import { useCallback, useEffect, useMemo, useState } from 'react';
import { localDay } from '../lib/dates';
import { hasExamples } from '../lib/example';
import { BLANK, normaliseDoc, reviewQueue, type Doc } from '../lib/model';
import { useStore } from '../lib/store';
import { Calibration } from './Calibration';
import { Journal } from './Journal';
import { Settings } from './Settings';
import { Today } from './Today';

const TABS = ['Today', 'Journal', 'Calibration', 'Settings'] as const;
type Tab = (typeof TABS)[number];

/** Today's date, refreshed when the tab comes back so a page left open overnight moves on. */
function useToday(): string {
  const [today, setToday] = useState(() => localDay(new Date()));
  useEffect(() => {
    const tick = () => setToday(localDay(new Date()));
    document.addEventListener('visibilitychange', tick);
    const timer = setInterval(tick, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', tick);
      clearInterval(timer);
    };
  }, []);
  return today;
}

export function App() {
  const store = useStore<Doc>('decision-journal:v1', BLANK);
  const [tab, setTab] = useState<Tab>('Today');
  const today = useToday();
  const doc = useMemo(() => normaliseDoc(store.state), [store.state]);
  const storeUpdate = store.update;
  const update = useCallback((fn: (d: Doc) => Doc) => storeUpdate((s) => fn(normaliseDoc(s))), [storeUpdate]);
  const queue = reviewQueue(doc.decisions, today);
  const due = queue.overdue.length + queue.dueToday.length;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Decision journal</h1>
          <p className="muted">Give every meaningful call a probability and a review date, then see how well calibrated you are.</p>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {t}
            {t === 'Today' && due > 0 && (
              <>
                <span className="badge num" aria-hidden="true">
                  {due}
                </span>
                <span className="sr-only"> ({due} to review)</span>
              </>
            )}
          </button>
        ))}
      </nav>

      {hasExamples(doc.decisions) && (
        <p className="notice" role="note">
          Example data is loaded and counted in the scores. Remove it in Settings.
        </p>
      )}

      {tab === 'Today' && <Today doc={doc} today={today} update={update} />}
      {tab === 'Journal' && <Journal doc={doc} today={today} update={update} />}
      {tab === 'Calibration' && <Calibration doc={doc} />}
      {tab === 'Settings' && <Settings doc={doc} today={today} update={update} store={store} />}
    </div>
  );
}
