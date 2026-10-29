// Purple Rat: nervous, twitchy, shares the Midway ring with the Cat and lives in the
// crawl ducts. His boldness follows the troupe's show tape (see show_tape.js). He leaves the
// Midway through the ceiling grate (west duct -> the office's LEFT vent) or
// walks through the dining hall to the kitchen grate (east duct -> RIGHT
// vent). In the ducts every move rattles his maracas (positional, so the
// guard can hear which side and how close). Twitchy: some opportunities send
// him one node back. At the vent he waits a moment; a shut vent cover makes
// him bang on it and crawl back, an open vent is the end.

import { Animatronic } from './base.js';
import { CONFIG } from '../config.js';
import { NODES } from '../../data/nodes.js';

export class PurpleRat extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.side = null;
    this.idx = 0;
    this.graceUntil = 0;
  }

  bonus() {
    return this.s.tape.bonus(); // the troupe grows bolder as their music slows, and when it stops
  }

  route() {
    return this.cfg.routes[this.side ?? 'L'];
  }

  tick() {
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
        this.state = 'duct';
        this.idx = this.cfg.retreatIndex;
        this.placeAt(route[this.idx], 'crawl');
        this.nextMo = s.t + this.cfg.mo * 2;
      } else {
        this.state = 'inside';
        this.inside = true;
        s.breach('V' + this.side, this.id);
        this.killAt = s.t + 1;
      }
      return;
    }
    if (!this.opportunity()) return;
    if (this.idx === 0) {
      this.side = s.rng.chance(0.5) ? 'L' : 'R';
      this.state = 'out';
    }
    const r = this.route();
    let next = this.idx + 1;
    if (this.idx > 2 && s.rng.chance(this.cfg.twitch)) next = this.idx - 1; // twitchy: backs off
    next = Math.max(0, Math.min(r.length - 1, next));
    if (next === this.idx) return;
    const target = r[next];
    const crawl = !!NODES[target].crawl;
    const ok = this.goTo(target, { speed: crawl ? this.cfg.crawlSpeed : this.cfg.walkSpeed, anim: crawl ? 'crawl' : 'scurry' });
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
