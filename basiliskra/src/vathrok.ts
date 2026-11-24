/**
 * Vathrok (2.0): the other kaiju.
 *
 * The owner asked for "a mobzilla like kaiju" (a giant four-legged reptile of the kind) with two versions, each
 * turned on or off in the settings.  It is an animal of its own, not Basiliskra and not part of his story: it walks
 * on four legs as Basiliskra III does (the same walk, its own body: long arms on their knuckles, high shoulders, a
 * long low head, one row of green crystal spines), and it breathes a green corroding breath of its own.
 *
 *  - Vathrok (`basiliskra:vathrok`), met in survival: it comes up out of the ground now and then at night near a
 *    player, and whenever its lure is used.  It can be beaten (VATHROK_BOSS_HEALTH, a boss bar); it leaves its scales
 *    and its heart.  Setting `vathrok`.
 *  - The Vathrok Titan (`basiliskra:vathrok_titan`), for battles: as strong as the Titan (its health, its blows of
 *    100,000, its immunities).  Made with its egg, /basiliskra:vathrok titan or the config wheel; up to three.
 *    Setting `vathrokTitan`.
 *
 * What either fights, in this order: another giant (a Titan, Basiliskra, another Vathrok, another add-on's monster
 * with a giant's health); then players in Survival or Adventure; then creatures.  The battle one goes for giants
 * from as far as it can see them; the survival one for players first.
 */
import { Dimension, Entity, EntityDamageCause, ItemStack, MolangVariableMap, Player, world } from "@minecraft/server";
import { beamTick, clearRange, type BeamSpec, type BeamState } from "./beam";
import type { Act, Choice } from "./brain";
import { nearbyPlayers } from "./brain";
import { CONFIG, OVERWORLD, PROP, TICKS, VATHROK, VATHROK_HEART_ITEM, VATHROK_SCALE_ITEM, VATHROK_TITAN } from "./config";
import { Creature, giants, otherGiants, targetable } from "./creature";
import { BrainThree, aimOf, isPlayer } from "./forms/three";
import { beamVars, particle, players, sound, stopSound, witnesses } from "./fx";
import { VATHROK_BOSS_HEALTH, VATHROK_HEALTH } from "./generated/rig";
import { blast, carve, foreignGiantsNear, mobsNear, wither } from "./havoc";
import { RoarFx, shake } from "./roar";
import { freshRecord, store, type Rec } from "./store";
import { BLOW, GIANT, LETHAL } from "./titan";
import { add, dist, distXZ, forwardOf, hash, leftOf, mul, norm, sub, turnTowards, wrapDeg, yawTo, type V3 } from "./vec";
import { clearLine, groundY, isLoaded } from "./world";

export { VATHROK_HEALTH, VATHROK_BOSS_HEALTH };
/** How many of each may stand in the world at once. */
export const VATHROK_MAX = { boss: 1, battle: 3 };
const ROMAN = ["I", "II", "III", "IV", "V"];
/** The battle one's breath: the Titan's, in green (it corrodes; it leaves no fallout). */
const BATTLE_SPEC: BeamSpec = { range: 220, radius: 3.4, damage: 30 * GIANT, width: 4.2, carve: 5.0, fallout: 0 };
/** The survival one's: nearly as far as Basiliskra IV's, a little weaker. */
const BOSS_SPEC: BeamSpec = { range: 130, radius: 2.2, damage: 8, width: 3.4, carve: 3.2, fallout: 0 };
/** What the survival one's body does to a player (before the damage setting) and to another giant. */
const BOSS_HIT = { bite: 18, claws: 15, tail: 16, ram: 20 };
const BOSS_BLOW = { lunge: 60, tail: 90, ram: 80, swipe: 70 };
const TAG = "bk:vathrok";
const PROWL = 70;
/** Where the next survival Vathrok may come by itself, at the earliest (world clock, saved with the world). */
const NEXT_KEY = "bk:vathrok_next";

type Saved = { n: number; home: [number, number, number] };
/** What it is fighting: another giant (with a body of hit volumes), or something else alive. */
type Foe = { giant: Creature | null; e: Entity };

export class BrainVathrok extends BrainThree {
  dying = false;
  gone = false;
  private reeling = false;
  readonly battle: boolean;
  home: V3;
  private breathSpec: BeamSpec;
  private bigAt = -999;
  private big: Entity[] = [];
  private chargeOn = false;

  constructor(c: Creature, own: Rec, home: V3, battle: boolean) {
    super(c, own);
    this.battle = battle;
    this.home = { ...home };
    this.breathSpec = battle ? BATTLE_SPEC : BOSS_SPEC;
    this.giantSight = battle ? 240 : 140;
    this.voices = { step: "basiliskra.vathrok.step", grunt: "basiliskra.vathrok.huff" };
    c.set(PROP.gill, false);
  }

  onBlow(_by: Creature, _amount: number, heavy: boolean): void {
    this.hurtAt = this.now;
    if (heavy && this.ready("reel")) { this.rest("reel", 5 * TICKS.second); this.reeling = true; }
  }

  protected onFinish(): void {
    super.onFinish();
    if (this.chargeOn) { this.chargeOn = false; stopSound(this.c.dim, "basiliskra.vathrok.charge", this.c.pos); }
  }

  private n(blow: keyof typeof BLOW): number { return this.battle ? BLOW[blow] : BOSS_BLOW[blow]; }
  private hit(kind: keyof typeof BOSS_HIT): number { return this.battle ? LETHAL : BOSS_HIT[kind]; }

