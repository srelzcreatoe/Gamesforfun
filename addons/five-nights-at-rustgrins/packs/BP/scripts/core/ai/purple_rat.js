// Purple Rat: nervous, twitchy, shares the Midway ring with the Cat and lives in the
// crawl ducts. His boldness follows the troupe's show tape (see show_tape.js). He leaves the
// Midway through the ceiling grate (west duct -> the office's LEFT vent) or
// walks through the dining hall to the kitchen grate (east duct -> RIGHT
// vent). In the ducts every move rattles his maracas (positional, so the
// guard can hear which side and how close). Twitchy: some opportunities send
// him one node back. At the vent he waits a moment; a shut vent cover makes
// him bang on it and crawl back, an open vent is the end. Smarter:
//   - he picks his duct by the guard's habits: away from a vent the guard keeps sealed, and
//     away from the side the guard is busy with (a stalker at that door, or a camped door) -
//     a pincer from the other side. Maracas tell which duct he took.
//   - nervous on camera: in a duct he only moves while the guard looks elsewhere, and stared at
//     (CAM 9 / 10) he squeaks and backs off a section, once per stare - watching the duct
//     cameras buys time (but not the tape on CAM 8);
//   - after every bang on a sealed cover he weighs the two ducts again (each time a side
//     turned him away counts against it) and may give this one up for the other: his
//     maracas fade back towards the Midway;
//   - he waits a section back rather than reach a vent right after another strike.

import { Animatronic } from './base.js';
import { CONFIG } from '../config.js';
import { NODES } from '../../data/nodes.js';
import { adjacent, planPath } from './graph.js';

const OTHER = Object.freeze({ L: 'R', R: 'L' });

