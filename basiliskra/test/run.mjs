// Scenario tests: the behaviour-pack script running against the simulated world in mock.mjs.
//   node test/run.mjs            (after `node tools/bundle.mjs`)
import fs from 'node:fs';
import path from 'node:path';
import { Sim, Save, UI } from './mock.mjs';
import { TERRAINS, PROPS } from '../tools/preview/scenes/terrain.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CODE = fs.readFileSync(path.join(ROOT, 'build/test-bundle.js'), 'utf8');
const TYPE = 'basiliskra:basiliskra';
const P = (n) => 'basiliskra:' + n;

function bootScript(api) {
  globalThis.__MC__ = api;
  globalThis.__MC_UI__ = UI;
  delete globalThis.__BK__;
  new Function(CODE)();
  return globalThis.__BK__;
}
function start(save) {
  const sim = new Sim(save);
  let bk = bootScript(sim.api);
  const w = { sim, get bk() { return bk; }, restart() { sim.restart((api) => { bk = bootScript(api); }); } };
  return w;
}
function open(w) { w.sim.startup(); w.sim.ev.worldLoad.fire({}); w.sim.flush(); }

const results = [];
let failures = 0;
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  if (!cond) failures++;
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  -- ' + detail : ''}`);
}
function until(w, pred, max, every = 1) {
  for (let i = 0; i < max; i += every) { w.sim.step(every); if (pred()) return i + every; }
  return -1;
}

// ---- helpers that play the part of a destructive player -------------------------------------
function kill(w, player, type, at) {
  const dead = { typeId: type, location: at, dimension: { id: 'minecraft:overworld' }, id: 'x' };
  w.sim.ev.entityDie.fire({ deadEntity: dead, damageSource: { cause: 'entityAttack', damagingEntity: player } });
}
function naturalDeath(w, type, at) {
  w.sim.ev.entityDie.fire({ deadEntity: { typeId: type, location: at, dimension: { id: 'minecraft:overworld' }, id: 'x' }, damageSource: { cause: 'fall' } });
}
function chop(w, player, id, at) {
  w.sim.ev.playerBreakBlock.fire({ dimension: { id: 'minecraft:overworld' }, block: { location: at }, brokenBlockPermutation: { type: { id } }, player });
}
function ruin(w, player, at, kills = 14, logs = 40) {
  for (let i = 0; i < kills; i++) kill(w, player, i % 2 ? 'minecraft:sheep' : 'minecraft:cow', { x: at.x + i, y: at.y, z: at.z });
  for (let i = 0; i < logs; i++) chop(w, player, i % 3 ? 'minecraft:oak_log' : 'minecraft:reeds', { x: at.x + (i % 8), y: at.y, z: at.z + 2 });
}
function arriveFully(w, max = 6000) {
  w.sim.save.timeOfDay = 12000;
  return until(w, () => w.bk.store.rec.stage === 'alive', max, 5);
}
const SITE = { x: 0, y: 64, z: 12 };

console.log('\n== 1. What opens the rift');
{
  const w = start(); open(w);
  const a = w.sim.addPlayer('Ana', SITE);
  kill(w, a, 'minecraft:cow', SITE);                      // one meal
  for (let i = 0; i < 6; i++) chop(w, a, 'minecraft:oak_log', SITE);   // one felled tree
  const s1 = w.bk.harm.regionScore(SITE, w.bk.store.rec.clock);
  check('one meal and one felled tree weigh almost nothing', s1.a < 0.5 && s1.h < 1.5 && w.bk.store.rec.stage === 'dormant', `animals ${s1.a.toFixed(2)} habitat ${s1.h.toFixed(2)}`);
  for (let i = 0; i < 40; i++) naturalDeath(w, 'minecraft:cow', SITE);
  const s2 = w.bk.harm.regionScore(SITE, w.bk.store.rec.clock);
  check('naturally caused deaths weigh nothing', Math.abs(s2.a - s1.a) < 1e-9 && w.bk.store.rec.stage === 'dormant');
  ruin(w, a, SITE);
  check('repeated killing together with stripped habitat crosses the threshold', w.bk.store.rec.stage === 'pending');
  const b = w.sim.addPlayer('Late friend', SITE);
  check('a friend who has just joined inherits no blame', w.bk.store.rec.guilty === a.id && !(b.id in w.bk.harm.regionScore(SITE, w.bk.store.rec.clock).by));
  const w2 = start(); open(w2);
  const c = w2.sim.addPlayer('Cy', SITE);
  ruin(w2, c, SITE, 6, 14);
  const before = w2.bk.harm.regionScore(SITE, w2.bk.store.rec.clock);
  w2.bk.store.rec.clock += 24000 * 6;
  const after = w2.bk.harm.regionScore(SITE, w2.bk.store.rec.clock);
  check('an undisturbed region recovers', after.a < before.a * 0.2 && after.h < before.h * 0.2, `animals ${before.a.toFixed(1)} -> ${after.a.toFixed(2)}`);
  for (let i = 0; i < 120; i++) kill(w2, c, 'minecraft:pig', { x: i * 70, y: 64, z: -4000 - i * 70 });
  const regs = Object.keys(w2.bk.store.harm.regions).length;
  const bytes = JSON.stringify(w2.bk.store.harm).length + JSON.stringify(w2.bk.store.rec).length;
  check('the harm history is bounded', regs <= 40 && w2.bk.store.rec.sites.length <= 24 && bytes < 30000, `${regs} regions, ${w2.bk.store.rec.sites.length} sites, ${bytes} bytes`);
}

console.log('\n== 2. Simultaneous first-arrival triggers from two players');
let world;
{
  const w = world = start(); open(w);
  const a = w.sim.addPlayer('Ana', SITE);
  const b = w.sim.addPlayer('Ben', { x: 30, y: 64, z: 12 });
  // both cross the threshold inside one tick, in two different regions of the same coast
  ruin(w, a, SITE);
  ruin(w, b, { x: 70, y: 64, z: 10 });
  check('only one request became the pending arrival', w.bk.store.rec.stage === 'pending' && w.bk.store.rec.guilty === a.id);
  check('a duplicate submission is refused', w.bk.ctl.requestArrival({ region: 'again', site: SITE, guilty: b.id, guiltyName: 'Ben' }) === false);
  w.sim.save.timeOfDay = 9000;
  until(w, () => w.bk.store.rec.stage === 'arriving', 400);
  check('the coast was reserved before anything was created', w.bk.store.rec.stage === 'arriving' && w.bk.store.rec.token.length === 32 && w.bk.store.rec.entityId === null && w.sim.count(TYPE) === 0);
  w.sim.step(600);
  check('he waits for dusk and a witness', w.bk.store.rec.arrival.step === 0 && w.sim.count(TYPE) === 0);
  const took = arriveFully(w);
  const rec = w.bk.store.rec;
  check('the arrival runs to the end: seam, crossing, three rams, sinking', took > 0 && rec.stage === 'alive' && rec.rift && rec.born > 0, `${took} ticks`);
  check('exactly one Basiliskra exists', w.sim.count(TYPE) === 1 && w.bk.ctl.creature && w.bk.ctl.creature.entity.id === rec.entityId);
  const e = w.bk.ctl.creature.entity;
  check('he is bound, Form I, fully through the seam, left gill stuck open', e.getProperty(P('bound')) === true && e.getProperty(P('form')) === 1 && e.getProperty(P('vis_lo')) === 0 && e.getProperty(P('gill')) === true);
  check('the three knocks and the rams were heard by the players who were there', a.heard.filter((s) => s.id === 'basiliskra.boat_knock').length === 3 && a.heard.filter((s) => s.id === 'basiliskra.ram').length === 3);
  check('and on the third ram his roar, through the water', a.heard.some((q) => q.id === 'basiliskra.roar_under') && b.heard.some((q) => q.id === 'basiliskra.roar_under'));
  check('hit volumes cover his whole body', w.sim.count('basiliskra:hitbox') === 25, `${w.sim.count('basiliskra:hitbox')} volumes`);
}

console.log('\n== 3. A duplicate, a stray summon and a copied creature');
{
  const w = world, rec = w.bk.store.rec, id = rec.entityId;
  check('a second trigger after arrival is refused', w.bk.ctl.requestArrival({ region: 'x', site: SITE, guilty: null, guiltyName: null }) === false);
  const q0 = w.bk.ctl.quarantined;
  const id0 = w.bk.ctl.creature.entity.id;
  const stray = w.sim.summon(TYPE, 'minecraft:overworld', { x: 5, y: 50, z: 60 });
  w.sim.flush();
  const him = w.bk.ctl.creature;
  check('a spawn egg or /summon while he is about brings HIM there: the extra body is removed before it ticks', !stray.attached && stray.rec.props[P('bound')] === false
    && w.sim.count(TYPE) === 1 && him.entity.id === id0 && Math.hypot(him.pos.x - 5, him.pos.z - 60) < 0.5, `he is at ${him.pos.x.toFixed(1)}, ${him.pos.z.toFixed(1)}`);
  const copy = w.sim.copyEntity(w.bk.ctl.creature.entity);
  w.sim.flush();
  check('a copied creature (same token, new id) is quarantined', !copy.attached && w.sim.count(TYPE) === 1 && w.bk.ctl.quarantined === q0 + 2);
  const nether = w.sim.summon(TYPE, 'minecraft:nether', { x: 0, y: 40, z: 0 });
  const walker = w.sim.addPlayer('Nell', { x: 0, y: 40, z: 0 }, 'minecraft:nether');
  w.sim.step(25);
  check('the same reservation covers every dimension', !nether.attached && w.sim.count(TYPE) === 1);
  walker.online = false;
  check('the original identity survives', w.bk.ctl.creature && w.bk.ctl.creature.entity.id === id && rec.entityId === id);
  const hp = w.bk.ctl.creature.entity.rec.health;
  const part = [...w.sim.loaded.values()].find((x) => x.typeId.startsWith('basiliskra:hitbox'));
  part.applyDamage(20, { cause: 'entityAttack', damagingEntity: w.sim.players[0] });
  w.sim.step(2);
  check('a hit on any part of his body is a hit on him', w.bk.ctl.creature.entity.rec.health < hp && part.rec.health === 1000, `${hp} -> ${w.bk.ctl.creature.entity.rec.health}`);
  const fell = w.bk.ctl.creature.entity.applyDamage(50, { cause: 'fall' });
  check('the world itself (falls, lava, suffocation) does not hurt him', fell === false);
  // one blast that reaches several hit volumes at once is one blow, not eight
  const hp2 = w.bk.ctl.creature.entity.rec.health;
  for (const h of [...w.sim.loaded.values()].filter((x) => x.typeId.startsWith('basiliskra:hitbox'))) h.applyDamage(10, { cause: 'entityExplosion' });
  w.sim.step(2);
  const lost = hp2 - w.bk.ctl.creature.entity.rec.health;
  check('a blast that touches every hit volume counts once', lost > 0 && lost <= 12.5, `lost ${lost}`);
  // worn down to nothing he is not killed: he is driven off, and owed back
  const token = rec.token, form = rec.form;
  w.bk.ctl.creature.entity.applyDamage(100000, { cause: 'entityAttack', damagingEntity: w.sim.players[0] });
  w.sim.step(3);
  check('worn down to his last breath he is driven off, not killed', w.sim.count(TYPE) === 0 && w.sim.count('basiliskra:hitbox') === 0 && rec.stage === 'alive' && rec.entityId === null && rec.down !== null && w.bk.ctl.creature === null);
  w.sim.step(600);
  check('nothing takes his place while he is away', w.sim.count(TYPE) === 0);
  rec.clock += 24000;                                                // a day later, with someone at the coast
  until(w, () => w.sim.count(TYPE) === 1 && w.bk.ctl.creature, 400);
  const back = w.bk.ctl.creature?.entity;
  check('a day later the same animal comes back through the seam, whole', !!back && rec.token === token && rec.form === form && back.rec.dyn['bk:token'] === token && rec.entityId === back.id && back.rec.health === 600 && w.sim.count(TYPE) === 1);
}

console.log('\n== 4. An interrupted arrival');
{
  const w = start(); open(w);
  const a = w.sim.addPlayer('Ana', SITE);
  ruin(w, a, SITE);
  w.sim.save.timeOfDay = 12000;
  until(w, () => w.bk.store.rec.arrival && w.bk.store.rec.arrival.step === 3, 2000);
  // the instant before creation: keep a copy of the saved record, as a crash would leave it
  const saved = new Map(w.sim.save.worldProps);
  until(w, () => w.sim.count(TYPE) === 1, 100);
  const id = [...w.sim.save.entities.values()].find((r) => r.typeId === TYPE).id;
  w.sim.save.worldProps = saved;                       // the entity was saved, the record naming it was not
  w.restart();
  w.sim.step(60);
  check('after the crash the saved reservation and the entity are reconciled, not recreated', w.sim.count(TYPE) === 1 && w.bk.store.rec.entityId === id && w.bk.ctl.creature?.entity.id === id);
  arriveFully(w, 3000);
  check('the resumed arrival finishes with the same single animal', w.bk.store.rec.stage === 'alive' && w.sim.count(TYPE) === 1 && w.bk.store.rec.entityId === id);
  // the other half: reserved and saved, but the world closed before the entity existed
  const w2 = start(); open(w2);
  const b = w2.sim.addPlayer('Ben', SITE);
  ruin(w2, b, SITE);
  w2.sim.save.timeOfDay = 12000;
  until(w2, () => w2.bk.store.rec.arrival && w2.bk.store.rec.arrival.step === 3, 2000);
  w2.restart();
  check('a reservation with no entity yet survives a restart', w2.bk.store.rec.stage === 'arriving' && w2.sim.count(TYPE) === 0);
  arriveFully(w2, 4000);
  check('and creation is attempted exactly once more', w2.bk.store.rec.stage === 'alive' && w2.sim.count(TYPE) === 1);
}

console.log('\n== 5. Returning to an unloaded coast after the Nether');
{
  const w = world, id = w.bk.store.rec.entityId;
  const a = w.sim.players.find((p) => p.name === 'Ana'), b = w.sim.players.find((p) => p.name === 'Ben');
  a.moveTo({ x: 0, y: 40, z: 0 }, 'minecraft:nether'); b.moveTo({ x: 4, y: 40, z: 0 }, 'minecraft:nether');
  w.sim.step(40);
  check('his chunk unloads with him in it; an empty query is not a reason to make another', w.bk.ctl.creature === null && w.sim.loaded.get(id) === undefined && w.sim.count(TYPE) === 1 && w.bk.store.rec.entityId === id && w.bk.store.rec.stage === 'alive');
  check('his hit volumes do not outlive his unloading', w.sim.count('basiliskra:hitbox') === 0);
  w.sim.step(3000);
  check('nothing is created while the coast is unloaded', w.sim.count(TYPE) === 1 && w.bk.store.rec.last !== null);
  a.moveTo(SITE, 'minecraft:overworld'); b.moveTo({ x: 30, y: 64, z: 12 }, 'minecraft:overworld');
  w.sim.step(30);
  check('coming back finds the same animal', w.bk.ctl.creature?.entity.id === id && w.sim.count(TYPE) === 1);
}

console.log('\n== 6. Evolution during a save and reload');
{
  const w = world, rec = () => w.bk.store.rec;
  const id = rec().entityId;
  w.bk.ctl.creature.entity.rec.health = 437;
  Object.assign(rec().mut, { surfacings: 9, episodes: 4, formSince: -1e7 });
  w.sim.save.timeOfDay = 1000;                           // morning: if he was asleep at the seam, he wakes
  const t = until(w, () => rec().evolve !== null, 9000, 5);
  check('repeated surfacings and mutation episodes send him to a shelf to beach', t > 0 && rec().evolve?.to === 2, `${t} ticks`);
  w.sim.step(30 + 36);                                   // (after the scene's establishing shot)
  check('it has begun: his gills are knocking', rec().evolve?.step === 0 && w.bk.ctl.creature.entity.getProperty(P('phase')) === 4);
  w.restart();                                           // save and reload in the middle of it
  w.sim.step(5);
  check('after the reload it is still the same entity, still mid-evolution', w.bk.ctl.creature?.entity.id === id && rec().evolve !== null && w.sim.count(TYPE) === 1);
  until(w, () => rec().evolve === null, 600);
  const e = w.bk.ctl.creature.entity;
  check('he finishes as Form II in place, and is called Basiliskra II', rec().form === 2 && e.id === id && e.getProperty(P('form')) === 2 && e.rec.events.includes('basiliskra:bind_2') && e.nameTag === 'Basiliskra II', `name ${e.nameTag}`);
  check('health and ownership survived the evolution', Math.abs(e.rec.health - 437) < 1e-6 && rec().entityId === id && e.rec.dyn['bk:token'] === rec().token);
  check('a shed fin lies where he struggled', [...w.sim.save.entities.values()].some((r) => r.item?.typeId === 'basiliskra:shed_fin') && rec().beach !== null);
  // the worst moment: the record already says Form III, the entity has not been touched yet
  Object.assign(rec().mut, { overland: 5000, formSince: -1e7 });
  w.sim.save.timeOfDay = 15000;
  until(w, () => rec().evolve?.step === 1, 4000);
  check('the record changes before the entity does', rec().form === 3 && w.bk.ctl.creature.entity.getProperty(P('form')) === 2);
  w.bk.store.save();
  w.restart();
  w.sim.step(3);
  check('a reload between the two writes brings the entity into line with the record', w.bk.ctl.creature?.entity.id === id && w.bk.ctl.creature.entity.getProperty(P('form')) === 3 && w.sim.count(TYPE) === 1);
  until(w, () => rec().evolve === null, 600);
  check('Form III, the same individual', rec().form === 3 && rec().entityId === id && w.bk.ctl.creature.form === 3 && w.sim.count('basiliskra:hitbox') === 29, `${w.sim.count('basiliskra:hitbox')} hit volumes`);
  {
    const ana3 = w.sim.players.find((p) => p.online);
    const h3 = ana3.heard.length; let posed = false;
    for (let i = 0; i < 60; i++) { w.sim.step(1); if (w.bk.ctl.creature.entity.getProperty(P('phase')) === 23) posed = true; }
    check('standing up as Basiliskra III he roars: the whole roar, head up', posed && ana3.heard.slice(h3 - 8).some((q) => q.id === 'basiliskra.roar'), ana3.heard.slice(h3 - 8, h3 + 4).map((q) => q.id).join(','));
  }
}

console.log('\n== 7. A player joining during a beam charge');
{
  const w = world, c = () => w.bk.ctl.creature, e = () => c().entity;
  const ana = w.sim.players.find((p) => p.name === 'Ana'), ben = w.sim.players.find((p) => p.name === 'Ben');
  w.sim.save.timeOfDay = 3000;
  ben.online = false;
  const stand = () => { const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) }; const x = c().pos.x + f.x * 54, z = c().pos.z + f.z * 54; let y = 90; while (y > 40 && w.sim.blockId('minecraft:overworld', x, y - 1, z) === 'minecraft:air') y--; return { x, y: Math.max(y, 63), z }; };      // on the ground (or the water) in front of him
  w.bk.ctl.brain.finish();
  ana.moveTo(stand());
  const t = until(w, () => { if (c().phase !== 'charge' && c().phase !== 'fire') ana.moveTo(stand()); return e().getProperty(P('phase')) === 18 && e().getProperty(P('charge')) >= 6; }, 3000);
  check('he plants the club and the ridge begins to light, tail first', t > 0, `charge ${e().getProperty(P('charge'))}`);
  const late = w.sim.addPlayer('Late joiner', { x: ana.loc.x + 3, y: ana.loc.y, z: ana.loc.z + 3 });
  const seen = { form: e().getProperty(P('form')), phase: e().getProperty(P('phase')), charge: e().getProperty(P('charge')), bound: e().getProperty(P('bound')) };
  check('the late joiner reads the same form and attack phase from the entity itself', seen.form === 3 && seen.phase === 18 && seen.charge >= 6 && seen.bound === true, JSON.stringify(seen));
  const locked = { x: ana.loc.x, y: ana.loc.y, z: ana.loc.z };
  until(w, () => e().getProperty(P('charge')) >= 16, 400);
  // the eye has stopped following: one player steps sideways out of the line, the other stays put
  const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) };
  ana.moveTo({ x: locked.x + f.z * 9, y: locked.y, z: locked.z - f.x * 9 });
  late.moveTo(locked);
  const hpA = ana.health, hpL = late.health;
  until(w, () => e().getProperty(P('phase')) === 19, 200);
  check('he fires: phase and full charge are on the entity for everyone', e().getProperty(P('charge')) === 20 && e().getProperty(P('tier')) === 1);
  until(w, () => e().getProperty(P('phase')) !== 19, 400);
  check('the player who stepped sideways in the window is missed', ana.health === hpA, `${hpA} -> ${ana.health}`);
  check('the player standing in the locked line is hit', late.health < hpL, `${hpL} -> ${late.health}`);
  check('beam particles and sound reached the late joiner too', late.seen.some((s) => s.id === 'basiliskra:beam_core') && late.heard.some((s) => s.id === 'basiliskra.iii.beam'));
  const core = late.seen.find((s) => s.id === 'basiliskra:beam_core');
  check('the drawn beam carries the length the server measured', core && core.vars['variable.len'] > 1 && core.vars['variable.len'] <= 40);
  until(w, () => e().getProperty(P('phase')) === 20, 100);
  const k0 = ana.heard.filter((s) => s.id === 'basiliskra.knock.vent').length;
  until(w, () => e().getProperty(P('charge')) === 0, 200);
  check('the heat leaves by the old gills with the same three knocks', ana.heard.filter((s) => s.id === 'basiliskra.knock.vent').length - k0 >= 2 && w.bk.store.rec.mut.beams === 1);
  late.online = false; ben.online = true;
}

console.log('\n== 8. Grounding the charge');
{
  const w = world, c = () => w.bk.ctl.creature, e = () => c().entity;
  const ana = w.sim.players.find((p) => p.name === 'Ana');
  const beams = w.bk.store.rec.mut.beams;
  w.bk.ctl.brain.finish();
  const stand = () => { const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) }; const x = c().pos.x + f.x * 54, z = c().pos.z + f.z * 54; let y = 90; while (y > 40 && w.sim.blockId('minecraft:overworld', x, y - 1, z) === 'minecraft:air') y--; return { x, y: Math.max(y, 63), z }; };      // on the ground (or the water) in front of him
  let rod = null;
  const t = until(w, () => {
    if (e().getProperty(P('phase')) === 21) return true;
    if (c().phase !== 'charge') { ana.moveTo(stand()); return false; }
    if (!rod) { const k = c().anchor('club_core'); rod = { x: Math.floor(k.x) + 4, y: Math.floor(c().pos.y), z: Math.floor(k.z) }; w.sim.setBlock('minecraft:overworld', rod.x, rod.y, rod.z, 'minecraft:waxed_weathered_lightning_rod'); }      // weathered and waxed: still a rod
    return e().getProperty(P('phase')) === 21;
  }, 4000);
  check('a copper lightning rod near the club takes the discharge', t > 0 && w.bk.ctl.brain.groundedAt !== null);
  until(w, () => e().getProperty(P('charge')) === 0, 200);
  check('the light on his back collapses, the throat goes dark, and nothing is fired', e().getProperty(P('charge')) === 0 && w.bk.store.rec.mut.beams === beams && ana.heard.some((s) => s.id === 'basiliskra.iii.ground'));
  check('the arc is particles, not real lightning', ana.seen.some((s) => s.id === 'basiliskra:arc_seg') && ![...w.sim.save.entities.values()].some((r) => r.typeId === 'minecraft:lightning_bolt'));
  {
    const h8 = ana.heard.length; let posed = false;
    for (let i = 0; i < 140; i++) { w.sim.step(1); if (e().getProperty(P('phase')) === 23) posed = true; }
    check('robbed of the charge, he roars', posed && ana.heard.slice(h8 - 2).some((q) => q.id === 'basiliskra.roar_short'));
  }
  w.sim.setBlock('minecraft:overworld', rod.x, rod.y, rod.z, 'minecraft:air');
}

