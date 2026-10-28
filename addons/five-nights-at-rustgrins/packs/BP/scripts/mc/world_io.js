// Thin, defensive wrappers around the world APIs: local <-> world coordinates
// (the origin is chosen by /fnar:setup), cached block permutations for
// palette keys and picture tiles, fills, single blocks, commands.

import { world, BlockPermutation, BlockVolume, ListBlockVolume } from '@minecraft/server';
import { PALETTE, pictureBlock } from '../data/palette.js';
import { loadOrigin } from './persistence.js';
import { log } from './log.js';

/** World position of local (0, 0, 0). */
export const origin = { x: 0, y: -60, z: 0, set: false };

export function refreshOrigin() {
  const o = loadOrigin();
  if (o) Object.assign(origin, { x: Math.floor(o.x), y: Math.floor(o.y), z: Math.floor(o.z), set: true });
  return origin.set;
}

export function setOrigin(v) {
  Object.assign(origin, { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z), set: true });
}

/** @returns {import('@minecraft/server').Dimension} */
export function dim() {
  return world.getDimension('overworld');
}

/** Local -> world location. */
export function W(x, y, z) {
  return { x: x + origin.x, y: y + origin.y, z: z + origin.z };
}

export function Wv(v) {
  return { x: v.x + origin.x, y: v.y + origin.y, z: v.z + origin.z };
}

/** World -> local location. */
export function L(v) {
  return { x: v.x - origin.x, y: v.y - origin.y, z: v.z - origin.z };
}

const perms = new Map();
/** BlockPermutation for a palette key or a "pic:name:tile:dir" key (cached). Throws if invalid. */
export function perm(key) {
  let p = perms.get(key);
  if (p) return p;
  let b;
  if (key.startsWith('pic:')) {
    const [, name, tile, dir] = key.split(':');
    b = pictureBlock(name, Number(tile), dir);
  } else {
    b = PALETTE[key];
  }
  if (!b) throw new Error(`unknown palette key ${key}`);
  p = BlockPermutation.resolve(b.name, b.states ?? {});
  perms.set(key, p);
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

/**
 * Fill a local box. `filter`: true = only replace air, a string[] = only replace those block types.
 * @param {boolean | string[]} [filter]
 */
export function fillLocal(x1, y1, z1, x2, y2, z2, key, filter = false) {
  const types = filter === true ? ['minecraft:air'] : Array.isArray(filter) ? filter : null;
  const opts = types ? { blockFilter: { includeTypes: types } } : undefined;
  dim().fillBlocks(new BlockVolume(W(x1, y1, z1), W(x2, y2, z2)), perm(key), opts);
}

export function listLocal(key, flat) {
  const locs = [];
  for (let i = 0; i < flat.length; i += 3) locs.push(W(flat[i], flat[i + 1], flat[i + 2]));
  dim().fillBlocks(new ListBlockVolume(locs), perm(key));
}

export function setLocal(x, y, z, key) {
  try {
    dim().setBlockPermutation(W(x, y, z), perm(key));
    return true;
  } catch (e) {
    log.warn(`setLocal ${key} @${x},${y},${z}: ${e?.message ?? e}`);
    return false;
  }
}

/** Block at a local position, or undefined when unloaded. */
export function blockAt(x, y, z) {
  try {
    return dim().getBlock(W(x, y, z));
  } catch {
    return undefined;
  }
}

export function typeAtLocal(x, y, z) {
  return blockAt(x, y, z)?.typeId;
}

/** Set one state on the block at a local position (keeps the other states). */
export function setStateLocal(x, y, z, state, value) {
  const b = blockAt(x, y, z);
  if (!b) return false;
  try {
    b.setPermutation(b.permutation.withState(state, value));
    return true;
  } catch (e) {
    log.warn(`setState ${state}=${value} @${x},${y},${z} (${b.typeId}): ${e?.message ?? e}`);
    return false;
  }
}
