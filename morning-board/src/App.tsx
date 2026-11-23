import { useCallback, useEffect, useRef, useState } from 'react'
import { ChessPuzzle } from './components/ChessPuzzle.tsx'
import { CubeQuiz } from './components/CubeQuiz.tsx'
import { SettingsForm } from './components/SettingsForm.tsx'
import { DEFAULT_SCAN, findBlunders } from './lib/analysis.ts'
import { CUBE_POSITIONS } from './lib/cube.ts'
import { ENDGAMES, studyPuzzle } from './lib/endgames.ts'
import { Progress } from './components/Progress.tsx'
import { SessionClock } from './components/SessionClock.tsx'
import { boardDay, CITIES, cityClock, greeting, resolveCity, type City } from './lib/day.ts'
import { getEngine } from './lib/engine.ts'
import { fetchRecentGames, PlayerNotFound } from './lib/games.ts'
import {
  answerStep, BLOCK_INFO, BLOCKS, dealSession, dueCards, hasEnoughCards, loadState, mergeStates, saveState,
  type PuzzleCard, type Settings, type State, type StepResult,
} from './lib/store.ts'
import { codeFromLocation, isSyncCode, newSyncCode, pull, push, syncAvailable } from './lib/sync.ts'

type Prep = { status: 'idle' } | { status: 'working'; message: string } | { status: 'error'; message: string }

function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

