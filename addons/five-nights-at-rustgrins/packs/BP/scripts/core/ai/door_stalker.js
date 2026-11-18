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
//
// Their signature tricks (never on the training night; each has a tell and a counter):
//   the knock   (Mirehop) waiting at the corner with no good moment in sight (the guard is off
//            the cameras and not due to look away), he raps on the wall by the open door: three
//            quick taps, no twang. It is bait for a light check: the hall is empty, and the
//            moment that light goes off again he steps into the doorway, a little bolder for
//            it. Counter: look again a moment later (or hold the light, or find him on the
//            corner camera): the usual twang and the usual grace still come first.
//   the thrown voice  (Noxbriar) a hum from the WRONG hall, too clear and too near to be
//            real. If the guard lights that hall, she steps up to her own window while they
//            look the other way. Counter: at a hum that is too clean, check HER side, twice.
//   memory   a stalker whose hall the guard neglected on earlier nights hunts sooner (and the
//            other one a little later); one that caught the guard last time comes first, by
//            the same way, and says so (the 'grudge' cue). See memory.js.
//   trading places  (the director, late nights) Mirehop and Noxbriar swap halls for one trip:
//            a twang and a hum together in the dining room tell. The tells at the door stay
//            their own (his twang, her hum), on the side they come from.
//   places!  (the Ringmaster, from his booth) callBack() puts them back on the stage and
//            sendOut() sends them out again, together: see top_hat_rat.js.

import { Animatronic, pickFrom } from './base.js';
import { NODES } from '../../data/nodes.js';
import { CONFIG } from '../config.js';
import { neighbors, adjacent, planPath, sideOf, distToDoor, DOOR_NODES, heardOnly } from './graph.js';

const OTHER = Object.freeze({ L: 'R', R: 'L' });
/** Rustgrin's hideout (the last stop of his route): never a door stalker's way. */
const NOOK = CONFIG.characters.rustgrin.route[CONFIG.characters.rustgrin.route.length - 1];
/** Nobody walks through the ducts or the vents. */
const walkable = (n) => !!NODES[n] && !NODES[n].crawl && !NODES[n].vent;

export class DoorStalker extends Animatronic {
  constructor(s, id) {
    super(s, id);
    /** their own hall; `side` / `door` are where they work right now (the other hall after a trade) */
    this.home = this.cfg.side;
    this.side = this.home; // 'L' | 'R'
    this.door = this.cfg.door;
    this.traded = false;
    this.tradeUntil = 0;
    this.probing = false;
    this.errandUntil = 0; // on the way to a room the guard can only listen to, to make a racket there (the director)
    this.sentUntil = 0; // sent out by the Ringmaster ("places!"): keen until then
    /** a bait in the air: { kind: 'knock' | 'decoy', at, until }; `bold`: the guard took it */
    this.bait = null;
    this.bold = false;
    /** @type {string | null} the bait the guard took before this visit to the door */
    this.took = null;
    this.baitReady = 0;
    this.baitTried = false;
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
    return !walkable(n) || !!N.door || n === NOOK || (N.pose === 'stage' && n !== this.cfg.start);
  }

  /** The planned way to the door (or, if the map leaves no other, any walkable way). */
  plan(from) {
    return planPath(from, this.door, { cost: this.costFn, blocked: this.blockFn }) ?? planPath(from, this.door, { blocked: (n) => !walkable(n) });
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
    const s = this.s;
    // a grudge (they got in last time) or a trade: straight for the door
    if (this.grudge || this.traded) return 1;
    let p = 0.1 + this.ai * 0.025;
    if (s.t < this.eagerUntil) p += 0.4;
    if (s.director.pincerOn(this)) p += 0.25;
    // what they remember: the hall the guard neglected is tried first, the other one later
    const b = s.beliefs;
    const M = CONFIG.memory;
    if (this.probing) p = Math.max(p, b.softBy * s.trust());
    else if (b?.soft) p -= M.probeOther * b.softBy * s.trust();
    // somebody else opens tonight (it caught the guard last time, or its hall is the soft one): after you
    if (s.openerPending(this)) p *= 1 - M.afterYou * s.trust();
    return Math.max(0.02, Math.min(0.95, p));
  }

