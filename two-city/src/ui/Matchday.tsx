import { useMemo, useState } from 'react';
import { fmtDay, isDay, relDay, uid } from '../lib/dates.ts';
import type { Day } from '../lib/dates.ts';
import { parseIcs, writeIcs } from '../lib/ics.ts';
import { TICKETS_URL, canAttend, fixtureTitle, fixturesFromIcs, kickoffLondon, mapFeed, matchCity, mergeFixtures, saleAlerts, saleWindowEvents, saleWindows, seasonFor, whereOn } from '../lib/matchday.ts';
import type { Fixture, FixtureChange } from '../lib/matchday.ts';
import { cityLabel } from '../lib/next.ts';
import { Field, FileButton, NumberInput, downloadIcs, plural } from './bits.tsx';
import type { TabProps } from './bits.tsx';

type Filter = 'upcoming' | 'attend' | 'past';

const notifySupported = typeof Notification !== 'undefined';

function LoadCard({ doc, update, today }: TabProps) {
  const [season, setSeason] = useState<number | null>(seasonFor(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ added: number; changes: FixtureChange[]; note?: string } | null>(null);
  const [competition, setCompetition] = useState('FA Cup');
  const [manual, setManual] = useState({ date: '', opponent: '', home: true, competition: 'Premier League' });

  const merge = (incoming: Fixture[], note?: string) => {
    const merged = mergeFixtures(doc.fixtures, incoming);
    update((d) => ({ ...d, fixtures: mergeFixtures(d.fixtures, incoming).fixtures, fixturesLoadedAt: new Date().toISOString() }));
    setResult({ added: merged.added, changes: merged.changes, note });
    setError('');
  };

  const load = async () => {
    if (!season) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/fixtures?season=${season}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('json')) throw new Error(res.ok ? 'The fixtures function is not running here (it runs on Vercel, or locally with "vercel dev").' : `The fixtures function answered ${res.status}.`);
      const body: unknown = await res.json();
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `The fixtures function answered ${res.status}.`);
      merge(mapFeed(body, season));
    } catch (e) {
      setError(`Could not load fixtures. ${e instanceof Error ? e.message : ''} You can still import a calendar file or add matches by hand.`);
    } finally {
      setBusy(false);
    }
  };

  const fmtWhen = (w: { date: Day; kickoffUtc?: string }) => `${fmtDay(w.date, { year: false })}${w.kickoffUtc ? ` ${kickoffLondon({ ...w, id: '', opponent: '', home: true, competition: '' })}` : ''}`;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Fixtures</h2>
        {doc.fixturesLoadedAt && <span className="muted small">Last loaded {fmtDay(doc.fixturesLoadedAt.slice(0, 10), { weekday: false })}</span>}
      </div>
      <div className="inline">
        <span className="small strong">Season starting</span>
        <NumberInput label="Season start year" value={season} onChange={setSeason} min={2015} />
        <button className="btn primary" onClick={() => void load()} disabled={busy || !season}>{busy ? 'Loading…' : doc.fixtures.length ? 'Refresh league fixtures' : 'Load league fixtures'}</button>
      </div>
      <p className="muted small">League fixtures come from fixturedownload.com through this app's own function. Kick-off times move for television: refresh now and then, and changes are listed here.</p>
      {error && <p className="bad" role="alert">{error}</p>}
      {result && (
        <div role="status" className="stack">
          <p className="good small">{result.note ?? 'Loaded.'} {plural(result.added, 'new match', 'new matches')}, {plural(result.changes.length, 'date change')}.</p>
          {result.changes.length > 0 && (
            <ul className="list">
              {result.changes.map((c) => (
                <li key={c.id}><span>{c.home ? `Chelsea v ${c.opponent}` : `${c.opponent} v Chelsea`}</span><span className="num small">{fmtWhen(c.from)} → <b>{fmtWhen(c.to)}</b></span></li>
              ))}
            </ul>
          )}
        </div>
      )}
      <details className="more">
        <summary>Cups and Europe: import a calendar file, or add a match by hand</summary>
        <div className="stack">
          <div className="inline">
            <input aria-label="Competition for imported matches" value={competition} onChange={(e) => setCompetition(e.target.value)} placeholder="Competition" />
            <FileButton
              label="Import fixtures (.ics)"
              accept=".ics,text/calendar"
              onText={(t) => {
                const { fixtures, skipped } = fixturesFromIcs(parseIcs(t), competition.trim() || 'Other');
                if (!fixtures.length) setError('No Chelsea matches found in that file. Events need a title like "Chelsea v Arsenal".');
                else merge(fixtures, `Imported from the calendar file${skipped ? ` (${plural(skipped, 'other event')} ignored)` : ''}.`);
              }}
            />
          </div>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isDay(manual.date) || !manual.opponent.trim()) return;
              merge([{ id: `manual-${uid()}`, date: manual.date, opponent: manual.opponent.trim(), home: manual.home, competition: manual.competition.trim() || 'Other' }], 'Added.');
              setManual({ ...manual, date: '', opponent: '' });
            }}
          >
            <Field label="Date"><input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} required /></Field>
            <Field label="Opponent"><input value={manual.opponent} onChange={(e) => setManual({ ...manual, opponent: e.target.value })} required /></Field>
            <Field label="Where">
              <select value={manual.home ? 'h' : 'a'} onChange={(e) => setManual({ ...manual, home: e.target.value === 'h' })}>
                <option value="h">Home</option>
                <option value="a">Away</option>
              </select>
            </Field>
            <Field label="Competition"><input value={manual.competition} onChange={(e) => setManual({ ...manual, competition: e.target.value })} /></Field>
            <button className="btn" type="submit">Add match</button>
          </form>
        </div>
      </details>
    </section>
  );
}

