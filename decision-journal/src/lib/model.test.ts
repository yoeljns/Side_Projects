import { describe, expect, it } from 'vitest';
import {
  addCategory,
  applyDraft,
  BLANK,
  fromDraft,
  normaliseDoc,
  removeCategory,
  renameCategory,
  reopen,
  resolve,
  reviewQueue,
  statusOf,
  toDraft,
  topScenario,
  validateDraft,
  type Decision,
  type Doc,
  type Draft,
} from './model';

const draft = (extra: Partial<Draft> = {}): Draft => ({
  title: 'Raise prices',
  call: 'Go up 10% for new customers',
  statement: 'sign-ups hold',
  probability: 0.7,
  category: 'Company',
  stakes: 'high',
  madeOn: '2026-01-10',
  reviewOn: '2026-04-10',
  notes: '',
  changeMind: 'Two months of falling sign-ups',
  ...extra,
});

const scenarios = () => [
  { id: 'bear', label: 'Bear', probability: 0.25 },
  { id: 'base', label: 'Base', probability: 0.45 },
  { id: 'bull', label: 'Bull', probability: 0.3 },
];

describe('validateDraft', () => {
  it('passes a complete draft', () => {
    expect(validateDraft(draft())).toEqual([]);
    expect(validateDraft(draft({ scenarios: scenarios() }))).toEqual([]);
  });

  it('needs a title, real dates and a review on or after the decision', () => {
    expect(validateDraft(draft({ title: '  ' }))).toEqual(['Give it a title.']);
    expect(validateDraft(draft({ reviewOn: '' }))).toEqual(['Pick a review date.']);
    expect(validateDraft(draft({ reviewOn: '2026-01-09' }))).toEqual(['The review date is before the decision date.']);
    expect(validateDraft(draft({ reviewOn: '2026-01-10' }))).toEqual([]);
    expect(validateDraft(draft({ madeOn: '2026-02-30' }))).toHaveLength(1);
  });

  it('keeps probability inside 0..1', () => {
    expect(validateDraft(draft({ probability: 1.2 }))).toHaveLength(1);
    expect(validateDraft(draft({ probability: -0.1 }))).toHaveLength(1);
    expect(validateDraft(draft({ probability: Number.NaN }))).toHaveLength(1);
    expect(validateDraft(draft({ probability: 0 }))).toEqual([]);
    expect(validateDraft(draft({ probability: 1 }))).toEqual([]);
  });

  it('scenario probabilities must sum to 1', () => {
    const s = scenarios();
    s[0].probability = 0.2;
    expect(validateDraft(draft({ scenarios: s }))).toEqual(['Scenario probabilities must add up to 100% (now 95%).']);
    // thirds do not sum to exactly 1 in floating point, but are accepted
    const thirds = ['a', 'b', 'c'].map((id) => ({ id, label: id, probability: 1 / 3 }));
    expect(validateDraft(draft({ scenarios: thirds }))).toEqual([]);
    // 0.1 + 0.2 + 0.7 is 0.9999999999999999
    const awkward = [0.1, 0.2, 0.7].map((probability, i) => ({ id: `${i}`, label: `s${i}`, probability }));
    expect(validateDraft(draft({ scenarios: awkward }))).toEqual([]);
  });

  it('scenarios need two or more distinct names', () => {
    expect(validateDraft(draft({ scenarios: [{ id: 'a', label: 'Only', probability: 1 }] }))).toEqual(['Scenarios need at least two outcomes.']);
    const dup = scenarios();
    dup[1].label = ' bear ';
    expect(validateDraft(draft({ scenarios: dup }))).toEqual(['Scenario names must be different.']);
    const blank = scenarios();
    blank[2].label = '';
    expect(validateDraft(draft({ scenarios: blank }))).toEqual(['Every scenario needs a name.']);
  });
});

