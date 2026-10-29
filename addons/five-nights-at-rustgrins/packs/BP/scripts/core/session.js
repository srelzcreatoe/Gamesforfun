// NightSession: one night, 12 AM to 6 AM. Pure simulation (no @minecraft
// imports) so tools/sim can run thousands of nights in Node.
//
// The game layer calls tick() once per game tick and input(action, arg) for
// every player action, then drains `fx` (effects: sounds, puppet moves, door
// and light changes, jumpscares...) and renders them in the world.

import { CONFIG, CAST, nightDef } from './config.js';
import { Rng } from './rng.js';
import { CAMERAS, CAMERA_BY_ID, CAMERA_ORDER } from '../data/cameras.js';
import { DoorStalker } from './ai/door_stalker.js';
import { Rustgrin } from './ai/rustgrin.js';
import { Cat } from './ai/cat.js';
import { PurpleRat } from './ai/purple_rat.js';
import { TopHatRat } from './ai/top_hat_rat.js';
import { ShowTape } from './show_tape.js';

const AI_CLASSES = { mirehop: DoorStalker, noxbriar: DoorStalker, rustgrin: Rustgrin, cat: Cat, purple_rat: PurpleRat, top_hat_rat: TopHatRat };

export class NightSession {
  /**
   * @param {number} night 0..7
   * @param {{ seed?: number, ai?: Record<string, number>, ticksPerHour?: number, label?: string }} [opts]
   */
  constructor(night, opts = {}) {
    this.night = night;
    this.def = nightDef(night, { ai: opts.ai, ticksPerHour: opts.ticksPerHour });
    this.cfg = CONFIG;
    this.rng = new Rng(opts.seed ?? ((Date.now() ^ (night * 7919)) >>> 0));
    this.t = 0;
    this.ticksPerHour = this.def.ticksPerHour;
    this.hour = 0;
    /** @type {number} */
    this.power = CONFIG.power.start;
    this.fx = [];
    this.result = null; // 'win' | 'lose' | 'takeover' (night 5 at 4 AM: the Ringmaster takes the night)
    this.killer = null;
    this.inputs = 0; // successful guard actions (the Final Act's "touch nothing" game counts them)
    this.devices = {
      doorL: false, doorR: false, lightL: false, lightR: false, ventL: false, ventR: false,
      cams: { open: false, cam: '1A' },
      broken: { L: false, R: false, VL: false, VR: false },
    };
    this.debounce = Object.create(null);
    this.camStatic = Object.create(null); // camId -> until tick
    this.powerOut = null; // { stage, until }
    this.rusted = null; // { until }
    this.nextHallucination = 400;
    this.phoneMuted = false;
    this.tape = new ShowTape(this);
    this.chars = {};
    for (const id of CAST) this.chars[id] = new AI_CLASSES[id](this, id);
  }

  emit(e) {
    this.fx.push(e);
  }

