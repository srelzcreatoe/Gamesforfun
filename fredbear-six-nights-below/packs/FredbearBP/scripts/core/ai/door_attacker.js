// Shared logic for the window-based door attackers (Bonnie and Chica).
//
// TELEGRAPH rule: the animatronic stands at its entry for T ticks
// (T = character telegraph(aggression)). If the entry's barrier stays closed
// for repelTicks at any point, or is closed when T expires, it RETREATs.
// If the barrier is open when T expires it requests the single attack token
// and ATTACKs. The window pauses during a Fredbear blackout.

import { Animatronic } from './base.js';
import { NODE_BY_ID, ENTRY_NODE } from '../../data/nodes.js';

export class DoorAttacker extends Animatronic {
  reset() {
    super.reset();
    this.forceNextMove = false;
    this.closedTicks = 0;
    this.holdTicks = 0;
    this.investigateLeft = 0;
  }

  think() {
    const s = this.s;
    switch (this.state) {
      case 'DORMANT':
        this.anim = this.activationTick >= 99999 ? 'dormant' : 'perform'; // powered down for the whole night (night 7)
        if (s.t >= this.activationTick && this.aggression > 0) {
          this.chooseTarget();
          this.setState('PATROL', 'activation time reached');
        }
        return;
      case 'PATROL':
      case 'STALK':
        return this.thinkRoam();
      case 'INVESTIGATE':
        return this.thinkInvestigate();
      case 'APPROACH':
        // Arrival handled in onArrive; if we are idle here the move was blocked.
        if (!this.move) {
          s.director.releaseEntry(this.id);
          this.setState('STALK', 'approach blocked');
        }
        return;
      case 'TELEGRAPH':
        return this.thinkTelegraph();
      case 'RETREAT':
        if (!this.move && !(this.path.length && this.advancePath())) this.beginRecover('retreat path ended');
        return;
      case 'RECOVER':
        this.anim = 'look';
        if (--this.timer <= 0) {
          this.chooseTarget();
          this.setState('PATROL', 'recovered');
        }
        return;
      case 'SUSPENDED':
        this.anim = 'dormant';
        return;
      case 'WITHDRAWN':
        if (this.node === this.cfg.home) {
          this.anim = 'perform';
          return;
        }
        if (!(this.path.length && this.advancePath())) {
          const path = this.graph.path(this.node, this.cfg.home);
          if (path && path.length > 1) this.followPath(path.slice(1), 'walk');
        }
        return;
      default:
    }
  }

  // ------------------------------------------------------------ roaming
  goalNode() {
    return ENTRY_NODE[this.target];
  }

  thinkRoam() {
    const s = this.s;
    if (this.watchedTicks >= (this.cfg.agitateTicks ?? Infinity)) {
      this.forceNextMove = true;
      this.watchedTicks = 0;
    }
    if (this.extraRoam()) return; // character-specific activity consumed this tick
    if (--this.moTimer > 0) return;
    this.moTimer = s.rng.jitter(this.cfg.moInterval);
    const a = this.aggression;
    const success = this.forceNextMove || s.rng.d20(a);
    this.forceNextMove = false;
    if (!success) {
      if (s.rng.chance(0.3)) this.anim = 'look';
      return;
    }
    const zone = NODE_BY_ID[this.node].zone;
    const heat = s.director.noiseHeat;
    if (zone !== 'near' && heat >= 4 && s.rng.chance(Math.min(0.4, heat / 25))) {
      this.startInvestigate();
      return;
    }
    const entryNode = ENTRY_NODE[this.target];
    if (this.graph.edgeBetween(this.node, entryNode) && this.wantsEntry()) {
      this.tryApproach();
      return;
    }
    const next = this.chooseStep(this.goalNode(), { weight: (o, n) => this.stepWeight(o, n) });
    if (!next) return;
    const nz = NODE_BY_ID[next].zone;
    this.beginEdgeMove(next, nz === 'near' ? 'stalk' : 'walk');
  }

  wantsEntry() {
    return true;
  }

  /** @param {any} _option @param {any} _node */
  stepWeight(_option, _node) {
    return 1;
  }

  tryApproach() {
    const s = this.s;
    const entry = this.target;
    const entryNode = ENTRY_NODE[entry];
    if (!s.director.reserveEntry(this.id, entry)) {
      this.anim = 'look';
      return false;
    }
    if (!this.beginEdgeMove(entryNode, 'stalk')) {
      s.director.releaseEntry(this.id);
      return false;
    }
    this.entry = entry;
    this.onApproachStart();
    this.setState('APPROACH', `moving into entry ${entry}`);
    return true;
  }