  adopt(b) {
    super.adopt(b);
    if (this.grudge) this.grudge = this.side; // a stalker's way in is its own door
    /** opens the night at the hall the guard neglected on earlier nights (until the first visit to its door) */
    this.probing = !!b && !b.encore && b.soft === this.home && b.conf >= 0.5;
  }

  /** Opening the night: the one with a grudge, or the one whose hall is the soft one. */
  get opening() {
    return !!this.grudge || this.probing;
  }

  /**
   * A little keener on the opening trip (it fades with the night's trust in what they
   * remember), for a while after the Ringmaster sent them out, and on a trip to the other hall.
   */
  bonus() {
    const s = this.s;
    const P = CONFIG.characters.top_hat_rat.places;
    const M = CONFIG.memory;
    return (this.opening ? Math.round((this.grudge ? M.grudgeKeen : M.keen) * s.trust()) : 0) + (s.t < this.sentUntil || this.traded ? P.keen : 0);
  }

  /** The errand is run (the racket is made, or there was nobody to cover any more): off to their own door, in a hurry. */
  afterErrand() {
    this.errandUntil = 0;
    this.mode = 'hunt';
    this.eagerUntil = this.s.t + this.cfg.eagerFor;
    this.nextMo = Math.min(this.nextMo, this.s.t + 20);
  }

  /** Work the other hall (a trade) or their own again. */
  setSide(side) {
    this.side = side;
    this.door = side === this.home ? this.cfg.door : DOOR_NODES[side].find((n) => !NODES[n].window) ?? DOOR_NODES[side][0] ?? this.cfg.door;
    this._corner = undefined;
  }

  /** Can the director move this one about right now (a trade, the Ringmaster's call)? */
  get loose() {
    return this.active && !this.inside && !this.traded && (this.state === 'roam' || this.state === 'hunt') && this.node !== this.door && this.walk?.to !== this.door;
  }

  /** Trading places: one trip to the OTHER hall's door. */
  trade(until) {
    this.setSide(OTHER[this.home]);
    this.traded = true;
    this.tradeUntil = until;
    this.mode = 'hunt';
    this.pending = null;
    this.errandUntil = 0;
  }

  tradeBack() {
    if (!this.traded) return;
    this.traded = false;
    this.setSide(this.home);
  }

  /** The Ringmaster calls them back to the stage (they stand there until `until`). */
  callBack(until) {
    const s = this.s;
    s.director.release(this.side, this.id);
    this.tradeBack();
    this.state = 'roam';
    this.mode = 'roam';
    this.pending = null;
    this.bait = null;
    this.bold = false;
    this.errandUntil = 0;
    this.placeAt(this.cfg.start, 'pose');
    this.nextMo = until + (this.cfg.mo ?? 100);
  }