describe('creating a decision', () => {
  it('keeps the contract fields and drops empty text', () => {
    const d = fromDraft(draft({ title: '  Raise prices ' }), 'abc');
    expect(d).toEqual({
      id: 'abc',
      title: 'Raise prices',
      call: 'Go up 10% for new customers',
      statement: 'sign-ups hold',
      category: 'Company',
      stakes: 'high',
      madeOn: '2026-01-10',
      probability: 0.7,
      reviewOn: '2026-04-10',
      changeMind: 'Two months of falling sign-ups',
    });
    expect('notes' in d).toBe(false);
    expect(statusOf(d)).toBe('open');
  });

  it('a scenario decision takes its probability from the top scenario', () => {
    const d = fromDraft(draft({ probability: 0.99, scenarios: scenarios() }), 'abc');
    expect(d.probability).toBe(0.45);
    expect(d.scenarios).toHaveLength(3);
  });

  it('the first scenario wins a tie for top', () => {
    expect(topScenario([{ id: 'a', label: 'A', probability: 0.4 }, { id: 'b', label: 'B', probability: 0.4 }, { id: 'c', label: 'C', probability: 0.2 }])!.id).toBe('a');
    expect(topScenario([])).toBeUndefined();
  });

  it('refuses an invalid draft', () => {
    expect(() => fromDraft(draft({ title: '' }), 'abc')).toThrow('Give it a title.');
  });

  it('round-trips through a draft', () => {
    const d = fromDraft(draft({ scenarios: scenarios(), notes: 'n' }), 'abc');
    expect(fromDraft(toDraft(d), 'abc')).toEqual(d);
  });
});

describe('resolving', () => {
  const open = fromDraft(draft(), 'abc');
  const multi = fromDraft(draft({ scenarios: scenarios() }), 'm');

  it('records a yes/no outcome with the review notes', () => {
    const d = resolve(open, { kind: 'outcome', outcome: false }, '2026-04-12', { lesson: ' Ask customers first ', quality: 'good', hindsight: '' });
    expect(d).toMatchObject({ outcome: false, resolvedOn: '2026-04-12', lesson: 'Ask customers first', quality: 'good', probability: 0.7 });
    expect('hindsight' in d).toBe(false);
    expect(statusOf(d)).toBe('resolved');
  });

  it('a scenario decision: outcome is whether the top scenario happened', () => {
    const base = resolve(multi, { kind: 'scenario', scenarioId: 'base' }, '2026-04-12');
    expect(base).toMatchObject({ resolvedScenarioId: 'base', outcome: true, probability: 0.45 });
    const bull = resolve(multi, { kind: 'scenario', scenarioId: 'bull' }, '2026-04-12');
    expect(bull).toMatchObject({ resolvedScenarioId: 'bull', outcome: false, probability: 0.45 });
  });

  it('void is reviewed but has no outcome', () => {
    const d = resolve(open, { kind: 'void' }, '2026-04-12', { lesson: 'The question was too vague' });
    expect(d.voided).toBe(true);
    expect(d.outcome).toBeUndefined();
    expect(d.lesson).toBe('The question was too vague');
    expect(statusOf(d)).toBe('void');
    expect(statusOf(resolve(multi, { kind: 'void' }, '2026-04-12'))).toBe('void');
  });

  it('rejects the wrong kind of result', () => {
    expect(() => resolve(multi, { kind: 'outcome', outcome: true }, '2026-04-12')).toThrow();
    expect(() => resolve(multi, { kind: 'scenario', scenarioId: 'nope' }, '2026-04-12')).toThrow();
    expect(() => resolve(open, { kind: 'scenario', scenarioId: 'base' }, '2026-04-12')).toThrow();
  });

  it('resolving again replaces the earlier review', () => {
    const first = resolve(open, { kind: 'void' }, '2026-04-12', { lesson: 'x', quality: 'bad' });
    const second = resolve(first, { kind: 'outcome', outcome: true }, '2026-04-20');
    expect(second.voided).toBeUndefined();
    expect(second.lesson).toBeUndefined();
    expect(second.quality).toBeUndefined();
    expect(second).toMatchObject({ outcome: true, resolvedOn: '2026-04-20' });
  });

  it('reopen puts it back exactly as it was', () => {
    expect(reopen(resolve(open, { kind: 'outcome', outcome: true }, '2026-04-12', { lesson: 'x', quality: 'good', hindsight: 'y' }))).toEqual(open);
    expect(reopen(resolve(multi, { kind: 'scenario', scenarioId: 'bear' }, '2026-04-12'))).toEqual(multi);
  });
});

