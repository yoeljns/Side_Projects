import { useEffect, useMemo, useState } from 'react';
import {
  ARENAS,
  ARENA_NAMES,
  GAME_PRESETS,
  MAX_ROUNDS,
  decodeConfig,
  describeConfig,
  encodeConfig,
  runTournament,
  strategiesFor,
  switchArena,
  type GamePreset,
  type Payoffs,
  type RunConfig,
} from '../engine';
import { Player } from './Player';
import { Heatmap, Leaderboard, MatchDetail } from './Results';

const WORDS = ['amber', 'basil', 'cedar', 'delta', 'ember', 'fjord', 'grove', 'harbor', 'indigo', 'juniper', 'kestrel', 'lumen', 'mango', 'nimbus', 'onyx', 'pepper', 'quartz', 'raven', 'sable', 'tundra'];
const randomSeed = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(Math.random() * 900 + 100)}`;

function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </label>
  );
}

export function App() {
  const [cfg, setCfg] = useState<RunConfig>(() => decodeConfig(window.location.search));
  const [pick, setPick] = useState<[string, string] | null>(null);
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<RunConfig>) => setCfg((c) => ({ ...c, ...patch }));

  const result = useMemo(() => runTournament(cfg), [cfg]);
  const desc = describeConfig(cfg);
  const all = strategiesFor(cfg.arena);

  useEffect(() => {
    window.history.replaceState(null, '', `?${encodeConfig(cfg)}`);
  }, [cfg]);

  // Default drill-down: the two leaders. A manual pick sticks while both strategies stay in the run.
  const match = useMemo(() => {
    const byIds = (x: string, y: string) =>
      result.matches.find((m) => {
        const [i, j] = [result.players[m.i].id, result.players[m.j].id];
        return (i === x && j === y) || (i === y && j === x);
      });
    return (pick && byIds(pick[0], pick[1])) ?? byIds(result.leaderboard[0].id, result.leaderboard[1].id) ?? result.matches[0];
  }, [result, pick]);

  const toggle = (id: string) => {
    const has = cfg.strategies.includes(id);
    if (has && cfg.strategies.length <= 2) return;
    const next = new Set(has ? cfg.strategies.filter((s) => s !== id) : [...cfg.strategies, id]);
    set({ strategies: all.map((s) => s.id).filter((s) => next.has(s)) });
  };
  const setPayoff = (k: keyof Payoffs, v: number) => set({ games: { ...cfg.games, payoffs: { ...cfg.games.payoffs, [k]: v } } });
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this link', window.location.href);
    }
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Strategy Arena</h1>
          <p className="muted">Strategies meet in a round-robin. Every run is reproducible from its seed, and plays back as a vertical short.</p>
        </div>
        <button className="btn" onClick={share}>
          {copied ? 'Link copied' : 'Copy link to this run'}
        </button>
      </header>

      <nav className="tabs" aria-label="Arena">
        {ARENAS.map((a) => (
          <button key={a} className={a === cfg.arena ? 'on' : ''} data-testid={`arena-${a}`} onClick={() => a !== cfg.arena && (setPick(null), setCfg((c) => switchArena(c, a)))}>
            {ARENA_NAMES[a]}
          </button>
        ))}
      </nav>

      <main className="layout">
        <aside className="card config">
          <div className="card-head">
            <h2>Setup</h2>
          </div>

          {cfg.arena === 'games' && (
            <>
              <label className="field">
                <span>Game</span>
                <select
                  value={cfg.games.preset}
                  onChange={(e) => {
                    const preset = e.target.value as GamePreset;
                    set({ games: { ...cfg.games, preset, payoffs: { ...GAME_PRESETS[preset].payoffs } } });
                  }}
                >
                  {Object.entries(GAME_PRESETS).map(([id, g]) => (
                    <option key={id} value={id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">
                C = {GAME_PRESETS[cfg.games.preset].c}, D = {GAME_PRESETS[cfg.games.preset].d}. Payoffs to the row player:
              </p>
              <table className="payoffs">
                <thead>
                  <tr>
                    <th />
                    <th>they C</th>
                    <th>they D</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>I play C</th>
                    <td><input aria-label="Both cooperate (R)" type="number" value={cfg.games.payoffs.R} onChange={(e) => setPayoff('R', Number(e.target.value))} /></td>
                    <td><input aria-label="I cooperate, they defect (S)" type="number" value={cfg.games.payoffs.S} onChange={(e) => setPayoff('S', Number(e.target.value))} /></td>
                  </tr>
                  <tr>
                    <th>I play D</th>
                    <td><input aria-label="I defect, they cooperate (T)" type="number" value={cfg.games.payoffs.T} onChange={(e) => setPayoff('T', Number(e.target.value))} /></td>
                    <td><input aria-label="Both defect (P)" type="number" value={cfg.games.payoffs.P} onChange={(e) => setPayoff('P', Number(e.target.value))} /></td>
                  </tr>
                </tbody>
              </table>
              <label className="field">
                <span>Noise: {Math.round(cfg.games.noise * 100)}% of moves slip</span>
                <input type="range" min={0} max={0.25} step={0.01} value={cfg.games.noise} onChange={(e) => set({ games: { ...cfg.games, noise: Number(e.target.value) } })} />
              </label>
            </>
          )}

          {cfg.arena === 'auction' && (
            <>
              <label className="field">
                <span>Format</span>
                <select value={cfg.auction.format} onChange={(e) => set({ auction: { format: e.target.value as 'first' | 'second' } })}>
                  <option value="first">First-price sealed bid</option>
                  <option value="second">Second-price sealed bid (Vickrey)</option>
                </select>
              </label>
              <p className="muted small">Each round, both bidders draw a private value from 0 to 100 and bid in secret. The winner earns value minus price.</p>
            </>
          )}

          {cfg.arena === 'bargain' && (
            <>
              <label className="field">
                <span>Protocol</span>
                <select value={cfg.bargain.mode} onChange={(e) => set({ bargain: { ...cfg.bargain, mode: e.target.value as 'ultimatum' | 'rubinstein' } })}>
                  <option value="ultimatum">Ultimatum (one take-it-or-leave-it offer)</option>
                  <option value="rubinstein">Alternating offers (shrinking pie)</option>
                </select>
              </label>
              {cfg.bargain.mode === 'rubinstein' && (
                <>
                  <label className="field">
                    <span>Discount factor: {cfg.bargain.delta.toFixed(2)}</span>
                    <input type="range" min={0.5} max={0.99} step={0.01} value={cfg.bargain.delta} onChange={(e) => set({ bargain: { ...cfg.bargain, delta: Number(e.target.value) } })} />
                  </label>
                  <NumberField label="Offers before talks collapse" value={cfg.bargain.maxStages} min={1} max={12} onChange={(v) => set({ bargain: { ...cfg.bargain, maxStages: Math.round(v) } })} />
                </>
              )}
              <p className="muted small">Each round splits a pie of 100. The right to make the first offer alternates. No deal, no pie.</p>
            </>
          )}

          <div className="row">
            <NumberField label="Rounds per match" value={cfg.rounds} min={1} max={MAX_ROUNDS} onChange={(v) => set({ rounds: Math.round(v) })} />
            <label className="field">
              <span>Seed</span>
              <input type="text" value={cfg.seed} maxLength={40} spellCheck={false} data-testid="seed" onChange={(e) => set({ seed: e.target.value })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={cfg.selfPlay} onChange={(e) => set({ selfPlay: e.target.checked })} />
            <span>Each strategy also plays a copy of itself</span>
          </label>
          <button className="btn primary wide" data-testid="reroll" onClick={() => set({ seed: randomSeed() })}>
            Run with a new seed
          </button>

          <div className="card-head sub">
            <h3>Strategies</h3>
            <span className="muted small">
              {cfg.strategies.length} of {all.length}
            </span>
          </div>
          <ul className="strategies">
            {all.map((s) => (
              <li key={s.id}>
                <label className="check">
                  <input type="checkbox" checked={cfg.strategies.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span>
                    <b>{s.name}</b>
                    <small className="muted">{s.blurb}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </aside>

        <Player result={result} />

        <div className="results">
          <div className="headline">
            <h2>{desc.title}</h2>
            <p className="muted">
              {desc.subtitle} · {result.matches.length} matches · winner: <b>{result.leaderboard[0].name}</b>
            </p>
          </div>
          <Leaderboard result={result} unit={desc.unit} />
          <Heatmap result={result} selected={match} onSelect={(m) => setPick([result.players[m.i].id, result.players[m.j].id])} />
          {match && <MatchDetail result={result} match={match} />}
        </div>
      </main>
    </div>
  );
}
