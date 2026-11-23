/** Generations simulated for the evolution view. */
export const EVOLUTION_GENERATIONS = 200;

/**
 * Ecological tournament in the style of Axelrod's second analysis (discrete replicator dynamics).
 * Everyone starts with an equal share. Each generation a strategy's fitness is its average payoff
 * against the current population mix, and its share grows in proportion to that fitness.
 * payoff[i][j] is i's average payoff per round against j. If any payoff is negative, all payoffs
 * are shifted so the lowest is zero, because shares cannot grow by a negative factor.
 * Returns shares[generation][strategy], generation 0 being the equal split.
 */
export function replicator(payoff: number[][], generations: number = EVOLUTION_GENERATIONS): number[][] {
  const n = payoff.length;
  const shift = Math.min(0, ...payoff.flat());
  let x: number[] = new Array(n).fill(1 / n);
  const out = [x];
  for (let g = 0; g < generations; g++) {
    const fitness = payoff.map((row) => row.reduce((s, v, j) => s + (v - shift) * x[j], 0));
    const mean = fitness.reduce((s, f, i) => s + f * x[i], 0);
    if (mean > 0) x = x.map((xi, i) => (xi * fitness[i]) / mean);
    out.push(x);
  }
  return out;
}
