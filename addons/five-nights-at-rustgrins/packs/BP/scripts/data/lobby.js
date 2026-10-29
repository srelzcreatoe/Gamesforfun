// The time-clock lobby in the Staff Room: one vanilla button per menu action
// on the north wall (z = 52, facing south) with a wall sign above it.

const L = (id, x, lines) => Object.freeze({ id, x, z: 52, lines: Object.freeze(lines) });

export const LOBBY_BUTTONS = Object.freeze([
  L('new_game', 2, ['', 'NEW GAME', 'Night 1']),
  L('continue', 3, ['', 'CONTINUE', '']),
  L('night6', 4, ['NIGHT 6', 'THE FINAL', 'ACT']),
  L('custom', 5, ['', 'CUSTOM', 'NIGHT']),
  L('free_roam', 7, ['', 'FREE ROAM', 'Daytime']),
  L('gallery', 9, ['', 'GALLERY', '']),
  L('clippings', 10, ['', 'CLIPPINGS', '']),
  L('settings', 11, ['', 'SETTINGS', '']),
  L('erase', 13, ['', 'ERASE', 'PROGRESS']),
]);
export const LOBBY_BUTTON_AT = Object.freeze(Object.fromEntries(LOBBY_BUTTONS.map((b) => [`${b.x},1,${b.z}`, b.id])));

/** Star slots on the terminal wall (stage_star blocks appear when earned). */
export const STAR_SLOTS = Object.freeze([[5, 4, 52], [8, 4, 52], [11, 4, 52]]);
