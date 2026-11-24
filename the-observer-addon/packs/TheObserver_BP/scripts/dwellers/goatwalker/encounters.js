// @ts-nocheck
// =============================================================================
//  THE GOATWALKER  -  encounters
//
//  Tiers (pacing):  sign      distant sounds, visual clues, strange changes
//                   watch     he appears far away and watches
//                   intrude   he is quietly closer, behind cover, at your door
//                   confront  he reveals himself, roars, threatens
//                   hunt      (hunt.js) an actual chase
//                   after     traces, and sometimes him, after you got away
//  Most of these never end in an attack.
// =============================================================================
import { system, BlockVolume } from "@minecraft/server";
import {
  NS, V, now, rnd, rint, pick, chance, clamp, safe, alive, blockAt, isGround, findStand, headroom, playAt, playFor,
  particle, particleDir, setPerm, isNight, dayIndex, peaceful, eye, lineClear, visibleSpot, exposedSpot, groundSpot, trunkSpot, perchSpot, caveSpot, hopToward, nearbyTrunks, markTrunk, placePrint, placeBlood, hangOn, addAnger, isIndoors, findEntrance, viewYaw, fromAngle, angleOf, pushFog, popFog, TORCHES, shakeCam, survivalish,
  lightAt, CARDINAL, dirIndex, isEclipse, flash, standNear, wrathOf, music, staringAt, inCone, hint, jumpscare, } from "./core.js";
import { cfg } from "./config.js";
import { Walker, Enc } from "./body.js";
import { creepStep, routeAhead, noteRoom, homeOf } from "./mind.js";
import { Hunt, snuffTorch } from "./hunt.js";

/** Start a short pursuit straight out of a confrontation, handing over the body. */
function escalate(enc) {
  const s = enc.s;
  if (peaceful() || !survivalish(enc.p) || !enc.w || !enc.w.ok) return false;
  const w = enc.w;
  enc.w = null;                     // the hunt owns the body now
  enc.finish(0);
  const h = new Hunt(enc.p, s, { short: true, walker: w, day: !isNight() });
  s.enc = h;
  s.last = "Hunt";
  return true;
}

// =================================================================== HIS EYES ON YOU
// While he stalks or watches you and is standing still, he turns - slowly, steadily - to keep facing you,
// wherever you go.  (When he walks, his body faces where he is going and only his head follows you; that
// part is done by the "gaze" animation on your screen.)  Not while he emerges, vanishes, rams or gnaws.
const NO_TURN = new Set([4, 5, 12, 13]);
export function faceYou(enc) {
  if (!enc || enc.done || enc.tier === "hunt" || enc.noFace) return;
  const w = enc.w;
  if (!w || !w.ok || w.dead || w.moving || NO_TURN.has(w.pose) || !alive(enc.p)) return;
  if (enc.pd > 96) return;
  w.turnToward(enc.p.location, 12);
}

// =================================================================== THE REFLEX: walk up to him
// What he does when YOU close in on him depends on his wrath.
//   * unaware / watching: he is gone before you reach him - and then, more often than not, he is BEHIND you.
//     He was never running away.  He was moving.
//   * stalking: sometimes gone, sometimes behind you, and about one time in six he comes at you instead.
//   * wrathful / hunting: he does not go anywhere.  More often than not he comes.
// Sneaking gets you closer (a little less each time: he learns), sprinting at him sets him off sooner, and
// he remembers how often you rush him.  He only reacts to you coming at HIM; when he is the one who came
// close (a creep, a breath at your back), the encounter plays out its own scene.
const REFLEX_R = { watch: 12, intrude: 9, confront: 7.5, after: 11 };
const COMES = [0.03, 0.06, 0.2, 0.5, 0.68];           // chance he attacks instead, by wrath
export function approachReflex(enc) {
  if (!enc || enc.done || enc.tier === "hunt" || enc.tier === "attack" || enc.tier === "sign" || enc.noReflex) return false;
  const w = enc.w, p = enc.p;
  if (!w || !w.ok || w.dead || !alive(p) || enc.state === "gone") return false;
  const d = enc.pd;
  const sneak = safe(() => p.isSneaking, false) === true, sprint = safe(() => p.isSprinting, false) === true;
  let R = REFLEX_R[enc.tier] ?? 9;
  if (sneak) R *= Math.min(1, 0.6 + 0.07 * (enc.M.sneaks || 0));      // sneaking works - until he learns it
  if (sprint) R += 3;
  if (d > R + 5) { enc.rushT = 0; return false; }
  // how fast you are coming at him (blocks a second, along the ground)
  const v = safe(() => p.getVelocity(), null) || { x: 0, y: 0, z: 0 };
  const to = V.normH(V.sub(w.loc, p.location));
  const toward = (v.x * to.x + v.z * to.z) * 20;
  if (toward > 5.0) enc.rushT = (enc.rushT || 0) + 0.1;     // faster than a walk: a charge
  if (d > R) return false;
  if (toward < 0.7) return false;                        // he came to you (a creep, a breath at your back): his scene
  enc.noReflex = true;
  const M = enc.M, s = enc.s;
  const rushed = sprint || (enc.rushT || 0) > 0.3;
  if (rushed) M.charges = Math.min(12, (M.charges || 0) + 1);
  if (sneak) M.sneaks = Math.min(6, (M.sneaks || 0) + 1);
  const wr = wrathOf(s);
  let pa = COMES[wr] + (isNight() ? 0.03 : -0.02) + (isEclipse() ? 0.1 : 0)
    + clamp((M.charges || 0) - 3, 0, 4) * 0.025 + (enc.tier === "confront" ? 0.06 : 0);
  if (sneak) pa *= 0.6;                                  // he did not hear you coming
  pa = clamp(pa, 0.02, 0.8);
  if (chance(pa) && strike(enc)) return true;
  // gone - but not away
  w.vanish({ ash: true, quick: true });
  addAnger(s, rushed ? 4 : 2);
  enc.finish(rushed ? 40 : 30);
  const roll = Math.random();
  const behindP = wr >= 2 ? 0.7 : 0.45;
  if (roll < behindP) {                                  // ... he is behind you now
    system.runTimeout(() => {
      if (!alive(p) || (s.enc && !s.enc.done)) return;
      const nx = new Behind(p, s, { r: wr >= 2 ? rnd(4.5, 6.5) : rnd(6, 9) });
      if (safe(() => nx.begin(), false)) { s.enc = nx; s.last = "Behind"; s.lastTier = "intrude"; }
      else if (nx.w) nx.w.remove();
    }, rint(30, 70));
  } else if (roll < behindP + 0.2 && !peaceful()) {      // ... or standing further off, still looking at you
    system.runTimeout(() => {
      if (!alive(p) || (s.enc && !s.enc.done)) return;
      const nx = new Watch(p, s, false, { limit: rnd(12, 20) });
      if (safe(() => nx.begin(), false)) { s.enc = nx; s.last = "Watch"; s.lastTier = "watch"; }
      else if (nx.w) nx.w.remove();
    }, rint(50, 110));
  } else if (isNight()) {
    system.runTimeout(() => { if (alive(p)) playFor(p, "goatwalker.laugh.far", V.add(eye(p), V.mul(fromAngle(rnd(0, 6.28)), 20)), 1.0); }, rint(40, 80));
  }
  return true;
}
/** He does not vanish: a jerk, a growl, he lunges - and the chase is on. */
function strike(enc) {
  const w = enc.w, p = enc.p;
  if (peaceful() || !survivalish(p)) return false;
  w.calm = false;
  w.halt();
  w.face(p.location, true);
  w.twitch();
  playAt(w.e.dimension, "goatwalker.growl", V.up(w.loc, 2.2), 1.4, 0.85);
  const dir = V.normH(V.sub(p.location, w.loc));
  safe(() => w.e.applyImpulse({ x: dir.x * 1.1, y: 0.3, z: dir.z * 1.1 }));
  w.setPose(7);
  shakeCam(p, 0.2, 0.5);
  addAnger(enc.s, 4);
  return escalate(enc);
}

// =================================================================== HE DOES NOT LEAVE
// Every scene used to end with him walking off, hiding, or vanishing.  Now his wrath is asked first:
//   unaware / watching  he leaves, as before
//   stalking            about one time in six he comes at you instead
//   wrathful            half the time
//   hunting             mostly
// Close to you he lunges and the chase is on.  Further off he screams and charges (which may be a bluff: he
// stops a yard short, in your face).  k scales the chance for scenes where it fits more, or less.
const STAYS = [0, 0, 0.16, 0.5, 0.72];
function angry(enc, k = 1) {
  const w = enc.w, p = enc.p, s = enc.s;
  if (!w || !w.ok || w.dead || !alive(p) || enc.done) return false;
  if (!chance(STAYS[wrathOf(s)] * k) || !survivalish(p)) return false;
  if (enc.pd < 13 || chance(0.4)) return strike(enc);
  enc.w = null;                                           // the charge owns the body now
  enc.finish(0);
  const ch = new Charge(p, s, { walker: w });
  if (safe(() => ch.begin(), false)) { s.enc = ch; s.last = "Charge"; s.lastTier = "attack"; return true; }
  w.remove();
  return true;
}

