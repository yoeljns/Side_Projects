// The Keith count: Tom Keith's rule of thumb for cube decisions in pure races.
// Definition and thresholds as given in the Backgammon Galore glossary
// (bkgm.com/gloss/lookup.cgi?keith+count):
//
//   Start from the pip count, then add
//     2 for each checker more than 1 on the one-point,
//     1 for each checker more than 1 on the two-point,
//     1 for each checker more than 3 on the three-point,
//     1 for each empty space on points four, five and six.
//   The player on roll then increases their count by one-seventh, rounding down.
//
//   Double if your count exceeds your opponent's by no more than 4,
//   redouble if it exceeds it by no more than 3,
//   take if the doubler's count exceeds yours by at least 2.

export const pipCount = (side: readonly number[]): number => side.reduce((acc, n, i) => acc + (i < 24 ? n * (i + 1) : 0), 0)

/** Keith count before the on-roll adjustment. A side is point counts, index 0 = its 1-point. */
export function keithBase(side: readonly number[]): number {
  let count = pipCount(side)
  count += 2 * Math.max(0, (side[0] ?? 0) - 1)
  count += Math.max(0, (side[1] ?? 0) - 1)
  count += Math.max(0, (side[2] ?? 0) - 3)
  for (const k of [3, 4, 5]) if (!(side[k] > 0)) count += 1
  return count
}

export type KeithVerdict = 'no-double' | 'double-take' | 'double-pass'

export interface KeithCount {
  /** Roller's count including the extra seventh, and the count before it. */
  roller: number
  rollerBase: number
  opponent: number
  /** roller - opponent: the smaller, the better for the roller. */
  difference: number
  verdict: KeithVerdict
}

/** `owned`: the roller already holds the cube, so the question is a redouble. */
export function keithCount(roller: readonly number[], opponent: readonly number[], owned: boolean): KeithCount {
  const rollerBase = keithBase(roller)
  const rollerCount = rollerBase + Math.floor(rollerBase / 7)
  const opponentCount = keithBase(opponent)
  const difference = rollerCount - opponentCount
  const verdict: KeithVerdict = difference > (owned ? 3 : 4) ? 'no-double' : difference >= 2 ? 'double-take' : 'double-pass'
  return { roller: rollerCount, rollerBase, opponent: opponentCount, difference, verdict }
}
