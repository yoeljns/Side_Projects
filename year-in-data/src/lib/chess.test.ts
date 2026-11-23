import { describe, expect, it } from 'vitest';
import lichessRaw from '../../test/fixtures/lichess.ndjson?raw';
import chessComRaw from '../../test/fixtures/chesscom-2025-06.json?raw';
import archivesRaw from '../../test/fixtures/chesscom-archives.json?raw';
import { chessComResult, chessStats, parseChessCom, parseLichess } from './chess';
import { chessComMonthUrls, type Fetcher, fetchChessCom, fetchChessYear, fetchLichess, lichessUrl, mergeAfterFetch } from './chessFetch';
import { yearWindow } from './window';

const W = yearWindow({ month: 3, day: 10 }, 2026);
const lichess = parseLichess(lichessRaw, 'testpawn');
const chessCom = parseChessCom(JSON.parse(chessComRaw), 'testpawn');

describe('Lichess response', () => {
  it('keeps standard games that were played, oldest first', () => {
    // 11 lines: one chess960 and one aborted are left out.
    expect(lichess.map((g) => g.id)).toEqual(['zz000001', 'zz000002', 'zz000003', 'zz000004', 'zz000005', 'zz000006', 'zz000007', 'zz000008', 'zz000011'].map((x) => `lichess:${x}`));
  });
  it('reads colour, result and ratings from the right side', () => {
    expect(lichess[0]).toEqual({ id: 'lichess:zz000001', site: 'lichess', at: Date.UTC(2025, 2, 15, 10, 0), speed: 'blitz', rated: true, color: 'w', result: 'win', opp: 'RookFan', oppRating: 1520, before: 1500, after: 1508, url: 'https://lichess.org/zz000001' });
    expect(lichess[1]).toMatchObject({ color: 'b', result: 'win', opp: 'KnightOwl', before: 1508, after: 1515, url: 'https://lichess.org/zz000002/black' });
    expect(lichess[2]).toMatchObject({ color: 'w', result: 'loss', after: 1506 });
    expect(lichess[3]).toMatchObject({ speed: 'rapid', result: 'draw', color: 'b', before: 1600, after: 1602 });
  });
  it('handles a casual game against the computer', () => {
    expect(lichess[5]).toMatchObject({ rated: false, opp: 'Stockfish level 3', result: 'win', before: 1516 });
    expect(lichess[5].oppRating).toBeUndefined();
    expect(lichess[5].after).toBeUndefined();
  });
  it('ignores games the player is not in, blank lines and a cut-off last line', () => {
    expect(parseLichess(lichessRaw, 'someone-else')).toEqual([]);
    const first = lichessRaw.split('\n')[0];
    expect(parseLichess(`\n${first}\n{"id":"zz0000`, 'TESTPAWN')).toHaveLength(1);
  });
});

