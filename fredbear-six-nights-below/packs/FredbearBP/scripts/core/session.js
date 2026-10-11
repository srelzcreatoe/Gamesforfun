// NightSession - the single authority for one night.
//
// OWNERSHIP: the night clock, power, every office device, the AI and attack
// arbitration live here and nowhere else. The Minecraft adapter only feeds
// player inputs in and applies the effects (fx) that come out. Command blocks
// never advance the clock, charge power or trigger attacks.
//
// PHASES: RUNNING | MAINT | POWER_OUT | JUMPSCARE | WON | LOST
//
// SEALS: seal_vent / seal_shaft close the supply duct (gate vent_seal) or the
// crawlspace into the office subfloor (gate shaft_seal) for CONFIG.seals.duration
// ticks; walkers mid-duct turn back (Animatronic.stepMove), teleports still work.
//
// MODIFIERS (options.mods, challenge modes): noDoors (doors and hatch welded
// open; a lit hall light counts as that side's barrier), strobeNoBarrier,
// deviceDrainMult, reserveAmount, noCams, loudSteps, lightAutoOff, captions.
//
// PER-TICK ORDER (defines priority of simultaneous events):
//   1. WON/LOST: nothing.  JUMPSCARE: count down to LOST (clock frozen).
//   2. queued player inputs (debounced)
//   3. clock +1; reaching 6 AM commits WON immediately - before power and AI -
//      so an attack that has not already started on an earlier tick can never
//      beat 6 AM. An attack that started earlier (phase JUMPSCARE) stops the
//      clock, so it is never overturned by 6 AM either.
//   4. power drain (may enter POWER_OUT)
//   5. director memory + scheduled events (may enter MAINT)
//   6. device timers, then AI in fixed order: Fredbear, Freddy, Bonnie, Chica,
//      Morgrave, Valek.

import { CONFIG, nightDef } from './config.js';
import { Rng, mixSeed } from './rng.js';
import { Director } from './director.js';
import { Occupancy } from './ai/base.js';
import { Bonnie } from './ai/bonnie.js';
import { Chica } from './ai/chica.js';
import { Freddy } from './ai/freddy.js';
import { Fredbear } from './ai/fredbear.js';
import { Morgrave } from './ai/morgrave.js';
import { Valek } from './ai/valek.js';
import { CAMERA_ORDER, CAMERA_BY_ID } from '../data/cameras.js';
import { ENTRY_BARRIER, NODE_BY_ID } from '../data/nodes.js';

export const ORDER = Object.freeze(['fredbear', 'freddy', 'bonnie', 'chica', 'morgrave', 'valek']);
const ENTRY_LABEL = Object.freeze({ L: 'LEFT DOOR', R: 'RIGHT DOOR', H: 'HATCH' });

export class NightSession {
  /**
   * @param {object} p
   * @param {number} p.night 0..9 (0 = training / test slice)
   * @param {number} [p.seed]
   * @param {object} [p.overrides] night definition overrides (debug/tests/challenges)
   * @param {object} [p.options] { noDeath, captions, taskBonusPower, bonusCharges, mods }
   */
  constructor({ night, seed = 1, overrides = {}, options = {} }) {
    this.night = night;
    this.def = nightDef(night, overrides);
    this.tph = this.def.ticksPerHour;
    this.length = this.tph * CONFIG.clock.hours;
    this.options = { noDeath: false, captions: true, ...options };
    this.mods = Object.freeze({ ...(options.mods ?? {}) });
    if (this.mods.captions) this.options.captions = true;
    this.seed = seed >>> 0;
    this.rng = new Rng(mixSeed(this.seed, night + 1));
    this.shadowRng = new Rng(mixSeed(this.seed, 7700 + night)); // separate stream: rare events never shift the AI rolls
    this.t = 0;
    this.phase = 'RUNNING';
    this.fx = [];
    this.log = [];
    this.stats = { drain: 0, doorTicks: 0, lightTicks: 0, camTicks: 0, hatchTicks: 0, repels: 0, holds: 0, strobes: 0, attacks: [], sabotage: 0, inputs: 0, shadows: 0 };
    const P = CONFIG.power;
    this.power = P.start + (this.options.taskBonusPower ? P.taskBonus : 0);
    this.devices = {
      doorL: false, doorR: false, lightL: false, lightR: false, hatch: false,
      cams: { open: false, cam: 'C01' },
      deb: Object.create(null), lightTimer: { L: 0, R: 0 },
    };
    const fbPhase = this.def.fredbear?.phase ?? 0;
    this.strobe = { installed: fbPhase >= 1 || night === 0, charges: (this.def.strobeCharges ?? 0) + (this.options.bonusCharges ?? 0), cooldown: 0 };
    this.hatchInstalled = fbPhase >= 1 || !!this.def.hatch;
    this.breaker = { tripped: false, resetting: 0 };
    this.sabotageCount = 0;
    this.nextSabotageTick = 0;
    this.blackout = { stage: 'none', timer: 0, duration: 0 };
    this.disrupt = { left: 0 };
    this.echo = null;
    this.foreshadow = null;
    this.jammed = { L: false, R: false, H: false };
    this.jamTimer = { L: 0, R: 0, H: 0 };
    this.held = { L: false, R: false, H: false }; // a door / the hatch already held Fredbear off tonight
    const openBelow = fbPhase >= 1 || !!this.def.basementOpen;
    // gates[g] === true means OPEN. vent_seal / shaft_seal close while the player seals them (docs/04 "Seals").
    this.gates = { diner_seal: openBelow, chamber_wall: openBelow, vent_seal: true, shaft_seal: true };
    this.seals = { vent: { left: 0, cooldown: 0 }, shaft: { left: 0, cooldown: 0 } };
    this.reserveUsed = false;
    this.powerOut = null;
    this.jumpscare = null;
    this.maint = null;
    this.finale = false;
    this.aiBonus = Object.create(null);
    this.occupancy = new Occupancy();
    this.director = new Director(this);
    this.order = ORDER;
    this.anim = {
      fredbear: new Fredbear(this),
      freddy: new Freddy(this),
      bonnie: new Bonnie(this),
      chica: new Chica(this),
      morgrave: new Morgrave(this),
      valek: new Valek(this),
    };
    this.queue = [];
    this.view = { inOffice: true };
    this.lastHour = 0;
    this.emit({ fx: 'night_start', night, gates: { ...this.gates }, power: this.power });
  }

