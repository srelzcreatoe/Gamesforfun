// Stage-B capability probes: run with `scriptevent otest:proto`.
// Each probe logs "[OTEST] PASS <name>" or "[OTEST] FAIL <name> <detail>".
import { world, system, BlockPermutation, GameMode, EntityDamageCause, ItemStack } from "@minecraft/server";
import * as gt from "@minecraft/server-gametest";

const log = (m) => console.warn(m);
const pass = (n, d = "") => log(`[OTEST] PASS ${n} ${d}`);
const fail = (n, d = "") => log(`[OTEST] FAIL ${n} ${d}`);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function probe(name, fn) {
  try {
    const r = await fn();
    if (r === false) fail(name);
    else pass(name, typeof r === "string" ? r : "");
  } catch (e) {
    fail(name, String(e) + (e && e.stack ? " | " + e.stack.split("\n")[0] : ""));
  }
}

export async function waitForChunk(dim, loc, maxTicks = 400) {
  for (let i = 0; i < maxTicks; i += 5) {
    if (dim.isChunkLoaded(loc)) return true;
    await system.waitTicks(5);
  }
  return false;
}

export async function groundAt(dim, x, z) {
  const b = dim.getTopmostBlock({ x, z });
  return b ? { x: x + 0.5, y: b.location.y + 1, z: z + 0.5 } : undefined;
}