// =================================================================== SIGNS (no body)
export class SignBell extends Enc {
  constructor(p, s) { super(p, s, "bell"); this.n = rint(2, 3); }
  get tier() { return "sign"; }
  begin() {
    const a = rnd(0, Math.PI * 2);
    this.at = V.add(this.p.location, { x: Math.cos(a) * 36, y: 4, z: Math.sin(a) * 36 });
    return true;
  }
  tick() {
    if (this.inState >= (this.n === 3 ? 0 : 2.6)) {
      playFor(this.p, "goatwalker.bell.far", this.at, 1.0, rnd(0.95, 1.03));
      this.n--; this.go("ring");
      if (this.n <= 0) this.finish(20);
    }
  }
}
export class SignHooves extends Enc {
  constructor(p, s) { super(p, s, "hooves"); this.k = 0; }
  get tier() { return "sign"; }
  begin() {
    this.dir = V.mul(V.normH(this.p.getViewDirection()), -1);
    this.r = 14;
    return !isIndoors(this.p, this.s);
  }
  tick() {
    if (this.inState < 0.55) return;
    this.go("step");
    const at = V.add(this.p.location, V.mul(this.dir, this.r));
    const toSound = V.normH(V.sub(at, this.p.location));
    if (V.dot(V.normH(this.p.getViewDirection()), toSound) > 0.35) {           // you turned: silence
      if (this.k > 1 && chance(0.6)) playFor(this.p, "goatwalker.crack", V.up(at, 1.5), 0.6);
      this.finish(25);
      return;
    }
    playFor(this.p, "goatwalker.hoof", at, 0.9, rnd(0.9, 1.05));
    this.r -= 0.9; this.k++;
    if (this.k >= rint(7, 9) || this.r < 6) {
      playFor(this.p, "goatwalker.breath", V.up(at, 2), 0.7);
      this.finish(25);
    }
  }
}
export class SignGouge extends Enc {
  constructor(p, s) { super(p, s, "gouge"); }
  get tier() { return "sign"; }
  begin() {
    const dim = this.p.dimension;
    for (const t of nearbyTrunks(this.p, this.s, 9, 22).slice(0, 12)) {
      const at = { x: t.bx ?? t.x, y: t.y0 + rint(1, 2), z: t.bz ?? t.z };
      if (visibleSpot(this.p, at, 0.4)) continue;
      if (markTrunk(dim, at, 0, this.p.location)) {
        playAt(dim, "goatwalker.gouge", V.add(at, { x: 0.5, y: 0.5, z: 0.5 }), 1.0, rnd(0.85, 1.0));
        system.runTimeout(() => playAt(dim, "goatwalker.hoof", V.add(at, { x: 1.5, y: -1, z: 0.5 }), 0.6), 30);
        return true;
      }
    }
    return false;
  }
  tick() { this.finish(30); }
}
export class SignScream extends Enc {   // "Someone screams" -- far off, never close
  constructor(p, s) { super(p, s, "scream"); }
  get tier() { return "sign"; }
  begin() {
    const a = rnd(0, 6.28);
    const at = V.add(this.p.location, { x: Math.cos(a) * 48, y: 4, z: Math.sin(a) * 48 });
    playFor(this.p, "goatwalker.scream.far", at, 1.0, rnd(0.95, 1.05));
    playFor(this.p, "goatwalker.scream.cry_far", at, 1.0);
    return true;
  }
  tick() { this.finish(40); }
}
/** Three slow knocks on wood somewhere in the trees.  Then nothing. */
export class SignKnock extends Enc {
  constructor(p, s) { super(p, s, "knock"); }
  get tier() { return "sign"; }
  begin() {
    const t = nearbyTrunks(this.p, this.s, 18, 32)[0];
    const a = rnd(0, 6.28);
    this.at = t ? { x: t.x + 0.5, y: t.y0 + 1.5, z: t.z + 0.5 } : V.add(this.p.location, { x: Math.cos(a) * 26, y: 1.5, z: Math.sin(a) * 26 });
    return true;
  }
  tick() {
    if (this.state === "start" && this.inState > 0.5) { playFor(this.p, "goatwalker.knock", this.at, 1.0, rnd(0.85, 0.95)); this.go("wait"); }
    if (this.state === "wait" && this.inState > 9) {
      if (chance(0.4)) playFor(this.p, "goatwalker.knock", V.add(this.at, { x: rnd(-6, 6), y: 0, z: rnd(-6, 6) }), 0.8, 0.8);
      this.finish(30);
    }
  }
}

// -- stolen light: torches near you go out one by one; the flames fly off toward his shrine
export class Snuff extends Enc {
  constructor(p, s) { super(p, s, "snuff"); this.list = []; }
  get tier() { return "sign"; }
  begin() {
    const dim = this.p.dimension, c = V.floor(this.p.location);
    const vol = new BlockVolume({ x: c.x - 13, y: c.y - 5, z: c.z - 13 }, { x: c.x + 13, y: c.y + 6, z: c.z + 13 });
    const found = safe(() => {
      const out = [];
      for (const l of dim.getBlocks(vol, { includeTypes: TORCHES }, false).getBlockLocationIterator()) out.push({ x: l.x, y: l.y, z: l.z });
      return out;
    }, []);
    if (!found.length) return false;
    found.sort((a, b) => V.dist(b, this.p.location) - V.dist(a, this.p.location));   // farthest first
    this.list = found.slice(0, rint(2, 5));
    return true;
  }
  tick() {
    if (this.inState < (this.first ? rnd(2.4, 4) : 0.5)) return;
    this.first = true;
    this.go("next");
    const t = this.list.shift();
    if (!t) { addAnger(this.s, 2); return this.finish(30); }
    snuffTorch(this.p, this.s, t);
  }
}

// -- the flock turns: every goat and sheep near you faces you at once and bleats in his voice
export class Flock extends Enc {
  constructor(p, s) { super(p, s, "flock"); }
  get tier() { return "sign"; }
  begin() {
    const dim = this.p.dimension;
    this.flock = safe(() => dim.getEntities({ location: this.p.location, maxDistance: 30 })
      .filter((e) => e.typeId === "minecraft:sheep" || e.typeId === "minecraft:goat"), []);
    if (!this.flock.length) return false;
    this.flock.forEach((e) => safe(() => e.addEffect("slowness", 120, { amplifier: 8, showParticles: false })));
    return true;
  }
  tick() {
    const p = this.p;
    for (const e of this.flock) {
      if (!alive(e)) continue;
      safe(() => e.teleport(e.location, { facingLocation: eye(p) }));
    }
    if (!this.bleated && this.inState > 1.0) {
      this.bleated = true;
      this.flock.forEach((e, i) => system.runTimeout(() => {
        if (alive(e)) playAt(e.dimension, "goatwalker.bleat", V.up(e.location, 1), 1.0, rnd(0.95, 1.05));
      }, i * 3 + rint(0, 3)));
    }
    if (this.inState > 4.5) {
      addAnger(this.s, 2);
      const a = rnd(0, 6.28);
      playFor(p, "goatwalker.bell.far", V.add(p.location, { x: Math.cos(a) * 34, y: 3, z: Math.sin(a) * 34 }), 0.9);
      this.finish(40);
    }
  }
}

// -- an ash trail: hoofprints walking out of the trees toward where you stand
export class AshTrail extends Enc {
  constructor(p, s) { super(p, s, "ash"); }
  get tier() { return "sign"; }
  begin() {
    const dim = this.p.dimension;
    const back = V.mul(V.normH(this.p.getViewDirection()), -1);
    const start = V.add(this.p.location, V.mul(V.rotY(back, rnd(-0.6, 0.6)), 24));
    const dir = V.normH(V.sub(this.p.location, start));
    let placed = 0;
    for (let d = 0; d < 20; d += 1.7) {
      const side = V.mul(V.side(dir), (Math.floor(d / 1.7) % 2 ? 0.35 : -0.35));
      const at = V.add(V.add(start, V.mul(dir, d)), side);
      const stand = findStand(dim, at.x, at.z, this.p.location.y, { height: 1 });
      if (stand && !visibleSpot(this.p, stand, 0.3) && placePrint(dim, stand, dir)) placed++;
    }
    return placed >= 4;
  }
  tick() { this.finish(30); }
}

/** Strange changes: something has been hung on a trunk, a ring of mooncaps has grown, a mark on your wall. */
export class EnvShift extends Enc {
  constructor(p, s) { super(p, s, "shift"); }
  get tier() { return "sign"; }
  begin() {
    const p = this.p, s = this.s, dim = p.dimension;
    const opts = [];
    if (s.forest.trunks.length) opts.push("trophy");
    if (s.domain === "stellar") opts.push("ring");
    if (isIndoors(p, s) || homeOf(p, this.M)) opts.push("mark");
    for (const o of opts.sort(() => Math.random() - 0.5)) {
      if (o === "trophy") {
        for (const t of nearbyTrunks(p, s, 7, 18).slice(0, 8)) {
          const at = { x: t.bx ?? t.x, y: t.y0 + rint(1, 2), z: t.bz ?? t.z };
          if (visibleSpot(p, at, 0.2)) continue;
          // hang it on the side of the trunk that faces you
          const face = CARDINAL[dirIndex(V.sub(p.location, V.add(at, { x: 0.5, y: 0, z: 0.5 })))];
          const wall = blockAt(dim, at);
          if (!wall || !/log/.test(wall.typeId)) continue;
          if (hangOn(dim, at, face, chance(0.65) ? `${NS}:trophy_head` : `${NS}:tattered_cloth`)) { this.what = o; return true; }
        }
      } else if (o === "ring") {
        let n = 0;
        const yaw = viewYaw(p);
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          if (Math.abs(Math.atan2(Math.sin(a - yaw), Math.cos(a - yaw))) < 1.0) continue;          // only behind and beside you
          const at = V.add(p.location, { x: Math.cos(a) * 3.2, y: 0, z: Math.sin(a) * 3.2 });
          const stand = findStand(dim, at.x, at.z, p.location.y, { up: 1, down: 2, height: 1 });
          if (!stand) continue;
          const below = blockAt(dim, V.up(stand, -1));
          if (!below || !/(stellar_soil|stellar_dirt|ashen_podzol|grass_block|dirt|podzol)/.test(below.typeId)) continue;
          if (setPerm(dim, stand, `${NS}:mooncap`, {})) n++;
        }
        if (n >= 3) { system.runTimeout(() => playFor(p, "goatwalker.breath", V.up(p.location, 2.4), 0.5), 40); this.what = o; return true; }
      } else if (o === "mark") {
        const ent = findEntrance(p);
        const base = ent ? ent.at : p.location;
        for (let i = 0; i < 10; i++) {
          const a = rnd(0, 6.28);
          const h = eye(p);
          const dir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
          const hit = safe(() => dim.getBlockFromRay(V.up(base, 1.2), dir, { maxDistance: 6, includePassableBlocks: false }));
          if (!hit || !isGround(hit.block)) continue;
          const f = String(hit.face).toLowerCase();
          if (!["north", "south", "east", "west"].includes(f)) continue;
          const spot = V.add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 });
          if (visibleSpot(p, V.up(spot, -1), 0.3) && lineClear(dim, h, spot)) continue;
          if (hangOn(dim, hit.block.location, f, `${NS}:ritual_marking`)) { this.what = o; return true; }
        }
      }
    }
    return false;
  }
  tick() { this.s.shifts++; this.s.dirty = true; this.finish(30); }
}

// =================================================================== WATCHING
/** The gnawer: seen at distance, stripping bark when he thinks no one is watching. */
export class Gnaw extends Enc {
  constructor(p, s) { super(p, s, "gnaw"); }
  begin() {
    const sp = trunkSpot(this.p, this.s, { min: 18, max: 34, kind: "gnaw", hidden: true, exposedHead: true })
      || trunkSpot(this.p, this.s, { min: 16, max: 26, kind: "gnaw", hidden: true });
    if (!sp) return false;
    this.w = new Walker(this.p);
    if (!this.w.spawn(sp.pos, sp.face)) return false;
    this.trunk = sp.trunk;
    this.w.setPose(13);
    this.nextChew = now();
    return true;
  }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(20);
    const seen = this.watchCheck();
    if (this.state === "start") {
      if (now() >= this.nextChew) {
        this.nextChew = now() + 34;
        playAt(w.e.dimension, "goatwalker.gnaw", V.up(w.loc, 2.2), 1.0, rnd(0.9, 1.05));
      }
      if (this.inState > 5 && !this.marked) {
        this.marked = true;
        markTrunk(w.e.dimension, { x: this.trunk.bx ?? this.trunk.x, y: this.trunk.y0 + 2, z: this.trunk.bz ?? this.trunk.z }, 2, w.loc);
      }
      if (seen > Math.min(2.5, this.snap) || this.pd < 15) {
        w.twitch(); w.setPose(1); w.face(this.p.location); addAnger(this.s, 3);
        this.go("noticed");
      } else if (this.age > 28) { this.go("leave"); }
    } else if (this.state === "noticed") {
      w.breathe(this.p.location);
      if (this.inState > 2.6 || this.pd < 9) { if (angry(this, 0.9)) return; this.go("leave"); }
    } else if (this.state === "leave") {
      if (!this.leaving) {
        this.leaving = true;
        const away = groundSpot(this.p, { min: 34, max: 44, hidden: false, center: V.add(w.loc, V.mul(V.normH(V.sub(w.loc, this.p.location)), 10)) });
        if (away) w.go(away, "walk"); else { w.vanish(); return this.finish(40); }
      }
      const r = w.step();
      if (this.pd < 9) { w.vanish(); return this.finish(40); }
      if (r === "arrived" || r === "stuck" || this.inState > 12 || (this.inState > 3 && !visibleSpot(this.p, w.loc))) {
        if (visibleSpot(this.p, w.loc)) w.vanish(); else w.remove();
        this.finish(40);
      }
    }
  }
}

