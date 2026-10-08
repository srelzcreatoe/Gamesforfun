// Exterior: entrance plaza, parking lot, delivery road and loading dock,
// property fence, dead trees, abandoned cars and the rooftop sign.

import { pixelText, textWidth } from './font.js';

function car(P, x, z, color) {
  P.fill(x, 0, z, x + 4, 0, z + 2, color);
  P.fill(x + 1, 1, z, x + 3, 1, z + 2, 'black_sg');
  for (const [dx, dz] of [[0, 0], [4, 0], [0, 2], [4, 2]]) P.set(x + dx, 0, z + dz, 'black_c');
}

function lampPost(P, x, z, working) {
  P.fill(x, 0, z, x, 3, z, 'nether_fence');
  P.set(x, 4, z, 'polished_blackstone');
  P.set(x, 3, z + 1, working ? 'lantern_hang' : 'iron_chain');
  if (working) P.set(x, 2, z + 1, 'light_10');
}

function deadTree(P, x, z, h) {
  P.fill(x, 0, z, x, h, z, 'dark_oak_log');
  P.set(x + 1, h - 1, z, 'dark_oak_log_x');
  P.set(x - 1, h - 2, z, 'dark_oak_log_x');
  if (P.rng.chance(0.4)) P.set(x, h + 1, z, 'oak_leaves');
}

export function buildExterior(P) {
  const rng = P.rng;
  // Entrance plaza in front of the glass doors.
  P.fill(56, -1, 154, 144, -1, 161, 'smooth_stone');
  for (let x = 58; x <= 142; x += 6) if (x < 96 || x > 104) {
    P.set(x, 0, 158, 'grass');
    P.set(x, 1, 158, 'deadbush');
  }
  // Parking lot with stall lines and cracks.
  P.fill(20, -1, 164, 160, -1, 196, 'gray_c');
  for (let x = 22; x <= 158; x += 4) {
    P.fill(x, -1, 166, x, -1, 172, 'white_c');
    P.fill(x, -1, 186, x, -1, 192, 'white_c');
  }
  for (let n = 0; n < 160; n++) P.set(rng.int(20, 160), -1, rng.int(164, 196), rng.pick(['lgray_c', 'gravel', 'andesite']));
  P.flush();
  for (const [x, z, c] of [[30, 167, 'red_c'], [62, 187, 'blue_c'], [118, 167, 'white_c'], [146, 187, 'black_c']]) car(P, x, z, c);
  for (let x = 30; x <= 150; x += 24) lampPost(P, x, 178, x === 102 || x === 54);
  // Entrance drive to the south gate and a road east to the delivery road.
  P.fill(96, -1, 162, 106, -1, 199, 'gray_c');
  P.fill(160, -1, 180, 196, -1, 186, 'gray_c');
  // Delivery road along the east side and the loading dock by the kitchen.
  P.fill(188, -1, 6, 196, -1, 199, 'gray_c');
  P.fill(186, -1, 20, 187, -1, 32, 'smooth_stone');
  P.fill(186, -1, 100, 187, -1, 104, 'smooth_stone');
  P.fill(186, -1, 104, 187, -1, 180, 'gravel');
  P.fill(190, 0, 21, 195, 2, 31, 'white_c');
  P.fill(190, 3, 21, 195, 3, 31, 'lgray_c');
  P.fill(190, 0, 32, 195, 1, 34, 'red_c');
  P.fill(191, 2, 34, 194, 2, 34, 'black_sg');
  // Property fence with gates for the drive and the delivery road.
  const gap = (x, z) => (z >= 198 && ((x >= 96 && x <= 106) || (x >= 188 && x <= 196)));
  for (let x = 0; x <= 199; x++) for (const z of [0, 199]) if (!gap(x, z)) P.set(x, 0, z, 'dark_oak_fence');
  for (let z = 0; z <= 199; z++) for (const x of [0, 199]) if (!(x === 199 && z >= 188)) P.set(x, 0, z, 'dark_oak_fence');
  P.flush();
  // Dead trees and scrub around the edges.
  for (let n = 0; n < 34; n++) {
    const side = rng.int(0, 3);
    const x = side === 0 ? rng.int(3, 12) : side === 1 ? rng.int(187, 196) : rng.int(3, 196);
    const z = side < 2 ? rng.int(3, 196) : side === 2 ? rng.int(3, 9) : rng.int(197, 197);
    if (x >= 186 && x <= 197 && z >= 4) continue; // keep the delivery road clear
    deadTree(P, x, z, rng.int(4, 8));
  }
  for (let n = 0; n < 120; n++) {
    const x = rng.int(1, 198);
    const z = rng.int(1, 198);
    if (x >= 15 && x <= 185 && z >= 11 && z <= 162) continue;
    if (z >= 162 && x >= 20 && x <= 160) continue;
    P.set(x, -1, z, rng.pick(['coarse', 'podzol', 'gravel']));
  }
  P.flush();
  // Rooftop billboard over the reception: FREDBEAR'S / PIZZERIA.
  P.fill(76, 16, 151, 124, 29, 151, 'black_c');
  P.fill(76, 15, 151, 76, 29, 151, 'red_c');
  P.fill(124, 15, 151, 124, 29, 151, 'red_c');
  P.fill(76, 30, 151, 124, 30, 151, 'red_c');
  const t1 = "FREDBEAR'S";
  const t2 = 'PIZZERIA';
  pixelText(P, t1, 100 - Math.floor(textWidth(t1) / 2), 28, 152, 'x', 'yellow_c');
  pixelText(P, t2, 100 - Math.floor(textWidth(t2) / 2), 21, 152, 'x', 'red_c');
  for (let x = 80; x <= 120; x += 10) P.set(x, 17, 153, 'light_9');
  P.flush();
}
