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
    /** Metadata the game needs at runtime (lamps, pictures, ...). */
    this.meta = { lamps: [], sconces: [], spots: [], hanging: [], cctv: [], exits: [] };
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
   * viewer's right and downwards.
   */
  picture(name, x, y, z, dir, w, h, variant = null) {
    // the viewer's right-hand direction when looking at the front (a picture facing north is seen looking south, ...)
    const right = { n: [-1, 0], s: [1, 0], e: [0, -1], w: [0, 1] }[dir];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const tile = variant ?? r * w + c;
        this.set(x + right[0] * c, y - r, z + right[1] * c, `pic:${name}:${tile}:${dir}`);
      }
    }
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
