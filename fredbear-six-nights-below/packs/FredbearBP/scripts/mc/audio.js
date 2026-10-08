// Positional audio cues emitted by the night simulation. The script owns AI
// cue sounds (footsteps, clatter, laughter, music boxes); command blocks own
// scripted environmental sequences. Loops are tracked so they can be stopped
// (SoundInstance.stop) when the cue ends or the night resets.

import { dim, Wv } from './world_io.js';
import { log } from './log.js';

const MAX_PER_TICK = 6; // bounded sound use

export class Audio {
  constructor() {
    this.loops = new Map();
    this.sentThisTick = 0;
  }

  newTick() {
    this.sentThisTick = 0;
  }

  /** Play a sound fx from the session. `guard` gets office/player sounds. */
  play(fx, guard, { relayKitchen = false } = {}) {
    if (this.sentThisTick >= MAX_PER_TICK) return;
    this.sentThisTick++;
    try {
      let inst;
      const opts = { volume: fx.vol ?? 1, pitch: fx.pitch ?? 1 };
      if (fx.at === 'office' || fx.at === 'player' || !fx.at) {
        if (guard?.isValid) inst = guard.playSound(fx.id, opts);
      } else {
        inst = dim().playSound(fx.id, Wv(fx.at), opts);
        if (relayKitchen && fx.kitchen && guard?.isValid) guard.playSound(fx.id, { volume: 0.9 }); // CAM 10 audio relay
      }
      if (fx.loopKey && inst) {
        this.stop(fx.loopKey);
        this.loops.set(fx.loopKey, inst);
      }
    } catch (e) {
      log.warn(`sound ${fx.id}: ${e?.message ?? e}`);
    }
  }

  stop(key) {
    if (key === '*') {
      for (const k of [...this.loops.keys()]) this.stop(k);
      return;
    }
    const inst = this.loops.get(key);
    if (!inst) return;
    try {
      inst.stop();
    } catch {
      // already finished
    }
    this.loops.delete(key);
  }
}
