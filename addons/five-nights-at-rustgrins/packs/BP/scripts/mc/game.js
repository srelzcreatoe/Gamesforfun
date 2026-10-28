// The game: a state machine that glues the pure night simulation
// (core/session.js) to the world.
//
//   UNBUILT -> BUILDING -> LOBBY -> NIGHT(n) -> RESULT -> LOBBY | NIGHT
//                            \-> FREE_ROAM -> LOBBY
//
// The session decides everything that matters for winning or losing; this
// file only renders its effects (puppets, doors, lights, sounds, cameras,
// HUD) and turns player input into session.input(...) calls.

import { system, world, GameMode, ItemStack, ItemLockMode, HudVisibility, HudElement, InputButton, ButtonState, WeatherType } from '@minecraft/server';
import { NightSession } from '../core/session.js';
import { CONFIG, CAST, CAST_NAMES, LAST_NIGHT, CUSTOM_NIGHT } from '../core/config.js';
import { Rng } from '../core/rng.js';
import { generatePlan } from '../data/build_plan.js';
import { OFFICE, LOBBY, SPAWN_OUTSIDE } from '../data/layout.js';
import { NODES } from '../data/nodes.js';
import { CAMERA_BY_ID, CAMERA_ORDER } from '../data/cameras.js';
import { LOBBY_BUTTON_AT, STAR_SLOTS } from '../data/lobby.js';
import { PHONE, ENDINGS, TUTORIAL_HINTS } from '../data/story.js';
import { Builder } from './builder.js';
import { Puppets, yawToward } from './puppets.js';
import { Actuators } from './actuators.js';
import { Audio } from './audio.js';
import { Hud, mapTitle, MAP_OFF, hourLabel } from './hud.js';
import { CameraView, restorePlayerView, FOG } from './camera_view.js';
import * as ui from './ui.js';
import { W, Wv, L, origin, refreshOrigin, setOrigin, runCmd, setLocal, typeAtLocal } from './world_io.js';
import { loadSave, storeSave, storeOrigin, defaultSave, loadBuild } from './persistence.js';
import { log } from './log.js';
import { VERSION } from '../data/version.js';

const wait = (ticks) => new Promise((res) => system.runTimeout(() => res(undefined), ticks));

/** Eye height of each model at scale 1 (blocks) - the jumpscare framing and the camera stare use it. */
const HEAD_Y = Object.freeze({ rustgrin: 2.05, mirehop: 2.05, noxbriar: 2.05, purple_rat: 2.0, cat: 1.95, top_hat_rat: 2.05, rusted: 2.05 });
const NIGHT_HUD = [HudElement.Health, HudElement.Hunger, HudElement.Armor, HudElement.StatusEffects, HudElement.PaperDoll, HudElement.AirBubbles, HudElement.HorseHealth];
/** The hand slot during a shift: it holds the Camera Tablet, and hotbar scrolls on the cameras return here. */
const NEUTRAL_SLOT = 4;
/** Blocks the guard clicks (they carry the fnar:control custom component). */
const CONTROL_BLOCKS = new Set(['fnar:door_button', 'fnar:light_button', 'fnar:crt_monitor', 'fnar:desk_phone']);
const STARE_AFTER = 40;
const GALLERY = Object.freeze({
  rustgrin: { x: 3.5, y: 1, z: 42.5, yaw: 0 }, mirehop: { x: 8.5, y: 1, z: 42.5, yaw: 0 }, noxbriar: { x: 13.5, y: 1, z: 42.5, yaw: 0 },
  purple_rat: { x: 3.5, y: 1, z: 48.5, yaw: 180 }, cat: { x: 8.5, y: 1, z: 48.5, yaw: 180 }, top_hat_rat: { x: 13.5, y: 1, z: 48.5, yaw: 180 },
});
/** Where the band and the troupe perform in free roam. */
const SHOW_SPOTS = Object.freeze({ rustgrin: 'ST_R', mirehop: 'ST_M', noxbriar: 'ST_N', top_hat_rat: 'MW_T', purple_rat: 'MW_P', cat: 'CAB' });

/** Session pose names -> fnar:anim values. */
const POSE_ANIM = Object.freeze({ idle: 'idle', perform: 'perform', stand: 'stand', peek: 'peek', crawl: 'crawl', walk: 'walk', run: 'run', scurry: 'scurry', slump: 'slump' });

export class Game {
  constructor() {
    this.state = 'UNBUILT';
    this.save = loadSave();
    refreshOrigin();
    this.plan = generatePlan();
    this.builder = new Builder((msg, frac, report) => this.onBuildProgress(msg, frac, report));
    this.puppets = new Puppets();
    this.act = new Actuators(this.plan.meta);
    this.audio = new Audio();
    this.hud = new Hud();
    this.cams = new CameraView();
    this.rng = new Rng((Date.now() >>> 0) || 7);
    this.session = null;
    this.guardId = null;
    this.nightLabel = '';
    this.nightOpts = null;
    this.camForm = null;
    /** last control click { key, tick }: the custom component and the interact event both report one click */
    this.lastControl = null;
    this.phoneSeq = null;
    this.stare = Object.create(null);
    this.pendingBuild = false;
    this.overlay = false;
    this.freeRoamNext = 0;
    /** @type {number | undefined} interval that flashes Rustgrin's eyes during the power-out song */
    this.flashEyes = undefined;
  }

