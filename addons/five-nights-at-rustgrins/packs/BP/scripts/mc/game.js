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
import { OFFICE, LOBBY, SPAWN_OUTSIDE, LOT } from '../data/layout.js';
import { NODES } from '../data/nodes.js';
import { CAMERA_BY_ID, CAMERA_ORDER } from '../data/cameras.js';
import { LOBBY_BUTTON_AT, STAR_SLOTS } from '../data/lobby.js';
import { CALLS, HUNG_UP, TAKEOVER, FINAL, ENDINGS, TUTORIAL_HINTS, KILL_TIPS } from '../data/story.js';
import { Builder } from './builder.js';
import { Puppets, yawToward } from './puppets.js';
import { Actuators } from './actuators.js';
import { Audio } from './audio.js';
import { Hud, mapTitle, MAP_OFF, FX_ON, hourLabel, spotlightReady } from './hud.js';
import { CameraView, restorePlayerView, FOG } from './camera_view.js';
import * as ui from './ui.js';
import { W, Wv, L, dim, origin, refreshOrigin, setOrigin, runCmd, setLocal, typeAtLocal } from './world_io.js';
import { loadSave, storeSave, storeOrigin, defaultSave, loadBuild } from './persistence.js';
import { log } from './log.js';
import { VERSION } from '../data/version.js';

const wait = (ticks) => new Promise((res) => system.runTimeout(() => res(undefined), ticks));

/** Standing eye height of each animatronic as rendered (blocks, render scale 1.45): the camera stare aims the head with it. */
const HEAD_Y = Object.freeze({ rustgrin: 2.97, mirehop: 2.79, noxbriar: 2.97, purple_rat: 3.01, cat: 3.04, top_hat_rat: 2.97, rusted: 2.97 });
/** Eye height on the held frame of each jumpscare (the face lunges down): the jumpscare is framed on it. */
const JUMPSCARE_EYE_Y = Object.freeze({ rustgrin: 2.64, mirehop: 2.44, noxbriar: 2.63, purple_rat: 2.64, cat: 2.65, top_hat_rat: 2.56, rusted: 2.64 });
/** How far in front of the guard's eye the jumpscare starts: the lunge carries the face 1.33-1.42 blocks forward, so it
 *  ends about half a block from the lens, filling the screen without cutting through it. */
const JUMPSCARE_DIST = 1.85;
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
/** Where the band, the troupe and the Ringmaster perform in free roam. */
const SHOW_SPOTS = Object.freeze({ rustgrin: 'ST_R', mirehop: 'ST_M', noxbriar: 'ST_N', top_hat_rat: 'CAB', purple_rat: 'MW_P', cat: 'MW_T' });

/** Session pose names -> fnar:anim values. */
const POSE_ANIM = Object.freeze({ idle: 'idle', pose: 'pose', perform: 'perform', stand: 'stand', peek: 'peek', crawl: 'crawl', walk: 'walk', run: 'run', scurry: 'scurry', slump: 'slump' });
/** The user's background track: a music-category loop, so the game's music volume slider applies. */
const BGM = 'fnar.music.bgm';
const SIDE_WORD = Object.freeze({ L: 'left', R: 'right' });
/** Where the Ringmaster may be glimpsed around his booth on nights 3-5 (cosmetic: the session keeps him in the booth). */
const BOOTH_GLIMPSES = Object.freeze([
  Object.freeze({ fromNight: 3, node: 'CAB_PEEK', anim: 'peek' }),
  Object.freeze({ fromNight: 4, node: 'CAB_OUT', anim: 'stand' }),
]);

