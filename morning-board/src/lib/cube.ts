import bearoff from '../data/cubePositions.json'
import midgame from '../data/cubeMidgame.json'
import type { CubeAction } from './bearoff.ts'

export type CubeVerdict = CubeAction | 'too-good'

export interface CubePosition {
  /** 'double': you are on roll. 'take': your opponent is on roll and has just doubled. */
  kind: 'double' | 'take'
  /** Checkers on points 1..24 and the bar (index 24), each side counted from its own home. */
  roller: number[]
  opponent: number[]
  cube: 'centered' | 'roller'
  /** Roller's equity for rolling on, and for a doubled game, per unit of the cube before the decision. */
  noDouble: number
  doubleTake: number
  /** Roller's cubeless chances. */
  win: number
  gammon?: number
  loseGammon?: number
  action: CubeVerdict
  /** 'exact': small bearoff solved by full recursion. 'gnubg': judged by GNU Backgammon at 2-ply. */
  source: 'exact' | 'gnubg'
  race: boolean
}

const pad = (side: number[]) => [...side, ...Array<number>(25 - side.length).fill(0)]

export const BEAROFF_POSITIONS: CubePosition[] = (bearoff as Omit<CubePosition, 'source' | 'race'>[]).map((p) => ({
  ...p, roller: pad(p.roller), opponent: pad(p.opponent), source: 'exact', race: true,
}))
export const MIDGAME_POSITIONS: CubePosition[] = (midgame as Omit<CubePosition, 'source'>[]).map((p) => ({ ...p, source: 'gnubg' }))

/** Bearoff positions first, so indices saved before the middle-game set existed still point at the same position. */
export const CUBE_POSITIONS: CubePosition[] = [...BEAROFF_POSITIONS, ...MIDGAME_POSITIONS]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function pick(seed: string, n: number, from: number, size: number, taken: number[]): void {
  const want = taken.length + Math.min(n, size)
  for (let salt = 0; taken.length < want; salt++) {
    const i = from + (hash(`${seed}#${salt}`) % size)
    if (!taken.includes(i)) taken.push(i)
  }
}

/**
 * The same day always deals the same positions, on any device: about two
 * thirds middle-game decisions, the rest exact bearoffs.
 */
export function cubeIndicesForDay(day: string, n: number, bearoffs = BEAROFF_POSITIONS.length, midgames = MIDGAME_POSITIONS.length): number[] {
  const picked: number[] = []
  const fromMidgame = midgames ? Math.ceil((n * 2) / 3) : 0
  pick(`${day}/mid`, fromMidgame, bearoffs, midgames, picked)
  pick(day, n - picked.length, 0, bearoffs, picked)
  return picked
}

export type CubeChoice = CubeVerdict | 'take' | 'pass'

export function cubeChoices(p: CubePosition): { id: CubeChoice; label: string }[] {
  if (p.kind === 'take') {
    return [
      { id: 'take', label: 'Take' },
      { id: 'pass', label: 'Pass' },
    ]
  }
  const choices: { id: CubeChoice; label: string }[] = [
    { id: 'no-double', label: p.source === 'exact' ? 'No double' : 'No double: not good enough yet' },
    { id: 'double-take', label: 'Double, they should take' },
    { id: 'double-pass', label: 'Double, they should pass' },
  ]
  // Without gammons (small bearoffs) a position can never be too good to double.
  if (p.source !== 'exact') choices.push({ id: 'too-good', label: 'No double: too good, play for the gammon' })
  return choices
}

export function correctChoice(p: CubePosition): CubeChoice {
  if (p.kind === 'double') return p.action
  return p.doubleTake <= 1 ? 'take' : 'pass'
}

/** Your equity for each choice, in units of the cube before any double. */
export function choiceEquity(p: CubePosition, c: CubeChoice): number {
  const doubled = Math.min(p.doubleTake, 1) // against correct play a double never earns more than a cash
  switch (c) {
    case 'no-double':
    case 'too-good': return p.noDouble
    case 'double-take':
    case 'double-pass': return doubled
    case 'take': return -p.doubleTake
    case 'pass': return -1
  }
}
