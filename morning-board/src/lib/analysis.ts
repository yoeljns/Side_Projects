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

/**
 * avoid:  the position before your blunder; find the move you should have played.
 * punish: the position after your blunder; switch sides and find the refutation.
 *         Used when the position before had several good moves, so "find the
 *         best move" would be a guessing game.
 * study:  a theoretical endgame from the built-in set.
 */
export type PuzzleKind = 'avoid' | 'punish' | 'study'

export interface Puzzle {
  id: string
  kind: PuzzleKind
  phase: 'middlegame' | 'endgame'
  gameId: string
  gameUrl: string
  opponent: string
  speed: string
  playedAt: number
  /** The position to solve. */
  fen: string
  /** The side you play in the puzzle. */
  color: 'w' | 'b'
  moveNumber: number
  /** Your blunder in the game, in SAN and UCI. */
  playedSan: string
  playedUci: string
  /** punish: what your opponent actually answered. */
  repliedSan?: string
  /** study: what the side to move is playing for. */
  goal?: 'win' | 'draw'
  /** Engine's choice and its line, UCI. */
  bestUci: string
  pv: string[]
  /** Evaluations from the solver's point of view: with best play, and after the game move. */
  evalBest: string
  evalPlayed: string
  /** The solver's win percentage after the engine's move (used to accept equally good answers). */
  bestWin: number
  /** Win-percentage points the blunder gave away. */
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
  /** If the runner-up move is within this many win-% points of the best, there is no single best move. */
  alternativeMargin: number
}

export const DEFAULT_SCAN: ScanOptions = { scanDepth: 12, verifyDepth: 16, threshold: 20, skipMoves: 6, alternativeMargin: 8 }

type Evaluate = (fen: string, depth: number, withSecond?: boolean) => Promise<Evaluation>

const isOver = (fen: string) => new Chess(fen).isGameOver()

/** Few pieces left: no queens and at most six other pieces, or at most four pieces of any kind. */
export function phaseOf(fen: string): 'middlegame' | 'endgame' {
  const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').replace(/[kKpP]/g, '')
  const queens = pieces.replace(/[^qQ]/g, '').length
  return pieces.length <= 4 || (queens === 0 && pieces.length <= 6) ? 'endgame' : 'middlegame'
}

export interface ScanResult {
  puzzles: Puzzle[]
  /** How many of your moves were checked, for the blunder rate. */
  movesChecked: number
}

/**
 * Replay a game and return the moments where the user threw away a playable
 * position. `evaluate` is injected so this stays testable without the engine.
 */
export async function findBlunders(game: Game, evaluate: Evaluate, opts: ScanOptions = DEFAULT_SCAN): Promise<ScanResult> {
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
  const evalAt = async (i: number, depth: number, withSecond = false): Promise<Evaluation | null> => {
    if (isOver(fens[i])) return null
    return evaluate(fens[i], depth, withSecond)
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
  let movesChecked = 0
  for (let i = firstPly; i < moves.length; i++) {
    if (moves[i].color !== game.userColor) continue
    movesChecked++
    const before = await scan(i)
    if (!before) continue
    const beforeWin = winPercent(before)
    // Only positions that were still worth playing: not lost, not trivially won either way.
    if (beforeWin < 30) continue
    const after = await scan(i + 1)
    if (beforeWin - afterWin(fens[i + 1], after) < opts.threshold) continue
    if (before.best === moves[i].uci) continue

    // Candidate: confirm at higher depth so shallow-search noise does not become a puzzle.
    const deepBefore = await evalAt(i, opts.verifyDepth, true)
    const deepAfter = await evalAt(i + 1, opts.verifyDepth)
    if (!deepBefore || deepBefore.best === moves[i].uci) continue
    const best = winPercent(deepBefore)
    const played = afterWin(fens[i + 1], deepAfter)
    const drop = best - played
    if (best < 30 || drop < opts.threshold) continue

    const common = {
      gameId: game.id,
      gameUrl: game.url,
      opponent: game.opponent,
      speed: game.speed,
      playedAt: game.playedAt,
      moveNumber: Math.floor(i / 2) + 1,
      playedSan: moves[i].san,
      playedUci: moves[i].uci,
      drop: Math.round(drop),
    }
    const severalGoodMoves = deepBefore.second !== undefined && best - winPercent(deepBefore.second) <= opts.alternativeMargin
    if (severalGoodMoves && deepAfter) {
      puzzles.push({
        ...common,
        id: `${game.id}:${i}:punish`,
        kind: 'punish',
        phase: phaseOf(fens[i + 1]),
        fen: fens[i + 1],
        color: game.userColor === 'w' ? 'b' : 'w',
        repliedSan: moves[i + 1]?.san,
        bestUci: deepAfter.best,
        pv: deepAfter.pv,
        evalBest: formatEval(deepAfter),
        evalPlayed: formatEval(deepBefore, true),
        bestWin: winPercent(deepAfter),
      })
    } else {
      puzzles.push({
        ...common,
        id: `${game.id}:${i}`,
        kind: 'avoid',
        phase: phaseOf(fens[i]),
        fen: fens[i],
        color: game.userColor,
        bestUci: deepBefore.best,
        pv: deepBefore.pv,
        evalBest: formatEval(deepBefore),
        evalPlayed: deepAfter ? formatEval(deepAfter, true) : new Chess(fens[i + 1]).isCheckmate() ? '#' : '0.0',
        bestWin: best,
      })
    }
  }
  return { puzzles, movesChecked }
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
