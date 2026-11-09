// The Brinesleeper: "The Water Remembers".
// A hidden director that stages the Brinesleeper's encounters in the Stillwater Caves.
// Stable Script API only: @minecraft/server 2.9.0 and @minecraft/server-ui 2.1.0 (Bedrock 1.26.40), no experiments.
// Every effect is built from documented calls: entity events/properties for poses, particles, sounds, raycasts.
import { world, system, CommandPermissionLevel, EntityDamageCause, EntityInitializationCause, GameMode } from '@minecraft/server';
import { config, PRESETS, preset, threat, freq, loadConfig } from './config.js';

const CREATURE = 'brine:brinesleeper';
const SHADE = 'brine:apparition';
const BIOME = 'brine:stillwater_caves';
const STAGED = 'brine_staged';
const TPS = 20;

// Pose ("act") ids: must match ACTS in tools/pack.py (the animation controller reads query.property('brine:act'))
const ACT = {
  none: 0, watch: 1, submerged_watch: 2, shoreline_stalk: 3, corner_watch: 4, distant_observer: 5, full_stand: 6, emerge: 7,
  submerge: 8, ledge_watch: 9, behind_cover: 10, head_tilt: 11, shadow_hide: 12, tunnel_crawl: 13, retreat: 14, water_rise: 15,
  hunting_stance: 16, slow_approach: 17, patient_strike: 18, veil_stalk: 19, reflection_lurk: 20, idle_water: 21, swim: 22,
  emerge_roar: 23,
};
// how far below the waterline the model's root sits for each water pose (from the pose calibration, 16 px = 1 block)
const S = 1.15;                    // the model's scale (horror.py SCALE)
const WATER_DEPTH = { submerged_watch: 2.06 * S, idle_water: 2.06 * S, emerge: 0.25 * S, submerge: 0.25 * S, water_rise: 0.5 * S,
  retreat: 0.375 * S, emerge_roar: 0.375 * S };
const FORM = { silhouette: 0, reflection: 1, hand: 2 };

// ------------------------------------------------------------------ small helpers
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => system.currentTick;
/** @param {import('@minecraft/server').Vector3} a @param {import('@minecraft/server').Vector3} b */
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const norm = (a) => { const l = len(a) || 1; return mul(a, 1 / l); };
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const floorV = (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) });
const overworld = () => world.getDimension('overworld');

function debug(msg) {
  if (!config.debug) return;
  for (const p of world.getAllPlayers()) if (p.commandPermissionLevel >= CommandPermissionLevel.GameDirectors) p.sendMessage(`§8[brine] ${msg}`);
}

function block(dim, pos) {
  try { return dim.getBlock(floorV(pos)); } catch (e) { return undefined; }
}
const isWater = (b) => !!b && (b.typeId === 'minecraft:water' || b.typeId === 'minecraft:flowing_water');
const isOpen = (b) => !!b && (b.isAir || (!b.isLiquid && !b.isSolid));
const isSolid = (b) => !!b && b.isSolid;

function inBiome(dim, pos) {
  try { return dim.id === 'minecraft:overworld' && dim.getBiome(pos).id === BIOME; } catch (e) { return false; }
}

/** a clear line between two points (no solid block in the way) */
function clearLine(dim, from, to) {
  const d = sub(to, from);
  const dist = len(d);
  if (dist < 0.5) return true;
  try {
    const hit = dim.getBlockFromRay(from, norm(d), { maxDistance: dist - 0.6, includeLiquidBlocks: false, includePassableBlocks: false });
    return !hit;
  } catch (e) { return false; }
}

/** is the player looking at a point (inside a view cone, with nothing in the way)? */
function looksAt(player, pos, cos = 0.9, max = 72) {
  const eye = player.getHeadLocation();
  const d = sub(pos, eye);
  const dist = len(d);
  if (dist > max) return false;
  if (dot(player.getViewDirection(), mul(d, 1 / (dist || 1))) < cos) return false;
  return clearLine(player.dimension, eye, pos);
}
/** could the player see a point if they turned (clear line, any direction)? */
const inSight = (player, pos, max = 72) => flat(player.location, pos) <= max && clearLine(player.dimension, player.getHeadLocation(), pos);

function sound(dim, id, pos, volume = 1, pitch = 1) {
  if (silenced(pos)) return;
  try { dim.playSound(id, pos, { volume, pitch }); } catch (e) { /* unloaded */ }
}
function particle(dim, id, pos) {
  try { dim.spawnParticle(id, pos); } catch (e) { /* unloaded */ }
}

// ------------------------------------------------------------------ places: water surfaces, floors, shorelines
/** the water surface in this column near `y` (top water block with open air above), with its depth */
function waterSurface(dim, x, y, z, up = 5, down = 8) {
  for (let yy = y + up; yy >= y - down; yy--) {
    const b = block(dim, { x, y: yy, z });
    if (!isWater(b)) continue;
    const above = block(dim, { x, y: yy + 1, z });
    if (!isOpen(above)) continue;
    let depth = 1;
    while (depth < 10 && isWater(block(dim, { x, y: yy - depth, z }))) depth++;
    return { x: x + 0.5, y: yy + 1, z: z + 0.5, depth };
  }
  return undefined;
}
/** a floor in this column near `y` with `room` open blocks above it */
function floorAt(dim, x, y, z, room = 4, up = 4, down = 6) {
  for (let yy = y + up; yy >= y - down; yy--) {
    if (!isSolid(block(dim, { x, y: yy - 1, z }))) continue;
    let ok = true;
    for (let k = 0; k < room && ok; k++) ok = isOpen(block(dim, { x, y: yy + k, z }));
    if (ok) return { x: x + 0.5, y: yy, z: z + 0.5 };
  }
  return undefined;
}
function nearWater(dim, pos, r = 2) {
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const dy of [0, -1, -2]) {
    if (isWater(block(dim, { x: Math.floor(pos.x) + dx, y: Math.floor(pos.y) + dy, z: Math.floor(pos.z) + dz }))) return true;
  }
  return false;
}
/**
 * Look for a place around the player. kind: 'water' (surface, optional depth), 'floor' (room above), 'shore' (floor by water).
 * Never in plain view unless allowView; always inside the biome.
 */
function findSpot(player, kind, minD, maxD, opts = {}) {
  const dim = player.dimension;
  const p = player.location;
  const view = player.getViewDirection();
  const tries = opts.tries ?? 28;
  for (let i = 0; i < tries; i++) {
    let ang = Math.random() * Math.PI * 2;
    if (opts.ahead) ang = Math.atan2(view.z, view.x) + rand(-opts.ahead, opts.ahead);
    if (opts.behind) ang = Math.atan2(-view.z, -view.x) + rand(-opts.behind, opts.behind);
    const d = rand(minD, maxD);
    const x = Math.floor(p.x + Math.cos(ang) * d), z = Math.floor(p.z + Math.sin(ang) * d), y = Math.floor(p.y);
    let s;
    if (kind === 'water') {
      s = waterSurface(dim, x, y, z);
      if (s && s.depth < (opts.depth ?? 1)) s = undefined;
    } else {
      s = floorAt(dim, x, y, z, opts.room ?? 4);
      if (s && kind === 'shore' && !nearWater(dim, add(s, { x: 0, y: 0, z: 0 }), 1)) s = undefined;
    }
    if (!s || !inBiome(dim, s)) continue;
    const head = add(s, { x: 0, y: opts.eyeHeight ?? 1.5, z: 0 });
    if (!opts.allowView && looksAt(player, head, 0.8)) continue;
    if (opts.sight && !inSight(player, head)) continue;
    return s;
  }
  return undefined;
}

