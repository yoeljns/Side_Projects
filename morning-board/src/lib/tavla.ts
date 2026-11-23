// Tavla, the Turkish game, has no doubling cube: you simply play every game to
// the end. A plain win scores 1 and a gammon ("mars") scores 2; there is no
// triple game. So a cube position translates into one number: how many points
// the position is worth per game.

export interface TavlaValue {
  /** Expected points per game for the side whose chances were passed in. */
  points: number
  win: number
  mars: number
  loseMars: number
}

/**
 * `win` is the chance of winning the game (gammons included), `mars` the chance
 * of winning a gammon, `loseMars` the chance of losing one.
 */
export function tavlaValue(win: number, mars = 0, loseMars = 0): TavlaValue {
  return { points: win + mars - (1 - win) - loseMars, win, mars, loseMars }
}

export function tavlaLine(v: TavlaValue): string {
  const sign = v.points >= 0 ? '+' : '−'
  const mars = v.mars >= 0.005 || v.loseMars >= 0.005 ? ' (a mars counts 2)' : ''
  return `In tavla there is no cube and no decision here: you play on, and the position is worth about ${sign}${Math.abs(v.points).toFixed(2)} points a game to you${mars}.`
}
