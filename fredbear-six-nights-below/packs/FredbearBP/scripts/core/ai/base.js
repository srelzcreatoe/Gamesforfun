// Shared animatronic machinery: graph movement, occupancy, state logging,
// observation and cue helpers. Character files implement think().
//
// Canonical states (docs/04_AI_DESIGN.md):
//   DORMANT -> PATROL -> INVESTIGATE -> STALK -> APPROACH -> TELEGRAPH
//   -> ATTACK | RETREAT -> RECOVER -> PATROL
// Character extras: Fredbear STIR/FORCING/JAMMED/SPENT, Freddy LURK (his
// telegraph), SUSPENDED (maintenance) and POWEROUT (Freddy's sequence).

import { CONFIG } from '../config.js';
import { RouteGraph } from '../graph.js';
import { NODE_BY_ID, edgePolyline, ENTRY_BARRIER, ENTRY_NODE } from '../../data/nodes.js';
import { CAMERA_BY_ID } from '../../data/cameras.js';

export const OFFICE_CENTER = Object.freeze({ x: 100.5, y: 0, z: 133.5 });

export class Animatronic {
  constructor(session, id) {
    this.s = session;
    this.id = id;
    this.cfg = CONFIG.characters[id];
    this.graph = new RouteGraph(id, (g) => session.gateOpen(g));
    this.reset();
  }

  reset() {
    if (this.node) this.s.occupancy.release(this.node, this.id);
    this.node = this.cfg.home;
    this.s.occupancy.force(this.node, this.id);
    this.prevNode = null;
    this.move = null;
    this.path = [];
    this.state = 'DORMANT';
    this.stateTicks = 0;
    this.timer = 0;
    this.moTimer = this.cfg.moInterval ?? 60;
    this.entry = null; // reserved entry (L/R/H) while approaching/telegraphing
    this.target = null;
    this.anim = 'perform';
    this.eyes = false;
    this.hidden = false;
    this.yaw = NODE_BY_ID[this.node].yaw ?? 0;
    this.stepCounter = 0;
    this.watchedTicks = 0;
    this.memory = { repelled: { L: 0, R: 0, H: 0 }, lastEntry: null, lastSeenTick: 0 };
  }

  // ------------------------------------------------------------ aggression
  get baseAggression() {
    return this.s.def.ai[this.id] ?? 0;
  }

  get aggression() {
    const def = this.s.def;
    let a = this.baseAggression;
    if (a > 0 && def.ramp && this.id !== 'fredbear') a += CONFIG.hourlyRamp[this.s.hour] ?? 0;
    a += this.s.aiBonus[this.id] ?? 0;
    return Math.max(0, Math.min(20, a));
  }

  get activationTick() {
    return this.s.def.activation[this.id] ?? 99999;
  }

  // ------------------------------------------------------------ state
  setState(next, reason = '') {
    if (next === this.state) return;
    this.s.logTransition(this.id, this.state, next, reason);
    this.prevState = this.state;
    this.state = next;
    this.stateTicks = 0;
  }

  tick() {
    this.stateTicks++;
    this.updateWatched();
    if (this.move) this.stepMove();
    else this.think();
  }

  think() {}

  // ------------------------------------------------------------ observation
  /** True when the player's current camera feed shows this animatronic. */
  isObserved() {
    const cams = this.s.devices.cams;
    if (!cams.open || this.s.disrupt.left > 0) return false;
    const cam = CAMERA_BY_ID[cams.cam];
    if (!cam || cam.audioOnly) return false;
    if (cam.lostSignalBefore && this.s.night < cam.lostSignalBefore && !this.s.foreshadowActive(cam.id)) return false;
    if (this.move) return cam.sees.includes(this.move.from) || cam.sees.includes(this.move.to);
    return cam.sees.includes(this.node);
  }

  updateWatched() {
    if (this.isObserved()) {
      this.watchedTicks++;
      this.memory.lastSeenTick = this.s.t;
    } else {
      this.watchedTicks = 0;
    }
  }

