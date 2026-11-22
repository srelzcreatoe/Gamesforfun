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
  check('hit volumes cover his whole body', w.sim.count('basiliskra:hitbox') === 8, `${w.sim.count('basiliskra:hitbox')} volumes`);
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
  const part = [...w.sim.loaded.values()].find((x) => x.typeId === 'basiliskra:hitbox');
  part.applyDamage(20, { cause: 'entityAttack', damagingEntity: w.sim.players[0] });
  w.sim.step(2);
  check('a hit on any part of his body is a hit on him', w.bk.ctl.creature.entity.rec.health < hp && part.rec.health === 1000, `${hp} -> ${w.bk.ctl.creature.entity.rec.health}`);
  const fell = w.bk.ctl.creature.entity.applyDamage(50, { cause: 'fall' });
  check('the world itself (falls, lava, suffocation) does not hurt him', fell === false);
  // one blast that reaches several hit volumes at once is one blow, not eight
  const hp2 = w.bk.ctl.creature.entity.rec.health;
  for (const h of [...w.sim.loaded.values()].filter((x) => x.typeId === 'basiliskra:hitbox')) h.applyDamage(10, { cause: 'entityExplosion' });
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
  w.sim.step(30);
  check('the throes have begun', rec().evolve?.step === 0 && w.bk.ctl.creature.entity.getProperty(P('phase')) === 12);
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
  check('Form III, the same individual', rec().form === 3 && rec().entityId === id && w.bk.ctl.creature.form === 3 && w.sim.count('basiliskra:hitbox') === 19, `${w.sim.count('basiliskra:hitbox')} hit volumes`);
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
  const stand = () => { const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) }; return { x: c().pos.x + f.x * 54, y: c().pos.y, z: c().pos.z + f.z * 54 }; };
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
  const stand = () => { const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) }; return { x: c().pos.x + f.x * 54, y: c().pos.y, z: c().pos.z + f.z * 54 }; };
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
  check('three commands are registered: spawn, journal, config', ['basiliskra:spawn', 'basiliskra:journal', 'basiliskra:config'].every((n) => w2.sim.commands.has(n)) && w2.sim.enums.get('basiliskra:form').join() === 'story,i,ii,iii');
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
  op2.answers.push(1, 3);                                                     // Bring him here -> Basiliskra III
  op2.use('basiliskra:config_wheel'); w4.sim.step(2); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); w4.sim.step(3);
  check('Bring him here makes Basiliskra III in front of the operator', w4.bk.ctl.creature?.form === 3 && w4.sim.count(TYPE) === 1, op2.messages.slice(-2).join(' | '));
  op2.answers.push(4);                                                        // Send him back through the seam
  op2.use('basiliskra:config_wheel'); w4.sim.step(2); await new Promise((r) => setTimeout(r, 0)); w4.sim.step(3);
  check('Send him back: he leaves through a seam and is owed back', w4.sim.count(TYPE) === 0 && w4.bk.store.rec.stage === 'alive' && w4.bk.store.rec.down !== null);
  op2.answers.push(6, 0);                                                     // Reset the story -> Yes
  op2.use('basiliskra:config_wheel'); w4.sim.step(2); for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); w4.sim.step(3);
  check('Reset the story: as if the pack had just been added', w4.bk.store.rec.stage === 'dormant' && w4.bk.store.rec.born === 0 && Object.keys(w4.bk.store.harm.regions).length === 0 && w4.sim.count(TYPE) === 0);
  op2.answers.push('busy', 'busy', 5);                                        // the screen is busy (chat open) twice, then the journal
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
  // now leave it to the fallout, with nobody hunted: everyone creative, he is sent away
  w.bk.ctl.driveOff(true);
  ana.mode = 'Creative'; target.mode = 'Creative';
  const z0 = zones.slice().sort((a, b) => b.s - a.s)[0];
  ana.moveTo({ x: z0.x + 1, y: 64, z: z0.z + 1 });
  for (let i = 0; i < 1600; i++) w.sim.step(1);
  let soil = 0, grass = 0, withered = 0, lawn = 0;
  for (let x = Math.floor(z0.x) - z0.r; x <= z0.x + z0.r; x++) for (let z = Math.floor(z0.z) - z0.r; z <= z0.z + z0.r; z++) {
    const top = id(x, 63, z);
    if (top === 'basiliskra:irradiated_soil') soil++;
    if (top === 'minecraft:grass_block') grass++;
  }
  check('inside it, grass turns to irradiated soil, a little at a time', soil >= 4, `${soil} irradiated, ${grass} grass left`);
  let plants0 = 0, plants1 = 0;
  for (let x = Math.floor(z0.x) - z0.r; x <= z0.x + z0.r; x++) for (let z = Math.floor(z0.z) - z0.r; z <= z0.z + z0.r; z++) {
    if (/short_grass|poppy/.test(meadow('minecraft:overworld', x, 64, z))) plants0++;
    if (/short_grass|poppy/.test(id(x, 64, z))) plants1++;
  }
  check('plants wither in it', plants0 > 0 && plants1 < plants0 / 2, `${plants0} -> ${plants1}`);
  check('clicks for everyone standing in it, quicker the closer they are', ana.heard.some((q) => /^basiliskra\.geiger\.[1-4]$/.test(q.id)));
  ana.mode = 'Survival';
  for (let i = 0; i < 120; i++) w.sim.step(1);
  check('a player standing in strong fallout gets sick (hunger first)', (ana.effects ?? []).some((e) => e.id === 'hunger'), JSON.stringify((ana.effects ?? []).map((e) => e.id).slice(0, 6)));
  ana.mode = 'Creative';
  check('never anything built: the cottage, its lawn against the wall, a planted hedge', id(12, 64, -2) === 'minecraft:oak_planks' && id(12, 65, -2) === 'minecraft:glass' && id(hedge.x, hedge.y, hedge.z) === 'minecraft:oak_leaves');
  // a strong zone over the trees, the pond and the lawn by the cottage: what changes and what does not
  fallout.addFallout({ x: 8, y: 64, z: 8 }, 4, 1.2);
  fallout.addFallout({ x: -8, y: 64, z: 6 }, 4, 1.2);
  fallout.addFallout({ x: 14, y: 63, z: 2 }, 3, 1.2);
  ana.moveTo({ x: 4, y: 64, z: 6 });
  for (let i = 0; i < 2400; i++) w.sim.step(1);
  let leaves = 0; for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) for (const y of [67, 68]) if (id(x, y, z) === 'minecraft:oak_leaves') leaves++;
  check('wild leaves fall in strong fallout; trunks stay', leaves < 40 && id(8, 64, 8) === 'minecraft:oak_log', `${leaves} of 50 leaves left`);
  check('the lawn against the cottage wall is never changed', id(13, 63, 1) === 'minecraft:grass_block' && id(12, 63, 1) === 'minecraft:grass_block', id(13, 63, 1));
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
  // the journal reads it
  ana.moveTo({ x: z0.x, y: 64, z: z0.z });
  ana.use('basiliskra:journal'); w.sim.step(2);
  const page = ana.forms[ana.forms.length - 1]?.body ?? '';
  check('the journal shows the radiation where you stand and the nearest fallout', /FALLOUT/.test(page) && /Radiation where you stand: .*§l\d+%/.test(page) && /Fallout in §f\d+§7 place/.test(page), (page.match(/Radiation where[^\n]*/) || [''])[0]);
  // the counter
  ana.hand = { typeId: 'basiliskra:geiger_counter' }; ana.messages.length = 0;
  w.sim.step(12);
  check('the Geiger counter shows the dose and the way to the nearest fallout', ana.messages.some((m) => /^\[actionbar\] .*Radiation \d+%/.test(m)), ana.messages.slice(-1)[0]);
  // time: it fades, and the soil heals
  const healed0 = soil;
  w.bk.store.rec.clock += 24000 * 9;                         // nine days: a third of a full zone left, the land heals below a fifth
  for (let i = 0; i < 200; i++) w.sim.step(1);
  w.bk.store.rec.clock += 24000 * 6;
  for (let i = 0; i < 3000; i++) w.sim.step(1);
  let left = 0;
  for (let x = Math.floor(z0.x) - z0.r; x <= z0.x + z0.r; x++) for (let z = Math.floor(z0.z) - z0.r; z <= z0.z + z0.r; z++) if (id(x, 63, z) === 'basiliskra:irradiated_soil') left++;
  check('as it fades the soil heals back to dirt', left < healed0 / 3, `${healed0} -> ${left}`);
  check('and once faded the fallout is forgotten (the record stays bounded)', w.bk.store.rec.fallout.length <= 32 && w.bk.store.rec.fallout.every((z) => z.s < 2));
  // settings
  w.bk.CONFIG.fallout = 'off';
  const n0 = w.bk.store.rec.fallout.length;
  fallout.addFallout({ x: 50, y: 64, z: 50 }, 4, 1);
  check('with fallout off, nothing is left anywhere', w.bk.store.rec.fallout.length === n0);
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
      const vols = [...w.sim.loaded.values()].filter((e) => e.rec.typeId === 'basiliskra:hitbox');
      const lowest = Math.min(...vols.map((e) => e.rec.loc.y));
      // the foot volume of the left hind: its place along his line, relative to his middle
      const owner = [...w.bk.partOwner.entries()].filter(([, o]) => o.tag === 'limb').map(([id]) => w.sim.loaded.get(id)).filter(Boolean);
      const along = owner.map((e) => (e.rec.loc.z - c.pos.z));
      feet.push({ lowest, along });
    }
    const n = feet[0].along.length;
    const swing = [];
    for (let k = 0; k < n; k++) { const zs = feet.map((f) => f.along[k]).filter((v) => v !== undefined); swing.push(Math.max(...zs) - Math.min(...zs)); }
    check('Form III has hit volumes on all four legs, knee and sole', n === 8, `${n} limb volumes`);
    check('they move with the legs as he walks (each sweeps several blocks along his body)', swing.filter((s) => s > 3).length >= 4, swing.map((s) => s.toFixed(1)).join(' '));
    check('and none of them is sunk under the ground he stands on', feet.every((f) => f.lowest >= 63.7), `lowest ${Math.min(...feet.map((f) => f.lowest)).toFixed(2)}`);
    const sizes = [...w.sim.loaded.values()].filter((e) => e.rec.typeId === 'basiliskra:hitbox').map((e) => e.rec.events.filter((q) => /size_/.test(q)).pop());
    check('the volumes are sized for a body 1.7 times the model', sizes.some((q) => /size_[789]/.test(q)), [...new Set(sizes)].join(' '));
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

console.log(`\n${results.length - failures}/${results.length} checks passed`);
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build/test-results.json'), JSON.stringify({ when: new Date().toISOString(), passed: results.length - failures, total: results.length, results }, null, 1));
process.exit(failures ? 1 : 0);
