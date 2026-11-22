/**
 * A way round.  His steering looks a few lengths ahead and turns by the smallest angle that clears; that fails
 * in front of a long wall, a harbour mole or a bay with one mouth.  When he has been stopped for a while this
 * planner searches a coarse grid of his surroundings for a route (A*), a few cells a tick so the work is spread,
 * and hands back way-points to walk or swim along.  It only ever asks the question the creature already asks
 * of the world ("could my middle be here, coming from there?"), so it never finds a way he could not take.
 */
import type { V3 } from "./vec";

/**
 * Could he stand (or float) at x,z, coming straight from fx,fz at height y?  The floor there; `null` if he could
 * not be there at all (from anywhere); `false` if he could, but not by this line (something stands across it).
 */
export type Passable = (x: number, z: number, y: number, fx: number, fz: number) => number | null | false;

interface Node { ix: number; iz: number; y: number; g: number; f: number; from: Node | null; open: boolean }

export class Planner {
  done = false;
  /** Way-points (cell centres) from the first step to the end; empty if there was nowhere to go. */
  path: V3[] = [];
  /** Did the route reach the goal, or only the nearest place to it that could be reached? */
  reached = false;
  private readonly nodes = new Map<string, Node>();
  private readonly dead = new Set<string>();
  private open: Node[] = [];
  private best: Node;
  private expanded = 0;
  private readonly gx: number;
  private readonly gz: number;

  constructor(private readonly passable: Passable, private readonly cell: number, private readonly start: V3, goal: V3,
              private readonly reach: number, private readonly maxNodes = 320) {
    this.gx = Math.round((goal.x - start.x) / cell);
    this.gz = Math.round((goal.z - start.z) / cell);
    const s: Node = { ix: 0, iz: 0, y: start.y, g: 0, f: this.h(0, 0), from: null, open: true };
    this.nodes.set("0,0", s);
    this.open.push(s);
    this.best = s;
  }

  private h(ix: number, iz: number): number {
    const dx = Math.abs(ix - this.gx), dz = Math.abs(iz - this.gz);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  }

  /** Do up to `tests` world questions' worth of searching.  Returns true when finished. */
  step(tests: number): boolean {
    if (this.done) return true;
    let asked = 0;
    while (asked < tests) {
      // the open node with the least f
      let bi = -1;
      for (let i = 0; i < this.open.length; i++) if (bi < 0 || this.open[i].f < this.open[bi].f) bi = i;
      if (bi < 0 || this.expanded >= this.maxNodes) return this.finish();
      const n = this.open.splice(bi, 1)[0];
      n.open = false;
      this.expanded++;
      if (this.h(n.ix, n.iz) < this.h(this.best.ix, this.best.iz)) this.best = n;
      if (n.ix === this.gx && n.iz === this.gz) { this.best = n; this.reached = true; return this.finish(); }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const ix = n.ix + dx, iz = n.iz + dz, key = `${ix},${iz}`;
        if (this.dead.has(key) || Math.hypot(ix, iz) * this.cell > this.reach) continue;
        let m = this.nodes.get(key);
        const step = dx && dz ? 1.414 : 1;
        if (!m) {
          asked++;
          const y = this.passable(this.start.x + ix * this.cell, this.start.z + iz * this.cell, n.y,
                                  this.start.x + n.ix * this.cell, this.start.z + n.iz * this.cell);
          if (y === null) { this.dead.add(key); continue; }
          if (y === false) continue;                       // not this way: it may still be reached from another side
          m = { ix, iz, y, g: n.g + step, f: 0, from: n, open: true };
          m.f = m.g + this.h(ix, iz);
          this.nodes.set(key, m);
          this.open.push(m);
        } else if (m.open && n.g + step < m.g) {
          m.g = n.g + step; m.f = m.g + this.h(ix, iz); m.from = n;
        }
      }
    }
    return false;
  }

  private finish(): boolean {
    this.done = true;
    const out: V3[] = [];
    for (let n: Node | null = this.best; n && n.from; n = n.from) out.push({ x: this.start.x + n.ix * this.cell, y: n.y, z: this.start.z + n.iz * this.cell });
    out.reverse();
    // a route that gets no nearer than where he stands is no route
    this.path = this.h(this.best.ix, this.best.iz) < this.h(0, 0) - 0.5 ? out : [];
    return true;
  }
}