  /** The nearest giant of ours that is not itself (the survival one minds only those that come near). */
  foe(): Creature | null {
    let best: Creature | null = null, bd = this.battle ? this.giantSight : 110;
    for (const g of otherGiants(this.c)) {
      const d = dist(g.pos, this.c.pos);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  /** Whatever else it goes for: another add-on's giant, players (the survival one: these first), creatures. */
  private quarry(): Entity | null {
    const c = this.c;
    if (this.now - this.bigAt >= 40) { this.bigAt = this.now; this.big = foreignGiantsNear(c.dim, c.pos, this.giantSight); }
    const alive = (e: Entity) => { try { return e.isValid; } catch { return false; } };
    const big = this.big.filter(alive);
    const near = nearbyPlayers(c, this.battle ? 170 : 160);
    const order = this.battle ? [big, near] : [near, big];
    for (const list of order) if (list.length) return list[0];
    if (!CONFIG.huntMobs) return null;
    const mobs = mobsNear(c.dim, c.pos, 90).filter((e) => !giants.has(e.id));
    mobs.sort((a, b) => dist(a.location, c.pos) - dist(b.location, c.pos));
    return mobs[0] ?? null;
  }

  protected interrupt(): Choice | null {
    if (this.dying) return this.actName === "fall" ? null : { name: "fall", run: this.fall(), limit: 12 * TICKS.second };
    if (this.reeling) {
      this.reeling = false;
      if (["charge", "fire", "roar", "vent", "fall", "swipe"].includes(this.c.phase)) return null;
      return { name: "reel", run: this.reel(), limit: 3 * TICKS.second };
    }
    return null;
  }

  protected choose(): Choice | null {
    const c = this.c, now = this.now;
    const g = this.foe();
    const e = g ? g.entity : this.quarry();
    if (!e) {
      if (this.ready("rroar") && hash(now, 93) < 0.35) { this.rest("rroar", (60 + 80 * hash(now, 92)) * TICKS.second); return { name: "roar", run: this.vroar(), limit: 10 * TICKS.second }; }
      return { name: "roam", run: this.roam(), limit: 60 * TICKS.second };
    }
    const foe: Foe = { giant: g, e };
    const at = this.where(foe);
    const d = distXZ(at, c.pos), reach = c.girth + (g ? g.girth : 2);
    const bearing = wrapDeg(yawTo(c.pos, at) - c.yaw);
    // it lets a new enemy know
    if (e.id !== this.lastQuarry) {
      this.lastQuarry = e.id;
      if (this.ready("lockroar")) { this.rest("lockroar", 40 * TICKS.second); return { name: "lock", run: this.challenge(foe), limit: 12 * TICKS.second }; }
    }
    if (d < reach + 14) {
      // in reach: the tail for what is beside or behind it, jaws and claws for what is in front
      if (Math.abs(bearing) > 55 && this.ready("tail")) { this.rest("tail", 6 * TICKS.second); return { name: "tail", run: this.tail(bearing >= 0 ? 1 : -1), limit: 4 * TICKS.second }; }
      if (this.ready("lunge")) { this.rest("lunge", 3.5 * TICKS.second); return { name: "lunge", run: this.lunge(foe), limit: 5 * TICKS.second }; }
      if (Math.abs(bearing) <= 60 && this.ready("swipe")) { this.rest("swipe", 6 * TICKS.second); return { name: "swipe", run: this.rake(foe), limit: 4 * TICKS.second }; }
      if (g && this.ready("circle") && this.ready("tail")) { this.rest("circle", 9 * TICKS.second); return { name: "circle", run: this.circle(g), limit: 8 * TICKS.second }; }
    }
    // the breath: from as far as it reaches, never in the face of something already in reach
    if (this.ready("beam") && now >= this.recoverUntil && d < this.breathSpec.range - 10 && d >= reach + 10) {
      if (clearLine(c.dim, c.anchor("mouth"), g ? g.middle() : aimOf(e))) {
        this.rest("beam", 15 * TICKS.second);
        return { name: "beam", run: this.breath(foe), limit: 20 * TICKS.second };
      }
    }
    if (g && d > reach + 34 && this.ready("ram")) { this.rest("ram", 22 * TICKS.second); return { name: "ram", run: this.ram(g), limit: 30 * TICKS.second }; }
    if (d >= reach + 8) return { name: "pursue", run: this.close(foe), limit: 20 * TICKS.second };
    return { name: "square", run: this.square(foe), limit: 2 * TICKS.second };
  }

  private where(f: Foe): V3 {
    try { return f.giant && f.giant.valid ? f.giant.pos : f.e.location; } catch { return this.c.pos; }
  }
  private middleOf(f: Foe): V3 {
    try { return f.giant && f.giant.valid ? f.giant.middle() : aimOf(f.e); } catch { return this.c.pos; }
  }
  private alive(f: Foe): boolean {
    try {
      if (f.giant) return f.giant.valid && f.giant.dim.id === this.c.dim.id;
      return f.e.isValid && f.e.dimension.id === this.c.dim.id && (!isPlayer(f.e) || targetable(f.e as Player));
    } catch { return false; }
  }

  protected *turnTo(at: V3, rate = 1.2, limit = 240): Act {
    const c = this.c;
    c.halt();
    for (let t = 0; t < limit; t++) {
      const want = yawTo(c.pos, at);
      if (Math.abs(wrapDeg(want - c.yaw)) < 4) break;
      c.yaw = turnTowards(c.yaw, want, rate);
      c.setPhase(Math.abs(wrapDeg(want - c.yaw)) > 25 ? "move" : "idle");
      yield;
    }
    c.setPhase("idle");
  }

  /** Its roar: head up, jaws wide, the ground carrying it. */
  *vroar(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("roar");
    c.say("basiliskra.vathrok.roar", c.anchor("mouth"), 224);
    const fx = new RoarFx(c, true, 36, 6);
    for (let t = 0; t < 104; t++) { fx.tick(); yield; }
    c.setPhase("idle");
  }

  private *challenge(f: Foe): Act {
    yield* this.turnTo(this.where(f), 2.5, 60);
    this.c.lookAt(this.middleOf(f), 80, 40);
    yield* this.vroar();
  }

  /** Up to it, to within reach of its jaws. */
  private *close(f: Foe): Act {
    const c = this.c;
    c.smash = true;
    for (let t = 0; t < 400 && this.alive(f); t++) {
      const at = this.where(f);
      const reach = c.girth + (f.giant ? f.giant.girth : 2) + 6;
      c.setPhase("move");
      c.goTo(at, this.battle ? 0.22 : 0.18, reach);
      c.lookAt(this.middleOf(f), 60, 35);
      this.footfalls();
      if (distXZ(at, c.pos) < reach + 1 || c.blocked > 60) break;
      if (t % 100 === 50) c.say("basiliskra.vathrok.growl", c.anchor("nose"), 96, 1, 0.95 + hash(t) * 0.1);
      yield;
    }
    c.halt();
    c.smash = false;
  }

  private *square(f: Foe): Act {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < 14 && this.alive(f); t++) {
      c.yaw = turnTowards(c.yaw, yawTo(c.pos, this.where(f)), 2.5);
      c.lookAt(this.middleOf(f), 70, 40);
      yield;
    }
  }

  /** A quarter of the way round another giant, at arm's length: it ends side-on to it, where its tail is. */
  private *circle(foe: Creature): Act {
    const c = this.c;
    const side = hash(this.now, 83) < 0.5 ? 1 : -1;
    const r = c.girth + foe.girth + 8;
    const a = Math.atan2(c.pos.z - foe.pos.z, c.pos.x - foe.pos.x) + side * 1.25;
    const to = { x: foe.pos.x + Math.cos(a) * r, y: c.pos.y, z: foe.pos.z + Math.sin(a) * r };
    for (let t = 0; t < 130 && foe.valid; t++) {
      c.setPhase("move");
      c.goTo(to, 0.2, 3);
      c.lookAt(foe.middle(), 80, 40);
      this.footfalls();
      if (distXZ(to, c.pos) < 4 || c.blocked > 30) break;
      if (t > 30 && Math.abs(wrapDeg(yawTo(c.pos, foe.pos) - c.yaw)) > 65 && distXZ(foe.pos, c.pos) < r + 6) break;
      yield;
    }
    c.halt();
  }

  /** Where a blow lands: the noise of it, the shake, the green fire, the ground under it. */
  private impact(at: V3, big: boolean): void {
    const c = this.c;
    sound(c.dim, "random.explode", at, 160, 1.6, big ? 0.5 : 0.62);
    sound(c.dim, "basiliskra.vathrok.step", at, 160, 1, 0.6);
    particle(c.dim, "basiliskra:v_impact_blast", at, 160);
    particle(c.dim, "basiliskra:impact_debris", at, 128);
    particle(c.dim, "basiliskra:v_impact_ring", { x: at.x, y: c.pos.y + 0.4, z: at.z }, 160);
    particle(c.dim, "minecraft:huge_explosion_emitter", at, 160);
    shake(c, 128, big ? 1.2 : 0.8, 0.5);
  }

  /** A blow on whatever stands in front of it: another giant there takes `giantN` and is thrown back. */
  private strikeGiants(maxAngle: number, range: number, giantN: number, throwBack: number, sideOf = 0): boolean {
    const c = this.c;
    let struck = false;
    for (const g of otherGiants(c)) {
      const b = wrapDeg(yawTo(c.pos, g.pos) - c.yaw);
      if (distXZ(g.pos, c.pos) > c.girth + g.girth + range) continue;
      if (sideOf ? b * sideOf < 35 : Math.abs(b) > maxAngle) continue;
      g.takeBlow(c, giantN, true);
      g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, throwBack);
      this.impact({ x: (g.pos.x + c.pos.x) / 2, y: c.pos.y + 16, z: (g.pos.z + c.pos.z) / 2 }, throwBack > 6);
      struck = true;
    }
    return struck;
  }