describe('editing', () => {
  it('keeps the review when the forecast is edited', () => {
    const done = resolve(fromDraft(draft(), 'abc'), { kind: 'outcome', outcome: true }, '2026-04-12', { lesson: 'x' });
    const edited = applyDraft(done, draft({ title: 'Raise prices 10%', probability: 0.6, notes: 'added' }));
    expect(edited).toMatchObject({ id: 'abc', title: 'Raise prices 10%', probability: 0.6, notes: 'added', outcome: true, resolvedOn: '2026-04-12', lesson: 'x' });
  });

  it('recomputes the contract outcome when the top scenario changes', () => {
    const done = resolve(fromDraft(draft({ scenarios: scenarios() }), 'm'), { kind: 'scenario', scenarioId: 'bull' }, '2026-04-12');
    expect(done.outcome).toBe(false);
    const s = scenarios();
    s[1].probability = 0.25;
    s[2].probability = 0.5;
    const edited = applyDraft(done, draft({ scenarios: s }));
    expect(edited).toMatchObject({ probability: 0.5, outcome: true, resolvedScenarioId: 'bull' });
  });

  it('reopens when the scenario that happened is removed, or the mode changes', () => {
    const done = resolve(fromDraft(draft({ scenarios: scenarios() }), 'm'), { kind: 'scenario', scenarioId: 'bull' }, '2026-04-12');
    const two = [{ id: 'bear', label: 'Bear', probability: 0.4 }, { id: 'base', label: 'Base', probability: 0.6 }];
    expect(statusOf(applyDraft(done, draft({ scenarios: two })))).toBe('open');
    const toBinary = applyDraft(done, draft());
    expect(statusOf(toBinary)).toBe('open');
    expect(toBinary.scenarios).toBeUndefined();
    expect(toBinary.resolvedScenarioId).toBeUndefined();
    const binaryDone = resolve(fromDraft(draft(), 'b'), { kind: 'outcome', outcome: true }, '2026-04-12');
    expect(statusOf(applyDraft(binaryDone, draft({ scenarios: scenarios() })))).toBe('open');
  });
});

describe('review queue', () => {
  const d = (id: string, reviewOn: string, extra: Partial<Decision> = {}): Decision => ({ id, title: id, category: 'Other', stakes: 'low', madeOn: '2026-01-01', probability: 0.6, reviewOn, ...extra });
  const decisions = [
    d('later', '2026-06-01'),
    d('today', '2026-03-10'),
    d('yesterday', '2026-03-09'),
    d('long-ago', '2026-01-15'),
    d('tomorrow', '2026-03-11'),
    d('done', '2026-02-01', { outcome: true, resolvedOn: '2026-02-01' }),
    d('void', '2026-02-01', { voided: true, resolvedOn: '2026-02-01' }),
  ];

  it('splits open decisions into overdue, due today and upcoming', () => {
    const q = reviewQueue(decisions, '2026-03-10');
    expect(q.overdue.map((x) => x.id)).toEqual(['long-ago', 'yesterday']);
    expect(q.dueToday.map((x) => x.id)).toEqual(['today']);
    expect(q.upcoming.map((x) => x.id)).toEqual(['tomorrow', 'later']);
  });

  it('moves with today', () => {
    const q = reviewQueue(decisions, '2026-01-01');
    expect(q.overdue).toEqual([]);
    expect(q.dueToday).toEqual([]);
    expect(q.upcoming).toHaveLength(5);
    expect(reviewQueue(decisions, '2027-01-01').overdue).toHaveLength(5);
  });
});

