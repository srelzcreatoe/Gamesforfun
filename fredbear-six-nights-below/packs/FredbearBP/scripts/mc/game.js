// Global state machine and orchestrator.
//
//   BOOT -> UNBUILT -(/fb:setup)-> BUILDING -> LOBBY
//   LOBBY -> INTRO(n) -> NIGHT(n) -> RESULT(win|lose) -> RESET -> LOBBY | INTRO(n+1) | NIGHT(n) (retry)
//   NIGHT(6) win -> ENDING -> RESET -> LOBBY
//   LOBBY <-> FREE_ROAM ; LOBBY -> TUTORIAL (a NIGHT(0) with the training controller)
//
// Ownership: the NightSession owns the clock, power, devices and AI; this
// file only routes inputs into it and applies the effects it emits (command
// blocks via the actuator bus, puppets, camera view, audio, HUD). No gameplay
// runs in LOBBY / RESET / FREE_ROAM: animatronics hold rest poses.

import { world, system, InputButton, ButtonState, GameMode } from '@minecraft/server';
import { NightSession } from '../core/session.js';
import { CONFIG } from '../core/config.js';
import { mixSeed } from '../core/rng.js';
import { ANCHORS, OFFICE_BOUNDS, ROOM_BY_ID, interior } from '../data/layout.js';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { NODE_BY_ID } from '../data/nodes.js';
import { INPUTS, inputCbPos } from '../data/inputs.js';
import { isKnownInputAction } from '../data/input_actions.js';
import { PHONE, TASKS, MAINTENANCE, SECRETS, ENDING, TUTORIAL_STEPS } from '../data/story.js';
import { ActuatorBus } from './actuator_bus.js';
import { settleTicks } from '../data/actuators.js';
import { Builder } from './builder.js';
import { Puppets } from './puppets.js';
import { CameraView, restorePlayerView } from './camera_view.js';
import { Audio } from './audio.js';
import { Hud, hourLabel } from './hud.js';
import { giveKit, clearKit, ITEMS, ANCHOR_SLOT } from './items.js';
import * as ui from './ui.js';
import { loadSave, storeSave, eraseSave, defaultSave, markSession, readSession, clearSession } from './persistence.js';
import { COMMAND_TEMPLATES, fogCommand } from './commands.js';
import { dim, W, Wv, L, runCmd } from './world_io.js';
import { log } from './log.js';

const CB_INPUT = new Map(INPUTS.map((i) => {
  const [x, y, z] = inputCbPos(i);
  const w = W(x, y, z);
  return [`${w.x},${w.y},${w.z}`, i];
}));
// Ticks the reset command-block chains need before anything else may actuate.
const RESET_SETTLE = settleTicks('reset.world') + 4;
const SCALE = Object.freeze({ freddy: 1.25, bonnie: 1.2, chica: 1.2, fredbear: 1.3 });
const ZONE_ACTUATOR = Object.freeze({ 'zone:cove': 'zone.cove', 'zone:freezer': 'zone.freezer', 'zone:diner': 'zone.diner', 'zone:chamber': 'zone.chamber', 'zone:attic': 'zone.attic', 'zone:basement': 'env.pipes', 'zone:backstage': 'env.distant_music' });

export class Game {
  constructor() {
    this.save = loadSave();
    this.bus = new ActuatorBus();
    this.puppets = new Puppets();
    this.cams = new CameraView();
    this.audio = new Audio();
    this.hud = new Hud();
    this.builder = new Builder((msg, frac, report) => this.onBuildProgress(msg, frac, report));
    this.state = 'BOOT';
    this.session = null;
    this.night = 0;
    this.guardId = undefined;
    this.timers = Object.create(null);
    this.intro = null;
    this.maint = null;
    this.tutorial = null;
    this.echo = null;
    this.camBurst = 0;
    this.result = null;
    this.ending = null;
    this.zoneCooldown = Object.create(null);
    this.taskBonus = { power: false, charge: false };
    this.overlay = !!this.save.settings.debugOverlay;
    /** @type {((action: string, player: any) => any) | undefined} */
    this.debugHook = undefined;
  }

  // ================================================================ lifecycle
  start() {
    system.afterEvents.scriptEventReceive.subscribe((ev) => this.onScriptEvent(ev));
    world.afterEvents.playerSpawn.subscribe((ev) => this.onPlayerSpawn(ev.player, ev.initialSpawn));
    world.afterEvents.itemUse.subscribe((ev) => this.onItemUse(ev.source, ev.itemStack?.typeId));
    world.afterEvents.playerButtonInput.subscribe((ev) => this.onSneak(ev.player), { buttons: [InputButton.Sneak], state: ButtonState.Pressed });
    world.afterEvents.playerHotbarSelectedSlotChange.subscribe((ev) => this.onHotbar(ev.player, ev.previousSlotSelected, ev.newSlotSelected));
    system.runInterval(() => this.tick(), 1);
    this.boot();
  }

  boot() {
    for (const p of world.getAllPlayers()) restorePlayerView(p);
    if (!this.builder.isBuilt()) {
      this.state = 'UNBUILT';
      return;
    }
    const interrupted = readSession();
    this.fullReset('lobby');
    if (interrupted?.active) this.hudMessage(`The previous shift (night ${interrupted.night}) was interrupted. Back at the time clock.`, 200);
  }

  guard() {
    const all = world.getAllPlayers();
    return all.find((p) => p.id === this.guardId) ?? all[0];
  }

