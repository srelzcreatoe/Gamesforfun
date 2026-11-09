// Headless smoke test: runs the real behavior-pack scripts against mock-server.mjs.
// usage: node tools/sim/run-sim.mjs   (prepares a sandbox in /tmp-like scratch dir given by SIM_DIR)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const simDir = process.env.SIM_DIR || path.join(root, ".sim");
fs.rmSync(simDir, { recursive: true, force: true });
fs.mkdirSync(path.join(simDir, "node_modules/@minecraft/server"), { recursive: true });
fs.mkdirSync(path.join(simDir, "node_modules/@minecraft/server-ui"), { recursive: true });
fs.cpSync(path.join(root, "BP/scripts"), path.join(simDir, "scripts"), { recursive: true });
fs.writeFileSync(path.join(simDir, "package.json"), JSON.stringify({ type: "module" }));
fs.copyFileSync(path.join(here, "mock-server.mjs"), path.join(simDir, "node_modules/@minecraft/server/mock.mjs"));
fs.writeFileSync(path.join(simDir, "node_modules/@minecraft/server/package.json"), JSON.stringify({ name: "@minecraft/server", type: "module", main: "index.js" }));
fs.writeFileSync(path.join(simDir, "node_modules/@minecraft/server/index.js"), 'export * from "./mock.mjs";\n');
fs.writeFileSync(path.join(simDir, "node_modules/@minecraft/server-ui/package.json"), JSON.stringify({ name: "@minecraft/server-ui", type: "module", main: "index.js" }));
fs.writeFileSync(path.join(simDir, "node_modules/@minecraft/server-ui/index.js"), `
class F { constructor(){ this.items=[]; } title(){return this;} body(){return this;} button(t){this.items.push(t);return this;}
  toggle(){this.items.push('t');return this;} slider(l,a,b,o){ if(o&&o.defaultValue!==undefined&&(o.defaultValue<a||o.defaultValue>b)) throw new Error('slider default out of range '+l+' '+o.defaultValue); this.items.push('s');return this;}
  dropdown(l,items,o){ if(o&&o.defaultValueIndex!==undefined&&(o.defaultValueIndex<0||o.defaultValueIndex>=items.length)) throw new Error('dropdown default out of range '+l); this.items.push('d');return this;}
  submitButton(){return this;} label(){return this;} divider(){return this;} header(){return this;}
  show(){ globalThis.__forms=(globalThis.__forms||0)+1; return Promise.resolve({canceled: true, cancelationReason: 'UserClosed'}); } }
export class ActionFormData extends F {} export class ModalFormData extends F {} export class MessageFormData extends F {}
export const FormCancelationReason = { UserBusy: 'UserBusy', UserClosed: 'UserClosed' };
`);

const mock = await import(pathToFileURL(path.join(simDir, "node_modules/@minecraft/server/mock.mjs")).href);
// the scripts import "@minecraft/server" which resolves to index.js -> mock.mjs (same module instance)
const mc = await import(pathToFileURL(path.join(simDir, "node_modules/@minecraft/server/index.js")).href);
const { world, system, step, fire, addPlayer, log, entities, dims, worldDynamic } = mc;
void mock;

worldDynamic["shaftbreaker:config"] = JSON.stringify({ graceMinutes: 0, debug: true, encounterRate: 3, minEncounterGap: 30, recoverySeconds: 30, territory: true });
const origWarn = console.warn;
const warns = [];
console.warn = (...a) => { warns.push(a.join(" ")); };

await import(pathToFileURL(path.join(simDir, "scripts/main.js")).href);
const { T } = await import(pathToFileURL(path.join(simDir, "scripts/ai/threat.js")).href);
const pl = addPlayer("Steve", { x: 2.5, y: -24, z: 2.5 });
fire("worldLoad", {});
fire("playerSpawn", { player: pl, initialSpawn: true });

const states = [];
const stateOf = () => {
  const e = [...entities.values()].find((x) => x.typeId === "shaftbreaker:shaftbreaker" && x.isValid);
  return e ? e._props["shaftbreaker:state"] : "-";
};
let lastState = "";
const track = (t) => {
  const s = stateOf() + "/" + (T.brain ? T.brain.state + (T.brain.mode ? "(" + T.brain.mode + ")" : "") : "none");
  if (s !== lastState) { states.push(`${t}:${s}`); lastState = s; }
};
const run = (n, fn) => { for (let i = 0; i < n; i++) step((t) => { if (fn) fn(t); track(t); }); };
const creature = () => [...entities.values()].find((x) => x.typeId === "shaftbreaker:shaftbreaker" && x.isValid);
const lookAt = (target) => {
  const dx = target.x - pl.location.x, dz = target.z - pl.location.z;
  pl._rot = { x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI };
};
const se = (id, message = "") => fire("scriptEvent", { id: "shaftbreaker:" + id, message, sourceEntity: pl, sourceType: "Entity" });

