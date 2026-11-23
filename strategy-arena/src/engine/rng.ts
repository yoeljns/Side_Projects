/** Seeded pseudo-random numbers. Same seed, same stream — every run is reproducible. */
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

/** An RNG keyed by any mix of labels, e.g. makeRng(seed, 'games', 'tft', 'alld'). */
export function makeRng(...parts: (string | number)[]): Rng {
  return mulberry32(hashString(parts.join('|')));
}

/** A child stream that does not share draws with its parent after creation. */
export function fork(rng: Rng): Rng {
  return mulberry32(Math.floor(rng() * 4294967296));
}
