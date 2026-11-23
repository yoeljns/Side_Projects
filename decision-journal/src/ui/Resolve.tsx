import { useState } from 'react';
import { REVIEW_PRESETS } from '../lib/dates';
import type { Decision, Quality, Result, ReviewNotes } from '../lib/model';
import { statusOf } from '../lib/model';
import { BRIER_FIFTY, brierMulti, impactOf, MIN_READABLE } from '../lib/scoring';
import { pct, score } from './format';

interface FlowProps {
  decision: Decision;
  today: string;
  onResolve: (result: Result, resolvedOn: string, review: ReviewNotes) => void;
  /** Push the review date back instead of resolving. */
  onSnooze?: (reviewOn: string) => void;
  onCancel?: () => void;
}

const QUALITY: { id: Quality; label: string }[] = [
  { id: 'good', label: 'Good call' },
  { id: 'bad', label: 'Bad call' },
  { id: 'unsure', label: 'Not sure' },
];

/** Tap one: what happened. Tap two: save. The notes in between are optional. */
export function ResolveFlow({ decision: d, today, onResolve, onSnooze, onCancel }: FlowProps) {
  const [picked, setPicked] = useState<Result | null>(null);
  const [later, setLater] = useState(false);
  const [lesson, setLesson] = useState('');
  const [quality, setQuality] = useState<Quality | undefined>();
  const [hindsight, setHindsight] = useState('');
  const [resolvedOn, setResolvedOn] = useState(today);

  if (!picked) {
    return (
      <div className="resolve">
        <div className="btn-row">
          {d.scenarios ? (
            d.scenarios.map((s) => (
              <button key={s.id} className="btn" onClick={() => setPicked({ kind: 'scenario', scenarioId: s.id })}>
                {s.label} <span className="muted num">{pct(s.probability)}</span>
              </button>
            ))
          ) : (
            <>
              <button className="btn yes" onClick={() => setPicked({ kind: 'outcome', outcome: true })}>
                It happened
              </button>
              <button className="btn no" onClick={() => setPicked({ kind: 'outcome', outcome: false })}>
                It did not
              </button>
            </>
          )}
          <button className="btn quiet" onClick={() => setPicked({ kind: 'void' })}>
            Void
          </button>
          {onSnooze && (
            <button className="btn quiet" aria-expanded={later} onClick={() => setLater(!later)}>
              Not yet
            </button>
          )}
          {onCancel && (
            <button className="btn quiet" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        {later && onSnooze && (
          <div className="btn-row">
            <span className="muted small">Review again in</span>
            {REVIEW_PRESETS.map((p) => (
              <button key={p.id} className="pill" onClick={() => onSnooze(p.from(today))}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const label =
    picked.kind === 'void' ? 'Void: not scored' : picked.kind === 'scenario' ? `Happened: ${d.scenarios?.find((s) => s.id === picked.scenarioId)?.label}` : picked.outcome ? 'It happened' : 'It did not happen';

  return (
    <div className="resolve">
      <div className="btn-row">
        <span className={`chip ${picked.kind === 'outcome' ? (picked.outcome ? 'good' : 'bad') : ''}`}>{label}</span>
        <button className="btn primary" onClick={() => onResolve(picked, resolvedOn, { lesson, quality, hindsight })}>
          Save review
        </button>
        <button className="btn quiet" onClick={() => setPicked(null)}>
          Back
        </button>
      </div>
      <label className="field">
        <span>Lesson, in a line (optional)</span>
        <input value={lesson} onChange={(e) => setLesson(e.target.value)} maxLength={240} />
      </label>
      {picked.kind !== 'void' && (
        <div className="field">
          <span id={`q-${d.id}`}>Leaving the result aside, was it a good call? (optional)</span>
          <div className="seg" role="group" aria-labelledby={`q-${d.id}`}>
            {QUALITY.map((q) => (
              <button key={q.id} type="button" className={quality === q.id ? 'on' : ''} aria-pressed={quality === q.id} onClick={() => setQuality(quality === q.id ? undefined : q.id)}>
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <details className="more">
        <summary>Hindsight note and date</summary>
        <div className="form">
          <label className="field">
            <span>Hindsight: what I knew then against how it turned out</span>
            <textarea value={hindsight} onChange={(e) => setHindsight(e.target.value)} rows={2} />
          </label>
          <label className="field">
            <span>Resolved on</span>
            <input type="date" value={resolvedOn} max={today} min={d.madeOn} onChange={(e) => e.target.value && setResolvedOn(e.target.value)} />
          </label>
        </div>
      </details>
    </div>
  );
}

/** A 0..1 Brier track: this call as a dot, the running average as a tick, 0.25 marked. */
function ImpactTrack({ own, before, after }: { own: number; before: number | null; after: number }) {
  const W = 320;
  const x = (v: number) => 10 + v * (W - 20);
  return (
    <svg className="track" viewBox={`0 0 ${W} 66`} role="img" aria-label={`This call scored ${score(own)} on a scale from 0, perfect, to 1. Your average is now ${score(after)}.`}>
      <text x={x(BRIER_FIFTY)} y={10} textAnchor="middle" className="axis-text">always 50%</text>
      <line x1={x(0)} x2={x(1)} y1={34} y2={34} className="track-base" />
      <line x1={x(BRIER_FIFTY)} x2={x(BRIER_FIFTY)} y1={16} y2={46} className="track-ref" />
      {before !== null && <line x1={x(before)} x2={x(after)} y1={34} y2={34} className={after <= before ? 'track-move good-stroke' : 'track-move bad-stroke'} />}
      <line x1={x(after)} x2={x(after)} y1={22} y2={46} className="track-avg" />
      <circle cx={x(own)} cy={34} r={6} className="track-dot" />
      <text x={x(0)} y={62} className="axis-text">0 perfect</text>
      <text x={x(1)} y={62} textAnchor="end" className="axis-text">1 worst</text>
    </svg>
  );
}

function ownWords(brier: number): string {
  if (brier <= 0.04) return 'A confident call that came true.';
  if (brier < 0.25) return 'On the right side.';
  if (brier === 0.25) return 'A coin flip, scored as one.';
  if (brier < 0.64) return 'On the wrong side.';
  return 'A confident call that went the other way. These cost the most.';
}

/** Shown straight after a review is saved: what that one result did to the score. */
export function ResultCard({ decisions, id, onDismiss }: { decisions: Decision[]; id: string; onDismiss: () => void }) {
  const d = decisions.find((x) => x.id === id);
  if (!d) return null;
  const impact = impactOf(decisions, id);
  const happenedIndex = d.scenarios?.findIndex((s) => s.id === d.resolvedScenarioId) ?? -1;

  return (
    <div className="result" role="status">
      <div className="card-head">
        <h3>{d.title}</h3>
        <button className="btn small" onClick={onDismiss}>
          Done
        </button>
      </div>
      {statusOf(d) === 'void' || !impact ? (
        <p className="muted">Marked void. It is kept in the journal but not scored.</p>
      ) : (
        <>
          <p>
            {d.scenarios && happenedIndex >= 0 ? (
              <>
                <b>{d.scenarios[happenedIndex].label}</b> happened. You gave it <b className="num">{pct(d.scenarios[happenedIndex].probability)}</b>
                {impact.o ? ', your top scenario.' : `; your top scenario was at ${pct(impact.p)}.`}
              </>
            ) : (
              <>
                You said <b className="num">{pct(impact.p)}</b>. {impact.o ? 'It happened.' : 'It did not happen.'}
              </>
            )}{' '}
            <span className="muted">{ownWords(impact.brier)}</span>
          </p>
          <div className="stats">
            <div className="stat">
              <b>{score(impact.brier)}</b>
              <span>Brier for this call</span>
            </div>
            <div className="stat">
              <b>
                {impact.brierBefore !== null && <span className="was">{score(impact.brierBefore)}</span>}
                {score(impact.brierAfter)}
              </b>
              <span>
                Average over {impact.n} {impact.n === 1 ? 'call' : 'calls'}
              </span>
            </div>
            <div className="stat">
              {impact.delta === null ? (
                <b>First</b>
              ) : (
                <b className={impact.delta < 0 ? 'good' : impact.delta > 0 ? 'bad' : ''}>
                  {impact.delta < 0 ? '−' : impact.delta > 0 ? '+' : ''}
                  {score(Math.abs(impact.delta))}
                </b>
              )}
              <span>{impact.delta === null ? 'scored call' : impact.delta < 0 ? 'Average improved (lower is better)' : impact.delta > 0 ? 'Average got worse (lower is better)' : 'No change'}</span>
            </div>
          </div>
          <ImpactTrack own={impact.brier} before={impact.brierBefore} after={impact.brierAfter} />
          <p className="muted small">
            Dot: this call. Tick: your average. Log score for this call <span className="num">{impact.logScore.toFixed(2)}</span>.
            {d.scenarios && happenedIndex >= 0 && (
              <>
                {' '}
                Across all scenarios the Brier score is{' '}
                <span className="num">
                  {score(
                    brierMulti(
                      d.scenarios.map((s) => s.probability),
                      happenedIndex,
                    ),
                  )}
                </span>{' '}
                on a 0 to 2 scale.
              </>
            )}
            {impact.n < MIN_READABLE && ` ${impact.n} scored so far: too few to read much into the average until there are ${MIN_READABLE}.`}
          </p>
        </>
      )}
    </div>
  );
}