  // ------------------------------------------------------------ basics
  get hour() {
    return Math.min(CONFIG.clock.hours - 1, Math.floor(this.t / this.tph));
  }

  emit(e) {
    this.fx.push(e);
  }

  caption(text, who) {
    if (this.options.captions) this.emit({ fx: 'caption', text, who });
  }

  logTransition(who, from, to, reason) {
    this.log.push({ t: this.t, who, from, to, reason });
    if (this.log.length > 4000) this.log.shift();
  }

  gateOpen(g) {
    return !!this.gates[g];
  }

  barrierClosed(entry) {
    const b = ENTRY_BARRIER[entry];
    if (this.mods.noDoors) {
      // Doors welded open: a lit hall light is the only defence on that side.
      if (b === 'door_l') return this.devices.lightL;
      if (b === 'door_r') return this.devices.lightR;
      return false;
    }
    if (b === 'door_l') return this.devices.doorL;
    if (b === 'door_r') return this.devices.doorR;
    return this.devices.hatch;
  }

  /** Who runs the power-out sequence: Fredbear on nights he is awake, Freddy otherwise. */
  get powerOutAttacker() {
    return (this.def.fredbear?.phase ?? 0) >= 1 ? 'fredbear' : 'freddy';
  }

  usage() {
    const d = this.devices;
    const n = (d.doorL ? 1 : 0) + (d.doorR ? 1 : 0) + (d.lightL ? 1 : 0) + (d.lightR ? 1 : 0) + (d.cams.open ? 1 : 0) + (d.hatch ? 1 : 0);
    return Math.min(5, 1 + n);
  }

  drainPerTick() {
    const P = CONFIG.power;
    const d = this.devices;
    let used = 0;
    if (d.doorL) used += P.door;
    if (d.doorR) used += P.door;
    if (d.lightL) used += P.light;
    if (d.lightR) used += P.light;
    if (d.cams.open) used += P.cams;
    if (d.hatch) used += P.hatch;
    return (P.baseDrain[this.night] ?? 4) + used * (this.mods.deviceDrainMult ?? 1);
  }

  /** Queue a player action (applied at the start of the next tick). */
  input(action, arg) {
    this.queue.push({ action, arg });
  }

  // ------------------------------------------------------------ tick
  tick() {
    const flush = () => {
      const f = this.fx;
      this.fx = [];
      return f;
    };
    if (this.phase === 'WON' || this.phase === 'LOST') return flush();
    if (this.phase === 'JUMPSCARE') {
      if (--this.jumpscare.timer <= 0) {
        this.phase = 'LOST';
        this.emit({ fx: 'lose', who: this.jumpscare.who, night: this.night, t: this.t });
      }
      return flush();
    }
    this.processInputs();
    if (this.phase === 'MAINT') return flush();

    this.t++;
    const h = this.hour;
    if (h !== this.lastHour) {
      this.lastHour = h;
      this.emit({ fx: 'hour', hour: h });
      if (this.phase === 'RUNNING') this.maybeShadow(h);
    }
    if (this.t >= this.length) {
      this.win();
      return flush();
    }

    if (this.phase === 'RUNNING') this.tickPower();
    if (this.phase === 'POWER_OUT') {
      this.tickPowerOut();
      return flush();
    }

    this.director.tickMemory();
    this.director.tickEvents();
    if (this.phase !== 'RUNNING') return flush();

    this.tickDevices();
    for (const id of ORDER) {
      this.anim[id].tick();
      if (this.phase !== 'RUNNING') break;
    }
    return flush();
  }

