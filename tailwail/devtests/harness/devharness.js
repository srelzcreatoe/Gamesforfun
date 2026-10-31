// Dev-only BDS runtime harness (never shipped).  Assembled into a test copy of the
// behavior pack by tools/bds_scenarios.py.  Drives the REAL encounter, presence, grab and
// effects code with a scripted stand-in player, because a dedicated server has no real
// players.  The stand-in records every player-only call (camera, fog, music, input
// permissions, titles, sounds, teleports) so cleanup can be verified.
import { BlockPermutation, BlockVolume, EntityDamageCause, GameMode, ItemStack, system, world } from "@minecraft/server";
import { director } from "./main.js";
import { creatureSees, playerView, takeRayCount } from "./mc/perception.js";
import { spawnSearch } from "./mc/spots.js";
import { onStrugglePressed } from "./mc/grab.js";
import { findTorches, relight } from "./mc/torches.js";
import { echoCount, spawnEcho } from "./mc/echo.js";
import { clawMarkNear } from "./mc/signs.js";
import { makeRng } from "./util/rng.js";
import { setDebug } from "./mc/log.js";
import { ACT, RP_CHECK_KEY, SHOT } from "./core/ids.js";
import { emptySchedule } from "./core/scheduler.js";

const log = (...a) => console.warn("[TWDEV] " + a.join(" "));
const ov = () => world.getDimension("overworld");
const r1 = (v) => Math.round(v * 10) / 10;
const fmt = (p) => `${r1(p.x)},${r1(p.y)},${r1(p.z)}`;
const ACT_NAME = Object.fromEntries(Object.entries(ACT).map(([k, v]) => [v, k]));
const Y = -60;

function fill(a, b, block) {
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    ov().fillBlocks(new BlockVolume({ x: a.x, y, z: a.z }, { x: b.x, y, z: b.z }), block);
  }
}
function clearArena(roof = false) {
  director.endAll("aborted");
  for (const e of ov().getEntities({ type: "minecraft:armor_stand" })) e.remove();
  for (const e of ov().getEntities({ type: "tailwail:echo" })) e.remove();
  fill({ x: -5, y: Y - 1, z: -5 }, { x: 75, y: Y - 1, z: 35 }, "minecraft:stone");
  fill({ x: -5, y: Y, z: -5 }, { x: 75, y: Y + 9, z: 35 }, "minecraft:air");
  if (roof) fill({ x: -5, y: Y + 8, z: -5 }, { x: 75, y: Y + 8, z: 35 }, "minecraft:stone");
}

// ------------------------------------------------------------------ stand-in player
const mocks = new Map();
const origById = director.playerById.bind(director);
director.playerById = (id) => mocks.get(id) || origById(id);

class MockPlayer {
  constructor(at) {
    this.body = ov().spawnEntity("minecraft:armor_stand", at);
    this.name = "Mock";
    this.typeId = "minecraft:player";
    this.yaw = 0;
    this.pitch = 0;
    this.isSneaking = false;
    this.isSprinting = false;
    this.isSleeping = false;
    this.isInWater = false;
    this.isFlying = false;
    this.isGliding = false;
    this.selectedSlotIndex = 0;
    this.hp = 20;
    this.damage = [];
    this.calls = [];
    this.sounds = [];
    this.locks = new Map();
    this.fog = [];
    this.music = null;
    this.teleports = 0;
    this.props = new Map();
    this.spawn = null; // bed / spawn point (3.2 signs)
    const rec = (what) => (...a) => this.calls.push(what + (a.length ? " " + JSON.stringify(a[0]).slice(0, 80) : ""));
    this.camera = { isValid: true, addShake: rec("shake"), setFov: rec("fov"), fade: rec("fade"), stopShaking: rec("stopShaking"), clear: rec("camclear") };
    this.fogSettings = {
      push: (id, tag) => { this.fog.push(id); this.calls.push("fog+ " + id); return this.fog.length - 1; },
      remove: (tag) => { const had = this.fog.length > 0; this.fog = []; this.calls.push("fog-"); return had; },
    };
    this.inputPermissions = { setPermissionCategory: (c, on) => { this.locks.set(c, on); this.calls.push(`input ${c}=${on}`); } };
    this.onScreenDisplay = { setActionBar: rec("actionbar"), setTitle: rec("title"), updateSubtitle: rec("subtitle") };
    mocks.set(this.id, this);
  }
  get id() { return "mock-" + this.body.id; }
  get isValid() { return this.body.isValid; }
  get dimension() { return this.body.dimension; }
  get location() { return this.body.location; }
  getHeadLocation() { const l = this.body.location; return { x: l.x, y: l.y + 1.62, z: l.z }; }
  getRotation() { return { x: this.pitch, y: this.yaw }; }
  getViewDirection() {
    const y = (this.yaw * Math.PI) / 180, p = (this.pitch * Math.PI) / 180;
    return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) };
  }
  lookAt(pos) {
    const h = this.getHeadLocation();
    this.yaw = (Math.atan2(-(pos.x - h.x), pos.z - h.z) * 180) / Math.PI;
    this.pitch = (-Math.atan2(pos.y - h.y, Math.hypot(pos.x - h.x, pos.z - h.z)) * 180) / Math.PI;
  }
  getComponent(id) {
    if (id === "minecraft:health") return { currentValue: this.hp };
    if (id === "minecraft:inventory") return { container: { getItem: () => ({ typeId: "minecraft:flint_and_steel" }), emptySlotsCount: 0 } };
    return undefined;
  }
  getGameMode() { return GameMode.Survival; }
  getSpawnPoint() { return this.spawn ? { dimension: this.dimension, ...this.spawn } : undefined; }
  applyDamage(n, o) { this.hp -= n; this.damage.push({ tick: system.currentTick, n, by: o && o.damagingEntity && o.damagingEntity.typeId }); return true; }
  applyKnockback(h, v) { this.calls.push(`knockback ${r1(Math.hypot(h.x, h.z))}/${v}`); }
  addEffect(id) { this.calls.push("effect+ " + id); }
  removeEffect(id) { this.calls.push("effect- " + id); return true; }
  teleport(p) { this.teleports++; this.body.teleport(p); }
  sendMessage(m) { log("msg", m); }
  playSound(id, o) { this.sounds.push(id); return { stop() {}, fade() {} }; }
  playMusic(id) { this.music = id; this.calls.push("music " + id); }
  stopMusic() { this.music = null; this.calls.push("music-stop"); }
  runCommand(c) { this.calls.push("cmd " + c); return { successCount: 1 }; }
  setPropertyOverrideForEntity() {}
  getDynamicProperty(k) { return this.props.get(k); }
  setDynamicProperty(k, v) { if (v === undefined) this.props.delete(k); else this.props.set(k, v); }
  moveTo(p) { this.body.teleport(p); }
  remove() { mocks.delete(this.id); if (this.body.isValid) this.body.remove(); }
  locked() { return [...this.locks.values()].some((on) => on === false); }
}

