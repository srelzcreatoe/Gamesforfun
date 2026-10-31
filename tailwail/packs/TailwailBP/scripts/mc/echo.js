// Echoes: hallucinations.  A body-double of Tailwail frozen in one pose
// (tailwail:echo, no AI, no collision, cannot be hurt) that exists only for a moment:
// at the edge of your vision, at the foot of your bed, right behind you.
import { system, world } from "@minecraft/server";
import { ECHO_ID, ENTITY_ID } from "../config.js";
import { ECHO_POSE } from "../core/ids.js";
import { dlog } from "./log.js";

/** @type {Map<string, {e: import("@minecraft/server").Entity, until: number, onTick?: Function}>} */
const live = new Map();
const DIM_IDS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
let realGate = () => false; // set by the director: is a real Tailwail out, or about to be?

/** The director tells the echoes when a real Tailwail is out or being spawned. */
export function setRealGate(fn) {
  realGate = fn;
}

/** Is any real Tailwail body in the world (any dimension)? */
function realOneExists() {
  for (const id of DIM_IDS) {
    try {
      if (world.getDimension(id).getEntities({ type: ENTITY_ID }).length > 0) return true;
    } catch {
      /* dimension unavailable */
    }
  }
  return false;
}

export function spawnEcho(dim, pos, yaw, pose, lifeSeconds, onTick) {
  // only ONE Tailwail may ever be seen: no hallucination while another hallucination, or the
  // real one (anywhere, or about to spawn), exists
  if (live.size > 0) return null;
  try {
    if (realGate() || realOneExists()) return null;
  } catch {
    return null;
  }
  let e;
  try {
    e = dim.spawnEntity(ECHO_ID, { x: pos.x, y: pos.y, z: pos.z }, { initialRotation: yaw });
    e.setProperty("tailwail:echo_pose", ECHO_POSE[pose] ?? 0);
  } catch (err) {
    dlog("echo spawn", err);
    return null;
  }
  live.set(e.id, { e, until: system.currentTick + Math.round(lifeSeconds * 20), onTick });
  return e;
}

export function removeEcho(e) {
  if (!e) return;
  live.delete(e.id);
  try {
    if (e.isValid) e.remove();
  } catch {
    /* gone */
  }
}

/** Called every few ticks: expire echoes, run their per-tick vanish checks. */
export function tickEchoes() {
  const now = system.currentTick;
  for (const [id, rec] of live) {
    if (!rec.e.isValid) {
      live.delete(id);
      continue;
    }
    let vanish = now >= rec.until;
    if (!vanish && rec.onTick) {
      try {
        vanish = !!rec.onTick(rec.e);
      } catch {
        vanish = true;
      }
    }
    if (vanish) removeEcho(rec.e);
  }
}

/** Echoes never persist: anything left over from a previous session is removed. */
export function sweepEchoes() {
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    try {
      for (const e of world.getDimension(id).getEntities({ type: ECHO_ID })) if (!live.has(e.id)) e.remove();
    } catch {
      /* dimension unavailable */
    }
  }
}

export function echoCount() {
  return live.size;
}

/** A real Tailwail is appearing: every hallucination vanishes first, so there is only ever one. */
export function removeAllEchoes() {
  for (const rec of [...live.values()]) removeEcho(rec.e);
  for (const id of DIM_IDS) {
    try {
      for (const e of world.getDimension(id).getEntities({ type: ECHO_ID })) e.remove();
    } catch {
      /* dimension unavailable */
    }
  }
}