  /** Effects produced since the last drain. */
  drain() {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  // ------------------------------------------------------------ queries used by the AIs
  doorClosed(side) {
    return side === 'L' ? this.devices.doorL : this.devices.doorR;
  }

  ventClosed(side) {
    return side === 'L' ? this.devices.ventL : this.devices.ventR;
  }

  /** Is another animatronic already standing at that side's door? */
  occupiedDoor(side, except) {
    return Object.values(this.chars).some((c) => c.id !== except && (c.node === (side === 'L' ? 'DOOR_L' : 'WIN_R') || (c.walk && c.walk.to === (side === 'L' ? 'DOOR_L' : 'WIN_R'))));
  }

  camWorking(camId) {
    const cam = CAMERA_BY_ID[camId];
    if (!cam || cam.audioOnly) return false;
    return !(this.camStatic[camId] > this.t);
  }

  isWatchingNode(node) {
    const c = this.devices.cams;
    if (!c.open || this.powerOut) return false;
    const cam = CAMERA_BY_ID[c.cam];
    return !!cam && cam.sees.includes(node) && this.camWorking(c.cam);
  }

  /** Static on these cameras for `ticks`, starting `delay` ticks from now. */
  staticOn(cams, ticks, delay = 0) {
    for (const id of cams) this.camStatic[id] = Math.max(this.camStatic[id] ?? 0, this.t + delay + ticks);
  }

  drainPower(units) {
    this.power = Math.max(0, this.power - units);
  }

  /** An animatronic got past a door/vent: that side's controls die. */
  breach(side, who, forced = false) {
    this.devices.broken[side] = true;
    if (side === 'L' || side === 'R') {
      if (forced && this.doorClosed(side)) this.setDoor(side, false, true);
      this.emit({ fx: 'breach', side, who });
    } else {
      this.emit({ fx: 'breach', side, who });
    }
  }

  kill(who) {
    if (this.result) return;
    this.result = 'lose';
    this.killer = who;
    this.closeCams('jumpscare');
    this.emit({ fx: 'jumpscare', who });
  }

  // ------------------------------------------------------------ devices
  usage() {
    const d = this.devices;
    if (this.powerOut) return 0;
    return 1 + (d.doorL ? 1 : 0) + (d.doorR ? 1 : 0) + (d.lightL ? 1 : 0) + (d.lightR ? 1 : 0) + (d.cams.open ? 1 : 0) + (d.ventL ? 1 : 0) + (d.ventR ? 1 : 0);
  }

  debounced(key, ticks) {
    if ((this.debounce[key] ?? -1e9) > this.t) return true;
    this.debounce[key] = this.t + ticks;
    return false;
  }

  setDoor(side, closed, force = false) {
    const k = side === 'L' ? 'doorL' : 'doorR';
    if (this.devices[k] === closed) return;
    this.devices[k] = closed;
    this.emit({ fx: 'door', side, closed, forced: force });
  }

  setLight(side, on) {
    const k = side === 'L' ? 'lightL' : 'lightR';
    if (this.devices[k] === on) return;
    this.devices[k] = on;
    this.emit({ fx: 'light', side, on });
  }

  setVent(side, closed) {
    const k = side === 'L' ? 'ventL' : 'ventR';
    if (this.devices[k] === closed) return;
    this.devices[k] = closed;
    this.emit({ fx: 'vent', side, closed });
  }

  openCams(camId) {
    const c = this.devices.cams;
    if (c.open) return;
    c.open = true;
    if (camId && CAMERA_BY_ID[camId]) c.cam = camId;
    // FNAF 1: raising the monitor turns the hall lights off
    this.setLight('L', false);
    this.setLight('R', false);
    this.emit({ fx: 'cams', open: true, cam: c.cam, reason: 'open' });
    if (this.rusted) {
      this.rusted = null;
      this.emit({ fx: 'rusted', on: false });
    }
  }

  closeCams(reason = 'close') {
    const c = this.devices.cams;
    if (!c.open) return;
    c.open = false;
    this.emit({ fx: 'cams', open: false, cam: c.cam, reason });
    if (reason === 'close' && !this.result && !this.powerOut && this.night >= CONFIG.rusted.fromNight && !this.rusted && this.rng.chance(CONFIG.rusted.chance)) {
      this.rusted = { until: this.t + CONFIG.rusted.window };
      this.emit({ fx: 'rusted', on: true });
    }
  }

  selectCam(camId) {
    const c = this.devices.cams;
    if (!CAMERA_BY_ID[camId] || c.cam === camId) return false;
    c.cam = camId;
    this.emit({ fx: 'cams', open: c.open, cam: camId, reason: 'switch' });
    return true;
  }

  /** Night 6: the band and the troupe only move on the Ringmaster's cue. */
  get final() {
    return !!this.def.final;
  }

  /**
   * Player actions. Returns { ok, reason? } so the UI can give feedback.
   * Actions: door_l, door_r, light_l, light_r, vent_l, vent_r, cams_toggle,
   * cams_open, cams_close, cam_select(id), cam_next, cam_prev, wind, spotlight, mute_call.
   */
  input(action, arg) {
    if (this.result) return { ok: false, reason: 'over' };
    const res = this.doAction(action, arg);
    if (res?.ok && action !== 'mute_call') this.inputs++;
    return res;
  }

  doAction(action, arg) {
    const d = this.devices;
    const dev = CONFIG.devices;
    const dead = (why) => {
      this.emit({ fx: 'sound', id: 'fnar.door.error', at: 'office', vol: 0.8 });
      return { ok: false, reason: why };
    };
    switch (action) {
      case 'door_l':
      case 'door_r': {
        const side = action === 'door_l' ? 'L' : 'R';
        if (this.powerOut) return dead('power');
        if (d.broken[side]) return dead('broken');
        if (this.debounced(action, dev.doorDebounce)) return { ok: false, reason: 'debounce' };
        this.setDoor(side, !this.doorClosed(side));
        return { ok: true };
      }
      case 'light_l':
      case 'light_r': {
        const side = action === 'light_l' ? 'L' : 'R';
        if (this.powerOut) return dead('power');
        if (d.broken[side]) return dead('broken');
        if (this.debounced(action, dev.lightDebounce)) return { ok: false, reason: 'debounce' };
        const on = !(side === 'L' ? d.lightL : d.lightR);
        if (on) this.setLight(side === 'L' ? 'R' : 'L', false); // one hall light at a time
        this.setLight(side, on);
        return { ok: true };
      }
      case 'vent_l':
      case 'vent_r': {
        const side = action === 'vent_l' ? 'L' : 'R';
        if (this.powerOut) return dead('power');
        if (d.broken['V' + side]) return dead('broken');
        if (this.debounced(action, dev.ventDebounce)) return { ok: false, reason: 'debounce' };
        this.setVent(side, !this.ventClosed(side));
        return { ok: true };
      }
      case 'cams_toggle':
        return this.doAction(d.cams.open ? 'cams_close' : 'cams_open', arg);
      case 'cams_open':
        if (this.powerOut) return dead('power');
        if (this.debounced('cams', dev.camDebounce)) return { ok: false, reason: 'debounce' };
        this.openCams(arg);
        return { ok: true };
      case 'cams_close':
        if (this.debounced('cams', dev.camDebounce)) return { ok: false, reason: 'debounce' };
        this.closeCams('close');
        return { ok: true };
      case 'cam_select':
        if (!d.cams.open) return { ok: false, reason: 'closed' };
        if (this.debounced('cam_switch', dev.camSwitchDebounce)) return { ok: false, reason: 'debounce' };
        return { ok: this.selectCam(arg) };
      case 'cam_next':
      case 'cam_prev': {
        if (!d.cams.open) return { ok: false, reason: 'closed' };
        if (this.debounced('cam_switch', dev.camSwitchDebounce)) return { ok: false, reason: 'debounce' };
        const i = CAMERA_ORDER.indexOf(d.cams.cam);
        const n = CAMERA_ORDER.length;
        return { ok: this.selectCam(CAMERA_ORDER[(i + (action === 'cam_next' ? 1 : n - 1)) % n]) };
      }
      case 'wind': {
        if (!this.tape.enabled) return { ok: false, reason: 'no_tape' };
        if (!d.cams.open || d.cams.cam !== '8') return { ok: false, reason: 'not_cam8' };
        const ok = this.tape.wind();
        return { ok, reason: ok ? undefined : 'cooldown' };
      }
      case 'spotlight':
        if (this.powerOut) return dead('power');
        return this.chars.top_hat_rat.spotlight();
      case 'mute_call':
        if (this.phoneMuted) return { ok: false };
        this.phoneMuted = true;
        this.emit({ fx: 'phone', muted: true });
        return { ok: true };
      default:
        return { ok: false, reason: 'unknown' };
    }
  }

  // ------------------------------------------------------------ the tick
  tick() {
    if (this.result) return;
    this.t++;
    if (this.t === 1) {
      this.emit({ fx: 'start', night: this.night, title: this.def.title, final: this.final });
      if (this.def.phone) this.emit({ fx: 'phone', night: this.def.phone });
      if (this.final) this.emit({ fx: 'pa', key: 'intro' });
      const music = this.tape.enabled;
      for (const c of Object.values(this.chars)) {
        // the band stands posed on its stage, the troupe dances while its music plays,
        // the Ringmaster waits in his booth (and conducts on his own night)
        let pose = 'pose';
        if (c.id === 'cat' || c.id === 'purple_rat') pose = music ? 'perform' : 'pose';
        if (c.id === 'top_hat_rat') pose = this.final ? 'perform' : 'pose';
        this.emit({ fx: 'place', who: c.id, node: c.node, pose, initial: true });
      }
      if (music) this.emit({ fx: 'show_music', slow: false });
    }
    // clock
    const hour = Math.min(6, Math.floor(this.t / this.ticksPerHour));
    if (hour !== this.hour) {
      this.hour = hour;
      this.emit({ fx: 'hour', hour });
      if (this.night === 5 && hour >= CONFIG.finale.takeoverHour) {
        // the fake ending, then the Ringmaster takes the night: the Final Act starts at once
        this.result = 'takeover';
        this.closeCams('takeover');
        this.emit({ fx: 'takeover' });
        return;
      }
      if (hour >= 6) {
        this.result = 'win';
        this.closeCams('win');
        this.emit({ fx: 'win', night: this.night });
        return;
      }
    }
    if (this.powerOut) {
      this.tickPowerOut();
      return;
    }
    // power
    const p = CONFIG.power;
    const d = this.devices;
    const base = p.base[this.night] ?? 3;
    const whole = Math.floor(base);
    const frac = base - whole;
    let drain = whole + (frac > 0 && (this.t % Math.round(1 / frac)) === 0 ? 1 : 0);
    drain += (d.doorL ? p.door : 0) + (d.doorR ? p.door : 0) + (d.lightL ? p.light : 0) + (d.lightR ? p.light : 0) + (d.cams.open ? p.cams : 0) + (d.ventL ? p.vent : 0) + (d.ventR ? p.vent : 0);
    this.drainPower(drain);
    if (this.power <= 0) {
      this.startPowerOut();
      return;
    }
    // animatronics (on the Final Act only the Ringmaster thinks; he moves the others)
    this.tape.tick();
    for (const c of Object.values(this.chars)) {
      if (this.final && c.id !== 'top_hat_rat') continue;
      c.tick();
      if (this.result) return;
    }
    // the rusted one
    if (this.rusted && this.t >= this.rusted.until) {
      this.rusted = null;
      this.kill('rusted');
      return;
    }
    // hallucinations
    const hp = this.def.hallucinations ?? 0;
    if (hp > 0 && this.t >= this.nextHallucination && this.rng.chance(hp)) {
      this.nextHallucination = this.t + CONFIG.hallucination.cooldown;
      this.emit({ fx: 'hallucination', kind: this.rng.pick(['showtime', 'whisper', 'poster', 'face', 'eyes']) });
    }
  }

  startPowerOut() {
    const rng = this.rng;
    this.power = 0;
    this.closeCams('power');
    this.setDoor('L', false);
    this.setDoor('R', false);
    this.setLight('L', false);
    this.setLight('R', false);
    this.setVent('L', false);
    this.setVent('R', false);
    this.powerOut = { stage: 'dark', until: this.t + CONFIG.powerOut.songDelay(rng) };
    for (const c of Object.values(this.chars)) this.emit({ fx: 'hide', who: c.id });
    this.emit({ fx: 'power_out', stage: 'down' });
  }

  tickPowerOut() {
    const po = this.powerOut;
    if (this.t < po.until) return;
    const rng = this.rng;
    if (po.stage === 'dark') {
      po.stage = 'song';
      po.until = this.t + CONFIG.powerOut.songLength(rng);
      this.emit({ fx: 'power_out', stage: 'song' });
    } else if (po.stage === 'song') {
      po.stage = 'black';
      po.until = this.t + CONFIG.powerOut.darkLength(rng);
      this.emit({ fx: 'power_out', stage: 'black' });
    } else if (po.stage === 'black') {
      this.kill('rustgrin');
    }
  }

  // ------------------------------------------------------------ views
  snapshot() {
    const d = this.devices;
    const rm = this.chars.top_hat_rat;
    const ev = rm.event;
    return {
      night: this.night,
      title: this.def.title,
      hour: this.hour,
      t: this.t,
      powerPct: Math.ceil(this.power / 1000),
      usage: this.usage(),
      devices: { doorL: d.doorL, doorR: d.doorR, lightL: d.lightL, lightR: d.lightR, ventL: d.ventL, ventR: d.ventR, camsOpen: d.cams.open, cam: d.cams.cam, broken: { ...d.broken } },
      tape: this.tape.enabled ? { pct: this.tape.pct, level: this.tape.quarter(), stopped: this.tape.stopped } : null,
      catStage: this.chars.cat.stage,
      final: this.final,
      act: rm.act,
      ringmaster: rm.enabled ? { state: rm.state, out: rm.out, node: rm.node } : null,
      spotlight: rm.enabled && rm.out,
      event: ev ? { kind: ev.kind, game: ev.game ?? null, who: ev.who ?? null, cam: ev.cam ?? null, side: ev.side ?? null, guard: ev.guard ?? null, left: Math.max(0, Math.ceil((ev.deadline - this.t) / 20)) } : null,
      powerOut: this.powerOut ? this.powerOut.stage : null,
      camStatic: d.cams.open && !this.camWorking(d.cams.cam) && !CAMERA_BY_ID[d.cams.cam]?.audioOnly,
      result: this.result,
      killer: this.killer,
    };
  }

  debugLine() {
    return Object.values(this.chars).filter((c) => c.baseAi > 0).map((c) => c.debug()).join(' | ');
  }
}

export { CAMERAS };
