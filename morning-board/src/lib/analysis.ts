import { Chess } from 'chess.js'
import type { Evaluation } from './engine.ts'
import type { Game } from './games.ts'

/** Lichess's centipawn → win-percentage curve (0..100, side-to-move POV). */
export function winPercent(e: Pick<Evaluation, 'cp' | 'mate'>): number {
  if (e.mate !== undefined) return e.mate > 0 ? 100 : 0
  const cp = Math.max(-1500, Math.min(1500, e.cp ?? 0))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export function formatEval(e: Pick<Evaluation, 'cp' | 'mate'>, flip = false): string {
  const s = flip ? -1 : 1
  if (e.mate !== undefined) return `${e.mate * s > 0 ? '+' : '−'}M${Math.abs(e.mate)}`
  const v = ((e.cp ?? 0) * s) / 100
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`
}

export interface Puzzle {
  id: string
  gameId: string
  gameUrl: string
  opponent: string
  speed: string
  playedAt: number
  /** Position before your move. */
  fen: string
  color: 'w' | 'b'
  moveNumber: number
  /** What you played, in SAN and UCI. */
  playedSan: string
  playedUci: string
  /** Engine's choice and its line, UCI. */
  bestUci: string
  pv: string[]
  /** Evaluations from your point of view: before (with best play) and after your move. */
  evalBest: string
  evalPlayed: string
  /** Your win percentage after the engine's move (used to accept equally good answers). */
  bestWin: number
  /** Win-percentage points your move gave away. */
  drop: number
}

export interface ScanOptions {
  /** Depth for the first pass over every position. */
  scanDepth: number
  /** Depth used to double-check a candidate before it becomes a puzzle. */
  verifyDepth: number
  /** Minimum win-percentage drop that counts as a blunder. */
  threshold: number
  /** Skip the first N full moves (opening theory makes poor puzzles). */
  skipMoves: number
}

export const DEFAULT_SCAN: ScanOptions = { scanDepth: 12, verifyDepth: 16, threshold: 20, skipMoves: 6 }

type Evaluate = (fen: string, depth: number) => Promise<Evaluation>

const isOver = (fen: string) => new Chess(fen).isGameOver()

/**
 * Replay a game and return the moments where the user threw away a playable
 * position. `evaluate` is injected so this stays testable without the engine.
 */
export async function findBlunders(game: Game, evaluate: Evaluate, opts: ScanOptions = DEFAULT_SCAN): Promise<Puzzle[]> {
  const chess = new Chess(game.initialFen)
  const fens = [chess.fen()]
  const moves: { san: string; uci: string; color: 'w' | 'b' }[] = []
  for (const san of game.moves) {
    const m = chess.move(san)
    moves.push({ san: m.san, uci: m.from + m.to + (m.promotion ?? ''), color: m.color })
    fens.push(chess.fen())
  }

  const firstPly = opts.skipMoves * 2
  const cache = new Map<number, Evaluation | null>()
  const evalAt = async (i: number, depth: number): Promise<Evaluation | null> => {
    if (isOver(fens[i])) return null
    return evaluate(fens[i], depth)
  }
  const scan = async (i: number) => {
    if (!cache.has(i)) cache.set(i, await evalAt(i, opts.scanDepth))
    return cache.get(i) ?? null
  }
  // Win% for the user in position i+1, where the opponent is to move.
  const afterWin = (fen: string, e: Evaluation | null): number => {
    if (e) return 100 - winPercent(e)
    const c = new Chess(fen)
    return c.isCheckmate() ? 100 : 50
  }

  const puzzles: Puzzle[] = []
  for (let i = firstPly; i < moves.length; i++) {
    if (moves[i].color !== game.userColor) continue
    const before = await scan(i)
    if (!before) continue
    const beforeWin = winPercent(before)
    // Only positions that were still worth playing: not lost, not trivially won either way.
    if (beforeWin < 30) continue
    const after = await scan(i + 1)
    if (beforeWin - afterWin(fens[i + 1], after) < opts.threshold) continue
    if (before.best === moves[i].uci) continue

    // Candidate: confirm at higher depth so shallow-search noise does not become a puzzle.
    const deepBefore = await evalAt(i, opts.verifyDepth)
    const deepAfter = await evalAt(i + 1, opts.verifyDepth)
    if (!deepBefore || deepBefore.best === moves[i].uci) continue
    const best = winPercent(deepBefore)
    const played = afterWin(fens[i + 1], deepAfter)
    const drop = best - played
    if (best < 30 || drop < opts.threshold) continue

    puzzles.push({
      id: `${game.id}:${i}`,
      gameId: game.id,
      gameUrl: game.url,
      opponent: game.opponent,
      speed: game.speed,
      playedAt: game.playedAt,
      fen: fens[i],
      color: game.userColor,
      moveNumber: Math.floor(i / 2) + 1,
      playedSan: moves[i].san,
      playedUci: moves[i].uci,
      bestUci: deepBefore.best,
      pv: deepBefore.pv,
      evalBest: formatEval(deepBefore),
      evalPlayed: deepAfter ? formatEval(deepAfter, true) : new Chess(fens[i + 1]).isCheckmate() ? '#' : '0.0',
      bestWin: best,
      drop: Math.round(drop),
    })
  }
  return puzzles
}

/** Convert a UCI line to SAN from a given position (stops at the first illegal move). */
export function lineToSan(fen: string, uci: string[], max = 6): string[] {
  const chess = new Chess(fen)
  const out: string[] = []
  for (const u of uci.slice(0, max)) {
    try {
      out.push(chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san)
    } catch {
      break
    }
  }
  return out
}
