import { useState } from 'react';
import { CITIES, WEEKDAYS, uid } from '../lib/dates.ts';
import type { City } from '../lib/dates.ts';
import { RULE_PRESETS, rollingRule } from '../lib/ledger.ts';
import type { Period, Rule } from '../lib/ledger.ts';
import { DEFAULT_SALE } from '../lib/matchday.ts';
import type { SaleCategory } from '../lib/matchday.ts';
import { WHEN_LABEL } from '../lib/model.ts';
import type { Doc, Profile, RoutineBlock, TemplateItem, When } from '../lib/model.ts';
import type { Store } from '../lib/store';
import { Field, NumberInput } from './bits.tsx';
import type { TabProps } from './bits.tsx';
import { SyncPanel } from './SyncPanel';

function move<T>(xs: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function ItemList({ title, hint, items, onChange, withWhen }: { title: string; hint: string; items: TemplateItem[]; onChange: (items: TemplateItem[]) => void; withWhen?: boolean }) {
  return (
    <div className="stack">
      <div>
        <h3>{title}</h3>
        <p className="muted small">{hint}</p>
      </div>
      <div>
        {items.map((it, i) => (
          <div className="edit-row" key={it.id}>
            <div className="inline">
              <input aria-label={`${title} item ${i + 1}`} style={{ flex: '1 1 220px' }} value={it.text} onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))} />
              {withWhen && (
                <select aria-label={`When, item ${i + 1}`} style={{ flex: '0 1 150px' }} value={it.when ?? 'landing'} onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, when: e.target.value as When } : x)))}>
                  {(Object.keys(WHEN_LABEL) as When[]).map((w) => <option key={w} value={w}>{WHEN_LABEL[w]}</option>)}
                </select>
              )}
              <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(items, i, -1))}>↑</button>
              <button className="icon-btn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => onChange(move(items, i, 1))}>↓</button>
              <button className="icon-btn" aria-label={`Remove ${it.text || 'item'}`} onClick={() => onChange(items.filter((x) => x.id !== it.id))}>×</button>
            </div>
          </div>
        ))}
      </div>
      <div className="btn-row">
        <button className="btn small" onClick={() => onChange([...items, withWhen ? { id: uid(), text: '', when: 'landing' } : { id: uid(), text: '' }])}>Add item</button>
      </div>
    </div>
  );
}

