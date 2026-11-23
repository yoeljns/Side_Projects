import { Chess } from 'chess.js'

export type Site = 'lichess' | 'chesscom'

export interface Game {
  id: string
  url: string
  opponent: string
  userColor: 'w' | 'b'
  speed: string
  playedAt: number
  moves: string[] // SAN
  initialFen?: string
}

/** The username does not exist on the chosen site: retrying will not help. */
export class PlayerNotFound extends Error {}

const same = (a: string | undefined, b: string) => (a ?? '').toLowerCase() === b.toLowerCase()

interface LichessGame {
  id: string
  variant: string
  speed: string
  createdAt: number
  moves?: string
  players: Record<'white' | 'black', { user?: { name: string }; aiLevel?: number }>
}

export function parseLichess(ndjson: string, username: string): Game[] {
  const games: Game[] = []
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue
    const g = JSON.parse(line) as LichessGame
    if (g.variant !== 'standard' || !g.moves) continue
    const isWhite = same(g.players.white.user?.name, username)
    if (!isWhite && !same(g.players.black.user?.name, username)) continue
    const opp = g.players[isWhite ? 'black' : 'white']
    games.push({
      id: `lichess:${g.id}`,
      url: `https://lichess.org/${g.id}${isWhite ? '' : '/black'}`,
      opponent: opp.user?.name ?? (opp.aiLevel ? `Stockfish level ${opp.aiLevel}` : 'Anonymous'),
      userColor: isWhite ? 'w' : 'b',
      speed: g.speed,
      playedAt: g.createdAt,
      moves: g.moves.split(' '),
    })
  }
  return games
}

interface ChessComGame {
  url: string
  pgn?: string
  rules: string
  time_class: string
  end_time: number
  white: { username: string }
  black: { username: string }
}

export function parseChessCom(games: ChessComGame[], username: string): Game[] {
  const out: Game[] = []
  for (const g of games) {
    if (g.rules !== 'chess' || !g.pgn) continue
    const isWhite = same(g.white.username, username)
    if (!isWhite && !same(g.black.username, username)) continue
    const chess = new Chess()
    try {
      chess.loadPgn(g.pgn)
    } catch {
      continue
    }
    const headers = chess.getHeaders()
    out.push({
      id: `chesscom:${g.url.split('/').pop()}`,
      url: g.url,
      opponent: (isWhite ? g.black : g.white).username,
      userColor: isWhite ? 'w' : 'b',
      speed: g.time_class,
      playedAt: g.end_time * 1000,
      moves: chess.history(),
      initialFen: headers.SetUp === '1' ? headers.FEN : undefined,
    })
  }
  return out.sort((a, b) => b.playedAt - a.playedAt)
}

/** Most recent standard games for a player, newest first. */
export async function fetchRecentGames(site: Site, username: string, max: number): Promise<Game[]> {
  const user = encodeURIComponent(username.trim())
  if (site === 'lichess') {
    const res = await fetch(`https://lichess.org/api/games/user/${user}?max=${max}&perfType=bullet,blitz,rapid,classical,correspondence`, {
      headers: { Accept: 'application/x-ndjson' },
    })
    if (res.status === 404) throw new PlayerNotFound(`No Lichess player called “${username}”.`)
    if (!res.ok) throw new Error(`Lichess answered ${res.status}. Try again in a minute.`)
    return parseLichess(await res.text(), username)
  }
  const archives = await fetch(`https://api.chess.com/pub/player/${user.toLowerCase()}/games/archives`)
  if (archives.status === 404) throw new PlayerNotFound(`No Chess.com player called “${username}”.`)
  if (!archives.ok) throw new Error(`Chess.com answered ${archives.status}. Try again in a minute.`)
  const months = ((await archives.json()) as { archives: string[] }).archives.reverse()
  const games: Game[] = []
  for (const url of months.slice(0, 3)) {
    if (games.length >= max) break
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Chess.com answered ${res.status}. Try again in a minute.`)
    games.push(...parseChessCom(((await res.json()) as { games: ChessComGame[] }).games, username))
  }
  return games.slice(0, max)
}