  // ------------------------------------------------------------ movement
  speed(kind) {
    return CONFIG.speeds[kind] ?? CONFIG.speeds.walk;
  }

  /** Begin walking the edge from the current node to `to`. */
  beginEdgeMove(to, speedKind = 'walk') {
    const edge = this.graph.edgeBetween(this.node, to);
    if (!edge) return false;
    if (edge.gate && !this.s.gateOpen(edge.gate)) return false;
    if (!this.s.occupancy.claim(to, this.id)) return false;
    const pts = edgePolyline(edge, this.node);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0, z0] = pts[i - 1];
      const [x1, y1, z1] = pts[i];
      cum.push(cum[i - 1] + Math.hypot(x1 - x0, y1 - y0, z1 - z0));
    }
    const mode = edge.mode;
    let kind = speedKind;
    if (mode === 'vent') kind = 'vent';
    else if (mode === 'crawl') kind = this.id === 'fredbear' ? 'fredbearCrawl' : 'crawl';
    else if (mode === 'climb') kind = 'climb';
    else if (this.id === 'fredbear' && speedKind === 'walk') kind = 'fredbearWalk';
    this.s.occupancy.release(this.node, this.id);
    this.move = { edge, from: this.node, to, pts, cum, total: cum[cum.length - 1], d: 0, speed: this.speed(kind), mode, kind };
    this.prevNode = this.node;
    this.anim = mode === 'crawl' || mode === 'vent' ? 'crawl' : kind === 'stalk' ? 'stalk' : kind === 'retreat' ? 'retreat' : 'walk';
    return true;
  }

  /** Follow a multi-hop path (array of node ids after the current node). */
  followPath(path, speedKind = 'walk') {
    this.path = path.slice();
    this.pathSpeed = speedKind;
    return this.advancePath();
  }

  advancePath() {
    while (this.path.length) {
      const next = this.path[0];
      if (this.beginEdgeMove(next, this.pathSpeed)) {
        this.path.shift();
        return true;
      }
      return false; // blocked (occupied or gated); caller decides
    }
    return false;
  }

  stepMove() {
    const m = this.move;
    if (m.edge.gate && !this.s.gateOpen(m.edge.gate)) {
      // Route blocked mid-edge: walk back to where we came from.
      this.s.occupancy.release(m.to, this.id);
      if (!this.s.occupancy.claim(m.from, this.id)) this.s.occupancy.force(m.from, this.id);
      const rev = m.pts.slice().reverse();
      const total = m.total;
      const cum = [0];
      for (let i = 1; i < rev.length; i++) cum.push(cum[i - 1] + Math.hypot(rev[i][0] - rev[i - 1][0], rev[i][1] - rev[i - 1][1], rev[i][2] - rev[i - 1][2]));
      this.move = { ...m, from: m.to, to: m.from, pts: rev, cum, d: total - m.d };
      this.path = [];
      this.s.logTransition(this.id, this.state, this.state, `route ${m.edge.id} gated: reversing`);
      return;
    }
    m.d += m.speed;
    this.emitStep();
    if (m.d >= m.total) {
      this.node = m.to;
      this.move = null;
      const n = NODE_BY_ID[this.node];
      if (n.yaw !== undefined) this.yaw = n.yaw;
      if (this.path.length && this.advancePath()) return;
      this.anim = 'idle';
      this.onArrive(this.node);
    }
  }

  /** @param {string} _node */
  onArrive(_node) {}

  // Optional character hooks (no-ops by default).
  /** @returns {boolean} true when the hook consumed this tick */
  extraRoam() {
    return false;
  }

  onApproachStart() {}

  /** @param {string} _node */
  onReachNode(_node) {}

  onTelegraphStart() {}

  /** @param {string} _reason */
  repelled(_reason) {}

  startRetreat() {}

  /** Current world pose for the puppet entity (local coordinates). */
  pose() {
    let x;
    let y;
    let z;
    let hidden = this.hidden;
    if (this.move) {
      const m = this.move;
      let i = 1;
      while (i < m.cum.length - 1 && m.cum[i] < m.d) i++;
      const segLen = m.cum[i] - m.cum[i - 1] || 1;
      const f = Math.min(1, Math.max(0, (m.d - m.cum[i - 1]) / segLen));
      const a = m.pts[i - 1];
      const b = m.pts[i];
      x = a[0] + (b[0] - a[0]) * f;
      y = a[1] + (b[1] - a[1]) * f;
      z = a[2] + (b[2] - a[2]) * f;
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      if (Math.abs(dx) + Math.abs(dz) > 0.01) this.yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
      if (m.mode === 'vent' && y < -0.5) hidden = true;
    } else {
      const n = NODE_BY_ID[this.node];
      x = n.x;
      y = n.y;
      z = n.z;
    }
    return { x, y, z, yaw: this.yaw, anim: this.anim, eyes: this.eyes, hidden };
  }

  distanceToOffice() {
    const p = this.pose();
    return Math.hypot(p.x - OFFICE_CENTER.x, (p.y - OFFICE_CENTER.y) * 2, p.z - OFFICE_CENTER.z);
  }

  emitStep() {
    if (++this.stepCounter % 14 !== 0) return;
    const loud = !!this.s.mods.loudSteps; // Broken Cameras challenge: louder, earlier footsteps
    const d = this.distanceToOffice();
    if (d > (loud ? 60 : 42)) return;
    const p = this.pose();
    this.s.emit({ fx: 'sound', id: `fb.step.${this.id}`, at: { x: p.x, y: p.y, z: p.z }, vol: (d < 16 ? 1.0 : 0.7) * (loud ? 1.5 : 1) });
    if (d < (loud ? 36 : 24) && this.stepCounter % 56 === 0) this.s.caption(`Footsteps — ${this.sideName()}`, this.id);
  }

  sideName() {
    const p = this.pose();
    if (p.y < -3) return 'beneath the office';
    return p.x < OFFICE_CENTER.x - 1 ? 'west side' : p.x > OFFICE_CENTER.x + 1 ? 'east side' : 'nearby';
  }

  // ------------------------------------------------------------ helpers
  barrierFor(entry) {
    return ENTRY_BARRIER[entry];
  }

  entryNode(entry) {
    return ENTRY_NODE[entry];
  }

  /** Weighted next-node choice toward `goal` (node id). */
  chooseStep(goal, opts = {}) {
    const a = this.aggression;
    const options = this.graph.neighbours(this.node);
    if (!options.length) return undefined;
    const dist = this.graph.distancesTo(goal);
    const here = dist.get(this.node) ?? Infinity;
    const items = [];
    const weights = [];
    for (const o of options) {
      const n = NODE_BY_ID[o.to];
      if (n.zone === 'entry' && !opts.allowEntry) continue;
      if (this.s.occupancy.isTaken(o.to, this.id)) continue;
      let w = 1;
      const there = dist.get(o.to) ?? Infinity;
      if (there < here) w *= 1 + a / 4;
      else if (there > here) w *= Math.max(0.15, 1 - a / 25);
      if (o.to === this.prevNode) w *= 0.35;
      if (opts.weight) w *= opts.weight(o, n);
      items.push(o.to);
      weights.push(w);
    }
    return this.s.rng.weighted(items, weights);
  }
}

/** Node occupancy so two puppets never stand on the same spot. */
export class Occupancy {
  constructor() {
    this.map = new Map();
  }

  isTaken(node, who) {
    const o = this.map.get(node);
    return o !== undefined && o !== who;
  }

  claim(node, who) {
    if (this.isTaken(node, who)) return false;
    this.map.set(node, who);
    return true;
  }

  force(node, who) {
    this.map.set(node, who);
  }

  release(node, who) {
    if (this.map.get(node) === who) this.map.delete(node);
  }

  clear() {
    this.map.clear();
  }
}
