// @ts-check
// Runtime object handed to each encounter script.
import { world, system, GameMode, MolangVariableMap } from "@minecraft/server";
import { FOGS, PARTICLES } from "../core/constants.js";
import { V, safe, AbortError, dimIndex, trace, emit, allPlayers } from "../core/util.js";
import { S, captionsOn } from "../core/settings.js";
import { W, ps, now, markWorldDirty } from "../core/state.js";
import * as body from "../observer/body.js";
import * as M from "../world/manipulate.js";
import { discover } from "../progression/discoveries.js";
import { GazeTracker } from "../world/sight.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */

/**
 * @typedef {Object} EncounterDef
 * @property {string} id
 * @property {number} tier          1 subtle .. 4 peak
 * @property {number} minStage
 * @property {boolean} needsBody
 * @property {number} cooldown      seconds before the same player gets this type again
 * @property {number} [minManip]    minimum manipulation setting
 * @property {number} [minAggression]
 * @property {boolean} [benign]     allowed after the ending in attendant mode
 * @property {boolean} [manual]     never chosen by the director (vigil, follow-ups)
 * @property {(c:import("./context.js").Ctx, s:any)=>number} weight  0 = not eligible here
 * @property {(e:Encounter)=>Promise<boolean|void>|boolean|void} [prepare]  return false to defer
 * @property {(e:Encounter)=>Promise<void>} run
 */

export class Encounter {
  /**
   * @param {EncounterDef} def @param {Player} p @param {import("./context.js").Ctx} ctx @param {number} id
   */
  constructor(def, p, ctx, id) {
    this.def = def;
    this.p = p;
    this.pid = p.id;
    this.ctx = ctx;
    this.id = id;
    this.s = ps(p);
    this.dim = p.dimension;
    this.dimId = p.dimension.id;
    this.startLoc = p.location;
    this.startTick = system.currentTick;
    this.startClock = now();
    /** @type {string|null} */
    this.aborted = null;
    this.outcome = "";
    this.points = 0;
    this.noticed = false;
    this.restoreDelay = 240;   // default: changes revert 4 minutes after the encounter ends
    this.fogOn = false;
    /** @type {Record<string, any>} */
    this.data = {};
    this.gaze = new GazeTracker(2);
    /** ledger entries of this encounter released by players: {kind, how, player, loc} */
    this.released = [];
    /** player actions near the encounter: {kind:"place", typeId, loc, player} */
    this.inputs = [];
  }

  get tick() {
    return system.currentTick - this.startTick;
  }

  /** @param {string} reason */
  abort(reason) {
    if (!this.aborted) this.aborted = reason;
  }

  check() {
    if (this.aborted) throw new AbortError(this.aborted);
    const p = this.p;
    if (!p.isValid) this.abort("target_left");
    else if (p.dimension.id !== this.dimId && !this.def.manual) this.abort("dimension");
    else {
      const gm = safe(() => p.getGameMode(), GameMode.Survival);
      if (gm === GameMode.Creative || gm === GameMode.Spectator) this.abort("gamemode");
      const hp = p.getComponent("minecraft:health");
      if (hp && hp.currentValue <= 0) this.abort("target_died");
    }
    if (!S().enabled) this.abort("disabled");
    body.exists();
    if (this.def.needsBody && body.wasLost(this.id)) this.abort("body_lost");
    if (this.aborted) throw new AbortError(this.aborted);
  }

  /** @param {number} ticks */
  async wait(ticks) {
    await system.waitTicks(Math.max(1, Math.round(ticks)));
    this.check();
  }

  /**
   * Poll pred every step ticks until it is true or maxTicks pass.
   * @param {()=>boolean} pred @param {number} maxTicks @param {number} [step]
   */
  async until(pred, maxTicks, step = 2) {
    for (let t = 0; t < maxTicks; t += step) {
      if (pred()) return true;
      await this.wait(step);
    }
    return pred();
  }

  // ------------------------------------------------------------ who is involved

  /** Other eligible players near the target (they share what they can see). */
  witnesses(radius = 48) {
    return allPlayers().filter((o) => o.id !== this.pid && o.dimension.id === this.dimId && V.dist(o.location, this.p.location) <= radius
      && safe(() => o.getGameMode() !== GameMode.Spectator, true));
  }
  /** Target plus witnesses. */
  watchers(radius = 64) {
    return [this.p, ...this.witnesses(radius)];
  }

  // ------------------------------------------------------------ personal audio/visual (only the target perceives)

