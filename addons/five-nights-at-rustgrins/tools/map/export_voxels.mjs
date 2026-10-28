// Runs the game's build plan in Node and writes a voxel snapshot
// (format fnar-voxels-1, see docs/RENDERER.md) of exactly what /fnar:setup builds.
// Usage: node tools/map/export_voxels.mjs [out.json]   (default tools/.cache/map.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'packs/BP/scripts/data');
const { generatePlan } = await import(path.join(DATA, 'build_plan.js'));
const { PALETTE, pictureBlock } = await import(path.join(DATA, 'palette.js'));
const LAYOUT = await import(path.join(DATA, 'layout.js'));
const { LOT, DAY_LIGHTS } = LAYOUT;
const { PHASES } = await import(path.join(DATA, 'plan.js'));

export function buildVoxels(seed = 1991, opts = {}) {
  const { ops, meta } = generatePlan(seed);
  const x0 = LOT.x1, y0 = LOT.baseY, z0 = LOT.z1;
  const sx = LOT.x2 - LOT.x1 + 1, sy = LOT.clearTop + 6 - LOT.baseY + 1, sz = LOT.z2 - LOT.z1 + 1;
  const data = new Uint16Array(sx * sy * sz);
  const palette = [{ name: 'minecraft:air' }];
  const palIndex = new Map([['air', 0]]);
  const resolve = (key) => {
    if (palIndex.has(key)) return palIndex.get(key);
    let b;
    if (key.startsWith('pic:')) {
      const [, name, tile, dir] = key.split(':');
      b = pictureBlock(name, Number(tile), dir);
    } else {
      b = PALETTE[key];
      if (!b) throw new Error(`unknown palette key ${key}`);
    }
    if (b.name === 'minecraft:air') { palIndex.set(key, 0); return 0; }
    const id = palette.length;
    palette.push(b.states ? { name: b.name, states: b.states } : { name: b.name });
    palIndex.set(key, id);
    return id;
  };
  const idx = (x, y, z) => {
    const ix = x - x0, iy = y - y0, iz = z - z0;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz) return -1;
    return ix + sx * (iz + sz * iy);
  };
  const signs = [];
  let outOfBounds = 0;
  for (const phase of PHASES) {
    for (const op of ops[phase]) {
      const t = op[0];
      if (t === 'F' || t === 'A') {
        const [, x1, y1, z1, x2, y2, z2, key] = op;
        const v = resolve(key);
        for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
          const i = idx(x, y, z);
          if (i < 0) { outOfBounds++; continue; }
          if (t === 'A' && data[i] !== 0) continue;
          data[i] = v;
        }
      } else if (t === 'L') {
        const [, key, list] = op;
        const v = resolve(key);
        for (let k = 0; k < list.length; k += 3) {
          const i = idx(list[k], list[k + 1], list[k + 2]);
          if (i < 0) { outOfBounds++; continue; }
          data[i] = v;
        }
      } else if (t === 'T') {
        const [, x, y, z, key, lines] = op;
        const i = idx(x, y, z);
        if (i < 0) { outOfBounds++; continue; }
        data[i] = resolve(key);
        signs.push({ pos: [x, y, z], lines });
      }
    }
  }
  applyMode(opts.mode ?? 'night', { data, idx, palette, meta });
  applyVariants(opts, { data, idx, palette, meta });
  return { snapshot: { format: 'fnar-voxels-1', origin: [x0, y0, z0], size: [sx, sy, sz], palette, data: Buffer.from(data.buffer).toString('base64'), signs }, meta, outOfBounds, grid: { data, x0, y0, z0, sx, sy, sz, palette } };
}

/**
 * Scene variants for preview pictures (what the game does at runtime):
 *   curtain: 1|2|3   the Cabaret curtain gap (the Cat peeking / stepping out)
 *   hall: ['L','R']  hall lights on (light blocks + the lamp outside the door)
 *   powerOut: true   the office lamp, monitor and buttons dark
 *   cutaway: y       remove every block above y inside the building (floor-plan shot)
 *   doors: ['L','R'] shutters closed
 */
