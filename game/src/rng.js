// NEON RUSH — seeded random numbers.
// Every bit of randomness in the game comes from here, so a race with the
// same seed always plays out the same way. mulberry32: small, fast, and
// deterministic across engines. Nothing in this file touches Date or
// Math.random, and nothing else in the game is allowed to either.

export function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick a value in [min, max) from a rng function.
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

// Pick an integer in [min, max] inclusive.
export function intRange(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Fisher-Yates shuffle that consumes only the given rng.
export function shuffle(rng, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
