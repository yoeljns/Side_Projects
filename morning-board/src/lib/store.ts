import type { Puzzle } from './analysis.ts'
import type { Site } from './games.ts'
import { addDays, type CityChoice } from './day.ts'
import type { EngineChoice } from './engine.ts'

export interface Settings {
  site: Site
  username: string
  city: CityChoice
  puzzlesPerDay: number
  cubesPerDay: number
  gamesToScan: number
  engine: EngineChoice
}

export const DEFAULT_SETTINGS: Settings = { site: 'lichess', username: '', city: 'auto', puzzlesPerDay: 4, cubesPerDay: 3, gamesToScan: 12, engine: 'auto' }

/** A puzzle plus its review schedule (a small Leitner box system). */
export interface PuzzleCard extends Puzzle {
  box: number
  due: string // board day
  seen: number
}

export type StepResult = 'solved' | 'missed'

export interface Session {
  day: string
  /** 0 for the morning's board, 1+ for extra rounds dealt on request. */
  round?: number
  puzzleIds: string[]
  cubeIds: number[]
  results: Record<string, StepResult> // keyed "p:<id>" or "c:<index>"
}

export interface State {
  settings: Settings
  cards: PuzzleCard[]
  scannedGames: string[]
  session?: Session
  streak: { count: number; lastDay: string | null }
  /** When the settings were last changed (ms), so the newer device wins a sync. */
  settingsAt?: number
  /** Devices sharing this code share one board. Never uploaded. */
  syncCode?: string
}

const KEY = 'morning-board:v1'
const REVIEW_GAPS = [1, 3, 7, 21] // days until a card comes back, by box

export function loadState(): State {
  const blank: State = { settings: DEFAULT_SETTINGS, cards: [], scannedGames: [], streak: { count: 0, lastDay: null } }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return blank
    const saved = JSON.parse(raw) as Partial<State>
    return { ...blank, ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } }
  } catch {
    return blank
  }
}

export function saveState(state: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Private mode or full storage: the board still works for this visit.
  }
}

/** Cards to show today: overdue reviews first (oldest due), then the freshest unseen blunders. */
export function pickPuzzles(cards: PuzzleCard[], day: string, n: number): string[] {
  const due = cards.filter((c) => c.due <= day)
  const reviews = due.filter((c) => c.seen > 0).sort((a, b) => a.due.localeCompare(b.due))
  const fresh = due.filter((c) => c.seen === 0).sort((a, b) => b.playedAt - a.playedAt)
  // Keep at least half the slots for new material when there is any.
  const reviewSlots = Math.max(n - fresh.length, Math.floor(n / 2))
  const chosen = [...reviews.slice(0, reviewSlots), ...fresh].slice(0, n)
  return chosen.map((c) => c.id)
}

export function gradeCard(card: PuzzleCard, result: StepResult, day: string): PuzzleCard {
  const box = result === 'solved' ? Math.min(card.box + (card.seen === 0 ? 2 : 1), REVIEW_GAPS.length) : 0
  // Past the last box the pattern is learned: park it far in the future.
  const gap = box >= REVIEW_GAPS.length ? 3650 : REVIEW_GAPS[box]
  return { ...card, box, seen: card.seen + 1, due: addDays(day, gap) }
}

export function bumpStreak(streak: State['streak'], day: string): State['streak'] {
  if (streak.lastDay === day) return streak
  return { count: streak.lastDay === addDays(day, -1) ? streak.count + 1 : 1, lastDay: day }
}

const samePlayer = (a: Settings, b: Settings) => a.site === b.site && a.username.toLowerCase() === b.username.toLowerCase()

function mergeSessions(a?: Session, b?: Session): Session | undefined {
  if (!a || !b) return a ?? b
  if (a.day !== b.day) return a.day > b.day ? a : b
  if ((a.round ?? 0) !== (b.round ?? 0)) return (a.round ?? 0) > (b.round ?? 0) ? a : b
  const sameDeal = a.puzzleIds.join() === b.puzzleIds.join() && a.cubeIds.join() === b.cubeIds.join()
  if (sameDeal) return { ...a, results: { ...b.results, ...a.results } }
  // Two devices dealt separately before they synced: keep the one further along (the remote on a tie, so both converge).
  return Object.keys(a.results).length > Object.keys(b.results).length ? a : b
}

/**
 * Combine this device's state with the synced copy. Progress only ever moves
 * forward: a card keeps whichever side has reviewed it more, the newer session
 * and streak win, and settings follow the device that changed them last.
 */
export function mergeStates(local: State, remote: Omit<State, 'syncCode'>): State {
  const remoteNewer = (remote.settingsAt ?? 0) > (local.settingsAt ?? 0)
  if (!samePlayer(local.settings, remote.settings)) {
    // Different players do not mix: the side that changed player most recently wins outright.
    return remoteNewer || !local.settings.username ? { ...remote, syncCode: local.syncCode } : local
  }
  const cards = new Map(remote.cards.map((c) => [c.id, c]))
  for (const c of local.cards) {
    const other = cards.get(c.id)
    if (!other || c.seen > other.seen || (c.seen === other.seen && c.due >= other.due)) cards.set(c.id, c)
  }
  const a = local.streak
  const b = remote.streak
  const streak = (a.lastDay ?? '') === (b.lastDay ?? '') ? (a.count >= b.count ? a : b) : (a.lastDay ?? '') > (b.lastDay ?? '') ? a : b
  return {
    settings: remoteNewer ? remote.settings : local.settings,
    settingsAt: Math.max(local.settingsAt ?? 0, remote.settingsAt ?? 0),
    cards: [...cards.values()],
    scannedGames: [...new Set([...remote.scannedGames, ...local.scannedGames])].slice(-400),
    session: mergeSessions(local.session, remote.session),
    streak,
    syncCode: local.syncCode,
  }
}
