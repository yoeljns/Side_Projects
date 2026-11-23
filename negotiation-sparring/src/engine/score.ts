import { benchmarks, type Benchmarks } from './benchmarks.js';
import { proposal, reciprocity } from './counterpart.js';
import type { Difficulty, FamilyId, Offer, Outcome, Scenario, Side, Turn } from './types.js';
import { counterpartUtility, feasibleOutcomes, formatMoney, playerUtility, pointsToMoney } from './utility.js';

export type SessionOutcome = 'deal' | 'player-walked' | 'counterpart-walked';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface Change {
  issue: string;
  label: string;
  from: string;
  to: string;
}

export interface LeftOnTable {
  better: Outcome;
  /** The most both sides together could have gained over the deal, by any package. */
  joint: number;
  /** Points each side would have gained from the named trade. */
  player: number;
  counterpart: number;
  changes: Change[];
}

export interface WastedConcession {
  round: number;
  label: string;
  /** Points the player gave up, and points the counterpart gained from it. */
  cost: number;
  gain: number;
}

export interface ProcessNotes {
  rounds: number;
  firstAnchor: 'player' | 'counterpart' | null;
  /** Fall in the player's own utility between consecutive player offers, by round of the later offer. */
  playerConcessions: { round: number; points: number }[];
  /** Fall in the counterpart's own utility between its consecutive offers. */
  counterpartConcessions: { round: number; points: number }[];
  playerTotal: number;
  counterpartTotal: number;
  wasted: WastedConcession[];
  /** Counterpart replies written by the script, and all counterpart replies. */
  scriptedReplies: number;
  replies: number;
}

export interface Score {
  outcome: SessionOutcome;
  zopaExists: boolean;
  deal: Outcome | null;
  /** Headline number: 100 means the player did as well as the Nash solution. -100..150. */
  score: number;
  grade: Grade;
  headline: string;
  /** Player's utility over BATNA (negative for a deal worse than walking; 0 with no deal). */
  surplus: number;
  /** Surplus as a share of the Nash surplus. Null when no deal was possible or none was made. */
  nashShare: number | null;
  /** Player's share of the surplus both sides got from the deal. Null unless both gained. */
  surplusShare: number | null;
  leftOnTable: LeftOnTable | null;
  process: ProcessNotes;
  lessons: string[];
  bench: Benchmarks;
}

export function gradeOf(score: number): Grade {
  if (score >= 95) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return score >= 0 ? 'E' : 'F';
}

export function sessionOutcome(log: Turn[]): { outcome: SessionOutcome; deal: Offer | null } | null {
  const last = log[log.length - 1];
  if (!last) return null;
  if (last.action === 'accept' && last.offer) return { outcome: 'deal', deal: last.offer };
  if (last.action === 'walk') return { outcome: last.by === 'player' ? 'player-walked' : 'counterpart-walked', deal: null };
  return null;
}

function changes(sc: Scenario, from: Offer, to: Offer): Change[] {
  return sc.issues
    .filter((i) => from[i.id] !== to[i.id])
    .map((i) => ({ issue: i.id, label: i.label, from: i.options[from[i.id]].label, to: i.options[to[i.id]].label }));
}

/**
 * Deals that would have left both sides better off than the one signed. The named
 * trade is the best one that changes the fewest issues, since that is the one a person
 * can act on; `joint` is the largest combined gain over all of them.
 */
export function leftOnTable(sc: Scenario, deal: Outcome): LeftOnTable | null {
  const better = feasibleOutcomes(sc).filter((o) => o.p >= deal.p + 0.5 && o.c >= deal.c + 0.5);
  if (!better.length) return null;
  const size = (o: Outcome) => sc.issues.filter((i) => o.offer[i.id] !== deal.offer[i.id]).length;
  const gain = (o: Outcome) => o.p + o.c - deal.p - deal.c;
  const fewest = Math.min(...better.map(size));
  const best = better.filter((o) => size(o) === fewest).reduce((x, y) => (gain(y) > gain(x) ? y : x));
  return {
    better: best,
    joint: Math.max(...better.map(gain)),
    player: best.p - deal.p,
    counterpart: best.c - deal.c,
    changes: changes(sc, deal.offer, best.offer),
  };
}