  /** Personal sound at a location. Caption shown if accessibility captions are on. */
  sound(id, loc, volume = 1, pitch = 1, caption) {
    safe(() => this.p.playSound(id, { location: loc, volume, pitch }));
    if (caption) this.caption(caption);
  }
  /** Sound everyone nearby can hear (e.g. a door actually opening). */
  worldSound(id, loc, volume = 1, pitch = 1) {
    safe(() => this.dim.playSound(id, loc, { volume, pitch }));
  }
  /** @param {string} key */
  caption(key, players = [this.p]) {
    for (const p of players) if (captionsOn(p)) safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: key }] }));
  }
  particle(id, loc, players = [this.p], vars) {
    for (const p of players) safe(() => p.spawnParticle(id, loc, vars));
  }
  /** Footprint decals along a path, personal. @param {Vec[]} path */
  footprints(path, players = [this.p]) {
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
      const yaw = path.length > 1 ? V.yawTo(a, b) : 0;
      const vars = new MolangVariableMap();
      vars.setFloat("variable.yaw", yaw);
      const side = V.scale({ x: -V.fromYaw(yaw).z, y: 0, z: V.fromYaw(yaw).x }, i % 2 ? 0.22 : -0.22);
      this.particle(PARTICLES.footprint, { x: a.x + side.x, y: a.y + 0.03, z: a.z + side.z }, players, vars);
    }
  }
  /** Leave a persistent trail other visits can reveal (stored in world state for 25 minutes). @param {Vec[]} path */
  leaveTrace(path) {
    if (path.length === 0) return;
    W.traces.push({ d: dimIndex(this.dimId), pts: path.map((v) => [Math.round(v.x * 10) / 10, Math.floor(v.y), Math.round(v.z * 10) / 10]), t: now(), seen: {} });
    while (W.traces.length > 16) W.traces.shift();
    markWorldDirty();
  }

  fog(kind = "dread") {
    const id = S().camera === 0 && kind === "dread" ? FOGS.soft : FOGS[kind] ?? FOGS.dread;
    if (this.fogOn) this.clearFog();
    safe(() => this.p.runCommand(`fog @s push ${id} observer_enc`));
    this.fogOn = true;
  }
  clearFog() {
    if (!this.fogOn) return;
    safe(() => this.p.runCommand("fog @s remove observer_enc"));
    this.fogOn = false;
  }
  /** Camera shake: full camera setting only. */
  shake(intensity = 0.25, seconds = 0.6) {
    if (S().camera < 2) return;
    safe(() => this.p.runCommand(`camerashake add @s ${intensity} ${seconds} rotational`));
  }
  /** Fade to black: reduced or full camera setting. */
  fade(inS = 0.4, hold = 0.4, outS = 0.8) {
    if (S().camera < 1) return false;
    safe(() => this.p.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: inS, holdTime: hold, fadeOutTime: outS } }));
    return true;
  }
  /** Sudden scare budget: at most one sting per 20 minutes, never with scares off. */
  canScare() {
    const sc = S().scares;
    if (sc === 0) return false;
    const gap = sc === 1 ? 1500 : 900;
    return now() - this.s.stingAt > gap;
  }
  usedScare() {
    this.s.stingAt = now();
  }

  // ------------------------------------------------------------ body

  spawnBody(loc, o = {}) {
    const b = body.spawn(this.dim, loc, { enc: this.id, target: this.p, ...o });
    if (b) {
      this.data.bodySpawned = true;
      if (W.active) W.active.entity = b.e.id;
    }
    return b;
  }

  /** True while the single body belongs to this encounter. */
  ownsBody() {
    const b = body.get();
    return !!b && b.enc === this.id;
  }

  /** Track gaze on the body this step; returns true if focused by target/witnesses. */
  updateGaze(players = this.watchers()) {
    const l = body.loc();
    if (!l) return false;
    const b = body.get();
    return this.gaze.update(players, l, !!b?.stoop, system.currentTick);
  }

  // ------------------------------------------------------------ manipulation (ledger-tagged with this encounter)

  toggle(loc, restoreIn = this.restoreDelay + 600) { return M.toggleOpenable(this.dim, loc, this.id, restoreIn); }
  snuff(loc, restoreIn = this.restoreDelay + 600) { return M.snuffLight(this.dim, loc, this.id, restoreIn); }
  turn(loc, toward, restoreIn = this.restoreDelay + 600) { return M.turnToward(this.dim, loc, toward, this.id, restoreIn); }
  veil(cells, restoreIn = this.restoreDelay + 600) { return M.placeVeil(this.dim, cells, this.id, restoreIn); }
  mimic(cells, restoreIn = this.restoreDelay + 600, type) { return M.placeMimic(this.dim, cells, this.id, restoreIn, type); }
  effigy(cell, facing) { return M.placeEffigy(this.dim, cell, facing, this.id); }
  carve(cells, restoreIn = this.restoreDelay + 600) { return M.carve(this.dim, cells, this.id, restoreIn); }

  // ------------------------------------------------------------ results

  /** @param {string} id */
  discover(id, p = this.p) {
    return discover(p, id);
  }
  /** @param {string} outcome @param {boolean} [noticed] */
  result(outcome, noticed = false) {
    this.outcome = outcome;
    this.noticed = this.noticed || noticed;
  }
  log(msg) {
    trace(`[enc ${this.id} ${this.def.id}] ${msg}`);
  }
  /** Structured test/dev event about this encounter. */
  emit(kind, data) {
    emit(kind, { enc: this.id, type: this.def.id, ...data });
  }
}
