// MORGRAVE - the rabbit in the walls who only wants to be let in (nights 8 and 9, 1.4).
//
// Walled in with Fredbear below the 1983 diner (Springbonnie was Fredbear's stage partner). He never walks the halls: he comes
// out of the walls at the LEFT door, the RIGHT door or the CEILING VENT above the office
// (data/visitors.js MORGRAVE_SPOTS) and knocks.
//
// STATES
//   DORMANT  slumped in his nest in the workshop (M_HOME, CAM 19) until activation.
//   WALLS    inside the walls (hidden) for a cooldown, then he picks an entry.
//   KNOCK    three soft knocks (captioned). When they end:
//              * that entry is OPEN  -> PASS (he only wanted to be let in);
//              * it is shut          -> ANGRY 1.
//   ANGRY    1: knocking, louder; 2: pounding. Each stage lasts max(70, 150 - 4A) ticks.
//            Open the entry at any point and he passes. Shut through both stages -> ATTACK
//            (he breaks the door or the grate).
//   PASS     walks past the doorway / crawls past over the grate, then back into the walls.
//            He closes the vent grate behind him, so the vent always needs you.
//
// FAIRNESS: while another animatronic is engaged at that same door (holding the entry or beside it
// as a partner), he never breaks through: his timer stays at least holdFloor (3 s), so once they
// leave there is always time to open up. He never starts a visit while Fredbear is engaged, during
// a blackout, in a grace period or in the finale.

import { Animatronic } from './base.js';
import { MORGRAVE_SPOTS, VISIT_ENTRIES, VISIT_LABEL } from '../../data/visitors.js';

const KNOCK_SOUND = Object.freeze(['fb.morgrave.knock_soft', 'fb.morgrave.knock_hard', 'fb.door.bang']);
const KNOCK_EVERY = Object.freeze([0, 20, 12]); // ticks between knocks while angry (stage 1, 2)

export class Morgrave extends Animatronic {
  constructor(session) {
    super(session, 'morgrave');
  }

  /** Silent: no footsteps (his cue is the knocking). */
  emitStep() {}

  reset() {
    super.reset();
    this.anim = 'dormant';
    this.visit = null;
    this.forced = null; // debug: the entry of the next visit
  }

  // ------------------------------------------------------------ pose
  pose() {
    const v = this.visit;
    if (!v) return { ...super.pose(), hidden: this.hidden };
    const sp = MORGRAVE_SPOTS[v.entry];
    if (this.state === 'PASS') {
      const f = 1 - Math.max(0, this.timer) / this.cfg.passTicks;
      const dx = sp.past.x - sp.knock.x;
      const dz = sp.past.z - sp.knock.z;
      return {
        x: sp.knock.x + dx * f, y: sp.knock.y, z: sp.knock.z + dz * f,
        yaw: (Math.atan2(-dx, dz) * 180) / Math.PI, anim: sp.passAnim, eyes: true, hidden: false,
      };
    }
    return { ...sp.knock, anim: this.anim, eyes: this.eyes, hidden: false };
  }

