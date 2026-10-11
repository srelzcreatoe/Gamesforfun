// MORGRAVE - the rabbit in the walls (nights 8 and 9).
//
// Fredbear's partner from the 1983 diner ("a golden singing bear and his
// friend"), walled in with him. He never walks the halls: he comes out of the
// walls at the start of one of two crawl routes (MORGRAVE_ROUTE) and crawls
// node by node toward the office.
//   L  supply closet grate -> the duct (VENT_W, CAM 18) -> out of the vent at
//      the LEFT door corner
//   H  the old crawlspace -> the office subfloor (SUB_N, CAM 17) -> up under
//      the HATCH
//
// STATES
//   DORMANT    slumped in Fredbear's chamber (M_HOME) until activation.
//   WALLS      inside the walls (hidden) for a cooldown, then comes out at a route start.
//   CRAWL      on a route; a movement opportunity (d20 <= A every moInterval)
//              moves him one node on. Every move clanks in the vents.
//   APPROACH   the last edge into the entry (out of the vent / up the shaft).
//   TELEGRAPH  window max(50, 110 - 3A): barrier closed for repelTicks, or
//              closed when it ends -> back into the walls; open -> ATTACK.
//
// COUNTERPLAY
//   * vent seals: a sealed duct or shaft in front of him for sealGiveUp ticks
//     and he gives up (back into the walls) - cheaper than holding a door;
//   * the door / hatch, as for everyone else.
// CUES: scraping inside the walls when he comes out (captioned with the
// route), vent clanks as he crawls, no footsteps. CAM 18 / CAM 17 show him.

import { Animatronic } from './base.js';
import { NODE_BY_ID, MORGRAVE_ROUTE, ENTRY_NODE } from '../../data/nodes.js';

const ROUTE_NAME = Object.freeze({ L: 'the west vent', H: 'below the office' });
const SCRAPE_AT = Object.freeze({ L: { x: 80.5, y: 0.5, z: 132.5 }, H: { x: 64.5, y: -8, z: 114.0 } });

export class Morgrave extends Animatronic {
  constructor(session) {
    super(session, 'morgrave');
  }

  /** Silent: no footsteps, only the vents (clanks are emitted by his crawl steps). */
  emitStep() {}

  reset() {
    super.reset();
    this.anim = 'dormant';
    this.route = null;
    this.sealedTicks = 0;
    this.viaVent = false;
  }

  think() {
    const s = this.s;
    switch (this.state) {
      case 'DORMANT':
        this.anim = 'dormant';
        if (s.t >= this.activationTick && this.aggression > 0) {
          this.timer = 40;
          this.intoWalls('activation: he crawls into the walls');
        }
        return;
      case 'WALLS':
        this.hidden = true;
        if (--this.timer > 0) return;
        this.comeOut();
        return;
      case 'CRAWL':
        return this.thinkCrawl();
      case 'APPROACH':
        if (!this.move) {
          s.director.releaseEntry(this.id);
          this.setState('CRAWL', 'approach blocked');
        }
        return;
      case 'TELEGRAPH':
        return this.thinkTelegraph();
      case 'SUSPENDED':
        this.anim = 'dormant';
        return;
      case 'RECOVER': // after a maintenance pause: back into the walls
        this.intoWalls('maintenance over', 200);
        return;
      default:
    }
  }

  // ------------------------------------------------------------ walls
  intoWalls(reason, cooldown = this.timer) {
    const s = this.s;
    s.director.releaseEntry(this.id);
    this.entry = null;
    if (this.move) {
      s.occupancy.release(this.move.to, this.id);
      this.move = null;
    }
    this.path = [];
    s.occupancy.release(this.node, this.id);
    this.node = this.cfg.home;
    s.occupancy.force(this.node, this.id);
    this.hidden = true;
    this.eyes = false;
    this.anim = 'crawl';
    this.timer = cooldown;
    this.route = null;
    this.setState('WALLS', reason);
  }

  chooseRoute() {
    const s = this.s;
    const routes = ['L', 'H'].filter((r) => r !== 'H' || s.hatchInstalled);
    const d = s.director.doorUse;
    const w = routes.map((r) => (1 + (10 - d[r]) / 5) * (r === this.memory.lastEntry ? 0.6 : 1));
    return s.rng.weighted(routes, w);
  }

  comeOut() {
    const s = this.s;
    const r = this.chooseRoute();
    const start = MORGRAVE_ROUTE[r][0];
    if (!s.occupancy.claim(start, this.id)) {
      this.timer = 40; // someone is standing there: try again shortly
      return;
    }
    s.occupancy.release(this.node, this.id);
    this.node = start;
    this.route = r;
    this.target = r;
    this.hidden = false;
    this.eyes = true;
    this.sealedTicks = 0;
    this.yaw = NODE_BY_ID[start].yaw ?? this.yaw;
    this.anim = NODE_BY_ID[start].crawl ? 'crawl' : 'look';
    this.moTimer = s.rng.jitter(this.cfg.moInterval);
    this.setState('CRAWL', `out of the walls: ${ROUTE_NAME[r]}`);
    s.emit({ fx: 'sound', id: 'fb.morgrave.scrape', at: SCRAPE_AT[r], vol: 1.0 });
    s.caption(`Scraping inside the walls — ${ROUTE_NAME[r]}`, this.id);
  }

