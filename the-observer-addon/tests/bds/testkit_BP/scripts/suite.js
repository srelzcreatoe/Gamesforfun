// Integration tests for The Observer, driven by GameTest simulated players on a dedicated server.
// Every check prints "[OTEST] PASS <name> ..." or "[OTEST] FAIL <name> ...".
import { world, system, GameMode, ItemStack, Direction, BlockVolume, BlockPermutation } from "@minecraft/server";
import * as gt from "@minecraft/server-gametest";
import { build, resetHouse, Y, FIELD, HOUSE, TUNNEL, NETHER, POOL, PILLAR } from "./arenas.js";

const OBS = "observer:the_observer";
const ow = () => world.getDimension("overworld");
const log = (m) => console.warn(m);
const results = { pass: 0, fail: 0 };
export function check(name, cond, detail = "") {
  if (cond) results.pass++;
  else results.fail++;
  log(`[OTEST] ${cond ? "PASS" : "FAIL"} ${name} ${detail}`);
  return !!cond;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------------ add-on event channel
const events = [];
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("observer_evt:")) return;
  let data = {};
  try {
    data = JSON.parse(ev.message);
  } catch {}
  events.push({ kind: ev.id.slice(13), data, tick: system.currentTick });
});
const mark = () => events.length;
async function waitEvent(kind, pred, timeoutTicks, from = 0) {
  for (let t = 0; t <= timeoutTicks; t += 2) {
    for (let i = from; i < events.length; i++) if (events[i].kind === kind && pred(events[i].data)) return events[i].data;
    await system.waitTicks(2);
  }
  return undefined;
}
const since = (from, kind) => events.slice(from).filter((e) => e.kind === kind).map((e) => e.data);

function obs(...args) {
  try {
    ow().runCommand(`scriptevent observer:${args.join(" ")}`);
  } catch (e) {
    log(`[OTEST] scriptevent failed ${args.join(" ")}: ${e}`);
  }
}
const wait = (t) => system.waitTicks(t);

// ------------------------------------------------------------------ players
const players = {};
function spawn(name, loc, dimension = ow()) {
  const old = world.getAllPlayers().find((p) => p.name === name);
  if (old) {
    old.teleport(loc, { dimension });
    return old;
  }
  const p = gt.spawnSimulatedPlayer({ dimension, x: loc.x, y: loc.y, z: loc.z }, name, GameMode.Survival);
  players[name] = p;
  return p;
}
function heal(p) {
  try {
    p.getComponent("minecraft:health").resetToMaxValue();
  } catch {}
  p.addEffect("saturation", 200, { amplifier: 5, showParticles: false });
}
async function freshTarget(name, loc, face, stage = 5) {
  const p = spawn(name, loc);
  p.stopMoving();
  p.isSneaking = false;
  p.teleport(loc, { facingLocation: face });
  heal(p);
  obs("abort");
  obs("reset", name);
  obs("skipgrace", name);
  obs("stage", String(stage), name);
  await wait(10);
  p.lookAtLocation(face);
  return p;
}
const observerEntity = (dim = ow()) => dim.getEntities({ type: OBS })[0];
async function waitObserver(ticks = 100, dim = ow()) {
  for (let t = 0; t < ticks; t += 2) {
    const e = observerEntity(dim);
    if (e) return e;
    await wait(2);
  }
  return undefined;
}
function standValid(e) {
  const dim = e.dimension;
  const l = e.location;
  const below = dim.getBlock({ x: l.x, y: Math.floor(l.y) - 1, z: l.z });
  const feet = dim.getBlock({ x: l.x, y: Math.floor(l.y), z: l.z });
  const mid = dim.getBlock({ x: l.x, y: Math.floor(l.y) + 1, z: l.z });
  return !!below && (!below.isAir || below.isLiquid) && !!feet && (feet.isAir || !feet.isSolid) && !!mid && mid.isAir;
}
function countBlocks(dim, a, b, type) {
  try {
    const list = dim.getBlocks(new BlockVolume(a, b), { includeTypes: [type] }, false);
    let n = 0;
    for (const _ of list.getBlockLocationIterator()) n++;
    return n;
  } catch (e) {
    return -1;
  }
}
function itemsNear(dim, loc, r = 6) {
  return dim.getEntities({ type: "minecraft:item", location: loc, maxDistance: r }).length;
}
function countItem(p, id) {
  const inv = p.getComponent("minecraft:inventory").container;
  let n = 0;
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it && it.typeId === id) n += it.amount;
  }
  return n;
}
function hasItem(p, id) {
  const inv = p.getComponent("minecraft:inventory").container;
  for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === id) return true;
  return false;
}
async function lookAtObserverFor(p, ticks) {
  for (let t = 0; t < ticks; t += 2) {
    const e = observerEntity(p.dimension);
    if (e) p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
    await wait(2);
  }
}
async function endOf(type, from, ticks = 1200) {
  return waitEvent("end", (d) => d.type === type, ticks, from);
}
async function observerGone(ticks = 200) {
  for (let t = 0; t < ticks; t += 5) {
    if (!observerEntity()) return true;
    await wait(5);
  }
  return false;
}
/** Move every other player far out of sight (any player's gaze counts for encounters like Closer Each Time). */
function isolate(p) {
  for (const o of world.getAllPlayers()) if (o && o.id !== p.id) o.teleport({ x: 1112.5, y: Y, z: 966.5 });
}
/** For tests at the house: every other player to the far west end of the field, facing away (nobody may see it happen). */
function isolateFromHouse(p) {
  for (const o of world.getAllPlayers()) if (o && o.id !== p.id) o.teleport({ x: 903.5, y: Y, z: 1036.5 }, { facingLocation: { x: 880, y: Y + 1.6, z: 1036.5 } });
}
/** Flares burn for 8 s and drive off anything that comes near: tests start once the last one is out. */
async function flaresOut() {
  for (let t = 0; t < 240 && ow().getEntities({ type: "observer:flare" }).length > 0; t += 10) await wait(10);
}
/** Diagnostics when a house test finds no spot: the interior column by column (blocks and light at head height). */
function dumpHouse(tag) {
  const H = HOUSE;
  const rows = [];
  for (let z = H.z0 + 1; z <= H.z1 - 1; z++) {
    let r = "";
    for (let x = H.x0 + 1; x <= H.x1 - 1; x++) {
      const f = ow().getBlock({ x, y: Y, z })?.typeId.replace("minecraft:", "").slice(0, 4) ?? "?";
      r += `${f}/${ow().getLightLevel({ x: x + 0.5, y: Y + 2.5, z: z + 0.5 })} `;
    }
    rows.push(r);
  }
  log(`[OTEST] ${tag} house: ${rows.join(" | ")} players: ${world.getAllPlayers().map((o) => `${o.name}@${o.location.x.toFixed(0)},${o.location.z.toFixed(0)}`).join(" ")}`);
  obs("wards");
  obs("ledger");
}

/** Record damage a player takes (health regenerates, so comparing health before/after is unreliable). */
function trackDamage(p) {
  const r = { total: 0, minHp: 1e9, stop: () => world.afterEvents.entityHurt.unsubscribe(cb) };
  const cb = world.afterEvents.entityHurt.subscribe((ev) => {
    if (ev.hurtEntity.id !== p.id) return;
    r.total += ev.damage;
    const hp = p.getComponent("minecraft:health")?.currentValue ?? 0;
    r.minHp = Math.min(r.minHp, hp);
  });
  return r;
}

const discovered = (from, id, player = "Tester") => since(from, "discovery").some((d) => d.id === id && d.player === player);

// ------------------------------------------------------------------ tests
const TESTS = {};

TESTS.setup = async () => {
  await build();
  obs("trace", "on");
  obs("pause", "on");
  obs("preset", "standard");
  obs("set", "graceMinutes", "0");
  obs("lunge", "never"); // the lunge is random in play; its own test switches it on
  obs("set", "illusions", "false"); // the arena happens to be taiga: no shadows except in their own tests
  obs("preset", "standard");
  await wait(20);
  const p = spawn("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 });
  await wait(20);
  check("setup_player_spawned", !!p && p.isValid);
  check("setup_house_door", ow().getBlock(HOUSE.door)?.typeId === "minecraft:wooden_door");
  check("setup_tunnel_air", ow().getBlock({ x: 931, y: TUNNEL.y, z: 1086 })?.isAir);
};

TESTS.wheel_welcome = async () => {
  // the first player in a world is told the add-on is running and is handed the Config Wheel
  const p = spawn("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 });
  let given = false;
  for (let t = 0; t < 160 && !given; t += 5) {
    given = hasItem(p, "observer:config_wheel");
    await wait(5);
  }
  check("wheel_given_to_first_player", given);
};

TESTS.distant_watch = async () => {
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x, y: Y + 1.6, z: FIELD.z - 30 });
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  const start = await waitEvent("start", (d) => d.type === "distant_watch", 40, m);
  check("distant_watch_started", !!start);
  const e = await waitObserver(60);
  const ended = since(m, "end").find((d) => d.type === "distant_watch");
  if (!check("distant_watch_body_spawned", !!e, ended ? `ended:${ended.outcome}` : "")) return;
  const d = hdist(e.location, p.location);
  check("distant_watch_distance", d >= 12 && d <= 48, `d=${d.toFixed(1)}`);
  check("distant_watch_valid_ground", standValid(e), JSON.stringify(e.location));
  check("distant_watch_state", ["watch", "peek"].includes(e.getProperty("observer:state")), e.getProperty("observer:state"));
  await lookAtObserverFor(p, 40);
  const end = await endOf("distant_watch", m, 400);
  check("distant_watch_noticed", end && end.outcome === "noticed", end ? end.outcome : "no end");
  check("distant_watch_discovery_figure", discovered(m, "the_figure"));
  await wait(40);
  check("first_discovery_gives_notes_and_vestige", hasItem(p, "observer:field_notes") && hasItem(p, "observer:vestige"));
  p.lookAtLocation({ x: p.location.x + 30, y: Y + 1.6, z: p.location.z });
  check("distant_watch_withdrew", await observerGone(300));
};

TESTS.unnoticed_trace = async () => {
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x, y: Y - 10, z: FIELD.z - 3 });
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  const e = await waitObserver(60);
  check("unnoticed_body", !!e);
  // stare at the ground: never notice it; then skip ahead
  const end = await endOf("distant_watch", m, 1200);
  check("unnoticed_outcome", end && end.outcome === "unnoticed", end ? end.outcome : "none");
  check("unnoticed_body_removed", await observerGone(300));
};

