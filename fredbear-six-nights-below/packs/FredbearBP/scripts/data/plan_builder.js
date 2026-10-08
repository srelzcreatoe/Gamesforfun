// PlanBuilder: collects build operations in phases.
//
// Op formats (all coordinates LOCAL, see layout.js ORIGIN):
//   ['F', x1, y1, z1, x2, y2, z2, key]   fill a box
//   ['L', key, [x, y, z, x, y, z, ...]]   set a list of blocks (ListBlockVolume)
//   ['A', x1, y1, z1, x2, y2, z2, key]   fill only blocks that are currently air
//   ['T', x, y, z, key, text]             wall sign with text (placed + written)
// Phases run in order; within a phase ops run in order (later ops win).

import { Rng } from '../core/rng.js';
import { LEVELS } from './layout.js';

export const PHASES = Object.freeze(['terrain', 'shell', 'openings', 'stairs', 'decor', 'exterior', 'consoles', 'controls', 'signs']);

export class PlanBuilder {
  constructor(seed = 1983) {
    this.rng = new Rng(seed);
    this.phase = 'terrain';
    this.ops = Object.fromEntries(PHASES.map((p) => [p, []]));
    this.pending = new Map(); // key -> flat coord list (batched 'L' ops)
    this.reserved = new Set();
    this.claimed = new Set();
    this.notes = [];
  }

  setPhase(p) {
    this.flush();
    this.phase = p;
  }

  push(op) {
    this.ops[this.phase].push(op);
  }

  fill(x1, y1, z1, x2, y2, z2, key) {
    this.flush(); // keep ordering correct relative to batched sets
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
    if (list.length >= 3 * 2048) this.flushKey(key);
  }

  flushKey(key) {
    const list = this.pending.get(key);
    if (list && list.length) this.push(['L', key, list]);
    this.pending.delete(key);
  }

  flush() {
    for (const key of [...this.pending.keys()]) this.flushKey(key);
  }

  sign(x, y, z, facing, text, wood = 'sign') {
    this.flush();
    this.push(['T', x, y, z, `${wood}_${facing}`, text]);
  }

  // ------------------------------------------------------------ reservations
  static key(level, x, z) {
    return `${level}:${Math.floor(x)}:${Math.floor(z)}`;
  }

  reserve(level, x, z) {
    this.reserved.add(PlanBuilder.key(level, x, z));
  }

  reserveRect(level, x1, z1, x2, z2) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) this.reserve(level, x, z);
  }

  isFree(level, x, z) {
    const k = PlanBuilder.key(level, x, z);
    return !this.reserved.has(k) && !this.claimed.has(k);
  }

  /** True if the w x d footprint at (x, z) is free and inside bounds i. */
  canPlace(level, i, x, z, w = 1, d = 1, margin = 0) {
    if (x - margin < i.x1 || z - margin < i.z1 || x + w - 1 + margin > i.x2 || z + d - 1 + margin > i.z2) return false;
    for (let a = x - margin; a < x + w + margin; a++) for (let b = z - margin; b < z + d + margin; b++) if (!this.isFree(level, a, b)) return false;
    return true;
  }

  claim(level, x, z, w = 1, d = 1) {
    for (let a = x; a < x + w; a++) for (let b = z; b < z + d; b++) this.claimed.add(PlanBuilder.key(level, a, b));
  }

  /** Try `tries` random spots in interior i for a w x d prop; calls place(x, z) on success. */
  scatter(level, i, count, w, d, place, { margin = 0, tries = 40, edge = false } = {}) {
    let placed = 0;
    for (let n = 0; n < count; n++) {
      for (let t = 0; t < tries; t++) {
        let x;
        let z;
        if (edge) {
          // Along walls: pick a side then a position.
          const side = this.rng.int(0, 3);
          if (side === 0) [x, z] = [this.rng.int(i.x1, i.x2 - w + 1), i.z1];
          else if (side === 1) [x, z] = [this.rng.int(i.x1, i.x2 - w + 1), i.z2 - d + 1];
          else if (side === 2) [x, z] = [i.x1, this.rng.int(i.z1, i.z2 - d + 1)];
          else [x, z] = [i.x2 - w + 1, this.rng.int(i.z1, i.z2 - d + 1)];
        } else {
          x = this.rng.int(i.x1, i.x2 - w + 1);
          z = this.rng.int(i.z1, i.z2 - d + 1);
        }
        if (!this.canPlace(level, i, x, z, w, d, margin)) continue;
        this.claim(level, x, z, w, d);
        place(x, z);
        placed++;
        break;
      }
    }
    return placed;
  }

  levelOfY(y) {
    if (y <= -4) return 'L0';
    if (y <= 6) return 'L1';
    return 'L2';
  }

  result() {
    this.flush();
    return { phases: PHASES.map((p) => ({ name: p, ops: this.ops[p] })), notes: this.notes };
  }
}

export { LEVELS };
