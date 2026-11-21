// Map validator on the exported voxel model (what /fnar:setup builds):
//   1. every camera sees every node in its `sees` list (ray-cast to the body and head,
//      inside the feed's view: within VIEW.h / VIEW.v degrees of the aim, which fits
//      Bedrock's default 60 degree FOV on a 4:3 screen);
//   2. every route edge (node -> waypoints -> node) keeps the animatronic's body
//      clear of walls, tables and shelves. The cast stands 3.9-4.0 blocks tall: 5.1 of
//      head room, except within 0.8 blocks of an opening (a doorway, an arch, the
//      office doors and windows), where they stoop through or lean in (2.9);
//      in the ducts they crawl (1.9);
//   3. every node stands on a floor with head room (5.1; 2.9 for the nodes that lean
//      at a door or window or stand within 0.8 blocks of an opening; 1.9 crawling);
//   4. camera lenses and the office spawn are not inside blocks;
//   5. every office control is within reach of the guard's seat, in plain sight;
//   6. at night the halls by the office are dark;
//   7. the cellar (data/cellar.js, once CELLAR_BUILT): the Golden Dog's nodes and his walk are clear for a body
//      3 wide and 4 tall, the aisle is empty floor to ceiling, the guard in the Other Office's seat sees his head
//      and chest on the stage, the Other Office has the real office's shape, a player can walk from the Parts &
//      Service door down the stairs to the Gold Room and into the Other Office, the stage lamp lights him at
//      night, and by day the cellar is gloomy but never pitch black.
// Usage: node tools/map/validate_map.mjs   (exit 1 on problems)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { buildVoxels } = await import('./export_voxels.mjs');
const { CAMERAS } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
const { NODES, EDGES, pathBetween } = await import(path.join(ROOT, 'packs/BP/scripts/data/nodes.js'));
const { OFFICE, REACH, OPENINGS } = await import(path.join(ROOT, 'packs/BP/scripts/data/layout.js'));
const { CELLAR_BUILT } = await import(path.join(ROOT, 'packs/BP/scripts/data/cellar.js'));

// Head room by pose (blocks above the feet).
const STAND = 5.1, STOOP = 2.9, CRAWL = 1.9, NEAR_OPENING = 0.8;
const STAND_SAMPLES = [0.3, 1.2, 2.2, 3.1, 4.1, 5.0];
const STOOP_SAMPLES = [0.3, 1.2, 2.2, 2.85];
const CRAWL_SAMPLES = [0.3, 0.9, 1.5, 1.85];
// Openings as boxes in the floor plan: the layout's openings plus the office doors and windows.
const OPENING_BOXES = [
  ...OPENINGS.map((o) => o.box),
  ...['L', 'R'].flatMap((s) => [OFFICE.doors[s], OFFICE.windows[s]]).map((d) => [d.x, d.y1, d.z1, d.x, d.y2, d.z2]),
];
/** Horizontal distance from (x, z) to the nearest opening box (0 inside one). */
function openingDist(x, z) {
  let best = Infinity;
  for (const [x1, , z1, x2, , z2] of OPENING_BOXES) {
    const dx = Math.max(x1 - x, 0, x - (x2 + 1));
    const dz = Math.max(z1 - z, 0, z - (z2 + 1));
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}
const nearOpening = (x, z) => openingDist(x, z) <= NEAR_OPENING;

const { grid } = buildVoxels();
const { data, x0, y0, z0, sx, sy, sz, palette } = grid;

// Which custom blocks are full cubes (read their geometry from packs/BP/blocks)?
const fullCustom = new Set();
const BDIR = path.join(ROOT, 'packs/BP/blocks');
if (fs.existsSync(BDIR)) {
  for (const f of fs.readdirSync(BDIR).filter((x) => x.endsWith('.json'))) {
    const b = JSON.parse(fs.readFileSync(path.join(BDIR, f), 'utf8'))['minecraft:block'];
    const g = b.components?.['minecraft:geometry'];
    const gid = typeof g === 'string' ? g : g?.identifier;
    if (!gid || gid === 'minecraft:geometry.full_block') fullCustom.add(b.description.identifier);
  }
}
const SEE_THROUGH = /^minecraft:(air|light_block_\d+|glass_pane|iron_bars|chain|iron_chain|short_grass|.*_carpet|.*_button|.*wall_sign|lantern)$/;
// Custom props that do not block a camera's view or a walk (wall decor, small table-top things, lamps,
// and flat floor decals: ticket stubs, puddles, footprints, 0.1 px thick, no collision).
const THIN_CUSTOM = /^fnar:(poster_|drawing|sign_|bunting|exit_sign|wall_sconce|stage_spotlight|hanging_lamp|security_camera|pa_speaker|door_button|light_button|stage_star|party_hat|plate_set|pizza_box|desk_clutter|plush_rat|time_clock|balloons|floor_decal|wall_writing|lot_tag|neon_sign|menu_board|height_chart|token_prices|par_can)/;

function nameAt(x, y, z) {
  const ix = Math.floor(x) - x0, iy = Math.floor(y) - y0, iz = Math.floor(z) - z0;
  if (ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz) return 'minecraft:air';
  return palette[data[ix + sx * (iz + sz * iy)]].name;
}
const blocksSight = (n) => !(SEE_THROUGH.test(n) || (n.startsWith('fnar:') && !fullCustom.has(n) && THIN_CUSTOM.test(n)));
const blocksBody = (n) => !(SEE_THROUGH.test(n) || (n.startsWith('fnar:') && THIN_CUSTOM.test(n)));
// Steps (stairs, slabs, the stage edge) are fine at foot height when a path changes level.
const isStep = (n) => /(_stairs|_slab|stage_floor|red_terracotta)$/.test(n);

// (the booth curtains are parted in the built model itself, so no special case is needed)
const inGap = () => false;
function rayClear(a, b, step = 0.1) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.ceil(d / step);
  for (let i = 1; i < n - 2; i++) {
    const t = i / n;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const nm = inGap(p) ? 'minecraft:air' : nameAt(...p);
    if (blocksSight(nm)) return { ok: false, at: p.map((v) => Math.floor(v)), block: nm };
  }
  return { ok: true };
}