// ------------------------------------------------------------------ per-player memory and the hidden tension
class Watch {
  /** @param {import('@minecraft/server').Player} p */
  constructor(p) {
    this.id = p.id;
    this.biomeSeconds = Number(p.getDynamicProperty('brine:seconds') ?? 0);
    this.tension = Number(p.getDynamicProperty('brine:tension') ?? 0);
    this.firstQuiet = Number(p.getDynamicProperty('brine:quiet') ?? randInt(...preset().firstQuiet));
    this.nextMinor = now() + randInt(...preset().minor) * TPS;
    this.nextMajor = now() + randInt(60, 180) * TPS;
    this.protectUntil = 0;
    this.memories = [];          // The Water Remembers: places this player was in or beside the water
    this.inBiome = false;
    this.wasInWater = false;
    this.swimTrail = [];         // for The Stolen Wake
    this.swimTicks = 0;
    this.entries = [];           // water entries (The Third Splash)
    this.stillTicks = 0;
    this.lastPos = p.location;
    this.visitSeconds = 0;
    this.finalDone = false;
    this.lastEcho = 0;
    this.minor = null;           // the minor event generator in progress
    this.minorName = '';
    this.minorWake = 0;
    this.majors = 0;
  }
  save(p) {
    try {
      p.setDynamicProperty('brine:seconds', Math.round(this.biomeSeconds));
      p.setDynamicProperty('brine:tension', Math.round(this.tension));
      p.setDynamicProperty('brine:quiet', this.firstQuiet);
    } catch (e) { /* player gone */ }
  }
  remember(pos) {
    if (this.memories.some((m) => flat(m, pos) < 6)) return;
    this.memories.push({ x: pos.x, y: pos.y, z: pos.z, t: now() });
    if (this.memories.length > 8) this.memories.shift();
  }
}
/** @type {Map<string, Watch>} */
const watches = new Map();
const watchOf = (p) => { let w = watches.get(p.id); if (!w) { w = new Watch(p); watches.set(p.id, w); } return w; };
const playerById = (id) => world.getAllPlayers().find((p) => p.id === id);

// Stillwater Territory: where the creature was seen, the water stays "awake" for a few minutes, then forgets
const territories = [];
const inTerritory = (pos) => territories.some((t) => t.until > now() && flat(t, pos) < 32);
function markTerritory(pos) {
  territories.push({ x: pos.x, z: pos.z, until: now() + randInt(180, 300) * TPS });
  while (territories.length > 6) territories.shift();
}

// The Silent Water Event: the add-on's own sounds stop for a while around a point (vanilla audio is not touched)
let silence = null;
const silenced = (pos) => !!silence && silence.until > now() && flat(silence, pos) < 48;

// ------------------------------------------------------------------ the creature (exactly one real one per world)
function creatures() {
  try { return overworld().getEntities({ type: CREATURE }); } catch (e) { return []; }
}
function setMode(c, mode) { try { c.triggerEvent(`brine:mode_${mode}`); } catch (e) { /* removed */ } }
function setAct(c, act) { try { c.setProperty('brine:act', ACT[act] ?? 0); } catch (e) { /* removed */ } }
function removeQuietly(e) { try { if (e.isValid) e.remove(); } catch (e2) { /* gone */ } }

/**
 * Put the one real Brinesleeper at a place, holding a pose. Any other copy is removed first, but only if nobody can see it.
 * Returns undefined when the world's creature is busy in plain sight.
 */
function stageCreature(pos, act, face) {
  const dim = overworld();
  for (const c of creatures()) {
    if (!c.hasTag(STAGED)) return undefined;              // a free creature is out there: the brain runs the encounters
    const seen = world.getAllPlayers().some((p) => p.dimension.id === dim.id && inSight(p, c.getHeadLocation(), 64));
    if (seen) return undefined;
    removeQuietly(c);
  }
  let c;
  try { c = dim.spawnEntity(CREATURE, pos); } catch (e) { return undefined; }
  c.addTag(STAGED);
  c.triggerEvent(`brine:threat_${config.threat}`);
  setMode(c, 'hold');
  setAct(c, act);
  try { c.teleport(pos, { facingLocation: face }); } catch (e) { /* ok */ }
  return c;
}
/** a creature not staged by the director (summoned, natural, or come back for you) near this player */
const freeCreatureNear = (player, r = 96) => creatures().some((c) => !c.hasTag(STAGED) && flat(c.location, player.location) < r);
/** keep a held creature exactly where it should be (water poses float at the waterline) */
function hold(c, pos, face) { try { if (c.isValid) c.teleport(pos, face ? { facingLocation: face } : undefined); } catch (e) { /* gone */ } }
const waterPose = (surface, act) => ({ x: surface.x, y: surface.y - (WATER_DEPTH[act] ?? 0), z: surface.z });

function spawnShade(pos, form, act, face) {
  try {
    const s = overworld().spawnEntity(SHADE, pos);
    s.addTag(STAGED);
    s.setProperty('brine:form', form);
    s.setProperty('brine:act', ACT[act] ?? 0);
    if (face) s.teleport(pos, { facingLocation: face });
    return s;
  } catch (e) { return undefined; }
}

// ------------------------------------------------------------------ scenes: generator scripts stepped by the director
// A scene yields a number of ticks to wait. Only one creature scene runs at a time (one real creature).
let scene = null;
function startScene(name, player, gen) {
  scene = { name, playerId: player.id, gen, wake: now(), started: now(), creature: undefined };
  debug(`scene ${name} for ${player.name}`);
}
/** a short musical sting for the one player who sees something */
function sting(player, volume = 0.75) {
  if (!config.music) return;
  try { player.playSound('music.brine.sting', { volume }); } catch (e) { /* gone */ }
}
function endScene(reason) {
  if (!scene) return;
  debug(`scene ${scene.name} ended (${reason})`);
  const c = scene.creature;
  if (c && c.isValid) {
    // never vanish in plain sight: sink or walk away first (see withdraw), unless it is already out of view
    const seen = world.getAllPlayers().some((p) => inSight(p, c.getHeadLocation(), 64));
    if (!seen) removeQuietly(c);
    else { setAct(c, 'none'); setMode(c, 'withdraw'); pendingWithdraw.add(c.id); }
  }
  scene = null;
}
const pendingWithdraw = new Set();