function FixtureRow({ f, doc, update, today }: TabProps & { f: Fixture }) {
  const past = f.date < today;
  const where = whereOn(f.date, doc.stays);
  const city = matchCity(f);
  const attendable = canAttend(f, doc.stays);
  const windows = saleWindows(f, doc.sale);
  const mine = windows.find((w) => w.phase.id === doc.sale.myPhase);
  const patch = (p: Partial<Fixture>) => update((d) => ({ ...d, fixtures: d.fixtures.map((x) => (x.id === f.id ? { ...x, ...p } : x)) }));
  const setSale = (phaseId: string, day: string) => {
    const next = { ...(f.saleDates ?? {}) };
    if (isDay(day)) next[phaseId] = day;
    else delete next[phaseId];
    patch({ saleDates: Object.keys(next).length ? next : undefined });
  };
  const time = kickoffLondon(f);

  return (
    <details className="fixture">
      <summary>
        <span className="date">{fmtDay(f.date, { year: false })}{time ? ` ${time}` : ''}</span>
        <span>
          <span className="strong">{fixtureTitle(f)}</span> <span className="muted small">{f.competition}</span>
        </span>
        <span className="chips">
          {past ? (
            f.attended ? <span className="chip good">Attended</span> : <span className="chip">Played</span>
          ) : f.home ? (
            where.where === 'in-london' ? <span className="chip good">In London</span> : where.where === 'away' ? <span className="chip warn">Away from London{where.city ? `: ${cityLabel(where.city)}` : ''}</span> : <span className="chip">No plans yet</span>
          ) : (
            <>
              <span className="chip">{city ?? f.venue ?? 'Away'}</span>
              {attendable && <span className="chip good">In London</span>}
            </>
          )}
          {!past && f.ticket === 'have' && <span className="chip accent">Ticket</span>}
          {!past && attendable && !f.ticket && mine && <span className="chip accent">{mine.opens <= today ? 'On sale' : `Sale ${fmtDay(mine.opens, { year: false, weekday: false })}`}{mine.confirmed ? '' : ' est.'}</span>}
        </span>
      </summary>
      <div className="body">
        {f.venue && <p className="muted small">{f.venue}{time ? `. Kick-off ${time} London time.` : '.'}</p>}
        {past ? (
          <label className="inline">
            <input type="checkbox" checked={Boolean(f.attended)} onChange={(e) => patch({ attended: e.target.checked || undefined })} />
            <span>I was there</span>
          </label>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Sale phase</th><th>Opens</th><th>Confirmed date</th></tr>
                </thead>
                <tbody>
                  {windows.map((w) => (
                    <tr key={w.phase.id}>
                      <td>{w.phase.label}{w.phase.id === doc.sale.myPhase ? <span className="chip accent" style={{ marginLeft: 6 }}>yours</span> : null}</td>
                      <td className="num">{fmtDay(w.opens, { year: false })} <span className={`chip ${w.confirmed ? 'good' : ''}`}>{w.confirmed ? 'confirmed' : 'estimated'}</span></td>
                      <td><input type="date" aria-label={`Confirmed on-sale date, ${w.phase.label}`} value={f.saleDates?.[w.phase.id] ?? ''} max={f.date} onChange={(e) => setSale(w.phase.id, e.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Estimated dates come from the offsets in Settings. The club announces the real ones match by match: check <a href={TICKETS_URL} target="_blank" rel="noreferrer">the club's ticket page</a> and type them in.
            </p>
            <div className="inline">
              <label className="small strong" htmlFor={`ticket-${f.id}`}>Ticket</label>
              <select id={`ticket-${f.id}`} value={f.ticket ?? ''} onChange={(e) => patch({ ticket: (e.target.value || undefined) as Fixture['ticket'] })}>
                <option value="">Still to buy (alert me)</option>
                <option value="have">I have a ticket</option>
                <option value="skip">Not going</option>
              </select>
            </div>
          </>
        )}
        <div className="btn-row">
          <button className="btn small danger" onClick={() => confirm(`Remove ${fixtureTitle(f)}?`) && update((d) => ({ ...d, fixtures: d.fixtures.filter((x) => x.id !== f.id) }))}>Remove match</button>
        </div>
      </div>
    </details>
  );
}

export function Matchday(props: TabProps) {
  const { doc, update, today, now } = props;
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [scope, setScope] = useState<'attend' | 'home'>('attend');
  const [permission, setPermission] = useState(notifySupported ? Notification.permission : 'unsupported');
  const fixtures = useMemo(() => [...doc.fixtures].sort((a, b) => a.date.localeCompare(b.date)), [doc.fixtures]);
  const alerts = saleAlerts(fixtures, doc.stays, doc.sale, today);
  const upcoming = fixtures.filter((f) => f.date >= today);
  const attendable = upcoming.filter((f) => canAttend(f, doc.stays));
  const shown = filter === 'upcoming' ? upcoming : filter === 'attend' ? attendable : fixtures.filter((f) => f.date < today).reverse();
  const myPhase = doc.sale.phases.find((p) => p.id === doc.sale.myPhase);
  const exportSet = scope === 'attend' ? attendable : upcoming.filter((f) => f.home);
  const events = saleWindowEvents(exportSet, doc.sale, today);

  return (
    <>
      {alerts.length > 0 && (
        <div className="banner warn" role="status">
          <div className="stack" style={{ gap: 4 }}>
            <b>Ticket windows for matches you can attend</b>
            {alerts.map((a) => (
              <span key={a.fixture.id}>
                {fixtureTitle(a.fixture)}, {fmtDay(a.fixture.date, { year: false })}:{' '}
                {a.state === 'open-now' ? <b>on sale since {fmtDay(a.window.opens, { year: false, weekday: false })}</b> : <b>opens {relDay(a.window.opens, today)} ({fmtDay(a.window.opens, { year: false })})</b>}
                {a.window.confirmed ? '' : ' (estimated)'}
              </span>
            ))}
          </div>
          <a className="btn small" href={TICKETS_URL} target="_blank" rel="noreferrer">Club ticket page</a>
        </div>
      )}

      <div className="grid-2">
        <LoadCard {...props} />
        <section className="card">
          <div className="card-head">
            <h2>Ticket alerts</h2>
            <span className="muted small">Your phase: {myPhase?.label ?? 'not set'}</span>
          </div>
          <p className="small">
            <b>Calendar reminders are the reliable alert.</b> Download the sale windows below and import them into your phone calendar: each has a reminder the evening before and at 09:00 on the day, and they fire whether or not this app is open.
          </p>
          <div className="inline">
            <select aria-label="Which matches to export" value={scope} onChange={(e) => setScope(e.target.value as 'attend' | 'home')}>
              <option value="attend">Matches I can attend</option>
              <option value="home">All home matches</option>
            </select>
            <button className="btn primary" disabled={!events.length} onClick={() => downloadIcs('chelsea-ticket-windows.ics', writeIcs(events, { name: 'Chelsea ticket windows', stamp: now.toISOString() }))}>
              Download {plural(events.length, 'sale window')} (.ics)
            </button>
          </div>
          <p className="muted small">
            There is no feed of on-sale dates, so windows are estimated from the offsets in Settings until you type the confirmed date on a match. After changing dates, download and import again. The banner on this page shows windows open now or opening in the next {plural(doc.sale.alertDays, 'day')}.
          </p>
          <div className="inline">
            {permission === 'unsupported' ? (
              <span className="muted small">This browser does not support notifications.</span>
            ) : permission === 'granted' ? (
              <span className="muted small">Browser notifications are on. They only appear while this app is open in a tab.</span>
            ) : permission === 'denied' ? (
              <span className="muted small">Browser notifications are blocked for this site in the browser's settings.</span>
            ) : (
              <>
                <button className="btn small" onClick={() => void Notification.requestPermission().then(setPermission)}>Turn on browser notifications</button>
                <span className="muted small">Only shown while the app is open in a tab.</span>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Matches</h2>
          <div className="seg" role="group" aria-label="Filter matches">
            <button className={filter === 'upcoming' ? 'on' : ''} onClick={() => setFilter('upcoming')}>Upcoming ({upcoming.length})</button>
            <button className={filter === 'attend' ? 'on' : ''} onClick={() => setFilter('attend')}>I can attend ({attendable.length})</button>
            <button className={filter === 'past' ? 'on' : ''} onClick={() => setFilter('past')}>Past</button>
          </div>
        </div>
        {fixtures.length === 0 ? (
          <p className="empty">No fixtures yet. Load the league fixtures above, then add your London dates in the Ledger to see which matches you can attend.</p>
        ) : shown.length === 0 ? (
          <p className="empty">
            {filter === 'attend' ? (doc.stays.length ? 'No upcoming match in London falls inside a London stay.' : 'Add your London stays in the Ledger and the matches you can attend show up here.') : filter === 'past' ? 'No past matches.' : 'No upcoming matches. Refresh, or load the next season.'}
          </p>
        ) : (
          <div>
            {shown.map((f) => <FixtureRow key={f.id} f={f} {...props} />)}
          </div>
        )}
        {fixtures.length > 0 && <p className="muted small">Open a match to set confirmed on-sale dates, mark a ticket, or mark it attended afterwards. Away matches show the city they are played in.</p>}
        {fixtures.length > 0 && (
          <div className="btn-row">
            <button className="btn small danger" onClick={() => confirm('Remove all fixtures, including attended marks and confirmed sale dates?') && update((d) => ({ ...d, fixtures: [], fixturesLoadedAt: null }))}>Clear all fixtures</button>
          </div>
        )}
      </section>
    </>
  );
}