/**
 * Silent watch: standing still among the trees, up on something above you, or out on a path you
 * always take.  Look away for long and he is closer each time you look back.
 */
export class Watch extends Enc {
  constructor(p, s, perch = false, opts = {}) { super(p, s, perch ? "perch" : "watch"); this.perch = perch; this.opts = opts; this.creeps = 0; this.unseen = 0; }
  begin() {
    let pos = this.opts.at;
    const smoke = this.s.smoke && now() - this.s.smoke.at < 1200 ? this.s.smoke : null;
    if (!pos && this.opts.route) {
      const r = routeAhead(this.p, this.M, 24, 46);
      if (r) pos = groundSpot(this.p, { min: 2, max: 6, center: r, hidden: true, exposed: true, tries: 10 });
      if (!pos) return false;
    }
    if (!pos && this.perch) pos = perchSpot(this.p, this.s, { min: 10, max: 26 });
    if (!pos && smoke && chance(0.6)) pos = groundSpot(this.p, { min: 9, max: 16, center: smoke.pos, hidden: true, exposed: true });
    if (!pos && chance(0.4)) pos = perchSpot(this.p, this.s, { min: 14, max: 30 });
    if (!pos) {
      const t = trunkSpot(this.p, this.s, { min: 20, max: 34, kind: "peek", hidden: true, exposedHead: true });
      pos = t ? t.pos : groundSpot(this.p, { min: 22, max: 34, hidden: true, exposed: true });
    }
    if (!pos) return false;
    this.w = new Walker(this.p);
    if (!this.w.spawn(pos, this.p.location)) return false;
    this.w.setPose(9);
    this.limit = this.opts.limit || rnd(30, 45);
    return true;
  }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(30);
    const seen = this.watchCheck();
    w.bell();
    if (this.state === "start") {
      if (seen > 0.2 && !this.spotted) { this.spotted = true; addAnger(this.s, 2); }
      if (seen > 0.6 && !this.tilted) { this.tilted = true; w.twitch(); }
      if (seen > 0) this.unseen = 0; else this.unseen += 0.1;
      // look away and he creeps (each time a little further)
      if (this.unseen > 3.2 && this.creeps < 4 && this.pd > 12 && this.spotted) {
        this.unseen = 0;
        const step = creepStep(this.M);
        const at = V.add(w.loc, V.mul(V.normH(V.sub(this.p.location, w.loc)), step));
        const pos = findStand(this.p.dimension, at.x, at.z, w.loc.y, { up: 3, down: 5 });
        if (pos && !visibleSpot(this.p, pos) && V.dist(pos, this.p.location) > 9) {
          safe(() => w.e.teleport(pos, { facingLocation: V.up(this.p.location, 1.6) }));
          this.creeps++;
          this.limit += 6;
        }
      }
      if (seen > this.snap + 0.5 || this.pd < 12) { this.go("go"); w.setPose(1); w.twitch(); }
      else if (this.age > this.limit && !visibleSpot(this.p, w.loc)) { w.remove(); this.finish(30); }
    } else if (this.state === "go") {
      if (this.inState > 0.8) { if (angry(this)) return; w.vanish({ ash: true }); this.finish(45); }
    }
  }
}

/** By day, deep in his woods: a figure standing in the fog, too far to be sure. */
export class DayWatch extends Enc {
  constructor(p, s) { super(p, s, "daywatch"); }
  begin() {
    const t = trunkSpot(this.p, this.s, { min: 30, max: 44, kind: "peek", hidden: true, exposedHead: true });
    const pos = t ? t.pos : groundSpot(this.p, { min: 32, max: 46, hidden: true, exposed: true });
    if (!pos) return false;
    this.w = new Walker(this.p);
    if (!this.w.spawn(pos, this.p.location)) return false;
    this.w.setPose(chance(0.5) ? 9 : 1);
    this.limit = rnd(30, 50);
    return true;
  }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(30);
    const seen = this.watchCheck();
    if (this.state === "start") {
      if (seen > this.snap && !this.twitched) { this.twitched = true; w.twitch(); addAnger(this.s, 1); }
      if (this.pd < 20 || (seen > this.snap + 4)) {
        if (angry(this, 0.6)) return;
        const t = trunkSpot(this.p, this.s, { min: Math.max(16, this.pd - 2), max: this.pd + 10, kind: "hide", hidden: true });
        if (t) { w.go(t.pos, "walk"); this.go("hide"); } else { w.vanish(); this.finish(60); }
      } else if (this.age > this.limit && !visibleSpot(this.p, w.loc)) { w.remove(); this.finish(60); }
    } else if (this.state === "hide") {
      const r = w.step();
      if (!visibleSpot(this.p, w.loc) && this.inState > 1.5) { w.remove(); return this.finish(60); }
      if (r === "arrived" || r === "stuck" || this.inState > 8) { w.vanish(); this.finish(60); }
    }
  }
}

/** He walks slowly across the far tree line, from one side of your view to the other. */
export class TreelineWalk extends Enc {
  constructor(p, s) { super(p, s, "treeline"); }
  begin() {
    const p = this.p, dim = p.dimension;
    const yaw = viewYaw(p);
    const side = chance(0.5) ? 1 : -1;
    const r = rnd(28, 38);
    const from = V.add(p.location, V.mul(fromAngle(yaw + side * rnd(0.75, 1.0)), r));
    const to = V.add(p.location, V.mul(fromAngle(yaw - side * rnd(0.6, 0.9)), r));
    const a = findStand(dim, from.x, from.z, p.location.y, { up: 8, down: 10 });
    const b = findStand(dim, to.x, to.z, p.location.y, { up: 8, down: 10 });
    if (!a || !b || visibleSpot(p, a, 0.75)) return false;
    this.w = new Walker(p);
    if (!this.w.spawn(a, b)) return false;
    this.dest = b;
    this.w.go(b, "walk");
    return true;
  }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(30);
    const seen = this.watchCheck();
    if (this.pd < 14) { if (angry(this, 0.8)) return; w.vanish(); return this.finish(50); }
    if (this.state === "start") {
      const r = w.step();
      if (r === "stuck") hopToward(this.p, w, this.dest);
      if (seen > 1.4 && !this.stopped) {                       // he stops, and his head turns to you
        this.stopped = true;
        w.halt(1); w.face(this.p.location);
        addAnger(this.s, 1.5);
        this.go("stop");
      }
      if (r === "arrived" || this.age > 40) this.go("gone");
    } else if (this.state === "stop") {
      w.breathe(this.p.location);
      if (this.inState > rnd(2.5, 4)) { if (angry(this, 0.5)) return; w.twitch(); w.go(this.dest, "walk"); this.go("start"); }
    } else if (this.state === "gone") {
      if (!visibleSpot(this.p, w.loc)) { w.remove(); return this.finish(45); }
      if (this.inState > 6) { w.vanish(); this.finish(45); }
    }
  }
}

/** Underground: at the far end of the tunnel, at the edge of your light.  Closer each time you look back. */
export class CaveWatch extends Enc {
  constructor(p, s) { super(p, s, "cavewatch"); this.unseen = 0; this.creeps = 0; }
  begin() {
    const sp = caveSpot(this.p, { min: 14, max: 26 });
    if (!sp) return false;
    this.w = new Walker(this.p);
    if (!this.w.spawn(sp.pos, this.p.location)) return false;
    this.low = sp.low;
    if (this.low) { this.w.setMode("hold_low"); this.w.setPose(6); } else this.w.setPose(chance(0.5) ? 9 : 11);
    playFor(this.p, "goatwalker.hoof", V.up(sp.pos, 0.2), 0.7, 0.85);
    return true;
  }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(30);
    const seen = this.watchCheck();
    const p = this.p;
    if (this.state === "start") {
      if (seen > 0) this.unseen = 0; else this.unseen += 0.1;
      if (seen > 0.3 && !this.spotted) { this.spotted = true; w.twitch(); addAnger(this.s, 2); }
      if (this.unseen > 2.6 && this.creeps < 5 && this.pd > 8) {
        this.unseen = 0;
        const step = creepStep(this.M) * 0.8;
        const at = V.add(w.loc, V.mul(V.normH(V.sub(p.location, w.loc)), step));
        const pos = findStand(p.dimension, at.x, at.z, w.loc.y, { up: 2, down: 3, height: this.low ? 2 : 3 });
        if (pos && !visibleSpot(p, pos) && lightAt(p.dimension, pos, 6) < 8 && V.dist(pos, p.location) > 6) {
          safe(() => w.e.teleport(pos, { facingLocation: V.up(p.location, 1.4) }));
          playFor(p, "goatwalker.hoof", V.up(pos, 0.2), 0.6, 0.9);
          this.creeps++;
        }
      }
      if (seen > this.snap || this.pd < 7) {
        if (angry(this, 1.1)) return;                             // down here there is nowhere for you to go
        w.twitch();
        if (this.pd < 7 || chance(0.35)) { w.vanish({ ash: true }); return this.finish(60); }
        const away = V.add(w.loc, V.mul(V.normH(V.sub(w.loc, p.location)), 10));
        w.go(findStand(p.dimension, away.x, away.z, w.loc.y, { up: 2, down: 3, height: 2 }) || away, this.low ? "crawl" : "walk");
        this.go("retreat");
      } else if (this.age > 45 && !visibleSpot(p, w.loc)) { w.remove(); this.finish(40); }
    } else if (this.state === "retreat") {
      w.step();
      if (!visibleSpot(p, w.loc) && this.inState > 1) { w.remove(); return this.finish(60); }
      if (this.inState > 6) { w.vanish(); this.finish(60); }
    }
  }
}

// =================================================================== INTRUSIVE
/** Peeking from behind a trunk. */
export class Peek extends Enc {
  constructor(p, s) { super(p, s, "peek"); }
  get tier() { return "intrude"; }
  begin() {
    const sp = trunkSpot(this.p, this.s, { min: 13, max: 24, kind: "peek", hidden: true, exposedHead: true });
    if (!sp) return false;
    this.w = new Walker(this.p);
    if (!this.w.spawn(sp.pos, sp.face)) return false;
    this.w.setPose(11);
    this.sp = sp;
    return true;
  }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(30);
    const seen = this.watchCheck();
    w.breathe(this.p.location);
    if (this.state === "start") {
      if (seen > Math.min(1.6, this.snap)) {                      // caught: slide back behind the trunk
        const t = this.sp.trunk;
        const tc = { x: t.x + 0.5, y: w.loc.y, z: t.z + 0.5 };
        const behind = V.add(tc, V.mul(V.normH(V.sub(tc, this.p.location)), (t.r || 0.5) + 0.7));
        safe(() => w.e.teleport(behind, { facingLocation: V.up(this.p.location, 1.6) }));
        w.setPose(1); w.twitch(); addAnger(this.s, 2);
        this.go("hidden");
      } else if (this.pd < 8) { if (angry(this)) return; w.vanish(); this.finish(40); }
      else if (this.age > 32 && !visibleSpot(this.p, w.loc)) { w.remove(); this.finish(30); }
    } else if (this.state === "hidden") {
      if (this.pd < 9 || this.inState > 8) { if (angry(this, this.pd < 9 ? 1.2 : 0.6)) return; if (visibleSpot(this.p, w.loc)) w.vanish(); else w.remove(); this.finish(45); }
    }
  }
}

