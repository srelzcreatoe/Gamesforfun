// Navigation through real space.  Tailwail walks with the engine's own pathfinder
// (minecraft:navigation.walk + melee_box_attack) toward an invisible, invulnerable lure
// entity that this module places.  It never teleports Tailwail.
import { CHASE, LURE_ID, POSTURE, POSTURE_MIN_HOLD } from "../config.js";
import { POSTURE as POSTURE_ID } from "../core/ids.js";
import { dirFromYaw, hdist, wrapDeg, yawTo } from "../util/vec.js";
import { dlog } from "./log.js";
import { findGround, headroom } from "./terrain.js";

export class Mover {
  constructor(tw, slot) {
    this.tw = tw;
    this.slot = slot;
    this.lure = null;
    this.seeking = false;
    this.goal = null;
    this.speed = -1;
    this.progress = { t: 0, bestDist: Infinity, since: 0 };
    this.posture = "tall";
    this.postureAt = -99;
    this.headHere = 8;
    this.subgoalUntil = -1;
    this.subgoal = null;
  }

  ensureLure() {
    if (this.lure && this.lure.isValid) return this.lure;
    const l = this.tw.location;
    this.lure = this.tw.dimension.spawnEntity(LURE_ID, { x: l.x, y: l.y, z: l.z });
    this.lure.triggerEvent("tailwail:slot_" + this.slot);
    this.lure.setDynamicProperty("tailwail:owner", this.tw.id);
    return this.lure;
  }

  setSpeed(v) {
    if (Math.abs(v - this.speed) < 0.001) return;
    this.speed = v;
    try {
      this.tw.getComponent("minecraft:movement").setCurrentValue(v);
    } catch (e) {
      dlog("movement component", e);
    }
  }

  moveTo(goal, speed, t) {
    if (!goal) return this.hold();
    const target = this.subgoal && t < this.subgoalUntil ? this.subgoal : goal;
    const lure = this.ensureLure();
    if (!this.goal || hdist(this.goal, goal) > 0.4 || Math.abs(this.goal.y - goal.y) > 0.6) {
      this.goal = { x: goal.x, y: goal.y, z: goal.z };
      this.progress = { t, bestDist: hdist(this.tw.location, target), since: t };
    }
    const ll = lure.location;
    if (hdist(ll, target) > 0.4 || Math.abs(ll.y - target.y) > 0.6) {
      lure.teleport({ x: target.x, y: target.y, z: target.z });
    }
    this.setSpeed(speed);
    if (!this.seeking) {
      this.tw.triggerEvent("tailwail:seek_" + this.slot);
      this.seeking = true;
    }
  }

  hold() {
    if (this.seeking) {
      this.tw.triggerEvent("tailwail:hold");
      this.seeking = false;
    }
    this.goal = null;
  }

  /** Body turns gradually toward a point while holding (never snaps). */
  faceToward(pos, maxStep = 18) {
    if (this.seeking || !pos) return;
    const rot = this.tw.getRotation();
    const want = yawTo(this.tw.location, pos);
    const delta = wrapDeg(want - rot.y);
    const step = Math.max(-maxStep, Math.min(maxStep, delta));
    if (Math.abs(delta) > 2) this.tw.setRotation({ x: 0, y: rot.y + step });
  }

  atGoal() {
    if (!this.goal) return true;
    const l = this.tw.location;
    return hdist(l, this.goal) < 1.6 && Math.abs(l.y - this.goal.y) < 2.5;
  }

  /** No meaningful progress toward a distant goal for CHASE.stuckWindow seconds. */
  stuck(t) {
    if (!this.seeking || !this.goal) return false;
    const d = hdist(this.tw.location, this.goal);
    if (d < 2.5) return false;
    if (d < this.progress.bestDist - CHASE.stuckProgress) {
      this.progress.bestDist = d;
      this.progress.since = t;
      return false;
    }
    if (t - this.progress.since >= CHASE.stuckWindow) {
      this.progress.since = t; // report once per window
      return true;
    }
    return false;
  }

  /** Bounded recovery through valid space (never through blocks). */
  recover(attempt, t, rng) {
    if (attempt === 1) {
      this.forceSmaller = true;
      return "smaller-posture";
    }
    // sidestep to real footing beside the blockage, then resume
    const l = this.tw.location;
    const yaw = this.goal ? yawTo(l, this.goal) : this.tw.getRotation().y;
    for (const off of [90, -90, 135, -135]) {
      const d = dirFromYaw(yaw + off * (rng.chance(0.5) ? 1 : -1));
      const g = findGround(this.tw.dimension, l.x + d.x * 3, l.z + d.z * 3, l.y, 2, 3, 2);
      if (g) {
        this.subgoal = g;
        this.subgoalUntil = t + 2;
        return "sidestep";
      }
    }
    return "none";
  }

  /**
   * Chooses the largest posture the surroundings allow, capped by the brain.
   * Shrinking is immediate; growing requires measured clearance where it stands.
   */
  updatePosture(t, cap, want) {
    const dim = this.tw.dimension;
    const l = this.tw.location;
    this.headHere = headroom(dim, l);
    let ahead = this.headHere;
    if (this.goal && this.seeking) {
      const yaw = yawTo(l, this.goal);
      for (const k of [1.2, 2.4]) {
        const d = dirFromYaw(yaw);
        const p = { x: l.x + d.x * k, y: l.y, z: l.z + d.z * k };
        const h = Math.max(headroom(dim, p), headroom(dim, { ...p, y: p.y + 1 }), headroom(dim, { ...p, y: p.y - 1 }));
        // a solid column (h < 2) is not a passage: the path goes around it, so it says nothing about ceilings
        if (h >= 2) ahead = Math.min(ahead, h);
      }
    }
    const room = Math.min(this.headHere, ahead);
    const order = ["crawl", "hunch", "tall"];
    let best = "crawl";
    for (const p of order) if (room >= POSTURE[p].clearance) best = p;
    if (cap && order.indexOf(best) > order.indexOf(cap)) best = cap;
    if (want && order.indexOf(want) < order.indexOf(best)) best = want; // brain may ask to stay folded
    if (want === "tall" && best !== "tall" && this.headHere >= POSTURE.tall.clearance && (!cap || cap === "tall")) best = "tall";
    if (this.forceSmaller && best !== "crawl") {
      best = order[Math.max(0, order.indexOf(this.posture) - 1)];
      this.forceSmaller = false;
    }
    const grow = order.indexOf(best) > order.indexOf(this.posture);
    if (best === this.posture) return this.posture;
    if (grow && (t - this.postureAt < POSTURE_MIN_HOLD || this.headHere < POSTURE[best].clearance)) return this.posture;
    this.setPosture(best, t);
    return best;
  }

  setPosture(p, t) {
    this.posture = p;
    this.postureAt = t;
    try {
      this.tw.triggerEvent("tailwail:posture_" + p);
      this.tw.setProperty("tailwail:posture", POSTURE_ID[p]);
    } catch (e) {
      dlog("posture", e);
    }
  }

  dispose() {
    try {
      if (this.lure && this.lure.isValid) this.lure.remove();
    } catch {
      /* already gone */
    }
    this.lure = null;
  }
}
