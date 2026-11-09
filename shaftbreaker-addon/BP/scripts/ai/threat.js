// @ts-check
// Shared, read-only view of the current threat for the audio/illusion/moth systems (avoids import cycles).
export const T = {
  /** @type {any} */ brain: null, // active creature brain (see dweller.js) or null
  /** @type {import("@minecraft/server").Entity[]} */ phantoms: [],
  finalPending: false,
};

/** Distance from a player to the active creature (Infinity if none / other dimension). */
export function threatDist(pl) {
  const b = T.brain;
  if (!b || !b.e) return Infinity;
  try {
    if (!b.e.isValid || b.e.dimension.id !== pl.dimension.id) return Infinity;
    const a = b.e.location;
    const l = pl.location;
    return Math.sqrt((a.x - l.x) ** 2 + (a.y - l.y) ** 2 + (a.z - l.z) ** 2);
  } catch {
    return Infinity;
  }
}
