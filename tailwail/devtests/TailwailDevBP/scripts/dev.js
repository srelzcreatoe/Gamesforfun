// Dev-only BDS experiments. Results are printed with a "[TWDEV]" prefix.
import { world, system, BlockVolume } from "@minecraft/server";

const log = (...a) => console.warn("[TWDEV] " + a.join(" "));
const ov = () => world.getDimension("overworld");
const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (p) => `${r2(p.x)},${r2(p.y)},${r2(p.z)}`;

function fill(a, b, block) {
  // split per Y layer to stay under the 32768-block fill limit
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    ov().fillBlocks(new BlockVolume({ x: a.x, y, z: a.z }, { x: b.x, y, z: b.z }), block);
  }
}

function arenaFlat(y) {
  fill({ x: -10, y: y - 1, z: -10 }, { x: 70, y: y - 1, z: 30 }, "minecraft:stone");
  fill({ x: -10, y, z: -10 }, { x: 70, y: y + 12, z: 30 }, "minecraft:air");
}

function track(ent, ticks, every, label, done) {
  const start = system.currentTick;
  let last = ent.location;
  let lastT = start;
  const h = system.runInterval(() => {
    if (!ent.isValid) { system.clearRun(h); log(label, "entity invalid"); return; }
    const t = system.currentTick;
    const p = ent.location;
    const d = Math.hypot(p.x - last.x, p.z - last.z);
    const sp = d / ((t - lastT) / 20);
    const bb = ent.getAABB();
    log(label, "t", t - start, "pos", fmt(p), "speed b/s", r2(sp), "aabb", fmt(bb.extent));
    last = p; lastT = t;
    if (t - start >= ticks) { system.clearRun(h); done && done(); }
  }, every);
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const [cmd, ...args] = ev.id.split(":")[1] ? [ev.id.split(":")[1], ...(ev.message || "").split(" ")] : [];
  try {
    if (cmd === "ping") log("pong", system.currentTick);
    if (cmd === "nav") navTest(Number(args[0] || 0.3));
    if (cmd === "posture") postureTest();
    if (cmd === "api") apiTest();
  } catch (e) { log("ERROR", cmd, e, e && e.stack); }
});

function navTest(move) {
  const y = -60;
  arenaFlat(y);
  for (const e of ov().getEntities({ families: ["tailwail"] })) e.remove();
  for (const e of ov().getEntities({ type: "tailwail:lure" })) e.remove();
  const tw = ov().spawnEntity("tailwail:tall_wail", { x: 0.5, y, z: 10.5 });
  const lure = ov().spawnEntity("tailwail:lure", { x: 60.5, y, z: 10.5 });
  lure.triggerEvent("tailwail:slot_a");
  tw.getComponent("minecraft:movement").setCurrentValue(move);
  system.runTimeout(() => {
    tw.triggerEvent("tailwail:seek_a");
    log("nav start move", move, "tw", fmt(tw.location), "lure", fmt(lure.location));
    track(tw, 200, 10, "nav", () => {
      tw.triggerEvent("tailwail:hold");
      const p0 = tw.location;
      system.runTimeout(() => log("hold drift", r2(Math.hypot(tw.location.x - p0.x, tw.location.z - p0.z))), 40);
    });
  }, 5);
}

function postureTest() {
  const y = -60;
  arenaFlat(y);
  for (const e of ov().getEntities({ families: ["tailwail"] })) e.remove();
  // two-high, one-wide tunnel from x=20..40 at z=10
  fill({ x: 20, y, z: 8 }, { x: 40, y: y + 6, z: 12 }, "minecraft:stone");
  fill({ x: 20, y, z: 10 }, { x: 40, y: y + 1, z: 10 }, "minecraft:air");
  const tw = ov().spawnEntity("tailwail:tall_wail", { x: 5.5, y, z: 10.5 });
  const lure = ov().spawnEntity("tailwail:lure", { x: 50.5, y, z: 10.5 });
  lure.triggerEvent("tailwail:slot_a");
  system.runTimeout(() => {
    tw.triggerEvent("tailwail:posture_crawl");
    tw.triggerEvent("tailwail:seek_a");
    system.runTimeout(() => log("crawl aabb", fmt(tw.getAABB().extent)), 2);
    track(tw, 300, 20, "tunnel", () => log("tunnel end x", r2(tw.location.x)));
  }, 5);
}

function apiTest() {
  const d = ov();
  const p = { x: 0, y: -60, z: 0 };
  log("light", d.getLightLevel(p), "sky", d.getSkyLightLevel(p), "loaded", d.isChunkLoaded(p));
  log("difficulty", world.getDifficulty());
}

log("dev pack loaded");
