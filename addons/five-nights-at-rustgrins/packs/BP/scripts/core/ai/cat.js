// The Cat dances on the Midway ring (CAM 8) with the Purple Rat. FNAF 1 Foxy rules,
// driven by the troupe's show tape:
//   stage 0 dancing on the ring, 1 stopped and staring at the camera, 2 off the ring
//   at its edge, 3 gone - about to sprint down a hall.
// While the music plays at full speed she keeps dancing. When it slows (tape under 30 %)
// her opportunities advance the stage, but never while the monitor is up and not for a
// random while after it goes down - so checking the cameras holds her. When the music
// stops she steps off the ring at once. Rewinding above 60 % calls her back to the ring
// (before she has run). At stage 3 she sprints down a hall (west, or from night 4
// sometimes east) the moment the guard looks at that hall's camera, or after a while
// anyway. A shut door makes her bang (power drain grows each time) and slink back to
// the ring; an open door is the end.

import { Animatronic } from './base.js';
import { CONFIG } from '../config.js';

export class Cat extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.stage = 0;
    this.lockUntil = 0;
    this.waitUntil = 0;
    this.side = 'L';
    this.bangs = 0;
    this.camsWereOpen = false;
    this.sawStop = false;
  }

  bonus() {
    return this.s.tape.bonus();
  }

  /** Is the music keeping her on the ring? */
  dancing() {
    const tape = this.s.tape;
    return tape.enabled && !tape.stopped && tape.level >= CONFIG.tape.rally;
  }

  setStage(n) {
    this.stage = n;
    const s = this.s;
    if (n === 0) this.placeAt('MW_T', this.s.tape.enabled && !this.s.tape.stopped ? 'perform' : 'idle');
    else if (n === 1) {
      // she stops dancing and stares at the camera
      s.emit({ fx: 'pose', who: this.id, node: 'MW_T', pose: 'stand' });
      s.emit({ fx: 'sound', id: 'fnar.cat.bell', at: this.id, vol: 0.6 });
    } else if (n === 2) this.placeAt('MW_EDGE', 'stand');
    else if (n === 3) {
      this.placeAt('DIN_W', 'stand');
      s.emit({ fx: 'hide', who: this.id });
      const east = s.night >= this.cfg.eastFromNight && s.rng.chance(this.cfg.eastChance);
      this.side = east ? 'R' : 'L';
      this.waitUntil = s.t + this.cfg.waitAtStage3(this.ai);
    }
    s.staticOn(['8'], 20);
  }

  /** The tape was rewound above 60 %: back to the ring, if she has not run yet. */
  recall() {
    if (!this.active || this.state === 'run' || this.state === 'inside' || this.stage === 0 || this.stage >= 3) return;
    this.setStage(0);
  }

  tick() {
    const s = this.s;
    const open = s.devices.cams.open;
    if (this.camsWereOpen && !open) this.lockUntil = s.t + this.cfg.lockAfterCams(s.rng);
    this.camsWereOpen = open;
    if (this.state === 'run') {
      if (!this.tickWalk()) {
        if (s.t % 10 === 0) s.emit({ fx: 'sound', id: 'fnar.cat.bell', at: this.id, vol: 1 });
      }
      return;
    }
    if (this.state === 'inside') {
      if (s.t >= this.killAt) s.kill(this.id);
      return;
    }
    if (!this.active) return;
    // the music stopped: she walks off the ring at once
    if (s.tape.stopped && !this.sawStop) {
      this.sawStop = true;
      if (this.stage < 2) this.setStage(2);
    }
    if (!s.tape.stopped) this.sawStop = false;
    if (this.stage < 3) {
      if (this.dancing()) {
        if (s.t >= this.nextMo) this.nextMo = s.t + this.cfg.mo; // she is busy dancing
        return;
      }
      if (open || s.t < this.lockUntil) {
        if (s.t >= this.nextMo) this.nextMo = s.t + this.cfg.mo; // opportunities are lost while watched
        return;
      }
      if (this.opportunity()) this.setStage(this.stage + 1);
      return;
    }
    // stage 3: waiting to run
    const hallCam = this.side === 'L' ? '2A' : '4A';
    if ((open && s.devices.cams.cam === hallCam) || s.t >= this.waitUntil) this.run();
  }

  run() {
    const s = this.s;
    this.state = 'run';
    const route = this.cfg.routes[this.side];
    this.node = route[0];
    this.goTo(route[route.length - 1], { via: route, speed: this.cfg.runSpeed, anim: 'run', statics: false });
    s.emit({ fx: 'sound', id: 'fnar.cat.run', at: 'door_' + this.side.toLowerCase(), vol: 1 });
  }

  onArrive(node) {
    const s = this.s;
    if (this.state !== 'run') return super.onArrive(node);
    if (s.doorClosed(this.side)) {
      this.bangs++;
      const drain = CONFIG.power.catBang.first + (this.bangs - 1) * CONFIG.power.catBang.step;
      s.drainPower(drain);
      s.emit({ fx: 'sound', id: 'fnar.cat.bang', at: 'door_' + this.side.toLowerCase(), vol: 1 });
      s.emit({ fx: 'cat_bang', side: this.side, drain });
      this.state = 'idle';
      this.setStage(this.cfg.bangReset(s.rng));
      this.nextMo = s.t + this.cfg.mo;
    } else {
      this.state = 'inside';
      this.inside = true;
      s.breach(this.side, this.id);
      this.killAt = s.t + 2;
    }
  }

  debug() {
    return `cat:${this.ai} stage${this.stage}${this.state === 'run' ? `>run${this.side}` : ''}`;
  }
}
