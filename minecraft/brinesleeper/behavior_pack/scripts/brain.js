// The Brinesleeper's mind and body. There is only ever one; this is what it does, wherever it is.
//
// Its body (since 6.0) is moved by this script, every tick, never by the game's pathfinder (which wedged a 4-block
// creature under ledges and left it standing on top of blocks, swimming in the air):
//   * on land it walks YOUR trail: every place you stood is remembered with the headroom above it, so it goes exactly
//     where you went, crawling (tunnel crawl, a hitbox 1.6 blocks high) only where the roof is low, and cutting
//     straight at you when the ground between is clear
//   * in the water it swims (teleported through water only), crosses to your bank, rises and hauls itself out
//   * every animation comes from what the body is doing at that moment (animate): it never runs, swims or crawls on
//     the spot. When it cannot go somewhere it does not try: it waits in a pose, and moves when nobody is looking
//
// The cycle, Cave Dweller style, in and out of the water:
//   watch    far off, it lets itself be seen (submerged watch, idle in water, ceiling lurk, ledge watch, corner watch,
//            behind cover, veil stalk, reflection lurk, shadow hide, distant observer, head tilt, full stand).
//            Look long enough, or come close, and it is gone.
//   stalk    it follows your trail (crouch stalk, shoreline stalk, tunnel crawl, slow approach once it is bold). It
//            only moves while you are not looking; when you stop, it takes one more step than you, then stops too.
//   standoff it stands and stares (hunting stance, head tilt, patient strike, full stand), and may walk at you.
//   chase    it runs (run), strikes at arm's length, lunges from further (lunge); in the water it grabs (grasp).
//   retreat  it turns away (retreat), runs back the way it came and is gone (submerge, smoke, wet tracks).
//   water    it lurks deep (swim), rises in front of you (water rise), climbs out (emerge), bursts out (emerge roar).
//
// It learns each player (saved on the player): looking back, carrying light, running, swimming, fighting, where you
// sleep. It grows bolder with every meeting; then it follows you out of its caves, and at last it comes to your home.
import { world, system, BlockVolume, ItemStack, GameMode, EntityDamageCause, EasingType } from '@minecraft/server';
import { config, preset, threat, freq } from './config.js';
import {
  CREATURE, STAGED, TPS, FORM, rand, randInt, chance, pick, now, sub, add, mul, flat, norm, len,
  block, isWater, isSolid, isOpen, looksAt, inSight, sound, particle, waterSurface, floorAt, nearWater, findSpot,
  creatures, setMode, setAct, removeQuietly, spawnShade, overworld, health, debug, wetTrail,
} from './main.js';
import { inStillwater, press, handoff } from './areas.js';
import { addEntry } from './notebook.js';
import { findPath, standable, cellAt } from './path.js';

