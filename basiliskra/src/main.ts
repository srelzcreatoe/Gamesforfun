/**
 * Basiliskra -- entry point.  Wires stable @minecraft/server events to the one controller.
 * No experiments, no beta APIs, no commands a survival player needs to type.
 */
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, EntityDamageCause, EntitySwingSource, GameMode, Player, system, world } from "@minecraft/server";
import { CONFIG, JOURNAL_ITEM, NS, OVERWORLD, TITAN, TYPE, WHEEL_ITEM, isHitbox } from "./config";
import { loadSettings } from "./settings";
import { canAdmin, giveStarterItems, openJournal, openWheel, placeFor, cityForm } from "./ui";
import { clearLine } from "./world";
import { releaseStale } from "./scene";
import { fadeBlock, falloutJoin, isIodine, takeIodine } from "./fallout";
import { LANCE_ITEM, fireLance } from "./lance";
import { musicJoin } from "./music";
import { FADES_COMPONENT } from "./generated/blocks";
import { Controller } from "./controller";
import { partOwner, type Creature } from "./creature";
import { titans } from "./titan";
import { particle, sound } from "./fx";
import { ANIMALS, recordHabitat, recordKill } from "./harm";
import { store } from "./store";
import { dist, type V3 } from "./vec";
import { idAt, isWaterId, overworld } from "./world";

export const ctl = new Controller();
let ready = false;
let lastFault = "", faultAt = -1e9;

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
    let done = store.rec.clock - f.born > 100;
    try {
      if (!f.e.isValid) done = true;
      else if (isWaterId(idAt(f.e.dimension, f.e.location))) { splash(f.e.location, f.by); done = true; }
    } catch { done = true; }
    if (done) flying.splice(i, 1);
  }
}

// ---- start-up -----------------------------------------------------------------------------------
world.afterEvents.worldLoad.subscribe(() => {
  loadSettings();
  ctl.init();
  ready = true;
  system.runInterval(() => {
    try { trackSplashes(); ctl.tick(); } catch (e) {
      // say so (once per distinct fault, and again at most once a minute), and never let a fault cost the save
      const m = String(e);
      if (m !== lastFault || store.rec.clock - faultAt > 1200) {
        lastFault = m; faultAt = store.rec.clock;
        const where = String((e as Error)?.stack ?? "").split("\n").slice(0, 4).join(" | ");
        console.warn(`[${NS}] tick: ${m} ${where}`);
      }
      try { if (store.rec.clock % 40 === 0) store.flush(); } catch { /* closing */ }
    }
  }, 1);
});

system.beforeEvents.shutdown.subscribe(() => { try { store.flush(); store.save(); } catch { /* closing */ } });

// ---- identity: every entity of our type is examined the moment it appears -------------------------
world.afterEvents.entityLoad.subscribe((ev) => {
  if (!ready) return;
  try {
    if (ev.entity.typeId === TYPE) ctl.inspect(ev.entity);
    else if (ev.entity.typeId === TITAN) titans.inspect(ev.entity);
    else if (isHitbox(ev.entity.typeId) && !partOwner.has(ev.entity.id)) ev.entity.remove();
  } catch { /* gone */ }
});

world.afterEvents.entitySpawn.subscribe((ev) => {
  if (!ready) return;
  try {
    const id = ev.entity.typeId;
    if (id === TYPE) { ctl.inspect(ev.entity); return; }
    if (id === TITAN) { titans.inspect(ev.entity); return; }
    if (isHitbox(id)) { if (!partOwner.has(ev.entity.id)) ev.entity.remove(); return; }
    if (SPLASHERS.has(id) && ev.entity.dimension.id === OVERWORLD && ctl.creature && flying.length < 16
      && dist(ev.entity.location, ctl.creature.pos) < 64) flying.push({ e: ev.entity, born: store.rec.clock });
  } catch { /* gone */ }
});

world.beforeEvents.entityRemove.subscribe((ev) => {
  try {
    const id = ev.removedEntity.typeId;
    if (id === TYPE) ctl.onRemoving(ev.removedEntity);
    else if (id === TITAN) titans.onRemoving(ev.removedEntity);
    else if (isHitbox(id)) partOwner.delete(ev.removedEntity.id);
  } catch { /* gone */ }
});

