import { useMemo, useState } from 'react';
import { fmtDur, weekStart, type Day } from '../lib/dates';
import { BLANK_REFLECTION, type Reflection } from '../lib/model';
import { categoryClauses, daySentence, PROMPTS, streakNote, summaryMarkdown, totalSentence, weekSummary, weekTitle, type CategoryRow } from '../lib/summary';
import type { Ctx } from './App';
import { catColor, DayBars, Dot, SegBar } from './common';
import { WeekNav } from './Week';

function Meter({ r }: { r: CategoryRow }) {
  if (r.targetMinutes === null) return null;
  const scale = Math.max(r.minutes, r.targetMinutes, 1) * 1.12;
  return (
    <div className="meter" role="img" aria-label={`${fmtDur(r.minutes)} against a ${r.targetKind} of ${fmtDur(r.targetMinutes)}`}>
      <i style={{ width: `${(r.minutes / scale) * 100}%`, background: catColor(r.color) }} />
      <b style={{ left: `${(r.targetMinutes / scale) * 100}%` }} />
    </div>
  );
}

export function Summary({ ctx, week, setWeek }: { ctx: Ctx; week: Day; setWeek: (w: Day) => void }) {
  const { doc, today, update } = ctx;
  const s = useMemo(() => weekSummary(doc.entries, doc.categories, week, today), [doc.entries, doc.categories, week, today]);
  const reflection = doc.reflections[week] ?? BLANK_REFLECTION;
  const [fallback, setFallback] = useState('');
  const inProgress = week === weekStart(today) && today < s.days[6].day;
  const rows = s.categories;

  const write = (key: keyof Reflection, value: string) =>
    update((d) => ({ ...d, reflections: { ...d.reflections, [week]: { ...BLANK_REFLECTION, ...d.reflections[week], [key]: value } } }));

  const copy = async () => {
    const md = summaryMarkdown(s, doc.reflections[week]);
    try {
      await navigator.clipboard.writeText(md);
      setFallback('');
      ctx.say('Summary copied as markdown.');
    } catch {
      setFallback(md); // no clipboard permission: show the text to copy by hand
    }
  };

  return (
    <section className="card sheet" data-testid="sheet">
      <div className="sheet-head">
        <div>
          <h3>Hours ledger{inProgress ? ' · week in progress' : ''}</h3>
          <h2>{weekTitle(s)}</h2>
        </div>
        <WeekNav week={week} setWeek={setWeek} today={today} />
      </div>

      <div>
        <div className="hero" data-testid="hero">{fmtDur(s.totalMinutes)}</div>
        <p>{totalSentence(s)}</p>
      </div>

      {s.totalMinutes === 0 ? (
        <p className="empty">Nothing was logged in this week, so there is nothing to sum up. The three boxes below still work.</p>
      ) : (
        <>
          <SegBar rows={rows} />

          <ul className="lines">
            {rows.map((r) => {
              const note = streakNote(r);
              const clauses = categoryClauses(r, s.avgWeeks);
              return (
                <li key={r.id}>
                  <Dot color={r.color} />
                  <div className="line-head">
                    <b>{r.label}</b>
                    <span className="num">
                      <b>{fmtDur(r.minutes)}</b> <span className="muted">· {Math.round(r.share * 100)}%</span>
                    </span>
                  </div>
                  <Meter r={r} />
                  {(clauses || note) && (
                    <p className="small">
                      {clauses && `${clauses[0].toUpperCase()}${clauses.slice(1)}.`}
                      {note && <span className="muted"> {note[0].toUpperCase() + note.slice(1)}.</span>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div style={{ display: 'grid', gap: 6 }}>
            <h3>Day by day, hours</h3>
            <DayBars days={s.days} parts={rows} today={today} height={40} />
            <p className="small">{daySentence(s)}</p>
          </div>
        </>
      )}

      <div className="prompts">
        {PROMPTS.map((p) => (
          <label className="field" key={p.key}>
            <span>{p.label}</span>
            <textarea value={reflection[p.key]} rows={2} onChange={(e) => write(p.key, e.target.value)} />
            <div className="print-only">{reflection[p.key]}</div>
          </label>
        ))}
      </div>

      <div className="btn-row no-print">
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn primary" onClick={() => void copy()}>
          Copy as markdown
        </button>
      </div>

      {fallback && (
        <label className="field no-print">
          <span>The browser blocked the clipboard. Select and copy this instead.</span>
          <textarea readOnly value={fallback} rows={10} onFocus={(e) => e.target.select()} />
        </label>
      )}
    </section>
  );
}
