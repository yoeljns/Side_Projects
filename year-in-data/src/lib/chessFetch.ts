// The only place that talks to Lichess and Chess.com. Both APIs are public and need no key.
import { type ISODate, monthsIn, toMs } from './dates';
import { parseChessCom, parseLichess } from './chess';
import type { ChessGame } from './types';

export type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

/** Most games asked of Lichess for one year. */
export const LICHESS_MAX = 5000;

export function lichessUrl(username: string, from: ISODate, toExclusive: ISODate): string {
  const q = `since=${toMs(from)}&until=${toMs(toExclusive) - 1}&max=${LICHESS_MAX}&moves=false&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`;
  return `https://lichess.org/api/games/user/${encodeURIComponent(username.trim())}?${q}`;
}

export async function fetchLichess(fetcher: Fetcher, username: string, from: ISODate, toExclusive: ISODate): Promise<ChessGame[]> {
  const res = await fetcher(lichessUrl(username, from, toExclusive), { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error(`Lichess has no player called "${username}".`);
  if (res.status === 429) throw new Error('Lichess is rate-limiting this browser. Wait a minute and try again.');
  if (!res.ok) throw new Error(`Lichess answered ${res.status}.`);
  return parseLichess(await res.text(), username);
}

export function chessComMonthUrls(username: string, from: ISODate, toExclusive: ISODate): string[] {
  const user = encodeURIComponent(username.trim().toLowerCase());
  return monthsIn(from, toExclusive).map((m) => `https://api.chess.com/pub/player/${user}/games/${m.slice(0, 4)}/${m.slice(5, 7)}`);
}

export async function fetchChessCom(fetcher: Fetcher, username: string, from: ISODate, toExclusive: ISODate): Promise<ChessGame[]> {
  const user = encodeURIComponent(username.trim().toLowerCase());
  const index = await fetcher(`https://api.chess.com/pub/player/${user}/games/archives`);
  if (index.status === 404) throw new Error(`Chess.com has no player called "${username}".`);
  if (!index.ok) throw new Error(`Chess.com answered ${index.status}.`);
  const have = new Set(((await index.json()) as { archives?: string[] }).archives ?? []);
  const games: ChessGame[] = [];
  const lo = toMs(from);
  const hi = toMs(toExclusive);
  for (const url of chessComMonthUrls(username, from, toExclusive)) {
    if (!have.has(url)) continue; // no games that month
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`Chess.com answered ${res.status} for ${url.slice(-7)}.`);
    games.push(...parseChessCom(await res.json(), username).filter((g) => g.at >= lo && g.at < hi));
  }
  return games.sort((a, b) => a.at - b.at);
}

export interface ChessFetchResult {
  games: ChessGame[];
  /** One plain line per account: what was fetched, or why it failed. */
  notes: string[];
  /** Sites whose request failed; their previously cached games should be kept. */
  failedSites: ChessGame['site'][];
}

/** Games to cache after a fetch: the new ones, plus the old ones from any site that failed this time. */
export function mergeAfterFetch(previous: ChessGame[], result: ChessFetchResult): ChessGame[] {
  const kept = previous.filter((g) => result.failedSites.includes(g.site));
  return [...kept, ...result.games].sort((a, b) => a.at - b.at);
}

/** Fetch whichever accounts are set. One failing does not hide the other. */
export async function fetchChessYear(
  fetcher: Fetcher,
  accounts: { lichess: string; chesscom: string },
  from: ISODate,
  toExclusive: ISODate,
): Promise<ChessFetchResult> {
  const games: ChessGame[] = [];
  const notes: string[] = [];
  const failedSites: ChessGame['site'][] = [];
  const run = async (site: ChessGame['site'], name: string, user: string, job: () => Promise<ChessGame[]>) => {
    if (!user.trim()) return;
    try {
      const got = await job();
      games.push(...got);
      notes.push(`${name} (${user.trim()}): ${got.length} games.`);
      if (name === 'Lichess' && got.length >= LICHESS_MAX) notes.push(`Lichess stopped at ${LICHESS_MAX} games; earlier games in the year may be missing.`);
    } catch (e) {
      failedSites.push(site);
      const why = e instanceof TypeError || !(e instanceof Error) ? 'could not reach the server.' : e.message;
      notes.push(`${name} (${user.trim()}) failed: ${why}`);
    }
  };
  await run('lichess', 'Lichess', accounts.lichess, () => fetchLichess(fetcher, accounts.lichess, from, toExclusive));
  await run('chesscom', 'Chess.com', accounts.chesscom, () => fetchChessCom(fetcher, accounts.chesscom, from, toExclusive));
  return { games: games.sort((a, b) => a.at - b.at), notes, failedSites };
}
