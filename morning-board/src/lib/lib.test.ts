import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { DEFAULT_SCAN, findBlunders, lineToSan, phaseOf, winPercent } from './analysis.ts'
import { analyseCube } from './bearoff.ts'
import { BEAROFF_POSITIONS, choiceEquity, correctChoice, CUBE_POSITIONS, cubeChoices, cubeIndicesForDay, MIDGAME_POSITIONS } from './cube.ts'
import { boardDay, cityClock, detectCity } from './day.ts'
import type { Evaluation } from './engine.ts'
import { parseChessCom, parseLichess, type Game } from './games.ts'
import { answerStep, blankState, blockSizes, blunderRate, bumpStreak, dealSession, DEFAULT_SETTINGS, grade, mergeStates, type PuzzleCard, type Session, type State } from './store.ts'
import { ENDGAMES, studyPuzzle } from './endgames.ts'

describe('bearoff cube equities', () => {
  it('last-roll position with 75% wins is exactly the take/pass borderline', () => {
    // Roller: one checker on the 6-point (27/36 to bear off). Opponent: one on the ace.
    const a = analyseCube([0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0], 'centered')
    expect(a.win).toBeCloseTo(0.75, 10)
    expect(a.noDouble).toBeCloseTo(0.5, 10)
    expect(a.doubleTake).toBeCloseTo(1, 10)
  })
  it('a near-certain last roll is a pass, a long shot is no double', () => {
    // One checker on the 4-point misses only with 2-1 (34/36), far past the 75% pass line.
    const strong = analyseCube([0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 0, 0], 'centered')
    expect(strong.noDouble).toBeCloseTo((2 * 34) / 36 - 1, 10)
    expect(strong.action).toBe('double-pass')
    // Two checkers on the 6-point: only 6-6, 5-5, 4-4 and 3-3 get both off.
    const a = analyseCube([0, 0, 0, 0, 0, 2], [1, 0, 0, 0, 0, 0], 'centered')
    expect(a.win).toBeCloseTo(4 / 36, 10)
    expect(a.action).toBe('no-double')
  })
  it('matches the textbook two-checker bearoff odds', () => {
    // Ace point + deuce point always come off, even with 1-1 (four aces).
    expect(analyseCube([1, 1, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], 'centered').win).toBeCloseTo(1, 10)
    // 5pt + 2pt: classic 19/36 to get off in one roll.
    expect(analyseCube([0, 1, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0], 'centered').win).toBeCloseTo(19 / 36, 10)
  })
  it('shipped positions agree with the engine and have a clear best choice', () => {
    expect(BEAROFF_POSITIONS.length).toBeGreaterThan(150)
    for (const p of BEAROFF_POSITIONS.filter((_, i) => i % 9 === 0)) {
      const a = analyseCube(p.roller.slice(0, 6), p.opponent.slice(0, 6), p.cube)
      expect(a.action).toBe(p.action)
      expect(a.noDouble).toBeCloseTo(p.noDouble, 3)
      const best = correctChoice(p)
      for (const c of cubeChoices(p)) expect(choiceEquity(p, c.id)).toBeLessThanOrEqual(choiceEquity(p, best) + 1e-9)
    }
  })
  it('middle-game positions are legal and their answer is the best-scoring choice', () => {
    expect(MIDGAME_POSITIONS.length).toBeGreaterThan(150)
    for (const p of MIDGAME_POSITIONS) {
      for (const side of [p.roller, p.opponent]) {
        expect(side).toHaveLength(25)
        const total = side.reduce((a, n) => a + n, 0)
        expect(total).toBeGreaterThan(0)
        expect(total).toBeLessThanOrEqual(15)
      }
      // no point holds checkers of both colours
      for (let i = 0; i < 24; i++) expect(p.roller[i] * p.opponent[23 - i]).toBe(0)
      const best = correctChoice(p)
      const choices = cubeChoices(p)
      expect(choices.map((c) => c.id)).toContain(best)
      for (const c of choices) expect(choiceEquity(p, c.id)).toBeLessThanOrEqual(choiceEquity(p, best) + 1e-9)
    }
  })
  it('mixes middle-game and bearoff positions each day', () => {
    const ids = cubeIndicesForDay('2026-11-23', 3)
    expect(ids.filter((i) => i >= BEAROFF_POSITIONS.length)).toHaveLength(2)
    expect(CUBE_POSITIONS[ids[0]].source).toBe('gnubg')
  })
  it('deals the same distinct positions for a given day', () => {
    const a = cubeIndicesForDay('2026-11-23', 3)
    expect(a).toEqual(cubeIndicesForDay('2026-11-23', 3))
    expect(new Set(a).size).toBe(3)
    expect(a).not.toEqual(cubeIndicesForDay('2026-11-24', 3))
  })
})