function applyVariants(o, { data, idx, palette, meta }) {
  const pid = (name, states) => {
    let id = palette.findIndex((p) => p.name === name && JSON.stringify(p.states ?? {}) === JSON.stringify(states ?? {}));
    if (id < 0) { id = palette.length; palette.push(states ? { name, states } : { name }); }
    return id;
  };
  const put = (x, y, z, id) => { const i = idx(x, y, z); if (i >= 0) data[i] = id; };
  const setLit = (x, y, z, v) => { const i = idx(x, y, z); if (i < 0 || !data[i]) return; const e = palette[data[i]]; if (!e.states || !('fnar:lit' in e.states)) return; data[i] = pid(e.name, { ...e.states, 'fnar:lit': v }); };
  if (o.curtain) {
    const { CABARET } = LAYOUT;
    const g = CABARET.gap;
    const z1 = o.curtain >= 2 ? g.z1 - 1 : g.z1, z2 = o.curtain >= 2 ? g.z2 + 1 : g.z2;
    for (let y = g.y1; y <= g.y2; y++) for (let z = z1; z <= z2; z++) put(CABARET.curtain.x, y, z, 0);
  }
  for (const side of o.hall ?? []) {
    const h = LAYOUT.OFFICE.hallLights[side];
    const [x1, y1, z1, x2, y2, z2] = h.box;
    const light = pid(`minecraft:light_block_${h.level}`);
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) { const i = idx(x, y, z); if (i >= 0 && data[i] === 0) data[i] = light; }
    setLit(h.lamp.x, h.lamp.y, h.lamp.z, true);
  }
  for (const side of o.doors ?? []) {
    const d = LAYOUT.OFFICE.doors[side];
    for (let y = d.y1; y <= d.y2; y++) for (let z = d.z1; z <= d.z2; z++) put(d.x, y, z, pid('fnar:door_shutter', { 'fnar:part': y === d.y1 ? 1 : 0 }));
  }
  if (o.powerOut) {
    const L = LAYOUT.OFFICE.lamp;
    setLit(L.x, L.y, L.z, false);
    for (const l of meta.lamps) setLit(l.x, l.y, l.z, false);
    const m = LAYOUT.OFFICE.monitor;
    const i = idx(m.x, m.y, m.z);
    if (i >= 0 && palette[data[i]].name === 'fnar:crt_monitor') data[i] = pid('fnar:crt_monitor', { ...palette[data[i]].states, 'fnar:on': false });
  }
  if (o.cutaway !== undefined) {
    const B = LAYOUT.BUILDING;
    for (let x = B.x1 - 1; x <= B.x2 + 1; x++) for (let z = B.z1 - 1; z <= B.z2 + 1; z++) for (let y = o.cutaway + 1; y <= B.roofY + 6; y++) put(x, y, z, 0);
  }
}

/**
 * Preview lighting modes (the game switches these at runtime; the build itself is 'night'):
 *   night      as built: lamps off except the office
 *   night_lit  + stage spotlights, a few dining lamps, the left hall light, the Midway lamp
 *   day        every lamp and spotlight on, the Cabaret curtain open (free roam)
 */
function applyMode(mode, { data, idx, palette, meta }) {
  if (mode === 'night') return;
  const cache = new Map();
  const setState = (x, y, z, state, value) => {
    const i = idx(x, y, z);
    if (i < 0 || !data[i]) return;
    const e = palette[data[i]];
    if (!e.states || !(state in e.states)) return;
    const states = { ...e.states, [state]: value };
    const k = e.name + JSON.stringify(states);
    let id = cache.get(k);
    if (id === undefined) {
      id = palette.findIndex((p) => p.name === e.name && JSON.stringify(p.states) === JSON.stringify(states));
      if (id < 0) { id = palette.length; palette.push({ name: e.name, states }); }
      cache.set(k, id);
    }
    data[i] = id;
  };
  const lit = (l) => setState(l.x, l.y, l.z, 'fnar:lit', true);
  if (mode === 'day') {
    for (const l of [...meta.lamps, ...meta.spots, ...meta.hanging]) lit(l);
    for (let y = 0; y <= 4; y++) for (let z = 30; z <= 36; z++) { const i = idx(14, y, z); if (i >= 0) data[i] = 0; }
    for (const [x, y, z, level] of DAY_LIGHTS) {
      const i = idx(x, y, z);
      if (i < 0 || data[i] !== 0) continue;
      let id = palette.findIndex((p) => p.name === `minecraft:light_block_${level}`);
      if (id < 0) { id = palette.length; palette.push({ name: `minecraft:light_block_${level}` }); }
      data[i] = id;
    }
    return;
  }
  for (const s of meta.spots) if (s.group === 'stage' || s.group === 'cabaret') lit(s);
  for (const h of meta.hanging) if (h.group === 'midway' || h.group === 'backstage') lit(h);
  meta.lamps.filter((l) => l.group === 'dining').forEach((l, i) => { if (i % 3 === 0) lit(l); });
  for (const l of meta.lamps) if (l.group === 'door_l' || l.group === 'office' || l.room === 'STAFF') lit(l);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? path.join(ROOT, 'tools/.cache/map.json');
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const opts = { mode: arg('mode', 'night') };
  if (arg('curtain')) opts.curtain = Number(arg('curtain'));
  if (arg('hall')) opts.hall = arg('hall').split(',');
  if (arg('doors')) opts.doors = arg('doors').split(',');
  if (arg('cutaway')) opts.cutaway = Number(arg('cutaway'));
  if (process.argv.includes('--powerOut')) opts.powerOut = true;
  const t0 = Date.now();
  const { snapshot, meta, outOfBounds } = buildVoxels(1991, opts);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snapshot));
  fs.writeFileSync(out.replace(/\.json$/, '.meta.json'), JSON.stringify(meta, null, 1));
  console.log(`export_voxels: ${snapshot.size.join('x')} cells, ${snapshot.palette.length} palette entries, ${snapshot.signs.length} signs, ${outOfBounds} out-of-bounds writes, ${Date.now() - t0} ms -> ${path.relative(ROOT, out)}`);
}
