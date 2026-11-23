import { AUCTION_STRATEGIES, type AuctionRoom, playAuctionRoom } from './auction';
import { BARGAIN_STRATEGIES, playBargainMatch } from './bargain';
import { type RunConfig, strategiesFor } from './config';
import { replicator } from './evolution';
import { gameStrategies, playGameMatch } from './games';
import { makeRng } from './rng';
import type { MatchPlay, RoundRecord, StrategyInfo } from './types';

export interface Match {
  /** Player indices into TournamentResult.players. i === j is self-play. */
  i: number;
  j: number;
  scoreI: number;
  scoreJ: number;
  rounds: RoundRecord[];
}

export interface Standing {
  index: number;
  id: string;
  name: string;
  total: number;
  /** Average payoff per round across everything it played. */
  perRound: number;
  /** Matches won, drawn and lost. In the auction arena, wins counts auctions won and the other two are zero. */
  wins: number;
  draws: number;
  losses: number;
}

export interface TournamentResult {
  config: RunConfig;
  players: StrategyInfo[];
  matches: Match[];
  /** matrix[i][j]: i's average payoff per round against j, or null if they did not meet. */
  matrix: (number | null)[][];
  leaderboard: Standing[];
  /**
   * Auction arena only (there are no pairwise matches): the same bidders and the same values
   * run under both formats, so revenues can be compared. The run's own format is config.auction.format.
   */
  auction?: Record<'first' | 'second', AuctionRoom>;
  /** Repeated games only: population shares per generation, see replicator(). */
  evolution?: number[][];
}

function find<T extends StrategyInfo>(list: T[], id: string): T {
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}

function play(cfg: RunConfig, a: string, b: string): MatchPlay {
  // Each pairing gets its own stream, so adding or removing a strategy never changes other matches.
  const rng = makeRng(cfg.seed, cfg.arena, a, b);
  switch (cfg.arena) {
    case 'games': {
      const list = gameStrategies(cfg.custom);
      return playGameMatch(find(list, a), find(list, b), cfg.games, cfg.rounds, rng);
    }
    case 'auction':
      throw new Error('Auctions are played as one room, not as matches');
    case 'bargain':
      return playBargainMatch(find(BARGAIN_STRATEGIES, a), find(BARGAIN_STRATEGIES, b), cfg.bargain, cfg.rounds, rng);
  }
}

/**
 * Pairings [i, j] with i <= j, in match-day order (circle method): everyone plays once per day,
 * so standings build up evenly instead of one strategy finishing all its matches first.
 */
export function schedule(n: number, selfPlay: boolean): [number, number][] {
  const out: [number, number][] = [];
  if (selfPlay) for (let i = 0; i < n; i++) out.push([i, i]);
  const seats = Array.from({ length: n + (n % 2) }, (_, i) => (i < n ? i : -1)); // -1 is a bye
  const m = seats.length;
  for (let day = 0; day < m - 1; day++) {
    for (let k = 0; k < m / 2; k++) {
      const a = seats[k];
      const b = seats[m - 1 - k];
      if (a >= 0 && b >= 0) out.push([Math.min(a, b), Math.max(a, b)]);
    }
    seats.splice(1, 0, seats.pop()!);
  }
  return out;
}

/** Round-robin: every strategy meets every other once (and itself, if selfPlay is on). */
export function runTournament(cfg: RunConfig): TournamentResult {
  const all = strategiesFor(cfg.arena, cfg.custom);
  const players = [...new Set(cfg.strategies)].map((id) => find(all, id));
  const n = players.length;
  const matches: Match[] = [];
  const matrix: (number | null)[][] = players.map(() => players.map(() => null));
  const stand = players.map((p, index) => ({ index, id: p.id, name: p.name, total: 0, perRound: 0, wins: 0, draws: 0, losses: 0 }));
  const played = players.map(() => 0);
  const rounds = Math.max(1, cfg.rounds);

  if (cfg.arena === 'auction') {
    const bidders = players.map((p) => find(AUCTION_STRATEGIES, p.id));
    const room = (format: 'first' | 'second') => playAuctionRoom(bidders, { format }, cfg.rounds, makeRng(cfg.seed, 'auction'));
    const auction = { first: room('first'), second: room('second') };
    const mine = auction[cfg.auction.format];
    stand.forEach((s, i) => {
      s.total = mine.scores[i];
      s.perRound = s.total / rounds;
      s.wins = mine.stats[i].wins;
    });
    const leaderboard = [...stand].sort((x, y) => y.total - x.total || x.index - y.index);
    return { config: cfg, players, matches, matrix, leaderboard, auction };
  }

  for (const [i, j] of schedule(n, cfg.selfPlay)) {
    const m = play(cfg, players[i].id, players[j].id);
    matches.push({ i, j, scoreI: m.scoreA, scoreJ: m.scoreB, rounds: m.rounds });
    if (i === j) {
      // Two copies of the same strategy: credit the average once.
      const avg = (m.scoreA + m.scoreB) / 2;
      matrix[i][i] = avg / rounds;
      stand[i].total += avg;
      played[i]++;
      continue;
    }
    matrix[i][j] = m.scoreA / rounds;
    matrix[j][i] = m.scoreB / rounds;
    stand[i].total += m.scoreA;
    stand[j].total += m.scoreB;
    played[i]++;
    played[j]++;
    const diff = m.scoreA - m.scoreB;
    if (Math.abs(diff) < 1e-9) {
      stand[i].draws++;
      stand[j].draws++;
    } else {
      stand[diff > 0 ? i : j].wins++;
      stand[diff > 0 ? j : i].losses++;
    }
  }
  for (const s of stand) s.perRound = played[s.index] ? s.total / (played[s.index] * rounds) : 0;
  const leaderboard = [...stand].sort((x, y) => y.total - x.total || x.index - y.index);
  if (cfg.arena !== 'games') return { config: cfg, players, matches, matrix, leaderboard };
  // Evolution needs every strategy's payoff against itself, even when self-play is not scored.
  const full = matrix.map((row, i) =>
    row.map((v, j) => {
      if (v !== null) return v;
      const m = play(cfg, players[i].id, players[j].id);
      return (m.scoreA + m.scoreB) / 2 / rounds;
    }),
  );
  return { config: cfg, players, matches, matrix, leaderboard, evolution: replicator(full) };
}