function spawnTW(mock, at, setup = "stalker", posture = "tall", stage = 2) {
  const enc = director.spawnAt(mock, { ...at, posture, facing: 90 }, setup, director.freeSlot(), true, false, stage);
  // a stalker's random first "cross" beat teleports it to a crossing path at once: put it back
  // where the scenario wants it (scenarios that test the stalk itself let it run on from here)
  if (enc && enc.tw.isValid && Math.hypot(enc.tw.location.x - at.x, enc.tw.location.z - at.z) > 1) {
    enc.tw.teleport({ x: at.x, y: at.y, z: at.z });
    log("(spawnTW: the opening beat had moved it; put back at", fmt(at) + ")");
  }
  return enc;
}

const actOf = (tw) => ACT_NAME[tw.getProperty("tailwail:act")];

function timeline(enc, mock, ticks, every, label, extra) {
  const t0 = system.currentTick;
  return new Promise((res) => {
    const h = system.runInterval(() => {
      const t = system.currentTick - t0;
      const tw = enc.tw;
      if (!tw.isValid || enc.ended) {
        log(label, "t", t, "ended outcome", enc.brain.outcome, "state", enc.brain.state);
        system.clearRun(h);
        return res();
      }
      log(label, "t", t, "state", enc.brain.state, "pos", fmt(tw.location), "posture", enc.mover.posture,
        "act", actOf(tw), "tail", tw.getProperty("tailwail:tail"), "jaw", tw.getProperty("tailwail:jaw"), "dmg", mock.damage.length, extra ? extra() : "");
      if (t >= ticks) { system.clearRun(h); res(); }
    }, every);
  });
}

const wait = (ticks) => new Promise((r) => system.runTimeout(r, ticks));

function walk(mock, pts, speed) {
  return new Promise((res) => {
    let i = 0;
    mock.isSprinting = speed > 5;
    const h = system.runInterval(() => {
      if (!mock.isValid || i >= pts.length) { system.clearRun(h); mock.isSprinting = false; return res(); }
      const l = mock.location, g = pts[i];
      const dx = g.x - l.x, dz = g.z - l.z, d = Math.hypot(dx, dz), step = speed / 20;
      if (d <= step) { mock.moveTo(g); i++; } else mock.moveTo({ x: l.x + (dx / d) * step, y: g.y, z: l.z + (dz / d) * step });
    }, 1);
  });
}

function cleanState(mock) {
  return `locked=${mock.locked()} fog=${mock.fog.length} music=${mock.music} lastFov=${[...mock.calls].reverse().find((c) => c.startsWith("fov") || c.includes("fov_clear")) || "-"}`;
}