TESTS.mirror_bearing = async () => {
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x, y: Y + 1.6, z: FIELD.z - 30 });
  const m = mark();
  obs("trigger", "mirror_bearing", "Tester");
  const e = await waitObserver(100);
  if (!check("mirror_bearing_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  // the favoured bearing is behind-left/right: relative yaw 140..220
  const yawTo = (Math.atan2(-(e.location.x - p.location.x), e.location.z - p.location.z) * 180) / Math.PI;
  let rel = (yawTo - p.getRotation().y) % 360;
  if (rel < 0) rel += 360;
  check("mirror_bearing_behind", rel > 120 && rel < 240, `rel=${rel.toFixed(0)}`);
  await lookAtObserverFor(p, 30);
  const end = await endOf("mirror_bearing", m, 300);
  check("mirror_bearing_noticed", end && end.outcome === "noticed", end ? end.outcome : "none");
  await observerGone(300);
};

TESTS.extra_step_turn = async () => {
  const start = { x: 905.5, y: Y, z: 1000.5 };
  const p = await freshTarget("Tester", start, { x: 990, y: Y + 1.6, z: 1000.5 });
  p.moveRelative(0, 1, 1);
  await wait(30);
  const m = mark();
  obs("trigger", "extra_step", "Tester");
  const st = await waitEvent("start", (d) => d.type === "extra_step", 40, m);
  check("extra_step_started", !!st);
  await wait(80);
  p.stopMoving();
  await wait(30);
  const e = await waitObserver(80);
  if (!check("extra_step_body_after_stop", !!e, (since(m, "end")[0] || {}).outcome)) return;
  check("extra_step_body_behind", e.location.x < p.location.x, `obs.x=${e.location.x.toFixed(1)} p.x=${p.location.x.toFixed(1)}`);
  await lookAtObserverFor(p, 30);
  const end = await endOf("extra_step", m, 300);
  check("extra_step_noticed", end && end.outcome === "noticed", end ? end.outcome : "none");
  check("extra_step_discovery", discovered(m, "out_of_step"));
  await observerGone(300);
};

TESTS.extra_step_sneak = async () => {
  const p = await freshTarget("Tester", { x: 905.5, y: Y, z: 1004.5 }, { x: 990, y: Y + 1.6, z: 1004.5 });
  p.moveRelative(0, 1, 1);
  await wait(30);
  const m = mark();
  obs("trigger", "extra_step", "Tester");
  await wait(60);
  p.isSneaking = true;
  const end = await endOf("extra_step", m, 300);
  p.isSneaking = false;
  p.stopMoving();
  check("extra_step_sneak_outcome", end && end.outcome === "faltered", end ? end.outcome : "none");
  check("extra_step_sneak_discovery", discovered(m, "quiet_feet"));
};

TESTS.door_ajar = async () => {
  obs("restore");
  resetHouse();
  const p = await freshTarget("Tester", { x: 1082.5, y: Y, z: 1000.5 }, { x: 1090, y: Y + 1.6, z: 1000.5 });
  const m = mark();
  obs("trigger", "door_ajar", "Tester");
  await wait(20);
  const door = ow().getBlock(HOUSE.door);
  check("door_ajar_toggled", door.permutation.getState("open_bit") === true, JSON.stringify(door.permutation.getAllStates()));
  const upper = ow().getBlock({ x: HOUSE.door.x, y: Y + 1, z: HOUSE.door.z });
  check("door_ajar_upper_consistent", upper.typeId === "minecraft:wooden_door");
  // player closes it
  p.lookAtBlock(HOUSE.door);
  await wait(10);
  p.interactWithBlock(HOUSE.door, Direction.West);
  const end = await endOf("door_ajar", m, 300);
  check("door_ajar_answered", end && end.outcome === "closed_it", end ? end.outcome : "none");
  check("door_ajar_discovery", discovered(m, "the_door"));
  check("door_ajar_closed", ow().getBlock(HOUSE.door).permutation.getState("open_bit") === false);
  // the player's change wins: no later restoration flips it
  obs("timewarp", "900");
  await wait(60);
  check("door_ajar_player_change_kept", ow().getBlock(HOUSE.door).permutation.getState("open_bit") === false);
};

TESTS.turned_object = async () => {
  obs("restore");
  resetHouse();
  const p = await freshTarget("Tester", { x: 1078.5, y: Y, z: 998.5 }, { x: 1060, y: Y + 1.6, z: 990 });
  const m = mark();
  obs("trigger", "turned_object", "Tester");
  await wait(30);
  const dir = ow().getBlock(HOUSE.pumpkin).permutation.getState("minecraft:cardinal_direction");
  const st = ow().getBlock(HOUSE.stonecutter).permutation.getState("minecraft:cardinal_direction");
  check("turned_object_changed", dir !== "north" || st !== "north", `pumpkin=${dir} stonecutter=${st}`);
  // don't look: let it lapse, then confirm the restoration timer puts it back
  const end = await endOf("turned_object", m, 1000);
  check("turned_object_unnoticed", end && end.outcome === "unnoticed", end ? end.outcome : "none");
  obs("timewarp", "700");
  await wait(60);
  const dir2 = ow().getBlock(HOUSE.pumpkin).permutation.getState("minecraft:cardinal_direction");
  const st2 = ow().getBlock(HOUSE.stonecutter).permutation.getState("minecraft:cardinal_direction");
  check("turned_object_restored", dir2 === "north" && st2 === "north", `pumpkin=${dir2} stonecutter=${st2}`);
};

TESTS.turned_object_noticed = async () => {
  obs("restore");
  resetHouse();
  const p = await freshTarget("Tester", { x: 1078.5, y: Y, z: 998.5 }, { x: 1060, y: Y + 1.6, z: 990 });
  const m = mark();
  obs("trigger", "turned_object", "Tester");
  const ch = await waitEvent("ledger", (d) => d.what === "change" && d.kind === "turn", 60, m);
  if (!check("turned_object_turn_event", !!ch)) return;
  for (let t = 0; t < 40; t += 2) {
    p.lookAtLocation({ x: ch.x + 0.5, y: ch.y + 0.5, z: ch.z + 0.5 });
    await wait(2);
  }
  const end = await endOf("turned_object", m, 300);
  check("turned_object_noticed_outcome", end && end.outcome === "noticed", end ? end.outcome : "none");
  check("turned_object_discovery", discovered(m, "something_facing"));
};

TESTS.snuffed_lights = async () => {
  obs("restore");
  resetHouse();
  ow().runCommand("time set midnight");
  const p = await freshTarget("Tester", { x: 1079.5, y: Y, z: 1000.5 }, { x: 1083, y: Y + 1, z: 1000.5 });
  const before = countBlocks(ow(), { x: 1077, y: Y, z: 997 }, { x: 1083, y: Y + 3, z: 1003 }, "minecraft:torch");
  const m = mark();
  obs("trigger", "snuffed_lights", "Tester");
  await waitEvent("body", (d) => d.what === "spawn", 400, m);
  const after = countBlocks(ow(), { x: 1077, y: Y, z: 997 }, { x: 1083, y: Y + 3, z: 1003 }, "minecraft:torch");
  check("snuffed_lights_removed", after < before, `torches ${before} -> ${after}`);
  check("snuffed_lights_no_drops", itemsNear(ow(), HOUSE.center, 8) === 0);
  // relight: place a torch on the floor next to the player
  p.setItem(new ItemStack("minecraft:torch", 4), 0, true);
  const floor = { x: 1080, y: Y - 1, z: 1001 };
  p.lookAtBlock(floor);
  await wait(6);
  const placed = p.useItemInSlotOnBlock(0, floor, Direction.Up);
  const end = await endOf("snuffed_lights", m, 900);
  check("snuffed_lights_relit", end && end.outcome === "relit", `placed=${placed} ${end ? end.outcome : "none"}`);
  check("snuffed_lights_discovery", discovered(m, "lights_out"));
  obs("timewarp", "60");
  await wait(80);
  const restored = countBlocks(ow(), { x: 1077, y: Y, z: 997 }, { x: 1083, y: Y + 3, z: 1003 }, "minecraft:torch");
  check("snuffed_lights_restored", restored >= before, `torches now ${restored} (orig ${before})`);
  ow().runCommand("time set noon");
};

TESTS.window_watch = async () => {
  obs("restore");
  resetHouse();
  const p = await freshTarget("Tester", { x: 1080.5, y: Y, z: 1000.5 }, { x: 1080.5, y: Y + 1.6, z: 1010 });
  const m = mark();
  obs("trigger", "window_watch", "Tester");
  const e = await waitObserver(80);
  if (!check("window_watch_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  const outside = e.location.x < HOUSE.x0 || e.location.x > HOUSE.x1 || e.location.z < HOUSE.z0 || e.location.z > HOUSE.z1;
  check("window_watch_outside", outside, JSON.stringify(e.location));
  await lookAtObserverFor(p, 30);
  const end = await endOf("window_watch", m, 400);
  check("window_watch_noticed", end && end.outcome === "noticed", end ? end.outcome : "none");
  await observerGone(300);
};

TESTS.close_breath = async () => {
  const p = await freshTarget("Tester", { x: 935.5, y: Y, z: 1000.5 }, { x: 935.5, y: Y + 1.6, z: 980 });
  await wait(160); // stand still (memory needs stillFor >= 6 s)
  const m = mark();
  obs("trigger", "close_breath", "Tester");
  const e = await waitObserver(60);
  if (!check("close_breath_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  check("close_breath_close", hdist(e.location, p.location) < 6, `d=${hdist(e.location, p.location).toFixed(1)}`);
  await wait(30);
  await lookAtObserverFor(p, 20);
  const end = await endOf("close_breath", m, 400);
  check("close_breath_faced", end && end.outcome === "faced", end ? end.outcome : "none");
  check("close_breath_discovery", discovered(m, "close"));
  await observerGone(300);
};

TESTS.borrowed_sound = async () => {
  const p = await freshTarget("Tester", { x: 905.5, y: Y, z: 985.5 }, { x: 960, y: Y + 1.6, z: 985.5 });
  // walk a route to leave breadcrumbs, then turn back
  p.moveRelative(0, 1, 1);
  await wait(200);
  p.stopMoving();
  p.lookAtLocation({ x: p.location.x + 30, y: Y + 1.6, z: p.location.z });
  await wait(20);
  const m = mark();
  obs("trigger", "borrowed_sound", "Tester");
  const info = await waitEvent("info", (d) => d.type === "borrowed_sound", 60, m);
  if (!check("borrowed_sound_source", !!info, (since(m, "end")[0] || {}).outcome)) return;
  check("borrowed_sound_unoccupied", hdist(info, p.location) > 13, `d=${hdist(info, p.location).toFixed(1)}`);
  // walk straight to the source (no pathfinding), tracking the closest approach
  let closest = 999;
  let end;
  for (let t = 0; t < 1400 && !end; t += 4) {
    p.moveToLocation({ x: info.x, y: info.y, z: info.z });
    closest = Math.min(closest, dist(p.location, info));
    await wait(4);
    end = since(m, "end").find((d) => d.type === "borrowed_sound");
  }
  p.stopMoving();
  check("borrowed_sound_investigated", end && end.outcome === "investigated", `${end ? end.outcome : "none"} closest=${closest.toFixed(1)}`);
  check("borrowed_sound_discovery", discovered(m, "borrowed_work"));
};

TESTS.echo_ahead = async () => {
  const p = await freshTarget("Tester", { x: 905.5, y: Y, z: 1030.5 }, { x: 990, y: Y + 1.6, z: 1030.5 });
  p.moveRelative(0, 1, 1);
  await wait(20);
  const m = mark();
  obs("trigger", "echo_ahead", "Tester");
  await wait(60);
  p.stopMoving();
  // look away from the cue so it can arrive, then look back
  p.lookAtLocation({ x: p.location.x - 30, y: Y + 1.6, z: p.location.z });
  const e = await waitObserver(300);
  if (!check("echo_ahead_arrived", !!e, (since(m, "end")[0] || {}).outcome)) return;
  check("echo_ahead_ahead", e.location.x > p.location.x, `obs.x=${e.location.x.toFixed(1)} p.x=${p.location.x.toFixed(1)}`);
  await lookAtObserverFor(p, 30);
  const end = await endOf("echo_ahead", m, 400);
  check("echo_ahead_noticed", end && end.outcome === "noticed", end ? end.outcome : "none");
  check("echo_ahead_discovery", discovered(m, "echo_ahead"));
  await observerGone(300);
};

TESTS.home_visit = async () => {
  obs("restore");
  resetHouse();
  ow().runCommand("time set midnight");
  // start 40 blocks north of the house (the pool lies to the west)
  const p = await freshTarget("Tester", { x: 1080.5, y: Y, z: 1039.5 }, { x: 1080, y: Y + 1.6, z: 1000.5 });
  obs("sethaunt", "1080", String(Y), "1000", "Tester");
  await wait(10);
  const torches0 = countBlocks(ow(), { x: 1077, y: Y, z: 997 }, { x: 1083, y: Y + 3, z: 1003 }, "minecraft:torch");
  const m = mark();
  obs("trigger", "home_visit", "Tester");
  const st = await waitEvent("start", (d) => d.type === "home_visit", 40, m);
  check("home_visit_started", !!st);
  await wait(20);
  const changes = since(m, "ledger").filter((d) => d.what === "change");
  const kinds = [...new Set(changes.map((c) => c.kind))];
  check("home_visit_staged", changes.length >= 3, `kinds=${kinds.join(",")} n=${changes.length}`);
  const effigy = changes.find((c) => c.kind === "effigy");
  check("home_visit_effigy_placed", !!effigy && ow().getBlock(effigy).typeId === "observer:effigy");
  // walk home
  p.navigateToLocation({ x: 1072.5, y: Y, z: 1000.5 }, 1);
  await wait(240);
  p.stopMoving();
  // break the effigy: vestige, no item drop
  if (effigy) {
    p.teleport({ x: effigy.x + 1.5, y: Y, z: effigy.z + 0.5 }, { facingLocation: { x: effigy.x + 0.5, y: Y + 0.3, z: effigy.z + 0.5 } });
    await wait(10);
    p.breakBlock(effigy);
    await wait(40);
    check("home_visit_effigy_gone", ow().getBlock(effigy).typeId !== "observer:effigy");
    check("home_visit_vestige", hasItem(p, "observer:vestige"));
    check("home_visit_small_likeness", discovered(m, "small_likeness"));
    check("home_visit_no_item_drop", itemsNear(ow(), effigy, 3) === 0);
  }
  // close the door / put something back
  const door = changes.find((c) => c.kind === "door");
  if (door) {
    p.teleport({ x: door.x - 1.5, y: Y, z: door.z + 0.5 }, { facingLocation: { x: door.x + 0.5, y: Y + 1, z: door.z + 0.5 } });
    await wait(10);
    p.interactWithBlock({ x: door.x, y: door.y, z: door.z }, Direction.West);
  }
  const end = await endOf("home_visit", m, 20 * 60);
  check("home_visit_put_back", end && (end.outcome === "put_back" || end.noticed), end ? end.outcome : "none");
  obs("timewarp", "60");
  await wait(80);
  const torches = countBlocks(ow(), { x: 1077, y: Y, z: 997 }, { x: 1083, y: Y + 3, z: 1003 }, "minecraft:torch");
  check("home_visit_restored_lights", torches === torches0, `torches=${torches} (before ${torches0})`);
  ow().runCommand("time set noon");
  await observerGone(200);
};

async function tunnelRun(name, behaviour) {
  obs("restore");
  ow().runCommand(`fill ${TUNNEL.x0} ${TUNNEL.y} ${TUNNEL.z0} ${TUNNEL.x1} ${TUNNEL.y + 2} ${TUNNEL.z1} air replace observer:veil`);
  const p = await freshTarget("Tester", { x: 915.5, y: TUNNEL.y, z: 1085.5 }, { x: 958, y: TUNNEL.y + 1.6, z: 1085.5 });
  p.moveRelative(0, 1, 0.6);
  await wait(30);
  const m = mark();
  obs("trigger", "closed_path", "Tester");
  const st = await waitEvent("start", (d) => d.type === "closed_path", 40, m);
  check(`${name}_started`, !!st);
  await wait(20);
  p.stopMoving();
  const sealed = await waitEvent("ledger", (d) => d.what === "change" && d.kind === "veil", 200, m);
  if (!check(`${name}_sealed`, !!sealed, (since(m, "end")[0] || {}).outcome)) return { p, m };
  const veils = since(m, "ledger").filter((d) => d.what === "change" && d.kind === "veil");
  check(`${name}_seal_behind`, veils.every((v) => v.x < p.location.x), `veil x=${veils.map((v) => v.x).join(",")} p.x=${p.location.x.toFixed(1)}`);
  // look back at the seal so it can arrive ahead
  p.lookAtLocation({ x: veils[0].x + 0.5, y: TUNNEL.y + 1, z: 1085.5 });
  const e = await waitObserver(200);
  check(`${name}_arrived_ahead`, !!e && e.location.x > p.location.x, e ? `obs.x=${e.location.x.toFixed(1)}` : "none");
  if (e) {
    await wait(12);
    check(`${name}_stooped_in_tunnel`, e.isValid && e.getProperty("observer:stoop") === true, `stoop=${e.isValid ? e.getProperty("observer:stoop") : "gone"}`);
  }
  await behaviour(p, veils, e, m);
  return { p, m, veils };
}

TESTS.closed_path_escape = async () => {
  const r0 = mark();
  const r = await tunnelRun("closed_path_escape", async (p, veils) => {
    // break a 1x2 gap in the player's own lane, as a player would, and get away through it
    const lane = Math.floor(p.location.z);
    const gap = veils.filter((v) => v.z === lane && v.y <= TUNNEL.y + 1);
    for (const v of gap.length ? gap : veils) {
      p.lookAtBlock(v);
      await wait(4);
      p.breakBlock(v);
      await wait(14); // hand-breaking a Veil block takes 0.4 s
    }
    p.lookAtLocation({ x: 900, y: TUNNEL.y + 1.6, z: 1085.5 });
    p.moveRelative(0, 1, 1);
    await wait(120);
    p.stopMoving();
    const o = observerEntity();
    log(`[OTEST] INFO escape player=${p.location.x.toFixed(1)},${p.location.y.toFixed(1)},${p.location.z.toFixed(1)} observer=${o ? o.location.x.toFixed(1) : "none"} broken=${since(r0, "ledger").filter((d) => d.what === "broken").length}`);
  });
  const end = await endOf("closed_path", r.m, 900);
  check("closed_path_escape_outcome", end && end.outcome === "escaped", end ? end.outcome : "none");
  check("closed_path_escape_discovery", discovered(r.m, "wrong_way"));
  check("closed_path_escape_no_drops", itemsNear(ow(), { x: 930, y: TUNNEL.y, z: 1085 }, 20) === 0);
  await wait(200);
  check("closed_path_veil_cleared", countBlocks(ow(), { x: TUNNEL.x0, y: TUNNEL.y, z: TUNNEL.z0 }, { x: TUNNEL.x1, y: TUNNEL.y + 2, z: TUNNEL.z1 }, "observer:veil") === 0);
};

TESTS.closed_path_held = async () => {
  const r = await tunnelRun("closed_path_held", async (p) => {
    await lookAtObserverFor(p, 200);
  });
  const end = await endOf("closed_path", r.m, 600);
  check("closed_path_held_outcome", end && end.outcome === "held_off", end ? end.outcome : "none");
  check("closed_path_held_discovery", discovered(r.m, "held_gaze"));
  await wait(200);
  check("closed_path_held_veil_cleared", countBlocks(ow(), { x: TUNNEL.x0, y: TUNNEL.y, z: TUNNEL.z0 }, { x: TUNNEL.x1, y: TUNNEL.y + 2, z: TUNNEL.z1 }, "observer:veil") === 0);
};

TESTS.closed_path_struck = async () => {
  obs("set", "aggression", "1"); // Low: one capped strike (Standard keeps attacking: see TESTS.relentless)
  let dmg;
  const r = await tunnelRun("closed_path_struck", async (p) => {
    dmg = trackDamage(p);
    p.lookAtLocation({ x: 900, y: TUNNEL.y + 1.6, z: 1085.5 }); // facing away: it approaches
  });
  const atk = await waitEvent("end", (d) => d.type === "closed_path", 20 * 50, r.m);
  dmg?.stop();
  const strike = since(r.m, "strike")[0];
  check("closed_path_struck_outcome", atk && (atk.outcome === "struck" || atk.outcome === "dodged"), `${atk ? atk.outcome : "none"} ${JSON.stringify(strike)}`);
  check("closed_path_struck_damage_capped", !!dmg && dmg.total > 0 && dmg.minHp >= 1, dmg ? `damage ${dmg.total} lowest hp ${dmg.minHp}` : "no tracker");
  await wait(200);
  obs("preset", "standard");
};

TESTS.aggression_zero = async () => {
  obs("set", "aggression", "0");
  const r = await tunnelRun("aggression_zero", async (p) => {
    p.lookAtLocation({ x: 900, y: TUNNEL.y + 1.6, z: 1085.5 });
  });
  const end = await waitEvent("end", (d) => d.type === "closed_path", 20 * 50, r.m);
  const hp = r.p.getComponent("minecraft:health").currentValue;
  check("aggression_zero_contact_no_damage", end && end.outcome === "caught" && hp === 20, `${end ? end.outcome : "none"} hp=${hp}`);
  obs("preset", "standard");
  await wait(200);
};

TESTS.unfamiliar_route = async () => {
  obs("restore");
  const p = await freshTarget("Tester", { x: 912.5, y: TUNNEL.y, z: 1085.5 }, { x: 958, y: TUNNEL.y + 1.6, z: 1085.5 });
  p.moveRelative(0, 1, 0.6);
  await wait(40);
  const m = mark();
  obs("trigger", "unfamiliar_route", "Tester");
  await wait(40);
  p.stopMoving();
  const ch = await waitEvent("ledger", (d) => d.what === "change" && d.kind === "mimic", 300, m);
  if (!check("unfamiliar_route_mimic", !!ch, (since(m, "end")[0] || {}).outcome)) return;
  const cells = since(m, "ledger").filter((d) => d.what === "change" && d.kind === "mimic");
  check("unfamiliar_route_behind", cells.every((c) => c.x < p.location.x), `cells=${cells.length}`);
  check("unfamiliar_route_looks_natural", ow().getBlock(cells[0]).typeId === "minecraft:stone", ow().getBlock(cells[0]).typeId);
  // turn back and dig through: no drops
  p.lookAtLocation({ x: 900, y: TUNNEL.y + 1.6, z: 1085.5 });
  for (const c of cells) {
    p.teleport({ x: c.x + 2.5, y: TUNNEL.y, z: 1085.5 }, { facingLocation: { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 } });
    await wait(4);
    p.breakBlock(c);
    await wait(30);
  }
  const end = await endOf("unfamiliar_route", m, 600);
  check("unfamiliar_route_noticed", end && (end.outcome === "dug_through" || end.outcome === "noticed_change"), end ? end.outcome : "none");
  check("unfamiliar_route_discovery", discovered(m, "wrong_way"));
  check("unfamiliar_route_no_dupes", itemsNear(ow(), cells[0], 8) === 0);
  obs("timewarp", "200");
  await wait(60);
  check("unfamiliar_route_cleared", countBlocks(ow(), { x: TUNNEL.x0, y: TUNNEL.y, z: TUNNEL.z0 }, { x: 912, y: TUNNEL.y + 2, z: TUNNEL.z1 }, "minecraft:stone") === 0);
};

TESTS.pursuit = async () => {
  obs("set", "aggression", "1");
  ow().runCommand("time set midnight");
  const p = await freshTarget("Tester", { x: 950.5, y: Y, z: 1000.5 }, { x: 990, y: Y + 1.6, z: 1000.5 });
  const dmg = trackDamage(p);
  const m = mark();
  obs("trigger", "pursuit", "Tester");
  const e = await waitObserver(200);
  if (!check("pursuit_appeared_in_view", !!e, (since(m, "end")[0] || {}).outcome)) return;
  check("pursuit_distance", hdist(e.location, p.location) > 18, `d=${hdist(e.location, p.location).toFixed(1)}`);
  // response window: it should not have moved during the stare
  const l0 = { ...e.location };
  await wait(40);
  check("pursuit_response_window", e.isValid && hdist(e.location, l0) < 0.5);
  // look away and stand still: it runs, then strikes
  p.lookAtLocation({ x: p.location.x - 30, y: Y + 1.6, z: p.location.z });
  await wait(40);
  const d1 = e.isValid ? hdist(e.location, p.location) : 0;
  const st1 = e.isValid ? e.getProperty("observer:state") : "gone";
  await wait(20);
  const d2 = e.isValid ? hdist(e.location, p.location) : 0;
  check("pursuit_runs", d1 - d2 > 2.5, `speed≈${(d1 - d2).toFixed(2)} b/s`);
  // 1.0.6: it floats after you — the surge, not the run
  check("pursuit_floats_surging", st1 === "surge", String(st1));
  const end = await endOf("pursuit", m, 20 * 40);
  dmg.stop();
  const strike = since(m, "strike")[0];
  check("pursuit_struck", end && (end.outcome === "struck" || end.outcome === "dodged"), `${end ? end.outcome : "none"} ${JSON.stringify(strike)}`);
  check("pursuit_damage_nonlethal", dmg.total > 0 && dmg.minHp >= 1, `damage ${dmg.total} lowest hp ${dmg.minHp}`);
  ow().runCommand("time set noon");
  await observerGone(300);
  obs("preset", "standard");
};

TESTS.pursuit_watched_walks = async () => {
  ow().runCommand("time set midnight");
  const p = await freshTarget("Tester", { x: 950.5, y: Y, z: 1000.5 }, { x: 990, y: Y + 1.6, z: 1000.5 });
  const m = mark();
  obs("trigger", "pursuit", "Tester");
  const e = await waitObserver(200);
  if (!check("pursuit_watched_body", !!e)) return;
  await wait(70);
  let d1 = 0, d2 = 0;
  for (let t = 0; t < 60; t += 2) {
    if (t === 20) d1 = hdist(e.location, p.location);
    if (e.isValid) p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
    await wait(2);
  }
  d2 = e.isValid ? hdist(e.location, p.location) : d1;
  const speed = (d1 - d2) / 2;
  check("pursuit_watched_slow", speed < 3.6, `speed≈${speed.toFixed(2)} b/s while watched`);
  check("pursuit_watched_drifts", e.isValid && e.getProperty("observer:state") === "float", e.isValid ? String(e.getProperty("observer:state")) : "gone");
  obs("abort");
  await endOf("pursuit", m, 100);
  ow().runCommand("time set noon");
  await observerGone(300);
};

TESTS.lens = async () => {
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x, y: Y + 1.6, z: FIELD.z - 30 });
  p.setItem(new ItemStack("observer:witness_lens", 1), 1, true);
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  const e = await waitObserver(80);
  if (!check("lens_body", !!e)) return;
  for (let t = 0; t < 10; t += 2) {
    p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
    await wait(2);
  }
  p.useItemInSlot(1);
  await wait(10);
  check("lens_recoil", e.isValid && e.getProperty("observer:state") !== "watch", e.isValid ? e.getProperty("observer:state") : "gone");
  check("lens_discovery", discovered(m, "through_the_lens"));
  await lookAtObserverFor(p, 30);
  await endOf("distant_watch", m, 300);
  await observerGone(300);
};

TESTS.second_witness = async () => {
  const p = await freshTarget("Tester", { x: 950.5, y: Y, z: 1000.5 }, { x: 950.5, y: Y + 1.6, z: 960 });
  const w = spawn("Witness", { x: 958.5, y: Y, z: 1004.5 });
  w.teleport({ x: 958.5, y: Y, z: 1004.5 }, { facingLocation: { x: 950, y: Y + 1.6, z: 1030 } });
  obs("reset", "Witness");
  obs("skipgrace", "Witness");
  await wait(10);
  w.lookAtLocation({ x: 950, y: Y + 1.6, z: 1030 });
  p.lookAtLocation({ x: 950.5, y: Y + 1.6, z: 960 });
  const m = mark();
  obs("trigger", "second_witness", "Tester");
  const e = await waitObserver(80);
  if (!check("second_witness_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  // witness looks at it, then the target turns
  for (let t = 0; t < 120; t += 2) {
    w.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
    await wait(2);
    if (discovered(m, "second_witness", "Witness")) break;
  }
  check("second_witness_witness_saw", discovered(m, "the_figure", "Witness") && discovered(m, "second_witness", "Witness"));
  await lookAtObserverFor(p, 30);
  const end = await endOf("second_witness", m, 400);
  check("second_witness_both", end && end.outcome === "both_saw", end ? end.outcome : "none");
  w.teleport({ x: 1000, y: Y, z: 960.5 });
  await observerGone(300);
};

TESTS.night_visit = async () => {
  obs("restore");
  resetHouse();
  const p = await freshTarget("Tester", { x: 1081.5, y: Y, z: 1001.5 }, { x: 1083, y: Y + 1, z: 1001.5 });
  const m = mark();
  obs("trigger", "night_visit", "Tester");
  await wait(40);
  const changes = since(m, "ledger").filter((d) => d.what === "change");
  check("night_visit_staged", changes.some((c) => c.kind === "door") && changes.some((c) => c.kind === "effigy"), changes.map((c) => c.kind).join(","));
  p.teleport({ x: HOUSE.door.x + 1.5, y: Y, z: HOUSE.door.z + 0.5 }, { facingLocation: { x: HOUSE.door.x + 0.5, y: Y + 1, z: HOUSE.door.z + 0.5 } });
  await wait(60);
  p.interactWithBlock(HOUSE.door, Direction.East);
  const end = await endOf("night_visit", m, 600);
  check("night_visit_answered", end && end.outcome === "answered", end ? end.outcome : "none");
  check("night_visit_discovery", discovered(m, "while_you_slept"));
};

TESTS.dimension = async () => {
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x, y: Y + 1.6, z: FIELD.z - 30 });
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  await waitObserver(60);
  p.teleport({ x: NETHER.x + 0.5, y: NETHER.y, z: NETHER.z + 0.5 }, { dimension: world.getDimension("nether") });
  const end = await endOf("distant_watch", m, 200);
  check("dimension_abort", end && String(end.outcome).includes("dimension"), end ? end.outcome : "none");
  check("dimension_body_removed", await observerGone(100));
  await wait(40);
  const m2 = mark();
  obs("trigger", "portal_follow", "Tester");
  const end2 = await endOf("portal_follow", m2, 300);
  check("dimension_follow", end2 && end2.outcome === "followed", end2 ? end2.outcome : "none");
  check("dimension_elsewhere_too", discovered(m2, "elsewhere_too"));
  // and an encounter works in the Nether
  const m3 = mark();
  obs("trigger", "distant_watch", "Tester");
  const e = await waitObserver(80, world.getDimension("nether"));
  check("dimension_nether_body", !!e || since(m3, "end").some((d) => d.outcome === "deferred"), e ? JSON.stringify(e.location) : "deferred (no valid spot on small platform)");
  obs("abort");
  await wait(40);
  p.teleport({ x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { dimension: ow() });
  await wait(20);
};

TESTS.ward = async () => {
  obs("restore");
  resetHouse();
  const p = await freshTarget("Tester", { x: 1082.5, y: Y, z: 1000.5 }, { x: 1090, y: Y + 1.6, z: 1000.5 });
  p.setItem(new ItemStack("observer:ward_lantern", 1), 2, true);
  const floor = { x: 1082, y: Y - 1, z: 1002 };
  p.lookAtBlock(floor);
  await wait(6);
  p.useItemInSlotOnBlock(2, floor, Direction.Up);
  await wait(10);
  check("ward_placed", ow().getBlock({ x: 1082, y: Y, z: 1002 }).typeId === "observer:ward_lantern");
  const m = mark();
  obs("trigger", "door_ajar", "Tester");
  await wait(40);
  check("ward_protects_door", ow().getBlock(HOUSE.door).permutation.getState("open_bit") === false);
  check("ward_no_ledger_change", since(m, "ledger").filter((d) => d.what === "change").length === 0);
  ow().runCommand(`setblock 1082 ${Y} 1002 air`);
  await wait(4);
  const m2 = mark();
  obs("wards");
  await wait(10);
  check("ward_removed_when_gone", true);
};

TESTS.chalk = async () => {
  obs("restore");
  resetHouse();
  const p = await freshTarget("Tester", { x: 1082.5, y: Y, z: 1000.5 }, { x: 1078.5, y: Y - 0.5, z: 1000.5 });
  p.setItem(new ItemStack("observer:chalk", 4), 3, true);
  p.lookAtBlock({ x: 1078, y: Y - 1, z: 1000 });
  await wait(6);
  p.useItemInSlot(3);
  await wait(6);
  p.lookAtLocation({ x: 1090, y: Y + 1.6, z: 1000.5 });
  const m = mark();
  obs("trigger", "door_ajar", "Tester");
  const sm = await waitEvent("smudge", (d) => d.player === "Tester", 100, m);
  check("chalk_smudged_by_change", !!sm);
  obs("abort");
  await wait(20);
};

TESTS.manip_off = async () => {
  obs("restore");
  resetHouse();
  obs("set", "manipulation", "0");
  const p = await freshTarget("Tester", { x: 1082.5, y: Y, z: 1000.5 }, { x: 1090, y: Y + 1.6, z: 1000.5 });
  const m = mark();
  obs("trigger", "door_ajar", "Tester");
  await wait(40);
  check("manip_off_door_unchanged", ow().getBlock(HOUSE.door).permutation.getState("open_bit") === false);
  check("manip_off_no_changes", since(m, "ledger").filter((d) => d.what === "change").length === 0);
  obs("preset", "standard");
  await wait(10);
};

TESTS.vigil = async () => {
  obs("restore");
  resetHouse();
  ow().runCommand("time set midnight");
  const p = await freshTarget("Tester", { x: 1074.5, y: Y, z: 1000.5 }, { x: 1060, y: Y + 1.6, z: 1000.5 });
  obs("sethaunt", "1080", String(Y), "1000", "Tester");
  obs("grantpages", "12", "Tester");
  p.setItem(new ItemStack("observer:witness_lens", 1), 1, true);
  await wait(10);
  const m = mark();
  obs("trigger", "vigil", "Tester");
  let lensUses = 0;
  let end;
  let seenId = "";
  for (let t = 0; t < 20 * 240 && !end; t += 4) {
    const e = observerEntity();
    if (e) {
      // search like a player: once it has been placed, walk to a spot near it with a clear view
      if (seenId !== e.id) {
        seenId = e.id;
        await wait(30);
        if (!e.isValid) continue;
        // choose a viewpoint 6 blocks away with a clear line of sight (as a searching player would)
        const head = { x: e.location.x, y: e.location.y + 2.2, z: e.location.z };
        for (let a = 0; a < 360; a += 30) {
          const r = (a * Math.PI) / 180;
          const pt = { x: e.location.x + Math.cos(r) * 6, y: e.location.y, z: e.location.z + Math.sin(r) * 6 };
          const eye = { x: pt.x, y: pt.y + 1.62, z: pt.z };
          const feet = ow().getBlock(pt), above = ow().getBlock({ x: pt.x, y: pt.y + 1, z: pt.z });
          if (!feet || !above || !feet.isAir || !above.isAir) continue;
          const dir = { x: head.x - eye.x, y: head.y - eye.y, z: head.z - eye.z };
          const dl = Math.hypot(dir.x, dir.y, dir.z);
          const hit = ow().getBlockFromRay(eye, { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl }, { maxDistance: dl, includePassableBlocks: false });
          if (hit) continue;
          p.teleport(pt, { facingLocation: head });
          break;
        }
      }
      if (e.isValid) p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
      if (t % 40 === 0) {
        p.useItemInSlot(1);
        lensUses++;
      }
    }
    await wait(4);
    end = since(m, "end").find((d) => d.type === "vigil");
  }
  check("vigil_completed", end && end.outcome === "witnessed", `${end ? end.outcome : "none"} lensUses=${lensUses}`);
  check("vigil_reward", hasItem(p, "observer:observers_eye"));
  check("vigil_restored", since(m, "ledger").filter((d) => d.what === "change").length >= 1);
  ow().runCommand("time set noon");
  ow().runCommand("weather clear");
  await observerGone(300);
};

TESTS.natural = async () => {
  // the director on its own: high frequency, no grace, a wandering player
  obs("set", "frequency", "2");
  obs("pause", "off");
  const p = await freshTarget("Tester", { x: 950.5, y: Y, z: 1000.5 }, { x: 990, y: Y + 1.6, z: 1000.5 }, 3);
  obs("skipgrace", "Tester");
  const m = mark();
  const route = [{ x: 990, y: Y, z: 1000 }, { x: 990, y: Y, z: 1030 }, { x: 910, y: Y, z: 1030 }, { x: 910, y: Y, z: 975 }, { x: 990, y: Y, z: 975 }];
  for (let lap = 0; lap < 40; lap++) {
    const r = route[lap % route.length];
    p.navigateToLocation(r, 0.8);
    for (let t = 0; t < 200; t += 20) {
      await wait(20);
      const e = observerEntity();
      if (e && Math.random() < 0.5) p.lookAtLocation({ x: e.location.x, y: e.location.y + 2, z: e.location.z });
    }
    if (since(m, "end").filter((d) => !d.outcome.startsWith("deferred")).length >= 3) break;
  }
  p.stopMoving();
  const starts = since(m, "start").filter((d) => !d.forced);
  const ends = since(m, "end");
  check("natural_director_started_encounters", starts.length >= 2, `types=${starts.map((s) => s.type).join(",")} outcomes=${ends.map((e) => e.outcome).join(",")}`);
  obs("preset", "standard");
  obs("pause", "on");
  obs("abort");
  await observerGone(300);
};

TESTS.water = async () => {
  // swimming in open water: it stands on the surface, and sinks when noticed
  const p = await freshTarget("Tester", POOL.center, { x: POOL.center.x, y: Y + 1, z: POOL.center.z - 30 });
  await wait(20);
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  const e = await waitObserver(80);
  if (!check("water_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  const under = e.dimension.getBlock({ x: e.location.x, y: e.location.y - 1, z: e.location.z });
  check("water_stands_on_surface", under && under.typeId === "minecraft:water", `under=${under?.typeId} y=${e.location.y}`);
  const y0 = e.location.y;
  let minY = y0;
  for (let t = 0; t < 60; t += 2) {
    if (e.isValid) {
      p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
      minY = Math.min(minY, e.location.y);
    }
    await wait(2);
  }
  const end = await endOf("distant_watch", m, 300);
  check("water_noticed", end && end.outcome === "noticed", end ? end.outcome : "none");
  check("water_sank", minY < y0 - 1, `y ${y0.toFixed(2)} -> ${minY.toFixed(2)}`);
  await observerGone(200);
};

TESTS.elevated = async () => {
  // on top of a pillar: it watches from the ground below, looking up
  const p = await freshTarget("Tester", { x: PILLAR.x + 0.5, y: PILLAR.top, z: PILLAR.z + 0.5 }, { x: PILLAR.x, y: PILLAR.top + 1.6, z: PILLAR.z - 20 });
  await wait(30);
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  const e = await waitObserver(80);
  if (!check("elevated_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  check("elevated_below", e.location.y < PILLAR.top - 12, `obs.y=${e.location.y} player.y=${p.location.y.toFixed(1)}`);
  check("elevated_valid_ground", standValid(e));
  await lookAtObserverFor(p, 40);
  const end = await endOf("distant_watch", m, 300);
  check("elevated_noticed", end && end.outcome === "noticed", end ? end.outcome : "none");
  p.teleport({ x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 });
  await observerGone(200);
};

TESTS.carve = async () => {
  // Unsettling level: the path change may also open a temporary hole in a natural wall
  obs("restore");
  obs("set", "manipulation", "3");
  const p = await freshTarget("Tester", { x: 930.5, y: TUNNEL.y, z: 1085.5 }, { x: 958, y: TUNNEL.y + 1.6, z: 1085.5 });
  p.moveRelative(0, 1, 0.6);
  await wait(40);
  const m = mark();
  obs("trigger", "unfamiliar_route", "Tester");
  await wait(40);
  p.stopMoving();
  const cv = await waitEvent("ledger", (d) => d.what === "change" && d.kind === "carve", 300, m);
  check("carve_opening_made", !!cv, cv ? `${cv.from} at ${cv.x},${cv.y},${cv.z}` : (since(m, "end")[0] || {}).outcome);
  // the opening is in a tunnel wall (z 1084 or 1087), at feet or head height, not in the floor or behind the wall
  if (cv) check("carve_in_tunnel_wall", (cv.z === TUNNEL.z0 - 1 || cv.z === TUNNEL.z1 + 1) && (cv.y === TUNNEL.y || cv.y === TUNNEL.y + 1), `${cv.x},${cv.y},${cv.z}`);
  obs("abort");
  await endOf("unfamiliar_route", m, 200);
  obs("timewarp", "200");
  await wait(60);
  if (cv) check("carve_restored", ow().getBlock(cv).typeId === cv.from, ow().getBlock(cv).typeId);
  obs("preset", "standard");
  await observerGone(200);
};

TESTS.showcase = async () => {
  // Config Wheel "See it now": works in creative, shows every state in front of the player, harmless
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 });
  p.setGameMode(GameMode.Creative);
  const dmg = trackDamage(p);
  const m = mark();
  obs("trigger", "showcase", "Tester");
  const e = await waitObserver(60);
  if (!check("showcase_body", !!e, (since(m, "end")[0] || {}).outcome)) {
    dmg.stop();
    p.setGameMode(GameMode.Survival);
    return;
  }
  const d = hdist(e.location, p.location);
  const v = p.getViewDirection();
  const to = { x: e.location.x - p.location.x, z: e.location.z - p.location.z };
  const ang = (Math.acos((v.x * to.x + v.z * to.z) / (Math.hypot(v.x, v.z) * Math.hypot(to.x, to.z))) * 180) / Math.PI;
  check("showcase_in_front", d >= 3.5 && d <= 13 && ang < 60, `d=${d.toFixed(1)} angle=${ang.toFixed(0)}`);
  const seen = new Set();
  for (let t = 0; t < 20 * 32 && e.isValid; t += 4) {
    seen.add(e.getProperty("observer:state"));
    await wait(4);
  }
  check("showcase_all_states", ["watch", "stare", "tilt", "walk", "run", "attack", "recoil"].every((s) => seen.has(s)), [...seen].join(","));
  check("showcase_no_peek_without_cover", !seen.has("peek"), [...seen].join(","));
  const end = await endOf("showcase", m, 400);
  dmg.stop();
  check("showcase_outcome", end && end.outcome === "shown", end ? end.outcome : "none");
  check("showcase_ends_in_vanish", since(m, "fx").some((d) => d.what === "vanish"), JSON.stringify(since(m, "fx")));
  // new block changes only (restorations of earlier encounters may happen meanwhile)
  const changes = since(m, "ledger").filter((d) => d.what === "change").length;
  check("showcase_harmless", dmg.total === 0 && changes === 0 && since(m, "discovery").length === 0,
    `damage=${dmg.total} changes=${changes} discoveries=${since(m, "discovery").length}`);
  p.setGameMode(GameMode.Survival);
  await observerGone(200);
};

TESTS.toggles = async () => {
  // encounter types switched off on the Config Wheel are never chosen by the director
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 3);
  const all = ["creeping", "distant_watch", "extra_step", "home_visit", "closed_path", "borrowed_sound", "turned_object", "door_ajar", "snuffed_lights",
    "mirror_bearing", "echo_ahead", "unfamiliar_route", "close_breath", "pursuit", "window_watch", "second_witness", "night_visit", "portal_follow",
    "inside", "sign", "borrowed_eyes"];
  obs("set", "off", all.filter((x) => x !== "distant_watch").join(","));
  const m = mark();
  obs("pause", "off");
  const st = await waitEvent("start", (d) => !d.forced, 20 * 90, m);
  obs("pause");
  check("toggles_only_enabled_type", !!st && st.type === "distant_watch", st ? `${st.target}: ${st.type}` : "no encounter started");
  obs("abort");
  obs("set", "off", "");
  await observerGone(200);
};

TESTS.presence_fx = async () => {
  // eyes glow at night (observer:dark), not at noon in the open; removal tears it apart (vanish effect)
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 });
  ow().runCommand("time set midnight");
  let m = mark();
  obs("trigger", "distant_watch", "Tester");
  let e = await waitObserver(60);
  if (!check("presence_body_night", !!e, (since(m, "end")[0] || {}).outcome)) return;
  await wait(30);
  check("eyes_glow_at_night", e.isValid && e.getProperty("observer:dark") === true, String(e.isValid && e.getProperty("observer:dark")));
  obs("abort");
  const v = await waitEvent("fx", (d) => d.what === "vanish", 60, m);
  check("vanish_effect_on_removal", !!v, v ? v.why : "none");
  await endOf("distant_watch", m, 200);
  ow().runCommand("time set noon");
  await wait(20);
  m = mark();
  obs("trigger", "distant_watch", "Tester");
  e = await waitObserver(60);
  if (e) {
    await wait(30);
    const light = ow().getLightLevel({ x: e.location.x, y: e.location.y + 3.6, z: e.location.z });
    check("eyes_dim_at_noon", e.isValid && (e.getProperty("observer:dark") === false || light <= 7), `dark=${e.isValid && e.getProperty("observer:dark")} light=${light}`);
  }
  obs("abort");
  await endOf("distant_watch", m, 200);
  await observerGone(200);
};

TESTS.auto_peek = async () => {
  // something beside it (a wall, a trunk): it leans out from behind it; take it away and it stands normally
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z + 30 });
  isolate(p);
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  const e = await waitObserver(60);
  if (!check("auto_peek_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  p.lookAtLocation({ x: p.location.x - (e.location.x - p.location.x), y: Y + 1.6, z: p.location.z - (e.location.z - p.location.z) });
  const toEye = { x: p.location.x - e.location.x, z: p.location.z - e.location.z };
  const len = Math.hypot(toEye.x, toEye.z);
  const side = { x: -toEye.z / len, z: toEye.x / len };
  const col = { x: Math.floor(e.location.x + side.x * 0.9), z: Math.floor(e.location.z + side.z * 0.9) };
  const fy = Math.floor(e.location.y);
  const placed = [];
  for (const h of [1, 2, 3]) {
    const b = ow().getBlock({ x: col.x, y: fy + h, z: col.z });
    if (b && b.isAir) {
      b.setType("minecraft:oak_log");
      placed.push({ x: col.x, y: fy + h, z: col.z });
    }
  }
  let peeked = false;
  for (let t = 0; t < 60 && e.isValid; t += 5) {
    await wait(5);
    if (e.getProperty("observer:state") === "peek") peeked = true;
    if (peeked) break;
  }
  check("auto_peek_leans_out", peeked && placed.length > 0, `state=${e.isValid ? e.getProperty("observer:state") : "gone"} side=${e.isValid ? e.getProperty("observer:side") : "?"} logs=${placed.length}`);
  for (const b of placed) ow().getBlock(b)?.setType("minecraft:air");
  let back = false;
  for (let t = 0; t < 60 && e.isValid; t += 5) {
    await wait(5);
    if (e.getProperty("observer:state") === "watch") back = true;
    if (back) break;
  }
  check("auto_peek_stands_without_cover", back, `state=${e.isValid ? e.getProperty("observer:state") : "gone"}`);
  obs("abort");
  await endOf("distant_watch", m, 200);
  await observerGone(200);
};

TESTS.lunge = async () => {
  // stage 3+, seen: it shrieks, comes at you in jerks and tears apart in front of you (no damage below High)
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 4);
  const dmg = trackDamage(p);
  obs("lunge", "always");
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  const e = await waitObserver(60);
  if (!check("lunge_body", !!e, (since(m, "end")[0] || {}).outcome)) {
    obs("lunge", "never");
    dmg.stop();
    return;
  }
  const d0 = hdist(e.location, p.location);
  let minD = d0;
  for (let t = 0; t < 20 * 12 && e.isValid; t += 2) {
    p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
    minD = Math.min(minD, hdist(e.location, p.location));
    await wait(2);
  }
  const end = await endOf("distant_watch", m, 200);
  dmg.stop();
  obs("lunge", "never");
  check("lunge_charged", !!since(m, "lunge")[0] && minD < 5, `from ${d0.toFixed(1)} to ${minD.toFixed(1)} blocks`);
  check("lunge_tore_apart", since(m, "fx").some((d) => d.what === "vanish" && d.why === "lunge"), JSON.stringify(since(m, "fx")));
  check("lunge_outcome_harmless", end && end.outcome === "lunged" && dmg.total === 0, `${end ? end.outcome : "none"} damage=${dmg.total}`);
  await observerGone(200);
};

TESTS.creeping_held = async () => {
  // Closer Each Time: it moves only while unwatched; held in view for 8 s it backs off
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 4);
  isolate(p);
  ow().runCommand("time set midnight");
  const m = mark();
  obs("trigger", "creeping", "Tester");
  const e = await waitObserver(120);
  if (!check("creeping_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  // watched: it does not move
  const l0 = { ...e.location };
  await lookAtObserverFor(p, 40);
  check("creeping_frozen_while_watched", e.isValid && hdist(e.location, l0) < 0.3, e.isValid ? `moved ${hdist(e.location, l0).toFixed(2)}` : "gone");
  // look away: it is closer
  const d0 = hdist(e.location, p.location);
  p.lookAtLocation({ x: p.location.x - (e.location.x - p.location.x), y: Y + 1.6, z: p.location.z - (e.location.z - p.location.z) });
  const c = await waitEvent("creep", () => true, 60, m);
  check("creeping_closer_when_unwatched", !!c && c.d < d0, c ? `${d0.toFixed(1)} -> ${c.d.toFixed(1)}` : "did not move");
  // hold its gaze
  await lookAtObserverFor(p, 200);
  const end = await endOf("creeping", m, 300);
  check("creeping_stared_down", end && end.outcome === "stared_down", end ? end.outcome : "none");
  check("creeping_held_gaze_discovery", discovered(m, "held_gaze"));
  ow().runCommand("time set noon");
  await observerGone(200);
};

TESTS.creeping_reaches = async () => {
  obs("set", "aggression", "1");
  // never looked at: it reaches the player and strikes (telegraphed); the strike never kills
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 4);
  isolate(p);
  ow().runCommand("time set midnight");
  const dmg = trackDamage(p);
  const m = mark();
  obs("trigger", "creeping", "Tester");
  const e = await waitObserver(120);
  if (!check("creeping_reaches_body", !!e, (since(m, "end")[0] || {}).outcome)) {
    dmg.stop();
    return;
  }
  // look the other way the whole time
  for (let t = 0; t < 20 * 40 && e.isValid; t += 4) {
    p.lookAtLocation({ x: p.location.x - (e.location.x - p.location.x), y: Y + 1.6, z: p.location.z - (e.location.z - p.location.z) });
    await wait(4);
  }
  const end = await endOf("creeping", m, 300);
  dmg.stop();
  const moves = since(m, "creep").length;
  check("creeping_reaches_outcome", end && (end.outcome === "struck" || end.outcome === "dodged"), `${end ? end.outcome : "none"} moves=${moves}`);
  check("creeping_reaches_nonlethal", dmg.minHp >= 1, `damage ${dmg.total} lowest hp ${dmg.minHp}`);
  ow().runCommand("time set noon");
  await observerGone(200);
  obs("preset", "standard");
};

TESTS.test_entries = async () => {
  // Config Wheel → Test an encounter: the single behaviours (strike, lunge, peek, vigil practice) run on demand
  let p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 1);
  isolate(p);
  // the strike: it runs up and strikes (Low aggression: one capped strike)
  obs("set", "aggression", "1");
  let dmg = trackDamage(p);
  let m = mark();
  obs("trigger", "test_strike", "Tester");
  let end = await endOf("test_strike", m, 20 * 25);
  dmg.stop();
  check("test_strike_outcome", end && (end.outcome === "struck" || end.outcome === "dodged"), `${end ? end.outcome : "none"} damage=${dmg.total}`);
  check("test_strike_nonlethal", dmg.minHp >= 1 || dmg.total === 0, `lowest hp ${dmg.minHp}`);
  obs("preset", "standard");
  await observerGone(100);
  // the lunge: look at it and it comes at you, then tears apart (no damage below High)
  p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 1);
  dmg = trackDamage(p);
  m = mark();
  obs("trigger", "test_lunge", "Tester");
  const e = await waitObserver(60);
  for (let t = 0; t < 20 * 14 && e && e.isValid; t += 2) {
    p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
    await wait(2);
  }
  end = await endOf("test_lunge", m, 200);
  dmg.stop();
  check("test_lunge_outcome", end && end.outcome === "lunged" && !!since(m, "lunge")[0] && dmg.total === 0, `${end ? end.outcome : "none"} damage=${dmg.total}`);
  await observerGone(100);
  // peeking: beside a trunk in front of the player it leans out
  p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 1);
  const trunk = [];
  for (const h of [0, 1, 2, 3]) {
    const b = { x: FIELD.x + 1, y: Y + h, z: FIELD.z - 9 };
    if (ow().getBlock(b)?.isAir) {
      ow().getBlock(b).setType("minecraft:oak_log");
      trunk.push(b);
    }
  }
  m = mark();
  obs("trigger", "test_peek", "Tester");
  const pe = await waitObserver(60);
  let peeked = false;
  for (let t = 0; t < 40 && pe && pe.isValid; t += 4) {
    if (pe.getProperty("observer:state") === "peek") peeked = true;
    await wait(4);
  }
  check("test_peek_leans_out", peeked, pe ? `state=${pe.isValid ? pe.getProperty("observer:state") : "gone"}` : "no body");
  end = await endOf("test_peek", m, 300);
  check("test_peek_outcome", end && end.outcome === "shown", end ? end.outcome : "none");
  for (const b of trunk) ow().getBlock(b)?.setType("minecraft:air");
  await observerGone(100);
  // with nothing to hide behind it does not peek at all: the test says what it needs instead
  p.teleport({ x: 1104.5, y: Y, z: 1012.5 }, { facingLocation: { x: 1104.5, y: Y + 1.6, z: 1040 } }); // open platform ahead
  await wait(10);
  m = mark();
  obs("trigger", "test_peek", "Tester");
  end = await endOf("test_peek", m, 100);
  check("test_peek_needs_cover", end && end.outcome === "deferred" && !since(m, "body").some((d) => d.what === "spawn"), end ? end.outcome : "none");
  await observerGone(100);
  // the vigil practice: three rounds, then nothing recorded and no reward
  p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 1);
  ow().runCommand("time set midnight");
  const eyesBefore = countItem(p, "observer:observers_eye");
  m = mark();
  obs("trigger", "vigil_practice", "Tester");
  let seenId = "";
  for (let t = 0; t < 20 * 150; t += 4) {
    const o = observerEntity();
    if (o && o.isValid) {
      if (seenId !== o.id) {
        seenId = o.id;
        p.teleport({ x: o.location.x + 6, y: o.location.y, z: o.location.z }, { facingLocation: { x: o.location.x, y: o.location.y + 2.2, z: o.location.z } });
      }
      p.lookAtLocation({ x: o.location.x, y: o.location.y + 2.2, z: o.location.z });
    }
    await wait(4);
    if (since(m, "end").some((d) => d.type === "vigil_practice")) break;
  }
  end = since(m, "end").find((d) => d.type === "vigil_practice");
  check("vigil_practice_outcome", end && (end.outcome === "practice_done" || end.outcome === "failed"), end ? end.outcome : "none");
  check("vigil_practice_no_reward", countItem(p, "observer:observers_eye") === eyesBefore && !since(m, "discovery").some((d) => d.id === "witnessed"),
    `eyes ${eyesBefore} -> ${countItem(p, "observer:observers_eye")}`);
  ow().runCommand("time set noon");
  ow().runCommand("weather clear");
  await observerGone(200);
};