const S = 1.15;                                                     // the model's scale (horror.py SCALE)
const DEPTH = { submerged_watch: 2.06 * S, idle_water: 2.06 * S, water_rise: 0.5 * S, emerge_roar: 0.375 * S, emerge: 0.25 * S };
const CEILING_DROP = 4.6;                                           // ceiling_lurk hangs its body this far above its root
const LURK_DEPTH = 3.8;
const STAND = 4;                                                    // blocks of headroom it needs to stand (3.91 tall)
const SPEED = { stalk: 0.12, slow: 0.05, walk: 0.08, run: 0.34 };   // blocks per tick (x the threat level's speed)
const minds = new Map();
const LIGHTS_CANDLE = ['minecraft:candle', ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray',
  'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => `minecraft:${c}_candle`)];
const LIGHTS_ITEM = { 'minecraft:torch': 'minecraft:torch', 'minecraft:soul_torch': 'minecraft:soul_torch',
  'minecraft:lantern': 'minecraft:lantern', 'minecraft:soul_lantern': 'minecraft:soul_lantern' };
const LIGHTS_FIRE = ['minecraft:campfire', 'minecraft:soul_campfire'];
const WHISPERS = ['...the water remembers you...', "...don't look down...", '...you are so close to the edge...', "...it's warmer under the water...",
  '...we heard you splash...', '...stay a while...', '...it saw you first...', '...something is under you...', '...keep swimming...',
  '...it walks where you walked...', '...one more step than yours...', '...don\'t turn around...', '...it is closer than it was...',
  '...it learned your name...', '...look up...'];

const hunter = (p) => { try { const m = p.getGameMode(); return m === GameMode.Survival || m === GameMode.Adventure; } catch (e) { return false; } };
const watcher = (p) => { try { return p.getGameMode() !== GameMode.Spectator; } catch (e) { return false; } };
// someone has it on screen (roughly the field of view, nothing in the way): it never moves itself then
const seenByAnyone = (c) => world.getAllPlayers().some((p) => p.dimension.id === c.dimension.id &&
  (looksAt(p, c.getHeadLocation(), 0.5, 96) || looksAt(p, add(c.location, { x: 0, y: 0.5, z: 0 }), 0.5, 96)));
const playerById = (id) => world.getAllPlayers().find((p) => p.id === id);
const gap = () => Math.round(randInt(...preset().stalkGap) * TPS / freq());
const dark = (dim, pos) => { try { return dim.getLightLevel(pos) <= 4; } catch (e) { return false; } };
const spot = (player, kind, minD, maxD, opts = {}) => findSpot(player, kind, minD, maxD, { anywhere: true, ...opts });
/** a point `d` below a water surface, never deeper than the water is (so it is never put inside the lake bed) */
const under = (s, d) => ({ x: s.x, y: s.y - Math.min(d, Math.max(0.6, s.depth - 0.25)), z: s.z });
/** in the water (or at its surface, which the game does not always count) */
function inWater(c) {
  if (c.isInWater) return true;
  const l = c.location;
  return isWater(block(c.dimension, { x: l.x, y: l.y + 0.2, z: l.z })) || isWater(block(c.dimension, { x: l.x, y: l.y - 0.4, z: l.z }));
}
/** under the ground or out at night: where it is willing to go after you */
function itsHour(p) {
  try {
    if (p.dimension.getSkyLightLevel(p.getHeadLocation()) <= 6) return true;
  } catch (e) { /* unloaded */ }
  const tod = world.getTimeOfDay();
  return tod > 13000 && tod < 23000;
}

// ------------------------------------------------------------------ the blocks around it (read once per tick)
const cells = new Map();
let cellsTick = -1;
/** 0 = solid, 1 = open (air, plants, vines...), 2 = water */
function cell(dim, x, y, z) {
  const t = now();
  if (t !== cellsTick) { cells.clear(); cellsTick = t; }
  const k = `${x},${y},${z}`;
  let v = cells.get(k);
  if (v === undefined) {
    const b = block(dim, { x, y, z });
    v = !b ? 0 : isWater(b) ? 2 : isOpen(b) ? 1 : 0;
    cells.set(k, v);
  }
  return v;
}
/** blocks of room above a place you could stand (water counts as room), up to 5 */
function headroom(dim, x, y, z) {
  const bx = Math.floor(x), bz = Math.floor(z), by = Math.floor(y + 0.5);
  let n = 0;
  while (n < 5 && cell(dim, bx, by + n, bz) !== 0) n++;
  return n;
}

// ------------------------------------------------------------------ trails: where each player has walked
const trails = new Map();                                           // player id -> { dim, pts: [{x, y, z, c, w, gap}] }
const TRAIL_MAX = 360;
function recordTrails() {
  for (const p of world.getAllPlayers()) {
    let tr = trails.get(p.id);
    if (!tr || tr.dim !== p.dimension.id) { tr = { dim: p.dimension.id, pts: [] }; trails.set(p.id, tr); }
    let grounded = false;
    try { grounded = p.isOnGround || p.isInWater || p.isClimbing; } catch (e) { grounded = false; }
    if (!grounded) continue;
    const l = p.location;
    const last = tr.pts[tr.pts.length - 1];
    if (last && Math.hypot(l.x - last.x, l.y - last.y, l.z - last.z) < 0.7) continue;
    const c = headroom(p.dimension, l.x, l.y, l.z);
    if (c < 2) continue;
    const jump = !!last && (flat(l, last) > 4 || Math.abs(l.y - last.y) > 3.5);     // a teleport or a fall: not walkable
    tr.pts.push({ x: l.x, y: l.y, z: l.z, c, w: !!p.isInWater, gap: jump });
    if (tr.pts.length > TRAIL_MAX) tr.pts.shift();
  }
}
/** the trail point nearest to a place (and close to it), or -1 */
function nearestTrail(tr, pos, maxD = 2.5) {
  let best = -1, bd = maxD;
  for (let i = tr.pts.length - 1; i >= 0; i--) {
    const q = tr.pts[i];
    const d = flat(q, pos);
    if (d < bd && Math.abs(q.y - pos.y) < 2.5) { bd = d; best = i; }
  }
  return best;
}
/** the trail from point i toward its owner (dir 1) or back the way they came (dir -1), up to the first break.
 * Where it goes from land into the water (or back out) it steps out over the water first and then drops (or rises
 * straight up first and then steps onto the bank), so its body never cuts through the edge of the bank */
function trailFrom(tr, i, dir) {
  const raw = [];
  if (dir > 0) {
    for (let k = i + 1; k < tr.pts.length; k++) { if (tr.pts[k].gap) break; raw.push(tr.pts[k]); }
  } else {
    for (let k = i - 1; k >= 0; k--) { if (tr.pts[k + 1].gap) break; raw.push(tr.pts[k]); }
  }
  const out = [];
  for (let k = 0; k < raw.length; k++) {
    const a = k === 0 ? tr.pts[i] : raw[k - 1], b = raw[k];
    if (a && a.w !== b.w && Math.abs(a.y - b.y) > 0.5) {
      const wet = a.w ? a : b, dry = a.w ? b : a;
      out.push({ x: wet.x, y: dry.y, z: wet.z, c: Math.max(wet.c, 2), w: false, gap: false });
    }
    out.push(b);
  }
  return out;
}
/** where it can stand in this column, close to height y: a step up, level, or a drop of up to three */
function standY(dim, x, y, z) {
  for (const dy of [0, 1, -1, -2, -3]) {
    const yy = y + dy;
    if (cell(dim, x, yy - 1, z) === 0 && cell(dim, x, yy, z) !== 0 && cell(dim, x, yy + 1, z) !== 0) return yy;
  }
  return undefined;
}
/** a straight walk over the ground from one place to another, or undefined if the ground does not allow it */
function linePath(dim, from, to, maxLen = 18) {
  const d = flat(from, to);
  if (d > maxLen || d < 0.3) return undefined;
  const steps = Math.max(1, Math.ceil(d / 0.2));
  const pts = [];
  let y = Math.floor(from.y + 0.5);
  let key = '', c = 0, w = false;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps, z = from.z + (to.z - from.z) * i / steps;
    const bx = Math.floor(x), bz = Math.floor(z);
    const k = `${bx},${bz}`;
    if (k !== key) {
      const yy = standY(dim, bx, y, bz);
      if (yy === undefined) return undefined;
      y = yy;
      key = k;
      c = headroom(dim, x, y, z);
      w = cell(dim, bx, y, bz) === 2;
    }
    if (i % 2 === 0 || i === steps) pts.push({ x, y, z, c, w, gap: false, floor: true });   // feet on the ground (even on a lake bed)
  }
  return pts;
}
/** a way to the player on foot: straight at them when the ground allows, else along their own trail */
function routeTo(c, target, direct = 16) {
  const dim = c.dimension;
  if (flat(c.location, target.location) < direct) {
    const line = linePath(dim, c.location, target.location, direct + 2);
    if (line) return line;
  }
  const tr = trails.get(target.id);
  if (!tr || tr.dim !== dim.id || !tr.pts.length) return undefined;
  const i = nearestTrail(tr, c.location);
  if (i >= 0) return trailFrom(tr, i, 1);
  let best;                                                          // off the trail: walk to it first
  for (let k = tr.pts.length - 1; k >= 0; k--) {
    const dq = flat(tr.pts[k], c.location);
    if (dq <= 12 && (!best || dq < best.d)) best = { k, d: dq };
  }
  if (!best) return undefined;
  const line = linePath(dim, c.location, tr.pts[best.k], 13);
  return line ? [...line, ...trailFrom(tr, best.k, 1)] : undefined;
}
/** back the way the player came, away from them */
function routeAway(c, target) {
  const tr = trails.get(target.id);
  if (!tr || tr.dim !== c.dimension.id) return undefined;
  const i = nearestTrail(tr, c.location, 3);
  return i >= 0 ? trailFrom(tr, i, -1) : undefined;
}
/** a place on your own trail, a way behind you, where nobody is looking (out of sight if possible) */
function trailSpot(target, minBack = 16, maxBack = 40) {
  const tr = trails.get(target.id);
  if (!tr || tr.dim !== target.dimension.id || tr.pts.length < 6) return undefined;
  let acc = 0;
  const options = [];
  for (let k = tr.pts.length - 1; k > 0; k--) {
    const a = tr.pts[k], b = tr.pts[k - 1];
    if (a.gap) break;
    acc += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (acc < minBack) continue;
    if (acc > maxBack) break;
    if (flat(b, target.location) < 10 || b.w) continue;
    const head = add(b, { x: 0, y: 2.6, z: 0 });
    if (world.getAllPlayers().some((p) => p.dimension.id === target.dimension.id && looksAt(p, head, 0.45, 96))) continue;
    options.push({ k: k - 1, p: b, hidden: !inSight(target, head) });
  }
  if (!options.length) return undefined;
  const hid = options.filter((o) => o.hidden);
  return pick(hid.length ? hid : options);
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

// ------------------------------------------------------------------ minds and the body
function mindOf(c) {
  let m = minds.get(c.id);
  if (!m) {
    m = { state: 'idle', since: now(), until: 0, seenFor: 0, unseenFor: 0, sightings: 0, cooldownUntil: now() + randInt(4, 10) * TPS,
      nextEyes: 0, nextSnuff: now() + 20 * TPS, nextLunge: 0, nextStrike: 0, act: '', pose: '', mode: '', crawl: undefined, crawlSince: 0,
      frozen: false, riseUntil: 0, swim: null, climb: null, hold: null, walk: null, replan: 0, noPath: 0, chaseEnd: 0,
      target: undefined, chased: undefined, spotted: false, walking: false, wasStill: false, mimicUntil: 0, ran: false };
    minds.set(c.id, m);
    mode(c, m, inWater(c) ? 'hold' : 'observe');
  }
  return m;
}
function mode(c, m, name) { if (m.mode !== name) { m.mode = name; setMode(c, name); } }
/** what it does with its body when it is not going anywhere */
function pose(c, m, name) { m.pose = name; }
function crawl(c, m, on) {
  if (m.crawl === on) return;
  m.crawl = on;
  m.crawlSince = now();
  try { c.triggerEvent(on ? 'brine:crawl_on' : 'brine:crawl_off'); } catch (e) { /* ok */ }
}
/** fit its body to the place it stands: down on all fours under a low roof */
function fit(c, m, pos) {
  crawl(c, m, headroom(c.dimension, pos.x, pos.y, pos.z) < STAND);
}
/** put it somewhere (it is not seen doing it) and fit its body there */
function place(c, m, pos, face) {
  try { c.teleport(pos, face ? { facingLocation: face } : undefined); } catch (e) { return false; }
  fit(c, m, pos);
  return true;
}
function stop(c, m) {
  m.walk = null; m.swim = null; m.climb = null;
  m.hold = null;
}
/** every animation comes from what the body is doing right now */
function animate(c, m) {
  let a;
  if (m.climb) a = m.climb.act ?? 'emerge';
  else if (m.swim) a = m.swim.moved === false ? 'idle_water' : 'swim';                // stalled: it treads water
  else if (m.walk) a = m.walk.act ?? 'walk';
  else a = m.pose || (inWater(c) ? 'idle_water' : 'watch');
  if (a !== m.act) { m.act = a; setAct(c, a); }
}
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

// ------------------------------------------------------------------ the motor (every tick): walking, swimming, climbing, holding
const GAIT = { stalk: 'stalk', slow: 'slow_approach', walk: 'walk', run: 'run' };
function walk(c, m, pts, style, opts = {}) {
  if (!pts || !pts.length) return false;
  m.swim = null; m.climb = null; m.hold = null;
  m.walk = { pts, i: 0, style, speed: opts.speed ?? SPEED[style], face: opts.face, then: opts.then, shoreAt: 0, shore: false, act: GAIT[style] };
  mode(c, m, 'hold');
  return true;
}
function stepWalk(c, m) {
  const w = m.walk;
  if (w.i >= w.pts.length) { m.walk = null; w.then?.(); return; }
  let pos = c.location;
  // the body: down where the way ahead is low, up again once there is room
  const ahead = w.pts.slice(w.i, w.i + 4);
  if (ahead.some((q) => q.c < STAND)) crawl(c, m, true);
  else if (m.crawl && now() - m.crawlSince > 20 && headroom(c.dimension, pos.x, pos.y, pos.z) >= STAND) crawl(c, m, false);
  let budget = w.speed * threat().speed * (m.crawl ? 0.65 : 1) * (ahead[0]?.w ? 0.8 : 1);
  if (now() < (w.boostUntil ?? 0)) budget *= 2.2;                    // a bound (the lunge)
  w.climbing = false;
  while (budget > 1e-4 && w.i < w.pts.length) {
    const q = w.pts[w.i];
    const qy = q.w && !q.floor ? q.y - 0.3 : q.y;                    // swimming (not walking the lake bed): a little lower
    if (q.climb && qy > pos.y + 0.05) {                             // a ledge: it hauls itself up the face, then over
      pos = { ...pos, y: Math.min(qy, pos.y + 0.24) };
      w.climbing = true;
      budget = 0;
      break;
    }
    const dh = Math.hypot(q.x - pos.x, q.z - pos.z);
    if (qy > pos.y + 0.05 && !q.w) pos = { ...pos, y: qy };        // a step up: onto it at once, never through its edge
    const dd = Math.hypot(dh, qy - pos.y);
    if (dd <= budget || dh < 1e-3) { pos = { x: q.x, y: qy, z: q.z }; budget -= Math.min(budget, dd); w.i++; }
    else {
      const k = Math.min(1, budget / Math.max(dh, 1e-6));
      const nx = pos.x + (q.x - pos.x) * k, nz = pos.z + (q.z - pos.z) * k;
      // a step down (or into the water): it keeps its height while there is ground under it, then goes down
      const ground = cell(c.dimension, Math.floor(nx), Math.floor(pos.y - 0.5), Math.floor(nz)) === 0;
      const ny = qy < pos.y ? (ground ? pos.y : Math.max(qy, pos.y - 0.35)) : pos.y + (qy - pos.y) * k;
      pos = { x: nx, y: ny, z: nz };
      budget = 0;
    }
  }
  const here = w.pts[Math.min(w.i, w.pts.length - 1)];
  const water = !!here?.w && !here.floor;                           // walking the bottom of a lake is still walking
  const look = w.face ? w.face() : w.pts[Math.min(w.pts.length - 1, w.i + 2)];
  const opts = look && flat(look, pos) > 0.3 ? { facingLocation: { x: look.x, y: pos.y + 2.4, z: look.z } } : undefined;
  try { c.teleport(pos, opts); } catch (e) { m.walk = null; return; }
  // its gait, from what the ground is doing under it
  if (now() >= w.shoreAt) { w.shore = nearWater(c.dimension, pos, 2); w.shoreAt = now() + 10; }
  const prev = w.pts[Math.max(0, w.i - 1)];
  const steep = here && prev && Math.abs(here.y - prev.y) > 0.6 && flat(here, prev) < 0.5;
  w.act = w.climbing ? 'emerge' : water ? 'swim' : (m.crawl || steep) ? 'tunnel_crawl' : w.style === 'stalk' && w.shore ? 'shoreline_stalk' : GAIT[w.style] ?? 'walk';
  // its feet: wet steps you can hear, wet marks on the stone
  const every = w.style === 'run' ? 7 : 13;
  if (!water && now() % every === 0) {
    sound(c.dimension, 'mob.brinesleeper.step', pos, w.style === 'run' ? 1.0 : 0.55, rand(0.85, 1.0));
    if (chance(0.5)) particle(c.dimension, 'brine:drips', add(pos, { x: 0, y: 0.1, z: 0 }));
  }
  if (w.i >= w.pts.length) { m.walk = null; w.then?.(); }
}
function motor(c, m) {
  if (m.climb) {
    const k = m.climb;
    const p = k.path[k.i++];
    try { c.teleport(p, { facingLocation: k.face }); } catch (e) { m.climb = null; return; }
    if (k.i >= k.path.length) { m.climb = null; fit(c, m, c.location); k.then?.(); }
    return;
  }
  if (m.swim) {
    const sw = m.swim;
    const pos = c.location;
    const to = sub(sw.goal, pos);
    const dist = len(to);
    if (dist < 0.7) { m.swim = null; m.hold = pos; sw.then?.(); return; }
    const dir = norm(to);
    let next = add(pos, mul(dir, Math.min(sw.speed * threat().speed, dist)));
    const wet = (q) => isWater(block(c.dimension, add(q, { x: 0, y: 0.6, z: 0 })));
    if (!wet(next)) {
      const up = add(next, { x: 0, y: 0.7, z: 0 }), down = add(next, { x: 0, y: -0.7, z: 0 });
      if (wet(up)) next = up; else if (wet(down)) next = down;
      else if (++sw.blocked > 8) { m.swim = null; m.hold = pos; sw.fail?.(); return; }
      else { sw.moved = false; return; }
    }
    sw.moved = true;
    try { c.teleport(next, { facingLocation: add(next, { x: dir.x, y: 0, z: dir.z }) }); } catch (e) { m.swim = null; return; }
    if (sw.wake && now() % 6 === 0) { const s = surfaceNear(c.dimension, next, 6, 1); if (s) particle(c.dimension, 'brine:ripple', s); }
    return;
  }
  if (m.walk) { stepWalk(c, m); return; }
  if (m.hold && m.mode === 'hold') { try { c.teleport(m.hold); } catch (e) { /* gone */ } }
}
function swimTo(c, m, goal, speed, then, fail, wake = false) {
  m.hold = null; m.climb = null; m.walk = null;
  m.swim = { goal, speed, then, fail, wake, blocked: 0 };
  mode(c, m, 'hold');
  crawl(c, m, false);
}
function climbOut(c, m, bank, face, then) {
  const from = c.location;
  const dim = c.dimension;
  // the water column right beside the bank that is nearest to it: it swims there under the surface, rises straight up
  // that column, and steps across onto the bank (it never passes through the bank's edge)
  let col;
  const bx = Math.floor(bank.x), bz = Math.floor(bank.z), by = Math.floor(bank.y);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const x = bx + dx, z = bz + dz;
    let top;
    for (let y = by + 1; y >= by - 4 && top === undefined; y--) if (cell(dim, x, y, z) === 2) top = y;
    if (top === undefined) continue;
    const p = { x: x + 0.5, y: top, z: z + 0.5 };
    const dd = flat(p, from) + 0.5 * Math.hypot(dx, dz);
    if (!col || dd < col.d) col = { p, d: dd };
  }
  const path = [];
  const seg = (a, b, step) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / step));
    for (let i = 1; i <= n; i++) path.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n, z: a.z + (b.z - a.z) * i / n });
  };
  const lip = { x: bank.x, y: bank.y + 0.4, z: bank.z };
  if (col) {
    const below = { x: col.p.x, y: Math.min(from.y, col.p.y - 0.6), z: col.p.z };
    seg(from, below, 0.3);
    seg(below, { x: col.p.x, y: bank.y + 0.4, z: col.p.z }, 0.22);
    seg({ x: col.p.x, y: bank.y + 0.4, z: col.p.z }, lip, 0.2);
  } else {
    seg(from, { x: from.x, y: Math.max(from.y, bank.y + 0.4), z: from.z }, 0.22);
    seg({ x: from.x, y: Math.max(from.y, bank.y + 0.4), z: from.z }, lip, 0.2);
  }
  seg(lip, bank, 0.2);
  m.swim = null; m.hold = null; m.walk = null;
  m.climb = { path, i: 0, face, then, act: 'emerge' };
  mode(c, m, 'hold');
  sound(c.dimension, 'brine.fx.surge', from, 1.1, 0.9);
  sound(c.dimension, 'mob.brinesleeper.emerge', from, 1, rand(0.85, 1));
  particle(c.dimension, 'brine:splash', { x: from.x, y: bank.y - 0.5, z: from.z });
}

