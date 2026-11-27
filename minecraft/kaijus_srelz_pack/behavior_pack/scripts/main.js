// Kaijus Srelz Pack: gameplay script (@minecraft/server 2.0.0, stable APIs only).
//
// Drives everything the data-driven entity files can't: the atomic breath (smoke poured over
// the ground -> a flood of fire -> the beam), dorsal rays, the tail ray, leaps and staged
// melee, duels with other giants, footstep quakes, bulldozing through terrain, energy and
// dormancy, the Yashiori Strategy, evolution between forms, the cinematic camera, the HUD,
// the Kaiju Control Tablet and the Config Wheel.
import { world, system, ItemStack, EasingType, HudElement, HudVisibility } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { ANCHORS } from "./anchors.js";
import {
  F2, F3, F4, F4R, M1, M0, KAIJU, NAMES, is4, isRampage, isMinus, isBig, kin, anchorsOf, heightOf, firstAlongRay,
  DIMS, DEFAULTS, S, HP_TIERS, loadSettings, setSetting, migrateSettings,
  D2R, add, sub, mul, len, norm, dist, hdist, clamp, rand, lerp, smooth, wrap180, dirFromAngles, anglesFromDir, yawTo,
  scaleOf, toWorld, toLocal, lerpTable, players, playersNear, particle, share, sound, dirVars, sized, wide, shake, flashScreen,
  setFog, forgetFog, isLiving, maxHp, bodyRadius, center, isSpectator, getProp, setProp, trigger, hurt, knock, damageAlongRay, victims,
  budget, canGrief, smash, crater, groundY, castBeam, explodeAt, light, dropLights, tickLights, loadStrayLights,
} from "./lib.js";
import {
  ORANGE, WHITE, MAGENTA, VIOLET, CRIMSON, BLUE, ICE, lerp3, drawBeam, drawRay, impactFx, pourOrigin, soot, flood,
  surgeAt, surgeAll, arcs, bolt, groundStrike, dorsalSparks, dorsalPoints, haze, airborneTargets,
} from "./beam.js";

const ABILITY_STATES = new Set(["charge", "smoke", "focus", "beam", "dorsal", "tail", "leap", "land", "bite", "sweep", "waking", "evolving"]);
const DOSES_NEEDED = 6;
const DORMANT_TICKS = 2400;
const A4 = ANCHORS.f4;
const TIMING = ANCHORS.timing;
const BREATH = TIMING.breath;
const HEAT = TIMING.heat;
const ALL_TYPES = [...KAIJU];

const SIZE_SCALE = { full: 1, half: 0.5, quarter: 0.25 };
const MODE_LABEL = { hunt: "Hostile (attacks players and every mob)", movie: "Only fights back", peaceful: "Peaceful" };
const EVO_LABEL = { normal: "Normal (3-4 min)", fast: "Fast (45-60 s)", off: "Off" };
const SIZE_LABEL = { full: "Movie scale (48 blocks)", half: "Half (24 blocks)", quarter: "Quarter (12 blocks)" };

// ------------------------------------------------------------------ power (the config wheel)
const PRESETS = {
  nerfed: { label: "Nerfed", hp: "05", dmg: 0.5, rate: 0.6, speed: "slow", beam: 0.75, stamina: 0.7 },
  movie: { label: "Movie", hp: "1", dmg: 1, rate: 1, speed: "normal", beam: 1, stamina: 1 },
  buffed: { label: "Buffed", hp: "2", dmg: 1.75, rate: 1.5, speed: "fast", beam: 1.35, stamina: 1.5 },
  titan: { label: "Titan", hp: "4", dmg: 3, rate: 2.25, speed: "faster", beam: 1.75, stamina: 3 },
};
const SPEEDS = ["slow", "normal", "fast", "faster"];
const SPEED_FX = { slow: ["slowness", 0], fast: ["speed", 0], faster: ["speed", 2] };
const HP_KEYS = Object.keys(HP_TIERS);

/** Cooldown in ticks after his own tempo and (for the rampaging one) his temper. */
function cool(e, ticks) { return Math.max(4, Math.round(ticks / S.rate * (isRampage(e) ? 0.45 : 1))); }
function spend(e, s, energy) { if (!isRampage(e)) s.energy -= energy / S.stamina; }
function beamK() { return S.beam; }