  // ------------------------------------------------------------ power
  tickPower() {
    const d = this.devices;
    if (d.doorL || d.doorR) this.stats.doorTicks++;
    if (d.lightL || d.lightR) this.stats.lightTicks++;
    if (d.cams.open) this.stats.camTicks++;
    if (d.hatch) this.stats.hatchTicks++;
    const drain = this.drainPerTick();
    this.power -= drain;
    this.stats.drain += drain;
    if (this.power <= 0) {
      this.power = 0;
      this.startPowerOut();
    }
  }

  spend(units) {
    this.power = Math.max(0, this.power - units);
    this.stats.drain += units;
    if (this.power === 0 && this.phase === 'RUNNING') this.startPowerOut();
  }

  forceDevicesOff(reason) {
    const d = this.devices;
    if (d.doorL) this.setDoor('L', false);
    if (d.doorR) this.setDoor('R', false);
    if (d.lightL) this.setLight('L', false);
    if (d.lightR) this.setLight('R', false);
    if (d.hatch) this.setHatch(false);
    if (d.cams.open) this.setCams(false, d.cams.cam, reason);
  }

  startPowerOut() {
    this.phase = 'POWER_OUT';
    this.forceDevicesOff('power');
    for (const k of ['vent', 'shaft']) this.unseal(k);
    for (const e of ['L', 'R', 'H']) this.unjam(e);
    this.cancelFredbearEffects();
    this.emit({ fx: 'actuate', id: 'pwr.out' });
    this.emit({ fx: 'power_out', stage: 'down' });
    this.logTransition('session', 'RUNNING', 'POWER_OUT', 'power reached 0');
    if (this.def.reserve && !this.reserveUsed) {
      this.powerOut = { stage: 'reserve', timer: CONFIG.power.reserveWindow };
      this.emit({ fx: 'power_out', stage: 'reserve' });
      this.caption('POWER OUT — pull the EMERGENCY RESERVE lever!', 'session');
    } else {
      this.beginPowerOutMusic();
    }
  }

  /** Power-out sequence: a music box and eyes at the left door, darkness, then the attack (6 AM still wins). */
  beginPowerOutMusic() {
    const who = this.powerOutAttacker;
    const music = 100 * this.rng.int(1, 4);
    const dark = this.rng.int(40, 80);
    this.powerOut = { stage: 'music', timer: music, dark, who };
    this.anim[who].startPowerOut(music, dark);
    const n = NODE_BY_ID.W_DOOR;
    this.emit({ fx: 'sound', id: `fb.${who}.musicbox`, at: { x: n.x, y: 1.5, z: n.z }, vol: 1.0, loopKey: 'powerout_music' });
    this.emit({ fx: 'power_out', stage: 'music', who });
    this.caption(who === 'fredbear' ? 'A music box plays at the LEFT DOOR… golden eyes in the dark' : 'A music box plays at the LEFT DOOR…', who);
  }

  tickPowerOut() {
    const po = this.powerOut;
    if (!po) return;
    po.timer--;
    if (po.stage === 'reserve') {
      if (po.timer <= 0) this.beginPowerOutMusic();
      return;
    }
    const a = this.anim[po.who];
    if (po.stage === 'music' && po.timer <= 0) {
      po.stage = 'dark';
      po.timer = po.dark;
      a.eyes = false;
      this.emit({ fx: 'stop_loop', loopKey: 'powerout_music' });
      this.emit({ fx: 'actuate', id: 'pwr.dark' });
      this.emit({ fx: 'power_out', stage: 'dark', who: po.who });
      return;
    }
    if (po.stage === 'dark' && po.timer <= 0 && this.director.requestAttack(po.who)) {
      a.anim = 'attack';
      a.setState('ATTACK', 'power-out sequence complete');
      this.beginJumpscare(po.who);
    }
  }

  get reserveAmount() {
    return this.mods.reserveAmount ?? CONFIG.power.reserveAmount;
  }

  engageReserve() {
    this.reserveUsed = true;
    this.power = this.reserveAmount;
    this.powerOut = null;
    this.phase = 'RUNNING';
    this.emit({ fx: 'actuate', id: 'pwr.reserve' });
    this.emit({ fx: 'power_out', stage: 'restored' });
    this.logTransition('session', 'POWER_OUT', 'RUNNING', 'emergency reserve engaged');
    this.caption(`Emergency reserve engaged: ${Math.round(this.reserveAmount / CONFIG.power.unitsPerPercent)}% power`, 'session');
  }

  // ------------------------------------------------------------ devices
  setDoor(side, closed) {
    const key = side === 'L' ? 'doorL' : 'doorR';
    this.devices[key] = closed;
    this.emit({ fx: 'actuate', id: `door_${side.toLowerCase()}_${closed ? 'close' : 'open'}` });
    this.emit({ fx: 'device', device: key, value: closed });
  }

