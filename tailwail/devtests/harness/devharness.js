// Dev-only BDS runtime harness (never shipped).  Assembled into a test copy of the
// behavior pack by tools/bds_scenarios.py.  Drives the REAL encounter, presence, grab and
// effects code with a scripted stand-in player, because a dedicated server has no real
// players.  The stand-in records every player-only call (camera, fog, music, input
// permissions, titles, sounds, teleports) so cleanup can be verified.
import { BlockPermutation, BlockVolume, EntityDamageCause, GameMode, system, world } from "@minecraft/server";
import { director } from "./main.js";
import { creatureSees, playerView, takeRayCount } from "./mc/perception.js";
import { spawnSearch } from "./mc/spots.js";
import { onJumpPressed } from "./mc/grab.js";
import { findTorches, relight } from "./mc/torches.js";
import { echoCount } from "./mc/echo.js";
import { makeRng } from "./util/rng.js";
import { setDebug } from "./mc/log.js";
import { POSE } from "./core/ids.js";
import { emptySchedule } from "./core/scheduler.js";

const log = (...a) => console.warn("[TWDEV] " + a.join(" "));
const ov = () => world.getDimension("overworld");
const r1 = (v) => Math.round(v * 10) / 10;
const fmt = (p) => `${r1(p.x)},${r1(p.y)},${r1(p.z)}`;
const POSE_NAME = Object.fromEntries(Object.entries(POSE).map(([k, v]) => [v, k]));
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

function spawnTW(mock, at, setup = "statue_hunt", posture = "tall") {
  return director.spawnAt(mock, { ...at, posture, facing: 90 }, setup, director.freeSlot(), true);
}

