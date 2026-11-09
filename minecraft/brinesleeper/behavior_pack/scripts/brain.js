// The Brinesleeper's own mind: what a creature that is out in the world does (summoned, natural, or come back for you).
// It roams the water and the shores, picks someone, stalks them, stands off and stares, and then either breaks and runs
// or comes for them. It waits under the water by the edge, circles swimmers in the dark, drags them down.
// Around it: the heartbeat, the chase theme, its eyes in the dark, lights going out, whispers, and a grudge.
import { world, system, BlockVolume, ItemStack, GameMode, EntityDamageCause } from '@minecraft/server';
import { config, preset, threat, freq } from './config.js';
import {
  CREATURE, STAGED, TPS, FORM, rand, randInt, chance, pick, now, sub, add, mul, flat, norm,
  block, isWater, inBiome, looksAt, inSight, sound, particle, waterSurface, floorAt, nearWater, findSpot,
  creatures, setMode, setAct, removeQuietly, spawnShade, overworld, health, sting, debug,
} from './main.js';

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

function mindOf(c) {
  let m = minds.get(c.id);
  if (!m) {
    m = { state: 'roam', since: now(), until: 0, roam: 'water', roamUntil: now() + randInt(20, 40) * TPS, last: c.location, lastMove: now(),
      seenFor: 0, unseenFor: 0, nextHop: 0, nextLunge: 0, nextEyes: 0, nextSnuff: now() + 20 * TPS, grasped: false, startDist: 0,
      standoff: 11, cooldownUntil: now() + randInt(5, 15) * TPS, chaseEnd: 0, best: 999, target: undefined, ambush: undefined };
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

function pickTarget(c, m) {
  let best, bd = 72;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== c.dimension.id || !watcher(p)) continue;
    const d = flat(p.location, c.location) - (p.id === m.target ? 8 : 0);        // it prefers whoever it was already after
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ------------------------------------------------------------------ the heartbeat: your own, louder and faster as it nears
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
  for (const s of [-0.13, 0.13]) particle(c.dimension, 'brine:eyes', add(add(h, mul(f, 0.38)), add(mul(r, s), { x: 0, y: -0.06, z: 0 })));
}
function shake(player, strength, seconds) {
  if (!config.screen) return;
  try { player.runCommand(`camerashake add @s ${strength} ${seconds} positional`); } catch (e) { /* ok */ }
}
function music(player, on) {
  if (!config.music) return;
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
    const list = player.dimension.getBlocks(vol, { includeTypes: [...Object.keys(LIGHTS_ITEM), ...LIGHTS_CANDLE, ...LIGHTS_FIRE] }, false);
    for (const loc of list.getBlockLocationIterator()) {
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
      player.dimension.spawnItem(new ItemStack(item, 1), at);        // nothing is taken: you'll find it on the floor
    }
  } catch (e) { return false; }
  particle(player.dimension, 'brine:smoke', at);
  sound(player.dimension, 'brine.fx.snuff', at, 0.8, rand(0.9, 1.1));
  debug('snuffed a light');
  return true;
}