// ---- damage ----------------------------------------------------------------------------------------
const PASSES = new Set<string>([EntityDamageCause.entityAttack, EntityDamageCause.projectile, EntityDamageCause.entityExplosion,
  EntityDamageCause.blockExplosion, EntityDamageCause.magic, EntityDamageCause.thorns, EntityDamageCause.sonicBoom,
  EntityDamageCause.maceSmash, EntityDamageCause.override]);

let forwardTick = -1, forwardKey = "";
/** How much of a Titan's blow reaches Basiliskra himself. */
const TITAN_ON_HIM = 0.3;
/** The last tick the game itself delivered each player's blow to one of his hit volumes. */
const struckAt = new Map<string, number>();
const swungAt = new Map<string, number>();

/** What a blow with this in the hand does (the game's own figures for an unenchanted weapon). */
function meleeDamage(id: string | undefined): number {
  if (!id) return 1;
  const tier = /netherite/.test(id) ? 4 : /diamond/.test(id) ? 3 : /iron/.test(id) ? 2 : /stone/.test(id) ? 1 : /wooden|golden/.test(id) ? 0 : -1;
  if (/_sword$/.test(id)) return 5 + Math.max(0, tier);
  if (/_axe$/.test(id)) return 4 + Math.max(0, tier);
  if (/_pickaxe$/.test(id)) return 3 + Math.max(0, tier);
  if (/_shovel$|_hoe$/.test(id)) return 2 + Math.max(0, tier);
  if (id === "minecraft:trident") return 9;
  if (id === "minecraft:mace") return 6;
  return 1;
}

// A swing that the game did not land on a hit volume, but which was aimed at him from within reach, is still a
// blow: the swing's own line is tried against his volumes.  (Which entity a swing lands on is decided on the
// player's device; this does not depend on that.)
/** Every giant there is to hit: Basiliskra himself, and the Titans. */
const everyGiant = (): Creature[] => [...(ctl.creature ? [ctl.creature] : []), ...titans.creatures()];

world.afterEvents.playerSwingStart.subscribe((ev) => {
  if (!ready || !everyGiant().length) return;
  if (ev.swingSource !== EntitySwingSource.Attack) return;
  const p = ev.player;
  const t0 = store.rec.clock;
  const held = ev.heldItemStack?.typeId;
  system.runTimeout(() => {
    try {
      if (!p.isValid) return;
      if ((struckAt.get(p.id) ?? -99) >= t0) return;                      // the game landed it: that was the blow
      if (store.rec.clock - (swungAt.get(p.id) ?? -99) < 8) return;        // one blow per swing of the arm
      const from = p.getHeadLocation(), dir = p.getViewDirection();
      const reach = p.getGameMode() === GameMode.Creative ? 6.5 : 4.5;
      // whichever giant the swing's line meets first
      let c: Creature | null = null, hit: ReturnType<Creature["rayHit"]> = null;
      for (const g of everyGiant()) {
        if (!g.valid || p.dimension.id !== g.dim.id) continue;
        const h = g.rayHit(from, dir, reach);
        if (h && (!hit || h.dist < hit.dist)) { hit = h; c = g; }
      }
      if (!c || !hit) return;
      // something solid between them is what the swing landed on
      if (hit.dist > 0.3 && !clearLine(c.dim, from, { x: from.x + dir.x * hit.dist, y: from.y + dir.y * hit.dist, z: from.z + dir.z * hit.dist })) return;
      swungAt.set(p.id, store.rec.clock);
      const amount = meleeDamage(held) * (hit.tag === "head" ? 1.25 : hit.tag === "tail" ? 0.6 : 1);
      c.entity.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: p });
    } catch { /* left */ }
  }, 2);
});