let problems = 0;
const report = (msg) => { problems++; console.log('  ' + msg); };

const VIEW = { h: 36, v: 27 };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
/** Is p inside camera c's view? (angles off the aim, in degrees) */
function inView(c, p) {
  const f = norm(sub(c.look, c.loc));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const v = sub(p, c.loc);
  const z = dot(v, f);
  if (z <= 0) return false;
  return Math.atan2(Math.abs(dot(v, r)), z) * 180 / Math.PI <= VIEW.h && Math.atan2(Math.abs(dot(v, u)), z) * 180 / Math.PI <= VIEW.v;
}

console.log('cameras:');
for (const c of CAMERAS) {
  if (c.room === 'CELLAR' && !CELLAR_BUILT) continue; // (data/cellar.js: the cellar is not built yet)
  const lens = nameAt(...c.loc);
  if (blocksSight(lens)) report(`${c.id}: lens inside ${lens} at ${c.loc.map(Math.floor)}`);
  for (const id of c.sees) {
    const n = NODES[id];
    const pts = [[n.x, n.y + 1.0, n.z], [n.x, n.y + 1.8, n.z], [n.x, n.y + 0.5, n.z]];
    const res = pts.map((p) => rayClear(c.loc, p));
    if (!res.some((r) => r.ok)) report(`${c.id} cannot see ${id}: blocked by ${res[0].block} at ${res[0].at}`);
    else if (!pts.some((p, i) => res[i].ok && inView(c, p))) report(`${c.id}: ${id} is outside the camera's view`);
  }
}

console.log('nodes:');
for (const n of Object.values(NODES)) {
  if (n.cellar) continue; // the Golden Dog's nodes: his own checks are in the cellar section below (7)
  // they lean at the office doors and the right window, and anywhere right at an opening
  const lean = !!(n.door || n.window) || nearOpening(n.x, n.z);
  const h = n.crawl ? CRAWL : lean ? STOOP : STAND;
  const floor = nameAt(n.x, n.y - 0.5, n.z);
  if (!blocksBody(floor) && !n.crawl) report(`${n.id}: no floor under it (${floor})`);
  for (let dy = 0.1; dy < h; dy += 0.5) {
    const b = nameAt(n.x, n.y + dy, n.z);
    if (blocksBody(b)) { report(`${n.id}: body inside ${b} at y+${dy.toFixed(1)}`); break; }
  }
}