console.log('\n== 9. The last crossing, and a rift that stays quiet');
{
  const w = world, rec = () => w.bk.store.rec, c = () => w.bk.ctl.creature;
  const ana = w.sim.players.find((p) => p.name === 'Ana'), ben = w.sim.players.find((p) => p.name === 'Ben');
  const rift = rec().rift, id = rec().entityId;
  ana.mode = 'Creative'; ben.mode = 'Creative';               // observers for this part: nothing for him to hunt
  ana.hand = { typeId: 'basiliskra:shed_fin' };
  ana.moveTo({ x: rift.x + 200, y: 64, z: rift.z });
  const h0 = ana.heard.length; w.sim.step(300);
  const far = ana.heard.slice(h0).filter((s) => s.id === 'basiliskra.fin_pulse').length;
  ana.moveTo({ x: rift.x, y: 64, z: rift.z });
  const h1 = ana.heard.length; w.sim.step(300);
  const close = ana.heard.slice(h1).filter((s) => s.id === 'basiliskra.fin_pulse').length;
  check('the shed fin pulses faster near the original seam', close > far * 3 && far > 0, `${far} pulses far away, ${close} at the seam`);
  check('the seam teaches the rhythm with visible pulses', ana.seen.some((s) => s.id === 'basiliskra:seam_pulse'));
  // a repeater loop playing his three knocks, over and over
  let playing = true, rodSet = null;
  const note = { x: rift.x + 2, y: rift.y + 6, z: rift.z };
  const tickNotes = () => { if (playing && w.sim.save.tick % 18 === 0) w.bk.ctl.ending.onNote(note); };
  const run = (pred, max) => { for (let i = 0; i < max; i++) { tickNotes(); w.sim.step(1); if (pred()) return i; } return -1; };
  // (fixture) the hunt above led him far inland: stand him back on the shore by the seam
  const last = rec().last;
  ana.moveTo({ x: last.x + 20, y: 64, z: last.z });
  w.sim.step(40);
  c().pos = { x: 128, y: 64, z: rift.z }; c().entity.teleport(c().pos);
  ana.moveTo({ x: 150, y: 64, z: rift.z });
  ben.moveTo({ x: rift.x + 60, y: 64, z: rift.z });
  w.sim.step(40);
  // first attempt: the rhythm stops while he is part-way through
  const place = () => {
    if (c() && c().phase === 'charge' && !rodSet) { const k = c().anchor('club_core'); rodSet = { x: Math.floor(k.x) + 3, y: Math.floor(c().pos.y), z: Math.floor(k.z) + 1 }; w.sim.setBlock('minecraft:overworld', rodSet.x, rodSet.y, rodSet.z, 'minecraft:lightning_rod'); }
    ana.moveTo({ x: c() ? c().pos.x + 20 : ana.loc.x, y: 64, z: c() ? c().pos.z : ana.loc.z });
  };
  let t = run(() => { place(); return rec().ending?.step === 3; }, 12000);
  check('his knocks on note blocks call him, and the grounded charge opens the rift', t > 0, `${t} ticks`);
  t = run(() => { place(); return c().entity.getProperty(P('vis_hi')) <= 5; }, 12000);
  check('he tests it with his tail, turns, and starts through headfirst', t > 0 && c().entity.getProperty(P('phase')) === 25, `vis_hi ${c().entity.getProperty(P('vis_hi'))}`);
  playing = false;
  t = run(() => rec().ending?.step === 0 && c().entity.getProperty(P('vis_hi')) === 8, 2000);
  check('interrupted, he backs out whole and the record is not retired', t > 0 && rec().stage === 'alive' && w.sim.count(TYPE) === 1 && rec().ending.tries === 1);
  // second attempt, kept up until the tail clears
  playing = true; rodSet = null;
  w.sim.setBlock('minecraft:overworld', 0, 0, 0, 'minecraft:air');
  t = run(() => { place(); return rec().stage === 'departed'; }, 30000);
  check('with the rhythm held until the tail clears, he is fully across', t > 0 && rec().stage === 'departed' && rec().entityId === null, `${t} ticks`);
  check('zero Basiliskras remain, and no hit volumes', w.sim.count(TYPE) === 0 && w.sim.count('basiliskra:hitbox') === 0 && w.bk.ctl.creature === null);
  w.restart();
  w.sim.step(200);
  check('the completed rift stays quiet after a restart', rec().stage === 'departed' && w.sim.count(TYPE) === 0);
  ana.mode = 'Survival';
  ruin(w, ana, SITE, 40, 80);
  ruin(w, ana, { x: 500, y: 64, z: 12 }, 40, 80);
  w.sim.save.timeOfDay = 12000; w.sim.step(3000);
  check('no amount of new harm calls another', rec().stage === 'departed' && w.sim.count(TYPE) === 0 && w.bk.ctl.requestArrival({ region: 'z', site: SITE, guilty: null, guiltyName: null }) === false);
  w.bk.CONFIG.allowSummon = false;
  const stray = w.sim.summon(TYPE, 'minecraft:overworld', SITE); w.sim.step(2);
  check('and with spawn eggs turned off in the settings, a summoned one is removed', !stray.attached && w.sim.count(TYPE) === 0 && rec().stage === 'departed');
  w.bk.CONFIG.allowSummon = true;
  check('the old token would not be honoured either', (() => { const r = w.sim.newRecord(TYPE, 'minecraft:overworld', SITE); r.dyn['bk:token'] = rec().token; const e2 = w.sim.attach(r, 'entityLoad'); w.sim.step(2); return !e2.attached; })());
}

console.log('\n== 10. Upgrading the pack');
{
  const save = new Save();
  // a record written by an older version of the pack (schema 1)
  save.worldProps.set('bk:rec', JSON.stringify({ v: 1, stage: 'alive', token: 'abc', entityId: 'e-1', form: 2, health: 410, quiet: false }));
  const w = start(save); open(w);
  const r = w.bk.store.rec;
  check('an older world record is migrated in place, identity intact', r.v === 2 && r.stage === 'alive' && r.entityId === 'e-1' && r.form === 2 && r.health === 410 && r.learned && r.mut && Array.isArray(r.sites));
  const s2 = new Save();
  s2.worldProps.set('bk:rec', JSON.stringify({ v: 1, stage: 'alive', token: 'abc', entityId: null, form: 3, quiet: true }));
  const w3 = start(s2); open(w3);
  check('a retired save from the older schema stays retired', w3.bk.store.rec.stage === 'departed');
}

console.log('\n== 11. Walls, piers and the way round');
{
  // a village: a cottage stands between him and where he is going
  const w = start(); w.sim.terrainFn = TERRAINS.village; open(w);
  w.bk.CONFIG.terrain = 'scorch';                 // not smashing his way: that is the wither mode, below
  const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 40 }); ana.mode = 'Creative';
  const rec = w.bk.store.rec;
  Object.assign(rec, { stage: 'alive', token: 'walltoken0000000000000000000000', form: 3, born: 1, rift: { x: 400, y: 56, z: 400, yaw: 0 }, origin: { x: 400, y: 64, z: 380 } });
  const r = w.sim.newRecord(TYPE, 'minecraft:overworld', { x: 40, y: 64, z: 0.5 }, 90);
  r.dyn['bk:token'] = rec.token; rec.entityId = r.id; w.bk.store.save();
  w.sim.attach(r, 'entityLoad'); w.sim.flush(); w.sim.step(3);
  const c = w.bk.ctl.creature, brain = w.bk.ctl.brain;
  let inside = 0, nearest = 1e9, done = false, ticks = 0, widest = 0;
  const built = (x, z) => x >= -5 && x <= 3 && z >= -4 && z <= 4;                 // the cottage's footprint
  brain.forced = { name: 'test', run: (function* () { yield* brain.walk({ x: -40, y: 64, z: 0.5 }, 0.14, 4, 3000); done = true; yield* (function* () { for (;;) yield; })(); })(), limit: 1e9 };
  for (; ticks < 3000 && !done; ticks++) {
    w.sim.step(1);
    const f = { x: -Math.sin(c.yaw * Math.PI / 180), z: Math.cos(c.yaw * Math.PI / 180) };
    for (const s of [-9.4, 0, 9.4]) {                                               // hips, middle, shoulders (drawn 1.7 times his model)
      const x = c.pos.x + f.x * s, z = c.pos.z + f.z * s;
      const d = Math.max(Math.max(-5 - x, x - 3, 0), Math.max(-4 - z, z - 4, 0));
      nearest = Math.min(nearest, d);
      if (built(Math.floor(x), Math.floor(z))) inside++;
    }
    widest = Math.max(widest, Math.abs(c.pos.z - 0.5));
  }
  check('with a cottage in the way he reaches the far side', done && Math.hypot(c.pos.x + 40, c.pos.z - 0.5) < 6, `${ticks} ticks, ended ${c.pos.x.toFixed(1)},${c.pos.z.toFixed(1)}`);
  check('and no part of his trunk passed through it', inside === 0 && nearest > 1.5, `closest ${nearest.toFixed(1)} blocks, went ${widest.toFixed(1)} wide`);
  // a goal inside the house is refused, not orbited
  let t2 = 0, fin = false;
  brain.forced = { name: 'test', run: (function* () { yield* brain.walk({ x: -1, y: 64, z: 0 }, 0.14, 2, 3000); fin = true; yield* (function* () { for (;;) yield; })(); })(), limit: 1e9 };
  for (; t2 < 1500 && !fin; t2++) w.sim.step(1);
  check('a place inside a building is given up, not circled for ever', fin && t2 < 1200 && !built(Math.floor(c.pos.x), Math.floor(c.pos.z)), `${t2} ticks`);
}
{
  // like the Wither (the default): the same walk goes straight through the cottage, and what holds things is left
  const w = start(); w.sim.terrainFn = TERRAINS.village; open(w);
  const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 60 }); ana.mode = 'Creative';
  const rec = w.bk.store.rec;
  Object.assign(rec, { stage: 'alive', token: 'withertoken000000000000000000000', form: 3, born: 1, rift: { x: 400, y: 56, z: 400, yaw: 0 }, origin: { x: 400, y: 64, z: 380 } });
  w.sim.setBlock('minecraft:overworld', -2, 64, 1, 'minecraft:chest');
  w.sim.setBlock('minecraft:overworld', -3, 64, -1, 'minecraft:bed');
  const r = w.sim.newRecord(TYPE, 'minecraft:overworld', { x: 40, y: 64, z: 0.5 }, 90);
  r.dyn['bk:token'] = rec.token; rec.entityId = r.id; w.bk.store.save();
  w.sim.attach(r, 'entityLoad'); w.sim.flush(); w.sim.step(3);
  const c = w.bk.ctl.creature, brain = w.bk.ctl.brain;
  const id = (x, y, z) => w.sim.blockId('minecraft:overworld', x, y, z);
  const walls0 = [];
  for (let x = -5; x <= 3; x++) for (let y = 64; y <= 68; y++) for (let z = -4; z <= 4; z++) if (id(x, y, z) !== 'minecraft:air') walls0.push([x, y, z]);
  let done = false, ticks = 0, widest = 0;
  brain.forced = { name: 'test', run: (function* () { yield* brain.walk({ x: -40, y: 64, z: 0.5 }, 0.14, 4, 3000); done = true; yield* (function* () { for (;;) yield; })(); })(), limit: 1e9 };
  for (; ticks < 3000 && !done; ticks++) { w.sim.step(1); widest = Math.max(widest, Math.abs(c.pos.z - 0.5)); }
  const gone = walls0.filter(([x, y, z]) => id(x, y, z) === 'minecraft:air').length;
  check('in wither mode he goes straight through a cottage in his way', done && widest < 3 && gone > walls0.length * 0.4, `${ticks} ticks, ${gone} of ${walls0.length} blocks gone, went ${widest.toFixed(1)} wide`);
  check('the chest and the bed inside are left standing', id(-2, 64, 1) === 'minecraft:chest' && id(-3, 64, -1) === 'minecraft:bed');
  check('the ground under it is the world\'s own, and stays', id(0, 62, 0) !== 'minecraft:air' && id(-10, 62, 0) !== 'minecraft:air');
}
{
  // the bay with its pier: the seam must leave him a lane to swim out of and to ram back down
  const w = start(); w.sim.terrainFn = TERRAINS.bay; open(w);
  for (const p of PROPS.bay) w.sim.save.edits.set(`minecraft:overworld|${p.x},${p.y},${p.z}`, p.id);
  const ana = w.sim.addPlayer('Ana', { x: -6.5, y: 64, z: 24 });
  w.bk.ctl.requestArrival({ region: 'bay', site: { x: 0, y: 64, z: 10 }, guilty: ana.id, guiltyName: 'Ana' });
  w.sim.save.timeOfDay = 11700;
  until(w, () => w.bk.store.rec.arrival?.step >= 4 && w.bk.ctl.creature, 4000);
  const a = w.bk.store.rec.arrival, f = { x: -Math.sin(a.yaw * Math.PI / 180), z: Math.cos(a.yaw * Math.PI / 180) };
  let far = 0, rams = 0, ramRun = 1e9, ramFrom = null, last = '', post = false;
  for (let i = 0; i < 4000 && w.bk.store.rec.stage !== 'alive'; i++) {
    w.sim.step(1);
    const c = w.bk.ctl.creature; if (!c) continue;
    const along = (c.pos.x - a.water.x) * f.x + (c.pos.z - a.water.z) * f.z;
    far = Math.max(far, along);
    if (c.phase === 'ram' && last !== 'ram') ramFrom = along;
    if (c.phase !== 'ram' && last === 'ram') { rams++; ramRun = Math.min(ramRun, ramFrom - along); }
    last = c.phase;
    const l = { x: f.z, z: -f.x };
    for (const side of [-2.6, 0, 2.6]) if (/log|planks/.test(w.sim.blockId('minecraft:overworld', c.pos.x + l.x * side, c.pos.y + 1, c.pos.z + l.z * side))) post = true;
  }
  check('the seam is opened where he has room: he swims clear of it', far > 22, `${far.toFixed(1)} blocks out`);
  check('each of the three rams is a real run at the place he came through', rams === 3 && ramRun > 10, `${rams} rams, shortest ${ramRun.toFixed(1)} blocks`);
  check('and his lane misses the pier', !post);
}

console.log('\n== 12. Findings from the independent review');
/** Stand a ready-made Form III in a world through the door a reload uses: a saved entity the record names. */
function standThree(w, at, yaw, beams = 0, rift = { x: 400, y: 56, z: 400, yaw: 0 }) {
  const rec = w.bk.store.rec;
  Object.assign(rec, { stage: 'alive', token: 'reviewtoken000000000000000000000', form: 3, born: 1, rift, origin: { x: 400, y: 64, z: 380 } });
  rec.mut.beams = beams; rec.mut.formSince = rec.clock;
  const r = w.sim.newRecord(TYPE, 'minecraft:overworld', at, yaw);
  r.dyn['bk:token'] = rec.token; rec.entityId = r.id; w.bk.store.save();
  w.sim.attach(r, 'entityLoad'); w.sim.flush(); w.sim.step(3);
  return w.bk.ctl.creature;
}
const forever = function* () { for (;;) yield; };
function force(w, make) {
  const brain = w.bk.ctl.brain; let out = { done: false, value: undefined };
  brain.forced = { name: 'test', run: (function* () { out.value = yield* make(brain); out.done = true; yield* forever(); })(), limit: 1e9 };
  return out;
}
{
  // a wood: trunks every five blocks under an unbroken canopy
  const w = start();
  w.sim.terrainFn = (dim, x, y, z) => {
    if (dim !== 'minecraft:overworld') return 'minecraft:air';
    if (y <= 62) return 'minecraft:stone';
    if (y === 63) return 'minecraft:grass_block';
    const tree = ((x % 5) + 5) % 5 === 2 && ((z % 5) + 5) % 5 === 2;
    if (tree && y <= 68) return 'minecraft:oak_log';
    if (y === 67 || y === 68) return 'minecraft:oak_leaves';
    return 'minecraft:air';
  };
  open(w);
  const ana = w.sim.addPlayer('Ana', { x: 20, y: 64, z: -30 }); ana.mode = 'Creative';
  const c = standThree(w, { x: 0, y: 64, z: -60 }, 0);
  const r = force(w, (b) => b.walk({ x: 0, y: 64, z: -10 }, 0.14, 4, 2000));
  let climbs = 0; for (let i = 0; i < 2000 && !r.done; i++) { w.sim.step(1); if (c.blockedWhy === 'climb') climbs++; }
  check('canopy is not ground: he walks through a wood on the forest floor', r.done && r.value === true && Math.abs(c.pos.y - 64) < 0.01 && climbs === 0, `ended z=${c.pos.z.toFixed(1)} y=${c.pos.y.toFixed(1)}, ${climbs} ticks blocked by a climb`);
}
{
  // cover: a player hugging the far side of a one-block wall
  const hit = (wall, terrain = 'scorch') => {
    const w = start(); open(w);
    w.bk.CONFIG.terrain = terrain;
    // (he is drawn 1.7 times his model size: his mouth is some 28 blocks ahead of his middle)
    const a = w.sim.addPlayer('Ana', { x: 47.31, y: 64, z: -79.5 }); a.health = 1000;
    const c = standThree(w, { x: 0, y: 64, z: -80 }, -90, 0);
    if (wall) for (let y = 64; y <= 76; y++) for (let z = -86; z <= -74; z++) w.sim.setBlock('minecraft:overworld', 46, y, z, 'minecraft:planks');
    w.sim.step(5);
    w.bk.ctl.brain.forced = { name: 'beam', run: w.bk.ctl.brain.beam(a), limit: 1200 };
    let fired = false;
    for (let i = 0; i < 400; i++) { w.sim.step(1); if (c.phase === 'fire') fired = true; if (fired && c.phase !== 'fire') break; }
    let wallLeft = 0;
    if (wall) for (let y = 64; y <= 76; y++) for (let z = -86; z <= -74; z++) if (w.sim.blockId('minecraft:overworld', 46, y, z) === 'minecraft:planks') wallLeft++;
    return { fired, lost: 1000 - a.health, wallLeft };
  };
  const open1 = hit(false), behind = hit(true);
  check('the raw beam hurts a player in the open', open1.fired && open1.lost > 0, `lost ${open1.lost}`);
  check('and (when he is not destroying the world) does not reach one sheltering close behind a wall', behind.fired && behind.lost === 0, `lost ${behind.lost}`);
  const blown = hit(true, 'wither');
  check('like the Wither, the beam blows a hole in that wall, and finds the player behind it', blown.fired && blown.wallLeft < 13 * 13 && blown.lost > 0, `${13 * 13 - blown.wallLeft} planks gone, lost ${blown.lost}`);
}
{
  // a call with no deep water in reach must not hold the save hostage
  const w = start(); open(w);
  const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: -400 });
  const rec = w.bk.store.rec;
  check('an inland call is accepted and waits', w.bk.ctl.requestArrival({ region: 'inland', site: { x: 0, y: 64, z: -400 }, guilty: ana.id, guiltyName: 'Ana' }) === true && rec.stage === 'pending');
  until(w, () => (rec.pending?.passes ?? 0) >= 1, 2000);
  check('after one fruitless search it gives way to a call from a real coast', (rec.pending?.passes ?? 0) >= 1
    && w.bk.ctl.requestArrival({ region: 'coast', site: SITE, guilty: ana.id, guiltyName: 'Ana' }) === true && rec.pending.region === 'coast' && !rec.pending.passes);
  ana.moveTo(SITE); w.sim.save.timeOfDay = 12000;
  check('which is then answered', until(w, () => rec.stage === 'arriving', 3000) > 0);
  const w2 = start(); open(w2);
  const b = w2.sim.addPlayer('Ben', { x: 0, y: 64, z: -400 });
  w2.bk.ctl.requestArrival({ region: 'inland', site: { x: 0, y: 64, z: -400 }, guilty: b.id, guiltyName: 'Ben' });
  const t = until(w2, () => w2.bk.store.rec.stage === 'dormant', 12000, 5);
  check('left alone, a call that cannot be answered lapses and the world can call again', t > 0 && w2.bk.store.rec.pending === null
    && w2.bk.ctl.requestArrival({ region: 'coast', site: SITE, guilty: b.id, guiltyName: 'Ben' }) === true, `${t} ticks`);
}
{
  // a repeater clock on a note block, never touched by hand this session
  const w = start(); open(w);
  const ana = w.sim.addPlayer('Ana', { x: 10, y: 64, z: 60 }); ana.mode = 'Creative';
  const rift = { x: 0.5, y: 57.5, z: 60.5, yaw: 0 };
  standThree(w, { x: 60, y: 64, z: -120 }, 0, 0, rift);          // far away: only the listening is under test
  const held = [];
  for (const layer of [0, 6, 12]) {
    const nb = { x: 3, y: 57 + layer, z: 60 };
    w.sim.setBlock('minecraft:overworld', nb.x, nb.y, nb.z, 'minecraft:noteblock');
    let on = 0, total = 0;
    for (let i = 0; i < 2600; i++) {
      w.sim.save.edits.set(`power|${nb.x},${nb.y},${nb.z}`, (w.sim.save.tick % 18) < 2 ? 15 : 0);
      w.sim.step(1);
      if (i >= 1000) { total++; if (w.bk.ctl.ending.rhythm) on++; }
    }
    held.push(Math.round(100 * on / total));
    w.sim.setBlock('minecraft:overworld', nb.x, nb.y, nb.z, 'minecraft:air');
    w.sim.save.edits.delete(`power|${nb.x},${nb.y},${nb.z}`);
    w.sim.step(400);
  }
  check('a redstone-clocked note block holds his rhythm, low or high', held.every((h) => h >= 97), `held ${held.join('% / ')}% of the time`);
}
{
  // what the beam may mark
  const w = start(); w.sim.terrainFn = TERRAINS.village; open(w);
  const ana = w.sim.addPlayer('Ana', { x: 40, y: 64, z: 20 }); ana.mode = 'Creative';
  standThree(w, { x: 60, y: 64, z: 20 }, 90);
  const id = (x, y, z) => w.sim.blockId('minecraft:overworld', x, y, z), brain = w.bk.ctl.brain;
  for (let y = 64; y <= 67; y++) for (let z = 28; z <= 34; z++) w.sim.setBlock('minecraft:overworld', 30, y, z, 'minecraft:stone');   // a wall somebody raised, of raw stone
  brain.scorch({ x: 30, y: 65, z: 31 });
  check('a free-standing wall of raw stone is not scorched', id(30, 65, 31) === 'minecraft:stone' && id(30, 66, 31) === 'minecraft:stone' && id(30, 64, 31) === 'minecraft:stone');
  brain.scorch({ x: 3, y: 65, z: 0 });                                    // the cottage's window glass
  check('a beam that meets a building changes nothing, not even the lawn at its foot', id(4, 63, 0) === 'minecraft:grass_block' && id(3, 64, 0) === 'minecraft:cobblestone');
  brain.scorch({ x: 40, y: 63, z: 30 });
  check('open ground is scorched', id(40, 63, 30) === 'minecraft:coarse_dirt');
  brain.scorch({ x: 4, y: 63, z: 2 });                                    // grass right against the cottage wall
  check('but not the ground a building stands against', id(4, 63, 2) === 'minecraft:grass_block', id(4, 63, 2));
}
{
  // deep water is not a road
  const w = start(); open(w);
  const ana = w.sim.addPlayer('Ana', { x: 20, y: 64, z: 0 }); ana.mode = 'Creative';
  const c = standThree(w, { x: 0, y: 64, z: 4 }, 0);
  const r = force(w, (b) => b.walk({ x: 0, y: 64, z: 70 }, 0.14, 4, 1500));
  let deepest = 64; for (let i = 0; i < 1500 && !r.done; i++) { w.sim.step(1); deepest = Math.min(deepest, c.pos.y); }
  check('Form III does not walk off into water over his depth', r.done && r.value === false && c.pos.z < 22 && deepest > 60 && !c.afloat, `stopped at z=${c.pos.z.toFixed(1)}, lowest y ${deepest.toFixed(1)}`);
  // but put there, he swims at his depth and hauls out over the bank
  c.pos = { x: 0, y: 45, z: 40 }; c.entity.teleport(c.pos);
  const r2 = force(w, (b) => b.walk({ x: 0, y: 64, z: 0 }, 0.14, 4, 2500));
  let rose = false; for (let i = 0; i < 2500 && !r2.done; i++) { w.sim.step(1); if (c.afloat && Math.abs(c.pos.y - 58) < 0.2) rose = true; }
  check('left in deep water he rises to his swimming depth and hauls himself out', r2.done && r2.value === true && rose && Math.abs(c.pos.y - 64) < 0.01 && c.pos.z < 8, `ended ${c.pos.z.toFixed(1)}, y ${c.pos.y.toFixed(1)}`);
}
{
  // unloaded and reloaded in the middle of the arrival: the sequence belongs to the new handle
  const w = start(); open(w);
  const a = w.sim.addPlayer('Ana', SITE);
  ruin(w, a, SITE);
  w.sim.save.timeOfDay = 12000;
  until(w, () => w.bk.store.rec.arrival?.step === 4 && w.bk.ctl.creature, 4000);
  w.sim.step(40);
  a.moveTo({ x: 0, y: 40, z: 0 }, 'minecraft:nether'); w.sim.step(40);
  const gone = w.bk.ctl.creature === null;
  a.moveTo(SITE, 'minecraft:overworld'); w.sim.step(5);
  const h0 = a.heard.length;
  const t = until(w, () => w.bk.store.rec.stage === 'alive', 600);
  check('an arrival interrupted by an unload finishes on the animal that came back', gone && t > 0 && w.sim.count(TYPE) === 1 && !a.heard.slice(h0).some((s) => s.id === 'basiliskra.ram'), `${t} ticks`);
}

