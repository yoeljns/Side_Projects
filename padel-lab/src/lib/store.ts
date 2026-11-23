// The match log lives in this browser's localStorage. No account, no upload.
import type { Zone } from './court';
import type { RallySummary } from './hits';
import type { TeamStats } from './stats';

export type SavedPlayer = {
  slot: number;
  seenSec: number;
  zonePct: Record<Zone, number>;
  distanceM: number;
  heat: number[];
  /** m/s */
  topSpeed: number;
  avgSpeed: number;
  /** Share of time on the player's own left side, 0..1. */
  leftPct: number;
  netApproaches: number;
  avgNetDist: number;
};

export type Match = {
  id: string;
  /** ISO date (yyyy-mm-dd) the match was played. */
  date: string;
  savedAt: string;
  /** Your level at the time (e.g. Playtomic 0–7), if you track one. */
  level: number | null;
  result: 'W' | 'L' | '';
  score: string;
  partner: string;
  opponents: string;
  notes: string;
  videoName: string;
  analysedSec: number;
  inPlayOnly: boolean;
  /** Which of the four tracked players is you, if identified. */
  me: number | null;
  meThumb: string | null;
  players: SavedPlayer[];
  teams: { near: TeamStats; far: TeamStats } | null;
  rallies: RallySummary | null;
};

const KEY = 'padel-lab:matches:v2';

export function loadMatches(): Match[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Match[]) : [];
    return Array.isArray(list) ? list.sort(byDate) : [];
  } catch {
    return [];
  }
}

const byDate = (a: Match, b: Match): number => a.date.localeCompare(b.date) || a.savedAt.localeCompare(b.savedAt);

function write(list: Match[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function saveMatch(m: Match): Match[] {
  const list = loadMatches().filter((x) => x.id !== m.id);
  list.push(m);
  list.sort(byDate);
  write(list);
  return list;
}

export function deleteMatch(id: string): Match[] {
  const list = loadMatches().filter((x) => x.id !== id);
  write(list);
  return list;
}

export function exportMatches(): string {
  return JSON.stringify({ app: 'padel-lab', version: 1, matches: loadMatches() }, null, 2);
}

/** Merge matches from an export file. Returns how many were added or updated. */
export function importMatches(json: string): number {
  const data = JSON.parse(json);
  const incoming: unknown = Array.isArray(data) ? data : data?.matches;
  if (!Array.isArray(incoming)) throw new Error('Not a Padel Lab export file.');
  const valid = incoming.filter(
    (m): m is Match => !!m && typeof m.id === 'string' && typeof m.date === 'string' && Array.isArray(m.players),
  );
  const map = new Map(loadMatches().map((m) => [m.id, m]));
  for (const m of valid) map.set(m.id, m);
  write([...map.values()].sort(byDate));
  return valid.length;
}

export const myStats = (m: Match): SavedPlayer | null =>
  m.me === null ? null : (m.players.find((p) => p.slot === m.me) ?? null);

export const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
