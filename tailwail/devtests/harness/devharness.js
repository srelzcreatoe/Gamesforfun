// Dev-only BDS runtime harness (never shipped).  Assembled into a test copy of the
// behavior pack by tools/bds_scenarios.py.  Drives the REAL encounter code with a
// scripted stand-in player, because a dedicated server has no real players.
import { BlockVolume, EntityDamageCause, GameMode, system, world } from "@minecraft/server";
import { director } from "./main.js";
import { creatureSees, playerView } from "./mc/perception.js";
import { spawnSearch } from "./mc/spots.js";
import { makeRng } from "./util/rng.js";
import { setDebug } from "./mc/log.js";

const log = (...a) => console.warn("[TWDEV] " + a.join(" "));
const ov = () => world.getDimension("overworld");
const r1 = (v) => Math.round(v * 10) / 10;
const fmt = (p) => `${r1(p.x)},${r1(p.y)},${r1(p.z)}`;
const Y = -60;

function fill(a, b, block) {
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    ov().fillBlocks(new BlockVolume({ x: a.x, y, z: a.z }, { x: b.x, y, z: b.z }), block);
  }
}
function clearArena() {
  director.endAll("aborted");
  for (const e of ov().getEntities({ type: "minecraft:armor_stand" })) e.remove();
  fill({ x: -5, y: Y - 1, z: -5 }, { x: 75, y: Y - 1, z: 35 }, "minecraft:stone");
  fill({ x: -5, y: Y, z: -5 }, { x: 75, y: Y + 9, z: 35 }, "minecraft:air");
}

// ------------------------------------------------------------------ stand-in player
class MockPlayer {
  constructor(at) {
    this.body = ov().spawnEntity("minecraft:armor_stand", at);
    this.name = "Mock";
    this.typeId = "minecraft:player";
    this.yaw = 0;
    this.pitch = 0;
    this.isSneaking = false;
    this.isSprinting = false;
    this.hp = 20;
    this.damage = [];
    this.props = new Map();
    this.onScreenDisplay = { setActionBar() {} };
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
  getComponent(id) { return id === "minecraft:health" ? { currentValue: this.hp } : undefined; }
  getGameMode() { return GameMode.Survival; }
  applyDamage(n, o) { this.hp -= n; this.damage.push({ tick: system.currentTick, n, by: o && o.damagingEntity && o.damagingEntity.typeId }); return true; }
  applyKnockback() {}
  sendMessage(m) { log("msg", m); }
  setPropertyOverrideForEntity() {}
  runCommand() {}
  playSound() {}
  getDynamicProperty(k) { return this.props.get(k); }
  setDynamicProperty(k, v) { if (v === undefined) this.props.delete(k); else this.props.set(k, v); }
  moveTo(p) { this.body.teleport(p); }
  remove() { if (this.body.isValid) this.body.remove(); }
}

function spawnTW(mock, at, setup = "delayed_imitation", posture = "tall") {
  const enc = director.spawnAt(mock, { ...at, posture, facing: 90 }, setup, director.freeSlot(), true);
  return enc;
}

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
      const p = tw.location;
      log(label, "t", t, "state", enc.brain.state, "agit", r1(enc.brain.agit.value), "pos", fmt(p), "posture", enc.mover.posture,
        "tail", tw.getProperty("tailwail:tail"), "voice", tw.getProperty("tailwail:voice"), "action", tw.getProperty("tailwail:action"),
        "mimic", tw.getProperty("tailwail:mimic"), "dmg", mock.damage.length, extra ? extra() : "");
      if (t >= ticks) { system.clearRun(h); res(); }
    }, every);
  });
}

const wait = (ticks) => new Promise((r) => system.runTimeout(r, ticks));

