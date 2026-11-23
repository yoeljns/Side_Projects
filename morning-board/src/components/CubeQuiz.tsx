import { useEffect, useRef, useState } from 'react'
import { choiceEquity, correctChoice, cubeChoices, type CubeChoice, type CubePosition } from '../lib/cube.ts'
import type { StepResult } from '../lib/store.ts'
import { keithCount } from '../lib/raceCount.ts'
import { isRace, summarise, type RolloutResult } from '../lib/rollout.ts'
import type { RolloutRequest, RolloutUpdate } from '../lib/rollout.worker.ts'
import { tavlaLine, tavlaValue } from '../lib/tavla.ts'
import { BackgammonBoard } from './BackgammonBoard.tsx'
import { CubeShort } from './CubeShort.tsx'
import './cube-extras.css'

const ROLLOUT_TRIALS = 20000
const KEITH_WORDS = { 'no-double': 'no double', 'double-take': 'double, take', 'double-pass': 'double, pass' } as const

const eq = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pips = (side: number[]) => side.reduce((acc, n, i) => acc + n * (i + 1), 0)

export function CubeQuiz({ position: p, onDone }: { position: CubePosition; onDone: (r: StepResult) => void }) {
  const [picked, setPicked] = useState<CubeChoice | null>(null)
  const [rolled, setRolled] = useState<{ result: RolloutResult; done: boolean } | null>(null)
  const [short, setShort] = useState(false)
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])
  const asking = p.kind === 'double'
  const you = asking ? p.roller : p.opponent
  const them = asking ? p.opponent : p.roller
  const held = p.cube === 'roller' // the roller already owns the cube at 2
  const correct = correctChoice(p)
  const yourWin = asking ? p.win : 1 - p.win
  const yourGammon = (asking ? p.gammon : p.loseGammon) ?? 0
  const theirGammon = (asking ? p.loseGammon : p.gammon) ?? 0
  const choices = cubeChoices(p)
  const cost = picked ? choiceEquity(p, correct) - choiceEquity(p, picked) : 0

  // Rollouts and race counts only make sense once nobody has to pass an enemy checker.
  const race = isRace(p.roller, p.opponent)
  const keith = race ? keithCount(p.roller, p.opponent, held) : null
  const tavla = tavlaValue(yourWin, yourGammon, theirGammon)

  function runRollout() {
    worker.current?.terminate()
    const w = new Worker(new URL('../lib/rollout.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setRolled({ result: summarise({ trials: 0, wins: 0, gammons: 0, gammonLosses: 0 }), done: false })
    w.onmessage = (e: MessageEvent<RolloutUpdate>) => {
      setRolled({ result: summarise(e.data.tally), done: e.data.done })
      if (e.data.done) { w.terminate(); worker.current = null }
    }
    w.postMessage({ roller: p.roller, opponent: p.opponent, trials: ROLLOUT_TRIALS, seed: Date.now() >>> 0 } satisfies RolloutRequest)
  }
  const rolledWin = rolled ? (asking ? rolled.result.win : 1 - rolled.result.win) : 0

  const cube = asking
    ? { value: held ? 2 : 64, at: held ? ('you' as const) : ('middle' as const) }
    : { value: held ? 4 : 2, at: 'offered' as const }

  return (
    <section className="step">
      <p className="eyebrow">Backgammon · cube decision</p>
      <h2>
        {asking
          ? held ? 'You own the cube on 2 and are on roll. Redouble?' : 'You are on roll with the cube in the middle. Double?'
          : `Your opponent is on roll and ${held ? 'redoubles to 4' : 'doubles to 2'}. Take or pass?`}
      </h2>
      <p className="context">
        Money game, gammons count (no Jacoby rule). {p.source === 'exact' ? 'A bearoff' : p.race ? 'A race' : 'A contact position'}:
        you are the light checkers, bearing off at the bottom right, with {pips(you)} pips against {pips(them)}.
      </p>

      <div className="board"><BackgammonBoard you={you} them={them} cube={cube} /></div>

      <div className="choices">
        {choices.map((c) => {
          const state = !picked ? '' : c.id === correct ? 'right' : c.id === picked ? 'wrong' : 'dim'
          return (
            <button key={c.id} className={`choice ${state}`} disabled={!!picked} onClick={() => setPicked(c.id)}>
              <span>{c.label}</span>
              {picked && <span className="num">{eq(choiceEquity(p, c.id))}</span>}
            </button>
          )
        })}
      </div>

      <div className="feedback" aria-live="polite">
        {picked && (
          <div className={picked === correct ? 'verdict good' : 'verdict'}>
            <p>
              <strong>
                {picked === correct
                  ? 'Right.'
                  : cost >= 0.0005
                    ? `Not quite: that costs ${cost.toFixed(3)} of the stake.`
                    : correct === 'too-good'
                      ? 'Right not to double, but because you are too good: play on for the gammon.'
                      : correct === 'no-double'
                        ? 'Right not to double, but because you are not strong enough yet.'
                        : `Right to double, but your opponent should ${correct === 'double-take' ? 'take' : 'pass'}.`}
              </strong>{' '}
              {p.source === 'exact'
                ? `You win this race ${pct(yourWin)} of the time with the cube out of play.`
                : `You win ${pct(yourWin)} of games, ${pct(yourGammon)} of all games with a gammon, and lose a gammon in ${pct(theirGammon)}.`}
            </p>
            <p className="muted">
              Equities are yours, per unit of the cube before the decision. {p.source === 'exact'
                ? 'They are computed exactly, with perfect play from both sides.'
                : 'They are GNU Backgammon’s 2-ply evaluation, so treat the third decimal as approximate.'}{' '}
              {asking
                ? `Rolling on is worth ${eq(p.noDouble)}; a doubled game would be worth ${eq(p.doubleTake)}, so your opponent ${p.doubleTake > 1 ? 'does better to pass and you would collect 1' : 'takes'}.`
                : `Taking is worth ${eq(-p.doubleTake)} against −1.000 for passing.`}
            </p>
          </div>
        )}
        {picked && (
          <div className="cube-extras">
            {keith && (
              <p className="cube-note">
                <b>Rule of thumb (Keith count).</b> The side on roll counts {keith.roller} ({keith.rollerBase} plus a
                seventh), the other side {keith.opponent}: a difference of {keith.difference < 0 ? '−' : ''}{Math.abs(keith.difference)}. The rule says{' '}
                <b>{KEITH_WORDS[keith.verdict]}</b>, which{' '}
                {keith.verdict === p.action ? 'agrees with' : 'differs from'} the {p.source === 'exact' ? 'exact answer' : 'engine'} here
                {keith.verdict === p.action ? '.' : ` (${KEITH_WORDS[p.action as keyof typeof KEITH_WORDS] ?? 'too good to double'}).`}
                {p.source === 'exact' && ' It was tuned for full races, so expect it to slip in bearoffs this short.'}
              </p>
            )}
            <p className="cube-note">{tavlaLine(tavla)}</p>
            <div className="cube-tools">
              {race && (
                <button type="button" className="ghost" onClick={runRollout} disabled={!!rolled && !rolled.done}>
                  {rolled?.done ? 'Roll it out again' : 'Run a rollout'}
                </button>
              )}
              <button type="button" className="ghost" onClick={() => setShort(true)}>Make a Short</button>
            </div>
            {rolled && (
              <div className="rollout" data-testid="rollout">
                <div className="rollout-figures">
                  <span>
                    Rollout: <b>{pct(rolledWin)}</b>
                    {rolled.result.trials > 0 && <> ± {(196 * rolled.result.standardError).toFixed(1)}</>}
                  </span>
                  <span>{p.source === 'exact' ? 'Exact' : 'GNU Backgammon'}: <b>{pct(yourWin)}</b></span>
                  <span className="muted">{rolled.result.trials.toLocaleString('en')} of {ROLLOUT_TRIALS.toLocaleString('en')} games</span>
                </div>
                {!rolled.done && <div className="rollout-bar"><span style={{ width: `${(100 * rolled.result.trials) / ROLLOUT_TRIALS}%` }} /></div>}
                <p className="muted">
                  A rollout plays the position to the end thousands of times with random dice and counts how often you
                  win; the ± is the 95% range from the luck of the dice. Both sides use a simple racing plan, so it can
                  sit a point or so away from perfect play.
                </p>
              </div>
            )}
          </div>
        )}
        {short && <CubeShort position={p} onClose={() => setShort(false)} />}
      </div>

      <div className="actions">
        {picked && <button className="primary" onClick={() => onDone(picked === correct ? 'solved' : 'missed')}>Next</button>}
      </div>
    </section>
  )
}
