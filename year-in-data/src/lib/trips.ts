// Where the owner was, night by night, from the two-city app's stays.
// A stay covers the nights arrive <= night < depart. An open stay (depart null) runs to today.
import { type ISODate, addDays, diffDays, monthKey, monthsIn } from './dates';
import type { Stay } from './types';
import { type YearWindow, elapsedEnd } from './window';

export type Bucket = 'london' | 'istanbul' | 'elsewhere' | 'unrecorded';
export const BUCKETS: Bucket[] = ['london', 'istanbul', 'elsewhere', 'unrecorded'];
export const BUCKET_LABEL: Record<Bucket, string> = { london: 'London', istanbul: 'Istanbul', elsewhere: 'Elsewhere', unrecorded: 'Not recorded' };

export interface DayPlace {
  date: ISODate;
  /** Lower-case city key, or null when no stay covers the night. */
  city: string | null;
  country: string | null;
  bucket: Bucket;
}

export interface Run {
  city: string;
  country: string;
  from: ISODate;
  /** Exclusive. */
  to: ISODate;
  nights: number;
}

export interface TripStats {
  /** Nights of the year that have happened so far. */
  nights: number;
  buckets: Record<Bucket, number>;
  byCity: { city: string; country: string; nights: number }[];
  byCountry: { country: string; nights: number }[];
  /** Changes of city between one recorded night and the next recorded night. */
  moves: number;
  /** Unbroken runs of nights in one city, clipped to the year. */
  runs: Run[];
  longest: Run | null;
  /** Runs outside London and Istanbul. */
  away: Run[];
  /** Cities with nights this year and no stay before it. Null when the file holds nothing earlier to compare with. */
  newPlaces: string[] | null;
  months: ({ month: string } & Record<Bucket, number>)[];
}

export const cityKey = (city: string): string => city.trim().toLowerCase();

export function cityName(key: string): string {
  return key.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function bucketOf(city: string | null): Bucket {
  if (city === null) return 'unrecorded';
  return city === 'london' || city === 'istanbul' ? city : 'elsewhere';
}

/** One entry per night in [from, toExclusive). Where stays overlap, the one that began last wins. */
export function dayPlaces(stays: Stay[], from: ISODate, toExclusive: ISODate, today: ISODate): DayPlace[] {
  const openEnd = addDays(today, 1);
  const sorted = [...stays].sort((a, b) => (a.arrive < b.arrive ? -1 : a.arrive > b.arrive ? 1 : 0));
  const out: DayPlace[] = [];
  const n = diffDays(from, toExclusive);
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    let hit: Stay | null = null;
    for (const s of sorted) {
      if (s.arrive > date) break;
      if (date < (s.depart ?? openEnd)) hit = s;
    }
    const city = hit ? cityKey(hit.city) : null;
    out.push({ date, city, country: hit ? hit.country.toUpperCase() : null, bucket: bucketOf(city) });
  }
  return out;
}

export function tripStats(stays: Stay[], w: YearWindow, today: ISODate): TripStats {
  const days = dayPlaces(stays, w.start, elapsedEnd(w, today), today);
  const buckets: Record<Bucket, number> = { london: 0, istanbul: 0, elsewhere: 0, unrecorded: 0 };
  const cities = new Map<string, { city: string; country: string; nights: number }>();
  const countries = new Map<string, number>();
  const months = new Map<string, { month: string } & Record<Bucket, number>>();
  for (const m of monthsIn(w.start, w.end)) months.set(m, { month: m, london: 0, istanbul: 0, elsewhere: 0, unrecorded: 0 });
  const runs: Run[] = [];
  let moves = 0;
  let lastCity: string | null = null;

  for (const d of days) {
    buckets[d.bucket] += 1;
    months.get(monthKey(d.date))![d.bucket] += 1;
    if (d.city === null || d.country === null) continue;
    const c = cities.get(d.city) ?? { city: d.city, country: d.country, nights: 0 };
    c.nights += 1;
    cities.set(d.city, c);
    countries.set(d.country, (countries.get(d.country) ?? 0) + 1);
    if (lastCity !== null && lastCity !== d.city) moves += 1;
    lastCity = d.city;
    const prev = runs[runs.length - 1];
    if (prev && prev.city === d.city && prev.to === d.date) {
      prev.to = addDays(d.date, 1);
      prev.nights += 1;
    } else {
      runs.push({ city: d.city, country: d.country, from: d.date, to: addDays(d.date, 1), nights: 1 });
    }
  }

  const longest = runs.reduce<Run | null>((best, r) => (!best || r.nights > best.nights ? r : best), null);
  const hasEarlier = stays.some((s) => s.arrive < w.start);
  const before = new Set(stays.filter((s) => s.arrive < w.start).map((s) => cityKey(s.city)));
  const newPlaces = hasEarlier ? [...cities.keys()].filter((c) => !before.has(c)) : null;

  return {
    nights: days.length,
    buckets,
    byCity: [...cities.values()].sort((a, b) => b.nights - a.nights || a.city.localeCompare(b.city)),
    byCountry: [...countries].map(([country, nights]) => ({ country, nights })).sort((a, b) => b.nights - a.nights || a.country.localeCompare(b.country)),
    moves,
    runs,
    longest,
    away: runs.filter((r) => bucketOf(r.city) === 'elsewhere'),
    newPlaces,
    months: [...months.values()],
  };
}
