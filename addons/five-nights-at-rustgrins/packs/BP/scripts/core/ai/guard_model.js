// What the animatronics know about the guard: only what they could plausibly notice from the
// building itself, never the guard's mind.
//   - the hall lights: whoever stands in a hall sees them come on, and learns the rhythm of
//     the guard's checks on that side (an average gap between checks);
//   - the doors and vent covers: a slam carries through the whole building; how much of the
//     last while each one has been shut ("camping");
//   - the monitor: its glow leaks under the doors, so the troupe knows when the guard is on
//     the cameras (busy, not watching the doors);
//   - the cameras: a feed being watched has its tally light on, so they feel which rooms are
//     watched and how much ("heat", fading over half a minute).
// Sampled once per tick from the session's device state. Pure (no @minecraft imports).

import { CONFIG } from '../config.js';
import { videoCams } from './graph.js';

const SIDES = Object.freeze(['L', 'R']);

/** A door or vent cover: how much of the last while it has been shut. */
function track(rec, closed, k) {
  rec.ratio += ((closed ? 1 : 0) - rec.ratio) * k;
}

export class GuardModel {
  /** @param {import('../session.js').NightSession} s */
  constructor(s) {
    this.s = s;
    this.cfg = CONFIG.brain;
    const light = () => ({ on: false, onAt: -1e9, offAt: -1e9, gap: this.cfg.gapStart, checks: 0 });
    const shut = () => ({ ratio: 0 });
    this.light = { L: light(), R: light() };
    this.door = { L: shut(), R: shut() };
    this.vent = { L: shut(), R: shut() };
    this.camsOpen = false;
    /** camId -> { v, t }: attention that fades with time */
    this.heat = Object.create(null);
  }

  tick() {
    const s = this.s;
    const d = s.devices;
    const t = s.t;
    const cfg = this.cfg;
    const k = 1 / cfg.campWindow;
    for (const side of SIDES) {
      const L = this.light[side];
      const on = side === 'L' ? d.lightL : d.lightR;
      if (on && !L.on) {
        L.on = true;
        if (L.checks > 0) L.gap += (Math.min(t - L.onAt, cfg.gapStart * 2) - L.gap) * cfg.gapAlpha;
        L.onAt = t;
        L.checks++;
      } else if (!on && L.on) {
        L.on = false;
        L.offAt = t;
      }
      track(this.door[side], s.doorClosed(side), k);
      track(this.vent[side], s.ventClosed(side), k);
    }
    const open = d.cams.open && !s.powerOut;
    this.camsOpen = open;
    if (open && s.camWorking(d.cams.cam)) {
      const h = (this.heat[d.cams.cam] ??= { v: 0, t });
      h.v = this.camHeat(d.cams.cam) + 1;
      h.t = t;
    }
  }

  // ------------------------------------------------------------ queries
  /** On the cameras: nobody is watching the doors. */
  busy() {
    return this.camsOpen;
  }

  lit(side) {
    return this.light[side].on;
  }

  /** Ticks since that side's hall light was last on (0 while it is on). */
  sinceCheck(side) {
    const L = this.light[side];
    return L.on ? 0 : this.s.t - L.offAt;
  }

  /** The guard looked down that hall a moment ago (and will not look again for a while). */
  justChecked(side, within) {
    const L = this.light[side];
    return !L.on && this.s.t - L.offAt < within;
  }

  /**
   * A good moment to step into the doorway unseen: the guard is on the cameras, has just
   * finished a light check (the learned rhythm says the next one is a while off), or has
   * stopped checking this side altogether.
   */
  safeWindow(side) {
    if (this.busy()) return true;
    const L = this.light[side];
    if (L.on) return false;
    const since = this.s.t - L.offAt;
    if (L.checks < 2) return since > this.cfg.quietTicks;
    return since < L.gap * this.cfg.afterCheck || since > L.gap * this.cfg.overdue;
  }

  /** The guard keeps this door shut most of the time. */
  camped(side) {
    return this.door[side].ratio >= this.cfg.camp;
  }

  ventCamped(side) {
    return this.vent[side].ratio >= this.cfg.camp;
  }

  /** Raw attention on one camera (about 1 per tick watched, fading). */
  camHeat(cam) {
    const h = this.heat[cam];
    if (!h) return 0;
    const dt = this.s.t - h.t;
    return dt <= 0 ? h.v : h.v * Math.exp(-dt / this.cfg.heatTau);
  }

  /** 0..1: how much the guard has been watching this spot lately. */
  nodeHeat(node) {
    let m = 0;
    for (const cam of videoCams(node)) m = Math.max(m, this.camHeat(cam));
    return Math.min(1, m / this.cfg.heatFull);
  }
}
