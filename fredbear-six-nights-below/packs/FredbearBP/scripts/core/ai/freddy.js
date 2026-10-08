// FREDDY - the patient stalker.
//
// * Never moves while the current camera feed shows him (he even pauses
//   mid-walk). Movement opportunities every 3 s otherwise.
// * Pressure when ignored: for every 30 s the player has not looked at him on
//   camera his effective aggression rises by 1 (max +4). Looking at him halves
//   the accumulated pressure.
// * Route weights favour dark nodes (x1.5), camera blind spots (x1.3) and
//   avoid the nodes of the camera the player watched most recently (x0.5).
// * Laughter cue whenever he advances within ~60 blocks of the office.
// * His telegraph is LURK at the RIGHT door (different from Bonnie/Chica):
//     - right door closed for 5 s -> he retreats;
//     - door open while the player is on cameras (any feed except CAM 13)
//       for 2 s -> he slips into the office and attacks when the monitor
//       goes down (or after 5 more seconds);
//     - door open and player off cameras -> he waits out his patience
//       (max(120, 320 - 10*A) ticks, warning laugh at half) then attacks.
// * Power loss: Freddy owns the power-out sequence (music box at the left
//   door, then darkness, then attack) unless 6 AM arrives first.

import { Animatronic } from './base.js';
import { NODE_BY_ID } from '../../data/nodes.js';
import { CAMERAS } from '../../data/cameras.js';

const COVERED = new Set(CAMERAS.filter((c) => !c.audioOnly).flatMap((c) => c.sees));

export class Freddy extends Animatronic {
  constructor(session) {
    super(session, 'freddy');
  }

  reset() {
    super.reset();
    this.ignoreTicks = 0;
    this.closedTicks = 0;
    this.slip = 0;
    this.slipped = false;
    this.patience = 0;
    this.target = 'R';
  }

  get effectiveAggression() {
    const bonus = Math.min(this.cfg.ignoreBonusMax, Math.floor(this.ignoreTicks / this.cfg.ignoreBonusEvery));
    return Math.min(20, this.aggression + bonus);
  }

  tick() {
    // Observed: freeze, including mid-walk (except retreating/power-out/finale).
    if (this.state !== 'DORMANT' && !['RETREAT', 'POWEROUT', 'WITHDRAWN', 'SUSPENDED'].includes(this.state)) {
      if (this.isObserved()) {
        this.ignoreTicks = Math.floor(this.ignoreTicks / 2);
        this.stateTicks++;
        this.updateWatched();
        if (this.move) this.anim = 'idle';
        if (this.state !== 'LURK') return;
      } else if (this.state !== 'LURK') {
        this.ignoreTicks++;
      }
    }
    super.tick();
  }

