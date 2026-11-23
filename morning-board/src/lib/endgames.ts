import data from '../data/endgames.json'
import type { Puzzle } from './analysis.ts'

interface Study {
  fen: string
  goal: 'win' | 'draw'
  bestUci: string
  pv: string[]
  bestWin: number
}

/** Pawn endgames where exactly one king move holds the result (see scripts/gen-endgames.mjs). */
export const ENDGAMES = data as Study[]

/** Present a study position in the same shape as a puzzle from your games. */
export function studyPuzzle(index: number): Puzzle {
  const s = ENDGAMES[index]
  return {
    id: `eg:${index}`,
    kind: 'study',
    phase: 'endgame',
    goal: s.goal,
    gameId: '', gameUrl: '', opponent: '', speed: '', playedAt: 0, moveNumber: 0, playedSan: '', playedUci: '', drop: 0,
    fen: s.fen,
    color: s.fen.split(' ')[1] as 'w' | 'b',
    bestUci: s.bestUci,
    pv: s.pv,
    evalBest: s.goal === 'win' ? 'winning' : 'a draw',
    evalPlayed: '',
    bestWin: s.bestWin,
  }
}
