// @ts-check
// Taiga illusions. In taiga forests only, the woods play tricks: a shadow of the Observer stands far
// off between the trunks, staring. The moment anyone looks straight at it, it is simply gone — no
// burst, no trace — and the one who saw it hears a vanilla cave noise. Unlooked-at, it fades after
// half a minute or so. At most one shadow per player; never in other biomes or dimensions.
//
// The shadow is its own harmless entity (observer:shadow: no AI, no collision, no damage), so it
// never interferes with the one real Observer or its encounters.
import { world, system, GameMode } from "@minecraft/server";
import { ps, now } from "../core/state.js";
import { S } from "../core/settings.js";
import { V, safe, rand, allPlayers, trace, emit } from "../core/util.js";
import { findSpot } from "../world/space.js";
import { visibility } from "../world/sight.js";

export const SHADOW_ID = "observer:shadow";
const TAIGA = /taiga/;

/** @type {Map<string, {e: import("@minecraft/server").Entity, pid: string, until: number}>} entity id -> shadow */
const shadows = new Map();
/** @type {Map<string, number>} player id -> clock of the next allowed shadow */
const nextAt = new Map();
/** @type {Map<string, string>} player id -> how their last shadow ended ("seen" | "faded") */
export const lastResult = new Map();

/** Is this player standing in a taiga biome? @param {import("@minecraft/server").Player} p */
export function inTaiga(p) {
  if (p.dimension.id !== "minecraft:overworld") return false;
  const id = safe(() => p.dimension.getBiome(p.location)?.id, "") ?? "";
  return TAIGA.test(id);
}

/** Does this player currently have a shadow out? @param {string} pid */
export const hasShadow = (pid) => [...shadows.values()].some((s) => s.pid === pid);

/**
 * Put a shadow somewhere far off, among cover, where the player could see it if they looked.
 * @param {import("@minecraft/server").Player} p @param {{force?:boolean}} [o] force: ignore biome and timers (tests)
 * @returns {boolean}
 */
export function spawnFor(p, o = {}) {
  if (hasShadow(p.id)) return false;
  if (!o.force && !inTaiga(p)) return false;
  // among the trees at about the player's own height first; the open surface further off as a fallback
  const bearings = [60, 100, -60, -100, 140, -140, 25, -25];
  const spot = findSpot(p, { minDist: 32, maxDist: 60, bearings, spread: 20, concealment: "partial", needLOS: true, preferCover: true, yMode: "near", samples: 32 })
    ?? findSpot(p, { minDist: 32, maxDist: 60, bearings, spread: 20, concealment: "partial", needLOS: true, preferCover: true, yMode: "surface", samples: 32 })
    ?? findSpot(p, { minDist: 28, maxDist: 64, concealment: "any", needLOS: true, yMode: "near", samples: 40 });
  if (!spot) return false;
  const e = safe(() => p.dimension.spawnEntity(SHADOW_ID, spot.loc, { initialPersistence: false }));
  if (!e) return false;
  const head = p.getHeadLocation();
  safe(() => e.setRotation({ x: V.pitchTo({ x: spot.loc.x, y: spot.loc.y + 3.6, z: spot.loc.z }, head), y: V.yawTo(spot.loc, head) }));
  shadows.set(e.id, { e, pid: p.id, until: now() + rand(25, 45) });
  trace(`illusion for ${p.name} at ${V.str(spot.loc)} (${V.dist(spot.loc, p.location).toFixed(0)} blocks)`);
  emit("illusion", { what: "spawn", player: p.name, d: V.dist(spot.loc, p.location) });
  return true;
}

/** @param {string} id @param {"seen"|"faded"|"gone"} why @param {import("@minecraft/server").Player} [by] */
function end(id, why, by) {
  const s = shadows.get(id);
  if (!s) return;
  shadows.delete(id);
  safe(() => s.e.isValid && s.e.remove());
  lastResult.set(s.pid, why);
  const freq = Math.max(0.25, S().frequency);
  const tod = safe(() => world.getTimeOfDay(), 6000) ?? 6000;
  const night = tod > 12800 && tod < 23200;
  nextAt.set(s.pid, now() + (why === "seen" ? rand(90, 200) : rand(60, 150)) / freq * (night ? 0.6 : 1));
  if (why === "seen" && by) {
    // gone the instant it is looked at; the cave answers
    safe(() => by.playSound("ambient.cave", { volume: 1 }));
    emit("illusion", { what: "seen", player: by.name });
  } else emit("illusion", { what: why });
}

/** Every 2 ticks: vanish the moment anyone looks straight at it; keep it facing its player. */
export function watch() {
  if (shadows.size === 0) return;
  const t = now();
  for (const [id, s] of [...shadows]) {
    if (!s.e.isValid) {
      shadows.delete(id);
      continue;
    }
    const owner = world.getEntity(s.pid);
    if (!owner || !owner.isValid || owner.dimension.id !== s.e.dimension.id || t > s.until) {
      end(id, "faded");
      continue;
    }
    const l = s.e.location;
    const seer = allPlayers().find((p) => p.dimension.id === s.e.dimension.id && visibility(p, l, { fov: 20, maxDist: 96 }).points > 0);
    if (seer) {
      end(id, "seen", seer);
      continue;
    }
    const head = /** @type {any} */ (owner).getHeadLocation();
    safe(() => s.e.setRotation({ x: V.pitchTo({ x: l.x, y: l.y + 3.6, z: l.z }, head), y: V.yawTo(l, head) }));
  }
}

/** Every second: maybe a new shadow for players walking in taiga. */
export function tick() {
  const c = S();
  if (!c.enabled || c.illusions === false) return;
  const t = now();
  for (const p of allPlayers()) {
    if (!inTaiga(p) || hasShadow(p.id)) continue;
    const gm = safe(() => p.getGameMode());
    if (gm !== GameMode.Survival && gm !== GameMode.Adventure) continue;
    const s = ps(p);
    if (s.stage < 1 || (s.witnessed && s.endMode === "rest")) continue;
    if (!nextAt.has(p.id)) nextAt.set(p.id, t + rand(30, 90)); // first minute or so in the woods is quiet
    if (t < (nextAt.get(p.id) ?? 0)) continue;
    if (!spawnFor(p)) nextAt.set(p.id, t + 15); // no place to stand: try again shortly
  }
}

/** Shadows are never saved: remove any left over from a previous session. */
export function registerEvents() {
  world.afterEvents.entityLoad.subscribe((ev) => {
    if (ev.entity.typeId === SHADOW_ID && !shadows.has(ev.entity.id)) safe(() => ev.entity.remove());
  });
  system.runTimeout(() => {
    for (const p of allPlayers()) {
      for (const e of safe(() => p.dimension.getEntities({ type: SHADOW_ID, location: p.location, maxDistance: 128 }), []) ?? []) {
        if (!shadows.has(e.id)) safe(() => e.remove());
      }
    }
  }, 40);
}