  /** Its jaws: head drawn back, thrown forward with its whole body behind it. */
  private *lunge(f: Foe): Act {
    const c = this.c;
    c.halt();
    yield* this.turnTo(this.where(f), 3, 24);
    c.lookAhead();
    c.setPhase("bite");
    c.say("basiliskra.vathrok.growl", c.anchor("nose"), 128, 1, 0.9);
    for (let t = 0; t < 25; t++) {
      if (t === 9) {
        const fw = forwardOf(c.yaw);
        const front = { x: c.pos.x + fw.x * (c.girth + 9), y: c.pos.y + 1, z: c.pos.z + fw.z * (c.girth + 9) };
        c.say("basiliskra.vathrok.bite", c.anchor("mouth"), 128);
        this.strikeGiants(60, 15, this.n("lunge"), 5);
        blast(c.dim, front, 9, this.hit("bite"), c.mobHit(30), 1.4, (p, n) => c.hurt(p, n), c.entity, c.pos);
        // what it was biting at, if it is not a giant of ours and is still in reach of the jaws
        if (!f.giant && this.alive(f) && dist(f.e.location, front) < 11 && !isPlayer(f.e)) {
          try { f.e.applyDamage(c.mobHit(30), { cause: EntityDamageCause.entityAttack, damagingEntity: c.entity }); } catch { /* gone */ }
        }
      }
      yield;
    }
    c.setPhase("idle");
  }

