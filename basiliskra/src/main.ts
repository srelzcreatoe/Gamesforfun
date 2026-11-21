/**
 * Basiliskra -- entry point.  Wires stable @minecraft/server events to the one controller.
 * No experiments, no beta APIs, no commands a survival player needs to type.
 */
import { EntityDamageCause, Player, system, world } from "@minecraft/server";
import { CONFIG, HITBOX, NS, OVERWORLD, TYPE } from "./config";
import { Controller } from "./controller";
import { partOwner } from "./creature";
import { particle, sound } from "./fx";
import { ANIMALS, recordHabitat, recordKill } from "./harm";
import { store } from "./store";
import { dist, type V3 } from "./vec";
import { idAt, isWaterId, overworld } from "./world";

export const ctl = new Controller();
let ready = false;

// ---- things that splash ----------------------------------------------------------------------
const SPLASHERS = new Set(["minecraft:snowball", "minecraft:egg", "minecraft:item", "minecraft:ender_pearl"]);
const flying: { e: import("@minecraft/server").Entity; born: number; by?: Player }[] = [];

function splash(at: V3, by?: Player): void {
  const dim = overworld();
  sound(dim, "basiliskra.splash", at, 24, 0.9);
  particle(dim, "basiliskra:splash", at, 32);
  ctl.brain?.onSplash(at, by);
}

function trackSplashes(): void {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    let done = system.currentTick - f.born > 100;
    try {
      if (!f.e.isValid) done = true;
      else if (isWaterId(idAt(f.e.dimension, f.e.location))) { splash(f.e.location, f.by); done = true; }
    } catch { done = true; }
    if (done) flying.splice(i, 1);
  }
}

// ---- start-up -----------------------------------------------------------------------------------
world.afterEvents.worldLoad.subscribe(() => {
  ctl.init();
  ready = true;
  system.runInterval(() => {
    try { trackSplashes(); ctl.tick(); } catch (e) { if (CONFIG.debug) console.warn(`[${NS}] tick: ${e}`); }
  }, 1);
});

system.beforeEvents.shutdown.subscribe(() => { try { store.flush(); store.save(); } catch { /* closing */ } });

// ---- identity: every entity of our type is examined the moment it appears -------------------------
world.afterEvents.entityLoad.subscribe((ev) => {
  if (!ready) return;
  try {
    if (ev.entity.typeId === TYPE) ctl.inspect(ev.entity);
    else if (ev.entity.typeId === HITBOX && !partOwner.has(ev.entity.id)) ev.entity.remove();
  } catch { /* gone */ }
});

world.afterEvents.entitySpawn.subscribe((ev) => {
  if (!ready) return;
  try {
    const id = ev.entity.typeId;
    if (id === TYPE) { ctl.inspect(ev.entity); return; }
    if (id === HITBOX) { if (!partOwner.has(ev.entity.id)) ev.entity.remove(); return; }
    if (SPLASHERS.has(id) && ev.entity.dimension.id === OVERWORLD && ctl.creature && flying.length < 16
      && dist(ev.entity.location, ctl.creature.pos) < 64) flying.push({ e: ev.entity, born: system.currentTick });
  } catch { /* gone */ }
});

world.beforeEvents.entityRemove.subscribe((ev) => {
  try { if (ev.removedEntity.typeId === TYPE) ctl.onRemoving(ev.removedEntity); } catch { /* gone */ }
});

// ---- damage ----------------------------------------------------------------------------------------
const PASSES = new Set<string>([EntityDamageCause.entityAttack, EntityDamageCause.projectile, EntityDamageCause.entityExplosion,
  EntityDamageCause.blockExplosion, EntityDamageCause.magic, EntityDamageCause.thorns, EntityDamageCause.sonicBoom,
  EntityDamageCause.maceSmash, EntityDamageCause.override]);

