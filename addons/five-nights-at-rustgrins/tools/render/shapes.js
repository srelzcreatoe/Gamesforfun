// Vanilla block shapes -> quads. Pure JS (no three.js), used by world.js in the browser.
//
// Shapes are written as Java-style model elements in block pixels (0..16):
//   { from:[x,y,z], to:[x,y,z], rotation?:{origin,axis,angle,rescale}, faces:{ dir:{ tex, uv?, rot?, cull? } } }
// Face UVs follow the Java model convention (u right / v down as seen from outside the face;
// omitted uv = auto uv from the element position, i.e. world-locked like `uvlock`).
// bake() applies a model Y rotation (Java convention: clockwise seen from above) and outputs quads:
//   { p:[12] block units, uv:[8] (three.js, v up), n:[3], tex, cull:dir|null }
// Vertex order per quad: TL, TR, BR, BL as seen from outside; triangles (0,3,2) (0,2,1) are CCW.

export const DIRS = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const CW = { north: 'east', east: 'south', south: 'west', west: 'north', up: 'up', down: 'down' }; // 90° clockwise from above
const LEFT = { north: 'west', west: 'south', south: 'east', east: 'north' };
const RIGHT = { north: 'east', east: 'south', south: 'west', west: 'north' };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const HORIZ = ['north', 'south', 'west', 'east'];
const FACING6 = ['down', 'up', 'north', 'south', 'west', 'east']; // facing_direction 0..5
const WEIRDO = ['east', 'west', 'south', 'north']; // weirdo_direction / trapdoor direction 0..3
const YROT = { north: 0, east: 90, south: 180, west: 270 }; // Java blockstate y for models authored facing north

function corners(f, t, dir) {
  const [x1, y1, z1] = f, [x2, y2, z2] = t;
  switch (dir) {
    case 'north': return [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]];
    case 'south': return [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]];
    case 'west': return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]];
    case 'east': return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]];
    case 'up': return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
    default: return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]];
  }
}
function autoUV(f, t, dir) {
  const [x1, y1, z1] = f, [x2, y2, z2] = t;
  switch (dir) {
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 'south': return [x1, 16 - y2, x2, 16 - y1];
    case 'west': return [z1, 16 - y2, z2, 16 - y1];
    case 'east': return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
    case 'up': return [x1, z1, x2, z2];
    default: return [x1, 16 - z2, x2, 16 - z1];
  }
}
const SHIFT = { 0: 0, 90: 3, 180: 2, 270: 1 };

function rotPoint(p, axis, deg, o) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
  if (axis === 'x') return [x + o[0], y * c - z * s + o[1], y * s + z * c + o[2]];
  if (axis === 'y') return [x * c + z * s + o[0], y + o[1], -x * s + z * c + o[2]];
  return [x * c - y * s + o[0], x * s + y * c + o[1], z + o[2]];
}

/** Rotate an element's box 90° clockwise (from above) about the block centre, keeping face semantics. */
function rotElementY90(el) {
  const f = el.from, t = el.to;
  const nf = [16 - t[2], f[1], f[0]], nt = [16 - f[2], t[1], t[0]];
  const faces = {};
  for (const [d, fc] of Object.entries(el.faces)) {
    const nfc = { ...fc };
    if (fc.uv) { if (d === 'up') nfc.rot = ((fc.rot ?? 0) + 90) % 360; if (d === 'down') nfc.rot = ((fc.rot ?? 0) + 270) % 360; }
    if (typeof fc.cull === 'string') nfc.cull = CW[fc.cull];
    faces[CW[d]] = nfc;
  }
  return { ...el, from: nf, to: nt, faces };
}

