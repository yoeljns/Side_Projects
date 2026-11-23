import { describe, expect, it } from 'vitest';
import {
  ARENAS,
  AUCTION_STRATEGIES,
  BARGAIN_STRATEGIES,
  GAME_PRESETS,
  GAME_STRATEGIES,
  PIE,
  decodeConfig,
  defaultConfig,
  encodeConfig,
  makeRng,
  playAuctionMatch,
  playBargainMatch,
  playGameMatch,
  runTournament,
  schedule,
  speProposerShare,
  strategiesFor,
  sum,
  type GameParams,
} from './index';

const game = (id: string) => GAME_STRATEGIES.find((s) => s.id === id)!;
const bidder = (id: string) => AUCTION_STRATEGIES.find((s) => s.id === id)!;
const bargainer = (id: string) => BARGAIN_STRATEGIES.find((s) => s.id === id)!;
const pd: GameParams = { preset: 'pd', payoffs: GAME_PRESETS.pd.payoffs, noise: 0 };

describe('rng', () => {
  it('is reproducible and seed-sensitive', () => {
    const draw = (seed: string) => Array.from({ length: 5 }, makeRng(seed));
    expect(draw('x')).toEqual(draw('x'));
    expect(draw('x')).not.toEqual(draw('y'));
    for (const v of draw('x')) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThan(1);
  });
});

describe('repeated games', () => {
  const run = (a: string, b: string, rounds = 10) => playGameMatch(game(a), game(b), pd, rounds, makeRng('t'));

  it('Tit for Tat loses only the first round to Always Defect', () => {
    const m = run('tft', 'alld');
    expect([m.scoreA, m.scoreB]).toEqual([9, 14]);
    expect(m.rounds.map((r) => r.a.label).join('')).toBe('CDDDDDDDDD');
  });
  it('scores the classic pairings correctly', () => {
    expect(run('allc', 'alld')).toMatchObject({ scoreA: 0, scoreB: 50 });
    expect(run('tft', 'tft')).toMatchObject({ scoreA: 30, scoreB: 30 });
    expect(run('pavlov', 'alld')).toMatchObject({ scoreA: 5, scoreB: 30 }); // Pavlov alternates C, D
    expect(run('grim', 'alt')).toMatchObject({ scoreA: 3 + 0 + 4 * (5 + 1), scoreB: 3 + 5 + 4 * (0 + 1) });
    expect(run('tft', 'stft')).toMatchObject({ scoreA: 25, scoreB: 25 }); // endless echo of the opening defection
    expect(run('tf2t', 'alt')).toMatchObject({ scoreA: 15, scoreB: 40 }); // never sees two defections in a row
  });
  it('noise flips moves but accounting still adds up', () => {
    const m = playGameMatch(game('allc'), game('allc'), { ...pd, noise: 0.3 }, 200, makeRng('n'));
    expect(m.rounds.some((r) => r.a.label === 'D')).toBe(true);
    expect(sum(m.rounds.map((r) => r.a.payoff))).toBe(m.scoreA);
    expect(sum(m.rounds.map((r) => r.b.payoff))).toBe(m.scoreB);
  });
});

describe('auctions', () => {
  it('truthful bidding is weakly dominant in a second-price auction', () => {
    for (const opp of ['shade20', 'random', 'overbid', 'truthful', 'lowball']) {
      for (const seed of ['s1', 's2', 's3']) {
        const score = (me: string) => playAuctionMatch(bidder(me), bidder(opp), { format: 'second' }, 100, makeRng(seed)).scoreA;
        const honest = score('truthful');
        for (const other of AUCTION_STRATEGIES) expect(honest).toBeGreaterThanOrEqual(score(other.id) - 1e-9);
      }
    }
  });
  it('truthful bidding earns nothing in a first-price auction', () => {
    const m = playAuctionMatch(bidder('truthful'), bidder('equilibrium'), { format: 'first' }, 100, makeRng('f'));
    expect(m.scoreA).toBe(0);
    expect(m.scoreB).toBeGreaterThan(0);
  });
  it('only the winner is paid, and scores equal summed surplus', () => {
    const m = playAuctionMatch(bidder('adaptive'), bidder('random'), { format: 'first' }, 80, makeRng('w'));
    for (const r of m.rounds) expect(r.a.payoff === 0 || r.b.payoff === 0).toBe(true);
    expect(sum(m.rounds.map((r) => r.a.payoff))).toBeCloseTo(m.scoreA, 9);
    expect(sum(m.rounds.map((r) => r.b.payoff))).toBeCloseTo(m.scoreB, 9);
  });
});

