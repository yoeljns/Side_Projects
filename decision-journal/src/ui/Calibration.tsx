import { useMemo } from 'react';
import { formatDate } from '../lib/dates';
import { statusOf, STAKES, type Doc } from '../lib/model';
import {
  breakdown,
  BRIER_FIFTY,
  brierWords,
  calibrationBins,
  gapWords,
  LOG_FIFTY,
  MIN_READABLE,
  multiSummary,
  qualityMatrix,
  rollingBrier,
  scoredForecasts,
  summarise,
  type Bin,
  type Group,
  type RollingPoint,
} from '../lib/scoring';
import { pct, points, score, signed } from './format';

const ROLLING_WINDOW = 10;

function ReliabilityDiagram({ bins }: { bins: Bin[] }) {
  const S = 300; // plot side
  const L = 62;
  const T = 12;
  const x = (p: number) => L + p * S;
  const y = (p: number) => T + (1 - p) * S;
  const filled = bins.filter((b) => b.n > 0);
  const maxN = Math.max(1, ...filled.map((b) => b.n));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg className="chart" viewBox={`0 0 ${L + S + 22} ${T + S + 44}`} role="img" aria-label="Reliability diagram: how often things happened against the probability you gave them. The table below has the same numbers.">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} className="grid-line" />
          <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} className="grid-line" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis-text">
            {pct(t)}
          </text>
          <text x={x(t)} y={T + S + 16} textAnchor="middle" className="axis-text">
            {pct(t)}
          </text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="diagonal" />
      <text x={x(0.5)} y={T + S + 36} textAnchor="middle" className="axis-text">
        What you said
      </text>
      <text transform={`translate(11 ${y(0.5)}) rotate(-90)`} textAnchor="middle" className="axis-text">
        How often it happened
      </text>
      {filled.map((b) => (
        <line key={`ci${b.index}`} x1={x(b.meanP!)} x2={x(b.meanP!)} y1={y(b.ci!.lo)} y2={y(b.ci!.hi)} className="ci" />
      ))}
      {filled.map((b) => {
        const r = 4 + 6 * Math.sqrt(b.n / maxN);
        return (
          <g key={b.index}>
            <circle cx={x(b.meanP!)} cy={y(b.rate!)} r={r} className="dot">
              <title>
                {`Said ${pct(b.lo)} to ${pct(b.hi)} (average ${pct(b.meanP!)}): ${b.hits} of ${b.n} happened (${pct(b.rate!)}). 95% range ${pct(b.ci!.lo)} to ${pct(b.ci!.hi)}.`}
              </title>
            </circle>
            <text x={x(b.meanP!) + r + 3} y={y(b.rate!) + 4} className="point-label">
              {b.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function RollingChart({ points: pts }: { points: RollingPoint[] }) {
  const W = 440;
  const H = 230;
  const L = 34;
  const R = 14;
  const T = 12;
  const B = 30;
  const top = Math.max(0.5, Math.ceil(Math.max(...pts.map((p) => p.rolling)) * 10) / 10);
  const x = (i: number) => (pts.length === 1 ? (L + W - R) / 2 : L + (i / (pts.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const ticks = Array.from({ length: Math.round(top * 10) / 1 + 1 }, (_, i) => i / 10).filter((t) => Math.round(t * 10) % (top > 0.6 ? 2 : 1) === 0);
  const last = pts[pts.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Rolling Brier score over the last ${ROLLING_WINDOW} resolved decisions, in order of resolution. Latest value ${score(last.rolling)}.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid-line" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis-text">
            {t.toFixed(1)}
          </text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(BRIER_FIFTY)} y2={y(BRIER_FIFTY)} className="diagonal" />
      {pts.length > 1 && <polyline points={pts.map((p, i) => `${x(i)},${y(p.rolling)}`).join(' ')} className="series-line" />}
      {pts.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(i)} cy={y(p.rolling)} r={p.n < ROLLING_WINDOW ? 2.5 : 3.5} className={p.n < ROLLING_WINDOW ? 'dot partial' : 'dot'} />
          <circle cx={x(i)} cy={y(p.rolling)} r={12} className="hit">
            <title>{`${formatDate(p.resolvedOn)}: average of the last ${p.n} is ${score(p.rolling)} (this call ${score(p.brier)}, all so far ${score(p.cumulative)})`}</title>
          </circle>
        </g>
      ))}
      <text x={L} y={H - 8} className="axis-text">
        {formatDate(pts[0].resolvedOn)}
      </text>
      {pts.length > 1 && (
        <text x={W - R} y={H - 8} textAnchor="end" className="axis-text">
          {formatDate(last.resolvedOn)}
        </text>
      )}
    </svg>
  );
}

function GroupTable({ title, groups, label }: { title: string; groups: Group[]; label: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{label}</th>
              <th className="num">Scored</th>
              <th className="num">Brier</th>
              <th className="num wide-only">Said</th>
              <th className="num wide-only">Happened</th>
              <th className="num">Gap</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className={g.n < MIN_READABLE ? 'few' : ''}>
                <td>{g.key}</td>
                <td className="num">{g.n}</td>
                <td className="num">{score(g.brier)}</td>
                <td className="num wide-only">{pct(g.meanP)}</td>
                <td className="num wide-only">{pct(g.baseRate)}</td>
                <td className="num nowrap">{points(g.gap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Gap is average confidence minus how often you were right: plus means overconfident.
        {groups.some((g) => g.n < MIN_READABLE) && ` Greyed rows have fewer than ${MIN_READABLE} scored decisions: too few to read.`}
      </p>
    </section>
  );
}

export function Calibration({ doc }: { doc: Doc }) {
  const fs = useMemo(() => scoredForecasts(doc.decisions), [doc.decisions]);
  const s = useMemo(() => summarise(fs), [fs]);
  const bins = useMemo(() => calibrationBins(fs), [fs]);
  const rolling = useMemo(() => rollingBrier(fs, ROLLING_WINDOW), [fs]);
  const multi = useMemo(() => multiSummary(doc.decisions), [doc.decisions]);
  const quality = useMemo(() => qualityMatrix(doc.decisions), [doc.decisions]);
  const voids = doc.decisions.filter((d) => statusOf(d) === 'void').length;
  const open = doc.decisions.filter((d) => statusOf(d) === 'open').length;

  if (!s) {
    return (
      <section className="card">
        <h2>Calibration</h2>
        <p className="empty">
          Nothing to score yet. Calibration appears once a decision has been reviewed with a result.
          {open > 0 ? ` ${open} ${open === 1 ? 'decision is' : 'decisions are'} open.` : ' Log a call on the Today tab to start.'}
        </p>
      </section>
    );
  }

  const byStakes = breakdown(fs, (f) => f.stakes).sort((a, b) => STAKES.indexOf(b.key as (typeof STAKES)[number]) - STAKES.indexOf(a.key as (typeof STAKES)[number]));
  const rated = quality.goodWorked + quality.goodFailed + quality.badWorked + quality.badFailed;
  const m = s.murphy;

  return (
    <>
      {!s.readable && (
        <p className="notice" role="note">
          <b>Too few to read.</b> {s.n} scored {s.n === 1 ? 'decision' : 'decisions'} so far. The numbers below are real but mostly noise until there are at least {MIN_READABLE}.
        </p>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Score</h2>
          <span className="muted small num">
            {s.n} scored · {open} open · {voids} void
          </span>
        </div>
        <div className="stats">
          <div className="stat">
            <b>{score(s.brier)}</b>
            <span>Brier score</span>
            <small>0 is perfect, 0.25 is always saying 50%, 1 is certain and wrong every time.</small>
          </div>
          <div className="stat">
            <b>{s.logScore.toFixed(3)}</b>
            <span>Log score</span>
            <small>0 is perfect, {LOG_FIFTY.toFixed(3)} is always saying 50%. Punishes confident misses hardest.</small>
          </div>
          <div className="stat">
            <b>{points(s.overconfidence.gap)}</b>
            <span>{gapWords(s.overconfidence.gap)}</span>
            <small>
              Average confidence {pct(s.overconfidence.confidence)}, right {pct(s.overconfidence.hitRate)} of the time.
            </small>
          </div>
          <div className="stat">
            <b>{signed(s.skillVsFifty)}</b>
            <span>Skill against always 50%</span>
            <small>Above 0 beats it, 1 is perfect, below 0 is worse.</small>
          </div>
          <div className="stat">
            <b>{s.skillVsBaseRate === null ? 'n/a' : signed(s.skillVsBaseRate)}</b>
            <span>Skill against the base rate</span>
            <small>
              {s.skillVsBaseRate === null
                ? 'Every outcome so far was the same, so there is nothing to beat.'
                : `Against saying ${pct(s.baseRate)} every time, which is how often things happened (Brier ${score(s.brierBaseRate)}).`}
            </small>
          </div>
        </div>
        <p>{brierWords(s.brier)}</p>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Reliability</h2>
            <span className="muted small">Dot size and number: decisions in the bin</span>
          </div>
          <ReliabilityDiagram bins={bins} />
          <p className="muted small">On the dashed line, things happened as often as you said. The vertical bars are 95% Wilson ranges: where a bar crosses the line, that bin is consistent with being calibrated.</p>
        </section>

        <section className="card">
          <h2>By probability bin</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Said</th>
                  <th className="num">Count</th>
                  <th className="num wide-only">Avg said</th>
                  <th className="num">Happened</th>
                  <th className="num">95% range</th>
                </tr>
              </thead>
              <tbody>
                {bins
                  .filter((b) => b.n > 0)
                  .map((b) => (
                    <tr key={b.index}>
                      <td className="num nowrap">
                        {pct(b.lo)} to {pct(b.hi)}
                      </td>
                      <td className="num">{b.n}</td>
                      <td className="num wide-only">{pct(b.meanP!)}</td>
                      <td className="num">
                        {pct(b.rate!)} <span className="muted">({b.hits})</span>
                      </td>
                      <td className="num nowrap">
                        {pct(b.ci!.lo)} to {pct(b.ci!.hi)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <h3>Where the score comes from</h3>
          <div className="stats three">
            <div className="stat">
              <b>{score(m.reliability)}</b>
              <span>Reliability</span>
              <small>Gap between said and happened. Lower is better.</small>
            </div>
            <div className="stat">
              <b>{score(m.resolution)}</b>
              <span>Resolution</span>
              <small>How well your numbers sort cases apart. Higher is better.</small>
            </div>
            <div className="stat">
              <b>{score(m.uncertainty)}</b>
              <span>Uncertainty</span>
              <small>How unpredictable the outcomes were. Not up to you.</small>
            </div>
          </div>
          <p className="muted small num">
            Brier {score(s.brier)} = reliability {score(m.reliability)} − resolution {score(m.resolution)} + uncertainty {score(m.uncertainty)}
            {Math.abs(m.withinBin) >= 0.0005 ? ` ${m.withinBin < 0 ? '−' : '+'} ${score(Math.abs(m.withinBin))} from different forecasts sharing a bin` : ''}.
          </p>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Score over time</h2>
            <span className="muted small">Average Brier of the last {ROLLING_WINDOW} resolved. Lower is better; the dashed line is always saying 50%.</span>
          </div>
          <RollingChart points={rolling} />
          {rolling.length < ROLLING_WINDOW && (
            <p className="muted small">
              Fewer than {ROLLING_WINDOW} resolved so far, so each point averages everything up to it.
            </p>
          )}
        </section>
        <GroupTable title="By category" label="Category" groups={breakdown(fs, (f) => f.category)} />
      </div>

      <div className="grid-2">
        <GroupTable title="By stakes" label="Stakes" groups={byStakes} />
        {multi && (
          <section className="card">
            <div className="card-head">
              <h2>Scenario decisions</h2>
              <span className="muted small num">{multi.n} scored</span>
            </div>
            <div className="stats">
              <div className="stat">
                <b>{score(multi.brier)}</b>
                <span>Multi-outcome Brier</span>
                <small>0 to 2. An even split across the scenarios would score {score(multi.brierUniform)}.</small>
              </div>
              <div className="stat">
                <b>{multi.logScore.toFixed(3)}</b>
                <span>Log score</span>
                <small>Of the probability given to the scenario that happened.</small>
              </div>
            </div>
            <p className="muted small">These also count in the numbers above as a yes/no call on the top scenario.{multi.n < MIN_READABLE ? ` Fewer than ${MIN_READABLE}: too few to read.` : ''}</p>
          </section>
        )}
        {rated > 0 && (
          <section className="card">
            <div className="card-head">
              <h2>Call against result</h2>
              <span className="muted small num">{rated} rated</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th className="num">Worked out</th>
                    <th className="num">Did not</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Good call</td>
                    <td className="num">{quality.goodWorked}</td>
                    <td className="num">
                      {quality.goodFailed} <span className="muted small">bad luck</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Bad call</td>
                    <td className="num">
                      {quality.badWorked} <span className="muted small">got away with it</span>
                    </td>
                    <td className="num">{quality.badFailed}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted small">Your own hindsight verdict on the decision, set when reviewing. "Worked out" means the stated outcome happened.</p>
          </section>
        )}
      </div>
    </>
  );
}