TESTS.relentless = async () => {
  // Standard aggression: once it reaches you it keeps striking (until you die); the Witness Lens drives it off
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 1);
  isolate(p);
  p.setItem(new ItemStack("observer:witness_lens", 1), 1, true);
  const dmg = trackDamage(p);
  const m = mark();
  obs("trigger", "test_strike", "Tester");
  // stay alive (healed every 4 ticks) and let it attack for ~7 s
  let hits = 0;
  for (let t = 0; t < 20 * 14; t += 4) {
    heal(p);
    hits = since(m, "relentless").filter((d) => d.result === "hit").length;
    if (hits >= 3) break;
    await wait(4);
  }
  check("relentless_keeps_striking", hits >= 3, `hits=${hits} damage=${dmg.total}`);
  check("relentless_full_strength", since(m, "strike").filter((d) => d.result === "hit").length >= 3 && dmg.total >= 6 * 3, `damage ${dmg.total}`);
  // drive it off with the lens
  const e = observerEntity();
  for (let t = 0; t < 40 && e && e.isValid; t += 4) {
    heal(p);
    p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
    await wait(2);
    p.useItemInSlot(1);
    await wait(2);
    if (since(m, "end").some((d) => d.type === "test_strike")) break;
  }
  const end = await endOf("test_strike", m, 200);
  dmg.stop();
  check("relentless_lens_drives_it_off", end && end.outcome === "repelled", end ? end.outcome : "none");
  await observerGone(100);
};

