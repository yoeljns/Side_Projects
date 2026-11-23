import { useState } from 'react';
import { type Match, type TournamentResult, theoreticalRevenue } from '../engine';
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
                <span>{result.auction ? `won ${s.wins} of ${result.config.rounds} auctions` : `${s.wins}W · ${s.draws}D · ${s.losses}L`}</span>
                <span className="num">
                  {s.perRound.toFixed(2)} per {result.auction ? 'auction' : 'round'}
                </span>
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

/** Auction room: who won how often and how they bid, plus what the seller made under each format. */
export function AuctionPanel({ result }: { result: TournamentResult }) {
  const auction = result.auction!;
  const mine = result.config.auction.format;
  const room = auction[mine];
  const n = result.players.length;
  const rounds = room.rounds.length;
  const w = 600;
  const h = 130;
  const running = (f: 'first' | 'second') => {
    let s = 0;
    return auction[f].rounds.map((r, i) => (s += r.price) / (i + 1));
  };
  const lines = { first: running('first'), second: running('second') };
  const hi = Math.max(1, ...lines.first, ...lines.second, theoreticalRevenue(n)) * 1.08;
  const y = (v: number) => (h - 4 - (v / hi) * (h - 8)).toFixed(1);
  const path = (ys: number[]) => ys.map((v, x) => `${x ? 'L' : 'M'}${((x / (ys.length - 1 || 1)) * w).toFixed(1)},${y(v)}`).join('');
  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Bidders</h2>
          <span className="muted small">one room, {rounds} auctions</span>
        </div>
        <div className="heat-wrap">
          <table className="stats" data-testid="bidders">
            <thead>
              <tr>
                <th>Bidder</th>
                <th>Wins</th>
                <th>Win rate</th>
                <th>Surplus per auction</th>
                <th>Surplus per win</th>
                <th>Bid / value</th>
              </tr>
            </thead>
            <tbody>
              {result.leaderboard.map((s) => {
                const st = room.stats[s.index];
                return (
                  <tr key={s.id}>
                    <th scope="row">
                      <span className="name">
                        <i className="chip" style={{ background: colorOf(s.index) }} />
                        {s.name}
                      </span>
                    </th>
                    <td>{st.wins}</td>
                    <td>{rounds ? Math.round((st.wins / rounds) * 100) : 0}%</td>
                    <td>{(st.surplus / Math.max(1, rounds)).toFixed(2)}</td>
                    <td>{st.wins ? (st.surplus / st.wins).toFixed(1) : '–'}</td>
                    <td>{Math.round(st.bidRatio * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" data-testid="revenue">
        <div className="card-head">
          <h2>Seller revenue</h2>
          <span className="muted small">same seed, same bidders, same values</span>
        </div>
        <div className="duo">
          {(['first', 'second'] as const).map((f) => (
            <div key={f} className={`tile${f === mine ? ' on' : ''}`}>
              <span className="muted small">
                <i className={`swatch ${f}`} />
                {f === 'first' ? 'First-price' : 'Second-price'}
                {f === mine ? ' · this run' : ''}
              </span>
              <span className="num big">{auction[f].avgRevenue.toFixed(1)}</span>
              <span className="muted small">average price per auction</span>
            </div>
          ))}
        </div>
        <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Running average price by auction, both formats">
          <line x1="0" x2={w} y1={y(theoreticalRevenue(n))} y2={y(theoreticalRevenue(n))} className="guide" />
          <path d={path(lines.first)} className="first" />
          <path d={path(lines.second)} className="second" />
        </svg>
        <p className="muted small">
          Running average price over the {rounds} auctions. Dashed line: {theoreticalRevenue(n).toFixed(1)}, the expected revenue of either format when all {n} bidders play the
          equilibrium (revenue equivalence). Bidders who stray from equilibrium pull the two apart.
        </p>
      </section>
    </>
  );
}

/** Auction room drill-down: every bidder's value and bid in one auction. */
export function AuctionRounds({ result }: { result: TournamentResult }) {
  const room = result.auction![result.config.auction.format];
  const [pick, setPick] = useState(0);
  const idx = Math.min(pick, room.rounds.length - 1);
  const r = room.rounds[idx];
  const scale = Math.max(100, ...r.bids);
  return (
    <section className="card" data-testid="auction-round">
      <div className="card-head">
        <h2>Auction {idx + 1}</h2>
        <span className="muted small">
          {result.players[r.winner].name} wins, pays {r.price.toFixed(1)}, surplus {r.surplus.toFixed(1)}
        </span>
      </div>
      <input type="range" min={0} max={room.rounds.length - 1} step={1} value={idx} aria-label="Auction number" onChange={(e) => setPick(Number(e.target.value))} />
      <div className="strip">
        {room.rounds.map((round, i) => (
          <button key={i} className={`pick${i === idx ? ' on' : ''}`} style={{ background: colorOf(round.winner) }} title={`Auction ${i + 1}: ${result.players[round.winner].name} pays ${round.price.toFixed(1)}`} aria-label={`Auction ${i + 1}`} onClick={() => setPick(i)} />
        ))}
      </div>
      <div className="heat-wrap">
        <table className="stats">
          <thead>
            <tr>
              <th>Bidder</th>
              <th>Value</th>
              <th>Bid</th>
              <th className="wide-col">Bid against value</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {result.players.map((p, i) => (
              <tr key={p.id} className={i === r.winner ? 'won' : ''}>
                <th scope="row">
                  <span className="name">
                    <i className="chip" style={{ background: colorOf(i) }} />
                    {p.name}
                  </span>
                </th>
                <td>{r.values[i].toFixed(1)}</td>
                <td>{r.bids[i].toFixed(1)}</td>
                <td className="wide-col">
                  <div className="bidbar">
                    <span style={{ width: `${(r.bids[i] / scale) * 100}%`, background: colorOf(i) }} />
                    <i style={{ left: `${(r.values[i] / scale) * 100}%` }} />
                  </div>
                </td>
                <td>{i === r.winner ? `wins, ${r.surplus >= 0 ? '+' : ''}${r.surplus.toFixed(1)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">The strip shows who won each auction; click one to open it. In the bar, the fill is the bid and the tick is the bidder's private value.</p>
    </section>
  );
}

/** Repeated games: population shares under replicator dynamics. */
export function EvolutionCard({ result, inVideo, onInVideo }: { result: TournamentResult; inVideo: boolean; onInVideo: (v: boolean) => void }) {
  const evo = result.evolution!;
  const gens = evo.length - 1;
  const last = evo[gens];
  const w = 600;
  const h = 200;
  const top = Math.min(1, Math.ceil(Math.max(...evo.flat()) * 10) / 10);
  const order = result.players.map((_, p) => p).sort((a, b) => last[b] - last[a] || a - b);
  return (
    <section className="card" data-testid="evolution">
      <div className="card-head">
        <h2>Evolution</h2>
        <span className="muted small">population share over {gens} generations</span>
      </div>
      <div className="evo-chart">
        <span className="axis top">{Math.round(top * 100)}%</span>
        <span className="axis bottom">0%</span>
        <svg className="chart tall" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Population share by generation">
          {result.players.map((p, i) => (
            <path key={p.id} stroke={colorOf(i)} d={evo.map((g, x) => `${x ? 'L' : 'M'}${((x / gens) * w).toFixed(1)},${(h - 3 - (g[i] / top) * (h - 6)).toFixed(1)}`).join('')} />
          ))}
        </svg>
      </div>
      <ul className="legend">
        {order.map((p) => (
          <li key={p} className={last[p] < 0.005 ? 'gone' : ''}>
            <span className="name">
              <i className="chip" style={{ background: colorOf(p) }} />
              {result.players[p].name}
            </span>
            <span className="num">{last[p] < 0.0005 ? 'extinct' : `${(last[p] * 100).toFixed(1)}%`}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        An ecological tournament in the style of Axelrod's second analysis. Everyone starts with an equal share; each generation a strategy grows in proportion to its average payoff
        against the current mix, using the head-to-head payoffs above (including each strategy against itself).
      </p>
      <label className="check">
        <input type="checkbox" checked={inVideo} data-testid="evo-toggle" onChange={(e) => onInVideo(e.target.checked)} />
        <span>Close the video with this evolution segment</span>
      </label>
    </section>
  );
}