/** wait until pred() is true, polling every `step` ticks; returns true if it happened before the timeout */
function* waitUntil(pred, timeout, step = 2) {
  const end = now() + timeout;
  while (now() < end) {
    if (pred()) return true;
    yield step;
  }
  return false;
}
/** a player has looked at a point for `need` ticks in a row (within timeout) */
function* lookedAt(player, posFn, need, timeout, cos = 0.93) {
  let run = 0;
  const end = now() + timeout;
  while (now() < end) {
    if (!player.isValid) return false;
    run = looksAt(player, posFn(), cos) ? run + 2 : 0;
    if (run >= need) return true;
    yield 2;
  }
  return false;
}

/** sink a held creature under the water and remove it (no vanishing in sight) */
function* sinkAway(c, surface) {
  setAct(c, 'submerge');
  sound(c.dimension, 'mob.brinesleeper.submerge', surface, 0.8, rand(0.85, 1));
  for (let i = 0; i < 26; i++) {
    if (!c.isValid) return;
    if (i % 6 === 0) particle(c.dimension, 'brine:bubbles', surface);
    yield 2;
  }
  particle(c.dimension, 'brine:ripple', surface);
  removeQuietly(c);
}
/** walk/slip away out of view, then remove */
function* slipAway(c, player) {
  setAct(c, 'retreat');
  yield 30;
  setAct(c, 'none');
  setMode(c, 'withdraw');
  const gone = yield* waitUntil(() => !c.isValid || (player.isValid && !inSight(player, c.getHeadLocation())) || c.isInWater, 20 * TPS, 4);
  if (c.isValid && c.isInWater) {
    setMode(c, 'hold');
    yield* sinkAway(c, c.location);
    return;
  }
  if (gone && c.isValid) removeQuietly(c);
}
/** aftermath: wet drips along the way it went, from where it stood back to the water */
function wetTrail(dim, from, to) {
  const n = Math.min(10, Math.ceil(flat(from, to) / 1.5));
  for (let i = 0; i <= n; i++) {
    const p = add(from, mul(sub(to, from), i / Math.max(n, 1)));
    system.runTimeout(() => particle(dim, 'brine:drips', add(p, { x: 0, y: 0.1, z: 0 })), i * 6);
  }
}

// ---------- The Waterline Deception (+ The Water Remembers, + The Head That Doesn't Follow)
function* sceneWaterline(player) {
  const w = watchOf(player);
  let s;
  // staged at a place the player has been (the water remembers), never just teleported next to them
  for (const m of [...w.memories].reverse()) {
    if (flat(m, player.location) < 12 || flat(m, player.location) > 40) continue;
    s = waterSurface(player.dimension, Math.floor(m.x), Math.floor(m.y), Math.floor(m.z));
    if (s && s.depth >= 3 && !looksAt(player, add(s, { x: 0, y: 0.5, z: 0 }), 0.8)) break;
    s = undefined;
  }
  s = s ?? findSpot(player, 'water', 14, 30, { depth: 3, eyeHeight: 0.4, sight: true });
  if (!s) return;
  const c = stageCreature(waterPose(s, 'submerged_watch'), 'submerged_watch', player.getHeadLocation());
  if (!c) return;
  scene.creature = c;
  yield* waitUntil(() => !player.isValid || looksAt(player, add(s, { x: 0, y: 0.4, z: 0 }), 0.9), 20 * TPS, 4);
  if (player.isValid && c.isValid) sting(player, 0.6);
  markTerritory(s);
  const where = waterPose(s, 'submerged_watch');
  // it holds still; its head stays on where the player was (it does not follow)
  const end = now() + 70 * TPS;
  let watched = 0;
  while (now() < end && c.isValid && player.isValid) {
    hold(c, where);
    const d = flat(player.location, s);
    if (d < 9) break;                                        // too close: it sinks without a sound
    watched = looksAt(player, add(s, { x: 0, y: 0.4, z: 0 }), 0.96) ? watched + 4 : 0;
    if (watched > 4 * TPS) break;                            // stared at long enough: it sinks slowly
    if (watched === 0 && chance(0.02)) sound(c.dimension, 'mob.brinesleeper.breathe', s, 0.5, rand(0.8, 0.95));
    yield 4;
  }
  if (!c.isValid) return;
  particle(c.dimension, 'brine:ripple', s);
  yield* sinkAway(c, s);
  if (chance(0.5)) watchOf(player).remember(s);
}

// ---------- The Unfinished Emergence
function* sceneEmergence(player) {
  const s = findSpot(player, 'water', 10, 20, { depth: 3, ahead: 1.0, eyeHeight: 0.2 });
  if (!s) return;
  const c = stageCreature(waterPose(s, 'emerge'), 'emerge', player.getHeadLocation());
  if (!c) return;
  scene.creature = c;
  markTerritory(s);
  sound(c.dimension, 'mob.brinesleeper.emerge', s, 0.9, rand(0.85, 1));
  particle(c.dimension, 'brine:splash', s);
  const where = waterPose(s, 'emerge');
  // halfway up it stops; if it is being watched it reconsiders and goes back down
  for (let i = 0; i < 13; i++) { hold(c, where); yield 2; }
  if (looksAt(player, add(s, { x: 0, y: 1.5, z: 0 }), 0.85)) {
    sound(c.dimension, 'mob.brinesleeper.click', s, 0.7, rand(0.8, 1));
    yield* sinkAway(c, s);
    return;
  }
  for (let i = 0; i < 15; i++) { hold(c, where); yield 2; }
  setAct(c, 'water_rise');
  const stand = waterPose(s, 'water_rise');
  const seen = yield* lookedAt(player, () => add(s, { x: 0, y: 2.5, z: 0 }), 20, 10 * TPS, 0.9);
  hold(c, stand);
  if (seen) yield 20;
  yield* sinkAway(c, s);
}

