// The Brinesleeper's own mind: an aquatic predator. What a creature that is out in the world does (summoned, natural,
// or come back for you).
//  lurk      it moves under the water, unseen, keeping its distance; bubbles where it passes
//  surface   far off, its head breaks the surface and it watches you. Look at it and it is gone.
//  approach  it comes for the shore you stand on, under the water: the wake crosses the lake toward you
//  climb     it hauls itself out onto the bank (no more circling below a ledge it can't get up)
//  standoff  it stands and stares; come at it or stare it down and it breaks: charge, or back to the water
//  stalk     on land it creeps after you; seen from far away, it vanishes
//  chase     it runs you down: faster than you, leaps, lunges, roars
//  deep      if you are in the water it swims at you far faster than you swim, grabs you, drags you down, circles
//  ambush    at the edge where you stand: bubbles, then it bursts out and pulls you toward the water
// Its swimming and climbing are driven here, a little every tick, so it never gets lost in the water.
import { world, system, BlockVolume, ItemStack, GameMode, EntityDamageCause } from '@minecraft/server';
import { config, preset, threat, freq } from './config.js';
import {
  CREATURE, STAGED, TPS, FORM, rand, randInt, chance, pick, now, sub, add, mul, flat, norm, len,
  block, isWater, inBiome, looksAt, inSight, sound, particle, waterSurface, floorAt, nearWater, findSpot,
  creatures, setMode, setAct, removeQuietly, spawnShade, overworld, health, sting, debug,
} from './main.js';

const S = 1.15;                                                     // the model's scale (horror.py SCALE)
const DEPTH = { submerged_watch: 2.06 * S, water_rise: 0.5 * S, emerge_roar: 0.375 * S };
const LURK_DEPTH = 3.6;                                             // how deep it moves when it does not want to be seen
const minds = new Map();
const LIGHTS_CANDLE = ['minecraft:candle', ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray',
  'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => `minecraft:${c}_candle`)];
const LIGHTS_ITEM = { 'minecraft:torch': 'minecraft:torch', 'minecraft:soul_torch': 'minecraft:soul_torch',
  'minecraft:lantern': 'minecraft:lantern', 'minecraft:soul_lantern': 'minecraft:soul_lantern' };
const LIGHTS_FIRE = ['minecraft:campfire', 'minecraft:soul_campfire'];
const WHISPERS = [
  '...the water remembers you...', "...don't look down...", '...you are so close to the edge...', "...it's warmer under the water...",
  '...we heard you splash...', '...stay a while...', '...it saw you first...', '...something is under you...', '...keep swimming...',
];

const hunter = (p) => { try { const m = p.getGameMode(); return m === GameMode.Survival || m === GameMode.Adventure; } catch (e) { return false; } };
const watcher = (p) => { try { return p.getGameMode() !== GameMode.Spectator; } catch (e) { return false; } };
const grudgeOf = (p) => Number(p.getDynamicProperty('brine:grudge') ?? 0);
function addGrudge(p, k) { try { p.setDynamicProperty('brine:grudge', Math.max(0, Math.min(10, grudgeOf(p) + k))); } catch (e) { /* gone */ } }
const seenByAnyone = (c) => world.getAllPlayers().some((p) => p.dimension.id === c.dimension.id && inSight(p, c.getHeadLocation(), 72));
const playerById = (id) => world.getAllPlayers().find((p) => p.id === id);
const gap = () => Math.round(randInt(...preset().stalkGap) * TPS / freq());

function mindOf(c) {
  let m = minds.get(c.id);
  if (!m) {
    m = { state: 'idle', since: now(), until: 0, last: c.location, lastMove: now(), seenFor: 0, unseenFor: 0, sightings: 0,
      cooldownUntil: now() + randInt(4, 10) * TPS, nextEyes: 0, nextSnuff: now() + 20 * TPS, nextLunge: 0, nextBubble: 0,
      swim: null, climb: null, hold: null, chaseEnd: 0, best: 999, stuckFor: 0, target: undefined, chased: undefined };
    minds.set(c.id, m);
    setMode(c, 'roam_water');
  }
  return m;
}
function applySpeed(c) {
  system.runTimeout(() => {
    try {
      for (const id of ['minecraft:movement', 'minecraft:underwater_movement']) {
        const mv = c.getComponent(id);
        if (mv) mv.setCurrentValue(mv.defaultValue * threat().speed);
      }
    } catch (e) { /* gone */ }
  }, 2);
}
function mode(c, name) { setMode(c, name); applySpeed(c); }
function go(c, m, state, seconds) {
  m.state = state;
  m.since = now();
  m.until = now() + Math.round((seconds ?? 10) * TPS);
  m.seenFor = 0;
  debug(`brinesleeper: ${state}`);
}

// ------------------------------------------------------------------ places in the water
function surfaceNear(dim, pos, up = 6, down = 10) {
  return waterSurface(dim, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), up, down);
}
/** a water surface around the player, at a distance band, deep enough to hide in, optionally in plain view */
function waterAround(player, minD, maxD, opts = {}) {
  return findSpot(player, 'water', minD, maxD, { depth: opts.depth ?? 3, eyeHeight: 0.4, tries: opts.tries ?? 24, allowView: opts.allowView,
    sight: opts.sight });
}
/** a bank it can haul out onto near the player: open floor (5 high) right next to water it can swim to */
function bankNear(c, player) {
  const dim = player.dimension;
  const p = player.location;
  let best;
  for (let i = 0; i < 48; i++) {
    const a = Math.random() * Math.PI * 2, r = rand(4, 11);
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    const f = floorAt(dim, x, Math.floor(p.y), z, 5, 3, 4);
    if (!f) continue;
    let w;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const s = waterSurface(dim, Math.floor(f.x) + dx, Math.floor(f.y), Math.floor(f.z) + dz, 1, 4);
      if (s && s.depth >= 2 && f.y - s.y <= 3) { w = s; break; }
    }
    if (!w) continue;
    const score = Math.abs(flat(f, p) - 7) + flat(w, c.location) * 0.05;
    if (!best || score < best.score) best = { bank: f, water: w, score };
  }
  return best;
}

