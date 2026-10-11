// Morgrave and Valek (1.4): the two of them come to the office only through the LEFT door, the
// RIGHT door and the CEILING VENT above the office (entry 'V'). They do not walk the route graph:
// they come out of the walls (Morgrave) or out of the dark (Valek) at fixed spots, so these are
// puppet positions, not route nodes (tools/validate_map.mjs checks them separately).
// Local coordinates; yaw: Minecraft yaw (atan2(-dx, dz)).

/** The ceiling vent: a 2x2 grate in the crawlspace floor above the office, over a hole in the office ceiling. */
export const CEILING_VENT = Object.freeze({
  x1: 101, z1: 127, x2: 102, z2: 128,
  holeY: 6, // the office ceiling layer, cut open
  grateY: 7, // the crawlspace floor: iron trapdoors (top half, flush with the crawl floor)
  center: Object.freeze({ x: 102.0, y: 7.9, z: 128.0 }),
  lamp: Object.freeze([104, 3, 126]), // grate indicator on the office's north wall
});

/** Entry labels for captions and the HUD. */
export const VISIT_LABEL = Object.freeze({ L: 'LEFT DOOR', R: 'RIGHT DOOR', V: 'CEILING VENT' });
export const VISIT_ENTRIES = Object.freeze(['L', 'R', 'V']);

/**
 * Morgrave: where he knocks, and where he goes when you let him by (he walks past the doorway,
 * or crawls past over the grate, then goes back into the walls).
 */
export const MORGRAVE_SPOTS = Object.freeze({
  L: Object.freeze({ knock: Object.freeze({ x: 92.6, y: 0, z: 128.3, yaw: -90 }), past: Object.freeze({ x: 91.6, y: 0, z: 133.0, yaw: 0 }), anim: 'threat', passAnim: 'walk' }),
  R: Object.freeze({ knock: Object.freeze({ x: 107.4, y: 0, z: 128.3, yaw: 90 }), past: Object.freeze({ x: 109.4, y: 0, z: 133.0, yaw: 0 }), anim: 'threat', passAnim: 'walk' }),
  V: Object.freeze({ knock: Object.freeze({ x: 104.6, y: 8, z: 127.9, yaw: 90 }), past: Object.freeze({ x: 97.6, y: 8, z: 127.9, yaw: 90 }), anim: 'crawl', passAnim: 'crawl' }),
});

/**
 * Valek: where his eyes show, for each entry and stage. Only his eyes are drawn (fb:variant 1), so
 * the body may sit in the floor; what matters is that the eyes are visible from the office:
 * through the window next to each door (always see-through, so a closed door never hides him),
 * and through the vent grate (looking up). `eye` is the point the player has to look at.
 */
export const VALEK_SPOTS = Object.freeze({
  L: Object.freeze({
    far: Object.freeze({ eye: Object.freeze({ x: 91.2, y: 1.8, z: 133.2 }), yaw: -90 }),
    near: Object.freeze({ eye: Object.freeze({ x: 93.3, y: 1.7, z: 132.6 }), yaw: -90 }),
  }),
  R: Object.freeze({
    far: Object.freeze({ eye: Object.freeze({ x: 108.8, y: 1.8, z: 133.2 }), yaw: 90 }),
    near: Object.freeze({ eye: Object.freeze({ x: 106.7, y: 1.7, z: 132.6 }), yaw: 90 }),
  }),
  V: Object.freeze({
    far: Object.freeze({ eye: Object.freeze({ x: 102.2, y: 8.6, z: 127.2 }), yaw: 180 }),
    near: Object.freeze({ eye: Object.freeze({ x: 101.9, y: 6.9, z: 128.1 }), yaw: 180 }),
  }),
});
/** Valek's eye height above his feet in blocks (EYE_HEIGHT x SCALE in mc/game.js; checked by tools/validate_assets.mjs). */
export const VALEK_EYE = 2.995;
