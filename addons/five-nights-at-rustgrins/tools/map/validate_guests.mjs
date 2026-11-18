// Validates the daytime guests' map (packs/BP/scripts/data/guests.js) on the exported voxel model
// (what /fnar:setup builds, with the front doors as they stand by day):
//   1. every walkway link: the whole corridor a guest may use (the link's half-width at each end plus
//      the body's radius, with round ends) is clear of anything a body would walk through - tables,
//      chairs, walls, glass, ropes, props on the floor - from the feet to the top of the head, and has
//      a floor under it
//   2. the graph is connected, and every portal is in the lot
//   3. every seat the scripts find in the build plan is that seat in the built model (block and
//      direction), its step-off spot is free, the step from the walkway to it is free, and the slide
//      from there onto the seat crosses nothing but the bench it belongs to
//   4. every place to stand (in front of the stage, the prize counter, the ball pit, the podium) and
//      every arcade cabinet's player spot is free and joined to a walkway by a free step; cabinet
//      spots face a cabinet; the show's standing places keep out of the middle aisle
//   5. there are enough seats and standing places for a full house
// Usage: node tools/map/validate_guests.mjs [--plot out.png [--box x1,z1,x2,z2]]   (exit 1 on problems)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'packs/BP/scripts/data');
const { buildVoxels } = await import('./export_voxels.mjs');
const G = await import(path.join(DATA, 'guests.js'));
const { generatePlan } = await import(path.join(DATA, 'build_plan.js'));
const { LOT, ROOM_BY_ID } = await import(path.join(DATA, 'layout.js'));

const { grid } = buildVoxels();
const { data, x0, y0, z0, sx, sy, sz, palette } = grid;
const cellIndex = (x, y, z) => {
  const ix = Math.floor(x) - x0, iy = Math.floor(y) - y0, iz = Math.floor(z) - z0;
  if (ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz) return -1;
  return ix + sx * (iz + sz * iy);
};
const entryAt = (x, y, z) => { const i = cellIndex(x, y, z); return i < 0 ? { name: 'minecraft:air' } : palette[data[i]]; };
// the front doors by day
let dayOpened = 0;
for (const [x, y, z] of G.DAY_OPEN) {
  const i = cellIndex(x, y, z);
  if (i >= 0 && data[i] !== 0) { data[i] = 0; dayOpened++; }
}

// What a body passes through: air, invisible light, carpet, flat things on the floor and on walls.
// Stricter than validate_map.mjs's list for the 3-block cast: panes, bars, ropes, hats and balloons on the
// floor all stop a guest.
const PASS = /^(minecraft:(air|light_block_\d+|short_grass|.*_carpet|.*wall_sign|.*_button)|fnar:(floor_decal|poster_.*|drawing|sign_.*|wall_writing|lot_tag|neon_sign.*|menu_board|height_chart|token_prices|bunting|light_button|door_button))$/;
const passable = (x, y, z) => PASS.test(entryAt(x, y, z).name);
const HEADS = [];
for (let y = 0; y < G.GUEST_BODY.height; y++) HEADS.push(y);
/** null when a body can stand with its feet on the floor at (x, z), else what is in the way. */
function blockedAt(x, z) {
  for (const y of HEADS) if (!passable(x, y, z)) return `${entryAt(x, y, z).name} at ${Math.floor(x)},${y},${Math.floor(z)}`;
  if (passable(x, -1, z)) return `no floor at ${Math.floor(x)},${Math.floor(z)}`;
  return null;
}
const STEP = 0.15;
/** A disc of radius r round (x, z): null when free. `skip(cx, cz)` exempts cells. */
function discBlocked(x, z, r, skip) {
  for (let dx = -r; dx <= r + 1e-9; dx += STEP) {
    for (let dz = -r; dz <= r + 1e-9; dz += STEP) {
      if (dx * dx + dz * dz > r * r + 1e-9) continue;
      if (skip?.(Math.floor(x + dx), Math.floor(z + dz))) continue;
      const b = blockedAt(x + dx, z + dz);
      if (b) return b;
    }
  }
  return null;
}
/** The corridor from a to b ([x, z]) with radius ra at a and rb at b (round ends): null when free. */
function corridorBlocked(a, b, ra, rb, skip) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / STEP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const hit = discBlocked(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ra + (rb - ra) * t, skip);
    if (hit) return hit;
  }
  return null;
}