  // ================================================================ tick
  tick() {
    const now = system.currentTick;
    this.audio.newTick();
    try {
      switch (this.state) {
        case 'UNBUILT':
          if (now % 60 === 0) for (const p of world.getAllPlayers()) p.onScreenDisplay.setActionBar('§eFREDBEAR: SIX NIGHTS BELOW\n§fRun §b/fb:setup§f to build the map (cheats on).');
          break;
        case 'LOBBY':
        case 'FREE_ROAM':
          this.tickRest(now);
          break;
        case 'INTRO':
          this.tickIntro(now);
          break;
        case 'NIGHT':
          this.tickNight(now);
          break;
        case 'RESULT':
          this.tickResult(now);
          break;
        case 'ENDING':
          this.tickEnding(now);
          break;
        default:
      }
    } catch (e) {
      log.error(`tick (${this.state})`, e);
    }
    this.bus.tick();
  }

  tickRest(now) {
    if (now % 20 === 0) this.puppets.sync(null, 'perform');
    if (now % 40 === 0) {
      const g = this.guard();
      if (!g) return;
      const text = this.state === 'FREE_ROAM'
        ? '§bFREE ROAM§f - explore safely. Secrets found: ' + `${this.save.secrets.length}/12\n§7Press FREE ROAM at the time clock to return.`
        : `§eTIME CLOCK§f - choose a night. Unlocked: §a${this.save.unlocked}/6${this.save.campaignDone ? ' §6(campaign complete)' : ''}`;
      if (!this.hudBusy(now)) g.onScreenDisplay.setActionBar(text);
    }
  }

  hudBusy(now) {
    return this.hud.message && now < this.hud.messageUntil;
  }

  hudMessage(text, ticks = 100) {
    this.hud.setMessage(text, system.currentTick, ticks);
    const g = this.guard();
    if (g && this.state !== 'NIGHT') g.onScreenDisplay.setActionBar(`§e${text}`);
  }

  // ================================================================ building
  setup(rebuild = false) {
    if (this.state === 'BUILDING') return false;
    this.state = 'BUILDING';
    this.builder.start({ rebuild });
    return true;
  }

  onBuildProgress(msg, frac, report) {
    const g = this.guard();
    if (msg === 'done') {
      log.warn(`build complete: ${JSON.stringify(report)}`);
      this.fullReset('lobby');
      if (g) {
        g.onScreenDisplay.setTitle('§6FREDBEAR', { fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20, subtitle: 'SIX NIGHTS BELOW' });
        if (report.errors.length || report.inputBlocksMissing.length) {
          ui.messageBox(g, 'Build report', `The map was built with warnings:\n${[...report.errors, ...report.inputBlocksMissing.map((m) => `missing CB: ${m}`)].slice(0, 20).join('\n')}\n\nSee the content log, or run /fb:debug selftest.`);
        }
      }
      return;
    }
    if (frac < 0) {
      this.state = 'UNBUILT';
      if (g) g.onScreenDisplay.setActionBar(`§c${msg}`);
      return;
    }
    if (g) g.onScreenDisplay.setActionBar(`§e${msg} §f${Math.floor(frac * 100)}%`);
  }

  // ================================================================ reset
  /**
   * Restore everything temporary. target: 'lobby' | 'office' | 'free_roam' | 'intro'.
   * Covers: animatronic positions/states, timers, doors and lights, power,
   * player position and inventory, camera and input state, effects, sounds,
   * pending events and cooldowns.
   */
  fullReset(target = 'lobby') {
    this.session = null;
    this.intro = null;
    this.maint = null;
    this.tutorial = null;
    this.result = null;
    this.ending = null;
    this.echo = null;
    this.camBurst = 0;
    this.timers = Object.create(null);
    this.taskBonus = { power: false, charge: false };
    this.cams.close();
    this.audio.stop('*');
    this.puppets.hideEcho();
    clearSession();
    for (const id of ['reset.world', 'sig.stage_lights_on', 'init.policy', 'init.time', 'pwr.meter_full', 'pwr.charges_0', 'lobby.lamps_reset']) this.bus.trigger(id);
    this.bus.fence(RESET_SETTLE); // a night started in this same tick must not be undone by night.end
    this.applyGates();
    runCmd(COMMAND_TEMPLATES.fogPop[0]);
    for (const c of COMMAND_TEMPLATES.hudReset) runCmd(c);
    for (const p of world.getAllPlayers()) {
      restorePlayerView(p);
      try {
        p.setGameMode(GameMode.Adventure);
        for (const eff of p.getEffects()) p.removeEffect(eff.typeId);
        p.addEffect('saturation', 20 * 60 * 60, { amplifier: 1, showParticles: false });
        p.onScreenDisplay.setTitle(' ', { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 });
      } catch (e) {
        log.warn(`reset player: ${e?.message ?? e}`);
      }
      giveKit(p);
      const a = target === 'office' ? ANCHORS.officeSeat : target === 'free_roam' ? ANCHORS.lobbySpawn : ANCHORS.lobbySpawn;
      try {
        p.teleport(Wv({ x: a.x, y: a.y, z: a.z }), { rotation: { x: 0, y: a.yaw } });
      } catch (e) {
        log.warn(`teleport: ${e?.message ?? e}`);
      }
    }
    for (let n = 1; n <= this.save.unlocked; n++) this.bus.trigger(`lobby.lamp_${n}`);
    this.puppets.sync(null, 'perform');
    this.state = target === 'free_roam' ? 'FREE_ROAM' : target === 'office' ? 'RESET' : 'LOBBY';
  }

