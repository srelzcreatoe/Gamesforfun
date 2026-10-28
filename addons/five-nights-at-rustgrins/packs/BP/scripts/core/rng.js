// Small deterministic PRNG (mulberry32) so nights, decor scatter and tests
// are reproducible from a seed.

export class Rng {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }

  /** Float in [0, 1). */
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [a, b] inclusive. */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /** FNAF-style roll 1..20. */
  d20() {
    return this.int(1, 20);
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick: entries [[value, weight], ...]. */
  weighted(entries) {
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
    if (total <= 0) return entries[0]?.[0];
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= Math.max(0, w);
      if (r < 0) return v;
    }
    return entries[entries.length - 1][0];
  }

  /** A child generator with an independent stream. */
  fork(salt = 0) {
    return new Rng((this.next() * 4294967296) ^ (salt * 2654435761));
  }
}
