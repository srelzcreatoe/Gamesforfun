// Work per tick, counted as calls into the engine (block reads, entity queries, ray casts) while the
// script runs each situation in the simulated world.  These are counts, not timings: the game's script
// engine is not this one, so time measured here would say nothing about a phone.
//   node test/perf.mjs            (after `node tools/bundle.mjs`)
import fs from 'node:fs';
import path from 'node:path';
import { Sim, UI } from './mock.mjs';
import { TERRAINS } from '../tools/preview/scenes/terrain.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CODE = fs.readFileSync(path.join(ROOT, 'build/test-bundle.js'), 'utf8');
const TYPE = 'basiliskra:basiliskra', OW = 'minecraft:overworld';
const rows = [];

function world(terrain) {
  const sim = new Sim();
  if (terrain) sim.terrainFn = TERRAINS[terrain];
  globalThis.__MC__ = sim.api; globalThis.__MC_UI__ = UI; delete globalThis.__BK__; new Function(CODE)(); const bk = globalThis.__BK__;
  sim.startup(); sim.ev.worldLoad.fire({}); sim.flush();
  return { sim, bk };
}
function stand(w, form, at, yaw, extra = {}) {
  const rec = w.bk.store.rec;
  Object.assign(rec, { stage: 'alive', token: 'perftoken00000000000000000000000', form, born: 1, rift: { x: 0.5, y: 57.5, z: 60.5, yaw: 0 }, origin: { x: 0, y: 64, z: 12 }, ...extra });
  rec.mut.formSince = rec.clock;
  const r = w.sim.newRecord(TYPE, OW, at, yaw);
  r.dyn['bk:token'] = rec.token; rec.entityId = r.id; w.bk.store.save();
  w.sim.attach(r, 'entityLoad'); w.sim.flush(); w.sim.step(3);
  return w.bk.ctl.creature;
}
function measure(name, w, ticks, each) {
  let sum = { blocks: 0, queries: 0, rays: 0 }, max = { blocks: 0, queries: 0, rays: 0 }, acts = {};
  for (let i = 0; i < ticks; i++) {
    w.sim.work = { blocks: 0, queries: 0, rays: 0 };
    if (each) each(i);
    w.sim.step(1);
    for (const k of Object.keys(sum)) { sum[k] += w.sim.work[k]; max[k] = Math.max(max[k], w.sim.work[k]); }
    const a = w.bk.ctl.brain?.actName ?? '-'; acts[a] = (acts[a] || 0) + 1;
  }
  rows.push({ name, ticks, avgBlocks: +(sum.blocks / ticks).toFixed(0), maxBlocks: max.blocks, avgQueries: +(sum.queries / ticks).toFixed(2), maxQueries: max.queries, maxRays: max.rays, acts: Object.entries(acts).map(([k, v]) => `${k} ${Math.round(100 * v / ticks)}%`).join(', ') });
}