/** Following: he walks behind you, tree to tree; freezes when seen, hides when watched. */
export class Follow extends Enc {
  constructor(p, s) { super(p, s, "follow"); this.seenCount = 0; this.repath = 0; }
  get tier() { return "intrude"; }
  begin() {
    const sp = groundSpot(this.p, { min: 18, max: 26, side: "behind", hidden: true });
    if (!sp) return false;
    this.w = new Walker(this.p);
    if (!this.w.spawn(sp, this.p.location)) return false;
    this.w.prints = this.s.anger >= 35;
    this.limit = rnd(55, 75);
    return true;
  }
  keep() { return this.s.group.n >= 1 ? 17 : rnd(11, 15); }      // with company near you he keeps further off
  target() {
    // stay on his own side of you and drift round toward your back; never cut past you
    const p = this.p;
    const mine = angleOf(V.normH(V.sub(this.w.loc, p.location)));
    const back = angleOf(V.mul(V.normH(p.getViewDirection()), -1));
    let delta = Math.atan2(Math.sin(back - mine), Math.cos(back - mine));
    delta = clamp(delta, -0.6, 0.6);
    const a = mine + delta;
    const want = V.add(p.location, V.mul(fromAngle(a), this.keep()));
    const t = trunkSpot(p, this.s, { min: 9, max: 18, kind: "peek", hidden: true });
    if (t && V.distH(t.pos, want) < 7) return t.pos;
    return findStand(p.dimension, want.x, want.z, p.location.y) || want;
  }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(30);
    const seen = this.watchCheck();
    w.bell();
    if (this.pd < 7) { if (angry(this, 1.1)) return; w.vanish({ ash: true }); addAnger(this.s, 2); return this.finish(50); }
    if (this.state === "start" || this.state === "move") {
      if (this.state === "start") this.go("move");
      if (now() >= this.repath) { this.repath = now() + 30; w.go(this.target(), this.pd < 20 ? "stalk" : "walk"); }
      const r = w.step();
      if (r === "arrived") {
        w.setPose(11); w.face(this.p.location);
        if (chance(0.3)) {                                        // fresh gouge: he was just here
          const t = nearbyTrunks({ location: w.loc }, this.s, 0, 3.5)[0];
          if (t && markTrunk(w.e.dimension, { x: t.bx ?? t.x, y: t.y0 + 2, z: t.bz ?? t.z }, 0, this.p.location))
            playAt(w.e.dimension, "goatwalker.gouge", V.up(w.loc, 2), 0.8);
        }
      }
      if (r === "stuck") hopToward(this.p, w, w.dest || this.p.location);
      if (seen > 0.4) {                                          // freeze
        w.halt(1); w.face(this.p.location); w.twitch();
        this.seenCount++; addAnger(this.s, 1.5);
        this.go("frozen");
      }
      if (this.age > this.limit || this.seenCount >= 3) { if (angry(this, 0.8)) return; this.go("leave"); }
    } else if (this.state === "frozen") {
      w.breathe(this.p.location);
      if (seen > this.snap) {                                    // watched too long: hide
        const t = trunkSpot(this.p, this.s, { min: 8, max: 20, kind: "peek", hidden: true });
        if (angry(this, 0.7)) return;
        if (t) { w.go(t.pos, "walk"); this.go("hide"); } else { w.vanish(); this.finish(45); }
      } else if (seen === 0 && this.inState > 1.2) this.go("move");
    } else if (this.state === "hide") {
      const r = w.step();
      if (r === "arrived" || this.inState > 6) { w.halt(11); w.face(this.p.location); this.go("peek"); }
    } else if (this.state === "peek") {
      w.breathe(this.p.location);
      if (seen === 0 && this.inState > 3) this.go("move");
      if (this.inState > 14) this.go("leave");
    } else if (this.state === "leave") {
      if (!visibleSpot(this.p, w.loc)) { w.remove(); return this.finish(45); }
      if (this.inState > 5) { w.vanish(); this.finish(45); }
    }
  }
}

/** Cold breath: he hides behind a trunk close to you; only the breath gives him away. */
export class Breath extends Enc {
  constructor(p, s) { super(p, s, "breath"); }
  get tier() { return "intrude"; }
  begin() {
    const t = trunkSpot(this.p, this.s, { min: 7, max: 12, kind: "hide", hidden: true });
    if (!t) return false;
    this.w = new Walker(this.p);
    if (!this.w.spawn(t.pos, this.p.location)) return false;
    this.w.setPose(1);
    this.trunk = t.trunk;
    return true;
  }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(30);
    const seen = this.watchCheck();
    if (now() >= (this.nextPuff || 0)) {                        // the puff drifts out beside the trunk
      this.nextPuff = now() + rint(46, 64);
      const h = w.head();
      if (h) {
        const toP = V.normH(V.sub(this.p.location, h));
        const side = V.rotY(toP, chance(0.5) ? 1.1 : -1.1);
        particleDir(w.e.dimension, `${NS}:breath`, V.add(h, V.mul(side, 0.7)), "variable.puff", 1.0, V.norm(V.up(side, 0.1)));
        playAt(w.e.dimension, "goatwalker.snort", h, 0.5, rnd(0.8, 1.0));
      }
    }
    if (seen > 0.15) { if (angry(this, 0.9)) return; w.twitch(); w.vanish({ ash: true, quick: chance(0.6) }); addAnger(this.s, 2); return this.finish(50); }
    if (this.age > 26) { w.remove(); this.finish(40); }
  }
}

/** Hooves on the roof. */
export class Roof extends Enc {
  constructor(p, s) { super(p, s, "roof"); this.k = 0; }
  get tier() { return "intrude"; }
  begin() {
    if (!isIndoors(this.p, this.s)) return false;
    const top = safe(() => this.p.dimension.getTopmostBlock({ x: Math.floor(this.p.location.x), z: Math.floor(this.p.location.z) }));
    if (!top || top.location.y <= this.p.location.y + 1) return false;
    this.roofY = top.location.y + 1;
    this.dir = fromAngle(rnd(0, Math.PI * 2));
    this.from = V.add({ x: this.p.location.x, y: this.roofY, z: this.p.location.z }, V.mul(this.dir, -4));
    this.steps = rint(7, 10);
    return true;
  }
  tick() {
    const p = this.p, dim = p.dimension;
    if (this.state === "start" && this.inState >= 0.6) {
      this.go("start");
      const at = V.add(this.from, V.mul(this.dir, this.k * 0.95));
      playFor(p, "goatwalker.hoof.roof", at, 1.0, rnd(0.88, 1.0));
      if (this.k % 2 === 0) {
        const under = { x: at.x, y: this.roofY - 1.6, z: at.z };
        particle(dim, `${NS}:roof_dust`, under);
        playFor(p, "goatwalker.dust", under, 0.7);
      }
      this.k++;
      if (this.k === 4 && chance(0.5)) this.go("pause");
      if (this.k >= this.steps) { this.go("end"); }
    } else if (this.state === "pause" && this.inState > 3) {
      playFor(p, "goatwalker.breath", V.add(this.from, V.mul(this.dir, 4)), 0.9);
      this.go("start");
    } else if (this.state === "end") {
      if (this.inState > 1.2 && !this.scraped) {
        this.scraped = true;
        playFor(p, "goatwalker.scrape.stone", V.add(this.from, V.mul(this.dir, this.k)), 0.8, 0.8);
        playFor(p, "goatwalker.crack", V.add(this.from, V.mul(this.dir, this.k)), 0.6);
      }
      if (this.inState > 3) {
        addAnger(this.s, 2);
        if (chance(0.4)) this.s.roofWatch = { until: now() + 20 * 90, y: this.roofY, at: V.add(this.from, V.mul(this.dir, this.k)) };
        this.finish(40);
      }
    }
  }
}

/** He knows where you live.  Three knocks on your door.  If you open it, there are prints, and him, out by the trees. */
export class HomeVisit extends Enc {
  constructor(p, s) { super(p, s, "knock_door"); this.n = 0; }
  get tier() { return "intrude"; }
  begin() {
    const p = this.p;
    if (!isIndoors(p, this.s)) return false;
    const ent = findEntrance(p);
    if (!ent) return false;
    this.ent = ent;
    this.outside = V.add(ent.at, V.mul(ent.out, 1.2));
    this.wasOpen = this.doorOpen();
    this.s.knockDay = dayIndex();
    return true;
  }
  doorOpen() {
    if (!this.ent || !this.ent.door) return false;
    const b = blockAt(this.p.dimension, this.ent.door);
    if (!b) return false;
    return !!(safe(() => b.permutation.getState("open_bit")) || safe(() => b.permutation.getState(`${NS}:open`)));
  }
  tick() {
    const p = this.p;
    if (this.state === "start" && this.inState > 1) {
      playFor(p, "goatwalker.knock", V.up(this.outside, 1.2), 1.0, rnd(0.85, 0.95));
      this.go("wait");
    } else if (this.state === "wait") {
      const opened = (this.doorOpen() && !this.wasOpen) || !isIndoors(p, this.s) || V.dist(p.location, this.ent.at) < 1.5;
      if (opened) { this.reveal(); return; }
      if (this.inState > 18 && this.n === 0) {                  // nothing.  then knocking somewhere else
        this.n = 1;
        const behind = V.add(p.location, V.mul(V.normH(p.getViewDirection()), -3));
        playFor(p, "goatwalker.knock", V.up(behind, 1.4), 0.8, 0.8);
        this.st0 = now();
      } else if (this.inState > 20 && this.n === 1) {
        playFor(p, "goatwalker.gouge", V.up(this.outside, 1.5), 0.7, 0.8);
        addAnger(this.s, 2);
        this.trace();
        this.finish(80);
      }
    }
  }
  trace() {
    const dim = this.p.dimension;
    for (let d = 1.5; d < 12; d += 1.7) placePrint(dim, V.add(this.outside, V.mul(this.ent.out, d)), this.ent.out);
  }
  reveal() {
    const p = this.p, s = this.s;
    this.trace();
    const watch = new Watch(p, s, false, { at: groundSpot(p, { min: 22, max: 32, center: V.add(this.ent.at, V.mul(this.ent.out, 6)), hidden: false, exposed: true, tries: 12 }), limit: 25 });
    this.finish(60);
    if (watch.opts.at && watch.begin()) { s.enc = watch; s.last = "Watch"; }
  }
}