// ------------------------------------------------------------------ states
function toRoam(c, m, cooldown = randInt(...preset().stalkGap) / freq()) {
  m.state = 'roam';
  m.cooldownUntil = now() + Math.round(cooldown * TPS * Math.max(0.5, 1 - 0.04 * (m.grudge ?? 0)));
  m.roam = c.isInWater ? 'water' : 'land';
  m.roamUntil = now() + randInt(20, 40) * TPS;
  setAct(c, 'none');
  mode(c, `roam_${m.roam}`);
}
/** wandering alternates: a while in the water, then a while on the shores, and back */
function flipRoam(c, m) {
  m.roam = m.roam === 'water' ? 'land' : 'water';
  m.roamUntil = now() + randInt(m.roam === 'water' ? 25 : 20, m.roam === 'water' ? 50 : 45) * TPS;
  mode(c, `roam_${m.roam}`);
}
function startStalk(c, m) {
  m.state = 'stalk';
  m.since = now();
  m.until = now() + randInt(35, 80) * TPS;
  m.standoff = rand(9, 15);
  m.seenFor = 0;
  setAct(c, 'none');
  mode(c, 'stalk');
  debug('stalking');
}
function startStandoff(c, m, target, d) {
  m.state = 'standoff';
  m.since = now();
  m.until = now() + randInt(4, 10) * TPS;
  m.startDist = d;
  if (c.isInWater) {
    const s = waterSurface(c.dimension, Math.floor(c.location.x), Math.floor(c.location.y) + 2, Math.floor(c.location.z), 4, 4);
    if (s) {
      m.hold = { x: s.x, y: s.y - 2.06, z: s.z };                // only its head shows above the water
      mode(c, 'hold');
      setAct(c, 'submerged_watch');
      try { c.teleport(m.hold, { facingLocation: target.getHeadLocation() }); } catch (e) { /* ok */ }
    }
  } else {
    m.hold = undefined;
    mode(c, 'observe');
    const act = chance(preset().revelation * 1.5) ? 'full_stand' : pick(['watch', 'head_tilt', 'hunting_stance', 'patient_strike', 'corner_watch']);
    setAct(c, act);
  }
  sound(c.dimension, 'mob.brinesleeper.click', c.getHeadLocation(), 0.9, rand(0.75, 0.95));
  if (looksAt(target, c.getHeadLocation(), 0.8)) sting(target, 0.7);
  debug('standing off');
}
function startFlee(c, m) {
  m.state = 'flee';
  m.since = now();
  m.until = now() + randInt(8, 14) * TPS;
  m.hold = undefined;
  setAct(c, 'none');
  mode(c, 'withdraw');
  sound(c.dimension, 'mob.brinesleeper.hiss', c.getHeadLocation(), 1, rand(0.9, 1.1));
  debug('fleeing');
}
function startChase(c, m, target) {
  m.state = 'chase';
  m.since = now();
  m.chaseEnd = now() + randInt(...threat().chaseSeconds) * TPS;
  m.grasped = false;
  m.nextLunge = now() + 30;
  m.best = 999;
  m.stuckFor = 0;
  m.hold = undefined;
  m.chased = target.id;
  setAct(c, 'none');
  mode(c, 'hunt');
  sound(c.dimension, 'mob.brinesleeper.roar', c.getHeadLocation(), 1.4, rand(0.9, 1));
  sting(target, 0.9);
  music(target, true);
  shake(target, 0.2, 0.5);
  debug('chasing');
}
function endChase(c, m) {
  const p = world.getAllPlayers().find((q) => q.id === m.chased);
  if (p) music(p, false);
  m.chased = undefined;
}
/** you came at it, or stared it down: it breaks and runs, or it comes for you */
function decide(c, m, target, provoked) {
  const grudge = grudgeOf(target);
  const p = preset().chase + (provoked ? 0.25 : 0) + 0.04 * grudge;
  if (hunter(target) && chance(p)) startChase(c, m, target);
  else startFlee(c, m);
}
/** closing the distance while you aren't looking: it is simply somewhere nearer when you next turn around */
function hopCloser(c, m, target, d) {
  const s = findSpot(target, 'floor', Math.max(12, d - 10), Math.max(14, d - 5), { room: 4, eyeHeight: 2.8, tries: 14 })
    ?? findSpot(target, 'water', Math.max(12, d - 10), Math.max(14, d - 5), { depth: 3, eyeHeight: 0.4, tries: 10 });
  if (!s) return;
  const seenByAnyone = world.getAllPlayers().some((p) => inSight(p, c.getHeadLocation(), 64));
  if (seenByAnyone) return;
  const pos = isWater(block(c.dimension, { x: s.x, y: s.y - 1, z: s.z })) ? { x: s.x, y: s.y - 2.5, z: s.z } : s;
  try { c.teleport(pos, { facingLocation: target.getHeadLocation() }); } catch (e) { /* ok */ }
  m.last = c.location;
  m.lastMove = now();
}
/** unstick: it never gets trapped in the water or wedged in rock for long */
function unstick(c, m, target) {
  const t = now();
  if (t - m.lastMove < 5 * TPS || m.hold) return;
  if (t - m.lastMove < 10 * TPS) {
    const dir = target ? norm(sub(target.location, c.location)) : { x: rand(-1, 1), y: 0, z: rand(-1, 1) };
    try { c.applyImpulse({ x: dir.x * 0.35, y: c.isInWater ? 0.5 : 0.35, z: dir.z * 0.35 }); } catch (e) { /* ok */ }
    if (m.state === 'roam' && c.isInWater && m.roam === 'water') { m.roam = 'land'; mode(c, 'roam_land'); }
    return;
  }
  if (world.getAllPlayers().some((p) => inSight(p, c.getHeadLocation(), 64))) return;
  for (let i = 0; i < 12; i++) {                              // out of sight: it is simply somewhere it can move again
    const a = Math.random() * Math.PI * 2, r = rand(3, 8);
    const x = Math.floor(c.location.x + Math.cos(a) * r), z = Math.floor(c.location.z + Math.sin(a) * r);
    const f = floorAt(c.dimension, x, Math.floor(c.location.y), z, 4, 4, 4);
    if (f) { try { c.teleport(f); } catch (e) { /* ok */ } break; }
  }
  m.last = c.location;
  m.lastMove = t;
}