console.log('\n== 13. Spawn egg, the spawn command, the journal and the config wheel');
{
  // a new world: the egg used on dry land
  const w = start(); open(w);
  const ana = w.sim.join('Ana', { x: 0, y: 64, z: -20 });
  w.sim.step(80);
  check('a player joining gets the journal, and (as operator) the config wheel', ana.inv.some((i) => i.typeId === 'basiliskra:journal') && ana.inv.some((i) => i.typeId === 'basiliskra:config_wheel') && ana.messages.some((m) => /journal/.test(m)));
  const n0 = ana.inv.length;
  w.restart(); w.sim.step(5);
  const back = w.sim.players.find((p) => p.name === 'Ana');
  w.sim.queue.push(() => w.sim.ev.playerSpawn.fire({ player: back, initialSpawn: true })); w.sim.step(80);
  check('but only once: joining again gives nothing new', n0 === 2 && back.inv.length === 0, `${back.inv.length} items`);
  const egg = w.sim.summon(TYPE, 'minecraft:overworld', { x: 0, y: 64, z: -40 });
  w.sim.step(3);
  const c1 = w.bk.ctl.creature, rec = w.bk.store.rec;
  check('the spawn egg in a new world, on land: Basiliskra III stands there, bound, the one and only', !!c1 && c1.entity.id === egg.id && egg.attached && rec.stage === 'alive' && rec.form === 3
    && egg.rec.props[P('bound')] === true && egg.rec.props[P('form')] === 3 && w.sim.count(TYPE) === 1 && egg.rec.dyn['bk:token'] === rec.token && egg.nameTag === 'Basiliskra III');
  w.sim.step(600);
  check('and he stays: the two-second despawn timer for unbound bodies never takes him', w.sim.count(TYPE) === 1 && egg.attached && w.bk.ctl.creature?.entity.id === egg.id);
  // a second egg while he is here: he is brought, nothing is added
  const egg2 = w.sim.summon(TYPE, 'minecraft:overworld', { x: 30, y: 64, z: -40 });
  w.sim.step(3);
  check('a second egg brings the same animal to the new place', !egg2.attached && w.sim.count(TYPE) === 1 && w.bk.ctl.creature.entity.id === egg.id && Math.abs(w.bk.ctl.creature.pos.x - 30) < 0.5);
  // the egg in the Nether
  const nell = w.sim.addPlayer('Nell', { x: 0, y: 40, z: 0 }, 'minecraft:nether');
  const ne = w.sim.summon(TYPE, 'minecraft:nether', { x: 2, y: 40, z: 0 });
  w.sim.step(3);
  check('in the Nether the egg makes nothing, and says why', !ne.attached && w.sim.count(TYPE) === 1 && nell.messages.some((m) => /Overworld/.test(m)));
  // unloaded elsewhere: the egg's body becomes him, and the old one is removed when its chunk loads
  const old = w.bk.ctl.creature.entity.id;
  back.moveTo({ x: 2000, y: 64, z: 2000 }); w.sim.step(40);
  check('(he is unloaded with his chunk)', w.bk.ctl.creature === null && w.sim.count(TYPE) === 1);
  const far = w.sim.summon(TYPE, 'minecraft:overworld', { x: 2000, y: 64, z: 2030 });
  w.sim.step(3);
  check('the egg far away: its body becomes him, carrying his token and his form', w.bk.ctl.creature?.entity.id === far.id && w.bk.store.rec.entityId === far.id && far.rec.dyn['bk:token'] === w.bk.store.rec.token && far.rec.props[P('form')] === 3);
  back.moveTo({ x: 10, y: 64, z: -30 }); w.sim.step(40);
  check('and the old body is removed the moment its chunk loads: still one', w.sim.count(TYPE) === 1 && !w.sim.save.entities.has(old) && w.sim.save.entities.has(far.id), `${w.sim.count(TYPE)} in the save`);

  // the spawn command
  const w2 = start(); open(w2);
  const bo = w2.sim.addPlayer('Bo', { x: 0, y: 64, z: 0 }); bo.view = { x: 0, y: 0, z: 1 };
  check('three commands are registered: spawn, journal, config', ['basiliskra:spawn', 'basiliskra:journal', 'basiliskra:config'].every((n) => w2.sim.commands.has(n)) && w2.sim.enums.get('basiliskra:form').join() === 'story,i,ii,iii,iv');
  check('none of them needs cheats', [...w2.sim.commands.values()].every((c) => c.def.cheatsRequired === false));
  const r1 = w2.sim.runCommand('basiliskra:spawn', bo, 'ii'); w2.sim.step(3);
  const c2 = w2.bk.ctl.creature;
  const wrap = (a) => ((a % 360) + 540) % 360 - 180;
  check('/basiliskra:spawn ii: Basiliskra II, in front of the player, facing them', r1.status === 0 && !!c2 && c2.form === 2 && w2.sim.count(TYPE) === 1 && c2.pos.z > 20 && c2.pos.z < 28 && Math.abs(Math.abs(wrap(c2.yaw)) - 180) < 5, `at ${c2?.pos.z.toFixed(1)}, yaw ${c2?.yaw.toFixed(0)}`);
  const r2 = w2.sim.runCommand('basiliskra:spawn', bo, 'iii'); w2.sim.step(3);
  check('/basiliskra:spawn iii: the same animal, now Basiliskra III', r2.status === 0 && w2.bk.ctl.creature.entity.id === c2.entity.id && w2.bk.ctl.creature.form === 3 && w2.bk.store.rec.form === 3 && w2.sim.count(TYPE) === 1 && w2.sim.count('basiliskra:hitbox') >= 17, `${w2.sim.count('basiliskra:hitbox')} hit volumes`);
  const visitor = w2.sim.addPlayer('Vi', { x: 4, y: 64, z: 0 }); visitor.playerPermissionLevel = 1;
  check('a player who is not an operator cannot use the spawn command', w2.sim.runCommand('basiliskra:spawn', visitor).status === 1);

  // the journal
  const w3 = start(); open(w3);
  const jo = w3.sim.addPlayer('Jo', { x: 0, y: 64, z: 12 });
  const bea = w3.sim.addPlayer('Bea', { x: 4, y: 64, z: 12 });
  const page = () => { const f = jo.forms[jo.forms.length - 1]; return f ? f.body : ''; };
  jo.use('basiliskra:journal'); w3.sim.step(2);
  check('the journal opens on use, and says nothing has called him yet', jo.forms.length === 1 && /HIS ANGER/.test(page()) && /Not yet/.test(page()) && /0%/.test(page()));
  ruin(w3, jo, SITE, 6, 12);
  for (let i = 0; i < 2; i++) kill(w3, bea, 'minecraft:cow', SITE);
  jo.use('basiliskra:journal'); w3.sim.step(2);
  const t = page();
  const m = t.match(/§l(\d+)%/);
  check('it shows how angry this place has made him, as a percentage', !!m && Number(m[1]) > 0 && Number(m[1]) < 100, m ? `${m[1]}%` : t.slice(0, 200));
  check('and what more it would take, and your own share of it', /more animal/.test(t) && /Your share of it: §f(7\d|8\d)%/.test(t), (t.match(/Your share[^\n]*/) || [''])[0]);
  ruin(w3, jo, SITE, 14, 40);
  jo.use('basiliskra:journal'); w3.sim.step(2);
  check('when it reaches 100% it says he has been called, and where', /He has been called/.test(page()) && /100%/.test(page()));
  w3.sim.save.timeOfDay = 1000;
  until(w3, () => w3.bk.store.rec.stage === 'arriving', 4000);
  jo.use('basiliskra:journal'); w3.sim.step(2);
  check('then when he will come: the water, and the time to dusk', /He is coming/.test(page()) && /next dusk, in §fabout \d+ minutes/.test(page()), (page().match(/At the next dusk[^\n]*/) || [''])[0]);
  w3.sim.save.timeOfDay = 11700;
  until(w3, () => w3.bk.store.rec.stage === 'alive', 4000);
  jo.use('basiliskra:journal'); w3.sim.step(2);
  check('and once he is here, where he is and how close he is to changing', /Basiliskra I is here/.test(page()) && /Becoming Basiliskra II/.test(page()));
  const before = JSON.stringify(w3.bk.store.harm);
  jo.loc = { x: 9000, y: 64, z: 9000 }; jo.use('basiliskra:journal'); w3.sim.step(2);
  check('reading it changes nothing on record (no region is made where you stand)', JSON.stringify(w3.bk.store.harm) === before);

  // the config wheel
  const w4 = start(); open(w4);
  const op = w4.sim.addPlayer('Op', { x: 0, y: 64, z: 0 });
  const guest = w4.sim.addPlayer('Guest', { x: 3, y: 64, z: 0 }); guest.playerPermissionLevel = 1;
  guest.use('basiliskra:config_wheel'); w4.sim.step(2);
  check('only an operator can use the config wheel', guest.forms.length === 0 && guest.messages.some((m) => /operator/.test(m)));
  op.answers.push(0, { 1: '2.5', 2: 0, 5: 2, 10: 3 });                     // Settings; story speed typed in (2.5), beam does nothing, damage x0.5 picked, egg makes III
  op.use('basiliskra:config_wheel'); w4.sim.step(3); w4.sim.flush(); await new Promise((r) => setTimeout(r, 0)); w4.sim.step(2);
  const cfg = w4.bk.CONFIG;
  check('settings are changed from the wheel', cfg.pacing === 2.5 && cfg.terrain === 'none' && cfg.damage === 0.5 && cfg.spawnForm === 3, JSON.stringify({ p: cfg.pacing, t: cfg.terrain, d: cfg.damage, f: cfg.spawnForm }));
  w4.restart(); w4.sim.step(2);
  check('and kept with the world across a reload', w4.bk.CONFIG.pacing === 2.5 && w4.bk.CONFIG.terrain === 'none' && w4.bk.CONFIG.spawnForm === 3);
  const op2 = w4.sim.players.find((p) => p.name === 'Op');
  op2.answers.push(2, 3);                                                     // Bring him here -> Basiliskra III
  op2.use('basiliskra:config_wheel'); w4.sim.step(2); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); w4.sim.step(3);
  check('Bring him here makes Basiliskra III in front of the operator', w4.bk.ctl.creature?.form === 3 && w4.sim.count(TYPE) === 1, op2.messages.slice(-2).join(' | '));
  op2.answers.push(4, 0);                                                     // Send him away -> Yes
  op2.use('basiliskra:config_wheel'); w4.sim.step(2); for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); w4.sim.step(3);
  check('Send him away: he leaves through a seam and stays gone (the story is at its beginning again)', w4.sim.count(TYPE) === 0 && w4.bk.store.rec.stage === 'dormant' && w4.bk.store.rec.born === 0 && w4.bk.store.rec.form === 1);
  for (let i = 0; i < 26000; i += 100) w4.sim.step(100);
  check('and a day later he has not come back by himself', w4.sim.count(TYPE) === 0 && w4.bk.store.rec.stage === 'dormant');
  op2.answers.push(7, 0);                                                     // Reset the story -> Yes
  op2.use('basiliskra:config_wheel'); w4.sim.step(2); for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); w4.sim.step(3);
  check('Reset the story: as if the pack had just been added', w4.bk.store.rec.stage === 'dormant' && w4.bk.store.rec.born === 0 && Object.keys(w4.bk.store.harm.regions).length === 0 && w4.sim.count(TYPE) === 0);
  op2.answers.push('busy', 'busy', 6);                                        // the screen is busy (chat open) twice, then the journal
  op2.use('basiliskra:config_wheel'); w4.sim.step(2);
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 0)); w4.sim.step(1); }
  check('a form that cannot open yet (chat open) is tried again', op2.forms.filter((f) => f.title === 'Basiliskra Config Wheel').length >= 3 && op2.forms.some((f) => f.title === 'Basiliskra Journal'));
}

console.log('\n== 14. Fallout: radiation that changes the land');
{
  // a meadow: grass, flowers, a few wild trees, sand by a pond; and a cottage with a lawn and a planted hedge
  const meadow = (dim, x, y, z) => {
    if (dim !== 'minecraft:overworld') return 'minecraft:air';
    const pond = Math.hypot(x - 30, z - 30) < 6;
    if (y <= 60) return 'minecraft:stone';
    if (y <= 62) return pond ? 'minecraft:sand' : 'minecraft:dirt';
    if (y === 63) return pond ? 'minecraft:sand' : 'minecraft:grass_block';
    const tree = (x === 8 && z === 8) || (x === -8 && z === 6);
    if (tree && y <= 67) return 'minecraft:oak_log';
    if ((Math.abs(x - 8) <= 2 && Math.abs(z - 8) <= 2) || (Math.abs(x + 8) <= 2 && Math.abs(z - 6) <= 2)) { if (y === 67 || y === 68) return 'minecraft:oak_leaves'; }
    if (y === 64 && !pond && ((x * 7 + z * 13) % 5 === 0)) return 'minecraft:short_grass';
    if (y === 64 && !pond && ((x * 3 + z * 11) % 17 === 0)) return 'minecraft:poppy';
    // the cottage at x 12..16, z -4..0: planks walls, glass, and a lawn against its wall
    if (x >= 12 && x <= 16 && z >= -4 && z <= 0 && y >= 64 && y <= 66 && (x === 12 || x === 16 || z === -4 || z === 0)) return y === 65 ? 'minecraft:glass' : 'minecraft:oak_planks';
    return 'minecraft:air';
  };
  const w = start(); w.sim.terrainFn = meadow; open(w);
  const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: -20 });
  const hedge = { x: -3, y: 64, z: 3 };
  w.sim.setBlock('minecraft:overworld', hedge.x, hedge.y, hedge.z, 'minecraft:oak_leaves'); w.sim.save.edits.set(`placed|${hedge.x},${hedge.y},${hedge.z}`, true);
  const fallout = w.bk.fallout;
  const id = (x, y, z) => w.sim.blockId('minecraft:overworld', x, y, z);
  // the beam: a Basiliskra III fires into the meadow at a player standing there
  const rec = w.bk.store.rec;
  Object.assign(rec, { stage: 'alive', token: 'fallouttoken000000000000000000000', form: 3, born: 1, rift: { x: 400, y: 56, z: 400, yaw: 0 }, origin: { x: 400, y: 64, z: 380 } });
  rec.mut.beams = 3;
  const r = w.sim.newRecord(TYPE, 'minecraft:overworld', { x: 0, y: 64, z: -40 }, 0);
  r.dyn['bk:token'] = rec.token; rec.entityId = r.id; w.bk.store.save();
  w.sim.attach(r, 'entityLoad'); w.sim.flush(); w.sim.step(3);
  const target = w.sim.addPlayer('Target', { x: 0, y: 64, z: 2 }); target.health = 1000;
  w.bk.ctl.brain.forced = { name: 'beam', run: w.bk.ctl.brain.beam(target), limit: 1200 };
  let fired = false; for (let i = 0; i < 500; i++) { w.sim.step(1); if (w.bk.ctl.creature.phase === 'fire') fired = true; if (fired && w.bk.ctl.creature.phase !== 'fire') break; }
  const zones = rec.fallout;
  check('his beam leaves fallout where it lands', fired && zones.length >= 1 && zones.some((z) => z.s > 0.5), JSON.stringify(zones.map((z) => [Math.round(z.x), Math.round(z.z), z.r, +z.s.toFixed(2)])));
  check('ash falls at the impact, and the air there carries glowing motes', target.seen.some((q) => q.id === 'basiliskra:fallout_ash'));
  check('where it lands there is a glare, a ring of fire across the ground and a fountain of sparks', ['impact_glare', 'impact_ring', 'impact_fountain'].every((n) => target.seen.some((q) => q.id === `basiliskra:${n}`)));
  let slag = 0, glass = 0;
  for (let x = -12; x <= 12; x++) for (let z = -10; z <= 14; z++) for (let y = 54; y <= 63; y++) { const b = id(x, y, z); if (b === 'basiliskra:glowing_slag') slag++; if (b === 'basiliskra:scarlet_trinitite') glass++; }
  check('where his beam blows a crater, the rock under it runs to glowing slag', slag >= 3, `${slag} slag`);
  // now leave it to the fallout, with nobody hunted: everyone creative, he is sent away
  w.bk.ctl.driveOff(true);
  ana.mode = 'Creative'; target.mode = 'Creative';
  const z0 = zones.slice().sort((a, b) => b.s - a.s)[0];
  const r0 = z0.m / 2.4;                                      // the radius the beam left it with
  ana.moveTo({ x: z0.x + 1, y: 64, z: z0.z + 1 });
  ana.seen.length = 0;
  for (let i = 0; i < 1100; i++) w.sim.step(1);
  const r1 = fallout.radiusOf(z0);
  check('it spreads: in under a minute it is more than twice as wide as it was left', r1 > r0 * 2 && r1 <= 24, `${r0.toFixed(1)} -> ${r1.toFixed(1)} blocks`);
  check('the air over it is thick with motes, and a ring of light marks its edge while it spreads', ana.seen.some((q) => q.id === 'basiliskra:rad_cloud') && ana.seen.some((q) => q.id === 'basiliskra:rad_front'));
  const R = Math.ceil(r1), cx = Math.floor(z0.x), cz = Math.floor(z0.z);
  const around = (fn) => { for (let x = cx - R; x <= cx + R; x++) for (let z = cz - R; z <= cz + R; z++) fn(x, z); };
  let soil = 0, grass = 0;
  const turned = [];
  around((x, z) => { const top = id(x, 63, z); if (top === 'basiliskra:irradiated_soil') { soil++; if (meadow('minecraft:overworld', x, 63, z) === 'minecraft:grass_block') turned.push([x, z]); } if (top === 'minecraft:grass_block') grass++; });
  check('inside it the ground glows: grass turns to irradiated soil, and plenty of it', soil >= 30, `${soil} irradiated, ${grass} grass left`);
  let plants0 = 0, plants1 = 0;
  around((x, z) => { if (/short_grass|poppy/.test(meadow('minecraft:overworld', x, 64, z))) plants0++; if (/short_grass|poppy/.test(id(x, 64, z))) plants1++; });
  check('plants wither in it', plants0 > 0 && plants1 < plants0 / 2, `${plants0} -> ${plants1}`);
  let crystals = 0;
  around((x, z) => { for (let y = 58; y <= 65; y++) if (id(x, y, z) === 'basiliskra:crimson_crystal') crystals++; });
  check('crimson crystals grow out of the poisoned ground, here and there', crystals >= 2 && crystals < soil / 3, `${crystals} crystals on ${soil} soil`);
  check('clicks for everyone standing in it, quicker the closer they are', ana.heard.some((q) => /^basiliskra\.geiger\.[1-4]$/.test(q.id)));
  check('in strong fallout the air itself turns red', w.sim.log.commands.some((c) => /^fog @s push basiliskra:fallout_fog/.test(c)));
  // it is strong
  ana.mode = 'Survival'; ana.health = 20; ana.effects = [];
  for (let i = 0; i < 90; i++) w.sim.step(1);
  const fx1 = (ana.effects ?? []).map((e) => e.id);
  check('a player standing in strong fallout gets sick at once: hunger, weakness, nausea, poison', ['hunger', 'weakness', 'nausea', 'poison'].every((e) => fx1.includes(e)) && ana.health === 20, [...new Set(fx1)].join(' '));
  for (let i = 0; i < 400; i++) w.sim.step(1);
  check('and staying in the heart of it burns', ana.health < 20, `health ${ana.health}`);
  // iodine
  ana.consume('basiliskra:iodine_tablets'); w.sim.step(2);
  const h0 = ana.health;
  check('iodine tablets clear what it has done', (ana.effects ?? []).every((e) => !['hunger', 'weakness', 'nausea', 'poison'].includes(e.id)) && fallout.protectedFor(ana) > 4000);
  for (let i = 0; i < 300; i++) w.sim.step(1);
  check('and keep it off for four minutes', ana.health === h0 && (ana.effects ?? []).every((e) => !['hunger', 'weakness', 'nausea', 'poison'].includes(e.id)), `health ${h0} -> ${ana.health}`);
  // glowing slag burns to stand on, iodine or not
  w.sim.setBlock('minecraft:overworld', 40, 63, -30, 'basiliskra:glowing_slag');
  ana.moveTo({ x: 40.5, y: 64, z: -29.5 }); ana.health = 20;
  for (let i = 0; i < 30; i++) w.sim.step(1);
  check('glowing slag burns whoever stands on it', ana.health < 20 && ana.onFire > 0, `health ${ana.health}`);
  w.sim.setBlock('minecraft:overworld', 40, 63, -30, 'minecraft:grass_block');
  ana.mode = 'Creative';
  check('never anything built: the cottage, its lawn against the wall, a planted hedge', id(12, 64, -2) === 'minecraft:oak_planks' && id(12, 65, -2) === 'minecraft:glass' && id(hedge.x, hedge.y, hedge.z) === 'minecraft:oak_leaves');
  // strong zones over the trees and the lawn by the cottage, and one on bare rock: what changes and what does not
  for (let x = -44; x <= -36; x++) for (let z = -4; z <= 4; z++) { w.sim.setBlock('minecraft:overworld', x, 63, z, x < -40 ? 'minecraft:stone' : 'minecraft:deepslate'); w.sim.setBlock('minecraft:overworld', x, 64, z, 'minecraft:air'); }
  fallout.addFallout({ x: 8, y: 64, z: 8 }, 4, 1.2);
  fallout.addFallout({ x: -8, y: 64, z: 6 }, 4, 1.2);
  fallout.addFallout({ x: 14, y: 63, z: 2 }, 3, 1.2);
  fallout.addFallout({ x: -40, y: 63, z: 0 }, 3, 1.2);
  ana.moveTo({ x: -14, y: 64, z: 4 });
  for (let i = 0; i < 2400; i++) w.sim.step(1);
  let leaves = 0; for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) for (const y of [67, 68]) if (id(x, y, z) === 'minecraft:oak_leaves') leaves++;
  check('wild leaves fall in strong fallout; trunks stay', leaves < 25 && id(8, 64, 8) === 'minecraft:oak_log', `${leaves} of 50 leaves left`);
  check('the lawn against the cottage wall is never changed', id(13, 63, 1) === 'minecraft:grass_block' && id(12, 63, 1) === 'minecraft:grass_block', id(13, 63, 1));
  let rock = 0; for (let x = -44; x <= -36; x++) for (let z = -4; z <= 4; z++) if (id(x, 63, z) === 'basiliskra:irradiated_rock') rock++;
  check('bare rock in it turns to irradiated rock', rock >= 20, `${rock} of 81`);
  // sand the beam touches fuses (he is brought back for it: the scorch is his)
  w.bk.ctl.bringHere({ x: 0, y: 64, z: -40 }, 0, 3); w.sim.step(2);
  w.sim.setBlock('minecraft:overworld', 30, 63, 30, 'minecraft:sand');
  w.bk.ctl.brain.scorch({ x: 30, y: 63, z: 30 });
  check('sand his beam touches fuses into scarlet trinitite', id(30, 63, 30) === 'basiliskra:scarlet_trinitite' && id(31, 63, 30) === 'basiliskra:scarlet_trinitite');
  // if the game ever refused the custom blocks, the land still changes, in vanilla blocks
  w.sim.refuseBlocks = new Set(['basiliskra:irradiated_soil', 'basiliskra:scarlet_trinitite']);
  w.sim.setBlock('minecraft:overworld', 32, 63, 30, 'minecraft:sand');
  w.bk.ctl.brain.scorch({ x: 33, y: 63, z: 30 });
  check('without the custom blocks it falls back to vanilla ones, without an error', id(32, 63, 30) === 'minecraft:smooth_basalt');
  w.sim.refuseBlocks = null;
  w.bk.ctl.driveOff(true);
  // the journal reads it
  ana.moveTo({ x: -8, y: 64, z: 6 });
  ana.use('basiliskra:journal'); w.sim.step(2);
  const page = ana.forms[ana.forms.length - 1]?.body ?? '';
  check('the journal shows the radiation where you stand and the nearest fallout', /FALLOUT/.test(page) && /Radiation where you stand: .*§l\d+%/.test(page) && /Fallout in §f\d+§7 place/.test(page), (page.match(/Radiation where[^\n]*/) || [''])[0]);
  // the counter
  ana.hand = { typeId: 'basiliskra:geiger_counter' }; ana.messages.length = 0;
  w.sim.step(12);
  check('the Geiger counter shows the dose', ana.messages.some((m) => /^\[actionbar\] .*Radiation \d+%/.test(m)), ana.messages.slice(-1)[0]);
  ana.moveTo({ x: -8, y: 64, z: 60 }); ana.messages.length = 0; w.sim.step(12);
  check('and, outside it, how far and which way the fallout is', ana.messages.some((m) => /fallout §f\d+§7 blocks north/.test(m)), ana.messages.slice(-1)[0]);
  ana.hand = null;
  // time: it fades, the land heals back to exactly what it was, and it is gone
  ana.moveTo({ x: -14, y: 64, z: 4 });
  const count = (what) => { let n = 0; for (let x = -70; x <= 50; x++) for (let z = -40; z <= 40; z++) for (let y = 54; y <= 66; y++) if (id(x, y, z) === what) n++; return n; };
  const before = { soil: count('basiliskra:irradiated_soil'), rock: count('basiliskra:irradiated_rock'), crystal: count('basiliskra:crimson_crystal'), slag: count('basiliskra:glowing_slag') };
  w.bk.store.rec.clock += 5200;                               // past the point where a full zone starts to heal
  for (let i = 0; i < 1500; i++) w.sim.step(1);
  const after = { soil: count('basiliskra:irradiated_soil'), rock: count('basiliskra:irradiated_rock'), crystal: count('basiliskra:crimson_crystal'), slag: count('basiliskra:glowing_slag') };
  check('as it fades the glow goes out: soil, rock and crystals all go back, and the slag cools', before.soil > 50 && before.rock > 20 && before.slag > 0 && after.soil + after.rock + after.crystal + after.slag === 0 && count('basiliskra:cooled_slag') >= before.slag,
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  check('grass comes back as grass, stone as stone, deepslate as deepslate', turned.length > 10 && turned.every(([x, z]) => id(x, 63, z) === 'minecraft:grass_block') && id(-43, 63, 0) === 'minecraft:stone' && id(-38, 63, 0) === 'minecraft:deepslate',
    `${turned.filter(([x, z]) => id(x, 63, z) === 'minecraft:grass_block').length} of ${turned.length} grass; ${id(-43, 63, 0)}, ${id(-38, 63, 0)}`);
  w.bk.store.rec.clock += 2400;
  for (let i = 0; i < 220; i++) w.sim.step(1);
  check('and within minutes it is gone altogether: nothing on record, the air clear again', w.bk.store.rec.fallout.length === 0 && fallout.doseAt(ana.location) === 0 && w.sim.log.commands.some((c) => /^fog @s remove/.test(c)),
    `${w.bk.store.rec.fallout.length} zones left`);
  // a glowing block left behind where no zone is (nobody was near when its zone ended) puts itself right
  const fades = w.sim.blockComponents.get('basiliskra:fades');
  const far = w.sim.dims.get('minecraft:overworld').getBlock({ x: 44, y: 63, z: 30 });
  far.setPermutation(new (w.sim.api.BlockPermutation)('basiliskra:irradiated_soil', { 'basiliskra:was': 1 }));
  fades?.onRandomTick({ block: far });
  check('a glowing block with no fallout left around it goes back on its own (random tick)', !!fades && id(44, 63, 30) === 'minecraft:grass_block', id(44, 63, 30));
  fallout.addFallout({ x: 44, y: 63, z: 30 }, 4, 1);
  far.setPermutation(new (w.sim.api.BlockPermutation)('basiliskra:irradiated_soil', { 'basiliskra:was': 1 }));
  fades?.onRandomTick({ block: far });
  check('but stays lit while the fallout there is still strong', id(44, 63, 30) === 'basiliskra:irradiated_soil');
  // settings
  w.bk.CONFIG.fallout = 'off';
  const n0 = w.bk.store.rec.fallout.length;
  fallout.addFallout({ x: 50, y: 64, z: 50 }, 4, 1);
  check('with fallout off, nothing is left anywhere', w.bk.store.rec.fallout.length === n0);
  fades?.onRandomTick({ block: far });
  check('and what was glowing goes out', id(44, 63, 30) === 'minecraft:grass_block');
  w.bk.CONFIG.fallout = 'land';
}

