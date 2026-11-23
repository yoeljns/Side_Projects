import { useState } from 'react';
import type { Match, TournamentResult } from '../engine';
import { colorOf, fmt } from './colors';

export function Leaderboard({ result, unit }: { result: TournamentResult; unit: string }) {
  const max = Math.max(1e-9, ...result.leaderboard.map((s) => s.total));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Leaderboard</h2>
        <span className="muted small">total {unit}</span>
      </div>
      <ol className="board" data-testid="leaderboard">
        {result.leaderboard.map((s, rank) => (
          <li key={s.id}>
            <span className="rank">{rank + 1}</span>
            <div className="board-main">
              <div className="board-line">
                <span className="name">
                  <i className="chip" style={{ background: colorOf(s.index) }} />
                  {s.name}
                </span>
                <span className="num strong">{fmt(s.total)}</span>
              </div>
              <div className="bar">
                <span style={{ width: `${(Math.max(0, s.total) / max) * 100}%`, background: colorOf(s.index) }} />
              </div>
              <div className="board-line muted small">
                <span>
                  {s.wins}W · {s.draws}D · {s.losses}L
                </span>
                <span className="num">{s.perRound.toFixed(2)} per round</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Heatmap({ result, selected, onSelect }: { result: TournamentResult; selected: Match | undefined; onSelect: (m: Match) => void }) {
  const vals = result.matrix.flat().filter((x): x is number => x !== null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const find = (i: number, j: number) => result.matches.find((m) => (m.i === i && m.j === j) || (m.i === j && m.j === i));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Head to head</h2>
        <span className="muted small">row's average payoff per round against column</span>
      </div>
      <div className="heat-wrap">
        <table className="heat" data-testid="heatmap">
          <thead>
            <tr>
              <th />
              {result.players.map((p, j) => (
                <th key={p.id} title={p.name}>
                  <i className="chip" style={{ background: colorOf(j) }} />
                  {j + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.players.map((p, i) => (
              <tr key={p.id}>
                <th scope="row">
                  <span className="muted">{i + 1}</span> {p.name}
                </th>
                {result.matrix[i].map((v, j) => {
                  const m = find(i, j);
                  if (v === null || !m) return <td key={j} className="empty" />;
                  const k = hi > lo ? (v - lo) / (hi - lo) : 0.5;
                  const on = selected === m;
                  return (
                    <td key={j}>
                      <button
                        className={`cell${on ? ' on' : ''}${k > 0.55 ? ' deep' : ''}`}
                        style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(8 + k * 84)}%, var(--surface))` }}
                        onClick={() => onSelect(m)}
                        title={`${p.name} vs ${result.players[j].name}: ${v.toFixed(2)} per round`}
                      >
                        {Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Click a cell to open that match below.</p>
    </section>
  );
}

function ScoreChart({ match, colors }: { match: Match; colors: [string, string] }) {
  const w = 600;
  const h = 150;
  const cum = (side: 'a' | 'b') => {
    let s = 0;
    return [0, ...match.rounds.map((r) => (s += r[side].payoff))];
  };
  const a = cum('a');
  const b = cum('b');
  const lo = Math.min(0, ...a, ...b);
  const hi = Math.max(1e-9, ...a, ...b);
  const path = (ys: number[]) =>
    ys.map((y, x) => `${x ? 'L' : 'M'}${((x / (ys.length - 1 || 1)) * w).toFixed(1)},${(h - 4 - ((y - lo) / (hi - lo)) * (h - 8)).toFixed(1)}`).join('');
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Cumulative score by round">
      <path d={path(a)} stroke={colors[0]} />
      <path d={path(b)} stroke={colors[1]} strokeDasharray={match.i === match.j ? '6 5' : undefined} />
    </svg>
  );
}

export function MatchDetail({ result, match }: { result: TournamentResult; match: Match }) {
  const [focus, setFocus] = useState<number | null>(null);
  const a = result.players[match.i];
  const b = result.players[match.j];
  const colors: [string, string] = [colorOf(match.i), colorOf(match.j)];
  const r = focus !== null ? match.rounds[focus] : undefined;
  return (
    <section className="card" data-testid="match">
      <div className="card-head">
        <h2>Match</h2>
        <span className="muted small">{match.rounds.length} rounds</span>
      </div>
      <div className="versus">
        <div>
          <span className="name">
            <i className="chip" style={{ background: colors[0] }} />
            {a.name}
          </span>
          <span className="num big">{fmt(match.scoreI)}</span>
        </div>
        <span className="muted">vs</span>
        <div className="right">
          <span className="name">
            {b.name}
            <i className="chip" style={{ background: colors[1] }} />
          </span>
          <span className="num big">{fmt(match.scoreJ)}</span>
        </div>
      </div>
      <ScoreChart match={match} colors={colors} />
      <div className="strip" onMouseLeave={() => setFocus(null)}>
        {match.rounds.map((round, idx) => (
          <button key={idx} className={`pair${focus === idx ? ' on' : ''}`} onMouseEnter={() => setFocus(idx)} onFocus={() => setFocus(idx)} onClick={() => setFocus(idx)} aria-label={`Round ${idx + 1}`}>
            <span className={`mv ${round.a.tone}`}>{round.a.label}</span>
            <span className={`mv ${round.b.tone}`}>{round.b.label}</span>
          </button>
        ))}
      </div>
      <p className="readout small">
        {r && focus !== null ? (
          <>
            <b>Round {focus + 1}.</b> {a.name} {r.a.label} ({fmt(r.a.payoff)}) · {b.name} {r.b.label} ({fmt(r.b.payoff)})
            {r.note ? ` · ${r.note}` : ''}
          </>
        ) : (
          <span className="muted">Top row is {a.name}, bottom row is {b.name}. Hover or tap a round for details.</span>
        )}
      </p>
    </section>
  );
}
