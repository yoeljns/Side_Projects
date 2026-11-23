import { describe, expect, it } from 'vitest'
import { BEAROFF_POSITIONS, MIDGAME_POSITIONS } from './cube.ts'
import { keithBase, keithCount, pipCount } from './raceCount.ts'
import { isRace, playRoll, rollout } from './rollout.ts'
import { tavlaLine, tavlaValue } from './tavla.ts'

const side = (points: Record<number, number>): number[] => {
  const s = Array<number>(25).fill(0)
  for (const [k, n] of Object.entries(points)) s[Number(k) - 1] = n
  return s
}

describe('rollout', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const p = BEAROFF_POSITIONS[3]
    expect(rollout(p.roller, p.opponent, 2000, 5)).toEqual(rollout(p.roller, p.opponent, 2000, 5))
    expect(rollout(p.roller, p.opponent, 2000, 5).wins).not.toBe(rollout(p.roller, p.opponent, 2000, 6).wins)
  })
  it('gets the simplest last-roll position right', () => {
    // One checker on the 6-point comes off with 27 of 36 rolls; the opponent is off next turn.
    const r = rollout(side({ 6: 1 }), side({ 1: 1 }), 40000, 1)
    expect(r.win).toBeCloseTo(0.75, 2)
    expect(r.standardError).toBeLessThan(0.003)
    expect(r.gammon).toBe(0)
  })
  it('agrees with the exact bearoff answers', () => {
    // Measured over all 225 positions at 40,000 trials: mean error 0.4 points, worst 3.8.
    // The worst cases are tiny bearoffs where perfect play depends on the opponent's position.
    const sample = BEAROFF_POSITIONS.filter((_, i) => i % 5 === 0)
    const errors = sample.map((p, i) => Math.abs(rollout(p.roller, p.opponent, 8000, i + 1).win - p.win))
    expect(errors.reduce((a, b) => a + b) / errors.length).toBeLessThan(0.012)
    expect(Math.max(...errors)).toBeLessThan(0.06)
  })
  it('agrees with GNU Backgammon on the race positions', () => {
    // Measured at 40,000 trials: every race position within 0.8 points of gnubg.
    const races = MIDGAME_POSITIONS.filter((p) => p.race)
    expect(races.length).toBeGreaterThan(0)
    for (const p of races) expect(Math.abs(rollout(p.roller, p.opponent, 20000, 7).win - p.win)).toBeLessThan(0.025)
  })
  it('refuses contact positions', () => {
    const contact = MIDGAME_POSITIONS.find((p) => !p.race)!
    expect(isRace(contact.roller, contact.opponent)).toBe(false)
    expect(() => rollout(contact.roller, contact.opponent, 10)).toThrow()
    for (const p of MIDGAME_POSITIONS) expect(isRace(p.roller, p.opponent)).toBe(p.race)
  })
  it('counts gammons when the loser has borne nothing off', () => {
    // Fifteen checkers deep in the outfield against one checker on the ace point.
    const r = rollout(side({ 1: 1 }), side({ 12: 15 }), 200, 3)
    expect(r.win).toBe(1)
    expect(r.gammon).toBe(1)
  })
  it('plays rolls legally: bears off exactly, and from the highest point with a bigger die', () => {
    const exact = side({ 6: 1, 3: 1 })
    playRoll(exact, 6, 3)
    expect(pipCount(exact)).toBe(0)
    const big = side({ 4: 2, 2: 1 })
    playRoll(big, 6, 5) // both dice are bigger than the highest point
    expect(big.slice(0, 6)).toEqual([0, 1, 0, 0, 0, 0])
    const outside = side({ 8: 1, 5: 1 })
    playRoll(outside, 2, 1) // nothing may be borne off while a checker is outside
    expect(outside.reduce((a, n) => a + n, 0)).toBe(2)
    expect(pipCount(outside)).toBe(10)
    const dbl = side({ 6: 2, 5: 2 })
    playRoll(dbl, 6, 6) // two sixes bear off the 6-point, the other two the 5-point
    expect(pipCount(dbl)).toBe(0)
  })
})

describe('Keith count', () => {
  it('matches a hand-worked example', () => {
    // 3 on the ace, 2 on the deuce, 4 on the three, none on the four, 1 on the five, 2 on the six.
    const s = side({ 1: 3, 2: 2, 3: 4, 5: 1, 6: 2 })
    expect(pipCount(s)).toBe(36)
    // +4 (two extra on the ace) +1 (one extra on the deuce) +1 (fourth on the three) +1 (gap on the four)
    expect(keithBase(s)).toBe(43)
    // on roll: 43 + floor(43 / 7) = 49
    expect(keithCount(s, s, false)).toMatchObject({ roller: 49, rollerBase: 43, opponent: 43, difference: 6, verdict: 'no-double' })
  })
  it('applies the double, redouble and take thresholds', () => {
    const even = side({ 6: 5, 5: 5, 4: 5 }) // 75 pips, no adjustments: 85 on roll
    const behind = (extra: number) => { const s = even.slice(); s[5 + extra] = 1; s[5]--; return s } // opponent `extra` pips worse
    expect(keithBase(even)).toBe(75)
    expect(keithCount(even, even, false).difference).toBe(10)
    // opponent 6 pips worse: difference 4, a double but not a redouble
    expect(keithCount(even, behind(6), false).verdict).toBe('double-take')
    expect(keithCount(even, behind(6), true).verdict).toBe('no-double')
    expect(keithCount(even, behind(7), true).verdict).toBe('double-take')
    // difference 2 is still a take, 1 is a pass
    expect(keithCount(even, behind(8), false).verdict).toBe('double-take')
    expect(keithCount(even, behind(9), false).verdict).toBe('double-pass')
  })
})

describe('tavla', () => {
  it('scores a mars as two and has no cube', () => {
    expect(tavlaValue(0.5).points).toBeCloseTo(0)
    // 70% wins of which 20 points of gammons, 5% gammon losses: 0.7 + 0.2 - 0.3 - 0.05
    const v = tavlaValue(0.7, 0.2, 0.05)
    expect(v.points).toBeCloseTo(0.55)
    expect(tavlaLine(v)).toContain('+0.55')
    expect(tavlaLine(v)).toContain('mars')
    expect(tavlaLine(tavlaValue(0.4))).toContain('−0.20')
  })
})