/** Bake elements to quads. opts.y: model rotation (0/90/180/270, clockwise from above). */
export function bake(elements, { y = 0, xFlip = false } = {}) {
  const quads = [];
  const steps = ((y % 360) + 360) % 360 / 90;
  for (let el of elements) {
    const vertexRot = !!el.rotation;
    if (!vertexRot) for (let k = 0; k < steps; k++) el = rotElementY90(el);
    for (const [dir, fc] of Object.entries(el.faces)) {
      if (!fc) continue;
      const cs = corners(el.from, el.to, dir);
      const uv = fc.uv ?? autoUV(el.from, el.to, dir);
      const base = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
      const sh = SHIFT[((fc.rot ?? 0) % 360 + 360) % 360] ?? 0;
      let pts = cs;
      let n = DIRS[dir].slice();
      if (el.rotation) {
        const { origin, axis, angle, rescale } = el.rotation;
        pts = pts.map((p) => rotPoint(p, axis, angle, origin));
        n = rotPoint(n, axis, angle, [0, 0, 0]);
        if (rescale) {
          const sc = 1 / Math.cos(Math.abs(angle) * Math.PI / 180);
          pts = pts.map((p) => p.map((v, i) => (['x', 'y', 'z'][i] === axis ? v : origin[i] + (v - origin[i]) * sc)));
        }
      }
      if (vertexRot && steps) {
        for (let k = 0; k < steps; k++) { pts = pts.map((p) => rotPoint(p, 'y', -90, [8, 8, 8])); n = rotPoint(n, 'y', -90, [0, 0, 0]); }
      }
      let cull = fc.cull === true ? dir : (fc.cull || null);
      if (vertexRot && steps && typeof cull === 'string') for (let k = 0; k < steps; k++) cull = CW[cull];
      const p = new Array(12), u = new Array(8);
      for (let i = 0; i < 4; i++) {
        const q = pts[i];
        p[i * 3] = q[0] / 16; p[i * 3 + 1] = (xFlip ? 16 - q[1] : q[1]) / 16; p[i * 3 + 2] = q[2] / 16;
        const b = base[(i + sh) % 4];
        u[i * 2] = b[0] / 16; u[i * 2 + 1] = 1 - b[1] / 16;
      }
      if (xFlip) { n = [n[0], -n[1], n[2]]; if (cull === 'up') cull = 'down'; else if (cull === 'down') cull = 'up'; }
      quads.push({ p, uv: u, n, tex: fc.tex, cull, flip: xFlip, tint: fc.tint });
    }
  }
  return quads;
}

// ------------------------------------------------------------------ element helpers
const box = (from, to, faces, rotation) => ({ from, to, faces, ...(rotation ? { rotation } : {}) });
/** Faces map for a box: tex per face (string key into the block's tex or function(dir)), cull on block boundary. */
function facesFor(from, to, tex, { skip = [], uv = {}, rot = {} } = {}) {
  const out = {};
  for (const d of ['north', 'south', 'west', 'east', 'up', 'down']) {
    if (skip.includes(d)) continue;
    const onEdge = (d === 'north' && from[2] === 0) || (d === 'south' && to[2] === 16) || (d === 'west' && from[0] === 0) || (d === 'east' && to[0] === 16) || (d === 'down' && from[1] === 0) || (d === 'up' && to[1] === 16);
    out[d] = { tex: typeof tex === 'function' ? tex(d) : tex, cull: onEdge ? d : null, ...(uv[d] ? { uv: uv[d] } : {}), ...(rot[d] ? { rot: rot[d] } : {}) };
  }
  return out;
}
const T = (e) => (d) => e.tex[d];

function halfRange(dir) {
  switch (dir) {
    case 'north': return { x: [0, 16], z: [0, 8] };
    case 'south': return { x: [0, 16], z: [8, 16] };
    case 'west': return { x: [0, 8], z: [0, 16] };
    default: return { x: [8, 16], z: [0, 16] };
  }
}
function quarter(a, b) { // intersection of two orthogonal halves
  const A = halfRange(a), B = halfRange(b);
  return { x: [Math.max(A.x[0], B.x[0]), Math.min(A.x[1], B.x[1])], z: [Math.max(A.z[0], B.z[0]), Math.min(A.z[1], B.z[1])] };
}

