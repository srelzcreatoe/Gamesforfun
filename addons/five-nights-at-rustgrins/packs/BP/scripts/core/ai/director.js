// The director: a gentle hand on the night's pressure, and the cast's coordination.
//   pressure  every few seconds it projects the guard's power at 6 AM from the drain so far.
//             A guard cruising with plenty to spare gets a little more aggression (+1/+2 on
//             movement rolls); one heading for a blackout, or one who just survived several
//             close calls, gets a breather (-1..-3). Off on the training night and the Final Act.
//   slots     each way into the office (the left door; the right door, window and nook; each
//             vent) is worked by one animatronic at a time: nobody stacks on a door another is
//             already standing at.
//   spacing   strikes (stepping into a doorway, reaching a vent, slipping into the nook, the
//             Cat's sprint) come at least `minGap` ticks apart, and none starts during a short
//             breather after a close call, so two threats never need two answers at once.
//   pincer    while one side is being worked, or the guard camps that side's door, the stalker
//             on the other side gets a bonus: one draws attention while the other sneaks.
// Pure (no @minecraft imports).

import { CONFIG } from '../config.js';

export const SLOTS = Object.freeze(['L', 'R', 'VL', 'VR']);
const OTHER = Object.freeze({ L: 'R', R: 'L' });

export class Director {
  /** @param {import('../session.js').NightSession} s */
  constructor(s) {
    this.s = s;
    this.cfg = CONFIG.director;
    this.enabled = !s.final && s.night !== 0;
    this.pressure = 0;
    /** @type {number} */
    this.nextEval = this.cfg.evalEvery;
    this.breatherUntil = 0;
    this.lastStrike = -1e9;
    this.lastStriker = null;
    /** @type {Record<string, string | null>} slot -> who is working it */
    this.slots = { L: null, R: null, VL: null, VR: null };
    /** @type {number[]} ticks of recent close calls */
    this.closeCalls = [];
  }

  tick() {
    const s = this.s;
    if (s.t < this.nextEval) return;
    this.nextEval = s.t + this.cfg.evalEvery;
    this.pressure = this.judge();
    // a slot whose holder was moved elsewhere (a summon, a debug command) is free again
    for (const k of SLOTS) {
      const who = this.slots[k];
      if (who && !s.chars[who]?.holds?.(k)) this.slots[k] = null;
    }
  }

  /** The pressure the guard can take right now (an AI bonus for movement rolls). */
  judge() {
    const s = this.s;
    const c = this.cfg;
    if (!this.enabled || s.mods.infinitePower) return 0;
    const el = s.t / (s.ticksPerHour * 6);
    if (el < c.judgeAfter || el >= 1) return 0;
    const full = CONFIG.power.start;
    const rate = (full - s.power) / full / el;
    const projected = s.power / full - rate * (1 - el);
    let b = 0;
    for (const [atLeast, v] of c.cruise) {
      if (projected >= atLeast) {
        b = v;
        break;
      }
    }
    if (b === 0) {
      for (const [below, v] of c.struggle) {
        if (projected < below) {
          b = v;
          break;
        }
      }
    }
    this.closeCalls = this.closeCalls.filter((t) => s.t - t < c.closeCallWindow);
    if (this.closeCalls.length >= c.closeCallsEase) b = Math.min(b, -1);
    return Math.max(c.minBonus, Math.min(c.maxBonus[s.night] ?? c.maxBonus.default, b));
  }

  /** Movement-roll bonus for a character: the night's pressure, plus the pincer for side stalkers. */
  rollBonus(c) {
    if (!this.enabled) return 0;
    return this.pressure + (this.pincerOn(c) ? this.cfg.pincer : 0);
  }

  /** The other side is being worked by someone else, or the guard camps its door. */
  pincerOn(c) {
    if (!this.enabled || !c.pincer || (c.side !== 'L' && c.side !== 'R')) return false;
    const other = OTHER[c.side];
    const held = this.slots[other];
    return (!!held && held !== c.id) || this.s.habits.camped(other);
  }

  /** Is the slot free for this character (or already its own)? */
  free(slot, who) {
    const h = this.slots[slot];
    return !h || h === who;
  }

  holder(slot) {
    return this.slots[slot];
  }

  claim(slot, who) {
    this.slots[slot] = who;
  }

  release(slot, who) {
    if (this.slots[slot] === who) this.slots[slot] = null;
  }

  /** May a new strike start now (spacing and breathers)? */
  mayStrike(who) {
    if (!this.enabled) return true;
    const t = this.s.t;
    if (t < this.breatherUntil) return false;
    return this.lastStriker === who || t - this.lastStrike >= this.cfg.minGap;
  }

  /** A strike started: claim the slot and space out the next one. */
  struck(who, slot = null) {
    this.lastStrike = this.s.t;
    this.lastStriker = who;
    if (slot) this.claim(slot, who);
  }

  /** The guard answered a strike at the last moment: everyone else holds back a moment. */
  closeCall(who) {
    if (!this.enabled) return;
    this.breatherUntil = Math.max(this.breatherUntil, this.s.t + this.cfg.breather);
    this.closeCalls.push(this.s.t);
    this.lastStriker = who;
  }

  debug() {
    const held = SLOTS.filter((k) => this.slots[k]).map((k) => `${k}:${this.slots[k]}`).join(',');
    return `dir:${this.pressure >= 0 ? '+' : ''}${this.pressure}${held ? ` ${held}` : ''}${this.s.t < this.breatherUntil ? ' breather' : ''}`;
  }
}