const poseOf = (tw) => POSE_NAME[tw.getProperty("tailwail:pose")];

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
      log(label, "t", t, "state", enc.brain.state, "agit", r1(enc.brain.agit.value), "pos", fmt(tw.location), "posture", enc.mover.posture,
        "pose", poseOf(tw), "tail", tw.getProperty("tailwail:tail"), "jaw", tw.getProperty("tailwail:jaw"), "dmg", mock.damage.length, extra ? extra() : "");
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
  },

  async statue() {
    clearArena(true);
    const mock = new MockPlayer({ x: 5.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 21.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    mock.lookAt({ x: 21.5, y: Y + 3, z: 10.5 });
    const p0 = enc.tw.location;
    await timeline(enc, mock, 60, 20, "statue-watched", () => "inView " + playerView(mock, enc.tw, enc.mover.posture).inView);
    const moved = Math.hypot(enc.tw.location.x - p0.x, enc.tw.location.z - p0.z);
    log("statue moved while watched", r1(moved), "music", mock.music, "fog", mock.fog.join(","));
    for (let k = 0; k < 3; k++) {
      mock.yaw += 180; // look away
      const before = enc.tw.location;
      await wait(26);
      mock.yaw -= 180; // look back
      await wait(6);
      const after = enc.tw.location;
      log("statue look-away", k, "advanced", r1(Math.hypot(after.x - before.x, after.z - before.z)), "now pose", poseOf(enc.tw), "dist",
        r1(Math.hypot(after.x - mock.location.x, after.z - mock.location.z)), "state", enc.brain.state);
    }
    await timeline(enc, mock, 40, 20, "statue-after");
    enc.end("aborted", true);
    log("statue cleanup", cleanState(mock));
    mock.remove();
  },

  async commit() {
    clearArena(true);
    const mock = new MockPlayer({ x: 8.5, y: Y, z: 10.5 });
    for (const [x, z] of [[18, 8], [19, 13], [16, 11]]) ov().getBlock({ x, y: Y, z }).setPermutation(BlockPermutation.resolve("minecraft:torch", { torch_facing_direction: "top" }));
    const enc = spawnTW(mock, { x: 18.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    enc.brain.agit.value = 99.8;
    mock.lookAt({ x: 18.5, y: Y + 3, z: 10.5 });
    await timeline(enc, mock, 110, 10, "commit");
    const snuffed = [[18, 8], [19, 13], [16, 11]].map(([x, z]) => ov().getBlock({ x, y: Y, z }).typeId);
    log("commit torches after scream", snuffed.join(","));
    const b = ov().getBlock({ x: 18, y: Y, z: 8 });
    if (b.typeId === "tailwail:snuffed_torch") log("relight", relight(b), "->", ov().getBlock({ x: 18, y: Y, z: 8 }).typeId);
    log("commit fx calls", mock.calls.filter((c) => !c.startsWith("subtitle")).slice(0, 30).join(" | "));
    enc.end("aborted", true);
    log("commit cleanup", cleanState(mock));
    mock.remove();
  },

  async grab() {
    clearArena();
    const mock = new MockPlayer({ x: 10.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 13.0, y: Y, z: 10.5 });
    await wait(5);
    enc.tw.setRotation({ x: 0, y: 90 });
    enc.brain.enter("chase", "test");
    mock.lookAt(enc.tw.location);
    await timeline(enc, mock, 30, 5, "grab", () => `locked ${mock.locked()} tp ${mock.teleports} at ${fmt(mock.location)}`);
    log("grab mash: pressing jump 8 times");
    for (let i = 0; i < 8; i++) onJumpPressed(mock);
    await timeline(enc, mock, 50, 5, "grab-free", () => `locked ${mock.locked()} tp ${mock.teleports}`);
    log("grab free result", "damage", JSON.stringify(mock.damage), "calls", mock.calls.filter((c) => /input|knockback|effect|title/.test(c)).join(" | "));
    // second catch, no struggle: thrown
    mock.moveTo({ x: enc.tw.location.x - 2.2, y: Y, z: enc.tw.location.z });
    enc.brain.grabCdUntil = 0;
    enc.brain.chaseResumed = true;
    enc.brain.enter("chase", "test2");
    await timeline(enc, mock, 90, 10, "grab-throw", () => `locked ${mock.locked()} hp ${mock.hp}`);
    log("grab throw result", "damage", JSON.stringify(mock.damage), "locked after", mock.locked());
    if (!enc.ended) enc.end("aborted", true);
    log("grab cleanup", cleanState(mock));
    mock.remove();
  },

  async hide() {
    clearArena(true);
    const mock = new MockPlayer({ x: 30.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 8.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("search", "test");
    mock.isSneaking = true;
    mock.yaw = -90;
    log("hide light at mock", ov().getLightLevel({ x: 30, y: Y + 1, z: 10 }));
    await timeline(enc, mock, 340, 20, "hide", () => "d " + r1(Math.hypot(mock.location.x - enc.tw.location.x, mock.location.z - enc.tw.location.z)));
    log("hide outcome", enc.brain.outcome, "state", enc.brain.state, "damage", mock.damage.length, "flags", [...enc.brain.flags].join(","));
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async escape() {
    clearArena();
    fill({ x: 30, y: Y, z: -5 }, { x: 31, y: Y + 9, z: 35 }, "minecraft:stone");
    fill({ x: 30, y: Y, z: 20 }, { x: 31, y: Y, z: 20 }, "minecraft:air");
    const mock = new MockPlayer({ x: 14.5, y: Y, z: 20.5 });
    const enc = spawnTW(mock, { x: 4.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("chase", "test");
    const run = walk(mock, [{ x: 29.5, y: Y, z: 20.5 }, { x: 32.5, y: Y, z: 20.5 }, { x: 45.5, y: Y, z: 20.5 }, { x: 60.5, y: Y, z: 28.5 }], 5.6);
    mock.yaw = -90;
    await Promise.all([run, timeline(enc, mock, 700, 20, "escape", () => "mock " + fmt(mock.location))]);
    log("escape outcome", enc.brain.outcome, "ended", enc.ended, "damage", JSON.stringify(mock.damage), cleanState(mock));
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
    enc.brain.enter("chase", "test");
    enc.brain.c.lastSeen = { x: 40.5, y: Y, z: 10.5 };
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
    for (const id of ["knock", "breath", "whisper", "fake_chat", "snuff", "door", "glimpse", "peek", "mimic", "footsteps", "behind", "lights_out"]) {
      mock.sounds = [];
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
      if (id === "lights_out") await wait(120);
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
    const ms = [new MockPlayer({ x: 2.5, y: Y, z: 5.5 }), new MockPlayer({ x: 2.5, y: Y, z: 15.5 }), new MockPlayer({ x: 2.5, y: Y, z: 25.5 })];
    const encs = [spawnTW(ms[0], { x: 30.5, y: Y, z: 5.5 }), spawnTW(ms[1], { x: 30.5, y: Y, z: 15.5 }), spawnTW(ms[2], { x: 30.5, y: Y, z: 25.5 })];
    encs[1].brain.enter("standoff", "test");
    encs[2].brain.enter("chase", "test");
    ms.forEach((m, i) => m.lookAt(encs[i].tw.location));
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
    log("perf 3 encounters: decision tick avg", avg.toFixed(2), "ms p95", times[Math.floor(times.length * 0.95)], "ms max", times[times.length - 1],
      "ms; raycasts per tick", (rays / times.length).toFixed(1), "(BDS on the dev container CPU; not a client frame-rate measurement)");
    setDebug(true);
    for (const e of encs) if (!e.ended) e.end("aborted", true);
    ms.forEach((m) => m.remove());
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