// ------------------------------------------------------------------ the motor: swimming, climbing, holding (every tick)
function motor(c, m) {
  if (m.climb) {
    const k = m.climb;
    const p = k.path[k.i++];
    try { c.teleport(p, { facingLocation: k.face }); } catch (e) { m.climb = null; return; }
    if (k.i >= k.path.length) { m.climb = null; k.then?.(); }
    return;
  }
  if (m.swim) {
    const sw = m.swim;
    const pos = c.location;
    const to = sub(sw.goal, pos);
    const dist = len(to);
    if (dist < 0.7) { m.swim = null; sw.then?.(); return; }
    const step = Math.min(sw.speed * threat().speed, dist);
    const dir = norm(to);
    let next = add(pos, mul(dir, step));
    const wet = (q) => isWater(block(c.dimension, add(q, { x: 0, y: 0.6, z: 0 })));
    if (!wet(next)) {
      const up = add(next, { x: 0, y: 0.7, z: 0 }), down = add(next, { x: 0, y: -0.7, z: 0 });
      if (wet(up)) next = up; else if (wet(down)) next = down;
      else if (++sw.blocked > 8) { m.swim = null; sw.fail?.(); return; }
      else return;
    }
    try { c.teleport(next, { facingLocation: add(next, { x: dir.x, y: 0, z: dir.z }) }); } catch (e) { m.swim = null; return; }
    if (sw.wake && now() % 6 === 0) {                             // the water moves above it
      const s = surfaceNear(c.dimension, next, 6, 1);
      if (s) particle(c.dimension, 'brine:ripple', s);
    }
    return;
  }
  if (m.hold) { try { c.teleport(m.hold); } catch (e) { /* gone */ } }
}
/** swim under the water to a point (driven here: straight, fast, never lost) */
function swimTo(c, m, goal, speed, then, fail, wake = false) {
  m.hold = null;
  m.climb = null;
  m.swim = { goal, speed, then, fail, wake, blocked: 0 };
  mode(c, 'hold');
  setAct(c, 'swim');
}
/** haul out of the water onto a bank: up the side, then over the lip */
function climbOut(c, m, bank, face, then) {
  const from = c.location;
  const lip = { x: (from.x + bank.x) / 2, y: bank.y + 0.4, z: (from.z + bank.z) / 2 };
  const path = [];
  for (let i = 1; i <= 8; i++) path.push({ x: from.x + (lip.x - from.x) * i / 16, y: from.y + (lip.y - from.y) * i / 8, z: from.z + (lip.z - from.z) * i / 16 });
  for (let i = 1; i <= 6; i++) path.push({ x: path[7].x + (bank.x - path[7].x) * i / 6, y: lip.y + (bank.y - lip.y) * i / 6, z: path[7].z + (bank.z - path[7].z) * i / 6 });
  m.swim = null;
  m.hold = null;
  m.climb = { path, i: 0, face, then };
  mode(c, 'hold');
  setAct(c, 'water_rise');
  sound(c.dimension, 'brine.fx.surge', from, 1.1, 0.9);
  sound(c.dimension, 'mob.brinesleeper.emerge', from, 1, rand(0.85, 1));
  particle(c.dimension, 'brine:splash', { x: from.x, y: bank.y - 0.5, z: from.z });
}

// ------------------------------------------------------------------ the heartbeat
const nearest = new Map();
const nextBeat = new Map();
function feel(player, d, chasing) {
  const n = nearest.get(player.id);
  if (!n || d < n.d) nearest.set(player.id, { d, chasing: chasing || (n && n.chasing) });
}
function heartbeats() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const n = nearest.get(p.id);
    if (!config.heartbeat || !n || n.d > 30) continue;
    if (t < (nextBeat.get(p.id) ?? 0)) continue;
    const bpm = n.chasing ? 150 : n.d < 6 ? 130 : n.d < 12 ? 105 : n.d < 20 ? 86 : 68;
    try { p.playSound('brine.heartbeat', { volume: Math.max(0.35, Math.min(1, 1.15 - n.d / 30)) }); } catch (e) { /* gone */ }
    nextBeat.set(p.id, t + Math.round((60 / bpm) * TPS));
  }
  nearest.clear();
}

