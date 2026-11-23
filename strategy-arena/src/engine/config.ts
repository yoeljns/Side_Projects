import { AUCTION_STRATEGIES, type AuctionParams } from './auction';
import { BARGAIN_STRATEGIES, type BargainParams } from './bargain';
import { GAME_PRESETS, GAME_STRATEGIES, type GameParams, type GamePreset } from './games';
import { clamp, type StrategyInfo } from './types';

export type Arena = 'games' | 'auction' | 'bargain';
export const ARENAS: Arena[] = ['games', 'auction', 'bargain'];

export const ARENA_NAMES: Record<Arena, string> = {
  games: 'Repeated games',
  auction: 'Auctions',
  bargain: 'Bargaining',
};

export interface RunConfig {
  arena: Arena;
  /** Strategy ids taking part, in display order. */
  strategies: string[];
  seed: string;
  rounds: number;
  selfPlay: boolean;
  games: GameParams;
  auction: AuctionParams;
  bargain: BargainParams;
}

export const MAX_ROUNDS = 200;

export function strategiesFor(arena: Arena): StrategyInfo[] {
  return arena === 'games' ? GAME_STRATEGIES : arena === 'auction' ? AUCTION_STRATEGIES : BARGAIN_STRATEGIES;
}

const DEFAULT_PICKS: Record<Arena, string[]> = {
  games: ['tft', 'allc', 'alld', 'grim', 'pavlov', 'gtft', 'tf2t', 'random'],
  auction: AUCTION_STRATEGIES.map((s) => s.id),
  bargain: BARGAIN_STRATEGIES.map((s) => s.id),
};
const DEFAULT_ROUNDS: Record<Arena, number> = { games: 50, auction: 60, bargain: 40 };

export function defaultConfig(arena: Arena = 'games'): RunConfig {
  return {
    arena,
    strategies: [...DEFAULT_PICKS[arena]],
    seed: 'arena',
    rounds: DEFAULT_ROUNDS[arena],
    selfPlay: arena === 'games',
    games: { preset: 'pd', payoffs: { ...GAME_PRESETS.pd.payoffs }, noise: 0 },
    auction: { format: 'first' },
    bargain: { mode: 'ultimatum', delta: 0.9, maxStages: 6 },
  };
}

/** Move to another arena, keeping the seed and that arena's parameters. */
export function switchArena(cfg: RunConfig, arena: Arena): RunConfig {
  const d = defaultConfig(arena);
  return { ...cfg, arena, strategies: d.strategies, rounds: d.rounds, selfPlay: d.selfPlay };
}

/** Compact query string, so any run can be shared and replayed exactly. */
export function encodeConfig(cfg: RunConfig): string {
  const q = new URLSearchParams();
  q.set('a', cfg.arena);
  q.set('s', cfg.strategies.join('.'));
  q.set('seed', cfg.seed);
  q.set('r', String(cfg.rounds));
  q.set('sp', cfg.selfPlay ? '1' : '0');
  if (cfg.arena === 'games') {
    const { R, S, T, P } = cfg.games.payoffs;
    q.set('g', cfg.games.preset);
    q.set('p', [R, S, T, P].join('_'));
    q.set('n', String(cfg.games.noise));
  } else if (cfg.arena === 'auction') {
    q.set('f', cfg.auction.format);
  } else {
    q.set('m', cfg.bargain.mode);
    q.set('d', String(cfg.bargain.delta));
    q.set('k', String(cfg.bargain.maxStages));
  }
  return q.toString();
}

const num = (s: string | null, fallback: number, lo: number, hi: number): number => {
  const x = s === null || s === '' ? NaN : Number(s);
  return Number.isFinite(x) ? clamp(x, lo, hi) : fallback;
};

/** Tolerant inverse of encodeConfig: anything missing or malformed falls back to defaults. */
export function decodeConfig(query: string): RunConfig {
  const q = new URLSearchParams(query);
  const a = q.get('a') as Arena;
  const cfg = defaultConfig(ARENAS.includes(a) ? a : 'games');
  const known = new Set(strategiesFor(cfg.arena).map((s) => s.id));
  const picks = [...new Set((q.get('s') ?? '').split('.').filter((id) => known.has(id)))];
  if (picks.length >= 2) cfg.strategies = picks;
  cfg.seed = (q.get('seed') ?? cfg.seed).slice(0, 40) || cfg.seed;
  cfg.rounds = Math.round(num(q.get('r'), cfg.rounds, 1, MAX_ROUNDS));
  if (q.has('sp')) cfg.selfPlay = q.get('sp') === '1';
  const g = q.get('g') as GamePreset;
  if (g in GAME_PRESETS) cfg.games = { ...cfg.games, preset: g, payoffs: { ...GAME_PRESETS[g].payoffs } };
  const p = (q.get('p') ?? '').split('_').map(Number);
  if (p.length === 4 && p.every(Number.isFinite)) {
    const [R, S, T, P] = p.map((x) => clamp(x, -99, 99));
    cfg.games.payoffs = { R, S, T, P };
  }
  cfg.games.noise = num(q.get('n'), cfg.games.noise, 0, 0.5);
  if (q.get('f') === 'first' || q.get('f') === 'second') cfg.auction.format = q.get('f') as 'first' | 'second';
  if (q.get('m') === 'ultimatum' || q.get('m') === 'rubinstein') cfg.bargain.mode = q.get('m') as 'ultimatum' | 'rubinstein';
  cfg.bargain.delta = num(q.get('d'), cfg.bargain.delta, 0.1, 1);
  cfg.bargain.maxStages = Math.round(num(q.get('k'), cfg.bargain.maxStages, 1, 12));
  return cfg;
}

/** Human-readable headline for a run, used by the page and the video title card. */
export function describeConfig(cfg: RunConfig): { title: string; subtitle: string; unit: string } {
  const n = cfg.strategies.length;
  const tail = `${n} strategies · ${cfg.rounds} rounds each`;
  if (cfg.arena === 'games') {
    const noise = cfg.games.noise > 0 ? ` · ${Math.round(cfg.games.noise * 100)}% noise` : '';
    return { title: GAME_PRESETS[cfg.games.preset].name, subtitle: tail + noise, unit: 'points' };
  }
  if (cfg.arena === 'auction') {
    return { title: cfg.auction.format === 'first' ? 'First-Price Auction' : 'Second-Price Auction', subtitle: tail, unit: 'surplus' };
  }
  return cfg.bargain.mode === 'ultimatum'
    ? { title: 'Ultimatum Game', subtitle: tail, unit: 'share won' }
    : { title: 'Alternating Offers', subtitle: `${tail} · pie shrinks ${Math.round((1 - cfg.bargain.delta) * 100)}% per rejection`, unit: 'share won' };
}
