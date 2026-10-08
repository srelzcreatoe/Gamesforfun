// Route guidance for the player (the green breadcrumb sparkles).
//
// Uses the walkable waypoint graph generated from the build plan
// (data/guide_graph.generated.js, tools/gen_guide.mjs): every edge is a
// straight line a player can actually walk, so the breadcrumbs follow doors,
// corridors, stairs and ladders instead of pointing through walls and floors.
// Distances to each target are computed once (Dijkstra from the target) and
// cached; a route query is then a walk down the distance field.

import { GUIDE_NODES, GUIDE_EDGES, GUIDE_TARGETS, GUIDE_ROOMS } from '../data/guide_graph.generated.js';
import { roomAt } from '../data/layout.js';

const SEARCH_RADIUS = 9;

export class GuideGraph {
  constructor() {
    this.n = GUIDE_NODES.length / 4;
    /** @type {Array<Array<[number, number]>>} */
    this.adj = Array.from({ length: this.n }, () => []);
    for (let i = 0; i < GUIDE_EDGES.length; i += 3) {
      const a = GUIDE_EDGES[i];
      const b = GUIDE_EDGES[i + 1];
      const l = GUIDE_EDGES[i + 2];
      this.adj[a].push([b, l]);
      this.adj[b].push([a, l]);
    }
    /** @type {Map<string, {dist: Float64Array, next: Int32Array}>} */
    this.fields = new Map();
  }

  hasTarget(name) {
    return GUIDE_TARGETS[name] !== undefined;
  }

  /** Node centre (local coordinates, feet height) and room id. */
  node(i) {
    const r = GUIDE_NODES[i * 4 + 3];
    return { x: GUIDE_NODES[i * 4] + 0.5, y: GUIDE_NODES[i * 4 + 1], z: GUIDE_NODES[i * 4 + 2] + 0.5, room: r >= 0 ? GUIDE_ROOMS[r] : null };
  }

  /** Distance field toward a target (walking steps) with the next node on the way. */
  field(name) {
    let f = this.fields.get(name);
    if (f) return f;
    const t = GUIDE_TARGETS[name];
    const dist = new Float64Array(this.n).fill(Infinity);
    const next = new Int32Array(this.n).fill(-1);
    dist[t] = 0;
    // binary heap of [dist, node]
    const heap = [[0, t]];
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      for (const [v, l] of this.adj[u]) {
        if (d + l < dist[v]) {
          dist[v] = d + l;
          next[v] = u;
          push([dist[v], v]);
        }
      }
    }
    f = { dist, next };
    this.fields.set(name, f);
    return f;
  }

  /**
   * Best node to join the route from `pos`: among nearby nodes on the same
   * floor (same room when the player is in one), minimise distance-to-node +
   * remaining route length, so the trail never starts by walking backwards.
   */
  entry(pos, f) {
    const room = roomAt(pos.x, pos.y, pos.z)?.id ?? null;
    let best = -1;
    let bestScore = Infinity;
    let nearest = -1;
    let nearestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (f.dist[i] === Infinity) continue;
      const nd = this.node(i);
      if (Math.abs(nd.y - pos.y) > 2.5) continue;
      const d = Math.hypot(nd.x - pos.x, nd.z - pos.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = i;
      }
      if (d > SEARCH_RADIUS) continue;
      if (room && nd.room !== room) continue;
      const score = d + f.dist[i];
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best >= 0 ? best : nearest;
  }

  /**
   * Route from `pos` toward target `name`.
   * @returns {{points: Array<{x:number,y:number,z:number}>, remaining: number, arrived: boolean} | null}
   */
  route(pos, name, maxLength = 16) {
    if (!this.hasTarget(name)) return null;
    const f = this.field(name);
    const start = this.entry(pos, f);
    if (start < 0) return null;
    const goal = this.node(GUIDE_TARGETS[name]);
    const remaining = Math.hypot(goal.x - pos.x, goal.z - pos.z) < 3 && Math.abs(goal.y - pos.y) < 2
      ? 0
      : f.dist[start] + Math.hypot(this.node(start).x - pos.x, this.node(start).z - pos.z);
    const points = [{ x: pos.x, y: pos.y, z: pos.z }];
    let length = 0;
    let i = start;
    while (i >= 0 && length < maxLength) {
      const nd = this.node(i);
      const prev = points[points.length - 1];
      length += Math.hypot(nd.x - prev.x, nd.y - prev.y, nd.z - prev.z);
      points.push({ x: nd.x, y: nd.y, z: nd.z });
      i = this.fields.get(name).next[i];
    }
    return { points, remaining, arrived: remaining === 0 };
  }

  /** Evenly spaced breadcrumb positions along the first `length` blocks of a route. */
  static crumbs(points, spacing = 1.25, length = 14) {
    const out = [];
    let carry = spacing * 0.6;
    let walked = 0;
    for (let k = 1; k < points.length && walked < length; k++) {
      const a = points[k - 1];
      const b = points[k];
      const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      let s = carry;
      while (s <= seg && walked + s <= length) {
        const f = s / seg;
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
        s += spacing;
      }
      carry = s - seg;
      walked += seg;
    }
    return out;
  }
}
