import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { findBlunders, lineToSan, winPercent } from './analysis.ts'
import { analyseCube } from './bearoff.ts'
import { BEAROFF_POSITIONS, choiceEquity, correctChoice, CUBE_POSITIONS, cubeChoices, cubeIndicesForDay, MIDGAME_POSITIONS } from './cube.ts'
import { boardDay, cityClock, detectCity } from './day.ts'
import type { Evaluation } from './engine.ts'
import { parseChessCom, parseLichess, type Game } from './games.ts'
import { bumpStreak, DEFAULT_SETTINGS, gradeCard, mergeStates, pickPuzzles, type PuzzleCard, type State } from './store.ts'

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

  it('turns the losing move into a puzzle with the engine move as the answer', async () => {
    const found = await findBlunders(game, fake, { scanDepth: 1, verifyDepth: 2, threshold: 20, skipMoves: 0 })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ fen: fenAfter(5), playedSan: 'Nf6', bestUci: 'g7g6', color: 'b', moveNumber: 3 })
    expect(found[0].drop).toBeGreaterThan(50)
    expect(lineToSan(found[0].fen, found[0].pv)).toEqual(['g6', 'Qf3', 'Nf6'])
  })
  it('ignores the opponent’s blunders and the skipped opening', async () => {
    expect(await findBlunders({ ...game, userColor: 'w' }, fake, { scanDepth: 1, verifyDepth: 2, threshold: 20, skipMoves: 0 })).toHaveLength(0)
    expect(await findBlunders(game, fake)).toHaveLength(0) // default skips the first 6 moves
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

describe('review schedule', () => {
  const card = (id: string, over: Partial<PuzzleCard> = {}): PuzzleCard =>
    ({ id, box: 0, due: '2026-11-23', seen: 0, playedAt: 0, ...over }) as PuzzleCard
  it('brings a missed puzzle back tomorrow and spaces out solved ones', () => {
    expect(gradeCard(card('a'), 'missed', '2026-11-23').due).toBe('2026-11-24')
    const solved = gradeCard(card('a'), 'solved', '2026-11-23')
    expect(solved).toMatchObject({ box: 2, due: '2026-11-30', seen: 1 })
  })
  it('mixes due reviews with the newest blunders and leaves future cards alone', () => {
    const cards = [
      card('old-review', { seen: 1, due: '2026-11-20' }),
      card('later', { seen: 1, due: '2026-12-01' }),
      card('new-1', { playedAt: 2 }), card('new-2', { playedAt: 3 }), card('new-3', { playedAt: 1 }),
    ]
    expect(pickPuzzles(cards, '2026-11-23', 3)).toEqual(['old-review', 'new-2', 'new-1'])
  })
  it('counts consecutive mornings', () => {
    expect(bumpStreak({ count: 3, lastDay: '2026-11-22' }, '2026-11-23').count).toBe(4)
    expect(bumpStreak({ count: 3, lastDay: '2026-11-20' }, '2026-11-23').count).toBe(1)
  })
})

describe('sync merge', () => {
  const card = (id: string, over: Partial<PuzzleCard> = {}): PuzzleCard =>
    ({ id, box: 0, due: '2026-11-23', seen: 0, playedAt: 0, ...over }) as PuzzleCard
  const me = { ...DEFAULT_SETTINGS, username: 'me' }
  const base = (over: Partial<State> = {}): State =>
    ({ settings: me, cards: [], scannedGames: [], streak: { count: 0, lastDay: null }, ...over })

  it('keeps the more-reviewed copy of each card and the union of everything else', () => {
    const phone = base({ cards: [card('a', { seen: 2, due: '2026-11-30' }), card('b')], scannedGames: ['g1'], syncCode: 'code' })
    const laptop = base({ cards: [card('a', { seen: 1 }), card('c')], scannedGames: ['g2'], streak: { count: 4, lastDay: '2026-11-23' } })
    const m = mergeStates(phone, laptop)
    expect(m.cards.map((c) => c.id).sort()).toEqual(['a', 'b', 'c'])
    expect(m.cards.find((c) => c.id === 'a')!.seen).toBe(2)
    expect(m.scannedGames.sort()).toEqual(['g1', 'g2'])
    expect(m.streak.count).toBe(4)
    expect(m.syncCode).toBe('code')
    // merging is symmetric in content and stable once both sides agree
    const { syncCode: _c, ...remote } = m
    expect(mergeStates(m, remote)).toEqual(m)
  })
  it('combines results of the same deal and prefers the newer day', () => {
    const deal = { day: '2026-11-23', puzzleIds: ['a'], cubeIds: [1], results: {} }
    const m = mergeStates(
      base({ session: { ...deal, results: { 'p:a': 'solved' } } }),
      base({ session: { ...deal, results: { 'c:1': 'missed' } } }),
    )
    expect(m.session!.results).toEqual({ 'p:a': 'solved', 'c:1': 'missed' })
    const newer = mergeStates(base({ session: deal }), base({ session: { ...deal, day: '2026-11-24' } }))
    expect(newer.session!.day).toBe('2026-11-24')
  })
  it('a fresh device adopts the synced player; settings follow the latest change', () => {
    const fresh: State = { settings: DEFAULT_SETTINGS, cards: [], scannedGames: [], streak: { count: 0, lastDay: null }, syncCode: 'code' }
    const m = mergeStates(fresh, base({ cards: [card('a')], settingsAt: 5 }))
    expect(m.settings.username).toBe('me')
    expect(m.cards).toHaveLength(1)
    expect(m.syncCode).toBe('code')
    const changed = mergeStates(base({ settingsAt: 9, settings: { ...me, puzzlesPerDay: 8 } }), base({ settingsAt: 5 }))
    expect(changed.settings.puzzlesPerDay).toBe(8)
  })
})
