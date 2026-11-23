import { counterpartUtility, feasibleOutcomes, playerUtility, type Scenario, type Score, type Turn } from '../engine/index.js';

const W = 360;
const H = 300;
const M = { l: 40, r: 12, t: 12, b: 34 };

/** Both sides' utilities for every package the counterpart could sign, with the benchmarks marked. */
export function UtilityPlot({ sc, score, log }: { sc: Scenario; score: Score; log: Turn[] }) {
  const x = (p: number) => M.l + ((W - M.l - M.r) * p) / 100;
  const y = (c: number) => H - M.b - ((H - M.t - M.b) * c) / 100;
  const all = feasibleOutcomes(sc);
  const step = Math.max(1, Math.ceil(all.length / 700));
  const cloud = all.filter((_, k) => k % step === 0);
  const { bench } = score;
  const d = bench.disagreement;
  const frontier = bench.frontier.map((o) => `${x(o.p).toFixed(1)},${y(o.c).toFixed(1)}`).join(' ');
  const path = (by: Turn['by']) =>
    log
      .filter((t) => t.by === by && t.action === 'offer' && t.offer)
      .map((t) => ({ p: playerUtility(sc, t.offer!), c: counterpartUtility(sc, t.offer!) }));
  const mine = path('player');
  const theirs = path('counterpart');
  const line = (pts: { p: number; c: number }[]) => pts.map((o) => `${x(o.p).toFixed(1)},${y(o.c).toFixed(1)}`).join(' ');
  const ticks = [0, 25, 50, 75, 100];
  return (
    <figure className="plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Utility space: your value against theirs for every possible deal">
        {d.p <= 100 && d.c <= 100 && (
          <rect x={x(d.p)} y={y(100)} width={x(100) - x(d.p)} height={Math.max(0, y(d.c) - y(100))} fill="var(--good)" opacity="0.08" />
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(100)} stroke="var(--border)" />
            <line x1={x(0)} x2={x(100)} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={x(t)} y={H - M.b + 14} textAnchor="middle" className="tick">{t}</text>
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
          </g>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" className="tick">Worth to you (points)</text>
        <text transform={`translate(11 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" className="tick">Worth to them</text>
        {cloud.map((o, k) => (
          <circle key={k} cx={x(o.p)} cy={y(o.c)} r="1.3" fill="var(--neutral)" opacity="0.45" />
        ))}
        <polyline points={frontier} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        <line x1={x(d.p)} x2={x(d.p)} y1={y(0)} y2={y(100)} stroke="var(--text)" strokeDasharray="4 3" />
        <line x1={x(0)} x2={x(100)} y1={y(Math.min(100, d.c))} y2={y(Math.min(100, d.c))} stroke="var(--text)" strokeDasharray="4 3" />
        <circle cx={x(d.p)} cy={y(Math.min(100, d.c))} r="4" fill="var(--text)" />
        {mine.length > 0 && <polyline points={line(mine)} fill="none" stroke="var(--london)" strokeWidth="1" opacity="0.7" />}
        {theirs.length > 0 && <polyline points={line(theirs)} fill="none" stroke="var(--istanbul)" strokeWidth="1" opacity="0.7" />}
        {mine.map((o, k) => (
          <circle key={`m${k}`} cx={x(o.p)} cy={y(o.c)} r="3" fill="var(--surface)" stroke="var(--london)" strokeWidth="1.5" />
        ))}
        {theirs.map((o, k) => (
          <rect key={`t${k}`} x={x(o.p) - 2.5} y={y(o.c) - 2.5} width="5" height="5" fill="var(--surface)" stroke="var(--istanbul)" strokeWidth="1.5" />
        ))}
        {bench.ks && <rect x={x(bench.ks.p) - 5} y={y(bench.ks.c) - 5} width="10" height="10" fill="none" stroke="var(--warn)" strokeWidth="2" />}
        {bench.nash && (
          <path d={`M${x(bench.nash.p)},${y(bench.nash.c) - 7} l7,7 l-7,7 l-7,-7 z`} fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
        )}
        {score.deal && (
          <circle cx={x(score.deal.p)} cy={y(score.deal.c)} r="6" fill={score.surplus >= 0 ? 'var(--good)' : 'var(--bad)'} stroke="var(--surface)" strokeWidth="2" />
        )}
      </svg>
      <figcaption className="legend small">
        <span><i className="dot" style={{ background: 'var(--neutral)' }} /> possible deals</span>
        <span><i className="bar" style={{ background: 'var(--accent)' }} /> Pareto frontier</span>
        <span><i className="dot" style={{ background: 'var(--text)' }} /> both alternatives (dashed lines)</span>
        {bench.nash && <span><i className="diamond" style={{ background: 'var(--accent)' }} /> Nash</span>}
        {bench.ks && <span><i className="box" style={{ borderColor: 'var(--warn)' }} /> Kalai-Smorodinsky</span>}
        {score.deal && <span><i className="dot" style={{ background: score.surplus >= 0 ? 'var(--good)' : 'var(--bad)' }} /> the deal</span>}
        {mine.length > 0 && <span><i className="ring" style={{ borderColor: 'var(--london)' }} /> your offers</span>}
        {theirs.length > 0 && <span><i className="box" style={{ borderColor: 'var(--istanbul)' }} /> their offers</span>}
      </figcaption>
    </figure>
  );
}
