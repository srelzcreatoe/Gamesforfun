// Route guidance (green breadcrumb sparkles): the generated walkable graph and
// the runtime route queries, checked against the voxel model of the build plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateGuide } from '../tools/gen_guide.mjs';
import { GuideGraph } from '../packs/FredbearBP/scripts/core/guide_path.js';
import { GUIDE_NODES, GUIDE_EDGES, GUIDE_TARGETS } from '../packs/FredbearBP/scripts/data/guide_graph.generated.js';
import { ANCHORS } from '../packs/FredbearBP/scripts/data/layout.js';
import { INPUTS } from '../packs/FredbearBP/scripts/data/inputs.js';
import { MAINTENANCE, TASKS } from '../packs/FredbearBP/scripts/data/story.js';

const G = generateGuide();
const guide = new GuideGraph();
const walkableNear = (p) => {
  for (const dy of [0, -1, 1]) {
    for (const dx of [0, -1, 1]) for (const dz of [0, -1, 1]) if (G.reach.has(`${Math.floor(p.x) + dx},${Math.floor(p.y) + dy},${Math.floor(p.z) + dz}`)) return true;
  }
  return false;
};
const targetOf = (action) => INPUTS.find((i) => i.action === action).id;

/** Follow the route from `pos` to the target the way the game does, re-querying as the player moves. */
function walkRoute(pos, target, maxSteps = 400) {
  let p = { ...pos };
  const visited = [p];
  for (let i = 0; i < maxSteps; i++) {
    const r = guide.route(p, target, 3);
    assert.ok(r, `route to ${target} from ${JSON.stringify(p)}`);
    if (r.arrived) return visited;
    p = r.points[Math.min(2, r.points.length - 1)];
    visited.push(p);
  }
  assert.fail(`did not arrive at ${target} from ${JSON.stringify(pos)}`);
}

test('the generated guide graph is up to date with the build plan', () => {
  assert.equal(G.unreachable.length, 0, `unreachable targets: ${G.unreachable}`);
  assert.equal(G.missingTargets.length, 0, `no standing spot: ${G.missingTargets}`);
  assert.deepEqual(GUIDE_NODES, G.nodes.flatMap((n) => [n.x, n.y, n.z, n.room === null ? -1 : GUIDE_NODES[G.nodes.indexOf(n) * 4 + 3]]), 'node list changed: run node tools/gen_guide.mjs');
  assert.deepEqual(GUIDE_EDGES, G.edges.flat(), 'edge list changed: run node tools/gen_guide.mjs');
  assert.deepEqual(GUIDE_TARGETS, G.targets);
  assert.ok(fs.statSync(new URL('../packs/FredbearBP/scripts/data/guide_graph.generated.js', import.meta.url)).size < 100_000);
});

test('every guide edge is a straight line a player can walk both ways', () => {
  for (let i = 0; i < GUIDE_EDGES.length; i += 3) {
    const a = G.nodes[GUIDE_EDGES[i]];
    const b = G.nodes[GUIDE_EDGES[i + 1]];
    const ladder = a.tag.startsWith('ladder:') && b.tag.startsWith('ladder:') && a.x === b.x && a.z === b.z;
    if (ladder) continue;
    assert.ok(G.lineWalk(a, b) >= 0 && G.lineWalk(b, a) >= 0, `edge ${a.tag} -> ${b.tag}`);
  }
});

test('routes reach the office, the basement generator, electrical and every pre-shift task', () => {
  const lobby = { x: ANCHORS.lobbySpawn.x, y: ANCHORS.lobbySpawn.y, z: ANCHORS.lobbySpawn.z };
  const office = { x: ANCHORS.officeSeat.x, y: ANCHORS.officeSeat.y, z: ANCHORS.officeSeat.z };
  const trips = [
    [lobby, 'anchor:officeSeat'],
    [office, targetOf(MAINTENANCE.generator.action)],
    [office, targetOf(MAINTENANCE.electrical.action)],
    ...Object.values(TASKS).map((t) => [lobby, targetOf(t.action)]),
    ...Object.values(TASKS).map((t) => [guide.node(GUIDE_TARGETS[targetOf(t.action)]), 'anchor:officeSeat']),
  ];
  for (const [from, target] of trips) {
    const path = walkRoute(from, target);
    for (const p of path) assert.ok(walkableNear(p), `route to ${target} leaves the walkable floor at ${JSON.stringify(p)}`);
  }
});

test('the generator route goes down the stairs into the basement (night 3 maintenance)', () => {
  const office = { x: ANCHORS.officeSeat.x, y: ANCHORS.officeSeat.y, z: ANCHORS.officeSeat.z };
  const path = walkRoute(office, targetOf(MAINTENANCE.generator.action));
  assert.ok(path.some((p) => p.y <= -8), 'reaches the basement level');
  const goal = guide.node(GUIDE_TARGETS[targetOf(MAINTENANCE.generator.action)]);
  assert.ok(goal.y <= -8, 'the generator lever is in the basement');
  const steps = guide.field(targetOf(MAINTENANCE.generator.action)).dist[guide.entry(office, guide.field(targetOf(MAINTENANCE.generator.action)))];
  assert.ok(steps < 260, `route length ${steps} blocks`);
});

test('breadcrumbs start next to the player and sit over walkable floor', () => {
  const office = { x: ANCHORS.officeSeat.x, y: ANCHORS.officeSeat.y, z: ANCHORS.officeSeat.z };
  for (const target of ['anchor:lobbySpawn', targetOf('maint:generator'), targetOf('maint:records_key')]) {
    const r = guide.route(office, target);
    const crumbs = GuideGraph.crumbs(r.points);
    assert.ok(crumbs.length >= 5, `${target}: ${crumbs.length} crumbs`);
    assert.ok(Math.hypot(crumbs[0].x - office.x, crumbs[0].z - office.z) < 2.5, 'first crumb next to the player');
    for (const c of crumbs) assert.ok(walkableNear(c), `${target}: crumb over a wall/void at ${JSON.stringify(c)}`);
  }
});
