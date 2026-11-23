import { useCallback, useEffect, useMemo, useState } from 'react';
import { CITIES, clockIn, dayIn, fmtDay, otherCity } from '../lib/dates.ts';
import type { City } from '../lib/dates.ts';
import { fixtureTitle, saleAlerts } from '../lib/matchday.ts';
import { blankDoc, normaliseDoc } from '../lib/model.ts';
import type { Doc } from '../lib/model.ts';
import { flip, suggestSwitch } from '../lib/switch.ts';
import { useStore } from '../lib/store';
import { useNow } from './bits.tsx';
import type { TabProps } from './bits.tsx';
import { Ledger } from './Ledger.tsx';
import { Matchday } from './Matchday.tsx';
import { Settings } from './Settings.tsx';
import { Today } from './Today.tsx';
import { Trips } from './Trips.tsx';

const BLANK = blankDoc();
const TABS = ['Today', 'Ledger', 'Matchday', 'Trips', 'Settings'] as const;
type Tab = (typeof TABS)[number];
const TAB_KEY = 'two-city:tab';
const NOTIFIED_KEY = 'two-city:notified';

const savedTab = (): Tab => {
  try {
    const t = sessionStorage.getItem(TAB_KEY);
    return TABS.includes(t as Tab) ? (t as Tab) : 'Today';
  } catch {
    return 'Today';
  }
};

export function App() {
  const store = useStore<Doc>('two-city:v1', BLANK);
  const doc = useMemo(() => normaliseDoc(store.state), [store.state]);
  const now = useNow();
  const today = dayIn(CITIES[doc.mode].tz, now);
  const [tab, setTabState] = useState<Tab>(savedTab);
  const [undo, setUndo] = useState<Doc | null>(null);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      sessionStorage.setItem(TAB_KEY, t);
    } catch {
      // ignore
    }
  };

  const { update: storeUpdate, replace } = store;
  const update = useCallback((fn: (d: Doc) => Doc) => storeUpdate((s) => fn(normaliseDoc(s))), [storeUpdate]);

  const switchTo = useCallback(
    (city: City) => {
      update((d) => {
        setUndo(d);
        return flip(d, city, dayIn(CITIES[city].tz, new Date()));
      });
      setTab('Today');
    },
    [update],
  );

  // The keyboard shortcut: Shift+S anywhere outside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'S' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        switchTo(otherCity(doc.mode));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc.mode, switchTo]);

  // Browser notifications for ticket windows, once per window and state on this device, only if permission was given.
  const alerts = useMemo(() => saleAlerts(doc.fixtures, doc.stays, doc.sale, today), [doc.fixtures, doc.stays, doc.sale, today]);
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !alerts.length) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '[]') as string[];
    } catch {
      seen = [];
    }
    for (const a of alerts) {
      const key = `${a.fixture.id}|${a.window.phase.id}|${a.window.opens}|${a.state}`;
      if (seen.includes(key)) continue;
      seen.push(key);
      try {
        new Notification(a.state === 'open-now' ? 'Tickets should be on sale' : `Tickets on sale ${fmtDay(a.window.opens, { year: false })}`, {
          body: `${fixtureTitle(a.fixture)}, ${fmtDay(a.fixture.date, { year: false })}${a.window.confirmed ? '' : ' (estimated date)'}`,
        });
      } catch {
        // Some mobile browsers only allow notifications from a service worker.
      }
    }
    try {
      localStorage.setItem(NOTIFIED_KEY, JSON.stringify(seen.slice(-200)));
    } catch {
      // ignore
    }
  }, [alerts]);

  const suggestion = suggestSwitch(doc, today);
  const props: TabProps = { doc, update, today, now };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Two City</h1>
          <p className="muted">
            {CITIES[doc.mode].label} mode{doc.switchedOn ? ` since ${fmtDay(doc.switchedOn, { weekday: false })}` : ''}. {fmtDay(today)}.
          </p>
        </div>
        <div className="switch">
          <div className="switch-track" role="group" aria-label="City mode">
            {(['london', 'istanbul'] as const).map((c) => (
              <button
                key={c}
                className={`${c}${doc.mode === c ? ' on' : ''}`}
                aria-pressed={doc.mode === c}
                title={doc.mode === c ? `${CITIES[c].label} mode is on` : `Switch to ${CITIES[c].label}`}
                onClick={() => doc.mode !== c && switchTo(c)}
              >
                <b>{CITIES[c].label}</b>
                <span>{clockIn(CITIES[c].tz, now)}</span>
              </button>
            ))}
          </div>
          <span className="muted small no-print">
            Flip with a click, <kbd>Shift</kbd> + <kbd>S</kbd>, or <code>npm run switch</code>
          </span>
        </div>
      </header>

      {undo && (
        <div className={`banner ${doc.mode}`} role="status">
          <div>
            <b>Switched to {CITIES[doc.mode].label}.</b> Fresh packing and landing lists are on the Today tab; the previous ones are in the history.
          </div>
          <div className="btn-row">
            <button className="btn small" onClick={() => { replace(undo); setUndo(null); }}>Undo</button>
            <button className="btn small" onClick={() => setUndo(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {suggestion && !undo && (
        <div className={`banner ${suggestion.city}`} role="status">
          <div>
            <b>Switch to {CITIES[suggestion.city].label}?</b>{' '}
            {suggestion.when === 'under way'
              ? `The ledger has you in ${CITIES[suggestion.city].label} since ${fmtDay(suggestion.arrive, { weekday: false })}.`
              : `The ledger has a ${CITIES[suggestion.city].label} stay starting ${suggestion.when}.`}
          </div>
          <div className="btn-row">
            <button className="btn primary small" onClick={() => switchTo(suggestion.city)}>Switch to {CITIES[suggestion.city].label}</button>
            <button className="btn small" onClick={() => update((d) => ({ ...d, dismissedSuggestion: suggestion.stayId }))}>Not now</button>
          </div>
        </div>
      )}

      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Today' && <Today {...props} onSwitch={switchTo} goTo={(t) => setTab(t)} />}
      {tab === 'Ledger' && <Ledger {...props} />}
      {tab === 'Matchday' && <Matchday {...props} />}
      {tab === 'Trips' && <Trips {...props} />}
      {tab === 'Settings' && <Settings {...props} store={store} />}
    </div>
  );
}
