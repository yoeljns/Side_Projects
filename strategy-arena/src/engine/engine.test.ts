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
  playAuctionRoom,
  MEMORY_ONE_PRESETS,
  memoryOneStrategy,
  replicator,
  theoreticalRevenue,
  cleanMemoryOne,
  EVOLUTION_GENERATIONS,
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
  const room = (ids: string[], format: 'first' | 'second', seed = 's', rounds = 100) => playAuctionRoom(ids.map(bidder), { format }, rounds, makeRng(seed));

  it('truthful bidding is weakly dominant in a second-price room', () => {
    const field = ['shade20', 'random', 'overbid', 'lowball']; // none of these react to outcomes
    for (const seed of ['s1', 's2', 's3']) {
      const score = (me: string) => room([me, ...field], 'second', seed).scores[0];
      const honest = score('truthful');
      for (const other of AUCTION_STRATEGIES) expect(honest).toBeGreaterThanOrEqual(score(other.id) - 1e-9);
    }
  });
  it('the equilibrium bidder shades to (n-1)/n of value for the actual room size', () => {
    for (const ids of [['equilibrium', 'truthful'], ['equilibrium', 'truthful', 'random', 'lowball'], AUCTION_STRATEGIES.map((s) => s.id)]) {
      const n = ids.length;
      const e = ids.indexOf('equilibrium');
      const first = room(ids, 'first');
      for (const r of first.rounds) expect(r.bids[e]).toBeCloseTo((r.values[e] * (n - 1)) / n, 9);
      expect(first.stats[e].bidRatio).toBeCloseTo((n - 1) / n, 9);
      for (const r of room(ids, 'second').rounds) expect(r.bids[e]).toBe(r.values[e]);
    }
  });
  it('accounts for every round: the highest bid wins and surplus plus price equals the winner\'s value', () => {
    const ids = AUCTION_STRATEGIES.map((s) => s.id);
    for (const format of ['first', 'second'] as const) {
      const res = room(ids, format, 'acct', 80);
      const scores = ids.map(() => 0);
      const wins = ids.map(() => 0);
      for (const r of res.rounds) {
        expect(r.bids[r.winner]).toBe(Math.max(...r.bids));
        expect(r.surplus + r.price).toBeCloseTo(r.values[r.winner], 9);
        const sorted = [...r.bids].sort((x, y) => y - x);
        expect(r.price).toBe(format === 'first' ? sorted[0] : sorted[1]);
        scores[r.winner] += r.surplus;
        wins[r.winner]++;
      }
      res.scores.forEach((sc, i) => expect(sc).toBeCloseTo(scores[i], 9));
      expect(res.stats.map((st) => st.wins)).toEqual(wins);
      expect(sum(wins)).toBe(80);
      expect(res.avgRevenue).toBeCloseTo(sum(res.rounds.map((r) => r.price)) / 80, 9);
    }
  });
  it('truthful bidding earns nothing in a first-price room', () => {
    const res = room(['truthful', 'equilibrium', 'lowball'], 'first');
    expect(res.scores[0]).toBe(0);
    expect(res.scores[1]).toBeGreaterThan(0);
  });
  it('both formats see the same values, and equilibrium play gives roughly equal revenue', () => {
    const ids = ['equilibrium', 'equilibrium', 'equilibrium', 'equilibrium'];
    const first = playAuctionRoom(ids.map(bidder), { format: 'first' }, 4000, makeRng('rev'));
    const second = playAuctionRoom(ids.map(bidder), { format: 'second' }, 4000, makeRng('rev'));
    expect(first.rounds.map((r) => r.values)).toEqual(second.rounds.map((r) => r.values));
    const theory = theoreticalRevenue(4); // 60
    expect(theory).toBe(60);
    expect(Math.abs(first.avgRevenue - theory)).toBeLessThan(1.5);
    expect(Math.abs(second.avgRevenue - theory)).toBeLessThan(1.5);
  });
  it('runs as one room in a tournament, with both formats for comparison', () => {
    const cfg = defaultConfig('auction');
    const res = runTournament(cfg);
    expect(res.matches).toEqual([]);
    expect(res.auction!.first.rounds.length).toBe(cfg.rounds);
    expect(res.auction!.first.rounds[0].bids.length).toBe(cfg.strategies.length);
    expect(res.auction!.first.rounds.map((r) => r.values)).toEqual(res.auction!.second.rounds.map((r) => r.values));
    for (const s of res.leaderboard) {
      expect(s.total).toBe(res.auction!.first.scores[s.index]);
      expect(s.wins).toBe(res.auction!.first.stats[s.index].wins);
    }
    const second = runTournament({ ...cfg, auction: { format: 'second' } });
    expect(second.leaderboard.find((s) => s.id === 'truthful')!.total).toBe(second.auction!.second.scores[0]);
  });
});