  /** Its claws: it rears on its hind legs and rakes down with the arm on the side its head is turned to. */
  private *rake(f: Foe): Act {
    const c = this.c;
    c.halt();
    yield* this.turnTo(this.where(f), 3, 20);
    const bearing = wrapDeg(yawTo(c.pos, this.where(f)) - c.yaw);
    const side = bearing >= 0 ? 1 : -1;
    c.lookYaw = 30 * side; c.lookPitch = 0;
    c.setPhase("swipe");
    for (let t = 0; t < 30; t++) {
      c.lookYaw = 30 * side;
      if (t === 8) c.say("basiliskra.vathrok.claw", c.anchor("mouth"), 128);
      if (t === 12) {
        // three great green claw marks in the air across the front of it, and three gouges in the ground
        const fw = forwardOf(c.yaw), l = leftOf(c.yaw);
        const reach = c.girth + 8;
        for (let k = -1; k <= 1; k++) {
          const at = add(c.pos, add(mul(fw, reach), mul(l, side * 6 + k * 4)));
          const mid = { x: at.x, y: c.pos.y + 6 * c.scale / 1.7, z: at.z };
          const v = new MolangVariableMap();
          v.setFloat("variable.width", 4.2 * 2.4);
          v.setFloat("variable.spin", side * (40 + k * 6));
          particle(c.dim, "basiliskra:v_claw_scratch", mid, 192, v);
          if (k === 0) { particle(c.dim, "basiliskra:v_claw_glow", mid, 160, v); particle(c.dim, "basiliskra:v_claw_sparks", mid, 160, v); }
          const ground = { x: at.x, y: c.pos.y + 1, z: at.z };
          if (isLoaded(c.dim, ground) && wither()) carve(c.dim, ground, 3.2, 60, false);
          particle(c.dim, "basiliskra:v_step_dust", ground, 128);
        }
        this.strikeGiants(65, 16, this.n("swipe"), 3);
        blast(c.dim, add(c.pos, mul(fw, reach)), 10, this.hit("claws"), c.mobHit(28), 1.6, (p, n) => c.hurt(p, n), c.entity, c.pos);
        shake(c, 96, 0.6, 0.4);
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
  }

  /** The tail: it winds away, then lashes round to the side its head has turned to. */
  private *tail(side: 1 | -1): Act {
    const c = this.c;
    c.halt();
    c.lookYaw = 70 * side; c.lookPitch = 0;
    c.setPhase("sweep");
    c.say("basiliskra.vathrok.growl", c.anchor("nose"), 128, 1, 0.85);
    for (let t = 0; t < 36; t++) {
      c.lookYaw = 70 * side;
      if (t === 13) sound(c.dim, "basiliskra.vathrok.claw", c.anchor("club_core"), 160, 1, 0.7);
      if (t === 15) {
        const struck = this.strikeGiants(180, 30, this.n("tail"), 9, side);
        for (const deg of [65, 105, 145]) {
          const fw = forwardOf(c.yaw + deg * side);
          const at = { x: c.pos.x + fw.x * 26, y: c.pos.y + 1.5, z: c.pos.z + fw.z * 26 };
          if (!isLoaded(c.dim, at)) continue;
          blast(c.dim, at, 10, this.hit("tail"), c.mobHit(34), 1.8, (p, n) => c.hurt(p, n), c.entity, c.pos);
          if (wither()) carve(c.dim, at, 4.0, 120, false);
          particle(c.dim, "basiliskra:v_step_dust", at, 128);
        }
        if (!struck) shake(c, 96, 0.5, 0.4);
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
  }

  /** Its whole weight at a run, at another giant: it does not stop until it has hit it or lost it. */
  private *ram(foe: Creature): Act {
    const c = this.c;
    yield* this.turnTo(foe.pos, 2.5, 50);
    c.say("basiliskra.vathrok.growl", c.anchor("mouth"), 192, 1, 0.8);
    c.smash = true;
    for (let t = 0; t < 420; t++) {
      if (!foe.valid || foe.dim.id !== c.dim.id) break;
      const reach = c.girth + foe.girth;
      c.setPhase("move");
      c.goTo(foe.pos, 0.3, reach + 2);
      c.lookAt(foe.middle(), 60, 40);
      this.footfalls();
      if (distXZ(foe.pos, c.pos) < reach + 5) {
        const away = norm({ x: foe.pos.x - c.pos.x, y: 0, z: foe.pos.z - c.pos.z });
        foe.takeBlow(c, this.n("ram") * Math.min(1, 0.5 + c.speed / 0.5), true);
        foe.shove(away, 11);
        this.impact({ x: (foe.pos.x + c.pos.x) / 2, y: c.pos.y + 18, z: (foe.pos.z + c.pos.z) / 2 }, true);
        break;
      }
      if (c.blocked > 60) break;
      yield;
    }
    c.halt();
    c.smash = false;
    c.setPhase("idle");
    for (let t = 0; t < 12; t++) yield;
  }

  /** Its breath: braced on its arms, spines lighting from the tail up; a green line shows where it will go; then a
   *  torrent of green corroding fire, raked side to side across that place. */
  private *breath(f: Foe): Act {
    const c = this.c, spec = this.breathSpec;
    let last = this.middleOf(f);
    const mark = (): V3 => { if (this.alive(f)) last = this.middleOf(f); return last; };
    yield* this.turnTo(this.where(f), 2.5, 50);
    c.setPhase("charge");
    c.say("basiliskra.vathrok.charge", c.anchor("mouth"), 192);
    this.chargeOn = true;
    let fixed = mark();
    for (let t = 0; t < 80; t++) {
      c.setCharge(Math.min(18, (t / 70) * 18));
      if (t < 56) fixed = mark();
      c.trackTo(t < 56 ? fixed : fixed, 2.5, 80, 60);
      if (t % 4 === 0) particle(c.dim, "basiliskra:v_charge_gather", c.anchor("muzzle"), 160);
      if (t % 8 === 0) particle(c.dim, "basiliskra:v_plate_blaze", c.anchor(`plate_tip_${9 - Math.min(9, Math.floor(t / 8))}`), 160);
      if (t >= 56 && t % 2 === 0) {
        // the line: where its breath will go is fixed when it shows (step out of it)
        const { from } = c.aim();
        const dir = norm(sub(fixed, from));
        particle(c.dim, "basiliskra:v_beam_aim", from, 160, beamVars(dir, clearRange(c, from, dir, spec.range), 0.25 + 0.5 * ((t - 56) / 24)));
      }
      if (this.dying) return;
      yield;
    }
    this.chargeOn = false;
    stopSound(c.dim, "basiliskra.vathrok.charge", c.pos);
    c.setPhase("fire");
    c.setCharge(20);
    c.say("basiliskra.vathrok.beam", c.anchor("mouth"), 224);
    particle(c.dim, "basiliskra:v_muzzle_shock", c.anchor("muzzle"), 192);
    shake(c, 160, 0.9, 0.5);
    const st: BeamState = { ground: null };
    const across = leftOf(yawTo(c.pos, fixed));
    const sweep = this.battle ? 14 : 8;
    for (let t = 0; t < 100; t++) {
      // a giant is followed (it is too big to step out of the way); anything smaller is raked where the line showed
      const goal = f.giant && f.giant.valid ? mark() : fixed;
      const k = Math.sin((t / 100) * Math.PI * 2) * Math.min(1, t / 15);
      c.trackTo(add(goal, mul(across, k * sweep)), 5, 80, 70);
      const fade = t < 85 ? 1 : (100 - t) / 15;
      beamTick(c, spec, t, fade, st, { scorch: (at) => this.scorch(at), clean: true });
      if (t % 10 === 0) shake(c, 128, 0.5, 0.4);
      if (this.dying) return;
      yield;
    }
    c.setCharge(0);
    c.setPhase("vent");
    c.say("basiliskra.vathrok.huff", c.anchor("nose"), 96);
    for (let t = 0; t < 30; t++) yield;
    c.setPhase("idle");
    this.rest("beam", (this.battle ? 16 : 22) * TICKS.second);
    this.recoverUntil = this.now + 3 * TICKS.second;
  }

  private *reel(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("recoil");
    c.say("basiliskra.vathrok.hurt", c.anchor("nose"), 128);
    for (let t = 0; t < 18; t++) yield;
    c.setPhase("idle");
  }

  /** Round the place it was put down, or came up. */
  protected *roam(): Act {
    const c = this.c, now = this.now;
    const a = hash(now, 51) * Math.PI * 2, r = 20 + hash(now, 52) * (PROWL - 20);
    const to = { x: this.home.x + Math.cos(a) * r, y: c.pos.y, z: this.home.z + Math.sin(a) * r };
    yield* this.walk(to, 0.14, 8, 900);
    c.setPhase("idle");
    for (let t = 0; t < 100; t++) {
      if (t === 30) c.say(hash(now, 17) < 0.5 ? "basiliskra.vathrok.huff" : "basiliskra.vathrok.growl", c.anchor("nose"), 96, 0.9);
      if (this.foe() || (t % 20 === 0 && this.quarry())) break;
      yield;
    }
  }

  /** Come up out of the ground: the ground shakes, splits and smokes, and it roars. */
  *emerge(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < 50; t++) {
      if (t % 4 === 0) {
        const a = hash(this.now, t) * Math.PI * 2, r = c.girth * (0.6 + hash(t, 7));
        const at = { x: c.pos.x + Math.cos(a) * r, y: c.pos.y + 0.5, z: c.pos.z + Math.sin(a) * r };
        particle(c.dim, "basiliskra:impact_debris", at, 160);
        particle(c.dim, "basiliskra:v_step_dust", at, 160);
        particle(c.dim, "basiliskra:v_impact_smoke", at, 160);
      }
      if (t % 10 === 0) { shake(c, 192, 0.8, 0.6); sound(c.dim, "basiliskra.vathrok.step", c.pos, 192, 1, 0.5 + t * 0.004); }
      yield;
    }
    particle(c.dim, "basiliskra:v_impact_ring", { x: c.pos.x, y: c.pos.y + 0.4, z: c.pos.z }, 192);
    particle(c.dim, "minecraft:huge_explosion_emitter", c.pos, 192);
    yield* this.vroar();
  }

  /** Beaten: it sinks onto its belly with a long groan, the light in its spines going out; then it is gone. */
  private *fall(): Act {
    const c = this.c;
    c.halt();
    c.smash = false;
    c.setCharge(0);
    c.lookAhead();
    c.setPhase("fall");
    c.say("basiliskra.vathrok.death", c.anchor("mouth"), 224);
    for (let t = 0; t < 96; t++) {
      c.setPhase("fall");
      if (t % 7 === 3) {
        const v = c.volumes();
        const at = v[Math.floor(hash(this.now, t) * v.length)].at;
        particle(c.dim, "basiliskra:v_impact_fire", at, 160);
        particle(c.dim, "basiliskra:v_impact_smoke", at, 160);
      }
      if (t === 72) {
        const fw = forwardOf(c.yaw);
        const at = { x: c.pos.x + fw.x * 6, y: c.pos.y + 0.5, z: c.pos.z + fw.z * 6 };
        particle(c.dim, "basiliskra:v_impact_ring", at, 192);
        particle(c.dim, "basiliskra:v_step_dust", at, 160);
        shake(c, 160, 1.4, 0.8);
        blast(c.dim, at, 12, this.battle ? 8 : 6, c.mobHit(20), 1.6, (p, n) => c.hurt(p, n), c.entity, c.pos);
      }
      yield;
    }
    const mid = c.middle();
    for (const v of c.volumes()) if (hash(v.at.z, v.at.y) < 0.3) particle(c.dim, "basiliskra:v_impact_smoke", v.at, 192);
    particle(c.dim, "basiliskra:v_impact_glare", mid, 224);
    sound(c.dim, "random.explode", mid, 224, 2, 0.45);
    // what it leaves: its scales and its heart (and, met in survival, a great deal of experience)
    try {
      const n = this.battle ? 24 : 10 + Math.floor(hash(this.now, 5) * 6);
      c.dim.spawnItem(new ItemStack(VATHROK_SCALE_ITEM, n), { x: c.pos.x, y: c.pos.y + 1.5, z: c.pos.z });
      c.dim.spawnItem(new ItemStack(VATHROK_HEART_ITEM, 1), { x: c.pos.x + 1, y: c.pos.y + 1.5, z: c.pos.z });
      if (!this.battle) for (let k = 0; k < 24; k++) c.dim.spawnEntity("minecraft:xp_orb", { x: c.pos.x + (hash(k, 1) - 0.5) * 6, y: c.pos.y + 1.5, z: c.pos.z + (hash(k, 2) - 0.5) * 6 });
    } catch { /* unloading: it leaves nothing */ }
    this.gone = true;
    yield;
  }
}

interface Vath { c: Creature; brain: BrainVathrok; rec: Rec; battle: boolean; n: number }

function tellNear(dim: Dimension, at: V3, msg: string): void {
  for (const p of witnesses(dim, at, 128)) { try { p.sendMessage(msg); } catch { /* left */ } }
}
const isVathrok = (id: string): boolean => id === VATHROK || id === VATHROK_TITAN;

export class Vathroks {
  readonly list = new Map<string, Vath>();
  private hurtCry = new Map<string, number>();
  private comingAt = -1;

  creatures(): Creature[] { return [...this.list.values()].map((v) => v.c); }
  count(battle: boolean): number { let n = 0; for (const v of this.list.values()) if (v.battle === battle) n++; return n; }
  of(e: Entity): Vath | undefined { try { return this.list.get(e.id); } catch { return undefined; } }
  /** Is any of them at something just now (for the music)? */
  fighting(): Creature | null {
    for (const v of this.list.values()) if (v.c.valid && (v.brain.foe() || ["lock", "beam", "lunge", "swipe", "tail", "ram", "pursue"].includes(v.brain.actName))) return v.c;
    return null;
  }

  inspect(e: Entity): void {
    let id: string, typeId: string, dimId: string, at: V3;
    try { if (!e.isValid) return; typeId = e.typeId; if (!isVathrok(typeId)) return; id = e.id; dimId = e.dimension.id; at = { ...e.location }; } catch { return; }
    if (this.list.has(id)) return;
    const battle = typeId === VATHROK_TITAN;
    const refuse = (why: string) => { tellNear(e.dimension, at, `§7${why}`); try { e.remove(); } catch { /* gone */ } };
    if (battle ? !CONFIG.vathrokTitan : !CONFIG.vathrok) return refuse(battle ? "The Vathrok Titan is turned off in the settings." : "Vathrok is turned off in the settings.");
    if (dimId !== OVERWORLD) return refuse("Vathrok can only stand in the Overworld.");
    const max = battle ? VATHROK_MAX.battle : VATHROK_MAX.boss;
    if (this.count(battle) >= max) return refuse(battle ? `There are ${max} Vathrok Titans in the world already: that is as many as there can be.` : "Vathrok is in the world already: there is only one.");
    this.adopt(e, at, battle, false);
  }

  private adopt(e: Entity, at: V3, battle: boolean, rising: boolean): void {
    let saved: Saved | null = null;
    try { const s = e.getDynamicProperty(TAG); if (typeof s === "string") saved = JSON.parse(s) as Saved; } catch { saved = null; }
    const taken = new Set([...this.list.values()].filter((v) => v.battle === battle).map((v) => v.n));
    let n = saved && Number.isInteger(saved.n) && !taken.has(saved.n) ? saved.n : -1;
    if (n < 0) for (n = 0; taken.has(n); n++) { /* the first name not in use */ }
    const home = saved && Array.isArray(saved.home) ? { x: saved.home[0], y: saved.home[1], z: saved.home[2] } : at;
    const fresh = !saved;
    const name = battle ? `Vathrok Titan ${ROMAN[n % ROMAN.length]}` : "Vathrok";
    try {
      e.triggerEvent("basiliskra:bind");
      e.setDynamicProperty(TAG, JSON.stringify({ n, home: [Math.round(home.x), Math.round(home.y), Math.round(home.z)] } as Saved));
      e.nameTag = name;
    } catch { return; }
    const c = new Creature(e, 5);
    c.might = battle ? 3 : 1;
    c.haste = battle ? 1.35 : 1.1;
    c.lethal = battle ? LETHAL : 0;
    c.hue = "v";
    c.resync();
    c.set(PROP.visLo, 0);
    c.set(PROP.visHi, 8);
    c.set(PROP.gait, 1);
    const rec = freshRecord();
    rec.stage = "alive"; rec.form = 3; rec.home = home;
    rec.born = rec.mut.formSince = store.rec.clock;
    const brain = new BrainVathrok(c, rec, home, battle);
    c.onBlow = (by, amount, heavy) => brain.onBlow(by, amount, heavy);
    this.list.set(e.id, { c, brain, rec, battle, n });
    if (fresh) {
      tellNear(e.dimension, at, battle ? `§2${name}§7 stands here. (${this.count(true)} of ${VATHROK_MAX.battle}.)` : "§2Vathrok§7 has come up out of the ground.");
      brain.forced = rising || !battle ? { name: "emerge", run: brain.emerge(), limit: 12 * TICKS.second } : { name: "roar", run: brain.vroar(), limit: 10 * TICKS.second };
    }
  }

  /** Make one here (the command, the wheel, the lure).  Returns what happened, in words. */
  spawn(dim: Dimension, at: V3, yaw: number, battle: boolean): string {
    if (battle ? !CONFIG.vathrokTitan : !CONFIG.vathrok) return battle ? "The Vathrok Titan is turned off in the settings." : "Vathrok is turned off in the settings.";
    if (dim.id !== OVERWORLD) return "Vathrok can only stand in the Overworld.";
    const max = battle ? VATHROK_MAX.battle : VATHROK_MAX.boss;
    if (this.count(battle) >= max) return battle ? `There are ${max} Vathrok Titans in the world already.` : "Vathrok is in the world already: there is only one.";
    if (!isLoaded(dim, at)) return "That place is not loaded.";
    const before = this.list.size;
    try {
      const e = dim.spawnEntity(battle ? VATHROK_TITAN : VATHROK, at, { initialRotation: yaw });
      this.inspect(e);
    } catch { return "Vathrok could not be made here."; }
    if (this.list.size <= before) return "Vathrok could not be made here.";
    return battle ? "A Vathrok Titan stands here." : "Vathrok is coming up out of the ground.";
  }

  /**
   * The lure, used by a player: the ground shakes, and a few seconds later Vathrok comes up out of it some way off.
   * Returns false (and says why) if it cannot come.
   */
  lure(p: Player): boolean {
    const say = (m: string) => { try { p.sendMessage(`§7[Basiliskra] ${m}`); } catch { /* left */ } };
    if (!CONFIG.vathrok) { say("Vathrok is turned off in the settings."); return false; }
    if (p.dimension.id !== OVERWORLD) { say("Vathrok only lives in the Overworld."); return false; }
    if (this.count(false) >= VATHROK_MAX.boss || this.comingAt >= 0) { say("Vathrok is already in the world."); return false; }
    const at = this.groundNear(p.dimension, p.location, 50, 70);
    if (!at) { say("The ground here will not let it up. Try in the open."); return false; }
    this.comingAt = store.rec.clock;
    for (const w of witnesses(p.dimension, p.location, 96)) { try { w.sendMessage("§2The ground is shaking..."); w.runCommand("camerashake add @s 0.3 4 positional"); } catch { /* left */ } }
    sound(p.dimension, "basiliskra.vathrok.growl", at, 192, 1, 0.6);
    const dim = p.dimension, yaw = yawTo(at, p.location);
    this.pending = { dim, at, yaw, t: store.rec.clock + 80 };
    return true;
  }
  private pending: { dim: Dimension; at: V3; yaw: number; t: number } | null = null;

  /** A place on open ground between `r0` and `r1` blocks from `from` (the first of twelve bearings that has one). */
  private groundNear(dim: Dimension, from: V3, r0: number, r1: number): V3 | null {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + hash(store.rec.clock, 3) * 6.28;
      const r = r0 + (r1 - r0) * hash(k, store.rec.clock);
      const x = from.x + Math.cos(a) * r, z = from.z + Math.sin(a) * r;
      if (!isLoaded(dim, { x, y: from.y, z })) continue;
      const g = groundY(dim, x, z, from.y + 30, 60);
      if (typeof g !== "number") continue;
      try {
        const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(g) - 1, z: Math.floor(z) });
        if (!b || b.isLiquid || b.typeId.includes("water")) continue;
      } catch { continue; }
      return { x, y: g, z };
    }
    return null;
  }