  // ------------------------------------------------------------ think
  think() {
    const s = this.s;
    switch (this.state) {
      case 'DORMANT':
        this.anim = 'dormant';
        if (s.t >= this.activationTick && this.aggression > 0) this.intoWalls('activation: he crawls into the walls', 40);
        return;
      case 'WALLS':
        this.hidden = true;
        if (--this.timer > 0) return;
        this.comeOut();
        return;
      case 'KNOCK':
        return this.thinkKnock();
      case 'ANGRY':
        return this.thinkAngry();
      case 'PASS':
        if (--this.timer <= 0) this.finishPass();
        return;
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
  intoWalls(reason, ticks) {
    this.visit = null;
    this.entry = null;
    this.hidden = true;
    this.eyes = false;
    this.anim = 'crawl';
    this.timer = ticks;
    this.setState('WALLS', reason);
  }

  /** May a visit start now? Same rules every other attacker follows. */
  mayCome() {
    const s = this.s;
    const d = s.director;
    return s.phase === 'RUNNING' && s.t >= d.graceUntil && s.blackout.stage === 'none' && !d.fredbearEngaged() && !s.finale;
  }

  chooseEntry() {
    const s = this.s;
    if (this.forced) {
      const e = this.forced;
      this.forced = null;
      return e;
    }
    const d = s.director;
    const w = VISIT_ENTRIES.map((e) => {
      let x = e === 'V' ? this.cfg.ventWeight : 1 + d.doorUse[e] / 4 + (s.barrierClosed(e) ? this.cfg.shutBonus : 0);
      if (e === this.memory.lastEntry) x *= 0.6;
      return x;
    });
    return s.rng.weighted([...VISIT_ENTRIES], w);
  }

  comeOut() {
    const s = this.s;
    if (!this.mayCome()) {
      this.timer = 40;
      return;
    }
    const entry = this.chooseEntry();
    this.visit = { entry, stage: 0 };
    this.entry = entry;
    this.memory.lastEntry = entry;
    this.hidden = false;
    this.eyes = true;
    this.anim = MORGRAVE_SPOTS[entry].anim;
    this.timer = this.cfg.softKnockTicks;
    this.setState('KNOCK', `three soft knocks at the ${VISIT_LABEL[entry]}`);
    this.knock(0, 0.7);
    s.caption(`Three soft knocks — ${VISIT_LABEL[entry]}`, this.id);
  }

  knockAt() {
    const p = MORGRAVE_SPOTS[this.visit.entry].knock;
    return { x: p.x, y: p.y + 1.2, z: p.z };
  }

  knock(stage, vol) {
    this.s.emit({ fx: 'sound', id: KNOCK_SOUND[stage], at: this.knockAt(), vol });
  }

  // ------------------------------------------------------------ knocking
  thinkKnock() {
    if (--this.timer > 0) return;
    if (!this.s.barrierClosed(this.visit.entry)) this.startPass('the way was open');
    else this.startAngry(1);
  }

  startAngry(stage) {
    const s = this.s;
    const label = VISIT_LABEL[this.visit.entry];
    this.visit.stage = stage;
    this.timer = this.cfg.angry(this.aggression);
    this.anim = this.visit.entry === 'V' ? 'crawl' : 'threat';
    if (this.state === 'ANGRY') s.logTransition(this.id, 'ANGRY', 'ANGRY', `pounding at the ${label}, ${this.timer}t`);
    else this.setState('ANGRY', `knocking at the ${label}, ${this.timer}t`);
    this.knock(stage, stage === 1 ? 1.0 : 1.2);
    s.caption(stage === 1 ? `Knocking — ${label}, louder` : `Pounding — ${label}!`, this.id);
  }

  /** Someone else is engaged at this entry (holding it, or beside it as a partner). */
  othersAtEntry() {
    const d = this.s.director;
    const e = this.visit.entry;
    if (e === 'V') return false;
    return [d.entries[e], d.partners[e]].some((w) => w && w !== this.id);
  }

  thinkAngry() {
    const s = this.s;
    const v = this.visit;
    if (!s.barrierClosed(v.entry)) return this.startPass('let in late');
    if (s.blackout.stage === 'on') return; // window paused for fairness
    if (this.stateTicks % KNOCK_EVERY[v.stage] === 0) this.knock(v.stage, v.stage === 1 ? 0.9 : 1.1);
    if (v.stage === 2 && this.othersAtEntry()) this.timer = Math.max(this.timer, this.cfg.holdFloor);
    if (--this.timer > 0) return;
    if (v.stage === 1) return this.startAngry(2);
    if (!s.director.requestAttack(this.id)) return;
    // He breaks through: the door is forced open, or the grate bursts open.
    if (v.entry === 'V') s.setGrate(false);
    else s.jamBarrier(v.entry);
    this.anim = 'attack';
    this.setState('ATTACK', `the ${VISIT_LABEL[v.entry]} stayed shut: he broke through`);
    s.beginJumpscare(this.id);
  }

  // ------------------------------------------------------------ passing
  startPass(reason) {
    const s = this.s;
    const e = this.visit.entry;
    this.timer = this.cfg.passTicks;
    this.anim = MORGRAVE_SPOTS[e].passAnim;
    this.setState('PASS', reason);
    s.emit({ fx: 'sound', id: 'fb.morgrave.scrape', at: this.knockAt(), vol: 0.5 });
    s.caption(e === 'V' ? 'Something crawls past above the grate' : `Footsteps go past the ${VISIT_LABEL[e]}`, this.id);
  }

  finishPass() {
    const s = this.s;
    if (this.visit.entry === 'V' && !s.devices.grate) {
      s.setGrate(true); // he shuts it behind him
      s.caption('The vent grate clangs shut', this.id);
    }
    this.intoWalls('let in: he went past', this.cfg.recover(this.aggression));
  }

  repelled(reason) {
    this.intoWalls(reason, this.cfg.recover(this.aggression));
  }
}
