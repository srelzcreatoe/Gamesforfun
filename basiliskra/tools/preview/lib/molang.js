// A small Molang runtime for the offline viewer.  It covers the subset the pack uses
// (arithmetic, comparisons, ternaries, &&/||, assignment statements, math.*, query.*,
// variable.*, temp.*).  Trigonometry is in DEGREES, as in the game.

const D2R = Math.PI / 180;

export const M = {
  sin: (x) => Math.sin(x * D2R),
  cos: (x) => Math.cos(x * D2R),
  tan: (x) => Math.tan(x * D2R),
  asin: (x) => Math.asin(x) / D2R,
  acos: (x) => Math.acos(x) / D2R,
  atan: (x) => Math.atan(x) / D2R,
  atan2: (y, x) => Math.atan2(y, x) / D2R,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  sqrt: Math.sqrt,
  exp: Math.exp,
  ln: Math.log,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  mod: (a, b) => a % b,
  sign: Math.sign,
  pi: Math.PI,
  clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
  lerprotate: (a, b, t) => {
    let d = ((b - a + 540) % 360) - 180;
    return a + d * t;
  },
  hermite_blend: (t) => 3 * t * t - 2 * t * t * t,
  random: (lo, hi) => lo + (hi - lo) * rng(),
  random_integer: (lo, hi) => Math.floor(lo + (hi - lo + 1) * rng()),
  die_roll: (n, lo, hi) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += lo + (hi - lo) * rng();
    return s;
  },
  min_angle: (a) => ((a + 540) % 360) - 180,
};

// deterministic so two renders of one scene match frame for frame
let seed = 1234567;
export function reseed(s) { seed = s >>> 0; }
function rng() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const cache = new Map();

function translate(src) {
  let s = String(src);
  s = s.replace(/'([^']*)'/g, (_, a) => JSON.stringify(a));
  // identifiers are case-insensitive in Molang; lower-case everything outside strings
  s = s.replace(/"[^"]*"|[A-Za-z_][A-Za-z0-9_.]*/g, (m) => (m[0] === '"' ? m : m.toLowerCase()));
  s = s.replace(/\b(\d+(?:\.\d+)?)f\b/g, '$1');
  s = s.replace(/\bquery\./g, 'Q.').replace(/\bq\./g, 'Q.');
  s = s.replace(/\bvariable\./g, 'V.').replace(/\bv\./g, 'V.');
  s = s.replace(/\btemp\./g, 'T.').replace(/\bt\./g, 'T.');
  s = s.replace(/\bmath\./g, 'M.');
  s = s.replace(/\bthis\b/g, 'THIS');
  // bare queries are calls
  s = s.replace(/Q\.([a-z_0-9]+)(?!\s*\(|[a-z_0-9])/g, 'Q.$1()');
  s = s.replace(/M\.pi\b(?!\s*\()/g, 'M.pi');
  return s;
}

/** Compile an expression (number or string) to (Q, V, T, THIS) => number. */
export function expr(src) {
  if (typeof src === 'number') return () => src;
  if (typeof src === 'boolean') return () => (src ? 1 : 0);
  const key = 'e:' + src;
  let fn = cache.get(key);
  if (!fn) {
    const body = translate(src);
    try {
      const raw = body.includes(';') || /\breturn\b/.test(body)
        ? new Function('Q', 'V', 'T', 'M', 'THIS', body.includes('return') ? body : body + '; return 0;')
        : new Function('Q', 'V', 'T', 'M', 'THIS', 'return (' + body + ');');
      fn = (Q, V, T, THIS) => {
        const r = raw(Q, V, T || {}, M, THIS || 0);
        return typeof r === 'boolean' ? (r ? 1 : 0) : (Number.isFinite(r) ? r : 0);
      };
    } catch (e) {
      throw new Error(`Molang compile failed for <${src}> -> <${body}>: ${e.message}`);
    }
    cache.set(key, fn);
  }
  return fn;
}

/** Compile a statement list entry (e.g. "v.x = q.life_time * 2;"). */
export function stmt(src) {
  const key = 's:' + src;
  let fn = cache.get(key);
  if (!fn) {
    const body = translate(src);
    try {
      const raw = new Function('Q', 'V', 'T', 'M', 'THIS', body);
      fn = (Q, V, T) => raw(Q, V, T || {}, M, 0);
    } catch (e) {
      throw new Error(`Molang compile failed for <${src}> -> <${body}>: ${e.message}`);
    }
    cache.set(key, fn);
  }
  return fn;
}

/** Variables default to 0, as unset Molang variables do. */
export function makeVars() {
  return new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : 0),
    set: (t, k, v) => { t[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v; return true; },
  });
}