  /** Diner seal and chamber wall follow campaign progress outside nights. */
  applyGates(night = null) {
    const open = night !== null ? night >= 4 : this.save.unlocked >= 4;
    this.bus.trigger(open ? 'sig.diner_unseal' : 'sig.diner_seal');
    const chamber = night !== null ? night >= 4 : this.save.campaignDone;
    this.bus.trigger(chamber ? 'sig.chamber_open' : 'sig.chamber_close');
  }

  // ================================================================ lobby / intro
  chooseNight(n, player) {
    if (this.state !== 'LOBBY') return this.deny(player, 'Finish what you are doing first.');
    if (n > this.save.unlocked) {
      this.bus.trigger('lobby.deny');
      return this.deny(player, `Night ${n} is locked. Survive night ${n - 1} first.`);
    }
    this.bus.trigger('lobby.accept');
    this.guardId = player?.id;
    this.enterIntro(n);
    return true;
  }

  deny(player, text) {
    try {
      player?.playSound('fb.ui.deny', { volume: 0.8 });
    } catch {
      // ignore
    }
    this.hudMessage(text, 80);
    return false;
  }

  enterIntro(n) {
    this.fullReset('lobby');
    this.night = n;
    this.state = 'INTRO';
    const task = TASKS[n];
    this.intro = { started: system.currentTick, task, taskDone: false, deadline: system.currentTick + 20 * 180 };
    this.applyGates(n);
    this.hudMessage(`11:55 PM - Night ${n}. Walk to the SECURITY OFFICE and press START SHIFT.${task ? ` ${task.text}` : ''}`, 260);
    const g = this.guard();
    if (g) g.onScreenDisplay.setTitle(`§fNight ${n}`, { fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20, subtitle: CONFIG.nights[n].title.replace(/^Night \d+ — /, '') });
  }

  tickIntro(now) {
    if (now % 20 === 0) this.puppets.sync(null, 'perform');
    const g = this.guard();
    if (!g) return;
    if (now % 10 === 0) this.guideParticles(g, this.intro.taskDone || !this.intro.task ? [100.5, 0, 131.5] : this.taskTarget(this.intro.task.action));
    if (now % 40 === 0 && !this.hudBusy(now)) {
      const left = Math.max(0, Math.ceil((this.intro.deadline - now) / 20));
      g.onScreenDisplay.setActionBar(`§fNight ${this.night} starts at midnight · §e${left}s\n§7Go to the office and press §aSTART SHIFT§7${this.intro.task && !this.intro.taskDone ? ' · optional task pending' : ''}`);
    }
    if (now >= this.intro.deadline) {
      this.hudMessage('Midnight. Your shift has started.', 80);
      this.beginNight(this.night, { teleport: true });
    }
  }

  taskTarget(action) {
    const inp = INPUTS.find((i) => i.action === action);
    return inp ? [inp.p[0] + 0.5, inp.p[1], inp.p[2] + 0.5] : [100.5, 0, 131.5];
  }