export async function runProto() {
  const dim = world.getDimension("overworld");
  const sp = world.getDefaultSpawnLocation();
  const cx = Math.floor(sp.x), cz = Math.floor(sp.z);
  dim.runCommand(`tickingarea add circle ${cx} 0 ${cz} 4 otest_spawn true`);
  const loaded = await waitForChunk(dim, { x: cx, y: 64, z: cz });
  if (!loaded) return fail("chunk_load", "spawn chunk never loaded");
  pass("chunk_load");
  const g = await groundAt(dim, cx, cz);
  log(`[OTEST] ground ${JSON.stringify(g)}`);

  // flat test platform 30 above ground so terrain doesn't interfere
  const base = { x: cx, y: Math.min(g.y + 30, 300), z: cz };
  dim.runCommand(`fill ${cx - 12} ${base.y - 1} ${cz - 12} ${cx + 12} ${base.y - 1} ${cz + 12} stone`);
  dim.runCommand(`fill ${cx - 12} ${base.y} ${cz - 12} ${cx + 12} ${base.y + 5} ${cz + 12} air`);

  let player;
  await probe("spawn_simulated_player", () => {
    player = gt.spawnSimulatedPlayer({ dimension: dim, x: cx + 0.5, y: base.y, z: cz + 0.5 }, "Tester", GameMode.Survival);
    return !!player && player.isValid;
  });
  await system.waitTicks(20);
  await probe("player_in_getAllPlayers", () => world.getAllPlayers().some((p) => p.name === "Tester"));

  let obs;
  await probe("spawn_observer", () => {
    obs = dim.spawnEntity("observer:the_observer", { x: cx + 8.5, y: base.y, z: cz + 0.5 });
    return obs.typeId === "observer:the_observer" ? `state=${obs.getProperty("observer:state")}` : false;
  });
  await probe("set_get_property", async () => {
    obs.setProperty("observer:state", "stare");
    obs.setProperty("observer:side", -1);
    obs.setProperty("observer:stoop", true);
    const same = `${obs.getProperty("observer:state")},${obs.getProperty("observer:side")},${obs.getProperty("observer:stoop")}`;
    await system.waitTicks(1);
    const next = `${obs.getProperty("observer:state")},${obs.getProperty("observer:side")},${obs.getProperty("observer:stoop")}`;
    return next === "stare,-1,true" ? `sameTick=${same} nextTick=${next}` : false;
  });
  await probe("still_mode_no_gravity", async () => {
    const y0 = obs.location.y;
    obs.teleport({ x: cx + 8.5, y: base.y + 2, z: cz + 0.5 });
    await system.waitTicks(20);
    const y1 = obs.location.y;
    obs.teleport({ x: cx + 8.5, y: base.y, z: cz + 0.5 });
    return Math.abs(y1 - (base.y + 2)) < 0.05 ? `y0=${y0} floatY=${y1}` : false;
  });
  await probe("teleport_facing_and_setRotation", async () => {
    obs.teleport(obs.location, { facingLocation: player.getHeadLocation() });
    const r1 = obs.getRotation();
    obs.setRotation({ x: 10, y: 45 });
    await system.waitTicks(2);
    const r2 = obs.getRotation();
    return `afterFacing=${JSON.stringify(r1)} afterSet=${JSON.stringify(r2)}`;
  });
  await probe("approach_mode_moves_closer", async () => {
    player.addTag("observer_target");
    obs.teleport({ x: cx + 10.5, y: base.y, z: cz + 0.5 });
    const d0 = dist(obs.location, player.location);
    obs.triggerEvent("observer:to_approach");
    await system.waitTicks(30);
    const dm = dist(obs.location, player.location);
    await system.waitTicks(40);
    const d1 = dist(obs.location, player.location);
    return d1 < d0 - 1 ? `d0=${d0.toFixed(2)} steady b/s≈${((dm - d1) / 2).toFixed(2)}` : false;
  });
  await probe("pursue_mode_speed", async () => {
    obs.teleport({ x: cx + 11.5, y: base.y, z: cz + 0.5 });
    obs.triggerEvent("observer:to_pursue");
    await system.waitTicks(20);
    const d0 = dist(obs.location, player.location);
    await system.waitTicks(20);
    const d1 = dist(obs.location, player.location);
    return `steady blocks/sec≈${(d0 - d1).toFixed(2)} (d0=${d0.toFixed(1)})`;
  });
  await probe("retreat_mode_moves_away", async () => {
    obs.teleport({ x: cx + 4.5, y: base.y, z: cz + 0.5 });
    obs.triggerEvent("observer:to_retreat");
    const d0 = dist(obs.location, player.location);
    await system.waitTicks(80);
    const d1 = dist(obs.location, player.location);
    return d1 > d0 + 1 ? `d0=${d0.toFixed(2)} d1=${d1.toFixed(2)}` : false;
  });
  obs.triggerEvent("observer:to_still");

  await probe("door_place_toggle", () => {
    const lower = dim.getBlock({ x: cx - 4, y: base.y, z: cz });
    const upper = lower.above();
    lower.setPermutation(BlockPermutation.resolve("minecraft:wooden_door", { upper_block_bit: false, open_bit: false, "minecraft:cardinal_direction": "north" }));
    upper.setPermutation(BlockPermutation.resolve("minecraft:wooden_door", { upper_block_bit: true, open_bit: false, "minecraft:cardinal_direction": "north" }));
    const st = lower.permutation.getAllStates();
    lower.setPermutation(lower.permutation.withState("open_bit", true));
    const after = lower.permutation.getState("open_bit");
    return after === true ? JSON.stringify(st) : false;
  });
  await probe("raycast_occlusion", () => {
    dim.getBlock({ x: cx + 3, y: base.y + 1, z: cz }).setType("minecraft:stone");
    const head = player.getHeadLocation();
    const hit = dim.getBlockFromRay(head, { x: 1, y: 0, z: 0 }, { maxDistance: 10 });
    return hit ? `hit ${hit.block.typeId} at ${JSON.stringify(hit.block.location)}` : false;
  });
  await probe("dynamic_property_large", () => {
    const s = "x".repeat(30000);
    world.setDynamicProperty("observer:probe", s);
    const ok = world.getDynamicProperty("observer:probe") === s;
    world.setDynamicProperty("observer:probe", undefined);
    return ok;
  });
  await probe("player_dynamic_property", () => {
    player.setDynamicProperty("observer:p", JSON.stringify({ a: 1 }));
    return player.getDynamicProperty("observer:p") === '{"a":1}';
  });
  await probe("personal_sound", () => {
    const si = player.playSound("random.click", { location: { x: cx, y: base.y, z: cz + 5 }, volume: 0.6, pitch: 0.8 });
    return `soundInstance=${!!si}`;
  });
  await probe("fog_command", () => {
    const r = player.runCommand("fog @s push observer:dread otest");
    const r2 = player.runCommand("fog @s remove otest");
    return `push=${r.successCount} remove=${r2.successCount}`;
  });
  await probe("camerashake_command", () => {
    const r = dim.runCommand(`camerashake add "Tester" 0.2 0.5 rotational`);
    return `success=${r.successCount}`;
  });
  await probe("camera_fade_api", () => {
    player.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.2, holdTime: 0.2, fadeOutTime: 0.4 } });
    return true;
  });
  await probe("spawn_particle", () => {
    dim.spawnParticle("minecraft:basic_smoke_particle", { x: cx, y: base.y + 1, z: cz });
    player.spawnParticle("minecraft:basic_smoke_particle", { x: cx, y: base.y + 1, z: cz });
    return true;
  });
  await probe("torch_place_remove", () => {
    const b = dim.getBlock({ x: cx - 2, y: base.y, z: cz + 2 });
    b.setPermutation(BlockPermutation.resolve("minecraft:torch", { torch_facing_direction: "top" }));
    const t = b.typeId;
    b.setType("minecraft:air");
    return t === "minecraft:torch" && b.typeId === "minecraft:air";
  });
  await probe("effects", () => player.addEffect("darkness", 60, { amplifier: 0, showParticles: false }) !== undefined || true);
  await probe("apply_damage_from_observer", async () => {
    const hc = player.getComponent("minecraft:health");
    const h0 = hc.currentValue;
    player.applyDamage(4, { cause: EntityDamageCause.entityAttack, damagingEntity: obs });
    await system.waitTicks(2);
    return `h0=${h0} h1=${hc.currentValue}`;
  });
  await probe("biome_query", () => dim.getBiome(player.location).id);
  await probe("absolute_time", () => `abs=${world.getAbsoluteTime()} day=${world.getDay()} tod=${world.getTimeOfDay()}`);
  await probe("light_levels", () => `light=${dim.getLightLevel(player.getHeadLocation())} sky=${dim.getSkyLightLevel(player.getHeadLocation())}`);

  // break-cancel: player breaks a marked block; beforeEvents cancels; we remove it without drops
  const markLoc = { x: cx + 1, y: base.y, z: cz + 1 };
  dim.getBlock(markLoc).setType("minecraft:dirt");
  let cancelled = false;
  const sub = world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    const l = ev.block.location;
    if (l.x === markLoc.x && l.y === markLoc.y && l.z === markLoc.z) {
      ev.cancel = true;
      cancelled = true;
      system.run(() => dim.getBlock(markLoc).setType("minecraft:air"));
    }
  });
  player.giveItem(new ItemStack("minecraft:diamond_shovel", 1), true);
  player.lookAtLocation({ x: markLoc.x + 0.5, y: markLoc.y + 0.5, z: markLoc.z + 0.5 });
  await system.waitTicks(5);
  player.breakBlock(markLoc);
  await system.waitTicks(40);
  world.beforeEvents.playerBreakBlock.unsubscribe(sub);
  const drops = dim.getEntities({ type: "minecraft:item", location: markLoc, maxDistance: 4 });
  if (cancelled && dim.getBlock(markLoc).typeId === "minecraft:air" && drops.length === 0) pass("break_cancel_no_drop");
  else fail("break_cancel_no_drop", `cancelled=${cancelled} type=${dim.getBlock(markLoc).typeId} drops=${drops.length}`);

  // hit detection on an immune observer
  let hit = false;
  const hsub = world.afterEvents.entityHitEntity.subscribe((ev) => {
    if (ev.hitEntity.typeId === "observer:the_observer" && ev.damagingEntity.typeId === "minecraft:player") hit = true;
  });
  obs.teleport({ x: player.location.x + 1.5, y: base.y, z: player.location.z });
  await system.waitTicks(5);
  player.lookAtEntity(obs);
  await system.waitTicks(5);
  player.attackEntity(obs);
  await system.waitTicks(10);
  world.afterEvents.entityHitEntity.unsubscribe(hsub);
  const oh = obs.getComponent("minecraft:health").currentValue;
  if (hit && oh === 400) pass("hit_event_immune", `health=${oh}`);
  else fail("hit_event_immune", `hit=${hit} health=${oh}`);

  await probe("getBlockAbove_semantics", () => {
    // floor at base.y-1 (stone); start inside the floor block vs. inside the air above it
    const fromFloor = dim.getBlockAbove({ x: cx + 5.5, y: base.y - 0.5, z: cz + 5.5 }, { includePassableBlocks: false, maxDistance: 6 });
    const fromAir = dim.getBlockAbove({ x: cx + 5.5, y: base.y + 0.1, z: cz + 5.5 }, { includePassableBlocks: false, maxDistance: 6 });
    const below = dim.getBlockBelow({ x: cx + 5.5, y: base.y, z: cz + 5.5 }, { includePassableBlocks: false, maxDistance: 6 });
    return `fromFloor=${fromFloor ? fromFloor.location.y : "none"} fromAir=${fromAir ? fromAir.location.y : "none"} below(y=${base.y})=${below ? below.location.y : "none"} floorY=${base.y - 1}`;
  });
  await probe("despawn_event", async () => {
    obs.triggerEvent("observer:despawn");
    await system.waitTicks(5);
    return !obs.isValid;
  });
  player.disconnect();
  log("[OTEST] PROTO DONE");
}
