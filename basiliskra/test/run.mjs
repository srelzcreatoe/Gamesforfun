// Scenario tests: the behaviour-pack script running against the simulated world in mock.mjs.
//   node test/run.mjs            (after `node tools/bundle.mjs`)
import fs from 'node:fs';
import path from 'node:path';
import { Sim, Save } from './mock.mjs';
import { TERRAINS, PROPS } from '../tools/preview/scenes/terrain.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CODE = fs.readFileSync(path.join(ROOT, 'build/test-bundle.js'), 'utf8');
const TYPE = 'basiliskra:basiliskra';
const P = (n) => 'basiliskra:' + n;

function bootScript(api) {
  globalThis.__MC__ = api;
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
function open(w) { w.sim.ev.worldLoad.fire({}); w.sim.flush(); }

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
  check('hit volumes cover his whole body', w.sim.count('basiliskra:hitbox') === 8, `${w.sim.count('basiliskra:hitbox')} volumes`);
}

console.log('\n== 3. A duplicate, a stray summon and a copied creature');
{
  const w = world, rec = w.bk.store.rec, id = rec.entityId;
  check('a second trigger after arrival is refused', w.bk.ctl.requestArrival({ region: 'x', site: SITE, guilty: null, guiltyName: null }) === false);
  const q0 = w.bk.ctl.quarantined;
  const stray = w.sim.summon(TYPE, 'minecraft:overworld', { x: 5, y: 50, z: 60 });
  w.sim.flush();
  check('a direct summon is removed before it ticks, and was never visible', !stray.attached && stray.rec.props[P('bound')] === false && w.sim.count(TYPE) === 1);
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
  check('Form III, the same individual', rec().form === 3 && rec().entityId === id && w.bk.ctl.creature.form === 3 && w.sim.count('basiliskra:hitbox') === 18, `${w.sim.count('basiliskra:hitbox')} hit volumes`);
}

console.log('\n== 7. A player joining during a beam charge');
{
  const w = world, c = () => w.bk.ctl.creature, e = () => c().entity;
  const ana = w.sim.players.find((p) => p.name === 'Ana'), ben = w.sim.players.find((p) => p.name === 'Ben');
  w.sim.save.timeOfDay = 3000;
  ben.online = false;
  const stand = () => { const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) }; return { x: c().pos.x + f.x * 38, y: c().pos.y, z: c().pos.z + f.z * 38 }; };
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
  check('beam particles and sound reached the late joiner too', late.seen.some((s) => s.id === 'basiliskra:beam_core') && late.heard.some((s) => s.id === 'basiliskra.iii.beam_raw'));
  const core = late.seen.find((s) => s.id === 'basiliskra:beam_core');
  check('the drawn beam carries the length the server measured', core && core.vars['variable.len'] > 1 && core.vars['variable.len'] <= 28);
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
  const stand = () => { const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) }; return { x: c().pos.x + f.x * 38, y: c().pos.y, z: c().pos.z + f.z * 38 }; };
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
  const stray = w.sim.summon(TYPE, 'minecraft:overworld', SITE); w.sim.step(2);
  check('and a summoned one is removed', !stray.attached && w.sim.count(TYPE) === 0);
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
    for (const s of [-5.5, 0, 5.5]) {                                               // hips, middle, shoulders
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
  const hit = (wall) => {
    const w = start(); open(w);
    const a = w.sim.addPlayer('Ana', { x: 25.31, y: 64, z: -79.5 }); a.health = 1000;
    const c = standThree(w, { x: 0, y: 64, z: -80 }, -90, 0);
    if (wall) for (let y = 64; y <= 72; y++) for (let z = -86; z <= -74; z++) w.sim.setBlock('minecraft:overworld', 24, y, z, 'minecraft:planks');
    w.sim.step(5);
    w.bk.ctl.brain.forced = { name: 'beam', run: w.bk.ctl.brain.beam(a), limit: 1200 };
    let fired = false;
    for (let i = 0; i < 400; i++) { w.sim.step(1); if (c.phase === 'fire') fired = true; if (fired && c.phase !== 'fire') break; }
    return { fired, lost: 1000 - a.health };
  };
  const open1 = hit(false), behind = hit(true);
  check('the raw beam hurts a player in the open', open1.fired && open1.lost > 0, `lost ${open1.lost}`);
  check('and does not reach one sheltering close behind a wall', behind.fired && behind.lost === 0, `lost ${behind.lost}`);
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

console.log(`\n${results.length - failures}/${results.length} checks passed`);
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build/test-results.json'), JSON.stringify({ when: new Date().toISOString(), passed: results.length - failures, total: results.length, results }, null, 1));
process.exit(failures ? 1 : 0);