function applyHp(e, keepShare = true) {
  let share_ = 1;
  try {
    const h = e.getComponent("minecraft:health");
    share_ = clamp(h.currentValue / Math.max(1, h.effectiveMax), 0.02, 1);
  } catch { /* ignore */ }
  trigger(e, "sg:hp_" + S.hp);
  e.setDynamicProperty("sg:hp", S.hp);
  system.runTimeout(() => {
    try {
      if (!e.isValid) return;
      const h = e.getComponent("minecraft:health");
      h.setCurrentValue(Math.max(1, Math.round(h.effectiveMax * (keepShare ? share_ : 1))));
    } catch { /* ignore */ }
  }, 2);
}
function applySpeed(e) {
  const fx = SPEED_FX[S.speed];
  if (!fx) return;
  try { e.addEffect(fx[0], 140, { amplifier: fx[1], showParticles: false }); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ state
const K = new Map(); // entity id -> runtime state
let tracked = [];

function st(e) {
  let s = K.get(e.id);
  if (!s) {
    s = {
      energy: 100, act: null, walked: 0, foot: 0, last: { ...e.location }, target: undefined, targetT: 0,
      cd: { breath: 160, heat: 200, dorsal: 300, tail: 240, stomp: 60, roar: 200, growl: 300, bull: 0, gill: 0, leap: 80, bite: 40, sweep: 120,
        claw: 30, grab: 90, whip: 120, rush: 80 },
      lastHurt: -1000,
      age: Number(e.getDynamicProperty("sg:age") ?? 0),
      dormantT: Number(e.getDynamicProperty("sg:dormant") ?? 0),
      doses: Number(e.getDynamicProperty("sg:doses") ?? 0),
      yaw: e.getRotation().y, pitch: 20, aimPoint: undefined, evolveT: 0, dyingT: 0, roarT: 0, tailSw: 0,
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
  if (e.getDynamicProperty("sg:hp") !== S.hp) applyHp(e, e.getDynamicProperty("sg:hp") !== undefined);
  if (state && ABILITY_STATES.has(state) && state !== "evolving") {
    // world was saved mid-ability: return to normal
    trigger(e, "sg:unlock");
    setProp(e, "sg:state", "walk");
    setProp(e, "sg:glow", 0);
    setProp(e, "sg:tail", 0);
    setProp(e, "sg:fins", 0);
  }
  if (state === "evolving") s.evolveT = 1;
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

function findTarget(e, s, sc) {
  let t = validTarget(s);
  const R = 96 * Math.max(sc, 0.5);
  if (t && dist(t.location, e.location) > R * 1.6) t = undefined;
  if (!t && hostile(e)) {
    let best, score = Infinity;
    let ents = [];
    try { ents = e.dimension.getEntities({ location: e.location, maxDistance: R }); } catch { /* ignore */ }
    for (const en of ents) {
      if (en.id === e.id || kin(e, en) || !isLiving(en)) continue;
      if (KAIJU.has(en.typeId)) { const st_ = getProp(en, "sg:state"); if (st_ === "frozen" || st_ === "dying") continue; }
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
/** Another giant: something to fight at range and at arm's length rather than walk over. */
function isRival(t) { return t.typeId !== "minecraft:player" && maxHp(t) >= 100; }

// ------------------------------------------------------------------ abilities: shared
function mouthPos(e, s, sc) {
  const tab = anchorsOf(e).mouth_by_aim;
  return toWorld(e, lerpTable(tab, clamp(s.aimProp ?? 0, tab[0][0], tab[tab.length - 1][0])), sc, s.yaw);
}

function startAbility(e, s, name, extra) {
  s.act = { name, t: 0, ...(extra ?? {}) };
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
  setProp(e, "sg:fins", 0);
  s.tailSw = 0;
  dropLights();
  if (s.energy <= 8 && !isRampage(e)) {
    goDormant(e, s);
  } else {
    trigger(e, "sg:unlock");
    setProp(e, "sg:state", "walk");
    applyMode(e);
  }
}

function turnTo(e, s, yaw, rate = 2.4) {
  s.yaw = s.yaw + clamp(wrap180(yaw - s.yaw), -rate, rate);
  if (Math.abs(wrap180(e.getRotation().y - s.yaw)) > 0.6) {
    try { e.setRotation({ x: 0, y: s.yaw }); } catch {
      try { e.teleport(e.location, { rotation: { x: 0, y: s.yaw } }); } catch { /* ignore */ }
    }
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
  turnTo(e, s, yaw);
  s.pitch += clamp(wrap180(pitch - s.pitch), -1.5, 1.5);
  s.aimProp = clamp(s.pitch, -35, isMinus(e) ? 60 : 75);
  setProp(e, "sg:aim", Math.round(s.aimProp));
  return dirFromAngles(s.yaw, s.pitch);
}

const TAIL_SIDE = Math.sign(A4.tail_by_swing[A4.tail_by_swing.length - 1][1] - A4.tail_by_swing[0][1]) || 1;

/** Lean the raised tail toward what it is firing at (with a slow slashing sway) and return its tip. */
function tailTip(e, s, sc, table, goal, t) {
  let want = Math.sin(t * 0.11) * 14;
  if (goal) {
    const rel = wrap180(yawTo(e.location, goal) - s.yaw);
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
  const k = Math.max(sc, 0.4);
  const r = castBeam(dim, tip, a.td, 110 * k * (0.7 + 0.3 * beamK()));
  drawRay(dim, tip, a.td, r.l, (0.75 * k + 0.2) * Math.sqrt(beamK()), t, isRampage(e) ? MAGENTA : VIOLET);
  if (r.hit) {
    impactFx(dim, r.hit, t, 2.2 * k + 0.6, false);
    if (t % 4 === 0) explodeAt(e, r.hit, (2.8 * Math.max(sc, 0.5) + 0.4) * Math.sqrt(beamK()), true);
    if (t % 12 === 0) sound(dim, "sg.impact", r.hit, 128, 0.8, rand(1.1, 1.3));
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
    const r = castBeam(dim, o, d, 80 * Math.max(sc, 0.4));
    drawRay(dim, o, d, r.l, 0.5 * Math.max(sc, 0.4) + 0.15, t, MAGENTA);
    if (r.hit && t % 5 === i) { impactFx(dim, r.hit, t, 1.8, false); explodeAt(e, r.hit, 2.2, true); }
    if (t % 4 === 0) damageAlongRay(e, o, d, r.l, 1.6, 9, 3, 0.002);
  }
}

// ------------------------------------------------------------------ the atomic breath
// Staged like the film and cut to the heat-ray sound's timeline (phase start ticks come from
// the build, so sound, animation and damage stay in step):
//   charge   light races up the tail and along the back, the plates stutter and catch purple,
//            lightning crawls between them and strikes the ground, energy streams into the throat
//   smoke    the jaw unhinges and black smoke is driven down onto the ground, where it rolls
//            outward in clouds the size of buildings
//   fire     the smoke catches: fire roars from the mouth and floods across everything below
//   focus    the stream burns white, then magenta, and tightens as the lower jaw parts
//   beam     a flash, and the beam slams into the ground wide, then narrows and lifts to sweep
//            across the target while the tail swings over and fires its own ray
//   sputter  the beam breaks up and dies
function tickBreath(e, s, sc) {
  const a = s.act, dim = e.dimension;
  const t = a.t;
  const L = e.location;
  const k = Math.max(sc, 0.4);
  const W = 5.5 * sc + 1.2;                              // how big the smoke and fire are
  const reach = (44 * sc + 8) * (0.8 + 0.2 * beamK());   // how far the flood spreads
  if (t === 0) {
    setProp(e, "sg:state", "charge");
    s.baseYaw = s.yaw;
    s.pitch = 0;
    sound(dim, "sg.charge", L, 256, 1);
    warn(e, "§5☢ §dThe dorsal plates are glowing... §5☢");
    startFilm(e, s, sc);
  }
  if (t % 84 === 0 && t < BREATH.sputter) sound(dim, "sg.rumble", L, 200, 0.9);
  const mouth = mouthPos(e, s, sc);
  if (t % 6 === 0) haze(e, sc);

  // ---- charge
  if (t < BREATH.smoke) {
    const p = t / BREATH.smoke;
    // the glow stutters on, faster and faster, then holds (the charge sound stutters with it)
    const on = t >= BREATH.smoke * 0.7 || Math.sin(t * t * 0.045) > 0;
    setProp(e, "sg:glow", on ? 1 : 0);
    // light races from the tail's tip to the nape: once slowly, then again in a rush
    const split = Math.floor(BREATH.smoke * 0.6);
    surgeAt(e, sc, t < split ? t / split : (t - split) / (BREATH.smoke - split), 7 * sc + 2);
    if (t % 2 === 0) { dorsalSparks(e, sc); arcs(e, sc, 1 + Math.floor(p * 3)); }
    if (t % 5 === 0) particle(dim, "sg:embers", L, sized(10 * sc + 2));
    if (t % 3 === 0 && t > 10) particle(dim, "sg:gather", mouth, sized((3 + 3 * p) * sc + 1));
    if (t % 4 === 0 && t > 16) particle(dim, "sg:mouth_glow", mouth, sized((2 + 4 * p) * sc + 1, VIOLET));
    if (t % 6 === 3 && t > 8) groundStrike(e, sc);
    if (t % 10 === 0) shake(dim, L, 70 * sc + 16, 0.12 + 0.3 * p, 0.6);
    if (t === split) { particle(dim, "sg:shockwave", L); particle(dim, "sg:land_dust", L, sized(14 * sc + 3)); sound(dim, "sg.surge", L, 128, 1, 0.8); }
    aim(e, s, sc, mouth, false, 58);
    return;
  }
  setProp(e, "sg:glow", 1);
  if (t % 3 === 0) dorsalSparks(e, sc);
  if (t === BREATH.smoke) {
    // the plates lock on: one hard pulse along the whole back
    surgeAll(e, sc, 8 * sc + 2);
    particle(dim, "sg:flash", toWorld(e, [0, 34, 4], sc), sized(22 * sc + 4));
    light(dim, toWorld(e, [0, 50, 6], sc), 30);
  }

  // ---- smoke: driven down from the mouth, then rolling outward over the ground
  if (t < BREATH.fire) {
    const d = aim(e, s, sc, mouth, false, 58);
    const p = (t - BREATH.smoke + 1) / (BREATH.fire - BREATH.smoke);
    if (t === BREATH.smoke) { setProp(e, "sg:state", "smoke"); sound(dim, "sg.breath_smoke", mouth, 256, 1); }
    if (!a.pour || t < BREATH.smoke + 6) a.pour = pourOrigin(dim, mouth, d, L.y);
    const fall = dist(mouth, a.pour.at);
    for (let i = 0; i < 3; i++) particle(dim, "sg:soot_stream", add(mouth, mul(d, fall * i / 3)), wide(W * 0.8, d, 16 * sc + 6));
    soot(dim, a.pour.at, a.pour.heading, 5 + reach * 0.8 * (1 - (1 - p) * (1 - p)), t, W, 1);
    if (t % 3 === 0) particle(dim, "sg:mouth_glow", mouth, sized(5 * sc + 1, ORANGE));
    const ph = ((t - BREATH.smoke) % 26) / 14;
    if (ph < 1) surgeAt(e, sc, ph, 6 * sc + 2);
    if (t % 4 === 0) arcs(e, sc, 1);
    if (t % 9 === 0) particle(dim, "sg:embers", L, sized(11 * sc + 2));
    if (t % 8 === 4) groundStrike(e, sc);
    if (t % 12 === 0) shake(dim, L, 70 * sc + 16, 0.25, 0.7);
    return;
  }
  if (!a.pour) a.pour = pourOrigin(dim, mouth, dirFromAngles(s.yaw, 58), L.y);
  const origin = a.pour.at;

  // ---- fire: the smoke catches and floods outward
  if (t < BREATH.focus) {
    const d = aim(e, s, sc, mouth, true, 54);
    const p = (t - BREATH.fire + 1) / (BREATH.focus - BREATH.fire);
    if (t === BREATH.fire) {
      a.phase = "fire";            // same pose as the smoke, so the entity's state stays "smoke"
      sound(dim, "sg.breath_fire", mouth, 288, 1);
      sound(dim, "sg.impact", origin, 256, 1, 0.8);
      shake(dim, L, 90 * sc + 20, 0.8, 1.0);
      flashScreen(dim, origin, 60 * sc + 16, [1.0, 0.55, 0.2], 0.03, 0.4);
      particle(dim, "sg:impact_blast", origin, sized(W * 1.2));
      particle(dim, "sg:impact_ring", origin, sized(W));
      particle(dim, "sg:flash", mouth, sized(12 * sc + 3));
      warn(e, "§6§l☢ FIRE ☢");
    }
    const fall = dist(mouth, origin);
    for (let i = 0; i < 3; i++) particle(dim, "sg:fire_stream", add(mouth, mul(d, fall * i / 3)), wide(W * 0.8, d, 20 * sc + 7));
    const heading = a.pour.heading + Math.sin((t - BREATH.fire) * 0.05) * 16;
    flood(e, origin, heading, reach * (1 - (1 - p) * (1 - p)), t, W, 1, true);
    if (t % 3 === 0) soot(dim, origin, heading, reach, t, W, 0.35);
    if (t % 16 === 0 && canGrief()) {
      const b = (heading + rand(-55, 55)) * D2R, r = rand(0.3, 1) * reach * p;
      const x = origin.x - Math.sin(b) * r, z = origin.z + Math.cos(b) * r;
      const g = groundY(dim, x, z, origin.y + 12, 30);
      if (g !== undefined) explodeAt(e, { x, y: g, z }, 2.4 * Math.max(sc, 0.5) + 0.6, true);
    }
    if (t % 12 === 0) shake(dim, L, 70 * sc + 16, 0.3, 0.7);
    const ph = ((t - BREATH.fire) % 22) / 12;
    if (ph < 1) surgeAt(e, sc, ph, 6 * sc + 2);
    if (t % 3 === 0) arcs(e, sc, 1);
    if (t % 8 === 0) particle(dim, "sg:embers", L, sized(12 * sc + 2));
    if (t % 10 === 5) groundStrike(e, sc);
    if (t % 4 === 0) particle(dim, "sg:mouth_glow", mouth, sized(6 * sc + 1, ORANGE));
    if (t % 6 === 0) light(dim, add(mouth, mul(d, 6)), 12);
    return;
  }

  // ---- focus: orange -> white-hot -> magenta, tightening into a line
  if (t < BREATH.beam) {
    const p = (t - BREATH.focus) / (BREATH.beam - BREATH.focus);
    const d = aim(e, s, sc, mouth, false, 52 - 4 * p);
    if (t === BREATH.focus) { a.phase = "focus"; setProp(e, "sg:state", "focus"); sound(dim, "sg.breath_focus", mouth, 288, 1); }
    const col = p < 0.35 ? lerp3(ORANGE, WHITE, p / 0.35) : p < 0.75 ? lerp3(WHITE, MAGENTA, (p - 0.35) / 0.4) : lerp3(MAGENTA, VIOLET, (p - 0.75) / 0.25);
    particle(dim, "sg:breath_stream", mouth, dirVars(d, { spd: (30 + 50 * p) * sc + 9, spread: 0.2 - 0.17 * p, size: (1.6 - 0.8 * p) * sc + 0.5, cr: col[0], cg: col[1], cb: col[2] }));
    if (p < 0.5) flood(e, origin, a.pour.heading, reach, t, W, 0.6, true);
    if (p > 0.3) {
      const r = castBeam(dim, mouth, d, 110 * k);
      drawBeam(dim, mouth, d, r.l, (0.35 + 1.1 * p) * k * Math.sqrt(beamK()), t, col);
      if (r.hit) impactFx(dim, r.hit, t, (1.5 + 2 * p) * k, false);
    }
    // everything winds up: the surge loops faster, the arcs thicken, a star grows in the throat
    const ph = ((t - BREATH.focus) % 12) / 9;
    if (ph < 1) surgeAt(e, sc, ph, 7 * sc + 2);
    if (t % 2 === 0) arcs(e, sc, 1 + Math.floor(p * 2));
    if (t % 2 === 0) particle(dim, "sg:gather", mouth, sized((5 - 2 * p) * sc + 1));
    if (t % 3 === 0) particle(dim, "sg:flash", mouth, sized((3 + 7 * p) * sc + 1));
    if (t % 6 === 0) particle(dim, "sg:embers", L, sized(12 * sc + 2));
    if (t % 4 === 2) groundStrike(e, sc);
    if (t % 8 === 0) shake(dim, L, 70 * sc + 16, 0.2 + 0.4 * p, 0.6);
    if (t % 5 === 0) light(dim, add(mouth, mul(d, 5)), 10);
    return;
  }

  // ---- beam
  if (t < BREATH.end) {
    const bt = t - BREATH.beam;
    const slam = clamp(1 - bt / 22, 0, 1);                   // lands wide and low, then tightens and lifts
    const d = aim(e, s, sc, mouth, true, slam > 0 ? 50 : undefined);
    const rage = isRampage(e);
    const col = rage ? lerp3(VIOLET, CRIMSON, 0.5 + 0.5 * Math.sin(t * 0.21)) : VIOLET;
    if (bt === 0) {
      setProp(e, "sg:state", "beam");
      sound(dim, "sg.ignite", L, 320, 1);
      sound(dim, "sg.breath_beam", mouth, 320, 1);
      shake(dim, L, 110 * sc + 24, 1.3, 1.6);
      flashScreen(dim, L, 90 * sc + 24, [0.8, 0.62, 1.0], 0.06, 0.55);
      particle(dim, "sg:flash", mouth, sized(36 * sc + 6));
      particle(dim, "sg:shockwave", L);
      particle(dim, "sg:land_dust", L, sized(18 * sc + 4));
      for (let i = 0; i < 3; i++) particle(dim, "sg:embers", L, sized((6 + 6 * i) * sc + 2));
      surgeAll(e, sc, 9 * sc + 2);
      for (let i = 0; i < 4; i++) groundStrike(e, sc);
      warn(e, "§d§l☢ ATOMIC BREATH ☢");
    }
    const sputter = t >= BREATH.sputter;
    const live = !sputter || (t % 5 < 3);
    const maxLen = 150 * Math.max(sc, 0.35) * (0.7 + 0.3 * beamK());
    const r = castBeam(dim, mouth, d, maxLen);
    const Wb = (2.3 * k + 0.3) * Math.sqrt(beamK()) * (1 + 0.9 * slam) * (sputter ? 0.6 : 1);
    if (live) {
      drawBeam(dim, mouth, d, r.l, Wb, t, col, !!r.hit);
      if (r.hit) {
        impactFx(dim, r.hit, t, Wb * 1.5 + 0.5, true);
        if (t % 3 === 0) explodeAt(e, r.hit, (3.2 * Math.max(sc, 0.5) + 0.8) * Math.sqrt(beamK()), true);
        if (t % 12 === 0) sound(dim, "sg.impact", r.hit, 200, 0.9, rand(0.85, 1.1));
      }
      if (t % 4 === 0) damageAlongRay(e, mouth, d, r.l, Wb + 0.4, 14, 5, 0.004);
      if (t % 3 === 0) light(dim, add(mouth, mul(d, Math.min(r.l * 0.5, 10 + (bt % 4) * 14))), 10);
    } else {
      particle(dim, "sg:breath_stream", mouth, dirVars(d, { spd: 30 * sc + 9, spread: 0.12, size: 0.9 * sc + 0.4, cr: MAGENTA[0], cg: MAGENTA[1], cb: MAGENTA[2] }));
    }
    if (bt < 60 && bt % 3 === 0) flood(e, origin, a.pour.heading, reach, t, W, 0.4, false);   // the fire below is still burning
    if (t % 10 === 0) shake(dim, L, 80 * sc + 16, 0.35, 0.6);
    if (t % 4 === 0) arcs(e, sc, 1);
    if (t % 9 === 4) groundStrike(e, sc);
    if (t % 10 === 0) particle(dim, "sg:embers", L, sized(12 * sc + 2));

    // the tail swings up and over and joins in with a ray of its own
    const tgt = validTarget(s);
    const goal = s.aimPoint ?? (tgt ? center(tgt) : undefined);
    const tip = tailTip(e, s, sc, A4.tail_breath_by_swing, goal, t);
    if (bt === 24) {
      sound(dim, "sg.tail_ray", tip, 288, 1);
      particle(dim, "sg:flash", tip, sized(10 * sc + 3));
      warn(e, "§d§l☢ ATOMIC BREATH + TAIL RAY ☢");
    }
    if (bt >= 24 && !sputter) tailRay(e, s, sc, tip, goal, t, a);
    else if (bt >= 6 && bt < 24 && t % 2 === 0) particle(dim, "sg:gather", tip, sized(3 * sc + 1));
    // the rampaging one throws rays from its back as well: mouth, tail and plates all at once
    if (rage && bt >= 50 && !sputter) {
      if (bt === 50) sound(dim, "sg.rays", L, 288, 1, 0.95);
      dorsalFan(e, sc, t, a);
    }
    return;
  }
  spend(e, s, 40);
  s.cd.breath = cool(e, 600);
  endAbility(e, s);
}

// ------------------------------------------------------------------ dorsal rays, tail ray
function tickDorsal(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  if (t === 0) {
    setProp(e, "sg:state", "dorsal");
    setProp(e, "sg:glow", 1);
    sound(dim, "sg.charge", e.location, 256, 1, 1.15);
    a.targets = airborneTargets(e, sc);
    a.seed = Math.random() * 360;
  }
  if (t < 30) {
    dorsalSparks(e, sc);
    if (t % 2 === 0) arcs(e, sc, 2);
    surgeAt(e, sc, t / 30, 7 * sc + 2);
    return;
  }
  if (t === 30) {
    sound(dim, "sg.rays", e.location, 288, 1);
    shake(dim, e.location, 80 * sc + 16, 0.5, 1.0);
    surgeAll(e, sc, 8 * sc + 2);
    warn(e, "§d§l☢ DORSAL RAYS ☢");
  }
  if (t < 150) {
    const pts = dorsalPoints(e, sc);
    if (t % 15 === 0) a.targets = airborneTargets(e, sc);
    const tg = a.targets.filter((x) => { try { return x.isValid; } catch { return false; } });
    const n = Math.min(pts.length, 10);
    const col = isRampage(e) ? MAGENTA : VIOLET;
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
      const r = castBeam(dim, o, d, 90 * Math.max(sc, 0.4));
      drawRay(dim, o, d, r.l, 0.5 * Math.max(sc, 0.4) + 0.15, t, col);
      if (r.hit && t % 6 === i % 6) {
        impactFx(dim, r.hit, t, 1.8, false);
        if (i % 3 === 0) explodeAt(e, r.hit, 2.2, false);
      }
      if (t % 4 === 0) damageAlongRay(e, o, d, r.l, 1.6, 9, 3, 0.002);
    }
    if (t % 4 === 0) arcs(e, sc, 1);
    return;
  }
  spend(e, s, 30);
  s.cd.dorsal = cool(e, 700);
  endAbility(e, s);
}

function tickTail(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  if (t === 0) {
    setProp(e, "sg:state", "tail");
    setProp(e, "sg:glow", 1);
    sound(dim, "sg.charge", e.location, 200, 1, 1.3);
    warn(e, "§5☢ §dThe tail is glowing... §5☢");
  }
  const tgt = validTarget(s);
  const goal = s.aimPoint ?? (tgt ? center(tgt) : undefined);
  const tip = tailTip(e, s, sc, A4.tail_by_swing, goal, t);
  if (t < 30) {
    // light runs down the tail to its tip before it fires
    surgeAt(e, sc, (1 - t / 30) * 0.55, 6 * sc + 2);
    if (t % 2 === 0) particle(dim, "sg:gather", tip, sized(3 * sc + 1));
    if (t % 3 === 0) arcs(e, sc, 1);
    return;
  }
  if (t === 30) {
    sound(dim, "sg.tail_ray", tip, 288, 1);
    particle(dim, "sg:flash", tip, sized(12 * sc + 3));
    shake(dim, e.location, 70 * sc + 16, 0.5, 0.8);
    warn(e, "§d§l☢ TAIL RAY ☢");
  }
  if (t < 130) { tailRay(e, s, sc, tip, goal, t, a); return; }
  spend(e, s, 20);
  s.cd.tail = cool(e, 500);
  endAbility(e, s);
}

// ------------------------------------------------------------------ leaps
/** Solid ground to come down on: `want` blocks along `dir`, or a little short of it. */
function landingSpot(e, dir, want, sc) {
  const dim = e.dimension, L = e.location;
  for (const k of [1, 0.75, 0.5]) {
    const x = L.x + dir.x * want * k, z = L.z + dir.z * want * k;
    let y;
    try {
      const hit = dim.getBlockFromRay({ x, y: L.y + 30 * sc + 12, z }, { x: 0, y: -1, z: 0 }, { maxDistance: 60 * sc + 40, includeLiquidBlocks: false, includePassableBlocks: false });
      if (hit) y = hit.block.location.y + 1;
    } catch { /* unloaded */ }
    if (y === undefined || Math.abs(y - L.y) > 18 * sc + 6) continue;
    return { x, y, z, d: want * k };
  }
  return undefined;
}

/** Jump `want` blocks along `dir` (a unit vector on the ground); `then` is what he does on landing. */
function startLeap(e, s, sc, dir, want, then) {
  const to = landingSpot(e, dir, want, sc);
  if (!to || to.d < 10 * sc) return false;
  startAbility(e, s, "leap", { from: { ...e.location }, to, air: clamp(Math.round(to.d * 0.42 / Math.max(sc, 0.5)) + 8, 14, 26), then });
  s.cd.leap = cool(e, 260);
  setProp(e, "sg:state", "leap");
  sound(e.dimension, "sg.growl", e.location, 128, 1, 1.2);
  return true;
}

function tickLeap(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  const T = TIMING.leap;
  const tgt = validTarget(s);
  if (tgt) turnTo(e, s, yawTo(e.location, tgt.location), 6);
  if (t < T.crouch) return;                                   // sinking onto the haunches
  const at = t - T.crouch;
  if (at === 0) {
    sound(dim, "sg.leap", a.from, 160, 1);
    particle(dim, "sg:land_dust", a.from, sized(12 * sc + 3));
    particle(dim, "sg:shockwave", a.from);
    shake(dim, a.from, 60 * sc + 16, 0.6, 0.5);
    crater(dim, { x: a.from.x, y: a.from.y - 1, z: a.from.z }, Math.round(3 * sc + 1));
  }
  if (at < a.air) {
    // fly the arc: steer the body along it (a hard correction if something knocked it off)
    const p = (at + 1) / a.air;
    const H = clamp(a.to.d * 0.3, 6 * sc, 22 * sc);
    const P = { x: lerp(a.from.x, a.to.x, p), y: lerp(a.from.y, a.to.y, p) + H * 4 * p * (1 - p), z: lerp(a.from.z, a.to.z, p) };
    const want = sub(P, e.location);
    try {
      if (len(want) > 8) e.teleport(P, { rotation: { x: 0, y: s.yaw } });
      else e.applyImpulse(sub(want, e.getVelocity()));
    } catch {
      try { e.teleport(P, { rotation: { x: 0, y: s.yaw } }); } catch { /* ignore */ }
    }
    if (at % 3 === 0) particle(dim, "sg:dust", { x: e.location.x, y: e.location.y, z: e.location.z });
    return;
  }
  const lt = at - a.air;
  if (lt === 0) {
    try { e.teleport(a.to, { rotation: { x: 0, y: s.yaw } }); } catch { /* ignore */ }
    setProp(e, "sg:state", "land");
    slam(e, sc, a.to, 18 * sc + 4, 30, 0.02);
  }
  if (lt < T.land) return;
  // on his feet again: straight into whatever he jumped for
  const then = a.then;
  if (then && !(s.energy <= 8 && !isRampage(e))) {
    s.act = { name: then, t: -1 };
    s.yaw = e.getRotation().y;
    s.pitch = 0;
    s.aimProp = 0;
    return;
  }
  endAbility(e, s);
}

/** Something enormous comes down at `at`: dust, rubble, a ring through the ground, and everyone near thrown back. */
function slam(e, sc, at, radius, damage, pct) {
  const dim = e.dimension;
  sound(dim, "sg.land", at, 256, 1);
  particle(dim, "sg:shockwave", at);
  particle(dim, "sg:land_dust", at, sized(radius * 1.2));
  particle(dim, "sg:rubble", at, sized(radius * 0.6));
  particle(dim, "sg:impact_ring", at, sized(radius * 0.5));
  shake(dim, at, radius * 6 + 20, 1.6, 1.0);
  crater(dim, { x: at.x, y: at.y - 1, z: at.z }, Math.round(5 * sc + 1));
  for (const en of victims(e, at, radius)) {
    const f = 1 - dist(en.location, at) / radius;
    hurt(en, damage * (0.4 + 0.6 * f), e, 0, pct);
    knock(en, at, 2.6 + 2 * f, 0.7 + 0.5 * f);
  }
}

// ------------------------------------------------------------------ melee
function tickBite(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  const T = TIMING.bite;
  const tgt = validTarget(s);
  if (t === 0) {
    setProp(e, "sg:state", "bite");
    sound(dim, "sg.growl", e.location, 128, 1, 1.35);
  }
  if (tgt && t < T.hit) turnTo(e, s, yawTo(e.location, tgt.location), 7);
  if (t === T.hit) {
    const at = toWorld(e, anchorsOf(e).bite_mouth, sc, s.yaw);
    sound(dim, "sg.bite", at, 160, 1);
    const fwd = dirFromAngles(s.yaw, 30);
    particle(dim, "sg:slash", at, dirVars(fwd, { size: 9 * sc + 2 }));
    particle(dim, "sg:slash", add(at, { x: 0, y: 3 * sc, z: 0 }), dirVars(fwd, { size: 7 * sc + 2 }));
    particle(dim, "sg:impact_fountain", at);
    shake(dim, at, 50 * sc + 12, 0.8, 0.5);
    const hitIds = new Set();
    for (const en of victims(e, at, 10 * sc + 3)) { hitIds.add(en.id); hurt(en, 34, e, 0, 0.03); knock(en, e.location, 2.2, 0.6); }
    // a rival pressed against his chest is inside the lunge even if its feet are not at the jaws
    if (tgt && !hitIds.has(tgt.id) && hdist(tgt.location, e.location) < 24 * sc + 4) { hurt(tgt, 34, e, 0, 0.03); knock(tgt, e.location, 1.6, 0.4); }
    const g = groundY(dim, at.x, at.z, at.y + 2, 20 * sc + 6);
    if (g !== undefined && at.y - g < 6 * sc) {
      particle(dim, "sg:land_dust", { x: at.x, y: g, z: at.z }, sized(8 * sc + 2));
      crater(dim, { x: at.x, y: g - 1, z: at.z }, Math.round(3 * sc + 1));
    }
  }
  if (t < T.end) return;
  s.cd.bite = cool(e, 70);
  endAbility(e, s);
}

/** The tail is let down and thrown round through everything behind and beside him. */
function tickSweep(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  const T = TIMING.sweep;
  const [b0, b1, R] = anchorsOf(e).sweep_arc;
  if (t === 0) {
    setProp(e, "sg:state", "sweep");
    sound(dim, "sg.sweep", e.location, 200, 1);
    a.hit = new Set();
  }
  if (t >= T.from && t <= T.to) {
    const bearing = (tt) => lerp(b0, b1, smooth(clamp((tt - T.from) / (T.to - T.from), 0, 1)));
    const lo = bearing(t - 1) - 5, hi = bearing(t) + 5;
    const base = anchorsOf(e).tail_base;
    // the tail's own line through the air at this instant: dust, and whatever it hits
    const b = bearing(t) * D2R;
    for (const r of [0.3, 0.55, 0.8, 1.0]) {
      const p = toWorld(e, [base[0] + Math.sin(b) * R * r, 3, base[2] + Math.cos(b) * R * r], sc, s.yaw);
      const g = groundY(dim, p.x, p.z, p.y + 12 * sc, 40) ?? p.y;
      particle(dim, "sg:dust", { x: p.x, y: g, z: p.z });
      if (r > 0.9) particle(dim, "sg:slash", { x: p.x, y: g + 4 * sc, z: p.z }, dirVars(norm({ x: Math.cos(s.yaw * D2R), y: 0.1, z: Math.sin(s.yaw * D2R) }), { size: 10 * sc + 2 }));
    }
    if (canGrief()) {
      for (let r = 10; r <= R; r += 2.2) {
        const p = toWorld(e, [base[0] + Math.sin(b) * r, 0, base[2] + Math.cos(b) * r], sc, s.yaw);
        for (let h = 1; h <= 9 * sc; h += 1) smash(dim, p.x, e.location.y + h, p.z);
      }
    }
    for (const en of victims(e, e.location, (R + 8) * sc)) {
      if (a.hit.has(en.id)) continue;
      const q = toLocal(e, en.location, sc, s.yaw);
      const r = Math.hypot(q[0] - base[0], q[2] - base[2]);
      if (r < 7 || r > R + 4 || q[1] > 18 || q[1] < -8) continue;
      const ang = Math.atan2(q[0] - base[0], q[2] - base[2]) / D2R;
      if (ang < lo || ang > hi) continue;
      a.hit.add(en.id);
      hurt(en, 28, e, 0, 0.025);
      // thrown the way the tail is travelling
      const dir = toWorld(e, [Math.cos(ang * D2R), 0, -Math.sin(ang * D2R)], 1, s.yaw);
      const away = norm(sub(dir, e.location));
      try { en.applyKnockback({ x: away.x * 4.5, z: away.z * 4.5 }, 0.9); } catch {
        try { en.applyImpulse({ x: away.x * 2.2, y: 0.6, z: away.z * 2.2 }); } catch { /* ignore */ }
      }
      particle(dim, "sg:impact_fountain", center(en));
    }
    if (t === T.from + 5) { sound(dim, "sg.crash", e.location, 128, 1, 0.9); shake(dim, e.location, 80 * sc + 16, 0.9, 0.6); }
  }
  if (t < T.end) return;
  s.cd.sweep = cool(e, 220);
  endAbility(e, s);
}

function tickStomp(e, s, sc) {
  const t = s.act.t;
  if (t === 0) setProp(e, "sg:state", "land");
  if (t === 2) slam(e, sc, e.location, 13 * sc + 3, 16, 0.015);
  if (t < 16) return;
  s.cd.stomp = cool(e, 120);
  endAbility(e, s);
}

// ------------------------------------------------------------------ Godzilla Minus One / Minus Zero: hand to hand
// He does not fight like Shin Godzilla.  He has real arms and uses them; he takes things in his
// jaws, lifts them and throws them; he turns his whole body to bring the tail round; and he does
// not jump: he puts his head down and charges.

/** A direction given in the kaiju's own axes (x = his left, z = behind him), in the world. */
function localDir(e, v, yaw) {
  return norm(sub(toWorld(e, v, 1, yaw), e.location));
}
/** Small enough to be picked up in the jaws: not another giant. */
function liftable(en) {
  return !KAIJU.has(en.typeId) && maxHp(en) < 400;
}
function throwEntity(en, dir, power, lift) {
  try { en.applyKnockback({ x: dir.x * power, z: dir.z * power }, lift); } catch {
    try { en.applyImpulse({ x: dir.x * power * 0.5, y: lift * 0.7, z: dir.z * power * 0.5 }); } catch { /* ignore */ }
  }
}
/** Go straight from one move into the next (as a landing does). */
function chain(e, s, name, extra) {
  s.act = { name, t: -1, ...(extra ?? {}) };
  s.yaw = e.getRotation().y;
  s.pitch = 0;
  s.aimProp = 0;
}

/** Two raking blows, the right claw and then the left, each through everything in front of him. */
function tickClaw(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  const T = TIMING.claw, A = anchorsOf(e);
  const tgt = validTarget(s);
  if (t === 0) {
    setProp(e, "sg:state", "bite");
    sound(dim, "sg.growl", e.location, 128, 1, 1.5);
  }
  if (tgt && t < T.hit2) turnTo(e, s, yawTo(e.location, tgt.location), 5);
  for (const [tick, hand, side] of [[T.hit1, A.claw_R, -1], [T.hit2, A.claw_L, 1]]) {
    if (t === tick - 3) sound(dim, "sg.sweep", e.location, 128, 0.9, 1.7);
    if (t !== tick) continue;
    const at = toWorld(e, hand, sc, s.yaw);
    const dir = localDir(e, [-side, -0.45, -0.25], s.yaw);          // the way the claws are travelling
    for (const k of [-1, 0, 1]) particle(dim, "sg:slash", add(at, { x: 0, y: k * 2.4 * sc, z: 0 }), dirVars(dir, { size: 9 * sc + 2 }));
    particle(dim, "sg:impact_fountain", at);
    sound(dim, "sg.bite", at, 160, 1, 0.8);
    sound(dim, "sg.impact", at, 128, 0.9, 1.25);
    shake(dim, at, 46 * sc + 12, 0.7, 0.4);
    const from = toWorld(e, [side * 30, 0, 12], sc, s.yaw);          // struck the way the blow is going
    const hit = new Set();
    for (const en of victims(e, at, 12 * sc + 3)) { hit.add(en.id); hurt(en, 24, e, 0, 0.022); knock(en, from, 2.6, 0.5); particle(dim, "sg:impact_fountain", center(en)); }
    if (tgt && !hit.has(tgt.id) && hdist(tgt.location, e.location) < 22 * sc + 4 + bodyRadius(tgt)) { hurt(tgt, 24, e, 0, 0.022); knock(tgt, from, 1.5, 0.35); }
    if (canGrief()) for (const k of [-1, 0, 1]) crater(dim, toWorld(e, [hand[0] - side * k * 4, hand[1] - 2 + k, hand[2] - 2], sc, s.yaw), Math.round(3 * sc + 1));
  }
  if (t < T.end) return;
  s.cd.claw = cool(e, 60);
  endAbility(e, s);
}

/** The jaws close on it; it is lifted clear of the ground, shaken, and thrown.  A giant cannot be lifted: it is held and worried instead. */
function tickGrab(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  const T = TIMING.grab, A = anchorsOf(e);
  const tgt = validTarget(s);
  if (t === 0) {
    setProp(e, "sg:state", "dorsal");
    sound(dim, "sg.growl", e.location, 128, 1, 1.3);
    a.held = undefined;
    a.gnaw = undefined;
  }
  if (tgt && t < T.bite) turnTo(e, s, yawTo(e.location, tgt.location), 7);
  const mouth = toWorld(e, lerpTable(A.grab, clamp(t, T.bite, T.release)), sc, s.yaw);
  if (t === T.bite) {
    sound(dim, "sg.bite", mouth, 160, 1);
    particle(dim, "sg:impact_fountain", mouth);
    particle(dim, "sg:slash", mouth, dirVars(dirFromAngles(s.yaw, 30), { size: 9 * sc + 2 }));
    shake(dim, mouth, 50 * sc + 12, 0.8, 0.5);
    let best, bd = Infinity;
    for (const en of victims(e, mouth, 10 * sc + 3)) {
      hurt(en, 26, e, 0, 0.025);
      const d = dist(center(en), mouth);
      if (d < bd && liftable(en)) { best = en; bd = d; }
    }
    if (tgt && hdist(tgt.location, e.location) < 22 * sc + 4 + bodyRadius(tgt)) {
      if (!best && liftable(tgt)) { hurt(tgt, 26, e, 0, 0.025); best = tgt; }
      else if (!liftable(tgt)) { hurt(tgt, 26, e, 0, 0.025); a.gnaw = tgt; }
    }
    a.held = best;
    const g = groundY(dim, mouth.x, mouth.z, mouth.y + 2, 20 * sc + 6);
    if (g !== undefined && mouth.y - g < 6 * sc) { particle(dim, "sg:land_dust", { x: mouth.x, y: g, z: mouth.z }, sized(8 * sc + 2)); crater(dim, { x: mouth.x, y: g - 1, z: mouth.z }, Math.round(3 * sc + 1)); }
  }
  const alive = (en) => { try { return !!en && en.isValid; } catch { return false; } };
  if (t > T.bite && t < T.release) {
    const h = a.held;
    if (alive(h)) {
      // carried in the mouth
      const drop = center(h).y - h.location.y;
      try { h.teleport({ x: mouth.x, y: mouth.y - drop, z: mouth.z }, { keepVelocity: false }); } catch { /* ignore */ }
      if ((t - T.bite) % 6 === 0) { hurt(h, 5, e, 0, 0.006); sound(dim, "sg.impact", mouth, 96, 0.7, 1.5); }
    } else if (alive(a.gnaw) && (t - T.bite) % 6 === 0) {
      hurt(a.gnaw, 9, e, 0, 0.008);
      particle(dim, "sg:impact_fountain", mouth);
      sound(dim, "sg.impact", mouth, 96, 0.8, 1.3);
      shake(dim, mouth, 40 * sc + 10, 0.5, 0.3);
    }
  }
  if (t === T.release) {
    sound(dim, "sg.sweep", mouth, 160, 1, 1.25);
    const dir = localDir(e, [0.8, 0, -0.6], s.yaw);                  // the way the head is swinging as the jaws open
    const far = a.far ? 1.5 : 1;                                      // making room for the heat ray: thrown clear
    if (alive(a.held)) {
      throwEntity(a.held, dir, 7 * far, 1.4);
      hurt(a.held, 20, e, 0, 0.03);
      thrown.push({ en: a.held, by: e, t: 0, sc });
      particle(dim, "sg:slash", mouth, dirVars(dir, { size: 10 * sc + 2 }));
    } else if (alive(a.gnaw)) {
      hurt(a.gnaw, 20, e, 0, 0.02);
      throwEntity(a.gnaw, localDir(e, [0, 0, -1], s.yaw), 3.2 * far, 0.6);
    }
  }
  if (t < T.end) return;
  s.cd.grab = cool(e, 160);
  if (a.then && s.cd.heat <= 0) { chain(e, s, a.then); return; }
  endAbility(e, s);
}

/** Things he has thrown: where they come down there is a crater. */
const thrown = [];
function tickThrown() {
  for (let i = thrown.length - 1; i >= 0; i--) {
    const th = thrown[i];
    th.t++;
    let done = th.t > 80;
    try {
      const en = th.en;
      if (!en.isValid) done = true;
      else if (th.t > 6 && (en.isOnGround || Math.abs(en.getVelocity().y) < 0.02 && th.t > 12)) {
        const at = en.location;
        sound(en.dimension, "sg.crash", at, 128, 1, 1.1);
        particle(en.dimension, "sg:land_dust", at, sized(7 * th.sc + 2));
        particle(en.dimension, "sg:debris", at);
        shake(en.dimension, at, 40, 0.6, 0.4);
        crater(en.dimension, { x: at.x, y: at.y - 1, z: at.z }, Math.round(3 * th.sc + 1));
        if (th.by.isValid) hurt(en, 18, th.by, 0, 0.02);
        done = true;
      }
    } catch { done = true; }
    if (done) thrown.splice(i, 1);
  }
}

/** He turns his whole body once round and the tail comes with it, flat and fast, through everything within its length. */
function tickWhip(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t;
  const T = TIMING.whip, A = anchorsOf(e);
  const W = A.whip;
  if (t === 0) {
    setProp(e, "sg:state", "sweep");
    sound(dim, "sg.growl", e.location, 128, 1, 1.1);
    a.hit = new Set();
  }
  if (t === T.from - 3) sound(dim, "sg.sweep", e.location, 200, 1, 0.8);
  if (t >= T.from && t <= T.to) {
    const row = (tt) => lerpTable(W, clamp(tt, W[0][0], W[W.length - 1][0]));   // [bearing of the tip, reach, bearing of the root]
    const [b1, R, r1] = row(t), [b0, , r0] = row(t - 1);
    const lo = Math.min(b0, b1, r0, r1) - 4, hi = Math.max(b0, b1, r0, r1) + 4;
    const along = (f) => (b1 + (r1 - b1) * (1 - f)) * D2R;                      // the tail trails: its root leads its tip
    for (const f of [0.35, 0.6, 0.8, 1.0]) {
      const bb = along(f);
      const p = toWorld(e, [Math.sin(bb) * R * f, 3, Math.cos(bb) * R * f], sc, s.yaw);
      const g = groundY(dim, p.x, p.z, p.y + 12 * sc, 40) ?? p.y;
      particle(dim, "sg:dust", { x: p.x, y: g, z: p.z });
      if (f === 1.0) particle(dim, "sg:slash", { x: p.x, y: g + 3 * sc, z: p.z }, dirVars(localDir(e, [Math.cos(bb), 0.1, -Math.sin(bb)], s.yaw), { size: 12 * sc + 2 }));
    }
    if (canGrief()) {
      for (let r = 9; r <= R; r += 2.4) {
        const bb = along(r / R);
        const p = toWorld(e, [Math.sin(bb) * r, 0, Math.cos(bb) * r], sc, s.yaw);
        for (let h = 1; h <= 8 * sc; h += 1) smash(dim, p.x, e.location.y + h, p.z);
      }
    }
    for (const en of victims(e, e.location, (R + 10) * sc)) {
      if (a.hit.has(en.id)) continue;
      const q = toLocal(e, en.location, sc, s.yaw);
      const r = Math.hypot(q[0], q[2]);
      if (r < 6 || r > R + 4 + bodyRadius(en) / sc || q[1] > 22 || q[1] < -8) continue;
      let ang = Math.atan2(q[0], q[2]) / D2R;
      while (ang < lo) ang += 360;                                   // the table's bearings run on past a full turn
      if (ang > hi) continue;
      a.hit.add(en.id);
      hurt(en, 30, e, 0, 0.03);
      // hurled outward, and on round the way the tail is going
      const sn = Math.sin(ang * D2R), cs = Math.cos(ang * D2R);
      throwEntity(en, localDir(e, [sn + cs * 0.6, 0, cs - sn * 0.6], s.yaw), a.then ? 8.5 : 6, 1.1);
      particle(dim, "sg:impact_fountain", center(en));
      sound(dim, "sg.impact", en.location, 128, 1, 0.9);
    }
    if (t === T.from + 6) { sound(dim, "sg.crash", e.location, 128, 1, 0.9); shake(dim, e.location, 90 * sc + 16, 1.0, 0.7); }
  }
  if (t < T.end) return;
  s.cd.whip = cool(e, 240);
  if (a.then && s.cd.heat <= 0) { chain(e, s, a.then); return; }
  endAbility(e, s);
}

/** He does not leap.  He puts his head down and comes straight through whatever is in the way. */
function startRush(e, s, sc, tgt, then) {
  const want = clamp(hdist(tgt.location, e.location) - 15 * sc, 0, 70 * sc);
  if (want < 12 * sc) return false;
  startAbility(e, s, "rush", { want, then, gone: 0, stuck: 0, hit: new Set(), last: { ...e.location } });
  s.cd.rush = cool(e, 280);
  setProp(e, "sg:state", "leap");
  sound(e.dimension, "sg.growl", e.location, 160, 1, 0.9);
  return true;
}

function tickRush(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t, L = e.location;
  const tgt = validTarget(s);
  if (tgt) turnTo(e, s, yawTo(L, tgt.location), 3);
  const fwd = dirFromAngles(s.yaw, 0);
  const v = 1.1 * sc + 0.25;                                       // blocks a tick: four or five times his walk
  const moved = hdist(L, a.last);
  a.last = { ...L };
  a.gone += Math.min(moved, v * 2);
  a.stuck = t > 3 && moved < v * 0.3 ? a.stuck + 1 : 0;
  bulldoze(e, sc, 9, 8, 1, 30);
  bulldoze(e, sc, 13, 8, 1, 30);
  // driven along the ground; if he is not getting anywhere he is moved a stride at a time
  let moving = true;
  try {
    if (a.stuck >= 2) {
      const nx = L.x + fwd.x * v, nz = L.z + fwd.z * v;
      const g = groundY(dim, nx, nz, L.y + 6 * sc + 3, 14 * sc + 10);
      if (g === undefined || Math.abs(g - L.y) > 5 * sc + 2) moving = false;
      else e.teleport({ x: nx, y: g, z: nz }, { rotation: { x: 0, y: s.yaw } });
    } else {
      const vel = e.getVelocity();
      e.applyImpulse({ x: fwd.x * v - vel.x, y: 0, z: fwd.z * v - vel.z });
    }
  } catch { moving = false; }
  if (t % 4 === 0) {
    const foot = toWorld(e, [t % 8 === 0 ? 5 : -5, 0, -2], sc, s.yaw);
    sound(dim, "sg.step", foot, 160, 1, 1.15);
    particle(dim, "sg:land_dust", foot, sized(6 * sc + 2));
    shake(dim, foot, 50 * sc + 14, 0.5, 0.3);
  }
  // whatever he meets is thrown aside
  const chest = toWorld(e, [0, 8, -12], sc, s.yaw);
  for (const en of victims(e, chest, 11 * sc + 3)) {
    if (a.hit.has(en.id)) continue;
    a.hit.add(en.id);
    hurt(en, 20, e, 0, 0.02);
    knock(en, L, 3.2, 0.8);
    particle(dim, "sg:impact_fountain", center(en));
    sound(dim, "sg.impact", en.location, 128, 1, 1.0);
  }
  const near = !!tgt && hdist(tgt.location, L) < 17 * sc + 4 + bodyRadius(tgt);
  if (!(a.gone >= a.want || near || !moving || a.stuck >= 8 || t > 80)) return;
  try { const vel = e.getVelocity(); e.applyImpulse({ x: -vel.x, y: 0, z: -vel.z }); } catch { /* ignore */ }
  if (near && a.then) { chain(e, s, a.then); return; }
  endAbility(e, s);
}

// ------------------------------------------------------------------ roar, dormancy, freezing, dying
function roarOf(e) {
  return isMinus(e) ? "sg.roar_m" : is4(e) ? "sg.roar4" : e.typeId === F3 ? "sg.roar3" : "sg.roar2";
}
function startRoar(e, s, fromTransform) {
  const dim = e.dimension, sc = scaleOf(e);
  setProp(e, "sg:state", "roar");
  s.roarT = isMinus(e) ? TIMING.roar_m : is4(e) ? TIMING.roar : 66;
  sound(dim, roarOf(e), e.location, isBig(e) ? 320 : 160, 1, isRampage(e) || e.typeId === M0 ? rand(0.84, 0.9) : rand(0.95, 1.03));
  shake(dim, e.location, 80 * sc + 16, 0.4, 2.5);
  s.cd.roar = fromTransform ? 300 : cool(e, 700);
}

function goDormant(e, s) {
  s.act = null;
  trigger(e, "sg:go_dormant");
  setProp(e, "sg:state", "dormant");
  setProp(e, "sg:glow", 0);
  setProp(e, "sg:aim", 0);
  setProp(e, "sg:tail", 0);
  s.dormantT = DORMANT_TICKS;
  s.doses = 0;
  e.setDynamicProperty("sg:doses", 0);
  e.setDynamicProperty("sg:dormant", s.dormantT);
  sound(e.dimension, "sg.dormant", e.location, 96, 1);
  world.sendMessage("§5[Kaiju]§r §7Shin Godzilla has exhausted its energy and gone dormant to cool down. Now is the time for the §bYashiori Strategy§7: inject §bYashiori Coagulant§7 " + DOSES_NEEDED + " times!");
}
function wake(e, s) {
  setProp(e, "sg:state", "waking");
  s.wakeT = 60;
  sound(e.dimension, "sg.roar4", e.location, 320, 1, 0.95);
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
  sound(dim, "sg.freeze", e.location, 160, 1);
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
  setProp(e, "sg:tail", 0);
  setProp(e, "sg:fins", 0);
  s.dyingT = isBig(e) ? 96 : 70;
  if (isMinus(e)) setProp(e, "sg:glow", 1);        // the light is coming out of him
  sound(e.dimension, roarOf(e), e.location, 320, 1, 0.8);
}
function finishDying(e) {
  const dim = e.dimension, L = e.location, sc = scaleOf(e);
  const n = isBig(e) ? 6 : e.typeId === F3 ? 3 : 2;
  if (isMinus(e)) {
    // he goes the way the film ends: the light bursts out of him and he comes apart
    const c = { x: L.x, y: L.y + 14 * sc, z: L.z };
    particle(dim, "sg:nuke_flash", c, sized(60 * sc + 10));
    for (let i = 0; i < 6; i++) particle(dim, "sg:blue_sparks", add(c, { x: rand(-8, 8) * sc, y: rand(-8, 12) * sc, z: rand(-8, 8) * sc }), sized(3 * sc + 1));
    sound(dim, "sg.impact", c, 256, 1, 0.7);
    flashScreen(dim, c, 100 * sc + 20, [0.75, 0.9, 1.0], 0.1, 0.9);
  }
  try { dim.spawnItem(new ItemStack("sg:g_cell", n), add(L, { x: 0, y: 2, z: 0 })); } catch { /* ignore */ }
  sound(dim, "sg.land", L, 256, 1, 0.7);
  shake(dim, L, 80, 1.5, 1.2);
  particle(dim, "sg:land_dust", L, sized(20 * sc + 4));
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
  sound(e.dimension, "sg.evolve", e.location, 160, 1);
  sound(e.dimension, e.typeId === F2 ? "sg.roar2" : "sg.roar3", e.location, 160, 1, 0.9);
}
function tickEvolve(e, s, sc) {
  const dim = e.dimension;
  s.evolveT++;
  if (s.evolveT % 3 === 0) particle(dim, "sg:steam", toWorld(e, [rand(-4, 4), rand(2, e.typeId === F2 ? 8 : 20), rand(-6, 10)], sc));
  if (s.evolveT % 5 === 0) particle(dim, "sg:evolve_burst", toWorld(e, [rand(-3, 3), rand(2, e.typeId === F2 ? 7 : 18), rand(-4, 6)], sc));
  if (s.evolveT % 20 === 0) shake(dim, e.location, 60 * sc + 16, 0.3, 1.0);
  if (s.evolveT === 120) {
    for (let i = 0; i < 8; i++) particle(dim, "sg:evolve_burst", toWorld(e, [rand(-5, 5), rand(1, 14), rand(-6, 8)], sc));
    sound(dim, "sg.crash", e.location, 128, 1, 0.7);
    trigger(e, "sg:evolve");
  }
}

// ------------------------------------------------------------------ walking through the world
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
    if (Math.random() < 0.4) sound(dim, "sg.crash", c, 96, 0.9, rand(0.8, 1.1));
  }
  return n;
}

/** Anything under a foot when it lands is crushed. */
function trample(e, fp, sc) {
  const R = (isBig(e) ? 4.5 : e.typeId === F3 ? 3 : 2.5) * sc + 1;
  for (const en of victims(e, fp, R)) hurt(en, isBig(e) ? 22 : e.typeId === F3 ? 10 : 6, e, 0, 0.01);
}

/** Nothing left alive nearby: the rampaging one turns its fire on the land itself. */
function rampageIdle(e, s, sc) {
  const pick = () => {
    const f = dirFromAngles(e.getRotation().y + rand(-70, 70), 0), r = rand(40, 110) * Math.max(sc, 0.4);
    const x = e.location.x + f.x * r, z = e.location.z + f.z * r;
    return { x, y: (groundY(e.dimension, x, z, e.location.y + 40, 120) ?? e.location.y) + 1, z };
  };
  if (s.cd.roar <= 0) { startRoar(e, s, false); return; }
  if (s.cd.breath <= 0) { s.aimPoint = pick(); s.forced = true; startAbility(e, s, "breath"); return; }
  if (s.cd.dorsal <= 0) { s.forced = true; startAbility(e, s, "dorsal"); return; }
  if (s.cd.tail <= 0) { s.aimPoint = pick(); s.forced = true; startAbility(e, s, "tail"); }
}

// ------------------------------------------------------------------ the fight
// How the 4th form picks its moves (every few ticks, when it is not already doing something):
//   - a beam ready and the enemy too close for it: jump back to open the range, then fire
//   - a beam ready and the range right: fire
//   - beams spent: close in (a pounce if a rival giant is far off) and fight at arm's length:
//     the tail swept through anything behind or beside him, the bite for what is in front,
//     the stomp for what is underfoot
function decide(e, s, sc) {
  const rage = isRampage(e);
  const t = findTarget(e, s, sc);
  if (s.cd.growl <= 0) {
    s.cd.growl = (rage ? 260 : 420) + Math.floor(Math.random() * (rage ? 300 : 700));
    if (!t && s.cd.roar <= 0) { startRoar(e, s, false); return; }
    sound(e.dimension, "sg.growl", e.location, 128, 0.9, rand(0.85, 1.05));
  }
  if (!t) { if (rage) rampageIdle(e, s, sc); return; }
  const L = e.location;
  const d = dist(t.location, L);
  const hd = hdist(t.location, L);
  const rel = wrap180(yawTo(L, t.location) - e.getRotation().y);       // 0 = dead ahead
  const behind = Math.abs(rel) > 115;
  const big = rage || worthy(t);          // small animals just get walked over
  const rival = isRival(t);
  const away = norm({ x: L.x - t.location.x, y: 0, z: L.z - t.location.z });
  const canBreath = big && s.cd.breath <= 0 && (rage || s.energy >= 30 / S.stamina);
  const air = airborneTargets(e, sc, (en) => rage || worthy(en));

  if (s.cd.roar <= 0 && big) { startRoar(e, s, false); return; }
  if (air.length && s.cd.dorsal <= 0 && (rage || s.energy >= 25 / S.stamina)) { startAbility(e, s, "dorsal"); return; }

  if (canBreath) {
    // too close to bring the breath to bear: make room first
    const tooClose = hd < (rival ? 34 : 16) * sc + 5;
    if (tooClose && S.leap && s.cd.leap <= 0 && sc >= 0.2) {
      const want = clamp((rival ? 62 : 48) * sc - hd, 22 * sc, 60 * sc);
      if (startLeap(e, s, sc, len(away) > 0.1 ? away : dirFromAngles(e.getRotation().y + 180, 0), want, "breath")) return;
    }
    if (d > 10 * sc + 4 && d < 130 * sc + 10) { startAbility(e, s, "breath"); return; }
  }
  if (!big) {
    if (hd < 13 * sc + 3 && s.cd.stomp <= 0) startAbility(e, s, "stomp");
    return;
  }
  // at arm's length
  const q = toLocal(e, t.location, sc);
  if (melee(e, s, sc, t, hd, rel)) return;
  if (behind && d < 90 * sc + 10 && s.cd.tail <= 0 && (rage || s.energy >= 15 / S.stamina)) { startAbility(e, s, "tail"); return; }
  // a rival a long way off and nothing to throw at it: cross the ground in one bound
  if (rival && S.leap && s.cd.leap <= 0 && hd > 50 * sc + 8 && Math.abs(rel) < 50) {
    if (startLeap(e, s, sc, mul(away, -1), clamp(hd - 20 * sc, 20 * sc, 70 * sc), null)) return;
  }
  // out of breath but something is still standing off to the side: the tail ray will do
  if (rage && d > 20 * sc && s.cd.tail <= 0) startAbility(e, s, "tail");
}

/** At arm's length: the tail for what is behind or beside, the bite for what is in front, the stomp for what is underfoot. */
function melee(e, s, sc, t, hd, rel) {
  const A = anchorsOf(e);
  const q = toLocal(e, t.location, sc);
  const tailAng = Math.atan2(q[0] - A.tail_base[0], q[2] - A.tail_base[2]) / D2R;
  const inSweep = tailAng > A.sweep_arc[0] - 4 && tailAng < A.sweep_arc[1] + 4 && Math.abs(q[1]) < 16;
  if (s.cd.sweep <= 0 && inSweep && hd > 8 * sc && hd < (A.sweep_arc[2] - 6) * sc && Math.abs(rel) > 60) { startAbility(e, s, "sweep"); return true; }
  if (s.cd.bite <= 0 && hd < (isMinus(e) ? 19 : 22) * sc + 4 && Math.abs(rel) < 50) { startAbility(e, s, "bite"); return true; }
  if (s.cd.stomp <= 0 && hd < 13 * sc + 3) { startAbility(e, s, "stomp"); return true; }
  return false;
}

/** Godzilla Minus One and Minus Zero: the heat ray when it is ready and there is room for it, teeth and tail otherwise. */
function decideMinus(e, s, sc) {
  const zero = e.typeId === M0;
  const t = findTarget(e, s, sc);
  if (s.cd.growl <= 0) {
    s.cd.growl = (zero ? 300 : 420) + Math.floor(Math.random() * 600);
    if (!t && s.cd.roar <= 0) { startRoar(e, s, false); return; }
    sound(e.dimension, "sg.growl", e.location, 128, 0.9, rand(1.1, 1.3));
  }
  if (!t) return;
  const L = e.location;
  const d = dist(t.location, L);
  const hd = hdist(t.location, L);
  const rel = wrap180(yawTo(L, t.location) - e.getRotation().y);
  const big = worthy(t);
  const rival = isRival(t);
  const away = norm({ x: L.x - t.location.x, y: 0, z: L.z - t.location.z });
  if (s.cd.roar <= 0 && big) { startRoar(e, s, false); return; }
  const A = anchorsOf(e);
  const reach = (A.tail_reach - 5) * sc;
  const front = Math.abs(rel) < 55;
  const inJaws = front && hd < 20 * sc + 4 + bodyRadius(t);
  if (big && s.cd.heat <= 0) {
    // the heat ray levels everything around where it lands: he wants distance before he uses it,
    // and he makes it the hard way: the tail hurls his enemy clear, or the jaws take it and throw it
    if (hd < (rival ? 36 : 24) * sc + 5) {
      if (s.cd.whip <= 0 && hd > 7 * sc && hd < reach) { startAbility(e, s, "whip", { then: "heat" }); return; }
      if (s.cd.grab <= 0 && inJaws && liftable(t)) { startAbility(e, s, "grab", { then: "heat", far: true }); return; }
    }
    if (d > 12 * sc + 4 && d < 150 * sc + 10 && Math.abs(rel) < 100) { startAbility(e, s, "heat"); return; }
  }
  if (!big) {
    if (hd < 13 * sc + 3 && s.cd.stomp <= 0) startAbility(e, s, "stomp");
    return;
  }
  // at close quarters: the tail for what is behind or beside him (or out of arm's reach), the
  // jaws for what he can lift, the claws for everything else in front, the foot for what is under him
  if (s.cd.whip <= 0 && hd > 7 * sc && hd < reach && (!front || !inJaws)) { startAbility(e, s, "whip"); return; }
  if (inJaws) {
    if (s.cd.grab <= 0 && (liftable(t) ? Math.random() < 0.6 : Math.random() < 0.35)) { startAbility(e, s, "grab"); return; }
    if (s.cd.claw <= 0) { startAbility(e, s, "claw"); return; }
  }
  if (s.cd.stomp <= 0 && hd < 13 * sc + 3) { startAbility(e, s, "stomp"); return; }
  // too far to reach: he charges
  if (S.leap && sc >= 0.2 && s.cd.rush <= 0 && hd > Math.max(reach, 30 * sc + 8) && Math.abs(rel) < 40) startRush(e, s, sc, t, "claw");
}

// ------------------------------------------------------------------ the heat ray (Godzilla Minus One / Minus Zero)
// As in the film: the dorsal fins thrust out of his back one after another, from the tip of
// the tail to the nape, each with a crack and a flash; he rears and draws breath; the fins
// slam home and the beam goes out; and where it lands there is a second sun, a cloud that
// climbs for a minute, a wind that flattens everything, and then black rain.
function tickHeat(e, s, sc) {
  const a = s.act, dim = e.dimension, t = a.t, L = e.location;
  const A = anchorsOf(e);
  const k = Math.max(sc, 0.4);
  const zero = e.typeId === M0;
  const col = zero ? ICE : BLUE;
  const n = A.fins.length;
  if (t === 0) {
    setProp(e, "sg:state", "charge");
    s.baseYaw = s.yaw;
    s.pitch = 0;
    a.fins = 0;
    sound(dim, "sg.heat_charge", L, 256, 1, zero ? 0.9 : 1);
    warn(e, "§b☢ §3The dorsal fins are rising... §b☢");
    startFilm(e, s, sc);
  }
  if (t % 84 === 0 && t < HEAT.recover) sound(dim, "sg.rumble", L, 200, 0.9);
  const mouth = mouthPos(e, s, sc);

  // ---- charge: the fins come out, tail first
  if (t < HEAT.inhale) {
    const p = t / HEAT.inhale;
    const want = Math.min(n, (t + 1) / (HEAT.inhale - 6) * n);
    const before = Math.floor(a.fins);
    a.fins = want;
    setProp(e, "sg:fins", Math.round(want * 4) / 4);
    if (t === 2) setProp(e, "sg:glow", 1);
    for (let i = before; i < Math.floor(want); i++) {            // each fin as it locks out
      const at = toWorld(e, A.fins[i], sc, s.yaw);
      particle(dim, "sg:burst", at, sized(5 * sc + 1.5, col));
      particle(dim, "sg:blue_sparks", at, sized(1.2 * sc + 0.4));
      if (i % 2 === 0) sound(dim, "sg.fin", at, 160, 1, 0.8 + 0.5 * i / n);     // the pitch climbs his back with them
      light(dim, at, 16);
    }
    if (t % 4 === 0) arcs(e, sc, 1);
    if (t % 7 === 3 && t > 20) groundStrike(e, sc);
    if (t % 6 === 0) particle(dim, "sg:embers", L, sized(9 * sc + 2));
    if (t % 10 === 0) shake(dim, L, 70 * sc + 16, 0.12 + 0.4 * p, 0.6);
    aim(e, s, sc, mouth, false, 6);
    return;
  }
  setProp(e, "sg:fins", n);

  // ---- he draws breath
  if (t < HEAT.fire) {
    const p = (t - HEAT.inhale) / (HEAT.fire - HEAT.inhale);
    if (t === HEAT.inhale) {
      setProp(e, "sg:state", "focus");
      sound(dim, "sg.inhale", L, 256, 1);
      surgeAll(e, sc, 7 * sc + 2);
      warn(e, "§b☢ §fHe is drawing breath §b☢");
    }
    const im = toWorld(e, A.inhale_mouth, sc, s.yaw);
    if (t % 2 === 0) particle(dim, "sg:gather_blue", im, sized((9 - 4 * p) * sc + 1.5));
    if (t % 3 === 0) particle(dim, "sg:mouth_glow", im, sized((3 + 8 * p) * sc + 1, col));
    if (t % 3 === 0) arcs(e, sc, 2);
    if (t % 4 === 0) {
      // the air goes in with it: everything nearby is dragged toward him
      for (const en of victims(e, L, 46 * sc + 8)) knock(en, L, -0.7, 0.05);
    }
    if (t % 6 === 0) shake(dim, L, 80 * sc + 16, 0.5 + 0.6 * p, 0.5);
    aim(e, s, sc, mouth, false);
    return;
  }

  // ---- the beam
  if (t < HEAT.recover) {
    const ft = t - HEAT.fire;
    const d = aim(e, s, sc, mouth, false);
    if (ft === 0) {
      setProp(e, "sg:fins", 0);                       // the fins slam home
      setProp(e, "sg:state", "beam");
      sound(dim, "sg.heat_ray", mouth, 320, 1, zero ? 0.92 : 1);
      sound(dim, "sg.fin", L, 200, 1, 0.6);
      shake(dim, L, 110 * sc + 24, 1.4, 1.2);
      flashScreen(dim, L, 90 * sc + 24, [0.72, 0.9, 1.0], 0.05, 0.5);
      particle(dim, "sg:nuke_flash", mouth, sized(20 * sc + 4));
      particle(dim, "sg:shockwave", L);
      particle(dim, "sg:land_dust", L, sized(18 * sc + 4));
      for (let i = 0; i < n; i += 2) particle(dim, "sg:blue_sparks", toWorld(e, A.fins[i], sc, s.yaw), sized(1.5 * sc + 0.4));
      warn(e, "§b§l☢ HEAT RAY ☢");
    }
    const Wb = (1.9 * k + 0.3) * Math.sqrt(beamK());
    const maxLen = 170 * Math.max(sc, 0.35) * (0.7 + 0.3 * beamK());
    const r = castBeam(dim, mouth, d, maxLen);
    // it stops at the first thing big enough to stop it
    const first = firstAlongRay(e, mouth, d, r.l, Wb);
    if (first && first.along < r.l) { r.l = Math.max(4, first.along); r.hit = add(mouth, mul(d, r.l)); }
    const end = r.hit ?? add(mouth, mul(d, r.l));
    drawBeam(dim, mouth, d, r.l, Wb, t, col, true);
    if (ft === 5) nuke(e, end, sc);
    if (ft > 5) {
      impactFx(dim, end, t, Wb * 1.6 + 0.6, true);
      if (t % 4 === 0) explodeAt(e, end, (3.4 * Math.max(sc, 0.5) + 0.8) * Math.sqrt(beamK()), true);
    }
    if (t % 4 === 0) damageAlongRay(e, mouth, d, r.l, Wb + 0.4, 20, 6, 0.006);
    if (t % 8 === 0) shake(dim, L, 80 * sc + 16, 0.5, 0.6);
    if (t % 3 === 0) arcs(e, sc, 1);
    if (t % 3 === 0) light(dim, add(mouth, mul(d, Math.min(r.l * 0.5, 12 + (ft % 4) * 12))), 10);
    return;
  }

  // ---- afterwards he stands and smokes
  if (t < HEAT.end) {
    if (t === HEAT.recover) { setProp(e, "sg:glow", 0); setProp(e, "sg:state", "walk"); setProp(e, "sg:aim", 0); }
    if (t % 3 === 0) particle(dim, "sg:steam", toWorld(e, A.dorsal[Math.floor(Math.random() * A.dorsal.length)], sc));
    if (t % 4 === 0) particle(dim, "sg:steam", mouth);
    return;
  }
  s.cd.heat = cool(e, zero ? 520 : 700);
  endAbility(e, s);
}

// What the heat ray leaves where it lands.  Each blast runs for some seconds on its own:
// the flash and the wind at once, then the fireball climbing its stem, the cap spreading,
// the ring racing out across the ground, ash in the air, and black rain.
const nukes = [];
function nuke(e, at, sc) {
  const dim = e.dimension;
  const R = (46 * sc + 10) * Math.sqrt(beamK());
  nukes.push({ dim, at: { ...at }, t: 0, R, e, thrown: new Set() });
  sound(dim, "sg.nuke", at, 512, 1);
  particle(dim, "sg:nuke_flash", at, sized(R * 1.5));
  particle(dim, "sg:nuke_flash", add(at, { x: 0, y: R * 0.3, z: 0 }), sized(R));
  particle(dim, "sg:nuke_ring", at, sized(R * 2.6));
  flashScreen(dim, at, R * 4 + 40, [1, 1, 1], 0.3, 1.5);
  shake(dim, at, R * 5 + 40, 3.0, 2.6);
  light(dim, add(at, { x: 0, y: 6, z: 0 }), 60);
  for (const en of victims(e, at, R)) {
    const f = 1 - dist(en.location, at) / R;
    hurt(en, 200 * Math.pow(f, 1.3), e, 8, 0.3 * f);
    knock(en, at, 5 * f + 1.5, 0.8 + 0.8 * f);
  }
}
function tickNukes() {
  for (let i = nukes.length - 1; i >= 0; i--) {
    const nk = nukes[i];
    const t = ++nk.t, at = nk.at, R = nk.R, dim = nk.dim;
    if (t > 520) { nukes.splice(i, 1); continue; }
    const up = { x: 0, y: 1, z: 0 };
    // ground zero is carved out over the first second
    if (t <= 22 && t % 2 === 0 && canGrief()) {
      const a = Math.random() * 6.283, r = Math.random() * R * 0.5 * (t / 22);
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      const g = groundY(dim, x, z, at.y + 14, 40) ?? at.y;
      try { dim.createExplosion({ x, y: g, z }, Math.min(9, 5 + R * 0.06), { breaksBlocks: true, causesFire: true }); } catch { /* ignore */ }
    }
    // the fireball, the stem it climbs, and the cap that spreads over it
    const top = Math.min(R * 1.5, t * R * 0.03);
    if (t < 34) particle(dim, "sg:nuke_fire", add(at, { x: 0, y: 2 + t * 0.3, z: 0 }), wide(R * 0.3, up, 7));
    if (t >= 6 && t < 130 && t % 2 === 0) particle(dim, "sg:nuke_fire", add(at, { x: rand(-2, 2), y: top * rand(0.15, 1), z: rand(-2, 2) }), wide(R * (t < 60 ? 0.17 : 0.12), up, 5));
    if (t >= 26 && t < 170 && t % 3 === 0) {
      for (let j = 0; j < share(2); j++) {
        const a = Math.random() * 6.283;
        particle(dim, "sg:nuke_cap", add(at, { x: Math.cos(a) * R * 0.15, y: top, z: Math.sin(a) * R * 0.15 }), wide(R * 0.32, { x: Math.cos(a), y: 0, z: Math.sin(a) }, R * 0.1));
      }
    }
    if (t >= 30 && t < 200 && t % 8 === 0) particle(dim, "sg:flood_smoke", add(at, { x: rand(-R, R) * 0.3, y: 2, z: rand(-R, R) * 0.3 }), wide(R * 0.2));
    // the front racing out: a wall of dust, and anyone it reaches is thrown
    if (t <= 30) {
      const fr = (t / 30) * R * 2.4;
      if (t % 2 === 0) {
        for (let j = 0; j < 7; j++) {
          const a = (j / 7) * 6.283 + t;
          const x = at.x + Math.cos(a) * fr, z = at.z + Math.sin(a) * fr;
          particle(dim, "sg:land_dust", { x, y: groundY(dim, x, z, at.y + 20, 60) ?? at.y, z }, sized(R * 0.22 + 3));
        }
      }
      let ents = [];
      try { ents = dim.getEntities({ location: at, maxDistance: fr + 4 }); } catch { /* ignore */ }
      for (const en of ents) {
        if (nk.thrown.has(en.id) || KAIJU.has(en.typeId) || !isLiving(en)) continue;
        if (dist(en.location, at) < R) { nk.thrown.add(en.id); continue; }     // already thrown by the blast itself
        nk.thrown.add(en.id);
        knock(en, at, 2.6, 0.5);
      }
    }
    // things keep catching fire around it for a while
    if (t < 90 && t % 5 === 0) {
      const a = Math.random() * 6.283, r = rand(0.3, 1.1) * R;
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      const g = groundY(dim, x, z, at.y + 20, 60);
      if (g !== undefined) { particle(dim, "sg:impact_fire", { x, y: g, z }, sized(R * 0.08 + 1.5)); igniteFor(dim, x, g, z); }
    }
    // black rain
    if (t >= 70 && t % 20 === 0) {
      for (const p of playersNear(dim, at, R * 3 + 30)) particle(dim, "sg:black_rain", p.location);
    }
  }
}
function igniteFor(dim, x, y, z) {
  if (!canGrief()) return;
  try {
    const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
    if (b && b.isAir) b.setType("minecraft:fire");
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ per-tick update
function tickKaiju(e) {
  const s = st(e);
  const sc = scaleOf(e);
  const dim = e.dimension;
  const state = getProp(e, "sg:state");
  clearOldTag(e, s);
  if (isRampage(e)) s.energy = 100;
  if (system.currentTick % 100 === 7) applySpeed(e);

  if (state === "frozen") {
    if (system.currentTick % 40 === 0) particle(dim, "sg:frost", toWorld(e, [rand(-5, 5), rand(2, 40), rand(-4, 8)], sc));
    return;
  }
  if (state === "dying") {
    if (s.dyingT <= 0) s.dyingT = 80;
    s.dyingT--;
    if (s.dyingT % 6 === 0) particle(dim, "sg:steam", toWorld(e, [rand(-5, 5), rand(4, 30), rand(-5, 8)], sc));
    if (isMinus(e) && s.dyingT % 3 === 0) {
      // shafts of blue light break out through the hide
      const o = toWorld(e, [rand(-4, 4), rand(8, 30), rand(-5, 6)], sc);
      const d = norm({ x: rand(-1, 1), y: rand(-0.2, 1), z: rand(-1, 1) });
      drawRay(dim, o, d, rand(18, 44) * sc, 0.5 * sc + 0.15, s.dyingT, ICE);
      particle(dim, "sg:blue_sparks", o, sized(1.2 * sc + 0.4));
    }
    if (s.dyingT === 1) finishDying(e);
    return;
  }
  if (state === "evolving") { tickEvolve(e, s, sc); return; }

  if (state === "dormant") {
    s.dormantT--;
    if (system.currentTick % 100 === 0) e.setDynamicProperty("sg:dormant", s.dormantT);
    if (system.currentTick % 8 === 0) particle(dim, "sg:steam", toWorld(e, A4.dorsal[Math.floor(Math.random() * A4.dorsal.length)], sc));
    if (system.currentTick % 140 === 0) sound(dim, "sg.dormant", e.location, 64, 0.8, rand(0.9, 1.05));
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
    if (s.act.t < 0) s.act.t = 0;        // chained straight from a landing
    switch (s.act.name) {
      case "breath": tickBreath(e, s, sc); break;
      case "dorsal": tickDorsal(e, s, sc); break;
      case "tail": tickTail(e, s, sc); break;
      case "leap": tickLeap(e, s, sc); break;
      case "bite": tickBite(e, s, sc); break;
      case "sweep": tickSweep(e, s, sc); break;
      case "stomp": tickStomp(e, s, sc); break;
      case "heat": tickHeat(e, s, sc); break;
      case "claw": tickClaw(e, s, sc); break;
      case "grab": tickGrab(e, s, sc); break;
      case "whip": tickWhip(e, s, sc); break;
      case "rush": tickRush(e, s, sc); break;
      default: endAbility(e, s);
    }
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
  const stride = (is4(e) ? 9 : isMinus(e) ? 6.5 : e.typeId === F3 ? 5 : 4) * sc;
  if (s.walked >= stride) {
    s.walked = 0;
    s.foot = 1 - s.foot;
    const side = s.foot ? 1 : -1;
    const fp = toWorld(e, e.typeId === F2 ? [side * 7.5, 0, 5] : [side * (isMinus(e) ? 5.3 : 5.9), 0, -1], sc);
    sound(dim, "sg.step", fp, (isBig(e) ? 160 : e.typeId === F3 ? 96 : 64) * Math.max(sc, 0.4), 1, rand(0.9, 1.1) / Math.sqrt(Math.max(sc, 0.25)));
    particle(dim, "sg:dust", fp);
    if (isBig(e)) particle(dim, "sg:land_dust", fp, sized(5 * sc + 1.5));
    shake(dim, fp, (isBig(e) ? 56 : 30) * sc + 10, (isBig(e) ? 0.45 : 0.15), 0.35);
    if (e.typeId !== F2) crater(dim, { x: fp.x, y: fp.y - 1, z: fp.z }, Math.max(1, Math.round((isBig(e) ? 3 : 2) * sc)));
    if (S.mode !== "peaceful" || isRampage(e)) trample(e, fp, sc);
  }

  // bulldoze through anything in the way
  if (s.cd.bull <= 0 && (moved > 0.02 || validTarget(s))) {
    s.cd.bull = 4;
    s.bullStep = ((s.bullStep ?? 0) + 1) % 3;
    if (is4(e)) bulldoze(e, sc, 6 + s.bullStep, 7, 1, 40);
    else if (isMinus(e)) bulldoze(e, sc, 5 + s.bullStep, 6.5, 1, 34);
    else if (e.typeId === F3) bulldoze(e, sc, 4 + s.bullStep, 5, 1, 22);
    else bulldoze(e, sc, 13 + s.bullStep, 5, 0, 9);
  }

  // Godzilla Minus One heals: left alone for a few seconds, the wounds close
  if (isMinus(e) && system.currentTick % 20 === 3 && system.currentTick - s.lastHurt > 100) {
    try {
      const h = e.getComponent("minecraft:health");
      if (h.currentValue < h.effectiveMax) {
        h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + h.effectiveMax * (e.typeId === M0 ? 0.007 : 0.004)));
        const pts = anchorsOf(e).dorsal;
        particle(dim, "sg:steam", toWorld(e, pts[Math.floor(Math.random() * pts.length)], sc));
      }
    } catch { /* ignore */ }
  }

  // forms 2/3: gills, ageing and evolution
  if (!isBig(e)) {
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
      for (const side of ["gill_L", "gill_R"]) {
        const out = norm(sub(toWorld(e, [side === "gill_L" ? 1 : -1, -0.3, 0], 1), e.location));
        particle(dim, "sg:blood_spray", toWorld(e, g[side], sc), dirVars(out, {}));
      }
    }
    if (s.cd.roar <= 0 && validTarget(s)) startRoar(e, s, false);
    if (s.cd.growl <= 0) {
      s.cd.growl = 400 + Math.floor(Math.random() * 600);
      sound(dim, e.typeId === F2 ? "sg.roar2" : "sg.roar3", e.location, 128, 0.8, rand(0.9, 1.1));
    }
    return;
  }

  // the 4th form thinks every few ticks, and never in the middle of a roar
  if (system.currentTick % 5 !== 0 || s.roarT > 0) return;
  if (isMinus(e)) decideMinus(e, s, sc); else decide(e, s, sc);
}

// ------------------------------------------------------------------ HUD
// The boss bar carries the name and health (drawn in our own frame by the resource pack); a
// line above the hotbar adds exact health, atomic energy and what the kaiju is doing right now.
/** Banner line for everyone near a kaiju (shown in the HUD for a moment). */
function warn(e, text, range = 128) {
  const s = st(e);
  s.banner = text;
  s.bannerT = system.currentTick + 50;
  if (S.hud) return;   // the HUD will carry it
  for (const p of playersNear(e.dimension, e.location, range)) {
    try { p.onScreenDisplay.setActionBar(text); } catch { /* ignore */ }
  }
}
const STATE_LABEL = {
  walk: "§7ON THE MOVE", roar: "§6ROARING", charge: "§dPLATES GLOWING", smoke: "§8SMOKE", fire: "§6FIRE", focus: "§dFOCUSING",
  beam: "§d§lATOMIC BREATH", dorsal: "§d§lDORSAL RAYS", tail: "§d§lTAIL RAY", leap: "§fLEAPING", land: "§fIMPACT", bite: "§cBITE",
  sweep: "§cTAIL SWEEP", waking: "§cAWAKENING", frozen: "§b§lFROZEN", dying: "§7FALLING", evolving: "§e§lEVOLVING", dormant: "§bDORMANT",
};
const STATE_LABEL_MINUS = {
  charge: "§bFINS RISING", focus: "§fDRAWING BREATH", beam: "§b§lHEAT RAY",
  leap: "§c§lCHARGING", land: "§fSTOMP", bite: "§c§lCLAWS", dorsal: "§c§lJAWS", sweep: "§c§lTAIL WHIP",
};
const HUD_NAME = {
  [F2]: "§6§lSHIN GODZILLA §r§72nd Form", [F3]: "§c§lSHIN GODZILLA §r§73rd Form", [F4]: "§5§lSHIN GODZILLA", [F4R]: "§4§lSHIN GODZILLA §c§lRAMPAGE",
  [M1]: "§3§lGODZILLA §b§lMINUS ONE", [M0]: "§9§lGODZILLA §b§lMINUS ZERO",
};

function meter(frac, on, off, n) {
  const k = Math.round(clamp(frac, 0, 1) * n);
  return on + "|".repeat(k) + off + "|".repeat(n - k);
}
function clearOldTag(e, s) {
  if (s.tagCleared) return;      // 1.1 wrote a title into the name tag, which hid the bar's name
  s.tagCleared = true;
  try { if (e.nameTag) e.nameTag = ""; } catch { /* ignore */ }
}
/** What he is doing, for the HUD and the fog (the fire of the breath is a phase of the "smoke" state). */
function phaseOf(e) {
  const state = getProp(e, "sg:state") ?? "walk";
  return state === "smoke" && K.get(e.id)?.act?.phase === "fire" ? "fire" : state;
}
function hudText(e) {
  const s = st(e);
  const state = phaseOf(e);
  let hp = 0, max = 1;
  try { const h = e.getComponent("minecraft:health"); hp = Math.max(0, Math.ceil(h.currentValue)); max = Math.ceil(h.effectiveMax); } catch { /* ignore */ }
  let l1 = `${HUD_NAME[e.typeId]} §r§8- ${(isMinus(e) ? STATE_LABEL_MINUS[state] : undefined) ?? STATE_LABEL[state] ?? ""}`;
  if (state === "dormant") {
    const sec = Math.max(0, Math.ceil(s.dormantT / 20));
    l1 += ` §7${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} §8- §bCoagulant ${s.doses}/${DOSES_NEEDED}`;
  }
  let l2 = `§cHP §f${hp}§7/${max} ${meter(hp / max, "§4", "§8", 30)}`;
  if (isMinus(e)) l2 += s.cd.heat <= 0 || s.act?.name === "heat" ? "  §bHEAT RAY §fREADY" : `  §bHEAT RAY §7${Math.ceil(s.cd.heat / 20)}s`;
  else if (isRampage(e)) l2 += "  §dENERGY §5UNLIMITED";
  else if (is4(e)) l2 += `  §dENERGY ${meter(s.energy / 100, "§5", "§8", 16)}`;
  else {
    const th = evoThreshold(e);
    if (th !== Infinity) l2 += `  §eEVOLUTION ${meter(s.age / th, "§6", "§8", 16)}`;
  }
  const banner = s.banner && system.currentTick < s.bannerT ? "\n" + s.banner : "";
  return l1 + "§r\n" + l2 + banner;
}
function nearestKaiju(p, range = 200, skipFarStatues = false) {
  let best, bd = range;
  for (const e of tracked) {
    try {
      if (!e.isValid || e.dimension.id !== p.dimension.id) continue;
      const d = dist(e.location, p.location);
      if (skipFarStatues && getProp(e, "sg:state") === "frozen" && d > 40) continue;   // a statue doesn't need a HUD from afar
      if (d < bd) { bd = d; best = e; }
    } catch { /* ignore */ }
  }
  return best;
}
function tickHud() {
  for (const p of players()) {
    if (filming.has(p.id)) continue;
    // the air: ember dusk under the fire, violet night under the beam
    let fog;
    if (S.fog) {
      for (const e of tracked) {
        try {
          if (!e.isValid || e.dimension.id !== p.dimension.id || dist(e.location, p.location) > 170) continue;
          const state = phaseOf(e);
          if (isMinus(e)) { if (state === "charge" || state === "focus" || state === "beam") { fog = "sg:heat_fog"; break; } continue; }
          if (state === "focus" || state === "beam" || state === "dorsal" || state === "tail") { fog = "sg:atomic_fog"; break; }
          if (state === "fire") fog = "sg:fire_fog";
        } catch { /* ignore */ }
      }
    }
    if (S.fog && !fog) {
      // ash hangs in the air where a heat ray has landed
      for (const nk of nukes) if (nk.t > 16 && nk.t < 440 && nk.dim.id === p.dimension.id && dist(nk.at, p.location) < nk.R * 3 + 30) { fog = "sg:ash_fog"; break; }
    }
    setFog(p, fog);
    if (!S.hud) continue;
    const best = nearestKaiju(p, 150, true);
    if (best) { try { p.onScreenDisplay.setActionBar(hudText(best)); } catch { /* ignore */ } }
  }
}

// ------------------------------------------------------------------ the cinematic camera
// On the atomic breath (the first one of each kaiju, or every one: the config wheel), players
// nearby are shown it as the film would cut it: low under the glowing plates, then a long side
// view as the smoke comes down, then high and wide as the fire floods out.  They get their own
// eyes back before the beam fires.
const FILM_FLAG = "sg:film";
const FILM_HUD = [HudElement.PaperDoll, HudElement.Armor, HudElement.ToolTips, HudElement.Crosshair, HudElement.Hotbar, HudElement.Health,
  HudElement.ProgressBar, HudElement.Hunger, HudElement.AirBubbles, HudElement.HorseHealth, HudElement.StatusEffects, HudElement.ItemText];
const filming = new Map();     // player id -> film
const films = [];

/** Shots: [from tick, to tick, angle off his facing at start and end, distance, height, what to look at]. */
function filmShots(e, sc) {
  if (isMinus(e)) {
    const k = sc * heightOf(e) / (sc * 38.7 || 1);
    return [
      // down the length of him as the fins come out, then under his jaw as he draws breath
      { from: 0, to: HEAT.inhale - 4, ang: [206, 158], dist: [50 * k, 38 * k], h: [7 * k + 2, 16 * k], look: "fins" },
      { from: HEAT.inhale - 4, to: HEAT.fire - 2, ang: [24, 8], dist: [44 * k, 38 * k], h: [8 * k, 6 * k + 2], look: "inhale" },
    ];
  }
  return [
    { from: 0, to: BREATH.smoke - 2, ang: [150, 172], dist: [58 * sc, 46 * sc], h: [5 * sc + 2, 9 * sc + 2], look: "back" },
    { from: BREATH.smoke - 2, to: BREATH.fire - 4, ang: [78, 64], dist: [78 * sc, 70 * sc], h: [16 * sc, 20 * sc], look: "mouth" },
    { from: BREATH.fire - 4, to: BREATH.fire + 46, ang: [-38, -22], dist: [100 * sc, 112 * sc], h: [52 * sc, 62 * sc], look: "pour" },
  ];
}
function startFilm(e, s, sc) {
  if (S.camera === "off" || sc < 0.4) return;
  if (S.camera === "first" && e.getDynamicProperty("sg:filmed")) return;
  e.setDynamicProperty("sg:filmed", true);
  const cast = [];
  for (const p of playersNear(e.dimension, e.location, 130 * sc + 20)) {
    if (filming.has(p.id) || isSpectator(p)) continue;
    cast.push(p);
  }
  if (!cast.length) return;
  const f = { e, s, sc, cast, shots: filmShots(e, sc), shot: -1, done: false, act: s.act.name };
  films.push(f);
  for (const p of cast) {
    filming.set(p.id, f);
    try { p.setDynamicProperty(FILM_FLAG, true); } catch { /* ignore */ }
    try { p.onScreenDisplay.setHudVisibility(HudVisibility.Hide, FILM_HUD); } catch { /* ignore */ }
  }
}
function releaseCamera(p) {
  try { p.camera.clear(); } catch { /* ignore */ }
  try { p.onScreenDisplay.setHudVisibility(HudVisibility.Reset, FILM_HUD); } catch { /* ignore */ }
  try { p.setDynamicProperty(FILM_FLAG, undefined); } catch { /* ignore */ }
  filming.delete(p.id);
}
function endFilm(f) {
  if (f.done) return;
  f.done = true;
  for (const p of f.cast) releaseCamera(p);
}
function tickFilms() {
  for (let i = films.length - 1; i >= 0; i--) {
    const f = films[i];
    let alive = false;
    try { alive = f.e.isValid && f.s.act && f.s.act.name === f.act; } catch { alive = false; }
    const t = alive ? f.s.act.t : Infinity;
    const idx = f.shots.findIndex((sh) => t >= sh.from && t < sh.to);
    if (f.done || !alive || idx < 0) { endFilm(f); films.splice(i, 1); continue; }
    const sh = f.shots[idx];
    const cut = idx !== f.shot;
    f.shot = idx;
    if (!cut && system.currentTick % 2 !== 0) continue;
    const e = f.e, sc = f.sc, s = f.s;
    const k = smooth(clamp((t - sh.from) / (sh.to - sh.from), 0, 1));
    const yaw = s.yaw + lerp(sh.ang[0], sh.ang[1], k);
    const out = dirFromAngles(yaw, 0), d = lerp(sh.dist[0], sh.dist[1], k);
    let look;
    if (sh.look === "mouth") look = mouthPos(e, s, sc);
    else if (sh.look === "inhale") look = toWorld(e, anchorsOf(e).inhale_mouth, sc, s.yaw);
    else if (sh.look === "fins") { const F = anchorsOf(e).fins; look = toWorld(e, F[clamp(Math.floor(s.act.fins ?? 0), 0, F.length - 1)], sc, s.yaw); }
    else if (sh.look === "pour") look = s.act.pour ? add(s.act.pour.at, { x: 0, y: 8 * sc, z: 0 }) : toWorld(e, [0, 20, -30], sc, s.yaw);
    else look = toWorld(e, [0, 36, 4], sc, s.yaw);
    let at = { x: e.location.x + out.x * d, y: e.location.y + lerp(sh.h[0], sh.h[1], k), z: e.location.z + out.z * d };
    // keep the camera out of the ground
    const g = groundY(e.dimension, at.x, at.z, at.y + 40, 80);
    if (g !== undefined && at.y < g + 2.5) at = { x: at.x, y: g + 2.5, z: at.z };
    for (const p of f.cast) {
      try {
        if (!p.isValid || p.dimension.id !== e.dimension.id) continue;
        if (cut) {
          if (idx > 0) p.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0, holdTime: 0.05, fadeOutTime: 0.25 } });
          p.camera.setCamera("minecraft:free", { location: at, facingLocation: look });
        } else {
          p.camera.setCamera("minecraft:free", { location: at, facingLocation: look, easeOptions: { easeTime: 0.15, easeType: EasingType.Linear } });
        }
      } catch { /* ignore */ }
    }
  }
}

// ------------------------------------------------------------------ events
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity;
  if (!e || !KAIJU.has(e.typeId)) return;
  const src = ev.damageSource.damagingEntity;
  const s = st(e);
  s.lastHurt = system.currentTick;
  if (src && !kin(e, src) && (S.mode !== "peaceful" || isRampage(e))) {
    s.target = src;
    s.targetT = 1200;
  }
  if (src && src.typeId === "minecraft:player" && Math.random() < 0.07) {
    try { e.dimension.spawnItem(new ItemStack("sg:g_cell", 1), add(src.location, { x: 0, y: 1, z: 0 })); } catch { /* ignore */ }
  }
  if (ev.damage >= 20 && is4(e)) s.cd.breath = Math.min(s.cd.breath, 40); // bunker busters provoke the breath
  if (ev.damage >= 20 && isMinus(e)) s.cd.heat = Math.min(s.cd.heat, 80);
}, { entityTypes: ALL_TYPES });

world.afterEvents.entityHealthChanged.subscribe((ev) => {
  const e = ev.entity;
  if (!KAIJU.has(e.typeId) || ev.newValue >= ev.oldValue) return;
  let max = 1;
  try { max = e.getComponent("minecraft:health").effectiveMax; } catch { /* ignore */ }
  const state = getProp(e, "sg:state");
  if (ev.newValue > 0 && ev.newValue <= max * 0.04 && state !== "dying" && state !== "frozen") startDying(e, st(e));
}, { entityTypes: ALL_TYPES });

world.afterEvents.dataDrivenEntityTrigger.subscribe((ev) => {
  const e = ev.entity;
  if (ev.eventId !== "sg:coagulant_hit") return;
  const s = st(e);
  s.doses++;
  e.setDynamicProperty("sg:doses", s.doses);
  const sc = scaleOf(e);
  for (let i = 0; i < 3; i++) particle(e.dimension, "sg:coagulant", toWorld(e, [rand(-3, 3), rand(30, 44), rand(-10, -2)], sc));
  sound(e.dimension, "sg.coagulant", e.location, 48, 1);
  warn(e, `§bYashiori Coagulant injected: ${s.doses}/${DOSES_NEEDED}`, 96);
  if (s.doses >= DOSES_NEEDED) freeze(e, s);
}, { entityTypes: [F4], eventTypes: ["sg:coagulant_hit"] });

world.afterEvents.itemUse.subscribe((ev) => {
  const id = ev.itemStack?.typeId;
  if (id === "sg:kaiju_tablet") system.run(() => openTablet(ev.source));
  else if (id === "sg:config_wheel") system.run(() => openWheel(ev.source));
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  const p = ev.player;
  forgetFog(p);
  try { if (p.getDynamicProperty(FILM_FLAG)) releaseCamera(p); } catch { /* ignore */ }
  if (!ev.initialSpawn) return;
  // the tablet and the wheel, once, so nothing has to be crafted to get started
  try {
    if (p.getDynamicProperty("sg:kit")) return;
    p.setDynamicProperty("sg:kit", true);
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    inv.addItem(new ItemStack("sg:kaiju_tablet", 1));
    inv.addItem(new ItemStack("sg:config_wheel", 1));
    p.sendMessage("§5[Kaijus Srelz Pack]§r §7A §fKaiju Control Tablet§7 (world rules, summoning) and a §fConfig Wheel§7 (his strength, cinematics) are in your inventory.");
  } catch { /* ignore */ }
});

// ------------------------------------------------------------------ menus
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
    .button("§5Config Wheel (his strength, cinematics)...")
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
    case 8: return openWheel(p);
    case 9: return removeMenu(p);
  }
  system.run(() => openTablet(p));
}

