import { useState } from 'react';
import { cycleLengths, lags, markerTypeLabel, markerTypes, overlap, sampleNote, whereNow, type NowRow, type Stats } from '../lib/analysis';
import { KIND_LABEL, type Track } from '../lib/types';
import { colorVar } from './marks';

const f1 = (n: number): string => n.toFixed(1);
const signed = (n: number): string => `${n > 0 ? '+' : ''}${Number.isInteger(n) ? n : f1(n)}`;

function StatLine({ s, unit = 'years' }: { s: Stats; unit?: string }) {
  return (
    <p className="small num">
      Mean <b>{f1(s.mean)}</b> {unit}, range {s.min} to {s.max}
      {s.sd !== null && <>, spread (sd) {f1(s.sd)}</>}. <span className="warn strong">{sampleNote(s.n)}.</span>
    </p>
  );
}

/** Lags on one axis: a dot per pair, a tick at the mean, zero marked. */
function LagStrip({ values, mean }: { values: number[]; mean: number }) {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const padv = Math.max((hi - lo) * 0.08, 1);
  const W = 340;
  const x = (v: number) => 14 + ((v - (lo - padv)) / (hi - lo + 2 * padv)) * (W - 28);
  return (
    <svg viewBox={`0 0 ${W} 46`} width="100%" role="img" aria-label={`Lags from ${lo} to ${hi} years, mean ${f1(mean)}`} style={{ maxWidth: W, display: 'block' }} fontSize={10.5}>
      <line x1={10} x2={W - 10} y1={22} y2={22} stroke="var(--border)" />
      <line x1={x(0)} x2={x(0)} y1={10} y2={30} stroke="var(--muted)" />
      <text x={x(0)} y={42} textAnchor="middle" fill="var(--muted)">0</text>
      {lo < 0 && <text x={x(lo)} y={42} textAnchor="middle" fill="var(--muted)">{lo}</text>}
      {hi > 0 && <text x={x(hi)} y={42} textAnchor="middle" fill="var(--muted)">+{hi}</text>}
      <path d={`M${x(mean)},8 v28`} stroke="var(--text)" strokeWidth={2} />
      {values.map((v, i) => (
        <circle key={i} cx={x(v)} cy={22} r={4.5} fill="var(--s0)" stroke="var(--surface)" strokeWidth={2}>
          <title>{signed(v)} years</title>
        </circle>
      ))}
    </svg>
  );
}

