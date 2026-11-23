import { AUCTION_STRATEGIES, type AuctionParams } from './auction';
import { BARGAIN_STRATEGIES, type BargainParams } from './bargain';
import { GAME_PRESETS, type GameParams, type GamePreset, type MemoryOneSpec, gameStrategies } from './games';
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
  /** Pairwise arenas only: each strategy also meets a copy of itself. */
  selfPlay: boolean;
  games: GameParams;
  /** Repeated games only: user-built memory-one strategies (ids m1, m2, ...). */
  custom: MemoryOneSpec[];
  /** Repeated games only: close the video with the evolution segment. */
  evolution: boolean;
  auction: AuctionParams;
  bargain: BargainParams;
}

export const MAX_ROUNDS = 200;
export const MAX_CUSTOM = 4;

export function strategiesFor(arena: Arena, custom: MemoryOneSpec[] = []): StrategyInfo[] {
  return arena === 'games' ? gameStrategies(custom) : arena === 'auction' ? AUCTION_STRATEGIES : BARGAIN_STRATEGIES;
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
    custom: [],
    evolution: false,
    auction: { format: 'first' },
    bargain: { mode: 'ultimatum', delta: 0.9, maxStages: 6 },
  };
}

/** Move to another arena, keeping the seed and each arena's own parameters. */
export function switchArena(cfg: RunConfig, arena: Arena): RunConfig {
  const d = defaultConfig(arena);
  const custom = arena === 'games' ? cfg.custom.map((c) => c.id) : [];
  return { ...cfg, arena, strategies: [...d.strategies, ...custom], rounds: d.rounds, selfPlay: d.selfPlay };
}

const prob = (x: number): number => Math.round(clamp(Number.isFinite(x) ? x : 0, 0, 1) * 10000) / 10000;

/** Make a memory-one spec safe to store and to put in a URL. */
export function cleanMemoryOne(spec: MemoryOneSpec): MemoryOneSpec {
  const name = spec.name.replace(/[~|]/g, ' ').slice(0, 24);
  return { id: spec.id, name: name.trim() ? name : 'Custom', first: spec.first === 'D' ? 'D' : 'C', p: [prob(spec.p[0]), prob(spec.p[1]), prob(spec.p[2]), prob(spec.p[3])] };
}

/** Compact query string, so any run can be shared and replayed exactly. */
export function encodeConfig(cfg: RunConfig): string {
  const q = new URLSearchParams();
  q.set('a', cfg.arena);
  q.set('s', cfg.strategies.join('.'));
  q.set('seed', cfg.seed);
  q.set('r', String(cfg.rounds));
  if (cfg.arena === 'games') {
    const { R, S, T, P } = cfg.games.payoffs;
    q.set('sp', cfg.selfPlay ? '1' : '0');
    q.set('g', cfg.games.preset);
    q.set('p', [R, S, T, P].join('_'));
    q.set('n', String(cfg.games.noise));
    if (cfg.custom.length) q.set('c', cfg.custom.map((c) => [c.id, c.name, c.first, ...c.p].join('~')).join('|'));
    if (cfg.evolution) q.set('ev', '1');
  } else if (cfg.arena === 'auction') {
    q.set('f', cfg.auction.format);
  } else {
    q.set('sp', cfg.selfPlay ? '1' : '0');
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

function decodeCustom(raw: string | null): MemoryOneSpec[] {
  const out: MemoryOneSpec[] = [];
  for (const part of (raw ?? '').split('|')) {
    const f = part.split('~');
    if (f.length !== 7 || !/^m[1-9]$/.test(f[0]) || out.some((c) => c.id === f[0]) || out.length >= MAX_CUSTOM) continue;
    out.push(cleanMemoryOne({ id: f[0], name: f[1], first: f[2] as 'C' | 'D', p: [Number(f[3]), Number(f[4]), Number(f[5]), Number(f[6])] }));
  }
  return out;
}

/** Tolerant inverse of encodeConfig: anything missing or malformed falls back to defaults. */
export function decodeConfig(query: string): RunConfig {
  const q = new URLSearchParams(query);
  const a = q.get('a') as Arena;
  const cfg = defaultConfig(ARENAS.includes(a) ? a : 'games');
  if (cfg.arena === 'games') cfg.custom = decodeCustom(q.get('c'));
  const known = new Set(strategiesFor(cfg.arena, cfg.custom).map((s) => s.id));
  const picks = [...new Set((q.get('s') ?? '').split('.').filter((id) => known.has(id)))];
  if (picks.length >= 2) cfg.strategies = picks;
  cfg.seed = (q.get('seed') ?? cfg.seed).slice(0, 40) || cfg.seed;
  cfg.rounds = Math.round(num(q.get('r'), cfg.rounds, 1, MAX_ROUNDS));
  if (q.has('sp') && cfg.arena !== 'auction') cfg.selfPlay = q.get('sp') === '1';
  cfg.evolution = cfg.arena === 'games' && q.get('ev') === '1';
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
    return { title: cfg.auction.format === 'first' ? 'First-Price Auction' : 'Second-Price Auction', subtitle: `${n} bidders in one room · ${cfg.rounds} auctions`, unit: 'surplus' };
  }
  return cfg.bargain.mode === 'ultimatum'
    ? { title: 'Ultimatum Game', subtitle: tail, unit: 'share won' }
    : { title: 'Alternating Offers', subtitle: `${tail} · pie shrinks ${Math.round((1 - cfg.bargain.delta) * 100)}% per rejection`, unit: 'share won' };
}