// ------------------------------------------------------------------ small acts
function eyes(c, m, d) {
  if (now() < m.nextEyes || d < 5) return;
  m.nextEyes = now() + 20;
  const h = c.getHeadLocation();
  const v = c.getViewDirection();
  const f = norm({ x: v.x, y: 0, z: v.z });
  const r = { x: -f.z, y: 0, z: f.x };
  for (const s of [-0.15, 0.15]) particle(c.dimension, 'brine:eyes', add(add(h, mul(f, 0.42)), add(mul(r, s), { x: 0, y: -0.06, z: 0 })));
}
function shake(player, strength, seconds) {
  if (!config.screen) return;
  try { player.runCommand(`camerashake add @s ${strength} ${seconds} positional`); } catch (e) { /* ok */ }
}
function music(player, on) {
  if (!config.music || !player) return;
  try { if (on) player.playMusic('music.brine.chase', { loop: true, fade: 0.5, volume: 0.9 }); else player.stopMusic(); } catch (e) { /* ok */ }
}
function whisper(player, line) {
  if (!config.whispers) return;
  try { player.onScreenDisplay.setActionBar(`§8§o${line ?? pick(WHISPERS)}`); } catch (e) { /* gone */ }
}
/** it takes a light from you: a torch or lantern you aren't looking at falls to the floor, candles and campfires go out */
function snuffLight(player) {
  const p = player.location;
  let found = [];
  try {
    const vol = new BlockVolume({ x: Math.floor(p.x) - 10, y: Math.floor(p.y) - 4, z: Math.floor(p.z) - 10 },
      { x: Math.floor(p.x) + 10, y: Math.floor(p.y) + 5, z: Math.floor(p.z) + 10 });
    for (const loc of player.dimension.getBlocks(vol, { includeTypes: [...Object.keys(LIGHTS_ITEM), ...LIGHTS_CANDLE, ...LIGHTS_FIRE] }, false)
      .getBlockLocationIterator()) {
      if (found.length > 40) break;
      found.push({ x: loc.x, y: loc.y, z: loc.z });
    }
  } catch (e) { return false; }
  found = found.filter((l) => flat(l, p) > 3 && !looksAt(player, add(l, { x: 0.5, y: 0.5, z: 0.5 }), 0.75));
  if (!found.length) return false;
  const loc = pick(found);
  const b = block(player.dimension, loc);
  if (!b) return false;
  const at = add(loc, { x: 0.5, y: 0.4, z: 0.5 });
  try {
    if (LIGHTS_CANDLE.includes(b.typeId)) {
      if (!b.permutation.getState('lit')) return false;
      b.setPermutation(b.permutation.withState('lit', false));
    } else if (LIGHTS_FIRE.includes(b.typeId)) {
      if (b.permutation.getState('extinguished')) return false;
      b.setPermutation(b.permutation.withState('extinguished', true));
    } else {
      const item = LIGHTS_ITEM[b.typeId];
      b.setType('minecraft:air');
      player.dimension.spawnItem(new ItemStack(item, 1), at);          // nothing is taken: you'll find it on the floor
    }
  } catch (e) { return false; }
  particle(player.dimension, 'brine:smoke', at);
  sound(player.dimension, 'brine.fx.snuff', at, 0.8, rand(0.9, 1.1));
  return true;
}

// ------------------------------------------------------------------ vanishing: seen from far away, it is simply not there
function vanish(c, m, target) {
  const pos = c.location;
  if (c.isInWater || isWater(block(c.dimension, { x: pos.x, y: pos.y + 0.5, z: pos.z }))) {
    const s = surfaceNear(c.dimension, pos, 6, 2);
    if (s) particle(c.dimension, 'brine:ripple', s);
    sound(c.dimension, 'mob.brinesleeper.submerge', pos, 0.5, rand(0.8, 0.95));
  } else {
    particle(c.dimension, 'brine:smoke', add(pos, { x: 0, y: 1.5, z: 0 }));
    particle(c.dimension, 'brine:smoke', add(pos, { x: 0, y: 3, z: 0 }));
    particle(c.dimension, 'brine:drips', add(pos, { x: 0, y: 0.5, z: 0 }));
    sound(c.dimension, 'mob.brinesleeper.hiss', pos, 0.45, rand(0.8, 0.9));
  }
  // somewhere you are not looking: deep water first, out of sight on land otherwise
  const w = target ? waterAround(target, 28, 46, { depth: 4 }) : undefined;
  const f = !w && target ? findSpot(target, 'floor', 30, 46, { room: 5, eyeHeight: 3.2, tries: 20 }) : undefined;
  const to = w ? { x: w.x, y: w.y - LURK_DEPTH, z: w.z } : f;
  m.swim = null;
  m.climb = null;
  m.hold = null;
  m.sightings++;
  if (to) { try { c.teleport(to); } catch (e) { /* ok */ } }
  else if (c.isInWater) { try { c.teleport(add(pos, { x: 0, y: -2.5, z: 0 })); } catch (e) { /* ok */ } }
  m.last = c.location;
  m.lastMove = now();
  lurk(c, m, target);
}

