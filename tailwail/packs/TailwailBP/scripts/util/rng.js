// Seedable PRNG (mulberry32) so encounter logic is reproducible in tests.
export function makeRng(seed = (Date.now() ^ 0x9e3779b9) >>> 0) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(items) {
      // items: [[value, weight], ...]
      const total = items.reduce((a, [, w]) => a + Math.max(0, w), 0);
      if (total <= 0) return items.length ? items[0][0] : undefined;
      let r = next() * total;
      for (const [v, w] of items) {
        r -= Math.max(0, w);
        if (r <= 0) return v;
      }
      return items[items.length - 1][0];
    },
  };
}