  /** Take them out of the world: `which` the survival one, the battle ones, or both.  Returns how many there were. */
  clear(which: "boss" | "battle" | "all" = "all"): number {
    let n = 0;
    for (const v of [...this.list.values()]) {
      if (which === "all" || (which === "battle") === v.battle) { this.drop(v, true); n++; }
    }
    return n;
  }

  private drop(v: Vath, remove: boolean): void {
    let id = "";
    for (const [k, x] of this.list) if (x === v) id = k;
    v.c.dropParts();
    if (id) { this.list.delete(id); giants.delete(id); this.hurtCry.delete(id); }
    if (remove) { try { v.c.entity.setProperty(PROP.bound, false); v.c.entity.remove(); } catch { /* already gone */ } }
  }

  onRemoving(e: Entity): void { const v = this.of(e); if (v) this.drop(v, false); }

  /** A blow is about to land: all of it, or, when it would kill, none (it goes down in its own time). */
  beforeHurt(e: Entity, damage: number): number {
    const v = this.of(e);
    if (!v) return damage;
    if (v.brain.dying) return 0;
    let health = 1;
    try { health = e.getComponent("minecraft:health")?.currentValue ?? 1; } catch { health = 1; }
    if (damage >= health - 1) { v.brain.dying = true; return 0; }
    return damage;
  }

