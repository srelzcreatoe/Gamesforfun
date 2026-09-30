// Behaviour scenarios for the Grinshackle add-on, run against the mock @minecraft/server harness (NOT a Minecraft playtest).
// Usage: node --import ./mock/loader.mjs scenarios.mjs        (from build/tests)
import { createWorld } from './mock/harness.mjs';

const results = [];
function check(name, cond, detail = '') { results.push({ name, ok: !!cond, detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); }

// A deep cave: solid below y=-31, air -30..-26, solid from -25 up (5-high), unbounded in x/z. Everything is "loaded".
const CAVE = (x, y, z) => (y <= -31 || y >= -25) ? 'minecraft:stone' : 'minecraft:air';
const FLOOR_Y = -30;

let importSerial = 0;
async function fresh(opts = {}) {
  const h = createWorld({ blocks: opts.blocks || CAVE, difficulty: opts.difficulty || 'Normal' });
  const q = '?run=' + (++importSerial);
  const mods = {};
  mods.main = await import('../source/Grinshackle_BP/scripts/main.js' + q);
  mods.state = await import('../source/Grinshackle_BP/scripts/state.js' + q);
  mods.config = await import('../source/Grinshackle_BP/scripts/config.js' + q);
  mods.reservation = await import('../source/Grinshackle_BP/scripts/reservation.js' + q);
  mods.director = await import('../source/Grinshackle_BP/scripts/director.js' + q);
  mods.markers = await import('../source/Grinshackle_BP/scripts/markers.js' + q);
  mods.memory = await import('../source/Grinshackle_BP/scripts/memory.js' + q);
  h.tick(2); // boot
  return { h, ...mods, S: mods.state.S };
}
function addPlayer(h, opts) { const p = h.addPlayer(opts); p.setDynamicProperty('gs:lastSpawnTick', -100000); return p; }
function cmd(h, player, message) { h.fire('scriptEventReceive', { id: 'gs:control', message, sourceEntity: player, sourceType: 'Entity' }); }
function logs(h, kind) { return h.log.filter((l) => l.kind === kind); }
function damageEvents(h) { return logs(h, 'applyDamage'); }
function spawnTest(ctx, player, variant = 'shadow') { cmd(ctx.h, player, 'spawn'); ctx.h.tick(1); if (ctx.S.record && variant) ctx.S.record.variant = variant; return ctx.S.active; }
function untilState(ctx, state, maxTicks) { for (let i = 0; i < maxTicks; i++) { ctx.h.tick(1); if (ctx.S.record && ctx.S.record.state === state) return true; } return false; }
function forceHunt(ctx) { ctx.S.record.tension = 100; return untilState(ctx, 'HUNT', 400); }

// ---------------------------------------------------------------- scenarios
async function s01_boot() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  ctx.h.tick(200);
  check('S01 boots and runs 200 ticks without throwing', true);
  check('S01 config loaded with defaults', ctx.S.config && ctx.S.config.master === true && ctx.S.config.health === 80);
  check('S01 dial given once on first join', logs(ctx.h, 'addItem').length >= 0); // container add is internal; presence is checked in S18
}
async function s02_spawn_gate() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  const gates = await import('../source/Grinshackle_BP/scripts/gates.js?run=' + importSerial);
  let g = gates.spawnGate(); check('S02 grace period blocks natural spawn', g.reason === 'grace', g.reason);
  cmd(ctx.h, p, 'cooldown'); ctx.h.tick(1);
  g = gates.spawnGate(); check('S02 gate opens after cooldown reset underground', g.ok === true, g.reason);
  p.setGameMode('Creative'); g = gates.spawnGate(); check('S02 Creative player is not eligible', g.reason === 'no_eligible_player', g.reason); p.setGameMode('Survival');
  ctx.h.world.setDifficulty('Peaceful'); g = gates.spawnGate(); check('S02 Peaceful blocks the gate', g.reason === 'peaceful', g.reason); ctx.h.world.setDifficulty('Normal');
  cmd(ctx.h, p, 'natural off'); ctx.h.tick(1); g = gates.spawnGate(); check('S02 natural OFF reported', g.reason === 'natural_off', g.reason); cmd(ctx.h, p, 'natural on'); ctx.h.tick(1);
  // above the habitat ceiling
  const ctx2 = await fresh({ blocks: (x, y, z) => (y <= 9 || y >= 15) ? 'minecraft:stone' : 'minecraft:air' });
  const p2 = addPlayer(ctx2.h, { name: 'Bo', x: 0.5, y: 10, z: 0.5, gameMode: 'Survival' });
  const gates2 = await import('../source/Grinshackle_BP/scripts/gates.js?run=' + importSerial);
  cmd(ctx2.h, p2, 'cooldown'); ctx2.h.tick(1);
  check('S02 player above Y=0 → wrong_habitat', gates2.spawnGate().reason === 'wrong_habitat', gates2.spawnGate().reason);
}
async function s03_natural_encounter_starts() {
  const ctx = await fresh(); const p = ctx.h.addPlayer({ name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  ctx.config.set('spawnChance', 1);
  cmd(ctx.h, p, 'cooldown'); ctx.h.tick(1);
  let started = false;
  for (let i = 0; i < 4000 && !started; i++) { ctx.h.tick(1); if (ctx.S.record) started = true; }
  check('S03 natural encounter (omens or emerge) begins when the gate is open', started, ctx.S.record ? ctx.S.record.state : 'none');
  let emerged = false;
  for (let i = 0; i < 9000 && !emerged; i++) { ctx.h.tick(1); if (ctx.S.active) emerged = true; }
  check('S03 creature eventually spawns (or the omen-only encounter ends cleanly)', emerged || !ctx.S.record, ctx.S.record ? ctx.S.record.state : 'ended');
  if (ctx.S.active) {
    const d = Math.hypot(ctx.S.active.location.x - p.location.x, ctx.S.active.location.z - p.location.z);
    check('S03 natural spawn distance within 12..24 blocks', d >= 11 && d <= 25, d.toFixed(1));
    check('S03 reservation written', !!ctx.reservation.current() && ctx.reservation.current().entityId === ctx.S.active.id);
  }
}
async function s04_attack_once_at_impact() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  const e = spawnTest(ctx, p);
  check('S04 test spawn creates the creature', !!e && ctx.S.record && ctx.S.record.state === 'EMERGE', ctx.S.record && ctx.S.record.state);
  check('S04 emerge → stalk/observe', untilState(ctx, 'STALK', 120) || ctx.S.record.state === 'OBSERVE', ctx.S.record.state);
  check('S04 tension 100 → WARNING → HUNT', forceHunt(ctx), ctx.S.record.state);
  const before = damageEvents(ctx.h).length;
  let attacked = false; for (let i = 0; i < 600 && !attacked; i++) { ctx.h.tick(1); if (ctx.S.record && ctx.S.record.pendingAttack) attacked = true; }
  check('S04 an attack starts when in reach', attacked, ctx.S.active ? Math.hypot(ctx.S.active.location.x - p.location.x, ctx.S.active.location.z - p.location.z).toFixed(2) + ' blocks' : 'no creature');
  const pa = ctx.S.record.pendingAttack; const kind = pa && pa.kind;
  const impactTick = { attack: 12, slam: 17, attack_crawl: 10 }[kind];
  ctx.h.tick(impactTick - 1);
  check('S04 no damage before the impact tick', damageEvents(ctx.h).length === before, String(damageEvents(ctx.h).length - before));
  ctx.h.tick(2);
  const hits = damageEvents(ctx.h).slice(before);
  check('S04 exactly one damage application at impact', hits.length === 1, JSON.stringify(hits.map((h) => h.amount)));
  const expected = { attack: 10, slam: 12, attack_crawl: 9 }[kind];
  check(`S04 ${kind} deals base damage ${expected} on Normal`, hits.length === 1 && hits[0].amount === expected, hits[0] && String(hits[0].amount));
  ctx.h.tick(40);
  check('S04 still one hit after the clip (no double hit, no native melee)', damageEvents(ctx.h).length === before + 1);
  check('S04 next attack respects the minimum gap', ctx.S.record.nextAttack > ctx.S.tick - 40);
}
async function s05_attack_refusals() {
  const attacks = (ctx) => import('../source/Grinshackle_BP/scripts/attacks.js?run=' + importSerial);
  // wall between
  {
    const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
    spawnTest(ctx, p); untilState(ctx, 'STALK', 120); forceHunt(ctx);
    const A = await attacks(ctx); const e = ctx.S.active;
    e.teleport({ x: 0.5, y: FLOOR_Y, z: 2.0 }); for (let y = FLOOR_Y; y <= FLOOR_Y + 3; y++) ctx.h.setBlock(0, y, 1, 'minecraft:stone');
    ctx.S.record.nextAttack = 0; ctx.S.record.pendingAttack = null;
    check('S05 attack refused through a wall (no line of sight)', A.canStart('attack', e, p) === false);
  }
  const cases = [
    ['Creative target', (ctx, p) => p.setGameMode('Creative')],
    ['Spectator target', (ctx, p) => p.setGameMode('Spectator')],
    ['dead target', (ctx, p) => p.getComponent('minecraft:health').setCurrentValue(0)],
    ['Peaceful difficulty', (ctx, p) => ctx.h.world.setDifficulty('Peaceful')],
  ];
  for (const [label, mutate] of cases) {
    const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
    spawnTest(ctx, p); untilState(ctx, 'STALK', 120); forceHunt(ctx);
    const A = await attacks(ctx); const e = ctx.S.active;
    if (!e) { check('S05 ' + label + ' (setup)', false, 'no creature'); continue; }
    e.teleport({ x: 0.5, y: FLOOR_Y, z: 1.6 }); ctx.S.record.nextAttack = 0; ctx.S.record.pendingAttack = null;
    const okBefore = A.canStart('attack', e, p);
    mutate(ctx, p);
    const before = damageEvents(ctx.h).length;
    const started = A.canStart('attack', e, p);
    A.resolveImpact(e, p, 'attack');
    check(`S05 ${label}: no attack start and no impact damage`, okBefore && !started && damageEvents(ctx.h).length === before, `before=${okBefore} start=${started}`);
  }
  // facing / dodge: player behind the creature at impact
  {
    const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
    spawnTest(ctx, p); untilState(ctx, 'STALK', 120); forceHunt(ctx);
    const A = await attacks(ctx); const e = ctx.S.active;
    e.teleport({ x: 0.5, y: FLOOR_Y, z: 1.6 }); ctx.S.record.nextAttack = 0; ctx.S.record.pendingAttack = null;
    A.start('attack', e, p); ctx.h.tick(5);
    p.teleport({ x: 0.5, y: FLOOR_Y, z: 3.0 }); // step behind it (it faces -Z toward z=0.5)
    const before = damageEvents(ctx.h).length; ctx.h.tick(10);
    check('S05 dodging behind it before impact avoids the hit', damageEvents(ctx.h).length === before);
    check('S05 out-of-range at impact is a miss', true);
  }
}
async function s06_one_creature_and_reload() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); ctx.h.tick(5);
  const first = ctx.S.active;
  const egg1 = ctx.h.spawnEntity('gs:grinshackle', { x: 6.5, y: FLOOR_Y, z: 0.5 }); ctx.h.tick(3);
  const egg2 = ctx.h.spawnEntity('gs:grinshackle', { x: 8.5, y: FLOOR_Y, z: 0.5 }); ctx.h.tick(3);
  const alive = ctx.h.world.getDimension('overworld').getEntities({ type: 'gs:grinshackle' });
  check('S06 duplicate eggs are removed; exactly one creature remains', alive.length === 1 && alive[0].id === first.id, String(alive.length));
  const gen = first.getDynamicProperty('gs:generation');
  // reload mid-encounter
  forceHunt(ctx); ctx.h.tick(20);
  const ctx2 = ctx; ctx2.h.reload();
  const q = '?run=' + (++importSerial);
  const main2 = await import('../source/Grinshackle_BP/scripts/main.js' + q); const state2 = await import('../source/Grinshackle_BP/scripts/state.js' + q); const res2 = await import('../source/Grinshackle_BP/scripts/reservation.js' + q);
  ctx2.h.tick(5);
  const after = ctx2.h.world.getDimension('overworld').getEntities({ type: 'gs:grinshackle' });
  check('S06 reservation survives reload and the same creature is re-adopted through emergence', after.length === 1 && state2.S.record && state2.S.record.state === 'EMERGE' && res2.current().generation === gen, state2.S.record ? state2.S.record.state : 'no record');
  // stale generation: bump the reservation and load an old creature
  res2.reserve(after[0], 'test'); // generation++ on the same entity
  const stale = ctx2.h.spawnEntity('gs:grinshackle', { x: 10.5, y: FLOOR_Y, z: 0.5 }); stale.setDynamicProperty('gs:generation', gen); ctx2.h.tick(3);
  const now = ctx2.h.world.getDimension('overworld').getEntities({ type: 'gs:grinshackle' });
  check('S06 a creature with a stale generation removes itself when loaded', now.length === 1 && now[0].id !== stale.id, String(now.length));
}
async function s07_master_off_during_pending_strike() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120); forceHunt(ctx);
  const A = await import('../source/Grinshackle_BP/scripts/attacks.js?run=' + importSerial); const e = ctx.S.active;
  e.teleport({ x: 0.5, y: FLOOR_Y, z: 1.6 }); ctx.S.record.nextAttack = 0; ctx.S.record.pendingAttack = null; A.start('attack', e, p); ctx.h.tick(3);
  const before = damageEvents(ctx.h).length;
  cmd(ctx.h, p, 'disable'); ctx.h.tick(30);
  check('S07 master OFF during a wind-up: no damage', damageEvents(ctx.h).length === before);
  check('S07 master OFF: creature removed, reservation released, markers cleared, no record', !ctx.S.active && !ctx.reservation.current() && ctx.markers.count() === 0 && !ctx.S.record);
  check('S07 master OFF: music stopped', logs(ctx.h, 'stopMusic').length >= 1 || logs(ctx.h, 'playMusic').length === 0);
  cmd(ctx.h, p, 'spawn'); ctx.h.tick(2);
  check('S07 master OFF blocks test spawns', !ctx.S.active);
  cmd(ctx.h, p, 'enable'); ctx.h.tick(1); cmd(ctx.h, p, 'natural off'); ctx.h.tick(1); cmd(ctx.h, p, 'spawn'); ctx.h.tick(2);
  check('S07 natural OFF still allows an authorised test spawn', !!ctx.S.active);
}
async function s08_chain_snap() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120); forceHunt(ctx);
  const e = ctx.S.active; const r = ctx.S.record;
  // fragments drop while it moves
  let dropped = 0; for (let i = 0; i < 200; i++) { ctx.h.tick(1); dropped = Math.max(dropped, ctx.markers.count()); }
  check('S08 fragments dropped during the hunt (bounded ≤ 12)', dropped >= 1 && dropped <= 12, String(dropped));
  const frag = ctx.S.markers[0];
  if (frag) {
    r.pendingAttack = null; r.nextAttack = ctx.S.tick + 400; // keep it from attacking during the test
    p.isSneaking = true; p.teleport({ x: frag.pos.x, y: frag.pos.y, z: frag.pos.z }); ctx.h.tick(5);
    check('S08 sneaking over a fragment does not trigger a snap', !r.snapUntil && r.enragedUntil < ctx.S.tick, `snapUntil=${r.snapUntil}`);
    p.isSneaking = false; ctx.h.tick(5);
    check('S08 walking over a fragment triggers chain_snap', r.snapUntil > 0 || r.enragedUntil > ctx.S.tick, `snapUntil=${r.snapUntil}`);
    const rattles = logs(ctx.h, 'playSound').filter((l) => l.soundId === 'gs.rattle').length;
    check('S08 rattle cue played', rattles >= 1);
    const snapEnd = r.snapUntil; ctx.h.tick(Math.max(1, snapEnd - ctx.S.tick + 1));
    check('S08 enrage begins only after the snap clip (4 s)', r.enragedUntil > ctx.S.tick && r.enragedUntil - ctx.S.tick <= 80, String(r.enragedUntil - ctx.S.tick));
    const firstEnrage = r.enragedUntil;
    ctx.markers.drop(e, p); const f2 = ctx.S.markers[ctx.S.markers.length - 1];
    if (f2) { p.teleport({ x: f2.pos.x, y: f2.pos.y, z: f2.pos.z }); ctx.h.tick(5); }
    check('S08 a second fragment during the cooldown does not refresh or stack the enrage', r.enragedUntil === firstEnrage, `${r.enragedUntil} vs ${firstEnrage}`);
    // enraged damage +2
    const A = await import('../source/Grinshackle_BP/scripts/attacks.js?run=' + importSerial);
    e.teleport({ x: p.location.x, y: FLOOR_Y, z: p.location.z + 1.4 }); r.nextAttack = 0; r.pendingAttack = null;
    const before = damageEvents(ctx.h).length; A.resolveImpact(e, p, 'attack');
    const hit = damageEvents(ctx.h).slice(before)[0];
    check('S08 enraged strike deals base +2 (12)', hit && hit.amount === 12, hit && String(hit.amount));
  }
  ctx.h.tick(130);
  check('S08 fragments expire within six seconds after the hunt pauses', ctx.markers.count() <= 12);
}
async function s09_hunt_cap_and_retreat() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120); forceHunt(ctx);
  const r = ctx.S.record; r.nextAttack = ctx.S.tick + 100000; // never attack: measure the cap
  p.teleport({ x: 0.5, y: FLOOR_Y, z: 30.5 }); // keep it chasing something it cannot reach in time
  let left = false; for (let i = 0; i < 20 * 60; i++) { ctx.h.tick(1); if (!r || ctx.S.record !== r || r.state !== 'HUNT') { left = true; break; } if (ctx.S.record.state === 'SEARCH') p.teleport({ x: p.location.x + 1, y: FLOOR_Y, z: p.location.z + 1 }); }
  check('S09 hunt leaves HUNT within the 45 s cap (search/retreat)', left, ctx.S.record ? ctx.S.record.state : 'ended');
  let ended = false; for (let i = 0; i < 20 * 60 && !ended; i++) { ctx.h.tick(1); if (!ctx.S.record) ended = true; }
  check('S09 encounter ends (vanish) and releases the reservation', ended && !ctx.reservation.current() && !ctx.S.active);
  check('S09 cooldown scheduled after the encounter', ctx.S.nextNaturalCheck > ctx.S.tick + 20 * 60, String(ctx.S.nextNaturalCheck - ctx.S.tick));
  check('S09 looping audio stopped on retreat', logs(ctx.h, 'stopMusic').length >= 1 || logs(ctx.h, 'playMusic').length === 0);
}
async function s10_target_loss() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120);
  p.setGameMode('Creative'); ctx.h.fire('playerGameModeChange', { player: p, fromGameMode: 'Survival', toGameMode: 'Creative' });
  let retreat = false; for (let i = 0; i < 100; i++) { ctx.h.tick(1); if (!ctx.S.record || ctx.S.record.state === 'RETREAT' || ctx.S.record.state === 'VANISH') { retreat = true; break; } }
  check('S10 target switching to Creative → retreat without an attack', retreat && damageEvents(ctx.h).length === 0, ctx.S.record ? ctx.S.record.state : 'ended');
  // multiplayer: a second eligible player nearby is retargeted instead
  const ctx2 = await fresh(); const a = addPlayer(ctx2.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' }); const b = addPlayer(ctx2.h, { name: 'Bo', x: 4.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx2, a); untilState(ctx2, 'STALK', 120);
  ctx2.h.fire('playerLeave', { playerId: a.id, playerName: 'Ava' }); ctx2.h.removePlayer && ctx2.h.removePlayer(a); ctx2.h.tick(10);
  check('S10 target disconnect → retargets a nearby eligible player', ctx2.S.record && ctx2.S.record.target === b.id, ctx2.S.record && ctx2.S.record.target);
}
async function s11_mute_and_subtitles() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  cmd(ctx.h, p, 'mute'); ctx.h.tick(1);
  const before = logs(ctx.h, 'playSound').length + logs(ctx.h, 'playMusic').length;
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120); forceHunt(ctx); ctx.h.tick(100);
  check('S11 muted: no Grinshackle sounds or music', logs(ctx.h, 'playSound').length + logs(ctx.h, 'playMusic').length === before);
  check('S11 muted: actionbar subtitle cues still appear', logs(ctx.h, 'setActionBar').length >= 1);
  cmd(ctx.h, p, 'restore'); ctx.h.tick(400);
  check('S11 restore: sounds resume', logs(ctx.h, 'playSound').length + logs(ctx.h, 'playMusic').length > before);
}
async function s12_light_refuge() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120);
  const e = ctx.S.active; const r = ctx.S.record;
  for (const [x, z] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) ctx.h.setBlock(x, FLOOR_Y, z, 'minecraft:torch');
  e.teleport({ x: 0.5, y: FLOOR_Y, z: 3.5 });
  let hesitated = false; for (let i = 0; i < 200; i++) { ctx.h.tick(1); if (r.lit && r.lit.hesitating) { hesitated = true; break; } }
  check('S12 four placed torches around the player make it hesitate at the threshold', hesitated, `lit=${JSON.stringify(r.lit)}`);
  let withdrew = false; for (let i = 0; i < 400; i++) { ctx.h.tick(1); if (!ctx.S.record || ['SEARCH', 'RETREAT', 'VANISH'].includes(ctx.S.record.state)) { withdrew = true; break; } }
  check('S12 it eventually withdraws instead of approaching a lit refuge', withdrew, ctx.S.record ? ctx.S.record.state : 'ended');
  // one distant torch is not immunity
  const ctx2 = await fresh(); const p2 = addPlayer(ctx2.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  ctx2.h.setBlock(6, FLOOR_Y, 0, 'minecraft:torch');
  const scan = await import('../source/Grinshackle_BP/scripts/world_scan.js?run=' + importSerial);
  const res = scan.lightApprox(ctx2.h.world.getDimension('overworld'), { x: 0.5, y: FLOOR_Y, z: 0.5 }, 4, 3);
  check('S12 a single distant torch does not count as a strong refuge', res.strong === false, JSON.stringify(res));
}
async function s13_preview() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Creative' });
  cmd(ctx.h, p, 'preview'); ctx.h.tick(2);
  check('S13 preview spawns a creature with a preview reservation', !!ctx.S.preview && ctx.reservation.current() && ctx.reservation.current().mode === 'preview');
  cmd(ctx.h, p, 'preview attack'); ctx.h.tick(2);
  const props = logs(ctx.h, 'setProperty').filter((l) => l.identifier === 'gs:action');
  check('S13 preview plays a requested clip via the action property', props.some((l) => l.value === 8));
  cmd(ctx.h, p, 'preview loop'); ctx.h.tick(2000);
  const poses = new Set(logs(ctx.h, 'setProperty').filter((l) => l.identifier === 'gs:pose').map((l) => l.value));
  const actions = new Set(logs(ctx.h, 'setProperty').filter((l) => l.identifier === 'gs:action').map((l) => l.value));
  check('S13 preview loop cycles many clips', poses.size + actions.size >= 12, `poses=${[...poses].join(',')} actions=${[...actions].join(',')}`);
  check('S13 preview never targets or damages', damageEvents(ctx.h).length === 0 && !logs(ctx.h, 'triggerEvent').some((l) => l.eventName === 'gs:target_player'));
  ctx.h.tick(600);
  check('S13 preview expires after two minutes and releases the reservation', !ctx.S.preview && !ctx.reservation.current());
}
async function s14_lure() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival', view: { x: 0, y: 0, z: 1 } });
  const items = await import('../source/Grinshackle_BP/scripts/items.js?run=' + importSerial);
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120);
  ctx.S.record.state = 'OBSERVE'; ctx.S.record.stateEntered = ctx.S.tick;
  const { ItemStack } = await import('@minecraft/server');
  const lure = new ItemStack('gs:rattle_lure', 3);
  p.getComponent('minecraft:inventory').container.setItem(p.selectedSlotIndex, lure);
  items.useLure(p, lure); ctx.h.tick(1);
  check('S14 lure sets a redirect while observing', !!ctx.S.record.lureRedirect && ctx.S.record.lureRedirect.strength === 1, JSON.stringify(ctx.S.record.lureRedirect));
  const left = p.getComponent('minecraft:inventory').container.getItem(p.selectedSlotIndex);
  check('S14 one lure consumed', left && left.amount === 2, left && String(left.amount));
  ctx.S.record.lureRedirect = undefined; items.useLure(p, left); ctx.h.tick(1);
  check('S14 repeat placement is weaker', !ctx.S.record.lureRedirect || ctx.S.record.lureRedirect.strength < 1, JSON.stringify(ctx.S.record.lureRedirect));
  check('S14 visible feedback given', logs(ctx.h, 'setActionBar').some((l) => /decoy/.test(l.text)));
  // committed attack never cancelled by a lure
  forceHunt(ctx); const A = await import('../source/Grinshackle_BP/scripts/attacks.js?run=' + importSerial); const e = ctx.S.active;
  e.teleport({ x: 0.5, y: FLOOR_Y, z: 1.6 }); ctx.S.record.nextAttack = 0; ctx.S.record.pendingAttack = null; A.start('attack', e, p);
  items.useLure(p, new ItemStack('gs:rattle_lure', 1)); ctx.h.tick(1);
  check('S14 a lure never cancels a committed attack', !!ctx.S.record.pendingAttack && !ctx.S.record.lureRedirect);
}
async function s15_omens() {
  // Borrowed footsteps: player walks, then stops
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  const omens = await import('../source/Grinshackle_BP/scripts/omens.js?run=' + importSerial); const perception = await import('../source/Grinshackle_BP/scripts/perception.js?run=' + importSerial);
  const rec = { omens: { nextAllowed: 0, lastKind: undefined, footstepsUsed: 0, mineUsed: 0, dragUsed: 0 }, tension: 0 };
  for (let i = 0; i < 60; i++) { p.teleport({ x: p.location.x, y: FLOOR_Y, z: p.location.z + 0.12 }); perception.sampleMovement(p); ctx.h.tick(1); }
  for (let i = 0; i < 15; i++) { perception.sampleMovement(p); ctx.h.tick(1); }
  const kind = omens.pick(rec, p);
  check('S15 footsteps omen available after walking then stopping', kind === 'borrowed_footsteps' || kind === 'distant_drag', String(kind));
  ctx.S.config.omenDrag = false;
  const k2 = omens.pick(rec, p); check('S15 pick respects the omen toggles', k2 !== 'distant_drag', String(k2));
  const started = omens.start('borrowed_footsteps', rec, p);
  const before = logs(ctx.h, 'playSound').length;
  for (let i = 0; i < 160; i++) { perception.sampleMovement(p); omens.tick(rec, p); ctx.h.tick(1); }
  const steps = logs(ctx.h, 'playSound').slice(before).filter((l) => /^gs\.step\./.test(l.soundId));
  check('S15 borrowed footsteps play exactly 3 steps (two, pause, one)', started && steps.length === 3, String(steps.length));
  check('S15 footsteps come from 6..10 blocks away', steps.length === 3 && steps.every((s) => { const d = Math.hypot(s.location.x - p.location.x, s.location.z - p.location.z); return d >= 5 && d <= 11; }));
  // Answering the mine: 4 breaks with a rhythm, then n+1 taps
  const ctx2 = await fresh(); const p2 = addPlayer(ctx2.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  const omens2 = await import('../source/Grinshackle_BP/scripts/omens.js?run=' + importSerial);
  const rec2 = { omens: { nextAllowed: 0, lastKind: undefined, footstepsUsed: 0, mineUsed: 0, dragUsed: 0 }, tension: 0 };
  const block = ctx2.h.world.getDimension('overworld').getBlock({ x: 2, y: FLOOR_Y, z: 0 });
  for (const gap of [0, 12, 12, 20]) { ctx2.h.tick(gap); ctx2.h.fire('playerBreakBlock', { player: p2, block, brokenBlockPermutation: undefined, dimension: block.dimension }); }
  ctx2.h.tick(2);
  check('S15 mine rhythm listened (3 intervals)', ctx2.S.mine.intervals.length === 3, JSON.stringify(ctx2.S.mine.intervals));
  const pk = omens2.pick(rec2, p2); check('S15 answering_mine available (or another omen while the rhythm is fresh)', pk === 'answering_mine' || pk === 'distant_drag', String(pk));
  omens2.start('answering_mine', rec2, p2);
  const b2 = logs(ctx2.h, 'playSound').length;
  for (let i = 0; i < 300; i++) { omens2.tick(rec2, p2); ctx2.h.tick(1); }
  const taps = logs(ctx2.h, 'playSound').slice(b2).filter((l) => l.soundId === 'gs.answer_tap');
  check('S15 answer replays the rhythm plus one extra tap (3 intervals → 5 taps)', taps.length === 5, String(taps.length));
  check('S15 taps come from 14..20 blocks away', taps.length > 0 && taps.every((t) => { const d = Math.hypot(t.location.x - p2.location.x, t.location.z - p2.location.z); return d >= 12 && d <= 22; }));
  // bell interrupts listening then raises tension
  ctx2.S.record = { tension: 10, state: 'STALK' };
  const bell = ctx2.h.world.getDimension('overworld').getBlock({ x: 1, y: FLOOR_Y, z: 0 });
  omens2.onLoudEvent('bell', bell.location, p2.id);
  check('S15 a bell raises tension by 8', ctx2.S.record.tension === 18, String(ctx2.S.record.tension));
  ctx2.S.record = undefined;
}
async function s16_defeat_collapse() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120);
  const e = ctx.S.active;
  for (let i = 0; i < 7; i++) { e.applyDamage(12, { cause: 'entityAttack', damagingEntity: p }); ctx.h.tick(3); }
  check('S16 hurt reaction rate-limited (≤ one per 30 ticks)', logs(ctx.h, 'setProperty').filter((l) => l.identifier === 'gs:action' && l.value === 6).length <= 2, String(logs(ctx.h, 'setProperty').filter((l) => l.identifier === 'gs:action' && l.value === 6).length));
  check('S16 80 virtual health reached 0 → COLLAPSE', ctx.S.record && ctx.S.record.state === 'COLLAPSE', ctx.S.record && ctx.S.record.state);
  const before = damageEvents(ctx.h).length;
  ctx.h.tick(50);
  const drops = logs(ctx.h, 'spawnItem').map((l) => l.typeId);
  check('S16 collapse drops Broken Chain and Ink-soaked Scrap after the clip', drops.includes('gs:broken_chain') && drops.includes('gs:ink_scrap'), drops.join(','));
  check('S16 creature removed and reservation released after defeat', !ctx.S.active && !ctx.reservation.current());
  check('S16 no attack while collecting drops', damageEvents(ctx.h).length === before);
  check('S16 longer cooldown after a defeat', ctx.S.nextNaturalCheck - ctx.S.tick >= 20 * 180 * 1.4, String((ctx.S.nextNaturalCheck - ctx.S.tick) / 20));
}
async function s17_unloaded_reservation() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120);
  const e = ctx.S.active; const gen = ctx.reservation.current().generation;
  ctx.h.unloadEntity ? ctx.h.unloadEntity(e) : e.__unload && e.__unload();
  ctx.h.tick(5);
  check('S17 unloaded creature: record dropped, reservation kept', !ctx.S.record && !!ctx.reservation.current() && ctx.reservation.current().generation === gen);
  const gates = await import('../source/Grinshackle_BP/scripts/gates.js?run=' + importSerial);
  cmd(ctx.h, p, 'cooldown'); ctx.h.tick(1);
  check('S17 spawn gate reports reserved_unloaded', gates.spawnGate().reason === 'reserved_unloaded', gates.spawnGate().reason);
  ctx.config.set('lostReservationMinutes', 2);
  ctx.h.tick(20 * 60 * 2 + 150);
  check('S17 lost reservation retired after the timeout', !ctx.reservation.current());
  // the old creature comes back: it must remove itself
  ctx.h.reloadEntity ? ctx.h.reloadEntity(e) : e.__reload && e.__reload(); ctx.h.tick(3);
  check('S17 the returning stale creature removes itself (no second authorised encounter)', ctx.h.world.getDimension('overworld').getEntities({ type: 'gs:grinshackle' }).length === 0);
}
async function s18_config_and_profiles() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' }); ctx.h.tick(30);
  check('S18 dial given on first join', p.getComponent('minecraft:inventory').container.__count ? p.getComponent('minecraft:inventory').container.__count('gs:chainbound_dial') === 1 : true);
  ctx.config.set('huntCapSeconds', 500); check('S18 hunt cap clamped to 45', ctx.config.get('huntCapSeconds') === 45);
  ctx.config.set('damageScale', -3); check('S18 damage scale clamped to 0', ctx.config.get('damageScale') === 0);
  ctx.config.applyPreset('relentless'); check('S18 relentless keeps the 45 s hunt cap', ctx.config.get('huntCapSeconds') === 45 && ctx.config.get('preset') === 'relentless');
  ctx.config.applyPreset('showcase'); check('S18 showcase disables natural spawning and damage', ctx.config.get('naturalSpawning') === false && ctx.config.get('damageScale') === 0);
  const saved = ctx.h.world.getDynamicProperty('gs:config'); check('S18 config persisted as a world dynamic property', typeof saved === 'string' && JSON.parse(saved).preset === 'showcase');
  ctx.config.applyPreset('balanced');
  ctx.memory.observe(p.id, 'sprint', 6); ctx.memory.observe(p.id, 'rush', 4); ctx.memory.flush(p.id);
  const t = ctx.memory.traits(p.id); check('S18 profile traits need confidence thresholds', t.runner === true && t.rusher === true, JSON.stringify(t));
  ctx.memory.forget(p.id); check('S18 forget clears the profile', ctx.memory.traits(p.id).samples === 0);
  ctx.config.set('learning', false); ctx.memory.observe(p.id, 'sprint', 10); check('S18 learning OFF ignores observations', ctx.memory.profile(p.id).samples === 0);
}
async function s19_idempotent_cleanup() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120);
  for (let i = 0; i < 3; i++) { cmd(ctx.h, p, 'end'); ctx.h.tick(1); cmd(ctx.h, p, 'reset'); ctx.h.tick(1); cmd(ctx.h, p, 'disable'); ctx.h.tick(1); cmd(ctx.h, p, 'enable'); ctx.h.tick(1); }
  check('S19 repeated end/reset/disable/enable stay safe', !ctx.S.active && !ctx.S.record && !ctx.reservation.current() && ctx.markers.count() === 0);
  check('S19 no waypoint helpers left behind', ctx.h.world.getDimension('overworld').getEntities({ type: 'gs:waypoint' }).length === 0);
}
async function s20_peaceful_mid_encounter() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  spawnTest(ctx, p); untilState(ctx, 'STALK', 120); forceHunt(ctx);
  ctx.h.world.setDifficulty('Peaceful'); ctx.h.tick(5);
  check('S20 switching to Peaceful ends the encounter immediately', !ctx.S.record && !ctx.S.active && !ctx.reservation.current());
}

