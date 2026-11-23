import { formatMoney, playerUtility, pointsToMoney, type Offer, type Scenario } from '../engine/index.js';

/** What a package is worth to the player, in money and against their alternative. */
export function Worth({ sc, offer }: { sc: Scenario; offer: Offer }) {
  const u = playerUtility(sc, offer);
  const gap = u - sc.player.batna;
  return (
    <span className="worth num">
      Worth {formatMoney(sc, pointsToMoney(sc, u))} to you{' '}
      <span className={`chip ${gap >= 0 ? 'good' : 'bad'}`}>
        {formatMoney(sc, Math.abs(pointsToMoney(sc, gap)))} {gap >= 0 ? 'above' : 'below'} your alternative
      </span>
    </span>
  );
}

/** One structured offer. Terms that differ from `prev` are marked. */
export function OfferCard({ sc, offer, prev, title }: { sc: Scenario; offer: Offer; prev?: Offer; title?: string }) {
  return (
    <div className="offer">
      {title && <div className="small muted strong">{title}</div>}
      <dl>
        {sc.issues.map((i) => {
          const changed = prev !== undefined && prev[i.id] !== offer[i.id];
          return (
            <div key={i.id} className={changed ? 'changed' : undefined}>
              <dt>{i.label}</dt>
              <dd className="num">
                {i.options[offer[i.id]].label}
                {changed && <span className="sr-only"> (changed)</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      <Worth sc={sc} offer={offer} />
    </div>
  );
}
