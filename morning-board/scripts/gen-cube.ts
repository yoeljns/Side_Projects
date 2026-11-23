// Generates src/data/cubePositions.json: bearoff cube decisions with exact answers.
// Run: npm run gen:cube
import { writeFileSync } from 'node:fs'
import { analyseCube } from '../src/lib/bearoff.ts'

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20261123)
const int = (n: number) => Math.floor(rnd() * n)

function randomSide(): number[] {
  const side = [0, 0, 0, 0, 0, 0]
  const checkers = 2 + int(6) // 2..7
  const top = 3 + int(4) // highest point used: 3..6
  for (let i = 0; i < checkers; i++) side[int(top)]++
  return side
}

const round = (x: number) => Math.round(x * 10000) / 10000
const out: object[] = []
const seen = new Set<string>()
const quota: Record<string, number> = {}
const PER_BUCKET = 45

for (let tries = 0; tries < 400000 && out.length < PER_BUCKET * 5; tries++) {
  const roller = randomSide()
  const opponent = randomSide()
  const cube = rnd() < 0.6 ? 'centered' : 'roller'
  const sig = `${roller}|${opponent}|${cube}`
  if (seen.has(sig)) continue
  seen.add(sig)
  const a = analyseCube(roller, opponent, cube)
  const doubleGap = Math.abs(a.noDouble - Math.min(a.doubleTake, 1))
  const takeGap = Math.abs(a.doubleTake - 1)
  // Two question kinds: "should you double?" (you are the roller) and
  // "you were doubled — take or pass?" (you are the opponent).
  let kind: 'double' | 'take' | null = null
  if (a.action !== 'no-double' && takeGap >= 0.01 && takeGap <= 0.3 && rnd() < 0.5) kind = 'take'
  else if (doubleGap >= 0.008 && doubleGap <= 0.25) kind = 'double'
  if (!kind) continue
  const bucket = `${kind}:${a.action}`
  if ((quota[bucket] ?? 0) >= PER_BUCKET) continue
  quota[bucket] = (quota[bucket] ?? 0) + 1
  out.push({
    kind, roller, opponent, cube,
    noDouble: round(a.noDouble), doubleTake: round(a.doubleTake), win: round(a.win), action: a.action,
  })
}
console.log(quota, out.length)
writeFileSync(new URL('../src/data/cubePositions.json', import.meta.url), JSON.stringify(out).replace(/\},\{/g, '},\n{') + '\n')
