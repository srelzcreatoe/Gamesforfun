// Offline voxel model: executes the build plan into a 3D array (local
// coordinates) so the map can be validated without Minecraft.
import { generatePlan } from '../packs/FredbearBP/scripts/data/build_plan.js';
import { PALETTE } from '../packs/FredbearBP/scripts/data/palette.js';

export const BOUNDS = Object.freeze({ x0: -14, x1: 213, y0: -14, y1: 34, z0: -14, z1: 213 });

const NON_SOLID = new Set(['air', 'web', 'barrier_gate']);
const PARTIAL_PREFIX = ['light_', 'sign_', 'sign_spruce_', 'eye_button_', 'ladder_'];
const PARTIAL = new Set([
  'iron_bars', 'iron_chain', 'glass_pane', 'gray_sg_pane', 'dark_oak_fence', 'oak_fence', 'nether_fence', 'sb_wall', 'cobble_wall',
  'white_carpet', 'red_carpet', 'black_carpet', 'purple_carpet', 'yellow_carpet', 'gray_carpet', 'lgray_carpet', 'blue_carpet', 'cyan_carpet', 'brown_carpet',
  'lantern_hang', 'soul_lantern_hang', 'lantern', 'end_rod_down', 'flower_pot', 'cake', 'cake_bitten', 'deadbush', 'button_up', 'dark_button_up', 'lever_up', 'plate',
  'iron_trapdoor_closed', 'iron_trapdoor_open', 'web', 'brewing_stand', 'decorated_pot',
]);
const TRANSPARENT_FULL = new Set(['glass', 'black_sg', 'white_sg', 'tinted_glass', 'barrier', 'oak_leaves']);

/** Can an entity's body occupy this cell? (walk / route checks) */
export function passable(key) {
  if (key === undefined) return false;
  if (NON_SOLID.has(key)) return true;
  if (key.startsWith('light_') || key.startsWith('sign_') || key.startsWith('ladder_') || key.startsWith('eye_button_')) return true;
  return ['iron_chain', 'lantern_hang', 'soul_lantern_hang', 'button_up', 'dark_button_up', 'lever_up', 'plate', 'white_carpet', 'red_carpet', 'iron_trapdoor_closed', 'iron_trapdoor_open',
    'black_carpet', 'purple_carpet', 'yellow_carpet', 'gray_carpet', 'lgray_carpet', 'blue_carpet', 'cyan_carpet', 'brown_carpet', 'deadbush'].includes(key);
}

/** Does this cell block a camera's line of sight? */
export function opaque(key) {
  if (key === undefined) return true;
  if (key === 'air' || TRANSPARENT_FULL.has(key) || PARTIAL.has(key)) return false;
  for (const p of PARTIAL_PREFIX) if (key.startsWith(p)) return false;
  if (key.includes('slab') || key.includes('stairs')) return false; // half blocks: treated as see-through (lenient)
  return true;
}

/** Solid enough to stand on. */
export function standable(key) {
  if (key === undefined || key === 'air') return false;
  if (key.startsWith('light_') || key.startsWith('sign_') || key === 'web' || key.startsWith('eye_button_')) return false;
  if (['iron_chain', 'lantern_hang', 'soul_lantern_hang', 'button_up', 'dark_button_up', 'lever_up', 'plate', 'deadbush', 'flower_pot'].includes(key)) return false;
  return true;
}

export class Voxel {
  constructor(bounds = BOUNDS) {
    this.b = bounds;
    this.sx = bounds.x1 - bounds.x0 + 1;
    this.sy = bounds.y1 - bounds.y0 + 1;
    this.sz = bounds.z1 - bounds.z0 + 1;
    this.keys = ['air', 'dirt'];
    this.index = new Map(this.keys.map((k, i) => [k, i]));
    this.data = new Uint16Array(this.sx * this.sy * this.sz);
    // Flat world: dirt up to local y -11 (world -61), air above.
    for (let y = bounds.y0; y <= -11; y++) for (let x = bounds.x0; x <= bounds.x1; x++) for (let z = bounds.z0; z <= bounds.z1; z++) this.data[this.idx(x, y, z)] = 1;
    this.signs = [];
  }

