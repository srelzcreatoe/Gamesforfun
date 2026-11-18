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
// the ring; an open door is the end. Smarter (from night 4, when she can pick a hall): she
// prefers the hall whose door the guard leaves open and that nobody else is working, and a
// low growl down that hall tells which one. Her sprint waits a moment if another strike
// just started (director spacing).
// Her signature trick, the tape deck: while she is still dancing and nobody has looked at CAM 8
// for a long while, she slips behind the curtain and pulls the show tape through the deck
// (the 'pull' cue: the music warbles, and CAM 8 shows the ring without her). The tape runs
// down more than twice as fast until the guard rewinds it on CAM 8 (she is back on the ring
// at once, and sulks for a while), watches the empty ring for a moment, or she tires of it.
// An empty ring with the music still playing is her at the tape deck, not a sprint.
// She also remembers (memory.js): the hall the guard watched least, and the door that let
// her in last time (the 'grudge' cue).

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
    /** at the tape deck: { until, seen, nextTell } */
    this.pulling = null;
    this.pullReady = this.cfg.pull.cooldown;
    this.shy = false; // the guard is remembered for hardly using the cameras (memory.js)
    this.seenAt = 0; // the last tick the guard had her ring on a working camera
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
      this.grudgeCue();
      this.side = this.chooseSide();
      this.waitUntil = s.t + this.cfg.waitAtStage3(this.ai);
      if (s.night >= this.cfg.eastFromNight) s.emit({ fx: 'sound', id: 'fnar.cat.growl', at: this.side === 'L' ? 'door_l' : 'door_r', vol: 0.4, approach: this.side });
    }
    s.staticOn(['8'], 20);
  }

  /** West before night 4; then mostly west, but away from a camped door or one someone else is working. */
  chooseSide() {
    const s = this.s;
    const grudge = this.grudge;
    this.grudge = null;
    if (s.night < this.cfg.eastFromNight) return 'L';
    if (grudge === 'L' || grudge === 'R') return grudge; // the door that let her in last time
    const w = { L: 1 - this.cfg.eastChance, R: this.cfg.eastChance };
    for (const side of ['L', 'R']) {
      if (s.habits.camped(side)) w[side] *= 0.45;
      if (s.director.holder(side)) w[side] *= 0.4;
    }
    // what she remembers: the hall the guard watched least on earlier nights
    const b = s.beliefs;
    if (b?.soft) w[b.soft] *= 1 + CONFIG.memory.sideBias * b.softBy * s.trust();
    return s.rng.weighted([['L', w.L], ['R', w.R]]);
  }

  adopt(b) {
    super.adopt(b);
    // a guard she remembers hardly using the cameras: she expects to be ignored, and is at the tape deck sooner
    this.shy = !!b && b.monitor === 'shy' && b.conf >= 0.5;
    if (this.s.t <= 1) this.pullReady = Math.round(this.cfg.pull.cooldown * (this.shy ? 1 - CONFIG.memory.ignoredCat : 1));
  }

  /** Nobody has looked at the ring for a long while: behind the curtain, to the tape deck. */
  maybePull() {
    const s = this.s;
    const c = this.cfg.pull;
    if (!s.tricks || this.stage !== 0 || this.ai < c.fromAi || s.t < this.pullReady || s.director.gentle()) return;
    if (s.t - this.seenAt < c.ignored(this.ai) * (this.shy ? 1 - CONFIG.memory.ignoredCat * s.trust() : 1)) return;
    this.pulling = { until: s.t + c.lasts, seen: 0, nextTell: s.t + c.tell };
    s.emit({ fx: 'hide', who: this.id });
    s.staticOn(['8'], 20);
    s.emit({ fx: 'cue', kind: 'pull', who: this.id });
  }

  tickPull() {
    const s = this.s;
    const c = this.cfg.pull;
    const p = this.pulling;
    if (s.isWatchingNode(this.cfg.start)) p.seen++;
    // the music slowed or stopped (her usual cue), she was caught looking, or she tires of it
    if (!this.dancing() || s.t >= p.until || p.seen >= c.stare) return this.endPull(false);
    if (s.t >= p.nextTell) {
      p.nextTell = s.t + c.tell;
      s.emit({ fx: 'cue', kind: 'pull', who: this.id, again: true });
    }
  }

  /** Back onto the ring (PLAY SHOW on CAM 8 sends her there at once: `rewound`). */
  endPull(rewound) {
    const s = this.s;
    this.pulling = null;
    this.pullReady = s.t + this.cfg.pull.cooldown * (rewound ? 1.5 : 1);
    this.seenAt = s.t;
    this.setStage(0);
    s.emit({ fx: 'cue', kind: 'pull_end', who: this.id, rewound });
  }

  /** PLAY SHOW was pressed (show_tape.js). */
  rewound() {
    if (this.pulling) this.endPull(true);
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
    if (s.isWatchingNode(this.cfg.start)) this.seenAt = s.t;
    if (this.pulling) return this.tickPull();
    // the music stopped: she walks off the ring at once
    if (s.tape.stopped && !this.sawStop) {
      this.sawStop = true;
      if (this.stage < 2) this.setStage(2);
    }
    if (!s.tape.stopped) this.sawStop = false;
    if (this.stage < 3) {
      if (this.dancing()) {
        if (s.t >= this.nextMo) this.nextMo = s.t + this.cfg.mo; // she is busy dancing
        this.maybePull();
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
    if (!((open && s.devices.cams.cam === hallCam) || s.t >= this.waitUntil)) return;
    // another strike just started: she gives the guard a moment (never for long)
    if (!s.director.mayStrike(this.id) && s.t < this.waitUntil + 100) return;
    this.run();
  }

  run() {
    const s = this.s;
    s.director.struck(this.id);
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
      s.director.closeCall(this.id);
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