describe('blunder detection', () => {
  // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7# — Black's third move walks into mate.
  const game: Game = {
    id: 't:1', url: '', opponent: 'opp', userColor: 'b', speed: 'blitz', playedAt: 0,
    moves: ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'],
  }
  const fenAfter = (n: number) => {
    const c = new Chess()
    game.moves.slice(0, n).forEach((m) => c.move(m))
    return c.fen()
  }
  const fake = async (fen: string): Promise<Evaluation> => {
    if (fen === fenAfter(5)) return { cp: 30, best: 'g7g6', pv: ['g7g6', 'h5f3', 'g8f6'] } // Black to move, fine after g6
    if (fen === fenAfter(6)) return { mate: 1, best: 'h5f7', pv: ['h5f7'] } // White mates
    return { cp: 20, best: 'a2a3', pv: ['a2a3'] }
  }

  const opts = { ...DEFAULT_SCAN, scanDepth: 1, verifyDepth: 2, skipMoves: 0 }

  it('turns the losing move into a puzzle with the engine move as the answer', async () => {
    const { puzzles, movesChecked } = await findBlunders(game, fake, opts)
    expect(movesChecked).toBe(3)
    expect(puzzles).toHaveLength(1)
    expect(puzzles[0]).toMatchObject({ kind: 'avoid', fen: fenAfter(5), playedSan: 'Nf6', bestUci: 'g7g6', color: 'b', moveNumber: 3 })
    expect(puzzles[0].drop).toBeGreaterThan(50)
    expect(lineToSan(puzzles[0].fen, puzzles[0].pv)).toEqual(['g6', 'Qf3', 'Nf6'])
  })
  it('makes a punish card instead when several moves were fine', async () => {
    // Same game, but now the engine says a second move was just as good as g6.
    const withAlternative = async (fen: string): Promise<Evaluation> => {
      const e = await fake(fen)
      return fen === fenAfter(5) ? { ...e, second: { cp: 20 } } : e
    }
    const { puzzles } = await findBlunders(game, withAlternative, opts)
    expect(puzzles).toHaveLength(1)
    // You now play White, in the position after ...Nf6, and must find the mate.
    expect(puzzles[0]).toMatchObject({ kind: 'punish', fen: fenAfter(6), color: 'w', bestUci: 'h5f7', playedSan: 'Nf6', repliedSan: 'Qxf7#', bestWin: 100 })
  })
  it('ignores the opponent’s blunders and the skipped opening', async () => {
    expect((await findBlunders({ ...game, userColor: 'w' }, fake, opts)).puzzles).toHaveLength(0)
    expect((await findBlunders(game, fake)).puzzles).toHaveLength(0) // default skips the first 6 moves
  })
  it('recognises endgames by what is left on the board', () => {
    expect(phaseOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe('middlegame')
    expect(phaseOf('8/5pk1/6p1/8/8/6P1/5PK1/3R4 w - - 0 40')).toBe('endgame')
    expect(phaseOf('3q2k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 30')).toBe('endgame')
    expect(phaseOf('r2q2k1/5ppp/8/8/8/8/5PPP/R2Q2K1 w - - 0 30')).toBe('endgame')
    expect(phaseOf('r1bq2k1/5ppp/2n5/8/8/2N5/5PPP/R1BQ2K1 w - - 0 20')).toBe('middlegame')
  })
  it('win percentage is symmetric and saturates', () => {
    expect(winPercent({ cp: 0 })).toBe(50)
    expect(winPercent({ cp: 300 }) + winPercent({ cp: -300 })).toBeCloseTo(100)
    expect(winPercent({ mate: -3 })).toBe(0)
  })
})

describe('game parsing', () => {
  it('reads Lichess ndjson, skipping variants', () => {
    const nd = [
      { id: 'abc', variant: 'standard', speed: 'blitz', createdAt: 5, moves: 'e4 e5', players: { white: { user: { name: 'Me' } }, black: { user: { name: 'Them' } } } },
      { id: 'def', variant: 'chess960', speed: 'blitz', createdAt: 6, moves: 'e4', players: { white: { user: { name: 'me' } }, black: {} } },
    ].map((g) => JSON.stringify(g)).join('\n')
    const games = parseLichess(nd, 'me')
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({ id: 'lichess:abc', opponent: 'Them', userColor: 'w', moves: ['e4', 'e5'] })
  })
  it('reads Chess.com PGN with clock comments', () => {
    const pgn = '[Event "Live Chess"]\n[White "Them"]\n[Black "Me"]\n\n1. e4 {[%clk 0:02:59]} 1... c5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:57]} 1-0\n'
    const games = parseChessCom([{ url: 'https://www.chess.com/game/live/123', pgn, rules: 'chess', time_class: 'blitz', end_time: 10, white: { username: 'Them' }, black: { username: 'me' } }], 'ME')
    expect(games[0]).toMatchObject({ id: 'chesscom:123', userColor: 'b', opponent: 'Them', moves: ['e4', 'c5', 'Nf3'], playedAt: 10000 })
  })
})

describe('mornings', () => {
  const at = (iso: string) => new Date(iso)
  it('keeps the previous board until 04:00 local, per city', () => {
    // 01:30 UTC in November: London 01:30 (still yesterday's board), Istanbul 04:30 (new board).
    const t = at('2026-11-23T01:30:00Z')
    expect(boardDay('london', t)).toBe('2026-11-22')
    expect(boardDay('istanbul', t)).toBe('2026-11-23')
    expect(cityClock('istanbul', t).text).toBe('04:30')
  })
  it('follows British summer time', () => {
    expect(cityClock('london', at('2026-07-01T06:00:00Z')).text).toBe('07:00')
    expect(cityClock('istanbul', at('2026-07-01T06:00:00Z')).text).toBe('09:00')
  })
  it('detects the city from the device time zone', () => {
    const t = at('2026-11-23T08:00:00Z')
    expect(detectCity(t, 'Europe/Istanbul')).toBe('istanbul')
    expect(detectCity(t, 'Europe/London')).toBe('london')
    expect(detectCity(t, 'Europe/Moscow')).toBe('istanbul')
    expect(detectCity(t, 'Europe/Lisbon')).toBe('london')
  })
})

const card = (id: string, over: Partial<PuzzleCard> = {}): PuzzleCard =>
  ({ id, kind: 'avoid', phase: 'middlegame', box: 0, due: '2026-11-23', seen: 0, playedAt: 0, ...over }) as PuzzleCard
const me = { ...DEFAULT_SETTINGS, username: 'me' }
const base = (over: Partial<State> = {}): State => ({ ...blankState(), settings: me, ...over })
const DAY = '2026-11-23'

describe('review schedule', () => {
  it('brings a missed puzzle back tomorrow and spaces out solved ones', () => {
    expect(grade(card('a'), 'missed', DAY).due).toBe('2026-11-24')
    expect(grade(card('a'), 'solved', DAY)).toMatchObject({ box: 2, due: '2026-11-30', seen: 1 })
  })
  it('counts consecutive mornings', () => {
    expect(bumpStreak({ count: 3, lastDay: '2026-11-22' }, DAY).count).toBe(4)
    expect(bumpStreak({ count: 3, lastDay: '2026-11-20' }, DAY).count).toBe(1)
  })
  it('measures blunders per 100 moves', () => {
    expect(blunderRate([])).toBeNull()
    expect(blunderRate([{ id: 'a', playedAt: 0, moves: 30, blunders: 1 }, { id: 'b', playedAt: 1, moves: 20, blunders: 2 }])).toBeCloseTo(6)
  })
})

describe('the session', () => {
  const cards = [
    card('review-old', { seen: 1, due: '2026-11-20' }),
    card('review-later', { seen: 1, due: '2026-12-01' }),
    card('known', { seen: 3, box: 3, due: '2026-12-10' }),
    card('new-1', { playedAt: 2 }), card('new-2', { playedAt: 3 }),
    card('my-endgame', { playedAt: 1, phase: 'endgame' }),
  ]
  const session = dealSession(base({ cards }), DAY, 0, 1000)
  const keys = (b: string) => session.steps.filter((s) => s.block === b).map((s) => s.key)

  it('deals the blocks in order with the right material in each', () => {
    expect([...new Set(session.steps.map((s) => s.block))]).toEqual(['warmup', 'review', 'fresh', 'endgame', 'cube'])
    expect(keys('warmup')[0]).toBe('p:known') // a position already learned
    expect(keys('review')).toEqual(['p:review-old']) // due, but not the one scheduled for later
    expect(keys('fresh')).toEqual(['p:new-2', 'p:new-1']) // newest game first
    expect(keys('endgame')[0]).toBe('p:my-endgame') // your own endgame blunders before the study set
    expect(keys('endgame')).toHaveLength(blockSizes(me).endgame)
    expect(keys('cube')).toHaveLength(3)
    expect(new Set(session.steps.map((s) => s.key)).size).toBe(session.steps.length)
  })
  it('is the same deal on every device for the same day and state', () => {
    expect(dealSession(base({ cards }), DAY, 0, 1000)).toEqual(session)
    expect(dealSession(base({ cards }), DAY, 1, 1000).steps).not.toEqual(session.steps)
  })
  it('reschedules answered positions, except warm-ups, and logs the finished session', () => {
    let state = base({ cards, session })
    for (const step of session.steps) state = answerStep(state, step.key, step.key === 'p:new-1' ? 'missed' : 'solved', 61000)
    const byId = (id: string) => state.cards.find((c) => c.id === id)!
    expect(byId('known')).toMatchObject({ seen: 3, due: '2026-12-10' }) // warm-up: untouched
    expect(byId('new-1').due).toBe('2026-11-24')
    expect(byId('new-2').box).toBe(2)
    const cubeKey = keys('cube')[0]
    expect(state.reviews[cubeKey]).toMatchObject({ seen: 1, box: 2 })
    expect(state.session!.seconds).toBe(60)
    expect(state.history).toEqual([{ day: DAY, round: 0, solved: session.steps.length - 1, total: session.steps.length, seconds: 60 }])
    expect(state.streak).toEqual({ count: 1, lastDay: DAY })
    // answering twice changes nothing
    expect(answerStep(state, 'p:new-1', 'solved', 99000)).toBe(state)
  })
  it('brings a missed cube position back before dealing new ones', () => {
    const next = dealSession(base({ reviews: { 'c:7': { box: 0, due: '2026-11-24', seen: 1 } } }), '2026-11-24', 0, 0)
    expect(next.steps.filter((s) => s.block === 'cube')[0].key).toBe('c:7')
  })
  it('endgame studies are legal positions with a king move as the answer', () => {
    expect(ENDGAMES.length).toBeGreaterThanOrEqual(30)
    ENDGAMES.forEach((e, i) => {
      const c = new Chess(e.fen)
      const p = studyPuzzle(i)
      expect(p.color).toBe(c.turn())
      const move = c.move({ from: e.bestUci.slice(0, 2), to: e.bestUci.slice(2, 4) })
      expect(move.piece).toBe('k')
    })
  })
})

describe('sync merge', () => {
  it('keeps the more-reviewed copy of each card and the union of everything else', () => {
    const phone = base({ cards: [card('a', { seen: 2, due: '2026-11-30' }), card('b')], scannedGames: ['g1'], syncCode: 'code',
      games: [{ id: 'g1', playedAt: 1, moves: 30, blunders: 1 }], reviews: { 'c:1': { box: 2, due: '2026-11-30', seen: 1 } } })
    const laptop = base({ cards: [card('a', { seen: 1 }), card('c')], scannedGames: ['g2'], streak: { count: 4, lastDay: DAY },
      games: [{ id: 'g2', playedAt: 2, moves: 20, blunders: 0 }], reviews: { 'c:1': { box: 0, due: '2026-11-24', seen: 2 } } })
    const m = mergeStates(phone, laptop)
    expect(m.cards.map((c) => c.id).sort()).toEqual(['a', 'b', 'c'])
    expect(m.cards.find((c) => c.id === 'a')!.seen).toBe(2)
    expect(m.scannedGames.sort()).toEqual(['g1', 'g2'])
    expect(m.games.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(m.reviews['c:1'].seen).toBe(2)
    expect(m.streak.count).toBe(4)
    expect(m.syncCode).toBe('code')
    // stable once both sides agree
    const { syncCode: _c, ...remote } = m
    expect(mergeStates(m, remote)).toEqual(m)
  })
  it('combines results of the same deal and prefers the newer day', () => {
    const deal: Session = { day: DAY, steps: [{ key: 'p:a', block: 'fresh' }, { key: 'c:1', block: 'cube' }], results: {}, startedAt: 5 }
    const m = mergeStates(
      base({ session: { ...deal, results: { 'p:a': 'solved' } } }),
      base({ session: { ...deal, results: { 'c:1': 'missed' }, startedAt: 2 } }),
    )
    expect(m.session!.results).toEqual({ 'p:a': 'solved', 'c:1': 'missed' })
    expect(m.session!.startedAt).toBe(2)
    expect(mergeStates(base({ session: deal }), base({ session: { ...deal, day: '2026-11-24' } })).session!.day).toBe('2026-11-24')
  })
  it('a fresh device adopts the synced player; settings follow the latest change', () => {
    const m = mergeStates({ ...blankState(), syncCode: 'code' }, base({ cards: [card('a')], settingsAt: 5 }))
    expect(m.settings.username).toBe('me')
    expect(m.cards).toHaveLength(1)
    expect(m.syncCode).toBe('code')
    const changed = mergeStates(base({ settingsAt: 9, settings: { ...me, minutes: 45 } }), base({ settingsAt: 5 }))
    expect(changed.settings.minutes).toBe(45)
  })
  it('reads a copy saved by an older version', () => {
    const old = { settings: { ...me, puzzlesPerDay: 4 }, cards: [{ id: 'x', box: 1, due: DAY, seen: 1, playedAt: 0 }], scannedGames: [], streak: { count: 2, lastDay: DAY },
      session: { day: DAY, puzzleIds: ['x'], cubeIds: [1], results: {} } } as unknown as State
    const m = mergeStates(base(), old)
    expect(m.cards[0]).toMatchObject({ id: 'x', kind: 'avoid', phase: 'middlegame' })
    expect(m.session).toBeUndefined()
    expect(m.streak.count).toBe(2)
  })
})