  /** Breadcrumb particles from the player toward a local target. */
  guideParticles(player, target) {
    try {
      const p = L(player.location);
      const dx = target[0] - p.x;
      const dz = target[2] - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 3) return;
      for (let k = 1; k <= 3; k++) {
        const f = Math.min(1, (k * 2) / d);
        dim().spawnParticle('minecraft:villager_happy', Wv({ x: p.x + dx * f, y: p.y + 0.3, z: p.z + dz * f }));
      }
    } catch {
      // ignore
    }
  }

  // ================================================================ nights
  beginNight(n, { teleport = false, overrides = {}, options = {}, scenario = null } = {}) {
    const g = this.guard();
    if (!g) return;
    this.night = n;
    const s = this.save.settings;
    const seed = s.deterministic ? s.seed : mixSeed(system.currentTick, Math.floor(Math.random() * 0xffffffff));
    this.session = new NightSession({
      night: n,
      seed,
      overrides,
      options: { captions: s.captions, taskBonusPower: this.taskBonus.power, bonusCharges: this.taskBonus.charge ? 1 : 0, ...options },
    });
    this.seed = seed;
    markSession({ active: true, night: n, seed });
    this.state = 'NIGHT';
    this.maint = null;
    this.timers.phone = { lines: PHONE[n] ?? [], i: 0, next: system.currentTick + 40 };
    for (const id of ['init.policy', 'init.time', 'night.begin', 'sig.stage_lights_off', 'pwr.meter_full', `pwr.charges_${Math.min(4, this.session.strobe.charges)}`, 'env.phone_ring']) this.bus.trigger(id);
    this.applyGates(n);
    if (n >= 1) runCmd(fogCommand(n));
    if (teleport || !this.inOffice(g)) {
      try {
        g.teleport(Wv(ANCHORS.officeSeat), { rotation: { x: 0, y: ANCHORS.officeSeat.yaw } });
      } catch (e) {
        log.warn(`office teleport: ${e?.message ?? e}`);
      }
    }
    this.lastPowerSeg = 10;
    this.lastCharges = this.session.strobe.charges;
    if (scenario) scenario(this.session);
    log.info(`night ${n} started, seed ${seed}`);
  }

  inOffice(p) {
    try {
      const l = L(p.location);
      const b = OFFICE_BOUNDS;
      return l.x >= b.x1 && l.x <= b.x2 + 0.001 && l.z >= b.z1 && l.z <= b.z2 + 0.001 && l.y >= b.y1 && l.y <= b.y2;
    } catch {
      return false;
    }
  }

  tickNight(now) {
    const s = this.session;
    const g = this.guard();
    if (!g || !g.isValid) {
      log.warn('guard missing during the night: resetting');
      this.fullReset('lobby');
      return;
    }
    s.view.inOffice = this.inOffice(g);
    if (s.phase === 'RUNNING' && !s.view.inOffice) {
      this.timers.outside = (this.timers.outside ?? 0) + 1;
      if (this.timers.outside > 60) {
        g.teleport(Wv(ANCHORS.officeSeat), { rotation: { x: 0, y: ANCHORS.officeSeat.yaw } });
        this.timers.outside = 0;
      }
    } else this.timers.outside = 0;

    const fx = s.tick();
    for (const f of fx) this.applyFx(f, g);
    if (!this.session) return; // reset from an effect

    if (s.phase !== 'JUMPSCARE' && s.phase !== 'LOST') this.puppets.sync(s);
    this.tickPhone(now, g);
    this.tickDisplays();
    if (this.tutorial) this.tickTutorial(now);
    if (this.cams.active) this.cams.tick(this.camCover(s));
    if (s.phase === 'MAINT' && now % 10 === 0 && this.maint) this.guideParticles(g, this.maint.done ? [100.5, 0, 131.5] : this.taskTarget(MAINTENANCE[this.maint.task].action));
    if (now % 5 === 0) this.renderNightHud(g, now);
  }

  camCover(s) {
    const cam = CAMERA_BY_ID[s.devices.cams.cam];
    if (!cam) return null;
    if (s.disrupt.left > 0 || system.currentTick < this.camBurst) return 'static';
    if (cam.audioOnly) return 'audio';
    if (cam.lostSignalBefore && s.night < cam.lostSignalBefore && !s.foreshadowActive(cam.id)) return 'lost';
    if (this.echo && this.echo.kind === 'false' && this.echo.cam === cam.id) return 'echo';
    return null;
  }

  renderNightHud(g, now) {
    const s = this.session;
    const snap = s.snapshot();
    const view = { cover: this.cams.active ? this.camCover(s) : null, echo: this.cams.active && this.echo?.cam === snap.devices.cam && this.echo.kind === 'false' };
    let overlay = null;
    if (this.overlay) {
      overlay = '§8' + s.order.map((id) => `${id[0].toUpperCase()}${id === 'fredbear' ? 'B' : ''}:${s.anim[id].state}@${s.anim[id].move ? `${s.anim[id].move.from}>${s.anim[id].move.to}` : s.anim[id].node}(${s.anim[id].aggression})`).join(' ') + ` t${s.t} noise${s.director.noiseHeat}`;
    }
    if (s.phase === 'MAINT' && this.maint) {
      const m = MAINTENANCE[this.maint.task];
      g.onScreenDisplay.setActionBar(`§e${m.title}§f - ${this.maint.done ? 'Done. Return to the office and press START/RESUME.' : m.text}\n§7Clock paused · animatronics offline`);
      return;
    }
    g.onScreenDisplay.setActionBar(this.hud.nightLines(snap, view, now, { captions: this.save.settings.captions, overlay }));
  }

  tickPhone(now, g) {
    const ph = this.timers.phone;
    if (!ph || ph.i >= ph.lines.length || now < ph.next) return;
    this.hud.setMessage(`☎ ${ph.lines[ph.i]}`, now, 110);
    ph.i++;
    ph.next = now + 120;
    if (!this.cams.active) g.onScreenDisplay.setActionBar(`§e☎ ${ph.lines[ph.i - 1]}`);
  }

  /** Physical office displays (power meter, strobe charges) follow the session. */
  tickDisplays() {
    const s = this.session;
    const seg = Math.ceil(s.power / 10000); // lit segments 0..10
    while (this.lastPowerSeg > seg && this.lastPowerSeg >= 1) {
      this.bus.trigger(`pwr.meter_${this.lastPowerSeg}`);
      this.lastPowerSeg--;
    }
    if (seg > this.lastPowerSeg) {
      this.bus.trigger('pwr.meter_full');
      for (let k = 10; k > seg; k--) this.bus.trigger(`pwr.meter_${k}`);
      this.lastPowerSeg = seg;
    }
    if (s.strobe.charges !== this.lastCharges) {
      this.lastCharges = s.strobe.charges;
      this.bus.trigger(`pwr.charges_${Math.min(4, s.strobe.charges)}`);
    }
  }

  // ================================================================ effects
  applyFx(f, g) {
    const s = this.session;
    switch (f.fx) {
      case 'actuate':
        this.bus.trigger(f.id);
        if (f.id.startsWith('js.')) {
          try {
            g.playSound(`fb.js.${f.id.slice(3)}`, { volume: 1.6 });
          } catch {
            // ignore
          }
        }
        break;
      case 'sound':
        this.audio.play(f, g, { relayKitchen: this.cams.active && this.cams.cam === 'C10' });
        break;
      case 'stop_loop':
        this.audio.stop(f.loopKey);
        break;
      case 'caption':
        this.hud.setCaption(f.text, system.currentTick);
        break;
      case 'feedback':
        this.onFeedback(f, g);
        break;
      case 'hour':
        this.bus.trigger('night.hour');
        this.bus.trigger(`night.hour_${f.hour}`);
        g.onScreenDisplay.setTitle(`§f${hourLabel(f.hour)}`, { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 15 });
        if (f.hour >= 2 && s.rng.chance(0.6)) this.bus.trigger(s.rng.chance(0.5) ? 'env.flicker_whall' : 'env.flicker_ehall');
        if (f.hour === 3) this.bus.trigger('env.pipes');
        break;
      case 'cams':
        if (f.open && !this.cams.active) {
          this.cams.open(g, f.cam);
          this.bus.trigger('cam.up');
          for (const c of COMMAND_TEMPLATES.hudCams) runCmd(c);
          try {
            g.selectedSlotIndex = ANCHOR_SLOT;
          } catch {
            // ignore
          }
        } else if (f.open) this.cams.show(f.cam);
        else if (this.cams.active) {
          this.cams.close();
          this.bus.trigger('cam.down');
          for (const c of COMMAND_TEMPLATES.hudReset) runCmd(c);
        }
        if (this.tutorial) this.tutorialEvent(f.open ? (f.reason === 'switch' ? 'cam_switch' : 'cams_open') : 'cams_close');
        break;
      case 'disrupt':
        if (f.on) this.bus.trigger('cam.server_fault');
        break;
      case 'echo':
        if (f.on) {
          this.echo = { cam: f.cam, node: f.node, kind: f.kind };
          this.puppets.showEcho(f.node);
          if (f.kind === 'false' && this.cams.active && this.cams.cam === f.cam) g.playSound('fb.fredbear.chime', { volume: 0.5, pitch: 0.7 });
        } else {
          this.echo = null;
          this.puppets.hideEcho();
        }
        break;
      case 'camfx':
        if (f.kind === 'static_burst' && this.cams.active && this.cams.cam === f.cam) this.camBurst = system.currentTick + 16;
        break;
      case 'shimmer':
        try {
          dim().spawnParticle('minecraft:totem_particle', Wv(f.at));
        } catch {
          // ignore
        }
        break;
      case 'blackout':
        if (f.stage === 'on') g.onScreenDisplay.setTitle(' ', { fadeInDuration: 0, stayDuration: 20, fadeOutDuration: 10, subtitle: '§8the lights are out' });
        break;
      case 'power_out':
        if (f.stage === 'down') g.onScreenDisplay.setTitle('§cPOWER OUT', { fadeInDuration: 0, stayDuration: 40, fadeOutDuration: 20 });
        break;
      case 'repel':
        this.hud.setMessage('Fredbear repelled!', system.currentTick, 60);
        break;
      case 'finale':
        g.onScreenDisplay.setTitle('§6THE GOLDEN HOUR', { fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20, subtitle: 'the others are withdrawing' });
        break;
      case 'jumpscare':
        this.jumpscare(f.who, g);
        break;
      case 'tutorial_fail':
        this.tutorialEvent('fail');
        break;
      case 'maint_begin':
        this.onMaintBegin(f.task, g);
        break;
      case 'maint_end':
        this.bus.trigger('night.maint_end');
        break;
      case 'win':
        this.onWin(g);
        break;
      case 'lose':
        this.onLose(f.who, g);
        break;
      default:
    }
  }

  onFeedback(f, g) {
    // Training: door/light/strobe steps listen to accepted inputs; camera steps listen to 'cams' effects.
    if (this.tutorial && f.ok && ['door_l', 'light_l', 'strobe'].includes(f.action)) this.tutorialEvent(f.action);
    if (f.ok) return;
    const names = { door_l: 'LEFT DOOR', door_r: 'RIGHT DOOR', light_l: 'LEFT LIGHT', light_r: 'RIGHT LIGHT', cams_open: 'CAMERAS', cam_select: 'CAMERAS', strobe: 'STROBE', hatch: 'HATCH', breaker: 'BREAKER', reserve: 'RESERVE' };
    if (f.reason === 'cooldown' || f.reason === 'same camera') return;
    try {
      g.playSound('fb.ui.deny', { volume: 0.7 });
    } catch {
      // ignore
    }
    this.hud.setMessage(`${names[f.action] ?? f.action}: ${f.reason}`, system.currentTick, 50);
  }

  // ================================================================ outcomes
  jumpscare(who, g) {
    this.cams.close();
    try {
      const eye = g.getHeadLocation();
      const dir = g.getViewDirection();
      const flat = Math.hypot(dir.x, dir.z) || 1;
      const head = this.puppets.lunge(who, eye, { x: dir.x / flat, y: 0, z: dir.z / flat }, SCALE[who] ?? 1.2);
      if (head) g.camera.setCamera('minecraft:free', { location: eye, facingLocation: head });
    } catch (e) {
      log.warn(`jumpscare camera: ${e?.message ?? e}`);
    }
  }

  onWin(g) {
    const n = this.night;
    clearSession();
    this.cams.close();
    this.bus.trigger('win.six_am');
    this.bus.trigger('night.end');
    runCmd(COMMAND_TEMPLATES.fogPop[0]);
    g.onScreenDisplay.setTitle('§f6 AM', { fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20, subtitle: n === 0 ? 'Training complete' : `Night ${n} complete` });
    if (n >= 1) {
      if (!this.save.completed.includes(n)) this.save.completed.push(n);
      this.save.unlocked = Math.max(this.save.unlocked, Math.min(6, n + 1));
      this.save.stats.wins++;
      if (n === 6) this.save.campaignDone = true;
      storeSave(this.save);
    }
    this.state = 'RESULT';
    this.result = { won: true, night: n, at: system.currentTick + 140 };
  }

  onLose(who, g) {
    clearSession();
    this.save.stats.deaths++;
    storeSave(this.save);
    this.bus.trigger('lose.static');
    try {
      g.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.2, holdTime: 2.5, fadeOutTime: 0.5 } });
      g.onScreenDisplay.setTitle('§4GAME OVER', { fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 20, subtitle: `Night ${this.night} · ${hourLabel(this.session?.hour ?? 0)}` });
    } catch {
      // ignore
    }
    this.state = 'RESULT';
    this.result = { won: false, night: this.night, at: system.currentTick + 70 };
  }

  tickResult(now) {
    const r = this.result;
    if (!r || now < r.at || r.asked) return;
    r.asked = true;
    const g = this.guard();
    for (const p of world.getAllPlayers()) restorePlayerView(p);
    if (r.won && r.night === 6) {
      this.startEnding();
      return;
    }
    if (r.night === 0) {
      this.fullReset('lobby');
      return;
    }
    this.fullReset(r.won ? 'lobby' : 'office');
    if (!g) return;
    ui.resultForm(g, { won: r.won, night: r.night, canNext: r.won && r.night < 6 }).then((choice) => {
      if (choice === 'next') {
        this.state = 'LOBBY';
        this.enterIntro(r.night + 1);
      } else if (choice === 'retry') {
        // Immediate retry: straight into the office, shift starts in 3 s.
        this.fullReset('office');
        this.state = 'RESET';
        system.runTimeout(() => this.beginNight(r.night, { teleport: true }), 60);
      } else {
        this.fullReset('lobby');
      }
    });
  }

  // ================================================================ maintenance
  onMaintBegin(task, g) {
    this.maint = { task, done: false };
    this.cams.close();
    this.bus.trigger('night.maint_begin');
    const m = MAINTENANCE[task];
    g.onScreenDisplay.setTitle(`§e${m.title}`, { fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 20, subtitle: 'clock paused' });
    ui.maintenanceForm(g, m.title, `${m.text}\n\nThe clock is paused and every animatronic is offline until you press START/RESUME in the office.`);
  }

  onMaintAction(action, player) {
    const m = this.maint;
    if (!m || MAINTENANCE[m.task].action !== action || m.done) return false;
    m.done = true;
    this.bus.trigger('pwr.reserve');
    this.hudMessage('Done. Return to the office and press START/RESUME.', 120);
    ui.maintenanceForm(player, 'TASK COMPLETE', 'Head back to the office and press START/RESUME on the console.').then((c) => {
      if (c === 'teleport' && this.state === 'NIGHT' && this.session?.phase === 'MAINT') player.teleport(Wv(ANCHORS.officeSeat), { rotation: { x: 0, y: ANCHORS.officeSeat.yaw } });
    });
    return true;
  }

  // ================================================================ ending
  startEnding() {
    this.fullReset('lobby');
    this.state = 'ENDING';
    this.ending = { step: 0, next: system.currentTick + 20 };
  }

  tickEnding(now) {
    const e = this.ending;
    const g = this.guard();
    if (!g || now < e.next) return;
    const ch = NODE_BY_ID.CHAMBER_F;
    const shots = [
      () => {
        this.bus.trigger('sig.chamber_open');
        this.puppets.apply('fredbear', { x: ch.x, y: ch.y, z: ch.z, yaw: 0, anim: 'dormant', eyes: true, hidden: false });
        g.camera.setCamera('minecraft:free', { location: Wv({ x: 34.5, y: -6.5, z: 42.5 }), facingLocation: Wv({ x: ch.x, y: ch.y + 1.5, z: ch.z }) });
        g.onScreenDisplay.setTitle(' ', { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: ENDING[0] });
      },
      () => {
        this.puppets.apply('fredbear', { x: ch.x, y: ch.y, z: ch.z, yaw: 0, anim: 'dormant', eyes: false, hidden: false });
        g.onScreenDisplay.setTitle(' ', { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: ENDING[1] });
      },
      () => {
        g.teleport(Wv(ANCHORS.parkingSpawn), { rotation: { x: 0, y: ANCHORS.parkingSpawn.yaw } });
        g.camera.setCamera('minecraft:free', { location: Wv({ x: 100.5, y: 6, z: 190.5 }), facingLocation: Wv({ x: 100.5, y: 18, z: 152 }) });
        this.bus.trigger('win.campaign');
        g.onScreenDisplay.setTitle(' ', { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: ENDING[2] });
      },
      () => g.onScreenDisplay.setTitle(' ', { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: ENDING[3] }),
      () => g.onScreenDisplay.setTitle('§6SIX NIGHTS', { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: ENDING[4] }),
      () => g.onScreenDisplay.setTitle('§lTHE END', { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: ENDING[5] }),
      () => {
        restorePlayerView(g);
        this.fullReset('lobby');
        ui.extrasForm(g, this.save);
      },
    ];
    if (e.step >= shots.length) return;
    try {
      shots[e.step]();
    } catch (err) {
      log.warn(`ending shot ${e.step}: ${err?.message ?? err}`);
    }
    e.step++;
    e.next = now + 140;
  }

  // ================================================================ tutorial
  startTutorial(player) {
    this.guardId = player?.id;
    this.fullReset('office');
    this.tutorial = { step: 0, demoStarted: false, done: false, nextDemo: 0 };
    this.beginNight(0, {
      teleport: true,
      overrides: { ticksPerHour: 12000, activation: { bonnie: 999999 } },
      options: { noDeath: true },
    });
    this.tutorial = { step: 0, demoStarted: false, done: false, nextDemo: 0 };
    this.showTutorialStep();
  }

  showTutorialStep() {
    const st = TUTORIAL_STEPS[this.tutorial.step];
    if (!st) return;
    this.hud.setMessage(`TRAINING ${this.tutorial.step + 1}/${TUTORIAL_STEPS.length}: ${st.text}`, system.currentTick, 20 * 3600);
    const hl = { door: 'tut.hl_door_l', door_open: 'tut.hl_door_l', light: 'tut.hl_light_l', cams: 'tut.hl_cams', cam_switch: 'tut.hl_cams', cams_close: 'tut.hl_cams', strobe: 'tut.hl_strobe', demo: 'tut.hl_door_l' }[st.id];
    if (hl) this.bus.trigger(hl);
  }

  tutorialEvent(ev) {
    const t = this.tutorial;
    if (!t || t.done) return;
    const st = TUTORIAL_STEPS[t.step];
    if (!st) return;
    if (ev === 'fail') {
      this.hud.setMessage('Bonnie got in. Close the LEFT DOOR while he stands in the lit corner. Trying again...', system.currentTick, 120);
      t.nextDemo = system.currentTick + 120;
      t.demoStarted = false;
      return;
    }
    if (st.expect === ev) this.advanceTutorial();
  }

  advanceTutorial() {
    const t = this.tutorial;
    t.step++;
    if (t.step >= TUTORIAL_STEPS.length) {
      t.done = true;
      this.save.tutorialDone = true;
      storeSave(this.save);
      const g = this.guard();
      g?.onScreenDisplay.setTitle('§aTRAINING COMPLETE', { fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 20, subtitle: 'Night 1 is ready at the time clock' });
      system.runTimeout(() => this.fullReset('lobby'), 80);
      return;
    }
    this.showTutorialStep();
  }

  tickTutorial(now) {
    const t = this.tutorial;
    const st = TUTORIAL_STEPS[t.step];
    if (!st || t.done) return;
    if (st.id === 'demo') {
      if (!t.demoStarted && now >= t.nextDemo) {
        this.session.forceApproach('bonnie', 'L');
        this.session.setAggression('bonnie', 12);
        t.demoStarted = true;
        t.demoLog = this.session.log.length;
      }
      if (t.demoStarted && this.session.log.slice(t.demoLog).some((l) => l.who === 'bonnie' && l.to === 'RETREAT')) {
        this.session.place('bonnie', 'STAGE_B', 'DORMANT');
        this.advanceTutorial();
      }
    }
  }

  // ================================================================ input routing
  onScriptEvent(ev) {
    try {
      if (ev.id === 'fb:input') {
        const b = ev.sourceBlock;
        if (!b) {
          if (this.save.settings.debugOverlay && isKnownInputAction(ev.message)) this.onInput(ev.message, ev.sourceEntity);
          return;
        }
        const reg = CB_INPUT.get(`${b.location.x},${b.location.y},${b.location.z}`);
        if (!reg || reg.action !== ev.message) {
          log.warn(`rejected input '${ev.message}' from unregistered block ${JSON.stringify(b.location)}`);
          return;
        }
        let player;
        try {
          player = dim().getPlayers({ location: b.location, maxDistance: 12, closest: 1 })[0];
        } catch {
          player = undefined;
        }
        this.onInput(reg.action, player ?? this.guard());
      } else if (ev.id === 'fb:diag') {
        this.bus.onDiag(ev.message);
      }
    } catch (e) {
      log.error('script event', e);
    }
  }

  onInput(action, player) {
    const s = this.session;
    const [kind, arg, arg2] = action.split(':');
    if (action.startsWith('dev:')) return this.debugHook?.(action, player);
    if (kind === 'secret') return this.onSecret(arg, player);
    if (kind === 'zone') return this.onZone(action);
    if (kind === 'lobby') return this.onLobby(arg, arg2, player);
    if (kind === 'maint') return this.onMaint(action, player);
    // ----- office / night controls
    if (action === 'start_shift') {
      if (this.state === 'INTRO' && player && this.inOffice(player)) return this.beginNight(this.night);
      if (this.state === 'NIGHT' && s?.phase === 'MAINT') {
        if (!this.maint?.done) return this.deny(player, 'Finish the maintenance task first.');
        if (!this.inOffice(player)) return this.deny(player, 'Be in the office to resume.');
        s.resumeMaintenance();
        this.maint = null;
        return true;
      }
      return this.deny(player, this.state === 'NIGHT' ? 'Your shift is already running.' : 'Clock in at the time clock first.');
    }
    if (action === 'phone') {
      if (this.state === 'NIGHT') this.timers.phone = { lines: PHONE[this.night] ?? [], i: 0, next: system.currentTick };
      this.bus.trigger('env.phone_ring');
      return true;
    }
    if (this.state !== 'NIGHT' || !s) return this.deny(player, 'The office systems are offline until your shift starts.');
    if (kind === 'cam') {
      s.input('cam_select', arg);
      return true;
    }
    s.input(action);
    return true;
  }

  onLobby(what, n, player) {
    if (what === 'night') return this.chooseNight(Number(n), player);
    if (this.state !== 'LOBBY' && !(what === 'free_roam' && this.state === 'FREE_ROAM')) return this.deny(player, 'Not available right now.');
    switch (what) {
      case 'tutorial':
        this.bus.trigger('lobby.accept');
        this.startTutorial(player);
        return true;
      case 'continue':
        return this.chooseNight(this.save.unlocked, player);
      case 'free_roam':
        this.bus.trigger('lobby.accept');
        this.fullReset(this.state === 'FREE_ROAM' ? 'lobby' : 'free_roam');
        return true;
      case 'settings':
        ui.settingsForm(player, this.save.settings).then((v) => {
          if (!v) return;
          this.save.settings = { ...this.save.settings, ...v };
          this.overlay = v.debugOverlay;
          storeSave(this.save);
        });
        return true;
      case 'extras':
        ui.extrasForm(player, this.save);
        return true;
      case 'reset':
        ui.lobbyConfirm(player, 'Erase progress?', 'This locks nights 2-6 again and clears secrets and settings. It cannot be undone.', 'Erase').then((yes) => {
          if (!yes) return;
          eraseSave();
          this.save = defaultSave();
          storeSave(this.save);
          this.fullReset('lobby');
          this.hudMessage('Progress erased.', 80);
        });
        return true;
      default:
        return false;
    }
  }

  onMaint(action, player) {
    if (this.state === 'NIGHT' && this.session?.phase === 'MAINT') return this.onMaintAction(action, player);
    if (this.state === 'INTRO' && this.intro?.task?.action === action && !this.intro.taskDone) {
      this.intro.taskDone = true;
      const reward = this.intro.task.reward;
      if (reward === 'power') this.taskBonus.power = true;
      else this.taskBonus.charge = true;
      this.bus.trigger('lobby.accept');
      this.hudMessage(reward === 'power' ? 'Task done: the night starts at 105% power.' : 'Task done: +1 strobe charge tonight.', 120);
      return true;
    }
    this.hudMessage('Nothing to do here right now.', 60);
    return false;
  }

  onSecret(id, player) {
    if (this.state === 'NIGHT' && this.session?.phase === 'RUNNING') return false;
    const s = SECRETS[id];
    if (!s) return false;
    if (!this.save.secrets.includes(id)) {
      this.save.secrets.push(id);
      storeSave(this.save);
    }
    ui.messageBox(player, `Secret #${id}: ${s[0]}`, `${s[1]}\n\nSecrets found: ${this.save.secrets.length}/12`);
    return true;
  }

  onZone(action) {
    if (!['LOBBY', 'FREE_ROAM', 'INTRO'].includes(this.state)) return false;
    const now = system.currentTick;
    if ((this.zoneCooldown[action] ?? 0) > now) return false;
    this.zoneCooldown[action] = now + 600;
    const id = ZONE_ACTUATOR[action];
    if (id) this.bus.trigger(id);
    return true;
  }

  // ================================================================ player events
  onPlayerSpawn(player, initial) {
    restorePlayerView(player);
    if (this.state === 'UNBUILT') return;
    if (this.state === 'NIGHT' && this.session && player.id === this.guard()?.id && !initial) {
      // Death mid-night (should not happen: no damage sources) counts as a loss.
      this.session.phase = 'LOST';
      this.onLose('accident', player);
      return;
    }
    if (initial && this.state !== 'NIGHT') {
      giveKit(player);
      const a = ANCHORS.lobbySpawn;
      player.teleport(Wv(a), { rotation: { x: 0, y: a.yaw } });
    }
  }

  onItemUse(player, typeId) {
    if (!player || !typeId) return;
    const s = this.session;
    if (typeId === ITEMS.guide) return void ui.guide(player);
    if (typeId === ITEMS.tablet) {
      if (this.state !== 'NIGHT' || !s) return void ui.guide(player);
      if (s.devices.cams.open) {
        ui.cameraMenu(player, s.snapshot()).then((c) => {
          if (!c || !this.session) return;
          if (c === 'close') this.session.input('cams_close');
          else this.session.input('cam_select', c);
        });
      } else s.input('cams_open');
      return;
    }
    if (typeId === ITEMS.remote) {
      if (this.state !== 'NIGHT' || !s) return void this.deny(player, 'The office systems are offline until your shift starts.');
      ui.officeRemote(player, s.snapshot()).then((a) => {
        if (a && this.session) this.session.input(a);
      });
    }
  }

  onSneak(player) {
    if (this.state === 'NIGHT' && this.session?.devices.cams.open && player.id === this.guard()?.id) this.session.input('cams_close');
  }

  onHotbar(player, prev, next) {
    if (this.state !== 'NIGHT' || !this.session?.devices.cams.open || player.id !== this.guard()?.id) return;
    if (next === ANCHOR_SLOT) return;
    const forward = (next - prev + 9) % 9 <= 4;
    this.session.input(forward ? 'cam_next' : 'cam_prev');
    system.run(() => {
      try {
        player.selectedSlotIndex = ANCHOR_SLOT;
      } catch {
        // ignore
      }
    });
  }

  roomName(id) {
    return ROOM_BY_ID[id]?.name ?? id;
  }

  roomCenter(id) {
    const i = interior(ROOM_BY_ID[id]);
    return W((i.x1 + i.x2) / 2, i.y1, (i.z1 + i.z2) / 2);
  }
}
