import { useEffect, useRef, useState } from 'react';
import { lastOffer, roundOf, type Offer, type PlayerInput, type Scenario, type Turn } from '../engine/index.js';
import { Brief } from './Brief';
import { OfferCard, Worth } from './OfferCard';

interface Props {
  sc: Scenario;
  log: Turn[];
  busy: boolean;
  /** True when free text is read by the AI counterpart. */
  aiPlaying: boolean;
  counterpartNote: string;
  onSend: (input: PlayerInput) => void;
  onAccept: (offer: Offer) => void;
  onWalk: () => void;
  onAbandon: () => void;
}

/** The player's best option on every issue: the form's starting point. */
const dream = (sc: Scenario): Offer => Object.fromEntries(sc.issues.map((i) => [i.id, sc.player.values[i.id].indexOf(1)]));

export function Transcript({ sc, log }: { sc: Scenario; log: Turn[] }) {
  const seen: Partial<Record<Turn['by'], Offer>> = {};
  return (
    <ol className="chat" aria-label="Transcript">
      {log.map((t, k) => {
        const prev = seen[t.by];
        if (t.offer && t.action === 'offer') seen[t.by] = t.offer;
        const who = t.by === 'player' ? 'You' : sc.counterpart.roleLabel;
        return (
          <li key={k} className={`turn ${t.by}`}>
            <div className="small muted">
              {who} · round {t.round}
            </div>
            {t.text && <p>{t.text}</p>}
            {t.action === 'message' && !t.text && t.by === 'player' && <p className="muted">You asked for their offer.</p>}
            {t.action === 'offer' && t.offer && <OfferCard sc={sc} offer={t.offer} prev={prev} />}
            {t.action === 'accept' && t.offer && <OfferCard sc={sc} offer={t.offer} title={t.by === 'player' ? 'You accepted' : 'Accepted'} />}
            {t.action === 'walk' && <p className="strong">{t.by === 'player' ? 'You walked away.' : 'They walked away.'}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export function Session({ sc, log, busy, aiPlaying, counterpartNote, onSend, onAccept, onWalk, onAbandon }: Props) {
  const mine = lastOffer(log, 'player');
  const theirs = lastOffer(log, 'counterpart');
  const [draft, setDraft] = useState<Offer>(() => mine ?? dream(sc));
  const [text, setText] = useState('');
  const [confirmWalk, setConfirmWalk] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const round = roundOf(log) + 1;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length, busy]);

  const send = (action: PlayerInput['action'], offer: Offer | null) => {
    onSend({ text, offer, action });
    setText('');
    setConfirmWalk(false);
  };

  return (
    <div className="session">
      <section className="card">
        <div className="card-head">
          <h2>{sc.title}: your brief</h2>
          <span className="chip">{sc.ref.difficulty}</span>
        </div>
        <Brief sc={sc} />
        <div className="btn-row">
          <button className="btn small" onClick={onAbandon} disabled={busy}>
            Abandon session
          </button>
          <span className="small muted">Abandoned sessions are not scored.</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>
            Round <span className="num">{round}</span>
          </h2>
          <span className="small muted">{counterpartNote}</span>
        </div>
        {log.length === 0 ? (
          <p className="empty">Nothing said yet. Put a first offer down, or ask for theirs.</p>
        ) : (
          <Transcript sc={sc} log={log} />
        )}
        {busy && <p className="muted small">Waiting for their reply.</p>}
        <div ref={end} />

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send('offer', draft);
          }}
        >
          <h3>Your offer</h3>
          <div className="issues">
            {sc.issues.map((i) => (
              <label key={i.id} className="field">
                <span>{i.label}</span>
                <select value={draft[i.id]} onChange={(e) => setDraft({ ...draft, [i.id]: Number(e.target.value) })}>
                  {i.options.map((o, k) => (
                    <option key={k} value={k}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="btn-row">
            <Worth sc={sc} offer={draft} />
            {theirs && (
              <button type="button" className="btn small" onClick={() => setDraft(theirs)}>
                Copy their offer into the form
              </button>
            )}
          </div>
          <label className="field">
            <span>{aiPlaying ? 'Message (free text; terms you state are read as an offer)' : 'Message (optional; the scripted counterpart answers the form, not the text)'}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} />
          </label>
          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={busy}>
              Send offer
            </button>
            {aiPlaying && (
              <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => send('offer', null)}>
                Send message only
              </button>
            )}
            {!mine && !theirs && (
              <button type="button" className="btn" disabled={busy} onClick={() => send('message', null)}>
                Ask for their offer first
              </button>
            )}
          </div>
          <div className="btn-row closing">
            <button type="button" className="btn" disabled={busy || !theirs} onClick={() => theirs && onAccept(theirs)}>
              Accept their offer
            </button>
            {confirmWalk ? (
              <>
                <button type="button" className="btn danger" disabled={busy} onClick={onWalk}>
                  Confirm: walk away
                </button>
                <button type="button" className="btn" onClick={() => setConfirmWalk(false)}>
                  Stay
                </button>
              </>
            ) : (
              <button type="button" className="btn danger" disabled={busy} onClick={() => setConfirmWalk(true)}>
                Walk away
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
