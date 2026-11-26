// Shin Godzilla add-on: shared helpers (settings, maths, effects, terrain).
import { world, system, MolangVariableMap, EntityDamageCause } from "@minecraft/server";

export const F2 = "sg:shin_godzilla_2";
export const F3 = "sg:shin_godzilla_3";
export const F4 = "sg:shin_godzilla";
export const F4R = "sg:shin_godzilla_rampage";   // never tires, never goes dormant, always attacking
export const KAIJU = new Set([F2, F3, F4, F4R]);
export const NAMES = { [F2]: "2nd Form (Kamata-kun)", [F3]: "3rd Form (Shinagawa-kun)", [F4]: "4th Form", [F4R]: "4th Form - RAMPAGE" };
export const is4 = (e) => e.typeId === F4 || e.typeId === F4R;
export const isRampage = (e) => e.typeId === F4R;
export const DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
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
// World rules (the tablet) and Shin Godzilla's own strength (the config wheel).
export const DEFAULTS = {
  griefing: true, mode: "hunt", evo: "normal", size: "full", shake: true, hud: true,
  hp: "1",            // health multiplier tier: 025 05 1 2 4 8
  dmg: 1,             // damage of everything he does
  rate: 1,            // how often he attacks (divides cooldowns)
  speed: "normal",    // slow normal fast faster
  beam: 1,            // beam thickness, reach and blast
  stamina: 1,         // how much he can do before going dormant (divides energy costs)
  leap: true,         // jumps back to open the range, forward to close it
  camera: "first",    // cinematic camera on the atomic breath: off / first / always
  fog: true,          // the air darkens while he fires
  fx: "normal",       // particle density: low normal high
};
export const S = { ...DEFAULTS };
export const HP_TIERS = { "025": 0.25, "05": 0.5, "1": 1, "2": 2, "4": 4, "8": 8 };
export const FX_K = { low: 0.6, normal: 1, high: 1.5 };

export function loadSettings() {
  for (const k of Object.keys(DEFAULTS)) {
    const v = world.getDynamicProperty("sg:" + k);
    if (v !== undefined && typeof v === typeof DEFAULTS[k]) S[k] = v;
  }
}
export function setSetting(k, v) {
  S[k] = v;
  try { world.setDynamicProperty("sg:" + k, v); } catch { /* ignore */ }
}
export function migrateSettings() {
  // 1.2: kaiju are hostile by default; move older worlds over once
  const ver = Number(world.getDynamicProperty("sg:cfg") ?? 0);
  if (ver < 2) setSetting("mode", "hunt");
  if (ver !== 3) world.setDynamicProperty("sg:cfg", 3);
}
export const fxK = () => FX_K[S.fx] ?? 1;

// ------------------------------------------------------------------ maths
export const D2R = Math.PI / 180;
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const dist = (a, b) => len(sub(a, b));
export const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (k) => k * k * (3 - 2 * k);
export const wrap180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
export const dirFromAngles = (yaw, pitch) => ({
  x: -Math.sin(yaw * D2R) * Math.cos(pitch * D2R),
  y: -Math.sin(pitch * D2R),
  z: Math.cos(yaw * D2R) * Math.cos(pitch * D2R),
});
export const anglesFromDir = (d) => ({ yaw: Math.atan2(-d.x, d.z) / D2R, pitch: -Math.asin(clamp(d.y, -1, 1)) / D2R });
export const yawTo = (from, to) => Math.atan2(-(to.x - from.x), to.z - from.z) / D2R;

export function scaleOf(e) {
  try {
    const c = e.getComponent("minecraft:scale");
    if (c && typeof c.value === "number") return c.value;
  } catch { /* ignore */ }
  return 1;
}

/** Model-space offset (blocks; the model faces -z) -> world position. */
export function toWorld(e, off, sc, yaw) {
  const y = (yaw ?? e.getRotation().y) * D2R;
  const fx = -Math.sin(y), fz = Math.cos(y);
  const rx = -Math.cos(y), rz = -Math.sin(y);
  const L = e.location;
  return { x: L.x + (rx * off[0] - fx * off[2]) * sc, y: L.y + off[1] * sc, z: L.z + (rz * off[0] - fz * off[2]) * sc };
}
/** World position -> model-space offset [x, y, z] (the inverse of toWorld). */
export function toLocal(e, p, sc, yaw) {
  const y = (yaw ?? e.getRotation().y) * D2R;
  const fx = -Math.sin(y), fz = Math.cos(y);
  const rx = -Math.cos(y), rz = -Math.sin(y);
  const L = e.location;
  const dx = (p.x - L.x) / sc, dz = (p.z - L.z) / sc;
  return [dx * rx + dz * rz, (p.y - L.y) / sc, -(dx * fx + dz * fz)];
}