describe('categories', () => {
  const doc: Doc = {
    categories: ['Company', 'Money', 'Other'],
    decisions: [
      { id: '1', title: 'a', category: 'Money', stakes: 'low', madeOn: '2026-01-01', probability: 0.5, reviewOn: '2026-02-01' },
      { id: '2', title: 'b', category: 'Company', stakes: 'low', madeOn: '2026-01-01', probability: 0.5, reviewOn: '2026-02-01' },
    ],
  };

  it('adds, ignoring blanks and duplicates', () => {
    expect(addCategory(doc, ' Chess ').categories).toEqual(['Company', 'Money', 'Other', 'Chess']);
    expect(addCategory(doc, 'money')).toBe(doc);
    expect(addCategory(doc, '  ')).toBe(doc);
  });

  it('renames and takes the decisions along', () => {
    const next = renameCategory(doc, 'Money', 'Investing');
    expect(next.categories).toEqual(['Company', 'Investing', 'Other']);
    expect(next.decisions.map((d) => d.category)).toEqual(['Investing', 'Company']);
    expect(renameCategory(doc, 'Money', 'company')).toBe(doc);
    expect(renameCategory(doc, 'Money', '')).toBe(doc);
    expect(renameCategory(doc, 'Money', 'MONEY').categories[1]).toBe('MONEY');
  });

  it('removes and moves the decisions to the fallback', () => {
    const next = removeCategory(doc, 'Money', 'Other');
    expect(next.categories).toEqual(['Company', 'Other']);
    expect(next.decisions[0].category).toBe('Other');
    expect(removeCategory(doc, 'Money', 'Money')).toBe(doc);
    expect(removeCategory(doc, 'Money', 'Missing')).toBe(doc);
    expect(removeCategory({ ...doc, categories: ['Money'] }, 'Money', 'Other').categories).toEqual(['Money']);
  });
});

describe('normaliseDoc', () => {
  it('leaves a blank document alone', () => {
    expect(normaliseDoc(BLANK)).toEqual(BLANK);
  });

  it('reads a contract-only record and fills in the extras', () => {
    const doc = normaliseDoc({
      decisions: [{ id: '1', title: 'Old', category: 'Chess', madeOn: '2026-01-01', probability: 0.8, reviewOn: '2026-02-01', outcome: true } as Decision],
      categories: ['Company'],
    });
    expect(doc.decisions[0]).toMatchObject({ stakes: 'medium', outcome: true, resolvedOn: '2026-02-01' });
    expect(doc.categories).toEqual(['Company', 'Chess']);
  });

  it('drops records that are not decisions and survives junk', () => {
    const junk = { decisions: [null, 7, { id: 'x' }, { id: '1', title: 't', madeOn: '2026-01-01', reviewOn: 'soon', probability: 0.5 }, { id: '2', title: 't', madeOn: '2026-01-01', reviewOn: '2026-02-01', probability: 5 }], categories: 'nope' };
    const doc = normaliseDoc(junk as unknown as Partial<Doc>);
    expect(doc.decisions).toEqual([]);
    expect(doc.categories).toEqual(BLANK.categories);
    expect(normaliseDoc({}).decisions).toEqual([]);
  });

  it('a void record never carries an outcome', () => {
    const doc = normaliseDoc({ decisions: [{ id: '1', title: 't', category: 'Other', stakes: 'low', madeOn: '2026-01-01', probability: 0.8, reviewOn: '2026-02-01', outcome: true, voided: true }], categories: ['Other'] });
    expect(doc.decisions[0].outcome).toBeUndefined();
    expect(statusOf(doc.decisions[0])).toBe('void');
  });

  it('keeps other top-level fields such as the sync timestamp', () => {
    expect(normaliseDoc({ ...BLANK, updatedAt: 5 } as Partial<Doc>)).toMatchObject({ updatedAt: 5 });
  });
});