export function processNotes(sc: Scenario, log: Turn[]): ProcessNotes {
  const offers = (by: Turn['by']) => log.filter((t) => t.by === by && t.action === 'offer' && t.offer);
  const mine = offers('player');
  const theirs = offers('counterpart');
  const first = log.find((t) => t.action === 'offer' && t.offer);
  const playerConcessions = mine.slice(1).map((t, k) => ({ round: t.round, points: playerUtility(sc, mine[k].offer!) - playerUtility(sc, t.offer!) }));
  const counterpartConcessions = theirs
    .slice(1)
    .map((t, k) => ({ round: t.round, points: counterpartUtility(sc, theirs[k].offer!) - counterpartUtility(sc, t.offer!) }));
  const wasted: WastedConcession[] = [];
  mine.slice(1).forEach((t, k) => {
    for (const i of sc.issues) {
      const [a, b] = [mine[k].offer![i.id], t.offer![i.id]];
      const cost = 100 * sc.player.weights[i.id] * (sc.player.values[i.id][a] - sc.player.values[i.id][b]);
      const gain = 100 * sc.counterpart.weights[i.id] * (sc.counterpart.values[i.id][b] - sc.counterpart.values[i.id][a]);
      if (cost >= 1 && gain < 0.3 * cost) wasted.push({ round: t.round, label: i.label, cost, gain });
    }
  });
  const replies = log.filter((t) => t.by === 'counterpart');
  const sum = (xs: { points: number }[]) => xs.reduce((s, x) => s + x.points, 0);
  return {
    rounds: log.filter((t) => t.by === 'player').length,
    firstAnchor: first ? first.by : null,
    playerConcessions,
    counterpartConcessions,
    playerTotal: sum(playerConcessions),
    counterpartTotal: sum(counterpartConcessions),
    wasted,
    scriptedReplies: replies.filter((t) => t.source !== 'ai').length,
    replies: replies.length,
  };
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
const pts = (x: number) => `${Math.abs(x) < 10 ? x.toFixed(1) : x.toFixed(0)} points`;

function lessons(sc: Scenario, log: Turn[], s: Omit<Score, 'lessons'>): string[] {
  const out: string[] = [];
  const cash = (points: number) => formatMoney(sc, pointsToMoney(sc, points));
  const { bench, process: proc, deal } = s;
  const label = (id: string) => sc.issues.find((i) => i.id === id)!.label;
  const theirOffers = log.filter((t) => t.by === 'counterpart' && t.offer);

  if (!s.zopaExists) {
    out.push(
      deal
        ? `No deal on these issues could beat both sides' alternatives. Signing left you ${cash(-s.surplus)} worse off than walking away.`
        : `There was no zone of agreement: their alternative was worth more to them than any deal you could afford. ${s.outcome === 'player-walked' ? 'Walking away was the right call.' : 'Ending without a deal was the right result.'}`,
    );
  } else if (!deal && bench.nash) {
    out.push(`A deal was there to be done. The Nash deal would have been worth ${cash(bench.nash.p - sc.player.batna)} more to you than your alternative.`);
    const best = theirOffers.reduce<number | null>((m, t) => Math.max(m ?? -Infinity, playerUtility(sc, t.offer!)), null);
    if (best !== null && best > sc.player.batna) {
      out.push(`Their best offer was already worth ${cash(best - sc.player.batna)} more than your alternative. Turning down a deal that beats your alternative only pays if a better one follows.`);
    } else if (s.outcome === 'counterpart-walked') {
      out.push(`They walked after round ${sc.hidden.maxRounds}, their last. Nothing you offered by then was worth their reservation of ${sc.counterpart.batna} points to them.`);
    }
  } else if (deal && s.surplus < 0) {
    out.push(`You signed for ${cash(-s.surplus)} less than your alternative was worth. Know the walk-away number before the first offer and check every package against it.`);
  }

  if (proc.wasted.length) {
    const w = proc.wasted.reduce((x, y) => (y.cost > x.cost ? y : x));
    out.push(`In round ${w.round} you gave up ${cash(w.cost)} on ${w.label.toLowerCase()}, which was worth only ${pts(Math.max(0, w.gain))} to them. Give ground where it is cheap for you and matters to them.`);
  }
  if (deal && s.leftOnTable) {
    const t = s.leftOnTable;
    const moves = t.changes.map((c) => `${c.label.toLowerCase()} from ${c.from} to ${c.to}`).join(' and ');
    out.push(`Value was left on the table. Moving ${moves} would have been worth ${cash(t.player)} more to you and ${pts(t.counterpart)} more to them.`);
  }
  if (deal) {
    const cheap = sc.hidden.cheapIssue;
    const values = sc.player.values[cheap];
    const cap = sc.hidden.hardCap;
    const reachable = values.map((v, k) => (cap.issue !== cheap || (k >= cap.min && k <= cap.max) ? v : -1));
    const gap = 100 * sc.player.weights[cheap] * (Math.max(...reachable) - values[deal.offer[cheap]]);
    if (gap >= 2) {
      out.push(`${label(cheap)} carried only ${pct(sc.counterpart.weights[cheap])} of the weight for them. Your best option there would have cost them almost nothing and been worth ${cash(gap)} more to you.`);
    }
  }
  const mine = log.find((t) => t.by === 'player' && t.offer);
  if (deal && proc.firstAnchor === 'counterpart' && theirOffers.length && mine) {
    const from = playerUtility(sc, theirOffers[0].offer!);
    const to = playerUtility(sc, mine.offer!);
    if (to - from > 5) {
      const where = (deal.p - from) / (to - from);
      if (where < 0.45) out.push(`They put the first offer down, and the deal ended ${pct(Math.max(0, where))} of the way from their opening to yours. A first offer pulls the outcome towards it; consider opening yourself.`);
    }
  }
  if (deal && proc.playerTotal > 5 && proc.playerTotal > 1.5 * Math.max(proc.counterpartTotal, 0)) {
    out.push(`Across your offers you gave up ${pts(proc.playerTotal)} of your own value; they gave up ${pts(Math.max(0, proc.counterpartTotal))} of theirs. Make each concession smaller than the last and ask for something back.`);
  }
  const closer = log[log.length - 1];
  if (deal && closer.round < sc.hidden.deadlineRound) {
    const ask = [...log].reverse().find((t) => t.by === 'player' && t.offer)?.offer;
    const later = proposal(sc, sc.hidden.maxRounds, ask, reciprocity(sc, log)).p;
    if (later - deal.p >= 3) {
      out.push(`You closed in round ${closer.round}. They were under time pressure from round ${sc.hidden.deadlineRound}; the scripted final offer in round ${sc.hidden.maxRounds} would have been worth about ${cash(later - deal.p)} more to you.`);
    }
  }
  if (deal && s.nashShare !== null && s.nashShare >= 1 && out.length < 2) {
    out.push(`You took ${pct(s.nashShare)} of what the Nash solution gives your side. Their reservation was ${sc.counterpart.batna} points; the deal gave them ${deal.c.toFixed(0)}.`);
  }
  if (out.length < 2) {
    out.push(`Their hard limit was on ${label(sc.hidden.hardCap.issue).toLowerCase()}, and ${label(sc.hidden.cheapIssue).toLowerCase()} was the issue they would trade cheaply. Questions about what matters to them find this out before numbers do.`);
  }
  return out.slice(0, 3);
}

/** Score a finished session. `log` must end with an accept or a walk. */
export function scoreSession(sc: Scenario, log: Turn[]): Score {
  const end = sessionOutcome(log);
  if (!end) throw new Error('The session has not ended.');
  const bench = benchmarks(sc);
  const d = bench.disagreement;
  const deal: Outcome | null = end.deal ? { offer: end.deal, p: playerUtility(sc, end.deal), c: counterpartUtility(sc, end.deal) } : null;
  const surplus = deal ? deal.p - d.p : 0;
  let score: number;
  let headline: string;
  let nashShare: number | null = null;
  if (bench.nash) {
    const nashGain = Math.max(1, bench.nash.p - d.p);
    if (deal) {
      nashShare = surplus / nashGain;
      score = 100 * nashShare;
      headline = surplus < 0 ? 'A deal worse than walking away' : nashShare >= 1 ? 'At or above the Nash benchmark' : 'A deal, short of the Nash benchmark';
    } else {
      score = 0;
      headline = 'No deal, though one was possible';
    }
  } else if (deal) {
    score = -10 * Math.max(0, -surplus);
    headline = 'A deal where none should have been made';
  } else {
    score = 100;
    headline = end.outcome === 'player-walked' ? 'Walked away, correctly' : 'No deal, and none was possible';
  }
  score = Math.round(Math.min(150, Math.max(-100, score)));
  const theirGain = deal ? deal.c - d.c : 0;
  const base: Omit<Score, 'lessons'> = {
    outcome: end.outcome,
    zopaExists: bench.zopaExists,
    deal,
    score,
    grade: gradeOf(score),
    headline,
    surplus,
    nashShare,
    surplusShare: deal && surplus > 0 && theirGain >= 0 && surplus + theirGain > 0 ? surplus / (surplus + theirGain) : null,
    leftOnTable: deal ? leftOnTable(sc, deal) : null,
    process: processNotes(sc, log),
    bench,
  };
  return { ...base, lessons: lessons(sc, log, base) };
}

/** One line per finished session, kept in the store. */
export interface SessionRecord {
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  family: FamilyId;
  difficulty: Difficulty;
  role: Side;
  seed: number;
  counterpart: 'ai' | 'scripted' | 'mixed';
  outcome: SessionOutcome;
  rounds: number;
  score: number;
  grade: Grade;
  nashShare: number | null;
  surplusShare: number | null;
  /** Joint points left on the table; 0 if the deal was efficient or there was none. */
  leftOnTable: number;
  zopaExists: boolean;
}

export function toRecord(sc: Scenario, s: Score, id: string, date: string): SessionRecord {
  const { scriptedReplies, replies } = s.process;
  return {
    id,
    date,
    ...sc.ref,
    counterpart: scriptedReplies === 0 && replies > 0 ? 'ai' : scriptedReplies === replies ? 'scripted' : 'mixed',
    outcome: s.outcome,
    rounds: s.process.rounds,
    score: s.score,
    grade: s.grade,
    nashShare: s.nashShare,
    surplusShare: s.surplusShare,
    leftOnTable: s.leftOnTable ? s.leftOnTable.joint : 0,
    zopaExists: s.zopaExists,
  };
}

export interface Trend {
  count: number;
  average: number | null;
  /** Mean score of the latest five sessions and of the five before them. */
  recent: number | null;
  previous: number | null;
  best: number | null;
}

/** `records` oldest first. */
export function trend(records: { score: number }[]): Trend {
  const mean = (xs: { score: number }[]) => (xs.length ? xs.reduce((s, x) => s + x.score, 0) / xs.length : null);
  return {
    count: records.length,
    average: mean(records),
    recent: mean(records.slice(-5)),
    previous: mean(records.slice(-10, -5)),
    best: records.length ? Math.max(...records.map((r) => r.score)) : null,
  };
}
