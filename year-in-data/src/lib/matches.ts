// Matches attended, from the two-city app's fixtures.
import type { Fixture } from './types';
import { type YearWindow, inWindow } from './window';

export interface MatchStats {
  count: number;
  home: number;
  away: number;
  list: Fixture[];
  first: Fixture | null;
  last: Fixture | null;
  byCompetition: { competition: string; count: number }[];
}

export function matchStats(fixtures: Fixture[], w: YearWindow): MatchStats {
  const list = fixtures.filter((f) => f.attended === true && inWindow(f.date, w)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const comps = new Map<string, number>();
  for (const f of list) comps.set(f.competition, (comps.get(f.competition) ?? 0) + 1);
  const home = list.filter((f) => f.home).length;
  return {
    count: list.length,
    home,
    away: list.length - home,
    list,
    first: list[0] ?? null,
    last: list[list.length - 1] ?? null,
    byCompetition: [...comps].map(([competition, count]) => ({ competition, count })).sort((a, b) => b.count - a.count || a.competition.localeCompare(b.competition)),
  };
}
