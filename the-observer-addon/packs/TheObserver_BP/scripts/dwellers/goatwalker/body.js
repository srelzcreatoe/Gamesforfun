// @ts-nocheck
// =============================================================================
//  THE GOATWALKER  -  the body: one goatwalker entity and how it moves
//
//  Gaits: still / walk / stalk / crawl (walk to a waypoint marker), rush (fast to a
//  waypoint, used for flanking, cover and side-steps), hunt / hunt_wet / hunt_low
//  (chases the player tagged gw_prey with vanilla pathfinding and melee).
//  He never moonwalks: he is only turned to face you while standing still.
// =============================================================================
import { system } from "@minecraft/server";
import {
  NS, GW, MARK, TAG, PREY, V, now, rnd, rint, chance, clamp, safe, alive, blockAt, isPassable, isGround, playAt, particle, particleDir, placePrint, placePile, placeBlood, st, sinLevel, dayIndex, visibleSpot, shakeCam,
  staringAt, inCone,
} from "./core.js";
import { mind, snapAt, noteLook } from "./mind.js";
import { speedMul } from "./config.js";

export const WALKERS = new Set();
const MOVING = new Set(["walk", "stalk", "crawl", "rush", "dash", "hunt", "hunt_wet", "hunt_low", "charge", "wander"]);

