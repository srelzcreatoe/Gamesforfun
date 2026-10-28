// Map validator on the exported voxel model (what /fnar:setup builds):
//   1. every camera sees every node in its `sees` list (ray-cast to the body and head,
//      inside the feed's view: within VIEW.h / VIEW.v degrees of the aim, which fits
//      Bedrock's default 60 degree FOV on a 4:3 screen);
//   2. every route edge (node -> waypoints -> node) keeps the animatronic's body
//      clear of walls, tables and shelves (ducts: crawl height only);
//   3. every node stands on a floor with head room;
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
const { OFFICE, REACH } = await import(path.join(ROOT, 'packs/BP/scripts/data/layout.js'));

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
// Custom props that do not block a camera's view or a walk (wall decor, small table-top things, lamps).
const THIN_CUSTOM = /^fnar:(poster_|drawing|sign_|bunting|exit_sign|wall_sconce|stage_spotlight|hanging_lamp|security_camera|pa_speaker|door_button|light_button|stage_star|party_hat|plate_set|pizza_box|desk_clutter|plush_rat|time_clock|balloons)/;

function nameAt(x, y, z) {
  const ix = Math.floor(x) - x0, iy = Math.floor(y) - y0, iz = Math.floor(z) - z0;
  if (ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz) return 'minecraft:air';
  return palette[data[ix + sx * (iz + sz * iy)]].name;
}
const blocksSight = (n) => !(SEE_THROUGH.test(n) || (n.startsWith('fnar:') && !fullCustom.has(n) && THIN_CUSTOM.test(n)));
const blocksBody = (n) => !(SEE_THROUGH.test(n) || (n.startsWith('fnar:') && THIN_CUSTOM.test(n)));
// Steps (stairs, slabs, the stage edge) are fine at foot height when a path changes level.
const isStep = (n) => /(_stairs|_slab|stage_floor|red_terracotta)$/.test(n);

const { CABARET } = await import(path.join(ROOT, 'packs/BP/scripts/data/layout.js'));
let gapOpen = false;
const inGap = (p) => gapOpen && Math.floor(p[0]) === CABARET.curtain.x && Math.floor(p[2]) >= CABARET.gap.z1 && Math.floor(p[2]) <= CABARET.gap.z2 && p[1] < CABARET.gap.y2 + 1;
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
    gapOpen = id === 'CAB_PEEK' || id === 'CAB_OUT';
    const res = pts.map((p) => rayClear(c.loc, p));
    if (!res.some((r) => r.ok)) report(`${c.id} cannot see ${id}: blocked by ${res[0].block} at ${res[0].at}`);
    else if (!pts.some((p, i) => res[i].ok && inView(c, p))) report(`${c.id}: ${id} is outside the camera's view`);
  }
}

console.log('nodes:');
for (const n of Object.values(NODES)) {
  const h = n.crawl ? 1.2 : 2.5;
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
      for (const dy of crawl ? [0.3, 0.9] : [0.3, 1.2, 2.2]) {
        gapOpen = [e.a, e.b].some((x) => x.startsWith('CAB_'));
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
console.log(problems ? `validate_map: ${problems} problem(s)` : 'validate_map: ok');
process.exit(problems ? 1 : 0);