  // ------------------------------------------------------------ crawling
  thinkCrawl() {
    const s = this.s;
    const route = MORGRAVE_ROUTE[this.route];
    const i = route.indexOf(this.node);
    const next = route[i + 1];
    if (!next) return this.intoWalls('lost his route', 200);
    const edge = this.graph.edgeBetween(this.node, next);
    if (edge?.gate && !s.gateOpen(edge.gate)) {
      // Sealed in front of him: he scratches at the seal, then gives up.
      if (++this.sealedTicks % 40 === 1) s.emit({ fx: 'sound', id: 'fb.vent.clank', at: this.pose(), vol: 0.9 });
      this.anim = 'look';
      if (this.sealedTicks >= this.cfg.sealGiveUp) {
        this.memory.repelled[this.route] = Math.min(5, this.memory.repelled[this.route] + 1);
        this.memory.lastEntry = this.route;
        this.intoWalls(`sealed out of ${ROUTE_NAME[this.route]}`, this.cfg.recover(this.aggression));
        s.caption('Something gave up inside the vents', this.id);
      }
      return;
    }
    this.sealedTicks = 0;
    if (--this.moTimer > 0) return;
    this.moTimer = s.rng.jitter(this.cfg.moInterval);
    if (!s.rng.d20(this.aggression)) return;
    if (next === ENTRY_NODE[this.route]) {
      if (!s.director.reserveEntry(this.id, this.route)) return;
      if (!this.beginEdgeMove(next, 'stalk')) {
        s.director.releaseEntry(this.id);
        return;
      }
      this.entry = this.route;
      this.viaVent = this.route === 'L';
      this.setState('APPROACH', this.route === 'L' ? 'climbing out of the vent' : 'climbing up under the hatch');
      const p = this.pose();
      s.emit({ fx: 'sound', id: 'fb.vent.clank', at: { x: p.x, y: p.y + 0.5, z: p.z }, vol: 1.0 });
      s.caption(this.route === 'L' ? 'Something is climbing out of the vent — LEFT corner' : 'Scraping beneath the office floor', this.id);
      return;
    }
    if (this.beginEdgeMove(next, 'stalk')) {
      const p = this.pose();
      s.emit({ fx: 'sound', id: 'fb.vent.clank', at: { x: p.x, y: p.y + 0.5, z: p.z }, vol: 0.8 });
    }
  }

  onArrive(node) {
    const n = NODE_BY_ID[node];
    if (this.state === 'APPROACH' && n.zone === 'entry') this.startTelegraph();
    else this.anim = n.crawl ? 'crawl' : 'look';
  }

  // ------------------------------------------------------------ telegraph
  startTelegraph() {
    const s = this.s;
    this.timer = this.cfg.telegraph(this.aggression);
    this.closedTicks = 0;
    this.anim = 'threat';
    this.eyes = true;
    this.setState('TELEGRAPH', `at entry ${this.entry}, window ${this.timer}t`);
    // A scratch at the entry itself - not every time (the climb up the shaft is long and quiet):
    // watch CAM 17 / CAM 18 and remember where you last heard him.
    if (s.rng.chance(this.cfg.arrivalCueChance)) {
      const p = this.pose();
      s.emit({ fx: 'sound', id: 'fb.morgrave.scrape', at: { x: p.x, y: p.y + 1, z: p.z }, vol: 0.8 });
      s.caption(this.entry === 'H' ? 'Scratching at the HATCH' : 'Scratching at the LEFT door', this.id);
    }
  }

  thinkTelegraph() {
    const s = this.s;
    const closed = s.barrierClosed(this.entry);
    this.closedTicks = closed ? this.closedTicks + 1 : 0;
    if (this.closedTicks >= this.cfg.repelTicks) return this.repelled('barrier held closed');
    if (s.blackout.stage === 'on') return; // window paused for fairness
    if (--this.timer > 0) return;
    if (closed) return this.repelled('barrier closed at end of window');
    if (s.director.requestAttack(this.id)) {
      this.anim = 'attack';
      this.setState('ATTACK', 'barrier open at end of window');
      s.beginJumpscare(this.id);
    }
  }

  repelled(reason) {
    const s = this.s;
    const entry = this.entry;
    this.memory.repelled[entry] = Math.min(5, this.memory.repelled[entry] + 1);
    this.memory.lastEntry = entry;
    s.emit({ fx: 'sound', id: 'fb.door.bang', at: { x: this.pose().x, y: 1, z: this.pose().z }, vol: 0.8 });
    s.caption('Scraping fades back into the walls', this.id);
    this.intoWalls(reason, this.cfg.recover(this.aggression));
  }
}