// ---------- The Stationary Predator / Distant Observer (+ The Head That Doesn't Follow)
function* sceneObserver(player) {
  let s = findSpot(player, 'floor', 18, 34, { room: 4, sight: true, eyeHeight: 2.8 });
  if (!s) return;
  const act = pick(['distant_observer', 'corner_watch', 'ledge_watch', 'behind_cover', 'head_tilt']);
  let c = stageCreature(s, act, player.getHeadLocation());
  if (!c) return;
  scene.creature = c;
  markTerritory(s);
  let moves = 0;
  let unseen = 0;
  let headLockedAt = player.location;
  const end = now() + 90 * TPS;
  while (now() < end && c.isValid && player.isValid) {
    const head = add(s, { x: 0, y: 2.8, z: 0 });
    const seenNow = looksAt(player, head, 0.88);
    if (flat(player.location, s) < 10) {                   // it never lets you walk up to it
      sound(c.dimension, 'mob.brinesleeper.click', s, 0.8, 0.9);
      yield* slipAway(c, player);
      wetTrail(c.dimension, s, player.location);
      return;
    }
    if (seenNow) {
      unseen = 0;
      // the head that doesn't follow: it keeps facing where you were; after you move, a crack, and it snaps to you
      if (flat(player.location, headLockedAt) > 6) {
        sound(c.dimension, 'mob.brinesleeper.click', s, 0.9, rand(0.7, 0.85));
        try { c.teleport(s, { facingLocation: player.getHeadLocation() }); } catch (e) { /* ok */ }
        headLockedAt = player.location;
      }
    } else {
      unseen += 4;
      if (unseen > 3 * TPS) {
        // while nobody looks, it is somewhere else: closer, but never closer than 10 blocks, at most twice
        if (moves >= 2 || chance(0.35)) { removeQuietly(c); return; }
        const n = findSpot(player, 'floor', Math.max(11, flat(player.location, s) - 7), Math.max(14, flat(player.location, s) - 3),
          { room: 4, sight: true, eyeHeight: 2.8, tries: 16 });
        if (!n) { removeQuietly(c); return; }
        s = n;
        try { c.teleport(s, { facingLocation: player.getHeadLocation() }); } catch (e) { return; }
        setAct(c, pick(['distant_observer', 'corner_watch', 'patient_strike', 'head_tilt']));
        headLockedAt = player.location;
        moves++;
        unseen = 0;
      }
    }
    yield 4;
  }
  if (c.isValid) yield* slipAway(c, player);
}

// ---------- The Hidden Shoreline
function* sceneShoreline(player) {
  const s = findSpot(player, 'shore', 12, 24, { room: 3, sight: true, eyeHeight: 1.0 });
  if (!s) return;
  const c = stageCreature(s, 'shoreline_stalk', player.getHeadLocation());
  if (!c) return;
  scene.creature = c;
  markTerritory(s);
  const close = yield* waitUntil(() => !player.isValid || flat(player.location, s) < 8 ||
    looksAt(player, add(s, { x: 0, y: 1, z: 0 }), 0.95), 60 * TPS, 4);
  if (!c.isValid) return;
  // it slips into the water beside it
  let water;
  for (let dx = -2; dx <= 2 && !water; dx++) for (let dz = -2; dz <= 2 && !water; dz++) {
    water = waterSurface(c.dimension, Math.floor(s.x) + dx, Math.floor(s.y), Math.floor(s.z) + dz, 1, 3);
  }
  if (close) yield 8;
  if (water) {
    hold(c, waterPose(water, 'submerge'));
    particle(c.dimension, 'brine:splash', water);
    sound(c.dimension, 'brine.fx.surge', water, 0.8, 1.1);
    yield* sinkAway(c, water);
  } else {
    yield* slipAway(c, player);
  }
}

// ---------- The Two-Legged Revelation (rare)
function* sceneRevelation(player) {
  const s = findSpot(player, 'floor', 16, 26, { room: 5, sight: true, eyeHeight: 3.2 });
  if (!s) return;
  const c = stageCreature(s, 'hunting_stance', player.getHeadLocation());
  if (!c) return;
  scene.creature = c;
  markTerritory(s);
  const seen = yield* lookedAt(player, () => add(s, { x: 0, y: 1.5, z: 0 }), 10, 40 * TPS, 0.85);
  if (!c.isValid) return;
  if (!seen) { removeQuietly(c); return; }
  yield 20;
  setAct(c, 'full_stand');                                   // the controller blends 1.2 s: it rises, no snap
  sound(c.dimension, 'mob.brinesleeper.click', s, 1, 0.75);
  yield 30;
  sound(c.dimension, 'mob.brinesleeper.call', s, 0.9, 0.9);
  yield randInt(3, 5) * TPS;
  setAct(c, 'hunting_stance');                               // and drops back onto its hands
  yield 30;
  yield* slipAway(c, player);
}

// ---------- The Unfinished Crawl
function* sceneCrawl(player) {
  const s = findSpot(player, 'floor', 10, 20, { room: 2, sight: true, eyeHeight: 0.8 });
  if (!s) return;
  const c = stageCreature(s, 'tunnel_crawl', player.getHeadLocation());
  if (!c) return;
  scene.creature = c;
  const seen = yield* lookedAt(player, () => add(s, { x: 0, y: 0.8, z: 0 }), 12, 45 * TPS, 0.9);
  if (!c.isValid) return;
  if (seen) {
    sound(c.dimension, 'mob.brinesleeper.click', s, 0.6, 1.1);
    yield* waitUntil(() => !player.isValid || !looksAt(player, add(s, { x: 0, y: 0.8, z: 0 }), 0.85), 15 * TPS, 2);
  }
  if (c.isValid && player.isValid && !inSight(player, c.getHeadLocation())) removeQuietly(c);
  else if (c.isValid) yield* slipAway(c, player);
}