export default function App() {
  const [state, setState] = useState<State>(() => {
    const saved = loadState()
    // Opening a sync link switches this device onto that code.
    const linked = syncAvailable ? codeFromLocation() : null
    if (linked) history.replaceState(null, '', location.pathname)
    return linked ? { ...saved, syncCode: linked } : saved
  })
  // Hold the first deal until the synced copy has been read, so two devices do not deal different boards.
  const [syncReady, setSyncReady] = useState(() => !(syncAvailable && state.syncCode))
  const [syncNote, setSyncNote] = useState('')
  const syncing = useRef(false)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [prep, setPrep] = useState<Prep>({ status: 'idle' })
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const stateRef = useRef(state)
  const running = useRef(false)
  const now = useNow(20000)

  const apply = useCallback((next: State) => {
    stateRef.current = next
    saveState(next)
    setState(next)
  }, [])

  const syncNow = useCallback(async () => {
    const code = stateRef.current.syncCode
    if (!syncAvailable || !code || syncing.current) return
    syncing.current = true
    try {
      const remote = await pull(code)
      const before = stateRef.current
      const merged = remote ? mergeStates(before, remote) : before
      if (merged !== before) apply(merged)
      const { syncCode: _mine, ...mine } = merged
      if (!remote || JSON.stringify(mine) !== JSON.stringify(remote)) await push(code, merged)
      setSyncNote('Synced')
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      syncing.current = false
    }
  }, [apply])

  const update = useCallback((fn: (s: State) => State) => {
    apply(fn(stateRef.current))
    if (syncAvailable && stateRef.current.syncCode) {
      clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(() => void syncNow(), 1500)
    }
  }, [apply, syncNow])

  const engine = useCallback(() => getEngine(stateRef.current.settings.engine), [])

  // Sync when the code changes (including on load) and whenever the app comes back to the foreground.
  useEffect(() => {
    if (!syncAvailable || !state.syncCode) return
    let live = true
    const giveUp = setTimeout(() => live && setSyncReady(true), 6000)
    void syncNow().finally(() => { clearTimeout(giveUp); if (live) setSyncReady(true) })
    const onShow = () => { if (document.visibilityState === 'visible') void syncNow() }
    document.addEventListener('visibilitychange', onShow)
    return () => { live = false; clearTimeout(giveUp); document.removeEventListener('visibilitychange', onShow) }
  }, [state.syncCode, syncNow])

  const { settings, session } = state
  const city: City = resolveCity(settings.city, now)
  const day = boardDay(city, now)
  const other: City = city === 'london' ? 'istanbul' : 'london'
  const ready = !!session && session.day === day

  const prepare = useCallback(async (day: string, round = 0) => {
    if (running.current) return
    running.current = true
    setNotice('')
    try {
      const { settings } = stateRef.current
      const enough = () => hasEnoughCards(stateRef.current, day)
      if (!enough()) {
        try {
          setPrep({ status: 'working', message: 'Fetching your recent games…' })
          const games = await fetchRecentGames(settings.site, settings.username, settings.gamesToScan * (round + 1))
          const fresh = games.filter((g) => !stateRef.current.scannedGames.includes(g.id))
          setPrep({
            status: 'working',
            message: engine().info.build === 'full' ? 'Loading Stockfish 19 (a 94 MB download the first time)…' : 'Waking up Stockfish…',
          })
          await engine().ready
          const { scanDepth, verifyDepth } = engine().info
          for (let i = 0; i < fresh.length && !enough(); i++) {
            const g = fresh[i]
            setPrep({ status: 'working', message: `Looking for blunders: game ${i + 1} of ${fresh.length}, against ${g.opponent}` })
            const found = await findBlunders(g, (fen, depth, second) => engine().evaluate(fen, depth, second), { ...DEFAULT_SCAN, scanDepth, verifyDepth })
            const cards: PuzzleCard[] = found.puzzles.map((p) => ({ ...p, box: 0, due: day, seen: 0 }))
            update((s) => ({
              ...s,
              cards: [...s.cards, ...cards],
              scannedGames: [...s.scannedGames, g.id].slice(-400),
              games: [...s.games, { id: g.id, playedAt: g.playedAt, moves: found.movesChecked, blunders: cards.length }]
                .sort((a, b) => a.playedAt - b.playedAt).slice(-400),
            }))
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Something went wrong reading your games.'
          // A wrong username stops here. Anything else: carry on with what is already saved.
          if (e instanceof PlayerNotFound) {
            setPrep({ status: 'error', message })
            return
          }
          setNotice(`Could not read new games (${message}) Today's board uses what was already saved.`)
        }
      }
      update((st) => ({ ...st, session: dealSession(st, day, round, Date.now()) }))
      setPrep({ status: 'idle' })
    } finally {
      running.current = false
    }
  }, [engine, update])

  useEffect(() => {
    if (settings.username && syncReady && !ready && prep.status === 'idle') void prepare(day)
  }, [settings.username, syncReady, ready, day, prep.status, prepare])

  function saveSettings(next: Settings) {
    const samePlayer = next.site === settings.site && next.username.toLowerCase() === settings.username.toLowerCase()
    update((s) => ({
      ...s,
      settings: next,
      settingsAt: Date.now(),
      cards: samePlayer ? s.cards : [],
      scannedGames: samePlayer ? s.scannedGames : [],
      // A different player or a different daily size means a new deal.
      games: samePlayer ? s.games : [],
      session: samePlayer && next.minutes === settings.minutes && next.cubesPerDay === settings.cubesPerDay ? s.session : undefined,
    }))
    setEditing(false)
    setPrep({ status: 'idle' })
  }

  function setSyncCode(code: string | undefined) {
    if (code && !isSyncCode(code)) return setSyncNote('That does not look like a sync code.')
    setSyncNote('')
    if (code) setSyncReady(false)
    update((s) => ({ ...s, syncCode: code }))
    if (code) setEditing(false)
  }

  function finishStep(key: string, result: StepResult) {
    update((s) => answerStep(s, key, result, Date.now()))
    window.scrollTo({ top: 0 })
  }

  const steps = ready ? session.steps : []
  const current = steps.find((s) => !(s.key in session!.results))
  const card = current?.key.startsWith('p:') ? state.cards.find((c) => c.id === current.key.slice(2)) : undefined
  const study = current?.key.startsWith('eg:') && ENDGAMES[Number(current.key.slice(3))] ? studyPuzzle(Number(current.key.slice(3))) : undefined
  const blocks = BLOCKS.map((b) => ({ block: b, steps: steps.filter((s) => s.block === b) })).filter((b) => b.steps.length > 0)
  const solvedIn = (b: (typeof blocks)[number]) => b.steps.filter((s) => session!.results[s.key] === 'solved').length
  const waiting = ready ? dueCards(state.cards, day) : { review: [], fresh: [] }

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Morning Board</h1>
          <p className="sub">
            {greeting(city, now)} from {CITIES[city].label}
            {state.streak.count > 1 && <> · {state.streak.count} mornings in a row</>}
          </p>
        </div>
        <div className="clocks" aria-label="Local times">
          <span className="here"><b>{cityClock(city, now).text}</b> {CITIES[city].label}</span>
          <span>{cityClock(other, now).text} {CITIES[other].label}</span>
        </div>
      </header>

      {steps.length > 0 && !editing && !showProgress && (
        <div className="plan">
          <div className="plan-head">
            <span>{current ? <><b>{BLOCK_INFO[current.block].label}</b> · block {blocks.findIndex((b) => b.block === current.block) + 1} of {blocks.length}</> : <b>Session complete</b>}</span>
            <SessionClock startedAt={session!.startedAt} frozenAt={session!.seconds} minutes={settings.minutes} />
          </div>
          <ol className="dots" aria-label="Today's progress">
            {blocks.map((b) => (
              <li key={b.block} className="group" title={BLOCK_INFO[b.block].label}>
                {b.steps.map((s) => (
                  <i key={s.key} className={session!.results[s.key] ?? (s.key === current?.key ? 'now' : '')} />
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}

      <main>
        {notice && <p className="notice">{notice}</p>}

        {showProgress ? (
          <Progress state={state} day={day} onClose={() => setShowProgress(false)} />
        ) : !settings.username || editing ? (
          !syncReady ? (
            <section className="step center"><div className="spinner" aria-hidden="true" /><p className="muted">Fetching your board from your other device…</p></section>
          ) : (
            <SettingsForm
              settings={settings}
              first={!settings.username}
              onSave={saveSettings}
              onCancel={settings.username ? () => setEditing(false) : undefined}
              sync={syncAvailable ? { code: state.syncCode, note: syncNote, start: () => setSyncCode(newSyncCode()), join: setSyncCode, stop: () => setSyncCode(undefined) } : undefined}
            />
          )
        ) : prep.status === 'working' ? (
          <section className="step center">
            <div className="spinner" aria-hidden="true" />
            <p className="muted" data-testid="prep">{prep.message}</p>
          </section>
        ) : prep.status === 'error' ? (
          <section className="step center">
            <p className="bad">{prep.message}</p>
            <div className="actions">
              <button className="ghost" onClick={() => setEditing(true)}>Change player</button>
              <button className="primary" onClick={() => setPrep({ status: 'idle' })}>Try again</button>
            </div>
          </section>
        ) : !ready ? null : current && (card ?? study) ? (
          <ChessPuzzle
            key={current.key}
            puzzle={(card ?? study)!}
            block={BLOCK_INFO[current.block].label}
            engine={getEngine(settings.engine)}
            isReview={(card?.seen ?? state.reviews[current.key]?.seen ?? 0) > 0}
            onDone={(r) => finishStep(current.key, r)}
          />
        ) : current?.key.startsWith('c:') && CUBE_POSITIONS[Number(current.key.slice(2))] ? (
          <CubeQuiz key={current.key} position={CUBE_POSITIONS[Number(current.key.slice(2))]} onDone={(r) => finishStep(current.key, r)} />
        ) : current ? (
          // A saved position that no longer exists (cleared storage, or a changed set): skip it.
          <section className="step center"><button className="primary" onClick={() => finishStep(current.key, 'missed')}>Skip</button></section>
        ) : (
          <section className="step center done">
            <h2>{session.round ? 'Extra round done.' : "That's the board for today."}</h2>
            <table className="summary">
              <tbody>
                {blocks.map((b) => (
                  <tr key={b.block}><th scope="row">{BLOCK_INFO[b.block].label}</th><td>{solvedIn(b)} of {b.steps.length}</td></tr>
                ))}
                <tr><th scope="row">Time</th><td>{Math.floor((session.seconds ?? 0) / 60)} min {(session.seconds ?? 0) % 60} s</td></tr>
              </tbody>
            </table>
            {!steps.some((s) => s.key.startsWith('p:')) && (
              <p>No blunders worth a puzzle in your last {settings.gamesToScan * ((session.round ?? 0) + 1)} games. Play a few more and they will turn up here.</p>
            )}
            <p className="muted">
              Missed positions come back tomorrow; solved ones return after a few days.
              {waiting.review.length + waiting.fresh.length > 0 && <> {waiting.review.length + waiting.fresh.length} more of your blunders are waiting.</>}
              {' '}The next board is dealt at 04:00 {CITIES[city].label} time.
            </p>
            <div className="actions">
              <button className="ghost" onClick={() => setShowProgress(true)}>See progress</button>
              <button className="ghost" onClick={() => void prepare(day, (session.round ?? 0) + 1)}>Deal another round</button>
            </div>
          </section>
        )}
      </main>

      {settings.username && !editing && !showProgress && prep.status !== 'working' && (
        <footer>
          <span>
            {settings.username} on {settings.site === 'lichess' ? 'Lichess' : 'Chess.com'} · {state.cards.length} {state.cards.length === 1 ? 'blunder' : 'blunders'} collected
            {' '}· {getEngine(settings.engine).info.label}
            {state.syncCode && syncNote && <> · {syncNote}</>}
          </span>
          <span className="links">
            <button className="link" onClick={() => setShowProgress(true)}>Progress</button>
            <button className="link" onClick={() => setEditing(true)}>Settings</button>
          </span>
        </footer>
      )}
    </div>
  )
}
