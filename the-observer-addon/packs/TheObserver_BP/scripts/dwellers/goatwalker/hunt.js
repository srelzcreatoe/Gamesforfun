// @ts-nocheck
import * as __dw from "../../link/shared.js";
// =============================================================================
//  THE GOATWALKER  -  the hunt, his shrine, and everything that happens in a chase
//
//  A pursuit is the only time he really attacks.  During it he:
//   * runs FASTER than you can sprint (flat out when you are far off, a step slower right on top of you,
//     and for a moment after he has hit you), steps and jumps up 1-2 block ledges, side-steps round
//     trunks, rams wood, never teleports to catch up.  You do not outrun him: you break his sight of you.
//   * is held back by your escapes (light, water, staring, the Lens, flares, hitting him)
//     until you have used the same one three times
//   * uses what he saw of how you fight (flank, lead, cover, feint) - sometimes
//   * in a group: hangs back for a straggler, or culls you one by one
// =============================================================================
import { system, world, BlockVolume } from "@minecraft/server";
import {
  NS, OVERWORLD, V, now, rnd, rint, pick, chance, clamp, safe, alive, blockAt, isPassable, isGround, findStand, headroom,
  playAt, playFor, particle, particleDir, setPerm, isNight, dayIndex, mobGriefing, pace, eye, lineClear,
  visibleSpot, staringAt, inCone, lightAt, groundSpot, trunkSpot, angleOf, fromAngle, nearbyTrunks, markTrunk, placeBlood,
  placeFloorDecal, track, pushFog, popFog, music, addAnger, sinLevel, st, CANDLES, TORCHES, WOOD_RE, SOFT_RE, HARD_RE,
  SPLINTER_WOOD, RAM_RE, LEAVES_RE, isIndoors, isUnderground, survivalish, hint, heldItem, consumeHeld, cmd,
  CANDLE_BURN, domainAt, jumpscare,
} from "./core.js";
import { Walker, Enc } from "./body.js";
import {
  mind, adapted, escapeUsed, startDist, coverBias, tendency, learnedNode, noteEscapePath, noteRoom, snapAt,
} from "./mind.js";

// flares burning in the world: set by stellar.js, read here.  {x,y,z,until,dim}
export const FLARES = [];
export function flareNear(dimId, loc, r) {
  for (const f of FLARES) if (f.dim === dimId && f.until > now() && V.dist(f, loc) < r) return f;
  return null;
}
let extinguishHook = null;
export function onExtinguish(fn) { extinguishHook = fn; }

const RANGED = /(bow|crossbow|trident|snowball|egg$|wind_charge)/;

// =============================================================== the hunt
export class Hunt extends Enc {
  constructor(p, s, opts = {}) {
    super(p, s, "hunt");
    this.short = !!opts.short;
    this.len = opts.len || (this.short ? rnd(24, 36) : rnd(60, 80));
    this.forced = !!opts.instant || !!opts.day;
    this.silence = this.short ? 0 : opts.instant ? 0.5 : rnd(4, 6);
    this.target = p;
    this.hits = 0; this.taken = 0; this.lastLunge = 0; this.lost = 0;
    this.prog = { t: now(), d: 999 };
    this.crumbs = [];
    this.hold = null; this.heldFor = 0; this.repelled = 0;
    this.man = null; this.nextMan = now() + 60;
    this.freezeCd = 0; this.frozeFor = 0; this.pinFor = 0;
    this.stuckN = 0; this.stuckFor = 0; this.relocated = false;
    this.k = 0; this.lightCd = 0;
    this.style = null; this.notice = null; this.groupHits = 0;
    this.sprintSeen = 0;
    if (opts.walker && opts.walker.ok) {             // a pursuit straight out of a confrontation
      this.w = opts.walker;
      this.w.owner = p;
      this.w.calm = false;                            // hunting: the spasms come back
      this.go("chase");
      pushFog(p, s, "hunt");
      music(p, s, "goatwalker.music.scapegoat");
      this.startChase();
    }
  }
  get tier() { return "hunt"; }
  begin() { return true; }

  // -------------------------------------------------------------- where he comes from
  herdSpot() {
    const p = this.target, M = this.M, s = this.s;
    const dist = startDist(M);
    // he waits by the passage you always escape through
    const node = learnedNode(M, p.location, 70);
    if (node && chance(node.n >= 3 ? 0.85 : 0.7)) {
      const toNode = V.normH(V.sub(node, p.location));
      for (let i = 0; i < 12; i++) {
        const at = V.add(node, V.mul(V.rotY(V.mul(toNode, -1), rnd(-1.2, 1.2)), rnd(2, 5)));
        const pos = findStand(p.dimension, at.x, at.z, node.y, { up: 6, down: 6 });
        if (pos && V.dist(pos, p.location) > 6 && !visibleSpot(p, pos)) { this.fromNode = true; return pos; }
      }
    }
    // otherwise from the side away from his shrine, so running from him runs you to it
    let dir = null;
    if (s.shrine && V.distH(s.shrine, p.location) < 120) dir = V.normH(V.sub(p.location, s.shrine));
    for (let i = 0; i < 16; i++) {
      const base = dir ? angleOf(dir) + rnd(-0.7, 0.7) : rnd(0, 6.28);
      const r = rnd(dist - 2, dist + 2);
      const pos = findStand(p.dimension, p.location.x + Math.cos(base) * r, p.location.z + Math.sin(base) * r, p.location.y);
      if (pos && (i > 10 || !visibleSpot(p, pos))) return pos;
    }
    return groundSpot(p, { min: dist - 3, max: dist + 3, hidden: false });
  }
  emerge(near) {
    const pos = near || this.herdSpot();
    if (!pos) return false;
    this.w = new Walker(this.target);
    this.w.calm = false;
    if (!this.w.spawn(pos, this.target.location)) return false;
    const dim = this.target.dimension;
    this.w.setPose(4);
    playAt(dim, "goatwalker.emerge", pos, 1.3);
    particle(dim, `${NS}:emerge_spray`, pos);
    particle(dim, `${NS}:ash_burst`, V.up(pos, -1));
    this.w.prints = true;
    return true;
  }
  startChase() {
    const w = this.w, s = this.s;
    w.prints = true;
    safe(() => w.e.triggerEvent(`${NS}:sins_${sinLevel(s)}`));
    if (this.style === "cull") safe(() => w.e.addEffect("strength", 20 * 120, { amplifier: 0, showParticles: false }));
    w.hunt(this.target, this.moveKind());
    this.prog = { t: now(), d: this.pd };
  }
  get pd() { return this.w && this.w.ok && alive(this.target) ? V.dist(this.w.loc, this.target.location) : 999; }