console.log('\n== 15. Bigger, louder, out of control (1.3)');
{
  const P3 = (w) => w.bk.ctl.creature;
  // ---- the atomic breath keeps time with its recording ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const a = w.sim.addPlayer('Ana', { x: 56, y: 64, z: -80 }); a.health = 1e6;
    const c = standThree(w, { x: 0, y: 64, z: -80 }, -90, 5);       // tier 3
    w.sim.step(5);
    const t0 = w.sim.save.tick;
    w.bk.ctl.brain.forced = { name: 'beam', run: w.bk.ctl.brain.beam(a), limit: 2000 };
    const phases = [];
    let last = -1;
    for (let i = 0; i < 700; i++) { w.sim.step(1); const ph = c.entity.getProperty(P('phase')); if (ph !== last) { phases.push([ph, w.sim.save.tick - t0]); last = ph; } }
    const at = (ph) => (phases.find(([p]) => p === ph) ?? [0, -1])[1];
    const heard = (id) => (a.heard.find((q) => q.id === id && q.tick >= t0) ?? { tick: -1 }).tick - t0;
    const chargeAt = heard('basiliskra.iii.charge'), beamAt = heard('basiliskra.iii.beam');
    check('the charge lasts as long as the charging part of the recording (6.85 s), and he fires on the tick the shot begins', chargeAt >= 0 && beamAt - chargeAt === 137 && Math.abs(at(19) - beamAt) <= 1, `charge sound ${chargeAt}, beam sound ${beamAt}, fire phase ${at(19)}`);
    check('he fires for as long as the shot sounds (about 7.7 s), then vents', at(20) - at(19) === 155, JSON.stringify(phases));
    check('and after firing he roars', at(23) > at(20) && a.heard.some((q) => q.tick > t0 + at(20) && /basiliskra\.roar/.test(q.id)));
    check('the beam is wider, smokes and glows, and blasts where it lands', a.seen.some((q) => q.id === 'basiliskra:beam_glow') && a.seen.some((q) => q.id === 'basiliskra:beam_smoke') && a.seen.some((q) => q.id === 'basiliskra:impact_smoke') && a.seen.some((q) => q.id === 'minecraft:huge_explosion_emitter'));
    const ground = []; for (let x = 20; x <= 90; x++) for (let z = -100; z <= -60; z++) for (let y = 50; y <= 63; y++) if (w.sim.blockId('minecraft:overworld', x, y, z) === 'minecraft:air') ground.push([x, y, z]);
    const fire = []; for (let x = 20; x <= 90; x++) for (let z = -100; z <= -60; z++) for (let y = 50; y <= 66; y++) if (w.sim.blockId('minecraft:overworld', x, y, z) === 'minecraft:fire') fire.push([x, y, z]);
    const deepest = Math.min(...ground.map((g) => g[1]));
    check('like the Wither it blows a crater in the ground, and the crater burns', ground.length > 40 && fire.length > 0, `${ground.length} blocks gone, ${fire.length} fires, deepest y ${deepest}`);
    check('the crater is a crater, not an endless tunnel', deepest >= 50, `deepest y ${deepest}`);
    const shakes = w.sim.log.commands.filter((q) => /^camerashake add @s/.test(q)).map((q) => Number(q.split(' ')[3]));
    check('the screen shakes while he fires and roars, never wildly', shakes.length > 10 && Math.max(...shakes) <= 0.75 && Math.max(...shakes) >= 0.3, `${shakes.length} shakes, strongest ${Math.max(...shakes).toFixed(2)}`);
  }
  // ---- a roar: a shockwave that throws, hurts, and breaks what is brittle ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const near = w.sim.addPlayer('Near', { x: 14, y: 64, z: 0 }); near.health = 1000;
    const far = w.sim.addPlayer('Far', { x: 0, y: 64, z: 70 }); far.health = 1000;
    const flowers = [];
    for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12; flowers.push([Math.round(Math.cos(a) * 16), Math.round(Math.sin(a) * 16)]); }
    for (const [x, z] of flowers) w.sim.setBlock('minecraft:overworld', x, 64, z, 'minecraft:poppy');
    for (let x = -8; x <= -4; x++) w.sim.setBlock('minecraft:overworld', x, 64, -20, 'minecraft:glass');
    w.sim.setBlock('minecraft:overworld', 9, 64, -9, 'minecraft:chest');
    const c = standThree(w, { x: 0, y: 64, z: 0 }, 0, 5);
    const cow = w.sim.attach(w.sim.newRecord('minecraft:cow', 'minecraft:overworld', { x: -12, y: 64, z: 8 }), 'entitySpawn'); cow.rec.family = ['cow', 'mob'];
    w.sim.flush();
    const n0 = { ...near.location }, f0 = { ...far.location }, c0 = { ...cow.rec.loc };
    const run = w.bk.ctl.brain.roar(false);
    w.bk.ctl.brain.forced = { name: 'roar', run, limit: 200 };
    for (let i = 0; i < 100; i++) w.sim.step(1);
    const out = (p0, p1) => Math.hypot(p1.x, p1.z) - Math.hypot(p0.x, p0.z);
    check('the shockwave throws a player near him outward, and hurts', out(n0, near.location) > 0.5 && near.health < 1000, `moved out ${out(n0, near.location).toFixed(2)}, health ${near.health}`);
    check('one far beyond it is not touched', far.health === 1000 && out(f0, far.location) === 0);
    check('creatures in its way are thrown and hurt too', cow.rec.health < 10 || !cow.isValid || Math.hypot(cow.rec.vel.x, cow.rec.vel.z) > 0.3);
    const id = (x, y, z) => w.sim.blockId('minecraft:overworld', x, y, z);
    const flat = flowers.filter(([x, z]) => id(x, 64, z) === 'minecraft:air').length;
    const panes = [-8, -7, -6, -5, -4].filter((x) => id(x, 64, -20) === 'minecraft:air').length;
    check('the land takes it: flowers are flattened and glass shatters (wither mode), the chest stands', flat >= 16 && panes >= 3 && id(9, 64, -9) === 'minecraft:chest', `${flat} of 24 flowers, ${panes} of 5 panes`);
    const shakes = w.sim.log.commands.filter((q) => /^camerashake add @s/.test(q));
    check('his roar shakes every screen near him', shakes.length >= 6);
    // and in scorch mode the glass is left
    const w2 = start(); w2.sim.terrainFn = TERRAINS.flat; open(w2); w2.bk.CONFIG.terrain = 'scorch';
    w2.sim.addPlayer('Near', { x: 14, y: 64, z: 0 });
    for (let x = -8; x <= -4; x++) w2.sim.setBlock('minecraft:overworld', x, 64, -20, 'minecraft:glass');
    for (const [x, z] of flowers) w2.sim.setBlock('minecraft:overworld', x, 64, z, 'minecraft:poppy');
    standThree(w2, { x: 0, y: 64, z: 0 }, 0, 5);
    w2.bk.ctl.brain.forced = { name: 'roar', run: w2.bk.ctl.brain.roar(false), limit: 200 };
    for (let i = 0; i < 100; i++) w2.sim.step(1);
    const flat2 = flowers.filter(([x, z]) => w2.sim.blockId('minecraft:overworld', x, 64, z) === 'minecraft:air').length;
    check('not destroying the world, the roar still flattens plants but leaves glass', [-8, -7, -6, -5, -4].every((x) => w2.sim.blockId('minecraft:overworld', x, 64, -20) === 'minecraft:glass') && flat2 >= 16, `${flat2} flowers`);
  }
  // ---- out of control: he goes after animals, roars at random, grunts ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const watcher = w.sim.addPlayer('Watcher', { x: -20, y: 64, z: 70 }); watcher.mode = 'Creative';
    const c = standThree(w, { x: 0, y: 64, z: 0 }, 0, 0);
    const cow = w.sim.attach(w.sim.newRecord('minecraft:cow', 'minecraft:overworld', { x: 30, y: 64, z: 60 }), 'entitySpawn'); cow.rec.family = ['cow', 'mob'];
    w.sim.flush();
    const d0 = Math.hypot(c.pos.x - 30, c.pos.z - 60);
    let closest = d0, hurtAt = -1;
    for (let i = 0; i < 2400 && cow.isValid; i++) {
      w.sim.step(1);
      if (cow.isValid) closest = Math.min(closest, Math.hypot(c.pos.x - cow.rec.loc.x, c.pos.z - cow.rec.loc.z));
      if (hurtAt < 0 && w.sim.log.damage.some((q) => q.id === cow.id)) hurtAt = i;
    }
    check('he goes after an animal near him, with no player to hunt', closest < d0 - 10, `${d0.toFixed(0)} -> ${closest.toFixed(0)} blocks`);
    check('and it is hurt (trodden, blasted or burned)', hurtAt >= 0, `first hurt at ${hurtAt}`);
    const roars = []; let lastPh = -1;
    const voice = () => watcher.heard.filter((q) => /basiliskra\.iii\.(grunt|breath|growl)/.test(q.id));
    const v0 = voice().length;
    for (let i = 0; i < 18000; i++) {
      w.sim.step(1);
      // the watcher keeps him in sight (and his country loaded), from a safe 40 blocks
      if (i % 100 === 0) { const f = { x: -Math.sin(c.yaw * Math.PI / 180), z: Math.cos(c.yaw * Math.PI / 180) }; watcher.moveTo({ x: c.pos.x - f.z * 40, y: 64, z: c.pos.z + f.x * 40 }); }
      const ph = c.entity.getProperty(P('phase'));
      if (ph === 23 && lastPh !== 23 && w.bk.ctl.brain.actName === 'roar') roars.push(w.sim.save.tick);     // the roars that come of nothing
      lastPh = ph;
    }
    const gaps = roars.slice(1).map((t, i) => t - roars[i]);
    check('left to himself he roars now and then, never on a beat', roars.length >= 2 && gaps.every((g) => g >= 60 * 20) && new Set(gaps.map((g) => Math.round(g / 100))).size === gaps.length, `${roars.length} roars in 15 min, gaps ${gaps.map((g) => (g / 20).toFixed(0) + 's').join(' ')}`);
    const v = voice().slice(v0);
    check('and grunts and breathes in between, from his recorded voice', v.length >= 12, `${v.length} sounds in 15 minutes`);
  }
  // ---- hit volumes: on the legs, through the walk, never under the ground ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    w.sim.addPlayer('Ana', { x: 0, y: 64, z: 60 }).mode = 'Creative';
    const c = standThree(w, { x: 0, y: 64, z: 0 }, 0, 0);
    const brain = w.bk.ctl.brain;
    brain.forced = { name: 'test', run: (function* () { yield* brain.walk({ x: 0, y: 64, z: 80 }, 0.13, 3, 2000); yield* forever(); })(), limit: 1e9 };
    const feet = [];
    for (let i = 0; i < 300; i++) {
      w.sim.step(1);
      const vols = [...w.sim.loaded.values()].filter((e) => e.rec.typeId.startsWith('basiliskra:hitbox'));
      const lowest = Math.min(...vols.map((e) => e.rec.loc.y));
      // the foot volume of the left hind: its place along his line, relative to his middle
      const owner = [...w.bk.partOwner.entries()].filter(([, o]) => o.tag === 'limb').map(([id]) => w.sim.loaded.get(id)).filter(Boolean);
      const along = owner.map((e) => (e.rec.loc.z - c.pos.z));
      feet.push({ lowest, along });
    }
    const n = feet[0].along.length;
    const swing = [];
    for (let k = 0; k < n; k++) { const zs = feet.map((f) => f.along[k]).filter((v) => v !== undefined); swing.push(Math.max(...zs) - Math.min(...zs)); }
    check('Form III has hit volumes on all four legs', n >= 8, `${n} limb volumes`);
    check('they move with the legs as he walks (each sweeps several blocks along his body)', swing.filter((s) => s > 3).length >= 4, swing.map((s) => s.toFixed(1)).join(' '));
    check('and none of them is sunk under the ground he stands on', feet.every((f) => f.lowest >= 63.7), `lowest ${Math.min(...feet.map((f) => f.lowest)).toFixed(2)}`);
    const sizes = [...w.sim.loaded.values()].filter((e) => e.rec.typeId.startsWith('basiliskra:hitbox')).map((e) => e.rec.typeId.split(':')[1]);
    check('the volumes are sized for a body 1.7 times the model (each size its own entity type: nothing is resized)', sizes.some((q) => /hitbox_[789]/.test(q)), [...new Set(sizes)].sort().join(' '));
    // a swing the game did not land on a volume, aimed at his head from within reach, still wounds him
    {
      const w5 = start(); w5.sim.terrainFn = TERRAINS.flat; open(w5);
      const al = w5.sim.addPlayer('Al', { x: 0, y: 64, z: 0 });
      const c5 = standThree(w5, { x: 0, y: 64, z: 60 }, 180, 0);
      w5.bk.ctl.brain.forced = { name: 'still', run: forever(), limit: 1e9 };
      w5.sim.step(6);
      const nose = c5.anchor('nose');
      al.moveTo({ x: nose.x, y: nose.y - 1.62, z: nose.z - 3.2 });      // in the air in front of his snout, three blocks off
      al.view = { x: 0, y: 0, z: 1 };
      const hp = () => w5.bk.ctl.creature.entity.getComponent('minecraft:health').currentValue;
      const h0 = hp();
      al.swing('minecraft:diamond_sword'); w5.sim.step(5);
      const h1 = hp();
      check('a sword swung at his snout from three blocks off wounds him, with no volume reported hit by the game', h0 - h1 >= 8, `${h0} -> ${h1}`);
      al.view = { x: 0, y: 1, z: 0 }; al.swing('minecraft:diamond_sword'); w5.sim.step(5);
      check('a swing at the sky does nothing', hp() === h1);
      al.view = { x: 0, y: 0, z: 1 };
      for (let y = -2; y <= 4; y++) for (let x = -3; x <= 3; x++) w5.sim.setBlock('minecraft:overworld', Math.floor(nose.x) + x, Math.floor(nose.y) + y, Math.floor(nose.z) - 2, 'minecraft:stone');
      w5.sim.step(10); al.swing('minecraft:diamond_sword'); w5.sim.step(5);
      check('nor does one with a wall between them', hp() === h1, `${h1} -> ${hp()}`);
    }
    // every point on the surface of every solid part of every form is inside a hit volume, or within a block of one
    for (const form of [1, 2, 3]) {
      const rig = w.bk.rig, k = rig.drawScale(form) / 16, rest = new rig.Skeleton(form, {});
      const parts = w.bk.creature.partsFor(form).map((q) => ({ c: rest.point(q.bone, q.at).map((v) => v * k), h: w.bk.creature.SIZES[q.si] / 2 }));
      let worst = 0, where = '';
      for (const [bone, [lo, hi]] of Object.entries(w.bk.RIGS[form].boxes)) {
        for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) for (const fz of [0, 0.5, 1]) {
          const q = rest.point(bone, [lo[0] + (hi[0] - lo[0]) * fx, lo[1] + (hi[1] - lo[1]) * fy, lo[2] + (hi[2] - lo[2]) * fz]).map((v) => v * k);
          let best = 1e9;
          for (const b of parts) best = Math.min(best, Math.hypot(Math.max(0, Math.abs(q[0] - b.c[0]) - b.h), Math.max(0, Math.abs(q[1] - b.c[1]) - b.h), Math.max(0, Math.abs(q[2] - b.c[2]) - b.h)));
          if (best > worst) { worst = best; where = bone; }
        }
      }
      check(`Basiliskra ${['', 'I', 'II', 'III'][form]}: hit volumes reach from nose to tail (no point of his body is a block outside them)`, worst <= 1.0 && parts.length <= 40, `${parts.length} volumes, worst ${worst.toFixed(2)} blocks at ${where}`);
    }
  }
  // ---- settings: presets and typed numbers, and a world saved by 1.2 ----
  {
    const ui = (() => { const w = start(); return w.bk.ui; })();
    check('a picked preset, a typed number, "x1.5" and "1,5" are all understood; nonsense keeps the choice above it',
      ui.pickNumber([0.5, 1, 2], 2, '', 1, 0.25, 4) === 2 && ui.pickNumber([0.5, 1, 2], 0, '1.25', 1, 0.25, 4) === 1.25 &&
      ui.pickNumber([0.5, 1, 2], 0, 'x1.5', 1, 0.25, 4) === 1.5 && ui.pickNumber([0.5, 1, 2], 0, '1,5', 1, 0.25, 4) === 1.5 &&
      ui.pickNumber([0.5, 1, 2], 1, 'lots', 1, 0.25, 4) === 1 && ui.pickNumber([0.5, 1, 2], 1, '9', 1, 0.25, 4) === 1);
    const save = new Save();
    save.worldProps.set('bk:cfg', JSON.stringify({ pacing: 1.5, terrain: 'scorch', marks: true, damage: 1, fallout: 'land' }));
    const w = start(save); open(w);
    check('a world whose settings were saved by 1.2 gets the new default destruction (it had never chosen)', w.bk.CONFIG.terrain === 'wither' && w.bk.CONFIG.pacing === 1.5);
    w.bk.settings.saveSettings({ terrain: 'scorch' });
    w.restart(); w.sim.step(2);
    check('one that chooses "scorch" in 1.3 keeps it', w.bk.CONFIG.terrain === 'scorch' && w.bk.CONFIG.pacing === 1.5);
  }
  // ---- the journal counts kills as kills ----
  {
    const w = start(); open(w);
    const jo = w.sim.addPlayer('Jo', { x: 10, y: 64, z: 10 });
    for (let i = 0; i < 3; i++) kill(w, jo, 'minecraft:cow', { x: 12 + i, y: 64, z: 12 });
    w.sim.step(2);
    const page = () => { const f = jo.forms.filter((q) => q.title === 'Basiliskra Journal').pop(); return f ? f.body : ''; };
    jo.use('basiliskra:journal'); w.sim.step(2);
    check('three animals killed reads as three, not as a percentage', /Animals killed here by players: §f3§7/.test(page()) && /You, everywhere: §f3§7 animals killed/.test(page()), page().split('\n').slice(1, 5).join(' / '));
    const p1 = Number((/(\d+)%§r §7of what calls him/.exec(page()) ?? [0, -1])[1]);
    check('the progress figure counts the kills even with no trees cut yet', p1 > 0, `${p1}%`);
    jo.loc = { x: 75, y: 64, z: 10 }; jo.use('basiliskra:journal'); w.sim.step(2);
    check('a step over the area\'s edge does not make it vanish', /Animals killed here by players: §f3§7/.test(page()));
  }
  // ---- spawned on purpose, he keeps to where he was brought, not to an old coast ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const rec = w.bk.store.rec;
    // a world where he once arrived at a far coast: the seam and that coast are 300 blocks off
    Object.assign(rec, { rift: { x: 300, y: 56, z: 300, yaw: 0 }, origin: { x: 300, y: 64, z: 290 } });
    const bo = w.sim.addPlayer('Bo', { x: 0, y: 64, z: 0 }); bo.mode = 'Creative'; bo.view = { x: 0, y: 0, z: 1 };
    w.sim.runCommand('basiliskra:spawn', bo, 'iii'); w.sim.step(3);
    const c = w.bk.ctl.creature;
    let far = 0;
    for (let i = 0; i < 6000; i++) { w.sim.step(1); far = Math.max(far, Math.hypot(c.pos.x, c.pos.z)); }
    check('spawned by command beside a Creative player, he stays round them and never sets off for the old coast', far < 90 && Math.hypot(c.pos.x - 300, c.pos.z - 290) > 250, `farthest ${far.toFixed(0)} from the player, home ${JSON.stringify(rec.home && { x: Math.round(rec.home.x), z: Math.round(rec.home.z) })}`);
    w.bk.ctl.driveOff(true);
    rec.down -= 30000;
    let back = null;                                       // (his absence is looked at every five seconds)
    for (let i = 0; i < 220 && !back; i++) { w.sim.step(1); if (w.bk.ctl.creature) back = { ...w.bk.ctl.creature.pos }; }
    check('sent back, he returns where he was brought, on land, not to the old seam', !!back && Math.hypot(back.x - rec.home.x, back.z - rec.home.z) < 4 && back.y >= 63.5, back ? `at ${back.x.toFixed(0)}, ${back.y.toFixed(1)}, ${back.z.toFixed(0)}` : 'not back');
  }
  // ---- the window, at his new size ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.village; open(w);
    w.sim.save.timeOfDay = 15000;
    const inside = w.sim.addPlayer('Inside', { x: 0.5, y: 64, z: 0.5 });
    const c = standThree(w, { x: 70, y: 64, z: 0.5 }, 90, 0);
    w.bk.ctl.brain.forced = { name: 'window', run: w.bk.ctl.brain.window(inside), limit: 4000 };
    let best = null;
    for (let i = 0; i < 3000; i++) {
      w.sim.step(1);
      if (c.phase === 'window') { const e = c.anchor('eye_l'); best = { x: e.x, y: e.y, z: e.z }; break; }
    }
    // the window that matters: the east wall (x = 3), panes at z 0..1, y 65..66
    check('at the window one eye hangs just outside the glass, level with it', best && best.x > 4 && best.x < 7.5 && best.y >= 65 && best.y <= 67.2 && Math.abs(best.z - 1) < 1.6,
      best ? `eye at ${best.x.toFixed(2)}, ${best.y.toFixed(2)}, ${best.z.toFixed(2)}` : 'never reached the window');
  }
}

console.log('\n== 16. Calling, sending away, changing (1.4)');
{
  const tick = async (w, n) => { for (let i = 0; i < n; i++) { w.sim.step(1); if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0)); } };
  // ---- Call him now: no dusk, no waiting; the rift opens in the nearest deep water and Basiliskra I comes through ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.bay; open(w);
    w.sim.save.timeOfDay = 6000;                                       // noon: nothing in the old story happened at noon
    const op = w.sim.addPlayer('Op', { x: -6.5, y: 64, z: 24 });
    const msg = w.bk.ctl.callNow(op.location, op);
    check('Call him now answers that the rift is opening, at once', /rift is opening in the water/.test(msg) && w.bk.store.rec.stage === 'arriving', msg);
    let seenRift = false, born = -1;
    for (let i = 0; i < 1200 && w.bk.store.rec.stage !== 'alive'; i++) {
      w.sim.step(1);
      if (!seenRift && op.seen.some((q) => q.id === 'basiliskra:rift_tear')) seenRift = true;
      if (born < 0 && w.sim.count(TYPE) === 1) born = i;
    }
    check('the rift tears open and he comes through it within the minute, at noon', seenRift && born > 0 && born < 400 && w.bk.store.rec.stage === 'alive' && w.bk.ctl.creature?.form === 1, `rift ${seenRift}, body at tick ${born}, stage ${w.bk.store.rec.stage}`);
    const cam = op.cam.log;
    check('everyone near is shown it: the camera is taken, moved, and given back', cam.some((q) => q.preset === 'minecraft:free') && cam.some((q) => q.fade) && cam[cam.length - 1].clear === true && op.cam.held === false, `${cam.filter((q) => q.preset).length} camera moves`);
    check('heard from far off: a player 180 blocks away hears the rift', (() => { const far = w.sim.addPlayer('Far', { x: 180, y: 64, z: 24 }); w.sim.step(1); const h0 = far.heard.length; w.bk.ctl.sendAway(); return far.heard.length > h0; })());
    const again = w.bk.ctl.callNow(op.location, op);
    check('sent away, he can be called again at once', /rift is opening/.test(again), again);
  }
  // ---- with no deep water near, it says so and does nothing ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const op = w.sim.addPlayer('Op', { x: 0, y: 64, z: 0 });
    const msg = w.bk.ctl.callNow(op.location, op);
    check('with no deep water in reach, Call him now says what it needs', /none within 96 blocks/.test(msg) && w.bk.store.rec.stage === 'dormant', msg);
    const no = w.bk.ctl.bringHere({ x: 10, y: 64, z: 10 }, 0, 1);
    check('and Basiliskra I cannot be brought onto dry land', /deep water/.test(no) && w.sim.count(TYPE) === 0, no);
  }
  // ---- driven off as Basiliskra III, called back: the rift opens on land and he walks out of it ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const op = w.sim.addPlayer('Op', { x: 0, y: 64, z: 0 }); op.mode = 'Creative'; op.view = { x: 0, y: 0, z: 1 };
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 46 }, 180, 3); w.sim.step(5);
    const id0 = w.bk.ctl.creature.entity.id;
    w.bk.ctl.driveOff(true); w.sim.step(3);
    const msg = w.bk.ctl.callNow(op.location, op, w.bk.ui.placeFor(op, 3));
    check('owed back as Basiliskra III, he is called through a rift on land', /in front of you/.test(msg) && w.bk.store.rec.arrival?.land === true, msg);
    let hidden = false, lows = new Set();
    for (let i = 0; i < 1500 && w.bk.store.rec.stage !== 'alive'; i++) {
      w.sim.step(1);
      const c = w.bk.ctl.creature;
      if (c) { const lo = c.entity.getProperty(P('vis_lo')); lows.add(lo); if (lo === 9) hidden = true; }
    }
    const c = w.bk.ctl.creature;
    check('he is made unseen behind the tear and revealed as he walks through it, head first', hidden && lows.size >= 4 && c?.entity.getProperty(P('vis_lo')) === 0, [...lows].join(','));
    check('one Basiliskra III stands there, and then he roars', w.sim.count(TYPE) === 1 && c.form === 3 && c.entity.id !== id0 && (() => { for (let i = 0; i < 40; i++) w.sim.step(1); return c.entity.getProperty(P('phase')) === 23; })());
    check('the camera is given back after the scene', (() => { for (let i = 0; i < 400; i++) w.sim.step(1); return op.cam.held === false && op.cam.log.some((q) => q.preset); })());
  }
  // ---- Make him change now: the scene, the light climbing him, the next form, the roar ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const op = w.sim.addPlayer('Op', { x: 0, y: 64, z: 0 }); op.mode = 'Creative';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 30 }, 180, 2); w.sim.step(5);
    const id0 = w.bk.ctl.creature.entity.id;
    const msg = w.bk.ctl.evolveNow();
    let maxCharge = 0, forms = new Set();
    for (let i = 0; i < 400; i++) { w.sim.step(1); const c = w.bk.ctl.creature; maxCharge = Math.max(maxCharge, c.entity.getProperty(P('charge'))); forms.add(c.form); }
    check('Make him change now: the same animal becomes Basiliskra III, lit from tail to head as it happens', /changing into Basiliskra III/.test(msg) && w.bk.ctl.creature.entity.id === id0 && w.bk.ctl.creature.form === 3 && maxCharge === 20 && w.bk.store.rec.evolve === null, `${msg} charge ${maxCharge}`);
    check('the change is shown to those near, and it shakes the ground', op.cam.log.some((q) => q.preset) && op.seen.some((q) => q.id === 'basiliskra:mutate_gather') && op.seen.some((q) => q.id === 'basiliskra:mutate_burst'));
    const msg4 = w.bk.ctl.evolveNow();
    for (let i = 0; i < 520; i++) w.sim.step(1);
    check('and again: the same animal becomes Basiliskra IV', /changing into Basiliskra IV/.test(msg4) && w.bk.ctl.creature.entity.id === id0 && w.bk.ctl.creature.form === 4 && w.bk.ctl.creature.entity.getProperty(P('form')) === 4
      && w.bk.ctl.creature.entity.nameTag === 'Basiliskra IV', msg4);
    check('at his last form there is nothing further', /last form/.test(w.bk.ctl.evolveNow()));
  }
  // ---- brought by someone flying high above the ground: he is put on the ground, and still thinks ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const op = w.sim.addPlayer('Op', { x: 0, y: 140, z: 0 }); op.mode = 'Creative'; op.view = { x: 0, y: 0, z: 1 };
    const place = w.bk.ui.placeFor(op, 3);
    check('the place he is brought to is on the ground under it, however high the caller flies', Math.abs(place.at.y - 64) < 0.01, `y ${place.at.y}`);
    w.bk.ctl.bringHere({ x: 0, y: 130, z: 30 }, 180, 3);               // and even if he is made in mid-air
    for (let i = 0; i < 120; i++) w.sim.step(1);
    const c = w.bk.ctl.creature;
    op.moveTo({ x: 0, y: 64, z: 0 });
    const p0 = { ...c.pos };
    for (let i = 0; i < 600; i++) w.sim.step(1);
    check('made in mid-air he comes down to the ground', Math.abs(c.pos.y - 64) < 0.6, `y ${c.pos.y.toFixed(1)}`);
    check('and goes on living (he moves, he chooses what to do)', Math.hypot(c.pos.x - p0.x, c.pos.z - p0.z) > 3 && w.bk.ctl.brain.actName !== 'none', `${w.bk.ctl.brain.actName}, moved ${Math.hypot(c.pos.x - p0.x, c.pos.z - p0.z).toFixed(1)}`);
  }
}

