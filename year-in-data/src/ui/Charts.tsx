// Hand-written SVG charts. Colours come from the CSS variables so both themes work.
// Every mark has a hover and focus tooltip; the same numbers are in the tables beside each chart.
import { type FocusEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { addDays, daysInMonth, fmtDate, fmtMonth, monthShort, monthsIn } from '../lib/dates';
import type { ScoredCall } from '../lib/decisions';
import type { YearRecord } from '../lib/record';
import { BUCKETS, BUCKET_LABEL, type Bucket, cityName } from '../lib/trips';

export const BUCKET_COLOR: Record<Bucket, string> = { london: 'var(--london)', istanbul: 'var(--istanbul)', elsewhere: 'var(--elsewhere)', unrecorded: 'var(--surface-2)' };

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

interface Tip { x: number; y: number; w: number; text: string }

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const on = (text: string) => ({
    onPointerEnter: (e: PointerEvent<Element>) => place(e.currentTarget, text),
    onFocus: (e: FocusEvent<Element>) => place(e.currentTarget, text),
    onPointerLeave: () => setTip(null),
    onBlur: () => setTip(null),
  });
  const place = (el: Element, text: string) => {
    const host = el.closest('.chart');
    if (!host) return;
    const h = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2 - h.left, y: r.top - h.top, w: h.width, text });
  };
  const node = tip && (
    <div className="tip" role="tooltip" style={{ left: Math.max(Math.min(tip.x, tip.w - 90), 90), top: tip.y, transform: 'translate(-50%, calc(-100% - 6px))' }}>
      {tip.text}
    </div>
  );
  return { on, node };
}

function niceMax(v: number): number {
  if (v <= 10) return Math.max(2, Math.ceil(v / 2) * 2); // keeps the middle tick a whole number
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 4, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** A column that is square at the baseline and rounded at the top. */
function column(x: number, top: number, w: number, h: number, round = true): string {
  const r = round ? Math.min(4, h, w / 2) : 0;
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
}

function Legend({ items }: { items: { label: string; color?: string; value?: string; glyph?: ReactNode }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          {i.glyph ?? <span className="swatch" style={{ background: i.color, border: i.color === BUCKET_COLOR.unrecorded ? '1px solid var(--border)' : undefined }} />}
          {i.label}
          {i.value !== undefined && <b>{i.value}</b>}
        </span>
      ))}
    </div>
  );
}

interface MonthFrame { left: number; top: number; plotH: number; pitch: number; height: number }

function MonthAxis({ months, f, width, max, unit }: { months: string[]; f: MonthFrame; width: number; max: number; unit: string }) {
  const short = f.pitch < 30;
  return (
    <>
      {[0, max / 2, max].map((t) => {
        const y = f.top + f.plotH - (t / max) * f.plotH;
        return (
          <g key={t}>
            <line x1={f.left} x2={width} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
            <text x={f.left - 6} y={y + 4} textAnchor="end">{t === max ? `${t}${unit}` : t}</text>
          </g>
        );
      })}
      {months.map((m, i) => (
        <g key={m}>
          <text x={f.left + f.pitch * (i + 0.5)} y={f.top + f.plotH + 14} textAnchor="middle">{short ? monthShort(m)[0] : monthShort(m)}</text>
          {(i === 0 || m.endsWith('-01')) && <text x={f.left + f.pitch * (i + 0.5)} y={f.top + f.plotH + 27} textAnchor="middle">{short ? `’${m.slice(2, 4)}` : m.slice(0, 4)}</text>}
        </g>
      ))}
    </>
  );
}

const frame = (width: number, n: number): MonthFrame => {
  const left = 34;
  return { left, top: 8, plotH: 96, pitch: (width - left) / n, height: 8 + 96 + 32 };
};

