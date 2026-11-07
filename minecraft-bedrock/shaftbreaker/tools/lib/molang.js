// Minimal-but-faithful Molang evaluator used by the preview renderer and the
// animation checker. Supports the subset of Molang that Bedrock animation and
// client-entity files commonly use:
//   numbers (with optional trailing "f"), 'strings', parentheses
//   unary - ! ; binary * / + - < <= > >= == != && || ?? ; ternary a ? b : c
//   query./q., variable./v., temp./t., context./c., math.* functions
//   q.property('ns:name') and other query functions with arguments
//   statements separated by ';' with assignment (v.x = expr) and `return expr`
// Bedrock semantics honoured: identifiers are case-insensitive, trig functions
// take/return DEGREES, unknown queries/variables evaluate to 0.

const DEG = Math.PI / 180;

const MATH = {
  abs: Math.abs,
  sin: (x) => Math.sin(x * DEG),
  cos: (x) => Math.cos(x * DEG),
  asin: (x) => Math.asin(x) / DEG,
  acos: (x) => Math.acos(x) / DEG,
  atan: (x) => Math.atan(x) / DEG,
  atan2: (y, x) => Math.atan2(y, x) / DEG,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  trunc: Math.trunc,
  clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
  exp: Math.exp,
  ln: Math.log,
  max: Math.max,
  min: Math.min,
  mod: (a, b) => a % b,
  pow: Math.pow,
  sqrt: Math.sqrt,
  sign: (x) => (x >= 0 ? 1 : -1),
  copy_sign: (a, b) => (b >= 0 ? Math.abs(a) : -Math.abs(a)),
  lerp: (a, b, t) => a + (b - a) * t,
  inverse_lerp: (a, b, v) => (a === b ? 0 : (v - a) / (b - a)),
  lerprotate: (a, b, t) => {
    let d = ((((b - a) % 360) + 540) % 360) - 180;
    return a + d * t;
  },
  min_angle: (a) => ((((a + 180) % 360) + 360) % 360) - 180,
  hermite_blend: (t) => 3 * t * t - 2 * t * t * t,
  pi: () => Math.PI,
  // Deterministic pseudo-random so renders are reproducible.
  random: (lo, hi) => lo + (hi - lo) * 0.5,
  random_integer: (lo, hi) => Math.round(lo + (hi - lo) * 0.5),
  die_roll: (n, lo, hi) => n * (lo + hi) * 0.5,
  die_roll_integer: (n, lo, hi) => Math.round(n * (lo + hi) * 0.5),
  ease_in_out_sine: (a, b, t) => a + (b - a) * (-(Math.cos(Math.PI * t) - 1) / 2),
  ease_in_sine: (a, b, t) => a + (b - a) * (1 - Math.cos((t * Math.PI) / 2)),
  ease_out_sine: (a, b, t) => a + (b - a) * Math.sin((t * Math.PI) / 2),
  ease_in_out_quad: (a, b, t) =>
    a + (b - a) * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  ease_in_out_cubic: (a, b, t) =>
    a + (b - a) * (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

const ALIASES = { q: 'query', v: 'variable', t: 'temp', c: 'context' };

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch) && !(ch === '.' && !/[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = parseFloat(src.slice(i, j));
      if (src[j] === 'f' || src[j] === 'F') j++;
      toks.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.:]/.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if (ch === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) throw new Error('Unterminated string in Molang: ' + src);
      toks.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||', '??', '->'].includes(two)) {
      toks.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/<>!?:(),;={}[]'.includes(ch)) {
      toks.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' in Molang: ${src}`);
  }
  return toks;
}

function normaliseName(name) {
  const dot = name.indexOf('.');
  if (dot < 0) return name;
  const head = name.slice(0, dot);
  return (ALIASES[head] || head) + name.slice(dot);
}

