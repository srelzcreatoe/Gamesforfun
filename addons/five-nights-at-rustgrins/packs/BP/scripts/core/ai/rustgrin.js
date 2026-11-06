// Rustgrin: FNAF 1 Freddy at heart. He follows his show route down the east side and only
// moves while nobody watches him on a camera. His last stop is the nook in the E. Hall
// Corner, which only CAM 4B can see (never the hall light). From there he comes in through
// an OPEN right door while the guard is busy on any other camera; a shut door at a
// successful opportunity sends him back up the East Hall. Every move: a laugh and mic
// feedback. Smarter, and still dark, patient and fond of laughing:
//   - camera-shy: he never steps into a room the guard is looking at right now, and a stop
//     the guard keeps watching is skipped when a darker way leads past it (once a trip);
//   - the blink: when a long stare ends he may move the moment the guard looks away (a low
//     laugh, and static where he stood);
//   - the dark: he does not slip from the hall into the nook while the right hall light is
//     on, and leaves the right side to Noxbriar while she is at the window (director slots);
//   - patient: after the door turns him back he laughs from the hall and takes his time
//     before the next try.

import { Animatronic } from './base.js';
import { NODES } from '../../data/nodes.js';
import { CAMERA_BY_ID } from '../../data/cameras.js';
import { adjacent, planPath, isDark } from './graph.js';