export class Walker {
  constructor(owner) {
    this.owner = owner;
    this.e = undefined;
    this.m = undefined;
    this.mode = "";
    this.pose = -1;
    this.dest = undefined;
    this.prog = { t: 0, d: 0 };
    this.lastPrint = undefined;
    this.prints = false;
    this.dead = false;
    this.calm = true;              // stalking / watching: no spasms, he keeps his eyes on you.  A hunt sets it false.
    this.nextStep = 0;             // (used by scenes that move several of him)
    this.nextBreath = now() + 60;
    this.nextBell = now() + rint(80, 180);
    this.lastJump = 0;
    this.prey = undefined;
  }
  get ok() { return !this.dead && alive(this.e); }
  get loc() { return this.e.location; }
  get moving() { return MOVING.has(this.mode); }
  spawn(pos, faceTo) {
    const dim = this.owner.dimension;
    const e = safe(() => dim.spawnEntity(GW, pos));
    if (!e) return false;
    this.e = e;
    safe(() => e.addTag(TAG));
    WALKERS.add(this);
    this.setMode("still");
    this.setPose(0);
    safe(() => e.triggerEvent(`${NS}:sins_${sinLevel(st(this.owner))}`));
    if (faceTo) this.face(faceTo, true);
    st(this.owner).seenDay = dayIndex();
    return true;
  }
  setMode(m) { if (this.ok && this.mode !== m) { safe(() => this.e.triggerEvent(`${NS}:mode_${m}`)); this.mode = m; } }
  setPose(n) { if (this.ok && this.pose !== n) { safe(() => this.e.triggerEvent(`${NS}:pose_${n}`)); this.pose = n; } }
  /** Turn to face a point.  Only while standing still (never twists a walking body round). */
  face(pos, force = false) {
    if (!this.ok || (!force && this.moving)) return;
    const l = this.e.location;
    safe(() => this.e.teleport(l, { facingLocation: { x: pos.x, y: l.y + 2.2, z: pos.z } }));
  }
  /** Turn (a little each call, never snapping) to keep facing a point. Used while he stands and watches you. */
  turnToward(pos, maxStep = 12) {
    if (!this.ok || this.moving) return;
    const l = this.e.location;
    const want = Math.atan2(-(pos.x - l.x), pos.z - l.z) * 180 / Math.PI;
    const cur = safe(() => this.e.getRotation().y, want);
    const d = ((want - cur + 540) % 360) - 180;
    if (Math.abs(d) < 3) return;
    const y = cur + Math.max(-maxStep, Math.min(maxStep, d));
    safe(() => this.e.setRotation({ x: 0, y }));
  }
  head() { return this.ok ? safe(() => this.e.getHeadLocation(), V.up(this.loc, 2.5)) : undefined; }
  /** where his face is when he stands and stares (the model's eyes are higher than the game's "head location") */
  faceAt() { return this.ok ? V.up(this.loc, 2.82) : undefined; }
  onGround() { return safe(() => this.e.isOnGround, true); }
  /** Walk to a point via the waypoint marker. gait: walk | stalk | crawl | rush */
  go(pos, gait = "walk") {
    if (!this.ok) return;
    this.untag();
    if (!alive(this.m)) {
      this.m = safe(() => this.e.dimension.spawnEntity(MARK, pos));
      safe(() => this.m.addTag(TAG));
    } else safe(() => this.m.teleport(pos));
    this.dest = pos;
    this.prog = { t: now(), d: V.distH(this.loc, pos) };
    this.setMode(gait);
    this.setPose(gait === "crawl" ? 6 : gait === "stalk" ? 2 : 0);
  }
  /** Run at about this many blocks a second, for as long as the current gait lasts (a new gait resets it).
   *  A mob's ground speed goes with the square of its movement value: 43 x v^2 blocks a second. */
  setSpeed(bps) {
    if (!this.ok) return;
    const v = Math.sqrt(Math.max(0, bps * speedMul()) / 43.2);
    const c = safe(() => this.e.getComponent("minecraft:movement"));
    if (c) safe(() => c.setCurrentValue(v));
    this.bps = bps;
  }
  /** Chase a player with vanilla pathfinding + melee. */
  hunt(p, kind = "hunt") {
    if (!this.ok) return;
    if (alive(this.m)) safe(() => this.m.remove());
    this.m = undefined;
    this.dest = undefined;
    if (!this.prey || this.prey.id !== p.id) {
      this.untag();
      this.prey = p;
      safe(() => p.addTag(PREY));
    }
    this.setPose(kind === "hunt_low" ? 6 : 0);            // crouched through low tunnels
    this.setMode(kind);
  }
  untag() {
    if (this.prey) {
      const id = this.prey.id;
      // only drop the tag if no other walker is hunting the same player
      let other = false;
      for (const w of WALKERS) if (w !== this && w.prey && w.prey.id === id) other = true;
      if (!other) safe(() => this.prey.removeTag(PREY));
      this.prey = undefined;
    }
  }
  halt(pose) {
    this.dest = undefined;
    if (alive(this.m)) safe(() => this.m.remove());
    this.m = undefined;
    if (this.ok) { this.setMode("still"); if (pose !== undefined) this.setPose(pose); }
  }
  /** called every 2 ticks: returns "arrived" | "stuck" | undefined */
  step() {
    if (!this.ok) return undefined;
    const l = this.loc;
    if (this.prints) {
      if (!this.lastPrint) this.lastPrint = l;
      else if (V.distH(l, this.lastPrint) > 1.7 && this.onGround()) {
        placePrint(this.e.dimension, l, V.sub(l, this.lastPrint));
        this.lastPrint = l;
      }
    }
    if (this.dest) {
      const d = V.distH(l, this.dest);
      if (d < 2.0 && Math.abs(l.y - this.dest.y) < 2.5) { this.halt(); return "arrived"; }
      if (d < this.prog.d - 0.7) this.prog = { t: now(), d };
      else if (now() - this.prog.t > 50) { this.prog = { t: now(), d }; this.jumpAssist(this.dest); return "stuck"; }
    }
    return undefined;
  }
  /**
   * Pathfinding plans one-block steps by itself; this helps him up a two-block step or ledge
   * toward `goal` when there is head-room for his 3-block-tall body.  Returns true if he jumped.
   */
  jumpAssist(goal) {
    if (!this.ok || now() - this.lastJump < 24 || !this.onGround()) return false;
    const dim = this.e.dimension, l = this.loc;
    const dir = V.normH(V.sub(goal, l));
    for (const ahead of [1.0, 1.6]) {
      const f = V.add(l, V.mul(dir, ahead));
      const b0 = blockAt(dim, f), b1 = blockAt(dim, V.up(f, 1)), b2 = blockAt(dim, V.up(f, 2));
      if (!b0 || !b1 || !b2) return false;
      const h1 = !isPassable(b0) && !b0.isLiquid;
      const h2 = h1 && !isPassable(b1) && !b1.isLiquid;
      if (!h1) continue;
      const top = h2 ? 2 : 1;
      if (h2 && !isPassable(b2)) return false;               // a wall, not a step
      // room for him on top of the step, and above his own head for the arc
      for (let y = 0; y < 3; y++) {
        const a = blockAt(dim, V.up(f, top + y)), o = blockAt(dim, V.up(l, 3 + y));
        if (!a || !isPassable(a)) return false;
        if (y < top && (!o || !isPassable(o))) return false;
      }
      if (!isGround(b0) && !isGround(b1)) return false;
      this.lastJump = now();
      safe(() => this.e.applyImpulse({ x: dir.x * 0.22, y: top === 2 ? 0.66 : 0.46, z: dir.z * 0.22 }));
      return true;
    }
    return false;
  }
  breathe(toward) {
    if (!this.ok || now() < this.nextBreath) return;
    this.nextBreath = now() + rint(50, 80);
    const h = this.head();
    if (!h) return;
    const dir = V.norm(V.up(V.normH(V.sub(toward, h)), 0.15));
    particleDir(this.e.dimension, `${NS}:breath`, V.add(h, V.mul(dir, 0.5)), "variable.puff", 1.1, dir);
    playAt(this.e.dimension, "goatwalker.snort", h, 0.55, rnd(0.85, 1.05));
  }
  bell() {
    if (!this.ok || now() < this.nextBell) return;
    this.nextBell = now() + rint(140, 230);
    playAt(this.e.dimension, "goatwalker.bell.near", V.up(this.loc, 1.6), 0.7, rnd(0.95, 1.05));
  }
  crack() {
    if (this.ok && chance(0.5)) playAt(this.e.dimension, "goatwalker.crack", V.up(this.loc, 2), 0.7, rnd(0.9, 1.2));
  }
  /** A sudden twitch: the snap of bone, a jerk of the head.  Then back to what he was doing.
   *  Only when he is hunting - while he stalks and watches you he is utterly still. */
  twitch() {
    if (!this.ok || this.calm) return;
    const was = this.pose;
    playAt(this.e.dimension, "goatwalker.snap", V.up(this.loc, 2.4), 0.9, rnd(0.85, 1.15));
    this.setPose(8);
    const self = this;
    system.runTimeout(() => { if (self.ok && self.pose === 8) self.setPose(was === 8 ? 1 : was); }, rint(9, 14));
  }
  /** Rear up and roar.  The ground shakes for anyone close. */
  roar(pose = 10) {
    if (!this.ok) return;
    const dim = this.e.dimension, at = V.up(this.loc, 2.4);
    this.setPose(pose);
    playAt(dim, "goatwalker.roar", at, 1.6, rnd(0.9, 1.0));
    for (const p of safe(() => dim.getPlayers({ location: at, maxDistance: 28 }), [])) {
      const d = V.dist(p.location, at);
      shakeCam(p, clamp(0.35 - d / 100, 0.08, 0.35), 1.2);
      if (d < 16) safe(() => p.addEffect("darkness", 50, { amplifier: 0, showParticles: false }));
    }
  }
  vanish({ ash = true, blood = false, quick = false } = {}) {
    if (!this.ok) { this.remove(); return; }
    this.halt(5);
    this.untag();
    const e = this.e, dim = e.dimension;
    playAt(dim, "goatwalker.vanish", V.up(e.location, 1.4), 1.0, rnd(0.9, 1.05));
    particle(dim, `${NS}:ash_flake`, V.up(e.location, 1.6));
    this.dead = true;
    WALKERS.delete(this);
    system.runTimeout(() => {
      if (!alive(e)) return;
      const l = e.location;
      particle(dim, `${NS}:ash_burst`, l);
      if (ash) placePile(dim, l);
      if (blood) placeBlood(dim, l);
      safe(() => e.remove());
    }, quick ? 4 : 30);
  }
  remove() {
    this.untag();
    if (alive(this.m)) safe(() => this.m.remove());
    if (alive(this.e)) safe(() => this.e.remove());
    this.dead = true;
    WALKERS.delete(this);
  }
  isWalker(entity) { return !!this.e && this.e.id === entity.id; }
}