// =================================================================== CONFRONTATIONS
/** Stalking: crawls in from cover, stands up close in the claw raise, calls, leaves. */
export class Stalk extends Enc {
  constructor(p, s) { super(p, s, "stalk"); this.repath = 0; }
  get tier() { return "confront"; }
  begin() {
    const t = trunkSpot(this.p, this.s, { min: 24, max: 32, kind: "hide", hidden: true });
    const sp = t ? t.pos : groundSpot(this.p, { min: 24, max: 32, hidden: true });
    if (!sp) return false;
    this.w = new Walker(this.p);
    if (!this.w.spawn(sp, this.p.location)) return false;
    this.w.prints = true;
    pushFog(this.p, this.s, "near");
    return true;
  }
  finish(q = 40) { popFog(this.p, this.s, "near"); super.finish(q); }
  tick() {
    const w = this.w;
    if (!w.ok) return this.finish(40);
    const seen = this.watchCheck();
    w.breathe(this.p.location);
    if (this.pd < 5.5) { if (angry(this, 1.3)) return; w.vanish({ ash: true }); addAnger(this.s, 3); return this.finish(60); }
    if (this.state === "start" || this.state === "crawl") {
      if (this.state === "start") this.go("crawl");
      if (now() >= this.repath) {
        this.repath = now() + 40;
        const t = trunkSpot(this.p, this.s, { min: 9, max: Math.max(12, this.pd - 4), kind: "hide", hidden: true });
        w.go(t ? t.pos : V.add(this.p.location, V.mul(V.normH(V.sub(w.loc, this.p.location)), 10)), "crawl");
      }
      const r = w.step();
      if (r === "stuck") hopToward(this.p, w, this.p.location);
      if (seen > 0.5 && this.inState > 2) { w.halt(6); w.twitch(); this.go("still"); }
      if (this.pd < 13 && this.inState > 3) { w.halt(10); w.face(this.p.location); this.go("raise"); }
      if (this.age > 70) this.go("leave");
    } else if (this.state === "still") {
      if (seen === 0 && this.inState > 1.5) this.go("crawl");
      if (seen > this.snap) { w.halt(10); w.face(this.p.location); this.go("raise"); }
    } else if (this.state === "raise") {
      if (this.inState < 0.2) { playAt(w.e.dimension, "goatwalker.growl", V.up(w.loc, 2), 1.0); addAnger(this.s, 2); }
      if (this.inState > 3.5) {
        if (angry(this, 1.1)) return;                            // claws up, and this time he does not put them down
        if (chance(0.5)) { w.setPose(3); this.go("call"); }
        else this.go("leave");
      }
    } else if (this.state === "call") {
      if (this.inState < 0.2) territoryCall(this.p, w.loc);
      if (this.inState > 3.0) this.go("leave");
    } else if (this.state === "leave") {
      if (!this.left) {
        this.left = true;
        const away = V.add(w.loc, V.mul(V.normH(V.sub(w.loc, this.p.location)), 14));
        w.go(findStand(this.p.dimension, away.x, away.z, w.loc.y) || away, "crawl");
      }
      w.step();
      if (!visibleSpot(this.p, w.loc) && this.inState > 2) { w.remove(); return this.finish(50); }
      if (this.inState > 8) { w.vanish(); this.finish(50); }
    }
  }
}
export function territoryCall(p, at) {
  const dim = p.dimension;
  playAt(dim, "goatwalker.call", V.up(at, 2.4), 1.2);
  playAt(dim, "goatwalker.growl", V.up(at, 2.4), 1.0, 0.8);
  const goats = safe(() => dim.getEntities({ location: at, maxDistance: 48, type: "minecraft:goat" }), []);
  goats.forEach((g, i) => system.runTimeout(() => {
    if (alive(g)) playAt(dim, "goatwalker.scream", V.up(g.location, 1), 0.8, rnd(0.9, 1.1));
  }, 30 + i * 7 + rint(0, 10)));
}

/**
 * The standoff.  He steps out into the open, rears up and roars.  Then it is up to you:
 *   stare him down - he snaps (sooner every time you have done it)
 *   look away      - he is closer when you look back (further each time)
 *   run            - he may give chase
 *   back off slowly, eyes on him - most of the time he lets you go
 */
export class Standoff extends Enc {
  constructor(p, s) { super(p, s, "standoff"); this.unseen = 0; }
  get tier() { return "confront"; }
  begin() {
    const p = this.p;
    this.D = clamp(17 - this.s.anger / 10, 9, 16) - (this.s.group.n ? -4 : 0);
    // out of sight first, beside or ahead of you ...
    const t = trunkSpot(p, this.s, { min: this.D + 3, max: this.D + 10, kind: "hide", hidden: true });
    const from = t ? t.pos : groundSpot(p, { min: this.D + 4, max: this.D + 10, side: "front", hidden: true });
    if (!from) return false;
    // ... then he walks out into the open
    const toward = V.normH(V.sub(p.location, from));
    let out = null;
    for (let i = 0; i < 6 && !out; i++) {
      const at = V.add(p.location, V.mul(V.rotY(V.mul(toward, -1), rnd(-0.5, 0.5)), this.D));
      const pos = findStand(p.dimension, at.x, at.z, p.location.y, { up: 4, down: 6 });
      if (pos && exposedSpot(p, pos)) out = pos;
    }
    if (!out) return false;
    this.w = new Walker(p);
    if (!this.w.spawn(from, out)) return false;
    this.out = out;
    this.w.go(out, "stalk");
    this.startD = V.dist(out, p.location);
    pushFog(p, this.s, "near");
    return true;
  }
  finish(q = 60) { popFog(this.p, this.s, "near"); super.finish(q); }
  tick() {
    const w = this.w, p = this.p;
    if (!w.ok) return this.finish(40);
    const seen = this.watchCheck();
    if (this.state === "start") {                         // stepping out
      const r = w.step();
      if (r === "stuck") w.jumpAssist(this.out);
      if (r === "arrived" || r === "stuck" || (seen > 0.3 && this.inState > 1.5) || this.inState > 10) {
        w.halt(0); w.face(p.location);
        this.go("reveal");
      }
    } else if (this.state === "reveal") {                 // rears up and roars
      if (this.inState > 0.3 && !this.roared) { this.roared = true; w.roar(10); addAnger(this.s, 3); }
      if (this.inState > 3.2) { w.setPose(1); this.go("hold"); this.holdD = this.pd; }
    } else if (this.state === "hold") {
      w.breathe(p.location);
      const d = this.pd;
      if (seen > 0) this.unseen = 0; else this.unseen += 0.1;
      // stared down: he snaps
      if (this.stareRun > this.snap) return this.snapped();
      // looked away: he comes closer, and closer
      if (this.unseen > 1.4) {
        this.unseen = 0;
        const step = Math.min(creepStep(this.M), d - 3);
        if (step > 1) {
          const at = V.add(w.loc, V.mul(V.normH(V.sub(p.location, w.loc)), step));
          const pos = findStand(p.dimension, at.x, at.z, w.loc.y, { up: 2, down: 3 });
          if (pos && !visibleSpot(p, pos)) { safe(() => w.e.teleport(pos, { facingLocation: V.up(p.location, 1.6) })); playFor(p, "goatwalker.hoof", pos, 0.7); }
        }
        if (this.pd < 4.5) return this.atYourBack();
      }
      // ran: he may give chase
      if (safe(() => p.isSprinting, false) && d > this.holdD + 5) {
        if (this.s.anger >= 30 && chance(0.5 + this.s.anger / 220)) { w.roar(3); if (escalate(this)) return; }   // you ran: he chases what runs
        territoryCall(p, w.loc);
        return this.leave();
      }
      // backed away with your eyes on him: he lets you go
      if (d > this.holdD + 9) { w.twitch(); return this.leave(); }
      if (this.inState > 28) { if (angry(this, 0.8)) return; return this.leave(); }
    } else if (this.state === "leave") {
      const r = w.step();
      if (!visibleSpot(p, w.loc) && this.inState > 1.5) { w.remove(); return this.finish(70); }
      if (r === "arrived" || r === "stuck" || this.inState > 9) { w.vanish(); this.finish(70); }
    }
  }
  snapped() {
    const w = this.w, p = this.p;
    w.twitch();
    if (chance([0, 0.05, 0.25, 0.6, 0.8][wrathOf(this.s)]) && !peaceful()) {   // he lunges and the chase is on
      const dir = V.normH(V.sub(p.location, w.loc));
      safe(() => w.e.applyImpulse({ x: dir.x * 1.2, y: 0.35, z: dir.z * 1.2 }));
      w.setPose(7);
      if (escalate(this)) return;
    }
    // or: a violent jerk toward you ... and he is gone
    const dir = V.normH(V.sub(p.location, w.loc));
    safe(() => w.e.applyImpulse({ x: dir.x * 0.9, y: 0.3, z: dir.z * 0.9 }));
    w.setPose(7);
    playAt(w.e.dimension, "goatwalker.growl", V.up(w.loc, 2.2), 1.2, 1.1);
    const self = this;
    system.runTimeout(() => { if (w.ok) w.vanish({ ash: true }); self.finish(80); }, 12);
    this.go("gone");
  }
  atYourBack() {
    const w = this.w, p = this.p;
    w.breathe(p.location);
    playFor(p, "goatwalker.breath", V.up(w.loc, 2.4), 1.0);
    shakeCam(p, 0.12, 0.6);
    if (chance([0, 0, 0.2, 0.5, 0.7][wrathOf(this.s)]) && !peaceful()) { if (escalate(this)) return; }
    w.vanish({ ash: true, quick: true });
    addAnger(this.s, 3);
    this.finish(80);
  }
  leave() {
    const w = this.w, p = this.p;
    const t = trunkSpot(p, this.s, { min: this.pd + 4, max: this.pd + 16, kind: "hide", hidden: true });
    const away = t ? t.pos : V.add(w.loc, V.mul(V.normH(V.sub(w.loc, p.location)), 12));
    w.go(findStand(p.dimension, away.x, away.z, w.loc.y) || away, "walk");
    this.go("leave");
  }
}

/**
 * Siege: you keep hiding in the same room.  The first times he only notes it.  Once he is
 * sure, he waits outside the entrance - for a long time - and watches.
 */
export class Siege extends Enc {
  constructor(p, s, room) { super(p, s, "siege"); this.room = room; }
  get tier() { return "confront"; }
  begin() {
    const p = this.p;
    const ent = findEntrance(p);
    if (!ent) return false;
    this.ent = ent;
    const base = V.add(ent.at, V.mul(ent.out, rnd(5, 9)));
    const pos = findStand(p.dimension, base.x, base.z, ent.at.y, { up: 4, down: 6 })
      || groundSpot(p, { min: 7, max: 12, center: V.add(ent.at, V.mul(ent.out, 4)), hidden: true, tries: 10 });
    if (!pos || visibleSpot(p, pos)) return false;
    this.w = new Walker(p);
    if (!this.w.spawn(pos, ent.at)) return false;
    this.w.setPose(9);
    this.w.face(ent.at, true);
    this.limit = clamp(60 + this.room.c * 25, 60, 160);
    this.nextSound = now() + rint(200, 300);
    return true;
  }
  tick() {
    const w = this.w, p = this.p;
    if (!w.ok) return this.finish(60);
    const seen = this.watchCheck();
    noteRoom(this.M, p.location, this.s);
    if (now() >= this.nextSound) {                       // breathing at the door, a knock, a scrape
      this.nextSound = now() + rint(160, 300);
      const k = pick(["breath", "knock", "gouge", "breath"]);
      playFor(p, `goatwalker.${k}`, V.up(V.add(this.ent.at, V.mul(this.ent.out, 1.2)), 1.3), 0.8, rnd(0.8, 0.95));
    }
    if (seen > 0.4 && !this.spotted) { this.spotted = true; w.twitch(); }
    if (this.stareRun > this.snap) {
      w.twitch();
      if (this.room.c >= 4 && this.s.anger >= 50 && chance(0.5)) { w.roar(10); if (escalate(this)) return; }
      w.vanish({ ash: true });
      return this.done_();
    }
    // you came out: he does not run at you; he lets you see him, then he is gone
    if (this.pd < 6) { w.twitch(); w.vanish({ ash: true }); return this.done_(); }
    if (this.age > this.limit) {
      if (!visibleSpot(p, w.loc)) w.remove(); else w.vanish();
      this.done_();
    }
  }
  done_() {
    const dim = this.p.dimension;
    // the morning after: prints all round the entrance, a mark beside it
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      placePrint(dim, V.add(V.add(this.ent.at, V.mul(this.ent.out, 3)), { x: Math.cos(a) * 2.5, y: 0, z: Math.sin(a) * 2.5 }), fromAngle(a + Math.PI / 2));
    }
    addAnger(this.s, 3);
    this.finish(90);
  }
}