  // -------------------------------------------------------------- per tick
  tick() {
    const p = this.target, s = this.s;
    if (!alive(this.p)) return this.end("gone");
    if (!alive(p) || p.dimension.id !== OVERWORLD) {
      if (p !== this.p && alive(this.p)) { this.retarget(this.p); return; }
      return this.end("gone");
    }
    const dim = p.dimension;
    const day = !isNight();
    if (!this.forced && day && domainAt(dim, p.location) !== "stellar") return this.end("dawn");
    if (this.age > this.len + this.silence) return this.end("time");
    this.k++;
    if (safe(() => p.isSprinting, false)) this.sprintSeen = now();
    if (this.state !== "start" && this.state !== "scream" && now() - (this.lastCrumb || 0) >= 20) this.crumb();
    if (this.state === "start") {
      if (this.inState >= this.silence) {
        const behind = V.add(p.location, V.mul(V.normH(p.getViewDirection()), -20));
        playFor(p, "goatwalker.stinger", eye(p), 1.0);
        playFor(p, "goatwalker.scream", V.up(behind, 2), 1.4);
        playFor(p, "goatwalker.scream.cry", V.up(behind, 2), 1.2);
        safe(() => p.camera.fade({ fadeColor: { red: 0.25, green: 0.0, blue: 0.0 }, fadeTime: { fadeInTime: 0.1, holdTime: 0.2, fadeOutTime: 1.4 } }));
        pushFog(p, s, "hunt");
        music(p, s, "goatwalker.music.scapegoat");
        this.go("scream");
      }
    } else if (this.state === "scream") {
      if (this.inState > 1.6) { if (this.emerge()) this.go("emerge"); else if (this.inState > 6) this.end("nospot"); }
    } else if (this.state === "emerge") {
      if (!this.w.ok) return this.go("away");
      if (this.inState > 2.8) {
        this.w.setPose(0);
        playAt(dim, "goatwalker.growl", V.up(this.w.loc, 2.4), 1.2, 0.85);
        this.startChase();
        this.go("chase");
      }
    } else if (this.state === "chase") {
      if (!this.w || !this.w.ok) return this.go("away");
      this.chase();
    } else if (this.state === "away") {                         // faded out after a strike; comes back elsewhere
      if (this.inState > (this.backIn || 6)) {
        const near = this.style === "cull" ? this.nextVictim() : null;
        if (near && near !== this.target) this.retarget(near);
        if (this.emerge()) this.go("emerge");
      }
    }
  }

  moveKind() {
    const p = this.target, M = this.M;
    if (adapted(M, "water") && (safe(() => p.isInWater, false) || (this.w && safe(() => this.w.e.isInWater, false)))) return "hunt_wet";
    if (adapted(M, "break") && headroom(p.dimension, p.location, 3) < 3) return "hunt_low";
    return "hunt";
  }

  chase() {
    const p = this.target, w = this.w, M = this.M, dim = p.dimension;
    const d = this.pd;
    const see = lineClear(dim, eye(p), V.up(w.loc, 2.2));
    const st_ = w.step();
    if (st_) this.stepEvt = st_;
    this.lost = see ? 0 : this.lost + 0.1;
    if (now() < (this.frozenUntil || 0)) return;                   // his face is in yours: he holds still for it
    const lostLimit = adapted(M, "run") ? 20 : 12, farLimit = adapted(M, "run") ? 96 : 72;
    if (this.lost > lostLimit && d > 30) return this.end("lost");
    if (d > farLimit) return this.end("far");
    if (this.repelled > 22) return this.end("held");
    if (this.k % 5 !== 0) { this.fastChecks(d, see); return; }

    // ------- multiplayer: who, and how
    this.groupLogic();
    if (this.state !== "chase") return;

    // ------- escapes that hold him back
    const why = this.repeller(d, see);
    if (why) { this.holdBack(why, d); return; }
    if (this.hold) this.release();

    // ------- low tunnels and water
    const kind = this.moveKind();
    if (this.man) this.maneuver(d);
    else {
      if (w.mode !== kind) w.hunt(p, kind);
      this.pickManeuver(d, see);
    }
    // ------- how fast: faster than you sprint (5.6 b/s); flat out from far off; a step slower on top of you
    if (!this.man && w.mode === kind && now() >= (this.frozenUntil || 0)) {
      let v = d > 16 ? 8.8 : d > 6 ? 7.2 : 6.2;
      if (now() - (this.hitAt || -999) < 30) v = 3.6;            // he has just hit you: a moment to run
      if (kind === "hunt_low") v *= 0.6;
      else if (kind === "hunt_wet") v *= 0.9;
      w.setSpeed(v);
      if (d > 10 && now() >= (this.gallopAt || 0)) { this.gallopAt = now() + 28; playAt(dim, "goatwalker.gallop", w.loc, 1.5); }
    }
    // ------- adapted to running: a burst of speed when you sprint, aimed where you are going
    if (adapted(M, "run") && now() - this.sprintSeen < 30 && d > 9) safe(() => w.e.addEffect("speed", 30, { amplifier: 0, showParticles: false }));
    // ------- adapted to light: put out what you hide behind as he comes
    if (adapted(M, "light") && d < 9 && now() > this.lightCd) this.snuffNear();
    // ------- stuck
    this.stuckCheck(d);
  }

