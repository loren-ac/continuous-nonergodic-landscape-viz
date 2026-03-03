// Seedable PRNG: xoshiro128** with splitmix32 seed expansion
// Deterministic, fast, suitable for Monte Carlo in Web Workers

function splitmix32(seed) {
  seed = seed | 0;
  return function () {
    seed = (seed + 0x9e3779b9) | 0;
    let z = seed;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed) {
  const sm = splitmix32(seed);
  return { s: new Uint32Array([sm(), sm(), sm(), sm()]) };
}

export function nextU32(rng) {
  const s = rng.s;
  const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
  const t = s[1] << 9;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);
  return result;
}

function rotl(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function nextFloat(rng) {
  return (nextU32(rng) >>> 0) / 4294967296;
}

export function sampleCategorical(rng, probs, V) {
  const u = nextFloat(rng);
  let cum = 0;
  for (let i = 0; i < V - 1; i++) {
    cum += probs[i];
    if (u < cum) return i;
  }
  return V - 1;
}
