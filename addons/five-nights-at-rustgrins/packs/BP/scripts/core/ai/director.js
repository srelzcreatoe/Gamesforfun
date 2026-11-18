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
//   memory    after deaths on earlier tries (core/ai/memory.js) the pressure never goes as high.
//   tactics   on the later nights the cast works together, always with a tell:
//               the racket   pots crash in a room the guard can only listen to (the kitchen;
//                            the 'clatter' cue) to cover somebody else: a stalker closing in
//                            on its door has its partner step into that room on the way past
//                            (the errand), and for a few seconds its own footsteps drown in the
//                            noise and it steps up to the door, good moment or not, a little
//                            bolder for it. The same when a stalker reaches its corner while
//                            somebody happens to stand in that room. The one making the noise
//                            is never the one coming.
//               the trade    once a night, Mirehop and Noxbriar swap halls for one trip (the
//                            'trade' cue: a twang and a hum together in the dining room).
//               the duo      after the Ringmaster's "places!" the two he sends out arrive at
//                            least `duoGap` apart (see top_hat_rat.js).
// Pure (no @minecraft imports).

import { CONFIG } from '../config.js';
import { heardOnly, neighbors, distToDoor, edgeLength } from './graph.js';

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
    /** steps taken off the pressure after deaths in a row (from the memory of earlier nights) */
    this.ease = 0;
    this.mercy = 0;
    // group tactics
    const T = this.cfg.tactics;
    this.tactics = this.enabled && s.night >= T.fromNight;
    this.clatterUntil = 0;
    this.clatterFor = null;
    /** @type {number} */
    this.clatterReady = T.clatter.cooldown;
    /** @type {number} tick the stalkers may trade halls from (once a night) */
    this.tradeAt = this.tactics ? Math.round(s.ticksPerHour * (T.trade.hours[0] + s.rng.next() * (T.trade.hours[1] - T.trade.hours[0]))) : Infinity;
    this.tradeDone = false;
    this.duoUntil = 0;
  }

  /** @param {ReturnType<import('./memory.js').beliefsFor>} b what they remember of the guard */
  adopt(b) {
    this.ease = b?.ease ?? 0;
    this.mercy = this.ease;
  }

  tick() {
    const s = this.s;
    if (this.tactics && s.t % 10 === 0) this.tickTactics();
    if (s.t < this.nextEval) return;
    this.nextEval = s.t + this.cfg.evalEvery;
    this.pressure = this.judge();
    // a slot whose holder was moved elsewhere (a summon, a debug command) is free again
    for (const k of SLOTS) {
      const who = this.slots[k];
      if (who && !s.chars[who]?.holds?.(k)) this.slots[k] = null;
    }
  }

  /** The trade (see the header). Never while the director goes easy on the guard. */
  tickTactics() {
    const s = this.s;
    const T = this.cfg.tactics;
    const t = s.t;
    if (this.gentle()) return;
    const cast = Object.values(s.chars);
    if (!this.tradeDone && t >= this.tradeAt) {
      if (t > s.ticksPerHour * (T.trade.hours[1] + 0.8)) this.tradeDone = true; // too late in the night
      const pair = cast.filter((c) => typeof c.trade === 'function');
      if (pair.length === 2 && pair[0].home !== pair[1].home && pair.every((c) => c.loose && c.level >= T.trade.minAi && !c.watched() && this.free(c.side, c.id))) {
        this.tradeDone = true;
        for (const c of pair) c.trade(t + T.trade.lasts);
        s.emit({ fx: 'cue', kind: 'trade', who: pair.map((c) => c.id) });
      }
    }
  }

  /**
   * Going easy on the guard: heading for a blackout well before 6 AM, or just after a close
   * call. The cast keeps its tricks (baits, tactics, the Ringmaster's "places!") to itself.
   */
  gentle() {
    return this.enabled && (this.pressure <= this.cfg.minBonus || this.s.t < this.breatherUntil);
  }

  /** Is this stalker closing in on its door (hunting, in its hall, the door open)? */
  closing(p) {
    const at = p.node ?? p.walk?.to;
    return p.active && !p.inside && p.mode === 'hunt' && at !== p.door && !this.s.doorClosed(p.side) && distToDoor(at, p.side) <= this.cfg.tactics.clatter.near;
  }

  /** The other door stalker. */
  partnerOf(c) {
    return Object.values(this.s.chars).find((o) => o !== c && typeof o.trade === 'function') ?? null;
  }

  /**
   * The errand for a racket: a stalker passing a room the guard can only listen to steps in
   * there while its partner closes in on the other door. Returns that room's node, or null.
   */
  errand(c) {
    const s = this.s;
    const T = this.cfg.tactics.clatter;
    if (!this.tactics || this.gentle() || s.t < this.clatterReady - T.lead || c.traded || c.opening || !c.node) return null;
    const partner = this.partnerOf(c);
    if (!partner || partner.traded || !this.closing(partner)) return null;
    return neighbors(c.node).find((n) => heardOnly(n) && edgeLength(c.node, n) <= T.reach) ?? null;
  }

  /** The errand is run: `helper` stands in the room. The racket, to cover its partner's way to the door. */
  cover(helper) {
    const partner = this.partnerOf(helper);
    if (!partner || !this.closing(partner)) return false;
    return this.startRacket(partner, helper);
  }

  /** Is this one covered by a racket right now (its footsteps down the hall drown in it)? */
  covered(c) {
    return this.s.t < this.clatterUntil && this.clatterFor === c.id;
  }

  startRacket(c, helper) {
    const s = this.s;
    const T = this.cfg.tactics.clatter;
    if (!this.tactics || s.t < this.clatterReady || this.gentle()) return false;
    this.clatterUntil = s.t + T.window;
    this.clatterFor = c.id;
    this.clatterReady = s.t + T.cooldown;
    s.emit({ fx: 'cue', kind: 'clatter', who: helper.id, node: helper.node });
    return true;
  }

  /**
   * A racket for this stalker, about to step up to its door: true while one is on for it, or
   * when one can start right now - somebody else stands in a room the guard can only listen
   * to, and makes a noise there (the 'clatter' cue).
   */
  racket(c) {
    const s = this.s;
    if (this.covered(c)) return true;
    if (!this.tactics || s.t < this.clatterReady || this.gentle() || s.doorClosed(c.side)) return false;
    const helper = Object.values(s.chars).find((h) => h !== c && h.pincer && h.active && !h.inside && !h.walk && !!h.node && heardOnly(h.node));
    return !!helper && this.startRacket(c, helper);
  }

  /** The pressure the guard can take right now (an AI bonus for movement rolls). */
  judge() {
    const s = this.s;
    const c = this.cfg;
    if (!this.enabled || s.mods.infinitePower) return 0;
    const el = s.t / (s.ticksPerHour * s.hours);
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
    // the guard died last time (again): a step easier per death in a row, and never as high
    const top = Math.max(0, (c.maxBonus[s.night] ?? c.maxBonus.default) - this.ease);
    return Math.max(c.minBonus, Math.min(top, b - this.mercy));
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
    return this.lastStriker === who || t - this.lastStrike >= (t < this.duoUntil ? this.cfg.tactics.duoGap : this.cfg.minGap);
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
