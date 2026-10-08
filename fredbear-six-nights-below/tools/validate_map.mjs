// Map validator: checks the generated build against the gameplay data.
//   A. every AI route segment is collision-free (no walking through walls)
//   B. every route node is a valid standing position
//   C. every camera is in open air and sees exactly what it is designed to see
//   D. the office is sealed except for its two doors and the hatch
//   E. players can walk from the lobby to every gameplay space
//   F. every input command block is fully enclosed (never visible)
// Writes tools/out/map_report.json and exits non-zero on errors.
import fs from 'node:fs';
import { buildVoxel, passable, opaque, standable, canStand, walkNeighbours } from './voxel.mjs';
import { NODES, NODE_BY_ID, EDGES, edgePolyline } from '../packs/FredbearBP/scripts/data/nodes.js';
import { CAMERAS } from '../packs/FredbearBP/scripts/data/cameras.js';
import { ROOMS, ANCHORS, OPENINGS, interior } from '../packs/FredbearBP/scripts/data/layout.js';
import { INPUTS, inputCbPos, inputControlPos } from '../packs/FredbearBP/scripts/data/inputs.js';

export function validateMap({ quiet = false } = {}) {
  const V = buildVoxel();
  const errors = [];
  const warnings = [];
  const info = {};

  // ---------------------------------------------------------------- A. routes
  // Gated edges are checked with their gate OPEN (that is the only time they are used).
  const gateCells = new Set();
  for (const o of OPENINGS.filter((x) => x.gate)) {
    for (let a = o.a1; a <= o.a2; a++) for (let y = o.y1; y <= o.y2; y++) gateCells.add(o.axis === 'x' ? `${o.c},${y},${a}` : `${a},${y},${o.c}`);
  }
  let samples = 0;
  for (const e of EDGES) {
    const pts = edgePolyline(e, e.a);
    for (let s = 1; s < pts.length; s++) {
      const [x0, y0, z0] = pts[s - 1];
      const [x1, y1, z1] = pts[s];
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const n = Math.max(1, Math.ceil(len / 0.2));
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const x = x0 + (x1 - x0) * f;
        const y = y0 + (y1 - y0) * f;
        const z = z0 + (z1 - z0) * f;
        samples++;
        const feet = Math.floor(y + 0.01);
        const cells = e.mode === 'vent' || e.mode === 'climb' ? [feet] : [feet, feet + 1];
        for (const cy of cells) {
          const key = V.get(x, cy, z);
          if (e.gate && gateCells.has(`${Math.floor(x)},${cy},${Math.floor(z)}`)) continue;
          if (!passable(key)) {
            errors.push(`route ${e.id} (${e.mode}) blocked at (${x.toFixed(1)}, ${cy}, ${z.toFixed(1)}) by ${key}`);
            k = n + 1;
            break;
          }
        }
      }
    }
  }
  info.routeSamples = samples;

  // ---------------------------------------------------------------- B. nodes
  for (const n of NODES) {
    const feet = Math.floor(n.y + 0.01);
    if (n.id === 'H_DOOR') continue; // standing on the hatch ladder
    if (!passable(V.get(n.x, feet, n.z)) || !passable(V.get(n.x, feet + 1, n.z))) errors.push(`node ${n.id} body blocked (${V.get(n.x, feet, n.z)}, ${V.get(n.x, feet + 1, n.z)})`);
    if (!standable(V.get(n.x, feet - 1, n.z))) errors.push(`node ${n.id} has nothing to stand on (${V.get(n.x, feet - 1, n.z)})`);
  }

  // ---------------------------------------------------------------- C. cameras
  const los = (a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.ceil(d / 0.1);
    for (let k = 1; k < n - 2; k++) {
      const f = k / n;
      const key = V.get(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      if (opaque(key)) return { ok: false, key, at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f] };
    }
    return { ok: true };
  };
  const angleTo = (cam, p) => {
    const dir = [cam.look[0] - cam.loc[0], cam.look[1] - cam.loc[1], cam.look[2] - cam.loc[2]];
    const v = [p[0] - cam.loc[0], p[1] - cam.loc[1], p[2] - cam.loc[2]];
    const dot = dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2];
    return (Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...dir) * Math.hypot(...v))))) * 180) / Math.PI;
  };
  const camVis = {};
  for (const cam of CAMERAS) {
    if (!passable(V.get(...cam.loc)) && V.get(...cam.loc) !== 'air') errors.push(`camera ${cam.id} is inside ${V.get(...cam.loc)}`);
    const visible = [];
    for (const n of NODES) {
      for (const dy of [1.6, 1.0]) {
        const p = [n.x, n.y + dy, n.z];
        const dist = Math.hypot(p[0] - cam.loc[0], p[1] - cam.loc[1], p[2] - cam.loc[2]);
        if (dist > 80 || angleTo(cam, p) > 45) continue;
        if (los(cam.loc, p).ok) {
          visible.push(n.id);
          break;
        }
      }
    }
    camVis[cam.id] = visible;
    if (cam.audioOnly) continue;
    for (const id of cam.sees) {
      if (!visible.includes(id)) {
        const n = NODE_BY_ID[id];
        const r = los(cam.loc, [n.x, n.y + 1.6, n.z]);
        errors.push(`camera ${cam.id} cannot see designed node ${id} (angle ${angleTo(cam, [n.x, n.y + 1.6, n.z]).toFixed(0)}deg, blocked by ${r.key} at ${r.at?.map((v) => v.toFixed(1))})`);
      }
    }
    const extra = visible.filter((id) => !cam.sees.includes(id));
    if (extra.length) warnings.push(`camera ${cam.id} also shows unlisted nodes: ${extra.join(', ')}`);
  }
  info.cameraVisibility = camVis;

  // ---------------------------------------------------------------- D. office seal
  {
    const gates = new Set();
    for (const o of OPENINGS.filter((x) => x.kind === 'gate')) for (let a = o.a1; a <= o.a2; a++) gates.add(`${o.c}:${a}`);
    for (const [x, z] of [[99, 136], [100, 136], [99, 137], [100, 137]]) gates.add(`${x}:${z}`);
    const seen = new Set();
    const q = [[100, 131]];
    let escaped = null;
    while (q.length) {
      const [x, z] = q.pop();
      const k = `${x}:${z}`;
      if (seen.has(k) || gates.has(k)) continue;
      if (!passable(V.get(x, 0, z)) || !passable(V.get(x, 1, z))) continue;
      seen.add(k);
      if (x < 95 || x > 105 || z < 127 || z > 139) {
        escaped = [x, z];
        break;
      }
      q.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
    if (escaped) errors.push(`office is not sealed: reachable cell (${escaped}) outside the office with gates closed`);
    info.officeCells = seen.size;
  }

  // ---------------------------------------------------------------- E. walkability
  const walk = (start) => {
    const seen = new Set();
    const q = [start];
    while (q.length) {
      const [x, y, z] = q.pop();
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      if (!seen.size && !canStand(V, x, y, z)) continue;
      seen.add(k);
      for (const n of walkNeighbours(V, x, y, z)) if (!seen.has(n.join(','))) q.push(n);
    }
    return seen;
  };
  const reach = walk([Math.floor(ANCHORS.lobbySpawn.x), 0, Math.floor(ANCHORS.lobbySpawn.z)]);
  info.walkableCells = reach.size;
  const roomReach = {};
  for (const r of ROOMS) {
    const i = interior(r);
    let ok = false;
    for (const k of reach) {
      const [x, y, z] = k.split(',').map(Number);
      if (x >= i.x1 && x <= i.x2 && z >= i.z1 && z <= i.z2 && y >= i.y1 - 1 && y <= i.y2) {
        ok = true;
        break;
      }
    }
    roomReach[r.id] = ok;
    const expectedSealed = ['CONTROL', 'CHAMBER'].includes(r.id);
    if (!ok && !expectedSealed) errors.push(`room ${r.id} (${r.name}) is not reachable on foot from the lobby`);
  }
  info.roomReach = roomReach;
  for (const inp of INPUTS) {
    if (inp.id.startsWith('in.dev.') || inp.id === 'in.secret.11' || inp.id === 'in.zone.chamber') continue;
    const [x, y, z] = inp.p;
    const near = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]].some(([a, b]) => [y, y + 1, y - 1].some((yy) => reach.has(`${a},${yy},${b}`)));
    const onPlate = inp.kind === 'plate' && reach.has(`${x},${y},${z}`);
    if (!near && !onPlate) errors.push(`input ${inp.id} at (${inp.p}) cannot be reached on foot`);
  }
  for (const [name, a] of Object.entries({ officeSeat: ANCHORS.officeSeat, parkingSpawn: ANCHORS.parkingSpawn, trainingSpawn: ANCHORS.trainingSpawn })) {
    if (!reach.has(`${Math.floor(a.x)},${a.y},${Math.floor(a.z)}`)) errors.push(`anchor ${name} not reachable from the lobby`);
  }

  // ---------------------------------------------------------------- F. hidden command blocks
  for (const inp of INPUTS) {
    const [cx, cy, cz] = inputCbPos(inp);
    const [bx, by, bz] = inputControlPos(inp);
    const self = V.get(cx, cy, cz);
    if (!standable(self) || !opaque(self)) errors.push(`input ${inp.id}: CB cell (${cx},${cy},${cz}) is '${self}', expected a solid floor block to replace`);
    const neighbours = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]];
    for (const [dx, dy, dz] of neighbours) {
      const k = V.get(cx + dx, cy + dy, cz + dz);
      if (!opaque(k)) errors.push(`input ${inp.id}: CB at (${cx},${cy},${cz}) is exposed on side (${dx},${dy},${dz}) to '${k}'`);
    }
    const ctl = V.get(bx, by, bz);
    const expect = inp.kind === 'lever' ? 'lever_up' : inp.kind === 'plate' ? 'plate' : ['button_up', 'dark_button_up'];
    if (!(Array.isArray(expect) ? expect.includes(ctl) : ctl === expect)) errors.push(`input ${inp.id}: control cell holds '${ctl}'`);
  }

  const report = { errors, warnings, info };
  fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('./out/map_report.json', import.meta.url), JSON.stringify(report, null, 1));
  if (!quiet) {
    console.log(`routes: ${EDGES.length} edges / ${samples} samples; nodes: ${NODES.length}; cameras: ${CAMERAS.length}; inputs: ${INPUTS.length}`);
    console.log(`office cells: ${info.officeCells}; walkable cells from lobby: ${info.walkableCells}`);
    for (const w of warnings) console.log('WARN ', w);
    for (const e of errors) console.log('ERROR', e);
    console.log(errors.length ? `${errors.length} errors` : 'map OK');
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = validateMap();
  process.exit(r.errors.length ? 1 : 0);
}