TESTS.near_vanish = async () => {
  // walk right up to it: it tears apart before you reach it (no strike below stage 2)
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 1);
  isolate(p);
  const m = mark();
  obs("trigger", "test_near", "Tester");
  const e = await waitObserver(60);
  if (!check("near_vanish_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  await wait(20);
  const at = { ...e.location };
  p.teleport({ x: at.x + (p.location.x - at.x) * 0.3, y: Y, z: at.z + (p.location.z - at.z) * 0.3 }, { facingLocation: { x: at.x, y: Y + 3, z: at.z } });
  const t0 = system.currentTick;
  const end = await endOf("test_near", m, 60);
  check("near_vanish_quickly", end && end.outcome === "too_close" && system.currentTick - t0 <= 30, `${end ? end.outcome : "none"} after ${system.currentTick - t0} ticks`);
  check("near_vanish_effect", since(m, "fx").some((d) => d.what === "vanish" && d.why === "too_close"), JSON.stringify(since(m, "fx")));
  await observerGone(100);
};

TESTS.near_strike = async () => {
  // sometimes, instead, it steps in and strikes once (forced here; in play ~30 %, at most every 75 s)
  obs("set", "aggression", "1");
  obs("nearstrike", "always");
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 3);
  isolate(p);
  const dmg = trackDamage(p);
  const m = mark();
  obs("trigger", "test_near", "Tester");
  const e = await waitObserver(60);
  if (e) {
    await wait(20);
    const at = { ...e.location };
    p.teleport({ x: at.x + (p.location.x - at.x) * 0.3, y: Y, z: at.z + (p.location.z - at.z) * 0.3 }, { facingLocation: { x: at.x, y: Y + 3, z: at.z } });
  }
  const end = await endOf("test_near", m, 100);
  dmg.stop();
  obs("nearstrike", "auto");
  obs("preset", "standard");
  check("near_strike_struck", end && (end.outcome === "struck_close" || end.outcome === "dodged_close"), `${end ? end.outcome : "none"} damage=${dmg.total}`);
  check("near_strike_then_gone", since(m, "fx").some((d) => d.what === "vanish" && d.why === "too_close"));
  await observerGone(100);
};

