// The Cat (Kitty's Cabaret): FNAF 1 Foxy rules. Curtain stages 0..3 advance
// on successful opportunities, but never while the monitor is up and not
// for a random while after it goes down - so checking the cameras often
// keeps her in. At stage 3 she leaves: she sprints down a hall (west, or from
// night 4 sometimes east) the moment the guard looks at that hall's camera,
// or after a while anyway. A shut door makes her bang (power drain grows each
// time) and slink back to her booth; an open door is the end.

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
  }

  bonus() {
    return this.s.rally ? CONFIG.characters.top_hat_rat.rallyBonus : 0;
  }

  setStage(n) {
    this.stage = n;
    const s = this.s;
    s.emit({ fx: 'curtain', stage: n });
    if (n === 0) this.placeAt('CAB', 'idle');
    else if (n === 1) this.placeAt('CAB_PEEK', 'peek');
    else if (n === 2) this.placeAt('CAB_OUT', 'stand');
    else if (n === 3) {
      this.placeAt('DIN_CAB', 'stand');
      s.emit({ fx: 'hide', who: this.id });
      const east = s.night >= this.cfg.eastFromNight && s.rng.chance(this.cfg.eastChance);
      this.side = east ? 'R' : 'L';
      this.waitUntil = s.t + this.cfg.waitAtStage3(this.ai);
    }
    s.staticOn(['1C'], 25);
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
    if (this.stage < 3) {
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