function powerLine() {
  return `§7Health §fx${HP_TIERS[S.hp]}§7 · Damage §fx${S.dmg}§7 · Attack rate §fx${S.rate}§7 · Speed §f${S.speed}§7\nBeam §fx${S.beam}§7 · Stamina §fx${S.stamina}§7 · Leaps §f${S.leap ? "on" : "off"}`;
}
function currentPreset() {
  for (const [key, v] of Object.entries(PRESETS)) {
    if (v.hp === S.hp && v.dmg === S.dmg && v.rate === S.rate && v.speed === S.speed && v.beam === S.beam && v.stamina === S.stamina) return key;
  }
  return undefined;
}
function applyPower(v) {
  for (const k of ["hp", "dmg", "rate", "speed", "beam", "stamina"]) if (v[k] !== undefined) setSetting(k, v[k]);
  for (const e of tracked) {
    try {
      if (!e.isValid) continue;
      if (e.getDynamicProperty("sg:hp") !== S.hp) applyHp(e);
      applySpeed(e);
    } catch { /* ignore */ }
  }
}

/** The Config Wheel: how strong Shin Godzilla is, and how his attacks are staged. */
async function openWheel(p) {
  const cur = currentPreset();
  const f = new ActionFormData().title("Kaiju Config Wheel").body(`§dPower: §f${cur ? PRESETS[cur].label : "Custom"}\n${powerLine()}`);
  const keys = Object.keys(PRESETS);
  for (const key of keys) {
    const v = PRESETS[key];
    f.button(`${key === cur ? "§5§l> " : ""}${v.label}§r\n§8HP x${HP_TIERS[v.hp]}  damage x${v.dmg}  rate x${v.rate}`);
  }
  f.button("§dFine-tune his strength...").button("§dCinematics and effects...").button("World rules (the tablet)...");
  const r = await show(f, p);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection < keys.length) {
    applyPower(PRESETS[keys[r.selection]]);
    p.sendMessage(`§5[Kaijus Srelz Pack]§r §7Power set to §f${PRESETS[keys[r.selection]].label}§7.`);
    system.run(() => openWheel(p));
    return;
  }
  if (r.selection === keys.length) return tuneMenu(p);
  if (r.selection === keys.length + 1) return cinemaMenu(p);
  return openTablet(p);
}