  /** every tick: lunges, stare-snaps */
  fastChecks(d, see) {
    const p = this.target, w = this.w, M = this.M;
    if (this.hold) return;
    // lunge across open ground
    if (d > 4.5 && d < 8.5 && see && now() - this.lastLunge > 100 && w.onGround() && !(this.man && this.man.kind !== "feint")) {
      if (this.man && this.man.kind === "feint" && !this.man.paused) return;
      this.lunge();
    }
    // staring him down only makes him snap once he has learned it
    if (adapted(M, "stare") && d > 3 && d < 14) {
      const h = w.head();
      if (h && staringAt(p, h)) {
        this.frozeFor += 0.1;
        if (this.frozeFor > Math.min(1.5, snapAt(M)) && now() - this.lastLunge > 60) { w.twitch(); this.lunge(1.4); this.frozeFor = 0; }
      } else this.frozeFor = 0;
    }
  }
  lunge(power = 1.25) {
    const w = this.w, p = this.target;
    this.lastLunge = now();
    w.setPose(7);
    const dir = V.normH(V.sub(p.location, w.loc));
    safe(() => w.e.applyImpulse({ x: dir.x * power, y: 0.38, z: dir.z * power }));
    playAt(w.e.dimension, "goatwalker.growl", V.up(w.loc, 2.2), 1.0, 1.1);
    system.runTimeout(() => { if (w.ok && w.pose === 7) w.setPose(0); }, 23);
  }
  crumb() {
    const p = this.target, dim = p.dimension;
    this.lastCrumb = now();
    const sky = (l) => safe(() => dim.getSkyLightLevel(V.up(l, 1.6)), 15) > 0 ? 1 : 0;
    const c = { x: p.location.x, y: p.location.y, z: p.location.z, sky: sky(p.location), in: isIndoors(p, st(p)) ? 1 : 0 };
    const prev = this.crumbs[this.crumbs.length - 1];
    if (prev && prev.sky && !c.sky) {
      // find the exact mouth of the stair / shaft / tunnel you just went down
      const n = Math.ceil(V.dist(prev, c) / 0.5);
      let last = prev;
      for (let i = 1; i < n; i++) {
        const at = V.add(prev, V.mul(V.sub(c, prev), i / n));
        if (sky(at)) last = at; else break;
      }
      c.door = { x: last.x, y: last.y, z: last.z };
    }
    this.crumbs.push(c);
    if (this.crumbs.length > 50) this.crumbs.shift();
  }

  // -------------------------------------------------------------- escapes
  repeller(d, see) {
    const p = this.target, w = this.w, M = this.M, s = st(p), dim = p.dimension;
    // the Lens: held while you look at him through it
    if (s.lens && d < 56 && see && inCone(p, V.up(w.loc, 1.6), 0.96)) {
      const lim = adapted(M, "lens") ? 1.5 : 999;
      if (this.pinFor < lim) { this.pinFor += 0.5; return "lens"; }
      if (this.pinFor < lim + 0.6) { this.pinFor += 1; w.twitch(); this.startMan("cover", d); }
    } else this.pinFor = 0;
    // flares
    if (!adapted(M, "flare")) {
      const f = flareNear(dim.id, p.location, 7) || flareNear(dim.id, w.loc, 5);
      if (f) return "flare";
    } else {
      const f = flareNear(dim.id, w.loc, 14);
      if (f && !this.man) this.startMan("stomp", d, f);
    }
    // your light
    if (!adapted(M, "light") && this.k % 10 === 0) this.litNow = lightAt(dim, p.location, 7) >= 11;
    if (!adapted(M, "light") && this.litNow && d < 12) return "light";
    // water
    if (!adapted(M, "water") && safe(() => p.isInWater, false) && d < 24) return "water";
    // staring him down
    if (!adapted(M, "stare") && d > 3 && d < 20 && now() > this.freezeCd) {
      const h = w.head();
      if (h && staringAt(p, h)) {
        if (this.frozeFor < 2.5) { this.frozeFor += 0.5; return "stare"; }          // held for about a second
        this.freezeCd = now() + 100; this.frozeFor = 0; w.twitch();
      } else this.frozeFor = 0;
    }
    return null;
  }
  holdBack(why, d) {
    const w = this.w, p = this.target, M = this.M;
    if (!this.hold || this.hold.why !== why) {
      this.hold = { why, t: now() };
      w.halt(why === "stare" || why === "lens" ? 1 : why === "light" || why === "flare" ? 8 : 10);
      if (why !== "stare" && why !== "lens") playAt(w.e.dimension, "goatwalker.growl", V.up(w.loc, 2.2), 0.9, 0.8);
      if (why === "lens") playFor(p, "goatwalker.lens", eye(p), 0.8, 1.0);
    }
    if (why !== "stare" && why !== "lens") {
      w.face(p.location);
      // pace the edge of what keeps him out
      if (d < 7 && why !== "water") { const away = V.add(w.loc, V.mul(V.normH(V.sub(w.loc, p.location)), 3)); w.go(findStand(w.e.dimension, away.x, away.z, w.loc.y) || away, "walk"); }
    }
    if (why === "lens") safe(() => w.e.addEffect("slowness", 12, { amplifier: 10, showParticles: false }));
    this.repelled += 0.5;
    const held = (now() - this.hold.t) / 20;
    if (held > (why === "stare" ? 0.9 : 2.5)) escapeUsed(p, M, why, st(p));
    if (why === "flare" && flareNear(w.e.dimension.id, w.loc, 3.5)) {           // a flare right at his feet: he bolts
      const away = V.add(w.loc, V.mul(V.normH(V.sub(w.loc, p.location)), 8));
      w.go(findStand(w.e.dimension, away.x, away.z, w.loc.y) || away, "rush");
    }
  }
  release() {
    const w = this.w;
    this.hold = null;
    if (w.ok) { w.twitch(); w.hunt(this.target, this.moveKind()); }
    this.prog = { t: now(), d: this.pd };
  }

