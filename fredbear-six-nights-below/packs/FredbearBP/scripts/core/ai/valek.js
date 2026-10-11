// VALEK - the gray bear in the dark (nights 8 and 9).
//
// The gray bear nobody remembers ordering; he was found in Parts & Service the
// week the 1987 guard went missing. He never walks. He steps from one dark
// spot to the next along one hall (VALEK_LADDER: far room -> hall north ->
// middle -> south -> the door corner), only while the spot he stands on is not
// on the camera you are watching, and silently. On the hunt only his two small
// eyes show (fb:variant 1 hides the body).
//
// STATES
//   DORMANT  standing in Parts & Service (V_HOME) until activation.
//   STEP     on a ladder rung; each movement opportunity (d20 <= A every
//            moInterval) while unwatched moves him one rung closer.
//   CORNER   at the door corner. Window max(60, 160 - 4A - 20 x anger):
//              * the hall light on his corner: he VANISHES at once - but his
//                anger rises (max 2) and he comes back that many rungs closer;
//              * the door closed for repelTicks: he backs off to the far rung,
//                calmer (anger -1);
//              * neither by the end of the window: ATTACK.
//   VANISH   gone for a moment (cooldown), then back on a ladder.
//
// MIMICRY: half of his steps play another animatronic's sound on the OTHER
// side of the building, captioned as that animatronic (a lie by design).
// His one honest cue: a faint hum (captioned) when he reaches a corner.

import { Animatronic } from './base.js';
import { NODE_BY_ID, VALEK_LADDER } from '../../data/nodes.js';

const SIDE_NAME = Object.freeze({ L: 'LEFT', R: 'RIGHT' });
// [sound id, caption, side the sound is placed on: 'same' | 'other']
const MIMICS = Object.freeze([
  ['fb.freddy.laugh', 'Deep laughter — {side} side'],
  ['fb.step.bonnie', 'Footsteps — {side} side'],
  ['fb.step.chica', 'Footsteps — {side} side'],
  ['fb.bonnie.groan', 'A low groan — {side} side'],
]);
const MIMIC_AT = Object.freeze({ L: { x: 87.5, y: 1, z: 112.5 }, R: { x: 113.5, y: 1, z: 112.5 } });

export class Valek extends Animatronic {
  constructor(session) {
    super(session, 'valek');
  }

  reset() {
    super.reset();
    this.anim = 'dormant';
    this.anger = 0;
    this.side = 'L';
    this.ghost = false; // eyes only
  }

  pose() {
    return { ...super.pose(), variant: this.ghost ? 1 : 0 };
  }

  think() {
    const s = this.s;
    switch (this.state) {
      case 'DORMANT':
        this.anim = 'dormant';
        if (s.t >= this.activationTick && this.aggression > 0) {
          this.timer = 20;
          this.setState('VANISH', 'activation: he is gone from Parts & Service');
          this.vanishFrom(this.node);
        }
        return;
      case 'VANISH':
        if (--this.timer > 0) return;
        this.reappear();
        return;
      case 'STEP':
        return this.thinkStep();
      case 'CORNER':
        return this.thinkCorner();
      case 'SUSPENDED':
        this.anim = 'dormant';
        return;
      case 'RECOVER': // after a maintenance pause: gone, then back in the dark
        this.leave('maintenance over', 200);
        return;
      default:
    }
  }

  // ------------------------------------------------------------ ladder
  vanishFrom(node) {
    const s = this.s;
    s.occupancy.release(node, this.id);
    this.hidden = true;
    this.eyes = false;
    this.ghost = true;
  }

  chooseSide() {
    const s = this.s;
    const d = s.director.doorUse;
    // Prefers the side whose door you lean on least, and changes sides more when angry.
    const w = ['L', 'R'].map((e) => (1 + (10 - d[e]) / 5) * (e === this.side ? 1 : 1 + this.anger * 0.5));
    return s.rng.weighted(['L', 'R'], w);
  }

  reappear() {
    const s = this.s;
    this.side = this.chooseSide();
    const ladder = VALEK_LADDER[this.side];
    const rung = Math.min(this.anger, ladder.length - 2);
    // Closest free rung at or below the anger rung (never the corner itself).
    let at = -1;
    for (let r = rung; r >= 0; r--) {
      if (!s.occupancy.isTaken(ladder[r], this.id)) {
        at = r;
        break;
      }
    }
    if (at < 0) {
      this.timer = 40;
      return;
    }
    this.node = ladder[at];
    s.occupancy.force(this.node, this.id);
    this.hidden = false;
    this.eyes = true;
    this.ghost = true;
    this.anim = 'idle';
    this.yaw = NODE_BY_ID[this.node].yaw ?? this.yaw;
    this.moTimer = s.rng.jitter(this.cfg.moInterval);
    this.setState('STEP', `back in the dark: ${SIDE_NAME[this.side]} hall rung ${at}`);
  }

