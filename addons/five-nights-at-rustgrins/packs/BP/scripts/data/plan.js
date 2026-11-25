// PlanBuilder: collects build operations in phases (pure, no @minecraft imports).
//
// Op formats (all coordinates LOCAL):
//   ['F', x1, y1, z1, x2, y2, z2, key]   fill a box (later ops win)
//   ['A', x1, y1, z1, x2, y2, z2, key]   fill only cells that are currently air
//   ['L', key, [x, y, z, x, y, z, ...]]   set a list of cells
//   ['T', x, y, z, key, [lines]]          wall sign block + its text
// Keys are PALETTE keys, or "pic:<name>:<tile>:<dir>" for picture panels.

import { Rng } from '../core/rng.js';

export const PHASES = Object.freeze(['ground', 'shell', 'rooms', 'openings', 'ducts', 'exterior', 'decor', 'lights', 'controls', 'signs']);

export class PlanBuilder {
  constructor(seed = 1991) {
    this.rng = new Rng(seed);
    this.phase = PHASES[0];
    this.ops = Object.fromEntries(PHASES.map((p) => [p, []]));
    this.pending = new Map();
    /** Metadata the game needs at runtime (lamps, pictures, ...). `fixtures`: lights that are built lit and never switched. */
    this.meta = { lamps: [], sconces: [], spots: [], hanging: [], cctv: [], exits: [], fixtures: [] };
  }

  setPhase(p) {
    if (!PHASES.includes(p)) throw new Error(`unknown phase ${p}`);
    this.flush();
    this.phase = p;
  }

  push(op) {
    this.ops[this.phase].push(op);
  }

  fill(x1, y1, z1, x2, y2, z2, key) {
    this.flush();
    this.push(['F', Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2), Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2), key]);
  }

  fillAir(x1, y1, z1, x2, y2, z2, key) {
    this.flush();
    this.push(['A', Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2), Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2), key]);
  }

  set(x, y, z, key) {
    let list = this.pending.get(key);
    if (!list) this.pending.set(key, (list = []));
    list.push(x, y, z);
    if (list.length >= 3 * 1024) this.flushKey(key);
  }

  /** Wall sign with text. dir = the direction the sign faces (n/s/w/e). */
  sign(x, y, z, dir, lines) {
    this.flush();
    this.push(['T', x, y, z, `sign_${dir}`, lines]);
  }

  /**
   * Picture panel of w x h tiles. (x, y, z) = the TOP-LEFT tile's cell as seen
   * from the front; dir = the direction the picture faces. Tiles run to the
   * viewer's right and downwards. `variant` puts that one tile everywhere; `first`
   * offsets the tile numbers (blocks that hold several pictures, e.g. wall_writing).
   */
  picture(name, x, y, z, dir, w, h, variant = null, first = 0) {
    // the viewer's right-hand direction when looking at the front (a picture facing north is seen looking south, ...)
    const right = { n: [-1, 0], s: [1, 0], e: [0, -1], w: [0, 1] }[dir];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const tile = variant ?? first + r * w + c;
        this.set(x + right[0] * c, y - r, z + right[1] * c, `pic:${name}:${tile}:${dir}`);
      }
    }
  }

  /**
   * Run `fn(q)` against a recorder with this builder's interface (fill, set, picture, sign, rng, meta) and write
   * what it built in as few ops as it takes: the large fills in their order, then every other cell exactly once,
   * grouped by block, then the signs. The result is the same as running `fn` on the builder itself (later writes
   * still win, cell by cell), but a room that mixes fills and single blocks costs a fill per large box and a list
   * per kind of block instead of a list for every change of hands. Fills of up to `small` cells become cells.
   */
  batch(fn, small = 48) {
    const fills = [];
    /** @type {Map<string, string>} cell "x,y,z" -> the key last written there */
    const cells = new Map();
    const signs = [];
    const q = {
      rng: this.rng, meta: this.meta,
      set(x, y, z, key) {
        cells.set(`${x},${y},${z}`, key);
      },
      fill(xa, ya, za, xb, yb, zb, key) {
        const x1 = Math.min(xa, xb), y1 = Math.min(ya, yb), z1 = Math.min(za, zb);
        const x2 = Math.max(xa, xb), y2 = Math.max(ya, yb), z2 = Math.max(za, zb);
        const vol = (x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1);
        if (vol <= small) {
          for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) cells.set(`${x},${y},${z}`, key);
          return;
        }
        fills.push([x1, y1, z1, x2, y2, z2, key]);
        // what was set inside this box before is under it now
        if (vol < cells.size) {
          for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) cells.delete(`${x},${y},${z}`);
        } else {
          for (const k of [...cells.keys()]) {
            const [x, y, z] = k.split(',').map(Number);
            if (x >= x1 && x <= x2 && y >= y1 && y <= y2 && z >= z1 && z <= z2) cells.delete(k);
          }
        }
      },
      sign(x, y, z, dir, lines) {
        signs.push([x, y, z, dir, lines]);
      },
      picture: PlanBuilder.prototype.picture,
      flush() {},
      batch(g) {
        g(q);
      },
    };
    fn(q);
    for (const f of fills) this.fill(f[0], f[1], f[2], f[3], f[4], f[5], f[6]);
    for (const [k, key] of cells) {
      const [x, y, z] = k.split(',').map(Number);
      this.set(x, y, z, key);
    }
    for (const s of signs) this.sign(s[0], s[1], s[2], s[3], s[4]);
    this.flush();
  }

  flushKey(key) {
    const list = this.pending.get(key);
    if (list && list.length) this.push(['L', key, list]);
    this.pending.delete(key);
  }

  flush() {
    for (const key of [...this.pending.keys()]) this.flushKey(key);
  }

  finish() {
    this.flush();
    return { ops: this.ops, meta: this.meta };
  }
}
