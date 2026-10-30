// One live encounter: owns exactly one Tailwail entity, its lure, its brain and the
// locked target.  The director holds at most one Encounter per entity id, so damage
// and state decisions have a single authority.
import { EasingType, EntityDamageCause, GameMode, system } from "@minecraft/server";
import { CHASE, DT, GRAB, IMITATION, SEARCH } from "../config.js";
import { Brain } from "../core/brain.js";
import { ACT, BREATH, MIMIC, SHOT, TAIL } from "../core/ids.js";
import { unlock } from "../core/journal.js";
import { endEncounter, recordGesture, recordReaction, rememberedGesture, retreatFactor, stalkFactor } from "../core/memory.js";
import { onEncounterEnd } from "../core/scheduler.js";
import { dirFromYaw, dist, dot, hdist, norm, pitchTo, sub, wrapDeg, yawTo } from "../util/vec.js";
import { BashController, ClimbController, blockedAhead, findCeilingSpot, findCornerSpot, findCrossPath, inLowGap } from "./actions.js";
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
// acts that would put its head through a tunnel ceiling: shown as the tunnel crawl instead
const TUNNEL_SAFE = new Set(["loco_tunnel", "cling", "climb", "reach_in", "death", "shot", "bash"]);

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
   * @param {object} o {director, tw, target, setup, slot, rng, manual, showcase, orphan, posture, stage}
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
    this.climb = null;
    this.bash = null;
    this.floating = false;
    this.noise = null;
    this.fovAt = null;
    this.stepDist = 0;
    this.lastStepPos = null;
    this.prevPos = null;
    let remembered = null;
    if (this.memory && !o.orphan) {
      const r = rememberedGesture(this.memory, IMITATION.rememberedMinCount);
      const chance = o.setup === "the_rehearsal" ? 1 : IMITATION.rememberedChance;
      if (r && this.rng.chance(chance)) remembered = r;
    }
    this.remembered = remembered;
    this.mover.setPosture(o.posture || "tall", 0);
    this.brain = new Brain({
      setup: o.setup, settings: this.settings, memory: this.memory, rng: this.rng, ctx: this.ctx(), remembered,
      showcase: !!o.showcase, stage: o.stage || 0,
    });
    if (o.orphan) {
      this.brain.finish("aborted");
      this.brain.enter("leave", "reloaded");
    }
    try {
      this.tw.setDynamicProperty("tailwail:enc", JSON.stringify({ e: this.id, t: this.targetId, s: this.setup, k: this.slot }));
      this.tw.setProperty("tailwail:managed", true);
      this.tw.triggerEvent(this.settings.openDoors ? "tailwail:doors_on" : "tailwail:doors_off");
      this.tw.triggerEvent("tailwail:float_off"); // gravity on (also repairs creatures saved by older versions)
    } catch (e) {
      dlog("init", errorText(e));
    }
    dlog(`encounter ${this.id} start setup=${this.setup} slot=${this.slot} target=${this.target ? this.target.name : "-"}${remembered ? " remembers " + remembered.type : ""}`);
  }

  // ------------------------------------------------------------------ brain adapter
  ctx() {
    const self = this;
    const pos = () => self.tw.location;
    const tgt = () => (self.validTarget() ? self.target : null);
    return {
      log: (m) => dlog(`#${self.id} ${m}`),
      cue: (name) => {
        dlog(`#${self.id} cue ${name}`);
        playCue(self.tw, name, self.mover.posture, self.rng);
      },
      fx: (name, arg) => self.playerFx(name, arg),
      setVisual: (v) => self.applyVisual(v),
      play: (name) => self.playShot(name),
      hold: () => self.mover.hold(),
      moveTo: (p, speed) => self.mover.moveTo(p, speed, self.t),
      faceToward: (p) => self.mover.faceToward(p),
      faceNow: (p) => self.faceNow(p),
      pounce: (p) => self.pounce(p),
      recover: (n) => {
        const how = self.mover.recover(n, self.t, self.rng);
        dlog(`#${self.id} recover ${n}: ${how}`);
      },
      findObservationSpot: (o) => (tgt() ? findObservationSpot({ ...o, rng: self.rng, dim: self.dim, creaturePos: pos(), target: self.target, players: self.players() }) : null),
      findStandoffSpot: (min, max, head) => (tgt() ? findStandoffSpot({ min, max, headroom: head, rng: self.rng, dim: self.dim, creaturePos: pos(), target: self.target }) : null),
      findRetreatSpot: (min, max) => findRetreatSpot({ min, max, rng: self.rng, dim: self.dim, creaturePos: pos(), facing: self.tw.getRotation().y, target: tgt(), players: self.players() }),
      findSearchPoints: (origin, n, radius) => findSearchPoints({ origin, n, radius, rng: self.rng, dim: self.dim }),
      findCover: () => (tgt() ? findCover({ rng: self.rng, dim: self.dim, creaturePos: pos(), target: self.target }) : null),
      findCreepPoint: (step, minDist) => (tgt() ? findCreepPoint({ dim: self.dim, creaturePos: pos(), target: self.target, step, minDist }) : null),
      findCrossPath: () => (tgt() ? findCrossPath({ rng: self.rng, dim: self.dim, player: self.target }) : null),
      placeAt: (p, facing) => self.placeAt(p, facing),
      cling: () => self.startCling(),
      huddle: () => self.startHuddle(),
      drop: () => self.setFloat(false),
      climbStart: (goal) => self.startClimb(goal),
      climbAbort: () => self.climb && self.climb.abort(),
      bashStart: () => self.startBash(),
      bashStop: () => {
        if (self.bash) self.bash.stop();
        self.bash = null;
      },
      grabStart: (spec) => self.startGrab(spec),
      grabStruggle: () => self.grab && self.grab.beginStruggle(),
      grabEnd: (kind) => self.endGrab(kind),
      dealDamage: (kind) => self.dealDamage(kind),
      despawn: (outcome) => self.end(outcome, true),
      scheduleReturn: () => self.director.scheduleReturn && self.validTarget() && self.director.scheduleReturn(self.target),
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
    const state = this.brain.state;
    const tg = {
      valid, alive: false, eligible: false, dist: 999, hdist: 999, dy: 0, canSee: false, watching: false, glance: false, inView: false,
      los: false, sneaking: false, sprinting: false, pitch: 0, speed: 0, closing: 0, movingAway: false, pos: null, hidden: false, light: 15,
      noise: null, inGap: false,
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
      tg.canSee = tg.dist <= 56 && creatureSees(tw, posture, p, 56);
      const v = playerView(p, tw, posture);
      tg.watching = v.watching;
      tg.glance = v.glance;
      tg.inView = v.inView;
      tg.los = v.los;
      tg.light = lightAt(this.dim, p.getHeadLocation());
      tg.hidden = isHiding(p, tg.light, tg.dist, SEARCH.hiddenLight, SEARCH.hiddenDetect);
      if (this.noise && this.brain.t - this.noise.t < 1.5) tg.noise = this.noise;
      if ((state === "hunt" || state === "search" || state === "reach") && tg.hdist < 4) tg.inGap = inLowGap(p);
    }
    // other players count for "is it being looked at" (never for agitation)
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
    const posture2 = this.floating ? posture : this.mover.updatePosture(this.t, this.brain.vis.postureCap, this.brain.vis.postureWant);
    const reach = { hdist: tg.hdist, dy: tg.dy, facingCos: 0, los: false, targetValid: valid && tg.alive && tg.eligible, holdClear: false };
    if (valid && tg.hdist < CHASE.pounceMax + 1) {
      const fwd = dirFromYaw(tw.getRotation().y);
      const to = norm({ x: tg.pos.x - cpos.x, y: 0, z: tg.pos.z - cpos.z });
      reach.facingCos = dot(fwd, to);
      const chest = { x: cpos.x, y: cpos.y + 1.4, z: cpos.z };
      reach.los = losClear(this.dim, chest, { x: tg.pos.x, y: tg.pos.y + 1.0, z: tg.pos.z });
      if (tg.hdist < CHASE.grabReach + 2) reach.holdClear = this.holdClear();
    }
    let health = 1;
    let maxHealth = 1;
    try {
      const h = tw.getComponent("minecraft:health");
      health = h.currentValue;
      maxHealth = h.effectiveMax;
    } catch {
      /* keep defaults */
    }
    // a door or window in the way (only looked for when it is close and not getting anywhere)
    let blocked = null;
    if (state === "hunt" && valid && tg.dist < 20 && this.prevPos && hdist(cpos, this.prevPos) < 0.15) {
      const b = blockedAhead(tw, this.target, this.settings.breakBlocks | 0);
      if (b) {
        blocked = b.kind;
        this.blockedAt = b;
      }
    }
    this.prevPos = { x: cpos.x, y: cpos.y, z: cpos.z };
    return {
      target: tg,
      anyWatching,
      anyInView,
      anyLos,
      others: { nearCreature },
      creature: {
        pos: cpos, posture: posture2, headroom: this.mover.headHere, atGoal: this.mover.atGoal(), stuck: this.mover.stuck(this.t),
        health, maxHealth, climbing: !!(this.climb && this.climb.active), bashing: !!(this.bash && this.bash.active), blocked,
      },
      reach,
      grab: this.grab ? { holding: this.grab.holding, success: this.grab.success, failed: this.grab.failed, calm: this.grab.calm }
        : { holding: false },
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

  /** Hand/foot impacts follow distance actually travelled, matching the gait strides. */
  footsteps() {
    const l = this.tw.location;
    if (this.lastStepPos) this.stepDist += hdist(l, this.lastStepPos);
    this.lastStepPos = { x: l.x, y: l.y, z: l.z };
    const st = this.brain.state;
    const fast = st === "hunt" || st === "flee" || (this.brain.vis.act === "loco" && this.mover.speed >= 0.36);
    const every = fast ? CHASE.stepEvery : 2.2;
    if (this.stepDist >= every) {
      this.stepDist = 0;
      if (st === "death" || this.floating) return;
      playCue(this.tw, fast ? "step_heavy" : "step_soft", this.mover.posture, this.rng);
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
    let act = v.act;
    const posture = this.mover.posture;
    if (posture === "crawl" && !TUNNEL_SAFE.has(act) && !this.floating) act = "loco_tunnel";
    else if (act === "tall" && this.mover.headHere < 5) act = "watch";
    else if ((act === "watch" || act === "hold" || act === "stunned" || act === "savor") && this.mover.headHere < 4) act = "watch_low";
    this.setProp("tailwail:act", ACT[act] ?? 0);
    this.setProp("tailwail:tail", TAIL[v.tail] ?? 0);
    this.setProp("tailwail:breath", BREATH[v.breath] ?? 1);
    this.setProp("tailwail:tremor", clamp(v.tremor | 0, 0, 3));
    this.setProp("tailwail:jaw", clamp(Math.round(v.jaw), 0, 60));
    this.setProp("tailwail:mimic", MIMIC[v.mimic] ?? 0);
    this.setProp("tailwail:mimic_amt", Math.round(clamp(v.mimicAmt, 0, 2) * 20) / 20);
    this.setProp("tailwail:mimic_pitch", clamp(Math.round(v.mimicPitch), -60, 60));
    let yaw = 0;
    let pitch = 0;
    if (v.look === "target" && this.validTarget()) {
      const eyes = creatureEyes(this.tw, this.mover.posture);
      const th = this.target.getHeadLocation();
      yaw = wrapDeg(yawTo(eyes, th) - this.tw.getRotation().y);
      pitch = pitchTo(eyes, th);
      if (act === "loco_tunnel") pitch = clamp(pitch, -10, 20); // no looking up through the ceiling
    } else if (v.look === "back") {
      yaw = 175; // walking away with its head turned all the way round
    }
    this.setProp("tailwail:look_yaw", Math.round(clamp(yaw, -178, 178) / 2) * 2);
    this.setProp("tailwail:look_pitch", Math.round(clamp(pitch, -60, 60) / 3) * 3);
  }

  /** One-shot clip (attacks, scream...) on its own client controller: no client logic involved. */
  playShot(name) {
    const s = SHOT[name];
    if (!s) return;
    try {
      this.tw.playAnimation(s.anim, { controller: s.partial ? "tailwail_partial" : "tailwail_shot", blendOutTime: s.partial ? 0.1 : 0.15 });
    } catch (e) {
      dlog("playAnimation", name, e);
    }
  }

  faceNow(p) {
    try {
      this.tw.setRotation({ x: 0, y: yawTo(this.tw.location, p) });
    } catch {
      /* removed */
    }
  }

  pounce(p) {
    try {
      const l = this.tw.location;
      const d = hdist(l, p);
      const dir = norm({ x: p.x - l.x, y: 0, z: p.z - l.z });
      const h = clamp(d / 7, 0.5, CHASE.pounceSpeed + 0.35);
      this.tw.applyImpulse({ x: dir.x * h, y: CHASE.pounceLift + clamp(p.y - l.y, 0, 3) * 0.08, z: dir.z * h });
    } catch (e) {
      dlog("pounce", e);
    }
  }

  placeAt(p, facing) {
    try {
      this.tw.teleport({ x: p.x, y: p.y, z: p.z }, facing ? { facingLocation: { x: facing.x, y: p.y + 1, z: facing.z } } : undefined);
      this.mover.hold();
    } catch (e) {
      dlog("placeAt", e);
    }
  }

  setFloat(on) {
    if (this.floating === on) return;
    this.floating = on;
    try {
      this.tw.triggerEvent(on ? "tailwail:float_on" : "tailwail:float_off");
    } catch (e) {
      dlog("float", e);
    }
  }

  startCling() {
    if (!this.validTarget()) return false;
    const spot = findCeilingSpot({ rng: this.rng, dim: this.dim, player: this.target });
    if (!spot) return false;
    this.mover.setPosture("crawl", this.t);
    this.setFloat(true);
    this.placeAt(spot, this.target.location);
    dlog(`#${this.id} clings to the ceiling at ${spot.x.toFixed(1)} ${spot.y.toFixed(1)} ${spot.z.toFixed(1)}`);
    return true;
  }

  startHuddle() {
    if (!this.validTarget()) return false;
    const spot = findCornerSpot({ rng: this.rng, dim: this.dim, player: this.target });
    if (!spot) return false;
    try {
      // facing into its corner, back to you
      this.tw.teleport({ x: spot.x, y: spot.y, z: spot.z }, { rotation: { x: 0, y: spot.faceYaw } });
      this.mover.hold();
    } catch (e) {
      dlog("huddle", e);
      return false;
    }
    return true;
  }

  startClimb(goal) {
    if (this.climb && this.climb.active) return true;
    this.climb = new ClimbController(this.tw, (on) => this.setFloat(on));
    const ok = this.climb.start(goal);
    if (!ok) this.climb = null;
    return ok;
  }

  startBash() {
    const b = this.blockedAt;
    if (!b) return false;
    const [lo, hi] = CHASE.bashHits;
    const need = this.rng.int(lo, hi) + (b.kind === "door" ? 0 : -1);
    this.faceNow({ x: b.loc.x + 0.5, y: b.loc.y, z: b.loc.z + 0.5 });
    this.bash = new BashController(this.tw, b, Math.max(1, need), (kind, loc, last) => {
      playCue(this.tw, "door_bang", this.mover.posture, this.rng);
      for (const p of this.players()) {
        const d = dist(p.location, loc);
        if (d < 18) fx.shake(p, d < 6 ? 0.45 : 0.2, 0.25);
      }
      if (last) {
        this.onFlag("smash");
        try {
          this.dim.playSound(kind === "glass" ? "random.glass" : "mob.zombie.woodbreak", loc, { volume: 1.0 });
        } catch {
          /* cosmetic */
        }
      }
    });
    this.blockedAt = null;
    return true;
  }

  // ------------------------------------------------------------------ the player's side of it
  playerFx(name, arg) {
    const p = this.validTarget() ? this.target : null;
    switch (name) {
      case "standoff_on":
        if (!p) return;
        this.affected.add(p.id);
        fx.music(p, "tailwail.music.standoff", 0.9, 1.0);
        fx.pushFog(p, "tailwail:dread");
        fx.heartbeat(p, 90, 0.55);
        fx.shake(p, 0.08, 0.6);
        return;
      case "standoff_level": {
        if (!p) return;
        const a = arg || 0;
        fx.heartbeat(p, 90 + a * 0.8, 0.55 + a * 0.004);
        if (a < 20) return;
        const want = Math.round(72 - (a - 20) * 0.22);
        if (this.fovAt === null || Math.abs(this.fovAt - want) >= 3) {
          this.fovAt = want;
          fx.fov(p, want, 1.0);
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
        const short = !!(arg && arg.short);
        for (const pl of this.players()) {
          const d = dist(pl.location, at);
          if (d > 48) continue;
          fx.shake(pl, short ? (d < 14 ? 0.45 : 0.2) : d < 14 ? 0.8 : d < 28 ? 0.45 : 0.25, short ? 0.8 : 1.8, d < 18);
          if (!short && d < 20) {
            try {
              pl.addEffect("darkness", 60, { amplifier: 0, showParticles: false });
            } catch {
              /* cosmetic */
            }
          }
        }
        if (p) {
          this.affected.add(p.id);
          if (!short) {
            fx.fov(p, 48, 0.2, EasingType.OutCubic);
            this.fovAt = 48;
          }
        }
        if (this.settings.torchSnuff && !short) {
          const torches = findTorches(this.dim, at, 14, 16);
          torches.forEach((t, i) => system.runTimeout(() => this.dim.isChunkLoaded(t) && snuff(this.dim, t), 2 + i * 2));
          if (torches.length && p) this.onFlag("snuff");
        }
        return;
      }
      case "scream_far":
        if (!p) return;
        this.affected.add(p.id);
        fx.shake(p, 0.15, 1.5);
        fx.heartbeat(p, 130, 0.7);
        return;
      case "slam_shock": {
        const at = this.tw.location;
        for (const pl of this.players()) {
          const d = dist(pl.location, at);
          if (d < 14) fx.shake(pl, d < 6 ? 0.7 : 0.3, 0.5, true);
        }
        return;
      }
      case "chase_on":
        if (!p) return;
        this.affected.add(p.id);
        fx.music(p, "tailwail.music.chase", 1.0, arg && arg.resumed ? 0.5 : 0.1);
        fx.pushFog(p, "tailwail:dread");
        fx.heartbeat(p, 172, 0.9);
        fx.fov(p, 86, 0.7);
        this.fovAt = 86;
        return;
      case "search_on":
        if (!p) return;
        fx.music(p, "tailwail.music.standoff", 0.8, 2);
        fx.heartbeat(p, 140, 0.7);
        fx.resetFov(p, 1.2);
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
        for (const t of findTorches(this.dim, this.tw.location, 4, 4)) snuff(this.dim, t);
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
  startGrab(spec) {
    if (!this.validTarget()) return false;
    const p = this.target;
    if (grabFor(p.id)) return false;
    const g = new GrabController(this.tw, p, this.settings, spec);
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

  /** Damage at an attack's impact frame (the brain has already checked reach and sight). */
  dealDamage(kind) {
    if (!this.validTarget()) return;
    const p = this.target;
    const s = this.settings;
    const amount = { slam: s.slamDamage, pounce: s.pounceDamage, reach: Math.max(1, Math.round(s.swipeDamage * 0.6)) }[kind] ?? s.swipeDamage;
    try {
      const ok = p.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: this.tw });
      if (ok) {
        const d = norm(sub(p.location, this.tw.location));
        if (kind === "slam") {
          p.applyKnockback({ x: d.x * 0.9, z: d.z * 0.9 }, 0.6);
          fx.shake(p, 0.9, 0.6, true);
          fx.fade(p, 0.0, 0.1, 0.5, { red: 0.3, green: 0, blue: 0 });
          p.addEffect("slowness", 30, { amplifier: 1, showParticles: false });
        } else if (kind === "pounce") {
          p.applyKnockback({ x: d.x * 1.0, z: d.z * 1.0 }, 0.3);
          fx.shake(p, 0.8, 0.5, true);
          fx.fade(p, 0.0, 0.1, 0.6, { red: 0.35, green: 0, blue: 0 });
          p.addEffect("slowness", 40, { amplifier: 2, showParticles: false });
        } else {
          // rakes throw you sideways: the left hand right, the right hand left
          const side = dirFromYaw(this.tw.getRotation().y + (kind === "swipe_l" ? -90 : 90));
          const k = kind === "reach" ? 0.4 : 1.0;
          p.applyKnockback({ x: (d.x * 0.8 + side.x * 0.6) * k, z: (d.z * 0.8 + side.z * 0.6) * k }, 0.32 * k);
          fx.shake(p, 0.5, 0.3, true);
        }
      }
      if (kind === "slam") {
        // the shockwave catches everyone close, at half strength
        for (const pl of this.players()) {
          if (pl.id === p.id || dist(pl.location, this.tw.location) > 4.5 || !survivalLike(pl, false)) continue;
          pl.applyDamage(Math.ceil(amount / 2), { cause: EntityDamageCause.entityAttack, damagingEntity: this.tw });
        }
      }
      dlog(`#${this.id} ${kind} dealt ${amount} -> ${ok}`);
    } catch (e) {
      warn("damage failed", errorText(e));
    }
  }

  onHit(attacker, amount) {
    const isTarget = !!attacker && attacker.id === this.targetId;
    if (this.grab && this.grab.holding && isTarget) {
      this.grab.press("hit"); // fighting back while held counts double (but it is not "staying still")
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
    this.setFloat(false);
    this.applyVisual({ ...this.brain.vis, mimic: "none", mimicAmt: 0, mimicPitch: 0 });
  }

  // ------------------------------------------------------------------ cleanup
  end(outcome, removeEntity) {
    if (this.ended) return;
    this.ended = true;
    if (this.grab) this.endGrab("abort");
    if (this.climb) this.climb.abort();
    if (this.bash) this.bash.stop();
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
        if (outcome === "killed") this.dim.spawnXp(this.tw.location, 80);
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
    return `#${this.id} ${this.setup} state=${b.state} t=${b.stateT.toFixed(1)}s grabs=${b.grabs} hits=${b.hitsLanded} posture=${this.mover.posture} target=${this.target ? this.target.name : "-"} outcome=${b.outcome || "-"}`;
  }
}
