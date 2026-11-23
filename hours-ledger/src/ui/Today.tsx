import { useMemo, useState } from 'react';
import { addDays, fmtDay, fmtDur, weekDays, weekStart, weekdayShort, type Day } from '../lib/dates';
import { activeCategories, categoryLabel, cellMinutes } from '../lib/model';
import { parseDurationText, parseLine } from '../lib/parser';
import { summaryPrompt, weekSummary } from '../lib/summary';
import { elapsedMinutes, fmtClock, overCap } from '../lib/timer';
import type { Ctx } from './App';
import { catColor, DayBars, Legend, partsOf } from './common';

const ADDS = [
  { label: '+15m', minutes: 15 },
  { label: '+30m', minutes: 30 },
  { label: '+1h', minutes: 60 },
  { label: '+2h', minutes: 120 },
];

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Today({ ctx }: { ctx: Ctx }) {
  const { doc, today, now } = ctx;
  const cats = activeCategories(doc.categories);
  const week = weekStart(today);
  const yesterday = addDays(today, -1);
  const [picked, setPicked] = useState<Day>(today);
  // If midnight passes or the week turns while the tab is open, fall back to today.
  const day = picked > today || picked < addDays(week, -1) ? today : picked;
  const [line, setLine] = useState('');
  const [lineError, setLineError] = useState('');

  const summary = useMemo(() => weekSummary(doc.entries, doc.categories, week, today), [doc.entries, doc.categories, week, today]);
  const todayTotal = summary.days.find((d) => d.day === today)?.total ?? 0;
  const nudge = summaryPrompt(doc.entries, doc.reflections, today);
  const preview = line.trim() ? parseLine(line, doc.categories, today) : null;

  const options: { day: Day; label: string }[] = [
    { day: today, label: 'Today' },
    { day: yesterday, label: 'Yesterday' },
    ...weekDays(week)
      .filter((d) => d < yesterday)
      .reverse()
      .map((d) => ({ day: d, label: weekdayShort(d) })),
  ];

  const submitLine = () => {
    const r = parseLine(line, doc.categories, today);
    if (!r.ok) {
      setLineError(r.message);
      return;
    }
    ctx.log([{ day: r.day, category: r.category, minutes: r.minutes, ...(r.note ? { note: r.note } : {}) }]);
    setLine('');
    setLineError('');
  };

  const timer = doc.timer;
  const flagged = timer !== null && overCap(timer.startedAt, now, doc.settings.timerCapHours);

  return (
    <>
      {nudge && (
        <section className="card banner">
          <div className="card-head">
            <p>
              <b>{nudge.when === 'sunday' ? 'It is Sunday.' : 'Last week is not written up yet.'}</b>{' '}
              {nudge.when === 'sunday' ? 'Ten minutes to read the week back and fill in the three boxes.' : 'The summary and its three boxes are waiting.'}
            </p>
            <button className="btn primary" onClick={() => ctx.openSummary(nudge.week)}>
              Open the summary
            </button>
          </div>
        </section>
      )}

      {timer && flagged && <Flagged ctx={ctx} />}

      <section className="card">
        <div className="totals">
          <div className="stats" style={{ gridTemplateColumns: 'auto auto', gap: 24 }}>
            <div className="stat">
              <b data-testid="today-total">{fmtDur(todayTotal)}</b>
              <span>Today</span>
            </div>
            <div className="stat">
              <b data-testid="week-total">{fmtDur(summary.totalMinutes)}</b>
              <span>This week</span>
            </div>
          </div>
          <Legend parts={partsOf(cats)} />
        </div>
        <DayBars days={summary.days} parts={partsOf(doc.categories)} today={today} selected={day} onPick={setPicked} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Log {day === today ? 'today' : day === yesterday ? 'yesterday' : fmtDay(day)}</h2>
          <div className="days-row" role="group" aria-label="Day to log">
            {options.map((o) => (
              <button key={o.day} className={`pick${o.day === day ? ' on' : ''}`} aria-pressed={o.day === day} onClick={() => setPicked(o.day)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {cats.length === 0 ? (
          <p className="empty">No categories. Add one in Settings to start logging.</p>
        ) : (
          <div className="cats">
            {cats.map((c) => {
              const isRunning = timer?.category === c.id;
              const logged = cellMinutes(doc.entries, day, c.id);
              return (
                <div key={c.id} className={`cat${isRunning ? ' running' : ''}`} style={{ ['--cat' as string]: catColor(c.color) }}>
                  <div className="cat-head">
                    <span className="name">
                      {c.label}
                      <span className="muted small num">{logged > 0 ? fmtDur(logged) : 'nothing yet'}</span>
                    </span>
                    {isRunning ? (
                      <button className="btn small primary num" disabled={flagged} onClick={ctx.stopTimer} aria-label={`Stop ${c.label} timer`}>
                        Stop {fmtClock(elapsedMinutes(timer.startedAt, now))}
                      </button>
                    ) : (
                      <button className="btn small" onClick={() => ctx.startTimer(c.id)} aria-label={`Start ${c.label} timer`}>
                        Start timer
                      </button>
                    )}
                  </div>
                  <div className="adds" role="group" aria-label={`Add time to ${c.label}`}>
                    {ADDS.map((a) => (
                      <button key={a.label} className="num" aria-label={`Add ${fmtDur(a.minutes)} to ${c.label}`} onClick={() => ctx.log([{ day, category: c.id, minutes: a.minutes }])}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {timer && !flagged && (
          <p className="muted small" role="status">
            {categoryLabel(doc.categories, timer.category)} timer running since {clockTime(timer.startedAt)}. It keeps counting with the page closed; stopping rounds to 5 minutes.
          </p>
        )}

        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            submitLine();
          }}
        >
          <span>Or type it</span>
          <div className="quick">
            <input
              aria-label="Quick line"
              placeholder="masters 1h30 reading"
              value={line}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              onChange={(e) => {
                setLine(e.target.value);
                setLineError('');
              }}
            />
            <button className="btn primary" type="submit" disabled={!line.trim()}>
              Log
            </button>
          </div>
          <p className={`small ${lineError ? 'err' : 'muted'}`} role="status" data-testid="line-status">
            {lineError
              ? lineError
              : preview?.ok
                ? `${categoryLabel(doc.categories, preview.category)}, ${fmtDur(preview.minutes)}, ${preview.day === today ? 'today' : fmtDay(preview.day)}${preview.note ? `, note "${preview.note}"` : ''}`
                : preview
                  ? preview.message
                  : 'Category, duration, then an optional note. Add yesterday or mon to backfill.'}
          </p>
        </form>
      </section>
    </>
  );
}

/** A timer that ran past the cap is never logged as it stands: the owner says how long it really was. */
function Flagged({ ctx }: { ctx: Ctx }) {
  const { doc, now } = ctx;
  const timer = doc.timer!;
  const cap = doc.settings.timerCapHours;
  const [text, setText] = useState(`${cap}h`);
  const minutes = parseDurationText(text, true);
  const elapsed = Math.floor(elapsedMinutes(timer.startedAt, now));
  const valid = minutes !== null && minutes > 0 && minutes <= elapsed;
  const started = new Date(timer.startedAt);
  return (
    <section className="card banner flag">
      <p>
        <b>The {categoryLabel(doc.categories, timer.category)} timer was left running.</b> It started {started.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} at{' '}
        {clockTime(timer.startedAt)} and has run {fmtDur(elapsed)}, past the {cap}h cap, so nothing has been logged. How long was it really?
      </p>
      <div className="btn-row">
        <input aria-label="Actual duration" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 110 }} />
        <button className="btn primary" disabled={!valid} onClick={() => ctx.settleTimer(minutes)}>
          Log {valid ? fmtDur(minutes) : ''}
        </button>
        <button className="btn danger" onClick={() => ctx.settleTimer(null)}>
          Discard it
        </button>
      </div>
      {!valid && <p className="small err">Enter a length such as 1h30 or 45m, no longer than the {fmtDur(elapsed)} it ran.</p>}
    </section>
  );
}