console.log('routes:');
for (const e of EDGES) {
  const pts = pathBetween(e.a, e.b);
  const crawl = NODES[e.a].crawl || NODES[e.b].crawl;
  const climb = (e.a.startsWith('MW_GRATE') || e.b.startsWith('MW_GRATE') || ((e.a === 'KIT' || e.b === 'KIT') && (e.a.startsWith('ED_') || e.b.startsWith('ED_'))));
  if (climb) continue; // the grate climbs pass through the ceiling grate on purpose
  let bad = null;
  for (let i = 1; i < pts.length && !bad; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(d / 0.25));
    for (let k = 0; k <= n && !bad; k++) {
      const t = k / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      for (const dy of crawl ? CRAWL_SAMPLES : nearOpening(p[0], p[2]) ? STOOP_SAMPLES : STAND_SAMPLES) {
        const nm = inGap([p[0], p[1] + dy, p[2]]) ? 'minecraft:air' : nameAt(p[0], p[1] + dy, p[2]);
        const levelChange = Math.abs(b[1] - a[1]) > 0.5;
        if (dy < 0.5 && levelChange && isStep(nm)) continue;
        if (blocksBody(nm)) { bad = `${nm} at ${[p[0], p[1] + dy, p[2]].map((v) => v.toFixed(1))}`; break; }
      }
    }
  }
  if (bad) report(`${e.a} -> ${e.b}: ${bad}`);
}

const sp = OFFICE.spawn;
for (const dy of [0.2, 1.2]) if (blocksBody(nameAt(sp.x, sp.y + dy, sp.z))) report(`office spawn blocked at y+${dy}`);

