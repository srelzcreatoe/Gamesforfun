// Shared logic for the window-based door attackers (Bonnie and Chica).
//
// TELEGRAPH rule: the animatronic stands at its entry for T ticks
// (T = character telegraph(aggression)). If the entry's barrier stays closed
// for repelTicks at any point, or is closed when T expires, it RETREATs.
// If the barrier is open when T expires it requests the single attack token
// and ATTACKs. The window pauses during a Fredbear blackout.
//
// DOUBLE TROUBLE: from aggression 8 a second door attacker may join one that is
// already telegraphing at the same door (its own corner spot, PARTNER_NODE).
// While two stand there, the barrier must stay closed twice as long
// (2 x repelTicks) before they back off, and a barrier closed when a window
// ends no longer sends them away early.
//
// NEVER IDLE AT A DOOR: outside APPROACH / TELEGRAPH / ATTACK a door attacker
// standing on an entry node leaves at once, and retreats walk past anyone in
// the hall (Animatronic.beginEdgeMove pass) - see docs/04 "Stuck at the door".

import { Animatronic } from './base.js';
import { NODE_BY_ID, ENTRY_NODE, PARTNER_NODE } from '../../data/nodes.js';

const AT_DOOR_OK = Object.freeze(['APPROACH', 'TELEGRAPH', 'ATTACK', 'RETREAT', 'WITHDRAWN', 'SUSPENDED', 'POWEROUT']);

export class DoorAttacker extends Animatronic {
  reset() {
    super.reset();
    this.forceNextMove = false;
    this.closedTicks = 0;
    this.holdTicks = 0;
    this.investigateLeft = 0;
    this.partner = false;
    this.quiet = false;
  }

  think() {
    const s = this.s;
    if (this.idleAtEntry(AT_DOOR_OK)) {
      this.leaveEntry(`${this.state.toLowerCase()} at a door: leaving`);
      return;
    }
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
          if (path && path.length > 1) this.followPath(path.slice(1), 'walk', { pass: true });
        }
        return;
      default:
    }
  }

  /** Off an entry node right away (no repel memory, no sound). */
  leaveEntry(reason) {
    this.s.director.releaseEntry(this.id);
    this.entry = null;
    this.partner = false;
    this.setState('RETREAT', reason);
    this.startRetreat();
  }

  emitStep() {
    if (!this.quiet) super.emitStep();
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
    // Right behind a door someone else is already at: try to join them (double trouble), once a second.
    if (s.t % 20 === 0 && PARTNER_NODE[this.target] && this.graph.edgeBetween(this.node, PARTNER_NODE[this.target]) && this.wantsEntry() && this.tryPartner()) return;
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
      if (!this.tryApproach()) this.tryPartner();
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

  /** Double trouble: join another door attacker already telegraphing at the target door. */
  tryPartner() {
    const s = this.s;
    const entry = this.target;
    const spot = PARTNER_NODE[entry];
    if (!spot || this.aggression < (this.cfg.partnerMinAI ?? 99)) return false;
    const holder = s.director.entries[entry];
    // The holder may be Bonnie or Chica telegraphing, or Freddy lurking in the right corner.
    if (!holder || holder === this.id || !['bonnie', 'chica', 'freddy'].includes(holder) || !['TELEGRAPH', 'LURK'].includes(s.anim[holder].state)) return false;
    if (!this.graph.edgeBetween(this.node, spot) || !s.rng.chance(0.35)) return false;
    if (!s.director.reservePartner(this.id, entry)) return false;
    if (!this.beginEdgeMove(spot, 'stalk')) {
      s.director.releaseEntry(this.id);
      return false;
    }
    this.entry = entry;
    this.partner = true;
    this.setState('APPROACH', `joining ${holder} at entry ${entry}`);
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
    const pair = s.director.pairAt(this.entry);
    this.closedTicks = closed ? this.closedTicks + 1 : 0;
    if (this.closedTicks >= this.cfg.repelTicks * (pair ? 2 : 1)) {
      this.repelled(pair ? 'barrier held closed against two' : 'barrier held closed');
      return;
    }
    if (s.blackout.stage === 'on') return; // window paused for fairness
    if (this.banging && this.stateTicks % 25 === 0) {
      const p = this.pose();
      s.emit({ fx: 'sound', id: 'fb.door.bang', at: { x: p.x, y: 1.5, z: p.z }, vol: 1.0 });
    }
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    if (closed) {
      if (!pair) this.repelled('barrier closed at end of window');
      return; // two at the door: they only leave once it has held for the full double time
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
    this.partner = false;
    this.banging = false;
    this.setState('RETREAT', reason);
    this.startRetreat();
  }

  startRetreat() {
    const s = this.s;
    const candidates = this.cfg.retreatNodes.filter((n) => !s.occupancy.isTaken(n, this.id) && n !== this.node);
    const dest = s.rng.pick(candidates.length ? candidates : this.cfg.retreatNodes);
    const path = this.graph.path(this.node, dest);
    this.anim = 'retreat';
    // pass: walk past anyone waiting in the hall instead of freezing at the door.
    if (!path || path.length < 2 || !this.followPath(path.slice(1), 'retreat', { pass: true })) this.beginRecover('no retreat path');
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
    this.partner = false;
    this.banging = false;
    this.eyes = false;
    this.path = [];
    this.setState('WITHDRAWN', 'finale: withdrawing to the stage');
    // think() walks the shortest path home once any current edge is finished.
  }
}