async function tuneMenu(p) {
  const f = new ModalFormData().title("Fine-tune the kaiju")
    .dropdown("Health", HP_KEYS.map((k) => "x" + HP_TIERS[k]), { defaultValueIndex: Math.max(0, HP_KEYS.indexOf(S.hp)) })
    .slider("Damage (x)", 0.25, 5, { valueStep: 0.25, defaultValue: S.dmg })
    .slider("Attack rate (x): how often he uses his moves", 0.5, 3, { valueStep: 0.25, defaultValue: S.rate })
    .dropdown("Walking speed", ["Slow", "Normal", "Fast", "Very fast"], { defaultValueIndex: Math.max(0, SPEEDS.indexOf(S.speed)) })
    .slider("Beam power (x): thickness, reach and blast", 0.5, 2.5, { valueStep: 0.25, defaultValue: S.beam })
    .slider("Stamina (x): how much he can do before going dormant", 0.5, 5, { valueStep: 0.5, defaultValue: S.stamina })
    .toggle("Leaps: jumps back to make room for the breath, pounces on rivals", { defaultValue: S.leap })
    .submitButton("Apply");
  const r = await show(f, p);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  applyPower({ hp: HP_KEYS[Number(v[0])] ?? "1", dmg: Number(v[1]), rate: Number(v[2]), speed: SPEEDS[Number(v[3])] ?? "normal", beam: Number(v[4]), stamina: Number(v[5]) });
  setSetting("leap", v[6] === true);
  p.sendMessage("§5[Kaijus Srelz Pack]§r §7" + powerLine().replace("\n", " · "));
  system.run(() => openWheel(p));
}