// ------------------------------------------------------------------ neighbour-dependent state
const isStairs = (b) => b && b.shape === 'stairs';
function stairFacing(b) { return WEIRDO[b.states?.weirdo_direction ?? 0] ?? 'east'; }
function stairCorner(e, nb) {
  const c = e.states?.['minecraft:corner'];
  if (typeof c === 'string') return c === 'none' ? 'straight' : c;
  const F = stairFacing(e), half = !!e.states?.upside_down_bit;
  const d = DIRS[F];
  const back = nb(d[0], 0, d[2]);
  const same = (b) => isStairs(b) && !!b.states?.upside_down_bit === half;
  const canTake = (dir) => { const v = DIRS[dir]; const n = nb(v[0], 0, v[2]); return !(same(n) && stairFacing(n) === F); };
  if (same(back)) {
    const bf = stairFacing(back);
    if ((bf === LEFT[F] || bf === RIGHT[F]) && canTake(OPP[bf])) return bf === LEFT[F] ? 'outer_left' : 'outer_right';
  }
  const front = nb(-d[0], 0, -d[2]);
  if (same(front)) {
    const ff = stairFacing(front);
    if ((ff === LEFT[F] || ff === RIGHT[F]) && canTake(ff)) return ff === LEFT[F] ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}
const CONN_KEYS = { north: 'minecraft:connection_north', south: 'minecraft:connection_south', west: 'minecraft:connection_west', east: 'minecraft:connection_east' };
function connections(e, nb, accept) {
  const st = e.states ?? {};
  const has = HORIZ.some((d) => CONN_KEYS[d] in st);
  const out = {};
  for (const d of HORIZ) {
    if (has) { out[d] = !!st[CONN_KEYS[d]]; continue; }
    const v = DIRS[d];
    const n = nb(v[0], 0, v[2]);
    out[d] = !!n && (n.full || accept(n));
  }
  return out;
}
function doorInfo(e, nb) {
  const st = e.states ?? {};
  const upper = !!st.upper_block_bit;
  let dir = st['minecraft:cardinal_direction'], open = !!st.open_bit, hinge = !!st.door_hinge_bit;
  const other = nb(0, upper ? -1 : 1, 0);
  const pair = other && other.shape === 'door' && other.name === e.name && !!other.states?.upper_block_bit !== upper ? other : null;
  if (upper && pair) { dir = pair.states?.['minecraft:cardinal_direction'] ?? dir; open = !!pair.states?.open_bit; }
  if (!upper && pair && pair.states && 'door_hinge_bit' in pair.states) hinge = !!pair.states.door_hinge_bit;
  if (typeof dir === 'number') dir = WEIRDO[dir];
  return { upper, dir: dir ?? 'east', open, hinge };
}

/** Cache key for neighbour-dependent shapes (null = depends only on the palette entry). */
export function shapeKey(e, nb) {
  switch (e.shape) {
    case 'stairs': return stairCorner(e, nb);
    case 'pane': case 'fence': case 'wall': {
      const c = connections(e, nb, (n) => acceptConn(e, n));
      const up = e.shape === 'wall' ? (nb(0, 1, 0)?.full ? 1 : 0) : 0;
      return HORIZ.map((d) => (c[d] ? 1 : 0)).join('') + up;
    }
    case 'door': { const d = doorInfo(e, nb); return `${d.dir}${+d.open}${+d.hinge}${+d.upper}`; }
    default: return null;
  }
}
function acceptConn(e, n) {
  if (e.shape === 'pane') return n.shape === 'pane' || n.shape === 'glass' || n.shape === 'wall';
  if (e.shape === 'fence') return n.shape === 'fence' || n.shape === 'fence_gate';
  if (e.shape === 'wall') return n.shape === 'wall' || n.shape === 'pane' || n.shape === 'fence_gate';
  return false;
}

// ------------------------------------------------------------------ shapes
/** Build quads for a vanilla block. Returns { quads, sign? } (sign: text anchor for wall/standing signs). */
export function buildShape(e, nb) {
  const st = e.states ?? {};
  const tx = T(e);
  switch (e.shape) {
    case 'slab': {
      const top = st['minecraft:vertical_half'] === 'top' || st.top_slot_bit === true;
      const f = [0, top ? 8 : 0, 0], t = [16, top ? 16 : 8, 16];
      return { quads: bake([box(f, t, facesFor(f, t, tx))]) };
    }
    case 'stairs': {
      const F = stairFacing(e), shape = stairCorner(e, nb), ud = !!st.upside_down_bit;
      const sy = ud ? [8, 16] : [0, 8], ty = ud ? [0, 8] : [8, 16];
      const els = [];
      const add = (r, y) => { const f = [r.x[0], y[0], r.z[0]], t = [r.x[1], y[1], r.z[1]]; els.push(box(f, t, facesFor(f, t, tx))); };
      add({ x: [0, 16], z: [0, 16] }, sy);
      if (shape === 'straight') add(halfRange(F), ty);
      else if (shape === 'outer_left') add(quarter(F, LEFT[F]), ty);
      else if (shape === 'outer_right') add(quarter(F, RIGHT[F]), ty);
      else if (shape === 'inner_left') { add(halfRange(F), ty); add(quarter(OPP[F], LEFT[F]), ty); }
      else if (shape === 'inner_right') { add(halfRange(F), ty); add(quarter(OPP[F], RIGHT[F]), ty); }
      return { quads: bake(els) };
    }
    case 'carpet': { const f = [0, 0, 0], t = [16, 1, 16]; return { quads: bake([box(f, t, facesFor(f, t, tx))]) }; }
    case 'plate': { const f = [1, 0, 1], t = [15, 1, 15]; return { quads: bake([box(f, t, facesFor(f, t, tx))]) }; }
    case 'snow_layer': { const h = Math.min(16, ((st.height ?? 0) + 1) * 2); const f = [0, 0, 0], t = [16, h, 16]; return { quads: bake([box(f, t, facesFor(f, t, tx))]) }; }
    case 'pillar': return { quads: pillar(e, st.pillar_axis ?? 'y') };
    case 'barrel': return { quads: barrel(e, FACING6[st.facing_direction ?? 1] ?? 'up') };
    case 'trapdoor': {
      const F = WEIRDO[st.direction ?? 0] ?? 'east', open = !!st.open_bit, ud = !!st.upside_down_bit;
      const t = e.tex.up;
      let el;
      if (!open) {
        const y0 = ud ? 13 : 0;
        const f = [0, y0, 0], to = [16, y0 + 3, 16];
        el = box(f, to, {
          down: { tex: t, uv: [0, 0, 16, 16], cull: ud ? null : 'down' }, up: { tex: t, uv: [0, 0, 16, 16], cull: ud ? 'up' : null },
          north: { tex: t, uv: [0, 16, 16, 13], cull: 'north' }, south: { tex: t, uv: [0, 16, 16, 13], cull: 'south' },
          west: { tex: t, uv: [0, 16, 16, 13], cull: 'west' }, east: { tex: t, uv: [0, 16, 16, 13], cull: 'east' },
        });
      } else {
        const r = ud ? 180 : 0;
        el = box([0, 0, 13], [16, 16, 16], {
          down: { tex: t, uv: [0, 13, 16, 16], cull: 'down' }, up: { tex: t, uv: [0, 16, 16, 13], cull: 'up' },
          north: { tex: t, uv: [0, 0, 16, 16], rot: r }, south: { tex: t, uv: [16, 0, 0, 16], rot: r, cull: 'south' },
          west: { tex: t, uv: [16, 0, 13, 16], cull: 'west' }, east: { tex: t, uv: [13, 0, 16, 16], cull: 'east' },
        });
      }
      return { quads: bake([el], { y: YROT[F] }) };
    }
    case 'door': return { quads: door(e, nb) };
    case 'pane': return { quads: pane(e, nb) };
    case 'fence': return { quads: fence(e, nb) };
    case 'fence_gate': return { quads: fenceGate(e) };
    case 'wall': return { quads: wall(e, nb) };
    case 'chain': {
      const els = [
        box([6.5, 0, 8], [9.5, 16, 8], { north: { tex: e.tex.down, uv: [0, 0, 3, 16] }, south: { tex: e.tex.down, uv: [0, 0, 3, 16] } }, { origin: [8, 8, 8], axis: 'y', angle: 45 }),
        box([8, 0, 6.5], [8, 16, 9.5], { west: { tex: e.tex.north, uv: [0, 0, 3, 16] }, east: { tex: e.tex.north, uv: [0, 0, 3, 16] } }, { origin: [8, 8, 8], axis: 'y', angle: 45 }),
      ];
      let q = bake(els);
      const ax = st.pillar_axis ?? 'y';
      if (ax === 'x') q = rotQuads(q, 'z', 90); else if (ax === 'z') q = rotQuads(q, 'x', 90);
      return { quads: q };
    }
    case 'lantern': {
      const t = e.tex.up;
      const s6 = (uv) => ({ north: { tex: t, uv }, south: { tex: t, uv }, west: { tex: t, uv }, east: { tex: t, uv } });
      const els = st.hanging ? [
        box([5, 1, 5], [11, 8, 11], { ...s6([0, 2, 6, 9]), down: { tex: t, uv: [0, 9, 6, 15] }, up: { tex: t, uv: [0, 9, 6, 15] } }),
        box([6, 8, 6], [10, 10, 10], { ...s6([1, 0, 5, 2]), down: { tex: t, uv: [1, 10, 5, 14] }, up: { tex: t, uv: [1, 10, 5, 14] } }),
        box([6.5, 11, 8], [9.5, 15, 8], { north: { tex: t, uv: [14, 1, 11, 5] }, south: { tex: t, uv: [11, 1, 14, 5] } }, { origin: [8, 8, 8], axis: 'y', angle: 45 }),
        box([8, 10, 6.5], [8, 16, 9.5], { west: { tex: t, uv: [14, 6, 11, 12] }, east: { tex: t, uv: [11, 6, 14, 12] } }, { origin: [8, 8, 8], axis: 'y', angle: 45 }),
      ] : [
        box([5, 0, 5], [11, 7, 11], { ...s6([0, 2, 6, 9]), down: { tex: t, uv: [0, 9, 6, 15], cull: 'down' }, up: { tex: t, uv: [0, 9, 6, 15] } }),
        box([6, 7, 6], [10, 9, 10], { ...s6([1, 0, 5, 2]), up: { tex: t, uv: [1, 10, 5, 14] } }),
        box([6.5, 9, 8], [9.5, 11, 8], { north: { tex: t, uv: [14, 1, 11, 3] }, south: { tex: t, uv: [11, 1, 14, 3] } }, { origin: [8, 8, 8], axis: 'y', angle: 45 }),
        box([8, 9, 6.5], [8, 11, 9.5], { west: { tex: t, uv: [14, 10, 11, 12] }, east: { tex: t, uv: [11, 10, 14, 12] } }, { origin: [8, 8, 8], axis: 'y', angle: 45 }),
      ];
      return { quads: bake(els) };
    }
    case 'button': {
      const F = FACING6[st.facing_direction ?? 1] ?? 'up';
      const d = st.button_pressed_bit ? 1 : 2;
      let f, t;
      if (F === 'up') { f = [5, 0, 6]; t = [11, d, 10]; } else if (F === 'down') { f = [5, 16 - d, 6]; t = [11, 16, 10]; }
      else if (F === 'north') { f = [5, 6, 16 - d]; t = [11, 10, 16]; } else if (F === 'south') { f = [5, 6, 0]; t = [11, 10, d]; }
      else if (F === 'west') { f = [16 - d, 6, 5]; t = [16, 10, 11]; } else { f = [0, 6, 5]; t = [d, 10, 11]; }
      return { quads: bake([box(f, t, facesFor(f, t, tx))]) };
    }
    case 'ladder': {
      const F = FACING6[st.facing_direction ?? 2] ?? 'north';
      if (F === 'up' || F === 'down') return { quads: [] };
      const el = box([0, 0, 15.2], [16, 16, 15.2], { north: { tex: e.tex.north, uv: [0, 0, 16, 16] } });
      return { quads: bake([el], { y: YROT[F] }) };
    }
    case 'wall_sign': case 'hanging_sign': {
      let F = FACING6[st.facing_direction ?? 2] ?? 'north';
      if (F === 'up' || F === 'down') F = 'north';
      const t = e.tex.up;
      const hanging = e.shape === 'hanging_sign';
      const f = hanging ? [1, 0, 7] : [0, 4.5, 14], to = hanging ? [15, 10, 9] : [16, 12.5, 16];
      const els = [box(f, to, facesFor(f, to, t))];
      if (hanging) els.push(box([2, 10, 8], [3, 16, 8], { north: { tex: t, uv: [0, 0, 1, 6] } }), box([13, 10, 8], [14, 16, 8], { north: { tex: t, uv: [0, 0, 1, 6] } }));
      const quads = bake(els, { y: YROT[F] });
      // text anchor: front face (facing F)
      const z = hanging ? 6.95 : 13.95, y0 = hanging ? 0.5 : 4.5, y1 = hanging ? 9.5 : 12.5, x0 = hanging ? 1 : 0, x1 = hanging ? 15 : 16;
      const anchor = bake([box([x0, y0, z], [x1, y1, z], { north: { tex: 'sign_text', uv: [0, 0, 16, 16] } })], { y: YROT[F] })[0];
      return { quads, sign: anchor };
    }
    case 'standing_sign': {
      const t = e.tex.up;
      const rot = -(st.ground_sign_direction ?? 0) * 22.5 + 180; // 0 = text faces south
      const els = [box([0, 7, 7], [16, 15, 9], facesFor([0, 7, 7], [16, 15, 9], t)), box([7, 0, 7], [9, 7, 9], facesFor([7, 0, 7], [9, 7, 9], t))];
      const quads = rotQuads(bake(els), 'y', rot);
      const anchor = rotQuads(bake([box([0, 7, 6.95], [16, 15, 6.95], { north: { tex: 'sign_text', uv: [0, 0, 16, 16] } })]), 'y', rot)[0];
      return { quads, sign: anchor };
    }
    case 'cake': {
      const b = st.bite_counter ?? 0;
      const f = [1 + 2 * b, 0, 1], t = [15, 8, 15];
      const faces = facesFor(f, t, tx);
      faces.west.tex = b > 0 ? e.tex.inner : e.tex.north;
      const els = [box(f, t, faces)];
      return { quads: bake(els) };
    }
    case 'flower_pot': {
      const t = e.tex.up;
      const els = [
        box([5, 0, 5], [6, 6, 11], facesFor([5, 0, 5], [6, 6, 11], t)), box([10, 0, 5], [11, 6, 11], facesFor([10, 0, 5], [11, 6, 11], t)),
        box([6, 0, 5], [10, 6, 6], facesFor([6, 0, 5], [10, 6, 6], t)), box([6, 0, 10], [10, 6, 11], facesFor([6, 0, 10], [10, 6, 11], t)),
        box([6, 0, 6], [10, 4, 10], { up: { tex: e.tex.dirt }, down: { tex: t, cull: 'down' } }),
      ];
      return { quads: bake(els) };
    }
    case 'torch': {
      const F = st.torch_facing_direction ?? 'top';
      const t = e.tex.up;
      const sides = { north: { tex: t, uv: [7, 6, 9, 16] }, south: { tex: t, uv: [7, 6, 9, 16] }, west: { tex: t, uv: [7, 6, 9, 16] }, east: { tex: t, uv: [7, 6, 9, 16] } };
      if (F === 'top' || F === 'unknown' || !YROT.hasOwnProperty(F)) {
        return { quads: bake([box([7, 0, 7], [9, 10, 9], { ...sides, up: { tex: t, uv: [7, 6, 9, 8] }, down: { tex: t, uv: [7, 13, 9, 15], cull: 'down' } })]) };
      }
      // authored leaning east (attached to the west wall); facing F = lean direction
      const el = box([-1, 3.5, 7], [1, 13.5, 9], { ...sides, up: { tex: t, uv: [7, 6, 9, 8] }, down: { tex: t, uv: [7, 13, 9, 15] } }, { origin: [0, 3.5, 8], axis: 'z', angle: -22.5 });
      return { quads: bake([el], { y: (YROT[F] + 270) % 360 }) };
    }
    case 'rod': {
      const F = FACING6[st.facing_direction ?? 1] ?? 'up';
      const t = e.tex.up;
      const s4 = (uv) => ({ north: { tex: t, uv }, south: { tex: t, uv }, west: { tex: t, uv }, east: { tex: t, uv } });
      let q = bake([
        box([6, 0, 6], [10, 1, 10], { ...s4([2, 6, 6, 7]), up: { tex: t, uv: [2, 2, 6, 6] }, down: { tex: t, uv: [6, 6, 2, 2], cull: 'down' } }),
        box([7, 1, 7], [9, 16, 9], { ...s4([0, 0, 2, 15]), up: { tex: t, uv: [2, 0, 4, 2], cull: 'up' } }),
      ]);
      if (F === 'down') q = rotQuads(q, 'x', 180);
      else if (F === 'north') q = rotQuads(q, 'x', -90);
      else if (F === 'south') q = rotQuads(q, 'x', 90);
      else if (F === 'west') q = rotQuads(q, 'z', 90);
      else if (F === 'east') q = rotQuads(q, 'z', -90);
      return { quads: q };
    }
    case 'cross': {
      const t = e.tex.north;
      const r = { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true };
      return { quads: bake([box([0.8, 0, 8], [15.2, 16, 8], { north: { tex: t, uv: [0, 0, 16, 16] } }, r), box([8, 0, 0.8], [8, 16, 15.2], { west: { tex: t, uv: [0, 0, 16, 16] } }, r)]) };
    }
    default: { // cube-like fallback (also used for 'cube', 'glass', 'leaves')
      const f = [0, 0, 0], t = [16, 16, 16];
      return { quads: bake([box(f, t, facesFor(f, t, tx))]) };
    }
  }
}

function pillar(e, axis) {
  const end = e.tex.up, side = e.tex.north;
  const f = [0, 0, 0], t = [16, 16, 16];
  if (axis === 'x') return bake([box(f, t, facesFor(f, t, (d) => (d === 'east' || d === 'west' ? end : side), { rot: { north: 90, south: 90, up: 90, down: 90 } }))]);
  if (axis === 'z') return bake([box(f, t, facesFor(f, t, (d) => (d === 'north' || d === 'south' ? end : side), { rot: { east: 90, west: 90 } }))]);
  return bake([box(f, t, facesFor(f, t, (d) => (d === 'up' || d === 'down' ? (d === 'up' ? e.tex.up : e.tex.down) : side)))]);
}
function barrel(e, F) {
  const top = e.tex.north, bottom = e.tex.south, side = e.tex.up;
  const f = [0, 0, 0], t = [16, 16, 16];
  const axis = F === 'up' || F === 'down' ? 'y' : F === 'east' || F === 'west' ? 'x' : 'z';
  const tex = (d) => (d === F ? top : d === OPP[F] ? bottom : side);
  const rot = axis === 'x' ? { north: 90, south: 90, up: 90, down: 90 } : axis === 'z' ? { east: 90, west: 90 } : {};
  if (F === 'down') { rot.north = 180; rot.south = 180; rot.east = 180; rot.west = 180; }
  return bake([box(f, t, facesFor(f, t, tex, { rot }))]);
}
function door(e, nb) {
  const { upper, dir, open, hinge } = doorInfo(e, nb);
  const t = upper ? e.tex.upper : e.tex.lower;
  // Java templates (authored facing east, panel on the west edge x 0..3)
  const left = !hinge;
  let faces;
  const big = (a, b) => ({ west: { tex: t, uv: a, cull: 'west' }, east: { tex: t, uv: b } });
  if (!open) faces = left ? big([0, 0, 16, 16], [16, 0, 0, 16]) : big([16, 0, 0, 16], [0, 0, 16, 16]);
  else faces = left ? big([16, 0, 0, 16], [0, 0, 16, 16]) : big([0, 0, 16, 16], [16, 0, 0, 16]);
  Object.assign(faces, { north: { tex: t, uv: [3, 0, 0, 16], cull: 'north' }, south: { tex: t, uv: [0, 0, 3, 16], cull: 'south' } });
  if (upper) faces.up = { tex: t, uv: [13, 0, 16, 16], rot: 90, cull: 'up' }; else faces.down = { tex: t, uv: [13, 0, 16, 16], rot: 90, cull: 'down' };
  const base = { east: 0, south: 90, west: 180, north: 270 }[dir] ?? 0;
  const y = open ? base + (left ? 90 : 270) : base;
  return bake([box([0, 0, 0], [3, 16, 16], faces)], { y: y % 360 });
}
function pane(e, nb) {
  const c = connections(e, nb, (n) => acceptConn(e, n));
  const face = e.tex.north, edge = e.tex.east;
  const any = HORIZ.some((d) => c[d]);
  const conn = any ? c : { north: true, south: true, west: true, east: true };
  const els = [];
  const skipEnd = (d) => { const v = DIRS[d]; const n = nb(v[0], 0, v[2]); return n && (n.full || n.shape === 'pane'); };
  const arm = (d) => {
    const r = { north: [[7, 0, 0], [9, 16, 7]], south: [[7, 0, 9], [9, 16, 16]], west: [[0, 0, 7], [7, 16, 9]], east: [[9, 0, 7], [16, 16, 9]] }[d];
    const tex = (fd) => (fd === 'up' || fd === 'down' || fd === d ? edge : face);
    const skip = [OPP[d]];
    if (skipEnd(d)) skip.push(d);
    const fs = facesFor(r[0], r[1], tex, { skip });
    for (const k of ['up', 'down']) if (fs[k]) fs[k].cull = k;
    els.push(box(r[0], r[1], fs));
  };
  for (const d of HORIZ) if (conn[d]) arm(d);
  const skip = HORIZ.filter((d) => conn[d]);
  const pf = facesFor([7, 0, 7], [9, 16, 9], (fd) => (fd === 'up' || fd === 'down' ? edge : face), { skip });
  pf.up.cull = 'up'; pf.down.cull = 'down';
  els.push(box([7, 0, 7], [9, 16, 9], pf));
  return bake(els);
}
function fence(e, nb) {
  const c = connections(e, nb, (n) => acceptConn(e, n));
  const t = e.tex.up;
  const els = [box([6, 0, 6], [10, 16, 10], facesFor([6, 0, 6], [10, 16, 10], t))];
  const bars = { north: [[7, 0], [9, 6], 'z'], south: [[7, 10], [9, 16], 'z'], west: [[0, 7], [6, 9], 'x'], east: [[10, 7], [16, 9], 'x'] };
  for (const d of HORIZ) {
    if (!c[d]) continue;
    const [a, b] = bars[d];
    for (const [y0, y1] of [[12, 15], [6, 9]]) {
      const f = [a[0], y0, a[1]], to = [b[0], y1, b[1]];
      els.push(box(f, to, facesFor(f, to, t, { skip: [OPP[d]] })));
    }
  }
  return bake(els);
}
function fenceGate(e) {
  const t = e.tex.up;
  const dir = e.states?.direction ?? 0;
  const els = [];
  const add = (f, to) => els.push(box(f, to, facesFor(f, to, t)));
  add([0, 5, 7], [2, 16, 9]); add([14, 5, 7], [16, 16, 9]);
  if (!e.states?.open_bit) { add([6, 6, 7], [8, 15, 9]); add([8, 6, 7], [10, 15, 9]); add([2, 6, 7], [6, 9, 9]); add([2, 12, 7], [6, 15, 9]); add([10, 6, 7], [14, 9, 9]); add([10, 12, 7], [14, 15, 9]); }
  return bake(els, { y: dir % 2 === 1 ? 90 : 0 });
}
function wall(e, nb) {
  const st = e.states ?? {};
  const keys = { north: 'wall_connection_type_north', south: 'wall_connection_type_south', west: 'wall_connection_type_west', east: 'wall_connection_type_east' };
  const hasStates = HORIZ.some((d) => keys[d] in st);
  const c = hasStates ? Object.fromEntries(HORIZ.map((d) => [d, st[keys[d]] && st[keys[d]] !== 'none' ? st[keys[d]] : null])) : Object.fromEntries(Object.entries(connections(e, nb, (n) => acceptConn(e, n))).map(([d, v]) => [d, v ? 'short' : null]));
  const t = e.tex.up;
  const post = hasStates ? !!st.wall_post_bit : !(c.north && c.south && !c.east && !c.west) && !(c.east && c.west && !c.north && !c.south);
  const els = [];
  if (post) els.push(box([4, 0, 4], [12, 16, 12], facesFor([4, 0, 4], [12, 16, 12], t)));
  const r = { north: [[5, 0], [11, 8]], south: [[5, 8], [11, 16]], west: [[0, 5], [8, 11]], east: [[8, 5], [16, 11]] };
  for (const d of HORIZ) {
    if (!c[d]) continue;
    const h = c[d] === 'tall' ? 16 : 14;
    const f = [r[d][0][0], 0, r[d][0][1]], to = [r[d][1][0], h, r[d][1][1]];
    els.push(box(f, to, facesFor(f, to, t)));
  }
  return bake(els);
}

/** Rotate baked quads about the block centre (degrees, right-handed). */
export function rotQuads(quads, axis, deg) {
  const o = [0.5, 0.5, 0.5];
  const steps = Math.round(deg / 90);
  const exact = Math.abs(deg - steps * 90) < 1e-6;
  return quads.map((q) => {
    const p = [];
    for (let i = 0; i < 4; i++) {
      let r = rotPoint([q.p[i * 3], q.p[i * 3 + 1], q.p[i * 3 + 2]], axis, deg, o);
      if (exact) r = r.map((v) => Math.round(v * 1e6) / 1e6);
      p.push(...r);
    }
    const n = rotPoint(q.n, axis, deg, [0, 0, 0]);
    let cull = null;
    if (q.cull && exact) {
      const d = rotPoint(DIRS[q.cull], axis, deg, [0, 0, 0]).map(Math.round);
      cull = Object.keys(DIRS).find((k) => DIRS[k].every((v, i) => v === d[i])) ?? null;
    }
    return { ...q, p, n, cull };
  });
}
