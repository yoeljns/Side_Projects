import { formatMoney, pointsToMoney, type Scenario } from '../engine/index.js';

/** The player's side of the table: what they know going in. */
export function Brief({ sc }: { sc: Scenario }) {
  const me = sc.player;
  return (
    <div className="brief">
      <p>{sc.setting}</p>
      <p>
        You are the <b>{me.roleLabel.toLowerCase()}</b>, facing the {sc.counterpart.roleLabel.toLowerCase()}.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Issue</th>
              <th>You want</th>
              <th className="num">Weight</th>
              <th className="num">Worst to best</th>
            </tr>
          </thead>
          <tbody>
            {sc.issues.map((i) => {
              const v = me.values[i.id];
              const best = i.options[v.indexOf(1)].label;
              return (
                <tr key={i.id}>
                  <td>{i.label}</td>
                  <td>{best}</td>
                  <td className="num">{Math.round(100 * me.weights[i.id])}%</td>
                  <td className="num">{formatMoney(sc, pointsToMoney(sc, 100 * me.weights[i.id]))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        "Worst to best" is what moving an issue from your worst option to your best is worth to you. Steps are not all equal; the offer form shows the
        worth of any package.
      </p>
      <p>
        <b>Your alternative.</b> {me.batnaStory} It is worth <b className="num">{formatMoney(sc, pointsToMoney(sc, me.batna))}</b> to you. A deal worth
        less than that is worse than walking away.
      </p>
      <p className="small muted">
        Hidden from you: their priorities, what their alternative is worth, a hard limit on one issue, and a deadline after which they concede faster and
        then walk. Your patience (discount factor {me.discount.toFixed(2)} a round) is used only for the Rubinstein benchmark in the debrief.
      </p>
    </div>
  );
}