  // -------------------------------------------------------------- maneuvers (what he learned watching you fight)
  pickManeuver(d, see) {
    if (now() < this.nextMan || d < 5 || d > 22) return;
    this.nextMan = now() + rint(70, 120);
    const p = this.target, M = this.M;
    const held = heldItem(p);
    let kind = null;
    if (held && RANGED.test(held.typeId) && chance(0.25 + 0.6 * coverBias(M))) kind = "cover";
    else if (s_lensUp(p) && adapted(M, "lens")) kind = "cover";
    else kind = tendency(M);
    if (kind) this.startMan(kind, d);
  }
  startMan(kind, d, extra) {
    const p = this.target, w = this.w, dim = p.dimension;
    this.stepEvt = undefined;
    const face = V.normH(p.getViewDirection());
    const toHim = V.normH(V.sub(w.loc, p.location));
    let dest = null;
    if (kind === "flank") {                        // you back away while you fight: he comes from the side
      const side = V.side(face);
      const sgn = V.dot(side, toHim) >= 0 ? 1 : -1;
      const at = V.add(p.location, V.add(V.mul(side, sgn * 5), V.mul(face, 1.5)));
      dest = findStand(dim, at.x, at.z, p.location.y, { up: 3, down: 4 });
    } else if (kind === "lead") {                  // you strafe: he runs at where you are going
      const v = safe(() => p.getVelocity(), { x: 0, y: 0, z: 0 });
      const at = V.add(p.location, V.mul({ x: v.x, y: 0, z: v.z }, 14));
      dest = findStand(dim, at.x, at.z, p.location.y, { up: 3, down: 4 });
    } else if (kind === "cover") {                 // you shoot: tree to tree
      const t = trunkSpot(p, st(p), { min: Math.max(5, d - 9), max: Math.max(8, d - 3), kind: "hide", hidden: false });
      if (t && !lineClear(dim, eye(p), V.up(t.pos, 1.5))) dest = t.pos;
      if (!dest) {
        const sp = groundSpot(p, { min: Math.max(5, d - 8), max: Math.max(7, d - 2), center: p.location, hidden: true, tries: 10 });
        if (sp) dest = sp;
      }
    } else if (kind === "feint") {                 // you press in: he stops short, then lunges as you commit
      this.man = { kind, until: now() + 60, paused: false };
      w.halt(8);
      return;
    } else if (kind === "under") {                 // you take high ground: he waits beneath, out of reach
      const at = V.add(p.location, V.mul(toHim, 4));
      dest = findStand(dim, at.x, at.z, p.location.y - 2, { up: 2, down: 8 });
    } else if (kind === "stomp" && extra) {        // walks to your flare and puts it out
      dest = findStand(dim, extra.x, extra.z, extra.y, { up: 2, down: 3 }) || { x: extra.x, y: extra.y, z: extra.z };
      this.man = { kind, dest, until: now() + 140, flare: extra };
      w.go(dest, "rush");
      return;
    } else if (kind === "side") {                  // stuck on a trunk: step round it
      dest = extra;
    }
    if (!dest) return;
    this.man = { kind, dest, until: now() + (kind === "under" ? 160 : 80) };
    w.go(dest, "rush");
  }
  maneuver(d) {
    const m = this.man, w = this.w, p = this.target;
    if (m.kind === "feint") {
      if (!m.paused && (now() > m.until - 46 || d < 3.5)) { m.paused = true; w.hunt(p, this.moveKind()); if (d < 7) this.lunge(1.35); }
      if (now() > m.until) this.man = null;
      return;
    }
    const r = this.stepEvt || (w.mode === "still" ? "arrived" : undefined);
    this.stepEvt = undefined;
    if (m.kind === "stomp") {
      const f = m.flare;
      if (V.distH(w.loc, f) < 2.2 || r === "arrived") {
        w.setPose(12);
        playAt(w.e.dimension, "goatwalker.ram", V.up(w.loc, 0.5), 0.8, 1.2);
        if (extinguishHook) extinguishHook(f);
        this.man = null;
        w.hunt(p, this.moveKind());
        return;
      }
    }
    if (r === "arrived" || now() > m.until || (m.kind !== "under" && d < 4) || r === "stuck") {
      this.man = null;
      w.hunt(p, this.moveKind());
      this.prog = { t: now(), d };
    }
  }

  // -------------------------------------------------------------- getting stuck (no teleporting to catch up)
  stuckCheck(d) {
    const w = this.w, p = this.target, M = this.M;
    // stuck = his own body is not getting anywhere (not: you are simply faster than him)
    if (this.man || this.hold || d < 3) { if (d < 3) { this.stuckFor = 0; this.stuckN = 0; } this.prog = { t: now(), d, at: w.loc, pat: p.location }; return; }
    if (!this.prog.at) this.prog = { t: now(), d, at: w.loc, pat: p.location };
    if (now() - this.prog.t < 40) return;
    const moved = V.distH(w.loc, this.prog.at), pm = V.distH(p.location, this.prog.pat), closer = this.prog.d - d;
    this.prog = { t: now(), d, at: w.loc, pat: p.location };
    // getting closer, or keeping pace with you while you run: that is a chase, not being stuck
    if (closer > 0.5 || (moved > 1.4 && pm > 2.5)) { this.stuckN = 0; this.stuckFor = 0; return; }
    this.stuckFor += 2;
    this.stuckN++;
    // you dug in or built up where he cannot follow
    const low = headroom(p.dimension, p.location, 3) < 3;
    const high = p.location.y - w.loc.y > 2.6 && V.distH(p.location, w.loc) < 7;
    if ((low || high) && this.stuckFor >= 4 && !adapted(M, "break")) escapeUsed(p, M, "break", st(p));
    // 1) a ledge he can jump
    if (w.jumpAssist(p.location)) return;
    // 2) wood (or soft ground, once he has learned you dig out) in the way: ram it
    const r = ram(w, p.location, adapted(M, "break"));
    if (r === "rammed") return;
    // 3) step round whatever it is
    const side = this.sideStep(p.location);
    if (side && this.stuckN < 5) { this.startMan("side", d, side); return; }
    // 4) one quiet repositioning per hunt, only if nobody can see him and he is far
    if (this.stuckN >= 4 && !this.relocated && d > 16 && !visibleSpot(p, w.loc, 0.2)) {
      const pos = groundSpot(p, { min: 10, max: 14, hidden: true });
      if (pos) { this.relocated = true; safe(() => w.e.teleport(pos, { facingLocation: eye(p) })); w.hunt(p, this.moveKind()); }
    }
  }
  sideStep(goal) {
    const w = this.w, dim = w.e.dimension, l = w.loc;
    const to = V.normH(V.sub(goal, l));
    const side = V.side(to);
    const order = chance(0.5) ? [1, -1] : [-1, 1];
    for (const sgn of order) {
      for (const r of [3, 5]) {
        const at = V.add(V.add(l, V.mul(side, sgn * r)), V.mul(to, 1.5));
        const pos = findStand(dim, at.x, at.z, l.y, { up: 2, down: 3 });
        if (pos && lineClear(dim, V.up(l, 1.2), V.up(pos, 1.2))) return pos;
      }
    }
    return null;
  }
  snuffNear() {
    const p = this.target, dim = p.dimension, c = V.floor(p.location);
    this.lightCd = now() + 12;
    safe(() => {
      const vol = new BlockVolume({ x: c.x - 6, y: c.y - 2, z: c.z - 6 }, { x: c.x + 6, y: c.y + 4, z: c.z + 6 });
      for (const l of dim.getBlocks(vol, { includeTypes: [...TORCHES, "minecraft:lantern", "minecraft:soul_lantern", "minecraft:light_block_15"] }, false).getBlockLocationIterator()) {
        stealLight(p, this.s, l);
        return;
      }
    });
  }