export class Rustgrin extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.side = this.cfg.side;
    this.pincer = true;
    this.onCams = 0;
    this.patientUntil = 0;
    this.blinkAt = -1;
    this.blinkReady = 0;
    this.skipped = false;
    this.route = this.cfg.route.filter((n) => !!NODES[n]);
    this.goal = this.route[this.route.length - 1];
    this.blockFn = (n) => this.offLimits(n);
    this.darkFn = (_a, b) => this.darkCost(b);
  }

  holds(slot) {
    return slot === this.side && (this.node === this.goal || this.walk?.to === this.goal || this.state === 'inside');
  }

  /** He walks the halls and the dining room, never the ducts, the doors or the others' stages. */
  offLimits(n) {
    if (n === this.goal) return false;
    const N = NODES[n];
    return !N || !!N.crawl || !!N.vent || !!N.door || (N.pose === 'stage' && n !== this.cfg.start);
  }

  /** The dark is cheap; a camera costs, the more the guard watches it, and the live one most. */
  darkCost(b) {
    if (isDark(b)) return 0;
    const s = this.s;
    return 10 + s.habits.nodeHeat(b) * 60 + (s.isWatchingNode(b) ? 200 : 0);
  }

  onArrive(node) {
    super.onArrive(node);
    if (node === this.goal) {
      // the tell: feedback squeal right outside the right door
      this.s.emit({ fx: 'sound', id: 'fnar.rustgrin.feedback', at: 'door_r', vol: 0.8 });
      this.s.emit({ fx: 'at_nook', who: this.id });
    }
  }

  tick() {
    this.tickEyes();
    if (this.tickWalk()) return;
    const s = this.s;
    if (this.state === 'inside') {
      if (!s.devices.cams.open && s.t >= this.killAt) s.kill(this.id);
      return;
    }
    if (this.node === this.goal) return this.tickNook();
    this.state = 'route';
    if (this.watched()) {
      // FNAF 1: a watched Freddy also loses his opportunity timing
      if (s.t >= this.nextMo) this.nextMo = s.t + this.cfg.mo;
      return;
    }
    if (this.blink()) return;
    if (s.t < this.patientUntil) {
      if (s.t >= this.nextMo) this.nextMo = s.t + this.cfg.mo;
      return;
    }
    if (!this.opportunity()) return;
    this.advance(false);
  }

  /** A long stare just ended: he may move the moment the guard looks away. */
  blink() {
    const s = this.s;
    const c = this.cfg;
    if (this.awayAt === s.t && this.active && this.staredFor >= c.blinkAfter && s.t >= this.blinkReady && s.t >= this.patientUntil) {
      if (s.rng.chance(c.blinkChance(this.ai))) {
        this.blinkAt = s.t + s.rng.int(4, 14);
        this.blinkReady = s.t + c.blinkCooldown;
      }
    }
    if (this.blinkAt < 0 || s.t < this.blinkAt) return false;
    this.blinkAt = -1;
    const from = this.node;
    if (!this.advance(true)) return false;
    s.emit({ fx: 'cue', kind: 'blink', who: this.id, from });
    return true;
  }

  /** One stop further along his route (or past a watched one). Returns true if he moved. */
  advance(blink) {
    const s = this.s;
    const g = s.habits;
    const d = s.director;
    const i = this.route.indexOf(this.node);
    if (i < 0) {
      // off his route (placed elsewhere): back to the nearest stop, in the dark
      const back = planPath(this.node, (n) => this.route.includes(n), { cost: this.darkFn, blocked: this.blockFn });
      if (!back || back.length < 2) return false;
      return this.goTo(back[back.length - 1], { via: back.length > 2 ? back : null });
    }
    let target = this.route[i + 1];
    if (!target) return false;
    // camera-shy: never into a room the guard is looking at right now
    if (s.isWatchingNode(target)) return false;
    let via = null;
    // a stop the guard keeps watching: past it by a darker way, if there is one (once a trip)
    const after = this.route[i + 2];
    if (!this.skipped && after && after !== this.goal && g.nodeHeat(target) >= this.cfg.hotStop) {
      const path = planPath(this.node, after, { cost: this.darkFn, blocked: (n) => n === target || this.offLimits(n) });
      if (path && path.length <= 4 && path.every((n, k) => k === 0 || !s.isWatchingNode(n))) {
        target = after;
        via = path;
        this.skipped = true;
      }
    }
    if (target === this.goal) {
      // into the nook: not under a lit hall light, not while the right side is worked, spaced from other strikes
      if (g.lit(this.side) || !d.free(this.side, this.id) || !d.mayStrike(this.id)) return false;
      d.struck(this.id, this.side);
    }
    if (!via && !adjacent(this.node, target)) via = planPath(this.node, target, { cost: this.darkFn, blocked: this.blockFn });
    if (!this.goTo(target, { via: via && via.length > 2 ? via : null })) return false;
    if (blink || s.rng.chance(this.cfg.laughChance)) s.emit({ fx: 'sound', id: 'fnar.rustgrin.laugh', at: 'near_office', vol: blink ? 0.55 : 0.7 });
    s.emit({ fx: 'sound', id: 'fnar.rustgrin.feedback', at: this.id, vol: 0.7 });
    return true;
  }

  tickNook() {
    const s = this.s;
    this.state = 'nook';
    const doorOpen = !s.doorClosed('R');
    const cam = s.devices.cams.open ? CAMERA_BY_ID[s.devices.cams.cam] : null;
    const busy = !!cam && !cam.sees.includes(this.goal); // on a camera that cannot see him
    this.onCams = doorOpen && busy && this.active ? this.onCams + 1 : 0;
    if (this.onCams >= this.cfg.enterAfter) {
      this.state = 'inside';
      this.inside = true;
      s.breach('R', this.id);
      s.emit({ fx: 'hide', who: this.id });
      s.emit({ fx: 'sound', id: 'fnar.rustgrin.laugh', at: 'office', vol: 0.6 });
      this.killAt = s.t + 10;
      return;
    }
    if (!doorOpen && this.opportunity() && !this.watched()) {
      // the door held: back up the hall (off camera), laughing, and he takes his time
      s.director.release(this.side, this.id);
      this.skipped = false;
      this.placeAt(NODES[this.cfg.repelTo] ? this.cfg.repelTo : this.route[Math.max(0, this.route.length - 4)], 'stand');
      s.emit({ fx: 'sound', id: 'fnar.step.heavy', at: 'door_r', vol: 0.9 });
      s.emit({ fx: 'sound', id: 'fnar.rustgrin.laugh', at: 'near_office', vol: 0.5 });
      this.patientUntil = s.t + this.cfg.patience;
    }
  }

  debug() {
    return `rustgrin:${this.ai}${this.walk ? `>${this.walk.to}` : `@${this.node}`}/${this.state}${this.s.t < this.patientUntil ? ' patient' : ''}`;
  }
}