// ------------------------------------------------------------------ states
function lurk(c, m, target, seconds) {
  go(c, m, 'lurk', seconds ?? rand(6, 14) / freq());
  setAct(c, 'swim');
  if (!target) return;
  const s = waterAround(target, 18, 32, { depth: 4, tries: 16 });
  if (s && flat(s, c.location) < 64) swimTo(c, m, { x: s.x, y: s.y - LURK_DEPTH, z: s.z }, 0.2, undefined, undefined);
  else if (!c.isInWater) { m.swim = null; setAct(c, 'none'); mode(c, 'stalk'); }
}
function surface(c, m, target) {
  const s = waterAround(target, 18, 32, { depth: 3, sight: true, tries: 28 });
  if (!s) { approach(c, m, target); return; }
  // it rises where you could see it if you turned; the head first
  const rise = () => {
    const act = chance(0.3) ? 'water_rise' : 'submerged_watch';
    m.hold = { x: s.x, y: s.y - DEPTH[act], z: s.z };
    setAct(c, act);
    try { c.teleport(m.hold, { facingLocation: target.getHeadLocation() }); } catch (e) { /* ok */ }
    go(c, m, 'surface', rand(10, 18));
    m.watchNeed = randInt(15, 32);                                  // ticks of being looked at before it goes
    particle(c.dimension, 'brine:ripple', s);
  };
  if (!c.isInWater && seenByAnyone(c)) { stalk(c, m); return; }
  if (flat(s, c.location) < 6 || !c.isInWater) { try { c.teleport({ x: s.x, y: s.y - LURK_DEPTH, z: s.z }); } catch (e) { /* ok */ } rise(); return; }
  swimTo(c, m, { x: s.x, y: s.y - LURK_DEPTH, z: s.z }, 0.3, rise, () => rise());
  go(c, m, 'moving', 20);
}
function approach(c, m, target) {
  const b = bankNear(c, target);
  if (!b) {                                                         // nowhere to come ashore near you: stalk you from the water's edge on land
    if (!c.isInWater) { stalk(c, m); return; }
    lurk(c, m, target);
    return;
  }
  // at the very edge where you stand, it lies in wait instead
  if (!target.isInWater && flat(b.water, target.location) < 4 && chance(0.4)) { ambush(c, m, target, b.water); return; }
  go(c, m, 'approach', 30);
  const at = { x: b.water.x, y: b.water.y - DEPTH.submerged_watch - 0.4, z: b.water.z };
  const haul = () => climbOut(c, m, b.bank, target.getHeadLocation(), () => standoff(c, m, target));
  if (!c.isInWater) {
    if (seenByAnyone(c)) { stalk(c, m); return; }                   // on land and in sight: it comes on foot instead
    try { c.teleport(at); } catch (e) { /* ok */ }
    haul();
    return;
  }
  swimTo(c, m, at, 0.32, haul, () => vanish(c, m, target), true);
}
function standoff(c, m, target) {
  m.swim = null;
  m.hold = null;
  go(c, m, 'standoff', rand(4, 9));
  m.startDist = flat(target.location, c.location);
  mode(c, 'observe');
  setAct(c, chance(preset().revelation * 2) ? 'full_stand' : pick(['watch', 'head_tilt', 'hunting_stance', 'patient_strike']));
  sound(c.dimension, 'mob.brinesleeper.click', c.getHeadLocation(), 1, rand(0.75, 0.95));
  if (looksAt(target, c.getHeadLocation(), 0.8)) sting(target, 0.7);
}
function stalk(c, m) {
  m.swim = null;
  m.hold = null;
  go(c, m, 'stalk', rand(25, 50));
  m.standoffAt = rand(8, 13);
  setAct(c, 'none');
  mode(c, 'stalk');
}
function chase(c, m, target) {
  m.swim = null;
  m.hold = null;
  m.climb = null;
  go(c, m, 'chase', 30);
  m.chaseEnd = now() + randInt(...threat().chaseSeconds) * TPS;
  m.nextLunge = now() + 30;
  m.best = 999;
  m.stuckFor = 0;
  m.chased = target.id;
  setAct(c, 'none');
  mode(c, 'hunt');
  sound(c.dimension, 'mob.brinesleeper.roar', c.getHeadLocation(), 1.4, rand(0.9, 1));
  sting(target, 0.9);
  music(target, true);
  shake(target, 0.2, 0.5);
}
function endChase(c, m) {
  music(playerById(m.chased), false);
  m.chased = undefined;
  m.cooldownUntil = now() + gap();
}
function deep(c, m, target) {
  go(c, m, 'deep', randInt(...threat().chaseSeconds));
  m.chased = target.id;
  m.passes = 0;
  m.grasped = false;
  sound(c.dimension, 'mob.brinesleeper.moan', c.location, 1.2, rand(0.85, 0.95));
  sting(target, 0.9);
  music(target, true);
}
/** back to the water and under, then gone */
function retreat(c, m, target) {
  m.swim = null;
  m.hold = null;
  if (m.state === 'chase') endChase(c, m);
  go(c, m, 'retreat', 12);
  setAct(c, 'none');
  if (c.isInWater) { vanish(c, m, target); return; }
  mode(c, 'withdraw');
  sound(c.dimension, 'mob.brinesleeper.hiss', c.getHeadLocation(), 1, rand(0.9, 1.1));
}
function decide(c, m, target, provoked) {
  const p = preset().chase + (provoked ? 0.25 : 0) + 0.04 * grudgeOf(target);
  if (hunter(target) && now() >= m.cooldownUntil - gap() / 2 && chance(p)) chase(c, m, target);
  else retreat(c, m, target);
}
function ambush(c, m, target, water) {
  m.ambushAt = water;
  m.hold = { x: water.x, y: water.y - LURK_DEPTH, z: water.z };
  go(c, m, 'ambush', rand(3, 8));
  if (flat(water, c.location) < 4 || !c.isInWater) {
    if (seenByAnyone(c)) { lurk(c, m, target); return; }
    try { c.teleport(m.hold, { facingLocation: target.location }); } catch (e) { /* ok */ }
    mode(c, 'hold');
    setAct(c, 'swim');
    return;
  }
  const hold = m.hold;
  swimTo(c, m, hold, 0.3, () => { m.hold = hold; }, () => lurk(c, m, target), true);
}
function burst(c, m, target) {
  const s = m.ambushAt;
  m.swim = null;
  m.hold = { x: s.x, y: s.y - DEPTH.emerge_roar, z: s.z };
  try { c.teleport(m.hold, { facingLocation: target.getHeadLocation() }); } catch (e) { return; }
  setAct(c, 'emerge_roar');
  sound(c.dimension, 'brine.fx.burst', s, 1.3, 0.9);
  sound(c.dimension, 'mob.brinesleeper.roar', s, 1.4, 1);
  particle(c.dimension, 'brine:splash', s);
  particle(c.dimension, 'brine:splash', add(s, { x: 0.5, y: 0, z: -0.4 }));
  sting(target, 1);
  shake(target, 0.35, 0.6);
  const k = norm(sub(s, target.location));
  try { target.applyKnockback({ x: k.x * 0.6, z: k.z * 0.6 }, 0.12); } catch (e) { /* ok */ }
  go(c, m, 'burst', 0.8);
}

