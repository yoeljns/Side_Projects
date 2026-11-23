import { describe, expect, it } from 'vitest';
import {
  FAMILY_IDS,
  acceptable,
  aspiration,
  benchmarks,
  feasibleOutcomes,
  finiteProposerShare,
  generateScenario,
  gradeOf,
  idealPoint,
  kalaiSmorodinsky,
  leftOnTable,
  nashSolution,
  openingUtility,
  paretoFrontier,
  priceView,
  processNotes,
  proposal,
  reciprocity,
  resolveRound,
  rubinsteinShare,
  scoreSession,
  scriptedReply,
  toRecord,
  trend,
  utility,
  withinLimits,
  zopa,
  type Difficulty,
  type Offer,
  type Point,
  type Scenario,
  type ScenarioRef,
  type Side,
  type Turn,
} from './index.js';

/** A hand-built scenario with numbers small enough to check on paper. */
function manual(over: {
  issues: { id: string; n: number; wp: number; wc: number; vp: number[]; vc: number[] }[];
  batnaP: number;
  batnaC: number;
}): Scenario {
  const rec = <T,>(f: (i: (typeof over.issues)[number]) => T) => Object.fromEntries(over.issues.map((i) => [i.id, f(i)]));
  return {
    ref: { family: 'supplier', seed: 0, difficulty: 'easy', role: 'a' },
    title: 'Manual',
    setting: '',
    issues: over.issues.map((i) => ({ id: i.id, label: i.id.toUpperCase(), options: Array.from({ length: i.n }, (_, k) => ({ value: k * 10, label: `${k * 10}` })) })),
    player: { roleLabel: 'Buyer', weights: rec((i) => i.wp), values: rec((i) => i.vp), batna: over.batnaP, batnaStory: '', discount: 0.9 },
    counterpart: { roleLabel: 'Seller', weights: rec((i) => i.wc), values: rec((i) => i.vc), batna: over.batnaC, batnaStory: '', discount: 0.8 },
    hidden: {
      hardCap: { issue: over.issues[0].id, min: 0, max: over.issues[0].n - 1, story: '' },
      deadlineRound: 3,
      maxRounds: 6,
      finalConcession: 0.8,
      cheapIssue: over.issues[over.issues.length - 1].id,
      deadlineStory: '',
      tone: 'brisk',
    },
    currency: '£',
    stake: 10000,
    priceIssue: over.issues[0].id,
  };
}

/** One price issue, five options, straight-line values: outcomes (100,0) (75,25) (50,50) (25,75) (0,100). */
const priceOnly = (batnaP = 20, batnaC = 20) =>
  manual({ issues: [{ id: 'price', n: 5, wp: 1, wc: 1, vp: [1, 0.75, 0.5, 0.25, 0], vc: [0, 0.25, 0.5, 0.75, 1] }], batnaP, batnaC });

/** Two yes/no issues the sides weigh oppositely: (x1,y0) is worth 80 to each. */
const logroll = () =>
  manual({
    issues: [
      { id: 'x', n: 2, wp: 0.8, wc: 0.2, vp: [0, 1], vc: [1, 0] },
      { id: 'y', n: 2, wp: 0.2, wc: 0.8, vp: [0, 1], vc: [1, 0] },
    ],
    batnaP: 10,
    batnaC: 10,
  });

const offerTurn = (by: Turn['by'], round: number, offer: Offer): Turn => ({ by, round, action: 'offer', text: '', offer });
const accept = (by: Turn['by'], round: number, offer: Offer): Turn => ({ by, round, action: 'accept', text: '', offer });

const REFS: ScenarioRef[] = [];
for (const family of FAMILY_IDS)
  for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[])
    for (const role of ['a', 'b'] as Side[]) for (let seed = 1; seed <= 12; seed++) REFS.push({ family, difficulty, role, seed });

describe('utility', () => {
  it('adds weighted option values on a 0..100 scale', () => {
    const sc = logroll();
    expect(utility(sc.player, sc.issues, { x: 1, y: 0 })).toBeCloseTo(80);
    expect(utility(sc.counterpart, sc.issues, { x: 1, y: 0 })).toBeCloseTo(80);
    expect(utility(sc.player, sc.issues, { x: 0, y: 1 })).toBeCloseTo(20);
    expect(utility(sc.counterpart, sc.issues, { x: 0, y: 0 })).toBeCloseTo(100);
  });
  it('enumerates every package', () => {
    expect(feasibleOutcomes(logroll())).toHaveLength(4);
    expect(feasibleOutcomes(priceOnly()).map((o) => [o.p, o.c])).toEqual([[100, 0], [75, 25], [50, 50], [25, 75], [0, 100]]);
  });
});