  onHurt(e: Entity, by: Entity | undefined, amount: number): void {
    const v = this.of(e);
    if (!v || amount <= 0) return;
    let player: Player | undefined;
    try { if (by && by.typeId === "minecraft:player") player = by as Player; } catch { player = undefined; }
    v.brain.onHurt(player);
    v.brain.hurtAt = store.rec.clock;
    const now = store.rec.clock;
    if (amount >= (v.battle ? 20 : 6) && now - (this.hurtCry.get(e.id) ?? -999) > 90 && !v.brain.dying) {
      this.hurtCry.set(e.id, now);
      v.c.say("basiliskra.vathrok.hurt", v.c.anchor("nose"), 128);
    }
  }

  /** Rows for the health line over the hotbar (the battle ones; the survival one has a boss bar). */
  rows(): { c: Creature; text: string }[] {
    const out: { c: Creature; text: string }[] = [];
    for (const v of this.list.values()) {
      if (!v.battle) continue;
      let h = 0;
      try { h = v.c.entity.getComponent("minecraft:health")?.currentValue ?? 0; } catch { continue; }
      if (v.brain.dying) h = 0;
      const k = Math.max(0, Math.min(10, Math.ceil((h / VATHROK_HEALTH) * 10)));
      out.push({ c: v.c, text: `§2Vathrok ${ROMAN[v.n % ROMAN.length]} §a${"█".repeat(k)}§8${"█".repeat(10 - k)} §7${Math.max(0, Math.round(h))}` });
    }
    return out;
  }