export class PurpleRat extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.side = null;
    this.idx = 0;
    this.graceUntil = 0;
    this.turned = { L: 0, R: 0 }; // times each vent turned him away (since he last switched to it)
    this.nervousDone = false;
    // where the two duct routes part (the grate): switching ducts starts again from here
    const { L, R } = this.cfg.routes;
    let fork = 0;
    while (fork + 1 < Math.min(L.length, R.length) && L[fork + 1] === R[fork + 1]) fork++;
    this.fork = fork;
  }

  holds(slot) {
    if (!this.side || slot !== 'V' + this.side) return false;
    return this.state === 'vent' || this.state === 'inside' || (!!this.walk && !!NODES[this.walk.to]?.vent);
  }

  /** The duct for this trip: away from sealed vents and from the side the guard is busy with. */
  chooseSide() {
    const s = this.s;
    const g = s.habits;
    const d = s.director;
    const w = { L: 1, R: 1 };
    for (const side of ['L', 'R']) {
      let x = (1.15 - g.vent[side].ratio) * this.cfg.turnedAway ** this.turned[side];
      if (g.camped(side) || d.holder(side)) x *= 0.45;
      w[side] = Math.max(0.05, x);
    }
    return s.rng.weighted([['L', w.L], ['R', w.R]]);
  }

  /** Stared at in a duct: a squeak, and he backs off one section (once per stare). */
  nervous() {
    if (this.seenSince < 0) this.nervousDone = false;
    if (this.nervousDone || this.stared < this.cfg.nervousAfter || !NODES[this.node]?.crawl || this.idx <= this.cfg.retreatIndex) return false;
    const s = this.s;
    this.nervousDone = true;
    this.idx--;
    s.emit({ fx: 'sound', id: 'fnar.rat.squeak', at: this.id, vol: 0.9 });
    s.emit({ fx: 'cue', kind: 'nervous', who: this.id, side: this.side });
    this.crawlTo(this.route()[this.idx], this.cfg.crawlSpeed * 1.5);
    return true;
  }

  /** Walk / crawl to a node of his route (along the graph if the map no longer joins them directly). */
  crawlTo(target, speed, anim = 'crawl') {
    if (adjacent(this.node, target)) return this.goTo(target, { speed, anim });
    const path = planPath(this.node, target, { blocked: (n) => !!NODES[n]?.door || (!!NODES[n]?.vent && n !== target) });
    return !!path && path.length > 1 && this.goTo(target, { speed, anim, via: path.length > 2 ? path : null });
  }

  bonus() {
    return this.s.tape.bonus(); // the troupe grows bolder as their music slows, and when it stops
  }

  route() {
    return this.cfg.routes[this.side ?? 'L'];
  }

  tick() {
    this.tickEyes();
    if (this.tickWalk()) return;
    const s = this.s;
    if (this.state === 'inside') {
      if (s.t >= this.killAt) s.kill(this.id);
      return;
    }
    const route = this.route();
    if (this.state === 'vent') {
      if (s.t < this.graceUntil) {
        if ((this.graceUntil - s.t) % 30 === 0) s.emit({ fx: 'sound', id: 'fnar.rat.maracas', at: 'vent_' + this.side.toLowerCase(), vol: 1, vent: this.side });
        return;
      }
      if (s.ventClosed(this.side)) {
        s.emit({ fx: 'sound', id: 'fnar.rat.bang', at: 'vent_' + this.side.toLowerCase(), vol: 1 });
        s.emit({ fx: 'vent_bang', side: this.side });
        s.director.release('V' + this.side, this.id);
        s.director.closeCall(this.id);
        this.state = 'duct';
        this.turned[this.side]++;
        if (this.chooseSide() !== this.side) {
          // he gives this duct up: back to the grate, and over to the other one
          this.side = OTHER[this.side];
          this.turned[this.side] = 0;
          this.idx = this.fork;
          const at = this.route()[this.idx];
          this.placeAt(at, NODES[at]?.crawl ? 'crawl' : 'stand');
          s.emit({ fx: 'cue', kind: 'switch', who: this.id, side: this.side });
        } else {
          this.idx = this.cfg.retreatIndex;
          this.placeAt(route[this.idx], 'crawl');
        }
        this.nextMo = s.t + this.cfg.mo * 2;
      } else {
        this.state = 'inside';
        this.inside = true;
        s.breach('V' + this.side, this.id);
        this.killAt = s.t + 1;
      }
      return;
    }
    if (this.nervous()) return;
    // in the ducts he is skittish: an opportunity won on camera waits for the guard to look away
    if (NODES[this.node]?.crawl ? this.opportunityUnseen() !== 'move' : !this.opportunity()) return;
    if (this.idx === 0) {
      this.side = this.chooseSide();
      this.state = 'out';
    }
    const r = this.route();
    let next = this.idx + 1;
    if (this.idx > 2 && s.rng.chance(this.cfg.twitch)) next = this.idx - 1; // twitchy: backs off
    next = Math.max(0, Math.min(r.length - 1, next));
    if (next === this.idx) return;
    const target = r[next];
    if (NODES[target]?.vent) {
      // the last section: not right after another strike, and never onto a vent someone else works
      const slot = 'V' + this.side;
      if (!s.director.free(slot, this.id) || !s.director.mayStrike(this.id)) return;
      s.director.struck(this.id, slot);
    }
    const crawl = !!NODES[target].crawl;
    const ok = this.crawlTo(target, crawl ? this.cfg.crawlSpeed : this.cfg.walkSpeed, crawl ? 'crawl' : 'scurry');
    if (!ok) return;
    this.idx = next;
    if (crawl) {
      s.emit({ fx: 'sound', id: 'fnar.rat.maracas', at: this.id, vol: 1, follow: true, near: next >= r.length - 3 ? this.side : null });
      if (s.rng.chance(0.5)) s.emit({ fx: 'sound', id: 'fnar.rat.crawl', at: this.id, vol: 0.9, follow: true });
    } else {
      s.emit({ fx: 'sound', id: 'fnar.step.scurry', at: this.id, vol: 0.8, follow: true });
    }
  }

  onArrive(node) {
    const s = this.s;
    const n = NODES[node];
    if (n.vent) {
      this.state = 'vent';
      this.graceUntil = s.t + this.cfg.grace(this.ai);
      s.emit({ fx: 'pose', who: this.id, node, pose: 'crawl' });
      s.emit({ fx: 'sound', id: 'fnar.rat.maracas', at: 'vent_' + this.side.toLowerCase(), vol: 1 });
      s.emit({ fx: 'at_vent', side: this.side });
      return;
    }
    if (node === this.cfg.start) {
      this.idx = 0;
      this.state = 'idle';
    } else if (n.crawl) this.state = 'duct';
    s.emit({ fx: 'pose', who: this.id, node, pose: n.crawl ? 'crawl' : n.pose === 'stage' ? 'idle' : 'stand' });
  }

  debug() {
    return `rat:${this.ai}${this.side ?? ''}#${this.idx}${this.walk ? `>${this.walk.to}` : `@${this.node}`}/${this.state}`;
  }
}