function ProfileEditor({ doc, update }: TabProps) {
  const [city, setCity] = useState<City>(doc.mode);
  const p = doc.profiles[city];
  const label = CITIES[city].label;
  const set = (patch: Partial<Profile>) => update((d) => ({ ...d, profiles: { ...d.profiles, [city]: { ...d.profiles[city], ...patch } } }));
  const setBlock = (id: string, patch: Partial<RoutineBlock>) => set({ routine: p.routine.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  return (
    <section className="card">
      <div className="card-head">
        <h2>City profiles</h2>
        <div className="seg" role="group" aria-label="Profile to edit">
          {(['london', 'istanbul'] as const).map((c) => (
            <button key={c} className={city === c ? 'on' : ''} onClick={() => setCity(c)}>{CITIES[c].label}</button>
          ))}
        </div>
      </div>
      <p className="muted small">The starter content is generic. Make it yours: changes to the routine and defaults show at once; changes to the packing and landing templates apply from the next switch.</p>

      <div className="form-grid">
        <Field label={`${label} court`}><input value={p.court.name} onChange={(e) => set({ court: { ...p.court, name: e.target.value } })} placeholder="Club or court name" /></Field>
        <Field label="Usual court slot"><input value={p.court.slot} onChange={(e) => set({ court: { ...p.court, slot: e.target.value } })} placeholder="Tue and Thu 18:30" /></Field>
        <Field label={`${label} gym`}><input value={p.gym.name} onChange={(e) => set({ gym: { ...p.gym, name: e.target.value } })} placeholder="Gym name" /></Field>
        <Field label="Usual gym slot"><input value={p.gym.slot} onChange={(e) => set({ gym: { ...p.gym, slot: e.target.value } })} placeholder="Mon, Wed, Fri 12:30" /></Field>
      </div>

      <div className="stack">
        <div>
          <h3>{label} routine</h3>
          <p className="muted small">In the order the day should run. Today shows the blocks for the weekday in this order; the calendar export makes each a weekly event in {label} time.</p>
        </div>
        <div>
          {p.routine.map((b, i) => (
            <div className="edit-row" key={b.id}>
              <div className="inline">
                <input aria-label={`Block ${i + 1} label`} value={b.label} onChange={(e) => setBlock(b.id, { label: e.target.value })} placeholder="What" />
                <input aria-label={`Block ${i + 1} start`} type="time" style={{ flex: '0 0 auto' }} value={b.start} onChange={(e) => e.target.value && setBlock(b.id, { start: e.target.value })} />
                <NumberInput label={`Block ${i + 1} minutes`} value={b.minutes} min={5} onChange={(n) => setBlock(b.id, { minutes: n ?? 30 })} />
                <span className="muted small">min</span>
              </div>
              <div className="inline">
                <span className="days" role="group" aria-label={`Days for ${b.label || 'block'}`}>
                  {WEEKDAYS.map((w, d) => {
                    const on = b.days.includes(d + 1);
                    return (
                      <button key={w} className={on ? 'on' : ''} aria-pressed={on} aria-label={w} onClick={() => setBlock(b.id, { days: on ? b.days.filter((x) => x !== d + 1) : [...b.days, d + 1].sort() })}>
                        {w.slice(0, 2)}
                      </button>
                    );
                  })}
                </span>
                <span style={{ flex: 1 }} />
                <button className="icon-btn" aria-label="Move earlier" disabled={i === 0} onClick={() => set({ routine: move(p.routine, i, -1) })}>↑</button>
                <button className="icon-btn" aria-label="Move later" disabled={i === p.routine.length - 1} onClick={() => set({ routine: move(p.routine, i, 1) })}>↓</button>
                <button className="icon-btn" aria-label={`Remove ${b.label || 'block'}`} onClick={() => set({ routine: p.routine.filter((x) => x.id !== b.id) })}>×</button>
              </div>
            </div>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={() => set({ routine: [...p.routine, { id: uid(), label: '', start: '09:00', minutes: 60, days: [1, 2, 3, 4, 5] }] })}>Add block</button>
        </div>
      </div>

      <div className="grid-2">
        <ItemList title={`Packing for ${label}`} hint={`What goes in the bag for the journey to ${label}.`} items={p.packing} onChange={(packing) => set({ packing })} />
        <ItemList title={`Landing in ${label}`} hint="Each item is due on landing, the first morning, or within the first week." items={p.landing} onChange={(landing) => set({ landing })} withWhen />
      </div>

      <div className="stack">
        <div>
          <h3>Other {label} defaults</h3>
          <p className="muted small">Anything worth having in front of you after a switch: SIM, transport card, currency, door codes you do not mind storing here.</p>
        </div>
        <div>
          {p.defaults.map((d, i) => (
            <div className="edit-row" key={d.id}>
              <div className="inline">
                <input aria-label={`Default ${i + 1} name`} style={{ flex: '1 1 110px' }} value={d.key} onChange={(e) => set({ defaults: p.defaults.map((x) => (x.id === d.id ? { ...x, key: e.target.value } : x)) })} placeholder="Name" />
                <input aria-label={`Default ${i + 1} value`} style={{ flex: '2 1 150px' }} value={d.value} onChange={(e) => set({ defaults: p.defaults.map((x) => (x.id === d.id ? { ...x, value: e.target.value } : x)) })} placeholder="Value" />
                <button className="icon-btn" aria-label={`Remove ${d.key || 'default'}`} onClick={() => set({ defaults: p.defaults.filter((x) => x.id !== d.id) })}>×</button>
              </div>
            </div>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={() => set({ defaults: [...p.defaults, { id: uid(), key: '', value: '' }] })}>Add default</button>
        </div>
      </div>
    </section>
  );
}

/** Keeps what was typed (commas and all) while saving the parsed codes. */
function CountriesInput({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <input
      value={text}
      placeholder="GB, or FR, DE, IT"
      onChange={(e) => {
        setText(e.target.value.toUpperCase());
        onChange([...new Set(e.target.value.toUpperCase().split(/[^A-Z]+/).filter((c) => c.length === 2))]);
      }}
      onBlur={() => setText(value.join(', '))}
    />
  );
}

const PERIOD_OPTIONS: { value: Period['kind']; label: string }[] = [
  { value: 'uk-tax-year', label: 'UK tax year (6 Apr to 5 Apr)' },
  { value: 'calendar-year', label: 'Calendar year' },
  { value: 'rolling', label: 'Any rolling window' },
];

function RulesEditor({ doc, update }: TabProps) {
  const setRule = (id: string, patch: Partial<Rule>) => update((d) => ({ ...d, rules: d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const add = (r: Rule) => update((d) => ({ ...d, rules: [...d.rules, r] }));
  const missing = RULE_PRESETS.filter((p) => !doc.rules.some((r) => r.id === p.id));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Day-count rules</h2>
      </div>
      <p className="muted small">
        Each rule counts days in one country, or a group of countries counted together, over a period. "Midnights" counts a day if you are there at the end of it; "any part" counts arrival and departure days too. The limit is the most days you allow yourself: if a threshold reads "fewer than 46", enter 45. This app counts days and does not give tax or immigration advice.
      </p>
      <div>
        {doc.rules.map((r) => (
          <div className="edit-row" key={r.id}>
            <div className="form-grid">
              <Field label="Name"><input value={r.label} onChange={(e) => setRule(r.id, { label: e.target.value })} /></Field>
              <Field label="Countries (two-letter codes)">
                <CountriesInput value={r.countries} onChange={(countries) => setRule(r.id, { countries })} />
              </Field>
              <Field label="A day counts if">
                <select value={r.convention} onChange={(e) => setRule(r.id, { convention: e.target.value as Rule['convention'] })}>
                  <option value="midnights">I am there at midnight</option>
                  <option value="any-part">I am there for any part of it</option>
                </select>
              </Field>
              <Field label="Period">
                <select value={r.period.kind} onChange={(e) => setRule(r.id, { period: e.target.value === 'rolling' ? { kind: 'rolling', windowDays: 180 } : ({ kind: e.target.value } as Period) })}>
                  {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              {r.period.kind === 'rolling' && (
                <Field label="Window, days"><NumberInput className="num" label="Window in days" min={2} value={r.period.windowDays} onChange={(n) => setRule(r.id, { period: { kind: 'rolling', windowDays: n ?? 180 } })} /></Field>
              )}
              <Field label="Limit, days (blank = count only)"><NumberInput className="num" label={`Limit for ${r.label}`} value={r.limit} onChange={(n) => setRule(r.id, { limit: n })} /></Field>
            </div>
            {r.id === 'uk-tax-year' && <p className="muted small">The statutory residence test threshold depends on your ties to the UK. Common thresholds are 16, 46, 91, 121 and 183 days; set the one that applies to you.</p>}
            <div className="btn-row">
              <button className="btn small danger" onClick={() => confirm(`Remove the rule "${r.label}"?`) && update((d) => ({ ...d, rules: d.rules.filter((x) => x.id !== r.id) }))}>Remove rule</button>
            </div>
          </div>
        ))}
        {doc.rules.length === 0 && <p className="empty">No rules. Add one below.</p>}
      </div>
      <div className="btn-row">
        <button className="btn small" onClick={() => add(rollingRule(uid()))}>Add a rolling rule (Schengen 90 in 180)</button>
        <button className="btn small" onClick={() => add({ id: uid(), label: 'New rule', countries: [], convention: 'any-part', period: { kind: 'calendar-year' }, limit: null })}>Add a blank rule</button>
        {missing.map((p) => <button key={p.id} className="btn small" onClick={() => add({ ...p, countries: [...p.countries] })}>Restore "{p.label}"</button>)}
      </div>
    </section>
  );
}

const CATEGORY_LABEL: Record<SaleCategory, string> = { homeLeague: 'Home, league', away: 'Away', cup: 'Home, cup and Europe' };

function SaleEditor({ doc, update }: TabProps) {
  const sale = doc.sale;
  const set = (patch: Partial<Doc['sale']>) => update((d) => ({ ...d, sale: { ...d.sale, ...patch } }));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Ticket sale windows</h2>
        <button className="btn small" onClick={() => confirm('Put the phases and offsets back to the starting guesses?') && set(structuredClone(DEFAULT_SALE))}>Reset</button>
      </div>
      <p className="muted small">
        The club announces on-sale dates match by match and there is no feed of them. Until you type a confirmed date on a match, each window is estimated as this many days before the match. The starting numbers are guesses: adjust them to what you see the club do.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Phase</th>
              {(Object.keys(CATEGORY_LABEL) as SaleCategory[]).map((c) => <th key={c} className="num">{CATEGORY_LABEL[c]}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {sale.phases.map((p) => (
              <tr key={p.id}>
                <td><input aria-label="Phase name" style={{ minWidth: 150, width: '100%' }} value={p.label} onChange={(e) => set({ phases: sale.phases.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)) })} /></td>
                {(Object.keys(CATEGORY_LABEL) as SaleCategory[]).map((c) => (
                  <td key={c} className="num">
                    <NumberInput label={`${p.label}, ${CATEGORY_LABEL[c]}, days before`} value={sale.offsets[c]?.[p.id] ?? 0} onChange={(n) => set({ offsets: { ...sale.offsets, [c]: { ...sale.offsets[c], [p.id]: n ?? 0 } } })} />
                  </td>
                ))}
                <td className="num">
                  <button className="icon-btn" aria-label={`Remove phase ${p.label}`} disabled={sale.phases.length <= 1} onClick={() => set({ phases: sale.phases.filter((x) => x.id !== p.id), myPhase: sale.myPhase === p.id ? (sale.phases.find((x) => x.id !== p.id)?.id ?? '') : sale.myPhase })}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button className="btn small" onClick={() => set({ phases: [...sale.phases, { id: uid(), label: 'New phase' }] })}>Add phase</button>
      </div>
      <div className="form-grid">
        <Field label="The phase that applies to me">
          <select value={sale.myPhase} onChange={(e) => set({ myPhase: e.target.value })}>
            {sale.phases.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Alert me this many days before a window opens">
          <NumberInput className="num" label="Alert days" value={sale.alertDays} onChange={(n) => set({ alertDays: n ?? 7 })} />
        </Field>
      </div>
    </section>
  );
}

export function Settings(props: TabProps & { store: Store<Doc> }) {
  return (
    <>
      <ProfileEditor {...props} />
      <RulesEditor {...props} />
      <SaleEditor {...props} />
      <SyncPanel store={props.store} filename="two-city" />
      <p className="muted small">
        The same switch runs from a terminal: <code>npm run switch -- istanbul</code> in this app's folder prints the routine, defaults and checklists and writes them to <code>./out</code>. With a backup from here it uses your profiles (<code>--file</code>); with the sync variables set it flips this app too. See the README.
      </p>
    </>
  );
}