  /** ...and sends them out again: they step off the stage the moment nobody watches it. */
  sendOut(eagerFor) {
    const s = this.s;
    this.mode = 'hunt';
    this.eagerUntil = s.t + eagerFor;
    this.sentUntil = s.t + eagerFor;
    this.pending = { until: s.t + CONFIG.brain.freezeMax, go: 0 };
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
        s.breach(this.side, this.id, false, this.traded ? 'traded' : this.took);
        this.killAt = s.t + (s.devices.cams.open ? 10 : s.rng.int(40, 100));
        s.emit({ fx: 'hide', who: this.id });
      }
      return;
    }
    if (this.node === this.door) return this.tickDoor();
    if (this.state === 'linger') return this.tickLinger();
    if (this.state === 'stalk') return this.tickStalk(false);
    this.state = this.mode;
    if (this.traded && s.t >= this.tradeUntil) this.tradeBack(); // the trade came to nothing
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
    // the racket's errand (the director): into the kitchen, to make a noise for the other one
    const errand = s.director.errand(this);
    if (errand) {
      this.errandUntil = s.t + 600;
      return errand;
    }
    if (this.mode === 'roam' && s.rng.chance(this.huntChance())) this.mode = 'hunt';
    if (this.mode === 'roam') {
      const row = this.cfg.table[this.node];
      const pick = row ? pickFrom(s.rng, row) : null;
      if (pick && adjacent(this.node, pick) && !this.offLimits(pick)) return pick;
      // a spot the table does not know (or an edge the map no longer has): plan from here
    }
    const path = this.plan(this.node);
    if (!path || path.length < 2) return null;
    let next = path[1];
    // (no odd hops on the opening trip: straight for the door)
    if (next !== this.door && this.cfg.erratic && !this.opening && !this.traded && s.t >= this.sentUntil && s.rng.chance(this.cfg.erratic)) {
      const odd = neighbors(this.node).filter((n) => !this.offLimits(n) && n !== this.door && sideOf(n) !== OTHER[this.side] && !s.isWatchingNode(n));
      if (odd.length) next = s.rng.pick(odd);
    }
    return next;
  }

  advance() {
    const s = this.s;
    const next = this.chooseNext();
    if (!next) return;
    if (this.mode === 'hunt') this.grudgeCue();
    if (next === this.door) {
      this.state = 'stalk';
      this.stalkSince = s.t;
      this.bait = null;
      this.baitTried = false;
      this.tickStalk(true);
      return;
    }
    // erratic: a quick double hop while the guard is busy on the cameras (never into the doorway,
    // and not on an errand: that one stops where it is going)
    if (this.mode === 'hunt' && this.cfg.dash && !(this.errandUntil > s.t) && s.habits.busy() && s.rng.chance(this.cfg.dash)) {
      const after = this.plan(next)?.[1];
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
    if (!d.mayStrike(this.id)) return; // spacing
    // the other stalker opens tonight (see memory.js): after you, for the first part of the night
    if (s.openerPending(this, true) && s.trust() > CONFIG.memory.afterYouUntil) return;
    if (s.t < s.openedAt + CONFIG.memory.afterYouPause) return;
    // a good moment: not into a lit hall, not on camera, and by the learned rhythm of the
    // guard's checks - or the guard took the bait, or somebody is making a racket elsewhere.
    // After `stalkMax` they come anyway (a light left on does not stop them).
    const patient = waited < this.cfg.stalkMax;
    if (patient) {
      if (g.lit(this.side) || this.watched()) return;
      this.took = null;
      if (this.baited()) {
        // the guard bit: they think the hall is empty
        this.bold = true;
        this.took = this.bait.kind;
      } else if (!g.safeWindow(this.side) && !d.racket(this)) {
        // no good moment in sight: after a little while, make one
        if (!this.baitTried && waited >= (this.cfg.bait?.after ?? 0)) this.tryBait();
        return;
      }
      // stepping up: if somebody can make a racket elsewhere, they do (the guard is listening to that)
      if (d.racket(this)) this.bold = true;
    }
    d.struck(this.id, this.side);
    this.state = this.mode;
    this.bait = null;
    this.goTo(this.door);
  }

  /** Did the guard take the bait? (The knock: they looked and looked away. The thrown voice: they lit the other hall.) */
  baited() {
    const b = this.bait;
    const s = this.s;
    if (!b || s.t > b.until) return false;
    if (b.kind === 'knock') {
      const L = s.habits.light[this.side];
      return !L.on && L.onAt > b.at;
    }
    return s.habits.light[OTHER[this.side]].onAt > b.at;
  }

  /**
   * No good moment in sight: make one. Mirehop raps on the wall by the open door (bait for a
   * light check: he steps in as that light goes off), Noxbriar throws her hum into the other
   * hall (she steps up while the guard lights the wrong one). Once per wait at the corner, and
   * never while the director goes easy on the guard.
   */
  tryBait() {
    const s = this.s;
    const c = this.cfg.bait;
    this.baitTried = true;
    if (!c || !s.tricks || s.mods.lightsOut) return;
    if (s.t < this.baitReady || this.ai < c.fromAi || s.director.gentle()) return;
    if (s.doorClosed(this.side) || s.devices.broken[this.side]) return; // nothing to bait: they cannot look anyway
    const other = OTHER[this.side];
    if (c.kind === 'decoy' && (s.director.holder(other) || s.devices.broken[other])) return;
    if (!s.rng.chance(c.chance(this.ai))) return;
    this.bait = { kind: c.kind, at: s.t, until: s.t + c.window };
    this.baitReady = s.t + c.cooldown;
    // (`side`: where the guard hears it - the knock at his own door, her hum in the OTHER hall)
    s.emit({ fx: 'cue', kind: c.kind, who: this.id, side: c.kind === 'decoy' ? other : this.side });
  }

  /** Give up waiting at the corner (another animatronic holds the door): wander back a step. */
  backOff() {
    const s = this.s;
    this.state = 'roam';
    this.mode = 'roam';
    this.bait = null;
    const here = distToDoor(this.node, this.side);
    const away = neighbors(this.node).filter((n) => !this.offLimits(n) && n !== this.door && distToDoor(n, this.side) > here);
    this.tradeBack();
    if (away.length) this.goTo(s.rng.pick(away));
  }

  onArrive(node) {
    super.onArrive(node);
    const s = this.s;
    if (node === this.door) {
      this.state = 'door';
      if (this.opening) s.openedAt = s.t; // the night is opened: from here on it is an ordinary one
      this.grudge = null;
      this.probing = false;
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
    if (this.errandUntil > s.t && heardOnly(node)) {
      // the errand: a racket in here, to cover the partner on its way to the other door
      s.director.cover(this);
      this.afterErrand();
      return;
    }
    if (node === 'KIT' && this.id === 'noxbriar' && s.rng.chance(this.cfg.kitchenHum)) {
      s.emit({ fx: 'sound', id: 'fnar.noxbriar.hum', at: this.id, vol: 0.7, kitchen: true });
      return;
    }
    // coming closer: Noxbriar hums softly down the hall, Mirehop's steps thud - unless a
    // racket elsewhere drowns it (the director's cover)
    if (distToDoor(node, this.side) <= CONFIG.brain.hearSteps) {
      if (s.director.covered(this)) return;
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
    // (a guard who took the bait and saw an empty hall: bolder on the first try)
    const bold = this.bold ? this.cfg.bait?.bold ?? 0 : 0;
    if (s.t >= this.nextMo) this.bold = false;
    if (!this.opportunity((g.busy() ? this.cfg.busyBonus(this.ai) : 0) + bold)) return;
    // the guard looked down this hall a moment ago: wait it out, they will look away again
    if (!g.busy() && !g.lit(this.side) && g.justChecked(this.side, this.cfg.wary(this.ai))) return;
    this.state = 'entering';
    this.enterAt = s.t + this.cfg.enterDelay;
    s.emit({ fx: 'sound', id: 'fnar.servo.move', at: this.id, vol: 0.8, door: this.side });
  }

  /** The audio tell at the door, repeated while they stand there. */
  tell() {
    const s = this.s;
    this.nextTell = s.t + 90 + s.rng.int(0, 60);
    // (`door`: the side it comes from - their own, or the other one after trading places)
    if (this.id === 'mirehop') s.emit({ fx: 'sound', id: 'fnar.mirehop.strum', at: this.id, vol: 0.9, door: this.side });
    if (this.id === 'noxbriar') s.emit({ fx: 'sound', id: 'fnar.noxbriar.hum', at: this.id, vol: 0.9, door: this.side });
  }

  /**
   * Patience ran out at a shut door: a fake-out in the corner, or a real retreat. While the
   * director eases off (the guard is short of power) there are no fake-outs and no hurry back.
   */
  giveUp() {
    const s = this.s;
    const easy = s.director.pressure < 0;
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
    this.bold = false;
    this.took = null;
    s.emit({ fx: 'left_door', who: this.id, side: this.side });
    s.emit({ fx: 'sound', id: 'fnar.step.heavy', at: this.id, vol: 0.9 });
    this.tradeBack(); // a trade is one trip: back to their own hall
    const back = this.retreatSpot();
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
    return `${this.id}:${this.ai}${this.walk ? `>${this.walk.to}` : `@${this.node}`}/${this.state}${this.mode === 'hunt' ? '!' : ''}${this.traded ? ' traded' : ''}${this.bait ? ` ${this.bait.kind}` : ''}`;
  }
}
