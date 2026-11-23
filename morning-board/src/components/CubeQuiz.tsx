import { useState } from 'react'
import { pips } from '../lib/bearoff.ts'
import { choiceEquity, correctChoice, cubeChoices, type CubeChoice, type CubePosition } from '../lib/cube.ts'
import type { StepResult } from '../lib/store.ts'
import { BackgammonBoard } from './BackgammonBoard.tsx'

const eq = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export function CubeQuiz({ position: p, onDone }: { position: CubePosition; onDone: (r: StepResult) => void }) {
  const [picked, setPicked] = useState<CubeChoice | null>(null)
  const asking = p.kind === 'double'
  const you = asking ? p.roller : p.opponent
  const them = asking ? p.opponent : p.roller
  const held = p.cube === 'roller' // the roller already owns the cube at 2
  const correct = correctChoice(p)
  const yourWin = asking ? p.win : 1 - p.win
  const choices = cubeChoices(p)
  const cost = picked ? choiceEquity(p, correct) - choiceEquity(p, picked) : 0

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
        Money game, bearoff. You are the light checkers at the bottom: {pips(you)} pips against {pips(them)}.
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
                  : cost < 0.0005
                    ? `Right to double, but your opponent should ${correct === 'double-take' ? 'take' : 'pass'}.`
                    : `Not quite: that costs ${cost.toFixed(3)} of the stake.`}
              </strong>{' '}
              You win this race {pct(yourWin)} of the time with the cube out of play.
            </p>
            <p className="muted">
              Equities are yours, per unit of the cube before the decision, with perfect play from both sides
              (computed exactly, not estimated). {asking
                ? `Rolling on is worth ${eq(p.noDouble)}; a doubled game would be worth ${eq(p.doubleTake)}, so your opponent ${p.doubleTake > 1 ? 'does better to pass and you collect 1' : 'takes'}.`
                : `Taking is worth ${eq(-p.doubleTake)} against −1.000 for passing.`}
            </p>
          </div>
        )}
      </div>

      <div className="actions">
        {picked && <button className="primary" onClick={() => onDone(picked === correct ? 'solved' : 'missed')}>Next</button>}
      </div>
    </section>
  )
}