  // -------------------------------------------------------------- multiplayer
  groupLogic() {
    const p = this.target, w = this.w;
    const others = __dw.players("goatwalker").filter((o) => o.id !== p.id && o.dimension.id === p.dimension.id && survivalish(o));
    const group = others.filter((o) => V.dist(o.location, p.location) < 14);
    if (!group.length) return;
    if (!this.style) {
      const M = this.M;
      const cull = clamp(0.35 + this.s.anger / 250 - M.group.stand * 0.1 + M.group.scatter * 0.08, 0.15, 0.75);
      this.style = chance(cull) ? "cull" : "cautious";
      if (this.style === "cull") safe(() => w.e.addEffect("strength", 20 * 120, { amplifier: 0, showParticles: false }));
    }
    if (this.style !== "cautious") return;
    const all = [p, ...group];
    const cx = all.reduce((a, o) => a + o.location.x, 0) / all.length, cz = all.reduce((a, o) => a + o.location.z, 0) / all.length;
    const centre = { x: cx, y: p.location.y, z: cz };
    // anyone straying from the others, that he can actually perceive from where he is?
    const stray = others.find((o) => V.dist(o.location, centre) > 20 && V.dist(o.location, w.loc) < 40
      && !others.some((q) => q.id !== o.id && V.dist(q.location, o.location) < 10));
    if (stray) {
      if (!this.notice || this.notice.id !== stray.id) this.notice = { id: stray.id, t: now() };
      else if (now() - this.notice.t > 80) { this.retarget(stray); this.M.group.scatter += 1; return; }
    } else this.notice = null;
    // hang back at the edge of the group, behind cover, instead of charging in
    if (V.dist(w.loc, centre) < 16 && !this.man) {
      const t = trunkSpot(p, st(p), { min: 16, max: 22, kind: "hide", hidden: true, from: centre });
      const dest = t ? t.pos : groundSpot(p, { min: 16, max: 22, center: centre, hidden: true, tries: 8 });
      if (dest) { this.man = { kind: "circle", dest, until: now() + 120 }; w.go(dest, "rush"); }
    }
  }
  nextVictim() {
    // one by one: whoever he can perceive that is most alone, or most hurt
    const from = this.w && this.w.ok ? this.w.loc : this.target.location;
    let best = null, bs = -1;
    for (const o of __dw.players("goatwalker")) {
      if (o.dimension.id !== OVERWORLD || !survivalish(o) || V.dist(o.location, from) > 48) continue;
      const alone = Math.min(40, ...__dw.players("goatwalker").filter((q) => q.id !== o.id).map((q) => V.dist(q.location, o.location)), 40);
      const hp = safe(() => o.getComponent("minecraft:health").currentValue, 20);
      const sc = alone + (20 - hp) * 1.5;
      if (sc > bs) { bs = sc; best = o; }
    }
    return best;
  }
  retarget(o) {
    this.target = o;
    this.M = mind(o);
    if (this.w && this.w.ok) { this.w.owner = o; this.w.hunt(o, this.moveKind()); }
    pushFog(o, st(o), "hunt");
    music(o, st(o), "goatwalker.music.scapegoat");
    this.prog = { t: now(), d: this.pd };
  }

