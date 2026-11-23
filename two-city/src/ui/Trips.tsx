import { useState } from 'react';
import { AIRPORT } from '../lib/airports.ts';
import { MONTHS, daysBetween, fmtDay, isDay, relDay, uid } from '../lib/dates.ts';
import type { Day } from '../lib/dates.ts';
import { writeIcs } from '../lib/ics.ts';
import { STATUS_LABEL, blankTrip, evaluateTrip, fareStats, orcaTemplate, parseFares, seasonWindow, triggerEvents, whatMattersNext } from '../lib/triggers.ts';
import type { DateTrigger, Fare, FareTrigger, Status, Trigger, TriggerState, Trip } from '../lib/triggers.ts';
import { Field, NumberInput, downloadIcs, plural } from './bits.tsx';
import type { TabProps } from './bits.tsx';

const STATUS_CLASS: Record<Status, string> = { waiting: '', 'coming-up': 'warn', 'open-now': 'accent', fired: 'good', missed: 'bad' };
const KIND_LABEL = { opens: 'Opens', decide: 'Decide by', book: 'Book by', fare: 'Fare' } as const;
const code = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
const md = (s: string) => `${Number(s.slice(3))} ${MONTHS[Number(s.slice(0, 2)) - 1]}`;

function Sparkline({ trip, t }: { trip: Trip; t: FareTrigger }) {
  const s = fareStats(trip.fares, t);
  if (s.log.length < 2) return <p className="muted small">{s.log.length === 0 ? 'No fares logged for this route and currency yet.' : 'One fare logged. The chart appears from the second.'}</p>;
  const W = 320;
  const H = 96;
  const pad = { l: 6, r: 48, t: 10, b: 16 };
  const values = [...s.log.map((f) => f.price), ...(s.threshold !== null ? [s.threshold] : []), ...(s.median !== null ? [s.median] : [])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const t0 = s.log[0].on;
  const days = Math.max(1, daysBetween(t0, s.log[s.log.length - 1].on));
  const x = (d: Day) => pad.l + (daysBetween(t0, d) / days) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const last = s.log[s.log.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Fares ${t.from} to ${t.to}: latest ${last.price} ${t.currency}${s.threshold !== null ? `, fires at ${Math.round(s.threshold)}` : ''}`}>
      {s.median !== null && <line className="med" x1={pad.l} x2={W - pad.r} y1={y(s.median)} y2={y(s.median)} />}
      {s.threshold !== null && (
        <>
          <line className="thr" x1={pad.l} x2={W - pad.r} y1={y(s.threshold)} y2={y(s.threshold)} />
          <text x={W - pad.r + 4} y={y(s.threshold) + 3}>{Math.round(s.threshold)} line</text>
        </>
      )}
      <polyline className="line" points={s.log.map((f) => `${x(f.on).toFixed(1)},${y(f.price).toFixed(1)}`).join(' ')} />
      {s.log.map((f) => (
        <circle key={f.id} className="pt" cx={x(f.on)} cy={y(f.price)} r={f === last ? 3.5 : 2}>
          <title>{`${fmtDay(f.on, { weekday: false })}: ${f.price} ${f.currency} (${f.source})`}</title>
        </circle>
      ))}
      {(s.threshold === null || Math.abs(y(last.price) - y(s.threshold)) > 10) && <text x={W - pad.r + 4} y={y(last.price) + 3}>{Math.round(last.price)}</text>}
      <text x={pad.l} y={H - 3}>{fmtDay(t0, { weekday: false, year: false })}</text>
      <text x={W - pad.r} y={H - 3} textAnchor="end">{fmtDay(last.on, { weekday: false, year: false })}</text>
    </svg>
  );
}

function TriggerEditor({ trip, t, onChange, onRemove }: { trip: Trip; t: Trigger; onChange: (t: Trigger) => void; onRemove: () => void }) {
  return (
    <details className="more">
      <summary>Edit</summary>
      <div className="form-grid">
        <Field label="Label" className="span"><input value={t.label} onChange={(e) => onChange({ ...t, label: e.target.value })} /></Field>
        {t.kind === 'fare' ? (
          <>
            <Field label="From"><input value={t.from} onChange={(e) => onChange({ ...t, from: code(e.target.value) })} placeholder="LHR" /></Field>
            <Field label="To"><input value={t.to} onChange={(e) => onChange({ ...t, to: code(e.target.value) })} placeholder="TOS" /></Field>
            <Field label="Currency"><input value={t.currency} onChange={(e) => onChange({ ...t, currency: code(e.target.value) })} placeholder="GBP" /></Field>
            <Field label="Target price (optional)"><NumberInput className="num" label="Target price" value={t.targetPrice ?? null} onChange={(n) => onChange({ ...t, targetPrice: n ?? undefined })} /></Field>
            <Field label="Drop below median, % (optional)"><NumberInput className="num" label="Drop percent" value={t.dropPct ?? null} onChange={(n) => onChange({ ...t, dropPct: n ?? undefined })} /></Field>
            <Field label="Median over the last, days"><NumberInput className="num" label="Median window in days" value={t.medianDays} min={7} onChange={(n) => onChange({ ...t, medianDays: n ?? 60 })} /></Field>
          </>
        ) : (
          <>
            <Field label="Kind">
              <select value={t.kind} onChange={(e) => onChange({ ...t, kind: e.target.value as DateTrigger['kind'] })}>
                <option value="opens">Something opens</option>
                <option value="decide">Decide by</option>
                <option value="book">Book by</option>
              </select>
            </Field>
            <Field label="Counted back from">
              <select value={t.anchor} onChange={(e) => onChange({ ...t, anchor: e.target.value as DateTrigger['anchor'] })}>
                <option value="season">Start of the season</option>
                <option value="travel">Target travel date{trip.travel ? '' : ' (not set)'}</option>
              </select>
            </Field>
            <Field label="Days before"><NumberInput className="num" label="Days before" value={t.daysBefore} onChange={(n) => onChange({ ...t, daysBefore: n ?? 0 })} /></Field>
            <Field label="Or an exact date"><input type="date" value={t.fixedDate ?? ''} onChange={(e) => onChange({ ...t, fixedDate: isDay(e.target.value) ? e.target.value : undefined })} /></Field>
          </>
        )}
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn small danger" onClick={onRemove}>Remove trigger</button>
      </div>
    </details>
  );
}

function FareLog({ trip, patch, today }: { trip: Trip; patch: (fn: (t: Trip) => Trip) => void; today: Day }) {
  const routes = [...new Map([...trip.routes, ...trip.triggers.filter((t): t is FareTrigger => t.kind === 'fare').map((t) => ({ from: t.from, to: t.to }))].map((r) => [`${r.from}-${r.to}`, r])).values()];
  const firstFare = trip.triggers.find((t): t is FareTrigger => t.kind === 'fare');
  const [route, setRoute] = useState(routes[0] ? `${routes[0].from}-${routes[0].to}` : '');
  const [on, setOn] = useState(today);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(firstFare?.currency ?? 'GBP');
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [note, setNote] = useState('');
  const sel = routes.find((r) => `${r.from}-${r.to}` === route) ?? routes[0];
  const add = (rows: Omit<Fare, 'id'>[]) => patch((t) => ({ ...t, fares: [...t.fares, ...rows.map((r) => ({ ...r, id: uid() }))].sort((a, b) => a.on.localeCompare(b.on)) }));
  const recent = [...trip.fares].sort((a, b) => b.on.localeCompare(a.on)).slice(0, 8);

  if (!routes.length) return <p className="muted small">Add a route to watch (under Edit trip) to start a fare log.</p>;
  return (
    <div className="stack">
      <h3>Fare log</h3>
      <p className="muted small">No fare API is bundled. Fares get here when you type them in, paste them, or import JSON (for example from a scheduled Claude task: the prompt is in the README).</p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const p = Number(price.replace(',', '.'));
          if (!sel || !isDay(on) || !(p > 0)) return;
          add([{ on, from: sel.from, to: sel.to, price: p, currency: currency || 'GBP', source: source.trim() || 'typed' }]);
          setPrice('');
        }}
      >
        <Field label="Route">
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            {routes.map((r) => <option key={`${r.from}-${r.to}`} value={`${r.from}-${r.to}`}>{r.from} to {r.to}</option>)}
          </select>
        </Field>
        <Field label="Seen on"><input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} /></Field>
        <Field label="Price"><input className="num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="412" /></Field>
        <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(code(e.target.value))} /></Field>
        <Field label="Source"><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="airline site" /></Field>
        <button className="btn" type="submit" disabled={!(Number(price.replace(',', '.')) > 0)}>Log fare</button>
      </form>
      <details className="more">
        <summary>Paste or import several</summary>
        <div className="stack">
          <Field label="One fare per line (date, route, price, currency, source), or JSON">
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} placeholder={`${today}, ${sel ? `${sel.from}-${sel.to}` : 'LHR-TOS'}, 412 ${currency}, airline site`} />
          </Field>
          <div className="btn-row">
            <button
              className="btn"
              disabled={!paste.trim()}
              onClick={() => {
                const r = parseFares(paste, { from: sel?.from ?? '', to: sel?.to ?? '', currency });
                if (r.fares.length) add(r.fares);
                setNote(`${plural(r.fares.length, 'fare')} added.${r.errors.length ? ` ${r.errors.join(' ')}` : ''}`);
                if (!r.errors.length) setPaste('');
              }}
            >
              Add to the log
            </button>
          </div>
          {note && <p className="small" role="status">{note}</p>}
        </div>
      </details>
      {recent.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Seen</th><th>Route</th><th className="num">Price</th><th>Source</th><th /></tr></thead>
            <tbody>
              {recent.map((f) => (
                <tr key={f.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(f.on, { weekday: false })}</td>
                  <td>{f.from} to {f.to}</td>
                  <td className="num">{f.price} {f.currency}</td>
                  <td className="muted small">{f.source}</td>
                  <td className="num"><button className="icon-btn" aria-label={`Delete fare of ${f.price} ${f.currency} on ${f.on}`} onClick={() => patch((t) => ({ ...t, fares: t.fares.filter((x) => x.id !== f.id) }))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {trip.fares.length > recent.length && <p className="muted small">Showing the latest {recent.length} of {trip.fares.length}.</p>}
        </div>
      )}
    </div>
  );
}

function TripCard({ trip, update, today }: { trip: Trip; update: TabProps['update']; today: Day }) {
  const patch = (fn: (t: Trip) => Trip) => update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === trip.id ? fn(t) : t)) }));
  const setTrigger = (next: Trigger) => patch((t) => ({ ...t, triggers: t.triggers.map((x) => (x.id === next.id ? next : x)) }));
  const states = evaluateTrip(trip, today);
  const season = seasonWindow(trip.season, today);
  const [newRoute, setNewRoute] = useState({ from: '', to: '' });
  const setSeason = (edge: 'from' | 'to', part: 'm' | 'd', v: number) =>
    patch((t) => {
      const cur = t.season[edge];
      const m = part === 'm' ? v : Number(cur.slice(0, 2));
      const d = part === 'd' ? v : Number(cur.slice(3));
      return { ...t, season: { ...t.season, [edge]: `${String(m).padStart(2, '0')}-${String(Math.min(31, Math.max(1, d))).padStart(2, '0')}` } };
    });

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{trip.name || 'Untitled trip'}</h2>
          <p className="muted small">
            {trip.destination ? `${trip.destination}. ` : ''}Season {md(trip.season.from)} to {md(trip.season.to)}, every year; {season.start <= today ? `under way until ${fmtDay(season.end, { weekday: false })}` : `next starts ${fmtDay(season.start, { weekday: false })}`}.
            {trip.travel ? ` Target travel ${fmtDay(trip.travel.from, { weekday: false })}${trip.travel.to ? ` to ${fmtDay(trip.travel.to, { weekday: false })}` : ''}.` : ''}
          </p>
        </div>
        {trip.routes.length > 0 && <span className="muted small num">{trip.routes.map((r) => `${r.from}–${r.to}`).join(', ')}</span>}
      </div>

      {trip.template && (
        <div className="banner warn">
          <div className="small"><b>Template.</b> The season and trigger dates are rough starting points. Confirm them with the operator and edit them below.</div>
          <button className="btn small" onClick={() => patch((t) => ({ ...t, template: undefined }))}>I have confirmed the dates</button>
        </div>
      )}
      {trip.notes && <p className="small">{trip.notes}</p>}

      {states.length === 0 ? (
        <p className="empty">No triggers yet. Add a date trigger (something opens, decide by, book by) or a fare trigger below.</p>
      ) : (
        <div>
          {states.map((s) => {
            const t = s.trigger;
            return (
              <div className="edit-row" key={t.id}>
                <div className="stay-head">
                  <div className="what">
                    <span className={`chip ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                    <span className="strong">{t.label || KIND_LABEL[t.kind]}</span>
                  </div>
                  {t.kind !== 'fare' && (
                    <button className="btn small" onClick={() => setTrigger({ ...t, doneOn: t.doneOn ? undefined : today })}>{t.doneOn ? 'Not done after all' : 'Mark done'}</button>
                  )}
                </div>
                <p className="muted small num">
                  {t.kind === 'fare' ? `${t.from} to ${t.to}, ${[t.targetPrice ? `target ${t.targetPrice} ${t.currency}` : '', t.dropPct ? `${t.dropPct}% below the ${t.medianDays}-day median` : ''].filter(Boolean).join(' or ') || 'no threshold set'}. ` : `${KIND_LABEL[t.kind]}${t.fixedDate ? ', date set by hand' : `, ${t.daysBefore} days before ${t.anchor === 'travel' && trip.travel ? 'travel' : 'the season'}`}. `}
                  {s.detail}
                </p>
                {t.kind === 'fare' && <Sparkline trip={trip} t={t} />}
                <TriggerEditor trip={trip} t={t} onChange={setTrigger} onRemove={() => patch((x) => ({ ...x, triggers: x.triggers.filter((y) => y.id !== t.id) }))} />
              </div>
            );
          })}
        </div>
      )}
      <div className="btn-row">
        <button className="btn small" onClick={() => patch((t) => ({ ...t, triggers: [...t.triggers, { id: uid(), kind: 'opens', label: 'Booking opens', anchor: 'season', daysBefore: 330 }] }))}>Add date trigger</button>
        <button
          className="btn small"
          onClick={() => patch((t) => ({ ...t, triggers: [...t.triggers, { id: uid(), kind: 'fare', label: 'Fare drop', from: t.routes[0]?.from ?? '', to: t.routes[0]?.to ?? '', currency: 'GBP', dropPct: 20, medianDays: 60 }] }))}
        >
          Add fare trigger
        </button>
      </div>

      <FareLog trip={trip} patch={patch} today={today} />

      <details className="more" open={!trip.name}>
        <summary>Edit trip</summary>
        <div className="stack">
          <div className="form-grid">
            <Field label="Name"><input value={trip.name} onChange={(e) => patch((t) => ({ ...t, name: e.target.value }))} placeholder="Northern lights" /></Field>
            <Field label="Destination"><input value={trip.destination} onChange={(e) => patch((t) => ({ ...t, destination: e.target.value }))} /></Field>
          </div>
          <div className="form-grid">
            {(['from', 'to'] as const).map((edge) => (
              <Field key={edge} label={edge === 'from' ? 'Season starts' : 'Season ends'}>
                <span className="inline">
                  <NumberInput label={`Season ${edge} day`} value={Number(trip.season[edge].slice(3))} min={1} onChange={(n) => setSeason(edge, 'd', n ?? 1)} />
                  <select aria-label={`Season ${edge} month`} value={Number(trip.season[edge].slice(0, 2))} onChange={(e) => setSeason(edge, 'm', Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </span>
              </Field>
            ))}
            <Field label="Target travel from (optional)">
              <input type="date" value={trip.travel?.from ?? ''} onChange={(e) => patch((t) => ({ ...t, travel: isDay(e.target.value) ? { ...t.travel, from: e.target.value } : undefined }))} />
            </Field>
            <Field label="Target travel to">
              <input type="date" value={trip.travel?.to ?? ''} disabled={!trip.travel} min={trip.travel?.from} onChange={(e) => patch((t) => (t.travel ? { ...t, travel: { from: t.travel.from, ...(isDay(e.target.value) ? { to: e.target.value } : {}) } } : t))} />
            </Field>
          </div>
          <div>
            <h3>Routes to watch</h3>
            <ul className="list">
              {trip.routes.map((r, i) => (
                <li key={i}>
                  <span className="num">{r.from} ({AIRPORT[r.from]?.city ?? 'unknown code'}) to {r.to} ({AIRPORT[r.to]?.city ?? 'unknown code'})</span>
                  <button className="icon-btn" aria-label={`Remove route ${r.from} to ${r.to}`} onClick={() => patch((t) => ({ ...t, routes: t.routes.filter((_, j) => j !== i) }))}>×</button>
                </li>
              ))}
            </ul>
            <form
              className="inline"
              onSubmit={(e) => {
                e.preventDefault();
                if (newRoute.from.length !== 3 || newRoute.to.length !== 3) return;
                patch((t) => ({ ...t, routes: [...t.routes, newRoute] }));
                setNewRoute({ from: '', to: '' });
              }}
            >
              <input className="narrow" aria-label="From airport code" value={newRoute.from} onChange={(e) => setNewRoute({ ...newRoute, from: code(e.target.value) })} placeholder="LHR" />
              <span className="muted">to</span>
              <input className="narrow" aria-label="To airport code" value={newRoute.to} onChange={(e) => setNewRoute({ ...newRoute, to: code(e.target.value) })} placeholder="TOS" />
              <button className="btn small" type="submit" disabled={newRoute.from.length !== 3 || newRoute.to.length !== 3}>Add route</button>
            </form>
          </div>
          <Field label="Notes"><textarea value={trip.notes} onChange={(e) => patch((t) => ({ ...t, notes: e.target.value }))} rows={3} /></Field>
          <div className="btn-row">
            <button className="btn small danger" onClick={() => confirm(`Delete ${trip.name || 'this trip'} and its fare log?`) && update((d) => ({ ...d, trips: d.trips.filter((t) => t.id !== trip.id) }))}>Delete trip</button>
          </div>
        </div>
      </details>
    </section>
  );
}