// the burst from the water: it waits under the surface by the edge, bubbles give it away, then it comes out at you
function startAmbush(c, m, target) {
  const s = findSpot(target, 'water', 2, 5, { depth: 2, allowView: true, eyeHeight: 0, tries: 16 });
  if (!s || world.getAllPlayers().some((p) => inSight(p, c.getHeadLocation(), 64))) return false;
  m.state = 'ambush';
  m.since = now();
  m.until = now() + randInt(3, 9) * TPS;
  m.ambush = s;
  m.hold = { x: s.x, y: s.y - 3.4, z: s.z };
  mode(c, 'hold');
  setAct(c, 'swim');
  try { c.teleport(m.hold, { facingLocation: target.location }); } catch (e) { return false; }
  debug('ambush set');
  return true;
}
function burst(c, m, target) {
  const s = m.ambush;
  m.hold = { x: s.x, y: s.y - 0.375, z: s.z };
  try { c.teleport(m.hold, { facingLocation: target.getHeadLocation() }); } catch (e) { return; }
  setAct(c, 'emerge_roar');
  sound(c.dimension, 'brine.fx.burst', s, 1.3, 0.9);
  sound(c.dimension, 'mob.brinesleeper.roar', s, 1.4, 1);
  particle(c.dimension, 'brine:splash', s);
  particle(c.dimension, 'brine:splash', add(s, { x: 0.5, y: 0, z: -0.4 }));
  sting(target, 1);
  shake(target, 0.35, 0.6);
  // it reaches for you: a pull toward the water
  const k = norm(sub(s, target.location));
  try { target.applyKnockback({ x: k.x * 0.55, z: k.z * 0.55 }, 0.12); } catch (e) { /* ok */ }
  m.state = 'burst';
  m.until = now() + 16;
}