  // -------------------------------------------------------------- events
  onHitPlayer(victim) {
    this.hits++;
    this.hitAt = now();
    // the first time he gets you in a hunt (and now and then after): his face, a hand's breadth away
    const w0 = this.w;
    if (w0 && w0.ok && (this.hits === 1 || chance(0.3))) {
      w0.halt(); w0.face(victim.location, true); w0.setPose(1);
      if (jumpscare(victim, w0.faceAt())) {
        this.frozenUntil = now() + 15;
        system.runTimeout(() => {
          if (this.done || !w0.ok) return;
          if (this.state === "chase" && this.w === w0) { w0.setPose(0); w0.hunt(this.target, this.moveKind()); }
        }, 15);
        if (chance(0.5) || this.hits >= 2) {                       // ... and then he is not there
          system.runTimeout(() => {
            if (this.done || !w0.ok || this.w !== w0 || this.state !== "chase") return;
            w0.vanish({ ash: false, blood: true, quick: true });
            this.backIn = rnd(4, 7);
            this.go("away");
          }, 15);
        }
        return;
      }
    }
    if (this.style === "cull" && this.w && this.w.ok) {           // strike, fade, pick the next one
      this.w.vanish({ ash: false, blood: true, quick: true });
      this.backIn = rnd(5, 9);
      this.go("away");
      return;
    }
    if (this.w && this.w.ok && (chance(0.5) || this.hits >= 2)) {
      this.w.vanish({ ash: false, blood: true, quick: true });
      this.backIn = rnd(5, 9);
      this.go("away");
    }
  }
  onHurt(w, by, ranged) {
    const M = this.M, p = this.target;
    this.taken++;
    if (by && by.id !== p.id) this.groupHits++;
    if (this.groupHits >= 3 && !this.counted) { this.counted = true; M.group.stand += 1; }
    if (ranged) {
      M.shots = Math.min(6, M.shots + 1);
      if (this.state === "chase" && !this.hold && chance(0.4 + 0.5 * coverBias(M))) this.startMan("cover", this.pd);
      return;
    }
    const hp = safe(() => w.e.getComponent("minecraft:health").currentValue, 80);
    if (hp < 26 && this.state === "chase") {
      w.vanish({ ash: true, blood: true });
      this.backIn = rnd(8, 12);
      this.go("away");
      return;
    }
    if (this.state !== "chase" || this.hold) return;
    if (!adapted(M, "hit")) {                                       // he recoils from your blows ...
      escapeUsed(by && by.typeId === "minecraft:player" ? by : p, M, "hit", st(p));
      const away = V.normH(V.sub(w.loc, by ? by.location : p.location));
      safe(() => w.e.applyKnockback({ x: away.x * 0.9, z: away.z * 0.9 }, 0.3));
      w.twitch();
      this.hold = { why: "hit", t: now() };
      w.halt(8);
      system.runTimeout(() => { if (this.hold && this.hold.why === "hit" && !this.done) this.release(); }, 32);
      if (chance(0.3)) { w.vanish({ ash: true, blood: true, quick: true }); this.backIn = rnd(5, 8); this.go("away"); this.hold = null; }
    } else if (now() - this.lastLunge > 30) {                       // ... until he learns to answer them
      this.lunge(1.1);
    }
  }
  end(reason) {
    if (this.done) return;
    const p = this.p, s = this.s, M = this.M;
    const tgt = alive(this.target) ? this.target : p;
    const dEnd = this.pd;
    if (this.w && this.w.ok) {
      if (reason === "offering" || reason === "horn") { this.w.halt(1); const w = this.w; system.runTimeout(() => w.vanish({ ash: true }), 30); this.w = null; }
      else if (reason === "held" || reason === "lost") {             // he lets you go ... for now
        const w = this.w; this.w = null; w.halt(1); w.face(tgt.location);
        system.runTimeout(() => { if (w.ok) { w.twitch(); system.runTimeout(() => w.vanish({ ash: true }), 18); } }, 30);
      } else this.w.vanish({ ash: true, blood: reason !== "dawn" });
    }
    for (const o of __dw.players("goatwalker")) {
      const so = st(o);
      if (so.fogs.has("hunt") && !(so.enc && so.enc !== this && so.enc.name === "hunt")) { popFog(o, so, "hunt"); music(o, so, ""); }
    }
    // what he learned from how you got away
    const escaped = ["time", "lost", "far", "held", "dawn"].includes(reason);
    if (escaped && alive(tgt)) {
      if (this.crumbs.length) noteEscapePath(M, this.crumbs);
      const outran = reason === "lost" || reason === "far" || (reason === "time" && dEnd > 24);
      if (outran && now() - this.sprintSeen < 200) { M.outruns = Math.min(6, M.outruns + 1); escapeUsed(tgt, M, "run", s); }
      if (isIndoors(tgt, st(tgt)) || isUnderground(tgt)) noteRoom(M, tgt.location, s);
      const last = this.crumbs[this.crumbs.length - 1] || tgt.location;
      s.after = { at: now() + Math.floor(rnd(25, 80) * 20), loc: { x: last.x, y: last.y, z: last.z }, hid: isIndoors(tgt, st(tgt)) };
    }
    if (s.tellLater && s.tellLater.length) {
      const msgs = s.tellLater; s.tellLater = [];
      msgs.forEach((m, i) => system.runTimeout(() => alive(p) && hint(p, m), 120 + i * 80));
    }
    if (this.short) {
      if (reason !== "offering") addAnger(s, -10);
    } else {
      if (reason !== "offering") s.anger = 28;
      s.lastHuntDay = dayIndex();
      s.huntedTonight = true;
      if (s.shrine) { s.shrine.lit = false; setRing(p, s, 0); }
    }
    s.dirty = true;
    super.finish(reason === "offering" ? 90 : this.short ? 140 : 200);
  }
  finish() { this.end("abort"); }
}
function s_lensUp(p) { return !!st(p).lens; }