/** He waits beside the passage you always escape through, before he ever becomes aggressive. */
export class RouteAmbush extends Enc {
  constructor(p, s, node) { super(p, s, "ambush"); this.node = node; }
  get tier() { return "confront"; }
  begin() {
    const p = this.p, n = this.node;
    const t = trunkSpot({ location: n, dimension: p.dimension, getViewDirection: () => p.getViewDirection() }, this.s, { min: 1, max: 7, kind: "hide", hidden: false, from: p.location });
    let pos = t && !visibleSpot(p, t.pos) ? t.pos : null;
    for (let i = 0; i < 10 && !pos; i++) {
      const a = rnd(0, 6.28);
      const at = V.add(n, { x: Math.cos(a) * rnd(2, 5), y: 0, z: Math.sin(a) * rnd(2, 5) });
      const c = findStand(p.dimension, at.x, at.z, n.y, { up: 6, down: 6 });
      if (c && !visibleSpot(p, c) && V.dist(c, p.location) > 14) pos = c;
    }
    if (!pos) return false;
    this.w = new Walker(p);
    if (!this.w.spawn(pos, p.location)) return false;
    const low = headroom(p.dimension, pos, 3) < 3;
    if (low) { this.w.setMode("hold_low"); this.w.setPose(6); } else this.w.setPose(chance(0.5) ? 6 : 11);
    this.limit = rnd(70, 110);
    return true;
  }
  tick() {
    const w = this.w, p = this.p;
    if (!w.ok) return this.finish(40);
    const seen = this.watchCheck();
    const dn = V.dist(p.location, this.node);
    if (this.state === "start") {
      w.breathe(p.location);
      if (this.pd < 10 || dn < 6) {                        // you walked right into him
        w.face(p.location); w.roar(10); addAnger(this.s, 4);
        this.go("reveal");
      } else if (seen > this.snap) {                         // you spotted him first: he slinks off
        w.twitch();
        const away = V.add(w.loc, V.mul(V.normH(V.sub(w.loc, p.location)), 10));
        w.go(findStand(p.dimension, away.x, away.z, w.loc.y) || away, "crawl");
        this.go("leave");
      } else if (this.age > this.limit) { if (!visibleSpot(p, w.loc)) w.remove(); else w.vanish(); this.finish(60); }
    } else if (this.state === "reveal") {
      if (this.inState > 2.4) {
        if (this.s.anger >= 40 && !peaceful() && chance(0.75)) { if (escalate(this)) return; }
        w.vanish({ ash: true }); this.finish(80);
      }
    } else if (this.state === "leave") {
      w.step();
      if (!visibleSpot(p, w.loc) && this.inState > 1.5) { w.remove(); return this.finish(60); }
      if (this.inState > 7) { w.vanish(); this.finish(60); }
    }
  }
}

// =================================================================== AFTERMATH
/** After you got away: his prints round where you hid, his mark, and sometimes him, watching your hiding place. */
export class Aftermath extends Enc {
  constructor(p, s, info) { super(p, s, "aftermath"); this.info = info; }
  get tier() { return "after"; }
  begin() {
    const p = this.p, dim = p.dimension, at = this.info.loc;
    if (V.dist(at, p.location) > 64) return false;
    // prints that come to where you hid, circle it, and leave
    const a0 = rnd(0, 6.28);
    const start = V.add(at, V.mul(fromAngle(a0), 14));
    const inDir = V.normH(V.sub(at, start));
    let n = 0;
    for (let d = 0; d < 11; d += 1.8) if (placePrint(dim, V.add(start, V.mul(inDir, d)), inDir)) n++;
    for (let k = 0; k < 6; k++) {
      const a = a0 + Math.PI + (k / 6) * Math.PI * 1.5;
      if (placePrint(dim, V.add(at, V.mul(fromAngle(a), 3)), fromAngle(a + Math.PI / 2))) n++;
    }
    if (chance(0.6)) placeBlood(dim, V.add(at, V.mul(inDir, -4)));
    const t = nearbyTrunks({ location: at }, this.s, 0, 8)[0];
    if (t) markTrunk(dim, { x: t.bx ?? t.x, y: t.y0 + 1, z: t.bz ?? t.z }, 0, at);
    if (this.info.hid && chance(0.5)) {
      const ent = findEntrance(p);
      if (ent && ent.door) {
        const wall = V.add(ent.door, V.mul(V.side(ent.out), 1));
        hangOn(dim, wall, CARDINAL[dirIndex(ent.out)], `${NS}:ritual_marking`);
      }
    }
    // and sometimes he is still out there, watching the place you hid
    if (chance(0.38) && !isIndoors(p, this.s)) {
      this.reappear = true;
      const pos = groundSpot(p, { min: 22, max: 34, center: at, hidden: true, exposed: true, tries: 12 });
      if (pos) {
        this.w = new Walker(p);
        if (this.w.spawn(pos, at)) { this.w.setPose(9); this.w.face(at, true); }
      }
    }
    return n > 0 || !!this.w;
  }
  tick() {
    const w = this.w;
    if (!w || !w.ok) return this.finish(90);
    const seen = this.watchCheck();
    if (seen > 0.5 && !this.turned) { this.turned = true; w.twitch(); w.face(this.p.location); }
    if (seen > this.snap + 1 || this.pd < 14) { w.vanish({ ash: true }); return this.finish(120); }
    if (this.age > 30 && !visibleSpot(this.p, w.loc)) { w.remove(); this.finish(120); }
  }
}

// =============================================================================
//  v3.0: HE IS ANGRY.   Everything below is new: scares that put him where you do not expect him,
//  and attacks that do not need a full hunt.
// =============================================================================

/** Put his body somewhere else, at once: ash where he was, a sound where he is. */
function blinkTo(w, pos, faceTo, snd = "goatwalker.appear", vol = 1.2) {
  if (!w.ok) return;
  const dim = w.e.dimension;
  particle(dim, `${NS}:ash_burst`, w.loc);
  w.halt();
  safe(() => w.e.teleport(pos, { facingLocation: { x: faceTo.x, y: pos.y + 2.2, z: faceTo.z } }));
  particle(dim, `${NS}:ash_flake`, V.up(pos, 1.6));
  if (snd) playAt(dim, snd, V.up(pos, 1.5), vol, rnd(0.92, 1.05));
}
const speedOf = (p) => { const v = safe(() => p.getVelocity(), null) || { x: 0, y: 0, z: 0 }; return { v, s: Math.hypot(v.x, v.z) * 20 }; };

// ------------------------------------------------------------------ EYES (sign)
/** Pairs of red eyes out in the dark, at the edge of what you can see. They blink. They are gone. */
/**
 * At the very edge of your eye, for a moment: him.  Gone the instant you turn toward him (or after a heartbeat).
 * Also used between scenes, once he is stalking you, so that you are never sure.
 */
export function glimpse(p, opts = {}) {
  const yaw = viewYaw(p), dim = p.dimension;
  const side = chance(0.5) ? 1 : -1;
  for (const a of [0.74, 0.82, 0.68, 0.9, 0.62]) {            // just inside the edge of the screen
    const pos = standNear(p, yaw + side * a, rnd(8, 15), { spread: 0.08 });
    if (!pos || !lineClear(dim, eye(p), V.up(pos, 2.2)) || !lineClear(dim, eye(p), V.up(pos, 1))) continue;
    const w = new Walker(p);
    if (!w.spawn(pos, p.location)) { w.remove(); continue; }
    w.setPose(chance(0.5) ? 1 : 9);
    const life = rint(8, 16);
    let t = 0;
    const id = system.runInterval(() => {
      t++;
      if (!w.ok || !alive(p) || t > life || inCone(p, V.up(w.loc, 1.8), 0.85)) {
        w.remove();
        system.clearRun(id);
        if (alive(p) && chance(0.3)) playFor(p, "goatwalker.static", eye(p), 0.22);
      }
    }, 1);
    return true;
  }
  return false;
}
export class Glimpse extends Enc {
  constructor(p, s) { super(p, s, "glimpse"); this.noReflex = true; }
  get tier() { return "sign"; }
  begin() { return glimpse(this.p); }
  tick() { this.finish(20); }
}
export class Eyes extends Enc {
  constructor(p, s, opts = {}) { super(p, s, "eyes"); this.opts = opts; }
  get tier() { return "sign"; }
  begin() {
    const p = this.p, dim = p.dimension;
    const force = !!this.opts.force;                                       // asked for on The Wheel: anywhere, any light
    if (!cfg().eyes && !force) return false;
    const yaw = viewYaw(p);
    let n = 0;
    const want = rint(1, 3);
    for (let i = 0; i < 14 && n < want; i++) {
      const a = yaw + rnd(-1.25, 1.25), r = rnd(13, 24);
      const g = findStand(dim, p.location.x + Math.cos(a) * r, p.location.z + Math.sin(a) * r, p.location.y, { height: 3 });
      if (!g) continue;
      const at = V.up(g, chance(0.3) ? rnd(4, 8) : rnd(1.5, 2.8));       // some are far too high up
      const b = blockAt(dim, at);
      if (!b || !b.isAir || (!force && lightAt(dim, at, 3) > 7)) continue;  // only where it is dark
      if (!lineClear(dim, eye(p), at)) continue;
      particle(dim, `${NS}:eyes`, at);
      n++;
    }
    if (!n) return false;
    if (chance(0.35)) playFor(p, "goatwalker.whisper", V.add(eye(p), V.mul(fromAngle(yaw + Math.PI), 3)), 0.5, rnd(0.8, 1.0));
    return true;
  }
  tick() { this.finish(12); }
}