// the drag: it has you, in the water, pulling down
function grasp(c, m, target) {
  m.grasped = true;
  m.graspUntil = now() + 50;
  m.graspBroken = false;
  m.graspHurt = false;
  try { c.playAnimation('animation.brinesleeper.grasp'); } catch (e) { /* ok */ }
  sound(c.dimension, 'mob.brinesleeper.grasp', target.location, 1.1, 1);
  if (config.screen) { try { target.camera.fade({ fadeTime: { fadeInTime: 0.1, holdTime: 0.25, fadeOutTime: 0.5 }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch (e) { /* ok */ } }
  graspers.set(target.id, m);
}
const graspers = new Map();
function graspTick(c, m, target) {
  const t = now();
  if (t >= m.graspUntil || m.graspBroken || !target.isValid) { graspers.delete(target.id); return false; }
  const k = norm(sub(c.location, target.location));
  try { target.applyKnockback({ x: k.x * 0.1, z: k.z * 0.1 }, -0.32); } catch (e) { /* ok */ }
  target.addEffect('slowness', 20, { amplifier: 3, showParticles: false });
  particle(target.dimension, 'brine:bubbles', target.location);
  if (!m.graspHurt && t > m.graspUntil - 30) {
    m.graspHurt = true;
    target.applyDamage(Math.round(threat().grasp * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
  }
  if (target.isJumping && chance(0.2)) m.graspBroken = true;                       // kick for the surface
  return true;
}

// ------------------------------------------------------------------ one creature, one think
function think(c) {
  const m = mindOf(c);
  const t = now();
  if (flat(c.location, m.last) > 0.7 || Math.abs(c.location.y - m.last.y) > 0.7) { m.last = c.location; m.lastMove = t; }
  const target = pickTarget(c, m);
  if (!config.enabled || !target) {
    if (m.state !== 'roam') { if (m.state === 'chase') endChase(c, m); toRoam(c, m, 5); }
    if (t >= m.roamUntil) flipRoam(c, m);
    unstick(c, m);
    return;
  }
  m.target = target.id;
  m.grudge = grudgeOf(target);
  const d = flat(target.location, c.location);
  const head = c.getHeadLocation();
  const seen = looksAt(target, head, 0.86, 80);
  m.seenFor = seen ? m.seenFor + 5 : 0;
  m.unseenFor = seen ? 0 : m.unseenFor + 5;
  feel(target, d, m.state === 'chase' || m.state === 'burst');
  if (m.hold) { try { c.teleport(m.hold); } catch (e) { /* ok */ } }

  switch (m.state) {
    case 'roam': {
      if (t >= m.roamUntil) flipRoam(c, m);
      if (t >= m.cooldownUntil && d < 56 && preset().damage >= 0) startStalk(c, m);
      unstick(c, m, target);
      break;
    }
    case 'stalk': {
      if (d > 72) { toRoam(c, m, 10); break; }
      if (c.isInWater && d < 16 && !target.isInWater && nearWater(target.dimension, target.location, 3) && chance(0.06) && startAmbush(c, m, target)) break;
      if (c.isInWater && target.isInWater && d < 30 && hunter(target) && chance(0.05)) { startChase(c, m, target); break; }
      if (d < m.standoff || m.seenFor >= 20) { startStandoff(c, m, target, d); break; }
      if (!seen && m.unseenFor > 40 && d > 24 && t >= m.nextHop) { hopCloser(c, m, target, d); m.nextHop = t + randInt(6, 12) * TPS; }
      if (!seen && d < 8 && chance(0.05)) sound(c.dimension, 'mob.brinesleeper.breathe', head, 1.1, rand(0.8, 0.95));
      if (!seen && d < 20 && config.lights && t >= m.nextSnuff && chance(0.1)) {
        if (snuffLight(target)) m.nextSnuff = t + randInt(25, 50) * TPS;
      }
      eyes(c, m, d);
      if (t >= m.until) decide(c, m, target, false);
      unstick(c, m, target);
      break;
    }
    case 'standoff': {
      eyes(c, m, d);
      if (d < 6 || d < m.startDist - 4) { m.hold = undefined; decide(c, m, target, true); break; }
      if (m.seenFor > randInt(70, 110)) { m.hold = undefined; decide(c, m, target, false); break; }
      if (m.unseenFor > 50 || t >= m.until) { m.hold = undefined; m.standoff = Math.max(6, m.standoff - 3); startStalk(c, m); break; }
      if (chance(0.025)) sound(c.dimension, 'mob.brinesleeper.click', head, 0.8, rand(0.7, 0.9));
      break;
    }
    case 'ambush': {
      if (t % 10 === 0) particle(c.dimension, 'brine:bubbles', m.ambush);
      if (d > 10) { if (t >= m.until) { m.hold = undefined; toRoam(c, m); } break; }
      if (t >= m.until || (looksAt(target, m.ambush, 0.93) && chance(0.25))) burst(c, m, target);
      break;
    }
    case 'burst': {
      if (t >= m.until) { m.hold = undefined; if (hunter(target)) startChase(c, m, target); else startFlee(c, m); }
      break;
    }
    case 'chase': {
      if (graspers.has(target.id) && graspers.get(target.id) === m) { graspTick(c, m, target); break; }
      if (!hunter(target) || d > 48 || t >= m.chaseEnd) { endChase(c, m); startFlee(c, m); break; }
      m.stuckFor = d < m.best - 0.5 ? 0 : (m.stuckFor ?? 0) + 5;
      m.best = Math.min(m.best, d);
      if (m.stuckFor > 6 * TPS && !inSight(target, head)) { endChase(c, m); startFlee(c, m); break; }
      if (d > 2.4 && d < 6 && t >= m.nextLunge && inSight(target, head, 8)) {
        m.nextLunge = t + randInt(60, 110);
        try { c.playAnimation('animation.brinesleeper.lunge', { blendOutTime: 0.2 }); } catch (e) { /* ok */ }
        sound(c.dimension, 'mob.brinesleeper.lunge', c.location, 1.1, rand(0.95, 1.1));
        system.runTimeout(() => {
          if (!c.isValid || !target.isValid || flat(target.location, c.location) > 3.8 || preset().damage <= 0) return;
          target.applyDamage(Math.round(threat().lunge * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
          const k = norm(sub(target.location, c.location));
          try { target.applyKnockback({ x: k.x * 0.7, z: k.z * 0.7 }, 0.28); } catch (e) { /* ok */ }
          shake(target, 0.25, 0.3);
        }, 7);
      }
      if (!m.grasped && config.grasp && preset().damage > 0 && target.isInWater && d < 2.8 && health(target) > 6) grasp(c, m, target);
      unstick(c, m, target);
      break;
    }
    case 'flee': {
      if (t >= m.until || (!inSight(target, head) && d > 20)) {
        if (c.isInWater) {
          sound(c.dimension, 'mob.brinesleeper.submerge', c.location, 0.8, 1);
          particle(c.dimension, 'brine:bubbles', c.location);
        }
        toRoam(c, m);
      }
      unstick(c, m, target);
      break;
    }
    default: toRoam(c, m);
  }
}

// ------------------------------------------------------------------ the deep: something under the swimmer
const deep = new Map();
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
    const p = add(from, mul(sub(to, from), i / 56));
    try { s.teleport(p, { facingLocation: to }); } catch (e) { return; }
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
    const st = deep.get(p.id) ?? { swim: 0, next: t + randInt(...preset().deep) * TPS };
    deep.set(p.id, st);
    if (!config.enabled || !watcher(p) || !p.isInWater) { st.swim = 0; continue; }
    st.swim += 5;
    if (st.swim < 3 * TPS || t < st.next) continue;
    const near = creatures().find((c) => !c.hasTag(STAGED) && flat(c.location, p.location) < 40);
    if (!near && !inBiome(p.dimension, p.location)) continue;
    if (depthBelow(p) < 3) continue;
    st.next = t + Math.round((randInt(...preset().deep) * TPS) / freq());
    // it is not always the shape: sometimes it is really there, and it has seen you swimming
    if (near && hunter(p) && chance(0.35)) {
      const m = mindOf(near);
      if (m.state !== 'chase') startChase(near, m, p);
      continue;
    }
    const gen = chance(0.65) ? shapeBeneath(p) : brush(p);
    deepRuns.set(p.id, { gen, wake: t });
    if (chance(0.3)) whisper(p, pick(['...something is under you...', '...keep swimming...', "...don't look down..."]));
  }
}

// ------------------------------------------------------------------ whispers and the grudge
const nextWhisper = new Map();
function murmurs() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    if (!config.whispers || !config.enabled) continue;
    if (t < (nextWhisper.get(p.id) ?? t + 1)) { if (!nextWhisper.has(p.id)) nextWhisper.set(p.id, t + randInt(90, 200) * TPS); continue; }
    nextWhisper.set(p.id, t + Math.round((randInt(120, 300) * TPS) / freq()));
    if (inBiome(p.dimension, p.location) && nearWater(p.dimension, p.location, 5)) whisper(p);
  }
}
const returns = [];
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  const a = damageSource.damagingEntity;
  if (hurtEntity.typeId === CREATURE && a && a.typeId === 'minecraft:player') {
    addGrudge(/** @type {import('@minecraft/server').Player} */ (a), 1);
    const m = minds.get(hurtEntity.id);
    if (m && graspers.get(a.id) === m) m.graspBroken = true;                       // hit it and it lets go
    if (m && (m.state === 'standoff' || m.state === 'stalk' || m.state === 'roam')) {
      m.hold = undefined;
      decide(hurtEntity, m, /** @type {import('@minecraft/server').Player} */ (a), true);
    }
  }
});
world.afterEvents.entityDie.subscribe(({ deadEntity, damageSource }) => {
  if (deadEntity.typeId !== CREATURE) return;
  const m = minds.get(deadEntity.id);
  if (m && m.chased) {
    const p = world.getAllPlayers().find((q) => q.id === m.chased);
    if (p) music(p, false);
  }
  minds.delete(deadEntity.id);
  const killer = damageSource.damagingEntity;
  if (killer && killer.typeId === 'minecraft:player' && config.enabled) {
    addGrudge(/** @type {import('@minecraft/server').Player} */ (killer), 3);
    // it was never the only one
    returns.push({ id: killer.id, at: now() + Math.round(randInt(180, 360) * TPS / freq()) });
  }
});
function comebacks() {
  const t = now();
  for (let i = returns.length - 1; i >= 0; i--) {
    const r = returns[i];
    if (t < r.at) continue;
    const p = world.getAllPlayers().find((q) => q.id === r.id);
    if (!p) { returns.splice(i, 1); continue; }
    if (creatures().length || !inBiome(p.dimension, p.location)) { r.at = t + 30 * TPS; continue; }
    returns.splice(i, 1);
    const s = findSpot(p, 'water', 24, 40, { depth: 3, eyeHeight: 0.4 });
    if (!s) { returns.push({ id: r.id, at: t + 60 * TPS }); continue; }
    try {
      const c = overworld().spawnEntity(CREATURE, { x: s.x, y: s.y - 2.5, z: s.z });
      c.triggerEvent(`brine:threat_${config.threat}`);
      const m = mindOf(c);
      m.cooldownUntil = now();
      whisper(p, "...you didn't think that was the only one...");
      debug('it came back');
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
world.afterEvents.worldLoad.subscribe(() => {
  system.runInterval(brainTick, 5);
  system.runInterval(stepDeep, 1);
  system.runInterval(() => { murmurs(); comebacks(); }, 40);
});
