// Exports per-level top-down grids + overlays for tools/render_floorplans.py.
import fs from 'node:fs';
import { buildVoxel, opaque, passable } from './voxel.mjs';
import { ROOMS, OPENINGS, LEVELS, interior, ORIGIN } from '../packs/FredbearBP/scripts/data/layout.js';
import { NODES, EDGES, edgePolyline } from '../packs/FredbearBP/scripts/data/nodes.js';
import { CAMERAS } from '../packs/FredbearBP/scripts/data/cameras.js';
import { INPUTS } from '../packs/FredbearBP/scripts/data/inputs.js';

const V = buildVoxel();
const x0 = -12; const x1 = 211; const z0 = -12; const z1 = 211;
const out = { origin: ORIGIN, bounds: { x0, x1, z0, z1 }, levels: {} };
for (const [id, lv] of Object.entries(LEVELS)) {
  const y = lv.stand + 1; // cut plane just above the floor (props + walls)
  const rows = [];
  for (let z = z0; z <= z1; z++) {
    let row = '';
    for (let x = x0; x <= x1; x++) {
      const k0 = V.get(x, y - 1, z);
      const k = opaque(V.get(x, y, z)) && !passable(V.get(x, y, z)) ? V.get(x, y, z) : (k0 && k0 !== 'air' && !passable(k0) ? k0 : V.get(x, y, z));
      const f = V.get(x, lv.floorY, z);
      const inRoom = ROOMS.some((r) => (r.level === id || r.shaftFloorY !== undefined) && x >= r.box[0] && x <= r.box[2] && z >= r.box[1] && z <= r.box[3]);
      if (k === undefined) row += ' ';
      else if (id === 'L2' && !inRoom && f === 'gray_c') row += 'r';
      else if (!passable(k) && k !== 'air') row += k.startsWith('glass') ? 'g' : (k.includes('wool') || k.includes('barrel') || k.includes('spruce') || k.includes('slab') || k.includes('stairs') || k.includes('cake') || k.includes('carpet') || k.includes('pot') || k.includes('fence')) ? 'p' : '#';
      else if (f === 'grass' || f === 'coarse' || f === 'podzol') row += ',';
      else if (f === 'gray_c' && id === 'L1' && (z > 153 || x > 185)) row += '=';
      else if (f && f !== 'air' && f !== 'stone' && f !== 'dirt') row += '.';
      else row += ' ';
    }
    rows.push(row);
  }
  out.levels[id] = {
    rows,
    rooms: ROOMS.filter((r) => r.level === id || (id === 'L0' && r.shaftFloorY !== undefined)).map((r) => ({ id: r.id, name: r.name, box: r.box, zone: r.zone, interior: interior(r) })),
    openings: OPENINGS.filter((o) => (id === 'L0' ? o.y1 <= -4 : id === 'L1' ? o.y1 > -4 && o.y1 <= 6 : o.y1 > 6)),
    nodes: NODES.filter((n) => (id === 'L0' ? n.y <= -2 : id === 'L1' ? n.y > -2 && n.y < 7 : n.y >= 7)),
    edges: EDGES.map((e) => ({ id: e.id, access: e.access, mode: e.mode, pts: edgePolyline(e, e.a) }))
      .filter((e) => e.pts.some((p) => (id === 'L0' ? p[1] <= -2 : id === 'L1' ? p[1] > -2 && p[1] < 7 : p[1] >= 7))),
    cameras: CAMERAS.filter((c) => (id === 'L0' ? c.loc[1] < -2 : id === 'L1' ? c.loc[1] >= -2 && c.loc[1] < 13 && c.room !== 'NONE' : false)),
    inputs: INPUTS.filter((i) => (id === 'L0' ? i.p[1] <= -4 : id === 'L1' ? i.p[1] > -4 && i.p[1] < 7 : i.p[1] >= 7)),
  };
}
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/floorplan.json', import.meta.url), JSON.stringify(out));
console.log('wrote tools/out/floorplan.json');
