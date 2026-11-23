// Made-up decisions for the "Load example data" button, so the Calibration tab
// can be seen before a real journal has enough reviews. Every record is
// flagged `example: true` and "Remove example data" deletes exactly those.
import { addDays } from './dates';
import type { Decision, Stakes } from './model';

// [title, statement, category, stakes, probability, days ago decided, days until review, outcome (null = still open)]
type Row = [string, string, string, Stakes, number, number, number, boolean | null];

const ROWS: Row[] = [
  ['Raise prices for new customers', 'new sign-ups hold within 10% over the next quarter', 'Company', 'high', 0.7, 300, 90, true],
  ['Hire a contractor instead of a full-timer', 'the project ships by the agreed date', 'Company', 'medium', 0.8, 290, 60, true],
  ['Take the harder elective', 'I finish it with a mark I am happy with', 'Masters', 'medium', 0.6, 280, 120, true],
  ['Switch to three gym sessions a week', 'I am still doing three a week in two months', 'Health', 'low', 0.9, 270, 60, false],
  ['Move savings into the index fund', 'I do not touch it for six months', 'Money', 'medium', 0.85, 265, 180, true],
  ['Skip the conference', 'I do not regret missing it', 'Company', 'low', 0.75, 250, 30, true],
  ['Start the essay early', 'the first draft is done two weeks before the deadline', 'Masters', 'low', 0.8, 240, 45, false],
  ['Say no to the side project', 'I feel fine about it a month later', 'Other', 'low', 0.7, 230, 30, true],
  ['Launch the feature without the redesign', 'usage of the feature passes the target in the first month', 'Company', 'high', 0.6, 220, 45, false],
  ['Book the trip well ahead', 'the plans survive without a change fee', 'Money', 'low', 0.9, 210, 60, true],
  ['Raise the difficult topic directly', 'the conversation leaves things better', 'Relationships', 'medium', 0.65, 200, 14, true],
  ['Keep the current supplier', 'no delivery slips more than a week this quarter', 'Company', 'medium', 0.8, 190, 90, false],
  ['Pick the narrower dissertation topic', 'my supervisor signs off the proposal first time', 'Masters', 'high', 0.7, 180, 40, true],
  ['Cut caffeine after noon', 'I am asleep before midnight most nights this month', 'Health', 'low', 0.55, 170, 30, false],
  ['Delay the hire by a quarter', 'the team copes without missing a release', 'Company', 'high', 0.9, 160, 90, true],
  ['Buy rather than keep renting the kit', 'I use it at least twenty times this year', 'Money', 'low', 0.3, 150, 120, false],
  ['Enter the tournament', 'I finish in the top half', 'Other', 'low', 0.4, 140, 30, true],
  ['Send the long proposal', 'they reply with a yes or a meeting', 'Company', 'medium', 0.35, 130, 21, false],
  ['Train through the niggle', 'it clears up without time off', 'Health', 'medium', 0.8, 120, 21, false],
  ['Host the dinner', 'at least six people come', 'Relationships', 'low', 0.9, 110, 14, true],
  ['Renegotiate the contract', 'we get better terms without losing the client', 'Company', 'high', 0.6, 100, 60, true],
  ['Study on the flight', 'I get through two chapters', 'Masters', 'low', 0.7, 90, 7, false],
  ['Fix the rate now', 'it beats the variable rate over three months', 'Money', 'medium', 0.5, 80, 60, true],
  ['Promote from within', 'they are doing the role well after two months', 'Company', 'high', 0.75, 70, 60, true],
  ['Apply for the grant', 'we get through the first round', 'Company', 'medium', 0.3, 40, 30, null],
  ['Change the weekly meeting to written updates', 'nobody asks for the meeting back within a month', 'Company', 'low', 0.7, 30, 30, null],
  ['Sign up for the course', 'I finish every module', 'Other', 'low', 0.6, 10, 90, null],
];

export function exampleDecisions(today: string): Decision[] {
  const scenarioMade = addDays(today, -200);
  const scenario: Decision = {
    id: 'example-scenarios',
    title: 'Open the second market this year',
    call: 'Go ahead with a small launch',
    category: 'Company',
    stakes: 'high',
    madeOn: scenarioMade,
    probability: 0.5,
    reviewOn: addDays(scenarioMade, 150),
    scenarios: [
      { id: 'bear', label: 'Bear: we pull out', probability: 0.2 },
      { id: 'base', label: 'Base: slow but steady', probability: 0.5 },
      { id: 'bull', label: 'Bull: it outgrows home', probability: 0.3 },
    ],
    resolvedScenarioId: 'base',
    outcome: true,
    resolvedOn: addDays(scenarioMade, 150),
    example: true,
  };
  return [...rows(today), scenario];
}

function rows(today: string): Decision[] {
  return ROWS.map(([title, statement, category, stakes, probability, ago, wait, outcome], i) => {
    const madeOn = addDays(today, -ago);
    const reviewOn = addDays(madeOn, wait);
    const d: Decision = { id: `example-${i + 1}`, title, statement, category, stakes, madeOn, probability, reviewOn, example: true };
    if (outcome !== null) {
      d.outcome = outcome;
      d.resolvedOn = reviewOn;
    }
    return d;
  });
}

export const hasExamples = (decisions: Decision[]): boolean => decisions.some((d) => d.example);
export const withoutExamples = (decisions: Decision[]): Decision[] => decisions.filter((d) => !d.example);