console.log('\n== 17. A way round, and a way through (1.4)');
{
  // a pocket: walls on three sides, open towards him, and where he is going lies beyond its closed end
  const pocket = (w, tall = 13) => {
    for (let y = 64; y < 64 + tall; y++) {
      for (let x = -30; x <= 30; x++) w.sim.setBlock('minecraft:overworld', x, y, 44, 'minecraft:stone_bricks');
      for (let z = 4; z <= 44; z++) { w.sim.setBlock('minecraft:overworld', -30, y, z, 'minecraft:stone_bricks'); w.sim.setBlock('minecraft:overworld', 30, y, z, 'minecraft:stone_bricks'); }
    }
  };
  const inWall = (c) => (Math.abs(c.pos.z - 44) < 1 && Math.abs(c.pos.x) <= 30) || (Math.abs(Math.abs(c.pos.x) - 30) < 1 && c.pos.z >= 4 && c.pos.z <= 44);
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w); w.bk.CONFIG.terrain = 'scorch';
    w.sim.addPlayer('Ana', { x: 0, y: 64, z: 30 }).mode = 'Creative';
    pocket(w);
    const c = standThree(w, { x: 0, y: 64, z: 14 }, 0, 0);
    const brain = w.bk.ctl.brain;
    let done = false, ok = false, crossed = 0, planned = false, ticks = 0;
    brain.forced = { name: 'test', run: (function* () { ok = yield* brain.walk({ x: 0, y: 64, z: 84 }, 0.14, 5, 6000); done = true; yield* forever(); })(), limit: 1e9 };
    for (; ticks < 6000 && !done; ticks++) { w.sim.step(1); if (inWall(c)) crossed++; if (c.planning) planned = true; }
    check('Basiliskra III, not destroying: walked into a pocket of walls he works out the way back out and round it', done && ok && planned && crossed === 0 && Math.hypot(c.pos.x, c.pos.z - 84) < 8, `${ticks} ticks, planned ${planned}, ended ${c.pos.x.toFixed(0)},${c.pos.z.toFixed(0)}`);
    const walls = []; for (let x = -30; x <= 30; x++) walls.push(w.sim.blockId('minecraft:overworld', x, 66, 44));
    check('and the walls are as they were', walls.every((q) => q === 'minecraft:stone_bricks'));
  }
  {
    // Basiliskra II drags himself: the same pocket, smaller
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    w.sim.addPlayer('Ana', { x: 0, y: 64, z: 30 }).mode = 'Creative';
    pocket(w, 6);
    const rec = w.bk.store.rec;
    Object.assign(rec, { stage: 'alive', token: 'pockettoken00000000000000000000', form: 2, born: 1, rift: { x: 400, y: 56, z: 400, yaw: 0 }, origin: { x: 0, y: 64, z: 0 } });
    rec.mut.formSince = rec.clock;
    const r = w.sim.newRecord(TYPE, 'minecraft:overworld', { x: 0, y: 64, z: 16 }, 0);
    r.dyn['bk:token'] = rec.token; rec.entityId = r.id; w.bk.store.save();
    w.sim.attach(r, 'entityLoad'); w.sim.flush(); w.sim.step(3);
    const c = w.bk.ctl.creature, brain = w.bk.ctl.brain;
    let done = false, ok = false, ticks = 0;
    brain.forced = { name: 'test', run: (function* () { ok = yield* brain.drag({ x: 0, y: 64, z: 70 }, 5, 14000); done = true; yield* forever(); })(), limit: 1e9 };
    for (; ticks < 14000 && !done; ticks++) w.sim.step(1);
    check('Basiliskra II finds his way out of it and round it too', done && ok && Math.hypot(c.pos.x, c.pos.z - 70) < 8, `${ticks} ticks, ended ${c.pos.x.toFixed(0)},${c.pos.z.toFixed(0)}`);
  }
  {
    // like the Wither (the default): a slope, a cliff, a wood and a house are in his path
    const w = start(); w.sim.terrainFn = (dim, x, y, z) => {
      if (dim !== 'minecraft:overworld') return 'minecraft:air';
      if (y <= 60) return 'minecraft:stone';
      if (y <= 62) return 'minecraft:dirt';
      if (y === 63) return 'minecraft:grass_block';
      if (z >= 16 && z <= 28 && y <= 63 + Math.min(z - 15, 29 - z, 4)) return 'minecraft:dirt';          // a rise he can walk over: four blocks, gently
      if (z >= 40 && z <= 50 && y <= 74) return 'minecraft:stone';                                       // a sheer ridge, eleven blocks high, across his way
      if (z >= 58 && z <= 64 && (x + 400) % 5 === 0 && y <= 70) return 'minecraft:oak_log';              // a wood
      if (z >= 58 && z <= 64 && y >= 68 && y <= 71) return 'minecraft:oak_leaves';
      if (z >= 72 && z <= 80 && Math.abs(x) <= 5 && y <= 69 && (Math.abs(x) === 5 || z === 72 || z === 80 || y === 69)) return 'minecraft:bricks';   // a house
      return 'minecraft:air';
    }; open(w);
    w.sim.addPlayer('Ana', { x: 30, y: 64, z: 50 }).mode = 'Creative';
    w.sim.setBlock('minecraft:overworld', 0, 64, 76, 'minecraft:chest');
    const c = standThree(w, { x: 0, y: 64, z: 0 }, 0, 0);
    const brain = w.bk.ctl.brain;
    let done = false, ok = false, wide = 0, lowest = 99, highest = 0, onRise = 0, ticks = 0;
    brain.forced = { name: 'test', run: (function* () { ok = yield* brain.walk({ x: 0, y: 64, z: 104 }, 0.14, 4, 4000); done = true; yield* forever(); })(), limit: 1e9 };
    for (; ticks < 4000 && !done; ticks++) {
      w.sim.step(1);
      wide = Math.max(wide, Math.abs(c.pos.x)); lowest = Math.min(lowest, c.pos.y); highest = Math.max(highest, c.pos.y);
      if (c.pos.z > 20 && c.pos.z < 24) onRise = Math.max(onRise, c.pos.y);
    }
    const id = (x, y, z) => w.sim.blockId('minecraft:overworld', x, y, z);
    check('he walks straight through a cliff, a wood and a house', done && ok && wide < 2.5 && Math.hypot(c.pos.x, c.pos.z - 104) < 6, `${ticks} ticks, strayed ${wide.toFixed(1)} blocks, ended ${c.pos.x.toFixed(0)},${c.pos.z.toFixed(0)}`);
    let rise = 0; for (let z = 16; z <= 28; z++) for (let x = -4; x <= 4; x++) for (let y = 64; y <= 67; y++) if (id(x, y, z) === 'minecraft:dirt') rise++;
    check('a gentle rise he simply walks over, and leaves as it was', onRise > 65 && rise > 200, `stood ${onRise.toFixed(1)} high on it, ${rise} of its blocks still there`);
    let standing = 0, cliffLeft = 0, floorGone = 0;
    for (let z = 40; z <= 80; z++) for (let x = -4; x <= 4; x++) {
      for (let y = 64; y <= 78; y++) { const q = id(x, y, z); if (q === 'minecraft:air' || q === 'minecraft:chest') continue; if (z <= 50) { if (y >= 69) cliffLeft++; } else standing++; }
      if (id(x, 63, z) === 'minecraft:air') floorGone++;
    }
    check('the cliff is cut down to a step he can take, and the wood and the house are gone from his road', cliffLeft === 0 && standing === 0, `${cliffLeft} cliff blocks above the step, ${standing} blocks of wood or house still in it`);
    check('the ground he walked on is whole, and he never sank into it', floorGone === 0 && lowest > 63.5 && highest < 70, `${floorGone} floor blocks missing, y ${lowest.toFixed(1)} to ${highest.toFixed(1)}`);
    check('a chest in the house is left standing in the road', id(0, 64, 76) === 'minecraft:chest');
    check('beside his road the cliff still stands', id(16, 72, 45) === 'minecraft:stone');
  }
}

console.log('\n== 18. His themes, and his voice');
{
  const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
  const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 0 }); ana.mode = 'Creative';
  const rec = w.bk.store.rec;
  Object.assign(rec, { stage: 'alive', token: 'musictoken00000000000000000000000', form: 3, born: 1, rift: { x: 400, y: 56, z: 400, yaw: 0 }, origin: { x: 0, y: 64, z: -40 }, home: { x: 0, y: 64, z: -40 } });
  const r = w.sim.newRecord(TYPE, 'minecraft:overworld', { x: 0, y: 64, z: -40 }, 0);
  r.dyn['bk:token'] = rec.token; rec.entityId = r.id; w.bk.store.save();
  w.sim.attach(r, 'entityLoad'); w.sim.flush(); w.sim.step(45);
  check('while he is near and not fighting, the theme of his nearness plays (looping, faded in)', ana.music?.id === 'basiliskra.music.dread' && ana.music.loop === true && ana.music.fade > 0, JSON.stringify(ana.music));
  const c = w.bk.ctl.creature;
  const seq0 = r.props['basiliskra:fx_seq'];
  ana.seen.length = 0;
  w.bk.ctl.brain.forced = { name: 'beam', run: w.bk.ctl.brain.beam(null), limit: 1200 };
  w.sim.step(30);
  check('when he fights, it changes to the theme of his wrath', ana.music?.id === 'basiliskra.music.wrath', JSON.stringify(ana.music));
  let kinds = new Set(), fired = false;
  for (let i = 0; i < 700; i++) { w.sim.step(1); kinds.add(r.props['basiliskra:fx_kind']); if (c.phase === 'fire') fired = true; if (fired && c.phase === 'idle') break; }
  check('his mouth is told to move with his roar (the client times the jaw to the recording)', fired && (kinds.has(8) || kinds.has(9)) && r.props['basiliskra:fx_seq'] !== seq0, [...kinds].join(','));
  const drew = new Set(ana.seen.map((q) => q.id.replace('basiliskra:', '')));
  const wanted = ['beam_aim', 'muzzle_flash', 'muzzle_shock', 'beam_core', 'beam_ring', 'beam_arc'];
  check('the beam drew its aim line first, flared and shocked at the mouth, and sent rings and lightning down its length', wanted.every((n) => drew.has(n)),
    `missing: ${wanted.filter((n) => !drew.has(n)).join(', ') || 'none'}`);
  const aimAt = ana.seen.findIndex((q) => q.id === 'basiliskra:beam_aim'), coreAt = ana.seen.findIndex((q) => q.id === 'basiliskra:beam_core');
  check('the aim line comes before the beam, never with it', aimAt >= 0 && aimAt < coreAt && !ana.seen.slice(coreAt).some((q) => q.id === 'basiliskra:beam_aim'));
  for (let i = 0; i < 700 && ana.music?.id !== 'basiliskra.music.dread'; i++) w.sim.step(1);
  check('some time after the fighting stops it goes back', ana.music?.id === 'basiliskra.music.dread', JSON.stringify(ana.music));
  w.bk.CONFIG.music = false; w.sim.step(25);
  check('with his themes switched off nothing of his plays', ana.music === null);
  w.bk.CONFIG.music = true; w.sim.step(25);
  ana.moveTo({ x: 0, y: 64, z: 400 }); w.sim.step(60);
  check('out of earshot it plays on for a few seconds...', ana.music?.id === 'basiliskra.music.dread');
  w.sim.step(140);
  check('...and then fades out', ana.music === null && w.sim.log.commands.some((q) => q === 'music stop 3'));
  ana.moveTo({ x: 0, y: 64, z: 0 }); w.sim.step(25);
  w.bk.ctl.sendAway(); w.sim.step(25);
  check('and when he is sent away it stops', ana.music === null);
}

