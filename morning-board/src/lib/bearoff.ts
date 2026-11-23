// Exact money-game cube equities for non-contact bearoff positions.
//
// A side's position is six checker counts, index 0 = the 1-point. Because both
// sides have already borne off checkers, gammons are impossible and every
// equity below is exact (no rollouts, no neural net) — computed by full
// recursion over all 21 rolls with optimal checker play for both sides.

export type Side = readonly number[] // length 6
export type Cube = 'centered' | 'roller' | 'opponent' // who may double

const encode = (s: Side): number => s.reduce((acc, n, i) => acc + (n << (4 * i)), 0)
const count = (p: number, i: number): number => (p >> (4 * i)) & 15

export const pips = (s: Side): number => s.reduce((acc, n, i) => acc + n * (i + 1), 0)

function applyDie(p: number, d: number): number[] {
  let highest = 0
  for (let k = 6; k >= 1; k--) if (count(p, k - 1) > 0) { highest = k; break }
  if (highest === 0) return []
  const out: number[] = []
  for (let k = 1; k <= highest; k++) {
    if (count(p, k - 1) === 0) continue
    const lifted = p - (1 << (4 * (k - 1)))
    if (k > d) out.push(lifted + (1 << (4 * (k - d - 1))))
    else if (k === d || k === highest) out.push(lifted) // bear off
  }
  return out
}

// All 21 distinct rolls with their weight out of 36.
const ROLLS: [number, number, number][] = []
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push([a, b, a === b ? 1 : 2])

const succCache = new Map<number, number[][]>()

/** For each of the 21 rolls, the distinct positions reachable (0 = all off). */
function successors(p: number): number[][] {
  let cached = succCache.get(p)
  if (cached) return cached
  cached = ROLLS.map(([a, b]) => {
    const orders = a === b ? [[a, a, a, a]] : [[a, b], [b, a]]
    const finals = new Set<number>()
    for (const dice of orders) {
      let frontier = new Set<number>([p])
      for (const d of dice) {
        const next = new Set<number>()
        for (const q of frontier) {
          if (q === 0) next.add(0)
          else for (const r of applyDie(q, d)) next.add(r)
        }
        frontier = next
      }
      for (const q of frontier) finals.add(q)
    }
    return [...finals]
  })
  succCache.set(p, cached)
  return cached
}

const KEY = 2 ** 24
const memo: Record<Cube | 'cubeless', Map<number, number>> = {
  centered: new Map(),
  roller: new Map(),
  opponent: new Map(),
  cubeless: new Map(),
}
const flip = (c: Cube): Cube => (c === 'centered' ? 'centered' : c === 'roller' ? 'opponent' : 'roller')

/** Equity of rolling now (no double this turn), per unit of the current cube. */
function rollEquity(p: number, o: number, cube: Cube): number {
  let sum = 0
  const rolls = successors(p)
  for (let i = 0; i < rolls.length; i++) {
    let best = -Infinity
    for (const q of rolls[i]) {
      const v = q === 0 ? 1 : -value(o, q, flip(cube))
      if (v > best) best = v
    }
    sum += ROLLS[i][2] * best
  }
  return sum / 36
}

/** Equity for the side on roll with optimal cube action by both sides. */
function value(p: number, o: number, cube: Cube): number {
  const key = p * KEY + o
  const table = memo[cube]
  const hit = table.get(key)
  if (hit !== undefined) return hit
  let v = rollEquity(p, o, cube)
  if (cube !== 'opponent') {
    const doubled = 2 * value(p, o, 'opponent') // after double/take the opponent owns the cube
    v = Math.max(v, Math.min(doubled, 1))
  }
  table.set(key, v)
  return v
}

function winProb(p: number, o: number): number {
  const key = p * KEY + o
  const hit = memo.cubeless.get(key)
  if (hit !== undefined) return hit
  let sum = 0
  const rolls = successors(p)
  for (let i = 0; i < rolls.length; i++) {
    let best = 0
    for (const q of rolls[i]) {
      const v = q === 0 ? 1 : 1 - winProb(o, q)
      if (v > best) best = v
    }
    sum += ROLLS[i][2] * best
  }
  const v = sum / 36
  memo.cubeless.set(key, v)
  return v
}

export type CubeAction = 'no-double' | 'double-take' | 'double-pass'

export interface CubeAnalysis {
  /** Roller's equity if they just roll. */
  noDouble: number
  /** Roller's equity if they double and it is taken (in units of the old cube). */
  doubleTake: number
  /** Roller's cubeless chance of winning the game. */
  win: number
  action: CubeAction
}

/** Analyse a position where `roller` is on roll and has access to the cube. */
export function analyseCube(roller: Side, opponent: Side, cube: 'centered' | 'roller'): CubeAnalysis {
  const p = encode(roller)
  const o = encode(opponent)
  if (p === 0 || o === 0) throw new Error('both sides need at least one checker')
  const noDouble = rollEquity(p, o, cube)
  const doubleTake = 2 * value(p, o, 'opponent')
  const action: CubeAction =
    noDouble >= Math.min(doubleTake, 1) ? 'no-double' : doubleTake <= 1 ? 'double-take' : 'double-pass'
  return { noDouble, doubleTake, win: winProb(p, o), action }
}