  setLight(side, on) {
    const key = side === 'L' ? 'lightL' : 'lightR';
    this.devices[key] = on;
    this.devices.lightTimer[side] = on ? this.mods.lightAutoOff ?? CONFIG.devices.lightAutoOff : 0;
    this.emit({ fx: 'actuate', id: `light_${side.toLowerCase()}_${on ? 'on' : 'off'}` });
    this.emit({ fx: 'device', device: key, value: on });
  }

  setHatch(closed) {
    this.devices.hatch = closed;
    this.emit({ fx: 'actuate', id: `hatch_${closed ? 'close' : 'open'}` });
    this.emit({ fx: 'device', device: 'hatch', value: closed });
  }

  setCams(open, cam, reason = '') {
    const c = this.devices.cams;
    c.open = open;
    if (cam) c.cam = cam;
    this.emit({ fx: 'cams', open, cam: c.cam, reason });
  }

  feedback(action, ok, reason = '') {
    this.emit({ fx: 'feedback', action, ok, reason });
    return ok;
  }

  processInputs() {
    while (this.queue.length) {
      const { action, arg } = this.queue.shift();
      this.stats.inputs++;
      this.handleInput(action, arg);
    }
  }

  debounced(key, ticks) {
    const until = this.devices.deb[key] ?? -1;
    if (this.t < until) return true;
    this.devices.deb[key] = this.t + ticks;
    return false;
  }

  handleInput(action, arg) {
    const D = CONFIG.devices;
    const P = CONFIG.power;
    const running = this.phase === 'RUNNING';
    switch (action) {
      case 'door_l':
      case 'door_r': {
        const side = action === 'door_r' ? 'R' : 'L';
        if (!running) return this.feedback(action, false, this.phase === 'POWER_OUT' ? 'no power' : 'unavailable');
        if (this.mods.noDoors) return this.feedback(action, false, 'welded open');
        if (this.jammed[side]) return this.feedback(action, false, 'jammed');
        if (this.debounced(action, D.doorDebounce)) return this.feedback(action, false, 'cooldown');
        const closed = !(side === 'L' ? this.devices.doorL : this.devices.doorR);
        this.setDoor(side, closed);
        this.director.noise('door', 2);
        if (closed) this.director.onDoorClosed(side);
        return this.feedback(action, true, closed ? 'closed' : 'opened');
      }
      case 'light_l':
      case 'light_r': {
        const side = action === 'light_r' ? 'R' : 'L';
        if (!running) return this.feedback(action, false, this.phase === 'POWER_OUT' ? 'no power' : 'unavailable');
        if (this.breaker.tripped) return this.feedback(action, false, 'breaker tripped');
        if (this.blackout.stage === 'on' || this.blackout.stage === 'warn') return this.feedback(action, false, 'blackout');
        if (this.debounced(action, D.lightDebounce)) return this.feedback(action, false, 'cooldown');
        const key = side === 'L' ? 'lightL' : 'lightR';
        const on = !this.devices[key];
        if (on) {
          const other = side === 'L' ? 'R' : 'L';
          if (this.devices[other === 'L' ? 'lightL' : 'lightR']) this.setLight(other, false);
        }
        this.setLight(side, on);
        this.director.noise('light', 1);
        return this.feedback(action, true, on ? 'on' : 'off');
      }
      case 'cams_toggle':
        return this.handleInput(this.devices.cams.open ? 'cams_close' : 'cams_open', arg);
      case 'cams_open':
      case 'cam_select': {
        const cam = arg && CAMERA_BY_ID[arg] ? arg : this.devices.cams.cam;
        if (!running) return this.feedback(action, false, this.phase === 'POWER_OUT' ? 'no power' : 'unavailable');
        if (this.mods.noCams) return this.feedback(action, false, 'no signal');
        if (this.blackout.stage === 'on') return this.feedback(action, false, 'blackout');
        if (!this.view.inOffice) return this.feedback(action, false, 'not in office');
        if (this.devices.cams.open) {
          if (cam === this.devices.cams.cam) return this.feedback(action, true, 'same camera');
          if (this.debounced('cam_switch', D.camSwitchDebounce)) return this.feedback(action, false, 'cooldown');
          this.setCams(true, cam, 'switch');
          return this.feedback(action, true, cam);
        }
        if (this.debounced('cams', D.camDebounce)) return this.feedback(action, false, 'cooldown');
        this.setCams(true, cam, 'open');
        this.director.noise('cams', 1);
        return this.feedback(action, true, cam);
      }
      case 'cams_close': {
        if (!this.devices.cams.open) return this.feedback(action, true, 'already closed');
        this.setCams(false, null, 'close');
        this.devices.deb.cams = this.t + D.camDebounce;
        return this.feedback(action, true, 'closed');
      }
      case 'cam_next':
      case 'cam_prev': {
        const i = CAMERA_ORDER.indexOf(this.devices.cams.cam);
        const n = CAMERA_ORDER.length;
        const next = CAMERA_ORDER[(i + (action === 'cam_next' ? 1 : n - 1)) % n];
        return this.handleInput('cam_select', next);
      }
      case 'strobe': {
        if (!this.strobe.installed) return this.feedback(action, false, 'not installed');
        if (!running) return this.feedback(action, false, this.phase === 'POWER_OUT' ? 'no power' : 'unavailable');
        if (this.strobe.charges <= 0) return this.feedback(action, false, 'no charges');
        if (this.strobe.cooldown > 0) return this.feedback(action, false, 'cooldown');
        this.strobe.charges--;
        this.strobe.cooldown = D.strobeCooldown;
        this.stats.strobes++;
        this.emit({ fx: 'actuate', id: 'pwr.strobe' });
        this.director.noise('strobe', 3);
        const result = this.anim.fredbear.onStrobe();
        if (result === 'repelled') this.stats.repels++;
        this.spend(P.strobeCost);
        return this.feedback(action, true, result);
      }
      case 'hatch': {
        if (!this.hatchInstalled) return this.feedback(action, false, 'welded shut');
        if (!running) return this.feedback(action, false, this.phase === 'POWER_OUT' ? 'no power' : 'unavailable');
        if (this.mods.noDoors) return this.feedback(action, false, 'welded open');
        if (this.jammed.H) return this.feedback(action, false, 'jammed');
        if (this.debounced('hatch', D.hatchDebounce)) return this.feedback(action, false, 'cooldown');
        const closed = !this.devices.hatch;
        this.setHatch(closed);
        this.director.noise('hatch', 2);
        if (closed) this.director.onDoorClosed('H');
        return this.feedback(action, true, closed ? 'sealed' : 'opened');
      }
      case 'breaker': {
        if (!running) return this.feedback(action, false, 'unavailable');
        if (!this.breaker.tripped) return this.feedback(action, false, 'breaker ok');
        if (this.breaker.resetting > 0) return this.feedback(action, false, 'resetting');
        this.breaker.resetting = D.breakerResetTicks;
        this.director.noise('breaker', 2);
        this.emit({ fx: 'actuate', id: 'pwr.breaker_reset' });
        this.spend(P.breakerResetCost);
        return this.feedback(action, true, 'resetting');
      }
      case 'seal_vent':
      case 'seal_shaft': {
        const k = action === 'seal_vent' ? 'vent' : 'shaft';
        if (k === 'shaft' && !this.hatchInstalled) return this.feedback(action, false, 'not installed');
        if (!running) return this.feedback(action, false, this.phase === 'POWER_OUT' ? 'no power' : 'unavailable');
        const sl = this.seals[k];
        if (sl.left > 0) return this.feedback(action, false, 'already sealed');
        if (sl.cooldown > 0) return this.feedback(action, false, 'cooldown');
        sl.left = CONFIG.seals.duration;
        this.gates[`${k}_seal`] = false;
        this.emit({ fx: 'actuate', id: `seal.${k}_close` });
        this.emit({ fx: 'device', device: `seal_${k}`, value: true });
        this.director.noise('seal', 2);
        this.spend(CONFIG.seals.cost);
        return this.feedback(action, true, 'sealed');
      }
      case 'reserve': {
        if (this.phase !== 'POWER_OUT' || this.powerOut?.stage !== 'reserve') return this.feedback(action, false, 'unavailable');
        this.engageReserve();
        return this.feedback(action, true, 'engaged');
      }
      default:
        return this.feedback(action, false, 'unknown action');
    }
  }