function NextList({ items, today }: { items: TriggerState[]; today: Day }) {
  return (
    <ul className="list next">
      {items.map((s) => (
        <li key={`${s.tripId}-${s.trigger.id}`}>
          <span className={`chip ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
          <span className="txt"><b>{s.tripName || 'Untitled trip'}</b>: {s.trigger.label}. <span className="muted">{s.detail}</span></span>
          <span className="when muted small num">{s.date && (s.status === 'waiting' || s.status === 'coming-up') ? relDay(s.date, today) : ''}</span>
        </li>
      ))}
    </ul>
  );
}

export function Trips({ doc, update, today, now }: TabProps) {
  const next = whatMattersNext(doc.trips, today);
  const events = triggerEvents(doc.trips, today);
  const hasOrca = doc.trips.some((t) => t.name === 'Norway orca season');
  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>What matters next</h2>
          <button className="btn small" disabled={!events.length} onClick={() => downloadIcs('trip-triggers.ics', writeIcs(events, { name: 'Trip triggers', stamp: now.toISOString() }))}>
            Download {plural(events.length, 'upcoming date')} (.ics)
          </button>
        </div>
        {doc.trips.length === 0 ? (
          <p className="empty">No trips yet. A trip watches the moments that matter: when booking opens, when to decide, when to book, and when a fare on its routes drops.</p>
        ) : next.length === 0 ? (
          <p className="empty">Nothing coming up. Add triggers to a trip below.</p>
        ) : (
          <NextList items={next} today={today} />
        )}
        {events.length > 0 && <p className="muted small">The calendar file has a reminder at 09:00 the day before and on the day of each date. Fare triggers are not in it: they depend on fares you log.</p>}
        <div className="btn-row">
          <button className="btn primary" onClick={() => update((d) => ({ ...d, trips: [...d.trips, blankTrip(uid())] }))}>Add a trip</button>
          {!hasOrca && <button className="btn" onClick={() => update((d) => ({ ...d, trips: [...d.trips, orcaTemplate(uid())] }))}>Add the Norway orca season template</button>}
        </div>
      </section>
      {doc.trips.map((t) => <TripCard key={t.id} trip={t} update={update} today={today} />)}
    </>
  );
}
