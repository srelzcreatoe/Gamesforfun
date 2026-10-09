// Night director: attack arbitration, entry reservations, grace periods,
// adaptation memory and scheduled events. One instance per NightSession.
//
// ADAPTATION VARIABLES (all reset every night, all capped):
//   doorUse.L / doorUse.R / doorUse.H   0..10  +1 per closing, -1 per 600 ticks
//   noiseHeat                           0..10  +intensity per noisy action, -1 per 80 ticks
//   camFocus[cam]                       ticks watched, exponentially decayed (x0.999/tick)
//   repelled[who][entry]                0..5   times that character was turned away
// Nothing else about the player is learned.

import { CONFIG } from './config.js';
import { CAMERA_BY_ID } from '../data/cameras.js';

export class Director {
  constructor(session) {
    this.s = session;
    this.cfg = CONFIG.director;
    this.doorUse = { L: 0, R: 0, H: 0 };
    this.noiseHeat = 0;
    this.camFocus = Object.create(null);
    this.attackToken = null;
    this.entries = { L: null, R: null, H: null }; // reserved by character id
    this.graceUntil = 0;
    this.eventsDone = new Set();
    this.finale = false;
  }

  // ------------------------------------------------------------ adaptation
  onDoorClosed(entry) {
    this.doorUse[entry] = Math.min(10, this.doorUse[entry] + 1);
  }

  noise(kind, intensity) {
    this.noiseHeat = Math.min(10, this.noiseHeat + intensity);
    this.lastNoise = { kind, t: this.s.t };
  }

  topCamera() {
    let best = null;
    let bestV = 30; // ignore cameras watched less than ~1.5 s recently
    for (const [cam, v] of Object.entries(this.camFocus)) {
      if (v > bestV) {
        bestV = v;
        best = cam;
      }
    }
    return best;
  }

  /** Nodes covered by the camera the player has relied on most recently. */
  focusedNodes() {
    const top = this.topCamera();
    return top ? CAMERA_BY_ID[top].sees : [];
  }

  tickMemory() {
    const t = this.s.t;
    if (t % this.cfg.noiseDecayTicks === 0 && this.noiseHeat > 0) this.noiseHeat--;
    if (t % this.cfg.doorUseDecayTicks === 0) {
      for (const k of ['L', 'R', 'H']) if (this.doorUse[k] > 0) this.doorUse[k]--;
    }
    for (const k of Object.keys(this.camFocus)) {
      this.camFocus[k] *= this.cfg.camFocusDecay;
      if (this.camFocus[k] < 0.5) delete this.camFocus[k];
    }
    const cams = this.s.devices.cams;
    if (cams.open && cams.cam) this.camFocus[cams.cam] = (this.camFocus[cams.cam] ?? 0) + 1;
  }

  // ------------------------------------------------------------ arbitration
  activeEntryCount(exceptWho) {
    return Object.values(this.entries).filter((w) => w && w !== exceptWho).length;
  }

  fredbearEngaged() {
    const fb = this.s.anim.fredbear;
    return ['APPROACH', 'TELEGRAPH', 'FORCING', 'JAMMED'].includes(fb.state);
  }

  /**
   * May `who` start moving into `entry`? Rules:
   *  - the entry slot is free;
   *  - at most 2 entries engaged at once;
   *  - nobody else starts while Fredbear is engaged (keeps a valid defence);
   *  - Fredbear waits while two others are engaged;
   *  - no new approach during a blackout, its grace, or the post-maintenance grace;
   *  - never outside the RUNNING phase.
   */
  canApproach(who, entry) {
    const s = this.s;
    if (s.phase !== 'RUNNING') return false;
    if (s.t < this.graceUntil) return false;
    if (s.blackout.stage !== 'none') return false;
    const holder = this.entries[entry];
    if (holder && holder !== who) return false;
    if (this.activeEntryCount(who) >= this.cfg.maxConcurrentEntries) return false;
    if (who !== 'fredbear' && this.fredbearEngaged()) return false;
    if (s.finale && who !== 'fredbear') return false;
    return true;
  }

  reserveEntry(who, entry) {
    if (!this.canApproach(who, entry)) return false;
    this.entries[entry] = who;
    return true;
  }

  releaseEntry(who) {
    for (const k of ['L', 'R', 'H']) if (this.entries[k] === who) this.entries[k] = null;
  }

  /** Single attack token: the first valid requester wins; the night stops on a lethal attack. */
  requestAttack(who) {
    const s = this.s;
    if (this.attackToken && this.attackToken !== who) return false;
    if (s.phase !== 'RUNNING' && !(s.phase === 'POWER_OUT' && who === s.powerOut?.who)) return false;
    this.attackToken = who;
    return true;
  }

  releaseAttack(who) {
    if (this.attackToken === who) this.attackToken = null;
  }

  /** Blackouts may only start when no telegraph is running (never removes a defence). */
  blackoutAllowed() {
    const s = this.s;
    if (s.phase !== 'RUNNING' || s.t < this.graceUntil) return false;
    if (this.activeEntryCount() > 0) return false;
    for (const a of s.order) {
      const st = s.anim[a].state;
      if (['APPROACH', 'TELEGRAPH', 'LURK', 'FORCING', 'JAMMED'].includes(st)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ scheduled events
  tickEvents() {
    const s = this.s;
    for (const ev of s.def.events) {
      const key = `${ev.kind}@${ev.at}`;
      if (this.eventsDone.has(key) || s.t < ev.at) continue;
      if (ev.kind === 'maintenance') {
        // Never interrupt an engagement: wait until no entry is engaged.
        if (this.activeEntryCount() > 0 || s.phase !== 'RUNNING') continue;
        this.eventsDone.add(key);
        s.beginMaintenance(ev.task);
      } else if (ev.kind === 'foreshadow') {
        this.eventsDone.add(key);
        s.startForeshadow(ev);
      } else if (ev.kind === 'finale') {
        this.eventsDone.add(key);
        s.startFinale();
      }
    }
  }
}