let problems = 0;
const report = (msg) => { problems++; console.log('  ' + msg); };
const R = G.GUEST_BODY.radius;
const g = G.buildGraph();
const plan = generatePlan();
const { seats, cabinets } = G.scanPlan(plan);

console.log(`walkways (${g.ids.length} waypoints, ${g.edges.length} links${dayOpened ? `, front doors opened by day: ${dayOpened} cells` : ', the doorway is already open as built'}):`);
for (const E of g.edges) {
  const A = g.pts[E.a], B = g.pts[E.b];
  const hit = corridorBlocked([A.x, A.z], [B.x, B.z], A.w + R, B.w + R);
  if (hit) report(`${A.id} - ${B.id}: ${hit}`);
}
{
  const n = g.ids.length;
  const from = g.index[G.DOOR.inside];
  for (let i = 0; i < n; i++) if (g.dist[from * n + i] === Infinity) report(`${g.ids[i]} cannot be reached from the front doors`);
  for (const p of G.PORTALS) {
    const P = G.WAYPOINTS[p.id];
    if (!P) { report(`portal ${p.id} is not a waypoint`); continue; }
    if (P.x < LOT.x1 + 0.5 || P.x > LOT.x2 + 0.5 || P.z < LOT.z1 + 0.5 || P.z > LOT.z2 + 0.5) report(`portal ${p.id} is outside the lot`);
  }
  for (const k of ['outside', 'sill', 'inside']) if (!G.WAYPOINTS[G.DOOR[k]]) report(`the door's ${k} waypoint ${G.DOOR[k]} does not exist`);
}

