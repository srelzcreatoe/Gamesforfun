// Generates the player route-guidance graph used by the in-game breadcrumbs
// (scripts/data/guide_graph.generated.js).
//
// Nodes: a grid of standing points in every room (every 5 blocks), both sides
// of every doorway, approach / middle / landing of every stairway, both ends of
// the ladder, the anchors and a standing point next to every physical control.
// Edges: two nodes are connected only if a player can walk the straight line
// between them cell by cell under the same rules the map validator uses (steps
// up 1 with headroom, drops up to 3, no squeezing past wall corners), or by
// climbing the ladder. Everything is computed from the voxel model of the
// build plan, so the graph always matches the built map.
//
//   node tools/gen_guide.mjs        (also checked by tests/guide.test.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { buildVoxel, canStand, walkNeighbours } from './voxel.mjs';
import { ROOMS, OPENINGS, STAIRS, ANCHORS, LEVELS, interior, roomAt } from '../packs/FredbearBP/scripts/data/layout.js';
import { INPUTS, inputControlPos } from '../packs/FredbearBP/scripts/data/inputs.js';

const ROOT = new URL('../', import.meta.url).pathname;
const GRID = 6;
const OUTDOOR_GRID = 9;
const MAX_EDGE = 13;
// Targets the game guides players to (the developer panel is teleport-only and the chamber is sealed).
const OPTIONAL_TARGET = (id) => id.startsWith('in.dev.') || id === 'in.zone.chamber' || id.startsWith('anchor:controlRoom') || id.startsWith('anchor:endingCam');

