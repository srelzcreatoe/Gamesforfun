import { world, system, GameMode } from "@minecraft/server";
import * as gt from "@minecraft/server-gametest";
const log = (m) => console.warn(m);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export async function runSpeed() {
  const dim = world.getDimension("overworld");
  const sp = world.getDefaultSpawnLocation();
  const cx = Math.floor(sp.x), cz = Math.floor(sp.z);
  dim.runCommand(`tickingarea add circle ${cx} 0 ${cz} 4 otest_spawn true`);
  for (let i = 0; i < 80 && !dim.isChunkLoaded({ x: cx, y: 64, z: cz }); i++) await system.waitTicks(5);
  const y = 200;
  dim.runCommand(`fill ${cx - 40} ${y - 1} ${cz - 3} ${cx + 4} ${y - 1} ${cz + 3} stone`);
  dim.runCommand(`fill ${cx - 40} ${y} ${cz - 3} ${cx + 4} ${y + 4} ${cz + 3} air`);
  const p = gt.spawnSimulatedPlayer({ dimension: dim, x: cx + 0.5, y, z: cz + 0.5 }, "Runner", GameMode.Survival);
  p.addTag("observer_target");
  await system.waitTicks(10);
  for (const v of ["v_m60", "v_m70", "v_m80", "v_m90", "v_m100"]) {
    const e = dim.spawnEntity("otest:chaser", { x: cx - 36.5, y, z: cz + 0.5 });
    e.triggerEvent("to_" + v);
    await system.waitTicks(20);
    const samples = [];
    for (let i = 0; i < 6; i++) { samples.push(dist(e.location, p.location)); await system.waitTicks(10); }
    const rates = samples.slice(1).map((d, i) => ((samples[i] - d) * 2).toFixed(2));
    log(`[OTEST] SPEED ${v} dist=${samples.map((d) => d.toFixed(1)).join(",")} b/s per 0.5s: ${rates.join(",")}`);
    e.remove();
    await system.waitTicks(5);
  }
  // contact test: does the native melee goal hit (damage 0) when it reaches the player?
  let hurt = 0;
  const sub = world.afterEvents.entityHurt.subscribe((ev) => { if (ev.hurtEntity.id === p.id) hurt++; });
  const e = dim.spawnEntity("otest:chaser", { x: cx - 8.5, y, z: cz + 0.5 });
  e.triggerEvent("to_v_m90");
  await system.waitTicks(100);
  log(`[OTEST] SPEED contact hurtEvents=${hurt} finalDist=${dist(e.location, p.location).toFixed(2)} health=${p.getComponent("minecraft:health").currentValue}`);
  world.afterEvents.entityHurt.unsubscribe(sub);
  e.remove();
  p.disconnect();
  log("[OTEST] SPEED DONE");
}
