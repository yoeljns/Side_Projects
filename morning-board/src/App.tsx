import { useCallback, useEffect, useRef, useState } from 'react'
import { ChessPuzzle } from './components/ChessPuzzle.tsx'
import { CubeQuiz } from './components/CubeQuiz.tsx'
import { SettingsForm } from './components/SettingsForm.tsx'
import { findBlunders } from './lib/analysis.ts'
import { CUBE_POSITIONS, cubeIndicesForDay } from './lib/cube.ts'
import { boardDay, CITIES, cityClock, greeting, resolveCity, type City } from './lib/day.ts'
import { getEngine as engine } from './lib/engine.ts'
import { fetchRecentGames, PlayerNotFound } from './lib/games.ts'
import {
  bumpStreak, gradeCard, loadState, pickPuzzles, saveState,
  type PuzzleCard, type Session, type Settings, type State, type StepResult,
} from './lib/store.ts'

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
  const [state, setState] = useState<State>(loadState)
  const [prep, setPrep] = useState<Prep>({ status: 'idle' })
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const stateRef = useRef(state)
  const running = useRef(false)
  const now = useNow(20000)

  const update = useCallback((fn: (s: State) => State) => {
    const next = fn(stateRef.current)
    stateRef.current = next
    saveState(next)
    setState(next)
  }, [])

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
      const enough = () => pickPuzzles(stateRef.current.cards, day, settings.puzzlesPerDay).length >= settings.puzzlesPerDay
      if (!enough()) {
        try {
          setPrep({ status: 'working', message: 'Fetching your recent games…' })
          const games = await fetchRecentGames(settings.site, settings.username, settings.gamesToScan * (round + 1))
          const fresh = games.filter((g) => !stateRef.current.scannedGames.includes(g.id))
          setPrep({ status: 'working', message: 'Waking up Stockfish…' })
          await engine().ready
          for (let i = 0; i < fresh.length && !enough(); i++) {
            const g = fresh[i]
            setPrep({ status: 'working', message: `Looking for blunders: game ${i + 1} of ${fresh.length}, against ${g.opponent}` })
            const found = await findBlunders(g, (fen, depth) => engine().evaluate(fen, depth))
            const cards: PuzzleCard[] = found.map((p) => ({ ...p, box: 0, due: day, seen: 0 }))
            update((s) => ({ ...s, cards: [...s.cards, ...cards], scannedGames: [...s.scannedGames, g.id].slice(-400) }))
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Something went wrong reading your games.'
          // A wrong username, or nothing at all to show: stop here. Otherwise carry on with what is already saved.
          const nothing = pickPuzzles(stateRef.current.cards, day, 1).length === 0 && settings.cubesPerDay === 0
          if (e instanceof PlayerNotFound || nothing) {
            setPrep({ status: 'error', message })
            return
          }
          setNotice(`Could not read new games (${message}) Today's board uses what was already saved.`)
        }
      }
      const s: Session = {
        day,
        round,
        puzzleIds: pickPuzzles(stateRef.current.cards, day, settings.puzzlesPerDay),
        cubeIds: cubeIndicesForDay(round ? `${day}/round-${round}` : day, settings.cubesPerDay),
        results: {},
      }
      update((st) => ({ ...st, session: s }))
      setPrep({ status: 'idle' })
    } finally {
      running.current = false
    }
  }, [update])

  useEffect(() => {
    if (settings.username && !ready && prep.status === 'idle') void prepare(day)
  }, [settings.username, ready, day, prep.status, prepare])

  function saveSettings(next: Settings) {
    const samePlayer = next.site === settings.site && next.username.toLowerCase() === settings.username.toLowerCase()
    update((s) => ({
      ...s,
      settings: next,
      cards: samePlayer ? s.cards : [],
      scannedGames: samePlayer ? s.scannedGames : [],
      // A different player or a different daily size means a new deal.
      session: samePlayer && next.puzzlesPerDay === settings.puzzlesPerDay && next.cubesPerDay === settings.cubesPerDay ? s.session : undefined,
    }))
    setEditing(false)
    setPrep({ status: 'idle' })
  }

  function finishStep(key: string, result: StepResult) {
    update((s) => {
      if (!s.session) return s
      const results = { ...s.session.results, [key]: result }
      const cards = key.startsWith('p:')
        ? s.cards.map((c) => (c.id === key.slice(2) ? gradeCard(c, result, s.session!.day) : c))
        : s.cards
      const total = s.session.puzzleIds.length + s.session.cubeIds.length
      const streak = Object.keys(results).length >= total ? bumpStreak(s.streak, s.session.day) : s.streak
      return { ...s, cards, streak, session: { ...s.session, results } }
    })
    window.scrollTo({ top: 0 })
  }

  const steps = ready
    ? [...session.puzzleIds.map((id) => `p:${id}`), ...session.cubeIds.map((i) => `c:${i}`)]
    : []
  const current = steps.find((k) => !(k in (session?.results ?? {})))
  const card = current?.startsWith('p:') ? state.cards.find((c) => c.id === current.slice(2)) : undefined
  const solved = (prefix: string) => steps.filter((k) => k.startsWith(prefix) && session?.results[k] === 'solved').length

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

      {steps.length > 0 && (
        <ol className="dots" aria-label="Today's progress">
          {steps.map((k) => (
            <li key={k} className={`${k[0] === 'c' ? 'cube ' : ''}${session!.results[k] ?? (k === current ? 'now' : '')}`} />
          ))}
        </ol>
      )}

      <main>
        {notice && <p className="notice">{notice}</p>}

        {!settings.username || editing ? (
          <SettingsForm settings={settings} first={!settings.username} onSave={saveSettings} onCancel={settings.username ? () => setEditing(false) : undefined} />
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
        ) : !ready ? null : current && card ? (
          <ChessPuzzle key={current} puzzle={card} engine={engine()} isReview={card.seen > 0} onDone={(r) => finishStep(current, r)} />
        ) : current?.startsWith('c:') ? (
          <CubeQuiz key={current} position={CUBE_POSITIONS[Number(current.slice(2))]} onDone={(r) => finishStep(current, r)} />
        ) : current ? (
          // A saved puzzle that no longer exists (cleared storage): skip it.
          <section className="step center"><button className="primary" onClick={() => finishStep(current, 'missed')}>Skip</button></section>
        ) : (
          <section className="step center done">
            <h2>{session.round ? 'Extra round done.' : "That's the board for today."}</h2>
            {session.puzzleIds.length > 0 ? (
              <p>Chess: {solved('p:')} of {session.puzzleIds.length} found first time.</p>
            ) : (
              <p>No blunders worth a puzzle in your last {settings.gamesToScan * ((session.round ?? 0) + 1)} games. Play a few more and they will turn up here.</p>
            )}
            {session.cubeIds.length > 0 && <p>Cube: {solved('c:')} of {session.cubeIds.length} right.</p>}
            <p className="muted">
              Missed positions come back tomorrow; solved ones return after a few days. The next board is dealt at
              04:00 {CITIES[city].label} time.
            </p>
            <div className="actions">
              <button className="ghost" onClick={() => void prepare(day, (session.round ?? 0) + 1)}>Deal another round</button>
            </div>
          </section>
        )}
      </main>

      {settings.username && !editing && prep.status !== 'working' && (
        <footer>
          <span>{settings.username} on {settings.site === 'lichess' ? 'Lichess' : 'Chess.com'} · {state.cards.length} {state.cards.length === 1 ? "blunder" : "blunders"} collected</span>
          <button className="link" onClick={() => setEditing(true)}>Settings</button>
        </footer>
      )}
    </div>
  )
}