/** `{name}`, `{cam}`, `{side}` in story text. */
function fill(text, vars) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

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
    /** The Ringmaster's PA (Final Act / Custom Night): lines still to say, and when the next may start. */
    this.paQueue = [];
    this.paNext = 0;
    this.paSpoke = -1000;
    this.paChimed = false;
    /** last line index per PA key, so he never says the same line twice in a row */
    this.paLast = Object.create(null);
    /** the Ringmaster glimpsed around his booth on nights 3-5: { at, anim, next, seen } */
    this.booth = null;
    this.bgmPlaying = false;
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
    // nothing lives in the pizzeria but the cast: a mob that spawns or is spawned inside the lot is removed
    world.afterEvents.entitySpawn.subscribe((ev) => this.onEntitySpawn(ev.entity));
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
      g.doInsomnia = false;
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

  /** Is a world position inside the pizzeria's lot? */
  inLot(loc) {
    const l = L(loc);
    return l.x >= LOT.x1 && l.x < LOT.x2 + 1 && l.z >= LOT.z1 && l.z < LOT.z2 + 1 && l.y >= LOT.baseY - 2 && l.y < LOT.clearTop + 8;
  }

  /** Remove every mob inside the lot (the game rules stop natural spawning; this clears what was already there). */
  sweepMobs() {
    if (!origin.set) return;
    try {
      const mobs = dim().getEntities({
        location: W(LOT.x1, LOT.baseY - 2, LOT.z1),
        volume: { x: LOT.x2 - LOT.x1 + 1, y: LOT.clearTop - LOT.baseY + 10, z: LOT.z2 - LOT.z1 + 1 },
        families: ['mob'],
        excludeTypes: ['minecraft:player'],
      });
      for (const e of mobs) if (!e.typeId.startsWith('fnar:')) e.remove();
    } catch (e) {
      log.warn(`mob sweep: ${e?.message ?? e}`);
    }
  }

  /** @param {import('@minecraft/server').Entity} e */
  onEntitySpawn(e) {
    if (!origin.set || this.state === 'UNBUILT') return;
    try {
      if (!e?.isValid || e.typeId === 'minecraft:player' || e.typeId.startsWith('fnar:')) return;
      if (e.matches({ families: ['mob'] }) && this.inLot(e.location)) e.remove();
    } catch {
      // gone already
    }
  }

  // ================================================================ background music
  /** @param {import('@minecraft/server').Player} g */
  startBgm(g) {
    if (!g) return;
    if (this.save.settings.bgm === false) {
      this.stopBgm(); // and no vanilla track either: a shift with the music off is silent
      return;
    }
    try {
      g.playMusic(BGM, { loop: true, volume: 0.55, fade: 1.5 });
      this.bgmPlaying = true;
    } catch (e) {
      log.warn(`music: ${e?.message ?? e}`);
    }
  }

  /** @param {import('@minecraft/server').Player} [g] */
  stopBgm(g) {
    if (!this.bgmPlaying && g) return;
    this.bgmPlaying = false;
    for (const p of g ? [g] : this.players()) {
      try {
        p.stopMusic();
      } catch {
        // ignore
      }
    }
  }

  /** The Shift Guide's music switch. */
  toggleBgm(player) {
    const s = this.save;
    s.settings.bgm = s.settings.bgm === false;
    storeSave(s);
    if (this.state === 'NIGHT' && player.id === this.guardId && !this.session?.powerOut) {
      if (s.settings.bgm) this.startBgm(player);
      else this.stopBgm(player);
    }
    return s.settings.bgm;
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
    this.stopBgm();
    this.sweepMobs();
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
        if (!s.beaten.includes(5)) return ui.messageBox(p, '§lTHE FINAL ACT', 'Stay until 4 AM on Night 5. The Ringmaster will take it from there.');
        return this.startNight(p, 6);
      case 'custom': {
        if (!s.beaten.includes(6)) return ui.messageBox(p, '§lCUSTOM NIGHT', 'Survive the Final Act first.');
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
    this.stopBgm();
    this.sweepMobs();
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
    if (now % 200 === 0) this.sweepMobs();
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
    this.nightLabel = n === CUSTOM_NIGHT ? 'Custom Night' : n === 6 ? 'The Final Act' : `Night ${n}`;
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
    this.paQueue = [];
    this.paNext = 0;
    this.paSpoke = -1000;
    this.paChimed = false;
    this.booth = { at: 'CAB', anim: 'pose', next: system.currentTick + 900 + this.rng.int(0, 900), seen: 0 };
    this.sweepMobs();
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
      player.onScreenDisplay.setTitle('§f12 AM', { fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20, subtitle: `${n === 6 ? '§4' : '§7'}${this.nightLabel}` });
      this.giveItems(player, 'night');
      this.startBgm(player);
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
    this.stopBgm();
    this.session = null;
    this.phoneSeq = null;
    this.paQueue = [];
    this.booth = null;
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
      if (now % 200 === 0) this.sweepMobs();
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
    this.tickPa(g, now);
    this.tickBooth(g, now);
    this.tickStare(g);
    if (now % 200 === 0) this.sweepMobs();
    if (this.cams.active) this.cams.tick(this.camCover());
    if (now % 10 === 0) this.keepInOffice(g);
    if (now % 4 === 0) {
      const snap = s.snapshot();
      const overlay = this.save.settings.debugOverlay ? `§8${s.debugLine()}` : null;
      let hint = null;
      if (this.cams.active) {
        if (spotlightReady(snap)) hint = this.camForm ? 'Find the Ringmaster on a camera, then press SPOTLIGHT' : 'Find the Ringmaster, then use the Office Remote: SPOTLIGHT';
        else hint = this.camForm ? 'Click a camera on the map - LOWER or Esc puts the monitor down' : 'Scroll the hotbar: next camera - Sneak or use the tablet: lower';
      }
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
    try {
      // the title is only formatting codes (invisible); the resource pack draws the camera-feed
      // look and the map from it (just the look when the map is switched off in Settings)
      const code = !camId ? MAP_OFF : this.save.settings.camMap === false ? FX_ON : mapTitle(camId);
      g.onScreenDisplay.setTitle(code, { fadeInDuration: 0, stayDuration: camId ? 100 : 1, fadeOutDuration: 0 });
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
      case 'place':
        // the session picks the pose: the band posed on its stage, the troupe dancing while its
        // music plays, the Ringmaster in his booth (conducting on his own night)
        this.puppets.spawn(e.who, e.node, POSE_ANIM[e.pose] ?? 'idle');
        this.puppets.eyes(e.who, true);
        delete this.stare[e.who];
        if (e.who === 'top_hat_rat' && this.booth) Object.assign(this.booth, { at: e.node, anim: POSE_ANIM[e.pose] ?? 'pose' });
        return;
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
      case 'tape':
        this.act.tape(e.level);
        return;
      case 'show_music':
        if (e.stop) this.audio.stop('show');
        else this.audio.loop('show', e.slow ? 'fnar.tophat.show_slow' : 'fnar.tophat.show', 'cam8', null, 0.9);
        return;
      case 'tape_stop':
        cap('the show tape ran out - the music has stopped');
        return;
      case 'pa':
        return this.paSay(e, g);
      case 'event':
        return;
      case 'act':
        return this.renderAct(e.act, g);
      case 'applause':
        this.audio.play('fnar.final.applause', null, g, { vol: 0.8 });
        return;
      case 'spotlight':
        this.audio.play('fnar.final.spot', null, g, { vol: e.hit ? 1 : 0.6, pitch: e.hit ? 1 : 0.85 });
        if (e.hit) {
          try {
            g.camera.fade({ fadeColor: { red: 1, green: 0.96, blue: 0.82 }, fadeTime: { fadeInTime: 0.04, holdTime: 0.2, fadeOutTime: 0.45 } });
          } catch {
            // ignore
          }
          cap('the spotlight hits him: he bows and steps back');
        } else this.hud.setMessage('Nothing there. The spotlight still cost power.', system.currentTick, 50);
        return;
      case 'takeover':
        return void this.takeover(g);
      case 'hour':
        this.audio.play('fnar.clock.chime', null, g, { vol: 0.5 });
        if (!this.cams.active) g.onScreenDisplay.setTitle(' ', { fadeInDuration: 0, stayDuration: 40, fadeOutDuration: 10, subtitle: `§f${hourLabel(e.hour)}` });
        return;
      case 'phone': {
        if (e.muted) {
          // hanging up on him mid-call: he remembers tomorrow
          if (this.phoneSeq) {
            this.audio.play('fnar.phone.hangup', OFFICE.phone, g, { vol: 0.8 });
            this.hud.setSpeech('', system.currentTick, 0);
            this.save.hungUp = true;
            storeSave(this.save);
          }
          this.phoneSeq = null;
          this.act.phone(false);
          return;
        }
        const lines = [...(CALLS[e.night] ?? [])];
        if (this.save.hungUp && lines.length) lines.unshift(this.rng.pick(HUNG_UP));
        this.phoneSeq = { lines, i: -2, next: system.currentTick + 60 };
        return;
      }
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
        if (r.kind === 'spotlight') {
          this.feedback(this.session.input('spotlight'));
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
      ui.guide(player, { bgm: () => this.save.settings.bgm !== false, toggleBgm: () => this.toggleBgm(player) });
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
    else if (res.reason === 'cooldown') this.hud.setMessage('The spotlight is still warming up...', now, 40);
    else if (res.reason === 'not_cams') this.hud.setMessage('The SPOTLIGHT works through the cameras.', now, 50);
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
      if (this.save.hungUp) {
        this.save.hungUp = false; // he got to finish this time
        storeSave(this.save);
      }
      return;
    }
    const line = fill(ph.lines[ph.i++], { name: g.name });
    const ticks = 50 + Math.min(120, Math.round(line.length * 1.4));
    this.hud.setSpeech(`§5☎ §dThe Ringmaster§7: §f${line}`, now, ticks + 10);
    this.audio.play('fnar.phone.voice', OFFICE.phone, g, { vol: 0.7 });
    ph.next = now + ticks;
  }

  // ---------------------------------------------------------------- the Ringmaster's PA
  /** Pick one of `arr`, never the same one twice in a row for `key`. */
  pickLine(key, arr) {
    if (!arr?.length) return '';
    let i = this.rng.int(0, arr.length - 1);
    if (arr.length > 1 && i === this.paLast[key]) i = (i + 1) % arr.length;
    this.paLast[key] = i;
    return arr[i];
  }

  /** @param {import('@minecraft/server').Player} g */
  paSay(e, g) {
    const F = FINAL;
    let lines = [];
    let urgent = false;
    switch (e.key) {
      case 'intro':
        lines = [...F.intro];
        break;
      case 'summon':
        lines = [this.pickLine(`summon_${e.who}`, F.summon[e.who])];
        urgent = true;
        break;
      case 'game':
        lines = [this.pickLine(`game_${e.game}`, F.games[e.game])];
        urgent = true;
        break;
      case 'step':
        lines = F.step[e.node] ? [this.pickLine(`step_${e.node}`, F.step[e.node])] : [];
        urgent = true;
        break;
      default:
        if (Array.isArray(F[e.key])) lines = [this.pickLine(e.key, F[e.key])];
    }
    const vars = { name: g.name, cam: e.cam, side: SIDE_WORD[e.side] };
    lines = lines.filter(Boolean).map((l) => fill(l, vars));
    if (!lines.length) return;
    // a new cue matters more than the patter he has not got to yet
    if (urgent) this.paQueue = [];
    this.paQueue.push(...lines);
    if (this.paQueue.length > 4) this.paQueue.splice(0, this.paQueue.length - 4);
    if (urgent) this.paNext = Math.min(this.paNext, system.currentTick);
  }

  /** @param {import('@minecraft/server').Player} g */
  tickPa(g, now) {
    if (!this.paQueue.length || now < this.paNext) return;
    if (!this.paChimed && now - this.paSpoke > 60) {
      // the chime first, as on a real PA
      this.paChimed = true;
      this.audio.play('fnar.final.chime', null, g, { vol: 0.7 });
      this.paNext = now + 26;
      return;
    }
    this.paChimed = false;
    const line = this.paQueue.shift();
    const ticks = 40 + Math.min(110, Math.round(line.length * 1.3));
    this.hud.setSpeech(`§5[PA] §dThe Ringmaster§7: §f${line}`, now, ticks + 10);
    this.audio.play('fnar.phone.voice', null, g, { vol: 0.45, pitch: 0.92 });
    this.paSpoke = now + ticks;
    this.paNext = now + ticks;
  }

  /** @param {import('@minecraft/server').Player} g */
  renderAct(n, g) {
    const a = FINAL.acts[n];
    if (!a) return;
    this.audio.play('fnar.tophat.fanfare', null, g, { vol: 0.6 });
    if (!this.cams.active) {
      try {
        g.onScreenDisplay.setTitle(a.card[0], { fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20, subtitle: a.card[1] });
      } catch {
        // ignore
      }
    }
    // the act's announcement follows his welcome (Act I) or cuts in (the queue keeps the newest lines)
    this.paQueue.push(...a.lines.map((l) => fill(l, { name: g.name })));
    if (this.paQueue.length > 4) this.paQueue.splice(0, this.paQueue.length - 4);
  }

  // ---------------------------------------------------------------- the booth (nights 1-5)
  /**
   * The Ringmaster never leaves his booth before the Final Act, but on nights 3-5 he is
   * sometimes caught peering through the curtains or standing just outside them. Watched
   * for a moment, the feed tears and he is back in place. Purely cosmetic.
   * @param {import('@minecraft/server').Player} g
   */
  tickBooth(g, now) {
    const s = this.session;
    const b = this.booth;
    if (!b || !s || s.chars.top_hat_rat.enabled || s.powerOut) return;
    const watching = this.cams.active && s.devices.cams.cam === '1C' && !this.camCover();
    const away = b.at !== 'CAB';
    if (away && watching) {
      if (++b.seen < 50) return;
      // caught: static, and he is back in his booth as if he never moved
      s.staticOn(['1C'], 14);
      this.audio.play('fnar.cam.glitch', null, g, { vol: 0.7 });
      this.puppets.spawn('top_hat_rat', 'CAB', 'pose');
      this.puppets.eyes('top_hat_rat', true);
      delete this.stare.top_hat_rat;
      Object.assign(b, { at: 'CAB', anim: 'pose', seen: 0, next: now + 900 + this.rng.int(0, 900) });
      return;
    }
    b.seen = 0;
    if (watching || now < b.next) return;
    const night = s.night === CUSTOM_NIGHT ? 5 : s.night;
    const options = BOOTH_GLIMPSES.filter((o) => night >= o.fromNight);
    if (!options.length || away) {
      b.next = now + 600;
      return;
    }
    const o = this.rng.pick(options);
    this.puppets.spawn('top_hat_rat', o.node, o.anim);
    this.puppets.eyes('top_hat_rat', true);
    delete this.stare.top_hat_rat;
    Object.assign(b, { at: o.node, anim: o.anim, next: now + 1200 });
  }

  /** Animatronics watched on camera long enough turn their head to the lens. */
  /** @param {import('@minecraft/server').Player} g */
  tickStare(g) {
    const s = this.session;
    if (!this.cams.active || this.camCover()) return;
    const cam = CAMERA_BY_ID[s.devices.cams.cam];
    for (const c of Object.values(s.chars)) {
      // the booth glimpses move the Ringmaster's puppet without moving him in the session
      const at = c.id === 'top_hat_rat' && this.booth && !c.enabled ? this.booth.at : c.node;
      if (!at || c.walk || !cam.sees.includes(at)) continue;
      const n = (this.stare[c.id] = (this.stare[c.id] ?? 0) + 1);
      if (n !== STARE_AFTER) continue;
      const node = NODES[at];
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
      this.stopBgm(g);
      this.paQueue = [];
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
    this.stopBgm(g);
    this.paQueue = [];
    const id = who;
    try {
      const eye = g.getHeadLocation();
      const rot = g.getRotation();
      const yawRad = (rot.y * Math.PI) / 180;
      const fwd = { x: -Math.sin(yawRad), z: Math.cos(yawRad) };
      const dist = JUMPSCARE_DIST;
      const head = JUMPSCARE_EYE_Y[id] ?? 2.6;
      const pos = { x: eye.x + fwd.x * dist, y: eye.y - head, z: eye.z + fwd.z * dist };
      const facing = (rot.y + 180) % 360;
      this.puppets.jumpscareAt(id, L(pos), facing);
      g.addEffect('invisibility', 200, { amplifier: 0, showParticles: false });
      g.camera.setCamera('minecraft:free', { location: eye, facingLocation: { x: pos.x, y: eye.y - 0.1, z: pos.z } });
      g.playSound(`fnar.js.${id}`, { volume: 1.0 });
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
      tip: KILL_TIPS[who] ?? TUTORIAL_HINTS[Math.min(7, Math.max(1, n))],
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
    this.stopBgm(g);
    this.paQueue = [];
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
      if (n === 5) s.stars = Math.max(s.stars, 1);
      if (n === 6) {
        // the first time: the full finale; after that, a short encore
        ending = s.stars >= 2 ? 'encore' : 'final_act';
        s.stars = Math.max(s.stars, 2);
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
    const canNext = n < 5;
    const nextN = n + 1;
    const res = await ui.resultForm(g, { won: true, label: this.nightLabel, canNext: canNext && nextN <= LAST_NIGHT, nextLabel: `Night ${nextN}`, body: n === 6 ? 'The curtain falls. The Custom Night is open.' : undefined });
    this.afterResult(res, g, true);
  }

  /** @param {import('@minecraft/server').Player} g */
  async playEnding(g, ending) {
    try {
      g.playSound('fnar.music.ending', { volume: 0.9 });
      for (const [title, sub] of ending.lines) {
        g.onScreenDisplay.setTitle(fill(title, { name: g.name }), { fadeInDuration: 10, stayDuration: 70, fadeOutDuration: 10, subtitle: fill(sub, { name: g.name }) });
        await wait(95);
      }
      g.playSound('fnar.ui.star', { volume: 1 });
    } catch {
      // ignore
    }
  }

  /**
   * Night 5, 4 AM: a fake "you won" screen, the Ringmaster tears through it, CAM 1C shows his
   * booth empty, and the Final Act starts at once.
   * @param {import('@minecraft/server').Player} g
   */
  async takeover(g) {
    this.state = 'ENDING';
    if (this.camForm) this.stopCamForm();
    this.cams.close();
    this.act.clearCamLight();
    this.audio.stopAll();
    this.stopBgm(g);
    this.paQueue = [];
    this.phoneSeq = null;
    // reaching the takeover is surviving the week: night 5 counts and the first star is earned
    const s = this.save;
    if (!s.beaten.includes(5)) s.beaten.push(5);
    s.stars = Math.max(s.stars, 1);
    storeSave(s);
    const alive = () => g.isValid && this.state === 'ENDING';
    const vars = { name: g.name };
    const title = (t, sub, stay) => g.onScreenDisplay.setTitle(fill(t, vars), { fadeInDuration: 4, stayDuration: stay, fadeOutDuration: 4, subtitle: fill(sub, vars) });
    try {
      g.playSound('fnar.clock.6am', { volume: 1 });
      await wait(30);
      const credits = g.playSound('fnar.music.ending', { volume: 0.8 });
      for (const [t, sub] of TAKEOVER.fake) {
        if (!alive()) return;
        title(t, sub, 75);
        await wait(85);
      }
      if (!alive()) return;
      // the screen tears
      try {
        credits?.stop();
      } catch {
        // already over
      }
      g.playSound('fnar.cam.glitch', { volume: 1 });
      g.playSound('fnar.hall.sting', { volume: 0.9, pitch: 0.7 });
      g.camera.fade({ fadeColor: { red: 0.45, green: 0, blue: 0.03 }, fadeTime: { fadeInTime: 0.04, holdTime: 0.25, fadeOutTime: 0.4 } });
      runCmd(`camerashake add @a[name="${g.name}"] 0.35 0.8 rotational`);
      for (const [t, sub] of TAKEOVER.interrupt) {
        if (!alive()) return;
        title(t, sub, 42);
        g.playSound('fnar.phone.voice', { volume: 0.6, pitch: 0.85 });
        await wait(52);
      }
      if (!alive()) return;
      g.playSound('fnar.tophat.laugh', { volume: 1 });
      // CAM 1C: the booth is empty
      this.puppets.remove('top_hat_rat');
      this.cams.open(g, '1C');
      this.act.camLight('1C');
      this.showCamMap(g, '1C');
      g.playSound('fnar.cam.up', { volume: 0.8 });
      await wait(70);
      if (!alive()) return;
      g.playSound('fnar.cam.glitch', { volume: 1 });
      this.cams.close();
      this.act.clearCamLight();
      this.showCamMap(g, null);
      g.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.2, holdTime: 4.5, fadeOutTime: 1.0 } });
      await wait(12);
      g.playSound('fnar.final.chime', { volume: 0.9 });
      title(TAKEOVER.card[0], TAKEOVER.card[1], 70);
      await wait(85);
    } catch (e) {
      log.warn(`takeover: ${e?.message ?? e}`);
    }
    if (!alive()) return;
    this.startNight(g, 6);
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
