/**
 * Small seedable PRNG (mulberry32) plus int-range and shuffle helpers.
 *
 * Deterministic across runs: the same seed produces the same stream on any
 * platform (pure 32-bit integer arithmetic, no Math.random). The generator
 * threads a single `createRng(seed)` closure through layout, minimize, and
 * every shuffle so a whole puzzle is reproducible from its seed.
 */

/** A mulberry32 generator: returns a function yielding floats in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [minInclusive, maxExclusive). Returns minInclusive if the range is empty. */
export function randInt(rng: () => number, minInclusive: number, maxExclusive: number): number {
  if (maxExclusive <= minInclusive) return minInclusive;
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}

/** Fisher-Yates shuffle in place, returning the same array. */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
