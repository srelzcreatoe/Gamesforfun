// Seasonal decorations (tools/gen_holidays.mjs): every cell is air in the built
// map, and with the decorations placed every player route, animatronic route
// and camera sight line still works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateGuide } from '../tools/gen_guide.mjs';
import { generateHolidays } from '../tools/gen_holidays.mjs';
import { passable, opaque } from '../tools/voxel.mjs';
import { HOLIDAY_DECOR } from '../packs/FredbearBP/scripts/data/holiday_decor.generated.js';
import { GUIDE_NODES, GUIDE_EDGES } from '../packs/FredbearBP/scripts/data/guide_graph.generated.js';
import { EDGES, NODE_BY_ID, edgePolyline } from '../packs/FredbearBP/scripts/data/nodes.js';
import { CAMERAS } from '../packs/FredbearBP/scripts/data/cameras.js';

const cellsOf = (season) => {
  const { keys, cells } = HOLIDAY_DECOR[season];
  const out = [];
  for (let i = 0; i < cells.length; i += 4) out.push([cells[i], cells[i + 1], cells[i + 2], keys[cells[i + 3]]]);
  return out;
};

test('the generated decorations are up to date with the build plan', () => {
  const g = generateHolidays();
  for (const season of ['halloween', 'christmas']) {
    const want = g[season].map((c) => c.join(',')).sort();
    const have = cellsOf(season).map((c) => c.join(',')).sort();
    assert.deepEqual(have, want, `${season} changed: run node tools/gen_holidays.mjs`);
  }
  assert.ok(g.trees.length >= 2, 'at least two Christmas trees found a safe spot');
});

for (const season of ['halloween', 'christmas']) {
  test(`${season}: placed only into air; routes, guidance and cameras unaffected`, () => {
    const G = generateGuide();
    const V = G.voxel;
    for (const [x, y, z] of cellsOf(season)) assert.equal(V.get(x, y, z), 'air', `${season} cell ${x},${y},${z} is not air in the built map`);
    for (const [x, y, z, k] of cellsOf(season)) V.set(x, y, z, k);
    try {
      checkWithDecor(G, V, season);
    } finally {
      for (const [x, y, z] of cellsOf(season)) V.set(x, y, z, 'air'); // the voxel model is shared (cached)
    }
  });
}

function checkWithDecor(G, V, season) {
  {
    // Player guidance: every edge still walkable both ways.
    for (let i = 0; i < GUIDE_EDGES.length; i += 3) {
      const a = GUIDE_EDGES[i] * 4;
      const b = GUIDE_EDGES[i + 1] * 4;
      const pa = { x: GUIDE_NODES[a], y: GUIDE_NODES[a + 1], z: GUIDE_NODES[a + 2] };
      const pb = { x: GUIDE_NODES[b], y: GUIDE_NODES[b + 1], z: GUIDE_NODES[b + 2] };
      if (pa.x === pb.x && pa.z === pb.z) continue; // ladder (climbed, not walked)
      assert.ok(G.lineWalk(pa, pb) >= 0 && G.lineWalk(pb, pa) >= 0, `guide edge ${JSON.stringify(pa)} - ${JSON.stringify(pb)} blocked`);
    }
    // Animatronic routes: every body cell along every polyline passable.
    for (const e of EDGES) {
      const pts = edgePolyline(e, e.a);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0, z0] = pts[i - 1];
        const [x1, y1, z1] = pts[i];
        const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 0.25);
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const x = Math.floor(x0 + (x1 - x0) * t);
          const y = Math.floor(y0 + (y1 - y0) * t + 0.01);
          const z = Math.floor(z0 + (z1 - z0) * t);
          const key = V.get(x, y, z);
          if (!passable(key)) assert.ok(!cellsOf(season).some(([cx, cy, cz]) => cx === x && cy === y && cz === z), `${e.id}: decoration blocks the route at ${x},${y},${z}`);
        }
      }
    }
    // Cameras: no decoration on a sight line to a watched node.
    for (const cam of CAMERAS) {
      for (const id of cam.sees) {
        const n = NODE_BY_ID[id];
        const [ax, ay, az] = cam.loc;
        const [bx, by, bz] = [n.x, n.y + 1.4, n.z];
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 0.25);
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const c = [Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t)];
          const key = V.get(...c);
          if (opaque(key)) assert.ok(!cellsOf(season).some(([x, y, z]) => x === c[0] && y === c[1] && z === c[2]), `${cam.id} -> ${id}: decoration in the sight line at ${c}`);
        }
      }
    }
  }
}
