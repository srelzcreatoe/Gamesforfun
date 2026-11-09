// @ts-check
import { world, GameMode } from "@minecraft/server";
import { loadProfile, saveProfile } from "../core/state.js";
import { now, dist, distXZ, flat, dot, getBlock, clamp } from "../core/util.js";
import { solid } from "../core/blocks.js";

/**
 * Runtime state per player (not persisted, except `profile`).
 * @typedef {ReturnType<typeof makeP>} P
 */
function makeP(player) {
  return {
    id: player.id,
    name: player.name,
    profile: loadProfile(player),
    profDirty: false,
    underground: false, ugTicks: 0, surfTicks: 0, depth: 0, light: 15,
    /** @type {any} */ terr: null, terrS: 0,
    tension: 0, nextMinor: now() + 1200,
    /** @type {{x:number,y:number,z:number}|null} */ lastPos: null,
    still: 0, moving: 0, wasMovingTicks: 0,
    lastYaw: 0, turnBacks: 0,
    /** @type {{x:number,y:number,z:number,t:number}[]} */ breaks: [],
    lastBreak: -9999, streak: 0,
    /** @type {any} */ tunnel: null,
    /** @type {{x:number,y:number,z:number}[]} */ torches: [],
    torchTimes: /** @type {number[]} */ ([]),
    hbNext: 0, hbLevel: 0,
    /** @type {string|null} */ music: null, musicNext: 0,
    ambNext: now() + 400, dripNext: 0, pulseNext: 0, rumbleNext: now() + 3000, partNext: 0,
    silenceUntil: 0,
    /** @type {any} */ nav: null, navBusy: false, navWant: 0,
    spottedAt: -9999, lastStinger: -9999,
    reprieveUntil: 0,
    lastPlace: -9999,
    /** @type {{x:number,y:number,z:number,t:number}[]} */ places: [],
    captionNext: 0,
    lastEventAt: -9999,
    /** @type {Record<string, number>} */ illusionUsed: {},
    mothReports: 0,
    spawnedAt: now(),
    lastPillar: -9999,
    flareT: 0,
  };
}

/** @type {Map<string, P>} */
export const PS = new Map();

/** @param {import("@minecraft/server").Player} player */
export function getP(player) {
  let p = PS.get(player.id);
  if (!p) {
    p = makeP(player);
    PS.set(player.id, p);
  }
  return p;
}

/** @param {import("@minecraft/server").Player} player */
export function flushProfile(player) {
  const p = PS.get(player.id);
  if (p && p.profDirty) {
    saveProfile(player, p.profile);
    p.profDirty = false;
  }
}

export function flushAll() {
  for (const pl of world.getAllPlayers()) flushProfile(pl);
}

/** @param {import("@minecraft/server").Player} pl */
export function eligible(pl) {
  try {
    const gm = pl.getGameMode();
    return gm !== GameMode.Creative && gm !== GameMode.Spectator;
  } catch {
    return false;
  }
}

/** Underground / darkness / depth update (cheap; called every 20 ticks). @param {import("@minecraft/server").Player} pl @param {P} p */
export function updateEnvironment(pl, p) {
  const dim = pl.dimension;
  if (dim.id !== "minecraft:overworld") {
    p.underground = false;
    p.ugTicks = 0;
    return;
  }
  const loc = pl.location;
  const head = { x: Math.floor(loc.x), y: Math.floor(loc.y + 1.6), z: Math.floor(loc.z) };
  let sky = 15;
  let light = 15;
  try { sky = dim.getSkyLightLevel(head); } catch { /* unloaded */ }
  try { light = dim.getLightLevel(head); } catch { /* unloaded */ }
  let top = 320;
  try {
    const tb = dim.getTopmostBlock({ x: head.x, z: head.z });
    if (tb) top = tb.location.y;
  } catch { /* ignore */ }
  const ug = (sky <= 4 && loc.y < top - 4) || loc.y < Math.min(top - 14, 30);
  p.underground = ug;
  p.light = light;
  p.depth = clamp((48 - loc.y) / 100, 0, 1);
  if (ug) { p.ugTicks += 20; p.surfTicks = 0; } else { p.surfTicks += 20; if (p.surfTicks > 200) p.ugTicks = 0; }
}

/** Movement + look-behind habit tracking (every 5 ticks). @param {import("@minecraft/server").Player} pl @param {P} p */
export function updateMotion(pl, p) {
  const loc = pl.location;
  if (p.lastPos) {
    const d = distXZ(loc, p.lastPos);
    if (d > 0.15) {
      p.moving += 5; p.still = 0; p.wasMovingTicks = p.moving;
    } else {
      p.still += 5;
      if (p.still > 10) p.moving = 0;
    }
  }
  p.lastPos = { x: loc.x, y: loc.y, z: loc.z };
  try {
    const yaw = pl.getRotation().y;
    let dy = Math.abs(((yaw - p.lastYaw + 540) % 360) - 180);
    if (dy > 120) p.turnBacks++;
    p.lastYaw = yaw;
  } catch { /* ignore */ }
}

/** Detects straight strip-mined tunnels from recent block breaks. @param {P} p */
export function detectTunnel(p) {
  const b = p.breaks;
  if (b.length < 10) { p.tunnel = null; return; }
  const recent = b.slice(-24);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = distXZ(first, last);
  if (span < 8) { p.tunnel = null; return; }
  const dir = flat({ x: last.x - first.x, y: 0, z: last.z - first.z });
  // most breaks must lie close to the line first->last
  let onLine = 0;
  for (const r of recent) {
    const rel = { x: r.x - first.x, y: 0, z: r.z - first.z };
    const along = dot(rel, dir);
    const px = rel.x - dir.x * along;
    const pz = rel.z - dir.z * along;
    if (Math.sqrt(px * px + pz * pz) < 1.6 && Math.abs(r.y - first.y) < 3) onLine++;
  }
  if (onLine / recent.length > 0.75) {
    p.tunnel = { start: { x: first.x + 0.5, y: first.y, z: first.z + 0.5 }, dir, len: span, t: now() };
  } else p.tunnel = null;
}

/** player head-room check (is the player in a 1-block-high space?) @param {import("@minecraft/server").Player} pl */
export function inLowSpace(pl) {
  const l = pl.location;
  return solid(getBlock(pl.dimension, { x: l.x, y: l.y + 1.2, z: l.z }));
}

export { dist };
