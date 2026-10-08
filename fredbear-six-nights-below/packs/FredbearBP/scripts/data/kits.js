// Room decoration kits. Each kit dresses one room inside its interior using
// the PlanBuilder reservation grid (routes, doorways, stairs and consoles stay
// clear). Kits also place their room's signs during the final 'signs' pass.

import { OPENINGS, interior } from './layout.js';
import { pixelText, textWidth } from './font.js';
import { STORY_SIGNS } from './story.js';
import { CAMERAS } from './cameras.js';
import { NODE_BY_ID } from './nodes.js';

// Camera view rays (segments) so airborne props can stay out of them.
const RAYS = CAMERAS.flatMap((c) => c.sees.map((id) => {
  const n = NODE_BY_ID[id];
  return [c.loc, [n.x, n.y + 1.3, n.z]];
}));
function nearCameraRay(x, y, z, r = 1.6) {
  const p = [x + 0.5, y + 0.5, z + 0.5];
  for (const [a, b] of RAYS) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L));
    const d = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
    if (d < r) return true;
  }
  return false;
}

// ------------------------------------------------------------------ helpers
const openingCells = new Set();
for (const o of OPENINGS) {
  for (let a = o.a1 - 1; a <= o.a2 + 1; a++) for (let y = o.y1 - 1; y <= o.y2 + 1; y++) {
    openingCells.add(o.axis === 'x' ? `${o.c}:${y}:${a}` : `${a}:${y}:${o.c}`);
  }
}
const isOpening = (x, y, z) => openingCells.has(`${x}:${y}:${z}`);

function lights(P, room, level, spacing, fixture = 'white_sg', { offset = 0, skipChance = 0 } = {}) {
  const i = interior(room);
  for (let x = i.x1 + 2 + offset; x <= i.x2 - 1; x += spacing) {
    for (let z = i.z1 + 2 + offset; z <= i.z2 - 1; z += spacing) {
      if (skipChance && P.rng.chance(skipChance)) {
        P.set(x, i.ceilY, z, 'redstone_lamp'); // dead fixture
        continue;
      }
      P.set(x, i.ceilY, z, fixture);
      if (level > 0) P.set(x, i.ceilY - 1, z, `light_${level}`);
    }
  }
}

function hanging(P, x, z, topY, len, lamp = 'lantern_hang') {
  for (let y = topY - len; y < topY; y++) if (nearCameraRay(x, y, z)) return;
  for (let y = topY - 1; y > topY - len; y--) P.set(x, y, z, 'iron_chain');
  P.set(x, topY - len, z, lamp);
}

function webs(P, room, count) {
  const i = interior(room);
  for (let n = 0; n < count; n++) {
    const x = P.rng.chance(0.5) ? i.x1 : i.x2;
    const z = P.rng.int(i.z1, i.z2);
    const xx = P.rng.chance(0.5) ? x : P.rng.int(i.x1, i.x2);
    const zz = xx === x ? z : P.rng.chance(0.5) ? i.z1 : i.z2;
    if (!P.isFree(room.level, xx, zz)) continue; // never on ladders, doorways or routes
    P.set(xx, i.ceilY - 1, zz, 'web');
  }
}

/** Posters: 1x2 glazed panels replacing wall blocks (never in doorways). */
function posters(P, room, count, keys = ['glazed_yellow', 'glazed_purple', 'glazed_red', 'glazed_magenta', 'glazed_cyan', 'glazed_orange']) {
  const i = interior(room);
  const [bx1, bz1, bx2, bz2] = room.box;
  const y = i.y1 + 2;
  for (let n = 0; n < count; n++) {
    for (let t = 0; t < 20; t++) {
      const side = P.rng.int(0, 3);
      let x;
      let z;
      if (side < 2) {
        x = P.rng.int(i.x1 + 1, i.x2 - 1);
        z = side === 0 ? bz1 : bz2;
      } else {
        z = P.rng.int(i.z1 + 1, i.z2 - 1);
        x = side === 2 ? bx1 : bx2;
      }
      if (isOpening(x, y, z) || isOpening(x, y + 1, z)) continue;
      const k = P.rng.pick(keys);
      P.set(x, y, z, k);
      P.set(x, y + 1, z, k);
      break;
    }
  }
}

/**
 * Wall sign facing into the room on the given side ('n','s','w','e').
 * @param {{ along?: number, dy?: number, wood?: string }} [opts]
 */
function wallSign(P, room, side, text, opts = {}) {
  const { along, dy = 2, wood = 'sign' } = opts;
  const i = interior(room);
  const y = i.y1 + dy;
  const span = side === 'n' || side === 's' ? [i.x1 + 1, i.x2 - 1] : [i.z1 + 1, i.z2 - 1];
  const tryAt = (a) => {
    let x;
    let z;
    let wallX;
    let wallZ;
    let facing;
    if (side === 'n') [x, z, wallX, wallZ, facing] = [a, i.z1, a, room.box[1], 'south'];
    else if (side === 's') [x, z, wallX, wallZ, facing] = [a, i.z2, a, room.box[3], 'north'];
    else if (side === 'w') [x, z, wallX, wallZ, facing] = [i.x1, a, room.box[0], a, 'east'];
    else [x, z, wallX, wallZ, facing] = [i.x2, a, room.box[2], a, 'west'];
    if (isOpening(wallX, y, wallZ)) return false;
    if (P.claimed.has(`${room.level}:${x}:${z}`)) return false;
    P.sign(x, y, z, facing, text, wood);
    return true;
  };
  const mid = along ?? Math.floor((span[0] + span[1]) / 2);
  for (let d = 0; d <= span[1] - span[0]; d++) {
    if (mid + d <= span[1] && tryAt(mid + d)) return true;
    if (mid - d >= span[0] && tryAt(mid - d)) return true;
  }
  return false;
}

