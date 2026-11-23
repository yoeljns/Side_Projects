import { useMemo, useState } from 'react';
import { AIRPORT, cityKey, countryForCity, countryName } from '../lib/airports.ts';
import { applyImport, flightsFromIcs, parseConfirmation, planImport } from '../lib/bookings.ts';
import type { ImportPlan, ParsedFlights } from '../lib/bookings.ts';
import { MONTHS, addDays, daysBetween, fmtDay, isDay, maxDay, uid } from '../lib/dates.ts';
import type { Day } from '../lib/dates.ts';
import { parseIcs } from '../lib/ics.ts';
import { dayTable, dayTableCsv, evaluateAll, periodLabel, plannedStays, sortStays, statusKey, stayOutlook, whatIf } from '../lib/ledger.ts';
import type { Move, OutlookRow, Rule, RuleStatus, Stay } from '../lib/ledger.ts';
import { cityLabel } from '../lib/next.ts';
import { Field, FileButton, NumberInput, download, plural } from './bits.tsx';
import type { TabProps } from './bits.tsx';

const PALETTE = ['var(--good)', 'var(--warn)', '#8b5fbf', '#3aa3c2', '#b04b7a', '#7a8a3c'];
function countryColours(stays: Stay[]): Record<string, string> {
  const out: Record<string, string> = { GB: 'var(--london)', TR: 'var(--istanbul)' };
  let i = 0;
  for (const s of sortStays(stays)) if (!out[s.country]) out[s.country] = PALETTE[i++ % PALETTE.length];
  return out;
}

const cityClass = (city: string) => (city === 'london' || city === 'istanbul' ? city : '');
const range = (s: Stay) => `${fmtDay(s.arrive, { weekday: false })} to ${s.depart ? fmtDay(s.depart, { weekday: false }) : 'open-ended'}`;

// ---------------------------------------------------------------- rules

