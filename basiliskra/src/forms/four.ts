/**
 * Basiliskra IV: the last form.  Upright, winged, far too big to care what is in front of him.
 *
 * He roams the world and what is in his way is gone; every footfall blows a crater; whatever lives is burned,
 * from as far off as he can see it.  And he has habits:
 *
 *   the stare        he looks at one player for a while, and that player can barely walk; it wears off
 *   1 the debut      his first roar comes after his first beam: a thin line cut across the ground, three
 *                    seconds of quiet, the line popping into glass one block at a time back toward him, a roar
 *   2 the pivot      the breath pushes him back on his heels; he drives the club into the ground, lifts the
 *                    foot on the side he means to go, and swings his whole body round the buried club
 *   3 the misfire    the shot dies in his mouth; both wings slam open and every vein discharges into the
 *                    ground behind him.  The one safe place is in front of his face
 *   4 the seabed     wading, he reaches down, digs in, and hauls the bottom of the sea up the beach
 *   5 the plate      a dorsal plate cracks off and stands in the ground; it lights when he charges, and when
 *                    you hide from his mouth he fires into the plate and it throws the beam at you
 *   6 the swallow    you reach cover while he charges; he shuts his mouth and carries the charge in his ribs,
 *                    walks round, and fires the moment he sees you.  On the third pulse up his neck he must
 *                    let it go, wherever he happens to be facing
 *
 * He is Basiliskra III grown: the same brain underneath (so the last crossing still sends him home), with
 * these on top.
 */
import { Entity, EntityDamageCause, Player, world } from "@minecraft/server";
import { BeamSpec, BeamState, beamTick, clearRange } from "../beam";
import { Act, Choice, anyoneNear, nearbyPlayers, wait, watchersNear } from "../brain";
import { CONFIG, CRYSTAL_BLOCK, PROP, SLAG_COLD_BLOCK, TICKS, TRINITITE_BLOCK } from "../config";
import { targetable } from "../creature";
import { addFallout, glassify } from "../fallout";
import { beamVars, flash, particle, sound, stopSound, witnesses } from "../fx";
import { STRIDE_IV } from "../generated/rig";
import { alive, blast, carve, wither } from "../havoc";
import { RoarFx, shake } from "../roar";
import { store } from "../store";
import { add, clamp, dist, distXZ, hash, leftOf, mul, norm, sub, turnTowards, wrapDeg, yawTo, type V3 } from "../vec";
import { NONE, UNLOADED, blockAt, clearLine, groundY, isLoaded, isSolidBlock, isWaterId, idAt } from "../world";
import { BrainThree, CHARGE_TICKS, LIGHT_END, PLANT_TICKS, Quarry, headOf, isPlayer } from "./three";

/** His breath: thicker, hotter and three times as long in the reach as it ever was. */
const SPEC: BeamSpec = { range: 150, radius: 2.4, damage: 11, width: 3.2, carve: 3.8, fallout: 6 };
/** The thin lines: his first beam, and what his wing veins throw. */
const THIN: BeamSpec = { range: 60, radius: 1.0, damage: 5, width: 0.55, carve: 1.2, fallout: 2 };
const BEAM_MIN = 18;
const FEET = ["foot_l", "foot_r"];
const VEINS = [0, 1, 2, 3].flatMap((k) => [`wing_vein_l${k}`, `wing_vein_r${k}`]);
const HALF = STRIDE_IV / 2;
/** The beam he fires: 7.75 s in all, as long as the recording; what happens when within it. */
const FIRE = 155, SKID_AT = 30, LIFT_AT = 55, SWEEP_AT = 79, SWEEP_END = 129;
/** How he carries a swallowed charge: one pulse up the neck every five seconds; on the third he must vent. */
const PULSE_TICKS = 100;
const PLATE_REACH = 70, PLATE_SHOTS = 3;

type Four = NonNullable<typeof store.rec.four>;

export class BrainFour extends BrainThree {
  private lastFailed = false;
  private heading = -1;

  constructor(c: ConstructorParameters<typeof BrainThree>[0]) {
    super(c);
    c.set(PROP.tier, 3);
    c.set(PROP.gill, !!this.four().plate);            // (on this form the gill flag hides the plate that has broken off)
  }

  private four(): Four {
    return (this.rec.four ??= { debut: false, shots: 0, plate: null });
  }

  tier(): 1 | 2 | 3 { return 3; }

  protected onFinish(): void {
    super.onFinish();
    this.c.bendHold = 0;
    this.c.wade = false;
  }