/** True if a column of blocks at (x, z) from y1..y2 stays clear of every camera ray. */
function columnClear(x, z, y1, y2) {
  for (let y = y1; y <= y2; y++) if (nearCameraRay(x, y, z, 1.2)) return false;
  return true;
}

function crate(P, x, y, z, h = 1) {
  while (h > 1 && !columnClear(x, z, y, y + h - 1)) h--;
  if (!columnClear(x, z, y, y)) return;
  for (let k = 0; k < h; k++) P.set(x, y + k, z, P.rng.chance(0.5) ? 'barrel' : 'spruce');
}

function partyTable(P, x, y, z, len, axis = 'x') {
  for (let k = 0; k < len; k++) {
    const tx = axis === 'x' ? x + k : x;
    const tz = axis === 'x' ? z : z + k;
    P.set(tx, y, tz, 'quartz_slab_top');
    const r = P.rng.next();
    if (r < 0.12) P.set(tx, y + 1, tz, 'cake');
    else if (r < 0.2) P.set(tx, y + 1, tz, 'cake_bitten');
    else if (r < 0.45) P.set(tx, y + 1, tz, P.rng.pick(['red_carpet', 'yellow_carpet', 'purple_carpet', 'blue_carpet']));
    else if (r < 0.52) P.set(tx, y + 1, tz, 'flower_pot');
    // chairs either side
    const c1 = axis === 'x' ? [tx, tz - 1] : [tx - 1, tz];
    const c2 = axis === 'x' ? [tx, tz + 1] : [tx + 1, tz];
    if (P.rng.chance(0.85)) P.set(c1[0], y, c1[1], axis === 'x' ? 'dark_oak_stairs-z' : 'dark_oak_stairs-x');
    if (P.rng.chance(0.85)) P.set(c2[0], y, c2[1], axis === 'x' ? 'dark_oak_stairs+z' : 'dark_oak_stairs+x');
  }
}

function arcadeCabinet(P, x, y, z, lit) {
  P.set(x, y, z, P.rng.pick(['purple_c', 'blue_c', 'red_c', 'black_c', 'yellow_c']));
  P.set(x, y + 1, z, lit ? P.rng.pick(['sea_lantern', 'verdant', 'pearl']) : 'black_sg');
}

function spareHead(P, x, y, z, color, facing) {
  P.set(x, y, z, color);
  P.set(x + (facing === 'east' ? 1 : facing === 'west' ? -1 : 0), y, z + (facing === 'south' ? 1 : facing === 'north' ? -1 : 0), `eye_button_${facing}`);
}

function rugAt(P, i, y, keys, chance) {
  for (let x = i.x1; x <= i.x2; x++) for (let z = i.z1; z <= i.z2; z++) {
    if (P.rng.chance(chance)) P.set(x, y, z, P.rng.pick(keys));
  }
}

