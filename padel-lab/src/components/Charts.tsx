import { useState } from 'react';
import { fmtClock, fmtSec, pct } from '../lib/format';
import { RALLY_BUCKETS } from '../lib/hits';

export type StackKey = { key: string; label: string };

/** Stacked shares, one row per player or pair. Segment colours come from `.stack-<key>`. */
export function StackBars({
  keys,
  rows,
  note,
}: {
  keys: StackKey[];
  rows: { label: string; values: number[]; empty: boolean; right: string }[];
  note?: string;
}) {
  const [tip, setTip] = useState<{ row: number; k: number; x: number } | null>(null);
  return (
    <div className="zonebars">
      <div className="legend">
        {keys.map((k) => (
          <span key={k.key}>
            <i className={`sw stack-${k.key}`} />
            {k.label}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div className="zonebar-row" key={i}>
          <span className="zonebar-label">{r.label}</span>
          <div className="zonebar" onPointerLeave={() => setTip(null)}>
            {r.empty ? (
              <span className="zonebar-empty">not enough tracking</span>
            ) : (
              keys.map((k, ki) =>
                r.values[ki] > 0.004 ? (
                  <div
                    key={k.key}
                    className={`seg stack-${k.key}`}
                    style={{ flexGrow: r.values[ki] }}
                    onPointerMove={(e) => {
                      const host = e.currentTarget.parentElement!.getBoundingClientRect();
                      setTip({ row: i, k: ki, x: e.clientX - host.left });
                    }}
                  />
                ) : null,
              )
            )}
            {tip && tip.row === i && (
              <div className="tooltip" style={{ left: tip.x, top: 0 }}>
                {keys[tip.k].label}: {pct(r.values[tip.k])}
              </div>
            )}
          </div>
          <span className="zonebar-value">{r.empty ? '–' : r.right}</span>
        </div>
      ))}
      {note && <p className="chart-note">{note}</p>}
    </div>
  );
}

/** Rally lengths in five buckets. */
export function RallyHistogram({ buckets }: { buckets: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((a, b) => a + b, 0);
  return (
    <div className="histogram" onPointerLeave={() => setHover(null)}>
      {buckets.map((n, i) => (
        <div className="hist-col" key={i} onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)}>
          <div className="hist-track">
            <span className="hist-value">{n}</span>
            <div className="hist-bar" style={{ height: `${(n / max) * 100}%` }} />
            {hover === i && (
              <div className="tooltip" style={{ left: '50%', top: 0 }}>
                {n} {n === 1 ? 'rally' : 'rallies'} of {RALLY_BUCKETS[i].label}
                {total > 0 ? ` · ${pct(n / total)}` : ''}
              </div>
            )}
          </div>
          <span className="hist-label">{RALLY_BUCKETS[i].label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The match as a strip: one block per rally, as tall as it was long.
 * With `onSeek`, clicking a rally jumps the video to it.
 */
export function RallyTimeline({
  list,
  totalSec,
  playhead,
  onSeek,
}: {
  list: [number, number, number][];
  totalSec: number;
  playhead?: number | null;
  onSeek?: (t: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, Hh = 64;
  const span = Math.max(totalSec, 1);
  const maxDur = Math.max(10, ...list.map((r) => r[1]));
  const h = hover === null ? null : list[hover];
  return (
    <div className="timeline" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none">
        <line className="grid" x1={0} x2={W} y1={Hh - 0.5} y2={Hh - 0.5} />
        {list.map(([start, dur, hits], i) => {
          const x = (start / span) * W, w = Math.max(2.5, (dur / span) * W - 1);
          const bh = Math.max(4, (dur / maxDur) * (Hh - 4));
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onClick={() => onSeek?.(Math.max(0, start - 1.5))} className={onSeek ? 'clickable' : undefined}>
              <rect className="hit" x={x - 3} y={0} width={w + 6} height={Hh} />
              <rect className={`rally${hover === i ? ' hover' : ''}`} x={x} y={Hh - bh} width={w} height={bh} rx={1.5}>
                <title>{`${fmtClock(start)} · ${fmtSec(dur)} · ${hits} hits`}</title>
              </rect>
            </g>
          );
        })}
        {playhead != null && <line className="playhead" x1={(playhead / span) * W} x2={(playhead / span) * W} y1={0} y2={Hh} />}
      </svg>
      <div className="timeline-axis">
        <span>0:00</span>
        <span>{h ? `${fmtClock(h[0])} · ${fmtSec(h[1])} rally · ${h[2]} hits${onSeek ? ' · click to watch' : ''}` : 'Each block is a rally; taller means longer'}</span>
        <span>{fmtClock(totalSec)}</span>
      </div>
    </div>
  );
}

export type TrendPoint = { label: string; value: number | null };

/** One measure over the match log, oldest to newest. One axis, one series. */
export function TrendChart({
  title,
  points,
  format,
  zeroBased = false,
}: {
  title: string;
  points: TrendPoint[];
  format: (v: number) => string;
  zeroBased?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, Hh = 150, L = 38, R = 12, T = 12, B = 22;
  const have = points.map((p, i) => ({ ...p, i })).filter((p): p is { label: string; value: number; i: number } => p.value !== null);
  const latest = have.at(-1);

  let body;
  if (have.length === 0) {
    body = <p className="chart-empty">Nothing logged yet.</p>;
  } else {
    const vals = have.map((p) => p.value);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (zeroBased) lo = 0;
    if (hi - lo < 1e-9) { hi += 1; if (!zeroBased) lo -= 1; }
    const padV = (hi - lo) * 0.12;
    hi += padV;
    if (!zeroBased) lo -= padV;
    const n = points.length;
    const xOf = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R));
    const yOf = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (Hh - T - B);
    const path = have.map((p, k) => `${k ? 'L' : 'M'}${xOf(p.i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
    const hp = hover === null ? null : have.reduce((best, p) => (Math.abs(p.i - hover) < Math.abs(best.i - hover) ? p : best));
    const ticks = [lo, (lo + hi) / 2, hi];
    body = (
      <div className="trend-plot">
        <svg
          viewBox={`0 0 ${W} ${Hh}`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            setHover(n === 1 ? 0 : Math.round(((x - L) / (W - L - R)) * (n - 1)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t, k) => (
            <g key={k}>
              <line className="grid" x1={L} x2={W - R} y1={yOf(t)} y2={yOf(t)} />
              <text className="tick" x={L - 6} y={yOf(t) + 3.5} textAnchor="end">{format(t)}</text>
            </g>
          ))}
          <text className="tick" x={L} y={Hh - 5} textAnchor="start">{points[0].label}</text>
          {n > 1 && <text className="tick" x={W - R} y={Hh - 5} textAnchor="end">{points[n - 1].label}</text>}
          {hp && <line className="crosshair" x1={xOf(hp.i)} x2={xOf(hp.i)} y1={T} y2={Hh - B} />}
          <path className="trend-line" d={path} />
          {have.map((p) => (
            <circle key={p.i} className="trend-dot" cx={xOf(p.i)} cy={yOf(p.value)} r={hp?.i === p.i ? 5.5 : 4} />
          ))}
        </svg>
        {hp && (
          <div className="tooltip" style={{ left: `${(xOf(hp.i) / W) * 100}%`, top: `${(yOf(hp.value) / Hh) * 100}%` }}>
            {hp.label}: {format(hp.value)}
          </div>
        )}
      </div>
    );
  }
  return (
    <figure className="card trend">
      <figcaption>
        <span>{title}</span>
        {latest && <strong>{format(latest.value)}</strong>}
      </figcaption>
      {body}
    </figure>
  );
}
