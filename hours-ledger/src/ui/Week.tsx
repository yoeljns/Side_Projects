import { useMemo, useState } from 'react';
import { addDays, fmtDay, fmtDur, fmtWeekRange, isoWeek, weekStart, weekdayShort, type Day } from '../lib/dates';
import { activeCategories, cellMinutes, setCellMinutes, type Entry } from '../lib/model';
import { parseDurationText } from '../lib/parser';
import { weekSummary } from '../lib/summary';
import { fmtClock } from '../lib/timer';
import { newId } from '../lib/store';
import type { Ctx } from './App';
import { catColor, CommitInput } from './common';

export function WeekNav({ week, setWeek, today }: { week: Day; setWeek: (w: Day) => void; today: Day }) {
  const current = weekStart(today);
  return (
    <div className="nav no-print">
      <button className="btn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
        ←
      </button>
      <button className="btn" aria-label="Next week" disabled={week >= current} onClick={() => setWeek(addDays(week, 7))}>
        →
      </button>
      {week !== current && (
        <button className="btn" onClick={() => setWeek(current)}>
          This week
        </button>
      )}
    </div>
  );
}

export function Week({ ctx }: { ctx: Ctx }) {
  const { doc, today, update } = ctx;
  const [week, setWeek] = useState<Day>(() => weekStart(today));
  const [sel, setSel] = useState<{ day: Day; category: string } | null>(null);
  const summary = useMemo(() => weekSummary(doc.entries, doc.categories, week, today), [doc.entries, doc.categories, week, today]);
  const cols = summary.categories;
  const entries = doc.entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.day >= week && e.day <= addDays(week, 6))
    .sort((a, b) => (a.e.day === b.e.day ? b.i - a.i : a.e.day < b.e.day ? 1 : -1))
    .map(({ e }) => e);

  const setCell = (day: Day, category: string, minutes: number) =>
    update((d) => ({ ...d, entries: setCellMinutes(d.entries, day, category, Math.min(1440, minutes), newId()) }));
  const patch = (id: string, change: Partial<Entry>) => update((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, ...change } : e)) }));
  const remove = (entry: Entry) => {
    const index = doc.entries.findIndex((e) => e.id === entry.id);
    update((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== entry.id) }));
    ctx.say('Entry deleted.', () => update((d) => ({ ...d, entries: [...d.entries.slice(0, index), entry, ...d.entries.slice(index)] })));
  };

  const selMinutes = sel ? cellMinutes(doc.entries, sel.day, sel.category) : 0;
  const selLabel = sel ? cols.find((c) => c.id === sel.category)?.label ?? sel.category : '';

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>
              Week {isoWeek(week).week}, {fmtWeekRange(week)}
            </h2>
            <p className="muted small">Tap a cell to change it. Times are hours:minutes.</p>
          </div>
          <WeekNav
            week={week}
            today={today}
            setWeek={(w) => {
              setWeek(w);
              setSel(null);
            }}
          />
        </div>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Day</th>
                {cols.map((c) => (
                  <th key={c.id} scope="col">
                    <span style={{ ['--cat' as string]: catColor(c.color) }}>{c.label}</span>
                  </th>
                ))}
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.days.map((d) => (
                <tr key={d.day}>
                  <td className="small">
                    <b>{weekdayShort(d.day)}</b> <span className="muted num">{Number(d.day.slice(8))}</span>
                  </td>
                  {cols.map((c) => {
                    const m = d.byCategory[c.id] ?? 0;
                    const on = sel?.day === d.day && sel.category === c.id;
                    return (
                      <td key={c.id}>
                        <button
                          className={`cell${m === 0 ? ' zero' : ''}${on ? ' on' : ''}`}
                          disabled={d.day > today}
                          aria-label={`${c.label}, ${fmtDay(d.day)}: ${m > 0 ? fmtDur(m) : 'nothing'}. Edit`}
                          aria-pressed={on}
                          onClick={() => setSel(on ? null : { day: d.day, category: c.id })}
                        >
                          {m > 0 ? fmtClock(m) : '·'}
                        </button>
                      </td>
                    );
                  })}
                  <td className="num small strong">{d.total > 0 ? fmtClock(d.total) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Week</td>
                {cols.map((c) => (
                  <td key={c.id}>{fmtClock(c.minutes)}</td>
                ))}
                <td className="num">{fmtClock(summary.totalMinutes)}</td>
              </tr>
              {cols.some((c) => c.targetMinutes !== null) && (
                <tr className="sub">
                  <td>Target</td>
                  {cols.map((c) => (
                    <td key={c.id}>{c.targetMinutes === null ? '' : `${c.targetKind === 'ceiling' ? '≤' : '≥'} ${fmtDur(c.targetMinutes)}`}</td>
                  ))}
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
        {sel && (
          <div className="editor" data-testid="cell-editor">
            <div className="card-head">
              <b>
                {selLabel}, {fmtDay(sel.day)}
              </b>
              <button className="btn small" onClick={() => setSel(null)}>
                Done
              </button>
            </div>
            <div className="btn-row">
              <button className="btn" disabled={selMinutes === 0} aria-label="15 minutes less" onClick={() => setCell(sel.day, sel.category, selMinutes - 15)}>
                −15m
              </button>
              <CommitInput
                label={`Total for ${selLabel} on ${fmtDay(sel.day)}`}
                value={selMinutes > 0 ? fmtDur(selMinutes) : '0m'}
                onCommit={(v) => {
                  const m = parseDurationText(v, true);
                  if (m === null || m > 1440) return false;
                  setCell(sel.day, sel.category, m);
                  return true;
                }}
              />
              <button className="btn" aria-label="15 minutes more" onClick={() => setCell(sel.day, sel.category, selMinutes + 15)}>
                +15m
              </button>
              <button className="btn" aria-label="1 hour more" onClick={() => setCell(sel.day, sel.category, selMinutes + 60)}>
                +1h
              </button>
              <button className="btn danger" disabled={selMinutes === 0} onClick={() => setCell(sel.day, sel.category, 0)}>
                Clear
              </button>
            </div>
            <p className="muted small">Type a total such as 1h30, 45m or 90. Lowering it trims the newest entries first.</p>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Entries</h2>
          <span className="muted small num">{entries.length === 0 ? '' : `${entries.length} this week`}</span>
        </div>
        {entries.length === 0 ? (
          <p className="empty">Nothing logged in this week. Use the Today tab, or tap a cell above.</p>
        ) : (
          <div>
            {entries.map((e) => (
              <div className="entry" key={e.id}>
                <span className="small">
                  <b>{weekdayShort(e.day)}</b> <span className="muted num">{Number(e.day.slice(8))}</span>
                </span>
                <select aria-label="Category" value={e.category} onChange={(ev) => patch(e.id, { category: ev.target.value })}>
                  {!activeCategories(doc.categories).some((c) => c.id === e.category) && <option value={e.category}>{cols.find((c) => c.id === e.category)?.label ?? e.category}</option>}
                  {activeCategories(doc.categories).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <CommitInput
                  className="num"
                  label="Duration"
                  value={fmtDur(e.minutes)}
                  onCommit={(v) => {
                    const m = parseDurationText(v, true);
                    if (m === null || m <= 0 || m > 1440) return false;
                    patch(e.id, { minutes: m });
                    return true;
                  }}
                />
                <CommitInput
                  className="note"
                  label="Note"
                  placeholder="Note"
                  value={e.note ?? ''}
                  onCommit={(v) => {
                    patch(e.id, { note: v.trim() || undefined });
                    return true;
                  }}
                />
                <button className="btn small danger" aria-label={`Delete ${fmtDur(e.minutes)} entry`} onClick={() => remove(e)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