// ------------------------------------------------------------------ kits
const KITS = {
  stage(P, room, i) {
    const y = i.y1;
    // Raised platform (top at y=0, performers stand at y=1).
    P.fill(82, y, 14, 118, y, 30, 'dark_oak');
    P.fill(82, y, 30, 118, y, 30, 'stripped_dark_oak');
    for (const x of [86, 87, 88, 112, 113, 114]) P.set(x, y, 31, 'dark_oak_stairs-z');
    // Backdrop with stars and banner.
    P.fill(77, y, 13, 123, y + 12, 13, 'black_c');
    for (let n = 0; n < 40; n++) P.set(P.rng.int(78, 122), P.rng.int(y + 3, y + 12), 13, P.rng.chance(0.7) ? 'yellow_c' : 'white_c');
    const text = 'CELEBRATE!';
    const w = textWidth(text);
    pixelText(P, text, 100 - Math.floor(w / 2), y + 10, 13, 'x', 'red_c');
    // Side curtains and speaker stacks.
    for (const [x1, x2] of [[77, 81], [119, 123]]) P.fill(x1, y + 1, 37, x2, y + 12, 39, 'red_wool');
    for (const x of [83, 117]) {
      P.set(x, y + 1, 15, 'noteblock');
      P.set(x, y + 2, 15, 'black_c');
      P.set(x, y + 3, 15, 'noteblock');
    }
    // Spotlights on the three performers and the catwalk overhead.
    for (const [x, z] of [[100, 22], [93, 23], [107, 23]]) P.set(x, y + 6, z, 'light_9');
    P.fill(77, 7, 13, 123, 7, 16, 'dark_oak');
    P.fill(77, 8, 17, 123, 8, 17, 'iron_bars');
    for (let x = 80; x <= 120; x += 8) hanging(P, x, 18, 14, 4, 'lantern_hang');
    lights(P, room, 0, 9, 'redstone_lamp');
  },
  dining(P, room, i) {
    const y = i.y1;
    // Pillars every 16 blocks.
    for (let x = 68; x <= 132; x += 16) for (const z of [56, 84]) {
      if (P.canPlace('L1', i, x, z, 1, 1) && columnClear(x, z, y, i.ceilY - 1)) {
        P.claim('L1', x, z);
        P.fill(x, y, z, x, i.ceilY - 1, z, 'quartz');
        P.set(x, y + 9, z, 'light_7');
      }
    }
    // Rows of party tables.
    for (let z = 45; z <= 95; z += 5) {
      for (let x = 55; x <= 143; x += 1) {
        if (!P.canPlace('L1', i, x, z - 1, 4, 3)) continue;
        P.claim('L1', x - 1, z - 1, 6, 3);
        partyTable(P, x, y, z, 4, 'x');
        x += 5;
      }
    }
    rugAt(P, i, y, ['yellow_carpet', 'purple_carpet', 'red_carpet', 'blue_carpet'], 0.01);
    // Hanging cold lights and balloons.
    for (let x = 60; x <= 140; x += 12) for (let z = 48; z <= 92; z += 14) hanging(P, x, z, i.ceilY, 4, P.rng.chance(0.4) ? 'soul_lantern_hang' : 'lantern_hang');
    for (let n = 0; n < 30; n++) {
      const x = P.rng.int(i.x1, i.x2);
      const z = P.rng.int(i.z1, i.z2);
      const by = P.rng.int(9, 11);
      if (nearCameraRay(x, by, z)) continue;
      P.set(x, by, z, P.rng.pick(['red_wool', 'yellow_wool', 'blue_wool', 'purple_wool', 'lime_wool']));
    }
    posters(P, room, 10);
    webs(P, room, 12);
  },
  backstage(P, room, i) {
    const y = i.y1;
    const colors = ['brown_wool', 'purple_wool', 'yellow_wool', 'yellow_wool'];
    // Shelves of spare heads along the north wall.
    for (let x = i.x1; x <= i.x2; x++) {
      if (!P.isFree('L1', x, i.z1)) continue;
      P.claim('L1', x, i.z1);
      P.set(x, y, i.z1, 'spruce');
      P.set(x, y + 1, i.z1, 'spruce_slab_top');
      if (P.rng.chance(0.6)) spareHead(P, x, y + 2, i.z1, P.rng.pick(colors), 'south');
    }
    P.scatter('L1', i, 6, 1, 1, (x, z) => crate(P, x, y, z, P.rng.int(1, 2)));
    P.scatter('L1', i, 3, 1, 1, (x, z) => {
      P.set(x, y, z, 'iron_bars');
      P.set(x, y + 1, z, 'iron_bars');
    });
    lights(P, room, 3, 8, 'white_sg', { skipChance: 0.4 });
    webs(P, room, 6);
  },
  parts(P, room, i) {
    const y = i.y1;
    // Endoskeleton racks (bars + chains) along the west wall.
    for (let z = i.z1 + 10; z <= i.z2 - 2; z += 3) {
      if (!P.canPlace('L1', i, i.x1, z, 2, 1)) continue;
      P.claim('L1', i.x1, z, 2, 1);
      P.fill(i.x1, y, z, i.x1, y + 2, z, 'iron_bars');
      P.set(i.x1 + 1, y + 3, z, 'iron_chain');
      P.set(i.x1 + 1, y + 2, z, P.rng.pick(['brown_wool', 'purple_wool', 'yellow_wool']));
    }
    P.scatter('L1', i, 4, 2, 1, (x, z) => {
      P.set(x, y, z, 'crafting_table');
      P.set(x + 1, y, z, P.rng.pick(['anvil', 'loom', 'smoker']));
    });
    P.scatter('L1', i, 10, 1, 1, (x, z) => crate(P, x, y, z, P.rng.int(1, 3)));
    P.scatter('L1', i, 3, 1, 1, (x, z) => spareHead(P, x, y, z, P.rng.pick(['brown_wool', 'purple_wool']), 'south'));
    lights(P, room, 4, 8, 'white_sg', { skipChance: 0.3 });
    webs(P, room, 8);
  },
  props(P, room, i) {
    const y = i.y1;
    for (let x = i.x1 + 1; x <= i.x2 - 3; x += 3) {
      for (const z of [i.z1 + 2, i.z2 - 2]) {
        if (!P.canPlace('L1', i, x, z, 2, 1)) continue;
        P.claim('L1', x, z, 2, 1);
        P.set(x, y + 2, z, 'oak_fence');
        P.set(x + 1, y + 2, z, 'oak_fence');
        P.set(x, y + 1, z, P.rng.pick(['brown_wool', 'purple_wool', 'yellow_wool', 'red_wool']));
        P.set(x + 1, y + 1, z, P.rng.pick(['brown_wool', 'purple_wool', 'yellow_wool', 'white_wool']));
      }
    }
    P.scatter('L1', i, 8, 1, 1, (x, z) => crate(P, x, y, z, P.rng.int(1, 2)));
    lights(P, room, 3, 8, 'white_sg', { skipChance: 0.3 });
    webs(P, room, 5);
  },
  kitchen(P, room, i) {
    const y = i.y1;
    // Counters along the north wall.
    for (let x = i.x1; x <= i.x2; x++) {
      if (!P.isFree('L1', x, i.z1)) continue;
      P.claim('L1', x, i.z1);
      P.set(x, y, i.z1, (x % 5 === 0) ? 'smoker' : (x % 7 === 0) ? 'furnace' : 'smooth_quartz');
      if (P.rng.chance(0.3)) P.set(x, y + 1, i.z1, P.rng.pick(['cauldron', 'decorated_pot', 'flower_pot']));
    }
    // Central prep islands.
    for (const z of [22, 36]) {
      if (P.canPlace('L1', i, 154, z, 8, 2)) {
        P.claim('L1', 154, z, 8, 2);
        P.fill(154, y, z, 161, y, z + 1, 'iron_block');
        for (let x = 154; x <= 161; x++) if (P.rng.chance(0.3)) P.set(x, y + 1, z + P.rng.int(0, 1), P.rng.pick(['cauldron', 'cake_bitten', 'decorated_pot']));
      }
    }
    for (let x = 152; x <= 180; x += 6) hanging(P, x, 28, i.ceilY, 2, 'iron_chain');
    rugAt(P, i, y, ['red_carpet'], 0.01);
    P.scatter('L1', i, 6, 1, 1, (x, z) => crate(P, x, y, z, 2), { edge: true });
    lights(P, room, 2, 9, 'white_sg', { skipChance: 0.5 });
    webs(P, room, 6);
  },
  pantry(P, room, i) {
    const y = i.y1;
    for (let x = i.x1 + 1; x <= i.x2 - 1; x += 2) {
      for (const z of [i.z1, i.z2]) {
        if (!P.isFree('L1', x, z)) continue;
        P.claim('L1', x, z);
        P.set(x, y, z, 'barrel');
        P.set(x, y + 1, z, P.rng.chance(0.5) ? 'hay' : 'barrel');
        P.set(x, y + 2, z, 'spruce_slab_top');
      }
    }
    lights(P, room, 2, 7, 'white_sg', { skipChance: 0.5 });
  },
  freezer(P, room, i) {
    const y = i.y1;
    for (let x = i.x1 + 1; x <= i.x2 - 1; x += 3) for (let z = i.z1 + 2; z <= i.z2 - 2; z += 4) {
      if (!P.isFree('L1', x, z)) continue;
      P.set(x, i.ceilY - 1, z, 'iron_chain');
      P.set(x, i.ceilY - 2, z, 'iron_chain');
      P.set(x, i.ceilY - 3, z, P.rng.chance(0.5) ? 'red_wool' : 'brown_wool');
    }
    P.scatter('L1', i, 8, 1, 1, (x, z) => P.set(x, y, z, P.rng.pick(['packed_ice', 'blue_ice', 'barrel'])), { edge: true });
    lights(P, room, 5, 6, 'white_sg');
  },
  corridor(P, room, i) {
    const along = i.x2 - i.x1 > i.z2 - i.z1;
    // Ceiling pipe run.
    if (along) P.fill(i.x1, i.ceilY - 1, i.z1, i.x2, i.ceilY - 1, i.z1, 'iron_bars');
    else P.fill(i.x1, i.ceilY - 1, i.z1, i.x1, i.ceilY - 1, i.z2, 'iron_bars');
    lights(P, room, room.dark ? 2 : 6, 8, 'white_sg', { skipChance: room.dark ? 0.4 : 0 });
    webs(P, room, 3);
  },
  stairwell(P, room, i) {
    // Upper landing platform at ground level beside the door (x 157..165, z 63..66).
    P.fill(157, -1, 63, 165, -1, 66, 'polished_andesite');
    P.fill(161, 0, 67, 165, 0, 67, 'iron_bars');
    P.fill(161, 0, 67, 161, 0, 74, 'iron_bars');
    P.fill(157, 0, 67, 157, 0, 66, 'air');
    lights(P, room, 3, 6, 'white_sg');
  },
  restroom(P, room, i) {
    const y = i.y1;
    // Stalls along the far wall.
    for (let x = i.x1 + 1; x <= i.x2 - 2; x += 3) {
      if (!P.canPlace('L1', i, x, i.z2 - 2, 3, 3)) continue;
      P.claim('L1', x, i.z2 - 2, 3, 3);
      P.fill(x, y, i.z2 - 2, x, y + 2, i.z2, 'lgray_c');
      P.set(x + 1, y, i.z2, 'quartz');
    }
    // Sinks and mirrors along the north wall.
    for (let x = i.x1 + 1; x <= i.x2 - 1; x += 2) {
      if (!P.isFree('L1', x, i.z1)) continue;
      P.claim('L1', x, i.z1);
      P.set(x, y, i.z1, 'cauldron');
      P.set(x, y + 2, room.box[1], 'glass');
    }
    lights(P, room, 3, 5, 'white_sg', { skipChance: 0.3 });
  },
  arcade(P, room, i) {
    const y = i.y1;
    for (let z = i.z1 + 2; z <= i.z2 - 2; z += 4) {
      for (let x = i.x1 + 2; x <= i.x2 - 2; x += 2) {
        if (!P.canPlace('L1', i, x, z, 1, 1)) continue;
        P.claim('L1', x, z);
        arcadeCabinet(P, x, y, z, P.rng.chance(0.35));
      }
    }
    rugAt(P, i, y, ['purple_carpet', 'blue_carpet', 'cyan_carpet'], 0.15);
    pixelText(P, 'ARCADE', 22, i.y1 + 5, room.box[1], 'x', 'yellow_c');
    lights(P, room, 2, 8, 'white_sg', { skipChance: 0.4 });
  },
  prize(P, room, i) {
    const y = i.y1;
    for (let x = i.x1; x <= i.x2; x++) {
      if (!P.isFree('L1', x, i.z1 + 4)) continue;
      P.claim('L1', x, i.z1 + 4);
      P.set(x, y, i.z1 + 4, 'white_c');
      P.set(x, y + 1, i.z1 + 4, 'quartz_slab_top');
    }
    for (let x = i.x1; x <= i.x2; x++) for (let k = 0; k < 3; k++) {
      if (!P.isFree('L1', x, i.z1)) continue;
      P.set(x, y + k, i.z1, P.rng.pick(['brown_wool', 'purple_wool', 'yellow_wool', 'white_wool', 'red_wool', 'barrel']));
    }
    lights(P, room, 5, 6, 'white_sg');
  },
  gift(P, room, i) {
    const y = i.y1;
    for (let z = i.z1 + 2; z <= i.z2 - 2; z += 4) {
      for (let x = i.x1 + 2; x <= i.x2 - 4; x += 6) {
        if (!P.canPlace('L1', i, x, z, 4, 1)) continue;
        P.claim('L1', x, z, 4, 1);
        P.fill(x, y, z, x + 3, y, z, 'spruce');
        for (let k = 0; k < 4; k++) if (P.rng.chance(0.7)) P.set(x + k, y + 1, z, P.rng.pick(['brown_wool', 'purple_wool', 'yellow_wool']));
      }
    }
    lights(P, room, 5, 7, 'white_sg');
  },
  cove(P, room, i) {
    const y = i.y1;
    // Mini stage behind a purple curtain with a gap (CAM 04 can glimpse inside).
    P.fill(i.x1, y, 46, 27, y, 65, 'dark_oak');
    P.fill(28, y, 46, 28, y + 4, 53, 'purple_wool');
    P.fill(28, y, 58, 28, y + 4, 65, 'purple_wool');
    P.fill(28, y + 3, 54, 28, y + 4, 57, 'purple_wool');
    for (let n = 0; n < 14; n++) P.set(room.box[0], P.rng.int(y + 1, y + 4), P.rng.int(46, 65), P.rng.pick(['yellow_c', 'white_c']));
    pixelText(P, 'STARLIGHT', 17, i.y1 + 5, room.box[1], 'x', 'yellow_c');
    P.scatter('L1', i, 3, 3, 1, (x, z) => partyTable(P, x, y, z, 3, 'x'));
    lights(P, room, 2, 9, 'white_sg', { skipChance: 0.5 });
    webs(P, room, 8);
  },
  party(P, room, i) {
    const y = i.y1;
    P.scatter('L1', i, 2, 5, 3, (x, z) => partyTable(P, x, y, z + 1, 5, 'x'));
    P.scatter('L1', i, 5, 1, 1, (x, z) => {
      P.set(x, y, z, P.rng.pick(['red_wool', 'blue_wool', 'lime_wool', 'magenta_wool']));
      P.set(x, y + 1, z, P.rng.pick(['yellow_carpet', 'white_carpet']));
    }, { edge: true });
    for (let n = 0; n < 6; n++) {
      const x = P.rng.int(i.x1, i.x2);
      const z = P.rng.int(i.z1, i.z2);
      if (nearCameraRay(x, i.ceilY - 2, z)) continue;
      P.set(x, i.ceilY - 1, z, 'iron_chain');
      P.set(x, i.ceilY - 2, z, P.rng.pick(['red_wool', 'yellow_wool', 'blue_wool', 'purple_wool']));
    }
    posters(P, room, 3);
    lights(P, room, room.dark ? 2 : 5, 6, 'white_sg', { skipChance: 0.2 });
  },
  lockers(P, room, i) {
    const y = i.y1;
    for (let z = i.z1 + 1; z <= i.z2 - 1; z++) {
      for (const x of [i.x1, i.x2]) {
        if (!P.isFree('L1', x, z)) continue;
        P.claim('L1', x, z);
        P.fill(x, y, z, x, y + 2, z, z % 2 ? 'iron_block' : 'lgray_c');
      }
    }
    P.scatter('L1', i, 2, 3, 1, (x, z) => P.fill(x, y, z, x + 2, y, z, 'spruce_slab_top'));
    lights(P, room, 4, 6, 'white_sg');
  },
  supply(P, room, i) {
    const y = i.y1;
    for (let z = i.z1; z <= i.z2; z += 2) {
      if (!P.isFree('L1', i.x1, z)) continue;
      P.claim('L1', i.x1, z);
      P.fill(i.x1, y, z, i.x1, y + 2, z, 'barrel');
    }
    P.scatter('L1', i, 6, 1, 1, (x, z) => crate(P, x, y, z, P.rng.int(1, 2)));
    lights(P, room, 2, 6, 'white_sg', { skipChance: 0.5 });
    webs(P, room, 4);
  },
  hall(P, room, i) {
    posters(P, room, 6, ['glazed_yellow', 'glazed_purple', 'glazed_red', 'glazed_lime']);
    lights(P, room, 1, 7, 'redstone_lamp');
    webs(P, room, 4);
  },
  alcove(P, room, i) {
    // Hall-light fixture (the actuators place light blocks below it).
    P.set(i.x1 + 1, i.ceilY, i.z1 + 3, 'redstone_lamp');
    webs(P, room, 1);
  },
  office: officeKit,
  janitor(P, room, i) {
    const y = i.y1;
    P.scatter('L1', i, 5, 1, 1, (x, z) => P.set(x, y, z, P.rng.pick(['cauldron', 'barrel', 'oak_fence'])));
    lights(P, room, 2, 6, 'white_sg', { skipChance: 0.5 });
  },
  breakroom(P, room, i) {
    const y = i.y1;
    P.scatter('L1', i, 2, 4, 3, (x, z) => partyTable(P, x, y, z + 1, 4, 'x'));
    P.scatter('L1', i, 3, 1, 1, (x, z) => {
      P.fill(x, y, z, x, y + 1, z, 'iron_block');
      P.set(x, y + 2, z, 'glass');
    }, { edge: true });
    lights(P, room, 6, 6, 'white_sg');
  },
  lobby: lobbyKit,
  training(P, room, i) {
    const y = i.y1;
    // Rows of chairs facing a briefing screen on the north wall.
    for (let z = 132; z <= 144; z += 3) for (let x = 154; x <= 178; x += 2) {
      if (P.canPlace('L1', i, x, z, 1, 1)) {
        P.claim('L1', x, z);
        P.set(x, y, z, 'spruce_stairs+z');
      }
    }
    P.fill(156, y + 1, room.box[1] + 1, 176, y + 4, room.box[1] + 1, 'black_c');
    lights(P, room, 7, 6, 'white_sg');
  },
  reception(P, room, i) {
    const y = i.y1;
    // Ticket counters with queue rails.
    for (const x1 of [78, 108]) {
      if (P.canPlace('L1', i, x1, 142, 12, 1)) {
        P.claim('L1', x1, 142, 12, 1);
        P.fill(x1, y, 142, x1 + 11, y, 142, 'white_c');
        P.fill(x1, y + 1, 142, x1 + 11, y + 1, 142, 'quartz_slab_top');
      }
    }
    P.scatter('L1', i, 6, 1, 1, (x, z) => P.set(x, y, z, 'flower_pot'), { edge: true });
    P.scatter('L1', i, 4, 3, 1, (x, z) => P.fill(x, y, z, x + 2, y, z, 'dark_oak_slab'));
    lights(P, room, 5, 7, 'white_sg');
  },
  landing(P, room, i) {
    lights(P, room, 4, 6, 'white_sg');
  },
  golden(P, room, i) {
    const y = i.y1;
    P.fill(i.x1, y, i.z1, i.x2, y, i.z1 + 3, 'dark_oak');
    pixelText(P, 'GOLDEN', 75, i.y1 + 5, room.box[3], 'x', 'gold');
    P.scatter('L2', i, 2, 5, 3, (x, z) => partyTable(P, x, y, z + 1, 5, 'x'));
    lights(P, room, 3, 7, 'ochre', { skipChance: 0.3 });
    webs(P, room, 6);
  },
  server(P, room, i) {
    const y = i.y1;
    for (let x = i.x1 + 1; x <= i.x2 - 1; x += 3) {
      if (!P.canPlace('L2', i, x, i.z1 + 2, 1, 6)) continue;
      P.claim('L2', x, i.z1 + 2, 1, 6);
      for (let z = i.z1 + 2; z <= i.z1 + 7; z++) {
        P.set(x, y, z, 'iron_block');
        P.set(x, y + 1, z, P.rng.chance(0.4) ? 'redstone_lamp' : 'observer');
        P.set(x, y + 2, z, 'iron_block');
      }
    }
    lights(P, room, 4, 6, 'white_sg');
  },
  records(P, room, i) {
    const y = i.y1;
    for (let x = i.x1; x <= i.x2; x += 2) {
      if (!P.isFree('L2', x, i.z1)) continue;
      P.claim('L2', x, i.z1);
      P.fill(x, y, i.z1, x, y + 2, i.z1, P.rng.chance(0.5) ? 'bookshelf' : 'iron_block');
    }
    P.scatter('L2', i, 4, 1, 1, (x, z) => P.set(x, y, z, 'barrel'));
    lights(P, room, 4, 7, 'white_sg');
  },
  costume(P, room, i) {
    KITS.props(P, room, i);
  },
  crawl(P, room, i) {
    const lvl = room.level;
    P.scatter(lvl, i, Math.max(2, Math.floor((i.x2 - i.x1) / 8)), 1, 1, (x, z) => P.set(x, i.y1, z, 'barrel'));
    webs(P, room, 6);
    lights(P, room, 1, 10, 'redstone_lamp');
  },
  management(P, room, i) {
    const y = i.y1;
    if (P.canPlace('L2', i, 130, 121, 6, 2)) {
      P.claim('L2', 130, 121, 6, 2);
      P.fill(130, y, 121, 135, y, 122, 'dark_oak');
      P.set(132, y + 1, 121, 'flower_pot');
    }
    P.fill(146, y, 117, 147, y + 1, 117, 'iron_block');
    for (let z = i.z1; z <= i.z2; z += 2) if (P.isFree('L2', i.x1, z)) P.fill(i.x1, y, z, i.x1, y + 2, z, 'bookshelf');
    lights(P, room, 5, 7, 'white_sg');
  },
  attic(P, room, i) {
    const y = i.y1;
    P.scatter('L2', i, 40, 1, 1, (x, z) => crate(P, x, y, z, P.rng.int(1, 3)));
    webs(P, room, 14);
    lights(P, room, 1, 10, 'redstone_lamp');
  },
  loft(P, room, i) {
    const y = i.y1;
    P.scatter('L2', i, 8, 1, 1, (x, z) => crate(P, x, y, z, 1));
    for (let x = i.x1 + 2; x <= i.x2 - 2; x += 5) P.set(x, i.ceilY - 1, 26, 'iron_chain');
    lights(P, room, 2, 8, 'redstone_lamp');
    webs(P, room, 6);
  },
  landing_b(P, room, i) {
    lights(P, room, 3, 7, 'white_sg');
  },
  storage(P, room, i) {
    const y = i.y1;
    P.scatter('L0', i, 30, 1, 1, (x, z) => crate(P, x, y, z, P.rng.int(1, 3)));
    lights(P, room, 2, 8, 'white_sg', { skipChance: 0.4 });
    webs(P, room, 10);
  },
  boiler(P, room, i) {
    const y = i.y1;
    for (const [cx, cz] of [[86, 22], [100, 22], [114, 22], [86, 44], [114, 44], [86, 62], [114, 62]]) {
      if (!P.canPlace('L0', i, cx - 2, cz - 2, 5, 5)) continue;
      P.claim('L0', cx - 2, cz - 2, 5, 5);
      P.fill(cx - 1, y, cz - 1, cx + 1, y + 3, cz + 1, P.rng.chance(0.5) ? 'wcopper' : 'ocopper');
      P.fill(cx, y + 4, cz, cx, i.ceilY - 1, cz, 'iron_chain');
    }
    for (let x = i.x1; x <= i.x2; x += 1) P.set(x, i.ceilY - 1, i.z1 + 1, 'wcopper_grate');
    lights(P, room, 3, 9, 'white_sg', { skipChance: 0.3 });
    webs(P, room, 8);
  },
  cellar(P, room, i) {
    KITS.storage(P, room, i);
  },
  chamber(P, room, i) {
    const y = i.y1;
    // Golden shrine around Fredbear's dormant node.
    P.fill(30, y - 1, 33, 39, y - 1, 40, 'gold');
    P.fill(31, y - 1, 34, 38, y - 1, 39, 'yellow_t');
    for (const [x, z] of [[29, 32], [40, 32], [29, 41], [40, 41]]) {
      P.fill(x, y, z, x, y + 4, z, 'gilded');
      P.set(x, y + 5, z, 'shroomlight');
    }
    P.scatter('L0', i, 10, 1, 1, (x, z) => P.set(x, y, z, P.rng.pick(['crying_obsidian', 'amethyst', 'raw_gold'])), { edge: true });
    P.fill(room.box[0] + 1, y + 3, room.box[1] + 1, room.box[2] - 1, y + 3, room.box[1] + 1, 'purple_t');
    lights(P, room, 2, 10, 'ochre');
    webs(P, room, 10);
  },
  diner(P, room, i) {
    const y = i.y1;
    // The old diner stage (Fredbear's original stage) at the north.
    P.fill(26, y, 45, 54, y, 54, 'dark_oak');
    // Curtain parts at x 33-35 where the secret door behind the stage opens.
    P.fill(26, y + 1, i.z1, 32, y + 4, i.z1, 'red_wool');
    P.fill(36, y + 1, i.z1, 54, y + 4, i.z1, 'red_wool');
    P.fill(33, y + 4, i.z1, 35, y + 4, i.z1, 'red_wool');
    pixelText(P, 'FREDBEAR', 30, i.y1 + 5, room.box[3], 'x', 'yellow_c');
    // Booths along the west wall and a counter with stools on the east.
    for (let z = 60; z <= 92; z += 5) {
      if (!P.canPlace('L0', i, i.x1, z, 4, 3)) continue;
      P.claim('L0', i.x1, z, 4, 3);
      P.fill(i.x1, y, z, i.x1 + 3, y, z, 'red_c');
      P.fill(i.x1, y, z + 2, i.x1 + 3, y, z + 2, 'red_c');
      P.fill(i.x1 + 1, y, z + 1, i.x1 + 2, y, z + 1, 'quartz_slab_top');
    }
    for (let z = 62; z <= 90; z++) {
      if (!P.isFree('L0', 58, z)) continue;
      P.claim('L0', 58, z);
      P.set(58, y, z, 'red_c');
      P.set(58, y + 1, z, 'quartz_slab_top');
      if (z % 2 === 0 && P.isFree('L0', 56, z)) P.set(56, y, z, 'dark_oak_fence');
    }
    P.set(i.x1, y, 94, 'jukebox');
    P.scatter('L0', i, 3, 1, 1, (x, z) => arcadeCabinet(P, x, y, z, false));
    webs(P, room, 24);
    lights(P, room, 1, 9, 'redstone_lamp', { skipChance: 0.6 });
  },
  diner_kitchen(P, room, i) {
    const y = i.y1;
    for (let x = i.x1; x <= i.x2; x++) if (P.isFree('L0', x, i.z1)) P.set(x, y, i.z1, x % 3 ? 'smooth_quartz' : 'furnace');
    webs(P, room, 10);
  },
  tunnel(P, room, i) {
    const along = i.x2 - i.x1 > i.z2 - i.z1;
    if (along) {
      P.fill(i.x1, i.ceilY - 1, i.z1, i.x2, i.ceilY - 1, i.z1, 'wcopper_grate');
      P.fill(i.x1, i.ceilY - 1, i.z2, i.x2, i.ceilY - 1, i.z2, 'iron_bars');
    } else {
      P.fill(i.x1, i.ceilY - 1, i.z1, i.x1, i.ceilY - 1, i.z2, 'wcopper_grate');
      P.fill(i.x2, i.ceilY - 1, i.z1, i.x2, i.ceilY - 1, i.z2, 'iron_bars');
    }
    lights(P, room, 3, 10, 'white_sg', { skipChance: 0.35 });
    webs(P, room, 4);
  },
  pump(P, room, i) {
    const y = i.y1;
    P.scatter('L0', i, 6, 2, 2, (x, z) => {
      P.fill(x, y, z, x + 1, y + 1, z + 1, 'copper');
      P.set(x, y + 2, z, 'cauldron');
    }, { margin: 1 });
    lights(P, room, 2, 8, 'white_sg', { skipChance: 0.4 });
  },
  archive(P, room, i) {
    const y = i.y1;
    for (let z = i.z1 + 2; z <= i.z2 - 2; z += 4) for (let x = i.x1 + 2; x <= i.x2 - 6; x += 7) {
      if (!P.canPlace('L0', i, x, z, 5, 1)) continue;
      P.claim('L0', x, z, 5, 1);
      P.fill(x, y, z, x + 4, y + 2, z, 'bookshelf');
    }
    lights(P, room, 2, 8, 'white_sg', { skipChance: 0.4 });
    webs(P, room, 8);
  },
  generator(P, room, i) {
    const y = i.y1;
    if (P.canPlace('L0', i, 126, 82, 9, 6)) {
      P.claim('L0', 126, 82, 9, 6);
      P.fill(126, y, 82, 134, y + 3, 87, 'iron_block');
      P.fill(127, y + 1, 82, 133, y + 2, 82, 'observer');
      P.fill(128, y + 4, 84, 132, y + 4, 85, 'heavy_core');
      P.fill(130, y + 4, 84, 130, i.ceilY - 1, 84, 'iron_chain');
    }
    P.scatter('L0', i, 4, 2, 2, (x, z) => P.fill(x, y, z, x + 1, y + 2, z + 1, 'wcopper'), { margin: 1 });
    lights(P, room, 4, 8, 'white_sg');
  },
  electrical(P, room, i) {
    const y = i.y1;
    for (let x = i.x1; x <= i.x2; x += 2) {
      if (!P.isFree('L0', x, i.z1)) continue;
      P.claim('L0', x, i.z1);
      P.fill(x, y, i.z1, x, y + 2, i.z1, 'iron_block');
      P.set(x, y + 1, room.box[1] + 0, 'redstone_lamp');
    }
    lights(P, room, 3, 8, 'white_sg');
  },
  subfloor(P, room, i) {
    for (let z = i.z1; z <= i.z2; z += 3) P.set(i.x1, i.ceilY - 1, z, 'iron_bars');
    webs(P, room, 6);
  },
  control: controlKit,
};