export function lerpTable(tab, a) {
  // tab: [[key, x, y, z], ...] sorted by key
  if (a <= tab[0][0]) return tab[0].slice(1);
  for (let i = 1; i < tab.length; i++) {
    if (a <= tab[i][0]) {
      const t = (a - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
      return [1, 2, 3].map((k) => tab[i - 1][k] + (tab[i][k] - tab[i - 1][k]) * t);
    }
  }
  return tab[tab.length - 1].slice(1);
}

// ------------------------------------------------------------------ who is watching
let seenTick = -1;
let seen = [];
/** Every player, refreshed once a tick. */
export function players() {
  if (seenTick !== system.currentTick) {
    seenTick = system.currentTick;
    try { seen = world.getAllPlayers(); } catch { seen = []; }
    spent = 0;
  }
  return seen;
}
export function playersNear(dim, at, range) {
  const out = [];
  for (const p of players()) {
    try {
      if (p.isValid && p.dimension.id === dim.id && dist(p.location, at) <= range) out.push(p);
    } catch { /* ignore */ }
  }
  return out;
}

// ------------------------------------------------------------------ particles and sound
// Effects are sent to each player who could see them rather than broadcast from where they
// happen: a beam 150 blocks long has to be visible from the far end, and from a hill a
// long way off.  A per-tick budget keeps a busy fight from flooding a phone.
const PARTICLE_BUDGET = 420;
let spent = 0;
export function particle(dim, id, loc, vars, range = 224) {
  for (const p of playersNear(dim, loc, range)) {
    if (spent >= PARTICLE_BUDGET) return;
    spent++;
    try { p.spawnParticle(id, loc, vars); } catch { /* unloaded chunk */ }
  }
}
/** How many of an effect to draw this tick, given the "particle density" setting (keeps fractions over time). */
export function share(n) {
  const v = n * fxK();
  const whole = Math.floor(v);
  return whole + (Math.random() < v - whole ? 1 : 0);
}

const NEAR = 44;
/**
 * A sound the size of the thing making it.  Close listeners hear it from where it is; far
 * ones hear it from its direction, quieter with distance, out to `far` blocks.
 */
export function sound(dim, id, at, far = 160, volume = 1, pitch = 1) {
  for (const p of players()) {
    try {
      if (!p.isValid || p.dimension.id !== dim.id) continue;
      const l = p.location, d = dist(l, at);
      if (d > far) continue;
      if (d <= NEAR) { p.playSound(id, { location: at, volume, pitch }); continue; }
      const k = 10 / d;
      const from = { x: l.x + (at.x - l.x) * k, y: l.y + 1.6 + (at.y - l.y) * k, z: l.z + (at.z - l.z) * k };
      const v = volume * (1 - 0.8 * Math.pow((d - NEAR) / Math.max(1, far - NEAR), 0.8));
      p.playSound(id, { location: from, volume: v, pitch });
    } catch { /* ignore */ }
  }
}

export function dirVars(d, extra) {
  const v = new MolangVariableMap();
  v.setFloat("variable.dx", d.x);
  v.setFloat("variable.dy", d.y);
  v.setFloat("variable.dz", d.z);
  if (extra) for (const k of Object.keys(extra)) v.setFloat("variable." + k, extra[k]);
  return v;
}
export function sized(size, col) {
  const v = new MolangVariableMap();
  v.setFloat("variable.size", size);
  if (col) { v.setFloat("variable.cr", col[0]); v.setFloat("variable.cg", col[1]); v.setFloat("variable.cb", col[2]); }
  return v;
}
/** Variables for the effects that are sized by a width (smoke, fire). */
export function wide(width, d = { x: 0, y: 0, z: 1 }, spd = 10) {
  return dirVars(d, { width, spd });
}

export function shake(dim, center, radius, strength, seconds) {
  if (!S.shake) return;
  for (const p of playersNear(dim, center, radius)) {
    const k = 1 - dist(p.location, center) / radius;
    const s = clamp(strength * (0.25 + 0.75 * k), 0.02, 4);
    try { p.runCommand(`camerashake add @s ${s.toFixed(2)} ${seconds.toFixed(2)} positional`); } catch { /* ignore */ }
  }
}
/** A blink of colour across the screen of everyone close enough to be dazzled. */
export function flashScreen(dim, c, radius, col, hold, out) {
  if (!S.shake) return;
  for (const p of playersNear(dim, c, radius)) {
    try {
      p.camera.fade({ fadeColor: { red: col[0], green: col[1], blue: col[2] }, fadeTime: { fadeInTime: 0.05, holdTime: hold, fadeOutTime: out } });
    } catch { /* ignore */ }
  }
}

// ------------------------------------------------------------------ fog
// One named fog layer per player, pushed while a breath is burning near them.
const FOG_ID = "sg_breath";
const fogged = new Map();   // player id -> fog on them now
export function setFog(p, fog) {
  const cur = fogged.get(p.id);
  if (cur === fog) return;
  try {
    if (cur) p.runCommand(`fog @s remove ${FOG_ID}`);
    if (fog) p.runCommand(`fog @s push ${fog} ${FOG_ID}`);
  } catch { /* ignore */ }
  if (fog) fogged.set(p.id, fog); else fogged.delete(p.id);
}
/** Take our fog off someone whatever we remember about them (joining, reloading). */
export function forgetFog(p) {
  fogged.delete(p.id);
  try { p.runCommand(`fog @s remove ${FOG_ID}`); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ living things
export function isLiving(en) {
  if (NON_LIVING.has(en.typeId)) return false;
  try { return !!en.getComponent("minecraft:health"); } catch { return false; }
}
export function maxHp(en) {
  try { return en.getComponent("minecraft:health").effectiveMax; } catch { return 20; }
}
/** Rough half-width of a creature, so beams hit big bodies and not just their feet. */
export function bodyRadius(en) {
  const hp = maxHp(en);
  return hp >= 400 ? 5 : hp >= 150 ? 3 : hp >= 60 ? 1.5 : 0.4;
}
/** A point in the middle of a creature (higher up on big ones). */
export function center(en) {
  const L = en.location;
  let h = 0.9;
  try { h = Math.max(0.9, (en.getHeadLocation().y - L.y) * 0.6); } catch { /* ignore */ }
  return { x: L.x, y: L.y + h, z: L.z };
}
export function isSpectator(p) {
  try { return p.getGameMode && String(p.getGameMode()).toLowerCase() === "spectator"; } catch { return false; }
}
export function getProp(e, id) { try { return e.getProperty(id); } catch { return undefined; } }
export function setProp(e, id, v) { try { if (e.getProperty(id) !== v) e.setProperty(id, v); } catch { /* ignore */ } }
export function trigger(e, ev) { try { e.triggerEvent(ev); } catch { /* ignore */ } }

/** pct: extra damage as a share of the victim's own health, so rival giants feel it too. */
export function hurt(en, amount, src, fire = 0, pct = 0) {
  try {
    en.applyDamage((amount + (pct ? maxHp(en) * pct : 0)) * S.dmg, { cause: EntityDamageCause.entityAttack, damagingEntity: src });
    if (fire > 0) en.setOnFire(fire, true);
  } catch { /* ignore */ }
}
export function knock(en, from, power, lift) {
  const v = norm({ x: en.location.x - from.x, y: 0, z: en.location.z - from.z });
  try { en.applyKnockback({ x: (v.x || 0.01) * power, z: (v.z || 0.01) * power }, lift); } catch {
    try { en.applyImpulse({ x: v.x * power * 0.5, y: lift * 0.6, z: v.z * power * 0.5 }); } catch { /* ignore */ }
  }
}
function distPointRay(p, o, d, l) {
  const v = sub(p, o);
  const t = clamp(v.x * d.x + v.y * d.y + v.z * d.z, 0, l);
  return dist(p, add(o, mul(d, t)));
}
export function damageAlongRay(src, o, d, l, radius, amount, fire, pct = 0) {
  const dim = src.dimension;
  const mid = add(o, mul(d, l / 2));
  let ents = [];
  try { ents = dim.getEntities({ location: mid, maxDistance: l / 2 + radius + 6 }); } catch { return; }
  for (const en of ents) {
    if (en.id === src.id || KAIJU.has(en.typeId) || !isLiving(en)) continue;
    if (distPointRay(center(en), o, d, l) <= radius + bodyRadius(en)) hurt(en, amount, src, fire, pct);
  }
}
/** Everything alive within r of a point (not our own kind). */
export function victims(e, at, r) {
  let ents = [];
  try { ents = e.dimension.getEntities({ location: at, maxDistance: r }); } catch { return []; }
  return ents.filter((en) => en.id !== e.id && !KAIJU.has(en.typeId) && isLiving(en));
}

// ------------------------------------------------------------------ terrain
export const budget = { blocks: 0 };
export function canGrief() { return !!S.griefing; }
export function smash(dim, x, y, z) {
  if (budget.blocks <= 0) return false;
  budget.blocks--;
  try {
    const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
    if (!b || b.isAir || b.isLiquid || PROTECTED.has(b.typeId)) return false;
    b.setType("minecraft:air");
    return true;
  } catch { return false; }
}
export function crater(dim, c, r) {
  if (!canGrief()) return;
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) for (let y = 0; y <= Math.ceil(r * 0.6); y++) {
    if (x * x + z * z + y * y * 2 <= r * r) smash(dim, c.x + x, c.y + y, c.z + z);
  }
}
/** Height of the ground (top of the first solid or liquid block) under a point, or undefined. */
export function groundY(dim, x, z, from, depth = 48) {
  try {
    const hit = dim.getBlockFromRay({ x, y: from, z }, { x: 0, y: -1, z: 0 }, { maxDistance: depth, includeLiquidBlocks: true, includePassableBlocks: false });
    if (hit) return hit.block.location.y + 1;
  } catch { /* unloaded */ }
  return undefined;
}
export function castBeam(dim, o, d, maxLen) {
  let l = maxLen, hit;
  try {
    hit = dim.getBlockFromRay(o, d, { maxDistance: maxLen, includeLiquidBlocks: false, includePassableBlocks: false });
  } catch { hit = undefined; }
  if (hit) {
    const b = hit.block.location;
    const p = { x: b.x + hit.faceLocation.x, y: b.y + hit.faceLocation.y, z: b.z + hit.faceLocation.z };
    l = Math.max(2, dist(o, p));
  }
  return { l, hit: hit ? add(o, mul(d, l)) : undefined };
}
export function explodeAt(e, p, r, fire) {
  try {
    e.dimension.createExplosion(p, r, { breaksBlocks: canGrief(), causesFire: fire && canGrief(), source: e });
  } catch { /* ignore */ }
}
export function igniteAt(dim, x, y, z) {
  if (!canGrief()) return;
  try {
    const above = dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
    if (above && above.isAir) above.setType("minecraft:fire");
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ light
// Real light for the fire and the beams: invisible light blocks dropped along them for a few
// ticks, so the breath actually lights up the land at night. Every one is tracked and taken
// away again, and the list is saved the moment it changes so nothing is left behind if the
// world closes mid-attack. Counts as a world change, so it follows the block-destruction switch.
const LIGHTS = new Map();   // "dim|x|y|z" -> tick it expires
let STRAY = [];             // left over from a session that ended mid-attack; cleared once loaded
let lightsNew = 0;
function saveLights() {
  try { world.setDynamicProperty("sg:lights", JSON.stringify([...LIGHTS.keys(), ...STRAY].slice(0, 200))); } catch { /* ignore */ }
}
export function light(dim, p, ticks = 10) {
  if (!canGrief()) return;
  const x = Math.floor(p.x / 4) * 4, y = Math.floor(p.y), z = Math.floor(p.z / 4) * 4;
  const key = `${dim.id}|${x}|${y}|${z}`;
  if (LIGHTS.has(key)) { LIGHTS.set(key, system.currentTick + ticks); return; }
  if (LIGHTS.size >= 8 || lightsNew >= 1) return;
  try {
    const b = dim.getBlock({ x, y, z });
    if (!b || !b.isAir) return;
    LIGHTS.set(key, system.currentTick + ticks);
    saveLights();
    lightsNew++;
    try { b.setType("minecraft:light_block_15"); } catch { b.setType("minecraft:light_block"); }
  } catch { /* ignore */ }
}
function clearLight(key) {
  const [dimId, x, y, z] = key.split("|");
  try {
    const b = world.getDimension(dimId).getBlock({ x: Number(x), y: Number(y), z: Number(z) });
    if (!b) return false;                       // chunk not loaded: try again later
    if (b.typeId.startsWith("minecraft:light_block")) b.setType("minecraft:air");
    return true;
  } catch { return false; }
}
export function dropLights() {
  for (const key of LIGHTS.keys()) LIGHTS.set(key, 0);
}
export function tickLights() {
  lightsNew = 0;
  let changed = false;
  for (const [key, exp] of LIGHTS) {
    if (system.currentTick < exp) continue;
    if (!clearLight(key)) STRAY.push(key);
    LIGHTS.delete(key);
    changed = true;
  }
  if (STRAY.length && system.currentTick % 100 === 0) {
    const left = STRAY.filter((key) => !clearLight(key));
    if (left.length !== STRAY.length) { STRAY = left; changed = true; }
  }
  if (changed) saveLights();
}
export function loadStrayLights() {
  try {
    const raw = world.getDynamicProperty("sg:lights");
    if (typeof raw === "string") STRAY = JSON.parse(raw).filter((k) => typeof k === "string");
  } catch { /* ignore */ }
}