console.log('\n== 19. Basiliskra IV');
{
  const PH = { charge: 18, fire: 19, vent: 20, roar: 23, stare: 29, skid: 30, pivot: 31, recoil: 32, drag: 33, swallow: 34, carry: 35 };
  const fresh = (terrain = TERRAINS.flat) => {
    const w = start(); w.sim.terrainFn = terrain; open(w);
    const id = (x, y, z) => w.sim.blockId('minecraft:overworld', x, y, z);
    return { w, id };
  };
  const phaseOf = (w) => w.bk.ctl.creature.entity.getProperty(P('phase'));
  const hurtOf = (w, p, from = 0) => w.sim.log.damage.filter((d) => d.id === p.id && d.tick >= from).reduce((n, d) => n + d.amount, 0);
  const debutDone = (w) => { w.bk.store.rec.four = { debut: true, shots: 0, plate: null }; };
  const force = (w, name, run, limit = 4000) => { w.bk.ctl.brain.forced = { name, run, limit }; };

  // ---- brought into the world; his entrance ----
  {
    const { w, id } = fresh();
    const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 70 }); ana.mode = 'Creative';
    const behind = w.sim.addPlayer('Behind', { x: 30, y: 64, z: -40 }); behind.mode = 'Spectator';        // (so that the ground under his tail is loaded too)
    const said = w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4);
    w.sim.step(3);
    const c = w.bk.ctl.creature;
    check('he can be brought as Basiliskra IV: one of him, named, in his last form', /Basiliskra IV has come/.test(said) && w.sim.count(TYPE) === 1 && c.form === 4 && c.entity.getProperty(P('form')) === 4 && c.entity.nameTag === 'Basiliskra IV', said);
    const parts = w.bk.creature.partsFor(4);
    const tags = new Set(parts.map((q) => q.tag));
    check('hit volumes cover him too: head, body, limbs (wings among them) and every part of the tail', ['head', 'body', 'limb', 'tail'].every((t) => tags.has(t)) && parts.some((q) => /^wing_/.test(q.bone)) && parts.some((q) => q.bone === 'club')
      && parts.length >= 30 && parts.length <= 80 && w.sim.count('basiliskra:hitbox') === parts.length, `${parts.length} volumes, ${w.sim.count('basiliskra:hitbox')} entities`);
    const nose = c.anchor('nose'), club = c.anchor('club_core'), top = c.anchor('plate_tip_0');
    check('he is the size he is drawn: about fifty blocks to the eye, the club seventy behind him', nose.y - c.pos.y > 44 && nose.y - c.pos.y < 60 && club.z < -60 && top.y > c.pos.y + 30, `nose ${ (nose.y - c.pos.y).toFixed(1)} up, club at z ${club.z.toFixed(1)}`);
    // the debut: a thin beam, quiet, the line popping into glass back toward him, and only then the roar
    ana.heard.length = 0; ana.seen.length = 0;
    const took = until(w, () => w.bk.store.rec.four?.debut === true, 900);
    const heard = ana.heard.map((q) => q.id), pop0 = heard.indexOf('random.pop'), popN = heard.lastIndexOf('random.pop'), roar0 = heard.findIndex((q) => /^basiliskra\.roar/.test(q));
    let glass = 0; for (let z = 30; z <= 66; z++) if (id(0, 63, z) === 'basiliskra:scarlet_trinitite') glass++;
    for (let i = 0; i < 30; i++) w.sim.step(1);
    const heard2 = ana.heard.map((q) => q.id);
    check('his first act: a thin beam cuts a line across the ground toward whoever is watching', took > 0 && ana.seen.some((q) => q.id === 'basiliskra:beam_core') && ana.seen.some((q) => q.id === 'basiliskra:beam_impact'), `${took} ticks`);
    check('the line pops into glass one block at a time', glass >= 20 && heard.filter((q) => q === 'random.pop').length >= 20, `${glass} blocks of trinitite, ${heard.filter((q) => q === 'random.pop').length} pops`);
    check('and his first roar comes only after it', pop0 >= 0 && (roar0 < 0 || roar0 > popN) && heard2.includes('basiliskra.roar') && phaseOf(w) === PH.roar, `pops at ${pop0}..${popN}, the roar at ${heard2.indexOf('basiliskra.roar')}`);
    check('his theme is the last one', (() => { for (let i = 0; i < 30; i++) w.sim.step(1); return ana.music?.id === 'basiliskra.music.last'; })(), JSON.stringify(ana.music));
    w.bk.ctl.sendAway();
  }

  // ---- the stare ----
  {
    const { w } = fresh();
    const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 80 }); ana.health = 1000;
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4); w.sim.step(2); debutDone(w);
    const b = w.bk.ctl.brain;
    force(w, 'stare', b.stare(ana)); ana.effects = [];
    let seen = false; for (let i = 0; i < 120; i++) { w.sim.step(1); if (phaseOf(w) === PH.stare) seen = true; }
    const slow = (ana.effects ?? []).filter((e) => e.id === 'slowness');
    check('the stare: he looks at one player, and that player can barely walk', seen && slow.length >= 5 && slow.every((e) => e.amplifier === 2 && e.duration <= 60) && hurtOf(w, ana) === 0 && ana.messages.some((m) => /looking at you/.test(m)),
      `${slow.length} applications`);
    for (let i = 0; i < 200; i++) w.sim.step(1);
    const last = Math.max(...(ana.effects ?? []).filter((e) => e.id === 'slowness').map((e) => e.tick));
    const n0 = (ana.effects ?? []).filter((e) => e.id === 'slowness').length;
    for (let i = 0; i < 100; i++) w.sim.step(1);
    check('when he looks away it wears off: nothing renews it', (ana.effects ?? []).filter((e) => e.id === 'slowness').length === n0 || w.sim.save.tick - last > 60, `last applied ${w.sim.save.tick - last} ticks ago`);
    // something solid between you and his eye ends it early
    force(w, 'stare', b.stare(ana));
    for (let x = -30; x <= 30; x++) for (let y = 64; y <= 130; y++) w.sim.setBlock('minecraft:overworld', x, y, 50, 'minecraft:bedrock');
    ana.effects = [];
    for (let i = 0; i < 170; i++) w.sim.step(1);
    check('behind something solid he cannot hold you', (ana.effects ?? []).filter((e) => e.id === 'slowness').length <= 1);
    w.bk.ctl.sendAway();
  }

  // ---- he walks through the world, and every footfall is a crater ----
  {
    const { w, id } = fresh();
    const ana = w.sim.addPlayer('Ana', { x: 40, y: 64, z: 60 }); ana.mode = 'Creative';
    for (let x = -30; x <= 30; x++) for (let y = 64; y <= 96; y++) w.sim.setBlock('minecraft:overworld', x, y, 70, 'minecraft:stone_bricks');
    w.sim.setBlock('minecraft:overworld', 2, 64, 72, 'minecraft:chest');
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4); w.sim.step(2); debutDone(w);
    const c = w.bk.ctl.creature, b = w.bk.ctl.brain;
    force(w, 'walk', b.walk({ x: 0, y: 64, z: 130 }, 0.16, 6, 4000));
    const gaits = new Set(); let lo = 99, hi = -99, ticks = 0;
    for (; ticks < 3000 && c.pos.z < 122; ticks++) { w.sim.step(1); gaits.add(c.entity.getProperty(P('gait'))); lo = Math.min(lo, c.pos.y); hi = Math.max(hi, c.pos.y); }
    let wall = 0, far = 0; for (let x = -9; x <= 9; x++) for (let y = 64; y <= 96; y++) if (id(x, y, 70) !== 'minecraft:air') wall++;
    for (let y = 64; y <= 96; y++) if (id(30, y, 70) === 'minecraft:stone_bricks') far++;
    let pits = 0, centre = 0; for (let z = 10; z <= 110; z++) { for (let x = -14; x <= 14; x++) if (id(x, 63, z) === 'minecraft:air') pits++; if (id(0, 63, z) !== 'minecraft:grass_block') centre++; }
    check('he walks on two feet, left and right in turn', gaits.has(0) && gaits.has(1) && c.pos.z >= 122, `${ticks} ticks, z ${c.pos.z.toFixed(0)}`);
    check('a wall thirty-three blocks high in his road is simply gone where he went through it; beside his road it stands', wall === 0 && far === 33, `${wall} left in his way, ${far} of 33 at the side`);
    check('every footfall blows a crater in the ground', pits >= 60, `${pits} blocks of ground gone under his feet`);
    check('he walks through, not down: the ground under his middle is whole and he never sank', centre === 0 && lo > 63.4 && hi < 66, `${centre} missing on his line, y ${lo.toFixed(1)}..${hi.toFixed(1)}`);
    check('a chest in his road is left standing', id(2, 64, 72) === 'minecraft:chest');
    // if the engine will not empty a box for him he still gets through, block by block
    for (let x = -30; x <= 30; x++) for (let y = 64; y <= 80; y++) w.sim.setBlock('minecraft:overworld', x, y, 160, 'minecraft:stone_bricks');
    w.sim.refuseFill = true;
    ana.moveTo({ x: 40, y: 64, z: 150 }); w.sim.step(2);
    force(w, 'walk', b.walk({ x: 0, y: 64, z: 200 }, 0.16, 6, 4000));
    for (let i = 0; i < 3000 && c.pos.z < 190; i++) w.sim.step(1);
    let low = 0; for (let x = -6; x <= 6; x++) for (let y = 64; y <= 80; y++) if (id(x, y, 160) !== 'minecraft:air') low++;
    check('without the engine\'s fill he clears his road the slow way', c.pos.z >= 190 && low === 0, `z ${c.pos.z.toFixed(0)}, ${low} left`);
    w.sim.refuseFill = false;
    w.bk.ctl.sendAway();
  }

  // ---- the breath: from afar; the skid; the turn on the buried club ----
  {
    const { w } = fresh();
    const far = w.sim.addPlayer('Far', { x: 0, y: 64, z: 135 }); far.health = 100000;
    const anchor = w.sim.addPlayer('Watcher', { x: -40, y: 64, z: -20 }); anchor.mode = 'Creative';      // (keeps the ground he stands on loaded)
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4); w.sim.step(2); debutDone(w);
    const c = w.bk.ctl.creature, b = w.bk.ctl.brain;
    const pick = b.choose();
    check('he turns his breath on a player a hundred and twenty blocks from his mouth', pick?.name === 'beam' || pick?.name === 'stare', pick?.name);
    const club0 = c.anchor('club_core');
    const tail = w.sim.addPlayer('Tail', { x: club0.x + 2, y: 64, z: club0.z + 1 }); tail.health = 100000;
    force(w, 'beam', b.breath(far));
    const seen = new Set(); let fireAt = -1, liftAt = -1, sweepAt = -1, endAt = -1, bendAtLift = 0, yaw0 = c.yaw, z0 = c.pos.z, zSkid = 0, rMin = 1e9, rMax = 0, pivot = null, tailHurtBefore = 0;
    for (let i = 0; i < 700; i++) {
      w.sim.step(1);
      const ph = phaseOf(w); seen.add(ph);
      if (ph === PH.fire && fireAt < 0) { fireAt = i; yaw0 = c.yaw; z0 = c.pos.z; }
      if (ph === PH.pivot && liftAt < 0) { liftAt = i; zSkid = c.pos.z; pivot = c.anchor('club_core'); }
      if (ph === PH.pivot) {
        if (sweepAt < 0 && Math.abs(c.yaw - yaw0) > 0.5) { sweepAt = i; bendAtLift = c.entity.getProperty(P('bend')); }
        const r = Math.hypot(c.pos.x - pivot.x, c.pos.z - pivot.z); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      }
      if (sweepAt >= 0 && endAt < 0 && ph === PH.pivot) tailHurtBefore = hurtOf(w, tail);
      if (liftAt >= 0 && endAt < 0 && ph === PH.fire) endAt = i;
      if (ph === PH.roar) break;
    }
    const swung = Math.abs(((c.yaw - yaw0 + 540) % 360) - 180);
    check('the breath is charged, fired, and after it he vents and roars', [PH.charge, PH.fire, PH.vent, PH.roar].every((p) => seen.has(p)) && hurtOf(w, far) > 0, [...seen].join(','));
    check('it shoves him backward on his heels', seen.has(PH.skid) && z0 - zSkid > 1.2 && z0 - zSkid < 2.5, `${(z0 - zSkid).toFixed(2)} blocks`);
    check('he plants the club and lifts a foot before he moves: the side is readable for more than a second', liftAt > 0 && sweepAt - liftAt >= 22 && Math.abs(bendAtLift) >= 20, `${sweepAt - liftAt} ticks of warning, bend ${bendAtLift}`);
    check('then his whole body swings round the buried club, dragging the beam across the land', swung > 55 && swung < 85 && rMax - rMin < 1, `${swung.toFixed(0)} degrees, ${rMin.toFixed(1)}..${rMax.toFixed(1)} blocks from the club`);
    check('beside the buried tail is the safe place, until he rips the club free', tailHurtBefore === 0 && hurtOf(w, tail) > 0, `${tailHurtBefore} before, ${hurtOf(w, tail)} after`);
    w.bk.ctl.sendAway();
  }

  // ---- the misfire ----
  {
    const { w, id } = fresh();
    const front = w.sim.addPlayer('Front', { x: 0, y: 64, z: 40 }); front.health = 100000;
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4); w.sim.step(2); debutDone(w);
    const c = w.bk.ctl.creature, b = w.bk.ctl.brain;
    front.seen.length = 0;
    const stops0 = w.sim.log.commands.filter((q) => /^stopsound/.test(q)).length;
    b.chargeSounding = true;
    force(w, 'misfire', b.misfire());
    let rec = false; const from = [];
    for (let i = 0; i < 150; i++) { w.sim.step(1); if (phaseOf(w) === PH.recoil) rec = true; }
    for (const q of front.seen) if (q.id === 'basiliskra:beam_core') from.push(q.at ?? q.location ?? q.pos);
    let holes = 0; for (let x = -70; x <= 70; x++) for (let z = -90; z <= -2; z++) if (id(x, 63, z) !== 'minecraft:grass_block') holes++;
    let ahead = 0; for (let x = -40; x <= 40; x++) for (let z = 4; z <= 80; z++) if (id(x, 63, z) !== 'minecraft:grass_block') ahead++;
    check('the shot that fails: the sound is cut, the wings take it, and thin beams go into the ground behind him', rec && w.sim.log.commands.filter((q) => /^stopsound/.test(q)).length > stops0 && from.length >= 40 && holes > 10,
      `${from.length} thin beams drawn, ${holes} blocks of ground struck behind him`);
    check('directly in front of his face nothing falls', hurtOf(w, front) === 0 && ahead === 0, `${hurtOf(w, front)} damage, ${ahead} blocks struck in front`);
    w.bk.ctl.sendAway();
  }

  // ---- the beam he swallows ----
  {
    const { w } = fresh();
    const p = w.sim.addPlayer('Hider', { x: 0, y: 64, z: 110 }); p.health = 100000;
    const anchor = w.sim.addPlayer('Watcher', { x: -40, y: 64, z: 10 }); anchor.mode = 'Creative';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4); w.sim.step(2); debutDone(w);
    const c = w.bk.ctl.creature, b = w.bk.ctl.brain;
    force(w, 'beam', b.breath(p));
    for (let i = 0; i < 50; i++) w.sim.step(1);
    // the player reaches cover while he is still following with his eye
    for (let x = -40; x <= 40; x++) for (let y = 64; y <= 130; y++) w.sim.setBlock('minecraft:overworld', x, y, 80, 'minecraft:bedrock');
    const seen = new Set(); let pulses = 0, lastSeq = c.entity.getProperty(P('fx_seq')), fired = -1, sw = -1;
    const shots0 = w.bk.store.rec.four.shots;
    for (let i = 0; i < 700; i++) {
      w.sim.step(1);
      const ph = phaseOf(w); seen.add(ph);
      if (ph === PH.swallow && sw < 0) sw = i;
      const seq = c.entity.getProperty(P('fx_seq'));
      if (seq !== lastSeq) { lastSeq = seq; if (c.entity.getProperty(P('fx_kind')) === 11) pulses++; }
      if (ph === PH.fire && fired < 0) { fired = i; break; }
    }
    check('you reach cover while he charges: he shuts his mouth on it and carries it', sw >= 0 && seen.has(PH.carry) && !seen.has(PH.roar) && w.sim.log.commands.some((q) => /^stopsound .*iii\.charge/.test(q)), [...seen].join(','));
    check('a red pulse climbs his neck every five seconds, and on the third he must let it go wherever he faces', pulses === 3 && fired > sw + 280 && w.bk.store.rec.four.shots === shots0 + 1 && hurtOf(w, p) === 0, `${pulses} pulses, fired ${fired - sw} ticks after swallowing`);
    // and if he sees you first, he fires at once
    for (let i = 0; i < 400; i++) w.sim.step(1);
    for (let x = -40; x <= 40; x++) for (let y = 64; y <= 130; y++) w.sim.setBlock('minecraft:overworld', x, y, 80, 'minecraft:air');
    p.moveTo({ x: 0, y: 64, z: c.pos.z + 110 }); anchor.moveTo({ x: -40, y: 64, z: c.pos.z + 10 }); w.sim.step(2);
    b.cooldown.delete('swallow'); b.lastFailed = true;
    force(w, 'beam', b.breath(p));
    for (let i = 0; i < 50; i++) w.sim.step(1);
    const wz = Math.round(c.pos.z + 70);
    for (let x = -40; x <= 40; x++) for (let y = 64; y <= 130; y++) w.sim.setBlock('minecraft:overworld', x, y, wz, 'minecraft:bedrock');
    let sw2 = -1; for (let i = 0; i < 120 && sw2 < 0; i++) { w.sim.step(1); if (phaseOf(w) === PH.carry) sw2 = i; }
    for (let x = -40; x <= 40; x++) for (let y = 64; y <= 130; y++) w.sim.setBlock('minecraft:overworld', x, y, wz, 'minecraft:air');
    const h0 = hurtOf(w, p); let at = -1;
    for (let i = 0; i < 60 && at < 0; i++) { w.sim.step(1); if (phaseOf(w) === PH.fire) at = i; }
    for (let i = 0; i < 60; i++) w.sim.step(1);
    check('if he sees you before then, he fires the instant he does', sw2 >= 0 && at >= 0 && at <= 3 && hurtOf(w, p) > h0, `fired ${at} ticks after the cover was gone`);
    w.bk.ctl.sendAway();
  }

  // ---- the plate ----
  {
    const { w, id } = fresh();
    const p = w.sim.addPlayer('Sheltered', { x: 0, y: 64, z: 110 }); p.health = 100000;
    const anchor = w.sim.addPlayer('Watcher', { x: -40, y: 64, z: 10 }); anchor.mode = 'Creative';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4); w.sim.step(2);
    w.bk.store.rec.four = { debut: true, shots: 2, plate: null };
    const c = w.bk.ctl.creature, b = w.bk.ctl.brain;
    b.lastFailed = true;                                   // (so that this shot cannot be the one that fails)
    force(w, 'beam', b.breath(p));
    for (let i = 0; i < 60; i++) w.sim.step(1);
    const P4 = w.bk.store.rec.four.plate;
    let stood = 0; if (P4) for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 4; dy++) if (id(P4.x + dx, P4.y + dy, P4.z) === 'basiliskra:scarlet_trinitite') stood++;
    check('the third time he draws breath a plate cracks off his back and stands in the ground, taller than a player', !!P4 && stood === 8 && c.entity.getProperty(P('gill')) === true && Math.hypot(P4.x - c.pos.x, P4.z - c.pos.z) > 10,
      P4 ? `${stood} blocks at ${P4.x},${P4.y},${P4.z}` : 'no plate');
    b.finish(); w.sim.step(5);                             // (that breath is not needed for what follows)
    // a player under a roof: hidden from his mouth high above, in plain sight of the plate
    const q = { x: P4.x + 26, y: 64, z: P4.z };
    p.moveTo(q);
    for (let x = q.x - 22; x <= q.x + 22; x++) for (let z = q.z - 22; z <= q.z + 22; z++) w.sim.setBlock('minecraft:overworld', x, 72, z, 'minecraft:bedrock');
    force(w, 'turn', b.turnTo({ x: c.pos.x, y: 64, z: c.pos.z + 50 }, 3, 300), 400); for (let i = 0; i < 200; i++) w.sim.step(1);
    const mouth = c.anchor('mouth');
    const hidden = !w.bk.world.clearLine(c.dim, mouth, p.getHeadLocation());
    check('the plate sees whoever hides from his mouth', hidden && b.plateSees(p) === true, `hidden from the mouth: ${hidden}`);
    const h0 = hurtOf(w, p);
    force(w, 'beam', b.plateShot(p));
    until(w, () => phaseOf(w) === PH.fire, 400); for (let i = 0; i < 130; i++) w.sim.step(1);
    check('he fires into it, and it throws the beam at them', hurtOf(w, p) > h0 && w.bk.store.rec.four.plate.uses === 1, `${hurtOf(w, p) - h0} damage under the roof`);
    for (let k = 0; k < 2; k++) { for (let i = 0; i < 200; i++) w.sim.step(1); force(w, 'beam', b.plateShot(p)); until(w, () => phaseOf(w) === PH.fire, 400); for (let i = 0; i < 130; i++) w.sim.step(1); }
    let black = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 4; dy++) if (id(P4.x + dx, P4.y + dy, P4.z) === 'basiliskra:cooled_slag') black++;
    const plateNow = []; for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 4; dy++) plateNow.push(id(P4.x + dx, P4.y + dy, P4.z).replace(/^(minecraft|basiliskra):/, ''));
    check('after three such shots it is burnt out, and stays, blackened', w.bk.store.rec.four.plate.burnt === true && black >= 6 && b.plateSees(p) === false, `${black} blocks blackened: ${plateNow.join(' ')}`);
    w.bk.ctl.sendAway();
  }

  // ---- the seabed ----
  {
    const coast = (dim, x, y, z) => {
      if (dim !== 'minecraft:overworld') return 'minecraft:air';
      if (z < 0) return y <= 57 ? 'minecraft:sand' : y <= 62 ? 'minecraft:water' : 'minecraft:air';
      return y > 63 ? 'minecraft:air' : y === 63 ? 'minecraft:sand' : 'minecraft:stone';
    };
    const { w, id } = fresh(coast);
    const p = w.sim.addPlayer('Shore', { x: 0, y: 64, z: 26 }); p.health = 100000; p.mode = 'Creative';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 40 }, 180, 4); w.sim.step(2); debutDone(w);
    const c = w.bk.ctl.creature, b = w.bk.ctl.brain;
    c.wade = true;
    force(w, 'wade', b.walk({ x: 0, y: 58, z: -34 }, 0.2, 3, 3000));
    for (let i = 0; i < 1500 && c.pos.z > -30; i++) w.sim.step(1);
    p.mode = 'Survival';
    const boat = w.sim.dims.get('minecraft:overworld').spawnEntity('minecraft:boat', { x: 6, y: 62.6, z: -4 });
    check('standing in the shallows with someone on the beach, the seabed is his to throw', c.pos.z < -24 && c.pos.y < 60 && b.shoreVictim([p]) === p, `at z ${c.pos.z.toFixed(0)}, y ${c.pos.y.toFixed(1)}`);
    const z0 = p.location.z, edits0 = [...w.sim.save.edits.keys()].filter((k) => !/^(placed|state|power)\|/.test(k)).length;
    p.seen.length = 0;
    force(w, 'drag', b.dragSeabed(p));
    let dr = false, pushed = 0, edits1 = -1;
    for (let i = 0; i < 460; i++) {
      w.sim.step(1);
      pushed = Math.max(pushed, boat.rec.vel.z, boat.rec.loc.z + 4);
      if (phaseOf(w) === PH.drag) dr = true;
      else if (dr && edits1 < 0) { edits1 = [...w.sim.save.edits.keys()].filter((k) => !/^(placed|state|power)\|/.test(k)).length; p.mode = 'Creative'; }
    }
    check('he reaches down, hauls, and a front of black water races up the beach', dr && p.seen.filter((q) => /^basiliskra:surge/.test(q.id)).length >= 100, `${p.seen.filter((q) => /^basiliskra:surge/.test(q.id)).length} bursts of spray`);
    check('whoever stands in its path is hurt and swept inland', hurtOf(w, p) > 0 && p.location.z > z0 + 2.5, `moved ${(p.location.z - z0).toFixed(1)} blocks inland`);
    check('boats are shoved up the shore; a cod is left flapping', pushed > 1 && w.sim.count('minecraft:cod') === 2 && w.sim.count('minecraft:boat') === 1, `boat pushed ${pushed.toFixed(1)}, ${w.sim.count('minecraft:cod')} cod`);
    check('and not one block of water is moved: the map is not flooded', edits1 === edits0 && id(0, 60, -10) === 'minecraft:water' && id(0, 64, 10) === 'minecraft:air', `${edits1 - edits0} blocks changed`);
    w.bk.ctl.sendAway();
  }

  // ---- called back, he comes out of the sea ----
  {
    const coast = (dim, x, y, z) => {
      if (dim !== 'minecraft:overworld') return 'minecraft:air';
      if (z < 0) return y <= 57 ? 'minecraft:sand' : y <= 62 ? 'minecraft:water' : 'minecraft:air';
      return y > 63 ? 'minecraft:air' : y === 63 ? 'minecraft:sand' : 'minecraft:stone';
    };
    const { w, id } = fresh(coast);
    const op = w.sim.addPlayer('Op', { x: 0, y: 64, z: 34 }); op.mode = 'Creative'; op.view = { x: 0, y: 0, z: -1 };
    const sea = w.sim.addPlayer('Gull', { x: 0, y: 80, z: -50 }); sea.mode = 'Spectator';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 60 }, 180, 4); w.sim.step(2); debutDone(w);
    w.bk.ctl.driveOff(true); w.sim.step(5);
    const msg = w.bk.ctl.callNow(op.location, op, w.bk.ui.placeFor(op, 4));
    const a = w.bk.store.rec.arrival;
    check('owed back as Basiliskra IV with the sea near, the rift opens out in the water', /out of the (sea|water)/.test(msg) && a?.land === true && a.water.z < -40 && id(a.water.x, a.water.y, a.water.z) === 'minecraft:water', `${msg} (z ${a?.water.z})`);
    op.heard.length = 0;
    const took = until(w, () => w.bk.store.rec.stage === 'alive', 2500);
    const c = w.bk.ctl.creature;
    check('he wades out of it and stops at the water\'s edge, not on whoever called him', took > 0 && !!c && c.form === 4 && c.pos.z < 20 && c.pos.z > -40 && Math.hypot(c.pos.x - op.location.x, c.pos.z - op.location.z) > 14,
      c ? `${took} ticks, at z ${c.pos.z.toFixed(0)}` : 'not here');
    check('he has not roared yet', !op.heard.some((q) => /^basiliskra\.roar/.test(q.id)) && w.bk.store.rec.four?.debut === false);
    until(w, () => w.bk.store.rec.four?.debut === true, 900);
    let beach = 0, bed = 0;
    for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) { if (z >= 0 && id(x, 63, z) === 'basiliskra:scarlet_trinitite') beach++; if (z < 0 && id(x, 57, z) === 'basiliskra:scarlet_trinitite') bed++; }
    const heard = op.heard.map((q) => q.id);
    check('a thin beam cuts a line across the beach, it pops into glass back toward the sea, and then he roars', beach >= 8 && bed === 0 && heard.lastIndexOf('random.pop') >= 0 && heard.indexOf('basiliskra.roar') > heard.lastIndexOf('random.pop'),
      `${beach} blocks of glass on the beach, ${bed} changed under the water`);
    w.bk.ctl.sendAway();
  }

  // ---- how he comes to be ----
  {
    const { w } = fresh();
    const ana = w.sim.addPlayer('Ana', { x: 30, y: 64, z: 30 }); ana.mode = 'Creative';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 3); w.sim.step(2);
    const rec = w.bk.store.rec, id0 = w.bk.ctl.creature.entity.id;
    ana.use('basiliskra:journal'); w.sim.step(2);
    const page3 = ana.forms[ana.forms.length - 1]?.body ?? '';
    check('the journal says what makes Basiliskra III the last form: time, and nothing else', /Becoming Basiliskra IV/.test(page3) && /Only time: §f60 min§7 left of 60 min/.test(page3) && !/Beams fired|night/.test(page3),
      (page3.match(/Only time[^\n]*/) || [''])[0]);
    w.sim.save.timeOfDay = 6000;                              // broad daylight, no beams fired: only the clock matters
    for (let i = 0; i < 200; i++) w.sim.step(1);
    check('before the time is up nothing happens', rec.form === 3 && !rec.evolve);
    rec.mut.formSince = rec.clock - 3 * 24000 - 10;
    ana.cam.log.length = 0; ana.titles.length = 0;
    let hid = false, far = 0, lastTick = -9;
    const took = until(w, () => {
      if (ana.hud === 'hidden') hid = true;
      const c = w.bk.ctl.creature;
      for (const q of ana.cam.log) if (q.tick > lastTick && q.at && q.look) { lastTick = q.tick; far = Math.max(far, Math.hypot(q.at.x - q.look.x, q.at.y - q.look.y, q.at.z - q.look.z)); }
      return rec.form === 4 && !rec.evolve;
    }, 2400);
    check('when the time is up he changes, by day, with nothing else asked: the same animal, Basiliskra IV', took > 0 && took < 700 && w.bk.ctl.creature.entity.id === id0 && w.bk.ctl.creature.form === 4, `${took} ticks`);
    check('the change is filmed close: the camera is never further off than it takes to hold all of him', ana.cam.log.some((q) => q.preset) && far > 8 && far <= 50, `furthest ${far.toFixed(0)} blocks from what it is looking at (it took ${(2.4 * 34 + 12).toFixed(0)} before)`);
    check('the HUD is put away for it and his name is shown', hid && ana.titles.some((t) => /BASILISKRA IV/.test(t.title)), JSON.stringify(ana.titles.slice(-1)));
    for (let i = 0; i < 200; i++) w.sim.step(1);
    check('and afterwards the player has their own eyes and their HUD back', ana.cam.held === false && ana.hud === 'shown');
    check('and then makes his entrance', until(w, () => rec.four?.debut === true, 900) > 0);
    ana.use('basiliskra:journal'); w.sim.step(2);
    const page4 = ana.forms[ana.forms.length - 1]?.body ?? '';
    check('the journal names his last form, and the last crossing is still offered', /Basiliskra IV is here/.test(page4) && /last form/.test(page4) && /last crossing/.test(page4));
    check('the last crossing knows him as it knew Basiliskra III', w.bk.ctl.brain.wantCharge === false && typeof w.bk.ctl.brain.beam === 'function' && typeof w.bk.ctl.brain.walk === 'function' && 'groundedAt' in w.bk.ctl.brain);
  }
}

{
  // the minutes setting: every change that many minutes after the last, whatever else is true
  const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
  const ana = w.sim.addPlayer('Ana', { x: 30, y: 64, z: 30 }); ana.mode = 'Creative';
  w.bk.CONFIG.changeMinutes = 1;
  w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 2); w.sim.step(2);
  const rec = w.bk.store.rec, id0 = w.bk.ctl.creature.entity.id;
  w.sim.save.timeOfDay = 5000;                              // broad day, no rain
  Object.assign(rec.mut, { surfacings: 0, episodes: 0, overland: 0, beams: 0 });
  rec.mut.formSince = rec.clock;
  w.sim.step(1140);
  check('set to one minute, Basiliskra II is still II fifty-seven seconds after he became II', rec.form === 2 && !rec.evolve);
  const t2 = until(w, () => rec.form === 3 && !rec.evolve, 1200);
  check('and a minute after, he changes: by day, dry, having dragged himself nowhere', t2 > 0 && rec.mut.overland < 220 && w.bk.ctl.creature.entity.id === id0 && w.sim.save.timeOfDay < 12000, `${t2} more ticks; ${Math.round(rec.mut.overland)} blocks dragged`);
  const since = rec.mut.formSince;
  const t3 = until(w, () => rec.form === 4 && !rec.evolve, 2400);
  check('Basiliskra III a minute after that, without a beam fired', t3 > 0 && rec.mut.beams === 0 && rec.mut.formSince - since >= 1200 && rec.mut.formSince - since < 1800 && w.sim.count(TYPE) === 1, `${rec.mut.formSince - since} ticks as III; ${rec.mut.beams} beams`);
  w.bk.ctl.sendAway();
}

console.log('\n== 20. The Seam Lance');
{
  const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
  const p = w.sim.addPlayer('Gunner', { x: 0, y: 64, z: 70 }); p.mode = 'Creative';
  w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 3); w.sim.step(4);
  const c = w.bk.ctl.creature;
  const dealt = (from = 0) => w.sim.log.damage.filter((d) => d.id === c.entity.id && d.tick >= from).map((d) => d.amount);
  const aimAt = (at) => { const h = p.getHeadLocation(), d = { x: at.x - h.x, y: at.y - h.y, z: at.z - h.z }, n = Math.hypot(d.x, d.y, d.z); p.view = { x: d.x / n, y: d.y / n, z: d.z / n }; };
  const body = { x: c.pos.x, y: c.pos.y + 5, z: c.pos.z };
  aimAt(body); p.seen.length = 0;
  let t0 = w.sim.save.tick;
  p.use('basiliskra:seam_lance'); w.sim.step(2);
  check('a shot at his body counts, from seventy blocks', dealt(t0).length === 1 && dealt(t0)[0] === 34, JSON.stringify(dealt(t0)));
  check('the bolt is drawn from the muzzle to where it struck', p.seen.some((q) => q.id === 'basiliskra:beam_core') && p.seen.some((q) => q.id === 'basiliskra:beam_impact'));
  p.use('basiliskra:seam_lance'); w.sim.step(2);
  check('it cannot be fired again at once', dealt(t0).length === 1 && p.getItemCooldown('basiliskra_lance') > 0);
  w.sim.step(14); t0 = w.sim.save.tick;
  aimAt(c.anchor('nose'));
  p.use('basiliskra:seam_lance'); w.sim.step(2);
  check('his head counts for half as much again', dealt(t0).length === 1 && dealt(t0)[0] === 51, JSON.stringify(dealt(t0)));
  w.sim.step(14); t0 = w.sim.save.tick;
  p.view = { x: 1, y: 0.2, z: 0 };
  p.use('basiliskra:seam_lance'); w.sim.step(2);
  check('a shot that misses him does nothing to him', dealt(t0).length === 0);
  for (let x = -6; x <= 6; x++) for (let y = 64; y <= 76; y++) w.sim.setBlock('minecraft:overworld', x, y, 60, 'minecraft:stone');
  w.sim.step(14); t0 = w.sim.save.tick; aimAt(body);
  p.use('basiliskra:seam_lance'); w.sim.step(2);
  check('a wall stops it', dealt(t0).length === 0);
  const cow = w.sim.dims.get('minecraft:overworld').spawnEntity('minecraft:cow', { x: 20, y: 64, z: 70 });
  w.sim.step(14); t0 = w.sim.save.tick; aimAt({ x: 20, y: 64.6, z: 70 });
  p.use('basiliskra:seam_lance'); w.sim.step(2);
  const cowHit = w.sim.log.damage.filter((d) => d.id === cow.id && d.tick >= t0).map((d) => d.amount);
  check('anything else alive in the line takes a little of it', cowHit.length === 1 && cowHit[0] === 9 && dealt(t0).length === 0, JSON.stringify(cowHit));
}

