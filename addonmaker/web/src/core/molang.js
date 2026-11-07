// A small Molang evaluator for previewing imported animations. Supports
// numbers, + - * / %, comparisons, && || !, ?: , parentheses, query./q.,
// variable./v. (default 0), math.* functions (degrees, like the game).
// Anything unknown evaluates to 0, so previews degrade gracefully.

const MATH = {
  sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180),
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, pow: Math.pow,
  min: Math.min, max: Math.max, exp: Math.exp, ln: Math.log, trunc: Math.trunc,
  clamp: (v, a, b) => Math.min(Math.max(v, a), b), lerp: (a, b, t) => a + (b - a) * t,
  mod: (a, b) => a % b, sign: Math.sign, pi: () => Math.PI,
  random: (a, b) => (a + b) / 2, random_integer: (a, b) => Math.round((a + b) / 2),
  die_roll: () => 0, die_roll_integer: () => 0, hermite_blend: (t) => 3 * t * t - 2 * t * t * t,
  atan: (x) => (Math.atan(x) * 180) / Math.PI, atan2: (y, x) => (Math.atan2(y, x) * 180) / Math.PI,
  asin: (x) => (Math.asin(x) * 180) / Math.PI, acos: (x) => (Math.acos(x) * 180) / Math.PI,
};

function tokenize(src) {
  const t = [];
  const s = String(src);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'f') j++;
      t.push({ k: 'n', v: parseFloat(s.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
      t.push({ k: 'id', v: s.slice(i, j).toLowerCase() });
      i = j; continue;
    }
    if (c === "'") { const j = s.indexOf("'", i + 1); t.push({ k: 's', v: s.slice(i + 1, j < 0 ? s.length : j) }); i = j < 0 ? s.length : j + 1; continue; }
    const two = s.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>=', '??', '->'].includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue; }
    t.push({ k: 'op', v: c });
    i++;
  }
  return t;
}

/** Compiles a Molang string into fn(ctx) → number. Throws on syntax errors. */
export function compileMolang(src) {
  const toks = tokenize(String(src).split(';')[0].replace(/^\s*return\s+/, ''));
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek()?.k === 'op' && peek().v === v;
  const eat = (v) => { if (!isOp(v)) throw new Error(`Expected ${v}`); p++; };
  const prec = { '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };
  function primary() {
    const t = toks[p++];
    if (!t) throw new Error('Unexpected end');
    if (t.k === 'n') return () => t.v;
    if (t.k === 's') return () => t.v;
    if (t.k === 'op' && t.v === '(') { const e = expr(); eat(')'); return e; }
    if (t.k === 'op' && t.v === '-') { const e = unary(); return (c) => -e(c); }
    if (t.k === 'op' && t.v === '!') { const e = unary(); return (c) => (e(c) ? 0 : 1); }
    if (t.k === 'id') {
      let name = t.v.replace(/^q\./, 'query.').replace(/^v\./, 'variable.').replace(/^t\./, 'temp.').replace(/^c\./, 'context.');
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) { args.push(expr()); while (isOp(',')) { p++; args.push(expr()); } }
        eat(')');
        if (name.startsWith('math.')) {
          const f = MATH[name.slice(5)] || (() => 0);
          return (c) => f(...args.map((a) => a(c)));
        }
        return (c) => (c.fn?.[name] ? c.fn[name](...args.map((a) => a(c))) : 0);
      }
      if (name === 'math.pi') return () => Math.PI;
      if (name === 'true') return () => 1;
      if (name === 'false') return () => 0;
      if (name === 'this') return () => 0;
      return (c) => { const v = c.vars?.[name]; return v === undefined ? 0 : v; };
    }
    throw new Error(`Unexpected ${t.v}`);
  }
  function unary() { return primary(); }
  function binary(minPrec) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== 'op' || prec[t.v] === undefined || prec[t.v] < minPrec) break;
      p++;
      const op = t.v;
      const right = binary(prec[op] + 1);
      const l = left;
      left = {
        '+': (c) => l(c) + right(c), '-': (c) => l(c) - right(c), '*': (c) => l(c) * right(c),
        '/': (c) => { const d = right(c); return d ? l(c) / d : 0; }, '%': (c) => l(c) % right(c),
        '<': (c) => +(l(c) < right(c)), '>': (c) => +(l(c) > right(c)), '<=': (c) => +(l(c) <= right(c)), '>=': (c) => +(l(c) >= right(c)),
        '==': (c) => +(l(c) === right(c)), '!=': (c) => +(l(c) !== right(c)),
        '&&': (c) => +(!!l(c) && !!right(c)), '||': (c) => +(!!l(c) || !!right(c)), '??': (c) => l(c) ?? right(c),
      }[op];
    }
    return left;
  }
  function expr() {
    const cond = binary(1);
    if (isOp('?')) {
      p++;
      const a = expr();
      if (isOp(':')) { p++; const b = expr(); return (c) => (cond(c) ? a(c) : b(c)); }
      return (c) => (cond(c) ? a(c) : 0);
    }
    return cond;
  }
  const fn = expr();
  if (p < toks.length) throw new Error(`Unexpected ${toks[p].v}`);
  return fn;
}

const cache = new Map();
export function evalMolang(src, ctx) {
  if (typeof src === 'number') return src;
  if (typeof src === 'boolean') return src ? 1 : 0;
  let f = cache.get(src);
  if (f === undefined) {
    try { f = compileMolang(src); } catch { f = null; }
    if (cache.size > 2000) cache.clear();
    cache.set(src, f);
  }
  if (!f) return 0;
  const v = f(ctx);
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function molangOk(src) {
  if (typeof src !== 'string') return true;
  try { compileMolang(src); return true; } catch { return false; }
}

// ---- Bedrock animation channels (keyframes or expressions) ----
function vec(v, ctx) {
  if (Array.isArray(v)) return [0, 1, 2].map((i) => evalMolang(v[i] ?? v[0] ?? 0, ctx));
  if (v && typeof v === 'object') return vec(v.post ?? v.pre ?? [0, 0, 0], ctx);
  const n = evalMolang(v, ctx);
  return [n, n, n];
}

/** Evaluates one channel (rotation/position/scale) of an imported animation at time t. */
export function evalChannel(ch, t, ctx) {
  if (ch === undefined || ch === null) return null;
  if (Array.isArray(ch) || typeof ch !== 'object' || 'post' in ch || 'pre' in ch) return vec(ch, ctx);
  const keys = Object.keys(ch).map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (!keys.length) return null;
  const at = (k) => ch[String(k)] ?? ch[k.toFixed(1)] ?? ch[Object.keys(ch).find((x) => Number(x) === k)];
  if (t <= keys[0]) return vec(at(keys[0]), ctx);
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i] && t <= keys[i + 1]) {
      const a = vec(at(keys[i]), ctx), b = vec(at(keys[i + 1]), ctx);
      const u = (t - keys[i]) / (keys[i + 1] - keys[i] || 1);
      return a.map((x, j) => x + (b[j] - x) * u);
    }
  }
  return vec(at(keys[keys.length - 1]), ctx);
}

export function animLength(anim) {
  if (Number(anim.animation_length)) return Number(anim.animation_length);
  let max = 0;
  for (const b of Object.values(anim.bones || {})) for (const ch of Object.values(b)) {
    if (ch && typeof ch === 'object' && !Array.isArray(ch)) for (const k of Object.keys(ch)) if (!Number.isNaN(Number(k))) max = Math.max(max, Number(k));
  }
  return max || 1;
}