  tickDevices() {
    const d = this.devices;
    for (const side of ['L', 'R']) {
      const key = side === 'L' ? 'lightL' : 'lightR';
      if (d[key] && --d.lightTimer[side] <= 0) this.setLight(side, false);
    }
    if (this.breaker.resetting > 0 && --this.breaker.resetting === 0) {
      this.breaker.tripped = false;
      this.emit({ fx: 'actuate', id: 'pwr.breaker_ok' });
      this.caption('Hall lights restored', 'session');
    }
    if (this.strobe.cooldown > 0) this.strobe.cooldown--;
    for (const k of ['vent', 'shaft']) {
      const sl = this.seals[k];
      if (sl.left > 0 && --sl.left === 0) this.unseal(k);
      else if (sl.cooldown > 0) sl.cooldown--;
    }
    if (this.disrupt.left > 0 && --this.disrupt.left === 0) this.emit({ fx: 'disrupt', on: false });
    if (this.echo?.kind === 'shadow') this.tickShadow();
    if (this.echo && --this.echo.left <= 0) {
      this.emit({ fx: 'echo', on: false, cam: this.echo.cam, node: this.echo.node, kind: this.echo.kind });
      this.echo = null;
    }
    this.tickForeshadow();
    this.tickBlackout();
    for (const e of ['L', 'R', 'H']) {
      if (this.jammed[e] && --this.jamTimer[e] <= 0) this.unjam(e);
    }
  }

  unseal(k) {
    const sl = this.seals[k];
    if (this.gates[`${k}_seal`]) return;
    sl.left = 0;
    sl.cooldown = CONFIG.seals.cooldown;
    this.gates[`${k}_seal`] = true;
    this.emit({ fx: 'actuate', id: `seal.${k}_open` });
    this.emit({ fx: 'device', device: `seal_${k}`, value: false });
  }