describe('memory-one strategies', () => {
  const preset = (name: string, id = 'm1') => {
    const p = MEMORY_ONE_PRESETS.find((x) => x.name === name)!;
    return memoryOneStrategy({ id, name: p.name, first: p.first, p: p.p });
  };
  it('vector presets reproduce their classic counterparts exactly without noise', () => {
    const pairs: [string, string][] = [['WSLS vector', 'pavlov'], ['TFT vector', 'tft'], ['Grim vector', 'grim']];
    for (const [vector, classic] of pairs) {
      for (const opp of GAME_STRATEGIES) {
        const a = playGameMatch(preset(vector), opp, pd, 60, makeRng('m', opp.id));
        const b = playGameMatch(game(classic), opp, pd, 60, makeRng('m', opp.id));
        expect(a.rounds).toEqual(b.rounds);
      }
    }
  });
  it('Extort-2 never does worse than its opponent and enforces a 2:1 surplus over mutual defection', () => {
    const exact = memoryOneStrategy({ id: 'm1', name: 'Extort-2', first: 'C', p: [8 / 9, 1 / 2, 1 / 3, 0] });
    for (const opp of ['allc', 'tft', 'pavlov', 'random', 'gtft']) {
      const rounds = 200000;
      const m = playGameMatch(exact, game(opp), pd, rounds, makeRng('zd', opp));
      const mine = m.scoreA / rounds - pd.payoffs.P;
      const theirs = m.scoreB / rounds - pd.payoffs.P;
      expect(mine).toBeGreaterThanOrEqual(theirs - 0.02);
      expect(Math.abs(mine - 2 * theirs)).toBeLessThan(0.05);
    }
  });
  it('joins a tournament like any other strategy', () => {
    const spec = cleanMemoryOne({ id: 'm1', name: 'My~Bot|', first: 'D', p: [2, -1, 0.123456, NaN] });
    expect(spec).toEqual({ id: 'm1', name: 'My Bot ', first: 'D', p: [1, 0, 0.1235, 0] });
    const cfg = { ...defaultConfig('games'), custom: [spec], strategies: ['tft', 'alld', 'm1'] };
    const res = runTournament(cfg);
    expect(res.players.map((p) => p.name)).toEqual(['Tit for Tat', 'Always Defect', 'My Bot ']);
    expect(res.matches.length).toBe(6);
    const again = runTournament(structuredClone(cfg));
    expect([res.matches, res.leaderboard, res.evolution]).toEqual([again.matches, again.leaderboard, again.evolution]);
  });
});

