// @ts-check
// Survival tools: Rattlebone (noise lure), Glowspore Flare (deterrent light), Organ Muffler
// (non-destructive organ suppression), Bone Chime (warning when it passes), and the menu items.
import { world, system, GameMode } from "@minecraft/server";
import { cfg } from "./core/config.js";
import { W, markDirty } from "./core/state.js";
import { LURE_ID, now, guard, dist, getBlock, alive } from "./core/util.js";
import { ORGAN_BLOCKS } from "./core/blocks.js";
import { T } from "./ai/threat.js";
import { getP } from "./ai/players.js";
import { makeNoise } from "./ai/perception.js";
import { lure, flare } from "./ai/dweller.js";
import { muffle } from "./world/organs.js";
import { openConfig } from "./ui/menus.js";
import { openJournal, unlock } from "./ui/journal.js";

function consume(pl, slotItem) {
  try {
    if (pl.getGameMode() === GameMode.Creative) return;
    const inv = /** @type {any} */ (pl.getComponent("minecraft:inventory"));
    const c = inv && inv.container;
    if (!c) return;
    const slot = pl.selectedSlotIndex;
    const it = c.getItem(slot);
    if (!it || it.typeId !== slotItem) return;
    if (it.amount <= 1) c.setItem(slot, undefined);
    else { it.amount -= 1; c.setItem(slot, it); }
  } catch { /* */ }
}

world.afterEvents.itemUse.subscribe((ev) => {
  guard("itemUse", () => {
    const pl = ev.source;
    const id = ev.itemStack.typeId;
    if (id === "shaftbreaker:config_wheel") openConfig(pl);
    else if (id === "shaftbreaker:field_journal") openJournal(pl);
    else if (id === "shaftbreaker:glowspore_flare") useFlare(pl);
  });
});

function useFlare(pl) {
  const p = getP(pl);
  if (now() - (p.flareT || 0) < 100) return;
  p.flareT = now();
  const vd = pl.getViewDirection();
  const at = { x: pl.location.x + vd.x * 2, y: pl.location.y + 1.4, z: pl.location.z + vd.z * 2 };
  pl.dimension.spawnParticle("shaftbreaker:flare", at);
  pl.dimension.playSound("random.fizz", at, { volume: 1.0, pitch: 0.6 });
  pl.dimension.playSound("fire.ignite", at, { volume: 1.0 });
  for (const o of pl.dimension.getPlayers({ location: at, maxDistance: 10 })) {
    guard("nv", () => o.addEffect("night_vision", 200, { amplifier: 0, showParticles: false }));
  }
  guard("cd", () => pl.startItemCooldown("shaftbreaker_flare", 120));
  consume(pl, "shaftbreaker:glowspore_flare");
  flare(pl, at);
}

world.afterEvents.projectileHitBlock.subscribe((ev) => {
  guard("lureHit", () => {
    let tid = "";
    try { tid = ev.projectile.typeId; } catch { return; }
    if (tid !== LURE_ID) return;
    const loc = ev.location;
    ev.dimension.playSound("shaftbreaker.block.chime", loc, { volume: 1.0, pitch: 1.3 });
    ev.dimension.playSound("shaftbreaker.click", loc, { volume: 0.8, pitch: 1.4 });
    ev.dimension.spawnParticle("shaftbreaker:noise_ring", loc);
    makeNoise(loc, 30, "lure");
    const src = ev.source;
    if (src && src.typeId === "minecraft:player") {
      lure(loc, /** @type {any} */ (src));
      unlock(/** @type {any} */ (src), "lure");
    }
  });
});

world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  guard("muffle", () => {
    const it = ev.itemStack;
    if (!it || it.typeId !== "shaftbreaker:organ_muffler") return;
    const b = ev.block;
    if (!ORGAN_BLOCKS.has(b.typeId)) return;
    muffle(b.location);
    const c = { x: b.location.x + 0.5, y: b.location.y + 0.8, z: b.location.z + 0.5 };
    b.dimension.playSound("shaftbreaker.block.organ_pulse", c, { volume: 0.4, pitch: 0.5 });
    b.dimension.playSound("block.cloth.place", c, { volume: 0.8 });
    try { b.dimension.spawnParticle("minecraft:basic_smoke_particle", c); } catch { /* */ }
    if (b.typeId === "shaftbreaker:watcher_pod_open") guard("close", () => b.setType("shaftbreaker:watcher_pod"));
    consume(ev.player, "shaftbreaker:organ_muffler");
    ev.player.onScreenDisplay.setActionBar("§7The organ falls quiet for a while.");
  });
});

world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  guard("chimePlace", () => {
    if (ev.block.typeId !== "shaftbreaker:bone_chime") return;
    const l = ev.block.location;
    W.chimes.push([l.x, l.y, l.z]);
    if (W.chimes.length > 64) W.chimes.shift();
    markDirty();
  });
});

const chimeCd = new Map();
/** every 10 ticks: bone chimes rattle when the creature passes near them */
export function chimeTick() {
  const b = T.brain;
  if (!b || !alive(b.e) || !W.chimes.length) return;
  const loc = b.e.location;
  const dim = b.e.dimension;
  const t = now();
  W.chimes = W.chimes.filter((c) => {
    if (dist(loc, { x: c[0], y: c[1], z: c[2] }) > 6) return true;
    const blk = getBlock(dim, { x: c[0], y: c[1], z: c[2] });
    if (!blk) return true;
    if (blk.typeId !== "shaftbreaker:bone_chime") return false;
    const k = c.join(",");
    if (t - (chimeCd.get(k) || -999) > 100) {
      chimeCd.set(k, t);
      dim.playSound("shaftbreaker.block.chime", { x: c[0] + 0.5, y: c[1] + 0.5, z: c[2] + 0.5 }, { volume: 1.2 });
    }
    return true;
  });
}

export { system };
