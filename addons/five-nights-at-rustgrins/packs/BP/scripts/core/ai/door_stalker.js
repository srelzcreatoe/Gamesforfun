// Mirehop (left door) and Noxbriar (right window): FNAF 1 Bonnie/Chica at heart, with a
// smarter head. Every new habit has a tell the guard can learn.
//   roam     early on they wander their own haunts (the weighted table in config.js).
//   hunt     sooner or later (higher AI, after being turned away, or when the other side is
//            busy) they head for their door along a weighted shortest path that avoids the
//            live camera, the rooms the guard watches most, a lit hall and each other.
//            Mirehop is erratic: odd hops, quick double hops while the guard is on the
//            cameras, and slipping out of a camera that stares at him too long (the feed
//            tears). Noxbriar is patient and hums softly as she comes down the East Hall.
//   unseen   an opportunity won while the guard watches them waits for the guard to look
//            away: they move a moment after the feed goes elsewhere (static when you look back).
//   stalk    one step from the doorway (CAM 2B / 4B) they wait for a good moment: never into
//            a lit hall, not while someone else works that side, not right after another
//            strike, and preferably while the guard is on the cameras or has just finished a
//            light check - they learn the rhythm of the guard's checks. After `stalkMax` they
//            come anyway.
//   door     in the doorway the guard sees them only with that side's hall light (a guitar
//            twang / a hum tells). A shut door is a patience timer (shorter if the guard
//            camps that door). An open one lets them in on a successful opportunity - more
//            likely while the guard is on the cameras, never right after the guard checked
//            that light (they wait it out).
//   give up  patience runs out at a shut door: a real retreat (heavy steps, then gone to the
//            least-watched of their haunts), or a fake-out (a soft twang / hum just outside):
//            they wait in the corner and step straight back if the door opens. Either way
//            they hunt again sooner.
//   inside   that side's buttons die; the jumpscare comes when the monitor goes down.

import { Animatronic, pickFrom } from './base.js';
import { NODES } from '../../data/nodes.js';
import { CONFIG } from '../config.js';
import { neighbors, adjacent, planPath, sideOf, distToDoor } from './graph.js';

const OTHER = Object.freeze({ L: 'R', R: 'L' });