  // ------------------------------------------------------------ Chica sabotage
  tripBreaker(by) {
    this.breaker.tripped = true;
    this.breaker.resetting = 0;
    this.sabotageCount++;
    this.stats.sabotage++;
    this.nextSabotageTick = this.t + CONFIG.characters.chica.sabotageCooldown;
    if (this.devices.lightL) this.setLight('L', false);
    if (this.devices.lightR) this.setLight('R', false);
    this.emit({ fx: 'actuate', id: 'pwr.breaker_trip' });
    this.logTransition(by, 'SABOTAGE', 'SABOTAGE', 'hall-light breaker tripped');
    this.caption('Hall lights OFFLINE — press RESET BREAKER', by);
  }

  // ------------------------------------------------------------ Fredbear effects
  startDisrupt(duration) {
    this.disrupt.left = duration;
    this.emit({ fx: 'disrupt', on: true, duration });
    this.emit({ fx: 'sound', id: 'fb.fredbear.glitch', at: 'office', vol: 0.8 });
    this.caption('Camera signal interference', 'fredbear');
  }

  startEcho(cam, node, duration, kind) {
    this.echo = { cam, node, left: duration, kind, stare: 0 };
    this.emit({ fx: 'echo', on: true, cam, node, kind });
  }

  // ------------------------------------------------------------ shadow Fredbear
  /** Rare silhouette on the show stage: rolled once per hour from 1 AM (own RNG stream). */
  maybeShadow(hour) {
    const S = CONFIG.shadow;
    if (hour < 1 || this.night < S.fromNight || this.options.noDeath || this.echo || this.finale) return;
    if (!this.shadowRng.chance(S.chancePerHour)) return;
    this.stats.shadows++;
    this.startEcho('C01', S.node, S.holdTicks, 'shadow');
    this.logTransition('session', 'SHADOW', 'SHADOW', `silhouette on the stage at ${S.node}`);
  }

  /** Staring at the silhouette (any feed that shows its node) costs power and makes it vanish. */
  tickShadow() {
    const S = CONFIG.shadow;
    const c = this.devices.cams;
    const cam = c.open && this.disrupt.left === 0 ? CAMERA_BY_ID[c.cam] : null;
    if (!cam || !cam.sees.includes(this.echo.node)) return;
    if (++this.echo.stare < S.stareTicks) return;
    this.spend(S.drain);
    this.emit({ fx: 'sound', id: 'fb.fredbear.glitch', at: 'office', vol: 0.9 });
    this.caption('The shadow is gone… and so is some of your power.', 'session');
    this.echo.left = 1; // removed by tickDevices this tick
  }

  startForeshadow(ev) {
    this.foreshadow = { id: ev.id, cam: ev.cam, node: ev.node, until: this.t + ev.hold, shownLeft: null };
    this.logTransition('fredbear', 'FORESHADOW', 'FORESHADOW', `${ev.id} armed on ${ev.cam}`);
  }

  foreshadowActive(cam) {
    return !!this.foreshadow && this.foreshadow.cam === cam && this.foreshadow.shownLeft > 0;
  }

  tickForeshadow() {
    const f = this.foreshadow;
    if (!f) return;
    const c = this.devices.cams;
    if (f.shownLeft === null) {
      if (c.open && c.cam === f.cam && this.disrupt.left === 0) {
        f.shownLeft = 60;
        this.emit({ fx: 'echo', on: true, cam: f.cam, node: f.node, kind: 'foreshadow', id: f.id });
      } else if (this.t > f.until) {
        this.foreshadow = null;
      }
      return;
    }
    if (--f.shownLeft <= 0) {
      this.emit({ fx: 'echo', on: false, cam: f.cam, node: f.node, kind: 'foreshadow', id: f.id });
      this.foreshadow = null;
    }
  }

  startBlackout(warn, duration) {
    this.blackout = { stage: 'warn', timer: warn, duration };
    this.emit({ fx: 'blackout', stage: 'warn' });
    this.emit({ fx: 'sound', id: 'fb.power.whine', at: 'office', vol: 0.9 });
    this.caption('Electrical whine — the office lights are failing', 'fredbear');
  }

  tickBlackout() {
    const b = this.blackout;
    if (b.stage === 'none') return;
    if (--b.timer > 0) return;
    if (b.stage === 'warn') {
      b.stage = 'on';
      b.timer = b.duration;
      if (this.devices.lightL) this.setLight('L', false);
      if (this.devices.lightR) this.setLight('R', false);
      if (this.devices.cams.open) this.setCams(false, null, 'blackout');
      this.emit({ fx: 'actuate', id: 'sig.blackout_on' });
      this.emit({ fx: 'blackout', stage: 'on' });
    } else if (b.stage === 'on') {
      b.stage = 'grace';
      b.timer = CONFIG.director.blackoutGrace;
      this.emit({ fx: 'actuate', id: 'sig.blackout_off' });
      this.emit({ fx: 'blackout', stage: 'off' });
    } else {
      b.stage = 'none';
    }
  }

