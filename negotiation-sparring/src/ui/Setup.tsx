import { useState } from 'react';
import { FAMILIES, FAMILY_IDS, type Difficulty, type FamilyId, type ScenarioRef, type Side } from '../engine/index.js';

const BLURB: Record<FamilyId, string> = {
  supplier: 'Unit price, volume, payment terms, lead time, exclusivity.',
  dealer: 'Price, trade-in, warranty, finance rate, servicing.',
  distribution: 'Margin, territory, minimum order, marketing money, contract length.',
  rate: 'Day rate, days per week, contract length, notice, on-site days.',
};

const LEVEL: Record<Difficulty, string> = {
  easy: 'Wide zone of agreement. A deal always exists.',
  medium: 'Narrower zone. Now and then no deal is possible.',
  hard: 'Tight zone, a tougher counterpart, and about one time in four the right answer is to walk.',
};

export function Setup({ onStart, counterpartNote }: { onStart: (ref: Omit<ScenarioRef, 'seed'>) => void; counterpartNote: string }) {
  const [family, setFamily] = useState<FamilyId>('supplier');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [role, setRole] = useState<Side>('a');
  return (
    <section className="card">
      <div className="card-head">
        <h2>New session</h2>
        <span className="small muted">{counterpartNote}</span>
      </div>
      <fieldset className="choices">
        <legend>Scenario</legend>
        {FAMILY_IDS.map((id) => (
          <label key={id} className={`choice ${family === id ? 'on' : ''}`}>
            <input type="radio" name="family" checked={family === id} onChange={() => setFamily(id)} />
            <span className="strong">{FAMILIES[id].title}</span>
            <span className="small muted">{BLURB[id]}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid-2">
        <fieldset className="choices one">
          <legend>You play</legend>
          {(['a', 'b'] as Side[]).map((s) => (
            <label key={s} className={`choice ${role === s ? 'on' : ''}`}>
              <input type="radio" name="role" checked={role === s} onChange={() => setRole(s)} />
              <span className="strong">{FAMILIES[family].roles[s]}</span>
              <span className="small muted">against the {FAMILIES[family].roles[s === 'a' ? 'b' : 'a'].toLowerCase()}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="choices one">
          <legend>Difficulty</legend>
          {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
            <label key={d} className={`choice ${difficulty === d ? 'on' : ''}`}>
              <input type="radio" name="difficulty" checked={difficulty === d} onChange={() => setDifficulty(d)} />
              <span className="strong">{d[0].toUpperCase() + d.slice(1)}</span>
              <span className="small muted">{LEVEL[d]}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <p className="small muted">
        Each session draws new numbers: the other side's priorities, walk-away point, one hard limit and a deadline stay hidden until the debrief.
      </p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => onStart({ family, difficulty, role })}>
          Start negotiating
        </button>
      </div>
    </section>
  );
}