async function cinemaMenu(p) {
  const CAM = ["off", "first", "always"], FX = ["low", "normal", "high"];
  const f = new ModalFormData().title("Cinematics and effects")
    .dropdown("Cinematic camera on the atomic breath", ["Off", "The first breath of each kaiju", "Every breath"], { defaultValueIndex: Math.max(0, CAM.indexOf(S.camera)) })
    .toggle("The air darkens while he fires (fog)", { defaultValue: S.fog })
    .toggle("Screen shake and flashes", { defaultValue: S.shake })
    .dropdown("Particle density (lower it on a slow phone)", ["Low", "Normal", "High"], { defaultValueIndex: Math.max(0, FX.indexOf(S.fx)) })
    .toggle("Kaiju HUD above the hotbar", { defaultValue: S.hud })
    .submitButton("Apply");
  const r = await show(f, p);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  setSetting("camera", CAM[Number(v[0])] ?? "first");
  setSetting("fog", v[1] === true);
  setSetting("shake", v[2] === true);
  setSetting("fx", FX[Number(v[3])] ?? "normal");
  setSetting("hud", v[4] === true);
  if (S.camera === "off") for (const fl of films) endFilm(fl);
  system.run(() => openWheel(p));
}

async function summonMenu(p) {
  const f = new ActionFormData().title("Summon a kaiju").body("It will appear about 40 blocks in front of you.")
    .button("§3Godzilla Minus One§r\n§8the heat ray").button("§9Godzilla Minus Zero§r\n§8larger, faster to fire, heals quicker")
    .button("Shin Godzilla - 4th Form").button("§4Shin Godzilla - RAMPAGE§r\n§8never tires, never sleeps")
    .button("Shin Godzilla - 3rd Form (Shinagawa-kun)").button("Shin Godzilla - 2nd Form (Kamata-kun)");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  const id = [M1, M0, F4, F4R, F3, F2][r.selection ?? 0];
  const big_ = id === F4 || id === F4R || id === M1 || id === M0;
  const v = p.getViewDirection();
  const h = norm({ x: v.x, y: 0, z: v.z });
  const dd = (big_ ? 44 : 26) * SIZE_SCALE[S.size] + 8;
  let loc = add(p.location, mul(h, dd));
  try {
    const top = p.dimension.getTopmostBlock({ x: loc.x, z: loc.z });
    if (top) loc = { x: loc.x, y: top.location.y + 1, z: loc.z };
  } catch { /* ignore */ }
  try {
    const e = p.dimension.spawnEntity(id, loc);
    e.teleport(loc, { rotation: { x: 0, y: yawTo(loc, p.location) } });
  } catch (err) { p.sendMessage("§cCould not summon here: " + err); }
}