  cancelFredbearEffects() {
    if (this.disrupt.left > 0) {
      this.disrupt.left = 0;
      this.emit({ fx: 'disrupt', on: false });
    }
    if (this.echo) {
      this.emit({ fx: 'echo', on: false, cam: this.echo.cam, node: this.echo.node, kind: this.echo.kind });
      this.echo = null;
    }
    if (this.blackout.stage === 'on' || this.blackout.stage === 'warn') this.emit({ fx: 'actuate', id: 'sig.blackout_off' });
    this.blackout = { stage: 'none', timer: 0, duration: 0 };
  }

  jamBarrier(entry) {
    this.jammed[entry] = true;
    this.jamTimer[entry] = CONFIG.devices.jamTicks;
    if (entry === 'L' && this.devices.doorL) this.setDoor('L', false);
    if (entry === 'R' && this.devices.doorR) this.setDoor('R', false);
    if (entry === 'H' && this.devices.hatch) this.setHatch(false);
    this.emit({ fx: 'actuate', id: `sig.jam_${entry.toLowerCase()}` });
    this.emit({ fx: 'device', device: `jam_${entry}`, value: true });
  }

  unjam(entry) {
    if (!this.jammed[entry]) return;
    this.jammed[entry] = false;
    this.jamTimer[entry] = 0;
    this.emit({ fx: 'actuate', id: `sig.unjam_${entry.toLowerCase()}` });
    this.emit({ fx: 'device', device: `jam_${entry}`, value: false });
  }

  // ------------------------------------------------------------ outcomes
  beginJumpscare(who) {
    this.stats.attacks.push({ who, t: this.t });
    if (this.options.noDeath) {
      const a = this.anim[who];
      this.director.releaseAttack(who);
      this.director.releaseEntry(who);
      this.emit({ fx: 'tutorial_fail', who });
      a.entry = null;
      a.eyes = false;
      a.hidden = false;
      if (a.move) {
        this.occupancy.release(a.move.to, who);
        a.move = null;
      }
      this.occupancy.release(a.node, who);
      a.node = a.cfg.home;
      this.occupancy.force(a.node, who);
      a.path = [];
      a.timer = 200;
      a.setState('RECOVER', 'training: attack shown without a game over');
      if (this.phase === 'POWER_OUT') {
        this.phase = 'RUNNING';
        this.powerOut = null;
        this.power = CONFIG.power.reserveAmount;
      }
      return;
    }
    this.phase = 'JUMPSCARE';
    this.jumpscare = { who, timer: 40 };
    if (this.devices.cams.open) this.setCams(false, null, 'jumpscare');
    this.emit({ fx: 'stop_loop', loopKey: '*' });
    this.emit({ fx: 'actuate', id: `js.${who}` });
    this.emit({ fx: 'jumpscare', who, style: this.jumpscareStyle(who) });
    this.logTransition('session', 'RUNNING', 'JUMPSCARE', `${who} attack`);
  }

  /** Where the attack comes from (docs/04 "Jumpscares by place"): front | below (hatch) | vent. */
  jumpscareStyle(who) {
    const a = this.anim[who];
    if (this.phase === 'POWER_OUT' || this.powerOut) return 'front';
    if (a.entry === 'H') return 'below';
    if (a.viaVent && a.entry === 'L') return 'vent';
    return 'front';
  }

  win() {
    this.phase = 'WON';
    if (this.devices.cams.open) this.setCams(false, null, 'six am');
    this.emit({ fx: 'stop_loop', loopKey: '*' });
    this.emit({ fx: 'win', night: this.night, t: this.t, power: this.power });
    this.logTransition('session', 'RUNNING', 'WON', '6 AM');
  }

  // ------------------------------------------------------------ maintenance
  beginMaintenance(task) {
    this.phase = 'MAINT';
    this.maint = { task, startedAt: this.t };
    this.forceDevicesOff('maintenance');
    for (const k of ['vent', 'shaft']) this.unseal(k);
    this.cancelFredbearEffects();
    this.director.attackToken = null;
    for (const id of ORDER) {
      const a = this.anim[id];
      this.director.releaseEntry(id);
      a.suspendedFrom = a.state;
      a.setState('SUSPENDED', `maintenance: ${task}`);
      a.anim = 'dormant';
      a.eyes = false;
    }
    this.emit({ fx: 'maint_begin', task });
    this.logTransition('session', 'RUNNING', 'MAINT', task);
  }