// ---------- The Hunt (+ The Drowning Grasp, + The False Retreat)
let grasp = null;
function* sceneHunt(player, second = false) {
  const w = watchOf(player);
  const s = findSpot(player, 'water', second ? 9 : 14, second ? 16 : 24,
    { depth: 2, eyeHeight: 0.4, behind: second ? 1.2 : undefined, sight: true });
  if (!s) return;
  const c = stageCreature(waterPose(s, 'water_rise'), 'water_rise', player.getHeadLocation());
  if (!c) return;
  scene.creature = c;
  markTerritory(s);
  // contact: it rises and is seen before anything happens (a fair warning, never an instant attack)
  sound(c.dimension, 'mob.brinesleeper.emerge', s, 1, 0.9);
  particle(c.dimension, 'brine:splash', s);
  for (let i = 0; i < 20; i++) { hold(c, waterPose(s, 'water_rise')); yield 2; }
  sound(c.dimension, 'mob.brinesleeper.roar', s, 1.2, 0.95);
  sting(player, 0.9);
  if (config.music) { try { player.playMusic('music.brine.chase', { loop: true, fade: 0.5, volume: 0.9 }); } catch (e) { /* ok */ } }
  setAct(c, 'none');
  setMode(c, 'hunt');
  const dur = (second ? randInt(5, 7) : randInt(10, 20)) * TPS;
  const end = now() + dur;
  let lastLunge = now(), bestDist = 999, stuck = 0, grasped = false;
  while (now() < end && c.isValid && player.isValid) {
    if (!huntable(player) || player.dimension.id !== c.dimension.id) break;
    const d = flat(player.location, c.location);
    if (d > 40) break;                                        // too far: an impossible pursuit is abandoned
    stuck = d < bestDist - 0.5 ? 0 : stuck + 4;
    bestDist = Math.min(bestDist, d);
    if (stuck > 6 * TPS && !inSight(player, c.getHeadLocation())) break;
    // the lunge: a long reaching strike, 7 damage, then a pause
    if (d > 2.4 && d < 5.5 && now() - lastLunge > randInt(80, 140) && inSight(player, c.getHeadLocation(), 8)) {
      lastLunge = now();
      try { c.playAnimation('animation.brinesleeper.lunge', { blendOutTime: 0.2 }); } catch (e) { /* ok */ }
      sound(c.dimension, 'mob.brinesleeper.lunge', c.location, 1, rand(0.95, 1.1));
      yield 7;
      if (c.isValid && player.isValid && flat(player.location, c.location) < 3.6 && preset().damage > 0) {
        player.applyDamage(Math.round(threat().lunge * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
        const k = norm(sub(player.location, c.location));
        try { player.applyKnockback({ x: k.x * 0.6, z: k.z * 0.6 }, 0.25); } catch (e) { /* ok */ }
      }
      continue;
    }
    // the drowning grasp: only in water, only once, only if the player has health to spare
    if (!grasped && config.grasp && preset().damage > 0 && player.isInWater && d < 2.6 && health(player) > 8) {
      grasped = true;
      yield* drowningGrasp(player, c);
      if (!c.isValid) return;
    }
    yield 4;
  }
  if (config.music) { try { player.stopMusic(); } catch (e) { /* ok */ } }
  if (!c.isValid) return;
  // withdrawal; sometimes a false retreat: it leaves, the water goes still, and it comes back once from behind
  setMode(c, 'withdraw');
  const falseRetreat = !second && w.tension > 60 && chance(0.35) && preset().hunt > 0;
  yield* waitUntil(() => !c.isValid || c.isInWater || (player.isValid && !inSight(player, c.getHeadLocation())), 15 * TPS, 4);
  if (c.isValid && c.isInWater) { setMode(c, 'hold'); yield* sinkAway(c, c.location); }
  else if (c.isValid) removeQuietly(c);
  wetTrail(player.dimension, s, player.location);
  if (falseRetreat && player.isValid) {
    silence = { x: player.location.x, z: player.location.z, until: now() + 10 * TPS };
    yield randInt(8, 14) * TPS;
    if (player.isValid && huntable(player)) yield* sceneHunt(player, true);
  }
}
function health(p) {
  try { return p.getComponent('minecraft:health')?.currentValue ?? 20; } catch (e) { return 20; }
}
function* drowningGrasp(player, c) {
  debug('drowning grasp');
  grasp = { playerId: player.id, until: now() + 2 * TPS, broken: false };
  try { c.playAnimation('animation.brinesleeper.grasp'); } catch (e) { /* ok */ }
  sound(c.dimension, 'mob.brinesleeper.grasp', player.location, 1, 1);
  let hurt = false;
  while (now() < grasp.until && !grasp.broken && player.isValid && c.isValid) {
    const k = norm(sub(c.location, player.location));
    try { player.applyKnockback({ x: k.x * 0.08, z: k.z * 0.08 }, -0.28); } catch (e) { /* ok */ }
    player.addEffect('slowness', 20, { amplifier: 2, showParticles: false });
    particle(player.dimension, 'brine:bubbles', player.location);
    if (!hurt && now() > grasp.until - 30) {
      hurt = true;
      player.applyDamage(Math.round(threat().grasp * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
    }
    if (player.isJumping && chance(0.25)) grasp.broken = true;   // kicking upward can break the hold
    yield 4;
  }
  grasp = null;
  if (c.isValid && player.isValid) {
    const k = norm(sub(c.location, player.location));
    try { c.applyKnockback({ x: k.x * 1.2, z: k.z * 1.2 }, 0.1); } catch (e) { /* ok */ }
  }
}
const huntable = (p) => { try { const m = p.getGameMode(); return m === GameMode.Survival || m === GameMode.Adventure; } catch (e) { return false; } };

// ------------------------------------------------------------------ minor events (one per player at a time, cheap)
/** The Third Splash: two splashes of your own, then a third that isn't */
function* minorThirdSplash(player) {
  yield randInt(30, 60);
  const s = findSpot(player, 'water', 8, 16, { behind: 1.4, eyeHeight: 0.2 }) ?? findSpot(player, 'water', 8, 18, { eyeHeight: 0.2 });
  if (!s) return;
  sound(player.dimension, 'brine.fx.splash_far', s, 1.4, rand(0.85, 1));
  particle(player.dimension, 'brine:splash', s);
  yield 10;
  particle(player.dimension, 'brine:ripple', s);
}
/** The Stolen Wake: after you leave the water, the wake you made keeps moving behind you */
function* minorStolenWake(player, trail) {
  yield 50;
  for (const t of trail) {
    if (!player.isValid) return;
    particle(player.dimension, 'brine:ripple', t);
    if (chance(0.3)) sound(player.dimension, 'brine.fx.ripple', t, 0.5, rand(0.8, 1));
    yield 5;
  }
}
/** The Last Safe Step: the water surges where you climbed out, a moment after you did */
function* minorLastSafeStep(player, exit) {
  yield 22;
  sound(player.dimension, 'brine.fx.surge', exit, 0.9, rand(0.85, 1));
  particle(player.dimension, 'brine:splash', exit);
  yield 6;
  particle(player.dimension, 'brine:bubbles', exit);
}
/** The Dryland Imitation: your footsteps, a few blocks behind you, half a second late; one extra when you stop */
function* minorImitation(player) {
  let steps = randInt(6, 10), last = player.location, extra = true;
  const end = now() + 30 * TPS;
  while (steps > 0 && now() < end && player.isValid) {
    yield 9;
    const moved = flat(player.location, last) > 0.8;
    last = player.location;
    const behind = sub(player.location, mul(norm({ x: player.getViewDirection().x, y: 0, z: player.getViewDirection().z }), rand(5, 7)));
    if (moved) { sound(player.dimension, 'mob.brinesleeper.step', behind, 0.45, rand(0.8, 0.9)); steps--; }
    else if (extra) { sound(player.dimension, 'mob.brinesleeper.step', behind, 0.5, 0.78); extra = false; yield 30; return; }
  }
}
/** The Silent Water Event: the add-on's own sounds stop; then a single deep splash behind you */
function* minorSilentWater(player) {
  silence = { x: player.location.x, z: player.location.z, until: now() + randInt(8, 12) * TPS };
  yield* waitUntil(() => now() >= silence.until, 14 * TPS, 10);
  const s = findSpot(player, 'water', 6, 10, { behind: 1.0, eyeHeight: 0.2 });
  if (s) { sound(player.dimension, 'brine.fx.splash_far', s, 1, 0.7); particle(player.dimension, 'brine:ripple', s); }
}
/** The Reverse Wake: a wake crossing the water toward you, stopping just short */
function* minorReverseWake(player) {
  const s = findSpot(player, 'water', 18, 24, { ahead: 0.5, allowView: true, eyeHeight: 0.2 });
  if (!s) return;
  const target = player.location;
  for (let i = 0; i <= 14; i++) {
    const p = add(s, mul(sub(target, s), (i / 14) * (1 - 3 / Math.max(flat(s, target), 3))));
    const q = waterSurface(player.dimension, Math.floor(p.x), Math.floor(s.y - 1), Math.floor(p.z), 1, 1);
    if (!q) break;
    particle(player.dimension, 'brine:ripple', q);
    if (i % 4 === 0) sound(player.dimension, 'brine.fx.ripple', q, 0.5, 0.9);
    yield 6;
  }
  yield 10;
}
/** The False Reflection: under the surface in front of you, a shape that is not yours */
function* minorFalseReflection(player) {
  const s = findSpot(player, 'water', 2, 5, { ahead: 0.5, allowView: true, depth: 2, eyeHeight: 0 });
  if (!s) return;
  const shade = spawnShade(s, FORM.reflection, pick(['full_stand', 'distant_observer', 'head_tilt']), player.getHeadLocation());
  if (!shade) return;
  const seen = yield* lookedAt(player, () => add(s, { x: 0, y: -1.5, z: 0 }), 20, randInt(50, 80), 0.94);
  if (seen) yield 6;
  particle(player.dimension, 'brine:ripple', s);
  removeQuietly(shade);
}
/** The Watching Hand: a hand comes up out of the water, holds, and goes back down */
function* minorWatchingHand(player) {
  const s = findSpot(player, 'water', 5, 10, { depth: 3, sight: true, eyeHeight: 0.5 });
  if (!s) return;
  let y = s.y + 0.4;
  const shade = spawnShade({ x: s.x, y, z: s.z }, FORM.hand, 'full_stand', player.getHeadLocation());
  if (!shade) return;
  particle(player.dimension, 'brine:ripple', s);
  for (let i = 0; i < 30; i++) { y += 0.05; try { shade.teleport({ x: s.x, y, z: s.z }); } catch (e) { return; } yield 1; }
  yield* lookedAt(player, () => add(s, { x: 0, y: 1, z: 0 }), 30, 4 * TPS, 0.95);
  for (let i = 0; i < 30; i++) { y -= 0.05; try { shade.teleport({ x: s.x, y, z: s.z }); } catch (e) { return; } yield 1; }
  particle(player.dimension, 'brine:ripple', s);
  removeQuietly(shade);
}
/** The Standing Silhouette: a tall shape at the edge of the light, gone when you look properly or come closer */
function* minorSilhouette(player) {
  const s = findSpot(player, 'floor', 16, 30, { room: 4, sight: true, eyeHeight: 3.0 });
  if (!s) return;
  const shade = spawnShade(s, FORM.silhouette, pick(['full_stand', 'shadow_hide', 'head_tilt']), player.getHeadLocation());
  if (!shade) return;
  let stare = 0;
  yield* waitUntil(() => {
    stare = player.isValid && looksAt(player, add(s, { x: 0, y: 2.5, z: 0 }), 0.96) ? stare + 4 : 0;
    return !player.isValid || flat(player.location, s) < 16 || stare >= 30;
  }, 40 * TPS, 4);
  removeQuietly(shade);
}
/** The Empty Pool: a pool you swam in is disturbed; bubbles, and wet drips leading out of it */
function* minorEmptyPool(player) {
  const w = watchOf(player);
  const m = w.memories.find((q) => flat(q, player.location) > 10 && flat(q, player.location) < 30);
  if (!m) return;
  const s = waterSurface(player.dimension, Math.floor(m.x), Math.floor(m.y), Math.floor(m.z));
  if (!s) return;
  for (let i = 0; i < 6; i++) { particle(player.dimension, 'brine:bubbles', s); yield 8; }
  const out = findSpot(player, 'floor', 4, 10, { allowView: true, room: 3 });
  if (out) wetTrail(player.dimension, s, out);
  sound(player.dimension, 'brine.fx.drip', s, 0.6, 0.9);
}
/** Breath on the Water: stand still at the edge long enough and something breathes out beside you */
function* minorBreath(player) {
  const s = findSpot(player, 'water', 1, 3, { allowView: true, eyeHeight: 0 });
  if (!s) return;
  for (let i = 0; i < 3; i++) { particle(player.dimension, 'brine:bubbles', s); yield 6; }
  sound(player.dimension, 'brine.fx.bubbles', s, 0.7, 0.8);
}
/** The Final Reflection: leaving, you look back, and it is standing under the water where you were */
function* minorFinalReflection(player, at) {
  const s = waterSurface(player.dimension, Math.floor(at.x), Math.floor(at.y), Math.floor(at.z), 3, 6);
  if (!s) return;
  const shade = spawnShade(s, FORM.reflection, 'full_stand', player.getHeadLocation());
  if (!shade) return;
  yield* lookedAt(player, () => add(s, { x: 0, y: -1.5, z: 0 }), 16, 10 * TPS, 0.9);
  yield 10;
  removeQuietly(shade);
}

/** A Lure: from the water, a sound that should not be down here (something has learned what brings you closer) */
function* minorLure(player) {
  if (!config.lures) return;
  const s = findSpot(player, 'water', 12, 24, { eyeHeight: 0.4 }) ?? findSpot(player, 'floor', 12, 24, { room: 2 });
  if (!s) return;
  const lure = pick([['game.player.hurt', 0.7], ['mob.villager.idle', 0.7], ['mob.cat.meow', 0.6], ['random.splash', 0.9]]);
  sound(player.dimension, lure[0], s, 0.9, lure[1]);
  yield randInt(30, 60);
  if (chance(0.5)) sound(player.dimension, lure[0], s, 0.7, lure[1] * 0.9);
  yield 20;
  particle(player.dimension, 'brine:ripple', s);
}
/** Knocking: three knocks on the stone, from somewhere in the dark */
function* minorKnocking(player) {
  const s = findSpot(player, 'floor', 8, 16, { room: 2, allowView: true });
  if (!s) return;
  sound(player.dimension, 'brine.fx.knock', add(s, { x: 0, y: 1, z: 0 }), 1, rand(0.8, 1));
  yield 60;
  if (chance(0.35)) sound(player.dimension, 'brine.fx.knock', add(s, { x: 0, y: 1, z: 0 }), 0.8, 0.7);
}
const MINORS = {
  lure: (p) => minorLure(p),
  knocking: (p) => minorKnocking(p),
  third_splash: (p) => minorThirdSplash(p),
  silent_water: (p) => minorSilentWater(p),
  reverse_wake: (p) => minorReverseWake(p),
  false_reflection: (p) => minorFalseReflection(p),
  watching_hand: (p) => minorWatchingHand(p),
  standing_silhouette: (p) => minorSilhouette(p),
  empty_pool: (p) => minorEmptyPool(p),
  breath_on_the_water: (p) => minorBreath(p),
  dryland_imitation: (p) => minorImitation(p),
};
const MAJORS = {
  waterline_deception: sceneWaterline,
  unfinished_emergence: sceneEmergence,
  stationary_predator: sceneObserver,
  hidden_shoreline: sceneShoreline,
  two_legged_revelation: sceneRevelation,
  unfinished_crawl: sceneCrawl,
  hunt: sceneHunt,
};

function startMinor(player, name, gen) {
  const w = watchOf(player);
  w.minor = gen;
  w.minorName = name;
  w.minorWake = now();
  debug(`minor ${name} for ${player.name}`);
}

// ------------------------------------------------------------------ the director
/** @param {[string, number][]} options */
function weighted(options) {
  const total = options.reduce((a, o) => a + o[1], 0);
  let r = Math.random() * total;
  for (const [name, k] of options) { r -= k; if (r <= 0) return name; }
  return options[0][0];
}
function chooseMinor(player, w) {
  const water = nearWater(player.dimension, player.location, 6);
  /** @type {[string, number][]} */
  const options = [];
  if (water) options.push(['false_reflection', 3], ['watching_hand', 3], ['reverse_wake', 2], ['breath_on_the_water', 1], ['silent_water', 1], ['lure', 2]);
  else options.push(['dryland_imitation', 3], ['standing_silhouette', 3], ['silent_water', 1], ['knocking', 2], ['lure', 1]);
  if (w.memories.length) options.push(['empty_pool', 1]);
  return weighted(options);
}
function chooseMajor(player, w) {
  const P = preset();
  // the first sighting is only ever a sighting; a hunt needs built-up tension and the preset's say-so
  if (w.majors > 0 && P.hunt > 0 && w.tension >= 70 && huntable(player) && chance(P.hunt)) return 'hunt';
  if (w.majors > 0 && chance(P.revelation)) return 'two_legged_revelation';
  const water = nearWater(player.dimension, player.location, 8);
  /** @type {[string, number][]} */
  const options = water
    ? [['waterline_deception', 4], ['unfinished_emergence', 3], ['hidden_shoreline', 2], ['stationary_predator', 2]]
    : [['stationary_predator', 4], ['unfinished_crawl', 2], ['hidden_shoreline', 1], ['waterline_deception', 1]];
  return weighted(options);
}

function tickPlayer(player) {
  const w = watchOf(player);
  const dim = player.dimension;
  const here = inBiome(dim, player.location);
  const t = now();
  // leaving the biome: maybe the final reflection, once per visit
  if (w.inBiome && !here) {
    if (!w.finalDone && w.visitSeconds > 60 && config.enabled && !w.minor && chance(0.6)) {
      w.finalDone = true;
      startMinor(player, 'final_reflection', minorFinalReflection(player, w.lastPos));
    }
    w.visitSeconds = 0;
  }
  if (!w.inBiome && here) w.finalDone = false;
  w.inBiome = here;
  const moved = flat(player.location, w.lastPos);
  w.stillTicks = moved < 0.2 ? w.stillTicks + 10 : 0;
  if (here) w.lastPos = player.location;
  if (!here) { w.tension = Math.max(0, w.tension - 0.5); return; }

  w.biomeSeconds += 0.5;
  w.visitSeconds += 0.5;
  const territory = inTerritory(player.location) ? 1.5 : 1;
  w.tension = Math.min(100, w.tension + 0.25 * territory + (player.isSprinting ? 0.5 : 0) + (player.isSwimming ? 0.5 : 0));

  // the water remembers; splashes are counted; swims leave a wake to steal
  const inWater = player.isInWater;
  if (inWater) {
    w.remember(player.location);
    w.swimTicks += 10;
    if (w.swimTrail.length === 0 || flat(w.swimTrail[w.swimTrail.length - 1], player.location) > 1.5) {
      const s = waterSurface(dim, Math.floor(player.location.x), Math.floor(player.location.y), Math.floor(player.location.z), 2, 2);
      if (s) w.swimTrail.push(s);
      if (w.swimTrail.length > 16) w.swimTrail.shift();
    }
  } else if (nearWater(dim, player.location, 1)) {
    w.remember(player.location);
  }
  if (inWater && !w.wasInWater) {
    w.entries = w.entries.filter((e) => t - e < 25 * TPS);
    w.entries.push(t);
    w.tension = Math.min(100, w.tension + 2);
    if (w.entries.length === 2 && w.biomeSeconds > w.firstQuiet && !w.minor && config.enabled && chance(0.6)) {
      startMinor(player, 'third_splash', minorThirdSplash(player));
    }
  }
  if (!inWater && w.wasInWater) {
    const exit = add(w.lastPos, { x: 0, y: 0, z: 0 });
    const swam = w.swimTicks;
    const trail = w.swimTrail.slice();
    w.swimTicks = 0;
    w.swimTrail = [];
    if (config.enabled && !w.minor && w.biomeSeconds > w.firstQuiet && swam > 4 * TPS) {
      if (chance(0.3)) startMinor(player, 'stolen_wake', minorStolenWake(player, trail));
      else if (chance(0.3)) startMinor(player, 'last_safe_step', minorLastSafeStep(player, exit));
    }
  }
  w.wasInWater = inWater;
  if (t % (30 * TPS) < 10) w.save(player);

  if (!config.enabled || t < w.protectUntil) return;
  try { if (player.getGameMode() === GameMode.Spectator) return; } catch (e) { return; }
  const quietOver = w.biomeSeconds > w.firstQuiet;
  if (!quietOver) return;
  // breath on the water: standing still at the edge
  if (!w.minor && w.stillTicks > 6 * TPS && nearWater(dim, player.location, 2) && chance(0.04)) {
    startMinor(player, 'breath_on_the_water', minorBreath(player));
    w.stillTicks = 0;
  }
  const f = freq() * (inTerritory(player.location) ? 1.6 : 1);
  if (!w.minor && t >= w.nextMinor) {
    const name = chooseMinor(player, w);
    startMinor(player, name, MINORS[name](player));
    w.nextMinor = t + Math.round((randInt(...preset().minor) * TPS) / f);
    w.tension = Math.max(0, w.tension - 8);
  }
  // first sighting at 8-15 minutes in the caves; then a long cooldown between major encounters
  if (!scene && t >= w.nextMajor && w.biomeSeconds > w.firstQuiet + 30 && !freeCreatureNear(player)) {
    const name = chooseMajor(player, w);
    startScene(name, player, MAJORS[name](player));
    w.majors++;
    w.nextMajor = t + Math.round((randInt(...preset().major) * TPS) / freq());
    w.tension = Math.max(0, w.tension - (name === 'hunt' ? 60 : 25));
  }
}

function stepGenerators() {
  if (scene) {
    const pl = playerById(scene.playerId);
    if (!pl) endScene('player left');
    else if (now() >= scene.wake) {
      let r;
      try { r = scene.gen.next(); } catch (e) { console.warn(`[brine] scene ${scene.name}: ${e}`); r = { done: true }; }
      if (r.done) endScene('done');
      else scene.wake = now() + Math.max(1, r.value ?? 1);
    }
  }
  for (const [id, w] of watches) {
    if (!w.minor || now() < (w.minorWake ?? 0)) continue;
    const pl = playerById(id);
    let r = { done: true };
    if (pl) {
      try { r = w.minor.next(); } catch (e) { console.warn(`[brine] minor ${w.minorName}: ${e}`); r = { done: true }; }
    }
    if (r.done) w.minor = null;
    else w.minorWake = now() + Math.max(1, r.value ?? 1);
  }
}

function tickDirector() {
  for (const p of world.getAllPlayers()) {
    try { tickPlayer(p); } catch (e) { console.warn(`[brine] ${e}`); }
  }
  // withdrawing creatures that were left in sight: remove them once they are in the water or out of view
  for (const c of creatures()) {
    if (!pendingWithdraw.has(c.id)) continue;
    const seen = world.getAllPlayers().some((p) => inSight(p, c.getHeadLocation(), 64));
    if (!seen || c.isInWater) { pendingWithdraw.delete(c.id); removeQuietly(c); }
  }
  for (let i = territories.length - 1; i >= 0; i--) if (territories[i].until < now()) territories.splice(i, 1);
}

// ------------------------------------------------------------------ world events
world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
  if (entity.typeId !== CREATURE || cause !== EntityInitializationCause.Spawned) return;
  system.run(() => {
    if (!entity.isValid) return;
    entity.triggerEvent(`brine:threat_${config.threat}`);
    if (entity.hasTag(STAGED)) return;
    // natural spawns never happen within 24 blocks of a player, so a creature this close was summoned or hatched from an egg
    const summoned = world.getAllPlayers().some((p) => p.dimension.id === entity.dimension.id && flat(p.location, entity.location) < 20);
    if (summoned) return;
    // one real Brinesleeper per world: a natural spawn while another exists is undone
    if (creatures().filter((c) => c.id !== entity.id).length > 0) removeQuietly(entity);
  });
});

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  if (hurtEntity.typeId !== CREATURE) return;
  const attacker = damageSource.damagingEntity;
  if (!attacker || attacker.typeId !== 'minecraft:player') return;
  if (grasp && grasp.playerId === attacker.id) grasp.broken = true;   // hit it and it lets go
  const w = watches.get(attacker.id);
  if (w) w.tension = Math.min(100, w.tension + 10);
  // a held creature that is struck flinches away into the water; it is not automatically provoked into a chase
  if (scene && scene.creature && scene.creature.id === hurtEntity.id && scene.name !== 'hunt') {
    const pl = playerById(attacker.id);
    if (pl && preset().hunt > 0 && w && w.tension > 80 && chance(0.4)) startScene('hunt', pl, sceneHunt(pl, true));
    else endScene('struck');
  }
});