function walk(mock, pts, speed) {
  // moves the stand-in along waypoints at `speed` blocks/s
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

// ------------------------------------------------------------------ scenarios
const SCENARIOS = {
  async gaze() {
    clearArena();
    const mock = new MockPlayer({ x: 5.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 25.5, y: Y, z: 10.5 });
    enc.brain.update = () => {}; // freeze the brain: perception only
    await wait(10);
    mock.lookAt({ x: 25.5, y: Y + 2, z: 10.5 });
    let v = playerView(mock, enc.tw, "tall");
    log("gaze open-facing", JSON.stringify(v), "creatureSees", creatureSees(enc.tw, "tall", mock, 48));
    mock.yaw += 120;
    v = playerView(mock, enc.tw, "tall");
    log("gaze open-away", JSON.stringify(v));
    mock.lookAt({ x: 25.5, y: Y + 2, z: 10.5 });
    fill({ x: 14, y: Y, z: 4 }, { x: 14, y: Y + 8, z: 17 }, "minecraft:stone");
    await wait(2);
    v = playerView(mock, enc.tw, "tall");
    log("gaze wall-facing", JSON.stringify(v), "creatureSees", creatureSees(enc.tw, "tall", mock, 48));
    fill({ x: 14, y: Y, z: 4 }, { x: 14, y: Y + 8, z: 17 }, "minecraft:glass");
    await wait(2);
    v = playerView(mock, enc.tw, "tall");
    log("gaze glass-facing", JSON.stringify(v), "creatureSees", creatureSees(enc.tw, "tall", mock, 48));
    enc.end("aborted", true);
    mock.remove();
  },

  async commit() {
    clearArena();
    const mock = new MockPlayer({ x: 10.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 18.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    enc.brain.agit.value = 99.5;
    mock.lookAt({ x: 18.5, y: Y + 3, z: 10.5 });
    await timeline(enc, mock, 260, 10, "commit");
    log("commit damage events", JSON.stringify(mock.damage));
    enc.end("aborted", true);
    mock.remove();
  },

  async wallstrike() {
    clearArena();
    // target sealed in a stone box 2.5 blocks away: reach is fine, LOS is not, no way in
    fill({ x: 8, y: Y, z: 8 }, { x: 12, y: Y + 3, z: 13 }, "minecraft:stone");
    fill({ x: 9, y: Y, z: 9 }, { x: 11, y: Y + 2, z: 12 }, "minecraft:air");
    const mock = new MockPlayer({ x: 10.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 13.6, y: Y, z: 10.5 }, "delayed_imitation", "hunch");
    await wait(5);
    enc.brain.enter("unfold", "test");
    await timeline(enc, mock, 200, 20, "wall");
    log("wall damage events", JSON.stringify(mock.damage));
    enc.end("aborted", true);
    mock.remove();
  },

  async escape() {
    clearArena();
    // corridor with corners, then a 1-block-high crawlspace Tailwail cannot enter
    fill({ x: 30, y: Y, z: 0 }, { x: 31, y: Y + 6, z: 30 }, "minecraft:stone");
    fill({ x: 30, y: Y, z: 20 }, { x: 31, y: Y, z: 20 }, "minecraft:air"); // 1-high hole through the wall
    const mock = new MockPlayer({ x: 14.5, y: Y, z: 20.5 });
    const enc = spawnTW(mock, { x: 4.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("unfold", "test");
    mock.lookAt(enc.tw.location);
    await wait(130); // unfold + windup
    const run = walk(mock, [{ x: 29.5, y: Y, z: 20.5 }, { x: 32.5, y: Y, z: 20.5 }, { x: 45.5, y: Y, z: 20.5 }, { x: 60.5, y: Y, z: 28.5 }], 5.6);
    mock.yaw = -90;
    await Promise.all([run, timeline(enc, mock, 900, 20, "escape", () => "mock " + fmt(mock.location))]);
    log("escape outcome", enc.brain.outcome, "ended", enc.ended, "damage", JSON.stringify(mock.damage));
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async tunnel() {
    clearArena();
    // 1-wide, 2-high tunnel x 20..44 at z 10; the stand-in waits inside
    // a full-width wall makes the tunnel the only route
    fill({ x: 20, y: Y, z: -5 }, { x: 44, y: Y + 9, z: 35 }, "minecraft:stone");
    fill({ x: 20, y: Y, z: 10 }, { x: 44, y: Y + 1, z: 10 }, "minecraft:air");
    const mock = new MockPlayer({ x: 40.5, y: Y, z: 10.5 });
    mock.yaw = 90;
    const enc = spawnTW(mock, { x: 6.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("chase", "test");
    enc.brain.c.lastSeen = { x: 40.5, y: Y, z: 10.5 };
    await timeline(enc, mock, 360, 20, "tunnel", () => "x " + r1(enc.tw.location.x));
    log("tunnel reached x", r1(enc.tw.location.x), "damage", mock.damage.length);
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async stalk() {
    clearArena();
    // pillars to hide behind
    // dark roofed cavern with pillars to hide behind
    fill({ x: -5, y: Y + 7, z: -5 }, { x: 60, y: Y + 7, z: 35 }, "minecraft:stone");
    for (const x of [12, 18, 24, 30]) for (const z of [4, 10, 16, 22]) fill({ x, y: Y, z }, { x: x + 1, y: Y + 6, z: z + 1 }, "minecraft:stone");
    const mock = new MockPlayer({ x: 3.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 27.5, y: Y, z: 13.5 });
    await wait(5);
    // stand where the pillar grid leaves a clear line to it
    mock.moveTo({ x: 27.5, y: Y, z: 1.5 });
    await wait(2);
    mock.lookAt({ x: 27.5, y: Y + 3, z: 13.5 });
    log("light at tailwail", ov().getLightLevel({ x: 27, y: Y + 1, z: 13 }), "watching", JSON.stringify(playerView(mock, enc.tw, "tall")));
    const start = enc.tw.location;
    await timeline(enc, mock, 120, 20, "stalk-watched", () => "watching " + playerView(mock, enc.tw, enc.mover.posture).watching);
    log("moved while watched", r1(Math.hypot(enc.tw.location.x - start.x, enc.tw.location.z - start.z)));
    mock.yaw += 180;
    const s2 = enc.tw.location;
    await timeline(enc, mock, 200, 20, "stalk-unwatched");
    log("moved while unwatched", r1(Math.hypot(enc.tw.location.x - s2.x, enc.tw.location.z - s2.z)));
    enc.end("aborted", true);
    mock.remove();
  },

  async imitate() {
    clearArena();
    const mock = new MockPlayer({ x: 8.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 18.5, y: Y, z: 10.5 });
    enc.settings.imitationChance = 1;
    await wait(5);
    enc.brain.enter("standoff", "test");
    mock.lookAt({ x: 18.5, y: Y + 3, z: 10.5 });
    const t0 = system.currentTick;
    system.runTimeout(() => { mock.isSneaking = true; log("mock crouches at", system.currentTick - t0); }, 20);
    system.runTimeout(() => { mock.isSneaking = false; log("mock stands at", system.currentTick - t0); }, 70);
    await timeline(enc, mock, 160, 5, "imitate", () => "amt " + enc.tw.getProperty("tailwail:mimic_amt"));
    log("memory", JSON.stringify(enc.memory.gest));
    enc.end("calm", true);
    // second encounter: remembered gesture opens it
    mock.props.set("tailwail:mem", JSON.stringify({ ...enc.memory, gest: { ...enc.memory.gest, crouch: { n: 3, w: 0.8, p: 0 } } }));
    const enc2 = spawnTW(mock, { x: 18.5, y: Y, z: 10.5 });
    log("second encounter remembered", JSON.stringify(enc2.remembered));
    mock.lookAt({ x: 18.5, y: Y + 3, z: 10.5 });
    await timeline(enc2, mock, 80, 5, "remember");
    enc2.end("aborted", true);
    mock.remove();
  },

  async calm() {
    clearArena();
    const mock = new MockPlayer({ x: 10.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 20.5, y: Y, z: 10.5 });
    await wait(5);
    enc.brain.enter("standoff", "test");
    mock.lookAt({ x: 20.5, y: Y + 3, z: 10.5 });
    await wait(40);
    mock.yaw += 180;
    const run = walk(mock, [{ x: -3.5, y: Y, z: 10.5 }], 2.0);
    await Promise.all([run, timeline(enc, mock, 400, 20, "calm", () => "d " + r1(Math.hypot(mock.location.x - enc.tw.location.x, mock.location.z - enc.tw.location.z)))]);
    log("calm outcome", enc.brain.outcome, "damage", mock.damage.length);
    if (!enc.ended) enc.end("aborted", true);
    mock.remove();
  },

  async death() {
    clearArena();
    const mock = new MockPlayer({ x: 10.5, y: Y, z: 10.5 });
    const enc = spawnTW(mock, { x: 16.5, y: Y, z: 10.5 });
    await wait(5);
    enc.tw.applyDamage(500, { cause: EntityDamageCause.entityAttack, damagingEntity: mock.body });
    await timeline(enc, mock, 80, 10, "death");
    log("death: entity valid", enc.tw.isValid, "outcome", enc.brain.outcome);
    mock.remove();
  },

  async spawnsite() {
    clearArena();
    // dark enclosed cave: roofed box with internal pillars
    fill({ x: 0, y: Y + 6, z: 0 }, { x: 60, y: Y + 6, z: 30 }, "minecraft:stone");
    fill({ x: 0, y: Y, z: -1 }, { x: 60, y: Y + 5, z: -1 }, "minecraft:stone");
    fill({ x: 0, y: Y, z: 31 }, { x: 60, y: Y + 5, z: 31 }, "minecraft:stone");
    fill({ x: -1, y: Y, z: 0 }, { x: -1, y: Y + 5, z: 30 }, "minecraft:stone");
    fill({ x: 61, y: Y, z: 0 }, { x: 61, y: Y + 5, z: 30 }, "minecraft:stone");
    for (const x of [16, 24, 32, 40]) fill({ x, y: Y, z: 6 }, { x: x + 1, y: Y + 5, z: 24 }, "minecraft:stone");
    for (const x of [16, 24, 32, 40]) fill({ x, y: Y, z: 14 }, { x: x + 1, y: Y + 1, z: 15 }, "minecraft:air");
    await wait(10);
    const mock = new MockPlayer({ x: 6.5, y: Y, z: 15.5 });
    mock.yaw = -90; // facing +x
    const out = {};
    const t0 = Date.now();
    system.runJob((function* () {
      yield* spawnSearch({ dim: ov(), player: mock, players: [mock], rng: makeRng(7), band: [18, 28], minHead: 3, out });
      log("spawnsite result", JSON.stringify(out.result), "reason", out.reason, "ms", Date.now() - t0,
        "light", out.result ? ov().getLightLevel({ x: Math.floor(out.result.x), y: out.result.y, z: Math.floor(out.result.z) }) : "-");
      mock.remove();
    })());
    await wait(60);
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
