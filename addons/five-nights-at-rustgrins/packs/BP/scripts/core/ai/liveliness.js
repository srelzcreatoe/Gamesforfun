// Small signs of life while the animatronics stand about, so they feel alive rather than
// parked: a head tilt, a change of pose, a shuffle towards the next room and back while
// nobody watches. Purely cosmetic: the session's state never changes, the effects draw from a
// random stream of their own (the night is the same night with or without them), and they are
// sparse - one effect every eight to sixteen seconds for the whole cast.
//
//   { fx: 'idle', kind: 'tilt',    who, node, yaw, pitch, dur }   the head turns, then back
//   { fx: 'idle', kind: 'pose',    who, node, pose, dur }         another pose for a while
//   { fx: 'idle', kind: 'shuffle', who, node, path, dur }         a few steps out and back
//
// Never at a door, a window or a vent (the game layer's dread director owns those moments),
// never for anyone walking, hidden or inside, and not in the Final Act (they are marionettes
// there). Pure (no @minecraft imports).

import { CONFIG } from '../config.js';
import { Rng } from '../rng.js';
import { NODES, pathBetween } from '../../data/nodes.js';
import { neighbors } from './graph.js';

const BUSY = new Set(['entering', 'inside', 'run', 'vent', 'door']);

/** The point `dist` blocks along a polyline (clamped to its end). */
function pointAlong(path, dist) {
  let left = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len >= left && len > 0) {
      const f = left / len;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    left -= len;
  }
  return path[path.length - 1];
}

export class Liveliness {
  /**
   * @param {import('../session.js').NightSession} s
   * @param {number} seed the night's seed (the stream is derived from it, apart from the night's own)
   */
  constructor(s, seed) {
    this.s = s;
    this.cfg = CONFIG.idle;
    this.rng = new Rng(((seed >>> 0) ^ 0x51ed270b) >>> 0);
    this.enabled = !s.final;
    /** @type {number} */
    this.next = this.cfg.first;
  }

  /** Standing somewhere a sign of life fits. */
  eligible(c) {
    if (c.walk || !c.node || c.inside || BUSY.has(c.state)) return false;
    if (c.id === 'top_hat_rat') return false; // his booth has its own glimpses (the game layer), and he walks on his own nights
    const n = NODES[c.node];
    if (!n || n.door || n.vent) return false;
    if (c.id === 'cat' && (c.stage >= 3 || c.pulling)) return false; // out of sight
    return true;
  }

  tick() {
    const s = this.s;
    if (!this.enabled || s.t < this.next) return;
    const rng = this.rng;
    this.next = s.t + rng.int(this.cfg.every[0], this.cfg.every[1]);
    const pool = Object.values(s.chars).filter((c) => this.eligible(c));
    if (!pool.length) return;
    const c = rng.pick(pool);
    const n = NODES[c.node];
    const floor = !n.crawl && n.pose !== 'stage';
    const roll = rng.next();
    if (floor && roll < 0.3 && !c.watched()) {
      // a few steps towards the next room and back, while nobody watches
      const ways = neighbors(c.node).filter((m) => !NODES[m].crawl && !NODES[m].door && !NODES[m].vent && NODES[m].pose !== 'stage' && NODES[m].y === n.y);
      const to = ways.length ? rng.pick(ways) : null;
      const out = to ? pathBetween(c.node, to) : null;
      if (out) {
        const here = [n.x, n.y, n.z];
        s.emit({ fx: 'idle', kind: 'shuffle', who: c.id, node: c.node, path: [here, pointAlong(out, this.cfg.shuffle), here], dur: rng.int(44, 70) });
        return;
      }
    }
    if (floor && roll < 0.5) {
      s.emit({ fx: 'idle', kind: 'pose', who: c.id, node: c.node, pose: 'peek', dur: rng.int(50, 90) });
      return;
    }
    s.emit({ fx: 'idle', kind: 'tilt', who: c.id, node: c.node, yaw: rng.int(-40, 40), pitch: rng.int(-12, 14), dur: rng.int(50, 110) });
  }
}