world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
  if (deadEntity.typeId === CREATURE) {
    if (scene && scene.creature && scene.creature.id === deadEntity.id) scene = null;
    for (const w of watches.values()) { w.tension = 20; w.nextMajor = now() + 20 * 60 * TPS; }
    return;
  }
  if (deadEntity.typeId === 'minecraft:player') {
    if (scene && scene.playerId === deadEntity.id) endScene('player died');
    const w = watches.get(deadEntity.id);
    if (w) { w.minor = null; w.tension = Math.max(0, w.tension - 40); }
  }
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  const w = watchOf(player);
  if (!initialSpawn) w.protectUntil = now() + 120 * TPS;     // respawn protection: two quiet minutes
});

world.beforeEvents.playerLeave.subscribe(({ player }) => {
  const id = player.id;
  system.run(() => {
    if (scene && scene.playerId === id) endScene('player left');
    watches.delete(id);
  });
});

world.afterEvents.playerDimensionChange.subscribe(({ player }) => {
  if (scene && scene.playerId === player.id) endScene('dimension change');
  const w = watches.get(player.id);
  if (w) { w.minor = null; w.inBiome = false; }
});

// The Wrong Echo: noise you make comes back from across the water, a little lower
function wrongEcho(player) {
  const w = watchOf(player);
  w.tension = Math.min(100, w.tension + 3);
  if (!config.enabled || !w.inBiome || now() - w.lastEcho < 60 * TPS || w.biomeSeconds < w.firstQuiet || !chance(0.35)) return;
  w.lastEcho = now();
  system.runTimeout(() => {
    if (!player.isValid) return;
    const s = findSpot(player, 'water', 16, 30, { allowView: true, eyeHeight: 0.2 }) ?? findSpot(player, 'floor', 16, 30, { allowView: true });
    if (s) sound(player.dimension, 'mob.brinesleeper.step', s, 0.8, 0.6);
  }, randInt(25, 40));
}
world.afterEvents.playerBreakBlock.subscribe(({ player }) => wrongEcho(player));
world.afterEvents.playerPlaceBlock.subscribe(({ player }) => wrongEcho(player));

