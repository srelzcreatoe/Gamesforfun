// The Ringmaster (Top-Hat Rat): the show must go on. His show tape (on the
// deck by his ring, CAM 8) runs down while he is active; the guard rewinds it
// from CAM 8 (PLAY SHOW). Under 30 % he rallies his troupe (Purple Rat and the
// Cat get +3 AI). At 0 % the music dies and he walks to the office, tapping his
// cane - doors do not stop him. Rewinding above 60 % before he reaches a hall
// corner calls him back to the ring.

import { Animatronic } from './base.js';

export class TopHatRat extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.tape = this.cfg.tapeFull;
    this.state = 'show';
    this.side = 'L';
    this.idx = 0;
    this.windReady = 0;
    this.lastLevel = 4;
    this.slow = false;
  }

  get enabled() {
    return this.s.def.tape !== false && this.baseAi > 0;
  }

  tapeLevel() {
    return Math.max(0, Math.min(4, Math.ceil((this.tape / this.cfg.tapeFull) * 4)));
  }

  wind() {
    const s = this.s;
    if (!this.enabled || s.t < this.windReady) return false;
    this.windReady = s.t + this.cfg.windCooldown;
    this.tape = Math.min(this.cfg.tapeFull, this.tape + this.cfg.windStep);
    s.emit({ fx: 'sound', id: 'fnar.tophat.rewind', at: 'cam8', vol: 0.9 });
    if ((this.state === 'leaving' || this.state === 'returning') && this.tape >= this.cfg.recall) this.recall();
    return true;
  }

  tick() {
    const s = this.s;
    if (!this.enabled) return;
    if (this.state === 'inside') {
      if (s.t >= this.killAt) s.kill(this.id);
      return;
    }
    // tape drain (only while he performs)
    if (this.state === 'show' && this.active) {
      this.tape = Math.max(0, this.tape - Math.round((this.cfg.drainAt20 * this.ai) / 20));
    }
    s.rally = this.tape < this.cfg.rally && this.active;
    const lvl = this.tapeLevel();
    if (lvl !== this.lastLevel) {
      this.lastLevel = lvl;
      s.emit({ fx: 'tape', level: lvl, pct: Math.round(this.tape / 1000) });
    }
    const slow = this.tape < this.cfg.rally;
    if (slow !== this.slow) {
      this.slow = slow;
      s.emit({ fx: 'show_music', slow });
      if (slow) s.emit({ fx: 'sound', id: 'fnar.tophat.laugh', at: this.id, vol: 0.8 });
    }
    if (this.tickWalk()) return;
    if (this.state === 'show' && this.tape <= 0 && this.active) {
      this.leave();
      return;
    }
    if (this.state === 'leaving' && !this.walk) {
      const route = this.cfg.routes[this.side];
      if (this.idx >= route.length - 1) {
        this.state = 'inside';
        this.inside = true;
        s.breach(this.side, this.id, true);
        this.killAt = s.t + 30;
        return;
      }
      // a measured walk: pause a little at each node
      if (s.t >= this.pauseUntil) this.step();
    }
  }

  leave() {
    const s = this.s;
    this.state = 'leaving';
    this.side = s.rng.chance(0.5) ? 'L' : 'R';
    this.idx = 0;
    this.pauseUntil = s.t + 40;
    s.emit({ fx: 'sound', id: 'fnar.tophat.tape_out', at: 'cam8', vol: 1 });
    s.emit({ fx: 'show_music', stop: true });
    s.emit({ fx: 'ringmaster', state: 'leaving', side: this.side });
  }

  step() {
    const s = this.s;
    const route = this.cfg.routes[this.side];
    const next = route[this.idx + 1];
    if (this.goTo(next, { speed: this.cfg.walkSpeed, anim: 'walk', statics: false })) {
      this.idx++;
      s.emit({ fx: 'sound', id: 'fnar.tophat.cane', at: this.id, vol: 1, follow: true });
    }
  }

  onArrive(node) {
    super.onArrive(node);
    const s = this.s;
    if (this.state === 'returning' && node === this.cfg.start) {
      this.state = 'show';
      this.idx = 0;
      s.emit({ fx: 'pose', who: this.id, node, pose: 'perform' });
      s.emit({ fx: 'show_music', slow: this.tape < this.cfg.rally });
      s.emit({ fx: 'ringmaster', state: 'show' });
      return;
    }
    if (this.state === 'leaving') {
      this.pauseUntil = s.t + 20 + s.rng.int(0, 20);
      if (node === this.cfg.pointOfNoReturn || node === 'EC') s.emit({ fx: 'ringmaster', state: 'close', side: this.side });
    }
  }

  recall() {
    const s = this.s;
    const route = this.cfg.routes[this.side];
    const here = this.walk ? null : this.node;
    if (here === this.cfg.pointOfNoReturn || here === 'EC' || this.idx >= route.indexOf(this.side === 'L' ? 'WC' : 'EC')) return; // too late
    this.state = 'returning';
    s.emit({ fx: 'sound', id: 'fnar.tophat.fanfare', at: this.id, vol: 0.8 });
    s.emit({ fx: 'ringmaster', state: 'returning' });
    // he goes back off-camera
    this.placeAt(this.cfg.start, 'perform');
    this.onArrive(this.cfg.start);
  }

  debug() {
    return `tophat:${this.ai} tape${Math.round(this.tape / 1000)}% ${this.state}${this.state === 'leaving' ? this.side + this.idx : ''}`;
  }
}