  thinkStep() {
    const s = this.s;
    if (--this.moTimer > 0) return;
    this.moTimer = s.rng.jitter(this.cfg.moInterval);
    if (this.isObserved()) return; // never moves while you watch his spot
    if (!s.rng.d20(this.aggression)) return;
    const ladder = VALEK_LADDER[this.side];
    const i = ladder.indexOf(this.node);
    const next = ladder[i + 1];
    if (!next) return;
    const corner = i + 1 === ladder.length - 1;
    if (corner && !s.director.reserveEntry(this.id, this.side)) return;
    if (!s.occupancy.claim(next, this.id)) {
      if (corner) s.director.releaseEntry(this.id);
      return;
    }
    s.occupancy.release(this.node, this.id);
    this.prevNode = this.node;
    this.node = next;
    this.yaw = NODE_BY_ID[next].yaw ?? this.yaw;
    this.mimic();
    if (corner) {
      this.entry = this.side;
      this.timer = Math.max(this.cfg.minWindow, this.cfg.telegraph(this.aggression) - 20 * this.anger);
      this.closedTicks = 0;
      this.anim = 'threat';
      this.setState('CORNER', `in the ${SIDE_NAME[this.side]} corner, window ${this.timer}t, anger ${this.anger}`);
      // His only honest sound, and not every time: a faint electrical hum where he stands.
      // (His two small eyes in the dark corner are always visible through the window.)
      if (s.rng.chance(this.cfg.humChance)) {
        const n = NODE_BY_ID[next];
        s.emit({ fx: 'sound', id: 'fb.valek.hum', at: { x: n.x, y: n.y + 1.5, z: n.z }, vol: 0.6 });
        s.caption(`A faint hum — ${SIDE_NAME[this.side]} corner`, this.id);
      }
    } else {
      this.s.logTransition(this.id, 'STEP', 'STEP', `stepped to ${next}`);
    }
  }

  /** Half of his steps: another animatronic's sound on the other side, captioned as theirs. */
  mimic() {
    const s = this.s;
    if (!s.rng.chance(this.cfg.mimicChance)) return;
    const [id, text] = s.rng.pick(MIMICS);
    const other = this.side === 'L' ? 'R' : 'L';
    s.emit({ fx: 'sound', id, at: MIMIC_AT[other], vol: 0.9, mimic: true });
    s.caption(text.replace('{side}', other === 'L' ? 'west' : 'east'), this.id);
  }

  // ------------------------------------------------------------ corner
  lit() {
    return this.entry === 'L' ? this.s.devices.lightL : this.s.devices.lightR;
  }

  thinkCorner() {
    const s = this.s;
    if (this.lit()) {
      this.anger = Math.min(2, this.anger + 1);
      s.emit({ fx: 'sound', id: 'fb.valek.vanish', at: this.pose(), vol: 0.9 });
      s.caption(`The eyes in the ${SIDE_NAME[this.entry]} corner are gone… for now`, this.id);
      this.leave(`lit: vanished (anger ${this.anger})`, this.cfg.vanishTicks);
      return;
    }
    const closed = s.barrierClosed(this.entry);
    this.closedTicks = closed ? this.closedTicks + 1 : 0;
    if (this.closedTicks >= this.cfg.repelTicks) {
      this.anger = Math.max(0, this.anger - 1);
      this.leave('door held closed: backed off', this.cfg.recover(this.aggression));
      return;
    }
    if (s.blackout.stage === 'on') return; // window paused for fairness
    if (--this.timer > 0) return;
    if (closed) {
      this.leave('door closed at the end of the window', this.cfg.recover(this.aggression));
      return;
    }
    if (s.director.requestAttack(this.id)) {
      this.ghost = false;
      this.anim = 'attack';
      this.setState('ATTACK', 'the corner was left dark and open');
      s.beginJumpscare(this.id);
    }
  }

  repelled(reason) {
    this.leave(reason, this.cfg.recover(this.aggression));
  }

  leave(reason, ticks) {
    const s = this.s;
    s.director.releaseEntry(this.id);
    this.memory.lastEntry = this.entry;
    this.entry = null;
    this.vanishFrom(this.node);
    this.timer = ticks;
    this.setState('VANISH', reason);
  }
}