// ------------------------------------------------------------------ office
function officeKit(P, room, i) {
  const y = i.y1; // 0
  // Console base row (the input consoles themselves are placed in the
  // 'consoles' phase; here we add the desk around them).
  P.fill(96, y, 127, 104, y, 127, 'dark_oak');
  P.fill(96, y, 128, 97, y, 129, 'dark_oak');
  P.fill(104, y, 128, 104, y, 129, 'dark_oak');
  P.set(101, y, 129, 'gold'); // YOU ARE HERE marker on the map ([3, 2])
  P.set(103, y, 129, 'dark_oak'); // spare map cell [5, 2]
  // Monitors and the power/clock indicator strips on the north wall.
  P.fill(97, 2, 126, 103, 3, 126, 'black_c');
  P.fill(98, 2, 126, 102, 2, 126, 'gray_sg_pane');
  for (let x = 96; x <= 105; x++) P.set(x, 4, 126, 'ind_ok'); // power meter (10 segments)
  for (let x = 97; x <= 102; x++) P.set(x, 5, 126, 'ind_off'); // hour lamps 12..5 AM
  // Door frames with door/light indicators above each door (inside the office).
  for (const wx of [94, 106]) {
    P.set(wx, 3, 129, 'ind_ok');
    P.set(wx, 3, 130, 'ind_off');
    P.fill(wx, 0, 128, wx, 3, 128, 'iron_block');
    P.fill(wx, 0, 131, wx, 3, 131, 'iron_block');
  }
  // Hatch indicator and strobe charge lamps on the back wall.
  P.set(99, 3, 140, 'ind_off');
  P.set(100, 3, 140, 'ind_off');
  for (let x = 102; x <= 106; x++) if (x <= 105) P.set(x, 3, 140, 'ind_off');
  P.set(101, 3, 140, 'ind_off'); // breaker lamp
  // Back wall: lockers, fan, papers.
  for (let x = 95; x <= 97; x++) P.fill(x, y, 139, x, y + 2, 139, 'iron_block');
  P.set(105, y, 139, 'iron_block');
  P.set(105, y + 1, 139, 'iron_trapdoor_open');
  P.set(96, y + 1, 127, 'cake');
  P.set(104, y + 1, 127, 'flower_pot');
  P.set(97, y + 1, 128, 'white_carpet');
  posters(P, room, 4, ['glazed_yellow', 'glazed_purple', 'glazed_red']);
  // Ceiling lamp.
  hanging(P, 100, 133, i.ceilY, 2, 'redstone_lamp'); // non-emissive fixture: light comes from actuated light blocks
  P.set(100, i.ceilY - 1, 135, 'light_11');
  P.set(100, i.ceilY - 1, 129, 'light_10');
  P.claim('L1', 95, 127, 11, 13);
}

