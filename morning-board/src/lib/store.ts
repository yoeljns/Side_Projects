import type { Puzzle } from './analysis.ts'
import { cubeIndicesForDay, CUBE_POSITIONS } from './cube.ts'
import { addDays, type CityChoice } from './day.ts'
import { ENDGAMES } from './endgames.ts'
import type { EngineChoice } from './engine.ts'
import type { Site } from './games.ts'

export interface Settings {
  site: Site
  username: string
  city: CityChoice
  /** Target length of the morning session; sets how many positions each block gets. */
  minutes: 15 | 30 | 45
  cubesPerDay: number
  gamesToScan: number
  engine: EngineChoice
}

export const DEFAULT_SETTINGS: Settings = { site: 'lichess', username: '', city: 'auto', minutes: 30, cubesPerDay: 3, gamesToScan: 12, engine: 'auto' }

/** Where a card stands in the review schedule (a small Leitner box system). */
export interface Review {
  box: number
  due: string // board day
  seen: number
}

/** A puzzle from your own games plus its review schedule. */
export interface PuzzleCard extends Puzzle, Review {}

export type StepResult = 'solved' | 'missed'

/** The session runs in this order. */
export const BLOCKS = ['warmup', 'review', 'fresh', 'endgame', 'cube'] as const
export type Block = (typeof BLOCKS)[number]

export const BLOCK_INFO: Record<Block, { label: string; share: number }> = {
  warmup: { label: 'Warm-up', share: 0.1 },
  review: { label: 'Blunder review', share: 0.3 },
  fresh: { label: 'Fresh tactics', share: 0.3 },
  endgame: { label: 'Endgames', share: 0.15 },
  cube: { label: 'Backgammon cube', share: 0.15 },
}

/** How many positions each block gets for a session length. */
export function blockSizes(s: Settings): Record<Block, number> {
  const k = s.minutes / 15 // 1, 2 or 3
  return { warmup: k, review: 2 * k, fresh: 2 * k, endgame: k, cube: s.cubesPerDay }
}

/**
 * One position in the session. Keys: "p:<card id>" for your own games,
 * "eg:<index>" for the endgame set, "c:<index>" for a cube position.
 */
export interface Step {
  key: string
  block: Block
}

export interface Session {
  day: string
  /** 0 for the morning's board, 1+ for extra rounds dealt on request. */
  round?: number
  steps: Step[]
  results: Record<string, StepResult>
  startedAt: number
  /** Set when the last step is answered. */
  seconds?: number
}

/** One analysed game, for the blunder rate. */
export interface GameStat {
  id: string
  playedAt: number
  moves: number
  blunders: number
}

export interface SessionLog {
  day: string
  round: number
  solved: number
  total: number
  seconds: number
}

export interface State {
  settings: Settings
  cards: PuzzleCard[]
  /** Review schedule for the built-in sets (endgame studies and cube positions), by step key. */
  reviews: Record<string, Review>
  scannedGames: string[]
  games: GameStat[]
  history: SessionLog[]
  session?: Session
  streak: { count: number; lastDay: string | null }
  /** When the settings were last changed (ms), so the newer device wins a sync. */
  settingsAt?: number
  /** Devices sharing this code share one board. Never uploaded. */
  syncCode?: string
}

const KEY = 'morning-board:v1'
const REVIEW_GAPS = [1, 3, 7, 21] // days until a card comes back, by box

export const blankState = (): State => ({
  settings: DEFAULT_SETTINGS, cards: [], reviews: {}, scannedGames: [], games: [], history: [], streak: { count: 0, lastDay: null },
})

/** Fill in anything a state saved by an older version (or another device) is missing. */
export function normalise(saved: Partial<State>): State {
  const blank = blankState()
  const state = { ...blank, ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } }
  state.cards = state.cards.map((c) => ({ ...c, kind: c.kind ?? 'avoid', phase: c.phase ?? 'middlegame' }))
  if (state.session && !Array.isArray(state.session.steps)) state.session = undefined // dealt by an older version
  return state
}

export function loadState(): State {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalise(JSON.parse(raw) as Partial<State>) : blankState()
  } catch {
    return blankState()
  }
}