/** One number per month of the year, as columns. A single series, so the title names it and there is no legend. */
export function MonthColumns({ title, data, unit = '', format = (v: number) => String(v) }: { title: string; data: { month: string; value: number }[]; unit?: string; format?: (v: number) => string }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const f = frame(width, data.length);
  const w = Math.max(2, Math.min(24, f.pitch - 2));
  return (
    <div>
      <div className="chart-title">{title}</div>
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg height={f.height} role="img" aria-label={`${title}: ${data.map((d) => `${fmtMonth(d.month)} ${format(d.value)}`).join(', ')}`}>
            <MonthAxis months={data.map((d) => d.month)} f={f} width={width} max={max} unit={unit} />
            {data.map((d, i) => {
              const h = (d.value / max) * f.plotH;
              const x = f.left + f.pitch * (i + 0.5) - w / 2;
              return (
                <g key={d.month} className="hit" tabIndex={0} aria-label={`${fmtMonth(d.month)}: ${format(d.value)}`} {...tip.on(`${fmtMonth(d.month)}\n${format(d.value)}`)}>
                  <rect x={f.left + f.pitch * i} y={f.top} width={f.pitch} height={f.plotH} fill="transparent" />
                  {h > 0 && <path d={column(x, f.top + f.plotH - h, w, h)} fill="var(--accent)" />}
                </g>
              );
            })}
          </svg>
        )}
        {tip.node}
      </div>
    </div>
  );
}

/** Nights each month, stacked by where they were spent. */
export function NightsByMonth({ months }: { months: ({ month: string } & Record<Bucket, number>)[] }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const f = frame(width, months.length);
  const w = Math.max(2, Math.min(24, f.pitch - 2));
  const totals = Object.fromEntries(BUCKETS.map((b) => [b, months.reduce((s, m) => s + m[b], 0)])) as Record<Bucket, number>;
  return (
    <div>
      <div className="chart-title">Nights by month</div>
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg height={f.height} role="img" aria-label="Nights by month, split by London, Istanbul, elsewhere and not recorded. The same numbers are in the table below.">
            <MonthAxis months={months.map((m) => m.month)} f={f} width={width} max={30} unit="" />
            {months.map((m, i) => {
              const x = f.left + f.pitch * (i + 0.5) - w / 2;
              let y = f.top + f.plotH;
              const present = BUCKETS.filter((b) => m[b] > 0);
              const text = `${fmtMonth(m.month)}\n${present.map((b) => `${BUCKET_LABEL[b]} ${m[b]}`).join('\n') || 'No nights yet'}`;
              return (
                <g key={m.month} className="hit" tabIndex={0} aria-label={text.replace(/\n/g, ', ')} {...tip.on(text)}>
                  <rect x={f.left + f.pitch * i} y={f.top} width={f.pitch} height={f.plotH} fill="transparent" />
                  {present.map((b, k) => {
                    const h = (m[b] / 30) * f.plotH; // the axis runs 0 to 30; a 31-night month stands just above it
                    y -= h;
                    const gap = k === 0 ? 0 : 2; // surface gap between stacked segments
                    const hh = Math.max(1, h - gap);
                    return <path key={b} d={column(x, y, w, hh, k === present.length - 1)} fill={BUCKET_COLOR[b]} stroke={b === 'unrecorded' ? 'var(--border)' : undefined} />;
                  })}
                </g>
              );
            })}
          </svg>
        )}
        {tip.node}
      </div>
      <Legend items={BUCKETS.filter((b) => totals[b] > 0).map((b) => ({ label: BUCKET_LABEL[b], color: BUCKET_COLOR[b], value: String(totals[b]) }))} />
    </div>
  );
}

