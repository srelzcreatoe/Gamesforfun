// Thin, defensive wrappers around the stable world APIs used everywhere.

import { world, BlockPermutation, BlockVolume, ListBlockVolume } from '@minecraft/server';
import { ORIGIN } from '../data/layout.js';
import { PALETTE } from '../data/palette.js';
import { log } from './log.js';

/** @returns {import('@minecraft/server').Dimension} */
export function dim() {
  return world.getDimension('overworld');
}

/** Local -> world location. */
export function W(x, y, z) {
  return { x: x + ORIGIN.x, y: y + ORIGIN.y, z: z + ORIGIN.z };
}

export function Wv(v) {
  return { x: v.x + ORIGIN.x, y: v.y + ORIGIN.y, z: v.z + ORIGIN.z };
}

/** World -> local location. */
export function L(v) {
  return { x: v.x - ORIGIN.x, y: v.y - ORIGIN.y, z: v.z - ORIGIN.z };
}

const perms = new Map();
/** BlockPermutation for a palette key (cached). Throws if the key or states are invalid. */
export function perm(key) {
  let p = perms.get(key);
  if (!p) {
    const b = PALETTE[key];
    if (!b) throw new Error(`unknown palette key ${key}`);
    p = BlockPermutation.resolve(b.name, b.states ?? {});
    perms.set(key, p);
  }
  return p;
}

/** Validate every palette entry resolves in this game version. Returns failures. */
export function checkPalette() {
  const bad = [];
  for (const key of Object.keys(PALETTE)) {
    try {
      perm(key);
    } catch (e) {
      bad.push(`${key}: ${e?.message ?? e}`);
    }
  }
  return bad;
}

export function runCmd(cmd) {
  try {
    return dim().runCommand(cmd).successCount;
  } catch (e) {
    log.warn(`command failed: ${cmd} :: ${e?.message ?? e}`);
    return -1;
  }
}

export function isLoadedLocal(x, y, z) {
  try {
    return dim().isChunkLoaded(W(x, y, z));
  } catch {
    return false;
  }
}

export function fillLocal(x1, y1, z1, x2, y2, z2, key, airOnly = false) {
  const opts = airOnly ? { blockFilter: { includeTypes: ['minecraft:air'] } } : undefined;
  dim().fillBlocks(new BlockVolume(W(x1, y1, z1), W(x2, y2, z2)), perm(key), opts);
}

export function listLocal(key, flat) {
  const locs = [];
  for (let i = 0; i < flat.length; i += 3) locs.push(W(flat[i], flat[i + 1], flat[i + 2]));
  dim().fillBlocks(new ListBlockVolume(locs), perm(key));
}

export function setLocal(x, y, z, key) {
  dim().setBlockPermutation(W(x, y, z), perm(key));
}

/** Block type id at a local position, or undefined when unloaded. */
export function typeAtLocal(x, y, z) {
  try {
    return dim().getBlock(W(x, y, z))?.typeId;
  } catch {
    return undefined;
  }
}

export function playersAll() {
  return world.getAllPlayers();
}