console.log('\n== 21. A city by the sea, and the deep');
{
  const flatWorld = () => { const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w); return w; };
  {
    const w = flatWorld();
    const id = (x, y, z) => w.sim.blockId('minecraft:overworld', x, y, z);
    const op = w.sim.addPlayer('Op', { x: 0, y: 64, z: 0 }); op.mode = 'Creative'; op.view = { x: 0, y: 0, z: 1 }; op.playerPermissionLevel = 2;
    w.sim.setBlock('minecraft:overworld', 400, 64, 400, 'minecraft:oak_planks');
    const C = w.bk.city, P = C.SMALL, L = C.layout(P);
    const said = C.raiseCity({ x: 0, y: 64, z: 0 }, 0, true);
    const S = w.bk.store.rec.cities[0], G = S.y;
    check('a city can be raised where an operator stands: the promenade under them, the sea the way they look', /rising/.test(said) && S.dir === 0 && Math.abs(S.x + L.cityU / 2) <= 1 && Math.abs(S.z + L.vProm + 3) <= 1, said);
    check('only one is built at a time', /still being built/.test(C.raiseCity({ x: 300, y: 64, z: 300 }, 0, true)));
    w.sim.step(3);
    check('the ground it needs is kept loaded while it is built', w.sim.log.commands.filter((c) => /^tickingarea add .* bk_city_\d$/.test(c)).length === 4 && w.sim.areas.size === 4);
    // (and never at a cost anybody would feel: a few thousand blocks a tick at most, however much is left to do)
    let worst = 0, took = -1;
    for (let i = 0; i < 4000; i++) { w.sim.work = { blocks: 0, queries: 0, rays: 0, fills: 0 }; w.sim.step(1); worst = Math.max(worst, w.sim.work.fills ?? 0); if (S.done === true) { took = i + 1; break; } }
    check('it is finished in under a minute, and the ground is let go again', took > 0 && took < 1200 && w.sim.areas.size === 0 && op.messages.some((m) => /The city stands/.test(m)), `${took} ticks`);
    check('and no tick of it changes more than six thousand blocks (1.6 changed up to forty thousand, and lagged)', worst > 0 && worst <= C.BUILD.volume, `${worst} blocks in the worst tick`);
    const X = (u) => S.x + u, Z = (v) => S.z + v;
    // streets and what stands on them
    let wall = 0, glass = 0, lit = 0, tallest = 0;
    for (let u = 0; u < L.cityU; u++) for (let v = 0; v < L.cityV; v++) {
      for (let y = G + 1; y <= G + 80; y++) {
        const b = id(X(u), y, Z(v));
        if (b === 'minecraft:air') continue;
        if (/concrete|quartz|terracotta|brick|planks/.test(b)) wall++; else if (/glass/.test(b)) glass++; else if (b === 'minecraft:sea_lantern') lit++;
        tallest = Math.max(tallest, y - G);
      }
    }
    check('streets on a grid', id(X(2), G, Z(40)) === 'minecraft:gray_concrete' && id(X(3), G, Z(40)) === 'minecraft:light_gray_concrete' && id(X(40), G, Z(30)) === 'minecraft:gray_concrete' && id(X(8), G, Z(8)) !== 'minecraft:gray_concrete');
    check('towers of concrete and glass, lit inside, the tallest by the water', wall > 3000 && glass > 600 && lit > 20 && tallest >= 34, `${wall} wall, ${glass} glass, ${lit} lights, tallest ${tallest}`);
    check('people in the streets: its own townspeople, who walk and look about', w.sim.count('basiliskra:civilian') === P.people && w.sim.count('minecraft:villager_v2') === 0, `${w.sim.count('basiliskra:civilian')} civilians`);
    const mid = Math.floor(L.cityU / 2);
    const top = (u, v) => { for (let y = G + 10; y > -64; y--) { const b = id(X(u), y, Z(v)); if (b !== 'minecraft:air' && b !== 'minecraft:water') return { y, b }; } return { y: -99, b: '' }; };
    check('a promenade, then a beach of sand that shelves down under the water', id(X(mid + 8), G, Z(L.vProm + 2)) === 'minecraft:smooth_stone' && top(mid + 8, L.vBeach + 2).b === 'minecraft:sand' && top(mid + 8, L.vBeach + 2).y === G
      && top(mid + 8, L.vBeach + 30).b === 'minecraft:sand' && top(mid + 8, L.vBeach + 30).y < 62 && id(X(mid + 8), 62, Z(L.vBeach + 31)) === 'minecraft:water', `sand at ${top(mid + 8, L.vBeach + 2).y}, then ${top(mid + 8, L.vBeach + 30).y}`);
    // the deep
    // (the open floor of the trench: columns with nothing standing on them)
    let depth = 0, open = 0;
    for (let u = L.uS0 + 2; u <= L.uS1 - 2; u += 3) for (let v = L.vTr + 2; v <= L.vEnd - 2; v += 3) {
      const t = top(u, v);
      if (t.b !== 'basiliskra:abyssal_basalt' || t.y !== P.floor) continue;
      let d = 0; for (let y = 62; y > t.y && id(X(u), y, Z(v)) === 'minecraft:water'; y--) d++;
      depth = Math.max(depth, d); if (d === 62 - P.floor) open++;
    }
    check('beyond the beach the sea is cut deep: a hundred blocks of water, straight down, to a floor of abyssal basalt', depth === 102 && open >= 60, `${depth} blocks of water over ${open} sampled columns of open floor`);
    const count = (what, y0, y1) => { let n = 0; for (let u = L.uS0 - 2; u <= L.uS1 + 2; u++) for (let v = L.vDrop; v <= L.vEnd + 2; v++) for (let y = y0; y <= y1; y++) if (id(X(u), y, Z(v)) === what) n++; return n; };
    const deep = { vents: count('basiliskra:seam_vent', -40, -28), lanterns: count('basiliskra:drowned_lantern', -58, 30), bone: count('basiliskra:old_bone', -40, -10), ring: count('minecraft:crying_obsidian', -58, -38),
      glass: count('basiliskra:scarlet_trinitite', -58, -56) };
    check('on its floor: vents that glow, drowned spires with lanterns, the ribs of something far larger than he is', deep.vents >= 2 && deep.lanterns >= 6 && deep.bone >= 80, JSON.stringify(deep));
    const pu = Math.floor((L.uS0 + L.uS1) / 2), pv = Math.floor((L.vTr + L.vEnd) / 2);
    check('and a pit deeper still, with a broken ring at the bottom of it', id(X(pu + 3), -50, Z(pv + 3)) === 'minecraft:water' && deep.ring >= 12 && deep.glass === 25 && 62 - (-56) >= 118, `${deep.ring} blocks of ring`);
    let chest = null; for (let u = L.uS0; u <= L.uS1 && !chest; u++) for (let v = L.vTr; v <= L.vTr + 12; v++) if (id(X(u), -38, Z(v)) === 'minecraft:chest') { chest = w.sim.save.edits.get(`inv|${X(u)},-38,${Z(v)}`); break; }
    check('a ruin at the foot of the drop holds a chest, and in it a Seam Lance', !!chest && Object.values(chest).some((s) => s?.typeId === 'basiliskra:seam_lance') && Object.values(chest).some((s) => s?.typeId === 'basiliskra:crimson_shard'));
    check('the walls of the deep are lined, so the sea that fills it goes nowhere else', id(X(L.uS0 - 1), 0, Z(L.vTr + 10)) === 'basiliskra:abyssal_basalt' && id(X(L.uS1 + 1), -20, Z(L.vTr + 10)) === 'basiliskra:abyssal_basalt' && id(X(pu), 10, Z(L.vEnd + 1)) === 'basiliskra:abyssal_basalt');
    check('nothing beyond it is touched', id(400, 64, 400) === 'minecraft:oak_planks' && id(X(-20), 63, Z(-20)) === 'minecraft:grass_block' && id(X(L.cityU + 12), 63, Z(10)) === 'minecraft:grass_block');
    // left to itself (not asked for by an operator) it will not stand on what somebody built
    for (let k = 0; k < 12; k++) w.sim.setBlock('minecraft:overworld', 400 + k, 64, 400, 'minecraft:oak_planks');
    op.moveTo({ x: 405, y: 64, z: 400 }); w.sim.step(2);
    const n0 = w.bk.store.rec.cities.length;
    const refused = C.raiseCity({ x: 405, y: 64, z: 400 + L.vProm + 3 - 20 }, 0, true, false);
    check('left to itself a city is never raised over what somebody built', /built there already/.test(refused) && w.bk.store.rec.cities.length === n0 && C.cityBuilding() === null, refused);
    op.moveTo({ x: 0, y: 64, z: 0 }); w.sim.step(2);
    // he goes there
    const m = C.landmarks(S);
    const people = [...w.sim.loaded.values()].filter((e) => e.rec.typeId === 'basiliskra:civilian').map((e) => e.rec);
    for (const r of people) { w.sim.save.entities.delete(r.id); w.sim.loaded.delete(r.id); }
    op.moveTo({ x: m.centre.x, y: G + 1, z: m.centre.z - 70 });
    w.bk.ctl.bringHere({ x: m.centre.x, y: G + 1, z: S.z - 60 }, 0, 3); w.sim.step(3);
    const pick = w.bk.ctl.brain.choose();
    check('with nobody to hunt, Basiliskra III makes for the nearest place people live', pick?.name === 'raze', pick?.name);
    const standing = () => { let n = 0; for (let u = 0; u < L.cityU; u++) for (let v = 0; v < L.cityV; v++) for (let y = G + 1; y <= G + 70; y += 3) if (id(X(u), y, Z(v)) !== 'minecraft:air') n++; return n; };
    const before = standing();
    w.bk.ctl.brain.forced = { name: 'raze', run: w.bk.ctl.brain.raze(m.centre), limit: 6000 };
    for (let i = 0; i < 2600; i++) w.sim.step(1);
    const after = standing(), c = w.bk.ctl.creature;
    check('and walks through it: what he walks through is gone', after < before * 0.9 && Math.hypot(c.pos.x - m.centre.x, c.pos.z - m.centre.z) < 90, `${before} -> ${after} (sampled), he is ${Math.hypot(c.pos.x - m.centre.x, c.pos.z - m.centre.z).toFixed(0)} from its middle`);
  }
  {
    // people he can sense, with no city on record: a village
    const w = flatWorld();
    const op = w.sim.addPlayer('Op', { x: 0, y: 64, z: 0 }); op.mode = 'Creative';
    const far = w.sim.addPlayer('Watcher', { x: 110, y: 64, z: 0 }); far.mode = 'Spectator';
    for (let k = 0; k < 4; k++) w.sim.dims.get('minecraft:overworld').spawnEntity('minecraft:villager_v2', { x: 120 + k, y: 64, z: 5 });
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 30 }, 0, 3); w.sim.step(3);
    const town = w.bk.ctl.brain.choose();
    let goal = null; if (town?.name === 'raze') { w.bk.ctl.brain.forced = town; w.sim.step(3); goal = w.bk.ctl.creature.goal; }
    check('a village counts: he heads for the villagers he can sense', town?.name === 'raze' && !!goal && Math.hypot(goal.x - 120, goal.z - 5) < 20, JSON.stringify(goal));
  }
  {
    // the build is the same plan from the same place: cut short, it is simply taken up again
    const w = flatWorld();
    const op = w.sim.addPlayer('Op', { x: 0, y: 64, z: 0 }); op.mode = 'Creative';
    w.bk.city.raiseCity({ x: 0, y: 64, z: 0 }, 2, true);
    w.sim.step(25);
    w.restart();
    const S = w.bk.store.rec.cities?.[0], unfinished = !!S && S.done === false && w.bk.city.cityBuilding() === null;
    const took = until(w, () => w.bk.store.rec.cities[0].done === true, 4000);
    check('a build cut short by the world closing is taken up again and finished', unfinished && took > 0 && w.sim.count('basiliskra:civilian') === w.bk.city.SMALL.people, `${took} ticks, ${w.sim.count('basiliskra:civilian')} civilians`);
  }
  {
    // on their own, cities rise on real coasts: land behind, open sea ahead, nothing built
    const coast = (dim, x, y, z) => {
      if (dim !== 'minecraft:overworld') return 'minecraft:air';
      if (z < 0) return y <= 44 ? 'minecraft:gravel' : y <= 62 ? 'minecraft:water' : 'minecraft:air';
      return y > 63 ? 'minecraft:air' : y === 63 ? 'minecraft:grass_block' : 'minecraft:stone';
    };
    const w = start(); w.sim.terrainFn = coast; w.sim.biomeFn = (x, z) => (z < 0 ? 'minecraft:ocean' : 'minecraft:plains'); open(w);
    const p = w.sim.addPlayer('Walker', { x: 0, y: 64, z: 30 });
    let S = null;
    for (let k = 0; k < 14 && !S; k++) { p.moveTo({ x: k * 640 + 100, y: 64, z: 30 }); for (let i = 0; i < 210 && !S; i++) { w.sim.step(1); S = w.bk.store.rec.cities?.[0] ?? null; } }
    const L = w.bk.city.layout(w.bk.city.FULL);
    const shore = S ? -(S.z - 0) : 0;                          // dir 2: v runs toward -z, so the natural shore (z = 0) is at v = S.z
    check('walking a coast, sooner or later a city is found rising on it, its sea the real sea', !!S && S.dir === 2 && !S.small && p.messages.some((m) => /A city is rising/.test(m)), S ? `at ${S.x},${S.z}` : 'none in 14 regions');
    check('its beach is laid where the land meets the water', !!S && S.z > L.vBeach - 10 && S.z < L.vShal + 10, S ? `the shore falls at v = ${S.z} (beach ${L.vBeach}..${L.vShal})` : '');
    w.bk.city.stopBuilding();
    w.bk.CONFIG.cities = false;
    const n0 = w.bk.store.rec.cities.length; w.bk.store.rec.cities[0].done = true;
    for (let k = 0; k < 6; k++) { p.moveTo({ x: -k * 640 - 3000, y: 64, z: 30 }); for (let i = 0; i < 210; i++) w.sim.step(1); }
    check('with the setting off none rise by themselves', w.bk.store.rec.cities.length === n0);
    w.bk.CONFIG.cities = true;
    void shore;
  }
}

console.log('\n== 22. The Titan');
{
  const TITAN = 'basiliskra:titan';
  const arena = () => {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    // watchers in Creative, spread so that the whole field is loaded: nothing here hunts them
    const eyes = [[0, 70], [0, -70], [120, 0], [-120, 0], [120, 120], [-120, -120], [-120, 120], [120, -120], [0, 190], [0, -190]].map(([x, z], i) => { const q = w.sim.addPlayer('Eye' + i, { x, y: 64, z }); q.mode = 'Creative'; return q; });
    const dim = w.sim.api.world.getDimension('minecraft:overworld');
    const T = w.bk.titan;
    return { w, eyes, dim, T, titans: T.titans };
  };
  const healthOf = (c) => c.entity.getComponent('minecraft:health').currentValue;
  const phase = (c) => c.entity.getProperty(P('phase'));

  // ---- made on purpose; several; not him ----
  {
    const { w, eyes, dim, T, titans } = arena();
    const said = titans.spawn(dim, { x: 0, y: 64, z: 0 }, 0);
    w.sim.step(3);
    const a = titans.creatures()[0];
    const parts = w.bk.creature.partsFor(4).length;
    check('a Titan can be put down: Basiliskra IV\'s body, bound, named, with its own hit volumes', /A Titan stands here/.test(said) && titans.count === 1 && a.form === 4 && a.entity.getProperty(P('form')) === 4
      && a.entity.getProperty(P('bound')) === true && a.entity.nameTag === 'Titan Alpha' && w.sim.count('basiliskra:hitbox') === parts && a.entity.rec.events.includes('basiliskra:bind'), `${said} ${w.sim.count('basiliskra:hitbox')} volumes`);
    check('it is not the one Basiliskra: his story has not begun, and he is nowhere', w.bk.store.rec.stage === 'dormant' && w.bk.ctl.creature === null && w.sim.count(TYPE) === 0 && w.bk.store.rec.entityId === null);
    check('it has far more health than he has', healthOf(a) === 4000 && healthOf(a) >= 6 * 600, `${healthOf(a)}`);
    check('it roars when it arrives', eyes[0].heard.some((q) => q.id === 'basiliskra.roar'));
    // a spawn egg makes another; a fourth is one too many
    w.sim.summon(TITAN, 'minecraft:overworld', { x: 100, y: 64, z: 100 }); w.sim.step(3);
    w.sim.summon(TITAN, 'minecraft:overworld', { x: -100, y: 64, z: -100 }); w.sim.step(3);
    const names = titans.creatures().map((c) => c.entity.nameTag).sort().join(',');
    check('a spawn egg makes another, and each has its own name', titans.count === 3 && names === 'Titan Alpha,Titan Beta,Titan Gamma' && w.sim.count('basiliskra:hitbox') === 3 * parts, names);
    eyes[0].messages.length = 0;
    w.sim.summon(TITAN, 'minecraft:overworld', { x: 0, y: 64, z: 60 }); w.sim.step(3);
    check('three is as many as there can be: a fourth is removed, and whoever is near is told', titans.count === 3 && w.sim.count(TITAN) === 3 && eyes[0].messages.some((m) => /as many as there can be/.test(m)));
    check('the command and the wheel say the same', /as many as there can be/.test(titans.spawn(dim, { x: 0, y: 64, z: 60 }, 0)));
    const n = titans.clear(); w.sim.step(2);
    check('they can all be taken out of the world at once, their hit volumes with them', n === 3 && titans.count === 0 && w.sim.count(TITAN) === 0 && w.sim.count('basiliskra:hitbox') === 0);
    const below = w.sim.addPlayer('Below', { x: 0, y: 70, z: 0 }, 'minecraft:nether'); below.mode = 'Creative'; w.sim.step(1);
    w.sim.summon(TITAN, 'minecraft:nether', { x: 0, y: 70, z: 0 }); w.sim.step(3);
    check('outside the Overworld one is removed at once', titans.count === 0 && w.sim.count(TITAN) === 0);
  }

  // ---- alone: it keeps to the place it was made ----
  {
    const { w, dim, titans } = arena();
    titans.spawn(dim, { x: 0, y: 64, z: 0 }, 0); w.sim.step(2);
    const a = titans.creatures()[0];
    let far = 0, walked = false;
    for (let i = 0; i < 2400; i++) { w.sim.step(1); far = Math.max(far, Math.hypot(a.pos.x, a.pos.z)); if (phase(a) === 1) walked = true; }
    check('left alone it prowls, and never goes far from where it was put down', walked && far > 8 && far < 95 && titans.count === 1, `${far.toFixed(0)} blocks at most in two minutes`);
  }

  // ---- two of them: a fight, and an end to it ----
  {
    const { w, eyes, dim, titans } = arena();
    titans.spawn(dim, { x: 0, y: 64, z: -60 }, 0);
    titans.spawn(dim, { x: 0, y: 64, z: 60 }, 180);
    w.sim.step(2);
    const [a, b] = titans.creatures();
    const ida = a.entity.id, idb = b.entity.id;
    const seen = { beam: 0, bite: false, sweep: false, recoil: false, ram: false, fall: false, close: 1e9 };
    const acts = new Set();
    let ended = -1, bars = false;
    for (let i = 0; i < 9000 && ended < 0; i++) {
      w.sim.step(1);
      for (const t of titans.list.values()) { acts.add(t.brain.actName); const ph = phase(t.c); if (ph === 6) seen.bite = true; if (ph === 7) seen.sweep = true; if (ph === 32) seen.recoil = true; if (ph === 36) seen.fall = true; }
      if (a.valid && b.valid) seen.close = Math.min(seen.close, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
      if (!bars && eyes[0].messages.some((m) => /^\[actionbar\].*Alpha.*Beta/.test(m))) bars = true;
      if (titans.count < 2) ended = i + 1;
    }
    const dmg = (id) => w.sim.log.damage.filter((d) => d.id === id).map((d) => d.amount);
    const da = dmg(ida), db = dmg(idb);
    seen.beam = eyes[0].heard.filter((q) => q.id === 'basiliskra.iii.beam').length;
    check('two Titans go for each other', acts.has('lock') && (acts.has('beam') || acts.has('ram') || acts.has('pursue')), [...acts].join(' '));
    check('with their breath: each burns the other, fifteen at a time (half of what it does to anything smaller)', seen.beam >= 2 && da.includes(15) && db.includes(15), `${seen.beam} beams`);
    check('and with their bodies: jaws and claws, the tail, the whole weight', seen.bite && da.concat(db).includes(85) && seen.sweep && da.concat(db).includes(130) && acts.has('ram') && acts.has('circle'), `closest ${seen.close.toFixed(0)}; acts ${[...acts].join(' ')}`);
    check('a heavy blow staggers the one it lands on', seen.recoil && acts.has('reel'));
    check('they stand off at arm\'s length: neither walks through the other', seen.close > 12, `${seen.close.toFixed(1)} blocks between their middles at the nearest`);
    check('whoever is watching sees how each of them stands', bars);
    check('it ends: one goes down, and is gone', ended > 0 && seen.fall && titans.count === 1 && w.sim.count(TITAN) === 1, `after ${ended} ticks (${(ended / 20).toFixed(0)} s)`);
    const left = titans.creatures()[0];
    const drops = [...w.sim.save.entities.values()].filter((r) => r.typeId === 'minecraft:item' && r.item).map((r) => r.item.typeId);
    check('what it leaves: crimson shards and a fin, and ground that is poisoned', drops.includes('basiliskra:crimson_shard') && drops.includes('basiliskra:shed_fin') && w.bk.store.rec.fallout.length > 0, drops.join(','));
    check('the loser\'s hit volumes go with it; the winner keeps its own', w.sim.count('basiliskra:hitbox') === w.bk.creature.partsFor(4).length && left.valid && healthOf(left) > 0 && healthOf(left) < 4000, `winner at ${Math.round(healthOf(left))}`);
    check('nothing of this touched his story', w.bk.store.rec.stage === 'dormant' && w.sim.count(TYPE) === 0);
  }

  // ---- a Titan and Basiliskra himself ----
  {
    const { w, dim, titans } = arena();
    w.bk.ctl.bringHere({ x: 0, y: 64, z: -60 }, 0, 4); w.sim.step(3);
    w.bk.store.rec.four = { debut: true, shots: 0, plate: null };
    const him = w.bk.ctl.creature, hid = him.entity.id;
    titans.spawn(dim, { x: 0, y: 64, z: 60 }, 180); w.sim.step(2);
    const t = titans.creatures()[0], tid = t.entity.id;
    let fought = false, away = -1;
    for (let i = 0; i < 6000 && away < 0; i++) {
      w.sim.step(1);
      if (w.bk.ctl.brain && ['beam', 'pursue', 'lock'].includes(w.bk.ctl.brain.actName)) fought = true;
      if (!w.bk.ctl.creature || w.bk.store.rec.ending?.step || w.bk.store.rec.stage !== 'alive') away = i + 1;
    }
    const onHim = w.sim.log.damage.filter((d) => d.id === hid), onIt = w.sim.log.damage.filter((d) => d.id === tid);
    check('a Titan goes for Basiliskra himself, and he answers it', onHim.length > 0 && fought && onIt.some((d) => d.amount === 5.5), `${onHim.length} blows on him, ${onIt.length} on the Titan`);
    check('it is much the stronger: he is the one driven off, and it is barely marked', away > 0 && healthOf(t) > 3000 && w.sim.count(TYPE) <= 1, `after ${away} ticks; the Titan at ${Math.round(healthOf(t))}`);
    check('he is never killed by it', !w.sim.log.damage.some((d) => d.id === hid && d.amount >= 600) && w.bk.store.rec.stage !== 'dormant');
  }

  {
    // as Basiliskra III he fights it too (and loses sooner)
    const { w, dim, titans } = arena();
    w.bk.ctl.bringHere({ x: 0, y: 64, z: -50 }, 0, 3); w.sim.step(3);
    const hid = w.bk.ctl.creature.entity.id;
    titans.spawn(dim, { x: 0, y: 64, z: 50 }, 180); w.sim.step(2);
    const tid = titans.creatures()[0].entity.id;
    const acts = new Set();
    let away = -1;
    for (let i = 0; i < 6000 && away < 0; i++) {
      w.sim.step(1);
      if (w.bk.ctl.brain) acts.add(w.bk.ctl.brain.actName);
      if (!w.bk.ctl.creature || w.bk.store.rec.ending?.step || w.bk.store.rec.stage !== 'alive') away = i + 1;
    }
    const onIt = w.sim.log.damage.filter((d) => d.id === tid).length, onHim = w.sim.log.damage.filter((d) => d.id === hid).length;
    check('Basiliskra III turns on a Titan as well: he roars at it, goes for it, and burns it before it drives him off', (acts.has('lock') || acts.has('pursue')) && acts.has('beam') && onIt > 0 && onHim > 0 && away > 0,
      `${[...acts].join(' ')}; ${onIt} blows on the Titan, ${onHim} on him, gone after ${away} ticks`);
  }

  // ---- players: the lance, a killing blow, and what it does to those it can hurt ----
  {
    const { w, eyes, dim, titans } = arena();
    titans.spawn(dim, { x: 0, y: 64, z: 0 }, 0); w.sim.step(2);
    const t = titans.creatures()[0], tid = t.entity.id;
    const p = eyes[0];
    const aimAt = (at) => { const h = p.getHeadLocation(), d = { x: at.x - h.x, y: at.y - h.y, z: at.z - h.z }, n = Math.hypot(d.x, d.y, d.z); p.view = { x: d.x / n, y: d.y / n, z: d.z / n }; };
    aimAt(t.middle());
    let t0 = w.sim.save.tick;
    p.use('basiliskra:seam_lance'); w.sim.step(2);
    const got = w.sim.log.damage.filter((d) => d.id === tid && d.tick >= t0).map((d) => d.amount);
    check('the Seam Lance strikes a Titan as it strikes him', got.length === 1 && got[0] === 34 && healthOf(t) === 4000 - 34, JSON.stringify(got));
    // a blow that would kill: it is held back, the Titan goes down, and then it is gone
    t.entity.getComponent('minecraft:health').setCurrentValue(20);
    w.sim.step(14); aimAt(t.middle());
    p.use('basiliskra:seam_lance'); w.sim.step(2);
    check('a blow that would kill it is held back: it goes down in its own time', t.valid && healthOf(t) === 20 && titans.list.get(tid)?.brain.dying === true);
    let fell = false;
    const took = until(w, () => { if (t.valid && phase(t) === 36) fell = true; return titans.count === 0; }, 400);
    check('and then it is gone, a few seconds later', fell && took > 60 && took < 260 && w.sim.count(TITAN) === 0 && w.sim.count('basiliskra:hitbox') === 0, `${took} ticks`);
    // somebody in Survival near one
    titans.spawn(dim, { x: 0, y: 64, z: 0 }, 0); w.sim.step(2);
    const t2 = titans.creatures()[0];
    const s = w.sim.addPlayer('Soft', { x: 0, y: 64, z: 60 });
    const hurt = () => w.sim.log.damage.filter((d) => d.id === s.id).reduce((n, d) => n + d.amount, 0);
    const tookS = until(w, () => hurt() > 0, 2400);
    const first = w.sim.log.damage.find((d) => d.id === s.id);
    check('somebody in Survival near a Titan is hunted, and what it does to them is three times what he would do', tookS > 0 && t2.might === 3 && first.amount >= 12, `first blow ${first?.amount} after ${tookS} ticks`);
  }

  // ---- the world closes and opens again ----
  {
    const { w, dim } = arena();
    w.bk.titan.titans.spawn(dim, { x: 0, y: 64, z: 0 }, 0);
    w.bk.titan.titans.spawn(dim, { x: 60, y: 64, z: 60 }, 0);
    w.sim.step(40);
    const hp = w.bk.titan.titans.creatures().map((c) => c.entity.id);
    w.bk.titan.titans.creatures()[1].entity.getComponent('minecraft:health').setCurrentValue(2500);
    w.restart(); w.sim.step(30);
    const T2 = w.bk.titan.titans;
    const again = T2.creatures();
    check('Titans are still Titans after the world closes and opens: the same bodies, the same names, their wounds', T2.count === 2 && again.every((c) => hp.includes(c.entity.id))
      && again.map((c) => c.entity.nameTag).sort().join(',') === 'Titan Alpha,Titan Beta' && again.some((c) => healthOf(c) === 2500), again.map((c) => `${c.entity.nameTag} ${healthOf(c)}`).join('; '));
    check('and each has one set of hit volumes, no more', w.sim.count('basiliskra:hitbox') === 2 * w.bk.creature.partsFor(4).length, `${w.sim.count('basiliskra:hitbox')}`);
  }

  // ---- the config wheel ----
  {
    const { w, eyes, titans } = arena();
    const op = eyes[0]; op.playerPermissionLevel = 2;
    op.view = { x: 0, y: 0, z: -1 };
    op.answers = [9];
    op.use('basiliskra:config_wheel'); w.sim.step(2); for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); w.sim.step(3);
    const c = titans.creatures()[0];
    check('the config wheel puts a Titan in front of the operator, facing them', titans.count === 1 && !!c && c.pos.z < op.location.z - 30 && op.messages.some((m) => /A Titan stands here/.test(m)), c ? `at z ${c.pos.z.toFixed(0)}` : 'none');
    op.answers = [10];
    op.use('basiliskra:config_wheel'); w.sim.step(2); for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); w.sim.step(3);
    check('and takes them away again', titans.count === 0 && op.messages.some((m) => /1 Titan\(s\) removed/.test(m)));
  }
}