/** One whole split into parts, with the numbers in the legend. */
export function SplitBar({ title, parts }: { title: string; parts: { label: string; value: number; color: string }[] }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  const gaps = 2 * (shown.length - 1);
  let x = 0;
  return (
    <div>
      <div className="chart-title">{title}</div>
      <div className="chart" ref={ref}>
        {width > 0 && total > 0 && (
          <svg height={14} role="img" aria-label={`${title}: ${shown.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
            <clipPath id={`clip-${title.replace(/\W/g, '')}`}><rect width={width} height={14} rx={4} /></clipPath>
            <g clipPath={`url(#clip-${title.replace(/\W/g, '')})`}>
              {shown.map((p) => {
                const w = Math.max(2, ((width - gaps) * p.value) / total);
                const rect = <rect key={p.label} className="hit" tabIndex={0} aria-label={`${p.label}: ${p.value}`} x={x} y={0} width={w} height={14} fill={p.color} {...tip.on(`${p.label}\n${p.value} (${Math.round((p.value / total) * 100)}%)`)} />;
                x += w + 2;
                return rect;
              })}
            </g>
          </svg>
        )}
        {tip.node}
      </div>
      <Legend items={parts.map((p) => ({ label: p.label, color: p.color, value: String(p.value) }))} />
    </div>
  );
}

/** Horizontal bars for a ranked list. One series: the title names it. */
export function RankBars({ title, rows }: { title: string; rows: { label: string; value: number; text: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <div>
      <div className="chart-title">{title}</div>
      <div className="chart" style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, max-content) minmax(40px, 1fr) max-content', gap: '6px 10px', alignItems: 'center' }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'contents' }}>
            <span className="small wrap-any">{r.label}</span>
            <svg height={14} role="img" aria-label={`${r.label}: ${r.text}`} preserveAspectRatio="none" viewBox="0 0 100 14">
              <line x1={0} x2={0} y1={0} y2={14} stroke="var(--grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {max > 0 && r.value > 0 && <rect x={0} y={1} width={Math.max(1, (r.value / max) * 100)} height={12} rx={2} fill="var(--accent)" />}
            </svg>
            <span className="small num strong">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Each resolved call as a dot at the probability given, in the row for what then happened. */
export function CallsPlot({ calls }: { calls: ScoredCall[] }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const left = 8;
  const right = 12;
  const plotW = width - left - right;
  const rows = [true, false];
  const rowH = 44;
  const height = rowH * 2 + 22;
  const seen = new Map<string, number>();
  return (
    <div>
      <div className="chart-title">Resolved calls by the probability given</div>
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg height={height} role="img" aria-label="Resolved calls placed by the probability given, in one row for calls that happened and one for calls that did not. The same calls are in the table below.">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={left + t * plotW} x2={left + t * plotW} y1={4} y2={rowH * 2} stroke="var(--grid)" strokeWidth={1} />
                <text x={left + t * plotW} y={height - 4} textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}>{t * 100}%</text>
              </g>
            ))}
            {rows.map((happened, i) => (
              <g key={String(happened)}>
                <line x1={left} x2={left + plotW} y1={rowH * (i + 1) - 8} y2={rowH * (i + 1) - 8} stroke="var(--neutral)" strokeWidth={1} />
                <text className="ink" x={left + 4} y={rowH * i + 14}>{happened ? 'Happened' : 'Did not happen'}</text>
              </g>
            ))}
            {calls.map((c) => {
              const row = c.decision.outcome ? 0 : 1;
              const key = `${row}:${c.decision.probability.toFixed(2)}`;
              const k = seen.get(key) ?? 0;
              seen.set(key, k + 1);
              const text = `${c.decision.title}\nSaid ${Math.round(c.decision.probability * 100)}%, ${c.decision.outcome ? 'happened' : 'did not happen'}\nSquared error ${c.error.toFixed(3)}`;
              return (
                <circle key={c.decision.id} className="hit" tabIndex={0} aria-label={text.replace(/\n/g, '. ')} cx={left + c.decision.probability * plotW} cy={rowH * (row + 1) - 8 - k * 9} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} {...tip.on(text)} />
              );
            })}
          </svg>
        )}
        {tip.node}
      </div>
    </div>
  );
}

export interface DayMarks { match?: string[]; book?: string[]; build?: string[] }

const GLYPH_LABEL = { match: 'Match attended', book: 'Book finished', build: 'Build shipped' } as const;

function Glyph({ kind, cx, cy, s }: { kind: keyof DayMarks; cx: number; cy: number; s: number }) {
  const common = { fill: 'var(--surface)', stroke: 'var(--text)', strokeWidth: 1.25 };
  if (kind === 'match') return <circle cx={cx} cy={cy} r={s / 2} {...common} />;
  if (kind === 'book') return <rect x={cx - s / 2} y={cy - s / 2} width={s} height={s} {...common} />;
  return <path d={`M${cx},${cy - s / 2}L${cx + s / 2},${cy + s / 2}H${cx - s / 2}Z`} {...common} />;
}