// ------------------------------------------------------------------ places in and around the water
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
    if (ceil >= 5 && ceil <= 9) options.push(['ceiling', { x: f.x, y: f.y + ceil - CEILING_DROP, z: f.z }, 3]);
    if (f.y - target.location.y >= 3) options.push(['ledge_watch', f, 4]);
    if (vines) options.push(['veil_stalk', f, 4]);
    if (nearWater(dim, f, 1)) options.push(['reflection_lurk', f, 3]);
    if (wallBeside) { options.push(['corner_watch', f, 2]); options.push(['behind_cover', f, 2]); }
    if (dark(dim, add(f, { x: 0, y: 1, z: 0 }))) options.push(['shadow_hide', f, 1]);
    for (const k of ['distant_observer', 'head_tilt', 'patient_strike', 'watch', 'full_stand', 'twitch']) options.push([k, f, 0.6]);
    options.push(['head_turn', f, 1.2]);                            // its back to you, its face to you
  }
  if (!options.length) return water ? ['water', water] : undefined;
  let r = Math.random() * options.reduce((a, o) => a + o[2], 0);
  for (const o of options) { r -= o[2]; if (r <= 0) return [o[0], o[1]]; }
  return [options[0][0], options[0][1]];
}

// ------------------------------------------------------------------ the way to you (path.js: a search over the blocks, made for its body)
/** start (or keep) a search for a way to the player; while it runs it keeps moving on what it has */
function navigate(c, m, target, style, speed) {
  const t = now();
  const goal = target.location;
  const moved = !m.navGoal || flat(m.navGoal, goal) > 2.5 || Math.abs(m.navGoal.y - goal.y) > 2;
  m.navStyle = style;
  m.navSpeed = speed;
  if (!m.plan && (moved || t >= (m.navAt ?? 0) || !m.walk)) {
    m.navGoal = { x: goal.x, y: goal.y, z: goal.z };
    m.navAt = t + (style === 'run' ? 12 : 30);
    m.plan = { gen: findPath(c.dimension, c.location, goal, { max: style === 'run' ? 2600 : 3600, near: style === 'run' ? 1.2 : 2.5 }), t };
    if (!m.walk) {                                                  // the very first moment: straight at you, if it can be
      const line = linePath(c.dimension, c.location, goal, 14);
      if (line) walk(c, m, line, style, { speed });
    }
  }
}
/** a slice of the search (a few milliseconds a tick); when it is done, it takes the way it found */
function stepPlan(c, m) {
  const p = m.plan;
  if (!p) return;
  const t0 = Date.now();
  let r;
  try { do { r = p.gen.next(); } while (!r.done && Date.now() - t0 < 3); } catch (e) { m.plan = null; return; }
  if (!r.done) return;
  m.plan = null;
  const res = r.value;
  if (!res || !res.pts.length) { m.lost = (m.lost ?? 0) + 1; return; }
  m.lost = 0;
  m.partials = res.complete ? 0 : (m.partials ?? 0) + 1;            // it can only get part of the way to you
  if (!res.complete) m.navAt = now() + 40;
  const pos = c.location;                                           // it moved while it searched: join the way where it is now
  let j = 0, bd = Infinity;
  for (let i = 0; i < Math.min(res.pts.length, 8); i++) {
    const dd = flat(res.pts[i], pos) + Math.abs(res.pts[i].y - pos.y);
    if (dd < bd) { bd = dd; j = i; }
  }
  const pts = res.pts.slice(bd < 1.2 ? j + 1 : j);
  if (!pts.length || !['stalk', 'chase', 'rush', 'standoff'].includes(m.state) || m.frozen || m.climb || m.swim) return;
  walk(c, m, m.state !== 'stalk' && pts.length > 2 && res.complete ? pts.slice(0, pts.length - 1) : pts, m.navStyle ?? 'stalk', { speed: m.navSpeed });
}
/** walk at you: its own search first, your trail when the search finds nothing */
function pursue(c, m, target, style, speed) {
  if (m.climb || m.swim) return;
  if ((m.lost ?? 0) < 2) navigate(c, m, target, style, speed);
  else if (!m.walk || now() >= m.replan) {
    const r = routeTo(c, target, 12);
    if (r && r.length) { walk(c, m, r, style, { speed }); m.lost = 0; }
    m.replan = now() + 10;
  }
  if (!m.walk && !m.plan) { m.noPath += 5; mode(c, m, 'hold'); pose(c, m, m.crawl ? 'crawl_still' : 'hunting_stance'); }
  else if ((m.partials ?? 0) >= 2 && !m.walk) m.noPath += 10;           // no whole way to you: soon it tries another way
  else m.noPath = 0;
}
/** it cannot reach you the way it is: the next time you see it, it is somewhere ahead of you */
function ahead(c, m, target) {
  if (seenByAnyone(c)) return false;
  const s = spot(target, 'floor', 9, 18, { ahead: 1.1, room: 4, tries: 30, eyeHeight: 3.2 });
  if (!s) return false;
  stop(c, m);
  mode(c, m, 'hold');
  place(c, m, s, target.getHeadLocation());
  pose(c, m, m.crawl ? 'crawl_still' : 'hunting_stance');
  sound(c.dimension, 'mob.brinesleeper.click', s, 1, 0.8);
  m.navGoal = undefined;
  m.lost = 0;
  return true;
}