export function generateGuide() {
  const V = buildVoxel();
  const key = (x, y, z) => `${x},${y},${z}`;

  // ---------------------------------------------------------------- reachable standing cells
  const start = [Math.floor(ANCHORS.lobbySpawn.x), Math.floor(ANCHORS.lobbySpawn.y), Math.floor(ANCHORS.lobbySpawn.z)];
  const reach = new Set();
  const q = [start];
  while (q.length) {
    const [x, y, z] = q.pop();
    const k = key(x, y, z);
    if (reach.has(k)) continue;
    if (!reach.size && !canStand(V, x, y, z)) throw new Error('lobby spawn is not standable');
    reach.add(k);
    for (const n of walkNeighbours(V, x, y, z)) if (!reach.has(key(...n))) q.push(n);
  }
  const standable = (x, y, z) => reach.has(key(x, y, z)) && canStand(V, x, y, z);
  const byXZ = new Map();
  for (const k of reach) {
    const [x, y, z] = k.split(',').map(Number);
    if (!canStand(V, x, y, z)) continue;
    const xz = `${x},${z}`;
    if (!byXZ.has(xz)) byXZ.set(xz, []);
    byXZ.get(xz).push(y);
  }

  /** Nearest standable cell to (x, z) within `radius`, preferring y close to yHint. */
  const snap = (x, z, yHint, radius = 2, inside = null) => {
    let best = null;
    for (let r = 0; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = x + dx;
          const cz = z + dz;
          if (inside && !(cx >= inside.x1 && cx <= inside.x2 && cz >= inside.z1 && cz <= inside.z2)) continue;
          for (const y of byXZ.get(`${cx},${cz}`) ?? []) {
            if (Math.abs(y - yHint) > 2) continue;
            const score = Math.abs(dx) + Math.abs(dz) + Math.abs(y - yHint) * 2;
            if (!best || score < best.score) best = { x: cx, y, z: cz, score };
          }
        }
      }
      if (best) return best;
    }
    return null;
  };

  // ---------------------------------------------------------------- nodes
  const nodes = [];
  const index = new Map();
  const add = (p, tag) => {
    if (!p) return -1;
    const k = key(p.x, p.y, p.z);
    if (index.has(k)) return index.get(k);
    index.set(k, nodes.length);
    nodes.push({ x: p.x, y: p.y, z: p.z, room: roomAt(p.x + 0.5, p.y, p.z + 0.5)?.id ?? null, tag });
    return nodes.length - 1;
  };

  for (const r of ROOMS) {
    const i = interior(r);
    const stands = [LEVELS[r.level].stand];
    if (r.shaftFloorY !== undefined) stands.push(r.shaftFloorY + 1);
    for (const stand of stands) {
      for (let x = i.x1 + 1; x <= i.x2; x += GRID) {
        for (let z = i.z1 + 1; z <= i.z2; z += GRID) add(snap(x, z, stand, 2, i), `room:${r.id}`);
      }
    }
  }
  // Outdoors (parking, plaza, roads): a coarser grid over the whole property at grade.
  for (let x = -6; x <= 205; x += OUTDOOR_GRID) for (let z = -6; z <= 205; z += OUTDOOR_GRID) if (!roomAt(x + 0.5, 0, z + 0.5)) add(snap(x, z, 0, 2), 'outdoors');

  for (const o of OPENINGS) {
    if (!['door', 'arch', 'gate', 'secret'].includes(o.kind)) continue;
    const mid = Math.floor((o.a1 + o.a2) / 2);
    for (const off of [0, -2, 2]) {
      const p = o.axis === 'x' ? snap(o.c + off, mid, o.y1, 1) : snap(mid, o.c + off, o.y1, 1);
      add(p, `door:${o.id}`);
    }
  }

  const ladders = [];
  for (const s of STAIRS) {
    if (s.kind === 'stairs') {
      const up = s.toStand > s.fromStand;
      const n = Math.abs(s.toStand - s.fromStand);
      const steps = up ? n : n - 1;
      const dx = s.dir === '+x' ? 1 : s.dir === '-x' ? -1 : 0;
      const dz = s.dir === '+z' ? 1 : s.dir === '-z' ? -1 : 0;
      const w = Math.floor(s.width / 2);
      const pos = (k) => [s.x + dx * k + (dz !== 0 ? w : 0), s.z + dz * k + (dx !== 0 ? w : 0)];
      const standAt = (k) => (up ? s.fromStand + k + 1 : s.fromStand - 1 - k);
      const pts = [[-2, s.fromStand], [-1, s.fromStand], [Math.floor(steps / 2), standAt(Math.floor(steps / 2))], [steps, s.toStand], [steps + 1, s.toStand], [steps + 2, s.toStand]];
      for (const [k, stand] of pts) {
        const [x, z] = pos(k);
        add(snap(x, z, stand, 1), `stairs:${s.id}`);
      }
    } else if (s.kind === 'ladder') {
      const col = [];
      for (let y = s.fromStand; y <= s.toStand + 1; y++) if (reach.has(key(s.x, y, s.z))) col.push(y);
      const bottom = add(snap(s.x, s.z, s.fromStand, 1), `ladder:${s.id}`);
      const top = add(snap(s.x, s.z, s.toStand, 2), `ladder:${s.id}`);
      if (bottom >= 0 && top >= 0) ladders.push([bottom, top, col]);
    }
  }

  const targets = {};
  for (const [name, a] of Object.entries(ANCHORS)) {
    const p = snap(Math.floor(a.x), Math.floor(a.z), Math.floor(a.y), 3);
    if (p) targets[`anchor:${name}`] = add(p, `anchor:${name}`);
  }
  for (const inp of INPUTS) {
    const [cx, cy, cz] = inputControlPos(inp);
    const p = snap(cx, cz, inp.kind === 'plate' ? cy : cy - 1, 3);
    if (p) targets[inp.id] = add(p, `input:${inp.id}`);
  }

  // ---------------------------------------------------------------- edges
  const stepTo = (c, nx, nz) => {
    for (const n of walkNeighbours(V, c[0], c[1], c[2])) if (n[0] === nx && n[2] === nz) return n;
    return null;
  };
  /** Walk the straight line a -> b cell by cell. Returns the step count or -1. */
  const lineWalk = (a, b) => {
    let c = [a.x, a.y, a.z];
    let steps = 0;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const n = Math.ceil(Math.hypot(dx, dz) / 0.2);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const nx = Math.floor(a.x + 0.5 + dx * t);
      const nz = Math.floor(a.z + 0.5 + dz * t);
      if (nx === c[0] && nz === c[2]) continue;
      if (nx !== c[0] && nz !== c[2]) {
        // diagonal: both orthogonal neighbours must be walkable (no corner squeezing)
        const viaX = stepTo(c, nx, c[2]);
        const viaZ = stepTo(c, c[0], nz);
        if (!viaX || !viaZ) return -1;
        c = viaX;
        steps++;
      }
      const next = stepTo(c, nx, nz);
      if (!next) return -1;
      steps += 1 + Math.abs(next[1] - c[1]);
      c = next;
    }
    return c[0] === b.x && c[1] === b.y && c[2] === b.z ? steps : -1;
  };

  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) > MAX_EDGE || Math.abs(a.y - b.y) > 10) continue;
      const s1 = lineWalk(a, b);
      if (s1 < 0) continue;
      if (lineWalk(b, a) < 0) continue; // must be walkable both ways (drops are one-way)
      edges.push([i, j, s1]);
    }
  }
  for (const [bottom, top, col] of ladders) edges.push([bottom, top, col.length + 2]);

  // Prune edges that a two-hop detour replaces almost exactly (keeps shortest paths within 5 %).
  const adj = new Map(nodes.map((_, i) => [i, new Map()]));
  for (const [a, b, l] of edges) {
    adj.get(a).set(b, l);
    adj.get(b).set(a, l);
  }
  for (const [a, b, l] of [...edges].sort((x, y) => y[2] - x[2])) {
    if (!adj.get(a).has(b)) continue;
    let redundant = false;
    for (const [c, l1] of adj.get(a)) {
      if (c === b) continue;
      const l2 = adj.get(c).get(b);
      if (l2 !== undefined && l1 + l2 <= l * 1.05) {
        redundant = true;
        break;
      }
    }
    if (redundant) {
      adj.get(a).delete(b);
      adj.get(b).delete(a);
    }
  }
  edges.length = 0;
  for (const [a, m] of adj) for (const [b, l] of m) if (a < b) edges.push([a, b, l]);

  // ---------------------------------------------------------------- connectivity
  const parent = nodes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const root = find(targets['anchor:lobbySpawn']);
  const unreachable = Object.entries(targets).filter(([t, i]) => find(i) !== root && !OPTIONAL_TARGET(t)).map(([t]) => t);
  const missingTargets = INPUTS.filter((i) => targets[i.id] === undefined && !OPTIONAL_TARGET(i.id)).map((i) => i.id);
  // Drop nodes outside the main component (isolated props pockets etc.).
  const keep = nodes.map((_, i) => find(i) === root);
  const remap = new Map();
  const outNodes = [];
  nodes.forEach((nd, i) => {
    if (keep[i]) {
      remap.set(i, outNodes.length);
      outNodes.push(nd);
    }
  });
  const outEdges = edges.filter(([a, b]) => keep[a] && keep[b]).map(([a, b, l]) => [remap.get(a), remap.get(b), l]);
  const outTargets = Object.fromEntries(Object.entries(targets).filter(([, i]) => keep[i]).map(([t, i]) => [t, remap.get(i)]));
  return { nodes: outNodes, edges: outEdges, targets: outTargets, unreachable, missingTargets, reach, voxel: V, lineWalk };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const g = generateGuide();
  const rooms = [...new Set(g.nodes.map((n) => n.room).filter(Boolean))].sort();
  const roomIdx = new Map(rooms.map((r, i) => [r, i]));
  const js = `// GENERATED by tools/gen_guide.mjs from the build plan's voxel model - do not edit.
// Player route-guidance graph (local coordinates), flat arrays:
// GUIDE_NODES = x, y, z, roomIndex|-1 per node; GUIDE_EDGES = a, b, walkingSteps per edge;
// GUIDE_TARGETS: name -> node index.
export const GUIDE_ROOMS = Object.freeze(${JSON.stringify(rooms)});
export const GUIDE_NODES = Object.freeze(${JSON.stringify(g.nodes.flatMap((n) => [n.x, n.y, n.z, n.room ? roomIdx.get(n.room) : -1]))});
export const GUIDE_EDGES = Object.freeze(${JSON.stringify(g.edges.flat())});
export const GUIDE_TARGETS = Object.freeze(${JSON.stringify(g.targets)});
`;
  fs.writeFileSync(path.join(ROOT, 'packs/FredbearBP/scripts/data/guide_graph.generated.js'), js);
  console.log(`guide graph: ${g.nodes.length} nodes, ${g.edges.length} edges, ${Object.keys(g.targets).length} targets` +
    (g.unreachable.length ? `; UNREACHABLE: ${g.unreachable.join(', ')}` : '') + (g.missingTargets.length ? `; NO STANDING SPOT: ${g.missingTargets.join(', ')}` : ''));
  if (g.unreachable.length || g.missingTargets.length) process.exit(1);
}