// ------------------------------------------------------------------ test hooks used by the settings menu and commands (menu.js)
function forceEvent(player, name) {
  if (MINORS[name]) { startMinor(player, name, MINORS[name](player)); return true; }
  if (MAJORS[name]) {
    if (scene) endScene('replaced');
    startScene(name, player, MAJORS[name](player));
    return true;
  }
  if (name === 'stolen_wake') { startMinor(player, name, minorStolenWake(player, watchOf(player).swimTrail.slice())); return true; }
  if (name === 'last_safe_step') { startMinor(player, name, minorLastSafeStep(player, player.location)); return true; }
  if (name === 'final_reflection') { startMinor(player, name, minorFinalReflection(player, player.location)); return true; }
  return false;
}
const EVENT_NAMES = [...Object.keys(MINORS), ...Object.keys(MAJORS), 'stolen_wake', 'last_safe_step', 'final_reflection'];

function statusText(player) {
  const w = watches.get(player.id);
  if (!w) return 'No record yet.';
  return `in caves ${w.inBiome}, ${Math.round(w.biomeSeconds)} s there (quiet until ${w.firstQuiet} s), tension ${Math.round(w.tension)}, ` +
    `next minor ${Math.max(0, Math.round((w.nextMinor - now()) / TPS))} s, next major ${Math.max(0, Math.round((w.nextMajor - now()) / TPS))} s, ` +
    `memories ${w.memories.length}, scene ${scene ? scene.name : 'none'}, preset ${PRESETS[config.preset].label}`;
}

// ------------------------------------------------------------------ start
world.afterEvents.worldLoad.subscribe(() => {
  loadConfig();
  // a reload ends every staged moment: remove staged creatures and every apparition (natural creatures stay)
  try {
    for (const e of overworld().getEntities({ tags: [STAGED] })) removeQuietly(e);
    for (const e of overworld().getEntities({ type: SHADE })) removeQuietly(e);
  } catch (e) { /* nothing loaded yet */ }
  system.runInterval(tickDirector, 10);
  system.runInterval(stepGenerators, 1);
});

export {
  CREATURE, SHADE, BIOME, STAGED, TPS, ACT, FORM, WATER_DEPTH, EVENT_NAMES,
  rand, randInt, chance, pick, now, sub, add, mul, len, flat, norm, dot, floorV,
  debug, block, isWater, isOpen, isSolid, inBiome, clearLine, looksAt, inSight, sound, particle, silenced,
  waterSurface, floorAt, nearWater, findSpot, creatures, setMode, setAct, removeQuietly, spawnShade, overworld,
  watchOf, huntable, health, sting, forceEvent, statusText, wetTrail,
};
