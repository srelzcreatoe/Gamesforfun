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
const { LOT } = await import(path.join(DATA, 'layout.js'));
const { PHASES } = await import(path.join(DATA, 'plan.js'));

export function buildVoxels(seed = 1991) {
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
  return { snapshot: { format: 'fnar-voxels-1', origin: [x0, y0, z0], size: [sx, sy, sz], palette, data: Buffer.from(data.buffer).toString('base64'), signs }, meta, outOfBounds, grid: { data, x0, y0, z0, sx, sy, sz, palette } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? path.join(ROOT, 'tools/.cache/map.json');
  const t0 = Date.now();
  const { snapshot, meta, outOfBounds } = buildVoxels();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snapshot));
  fs.writeFileSync(out.replace(/\.json$/, '.meta.json'), JSON.stringify(meta, null, 1));
  console.log(`export_voxels: ${snapshot.size.join('x')} cells, ${snapshot.palette.length} palette entries, ${snapshot.signs.length} signs, ${outOfBounds} out-of-bounds writes, ${Date.now() - t0} ms -> ${path.relative(ROOT, out)}`);
}