function RuleCard({ s, onLimit }: { s: RuleStatus; onLimit: (n: number | null) => void }) {
  const rolling = s.rule.period.kind === 'rolling';
  const [draft, setDraft] = useState<number | null>(null);
  const scale = Math.max(s.rule.limit ?? (s.period ? daysBetween(s.period[0], s.period[1]) + 1 : s.peak), s.peak, 1);
  const shownUsed = rolling ? Math.min(s.used, s.peak) : s.used;
  const shownBooked = rolling ? Math.max(0, s.peak - shownUsed) : s.booked;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{s.rule.label}</h2>
        <span className="muted small">{periodLabel(s.rule, s.period)}, {s.rule.convention === 'midnights' ? 'midnights' : 'any part of a day'}</span>
      </div>
      <div className="stats">
        <div className="stat"><b>{s.used}</b><span>{rolling ? 'in the window ending today' : 'used to date'}</span></div>
        <div className="stat"><b>{s.booked}</b><span>booked ahead</span></div>
        <div className="stat">
          <b className={s.breached ? 'bad' : ''}>{s.remaining === null ? '–' : s.remaining}</b>
          <span>{s.remaining === null ? 'no limit set' : s.breached ? 'over the limit' : `left of ${s.rule.limit}`}</span>
        </div>
      </div>
      <div className={`meter${s.breached ? ' over' : ''}`} role="img" aria-label={`${s.used} used, ${s.booked} booked${s.rule.limit !== null ? `, limit ${s.rule.limit}` : ''}`}>
        <i className="used" style={{ width: `${(shownUsed / scale) * 100}%` }} />
        <i className="booked" style={{ width: `${(shownBooked / scale) * 100}%` }} />
      </div>
      {rolling && s.peakOn && s.peak > 0 && <p className="muted small">Fullest window: {s.peak} days, in the {s.rule.period.kind === 'rolling' ? s.rule.period.windowDays : ''} days ending {fmtDay(s.peakOn, { weekday: false })}.</p>}
      {s.openEnded && <p className="muted small">A stay here has no departure date, so it is counted up to today only.</p>}
      {s.rule.limit === null && (
        <div className="stack">
          <form className="inline" onSubmit={(e) => { e.preventDefault(); if (draft !== null) onLimit(draft); }}>
            <span className="small strong">Your limit</span>
            <NumberInput label={`Limit for ${s.rule.label}`} value={draft} onChange={setDraft} placeholder="days" />
            <button className="btn small" type="submit" disabled={draft === null}>Set</button>
          </form>
          {s.rule.id === 'uk-tax-year' && (
            <p className="muted small">
              The threshold that applies to you under the statutory residence test depends on your ties to the UK; common thresholds are 16, 46, 91, 121 and 183 days. Enter the most days you want to allow. This app counts days and does not give tax advice.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- year strip

function YearStrip({ stays, today }: { stays: Stay[]; today: Day }) {
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const colours = useMemo(() => countryColours(stays), [stays]);
  const rows = useMemo(() => dayTable(stays, `${year}-01-01`, `${year}-12-31`, today), [stays, year, today]);
  const seen = [...new Set(rows.flatMap((r) => r.countries))];
  const CELL = 10.5;
  const LEFT = 26;
  const TOP = 12;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{year} at a glance</h2>
        <div className="btn-row">
          <button className="btn small" aria-label="Previous year" onClick={() => setYear(year - 1)}>←</button>
          <button className="btn small" aria-label="Next year" onClick={() => setYear(year + 1)}>→</button>
        </div>
      </div>
      <svg className="strip" viewBox={`0 0 ${LEFT + 31 * CELL} ${TOP + 12 * CELL}`} role="img" aria-label={`Where each day of ${year} was spent`}>
        {[1, 5, 10, 15, 20, 25, 30].map((d) => (
          <text key={d} x={LEFT + (d - 0.5) * CELL} y={8} textAnchor="middle">{d}</text>
        ))}
        {MONTHS.map((m, i) => (
          <text key={m} x={0} y={TOP + i * CELL + 8}>{m}</text>
        ))}
        {rows.map((r) => {
          const m = Number(r.date.slice(5, 7)) - 1;
          const d = Number(r.date.slice(8, 10)) - 1;
          const x = LEFT + d * CELL;
          const y = TOP + m * CELL;
          const size = CELL - 1.5;
          const main = r.countries[0];
          const second = r.countries.length > 1 ? (r.midnight && r.midnight !== main ? r.midnight : r.countries[1]) : null;
          return (
            <g key={r.date}>
              <title>{`${fmtDay(r.date)}: ${r.countries.length ? r.countries.map(countryName).join(' and ') : 'no record'}`}</title>
              <rect x={x} y={y} width={size} height={size} rx={2} className={main ? undefined : 'none'} fill={main ? colours[main] : undefined} />
              {second && <path d={`M${x + size} ${y} L${x + size} ${y + size} L${x} ${y + size} Z`} fill={colours[second]} />}
              {r.date === today && <rect x={x - 0.5} y={y - 0.5} width={size + 1} height={size + 1} rx={2.5} className="today" />}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {seen.length === 0 && <span>No stays recorded in {year}.</span>}
        {seen.map((c) => (
          <span key={c}><i className="dot" style={{ background: colours[c] }} />{countryName(c)}</span>
        ))}
        {seen.length > 1 && <span>Split cell: travel day</span>}
        {year === Number(today.slice(0, 4)) && <span>Outlined: today</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- stays

interface Draft {
  place: string;
  other: string;
  country: string;
  arrive: string;
  depart: string;
  note: string;
}
const blankDraft = (): Draft => ({ place: 'london', other: '', country: 'GB', arrive: '', depart: '', note: '' });
const draftOf = (s: Stay): Draft =>
  s.city === 'london' || s.city === 'istanbul'
    ? { place: s.city, other: '', country: s.country, arrive: s.arrive, depart: s.depart ?? '', note: s.note ?? '' }
    : { place: 'other', other: cityLabel(s.city), country: s.country, arrive: s.arrive, depart: s.depart ?? '', note: s.note ?? '' };

function draftError(d: Draft): string | null {
  if (d.place === 'other' && !d.other.trim()) return 'Name the city.';
  if (!/^[A-Za-z]{2}$/.test(d.country.trim())) return 'Country is a two-letter code such as GB, TR or NO.';
  if (!isDay(d.arrive)) return 'Pick the arrival date.';
  if (d.depart && !isDay(d.depart)) return 'The departure date is not a date.';
  if (d.depart && d.depart < d.arrive) return 'Departure is before arrival.';
  return null;
}

function StayForm({ initial, onSave, onCancel, saveLabel }: { initial: Draft; onSave: (d: Draft) => void; onCancel?: () => void; saveLabel: string }) {
  const [d, setD] = useState(initial);
  const [tried, setTried] = useState(false);
  const error = draftError(d);
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!error) {
          onSave(d);
          setD(blankDraft());
          setTried(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label="City">
          <select value={d.place} onChange={(e) => set({ place: e.target.value, country: e.target.value === 'london' ? 'GB' : e.target.value === 'istanbul' ? 'TR' : d.other ? d.country : '' })}>
            <option value="london">London</option>
            <option value="istanbul">Istanbul</option>
            <option value="other">Somewhere else</option>
          </select>
        </Field>
        {d.place === 'other' && (
          <Field label="City name">
            <input value={d.other} onChange={(e) => set({ other: e.target.value, country: countryForCity(e.target.value) ?? d.country })} placeholder="Tromsø" />
          </Field>
        )}
        <Field label="Country code">
          <input value={d.country} maxLength={2} onChange={(e) => set({ country: e.target.value.toUpperCase() })} placeholder="NO" disabled={d.place !== 'other'} />
        </Field>
        <Field label="Arrive">
          <input type="date" value={d.arrive} onChange={(e) => set({ arrive: e.target.value })} />
        </Field>
        <Field label="Depart (blank if not booked)">
          <input type="date" value={d.depart} min={d.arrive || undefined} onChange={(e) => set({ depart: e.target.value })} />
        </Field>
        <Field label="Note">
          <input value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      </div>
      {tried && error && <p className="bad small" role="alert">{error}</p>}
      <div className="btn-row">
        <button className="btn primary" type="submit">{saveLabel}</button>
        {onCancel && <button className="btn" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

const fromDraft = (d: Draft, base: Pick<Stay, 'id' | 'source'>): Stay => ({
  ...base,
  city: d.place === 'other' ? cityKey(d.other) : d.place,
  country: d.country.trim().toUpperCase(),
  arrive: d.arrive,
  depart: d.depart || null,
  ...(d.note.trim() ? { note: d.note.trim() } : {}),
});

function OutlookLines({ rows, rules }: { rows: OutlookRow[]; rules: Rule[] }) {
  if (!rows.length) return <p className="muted small">No rule covers this country.</p>;
  return (
    <div className={`outlook${rows.some((r) => r.breach) ? ' bad' : ''}`}>
      {rows.map((r, i) => {
        const rule = rules.find((x) => x.id === r.ruleId);
        const period = rule ? periodLabel(rule, r.period) : '';
        return (
          <div key={i}>
            <span className="strong">{r.label}</span> <span className="muted">({period})</span>:{' '}
            {r.remainingAtEnd === null ? (
              <span className="num">{r.countAtEnd} days by the end of this stay; no limit set.</span>
            ) : r.breach ? (
              <span className="bad strong num">{plural(-r.remainingAtEnd, 'day')} over the limit by the end of this stay.</span>
            ) : (
              <span className="num">
                {plural(r.remainingAtEnd, 'day')} left at the end of this stay.{' '}
                {r.extendTo
                  ? r.extendStop === 'limit'
                    ? `Latest departure before the limit: ${fmtDay(r.extendTo)}.`
                    : r.extendStop === 'next-stay'
                      ? `Could run to the next stay (${fmtDay(r.extendTo, { weekday: false })}) without reaching the limit.`
                      : 'No limit reached within three years.'
                  : 'No room to extend: what is booked later already uses the limit.'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stays({ doc, update, today }: TabProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const stays = sortStays(doc.stays);
  const planned = new Set(plannedStays(stays, today).map((s) => s.id));
  const shown = showPast ? stays : stays.filter((s) => planned.has(s.id));
  const pastCount = stays.length - planned.size;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Stays</h2>
        {stays.length > 0 && (
          <button className="btn small" onClick={() => download(`two-city-days-${today}.csv`, dayTableCsv(stays, doc.rules, stays[0].arrive, stays.reduce((m, s) => maxDay(m, s.depart ?? today), today), today), 'text/csv;charset=utf-8')}>
            Export day-by-day CSV
          </button>
        )}
      </div>
      {stays.length === 0 ? (
        <p className="empty">No stays yet. Add your current stay below, or import a calendar file or a booking confirmation and the ledger fills itself.</p>
      ) : (
        <div>
          {shown.length === 0 && <p className="empty">No stays under way or planned.</p>}
          {shown.map((s) => (
            <div className="stay" key={s.id}>
              {editing === s.id ? (
                <StayForm
                  initial={draftOf(s)}
                  saveLabel="Save stay"
                  onCancel={() => setEditing(null)}
                  onSave={(d) => {
                    update((doc0) => ({ ...doc0, stays: sortStays(doc0.stays.map((x) => (x.id === s.id ? fromDraft(d, { id: s.id, source: s.source }) : x))) }));
                    setEditing(null);
                  }}
                />
              ) : (
                <>
                  <div className="stay-head">
                    <div className="what">
                      <span className={`chip ${cityClass(s.city)}`}>{cityLabel(s.city)} · {s.country}</span>
                      <span className="num strong">{range(s)}</span>
                      {s.depart && <span className="muted small num">{plural(daysBetween(s.arrive, s.depart), 'night')}</span>}
                      <span className="chip">{s.source === 'manual' ? 'typed' : s.source === 'ics' ? 'from calendar' : 'from email'}</span>
                      {s.arrive <= today && planned.has(s.id) && <span className="chip good">now</span>}
                    </div>
                    <div className="btn-row">
                      <button className="btn small" onClick={() => setEditing(s.id)}>Edit</button>
                      <button className="btn small danger" onClick={() => confirm(`Delete the ${cityLabel(s.city)} stay from ${fmtDay(s.arrive, { weekday: false })}?`) && update((d) => ({ ...d, stays: d.stays.filter((x) => x.id !== s.id) }))}>Delete</button>
                    </div>
                  </div>
                  {s.note && <p className="muted small">{s.note}</p>}
                  {planned.has(s.id) && <OutlookLines rows={stayOutlook(s, stays, doc.rules, today).rows} rules={doc.rules} />}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {pastCount > 0 && (
        <div className="btn-row">
          <button className="btn small" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide' : 'Show'} {plural(pastCount, 'past stay')}</button>
        </div>
      )}
      <details className="more" open={stays.length === 0}>
        <summary>Add a stay by hand</summary>
        <StayForm initial={blankDraft()} saveLabel="Add stay" onSave={(d) => update((doc0) => ({ ...doc0, stays: sortStays([...doc0.stays, fromDraft(d, { id: uid(), source: 'manual' })]) }))} />
      </details>
    </section>
  );
}

// ---------------------------------------------------------------- import

function Import({ doc, update }: TabProps) {
  const [kind, setKind] = useState<'ics' | 'email'>('ics');
  const [text, setText] = useState('');
  const [review, setReview] = useState<{ parsed: ParsedFlights; plan: ImportPlan; source: 'ics' | 'email' } | null>(null);
  const [saved, setSaved] = useState('');

  const read = (raw: string, source: 'ics' | 'email') => {
    const parsed = source === 'ics' ? flightsFromIcs(parseIcs(raw)) : parseConfirmation(raw);
    setReview({ parsed, plan: planImport(doc.stays, parsed, source), source });
    setSaved('');
  };
  const changes = review ? review.plan.create.length + review.plan.update.length : 0;
  const place = (code: string) => `${AIRPORT[code]?.city ?? code} (${code})`;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Fill from bookings</h2>
        <div className="seg" role="group" aria-label="What to import">
          <button className={kind === 'ics' ? 'on' : ''} onClick={() => { setKind('ics'); setReview(null); }}>Calendar file</button>
          <button className={kind === 'email' ? 'on' : ''} onClick={() => { setKind('email'); setReview(null); }}>Confirmation email</button>
        </div>
      </div>
      <p className="muted small">
        {kind === 'ics'
          ? 'Choose an .ics file exported from your calendar or airline, or paste its text. Flight events are picked out and consecutive flights become stays.'
          : 'Paste the text of a booking confirmation (Turkish Airlines, British Airways and Pegasus layouts in English or Turkish are tested; others often work).'}{' '}
        This reads what you give it here. It does not log into an inbox or an airline account, and nothing is saved until you have reviewed it.
      </p>
      {!review && (
        <>
          <Field label={kind === 'ics' ? 'Calendar text' : 'Confirmation text'}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={kind === 'ics' ? 'BEGIN:VCALENDAR…' : 'Paste the email here'} />
          </Field>
          <div className="btn-row">
            <button className="btn primary" disabled={!text.trim()} onClick={() => read(text, kind)}>Read it</button>
            {kind === 'ics' && <FileButton label="Choose .ics file" accept=".ics,text/calendar" onText={(t) => { setText(t); read(t, 'ics'); }} />}
          </div>
          {saved && <p className="good small" role="status">{saved}</p>}
        </>
      )}
      {review && (
        <div className="stack">
          <h3>Review before saving</h3>
          {review.parsed.segments.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Flight read</th><th>From</th><th>To</th><th>Flight</th></tr>
                </thead>
                <tbody>
                  {review.parsed.segments.map((s, i) => (
                    <tr key={i}>
                      <td className="num">{fmtDay(s.depart, { weekday: false })}{s.arrive !== s.depart ? `, lands ${fmtDay(s.arrive, { weekday: false, year: false })}` : ''}</td>
                      <td>{place(s.from)}</td>
                      <td>{place(s.to)}</td>
                      <td className="num">{s.flight ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {review.plan.create.length > 0 && (
            <div>
              <h3>New stays</h3>
              <ul className="list">
                {review.plan.create.map((s) => (
                  <li key={s.id}><span><span className={`chip ${cityClass(s.city)}`}>{cityLabel(s.city)} · {s.country}</span> <span className="num">{range(s)}</span></span>{s.note && <span className="muted small">{s.note}</span>}</li>
                ))}
              </ul>
            </div>
          )}
          {review.plan.update.length > 0 && (
            <div>
              <h3>Changed stays</h3>
              <ul className="list">
                {review.plan.update.map((u) => (
                  <li key={u.before.id}>
                    <span><span className={`chip ${cityClass(u.before.city)}`}>{cityLabel(u.before.city)}</span> <span className="num">{range(u.before)}</span> becomes <span className="num strong">{range(u.after)}</span></span>
                    <span className="muted small">{u.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.plan.unchanged.length > 0 && <p className="muted small">{plural(review.plan.unchanged.length, 'stay')} already in the ledger with the same dates: left alone.</p>}
          {review.plan.notes.map((n, i) => <p key={i} className="warn small">{n}</p>)}
          {changes === 0 && review.parsed.segments.length > 0 && <p className="muted">Nothing to save: the ledger already matches.</p>}
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={changes === 0}
              onClick={() => {
                update((d) => ({ ...d, stays: applyImport(d.stays, planImport(d.stays, review.parsed, review.source)) }));
                setSaved(`Saved: ${plural(review.plan.create.length, 'new stay')}, ${review.plan.update.length} changed.`);
                setReview(null);
                setText('');
              }}
            >
              Save {changes > 0 ? plural(changes, 'change') : ''}
            </button>
            <button className="btn" onClick={() => setReview(null)}>Discard</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- what-if

function WhatIfCard({ doc, update, today }: TabProps) {
  const stays = sortStays(doc.stays);
  const flights = useMemo(() => {
    const out: { key: string; move: Omit<Move, 'to'>; date: Day; label: string }[] = [];
    for (const s of plannedStays(stays, today)) {
      const before = stays.find((x) => x.id !== s.id && x.depart === s.arrive);
      if (s.arrive > today && !before) out.push({ key: `${s.id}|arrive`, move: { stayId: s.id, edge: 'arrive' }, date: s.arrive, label: `${fmtDay(s.arrive, { year: false })}: arrive in ${cityLabel(s.city)}` });
      if (s.depart) {
        const after = stays.find((x) => x.id !== s.id && x.arrive === s.depart);
        out.push({ key: `${s.id}|depart`, move: { stayId: s.id, edge: 'depart' }, date: s.depart, label: `${fmtDay(s.depart, { year: false })}: ${cityLabel(s.city)} to ${after ? cityLabel(after.city) : 'onward'}` });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [stays, today]);
  const [key, setKey] = useState('');
  const [to, setTo] = useState('');
  const flight = flights.find((f) => f.key === key) ?? null;
  const result = flight && isDay(to) && to !== flight.date ? whatIf(stays, doc.rules, today, { ...flight.move, to }) : null;
  const reset = () => { setKey(''); setTo(''); };
  const delta = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null || b == null || a === b) return null;
    return <span className={b < a ? 'delta-up' : 'delta-down'}> ({b > a ? '+' : ''}{b - a})</span>;
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>What if a flight moves</h2>
      </div>
      {flights.length === 0 ? (
        <p className="empty">Once there is a stay with a flight still ahead, pick it here, move it to another date and see every count before and after. Nothing is saved until you apply it.</p>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Flight">
              <select value={key} onChange={(e) => { setKey(e.target.value); setTo(flights.find((f) => f.key === e.target.value)?.date ?? ''); }}>
                <option value="">Pick a flight</option>
                {flights.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Move it to">
              <input type="date" value={to} disabled={!flight} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          {flight && !result && <p className="muted small">Choose a different date to see the effect. {flight.date > today ? `Currently ${fmtDay(flight.date)}.` : ''}</p>}
          {result?.error && <p className="bad" role="alert">{result.error}</p>}
          {result && !result.error && (
            <div className="stack">
              <p className="small">
                Moved by <b className="num">{plural(daysBetween(flight!.date, to), 'day')}</b> to {fmtDay(to)}. Not saved yet.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Rule</th><th className="num">Booked before</th><th className="num">Booked after</th><th className="num">Left before</th><th className="num">Left after</th></tr>
                  </thead>
                  <tbody>
                    {result.rules.map((r) => {
                      const s = (r.after ?? r.before)!;
                      const b = r.before ? r.before.used + r.before.booked : 0;
                      const a = r.after ? r.after.used + r.after.booked : 0;
                      return (
                        <tr key={r.key}>
                          <td>{s.rule.label} <span className="muted small">({periodLabel(s.rule, s.period)})</span></td>
                          <td className="num">{s.period ? b : (r.before?.peak ?? 0)}</td>
                          <td className="num">{s.period ? a : (r.after?.peak ?? 0)}</td>
                          <td className="num">{r.before?.remaining ?? '–'}</td>
                          <td className={`num strong${r.after?.breached ? ' bad' : ''}`}>{r.after?.remaining ?? '–'}{delta(r.before?.remaining, r.after?.remaining)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Stay</th><th>Rule</th><th className="num">Left at its end, before</th><th className="num">After</th><th>Latest departure after</th></tr>
                  </thead>
                  <tbody>
                    {result.stays.flatMap(({ stay, before, after }) =>
                      after.rows.map((row, i) => {
                        const old = before?.rows.find((x) => x.ruleId === row.ruleId && x.period?.[0] === row.period?.[0]);
                        return (
                          <tr key={`${stay.id}-${i}`}>
                            <td>{i === 0 ? <><span className={`chip ${cityClass(stay.city)}`}>{cityLabel(stay.city)}</span> <span className="num small">{range(stay)}</span></> : ''}</td>
                            <td className="small">{row.label}</td>
                            <td className="num">{old?.remainingAtEnd ?? '–'}</td>
                            <td className={`num strong${row.breach ? ' bad' : ''}`}>{row.remainingAtEnd ?? '–'}{delta(old?.remainingAtEnd, row.remainingAtEnd)}</td>
                            <td className="num small">{row.breach ? 'over the limit' : row.extendTo ? fmtDay(row.extendTo, { weekday: false }) : '–'}</td>
                          </tr>
                        );
                      }),
                    )}
                  </tbody>
                </table>
              </div>
              <div className="btn-row">
                <button className="btn primary" onClick={() => { update((d) => { const w = whatIf(d.stays, d.rules, today, { ...flight!.move, to }); return w.error ? d : { ...d, stays: sortStays(w.after) }; }); reset(); }}>Apply</button>
                <button className="btn" onClick={reset}>Discard</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- tab

export function Ledger(props: TabProps) {
  const { doc, update, today } = props;
  const statuses = useMemo(() => evaluateAll(doc.rules, doc.stays, today), [doc.rules, doc.stays, today]);
  const setLimit = (ruleId: string, limit: number | null) => update((d) => ({ ...d, rules: d.rules.map((r) => (r.id === ruleId ? { ...r, limit } : r)) }));
  const breaches = plannedStays(doc.stays, today).filter((s) => stayOutlook(s, doc.stays, doc.rules, today).breach);
  return (
    <>
      {breaches.length > 0 && (
        <div className="banner bad" role="alert">
          <div>
            <b>{breaches.length === 1 ? 'A planned stay goes' : `${breaches.length} planned stays go`} over a limit.</b>{' '}
            {breaches.map((s) => `${cityLabel(s.city)} from ${fmtDay(s.arrive, { weekday: false })}`).join('; ')}.
          </div>
        </div>
      )}
      {doc.rules.length === 0 ? (
        <section className="card"><p className="empty">No day-count rules. Add one in Settings.</p></section>
      ) : (
        <div className="grid-2">
          {statuses.map((s) => <RuleCard key={statusKey(s)} s={s} onLimit={(n) => setLimit(s.rule.id, n)} />)}
        </div>
      )}
      <p className="muted small">Limits, counting conventions and extra rules (such as 90 days in any 180) are edited in Settings. Counts through {fmtDay(addDays(today, 0), { weekday: false })}.</p>
      <YearStrip stays={doc.stays} today={today} />
      <Stays {...props} />
      <WhatIfCard {...props} />
      <Import {...props} />
    </>
  );
}