describe('bargaining', () => {
  it('ultimatum: fair splitters share the pie every round', () => {
    const m = playBargainMatch(bargainer('fair'), bargainer('fair'), { mode: 'ultimatum', delta: 0.9, maxStages: 6 }, 10, makeRng('b'));
    expect(m).toMatchObject({ scoreA: 500, scoreB: 500 });
  });
  it('ultimatum: tough responders walk away from each other with nothing', () => {
    const m = playBargainMatch(bargainer('tough'), bargainer('tough'), { mode: 'ultimatum', delta: 0.9, maxStages: 6 }, 10, makeRng('b'));
    expect(m).toMatchObject({ scoreA: 0, scoreB: 0 });
  });
  it('never hands out more than the pie', () => {
    for (const mode of ['ultimatum', 'rubinstein'] as const) {
      for (const a of BARGAIN_STRATEGIES) {
        for (const b of BARGAIN_STRATEGIES) {
          const m = playBargainMatch(a, b, { mode, delta: 0.8, maxStages: 5 }, 30, makeRng('p', a.id, b.id));
          for (const r of m.rounds) {
            expect(r.a.payoff).toBeGreaterThanOrEqual(0);
            expect(r.b.payoff).toBeGreaterThanOrEqual(0);
            expect(r.a.payoff + r.b.payoff).toBeLessThanOrEqual(PIE + 1e-9);
          }
          expect(sum(m.rounds.map((r) => r.a.payoff))).toBeCloseTo(m.scoreA, 9);
        }
      }
    }
  });
  it('alternating offers: equilibrium players agree at once on the backward-induction split', () => {
    const delta = 0.9;
    const k = 6;
    const m = playBargainMatch(bargainer('spe'), bargainer('spe'), { mode: 'rubinstein', delta, maxStages: k }, 2, makeRng('r'));
    const v = speProposerShare(k, delta);
    expect(speProposerShare(1, delta)).toBe(1);
    expect(speProposerShare(2, delta)).toBeCloseTo(1 - delta, 12);
    expect(m.rounds[0].a.payoff).toBeCloseTo(PIE * v, 9); // A opens round 1
    expect(m.rounds[0].b.payoff).toBeCloseTo(PIE * (1 - v), 9);
    expect(m.rounds[1].b.payoff).toBeCloseTo(PIE * v, 9); // B opens round 2
  });
});

describe('tournament', () => {
  it('same seed and config gives an identical run in every arena', () => {
    for (const arena of ARENAS) {
      const cfg = { ...defaultConfig(arena), seed: 'repeat' };
      cfg.games.noise = 0.05;
      expect(runTournament(cfg)).toEqual(runTournament(structuredClone(cfg)));
    }
  });
  it('a different seed changes the outcome', () => {
    const cfg = defaultConfig('auction');
    const a = runTournament({ ...cfg, seed: 'one' }).leaderboard.map((s) => s.total);
    const b = runTournament({ ...cfg, seed: 'two' }).leaderboard.map((s) => s.total);
    expect(a).not.toEqual(b);
  });
  it('plays a full round-robin and totals match the matches', () => {
    for (const arena of ARENAS) {
      for (const selfPlay of [false, true]) {
        const cfg = { ...defaultConfig(arena), selfPlay };
        const res = runTournament(cfg);
        const n = res.players.length;
        expect(n).toBe(strategiesFor(arena).filter((s) => cfg.strategies.includes(s.id)).length);
        expect(res.matches.length).toBe((n * (n - 1)) / 2 + (selfPlay ? n : 0));
        for (const s of res.leaderboard) {
          const total = sum(
            res.matches.map((m) =>
              m.i === s.index && m.j === s.index ? (m.scoreI + m.scoreJ) / 2 : m.i === s.index ? m.scoreI : m.j === s.index ? m.scoreJ : 0,
            ),
          );
          expect(s.total).toBeCloseTo(total, 6);
          const row = res.matrix[s.index].filter((x): x is number => x !== null);
          expect(sum(row) * cfg.rounds).toBeCloseTo(s.total, 6);
          expect(s.wins + s.draws + s.losses).toBe(n - 1);
        }
        const totals = res.leaderboard.map((s) => s.total);
        expect(totals).toEqual([...totals].sort((x, y) => y - x));
      }
    }
  });
  it('schedules every pairing exactly once', () => {
    for (const n of [2, 3, 6, 7, 12]) {
      const pairs = schedule(n, true).map(([i, j]) => `${i}-${j}`);
      expect(new Set(pairs).size).toBe(pairs.length);
      expect(pairs.length).toBe((n * (n + 1)) / 2);
      for (const p of pairs) expect(Number(p.split('-')[0])).toBeLessThanOrEqual(Number(p.split('-')[1]));
    }
  });
  it('removing a strategy leaves the other pairings untouched', () => {
    const cfg = { ...defaultConfig('games'), strategies: ['tft', 'random', 'joss', 'gtft'] };
    const full = runTournament(cfg);
    const fewer = runTournament({ ...cfg, strategies: ['random', 'joss', 'gtft'] });
    const pick = (r: typeof full, a: string, b: string) => r.matches.find((m) => r.players[m.i].id === a && r.players[m.j].id === b)!.rounds;
    expect(pick(fewer, 'random', 'joss')).toEqual(pick(full, 'random', 'joss'));
  });
  it('Always Defect beats a field of unconditional cooperators', () => {
    const res = runTournament({ ...defaultConfig('games'), strategies: ['allc', 'alld', 'tft'], selfPlay: false, rounds: 20 });
    expect(res.leaderboard[0].id).toBe('alld');
  });
});

describe('config in the URL', () => {
  it('round-trips every arena', () => {
    for (const arena of ARENAS) {
      const cfg = defaultConfig(arena);
      cfg.seed = 'hello world';
      cfg.rounds = 77;
      cfg.selfPlay = !cfg.selfPlay;
      cfg.strategies = cfg.strategies.slice(1, 4);
      if (arena === 'games') cfg.games = { preset: 'chicken', payoffs: { R: 3, S: 1.5, T: 6, P: -1 }, noise: 0.07 };
      if (arena === 'auction') cfg.auction.format = 'second';
      if (arena === 'bargain') cfg.bargain = { mode: 'rubinstein', delta: 0.75, maxStages: 4 };
      expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
    }
  });
  it('falls back to defaults on junk', () => {
    expect(decodeConfig('a=nope&s=zzz&r=abc&n=9')).toEqual({ ...defaultConfig('games'), games: { ...defaultConfig().games, noise: 0.5 } });
    expect(decodeConfig('')).toEqual(defaultConfig('games'));
  });
});