TESTS.illusion = async () => {
  // a shadow far off; the moment the player looks at it, it is gone (with a cave noise for them)
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 1);
  isolate(p);
  const m = mark();
  obs("illusion", "Tester");
  await wait(4);
  const sh = ow().getEntities({ type: "observer:shadow" })[0];
  if (!check("illusion_shadow_placed", !!sh, JSON.stringify(since(m, "illusion")))) return;
  const d = hdist(sh.location, p.location);
  check("illusion_far_off", d >= 25 && d <= 66, `d=${d.toFixed(1)}`);
  check("illusion_not_the_observer", !observerEntity(), "a real body is present");
  await wait(20);
  check("illusion_waits_unseen", sh.isValid);
  p.lookAtLocation({ x: sh.location.x, y: sh.location.y + 2.2, z: sh.location.z });
  const t0 = system.currentTick;
  const seen = await waitEvent("illusion", (x) => x.what === "seen", 20, m);
  check("illusion_vanishes_when_seen", !!seen && !sh.isValid && system.currentTick - t0 <= 6, `after ${system.currentTick - t0} ticks`);
  check("illusion_no_burst", !since(m, "fx").some((x) => x.what === "vanish"));
};

TESTS.illusion_taiga = async () => {
  // only in taiga forests: one comes in the (taiga) arena; none in a non-taiga area far away
  obs("set", "illusions", "true");
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 }, 1);
  isolate(p);
  const here = ow().getBiome(p.location)?.id ?? "?";
  let m = mark();
  if (/taiga/.test(here)) {
    obs("timewarp", "400"); // past any cooldown left by the previous shadow test
    const sp = await waitEvent("illusion", (x) => x.what === "spawn", 120, m);
    check("illusion_in_taiga", !!sp, `biome=${here}`);
  } else log(`[OTEST] SKIP illusion_in_taiga arena biome is ${here}`);
  for (const e of ow().getEntities({ type: "observer:shadow" })) e.remove();
  // look for a loaded non-taiga area far away, stand the player there on a small platform
  let found;
  for (const x of [3000, 6000, -3000, 9000, -6000]) {
    ow().runCommand(`tickingarea add ${x - 8} 0 992 ${x + 8} 0 1008 otest_biome`);
    await wait(60);
    const b = ow().getBiome({ x, y: 64, z: 1000 })?.id ?? "?";
    if (!/taiga/.test(b)) {
      found = { x, b };
      break;
    }
    ow().runCommand("tickingarea remove otest_biome");
  }
  if (!found) {
    log("[OTEST] SKIP illusion_none_outside_taiga no non-taiga area found");
  } else {
    ow().runCommand(`fill ${found.x - 3} ${Y - 1} 997 ${found.x + 3} ${Y - 1} 1003 stone`);
    p.teleport({ x: found.x + 0.5, y: Y, z: 1000.5 });
    await wait(20);
    m = mark();
    obs("timewarp", "600");
    await wait(80);
    check("illusion_none_outside_taiga", !since(m, "illusion").some((x) => x.what === "spawn"), `biome=${found.b}`);
    ow().runCommand("tickingarea remove otest_biome");
  }
  p.teleport({ x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 });
  obs("set", "illusions", "false");
  obs("preset", "standard");
  await wait(20);
};

