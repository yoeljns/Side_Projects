import { CITIES, WEEKDAYS, addDays, addMinutes, fmtDay, isoWeekday, relDay } from '../lib/dates.ts';
import type { City } from '../lib/dates.ts';
import { WHEN_LABEL, WHEN_OFFSET } from '../lib/model.ts';
import type { Checklist } from '../lib/model.ts';
import { whatsNext } from '../lib/next.ts';
import { checklistMarkdown, openChecklists, placeText, planFor, routineIcs } from '../lib/switch.ts';
import { download, downloadIcs } from './bits.tsx';
import type { TabProps } from './bits.tsx';

const AREA = { ledger: 'Ledger', matchday: 'Matchday', trips: 'Trips' } as const;

export function Today({ doc, update, today, now, onSwitch, goTo }: TabProps & { onSwitch: (c: City) => void; goTo: (t: 'Ledger' | 'Matchday' | 'Trips' | 'Settings') => void }) {
  const city = doc.mode;
  const profile = doc.profiles[city];
  const plan = planFor(profile, today);
  const open = openChecklists(doc);
  const history = doc.checklists.filter((c) => c.archived).reverse();
  const next = whatsNext(doc, today);
  const label = CITIES[city].label;

  const tick = (listId: string, itemId: string) =>
    update((d) => ({ ...d, checklists: d.checklists.map((c) => (c.id === listId ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)) } : c)) }));

  const list = (c: Checklist) => {
    const done = c.items.filter((i) => i.done).length;
    return (
      <section className="card" key={c.id}>
        <div className="card-head">
          <h2>{c.kind === 'packing' ? `Packing for ${CITIES[c.city].label}` : `Landing in ${CITIES[c.city].label}`}</h2>
          <span className="muted small num">{done} of {c.items.length} done</span>
        </div>
        {c.items.length === 0 ? (
          <p className="empty">This list is empty. Add items to the {c.kind} template in Settings; they appear on the next switch.</p>
        ) : (
          <ul className="checks">
            {c.items.map((i) => (
              <li key={i.id}>
                <label>
                  <input type="checkbox" checked={i.done} onChange={() => tick(c.id, i.id)} />
                  <span className={i.done ? 'done' : ''}>{i.text}</span>
                  {i.when && <span className="when muted small">{WHEN_LABEL[i.when]}, {fmtDay(addDays(c.createdOn, WHEN_OFFSET[i.when]), { year: false })}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <>
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>{WEEKDAYS[isoWeekday(today) - 1]} in {label}</h2>
            <span className={`chip ${city}`}>{label} routine</span>
          </div>
          {plan.length === 0 ? (
            <p className="empty">Nothing in the {label} routine for this day of the week. Edit the routine in Settings.</p>
          ) : (
            <ol className="plan">
              {plan.map((b) => (
                <li key={b.id}>
                  <span className="time">{b.start}–{addMinutes(b.start, b.minutes)}</span>
                  <span>{b.label}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="btn-row no-print">
            <button className="btn small" onClick={() => downloadIcs(`routine-${city}.ics`, routineIcs(profile, city, today, now.toISOString()))} disabled={!profile.routine.length}>
              Download {label} routine (.ics)
            </button>
            <button className="btn small" onClick={() => goTo('Settings')}>Edit routine</button>
          </div>
          <p className="muted small">The .ics holds each block as a weekly event in {label} time. Import it into a calendar kept for this city and show or hide that calendar when you switch.</p>
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>{label} defaults</h2>
            </div>
            <dl className="kv">
              <dt>Court</dt>
              <dd className={profile.court.name.trim() ? '' : 'muted'}>{placeText(profile.court)}</dd>
              <dt>Gym</dt>
              <dd className={profile.gym.name.trim() ? '' : 'muted'}>{placeText(profile.gym)}</dd>
              {profile.defaults.filter((d) => d.key.trim()).map((d) => (
                <div key={d.id} style={{ display: 'contents' }}>
                  <dt>{d.key}</dt>
                  <dd className={d.value.trim() ? '' : 'muted'}>{d.value.trim() || 'not set'}</dd>
                </div>
              ))}
            </dl>
            {!profile.court.name.trim() && !profile.gym.name.trim() && (
              <p className="muted small">Set the court, gym and other defaults for each city in <button className="btn small" onClick={() => goTo('Settings')}>Settings</button></p>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>What matters next</h2>
            </div>
            {next.length === 0 ? (
              <p className="empty">Nothing yet. Add stays in the Ledger, load fixtures in Matchday, or add a trip, and the next dates show up here.</p>
            ) : (
              <ul className="list next">
                {next.map((n, i) => (
                  <li key={i}>
                    <span className={`chip ${n.tone === 'plain' ? '' : n.tone}`}>{AREA[n.area]}</span>
                    <span className="txt">{n.text}</span>
                    <span className="when muted small num">{n.date ? relDay(n.date, today) : 'now'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {open.length === 0 ? (
        <section className="card">
          <h2>Checklists</h2>
          <p className="empty">
            No open checklists. Each switch deals a packing list for the journey and a landing list for the first days, from the templates in Settings.
          </p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => onSwitch(city)}>Deal lists for {label}</button>
          </div>
        </section>
      ) : (
        <>
          <div className="grid-2">{open.map(list)}</div>
          <div className="btn-row no-print">
            <button className="btn small" onClick={() => download(`checklist-${city}-${doc.switchedOn ?? today}.md`, checklistMarkdown(doc, city, doc.switchedOn ?? today), 'text/markdown;charset=utf-8')}>
              Download checklists (.md)
            </button>
            <button className="btn small" onClick={() => window.print()}>Print</button>
          </div>
        </>
      )}

      {history.length > 0 && (
        <section className="card no-print">
          <details className="more">
            <summary>History: {history.length} earlier {history.length === 1 ? 'list' : 'lists'}</summary>
            <ul className="list">
              {history.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.kind === 'packing' ? 'Packing for' : 'Landing in'} {CITIES[c.city].label}, {fmtDay(c.createdOn, { weekday: false })}
                  </span>
                  <span className="muted small num">{c.items.filter((i) => i.done).length} of {c.items.length} done</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </>
  );
}