describe('Pareto frontier', () => {
  it('drops dominated points and keeps the rest in order', () => {
    const pts: Point[] = [{ p: 1, c: 9 }, { p: 5, c: 5 }, { p: 4, c: 4 }, { p: 9, c: 1 }, { p: 5, c: 3 }, { p: 2, c: 9 }];
    expect(paretoFrontier(pts)).toEqual([{ p: 9, c: 1 }, { p: 5, c: 5 }, { p: 2, c: 9 }]);
  });
  it('finds the single efficient trade in the logrolling case', () => {
    const f = paretoFrontier(feasibleOutcomes(logroll()));
    // (100,0), (80,80), (0,100); the (20,20) package is dominated.
    expect(f.map((o) => [Math.round(o.p), Math.round(o.c)])).toEqual([[100, 0], [80, 80], [0, 100]]);
  });
});

/** A fine grid on the curve c = f(p), p in [0,1]. */
const curvePoints = (f: (p: number) => number, n = 2000): Point[] => Array.from({ length: n + 1 }, (_, k) => ({ p: k / n, c: f(k / n) }));

describe('Nash bargaining solution', () => {
  it('splits a straight frontier evenly from a zero disagreement point', () => {
    expect(nashSolution(curvePoints((p) => 1 - p), { p: 0, c: 0 })!.p).toBeCloseTo(0.5, 3);
  });
  it('moves with the disagreement point: max (p-0.2)(1-p) is at p = 0.6', () => {
    expect(nashSolution(curvePoints((p) => 1 - p), { p: 0.2, c: 0 })!.p).toBeCloseTo(0.6, 3);
  });
  it('on c = 1 - p^2 maximises p(1-p^2) at p = 1/sqrt(3)', () => {
    const n = nashSolution(curvePoints((p) => 1 - p * p), { p: 0, c: 0 })!;
    expect(n.p).toBeCloseTo(1 / Math.sqrt(3), 3);
    expect(n.c).toBeCloseTo(2 / 3, 3);
  });
  it('ignores points below either reservation and returns null when none are left', () => {
    const sc = priceOnly(20, 20);
    const n = nashSolution(feasibleOutcomes(sc), { p: 20, c: 20 })!;
    expect([n.p, n.c]).toEqual([50, 50]);
    // Gains over (20,60): only (25,75) qualifies.
    expect(nashSolution(feasibleOutcomes(sc), { p: 20, c: 60 })!.p).toBe(25);
    expect(nashSolution(feasibleOutcomes(sc), { p: 20, c: 90 })).toBeNull();
  });
});

describe('Kalai-Smorodinsky', () => {
  it('on c = 1 - p^2 sits where p = c: the golden-ratio point 0.618', () => {
    const k = kalaiSmorodinsky(curvePoints((p) => 1 - p * p), { p: 0, c: 0 })!;
    expect(k.p).toBeCloseTo((Math.sqrt(5) - 1) / 2, 3);
    expect(k.c).toBeCloseTo(k.p, 2);
  });
  it('differs from Nash when the frontier is lopsided', () => {
    // Frontier c = 1 - p for p <= 0.5, then steeper: c = 1.5 - 2p up to p = 0.75.
    const pts = curvePoints((p) => p).map(({ p }) => ({ p: 0.75 * p, c: 0.75 * p <= 0.5 ? 1 - 0.75 * p : 1.5 - 1.5 * p }));
    // Nash: p(1-p) peaks at 0.5 (0.25), and p(1.5-2p) peaks at 0.375 < 0.5, so Nash is at the kink.
    expect(nashSolution(pts, { p: 0, c: 0 })!.p).toBeCloseTo(0.5, 3);
    // Ideal point (0.75, 1): the line c = p/0.75 meets c = 1 - p at p = 3/7.
    expect(idealPoint(pts, { p: 0, c: 0 })).toEqual({ p: 0.75, c: 1 });
    expect(kalaiSmorodinsky(pts, { p: 0, c: 0 })!.p).toBeCloseTo(3 / 7, 3);
  });
});

