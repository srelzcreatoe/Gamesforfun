// Shin Godzilla add-on: gameplay script (@minecraft/server 2.0.0, stable APIs only).
//
// Drives everything the data-driven entity files can't: the atomic breath
// (smoke -> fire -> concentrated purple beam), dorsal plate rays, the tail
// beam, footstep quakes, bulldozing through terrain, energy + dormancy, the
// Yashiori Strategy (coagulant freezing), evolution between forms, and the
// Kaiju Control Tablet settings menu.
import { world, system, MolangVariableMap, ItemStack, EntityDamageCause } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { ANCHORS } from "./anchors.js";

const F2 = "sg:shin_godzilla_2";
const F3 = "sg:shin_godzilla_3";
const F4 = "sg:shin_godzilla";
const KAIJU = new Set([F2, F3, F4]);
const NAMES = { [F2]: "2nd Form (Kamata-kun)", [F3]: "3rd Form (Shinagawa-kun)", [F4]: "4th Form" };
const DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const ABILITY_STATES = new Set(["charge", "smoke", "fire", "focus", "beam", "dorsal", "tail", "waking", "evolving"]);
const DOSES_NEEDED = 6;
const DORMANT_TICKS = 2400;
const PROTECTED = new Set([
  "minecraft:bedrock", "minecraft:barrier", "minecraft:command_block", "minecraft:chain_command_block",
  "minecraft:repeating_command_block", "minecraft:structure_block", "minecraft:structure_void", "minecraft:jigsaw",
  "minecraft:end_portal_frame", "minecraft:end_portal", "minecraft:portal", "minecraft:end_gateway",
  "minecraft:light_block", "minecraft:allow", "minecraft:deny", "minecraft:border_block",
  "minecraft:reinforced_deepslate", "minecraft:obsidian", "minecraft:crying_obsidian", "minecraft:respawn_anchor",
]);
const NON_LIVING = new Set(["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:snowball",
  "minecraft:egg", "minecraft:ender_pearl", "minecraft:fireball", "minecraft:small_fireball", "minecraft:tnt",
  "minecraft:falling_block", "minecraft:painting", "minecraft:leash_knot", "minecraft:armor_stand",
  "minecraft:xp_bottle", "minecraft:splash_potion", "minecraft:lingering_potion", "minecraft:trident",
  "minecraft:fishing_hook", "minecraft:area_effect_cloud", "minecraft:wind_charge_projectile"]);

// ------------------------------------------------------------------ settings
const DEFAULTS = { griefing: true, mode: "movie", evo: "normal", size: "full", shake: true };
const S = { ...DEFAULTS };
const SIZE_SCALE = { full: 1, half: 0.5, quarter: 0.25 };
const MODE_LABEL = { movie: "Movie-accurate (retaliates)", hunt: "Hunter (attacks players)", peaceful: "Peaceful" };
const EVO_LABEL = { normal: "Normal (3-4 min)", fast: "Fast (45-60 s)", off: "Off" };
const SIZE_LABEL = { full: "Movie scale (48 blocks)", half: "Half (24 blocks)", quarter: "Quarter (12 blocks)" };

function loadSettings() {
  for (const k of Object.keys(DEFAULTS)) {
    const v = world.getDynamicProperty("sg:" + k);
    if (v !== undefined) S[k] = v;
  }
}
function setSetting(k, v) {
  S[k] = v;
  world.setDynamicProperty("sg:" + k, v);
}

// ------------------------------------------------------------------ math
const D2R = Math.PI / 180;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const dist = (a, b) => len(sub(a, b));
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const wrap180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
const dirFromAngles = (yaw, pitch) => ({
  x: -Math.sin(yaw * D2R) * Math.cos(pitch * D2R),
  y: -Math.sin(pitch * D2R),
  z: Math.cos(yaw * D2R) * Math.cos(pitch * D2R),
});
const anglesFromDir = (d) => ({ yaw: Math.atan2(-d.x, d.z) / D2R, pitch: -Math.asin(clamp(d.y, -1, 1)) / D2R });

function scaleOf(e) {
  try {
    const c = e.getComponent("minecraft:scale");
    if (c && typeof c.value === "number") return c.value;
  } catch { /* ignore */ }
  return 1;
}

/** Model-space offset (blocks; model faces -z) -> world position. */
function toWorld(e, off, sc, yaw) {
  const y = (yaw ?? e.getRotation().y) * D2R;
  const fx = -Math.sin(y), fz = Math.cos(y);
  const rx = -Math.cos(y), rz = -Math.sin(y);
  const L = e.location;
  return { x: L.x + (rx * off[0] - fx * off[2]) * sc, y: L.y + off[1] * sc, z: L.z + (rz * off[0] - fz * off[2]) * sc };
}

function lerpTable(tab, a) {
  // tab: [[aim, x, y, z], ...] sorted by aim
  if (a <= tab[0][0]) return tab[0].slice(1);
  for (let i = 1; i < tab.length; i++) {
    if (a <= tab[i][0]) {
      const t = (a - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
      return [1, 2, 3].map((k) => tab[i - 1][k] + (tab[i][k] - tab[i - 1][k]) * t);
    }
  }
  return tab[tab.length - 1].slice(1);
}

// ------------------------------------------------------------------ fx helpers
function particle(dim, id, loc, vars) {
  try { dim.spawnParticle(id, loc, vars); } catch { /* unloaded chunk */ }
}
function sound(dim, id, loc, volume = 1, pitch = 1) {
  try { dim.playSound(id, loc, { volume, pitch }); } catch { /* ignore */ }
}
function dirVars(d, extra) {
  const v = new MolangVariableMap();
  v.setFloat("variable.dx", d.x);
  v.setFloat("variable.dy", d.y);
  v.setFloat("variable.dz", d.z);
  if (extra) for (const k of Object.keys(extra)) v.setFloat("variable." + k, extra[k]);
  return v;
}

function shake(dim, center, radius, strength, seconds) {
  if (!S.shake) return;
  for (const p of dim.getPlayers({ location: center, maxDistance: radius })) {
    const k = 1 - dist(p.location, center) / radius;
    const s = clamp(strength * (0.25 + 0.75 * k), 0.02, 4);
    try { p.runCommand(`camerashake add @s ${s.toFixed(2)} ${seconds.toFixed(2)} positional`); } catch { /* ignore */ }
  }
}

function isLiving(en) {
  if (NON_LIVING.has(en.typeId)) return false;
  try { return !!en.getComponent("minecraft:health"); } catch { return false; }
}
function center(en) {
  const L = en.location;
  return { x: L.x, y: L.y + 0.9, z: L.z };
}
function isSpectator(p) {
  try { return p.getGameMode && String(p.getGameMode()).toLowerCase() === "spectator"; } catch { return false; }
}

function hurt(en, amount, src, fire = 0) {
  try {
    en.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: src });
    if (fire > 0) en.setOnFire(fire, true);
  } catch { /* ignore */ }
}

function distPointRay(p, o, d, l) {
  const v = sub(p, o);
  const t = clamp(v.x * d.x + v.y * d.y + v.z * d.z, 0, l);
  return dist(p, add(o, mul(d, t)));
}