console.log(`seats (${seats.length} found in the build plan):`);
const SEAT_BLOCK = { chair: 'fnar:party_chair', starchair: 'fnar:star_chair', booth: 'fnar:booth_seat' };
const CARD = { n: 'north', s: 'south', e: 'east', w: 'west' };
const anchors = new Map();
const seatCells = new Set(seats.map((s) => `${s.bx},${s.bz}`));
for (const s of seats) {
  const e = entryAt(s.bx, 0, s.bz);
  if (!Object.values(SEAT_BLOCK).includes(e.name)) { report(`${s.id}: the built block is ${e.name}, not a seat`); continue; }
  if (e.states?.['minecraft:cardinal_direction'] !== CARD[s.dir]) report(`${s.id}: faces ${e.states?.['minecraft:cardinal_direction']} in the model, ${CARD[s.dir]} in the scan`);
  const top = { 'fnar:party_chair': 8 / 16, 'fnar:star_chair': 9 / 16, 'fnar:booth_seat': 8.5 / 16 }[e.name];
  if (Math.abs(top - s.top) > 1e-6) report(`${s.id}: seat height ${s.top}, the block's is ${top}`);
  let hit = discBlocked(s.ax, s.az, R);
  if (hit) { report(`${s.id}: its step-off spot ${s.ax},${s.az} is blocked: ${hit}`); continue; }
  const an = G.anchor(g, s.ax, s.az, { aisle: s.room === 'DINING' });
  anchors.set(s.id, an);
  hit = corridorBlocked([an.px, an.pz], [s.ax, s.az], R, R);
  if (hit) report(`${s.id}: the step from the walkway (${an.px.toFixed(1)},${an.pz.toFixed(1)}) to ${s.ax},${s.az} is blocked: ${hit}`);
  if (an.off > 4.5) report(`${s.id}: ${an.off.toFixed(1)} blocks from the nearest walkway`);
  // the slide onto the seat: only its own bench may be in the way
  const own = (cx, cz) => seatCells.has(`${cx},${cz}`) && (s.booth || (cx === s.bx && cz === s.bz));
  hit = corridorBlocked([s.ax, s.az], [s.x, s.z], 0.12, 0.12, own);
  if (hit) report(`${s.id}: the slide onto it crosses ${hit}`);
  if (s.past && !seats.some((o) => o.id === s.past)) report(`${s.id}: reached past ${s.past}, which is not a seat`);
}
console.log(`cabinets (${cabinets.length} found in the build plan) and ${G.STANDS.length} places to stand:`);
for (const c of cabinets) {
  const e = entryAt(c.bx, 0, c.bz);
  if (e.name !== 'fnar:arcade_cabinet' || e.states?.['minecraft:cardinal_direction'] !== CARD[c.dir]) { report(`${c.id}: the built block is ${e.name} facing ${e.states?.['minecraft:cardinal_direction']}`); continue; }
  let hit = discBlocked(c.x, c.z, R);
  if (hit) { report(`${c.id}: the player's spot ${c.x.toFixed(2)},${c.z.toFixed(2)} is blocked: ${hit}`); continue; }
  const an = G.anchor(g, c.x, c.z);
  anchors.set(c.id, an);
  hit = corridorBlocked([an.px, an.pz], [c.x, c.z], R, R);
  if (hit) report(`${c.id}: the step from the walkway to its player's spot is blocked: ${hit}`);
  if (an.off > 4.5) report(`${c.id}: ${an.off.toFixed(1)} blocks from the nearest walkway`);
}
const standAnchors = [];
G.STANDS.forEach((s, i) => {
  const id = `${s.kind} ${s.x},${s.z}`;
  let hit = discBlocked(s.x, s.z, R);
  if (hit) { report(`${id}: blocked: ${hit}`); return; }
  const an = G.anchor(g, s.x, s.z);
  standAnchors[i] = an;
  hit = corridorBlocked([an.px, an.pz], [s.x, s.z], R, R);
  if (hit) report(`${id}: the step from the walkway is blocked: ${hit}`);
  if (s.kind === 'stage' && s.x > 35.5 - R && s.x < 41.5 + R) report(`${id}: stands in the middle aisle (x 35.5..41.5 stays free for the band's view)`);
  for (const o of G.STANDS) if (o !== s && Math.hypot(o.x - s.x, o.z - s.z) < 0.9) report(`${id}: closer than 0.9 to ${o.kind} ${o.x},${o.z}`);
});
{
  const count = (k) => G.STANDS.filter((s) => s.kind === k).length;
  const dining = seats.filter((s) => s.room === 'DINING').length;
  if (dining < G.CROWD.max * 2) report(`only ${dining} seats in the Dining Hall for a crowd of ${G.CROWD.max}`);
  if (count('stage') < G.CROWD.max) report(`only ${count('stage')} standing places in front of the stage for a crowd of ${G.CROWD.max}`);
  if (cabinets.length < 12) report(`only ${cabinets.length} arcade cabinets to play`);
  // the longest walk out, for the closing-time timing
  const door = G.anchorAt(g, G.DOOR.inside);
  let far = 0, farId = '';
  for (const [id, an] of anchors) {
    const d = G.routeLength(G.route(g, an, door));
    if (!(d > 0)) report(`${id}: no route to the front doors`);
    if (d > far) { far = d; farId = id; }
  }
  console.log(`  ${dining} seats in the Dining Hall, ${seats.length - dining} in the Game Room, ${cabinets.length} cabinets, ${count('stage')} show places; the longest walk to the doors is ${far.toFixed(0)} blocks (${farId})`);
}