// Pratt parser producing closures (ctx) => value
function parseProgram(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const expect = (v) => {
    const t = next();
    if (!t || t.v !== v) throw new Error(`Expected '${v}' in Molang: ${src}`);
  };

  const BP = { '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7 };

  function primary() {
    const tk = next();
    if (!tk) throw new Error('Unexpected end of Molang: ' + src);
    if (tk.t === 'num') return () => tk.v;
    if (tk.t === 'str') return () => tk.v;
    if (tk.t === 'op' && tk.v === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (tk.t === 'op' && tk.v === '-') { const e = unary(); return (c) => -e(c); }
    if (tk.t === 'op' && tk.v === '!') { const e = unary(); return (c) => (e(c) ? 0 : 1); }
    if (tk.t === 'op' && tk.v === '{') {
      // scoped block: { stmt; stmt; }
      const stmts = [];
      while (!isOp('}')) { stmts.push(statement()); if (isOp(';')) next(); }
      expect('}');
      return (c) => { for (const s of stmts) { const r = s(c); if (r && r.__ret) return r.v; } return 0; };
    }
    if (tk.t === 'id') {
      const name = normaliseName(tk.v);
      if (name === 'true') return () => 1;
      if (name === 'false') return () => 0;
      if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) {
          args.push(expr(0));
          while (isOp(',')) { next(); args.push(expr(0)); }
        }
        expect(')');
        if (name.startsWith('math.')) {
          const fn = MATH[name.slice(5)];
          if (!fn) throw new Error(`Unknown Molang function ${name}`);
          return (c) => fn(...args.map((a) => a(c)));
        }
        return (c) => {
          const fn = c.functions && c.functions[name];
          if (fn) return fn(...args.map((a) => a(c)));
          return 0;
        };
      }
      if (name.startsWith('math.')) {
        const k = name.slice(5);
        if (k === 'pi') return () => Math.PI;
        throw new Error(`Unknown Molang constant ${name}`);
      }
      return (c) => {
        const v = c.values ? c.values[name] : undefined;
        if (typeof v === 'function') return v();
        return v === undefined ? 0 : v;
      };
    }
    throw new Error(`Unexpected token '${tk.v}' in Molang: ${src}`);
  }

  function unary() { return primary(); }

  function expr(minBp) {
    let lhs = primary();
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op') break;
      if (tk.v === '?') {
        if (minBp > 0) break;
        next();
        const a = expr(0);
        if (isOp(':')) {
          next();
          const b = expr(0);
          const cond = lhs;
          lhs = (c) => (truthy(cond(c)) ? a(c) : b(c));
        } else {
          const cond = lhs; // binary conditional: cond ? a  (else 0)
          lhs = (c) => (truthy(cond(c)) ? a(c) : 0);
        }
        continue;
      }
      const bp = BP[tk.v];
      if (bp === undefined || bp <= minBp) break;
      next();
      const rhs = expr(bp);
      const l = lhs;
      switch (tk.v) {
        case '+': lhs = (c) => l(c) + rhs(c); break;
        case '-': lhs = (c) => l(c) - rhs(c); break;
        case '*': lhs = (c) => l(c) * rhs(c); break;
        case '/': lhs = (c) => { const d = rhs(c); return d === 0 ? 0 : l(c) / d; }; break;
        case '<': lhs = (c) => (l(c) < rhs(c) ? 1 : 0); break;
        case '<=': lhs = (c) => (l(c) <= rhs(c) ? 1 : 0); break;
        case '>': lhs = (c) => (l(c) > rhs(c) ? 1 : 0); break;
        case '>=': lhs = (c) => (l(c) >= rhs(c) ? 1 : 0); break;
        case '==': lhs = (c) => (eq(l(c), rhs(c)) ? 1 : 0); break;
        case '!=': lhs = (c) => (eq(l(c), rhs(c)) ? 0 : 1); break;
        case '&&': lhs = (c) => (truthy(l(c)) && truthy(rhs(c)) ? 1 : 0); break;
        case '||': lhs = (c) => (truthy(l(c)) || truthy(rhs(c)) ? 1 : 0); break;
        case '??': lhs = (c) => { const v = l(c); return v === undefined || v === null ? rhs(c) : v; }; break;
      }
    }
    return lhs;
  }

  function statement() {
    const tk = peek();
    if (tk && tk.t === 'id' && tk.v === 'return') {
      next();
      const e = expr(0);
      return (c) => ({ __ret: true, v: e(c) });
    }
    // assignment?
    if (tk && tk.t === 'id' && toks[p + 1] && toks[p + 1].t === 'op' && toks[p + 1].v === '=') {
      const name = normaliseName(tk.v);
      p += 2;
      const e = expr(0);
      return (c) => { c.values[name] = e(c); return undefined; };
    }
    const e = expr(0);
    return (c) => ({ __val: true, v: e(c) });
  }

  const stmts = [];
  while (p < toks.length) {
    if (isOp(';')) { next(); continue; }
    stmts.push(statement());
    if (p < toks.length && !isOp(';')) throw new Error(`Unexpected '${peek().v}' in Molang: ${src}`);
  }
  const single = stmts.length === 1;
  return (c) => {
    let last = 0;
    for (const s of stmts) {
      const r = s(c);
      if (r && r.__ret) return r.v;
      if (r && r.__val) last = r.v;
    }
    return single ? last : last;
  };
}

function truthy(v) { return typeof v === 'string' ? v.length > 0 : v !== 0 && !!v; }
function eq(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return String(a).toLowerCase() === String(b).toLowerCase();
  return Math.abs(a - b) < 1e-9;
}

const cache = new Map();
export function compileMolang(src) {
  if (typeof src === 'number') return () => src;
  if (typeof src === 'boolean') return () => (src ? 1 : 0);
  const key = String(src);
  let fn = cache.get(key);
  if (!fn) {
    fn = parseProgram(key);
    cache.set(key, fn);
  }
  return fn;
}

export function evalMolang(src, ctx) {
  return compileMolang(src)(ctx);
}

// Build a context from plain query/variable maps.
//   makeContext({ 'query.anim_time': 1.2, 'variable.x': 3 }, { 'query.property': (n) => ... })
export function makeContext(values = {}, functions = {}) {
  const v = {};
  for (const [k, val] of Object.entries(values)) v[normaliseName(k.toLowerCase())] = val;
  const f = {};
  for (const [k, val] of Object.entries(functions)) f[normaliseName(k.toLowerCase())] = val;
  return { values: v, functions: f };
}

export { MATH as MOLANG_MATH };
