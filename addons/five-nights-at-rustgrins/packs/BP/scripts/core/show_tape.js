// The troupe's show tape (CAM 8). The Cat and the Purple Rat dance on the Midway ring
// to a tape deck that winds down over the night; the guard rewinds it with PLAY SHOW
// while watching CAM 8. Under 30 % the music slows and the troupe grows bolder; at 0 %
// the music stops: the Cat leaves the ring and the Purple Rat gets much bolder.
// Rewinding above 60 % calls the Cat back if she has not run yet. Pure (no @minecraft).

import { CONFIG } from './config.js';

export class ShowTape {
  /** @param {import('./session.js').NightSession} s */
  constructor(s) {
    this.s = s;
    this.cfg = CONFIG.tape;
    /** @type {number} */
    this.level = this.cfg.full;
    this.windReady = 0;
    this.lastQuarter = 4;
    /** @type {boolean | 'stop'} music state last announced: normal, slow, or stopped */
    this.slow = false;
    this.stopped = false;
  }

  /** Runs on the nights with a tape, while the troupe is on the program. */
  get enabled() {
    const s = this.s;
    return !!s.def.tape && ((s.def.ai.cat ?? 0) > 0 || (s.def.ai.purple_rat ?? 0) > 0);
  }

  get pct() {
    return Math.round(this.level / 1000);
  }

  /** 0..4 bars on the tape deck's VU meter. */
  quarter() {
    return Math.max(0, Math.min(4, Math.ceil((this.level / this.cfg.full) * 4)));
  }

  /** Extra AI for the troupe right now. */
  bonus() {
    if (!this.enabled) return 0;
    if (this.stopped) return this.cfg.stopBonus;
    return this.level < this.cfg.rally ? this.cfg.rallyBonus : 0;
  }

  /** PLAY SHOW (only works on CAM 8, checked by the session). */
  wind() {
    const s = this.s;
    if (!this.enabled || s.t < this.windReady) return false;
    this.windReady = s.t + this.cfg.windCooldown;
    this.level = Math.min(this.cfg.full, this.level + this.cfg.windStep);
    s.emit({ fx: 'sound', id: 'fnar.tophat.rewind', at: 'cam8', vol: 0.9 });
    if (this.stopped && this.level > 0) {
      this.stopped = false;
      s.emit({ fx: 'sound', id: 'fnar.tophat.fanfare', at: 'cam8', vol: 0.8 });
    }
    if (this.level >= this.cfg.recall) s.chars.cat?.recall?.();
    this.update();
    return true;
  }

  tick() {
    if (!this.enabled) return;
    const s = this.s;
    const troupe = Math.max(s.chars.cat?.active ? s.chars.cat.ai : 0, s.chars.purple_rat?.active ? s.chars.purple_rat.ai : 0);
    if (!this.stopped && troupe > 0) {
      const drain = Math.max(this.cfg.minDrain, Math.round((this.cfg.drainAt20 * troupe) / 20));
      this.level = Math.max(0, this.level - drain);
      if (this.level === 0) {
        this.stopped = true;
        s.emit({ fx: 'sound', id: 'fnar.tophat.tape_out', at: 'cam8', vol: 1 });
        s.emit({ fx: 'tape_stop' });
      }
    }
    this.update();
  }

  /** Effects when the meter or the music changes. */
  update() {
    const s = this.s;
    const q = this.quarter();
    if (q !== this.lastQuarter) {
      this.lastQuarter = q;
      s.emit({ fx: 'tape', level: q, pct: this.pct });
    }
    const slow = this.level < this.cfg.rally;
    if (this.stopped) {
      if (this.slow !== 'stop') {
        this.slow = 'stop';
        s.emit({ fx: 'show_music', stop: true });
      }
    } else if (slow !== this.slow) {
      this.slow = slow;
      s.emit({ fx: 'show_music', slow });
    }
  }
}