export function saveState(state: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Private mode or full storage: the board still works for this visit.
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Cards from your games that are due, split the way the session uses them. */
export function dueCards(cards: PuzzleCard[], day: string) {
  const due = cards.filter((c) => c.due <= day)
  return {
    review: due.filter((c) => c.seen > 0).sort((a, b) => a.due.localeCompare(b.due)),
    fresh: due.filter((c) => c.seen === 0).sort((a, b) => b.playedAt - a.playedAt),
  }
}

/** True when there are enough due cards to fill the review and fresh blocks without scanning more games. */
export function hasEnoughCards(state: State, day: string): boolean {
  const { review, fresh } = dueCards(state.cards, day)
  const sizes = blockSizes(state.settings)
  return review.length + fresh.length >= sizes.review + sizes.fresh + sizes.endgame
}

/** From a built-in set: positions due for review first, then unseen ones chosen by the day. */
function fromSet(prefix: string, size: number, n: number, seed: string, reviews: Record<string, Review>, day: string, fresh: number[] = []): string[] {
  const due = Object.entries(reviews)
    .filter(([k, r]) => k.startsWith(prefix) && r.due <= day && Number(k.slice(prefix.length)) < size)
    .sort((a, b) => a[1].due.localeCompare(b[1].due))
    .map(([k]) => k)
  const keys = due.slice(0, n)
  for (const i of fresh) if (keys.length < n && !reviews[prefix + i] && !keys.includes(prefix + i)) keys.push(prefix + i)
  for (let salt = 0; keys.length < Math.min(n, size) && salt < size * 20; salt++) {
    const k = prefix + (hash(`${seed}#${salt}`) % size)
    // unseen positions first; once every position has been seen, anything not already picked
    if (!keys.includes(k) && (!reviews[k] || salt >= size * 10)) keys.push(k)
  }
  return keys
}

/**
 * Deal the session: warm-up (positions you already know), blunder review (due
 * cards), fresh tactics (new blunders, newest first), endgames (your own
 * endgame blunders, topped up from the study set) and the cube.
 */
export function dealSession(state: State, day: string, round: number, now: number): Session {
  const sizes = blockSizes(state.settings)
  const seed = round ? `${day}/round-${round}` : day
  const used = new Set<string>()
  const take = (cards: PuzzleCard[], n: number) => {
    const picked = cards.filter((c) => !used.has(c.id)).slice(0, n)
    picked.forEach((c) => used.add(c.id))
    return picked.map((c) => `p:${c.id}`)
  }
  const { review, fresh } = dueCards(state.cards, day)

  // Endgames first, so the other blocks do not use up your own endgame blunders.
  const endgame = take([...review, ...fresh].filter((c) => c.phase === 'endgame'), sizes.endgame)
  endgame.push(...fromSet('eg:', ENDGAMES.length, sizes.endgame - endgame.length, `${seed}/eg`, state.reviews, day))

  // Unused review slots go to fresh tactics and the other way round.
  const reviewKeys = take(review, sizes.review)
  const freshKeys = take(fresh, sizes.fresh + sizes.review - reviewKeys.length)
  reviewKeys.push(...take(review, sizes.fresh + sizes.review - reviewKeys.length - freshKeys.length))

  // Warm-up: positions you have already learned and that are not due, longest unseen first.
  const known = state.cards.filter((c) => c.box >= 2 && c.due > day).sort((a, b) => a.due.localeCompare(b.due))
  const warmup = take(known, sizes.warmup)
  for (let salt = 0; warmup.length < sizes.warmup && ENDGAMES.length && salt < 200; salt++) {
    const k = `eg:${hash(`${seed}/warm#${salt}`) % ENDGAMES.length}`
    if (!warmup.includes(k) && !endgame.includes(k)) warmup.push(k)
  }

  const cube = fromSet('c:', CUBE_POSITIONS.length, sizes.cube, seed, state.reviews, day, cubeIndicesForDay(seed, sizes.cube))

  const block = (b: Block, keys: string[]): Step[] => keys.map((key) => ({ key, block: b }))
  return {
    day,
    round,
    steps: [...block('warmup', warmup), ...block('review', reviewKeys), ...block('fresh', freshKeys), ...block('endgame', endgame), ...block('cube', cube)],
    results: {},
    startedAt: now,
  }
}

export function grade<T extends Review>(card: T, result: StepResult, day: string): T {
  const box = result === 'solved' ? Math.min(card.box + (card.seen === 0 ? 2 : 1), REVIEW_GAPS.length) : 0
  // Past the last box the pattern is learned: park it far in the future.
  const gap = box >= REVIEW_GAPS.length ? 3650 : REVIEW_GAPS[box]
  return { ...card, box, seen: card.seen + 1, due: addDays(day, gap) }
}

/** Record an answer: reschedule the position (warm-ups do not count) and close the session after the last one. */
export function answerStep(state: State, key: string, result: StepResult, now: number): State {
  const session = state.session
  if (!session || key in session.results) return state
  const step = session.steps.find((s) => s.key === key)
  if (!step) return state
  const results = { ...session.results, [key]: result }
  let { cards, reviews, streak, history } = state
  if (step.block !== 'warmup') {
    if (key.startsWith('p:')) cards = cards.map((c) => (c.id === key.slice(2) ? grade(c, result, session.day) : c))
    else reviews = { ...reviews, [key]: grade(reviews[key] ?? { box: 0, due: session.day, seen: 0 }, result, session.day) }
  }
  const finished = Object.keys(results).length >= session.steps.length
  const seconds = finished ? Math.round((now - session.startedAt) / 1000) : undefined
  if (finished) {
    streak = bumpStreak(streak, session.day)
    const solved = Object.values(results).filter((r) => r === 'solved').length
    history = [...history, { day: session.day, round: session.round ?? 0, solved, total: session.steps.length, seconds: seconds! }].slice(-200)
  }
  return { ...state, cards, reviews, streak, history, session: { ...session, results, seconds } }
}

export function bumpStreak(streak: State['streak'], day: string): State['streak'] {
  if (streak.lastDay === day) return streak
  return { count: streak.lastDay === addDays(day, -1) ? streak.count + 1 : 1, lastDay: day }
}

/** Blunders per 100 of your moves over a set of analysed games. */
export function blunderRate(games: GameStat[]): number | null {
  const moves = games.reduce((a, g) => a + g.moves, 0)
  return moves ? (games.reduce((a, g) => a + g.blunders, 0) / moves) * 100 : null
}

const samePlayer = (a: Settings, b: Settings) => a.site === b.site && a.username.toLowerCase() === b.username.toLowerCase()

function mergeSessions(a?: Session, b?: Session): Session | undefined {
  if (!a || !b) return a ?? b
  if (a.day !== b.day) return a.day > b.day ? a : b
  if ((a.round ?? 0) !== (b.round ?? 0)) return (a.round ?? 0) > (b.round ?? 0) ? a : b
  const keys = (s: Session) => s.steps.map((x) => x.key).join()
  if (keys(a) === keys(b)) {
    return { ...a, results: { ...b.results, ...a.results }, startedAt: Math.min(a.startedAt, b.startedAt), seconds: a.seconds ?? b.seconds }
  }
  // Two devices dealt separately before they synced: keep the one further along (the remote on a tie, so both converge).
  return Object.keys(a.results).length > Object.keys(b.results).length ? a : b
}

const moreReviewed = (a: Review, b: Review) => a.seen > b.seen || (a.seen === b.seen && a.due >= b.due)

/**
 * Combine this device's state with the synced copy. Progress only ever moves
 * forward: a card keeps whichever side has reviewed it more, the newer session
 * and streak win, and settings follow the device that changed them last.
 */
export function mergeStates(local: State, incoming: Partial<Omit<State, 'syncCode'>>): State {
  const remote = normalise(incoming)
  const remoteNewer = (remote.settingsAt ?? 0) > (local.settingsAt ?? 0)
  if (!samePlayer(local.settings, remote.settings)) {
    // Different players do not mix: the side that changed player most recently wins outright.
    return remoteNewer || !local.settings.username ? { ...remote, syncCode: local.syncCode } : local
  }
  const cards = new Map(remote.cards.map((c) => [c.id, c]))
  for (const c of local.cards) {
    const other = cards.get(c.id)
    if (!other || moreReviewed(c, other)) cards.set(c.id, c)
  }
  const reviews = { ...remote.reviews }
  for (const [k, r] of Object.entries(local.reviews)) if (!reviews[k] || moreReviewed(r, reviews[k])) reviews[k] = r
  const games = new Map([...remote.games, ...local.games].map((g) => [g.id, g]))
  const history = new Map([...remote.history, ...local.history].map((h) => [`${h.day}/${h.round}`, h]))
  const a = local.streak
  const b = remote.streak
  const streak = (a.lastDay ?? '') === (b.lastDay ?? '') ? (a.count >= b.count ? a : b) : (a.lastDay ?? '') > (b.lastDay ?? '') ? a : b
  return {
    settings: remoteNewer ? remote.settings : local.settings,
    settingsAt: Math.max(local.settingsAt ?? 0, remote.settingsAt ?? 0),
    cards: [...cards.values()],
    reviews,
    scannedGames: [...new Set([...remote.scannedGames, ...local.scannedGames])].slice(-400),
    games: [...games.values()].sort((x, y) => x.playedAt - y.playedAt).slice(-400),
    history: [...history.values()].sort((x, y) => x.day.localeCompare(y.day) || x.round - y.round).slice(-200),
    session: mergeSessions(local.session, remote.session),
    streak,
    syncCode: local.syncCode,
  }
}
