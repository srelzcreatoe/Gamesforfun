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
const F4R = "sg:shin_godzilla_rampage";   // never tires, never goes dormant, always attacking
const KAIJU = new Set([F2, F3, F4, F4R]);
const NAMES = { [F2]: "2nd Form (Kamata-kun)", [F3]: "3rd Form (Shinagawa-kun)", [F4]: "4th Form", [F4R]: "4th Form - RAMPAGE" };
const is4 = (e) => e.typeId === F4 || e.typeId === F4R;
const isRampage = (e) => e.typeId === F4R;
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
const DEFAULTS = { griefing: true, mode: "hunt", evo: "normal", size: "full", shake: true, hud: true };
const S = { ...DEFAULTS };
const SIZE_SCALE = { full: 1, half: 0.5, quarter: 0.25 };
const MODE_LABEL = { hunt: "Hostile (attacks players and every mob)", movie: "Only fights back", peaceful: "Peaceful" };
const EVO_LABEL = { normal: "Normal (3-4 min)", fast: "Fast (45-60 s)", off: "Off" };
const SIZE_LABEL = { full: "Movie scale (48 blocks)", half: "Half (24 blocks)", quarter: "Quarter (12 blocks)" };

function loadSettings() {
  for (const k of Object.keys(DEFAULTS)) {
    const v = world.getDynamicProperty("sg:" + k);
    if (v !== undefined) S[k] = v;
  }
}
function migrateSettings() {
  // 1.2: kaiju are hostile by default; move older worlds over once
  if (world.getDynamicProperty("sg:cfg") !== 2) {
    world.setDynamicProperty("sg:cfg", 2);
    setSetting("mode", "hunt");
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

/** Rough half-width of a creature, so beams hit big bodies and not just their feet. */
function bodyRadius(en) {
  const hp = maxHp(en);
  return hp >= 400 ? 5 : hp >= 150 ? 3 : hp >= 60 ? 1.5 : 0.4;
}
function distPointRay(p, o, d, l) {
  const v = sub(p, o);
  const t = clamp(v.x * d.x + v.y * d.y + v.z * d.z, 0, l);
  return dist(p, add(o, mul(d, t)));
}

/** pct: extra damage as a share of the victim's own health, so rival giants feel it too. */
function damageAlongRay(src, o, d, l, radius, amount, fire, pct = 0) {
  const dim = src.dimension;
  const mid = add(o, mul(d, l / 2));
  let ents = [];
  try { ents = dim.getEntities({ location: mid, maxDistance: l / 2 + radius + 3 }); } catch { return; }
  for (const en of ents) {
    if (en.id === src.id || KAIJU.has(en.typeId) || !isLiving(en)) continue;
    if (distPointRay(center(en), o, d, l) <= radius + bodyRadius(en)) hurt(en, amount + (pct ? maxHp(en) * pct : 0), src, fire);
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
  trigger(e, "sg:mode_" + (isRampage(e) ? "hunt" : S.mode));
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

function hostile(e) { return isRampage(e) || S.mode === "hunt"; }

function maxHp(en) {
  try { return en.getComponent("minecraft:health").effectiveMax; } catch { return 20; }
}

function findTarget(e, s, sc) {
  let t = validTarget(s);
  const R = 96 * Math.max(sc, 0.5);
  if (t && dist(t.location, e.location) > R * 1.5) t = undefined;
  if (!t && hostile(e)) {
    let best, score = Infinity;
    let ents = [];
    try { ents = e.dimension.getEntities({ location: e.location, maxDistance: R }); } catch { /* ignore */ }
    for (const en of ents) {
      if (en.id === e.id || KAIJU.has(en.typeId) || !isLiving(en)) continue;
      let d = dist(en.location, e.location);
      if (en.typeId === "minecraft:player") {
        let gm = "";
        try { gm = String(en.getGameMode()).toLowerCase(); } catch { /* ignore */ }
        if (gm === "creative" || gm === "spectator") continue;
        d -= 40;                                   // players first
      } else {
        const hp = maxHp(en);
        if (hp >= 150) d -= 60;                    // rival kaiju and bosses before anything else
        else if (hp < 12) d += 30;                 // small animals only if nothing better is around
      }
      if (d < score) { score = d; best = en; }
    }
    t = best;
    if (t) s.targetT = 400;
  }
  if (S.mode === "peaceful" && !isRampage(e) && !s.forced) t = undefined;
  s.target = t;
  return t;
}

/** Is this target worth the atomic breath, or just something to step on? */
function worthy(t) { return t.typeId === "minecraft:player" || maxHp(t) >= 20; }

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
  setProp(e, "sg:tail", 0);
  s.tailSw = 0;
  for (const key of LIGHTS.keys()) LIGHTS.set(key, 0);
  if (isRampage(e)) for (const k of ["breath", "dorsal", "tail"]) s.cd[k] = Math.floor(s.cd[k] * 0.45);
  if (s.energy <= 8 && !isRampage(e)) {
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
  // the main beam is drawn densely; the many thin rays use longer, sparser streaks to stay light on phones
  const main = thick > 1.5;
  const step = main ? 2.0 : 3.2;
  const v = dirVars(d, { len: main ? 2.4 * thick : 2.2 });
  for (let i = 0; i * step < l; i++) {
    particle(dim, main ? "sg:beam_core" : "sg:ray_core", add(o, mul(d, i * step + step / 2)), v);
  }
  const gs = main ? 3.5 : 5.5;
  const g = dirVars(d, { len: 3.5 * thick });
  for (let i = 0; i * gs < l; i++) {
    particle(dim, main ? "sg:beam_glow" : "sg:ray_glow", add(o, mul(d, i * gs + 1.5)), g);
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

// ------------------------------------------------------------------ spectacle
const SURGE = A4.surge;                       // centre plate tips, tail's end -> nape (charge pose)
const TAIL_SIDE = Math.sign(A4.tail_by_swing[A4.tail_by_swing.length - 1][1] - A4.tail_by_swing[0][1]) || 1;

function sized(size) {
  const v = new MolangVariableMap();
  v.setFloat("variable.size", size);
  return v;
}

/** One step of the light that runs from the tip of the tail, up the back, to the nape (k = 0..1). */
function surgeAt(e, sc, k, size) {
  const n = SURGE.length;
  const i = Math.floor(clamp(k, 0, 0.999) * n);
  const v = sized(size);
  for (let j = 0; j < 3 && i + j < n; j++) particle(e.dimension, "sg:surge", toWorld(e, SURGE[i + j], sc), v);
}

/** Lightning crawling between the dorsal plates. */
function arcs(e, sc, count) {
  const pts = A4.dorsal, dim = e.dimension;
  for (let c = 0; c < count; c++) {
    const i = Math.floor(Math.random() * pts.length);
    const j = clamp(i + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3)), 0, pts.length - 1);
    if (i === j) continue;
    const a = toWorld(e, pts[i], sc), b = toWorld(e, pts[j], sc);
    const mid = add(mul(add(a, b), 0.5), { x: rand(-1.5, 1.5) * sc, y: rand(0.5, 3) * sc, z: rand(-1.5, 1.5) * sc });
    for (const [p, q] of [[a, mid], [mid, b]]) {
      const d = sub(q, p), l = len(d);
      if (l < 0.3) continue;
      particle(dim, "sg:ray_core", mul(add(p, q), 0.5), dirVars(norm(d), { len: l * 0.5 }));
    }
  }
}

/** A blink of violet-white across the screen of everyone close enough to be dazzled. */
function flashScreen(dim, c, radius, col, hold, out) {
  if (!S.shake) return;
  let players = [];
  try { players = dim.getPlayers({ location: c, maxDistance: radius }); } catch { return; }
  for (const p of players) {
    try {
      p.camera.fade({ fadeColor: { red: col[0], green: col[1], blue: col[2] }, fadeTime: { fadeInTime: 0.05, holdTime: hold, fadeOutTime: out } });
    } catch { /* ignore */ }
  }
}

/** Lean the raised tail toward what it is firing at (with a slow slashing sway) and return its tip. */
function tailTip(e, s, sc, table, goal, t) {
  let want = Math.sin(t * 0.11) * 14;
  if (goal) {
    const rel = wrap180(anglesFromDir(norm(sub(goal, e.location))).yaw - s.yaw);
    want += (clamp(rel, -90, 90) / 90) * 28 * TAIL_SIDE;
  }
  const cur = s.tailSw ?? 0;
  s.tailSw = clamp(cur + clamp(want - cur, -2.5, 2.5), -45, 45);
  const sw = Math.round(s.tailSw);
  setProp(e, "sg:tail", sw);
  return toWorld(e, lerpTable(table, sw), sc, s.yaw);
}

/** The thin ray from the tip of the tail. a.td is its (smoothed) direction. */
function tailRay(e, s, sc, tip, goal, t, a) {
  const dim = e.dimension;
  let d;
  if (goal) {
    // slash back and forth across the target rather than holding dead on it
    const w = { x: Math.sin(t * 0.07) * 9 * sc, y: Math.sin(t * 0.045) * 3 * sc, z: Math.cos(t * 0.06) * 9 * sc };
    d = norm(sub(add(goal, w), tip));
  } else {
    d = dirFromAngles(s.yaw + Math.sin(t * 0.06) * 55, 16 + Math.sin(t * 0.09) * 12);
  }
  a.td = a.td ? norm(add(mul(a.td, 0.82), mul(d, 0.18))) : d;
  const r = castBeam(e, tip, a.td, 110 * Math.max(sc, 0.4));
  drawBeam(dim, tip, a.td, r.l, 1.3);
  particle(dim, "sg:mouth_glow", tip);
  if (r.hit) {
    particle(dim, "sg:beam_impact", r.hit);
    if (t % 4 === 0) explodeAt(e, r.hit, 2.8 * Math.max(sc, 0.5) + 0.4, true);
    if (t % 3 === 0) light(dim, add(r.hit, mul(a.td, -2)), 10);
  }
  if (t % 4 === 0) damageAlongRay(e, tip, a.td, r.l, 1.8, 11, 4, 0.003);
}

/** A handful of rays from the plates, thrown out with the breath (the rampaging one only). */
function dorsalFan(e, sc, t, a) {
  const dim = e.dimension, pts = A4.dorsal;
  a.seed ??= Math.random() * 360;
  for (let i = 0; i < 5; i++) {
    const o = toWorld(e, pts[(i * 11 + Math.floor(t / 3)) % pts.length], sc);
    const d = dirFromAngles(a.seed + i * 72 + t * 2.2, -(18 + 30 * Math.abs(Math.sin((t + i * 25) * 0.04))) + 30 * Math.max(0, Math.sin((t + i * 40) * 0.03)));
    const r = castBeam(e, o, d, 80 * Math.max(sc, 0.4));
    drawBeam(dim, o, d, r.l, 0.9);
    if (r.hit && t % 5 === i) { particle(dim, "sg:beam_impact", r.hit); explodeAt(e, r.hit, 2.2, true); }
    if (t % 4 === 0) damageAlongRay(e, o, d, r.l, 1.6, 9, 3, 0.002);
  }
}

// Atomic breath, staged like the film and cut to the heat-ray sound's timeline
// (phase start ticks come from the build, so sound, animation and damage stay in step):
//   charge   light races up the tail and along the back, the plates stutter and catch purple,
//            lightning crawls between them, the eye membranes close, the head bows
//   smoke    the jaw unhinges and thick black smoke pours down over the ground
//   fire     the smoke ignites into a flood of orange fire that spreads across everything below
//   focus    the stream burns white, then magenta, and tightens as the lower jaw parts
//   beam     a flash, and the jaw is split in two: a thin violet beam, the head rising to sweep it
//            across the target while the tail swings over and fires its own ray
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
  particle(e.dimension, "sg:haze", p, sized(16 * sc + 4));
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
    if (i === 0 && t % 6 === 0) light(dim, add(g, { x: 0, y: 1, z: 0 }), 14);
    if (canGrief()) {
      try {
        const above = dim.getBlock({ x: Math.floor(r.hit.x), y: Math.floor(r.hit.y) + 1, z: Math.floor(r.hit.z) });
        if (above && above.isAir) above.setType("minecraft:fire");
      } catch { /* ignore */ }
      if (t % 14 === 0 && i === 0) explodeAt(e, r.hit, 2.4 * Math.max(sc, 0.5) + 0.6, true);
    }
  }
  if (t % 5 === 0) {
    let ents = [];
    try { ents = dim.getEntities({ location: mouth, maxDistance: range }); } catch { /* ignore */ }
    for (const en of ents) {
      if (en.id === e.id || KAIJU.has(en.typeId) || !isLiving(en)) continue;
      const v = sub(center(en), mouth);
      const cos = (v.x * d.x + v.y * d.y + v.z * d.z) / (len(v) || 1);
      if (cos > 0.84) hurt(en, 6 + maxHp(en) * 0.002, e, 6);
    }
  }
}

function tickBreath(e, s, sc) {
  const a = s.act, dim = e.dimension;
  const t = a.t;
  const L = e.location;
  if (t === 0) {
    setProp(e, "sg:state", "charge");
    s.baseYaw = s.yaw;
    s.pitch = 0;
    sound(dim, "sg.charge", L, 6 * sc + 2);
    warn(e, "§5☢ §dThe dorsal plates are glowing... §5☢");
  }
  const mouth = mouthPos(e, s, sc);
  if (t % 6 === 0) haze(e, sc);

  // ---- charge
  if (t < BREATH.smoke) {
    const k = t / BREATH.smoke;
    // the glow stutters on, faster and faster, then holds
    const on = t >= BREATH.smoke * 0.7 || Math.sin(t * t * 0.045) > 0;
    setProp(e, "sg:glow", on ? 1 : 0);
    // light races from the tail's tip to the nape: once slowly, then again in a rush
    const split = Math.floor(BREATH.smoke * 0.6);
    surgeAt(e, sc, t < split ? t / split : (t - split) / (BREATH.smoke - split), 7 * sc + 2);
    if (t % 2 === 0) { dorsalSparks(e, sc); arcs(e, sc, 1 + Math.floor(k * 3)); }
    if (t % 5 === 0) particle(dim, "sg:embers", L, sized(10 * sc + 2));
    if (t % 4 === 0 && t > 16) particle(dim, "sg:mouth_glow", mouth);
    if (t % 10 === 0) shake(dim, L, 70 * sc + 16, 0.12 + 0.3 * k, 0.6);
    if (t === split) { particle(dim, "sg:shockwave", L); particle(dim, "sg:dust", L); }
    aim(e, s, sc, mouth, false, 58);
    return;
  }
  setProp(e, "sg:glow", 1);
  if (t % 3 === 0) dorsalSparks(e, sc);
  if (t === BREATH.smoke) {
    // the plates lock on: one hard pulse along the whole back
    for (let i = 0; i < SURGE.length; i += 2) particle(dim, "sg:surge", toWorld(e, SURGE[i], sc), sized(8 * sc + 2));
    particle(dim, "sg:flash", toWorld(e, [0, 34, 4], sc), sized(22 * sc + 4));
    light(dim, toWorld(e, [0, 50, 6], sc), 30);
  }

  // ---- smoke
  if (t < BREATH.fire) {
    const d = aim(e, s, sc, mouth, false, 58);
    if (t === BREATH.smoke) { setProp(e, "sg:state", "smoke"); sound(dim, "sg.breath_smoke", mouth, 8 * sc + 3); }
    particle(dim, "sg:smoke_plume", mouth, dirVars(d, { spd: 10 * sc + 4 }));
    if (t % 3 === 0) particle(dim, "sg:mouth_glow", mouth);
    if (t % 4 === 0) {
      const r = castBeam(e, mouth, d, 70 * sc + 10);   // smoke rolls out across the ground
      if (r.hit) particle(dim, "sg:smoke_plume", add(r.hit, { x: 0, y: 1, z: 0 }), dirVars(norm({ x: d.x, y: 0.05, z: d.z }), { spd: 8 * sc + 3 }));
    }
    const ph = ((t - BREATH.smoke) % 26) / 14;
    if (ph < 1) surgeAt(e, sc, ph, 6 * sc + 2);
    if (t % 4 === 0) arcs(e, sc, 1);
    if (t % 9 === 0) particle(dim, "sg:embers", L, sized(11 * sc + 2));
    return;
  }

  // ---- fire
  if (t < BREATH.focus) {
    // slow side-to-side wash of fire over the ground in front of it
    const d = aim(e, s, sc, mouth, true, 52);
    if (t === BREATH.fire) {
      setProp(e, "sg:state", "fire");
      sound(dim, "sg.breath_fire", mouth, 10 * sc + 3);
      shake(dim, L, 80 * sc + 20, 0.5, 1.0);
      particle(dim, "sg:flash", mouth, sized(12 * sc + 3));
      warn(e, "§6§l☢ FIRE ☢");
    }
    stream(dim, mouth, d, sc, ORANGE, 0.2, 30 * sc + 9, 1.3 * sc + 0.5);
    particle(dim, "sg:fire_spray", mouth, dirVars(d, { spd: 26 * sc + 8 }));
    if (t % 4 === 0) particle(dim, "sg:smoke_plume", mouth, dirVars(d, { spd: 12 * sc + 4 }));
    floodFire(e, mouth, d, sc, t);
    if (t % 12 === 0) shake(dim, L, 60 * sc + 16, 0.25, 0.7);
    const ph = ((t - BREATH.fire) % 22) / 12;
    if (ph < 1) surgeAt(e, sc, ph, 6 * sc + 2);
    if (t % 3 === 0) arcs(e, sc, 1);
    if (t % 8 === 0) particle(dim, "sg:embers", L, sized(12 * sc + 2));
    if (t % 6 === 0) light(dim, add(mouth, mul(d, 6)), 12);
    return;
  }

  // ---- focus: orange -> white-hot -> magenta, tightening into a line
  if (t < BREATH.beam) {
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
    // everything winds up: the surge loops faster, the arcs thicken, a star grows in the throat
    const ph = ((t - BREATH.focus) % 12) / 9;
    if (ph < 1) surgeAt(e, sc, ph, 7 * sc + 2);
    if (t % 2 === 0) arcs(e, sc, 1 + Math.floor(k * 2));
    if (t % 3 === 0) particle(dim, "sg:flash", mouth, sized((3 + 7 * k) * sc + 1));
    if (t % 6 === 0) particle(dim, "sg:embers", L, sized(12 * sc + 2));
    if (t % 8 === 0) shake(dim, L, 70 * sc + 16, 0.2 + 0.4 * k, 0.6);
    if (t % 5 === 0) light(dim, add(mouth, mul(d, 5)), 10);
    return;
  }

  // ---- beam
  if (t < BREATH.end) {
    const d = aim(e, s, sc, mouth, true);
    if (t === BREATH.beam) {
      setProp(e, "sg:state", "beam");
      sound(dim, "sg.breath_beam", mouth, 12 * sc + 4);
      sound(dim, "sg.crash", L, 10 * sc + 4, 0.6);
      shake(dim, L, 100 * sc + 24, 1.1, 1.6);
      flashScreen(dim, L, 90 * sc + 24, [0.78, 0.6, 1.0], 0.05, 0.55);
      particle(dim, "sg:flash", mouth, sized(34 * sc + 6));
      particle(dim, "sg:shockwave", L);
      for (let i = 0; i < 3; i++) particle(dim, "sg:embers", L, sized((6 + 6 * i) * sc + 2));
      for (let i = 0; i < SURGE.length; i += 2) particle(dim, "sg:surge", toWorld(e, SURGE[i], sc), sized(9 * sc + 2));
      warn(e, "§d§l☢ ATOMIC BREATH ☢");
    }
    const bt = t - BREATH.beam;
    const sputter = t >= BREATH.sputter;
    const live = !sputter || (t % 5 < 3);
    const maxLen = 150 * Math.max(sc, 0.35);
    const r = castBeam(e, mouth, d, maxLen);
    if (live) {
      drawBeam(dim, mouth, d, r.l, (sputter ? 1.4 : 2.0) * Math.max(sc, 0.4) + 0.4);
      if (r.hit) {
        particle(dim, "sg:beam_impact", r.hit);
        if (t % 3 === 0) explodeAt(e, r.hit, 3.2 * Math.max(sc, 0.5) + 0.8, true);
        if (t % 2 === 0) light(dim, add(r.hit, mul(d, -2)), 12);
      }
      if (t % 4 === 0) damageAlongRay(e, mouth, d, r.l, 2.2 * Math.max(sc, 0.5), 14, 5, 0.004);
      if (t % 3 === 0) light(dim, add(mouth, mul(d, Math.min(r.l * 0.5, 10 + (bt % 4) * 14))), 10);
    } else {
      stream(dim, mouth, d, sc, MAGENTA, 0.12, 30 * sc + 9, 0.8 * sc + 0.4);
    }
    if (t % 2 === 0) particle(dim, "sg:mouth_glow", mouth);
    if (t % 10 === 0) shake(dim, L, 70 * sc + 16, 0.3, 0.6);
    if (t % 4 === 0) arcs(e, sc, 1);
    if (t % 10 === 0) particle(dim, "sg:embers", L, sized(12 * sc + 2));

    // the tail swings up and over and joins in with a ray of its own
    const goal = s.aimPoint ?? (validTarget(s) ? center(validTarget(s)) : undefined);
    const tip = tailTip(e, s, sc, A4.tail_breath_by_swing, goal, t);
    if (bt === 24) { sound(dim, "sg.rays", tip, 10 * sc + 4, 1.1); particle(dim, "sg:flash", tip, sized(10 * sc + 3)); warn(e, "§d§l☢ ATOMIC BREATH + TAIL RAY ☢"); }
    if (bt >= 24 && !sputter) tailRay(e, s, sc, tip, goal, t, a);
    else if (bt >= 8 && bt < 24 && t % 2 === 0) particle(dim, "sg:mouth_glow", tip);
    // the rampaging one throws rays from its back as well: mouth, tail and plates all at once
    if (isRampage(e) && bt >= 50 && !sputter) {
      if (bt === 50) sound(dim, "sg.rays", L, 12 * sc + 4, 0.95);
      dorsalFan(e, sc, t, a);
    }
    return;
  }
  s.energy -= 40;
  s.cd.breath = 600;
  endAbility(e, s);
}

/** Banner line for everyone near a kaiju (shown in the HUD for a moment). */
function warn(e, text, range = 128) {
  const s = st(e);
  s.banner = text;
  s.bannerT = system.currentTick + 50;
  if (S.hud) return;   // the HUD will carry it
  try {
    for (const p of e.dimension.getPlayers({ location: e.location, maxDistance: range })) p.onScreenDisplay.setActionBar(text);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ HUD
// The boss bar carries the name and health; a HUD line above the hotbar adds exact health,
// atomic energy and what the kaiju is doing right now.
const STATE_LABEL = {
  walk: "§7ON THE MOVE", roar: "§6ROARING", charge: "§dPLATES GLOWING", smoke: "§8SMOKE", fire: "§6FIRE", focus: "§dFOCUSING",
  beam: "§d§lATOMIC BREATH", dorsal: "§d§lDORSAL RAYS", tail: "§d§lTAIL RAY", waking: "§cAWAKENING", frozen: "§b§lFROZEN",
  dying: "§7FALLING", evolving: "§e§lEVOLVING", dormant: "§bDORMANT",
};
const HUD_NAME = { [F2]: "§6§lSHIN GODZILLA §r§72nd Form", [F3]: "§c§lSHIN GODZILLA §r§73rd Form", [F4]: "§5§lSHIN GODZILLA", [F4R]: "§4§lSHIN GODZILLA §c§lRAMPAGE" };

function meter(frac, on, off, n) {
  const k = Math.round(clamp(frac, 0, 1) * n);
  return on + "|".repeat(k) + off + "|".repeat(n - k);
}

function clearOldTag(e, s) {
  if (s.tagCleared) return;      // 1.1 wrote a title into the name tag, which hid the bar's name
  s.tagCleared = true;
  try { if (e.nameTag) e.nameTag = ""; } catch { /* ignore */ }
}

function hudText(e) {
  const s = st(e);
  const state = getProp(e, "sg:state") ?? "walk";
  let hp = 0, max = 1;
  try { const h = e.getComponent("minecraft:health"); hp = Math.max(0, Math.ceil(h.currentValue)); max = Math.ceil(h.effectiveMax); } catch { /* ignore */ }
  let l1 = `${HUD_NAME[e.typeId]} §r§8- ${STATE_LABEL[state] ?? ""}`;
  if (state === "dormant") {
    const sec = Math.max(0, Math.ceil(s.dormantT / 20));
    l1 += ` §7${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} §8- §bCoagulant ${s.doses}/${DOSES_NEEDED}`;
  }
  let l2 = `§cHP §f${hp}§7/${max} ${meter(hp / max, "§4", "§8", 30)}`;
  if (isRampage(e)) l2 += "  §dENERGY §5UNLIMITED";
  else if (is4(e)) l2 += `  §dENERGY ${meter(s.energy / 100, "§5", "§8", 16)}`;
  else {
    const th = evoThreshold(e);
    if (th !== Infinity) l2 += `  §eEVOLUTION ${meter(s.age / th, "§6", "§8", 16)}`;
  }
  const banner = s.banner && system.currentTick < s.bannerT ? "\n" + s.banner : "";
  return l1 + "§r\n" + l2 + banner;
}

function tickHud() {
  if (!S.hud) return;
  for (const p of world.getAllPlayers()) {
    let best, bd = 150;
    for (const e of tracked) {
      try {
        if (!e.isValid || e.dimension.id !== p.dimension.id) continue;
        const d = dist(e.location, p.location);
        if (getProp(e, "sg:state") === "frozen" && d > 40) continue;   // a statue doesn't need a HUD from afar
        if (d < bd) { bd = d; best = e; }
      } catch { /* ignore */ }
    }
    if (best) { try { p.onScreenDisplay.setActionBar(hudText(best)); } catch { /* ignore */ } }
  }
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
function light(dim, p, ticks = 6) {
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
function tickLights() {
  lightsNew = 0;
  let changed = false;
  for (const [key, exp] of LIGHTS) {
    if (system.currentTick < exp) continue;
    if (clearLight(key)) LIGHTS.delete(key);
    else { LIGHTS.delete(key); STRAY.push(key); }
    changed = true;
  }
  if (STRAY.length && system.currentTick % 100 === 0) {
    const left = STRAY.filter((key) => !clearLight(key));
    if (left.length !== STRAY.length) { STRAY = left; changed = true; }
  }
  if (changed) saveLights();
}
function cleanStrayLights() {
  try {
    const raw = world.getDynamicProperty("sg:lights");
    if (typeof raw === "string") STRAY = JSON.parse(raw).filter((k) => typeof k === "string");
  } catch { /* ignore */ }
}

function dorsalPoints(e, sc) {
  return A4.dorsal.map((p) => toWorld(e, p, sc));
}
function dorsalSparks(e, sc) {
  const pts = dorsalPoints(e, sc);
  for (let i = 0; i < 3; i++) particle(e.dimension, "sg:dorsal_glow", pts[Math.floor(Math.random() * pts.length)]);
}

const FLYERS = new Set(["minecraft:phantom", "minecraft:ghast", "minecraft:happy_ghast", "minecraft:blaze", "minecraft:vex",
  "minecraft:breeze", "minecraft:wither", "minecraft:ender_dragon"]);
function airborneTargets(e, sc) {
  const out = [];
  const R = 96 * Math.max(sc, 0.5);
  let ents = [];
  try { ents = e.dimension.getEntities({ location: e.location, maxDistance: R }); } catch { return out; }
  for (const en of ents) {
    if (KAIJU.has(en.typeId) || !isLiving(en)) continue;
    if (en.typeId === "minecraft:player" && isSpectator(en)) continue;
    const high = en.location.y - e.location.y > 10 * sc && (isRampage(e) || worthy(en));
    if (high || FLYERS.has(en.typeId)) out.push(en);
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
    const n = Math.min(pts.length, 10);
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
    warn(e, "§5☢ §dThe tail is glowing... §5☢");
  }
  const goal = s.aimPoint ?? (validTarget(s) ? center(validTarget(s)) : undefined);
  const tip = tailTip(e, s, sc, A4.tail_by_swing, goal, t);
  if (t < 30) {
    // light runs down the tail to its tip before it fires
    surgeAt(e, sc, (1 - t / 30) * 0.55, 6 * sc + 2);
    if (t % 2 === 0) particle(dim, "sg:mouth_glow", tip);
    if (t % 3 === 0) arcs(e, sc, 1);
    return;
  }
  if (t === 30) {
    sound(dim, "sg.rays", tip, 10 * sc + 4, 1.12);
    particle(dim, "sg:flash", tip, sized(12 * sc + 3));
    shake(dim, e.location, 70 * sc + 16, 0.5, 0.8);
    warn(e, "§d§l☢ TAIL RAY ☢");
  }
  if (t < 130) { tailRay(e, s, sc, tip, goal, t, a); return; }
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
  s.roarT = is4(e) ? ANCHORS.timing.roar : 66;
  const id = is4(e) ? "sg.roar4" : e.typeId === F3 ? "sg.roar3" : "sg.roar2";
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
  s.dyingT = is4(e) ? 96 : 70;
  const sc = scaleOf(e);
  sound(e.dimension, is4(e) ? "sg.roar4" : e.typeId === F3 ? "sg.roar3" : "sg.roar2", e.location, 12 * sc + 3, 0.8);
}

function finishDying(e) {
  const dim = e.dimension, L = e.location;
  const n = is4(e) ? 6 : e.typeId === F3 ? 3 : 2;
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

/** Anything under a foot when it lands is crushed. */
function trample(e, fp, sc) {
  const R = (is4(e) ? 4.5 : e.typeId === F3 ? 3 : 2.5) * sc + 1;
  let ents = [];
  try { ents = e.dimension.getEntities({ location: fp, maxDistance: R }); } catch { return; }
  for (const en of ents) {
    if (en.id === e.id || KAIJU.has(en.typeId) || !isLiving(en)) continue;
    hurt(en, (is4(e) ? 22 : e.typeId === F3 ? 10 : 6) + maxHp(en) * 0.01, e);
  }
}

/** Nothing left alive nearby: the rampaging one turns its fire on the land itself. */
function rampageIdle(e, s, sc) {
  const pick = () => {
    const f = dirFromAngles(e.getRotation().y + rand(-70, 70), 0), r = rand(40, 110) * Math.max(sc, 0.4);
    let p = { x: e.location.x + f.x * r, y: e.location.y, z: e.location.z + f.z * r };
    try {
      const top = e.dimension.getTopmostBlock({ x: p.x, z: p.z });
      if (top) p = { x: p.x, y: top.location.y + 1, z: p.z };
    } catch { /* ignore */ }
    return p;
  };
  if (s.cd.roar <= 0) { startRoar(e, s, false); return; }
  if (s.cd.breath <= 0) { s.aimPoint = pick(); s.forced = true; startAbility(e, s, "breath"); return; }
  if (s.cd.dorsal <= 0) { s.forced = true; startAbility(e, s, "dorsal"); return; }
  if (s.cd.tail <= 0) { s.aimPoint = pick(); s.forced = true; startAbility(e, s, "tail"); }
}

// ------------------------------------------------------------------ per-tick update
function tickKaiju(e) {
  const s = st(e);
  const sc = scaleOf(e);
  const dim = e.dimension;
  const state = getProp(e, "sg:state");
  clearOldTag(e, s);
  if (isRampage(e)) s.energy = 100;

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
  if (is4(e)) s.energy = Math.min(100, s.energy + 0.04);
  if (s.targetT > 0) s.targetT--; else s.target = undefined;

  // footsteps (distance travelled)
  const moved = hdist(e.location, s.last);
  s.last = { ...e.location };
  if (moved < 3) s.walked += moved;
  const stride = (is4(e) ? 9 : e.typeId === F3 ? 5 : 4) * sc;
  if (s.walked >= stride) {
    s.walked = 0;
    s.foot = 1 - s.foot;
    const side = s.foot ? 1 : -1;
    const fp = toWorld(e, e.typeId === F2 ? [side * 7.5, 0, 5] : [side * 5.9, 0, -1], sc);
    sound(dim, "sg.step", fp, (is4(e) ? 7 : e.typeId === F3 ? 4 : 2.5) * sc + 1, rand(0.9, 1.1) / Math.sqrt(Math.max(sc, 0.25)));
    particle(dim, "sg:dust", fp);
    shake(dim, fp, (is4(e) ? 56 : 30) * sc + 10, (is4(e) ? 0.35 : 0.15), 0.35);
    if (e.typeId !== F2) crater(dim, { x: fp.x, y: fp.y - 1, z: fp.z }, Math.max(1, Math.round((is4(e) ? 3 : 2) * sc)));
    if (S.mode !== "peaceful" || isRampage(e)) trample(e, fp, sc);
  }

  // bulldoze through anything in the way
  if (s.cd.bull <= 0 && (moved > 0.02 || validTarget(s))) {
    s.cd.bull = 4;
    s.bullStep = ((s.bullStep ?? 0) + 1) % 3;
    if (is4(e)) bulldoze(e, sc, 6 + s.bullStep, 7, 1, 40);
    else if (e.typeId === F3) bulldoze(e, sc, 4 + s.bullStep, 5, 1, 22);
    else bulldoze(e, sc, 13 + s.bullStep, 5, 0, 9);
  }

  // forms 2/3: gills, ageing and evolution
  if (!is4(e)) {
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

  // 4th form decision making (every 10 ticks; never in the middle of a roar)
  if (system.currentTick % 10 !== 0 || s.roarT > 0) return;
  const rage = isRampage(e);
  const t = findTarget(e, s, sc);
  if (s.cd.growl <= 0) {
    s.cd.growl = (rage ? 300 : 600) + Math.floor(Math.random() * (rage ? 500 : 1200));
    if (!t && s.cd.roar <= 0) { startRoar(e, s, false); return; }
  }
  if (!t) { if (rage) rampageIdle(e, s, sc); return; }
  const d = dist(t.location, e.location);
  const hd = hdist(t.location, e.location);
  const toT = anglesFromDir(norm(sub(t.location, e.location)));
  const behind = Math.abs(wrap180(toT.yaw - e.getRotation().y)) > 115;
  const air = airborneTargets(e, sc);
  const big = rage || worthy(t);          // small animals just get walked over
  if (s.cd.roar <= 0 && big) { startRoar(e, s, false); return; }
  if (hd < 13 * sc + 3 && s.cd.stomp <= 0) { stomp(e, s, sc); return; }
  if (air.length && s.cd.dorsal <= 0 && s.energy >= 25) { startAbility(e, s, "dorsal"); return; }
  if (!big) return;
  if (behind && d < 90 * sc + 10 && s.cd.tail <= 0 && s.energy >= 15) { startAbility(e, s, "tail"); return; }
  if (d > 10 * sc + 4 && d < 130 * sc + 10 && s.cd.breath <= 0 && s.energy >= 30) { startAbility(e, s, "breath"); return; }
  // out of breath but something is still standing off to the side: the tail ray will do
  if (rage && d > 20 * sc && s.cd.tail <= 0) startAbility(e, s, "tail");
}

// ------------------------------------------------------------------ events
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity;
  if (!e || !KAIJU.has(e.typeId)) return;
  const src = ev.damageSource.damagingEntity;
  const s = st(e);
  if (src && !KAIJU.has(src.typeId) && (S.mode !== "peaceful" || isRampage(e))) {
    s.target = src;
    s.targetT = 1200;
  }
  if (src && src.typeId === "minecraft:player" && Math.random() < 0.07) {
    try { e.dimension.spawnItem(new ItemStack("sg:g_cell", 1), add(src.location, { x: 0, y: 1, z: 0 })); } catch { /* ignore */ }
  }
  if (ev.damage >= 20 && is4(e)) s.cd.breath = Math.min(s.cd.breath, 40); // bunker busters provoke the breath
}, { entityTypes: [F2, F3, F4, F4R] });

world.afterEvents.entityHealthChanged.subscribe((ev) => {
  const e = ev.entity;
  if (!KAIJU.has(e.typeId) || ev.newValue >= ev.oldValue) return;
  let max = 1;
  try { max = e.getComponent("minecraft:health").effectiveMax; } catch { /* ignore */ }
  const state = getProp(e, "sg:state");
  if (ev.newValue > 0 && ev.newValue <= max * 0.04 && state !== "dying" && state !== "frozen") startDying(e, st(e));
}, { entityTypes: [F2, F3, F4, F4R] });

world.afterEvents.dataDrivenEntityTrigger.subscribe((ev) => {
  const e = ev.entity;
  if (ev.eventId !== "sg:coagulant_hit") return;
  const s = st(e);
  s.doses++;
  e.setDynamicProperty("sg:doses", s.doses);
  const sc = scaleOf(e);
  for (let i = 0; i < 3; i++) particle(e.dimension, "sg:coagulant", toWorld(e, [rand(-3, 3), rand(30, 44), rand(-10, -2)], sc));
  sound(e.dimension, "sg.coagulant", e.location, 6);
  warn(e, `§bYashiori Coagulant injected: ${s.doses}/${DOSES_NEEDED}`, 96);
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
      (is4(k) ? `§f   Energy: §d${Math.round(s.energy)}%` : "");
  }
  const f = new ActionFormData()
    .title("Kaiju Control Tablet")
    .body(status)
    .button(`Block destruction: ${S.griefing ? "§aON" : "§cOFF"}`)
    .button(`Behavior: §e${MODE_LABEL[S.mode]}`)
    .button(`Evolution: §e${EVO_LABEL[S.evo]}`)
    .button(`Kaiju size: §e${SIZE_LABEL[S.size]}`)
    .button(`Screen shake and flashes: ${S.shake ? "§aON" : "§cOFF"}`)
    .button(`Kaiju HUD (health, energy, state): ${S.hud ? "§aON" : "§cOFF"}`)
    .button("§2Summon a kaiju...")
    .button("§4Command nearest kaiju...")
    .button("§cRemove all kaiju nearby");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  switch (r.selection) {
    case 0: setSetting("griefing", !S.griefing); break;
    case 1: setSetting("mode", cycle(["hunt", "movie", "peaceful"], S.mode)); for (const e of tracked) if (e.isValid) applyMode(e); break;
    case 2: setSetting("evo", cycle(["normal", "fast", "off"], S.evo)); break;
    case 3: setSetting("size", cycle(["full", "half", "quarter"], S.size)); for (const e of tracked) if (e.isValid) applySize(e); break;
    case 4: setSetting("shake", !S.shake); break;
    case 5: setSetting("hud", !S.hud); break;
    case 6: return summonMenu(p);
    case 7: return commandMenu(p);
    case 8: return removeMenu(p);
  }
  system.run(() => openTablet(p));
}

async function summonMenu(p) {
  const f = new ActionFormData().title("Summon a kaiju").body("It will appear about 40 blocks in front of you.")
    .button("2nd Form - Kamata-kun").button("3rd Form - Shinagawa-kun").button("4th Form - Shin Godzilla")
    .button("§44th Form - RAMPAGE§r\n§8never tires, never sleeps");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  const id = [F2, F3, F4, F4R][r.selection ?? 2];
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
  const big = is4(k);
  /** @type {{label: string, run: () => void}[]} */
  const opts = [];
  const add = (label, run) => opts.push({ label, run });
  add("Roar", () => startRoar(k, s, false));
  if (big && !s.act && state === "walk") {
    add("Atomic breath where I'm looking", () => { aimAt(p, s); s.forced = true; startAbility(k, s, "breath"); });
    add("Dorsal plate rays", () => { s.forced = true; startAbility(k, s, "dorsal"); });
    add("Tail beam where I'm looking", () => { aimAt(p, s); s.forced = true; startAbility(k, s, "tail"); });
    if (!isRampage(k)) add("Force dormancy (cool down)", () => goDormant(k, s));
  }
  if (big && state === "dormant") add("Wake it up", () => { s.dormantT = 1; });
  if (big && state === "frozen") add("Thaw it (undo the Yashiori Strategy)", () => thaw(k, s));
  if (!big && state !== "evolving") add("Force evolution now", () => beginEvolve(k, s));
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
  migrateSettings();
  cleanStrayLights();
  refreshTracked();
  system.runInterval(() => {
    blockBudget = 700;
    if (system.currentTick % 20 === 0) refreshTracked();
    if (system.currentTick % 10 === 0) tickHud();
    tickLights();
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
