import { useEffect, useMemo, useState } from 'react';
import {
  generateScenario,
  isCompleteOffer,
  isScenarioRef,
  resolveRound,
  roundOf,
  scoreSession,
  sessionOutcome,
  toRecord,
  type Offer,
  type PlayerInput,
  type ScenarioRef,
  type SessionRecord,
  type Turn,
} from '../engine/index.js';
import { explain, probeAi, requestRound, type Unavailable } from '../lib/negotiateClient';
import { newId, useStore } from '../lib/store';
import { Debrief } from './Debrief';
import { History } from './History';
import { Session } from './Session';
import { Setup } from './Setup';
import { SyncPanel } from './SyncPanel';

interface Active {
  id: string;
  ref: ScenarioRef;
  log: Turn[];
}

interface Doc {
  /** Finished sessions, oldest first. */
  sessions: SessionRecord[];
  /** The session in progress or being debriefed. */
  active: Active | null;
}

const BLANK: Doc = { sessions: [], active: null };
const today = () => new Date().toISOString().slice(0, 10);
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

type Tab = 'spar' | 'history' | 'settings';
type Ai = { state: 'checking' } | { state: 'on' } | { state: 'off'; reason: Unavailable };

function usable(a: Active | null): a is Active {
  if (!a || !isScenarioRef(a.ref) || !Array.isArray(a.log)) return false;
  const sc = generateScenario(a.ref);
  return a.log.every((t) => t && (t.offer === undefined || isCompleteOffer(sc.issues, t.offer)));
}

export function App() {
  const store = useStore<Doc>('negotiation-sparring:v1', BLANK);
  const [tab, setTab] = useState<Tab>('spar');
  const [ai, setAi] = useState<Ai>({ state: 'checking' });
  const [busy, setBusy] = useState(false);
  /** Set when the AI failed mid-session and the script took a turn. */
  const [slip, setSlip] = useState<Unavailable | null>(null);

  useEffect(() => {
    let live = true;
    probeAi().then((r) => live && setAi(r.ai ? { state: 'on' } : { state: 'off', reason: r.reason }));
    return () => {
      live = false;
    };
  }, []);

  const active = usable(store.state.active) ? store.state.active : null;
  const sc = useMemo(() => (active ? generateScenario(active.ref) : null), [active?.ref.family, active?.ref.seed, active?.ref.difficulty, active?.ref.role]);
  const ended = active ? sessionOutcome(active.log) !== null : false;
  const score = useMemo(() => (sc && active && ended ? scoreSession(sc, active.log) : null), [sc, active?.log, ended]);

  const counterpartNote =
    ai.state === 'checking'
      ? 'Checking for the AI counterpart.'
      : ai.state === 'on'
        ? slip
          ? `Counterpart: Claude. The last reply was scripted because ${explain(slip)}.`
          : 'Counterpart: Claude (AI).'
        : `Counterpart: scripted (${explain(ai.reason)}).`;

  /** Append turns to the session they belong to; record the score if that ends it. */
  const append = (id: string, turns: Turn[]) =>
    store.update((s) => {
      if (!s.active || s.active.id !== id) return s;
      const log = [...s.active.log, ...turns];
      const next: Doc = { ...s, active: { ...s.active, log } };
      if (sessionOutcome(log) && !s.sessions.some((r) => r.id === id)) {
        const scenario = generateScenario(s.active.ref);
        next.sessions = [...s.sessions, toRecord(scenario, scoreSession(scenario, log), id, today())];
      }
      return next;
    });

  const start = (ref: ScenarioRef) => {
    setSlip(null);
    store.update((s) => ({ ...s, active: { id: newId(), ref, log: [] } }));
  };

  const send = async (input: PlayerInput) => {
    if (!active || !sc || busy) return;
    const { id, log } = active;
    const script = () => {
      const r = resolveRound(sc, log, input, null);
      append(id, [r.playerTurn, r.reply]);
    };
    if (ai.state !== 'on') return script();
    setBusy(true);
    const r = await requestRound(sc, log, input);
    setBusy(false);
    if (r.ok) {
      setSlip(null);
      append(id, r.turns);
    } else {
      setSlip(r.reason);
      script();
    }
  };

  const close = (action: 'accept' | 'walk', offer?: Offer) => {
    if (!active) return;
    append(active.id, [{ by: 'player', round: roundOf(active.log) + 1, action, text: '', ...(offer ? { offer } : {}) }]);
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Negotiation sparring</h1>
          <p className="muted">Negotiate against a counterpart with hidden limits, then see how the deal compares with the game-theory benchmarks.</p>
        </div>
        <nav className="tabs" aria-label="Sections">
          {(['spar', 'history', 'settings'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}>
              {t === 'spar' ? 'Spar' : t === 'history' ? `History (${store.state.sessions.length})` : 'Settings'}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'spar' &&
        (!active || !sc ? (
          <Setup counterpartNote={counterpartNote} onStart={(r) => start({ ...r, seed: newSeed() })} />
        ) : score ? (
          <Debrief
            sc={sc}
            log={active.log}
            score={score}
            onNew={() => store.update((s) => ({ ...s, active: null }))}
            onReplay={() => start(active.ref)}
          />
        ) : (
          <Session
            key={active.id}
            sc={sc}
            log={active.log}
            busy={busy}
            aiPlaying={ai.state === 'on'}
            counterpartNote={counterpartNote}
            onSend={send}
            onAccept={(offer) => close('accept', offer)}
            onWalk={() => close('walk')}
            onAbandon={() => store.update((s) => ({ ...s, active: null }))}
          />
        ))}

      {tab === 'history' && (
        <History
          sessions={store.state.sessions}
          onDelete={(id) => store.update((s) => ({ ...s, sessions: s.sessions.filter((r) => r.id !== id) }))}
          onClear={() => store.update((s) => ({ ...s, sessions: [] }))}
        />
      )}

      {tab === 'settings' && (
        <>
          <section className="card">
            <h2>Counterpart</h2>
            <p>{counterpartNote}</p>
            <p className="small muted">
              The AI counterpart needs the Vercel function in <code>api/negotiate.ts</code> and an ANTHROPIC_API_KEY set on the server. Without them the
              scripted counterpart plays: it follows a concession plan and answers the offer form, not free text. Both play under the same hidden limits.
            </p>
          </section>
          <SyncPanel store={store} filename="negotiation-sparring" />
        </>
      )}
    </div>
  );
}