export function nearestWalker(loc, dimId, maxD = 64) {
  let best = null, bd = maxD;
  for (const w of WALKERS) {
    if (!w.ok || w.e.dimension.id !== dimId) continue;
    const d = V.dist(w.loc, loc);
    if (d < bd) { bd = d; best = w; }
  }
  return best ? { w: best, d: bd } : null;
}

// ----------------------------------------------------------------- encounter base
let ENC_SEQ = 0;
export class Enc {
  constructor(p, s, name) {
    this.p = p; this.s = s; this.name = name;
    this.M = mind(p);
    this.t0 = now(); this.w = null; this.done = false; this.seen = 0; this.state = "start"; this.st0 = now();
    this.stareRun = 0; this.staredDown = false; this.lookTick = 0;
    s.encId = ++ENC_SEQ;
    this.id = s.encId;
  }
  get age() { return (now() - this.t0) / 20; }
  get inState() { return (now() - this.st0) / 20; }
  get snap() { return snapAt(this.M); }
  /** encounter tier, used for pacing: sign | watch | intrude | confront | hunt | after */
  get tier() { return "watch"; }
  go(state) { this.state = state; this.st0 = now(); }
  /** @returns {boolean} */
  begin() { return true; }
  tick() { }
  finish(quietSec = 30) {
    if (this.done) return;
    this.done = true;
    if (this.w && !this.w.dead) this.w.remove();
    this.s.quietUntil = Math.max(this.s.quietUntil, now() + quietSec * 20);
  }
  /** shared "is he being looked at" bookkeeping; returns seconds of continuous sight */
  watchCheck() {
    if (!this.w || !this.w.ok) return 0;
    const vis = visibleSpot(this.p, this.w.loc);
    this.seen = vis ? this.seen + 0.1 : 0;
    const h = this.w.head();
    if (h && staringAt(this.p, h)) {
      this.s.stare += 0.1;
      this.stareRun += 0.1;
      if (this.stareRun > 2.2 && !this.staredDown) { this.staredDown = true; this.M.stares = Math.min(8, this.M.stares + 1); }
    } else { this.s.stare = Math.max(0, this.s.stare - 0.2); this.stareRun = 0; }
    if (++this.lookTick % 10 === 0) noteLook(this.M, !inCone(this.p, V.up(this.w.loc, 1.4), 0.3));
    return this.seen;
  }
  get pd() { return this.w && this.w.ok ? V.dist(this.w.loc, this.p.location) : 999; }
}