  /**
   * Now and then, at night, the survival one comes by itself: at most once every three in-game days, and then only
   * one night in four, near a player in Survival or Adventure standing on land in the Overworld.
   */
  private natural(now: number): void {
    if (!CONFIG.vathrok || this.count(false) > 0 || this.pending) return;
    let tod = 0;
    try { tod = world.getTimeOfDay(); } catch { return; }
    if (tod < 15000 || tod > 21000) return;
    let next = 0;
    try { next = Number(world.getDynamicProperty(NEXT_KEY) ?? 0); } catch { next = 0; }
    if (now < next) return;
    // one night in four: decided once for the night
    const night = 3 * TICKS.day;
    try { world.setDynamicProperty(NEXT_KEY, now + (hash(now, 61) < 0.25 ? night : TICKS.day)); } catch { return; }
    if (hash(now, 62) >= 0.25) return;
    const ps = players().filter((p) => { try { return p.dimension.id === OVERWORLD && targetable(p); } catch { return false; } });
    if (!ps.length) return;
    const p = ps[Math.floor(hash(now, 63) * ps.length)];
    const at = this.groundNear(p.dimension, p.location, 60, 90);
    if (!at) return;
    for (const w of witnesses(p.dimension, p.location, 128)) { try { w.sendMessage("§2The ground is shaking..."); } catch { /* left */ } }
    this.pending = { dim: p.dimension, at, yaw: yawTo(at, p.location), t: now + 80 };
  }