// =============================================================== the shrine
function shrineDim() { return world.getDimension(OVERWORLD); }
export function buildShrine(p, s) {
  const dim = p.dimension;
  const tries = [];
  for (const t of nearbyTrunks(p, s, 30, 60)) tries.push({ x: t.x + rint(-3, 3), z: t.z + rint(-3, 3) });
  for (let i = 0; i < 14; i++) { const a = rnd(0, 6.28), r = rnd(36, 60); tries.push({ x: p.location.x + Math.cos(a) * r, z: p.location.z + Math.sin(a) * r }); }
  for (const c of tries.slice(0, 22)) {
    if (V.distH(c, p.location) < 30) continue;
    const ctr = findStand(dim, c.x, c.z, p.location.y, { up: 10, down: 14 });
    if (!ctr) continue;
    const ring = [];
    let ok = true;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const pos = findStand(dim, ctr.x + Math.cos(a) * 3, ctr.z + Math.sin(a) * 3, ctr.y, { up: 1, down: 1, height: 2 });
      if (!pos) { ok = false; break; }
      ring.push(V.floor(pos));
    }
    if (!ok) continue;
    const base = V.floor(ctr);
    const stellar = domainAt(dim, ctr) === "stellar";
    if (!setPerm(dim, base, stellar ? `${NS}:carved_void_log` : "minecraft:spruce_log",
      stellar ? { "minecraft:cardinal_direction": pick(["north", "south", "east", "west"]) } : { pillar_axis: "y" })) continue;
    const kinds = s.kills.length ? s.kills : ["minecraft:sheep", "minecraft:goat"];
    for (let k = 0; k < 3; k++) {
      const a = rnd(0, 6.28), r = rnd(1.3, 2.1);
      const at = findStand(dim, ctr.x + Math.cos(a) * r, ctr.z + Math.sin(a) * r, ctr.y, { up: 1, down: 1, height: 1 });
      if (!at) continue;
      const k0 = pick(kinds);
      const kind = k0 === "minecraft:sheep" ? 0 : k0 === "minecraft:goat" ? 1 : 2;
      setPerm(dim, at, `${NS}:remains`, { [`${NS}:kind`]: kind, [`${NS}:rot`]: rint(0, 3) });
    }
    for (const r of ring) setPerm(dim, r, "minecraft:candle", { candles: rint(0, 3), lit: false });
    placeBlood(dim, V.add(ctr, { x: 1, y: 0, z: 0 }));
    if (stellar) placeFloorDecal(dim, V.add(ctr, { x: -1, y: 0, z: 1 }), `${NS}:ritual_marking_floor`, { "minecraft:cardinal_direction": "north" });
    const near = nearbyTrunks({ location: ctr }, s, 0, 7)[0];
    if (near) markTrunk(dim, { x: near.bx ?? near.x, y: near.y0 + 1, z: near.bz ?? near.z }, 0, ctr);
    s.shrine = { x: base.x, y: base.y, z: base.z, ring, lit: false, nextBurn: 0, relit: 0 };
    s.dirty = true;
    return true;
  }
  return false;
}
function ringBlocks(s) {
  const dim = shrineDim();
  return s.shrine.ring.map((r) => ({ r, b: blockAt(dim, r) }));
}
export function litCount(s) {
  let n = 0, loaded = false;
  for (const { b } of ringBlocks(s)) {
    if (!b) continue;
    loaded = true;
    if (CANDLES.includes(b.typeId) && safe(() => b.permutation.getState("lit")) === true) n++;
  }
  return loaded ? n : (s.shrine.litMem ?? 0);
}
/** light `n` ring candles (0 = put them all out) */
export function setRing(p, s, n) {
  if (!s.shrine) return;
  const dim = shrineDim();
  let k = 0;
  for (const { r, b } of ringBlocks(s)) {
    if (!b) continue;
    const want = k < n;
    if (CANDLES.includes(b.typeId)) safe(() => b.setPermutation(b.permutation.withState("lit", want)));
    else if (b.isAir) setPerm(dim, r, "minecraft:candle", { candles: rint(0, 3), lit: want });
    if (want) particle(dim, `${NS}:stolen_flame`, V.add(r, { x: 0.5, y: 0.6, z: 0.5 }));
    k++;
  }
  s.shrine.litMem = n;
}
export function burnOne(p, s) {
  const dim = shrineDim();
  const lit = ringBlocks(s).filter(({ b }) => b && CANDLES.includes(b.typeId) && safe(() => b.permutation.getState("lit")) === true);
  if (lit.length) {
    const { r, b } = pick(lit);
    safe(() => b.setPermutation(b.permutation.withState("lit", false)));
    particle(dim, `${NS}:smoke_wisp`, V.add(r, { x: 0.5, y: 0.5, z: 0.5 }));
    playAt(dim, "goatwalker.candle_out", V.add(r, { x: 0.5, y: 0.5, z: 0.5 }), 1.0);
  } else if (s.shrine.litMem > 0) s.shrine.litMem--;
  const left = litCount(s);
  s.shrine.litMem = left;
  if (V.distH(p.location, s.shrine) > 40) {                      // you hear it go out, wherever you are
    const dir = V.normH(V.sub(s.shrine, p.location));
    playFor(p, "goatwalker.candle_out", V.add(eye(p), V.mul(dir, 18)), 0.45, 0.9);
  }
  return left;
}

// =============================================================== offerings
export function tryOffering(p, block) {
  const s = st(p);
  const dim = p.dimension;
  const above = block.above();
  if (!above || !above.isAir) return;
  const c = block.location;
  const vol = new BlockVolume({ x: c.x - 3, y: c.y - 1, z: c.z - 3 }, { x: c.x + 3, y: c.y + 1, z: c.z + 3 });
  const lit = [];
  safe(() => {
    for (const l of dim.getBlocks(vol, { includeTypes: CANDLES }, false).getBlockLocationIterator()) {
      const b = blockAt(dim, l);
      if (b && b.permutation.getState("lit") === true) lit.push(b);
    }
  });
  if (lit.length < 4) { playAt(dim, "random.fizz", V.add(c, { x: 0.5, y: 1.2, z: 0.5 }), 0.4, 1.4); return; }
  if (survivalish(p)) consumeHeld(p, "minecraft:mutton");
  const top = above.location;
  const day = dayIndex();
  if (s.offerDay !== day) s.offerDay = day;
  const gains = [45, 30, 15];
  const k = s.offers;
  if (k >= gains.length) {                                        // refused
    setPerm(dim, top, `${NS}:offering`, { [`${NS}:rotten`]: true });
    track("offer", top);
    lit.forEach((b, i) => system.runTimeout(() => {
      safe(() => b.setPermutation(b.permutation.withState("lit", false)));
      particle(dim, `${NS}:smoke_wisp`, V.add(b.location, { x: 0.5, y: 0.5, z: 0.5 }));
    }, i * 2));
    playAt(dim, "goatwalker.offer.refuse", V.add(top, { x: 0.5, y: 0.3, z: 0.5 }), 1.0);
    const a = rnd(0, 6.28);
    playFor(p, "goatwalker.scream.far", V.add(p.location, { x: Math.cos(a) * 40, y: 4, z: Math.sin(a) * 40 }), 1.0);
    addAnger(s, 10);
    return;
  }
  setPerm(dim, top, `${NS}:offering`, { [`${NS}:rotten`]: false });
  track("offer", top);
  s.offers = k + 1;
  addAnger(s, -gains[k]);
  lit.forEach((b) => particle(dim, `${NS}:stolen_flame`, V.add(b.location, { x: 0.5, y: 0.7, z: 0.5 })));
  playAt(dim, "goatwalker.offer.accept", V.add(top, { x: 0.5, y: 0.5, z: 0.5 }), 1.0);
  const a = rnd(0, 6.28);
  playFor(p, "goatwalker.offer.voice", V.add(p.location, { x: Math.cos(a) * 30, y: 3, z: Math.sin(a) * 30 }), 1.0);
  if (s.shrine && s.shrine.lit) { setRing(p, s, [8, 5, 3][k]); s.shrine.nextBurn = now() + CANDLE_BURN * 20 / pace(); }
  if (s.enc && s.enc.name === "hunt") s.enc.end("offering");
  s.dirty = true;
}

