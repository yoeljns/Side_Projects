import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtDay, fmtDur, localDay, weekStart, type Day } from '../lib/dates';
import { BLANK, categoryLabel, type Doc, type Entry } from '../lib/model';
import { newId, useStore, type Store } from '../lib/store';
import { elapsedMinutes, overCap, sliceFromStart, splitTimer, type TimerSlice } from '../lib/timer';
import { Settings } from './Settings';
import { Summary } from './Summary';
import { Today } from './Today';
import { Trends } from './Trends';
import { Week } from './Week';

type Tab = 'today' | 'week' | 'summary' | 'trends' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'summary', label: 'Sunday summary' },
  { id: 'trends', label: 'Trends' },
  { id: 'settings', label: 'Settings' },
];

export type NewEntry = Omit<Entry, 'id'>;

export interface Ctx {
  doc: Doc;
  store: Store<Doc>;
  /** The device's calendar date. */
  today: Day;
  now: number;
  update: (fn: (d: Doc) => Doc) => void;
  /** Add entries and show a toast with an undo. */
  log: (entries: NewEntry[]) => void;
  say: (text: string, undo?: () => void) => void;
  startTimer: (category: string) => void;
  stopTimer: () => void;
  /** Settle a timer that ran past the cap: log `minutes` from its start, or null to discard it. */
  settleTimer: (minutes: number | null) => void;
  openSummary: (week: Day) => void;
}

/** The clock, refreshed often enough for a minutes display and whenever the tab comes back. */
function useNow(fast: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, fast ? 10_000 : 60_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [fast]);
  return now;
}

const utcOffset = (at: number) => -new Date(at).getTimezoneOffset();

export function App() {
  const store = useStore<Doc>('hours-ledger:v1', BLANK);
  const doc = useMemo<Doc>(
    () => ({ ...store.state, settings: { ...BLANK.settings, ...store.state.settings }, reflections: store.state.reflections ?? {} }),
    [store.state],
  );
  const now = useNow(doc.timer !== null);
  const today = localDay(new Date(now));
  const [tab, setTab] = useState<Tab>('today');
  const [summaryWeek, setSummaryWeek] = useState<Day>(() => weekStart(localDay(new Date())));
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { update } = store;

  const say = useCallback((text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), 7000);
  }, []);

  const describe = useCallback(
    (list: NewEntry[], day: Day): string => {
      const total = list.reduce((a, e) => a + e.minutes, 0);
      const days = [...new Set(list.map((e) => e.day))];
      const when = days.length > 1 ? `${fmtDay(days[0])} and ${fmtDay(days[days.length - 1])}` : days[0] === day ? 'today' : fmtDay(days[0]);
      return `${fmtDur(total)} to ${categoryLabel(doc.categories, list[0].category)}, ${when}`;
    },
    [doc.categories],
  );

  const log = useCallback(
    (list: NewEntry[]) => {
      if (list.length === 0) return;
      const added = list.map((e) => ({ ...e, id: newId() }));
      const ids = new Set(added.map((e) => e.id));
      update((d) => ({ ...d, entries: [...d.entries, ...added] }));
      say(`Added ${describe(list, localDay(new Date()))}.`, () => update((d) => ({ ...d, entries: d.entries.filter((e) => !ids.has(e.id)) })));
    },
    [update, say, describe],
  );

  const finish = useCallback(
    (slices: TimerSlice[], next: Doc['timer']) => {
      const running = doc.timer;
      if (!running) return;
      const added = slices.map((s) => ({ id: newId(), day: s.day, category: running.category, minutes: s.minutes }));
      const ids = new Set(added.map((e) => e.id));
      update((d) => ({ ...d, timer: next, entries: [...d.entries, ...added] }));
      const undo = () => update((d) => ({ ...d, timer: running, entries: d.entries.filter((e) => !ids.has(e.id)) }));
      if (added.length === 0) say('Timer stopped. Under 3 minutes, so nothing was logged.', undo);
      else say(`Timer stopped. Added ${describe(added, localDay(new Date()))}.`, undo);
    },
    [doc.timer, update, say, describe],
  );

  const stopTimer = useCallback(() => {
    const t = doc.timer;
    if (!t) return;
    const at = Date.now();
    if (overCap(t.startedAt, at, doc.settings.timerCapHours)) return; // settled by hand instead
    finish(splitTimer(t.startedAt, at, utcOffset(at)), null);
  }, [doc.timer, doc.settings.timerCapHours, finish]);

  const startTimer = useCallback(
    (category: string) => {
      const at = Date.now();
      const t = doc.timer;
      if (t && overCap(t.startedAt, at, doc.settings.timerCapHours)) {
        say('Settle the timer that was left running first.');
        return;
      }
      // Only one timer runs: starting another stops and logs the first.
      if (t) finish(splitTimer(t.startedAt, at, utcOffset(at)), { category, startedAt: at });
      else update((d) => ({ ...d, timer: { category, startedAt: at } }));
    },
    [doc.timer, doc.settings.timerCapHours, finish, update, say],
  );

  const settleTimer = useCallback(
    (minutes: number | null) => {
      const t = doc.timer;
      if (!t) return;
      if (minutes === null) {
        update((d) => ({ ...d, timer: null }));
        say(`Discarded the ${categoryLabel(doc.categories, t.category)} timer.`, () => update((d) => ({ ...d, timer: t })));
      } else {
        finish(sliceFromStart(t.startedAt, minutes, utcOffset(Date.now())), null);
      }
    },
    [doc.timer, doc.categories, finish, update, say],
  );

  const openSummary = useCallback((week: Day) => {
    setSummaryWeek(week);
    setTab('summary');
    window.scrollTo(0, 0);
  }, []);

  const ctx: Ctx = { doc, store, today, now, update, log, say, startTimer, stopTimer, settleTimer, openSummary };
  const running = doc.timer;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Hours ledger</h1>
          <p className="muted small">Where the week goes. Log in a tap, read it back on Sunday.</p>
        </div>
        {running && tab !== 'today' && (
          <button className="chip" onClick={() => setTab('today')}>
            Timer on: {categoryLabel(doc.categories, running.category)}, {fmtDur(Math.floor(elapsedMinutes(running.startedAt, now)))}
          </button>
        )}
      </header>
      <nav className="tabs no-print" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'today' && <Today ctx={ctx} />}
      {tab === 'week' && <Week ctx={ctx} />}
      {tab === 'summary' && <Summary ctx={ctx} week={summaryWeek} setWeek={setSummaryWeek} />}
      {tab === 'trends' && <Trends ctx={ctx} />}
      {tab === 'settings' && <Settings ctx={ctx} />}
      {toast && (
        <div className="toast no-print" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
