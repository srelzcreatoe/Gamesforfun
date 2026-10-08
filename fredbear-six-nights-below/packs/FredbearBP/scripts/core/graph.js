// Per-character route graphs with dynamic gates and cached shortest paths.

import { NODES, NODE_BY_ID, EDGES, ACCESS, edgePolyline, polylineLength } from '../data/nodes.js';

export class RouteGraph {
  /**
   * @param {string} who character id
   * @param {(gate: string) => boolean} gateOpen
   */
  constructor(who, gateOpen) {
    this.who = who;
    this.letter = ACCESS[who];
    this.gateOpen = gateOpen;
    this.edges = EDGES.filter((e) => e.access.includes(this.letter));
    this.lengths = new Map(this.edges.map((e) => [e.id, polylineLength(edgePolyline(e, e.a))]));
    this.nodes = new Set();
    for (const e of this.edges) {
      this.nodes.add(e.a);
      this.nodes.add(e.b);
    }
    this.cache = new Map();
    this.gateKey = '';
  }

  /** Edges usable right now from a node (respecting gates). */
  neighbours(nodeId) {
    const out = [];
    for (const e of this.edges) {
      if (e.gate && !this.gateOpen(e.gate)) continue;
      if (e.a === nodeId) out.push({ edge: e, to: e.b, len: this.lengths.get(e.id) });
      else if (e.b === nodeId) out.push({ edge: e, to: e.a, len: this.lengths.get(e.id) });
    }
    return out;
  }

  edgeBetween(a, b) {
    return this.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  }

  currentGateKey() {
    const gates = [...new Set(this.edges.filter((e) => e.gate).map((e) => e.gate))].sort();
    return gates.map((g) => `${g}:${this.gateOpen(g) ? 1 : 0}`).join(',');
  }

  /** Dijkstra distances (blocks) from every node to `target`. */
  distancesTo(target) {
    const key = this.currentGateKey();
    if (key !== this.gateKey) {
      this.cache.clear();
      this.gateKey = key;
    }
    let d = this.cache.get(target);
    if (d) return d;
    d = new Map();
    for (const n of this.nodes) d.set(n, Infinity);
    if (!this.nodes.has(target)) {
      this.cache.set(target, d);
      return d;
    }
    d.set(target, 0);
    const open = new Set([target]);
    while (open.size) {
      let best;
      let bestD = Infinity;
      for (const n of open) {
        if (d.get(n) < bestD) {
          bestD = d.get(n);
          best = n;
        }
      }
      open.delete(best);
      for (const { to, len } of this.neighbours(best)) {
        const nd = bestD + len;
        if (nd < d.get(to)) {
          d.set(to, nd);
          open.add(to);
        }
      }
    }
    this.cache.set(target, d);
    return d;
  }

  /** Shortest path [from, ..., to] or null. */
  path(from, to) {
    const d = this.distancesTo(to);
    if (!isFinite(d.get(from) ?? Infinity)) return null;
    const out = [from];
    let cur = from;
    let guard = 0;
    while (cur !== to && guard++ < 200) {
      let next;
      let nextD = Infinity;
      for (const { to: n, len } of this.neighbours(cur)) {
        const cand = d.get(n) + len;
        if (cand < nextD - 1e-9) {
          nextD = cand;
          next = n;
        }
      }
      if (!next) return null;
      out.push(next);
      cur = next;
    }
    return cur === to ? out : null;
  }

  distance(from, to) {
    return this.distancesTo(to).get(from) ?? Infinity;
  }
}

export function nodeZone(id) {
  return NODE_BY_ID[id]?.zone;
}

export { NODES, NODE_BY_ID };
