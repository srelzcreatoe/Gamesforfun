// Global state machine and orchestrator.
//
//   BOOT -> UNBUILT -(/fb:setup)-> BUILDING -> LOBBY
//   LOBBY -> INTRO(n) [camera tour] -> NIGHT(n) -> RESULT(win|lose) -> RESET -> LOBBY | INTRO(n+1) | NIGHT(n) (retry)
//   INTRO(4), first time -> FLASHBACK (1983 memory) -> NIGHT(4)
//   NIGHT(6) win -> ENDING -> RESET -> LOBBY (night 7 and the challenges unlock)
//   NIGHT(7) win -> ENDING (choice: seal | burn, two final scenes) -> RESET -> LOBBY (night 8 opens;
//     its version follows the last ending: seal -> Morgrave, burn -> Valek)
//   NIGHT(9) win -> ENDING (the three below) -> RESET -> LOBBY
//   TAPE DECK (office, outside nights): the 1987 security tapes play on the monitor
//   LOBBY -> challenge (INTRO/NIGHT on a base night with modifiers) -> RESULT
//   LOBBY <-> FREE_ROAM ; LOBBY -> TUTORIAL (a NIGHT(0) with the training controller)
//
// Ownership: the NightSession owns the clock, power, devices and AI; this
// file only routes inputs into it and applies the effects it emits (command
// blocks via the actuator bus, puppets, camera view, audio, HUD). No gameplay
// runs in LOBBY / RESET / FREE_ROAM: animatronics hold rest poses.