describe('Chess.com response', () => {
  it('maps result codes', () => {
    expect(chessComResult('win')).toBe('win');
    for (const c of ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']) expect(chessComResult(c)).toBe('draw');
    for (const c of ['checkmated', 'timeout', 'resigned', 'abandoned', 'lose']) expect(chessComResult(c)).toBe('loss');
  });
  it('keeps standard chess and reads the player whichever colour they had', () => {
    expect(chessCom).toHaveLength(4); // the chess960 game is left out
    expect(chessCom[0]).toEqual({ id: 'chesscom:00000000-0000-4000-8000-000000000001', site: 'chesscom', at: Date.UTC(2025, 5, 5, 12), speed: 'rapid', rated: true, color: 'w', result: 'win', opp: 'SlowMover', oppRating: 1190, after: 1210, url: 'https://www.chess.com/game/live/900000001' });
    expect(chessCom[1]).toMatchObject({ color: 'b', result: 'loss', opp: 'ClockWatch', after: 1202 });
    expect(chessCom[2]).toMatchObject({ speed: 'daily', result: 'draw' });
    expect(chessCom[3]).toMatchObject({ color: 'b', result: 'win', oppRating: 1305 });
    expect(chessCom.every((g) => g.before === undefined)).toBe(true);
  });
  it('returns nothing for a body with no games', () => {
    expect(parseChessCom({}, 'testpawn')).toEqual([]);
    expect(parseChessCom(null, 'testpawn')).toEqual([]);
    expect(parseChessCom({ games: [] }, 'testpawn')).toEqual([]);
  });
});

describe('the year in chess', () => {
  const s = chessStats([...lichess, ...chessCom, lichess[0]], W); // one duplicate on purpose
  it('counts games in the year once each', () => {
    // 8 Lichess (the game at 00:00 on the closing birthday is outside) + 4 Chess.com.
    expect([s.total, s.win, s.draw, s.loss]).toEqual([12, 7, 2, 3]);
  });
  it('breaks down by site and time control with start and end ratings', () => {
    expect(s.bySpeed.map((l) => [l.label, l.games, l.win, l.draw, l.loss, l.start, l.end, l.startIsAfterFirstGame])).toEqual([
      ['Chess.com rapid', 3, 2, 0, 1, 1210, 1211, true],
      ['Chess.com daily', 1, 0, 1, 0, 1300, 1300, true],
      ['Lichess blitz', 7, 5, 0, 2, 1500, 1515, false], // 1522 - 7 after the last rated game; the casual game does not move it
      ['Lichess rapid', 1, 0, 1, 0, 1600, 1602, false],
    ]);
  });
  it('finds the best win, the longest streak and the busiest day', () => {
    expect(s.bestWin).toMatchObject({ opp: 'Endgamer', oppRating: 1710 });
    // 21 Jun (Chess.com), 9 Sep twice, 10 Sep: four wins in a row across both sites.
    expect(s.streak).toEqual({ length: 4, from: '2025-06-21', to: '2025-09-10' });
    expect(s.busiest).toEqual({ day: '2025-03-15', games: 3 });
  });
  it('counts by month across the 13 months the year touches', () => {
    expect(s.byMonth).toHaveLength(13);
    expect(Object.fromEntries(s.byMonth.filter((m) => m.games).map((m) => [m.month, m.games]))).toEqual({ '2025-03': 3, '2025-06': 5, '2025-09': 3, '2026-02': 1 });
  });
  it('is empty, not broken, with no games', () => {
    expect(chessStats([], W)).toMatchObject({ total: 0, bySpeed: [], bestWin: null, streak: null, busiest: null });
  });
});

describe('fetching', () => {
  const ok = (body: string, status = 200) => new Response(body, { status });
  it('asks Lichess for the window in milliseconds as ndjson', async () => {
    expect(lichessUrl('Test Pawn', W.start, W.end)).toBe(`https://lichess.org/api/games/user/Test%20Pawn?since=${Date.UTC(2025, 2, 10)}&until=${Date.UTC(2026, 2, 10) - 1}&max=5000&moves=false&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`);
    const calls: [string, unknown][] = [];
    const fetcher: Fetcher = async (url, init) => { calls.push([url, init]); return ok(lichessRaw); };
    expect(await fetchLichess(fetcher, 'testpawn', W.start, W.end)).toHaveLength(9);
    expect(calls[0][1]).toEqual({ headers: { Accept: 'application/x-ndjson' } });
  });
  it('reports a missing player and a rate limit in words', async () => {
    await expect(fetchLichess(async () => ok('', 404), 'nobody', W.start, W.end)).rejects.toThrow('Lichess has no player called "nobody".');
    await expect(fetchLichess(async () => ok('', 429), 'x', W.start, W.end)).rejects.toThrow(/rate-limiting/);
    await expect(fetchLichess(async () => ok('', 503), 'x', W.start, W.end)).rejects.toThrow('Lichess answered 503.');
  });
  it('fetches only the Chess.com months that exist and lie in the window', async () => {
    expect(chessComMonthUrls('TestPawn', '2025-11-20', '2026-01-05')).toEqual(['2025/11', '2025/12', '2026/01'].map((m) => `https://api.chess.com/pub/player/testpawn/games/${m}`));
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return url.endsWith('/archives') ? ok(archivesRaw) : ok(chessComRaw);
    };
    const games = await fetchChessCom(fetcher, 'TestPawn', W.start, W.end);
    expect(calls).toEqual(['https://api.chess.com/pub/player/testpawn/games/archives', 'https://api.chess.com/pub/player/testpawn/games/2025/06']);
    expect(games).toHaveLength(4);
    await expect(fetchChessCom(async () => ok('', 404), 'nobody', W.start, W.end)).rejects.toThrow('Chess.com has no player called "nobody".');
  });
  it('keeps one account when the other fails, and says which failed', async () => {
    const fetcher: Fetcher = async (url) => {
      if (url.includes('lichess.org')) throw new TypeError('Failed to fetch');
      return url.endsWith('/archives') ? ok(archivesRaw) : ok(chessComRaw);
    };
    const r = await fetchChessYear(fetcher, { lichess: 'testpawn', chesscom: 'testpawn' }, W.start, W.end);
    expect(r.games).toHaveLength(4);
    expect(r.failedSites).toEqual(['lichess']);
    expect(r.notes).toEqual(['Lichess (testpawn) failed: could not reach the server.', 'Chess.com (testpawn): 4 games.']);
    // Games cached earlier from the failed site are kept; the other site's are replaced.
    const merged = mergeAfterFetch([...lichess, chessCom[0]], r);
    expect(merged).toHaveLength(lichess.length + 4);
  });
  it('skips accounts that are not set', async () => {
    const r = await fetchChessYear(async () => { throw new Error('should not be called'); }, { lichess: ' ', chesscom: '' }, W.start, W.end);
    expect(r).toEqual({ games: [], notes: [], failedSites: [] });
  });
});