// ------------------------------------------------------------------ the grab, in the water
const graspers = new Map();
function grasp(c, m, target) {
  m.grasped = true;
  m.graspUntil = now() + 50;
  m.graspBroken = false;
  m.graspHurt = false;
  graspers.set(target.id, m);
  try { c.playAnimation('animation.brinesleeper.grasp'); } catch (e) { /* ok */ }
  sound(c.dimension, 'mob.brinesleeper.grasp', target.location, 1.2, 1);
  if (config.screen) {
    try { target.camera.fade({ fadeTime: { fadeInTime: 0.1, holdTime: 0.3, fadeOutTime: 0.6 }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch (e) { /* ok */ }
  }
}
function graspTick(c, m, target) {
  const t = now();
  if (t >= m.graspUntil || m.graspBroken || !target.isValid) { graspers.delete(target.id); return false; }
  m.hold = add(target.location, { x: 0, y: -1.2, z: 0 });
  const k = norm(sub(c.location, target.location));
  try { target.applyKnockback({ x: k.x * 0.1, z: k.z * 0.1 }, -0.34); } catch (e) { /* ok */ }
  target.addEffect('slowness', 20, { amplifier: 3, showParticles: false });
  particle(target.dimension, 'brine:bubbles', target.location);
  if (!m.graspHurt && t > m.graspUntil - 30) {
    m.graspHurt = true;
    target.applyDamage(Math.round(threat().grasp * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
  }
  if (target.isJumping && chance(0.2)) m.graspBroken = true;                       // kick for the surface
  return true;
}
function lunge(c, m, target) {
  m.nextLunge = now() + randInt(55, 100);
  try { c.playAnimation('animation.brinesleeper.lunge', { blendOutTime: 0.2 }); } catch (e) { /* ok */ }
  sound(c.dimension, 'mob.brinesleeper.lunge', c.location, 1.1, rand(0.95, 1.1));
  system.runTimeout(() => {
    if (!c.isValid || !target.isValid || flat(target.location, c.location) > 4 || preset().damage <= 0) return;
    target.applyDamage(Math.round(threat().lunge * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
    const k = norm(sub(target.location, c.location));
    try { target.applyKnockback({ x: k.x * 0.7, z: k.z * 0.7 }, 0.28); } catch (e) { /* ok */ }
    shake(target, 0.25, 0.3);
  }, 7);
}
/** on land it never gets wedged for long: a shove, then (out of sight) a nudge to open ground */
function unstick(c, m, target) {
  const t = now();
  if (m.swim || m.climb || m.hold || t - m.lastMove < 4 * TPS) return;
  if (c.isInWater && target) {                                       // stuck under a bank: climb out at the nearest place it can
    const b = bankNear(c, target);
    if (b && flat(b.water, c.location) < 6) { climbOut(c, m, b.bank, target.getHeadLocation(), () => standoff(c, m, target)); return; }
  }
  if (t - m.lastMove < 9 * TPS) {
    const dir = target ? norm(sub(target.location, c.location)) : { x: rand(-1, 1), y: 0, z: rand(-1, 1) };
    try { c.applyImpulse({ x: dir.x * 0.35, y: 0.45, z: dir.z * 0.35 }); } catch (e) { /* ok */ }
    return;
  }
  if (seenByAnyone(c)) return;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, r = rand(3, 8);
    const f = floorAt(c.dimension, Math.floor(c.location.x + Math.cos(a) * r), Math.floor(c.location.y), Math.floor(c.location.z + Math.sin(a) * r), 5, 4, 4);
    if (f) { try { c.teleport(f); } catch (e) { /* ok */ } break; }
  }
  m.last = c.location;
  m.lastMove = t;
}

function pickTarget(c, m) {
  let best, bd = 80;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== c.dimension.id || !watcher(p)) continue;
    const d = flat(p.location, c.location) - (p.id === m.target ? 8 : 0);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ------------------------------------------------------------------ one think (every 5 ticks)
function think(c) {
  const m = mindOf(c);
  const t = now();
  if (flat(c.location, m.last) > 0.7 || Math.abs(c.location.y - m.last.y) > 0.7) { m.last = c.location; m.lastMove = t; }
  const target = pickTarget(c, m);
  if (!config.enabled || !target) {
    if (m.state === 'chase' || m.state === 'deep') endChase(c, m);
    if (m.state !== 'idle') { m.swim = null; m.hold = null; m.climb = null; go(c, m, 'idle', 30); setAct(c, 'none'); mode(c, c.isInWater ? 'roam_water' : 'roam_land'); }
    unstick(c, m);
    return;
  }
  m.target = target.id;
  const d = flat(target.location, c.location);
  const head = c.getHeadLocation();
  const seen = looksAt(target, head, 0.88, 90);
  m.seenFor = seen ? m.seenFor + 5 : 0;
  m.unseenFor = seen ? 0 : m.unseenFor + 5;
  feel(target, d, m.state === 'chase' || m.state === 'deep' || m.state === 'burst');
  const water = c.isInWater || !!m.swim;

  switch (m.state) {
    case 'idle': {                                                  // it has noticed you
      if (t < m.cooldownUntil) break;
      if (water || nearWater(c.dimension, c.location, 6)) lurk(c, m, target, rand(3, 7));
      else stalk(c, m);
      break;
    }
    case 'moving': break;                                           // swimming to its next place
    case 'lurk': {
      if (!m.swim && t % 60 === 0 && c.isInWater) {                // bubbles mark where it waits
        const s = surfaceNear(c.dimension, c.location, 6, 1);
        if (s && chance(0.4)) particle(c.dimension, 'brine:bubbles', s);
      }
      if (target.isInWater && hunter(target) && d < 40 && t >= m.cooldownUntil) { deep(c, m, target); break; }
      if (t < m.until) break;
      if (t < m.cooldownUntil) { lurk(c, m, target, rand(8, 16)); if (chance(0.35)) surface(c, m, target); break; }
      if (m.sightings < (config.preset === 'quiet' ? 3 : config.preset === 'nightmare' ? 0 : randInt(1, 2))) surface(c, m, target);
      else { m.sightings = 0; approach(c, m, target); }
      break;
    }
    case 'surface': {
      eyes(c, m, d);
      if ((m.seenFor >= m.watchNeed && d > 10) || d < 10) { vanish(c, m, target); break; }
      if (t >= m.until) {
        const s = surfaceNear(c.dimension, c.location, 4, 2);
        if (s) particle(c.dimension, 'brine:ripple', s);
        m.sightings++;
        lurk(c, m, target);
      }
      break;
    }
    case 'approach': {
      if (!m.swim && !m.climb) approach(c, m, target);             // lost its way: think again
      if (target.isInWater && hunter(target) && d < 30) deep(c, m, target);
      break;
    }
    case 'standoff': {
      eyes(c, m, d);
      if (d < 6 || d < m.startDist - 4) { decide(c, m, target, true); break; }
      if (m.seenFor > randInt(70, 110)) { decide(c, m, target, false); break; }
      if (m.unseenFor > 50) { stalk(c, m); break; }
      if (t >= m.until) { decide(c, m, target, false); break; }
      if (chance(0.025)) sound(c.dimension, 'mob.brinesleeper.click', head, 0.8, rand(0.7, 0.9));
      break;
    }
    case 'stalk': {
      if (d > 14 && m.seenFor >= randInt(15, 35)) { vanish(c, m, target); break; }       // seen from afar: gone
      if (d < m.standoffAt) { standoff(c, m, target); break; }
      if (!seen && d < 8 && chance(0.05)) sound(c.dimension, 'mob.brinesleeper.breathe', head, 1.1, rand(0.8, 0.95));
      if (!seen && d < 20 && config.lights && t >= m.nextSnuff && chance(0.1) && snuffLight(target)) m.nextSnuff = t + randInt(25, 50) * TPS;
      if (water && !target.isInWater) { approach(c, m, target); break; }
      eyes(c, m, d);
      if (t >= m.until) decide(c, m, target, false);
      unstick(c, m, target);
      break;
    }
    case 'chase': {
      if (graspers.get(target.id) === m) { graspTick(c, m, target); break; }
      if (target.isInWater && c.isInWater) { endChase(c, m); deep(c, m, target); break; }
      if (!hunter(target) || d > 48 || t >= m.chaseEnd) { retreat(c, m, target); break; }
      m.stuckFor = d < m.best - 0.5 ? 0 : m.stuckFor + 5;
      m.best = Math.min(m.best, d);
      if (m.stuckFor > 6 * TPS && !inSight(target, head)) { retreat(c, m, target); break; }
      if (d > 2.4 && d < 6 && t >= m.nextLunge && inSight(target, head, 8)) lunge(c, m, target);
      if (c.isInWater && !target.isInWater) {                       // it went into the water after you: out again at your bank
        const b = bankNear(c, target);
        if (b && flat(b.water, c.location) < 7) climbOut(c, m, b.bank, target.getHeadLocation(), () => { mode(c, 'hunt'); setAct(c, 'none'); });
      }
      unstick(c, m, target);
      break;
    }
    case 'deep': {                                                  // you are in its water now
      if (graspers.get(target.id) === m) { graspTick(c, m, target); break; }
      if (!target.isInWater || t >= m.until || !hunter(target)) {
        music(target, false);
        m.chased = undefined;
        m.cooldownUntil = t + gap();
        if (!target.isInWater && d < 12) { approach(c, m, target); break; }
        lurk(c, m, target);
        break;
      }
      const goal = add(target.location, { x: 0, y: -0.8, z: 0 });
      if (d < 2.6 && !m.grasped && config.grasp && preset().damage > 0 && health(target) > 6) { m.swim = null; grasp(c, m, target); break; }
      if (m.grasped && d < 3) {                                      // it lets go and circles back around for another pass
        const a = Math.random() * Math.PI * 2;
        const away = add(target.location, { x: Math.cos(a) * 8, y: -2, z: Math.sin(a) * 8 });
        swimTo(c, m, away, 0.35, () => { m.grasped = m.passes++ < 1 ? false : true; }, undefined);
        break;
      }
      if (!m.swim || flat(m.swim.goal, goal) > 2) swimTo(c, m, goal, 0.42, undefined, () => lurk(c, m, target));
      break;
    }
    case 'ambush': {
      if (t % 10 === 0) particle(c.dimension, 'brine:bubbles', m.ambushAt);
      if (d > 10) { if (t >= m.until) lurk(c, m, target); break; }
      if (t >= m.until || (looksAt(target, m.ambushAt, 0.93) && chance(0.25))) burst(c, m, target);
      break;
    }
    case 'burst': {
      if (t >= m.until) { m.hold = null; if (hunter(target)) chase(c, m, target); else retreat(c, m, target); }
      break;
    }
    case 'retreat': {
      if (c.isInWater) { vanish(c, m, target); break; }
      if (t >= m.until || (!inSight(target, head) && d > 18)) { vanish(c, m, target); break; }
      unstick(c, m, target);
      break;
    }
    default: lurk(c, m, target);
  }
}

// ------------------------------------------------------------------ the deep: shapes beneath the swimmer
const deepSt = new Map();
function depthBelow(p) {
  let n = 0;
  const l = p.location;
  while (n < 12 && isWater(block(p.dimension, { x: l.x, y: Math.floor(l.y) - 1 - n, z: l.z }))) n++;
  return n;
}
function* shapeBeneath(player) {
  const side = rand(0, Math.PI * 2);
  const below = rand(4, 7);
  const from = add(player.location, { x: Math.cos(side) * 13, y: -below, z: Math.sin(side) * 13 });
  const to = add(player.location, { x: -Math.cos(side) * 13, y: -below - 1, z: -Math.sin(side) * 13 });
  const mid = add(player.location, { x: 0, y: -below, z: 0 });
  if (!isWater(block(player.dimension, from)) || !isWater(block(player.dimension, mid)) || !isWater(block(player.dimension, to))) return;
  const s = spawnShade(from, FORM.silhouette, 'swim', to);
  if (!s) return;
  try { s.triggerEvent('brine:huge'); } catch (e) { /* ok */ }
  sound(player.dimension, 'mob.brinesleeper.moan', mid, 1.2, rand(0.8, 0.95));
  for (let i = 0; i <= 56; i++) {
    try { s.teleport(add(from, mul(sub(to, from), i / 56)), { facingLocation: to }); } catch (e) { return; }
    if (i === 28) {
      particle(player.dimension, 'brine:bubbles', add(player.location, { x: 0, y: -1, z: 0 }));
      if (config.screen) { try { player.addEffect('darkness', 50, { amplifier: 0, showParticles: false }); } catch (e) { /* ok */ } }
    }
    yield 1;
  }
  removeQuietly(s);
}
function* brush(player) {
  const k = norm({ x: rand(-1, 1), y: 0, z: rand(-1, 1) });
  sound(player.dimension, 'brine.fx.thump', player.location, 1.2, rand(0.8, 1));
  try { player.applyKnockback({ x: k.x * 0.45, z: k.z * 0.45 }, -0.08); } catch (e) { /* ok */ }
  player.addEffect('slowness', 20, { amplifier: 1, showParticles: false });
  for (let i = 0; i < 4; i++) { particle(player.dimension, 'brine:bubbles', add(player.location, mul(k, -1.2))); yield 4; }
}
const deepRuns = new Map();
function stepDeep() {
  const t = now();
  for (const [id, run] of deepRuns) {
    if (t < run.wake) continue;
    let r;
    try { r = run.gen.next(); } catch (e) { r = { done: true }; }
    if (r.done) deepRuns.delete(id); else run.wake = t + (r.value ?? 1);
  }
}
function theDeep() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    if (deepRuns.has(p.id)) continue;
    const st = deepSt.get(p.id) ?? { swim: 0, next: t + randInt(...preset().deep) * TPS };
    deepSt.set(p.id, st);
    if (!config.enabled || !watcher(p) || !p.isInWater) { st.swim = 0; continue; }
    st.swim += 5;
    if (st.swim < 3 * TPS || t < st.next) continue;
    const near = creatures().find((c) => !c.hasTag(STAGED) && flat(c.location, p.location) < 48);
    if (!near && !inBiome(p.dimension, p.location)) continue;
    if (depthBelow(p) < 3) continue;
    st.next = t + Math.round((randInt(...preset().deep) * TPS) / freq());
    if (near && hunter(p) && chance(0.4)) {                         // it is not always a shape: sometimes it is really there
      const m = mindOf(near);
      if (m.state !== 'deep' && m.state !== 'chase') deep(near, m, p);
      continue;
    }
    deepRuns.set(p.id, { gen: chance(0.65) ? shapeBeneath(p) : brush(p), wake: t });
    if (chance(0.3)) whisper(p, pick(['...something is under you...', '...keep swimming...', "...don't look down..."]));
  }
}

// ------------------------------------------------------------------ whispers, the grudge, the return
const nextWhisper = new Map();
function murmurs() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    if (!config.whispers || !config.enabled) continue;
    if (!nextWhisper.has(p.id)) { nextWhisper.set(p.id, t + randInt(90, 200) * TPS); continue; }
    if (t < nextWhisper.get(p.id)) continue;
    nextWhisper.set(p.id, t + Math.round((randInt(120, 300) * TPS) / freq()));
    if (inBiome(p.dimension, p.location) && nearWater(p.dimension, p.location, 5)) whisper(p);
  }
}
const returns = [];
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  const a = damageSource.damagingEntity;
  if (hurtEntity.typeId !== CREATURE || !a || a.typeId !== 'minecraft:player') return;
  const p = /** @type {import('@minecraft/server').Player} */ (a);
  addGrudge(p, 1);
  const m = minds.get(hurtEntity.id);
  if (!m) return;
  if (graspers.get(p.id) === m) m.graspBroken = true;                // hit it and it lets go
  if (['standoff', 'stalk', 'idle', 'surface', 'lurk'].includes(m.state)) {
    m.swim = null;
    m.hold = null;
    if (hurtEntity.isInWater && hunter(p) && p.isInWater) deep(hurtEntity, m, p);
    else decide(hurtEntity, m, p, true);
  }
});
world.afterEvents.entityDie.subscribe(({ deadEntity, damageSource }) => {
  if (deadEntity.typeId !== CREATURE) return;
  const m = minds.get(deadEntity.id);
  if (m && m.chased) music(playerById(m.chased), false);
  minds.delete(deadEntity.id);
  const killer = damageSource.damagingEntity;
  if (killer && killer.typeId === 'minecraft:player' && config.enabled) {
    addGrudge(/** @type {import('@minecraft/server').Player} */ (killer), 3);
    returns.push({ id: killer.id, at: now() + Math.round(randInt(180, 360) * TPS / freq()) });      // it was never the only one
  }
});
function comebacks() {
  const t = now();
  for (let i = returns.length - 1; i >= 0; i--) {
    const r = returns[i];
    if (t < r.at) continue;
    const p = playerById(r.id);
    if (!p) { returns.splice(i, 1); continue; }
    if (creatures().length || !inBiome(p.dimension, p.location)) { r.at = t + 30 * TPS; continue; }
    returns.splice(i, 1);
    const s = waterAround(p, 24, 40, { depth: 4 });
    if (!s) { returns.push({ id: r.id, at: t + 60 * TPS }); continue; }
    try {
      const c = overworld().spawnEntity(CREATURE, { x: s.x, y: s.y - LURK_DEPTH, z: s.z });
      c.triggerEvent(`brine:threat_${config.threat}`);
      mindOf(c).cooldownUntil = now();
      whisper(p, "...you didn't think that was the only one...");
    } catch (e) { /* ok */ }
  }
}

// ------------------------------------------------------------------ start
function brainTick() {
  for (const c of creatures()) {
    if (c.hasTag(STAGED)) {
      for (const p of world.getAllPlayers()) {                  // a staged creature still makes your heart race
        const d = flat(p.location, c.location);
        if (p.dimension.id === c.dimension.id && d < 30) feel(p, d, false);
      }
      continue;
    }
    try { think(c); } catch (e) { console.warn(`[brine] brain: ${e}`); }
  }
  for (const id of [...minds.keys()]) if (!creatures().some((c) => c.id === id)) minds.delete(id);
  heartbeats();
  theDeep();
}
function motorTick() {
  for (const c of creatures()) {
    const m = minds.get(c.id);
    if (m && !c.hasTag(STAGED)) { try { motor(c, m); } catch (e) { /* gone */ } }
  }
  stepDeep();
}
world.afterEvents.worldLoad.subscribe(() => {
  system.runInterval(brainTick, 5);
  system.runInterval(motorTick, 1);
  system.runInterval(() => { murmurs(); comebacks(); }, 40);
});
