// One live encounter: owns exactly one Tailwail entity, its lure, its brain and the
// locked target.  The director holds at most one Encounter per entity id, so damage
// and state decisions have a single authority.
import { EntityDamageCause, GameMode, system } from "@minecraft/server";
import { CHASE, DT, ENCOUNTER, IMITATION, POSTURE } from "../config.js";
import { Brain } from "../core/brain.js";
import { endEncounter, recordGesture, recordReaction, rememberedGesture, retreatFactor, stalkFactor } from "../core/memory.js";
import { onEncounterEnd } from "../core/scheduler.js";
import { dist, dot, hdist, norm, pitchTo, sub, wrapDeg, yawTo, dirFromYaw } from "../util/vec.js";
import { playCue } from "./audio.js";
import { applyViewerFx, shake, stopShake } from "./effects.js";
import { dlog, errorText, warn } from "./log.js";
import { Mover } from "./mover.js";
import { creatureEyes, creatureSees, losClear, playerView } from "./perception.js";
import { findCover, findObservationSpot, findRetreatSpot, findSearchPoints, findStandoffSpot } from "./spots.js";
import { getMemory, getSchedule, getSettings, saveMemory, saveSchedule } from "./store.js";

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

export class Encounter {
  /**
   * @param {object} o {director, tw, target, setup, slot, rng, manual, orphan}
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
    this.started = system.currentTick;
    this.viewers = new Set();
    let remembered = null;
    if (this.memory && !o.orphan) {
      const r = rememberedGesture(this.memory, IMITATION.rememberedMinCount);
      if (r && this.rng.chance(IMITATION.rememberedChance)) remembered = r;
    }
    this.remembered = remembered;
    this.brain = new Brain({ setup: o.setup, settings: this.settings, memory: this.memory, rng: this.rng, ctx: this.ctx(), remembered });
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
    this.mover.setPosture(o.posture || "tall", 0);
    dlog(`encounter ${this.id} start setup=${this.setup} slot=${this.slot} target=${this.target ? this.target.name : "-"}${remembered ? " remembers " + remembered.type : ""}`);
  }

  // ------------------------------------------------------------------ brain adapter
  ctx() {
    const self = this;
    const tw = () => self.tw;
    return {
      log: (m) => dlog(`#${self.id} ${m}`),
      cue: (name) => {
        dlog(`#${self.id} cue ${name}`);
        playCue(self.tw, name, self.mover.posture, self.rng);
        if (name === "wail") self.forPlayersNear(24, (p) => shake(p, 0.18, 0.9));
      },
      setVisual: (v) => self.applyVisual(v),
      hold: () => self.mover.hold(),
      moveTo: (pos, speed) => self.mover.moveTo(pos, speed, self.t),
      faceToward: (pos) => self.mover.faceToward(pos),
      recover: (n) => {
        const how = self.mover.recover(n, self.t, self.rng);
        if (n >= 3) self.setProp("tailwail:action", "stuck");
        dlog(`#${self.id} recover ${n}: ${how}`);
      },
      findObservationSpot: (o) => findObservationSpot({ ...o, rng: self.rng, dim: self.dim, creaturePos: tw().location, target: self.target, players: self.players() }),
      findStandoffSpot: (min, max, headroom) => findStandoffSpot({ min, max, headroom, rng: self.rng, dim: self.dim, creaturePos: tw().location, target: self.target }),
      findRetreatSpot: (min, max) => findRetreatSpot({ min, max, rng: self.rng, dim: self.dim, creaturePos: tw().location, facing: tw().getRotation().y, target: self.validTarget() ? self.target : null, players: self.players() }),
      findSearchPoints: (origin, n, radius) => findSearchPoints({ origin, n, radius, rng: self.rng, dim: self.dim }),
      findCover: () => (self.validTarget() ? findCover({ rng: self.rng, dim: self.dim, creaturePos: tw().location, target: self.target }) : null),
      dealDamage: () => self.dealDamage(),
      despawn: (outcome) => self.end(outcome, true),
      stalkFactor: () => (self.memory ? stalkFactor(self.memory) : 1),
      retreatFactor: () => (self.memory ? retreatFactor(self.memory) : 1),
      recordGesture: (type, pitch) => self.memory && recordGesture(self.memory, type, pitch),
      recordReaction: (kind, amt) => self.memory && recordReaction(self.memory, kind, amt),
      onRemembered: (type) => dlog(`#${self.id} opens with remembered ${type}`),
    };
  }

  players() {
    try {
      return this.dim.getPlayers({ location: this.tw.location, maxDistance: 64 });
    } catch {
      return [];
    }
  }

  forPlayersNear(r, fn) {
    for (const p of this.players()) if (dist(p.location, this.tw.location) <= r) fn(p);
  }

  validTarget() {
    const p = this.target;
    try {
      return !!p && p.isValid && p.dimension.id === this.dim.id;
    } catch {
      return false;
    }
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
    const posture = this.mover.posture;
    const cpos = tw.location;
    const valid = this.validTarget();
    const tg = { valid, alive: false, dimensionOk: valid, eligible: false, dist: 999, hdist: 999, dy: 0, canSee: false, watching: false,
      sneaking: false, sprinting: false, pitch: 0, speed: 0, closing: 0, movingAway: false, pos: null };
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
      tg.los = v.los;
    }
    // other observers: they freeze stalking movement but never add agitation
    let anyWatching = tg.watching;
    let anyLos = !!tg.los;
    let nearCreature = 0;
    let checked = 0;
    for (const p of this.players()) {
      if (p.id === this.targetId) continue;
      if (checked++ >= 8) break;
      const v = playerView(p, tw, posture);
      if (v.watching) anyWatching = true;
      if (v.los) anyLos = true;
      if (dist(p.location, cpos) < 10) nearCreature++;
      if (!this.viewers.has(p.id)) {
        this.viewers.add(p.id);
        applyViewerFx(p, tw);
      }
    }
    if (valid && !this.viewers.has(this.targetId)) {
      this.viewers.add(this.targetId);
      applyViewerFx(this.target, tw);
    }
    const posture2 = this.mover.updatePosture(this.t, this.brain.vis.postureCap, this.brain.vis.postureWant);
    const geom = { hdist: tg.hdist, dy: tg.dy, facingCos: 0, los: false, targetValid: valid && tg.alive && tg.eligible };
    if (valid && tg.hdist < CHASE.reach + 2) {
      const fwd = dirFromYaw(tw.getRotation().y);
      const to = norm({ x: tg.pos.x - cpos.x, y: 0, z: tg.pos.z - cpos.z });
      geom.facingCos = dot(fwd, to);
      const chest = { x: cpos.x, y: cpos.y + POSTURE[posture2].height * 0.5, z: cpos.z };
      geom.los = losClear(this.dim, chest, { x: tg.pos.x, y: tg.pos.y + 1.0, z: tg.pos.z });
    }
    return {
      target: tg,
      anyWatching,
      anyLos,
      others: { nearCreature },
      creature: { pos: cpos, posture: posture2, headroom: this.mover.headHere, atGoal: this.mover.atGoal(), stuck: this.mover.stuck(this.t) },
      strikeGeom: geom,
    };
  }

  /** Hand/foot impacts follow distance actually travelled, matching the gait calibration. */
  footsteps() {
    const l = this.tw.location;
    if (this.lastStepPos) this.stepDist = (this.stepDist || 0) + hdist(l, this.lastStepPos);
    this.lastStepPos = { x: l.x, y: l.y, z: l.z };
    const chase = this.brain.state === "chase" || this.brain.state === "search";
    const every = chase ? CHASE.stepEvery / 2 : 2.2; // two contacts per gallop cycle
    if ((this.stepDist || 0) >= every) {
      this.stepDist = 0;
      if (chase) playCue(this.tw, "step_heavy", this.mover.posture, this.rng);
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
    this.setProp("tailwail:state", v.state);
    this.setProp("tailwail:tail", v.tail);
    this.setProp("tailwail:voice", v.voice);
    this.setProp("tailwail:agit", v.agit);
    this.setProp("tailwail:action", v.action);
    this.setProp("tailwail:mimic", v.mimic);
    this.setProp("tailwail:mimic_amt", Math.round(Math.max(0, Math.min(2, v.mimicAmt)) * 20) / 20);
    this.setProp("tailwail:mimic_pitch", Math.round(Math.max(-60, Math.min(60, v.mimicPitch))));
    this.setProp("tailwail:headroom", Math.max(0, Math.min(8, this.mover.headHere)));
    let yaw = 0;
    let pitch = 0;
    if (v.look === "target" && this.validTarget()) {
      const eyes = creatureEyes(this.tw, this.mover.posture);
      const th = this.target.getHeadLocation();
      yaw = wrapDeg(yawTo(eyes, th) - this.tw.getRotation().y);
      pitch = pitchTo(eyes, th);
    }
    this.setProp("tailwail:look_yaw", Math.round(Math.max(-90, Math.min(90, yaw)) / 3) * 3);
    this.setProp("tailwail:look_pitch", Math.round(Math.max(-60, Math.min(60, pitch)) / 3) * 3);
  }

  // ------------------------------------------------------------------ damage (single authority)
  dealDamage() {
    if (!this.validTarget()) return;
    const p = this.target;
    const amount = this.settings.damageHearts * 2;
    try {
      const ok = p.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: this.tw });
      if (ok) {
        const d = norm(sub(p.location, this.tw.location));
        p.applyKnockback({ x: d.x * 0.9, z: d.z * 0.9 }, 0.3);
        shake(p, 0.25, 0.35);
      }
      dlog(`#${this.id} strike dealt ${amount} -> ${ok}`);
    } catch (e) {
      warn("damage failed", errorText(e));
    }
  }

  onHit(attacker) {
    const isTarget = attacker && attacker.id === this.targetId;
    if (!isTarget && attacker && attacker.typeId === "minecraft:player" && this.brain.canRetarget() && !this.validTarget()) {
      this.retarget(attacker);
    }
    this.brain.onHit(isTarget);
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
    this.applyVisual({ ...this.brain.vis, state: "death", mimic: "none", mimicAmt: 0, mimicPitch: 0 });
  }

  // ------------------------------------------------------------------ cleanup
  end(outcome, removeEntity) {
    if (this.ended) return;
    this.ended = true;
    const now = this.director.now();
    try {
      if (this.memory && this.validTarget()) {
        const notice = this.brain.noticeT >= 0 ? this.brain.noticeT : 0;
        endEncounter(this.memory, this.setup, outcome, notice);
        saveMemory(this.target, this.memory);
      }
      if (this.target && this.target.isValid && !this.manual) {
        const s = getSchedule(this.target);
        onEncounterEnd(s, now, outcome, this.settings, this.rng);
        saveSchedule(this.target, s);
      }
    } catch (e) {
      warn("end bookkeeping", errorText(e));
    }
    this.mover.dispose();
    for (const id of this.viewers) {
      const p = this.director.playerById(id);
      if (p) stopShake(p);
    }
    if (removeEntity && this.tw && this.tw.isValid) {
      try {
        if (outcome === "killed") this.dim.spawnXp(this.tw.location, 40);
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

export { ENCOUNTER };
