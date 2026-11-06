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
//   5. every office control is within reach of the guard's seat, in plain sight.
// Usage: node tools/map/validate_map.mjs   (exit 1 on problems)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { buildVoxels } = await import('./export_voxels.mjs');
const { CAMERAS } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
const { NODES, EDGES, pathBetween } = await import(path.join(ROOT, 'packs/BP/scripts/data/nodes.js'));
const { OFFICE, REACH, OPENINGS } = await import(path.join(ROOT, 'packs/BP/scripts/data/layout.js'));

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

console.log(problems ? `validate_map: ${problems} problem(s)` : 'validate_map: ok');
process.exit(problems ? 1 : 0);