{ // nothing owed to the world yet
  const w = world(); w.sim.addPlayer('Ana', { x: 0, y: 64, z: 12 });
  measure('dormant world, one player', w, 1200);
}
{ // a call searching for water
  const w = world(); const a = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 12 });
  w.bk.ctl.requestArrival({ region: 'r', site: { x: 0, y: 64, z: 12 }, guilty: a.id, guiltyName: 'Ana' });
  measure('pending: searching for water', w, 400);
  w.sim.save.timeOfDay = 12000;
  measure('arrival (seam, emergence, three rams)', w, 1100);
  measure('Form I, a player on the shore (survival)', w, 4000);
}
{
  const w = world(); const a = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 12 });
  stand(w, 1, { x: 0, y: 56, z: 60 }, 0);
  a.mode = 'Creative';
  measure('Form I, nobody to hunt (patrol, sleep)', w, 4000);
}
{
  const w = world('village'); const a = w.sim.addPlayer('Ana', { x: 20, y: 64, z: -30 });
  stand(w, 2, { x: 50, y: 64, z: -20 }, 90);
  measure('Form II in a village, a player in the open', w, 4000);
}
{
  const w = world('village'); const a = w.sim.addPlayer('Ana', { x: 20, y: 64, z: -30 });
  stand(w, 3, { x: 70, y: 64, z: -20 }, 90, {});
  w.bk.store.rec.mut.beams = 6;
  measure('Form III in a village, a player in the open (beams, pursuit)', w, 6000);
}
{
  const w = world('village'); const a = w.sim.addPlayer('Ana', { x: 0.5, y: 64, z: 0.5 });
  w.sim.save.timeOfDay = 15000;
  stand(w, 3, { x: 68, y: 64, z: 6 }, 90);
  measure('Form III, a player indoors at night (the window)', w, 1600);
}
{
  const w = world(); const a = w.sim.addPlayer('Ana', { x: 6, y: 64, z: 14 }); a.mode = 'Creative';
  a.hand = { typeId: 'basiliskra:shed_fin' };
  stand(w, 3, { x: 30, y: 64, z: -30 }, 0, { rift: { x: 6.5, y: 57.5, z: 26.5, yaw: 270 } });
  const note = { x: 8, y: 64, z: 16 };
  measure('Form III, the last crossing being called (note rhythm held)', w, 3000, (i) => { if (i % 18 === 0) w.bk.ctl.ending.onNote(note); });
}
{
  const w = world('village'); const a = w.sim.addPlayer('Ana', { x: 20, y: 64, z: -30 });
  stand(w, 4, { x: 70, y: 64, z: -20 }, 90, {});
  w.bk.store.rec.four = { debut: true, shots: 3, plate: null };
  measure('Form IV in a village, a player in the open (breath, craters, ploughing)', w, 6000);
}
{ // two Titans at each other, watched from every side (Creative): beams, blows, sixty hit volumes each
  const w = world();
  for (const [x, z] of [[0, 70], [0, -70], [120, 0], [-120, 0]]) { const q = w.sim.addPlayer(`Eye${x}_${z}`, { x, y: 64, z }); q.mode = 'Creative'; }
  const dim = w.sim.api.world.getDimension(OW);
  w.bk.titan.titans.spawn(dim, { x: 0, y: 64, z: -60 }, 0);
  w.bk.titan.titans.spawn(dim, { x: 0, y: 64, z: 60 }, 180);
  measure('two Titans fighting (no Basiliskra): breath, blows, a hundred and twenty hit volumes', w, 2400);
}

{ // six strong fallout zones round a player, nobody else about: the land changing
  const w = world(); const a = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 0 }); a.mode = 'Creative';
  for (let i = 0; i < 6; i++) w.bk.fallout.addFallout({ x: Math.cos(i) * 30, y: 63, z: Math.sin(i) * 30 }, 5, 1.2);
  measure('six strong fallout zones round a player (land changing)', w, 1200);
}
{ // the cap: thirty-two zones near a player
  const w = world(); const a = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 0 }); a.mode = 'Creative';
  for (let i = 0; i < 40; i++) w.bk.fallout.addFallout({ x: (i % 8) * 20 - 70, y: 63, z: Math.floor(i / 8) * 20 - 40 }, 5, 1.2);
  measure('fallout at its cap of 32 zones round a player', w, 1200);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('situation', 62) + pad('blocks/tick avg', 17) + pad('max', 8) + pad('queries avg', 13) + pad('max', 6) + 'rays max');
for (const r of rows) console.log(pad(r.name, 62) + pad(r.avgBlocks, 17) + pad(r.maxBlocks, 8) + pad(r.avgQueries, 13) + pad(r.maxQueries, 6) + r.maxRays + `    [${r.acts}]`);
fs.writeFileSync(path.join(ROOT, 'build/perf.json'), JSON.stringify(rows, null, 1));
