import positions from '../data/cubePositions.json'
import type { CubeAction } from './bearoff.ts'

export interface CubePosition {
  /** 'double': you are on roll. 'take': your opponent is on roll and has just doubled. */
  kind: 'double' | 'take'
  roller: number[]
  opponent: number[]
  cube: 'centered' | 'roller'
  noDouble: number
  doubleTake: number
  win: number
  action: CubeAction
}

export const CUBE_POSITIONS = positions as CubePosition[]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The same day always deals the same positions, on any device. */
export function cubeIndicesForDay(day: string, n: number, total = CUBE_POSITIONS.length): number[] {
  const picked: number[] = []
  for (let salt = 0; picked.length < Math.min(n, total); salt++) {
    const i = hash(`${day}#${salt}`) % total
    if (!picked.includes(i)) picked.push(i)
  }
  return picked
}

export type CubeChoice = CubeAction | 'take' | 'pass'

export function cubeChoices(p: CubePosition): { id: CubeChoice; label: string }[] {
  return p.kind === 'double'
    ? [
        { id: 'no-double', label: 'No double' },
        { id: 'double-take', label: 'Double, they should take' },
        { id: 'double-pass', label: 'Double, they should pass' },
      ]
    : [
        { id: 'take', label: 'Take' },
        { id: 'pass', label: 'Pass' },
      ]
}

export function correctChoice(p: CubePosition): CubeChoice {
  if (p.kind === 'double') return p.action
  return p.doubleTake <= 1 ? 'take' : 'pass'
}

/** Your equity for each choice, in units of the cube before any double. */
export function choiceEquity(p: CubePosition, c: CubeChoice): number {
  const doubled = Math.min(p.doubleTake, 1) // against correct play a double never earns more than a cash
  switch (c) {
    case 'no-double': return p.noDouble
    case 'double-take':
    case 'double-pass': return doubled
    case 'take': return -p.doubleTake
    case 'pass': return -1
  }
}
