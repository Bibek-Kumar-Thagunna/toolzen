/**
 * Deterministic randomness for the text tools.
 *
 * Two sources, chosen explicitly by the caller:
 *
 * - {@link mulberry32} — a tiny seeded PRNG. Used whenever the user supplies a
 *   seed so "shuffle these lines" or "generate this lorem ipsum" is
 *   reproducible, and so unit tests can assert on exact output.
 * - {@link cryptoRng} — `crypto.getRandomValues`, used when no seed is given.
 *
 * `Math.random` is deliberately never used: some of the values produced by the
 * generator tools end up treated as identifiers, and a predictable identifier
 * is a bug waiting to happen.
 */

/** A uniform float source in `[0, 1)`, matching `Math.random`'s contract. */
export type Rng = () => number;

/**
 * Mulberry32. 32 bits of state, passes gjrand/PractRand's smaller batteries,
 * and is short enough to audit at a glance — which matters more here than
 * statistical perfection, because the only requirement is "looks shuffled and
 * repeats exactly for a given seed".
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Crypto-backed float source. Available in browsers and Node 20+. */
export function cryptoRng(): Rng {
  const buffer = new Uint32Array(1);
  return () => {
    crypto.getRandomValues(buffer);
    return buffer[0] / 4294967296;
  };
}

/** `seed === undefined` picks the crypto source, otherwise mulberry32. */
export function rngFromSeed(seed?: number): Rng {
  return seed === undefined ? cryptoRng() : mulberry32(seed);
}

/** Integer in `[minInclusive, maxExclusive)`. Returns `min` for empty ranges. */
export function randomInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  if (maxExclusive <= minInclusive) return minInclusive;
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}

/** Uniform pick from a non-empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randomInt(rng, 0, items.length)];
}

/** Fisher-Yates on a copy, so the caller's array is untouched. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, 0, i + 1);
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}