describe('Rubinstein alternating offers', () => {
  it('matches the closed form (1 - d2) / (1 - d1 d2)', () => {
    expect(rubinsteinShare(0.9, 0.9)).toBeCloseTo(1 / 1.9, 10);
    expect(rubinsteinShare(0.9, 0.8)).toBeCloseTo(0.2 / 0.28, 10);
    expect(rubinsteinShare(0.5, 0.5)).toBeCloseTo(2 / 3, 10);
  });
  it('gives everything to the proposer when the responder cannot wait, and an even split at full patience', () => {
    expect(rubinsteinShare(0.9, 0)).toBe(1);
    expect(rubinsteinShare(1, 1)).toBe(0.5);
  });
  it('finite horizon: backward induction by hand, then convergence to the closed form', () => {
    expect(finiteProposerShare(1, 0.9, 0.8)).toBe(1);
    // Two offers: the responder proposes last and would take all, worth 0.8 now.
    expect(finiteProposerShare(2, 0.9, 0.8)).toBeCloseTo(0.2, 10);
    // Three: the responder, proposing with two left, keeps 1 - 0.9 = 0.1; worth 0.08 now.
    expect(finiteProposerShare(3, 0.9, 0.8)).toBeCloseTo(0.92, 10);
    expect(finiteProposerShare(200, 0.9, 0.8)).toBeCloseTo(rubinsteinShare(0.9, 0.8), 8);
    // Equal discounting is the recurrence v = 1 - d*v used in strategy-arena.
    let v = 1;
    for (let k = 2; k <= 6; k++) {
      v = 1 - 0.7 * v;
      expect(finiteProposerShare(k, 0.7, 0.7)).toBeCloseTo(v, 10);
    }
  });
});

describe('ZOPA and the price view', () => {
  it('is the gap between the buyer limit and the seller limit', () => {
    expect(zopa(100, 80)).toEqual({ exists: true, buyerMax: 100, sellerMin: 80, width: 20 });
    expect(zopa(70, 80)).toMatchObject({ exists: false, width: 0 });
    expect(zopa(80, 80)).toMatchObject({ exists: true, width: 0 });
  });
  it('reads both limits off the options and splits the zone by patience', () => {
    // Buyer (player) needs 20+ points: prices 0..30 (index 0..3). Seller needs 20+: prices 10..40.
    const v = priceView(priceOnly(20, 20));
    expect(v.playerLimit).toBe(30);
    expect(v.counterpartLimit).toBe(10);
    expect(v.exists).toBe(true);
    expect(v.width).toBe(20);
    // Player proposes first with d = 0.9 against 0.8: share 0.2/0.28 of the 20-wide zone, measured from 30.
    expect(v.playerShare).toBeCloseTo(0.2 / 0.28, 10);
    expect(v.rubinsteinPrice).toBeCloseTo(30 - 20 * (0.2 / 0.28), 8);
  });
  it('reports no zone when the limits do not overlap', () => {
    const v = priceView(priceOnly(60, 60));
    // Buyer: prices 0..10. Seller: prices 30..40.
    expect([v.playerLimit, v.counterpartLimit, v.exists, v.rubinsteinPrice]).toEqual([10, 30, false, null]);
  });
});

