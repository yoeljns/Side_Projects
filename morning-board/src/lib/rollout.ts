// Monte Carlo rollouts for NON-CONTACT positions (races and bearoffs).
//
// A rollout plays the position out many times with random dice and counts who
// wins. Both sides follow the same simple racing policy below, so the result is
// only as good as that policy: fine for races, where good play is mostly
// mechanical, and deliberately not offered for contact positions, where a
// simple policy would mislead.
//
// A side is 24 point counts, index 0 = its own 1-point (any 25th "bar" entry
// must be empty). Everything is seeded, so the same call gives the same answer.

export interface RolloutResult {
  trials: number
  wins: number
  /** Roller's cubeless chance of winning. */
  win: number
  /** Share of all games the roller wins / loses as a gammon. */
  gammon: number
  loseGammon: number
  /** Standard error of `win`. */
  standardError: number
}

export interface RolloutTally { trials: number; wins: number; gammons: number; gammonLosses: number }

/** Can this position be rolled out? Only when no checker still has to pass an enemy checker. */
export function isRace(roller: readonly number[], opponent: readonly number[]): boolean {
  if ((roller[24] ?? 0) > 0 || (opponent[24] ?? 0) > 0) return false
  const back = highest(roller)
  const oppBack = highest(opponent)
  return back > 0 && oppBack > 0 && back + oppBack <= 24
}

export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function highest(b: readonly number[]): number {
  for (let k = 23; k >= 0; k--) if (b[k] > 0) return k + 1
  return 0
}

/**
 * How awkward a position is for the same pip count: lower is better. Home-board
 * terms follow the usual wastage rules of thumb (stacks on the low points and
 * gaps on the high ones waste pips); outside the home board, every quadrant a
 * checker still has to cross costs tempo.
 */
function awkwardness(b: readonly number[]): number {
  let score = 0
  let outside = 0
  for (let k = 6; k < 24; k++) {
    if (b[k] > 0) {
      outside += b[k]
      score += b[k] * Math.ceil((k - 5) / 6) * 1.5
    }
  }
  if (b[0] > 1) score += 2 * (b[0] - 1)
  if (b[1] > 1) score += b[1] - 1
  if (b[2] > 3) score += b[2] - 3
  if (outside === 0) for (let k = 3; k < 6; k++) if (b[k] === 0) score += 1
  return score
}

/** Play one die in place. Returns false when there is nothing left to move. */
function playDie(b: number[], d: number): boolean {
  const hi = highest(b)
  if (hi === 0) return false
  if (hi <= 6) {
    if (b[d - 1] > 0) { b[d - 1]--; return true } // bear off exactly
    if (hi < d) { b[hi - 1]--; return true } // bear off from the highest point
  }
  // Otherwise move a checker d pips: try every source and keep the tidiest result.
  // While checkers are still outside the home board, those are the ones to move.
  const from = hi > 6 ? 7 : d + 1
  let best = -1
  let bestScore = Infinity
  for (let k = Math.max(from, d + 1); k <= hi; k++) {
    if (b[k - 1] === 0) continue
    b[k - 1]--; b[k - d - 1]++
    const s = awkwardness(b)
    b[k - 1]++; b[k - d - 1]--
    if (s < bestScore) { bestScore = s; best = k }
  }
  if (best < 0) {
    // Every outside checker is closer than d to the edge of the board (cannot happen: k > 6 >= d), or
    // only home checkers below the die remain while others are outside: move the rearmost legal checker.
    for (let k = hi; k > d; k--) if (b[k - 1] > 0) { best = k; break }
    if (best < 0) return true // no legal move with this die
  }
  b[best - 1]--; b[best - d - 1]++
  return true
}

function total(b: readonly number[]): number {
  let n = 0
  for (let k = 0; k < 24; k++) n += b[k]
  return n
}

/** Play a whole roll in place, trying both orders of a non-double and keeping the better result. */
export function playRoll(b: number[], d1: number, d2: number): void {
  if (d1 === d2) {
    for (let i = 0; i < 4; i++) if (!playDie(b, d1)) return
    return
  }
  const alt = b.slice()
  playDie(b, d1); playDie(b, d2)
  playDie(alt, d2); playDie(alt, d1)
  const score = (x: number[]) => total(x) * 100 + awkwardness(x)
  if (score(alt) < score(b)) for (let k = 0; k < 24; k++) b[k] = alt[k]
}

/** Play `trials` games from the position (roller to move) and add them to a tally. */
export function rolloutInto(tally: RolloutTally, roller: readonly number[], opponent: readonly number[], trials: number, rng: () => number): RolloutTally {
  const startA = Array.from({ length: 24 }, (_, i) => roller[i] ?? 0)
  const startB = Array.from({ length: 24 }, (_, i) => opponent[i] ?? 0)
  const a = startA.slice()
  const b = startB.slice()
  const die = () => 1 + Math.floor(rng() * 6)
  for (let t = 0; t < trials; t++) {
    for (let k = 0; k < 24; k++) { a[k] = startA[k]; b[k] = startB[k] }
    for (;;) {
      playRoll(a, die(), die())
      if (total(a) === 0) {
        tally.wins++
        if (total(b) === 15) tally.gammons++
        break
      }
      playRoll(b, die(), die())
      if (total(b) === 0) {
        if (total(a) === 15) tally.gammonLosses++
        break
      }
    }
    tally.trials++
  }
  return tally
}

export function summarise(t: RolloutTally): RolloutResult {
  const win = t.trials ? t.wins / t.trials : 0
  return {
    trials: t.trials,
    wins: t.wins,
    win,
    gammon: t.trials ? t.gammons / t.trials : 0,
    loseGammon: t.trials ? t.gammonLosses / t.trials : 0,
    standardError: t.trials ? Math.sqrt((win * (1 - win)) / t.trials) : 0,
  }
}

/** Roll a non-contact position out. Throws on contact positions. */
export function rollout(roller: readonly number[], opponent: readonly number[], trials: number, seed = 1): RolloutResult {
  if (!isRace(roller, opponent)) throw new Error('rollouts are only offered for non-contact positions')
  return summarise(rolloutInto({ trials: 0, wins: 0, gammons: 0, gammonLosses: 0 }, roller, opponent, trials, mulberry32(seed)))
}