world.beforeEvents.entityHurt.subscribe((ev) => {
  let type: string;
  try { type = ev.hurtEntity.typeId; } catch { return; }
  if (isHitbox(type)) {
    // a hit anywhere on his body is a hit on him
    ev.cancel = true;
    const owner = partOwner.get(ev.hurtEntity.id);
    if (!owner) return;
    const amount = ev.damage * (owner.tag === "head" ? 1.25 : owner.tag === "tail" ? 0.6 : 1);
    const cause = ev.damageSource.cause, by = ev.damageSource.damagingEntity;
    if (!PASSES.has(cause) || amount <= 0) return;
    // one blast or one sweep reaches several volumes in the same tick: it is still one blow
    const key = `${cause}|${by?.id ?? ""}|${owner.creature.entity.id}`;
    if (by) struckAt.set(by.id, store.rec.clock);
    if (forwardTick === store.rec.clock && forwardKey === key) return;
    forwardTick = store.rec.clock; forwardKey = key;
    system.run(() => {
      try { if (owner.creature.valid) owner.creature.entity.applyDamage(amount, by ? { cause, damagingEntity: by } : { cause }); } catch { /* gone */ }
    });
    return;
  }
  if (type === TITAN) {
    // a Titan can be killed: the blow that would do it is held back, and it goes down in its own time
    if (!PASSES.has(ev.damageSource.cause)) { ev.cancel = true; return; }
    if (titans.beforeHurt(ev.hurtEntity, ev.damage) <= 0) ev.cancel = true;
    return;
  }
  if (type !== TYPE) return;
  if (!PASSES.has(ev.damageSource.cause)) { ev.cancel = true; return; }
  // what a Titan does to him is turned by the same hide it has itself: he is outmatched, not swatted
  try { if (ev.damageSource.damagingEntity?.typeId === TITAN) ev.damage *= TITAN_ON_HIM; } catch { /* gone */ }
  // he cannot be killed here, only driven off: the blow is trimmed so he keeps his last breath
  let health = 1;
  try { health = ev.hurtEntity.getComponent("minecraft:health")?.currentValue ?? 1; } catch { health = 1; }
  if (health <= 2) { ev.cancel = true; system.run(() => ctl.driveOff()); return; }
  if (ev.damage >= health - 1) { ev.damage = Math.max(0, health - 1.5); system.run(() => ctl.driveOff()); }
});

world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    if (ev.hurtEntity.typeId === TITAN) { titans.onHurt(ev.hurtEntity, ev.damageSource.damagingEntity, ev.damage); return; }
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
    const t = recordKill(ev.deadEntity.location, type, p.id, p.name, store.rec.clock);
    if (t) ctl.requestArrival(t);
  } catch { /* unloaded */ }
});

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  try {
    if (ev.dimension.id !== OVERWORLD) return;
    const t = recordHabitat(ev.block.location, ev.brokenBlockPermutation.type.id, ev.player.id, ev.player.name, store.rec.clock);
    if (t) ctl.requestArrival(t);
  } catch { /* unloaded */ }
});