// 1) the player strip-mines along the tunnel for a while (tension builds, mining noise, tunnel detection)
let mineX = 91;
pl.teleport({ x: 88.5, y: -24, z: 0.5 });
run(1200, (t) => {
  pl._rot = { x: 0, y: -90 }; // facing +x (down the tunnel)
  if (t % 12 === 0) {
    for (const y of [-24, -23]) {
      mc.dims.overworld.getBlock({ x: mineX, y, z: 0 }).setType("minecraft:air");
      fire("playerBreakBlock", { player: pl, block: mc.dims.overworld.getBlock({ x: mineX, y, z: 0 }), brokenBlockPermutation: { type: { id: "minecraft:deepslate" } }, dimension: mc.dims.overworld });
    }
    mineX++;
    pl.teleport({ x: mineX - 2.5, y: -24, z: 0.5 });
  }
});
console.log("after mining: creature state =", stateOf(), " tunnel walk to x =", mineX);

// 2) admin spawn + forced phases
if (!creature()) se("spawn", "stalk");
run(200);
const c1 = creature();
console.log("spawned:", !!c1, c1 ? JSON.stringify(c1.location) : "");
if (c1) {
  lookAt(c1.location); // the player turns around and sees it
  run(200, () => lookAt(creature() ? creature().location : pl.location));
  se("phase", "standoff");
  run(100, () => lookAt(creature() ? creature().location : pl.location));
  // walk up and touch it
  const c = creature();
  if (c) pl.teleport({ x: c.location.x - 1.5, y: c.location.y, z: c.location.z });
  run(120, () => lookAt(creature() ? creature().location : pl.location));
  se("phase", "hunt");
  run(400, (t) => { if (t % 40 === 0 && creature()) fire("entityHurt", { hurtEntity: creature(), damage: 9, damageSource: { cause: "entityAttack", damagingEntity: pl } }); });
  // the player flees far away -> search
  pl.teleport({ x: 0.5, y: -24, z: -60.5 });
  run(600);
}
console.log("states:", states.join(" "));

// 3) kill it
let c2 = creature();
if (!c2) { se("spawn", "hunt"); run(100); c2 = creature(); }
if (c2) {
  c2._hp = 0;
  fire("entityHurt", { hurtEntity: c2, damage: 50, damageSource: { cause: "entityAttack", damagingEntity: pl } });
  fire("entityDie", { deadEntity: c2, damageSource: { cause: "entityAttack", damagingEntity: pl } });
  c2.remove();
  run(40);
}

// 4) territory generation around the player + dwelling + organs
pl.teleport({ x: 0.5, y: -24, z: 0.5 });
se("hollow_here");
const before = mc.changedBlocks().size;
run(2400);
const after = mc.changedBlocks().size;
const counts = {};
for (const p of mc.changedBlocks().values()) counts[p.type.id] = (counts[p.type.id] || 0) + 1;
console.log("territory blocks changed:", after - before);
console.log("block palette:", JSON.stringify(counts));
const W = JSON.parse(worldDynamic["shaftbreaker:world"] || "{}");
console.log("dwellings:", (W.dwellings || []).length, "hollows:", Object.keys(W.hollows || {}).length, JSON.stringify(Object.values(W.hollows || {})[0] || {}).slice(0, 300));