// =============================================================== ramming
function woodIndex(id) {
  for (let i = SPLINTER_WOOD.length - 1; i >= 0; i--) if (id.includes(SPLINTER_WOOD[i])) return i;
  return 1;
}
/** Ram what blocks his way to `target`: wood always (if mob griefing), soft ground once he has learned you dig. */
export function ram(w, target, soft = false) {
  if (!w.ok) return "clear";
  const dim = w.e.dimension, l = w.loc;
  const dir = V.normH(V.sub(target, l));
  const hits = [];
  for (let d = 1; d <= 2; d++) {
    for (let h = 0; h < 3; h++) {
      const b = blockAt(dim, { x: l.x + dir.x * d, y: l.y + h, z: l.z + dir.z * d });
      if (b && !isPassable(b) && !b.isLiquid && !hits.some((x) => x.location.x === b.location.x && x.location.y === b.location.y && x.location.z === b.location.z)) hits.push(b);
    }
    if (hits.length) break;
  }
  if (!hits.length) return "clear";
  const breakable = (b) => (RAM_RE.test(b.typeId) && !HARD_RE.test(b.typeId)) || (soft && SOFT_RE.test(b.typeId) && !LEAVES_RE.test(b.typeId));
  const wood = hits.filter(breakable);
  w.setPose(12);
  if (wood.length !== hits.length || !mobGriefing()) {
    playAt(dim, "goatwalker.scrape.stone", V.up(l, 2), 1.0, rnd(0.85, 1.0));
    system.runTimeout(() => { if (w.ok && w.pose === 12) w.setPose(0); }, 14);
    return "blocked";
  }
  system.runTimeout(() => {
    if (!w.ok) return;
    let woodId = "spruce";
    for (const b of wood) {
      const id = safe(() => b.typeId, "");
      if (!id) continue;
      woodId = id;
      const at = b.location;
      if (id.endsWith("_door") || id === `${NS}:void_door_block`) {        // both halves of a door
        for (const o of [-1, 1]) { const n = blockAt(dim, V.up(at, o)); if (n && n.typeId === id) safe(() => n.setType("minecraft:air")); }
      }
      safe(() => b.setType("minecraft:air"));
      particle(dim, WOOD_RE.test(id) ? `${NS}:splinter` : `${NS}:ash_burst`, V.add(at, { x: 0.5, y: 0, z: 0.5 }));
    }
    const mid = V.add(l, V.mul(dir, 1.5));
    playAt(dim, "goatwalker.ram", V.up(mid, 1.2), 1.4);
    if (WOOD_RE.test(woodId)) {
      playAt(dim, "goatwalker.splinter", V.up(mid, 1.2), 1.2);
      if (placeFloorDecal(dim, mid, `${NS}:splintered_wood`, { [`${NS}:wood`]: woodIndex(woodId) })) track("splinter", V.floor(mid));
    }
    safe(() => w.e.applyImpulse({ x: dir.x * 0.6, y: 0.1, z: dir.z * 0.6 }));
    if (w.pose === 12) w.setPose(0);
  }, 11);
  return "rammed";
}

// =============================================================== stolen light
export function snuffTorch(p, s, at) {
  const dim = p.dimension;
  const b = blockAt(dim, at);
  if (!b || !TORCHES.includes(b.typeId)) return false;
  const face = safe(() => b.permutation.getState("torch_facing_direction"), "top");
  let dir = 0;
  if (face !== "top" && face !== "unknown") {
    const sides = [{ d: 1, o: { x: 0, y: 0, z: 1 } }, { d: 2, o: { x: 0, y: 0, z: -1 } }, { d: 3, o: { x: 1, y: 0, z: 0 } }, { d: 4, o: { x: -1, y: 0, z: 0 } }];
    for (const { d, o } of sides) { if (isGround(blockAt(dim, V.add(at, o)))) { dir = d; break; } }
  }
  if (!setPerm(dim, at, `${NS}:snuffed_torch`, { [`${NS}:dir`]: dir })) return false;
  const top = V.add(at, { x: 0.5, y: dir ? 0.85 : 0.65, z: 0.5 });
  particle(dim, `${NS}:smoke_wisp`, top);
  playAt(dim, "extinguish.candle", top, 1.0, 0.8);
  // the stolen flame drifts off toward the shrine (or into the trees)
  const goal = s.shrine ? s.shrine : V.add(p.location, V.mul(fromAngle(rnd(0, 6.28)), 40));
  const dirv = V.norm(V.up(V.normH(V.sub(goal, top)), 0.15));
  particleDir(dim, `${NS}:stolen_flame`, top, "variable.flight", 2.2, dirv);
  playAt(dim, "goatwalker.flame_steal", top, 0.8);
  if (s.shrine) system.runTimeout(() => trailCandle(p, s, dirv), 50);
  return true;
}
/** Torches become snuffed torches; lanterns and flare-light simply go dark. */
export function stealLight(p, s, at) {
  const dim = p.dimension;
  const b = blockAt(dim, at);
  if (!b) return false;
  if (TORCHES.includes(b.typeId)) return snuffTorch(p, s, at);
  if (!mobGriefing() && !b.typeId.startsWith("minecraft:light_block")) return false;
  const top = V.add(at, { x: 0.5, y: 0.5, z: 0.5 });
  if (b.typeId.startsWith("minecraft:light_block")) safe(() => b.setType("minecraft:air"));
  else cmd(dim, `setblock ${at.x} ${at.y} ${at.z} air destroy`);
  particle(dim, `${NS}:smoke_wisp`, top);
  particleDir(dim, `${NS}:stolen_flame`, top, "variable.flight", 2.2, { x: 0, y: 1, z: 0 });
  playAt(dim, "goatwalker.flame_steal", top, 0.8);
  return true;
}
/** A lit candle appears on the ground further along the stolen flame's path. */
function trailCandle(p, s, dir) {
  if (!s.shrine || !alive(p)) return;
  const dim = p.dimension;
  const r = Math.min(V.distH(p.location, s.shrine) - 6, rnd(12, 22));
  if (r < 8) return;
  const at = V.add(p.location, V.mul(V.normH(dir), r));
  const stand = findStand(dim, at.x, at.z, p.location.y, { height: 1 });
  if (!stand) return;
  setPerm(dim, stand, "minecraft:candle", { candles: rint(0, 2), lit: true });
}