// ------------------------------------------------------------------ MIMIC (sign)
/** Sounds that should not be there: running that stops behind you, breath at your ear, a hum, someone being hurt. */
export class Mimic extends Enc {
  constructor(p, s, kind) { super(p, s, "mimic"); this.kind = kind; }
  get tier() { return "sign"; }
  begin() {
    const p = this.p, back = V.mul(V.normH(p.getViewDirection()), -1);
    const kinds = ["running", "ear", "whisper", "hum", "laugh", "hurt", "chains", "bleat"];
    const k = this.kind || pick(kinds);
    const behind = (r, h = 1.2) => V.add(V.up(p.location, h), V.mul(back, r));
    const off = (r) => V.add(eye(p), V.mul(fromAngle(rnd(0, 6.28)), r));
    if (k === "running") playFor(p, "goatwalker.running", behind(7), 1.0, rnd(0.9, 1.05));
    else if (k === "ear") playFor(p, "goatwalker.ear", behind(1.2, 1.6), 0.9, rnd(0.9, 1.0));
    else if (k === "whisper") playFor(p, "goatwalker.whisper", behind(2, 1.6), 0.8, rnd(0.85, 1.0));
    else if (k === "hum") playFor(p, "goatwalker.hum", off(18), 1.0, rnd(0.9, 1.0));
    else if (k === "laugh") playFor(p, "goatwalker.laugh.far", off(26), 1.0, rnd(0.9, 1.0));
    else if (k === "hurt") playFor(p, "game.player.hurt", behind(9), 0.8, rnd(0.8, 0.95));   // someone, behind you, being hit
    else if (k === "chains") playFor(p, "goatwalker.chains", off(9), 1.0, rnd(0.9, 1.0));
    else playFor(p, "goatwalker.bleat", off(14), 0.9, rnd(0.45, 0.6));                       // a sheep, but slowed, and wrong
    return true;
  }
  tick() { this.finish(14); }
}

// ------------------------------------------------------------------ META (sign) - the fourth wall
/** The game itself seems to notice him. Off with "Fourth-wall scares" on The Wheel. */
export class Meta extends Enc {
  constructor(p, s, kind, force = false) { super(p, s, "meta"); this.kind = kind; this.force = force; }
  get tier() { return "sign"; }
  begin() {
    if (!cfg().meta && !this.force) return false;
    const p = this.p, name = safe(() => p.name, "You");
    const k = this.kind ?? rint(0, 5);
    if (k === 0) safe(() => p.sendMessage(`§e${name} joined the game`));                    // you are already here
    else if (k === 1) { safe(() => p.sendMessage("§e§kWWWWWWWW§r§e joined the game")); system.runTimeout(() => alive(p) && safe(() => p.sendMessage("§e§kWWWWWWWW§r§e left the game")), rint(120, 220)); }
    else if (k === 2) flash(p, " ", "§8do not turn around", 34, 12, 24);
    else if (k === 3) { flash(p, "§4I SEE YOU", "", 7, 0, 3); playFor(p, "goatwalker.static", eye(p), 0.7); }
    else if (k === 4) hint(p, "§8You are being watched.");
    else { safe(() => p.sendMessage(`§7<${name}> §8is someone there`)); }                     // you did not type that
    return true;
  }
  tick() { this.finish(20); }
}

// ------------------------------------------------------------------ BEHIND (intrude)
/** He is standing right behind you. He does nothing. He waits for you to turn round. */
export class Behind extends Enc {
  constructor(p, s, opts = {}) { super(p, s, "behind"); this.opts = opts; this.noReflex = true; this.cue = 0; }
  get tier() { return "intrude"; }
  begin() {
    const p = this.p;
    const yaw = viewYaw(p) + Math.PI;
    let pos;
    for (const da of [0, 0.3, -0.3, 0.6, -0.6]) {
      pos = standNear(p, yaw + da, this.opts.r || rnd(5.5, 8), { spread: 0.2 });
      if (pos && !inCone(p, V.up(pos, 1.5), 0.2)) break;
      pos = undefined;
    }
    if (!pos) return false;
    this.w = new Walker(p);
    if (!this.w.spawn(pos, p.location)) return false;
    this.w.setPose(1);
    return true;
  }
  tick() {
    const p = this.p, w = this.w, s = this.s;
    if (!w.ok) return this.finish(20);
    const seen = visibleSpot(p, V.up(w.loc, 1.5), 0.45);
    if (this.state === "start") {
      if (seen) {                                              // you turned round
        playFor(p, "goatwalker.appear", eye(p), 1.0);
        shakeCam(p, 0.16, 0.5);
        this.go("seen");
        return;
      }
      // you did not turn round: he lets you know, a little at a time
      if (this.cue === 0 && this.age > 2.5) { this.cue = 1; playFor(p, "goatwalker.ear", V.up(w.loc, 2.2), 1.0); }
      if (this.cue === 1 && this.age > 7) { this.cue = 2; playFor(p, "goatwalker.hoof", w.loc, 1.0); const t = standNear(p, viewYaw(p) + Math.PI, Math.max(3, this.pd - 2), { spread: 0.2 }); if (t && !inCone(p, V.up(t, 1.5), 0.2)) safe(() => w.e.teleport(t, { facingLocation: V.up(p.location, 1.6) })); }
      if (this.cue === 2 && this.age > 11) { this.cue = 3; playFor(p, "goatwalker.whisper", V.up(w.loc, 2.2), 1.0, 0.85); }
      if (this.age > 16) { placePrint(w.e.dimension, w.loc, V.sub(p.location, w.loc)); w.remove(); return this.finish(30); }
      return;
    }
    // seen: for a moment he just stands there
    if (this.inState < (this.hold ?? (this.hold = rnd(0.5, 1.1)))) return;
    const wr = wrathOf(s);
    if (this.state === "seen" && wr >= 2 && chance(wr >= 3 ? 0.5 : 0.3)) {      // he is in your face before you can blink
      w.face(p.location, true);
      if (jumpscare(p, w.faceAt())) { this.go("scared"); return; }
    }
    if (this.state === "scared" && this.inState < 0.75) return;
    if (wr >= 3 && chance(0.55) && strike(this)) return;
    if (wr >= 2 && chance(0.35)) playAt(w.e.dimension, "goatwalker.laugh", V.up(w.loc, 2.2), 1.2);
    w.vanish({ ash: true, quick: true });
    addAnger(s, 2);
    this.finish(40);
  }
}

// ------------------------------------------------------------------ CHARGE (attack)
/** He stops watching. He screams and comes straight at you, flat out. Sometimes he stops a yard short,
 *  breathing in your face. He does that less each time you have seen him do it. */
export class Charge extends Enc {
  constructor(p, s, opts = {}) { super(p, s, "charge"); this.close = 0; this.opts = opts; }
  get tier() { return "attack"; }
  begin() {
    const p = this.p;
    if (!survivalish(p) && !this.opts.force) return false;
    let pos;
    if (this.opts.walker && this.opts.walker.ok) {             // he was already standing there, watching
      this.w = this.opts.walker;
      pos = this.w.loc;
      this.w.halt(); this.w.face(p.location, true);
    } else {
      pos = groundSpot(p, { min: 18, max: 26, side: "front", hidden: false }) || groundSpot(p, { min: 16, max: 26, hidden: false });
      if (!pos) return false;
      this.w = new Walker(p);
      if (!this.w.spawn(pos, p.location)) return false;
    }
    this.w.calm = false;
    this.w.setPose(3);
    playAt(p.dimension, "goatwalker.roar", V.up(pos, 2.4), 1.6, rnd(0.9, 1.0));
    shakeCam(p, 0.12, 1.0);
    const wr = wrathOf(this.s);
    this.bluff = peaceful() || !survivalish(p) || chance(clamp(0.6 - 0.14 * (this.M.bluffs || 0) - (wr >= 4 ? 0.3 : wr >= 3 ? 0.15 : 0), 0.08, 0.6));
    return true;
  }
  tick() {
    const p = this.p, w = this.w, s = this.s;
    if (!w.ok) return this.finish(40);
    const d = this.pd;
    if (this.state === "start") {
      if (this.inState > 1.4) { this.go("run"); if (!this.bluff) w.hunt(p, "charge"); }
      return;
    }
    if (this.state === "scared") {                               // after his face: the laugh, and he is gone
      if (this.inState > 0.75) { playAt(w.e.dimension, "goatwalker.laugh", V.up(w.loc, 2.2), 1.0); w.vanish({ ash: true, quick: true }); addAnger(s, -6); return this.finish(60); }
      return;
    }
    if (this.state === "run") {
      if (now() >= (this.gallopAt || 0) && d > 5) { this.gallopAt = now() + 26; playAt(w.e.dimension, "goatwalker.gallop", w.loc, 1.6); }
      if (this.bluff) {
        if (now() >= (this.nextGo || 0)) { this.nextGo = now() + 6; w.go(p.location, "dash"); }
        w.step();
        if (d < 4.6) {                                         // a yard short. He stops.
          w.halt(); w.face(p.location, true); w.setPose(1);
          playAt(w.e.dimension, "goatwalker.snort", V.up(w.loc, 2.2), 1.2, 0.85);
          shakeCam(p, 0.18, 0.4);
          this.M.bluffs = Math.min(6, (this.M.bluffs || 0) + 1);
          this.go("face");
        }
      } else {
        this.close = d < 2.6 ? this.close + 0.1 : 0;
        if (this.close > 0.3) {                                   // he has you
          w.halt(); w.face(p.location, true); w.setPose(1);
          if (jumpscare(p, w.faceAt())) { this.go("scared"); return; }
          playAt(w.e.dimension, "goatwalker.laugh", V.up(w.loc, 2.2), 1.0);
          w.vanish({ ash: true, quick: true });
          addAnger(s, -6);
          return this.finish(60);
        }
        if (this.inState > 7) { w.vanish({ ash: true, quick: true }); addAnger(s, -3); return this.finish(60); }   // you got away
      }
      if (this.inState > 10) { w.vanish({ ash: true, quick: true }); return this.finish(50); }
      return;
    }
    // face: breathing in your face, eye to eye
    if (this.inState > 1.6) { w.vanish({ ash: true, quick: true }); addAnger(s, 3); this.finish(50); }
  }
}

// ------------------------------------------------------------------ MANY (confront)
/** There are three of him. They only move when you are not looking at them. One of them is real. */
export class Many extends Enc {
  constructor(p, s) { super(p, s, "many"); this.decoys = []; }
  get tier() { return "confront"; }
  begin() {
    const p = this.p;
    const base = viewYaw(p) + rnd(-0.4, 0.4);
    const spots = [0, 2.2, -2.2].map((a) => standNear(p, base + a, rnd(14, 19), { spread: 0.5 })).filter(Boolean);
    if (spots.length < 2) return false;
    const real = rint(0, spots.length - 1);
    for (let i = 0; i < spots.length; i++) {
      const w = new Walker(p);
      if (!w.spawn(spots[i], p.location)) { w.remove(); continue; }
      w.setPose(i === real ? 9 : 1);
      w.nextStep = now() + rint(30, 60);
      if (i === real && !this.w) this.w = w; else this.decoys.push(w);
    }
    if (!this.w) { if (!this.decoys.length) return false; this.w = this.decoys.shift(); }
    if (!this.decoys.length) { this.w.remove(); this.w = null; return false; }
    playFor(p, "goatwalker.hum", V.up(this.w.loc, 2), 1.0, 0.9);
    return true;
  }
  all() { return [this.w, ...this.decoys].filter((w) => w && w.ok); }
  tick() {
    const p = this.p, dim = p.dimension;
    if (!this.w || !this.w.ok) return this.finish(30);
    let trigger = this.age > 26;
    for (const w of this.all()) {
      w.turnToward(p.location, 14);
      const d = V.dist(w.loc, p.location);
      if (d < 5.2) trigger = true;
      if (now() < w.nextStep || visibleSpot(p, V.up(w.loc, 1.5), 0.35)) continue;
      w.nextStep = now() + rint(22, 40);                       // not being looked at: one step nearer
      const dir = V.normH(V.sub(p.location, w.loc));
      const to = findStand(dim, w.loc.x + dir.x * 2.4, w.loc.z + dir.z * 2.4, w.loc.y);
      if (to && V.dist(to, p.location) > 4.2) { safe(() => w.e.teleport(to, { facingLocation: V.up(p.location, 1.6) })); if (chance(0.3)) playAt(dim, "goatwalker.hoof", to, 0.6, 0.8); }
    }
    this.watchCheck();
    if (!trigger) return;
    // the others were never there
    for (const w of this.decoys) if (w.ok) { particle(dim, `${NS}:ash_burst`, w.loc); playAt(dim, "goatwalker.glitch", V.up(w.loc, 1.5), 0.8); w.remove(); }
    this.decoys = [];
    const w = this.w, wr = wrathOf(this.s);
    if (wr >= 3 && chance(0.6) && strike(this)) return;
    playAt(dim, "goatwalker.laugh", V.up(w.loc, 2.2), 1.3);
    w.vanish({ ash: true, quick: true });
    addAnger(this.s, 3);
    this.finish(70);
  }
  finish(q) { for (const w of this.decoys) if (w && !w.dead) w.remove(); this.decoys = []; super.finish(q); }
}