/**
 * The year, one row per calendar month and one cell per day, coloured by where the
 * night was spent. Small shapes mark matches (circle), books (square) and builds (triangle).
 */
export function YearStrip({ record, marks }: { record: YearRecord; marks: Map<string, DayMarks> }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const w = record.window;
  const months = monthsIn(w.start, w.end);
  const places = new Map(record.days.map((d) => [d.date, d]));
  const hasPlaces = record.trips !== null;
  const elapsedTo = addDays(w.start, record.elapsedDays);
  const label = 50;
  const cw = (width - label) / 31;
  const ch = 24;
  const gap = cw > 8 ? 2 : 1;
  const s = Math.max(3, Math.min(6, cw - gap - 3));
  const kinds = ['match', 'book', 'build'] as const;
  const used = { match: false, book: false, build: false };
  for (const m of marks.values()) for (const k of kinds) if (m[k]?.length) used[k] = true;
  const counts = record.trips?.buckets;

  return (
    <div>
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg height={months.length * ch} role="img" aria-label={`Each day of the year from ${fmtDate(w.start)} to ${fmtDate(w.last)}, one row per month${hasPlaces ? ', coloured by city' : ''}. The same record is in the tables under Review.`}>
            {months.map((m, row) => {
              const y = +m.slice(0, 4);
              const mo = +m.slice(5, 7);
              return (
                <g key={m}>
                  <text x={0} y={row * ch + ch / 2 + 4}>{monthShort(m)} {row === 0 || mo === 1 ? `’${m.slice(2, 4)}` : ''}</text>
                  {Array.from({ length: daysInMonth(y, mo) }, (_, i) => {
                    const date = `${m}-${String(i + 1).padStart(2, '0')}`;
                    if (date < w.start || date >= w.end) return null;
                    const x = label + i * cw;
                    const future = date >= elapsedTo;
                    const place = places.get(date);
                    const mk = marks.get(date);
                    const lines = [fmtDate(date)];
                    if (future) lines.push('Not yet');
                    else if (hasPlaces) lines.push(place?.city ? cityName(place.city) : 'No stay recorded');
                    for (const k of kinds) for (const t of mk?.[k] ?? []) lines.push(`${GLYPH_LABEL[k]}: ${t}`);
                    return (
                      <g key={date} className="hit" {...tip.on(lines.join('\n'))}>
                        <rect x={x} y={row * ch + gap / 2} width={Math.max(1, cw - gap)} height={ch - gap} rx={Math.min(3, cw / 4)} fill={future ? 'none' : BUCKET_COLOR[place?.bucket ?? 'unrecorded']} stroke={future || !place?.city ? 'var(--border)' : 'none'} strokeWidth={1} />
                        {mk && kinds.map((k, slot) => (mk[k]?.length ? <Glyph key={k} kind={k} cx={x + (cw - gap) / 2} cy={row * ch + 5 + slot * 7} s={s} /> : null))}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
        {tip.node}
      </div>
      <Legend
        items={[
          ...(counts ? BUCKETS.filter((b) => counts[b] > 0).map((b) => ({ label: BUCKET_LABEL[b], color: BUCKET_COLOR[b], value: String(counts[b]) })) : []),
          ...kinds.filter((k) => used[k]).map((k) => ({ label: GLYPH_LABEL[k], glyph: <svg width={12} height={12}><Glyph kind={k} cx={6} cy={6} s={8} /></svg> })),
        ]}
      />
    </div>
  );
}

/** Markers for the year strip, from the record. */
export function dayMarks(record: YearRecord): Map<string, DayMarks> {
  const out = new Map<string, DayMarks>();
  const add = (date: string, kind: keyof DayMarks, text: string) => {
    const m = out.get(date) ?? {};
    (m[kind] ??= []).push(text);
    out.set(date, m);
  };
  for (const f of record.matches?.list ?? []) add(f.date, 'match', `${f.opponent} (${f.home ? 'home' : 'away'})`);
  for (const b of record.books.list) add(b.finished!, 'book', b.title);
  for (const b of record.builds.list) add(b.shipped, 'build', b.name);
  return out;
}