// ------------------------------------------------------------------ scenarios
const SCENARIOS = {
  async boot() {
    log("boot", "blocks: snuffed torch type", !!BlockPermutation.resolve("tailwail:snuffed_torch", { "tailwail:facing": "north", "tailwail:kind": 1 }));
    for (const cmd of ["camera @a fov_clear 0.50 in_out_sine", "camera @a fov_set 60 0.5 in_out_sine"]) {
      try {
        const r = ov().runCommand(cmd);
        log("command", JSON.stringify(cmd), "ok", r.successCount);
      } catch (e) {
        log("command", JSON.stringify(cmd), "threw", String(e).slice(0, 160));
      }
    }
    log("boot", "rp check key", RP_CHECK_KEY, "one-shots", Object.keys(SHOT).length);
    // the v3 calls a real creature relies on: one-shot playback, float on/off, act property
    clearArena();
    // a brainless dummy (the same path /tailwail:debug anim uses), so nothing else moves it
    const tw = director.spawnShowcaseDummy({ dimension: ov(), location: { x: 4.5, y: Y, z: 10.5 } }, { x: 10.5, y: Y, z: 10.5 });
    await wait(5);
    for (const name of ["scream", "swipe_r", "flinch"]) {
      try {
        tw.playAnimation(SHOT[name].anim, { controller: SHOT[name].partial ? "tailwail_partial" : "tailwail_shot", blendOutTime: 0.15 });
        log("playAnimation", name, "ok");
      } catch (e) {
        log("playAnimation", name, "threw", String(e).slice(0, 160));
      }
    }
    try {
      tw.triggerEvent("tailwail:float_on");
      const y0 = tw.location.y;
      tw.teleport({ x: 10.5, y: Y + 4, z: 10.5 });
      await wait(20);
      log("float_on: held at", r1(tw.location.y - Y), "blocks (was", r1(y0 - Y), ")");
      tw.triggerEvent("tailwail:float_off");
      await wait(30);
      log("float_off: fell to", r1(tw.location.y - Y), "blocks");
      tw.setProperty("tailwail:act", ACT.cling);
      log("act property set to cling ->", actOf(tw));
    } catch (e) {
      log("float/act threw", String(e).slice(0, 160));
    }
    if (tw.isValid) tw.remove();
  },

  async standoff() {
    // 1) kept at the edge of your view (a glance, never a stare): it observes
    clearArena(true);
    let mock = new MockPlayer({ x: 5.5, y: Y, z: 10.5 });
    let enc = spawnTW(mock, { x: 21.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    mock.lookAt({ x: 21.5, y: Y + 2, z: 10.5 });
    mock.yaw += 45; // 45 degrees off: in view, not watched
    const p0 = enc.tw.location;
    await timeline(enc, mock, 160, 20, "observe-glance");
    const moved = Math.hypot(enc.tw.location.x - p0.x, enc.tw.location.z - p0.z);
    log("observe: modes", enc.brain.history.filter((h) => /observe:|reaction:/.test(h)).join(" / "));
    log("observe: moved", r1(moved), "blocks; state", enc.brain.state, "music", mock.music, "fog", mock.fog.join(","));
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
    // 2) stared at, straight on: it is set off within seconds
    clearArena(true);
    mock = new MockPlayer({ x: 5.5, y: Y, z: 10.5 });
    enc = spawnTW(mock, { x: 21.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    let t0 = system.currentTick;
    await new Promise((res) => {
      const h = system.runInterval(() => {
        if (enc.tw.isValid) mock.lookAt({ x: enc.tw.location.x, y: enc.tw.location.y + 2, z: enc.tw.location.z });
        if (enc.ended || enc.brain.state !== "standoff" || system.currentTick - t0 > 260) { system.clearRun(h); res(); }
      }, 1);
    });
    log("stare: state", enc.brain.state, "after", system.currentTick - t0, "ticks;", enc.brain.history.filter((h) => /-> engage/.test(h)).join(""));
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
    // 3) turn your back
    clearArena(true);
    mock = new MockPlayer({ x: 5.5, y: Y, z: 10.5 });
    enc = spawnTW(mock, { x: 21.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    mock.lookAt({ x: 21.5, y: Y + 2, z: 10.5 });
    await wait(30);
    mock.yaw += 180;
    t0 = system.currentTick;
    await new Promise((res) => {
      const h = system.runInterval(() => {
        if (enc.ended || enc.brain.state !== "standoff" || system.currentTick - t0 > 80) { system.clearRun(h); res(); }
      }, 1);
    });
    log("standoff: turned away -> state", enc.brain.state, "after", system.currentTick - t0, "ticks");
    await timeline(enc, mock, 40, 10, "standoff-engage");
    enc.end("aborted", true);
    log("standoff cleanup", cleanState(mock));
    mock.remove();
    // 4) shot at: a player's arrow aimed at it (the real aim test, fed a stand-in arrow: BDS has no
    //    player to own a real one), and a real arrow entity through the spawn event
    clearArena(true);
    mock = new MockPlayer({ x: 5.5, y: Y, z: 10.5 });
    enc = spawnTW(mock, { x: 21.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    mock.lookAt({ x: 21.5, y: Y + 2, z: 10.5 });
    mock.yaw += 45;
    await wait(20);
    const head = mock.getHeadLocation();
    const tl = enc.tw.location; // aim at where it actually is (the stand-off moves it)
    const aim = { x: tl.x - head.x, y: tl.y + 1.6 - head.y, z: tl.z - head.z };
    const n = Math.hypot(aim.x, aim.y, aim.z);
    const wide = { x: aim.x / n * 3, y: aim.y / n * 3 + 0.0, z: aim.z / n * 3 + 1.5 }; // way off to the side
    const fakeArrow = (v) => ({ isValid: true, location: head, dimension: ov(), getVelocity: () => v,
      getComponent: (id) => (id === "minecraft:projectile" ? { owner: { typeId: "minecraft:player" } } : undefined) });
    director.checkShot(fakeArrow(wide));
    await wait(3);
    log("shot: a wide miss -> state", enc.brain.state);
    const plays = [];
    const play0 = enc.playShot.bind(enc);
    enc.playShot = (name) => { plays.push(name); play0(name); };
    t0 = system.currentTick;
    director.checkShot(fakeArrow({ x: aim.x / n * 3, y: aim.y / n * 3, z: aim.z / n * 3 }));
    await new Promise((res) => {
      const h = system.runInterval(() => {
        if (enc.ended || enc.brain.state === "hunt" || system.currentTick - t0 > 80) { system.clearRun(h); res(); }
      }, 1);
    });
    log("shot: aimed at it -> hunting after", system.currentTick - t0, "ticks;", enc.brain.history.filter((h) => /engage/.test(h)).join(" / "),
      "one-shots played", plays.join(","));
    await timeline(enc, mock, 30, 10, "shot-hunt");
    if (!enc.ended) enc.end("aborted", true);
    // a real (ownerless) arrow through the spawn event, fired well clear of everything
    enc = spawnTW(mock, { x: 21.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    try {
      const real = ov().spawnEntity("minecraft:arrow", { x: 12.5, y: Y + 6, z: 25.5 });
      real.getComponent("minecraft:projectile").shoot({ x: 0, y: 1.5, z: 1 });
      await wait(4);
      log("shot: a real arrow with no player owner -> state", enc.brain.state, "(ignored)");
    } catch (e) {
      log("shot: real arrow threw", String(e).slice(0, 160));
    }
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async commit() {
    clearArena(true);
    const mock = new MockPlayer({ x: 8.5, y: Y, z: 10.5 });
    for (const [x, z] of [[18, 8], [19, 13], [16, 11]]) ov().getBlock({ x, y: Y, z }).setPermutation(BlockPermutation.resolve("minecraft:torch", { torch_facing_direction: "top" }));
    const enc = spawnTW(mock, { x: 18.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("engage", "test");
    mock.lookAt({ x: 18.5, y: Y + 3, z: 10.5 });
    await timeline(enc, mock, 60, 10, "commit");
    const snuffed = [[18, 8], [19, 13], [16, 11]].map(([x, z]) => ov().getBlock({ x, y: Y, z }).typeId);
    log("commit torches after scream", snuffed.join(","));
    const b = ov().getBlock({ x: 18, y: Y, z: 8 });
    if (b.typeId === "tailwail:snuffed_torch") log("relight", relight(b), "->", ov().getBlock({ x: 18, y: Y, z: 8 }).typeId);
    log("commit fx calls", mock.calls.filter((c) => !c.startsWith("subtitle")).slice(0, 30).join(" | "));
    enc.end("aborted", true);
    log("commit cleanup", cleanState(mock));
    mock.remove();
  },

  async hunt() {
    clearArena();
    const mock = new MockPlayer({ x: 50.5, y: Y, z: 10.5 });
    mock.hp = 1000; // a stand-in that does not die, to see what it does after it hurts you
    const enc = spawnTW(mock, { x: 4.5, y: Y, z: 10.5 }, "the_hunter", "hunch");
    await wait(2);
    let t0 = -1;
    let x0 = 0;
    const speeds = [];
    await new Promise((res) => {
      const h = system.runInterval(() => {
        const st = enc.brain.state;
        if (st === "hunt" && t0 < 0) {
          t0 = system.currentTick;
          x0 = enc.tw.location.x;
        }
        if (t0 >= 0 && st === "hunt") speeds.push([system.currentTick - t0, enc.tw.location.x - x0]);
        if (enc.ended || mock.damage.length >= 3 || system.currentTick - (t0 < 0 ? system.currentTick : t0) > 400) { system.clearRun(h); res(); }
      }, 2);
    });
    const run = speeds.filter(([t]) => t >= 20 && t <= 80);
    if (run.length > 2) {
      const [ta, xa] = run[0];
      const [tb, xb] = run[run.length - 1];
      log("hunt: ground speed", r1(((xb - xa) / (tb - ta)) * 20), "blocks/s (sprinting player: 5.6)");
    }
    log("hunt: damage events", JSON.stringify(mock.damage), "states seen", enc.brain.history.slice(-12).join(" / "));
    await timeline(enc, mock, 160, 20, "hunt-after-hits");
    log("hunt: still hunting after hits?", !enc.ended && ["hunt", "attack", "savor", "grab", "engage", "stunned"].includes(enc.brain.state), "outcome", enc.brain.outcome);
    if (!enc.ended) enc.end("aborted", true);
    log("hunt cleanup", cleanState(mock));
    mock.remove();
  },

  async grab() {
    clearArena();
    const mock = new MockPlayer({ x: 10.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 12.8, y: Y, z: 10.5 }, "the_hunter");
    await wait(45); // past the scream
    enc.tw.setRotation({ x: 0, y: 90 });
    mock.lookAt(enc.tw.location);
    enc.brain.grabs = 0;
    enc.brain.enter("grab", "test");
    if (!enc.grab) {
      log("grab refused", enc.brain.state);
    } else {
      const spec = enc.grab.spec;
      log("grab 1 spec", JSON.stringify(spec));
      await wait(14); // lunge
      log("grab 1 holding", enc.grab && enc.grab.holding, "locked", mock.locked(), "tp", mock.teleports);
      // answer whatever it asks
      const kind = () => enc.grab ? enc.grab.kind : "jump";
      for (let i = 0; i < 30 && enc.grab && !enc.grab.success && enc.brain.state === "grab"; i++) {
        const k = kind();
        if (k === "still") break;
        onStrugglePressed(mock, k === "alternate" ? (i % 2 ? "sneak" : "jump") : k);
        await wait(2);
      }
      await timeline(enc, mock, 60, 10, "grab-1-after", () => `locked ${mock.locked()}`);
      log("grab 1 result", "damage", JSON.stringify(mock.damage), "calls", mock.calls.filter((c) => /input|knockback|effect|title/.test(c)).slice(-8).join(" | "));
    }
    // second grab: do nothing at all -> a finisher, then it must keep hunting
    mock.moveTo({ x: enc.tw.location.x - 2.3, y: Y, z: enc.tw.location.z });
    enc.tw.setRotation({ x: 0, y: 90 });
    enc.brain.cd.grab = 0;
    enc.brain.enter("grab", "test2");
    if (enc.grab) log("grab 2 spec", JSON.stringify(enc.grab.spec));
    await timeline(enc, mock, 140, 10, "grab-2", () => `locked ${mock.locked()} hp ${mock.hp}`);
    log("grab 2 result", "damage", JSON.stringify(mock.damage), "locked after", mock.locked(), "state now", enc.brain.state,
      "still hunting", ["hunt", "attack", "savor", "grab", "engage", "stunned", "search"].includes(enc.brain.state));
    if (!enc.ended) enc.end("aborted", true);
    log("grab cleanup", cleanState(mock));
    mock.remove();
  },

  async ceiling() {
    clearArena();
    fill({ x: -5, y: Y + 7, z: -5 }, { x: 75, y: Y + 7, z: 35 }, "minecraft:stone");
    await wait(40); // let the light under the new ceiling settle (the ambush wants a dark ceiling)
    const mock = new MockPlayer({ x: 40.5, y: Y, z: 15.5 });
    mock.yaw = -90; // looking toward +x
    const enc = spawnTW(mock, { x: 60.5, y: Y, z: 15.5 }, "ceiling", "crawl");
    await wait(10);
    log("ceiling: state", enc.brain.state, "act", actOf(enc.tw), "at", fmt(enc.tw.location), "floating", enc.floating);
    await wait(40);
    log("ceiling: after 2 s still at", fmt(enc.tw.location));
    const at = enc.tw.location;
    mock.yaw = 90; // look away and walk under it
    await walk(mock, [{ x: at.x, y: Y, z: at.z - 0.5 }], 4.0);
    await timeline(enc, mock, 80, 10, "ceiling-drop", () => "y " + r1(enc.tw.location.y - Y) + " floating " + enc.floating);
    if (!enc.ended) enc.end("aborted", true);
    log("ceiling cleanup", cleanState(mock));
    mock.remove();
  },

  async climb() {
    clearArena();
    fill({ x: 20, y: Y, z: 9 }, { x: 21, y: Y + 4, z: 12 }, "minecraft:stone"); // a 5-high pillar block
    const mock = new MockPlayer({ x: 20.5, y: Y + 5, z: 10.5 });
    const enc = spawnTW(mock, { x: 8.5, y: Y, z: 10.5 }, "the_hunter", "hunch");
    await wait(5);
    await timeline(enc, mock, 260, 10, "climb", () => "y " + r1(enc.tw.location.y - Y) + " x " + r1(enc.tw.location.x));
    log("climb: reached height", enc.tw.isValid ? r1(enc.tw.location.y - Y) : "-", "flags", [...enc.brain.flags].join(","), "damage", mock.damage.length);
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async door() {
    clearArena();
    // a sealed room with one wooden door between it and you
    fill({ x: 24, y: Y, z: 4 }, { x: 24, y: Y + 4, z: 16 }, "minecraft:stone");
    fill({ x: 24, y: Y, z: 4 }, { x: 34, y: Y + 4, z: 4 }, "minecraft:stone");
    fill({ x: 24, y: Y, z: 16 }, { x: 34, y: Y + 4, z: 16 }, "minecraft:stone");
    fill({ x: 34, y: Y, z: 4 }, { x: 34, y: Y + 4, z: 16 }, "minecraft:stone");
    fill({ x: 24, y: Y + 4, z: 4 }, { x: 34, y: Y + 4, z: 16 }, "minecraft:stone");
    fill({ x: 24, y: Y, z: 10 }, { x: 24, y: Y + 1, z: 10 }, "minecraft:air");
    try {
      ov().runCommand(`setblock 24 ${Y} 10 wooden_door ["direction"=0]`);
    } catch (e) {
      log("door setblock", String(e).slice(0, 120));
    }
    const mock = new MockPlayer({ x: 28.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 12.5, y: Y, z: 10.5 }, "the_hunter", "hunch");
    enc.tw.triggerEvent("tailwail:doors_off");
    await wait(5);
    await timeline(enc, mock, 300, 10, "door", () => "door " + ov().getBlock({ x: 24, y: Y, z: 10 }).typeId);
    log("door: block now", ov().getBlock({ x: 24, y: Y, z: 10 }).typeId, "flags", [...enc.brain.flags].join(","));
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async surface() {
    clearArena();
    world.setTimeOfDay(6000);
    await wait(10);
    const probe = { x: 30, y: Y, z: 10 };
    log("surface light at noon: total", ov().getLightLevel(probe), "sky", ov().getSkyLightLevel(probe));
    world.setTimeOfDay(18000);
    await wait(10);
    log("surface light at midnight: total", ov().getLightLevel(probe), "sky", ov().getSkyLightLevel(probe));
    {
      // the real spawn search for a surface opening, at night, in the open
      const m0 = new MockPlayer({ x: 5.5, y: Y, z: 10.5 });
      m0.yaw = -90;
      const out = {};
      await new Promise((res) => system.runJob((function* () {
        yield* spawnSearch({ dim: ov(), player: m0, players: [m0], rng: makeRng(3), band: [26, 44], minHead: 5, out, behindOnly: false });
        log("surface spawn search at night:", JSON.stringify(out.result), "reason", out.reason);
        res();
      })()));
      m0.remove();
    }
    const mock = new MockPlayer({ x: 5.5, y: Y, z: 10.5 });
    mock.yaw = -90;
    const enc = spawnTW(mock, { x: 40.5, y: Y, z: 10.5 }, "treeline", "tall", 0);
    await wait(5);
    mock.lookAt({ x: 40.5, y: Y + 3, z: 10.5 });
    await timeline(enc, mock, 500, 20, "surface", () => "d " + r1(Math.hypot(mock.location.x - enc.tw.location.x, mock.location.z - enc.tw.location.z)));
    log("surface: reached state", enc.brain.state, "history", enc.brain.history.slice(-8).join(" / "));
    if (!enc.ended) enc.end("aborted", true);
    world.setTimeOfDay(6000);
    mock.remove();
  },

  async hide() {
    clearArena(true);
    const mock = new MockPlayer({ x: 30.5, y: Y, z: 10.5 });
    mock.isSneaking = true; // already hidden when it arrives: it never saw where you are
    mock.yaw = -90;
    const enc = spawnTW(mock, { x: 8.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("search", "test");
    log("hide light at mock", ov().getLightLevel({ x: 30, y: Y + 1, z: 10 }));
    await timeline(enc, mock, 340, 20, "hide", () => "d " + r1(Math.hypot(mock.location.x - enc.tw.location.x, mock.location.z - enc.tw.location.z)));
    log("hide outcome", enc.brain.outcome, "state", enc.brain.state, "damage", mock.damage.length, "flags", [...enc.brain.flags].join(","));
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async escape() {
    // it squeezes through 1-high gaps now: you get through, then you SEAL the gap behind you,
    // and hide crouched in the dark
    clearArena();
    fill({ x: 30, y: Y, z: -5 }, { x: 31, y: Y + 9, z: 35 }, "minecraft:stone");
    fill({ x: 30, y: Y, z: 20 }, { x: 31, y: Y, z: 20 }, "minecraft:air");
    const mock = new MockPlayer({ x: 24.5, y: Y, z: 20.5 });
    const enc = spawnTW(mock, { x: 4.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("hunt", "test");
    const run = walk(mock, [{ x: 29.5, y: Y, z: 20.5 }, { x: 32.5, y: Y, z: 20.5 }], 5.6)
      .then(() => { fill({ x: 30, y: Y, z: 20 }, { x: 31, y: Y, z: 20 }, "minecraft:cobblestone"); log("escape: gap sealed"); })
      .then(() => walk(mock, [{ x: 45.5, y: Y, z: 20.5 }, { x: 60.5, y: Y, z: 28.5 }], 5.6))
      .then(() => { mock.isSneaking = true; });
    mock.yaw = -90;
    await Promise.all([run, timeline(enc, mock, 700, 20, "escape", () => "mock " + fmt(mock.location))]);
    log("escape outcome", enc.brain.outcome, "ended", enc.ended, "damage", JSON.stringify(mock.damage), cleanState(mock));
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async squeeze() {
    // a 1-wide, 1-high tunnel 12 blocks long through a solid wall, you on the far side
    clearArena();
    fill({ x: 24, y: Y, z: -5 }, { x: 35, y: Y + 9, z: 35 }, "minecraft:stone");
    fill({ x: 24, y: Y, z: 15 }, { x: 35, y: Y, z: 15 }, "minecraft:air");
    const mock = new MockPlayer({ x: 40.5, y: Y, z: 15.5 });
    mock.hp = 1000;
    mock.yaw = 90;
    const enc = spawnTW(mock, { x: 8.5, y: Y, z: 15.5 });
    await wait(5);
    enc.brain.enter("hunt", "test");
    enc.brain.lastSeen = { x: 40.5, y: Y, z: 15.5 };
    const seen = new Set();
    let inside = 0;
    let deepest = 0;
    const t0 = system.currentTick;
    await new Promise((res) => {
      const h = system.runInterval(() => {
        if (enc.ended || !enc.tw.isValid) { system.clearRun(h); return res(); }
        const x = enc.tw.location.x;
        seen.add(enc.mover.posture + "/" + actOf(enc.tw));
        if (x > 24 && x < 36) inside++;
        deepest = Math.max(deepest, x);
        if (mock.damage.length >= 2 || system.currentTick - t0 > 600) { system.clearRun(h); res(); }
      }, 2);
    });
    log("squeeze: postures/acts seen", [...seen].join(","), "ticks inside the 1-high tunnel", inside * 2, "furthest x", r1(deepest),
      "through after", system.currentTick - t0, "ticks; damage", JSON.stringify(mock.damage));
    log("squeeze: states", enc.brain.history.slice(-10).join(" / "));
    await timeline(enc, mock, 60, 20, "squeeze-after");
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async tunnel() {
    clearArena();
    fill({ x: 20, y: Y, z: -5 }, { x: 44, y: Y + 9, z: 35 }, "minecraft:stone");
    fill({ x: 20, y: Y, z: 10 }, { x: 44, y: Y + 1, z: 10 }, "minecraft:air");
    const mock = new MockPlayer({ x: 40.5, y: Y, z: 10.5 });
    mock.yaw = 90;
    const enc = spawnTW(mock, { x: 6.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("hunt", "test");
    enc.brain.lastSeen = { x: 40.5, y: Y, z: 10.5 };
    await timeline(enc, mock, 360, 20, "tunnel", () => "x " + r1(enc.tw.location.x));
    log("tunnel reached x", enc.tw.isValid ? r1(enc.tw.location.x) : "(despawned)", "damage", mock.damage.length, "outcome", enc.brain.outcome);
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async presence() {
    clearArena(true);
    const mock = new MockPlayer({ x: 20.5, y: Y, z: 10.5 });
    mock.yaw = 0; // facing +z
    // torches behind the player (-z side), a door, walls to knock on
    for (const [x, z] of [[20, 2], [23, 3], [17, 4], [26, 6]]) ov().getBlock({ x, y: Y, z }).setPermutation(BlockPermutation.resolve("minecraft:torch", { torch_facing_direction: "top" }));
    fill({ x: 14, y: Y, z: 6 }, { x: 14, y: Y + 6, z: 14 }, "minecraft:stone");
    try {
      ov().runCommand(`setblock 24 ${Y} 12 wooden_door ["direction"=0]`);
    } catch (e) {
      log("door setblock", String(e).slice(0, 120));
    }
    await wait(5);
    const s = { ...emptySchedule(), stage: 3, eligibleS: 5000 };
    mock.props.set("tailwail:sched2", JSON.stringify(s));
    const env = director.presence.env(mock);
    log("presence env", JSON.stringify({ torch: env.torch, torches: env.torches, door: env.door }), "torches", env._torches.length, "behind", env._behind.length);
    // a window pane ahead along the arena's long axis (the face-at-the-window test)
    fill({ x: 30, y: Y, z: 9 }, { x: 30, y: Y + 2, z: 12 }, "minecraft:glass_pane");
    const LONG = new Set(["glimpse", "peek", "runner", "window"]); // need room in front: face +x down the arena
    for (const id of ["knock", "breath", "whisper", "snuff", "door", "glimpse", "peek", "mimic", "footsteps", "behind", "lights_out",
      "scrape", "run_steps", "distant_scream", "runner", "door_bang", "window"]) {
      mock.sounds = [];
      if (LONG.has(id)) mock.yaw = -90;
      if (id === "scrape") mock.moveTo({ x: 16.5, y: Y, z: 10.5 }); // beside the wall
      const ok = director.presence.run(id, mock, director.presence.env(mock));
      log("presence", id, "ran", ok, "sounds", mock.sounds.join(","), "echoes", echoCount());
      if (id === "mimic") {
        director.presence.onAction(mock, "break", "minecraft:deepslate");
        await wait(50);
        log("presence mimic replay", mock.sounds.join(","));
      }
      if (id === "footsteps") {
        await walk(mock, [{ x: 20.5, y: Y, z: 16.5 }], 3.5);
        await wait(30);
        log("presence footsteps heard", mock.sounds.filter((x) => x.startsWith("step.")).length, "after walking 6 blocks");
        mock.moveTo({ x: 20.5, y: Y, z: 10.5 });
      }
      if (id === "behind") {
        mock.yaw += 180;
        await wait(8);
        log("presence behind: turned; echoes", echoCount(), "sounds", mock.sounds.join(","));
        mock.yaw -= 180;
      }
      if (id === "glimpse" && ok) {
        await wait(5);
        const e = ov().getEntities({ type: "tailwail:echo" })[0];
        if (e) {
          mock.lookAt({ x: e.location.x, y: e.location.y + 2, z: e.location.z });
          await wait(10);
          mock.yaw += 150;
          await wait(10);
          log("presence glimpse: seen then looked away; echo still exists", e.isValid);
        }
      }
      if (LONG.has(id)) mock.yaw = 0;
      if (id === "scrape") mock.moveTo({ x: 20.5, y: Y, z: 10.5 });
      if (id === "lights_out") await wait(120);
      if (id === "run_steps") {
        await wait(60);
        log("presence run_steps: heavy steps heard", mock.sounds.filter((x) => x === "tailwail.step_heavy").length);
      }
      if (id === "runner" && ok) {
        await wait(5);
        const e = ov().getEntities({ type: "tailwail:echo" })[0];
        const a = e && e.location;
        await wait(20);
        log("presence runner moved", a && e.isValid ? r1(Math.hypot(e.location.x - a.x, e.location.z - a.z)) : "(gone)", "blocks in 1 s");
        await wait(60);
      }
      if (id === "door_bang") {
        await wait(80);
        log("presence door_bang: bangs heard", mock.sounds.filter((x) => x === "tailwail.door_bang").length);
      }
      await wait(4);
    }
    log("presence torches left", findTorches(ov(), mock.location, 16).length);
    mock.remove();
  },

  async death() {
    clearArena();
    const mock = new MockPlayer({ x: 10.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 16.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    await wait(5);
    enc.tw.applyDamage(500, { cause: EntityDamageCause.entityAttack, damagingEntity: mock.body });
    await timeline(enc, mock, 80, 10, "death");
    log("death: entity valid", enc.tw.isValid, "outcome", enc.brain.outcome, cleanState(mock));
    mock.remove();
  },

  async perf() {
    clearArena(true);
    for (const x of [12, 24, 36, 48]) for (const z of [4, 14, 24]) fill({ x, y: Y, z }, { x: x + 1, y: Y + 6, z: z + 1 }, "minecraft:stone");
    const mock = new MockPlayer({ x: 2.5, y: Y, z: 15.5 });
    const enc = spawnTW(mock, { x: 30.5, y: Y, z: 15.5 });
    enc.brain.enter("hunt", "test");
    mock.lookAt(enc.tw.location);
    setDebug(false);
    await wait(10);
    const times = [];
    let rays = 0;
    takeRayCount();
    for (let i = 0; i < 150; i++) {
      const t0 = Date.now();
      director.tickFast();
      times.push(Date.now() - t0);
      rays += takeRayCount();
      await wait(1);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    log("perf 1 encounter (the cap): decision tick avg", avg.toFixed(2), "ms p95", times[Math.floor(times.length * 0.95)], "ms max", times[times.length - 1],
      "ms; raycasts per tick", (rays / times.length).toFixed(1), "(BDS on the dev container CPU; not a client frame-rate measurement)");
    setDebug(true);
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async cap() {
    clearArena(true);
    const ms = [new MockPlayer({ x: 2.5, y: Y, z: 5.5 }), new MockPlayer({ x: 2.5, y: Y, z: 15.5 }), new MockPlayer({ x: 2.5, y: Y, z: 25.5 })];
    const encs = [spawnTW(ms[0], { x: 30.5, y: Y, z: 5.5 }), spawnTW(ms[1], { x: 30.5, y: Y, z: 15.5 }), spawnTW(ms[2], { x: 30.5, y: Y, z: 25.5 })];
    await wait(5);
    const count = () => ov().getEntities({ type: "tailwail:tall_wail" }).length;
    log("cap: three spawn requests ->", encs.map((e) => (e ? "spawned" : "refused")).join(","), "; Tailwails in the world", count());
    const first = encs.find((e) => e);
    // a spawn egg / summon while one is out: the new one replaces it
    const egg = ov().spawnEntity("tailwail:tall_wail", { x: 40.5, y: Y, z: 15.5 });
    await wait(20);
    log("cap: egg while one exists -> old ended", first ? first.ended : "-", "; new adopted", director.encounters.has(egg.id), "; Tailwails in the world", count());
    // no hallucination while a real one is out
    const echo = spawnEcho(ov(), { x: 20.5, y: Y, z: 30.5 }, 0, "watch", 2, null);
    log("cap: hallucination while a real one exists ->", echo ? "SPAWNED (wrong)" : "refused", "; echoes", echoCount());
    director.endAll("aborted");
    await wait(5);
    const echo2 = spawnEcho(ov(), { x: 20.5, y: Y, z: 30.5 }, 0, "watch", 2, null);
    const echo3 = spawnEcho(ov(), { x: 22.5, y: Y, z: 30.5 }, 0, "watch", 2, null);
    log("cap: with none out -> hallucination", echo2 ? "spawned" : "refused", "; a second one at the same time", echo3 ? "SPAWNED (wrong)" : "refused");
    await wait(50);
    log("cap: Tailwails left", count(), "echoes left", echoCount());
    ms.forEach((m) => m.remove());
  },

  async signs() {
    // a sealed, dark cave room so nothing has sky light, plus a little house with a bed
    clearArena(true);
    fill({ x: -5, y: Y, z: -5 }, { x: 75, y: Y + 7, z: -5 }, "minecraft:stone");
    fill({ x: -5, y: Y, z: 35 }, { x: 75, y: Y + 7, z: 35 }, "minecraft:stone");
    fill({ x: -5, y: Y, z: -5 }, { x: -5, y: Y + 7, z: 35 }, "minecraft:stone");
    fill({ x: 75, y: Y, z: -5 }, { x: 75, y: Y + 7, z: 35 }, "minecraft:stone");
    await wait(40);
    const dim = ov();
    const blocksOf = (types, a, b) => {
      try {
        return [...dim.getBlocks(new BlockVolume(a, b), { includeTypes: types }, true).getBlockLocationIterator()];
      } catch (e) {
        log("getBlocks threw", String(e).slice(0, 120));
        return [];
      }
    };
    const ALL = [{ x: -4, y: Y - 1, z: -4 }, { x: 74, y: Y + 7, z: 34 }];
    // 1) claw marks along a real hunt down a 3-wide corridor
    fill({ x: 10, y: Y, z: 10 }, { x: 60, y: Y + 6, z: 10 }, "minecraft:stone");
    fill({ x: 10, y: Y, z: 14 }, { x: 60, y: Y + 6, z: 14 }, "minecraft:stone");
    let mock = new MockPlayer({ x: 58.5, y: Y, z: 12.5 });
    mock.hp = 1000;
    let enc = spawnTW(mock, { x: 12.5, y: Y, z: 12.5 });
    enc.brain.enter("hunt", "test");
    await wait(160);
    const claws = blocksOf(["tailwail:claw_marks"], ALL[0], ALL[1]);
    log("signs: claw marks after an 8 s hunt down a cave corridor:", claws.length, claws.slice(0, 4).map(fmt).join(" "),
      "; states", claws.length ? JSON.stringify(dim.getBlock(claws[0]).permutation.getAllStates()) : "-");
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
    log("signs: clawMarkNear beside a wall ->", (() => { const c = clawMarkNear(dim, { x: 11.5, y: Y, z: 11.5 }, makeRng(4)); return c ? fmt(c) : "none"; })());
    // 2) tallies by the bed, while you are away
    fill({ x: 30, y: Y, z: 20 }, { x: 36, y: Y + 3, z: 20 }, "minecraft:planks");
    fill({ x: 30, y: Y, z: 26 }, { x: 36, y: Y + 3, z: 26 }, "minecraft:planks");
    fill({ x: 30, y: Y, z: 20 }, { x: 30, y: Y + 3, z: 26 }, "minecraft:planks");
    fill({ x: 36, y: Y, z: 20 }, { x: 36, y: Y + 3, z: 26 }, "minecraft:planks");
    fill({ x: 30, y: Y + 3, z: 20 }, { x: 36, y: Y + 3, z: 26 }, "minecraft:planks");
    try {
      dim.runCommand(`setblock 33 ${Y} 23 bed ["direction"=0,"head_piece_bit"=false]`);
    } catch (e) {
      log("bed setblock threw", String(e).slice(0, 120));
    }
    await wait(2);
    const beds = blocksOf(["minecraft:bed"], { x: 31, y: Y, z: 21 }, { x: 35, y: Y, z: 25 });
    log("signs: bed blocks after setblock", beds.map((b) => fmt(b) + JSON.stringify(dim.getBlock(b).permutation.getAllStates())).join(" | "));
    mock = new MockPlayer({ x: 60.5, y: Y, z: 30.5 });
    mock.yaw = -90; // looking away, 30 blocks off
    mock.spawn = { x: 33, y: Y, z: 23 };
    const base = { x: 33, y: Y, z: 23 };
    const st = { carved: 0, tally: null, moveAt: null, last: null, moved: null };
    let made = 0;
    for (let i = 0; i < 7; i++) if (director.signs.carveTally(dim, base, st, [mock])) made++;
    const tallies = blocksOf(["tailwail:tally"], { x: 29, y: Y - 1, z: 19 }, { x: 37, y: Y + 3, z: 27 });
    log("signs: 7 escapes ->", made, "strokes;", tallies.map((t) => fmt(t) + " count " + dim.getBlock(t).permutation.getState("tailwail:count") +
      " facing " + dim.getBlock(t).permutation.getState("tailwail:facing")).join(" | "));
    // the per-second path, with a schedule that owes one more
    const sched = { escN: 8, eligibleS: 5000, stage: 2 };
    const pages = [];
    mock.props.set("tailwail:signs", JSON.stringify(st));
    director.signs.tickPlayer(mock, sched, { signs: true }, (f) => pages.push(f));
    log("signs: tickPlayer (away, owes 1) -> carved", JSON.parse(mock.props.get("tailwail:signs")).carved);
    // 3) your things, moved: put a torch, a barrel and a chest in the house
    dim.getBlock({ x: 31, y: Y, z: 21 }).setPermutation(BlockPermutation.resolve("minecraft:torch", { torch_facing_direction: "top" }));
    dim.getBlock({ x: 35, y: Y, z: 25 }).setPermutation(BlockPermutation.resolve("minecraft:barrel", { facing_direction: 1, open_bit: false }));
    dim.getBlock({ x: 35, y: Y, z: 21 }).setPermutation(BlockPermutation.resolve("minecraft:chest"));
    await wait(2);
    const con = dim.getBlock({ x: 35, y: Y, z: 21 }).getComponent("minecraft:inventory").container;
    con.setItem(0, new ItemStack("minecraft:bread", 5));
    con.setItem(1, new ItemStack("minecraft:iron_ingot", 3));
    con.setItem(2, new ItemStack("minecraft:coal", 9));
    const slotsOf = () => { const o = []; for (let i = 0; i < con.size; i++) { const it = con.getItem(i); if (it) o.push(i + ":" + it.typeId.replace("minecraft:", "") + "x" + it.amount); } return o.join(","); };
    log("signs: chest before", slotsOf());
    const bedState = () => blocksOf(["minecraft:bed"], { x: 31, y: Y, z: 21 }, { x: 35, y: Y, z: 25 }).map((b) => fmt(b) + " head " +
      dim.getBlock(b).permutation.getState("head_piece_bit") + " dir " + dim.getBlock(b).permutation.getState("direction")).join(" | ");
    log("signs: bed before", bedState());
    for (const k of ["torch", "barrel", "chest", "bed"]) {
      const s2 = { last: null };
      const got = director.signs.disturb(dim, base, s2, [mock], k);
      log("signs: move", k, "->", got, s2.moved ? fmt(s2.moved) : "");
    }
    log("signs: torch now", blocksOf(["minecraft:torch"], { x: 28, y: Y - 1, z: 18 }, { x: 38, y: Y + 2, z: 28 }).map(fmt).join(" "), "(was 31,-60,21)");
    log("signs: barrel open_bit", dim.getBlock({ x: 35, y: Y, z: 25 }).permutation.getState("open_bit"));
    log("signs: chest after", slotsOf());
    log("signs: bed after", bedState());
    // 4) its nest, deep in the dark room, and what it takes from you when it kills you
    mock.moveTo({ x: 5.5, y: Y, z: 30.5 });
    mock.yaw = 180;
    let nest = null;
    director.signs.ensureNest(dim, { x: 50, y: Y, z: 25 }, [mock], (n) => { nest = n; }, 0);
    for (let i = 0; i < 40 && !nest && director.signs.building; i++) await wait(5);
    log("signs: nest", nest ? JSON.stringify(nest) : "none");
    if (nest) {
      const a = { x: nest.x - 3, y: nest.y - 1, z: nest.z - 3 };
      const b = { x: nest.x + 3, y: nest.y + 2, z: nest.z + 3 };
      const tally = {};
      for (const t of ["minecraft:chest", "tailwail:snuffed_torch", "minecraft:bone_block", "minecraft:skeleton_skull", "minecraft:black_carpet",
        "minecraft:brown_carpet", "minecraft:web", "tailwail:claw_marks"]) tally[t.split(":")[1]] = blocksOf([t], a, b).length;
      log("signs: nest blocks", JSON.stringify(tally));
      const at = { x: nest.x + 8.5, y: Y + 0.5, z: nest.z + 0.5 };
      for (const [id, n] of [["minecraft:diamond", 3], ["minecraft:iron_sword", 1], ["minecraft:cooked_beef", 6], ["minecraft:torch", 12]]) dim.spawnItem(new ItemStack(id, n), at);
      await wait(5);
      director.signs.takeDrops(dim, at, [mock]);
      await wait(60);
      const nc = dim.getBlock(nest.chest).getComponent("minecraft:inventory").container;
      const inChest = [];
      for (let i = 0; i < nc.size; i++) { const it = nc.getItem(i); if (it) inChest.push(i + ":" + it.typeId.replace("minecraft:", "") + "x" + it.amount); }
      log("signs: nest chest after your death", inChest.join(","), "; items still on the ground", dim.getEntities({ type: "minecraft:item", location: at, maxDistance: 6 }).length);
    }
    log("signs: journal pages from tickPlayer", pages.join(",") || "-");
    mock.remove();
  },

  async spawnsite() {
    clearArena();
    fill({ x: 0, y: Y + 6, z: 0 }, { x: 60, y: Y + 6, z: 30 }, "minecraft:stone");
    fill({ x: 0, y: Y, z: -1 }, { x: 60, y: Y + 5, z: -1 }, "minecraft:stone");
    fill({ x: 0, y: Y, z: 31 }, { x: 60, y: Y + 5, z: 31 }, "minecraft:stone");
    fill({ x: -1, y: Y, z: 0 }, { x: -1, y: Y + 5, z: 30 }, "minecraft:stone");
    fill({ x: 61, y: Y, z: 0 }, { x: 61, y: Y + 5, z: 30 }, "minecraft:stone");
    for (const x of [16, 24, 32, 40]) fill({ x, y: Y, z: 6 }, { x: x + 1, y: Y + 5, z: 24 }, "minecraft:stone");
    for (const x of [16, 24, 32, 40]) fill({ x, y: Y, z: 14 }, { x: x + 1, y: Y + 1, z: 15 }, "minecraft:air");
    await wait(10);
    const mock = new MockPlayer({ x: 6.5, y: Y, z: 15.5 });
    mock.yaw = -90;
    for (const [label, band, behindOnly] of [["normal", [18, 30], false], ["behind_you", [7, 11], true]]) {
      const out = {};
      const t0 = Date.now();
      await new Promise((res) => system.runJob((function* () {
        yield* spawnSearch({ dim: ov(), player: mock, players: [mock], rng: makeRng(7), band, minHead: 3, out, behindOnly });
        log("spawnsite", label, JSON.stringify(out.result), "reason", out.reason, "ms", Date.now() - t0);
        res();
      })()));
    }
    mock.remove();
  },
};

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("twh:")) return;
  const name = ev.id.slice(4);
  setDebug(true);
  const fn = SCENARIOS[name];
  if (!fn) return log("unknown scenario", name);
  log("=== scenario", name);
  fn().then(() => log("=== done", name)).catch((e) => log("ERROR", name, e, e && e.stack));
});

log("harness loaded");
