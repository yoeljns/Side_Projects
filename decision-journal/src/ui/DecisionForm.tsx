import { useState } from 'react';
import { formatDate, isDate, REVIEW_PRESETS } from '../lib/dates';
import { scenarioSum, STAKES, SUM_TOLERANCE, validateDraft, type Draft, type Scenario } from '../lib/model';
import { probabilityWords } from '../lib/scoring';
import { newId } from '../lib/store';

export function blankDraft(today: string, category: string): Draft {
  return { title: '', call: '', statement: '', probability: 0.7, category, stakes: 'medium', madeOn: today, reviewOn: REVIEW_PRESETS[1].from(today), notes: '', changeMind: '' };
}

const defaultScenarios = (): Scenario[] => [
  { id: newId(), label: 'Bear', probability: 0.25 },
  { id: newId(), label: 'Base', probability: 0.5 },
  { id: newId(), label: 'Bull', probability: 0.25 },
];

const clampPct = (n: number) => Math.min(99, Math.max(1, Math.round(n)));

interface Props {
  initial: Draft;
  categories: string[];
  submitLabel: string;
  onSubmit: (d: Draft) => void;
  onCancel?: () => void;
  /** Open the extra fields from the start (used when editing). */
  expanded?: boolean;
}

export function DecisionForm({ initial, categories, submitLabel, onSubmit, onCancel, expanded }: Props) {
  const [d, setD] = useState<Draft>(initial);
  const [pctText, setPctText] = useState(String(Math.round(initial.probability * 100)));
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<Draft>) => setD((old) => ({ ...old, ...patch }));
  const errors = validateDraft(d);
  const preset = REVIEW_PRESETS.find((p) => isDate(d.madeOn) && p.from(d.madeOn) === d.reviewOn);

  const setPct = (n: number) => {
    const v = clampPct(n);
    setPctText(String(v));
    set({ probability: v / 100 });
  };

  const setScenario = (id: string, patch: Partial<Scenario>) => set({ scenarios: d.scenarios!.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const sum = d.scenarios ? scenarioSum(d.scenarios) : 1;
  const sumOk = Math.abs(sum - 1) <= SUM_TOLERANCE;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errors.length) return;
    onSubmit(d);
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Title</span>
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="The decision in a few words" maxLength={140} />
      </label>

      {!d.scenarios && (
        <>
          <label className="field">
            <span>This works out as</span>
            <input value={d.statement} onChange={(e) => set({ statement: e.target.value })} placeholder="An outcome you can check on the review date" maxLength={240} />
          </label>
          <div className="field">
            <span id="prob-label">Probability that it happens</span>
            <div className="prob">
              <input type="range" min={1} max={99} step={1} value={Math.round(d.probability * 100)} onChange={(e) => setPct(Number(e.target.value))} aria-labelledby="prob-label" />
              <span className="prob-num">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  value={pctText}
                  onChange={(e) => {
                    setPctText(e.target.value);
                    const n = Number(e.target.value);
                    if (e.target.value !== '' && Number.isFinite(n)) set({ probability: clampPct(n) / 100 });
                  }}
                  onBlur={() => setPctText(String(Math.round(d.probability * 100)))}
                  aria-label="Probability in percent"
                />
                <span className="muted">%</span>
              </span>
              <span className="chip prob-words">{probabilityWords(d.probability)}</span>
            </div>
          </div>
        </>
      )}

      {d.scenarios && (
        <fieldset className="scenarios">
          <legend>Scenarios: exactly one will happen</legend>
          {d.scenarios.map((s, i) => (
            <div className="scenario-row" key={s.id}>
              <input value={s.label} onChange={(e) => setScenario(s.id, { label: e.target.value })} aria-label={`Scenario ${i + 1} name`} placeholder="Name" maxLength={80} />
              <span className="prob-num">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={Number.isFinite(s.probability) ? Math.round(s.probability * 1000) / 10 : ''}
                  onChange={(e) => setScenario(s.id, { probability: e.target.value === '' ? Number.NaN : Number(e.target.value) / 100 })}
                  aria-label={`Scenario ${i + 1} probability in percent`}
                />
                <span className="muted">%</span>
              </span>
              <button type="button" className="btn small" disabled={d.scenarios!.length <= 2} onClick={() => set({ scenarios: d.scenarios!.filter((x) => x.id !== s.id) })} aria-label={`Remove scenario ${i + 1}`}>
                Remove
              </button>
            </div>
          ))}
          <div className="btn-row">
            <button type="button" className="btn small" onClick={() => set({ scenarios: [...d.scenarios!, { id: newId(), label: '', probability: 0 }] })}>
              Add scenario
            </button>
            <span className={`small num ${sumOk ? 'muted' : 'bad'}`} role="status">
              Total {Number.isFinite(sum) ? `${Math.round(sum * 1000) / 10}%` : 'not a number'}
              {sumOk ? '' : ': must be 100%'}
            </span>
          </div>
        </fieldset>
      )}

      <div className="field">
        <span id="review-label">Review in</span>
        <div className="btn-row" role="group" aria-labelledby="review-label">
          {REVIEW_PRESETS.map((p) => (
            <button type="button" key={p.id} className={`pill ${preset?.id === p.id ? 'on' : ''}`} aria-pressed={preset?.id === p.id} onClick={() => isDate(d.madeOn) && set({ reviewOn: p.from(d.madeOn) })}>
              {p.label}
            </button>
          ))}
          <input type="date" value={d.reviewOn} min={d.madeOn} onChange={(e) => set({ reviewOn: e.target.value })} aria-label="Review date" />
        </div>
      </div>

      <div className="row">
        <label className="field">
          <span>Category</span>
          <select value={d.category} onChange={(e) => set({ category: e.target.value })}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="field">
          <span id="stakes-label">Stakes</span>
          <div className="seg" role="group" aria-labelledby="stakes-label">
            {STAKES.map((s) => (
              <button type="button" key={s} className={d.stakes === s ? 'on' : ''} aria-pressed={d.stakes === s} onClick={() => set({ stakes: s })}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <details className="more" open={expanded}>
        <summary>More: the call, notes, scenarios</summary>
        <div className="form">
          <label className="field">
            <span>The call I made</span>
            <input value={d.call} onChange={(e) => set({ call: e.target.value })} placeholder="What I actually decided to do" maxLength={240} />
          </label>
          <label className="field">
            <span>What would change my mind</span>
            <textarea value={d.changeMind} onChange={(e) => set({ changeMind: e.target.value })} rows={2} />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
          </label>
          <div className="row">
            <label className="field">
              <span>Decided on</span>
              <input type="date" value={d.madeOn} onChange={(e) => set({ madeOn: e.target.value })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={!!d.scenarios} onChange={(e) => set({ scenarios: e.target.checked ? defaultScenarios() : undefined })} />
              <span>Use named scenarios (bear, base, bull) instead of one yes/no outcome</span>
            </label>
          </div>
        </div>
      </details>

      {tried && errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="btn-row">
        <button className="btn primary" type="submit">
          {submitLabel}
        </button>
        {onCancel && (
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        {isDate(d.reviewOn) && <span className="muted small">Review on {formatDate(d.reviewOn)}</span>}
      </div>
    </form>
  );
}
