export type Tone = 'good' | 'bad' | 'neutral';

/** What one player did in one round, in a form any arena can display. */
export interface Side {
  label: string;
  payoff: number;
  tone: Tone;
}

export interface RoundRecord {
  a: Side;
  b: Side;
  note?: string;
}

export interface MatchPlay {
  rounds: RoundRecord[];
  scoreA: number;
  scoreB: number;
}

export interface StrategyInfo {
  id: string;
  name: string;
  blurb: string;
}

export const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
