// The Brinesleeper's mind. There is only ever one; this is what it does, wherever it is.
//
// The cycle (each phase has its own body language, from the model's animations):
//   watch    far off, it lets itself be seen: head above the water (submerged watch), half out of it (idle in water),
//            lying at the edge staring into the water (reflection lurk), on a ledge above you (ledge watch), around a
//            pillar (corner watch / behind cover), in the vines (veil stalk), clinging to the ceiling (ceiling lurk),
//            in the dark (shadow hide), standing in the open (distant observer, head tilt, full stand).
//            Look at it long enough, or come close, and it is gone.
//   stalk    it follows you: crouched (crouch stalk), along the water's edge (shoreline stalk), on all fours through
//            low tunnels (tunnel crawl), or, when it has stopped being afraid, upright and slow (slow approach).
//   standoff it stands and stares (hunting stance, head tilt, patient strike, full stand), and it may simply walk at you.
//   chase    it runs (run), leaps, lunges (lunge), and in the water it grabs and drags you down (grasp).
//   retreat  it turns away (retreat), runs for the water and goes under (submerge), and is gone.
//   in the water: it lurks deep (swim), crosses to your bank (wake), climbs out (emerge), bursts out at the edge
//            (emerge roar), or comes for you if you are swimming.
//
// It learns each player (saved on the player): how often you look behind you, whether you carry light, whether you
// run, swim or fight, and where you sleep. It grows bolder with every meeting: it lets itself be seen longer and closer,
// it stops running from you, it leaves the water to follow you, and at last it comes to your home.
import { world, system, BlockVolume, ItemStack, GameMode, EntityDamageCause } from '@minecraft/server';
import { config, preset, threat, freq } from './config.js';
import {
  CREATURE, STAGED, TPS, FORM, rand, randInt, chance, pick, now, sub, add, mul, flat, norm, len,
  block, isWater, isSolid, isOpen, looksAt, inSight, sound, particle, waterSurface, floorAt, nearWater, findSpot,
  creatures, setMode, setAct, removeQuietly, spawnShade, overworld, health, debug, wetTrail,
} from './main.js';
import { inStillwater, press } from './areas.js';
import { addEntry } from './notebook.js';

