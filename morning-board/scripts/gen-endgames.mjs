// Generates src/data/endgames.json: pawn endgames where exactly one king move
// holds the result (the only winning move, or the only drawing move), found by
// sampling random positions and checking them with Stockfish.
// Run: node scripts/gen-endgames.mjs
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Chess } from 'chess.js'

const require = createRequire(import.meta.url)
const WANT = Number(process.env.WANT ?? 40)
const SCREEN_DEPTH = 12
const DEPTH = 18
const CONFIRM_DEPTH = 28

let seed = 20261123
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (n) => Math.floor(rnd() * n)

let onLine = () => {}
const sf = require('stockfish')('lite-single', (line) => onLine(line))
const send = (c) => sf.processCommand(c)
const win = (s) => (s.mate !== undefined ? (s.mate > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, s.cp)))) - 1))

function analyse(fen, depth) {
  return new Promise((resolve) => {
    const lines = {}
    onLine = (l) => {
      const m = /^info .*?multipv (\d+) score (cp|mate) (-?\d+)(?: (lowerbound|upperbound))?.* pv (.+)$/.exec(l)
      if (m && !m[4]) lines[m[1]] = { [m[2]]: Number(m[3]), pv: m[5].trim().split(' ') }
      if (l.startsWith('bestmove')) resolve([lines[1], lines[2]])
    }
    send(`position fen ${fen}`)
    send(`go depth ${depth}`)
  })
}

function randomPosition() {
  // White: king + 1-2 pawns. Black: king + 0-1 pawns. Then maybe swap colours.
  const board = Array(64).fill(null)
  const place = (piece, ok = () => true) => {
    for (;;) {
      const sq = int(64)
      if (!board[sq] && ok(sq)) { board[sq] = piece; return sq }
    }
  }
  const pawnRank = (sq) => sq >= 8 && sq < 56
  // Critical positions happen when the kings are fighting over a pawn, so keep everything close together.
  const near = (a, b, d) => Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7))) <= d
  const pawn = place('P', pawnRank)
  place('K', (sq) => near(sq, pawn, 3))
  place('k', (sq) => near(sq, pawn, 4))
  if (rnd() < 0.3) place('P', pawnRank)
  if (rnd() < 0.45) place('p', (sq) => pawnRank(sq) && near(sq, pawn, 4))
  const swap = rnd() < 0.5
  let rows = []
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0
    for (let f = 0; f < 8; f++) {
      let p = board[(swap ? 7 - r : r) * 8 + f]
      if (p && swap) p = p === p.toUpperCase() ? p.toLowerCase() : p.toUpperCase()
      if (!p) empty++
      else { if (empty) row += empty; empty = 0; row += p }
    }
    rows.push(row + (empty || ''))
  }
  return `${rows.join('/')} ${rnd() < 0.5 ? 'w' : 'b'} - - 0 1`
}

function legal(fen) {
  let c
  try { c = new Chess(fen) } catch { return null }
  if (c.isGameOver() || c.moves().length < 3) return null
  // the side that just moved must not be in check
  const other = c.turn() === 'w' ? 'b' : 'w'
  const king = c.board().flat().find((p) => p && p.type === 'k' && p.color === other)
  if (c.isAttacked(king.square, c.turn())) return null
  return c
}

const classify = ([a, b]) => {
  if (!a || !b) return null
  const w1 = win(a), w2 = win(b)
  if (w1 >= 90 && w2 <= 62) return 'win'
  if (w1 >= 38 && w1 <= 62 && w2 <= 10) return 'draw'
  return null
}

const out = []
const count = { win: 0, draw: 0 }
send('uci'); send('setoption name MultiPV value 2'); send('setoption name Hash value 64')
await new Promise((r) => setTimeout(r, 1500))

for (let tries = 0; out.length < WANT && tries < 200000; tries++) {
  const fen = randomPosition()
  const c = legal(fen)
  if (!c) continue
  const quick = classify(await analyse(fen, SCREEN_DEPTH))
  if (!quick || count[quick] >= WANT / 2) continue
  const goal = classify(await analyse(fen, DEPTH))
  if (goal !== quick) continue
  const deep = await analyse(fen, CONFIRM_DEPTH)
  if (classify(deep) !== goal) continue
  const [best] = deep
  // the instructive ones are king moves (opposition, key squares, shouldering), not pawn pushes or captures
  const first = c.move({ from: best.pv[0].slice(0, 2), to: best.pv[0].slice(2, 4), promotion: best.pv[0][4] })
  if (first.captured || first.piece !== 'k') continue
  count[goal]++
  out.push({ fen, goal, bestUci: best.pv[0], pv: best.pv.slice(0, 10), bestWin: Math.round(win(best) * 10) / 10 })
  console.error(out.length, goal, fen, first.san)
}
writeFileSync(new URL('../src/data/endgames.json', import.meta.url), '[\n' + out.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n')
console.error('wrote', out.length, count)
sf.terminate()
process.exit(0)
