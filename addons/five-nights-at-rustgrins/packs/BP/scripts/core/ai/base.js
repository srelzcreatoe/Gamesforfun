// Shared animatronic logic: AI level with hourly ramp, movement opportunities,
// timed walks between route nodes. Pure (no @minecraft imports).
//
// A walk is announced to the game layer with an effect
//   { fx: 'move', who, path: [[x,y,z], ...], dur, anim, toNode, fromNode }
// and the puppet is animated along the polyline for `dur` ticks; the session
// itself only waits `dur` ticks, so the simulation never depends on the world.

import { CONFIG } from '../config.js';
import { NODES, pathBetween } from '../../data/nodes.js';
import { CAMS_FOR_NODE } from '../../data/cameras.js';

export function polyLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return len;
}

/** Concatenate node-to-node paths along a node list (each consecutive pair must be adjacent). */
export function routePath(nodes) {
  const out = [];
  for (let i = 1; i < nodes.length; i++) {
    const seg = pathBetween(nodes[i - 1], nodes[i]);
    if (!seg) throw new Error(`no edge ${nodes[i - 1]} -> ${nodes[i]}`);
    out.push(...(i === 1 ? seg : seg.slice(1)));
  }
  return out;
}

export class Animatronic {
  /**
   * @param {import('../session.js').NightSession} s
   * @param {string} id
   */
  constructor(s, id) {
    this.s = s;
    this.id = id;
    this.cfg = CONFIG.characters[id];
    this.baseAi = s.def.ai[id] ?? 0;
    this.activation = s.def.activation?.[id] ?? 0;
    this.node = this.cfg.start;
    this.walk = null; // { to, until, path }
    this.state = 'idle';
    this.nextMo = (this.cfg.mo ?? 100) + s.rng.int(0, 40);
    this.inside = false;
  }

  /** Current AI level (0..20) including the hourly ramp. */
  get ai() {
    let a = this.baseAi;
    if (a > 0 && this.s.def.ramp) a += CONFIG.hourlyRamp[this.id]?.[this.s.hour] ?? 0;
    return Math.max(0, Math.min(20, a + this.bonus()));
  }

  bonus() {
    return 0;
  }

  get active() {
    return this.baseAi > 0 && this.s.t >= this.activation;
  }

  /** True when this tick is a movement opportunity that succeeds. */
  opportunity() {
    if (!this.active || this.walk) return false;
    if (this.s.t < this.nextMo) return false;
    this.nextMo = this.s.t + (this.cfg.mo ?? 100);
    const a = this.ai;
    return a > 0 && this.s.rng.d20() <= a;
  }

  /** Is the guard looking at this animatronic on a working camera right now? */
  watched() {
    const n = this.node;
    if (!n) return false;
    return this.s.isWatchingNode(n);
  }

  /**
   * Start walking to an adjacent node (or along an explicit node list).
   * @param {string} target
   * @param {{ speed?: number, anim?: string, via?: string[] | null, statics?: boolean }} [o]
   */
  goTo(target, { speed = undefined, anim = 'walk', via = null, statics = true } = {}) {
    const nodes = via ?? [this.node, target];
    const path = nodes.length === 2 ? pathBetween(nodes[0], nodes[1]) : routePath(nodes);
    if (!path) return false;
    const dur = Math.max(1, Math.ceil(polyLength(path) / (speed ?? this.cfg.walkSpeed ?? 0.12)));
    const from = this.node;
    this.walk = { to: target, until: this.s.t + dur, path };
    this.node = null;
    this.s.emit({ fx: 'move', who: this.id, path, dur, anim, fromNode: from, toNode: target, yaw: NODES[target].yaw });
    if (statics) {
      this.s.staticOn(CAMS_FOR_NODE[from] ?? [], 30);
      this.s.staticOn(CAMS_FOR_NODE[target] ?? [], 30, dur);
    }
    return true;
  }

  /** Place instantly (no walk), e.g. after a retreat that happened off-camera. */
  placeAt(target, pose = 'idle') {
    const from = this.node ?? this.walk?.to;
    this.walk = null;
    this.node = target;
    this.s.emit({ fx: 'place', who: this.id, node: target, pose });
    if (from && from !== target) this.s.staticOn(CAMS_FOR_NODE[from] ?? [], 25);
    this.s.staticOn(CAMS_FOR_NODE[target] ?? [], 25);
  }

  /** Advance walks; returns true on the tick a walk ends. */
  tickWalk() {
    if (!this.walk) return false;
    if (this.s.t < this.walk.until) return false;
    this.node = this.walk.to;
    this.walk = null;
    this.onArrive(this.node);
    return true;
  }

  onArrive(node) {
    this.s.emit({ fx: 'pose', who: this.id, node, pose: NODES[node]?.pose === 'stage' ? 'idle' : 'stand' });
  }

  /** Called every tick by the session. */
  tick() {}

  /** Snapshot for the debug overlay. */
  debug() {
    return `${this.id}:${this.ai}${this.walk ? `>${this.walk.to}` : `@${this.node}`}/${this.state}`;
  }
}

/** Weighted pick from a table row [[node, weight], ...]. */
export function pickFrom(rng, row) {
  return rng.weighted(row);
}