const S = 1.15;                                                     // the model's scale (horror.py SCALE)
const DEPTH = { submerged_watch: 2.06 * S, idle_water: 2.06 * S, water_rise: 0.5 * S, emerge_roar: 0.375 * S, emerge: 0.25 * S };
const CEILING_DROP = 4.6;                                           // ceiling_lurk hangs its body this far above its root
const LURK_DEPTH = 3.8;
const minds = new Map();
const LIGHTS_CANDLE = ['minecraft:candle', ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray',
  'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => `minecraft:${c}_candle`)];
const LIGHTS_ITEM = { 'minecraft:torch': 'minecraft:torch', 'minecraft:soul_torch': 'minecraft:soul_torch',
  'minecraft:lantern': 'minecraft:lantern', 'minecraft:soul_lantern': 'minecraft:soul_lantern' };
const LIGHTS_FIRE = ['minecraft:campfire', 'minecraft:soul_campfire'];
const WHISPERS = ['...the water remembers you...', "...don't look down...", '...you are so close to the edge...', "...it's warmer under the water...",
  '...we heard you splash...', '...stay a while...', '...it saw you first...', '...something is under you...', '...keep swimming...'];

const hunter = (p) => { try { const m = p.getGameMode(); return m === GameMode.Survival || m === GameMode.Adventure; } catch (e) { return false; } };
const watcher = (p) => { try { return p.getGameMode() !== GameMode.Spectator; } catch (e) { return false; } };
// someone has it on screen (roughly the field of view, nothing in the way): it never moves itself then. Anyone not
// looking straight at it can turn around a moment later and find it gone, or somewhere else
const seenByAnyone = (c) => world.getAllPlayers().some((p) => p.dimension.id === c.dimension.id &&
  (looksAt(p, c.getHeadLocation(), 0.5, 96) || looksAt(p, add(c.location, { x: 0, y: 0.5, z: 0 }), 0.5, 96)));
const playerById = (id) => world.getAllPlayers().find((p) => p.id === id);
const gap = () => Math.round(randInt(...preset().stalkGap) * TPS / freq());
const dark = (dim, pos) => { try { return dim.getLightLevel(pos) <= 4; } catch (e) { return false; } };
const spot = (player, kind, minD, maxD, opts = {}) => findSpot(player, kind, minD, maxD, { anywhere: true, ...opts });
/** a point `d` below a water surface, never deeper than the water is (so it is never put inside the lake bed) */
const under = (s, d) => ({ x: s.x, y: s.y - Math.min(d, Math.max(0.6, s.depth - 0.25)), z: s.z });
const roomy = (b) => isOpen(b) || isWater(b);
/** under the ground or out at night: where it is willing to go after you */
function itsHour(p) {
  try {
    if (p.dimension.getSkyLightLevel(p.getHeadLocation()) <= 6) return true;
  } catch (e) { /* unloaded */ }
  const tod = world.getTimeOfDay();
  return tod > 13000 && tod < 23000;
}

// ------------------------------------------------------------------ what it has learned about each player
const PROFILE = { bold: 0.1, looks: 0, lights: 0, runs: 0, swims: 0, fights: 0, kills: 0, meets: 0, followed: 0 };
const profiles = new Map();
function profileOf(p) {
  let pr = profiles.get(p.id);
  if (!pr) {
    try { pr = { ...PROFILE, ...JSON.parse(String(p.getDynamicProperty('brine:profile') ?? '{}')) }; } catch (e) { pr = { ...PROFILE }; }
    profiles.set(p.id, pr);
  }
  return pr;
}
function learn(p, key, amount, notebookAt) {
  const pr = profileOf(p);
  pr[key] = (pr[key] ?? 0) + amount;
  if (notebookAt !== undefined && pr[key] >= notebookAt) addEntry(p, key);
}
function bolder(p, amount) {
  const pr = profileOf(p);
  pr.bold = Math.max(0, Math.min(1, pr.bold + amount));
  if (pr.bold > 0.6) addEntry(p, 'bold');
}
function saveProfiles() {
  for (const p of world.getAllPlayers()) {
    const pr = profiles.get(p.id);
    if (pr) { try { p.setDynamicProperty('brine:profile', JSON.stringify(pr)); } catch (e) { /* ok */ } }
  }
}
// watching how you play: quick turns to look behind you, light you carry, time in water, running away
const habits = new Map();
const turn = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function watchHabits(p, c) {
  const yaw = p.getRotation().y;
  const h = habits.get(p.id) ?? { yaw, yaw2: yaw, counted: -999 };
  const turned = Math.max(turn(yaw, h.yaw), turn(yaw, h.yaw2));
  if (turned > 120 && now() - h.counted > 40 && c && flat(c.location, p.location) < 48) { h.counted = now(); learn(p, 'looks', 1, 6); }
  if (p.isInWater && c && flat(c.location, p.location) < 64) learn(p, 'swims', 0.02, 4);
  habits.set(p.id, { yaw, yaw2: h.yaw, counted: h.counted });
}
world.afterEvents.playerPlaceBlock.subscribe(({ player, block: b }) => {
  if (LIGHTS_ITEM[b.typeId] || LIGHTS_CANDLE.includes(b.typeId) || LIGHTS_FIRE.includes(b.typeId)) {
    if (inStillwater(player.dimension, player.location) || creatures().some((c) => flat(c.location, player.location) < 64)) learn(player, 'lights', 1, 8);
  }
});
const busy = new Map();                                             // you are mining: you are not looking
world.afterEvents.playerBreakBlock.subscribe(({ player }) => busy.set(player.id, now()));

// ------------------------------------------------------------------ minds
function mindOf(c) {
  let m = minds.get(c.id);
  if (!m) {
    m = { state: 'idle', since: now(), until: 0, last: c.location, lastMove: now(), seenFor: 0, unseenFor: 0, sightings: 0,
      cooldownUntil: now() + randInt(4, 10) * TPS, nextEyes: 0, nextSnuff: now() + 20 * TPS, nextLunge: 0, act: '', crawl: undefined, crawlSince: 0, frozen: false, riseUntil: 0,
      swim: null, climb: null, hold: null, chaseEnd: 0, best: 999, stuckFor: 0, target: undefined, chased: undefined, spotted: false,
      withdrawn: false, walking: false };
    minds.set(c.id, m);
    setMode(c, 'roam_water');
  }
  return m;
}
function act(c, m, name) { if (m.act !== name) { m.act = name; setAct(c, name); } }
function applySpeed(c, target) {
  const bonus = target ? 1 + 0.04 * Math.min(6, profileOf(target).runs) : 1;
  system.runTimeout(() => {
    try {
      for (const id of ['minecraft:movement', 'minecraft:underwater_movement']) {
        const mv = c.getComponent(id);
        if (mv) mv.setCurrentValue(mv.defaultValue * threat().speed * bonus);
      }
    } catch (e) { /* gone */ }
  }, 2);
}
function mode(c, name, target) { setMode(c, name); applySpeed(c, target); }
function go(m, state, seconds) {
  m.state = state;
  m.since = now();
  m.until = now() + Math.round((seconds ?? 10) * TPS);
  m.seenFor = 0;
  debug(`brinesleeper: ${state}`);
}
/** the sound you hear the moment it has you in its eyes */
function spotted(c, m, target) {
  if (m.spotted) return;
  m.spotted = true;
  try { target.playSound('brine.spotted', { volume: 1 }); } catch (e) { /* gone */ }
  sound(c.dimension, 'mob.brinesleeper.click', c.getHeadLocation(), 1, rand(0.75, 0.9));
}

// ------------------------------------------------------------------ places
const surfaceNear = (dim, pos, up = 6, down = 10) => waterSurface(dim, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), up, down);
const waterAround = (player, minD, maxD, opts = {}) => spot(player, 'water', minD, maxD, { depth: opts.depth ?? 3, eyeHeight: 0.4,
  tries: opts.tries ?? 24, allowView: opts.allowView, sight: opts.sight });
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
/** dry ground at the edge of the water it is in, as close to you as it can get */
function shoreNear(c, toward) {
  const dim = c.dimension;
  const l = c.location;
  let best;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = rand(2, 10);
    const f = floorAt(dim, Math.floor(l.x + Math.cos(a) * r), Math.floor(l.y), Math.floor(l.z + Math.sin(a) * r), 5, 9, 3);
    if (!f || !nearWater(dim, f, 2)) continue;
    const score = flat(f, toward) + flat(f, l) * 0.5;
    if (!best || score < best.score) best = { bank: f, score };
  }
  return best?.bank;
}
/** a place to watch you from, and the way it should hold itself there */
function watchPlace(c, target, minD, maxD) {
  const dim = target.dimension;
  const water = waterAround(target, minD, maxD, { depth: 3, sight: true, tries: 18 });
  if (water && chance(0.45)) return ['water', water];               // it is a thing of the water: half the time, there
  /** @type {[string, any, number][]} */
  const options = [];
  for (let i = 0; i < 12 && options.length < 24; i++) {
    const f = spot(target, 'floor', minD, maxD, { room: 5, sight: true, eyeHeight: 3.2, tries: 1 });
    if (!f) continue;
    let ceil = 0;
    while (ceil < 12 && isOpen(block(dim, { x: f.x, y: f.y + ceil, z: f.z }))) ceil++;
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const wallBeside = side.some(([dx, dz]) => isSolid(block(dim, { x: f.x + dx, y: f.y + 1, z: f.z + dz })));
    const vines = side.some(([dx, dz]) => block(dim, { x: f.x + dx, y: f.y + 2, z: f.z + dz })?.typeId === 'minecraft:weeping_vines');
    // every way it could hold itself here, weighted: the more this place suits a pose, the likelier it is
    if (ceil >= 5 && ceil <= 9) options.push(['ceiling', { x: f.x, y: f.y + ceil - CEILING_DROP, z: f.z }, 3]);
    if (f.y - target.location.y >= 3) options.push(['ledge_watch', f, 4]);
    if (vines) options.push(['veil_stalk', f, 4]);
    if (nearWater(dim, f, 1)) options.push(['reflection_lurk', f, 3]);
    if (wallBeside) { options.push(['corner_watch', f, 2]); options.push(['behind_cover', f, 2]); }
    if (dark(dim, add(f, { x: 0, y: 1, z: 0 }))) options.push(['shadow_hide', f, 1]);
    for (const k of ['distant_observer', 'head_tilt', 'patient_strike', 'watch', 'full_stand']) options.push([k, f, 0.6]);
  }
  if (!options.length) return water ? ['water', water] : undefined;
  let r = Math.random() * options.reduce((a, o) => a + o[2], 0);
  for (const o of options) { r -= o[2]; if (r <= 0) return [o[0], o[1]]; }
  return [options[0][0], options[0][1]];
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
    const dir = norm(to);
    let next = add(pos, mul(dir, Math.min(sw.speed * threat().speed, dist)));
    const wet = (q) => isWater(block(c.dimension, add(q, { x: 0, y: 0.6, z: 0 })));
    if (!wet(next)) {
      const up = add(next, { x: 0, y: 0.7, z: 0 }), down = add(next, { x: 0, y: -0.7, z: 0 });
      if (wet(up)) next = up; else if (wet(down)) next = down;
      else if (++sw.blocked > 8) { m.swim = null; sw.fail?.(); return; }
      else return;
    }
    try { c.teleport(next, { facingLocation: add(next, { x: dir.x, y: 0, z: dir.z }) }); } catch (e) { m.swim = null; return; }
    if (sw.wake && now() % 6 === 0) { const s = surfaceNear(c.dimension, next, 6, 1); if (s) particle(c.dimension, 'brine:ripple', s); }
    return;
  }
  if (m.hold) { try { c.teleport(m.hold); } catch (e) { /* gone */ } }
}
function swimTo(c, m, goal, speed, then, fail, wake = false) {
  m.hold = null;
  m.climb = null;
  m.swim = { goal, speed, then, fail, wake, blocked: 0 };
  mode(c, 'hold');
  act(c, m, 'swim');
}
function climbOut(c, m, bank, face, then) {
  const from = c.location;
  const lip = { x: (from.x + bank.x) / 2, y: bank.y + 0.4, z: (from.z + bank.z) / 2 };
  const path = [];
  for (let i = 1; i <= 10; i++) path.push({ x: from.x + (lip.x - from.x) * i / 20, y: from.y + (lip.y - from.y) * i / 10, z: from.z + (lip.z - from.z) * i / 20 });
  for (let i = 1; i <= 8; i++) path.push({ x: path[9].x + (bank.x - path[9].x) * i / 8, y: lip.y + (bank.y - lip.y) * i / 8, z: path[9].z + (bank.z - path[9].z) * i / 8 });
  m.swim = null;
  m.hold = null;
  m.climb = { path, i: 0, face, then };
  mode(c, 'hold');
  act(c, m, 'emerge');
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
  if (now() < m.nextEyes || d < 5 || !dark(c.dimension, c.getHeadLocation())) return;
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
function whisper(player, line) {
  if (!config.whispers) return;
  try { player.onScreenDisplay.setActionBar(`§8§o${line ?? pick(WHISPERS)}`); } catch (e) { /* gone */ }
}
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
      player.dimension.spawnItem(new ItemStack(item, 1), at);
    }
  } catch (e) { return false; }
  particle(player.dimension, 'brine:smoke', at);
  sound(player.dimension, 'brine.fx.snuff', at, 0.8, rand(0.9, 1.1));
  return true;
}