  protected choose(): Choice | null {
    const c = this.c, now = this.now, F = this.four();
    // the ending borrows him for a charge beside the seam, as it did when he was Basiliskra III
    if (this.wantCharge) { this.wantCharge = false; return { name: "charge", run: this.beam(null), limit: 40 * TICKS.second }; }
    if (!F.debut) return { name: "debut", run: this.debut(), limit: 60 * TICKS.second };
    const near = nearbyPlayers(c, 170);
    const mobs = this.creatures();
    if (!this.cooldown.has("rroar")) this.rest("rroar", (40 + 60 * hash(now, 91)) * TICKS.second);
    if (this.ready("rroar")) {
      this.rest("rroar", (70 + 120 * hash(now, 92)) * TICKS.second);
      if (hash(now, 93) < 0.6 && anyoneNear(c, 160)) return { name: "roar", run: this.roar(hash(now, 94) < 0.3), limit: 12 * TICKS.second };
    }
    if (now >= this.recoverUntil) {
      const eye = c.anchor("nose");
      // the stare
      if (this.ready("stare")) {
        const p = near.find((q) => dist(q.location, c.pos) <= 130 && clearLine(c.dim, eye, headOf(q)));
        if (p) { this.rest("stare", (55 + 40 * hash(now, 95)) * TICKS.second); return { name: "stare", run: this.stare(p), limit: 14 * TICKS.second }; }
      }
      // the seabed, when he stands in the shallows with somebody on the shore
      if (this.ready("drag")) {
        const shore = this.shoreVictim(near);
        if (shore) { this.rest("drag", 4 * TICKS.minute); return { name: "drag", run: this.dragSeabed(shore), limit: 30 * TICKS.second }; }
      }
      // the breath, from as far as he can see
      if (this.ready("beam")) {
        const mouth = c.anchor("mouth");
        for (const q of [...near, ...mobs] as Quarry[]) {
          const d = dist(q.location, mouth);
          if (d < BEAM_MIN || d > SPEC.range - 6) continue;
          if (clearLine(c.dim, mouth, headOf(q))) {
            this.rest("beam", 24 * TICKS.second);
            return { name: "beam", run: this.breath(q), limit: 90 * TICKS.second };
          }
          // hidden from his mouth, but not from the plate that stands in the ground
          if (isPlayer(q) && this.plateSees(q)) {
            this.rest("beam", 26 * TICKS.second);
            return { name: "beam", run: this.plateShot(q), limit: 45 * TICKS.second };
          }
        }
      }
    }
    // he walks at what lives; with nothing in sight, across the world
    const quarry: Quarry | undefined = near.find((p) => dist(p.location, c.pos) < 110) ?? mobs.sort((x, y) => dist(x.location, c.pos) - dist(y.location, c.pos))[0];
    if (quarry) return { name: "pursue", run: this.pursue(quarry), limit: 20 * TICKS.second };
    return { name: "roam", run: this.roam(), limit: 90 * TICKS.second };
  }

  // ---- two feet, and what is under them -----------------------------------------------------------------
  protected footfalls(): void {
    const c = this.c;
    c.walkPhase = (((this.beat - 1) & 1) + clamp((c.travelled - this.stepAt) / HALF, 0, 1.15)) * 180;
    if (c.travelled - this.stepAt < HALF) return;
    this.stepAt = c.travelled - this.stepAt < STRIDE_IV ? this.stepAt + HALF : c.travelled;
    const k = this.beat & 1;
    c.set(PROP.gait, k);
    const foot = add(c.anchor(FEET[k]), mul(c.forward, HALF * 0.5));
    this.beat++;
    this.rec.mut.overland += HALF;
    this.stomp({ x: foot.x, y: c.pos.y + 0.1, z: foot.z });
  }

  /** One foot coming down: the ground under it is blown out, like the Wither's, and whatever stood there with it. */
  private stomp(ground: V3): void {
    const c = this.c;
    sound(c.dim, "basiliskra.iii.step", ground, 128, 1, 0.66 + (this.beat & 1) * 0.04);
    particle(c.dim, "basiliskra:step_dust", ground, 96);
    particle(c.dim, "basiliskra:impact_ring", { x: ground.x, y: ground.y + 0.3, z: ground.z }, 128);
    for (const p of witnesses(c.dim, ground, 70)) {
      const f = 1 - dist(p.location, ground) / 70;
      try { p.runCommand(`camerashake add @s ${(0.08 + 0.3 * f).toFixed(2)} 0.3 positional`); } catch { /* the sound carries it */ }
    }
    blast(c.dim, ground, 8, 8, 20, 1.1, (p, n) => c.hurt(p, n), c.entity, ground);
    if (wither() && !c.afloat) {
      const got = carve(c.dim, { x: ground.x, y: ground.y - 0.6, z: ground.z }, 3.4, 150, false);
      if (got.broken > 20) particle(c.dim, "basiliskra:impact_debris", { x: ground.x, y: ground.y + 1, z: ground.z }, 96);
    }
  }

  protected *pursue(g: Quarry): Act {
    const c = this.c;
    const player = isPlayer(g);
    c.smash = true;
    for (let t = 0; t < 380; t++) {
      let at: V3;
      try { if (!g.isValid || g.dimension.id !== c.dim.id || (player && !targetable(g as Player))) break; at = g.location; } catch { break; }
      c.setPhase("move");
      c.goTo(at, 0.17, player ? 26 : 6);
      c.lookAt(at, 60, 40);
      this.footfalls();
      if (dist(at, c.pos) < (player ? 26 : 7)) break;
      if (t % 100 === 50) c.say("basiliskra.iii.grunt", c.anchor("nose"), 72, 1, 0.8 + hash(t) * 0.08);
      yield;
    }
    c.halt();
    c.smash = false;
  }

  /** He goes a long way in one direction before he thinks of another: across the world, not round a place. */
  protected *roam(): Act {
    const c = this.c;
    const near = watchersNear(c, 220);
    let target: V3;
    if (near.length && hash(this.now, 41) < 0.65) {
      // toward whoever is about, and on past them
      const p = near[0].location;
      const on = norm({ x: p.x - c.pos.x, y: 0, z: p.z - c.pos.z });
      target = { x: p.x + on.x * 30 + (hash(this.now, 42) - 0.5) * 50, y: p.y, z: p.z + on.z * 30 + (hash(this.now, 43) - 0.5) * 50 };
    } else {
      if (this.heading < 0) this.heading = hash(this.now, 44) * 360;
      this.heading = (this.heading + (hash(this.now, 45) - 0.5) * 70 + 360) % 360;
      const a = (this.heading * Math.PI) / 180;
      target = { x: c.pos.x - Math.sin(a) * 150, y: c.pos.y, z: c.pos.z + Math.cos(a) * 150 };
    }
    const got = yield* this.walk(target, 0.16, 10, 1700);
    if (!got) this.heading = (this.heading + 110 + 360) % 360;        // something he cannot pass: another way
    c.setPhase("idle");
    for (let t = 0; t < 90; t++) {
      if (t === 30) c.say(hash(this.now, 17) < 0.5 ? "basiliskra.iii.breath" : "basiliskra.iii.growl", c.anchor("nose"), 80, 0.9, 0.82);
      yield;
    }
  }