/** Years into the current phase against the lengths of earlier phases of the same kind. */
function NowBar({ row, color }: { row: NowRow; color: string }) {
  const h = row.history;
  const max = Math.max(row.yearsIn, h?.max ?? 0, 1) * 1.1;
  const W = 340;
  const x = (v: number) => 4 + (v / max) * (W - 8);
  return (
    <svg viewBox={`0 0 ${W} 22`} width="100%" role="img" aria-label={`${row.yearsIn} years in${h ? `; earlier phases ran ${h.min} to ${h.max} years` : ''}`} style={{ maxWidth: W, display: 'block' }}>
      <rect x={4} y={9} width={W - 8} height={4} rx={2} fill="var(--surface-2)" />
      {h && <rect x={x(h.min)} y={6} width={Math.max(x(h.max) - x(h.min), 3)} height={10} rx={3} fill="var(--neutral)" fillOpacity={0.55} />}
      {h && <rect x={x(h.mean) - 1} y={3} width={2} height={16} fill="var(--muted)" />}
      <circle cx={x(row.yearsIn)} cy={11} r={5.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

export function ComparePanel({ tracks, nowYear }: { tracks: Track[]; nowYear: number }) {
  const usable = tracks.filter((t) => t.phases.length + t.events.length > 0);
  const [aId, setA] = useState('ref-kondratiev');
  const [bId, setB] = useState('ref-commodities');
  const a = usable.find((t) => t.id === aId) ?? usable[0];
  const b = usable.find((t) => t.id === bId) ?? usable[1] ?? usable[0];
  const [typeA, setTypeA] = useState('');
  const [typeB, setTypeB] = useState('');
  const [windowText, setWindowText] = useState('');
  if (!a || !b) return <section className="card"><p className="empty">Show at least one track to compare.</p></section>;

  const typesA = markerTypes(a);
  const typesB = markerTypes(b);
  const tA = typesA.some((t) => t.type === typeA) ? typeA : (typesA[0]?.type ?? '');
  const tB = typesB.some((t) => t.type === typeB) ? typeB : (typesB[0]?.type ?? '');
  const maxLag = Number(windowText) > 0 ? Number(windowText) : Infinity;
  const ov = overlap(a, b, nowYear);
  const lg = tA && tB ? lags(a, tA, b, tB, maxLag) : null;
  const picker = (label: string, value: string, set: (v: string) => void) => (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)}>
        {usable.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.author})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <section className="card">
        <h2>Compare two tracks</h2>
        <div className="row">
          {picker('First track (A)', a.id, setA)}
          {picker('Second track (B)', b.id, setB)}
        </div>
        <p className="note-small">Everything below is counted from the dates on the timeline, and those dates are the authors' judgements. With four or five cycles per track, treat every number as a description, not a test.</p>
      </section>

      <section className="card">
        <h2>Phase overlap</h2>
        {a.id === b.id ? (
          <p className="empty">Pick two different tracks.</p>
        ) : ov.common === 0 ? (
          <p className="empty">These two tracks never have a phase running at the same time.</p>
        ) : (
          <>
            <div className="stats">
              <div className="stat">
                <b>{ov.common}</b>
                <span>years both have a phase</span>
              </div>
              <div className="stat">
                <b>{ov.sameKind}</b>
                <span>years in the same kind of phase ({Math.round((ov.sameKind / ov.common) * 100)}%)</span>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>A is in</th>
                    <th>B is in</th>
                    <th className="num">Years</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.cells.map((c) => (
                    <tr key={`${c.kindA}-${c.kindB}`}>
                      <td>{KIND_LABEL[c.kindA]}</td>
                      <td>{KIND_LABEL[c.kindB]}</td>
                      <td className="num">{c.years}</td>
                      <td className="small num muted">{c.intervals.map((i) => `${i.start}-${i.end}`).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note-small">Open phases are counted up to {nowYear}. Where a track has two phases running at once, the year counts under both, so rows can add up to more than the years in common.</p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Lags</h2>
        {a.id === b.id || !tA || !tB ? (
          <p className="empty">Pick two different tracks that each have dated items.</p>
        ) : (
          <>
            <div className="row">
              <label className="field">
                <span>From each of these in A</span>
                <select value={tA} onChange={(e) => setTypeA(e.target.value)}>
                  {typesA.map((t) => (
                    <option key={t.type} value={t.type}>
                      {markerTypeLabel(t.type)} ({t.count})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>To the nearest of these in B</span>
                <select value={tB} onChange={(e) => setTypeB(e.target.value)}>
                  {typesB.map((t) => (
                    <option key={t.type} value={t.type}>
                      {markerTypeLabel(t.type)} ({t.count})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field" style={{ maxWidth: 220 }}>
              <span>Ignore matches further apart than (years)</span>
              <input type="number" min={1} className="num" value={windowText} onChange={(e) => setWindowText(e.target.value)} placeholder="no limit" />
            </label>
            {lg && lg.stats ? (
              <>
                <LagStrip values={lg.pairs.map((p) => p.lag)} mean={lg.stats.mean} />
                <StatLine s={lg.stats} />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>A</th>
                        <th>Nearest in B</th>
                        <th className="num">Lag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lg.pairs.map((p) => (
                        <tr key={p.from.itemId}>
                          <td className="small"><span className="num">{p.from.year}</span> {p.from.label}</td>
                          <td className="small"><span className="num">{p.to.year}</span> {p.to.label}</td>
                          <td className="num">{signed(p.lag)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="note-small">
                  Positive: A comes first. Each A item is matched to the nearest B item, so the lag is small by construction.
                  {lg.reused > 0 && ` ${lg.reused} B ${lg.reused === 1 ? 'item was' : 'items were'} the nearest match more than once.`}
                  {lg.unmatched.length > 0 && ` ${lg.unmatched.length} A ${lg.unmatched.length === 1 ? 'item has' : 'items have'} no match within the limit.`}
                </p>
              </>
            ) : (
              <p className="empty">No pairs to measure{Number.isFinite(maxLag) ? ' within that limit' : ''}.</p>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Cycle lengths</h2>
        {[a, ...(b.id === a.id ? [] : [b])].map((t) => {
          const cl = cycleLengths(t);
          return (
            <div key={t.id} className="stack" style={{ gap: 4 }}>
              <h3>{t.name}</h3>
              {cl.length === 0 ? (
                <p className="note-small">Nothing on this track repeats, so there is no length to measure.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Between consecutive</th>
                        <th className="num">Mean</th>
                        <th className="num">Range</th>
                        <th>Gaps (years)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cl.map((c) => (
                        <tr key={c.type}>
                          <td className="small">{markerTypeLabel(c.type).toLowerCase()}</td>
                          <td className="num">{f1(c.stats.mean)}</td>
                          <td className="num">{c.stats.min}-{c.stats.max}</td>
                          <td className="small num muted">
                            {c.gaps.join(', ')} <span className="warn">(n = {c.stats.n})</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        <p className="note-small">Peak events give peak to peak; phase starts give start to start. Every row here rests on a handful of gaps: far too few to generalise.</p>
      </section>

      <section className="card">
        <h2>Where are we now ({nowYear})</h2>
        <div className="stack">
          {tracks.flatMap((t) =>
            whereNow(t, nowYear).rows.map((r) => (
              <div key={`${t.id}-${r.phase.id}`} className="item">
                <div className="meta">
                  <span className="swatch" style={{ background: colorVar(t.color) }} />
                  <span className="strong" style={{ color: 'var(--text)' }}>{t.name}</span>
                  <span>{t.author}</span>
                </div>
                <div className="small">
                  {r.phase.name} ({KIND_LABEL[r.phase.kind].toLowerCase()}): <b className="num">{r.yearsIn}</b> years in, since {r.phase.approximate ? 'c. ' : ''}
                  {r.phase.start}.
                </div>
                <NowBar row={r} color={colorVar(t.color)} />
                <div className="note-small num">
                  {r.history ? (
                    <>
                      Earlier {KIND_LABEL[r.phase.kind].toLowerCase()} phases on this track ran {r.history.min} to {r.history.max} years, mean {f1(r.history.mean)}: this one is{' '}
                      {r.against === 'longer' ? 'already longer than all of them' : r.against === 'shorter' ? 'still shorter than all of them' : 'inside that range'}. <span className="warn strong">{sampleNote(r.history.n)}.</span>
                    </>
                  ) : (
                    'No earlier phase of this kind on this track to compare with.'
                  )}
                </div>
              </div>
            )),
          )}
        </div>
        <p className="note-small">Dot: years into the current phase. Grey bar: range of earlier phases of the same kind. Tick: their mean. Tracks with no open phase are left out.</p>
      </section>
    </>
  );
}
