// Chess games: parse the two public APIs' responses into one shape, then count.
// No network here; see chessFetch.ts.
import { type ISODate, monthKey, monthsIn, msToDate, toMs } from './dates';
import type { ChessGame } from './types';
import type { YearWindow } from './window';

const same = (a: string | undefined, b: string) => (a ?? '').toLowerCase() === b.trim().toLowerCase();

// --- Lichess: GET /api/games/user/{user}, one JSON object per line ---
interface LichessPlayer {
  user?: { name: string; id?: string };
  aiLevel?: number;
  rating?: number;
  ratingDiff?: number;
  provisional?: boolean;
}
interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt?: number;
  status: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: 'white' | 'black';
}

/** Statuses where no game was played. */
const LICHESS_SKIP = new Set(['created', 'started', 'aborted', 'noStart', 'unknownFinish']);

export function parseLichess(ndjson: string, username: string): ChessGame[] {
  const games: ChessGame[] = [];
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue;
    let g: LichessGame;
    try {
      g = JSON.parse(line) as LichessGame;
    } catch {
      continue; // a cut-off last line
    }
    if (!g || !g.players || g.variant !== 'standard' || LICHESS_SKIP.has(g.status)) continue;
    const isWhite = same(g.players.white?.user?.name, username);
    if (!isWhite && !same(g.players.black?.user?.name, username)) continue;
    const me = g.players[isWhite ? 'white' : 'black'];
    const opp = g.players[isWhite ? 'black' : 'white'];
    const result = !g.winner ? 'draw' : (g.winner === 'white') === isWhite ? 'win' : 'loss';
    games.push({
      id: `lichess:${g.id}`,
      site: 'lichess',
      at: g.createdAt,
      speed: g.speed,
      rated: g.rated === true,
      color: isWhite ? 'w' : 'b',
      result,
      opp: opp.user?.name ?? (opp.aiLevel ? `Stockfish level ${opp.aiLevel}` : 'Anonymous'),
      ...(typeof opp.rating === 'number' ? { oppRating: opp.rating } : {}),
      ...(typeof me.rating === 'number' ? { before: me.rating } : {}),
      ...(typeof me.rating === 'number' && typeof me.ratingDiff === 'number' ? { after: me.rating + me.ratingDiff } : {}),
      url: `https://lichess.org/${g.id}${isWhite ? '' : '/black'}`,
    });
  }
  return games.sort((a, b) => a.at - b.at);
}

// --- Chess.com: GET /pub/player/{user}/games/{YYYY}/{MM} ---
interface ChessComSide {
  username: string;
  rating?: number;
  result: string;
}
interface ChessComGame {
  url: string;
  uuid?: string;
  rated?: boolean;
  rules: string;
  time_class: string;
  end_time: number; // seconds
  white: ChessComSide;
  black: ChessComSide;
}

const CHESSCOM_DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export function chessComResult(code: string): ChessGame['result'] {
  return code === 'win' ? 'win' : CHESSCOM_DRAWS.has(code) ? 'draw' : 'loss';
}

export function parseChessCom(body: unknown, username: string): ChessGame[] {
  const list = (body as { games?: ChessComGame[] } | null)?.games;
  if (!Array.isArray(list)) return [];
  const games: ChessGame[] = [];
  for (const g of list) {
    if (!g || g.rules !== 'chess' || !g.white || !g.black || typeof g.end_time !== 'number') continue;
    const isWhite = same(g.white.username, username);
    if (!isWhite && !same(g.black.username, username)) continue;
    const me = isWhite ? g.white : g.black;
    const opp = isWhite ? g.black : g.white;
    games.push({
      id: `chesscom:${g.uuid ?? g.url.split('/').pop()}`,
      site: 'chesscom',
      at: g.end_time * 1000,
      speed: g.time_class,
      rated: g.rated === true,
      color: isWhite ? 'w' : 'b',
      result: chessComResult(me.result),
      opp: opp.username,
      ...(typeof opp.rating === 'number' ? { oppRating: opp.rating } : {}),
      // Chess.com reports each player's rating after the game, not before it.
      ...(typeof me.rating === 'number' ? { after: me.rating } : {}),
      url: g.url,
    });
  }
  return games.sort((a, b) => a.at - b.at);
}