  idx(x, y, z) {
    return ((x - this.b.x0) * this.sy + (y - this.b.y0)) * this.sz + (z - this.b.z0);
  }

  inside(x, y, z) {
    return x >= this.b.x0 && x <= this.b.x1 && y >= this.b.y0 && y <= this.b.y1 && z >= this.b.z0 && z <= this.b.z1;
  }

  kid(key) {
    let i = this.index.get(key);
    if (i === undefined) {
      if (!PALETTE[key]) throw new Error(`unknown palette key ${key}`);
      i = this.keys.length;
      this.keys.push(key);
      this.index.set(key, i);
    }
    return i;
  }

  get(x, y, z) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (!this.inside(x, y, z)) return undefined;
    return this.keys[this.data[this.idx(x, y, z)]];
  }

  set(x, y, z, key) {
    if (!this.inside(x, y, z)) return;
    this.data[this.idx(x, y, z)] = this.kid(key);
  }

  fill(x1, y1, z1, x2, y2, z2, key, airOnly = false) {
    const k = this.kid(key);
    const air = 0;
    for (let x = Math.max(x1, this.b.x0); x <= Math.min(x2, this.b.x1); x++) {
      for (let y = Math.max(y1, this.b.y0); y <= Math.min(y2, this.b.y1); y++) {
        let i = this.idx(x, y, Math.max(z1, this.b.z0));
        for (let z = Math.max(z1, this.b.z0); z <= Math.min(z2, this.b.z1); z++, i++) {
          if (airOnly && this.data[i] !== air) continue;
          this.data[i] = k;
        }
      }
    }
  }

  apply(plan, { upTo } = {}) {
    for (const ph of plan.phases) {
      for (const op of ph.ops) {
        switch (op[0]) {
          case 'F':
            this.fill(op[1], op[2], op[3], op[4], op[5], op[6], op[7]);
            break;
          case 'A':
            this.fill(op[1], op[2], op[3], op[4], op[5], op[6], op[7], true);
            break;
          case 'L': {
            const k = op[1];
            const l = op[2];
            for (let i = 0; i < l.length; i += 3) this.set(l[i], l[i + 1], l[i + 2], k);
            break;
          }
          case 'T':
            this.set(op[1], op[2], op[3], op[4]);
            this.signs.push({ x: op[1], y: op[2], z: op[3], key: op[4], text: op[5] });
            break;
          default:
            throw new Error(`unknown op ${op[0]}`);
        }
      }
      if (upTo && ph.name === upTo) break;
    }
    return this;
  }
}

/** Can a player (2 cells tall) stand at this cell? */
export function canStand(V, x, y, z) {
  return passable(V.get(x, y, z)) && passable(V.get(x, y + 1, z)) && standable(V.get(x, y - 1, z));
}

/**
 * Cells a player can move to from a standing cell: one step in x/z (up one with
 * headroom, level, or down up to three with a clear drop), and straight up/down
 * on ladders. Shared by the map validator (walkability) and the route-guidance
 * graph generator.
 */
export function* walkNeighbours(V, x, y, z) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const nz = z + dz;
    for (const dy of [0, 1, -1, -2, -3]) {
      const ny = y + dy;
      if (dy === 1 && !passable(V.get(x, y + 2, z))) continue;
      if (dy < 0) {
        let clear = true;
        for (let yy = ny + 1; yy <= y + 1; yy++) if (!passable(V.get(nx, yy, nz))) clear = false;
        if (!clear) continue;
      }
      if (canStand(V, nx, ny, nz)) {
        yield [nx, ny, nz];
        break;
      }
    }
  }
  const here = V.get(x, y, z) ?? '';
  if (here.startsWith('ladder_') || (V.get(x, y - 1, z) ?? '').startsWith('ladder_')) {
    for (const dy of [1, -1]) if (passable(V.get(x, y + dy, z))) yield [x, y + dy, z];
  }
}

let cached;
export function buildVoxel() {
  if (!cached) cached = new Voxel().apply(generatePlan());
  return cached;
}