// ------------------------------------------------------------------ vanishing
function vanish(c, m, target) {
  const pos = c.location;
  m.swim = null; m.climb = null; m.hold = null;
  if (c.isInWater || isWater(block(c.dimension, { x: pos.x, y: pos.y + 0.5, z: pos.z }))) {
    act(c, m, 'submerge');
    const s = surfaceNear(c.dimension, pos, 6, 2);
    if (s) particle(c.dimension, 'brine:ripple', s);
    sound(c.dimension, 'mob.brinesleeper.submerge', pos, 0.5, rand(0.8, 0.95));
  } else {
    particle(c.dimension, 'brine:smoke', add(pos, { x: 0, y: 1.5, z: 0 }));
    particle(c.dimension, 'brine:smoke', add(pos, { x: 0, y: 3, z: 0 }));
    particle(c.dimension, 'brine:drips', add(pos, { x: 0, y: 0.5, z: 0 }));
    sound(c.dimension, 'mob.brinesleeper.hiss', pos, 0.45, rand(0.8, 0.9));
  }
  const w = target ? waterAround(target, 28, 46, { depth: 4 }) : undefined;
  const f = !w && target ? spot(target, 'floor', 30, 46, { room: 5, eyeHeight: 3.2, tries: 20 }) : undefined;
  const to = w ? under(w, LURK_DEPTH) : f;
  m.sightings++;
  m.spotted = false;
  if (to && !c.isInWater) wetTrail(c.dimension, pos, add(pos, mul(norm({ x: to.x - pos.x, y: 0, z: to.z - pos.z }), 9)));   // wet tracks, going away
  system.runTimeout(() => {
    if (!c.isValid) return;
    if (to) { try { c.teleport(to); } catch (e) { /* ok */ } }
    m.last = c.location;
    m.lastMove = now();
    if (!target || !target.isValid) { go(m, 'idle', 1); return; }
    if (w) lurk(c, m, target);
    else if (now() < m.cooldownUntil) { mode(c, 'observe', target); act(c, m, 'none'); go(m, 'hidden', rand(5, 10)); }
    else stalk(c, m, target);
  }, c.isInWater ? 8 : 1);
  go(m, 'vanishing', 2);
}

