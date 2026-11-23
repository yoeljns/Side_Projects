/** Seeded pseudo-random numbers. Same seed, same scenario: the server rebuilds the hidden side from it. */
export type Rng = () => number;

/** FNV-1a hash of a string to an unsigned 32-bit integer. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(...parts: (string | number)[]): Rng {
  return mulberry32(hashString(parts.join('|')));
}

export const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const intBetween = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