// ------------------------------------------------------------------ the jumpscare
const lastScare = new Map();
const cameraHeld = new Map();                                       // player id -> tick the camera was taken (always given back)
const scareReady = (p) => now() - (lastScare.get(p.id) ?? -99999) > Math.round((config.preset === 'nightmare' ? 40 : config.preset === 'relentless' ? 60 : 90) * TPS);
function giveCameraBack(p) {
  if (!cameraHeld.has(p.id)) return;
  cameraHeld.delete(p.id);
  try { p.camera.clear(); } catch (e) { /* gone */ }
}
/**
 * The moment it is in your face. The music dies; it is there, a body's length in front of you, rearing over you with
 * its mouth open; your view is wrenched up to its face and the camera lunges into it; a scream, a red flash, a blow.
 * Then the dark, and it is gone (or it is coming).
 */
function jumpscare(c, m, target, after = 'vanish') {
  if (!c.isValid || !target.isValid) return false;
  lastScare.set(target.id, now());
  const dim = c.dimension;
  const eye = target.getHeadLocation();
  const v = target.getViewDirection();
  const f = norm({ x: v.x, y: 0, z: v.z });
  // right in front of you on the ground; if a wall is there, beside you; if not that, behind you (and you are turned)
  let at;
  const yaw = Math.atan2(f.z, f.x), fy = Math.floor(target.location.y + 0.5);
  search: for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI]) {
    for (const r of [1.6, 1.3, 2.0, 2.4]) {
      const px = target.location.x + Math.cos(yaw + da) * r, pz = target.location.z + Math.sin(yaw + da) * r;
      const x = Math.floor(px), z = Math.floor(pz);
      for (const dy of [0, -1, 1]) if (standable(dim, x, fy + dy, z)) { at = { x: px, y: fy + dy, z: pz }; break search; }
    }
  }
  if (!at) return false;                                            // nowhere to stand near you: not now
  stop(c, m);
  mode(c, m, 'hold');
  place(c, m, at, eye);
  pose(c, m, m.crawl ? 'crawl_still' : 'emerge_roar');
  animate(c, m);
  press(target.id, 'silence', now() + 16);                          // the music stops dead
  go(m, 'scare', 3);
  system.runTimeout(() => {
    if (!c.isValid || !target.isValid) return;
    const face = c.getHeadLocation();
    try { target.playSound('brine.jumpscare', { volume: 1 }); } catch (e) { /* gone */ }
    sound(dim, 'mob.brinesleeper.roar', face, 1.6, 1.15);
    try { target.teleport(target.location, { facingLocation: face }); } catch (e) { /* ok */ }   // your eyes on its face
    if (config.screen) {
      const from = target.getHeadLocation();
      const into = add(face, mul(norm(sub(from, face)), 0.85));
      try {
        target.camera.setCamera('minecraft:free', { location: from, facingLocation: face });
        target.camera.setCamera('minecraft:free', { location: into, facingLocation: face, easeOptions: { easeTime: 0.16, easeType: EasingType.OutExpo } });
        cameraHeld.set(target.id, now());
      } catch (e) { /* no camera control here */ }
      try { target.camera.fade({ fadeTime: { fadeInTime: 0.05, holdTime: 0.12, fadeOutTime: 0.55 }, fadeColor: { red: 0.55, green: 0.0, blue: 0.02 } }); } catch (e) { /* ok */ }
      shake(target, 1.0, 0.8);
      try { target.onScreenDisplay.setTitle('§4§k||||||||', { fadeInDuration: 0, stayDuration: 10, fadeOutDuration: 6, subtitle: `§8§o${pick(['found you', 'behind you', target.name, 'too slow', 'it was always here'])}` }); } catch (e) { /* ok */ }
      try { target.addEffect('nausea', 90, { amplifier: 0, showParticles: false }); } catch (e) { /* ok */ }
    }
    if (preset().damage > 0 && hunter(target)) {
      target.applyDamage(Math.round(threat().melee * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
      const k = norm(sub(target.location, c.location));
      try { target.applyKnockback({ x: k.x * 0.9, z: k.z * 0.9 }, 0.3); } catch (e) { /* ok */ }
    }
    system.runTimeout(() => {                                       // the view comes back, into the dark
      giveCameraBack(target);
      if (config.screen) { try { target.addEffect('darkness', 100, { amplifier: 0, showParticles: false }); } catch (e) { /* ok */ } }
      if (!c.isValid || !target.isValid) return;
      if (after === 'chase' && hunter(target)) chase(c, m, target); else vanish(c, m, target);
    }, 14);
  }, 4);
  return true;
}
world.afterEvents.playerSpawn.subscribe(({ player }) => { cameraHeld.set(player.id, 0); giveCameraBack(player); });
system.runInterval(() => {                                          // never leave anyone's camera held
  for (const p of world.getAllPlayers()) { const at = cameraHeld.get(p.id); if (at !== undefined && now() - at > 40) giveCameraBack(p); }
}, 10);

// ------------------------------------------------------------------ encounters
/** what it does next when it is ready, weighted by what it has learned about you */
function encounter(c, m, target) {
  const pr = profileOf(target);
  const land = !target.isInWater;
  /** @type {[string, number][]} */
  const opts = [['stalk', 1.0], ['watch', 0.6], ['creep', land ? 0.9 + pr.bold * 0.4 : 0], ['rush', land ? 0.4 + pr.bold * 0.6 : 0],
    ['ceiling', land ? 0.6 : 0], ['approach', nearWater(target.dimension, target.location, 6) ? 1.0 : 0]];
  let r = Math.random() * opts.reduce((a, o) => a + o[1], 0);
  let k = 'stalk';
  for (const [name, w] of opts) { r -= w; if (r <= 0) { k = name; break; } }
  debug(`encounter: ${k}`);
  const ok = k === 'creep' ? creep(c, m, target) : k === 'rush' ? rush(c, m, target) : k === 'ceiling' ? ceiling(c, m, target)
    : k === 'approach' ? approach(c, m, target, false) : k === 'watch' ? (watch(c, m, target), true) : false;
  if (!ok) stalk(c, m, target);
}
/** a pose that is wrong: its back to you with its head turned all the way round, a twitching stand, a tilted stare */
function wrongPose(c, m, target, at) {
  const p = m.crawl ? 'crawl_still' : pick(['head_turn', 'head_turn', 'twitch', 'full_stand', 'head_tilt']);
  pose(c, m, p);
  const face = p === 'head_turn' ? add(at, sub(at, target.location)) : target.getHeadLocation();
  try { c.teleport(at, { facingLocation: { x: face.x, y: at.y + 3, z: face.z } }); } catch (e) { /* ok */ }
}
/** "it only moves when you don't look": far off, in a wrong pose; each time you look away, it is closer */
function creep(c, m, target) {
  if (seenByAnyone(c)) return false;
  const s = spot(target, 'floor', 16, 26, { room: 4, sight: true, eyeHeight: 3.2, tries: 30 });
  if (!s) return false;
  stop(c, m);
  mode(c, m, 'hold');
  place(c, m, s);
  wrongPose(c, m, target, s);
  go(m, 'creep', 75);
  m.steps = 0;
  m.spotted = false;
  press(target.id, 'silence', now() + 60);                          // the music goes away first
  return true;
}
/** a place on the ground some blocks nearer to the player */
function closer(c, target, step) {
  const dim = c.dimension;
  const from = c.location, to = target.location;
  const dd = flat(from, to);
  if (dd < 2.5) return undefined;
  const k = Math.min(1, step / dd);
  const p = { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k };
  const x = Math.floor(p.x), z = Math.floor(p.z), y = Math.floor(from.y + 0.5 + (to.y - from.y) * k);
  for (const dy of [0, 1, -1, 2, -2, 3, -3]) if (standable(dim, x, y + dy, z)) return { x: x + 0.5, y: y + dy, z: z + 0.5 };
  const ts = trailSpot(target, Math.max(2, dd - step - 3), dd - step + 3);
  return ts ? ts.p : undefined;
}
/** out of the dark, far down the cave, it screams and comes at you on all fours, faster than you can run */
function rush(c, m, target) {
  if (seenByAnyone(c)) return false;
  const s = spot(target, 'floor', 18, 30, { room: 4, sight: true, eyeHeight: 3.2, tries: 30 });
  if (!s) return false;
  stop(c, m);
  mode(c, m, 'hold');
  place(c, m, s, target.getHeadLocation());
  pose(c, m, m.crawl ? 'crawl_still' : 'hunting_stance');
  go(m, 'rush', 14);
  m.rushAt = now() + randInt(20, 50);                               // a still moment first
  m.rushing = false;
  m.spotted = false;
  press(target.id, 'silence', now() + 50);
  return true;
}
/** above you: it hangs from the roof, dripping on you; look up and it drops */
function ceiling(c, m, target) {
  if (seenByAnyone(c)) return false;
  const dim = target.dimension;
  const p = target.location;
  const v = target.getViewDirection();
  for (let i = 0; i < 20; i++) {
    const a = Math.atan2(v.z, v.x) + rand(-0.9, 0.9), r = rand(2.5, 7);
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r), fy = Math.floor(p.y + 0.5);
    for (const dy of [0, -1, 1]) {
      if (!standable(dim, x, fy + dy, z)) continue;
      let room = 0;
      while (room < 12 && cellAt(dim, x, fy + dy + room, z) !== 0) room++;
      if (room < 5 || room > 9) continue;
      const at = { x: x + 0.5, y: fy + dy + room - CEILING_DROP, z: z + 0.5 };
      stop(c, m);
      m.hold = at;
      mode(c, m, 'hold');
      place(c, m, at, target.getHeadLocation());
      crawl(c, m, false);
      pose(c, m, 'ceiling_lurk');
      go(m, 'ceiling', 45);
      m.floorAt = { x: x + 0.5, y: fy + dy, z: z + 0.5 };
      press(target.id, 'silence', now() + 80);
      return true;
    }
  }
  return false;
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

// ------------------------------------------------------------------ vanishing and turning up again
/** it is simply somewhere else: deep water near you, or a way back along your own trail (only while nobody looks) */
function relocate(c, m, target, near = false) {
  if (seenByAnyone(c)) return false;
  const w = waterAround(target, near ? 14 : 24, near ? 26 : 44, { depth: 4, tries: 16 });
  if (w && chance(0.5)) { stop(c, m); m.hold = under(w, LURK_DEPTH); mode(c, m, 'hold'); place(c, m, m.hold); pose(c, m, 'idle_water'); return 'water'; }
  const ts = trailSpot(target, near ? 14 : 20, near ? 28 : 44);
  if (ts) { stop(c, m); mode(c, m, 'hold'); place(c, m, ts.p, target.getHeadLocation()); pose(c, m, 'hunting_stance'); return 'trail'; }
  if (w) { stop(c, m); m.hold = under(w, LURK_DEPTH); mode(c, m, 'hold'); place(c, m, m.hold); pose(c, m, 'idle_water'); return 'water'; }
  return false;
}
function vanish(c, m, target) {
  const pos = c.location;
  stop(c, m);
  if (inWater(c) || isWater(block(c.dimension, { x: pos.x, y: pos.y + 0.5, z: pos.z }))) {
    pose(c, m, 'submerge');
    const s = surfaceNear(c.dimension, pos, 6, 2);
    if (s) particle(c.dimension, 'brine:ripple', s);
    sound(c.dimension, 'mob.brinesleeper.submerge', pos, 0.5, rand(0.8, 0.95));
  } else {
    if (m.pose !== 'ceiling_lurk') pose(c, m, m.crawl ? 'crawl_still' : 'retreat');
    particle(c.dimension, 'brine:smoke', add(pos, { x: 0, y: 1.5, z: 0 }));
    particle(c.dimension, 'brine:smoke', add(pos, { x: 0, y: 3, z: 0 }));
    particle(c.dimension, 'brine:drips', add(pos, { x: 0, y: 0.5, z: 0 }));
    sound(c.dimension, 'mob.brinesleeper.hiss', pos, 0.45, rand(0.8, 0.9));
  }
  mode(c, m, 'hold');
  m.hold = pos;
  m.sightings++;
  m.spotted = false;
  system.runTimeout(() => {
    if (!c.isValid) return;
    const where = target && target.isValid ? relocateAnyway(c, m, target) : false;
    if (!where && !inWater(c)) wetTrail(c.dimension, pos, add(pos, mul(norm(sub(pos, target ? target.location : pos)), 8)));
    if (!target || !target.isValid) { go(m, 'idle', 1); return; }
    if (where === 'water' || inWater(c)) lurk(c, m, target);
    else if (now() < m.cooldownUntil) { mode(c, m, 'observe'); pose(c, m, 'shadow_hide'); go(m, 'hidden', rand(5, 10)); }
    else stalk(c, m, target);
  }, inWater(c) ? 8 : 2);
  go(m, 'vanishing', 2);
}
/** the vanish itself is the cover: it may move even if someone was looking (smoke, or under the water) */
function relocateAnyway(c, m, target) {
  const w = waterAround(target, 26, 44, { depth: 4, tries: 16 });
  const ts = trailSpot(target, 22, 44);
  if (w && (chance(0.55) || !ts)) { m.hold = under(w, LURK_DEPTH); place(c, m, m.hold); pose(c, m, 'idle_water'); return 'water'; }
  if (ts) { m.hold = ts.p; place(c, m, ts.p, target.getHeadLocation()); pose(c, m, 'shadow_hide'); return 'trail'; }
  const f = spot(target, 'floor', 28, 44, { room: 5, eyeHeight: 3.2, tries: 20 });
  if (f) { m.hold = f; place(c, m, f, target.getHeadLocation()); pose(c, m, 'shadow_hide'); return 'floor'; }
  return false;
}

// ------------------------------------------------------------------ states
/** sink out of sight into deep water near you */
function sink(c, m, s) {
  stop(c, m);
  m.hold = under(s, LURK_DEPTH);
  mode(c, m, 'hold');
  if (!place(c, m, m.hold)) return false;
  pose(c, m, 'idle_water');
  return true;
}
function lurk(c, m, target, seconds) {
  go(m, 'lurk', seconds ?? rand(6, 14) / freq());
  if (!target) return;
  const s = waterAround(target, 18, 34, { depth: 4, tries: 16 });
  if (!s) {
    if (!inWater(c)) stalk(c, m, target);
    else { stop(c, m); mode(c, m, 'hold'); pose(c, m, 'idle_water'); }
    return;
  }
  pose(c, m, 'idle_water');
  if (inWater(c) && flat(s, c.location) < 72) {
    // another lake, not joined to this one: it is simply there, the next time nobody is looking
    swimTo(c, m, under(s, LURK_DEPTH), 0.2, undefined, () => { if (!seenByAnyone(c)) sink(c, m, s); });
  } else if (!seenByAnyone(c)) sink(c, m, s);
  else stalk(c, m, target);
}
/** far off, it lets itself be seen, and is gone when you look */
function watch(c, m, target) {
  const pr = profileOf(target);
  const near = 30 - pr.bold * 14, far = 44 - pr.bold * 16;
  const place_ = watchPlace(c, target, near, far);
  if (!place_ || seenByAnyone(c)) {                                 // nowhere to be seen from (or someone is looking): wait
    if (inWater(c)) lurk(c, m, target, rand(4, 8));
    else if (now() >= m.cooldownUntil) stalk(c, m, target);
    else { stop(c, m); mode(c, m, 'observe'); pose(c, m, 'shadow_hide'); go(m, 'hidden', rand(4, 8)); }
    return;
  }
  const [kind, at] = place_;
  stop(c, m);
  let pos = at;
  if (kind === 'water') {
    const a = chance(0.4) ? 'idle_water' : 'submerged_watch';
    pos = under(at, DEPTH[a]);
    m.hold = pos;
    mode(c, m, 'hold');
    pose(c, m, a);
    sound(c.dimension, 'brine.fx.drip', at, 0.6, rand(0.8, 1));
  } else if (kind === 'ceiling') {
    m.hold = at;                                                    // the root floats; the body hangs from the ceiling above it
    mode(c, m, 'hold');
    pose(c, m, 'ceiling_lurk');
  } else {
    mode(c, m, kind === 'head_turn' ? 'hold' : 'observe');
    pose(c, m, kind === 'shadow_hide' && chance(0.3) ? 'full_stand' : kind);
  }
  place(c, m, pos, kind === 'head_turn' ? add(pos, sub(pos, target.location)) : target.getHeadLocation());
  if (kind === 'ceiling' || kind === 'water') crawl(c, m, false);
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
    stop(c, m);
    m.hold = under(b.water, DEPTH.water_rise);
    mode(c, m, 'hold');
    place(c, m, m.hold, target.getHeadLocation());
    pose(c, m, 'water_rise');
    sound(c.dimension, 'mob.brinesleeper.emerge', b.water, 0.9, rand(0.75, 0.85));
    particle(c.dimension, 'brine:splash', b.water);
    spotted(c, m, target);
    m.riseUntil = now() + randInt(25, 45);
  };
  const haul = () => climbOut(c, m, b.bank, target.getHeadLocation(), () => standoff(c, m, target));
  m.haul = haul;
  if (!inWater(c)) {
    if (seenByAnyone(c)) { stalk(c, m, target); return true; }
    place(c, m, at);
    rise();
    return true;
  }
  pose(c, m, 'idle_water');
  swimTo(c, m, at, 0.32, chance(0.6) ? rise : haul, () => vanish(c, m, target), true);
  return true;
}
/** in the water, and you are on land: climb out at the nearest shore and keep coming */
function leaveWater(c, m, target, then) {
  if (now() < (m.nextShore ?? 0)) return false;
  m.nextShore = now() + 40;
  const s = shoreNear(c, target.location);
  if (!s) return false;
  climbOut(c, m, s, target.getHeadLocation(), then);
  return true;
}
function stalk(c, m, target) {
  stop(c, m);
  go(m, 'stalk', rand(25, 50));
  m.standoffAt = rand(8, 13) - (target ? profileOf(target).bold * 4 : 0);
  m.frozen = false;
  m.noPath = 0;
  m.replan = 0;
  mode(c, m, 'hold');
  pose(c, m, m.crawl ? 'crawl_still' : 'hunting_stance');
}
function standoff(c, m, target) {
  stop(c, m);
  go(m, 'standoff', rand(4, 9));
  m.startDist = flat(target.location, c.location);
  mode(c, m, inWater(c) ? 'hold' : 'observe');
  pose(c, m, m.crawl ? 'crawl_still' : chance(preset().revelation * 2) ? 'full_stand' : pick(['watch', 'head_tilt', 'hunting_stance', 'patient_strike']));
  spotted(c, m, target);
  m.walkAt = chance(0.25 + profileOf(target).bold * 0.4);            // it may simply start walking toward you
  m.walking = false;
  m.frozen = false;
}
const runSpeed = (target) => Math.min(0.42, SPEED.run * (1 + 0.04 * Math.min(6, profileOf(target).runs)));
function chase(c, m, target) {
  stop(c, m);
  go(m, 'chase', 30);
  m.chaseEnd = now() + Math.round(randInt(...threat().chaseSeconds) * TPS * (1 + 0.05 * Math.min(6, profileOf(target).runs)));
  m.nextLunge = now() + 30;
  m.nextStrike = now() + 10;
  m.chased = target.id;
  m.noPath = 0;
  m.replan = 0;
  m.lost = 0;
  m.caught = false;
  mode(c, m, 'hold');
  pose(c, m, 'hunting_stance');
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
  if (!inWater(c)) {                                               // it comes up from under you, from the nearest deep water
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
  stop(c, m);
  if (m.state === 'chase' || m.state === 'deep') endChase(c, m);
  go(m, 'retreat', 9);
  m.ran = false;
  if (inWater(c)) { vanish(c, m, target); return; }
  mode(c, m, 'hold');
  pose(c, m, m.crawl ? 'crawl_still' : 'retreat');                                             // it turns away first
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
  go(m, 'ambush', rand(3, 8));
  const hold = under(water, LURK_DEPTH);
  if (flat(water, c.location) < 4 || !inWater(c)) {
    if (seenByAnyone(c)) { lurk(c, m, target); return; }
    stop(c, m);
    m.hold = hold;
    mode(c, m, 'hold');
    place(c, m, hold, target.location);
    pose(c, m, 'idle_water');
    return;
  }
  pose(c, m, 'idle_water');
  swimTo(c, m, hold, 0.3, () => { m.hold = hold; }, () => lurk(c, m, target), true);
}
function burst(c, m, target) {
  const s = m.ambushAt;
  stop(c, m);
  m.hold = { x: s.x, y: s.y - DEPTH.emerge_roar, z: s.z };
  mode(c, m, 'hold');
  if (!place(c, m, m.hold, target.getHeadLocation())) return;
  crawl(c, m, false);
  pose(c, m, 'emerge_roar');
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

// ------------------------------------------------------------------ the grab, the strike and the lunge
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
  mode(c, m, 'hold');
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
/** at arm's length: a swipe of the claws */
function strike(c, m, target) {
  m.nextStrike = now() + randInt(22, 32) - 2 * Math.min(5, profileOf(target).fights);
  try { c.playAnimation('animation.brinesleeper.lunge', { blendOutTime: 0.15 }); } catch (e) { /* ok */ }
  sound(c.dimension, 'mob.brinesleeper.lunge', c.location, 0.9, rand(1.05, 1.2));
  system.runTimeout(() => {
    if (!c.isValid || !target.isValid || preset().damage <= 0) return;
    if (flat(target.location, c.location) > 3.3 || Math.abs(target.location.y - c.location.y) > 2.6) return;
    target.applyDamage(Math.round(threat().melee * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
    const k = norm(sub(target.location, c.location));
    try { target.applyKnockback({ x: k.x * 0.5, z: k.z * 0.5 }, 0.2); } catch (e) { /* ok */ }
  }, 6);
}
/** from further off: a long reaching leap */
function lunge(c, m, target) {
  m.nextLunge = now() + randInt(55, 100) - 5 * Math.min(6, profileOf(target).fights);
  try { c.playAnimation('animation.brinesleeper.lunge', { blendOutTime: 0.2 }); } catch (e) { /* ok */ }
  sound(c.dimension, 'mob.brinesleeper.lunge', c.location, 1.1, rand(0.95, 1.1));
  if (m.walk) m.walk.boostUntil = now() + 6;                         // it covers the ground in one bound
  system.runTimeout(() => {
    if (!c.isValid || !target.isValid || flat(target.location, c.location) > 4 || preset().damage <= 0) return;
    target.applyDamage(Math.round(threat().lunge * preset().damage), { cause: EntityDamageCause.entityAttack, damagingEntity: c });
    const k = norm(sub(target.location, c.location));
    try { target.applyKnockback({ x: k.x * 0.7, z: k.z * 0.7 }, 0.28); } catch (e) { /* ok */ }
    shake(target, 0.25, 0.3);
  }, 7);
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
/** nothing to do: it stays where it is, in a pose that fits where it is */
function rest(c, m) {
  stop(c, m);
  if (inWater(c)) { mode(c, m, 'hold'); pose(c, m, 'idle_water'); }
  else { mode(c, m, 'observe'); pose(c, m, m.crawl ? 'crawl_still' : 'watch'); }
}

// ------------------------------------------------------------------ one think (every 5 ticks)
function think(c) {
  const m = mindOf(c);
  const t = now();
  const h = handoff.get(c.id);                                       // a hunt the director started: it is ours now
  if (h) {
    handoff.delete(c.id);
    const p = playerById(h.target);
    if (p && hunter(p)) { if (inWater(c) && !p.isInWater) { const b = bankNear(c, p); if (b) climbOut(c, m, b.bank, p.getHeadLocation(), () => chase(c, m, p)); else chase(c, m, p); } else chase(c, m, p); }
  }
  const target = pickTarget(c, m);
  if (!config.enabled || !target) {
    if (m.chased) endChase(c, m);
    if (m.state !== 'idle') { go(m, 'idle', 30); rest(c, m); }
    return;
  }
  m.target = target.id;
  const pr = profileOf(target);
  const d = flat(target.location, c.location);
  const head = c.getHeadLocation();
  const seen = looksAt(target, head, 0.88, 96);
  const wasUnseen = m.unseenFor;
  m.seenFor = seen ? m.seenFor + 5 : 0;
  m.unseenFor = seen ? 0 : m.unseenFor + 5;
  const hunting = m.state === 'chase' || m.state === 'deep' || m.state === 'burst' || (m.state === 'rush' && m.rushing);
  if (m.state === 'scare') return;                                  // its moment: nothing else happens
  feel(target, d, hunting);
  if (hunting) press(target.id, 'chase', t + 60);
  else if (d < 32 && m.state !== 'idle' && m.state !== 'lurk') press(target.id, 'near', t + 80);
  else if (d < 20) press(target.id, 'near', t + 80);
  watchHabits(target, c);

  switch (m.state) {
    case 'idle': {
      if (t < m.cooldownUntil) { if (!m.pose) rest(c, m); break; }
      if (inWater(c) || nearWater(c.dimension, c.location, 6)) lurk(c, m, target, rand(3, 7));
      else encounter(c, m, target);
      break;
    }
    case 'vanishing': break;
    case 'lurk': {
      if (!m.swim && t % 60 < 5 && inWater(c)) {
        const s = surfaceNear(c.dimension, c.location, 6, 1);
        if (s && chance(0.4)) particle(c.dimension, 'brine:bubbles', s);
      }
      if (target.isInWater && hunter(target) && d < 40 && t >= m.cooldownUntil) { deep(c, m, target); break; }
      // you are standing at the edge of deep water, still: it is already under it
      if (inWater(c) && !target.isInWater && hunter(target) && t >= m.cooldownUntil && d < 40 && chance(0.06) &&
          t - (m.lastAmbush ?? -9999) > 60 * TPS) {
        const edge = waterAround(target, 1.5, 4, { depth: 3, allowView: true, tries: 10 });
        if (edge && Math.hypot(target.getVelocity().x, target.getVelocity().z) < 0.05) { m.lastAmbush = t; ambush(c, m, target, edge); break; }
      }
      if (t < m.until) break;
      if (t < m.cooldownUntil) { lurk(c, m, target, rand(8, 16)); if (chance(0.35)) watch(c, m, target); break; }
      const need = config.preset === 'quiet' ? 3 : config.preset === 'nightmare' ? 0 : pr.bold > 0.6 ? 0 : randInt(1, 2);
      if (m.sightings < need) watch(c, m, target);
      else { m.sightings = 0; if (nearWater(target.dimension, target.location, 6) && chance(0.6) && approach(c, m, target, false)) break; encounter(c, m, target); }
      break;
    }
    case 'watch': {
      eyes(c, m, d);
      if (seen && m.seenFor >= 4) spotted(c, m, target);
      const tooClose = d < 16 - pr.bold * 8;
      if (m.seenFor >= m.watchNeed || tooClose) {
        if (m.seenFor > 0) bolder(target, 0.004);                   // you saw it, and nothing happened: it learns
        if (pr.bold > 0.7 && tooClose && chance(0.4)) {            // it no longer runs from you
          if (m.kind === 'water') approach(c, m, target); else standoff(c, m, target);
          break;
        }
        vanish(c, m, target);
        break;
      }
      if (t >= m.until) {
        m.sightings++;
        if (inWater(c) || m.kind === 'water') lurk(c, m, target);
        else if (!seenByAnyone(c) && relocate(c, m, target)) stalk(c, m, target);      // it comes down off its ledge unseen
        else stalk(c, m, target);
      }
      break;
    }
    case 'approach': {
      if (target.isInWater && hunter(target) && d < 30) { m.riseUntil = 0; deep(c, m, target); break; }
      if (m.riseUntil) {                                            // risen out of the water, staring: then it comes out
        eyes(c, m, d);
        if (t >= m.riseUntil || d < 4) { m.riseUntil = 0; m.haul?.(); }
        break;
      }
      if (!m.swim && !m.climb) approach(c, m, target);
      break;
    }
    case 'hidden': {                                                // out of sight, far off: waiting for its moment
      if ((seen && m.seenFor >= 10) || d < 12) { vanish(c, m, target); break; }
      if (t < m.until) break;
      if (t < m.cooldownUntil) { if (chance(0.5)) watch(c, m, target); else go(m, 'hidden', rand(5, 10)); }
      else if (m.sightings < 1 && pr.bold < 0.6 && chance(0.5)) watch(c, m, target);
      else { m.sightings = 0; encounter(c, m, target); }
      break;
    }
    case 'standoff': {
      eyes(c, m, d);
      if (d < 5 || d < m.startDist - 4) { decide(c, m, target, true); break; }
      if (m.seenFor > randInt(70, 110)) { decide(c, m, target, false); break; }
      if (m.unseenFor > 50) { stalk(c, m, target); break; }
      if (m.walkAt && t > m.since + 50 && !m.walking) { m.walking = true; m.replan = 0; }    // it starts walking at you
      if (m.walking && !inWater(c) && d > 4) navigate(c, m, target, 'slow', SPEED.slow);
      if (t >= m.until) { m.walking = false; decide(c, m, target, false); break; }
      if (chance(0.025)) sound(c.dimension, 'mob.brinesleeper.click', head, 0.8, rand(0.7, 0.9));
      break;
    }
    case 'stalk': {
      if (target.isInWater && inWater(c) && hunter(target) && t >= m.cooldownUntil && !m.frozen) { deep(c, m, target); break; }
      const vanishAt = 14 - pr.bold * 6;
      if (d > vanishAt && m.seenFor >= Math.round(15 + pr.bold * 30)) { vanish(c, m, target); break; }
      if (d < m.standoffAt) { standoff(c, m, target); break; }
      if (inWater(c) && !target.isInWater && !m.climb && (surfaceNear(c.dimension, c.location, 6, 3)?.depth ?? 0) >= 2) {
        if (d < 18 && approach(c, m, target, false)) break;
        if (leaveWater(c, m, target, () => { m.replan = 0; })) break;
      }
      // you turn around and it is right there
      if (seen && d < 5 && wasUnseen >= 40 && hunter(target) && scareReady(target)) { jumpscare(c, m, target, chance(0.5) ? 'chase' : 'vanish'); break; }
      // it only comes closer while you are not looking. Look at it and it stops dead; it knows when you look back,
      // and waits longer before it moves again
      if (seen && !m.frozen && m.seenFor >= 5) {
        m.frozen = true;
        stop(c, m);
        mode(c, m, inWater(c) ? 'hold' : 'observe');
        pose(c, m, m.crawl ? 'crawl_still' : pick(['head_tilt', 'hunting_stance', 'watch']));
        spotted(c, m, target);
        m.until += 20;
      } else if (m.frozen && m.unseenFor >= (pr.looks >= 6 ? 50 : 15)) {
        m.frozen = false;
        m.replan = 0;
      }
      if (m.frozen) {
        eyes(c, m, d);
        if (m.seenFor > 80) standoff(c, m, target);                 // you stared it down: it stares back
        break;
      }
      // one more step than yours: when you stop, it takes a last step, then it is still too
      const tv = target.getVelocity();
      const still = Math.hypot(tv.x, tv.z) < 0.01;
      if (still && !m.wasStill && d < 26 && m.walk) {
        m.mimicUntil = t + randInt(30, 70);
        system.runTimeout(() => { if (c.isValid) sound(c.dimension, 'mob.brinesleeper.step', c.location, 0.9, 0.9); }, 6);
        stop(c, m);
        mode(c, m, 'hold');
        pose(c, m, m.crawl ? 'crawl_still' : 'hunting_stance');
      }
      m.wasStill = still;
      if (t < m.mimicUntil) break;
      // the way to you: its own search through the cave (your trail if that finds nothing)
      pursue(c, m, target, pr.bold > 0.55 && d < 20 ? 'slow' : 'stalk', d > 28 ? 0.19 : d > 16 ? 0.15 : 0.11);
      if (m.noPath >= 40) { m.noPath = 0; m.lost = 0; if (!relocate(c, m, target, true)) vanish(c, m, target); break; }  // no way to you from here
      if (!seen && d > 10 && d < 26 && chance(0.01)) mimic(target);
      const mining = t - (busy.get(target.id) ?? -999) < 40;
      if (!seen && d < 8 && chance(mining ? 0.12 : 0.05)) sound(c.dimension, 'mob.brinesleeper.breathe', head, 1.1, rand(0.8, 0.95));
      const snuff = config.lights && t >= m.nextSnuff && !seen && d < 22 && chance(0.1 * (1 + Math.min(4, pr.lights / 3)));
      if (snuff && snuffLight(target)) m.nextSnuff = t + randInt(20, 45) * TPS;
      eyes(c, m, d);
      if (t >= m.until) decide(c, m, target, false);
      break;
    }
    case 'chase': {
      if (graspers.get(target.id) === m) { graspTick(c, m, target); break; }
      if (m.climb) break;                                           // hauling itself out onto your bank
      if (target.isInWater && inWater(c)) { m.chased = undefined; deep(c, m, target); break; }
      if (!hunter(target) || d > 48 || t >= m.chaseEnd) { retreat(c, m, target); break; }
      if (target.isSprinting && d > m.runStart + 3) { learn(target, 'runs', 0.2, 3); m.runStart = d; }
      if (inWater(c) && !target.isInWater) {
        const b = bankNear(c, target);
        const back = () => { m.replan = 0; };
        if (b && flat(b.water, c.location) < 7) climbOut(c, m, b.bank, target.getHeadLocation(), back);
        else if (!leaveWater(c, m, target, back) && !m.swim) { m.noPath += 5; }
        if (m.noPath >= 60) { m.noPath = 0; vanish(c, m, target); }
        break;
      }
      const dy = Math.abs(target.location.y - c.location.y);
      if (d < 2.4 && dy < 2.6 && !m.caught && scareReady(target)) { m.caught = true; jumpscare(c, m, target, 'chase'); break; }   // it has you
      if (d < 2.7 && dy < 2.6 && t >= m.nextStrike) strike(c, m, target);
      else if (d > 2.7 && d < 6 && t >= m.nextLunge && inSight(target, head, 8)) lunge(c, m, target);
      if (d <= 1.8 && dy < 2.6) {                                   // right on you: it stops and swipes
        stop(c, m); mode(c, m, 'hold'); pose(c, m, m.crawl ? 'crawl_still' : 'hunting_stance');
        try { c.teleport(c.location, { facingLocation: target.getHeadLocation() }); } catch (e) { /* ok */ }
      } else pursue(c, m, target, 'run', runSpeed(target));
      // it is close: the dark closes in with it, and you feel its steps
      if (config.screen && d < 22 && t >= (m.nextDark ?? 0)) { try { target.addEffect('darkness', 70, { amplifier: 0, showParticles: false }); } catch (e) { /* ok */ } m.nextDark = t + 90; }
      if (d < 12 && m.walk && t % 10 < 5) shake(target, 0.04 + (12 - d) * 0.006, 0.25);
      if (inSight(target, head)) m.chaseEnd = Math.max(m.chaseEnd, t + 5 * TPS);      // while it can see you, it does not stop
      // it cannot reach you from here: when you next look, it is ahead of you
      if (m.noPath >= 30) { m.noPath = 0; m.lost = 0; if (!ahead(c, m, target) && !relocate(c, m, target, true)) retreat(c, m, target); }
      break;
    }
    case 'deep': {
      if (graspers.get(target.id) === m) { graspTick(c, m, target); break; }
      if (!target.isInWater || t >= m.until || !hunter(target)) {
        endChase(c, m);
        if (!target.isInWater && d < 12 && approach(c, m, target, false)) break;
        lurk(c, m, target);
        break;
      }
      const goal = add(target.location, { x: 0, y: -0.8, z: 0 });
      const canGrasp = config.grasp && preset().damage > 0 && health(target) > 6;
      if (d < 2.6 && !m.grasped && canGrasp) { m.swim = null; grasp(c, m, target); break; }
      if (d < 2.4 && t >= m.nextStrike) strike(c, m, target);                  // a bite as it passes
      if (d < 3 && (m.grasped || !canGrasp) && !(m.swim && m.swim.pass)) {     // past you, then round again, like a shark
        const a = Math.random() * Math.PI * 2;
        swimTo(c, m, add(target.location, { x: Math.cos(a) * 8, y: -2, z: Math.sin(a) * 8 }), 0.35, () => { m.grasped = m.grasped && m.passes++ < 1; }, undefined);
        if (m.swim) m.swim.pass = true;
        break;
      }
      // not the same water as you (another pool): it is simply under you, the moment nobody is looking
      const elsewhere = () => {
        const s = !seenByAnyone(c) ? waterAround(target, 5, 14, { depth: 3, allowView: false, tries: 16 }) : undefined;
        if (s && sink(c, m, s)) return;
        endChase(c, m);
        lurk(c, m, target);
      };
      if (!m.swim || (!m.swim.pass && flat(m.swim.goal, goal) > 2)) swimTo(c, m, goal, 0.42, undefined, elsewhere);
      break;
    }
    case 'ambush': {
      if (t % 10 < 5) particle(c.dimension, 'brine:bubbles', m.ambushAt);
      if (d > 10) { if (t >= m.until) lurk(c, m, target); break; }
      if (t >= m.until || (looksAt(target, m.ambushAt, 0.93) && chance(0.25))) burst(c, m, target);
      break;
    }
    case 'burst': {
      if (t >= m.until) {
        if (!hunter(target)) { retreat(c, m, target); break; }
        const b = bankNear(c, target);
        if (b && flat(b.water, c.location) < 7) climbOut(c, m, b.bank, target.getHeadLocation(), () => chase(c, m, target));
        else chase(c, m, target);
      }
      break;
    }
    case 'retreat': {
      if (inWater(c)) { vanish(c, m, target); break; }
      if (t >= m.retreatRun && !m.ran) {                            // it runs back the way you came
        m.ran = true;
        const r = routeAway(c, target);
        if (r && r.length) walk(c, m, r.slice(0, 50), 'run', { speed: SPEED.run * 0.9 });
      }
      if (t >= m.until || (m.ran && !m.walk) || (!inSight(target, head) && d > 14)) { vanish(c, m, target); break; }
      break;
    }
    case 'scare': break;
    case 'creep': {                                                 // it moves when you don't look
      eyes(c, m, d);
      if (seen && m.seenFor >= 4) spotted(c, m, target);
      if (seen && d < 5.5 && scareReady(target)) { jumpscare(c, m, target, chance(0.6) ? 'chase' : 'vanish'); break; }
      if (t >= m.until || m.steps >= 10) { if (hunter(target) && chance(0.5)) chase(c, m, target); else vanish(c, m, target); break; }
      if (!seen && m.unseenFor >= 10 && !seenByAnyone(c)) {
        const to = closer(c, target, d < 10 ? rand(2, 3.5) : rand(4, 7));
        if (to) {
          place(c, m, to);
          wrongPose(c, m, target, to);
          m.steps++;
          m.unseenFor = 0;
          m.spotted = false;
          sound(c.dimension, 'mob.brinesleeper.step', to, 0.8, 0.8);
          if (d < 14) { try { target.playSound('brine.heartbeat', { volume: 1 }); } catch (e) { /* ok */ } }
          if (d < 9 && chance(0.4)) whisper(target, pick(["...don't turn around...", '...it is closer than it was...', `...${target.name}...`]));
        }
      }
      break;
    }
    case 'rush': {                                                  // out of the dark, screaming, on all fours
      const dy = Math.abs(target.location.y - c.location.y);
      if (!m.rushing) {
        eyes(c, m, d);
        if (t >= m.rushAt || (seen && m.seenFor >= 10)) {
          m.rushing = true;
          sound(c.dimension, 'mob.brinesleeper.roar', head, 1.8, 1.1);
          try { target.playSound('music.brine.sting', { volume: 1 }); } catch (e) { /* ok */ }
          press(target.id, 'chase', t + 160);
          m.spotted = false;
          spotted(c, m, target);
        }
        break;
      }
      if (d < 2.6 && dy < 2.6) { if (hunter(target) && scareReady(target)) jumpscare(c, m, target, chance(0.5) ? 'chase' : 'vanish'); else chase(c, m, target); break; }
      pursue(c, m, target, 'run', 0.5);
      if (d < 14 && t % 6 < 5) shake(target, 0.12, 0.3);
      if (t >= m.until || m.noPath >= 20) chase(c, m, target);
      break;
    }
    case 'ceiling': {                                               // above you, dripping on you
      if (t % 20 < 5) {
        particle(c.dimension, 'brine:drips', add(target.getHeadLocation(), { x: rand(-0.3, 0.3), y: 0.5, z: rand(-0.3, 0.3) }));
        if (chance(0.6)) sound(c.dimension, 'brine.fx.drip', target.getHeadLocation(), 0.9, rand(0.9, 1.1));
      }
      const up = target.getViewDirection().y > 0.4 && looksAt(target, head, 0.75, 20);
      if (up || flat(target.location, m.floorAt) < 1.4) {             // you looked up (or walked under it): it drops
        if (hunter(target) && scareReady(target)) jumpscare(c, m, target, chance(0.5) ? 'chase' : 'vanish');
        else { stop(c, m); place(c, m, m.floorAt, target.getHeadLocation()); standoff(c, m, target); }
        break;
      }
      if (t >= m.until || d > 14) vanish(c, m, target);
      break;
    }
    default: lurk(c, m, target);
  }
}
/** the sounds you make, made again behind you a moment later */
function mimic(target) {
  const v = target.getViewDirection();
  const back = add(target.location, { x: -v.x * rand(8, 14), y: 0, z: -v.z * rand(8, 14) });
  const kind = pick(['step', 'step', 'dig', 'hurt']);
  if (kind === 'step') {
    for (let i = 0; i < 3; i++) system.runTimeout(() => { try { target.dimension.playSound('step.stone', back, { volume: 0.7, pitch: 0.9 }); } catch (e) { /* ok */ } }, i * 7);
  } else if (kind === 'dig') {
    try { target.dimension.playSound('dig.stone', back, { volume: 0.8, pitch: 0.85 }); } catch (e) { /* ok */ }
  } else {
    try { target.dimension.playSound('game.player.hurt', back, { volume: 0.6, pitch: 0.7 }); } catch (e) { /* ok */ }
  }
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
    let spawn;
    try { spawn = p.getSpawnPoint(); } catch (e) { spawn = undefined; }
    const tod = world.getTimeOfDay();
    const night = tod > 13000 && tod < 23000;
    const atHome = !!spawn && spawn.dimension.id === p.dimension.id && Math.hypot(spawn.x - p.location.x, spawn.z - p.location.z) < 40;
    const homeVisit = atHome && night && pr.bold > 0.65 && pr.homeDay !== world.getDay() && chance(0.2);
    const follow = (away.get(p.id) ?? 0) >= 90 * TPS && (itsHour(p) || nearWater(p.dimension, p.location, 8));
    if (!homeVisit && !follow) continue;
    // any water it can use (a dripstone cave lake, a river, the pond by your door), else your own trail, behind you
    const w = waterAround(p, 26, 48, { depth: 3, tries: 24 });
    const ts = !w ? trailSpot(p, 26, 50) : undefined;
    const f = !w && !ts ? spot(p, 'floor', 30, 50, { room: 5, eyeHeight: 3.2, tries: 24 }) : undefined;
    const to = w ? under(w, LURK_DEPTH) : ts ? ts.p : f;
    if (!to) continue;
    let cr = c;
    try {
      if (!cr) { cr = overworld().spawnEntity(CREATURE, to); cr.triggerEvent(`brine:threat_${config.threat}`); }
      else if (!seenByAnyone(cr)) cr.teleport(to);
      else continue;
    } catch (e) { continue; }
    const mm = mindOf(cr);
    stop(cr, mm);
    fit(cr, mm, to);
    if (w) { mm.hold = to; mode(cr, mm, 'hold'); pose(cr, mm, 'idle_water'); } else { mode(cr, mm, 'observe'); pose(cr, mm, 'shadow_hide'); }
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
    if (inStillwater(p.dimension, p.location)) whisper(p, chance(0.3) ? `...${p.name}...` : undefined);
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
  if (['standoff', 'stalk', 'idle', 'watch', 'lurk', 'hidden'].includes(m.state)) {
    if (inWater(hurtEntity) && hunter(p) && p.isInWater) deep(hurtEntity, m, p);
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

// ------------------------------------------------------------------ testing (the settings wheel): make one happen to you now
export function provoke(player, kind) {
  let c = creatures().find((e) => !e.hasTag(STAGED));
  if (!c) {
    const s = spot(player, 'floor', 18, 28, { room: 5, eyeHeight: 3.2, tries: 30 }) ?? spot(player, 'floor', 8, 16, { room: 4, allowView: true, tries: 30 });
    if (!s) return false;
    try { c = overworld().spawnEntity(CREATURE, s); c.triggerEvent(`brine:threat_${config.threat}`); } catch (e) { return false; }
  }
  const m = mindOf(c);
  lastScare.delete(player.id);
  m.cooldownUntil = 0;
  if (kind === 'jumpscare') return jumpscare(c, m, player, 'vanish');
  if (kind === 'creep') return creep(c, m, player);
  if (kind === 'rush') return rush(c, m, player);
  if (kind === 'ceiling') return ceiling(c, m, player);
  if (kind === 'chase') { chase(c, m, player); return true; }
  return false;
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
  recordTrails();
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
    if (!m || c.hasTag(STAGED)) continue;
    try { stepPlan(c, m); motor(c, m); animate(c, m); } catch (e) { /* gone */ }
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