TESTS.withdraw_walks = async () => {
  // noticed and still watched: it walks away (scripted steps) and unravels only after a while
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 });
  const m = mark();
  obs("trigger", "distant_watch", "Tester");
  const e = await waitObserver(60);
  if (!check("withdraw_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  const l0 = { ...e.location };
  let maxD = 0;
  for (let t = 0; t < 20 * 25 && e.isValid; t += 2) {
    p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
    maxD = Math.max(maxD, hdist(e.location, l0));
    await wait(2);
  }
  await wait(4);
  const gone = since(m, "body").find((d) => d.what === "remove");
  check("withdraw_walks_away", maxD > 4, `moved ${maxD.toFixed(1)} blocks while watched`);
  check("withdraw_removed", !e.isValid, gone ? gone.why : "still there");
};

TESTS.seal_occupied = async () => {
  // a second player standing where the seal goes is never sealed in
  obs("restore");
  ow().runCommand(`fill ${TUNNEL.x0} ${TUNNEL.y} ${TUNNEL.z0} ${TUNNEL.x1} ${TUNNEL.y + 2} ${TUNNEL.z1} air replace observer:veil`);
  const p = await freshTarget("Tester", { x: 930.5, y: TUNNEL.y, z: 1085.5 }, { x: 958, y: TUNNEL.y + 1.6, z: 1085.5 });
  const f = spawn("Friend", { x: 927.5, y: TUNNEL.y, z: 1085.5 });
  f.teleport({ x: 927.5, y: TUNNEL.y, z: 1085.5 }, { facingLocation: { x: 958, y: TUNNEL.y + 1.6, z: 1085.5 } });
  heal(f);
  await wait(10);
  const m = mark();
  obs("trigger", "closed_path", "Tester");
  await waitEvent("ledger", (d) => d.what === "change" && d.kind === "veil", 200, m);
  await wait(10);
  const veils = since(m, "ledger").filter((d) => d.what === "change" && d.kind === "veil");
  const fx = Math.floor(f.location.x), fy = Math.floor(f.location.y), fz = Math.floor(f.location.z);
  const sealedIn = veils.filter((v) => v.x === fx && v.z === fz && (v.y === fy || v.y === fy + 1));
  check("seal_occupied_some_sealed", veils.length > 0, `veils=${veils.length}`);
  check("seal_occupied_friend_free", sealedIn.length === 0 && ow().getBlock(f.getHeadLocation())?.typeId !== "observer:veil",
    `friend at ${fx},${fy},${fz}; veil cells ${veils.map((v) => `${v.x},${v.y},${v.z}`).join(" ")}`);
  obs("abort");
  await endOf("closed_path", m, 300);
  f.disconnect();
  await wait(100);
};

TESTS.mp_fairness = async () => {
  // two creative players who have waited longer must not block a survival player
  const builders = [];
  for (const [i, name] of ["Builder1", "Builder2"].entries()) {
    const b = await freshTarget(name, { x: 905.5 + i * 3, y: Y, z: 1035.5 }, { x: 905.5, y: Y + 1.6, z: 1000 });
    b.setGameMode(GameMode.Creative);
    builders.push(b);
  }
  await wait(200);
  const p = await freshTarget("Tester", { x: 950.5, y: Y, z: 1000.5 }, { x: 950.5, y: Y + 1.6, z: 960 }, 1);
  const m = mark();
  obs("pause", "off");
  const st = await waitEvent("start", (d) => !d.forced, 20 * 90, m);
  obs("pause");
  check("mp_fairness_survival_served", !!st && st.target === "Tester", st ? `${st.target}: ${st.type}` : "no encounter started");
  obs("abort");
  for (const b of builders) b.disconnect();
  await wait(200);
};

TESTS.animals = async () => {
  const p = await freshTarget("Tester", { x: 950.5, y: Y, z: 1000.5 }, { x: 950.5, y: Y + 1.6, z: 980 });
  const cows = [];
  for (let i = 0; i < 4; i++) cows.push(ow().spawnEntity("minecraft:cow", { x: 945.5 + i * 3, y: Y, z: 1006.5 }));
  await wait(20);
  obs("animals", "Tester");
  await wait(30);
  const target = { x: 950.5, y: Y, z: 980.5 };
  const facing = cows.filter((c) => {
    const yaw = c.getRotation().y;
    const want = (Math.atan2(-(target.x - c.location.x), target.z - c.location.z) * 180) / Math.PI;
    let d = Math.abs(((yaw - want) % 360 + 540) % 360 - 180);
    return d < 25;
  }).length;
  check("animals_face_it", facing >= 3, `${facing}/4 cows facing the point`);
  for (const c of cows) c.remove();
};

TESTS.pursuit_water_escape = async () => {
  ow().runCommand("time set midnight");
  // stand at the field's edge facing west; the pool lies 6 blocks behind
  const p = await freshTarget("Tester", { x: 989.5, y: Y, z: 1000.5 }, { x: 950, y: Y + 1.6, z: 1000.5 });
  const m = mark();
  obs("trigger", "pursuit", "Tester");
  const e = await waitObserver(200);
  if (!check("pursuit_water_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  await wait(70);
  // turn and get into the water
  p.lookAtLocation({ x: 1030, y: Y, z: 1000.5 });
  for (let t = 0; t < 80; t += 4) {
    p.moveToLocation({ x: 1003.5, y: Y - 1, z: 1000.5 });
    await wait(4);
  }
  p.stopMoving();
  const end = await endOf("pursuit", m, 600);
  check("pursuit_water_escaped", end && end.outcome === "escaped_water", end ? end.outcome : "none");
  // it floats to the water's edge and hovers there (on dry ground, never over the water)
  const sh = since(m, "shore")[0];
  const dry = sh && ow().getBlock({ x: sh.x, y: sh.y - 1, z: sh.z });
  check("pursuit_hovers_at_shore", !!sh && !!dry && !dry.isLiquid && sh.x < POOL.x0 + 1, sh ? `${sh.x.toFixed(1)},${sh.z.toFixed(1)} on ${dry?.typeId}` : "no shore");
  check("pursuit_water_discovery", discovered(m, "breathing_room"));
  p.teleport({ x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 });
  ow().runCommand("time set noon");
  await observerGone(300);
};

TESTS.closed_path_light = async () => {
  const r = await tunnelRun("closed_path_light", async (p) => {
    // bring light: glowstone around the player's feet (player light >= 11)
    const l = { x: Math.floor(p.location.x), y: TUNNEL.y, z: Math.floor(p.location.z) };
    ow().runCommand(`setblock ${l.x} ${TUNNEL.y + 2} ${l.z} glowstone`);
    ow().runCommand(`setblock ${l.x - 1} ${TUNNEL.y + 2} ${l.z} glowstone`);
  });
  const end = await endOf("closed_path", r.m, 900);
  check("closed_path_light_outcome", end && end.outcome === "repelled_by_light", end ? end.outcome : "none");
  check("closed_path_light_discovery", discovered(r.m, "light_it_doesnt_make"));
  ow().runCommand(`fill ${TUNNEL.x0} ${TUNNEL.y + 2} ${TUNNEL.z0} ${TUNNEL.x1} ${TUNNEL.y + 2} ${TUNNEL.z1} air replace glowstone`);
  await wait(200);
};

TESTS.bearing_three = async () => {
  const p = await freshTarget("Tester", { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 }, { x: FIELD.x, y: Y + 1.6, z: FIELD.z - 30 });
  const m = mark();
  let caught = 0;
  for (let i = 0; i < 3; i++) {
    obs("timewarp", "900");
    p.teleport({ x: FIELD.x + 0.5 - i * 12, y: Y, z: FIELD.z + 0.5 }, { facingLocation: { x: FIELD.x - i * 12, y: Y + 1.6, z: FIELD.z - 30 } });
    await wait(10);
    const mi = mark();
    obs("trigger", "mirror_bearing", "Tester");
    const e = await waitObserver(120);
    if (!e) continue;
    await lookAtObserverFor(p, 30);
    const end = await endOf("mirror_bearing", mi, 300);
    if (end && end.outcome === "noticed") caught++;
    await observerGone(300);
  }
  check("bearing_three_catches", caught === 3, `caught=${caught}`);
  check("bearing_three_discovery", discovered(m, "behind_left"));
};

// ------------------------------------------------------------------ 1.0.5
const lastEvent = (from, kind, pred = () => true) => events.slice(from).filter((e) => e.kind === kind && pred(e.data)).pop();
const firstEvent = (from, kind, pred = () => true) => events.slice(from).find((e) => e.kind === kind && pred(e.data));
const FACE_N = { x: FIELD.x + 0.5, y: Y + 1.6, z: FIELD.z - 30 };
const AT_FIELD = { x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 };
function lightNear(loc, r = 1) {
  const b = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
    const blk = ow().getBlock({ x: b.x + dx, y: b.y + dy, z: b.z + dz });
    if (blk && blk.typeId === "minecraft:light_block_15") return blk.location;
  }
  return undefined;
}

TESTS.flare = async () => {
  // a thrown flare flies, lights where it lands (a real light), drives it off, and burns out
  await flaresOut();
  const p = await freshTarget("Tester", AT_FIELD, FACE_N, 3);
  isolate(p);
  obs("unlearn", "Tester");
  p.setItem(new ItemStack("observer:flare", 4), 2, true);
  const m = mark();
  obs("trigger", "test_flare", "Tester");
  const e = await waitObserver(60);
  if (!check("flare_body", !!e, (since(m, "end")[0] || {}).outcome)) return;
  await wait(10);
  p.lookAtLocation({ x: e.location.x, y: e.location.y + 3, z: e.location.z });
  await wait(2);
  const from = p.location;
  p.useItemInSlot(2);
  const thrown = await waitEvent("flare", (d) => d.what === "thrown", 40, m);
  check("flare_thrown", !!thrown);
  const lit = await waitEvent("flare", (d) => d.what === "lit", 60, m);
  check("flare_lights_where_it_lands", !!lit && lit.light, lit ? `light=${lit.light} ${dist(lit, from).toFixed(1)} blocks from the thrower` : "never lit");
  check("flare_flies", !!lit && dist(lit, from) >= 4, lit ? `${dist(lit, from).toFixed(1)} blocks` : "");
  check("flare_used_up", countItem(p, "observer:flare") === 3, String(countItem(p, "observer:flare")));
  const lb = lit ? lightNear(lit) : undefined;
  check("flare_real_light", !!lb && ow().getLightLevel({ x: lb.x + 0.5, y: lb.y + 0.5, z: lb.z + 0.5 }) >= 14, lb ? `level ${ow().getLightLevel({ x: lb.x + 0.5, y: lb.y + 0.5, z: lb.z + 0.5 })}` : "no light block");
  const end = await endOf("test_flare", m, 100);
  check("flare_drives_it_off", end && end.outcome === "flared", end ? end.outcome : "none");
  check("flare_tears_it_apart", await observerGone(40) && since(m, "fx").some((d) => d.what === "vanish"));
  const out = await waitEvent("flare", (d) => d.what === "out", 220, m);
  await wait(4);
  check("flare_burns_out_light_goes", !!out && (!lit || !lightNear(lit)), out ? "" : "never burnt out");
  check("flare_entity_removed", ow().getEntities({ type: "observer:flare" }).length === 0);
};

TESTS.flare_mid_attack = async () => {
  // it works even mid-attack: a strike already winding up does no damage
  await flaresOut();
  const p = await freshTarget("Tester", AT_FIELD, FACE_N, 3);
  isolate(p);
  obs("unlearn", "Tester");
  obs("set", "aggression", "2");
  const m = mark();
  obs("trigger", "test_strike", "Tester");
  // wait until it is on the player (the relentless strikes)
  const st = await waitEvent("strike", () => true, 20 * 15, m);
  if (!check("flare_attack_reached", !!st)) {
    obs("preset", "standard");
    return;
  }
  heal(p);
  const dmg = trackDamage(p);
  await wait(4); // the next wind-up has begun
  const m2 = mark();
  obs("flare", "1", "Tester");
  const end = await endOf("test_strike", m, 60);
  await wait(30);
  dmg.stop();
  check("flare_mid_attack_ends_it", end && end.outcome === "flared", end ? end.outcome : "none");
  check("flare_mid_attack_no_damage_after", dmg.total === 0 || !since(m2, "strike").some((d) => d.result === "hit"), `damage after flare ${dmg.total}`);
  obs("preset", "standard");
  await observerGone(100);
};

TESTS.learning = async () => {
  // it adapts to the way a player escapes, one way at a time, and writes it down
  await flaresOut(); // the previous test's flare would use up the one flinch
  const p = await freshTarget("Tester", AT_FIELD, FACE_N, 4);
  isolate(p);
  obs("unlearn", "Tester");
  obs("page", "name", "Tester"); // the player has Field Notes
  await wait(5);
  let m = mark();
  obs("learn", "flare", "2", "Tester");
  await wait(5);
  check("learning_needs_three", !since(m, "learn").some((d) => d.what === "adapt"));
  obs("learn", "flare", "1", "Tester");
  const ad = await waitEvent("learn", (d) => d.what === "adapt", 20, m);
  check("learning_adapts_after_three", ad && ad.method === "flare", ad ? ad.method : "none");
  const pg = await waitEvent("page", (d) => d.key === "learn_flare", 40, m);
  check("learning_written_in_notes", !!pg, pg ? pg.key : "no page");
  // the first flare in an encounter only makes it flinch; the second works
  m = mark();
  obs("trigger", "test_flare", "Tester");
  const e = await waitObserver(60);
  if (e) {
    await wait(10);
    obs("flare", "3", "Tester");
    const sh = await waitEvent("learn", (d) => d.what === "shrug" && d.kind === "flare", 40, m);
    await wait(20);
    check("learning_flare_flinch_only", !!sh && !!observerEntity() && !since(m, "end").some((d) => d.type === "test_flare"), sh ? "" : "no shrug");
    // the flinch put it further back: light the second flare a few blocks short of where it now stands
    obs("flare", String(Math.max(2, Math.floor(hdist(e.location, p.location) - 4))), "Tester");
    const end = await endOf("test_flare", m, 80);
    check("learning_second_flare_works", end && end.outcome === "flared", end ? end.outcome : "none");
  } else check("learning_flare_body", false);
  obs("abort");
  await observerGone(100);
  // a burning flare drives off anything that arrives near it: let both burn out first
  await flaresOut();
  // one way at a time: leaning on another way switches it, the old one wears off
  m = mark();
  obs("learn", "light", "4", "Tester");
  const ad2 = await waitEvent("learn", (d) => d.what === "adapt", 20, m);
  check("learning_one_at_a_time", ad2 && ad2.method === "light", ad2 ? ad2.method : "none");
  // adapted to light: before it comes, it puts out the lights near the player
  ow().getBlock({ x: FIELD.x + 2, y: Y, z: FIELD.z }).setPermutation(BlockPermutation.resolve("minecraft:torch", { torch_facing_direction: "top" }));
  ow().runCommand("time set midnight");
  m = mark();
  obs("trigger", "creeping", "Tester");
  const sn = await waitEvent("ledger", (d) => d.what === "change" && d.kind === "light", 60, m);
  check("learning_light_snuffs_first", !!sn, sn ? `${sn.x},${sn.y},${sn.z}` : "no light put out");
  // real encounters teach it: a flare ending a real encounter is counted
  const sp = await waitEvent("body", (d) => d.what === "spawn", 100, m);
  const e2 = sp ? observerEntity() : undefined;
  if (e2 && e2.isValid) {
    await wait(10);
    // a flare a few blocks short of it (before an 8 s stare would end it another way)
    if (e2.isValid) obs("flare", String(Math.max(2, Math.floor(hdist(e2.location, p.location) - 4))), "Tester");
  }
  const end2 = await endOf("creeping", m, 20 * 15);
  const note = since(m, "learn").find((d) => d.what === "note");
  check("learning_counts_real_escapes", end2 && end2.outcome === "flared" && note && note.method === "flare", `${end2 ? end2.outcome : "none"} ${note ? note.method : "no note"}`);
  // switched off: no adaptation in force
  obs("set", "learning", "false");
  m = mark();
  obs("learn", "water", "5", "Tester");
  await wait(5);
  check("learning_switch_off", !since(m, "learn").some((d) => d.what === "adapt"));
  obs("set", "learning", "true");
  obs("unlearn", "Tester");
  obs("abort");
  ow().runCommand("time set noon");
  ow().getBlock({ x: FIELD.x + 2, y: Y, z: FIELD.z }).setType("minecraft:air");
  obs("restore");
  await observerGone(200);
};

TESTS.hush = async () => {
  // stage 4+: before a dangerous encounter the music stops (for that player) and it is quiet 20-30 s
  const p = await freshTarget("Tester", AT_FIELD, FACE_N, 4);
  isolate(p);
  const others = ["distant_watch", "extra_step", "home_visit", "closed_path", "borrowed_sound", "turned_object", "door_ajar", "snuffed_lights",
    "mirror_bearing", "echo_ahead", "unfamiliar_route", "close_breath", "pursuit", "window_watch", "second_witness", "night_visit", "portal_follow",
    "inside", "sign", "borrowed_eyes"];
  obs("set", "off", others.join(","));
  obs("set", "frequency", "2");
  obs("hushmode", "real");
  ow().runCommand("time set midnight");
  let m = mark();
  obs("pause", "off");
  await waitEvent("hush", (d) => d.what === "start", 20 * 60, m);
  const hs = firstEvent(m, "hush", (d) => d.what === "start");
  check("hush_before_attack", hs && hs.data.def === "creeping" && !since(m, "start").some((d) => !d.forced), hs ? `${hs.data.def} ${hs.data.seconds.toFixed(0)}s` : "no silence");
  check("hush_music_call_ok", hs && hs.data.music === true, hs ? String(hs.data.music) : "");
  const st = await waitEvent("start", (d) => d.type === "creeping" && !d.forced, 20 * 40, m);
  const stE = firstEvent(m, "start", (d) => d.type === "creeping");
  const gap = hs && stE ? (stE.tick - hs.tick) / 20 : -1;
  check("hush_then_it_comes", !!st && gap >= 19 && gap <= 33, `after ${gap.toFixed(1)} s`);
  obs("pause", "on");
  obs("abort");
  const he = await waitEvent("hush", (d) => d.what === "end", 200, m);
  check("hush_ends_with_encounter", he && he.why === "encounter_over" && he.music === true, he ? `${he.why} music=${he.music}` : "never ended");
  await observerGone(200);
  // a false alarm: the silence, then nothing
  obs("hushmode", "false");
  obs("timewarp", "1500");
  obs("skipgrace", "Tester");
  m = mark();
  obs("pause", "off");
  const hs2 = await waitEvent("hush", (d) => d.what === "start", 20 * 60, m);
  const he2 = await waitEvent("hush", (d) => d.what === "end", 20 * 40, m);
  obs("pause", "on");
  check("hush_false_alarm", hs2 && hs2.falseAlarm && he2 && he2.why === "false_alarm" && !since(m, "start").some((d) => !d.forced),
    he2 ? he2.why : "no end");
  // switched off: dangerous encounters start without the silence
  obs("set", "quiet", "false");
  obs("timewarp", "1500");
  obs("skipgrace", "Tester");
  m = mark();
  obs("pause", "off");
  const st3 = await waitEvent("start", (d) => !d.forced, 20 * 60, m);
  obs("pause", "on");
  check("hush_switch_off", st3 && st3.type === "creeping" && !since(m, "hush").some((d) => d.what === "start"), st3 ? st3.type : "none");
  obs("abort");
  obs("set", "quiet", "true");
  obs("hushmode", "auto");
  obs("set", "off", "");
  obs("preset", "standard");
  ow().runCommand("time set noon");
  await observerGone(200);
};

TESTS.pages = async () => {
  // pages in another hand, built from what it tracked, at most one per in-game day
  const p = await freshTarget("Tester", AT_FIELD, FACE_N, 2);
  isolate(p);
  obs("tally", "mine", "57", "Tester");
  let m = mark();
  obs("page", "mine", "Tester");
  const pg = await waitEvent("page", () => true, 40, m);
  check("pages_quote_real_numbers", pg && pg.key === "mine" && pg.args[0] === "57", pg ? `${pg.key} ${JSON.stringify(pg.args)}` : "none");
  // on its own: the first page waits a while, then one per in-game day
  m = mark();
  await wait(20 * 22); // the page timer is set on its first look
  obs("timewarp", "2500");
  const auto = await waitEvent("page", () => true, 20 * 25, m);
  check("pages_arrive_on_their_own", !!auto, auto ? auto.key : "none");
  m = mark();
  await wait(20 * 22);
  check("pages_not_more_than_daily", !since(m, "page").length, `${since(m, "page").length} more`);
  obs("set", "pages", "false");
  obs("timewarp", "3000");
  m = mark();
  await wait(20 * 22);
  check("pages_switch_off", !since(m, "page").length);
  obs("set", "pages", "true");
};

TESTS.sign = async () => {
  // a sign by the door of the player's home, put up unseen; it drops nothing and goes after 20 minutes
  obs("restore");
  resetHouse();
  const home = HOUSE.center;
  const p = await freshTarget("Tester", { x: 1066.5, y: Y, z: 1000.5 }, { x: 1020, y: Y + 1.6, z: 1000.5 }, 3);
  isolateFromHouse(p);
  obs("sethaunt", String(home.x), String(home.y), String(home.z), "Tester");
  let m = mark();
  obs("trigger", "sign", "Tester");
  const sg = await waitEvent("sign", () => true, 60, m);
  const end0 = since(m, "end")[0];
  if (!check("sign_placed", !!sg, end0 ? end0.outcome : "")) return dumpHouse("sign");
  const at = { x: sg.x, y: sg.y, z: sg.z };
  const b = ow().getBlock(at);
  const sc = b?.getComponent("minecraft:sign");
  const raw = sc ? sc.getRawText() : undefined;
  check("sign_block_and_text", b?.typeId === "minecraft:standing_sign" && !!raw && /observer\.sign\./.test(JSON.stringify(raw)), `${b?.typeId} ${JSON.stringify(raw)}`);
  check("sign_waxed", !!sc && sc.isWaxed);
  check("sign_by_door", Math.abs(sg.x - HOUSE.door.x) <= 3 && Math.abs(sg.z - HOUSE.door.z) <= 3 && sg.anchor === "door", `${sg.x},${sg.z} ${sg.anchor}`);
  // breaking it drops nothing
  p.teleport({ x: at.x + 2.5, y: Y, z: at.z + 0.5 }, { facingLocation: { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 } });
  await wait(5);
  const items0 = itemsNear(ow(), at, 4);
  p.breakBlock({ x: at.x, y: at.y, z: at.z }, Direction.Up);
  for (let t = 0; t < 120 && ow().getBlock(at)?.typeId !== "minecraft:air"; t += 5) await wait(5);
  p.stopBreakingBlock?.();
  await wait(10);
  check("sign_break_no_drop", ow().getBlock(at)?.typeId === "minecraft:air" && itemsNear(ow(), at, 4) === items0, `${ow().getBlock(at)?.typeId} items ${items0}->${itemsNear(ow(), at, 4)}`);
  obs("abort");
  await wait(10);
  // left alone it goes after 20 minutes
  p.teleport({ x: 1066.5, y: Y, z: 1000.5 }, { facingLocation: { x: 1020, y: Y + 1.6, z: 1000.5 } });
  await wait(5);
  m = mark();
  obs("trigger", "sign", "Tester");
  const sg2 = await waitEvent("sign", () => true, 60, m);
  if (sg2) {
    obs("abort");
    await wait(10);
    const still = ow().getBlock({ x: sg2.x, y: sg2.y, z: sg2.z })?.typeId === "minecraft:standing_sign";
    obs("timewarp", "1250");
    let gone = false;
    for (let t = 0; t < 200 && !gone; t += 10) {
      await wait(10);
      gone = ow().getBlock({ x: sg2.x, y: sg2.y, z: sg2.z })?.typeId === "minecraft:air";
    }
    check("sign_lasts_then_goes", still && gone, `stayed after the encounter=${still} gone after 20 min=${gone}`);
  } else check("sign_second_placed", false);
};

TESTS.inside = async () => {
  // at home at night, in a dark room: it is standing in the corner behind you
  obs("restore");
  resetHouse();
  const H = HOUSE;
  // every light out (earlier tests relight the room with torches of their own)
  ow().runCommand(`fill ${H.x0 + 1} ${Y} ${H.z0 + 1} ${H.x1 - 1} ${Y + 3} ${H.z1 - 1} air replace torch`);
  // close the windows so no sky light gets in
  ow().runCommand(`fill ${H.x0 + 3} ${Y + 1} ${H.z0} ${H.x0 + 5} ${Y + 2} ${H.z0} stonebrick`);
  ow().runCommand(`fill ${H.x0 + 3} ${Y + 1} ${H.z1} ${H.x0 + 5} ${Y + 2} ${H.z1} stonebrick`);
  ow().runCommand("time set midnight");
  const p = await freshTarget("Tester", { x: H.x0 + 2.5, y: Y, z: H.center.z }, { x: H.x0 + 2.5, y: Y + 1.6, z: H.z0 - 10 }, 4);
  isolateFromHouse(p);
  obs("sethaunt", String(H.center.x), String(H.center.y), String(H.center.z), "Tester");
  let m = mark();
  obs("trigger", "inside", "Tester");
  const e = await waitObserver(60);
  if (!check("inside_body", !!e, (since(m, "end")[0] || {}).outcome)) {
    dumpHouse("inside");
    return cleanupHouse();
  }
  const l = e.location;
  const inHouse = l.x > H.x0 && l.x < H.x1 + 1 && l.z > H.z0 && l.z < H.z1 + 1;
  const light = ow().getLightLevel({ x: l.x, y: l.y + 2, z: l.z });
  check("inside_in_the_dark_room", inHouse && light <= 7, `${l.x.toFixed(1)},${l.z.toFixed(1)} light ${light}`);
  // stared at for 2 s it leaves
  await lookAtObserverFor(p, 60);
  let end = await endOf("inside", m, 100);
  check("inside_leaves_when_stared_at", end && end.outcome === "stared", end ? end.outcome : "none");
  check("inside_discovery", discovered(m, "it_was_inside"));
  await observerGone(60);
  // light the room and it is gone
  p.teleport({ x: H.x0 + 2.5, y: Y, z: H.center.z }, { facingLocation: { x: H.x0 + 2.5, y: Y + 1.6, z: H.z0 - 10 } });
  await wait(5);
  m = mark();
  obs("trigger", "inside", "Tester");
  const e2 = await waitObserver(60);
  if (e2) {
    const at = { x: Math.floor(e2.location.x), y: Y, z: Math.floor(e2.location.z) };
    // a torch on the floor right beside it
    let placed = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = ow().getBlock({ x: at.x + dx, y: Y, z: at.z + dz });
      if (!placed && c?.isAir) {
        c.setPermutation(BlockPermutation.resolve("minecraft:torch", { torch_facing_direction: "top" }));
        placed = true;
      }
    }
    end = await endOf("inside", m, 100);
    check("inside_leaves_when_lit", end && end.outcome === "lit_room", end ? end.outcome : "none");
  } else check("inside_body_2", false);
  cleanupHouse();
  await observerGone(60);
  function cleanupHouse() {
    ow().runCommand(`fill ${H.x0 + 1} ${Y} ${H.z0 + 1} ${H.x1 - 1} ${Y} ${H.z1 - 1} air replace torch`);
    ow().runCommand(`fill ${H.x0 + 3} ${Y + 1} ${H.z0} ${H.x0 + 5} ${Y + 2} ${H.z0} glass_pane`);
    ow().runCommand(`fill ${H.x0 + 3} ${Y + 1} ${H.z1} ${H.x0 + 5} ${Y + 2} ${H.z1} glass_pane`);
    ow().runCommand("time set noon");
    resetHouse();
  }
};

TESTS.borrowed_eyes = async () => {
  // a creature ahead stops and follows the player with its head, then walks on
  const p = await freshTarget("Tester", AT_FIELD, FACE_N, 2);
  isolate(p);
  for (const c of ow().getEntities({ type: "minecraft:cow" })) c.remove();
  const cow = ow().spawnEntity("minecraft:cow", { x: FIELD.x + 0.5, y: Y, z: FIELD.z - 11.5 });
  await wait(20);
  const m = mark();
  obs("trigger", "borrowed_eyes", "Tester");
  const st = await waitEvent("borrowed", (d) => d.what === "start", 40, m);
  if (!check("borrowed_host", !!st && st.host === "minecraft:cow", st ? st.host : (since(m, "end")[0] || {}).outcome)) return cow.remove();
  const p0 = cow.location;
  // the player steps aside; its head follows
  p.teleport({ x: FIELD.x + 6.5, y: Y, z: FIELD.z + 0.5 }, { facingLocation: { x: cow.location.x, y: Y + 1, z: cow.location.z } });
  await wait(30);
  const want = Math.atan2(-(p.location.x - cow.location.x), p.location.z - cow.location.z) * 180 / Math.PI;
  let dyaw = Math.abs(((cow.getRotation().y - want) % 360 + 540) % 360 - 180);
  check("borrowed_follows_with_its_head", dyaw < 30, `off by ${dyaw.toFixed(0)} deg`);
  check("borrowed_stands_still", hdist(cow.location, p0) < 1.0, `moved ${hdist(cow.location, p0).toFixed(2)}`);
  const end = await endOf("borrowed_eyes", m, 300);
  await wait(4);
  check("borrowed_lets_go", end && cow.isValid && !cow.getEffect("slowness"), end ? end.outcome : "none");
  cow.remove();
};

TESTS.returns = async () => {
  // something thrown away far from home turns up on the doorstep (the same item, not a copy)
  obs("restore");
  resetHouse();
  const H = HOUSE;
  const p = await freshTarget("Tester", AT_FIELD, FACE_N, 2);
  isolateFromHouse(p);
  obs("sethaunt", String(H.center.x), String(H.center.y), String(H.center.z), "Tester");
  for (const it of ow().getEntities({ type: "minecraft:item", location: AT_FIELD, maxDistance: 12 })) it.remove();
  p.setItem(new ItemStack("minecraft:stick", 1), 0, true);
  await wait(5);
  let m = mark();
  p.dropSelectedItem();
  const tr = await waitEvent("returns", (d) => d.what === "tracked", 20, m);
  check("returns_sees_thrown_item", tr && tr.item === "minecraft:stick", tr ? tr.item : "not tracked");
  // walk home: inside the house, facing away from the door
  p.teleport({ x: H.center.x + 2, y: Y, z: H.center.z }, { facingLocation: { x: H.x1 + 5, y: Y + 1.6, z: H.center.z } });
  await wait(10);
  obs("timewarp", "60");
  const rt = await waitEvent("returned", () => true, 20 * 15, m);
  if (!rt) dumpHouse("returns");
  check("returns_to_doorstep", rt && rt.door && Math.hypot(rt.x - (H.door.x + 0.5), rt.z - (H.door.z + 0.5)) < 2.5, rt ? `${rt.x.toFixed(1)},${rt.z.toFixed(1)} door=${rt.door}` : "nothing returned");
  const moved = tr ? world.getEntity(tr.id) : undefined;
  check("returns_same_item_no_copy", !!moved && moved.isValid && hdist(moved.location, H.door) < 3 && ow().getEntities({ type: "minecraft:item", location: AT_FIELD, maxDistance: 12 }).length === 0,
    moved ? `${moved.location.x.toFixed(1)},${moved.location.z.toFixed(1)}` : "gone");
  if (moved?.isValid) moved.remove();
  // only once per in-game day
  p.teleport(AT_FIELD, { facingLocation: FACE_N });
  p.setItem(new ItemStack("minecraft:stick", 1), 0, true);
  await wait(5);
  m = mark();
  p.dropSelectedItem();
  await wait(10);
  p.teleport({ x: H.center.x + 2, y: Y, z: H.center.z }, { facingLocation: { x: H.x1 + 5, y: Y + 1.6, z: H.center.z } });
  obs("timewarp", "60");
  await wait(20 * 8);
  check("returns_once_a_day", !since(m, "returned").length);
  for (const it of ow().getEntities({ type: "minecraft:item", location: AT_FIELD, maxDistance: 12 })) it.remove();
};

// ------------------------------------------------------------------ 1.0.6: climbing
const PILLAR_TOP = { x: PILLAR.x + 0.5, y: PILLAR.top, z: PILLAR.z + 0.5 };

TESTS.climb_pillar = async () => {
  // up on a 20-block pillar: it comes from below, climbs the face and hangs just under the player
  const p = await freshTarget("Tester", PILLAR_TOP, { x: PILLAR.x + 0.5, y: PILLAR.top + 1.6, z: PILLAR.z - 30 }, 3);
  isolate(p);
  await wait(10);
  const m = mark();
  obs("trigger", "test_climb", "Tester");
  const st = await waitEvent("climb", (d) => d.what === "start", 20 * 15, m);
  if (!check("climb_starts", !!st, (since(m, "end")[0] || {}).outcome)) return;
  const e = observerEntity();
  const climbing = e && e.isValid ? e.getProperty("observer:state") : "gone";
  const cl = await waitEvent("climb", (d) => d.what === "cling", 20 * 10, m);
  const e2 = observerEntity();
  check("climb_reaches_the_top", !!cl && !!e2 && e2.location.y >= PILLAR.top - 2.5 && hdist(e2.location, p.location) <= 1.6,
    e2 ? `y ${e2.location.y.toFixed(1)} (player ${p.location.y.toFixed(1)}) h ${hdist(e2.location, p.location).toFixed(2)}` : "no body");
  check("climb_animation_state", climbing === "climb", String(climbing));
  const end = await endOf("test_climb", m, 200);
  check("climb_test_outcome", end && end.outcome === "climbed", end ? end.outcome : "none");
  await observerGone(100);
};

TESTS.climb_attack = async () => {
  // pillaring up during its attack does not save you: it climbs after you and strikes from the wall
  obs("set", "aggression", "2");
  const base = { x: PILLAR.x - 1.5, y: Y, z: PILLAR.z + 0.5 };
  const p = await freshTarget("Tester", base, { x: PILLAR.x - 30, y: Y + 1.6, z: PILLAR.z + 0.5 }, 3);
  isolate(p);
  const m = mark();
  obs("trigger", "test_strike", "Tester");
  const s1 = await waitEvent("strike", () => true, 20 * 15, m);
  if (!check("climb_attack_reached", !!s1)) {
    obs("preset", "standard");
    return;
  }
  // up the pillar
  heal(p);
  p.teleport(PILLAR_TOP, { facingLocation: { x: PILLAR.x - 30, y: PILLAR.top + 1.6, z: PILLAR.z + 0.5 } });
  const m2 = mark();
  const dmg = trackDamage(p);
  const cl = await waitEvent("climb", (d) => d.what === "cling", 20 * 12, m2);
  const hit = await waitEvent("strike", (d) => d.result === "hit", 20 * 8, m2);
  dmg.stop();
  check("climb_attack_climbs_after_you", !!cl, cl ? `hangs at y ${cl.y.toFixed(1)} (player ${PILLAR.top})` : "never climbed");
  check("climb_attack_strikes_from_the_wall", !!hit && dmg.total > 0, hit ? `damage ${dmg.total}` : "no hit");
  obs("abort");
  obs("preset", "standard");
  p.teleport({ x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 });
  await observerGone(200);
};

TESTS.climb_over = async () => {
  // further back from the edge (the middle of the house roof): it climbs the wall and comes over the top
  obs("restore");
  resetHouse();
  const H = HOUSE;
  const roof = { x: H.center.x, y: Y + 5, z: H.center.z };
  const p = await freshTarget("Tester", roof, { x: H.center.x + 20, y: Y + 6.6, z: H.center.z }, 3);
  isolateFromHouse(p);
  const m = mark();
  obs("trigger", "test_climb", "Tester");
  const over = await waitEvent("climb", (d) => d.what === "over", 20 * 20, m);
  check("climb_over_the_top", !!over && over.y >= Y + 4.9, over ? `onto the roof at ${over.x.toFixed(1)},${over.y.toFixed(1)},${over.z.toFixed(1)}` : (since(m, "end")[0] || {}).outcome);
  const end = await endOf("test_climb", m, 20 * 20);
  check("climb_over_reaches_you", end && (end.outcome === "reached" || end.outcome === "climbed"), end ? end.outcome : "none");
  p.teleport({ x: FIELD.x + 0.5, y: Y, z: FIELD.z + 0.5 });
  await observerGone(100);
};

TESTS.float_test_entry = async () => {
  // Config Wheel → Test an encounter → The floating chase: harmless, ends 3 blocks short
  const p = await freshTarget("Tester", AT_FIELD, FACE_N, 3);
  isolate(p);
  const dmg = trackDamage(p);
  const m = mark();
  obs("trigger", "test_float", "Tester");
  const e = await waitObserver(60);
  if (!check("float_entry_body", !!e)) return;
  p.lookAtLocation({ x: p.location.x, y: Y + 1.6, z: p.location.z + 30 }); // look away: it surges
  let surged = false;
  for (let t = 0; t < 60 && e.isValid; t += 4) {
    if (e.getProperty("observer:state") === "surge") surged = true;
    await wait(4);
  }
  const end = await endOf("test_float", m, 20 * 20);
  dmg.stop();
  check("float_entry_surges_and_ends", surged && end && end.outcome === "reached" && dmg.total === 0, `${end ? end.outcome : "none"} surged=${surged} damage=${dmg.total}`);
  await observerGone(100);
};

TESTS.status = async () => {
  obs("status", "Tester");
  await wait(10);
};

// ------------------------------------------------------------------ tick-rate monitor
let tpsMin = 99;
let lastMs = Date.now(), lastTick = system.currentTick;
system.runInterval(() => {
  const nowMs = Date.now();
  const tps = ((system.currentTick - lastTick) * 1000) / Math.max(1, nowMs - lastMs);
  lastMs = nowMs;
  lastTick = system.currentTick;
  if (tps < tpsMin) tpsMin = tps;
}, 100);

export async function runSuite(names) {
  const list = names.length ? names : Object.keys(TESTS);
  for (const n of list) {
    const t = TESTS[n];
    if (!t) {
      check(`unknown_test_${n}`, false);
      continue;
    }
    log(`[OTEST] ---- ${n}`);
    try {
      await t();
      if (n === "setup") tpsMin = 99; // exclude arena construction from the tick-rate figure
    } catch (e) {
      check(`${n}_crashed`, false, `${e} ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : ""}`);
    }
  }
  log(`[OTEST] SUITE DONE pass=${results.pass} fail=${results.fail} minTPS=${tpsMin.toFixed(1)}`);
}

/** Tick-rate measurement with one walking simulated player (no forced encounters). */
export async function measureTps() {
  const dim = ow();
  const sp = world.getDefaultSpawnLocation();
  dim.runCommand(`tickingarea add circle ${Math.floor(sp.x)} 0 ${Math.floor(sp.z)} 4 otest_tps true`);
  for (let i = 0; i < 80 && !dim.isChunkLoaded({ x: sp.x, y: 64, z: sp.z }); i++) await wait(5);
  const top = dim.getTopmostBlock({ x: sp.x, z: sp.z });
  const p = gt.spawnSimulatedPlayer({ dimension: dim, x: sp.x + 0.5, y: (top ? top.location.y : 100) + 1, z: sp.z + 0.5 }, "Tps", GameMode.Survival);
  obs("trace", "on");
  obs("set", "graceMinutes", "0");
  obs("set", "frequency", "2");
  obs("skipgrace", "Tps");
  const m0 = mark();
  obs("stage", "3", "Tps");
  const samples = [];
  let lastMs = Date.now(), lastTick = system.currentTick;
  for (let i = 0; i < 36; i++) {
    p.moveRelative(Math.random() < 0.5 ? -0.5 : 0.5, 1, 0.8);
    await wait(100);
    const ms = Date.now();
    samples.push(((system.currentTick - lastTick) * 1000) / (ms - lastMs));
    lastMs = ms;
    lastTick = system.currentTick;
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const encs = since(m0, "start").map((d) => d.type);
  log(`[OTEST] TPS mean=${mean.toFixed(2)} min=${samples[0].toFixed(2)} median=${samples[18].toFixed(2)} n=${samples.length} encounters=${encs.join(",") || "none"}`);
  log("[OTEST] TPS DONE");
}

export async function checkRecovery() {
  // after a restart mid-encounter: stale bodies removed, changes restored
  // the saved body loads with its chunk (tunnel arena is a ticking area); give it time to load
  await wait(100);
  const n = ow().getEntities({ type: OBS }).length;
  check("recovery_no_stray_bodies", n === 0, `observers=${n}`);
  obs("trace", "on");
  await wait(20 * 30);
  const veil = countBlocks(ow(), { x: TUNNEL.x0, y: TUNNEL.y, z: TUNNEL.z0 }, { x: TUNNEL.x1, y: TUNNEL.y + 2, z: TUNNEL.z1 }, "observer:veil");
  check("recovery_veil_restored", veil === 0, `veil=${veil}`);
  log(`[OTEST] RECOVERY DONE pass=${results.pass} fail=${results.fail}`);
}

export async function interruptSetup() {
  // start a closed path and leave it running so the harness can stop the server mid-encounter
  await TESTS.setup();
  const p = await freshTarget("Tester", { x: 915.5, y: TUNNEL.y, z: 1085.5 }, { x: 958, y: TUNNEL.y + 1.6, z: 1085.5 });
  p.moveRelative(0, 1, 0.6);
  await wait(30);
  const m = mark();
  obs("trigger", "closed_path", "Tester");
  const v = await waitEvent("ledger", (d) => d.what === "change" && d.kind === "veil", 300, m);
  p.stopMoving();
  // look back at the seal, as a player would: it arrives ahead while unwatched
  p.lookAtLocation({ x: 900, y: TUNNEL.y + 1.6, z: 1085.5 });
  const e = await waitObserver(200);
  if (e) log(`[OTEST] interrupt body at ${JSON.stringify(e.location)}`);
  // hold its gaze so it stays put while the harness stops the server
  if (e) system.runInterval(() => {
    if (e.isValid && p.isValid) p.lookAtLocation({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
  }, 2);
  await wait(20);
  check("interrupt_veil_placed", !!v);
  check("interrupt_body_present", !!observerEntity());
  log("[OTEST] INTERRUPT READY");
}