  think() {
    const s = this.s;
    switch (this.state) {
      case 'DORMANT':
        this.anim = 'perform';
        if (s.t >= this.activationTick && this.aggression > 0) this.setState('PATROL', 'activation time reached');
        return;
      case 'PATROL':
      case 'STALK':
        return this.thinkRoam();
      case 'APPROACH':
        if (!this.move) {
          s.director.releaseEntry(this.id);
          this.setState('STALK', 'approach blocked');
        }
        return;
      case 'LURK':
        return this.thinkLurk();
      case 'RETREAT':
        if (!this.move && !(this.path.length && this.advancePath())) this.beginRecover('retreat path ended');
        return;
      case 'RECOVER':
        this.anim = 'look';
        if (--this.timer <= 0) this.setState('PATROL', 'recovered');
        return;
      case 'POWEROUT':
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

  thinkRoam() {
    const s = this.s;
    if (--this.moTimer > 0) return;
    this.moTimer = s.rng.jitter(this.cfg.moInterval);
    if (!s.rng.d20(this.effectiveAggression)) return;
    if (this.node === 'EH_S') {
      if (s.director.reserveEntry(this.id, 'R') && this.beginEdgeMove('E_DOOR', 'stalk')) {
        this.entry = 'R';
        this.setState('APPROACH', 'moving into the right-door corner');
        this.laugh();
      } else {
        s.director.releaseEntry(this.id);
      }
      return;
    }
    const focused = new Set(s.director.focusedNodes());
    const noise = s.director.noiseHeat;
    const next = this.chooseStep('E_DOOR', {
      weight: (o, n) => {
        let w = 1;
        if (n.dark) w *= 1.5;
        if (!COVERED.has(o.to)) w *= 1.3;
        if (focused.has(o.to)) w *= 0.5;
        if (noise >= 4 && n.zone === 'near') w *= 1.2;
        return w;
      },
    });
    if (!next) return;
    if (this.beginEdgeMove(next, NODE_BY_ID[next].zone === 'near' ? 'stalk' : 'walk')) {
      if (this.distanceToOffice() < 60) this.laugh();
    }
  }

  laugh() {
    const p = this.pose();
    this.s.emit({ fx: 'sound', id: 'fb.freddy.laugh', at: { x: p.x, y: p.y + 1.5, z: p.z }, vol: 1.0 });
    this.s.caption('Deep laughter — east side', this.id);
  }

  onArrive(node) {
    const n = NODE_BY_ID[node];
    if (this.state === 'APPROACH' && n.zone === 'entry') {
      this.startLurk();
      return;
    }
    if (this.state === 'RETREAT') {
      if (!this.path.length) this.beginRecover('reached retreat node');
      return;
    }
    if (this.state === 'WITHDRAWN') {
      this.anim = 'perform';
      return;
    }
    this.setState(n.zone === 'near' ? 'STALK' : 'PATROL', `arrived ${node}`);
  }

  startLurk() {
    this.closedTicks = 0;
    this.slip = 0;
    this.slipped = false;
    this.patience = 0;
    this.eyes = true;
    this.anim = 'threat';
    this.setState('LURK', 'at the right-door corner');
    this.s.caption('Glowing eyes in the RIGHT corner', this.id);
  }

  thinkLurk() {
    const s = this.s;
    const closed = s.barrierClosed('R');
    if (closed) {
      this.closedTicks++;
      this.slip = 0;
      if (this.closedTicks >= this.cfg.repelTicks) this.repelled('right door held closed');
      return;
    }
    this.closedTicks = 0;
    if (s.blackout.stage === 'on') return;
    const cams = s.devices.cams;
    if (cams.open && cams.cam !== 'C13') this.slip++;
    if (this.slip >= this.cfg.slipTicks && !this.slipped) {
      this.slipped = true;
      this.hidden = true; // he is now inside the office, out of the corner
      s.logTransition(this.id, 'LURK', 'LURK', 'slipped in while the player watched cameras');
    }
    if (this.slipped) {
      if (!cams.open || this.slip >= this.cfg.slipTicks + 100) this.attack('slipped in while on cameras');
      return;
    }
    this.patience++;
    const limit = this.cfg.patience(this.aggression);
    if (this.patience === Math.floor(limit / 2)) this.laugh();
    if (this.patience >= limit) this.attack('patience exhausted with the door open');
  }

  attack(reason) {
    const s = this.s;
    if (s.director.requestAttack(this.id)) {
      this.anim = 'attack';
      this.hidden = false;
      this.setState('ATTACK', reason);
      s.beginJumpscare(this.id);
    }
  }

  repelled(reason) {
    const s = this.s;
    this.memory.repelled.R = Math.min(5, this.memory.repelled.R + 1);
    s.director.releaseEntry(this.id);
    this.entry = null;
    this.eyes = false;
    this.hidden = false;
    this.setState('RETREAT', reason);
    const free = this.cfg.retreatNodes.filter((n) => !s.occupancy.isTaken(n, this.id) && n !== this.node);
    const dest = s.rng.pick(free.length ? free : this.cfg.retreatNodes);
    const path = this.graph.path(this.node, dest);
    if (!path || path.length < 2 || !this.followPath(path.slice(1), 'walk')) this.beginRecover('no retreat path');
  }

  beginRecover(reason) {
    this.path = [];
    this.timer = this.cfg.recover(this.aggression);
    this.setState('RECOVER', reason);
  }

  // ------------------------------------------------------------ power out
  startPowerOut(musicTicks, darkTicks) {
    const s = this.s;
    s.director.releaseEntry(this.id);
    if (this.move) {
      s.occupancy.release(this.move.to, this.id);
      this.move = null;
    }
    this.path = [];
    s.occupancy.release(this.node, this.id);
    // Documented exception: with all power gone, Freddy appears at the left
    // door (no cameras or lights exist to observe the transfer).
    this.node = 'W_DOOR';
    s.occupancy.force('W_DOOR', this.id);
    this.yaw = NODE_BY_ID.W_DOOR.yaw;
    this.eyes = true;
    this.hidden = false;
    this.anim = 'music';
    this.powerOut = { music: musicTicks, dark: darkTicks };
    this.setState('POWEROUT', `music ${musicTicks}t, dark ${darkTicks}t`);
  }

  withdraw() {
    this.s.director.releaseEntry(this.id);
    this.s.director.releaseAttack(this.id);
    this.entry = null;
    this.eyes = false;
    this.hidden = false;
    this.path = [];
    this.setState('WITHDRAWN', 'finale: withdrawing to the stage');
  }
}