  /** His roar is the same roar, from a bigger chest: it reaches further and throws harder.  The wings open with it. */
  *roar(whole: boolean): Act {
    const c = this.c;
    c.halt();
    c.setPhase("roar");
    c.say(whole ? "basiliskra.roar" : "basiliskra.roar_short", c.anchor("mouth"), whole ? 192 : 160);
    const fx = new RoarFx(c, whole, whole ? 56 : 42, whole ? 9 : 6);
    const ticks = whole ? 160 : 88;
    for (let t = 0; t < ticks; t++) { fx.tick(); yield; }
    c.setPhase("idle");
  }

  private *turnTo(at: V3, rate = 1.2, limit = 240): Act {
    const c = this.c;
    for (let t = 0; t < limit; t++) {
      const want = yawTo(c.pos, at);
      if (Math.abs(wrapDeg(want - c.yaw)) < 2) break;
      c.yaw = turnTowards(c.yaw, want, rate);
      yield;
    }
  }

  // ---- the stare ------------------------------------------------------------------------------------------
  /** He looks at one player.  While he can see them they can barely walk; when he looks away, it wears off. */
  private *stare(p: Player): Act {
    const c = this.c;
    c.halt();
    c.setPhase("stare");
    c.say("basiliskra.iii.neck_turn", c.anchor("nose"), 96);
    let lost = 0, told = false;
    const peaceful = () => { try { return CONFIG.harmlessOnPeaceful && String(world.getDifficulty()).toLowerCase() === "peaceful"; } catch { return false; } };
    for (let t = 0; t < 170; t++) {
      let head: V3;
      try { if (!p.isValid || !targetable(p) || p.dimension.id !== c.dim.id) break; head = p.getHeadLocation(); } catch { break; }
      c.lookAt(head, 85, 50);
      if (t === 34) c.say("basiliskra.iii.growl", c.anchor("nose"), 96, 1, 0.78);
      if (t >= 14 && t % 10 === 4) {
        const sees = dist(head, c.pos) <= 140 && clearLine(c.dim, c.anchor("nose"), head);
        lost = sees ? 0 : lost + 1;
        if (lost >= 3) break;                               // you got something solid between you and his eye
        if (sees && !peaceful()) {
          try {
            p.addEffect("slowness", 50, { amplifier: 2, showParticles: false });
            if (!told) { told = true; p.onScreenDisplay.setActionBar("§cHe is looking at you."); p.playSound("basiliskra.iii.window_breath", { volume: 1 }); }
            p.runCommand("camerashake add @s 0.05 0.5 rotational");
          } catch { /* left */ }
        }
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
    yield* wait(20);
  }

  // ---- 1. his first roar comes after his first beam ----------------------------------------------------------
  private *debut(): Act {
    const c = this.c, F = this.four();
    c.halt();
    const who = watchersNear(c, 170)[0];
    const toward = who ? norm({ x: who.location.x - c.pos.x, y: 0, z: who.location.z - c.pos.z }) : c.forward;
    if (who) yield* this.turnTo(who.location, 1.5, 160);
    c.setPhase("look");
    // the line he will cut: across the ground between him and whoever is watching (or simply ahead)
    const reach = who ? clamp(distXZ(who.location, c.pos) - 8, 30, 70) : 46;
    const line: V3[] = [];
    for (let d = reach; d > reach - 26; d -= 1) {
      const x = c.pos.x + toward.x * d, z = c.pos.z + toward.z * d;
      const g = groundY(c.dim, x, z, c.pos.y + 24, 60);
      // (dry land only: if he stands in the sea the line is cut across the beach, and pops back toward the water)
      if (typeof g === "number" && !isWaterId(idAt(c.dim, { x, y: g, z }))) line.push({ x, y: g - 1, z });
    }
    if (line.length < 6) { F.debut = true; store.touch(); yield* this.roar(true); return; }
    yield* wait(24);
    // a thin red beam, with no sound from him at all, drawn along the line from the far end toward himself
    const st: BeamState = { ground: null };
    for (let t = 0; t < 52; t++) {
      const at = line[Math.min(line.length - 1, Math.floor((t / 52) * line.length))];
      const top = { x: at.x, y: at.y + 1, z: at.z };
      c.lookAt(top, 85, 60);
      const from = c.anchor("mouth");
      const dir = norm(sub(top, from));
      beamTick(c, { ...THIN, range: dist(from, top) + 2 }, t, 1, st, { from, dir, harmless: true });
      if (t % 2 === 0) particle(c.dim, "basiliskra:beam_impact", top, 128);
      if (t % 8 === 0) sound(c.dim, "basiliskra.iii.charge_tick", top, 96, 0.8, 1.5);
      yield;
    }
    c.lookAhead();
    // three seconds of quiet; the line glows
    for (let t = 0; t < 60; t++) {
      if (t % 6 === 0) for (let i = t % 12 === 0 ? 0 : 1; i < line.length; i += 2) particle(c.dim, "basiliskra:rad_glint", { x: line[i].x, y: line[i].y + 1.1, z: line[i].z }, 96);
      yield;
    }
    // it pops into glass, one block at a time, back toward him
    for (let i = 0; i < line.length; i++) {
      const at = line[i];
      const made = glassify(c.dim, at);
      particle(c.dim, made ? "basiliskra:crystal_break" : "basiliskra:rad_glint", { x: at.x, y: at.y + 1.2, z: at.z }, 96);
      sound(c.dim, "random.pop", at, 64, 1, 0.6 + (i / line.length) * 0.9);
      yield* wait(3);
    }
    addFallout(line[Math.floor(line.length / 2)], 5, 0.5);
    F.debut = true;
    store.touch();
    // and now he roars
    yield* this.roar(true);
    this.recoverUntil = this.now + 4 * TICKS.second;
  }

  // ---- the breath, and what can happen inside it ---------------------------------------------------------------
  private igniteAt(from: V3, dir: V3): void {
    const c = this.c;
    particle(c.dim, "basiliskra:muzzle_flash", from, 192);
    particle(c.dim, "basiliskra:muzzle_shock", from, 192, beamVars(dir, 1, 1));
    flash(c.dim, from, 80, { red: 1, green: 0.5, blue: 0.42 }, 0.03, 0.04, 0.3);
    shake(c, 128, 1.0, 0.5);
  }

  /** The plate that stands in the ground lights with the gap in his spine. */
  private plateGlow(t: number): void {
    const P = this.four().plate;
    if (!P || P.burnt || t % 10 !== 0) return;
    const top = { x: P.x + 0.5, y: P.y + 3, z: P.z + 0.5 };
    particle(this.c.dim, "basiliskra:impact_glare", top, 128);
    particle(this.c.dim, "basiliskra:rad_glint", { x: top.x, y: top.y + 2, z: top.z }, 96);
    if (t % 20 === 0) sound(this.c.dim, "basiliskra.iii.charge_tick", top, 64, 0.5, 0.7);
  }

  /**
   * He charges, following `aimAt` with his eye until the lock.  Returns "lock" when the charge is whole,
   * "cover" if the quarry got something solid between them while he was still following (see the swallow), and
   * "gone" if there is nothing left to fire at.
   */
  private *charge(target: Quarry | null, aimAt: () => V3, watchCover: boolean): Generator<void, "lock" | "cover" | "gone", void> {
    const c = this.c;
    const ok = () => { try { return !target || (target.isValid && target.dimension.id === c.dim.id); } catch { return false; } };
    c.halt();
    c.setPhase("charge");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 128);
    c.say("basiliskra.iii.charge", c.anchor("throat"), 160);
    this.chargeSounding = true;
    this.rodSeen.clear(); this.rodLayer = 0;
    for (let t = 0; t < PLANT_TICKS; t++) { c.setCharge(t / 7); if (ok()) c.aimAt(aimAt(), 80, 50); this.scanRods(); yield; }
    const light = LIGHT_END - PLANT_TICKS;
    let hidden = 0, lit = 1;
    for (let t = 0; t < light; t++) {
      if (!ok()) return "gone";
      const aim = aimAt();
      const off = c.aimAt(aim, 80, 50);
      if (off > 0) c.yaw = turnTowards(c.yaw, yawTo(c.pos, aim), 0.5);
      c.setCharge(2 + (t / light) * 13.4);
      const zone = Math.floor(c.charge / 2);
      if (zone > lit) { lit = zone; sound(c.dim, "basiliskra.iii.charge_tick", c.anchor(zone >= 6 ? "throat" : "club_core"), 96, 0.55, 0.6 + zone * 0.08); }
      if (t % 20 === 10) shake(c, 64, 0.14 + 0.24 * (t / light), 1.0);
      this.plateGlow(t);
      this.scanRods();
      // he sees you reach cover
      if (watchCover && target && t > 24 && t % 4 === 0) {
        hidden = clearLine(c.dim, c.anchor("mouth"), headOf(target)) ? 0 : hidden + 1;
        if (hidden >= 4) return "cover";
      }
      yield;
    }
    const lock = CHARGE_TICKS - LIGHT_END;
    for (let t = 0; t < lock; t++) {
      c.setCharge(16 + (t / lock) * 2);
      if (t % 2 === 0) {
        const { from, dir } = c.aim();
        particle(c.dim, "basiliskra:beam_aim", from, 160, beamVars(dir, clearRange(c, from, dir, SPEC.range), 0.3 + 0.7 * (t / lock)));
      }
      this.plateGlow(LIGHT_END + t);
      yield;
    }
    return "lock";
  }

  private cutCharge(): void {
    if (!this.chargeSounding) return;
    this.chargeSounding = false;
    stopSound(this.c.dim, "basiliskra.iii.charge", this.c.pos);
  }

  /** The breath at something he can see. */
  private *breath(target: Quarry): Act {
    const c = this.c, F = this.four();
    // a damaged plate cracks off his back the third time he draws breath, and stands where it falls
    if (!F.plate && F.shots >= 2) yield* this.shedPlate();
    const got = yield* this.charge(target, () => headOf(target), isPlayer(target) && this.ready("swallow"));
    if (got === "gone") { this.cutCharge(); return; }
    if (got === "cover") { this.rest("swallow", 3 * TICKS.minute); yield* this.swallow(target as Player); return; }
    // a lightning rod by his club still robs him of it
    const rod = this.findRod();
    if (rod && clearLine(c.dim, this.clubTop(), { x: rod.x + 0.5, y: rod.y + 1.2, z: rod.z + 0.5 })) {
      this.cutCharge();
      yield* this.ground(rod);
      this.recoverUntil = this.now + 8 * TICKS.second;
      return;
    }
    // now and then the shot dies in his mouth (never twice running, never his first)
    if (!this.lastFailed && F.shots >= 1 && hash(this.now, 96) < 0.22) { this.lastFailed = true; yield* this.misfire(); return; }
    this.lastFailed = false;
    yield* this.fire(target);
    yield* this.vent();
    yield* this.roar(hash(this.now, 61) < 0.3);
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
    yield* wait(30);
  }

  /** 2. The shot, the skid, and the turn on the buried club. */
  private *fire(target: Quarry | null): Act {
    const c = this.c, F = this.four();
    c.setPhase("fire");
    c.setCharge(20);
    F.shots++; this.rec.mut.beams++; this.rec.mut.lastEncounter = this.now;
    this.chargeSounding = false;
    c.say("basiliskra.iii.beam", c.anchor("mouth"), 192);
    { const { from, dir } = c.aim(); this.igniteAt(from, dir); }
    const st: BeamState = { ground: null };
    const live = () => { try { return !!target && target.isValid && target.dimension.id === c.dim.id && (!isPlayer(target) || targetable(target as Player)); } catch { return false; } };
    let side = 0;                               // which way he will swing: +1 to his left, -1 to his right
    let pivot: V3 | null = null;                // the club, in the ground
    for (let t = 0; t < FIRE; t++) {
      const fade = t < FIRE - 16 ? 1 : (FIRE - t) / 16;
      if (t < SKID_AT) {
        // his head follows, slowly: stepping out of the line still works
        if (live()) {
          const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target!.location) - c.yaw), -80, 80);
          c.lookYaw += clamp(want - c.lookYaw, -0.3, 0.3);
        }
      } else if (t < LIFT_AT) {
        // the breath shoves him backward on his heels
        if (t === SKID_AT) { c.setPhase("skid"); c.say("basiliskra.iii.grunt", c.anchor("nose"), 96, 1, 0.74); }
        const back = mul(c.forward, -0.07);
        const to = { x: c.pos.x + back.x, y: c.pos.y, z: c.pos.z + back.z };
        if (isLoaded(c.dim, to) && typeof groundY(c.dim, to.x, to.z, c.pos.y + 4, 10) === "number") c.pos = to;
        if (t % 3 === 0) for (const h of ["heel_l", "heel_r"]) particle(c.dim, "basiliskra:step_dust", { ...c.anchor(h), y: c.pos.y + 0.2 }, 96);
      } else if (t < SWEEP_AT) {
        // he drives the club in, and the foot on the side he means to go comes off the ground: read it
        if (t === LIFT_AT) {
          const bearing = live() ? wrapDeg(yawTo(c.pos, target!.location) - (c.yaw + c.lookYaw)) : (hash(this.now, 97) - 0.5);
          side = bearing >= 0 ? 1 : -1;
          pivot = c.anchor("club_core");
          c.setPhase("pivot");
          c.bendHold = 30 * side;
          c.say("basiliskra.iii.club_plant", pivot, 128, 1, 0.8);
          particle(c.dim, "basiliskra:impact_ring", { x: pivot.x, y: c.pos.y + 0.3, z: pivot.z }, 128);
          shake(c, 96, 0.5, 0.4);
        }
      } else if (t < SWEEP_END && pivot) {
        // one enormous sideways step: his whole body swings round the buried club, and the beam with it
        const step = 1.4 * side;
        const a = (step * Math.PI) / 180;
        const rx = c.pos.x - pivot.x, rz = c.pos.z - pivot.z;
        const to = { x: pivot.x + rx * Math.cos(a) - rz * Math.sin(a), y: c.pos.y, z: pivot.z + rx * Math.sin(a) + rz * Math.cos(a) };
        if (isLoaded(c.dim, to)) { c.pos = to; c.yaw = wrapDeg(c.yaw + step); }
        if (t % 12 === 0) this.stomp({ ...c.anchor(side > 0 ? "foot_r" : "foot_l"), y: c.pos.y + 0.1 });
      } else if (t === SWEEP_END && pivot) {
        // he rips the club free: do not be standing by it
        c.setPhase("fire");
        c.bendHold = 0;
        sound(c.dim, "mob.wither.break_block", pivot, 128, 1, 0.5);
        particle(c.dim, "basiliskra:impact_debris", { x: pivot.x, y: c.pos.y + 1, z: pivot.z }, 128);
        particle(c.dim, "basiliskra:impact_ring", { x: pivot.x, y: c.pos.y + 0.3, z: pivot.z }, 128);
        blast(c.dim, { x: pivot.x, y: c.pos.y + 1, z: pivot.z }, 9, 9, 18, 1.3, (p, n) => c.hurt(p, n), c.entity);
        if (wither()) carve(c.dim, { x: pivot.x, y: c.pos.y, z: pivot.z }, 3, 120, false);
      }
      beamTick(c, SPEC, t, fade, st, { scorch: (hit) => this.scorch(hit) });
      if (t % 10 === 0) shake(c, 96, 0.4 * fade + 0.1, 0.6);
      yield;
    }
    c.bendHold = 0;
  }

  // ---- 3. the misfire: his wings take the recoil -----------------------------------------------------------------
  private *misfire(): Act {
    const c = this.c;
    this.cutCharge();                                            // the sound cuts out
    c.setPhase("recoil");
    c.say("basiliskra.iii.fizzle", c.anchor("mouth"), 128);
    c.setCharge(8);
    shake(c, 96, 0.7, 0.5);
    const f = c.forward, l = leftOf(c.yaw);
    const states: BeamState[] = VEINS.map(() => ({ ground: null }));
    for (let t = 0; t < 96; t++) {
      // each vein throws a thin line into the ground behind him, fanned out: in front of his face nothing falls
      if (t >= 16 && t < 80) {
        for (let k = 0; k < VEINS.length; k++) {
          if (t < 16 + k * 2 || (t + k) % 2) continue;
          const sgn = k % 2 === 0 ? 1 : -1, out = 0.2 + 0.22 * Math.floor(k / 2);
          const from = c.anchor(VEINS[k]);
          const dir = norm({ x: -f.x * 0.7 + l.x * sgn * out, y: -0.62, z: -f.z * 0.7 + l.z * sgn * out });
          beamTick(c, THIN, t + k * 3, 1, states[k], { from, dir, scorch: (hit) => this.scorch(hit) });
        }
        if (t % 12 === 0) sound(c.dim, "basiliskra.ii.arc", c.anchor(VEINS[(t / 12) % VEINS.length | 0]), 96, 1, 0.7);
      }
      c.setCharge(Math.max(0, 8 - t * 0.09));
      yield;
    }
    c.setCharge(0);
    c.setPhase("idle");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 96, 1, 0.8);
    this.recoverUntil = this.now + 5 * TICKS.second;
    yield* wait(40);
  }

  // ---- 6. the beam he swallows ----------------------------------------------------------------------------------
  private *swallow(target: Player): Act {
    const c = this.c;
    this.cutCharge();
    c.setPhase("swallow");
    c.say("basiliskra.iii.fizzle", c.anchor("mouth"), 96, 1, 0.7);
    c.lookAhead();
    for (let t = 0; t < 36; t++) { c.setCharge(Math.max(0, 16 - t * 0.5)); yield; }       // the glow goes back down his throat, and out everywhere but his ribs
    let last: V3 = { ...target.location };
    let pulses = 0;
    c.smash = true;
    for (let t = 1; pulses < 3; t++) {
      let seen = false;
      try {
        if (target.isValid && targetable(target) && target.dimension.id === c.dim.id) {
          const mouth = c.anchor("mouth");
          seen = dist(target.location, mouth) < SPEC.range - 6 && dist(target.location, mouth) > 10 && clearLine(c.dim, mouth, headOf(target));
          if (seen) last = { ...target.location };
        }
      } catch { /* left */ }
      // he comes round the hill with his mouth dark, and fires the instant he sees you
      if (seen && Math.abs(wrapDeg(yawTo(c.pos, last) - c.yaw)) < 70) break;
      c.setPhase("carry");
      c.goTo(last, 0.17, 12);
      this.footfalls();
      if (t % PULSE_TICKS === 0) {
        pulses++;
        c.pulse(11);                                              // a red pulse climbs his neck
        c.say("basiliskra.knock.vent", c.anchor("throat"), 96, 1, 0.8 + pulses * 0.1);
        shake(c, 64, 0.3, 0.3);
      }
      yield;
    }
    c.halt();
    c.smash = false;
    // on the third pulse he must open his mouth, wherever he is facing: lead him to face the sea
    const forced = pulses >= 3;
    let live = false;
    try { live = target.isValid && target.dimension.id === c.dim.id; } catch { live = false; }
    c.lookAhead();
    yield* this.snapShot(!forced && live ? target : null, 72);
    yield* this.vent();
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
  }

  /** A shot with no warning but the pulse: what he was already carrying. */
  private *snapShot(target: Quarry | null, ticks: number): Act {
    const c = this.c, F = this.four();
    c.setPhase("fire");
    c.setCharge(20);
    // (the muzzle is laid on them in the pose he fires in: his head sits differently with his mouth open)
    try { if (target && target.isValid) c.aimAt(headOf(target), 80, 50); } catch { /* gone */ }
    F.shots++; this.rec.mut.beams++; this.rec.mut.lastEncounter = this.now;
    c.say("basiliskra.iii.beam", c.anchor("mouth"), 192);
    { const { from, dir } = c.aim(); this.igniteAt(from, dir); }
    const st: BeamState = { ground: null };
    for (let t = 0; t < ticks; t++) {
      const fade = t < ticks - 12 ? 1 : (ticks - t) / 12;
      try {
        if (target && target.isValid) {
          const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
          c.lookYaw += clamp(want - c.lookYaw, -0.25, 0.25);
        }
      } catch { /* gone */ }
      beamTick(c, SPEC, t, fade, st, { scorch: (hit) => this.scorch(hit) });
      if (t % 10 === 0) shake(c, 96, 0.4 * fade + 0.1, 0.6);
      yield;
    }
    stopSound(c.dim, "basiliskra.iii.beam", c.pos);
  }

  // ---- 5. the plate that keeps charging --------------------------------------------------------------------------
  private plateBlocks(P: { x: number; y: number; z: number }): V3[] {
    // point-first in the ground, taller than a player: a spine of five with shoulders at the third and fourth
    const out: V3[] = [];
    for (let h = 0; h < 5; h++) out.push({ x: P.x, y: P.y + h, z: P.z });
    out.push({ x: P.x + 1, y: P.y + 2, z: P.z }, { x: P.x - 1, y: P.y + 3, z: P.z }, { x: P.x + 1, y: P.y + 3, z: P.z });
    return out;
  }

  private *shedPlate(): Act {
    const c = this.c, F = this.four();
    const from = c.anchor("plate_break");
    const l = leftOf(c.yaw), f = c.forward;
    // it lands beside and behind him, clear of his feet
    const spot = { x: Math.floor(c.pos.x + l.x * 15 - f.x * 9), z: Math.floor(c.pos.z + l.z * 15 - f.z * 9) };
    const g = groundY(c.dim, spot.x + 0.5, spot.z + 0.5, c.pos.y + 20, 50);
    if (typeof g !== "number") return;
    const P = { x: spot.x, y: g, z: spot.z, uses: 0, burnt: false };
    c.set(PROP.gill, true);                                       // it is gone from his back
    sound(c.dim, "random.glass", from, 128, 1, 0.5);
    sound(c.dim, "basiliskra.iii.ground", from, 128, 1, 0.8);
    particle(c.dim, "basiliskra:impact_fountain", from, 160);
    c.say("basiliskra.hurt", c.anchor("nose"), 96, 1, 0.8);
    // it falls
    const top = { x: P.x + 0.5, y: P.y + 2.5, z: P.z + 0.5 };
    for (let t = 0; t < 18; t++) {
      const k = t / 18;
      particle(c.dim, "basiliskra:impact_glare", { x: from.x + (top.x - from.x) * k, y: from.y + (top.y - from.y) * k * k, z: from.z + (top.z - from.z) * k }, 160);
      yield;
    }
    if (CONFIG.terrain !== "none") {
      for (const b of this.plateBlocks(P)) {
        const at = blockAt(c.dim, b);
        if (!at || (isSolidBlock(at) && at.typeId !== CRYSTAL_BLOCK)) continue;
        try { at.setType(TRINITITE_BLOCK); } catch { try { at.setType("minecraft:red_nether_brick"); } catch { /* protected */ } }
      }
    }
    sound(c.dim, "mob.wither.break_block", top, 128, 1, 0.6);
    particle(c.dim, "basiliskra:impact_ring", { x: top.x, y: P.y + 0.3, z: top.z }, 128);
    particle(c.dim, "basiliskra:impact_debris", top, 128);
    blast(c.dim, top, 5, 6, 12, 0.9, (p, n) => c.hurt(p, n), c.entity);
    F.plate = P;
    store.touch();
    yield* wait(20);
  }

  private plateTop(): V3 | null {
    const P = this.four().plate;
    return P && !P.burnt ? { x: P.x + 0.5, y: P.y + 5.3, z: P.z + 0.5 } : null;       // just clear of its tip
  }

  /** Can the plate see someone his mouth cannot? */
  private plateSees(q: Quarry): boolean {
    const top = this.plateTop();
    if (!top) return false;
    const c = this.c;
    const mouth = c.anchor("mouth");
    return dist(top, mouth) <= PLATE_REACH && dist(top, q.location) <= 60 && dist(top, q.location) > 3
      && clearLine(c.dim, mouth, { x: top.x, y: top.y + 0.8, z: top.z }) && clearLine(c.dim, top, headOf(q));
  }

  /** He fires into his own broken plate, and it throws the beam at whoever sheltered from his mouth. */
  private *plateShot(target: Player): Act {
    const c = this.c, F = this.four();
    const top = this.plateTop();
    if (!top || !F.plate) return;
    const got = yield* this.charge(null, () => top, false);
    if (got !== "lock") { this.cutCharge(); return; }
    c.setPhase("fire");
    c.setCharge(20);
    F.shots++; this.rec.mut.beams++; this.rec.mut.lastEncounter = this.now;
    this.chargeSounding = false;
    c.say("basiliskra.iii.beam", c.anchor("mouth"), 192);
    { const { from, dir } = c.aim(); this.igniteAt(from, dir); }
    // where it leaves the broken face is fixed at the moment he fires: move, and it misses
    let aim: V3 = top;
    try { aim = headOf(target); } catch { /* gone */ }
    const out = norm(sub(aim, top));
    const a: BeamState = { ground: null }, b: BeamState = { ground: null };
    for (let t = 0; t < 110; t++) {
      const fade = t < 96 ? 1 : (110 - t) / 14;
      const from = c.anchor("mouth");
      const leg = sub(top, from);
      beamTick(c, { ...SPEC, range: Math.hypot(leg.x, leg.y, leg.z) }, t, fade, a, { from, dir: norm(leg), harmless: true });
      beamTick(c, { ...SPEC, range: 70, width: SPEC.width * 0.7 }, t + 1, fade, b, { from: top, dir: out, scorch: (hit) => this.scorch(hit) });
      if (t % 4 === 0) particle(c.dim, "basiliskra:impact_glare", top, 160);
      if (t % 10 === 0) shake(c, 96, 0.4 * fade + 0.1, 0.6);
      yield;
    }
    stopSound(c.dim, "basiliskra.iii.beam", c.pos);
    F.plate.uses++;
    if (F.plate.uses >= PLATE_SHOTS) {
      // burnt out: it stays, blackened, a landmark
      F.plate.burnt = true;
      for (const q of this.plateBlocks(F.plate)) {
        const at = blockAt(c.dim, q);
        if (at && at.typeId === TRINITITE_BLOCK) { try { at.setType(SLAG_COLD_BLOCK); } catch { try { at.setType("minecraft:blackstone"); } catch { /* protected */ } } }
      }
      sound(c.dim, "random.fizz", top, 96, 1, 0.6);
      particle(c.dim, "basiliskra:impact_smoke", top, 128);
    }
    store.touch();
    yield* this.vent();
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
  }

  // ---- 4. he drags the seabed ashore ------------------------------------------------------------------------------
  /** Standing in the shallows, with somebody on dry land ahead: who the wave is for. */
  private shoreVictim(near: Player[]): Player | null {
    const c = this.c;
    const feet = idAt(c.dim, { x: c.pos.x, y: c.pos.y + 1.2, z: c.pos.z });
    if (!isWaterId(feet)) return null;
    for (const p of near) {
      const d = distXZ(p.location, c.pos);
      if (d < 24 || d > 90) continue;
      const under = idAt(c.dim, { x: p.location.x, y: p.location.y - 0.5, z: p.location.z });
      if (under && !isWaterId(under) && under !== "minecraft:air") return p;
    }
    return null;
  }

  private *dragSeabed(p: Player): Act {
    const c = this.c;
    c.halt();
    let goal: V3 = { ...c.pos };
    try { goal = { ...p.location }; } catch { return; }
    yield* this.turnTo(goal, 1.2, 200);
    c.setPhase("drag");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.74);
    const f = c.forward, l = leftOf(c.yaw);
    // he reaches down and digs in; the water round his hands goes black
    for (let t = 0; t < 84; t++) {
      if (t % 5 === 0) for (const h of ["hand_l", "hand_r"]) { const at = c.anchor(h); particle(c.dim, "basiliskra:surge", { x: at.x, y: c.pos.y + 1, z: at.z }, 96); }
      if (t % 20 === 10) shake(c, 80, 0.2 + t * 0.004, 0.8);
      yield;
    }
    // he hauls both arms to his chest: a broad front of black water, gravel and weed races up the beach
    c.say("basiliskra.roar_short", c.anchor("mouth"), 160);
    sound(c.dim, "random.explode", add(c.pos, mul(f, 14)), 128, 1, 0.5);
    shake(c, 128, 0.9, 0.8);
    const WIDTH = 17, REACH = Math.min(70, distXZ(goal, c.pos) + 22), SPEED = 1.3;
    const swept = new Set<string>();
    let boats = 0;
    let end: V3 = { ...c.pos };
    for (let t = 0; t * SPEED < REACH; t++) {
      const d = 12 + t * SPEED;
      const mid = { x: c.pos.x + f.x * d, z: c.pos.z + f.z * d };
      // the front follows the ground: up the beach and over what stands on it
      const gy = groundY(c.dim, mid.x, mid.z, c.pos.y + 16, 30);
      const y = typeof gy === "number" ? gy : c.pos.y + 1;
      end = { x: mid.x, y, z: mid.z };
      for (let w = -WIDTH; w <= WIDTH; w += 3) {
        const at = { x: mid.x + l.x * w, z: mid.z + l.z * w };
        const g = groundY(c.dim, at.x, at.z, y + 8, 16);
        if (g === UNLOADED || g === NONE) continue;
        const here = { x: at.x, y: (g as number) + 0.4, z: at.z };
        particle(c.dim, (t + w) % 2 ? "basiliskra:surge" : "basiliskra:surge_spray", here, 128);
      }
      if (t % 6 === 0) sound(c.dim, "basiliskra.splash", { x: mid.x, y, z: mid.z }, 96, 1, 0.7);
      // everything in its path is swept inland
      try {
        for (const e of c.dim.getEntities({ location: { x: mid.x, y, z: mid.z }, maxDistance: WIDTH + 4 })) {
          try {
            if (e.id === c.entity.id || swept.has(e.id) || e.typeId === "minecraft:item") continue;
            const rel = sub(e.location, { x: c.pos.x, y: e.location.y, z: c.pos.z });
            const along = rel.x * f.x + rel.z * f.z, across = rel.x * l.x + rel.z * l.z;
            if (Math.abs(along - d) > 3 || Math.abs(across) > WIDTH || Math.abs(e.location.y - y) > 7) continue;
            if (this.sweep(e, f)) { swept.add(e.id); if (/boat/.test(e.typeId)) boats++; }
          } catch { /* gone */ }
        }
      } catch { /* unloading */ }
      yield;
    }
    // what it leaves behind: a boat on the road, and a cod flapping beside it
    try {
      const at = { x: end.x, y: end.y + 0.6, z: end.z };
      if (isLoaded(c.dim, at)) {
        if (!boats) c.dim.spawnEntity("minecraft:boat", at);
        c.dim.spawnEntity("minecraft:cod", { x: at.x + 1.5, y: at.y, z: at.z + 0.5 });
        c.dim.spawnEntity("minecraft:cod", { x: at.x - 4, y: at.y, z: at.z - 3 });
      }
    } catch { /* the game would not have them there */ }
    c.setPhase("idle");
    this.recoverUntil = this.now + 5 * TICKS.second;
    yield* wait(50);
  }

  /** One thing caught by the wave.  True if it was moved. */
  private sweep(e: Entity, f: V3): boolean {
    const c = this.c;
    if (e.typeId === "minecraft:player") {
      const p = e as Player;
      if (!targetable(p)) return false;
      c.hurt(p, 5, EntityDamageCause.entityAttack);
      try { p.applyKnockback({ x: f.x * 3.4, z: f.z * 3.4 }, 0.7); } catch { /* immune */ }
      try { p.runCommand("camerashake add @s 0.6 0.6 positional"); } catch { /* no commands */ }
      return true;
    }
    if (/boat|minecart/.test(e.typeId)) {
      // boats are shoved inland
      try { e.applyImpulse({ x: f.x * 2.2, y: 0.55, z: f.z * 2.2 }); return true; } catch { return false; }
    }
    if (!alive(e)) return false;
    try { e.applyKnockback({ x: f.x * 3, z: f.z * 3 }, 0.6); e.applyDamage(6, { cause: EntityDamageCause.entityAttack, damagingEntity: c.entity }); return true; } catch { return false; }
  }
}