  tick(now: number): void {
    if (now % 20 === 11) {
      try { for (const e of store.loaded ? worldVathroks() : []) this.inspect(e); } catch { /* unloading */ }
      // a setting turned off: those of that kind go
      for (const v of [...this.list.values()]) {
        if (v.battle ? !CONFIG.vathrokTitan : !CONFIG.vathrok) { tellNear(v.c.dim, v.c.pos, v.battle ? "§7The Vathrok Titan is turned off: it is gone." : "§7Vathrok is turned off: it is gone."); this.drop(v, true); }
      }
    }
    if (now % 600 === 300) this.natural(now);
    if (this.pending && now >= this.pending.t) {
      const { dim, at, yaw } = this.pending;
      this.pending = null;
      this.comingAt = -1;
      try {
        if (CONFIG.vathrok && this.count(false) === 0 && isLoaded(dim, at)) {
          const e = dim.spawnEntity(VATHROK, at, { initialRotation: yaw });
          this.inspect(e);
        }
      } catch { /* the place unloaded */ }
    }
    for (const v of [...this.list.values()]) {
      if (!v.c.valid) { this.drop(v, false); continue; }
      v.brain.tick();
      if (v.brain.gone) { this.drop(v, true); continue; }
      v.c.update();
    }
  }
}

function worldVathroks(): Entity[] {
  try {
    const d = world.getDimension(OVERWORLD);
    return [...d.getEntities({ type: VATHROK }), ...d.getEntities({ type: VATHROK_TITAN })];
  } catch { return []; }
}

export const vathroks = new Vathroks();