  resumeMaintenance() {
    if (this.phase !== 'MAINT') return false;
    this.phase = 'RUNNING';
    this.director.graceUntil = this.t + CONFIG.director.maintenanceGrace;
    for (const id of ORDER) {
      const a = this.anim[id];
      const from = a.suspendedFrom ?? 'PATROL';
      a.entry = null;
      if (['DORMANT', 'STIR', 'SPENT', 'WITHDRAWN', 'WALLS', 'VANISH'].includes(from)) {
        a.setState(from, 'maintenance over');
        continue;
      }
      if (a.move) {
        // Finish where the walk was heading so positions stay valid.
        a.node = a.move.to;
        a.move = null;
        a.path = [];
      }
      if (NODE_BY_ID[a.node]?.zone === 'entry') {
        if (a.startRetreat) {
          a.setState('RETREAT', 'maintenance reset: leaving the entry');
          a.startRetreat();
        } else if (id === 'fredbear') {
          this.occupancy.release(a.node, id);
          a.node = 'SUB_N';
          this.occupancy.force(a.node, id);
          a.timer = 200;
          a.setState('RECOVER', 'maintenance reset');
        } else {
          a.repelled?.('maintenance reset');
        }
      } else {
        a.timer = 100;
        a.setState('RECOVER', 'maintenance reset');
      }
    }
    this.maint = null;
    this.emit({ fx: 'maint_end' });
    this.logTransition('session', 'MAINT', 'RUNNING', 'maintenance complete');
    return true;
  }

  // ------------------------------------------------------------ finale
  startFinale() {
    const fin = this.def.fredbear?.finale;
    if (!fin) return;
    this.finale = true;
    this.director.finale = true;
    this.strobe.charges += fin.extraCharges ?? 0;
    for (const id of ['freddy', 'bonnie', 'chica']) this.anim[id].withdraw();
    this.emit({ fx: 'finale' });
    this.emit({ fx: 'actuate', id: 'sig.finale' });
    this.caption('The others are withdrawing… something golden is coming.', 'session');
    this.logTransition('session', 'RUNNING', 'RUNNING', 'Golden Hour finale');
  }

  // ------------------------------------------------------------ views
  snapshot() {
    const p = this.power;
    return {
      night: this.night,
      mods: this.mods,
      held: { ...this.held },
      t: this.t,
      hour: this.hour,
      phase: this.phase,
      powerUnits: p,
      powerPct: Math.ceil(p / CONFIG.power.unitsPerPercent),
      usage: this.usage(),
      devices: {
        doorL: this.devices.doorL, doorR: this.devices.doorR, lightL: this.devices.lightL, lightR: this.devices.lightR,
        hatch: this.devices.hatch, camsOpen: this.devices.cams.open, cam: this.devices.cams.cam,
      },
      strobe: { ...this.strobe },
      seals: { vent: { ...this.seals.vent }, shaft: { ...this.seals.shaft } },
      hatchInstalled: this.hatchInstalled,
      breaker: { ...this.breaker },
      blackout: this.blackout.stage,
      disrupt: this.disrupt.left,
      echo: this.echo ? { ...this.echo } : null,
      jammed: { ...this.jammed },
      powerOut: this.powerOut ? { ...this.powerOut } : null,
      maint: this.maint ? { ...this.maint } : null,
      finale: this.finale,
      shadow: this.echo?.kind === 'shadow',
      anim: Object.fromEntries(ORDER.map((id) => {
        const a = this.anim[id];
        return [id, { state: a.state, node: a.node, moving: !!a.move, to: a.move?.to, aggression: a.aggression, entry: a.entry }];
      })),
      entries: { ...this.director.entries },
      noiseHeat: this.director.noiseHeat,
    };
  }

  entryLabel(e) {
    return ENTRY_LABEL[e];
  }

  // ------------------------------------------------------------ debug / scenario hooks
  setAggression(who, value) {
    this.aiBonus[who] = value - (this.def.ai[who] ?? 0) - (this.def.ramp && who !== 'fredbear' ? CONFIG.hourlyRamp[this.hour] ?? 0 : 0);
  }

  place(who, nodeId, state = 'PATROL') {
    const a = this.anim[who];
    if (!NODE_BY_ID[nodeId]) throw new Error(`unknown node ${nodeId}`);
    if (a.move) {
      this.occupancy.release(a.move.to, who);
      a.move = null;
    }
    a.path = [];
    this.director.releaseEntry(who);
    this.occupancy.release(a.node, who);
    a.node = nodeId;
    this.occupancy.force(nodeId, who);
    a.yaw = NODE_BY_ID[nodeId].yaw ?? a.yaw;
    a.setState(state, `debug place at ${nodeId}`);
    a.moTimer = 1;
  }

  setPowerPercent(pct) {
    this.power = Math.max(0, Math.round(pct * CONFIG.power.unitsPerPercent));
  }

  setTick(t) {
    this.t = Math.max(0, Math.min(this.length - 1, t));
    this.lastHour = this.hour;
  }

  /** Training helper: walk `who` to its approach node then into `entry`. */
  forceApproach(who, entry) {
    const a = this.anim[who];
    a.target = entry;
    if (who === 'chica') a.kitchenDone = true;
    const approach = { L: 'WH_S', R: 'EH_S', H: 'SUB_N' }[entry];
    this.place(who, approach, 'STALK');
    a.forceNextMove = true;
    a.moTimer = 1;
  }
}

export { CONFIG };