// dump the generated region for the preview renderer
{
  const R = 40, Y0 = -36, Y1 = -4;
  const pal = [], idx = new Map(), data = [];
  for (let y = Y0; y <= Y1; y++) for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
    const p = mc.changedBlocks().get(`${x},${y},${z}`);
    const id = mc.getId(x, y, z) + (p && p.states && Object.keys(p.states).length ? "|" + JSON.stringify(p.states) : "");
    if (!idx.has(id)) { idx.set(id, pal.length); pal.push(id); }
    data.push(idx.get(id));
  }
  fs.writeFileSync(path.join(simDir, "region.json"), JSON.stringify({ R, Y0, Y1, pal, data }));
}
// floating-block check: every hanging/attached decoration must have support
let floating = 0;
const HANG = new Set(["shaftbreaker:dripfang", "shaftbreaker:bloodroot_vines", "shaftbreaker:hanging_tissue"]);
const FLOOR = new Set(["shaftbreaker:crimson_thorns", "shaftbreaker:glowspore_cluster", "shaftbreaker:skull_pile", "shaftbreaker:dweller_droppings", "shaftbreaker:bloodmoss_carpet", "shaftbreaker:watcher_pod"]);
const SOLIDISH = (id) => id !== "minecraft:air" && !id.includes("water") && !FLOOR.has(id) && !["shaftbreaker:bloodroot_vines", "shaftbreaker:hanging_tissue", "shaftbreaker:sinew_membrane"].includes(id);
for (const [key, p] of mc.changedBlocks()) {
  const [x, y, z] = key.split(",").map(Number);
  if (HANG.has(p.type.id)) {
    const up = mc.getId(x, y + 1, z);
    if (!(SOLIDISH(up) || up === p.type.id)) floating++;
  }
  if (FLOOR.has(p.type.id)) {
    const dn = mc.getId(x, y - 1, z);
    if (!SOLIDISH(dn)) floating++;
  }
}
console.log("unsupported decorations:", floating);

// organ break
for (const [key, p] of mc.changedBlocks()) {
  if (p.type.id === "shaftbreaker:organ_core") {
    const [x, y, z] = key.split(",").map(Number);
    mc.dims.overworld.getBlock({ x, y, z }).setType("minecraft:air");
    fire("playerBreakBlock", { player: pl, block: mc.dims.overworld.getBlock({ x, y, z }), brokenBlockPermutation: { type: { id: "shaftbreaker:organ_core" } }, dimension: mc.dims.overworld });
    break;
  }
}
run(300);
// heart break -> final confrontation
const W2 = JSON.parse(worldDynamic["shaftbreaker:world"] || "{}");
const d = (W2.dwellings || [])[0];
if (d) {
  mc.dims.overworld.getBlock({ x: d.hx, y: d.hy, z: d.hz }).setType("minecraft:air");
  fire("playerBreakBlock", { player: pl, block: mc.dims.overworld.getBlock({ x: d.hx, y: d.hy, z: d.hz }), brokenBlockPermutation: { type: { id: "shaftbreaker:dwelling_heart" } }, dimension: mc.dims.overworld });
  run(600);
  console.log("after heart destroyed: creature =", stateOf(), " final:", creature() ? "yes" : "no");
}

// 5) items, illusions, menus
fire("itemUse", { source: pl, itemStack: { typeId: "shaftbreaker:glowspore_flare" } });
fire("itemUse", { source: pl, itemStack: { typeId: "shaftbreaker:config_wheel" } });
fire("itemUse", { source: pl, itemStack: { typeId: "shaftbreaker:field_journal" } });
fire("projectileHitBlock", { projectile: { typeId: "shaftbreaker:rattlebone_projectile" }, source: pl, location: { x: 5, y: -24, z: 5 }, dimension: mc.dims.overworld });
for (const ill of ["extraPickaxe", "delayedFootstep", "answeringKnock", "unfinishedApproach", "eyesInDark", "phantom", "torches", "door", "scratches", "whisper", "caveIn", "distantScream", "lightDim", "footstepEcho", "movement", "seal"]) {
  se("illusion", ill);
  run(30);
}
se("info");
se("locate");
se("dwelling_here");
run(200);
se("cancel");
run(100);

console.warn = origWarn;
const scriptWarns = warns.filter((w) => w.includes("[Shaftbreaker]"));
console.log("\n==== RESULT ====");
console.log("ticks:", system.currentTick, " sounds:", log.sounds.length, " particles:", log.particles.length, " music events:", log.music.length, " forms:", globalThis.__forms || 0);
console.log("unique sounds:", [...new Set(log.sounds.map((s) => s[1]))].join(", "));
console.log("errors (mock-level):", log.errors.length);
for (const e of [...new Set(log.errors)].slice(0, 25)) console.log("  ERR", e);
console.log("guarded script warnings:", scriptWarns.length);
for (const w of [...new Set(scriptWarns)].slice(0, 25)) console.log("  WARN", w);