world.beforeEvents.entityHurt.subscribe((ev) => {
  let type: string;
  try { type = ev.hurtEntity.typeId; } catch { return; }
  if (type === HITBOX) {
    // a hit anywhere on his body is a hit on him
    ev.cancel = true;
    const owner = partOwner.get(ev.hurtEntity.id);
    if (!owner) return;
    const amount = ev.damage * (owner.tag === "head" ? 1.25 : owner.tag === "tail" ? 0.6 : 1);
    const cause = ev.damageSource.cause, by = ev.damageSource.damagingEntity;
    if (!PASSES.has(cause) || amount <= 0) return;
    system.run(() => {
      try { if (owner.creature.valid) owner.creature.entity.applyDamage(amount, by ? { cause, damagingEntity: by } : { cause }); } catch { /* gone */ }
    });
    return;
  }
  if (type !== TYPE) return;
  if (!PASSES.has(ev.damageSource.cause)) { ev.cancel = true; return; }
  // he cannot be killed here, only driven off: the blow is trimmed so he keeps his last breath
  let health = 1;
  try { health = ev.hurtEntity.getComponent("minecraft:health")?.currentValue ?? 1; } catch { health = 1; }
  if (health <= 2) { ev.cancel = true; return; }
  if (ev.damage >= health - 1) ev.damage = Math.max(0, health - 1.5);
});

world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    if (ev.hurtEntity.typeId !== TYPE) return;
    const by = ev.damageSource.damagingEntity;
    ctl.onHurt(by && by.typeId === "minecraft:player" ? (by as Player) : undefined, ev.damage);
  } catch { /* gone */ }
});

// ---- what opens the rift ----------------------------------------------------------------------------
world.afterEvents.entityDie.subscribe((ev) => {
  let type: string;
  try { type = ev.deadEntity.typeId; } catch { return; }
  if (type === TYPE) { ctl.onDie(ev.deadEntity); return; }
  if (!(type in ANIMALS)) return;
  try {
    const killer = ev.damageSource.damagingEntity;
    // only deaths a player caused count; lava, falls, wolves and the weather weigh nothing
    if (!killer || killer.typeId !== "minecraft:player" || ev.deadEntity.dimension.id !== OVERWORLD) return;
    const p = killer as Player;
    const t = recordKill(ev.deadEntity.location, type, p.id, p.name, system.currentTick);
    if (t) ctl.requestArrival(t);
  } catch { /* unloaded */ }
});

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  try {
    if (ev.dimension.id !== OVERWORLD) return;
    const t = recordHabitat(ev.block.location, ev.brokenBlockPermutation.type.id, ev.player.id, ev.player.name, system.currentTick);
    if (t) ctl.requestArrival(t);
  } catch { /* unloaded */ }
});

// ---- sounds he can hear -------------------------------------------------------------------------------
world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  try {
    const id = ev.block.typeId, at = ev.block.location;
    if (id === "minecraft:bell") ctl.brain?.onBell(at, ev.player);
    else if (id === "minecraft:noteblock") { ctl.ending.onNote(at); ctl.brain?.onNote(at); }
    else if (ev.itemStack?.typeId === "minecraft:water_bucket") {
      // water poured into a channel is a splash like any other
      const p = { x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5 };
      system.runTimeout(() => { try { if (isWaterId(idAt(ev.player.dimension, p)) || isWaterId(idAt(ev.player.dimension, at))) splash(p, ev.player); } catch { /* left */ } }, 4);
    }
  } catch { /* unloaded */ }
});

world.afterEvents.weatherChange.subscribe((ev) => {
  const w = String(ev.newWeather).toLowerCase();
  store.rec.weather = w.includes("thunder") ? "thunder" : w.includes("rain") ? "rain" : "clear";
  store.touch();
});

// ---- operator test hooks (off unless CONFIG.debug) --------------------------------------------------
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!CONFIG.debug || ev.id !== `${NS}:debug`) return;
  const [cmd, arg] = ev.message.split(" ");
  const rec = store.rec;
  const src = ev.sourceEntity;
  if (cmd === "status") {
    world.sendMessage(`[${NS}] stage=${rec.stage} form=${rec.form} id=${rec.entityId} loaded=${!!ctl.creature} act=${ctl.brain?.actName} quarantined=${ctl.quarantined}`);
  } else if (cmd === "arrive" && src) {
    // goes through the same controller as the real trigger: it can never make a second one
    ctl.requestArrival({ region: "debug", site: src.location, guilty: src.id, guiltyName: (src as Player).name ?? null });
  } else if (cmd === "stats") {
    rec.mut.surfacings = 99; rec.mut.episodes = 99; rec.mut.overland = 9999; rec.mut.formSince = -1e7; rec.mut.beams = Number(arg ?? rec.mut.beams);
    store.save();
  } else if (cmd === "dusk") {
    world.setTimeOfDay(12200);
  }
}, { namespaces: [NS] });