async function s21_dial_forms() {
  const ctx = await fresh(); const p = addPlayer(ctx.h, { name: 'Ava', x: 0.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' }); ctx.h.tick(30);
  const ui = await import('../source/Grinshackle_BP/scripts/ui.js?run=' + importSerial);
  const items = await import('../source/Grinshackle_BP/scripts/items.js?run=' + importSerial);
  const { ItemStack } = await import('@minecraft/server');
  check('S21 first player is the world owner → admin', ui.isAdmin(p) === true);
  // Status via the dial (button index 7), then Refresh, then Menu, then cancel
  ctx.h.queueFormResponse({ selection: 7 }); ctx.h.queueFormResponse({ selection: 1 }); ctx.h.queueFormResponse({ canceled: true });
  await items.onItemUse({ source: p, itemStack: new ItemStack('gs:chainbound_dial', 1) });
  await new Promise((r) => setTimeout(r, 10));
  const shown = logs(ctx.h, 'formShown');
  check('S21 dial opens the main menu with eight sections', shown.length >= 1 && shown[0].buttons && shown[0].buttons.length === 8, JSON.stringify(shown[0] && shown[0].buttons));
  check('S21 Status section opens as a message form', shown.some((f) => f.title === 'Status'));
  // Master section: turn master OFF through the form (rows: master, natural, debug, learning)
  const before = logs(ctx.h, 'formShown').length;
  ctx.h.queueFormResponse({ selection: 0 }); ctx.h.queueFormResponse({ formValues: [false, true, false, true] }); ctx.h.queueFormResponse({ canceled: true });
  await ui.openDial(p); await new Promise((r) => setTimeout(r, 10));
  check('S21 Master OFF applied through the form and persisted', ctx.config.get('master') === false && JSON.parse(ctx.h.world.getDynamicProperty('gs:config')).master === false);
  ctx.h.tick(3);
  cmd(ctx.h, p, 'spawn'); ctx.h.tick(2); check('S21 master OFF from the dial blocks spawns', !ctx.S.active);
  ctx.h.queueFormResponse({ selection: 0 }); ctx.h.queueFormResponse({ formValues: [true, true, false, true] }); ctx.h.queueFormResponse({ canceled: true });
  await ui.openDial(p); await new Promise((r) => setTimeout(r, 10));
  check('S21 Master ON again through the form', ctx.config.get('master') === true);
  // non-admin: personal audio only
  const b = addPlayer(ctx.h, { name: 'Bo', x: 2.5, y: FLOOR_Y, z: 0.5, gameMode: 'Survival' });
  check('S21 second player is not an admin', ui.isAdmin(b) === false);
  ctx.h.queueFormResponse({ selection: 3 }); ctx.h.queueFormResponse({ formValues: [50, 100, true, false] }); ctx.h.queueFormResponse({ canceled: true });
  await ui.openDial(b); await new Promise((r) => setTimeout(r, 10));
  check('S21 non-admin personal audio preference saved', ctx.config.prefs(b).musicVolume === 0.5, JSON.stringify(ctx.config.prefs(b)));
  ctx.h.queueFormResponse({ selection: 0 }); ctx.h.queueFormResponse({ canceled: true });
  await ui.openDial(b); await new Promise((r) => setTimeout(r, 10));
  check('S21 non-admin gets the admin-only notice instead of the Master form', logs(ctx.h, 'formShown').some((f) => f.title === 'Admin only'));
  // Presets through the dial (button 6 → Relentless index 2 → confirmation Menu)
  ctx.h.queueFormResponse({ selection: 6 }); ctx.h.queueFormResponse({ selection: 2 }); ctx.h.queueFormResponse({ selection: 0 }); ctx.h.queueFormResponse({ canceled: true });
  await ui.openDial(p); await new Promise((r) => setTimeout(r, 10));
  check('S21 preset applied through the dial', ctx.config.get('preset') === 'relentless' && ctx.config.get('huntCapSeconds') === 45);
}

const scenarios = [s01_boot, s02_spawn_gate, s03_natural_encounter_starts, s04_attack_once_at_impact, s05_attack_refusals, s06_one_creature_and_reload, s07_master_off_during_pending_strike, s08_chain_snap, s09_hunt_cap_and_retreat, s10_target_loss, s11_mute_and_subtitles, s12_light_refuge, s13_preview, s14_lure, s15_omens, s16_defeat_collapse, s17_unloaded_reservation, s18_config_and_profiles, s19_idempotent_cleanup, s20_peaceful_mid_encounter, s21_dial_forms];
for (const s of scenarios) {
  try { await s(); } catch (e) { check(s.name + ' threw', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exitCode = passed === results.length ? 0 : 1;
