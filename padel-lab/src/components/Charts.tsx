import { useState } from 'react';
import { ZONES, ZONE_LABEL, type Zone } from '../lib/court';
import { pct } from '../lib/format';
import { RALLY_BUCKETS } from '../lib/hits';

/** Stacked share of time per zone, one row per player. */
export function ZoneBars({ rows }: { rows: { label: string; zonePct: Record<Zone, number>; empty: boolean }[] }) {
  const [tip, setTip] = useState<{ row: number; zone: Zone; x: number } | null>(null);
  return (
    <div className="zonebars">
      <div className="legend">
        {ZONES.map((z) => (
          <span key={z}>
            <i className={`sw zone-${z}`} />
            {ZONE_LABEL[z]}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div className="zonebar-row" key={i}>
          <span className="zonebar-label">{r.label}</span>
          <div className="zonebar" onPointerLeave={() => setTip(null)}>
            {r.empty ? (
              <span className="zonebar-empty">not tracked</span>
            ) : (
              ZONES.map((z) =>
                r.zonePct[z] > 0.004 ? (
                  <div
                    key={z}
                    className={`seg zone-${z}`}
                    style={{ flexGrow: r.zonePct[z] }}
                    onPointerMove={(e) => {
                      const host = e.currentTarget.parentElement!.getBoundingClientRect();
                      setTip({ row: i, zone: z, x: e.clientX - host.left });
                    }}
                  />
                ) : null,
              )
            )}
            {tip && tip.row === i && (
              <div className="tooltip" style={{ left: tip.x, top: 0 }}>
                {ZONE_LABEL[tip.zone]}: {pct(r.zonePct[tip.zone])}
              </div>
            )}
          </div>
          <span className="zonebar-value">{r.empty ? '–' : pct(r.zonePct.net)}</span>
        </div>
      ))}
      <p className="chart-note">The number on the right is the share of time at the net.</p>
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