  // ================================================================ lifecycle
  start() {
    system.runInterval(() => {
      try {
        this.tick();
      } catch (e) {
        log.error('tick failed', e);
      }
    }, 1);
    world.afterEvents.playerSpawn.subscribe((ev) => this.onSpawn(ev.player, ev.initialSpawn));
    world.afterEvents.buttonPush.subscribe((ev) => this.onButtonPush(ev));
    world.afterEvents.itemUse.subscribe((ev) => this.onItemUse(ev.source, ev.itemStack));
    // Second path for the office controls, besides the fnar:control component: the interact
    // attempt itself. Read-only context, so the click is handled on the next run.
    world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
      if (!ev.isFirstEvent || !CONTROL_BLOCKS.has(ev.block.typeId)) return;
      const player = ev.player;
      const block = { typeId: ev.block.typeId, location: { ...ev.block.location } };
      system.run(() => this.onControl(player, block));
    });
    world.afterEvents.playerHotbarSelectedSlotChange.subscribe((ev) => this.onSlot(ev.player, ev.previousSlotSelected, ev.newSlotSelected));
    world.afterEvents.playerButtonInput.subscribe((ev) => {
      if (ev.button === InputButton.Sneak && ev.newButtonState === ButtonState.Pressed) this.onSneak(ev.player);
    });
    world.afterEvents.playerLeave.subscribe(() => {
      if (this.state === 'NIGHT' && !this.guard()) this.endNightAbort();
    });
    if (this.builder.isBuilt()) {
      this.state = 'LOBBY_PENDING';
      // a world closed mid-night always comes back to the lobby
      system.runTimeout(() => this.enterLobby(), 20);
    } else if (origin.set) {
      // a pizzeria was placed before: resume an interrupted build, or rebuild one made by an older version in place
      const outdated = loadBuild().done;
      system.runTimeout(() => {
        if (outdated) world.sendMessage(`§8[FNaR] §7Updating the pizzeria for version §f${VERSION}§7 (about a minute)...`);
        this.setup(false, undefined);
      }, 40);
    }
    log.info(`ready (built: ${this.builder.isBuilt()}, origin ${origin.set ? `${origin.x},${origin.y},${origin.z}` : 'unset'})`);
  }

  /** For /fnar:debug status: what a player can paste when something is wrong. */
  statusLines() {
    const b = loadBuild();
    const s = this.session;
    const lines = [
      `version ${VERSION}, state ${this.state}, build v${b.version ?? '?'} ${b.done ? 'done' : `phase ${b.phase ?? 0}`}, origin ${origin.set ? `${origin.x} ${origin.y} ${origin.z}` : 'unset'}`,
    ];
    const g = this.guard();
    if (g) {
      const l = L(g.location);
      lines.push(`guard at ${l.x.toFixed(1)} ${l.y.toFixed(1)} ${l.z.toFixed(1)} (seat ${OFFICE.spawn.x} ${OFFICE.spawn.y} ${OFFICE.spawn.z}), slot ${g.selectedSlotIndex}`);
    }
    if (s) {
      const d = s.devices;
      lines.push(`night ${s.night} t${s.t}, power ${s.snapshot().powerPct}%, cams ${d.cams.open ? `up on ${d.cams.cam}` : 'down'}${this.cams.active ? ' (view on)' : ''}${this.camForm ? ' (map open)' : ''}`);
    }
    const seen = [];
    for (const id of [...CAST, 'rusted']) {
      const e = this.puppets.get(id);
      if (!e) continue;
      const l = L(e.location);
      let hidden = false;
      try {
        hidden = !!e.getProperty('fnar:hidden');
      } catch {
        // ignore
      }
      seen.push(`${id} ${l.x.toFixed(0)},${l.y.toFixed(0)},${l.z.toFixed(0)}${hidden ? ' hidden' : ''}`);
    }
    lines.push(`animatronics: ${seen.length ? seen.join(' | ') : 'none in the world'}`);
    return lines;
  }

  /** Two seconds into a night every animatronic should stand in the world; say so in chat if not. */
  checkPuppets() {
    const missing = CAST.filter((id) => !this.puppets.get(id));
    if (missing.length) log.warn(`animatronics missing after the night started: ${missing.join(', ')} (see /fnar:debug status)`);
  }

  guard() {
    if (!this.guardId) return undefined;
    return world.getAllPlayers().find((p) => p.id === this.guardId);
  }

  players() {
    return world.getAllPlayers();
  }

  // ================================================================ building
  /**
   * /fnar:setup or the first-join form. Origin = where `player` stands (unless already set).
   * @param {boolean} rebuild
   * @param {import('@minecraft/server').Player} [player]
   */
  setup(rebuild, player) {
    if (this.builder.running) return;
    if (player && (!origin.set || rebuild)) {
      const l = player.location;
      setOrigin({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) });
      storeOrigin({ x: origin.x, y: origin.y, z: origin.z });
    }
    if (!origin.set) return;
    this.stopNight();
    this.puppets.removeAll();
    this.state = 'BUILDING';
    for (const p of this.players()) {
      try {
        p.setGameMode(GameMode.Creative);
      } catch {
        // ignore
      }
    }
    this.applyRules();
    this.builder.start({ rebuild });
  }

  onBuildProgress(msg, frac, report) {
    const pct = Math.max(0, Math.round(frac * 100));
    for (const p of this.players()) p.onScreenDisplay.setActionBar(frac < 0 ? `§c${msg}` : `§eRUSTGRIN'S PIZZA REVUE §7- ${msg} §f${pct}%`);
    if (msg === 'done') {
      log.info(`build finished: ${JSON.stringify(report)}`);
      if (report?.errors?.length) log.warn(`build errors:\n${report.errors.join('\n')}`);
      for (const p of this.players()) p.sendMessage(`§a[FNaR] The pizzeria is built.${report?.missing?.length ? ` §e(${report.missing.length} check(s) failed - see the content log)` : ''}`);
      this.enterLobby();
    }
  }

  applyRules() {
    try {
      const g = world.gameRules;
      g.doDayLightCycle = false;
      g.doWeatherCycle = false;
      g.doMobSpawning = false;
      g.sendCommandFeedback = false;
      g.commandBlockOutput = false;
      g.showDeathMessages = false;
      g.fallDamage = false;
      g.keepInventory = true;
      g.doImmediateRespawn = true;
    } catch (e) {
      log.warn(`game rules: ${e?.message ?? e}`);
    }
    try {
      world.getDimension('overworld').setWeather(WeatherType.Clear);
    } catch {
      // ignore
    }
  }

  // ================================================================ players
  /** @param {import('@minecraft/server').Player} player */
  onSpawn(player, initial) {
    if (initial) {
      try {
        player.sendMessage(`§8[FNaR] §7Five Nights at Rustgrin's §f${VERSION}§7 is running.`);
      } catch {
        // ignore
      }
    }
    if (this.state === 'UNBUILT') {
      if (!initial || this.pendingBuild || origin.set) return; // origin set: start() resumes / updates the build
      this.pendingBuild = true;
      system.runTimeout(async () => {
        const choice = await ui.setupForm(player);
        this.pendingBuild = false;
        if (choice === 'build') this.setup(false, player);
        else player.sendMessage('§7[FNaR] Run §f/fnar:setup§7 (cheats on) where you want the pizzeria.');
      }, 40);
      return;
    }
    if (this.state === 'NIGHT') {
      if (player.id !== this.guardId) this.makeSpectator(player);
      return;
    }
    if (this.state === 'LOBBY' || this.state === 'LOBBY_PENDING') system.runTimeout(() => this.toLobbySpot(player), 10);
    if (this.state === 'FREE_ROAM') system.runTimeout(() => this.toFreeRoam(player), 10);
  }

  /** @param {import('@minecraft/server').Player} p */
  makeSpectator(p) {
    try {
      p.setGameMode(GameMode.Spectator);
      p.teleport(W(36.5, 2, 68.5), { rotation: { x: 10, y: 180 } });
      p.sendMessage('§7[FNaR] A night is in progress - you are watching.');
    } catch {
      // ignore
    }
  }

  /** @param {import('@minecraft/server').Player} p */
  giveItems(p, kind) {
    try {
      const inv = p.getComponent('minecraft:inventory')?.container;
      if (!inv) return;
      inv.clearAll();
      // tools stay in their slot (cannot be dropped or moved), like FREDBEAR's kit
      const tool = (id) => {
        const st = new ItemStack(id, 1);
        st.lockMode = ItemLockMode.slot;
        st.keepOnDeath = true;
        return st;
      };
      if (kind === 'night') {
        // the tablet is in the hand slot, so using it always raises / lowers the monitor
        inv.setItem(NEUTRAL_SLOT, tool('fnar:tablet'));
        inv.setItem(0, tool('fnar:remote'));
        inv.setItem(8, tool('fnar:guide'));
      } else {
        inv.setItem(0, tool('fnar:guide'));
        if (kind === 'roam') inv.setItem(1, tool('fnar:remote'));
      }
      p.selectedSlotIndex = NEUTRAL_SLOT;
    } catch (e) {
      log.warn(`items: ${e?.message ?? e}`);
    }
  }

  // ================================================================ lobby
  enterLobby() {
    this.stopNight();
    this.state = 'LOBBY';
    this.applyRules();
    try {
      world.setTimeOfDay(18000);
    } catch {
      // ignore
    }
    runCmd(FOG.nightPop);
    runCmd(FOG.darkPop);
    this.act.lobby();
    this.puppets.removeAll();
    // the gallery: every animatronic on its pedestal
    for (const id of CAST) {
      const g = GALLERY[id];
      const e = this.puppets.spawn(id, SHOW_SPOTS[id]);
      if (!e) continue;
      this.puppets.teleport(id, g, g.yaw);
      this.puppets.anim(id, 'pose');
      this.puppets.eyes(id, false);
    }
    this.updateStars();
    for (const p of this.players()) this.toLobbySpot(p);
    this.audio.stopAll();
  }

  /** @param {import('@minecraft/server').Player} p */
  toLobbySpot(p) {
    try {
      restorePlayerView(p);
      p.setGameMode(GameMode.Adventure);
      p.teleport(W(LOBBY.spawn.x, LOBBY.spawn.y, LOBBY.spawn.z), { rotation: { x: 0, y: LOBBY.spawn.yaw } });
      p.onScreenDisplay.setHudVisibility(HudVisibility.Reset);
      p.onScreenDisplay.setTitle("§lFIVE NIGHTS AT RUSTGRIN'S", { fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20, subtitle: `§7${'★'.repeat(this.save.stars)}§8${'☆'.repeat(3 - this.save.stars)}` });
      this.giveItems(p, 'lobby');
      if (this.save.settings.music) this.audio.loop(`title_${p.id}`, 'fnar.music.title', null, p, 0.6);
    } catch (e) {
      log.warn(`lobby spot: ${e?.message ?? e}`);
    }
  }

  updateStars() {
    STAR_SLOTS.forEach(([x, y, z], i) => setLocal(x, y, z, i < this.save.stars ? 'star_s' : 'air'));
  }

  async onButtonPush(ev) {
    if (this.state !== 'LOBBY' || !origin.set) return;
    const p = ev.source;
    if (!p || p.typeId !== 'minecraft:player') return;
    const b = L(ev.block.location);
    const action = LOBBY_BUTTON_AT[`${b.x},${b.y},${b.z}`];
    if (!action) return;
    p.playSound('fnar.ui.click');
    await this.lobbyAction(p, action);
  }

  /** @param {import('@minecraft/server').Player} p */
  async lobbyAction(p, action) {
    const s = this.save;
    switch (action) {
      case 'new_game':
        if (s.beaten.length && !(await ui.confirm(p, '§lNEW GAME', 'Start again from Night 1? Your stars and unlocks are kept.', 'Start'))) return;
        s.next = 1;
        storeSave(s);
        return this.startNight(p, 1);
      case 'continue':
        return this.startNight(p, Math.max(1, Math.min(5, s.next)));
      case 'night6':
        if (!s.beaten.includes(5)) return ui.messageBox(p, '§lNIGHT 6', 'Survive night 5 first.');
        return this.startNight(p, 6);
      case 'custom': {
        if (!s.beaten.includes(6)) return ui.messageBox(p, '§lCUSTOM NIGHT', 'Survive night 6 first.');
        const ai = await ui.customNightForm(p, s.custom);
        if (!ai) return;
        s.custom = ai;
        storeSave(s);
        return this.startNight(p, CUSTOM_NIGHT, { ai });
      }
      case 'free_roam':
        return this.enterFreeRoam();
      case 'gallery':
        return ui.messageBox(p, '§lGALLERY', 'The whole cast stands in the Gallery room behind you (through the door in the corner). Walk up to them... if you dare.');
      case 'clippings':
        return ui.clippingsForm(p, s);
      case 'settings': {
        const n = await ui.settingsForm(p, s.settings);
        if (!n) return;
        s.settings = n;
        storeSave(s);
        if (!n.music) this.audio.stopAll();
        return undefined;
      }
      case 'erase':
        if (await ui.confirm(p, '§lERASE PROGRESS', 'Erase every night, star and setting? This cannot be undone.', '§cErase')) {
          this.save = defaultSave();
          storeSave(this.save);
          this.updateStars();
          p.sendMessage('§7[FNaR] Progress erased.');
        }
        return undefined;
      default:
        return undefined;
    }
  }

  // ================================================================ free roam
  enterFreeRoam() {
    this.stopNight();
    this.state = 'FREE_ROAM';
    try {
      world.setTimeOfDay(6000);
    } catch {
      // ignore
    }
    runCmd(FOG.nightPop);
    this.act.daytime();
    this.puppets.removeAll();
    for (const id of CAST) {
      this.puppets.spawn(id, SHOW_SPOTS[id], 'perform');
      this.puppets.eyes(id, false);
    }
    this.audio.stopAll();
    this.audio.loop('show_band', 'fnar.music.showtime', 'stage', null, 1.0);
    this.audio.loop('show_midway', 'fnar.tophat.show', 'midway', null, 0.7);
    for (const p of this.players()) this.toFreeRoam(p);
    this.freeRoamNext = system.currentTick + 160;
  }

  /** @param {import('@minecraft/server').Player} p */
  toFreeRoam(p) {
    try {
      restorePlayerView(p);
      p.setGameMode(GameMode.Adventure);
      p.teleport(W(SPAWN_OUTSIDE.x, SPAWN_OUTSIDE.y, SPAWN_OUTSIDE.z), { rotation: { x: 0, y: SPAWN_OUTSIDE.yaw } });
      p.onScreenDisplay.setTitle('§eSHOWTIME!', { fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20, subtitle: "§fFree roam - Rustgrin's Pizza Revue is open" });
      this.giveItems(p, 'roam');
    } catch (e) {
      log.warn(`free roam: ${e?.message ?? e}`);
    }
  }

  tickFreeRoam(now) {
    this.audio.tick();
    if (now >= this.freeRoamNext) {
      this.freeRoamNext = now + 160;
      for (const id of CAST) this.puppets.anim(id, this.rng.chance(0.5) ? 'perform' : 'perform2');
    }
    if (now % 40 === 0) for (const p of this.players()) p.onScreenDisplay.setActionBar('§7Free roam §8| §fOffice Remote: back to the time clock');
  }

  // ================================================================ nights
  /**
   * @param {any} player the guard
   * @param {number} n night (1..6, 7 = custom)
   * @param {{ ai?: Record<string, number> }} [opts]
   */
  startNight(player, n, opts = {}) {
    this.stopNight();
    this.state = 'NIGHT';
    this.guardId = player.id;
    this.nightOpts = { n, ...opts };
    this.nightLabel = n === CUSTOM_NIGHT ? 'Custom Night' : `Night ${n}`;
    const seed = this.save.settings.deterministic ? this.save.settings.seed * 31 + n : undefined;
    this.session = new NightSession(n, { seed, ai: opts.ai });
    this.applyRules();
    try {
      world.setTimeOfDay(18000);
    } catch {
      // ignore
    }
    this.audio.stopAll();
    this.puppets.removeAll();
    this.act.nightStart();
    runCmd(FOG.darkPop);
    runCmd(FOG.nightPush);
    this.stare = Object.create(null);
    this.phoneSeq = null;
    for (const p of this.players()) {
      if (p.id === this.guardId) continue;
      this.makeSpectator(p);
    }
    try {
      restorePlayerView(player);
      player.setGameMode(GameMode.Adventure);
      const s = OFFICE.spawn;
      player.teleport(W(s.x, s.y, s.z), { rotation: { x: 0, y: s.yaw } });
      player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, NIGHT_HUD);
      player.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0, holdTime: 1.0, fadeOutTime: 1.5 } });
      player.onScreenDisplay.setTitle('§f12 AM', { fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20, subtitle: `§7${this.nightLabel}` });
      this.giveItems(player, 'night');
    } catch (e) {
      log.warn(`start night: ${e?.message ?? e}`);
    }
    const tip = TUTORIAL_HINTS[n];
    if (tip && this.save.settings.hints) this.hud.setMessage(tip, system.currentTick + 80, 200);
    this.audio.loop('office', 'fnar.amb.office', 'office', null, 0.6);
    this.audio.loop('fan', 'fnar.amb.fan', 'desk', null, 0.5);
    this.audio.loop('building', 'fnar.amb.building', null, player, 0.5);
    log.info(`start ${this.nightLabel}${opts.ai ? ` ${JSON.stringify(opts.ai)}` : ''}`);
  }

  /** Tear down a night's world state (no result shown). */
  stopNight() {
    if (this.camForm) this.stopCamForm();
    const g = this.guard();
    this.cams.close();
    if (g) {
      restorePlayerView(g);
      try {
        g.onScreenDisplay.setTitle(MAP_OFF, { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 });
        g.onScreenDisplay.setHudVisibility(HudVisibility.Reset);
      } catch {
        // ignore
      }
    }
    runCmd(FOG.camPop);
    this.act.clearCamLight();
    this.audio.stopAll();
    this.session = null;
    this.phoneSeq = null;
    for (const p of this.players()) {
      try {
        if (p.getGameMode() === GameMode.Spectator) p.setGameMode(GameMode.Adventure);
      } catch {
        // ignore
      }
    }
  }

  endNightAbort() {
    log.info('guard left mid-night; back to the lobby');
    this.enterLobby();
  }

  tick() {
    const now = system.currentTick;
    if (this.state === 'FREE_ROAM') {
      this.puppets.tick();
      this.tickFreeRoam(now);
      return;
    }
    if (this.state === 'LOBBY') {
      this.audio.tick();
      if (now % 100 === 0) for (const p of this.players()) p.onScreenDisplay.setActionBar('§7Press a button on the §fTIME CLOCK§7 wall to start a shift.');
      return;
    }
    if (this.state !== 'NIGHT' && this.state !== 'JUMPSCARE' && this.state !== 'ENDING') return;
    this.puppets.tick();
    this.act.tickDoors();
    this.audio.tick();
    if (this.state !== 'NIGHT') return;
    const s = this.session;
    const g = this.guard();
    if (!s || !g) {
      this.endNightAbort();
      return;
    }
    s.tick();
    if (s.t === 40) this.checkPuppets();
    for (const e of s.drain()) {
      try {
        this.render(e, g);
      } catch (err) {
        log.warn(`render ${e.fx}: ${err?.message ?? err}`);
      }
    }
    if (this.state !== 'NIGHT') return;
    this.act.tickFlicker(this.rng);
    this.tickPhone(g, now);
    this.tickStare(g);
    if (this.cams.active) this.cams.tick(this.camCover());
    if (now % 10 === 0) this.keepInOffice(g);
    if (now % 4 === 0) {
      const snap = s.snapshot();
      const overlay = this.save.settings.debugOverlay ? `§8${s.debugLine()}` : null;
      const hint = this.cams.active ? (this.camForm ? 'Click a camera on the map - LOWER or Esc puts the monitor down' : 'Scroll the hotbar: next camera - Sneak or use the tablet: lower') : null;
      g.onScreenDisplay.setActionBar(this.hud.nightBar(snap, now, { captions: this.save.settings.captions, overlay, cover: this.cams.active ? this.camCover() : null, hint }));
    }
    if (this.cams.active && now % 60 === 0) this.showCamMap(g, s.devices.cams.cam);
  }

  camCover() {
    const s = this.session;
    if (!s) return null;
    const cam = CAMERA_BY_ID[s.devices.cams.cam];
    if (!cam) return null;
    if (cam.audioOnly) return 'audio';
    if (!s.camWorking(cam.id)) return 'static';
    return null;
  }

  /** @param {import('@minecraft/server').Player} g */
  showCamMap(g, camId) {
    if (this.save.settings.camMap === false) return;
    try {
      // the title is only formatting codes (invisible); the resource pack draws the map from it
      g.onScreenDisplay.setTitle(camId ? mapTitle(camId) : MAP_OFF, { fadeInDuration: 0, stayDuration: camId ? 100 : 1, fadeOutDuration: 0 });
    } catch {
      // ignore
    }
  }

  /** @param {import('@minecraft/server').Player} g */
  keepInOffice(g) {
    const l = L(g.location);
    const b = OFFICE.bounds;
    if (l.x >= b.x1 && l.x < b.x2 && l.z >= b.z1 && l.z < b.z2 && l.y > -1 && l.y < 4) return;
    try {
      const s = OFFICE.spawn;
      g.teleport(W(s.x, s.y, s.z), { rotation: g.getRotation() });
      this.hud.setMessage('Stay at your post.', system.currentTick, 60);
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- effects -> world
  /** @param {import('@minecraft/server').Player} g */
  render(e, g) {
    const s = this.session;
    const cap = (t) => this.save.settings.captions && this.hud.setCaption(t, system.currentTick);
    switch (e.fx) {
      case 'start':
        return;
      case 'place': {
        let anim = POSE_ANIM[e.pose] ?? 'idle';
        if (e.initial) {
          // at night the band stands still on stage holding its props; the Ringmaster's troupe
          // keeps performing for as long as the show tape runs
          const show = s.def.tape && s.chars.top_hat_rat.enabled && (e.who === 'top_hat_rat' || e.who === 'purple_rat');
          anim = e.who === 'cat' ? 'idle' : show ? 'perform' : 'pose';
        }
        this.puppets.spawn(e.who, e.node, anim);
        this.puppets.eyes(e.who, true);
        return;
      }
      case 'move':
        this.puppets.walk(e.who, e.path, e.dur, POSE_ANIM[e.anim] ?? 'walk', e.yaw);
        delete this.stare[e.who];
        return;
      case 'pose':
        this.puppets.anim(e.who, POSE_ANIM[e.pose] ?? 'stand');
        return;
      case 'hide':
        this.puppets.hide(e.who, true);
        return;
      case 'door':
        this.act.door(e.side, e.closed);
        this.act.button(e.side === 'L' ? 'door_l' : 'door_r', e.closed);
        this.audio.play(e.closed ? 'fnar.door.close' : 'fnar.door.open', e.side === 'L' ? 'door_l' : 'door_r', g);
        return;
      case 'light':
        this.act.hallLight(e.side, e.on);
        this.audio.play(e.on ? 'fnar.light.on' : 'fnar.light.off', 'office', g, { vol: 0.7 });
        if (e.on) this.audio.loop(`buzz_${e.side}`, 'fnar.amb.light_buzz', e.side === 'L' ? 'door_l' : 'door_r', null, 0.6);
        else this.audio.stop(`buzz_${e.side}`);
        return;
      case 'vent':
        this.act.vent(e.side, e.closed);
        this.act.button(e.side === 'L' ? 'vent_l' : 'vent_r', e.closed);
        this.audio.play(e.closed ? 'fnar.vent.close' : 'fnar.vent.open', e.side === 'L' ? 'vent_l' : 'vent_r', g);
        return;
      case 'cams':
        return this.renderCams(e, g);
      case 'sound': {
        let where = e.at;
        if (CAST.includes(e.at)) {
          const pos = this.puppets.positionOf(e.at);
          where = pos ? L(pos) : null;
          if (where) where = { x: where.x, y: where.y + 1.5, z: where.z };
        }
        if (e.kitchen && this.cams.active && s.devices.cams.cam === '6') cap('pots and humming in the kitchen');
        this.audio.play(e.id, where, g, { vol: e.vol, relayCam: this.cams.active ? s.devices.cams.cam : null });
        return;
      }
      case 'at_door':
        cap(e.who === 'mirehop' ? 'a guitar string twangs - left door' : 'soft humming - right window');
        return;
      case 'at_vent':
        cap(`maracas right above you - ${e.side === 'L' ? 'left' : 'right'} vent`);
        return;
      case 'at_nook':
        cap('microphone feedback - right door');
        return;
      case 'vent_bang':
        cap('something bangs on the vent cover');
        return;
      case 'cat_bang':
        cap(`banging on the ${e.side === 'L' ? 'left' : 'right'} door`);
        return;
      case 'left_door':
        return;
      case 'breach':
        if (e.side === 'L' || e.side === 'R') {
          this.act.button(e.side === 'L' ? 'door_l' : 'door_r', false);
          this.act.button(e.side === 'L' ? 'light_l' : 'light_r', false);
        }
        return;
      case 'curtain':
        this.act.curtain(e.stage);
        return;
      case 'tape':
        this.act.tape(e.level);
        return;
      case 'show_music':
        if (e.stop) this.audio.stop('show');
        else this.audio.loop('show', e.slow ? 'fnar.tophat.show_slow' : 'fnar.tophat.show', 'cam8', null, 0.9);
        return;
      case 'ringmaster':
        if (e.state === 'leaving') cap('the music stopped... a cane taps on the tiles');
        if (e.state === 'close') cap(`cane taps right outside - ${e.side === 'L' ? 'left' : 'right'} side`);
        if (e.state === 'returning') cap('a fanfare - the show goes on');
        return;
      case 'hour':
        this.audio.play('fnar.clock.chime', null, g, { vol: 0.5 });
        if (!this.cams.active) g.onScreenDisplay.setTitle(' ', { fadeInDuration: 0, stayDuration: 40, fadeOutDuration: 10, subtitle: `§f${hourLabel(e.hour)}` });
        return;
      case 'phone':
        if (e.muted) {
          this.phoneSeq = null;
          this.act.phone(false);
          return;
        }
        this.phoneSeq = { lines: PHONE[e.night] ?? [], i: -2, next: system.currentTick + 60 };
        return;
      case 'hallucination':
        return this.hallucinate(e.kind, g);
      case 'rusted':
        return this.renderRusted(e.on);
      case 'power_out':
        return this.renderPowerOut(e.stage, g);
      case 'jumpscare':
        return void this.jumpscare(e.who, g);
      case 'win':
        return void this.sixAm(g);
      default:
        return;
    }
  }

  /** @param {import('@minecraft/server').Player} g */
  renderCams(e, g) {
    if (e.open && !this.cams.active) {
      this.cams.open(g, e.cam);
      this.act.camLight(e.cam);
      this.audio.play('fnar.cam.up', null, g, { vol: 0.8 });
      this.audio.loop('cam_hum', 'fnar.cam.hum', null, g, 0.5);
      this.showCamMap(g, e.cam);
      this.startCamForm(g);
      this.stare = Object.create(null);
      try {
        g.selectedSlotIndex = NEUTRAL_SLOT;
      } catch {
        // ignore
      }
    } else if (e.open && e.reason === 'switch') {
      this.cams.show(e.cam);
      this.act.camLight(e.cam);
      this.showCamMap(g, e.cam);
      this.stare = Object.create(null);
    } else if (!e.open && this.cams.active) {
      this.cams.close();
      this.act.clearCamLight();
      this.audio.stop('cam_hum');
      if (e.reason === 'close' || e.reason === 'power') this.audio.play('fnar.cam.down', null, g, { vol: 0.8 });
      this.showCamMap(g, null);
      if (this.camForm) this.stopCamForm();
    }
  }

  // ---------------------------------------------------------------- the clickable camera map
  /** @param {import('@minecraft/server').Player} g */
  startCamForm(g) {
    if (this.camForm || this.save.settings.camCursor === false) return;
    const form = { open: true, busy: 0 };
    this.camForm = form;
    const live = () => this.camForm === form && this.state === 'NIGHT' && !!this.session?.devices.cams.open;
    const loop = async () => {
      await wait(4); // let the view land on the camera first
      while (live()) {
        const r = await ui.cameraMapForm(g, this.session.snapshot());
        if (!live()) break;
        if (!r) break; // the form could not be shown: the hotbar and sneak still work
        if (r.kind === 'busy') {
          // another screen (chat, inventory, pause) was in the way: try again shortly, keep the monitor up
          if (form.busy++ >= 8) break;
          await wait(10);
          continue;
        }
        form.busy = 0;
        if (r.kind === 'cam') {
          this.session.input('cam_select', r.id);
          await wait(2);
          continue;
        }
        if (r.kind === 'wind') {
          const res = this.session.input('wind');
          if (!res.ok && res.reason === 'not_cam8') this.hud.setMessage('PLAY SHOW works on CAM 8', system.currentTick, 40);
          await wait(2);
          continue;
        }
        if (r.kind === 'close' || r.kind === 'dismissed') {
          this.session.input('cams_close');
          break;
        }
      }
      if (this.camForm === form) this.camForm = null;
    };
    loop().catch((e) => log.warn(`camera map form: ${e?.message ?? e}`));
  }

  stopCamForm() {
    const g = this.guard();
    this.camForm = null;
    if (g) ui.closeForms(g);
  }

  // ---------------------------------------------------------------- input
  /** @param {import('@minecraft/server').Player} player */
  onSlot(player, prev, next) {
    if (this.state !== 'NIGHT' || player.id !== this.guardId || !this.session?.devices.cams.open) return;
    // the scripted return to the neutral slot (below, and when the monitor goes up) is not a scroll
    if (next === NEUTRAL_SLOT) return;
    const d = (next - prev + 9) % 9;
    if (d === 0) return;
    this.session.input(d <= 4 ? 'cam_next' : 'cam_prev');
    system.run(() => {
      try {
        player.selectedSlotIndex = NEUTRAL_SLOT;
      } catch {
        // ignore
      }
    });
  }

  /** @param {import('@minecraft/server').Player} player */
  onSneak(player) {
    if (this.state === 'NIGHT' && player.id === this.guardId && this.session?.devices.cams.open) this.session.input('cams_close');
  }

  /** @param {import('@minecraft/server').Player} player */
  onItemUse(player, item) {
    if (!item) return;
    const id = item.typeId;
    if (id === 'fnar:guide') {
      if (this.state === 'FREE_ROAM') {
        ui.confirm(player, '§lFREE ROAM', 'Go back to the time clock?', 'Back').then((ok) => ok && this.enterLobby());
        return;
      }
      ui.guide(player);
      return;
    }
    if (id === 'fnar:remote') {
      if (this.state === 'FREE_ROAM') {
        ui.confirm(player, '§lFREE ROAM', 'Go back to the time clock?', 'Back').then((ok) => ok && this.enterLobby());
        return;
      }
      if (this.state !== 'NIGHT' || player.id !== this.guardId || !this.session) return;
      ui.officeRemote(player, this.session.snapshot()).then((a) => {
        if (a && this.session && this.state === 'NIGHT') this.feedback(this.session.input(a));
      });
      return;
    }
    if (id === 'fnar:tablet') {
      if (this.state !== 'NIGHT' || !this.session) {
        player.onScreenDisplay.setActionBar('§7The cameras only run during a shift - press §fNEW GAME§7 on the time clock wall.');
        return;
      }
      if (player.id !== this.guardId) return;
      this.feedback(this.session.input('cams_toggle'));
    }
  }

  /**
   * A block with the fnar:control custom component was clicked: a wall button, the CRT
   * monitor (raises / lowers the cameras) or the desk phone (mutes the call). Custom blocks
   * are only clickable in game when they carry such a component.
   * @param {import('@minecraft/server').Player} player
   */
  onControl(player, block) {
    if (this.state !== 'NIGHT' || !this.session) {
      try {
        player.onScreenDisplay.setActionBar('§7The office systems only run during a shift - press §fNEW GAME§7 on the time clock wall.');
      } catch {
        // ignore
      }
      return;
    }
    if (player.id !== this.guardId) return;
    const t = block.typeId;
    const now = system.currentTick;
    const key = `${t}@${Math.floor(block.location.x)},${Math.floor(block.location.y)},${Math.floor(block.location.z)}`;
    if (this.lastControl?.key === key && now - this.lastControl.tick <= 4) return; // the same click, reported twice
    this.lastControl = { key, tick: now };
    if (t === 'fnar:crt_monitor') {
      this.feedback(this.session.input('cams_toggle'));
      return;
    }
    if (t === 'fnar:desk_phone') {
      this.feedback(this.session.input('mute_call'));
      return;
    }
    const l = L(block.location);
    for (const [action, b] of Object.entries(OFFICE.buttons)) {
      if (b.x === l.x && b.y === l.y && b.z === l.z) {
        this.audio.play('fnar.button.press', { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 }, player, { vol: 0.8 });
        this.feedback(this.session.input(action));
        return;
      }
    }
  }

  feedback(res) {
    if (!res || res.ok) return;
    const now = system.currentTick;
    if (res.reason === 'broken') this.hud.setMessage('It will not respond...', now, 50);
    else if (res.reason === 'power') this.hud.setMessage('No power.', now, 50);
  }

  // ---------------------------------------------------------------- phone, stare, hallucinations
  /** @param {import('@minecraft/server').Player} g */
  tickPhone(g, now) {
    const ph = this.phoneSeq;
    if (!ph || now < ph.next) return;
    if (ph.i < 0) {
      // two rings
      this.act.phone(true);
      this.audio.play('fnar.phone.ring', OFFICE.phone, g, { vol: 0.9 });
      ph.i++;
      ph.next = now + 70;
      if (ph.i === 0) {
        this.audio.play('fnar.phone.pickup', OFFICE.phone, g);
        this.act.phone(false);
      }
      return;
    }
    if (ph.i >= ph.lines.length) {
      this.audio.play('fnar.phone.hangup', OFFICE.phone, g, { vol: 0.8 });
      this.phoneSeq = null;
      return;
    }
    const line = ph.lines[ph.i++];
    if (!this.cams.active) this.hud.setMessage(`☎ ${line}`, now, 110);
    else g.sendMessage(`§7☎ ${line}`);
    this.audio.play('fnar.phone.voice', OFFICE.phone, g, { vol: 0.7 });
    ph.next = now + 50 + Math.min(110, line.length * 1.4);
  }

  /** Animatronics watched on camera long enough turn their head to the lens. */
  /** @param {import('@minecraft/server').Player} g */
  tickStare(g) {
    const s = this.session;
    if (!this.cams.active || this.camCover()) return;
    const cam = CAMERA_BY_ID[s.devices.cams.cam];
    for (const c of Object.values(s.chars)) {
      if (!c.node || c.walk || !cam.sees.includes(c.node)) continue;
      const n = (this.stare[c.id] = (this.stare[c.id] ?? 0) + 1);
      if (n !== STARE_AFTER) continue;
      const node = NODES[c.node];
      const dx = cam.loc[0] - node.x;
      const dz = cam.loc[2] - node.z;
      const dy = cam.loc[1] - (node.y + (HEAD_Y[c.id] ?? 2));
      let rel = yawToward(dx, dz) - node.yaw;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      const pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
      this.puppets.look(c.id, rel, pitch);
      this.audio.play('fnar.servo.head', { x: node.x, y: node.y + 2, z: node.z }, g, { vol: 0.6, relayCam: cam.id });
    }
  }

  /** @param {import('@minecraft/server').Player} g */
  hallucinate(kind, g) {
    try {
      switch (kind) {
        case 'showtime':
          g.onScreenDisplay.setTitle("§4IT'S SHOWTIME", { fadeInDuration: 0, stayDuration: 6, fadeOutDuration: 4 });
          this.audio.play('fnar.hall.sting', null, g, { vol: 0.9 });
          break;
        case 'whisper':
          this.audio.play('fnar.hall.whisper', null, g, { vol: 0.8 });
          break;
        case 'face':
          g.camera.fade({ fadeColor: { red: 0.35, green: 0.0, blue: 0.05 }, fadeTime: { fadeInTime: 0.02, holdTime: 0.15, fadeOutTime: 0.3 } });
          this.audio.play('fnar.hall.sting', null, g, { vol: 0.7, pitch: 0.8 });
          break;
        case 'poster': {
          // the office poster turns into the Midway poster for a moment
          for (let i = 0; i < 4; i++) setLocal(34 + (i % 2), 4 - Math.floor(i / 2), 60, `pic:poster_midway:${i}:s`);
          system.runTimeout(() => {
            for (let i = 0; i < 4; i++) setLocal(34 + (i % 2), 4 - Math.floor(i / 2), 60, `pic:poster_party:${i}:s`);
          }, 30);
          break;
        }
        case 'eyes':
          for (const id of CAST) this.puppets.eyes(id, false);
          system.runTimeout(() => {
            if (this.state === 'NIGHT') for (const id of CAST) this.puppets.eyes(id, true);
          }, 40);
          this.audio.play('fnar.hall.whisper', null, g, { vol: 0.5, pitch: 0.7 });
          break;
        default:
          break;
      }
    } catch {
      // ignore
    }
  }

  renderRusted(on) {
    if (on) {
      // slumped in the corner in front of the desk, facing the seat
      const at = { x: 34.2, y: 0, z: 62.3 };
      const seat = OFFICE.spawn;
      this.puppets.spawnAt('rusted', at, yawToward(seat.x - at.x, seat.z - at.z), 'slump');
      this.puppets.eyes('rusted', true);
      this.audio.play('fnar.hall.whisper', 'office', this.guard(), { vol: 0.6, pitch: 0.6 });
    } else this.puppets.remove('rusted');
  }

  /** @param {import('@minecraft/server').Player} g */
  renderPowerOut(stage, g) {
    if (stage === 'down') {
      this.act.powerOut();
      this.audio.stopAll();
      this.audio.play('fnar.power.out', null, g);
      runCmd(FOG.nightPop);
      runCmd(FOG.darkPush);
      if (this.camForm) this.stopCamForm();
      this.showCamMap(g, null);
    } else if (stage === 'song') {
      // Rustgrin plays his song in the left doorway, eyes flashing
      const id = 'rustgrin';
      this.puppets.spawn(id, 'DOOR_L', 'perform');
      this.puppets.eyes(id, true);
      this.audio.loop('song', 'fnar.rustgrin.song', 'door_l', null, 1.0);
      this.flashEyes = system.runInterval(() => this.puppets.eyes(id, this.rng.chance(0.55)), 6);
    } else if (stage === 'black') {
      this.audio.stop('song');
      if (this.flashEyes !== undefined) system.clearRun(this.flashEyes);
      this.flashEyes = undefined;
      this.puppets.eyes('rustgrin', false);
      this.puppets.hide('rustgrin', true);
    }
  }

  // ---------------------------------------------------------------- endings
  /** @param {import('@minecraft/server').Player} g */
  async jumpscare(who, g) {
    this.state = 'JUMPSCARE';
    if (this.flashEyes !== undefined) system.clearRun(this.flashEyes);
    this.flashEyes = undefined;
    if (this.camForm) this.stopCamForm();
    this.cams.close();
    this.act.clearCamLight();
    this.audio.stopAll();
    const id = who === 'rusted' ? 'rusted' : who;
    try {
      const eye = g.getHeadLocation();
      const rot = g.getRotation();
      const yawRad = (rot.y * Math.PI) / 180;
      const fwd = { x: -Math.sin(yawRad), z: Math.cos(yawRad) };
      const dist = 1.15;
      const head = HEAD_Y[id] ?? 2;
      const pos = { x: eye.x + fwd.x * dist, y: eye.y - head, z: eye.z + fwd.z * dist };
      const facing = (rot.y + 180) % 360;
      this.puppets.jumpscareAt(id, L(pos), facing);
      g.addEffect('invisibility', 200, { amplifier: 0, showParticles: false });
      g.camera.setCamera('minecraft:free', { location: eye, facingLocation: { x: pos.x, y: eye.y - 0.1, z: pos.z } });
      g.playSound(`fnar.js.${id === 'rusted' ? 'rustgrin' : id}`, { volume: 1.0 });
      runCmd(`camerashake add @a[name="${g.name}"] 0.7 1.4 rotational`);
    } catch (e) {
      log.warn(`jumpscare: ${e?.message ?? e}`);
    }
    await wait(30);
    try {
      g.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.1, holdTime: 2.0, fadeOutTime: 0.6 } });
    } catch {
      // ignore
    }
    await wait(12);
    this.puppets.removeAll();
    restorePlayerView(g);
    runCmd(FOG.darkPop);
    const n = this.nightOpts.n;
    const res = await ui.resultForm(g, {
      won: false,
      label: this.nightLabel,
      tip: who === 'rusted' ? 'He was never there. Raise the monitor the moment you see him.' : TUTORIAL_HINTS[Math.min(6, Math.max(1, n))],
    });
    this.afterResult(res, g, false);
  }

  /** @param {import('@minecraft/server').Player} g */
  async sixAm(g) {
    this.state = 'ENDING';
    if (this.camForm) this.stopCamForm();
    this.cams.close();
    this.act.clearCamLight();
    this.audio.stopAll();
    const n = this.nightOpts.n;
    const s = this.save;
    try {
      g.playSound('fnar.clock.6am', { volume: 1 });
      g.onScreenDisplay.setTitle('§l6 AM', { fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20, subtitle: `§a${this.nightLabel} complete` });
    } catch {
      // ignore
    }
    // progress
    let ending = null;
    if (n >= 1 && n <= LAST_NIGHT) {
      if (!s.beaten.includes(n)) s.beaten.push(n);
      if (n < 5) s.next = Math.max(s.next, n + 1);
      if (n === 5) {
        s.stars = Math.max(s.stars, 1);
        ending = 'week';
      }
      if (n === 6) {
        s.stars = Math.max(s.stars, 2);
        ending = 'overtime';
      }
    } else if (n === CUSTOM_NIGHT) {
      if (!s.beaten.includes(CUSTOM_NIGHT)) s.beaten.push(CUSTOM_NIGHT);
      const ai = this.nightOpts.ai ?? {};
      if (CAST.every((id) => (ai[id] ?? 0) >= 20)) {
        s.stars = 3;
        s.showstopper = true;
        ending = 'showstopper';
      }
    }
    storeSave(s);
    await wait(100);
    if (ending) await this.playEnding(g, ENDINGS[ending]);
    this.puppets.removeAll();
    restorePlayerView(g);
    const canNext = n < 5 || (n === 5 && s.beaten.includes(5));
    const nextN = n + 1;
    const res = await ui.resultForm(g, { won: true, label: this.nightLabel, canNext: canNext && nextN <= LAST_NIGHT, nextLabel: `Night ${nextN}` });
    this.afterResult(res, g, true);
  }

  /** @param {import('@minecraft/server').Player} g */
  async playEnding(g, ending) {
    try {
      g.playSound('fnar.music.ending', { volume: 0.9 });
      for (const [title, sub] of ending.lines) {
        g.onScreenDisplay.setTitle(title, { fadeInDuration: 10, stayDuration: 70, fadeOutDuration: 10, subtitle: sub });
        await wait(95);
      }
      g.playSound('fnar.ui.star', { volume: 1 });
    } catch {
      // ignore
    }
  }

  /** @param {import('@minecraft/server').Player} g */
  afterResult(res, g, won) {
    const n = this.nightOpts.n;
    if (res === 'next' && won) this.startNight(g, n + 1);
    else if (res === 'retry') this.startNight(g, n, { ai: this.nightOpts.ai });
    else this.enterLobby();
  }

  // ---------------------------------------------------------------- debug helpers
  debugWin() {
    if (this.session && !this.session.result) {
      this.session.t = this.session.ticksPerHour * 6 - 1;
    }
  }
}

export { CONFIG, CAMERA_ORDER, typeAtLocal, Wv };