// ------------------------------------------------------------------ states
/** sink out of sight into deep water near you; if it is not in the water, it gets there while nobody is looking */
function sink(c, m, s) {
  m.swim = null; m.climb = null;
  m.hold = under(s, LURK_DEPTH);
  try { c.teleport(m.hold); } catch (e) { return false; }
  mode(c, 'hold');
  act(c, m, 'swim');
  return true;
}
function lurk(c, m, target, seconds) {
  go(m, 'lurk', seconds ?? rand(6, 14) / freq());
  if (!target) return;
  const s = waterAround(target, 18, 34, { depth: 4, tries: 16 });
  if (!s) { if (!c.isInWater) stalk(c, m, target); else { m.swim = null; m.hold = null; mode(c, 'hold'); act(c, m, 'swim'); } return; }
  if (c.isInWater && flat(s, c.location) < 72) {
    act(c, m, 'swim');
    // another lake, not joined to this one: it is simply there, the next time nobody is looking
    swimTo(c, m, under(s, LURK_DEPTH), 0.2, undefined, () => { if (!seenByAnyone(c)) sink(c, m, s); });
  } else if (!seenByAnyone(c)) sink(c, m, s);
  else stalk(c, m, target);
}
/** far off, it lets itself be seen, and is gone when you look */
function watch(c, m, target) {
  const pr = profileOf(target);
  const near = 30 - pr.bold * 14, far = 44 - pr.bold * 16;
  const place = watchPlace(c, target, near, far);
  if (!place || seenByAnyone(c)) {                                  // nowhere to be seen from (or someone is looking): wait
    if (c.isInWater) lurk(c, m, target, rand(4, 8));
    else if (now() >= m.cooldownUntil) stalk(c, m, target);
    else { m.swim = null; m.hold = null; m.climb = null; mode(c, 'observe', target); go(m, 'hidden', rand(4, 8)); }
    return;
  }
  const [kind, at] = place;
  m.swim = null; m.climb = null;
  let pos = at;
  if (kind === 'water') {
    const a = chance(0.4) ? 'idle_water' : 'submerged_watch';
    pos = under(at, DEPTH[a]);
    m.hold = pos;
    mode(c, 'hold');
    act(c, m, a);
    sound(c.dimension, 'brine.fx.drip', at, 0.6, rand(0.8, 1));
  } else if (kind === 'ceiling') {
    m.hold = at;                                                    // the root floats; the body hangs from the ceiling above it
    mode(c, 'hold');
    act(c, m, 'ceiling_lurk');
  } else {
    m.hold = null;
    mode(c, 'observe', target);
    act(c, m, kind === 'shadow_hide' && chance(0.3) ? 'full_stand' : kind);
  }
  try { c.teleport(pos, { facingLocation: target.getHeadLocation() }); } catch (e) { /* ok */ }
  go(m, 'watch', rand(10, 20));
  m.watchNeed = Math.round(8 + pr.bold * 40 + rand(0, 12));         // the bolder it is, the longer it lets you look
  m.spotted = false;
  m.kind = kind;
}
function approach(c, m, target, fallback = true) {
  const b = bankNear(c, target);
  if (!b) { if (fallback) stalk(c, m, target); return false; }
  const pr = profileOf(target);
  // it learns: if you fight, or keep looking behind you, it stops walking up to you and comes out of the water instead
  const sly = 0.35 + 0.05 * Math.min(6, pr.fights) + (pr.looks >= 6 ? 0.25 : 0);
  if (!target.isInWater && b.water.depth >= 3 && flat(b.water, target.location) < 6 && chance(sly)) { ambush(c, m, target, b.water); return true; }
  go(m, 'approach', 30);
  const at = under(b.water, DEPTH.submerged_watch + 0.4);
  // it rises out of the water in front of you, slowly, and looks at you; then it hauls itself out
  const rise = () => {
    m.hold = under(b.water, DEPTH.water_rise);
    try { c.teleport(m.hold, { facingLocation: target.getHeadLocation() }); } catch (e) { /* ok */ }
    act(c, m, 'water_rise');
    sound(c.dimension, 'mob.brinesleeper.emerge', b.water, 0.9, rand(0.75, 0.85));
    particle(c.dimension, 'brine:splash', b.water);
    spotted(c, m, target);
    m.riseUntil = now() + randInt(25, 45);
  };
  const haul = () => climbOut(c, m, b.bank, target.getHeadLocation(), () => standoff(c, m, target));
  m.haul = haul;
  if (!c.isInWater) {
    if (seenByAnyone(c)) { stalk(c, m, target); return; }
    try { c.teleport(at); } catch (e) { /* ok */ }
    rise();
    return true;
  }
  swimTo(c, m, at, 0.32, chance(0.6) ? rise : haul, () => vanish(c, m, target), true);
  return true;
}
/** in the water, and you are on land: cross to your bank, or climb out at the nearest shore and keep coming */
function leaveWater(c, m, target, then) {
  if (now() < (m.nextShore ?? 0)) return false;
  m.nextShore = now() + 40;
  const s = shoreNear(c, target.location);
  if (!s) return false;
  climbOut(c, m, s, target.getHeadLocation(), then);
  return true;
}
function stalk(c, m, target) {
  m.swim = null; m.hold = null; m.climb = null;
  go(m, 'stalk', rand(25, 50));
  m.standoffAt = rand(8, 13) - (target ? profileOf(target).bold * 4 : 0);
  m.frozen = false;
  mode(c, 'stalk', target);
  m.act = '';
}
function standoff(c, m, target) {
  m.swim = null; m.hold = null; m.climb = null;
  go(m, 'standoff', rand(4, 9));
  m.startDist = flat(target.location, c.location);
  mode(c, 'observe', target);
  act(c, m, chance(preset().revelation * 2) ? 'full_stand' : pick(['watch', 'head_tilt', 'hunting_stance', 'patient_strike']));
  spotted(c, m, target);
  m.walkAt = chance(0.25 + profileOf(target).bold * 0.4);            // it may simply start walking toward you
  m.walking = false;
  m.frozen = false;
}
function chase(c, m, target) {
  m.swim = null; m.hold = null; m.climb = null;
  go(m, 'chase', 30);
  m.chaseEnd = now() + Math.round(randInt(...threat().chaseSeconds) * TPS * (1 + 0.05 * Math.min(6, profileOf(target).runs)));
  m.nextLunge = now() + 30;
  m.best = 999;
  m.stuckFor = 0;
  m.chased = target.id;
  m.act = '';
  mode(c, 'hunt', target);
  sound(c.dimension, 'mob.brinesleeper.roar', c.getHeadLocation(), 1.4, rand(0.9, 1));
  m.spotted = false;
  spotted(c, m, target);
  shake(target, 0.2, 0.5);
  m.runStart = flat(target.location, c.location);
}
function endChase(c, m) {
  const p = playerById(m.chased);
  if (p) { learn(p, 'meets', 1); bolder(p, 0.02); }
  m.chased = undefined;
  m.cooldownUntil = now() + gap();
}
function deep(c, m, target) {
  if (!c.isInWater) {                                               // it comes up from under you, from the nearest deep water
    const s = waterAround(target, 7, 16, { depth: 3, tries: 16 });
    if (!s || seenByAnyone(c) || !sink(c, m, s)) { m.cooldownUntil = now() + 5 * TPS; if (m.state !== 'stalk') stalk(c, m, target); return; }
  }
  go(m, 'deep', randInt(...threat().chaseSeconds));
  m.chased = target.id;
  m.passes = 0;
  m.grasped = false;
  sound(c.dimension, 'mob.brinesleeper.moan', c.location, 1.2, rand(0.85, 0.95));
  m.spotted = false;
  spotted(c, m, target);
}
function retreat(c, m, target) {
  m.swim = null; m.hold = null; m.climb = null;
  if (m.state === 'chase' || m.state === 'deep') endChase(c, m);
  go(m, 'retreat', 12);
  m.withdrawn = false;
  if (c.isInWater) { vanish(c, m, target); return; }
  mode(c, 'observe', target);
  act(c, m, 'retreat');                                              // it turns away first
  m.retreatRun = now() + 30;
  sound(c.dimension, 'mob.brinesleeper.hiss', c.getHeadLocation(), 1, rand(0.9, 1.1));
}
function decide(c, m, target, provoked) {
  const pr = profileOf(target);
  const p = preset().chase + (provoked ? 0.25 : 0) + pr.bold * 0.3 + 0.03 * Math.min(8, pr.fights);
  if (hunter(target) && chance(p)) chase(c, m, target);
  else { if (pr.bold < 0.5 || chance(0.5)) retreat(c, m, target); else stalk(c, m, target); }
}
function ambush(c, m, target, water) {
  m.ambushAt = water;
  m.hold = under(water, LURK_DEPTH);
  go(m, 'ambush', rand(3, 8));
  if (flat(water, c.location) < 4 || !c.isInWater) {
    if (seenByAnyone(c)) { lurk(c, m, target); return; }
    try { c.teleport(m.hold, { facingLocation: target.location }); } catch (e) { /* ok */ }
    mode(c, 'hold');
    act(c, m, 'swim');
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
  act(c, m, 'emerge_roar');
  sound(c.dimension, 'brine.fx.burst', s, 1.3, 0.9);
  sound(c.dimension, 'mob.brinesleeper.roar', s, 1.4, 1);
  particle(c.dimension, 'brine:splash', s);
  particle(c.dimension, 'brine:splash', add(s, { x: 0.5, y: 0, z: -0.4 }));
  m.spotted = false;
  spotted(c, m, target);
  shake(target, 0.35, 0.6);
  const k = norm(sub(s, target.location));
  try { target.applyKnockback({ x: k.x * 0.6, z: k.z * 0.6 }, 0.12); } catch (e) { /* ok */ }
  go(m, 'burst', 0.8);
}

// ------------------------------------------------------------------ the grab and the lunge
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
  if (target.isJumping && chance(0.2)) m.graspBroken = true;
  return true;
}
function lunge(c, m, target) {
  m.nextLunge = now() + randInt(55, 100) - 5 * Math.min(6, profileOf(target).fights);
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

// ------------------------------------------------------------------ the body: crawling under low ceilings, how it moves
function headroom(dim, pos) {
  let n = 0;
  while (n < 5 && roomy(block(dim, { x: pos.x, y: pos.y + n, z: pos.z }))) n++;
  return n;
}
function crawl(c, m, on) {
  if (m.crawl === on) return;
  m.crawl = on;
  m.crawlSince = now();
  try { c.triggerEvent(on ? 'brine:crawl_on' : 'brine:crawl_off'); } catch (e) { /* ok */ }
}
/**
 * Its body: under a low ceiling (or when you have gone somewhere low) it drops onto all fours, with a hitbox 1.6 blocks
 * high, so it never wedges itself under a ledge and it can follow you into any tunnel. Returns whether it is moving.
 */
function body(c, m, target) {
  const dim = c.dimension;
  const v = c.getVelocity();
  if (Math.hypot(v.x, v.z) > 0.035) m.movedAt = now();
  const moving = now() - (m.movedAt ?? -99) < 10;
  const ahead = add(c.location, mul(norm({ x: v.x, y: 0, z: v.z }), 1.2));
  let room = Math.min(headroom(dim, c.location), moving ? headroom(dim, ahead) : 5);
  const after = target && (m.state === 'stalk' || m.state === 'chase') && flat(target.location, c.location) < 24;
  if (after && headroom(dim, target.location) < 4) room = Math.min(room, 3);       // you went low: it gets down to follow
  if (room < 4) crawl(c, m, true);
  else if (room >= 5 && now() - m.crawlSince > 40 && now() > (m.crawlHold ?? 0)) crawl(c, m, false);
  return moving;
}
/** the animation that goes with what it is doing, when it is moving by itself (not swimming, climbing or held) */
function gait(c, m, target, moving) {
  if (m.swim || m.climb || m.hold || m.frozen) return;
  const wet = c.isInWater;
  const low = m.crawl && !wet;
  const near = nearWater(c.dimension, c.location, 2);
  const bold = target ? profileOf(target).bold : 0;
  const swim = moving ? 'swim' : 'idle_water';
  switch (m.state) {
    case 'stalk': act(c, m, wet ? swim : low ? 'tunnel_crawl' : !moving ? 'hunting_stance' : near ? 'shoreline_stalk' : bold > 0.55 ? 'slow_approach' : 'stalk'); break;
    case 'chase': act(c, m, wet ? 'swim' : low ? 'tunnel_crawl' : moving ? 'run' : 'hunting_stance'); break;
    case 'retreat': if (now() >= (m.retreatRun ?? 0)) act(c, m, wet ? 'swim' : low ? 'tunnel_crawl' : moving ? 'run' : 'retreat'); break;
    case 'standoff': if (m.walking) act(c, m, low ? 'tunnel_crawl' : moving ? 'slow_approach' : 'hunting_stance'); break;
    case 'idle': act(c, m, wet ? swim : low ? 'tunnel_crawl' : moving ? 'walk' : 'watch'); break;
    case 'hidden': act(c, m, wet ? 'idle_water' : low ? 'tunnel_crawl' : 'shadow_hide'); break;
    default: break;
  }
}
/** stuck: it gets down low, pushes, and if nobody is looking, it is simply somewhere else */
function unstick(c, m, target) {
  const t = now();
  if (m.swim || m.climb || m.hold || m.frozen || t - m.lastMove < 4 * TPS) return;
  if (target && flat(target.location, c.location) < 3) { m.lastMove = t; return; }            // in reach: not stuck
  if (c.isInWater && target) {
    const b = bankNear(c, target);
    if (b && flat(b.water, c.location) < 6) { climbOut(c, m, b.bank, target.getHeadLocation(), () => standoff(c, m, target)); return; }
  }
  crawl(c, m, true);
  m.crawlHold = t + 200;
  if (t - m.lastMove < 9 * TPS) {
    if (t % 20 === 0) {
      const dir = target ? norm(sub(target.location, c.location)) : norm({ x: rand(-1, 1), y: 0, z: rand(-1, 1) });
      try { c.applyImpulse({ x: dir.x * 0.35, y: 0.3, z: dir.z * 0.35 }); } catch (e) { /* ok */ }
    }
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
  let best, bd = 96;
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
  const moving = m.swim || m.climb || m.hold ? false : body(c, m, target);
  if (!config.enabled || !target) {
    if (m.chased) endChase(c, m);
    if (m.state !== 'idle') {
      m.swim = null; m.hold = null; m.climb = null; m.frozen = false; m.riseUntil = 0;
      go(m, 'idle', 30); m.act = ''; mode(c, c.isInWater ? 'roam_water' : 'roam_land');
    }
    gait(c, m, undefined, moving);
    if (m.crawl && headroom(c.dimension, c.location) < 4) unstick(c, m);
    return;
  }
  m.target = target.id;
  const pr = profileOf(target);
  const d = flat(target.location, c.location);
  const head = c.getHeadLocation();
  const seen = looksAt(target, head, 0.88, 96);
  m.seenFor = seen ? m.seenFor + 5 : 0;
  m.unseenFor = seen ? 0 : m.unseenFor + 5;
  const hunting = m.state === 'chase' || m.state === 'deep' || m.state === 'burst';
  feel(target, d, hunting);
  if (hunting) press(target.id, 'chase', t + 60);
  else if (d < 44 && m.state !== 'idle' && m.state !== 'lurk') press(target.id, 'near', t + 80);
  else if (d < 24) press(target.id, 'near', t + 80);
  watchHabits(target, c);

  switch (m.state) {
    case 'idle': {
      if (t < m.cooldownUntil) break;
      if (c.isInWater || nearWater(c.dimension, c.location, 6)) lurk(c, m, target, rand(3, 7));
      else watch(c, m, target);
      break;
    }
    case 'vanishing': break;
    case 'lurk': {
      if (!m.swim && t % 60 < 5 && c.isInWater) {
        const s = surfaceNear(c.dimension, c.location, 6, 1);
        if (s && chance(0.4)) particle(c.dimension, 'brine:bubbles', s);
      }
      if (target.isInWater && hunter(target) && d < 40 && t >= m.cooldownUntil) { deep(c, m, target); break; }
      // you are standing at the edge of deep water, still: it is already under it
      if (c.isInWater && !target.isInWater && hunter(target) && t >= m.cooldownUntil && d < 40 && chance(0.06) &&
          now() - (m.lastAmbush ?? -9999) > 60 * TPS) {
        const edge = waterAround(target, 1.5, 4, { depth: 3, allowView: true, tries: 10 });
        if (edge && Math.hypot(target.getVelocity().x, target.getVelocity().z) < 0.05) { m.lastAmbush = t; ambush(c, m, target, edge); break; }
      }
      if (t < m.until) break;
      if (t < m.cooldownUntil) { lurk(c, m, target, rand(8, 16)); if (chance(0.35)) watch(c, m, target); break; }
      const need = config.preset === 'quiet' ? 3 : config.preset === 'nightmare' ? 0 : pr.bold > 0.6 ? 0 : randInt(1, 2);
      if (m.sightings < need) watch(c, m, target);
      else { m.sightings = 0; approach(c, m, target); }
      break;
    }
    case 'watch': {
      eyes(c, m, d);
      if (seen && m.seenFor >= 4) spotted(c, m, target);
      const tooClose = d < 16 - pr.bold * 8;
      if ((m.seenFor >= m.watchNeed && !tooClose) || tooClose) {
        if (m.seenFor > 0) bolder(target, 0.004);                   // you saw it, and nothing happened: it learns
        if (pr.bold > 0.7 && tooClose && chance(0.4)) {            // it no longer runs from you
          if (m.kind === 'water') { m.hold = null; approach(c, m, target); } else { m.hold = null; standoff(c, m, target); }
          break;
        }
        vanish(c, m, target);
        break;
      }
      if (t >= m.until) { m.sightings++; if (c.isInWater || m.kind === 'water') lurk(c, m, target); else stalk(c, m, target); }
      break;
    }
    case 'approach': {
      if (target.isInWater && hunter(target) && d < 30) { m.hold = null; m.riseUntil = 0; deep(c, m, target); break; }
      if (m.riseUntil) {                                            // risen out of the water, staring: then it comes out
        eyes(c, m, d);
        if (t >= m.riseUntil || d < 4) { m.riseUntil = 0; m.hold = null; m.haul?.(); }
        break;
      }
      if (!m.swim && !m.climb) approach(c, m, target);
      break;
    }
    case 'hidden': {                                                // out of sight, far off: waiting for its moment
      if ((seen && m.seenFor >= 10) || d < 12) { vanish(c, m, target); break; }
      if (t < m.until) break;
      if (t < m.cooldownUntil) { if (chance(0.5)) watch(c, m, target); else go(m, 'hidden', rand(5, 10)); }
      else if (m.sightings < 1 && pr.bold < 0.6) watch(c, m, target);
      else { m.sightings = 0; if (nearWater(target.dimension, target.location, 6)) approach(c, m, target); else stalk(c, m, target); }
      break;
    }
    case 'standoff': {
      eyes(c, m, d);
      if (d < 5 || d < m.startDist - 4) { decide(c, m, target, true); break; }
      if (m.seenFor > randInt(70, 110)) { decide(c, m, target, false); break; }
      if (m.unseenFor > 50) { stalk(c, m, target); break; }
      if (m.walkAt && t > m.since + 50 && !m.walking) { m.walking = true; mode(c, 'stalk', target); }     // it starts walking at you
      if (t >= m.until) { m.walking = false; decide(c, m, target, false); break; }
      if (chance(0.025)) sound(c.dimension, 'mob.brinesleeper.click', head, 0.8, rand(0.7, 0.9));
      break;
    }
    case 'stalk': {
      if (target.isInWater && c.isInWater && hunter(target) && t >= m.cooldownUntil && !m.frozen) { deep(c, m, target); break; }
      const vanishAt = 14 - pr.bold * 6;
      if (d > vanishAt && m.seenFor >= Math.round(15 + pr.bold * 30)) { vanish(c, m, target); break; }
      if (d < m.standoffAt) { standoff(c, m, target); break; }
      const mining = now() - (busy.get(target.id) ?? -999) < 40;
      // it only comes closer while you are not looking. Look at it and it stops dead; it knows when you look back,
      // and waits longer before it moves again
      if (seen && !m.frozen && m.seenFor >= 5) {
        m.frozen = true;
        mode(c, 'observe', target);
        act(c, m, m.crawl ? 'tunnel_crawl' : nearWater(c.dimension, c.location, 2) ? 'shoreline_stalk' : pick(['head_tilt', 'hunting_stance', 'watch']));
        spotted(c, m, target);
        m.until += 20;
      } else if (m.frozen && m.unseenFor >= (pr.looks >= 6 ? 50 : 15)) {
        m.frozen = false;
        mode(c, 'stalk', target);
        m.act = '';
      }
      if (m.frozen) {
        eyes(c, m, d);
        if (m.seenFor > 80) standoff(c, m, target);                 // you stared it down: it stares back
        break;
      }
      if (!seen && d < 8 && chance(mining ? 0.12 : 0.05)) sound(c.dimension, 'mob.brinesleeper.breathe', head, 1.1, rand(0.8, 0.95));
      const snuff = config.lights && t >= m.nextSnuff && !seen && d < 22 && chance(0.1 * (1 + Math.min(4, pr.lights / 3)));
      if (snuff && snuffLight(target)) m.nextSnuff = t + randInt(20, 45) * TPS;
      if (c.isInWater && !target.isInWater && (surfaceNear(c.dimension, c.location, 6, 3)?.depth ?? 0) >= 2) {
        if (d < 18 && approach(c, m, target, false)) break;
        if (leaveWater(c, m, target, () => { mode(c, 'stalk', target); m.act = ''; m.lastMove = now(); })) break;
      }
      eyes(c, m, d);
      if (t >= m.until) decide(c, m, target, false);
      unstick(c, m, target);
      break;
    }
    case 'chase': {
      if (graspers.get(target.id) === m) { graspTick(c, m, target); break; }
      if (m.climb) break;                                           // hauling itself out onto your bank
      if (target.isInWater && c.isInWater) { m.chased = undefined; deep(c, m, target); break; }
      if (!hunter(target) || d > 48 || t >= m.chaseEnd) { retreat(c, m, target); break; }
      if (target.isSprinting && d > m.runStart + 3) { learn(target, 'runs', 0.2, 3); m.runStart = d; }
      m.stuckFor = d < m.best - 0.5 ? 0 : m.stuckFor + 5;
      m.best = Math.min(m.best, d);
      if (m.stuckFor > 6 * TPS && !inSight(target, head)) { retreat(c, m, target); break; }
      if (d > 2.4 && d < 6 && t >= m.nextLunge && inSight(target, head, 8)) lunge(c, m, target);
      if (c.isInWater && !target.isInWater) {
        const b = bankNear(c, target);
        const back = () => { mode(c, 'hunt', target); m.act = ''; m.lastMove = now(); };
        if (b && flat(b.water, c.location) < 7) climbOut(c, m, b.bank, target.getHeadLocation(), back);
        else leaveWater(c, m, target, back);
      }
      unstick(c, m, target);
      break;
    }
    case 'deep': {
      if (graspers.get(target.id) === m) { graspTick(c, m, target); break; }
      if (!target.isInWater || t >= m.until || !hunter(target)) {
        endChase(c, m);
        if (!target.isInWater && d < 12) { approach(c, m, target); break; }
        lurk(c, m, target);
        break;
      }
      const goal = add(target.location, { x: 0, y: -0.8, z: 0 });
      if (d < 2.6 && !m.grasped && config.grasp && preset().damage > 0 && health(target) > 6) { m.swim = null; grasp(c, m, target); break; }
      if (m.grasped && d < 3) {
        const a = Math.random() * Math.PI * 2;
        swimTo(c, m, add(target.location, { x: Math.cos(a) * 8, y: -2, z: Math.sin(a) * 8 }), 0.35, () => { m.grasped = m.passes++ >= 1; }, undefined);
        break;
      }
      if (!m.swim || flat(m.swim.goal, goal) > 2) swimTo(c, m, goal, 0.42, undefined, () => { endChase(c, m); lurk(c, m, target); });
      break;
    }
    case 'ambush': {
      if (t % 10 < 5) particle(c.dimension, 'brine:bubbles', m.ambushAt);
      if (d > 10) { if (t >= m.until) lurk(c, m, target); break; }
      if (t >= m.until || (looksAt(target, m.ambushAt, 0.93) && chance(0.25))) burst(c, m, target);
      break;
    }
    case 'burst': {
      if (t >= m.until) { m.hold = null; if (hunter(target)) chase(c, m, target); else retreat(c, m, target); }
      break;
    }
    case 'retreat': {
      if (t >= (m.retreatRun ?? 0) && !m.withdrawn) { m.withdrawn = true; mode(c, 'withdraw', target); }
      if (c.isInWater) { vanish(c, m, target); break; }
      if (t >= m.until || (!inSight(target, head) && d > 18)) { vanish(c, m, target); break; }
      unstick(c, m, target);
      break;
    }
    default: lurk(c, m, target);
  }
  gait(c, m, target, moving);
}

// ------------------------------------------------------------------ it leaves its home: following you, coming to where you sleep
const away = new Map();                                             // player id -> ticks spent far from it
function wander() {
  if (!config.follow || !config.enabled) return;
  const all = creatures();
  const c = all.find((e) => !e.hasTag(STAGED));
  if (!c && all.length) return;                                     // the director has it on stage right now
  const players = world.getAllPlayers();
  for (const p of players) {
    if (p.dimension.id !== 'minecraft:overworld' || !hunter(p)) { away.delete(p.id); continue; }
    const pr = profileOf(p);
    if (pr.bold < 0.45) continue;                                   // still afraid: it stays home
    const far = !c || flat(c.location, p.location) > 110;
    away.set(p.id, far ? (away.get(p.id) ?? 0) + 40 : 0);
    if (c) {
      const m = mindOf(c);
      if (m.state === 'chase' || m.state === 'deep' || m.state === 'burst') continue;
      if (players.some((o) => o.id !== p.id && o.dimension.id === c.dimension.id && flat(o.location, c.location) < 64)) continue;   // busy with someone else
    }
    // at night, at the place you sleep, once a night
    let spawn;
    try { spawn = p.getSpawnPoint(); } catch (e) { spawn = undefined; }
    const tod = world.getTimeOfDay();
    const night = tod > 13000 && tod < 23000;
    const atHome = !!spawn && spawn.dimension.id === p.dimension.id && Math.hypot(spawn.x - p.location.x, spawn.z - p.location.z) < 40;
    const homeVisit = atHome && night && pr.bold > 0.65 && pr.homeDay !== world.getDay() && chance(0.2);
    const follow = (away.get(p.id) ?? 0) >= 90 * TPS && (itsHour(p) || nearWater(p.dimension, p.location, 8));
    if (!homeVisit && !follow) continue;
    // any water it can use (a dripstone cave lake, a river, the pond by your door), else somewhere dark
    const w = waterAround(p, 26, 48, { depth: 3, tries: 24 });
    const f = !w ? spot(p, 'floor', 30, 50, { room: 5, eyeHeight: 3.2, tries: 24 }) : undefined;
    const to = w ? under(w, LURK_DEPTH) : f;
    if (!to) continue;
    let cr = c;
    try {
      if (!cr) { cr = overworld().spawnEntity(CREATURE, to); cr.triggerEvent(`brine:threat_${config.threat}`); }
      else if (!seenByAnyone(cr)) cr.teleport(to);
      else continue;
    } catch (e) { continue; }
    const mm = mindOf(cr);
    mm.swim = null; mm.hold = null; mm.climb = null;
    mm.cooldownUntil = now() + 10 * TPS;
    go(mm, 'idle', 1);
    away.set(p.id, 0);
    if (homeVisit) {
      pr.homeDay = world.getDay();
      addEntry(p, 'home');
      whisper(p, '...it found where you sleep...');
      mm.nextSnuff = now();                                         // the torches by your door go out first
    } else {
      learn(p, 'followed', 1);
      addEntry(p, 'follows');
      whisper(p, '...it left the still water...');
    }
    debug(homeVisit ? 'it came to your home' : 'it followed you');
    break;
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
    if (!near && !inStillwater(p.dimension, p.location)) continue;
    if (depthBelow(p) < 3) continue;
    st.next = t + Math.round((randInt(...preset().deep) * TPS) / freq());
    if (near && hunter(p) && chance(0.4 + 0.05 * Math.min(6, profileOf(p).swims))) {
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
    if (inStillwater(p.dimension, p.location) && nearWater(p.dimension, p.location, 5)) whisper(p);
  }
}
const returns = [];
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  const a = damageSource.damagingEntity;
  if (hurtEntity.typeId !== CREATURE || !a || a.typeId !== 'minecraft:player') return;
  const p = /** @type {import('@minecraft/server').Player} */ (a);
  learn(p, 'fights', 1, 4);
  const m = minds.get(hurtEntity.id);
  if (!m) return;
  if (graspers.get(p.id) === m) m.graspBroken = true;
  if (['standoff', 'stalk', 'idle', 'watch', 'lurk'].includes(m.state)) {
    m.swim = null; m.hold = null;
    if (hurtEntity.isInWater && hunter(p) && p.isInWater) deep(hurtEntity, m, p);
    else decide(hurtEntity, m, p, true);
  }
});
world.afterEvents.entityDie.subscribe(({ deadEntity, damageSource }) => {
  if (deadEntity.typeId !== CREATURE) return;
  minds.delete(deadEntity.id);
  const killer = damageSource.damagingEntity;
  if (killer && killer.typeId === 'minecraft:player' && config.enabled) {
    const p = /** @type {import('@minecraft/server').Player} */ (killer);
    learn(p, 'kills', 1);
    addEntry(p, 'kill');
    bolder(p, 0.15);                                                // the next one is not afraid
    returns.push({ id: p.id, at: now() + Math.round(randInt(180, 360) * TPS / freq()) });
  }
});
function comebacks() {
  const t = now();
  for (let i = returns.length - 1; i >= 0; i--) {
    const r = returns[i];
    if (t < r.at) continue;
    const p = playerById(r.id);
    if (!p) { returns.splice(i, 1); continue; }
    if (creatures().length || !inStillwater(p.dimension, p.location)) { r.at = t + 30 * TPS; continue; }
    returns.splice(i, 1);
    const s = waterAround(p, 24, 40, { depth: 4 });
    if (!s) { returns.push({ id: r.id, at: t + 60 * TPS }); continue; }
    try {
      const c = overworld().spawnEntity(CREATURE, under(s, LURK_DEPTH));
      c.triggerEvent(`brine:threat_${config.threat}`);
      mindOf(c).cooldownUntil = now();
      whisper(p, "...you didn't think that was the only one...");
    } catch (e) { /* ok */ }
  }
}

// ------------------------------------------------------------------ what it knows (the settings wheel and /brine:memory)
export function memoryText(p) {
  const pr = profileOf(p);
  const b = pr.bold;
  return `§8What it has learned about you§r\n  boldness ${b.toFixed(2)} ${b > 0.65 ? '(it comes to your home)' : b >= 0.45 ? '(it follows you)' : '(it stays in the still water)'}\n` +
    `  looks back ${Math.round(pr.looks)}  lights ${Math.round(pr.lights)}  runs ${pr.runs.toFixed(1)}  swims ${pr.swims.toFixed(1)}\n` +
    `  fights ${Math.round(pr.fights)}  kills ${Math.round(pr.kills)}  meetings ${Math.round(pr.meets)}  followed you ${Math.round(pr.followed)}`;
}
/** testing: forget a player, or make it bold toward them at once */
export function setMemory(p, bold) {
  const pr = bold === undefined ? { ...PROFILE } : { ...profileOf(p), bold };
  profiles.set(p.id, pr);
  saveProfiles();
}

// ------------------------------------------------------------------ start
function brainTick() {
  let all = creatures();
  const free = all.filter((c) => !c.hasTag(STAGED));
  if (free.length > 1) {                                            // there is only ever one: keep the one nearest a player
    const players = world.getAllPlayers();
    const d = (c) => Math.min(999, ...players.map((p) => flat(p.location, c.location)));
    free.sort((a, b) => d(a) - d(b));
    for (const c of free.slice(1)) { minds.delete(c.id); removeQuietly(c); }
    all = creatures();
  }
  for (const c of all) {
    if (c.hasTag(STAGED)) {
      for (const p of world.getAllPlayers()) {
        const dd = flat(p.location, c.location);
        if (p.dimension.id === c.dimension.id && dd < 30) { feel(p, dd, false); press(p.id, 'near', now() + 60); }
      }
      continue;
    }
    try { think(c); } catch (e) { console.warn(`[brine] brain: ${e}`); }
  }
  const alive = new Set(all.map((c) => c.id));
  for (const id of [...minds.keys()]) if (!alive.has(id)) minds.delete(id);
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
  system.runInterval(() => { murmurs(); comebacks(); wander(); }, 40);
  system.runInterval(() => {                                        // it grows used to you, slowly, the longer you stay
    for (const p of world.getAllPlayers()) if (inStillwater(p.dimension, p.location)) bolder(p, 0.002);
    saveProfiles();
  }, 600);
});