// ---- sounds he can hear -------------------------------------------------------------------------------
world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  try {
    const id = ev.block.typeId, at = ev.block.location;
    if (id === "minecraft:bell") ctl.brain?.onBell(at, ev.player);
    else if (id === "minecraft:noteblock") { ctl.ending.onNote(at); ctl.brain?.onNote(at); }
    else if (ev.beforeItemStack?.typeId === "minecraft:water_bucket") {      // the stack as it was: afterwards the bucket is empty
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

// ---- the journal, the config wheel, and the commands --------------------------------------------------------
world.afterEvents.itemUse.subscribe((ev) => {
  try {
    const id = ev.itemStack.typeId;
    if (id === JOURNAL_ITEM) void openJournal(ev.source, ctl);
    else if (id === WHEEL_ITEM) void openWheel(ev.source, ctl);
    else if (id === LANCE_ITEM) fireLance(ev.source, everyGiant(), store.rec.clock);
  } catch { /* left */ }
});

// iodine tablets, swallowed
world.afterEvents.itemCompleteUse.subscribe((ev) => {
  try { if (isIodine(ev.itemStack?.typeId)) takeIodine(ev.source); } catch { /* left */ }
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  releaseStale(ev.player);                 // a camera left over from a cutscene that this player did not see the end of
  if (!ev.initialSpawn) return;
  falloutJoin(ev.player);                  // and no red haze left over from another session
  musicJoin(ev.player);                    // nor a theme left looping
  const p = ev.player;
  system.runTimeout(() => { try { if (p.isValid) giveStarterItems(p); } catch { /* left */ } }, 60);
});

const FORMS = ["story", "i", "ii", "iii", "iv"];
system.beforeEvents.startup.subscribe((ev) => {
  // his glowing blocks look after themselves: on a random tick, with no fallout left there, they go back to what they were
  try { ev.blockComponentRegistry.registerCustomComponent(FADES_COMPONENT, { onRandomTick: (e) => fadeBlock(e.block) }); }
  catch (e) { console.warn(`[basiliskra] the fading of his blocks could not be registered: ${e}`); }
  const reg = ev.customCommandRegistry;
  const who = (o: { sourceEntity?: unknown; initiator?: unknown }): Player | undefined => {
    const e = (o.initiator ?? o.sourceEntity) as Player | undefined;
    return e && (e as Player).typeId === "minecraft:player" ? e : undefined;
  };
  const fail = (message: string) => ({ status: CustomCommandStatus.Failure, message });
  try {
    reg.registerEnum(`${NS}:form`, FORMS);
    reg.registerCommand({
      name: `${NS}:spawn`, description: "Bring the one Basiliskra here (form: story, i, ii, iii or iv). Moves him if he is about.",
      permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: false,
      optionalParameters: [{ name: `${NS}:form`, type: CustomCommandParamType.Enum }],
    }, (origin, form?: string) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      const want = Math.max(0, FORMS.indexOf(form ?? "story")) as 0 | 1 | 2 | 3 | 4;
      system.run(() => {
        try {
          if (p.dimension.id !== OVERWORLD) { p.sendMessage("§7[Basiliskra] He only lives in the Overworld."); return; }
          const rec = store.rec;
          const place = placeFor(p, want || (rec.born > 0 ? rec.form : 3));
          p.sendMessage(`§7[Basiliskra] ${ctl.bringHere(place.at, place.yaw, want)}`);
        } catch (e) { p.sendMessage(`§c[Basiliskra] ${e}`); }
      });
      return { status: CustomCommandStatus.Success, message: "Calling Basiliskra..." };
    });
    reg.registerCommand({
      name: `${NS}:journal`, description: "Open the Basiliskra journal: how angry he is, and when he will come.",
      permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
    }, (origin) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system.run(() => { void openJournal(p, ctl); });
      return { status: CustomCommandStatus.Success };
    });
    reg.registerCommand({
      name: `${NS}:config`, description: "Open the Basiliskra config wheel (settings; bring, call or send him).",
      permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: false,
    }, (origin) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system.run(() => { if (canAdmin(p)) void openWheel(p, ctl); else p.sendMessage("§7[Basiliskra] Only an operator can use the config wheel."); });
      return { status: CustomCommandStatus.Success };
    });
    reg.registerEnum(`${NS}:titan_do`, ["here", "clear"]);
    reg.registerCommand({
      name: `${NS}:titan`, description: "Put a Titan where you look (a Basiliskra IV made for battles; up to three), or clear them all.",
      permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: false,
      optionalParameters: [{ name: `${NS}:titan_do`, type: CustomCommandParamType.Enum }],
    }, (origin, what?: string) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system.run(() => {
        try {
          if (what === "clear") { p.sendMessage(`§7[Basiliskra] ${titans.clear()} Titan(s) removed.`); return; }
          const place = placeFor(p, 4);
          p.sendMessage(`§7[Basiliskra] ${titans.spawn(p.dimension, place.at, place.yaw)}`);
        } catch (e) { p.sendMessage(`§c[Basiliskra] ${e}`); }
      });
      return { status: CustomCommandStatus.Success };
    });
    reg.registerCommand({
      name: `${NS}:city`, description: "Raise a city where you stand: streets behind you, a beach and a very deep sea ahead.",
      permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: false,
    }, (origin) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system.run(() => { void cityForm(p); });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn(`[${NS}] commands: ${e}`); }
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