export class DoorStalker extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.side = this.cfg.side; // 'L' | 'R'
    this.door = this.cfg.door;
    this.pincer = true;
    this.holdLeft = 0;
    this.enterAt = 0;
    this.killAt = 0;
    this.nextTell = 0;
    /** 'roam' (their haunts) | 'hunt' (heading for the door) */
    this.mode = 'roam';
    this.stalkSince = 0;
    this.lingerUntil = 0;
    this.returnAt = 0;
    this.eagerUntil = 0;
    this.turnedAway = 0;
    /** @type {string | null | undefined} */
    this._corner = undefined;
    this.costFn = (_a, b) => this.stepCost(b);
    this.blockFn = (n) => this.offLimits(n);
  }

  /** The spot one step from the doorway where they wait just out of the light. */
  get corner() {
    if (this._corner === undefined) this._corner = neighbors(this.door).find((n) => !this.offLimits(n)) ?? null;
    return this._corner;
  }

  holds(slot) {
    if (slot !== this.side) return false;
    return this.node === this.door || this.walk?.to === this.door || this.state === 'entering' || this.state === 'inside';
  }

  /** Nodes a door stalker never walks through: ducts, vents, other doors, the nook, others' stages. */
  offLimits(n) {
    if (n === this.door) return false;
    const N = NODES[n];
    return !N || !!N.crawl || !!N.vent || !!N.door || !!N.dark || (N.pose === 'stage' && n !== this.cfg.start);
  }

  /** Extra cost of stepping onto a node: the live camera, watched rooms, a lit hall, company. */
  stepCost(b) {
    const s = this.s;
    const B = CONFIG.brain;
    const g = s.habits;
    let c = g.nodeHeat(b) * B.heatCost;
    if (s.isWatchingNode(b)) c += B.watchedCost;
    if (g.lit(this.side) && distToDoor(b, this.side) <= B.lightReach) c += B.litCost;
    if (sideOf(b) === OTHER[this.side]) c += B.otherSideCost;
    for (const id in s.chars) {
      const o = s.chars[id];
      if (o !== this && o.node === b && !o.walk) {
        c += B.crowdCost;
        break;
      }
    }
    return c;
  }

  huntChance() {
    let p = 0.1 + this.ai * 0.025;
    if (this.s.t < this.eagerUntil) p += 0.4;
    if (this.s.director.pincerOn(this)) p += 0.25;
    return Math.min(0.95, p);
  }

  /** Patience at a shut door: shorter when the guard camps it (they will be back). */
  patience() {
    const h = this.cfg.hold(this.ai);
    return this.s.habits.camped(this.side) ? Math.round(h * 0.75) : h;
  }

  tick() {
    this.tickEyes();
    if (this.tickWalk()) return;
    const s = this.s;
    if (this.state === 'inside') {
      // jumpscare once the monitor is down (FNAF 1: they wait for you to look up)
      if (!s.devices.cams.open && s.t >= this.killAt) s.kill(this.id);
      return;
    }
    if (this.state === 'entering') {
      // a door slammed during the step in still saves the guard: a close call
      if (s.doorClosed(this.side)) {
        this.state = 'door';
        this.holdLeft = this.patience();
        s.director.closeCall(this.id);
        return;
      }
      if (s.t >= this.enterAt) {
        this.state = 'inside';
        this.inside = true;
        s.breach(this.side, this.id);
        this.killAt = s.t + (s.devices.cams.open ? 10 : s.rng.int(40, 100));
        s.emit({ fx: 'hide', who: this.id });
      }
      return;
    }
    if (this.node === this.door) return this.tickDoor();
    if (this.state === 'linger') return this.tickLinger();
    if (this.state === 'stalk') return this.tickStalk(false);
    this.state = this.mode;
    const go = this.opportunityUnseen();
    if (!go) return;
    if (go === 'stared') {
      if (this.cfg.slip) this.slipAway();
      return;
    }
    this.advance();
  }

  /** Pick the next hop: their haunts while roaming, the planned path while hunting. */
  chooseNext() {
    const s = this.s;
    if (this.mode === 'roam' && s.rng.chance(this.huntChance())) this.mode = 'hunt';
    if (this.mode === 'roam') {
      const row = this.cfg.table[this.node];
      const pick = row ? pickFrom(s.rng, row) : null;
      if (pick && adjacent(this.node, pick) && !this.offLimits(pick)) return pick;
      // a spot the table does not know (or an edge the map no longer has): plan from here
    }
    const path = planPath(this.node, this.door, { cost: this.costFn, blocked: this.blockFn });
    if (!path || path.length < 2) return null;
    let next = path[1];
    if (next !== this.door && this.cfg.erratic && s.rng.chance(this.cfg.erratic)) {
      const odd = neighbors(this.node).filter((n) => !this.offLimits(n) && n !== this.door && sideOf(n) !== OTHER[this.side] && !s.isWatchingNode(n));
      if (odd.length) next = s.rng.pick(odd);
    }
    return next;
  }

  advance() {
    const s = this.s;
    const next = this.chooseNext();
    if (!next) return;
    if (next === this.door) {
      this.state = 'stalk';
      this.stalkSince = s.t;
      this.tickStalk(true);
      return;
    }
    // erratic: a quick double hop while the guard is busy on the cameras (never into the doorway)
    if (this.mode === 'hunt' && this.cfg.dash && s.habits.busy() && s.rng.chance(this.cfg.dash)) {
      const after = planPath(next, this.door, { cost: this.costFn, blocked: this.blockFn })?.[1];
      if (after && after !== this.door && after !== this.node && !s.isWatchingNode(next) && !s.isWatchingNode(after)) {
        if (this.goTo(after, { via: [this.node, next, after], speed: (this.cfg.walkSpeed ?? 0.12) * 1.7, anim: 'run' })) {
          this.stepCue(after, { fast: true });
          return;
        }
      }
    }
    this.goTo(next);
  }

  /** One step from the doorway: wait for a good moment to step in. */
  tickStalk(first) {
    const s = this.s;
    if (!first && s.t % 5 !== 0) return;
    const d = s.director;
    const g = s.habits;
    const waited = s.t - this.stalkSince;
    if (!d.free(this.side, this.id)) {
      // somebody else is already working this side: no stacking at one door
      if (waited > this.cfg.stalkMax) this.backOff();
      return;
    }
    if (!d.mayStrike(this.id) || g.lit(this.side)) return; // spacing; never into a lit hall
    const patient = waited < this.cfg.stalkMax;
    if (patient && (this.watched() || !g.safeWindow(this.side))) return;
    d.struck(this.id, this.side);
    this.state = this.mode;
    this.goTo(this.door);
  }

  /** Give up waiting at the corner (another animatronic holds the door): wander back a step. */
  backOff() {
    const s = this.s;
    this.state = 'roam';
    this.mode = 'roam';
    const here = distToDoor(this.node, this.side);
    const away = neighbors(this.node).filter((n) => !this.offLimits(n) && n !== this.door && distToDoor(n, this.side) > here);
    if (away.length) this.goTo(s.rng.pick(away));
  }

  onArrive(node) {
    super.onArrive(node);
    const s = this.s;
    if (node === this.door) {
      this.state = 'door';
      this.holdLeft = this.patience();
      // fair warning: the tell plays now, and the first try at the door comes no sooner than
      // `entryGrace` later (a wait at the corner must not let them walk straight in)
      this.nextMo = Math.max(this.nextMo, s.t + this.cfg.entryGrace);
      s.director.claim(this.side, this.id);
      s.emit({ fx: 'at_door', who: this.id, side: this.side, window: !!NODES[node].window });
      this.tell();
      return;
    }
    if (this.state === 'linger') return; // quietly, just out of the light
    if (node === 'KIT' && this.id === 'noxbriar' && s.rng.chance(this.cfg.kitchenHum)) {
      s.emit({ fx: 'sound', id: 'fnar.noxbriar.hum', at: this.id, vol: 0.7, kitchen: true });
      return;
    }
    // coming closer: Noxbriar hums softly down the hall, Mirehop's steps thud
    if (distToDoor(node, this.side) <= CONFIG.brain.hearSteps) {
      if (this.cfg.hallHum) {
        if (s.rng.chance(this.cfg.hallHum)) s.emit({ fx: 'sound', id: 'fnar.noxbriar.hum', at: this.id, vol: 0.4, approach: this.side });
      } else this.stepCue(node);
    } else if (this.id === 'mirehop' && s.rng.chance(0.25)) {
      s.emit({ fx: 'sound', id: 'fnar.step.heavy', at: this.id, vol: 0.8 });
    }
  }

  tickDoor() {
    const s = this.s;
    const g = s.habits;
    this.state = 'door';
    if (s.t >= this.nextTell) this.tell();
    if (s.doorClosed(this.side)) {
      if (--this.holdLeft <= 0) this.giveUp();
      return;
    }
    if (!this.opportunity(g.busy() ? this.cfg.busyBonus(this.ai) : 0)) return;
    // the guard looked down this hall a moment ago: wait it out, they will look away again
    if (!g.busy() && !g.lit(this.side) && g.justChecked(this.side, this.cfg.wary)) return;
    this.state = 'entering';
    this.enterAt = s.t + this.cfg.enterDelay;
    s.emit({ fx: 'sound', id: 'fnar.servo.move', at: this.id, vol: 0.8 });
  }

  /** The audio tell at the door, repeated while they stand there. */
  tell() {
    const s = this.s;
    this.nextTell = s.t + 90 + s.rng.int(0, 60);
    if (this.id === 'mirehop') s.emit({ fx: 'sound', id: 'fnar.mirehop.strum', at: this.id, vol: 0.9 });
    if (this.id === 'noxbriar') s.emit({ fx: 'sound', id: 'fnar.noxbriar.hum', at: this.id, vol: 0.9 });
  }

  /**
   * Patience ran out at a shut door: a fake-out in the corner, or a real retreat. While the
   * director eases off (the guard is short of power) there are no fake-outs and no hurry back.
   */
  giveUp() {
    const s = this.s;
    const easy = s.director.pressure < 0;
    this.turnedAway++;
    this.eagerUntil = easy ? 0 : s.t + this.cfg.eagerFor;
    this.mode = 'roam';
    s.director.release(this.side, this.id);
    const corner = this.corner;
    if (corner && !easy && s.rng.chance(this.cfg.linger(this.ai))) {
      this.state = 'linger';
      this.lingerUntil = s.t + this.cfg.lingerMax;
      s.emit({ fx: 'left_door', who: this.id, side: this.side, linger: true });
      s.emit({ fx: 'cue', kind: 'linger', who: this.id, side: this.side });
      this.goTo(corner, { speed: (this.cfg.walkSpeed ?? 0.12) * 0.6 });
      this.nextMo = s.t + (this.cfg.mo ?? 100);
      return;
    }
    this.retreat();
  }

  /** Waiting in the corner after a fake-out: back soon after the door opens, else away for real. */
  tickLinger() {
    const s = this.s;
    const d = s.director;
    if (s.t >= this.lingerUntil) return this.retreat();
    if (s.doorClosed(this.side) || s.habits.lit(this.side)) {
      this.returnAt = 0;
      return;
    }
    // the door opened: a beat to notice, then heavy steps back (the tell)
    if (!this.returnAt) this.returnAt = s.t + s.rng.int(20, 45);
    if (s.t < this.returnAt || s.t < this.nextMo) return;
    if (!d.free(this.side, this.id) || !d.mayStrike(this.id)) return;
    d.struck(this.id, this.side);
    this.state = 'roam';
    this.returnAt = 0;
    this.stepCue(this.node);
    this.goTo(this.door);
  }

  retreat() {
    const s = this.s;
    s.director.release(this.side, this.id);
    this.state = 'roam';
    this.mode = 'roam';
    const back = this.retreatSpot();
    s.emit({ fx: 'left_door', who: this.id, side: this.side });
    s.emit({ fx: 'sound', id: 'fnar.step.heavy', at: this.id, vol: 0.9 });
    // the walk away happens off-camera: they vanish into static
    this.placeAt(back, 'stand');
    this.nextMo = s.t + (this.cfg.mo ?? 100) * 2;
  }

  /** Where to vanish to after giving up: one of their haunts, preferably one the guard does not watch. */
  retreatSpot() {
    const s = this.s;
    const g = s.habits;
    const taken = (n) => Object.values(s.chars).some((c) => c !== this && (c.node === n || c.walk?.to === n));
    const opts = this.cfg.retreat.filter((n) => NODES[n] && !taken(n));
    if (!opts.length) return this.cfg.retreat.find((n) => NODES[n]) ?? this.cfg.start;
    return s.rng.weighted(opts.map((n) => [n, 0.15 + (1 - g.nodeHeat(n)) ** 2]));
  }

  /** Stared at too long on a camera: he slips out of the frame behind a burst of static. */
  slipAway() {
    const s = this.s;
    const opts = neighbors(this.node).filter((n) => !this.offLimits(n) && n !== this.door && !s.isWatchingNode(n) && sideOf(n) !== OTHER[this.side]);
    if (!opts.length) return;
    s.emit({ fx: 'cue', kind: 'slip', who: this.id, cam: s.devices.cams.cam });
    this.goTo(s.rng.pick(opts));
  }

  debug() {
    return `${this.id}:${this.ai}${this.walk ? `>${this.walk.to}` : `@${this.node}`}/${this.state}${this.mode === 'hunt' ? '!' : ''}`;
  }
}