async function commandMenu(p) {
  const k = nearestKaiju(p);
  if (!k) { p.sendMessage("§7No kaiju within 200 blocks."); return; }
  const s = st(k);
  const sc = scaleOf(k);
  const state = getProp(k, "sg:state");
  const big = is4(k), minus_ = isMinus(k);
  /** @type {{label: string, run: () => void}[]} */
  const opts = [];
  const opt = (label, run) => opts.push({ label, run });
  opt("Roar", () => startRoar(k, s, false));
  if (big && !s.act && (state === "walk" || state === "roar")) {
    opt("Atomic breath where I'm looking", () => { aimAt(p, s); s.forced = true; startAbility(k, s, "breath"); });
    opt("Dorsal plate rays", () => { s.forced = true; startAbility(k, s, "dorsal"); });
    opt("Tail ray where I'm looking", () => { aimAt(p, s); s.forced = true; startAbility(k, s, "tail"); });
    opt("Leap back", () => { startLeap(k, s, sc, dirFromAngles(k.getRotation().y + 180, 0), 45 * sc, null); });
    opt("Bite", () => startAbility(k, s, "bite"));
    opt("Tail sweep", () => startAbility(k, s, "sweep"));
    opt("Stomp", () => startAbility(k, s, "stomp"));
    if (!isRampage(k)) opt("Force dormancy (cool down)", () => goDormant(k, s));
  }
  if (minus_ && !s.act && (state === "walk" || state === "roar")) {
    opt("Heat ray where I'm looking", () => { aimAt(p, s); s.forced = true; startAbility(k, s, "heat"); });
    opt("Claws", () => startAbility(k, s, "claw"));
    opt("Jaws: seize and throw", () => startAbility(k, s, "grab"));
    opt("Tail whip (full turn)", () => startAbility(k, s, "whip"));
    opt("Charge at me", () => { s.target = p; s.targetT = 200; if (!startRush(k, s, sc, p, "claw")) p.sendMessage("§7Too close to charge."); });
    opt("Stomp", () => startAbility(k, s, "stomp"));
  }
  if (big && state === "dormant") opt("Wake it up", () => { s.dormantT = 1; });
  if (big && state === "frozen") opt("Thaw it (undo the Yashiori Strategy)", () => thaw(k, s));
  if (!big && !minus_ && state !== "evolving") opt("Force evolution now", () => beginEvolve(k, s));
  const f = new ActionFormData().title("Command " + NAMES[k.typeId]).body(`State: ${state}`);
  for (const o of opts) f.button(o.label);
  const r = await show(f, p);
  if (!r || r.canceled || r.selection === undefined) return;
  try { if (k.isValid) opts[r.selection].run(); } catch { /* ignore */ }
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
  loadStrayLights();
  refreshTracked();
  for (const p of players()) {
    forgetFog(p);
    try { if (p.getDynamicProperty(FILM_FLAG)) releaseCamera(p); } catch { /* ignore */ }
  }
  system.runInterval(() => {
    budget.blocks = 700;
    players();
    if (system.currentTick % 20 === 0) refreshTracked();
    tickLights();
    for (const e of tracked) {
      try {
        if (e.isValid) tickKaiju(e);
      } catch (err) {
        if (system.currentTick % 200 === 0) console.warn("[sg] " + err);
      }
    }
    try { tickThrown(); } catch { thrown.length = 0; }
    try { tickNukes(); } catch (err) { nukes.length = 0; if (system.currentTick % 200 === 0) console.warn("[sg] blast: " + err); }
    try { tickFilms(); } catch (err) { for (const f of films) endFilm(f); films.length = 0; if (system.currentTick % 200 === 0) console.warn("[sg] film: " + err); }
    if (system.currentTick % 10 === 0) tickHud();
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
void DEFAULTS; void bolt; void WHITE; void A4;
