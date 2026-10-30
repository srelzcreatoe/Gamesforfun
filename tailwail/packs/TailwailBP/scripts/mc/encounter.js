// One live encounter: owns exactly one Tailwail entity, its lure, its brain and the
// locked target.  The director holds at most one Encounter per entity id, so damage
// and state decisions have a single authority.
import { EasingType, EntityDamageCause, GameMode, system } from "@minecraft/server";
import { CHASE, DT, GRAB, IMITATION, SEARCH } from "../config.js";
import { Brain } from "../core/brain.js";
import { BREATH, MIMIC, POSE, TAIL } from "../core/ids.js";
import { unlock } from "../core/journal.js";
import { endEncounter, recordGesture, recordReaction, rememberedGesture, retreatFactor, stalkFactor } from "../core/memory.js";
import { onEncounterEnd } from "../core/scheduler.js";
import { dirFromYaw, dist, dot, hdist, norm, pitchTo, sub, wrapDeg, yawTo } from "../util/vec.js";
import { playCue } from "./audio.js";
import * as fx from "./fx.js";
import { GrabController, grabFor } from "./grab.js";
import { dlog, errorText, warn } from "./log.js";
import { Mover } from "./mover.js";
import { creatureEyes, creatureSees, isHiding, lightAt, losClear, playerView } from "./perception.js";
import { findCover, findCreepPoint, findObservationSpot, findRetreatSpot, findSearchPoints, findStandoffSpot } from "./spots.js";
import { getMemory, getSchedule, getSettings, saveMemory, saveSchedule } from "./store.js";
import { isOpen, safeBlock } from "./terrain.js";
import { findTorches, snuff } from "./torches.js";

let nextId = 1;
const SURVIVAL_LIKE = new Set([GameMode.Survival, GameMode.Adventure]);