import { world, system, InputButton, ButtonState, GameMode } from '@minecraft/server';
import { NightSession } from '../core/session.js';
import { CONFIG, LAST_NIGHT, STORE_NIGHTS, nightVariant, nightDef } from '../core/config.js';
import { mixSeed } from '../core/rng.js';
import { GuideGraph } from '../core/guide_path.js';
import { ANCHORS, OFFICE_BOUNDS, ROOM_BY_ID, interior } from '../data/layout.js';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { NODE_BY_ID } from '../data/nodes.js';
import { TAPE, TAPE_UNLOCK_NIGHT, NAME_SIGN } from '../data/lore.js';
import { INPUTS, inputCbPos } from '../data/inputs.js';
import { isKnownInputAction } from '../data/input_actions.js';
import { PHONE, TASKS, MAINTENANCE, SECRETS, ENDING, TUTORIAL_STEPS, FLASHBACK, FINAL_CHOICE, NIGHT_NINE_ENDING } from '../data/story.js';
import { ActuatorBus } from './actuator_bus.js';
import { settleTicks } from '../data/actuators.js';
import { Builder, BUILD_VERSION } from './builder.js';
import { Puppets, MAIN } from './puppets.js';
import { CameraView, restorePlayerView } from './camera_view.js';
import { Audio } from './audio.js';
import { Hud, hourLabel } from './hud.js';
import { giveKit, clearKit, ITEMS, ANCHOR_SLOT } from './items.js';
import * as ui from './ui.js';
import { loadSave, storeSave, eraseSave, defaultSave, markSession, readSession, clearSession, loadBuild, storeHoliday } from './persistence.js';
import { Holidays, seasonFor } from './holidays.js';
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
const OFFICE_TARGET = 'anchor:officeSeat'; // route-guidance target name (data/guide_graph.generated.js)
// = minecraft:scale in BP entities (validate_assets checks); the owner's models keep the old in-game heights (tools/owner_models.py).
const SCALE = Object.freeze({ freddy: 0.992, bonnie: 0.605, chica: 1.3, fredbear: 1.09, morgrave: 0.768, valek: 0.87 });
// Eye height of each model at scale 1 (blocks): the jumpscare camera and the stare look from here.
const EYE_HEIGHT = Object.freeze({ freddy: 2.604, bonnie: 3.986, chica: 1.55, fredbear: 2.64, morgrave: 3.259, valek: 3.442 });
const FREDBEAR_JUMPSCARES = 3; // fb:variant 0-2 picks one of the V6 jumpscares (snap bite, dual lunge, left grab)
const MUSIC_TRACK = 'fb.night.bgm'; // "Pizza Dinner" (music category: replaces Minecraft's own music while it plays)
const SHOT = 70; // ticks per cutscene caption
// Cutscene camera spots (local).
const SCENES = Object.freeze({
  dinerStage: { from: { x: 40.5, y: -6.2, z: 61.5 }, to: { x: 40.5, y: -6.6, z: 50.5 } },
  dinerWall: { from: { x: 73.5, y: -7.4, z: 85.5 }, to: { x: 64.5, y: -8, z: 85.5 } },
  showStage: { from: { x: 100.5, y: 5, z: 50.5 }, to: { x: 100.5, y: 2, z: 22.5 } },
  frontLot: { from: { x: 100.5, y: 6, z: 190.5 }, to: { x: 100.5, y: 12, z: 152 } },
});
// Camera map HUD (RP ui/hud_screen.json): an invisible title made only of formatting codes tells the HUD
// to draw the map and which camera to highlight ("§k§r§k§r§l" + the camera number as two codes).
const MAP_ON = '§k§r§k§r§l';
const MAP_OFF = '§k§r§k§r§o';
const mapTitle = (cam) => (cam ? MAP_ON + cam.slice(1).split('').map((d) => `§${d}`).join('') : MAP_OFF);
const STARE_AFTER = 40; // ticks of watching an animatronic on camera before it turns its head to the lens
const ROAM_LOOK_RANGE = 14; // Free Roam: animatronics this close turn their heads to follow you
const CAM_HUM_TICKS = 200; // fb.cam.hum restarts every 10 s while the monitor is up (tools/gen_sounds.py HUM_PERIOD)
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
    this.routes = new GuideGraph();
    this.camHum = []; // fb.cam.hum SoundInstances (tickCamHum)
    this.camHumNext = 0;
    this.musicPlaying = false;
    this.holidays = new Holidays();
    this.challenge = null; // { id, title, base, overrides, mods } while a challenge mode runs
    this.tour = null; // intro camera tour
    this.flashback = null; // night 4 memory scene
    this.tape = null; // the 1987 security tapes (office TAPE DECK)
    this.stareTicks = Object.create(null); // per animatronic: ticks watched on the current camera
    this.guideLeft = undefined; // blocks left on the current breadcrumb route
    this.outdatedBuild = false; // built by an older pack version: /fb:setup rebuilds
    /** @type {((action: string, player: any) => any) | undefined} */
    this.debugHook = undefined;
    /** Developer command entry for `/scriptevent fb:debug <action> [a1] [a2]` (the helper .mcfunction files). */
    /** @type {((action: string, a1: string | undefined, a2: string | undefined, player: any) => any) | undefined} */
    this.debugCommand = undefined;
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
    this.stopMusic(true);
    if (!this.builder.isBuilt()) {
      const b = loadBuild();
      this.outdatedBuild = b.done && b.version !== BUILD_VERSION;
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
          if (now % 60 === 0) {
            const text = this.outdatedBuild
              ? '§eFREDBEAR: SIX NIGHTS BELOW was updated\n§fRun §b/fb:setup§f to rebuild the map (your progress is kept).'
              : '§eFREDBEAR: SIX NIGHTS BELOW\n§fRun §b/fb:setup§f to build the map (cheats on).';
            for (const p of world.getAllPlayers()) p.onScreenDisplay.setActionBar(text);
          }
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
        case 'FLASHBACK':
          this.tickFlashback(now);
          break;
        default:
      }
    } catch (e) {
      log.error(`tick (${this.state})`, e);
    }
    if (this.tape) this.tickTape(now);
    this.tickCamHum(now);
    this.bus.tick();
  }

  /** The camera feed's electrical hum: plays while the monitor is up, stops with it (any close path). */
  tickCamHum(now) {
    if (!this.cams.active) {
      if (this.camHum.length) {
        for (const inst of this.camHum) {
          try {
            inst.stop();
          } catch {
            // already finished
          }
        }
        this.camHum = [];
      }
      return;
    }
    if (now < this.camHumNext && this.camHum.length) return;
    const g = this.guard();
    if (!g) return;
    try {
      this.camHum = [...this.camHum.slice(-1), g.playSound('fb.cam.hum')]; // the previous copy fades out under the new one
      this.camHumNext = now + CAM_HUM_TICKS;
    } catch (e) {
      log.warn(`camera hum: ${e?.message ?? e}`);
      this.camHumNext = now + CAM_HUM_TICKS;
    }
  }

  tickRest(now) {
    if (this.state === 'FREE_ROAM' && now % 10 === 0) this.roamLooks();
    if (now % (this.state === 'FREE_ROAM' ? 10 : 20) === 0 && !this.tape) this.puppets.sync(null, 'perform');
    if (now % 40 === 0) {
      const g = this.guard();
      if (!g) return;
      const text = this.state === 'FREE_ROAM'
        ? '§bFREE ROAM§f - explore safely. Secrets found: ' + `${this.save.secrets.length}/12\n§7Press FREE ROAM at the time clock to return.`
        : `§eTIME CLOCK§f - choose a night. Unlocked: §a${this.save.unlocked}/${LAST_NIGHT}${this.save.campaignDone ? ' §6(campaign complete: CHALLENGES open)' : ''}`;
      if (!this.hudBusy(now)) g.onScreenDisplay.setActionBar(text);
    }
  }

  hudBusy(now) {
    return this.hud.message && now < this.hud.messageUntil;
  }

  // ================================================================ music
  musicWanted() {
    return this.save.settings.music !== false;
  }

  /** Night music: loops while a shift runs; a music-category track replaces Minecraft's own music. Night 9 has none. */
  startMusic() {
    if (!this.musicWanted() || this.musicPlaying || this.session?.def.music === false) return;
    const g = this.guard();
    if (!g) return;
    try {
      g.playMusic(MUSIC_TRACK, { loop: true, fade: 1.5, volume: 0.7 });
      this.musicPlaying = true;
    } catch (e) {
      log.warn(`music: ${e?.message ?? e}`);
    }
  }

  /** @param {boolean} [force] also when this script instance did not start it (after /reload or a world load) */
  stopMusic(force = false) {
    if (!this.musicPlaying && !force) return;
    this.musicPlaying = false;
    for (const p of world.getAllPlayers()) {
      try {
        p.stopMusic();
      } catch {
        // ignore
      }
    }
  }

  /** Shift Guide / settings switch. Takes effect immediately during a shift. */
  toggleMusic(on = !this.musicWanted()) {
    this.save.settings.music = on;
    storeSave(this.save);
    if (!on) this.stopMusic();
    else if (this.state === 'NIGHT' && this.session && ['RUNNING', 'MAINT'].includes(this.session.phase) && this.night >= 1) this.startMusic();
  }

  /** Seasonal decorations follow the device date (and the settings switch); only changed outside nights. */
  syncHolidays() {
    try {
      this.holidays.sync(this.save.settings.holidays === false ? null : seasonFor(new Date()));
    } catch (e) {
      log.warn(`holidays: ${e?.message ?? e}`);
    }
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
      storeHoliday(null); // a fresh build has no seasonal decorations yet
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
    this.stopMusic();
    if (this.tour || this.flashback) runCmd(COMMAND_TEMPLATES.sceneFogPop[0]);
    this.session = null;
    this.challenge = null;
    this.tour = null;
    this.flashback = null;
    this.tape = null;
    this.stareTicks = Object.create(null);
    this.puppets.looks = Object.create(null);
    this.puppets.withered = false;
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
    runCmd(COMMAND_TEMPLATES.camFogPop[0]);
    runCmd(COMMAND_TEMPLATES.sceneFogPop[0]);
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
    for (const id of this.save.challenges) this.bus.trigger(`lobby.chal_${id}`);
    this.puppets.sync(null, 'perform');
    this.state = target === 'free_roam' ? 'FREE_ROAM' : target === 'office' ? 'RESET' : 'LOBBY';
    if (target !== 'office') {
      this.syncHolidays();
      this.writeNameSign();
    }
  }

  /** Fredbear's chamber names wall (lore): after night 6 the guard's own name is the newest one. */
  writeNameSign() {
    try {
      const g = this.guard();
      const sign = dim().getBlock(W(NAME_SIGN.x, NAME_SIGN.y, NAME_SIGN.z))?.getComponent('minecraft:sign');
      if (!sign) return;
      const text = this.save.campaignDone && g ? `§8${g.name.toUpperCase()}\n§4tonight` : ' ';
      if (sign.getText() !== text) {
        sign.setWaxed(false);
        sign.setText(text);
        sign.setWaxed(true);
      }
    } catch (e) {
      log.warn(`name sign: ${e?.message ?? e}`);
    }
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
      return this.deny(player, n === 7 ? 'Night 7 is locked. Beat night 6 first.' : `Night ${n} is locked. Survive night ${n - 1} first.`);
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

  /** @param {number} n @param {{ challenge?: string }} [opts] */
  enterIntro(n, { challenge } = {}) {
    this.fullReset('lobby');
    this.night = n;
    this.challenge = challenge ? { id: challenge, ...CONFIG.challenges[challenge] } : null;
    this.state = 'INTRO';
    const task = this.challenge ? undefined : TASKS[n];
    this.intro = { started: system.currentTick, task, taskDone: false, deadline: system.currentTick + 20 * 180 };
    this.applyGates(n);
    this.puppets.withered = this.witheredNight(n);
    const label = this.nightLabel();
    this.hudMessage(`11:55 PM - ${label}. Walk to the SECURITY OFFICE and press START SHIFT.${task ? ` ${task.text}` : ''}`, 260);
    const g = this.guard();
    if (g) g.onScreenDisplay.setTitle(`§f${label}`, { fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20, subtitle: this.challenge ? 'CHALLENGE' : this.nightTitle(n).replace(/^Night \d+ — /, '') });
    this.startTour(n);
  }

  /** Night overrides that are not a challenge: night 8 follows the last night 7 ending (seal: Morgrave, burn: Valek). */
  nightOverrides(n) {
    return n === 8 ? nightVariant(8, this.save.lastEnding ?? 'seal') : {};
  }

  /** Tonight's phone call (night 8 has one per night 7 ending). */
  phoneLines(n) {
    return PHONE[n === 8 ? `8_${this.save.lastEnding ?? 'seal'}` : n] ?? [];
  }

  nightTitle(n) {
    return nightDef(n, this.nightOverrides(n)).title;
  }

  /** The trio wear their withered suits on nights 7-9 and in every challenge. */
  witheredNight(n) {
    return n >= 7 || !!this.challenge;
  }

  /** "Night 4" or the challenge title. */
  nightLabel() {
    return this.challenge ? `Challenge: ${this.challenge.title}` : `Night ${this.night}`;
  }

  /** Rest pose for the stage trio outside a night (powered down before nights 7 and 9 / the Fredbear-only challenge). */
  restAnim() {
    return STORE_NIGHTS.includes(this.night) || this.challenge?.id === 'fredbear_only' ? 'dormant' : 'perform';
  }

  // ---------------------------------------------------------------- intro camera tour
  /** 11:55 tour through the cameras that show where everyone starts (sneak skips). */
  startTour(n) {
    const g = this.guard();
    if (!g) return;
    /** @type {[string, number][]} [camera, ticks] */
    const shots = [['C01', 60], ['C07', 34], ['C12', 34]];
    if (n >= 4) shots.push(['C16', 50]);
    if (n >= 7) shots.push(['C06', 40]); // Parts & Service: Valek standing there, and the trio on nights 7 and 9
    if (n >= 8) shots.push(['C19', 40], ['C18', 30]); // the chamber and the duct
    this.tour = { shots, i: 0, next: system.currentTick + 20 };
    this.intro.deadline += shots.reduce((a, s) => a + s[1], 20);
  }

  tickTour(now, g) {
    const t = this.tour;
    if (now < t.next) return;
    if (t.i >= t.shots.length) return this.endTour();
    const [cam, ticks] = t.shots[t.i];
    try {
      if (t.i === 0) this.cams.open(g, cam);
      else this.cams.show(cam);
      const c = CAMERA_BY_ID[cam];
      g.onScreenDisplay.setTitle(' ', { fadeInDuration: 0, stayDuration: ticks, fadeOutDuration: 5, subtitle: `§7${c.label}${t.i === 0 ? ' · §fsneak to skip' : ''}` });
    } catch (e) {
      log.warn(`tour: ${e?.message ?? e}`);
    }
    t.i++;
    t.next = now + ticks;
  }

  endTour() {
    if (!this.tour) return;
    this.tour = null;
    this.cams.close();
    const g = this.guard();
    try {
      g?.onScreenDisplay.setTitle(' ', { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 });
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- night 4 flashback
  /** First night 4 only: a short memory of 1983 on the old diner stage, then the shift starts. */
  startFlashback() {
    const g = this.guard();
    if (!g) return this.beginNight(this.night, { teleport: true });
    this.endTour();
    this.state = 'FLASHBACK';
    this.flashback = { step: 0, next: system.currentTick + 10 };
    this.save.flashbackSeen = true;
    storeSave(this.save);
    runCmd(COMMAND_TEMPLATES.sceneFogFlashback[0]);
    try {
      g.addEffect('night_vision', 20 * 60, { amplifier: 0, showParticles: false });
      const n = NODE_BY_ID.DINER_STAGE;
      this.puppets.apply('fredbear', { x: n.x, y: n.y, z: n.z, yaw: n.yaw ?? 0, anim: 'perform', eyes: false, hidden: false });
      g.camera.setCamera('minecraft:free', { location: Wv(SCENES.dinerStage.from), facingLocation: Wv(SCENES.dinerStage.to) });
    } catch (e) {
      log.warn(`flashback: ${e?.message ?? e}`);
    }
    this.audio.play({ id: 'fb.fredbear.musicbox', at: 'player', vol: 0.5, loopKey: 'flashback' }, g);
    return true;
  }

  tickFlashback(now) {
    const f = this.flashback;
    const g = this.guard();
    if (!f || !g || now < f.next) return;
    if (f.step >= FLASHBACK.length) return this.endFlashback();
    const [title, sub] = FLASHBACK[f.step];
    try {
      if (f.step === FLASHBACK.length - 2) this.audio.stop('flashback');
      if (f.step === FLASHBACK.length - 1) {
        const n = NODE_BY_ID.DINER_STAGE;
        this.puppets.apply('fredbear', { x: n.x, y: n.y, z: n.z, yaw: n.yaw ?? 0, anim: 'threat', eyes: true, hidden: false });
        g.playSound('fb.fredbear.laugh', { volume: 1.0 });
      }
      g.onScreenDisplay.setTitle(title, { fadeInDuration: 10, stayDuration: SHOT - 20, fadeOutDuration: 10, subtitle: sub });
    } catch (e) {
      log.warn(`flashback shot ${f.step}: ${e?.message ?? e}`);
    }
    f.step++;
    f.next = now + SHOT;
  }

  endFlashback() {
    const g = this.guard();
    this.flashback = null;
    this.audio.stop('flashback');
    runCmd(COMMAND_TEMPLATES.sceneFogPop[0]);
    if (g) {
      restorePlayerView(g);
      try {
        g.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.1, holdTime: 0.6, fadeOutTime: 0.6 } });
      } catch {
        // ignore
      }
    }
    this.state = 'INTRO';
    this.beginNight(this.night, { teleport: true });
  }

  /** Start the shift (START SHIFT or the intro deadline); night 4 shows the flashback the first time. */
  startShift() {
    this.endTour();
    if (this.night === 4 && !this.challenge && !this.save.flashbackSeen) return this.startFlashback();
    return this.beginNight(this.night, { teleport: true });
  }

  tickIntro(now) {
    if (now % 20 === 0 && !this.tape) this.puppets.sync(null, this.restAnim());
    if (this.tape) return;
    const g = this.guard();
    if (!g) return;
    if (this.tour) return this.tickTour(now, g);
    const toTask = this.intro.task && !this.intro.taskDone;
    if (now % 10 === 0) this.guideLeft = this.guideTo(g, toTask ? this.targetFor(this.intro.task.action) : OFFICE_TARGET);
    if (now % 40 === 0 && !this.hudBusy(now)) {
      const left = Math.max(0, Math.ceil((this.intro.deadline - now) / 20));
      const route = this.guideLeft ? ` · §a${this.guideLeft} blocks§7 (follow the green sparkles)` : '';
      g.onScreenDisplay.setActionBar(`§fNight ${this.night} starts at midnight · §e${left}s\n§7${toTask ? 'Optional task first, then the office' : 'Go to the office and press §aSTART SHIFT§7'}${route}`);
    }
    if (now >= this.intro.deadline) {
      this.hudMessage('Midnight. Your shift has started.', 80);
      this.startShift();
    }
  }

  /** Route-guidance target name for a task / maintenance action (the input's standing spot). */
  targetFor(action) {
    return INPUTS.find((i) => i.action === action)?.id ?? OFFICE_TARGET;
  }

  /**
   * Breadcrumb sparkles along the walkable route to `target` (doors, corridors,
   * stairs and ladders from the generated guide graph, never through walls).
   * @returns {number | undefined} blocks left to walk, 0 when arrived
   */
  guideTo(player, target) {
    try {
      const r = this.routes.route(L(player.location), target);
      if (!r) return undefined;
      if (r.arrived) return 0;
      for (const c of GuideGraph.crumbs(r.points)) dim().spawnParticle('minecraft:villager_happy', Wv({ x: c.x, y: c.y + 0.35, z: c.z }));
      return Math.max(1, Math.round(r.remaining));
    } catch (e) {
      log.warn(`guide: ${e?.message ?? e}`);
      return undefined;
    }
  }

  // ================================================================ nights
  beginNight(n, { teleport = false, overrides = {}, options = {}, scenario = null } = {}) {
    const g = this.guard();
    if (!g) return;
    this.endTour();
    this.night = n;
    const s = this.save.settings;
    const seed = s.deterministic ? s.seed : mixSeed(system.currentTick, Math.floor(Math.random() * 0xffffffff));
    const ch = this.challenge;
    this.endTape();
    this.puppets.withered = this.witheredNight(n);
    this.stareTicks = Object.create(null);
    this.session = new NightSession({
      night: n,
      seed,
      overrides: ch ? { ...ch.overrides, ...overrides } : { ...this.nightOverrides(n), ...overrides },
      options: { captions: s.captions, taskBonusPower: this.taskBonus.power, bonusCharges: this.taskBonus.charge ? 1 : 0, ...(ch ? { mods: ch.mods } : {}), ...options },
    });
    this.seed = seed;
    markSession({ active: true, night: n, seed, challenge: ch?.id });
    this.state = 'NIGHT';
    this.maint = null;
    this.timers.phone = { lines: ch ? [ch.text] : this.phoneLines(n), i: 0, next: system.currentTick + 40 };
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
    if (n >= 1) this.startMusic();
    log.info(`night ${n} started, seed ${seed}${ch ? `, challenge ${ch.id}` : ''}`);
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

    if (now % 4 === 0) this.stareLooks(s);
    if (this.cams.active && now % 60 === 0) this.showCamMap(g, s.devices.cams.cam);
    if (s.phase !== 'JUMPSCARE' && s.phase !== 'LOST') this.puppets.sync(s);
    this.tickPhone(now, g);
    this.tickDisplays();
    if (this.tutorial) this.tickTutorial(now);
    if (this.cams.active) this.cams.tick(this.camCover(s));
    if (s.phase === 'MAINT' && now % 10 === 0 && this.maint) this.guideLeft = this.guideTo(g, this.maint.done ? OFFICE_TARGET : this.targetFor(MAINTENANCE[this.maint.task].action));
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
      const route = this.guideLeft ? ` · §a${this.guideLeft} blocks§7 - follow the green sparkles` : '';
      g.onScreenDisplay.setActionBar(`§e${m.title}§f - ${this.maint.done ? 'Done. Return to the office and press START/RESUME.' : m.hint ?? m.text}\n§7Clock paused · animatronics offline${route}`);
      return;
    }
    g.onScreenDisplay.setActionBar(this.hud.nightLines(snap, view, now, { captions: this.save.settings.captions || !!snap.mods.captions, overlay, title: this.challenge?.title.toUpperCase() }));
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
        // While the monitor is up the hour goes in the subtitle so the camera map (title) stays on screen.
        if (this.cams.active && this.save.settings.camMap !== false) g.onScreenDisplay.setTitle(mapTitle(s.devices.cams.cam), { fadeInDuration: 0, stayDuration: 120, fadeOutDuration: 0, subtitle: `§f${hourLabel(f.hour)}` });
        else g.onScreenDisplay.setTitle(`§f${hourLabel(f.hour)}`, { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 15 });
        if (f.hour >= 2 && s.rng.chance(0.6)) this.bus.trigger(s.rng.chance(0.5) ? 'env.flicker_whall' : 'env.flicker_ehall');
        if (f.hour === 3) this.bus.trigger('env.pipes');
        if (s.def.music === false && f.hour >= 1) this.bus.trigger(f.hour % 2 ? 'env.distant_music' : 'env.pipes'); // night 9: only the building
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
          this.showCamMap(g, f.cam);
        } else if (f.open) {
          this.cams.show(f.cam);
          this.showCamMap(g, f.cam);
        } else if (this.cams.active) {
          this.cams.close();
          this.bus.trigger('cam.down');
          for (const c of COMMAND_TEMPLATES.hudReset) runCmd(c);
          this.showCamMap(g, null);
        }
        if (this.tutorial) this.tutorialEvent(f.open ? (f.reason === 'switch' ? 'cam_switch' : 'cams_open') : 'cams_close');
        break;
      case 'disrupt':
        if (f.on) this.bus.trigger('cam.server_fault');
        break;
      case 'held':
        this.hud.setMessage(`The ${s.entryLabel(f.entry)} held - it won't hold him again tonight.`, system.currentTick, 80);
        break;
      case 'echo':
        if (f.on) {
          this.echo = { cam: f.cam, node: f.node, kind: f.kind };
          this.puppets.showEcho(f.node, f.kind === 'shadow' ? 'shadow' : 'echo');
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
        if (f.stage === 'down') {
          this.stopMusic();
          g.onScreenDisplay.setTitle('§cPOWER OUT', { fadeInDuration: 0, stayDuration: 40, fadeOutDuration: 20 });
        } else if (f.stage === 'restored') this.startMusic();
        if (f.stage === 'down' && this.cams.active) this.showCamMap(g, null);
        break;
      case 'repel':
        this.hud.setMessage('Fredbear repelled!', system.currentTick, 60);
        break;
      case 'finale':
        g.onScreenDisplay.setTitle('§6THE GOLDEN HOUR', { fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20, subtitle: 'the others are withdrawing' });
        break;
      case 'jumpscare':
        this.stopMusic();
        this.showCamMap(g, null);
        this.jumpscare(f.who, g, f.style);
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
    const names = { door_l: 'LEFT DOOR', door_r: 'RIGHT DOOR', light_l: 'LEFT LIGHT', light_r: 'RIGHT LIGHT', cams_open: 'CAMERAS', cam_select: 'CAMERAS', strobe: 'STROBE', hatch: 'HATCH', breaker: 'BREAKER', reserve: 'RESERVE', seal_vent: 'VENT SEAL', seal_shaft: 'SHAFT SEAL' };
    if (f.ok && (f.action === 'seal_vent' || f.action === 'seal_shaft')) this.hud.setMessage(`${f.action === 'seal_vent' ? 'The vent' : 'The shaft'} is sealed for ${Math.round(CONFIG.seals.duration / 20)} s`, system.currentTick, 60);
    if (f.reason === 'cooldown' || f.reason === 'same camera') return;
    try {
      g.playSound('fb.ui.deny', { volume: 0.7 });
    } catch {
      // ignore
    }
    this.hud.setMessage(`${names[f.action] ?? f.action}: ${f.reason}`, system.currentTick, 50);
  }

  // ================================================================ outcomes
  /** @param {'front' | 'below' | 'vent'} [style] where the attack comes from (docs/04 "Jumpscares by place") */
  jumpscare(who, g, style = 'front') {
    this.cams.close();
    try {
      const eye = g.getHeadLocation();
      const dir = g.getViewDirection();
      const flat = Math.hypot(dir.x, dir.z) || 1;
      const variant = who === 'fredbear' ? Math.floor(Math.random() * FREDBEAR_JUMPSCARES) : 0;
      if (style === 'below') g.playSound('fb.door.jam', { volume: 1.2 });
      else if (style === 'vent') g.playSound('fb.vent.clank', { volume: 1.4 });
      const head = this.puppets.lunge(who, eye, { x: dir.x / flat, y: 0, z: dir.z / flat }, (EYE_HEIGHT[who] ?? 1.55) * (SCALE[who] ?? 1.2), variant, style);
      if (head) g.camera.setCamera('minecraft:free', { location: eye, facingLocation: head });
    } catch (e) {
      log.warn(`jumpscare camera: ${e?.message ?? e}`);
    }
  }

  onWin(g) {
    const n = this.night;
    const ch = this.challenge;
    clearSession();
    this.stopMusic();
    this.cams.close();
    this.bus.trigger('win.six_am');
    this.bus.trigger('night.end');
    runCmd(COMMAND_TEMPLATES.fogPop[0]);
    g.onScreenDisplay.setTitle('§f6 AM', { fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20, subtitle: n === 0 ? 'Training complete' : `${this.nightLabel()} complete` });
    if (ch) {
      if (!this.save.challenges.includes(ch.id)) this.save.challenges.push(ch.id);
      this.save.stats.wins++;
      storeSave(this.save);
    } else if (n >= 1) {
      if (!this.save.completed.includes(n)) this.save.completed.push(n);
      this.save.unlocked = Math.max(this.save.unlocked, Math.min(LAST_NIGHT, n + 1));
      this.save.stats.wins++;
      if (n === 6) this.save.campaignDone = true;
      storeSave(this.save);
    }
    this.state = 'RESULT';
    this.result = { won: true, night: n, challenge: ch?.id, at: system.currentTick + 140 };
  }

  onLose(who, g) {
    clearSession();
    this.stopMusic();
    this.save.stats.deaths++;
    storeSave(this.save);
    this.bus.trigger('lose.static');
    try {
      g.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.2, holdTime: 2.5, fadeOutTime: 0.5 } });
      g.onScreenDisplay.setTitle('§4GAME OVER', { fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 20, subtitle: `${this.nightLabel()} · ${hourLabel(this.session?.hour ?? 0)}` });
    } catch {
      // ignore
    }
    this.state = 'RESULT';
    this.result = { won: false, night: this.night, challenge: this.challenge?.id, at: system.currentTick + 70 };
  }

  tickResult(now) {
    const r = this.result;
    if (!r || now < r.at || r.asked) return;
    r.asked = true;
    const g = this.guard();
    for (const p of world.getAllPlayers()) restorePlayerView(p);
    if (r.won && !r.challenge && r.night === 6) {
      this.startEnding();
      return;
    }
    if (r.won && !r.challenge && r.night === 7) {
      this.startFinalEnding();
      return;
    }
    if (r.won && !r.challenge && r.night === 9) {
      this.startNightNineEnding();
      return;
    }
    if (r.night === 0) {
      this.fullReset('lobby');
      return;
    }
    this.fullReset(r.won ? 'lobby' : 'office');
    if (!g) return;
    const label = r.challenge ? `Challenge: ${CONFIG.challenges[r.challenge].title}` : `Night ${r.night}`;
    ui.resultForm(g, { won: r.won, night: r.night, label, canNext: r.won && !r.challenge && [1, 2, 3, 4, 5, 8].includes(r.night) }).then((choice) => {
      if (choice === 'next') {
        this.state = 'LOBBY';
        this.enterIntro(r.night + 1);
      } else if (choice === 'retry') {
        // Immediate retry: straight into the office, shift starts in 3 s.
        this.fullReset('office');
        this.state = 'RESET';
        system.runTimeout(() => {
          this.challenge = r.challenge ? { id: r.challenge, ...CONFIG.challenges[r.challenge] } : null;
          this.beginNight(r.night, { teleport: true });
        }, 60);
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
    if (!g || !e) return;
    if (e.kind === 'final') return this.tickFinalEnding(now, g);
    if (e.kind === 'nine') return this.tickNightNineEnding(now, g);
    if (now < e.next) return;
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
        this.hudMessage('NIGHT 7 and the CHALLENGES are now open at the time clock.', 200);
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

  // ---------------------------------------------------------------- night 7 ending (the player's choice)
  startFinalEnding() {
    this.fullReset('lobby');
    this.state = 'ENDING';
    this.ending = { kind: 'final', choice: null, step: 0, next: Infinity };
    const g = this.guard();
    if (!g) return;
    try {
      g.camera.setCamera('minecraft:free', { location: Wv(SCENES.frontLot.from), facingLocation: Wv(SCENES.frontLot.to) });
    } catch {
      // ignore
    }
    ui.finalChoiceForm(g).then((choice) => {
      if (!this.ending || this.ending.kind !== 'final') return;
      this.ending.choice = choice;
      this.ending.next = system.currentTick + 10;
      if (!this.save.endings.includes(choice)) this.save.endings.push(choice);
      this.save.lastEnding = choice; // decides which night 8 comes next
      if (!this.save.completed.includes(7)) this.save.completed.push(7);
      this.save.unlocked = Math.max(this.save.unlocked, 8);
      storeSave(this.save);
    });
  }

  tickFinalEnding(now, g) {
    const e = this.ending;
    if (!e.choice) return;
    if (e.choice === 'burn' && e.step >= 1 && e.step <= 5 && now % 2 === 0) this.fireFx(e.step - 1);
    if (now < e.next) return;
    const lines = FINAL_CHOICE[e.choice].lines;
    const camAt = (sc) => g.camera.setCamera('minecraft:free', { location: Wv(SCENES[sc].from), facingLocation: Wv(SCENES[sc].to) });
    const n = NODE_BY_ID.DINER_STAGE;
    const fredbear = (anim, eyes, hidden = false) => this.puppets.apply('fredbear', { x: n.x, y: n.y, z: n.z, yaw: n.yaw ?? 0, anim, eyes, hidden });
    try {
      if (e.step < lines.length) {
        const [title, sub] = lines[e.step];
        if (e.choice === 'seal') {
          if (e.step === 0) {
            this.bus.trigger('sig.diner_unseal');
            camAt('dinerWall');
            system.runTimeout(() => this.bus.trigger('sig.diner_seal'), 30);
            system.runTimeout(() => g.playSound('fb.door.close', { volume: 1 }), 31);
          } else if (e.step === 1) {
            camAt('dinerStage');
            fredbear('dormant', true);
            this.audio.play({ id: 'fb.fredbear.musicbox', at: 'player', vol: 0.6, loopKey: 'final' }, g);
            system.runTimeout(() => this.audio.stop('final'), 50);
          } else if (e.step === 2) {
            camAt('frontLot');
          } else if (e.step === 3) {
            camAt('dinerStage');
            fredbear('dormant', true);
            system.runTimeout(() => fredbear('dormant', false), 45);
          } else camAt('frontLot');
        } else {
          if (e.step === 0) {
            camAt('dinerStage');
            fredbear('idle', true);
            runCmd(COMMAND_TEMPLATES.sceneFogFire[0]);
            g.playSound('fb.ending.fire', { volume: 0.6 });
          } else if (e.step === 1) {
            camAt('showStage');
            g.playSound('fb.ending.fire', { volume: 1 });
          } else if (e.step === 2) {
            camAt('dinerStage');
            fredbear('threat', true);
            this.audio.play({ id: 'fb.fredbear.musicbox', at: 'player', vol: 0.8, pitch: 1.5, loopKey: 'final' }, g);
            system.runTimeout(() => {
              this.audio.stop('final');
              fredbear('dormant', false, true);
            }, 60);
          } else if (e.step === 3) {
            runCmd(COMMAND_TEMPLATES.sunrise[0]);
            camAt('frontLot');
            g.playSound('fb.ending.fire', { volume: 0.8 });
          } else camAt('frontLot');
        }
        g.onScreenDisplay.setTitle(title, { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: sub });
      } else if (e.step === lines.length) {
        this.bus.trigger('win.campaign');
        g.onScreenDisplay.setTitle('§lTHE END', { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: ENDING[5] });
      } else {
        this.audio.stop('final');
        restorePlayerView(g);
        this.fullReset('lobby');
        this.hudMessage(`NIGHT 8 is open at the time clock (${e.choice === 'seal' ? 'something was walled in with him' : 'something walked out of the smoke'}).`, 200);
        ui.extrasForm(g, this.save);
        return;
      }
    } catch (err) {
      log.warn(`final ending ${e.choice} ${e.step}: ${err?.message ?? err}`);
    }
    e.step++;
    e.next = now + 140;
  }

  /** Burn ending: particles only (no real fire, the map is never damaged). `shot` = caption being shown. */
  fireFx(shot) {
    // [x, y, z, half-width, height] (local)
    const spots = shot === 1 ? [[100, 1, 27, 16, 5]] : shot >= 3 ? [[100, 0, 153.5, 40, 13], [100, 13, 150, 40, 3]] : [[40.5, -8, 51.5, 3, shot === 2 ? 4 : 2]];
    try {
      for (const [cx, cy, cz, w, h] of spots) {
        for (let k = 0; k < 4; k++) {
          const p = { x: cx + (Math.random() - 0.5) * 2 * w, y: cy + Math.random() * h, z: cz + (Math.random() - 0.5) * 3 };
          dim().spawnParticle(k % 2 ? 'minecraft:basic_flame_particle' : 'minecraft:mobflame_single', Wv(p));
          if (k === 0) dim().spawnParticle('minecraft:campfire_tall_smoke_particle', Wv({ x: p.x, y: p.y + 1, z: p.z }));
        }
      }
    } catch {
      // unloaded: skip this frame
    }
  }

  // ================================================================ camera map, stare, head turns
  /** Camera map HUD (117): marker title on (camera to highlight) or off. Honours the Settings switch. */
  showCamMap(g, cam) {
    if (!g || (this.save.settings.camMap === false && cam)) return;
    try {
      g.onScreenDisplay.setTitle(mapTitle(cam), { fadeInDuration: 0, stayDuration: cam ? 120 : 1, fadeOutDuration: 0 });
    } catch {
      // ignore
    }
  }

  /** Head turn from `who`'s pose toward a local point, as fb:look_* values (relative to the body). */
  lookToward(who, p, target, tilt = 0) {
    const headY = p.y + (EYE_HEIGHT[who] ?? 1.55) * (SCALE[who] ?? 1);
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const want = (Math.atan2(-dx, dz) * 180) / Math.PI;
    let rel = want - (p.yaw ?? 0);
    while (rel > 180) rel -= 360;
    while (rel < -180) rel += 360;
    if (Math.abs(rel) > 120) return { yaw: 0, pitch: 0, tilt: 0 }; // behind them: they do not turn that far
    const pitch = (-Math.atan2(target.y - headY, Math.hypot(dx, dz)) * 180) / Math.PI;
    const clamp = (v, m) => Math.max(-m, Math.min(m, Math.round(v)));
    return { yaw: clamp(rel, 80), pitch: clamp(pitch, 50), tilt: clamp(tilt, 30) };
  }

  /** The stare (11): whoever you watch on a camera slowly turns to look straight into the lens, head tilted. */
  stareLooks(s) {
    const c = s.devices.cams;
    const cam = c.open && !this.camCover(s) ? CAMERA_BY_ID[c.cam] : null;
    const looks = Object.create(null);
    for (const id of s.order) {
      const a = s.anim[id];
      const p = a.pose();
      if (!cam || p.hidden || a.move || !cam.sees.includes(a.node) || ['attack', 'crawl'].includes(p.anim)) {
        this.stareTicks[id] = 0;
        continue;
      }
      this.stareTicks[id] = (this.stareTicks[id] ?? 0) + 4;
      if (this.stareTicks[id] < STARE_AFTER) continue;
      const [x, y, z] = cam.loc;
      looks[id] = this.lookToward(id, p, { x, y, z }, (id.length % 2 ? 1 : -1) * 16);
    }
    this.puppets.looks = looks;
  }

  /** Free Roam (127): the animatronics turn their heads to follow you when you walk close. */
  roamLooks() {
    const g = this.guard();
    const looks = Object.create(null);
    if (g) {
      const me = L(g.getHeadLocation());
      for (const who of MAIN) {
        const a = this.puppets.applied[who];
        if (!a || Math.hypot(me.x - a.x, me.z - a.z) > ROAM_LOOK_RANGE || Math.abs(me.y - a.y) > 6) continue;
        looks[who] = this.lookToward(who, a, me);
      }
    }
    this.puppets.looks = looks;
  }

  // ================================================================ the 1987 tapes (lore 157)
  startTape(player) {
    if (!['INTRO', 'LOBBY', 'FREE_ROAM'].includes(this.state) || this.tour || this.tape) return this.deny(player, 'The tape deck only plays when no shift is running.');
    if (!this.save.completed.includes(TAPE_UNLOCK_NIGHT)) return this.deny(player, 'The tape deck is jammed. (Survive night 5 first.)');
    const g = player ?? this.guard();
    if (!g) return false;
    this.guardId = g.id;
    this.tape = { i: 0, next: system.currentTick + 10 };
    try {
      g.playSound('fb.cam.static', { volume: 0.8 });
    } catch {
      // ignore
    }
    return true;
  }

  tickTape(now) {
    const t = this.tape;
    const g = this.guard();
    if (!g) return this.endTape();
    if (now < t.next) return;
    if (t.i >= TAPE.length) return this.endTape();
    const [cam, ticks, title, sub, figure] = TAPE[t.i];
    try {
      if (t.i === 0) this.cams.open(g, cam);
      else this.cams.show(cam);
      if (figure) {
        const n = NODE_BY_ID[figure];
        this.puppets.apply('fredbear', { x: n.x, y: n.y, z: n.z, yaw: n.yaw ?? 0, anim: 'look', eyes: true, hidden: false });
      } else this.puppets.apply('fredbear', { ...NODE_BY_ID.CHAMBER_F, yaw: 0, anim: 'dormant', eyes: false, hidden: false });
      g.onScreenDisplay.setTitle(title, { fadeInDuration: 5, stayDuration: ticks - 10, fadeOutDuration: 5, subtitle: `${sub}${t.i === 0 ? ' §7· sneak to stop' : ''}` });
      if (t.i === TAPE.length - 1) g.playSound('fb.cam.static', { volume: 1.0 });
    } catch (e) {
      log.warn(`tape: ${e?.message ?? e}`);
    }
    t.i++;
    t.next = now + ticks;
  }

  endTape() {
    if (!this.tape) return;
    this.tape = null;
    this.cams.close();
    this.save.tapesSeen = true;
    storeSave(this.save);
    const g = this.guard();
    try {
      g?.onScreenDisplay.setTitle(' ', { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 });
    } catch {
      // ignore
    }
    this.puppets.sync(null, this.state === 'INTRO' ? this.restAnim() : 'perform');
  }

  // ================================================================ night 9 ending
  startNightNineEnding() {
    this.fullReset('lobby');
    this.state = 'ENDING';
    this.ending = { kind: 'nine', step: 0, next: system.currentTick + 20 };
  }

  tickNightNineEnding(now, g) {
    const e = this.ending;
    if (now < e.next) return;
    const st = NODE_BY_ID.DINER_STAGE;
    const fl = NODE_BY_ID.DINER_FLOOR;
    const cam = SCENES.dinerStage.from;
    const place = (who, x, z, anim, eyes) => this.puppets.apply(who, { x, y: who === 'fredbear' ? st.y : fl.y, z, yaw: 180, anim, eyes, hidden: false, variant: 0 });
    try {
      if (e.step < NIGHT_NINE_ENDING.length) {
        const [title, sub] = NIGHT_NINE_ENDING[e.step];
        if (e.step === 0) {
          this.bus.trigger('sig.diner_unseal');
          place('fredbear', st.x, st.z, 'dormant', true);
          place('morgrave', st.x - 5, st.z + 6, 'dormant', true);
          place('valek', st.x + 5, st.z + 6, 'dormant', true);
          g.camera.setCamera('minecraft:free', { location: Wv(cam), facingLocation: Wv(SCENES.dinerStage.to) });
          this.audio.play({ id: 'fb.fredbear.musicbox', at: 'player', vol: 0.5, loopKey: 'final' }, g);
        } else if (e.step === 1) {
          this.audio.stop('final');
          this.puppets.looks = Object.fromEntries(['fredbear', 'morgrave', 'valek'].map((w) => [w, this.lookToward(w, this.puppets.applied[w], cam, w === 'valek' ? -18 : 14)]));
          for (const w of ['fredbear', 'morgrave', 'valek']) this.puppets.apply(w, { ...this.puppets.applied[w], anim: 'idle' });
        } else if (e.step === 2) {
          runCmd(COMMAND_TEMPLATES.sunrise[0]);
          g.camera.setCamera('minecraft:free', { location: Wv(SCENES.frontLot.from), facingLocation: Wv(SCENES.frontLot.to) });
          this.bus.trigger('win.campaign');
        }
        g.onScreenDisplay.setTitle(title, { fadeInDuration: 10, stayDuration: 110, fadeOutDuration: 10, subtitle: sub });
      } else {
        restorePlayerView(g);
        this.fullReset('lobby');
        this.hudMessage('You survived every night. Thank you for playing.', 200);
        ui.extrasForm(g, this.save);
        return;
      }
    } catch (err) {
      log.warn(`night 9 ending ${e.step}: ${err?.message ?? err}`);
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
      } else if (ev.id === 'fb:setup') {
        // functions/fb/setup.mcfunction and rebuild.mcfunction
        this.setup(ev.message.trim() === 'rebuild');
      } else if (ev.id === 'fb:debug') {
        // functions/fb/{lobby,selftest,debug_overlay}.mcfunction (and any /scriptevent fb:debug ...)
        const [action, a1, a2] = ev.message.trim().split(/\s+/);
        const src = ev.sourceEntity;
        this.debugCommand?.(action, a1, a2, src?.typeId === 'minecraft:player' ? src : undefined);
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
      if (this.state === 'INTRO' && player && this.inOffice(player)) return this.startShift();
      if (this.state === 'NIGHT' && s?.phase === 'MAINT') {
        if (!this.maint?.done) return this.deny(player, 'Finish the maintenance task first.');
        if (!this.inOffice(player)) return this.deny(player, 'Be in the office to resume.');
        s.resumeMaintenance();
        this.maint = null;
        return true;
      }
      return this.deny(player, this.state === 'NIGHT' ? 'Your shift is already running.' : 'Clock in at the time clock first.');
    }
    if (action === 'tapes') return this.startTape(player);
    if (action === 'phone') {
      if (this.state === 'NIGHT') this.timers.phone = { lines: this.challenge ? [this.challenge.text] : this.phoneLines(this.night), i: 0, next: system.currentTick };
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
          if (!v.music) this.stopMusic();
          if (this.state === 'LOBBY' || this.state === 'FREE_ROAM') this.syncHolidays();
        });
        return true;
      case 'extras':
        ui.extrasForm(player, this.save);
        return true;
      case 'clippings':
        ui.clippingsForm(player, this.save);
        return true;
      case 'challenges':
        if (!this.save.campaignDone) {
          this.bus.trigger('lobby.deny');
          return this.deny(player, 'Beat night 6 to unlock the challenges.');
        }
        ui.challengeForm(player, this.save).then((id) => {
          if (!id || this.state !== 'LOBBY') return;
          this.bus.trigger('lobby.accept');
          this.guardId = player?.id;
          this.enterIntro(CONFIG.challenges[id].base, { challenge: id });
        });
        return true;
      case 'reset':
        ui.lobbyConfirm(player, 'Erase progress?', 'This locks nights 2-9 again and clears secrets and settings. It cannot be undone.', 'Erase').then((yes) => {
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
    const guideHooks = { music: () => this.musicWanted(), toggleMusic: () => this.toggleMusic() };
    if (typeId === ITEMS.guide) return void ui.guide(player, guideHooks);
    if (typeId === ITEMS.tablet) {
      if (this.state !== 'NIGHT' || !s) return void ui.guide(player, guideHooks);
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
    if (player.id !== this.guard()?.id) return;
    if (this.tape) return void this.endTape();
    if (this.tour) return void this.endTour();
    if (this.state === 'FLASHBACK') return void this.endFlashback();
    if (this.state === 'NIGHT' && this.session?.devices.cams.open) this.session.input('cams_close');
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