  startInvestigate() {
    const side = this.target === 'R' ? 'EH_M' : 'WH_M';
    const path = this.graph.path(this.node, side);
    if (!path || path.length < 2) return;
    this.investigateLeft = Math.min(2, path.length - 1);
    this.setState('INVESTIGATE', `noise heat ${this.s.director.noiseHeat}`);
    this.s.director.noiseHeat = Math.max(0, this.s.director.noiseHeat - 3);
    this.beginEdgeMove(path[1], 'walk');
  }

  thinkInvestigate() {
    if (this.timer > 0) {
      this.timer--;
      this.anim = 'pause';
      return;
    }
    if (this.investigateLeft <= 0) {
      this.setState(NODE_BY_ID[this.node].zone === 'near' ? 'STALK' : 'PATROL', 'investigation finished');
      return;
    }
    const side = this.target === 'R' ? 'EH_M' : 'WH_M';
    const path = this.graph.path(this.node, side);
    if (!path || path.length < 2 || !this.beginEdgeMove(path[1], 'walk')) {
      this.setState('PATROL', 'investigation blocked');
    }
  }

  onArrive(node) {
    const n = NODE_BY_ID[node];
    switch (this.state) {
      case 'APPROACH':
        if (n.zone === 'entry') this.startTelegraph();
        return;
      case 'RETREAT':
        if (!this.path.length) this.beginRecover('reached retreat node');
        return;
      case 'INVESTIGATE':
        this.investigateLeft--;
        this.timer = 30;
        return;
      case 'WITHDRAWN':
        this.anim = 'perform';
        return;
      default:
        this.setState(n.zone === 'near' ? 'STALK' : 'PATROL', `arrived ${node}`);
        this.onReachNode(node);
    }
  }

  // ------------------------------------------------------------ telegraph
  startTelegraph() {
    this.timer = this.cfg.telegraph(this.aggression);
    this.closedTicks = 0;
    this.holdTicks = 0;
    this.anim = 'threat';
    this.setState('TELEGRAPH', `at entry ${this.entry}, window ${this.timer}t`);
    this.onTelegraphStart();
  }

  thinkTelegraph() {
    const s = this.s;
    const closed = s.barrierClosed(this.entry);
    this.closedTicks = closed ? this.closedTicks + 1 : 0;
    if (this.closedTicks >= this.cfg.repelTicks) {
      this.repelled('barrier held closed');
      return;
    }
    if (s.blackout.stage === 'on') return; // window paused for fairness
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    if (closed) {
      this.repelled('barrier closed at end of window');
      return;
    }
    if (s.director.requestAttack(this.id)) {
      this.anim = 'attack';
      this.setState('ATTACK', 'barrier open at end of window');
      s.beginJumpscare(this.id);
    } else if (++this.holdTicks > this.cfg.holdMax) {
      this.repelled('another attack has priority');
    }
  }

  repelled(reason) {
    const s = this.s;
    const entry = this.entry;
    if (entry) this.memory.repelled[entry] = Math.min(5, this.memory.repelled[entry] + 1);
    this.memory.lastEntry = entry;
    s.emit({ fx: 'sound', id: 'fb.door.bang', at: { x: this.pose().x, y: 1, z: this.pose().z }, vol: 0.8 });
    s.director.releaseEntry(this.id);
    this.entry = null;
    this.setState('RETREAT', reason);
    this.startRetreat();
  }

  startRetreat() {
    const s = this.s;
    const candidates = this.cfg.retreatNodes.filter((n) => !s.occupancy.isTaken(n, this.id) && n !== this.node);
    const dest = s.rng.pick(candidates.length ? candidates : this.cfg.retreatNodes);
    const path = this.graph.path(this.node, dest);
    this.anim = 'retreat';
    if (!path || path.length < 2 || !this.followPath(path.slice(1), 'retreat')) this.beginRecover('no retreat path');
  }

  beginRecover(reason) {
    this.path = [];
    this.timer = this.cfg.recover(this.aggression);
    this.setState('RECOVER', reason);
  }

  chooseTarget() {
    this.target = this.cfg.primary;
  }

  /** Called by the session when the night's finale sends everyone home. */
  withdraw() {
    this.s.director.releaseEntry(this.id);
    this.s.director.releaseAttack(this.id);
    this.entry = null;
    this.eyes = false;
    this.path = [];
    this.setState('WITHDRAWN', 'finale: withdrawing to the stage');
    // think() walks the shortest path home once any current edge is finished.
  }
}
