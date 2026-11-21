// Small hand-built places for the preview scenes.  The same functions feed the simulated world
// (so the real script walks, swims and ray-casts against them) and the offline renderer.
const SEA = 62;

function bayHeight(x, z) {
  const shore = 18 + 4 * Math.sin(x / 17) + 2 * Math.sin(x / 5.3);
  const d = z - shore;                               // > 0 is out to sea
  if (d <= 0) return 63 + Math.min(4, Math.floor(-d / 10 + 0.5 * Math.sin(x / 9 + z / 7)));
  return Math.max(40, Math.floor(62.5 - d * 0.62));
}

export function bay(dim, x, y, z) {
  if (dim !== 'minecraft:overworld') return y <= 30 ? 'minecraft:netherrack' : 'minecraft:air';
  const h = bayHeight(x, z);
  // a short pier and its posts
  if (x >= -8 && x <= -5 && z >= 12 && z <= 30) {
    if (y === 63) return 'minecraft:oak_planks';
    if ((x === -8 || x === -5) && z % 8 === 4 && y > h && y < 63) return 'minecraft:oak_log';
    if ((x === -8 || x === -5) && z % 8 === 4 && y === 64) return 'minecraft:oak_fence';
    if (x === -5 && z === 28 && y === 65) return 'minecraft:lantern';
  }
  if (y > h) return y <= SEA ? 'minecraft:water' : 'minecraft:air';
  if (y === h) {
    if (h >= 64) return 'minecraft:grass_block';
    if (h >= 58) return 'minecraft:sand';
    return (x * 7 + z * 13) % 5 === 0 ? 'minecraft:stone' : 'minecraft:gravel';
  }
  if (y > h - 3) return h >= 64 ? 'minecraft:dirt' : 'minecraft:sand';
  return 'minecraft:stone';
}
// what is left of the trees: the habitat that was stripped
export const bayProps = [];
for (const [x, z] of [[6, 6], [12, 2], [-16, 4], [20, 9], [-24, 8], [3, -4], [28, 3], [-12, -2], [16, -6], [-30, 0]]) {
  bayProps.push({ x, y: bayHeight(x, z) + 1, z, id: 'minecraft:oak_log' });
}
bayProps.push({ x: 9, y: bayHeight(9, 10) + 1, z: 10, id: 'minecraft:torch' });

const COTTAGE = { x0: -5, x1: 3, z0: -4, z1: 4 };     // interior is x0+1..x1-1
export function village(dim, x, y, z) {
  if (dim !== 'minecraft:overworld') return y <= 30 ? 'minecraft:netherrack' : 'minecraft:air';
  const c = COTTAGE;
  const inX = x >= c.x0 && x <= c.x1, inZ = z >= c.z0 && z <= c.z1;
  if (inX && inZ) {
    const wall = x === c.x0 || x === c.x1 || z === c.z0 || z === c.z1;
    if (y === 63) return 'minecraft:oak_planks';
    if (y >= 64 && y <= 67 && wall) {
      const corner = (x === c.x0 || x === c.x1) && (z === c.z0 || z === c.z1);
      if (corner) return 'minecraft:oak_log';
      // the window that matters: on the east wall, two wide, at eye height
      if (x === c.x1 && (z === 0 || z === 1) && (y === 65 || y === 66)) return 'minecraft:glass';
      if (z === c.z0 && x === -1 && (y === 64 || y === 65)) return 'minecraft:oak_door';
      if (z === c.z1 && (x === -2 || x === -1) && y === 65) return 'minecraft:glass';
      return y === 64 ? 'minecraft:cobblestone' : 'minecraft:oak_planks';
    }
    if (y === 68) return 'minecraft:spruce_planks';
    if (y === 69 && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return 'minecraft:spruce_planks';
    if (y === 66 && x === c.x0 + 1 && z === c.z1 - 1) return 'minecraft:lantern';
    return y <= 62 ? (y > 59 ? 'minecraft:dirt' : 'minecraft:stone') : 'minecraft:air';
  }
  // a lantern on the wall outside, beside the window that matters
  if (x === 4 && z === 3 && y === 66) return 'minecraft:lantern';
  // a second house and a well, so it reads as a village
  if (x >= -22 && x <= -15 && z >= 10 && z <= 17) {
    const wall = x === -22 || x === -15 || z === 10 || z === 17;
    if (y >= 64 && y <= 66 && wall) return (x === -15 && z === 13 && y === 65) ? 'minecraft:glass' : (y === 64 ? 'minecraft:cobblestone' : 'minecraft:oak_planks');
    if (y === 67) return 'minecraft:spruce_planks';
  }
  if (x >= -12 && x <= -9 && z >= -16 && z <= -13) {
    const rim = x === -12 || x === -9 || z === -16 || z === -13;
    if (y === 64 && rim) return 'minecraft:cobblestone';
    if (y <= 63 && y >= 60 && !rim) return 'minecraft:water';
  }
  // a gravel path, and lanterns on posts
  if (y === 63 && Math.abs(z + 8) <= 1 && x > -40 && x < 60) return 'minecraft:gravel';
  for (const [lx, lz] of [[8, -6], [24, -10], [-10, -6], [40, -6]]) {
    if (x === lx && z === lz) { if (y === 64 || y === 65) return 'minecraft:oak_fence'; if (y === 66) return 'minecraft:lantern'; }
  }
  if (y > 63) return 'minecraft:air';
  if (y === 63) return 'minecraft:grass_block';
  return y > 59 ? 'minecraft:dirt' : 'minecraft:stone';
}

// two bare stages for the model views
export function flat(dim, x, y, z) {
  if (y > 63) return 'minecraft:air';
  if (y === 63) return 'minecraft:grass_block';
  return y > 59 ? 'minecraft:dirt' : 'minecraft:stone';
}
export function shore(dim, x, y, z) {
  if (y > 63) return 'minecraft:air';
  if (y === 63) return (x * 3 + z * 5) % 7 === 0 ? 'minecraft:gravel' : 'minecraft:sand';
  return y > 59 ? 'minecraft:sand' : 'minecraft:stone';
}
export function tank(dim, x, y, z) {
  if (y > 62) return 'minecraft:air';
  if (y >= 40) return 'minecraft:water';
  if (y === 39) return (x * 7 + z * 13) % 5 === 0 ? 'minecraft:stone' : 'minecraft:gravel';
  return 'minecraft:stone';
}

export const TERRAINS = { bay, village, flat, shore, tank };
export const PROPS = { bay: bayProps, village: [] };