describe('scenario generation', () => {
  it('is deterministic for a ref and differs between seeds', () => {
    const ref: ScenarioRef = { family: 'supplier', seed: 7, difficulty: 'medium', role: 'a' };
    expect(generateScenario(ref)).toEqual(generateScenario({ ...ref }));
    expect(generateScenario({ ...ref, seed: 8 }).counterpart.weights).not.toEqual(generateScenario(ref).counterpart.weights);
  });
  it('builds well-formed scenarios in every family, difficulty and role', () => {
    for (const ref of REFS) {
      const sc = generateScenario(ref);
      expect(sc.issues.length).toBeGreaterThanOrEqual(4);
      for (const side of [sc.player, sc.counterpart]) {
        expect(Object.values(side.weights).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
        for (const i of sc.issues) {
          expect(side.values[i.id]).toHaveLength(i.options.length);
          expect(Math.max(...side.values[i.id])).toBe(1);
          expect(Math.min(...side.values[i.id])).toBe(0);
        }
      }
      const { hardCap, cheapIssue, deadlineRound, maxRounds } = sc.hidden;
      // The cheap issue really is cheap, and is not the one with the cap or the price.
      expect(sc.counterpart.weights[cheapIssue]).toBeLessThan(0.06);
      expect(cheapIssue).not.toBe(hardCap.issue);
      expect(cheapIssue).not.toBe(sc.priceIssue);
      // The cap cuts off the option the player likes best on that issue.
      const pv = sc.player.values[hardCap.issue];
      const best = pv.indexOf(1);
      expect(best < hardCap.min || best > hardCap.max).toBe(true);
      expect(hardCap.max - hardCap.min).toBeGreaterThanOrEqual(1);
      expect(maxRounds).toBeGreaterThan(deadlineRound);
      // The two sides want opposite ends of the price issue.
      const cv = sc.counterpart.values[sc.priceIssue];
      expect(sc.player.values[sc.priceIssue][0]).toBe(cv[cv.length - 1]);
    }
  });
  it('always leaves room for a deal on easy, and sometimes none on hard', () => {
    let hardWithout = 0;
    for (const ref of REFS) {
      const sc = generateScenario(ref);
      const b = benchmarks(sc);
      if (ref.difficulty === 'easy') {
        expect(b.zopaExists).toBe(true);
        expect(b.nash!.p - sc.player.batna).toBeGreaterThanOrEqual(5 - 1e-9);
        expect(b.nash!.c - sc.counterpart.batna).toBeGreaterThanOrEqual(5 - 1e-9);
      }
      if (!b.zopaExists) {
        expect(ref.difficulty).not.toBe('easy');
        if (ref.difficulty === 'hard') hardWithout++;
        expect(b.nash).toBeNull();
        expect(b.ks).toBeNull();
        // No package inside the cap beats both alternatives.
        expect(feasibleOutcomes(sc).some((o) => o.p >= sc.player.batna && o.c >= sc.counterpart.batna)).toBe(false);
      } else {
        // Nash and KS are on the frontier and beat both alternatives.
        for (const pt of [b.nash!, b.ks!]) {
          expect(b.frontier).toContain(pt);
          expect(pt.p).toBeGreaterThanOrEqual(sc.player.batna);
          expect(pt.c).toBeGreaterThanOrEqual(sc.counterpart.batna);
        }
      }
    }
    expect(hardWithout).toBeGreaterThan(0);
  });
});

describe('scripted counterpart', () => {
  it('concedes over time, faster after its deadline, and never to its reservation', () => {
    for (const ref of REFS) {
      const sc = generateScenario(ref);
      const { deadlineRound: n, maxRounds: m } = sc.hidden;
      expect(aspiration(sc, 1)).toBeCloseTo(openingUtility(sc), 10);
      for (let r = 2; r <= m + 3; r++) expect(aspiration(sc, r)).toBeLessThanOrEqual(aspiration(sc, r - 1) + 1e-9);
      expect(aspiration(sc, m + 3)).toBe(aspiration(sc, m));
      if (openingUtility(sc) > sc.counterpart.batna + 2) {
        expect(aspiration(sc, m)).toBeGreaterThan(sc.counterpart.batna + 1);
        const before = (aspiration(sc, 1) - aspiration(sc, n)) / (n - 1);
        const after = (aspiration(sc, n) - aspiration(sc, m)) / (m - n);
        expect(after).toBeGreaterThan(before);
      }
    }
  });
  it('hand case: opening 100, floor 21, 5% a round to round 3, 80% by round 6', () => {
    const sc = priceOnly(20, 20);
    expect(aspiration(sc, 1)).toBeCloseTo(100);
    expect(aspiration(sc, 2)).toBeCloseTo(21 + 79 * 0.95);
    expect(aspiration(sc, 3)).toBeCloseTo(21 + 79 * 0.9);
    // Rounds 4 and 5 cover a third each of the remaining 70%.
    expect(aspiration(sc, 4)).toBeCloseTo(21 + 79 * (0.9 - 0.7 / 3));
    expect(aspiration(sc, 6)).toBeCloseTo(21 + 79 * 0.2);
    // Round 6 aspiration is 36.8: it would sign price 20 (worth 50) but not price 10 (worth 25).
    expect(acceptable(sc, 6, { price: 2 })).toBe(true);
    expect(acceptable(sc, 6, { price: 1 })).toBe(false);
    expect(proposal(sc, 6, { price: 0 }).offer).toEqual({ price: 2 });
  });
  it('concedes less to a player who has not moved (hand case)', () => {
    const sc = priceOnly(20, 20);
    // Same ask twice: no movement, so 60% of the planned 80% by round 6.
    const still = [offerTurn('player', 1, { price: 0 }), offerTurn('player', 2, { price: 0 })];
    expect(reciprocity(sc, still)).toBe(0);
    expect(aspiration(sc, 6, 0)).toBeCloseTo(21 + 79 * (1 - 0.8 * 0.6));
    // Price 0 then price 10 is worth 25 more to them; a quarter of their 79-point range is 19.75.
    const moved = [offerTurn('player', 1, { price: 0 }), offerTurn('player', 2, { price: 1 })];
    expect(reciprocity(sc, moved)).toBe(1);
    expect(reciprocity(sc, [offerTurn('player', 1, { price: 0 })])).toBe(0);
    // Going back on a concession does not undo it.
    expect(reciprocity(sc, [...moved, offerTurn('player', 3, { price: 0 })])).toBe(1);
  });
  it('plays a whole session inside its limits against a player who never moves', () => {
    for (const ref of REFS) {
      const sc = generateScenario(ref);
      // The player's dream package.
      const ask: Offer = Object.fromEntries(sc.issues.map((i) => [i.id, sc.player.values[i.id].indexOf(1)]));
      let log: Turn[] = [];
      let ended = false;
      for (let round = 1; round <= sc.hidden.maxRounds + 1 && !ended; round++) {
        const { playerTurn, reply } = resolveRound(sc, log, { text: '', offer: ask, action: 'offer' }, null);
        expect(reply.source).toBe('scripted');
        expect(reply.text.length).toBeGreaterThan(0);
        log = [...log, playerTurn, reply];
        if (reply.action === 'offer') {
          expect(round).toBeLessThanOrEqual(sc.hidden.maxRounds);
          expect(withinLimits(sc, reply.offer!)).toBe(true);
          expect(utility(sc.counterpart, sc.issues, reply.offer!)).toBeGreaterThanOrEqual(aspiration(sc, round) - 1e-9);
        } else {
          ended = true;
          // The dream package breaks the hard cap, so it can never be accepted.
          expect(reply.action).toBe('walk');
          expect(round).toBe(sc.hidden.maxRounds + 1);
        }
      }
      expect(ended).toBe(true);
    }
  });
  it('gives way on the issue it barely cares about', () => {
    let early = 0;
    let gave = 0;
    for (const ref of REFS) {
      const sc = generateScenario(ref);
      const cheap = sc.hidden.cheapIssue;
      const best = sc.player.values[cheap].indexOf(1);
      // Ask for its own opening package, except the player's best option on the cheap issue.
      const opening = proposal(sc, 1, undefined).offer;
      const ask = { ...opening, [cheap]: best };
      if (proposal(sc, sc.hidden.deadlineRound, ask).offer[cheap] === best) early++;
      if (proposal(sc, sc.hidden.deadlineRound + 1, ask).offer[cheap] === best) gave++;
    }
    // Always by the round after its deadline, and usually before.
    expect(gave).toBe(REFS.length);
    expect(early / REFS.length).toBeGreaterThan(0.8);
  });
  it('does not take back ground it has given while the player holds an ask', () => {
    for (const ref of REFS.filter((_, k) => k % 3 === 0)) {
      const sc = generateScenario(ref);
      const cap = sc.hidden.hardCap;
      // The player's best package inside the hard limit, repeated every round.
      const ask: Offer = Object.fromEntries(sc.issues.map((i) => [i.id, sc.player.values[i.id].indexOf(1)]));
      ask[cap.issue] = Math.min(cap.max, Math.max(cap.min, ask[cap.issue]));
      let log: Turn[] = [];
      let prev: Offer | undefined;
      for (let round = 1; round <= sc.hidden.maxRounds; round++) {
        const { playerTurn, reply } = resolveRound(sc, log, { text: '', offer: ask, action: 'offer' }, null);
        log = [...log, playerTurn, reply];
        if (reply.action !== 'offer') break;
        if (prev) for (const i of sc.issues) expect(Math.abs(reply.offer![i.id] - ask[i.id])).toBeLessThanOrEqual(Math.abs(prev[i.id] - ask[i.id]));
        prev = reply.offer;
      }
    }
  });
  it('accepts an offer that meets its aspiration and says so', () => {
    const sc = generateScenario(REFS[0]);
    const top = proposal(sc, 1, undefined).offer;
    const reply = scriptedReply(sc, [offerTurn('player', 1, top)]);
    expect(reply.action).toBe('accept');
    expect(reply.offer).toEqual(top);
  });
  it('answers a message without terms with its own offer', () => {
    const sc = generateScenario(REFS[0]);
    const reply = scriptedReply(sc, [{ by: 'player', round: 1, action: 'message', text: '' }]);
    expect(reply.action).toBe('offer');
    expect(reply.offer).toEqual(proposal(sc, 1, undefined).offer);
  });
});

describe('scoring', () => {
  it('measures the deal against the Nash solution (hand case)', () => {
    const sc = priceOnly(20, 20);
    // Nash is (50,50): a gain of 30 over the 20-point alternative.
    const fair = scoreSession(sc, [accept('counterpart', 1, { price: 2 })]);
    expect([fair.score, fair.grade, fair.nashShare, fair.surplusShare]).toEqual([100, 'A', 1, 0.5]);
    // (25,75): gain 5 of 30 = 17%; the player took 5 of the 60 points of joint gain.
    const weak = scoreSession(sc, [accept('player', 1, { price: 3 })]);
    expect(weak.score).toBe(17);
    expect(weak.grade).toBe('E');
    expect(weak.surplusShare).toBeCloseTo(5 / 60);
    // (75,25): gain 55 of 30 = 183%, capped at 150.
    const strong = scoreSession(sc, [accept('counterpart', 1, { price: 1 })]);
    expect(strong.nashShare).toBeCloseTo(55 / 30);
    expect(strong.score).toBe(150);
    expect(strong.surplusShare).toBeCloseTo(55 / 60);
  });
  it('scores a deal below the player BATNA negative', () => {
    const s = scoreSession(priceOnly(20, 20), [accept('player', 1, { price: 4 })]);
    // (0,100): 20 points below the alternative, against a Nash gain of 30.
    expect(s.surplus).toBe(-20);
    expect(s.score).toBe(-67);
    expect(s.grade).toBe('F');
    expect(s.surplusShare).toBeNull();
    expect(s.lessons[0]).toMatch(/less than your alternative/);
  });
  it('scores walking away 0 when a deal existed and full marks when none did', () => {
    const walk: Turn[] = [{ by: 'player', round: 1, action: 'walk', text: '' }];
    const missed = scoreSession(priceOnly(20, 20), walk);
    expect([missed.score, missed.grade, missed.zopaExists, missed.nashShare]).toEqual([0, 'E', true, null]);
    expect(missed.lessons[0]).toMatch(/£3,000/); // 30 points of a £10,000 stake
    const right = scoreSession(priceOnly(20, 90), walk);
    expect([right.score, right.grade, right.zopaExists]).toEqual([100, 'A', false]);
    expect(right.lessons[0]).toMatch(/no zone of agreement/);
    // Signing anyway: 20 points under the alternative at 10 per point, floored at -100.
    const signed = scoreSession(priceOnly(20, 90), [accept('player', 1, { price: 4 })]);
    expect([signed.score, signed.grade]).toEqual([-100, 'F']);
  });
  it('names the trade that would have made both sides better off', () => {
    const sc = logroll();
    const deal = { offer: { x: 0, y: 1 }, p: 20, c: 20 };
    const t = leftOnTable(sc, deal)!;
    expect(t.better.offer).toEqual({ x: 1, y: 0 });
    expect([t.player, t.counterpart, t.joint]).toEqual([60, 60, 120]);
    expect(t.changes).toEqual([
      { issue: 'x', label: 'X', from: '0', to: '10' },
      { issue: 'y', label: 'Y', from: '10', to: '0' },
    ]);
    expect(leftOnTable(sc, { offer: { x: 1, y: 0 }, p: 80, c: 80 })).toBeNull();
    const s = scoreSession(sc, [accept('player', 1, { x: 0, y: 1 })]);
    expect(s.lessons.join(' ')).toMatch(/Moving x from 0 to 10 and y from 10 to 0 would have been worth £6,000 more to you/);
  });
  it('reads the offer log: first anchor, concession sizes, wasted concessions', () => {
    const sc = logroll();
    const log: Turn[] = [
      offerTurn('player', 1, { x: 1, y: 1 }), // 100 to the player
      offerTurn('counterpart', 1, { x: 0, y: 0 }), // 100 to them
      offerTurn('player', 2, { x: 0, y: 1 }), // gives up x: costs 80, worth 20 to them
      offerTurn('counterpart', 2, { x: 1, y: 0 }), // they drop to 80
      accept('player', 3, { x: 1, y: 0 }),
    ];
    const p = processNotes(sc, log);
    expect(p.firstAnchor).toBe('player');
    expect(p.rounds).toBe(3);
    expect(p.playerConcessions).toEqual([{ round: 2, points: 80 }]);
    expect(p.counterpartConcessions).toEqual([{ round: 2, points: 20 }]);
    expect(p.wasted).toHaveLength(1);
    expect(p.wasted[0]).toMatchObject({ round: 2, label: 'X' });
    expect(p.wasted[0].cost).toBeCloseTo(80);
    expect(p.wasted[0].gain).toBeCloseTo(20);
    // Conceding y instead costs 20 and is worth 80 to them: not wasted.
    const good = processNotes(sc, [offerTurn('player', 1, { x: 1, y: 1 }), offerTurn('player', 2, { x: 1, y: 0 })]);
    expect(good.wasted).toEqual([]);
    const s = scoreSession(sc, log);
    expect(s.lessons.some((l) => /In round 2 you gave up £8,000 on x/.test(l))).toBe(true);
    expect(s.lessons.length).toBeGreaterThanOrEqual(2);
    expect(s.lessons.length).toBeLessThanOrEqual(3);
  });
  it('grades and records a session', () => {
    expect([150, 95, 94, 75, 50, 25, 0, -1].map(gradeOf)).toEqual(['A', 'A', 'B', 'B', 'C', 'D', 'E', 'F']);
    const sc = priceOnly(20, 20);
    const s = scoreSession(sc, [offerTurn('player', 1, { price: 2 }), { ...accept('counterpart', 1, { price: 2 }), source: 'scripted' }]);
    expect(toRecord(sc, s, 'abc', '2026-11-23')).toEqual({
      id: 'abc', date: '2026-11-23', family: 'supplier', seed: 0, difficulty: 'easy', role: 'a', counterpart: 'scripted',
      outcome: 'deal', rounds: 1, score: 100, grade: 'A', nashShare: 1, surplusShare: 0.5, leftOnTable: 0, zopaExists: true,
    });
    expect(() => scoreSession(sc, [offerTurn('player', 1, { price: 2 })])).toThrow();
  });
  it('gives at least two lessons for any finished generated session', () => {
    for (const ref of REFS.filter((_, k) => k % 5 === 0)) {
      const sc = generateScenario(ref);
      const first = scriptedReply(sc, [{ by: 'player', round: 1, action: 'message', text: '' }]);
      const log: Turn[] = [{ by: 'player', round: 1, action: 'message', text: '' }, first, accept('player', 2, first.offer!)];
      const s = scoreSession(sc, log);
      expect(s.lessons.length).toBeGreaterThanOrEqual(2);
      expect(s.process.firstAnchor).toBe('counterpart');
      expect(Number.isFinite(s.score)).toBe(true);
    }
  });
  it('summarises the trend over past sessions', () => {
    expect(trend([])).toEqual({ count: 0, average: null, recent: null, previous: null, best: null });
    const t = trend([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110].map((score) => ({ score })));
    // Latest five: 70..110 = 90. The five before: 20..60 = 40.
    expect(t).toEqual({ count: 11, average: 60, recent: 90, previous: 40, best: 110 });
    expect(trend([{ score: 40 }, { score: 60 }])).toMatchObject({ recent: 50, previous: null });
  });
});