// --- counting ---
export interface SpeedLine {
  site: ChessGame['site'];
  speed: string;
  label: string;
  games: number;
  win: number;
  draw: number;
  loss: number;
  /** Rating going into the first rated game (Lichess), or after it (Chess.com, which does not publish the rating before). */
  start?: number;
  /** Rating after the last rated game. */
  end?: number;
  startIsAfterFirstGame: boolean;
}

export interface ChessStats {
  total: number;
  win: number;
  draw: number;
  loss: number;
  bySpeed: SpeedLine[];
  bestWin: ChessGame | null;
  /** Longest run of consecutive wins across every game, in the order played. */
  streak: { length: number; from: ISODate; to: ISODate } | null;
  busiest: { day: ISODate; games: number } | null;
  byMonth: { month: string; games: number }[];
}

const SITE_LABEL = { lichess: 'Lichess', chesscom: 'Chess.com' } as const;
const SPEED_ORDER = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'daily', 'correspondence'];

export const gameDay = (g: ChessGame): ISODate => msToDate(g.at);

/** Games whose UTC day falls in the year, de-duplicated, oldest first. */
export function gamesInWindow(games: ChessGame[], w: YearWindow): ChessGame[] {
  const from = toMs(w.start);
  const to = toMs(w.end);
  const seen = new Set<string>();
  return games
    .filter((g) => g.at >= from && g.at < to && !seen.has(g.id) && Boolean(seen.add(g.id)))
    .sort((a, b) => a.at - b.at);
}

export function chessStats(all: ChessGame[], w: YearWindow): ChessStats {
  const games = gamesInWindow(all, w);
  const lines = new Map<string, SpeedLine>();
  const days = new Map<ISODate, number>();
  const months = new Map<string, number>(monthsIn(w.start, w.end).map((m) => [m, 0]));
  let bestWin: ChessGame | null = null;
  let streak: ChessStats['streak'] = null;
  let run = 0;
  let runFrom = '';

  for (const g of games) {
    const key = `${g.site} ${g.speed}`;
    let line = lines.get(key);
    if (!line) {
      line = { site: g.site, speed: g.speed, label: `${SITE_LABEL[g.site]} ${g.speed}`, games: 0, win: 0, draw: 0, loss: 0, startIsAfterFirstGame: false };
      lines.set(key, line);
    }
    line.games += 1;
    line[g.result] += 1;
    if (g.rated && (g.before !== undefined || g.after !== undefined)) {
      if (line.start === undefined) {
        line.start = g.before ?? g.after;
        line.startIsAfterFirstGame = g.before === undefined;
      }
      line.end = g.after ?? g.before;
    }
    const day = gameDay(g);
    days.set(day, (days.get(day) ?? 0) + 1);
    months.set(monthKey(day), (months.get(monthKey(day)) ?? 0) + 1);
    if (g.result === 'win') {
      if (g.oppRating !== undefined && (!bestWin || g.oppRating > bestWin.oppRating!)) bestWin = g;
      if (run === 0) runFrom = day;
      run += 1;
      if (!streak || run > streak.length) streak = { length: run, from: runFrom, to: day };
    } else {
      run = 0;
    }
  }

  // Ties go to the earliest day.
  let busiest: ChessStats['busiest'] = null;
  for (const [day, n] of days) if (!busiest || n > busiest.games) busiest = { day, games: n };
  const order = (s: string) => (SPEED_ORDER.indexOf(s) + 1 || SPEED_ORDER.length + 1);

  return {
    total: games.length,
    win: games.filter((g) => g.result === 'win').length,
    draw: games.filter((g) => g.result === 'draw').length,
    loss: games.filter((g) => g.result === 'loss').length,
    bySpeed: [...lines.values()].sort((a, b) => a.site.localeCompare(b.site) || order(a.speed) - order(b.speed)),
    bestWin,
    streak,
    busiest,
    byMonth: [...months].map(([month, n]) => ({ month, games: n })),
  };
}
