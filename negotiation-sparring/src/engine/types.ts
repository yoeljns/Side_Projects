export type FamilyId = 'supplier' | 'dealer' | 'distribution' | 'rate';
export type Difficulty = 'easy' | 'medium' | 'hard';
/** Side 'a' is the buying side of each family, 'b' the selling side. */
export type Side = 'a' | 'b';

/** Everything needed to rebuild a scenario, hidden side included. */
export interface ScenarioRef {
  family: FamilyId;
  seed: number;
  difficulty: Difficulty;
  /** The side the player takes. */
  role: Side;
}

export interface Option {
  value: number;
  label: string;
}

export interface Issue {
  id: string;
  label: string;
  /** Options in ascending order of `value`. */
  options: Option[];
}

/** One option index per issue id. */
export type Offer = Record<string, number>;

export interface SideProfile {
  roleLabel: string;
  /** Per issue, summing to 1. */
  weights: Record<string, number>;
  /** Per issue, the worth of each option on a 0..1 scale (1 = this side's best). */
  values: Record<string, number[]>;
  /** Reservation utility on the 0..100 scale: what walking away is worth. */
  batna: number;
  batnaStory: string;
  /** Per-round discount factor, used by the Rubinstein benchmark. */
  discount: number;
}

export interface HardCap {
  issue: string;
  /** Inclusive range of option indices the counterpart can sign. */
  min: number;
  max: number;
  story: string;
}

export interface Hidden {
  hardCap: HardCap;
  /** From this round on the counterpart concedes faster. */
  deadlineRound: number;
  /** The counterpart's final offer comes in this round; one round later it walks. */
  maxRounds: number;
  /** Share of its range (opening aspiration down to reservation) it gives up by the final round. */
  finalConcession: number;
  /** The issue the counterpart barely cares about. */
  cheapIssue: string;
  deadlineStory: string;
  tone: 'brisk' | 'warm' | 'formal' | 'blunt';
}

export interface Scenario {
  ref: ScenarioRef;
  title: string;
  /** What both sides know. */
  setting: string;
  issues: Issue[];
  player: SideProfile;
  counterpart: SideProfile;
  hidden: Hidden;
  currency: string;
  /** Money value of the player's whole 0..100 utility range. */
  stake: number;
  /** The issue used for the single-issue price view. */
  priceIssue: string;
}

export type Action = 'offer' | 'message' | 'accept' | 'walk';

export interface Turn {
  by: 'player' | 'counterpart';
  /** 1-based; a round is one player turn plus the reply. */
  round: number;
  action: Action;
  text: string;
  offer?: Offer;
  /** Counterpart turns only: who wrote the reply. */
  source?: 'ai' | 'scripted';
}

export interface Point {
  /** Player utility. */
  p: number;
  /** Counterpart utility. */
  c: number;
}

export interface Outcome extends Point {
  offer: Offer;
}
