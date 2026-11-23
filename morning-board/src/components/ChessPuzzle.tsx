import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { lineToSan, winPercent, type Puzzle } from '../lib/analysis.ts'
import type { Engine } from '../lib/engine.ts'
import type { StepResult } from '../lib/store.ts'

/** A different move still counts if it keeps within this many win-% points of the engine's. */
const TOLERANCE = 6

type Status = 'thinking' | 'checking' | 'wrong' | 'solved' | 'revealed'

function ago(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return `${Math.round(days / 7)} weeks ago`
}

interface Props {
  puzzle: Puzzle
  engine: Engine
  isReview: boolean
  onDone: (result: StepResult) => void
}

export function ChessPuzzle({ puzzle, engine, isReview, onDone }: Props) {
  const [status, setStatus] = useState<Status>('thinking')
  const [fen, setFen] = useState(puzzle.fen)
  const [selected, setSelected] = useState<string | null>(null)
  const [misses, setMisses] = useState(0)
  const [note, setNote] = useState('')
  const [answer, setAnswer] = useState<string | null>(null) // SAN of the accepted move

  const base = useMemo(() => new Chess(puzzle.fen), [puzzle.fen])
  const targets = useMemo(
    () => (selected ? base.moves({ square: selected as never, verbose: true }).map((m) => m.to as string) : []),
    [base, selected],
  )
  const line = useMemo(() => lineToSan(puzzle.fen, puzzle.pv), [puzzle])
  const done = status === 'solved' || status === 'revealed'
  const canMove = status === 'thinking' || status === 'wrong'
  const you = puzzle.color === 'w' ? 'White' : 'Black'

  async function tryMove(from: string, to: string): Promise<boolean> {
    if (!canMove) return false
    const chess = new Chess(puzzle.fen)
    const promotion = puzzle.bestUci.startsWith(from + to) && puzzle.bestUci[4] ? puzzle.bestUci[4] : 'q'
    let move
    try {
      move = chess.move({ from, to, promotion })
    } catch {
      return false
    }
    const uci = move.from + move.to + (move.promotion ?? '')
    setSelected(null)
    setFen(chess.fen())

    const accept = () => { setAnswer(move.san); setStatus('solved'); setNote('') }
    const reject = (why: string) => {
      setMisses((n) => n + 1)
      setStatus('wrong')
      setNote(why)
      setTimeout(() => setFen(puzzle.fen), 650)
    }

    if (uci === puzzle.bestUci) accept()
    else if (uci === puzzle.playedUci) reject(`${move.san} is what you played in the game.`)
    else if (chess.isCheckmate()) accept()
    else if (chess.isGameOver()) reject(`${move.san} only draws.`)
    else {
      setStatus('checking')
      try {
        const reply = await engine.evaluate(chess.fen(), engine.info.scanDepth + 2)
        const mine = 100 - winPercent(reply)
        if (puzzle.bestWin - mine <= TOLERANCE) accept()
        else reject(`${move.san} gives too much away. Look again.`)
      } catch {
        reject('The engine could not check that move. Try again.')
      }
    }
    return true
  }

  function onSquareClick(square: string) {
    if (!canMove) return
    if (selected && targets.includes(square)) void tryMove(selected, square)
    else if (base.get(square as never)?.color === puzzle.color) setSelected(square === selected ? null : square)
    else setSelected(null)
  }

  const squareStyles: Record<string, React.CSSProperties> = {}
  if (selected) squareStyles[selected] = { background: 'var(--sq-select)' }
  for (const t of targets) squareStyles[t] = { boxShadow: 'inset 0 0 0 4px var(--sq-select)' }

  const showLine = done
  const arrows = showLine
    ? [{ startSquare: puzzle.bestUci.slice(0, 2), endSquare: puzzle.bestUci.slice(2, 4), color: 'var(--good)' }]
    : []

  return (
    <section className="step">
      <p className="eyebrow">{isReview ? 'Back for review' : 'From your games'}</p>
      <h2>{you} to play. Find what you missed.</h2>
      <p className="context">
        Move {puzzle.moveNumber} against{' '}
        <a href={puzzle.gameUrl} target="_blank" rel="noreferrer">{puzzle.opponent}</a>
        {' '}({puzzle.speed}, {ago(puzzle.playedAt)}). You played <strong>{puzzle.playedSan}</strong> and
        gave up about {puzzle.drop} points of winning chances.
      </p>

      <div className="board" data-testid="chessboard">
        <Chessboard
          options={{
            id: 'puzzle',
            position: showLine && status === 'revealed' ? puzzle.fen : fen,
            boardOrientation: puzzle.color === 'w' ? 'white' : 'black',
            allowDragging: canMove,
            allowDrawingArrows: false,
            arrows,
            squareStyles,
            darkSquareStyle: { backgroundColor: 'var(--sq-dark)' },
            lightSquareStyle: { backgroundColor: 'var(--sq-light)' },
            animationDurationInMs: 180,
            canDragPiece: ({ piece }) => piece.pieceType[0] === puzzle.color,
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              if (!targetSquare || !canMove) return false
              const legal = base.moves({ square: sourceSquare as never, verbose: true }).some((m) => m.to === targetSquare)
              if (legal) void tryMove(sourceSquare, targetSquare)
              return legal
            },
            onSquareClick: ({ square }) => onSquareClick(square),
          }}
        />
      </div>

      <div className="feedback" aria-live="polite">
        {status === 'thinking' && <p className="muted">Drag a piece, or tap it and then its square.</p>}
        {status === 'checking' && <p className="muted">Stockfish is checking your move…</p>}
        {status === 'wrong' && <p className="bad">{note}</p>}
        {done && (
          <div className={status === 'solved' && misses === 0 ? 'verdict good' : 'verdict'}>
            <p>
              <strong>
                {status === 'revealed' ? `The move was ${line[0]}.` : misses === 0 ? `${answer} — that's it.` : `${answer} — got there.`}
              </strong>
              {status === 'solved' && answer !== line[0] && <> Stockfish's first choice was {line[0]}; yours is just as good.</>}
            </p>
            <p className="muted">
              Best line: {line.join(' ')} ({puzzle.evalBest} for you). In the game, {puzzle.playedSan} left you at {puzzle.evalPlayed}.
            </p>
          </div>
        )}
      </div>

      <div className="actions">
        {!done && (
          <button className="ghost" onClick={() => { setStatus('revealed'); setSelected(null) }} disabled={status === 'checking'}>
            Show me
          </button>
        )}
        {done && (
          <button className="primary" onClick={() => onDone(status === 'solved' && misses === 0 ? 'solved' : 'missed')}>
            Next
          </button>
        )}
      </div>
    </section>
  )
}