console.log('\n== 23. Three changes, three scenes');
{
  const NAMES = { 0: 'idle', 4: 'knock', 5: 'rise', 9: 'spasm', 12: 'evolve', 13: 'beach', 15: 'arc', 18: 'charge', 20: 'vent', 21: 'grounded', 22: 'scatter', 23: 'roar', 26: 'flinch', 32: 'recoil', 34: 'swallow' };
  // play one change from "Make him change now" to its end, and write down everything about it
  const play = (from, terrain, at, opAt) => {
    const w = start(); w.sim.terrainFn = TERRAINS[terrain]; open(w);
    const op = w.sim.addPlayer('Op', opAt); op.mode = 'Creative';
    const said = w.bk.ctl.bringHere(at, 0, from); w.sim.step(6);
    if (from === 4 - 1) w.bk.store.rec.four = undefined;
    const c0 = w.bk.ctl.creature;
    const soft = w.sim.addPlayer('Soft', { x: c0.pos.x + 24, y: opAt.y, z: c0.pos.z }); soft.mode = 'Adventure';
    op.heard.length = 0; op.seen.length = 0; op.cam.log.length = 0; op.titles.length = 0;
    const t0 = w.sim.save.tick;
    const msg = w.bk.ctl.evolveNow();
    const phases = []; let ticks = 0, swapAt = -1, hid = false, maxCharge = 0, far = 0, cuts = 0, lastCam = -9;
    const hurt0 = w.sim.log.damage.filter((d) => d.id === soft.id).length;
    while (w.bk.store.rec.evolve && ticks < 800) {
      w.sim.step(1); ticks++;
      const c = w.bk.ctl.creature;
      const ph = NAMES[c.entity.getProperty(P('phase'))] ?? String(c.entity.getProperty(P('phase')));
      if (phases[phases.length - 1] !== ph && !(phases.length === 0 && ph === 'idle')) phases.push(ph);      // (the establishing shot: he stands)
      if (swapAt < 0 && c.form === from + 1) swapAt = ticks;
      if (op.hud === 'hidden') hid = true;
      maxCharge = Math.max(maxCharge, c.entity.getProperty(P('charge')));
    }
    for (const q of op.cam.log) {
      if (q.at && q.look) far = Math.max(far, Math.hypot(q.at.x - q.look.x, q.at.y - q.look.y, q.at.z - q.look.z));
      if (q.fade && q.fade.red === 0 && q.fade.green === 0 && q.tick !== lastCam) { cuts++; lastCam = q.tick; }
    }
    const c = w.bk.ctl.creature;
    const hurt = w.sim.log.damage.filter((d) => d.id === soft.id).length - hurt0;
    const n = (id) => op.heard.filter((q) => q.id === id && q.tick <= t0 + ticks).length;
    // (the body is brought into line the tick after the instant of the change)
    const before = (id) => op.heard.filter((q) => q.id === id && q.tick < t0 + swapAt - 1).length;
    const after = (id) => op.heard.filter((q) => q.id === id && q.tick >= t0 + swapAt - 1 && q.tick <= t0 + ticks).length;
    const saw = (id) => op.seen.some((q) => q.id === id);
    let glass = 0;
    for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) for (let y = 60; y <= 66; y++) if (w.sim.blockId('minecraft:overworld', Math.floor(c.pos.x) + x, y, Math.floor(c.pos.z) + z) === 'basiliskra:scarlet_trinitite') glass++;
    // the camera stays for the roar that follows, where one does
    const debut = w.bk.store.rec.four?.debut === true;
    w.sim.step(135);
    const roared = op.heard.filter((q) => /^basiliskra\.roar/.test(q.id) && q.tick > t0 + ticks).map((q) => q.id);
    return { w, op, c, said, msg, phases, ticks, swapAt, hid, maxCharge, far, cuts, hurt, n, before, after, saw, glass, t0, debut, roared, hudAfter: op.hud, held: op.cam.held };
  };

  // ---- I -> II: the water boils ----
  const A = play(1, 'bay', { x: 0, y: 64, z: 12 }, { x: 0, y: 64, z: 14 });
  check('I to II begins with three knocks on his gills, then a spasm, then he rears out of the water', A.phases.slice(0, 4).join(' ') === 'knock spasm rise evolve' && A.before('basiliskra.knock.gill') === 3 && A.before('basiliskra.i.surface') === 1,
    `${A.msg} ${A.phases.join(' > ')}`);
  check('the sea round him boils, his fin goes in a column of steam and thrown water', A.saw('basiliskra:splash') && A.saw('basiliskra:bubble_trail') && A.saw('basiliskra:gill_steam') && A.saw('basiliskra:fin_break') && A.saw('basiliskra:impact_fountain') && A.before('random.fizz') >= 3);
  check('what hauls itself up has lightning between its horns: three arcs, on the beat of the knocks', A.c.form === 2 && A.phases.includes('arc') && A.after('basiliskra.ii.arc') === 3 && A.saw('basiliskra:horn_arc_big'), `${A.after('basiliskra.ii.arc')} arcs`);
  check('no thunder in it, and no bolt from the sky', A.n('ambient.weather.thunder') === 0 && !A.saw('basiliskra:beam_core'));

  // ---- II -> III: the sky comes down ----
  const B = play(2, 'flat', { x: 0, y: 64, z: 30 }, { x: 0, y: 64, z: 0 });
  check('II to III: three bolts find his horns, each sooner than the last, and he flinches at each', B.phases.filter((p) => p === 'flinch').length === 3 && B.before('ambient.weather.thunder') === 3 && B.saw('basiliskra:beam_core') && B.phases[0] === 'arc',
    B.phases.join(' > '));
  {
    const th = B.op.heard.filter((q) => q.id === 'ambient.weather.thunder').map((q) => q.tick - B.t0);
    check('a fourth, the biggest, and then he is standing on four legs', th.length === 4 && th[1] - th[0] > th[2] - th[1] && Math.abs(th[3] - B.swapAt) <= 2 && B.c.form === 3, `thunder at ${th.join(', ')}; changed at ${B.swapAt}`);
  }
  check('the charge runs to ground through his club; his plates light one by one from the tail; he shakes them out', B.phases.includes('grounded') && B.phases.includes('scatter') && B.after('basiliskra.iii.ground') === 1
    && B.after('basiliskra.iii.charge_tick') >= 8 && B.after('basiliskra.iii.scatter') === 1 && B.saw('basiliskra:plate_ember'), `${B.after('basiliskra.iii.charge_tick')} plates heard lighting`);
  check('the ground the bolts struck through him is glass', B.glass >= 3, `${B.glass} blocks`);

  // ---- III -> IV: he burns through ----
  const C = play(3, 'flat', { x: 0, y: 64, z: 40 }, { x: 0, y: 64, z: 0 });
  check('III to IV begins as a charge like any other, and he does not fire', C.phases[0] === 'charge' && C.before('basiliskra.iii.charge') === 1 && C.n('basiliskra.iii.beam') === 0 && C.maxCharge === 20, C.phases.join(' > '));
  check('he vents, three knocks, and it does not leave him: his hide flickers and the ground under him glows', C.phases.slice(0, 3).join(' ') === 'charge vent scatter' && C.before('basiliskra.knock.vent') === 3 && C.saw('basiliskra:plate_blaze') && C.glass >= 8,
    `${C.glass} blocks of glass`);
  check('then a dark shape with the fire shut inside it, and then the wings come open', C.phases.slice(3).join(' ').startsWith('swallow recoil rise') && C.after('mob.enderdragon.flap') === 2 && C.saw('basiliskra:impact_smoke') && C.c.form === 4, C.phases.slice(3).join(' > '));
  {
    const card = C.op.titles.find((q) => /BASILISKRA IV/.test(q.title));
    check('his name is kept until he stands there with his wings spread', !!card && card.tick - (C.t0 + C.swapAt) >= 100, card ? `${card.tick - (C.t0 + C.swapAt)} ticks after the change` : 'no card');
  }
  check('he does not roar: his first roar is still the one that comes after his first beam', C.n('basiliskra.roar') === 0 && C.n('basiliskra.roar_short') === 0 && !C.debut);
  check('the other two end on his roar: the short one, younger, as II; the whole roar as III', A.roared.length >= 1 && B.roared.includes('basiliskra.roar'), `II: ${A.roared.join(',')}; III: ${B.roared.join(',')}`);

  // ---- and what they have in common ----
  check('no two are alike: what he does, how long it takes, and how it is cut', new Set([A, B, C].map((s) => s.phases.join(' '))).size === 3 && new Set([A.ticks, B.ticks, C.ticks]).size === 3
    && A.ticks < B.ticks && B.ticks < C.ticks, `${A.ticks}, ${B.ticks} and ${C.ticks} ticks; ${A.cuts}, ${B.cuts} and ${C.cuts} cuts while he changes`);
  check('each is cut into shots, with him filling the picture', A.cuts >= 4 && B.cuts >= 5 && C.cuts >= 5 && A.far > 4 && A.far <= 30 && B.far <= 40 && C.far <= 50, `furthest the camera stands: ${A.far.toFixed(0)}, ${B.far.toFixed(0)}, ${C.far.toFixed(0)} blocks`);
  check('each puts the HUD away and gives it back with the player\'s own eyes, and shows his new name', [A, B, C].every((s) => s.hid && s.hudAfter === 'shown' && !s.held) && /BASILISKRA II$/.test(A.op.titles[0]?.title ?? '') && /BASILISKRA III$/.test(B.op.titles[0]?.title ?? ''),
    [A, B, C].map((s) => `${s.hid}/${s.hudAfter}/${s.held}/${s.op.titles[0]?.title}`).join(' '));
  check('nobody standing near is hurt by any of them', A.hurt === 0 && B.hurt === 0 && C.hurt === 0, `${A.hurt}, ${B.hurt}, ${C.hurt} blows`);
  check('each still lights all of him at its height', A.maxCharge === 20 && B.maxCharge === 20 && C.maxCharge === 20);
}

console.log('\n== 24. The breath from the mouth, the gun, the walk, the aim, the people, the rift (1.7)');
{
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  // ---- the breath leaves by the middle of the open mouth, as wide as that mouth ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 50 }); ana.mode = 'Creative';
    w.sim.addPlayer('Behind', { x: 0, y: 64, z: -50 }).mode = 'Spectator';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4); w.sim.step(3);
    const c = w.bk.ctl.creature;
    c.setPhase('fire'); c.setCharge(20); c.lookYaw = 0; c.lookPitch = 0;
    const a = c.aim(), gap = c.mouthGap();
    const loc = w.bk.RIGS[4].locators.mouth;
    const shutLine = w.bk.rig.toWorld(c.pos, c.yaw, c.skeleton().restPoint('jaw', loc.pos), c.scale);
    const dropped = c.anchor('mouth');
    const mid = { x: (shutLine.x + dropped.x) / 2, y: (shutLine.y + dropped.y) / 2, z: (shutLine.z + dropped.z) / 2 };
    check('firing, his jaw is dropped as it is drawn, and the breath leaves by the middle of the gap', gap > 4 && gap < 6 && near(a.from, mid) < 0.05 && dropped.y < shutLine.y - 3,
      `the mouth stands ${gap.toFixed(1)} blocks open; the lower jaw ${(shutLine.y - dropped.y).toFixed(1)} below the upper`);
    const three = new w.bk.creature.Creature({ dimension: c.dim, location: { x: 300, y: 64, z: 0 }, getRotation: () => ({ x: 0, y: 0 }), getProperty: () => 0, setProperty() {}, id: 'probe3' }, 3);
    three.setPhase('fire'); three.setCharge(20);
    check('his mouth as III stands open less wide than as IV, and the breath of each is drawn to fill it', three.mouthGap() > 2.8 && three.mouthGap() < gap, `${three.mouthGap().toFixed(1)} and ${gap.toFixed(1)} blocks`);
    w.bk.store.rec.four = { debut: true, shots: 0, plate: { x: 900, y: 0, z: 900, uses: 0, burnt: false } };      // (no misfire on a first breath)
    ana.seen.length = 0;
    const target = w.sim.summon('minecraft:cow', 'minecraft:overworld', { x: 0, y: 64, z: 110 }); target.rec.family = ['mob'];
    w.bk.ctl.brain.forced = { name: 'beam', run: w.bk.ctl.brain.breath(target), limit: 4000 };
    until(w, () => c.phase === 'fire', 600); w.sim.step(10);
    const cores = ana.seen.filter((q) => q.id === 'basiliskra:beam_core');
    const at = c.aim().from, last = cores[cores.length - 1];
    check('the beam is drawn from where it leaves him, in its new layers: plasma, fire, light racing down it, a burst at his mouth',
      !!last && near(last.loc, at) < 1.5 && ['beam_halo', 'beam_heat', 'beam_glow', 'beam_pulse', 'mouth_burst'].every((k) => ana.seen.some((q) => q.id === 'basiliskra:' + k)) && last.vars['variable.width'] > 3.5,
      last ? `${near(last.loc, at).toFixed(2)} blocks from his mouth, ${last.vars['variable.width'].toFixed(1)} wide` : 'no beam');
  }
  // ---- the Seam Lance: a held laser, from the gun as each player sees it ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const p = w.sim.addPlayer('Gunner', { x: 0, y: 64, z: 70 }); p.mode = 'Creative';
    const o = w.sim.addPlayer('Other', { x: 12, y: 64, z: 72 }); o.mode = 'Creative';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 3); w.sim.step(4);
    const c = w.bk.ctl.creature;
    const h = p.getHeadLocation(), b = { x: c.pos.x, y: c.pos.y + 5, z: c.pos.z }, d = { x: b.x - h.x, y: b.y - h.y, z: b.z - h.z }, n = Math.hypot(d.x, d.y, d.z);
    p.view = { x: d.x / n, y: d.y / n, z: d.z / n };
    p.seen.length = 0; o.seen.length = 0;
    const t0 = w.sim.save.tick;
    p.use('basiliskra:seam_lance'); w.sim.step(10);
    const mine = p.seen.filter((q) => q.id === 'basiliskra:beam_core'), theirs = o.seen.filter((q) => q.id === 'basiliskra:beam_core');
    const ticks = new Set(mine.map((q) => q.tick)).size;
    const dealt = w.sim.log.damage.filter((x) => x.id === c.entity.id && x.tick >= t0).map((x) => x.amount);
    const fpOff = mine[0] ? near(mine[0].loc, h) : 0, tpOff = theirs[0] ? Math.hypot(theirs[0].loc.x - p.location.x, theirs[0].loc.z - p.location.z) : 0;
    check('the Seam Lance fires a laser that stands in the air for several ticks, as thick as a block, and still strikes him for 34', ticks >= 3 && mine[0]?.vars['variable.width'] >= 0.8 && dealt.length === 1 && dealt[0] === 34,
      `${ticks} ticks drawn, ${mine[0]?.vars['variable.width']} wide, ${JSON.stringify(dealt)}`);
    check('its shooter sees it leave their own gun (ahead, right and below the eye); everyone else sees it leave the gun in their hand', mine.length > 0 && theirs.length > 0 && fpOff > 2 && fpOff < 4 && tpOff > 1 && tpOff < 2.2 && Math.abs(theirs[0].loc.y - (p.location.y + 1.06)) < 0.3,
      `${fpOff.toFixed(2)} from the eye; ${tpOff.toFixed(2)} out from their feet at hip height`);
    check('the other player is not shown the shooter\'s own view, nor the shooter theirs', !o.seen.some((q) => q.id === 'basiliskra:beam_core' && near(q.loc, mine[0].loc) < 0.01) && !p.seen.some((q) => q.id === 'basiliskra:beam_core' && near(q.loc, theirs[0].loc) < 0.01));
  }
  // ---- each footfall's shock rolls on ahead of him ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    w.sim.addPlayer('Ana', { x: 30, y: 64, z: 40 }).mode = 'Creative';
    for (let x = -10; x <= 10; x++) for (let y = 64; y <= 70; y++) w.sim.setBlock('minecraft:overworld', x, y, 60, 'minecraft:oak_planks');
    const c = standThree(w, { x: 0, y: 64, z: 0 }, 0, 0);
    const brain = w.bk.ctl.brain;
    let reached = -1, firstGone = -1;
    brain.forced = { name: 'test', run: (function* () { yield* brain.walk({ x: 0, y: 64, z: 120 }, 0.14, 4, 4000); })(), limit: 1e9 };
    for (let i = 0; i < 1600 && reached < 0; i++) {
      w.sim.step(1);
      if (firstGone < 0 && w.sim.blockId('minecraft:overworld', 0, 66, 60) === 'minecraft:air') firstGone = c.pos.z;
      if (c.pos.z > 55) reached = i;
    }
    check('a footfall\'s shock rolls on ahead of him: a wall well beyond his shoulders is gone before he reaches it', firstGone > 0 && 60 - firstGone > 13, `gone when his middle was ${firstGone.toFixed(0)}, ${(60 - firstGone).toFixed(0)} blocks short of it`);
  }
  // ---- he leads what flies, and turns his head up after it ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 60 }); ana.mode = 'Creative';
    w.sim.addPlayer('Behind', { x: 0, y: 64, z: -50 }).mode = 'Spectator';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 4); w.sim.step(3);
    w.bk.store.rec.four = { debut: true, shots: 0, plate: { x: 900, y: 0, z: 900, uses: 0, burnt: false } };
    const c = w.bk.ctl.creature;
    // (his mouth is near fifty blocks up: this is seventy over that, circling at fifty off)
    const wither = w.sim.summon('minecraft:wither', 'minecraft:overworld', { x: 0, y: 182, z: 50 }); wither.rec.family = ['mob', 'monster']; wither.rec.health = 300;
    let a = 0, maxPitch = 0;
    const fly = () => { a += 0.012; wither.rec.loc = { x: 50 * Math.sin(a), y: 182, z: 50 * Math.cos(a) }; wither.rec.vel = { x: 50 * 0.012 * Math.cos(a), y: 0, z: -50 * 0.012 * Math.sin(a) }; };
    w.bk.ctl.brain.forced = { name: 'beam', run: w.bk.ctl.brain.breath(wither), limit: 4000 };
    const t0 = w.sim.save.tick;
    for (let i = 0; i < 400; i++) { fly(); w.sim.step(1); maxPitch = Math.max(maxPitch, -c.lookPitch); }
    const hits = w.sim.log.damage.filter((x) => x.id === wither.id && x.tick >= t0).length;
    check('against the Wither circling high over his head, he tilts his head far back, follows it, and burns it', hits >= 5 && maxPitch > 45, `${hits} hits, head ${maxPitch.toFixed(0)} degrees up`);
  }
  // ---- giants are solid to each other ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 80 }); ana.mode = 'Creative';
    const dim = w.sim.api.world.getDimension('minecraft:overworld');
    w.bk.titan.titans.spawn(dim, { x: 0, y: 64, z: 0 }, 0); w.bk.titan.titans.spawn(dim, { x: 3, y: 64, z: 2 }, 0);
    w.sim.step(10);
    const [t1, t2] = w.bk.titan.titans.creatures();
    const d = Math.hypot(t1.pos.x - t2.pos.x, t1.pos.z - t2.pos.z);
    check('two giants put down on top of each other are eased apart: their trunks do not overlap', d > 12, `${d.toFixed(1)} blocks between their middles`);
  }
  // ---- his cities' people take fright at the sight of a giant, run, and calm again when it has gone ----
  {
    const w = start(); w.sim.terrainFn = TERRAINS.flat; open(w);
    const ana = w.sim.addPlayer('Ana', { x: 0, y: 64, z: 40 }); ana.mode = 'Creative';
    const people = [0, 1, 2, 3].map((k) => w.sim.summon('basiliskra:civilian', 'minecraft:overworld', { x: -6 + k * 4, y: 64, z: 60 }));
    const far = w.sim.summon('basiliskra:civilian', 'minecraft:overworld', { x: 0, y: 64, z: 260 });
    w.sim.step(20);
    check('a townsperson walks calmly while nothing is near', people.every((e) => e.rec.props['basiliskra:scared'] === false));
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 0 }, 0, 3); w.sim.step(25);
    check('Basiliskra III in sight: they take fright and run (their arms go up; they flee him)', people.every((e) => e.rec.props['basiliskra:scared'] === true && e.rec.events.includes('basiliskra:panic'))
      && far.rec.props['basiliskra:scared'] === false, people.map((e) => e.rec.props['basiliskra:scared']).join(','));
    w.bk.ctl.sendAway(); for (let i = 0; i < 400; i++) w.sim.step(1);
    check('when he has gone they calm down, a while after they last saw him', people.every((e) => !e.attached || (e.rec.props['basiliskra:scared'] === false && e.rec.events.includes('basiliskra:calm'))));
  }
  // ---- called back, the rift opens in the sea, clear of every block ----
  {
    const coast = (dim, x, y, z) => {
      if (dim !== 'minecraft:overworld') return 'minecraft:air';
      if (z < 0) return y <= 50 ? 'minecraft:sand' : y <= 62 ? 'minecraft:water' : 'minecraft:air';
      if (z < 8 && Math.abs(x - 20) < 3 && y > 63 && y < 80) return 'minecraft:stone';          // a sea stack by the beach
      return y > 63 ? 'minecraft:air' : y === 63 ? 'minecraft:sand' : 'minecraft:stone';
    };
    const w = start(); w.sim.terrainFn = coast; open(w);
    const op = w.sim.addPlayer('Op', { x: 0, y: 64, z: 30 }); op.mode = 'Creative'; op.view = { x: 0, y: 0, z: -1 };
    w.sim.addPlayer('Gull', { x: 0, y: 80, z: -70 }).mode = 'Spectator';
    w.bk.ctl.bringHere({ x: 0, y: 64, z: 60 }, 180, 3); w.sim.step(2);
    w.bk.ctl.driveOff(true); w.sim.step(5);
    const msg = w.bk.ctl.callNow(op.location, op, w.bk.ui.placeFor(op, 3));
    const a = w.bk.store.rec.arrival;
    let solid = 0;
    if (a) for (let dy = 0; dy <= 30; dy += 2) for (const [dx, dz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) {
      const q = w.sim.blockId('minecraft:overworld', Math.floor(a.water.x + dx), Math.floor(a.water.y + dy), Math.floor(a.water.z + dz));
      if (q !== 'minecraft:water' && q !== 'minecraft:air') solid++;
    }
    check('called back as Basiliskra III by the sea, the rift opens out in the water, and none of it stands in a block', /out of the water/.test(msg) && !!a && a.water.z < -4 && solid === 0, `${msg} (z ${a?.water.z}, ${solid} solid)`);
    const took = until(w, () => w.bk.store.rec.stage === 'alive', 2500);
    check('he wades ashore through it', took > 0 && w.bk.ctl.creature && w.bk.ctl.creature.pos.z > a.water.z + 10, w.bk.ctl.creature ? `at z ${w.bk.ctl.creature.pos.z.toFixed(0)}` : 'not here');
  }
}

console.log(`\n${results.length - failures}/${results.length} checks passed`);
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build/test-results.json'), JSON.stringify({ when: new Date().toISOString(), passed: results.length - failures, total: results.length, results }, null, 1));
process.exit(failures ? 1 : 0);