// ------------------------------------------------------------------ TOO SLOW (attack): the chase you cannot win
// He does not run.  He walks.  And however fast you go, however far you get, he is already standing in front
// of you.  Every time he is nearer.  If you run into him he tears a piece out of you and is gone again.
// It lasts under a minute.  The only thing that buys you anything: stop, turn round, and look at him.
const TAUNTS = ["TOO SLOW.", "I AM ALREADY HERE.", "WHERE ARE YOU GOING?", "SLOWER.", "NOT FAST ENOUGH.", "I CAN SEE YOU.", "KEEP RUNNING.", "YOU CANNOT."];
/** somewhere about r blocks away in direction ang where you can see him (not behind a trunk): the chase is about being seen */
function inSight(p, ang, r, spread = 0.45) {
  const dim = p.dimension, from = eye(p);
  let any;
  for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
    const pos = standNear(p, ang + da, r, { spread: spread * 0.5 });
    if (!pos) continue;
    any = any || pos;
    if (lineClear(dim, from, V.up(pos, 2)) && lineClear(dim, from, V.up(pos, 1))) return pos;
  }
  return any;
}
export class TooSlow extends Enc {
  constructor(p, s, opts = {}) {
    super(p, s, "tooslow");
    this.opts = opts; this.blinks = 0; this.hits = 0; this.far = 0; this.lost = 0; this.stare = 0; this.flinch = 0;
    this.nextGo = 0; this.nextHit = 0; this.holdFor = 1; this.walkFor = 2.5; this.next = "walk"; this.sprints = 0;
  }
  get tier() { return "attack"; }
  begin() {
    const p = this.p, s = this.s;
    if (!survivalish(p) && !this.opts.force) return false;
    const yaw = viewYaw(p);
    const pos = inSight(p, yaw + Math.PI + rnd(-0.5, 0.5), 20) || inSight(p, yaw + rnd(-1, 1), 18);
    if (!pos) return false;
    this.w = new Walker(p);
    if (!this.w.spawn(pos, p.location)) return false;
    this.w.calm = false;
    this.w.setPose(10);
    this.len = this.opts.len || rnd(38, 52);
    pushFog(p, s, "tooslow");
    music(p, s, "goatwalker.music.tooslow");
    playFor(p, "goatwalker.riser", eye(p), 1.0);
    flash(p, "§4§lRUN", "", 34, 0, 10);
    shakeCam(p, 0.12, 1.2);
    s.lastChase = now();
    return true;
  }
  leash() { return Math.max(10.5, 19 - 1.5 * this.blinks); }
  tick() {
    const p = this.p, w = this.w;
    if (!alive(p)) return this.finish(60);
    if (!w || !w.ok) return this.finish(90);
    if (safe(() => p.getComponent("minecraft:health").currentValue, 20) <= 0) return this.finish(140);
    const dim = w.e.dimension, d = this.pd;
    if (this.state === "start") {                                  // he lets you look at him first
      if (this.inState > 2.4) { playAt(dim, "goatwalker.laugh", V.up(w.loc, 2.2), 1.5); w.setPose(0); this.walkFor = rnd(1.5, 2.5); this.go("walk"); }
      return;
    }
    if (this.state === "scared") {                                 // his face, a hand's breadth away
      if (this.inState > 0.75) this.afterCatch();
      return;
    }
    if (this.state === "end") {                                    // he lets you go.  This time.
      if (this.inState > 1.5) { if (w.ok) w.vanish({ ash: true, quick: true }); addAnger(this.s, -30); this.finish(150); }
      return;
    }
    if (this.age > this.len || this.hits >= 3) {
      const pos = standNear(p, viewYaw(p), 5, { spread: 0.3 });
      if (pos) blinkTo(w, pos, p.location, "goatwalker.appear");
      w.setPose(1);
      playAt(dim, "goatwalker.laugh", V.up(w.loc, 2.2), 1.5, 0.9);
      this.go("end");
      return;
    }
    if (d < 2.8 && now() >= this.nextHit) return this.catch_();
    if (this.state === "hold") {
      if (this.inState > this.holdFor) { if (this.next === "sprint") this.sprint(); else { w.setPose(0); this.walkFor = rnd(1.5, 3.5); this.go("walk"); } }
      return;
    }
    // ---- the rhythm: he walks at you (and you think you can get away), then drops to all fours and comes flat out
    if (this.state === "walk") {
      if (now() >= this.nextGo) { this.nextGo = now() + 10; w.go(p.location, "walk"); }
      w.step();
      if (this.inState > this.walkFor && d > 3.5) return this.sprint();
    } else if (this.state === "sprint") {
      if (now() >= this.nextGo) { this.nextGo = now() + 4; w.go(p.location, "dash"); }
      w.step();
      if (now() >= this.gallopAt) { this.gallopAt = now() + 24; playAt(dim, "goatwalker.gallop", w.loc, 1.6); }
      if (this.inState > 3.5) { w.setPose(10); this.walkFor = rnd(1.5, 3.5); this.go("walk"); }   // he stands up, and slows: he is enjoying this
    }
    // stand still and stare him down and he cannot bear it: he flinches away, and the whole thing ends sooner
    const { v, s: sp } = speedOf(p);
    const h = w.head();
    if (sp < 0.8 && h && staringAt(p, h, 0.965) && lineClear(dim, eye(p), h)) this.stare += this.state === "sprint" ? 0.2 : 0.1; else this.stare = Math.max(0, this.stare - 0.05);
    if (this.stare > 1.2 && d < 18) {
      this.stare = 0; this.flinch++; this.len -= 6;
      const pos = inSight(p, angleOf(V.sub(w.loc, p.location)) + rnd(-0.6, 0.6), 18);   // further off, but still where you can see him
      if (pos) blinkTo(w, pos, p.location, "goatwalker.glitch");
      if (this.flinch === 1) hint(p, "§8He cannot bear to be watched.");
      this.far = 0; this.lost = 0;
      this.holdFor = 1.2; this.go("hold");
      return;
    }
    // too far ahead, or out of his sight: he is already in front of you
    this.far = d > this.leash() ? this.far + 0.1 : 0;
    this.lost = lineClear(dim, eye(p), V.up(w.loc, 2)) ? 0 : this.lost + 0.1;
    if (this.far > 0.9 || this.lost > 2.2) {
      const dir = sp > 1.5 ? V.normH(v) : V.normH(p.getViewDirection());
      const pos = inSight(p, angleOf(dir), Math.max(6.5, 13 - 1.0 * this.blinks));
      this.far = 0; this.lost = 0;
      if (!pos) return;
      blinkTo(w, pos, p.location, "goatwalker.ahead", 1.4);
      w.setPose(10);
      this.blinks++;
      if (cfg().meta) flash(p, " ", `§4${TAUNTS[(this.blinks - 1) % TAUNTS.length]}`, 16, 0, 6);
      shakeCam(p, 0.1, 0.4);
      this.holdFor = 0.7; this.next = chance(0.6) ? "sprint" : "walk"; this.go("hold");   // and, as often as not, straight at you
    }
  }
  /** down on all fours, and flat out at you */
  sprint() {
    const p = this.p, w = this.w;
    this.sprints++;
    this.next = "walk";
    w.setPose(0);
    w.go(p.location, "dash");
    this.nextGo = now() + 4; this.gallopAt = now();
    if (this.sprints === 1 || chance(0.5)) playAt(w.e.dimension, chance(0.5) ? "goatwalker.scream" : "goatwalker.roar", V.up(w.loc, 2.2), 1.6, rnd(0.95, 1.1));
    shakeCam(p, 0.08, 0.5);
    this.go("sprint");
  }
  catch_() {
    const p = this.p, w = this.w, dim = w.e.dimension;
    this.hits++;
    this.nextHit = now() + 70;
    w.halt(); w.face(p.location, true); w.setPose(1);
    const scared = jumpscare(p, w.faceAt());                        // his face first
    if (!peaceful()) safe(() => p.applyDamage(4, { cause: "entityAttack", damagingEntity: w.e }));
    playAt(dim, "goatwalker.caught", V.up(w.loc, 1.6), 1.5);
    if (cfg().meta) flash(p, " ", "§4§lCAUGHT.", 14, 0, 6);
    if (scared) { this.go("scared"); return; }
    shakeCam(p, 0.3, 0.6);
    this.afterCatch();
  }
  afterCatch() {
    const p = this.p, w = this.w;
    const dir = V.normH(V.sub(p.location, w.loc));
    safe(() => p.applyKnockback({ x: dir.x * 1.3, z: dir.z * 1.3 }, 0.42));
    system.runTimeout(() => {                                      // and he is gone again: behind you, this time
      if (this.done || !w.ok || !alive(p)) return;
      const pos = standNear(p, viewYaw(p) + Math.PI, 13);
      if (pos) blinkTo(w, pos, p.location, "goatwalker.glitch", 0.9);
    }, 10);
    this.holdFor = 1.6; this.next = "walk"; this.go("hold");
  }
  finish(q) {
    popFog(this.p, this.s, "tooslow");
    if (this.s.music === "goatwalker.music.tooslow") music(this.p, this.s, "");
    super.finish(q);
  }
}

export const ENC_BY_NAME = {
  watch: [Watch, []], perch: [Watch, [true]], route: [Watch, [false, { route: true }]], peek: [Peek, []], gnaw: [Gnaw, []],
  follow: [Follow, []], stalk: [Stalk, []], breath: [Breath, []], roof: [Roof, []], snuff: [Snuff, []], flock: [Flock, []],
  ash: [AshTrail, []], bell: [SignBell, []], hooves: [SignHooves, []], gouge: [SignGouge, []], scream: [SignScream, []],
  knock: [SignKnock, []], door: [HomeVisit, []], shift: [EnvShift, []], daywatch: [DayWatch, []], treeline: [TreelineWalk, []],
  cave: [CaveWatch, []], standoff: [Standoff, []],
  // v3.0
  eyes: [Eyes, []], mimic: [Mimic, []], meta: [Meta, []], behind: [Behind, []], charge: [Charge, []], many: [Many, []],
  tooslow: [TooSlow, []], glimpse: [Glimpse, []],
};
