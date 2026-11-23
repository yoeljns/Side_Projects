import { useMemo, useState } from 'react'
import { blunderRate, type State } from '../lib/store.ts'

const WINDOW = 10 // games in the rolling average
const W = 520
const H = 170
const PAD = { l: 30, r: 10, t: 10, b: 22 }

const date = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** Blunders per 100 moves: the number this app tries to move, instead of rating. */
export function Progress({ state, day, onClose }: { state: State; day: string; onClose: () => void }) {
  const games = state.games
  const [hover, setHover] = useState<number | null>(null)

  const series = useMemo(
    () => games.map((g, i) => ({ at: g.playedAt, rate: blunderRate(games.slice(Math.max(0, i - WINDOW + 1), i + 1)) ?? 0, game: g })),
    [games],
  )
  const overall = blunderRate(games)
  const recent = blunderRate(games.slice(-WINDOW))
  const before = games.length >= WINDOW * 2 ? blunderRate(games.slice(-WINDOW * 2, -WINDOW)) : null
  const max = Math.max(4, ...series.map((p) => p.rate)) * 1.1
  const x = (i: number) => PAD.l + (series.length > 1 ? (i / (series.length - 1)) * (W - PAD.l - PAD.r) : (W - PAD.l - PAD.r) / 2)
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const ticks = [0, max / 2 / 1.1, max / 1.1].map((v) => Math.round(v * 10) / 10)

  const cards = state.cards
  const count = (f: (c: (typeof cards)[number]) => boolean) => cards.filter(f).length
  const sessions = [...state.history].reverse().slice(0, 8)

  return (
    <section className="step progress">
      <p className="eyebrow">Progress</p>
      <h2>Blunders per 100 moves</h2>
      {overall === null ? (
        <p className="context">Nothing analysed yet. The rate appears after the first games have been read.</p>
      ) : (
        <>
          <div className="hero">
            <span className="big">{(recent ?? overall).toFixed(1)}</span>
            <span className="delta">
              over your last {games.length === 1 ? 'game' : `${Math.min(WINDOW, games.length)} games`}
              {before !== null && recent !== null && (
                <> · {recent < before ? 'down' : recent > before ? 'up' : 'level'} from {before.toFixed(1)} in the {WINDOW} before</>
              )}
            </span>
          </div>
          <p className="context">
            A blunder is a move that gives away at least 20 points of winning chances from a position that was
            still playable. {overall.toFixed(1)} per 100 across all {games.length} analysed games.
          </p>
          {series.length > 1 && (
            <div className="chart" onMouseLeave={() => setHover(null)}>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                role="img"
                aria-label={`Rolling ${WINDOW}-game blunder rate, from ${series[0].rate.toFixed(1)} to ${series[series.length - 1].rate.toFixed(1)} per 100 moves`}
                onPointerMove={(e) => {
                  const box = e.currentTarget.getBoundingClientRect()
                  const px = ((e.clientX - box.left) / box.width) * W
                  setHover(Math.max(0, Math.min(series.length - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (series.length - 1)))))
                }}
              >
                {ticks.map((t) => (
                  <g key={t}>
                    <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
                    <text className="axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">{t}</text>
                  </g>
                ))}
                <text className="axis" x={PAD.l} y={H - 4}>{date(series[0].at)}</text>
                <text className="axis" x={W - PAD.r} y={H - 4} textAnchor="end">{date(series[series.length - 1].at)}</text>
                <polyline className="line" points={series.map((p, i) => `${x(i)},${y(p.rate)}`).join(' ')} />
                {hover !== null && (
                  <>
                    <line className="cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />
                    <circle className="dot" cx={x(hover)} cy={y(series[hover].rate)} r="4.5" />
                  </>
                )}
                {hover === null && <circle className="dot" cx={x(series.length - 1)} cy={y(series[series.length - 1].rate)} r="4.5" />}
              </svg>
              {hover !== null && (
                <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
                  {date(series[hover].at)} · {series[hover].rate.toFixed(1)} per 100 · this game {series[hover].game.blunders} in {series[hover].game.moves}
                </div>
              )}
            </div>
          )}
          <p className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>Rolling average over {WINDOW} games, oldest to newest.</p>
        </>
      )}

      <h3>Your blunder cards</h3>
      <div className="tiles">
        <div className="tile"><b>{count((c) => c.seen === 0)}</b><span>new</span></div>
        <div className="tile"><b>{count((c) => c.seen > 0 && c.box < 2)}</b><span>learning</span></div>
        <div className="tile"><b>{count((c) => c.box >= 2 && c.box < 4)}</b><span>known</span></div>
        <div className="tile"><b>{count((c) => c.box >= 4)}</b><span>mastered</span></div>
        <div className="tile"><b>{count((c) => c.due <= day)}</b><span>due now</span></div>
        <div className="tile"><b>{count((c) => c.kind === 'punish')}</b><span>punish cards</span></div>
      </div>

      <h3>Recent sessions</h3>
      {sessions.length === 0 ? (
        <p className="muted">No finished sessions yet.</p>
      ) : (
        <table>
          <thead><tr><th>Day</th><th className="n">Right first time</th><th className="n">Time</th></tr></thead>
          <tbody>
            {sessions.map((h) => (
              <tr key={`${h.day}/${h.round}`}>
                <td>{h.day}{h.round ? ` · round ${h.round + 1}` : ''}</td>
                <td className="n">{h.solved} of {h.total}</td>
                <td className="n">{Math.floor(h.seconds / 60)} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="actions"><button className="primary" onClick={onClose}>Back</button></div>
    </section>
  )
}