describe('evolution', () => {
  it('starts equal, keeps shares summing to one, and is deterministic', () => {
    const res = runTournament(defaultConfig('games'));
    const evo = res.evolution!;
    expect(evo.length).toBe(EVOLUTION_GENERATIONS + 1);
    expect(evo[0]).toEqual(res.players.map(() => 1 / res.players.length));
    for (const gen of evo) {
      expect(sum(gen)).toBeCloseTo(1, 9);
      for (const x of gen) expect(x).toBeGreaterThanOrEqual(0);
    }
    expect(runTournament(defaultConfig('games')).evolution).toEqual(evo);
  });
  it('follows the replicator rule', () => {
    // Hawk-dove style 2x2: one step by hand.
    const [g0, g1] = replicator([[1, 3], [2, 2]], 1);
    expect(g0).toEqual([0.5, 0.5]);
    expect(g1[0]).toBeCloseTo((0.5 * 2) / (0.5 * 2 + 0.5 * 2), 12);
    const dominated = replicator([[3, 3], [1, 1]], 50);
    expect(dominated[50][0]).toBeGreaterThan(0.999);
    const shifted = replicator([[0, -2], [-1, -1]], 30);
    for (const gen of shifted) expect(sum(gen)).toBeCloseTo(1, 9);
  });
  it('Always Defect dies out in the default field, and exploitable strategies go first', () => {
    const res = runTournament(defaultConfig('games'));
    const last = res.evolution![EVOLUTION_GENERATIONS];
    const share = (id: string) => last[res.players.findIndex((p) => p.id === id)];
    expect(share('alld')).toBeLessThan(0.001);
    expect(share('random')).toBeLessThan(0.001);
    expect(share('tft')).toBeGreaterThan(1 / 8);
  });
  it('is computed even when self-play is not scored', () => {
    const res = runTournament({ ...defaultConfig('games'), selfPlay: false });
    expect(res.matrix[0][0]).toBeNull();
    expect(res.evolution).toEqual(runTournament(defaultConfig('games')).evolution);
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
    expect(runTournament({ ...cfg, seed: 'one' }).auction).not.toEqual(runTournament({ ...cfg, seed: 'two' }).auction);
    const a = runTournament({ ...cfg, seed: 'one' }).leaderboard.map((s) => s.total);
    const b = runTournament({ ...cfg, seed: 'two' }).leaderboard.map((s) => s.total);
    expect(a).not.toEqual(b);
  });
  it('plays a full round-robin and totals match the matches', () => {
    for (const arena of ['games', 'bargain'] as const) {
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
      if (arena === 'auction') cfg.selfPlay = false; // not a pairwise arena
      if (arena === 'games') {
        cfg.games = { preset: 'chicken', payoffs: { R: 3, S: 1.5, T: 6, P: -1 }, noise: 0.07 };
        cfg.custom = [
          { id: 'm2', name: "Extort-2 (P & D's)", first: 'C', p: [0.8889, 0.5, 0.3333, 0] },
          { id: 'm1', name: 'Mean one', first: 'D', p: [0, 0.25, 1, 0.5] },
        ];
        cfg.strategies = ['tft', 'm2', 'alld', 'm1'];
        cfg.evolution = true;
      }
      if (arena === 'auction') cfg.auction.format = 'second';
      if (arena === 'bargain') cfg.bargain = { mode: 'rubinstein', delta: 0.75, maxStages: 4 };
      expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
    }
  });
  it('falls back to defaults on junk', () => {
    expect(decodeConfig('a=nope&s=zzz&r=abc&n=9')).toEqual({ ...defaultConfig('games'), games: { ...defaultConfig().games, noise: 0.5 } });
    expect(decodeConfig('')).toEqual(defaultConfig('games'));
    const junk = decodeConfig('a=games&s=tft.m1.m7&c=m1~Ok~C~1~0~0~1|m1~Dup~C~1~1~1~1|bad|m7~x~C~1~1~1');
    expect(junk.custom).toEqual([{ id: 'm1', name: 'Ok', first: 'C', p: [1, 0, 0, 1] }]);
    expect(junk.strategies).toEqual(['tft', 'm1']);
    expect(decodeConfig('a=auction&c=m1~Ok~C~1~0~0~1&ev=1')).toEqual(defaultConfig('auction'));
  });
});