export function survivalLike(player, allowCreative) {
  try {
    const gm = player.getGameMode();
    if (gm === GameMode.Spectator) return false;
    return SURVIVAL_LIKE.has(gm) || (allowCreative && gm === GameMode.Creative);
  } catch {
    return false;
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Encounter {
  /**
   * @param {object} o {director, tw, target, setup, slot, rng, manual, showcase, orphan, posture}
   */
  constructor(o) {
    this.id = nextId++;
    this.director = o.director;
    this.tw = o.tw;
    this.twId = o.tw.id;
    this.dim = o.tw.dimension;
    this.target = o.target;
    this.targetId = o.target ? o.target.id : null;
    this.setup = o.setup;
    this.slot = o.slot;
    this.rng = o.rng;
    this.manual = !!o.manual;
    this.settings = getSettings();
    this.memory = o.target ? getMemory(o.target) : null;
    this.mover = new Mover(o.tw, o.slot);
    this.props = {};
    this.prevTargetPos = null;
    this.prevDist = null;
    this.ended = false;
    this.t = 0;
    this.affected = new Set();
    this.grab = null;
    this.noise = null;
    this.fovAt = null;
    this.stepDist = 0;
    this.lastStepPos = null;
    let remembered = null;
    if (this.memory && !o.orphan) {
      const r = rememberedGesture(this.memory, IMITATION.rememberedMinCount);
      const chance = o.setup === "the_rehearsal" ? 1 : IMITATION.rememberedChance;
      if (r && this.rng.chance(chance)) remembered = r;
    }
    this.remembered = remembered;
    this.mover.setPosture(o.posture || "tall", 0);
    this.brain = new Brain({
      setup: o.setup, settings: this.settings, memory: this.memory, rng: this.rng, ctx: this.ctx(), remembered, showcase: !!o.showcase,
    });
    if (o.orphan) {
      this.brain.finish("aborted");
      this.brain.enter("retreat", "reloaded");
    }
    try {
      this.tw.setDynamicProperty("tailwail:enc", JSON.stringify({ e: this.id, t: this.targetId, s: this.setup, k: this.slot }));
      this.tw.setProperty("tailwail:managed", true);
      this.tw.triggerEvent(this.settings.openDoors ? "tailwail:doors_on" : "tailwail:doors_off");
    } catch (e) {
      dlog("init", errorText(e));
    }
    dlog(`encounter ${this.id} start setup=${this.setup} slot=${this.slot} target=${this.target ? this.target.name : "-"}${remembered ? " remembers " + remembered.type : ""}`);
  }

  // ------------------------------------------------------------------ brain adapter
  ctx() {
    const self = this;
    const pos = () => self.tw.location;
    return {
      log: (m) => dlog(`#${self.id} ${m}`),
      cue: (name) => {
        dlog(`#${self.id} cue ${name}`);
        playCue(self.tw, name, self.mover.posture, self.rng);
      },
      fx: (name, arg) => self.playerFx(name, arg),
      setVisual: (v) => self.applyVisual(v),
      hold: () => self.mover.hold(),
      moveTo: (p, speed) => self.mover.moveTo(p, speed, self.t),
      faceToward: (p) => self.mover.faceToward(p),
      recover: (n) => {
        const how = self.mover.recover(n, self.t, self.rng);
        dlog(`#${self.id} recover ${n}: ${how}`);
      },
      findObservationSpot: (o) => (self.validTarget() ? findObservationSpot({ ...o, rng: self.rng, dim: self.dim, creaturePos: pos(), target: self.target, players: self.players() }) : null),
      findStandoffSpot: (min, max, head) => (self.validTarget() ? findStandoffSpot({ min, max, headroom: head, rng: self.rng, dim: self.dim, creaturePos: pos(), target: self.target }) : null),
      findRetreatSpot: (min, max) => findRetreatSpot({ min, max, rng: self.rng, dim: self.dim, creaturePos: pos(), facing: self.tw.getRotation().y, target: self.validTarget() ? self.target : null, players: self.players() }),
      findSearchPoints: (origin, n, radius) => findSearchPoints({ origin, n, radius, rng: self.rng, dim: self.dim }),
      findCover: () => (self.validTarget() ? findCover({ rng: self.rng, dim: self.dim, creaturePos: pos(), target: self.target }) : null),
      findCreepPoint: (step, minDist) => (self.validTarget() ? findCreepPoint({ dim: self.dim, creaturePos: pos(), target: self.target, step, minDist }) : null),
      grabStart: () => self.startGrab(),
      grabEnd: (kind) => self.endGrab(kind),
      dealDamage: () => self.dealDamage(),
      despawn: (outcome) => self.end(outcome, true),
      stalkFactor: () => (self.memory ? stalkFactor(self.memory) : 1),
      retreatFactor: () => (self.memory ? retreatFactor(self.memory) : 1),
      recordGesture: (type, pitch) => self.memory && recordGesture(self.memory, type, pitch),
      recordReaction: (kind, amt) => self.memory && recordReaction(self.memory, kind, amt),
      onRemembered: (type) => dlog(`#${self.id} opens with remembered ${type}`),
      onFlag: (name) => self.onFlag(name),
    };
  }

  players() {
    try {
      return this.dim.getPlayers({ location: this.tw.location, maxDistance: 64 });
    } catch {
      return [];
    }
  }

  validTarget() {
    const p = this.target;
    try {
      return !!p && p.isValid && p.dimension.id === this.dim.id;
    } catch {
      return false;
    }
  }

  /** The target made a sound Tailwail can follow (block broken, door, landing, ...). */
  onNoise(pos) {
    this.noise = { pos: { x: pos.x, y: pos.y, z: pos.z }, t: this.brain.t };
  }

  // ------------------------------------------------------------------ per tick
  update() {
    if (this.ended) return;
    if (!this.tw || !this.tw.isValid) {
      this.end("aborted", false);
      return;
    }
    this.t += DT;
    const snap = this.snapshot();
    this.brain.update(snap, DT);
    if (this.ended || !this.tw.isValid) return; // the brain may have despawned it this tick
    this.footsteps();
    if (this.brain.done && !this.ended) this.end(this.brain.outcome || "observed", true);
  }

  snapshot() {
    const tw = this.tw;
    const cpos = tw.location;
    const posture = this.mover.posture;
    const valid = this.validTarget();
    const tg = {
      valid, alive: false, eligible: false, dist: 999, hdist: 999, dy: 0, canSee: false, watching: false, glance: false, inView: false,
      los: false, sneaking: false, sprinting: false, pitch: 0, speed: 0, closing: 0, movingAway: false, pos: null, hidden: false, light: 15, noise: null,
    };
    if (valid) {
      const p = this.target;
      const pl = p.location;
      tg.pos = { x: pl.x, y: pl.y, z: pl.z };
      let health = 20;
      try {
        health = p.getComponent("minecraft:health").currentValue;
      } catch {
        /* keep default */
      }
      tg.alive = health > 0;
      tg.eligible = survivalLike(p, this.manual);
      tg.dist = dist(pl, cpos);
      tg.hdist = hdist(pl, cpos);
      tg.dy = pl.y - cpos.y;
      tg.sneaking = p.isSneaking;
      tg.sprinting = p.isSprinting;
      tg.pitch = p.getRotation().x;
      if (this.prevTargetPos) tg.speed = hdist(pl, this.prevTargetPos) / DT;
      if (this.prevDist !== null) tg.closing = (this.prevDist - tg.dist) / DT;
      tg.movingAway = tg.closing < -0.5;
      this.prevTargetPos = tg.pos;
      this.prevDist = tg.dist;
      tg.canSee = tg.dist <= 48 && creatureSees(tw, posture, p, 48);
      const v = playerView(p, tw, posture);
      tg.watching = v.watching;
      tg.glance = v.glance;
      tg.inView = v.inView;
      tg.los = v.los;
      tg.light = lightAt(this.dim, p.getHeadLocation());
      tg.hidden = isHiding(p, tg.light, tg.dist, SEARCH.hiddenLight, SEARCH.hiddenDetect);
      if (this.noise && this.brain.t - this.noise.t < 1.5) tg.noise = this.noise;
    }
    // other players freeze the statue just like the target does, but never add agitation
    let anyWatching = tg.watching;
    let anyInView = tg.inView;
    let anyLos = !!tg.los;
    let nearCreature = 0;
    let checked = 0;
    for (const p of this.players()) {
      if (p.id === this.targetId) continue;
      if (checked++ >= 8) break;
      if (!survivalLike(p, true)) continue;
      const v = playerView(p, tw, posture);
      if (v.watching) anyWatching = true;
      if (v.inView) anyInView = true;
      if (v.los) anyLos = true;
      if (dist(p.location, cpos) < 10) nearCreature++;
    }
    const posture2 = this.mover.updatePosture(this.t, this.brain.vis.postureCap, this.brain.vis.postureWant);
    const reach = { hdist: tg.hdist, dy: tg.dy, facingCos: 0, los: false, targetValid: valid && tg.alive && tg.eligible, holdClear: false };
    if (valid && tg.hdist < CHASE.grabReach + 2) {
      const fwd = dirFromYaw(tw.getRotation().y);
      const to = norm({ x: tg.pos.x - cpos.x, y: 0, z: tg.pos.z - cpos.z });
      reach.facingCos = dot(fwd, to);
      const chest = { x: cpos.x, y: cpos.y + 1.4, z: cpos.z };
      reach.los = losClear(this.dim, chest, { x: tg.pos.x, y: tg.pos.y + 1.0, z: tg.pos.z });
      reach.holdClear = this.holdClear();
    }
    return {
      target: tg,
      anyWatching,
      anyInView,
      anyLos,
      others: { nearCreature },
      creature: { pos: cpos, posture: posture2, headroom: this.mover.headHere, atGoal: this.mover.atGoal(), stuck: this.mover.stuck(this.t) },
      reach,
      grab: this.grab ? { holding: this.grab.holding, presses: this.grab.presses, needed: this.grab.needed } : { holding: false, presses: 0, needed: 1 },
    };
  }

  /** Room to stand up and lift someone: its own headroom plus two open blocks at the hold point. */
  holdClear() {
    if (this.mover.headHere < GRAB.needHeadroom) return false;
    const l = this.tw.location;
    const f = dirFromYaw(this.tw.getRotation().y);
    const hp = { x: Math.floor(l.x + f.x * GRAB.holdForward), y: Math.floor(l.y + GRAB.holdUp), z: Math.floor(l.z + f.z * GRAB.holdForward) };
    return isOpen(safeBlock(this.dim, hp)) && isOpen(safeBlock(this.dim, { x: hp.x, y: hp.y + 1, z: hp.z }));
  }

  /** Hand/foot impacts follow distance actually travelled, matching the gait calibration. */
  footsteps() {
    const l = this.tw.location;
    if (this.lastStepPos) this.stepDist += hdist(l, this.lastStepPos);
    this.lastStepPos = { x: l.x, y: l.y, z: l.z };
    const fast = this.brain.state === "chase" || this.brain.state === "search";
    const every = fast ? CHASE.stepEvery / 2 : 2.2;
    if (this.stepDist >= every) {
      this.stepDist = 0;
      if (fast) playCue(this.tw, "step_heavy", this.mover.posture, this.rng);
      else if (this.brain.state !== "death") playCue(this.tw, "step_soft", this.mover.posture, this.rng);
    }
  }

  // ------------------------------------------------------------------ visuals
  setProp(k, v) {
    if (this.props[k] === v) return;
    this.props[k] = v;
    try {
      this.tw.setProperty(k, v);
    } catch (e) {
      dlog("setProperty", k, v, e);
    }
  }

  applyVisual(v) {
    this.setProp("tailwail:pose", POSE[v.pose] ?? 0);
    this.setProp("tailwail:tail", TAIL[v.tail] ?? 0);
    this.setProp("tailwail:breath", BREATH[v.breath] ?? 1);
    this.setProp("tailwail:tremor", clamp(v.tremor | 0, 0, 3));
    this.setProp("tailwail:jaw", clamp(Math.round(v.jaw), 0, 60));
    this.setProp("tailwail:mimic", MIMIC[v.mimic] ?? 0);
    this.setProp("tailwail:mimic_amt", Math.round(clamp(v.mimicAmt, 0, 2) * 20) / 20);
    this.setProp("tailwail:mimic_pitch", clamp(Math.round(v.mimicPitch), -60, 60));
    this.setProp("tailwail:headroom", clamp(this.mover.headHere, 0, 8));
    let yaw = 0;
    let pitch = 0;
    if (v.look === "target" && this.validTarget()) {
      const eyes = creatureEyes(this.tw, this.mover.posture);
      const th = this.target.getHeadLocation();
      yaw = wrapDeg(yawTo(eyes, th) - this.tw.getRotation().y);
      pitch = pitchTo(eyes, th);
    }
    this.setProp("tailwail:look_yaw", Math.round(clamp(yaw, -178, 178) / 2) * 2);
    this.setProp("tailwail:look_pitch", Math.round(clamp(pitch, -60, 60) / 3) * 3);
  }

  // ------------------------------------------------------------------ the player's side of it
  playerFx(name, arg) {
    const p = this.validTarget() ? this.target : null;
    switch (name) {
      case "standoff_on":
        if (!p) return;
        this.affected.add(p.id);
        fx.music(p, "tailwail.music.standoff", 0.85, 2.5);
        fx.pushFog(p, "tailwail:dread");
        fx.heartbeat(p, 66, 0.4);
        return;
      case "standoff_level": {
        if (!p) return;
        const a = arg || 0;
        fx.heartbeat(p, 66 + a * 0.95, 0.4 + a * 0.005);
        const want = Math.round(70 - a * 0.2);
        if (this.fovAt === null || Math.abs(this.fovAt - want) >= 3) {
          this.fovAt = want;
          fx.fov(p, want, 1.4);
        }
        return;
      }
      case "silence":
        if (!p) return;
        fx.stopMusic(p);
        fx.heartbeat(p, 0);
        return;
      case "scream": {
        const at = this.tw.location;
        for (const pl of this.players()) {
          const d = dist(pl.location, at);
          if (d > 40) continue;
          fx.shake(pl, d < 12 ? 0.7 : d < 24 ? 0.4 : 0.2, 1.6, d < 16);
          if (d < 18) {
            try {
              pl.addEffect("darkness", 70, { amplifier: 0, showParticles: false });
            } catch {
              /* cosmetic */
            }
          }
        }
        if (p) {
          this.affected.add(p.id);
          fx.fov(p, 50, 0.25, EasingType.OutCubic);
          this.fovAt = 50;
        }
        if (this.settings.torchSnuff) {
          const torches = findTorches(this.dim, at, 12, 14);
          torches.forEach((t, i) => system.runTimeout(() => this.dim.isChunkLoaded(t) && snuff(this.dim, t), 2 + i * 2));
          if (torches.length && p) this.onFlag("snuff");
        }
        return;
      }
      case "scream_far":
        if (!p) return;
        this.affected.add(p.id);
        fx.shake(p, 0.1, 1.5);
        fx.heartbeat(p, 120, 0.6);
        return;
      case "chase_on":
        if (!p) return;
        this.affected.add(p.id);
        fx.music(p, "tailwail.music.chase", 1.0, arg && arg.resumed ? 0.8 : 0.2);
        fx.pushFog(p, "tailwail:dread");
        fx.heartbeat(p, 168, 0.85);
        fx.fov(p, 84, 1.0);
        this.fovAt = 84;
        return;
      case "search_on":
        if (!p) return;
        fx.music(p, "tailwail.music.standoff", 0.75, 3);
        fx.heartbeat(p, 128, 0.65);
        fx.resetFov(p, 1.5);
        this.fovAt = null;
        return;
      case "snuff_near_target": {
        if (!p) return;
        const view = p.getViewDirection();
        const eye = p.getHeadLocation();
        const list = findTorches(this.dim, p.location, 14, 10).filter((t) => {
          const c = { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 };
          return dist(c, eye) >= 4 && dot(norm(sub(c, eye)), view) < 0.25;
        });
        let n = (arg && arg.count) || 1;
        for (const t of list) {
          if (n-- <= 0) break;
          if (snuff(this.dim, t)) this.onFlag("snuff");
        }
        return;
      }
      case "snuff_path":
        for (const t of findTorches(this.dim, this.tw.location, 3.5, 4)) snuff(this.dim, t);
        return;
      case "end":
        for (const id of this.affected) {
          const pl = this.director.playerById(id);
          if (pl) fx.endMood(pl);
        }
        this.fovAt = null;
        return;
      default:
    }
  }

  onFlag(name) {
    if (!this.validTarget()) return;
    const p = this.target;
    try {
      const s = getSchedule(p);
      const r = unlock(s.jr, name);
      if (r.added) {
        s.jr = r.mask;
        saveSchedule(p, s);
        system.runTimeout(() => p.isValid && p.sendMessage(`§8[Torn journal] §7A new page: §f${r.added.title}`), 60);
      }
    } catch (e) {
      dlog("journal", e);
    }
  }

  // ------------------------------------------------------------------ contact (single authority)
  startGrab() {
    if (!this.validTarget()) return false;
    const p = this.target;
    if (grabFor(p.id)) return false;
    const g = new GrabController(this.tw, p, this.settings);
    let ok = false;
    try {
      ok = g.start();
    } catch (e) {
      warn("grab start", errorText(e));
      try {
        g.release("abort");
      } catch {
        /* nothing to undo */
      }
      ok = false;
    }
    if (!ok) return false;
    this.grab = g;
    this.affected.add(p.id);
    return true;
  }

  endGrab(kind) {
    const g = this.grab;
    this.grab = null;
    if (g) g.release(kind);
  }

  dealDamage() {
    if (!this.validTarget()) return;
    const p = this.target;
    try {
      const ok = p.applyDamage(this.settings.strikeDamage, { cause: EntityDamageCause.entityAttack, damagingEntity: this.tw });
      if (ok) {
        const d = norm(sub(p.location, this.tw.location));
        p.applyKnockback({ x: d.x * 1.1, z: d.z * 1.1 }, 0.35);
        fx.shake(p, 0.4, 0.35, true);
      }
      dlog(`#${this.id} strike dealt ${this.settings.strikeDamage} -> ${ok}`);
    } catch (e) {
      warn("damage failed", errorText(e));
    }
  }

  onHit(attacker, amount) {
    const isTarget = !!attacker && attacker.id === this.targetId;
    if (this.grab && this.grab.holding && isTarget) {
      this.grab.press(2); // fighting back while held counts double
      return;
    }
    if (!isTarget && attacker && attacker.typeId === "minecraft:player" && this.brain.canRetarget() && !this.validTarget()) {
      this.retarget(attacker);
    }
    this.brain.onHit(isTarget, amount || 0);
    playCue(this.tw, "hurt", this.mover.posture, this.rng);
  }

  retarget(player) {
    this.target = player;
    this.targetId = player.id;
    this.memory = getMemory(player);
    this.brain.memory = this.memory;
    this.brain.markRetarget();
    this.prevDist = null;
    this.prevTargetPos = null;
    dlog(`#${this.id} retargeted to ${player.name}`);
  }

  die() {
    if (this.brain.state === "death") return;
    this.brain.die();
    this.mover.hold();
    this.applyVisual({ ...this.brain.vis, mimic: "none", mimicAmt: 0, mimicPitch: 0 });
  }

  // ------------------------------------------------------------------ cleanup
  end(outcome, removeEntity) {
    if (this.ended) return;
    this.ended = true;
    if (this.grab) this.endGrab("abort");
    try {
      if (this.memory && this.validTarget()) {
        const notice = this.brain.noticeT >= 0 ? this.brain.noticeT : 0;
        endEncounter(this.memory, this.setup, outcome, notice);
        saveMemory(this.target, this.memory);
      }
      if (this.target && this.target.isValid && !this.manual) {
        const s = getSchedule(this.target);
        onEncounterEnd(s, outcome, this.settings, this.rng);
        saveSchedule(this.target, s);
      }
    } catch (e) {
      warn("end bookkeeping", errorText(e));
    }
    for (const id of this.affected) {
      const p = this.director.playerById(id);
      if (p) fx.endMood(p);
    }
    this.mover.dispose();
    if (removeEntity && this.tw && this.tw.isValid) {
      try {
        if (outcome === "killed") this.dim.spawnXp(this.tw.location, 60);
        this.tw.remove();
      } catch (e) {
        dlog("remove", e);
      }
    }
    this.director.unregister(this, outcome);
    dlog(`encounter ${this.id} end outcome=${outcome} after ${this.t.toFixed(1)}s`);
  }

  describe() {
    const b = this.brain;
    return `#${this.id} ${this.setup} state=${b.state} t=${b.stateT.toFixed(1)}s agit=${b.agit.value.toFixed(0)} posture=${this.mover.posture} target=${this.target ? this.target.name : "-"} outcome=${b.outcome || "-"}`;
  }
}
