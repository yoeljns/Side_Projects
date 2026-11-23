// Runs a rollout off the main thread, reporting progress after every chunk.
import { mulberry32, rolloutInto, type RolloutTally } from './rollout.ts'

export interface RolloutRequest { roller: number[]; opponent: number[]; trials: number; seed: number }
export interface RolloutUpdate { tally: RolloutTally; done: boolean }

const CHUNK = 1000

self.onmessage = (e: MessageEvent<RolloutRequest>) => {
  const { roller, opponent, trials, seed } = e.data
  const rng = mulberry32(seed)
  const tally: RolloutTally = { trials: 0, wins: 0, gammons: 0, gammonLosses: 0 }
  while (tally.trials < trials) {
    rolloutInto(tally, roller, opponent, Math.min(CHUNK, trials - tally.trials), rng)
    self.postMessage({ tally: { ...tally }, done: tally.trials >= trials } satisfies RolloutUpdate)
  }
}