// 5. every office control can be clicked from the seat (Bedrock's survival / adventure reach is about 5 blocks)
console.log('reach:');
const eye = [sp.x, sp.y + 1.62, sp.z];
const controls = { ...OFFICE.buttons, monitor: OFFICE.monitor, phone: OFFICE.phone };
for (const [id, b] of Object.entries(controls)) {
  const d = Math.hypot(b.x + 0.5 - eye[0], b.y + 0.5 - eye[1], b.z + 0.5 - eye[2]);
  if (d > REACH) report(`${id} is ${d.toFixed(1)} blocks from the seat (reach ${REACH})`);
  // line of sight up to the control's own cell
  const to = [b.x + 0.5, b.y + 0.5, b.z + 0.5];
  const n = Math.ceil(d / 0.05);
  for (let i = 1; i < n; i++) {
    const p = eye.map((v, k) => v + (to[k] - v) * (i / n));
    if (Math.floor(p[0]) === b.x && Math.floor(p[1]) === b.y && Math.floor(p[2]) === b.z) break;
    const nm = nameAt(...p);
    if (blocksSight(nm)) { report(`${id}: blocked from the seat by ${nm} at ${p.map(Math.floor)}`); break; }
  }
}
// 6. at night (as built: every lamp off but the office's, the fixtures that never switch off still lit) the halls by
//    the office are dark - block light 0-1 at standing height - so the guard needs the hall lights to see anything.
console.log('darkness:');
{
  const DARK_MAX = 1;
  const VANILLA_LIGHT = { 'minecraft:sea_lantern': 15, 'minecraft:ochre_froglight': 15, 'minecraft:verdant_froglight': 15, 'minecraft:pearlescent_froglight': 15,
    'minecraft:glowstone': 15, 'minecraft:shroomlight': 15, 'minecraft:lantern': 15, 'minecraft:end_rod': 14, 'minecraft:torch': 14 };
  const VANILLA_CLEAR = /^minecraft:(air|light_block_\d+|.*glass.*|.*_bars|.*chain|.*carpet|.*_slab|.*_stairs|.*fence.*|.*_wall|.*door|.*trapdoor|.*sign|.*button|lever|.*torch|.*lantern|web|short_grass|deadbush|flower_pot|ladder|.*_rod|lectern|.*anvil|cauldron|hopper|cake|.*shulker_box)$/;
  const defs = new Map();
  for (const f of fs.readdirSync(BDIR).filter((x) => x.endsWith('.json'))) {
    const b = JSON.parse(fs.readFileSync(path.join(BDIR, f), 'utf8'))['minecraft:block'];
    const c = b.components ?? {};
    const parse = (cond) => (cond ?? '').split('&&').map((t) => t.match(/q\.block_state\('([^']+)'\)\s*==\s*'?([^')\s]+)'?/)).filter(Boolean).map((m) => [m[1], m[2]]);
    const perms = (b.permutations ?? []).filter((p) => p.components?.['minecraft:light_emission'] !== undefined).map((p) => ({ cond: parse(p.condition), level: p.components['minecraft:light_emission'] }));
    defs.set(b.description.identifier, { base: c['minecraft:light_emission'] ?? 0, perms, clear: c['minecraft:light_dampening'] === 0 || !fullCustom.has(b.description.identifier) });
  }
  const emitOf = palette.map((e) => {
    if (/^minecraft:light_block_(\d+)$/.test(e.name)) return Number(e.name.split('_').pop());
    if (VANILLA_LIGHT[e.name]) return VANILLA_LIGHT[e.name];
    const d = defs.get(e.name);
    if (!d) return 0;
    let lv = d.base;
    for (const p of d.perms) if (p.cond.every(([k, v]) => String(e.states?.[k]) === v)) lv = p.level;
    return lv;
  });
  const clearOf = palette.map((e) => (e.name.startsWith('fnar:') ? defs.get(e.name)?.clear ?? false : VANILLA_CLEAR.test(e.name)));
  const level = new Uint8Array(data.length);
  const buckets = Array.from({ length: 16 }, () => []);
  for (let i = 0; i < data.length; i++) {
    const lv = emitOf[data[i]];
    if (lv > 0) { level[i] = lv; buckets[lv].push(i); }
  }
  const strideZ = sx, strideY = sx * sz;
  for (let lv = 15; lv > 1; lv--) {
    for (const i of buckets[lv]) {
      if (level[i] !== lv) continue;
      const x = i % sx, z = Math.floor(i / sx) % sz, y = Math.floor(i / strideY);
      for (const [ok, j] of [[x > 0, i - 1], [x < sx - 1, i + 1], [z > 0, i - strideZ], [z < sz - 1, i + strideZ], [y > 0, i - strideY], [y < sy - 1, i + strideY]]) {
        if (!ok || !clearOf[data[j]] || level[j] >= lv - 1) continue;
        level[j] = lv - 1;
        buckets[lv - 1].push(j);
      }
    }
  }
  const { ROOM_BY_ID } = await import(path.join(ROOT, 'packs/BP/scripts/data/layout.js'));
  const zones = [['W_CORNER', 0], ['E_CORNER', 0], ['WEST_HALL', 48], ['EAST_HALL', 48]];
  for (const [id, zMin] of zones) {
    const [x1, z1, x2, z2] = ROOM_BY_ID[id].box;
    let worst = 0, at = null;
    for (let x = x1; x <= x2; x++) for (let z = Math.max(z1, zMin); z <= z2; z++) for (let y = 0; y <= 3; y++) {
      const i = (x - x0) + sx * ((z - z0) + sz * (y - y0));
      if (clearOf[data[i]] && level[i] > worst) { worst = level[i]; at = [x, y, z]; }
    }
    console.log(`  ${id}${zMin ? ` (z >= ${zMin})` : ''}: brightest block light ${worst}${at ? ` at ${at}` : ''}`);
    if (worst > DARK_MAX) report(`${id} is lit at night (block light ${worst} at ${at}); the halls by the office must stay at ${DARK_MAX} or darker`);
  }
}

// ================================================================ 7. the cellar (data/cellar.js, data/cellar_plan.js)
if (CELLAR_BUILT) {
  console.log('cellar:');
  const { CELLAR } = await import(path.join(ROOT, 'packs/BP/scripts/data/cellar.js'));
  const { CELLAR_PLAN } = await import(path.join(ROOT, 'packs/BP/scripts/data/cellar_plan.js'));
  const isAir = (n) => /^minecraft:(air|light_block_\d+)$/.test(n);
  const cellAt = (x, y, z) => nameAt(x + 0.5, y + 0.5, z + 0.5);
  const A = CELLAR.aisle;
  const walk = CELLAR.walk.map((id) => NODES[id]);

  // 7a. his body: 3 wide (the aisle's width), 4 tall, at every node and along the straight line between them
  const BODY_H = 4;
  const bodyAt = (x, y, z) => {
    for (let cx = Math.floor(x - 1.49); cx <= Math.floor(x + 1.49); cx++) {
      const floor = cellAt(cx, Math.floor(y) - 1, Math.floor(z));
      if (isAir(floor)) return `no floor under him at ${cx},${Math.floor(y) - 1},${Math.floor(z)}`;
      for (let cy = Math.floor(y); cy < Math.floor(y) + BODY_H; cy++) {
        for (const cz of new Set([Math.floor(z - 0.45), Math.floor(z + 0.45)])) {
          const n = cellAt(cx, cy, cz);
          if (!isAir(n)) return `${n} at ${cx},${cy},${cz}`;
        }
      }
    }
    return null;
  };
  for (const n of walk) {
    const bad = bodyAt(n.x, n.y, n.z);
    if (bad) report(`${n.id}: not clear for a body 3 wide and ${BODY_H} tall: ${bad}`);
  }
  for (let i = 1; i < walk.length; i++) {
    const a = walk[i - 1], b = walk[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const bad = bodyAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      if (bad) { report(`${a.id} -> ${b.id}: his walk is blocked: ${bad}`); break; }
    }
  }
  if (walk[0].id !== CELLAR.stage) report(`CELLAR.walk must start on his stage (${CELLAR.stage})`);

  // 7b. the aisle: nothing in it at all, floor to ceiling, and a floor under every cell
  {
    let bad = null;
    for (let x = A.x1; x <= A.x2 && !bad; x++) for (let z = A.z1; z <= A.z2 && !bad; z++) {
      if (isAir(cellAt(x, CELLAR.floorY, z))) bad = `no floor at ${x},${CELLAR.floorY},${z}`;
      for (let y = CELLAR.standY; y < CELLAR.ceilY && !bad; y++) if (!isAir(cellAt(x, y, z))) bad = `${cellAt(x, y, z)} at ${x},${y},${z}`;
      if (!bad && isAir(cellAt(x, CELLAR.ceilY, z))) bad = `no ceiling at ${x},${CELLAR.ceilY},${z}`;
    }
    if (bad) report(`the aisle (x ${A.x1}..${A.x2}, z ${A.z1}..${A.z2}) is not clear: ${bad}`);
  }
  // the two openings of the contract are open
  for (const [id, [x1, y1, z1, x2, y2, z2]] of Object.entries(CELLAR.openings)) {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) {
      if (!isAir(cellAt(x, y, z))) report(`opening ${id}: ${cellAt(x, y, z)} at ${x},${y},${z}`);
    }
  }

  // 7c. from the Other Office's seat the guard sees him on his stage, and at every node of his walk, over the desk.
  // Flat things (papers, the wreck of the monitor) only hide what is lower than they are tall.
  const LOW = [[/^fnar:(desk_clutter|plate_set|floor_decal)/, 0.2], [/^fnar:dead_monitor/, 0.45], [/^fnar:desk_phone/, 0.3]];
  const seat = CELLAR.otherOffice.spawn;
  const eyeC = [seat.x, seat.y + 1.62, seat.z];
  const seen = (to) => {
    const d = Math.hypot(to[0] - eyeC[0], to[1] - eyeC[1], to[2] - eyeC[2]);
    const steps = Math.ceil(d / 0.05);
    for (let i = 1; i < steps; i++) {
      const q = eyeC.map((v, k) => v + (to[k] - v) * (i / steps));
      const n = nameAt(...q);
      if (isAir(n)) continue;
      const low = LOW.find(([re]) => re.test(n));
      if (low && q[1] - Math.floor(q[1]) > low[1]) continue;
      return `${n} at ${q.map(Math.floor)}`;
    }
    return null;
  };
  {
    const st = NODES[CELLAR.stage];
    const dist = Math.hypot(st.x - seat.x, st.z - seat.z);
    for (const [part, dy] of [['head', 3.1], ['chest', 2.2]]) {
      for (const dx of [-0.6, 0, 0.6]) {
        const bad = seen([st.x + dx, st.y + dy, st.z]);
        if (bad) report(`the Other Office's seat cannot see his ${part} on the stage (${dist.toFixed(1)} blocks away): ${bad}`);
      }
    }
    for (const n of walk.slice(1)) {
      const bad = seen([n.x, n.y + 3.1, n.z]);
      if (bad) report(`the Other Office's seat cannot see his head at ${n.id}: ${bad}`);
    }
    console.log(`  the seat sees the stage: ${dist.toFixed(1)} blocks`);
  }

  // 7d. the Other Office is the real office, moved: air where the office has air (so no more furniture than
  // upstairs), the same walls, doors and windows. The listed difference: the gap behind the desk.
  {
    const o = CELLAR.otherOffice.offset;
    const [x1, z1, x2, z2] = OFFICE.box;
    const gap = CELLAR.openings.desk_gap;
    const inGap = (x, y, z) => x >= gap[0] && x <= gap[3] && y >= gap[1] && y <= gap[4] && z >= gap[2] && z <= gap[5];
    const kind = (n) => (isAir(n) ? 'air' : /glass_pane|iron_bars/.test(n) ? 'window' : 'solid');
    let diffs = 0;
    for (let x = x1 - 1; x <= x2 + 1; x++) for (let z = z1 - 1; z <= z2 + 1; z++) for (let y = -1; y <= 5; y++) {
      const X = x + o.x, Y = y + o.y, Z = z + o.z;
      if (inGap(X, Y, Z)) continue;
      const real = cellAt(x, y, z), other = cellAt(X, Y, Z);
      const ring = x < x1 || x > x2 || z < z1 || z > z2 || y < 0 || y > 4;
      const bad = ring ? kind(real) !== kind(other) : isAir(real) && !isAir(other);
      if (bad && diffs++ < 8) report(`the Other Office differs from the office at ${X},${Y},${Z}: ${other} (the office has ${real} at ${x},${y},${z})`);
    }
    // the desk phone is the real block, in its own cell (the way back); nothing else down here is one of the
    // guard's controls (a block with the fnar:control component: the buttons, the monitor)
    const ph = CELLAR.otherOffice.phone;
    if (cellAt(ph.x, ph.y, ph.z) !== 'fnar:desk_phone') report(`the Other Office's phone cell ${ph.x},${ph.y},${ph.z} holds ${cellAt(ph.x, ph.y, ph.z)}, not fnar:desk_phone`);
    const controls = new Set();
    for (const f of fs.readdirSync(BDIR).filter((q) => q.endsWith('.json'))) {
      const b = JSON.parse(fs.readFileSync(path.join(BDIR, f), 'utf8'))['minecraft:block'];
      if (b.components?.['fnar:control']) controls.add(b.description.identifier);
    }
    for (let x = x1 - 1; x <= x2 + 1; x++) for (let z = z1 - 1; z <= z2 + 1; z++) for (let y = -1; y <= 5; y++) {
      const X = x + o.x, Y = y + o.y, Z = z + o.z;
      const n = cellAt(X, Y, Z);
      if (controls.has(n) && !(X === ph.x && Y === ph.y && Z === ph.z)) report(`the Other Office holds a working control (${n}) at ${X},${Y},${Z}`);
    }
    const s2 = CELLAR.otherOffice.spawn;
    for (const dy of [0.2, 1.2]) if (!isAir(nameAt(s2.x, s2.y + dy, s2.z))) report(`the Other Office's seat is blocked at y+${dy}`);
  }

  // 7e. a player (0.6 wide, 1.8 tall: one cell, two cells of body) can walk from the Parts & Service door down the
  // stairs to the Gold Room and into the Other Office, and back. Steps: one block up (a jump), up to three down.
  {
    const collides = new Map();
    for (const f of fs.readdirSync(BDIR).filter((q) => q.endsWith('.json'))) {
      const b = JSON.parse(fs.readFileSync(path.join(BDIR, f), 'utf8'))['minecraft:block'];
      collides.set(b.description.identifier, b.components?.['minecraft:collision_box'] !== false);
    }
    const PASS = /^minecraft:(air|light_block_\d+|.*_carpet|.*_button|.*wall_sign|web|short_grass|deadbush)$/;
    const TALL = /fence|_wall$|iron_bars|glass_pane/; // cannot be stepped onto
    const solid = (n) => (n.startsWith('fnar:') ? collides.get(n) ?? true : !PASS.test(n));
    const free = (x, y, z) => !solid(cellAt(x, y, z)) && !solid(cellAt(x, y + 1, z));
    const stand = (x, y, z) => free(x, y, z) && solid(cellAt(x, y - 1, z)) && !TALL.test(cellAt(x, y - 1, z));
    const minY = CELLAR.baseY, maxY = 2;
    const key = (x, y, z) => `${x},${y},${z}`;
    /** Every cell a player can walk to from `from`: Map("x,y,z" -> steps). */
    const reach = (from) => {
      const dist = new Map([[key(...from), 0]]);
      const queue = [from];
      while (queue.length) {
        const [x, y, z] = queue.shift();
        const d = dist.get(key(x, y, z));
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          for (let ny = y + 1; ny >= Math.max(minY, y - 3); ny--) {
            if (ny > maxY || !stand(nx, ny, nz)) continue;
            if (ny === y + 1 && solid(cellAt(x, y + 2, z))) continue; // no head room to jump
            if (ny < y && ![...Array(y - ny).keys()].every((k) => free(nx, ny + 1 + k, nz))) continue; // the drop is open
            const k2 = key(nx, ny, nz);
            if (!dist.has(k2)) { dist.set(k2, d + 1); queue.push([nx, ny, nz]); }
            break;
          }
        }
      }
      return dist;
    };
    const door = OPENINGS.find((q) => q.id === 'parts_door').box;
    const start = [door[0], 0, door[5] + 1];
    if (!stand(...start)) report(`the cellar walk cannot start inside the Parts & Service door at ${start}`);
    const dist = reach(start);
    const S = CELLAR_PLAN.stairs;
    const seatCell = [Math.floor(seat.x), seat.y, Math.floor(seat.z)];
    const goals = {
      'the head of the stairs': [S.head, 0, S.z],
      'the landing at their foot': [S.x1 - 1, CELLAR.standY, S.z],
      'the Gold Room (its south tier)': [CELLAR.rooms.GOLD_ROOM[2] - 1, CELLAR.standY, CELLAR.rooms.GOLD_ROOM[3]],
      "the Gold Room's pit": [CELLAR.rooms.GOLD_ROOM[0] + 3, CELLAR_PLAN.gold.pitY, 30],
      'his stage': [Math.floor(NODES[CELLAR.stage].x), CELLAR.standY, Math.floor(NODES[CELLAR.stage].z)],
      'the Long Hall': [A.x1 + 1, CELLAR.standY, 50],
      "the Other Office's seat": seatCell,
      'the boiler room': [CELLAR_PLAN.rooms.BOILER[0] + 1, CELLAR.standY, CELLAR_PLAN.rooms.BOILER[1] + 4],
      'the store': [CELLAR_PLAN.rooms.STORE[2] - 1, CELLAR.standY, CELLAR_PLAN.rooms.STORE[1] + 4],
    };
    const got = [];
    for (const [what, c] of Object.entries(goals)) {
      const d = dist.get(key(...c));
      if (d === undefined) report(`a player cannot walk from the Parts & Service door to ${what} (${c})`);
      else got.push(`${what} ${d}`);
    }
    console.log(`  on foot from the Parts & Service door (steps): ${got.join(', ')}`);
    if (!reach(seatCell).has(key(...start))) report('a player in the Other Office cannot walk back up to the Parts & Service door');
  }

  // 7f. light. At night (as built) the stage lamp lights him on his stage; by day (every lamp the game switches
  // on) the rooms are gloomy, never pitch black and never bright.
  {
    const emitDefs = new Map();
    for (const f of fs.readdirSync(BDIR).filter((q) => q.endsWith('.json'))) {
      const b = JSON.parse(fs.readFileSync(path.join(BDIR, f), 'utf8'))['minecraft:block'];
      const c = b.components ?? {};
      const g = c['minecraft:geometry'];
      const gid = typeof g === 'string' ? g : g?.identifier;
      const parse = (cond) => (cond ?? '').split('&&').map((t) => t.match(/q\.block_state\('([^']+)'\)\s*==\s*'?([^')\s]+)'?/)).filter(Boolean).map((m) => [m[1], m[2]]);
      const perms = (b.permutations ?? []).filter((q) => q.components?.['minecraft:light_emission'] !== undefined).map((q) => ({ cond: parse(q.condition), level: q.components['minecraft:light_emission'] }));
      emitDefs.set(b.description.identifier, { base: c['minecraft:light_emission'] ?? 0, perms, clear: c['minecraft:light_dampening'] === 0 || (!!gid && gid !== 'minecraft:geometry.full_block') });
    }
    const VAN = { 'minecraft:lantern': 15, 'minecraft:sea_lantern': 15, 'minecraft:ochre_froglight': 15 };
    const VCLEAR = /^minecraft:(air|light_block_\d+|.*glass.*|.*_bars|.*chain|.*carpet|.*_slab|.*_stairs|.*fence.*|.*_wall|.*door|.*trapdoor|.*sign|.*button|.*lantern|web|ladder|.*_rod|lectern|.*anvil|cauldron|hopper)$/;
    /** Block light inside the cellar's volume (a flood fill like the game's), for a voxel grid. */
    const lightOf = (g) => {
      const bx1 = 14, bx2 = 62, bz1 = 12, bz2 = 74, by1 = CELLAR.baseY, by2 = CELLAR.ceilY;
      const w = bx2 - bx1 + 1, dpt = bz2 - bz1 + 1, h = by2 - by1 + 1;
      const lv = new Uint8Array(w * dpt * h);
      const ent = (x, y, z) => g.palette[g.data[(x - g.x0) + g.sx * ((z - g.z0) + g.sz * (y - g.y0))]];
      const emit = (e) => {
        const m = /^minecraft:light_block_(\d+)$/.exec(e.name);
        if (m) return Number(m[1]);
        if (VAN[e.name]) return VAN[e.name];
        const d = emitDefs.get(e.name);
        if (!d) return 0;
        let l = d.base;
        for (const q of d.perms) if (q.cond.every(([k, v]) => String(e.states?.[k]) === v)) l = q.level;
        return l;
      };
      const clear = (e) => (e.name.startsWith('fnar:') ? emitDefs.get(e.name)?.clear ?? false : VCLEAR.test(e.name));
      const at = (x, y, z) => (x - bx1) + w * ((z - bz1) + dpt * (y - by1));
      const buckets = Array.from({ length: 16 }, () => []);
      for (let x = bx1; x <= bx2; x++) for (let y = by1; y <= by2; y++) for (let z = bz1; z <= bz2; z++) {
        const l = emit(ent(x, y, z));
        if (l) { lv[at(x, y, z)] = l; buckets[l].push([x, y, z]); }
      }
      for (let l = 15; l > 1; l--) for (const [x, y, z] of buckets[l]) {
        if (lv[at(x, y, z)] !== l) continue;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < bx1 || nx > bx2 || ny < by1 || ny > by2 || nz < bz1 || nz > bz2) continue;
          if (!clear(ent(nx, ny, nz)) || lv[at(nx, ny, nz)] >= l - 1) continue;
          lv[at(nx, ny, nz)] = l - 1;
          buckets[l - 1].push([nx, ny, nz]);
        }
      }
      return (x, y, z) => lv[at(x, y, z)];
    };
    const night = lightOf(grid);
    const st = NODES[CELLAR.stage];
    const onStage = Math.max(...[0, 1, 2, 3].map((dy) => night(Math.floor(st.x), st.y + dy, Math.floor(st.z))));
    console.log(`  at night: block light ${onStage} on him on the stage, ${night(A.x1 + 1, CELLAR.standY + 1, 50)} in the Long Hall, ${night(Math.floor(seat.x), seat.y + 1, Math.floor(seat.z))} at the Other Office's seat`);
    if (onStage < 7) report(`the stage lamp does not light him on his stage at night (block light ${onStage}, want 7+)`);
    const day = lightOf(buildVoxels(1991, { mode: 'day' }).grid);
    const R = { ...CELLAR.rooms, ...CELLAR_PLAN.rooms };
    const spots = [];
    for (const [id, [x1, z1, x2, z2]] of Object.entries(R)) {
      let best = 0, worst = 15;
      for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
        const l = Math.max(day(x, CELLAR.standY, z), day(x, CELLAR.standY + 1, z));
        best = Math.max(best, l);
        worst = Math.min(worst, l);
      }
      spots.push(`${id} ${worst}-${best}`);
      if (best < 4) report(`by day ${id} is pitch black (brightest block light ${best}): a player cannot find the way`);
      if (best > 13) report(`by day ${id} is brightly lit (block light ${best}): the cellar should be gloomy`);
    }
    console.log(`  by day (block light, darkest-brightest): ${spots.join(', ')}`);
  }
}

console.log(problems ? `validate_map: ${problems} problem(s)` : 'validate_map: ok');
process.exit(problems ? 1 : 0);