function damageAlongRay(src, o, d, l, radius, amount, fire) {
  const dim = src.dimension;
  const mid = add(o, mul(d, l / 2));
  let ents = [];
  try { ents = dim.getEntities({ location: mid, maxDistance: l / 2 + radius + 3 }); } catch { return; }
  for (const en of ents) {
    if (en.id === src.id || KAIJU.has(en.typeId) || !isLiving(en)) continue;
    if (distPointRay(center(en), o, d, l) <= radius) hurt(en, amount, src, fire);
  }
}

// ------------------------------------------------------------------ terrain
let blockBudget = 0;
function canGrief() { return !!S.griefing; }
function smash(dim, x, y, z) {
  if (blockBudget <= 0) return false;
  blockBudget--;
  try {
    const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
    if (!b || b.isAir || b.isLiquid || PROTECTED.has(b.typeId)) return false;
    b.setType("minecraft:air");
    return true;
  } catch { return false; }
}

/** Clear a vertical slab ahead of a kaiju (walking through buildings/forests). */
function bulldoze(e, sc, ahead, halfW, y0, y1) {
  if (!canGrief()) return 0;
  const dim = e.dimension;
  const yaw = e.getRotation().y * D2R;
  const f = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  const r = { x: -Math.cos(yaw), z: -Math.sin(yaw) };
  const L = e.location;
  let n = 0;
  const seen = new Set();
  for (let w = -halfW * sc; w <= halfW * sc; w += 0.9) {
    const bx = L.x + f.x * ahead * sc + r.x * w;
    const bz = L.z + f.z * ahead * sc + r.z * w;
    for (let h = Math.max(1, Math.floor(y0 * sc)); h <= y1 * sc; h++) {
      const key = `${Math.floor(bx)},${Math.floor(L.y + h)},${Math.floor(bz)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (smash(dim, bx, L.y + h, bz)) n++;
    }
  }
  if (n > 6) {
    const c = { x: L.x + f.x * ahead * sc, y: L.y + (y0 + y1) * 0.35 * sc, z: L.z + f.z * ahead * sc };
    particle(dim, "sg:debris", c);
    if (Math.random() < 0.4) sound(dim, "sg.crash", c, 2.5, rand(0.8, 1.1));
  }
  return n;
}

function crater(dim, c, r) {
  if (!canGrief()) return;
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) for (let y = 0; y <= Math.ceil(r * 0.6); y++) {
    if (x * x + z * z + y * y * 2 <= r * r) smash(dim, c.x + x, c.y + y, c.z + z);
  }
}

// ------------------------------------------------------------------ state
const K = new Map(); // entity id -> runtime state
let tracked = [];

function getProp(e, id) { try { return e.getProperty(id); } catch { return undefined; } }
function setProp(e, id, v) { try { if (e.getProperty(id) !== v) e.setProperty(id, v); } catch { /* ignore */ } }
function trigger(e, ev) { try { e.triggerEvent(ev); } catch { /* ignore */ } }

function st(e) {
  let s = K.get(e.id);
  if (!s) {
    s = {
      energy: 100, act: null, t: 0, walked: 0, foot: 0, last: { ...e.location }, target: undefined, targetT: 0,
      cd: { breath: 160, dorsal: 300, tail: 240, stomp: 60, roar: 200, growl: 400, bull: 0, gill: 0 },
      age: Number(e.getDynamicProperty("sg:age") ?? 0),
      dormantT: Number(e.getDynamicProperty("sg:dormant") ?? 0),
      doses: Number(e.getDynamicProperty("sg:doses") ?? 0),
      yaw: e.getRotation().y, pitch: 20, aimPoint: undefined, evolveT: 0, dyingT: 0, roarT: 0,
    };
    K.set(e.id, s);
    firstSight(e, s);
  }
  return s;
}

function firstSight(e, s) {
  const state = getProp(e, "sg:state");
  if (!e.getDynamicProperty("sg:init")) {
    e.setDynamicProperty("sg:init", true);
    applyMode(e);
    applySize(e);
  }
  if (state && ABILITY_STATES.has(state) && state !== "evolving") {
    // world was saved mid-ability: return to normal
    trigger(e, "sg:unlock");
    setProp(e, "sg:state", "walk");
    setProp(e, "sg:glow", 0);
  }
  if (state === "evolving") {
    s.evolveT = 1;
  }
  if (state === "roar") startRoar(e, s, true);
  if (state === "dormant" && s.dormantT <= 0) s.dormantT = DORMANT_TICKS;
}

function applyMode(e) {
  const state = getProp(e, "sg:state");
  if (state === "dormant" || state === "frozen" || state === "dying") return;
  trigger(e, "sg:mode_" + S.mode);
}
function applySize(e) { trigger(e, "sg:size_" + S.size); }

function refreshTracked() {
  const list = [];
  for (const id of DIMS) {
    let dim;
    try { dim = world.getDimension(id); } catch { continue; }
    try {
      for (const e of dim.getEntities({ families: ["kaiju"] })) if (KAIJU.has(e.typeId)) list.push(e);
    } catch { /* ignore */ }
  }
  tracked = list;
  const live = new Set(list.map((e) => e.id));
  for (const id of [...K.keys()]) if (!live.has(id)) K.delete(id);
}

// ------------------------------------------------------------------ targets
function validTarget(s) {
  const t = s.target;
  if (!t) return undefined;
  try {
    if (!t.isValid) return undefined;
    if (t.typeId === "minecraft:player" && isSpectator(t)) return undefined;
    const h = t.getComponent("minecraft:health");
    if (h && h.currentValue <= 0) return undefined;
  } catch { return undefined; }
  return t;
}

function findTarget(e, s, sc) {
  let t = validTarget(s);
  if (t && dist(t.location, e.location) > 140 * Math.max(sc, 0.5)) t = undefined;
  if (!t && S.mode === "hunt") {
    let best, bd = 64 * Math.max(sc, 0.5);
    for (const p of e.dimension.getPlayers({ location: e.location, maxDistance: bd })) {
      let gm = "";
      try { gm = String(p.getGameMode()).toLowerCase(); } catch { /* ignore */ }
      if (gm === "creative" || gm === "spectator") continue;
      const d = dist(p.location, e.location);
      if (d < bd) { bd = d; best = p; }
    }
    t = best;
  }
  if (S.mode === "peaceful" && !s.forced) t = undefined;
  s.target = t;
  return t;
}

// ------------------------------------------------------------------ abilities (4th form)
const A4 = ANCHORS.f4;

function mouthPos(e, s, sc) {
  return toWorld(e, lerpTable(A4.mouth_by_aim, clamp(s.aimProp ?? 0, -35, 75)), sc, s.yaw);
}

function startAbility(e, s, name) {
  s.act = { name, t: 0 };
  trigger(e, "sg:lock");
  s.yaw = e.getRotation().y;
  s.pitch = 0;
  s.aimProp = 0;
}
function endAbility(e, s) {
  s.act = null;
  s.forced = false;
  s.aimPoint = undefined;
  setProp(e, "sg:glow", 0);
  setProp(e, "sg:aim", 0);
  if (s.energy <= 8) {
    goDormant(e, s);
  } else {
    trigger(e, "sg:unlock");
    setProp(e, "sg:state", "walk");
    applyMode(e);
  }
}

function faceTowards(e, s, yaw) {
  const d = wrap180(yaw - s.yaw);
  s.yaw = s.yaw + clamp(d, -2.4, 2.4);
  if (Math.abs(wrap180(e.getRotation().y - s.yaw)) > 0.6) {
    try { e.teleport(e.location, { rotation: { x: 0, y: s.yaw } }); } catch { /* ignore */ }
  }
}

/**
 * Update the aim (yaw of body, pitch of beam) toward target / commanded point.
 * forcePitch: used while smoke and fire pour straight down before the beam forms.
 */
function aim(e, s, sc, origin, sweep, forcePitch) {
  let goal;
  const t = validTarget(s);
  if (s.aimPoint) goal = s.aimPoint;
  else if (t) goal = center(t);
  let yaw, pitch;
  if (goal) {
    const a = anglesFromDir(norm(sub(goal, origin)));
    yaw = a.yaw;
    pitch = a.pitch;
  } else {
    // no target: carve a slow arc across the land in front, rising toward the horizon
    yaw = s.baseYaw + Math.sin(s.act.t * 0.03) * 38;
    pitch = Math.max(2, 46 - Math.max(0, s.act.t - 130) * 0.3);
  }
  if (forcePitch !== undefined) pitch = forcePitch;
  if (sweep) yaw += Math.sin(s.act.t * 0.09) * 4;
  faceTowards(e, s, yaw);
  s.pitch += clamp(wrap180(pitch - s.pitch), -1.5, 1.5);
  s.aimProp = clamp(s.pitch, -35, 75);
  setProp(e, "sg:aim", Math.round(s.aimProp));
  return dirFromAngles(s.yaw, s.pitch);
}

function drawBeam(dim, o, d, l, thick) {
  const v = dirVars(d, { len: 2.4 * thick });
  const step = 2.0;
  for (let i = 0; i * step < l; i++) {
    const p = add(o, mul(d, i * step + 1));
    particle(dim, thick > 1.5 ? "sg:beam_core" : "sg:ray_core", p, v);
  }
  const g = dirVars(d, { len: 3.5 * thick });
  for (let i = 0; i * 3.5 < l; i++) {
    particle(dim, thick > 1.5 ? "sg:beam_glow" : "sg:ray_glow", add(o, mul(d, i * 3.5 + 1.5)), g);
  }
}

function castBeam(e, o, d, maxLen) {
  let l = maxLen, hit;
  try {
    hit = e.dimension.getBlockFromRay(o, d, { maxDistance: maxLen, includeLiquidBlocks: false, includePassableBlocks: false });
  } catch { hit = undefined; }
  if (hit) {
    const b = hit.block.location;
    const p = { x: b.x + hit.faceLocation.x, y: b.y + hit.faceLocation.y, z: b.z + hit.faceLocation.z };
    l = Math.max(2, dist(o, p));
  }
  return { l, hit: hit ? add(o, mul(d, l)) : undefined };
}

function explodeAt(e, p, r, fire) {
  try {
    e.dimension.createExplosion(p, r, { breaksBlocks: canGrief(), causesFire: fire && canGrief(), source: e });
  } catch { /* ignore */ }
}

// Atomic breath, staged like the film and cut to the heat-ray sound's timeline
// (phase start ticks come from the build, so sound, animation and damage stay in step):
//   charge   plates stutter and catch purple, the eye membranes close, the head bows
//   smoke    the jaw unhinges and thick black smoke pours down over the ground
//   fire     the smoke ignites into a flood of orange fire that spreads across everything below
//   focus    the stream burns white, then magenta, and tightens as the lower jaw parts
//   beam     the jaw is split in two; a thin violet beam, the head rising to sweep it across the target
//   sputter  the beam breaks up and dies
const BREATH = ANCHORS.timing.breath;
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ORANGE = [1.0, 0.5, 0.12], WHITE = [1.0, 0.95, 0.8], MAGENTA = [1.0, 0.22, 0.72], VIOLET = [0.72, 0.4, 1.0];

function stream(dim, mouth, d, sc, col, spread, speed, size) {
  particle(dim, "sg:breath_stream", mouth, dirVars(d, { spd: speed, spread, size, cr: col[0], cg: col[1], cb: col[2] }));
}

function haze(e, sc) {
  const pts = A4.dorsal;
  const p = toWorld(e, pts[Math.floor(Math.random() * pts.length)], sc);
  const v = new MolangVariableMap();
  v.setFloat("variable.size", 16 * sc + 4);
  particle(e.dimension, "sg:haze", p, v);
}

/** Fire reaching the ground: flames, burning blocks, and now and then something going up. */
function floodFire(e, mouth, d, sc, t) {
  const dim = e.dimension;
  const range = 70 * sc + 12;
  for (let i = 0; i < 2; i++) {
    const dd = norm(add(d, { x: rand(-0.22, 0.22), y: rand(-0.05, 0.12), z: rand(-0.22, 0.22) }));
    const r = castBeam(e, mouth, dd, range);
    if (!r.hit) continue;
    const g = add(r.hit, { x: 0, y: 1, z: 0 });
    particle(dim, "sg:ground_fire", g);
    if (canGrief()) {
      try {
        const above = dim.getBlock({ x: Math.floor(r.hit.x), y: Math.floor(r.hit.y) + 1, z: Math.floor(r.hit.z) });
        if (above && above.isAir) above.setType("minecraft:fire");
      } catch { /* ignore */ }
      if (t % 14 === 0 && i === 0) explodeAt(e, r.hit, 2.4 * Math.max(sc, 0.5) + 0.6, true);
    }
  }
  if (t % 5 === 0) {
    for (const en of dim.getEntities({ location: mouth, maxDistance: range })) {
      if (en.id === e.id || KAIJU.has(en.typeId) || !isLiving(en)) continue;
      const v = sub(center(en), mouth);
      const cos = (v.x * d.x + v.y * d.y + v.z * d.z) / (len(v) || 1);
      if (cos > 0.84) hurt(en, 6, e, 6);
    }
  }
}

function tickBreath(e, s, sc) {
  const a = s.act, dim = e.dimension;
  const t = a.t;
  if (t === 0) {
    setProp(e, "sg:state", "charge");
    s.baseYaw = s.yaw;
    s.pitch = 0;
    sound(dim, "sg.charge", e.location, 6 * sc + 2);
    warn(e, "§5☢ §dShin Godzilla's dorsal plates are glowing... §5☢");
  }
  const mouth = mouthPos(e, s, sc);
  if (t % 6 === 0) haze(e, sc);
  if (t < BREATH.smoke) {
    // the glow stutters on, faster and faster, then holds
    const on = t >= BREATH.smoke * 0.7 || Math.sin(t * t * 0.045) > 0;
    setProp(e, "sg:glow", on ? 1 : 0);
    if (t % 2 === 0) dorsalSparks(e, sc);
    if (t % 4 === 0 && t > 16) particle(dim, "sg:mouth_glow", mouth);
    aim(e, s, sc, mouth, false, 58);
    return;
  }
  setProp(e, "sg:glow", 1);
  if (t % 3 === 0) dorsalSparks(e, sc);
  if (t < BREATH.fire) {
    const d = aim(e, s, sc, mouth, false, 58);
    if (t === BREATH.smoke) { setProp(e, "sg:state", "smoke"); sound(dim, "sg.breath_smoke", mouth, 8 * sc + 3); }
    particle(dim, "sg:smoke_plume", mouth, dirVars(d, { spd: 10 * sc + 4 }));
    if (t % 3 === 0) particle(dim, "sg:mouth_glow", mouth);
    if (t % 4 === 0) {
      const r = castBeam(e, mouth, d, 70 * sc + 10);   // smoke rolls out across the ground
      if (r.hit) particle(dim, "sg:smoke_plume", add(r.hit, { x: 0, y: 1, z: 0 }), dirVars(norm({ x: d.x, y: 0.05, z: d.z }), { spd: 8 * sc + 3 }));
    }
    return;
  }
  if (t < BREATH.focus) {
    // slow side-to-side wash of fire over the ground in front of it
    const d = aim(e, s, sc, mouth, true, 52);
    if (t === BREATH.fire) {
      setProp(e, "sg:state", "fire");
      sound(dim, "sg.breath_fire", mouth, 10 * sc + 3);
      shake(dim, e.location, 80 * sc + 20, 0.4, 1.0);
    }
    stream(dim, mouth, d, sc, ORANGE, 0.2, 30 * sc + 9, 1.3 * sc + 0.5);
    particle(dim, "sg:fire_spray", mouth, dirVars(d, { spd: 26 * sc + 8 }));
    if (t % 4 === 0) particle(dim, "sg:smoke_plume", mouth, dirVars(d, { spd: 12 * sc + 4 }));
    floodFire(e, mouth, d, sc, t);
    if (t % 12 === 0) shake(dim, e.location, 60 * sc + 16, 0.2, 0.7);
    return;
  }
  if (t < BREATH.beam) {
    // orange -> white-hot -> magenta, tightening into a line
    const k = (t - BREATH.focus) / (BREATH.beam - BREATH.focus);
    const d = aim(e, s, sc, mouth, false, 50 - 4 * k);
    if (t === BREATH.focus) { setProp(e, "sg:state", "focus"); sound(dim, "sg.breath_focus", mouth, 10 * sc + 3); }
    const col = k < 0.35 ? lerp3(ORANGE, WHITE, k / 0.35) : k < 0.75 ? lerp3(WHITE, MAGENTA, (k - 0.35) / 0.4) : lerp3(MAGENTA, VIOLET, (k - 0.75) / 0.25);
    stream(dim, mouth, d, sc, col, 0.2 - 0.17 * k, (30 + 50 * k) * sc + 9, (1.3 - 0.7 * k) * sc + 0.4);
    if (k < 0.5) floodFire(e, mouth, d, sc, t);
    if (k > 0.45) {
      const r = castBeam(e, mouth, d, 90 * Math.max(sc, 0.35));
      drawBeam(dim, mouth, d, r.l, 0.9 + 0.8 * k);
      if (r.hit) particle(dim, "sg:beam_impact", r.hit);
    }
    particle(dim, "sg:mouth_glow", mouth);
    return;
  }
  if (t < BREATH.end) {
    const d = aim(e, s, sc, mouth, true);
    if (t === BREATH.beam) {
      setProp(e, "sg:state", "beam");
      sound(dim, "sg.breath_beam", mouth, 12 * sc + 4);
      shake(dim, e.location, 90 * sc + 20, 0.6, 1.2);
      warn(e, "§d§l☢ ATOMIC BREATH ☢");
    }
    const sputter = t >= BREATH.sputter;
    const live = !sputter || (t % 5 < 3);
    const maxLen = 150 * Math.max(sc, 0.35);
    const r = castBeam(e, mouth, d, maxLen);
    if (live) {
      drawBeam(dim, mouth, d, r.l, (sputter ? 1.4 : 2.0) * Math.max(sc, 0.4) + 0.4);
      if (r.hit) {
        particle(dim, "sg:beam_impact", r.hit);
        if (t % 3 === 0) explodeAt(e, r.hit, 3.2 * Math.max(sc, 0.5) + 0.8, true);
      }
      if (t % 4 === 0) damageAlongRay(e, mouth, d, r.l, 2.2 * Math.max(sc, 0.5), 14, 5);
    } else {
      stream(dim, mouth, d, sc, MAGENTA, 0.12, 30 * sc + 9, 0.8 * sc + 0.4);
    }
    if (t % 2 === 0) particle(dim, "sg:mouth_glow", mouth);
    if (t % 10 === 0) shake(dim, e.location, 70 * sc + 16, 0.25, 0.6);
    return;
  }
  s.energy -= 40;
  s.cd.breath = 600;
  endAbility(e, s);
}

/** Short action-bar line for everyone near a kaiju. */
function warn(e, text, range = 128) {
  try {
    for (const p of e.dimension.getPlayers({ location: e.location, maxDistance: range })) p.onScreenDisplay.setActionBar(text);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ boss bar title
// The boss bar shows the kaiju's name tag, so the script keeps a live title there:
// form, what it is doing, and its atomic energy (or evolution progress) as a row of pips.
const STATE_LABEL = {
  roar: "§6ROARING", charge: "§dPLATES GLOWING", smoke: "§8SMOKE", fire: "§6FIRE", focus: "§dFOCUSING", beam: "§d§lATOMIC BREATH",
  dorsal: "§d§lDORSAL RAYS", tail: "§d§lTAIL BEAM", waking: "§cAWAKENING", frozen: "§b§lFROZEN", dying: "§7FALLING", evolving: "§e§lEVOLVING",
};
function pips(frac, on, off, n = 10) {
  const k = Math.round(clamp(frac, 0, 1) * n);
  return on + "▮".repeat(k) + off + "▮".repeat(n - k);
}
function updateTitle(e, s, state) {
  let title;
  if (e.typeId === F4) {
    let st = STATE_LABEL[state] ?? "";
    if (state === "dormant") {
      const sec = Math.max(0, Math.ceil(s.dormantT / 20));
      st = `§bDORMANT §7${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} §8| §bCoagulant ${s.doses}/${DOSES_NEEDED}`;
    }
    title = `§5§lSHIN GODZILLA§r §8| §dENERGY ${pips(s.energy / 100, "§5", "§8")}§r${st ? " §8| " + st : ""}`;
  } else {
    const name = e.typeId === F3 ? "3rd Form" : "2nd Form";
    const th = evoThreshold(e);
    const prog = th === Infinity ? "" : ` §8| §eEVOLUTION ${pips(s.age / th, "§6", "§8")}`;
    const st = STATE_LABEL[state];
    title = `§c§lSHIN GODZILLA§r §7${name}${prog}§r${st ? " §8| " + st : ""}`;
  }
  if (title !== s.title) {
    s.title = title;
    try { e.nameTag = title; } catch { /* ignore */ }
  }
}

function dorsalPoints(e, sc) {
  return A4.dorsal.map((p) => toWorld(e, p, sc));
}
function dorsalSparks(e, sc) {
  const pts = dorsalPoints(e, sc);
  for (let i = 0; i < 3; i++) particle(e.dimension, "sg:dorsal_glow", pts[Math.floor(Math.random() * pts.length)]);
}

function airborneTargets(e, sc) {
  const out = [];
  const R = 96 * Math.max(sc, 0.5);
  let ents = [];
  try { ents = e.dimension.getEntities({ location: e.location, maxDistance: R }); } catch { return out; }
  for (const en of ents) {
    if (KAIJU.has(en.typeId) || !isLiving(en)) continue;
    if (en.typeId === "minecraft:player" && isSpectator(en)) continue;
    const high = en.location.y - e.location.y > 10 * sc;
    const flyer = ["minecraft:phantom", "minecraft:ghast", "minecraft:blaze", "minecraft:bee", "minecraft:parrot",
      "minecraft:bat", "minecraft:allay", "minecraft:vex", "minecraft:breeze", "minecraft:wither", "minecraft:ender_dragon"].includes(en.typeId);
    if (high || flyer) out.push(en);
  }
  return out.slice(0, 8);
}

function tickDorsal(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  if (t === 0) {
    setProp(e, "sg:state", "dorsal");
    setProp(e, "sg:glow", 1);
    sound(dim, "sg.charge", e.location, 6 * sc + 2, 1.15);
    a.targets = airborneTargets(e, sc);
    a.seed = Math.random() * 360;
  }
  if (t < 30) { dorsalSparks(e, sc); return; }
  if (t === 30) { sound(dim, "sg.rays", e.location, 12 * sc + 4); shake(dim, e.location, 80 * sc + 16, 0.4, 1.0); warn(e, "§d§l☢ DORSAL RAYS ☢"); }
  if (t < 150) {
    const pts = dorsalPoints(e, sc);
    if (t % 15 === 0) a.targets = airborneTargets(e, sc);
    const tg = a.targets.filter((x) => { try { return x.isValid; } catch { return false; } });
    const n = Math.min(pts.length, 12);
    for (let i = 0; i < n; i++) {
      const o = pts[(i * 7 + t) % pts.length];
      let d;
      const victim = tg.length ? tg[i % tg.length] : undefined;
      if (victim && i % 2 === 0) {
        d = norm(sub(center(victim), o));
      } else {
        // fan of rays sweeping through the sky in all directions
        const yaw = a.seed + i * (360 / n) + t * 1.6;
        const pitch = -(40 + 30 * Math.sin((t + i * 20) * 0.05));
        d = dirFromAngles(yaw, pitch);
      }
      const r = castBeam(e, o, d, 90 * Math.max(sc, 0.4));
      drawBeam(dim, o, d, r.l, 0.9);
      if (r.hit && t % 6 === i % 6) {
        particle(dim, "sg:beam_impact", r.hit);
        if (i % 3 === 0) explodeAt(e, r.hit, 2.2, false);
      }
      if (t % 4 === 0) damageAlongRay(e, o, d, r.l, 1.6, 9, 3);
    }
    return;
  }
  s.energy -= 30;
  s.cd.dorsal = 700;
  endAbility(e, s);
}

function tickTail(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  if (t === 0) {
    setProp(e, "sg:state", "tail");
    setProp(e, "sg:glow", 1);
    sound(dim, "sg.charge", e.location, 5 * sc + 2, 1.3);
  }
  const tip = toWorld(e, A4.tail_tip, sc);
  if (t < 26) { particle(dim, "sg:mouth_glow", tip); return; }
  if (t === 26) sound(dim, "sg.rays", tip, 10 * sc + 4, 1.12);
  if (t < 110) {
    let d;
    const tg = validTarget(s);
    if (s.aimPoint) d = norm(sub(s.aimPoint, tip));
    else if (tg) d = norm(sub(center(tg), tip));
    else d = norm(add(toDir(e, A4.tail_dir), { x: 0, y: Math.sin(t * 0.05) * 0.2, z: 0 }));
    a.d = a.d ? norm(add(mul(a.d, 0.85), mul(d, 0.15))) : d;
    const r = castBeam(e, tip, a.d, 90 * Math.max(sc, 0.4));
    drawBeam(dim, tip, a.d, r.l, 1.3);
    if (r.hit) {
      particle(dim, "sg:beam_impact", r.hit);
      if (t % 4 === 0) explodeAt(e, r.hit, 2.8, true);
    }
    if (t % 4 === 0) damageAlongRay(e, tip, a.d, r.l, 1.8, 11, 4);
    return;
  }
  s.energy -= 20;
  s.cd.tail = 500;
  endAbility(e, s);
}

function toDir(e, v) {
  const p0 = toWorld(e, [0, 0, 0], 1);
  return norm(sub(toWorld(e, v, 1), p0));
}

function startRoar(e, s, fromTransform) {
  const dim = e.dimension, sc = scaleOf(e);
  setProp(e, "sg:state", "roar");
  s.roarT = e.typeId === F4 ? ANCHORS.timing.roar : 66;
  const id = e.typeId === F4 ? "sg.roar4" : e.typeId === F3 ? "sg.roar3" : "sg.roar2";
  sound(dim, id, e.location, 12 * sc + 3, rand(0.95, 1.03));
  shake(dim, e.location, 80 * sc + 16, 0.35, 2.5);
  s.cd.roar = fromTransform ? 300 : 700;
}

function stomp(e, s, sc) {
  const dim = e.dimension;
  const L = e.location;
  sound(dim, "sg.step", L, 8 * sc + 3, 0.8);
  particle(dim, "sg:shockwave", L);
  shake(dim, L, 60 * sc + 16, 1.2, 0.8);
  const R = 11 * sc + 3;
  for (const en of dim.getEntities({ location: L, maxDistance: R })) {
    if (en.id === e.id || KAIJU.has(en.typeId) || !isLiving(en)) continue;
    hurt(en, 12, e);
    const v = norm({ x: en.location.x - L.x, y: 0, z: en.location.z - L.z });
    try { en.applyKnockback({ x: v.x * 2.4, z: v.z * 2.4 }, 0.9); } catch { /* ignore */ }
  }
  crater(dim, { x: L.x, y: L.y - 1, z: L.z }, Math.round(4 * sc + 1));
  s.cd.stomp = 120;
}

// ------------------------------------------------------------------ dormancy / freezing / dying
function goDormant(e, s) {
  s.act = null;
  trigger(e, "sg:go_dormant");
  setProp(e, "sg:state", "dormant");
  setProp(e, "sg:glow", 0);
  setProp(e, "sg:aim", 0);
  s.dormantT = DORMANT_TICKS;
  s.doses = 0;
  e.setDynamicProperty("sg:doses", 0);
  e.setDynamicProperty("sg:dormant", s.dormantT);
  sound(e.dimension, "sg.dormant", e.location, 8, 1);
  world.sendMessage("§5[Kaiju]§r §7Shin Godzilla has exhausted its energy and gone dormant to cool down. Now is the time for the §bYashiori Strategy§7: inject §bYashiori Coagulant§7 " + DOSES_NEEDED + " times!");
}

function wake(e, s) {
  setProp(e, "sg:state", "waking");
  s.wakeT = 60;
  sound(e.dimension, "sg.roar4", e.location, 14, 0.95);
  shake(e.dimension, e.location, 90, 0.5, 2.5);
}

function freeze(e, s) {
  trigger(e, "sg:freeze");
  setProp(e, "sg:state", "frozen");
  setProp(e, "sg:glow", 2);
  s.act = null;
  s.dormantT = 0;
  e.setDynamicProperty("sg:dormant", 0);
  const dim = e.dimension, sc = scaleOf(e);
  sound(dim, "sg.freeze", e.location, 10, 1);
  for (let i = 0; i < 6; i++) particle(dim, "sg:freeze_burst", toWorld(e, [rand(-6, 6), rand(4, 44), rand(-6, 10)], sc));
  world.sendMessage("§b[Yashiori Strategy]§r Shin Godzilla has been §bfrozen solid§r! Tokyo... and your world... are safe. For now.");
}

function thaw(e, s) {
  trigger(e, "sg:thaw");
  setProp(e, "sg:glow", 0);
  s.doses = 0;
  e.setDynamicProperty("sg:doses", 0);
  applyMode(e);
  wake(e, s);
}

function startDying(e, s) {
  s.act = null;
  trigger(e, "sg:dying");
  setProp(e, "sg:state", "dying");
  setProp(e, "sg:glow", 0);
  s.dyingT = e.typeId === F4 ? 96 : 70;
  const sc = scaleOf(e);
  sound(e.dimension, e.typeId === F4 ? "sg.roar4" : e.typeId === F3 ? "sg.roar3" : "sg.roar2", e.location, 12 * sc + 3, 0.8);
}

function finishDying(e) {
  const dim = e.dimension, L = e.location;
  const n = e.typeId === F4 ? 6 : e.typeId === F3 ? 3 : 2;
  try { dim.spawnItem(new ItemStack("sg:g_cell", n), add(L, { x: 0, y: 2, z: 0 })); } catch { /* ignore */ }
  sound(dim, "sg.step", L, 10, 0.6);
  shake(dim, L, 80, 1.5, 1.2);
  for (let i = 0; i < 5; i++) particle(dim, "sg:steam", add(L, { x: rand(-6, 6), y: rand(1, 8), z: rand(-6, 6) }));
  trigger(e, "sg:despawn");
}

// ------------------------------------------------------------------ evolution (2nd/3rd)
function evoThreshold(e) {
  if (S.evo === "off") return Infinity;
  const fast = S.evo === "fast";
  return e.typeId === F2 ? (fast ? 45 : 180) : (fast ? 60 : 240);
}
function beginEvolve(e, s) {
  trigger(e, "sg:begin_evolve");
  setProp(e, "sg:state", "evolving");
  s.evolveT = 1;
  const sc = scaleOf(e);
  sound(e.dimension, "sg.evolve", e.location, 10 * sc + 3);
  sound(e.dimension, e.typeId === F2 ? "sg.roar2" : "sg.roar3", e.location, 10 * sc + 3, 0.9);
}

function tickEvolve(e, s, sc) {
  const dim = e.dimension;
  s.evolveT++;
  if (s.evolveT % 3 === 0) particle(dim, "sg:steam", toWorld(e, [rand(-4, 4), rand(2, e.typeId === F2 ? 8 : 20), rand(-6, 10)], sc));
  if (s.evolveT % 5 === 0) particle(dim, "sg:evolve_burst", toWorld(e, [rand(-3, 3), rand(2, e.typeId === F2 ? 7 : 18), rand(-4, 6)], sc));
  if (s.evolveT % 20 === 0) shake(dim, e.location, 60 * sc + 16, 0.3, 1.0);
  if (s.evolveT === 120) {
    for (let i = 0; i < 8; i++) particle(dim, "sg:evolve_burst", toWorld(e, [rand(-5, 5), rand(1, 14), rand(-6, 8)], sc));
    sound(dim, "sg.crash", e.location, 8, 0.7);
    trigger(e, "sg:evolve");
  }
}

// ------------------------------------------------------------------ per-tick update
function tickKaiju(e) {
  const s = st(e);
  const sc = scaleOf(e);
  const dim = e.dimension;
  const state = getProp(e, "sg:state");
  if (system.currentTick % 10 === 0) updateTitle(e, s, state);

  if (state === "frozen") {
    if (system.currentTick % 40 === 0) particle(dim, "sg:frost", toWorld(e, [rand(-5, 5), rand(2, 40), rand(-4, 8)], sc));
    return;
  }
  if (state === "dying") {
    if (s.dyingT <= 0) s.dyingT = 80;
    s.dyingT--;
    if (s.dyingT % 6 === 0) particle(dim, "sg:steam", toWorld(e, [rand(-5, 5), rand(4, 30), rand(-5, 8)], sc));
    if (s.dyingT === 1) finishDying(e);
    return;
  }
  if (state === "evolving") { tickEvolve(e, s, sc); return; }

  if (state === "dormant") {
    s.dormantT--;
    if (system.currentTick % 100 === 0) e.setDynamicProperty("sg:dormant", s.dormantT);
    if (system.currentTick % 8 === 0) particle(dim, "sg:steam", toWorld(e, A4.dorsal[Math.floor(Math.random() * A4.dorsal.length)], sc));
    if (system.currentTick % 140 === 0) sound(dim, "sg.dormant", e.location, 5, rand(0.9, 1.05));
    if (s.dormantT <= 0) wake(e, s);
    return;
  }
  if (state === "waking") {
    s.wakeT = (s.wakeT ?? 60) - 1;
    if (s.wakeT <= 0) {
      trigger(e, "sg:wake");
      setProp(e, "sg:state", "walk");
      s.energy = 100;
      e.setDynamicProperty("sg:dormant", 0);
      applyMode(e);
    }
    return;
  }

  // running ability
  if (s.act) {
    if (s.act.name === "breath") tickBreath(e, s, sc);
    else if (s.act.name === "dorsal") tickDorsal(e, s, sc);
    else if (s.act.name === "tail") tickTail(e, s, sc);
    if (s.act) s.act.t++;
    return;
  }

  if (s.roarT > 0) {
    s.roarT--;
    if (s.roarT === 0 && getProp(e, "sg:state") === "roar") setProp(e, "sg:state", "walk");
  }

  // cooldowns and energy
  for (const k of Object.keys(s.cd)) if (s.cd[k] > 0) s.cd[k]--;
  if (e.typeId === F4) s.energy = Math.min(100, s.energy + 0.04);
  if (s.targetT > 0) s.targetT--; else s.target = undefined;

  // footsteps (distance travelled)
  const moved = hdist(e.location, s.last);
  s.last = { ...e.location };
  if (moved < 3) s.walked += moved;
  const stride = (e.typeId === F4 ? 9 : e.typeId === F3 ? 5 : 4) * sc;
  if (s.walked >= stride) {
    s.walked = 0;
    s.foot = 1 - s.foot;
    const side = s.foot ? 1 : -1;
    const fp = toWorld(e, e.typeId === F2 ? [side * 7.5, 0, 5] : [side * 5.9, 0, -1], sc);
    sound(dim, "sg.step", fp, (e.typeId === F4 ? 7 : e.typeId === F3 ? 4 : 2.5) * sc + 1, rand(0.9, 1.1) / Math.sqrt(Math.max(sc, 0.25)));
    particle(dim, "sg:dust", fp);
    shake(dim, fp, (e.typeId === F4 ? 56 : 30) * sc + 10, (e.typeId === F4 ? 0.35 : 0.15), 0.35);
    if (e.typeId !== F2) crater(dim, { x: fp.x, y: fp.y - 1, z: fp.z }, Math.max(1, Math.round((e.typeId === F4 ? 3 : 2) * sc)));
  }

  // bulldoze through anything in the way
  if (s.cd.bull <= 0 && (moved > 0.02 || validTarget(s))) {
    s.cd.bull = 4;
    s.bullStep = ((s.bullStep ?? 0) + 1) % 3;
    if (e.typeId === F4) bulldoze(e, sc, 6 + s.bullStep, 7, 1, 40);
    else if (e.typeId === F3) bulldoze(e, sc, 4 + s.bullStep, 5, 1, 22);
    else bulldoze(e, sc, 13 + s.bullStep, 5, 0, 9);
  }

  // forms 2/3: gills, ageing and evolution
  if (e.typeId !== F4) {
    if (system.currentTick % 20 === 0) {
      s.age++;
      if (s.age % 10 === 0) e.setDynamicProperty("sg:age", s.age);
      const h = e.getComponent("minecraft:health");
      const low = h && h.currentValue < h.effectiveMax * 0.45 && S.evo !== "off";
      if (s.age >= evoThreshold(e) || low) { beginEvolve(e, s); return; }
    }
    if (s.cd.gill <= 0) {
      s.cd.gill = e.typeId === F2 ? 50 : 90;
      const g = e.typeId === F2 ? ANCHORS.f2 : ANCHORS.f3;
      for (const k of ["gill_L", "gill_R"]) particle(dim, "sg:blood_spray", toWorld(e, g[k], sc), dirVars(toDir(e, [k === "gill_L" ? 1 : -1, -0.3, 0]), {}));
    }
    if (s.cd.roar <= 0 && validTarget(s)) startRoar(e, s, false);
    if (s.cd.growl <= 0) {
      s.cd.growl = 400 + Math.floor(Math.random() * 600);
      sound(dim, e.typeId === F2 ? "sg.roar2" : "sg.roar3", e.location, 6 * sc + 2, rand(0.9, 1.1));
    }
    return;
  }

  // 4th form decision making (every 10 ticks)
  if (system.currentTick % 10 !== 0) return;
  const t = findTarget(e, s, sc);
  if (s.cd.growl <= 0) {
    s.cd.growl = 600 + Math.floor(Math.random() * 1200);
    if (!t && s.cd.roar <= 0) startRoar(e, s, false);
  }
  if (!t) return;
  const d = dist(t.location, e.location);
  const hd = hdist(t.location, e.location);
  const toT = anglesFromDir(norm(sub(t.location, e.location)));
  const behind = Math.abs(wrap180(toT.yaw - e.getRotation().y)) > 115;
  const air = airborneTargets(e, sc);
  if (s.cd.roar <= 0) { startRoar(e, s, false); return; }
  if (hd < 13 * sc + 3 && s.cd.stomp <= 0) { stomp(e, s, sc); return; }
  if (air.length && s.cd.dorsal <= 0 && s.energy >= 25) { startAbility(e, s, "dorsal"); return; }
  if (behind && d < 90 * sc + 10 && s.cd.tail <= 0 && s.energy >= 15) { startAbility(e, s, "tail"); return; }
  if (d > 10 * sc + 4 && d < 130 * sc + 10 && s.cd.breath <= 0 && s.energy >= 30) { startAbility(e, s, "breath"); return; }
}

// ------------------------------------------------------------------ events
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity;
  if (!e || !KAIJU.has(e.typeId)) return;
  const src = ev.damageSource.damagingEntity;
  const s = st(e);
  if (src && !KAIJU.has(src.typeId) && S.mode !== "peaceful") {
    s.target = src;
    s.targetT = 1200;
  }
  if (src && src.typeId === "minecraft:player" && Math.random() < 0.07) {
    try { e.dimension.spawnItem(new ItemStack("sg:g_cell", 1), add(src.location, { x: 0, y: 1, z: 0 })); } catch { /* ignore */ }
  }
  if (ev.damage >= 20 && e.typeId === F4) s.cd.breath = Math.min(s.cd.breath, 40); // bunker busters provoke the breath
}, { entityTypes: [F2, F3, F4] });

world.afterEvents.entityHealthChanged.subscribe((ev) => {
  const e = ev.entity;
  if (!KAIJU.has(e.typeId) || ev.newValue >= ev.oldValue) return;
  let max = 1;
  try { max = e.getComponent("minecraft:health").effectiveMax; } catch { /* ignore */ }
  const state = getProp(e, "sg:state");
  if (ev.newValue > 0 && ev.newValue <= max * 0.04 && state !== "dying" && state !== "frozen") startDying(e, st(e));
}, { entityTypes: [F2, F3, F4] });

world.afterEvents.dataDrivenEntityTrigger.subscribe((ev) => {
  const e = ev.entity;
  if (ev.eventId !== "sg:coagulant_hit") return;
  const s = st(e);
  s.doses++;
  e.setDynamicProperty("sg:doses", s.doses);
  const sc = scaleOf(e);
  for (let i = 0; i < 3; i++) particle(e.dimension, "sg:coagulant", toWorld(e, [rand(-3, 3), rand(30, 44), rand(-10, -2)], sc));
  sound(e.dimension, "sg.coagulant", e.location, 6);
  for (const p of e.dimension.getPlayers({ location: e.location, maxDistance: 96 })) {
    try { p.onScreenDisplay.setActionBar(`§bYashiori Coagulant injected: ${s.doses}/${DOSES_NEEDED}`); } catch { /* ignore */ }
  }
  if (s.doses >= DOSES_NEEDED) freeze(e, s);
}, { entityTypes: [F4], eventTypes: ["sg:coagulant_hit"] });

world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack?.typeId === "sg:kaiju_tablet") system.run(() => openTablet(ev.source));
});

// ------------------------------------------------------------------ tablet UI
function nearestKaiju(p, range = 200) {
  let best, bd = range;
  for (const e of tracked) {
    try {
      if (!e.isValid || e.dimension.id !== p.dimension.id) continue;
      const d = dist(e.location, p.location);
      if (d < bd) { bd = d; best = e; }
    } catch { /* ignore */ }
  }
  return best;
}

function cycle(list, cur) { return list[(list.indexOf(cur) + 1) % list.length]; }

async function show(form, player) {
  for (let i = 0; i < 20; i++) {
    const r = await form.show(player);
    if (r.canceled && r.cancelationReason === "UserBusy") { await new Promise((res) => system.runTimeout(() => res(undefined), 5)); continue; }
    return r;
  }
  return undefined;
}

async function openTablet(p) {
  const k = nearestKaiju(p);
  let status = "§7No kaiju nearby.";
  if (k) {
    const s = st(k);
    const h = k.getComponent("minecraft:health");
    status = `§fNearest: §c${NAMES[k.typeId]}§f, ${Math.round(dist(k.location, p.location))} blocks away\n` +
      `§fState: §e${getProp(k, "sg:state")}§f   Health: §a${h ? Math.ceil(h.currentValue) : "?"}` +
      (k.typeId === F4 ? `§f   Energy: §d${Math.round(s.energy)}%` : "");
  }
  const f = new ActionFormData()
    .title("Kaiju Control Tablet")
    .body(status)
    .button(`Block destruction: ${S.griefing ? "§aON" : "§cOFF"}`)
    .button(`Behavior: §e${MODE_LABEL[S.mode]}`)
    .button(`Evolution: §e${EVO_LABEL[S.evo]}`)
    .button(`Kaiju size: §e${SIZE_LABEL[S.size]}`)
    .button(`Screen shake: ${S.shake ? "§aON" : "§cOFF"}`)
    .button("§2Summon a kaiju...")
    .button("§4Command nearest kaiju...")
    .button("§cRemove all kaiju nearby");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  switch (r.selection) {
    case 0: setSetting("griefing", !S.griefing); break;
    case 1: setSetting("mode", cycle(["movie", "hunt", "peaceful"], S.mode)); for (const e of tracked) if (e.isValid) applyMode(e); break;
    case 2: setSetting("evo", cycle(["normal", "fast", "off"], S.evo)); break;
    case 3: setSetting("size", cycle(["full", "half", "quarter"], S.size)); for (const e of tracked) if (e.isValid) applySize(e); break;
    case 4: setSetting("shake", !S.shake); break;
    case 5: return summonMenu(p);
    case 6: return commandMenu(p);
    case 7: return removeMenu(p);
  }
  system.run(() => openTablet(p));
}

async function summonMenu(p) {
  const f = new ActionFormData().title("Summon a kaiju").body("It will appear about 40 blocks in front of you.")
    .button("2nd Form - Kamata-kun").button("3rd Form - Shinagawa-kun").button("4th Form - Shin Godzilla");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  const id = [F2, F3, F4][r.selection];
  const v = p.getViewDirection();
  const h = norm({ x: v.x, y: 0, z: v.z });
  const dd = 40 * SIZE_SCALE[S.size] + 8;
  let loc = add(p.location, mul(h, dd));
  try {
    const top = p.dimension.getTopmostBlock({ x: loc.x, z: loc.z });
    if (top) loc = { x: loc.x, y: top.location.y + 1, z: loc.z };
  } catch { /* ignore */ }
  try {
    const e = p.dimension.spawnEntity(id, loc);
    const yaw = anglesFromDir(norm(sub(p.location, loc))).yaw;
    e.teleport(loc, { rotation: { x: 0, y: yaw } });
  } catch (err) { p.sendMessage("§cCould not summon here: " + err); }
}

async function commandMenu(p) {
  const k = nearestKaiju(p);
  if (!k) { p.sendMessage("§7No kaiju within 200 blocks."); return; }
  const s = st(k);
  const state = getProp(k, "sg:state");
  const is4 = k.typeId === F4;
  /** @type {{label: string, run: () => void}[]} */
  const opts = [];
  const add = (label, run) => opts.push({ label, run });
  add("Roar", () => startRoar(k, s, false));
  if (is4 && !s.act && state === "walk") {
    add("Atomic breath where I'm looking", () => { aimAt(p, s); s.forced = true; startAbility(k, s, "breath"); });
    add("Dorsal plate rays", () => { s.forced = true; startAbility(k, s, "dorsal"); });
    add("Tail beam where I'm looking", () => { aimAt(p, s); s.forced = true; startAbility(k, s, "tail"); });
    add("Force dormancy (cool down)", () => goDormant(k, s));
  }
  if (is4 && state === "dormant") add("Wake it up", () => { s.dormantT = 1; });
  if (is4 && state === "frozen") add("Thaw it (undo the Yashiori Strategy)", () => thaw(k, s));
  if (!is4 && state !== "evolving") add("Force evolution now", () => beginEvolve(k, s));
  const f = new ActionFormData().title("Command " + NAMES[k.typeId]).body(`State: ${state}`);
  for (const o of opts) f.button(o.label);
  const r = await show(f, p);
  if (!r || r.canceled || r.selection === undefined) return;
  opts[r.selection].run();
}

function aimAt(p, s) {
  try {
    const hit = p.getBlockFromViewDirection({ maxDistance: 250 });
    if (hit) { s.aimPoint = add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 }); return; }
  } catch { /* ignore */ }
  s.aimPoint = add(p.getHeadLocation(), mul(p.getViewDirection(), 80));
}

async function removeMenu(p) {
  const f = new MessageFormData().title("Remove kaiju").body("Remove every kaiju within 256 blocks (including frozen ones)?")
    .button1("Cancel").button2("§cRemove");
  const r = await show(f, p);
  if (!r || r.canceled || r.selection !== 1) return;
  let n = 0;
  for (const e of p.dimension.getEntities({ families: ["kaiju"], location: p.location, maxDistance: 256 })) {
    try { e.remove(); n++; } catch { /* ignore */ }
  }
  p.sendMessage(`§7Removed ${n} kaiju.`);
}

// ------------------------------------------------------------------ boot
world.afterEvents.worldLoad.subscribe(() => {
  loadSettings();
  refreshTracked();
  system.runInterval(() => {
    blockBudget = 700;
    if (system.currentTick % 20 === 0) refreshTracked();
    for (const e of tracked) {
      try {
        if (e.isValid) tickKaiju(e);
      } catch (err) {
        if (system.currentTick % 200 === 0) console.warn("[sg] " + err);
      }
    }
  }, 1);
});

// a freshly spawned kaiju (spawn egg / transform) is picked up right away
world.afterEvents.entitySpawn.subscribe((ev) => {
  const e = ev.entity;
  try {
    if (!e.isValid || !KAIJU.has(e.typeId) || String(ev.cause) === "Loaded") return;
  } catch { return; }
  system.runTimeout(() => {
    try {
      if (!e.isValid) return;
      if (!tracked.some((x) => x.id === e.id)) tracked.push(e);
      const s = st(e);
      if (getProp(e, "sg:state") === "walk" && s.cd.roar > 100) startRoar(e, s, true);
    } catch { /* ignore */ }
  }, 2);
});
