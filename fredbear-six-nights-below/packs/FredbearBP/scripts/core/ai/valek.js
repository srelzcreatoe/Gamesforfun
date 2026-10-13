// VALEK - the gray bear in the dark: a staring contest (nights 8 and 9, 1.4).
//
// The gray bear nobody remembers ordering; he was found in Parts & Service the week the 1987 guard
// went missing. On the hunt only his two small eyes show (fb:variant 1 hides the body). They appear
// in the dark at the LEFT door, the RIGHT door or the CEILING VENT (data/visitors.js VALEK_SPOTS):
// through the window beside each door, or through the vent grate overhead. Doors and the grate do
// not stop him; the only thing that does is looking straight back at him.
//
// STATES
//   DORMANT  standing in the black corner of the workshop (V_HOME, CAM 21) until activation.
//   VANISH   gone (cooldown), then his eyes appear at an entry (a hum, captioned).
//   STARE    the contest, at stage `far`, then `near`:
//              * start looking at his eyes within find(A) (near: findNear(A)) ticks, and keep
//                looking: after a random hold(A) (3 s up to 5 + A/4 s) HE looks away first -> LEAVE;
//              * never look, or look away for more than `slack` ticks (near: `slackNear`) once you
//                started, or open the cameras -> he steps closer (far -> near), or attacks from `near`.
//   LEAVE    he slowly turns his head away, then he is gone (VANISH, recover).
//
// The gaze comes from the adapter (mc/game.js: the player's view direction against his eye
// point) or from a test bot, through NightSession.view.gaze. His head follows the player while he
// stares (mc/game.js valekLooks). He never appears while Fredbear is engaged, during a blackout, in
// a grace period or in the finale.

import { Animatronic } from './base.js';
import { VALEK_SPOTS, VALEK_EYE, VISIT_ENTRIES, VISIT_LABEL } from '../../data/visitors.js';

export class Valek extends Animatronic {
  constructor(session) {
    super(session, 'valek');
  }

  reset() {
    super.reset();
    this.anim = 'dormant';
    this.visit = null;
    this.ghost = false; // eyes only
    this.forced = null; // debug: the entry of the next visit
  }

  /** Where his eyes are right now (null when they are not out). */
  eyePoint() {
    const v = this.visit;
    return v ? VALEK_SPOTS[v.entry][v.stage].eye : null;
  }

  pose() {
    const v = this.visit;
    if (!v) return { ...super.pose(), hidden: this.hidden, variant: this.ghost ? 1 : 0 };
    const sp = VALEK_SPOTS[v.entry][v.stage];
    return {
      x: sp.eye.x, y: sp.eye.y - VALEK_EYE, z: sp.eye.z, yaw: sp.yaw,
      anim: this.state === 'ATTACK' ? 'attack' : 'idle', eyes: true, hidden: false, variant: this.ghost ? 1 : 0,
      staring: this.state === 'STARE', turningAway: this.state === 'LEAVE',
    };
  }

  think() {
    const s = this.s;
    switch (this.state) {
      case 'DORMANT':
        this.anim = 'dormant';
        if (s.t >= this.activationTick && this.aggression > 0) this.vanish('activation: he is gone from the workshop', 20);
        return;
      case 'VANISH':
        if (--this.timer > 0) return;
        this.appear();
        return;
      case 'STARE':
        return this.thinkStare();
      case 'LEAVE':
        if (--this.timer <= 0) this.vanish('he looked away first', this.cfg.recover(this.aggression));
        return;
      case 'SUSPENDED':
        this.anim = 'dormant';
        return;
      case 'RECOVER': // after a maintenance pause: gone, then back in the dark
        this.vanish('maintenance over', 200);
        return;
      default:
    }
  }

  vanish(reason, ticks) {
    this.visit = null;
    this.entry = null;
    this.hidden = true;
    this.eyes = false;
    this.ghost = true;
    this.timer = ticks;
    this.setState('VANISH', reason);
  }

  mayAppear() {
    const s = this.s;
    const d = s.director;
    return s.phase === 'RUNNING' && s.t >= d.graceUntil && s.blackout.stage === 'none' && !d.fredbearEngaged() && !s.finale;
  }

  appear() {
    const s = this.s;
    if (!this.mayAppear()) {
      this.timer = 40;
      return;
    }
    const w = VISIT_ENTRIES.map((e) => (e === this.memory.lastEntry ? 0.5 : 1));
    const entry = this.forced ?? s.rng.weighted([...VISIT_ENTRIES], w);
    this.forced = null;
    this.memory.lastEntry = entry;
    this.entry = entry;
    this.hidden = false;
    this.eyes = true;
    this.ghost = true;
    this.anim = 'idle';
    this.startStage('far', `eyes in the dark at the ${VISIT_LABEL[entry]}`);
    s.caption(`Two small eyes in the dark — ${VISIT_LABEL[entry]}`, this.id);
  }

  startStage(stage, reason) {
    const s = this.s;
    const entry = this.entry;
    const [lo, hi] = this.cfg.hold(this.aggression);
    this.visit = { entry, stage, gaze: 0, away: 0, started: false, need: s.rng.int(lo, hi) };
    this.timer = stage === 'far' ? this.cfg.find(this.aggression) : this.cfg.findNear(this.aggression);
    if (this.state === 'STARE') s.logTransition(this.id, 'STARE', 'STARE', `${reason}, ${this.timer}t to look`);
    else this.setState('STARE', `${reason}, ${this.timer}t to look`);
    s.emit({ fx: 'sound', id: 'fb.valek.hum', at: this.eyePoint(), vol: stage === 'far' ? 0.6 : 0.9 });
  }

  /** The player is staring straight at his eyes (and not at the cameras). */
  watched() {
    const s = this.s;
    return s.view.gaze === this.id && !s.devices.cams.open;
  }

  thinkStare() {
    const v = this.visit;
    if (this.watched()) {
      v.started = true;
      v.away = 0;
      if (++v.gaze >= v.need) this.lookAway();
      return;
    }
    if (v.started) {
      const slack = v.stage === 'far' ? this.cfg.slack : this.cfg.slackNear;
      if (++v.away > slack || this.s.devices.cams.open) this.stepCloser('you looked away');
      return;
    }
    if (--this.timer <= 0) this.stepCloser('you never looked at him');
  }

  stepCloser(reason) {
    const s = this.s;
    if (this.visit.stage === 'far') {
      this.startStage('near', `${reason}: he stepped closer`);
      s.caption(`The eyes are closer — ${VISIT_LABEL[this.entry]}`, this.id);
      return;
    }
    if (!s.director.requestAttack(this.id)) return;
    this.ghost = false;
    this.anim = 'attack';
    this.setState('ATTACK', `${reason} from up close`);
    s.beginJumpscare(this.id);
  }

  lookAway() {
    const s = this.s;
    this.timer = this.cfg.turnAway;
    this.setState('LEAVE', `stared down after ${this.visit.gaze}t`);
    s.emit({ fx: 'sound', id: 'fb.valek.vanish', at: this.eyePoint(), vol: 0.8 });
    s.caption('He looks away first…', this.id);
  }

  repelled(reason) {
    this.vanish(reason, this.cfg.recover(this.aggression));
  }
}
