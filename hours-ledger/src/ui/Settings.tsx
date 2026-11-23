import { useState } from 'react';
import { isTime, reminderIcs } from '../lib/ics';
import { entriesCsv, nextColor, PALETTE_NAMES, slugId, type Category, type Settings as SettingsDoc } from '../lib/model';
import type { Ctx } from './App';
import { CommitInput, Dot, download } from './common';
import { SyncPanel } from './SyncPanel';

export function Settings({ ctx }: { ctx: Ctx }) {
  const { doc, update, today } = ctx;
  const [label, setLabel] = useState('');
  const active = doc.categories.filter((c) => !c.archived);
  const archived = doc.categories.filter((c) => c.archived);

  const patch = (id: string, change: Partial<Category>) =>
    update((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, ...change } : c)) }));
  const setting = (change: Partial<SettingsDoc>) => update((d) => ({ ...d, settings: { ...d.settings, ...change } }));

  const add = () => {
    const name = label.trim();
    if (!name) return;
    update((d) => ({ ...d, categories: [...d.categories, { id: slugId(name, d.categories.map((c) => c.id)), label: name, color: nextColor(d.categories) }] }));
    setLabel('');
  };

  const used = (id: string) => doc.entries.some((e) => e.category === id);

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Categories and weekly targets</h2>
          <span className="muted small">A target is optional: at least (a floor) or at most (a ceiling).</span>
        </div>
        <div>
          {active.map((c) => (
            <div className="catrow" key={c.id}>
              <label className="field">
                <span>Name</span>
                <CommitInput
                  label={`Name of ${c.label}`}
                  value={c.label}
                  onCommit={(v) => {
                    if (!v.trim()) return false;
                    patch(c.id, { label: v.trim() });
                    return true;
                  }}
                />
              </label>
              <label className="field swatch-field">
                <span>Colour</span>
                <div>
                  <Dot color={c.color} />
                  <select aria-label={`Colour of ${c.label}`} value={c.color} onChange={(e) => patch(c.id, { color: Number(e.target.value) })}>
                    {PALETTE_NAMES.map((n, i) => (
                      <option key={n} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="field">
                <span>Hours a week</span>
                <CommitInput
                  label={`Weekly target hours for ${c.label}`}
                  inputMode="decimal"
                  placeholder="none"
                  value={c.weeklyTargetHours === undefined ? '' : String(c.weeklyTargetHours)}
                  onCommit={(v) => {
                    if (!v.trim()) {
                      patch(c.id, { weeklyTargetHours: undefined });
                      return true;
                    }
                    const n = Number(v.replace(',', '.'));
                    if (!Number.isFinite(n) || n < 0 || n > 168) return false;
                    patch(c.id, { weeklyTargetHours: n });
                    return true;
                  }}
                />
              </label>
              <label className="field">
                <span>Target is</span>
                <select value={c.targetKind ?? 'floor'} onChange={(e) => patch(c.id, { targetKind: e.target.value as 'floor' | 'ceiling' })}>
                  <option value="floor">at least</option>
                  <option value="ceiling">at most</option>
                </select>
              </label>
              <label className="field">
                <span>Also typed as</span>
                <CommitInput
                  label={`Other words for ${c.label}`}
                  placeholder="optional"
                  value={(c.aliases ?? []).join(', ')}
                  onCommit={(v) => {
                    const words = v.split(/[,\s]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
                    patch(c.id, { aliases: words.length ? words : undefined });
                    return true;
                  }}
                />
              </label>
              <button className="btn" onClick={() => patch(c.id, { archived: true })} aria-label={`Archive ${c.label}`}>
                Archive
              </button>
            </div>
          ))}
        </div>
        <form
          className="btn-row"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input aria-label="New category name" placeholder="New category" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: '1 1 160px', maxWidth: 280 }} />
          <button className="btn primary" type="submit" disabled={!label.trim()}>
            Add category
          </button>
        </form>
        {archived.length > 0 && (
          <div>
            <h3 className="muted">Archived</h3>
            <ul className="list">
              {archived.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.label} <span className="muted small">{used(c.id) ? 'kept in past weeks' : 'no entries'}</span>
                  </span>
                  <span className="btn-row">
                    <button className="btn small" onClick={() => patch(c.id, { archived: false })}>
                      Restore
                    </button>
                    {!used(c.id) && (
                      <button className="btn small danger" onClick={() => update((d) => ({ ...d, categories: d.categories.filter((x) => x.id !== c.id) }))}>
                        Delete
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="muted small">Archiving hides a category from logging; its past hours stay in every summary. The quick line matches the name by its first letters, plus the extra words.</p>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Sunday reminder</h2>
          <p className="muted small">
            A web page cannot notify you when it is closed. This downloads a calendar event that repeats every Sunday with an alert; open it once and your calendar does the reminding. The time has no timezone, so it rings
            at the same clock time wherever the phone is.
          </p>
          <div className="btn-row">
            <label className="field" style={{ width: 130 }}>
              <span>Time</span>
              <input type="time" value={doc.settings.reminderTime} onChange={(e) => isTime(e.target.value) && setting({ reminderTime: e.target.value })} />
            </label>
            <button
              className="btn"
              style={{ alignSelf: 'end' }}
              onClick={() => download('hours-ledger-sunday.ics', reminderIcs({ time: doc.settings.reminderTime, from: today, createdAt: Date.now(), url: location.origin + location.pathname }), 'text/calendar')}
            >
              Download reminder (.ics)
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Timer and export</h2>
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Flag a timer left running after (hours)</span>
            <CommitInput
              label="Timer cap in hours"
              inputMode="decimal"
              value={String(doc.settings.timerCapHours)}
              onCommit={(v) => {
                const n = Number(v.replace(',', '.'));
                if (!Number.isFinite(n) || n < 0.5 || n > 24) return false;
                setting({ timerCapHours: n });
                return true;
              }}
            />
          </label>
          <p className="muted small">Past the cap a timer is not logged as it stands; the Today tab asks how long it really was. Between 0.5 and 24.</p>
          <div className="btn-row">
            <button className="btn" disabled={doc.entries.length === 0} onClick={() => download(`hours-ledger-${today}.csv`, entriesCsv(doc.entries, doc.categories), 'text/csv')}>
              Export all entries (CSV)
            </button>
            <span className="muted small num">{doc.entries.length} {doc.entries.length === 1 ? 'entry' : 'entries'}</span>
          </div>
        </section>
      </div>

      <SyncPanel store={ctx.store} filename="hours-ledger" />
    </>
  );
}