// ------------------------------------------------------------------ lobby
function lobbyKit(P, room, i) {
  const y = i.y1;
  // Time-clock terminal backing (two blocks deep behind the console row).
  P.fill(182, y, 103, 183, y + 1, 121, 'polished_deepslate');
  for (let n = 1; n <= 6; n++) P.set(184, 3, 104 + n * 2, 'ind_off'); // unlock lamps (in the wall)
  P.fill(182, y + 2, 103, 183, y + 2, 121, 'polished_blackstone');
  // Benches and lockers.
  for (let x = 152; x <= 170; x += 3) if (P.canPlace('L1', i, x, i.z1, 2, 1)) {
    P.claim('L1', x, i.z1, 2, 1);
    P.fill(x, y, i.z1, x, y + 2, i.z1, 'iron_block');
  }
  P.scatter('L1', i, 2, 3, 1, (x, z) => P.fill(x, y, z, x + 2, y, z, 'spruce_slab_top'));
  lights(P, room, 8, 6, 'white_sg');
  P.claim('L1', 180, 103, 4, 20);
}

// ------------------------------------------------------------------ control room
function controlKit(P, room, i) {
  lights(P, room, 12, 5, 'sea_lantern');
}

// ------------------------------------------------------------------ dispatcher
export function decorateRoom(P, room, { signsOnly = false } = {}) {
  const i = interior(room);
  if (signsOnly) {
    for (const s of STORY_SIGNS.filter((t) => t.room === room.id)) wallSign(P, room, s.side, s.text, { along: s.along, dy: s.dy ?? 2 });
    return;
  }
  const kit = KITS[room.kit];
  if (kit) kit(P, room, i);
}

export const KIT_NAMES = Object.freeze(Object.keys(KITS));
