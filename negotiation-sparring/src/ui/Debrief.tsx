import { describeOffer, formatMoney, pointsToMoney, type Scenario, type Score, type Turn } from '../engine/index.js';
import { OfferCard } from './OfferCard';
import { Transcript } from './Session';
import { UtilityPlot } from './UtilityPlot';

const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(100 * x)}%`);
const one = (x: number) => x.toFixed(1);

export function Debrief({ sc, log, score, onNew, onReplay }: { sc: Scenario; log: Turn[]; score: Score; onNew: () => void; onReplay: () => void }) {
  const cash = (points: number) => formatMoney(sc, pointsToMoney(sc, points));
  const { bench, process: proc, deal } = score;
  const cap = sc.hidden.hardCap;
  const capIssue = sc.issues.find((i) => i.id === cap.issue)!;
  const cheap = sc.issues.find((i) => i.id === sc.hidden.cheapIssue)!;
  const price = sc.issues.find((i) => i.id === sc.priceIssue)!;
  const priceLabel = (v: number | null) => {
    if (v === null) return 'none';
    const hit = price.options.find((o) => Math.abs(o.value - v) < 1e-9);
    return hit ? hit.label : `about ${price.options.reduce((x, y) => (Math.abs(y.value - v) < Math.abs(x.value - v) ? y : x)).label}`;
  };
  const rounds = [...new Set([...proc.playerConcessions, ...proc.counterpartConcessions].map((c) => c.round))].sort((a, b) => a - b);
  const left = score.leftOnTable;
  return (
    <div className="debrief">
      <section className="card">
        <div className="verdict">
          <div className={`grade ${score.score >= 75 ? 'good' : score.score >= 25 ? 'warn' : 'bad'}`} aria-label={`Grade ${score.grade}`}>
            {score.grade}
          </div>
          <div>
            <h2>{score.headline}</h2>
            <p className="muted">
              {sc.title}, {sc.ref.difficulty}, as the {sc.player.roleLabel.toLowerCase()}. {proc.rounds} round{proc.rounds === 1 ? '' : 's'}.{' '}
              {proc.replies > 0 && (proc.scriptedReplies === proc.replies ? 'Scripted counterpart.' : proc.scriptedReplies === 0 ? 'AI counterpart.' : `AI counterpart; ${proc.scriptedReplies} of ${proc.replies} replies came from the script.`)}
            </p>
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <b>{score.score}</b>
            <span>Score (100 = Nash)</span>
          </div>
          <div className="stat">
            <b>{deal ? cash(score.surplus) : cash(0)}</b>
            <span>Your gain over your alternative</span>
          </div>
          <div className="stat">
            <b>{pct(score.nashShare)}</b>
            <span>Of what Nash gives you</span>
          </div>
          <div className="stat">
            <b>{pct(score.surplusShare)}</b>
            <span>Your share of the joint gain</span>
          </div>
          <div className="stat">
            <b>{left ? `${one(left.joint)} pts` : deal ? '0 pts' : 'n/a'}</b>
            <span>Left on the table</span>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn primary" onClick={onNew}>
            New session
          </button>
          <button className="btn" onClick={onReplay}>
            Replay this scenario
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Lessons from this session</h2>
        <ol className="lessons">
          {score.lessons.map((l, k) => (
            <li key={k}>{l}</li>
          ))}
        </ol>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>The utility space</h2>
          <UtilityPlot sc={sc} score={score} log={log} />
          <p className="small muted">
            Every dot is a package they could sign. Deals up and to the right of the dashed lines beat both alternatives
            {bench.zopaExists ? '.' : '; here there are none, so no agreement was possible.'}
          </p>
        </section>

        <section className="card">
          <h2>What they were hiding</h2>
          <ul className="list reveal">
            <li>
              <span>Their alternative</span>
              <span>
                {sc.counterpart.batnaStory} Worth <b className="num">{sc.counterpart.batna}</b> of their 100 points
                {deal ? <>; the deal gave them <b className="num">{one(deal.c)}</b></> : null}.
              </span>
            </li>
            <li>
              <span>Hard limit</span>
              <span>
                {capIssue.label}: only {capIssue.options[cap.min].label} to {capIssue.options[cap.max].label}. {cap.story}
              </span>
            </li>
            <li>
              <span>Deadline</span>
              <span>
                Faster concessions from round {sc.hidden.deadlineRound}, final offer in round {sc.hidden.maxRounds}, then they walk. {sc.hidden.deadlineStory}
              </span>
            </li>
            <li>
              <span>Cheap issue</span>
              <span>
                {cheap.label}: {Math.round(100 * sc.counterpart.weights[cheap.id])}% of their weight, {Math.round(100 * sc.player.weights[cheap.id])}% of yours.
              </span>
            </li>
            <li>
              <span>Patience</span>
              <span className="num">
                Discount factor {sc.counterpart.discount.toFixed(2)} a round against your {sc.player.discount.toFixed(2)}.
              </span>
            </li>
          </ul>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th className="num">Your weight</th>
                  <th className="num">Theirs</th>
                  <th>They wanted</th>
                </tr>
              </thead>
              <tbody>
                {sc.issues.map((i) => (
                  <tr key={i.id}>
                    <td>{i.label}</td>
                    <td className="num">{Math.round(100 * sc.player.weights[i.id])}%</td>
                    <td className="num">{Math.round(100 * sc.counterpart.weights[i.id])}%</td>
                    <td>{i.options[sc.counterpart.values[i.id].indexOf(1)].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Benchmarks</h2>
          {bench.nash ? (
            <>
              <OfferCard sc={sc} offer={bench.nash.offer} title={`Nash bargaining solution (them: ${one(bench.nash.c)} points)`} />
              {bench.ks && (
                <p className="small">
                  <b>Kalai-Smorodinsky:</b>{' '}
                  {bench.ks === bench.nash ? 'the same package.' : `${describeOffer(sc.issues, bench.ks.offer)}. Worth ${cash(bench.ks.p)} to you, ${one(bench.ks.c)} points to them.`}
                </p>
              )}
            </>
          ) : (
            <p>No package inside their hard limit was worth more than both alternatives, so there is no Nash or Kalai-Smorodinsky point. Walking away was the benchmark.</p>
          )}
          {left && deal && (
            <p className="small">
              <b>A better deal for both:</b> {left.changes.map((c) => `${c.label.toLowerCase()} ${c.from} to ${c.to}`).join(', ')}. You {cash(left.player)} better off, them {one(left.counterpart)} points.
            </p>
          )}
          <p className="small">
            <b>{price.label} alone,</b> with every other issue at its middle option: you could go to {priceLabel(bench.price.playerLimit)}, they could go to{' '}
            {priceLabel(bench.price.counterpartLimit)}.{' '}
            {bench.price.exists
              ? `Alternating offers with you proposing first (Rubinstein) gives you ${Math.round(100 * bench.price.playerShare)}% of that zone: ${priceLabel(bench.price.rubinsteinPrice)}.`
              : 'On that issue alone there is no zone of agreement; any deal had to come from trading across issues.'}
          </p>
        </section>

        <section className="card">
          <h2>How the offers moved</h2>
          <p>
            {proc.firstAnchor === null ? 'Nobody put a full offer down.' : proc.firstAnchor === 'player' ? 'You made the first offer.' : 'They made the first offer.'}
          </p>
          {rounds.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">Round</th>
                    <th className="num">You gave up</th>
                    <th className="num">They gave up</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((r) => {
                    const a = proc.playerConcessions.find((c) => c.round === r);
                    const b = proc.counterpartConcessions.find((c) => c.round === r);
                    return (
                      <tr key={r}>
                        <td className="num">{r}</td>
                        <td className="num">{a ? `${one(a.points)} pts` : ''}</td>
                        <td className="num">{b ? `${one(b.points)} pts` : ''}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="num strong">Total</td>
                    <td className="num strong">{one(proc.playerTotal)} pts</td>
                    <td className="num strong">{one(proc.counterpartTotal)} pts</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Too few offers to compare concessions.</p>
          )}
          <p className="small muted">Each side's concessions are in its own points: how much worse its new offer was for itself than its last.</p>
          {proc.wasted.length > 0 && (
            <p className="small">
              <b>Concessions that bought little:</b>{' '}
              {proc.wasted.map((w) => `round ${w.round}, ${w.label.toLowerCase()} (cost you ${one(w.cost)} pts, worth ${one(Math.max(0, w.gain))} to them)`).join('; ')}.
            </p>
          )}
        </section>
      </div>

      <section className="card">
        <details>
          <summary className="strong">Transcript</summary>
          <Transcript sc={sc} log={log} />
        </details>
      </section>
    </div>
  );
}
