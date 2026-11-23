import { useMemo, useState } from 'react';
import { fmtDayShort, fmtDur, fmtHours, fmtPeriod, fmtWeekRange, weekStart } from '../lib/dates';
import { activeCategories, type Category } from '../lib/model';
import { rollup, trendEndWeek, weeklySeries, type SeriesPoint } from '../lib/summary';
import type { Ctx } from './App';
import { catColor, Dot, Legend, partsOf, useWidth, type Part } from './common';

const WEEKS = 12;

/** Round hour ticks: at most five steps of 1, 2, 5, 10, 20… hours. */
function ticks(maxMinutes: number): number[] {
  const maxH = Math.max(1, maxMinutes / 60);
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => maxH / s <= 5) ?? 200;
  const top = Math.ceil(maxH / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** A column segment: square at the bottom, 4px rounded at the top when it is the data end. */
const segPath = (x: number, y: number, w: number, h: number, round: boolean) => {
  const r = round ? Math.min(4, h, w / 2) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

function StackedWeeks({ series, parts }: { series: SeriesPoint[]; parts: Part[] }) {
  const [ref, W] = useWidth<HTMLDivElement>(700);
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const m = { l: 30, r: 6, t: 10, b: 22 };
  const yt = ticks(Math.max(...series.map((p) => p.total)));
  const top = yt[yt.length - 1] * 60;
  const plotH = H - m.t - m.b;
  const band = (W - m.l - m.r) / series.length;
  const barW = Math.min(24, band - 6);
  const y = (min: number) => m.t + plotH - (min / top) * plotH;
  const every = W < 520 ? 3 : 2;
  const h = hover === null ? null : series[hover];

  return (
    <div className="chart" ref={ref}>
      <svg height={H} role="img" aria-label={`Hours per week by category, last ${series.length} weeks. The table below has the numbers.`}>
        {yt.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t * 60)} y2={y(t * 60)} stroke={t === 0 ? 'var(--border)' : 'var(--grid)'} />
            <text x={m.l - 6} y={y(t * 60) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {series.map((p, i) => {
          const x0 = m.l + i * band;
          const live = parts.filter((c) => (p.byCategory[c.id] ?? 0) > 0);
          let acc = 0;
          return (
            <g key={p.weekStart}>
              {hover === i && <rect x={x0} y={m.t} width={band} height={plotH} fill="var(--surface-2)" />}
              {live.map((c, k) => {
                const v = p.byCategory[c.id];
                const yTop = y(acc + v);
                const hgt = y(acc) - yTop;
                acc += v;
                // The 2px surface gap sits at the bottom of every segment above the first.
                const gap = k > 0 && hgt > 3 ? 2 : 0;
                return <path key={c.id} d={segPath(x0 + (band - barW) / 2, yTop, barW, hgt - gap, k === live.length - 1)} fill={catColor(c.color)} />;
              })}
              {(series.length - 1 - i) % every === 0 && (
                <text x={x0 + band / 2} y={H - 6} textAnchor="middle" className={i === series.length - 1 ? 'ink' : undefined}>
                  {fmtDayShort(p.weekStart)}
                </text>
              )}
              <rect
                x={x0}
                y={0}
                width={band}
                height={H}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                onPointerLeave={() => setHover((cur) => (cur === i ? null : cur))}
              />
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="tip" style={{ left: Math.min(Math.max(0, m.l + (hover + 0.5) * band - 85), W - 175), top: 0 }}>
          <b>{fmtWeekRange(h.weekStart)}</b>
          {parts
            .filter((c) => (h.byCategory[c.id] ?? 0) > 0)
            .map((c) => (
              <div key={c.id}>
                <span>
                  <Dot color={c.color} />
                  {c.label}
                </span>
                <b>{fmtDur(h.byCategory[c.id])}</b>
              </div>
            ))}
          <div>
            <span>Total</span>
            <b>{h.total > 0 ? fmtDur(h.total) : 'nothing'}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryLine({ series, cat }: { series: SeriesPoint[]; cat: Category }) {
  const [ref, W] = useWidth<HTMLDivElement>(400);
  const [hover, setHover] = useState<number | null>(null);
  const H = 132;
  const m = { l: 30, r: 46, t: 12, b: 20 };
  const values = series.map((p) => p.byCategory[cat.id] ?? 0);
  const target = cat.weeklyTargetHours === undefined ? null : cat.weeklyTargetHours * 60;
  const yt = ticks(Math.max(...values, target ?? 0));
  const top = yt[yt.length - 1] * 60;
  const plotH = H - m.t - m.b;
  const step = (W - m.l - m.r) / (series.length - 1);
  const x = (i: number) => m.l + i * step;
  const y = (min: number) => m.t + plotH - (min / top) * plotH;
  const last = values.length - 1;
  const color = catColor(cat.color);
  const kind = cat.targetKind === 'ceiling' ? 'ceiling' : 'target';
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(last, Math.round((e.clientX - box.left) / step))));
  };

  return (
    <div className="mini">
      <div className="mini-head">
        <h3 style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Dot color={cat.color} />
          {cat.label}
        </h3>
        <span className="muted small">{target === null ? 'no target set' : `${kind} ${fmtDur(target)} a week`}</span>
      </div>
      <div className="chart" ref={ref}>
        <svg height={H} role="img" aria-label={`${cat.label}: hours per week, last ${series.length} weeks${target === null ? '' : `, against a ${kind} of ${fmtDur(target)}`}.`}>
          {yt.filter((_, i) => i === 0 || i === yt.length - 1 || yt.length <= 4).map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t * 60)} y2={y(t * 60)} stroke={t === 0 ? 'var(--border)' : 'var(--grid)'} />
              <text x={m.l - 6} y={y(t * 60) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {target !== null && (
            <g>
              <line x1={m.l} x2={W - m.r} y1={y(target)} y2={y(target)} stroke="var(--muted)" strokeWidth={1} />
              <text x={W - m.r + 6} y={y(target) + 4}>
                {kind === 'ceiling' ? 'max' : 'min'} {fmtHours(target)}
              </text>
            </g>
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + plotH} stroke="var(--border)" />}
          <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(last)} cy={y(values[last])} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
          {hover !== null && hover !== last && <circle cx={x(hover)} cy={y(values[hover])} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />}
          {/* The end label steps aside when it would sit on the target label. */}
          <text className="ink" x={W - m.r + 6} y={y(values[last]) + 4 + (target !== null && Math.abs(y(values[last]) - y(target)) < 12 ? (values[last] >= target ? -12 : 12) : 0)}>
            {fmtHours(values[last])}h
          </text>
          <text x={m.l} y={H - 5}>
            {fmtDayShort(series[0].weekStart)}
          </text>
          <text x={x(last)} y={H - 5} textAnchor="end">
            {fmtDayShort(series[last].weekStart)}
          </text>
          <rect x={m.l - step / 2} y={0} width={W - m.l - m.r + step} height={H} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {hover !== null && (
          <div className="tip" style={{ left: Math.min(Math.max(0, x(hover) - 70), W - 150), top: 0 }}>
            <b>{fmtWeekRange(series[hover].weekStart)}</b>
            <div>
              <span>
                <Dot color={cat.color} />
                {cat.label}
              </span>
              <b>{fmtDur(values[hover])}</b>
            </div>
            {target !== null && (
              <div>
                <span>Against {kind}</span>
                <b>{values[hover] === target ? 'exact' : `${fmtDur(values[hover] - target)} ${values[hover] > target ? 'over' : 'under'}`}</b>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Trends({ ctx }: { ctx: Ctx }) {
  const { doc, today } = ctx;
  const [by, setBy] = useState<'month' | 'quarter'>('month');
  const series = useMemo(() => weeklySeries(doc.entries, trendEndWeek(today), WEEKS), [doc.entries, today]);
  const periods = useMemo(() => rollup(doc.entries, by), [doc.entries, by]);
  const active = activeCategories(doc.categories);
  // Archived categories stay in the stacked chart while they have time in the window.
  const cats = doc.categories.filter((c) => !c.archived || series.some((p) => p.byCategory[c.id]));
  const rollCats = doc.categories.filter((c) => !c.archived || periods.some((p) => p.byCategory[c.id]));

  if (doc.entries.length === 0) {
    return (
      <section className="card">
        <h2>Trends</h2>
        <p className="empty">Nothing to chart yet. Log some time on the Today tab and the last 12 weeks will build up here.</p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Hours per week, last {WEEKS} weeks</h2>
          <Legend parts={partsOf(cats)} />
        </div>
        <StackedWeeks series={series} parts={partsOf(cats)} />
        <details>
          <summary>Show as a table (hours)</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Week of</th>
                  {cats.map((c) => (
                    <th key={c.id} className="num">
                      {c.label}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().map((p) => (
                  <tr key={p.weekStart}>
                    <td>{fmtDayShort(p.weekStart)}</td>
                    {cats.map((c) => (
                      <td key={c.id} className="num">
                        {p.byCategory[c.id] ? fmtHours(p.byCategory[c.id]) : '–'}
                      </td>
                    ))}
                    <td className="num strong">{p.total ? fmtHours(p.total) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Each category against its target</h2>
          <span className="muted small">Hours per week, Monday to Sunday.{trendEndWeek(today) !== weekStart(today) ? ' The week in progress joins on Sunday.' : ''}</span>
        </div>
        <div className="minis">
          {active.map((c) => (
            <CategoryLine key={c.id} series={series} cat={c} />
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Hours by {by}</h2>
          <div className="tabs" role="group" aria-label="Roll-up period">
            <button className={by === 'month' ? 'on' : ''} aria-pressed={by === 'month'} onClick={() => setBy('month')}>
              Month
            </button>
            <button className={by === 'quarter' ? 'on' : ''} aria-pressed={by === 'quarter'} onClick={() => setBy('quarter')}>
              Quarter
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{by === 'month' ? 'Month' : 'Quarter'}</th>
                {rollCats.map((c) => (
                  <th key={c.id} className="num">
                    {c.label}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.key}>
                  <td>{fmtPeriod(p.key)}</td>
                  {rollCats.map((c) => (
                    <td key={c.id} className="num">
                      {p.byCategory[c.id] ? fmtHours(p.byCategory[c.id]) : '–'}
                    </td>
                  ))}
                  <td className="num strong">{fmtHours(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Each entry counts in the month of its own day, so a week that straddles two months is split between them.</p>
      </section>
    </>
  );
}
