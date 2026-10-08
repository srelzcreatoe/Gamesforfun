// Seeded pseudo-random generator (mulberry32). All gameplay randomness goes
// through one instance per night so a seed fully reproduces a night.

export class Rng {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 0x9e3779b9;
    this.calls = 0;
  }

  /** Float in [0, 1). */
  next() {
    this.calls++;
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  /** FNAF-style movement opportunity: d20 roll succeeds when roll <= aggression. */
  d20(aggression) {
    return this.int(1, 20) <= aggression;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted choice; returns undefined when every weight is zero. */
  weighted(items, weights) {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Interval with +/-10 % jitter, never below 1. */
  jitter(base) {
    return Math.max(1, Math.round(base * (0.9 + this.next() * 0.2)));
  }
}

/** Mix a 32-bit seed (used to derive per-night seeds). */
export function mixSeed(a, b) {
  let h = (a ^ 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