// ---------------------------------------------------------------- a picture of it all (--plot out.png)
const plotArg = process.argv.indexOf('--plot');
if (plotArg >= 0) {
  const { PNG } = await import('pngjs');
  const out = process.argv[plotArg + 1] ?? path.join(ROOT, 'tools/.cache/guests_map.png');
  // --box x1,z1,x2,z2 zooms in on a part of the lot; grid lines are darker every 5 and every 10 blocks
  const boxArg = process.argv.indexOf('--box');
  const [X1, Z1, X2, Z2] = boxArg >= 0 ? process.argv[boxArg + 1].split(',').map(Number) : [13, -16, 147, 87];
  const S = boxArg >= 0 ? Math.max(12, Math.min(40, Math.floor(1600 / (X2 - X1)))) : 12; // pixels per block
  const png = new PNG({ width: (X2 - X1) * S, height: (Z2 - Z1) * S });
  const set = (px, py, c, a = 1) => {
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) return;
    const i = (py * png.width + px) * 4;
    for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(png.data[i + k] * (1 - a) + c[k] * a);
    png.data[i + 3] = 255;
  };
  const dot = (x, z, r, c, a = 1) => { const cx = (x - X1) * S, cy = (z - Z1) * S; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) set(Math.round(cx + dx), Math.round(cy + dy), c, a); };
  const line = (a, b, c, w = 1) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * S); for (let i = 0; i <= n; i++) dot(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, w, c); };
  for (let z = Z1; z < Z2; z++) for (let x = X1; x < X2; x++) {
    const b = blockedAt(x + 0.5, z + 0.5);
    const n = entryAt(x, 0, z).name;
    const c = !b ? [232, 232, 226] : /no floor/.test(b) ? [40, 40, 60] : /chair|booth/.test(n) ? [200, 80, 80] : /table/.test(n) ? [150, 110, 70] : /arcade|skee|prize_case/.test(n) ? [90, 110, 190] : passable(x, 0, z) ? [120, 120, 120] : [70, 70, 74];
    const edge = (v) => (v % 10 === 0 ? 0.45 : v % 5 === 0 ? 0.7 : 0.9);
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) set((x - X1) * S + px, (z - Z1) * S + py, c.map((v) => v * Math.min(px === 0 ? edge(x) : 1, py === 0 ? edge(z) : 1)));
  }
  for (const E of g.edges) {
    const A = g.pts[E.a], B = g.pts[E.b];
    const len = Math.hypot(B.x - A.x, B.z - A.z), n = Math.ceil(len * 3);
    for (let i = 0; i <= n; i++) { const t = i / n; dot(A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t, Math.round((A.w + (B.w - A.w) * t + R) * S), [90, 200, 120], 0.12); }
  }
  for (const E of g.edges) line([g.pts[E.a].x, g.pts[E.a].z], [g.pts[E.b].x, g.pts[E.b].z], [20, 140, 60], 1);
  for (const P of g.pts) dot(P.x, P.z, 3, [10, 90, 30]);
  for (const s of seats) { const an = anchors.get(s.id); if (an) line([an.px, an.pz], [s.ax, s.az], [230, 150, 30], 0); line([s.ax, s.az], [s.x, s.z], [230, 90, 30], 0); dot(s.x, s.z, 3, [250, 240, 80]); }
  for (const c of cabinets) { const an = anchors.get(c.id); if (an) line([an.px, an.pz], [c.x, c.z], [60, 150, 230], 0); dot(c.x, c.z, 3, [80, 220, 250]); }
  G.STANDS.forEach((s, i) => { const an = standAnchors[i]; if (an) line([an.px, an.pz], [s.x, s.z], [200, 80, 200], 0); dot(s.x, s.z, 3, [240, 120, 240]); });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log(`  plot: ${path.relative(ROOT, out)}`);
}

console.log(problems ? `validate_guests: ${problems} problem(s)` : 'validate_guests: ok');
process.exit(problems ? 1 : 0);
