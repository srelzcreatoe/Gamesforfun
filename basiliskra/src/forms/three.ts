/**
 * Basiliskra III -- four footfalls.
 *
 * His own breath: the tail club plants, the ridge lights section by section from tail to
 * shoulders, the light climbs his throat and the whole hide stands lit; the eye stops following,
 * and then a white-hot core wrapped in spiralling scarlet leaves his mouth.  It is not the same
 * beam every time.  The first firings are a ragged, short plume; he learns to focus it; later it
 * is a thin white lance.  Players who hide at his flank meet the ridge scatter instead.
 */
import { Entity, EntityDamageCause, Player, world } from "@minecraft/server";
import { CONFIG, KNOCK_GAP_TICKS, PROP, TICKS } from "../config";
import { Act, anyoneNear, Brain, changeTicks, Choice, isNight, nearbyPlayers, pace, travel, wait, watchersNear, settlementNear } from "../brain";
import { BeamSpec, BeamState, beamTick, clearRange } from "../beam";
import { Creature, giantOf, otherGiants, targetable } from "../creature";
import { beamVars, flash, particle, players, sound, stopSound, witnesses } from "../fx";
import { STANCE_III, STRIDE_III } from "../generated/rig";
import { POUR, freshPour, groundAhead, pourTick, rearTick, slamAndLift } from "../pour";
import { alive, blast, carve, foreignGiantsNear, mobsNear, segDist, wither } from "../havoc";
import { RoarFx, shake } from "../roar";
import { store } from "../store";
import { addFallout, fuse, sear } from "../fallout";
import { add, clamp, dist, distXZ, dot, hash, leftOf, mul, norm, sub, turnTowards, wrapDeg, yawTo, type V3 } from "../vec";
import { blockAt, clearLine, groundY, idAt, isBreakableNatural, isLoaded, isNaturalGround, isPlantBlock, isSolidBlock, printOf, scorchOf, takesMark } from "../world";

/**
 * The atomic breath is one recording (basiliskra.iii.charge, then basiliskra.iii.beam): 6.86 s of charging, then
 * the shot at full force for 7.05 s and its fall.  The charge and the beam last exactly as long as it does.
 */
export const CHARGE_TICKS = 137, PLANT_TICKS = 14, LIGHT_END = 112;
export const FIRE_FULL = 141, FIRE_FADE = 14;
const TIERS = {
  // (width: the breath as drawn, in proportion to his mouth, which stands 3.7 blocks open when he fires)
  1: { range: 40, radius: 1.9, damage: 5, width: 2.5, carve: 2.0 },
  2: { range: 60, radius: 1.6, damage: 7, width: 2.8, carve: 2.6 },
  3: { range: 76, radius: 1.4, damage: 9, width: 3.0, carve: 3.1 },
} as const;
/** Closer than this (from the mouth) the beam is not his answer: he walks on you instead. */
const BEAM_MIN = 14;
/** Copper weathers and players wax it: all eight are the same rod to him. */
const ROD = /^minecraft:(waxed_)?(exposed_|weathered_|oxidized_)?lightning_rod$/;
const ROD_REACH = 10;
const FEET = ["foot_bl", "foot_fl", "foot_br", "foot_fr"];
/** From the pane to his middle when the lowered head puts one eye two blocks and a bit outside it; and the eye's offset from his line. */
const WINDOW_STANDOFF = 23.6, WINDOW_EYE_LEFT = 2.1;

/** Rods that have just taken a charge need time before they can take another. */
const rodReady = new Map<string, number>();

/** Players and creatures alike: what he may hunt. */
export type Quarry = Entity;
/** Another giant he is fighting (2.3): one of ours (with its body of hit volumes), or another add-on's monster. */
export type Foe = { g: Creature | null; e: Entity };
export const isPlayer = (e: Entity): e is Player => { try { return e.typeId === "minecraft:player"; } catch { return false; } };
/** Where to aim at something: its head; at another giant, the middle of its trunk. */
export function headOf(e: Entity): V3 {
  const g = giantOf(e);
  if (g) return g.middle();
  try { return e.getHeadLocation(); } catch { return e.location; }
}
/** What flies: his breath must follow it, and lead it (it does not wait to be burnt). */
const FLYERS = new Set(["minecraft:ender_dragon", "minecraft:wither", "minecraft:ghast", "minecraft:happy_ghast", "minecraft:phantom", "minecraft:blaze",
  "minecraft:vex", "minecraft:breeze", "minecraft:bee", "minecraft:parrot", "minecraft:bat", "minecraft:allay"]);
export function isFlyer(e: Entity): boolean {
  try {
    if (FLYERS.has(e.typeId)) return true;
    if (isPlayer(e)) return (e as Player).isGliding || (e as Player).isFlying;
    return false;
  } catch { return false; }
}
/** Where to aim at something: for what flies, where it will be a few ticks from now; for the biggest, the middle of the body. */
export function aimOf(e: Entity, lead = 4): V3 {
  let at = headOf(e);
  try {
    if (e.typeId === "minecraft:ender_dragon" || e.typeId === "minecraft:ghast" || e.typeId === "minecraft:happy_ghast") at = { x: e.location.x, y: e.location.y + 2, z: e.location.z };
    if (isFlyer(e)) { const v = e.getVelocity(); at = { x: at.x + v.x * lead, y: at.y + v.y * lead, z: at.z + v.z * lead }; }
  } catch { /* gone */ }
  return at;
}

/** How near he comes to what he goes after: a player is kept at the length of his neck, a giant at arm's length, the rest are walked over. */
export function standOff(c: Creature, e: Entity, player: number, other: number): number {
  const g = giantOf(e);
  return g ? c.girth + g.girth + 6 : isPlayer(e) ? player : other;
}

export class BrainThree extends Brain {
  protected beat = 0;
  protected stepAt = 0;
  protected prey: string | null = null;        // the one he remembers
  protected preyUntil = 0;
  protected recoverUntil = 0;
  /** Creatures about him, looked up every two seconds. */
  protected mobs: Entity[] = [];
  protected mobsAt = -999;
  protected lastQuarry: string | null = null;
  protected roarSeed = 0;
  /** Set when a charge is grounded: the ending listens for it. */
  groundedAt: { tick: number; rod: V3 } | null = null;
  /** The ending asks for a charge aimed at nothing in particular, beside the seam. */
  wantCharge = false;

  protected onFinish(): void {
    this.c.set(PROP.tier, this.tier());
    this.c.smash = false;
    // a charge cut off (driven off, the quarry gone, the encounter's time up) takes its sound with it
    if (this.chargeSounding) { this.chargeSounding = false; stopSound(this.c.dim, "basiliskra.iii.charge", this.c.pos); }
  }
  protected chargeSounding = false;
  /** His footfall and his grunt (Vathrok, which walks as he does, has its own). */
  protected voices = { step: "basiliskra.iii.step", grunt: "basiliskra.iii.grunt" };

  /** Creatures he could go after (not players): cached, the entity query runs every two seconds at most. */
  protected creatures(): Entity[] {
    // another giant in his world is never beneath his notice, whatever the setting says about animals: ours, and from
    // 1.9 another add-on's (a Godzilla with a million health, say)
    const ours = otherGiants(this.c).filter((g) => dist(g.pos, this.c.pos) < this.giantSight).sort((a, b) => dist(a.pos, this.c.pos) - dist(b.pos, this.c.pos)).map((g) => g.entity);
    if (this.now - this.foreignAt >= 40) { this.foreignAt = this.now; this.foreign = foreignGiantsNear(this.c.dim, this.c.pos, this.giantSight); }
    const big = [...ours, ...this.foreign.filter(alive)];
    if (!CONFIG.huntMobs) return big;
    if (this.now - this.mobsAt >= 40) { this.mobsAt = this.now; this.mobs = mobsNear(this.c.dim, this.c.pos, this.c.form >= 4 ? 130 : 72); }
    return [...big, ...this.mobs.filter(alive)];
  }
  /** From how far he knows of another giant. */
  protected giantSight = 160;
  private foreign: Entity[] = [];
  private foreignAt = -999;

  tier(): 1 | 2 | 3 {
    const b = this.rec.mut.beams;
    return b < 2 ? 1 : b < 5 ? 2 : 3;
  }

  protected choose(): Choice | null {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world.getTimeOfDay();
    if (this.wantCharge) {
      this.wantCharge = false;
      return { name: "charge", run: this.beam(null), limit: 40 * TICKS.second };
    }
    // left to himself long enough he becomes the last thing he can be: time is all it waits on
    if (!rec.evolve && !rec.ending?.step && now - rec.mut.formSince >= changeTicks(3)) {
      rec.evolve = { to: 4, step: 0, t0: now, at: { ...c.pos } };
      return { name: "evolve", run: wait(900), limit: 900 };
    }
    const near = nearbyPlayers(c, 90);
    // he remembers who drew him here
    if (rec.origin && rec.guilty && this.ready("remember") && distXZ(rec.origin, c.pos) < 90) {
      const g = near.find((p) => p.id === rec.guilty);
      if (g) { this.rest("remember", TICKS.day); return { name: "remember", run: this.remember(g), limit: 100 * TICKS.second }; }
    }
    // another giant: he fights it, keeping the distance his breath wants and closing for his jaws and his club (2.3)
    const k = this.kaiju();
    if (k) { const ch = this.duel(k); if (ch) return ch; }
    // now and then, for nothing anyone can see, he roars
    if (!this.cooldown.has("rroar")) this.rest("rroar", (30 + 60 * hash(now, 91)) * TICKS.second);
    if (this.ready("rroar")) {
      this.rest("rroar", (55 + 125 * hash(now, 92)) * TICKS.second);       // somewhere between one and three minutes
      if (hash(now, 93) < 0.7 && anyoneNear(c, 110)) return { name: "roar", run: this.roar(hash(now, 94) < 0.25), limit: 12 * TICKS.second };
    }
    const mobs = this.creatures();
    if (now >= this.recoverUntil) {
      const hunted = this.prey && now < this.preyUntil ? near.filter((p) => p.id === this.prey) : near;
      // players sheltering at his flank or behind him: the ridge answers, not the mouth
      if (this.tier() === 3 && this.ready("scatter")) {
        const flank = hunted.find((p) => dist(p.location, c.pos) < 18 * c.scale && Math.abs(wrapDeg(yawTo(c.pos, p.location) - c.yaw)) > 100);
        if (flank) { this.rest("scatter", 45 * TICKS.second); return { name: "scatter", run: this.scatter(), limit: 20 * TICKS.second }; }
      }
      if (this.ready("beam")) {
        // players first; with none in his sight, whatever else lives near him
        const range = TIERS[this.tier()].range - 2;
        const mouth = c.anchor("mouth");
        const quarry: Quarry[] = [...hunted, ...mobs.filter((m) => !this.prey || now >= this.preyUntil)];
        for (const q of quarry) {
          const d = dist(q.location, mouth);
          if (d < BEAM_MIN || d > range) continue;
          if (!clearLine(c.dim, mouth, headOf(q))) continue;     // line of sight, from the mouth itself
          this.rest("beam", 28 * TICKS.second);
          return { name: "beam", run: this.beam(q), limit: 45 * TICKS.second };
        }
      }
    }
    if (isNight(tod) && this.ready("window")) {
      for (const p of near) {
        if (this.ready("window:" + p.id) && this.indoors(p)) {
          this.rest("window", 3 * TICKS.minute); this.rest("window:" + p.id, TICKS.day);
          return { name: "window", run: this.window(p), limit: 2 * TICKS.minute };
        }
      }
    }
    // he goes for what is near: the one he remembers, else the nearest player, else the nearest creature
    let quarry: Quarry | undefined;
    if (this.prey && now < this.preyUntil) quarry = near.find((p) => p.id === this.prey);
    quarry ??= near.find((p) => dist(p.location, c.pos) < 64) ?? mobs.sort((x, y) => dist(x.location, c.pos) - dist(y.location, c.pos))[0];
    if (quarry) {
      // a new quarry: he lets it know first
      if (quarry.id !== this.lastQuarry && this.ready("lockroar")) {
        this.lastQuarry = quarry.id;
        this.rest("lockroar", 50 * TICKS.second);
        const q = quarry;
        return { name: "lock", run: (function* (self: BrainThree) { c.lookAt(headOf(q), 85, 35); yield* self.roar(false); yield* self.pursue(q); })(this), limit: 30 * TICKS.second };
      }
      this.lastQuarry = quarry.id;
      return { name: "pursue", run: this.pursue(quarry), limit: 20 * TICKS.second };
    }
    // with nothing alive in reach he goes to the nearest place where people live, and through it
    const town = settlementNear(c, now);
    if (town) return { name: "raze", run: this.raze(town), limit: 150 * TICKS.second };
    return { name: "roam", run: this.roam(), limit: 80 * TICKS.second };
  }

  /** To a village or a city, and then through it from one side to the other, and again: what he walks through is gone. */
  // ---- another giant (2.3) ----------------------------------------------------------------------------------------
  // Asked for: "when Basiliskra is fighting against another kaiju have it build distance to shoot lazerbeams by
  // jumping back as well but gets closer to attack melee way".  Too close to breathe, with his breath ready: he leaps
  // back over the ground and breathes as he lands.  His breath not ready: he goes in and uses his body.  Between the
  // two, with a clear line: he breathes.  Form III fights with his jaws and his club; Form IV and the Titan with their
  // jaws and hand, their claws and their tail (four.ts).

  /** What his body does to another giant (Form IV and the Titan set their own). */
  protected blows = { bite: 60, tail: 90, lunge: 85, swipe: 100, ram: 110 };
  /** While his breath is at another giant (Form IV then keeps his head on it instead of turning on his club). */
  protected inDuel = false;

  /** The giant he is fighting, if one is near: the nearest of ours, else another add-on's monster. */
  protected kaiju(): Foe | null {
    const c = this.c;
    let best: Creature | null = null, bd = this.giantSight;
    for (const g of otherGiants(c)) {
      const d = dist(g.pos, c.pos);
      if (d < bd) { bd = d; best = g; }
    }
    if (best) return { g: best, e: best.entity };
    if (this.now - this.foreignAt >= 40) { this.foreignAt = this.now; this.foreign = foreignGiantsNear(c.dim, c.pos, this.giantSight); }
    const f = this.foreign.filter(alive).sort((a, b) => dist(a.location, c.pos) - dist(b.location, c.pos))[0];
    return f ? { g: null, e: f } : null;
  }
  protected foeAt(f: Foe): V3 { try { return f.g && f.g.valid ? f.g.pos : f.e.location; } catch { return this.c.pos; } }
  protected foeMiddle(f: Foe): V3 { try { return f.g && f.g.valid ? f.g.middle() : headOf(f.e); } catch { return this.c.pos; } }
  protected foeAlive(f: Foe): boolean {
    try { return f.g ? f.g.valid && f.g.dim.id === this.c.dim.id : f.e.isValid && f.e.dimension.id === this.c.dim.id; } catch { return false; }
  }
  /** How far his breath reaches (Form IV and the Titan reach further). */
  protected breathRange(): number { return TIERS[this.tier()].range - 2; }
  /** His breath at another giant (Form IV and the Titan breathe their own). */
  protected duelBreath(e: Entity): Act { return this.beam(e); }
  /** How far back he leaps, and how high (blocks). */
  protected leapReach(): { far: number; high: number } { return { far: 22, high: 6 }; }

  protected duel(f: Foe): Choice | null {
    const c = this.c, now = this.now;
    const at = this.foeAt(f);
    const d = distXZ(at, c.pos), reach = c.girth + (f.g ? f.g.girth : 4);
    const bearing = wrapDeg(yawTo(c.pos, at) - c.yaw);
    const breathReady = this.ready("beam") && now >= this.recoverUntil;
    // a new enemy: he lets it know first
    if (f.e.id !== this.lastQuarry) {
      this.lastQuarry = f.e.id;
      if (this.ready("lockroar")) { this.rest("lockroar", 50 * TICKS.second); return { name: "lock", run: this.duelChallenge(f), limit: 16 * TICKS.second }; }
    }
    if (d < reach + 16) {
      // too close to breathe at it: back, to have room, and breathe as he lands
      if (breathReady && this.ready("leap")) {
        this.rest("leap", 14 * TICKS.second);
        this.rest("beam", 28 * TICKS.second);
        return { name: "leap", run: this.leapAndBreathe(f), limit: 60 * TICKS.second };
      }
      const m = this.duelMelee(f, d, reach, bearing);
      if (m) return m;
      return { name: "square", run: this.duelSquare(f), limit: 2 * TICKS.second };
    }
    if (breathReady && d < this.breathRange() && clearLine(c.dim, c.anchor("mouth"), this.foeMiddle(f))) {
      this.rest("beam", 28 * TICKS.second);
      return { name: "beam", run: this.breatheAt(f), limit: 90 * TICKS.second };
    }
    // his breath not ready (or no line for it): in, to fight with his body
    return { name: "close", run: this.duelClose(f), limit: 20 * TICKS.second };
  }

  /** Form III, at close quarters: the club for what is beside or behind him, the jaws for what is in front. */
  protected duelMelee(f: Foe, _d: number, _reach: number, bearing: number): Choice | null {
    if (Math.abs(bearing) > 60 && this.ready("tail")) { this.rest("tail", 7 * TICKS.second); this.bites = 0; return { name: "tail", run: this.duelClub(bearing >= 0 ? 1 : -1, f), limit: 4 * TICKS.second }; }
    // after a couple of bites he wheels round, side-on to it, and brings the club across
    if (this.bites >= 2 && this.ready("tail")) {
      this.rest("tail", 7 * TICKS.second); this.bites = 0;
      const side: 1 | -1 = hash(this.now, 71) < 0.5 ? 1 : -1;
      return { name: "tail", run: this.wheelAndClub(f, side), limit: 7 * TICKS.second };
    }
    if (this.ready("bite")) { this.rest("bite", 4 * TICKS.second); this.bites++; return { name: "bite", run: this.duelBite(f), limit: 5 * TICKS.second }; }
    return null;
  }
  private bites = 0;

  /** A quick turn on the spot that brings what he is fighting round to one side of him, then the club. */
  protected *wheelAndClub(f: Foe, side: 1 | -1): Act {
    const c = this.c;
    c.halt();
    c.setPhase("move");
    for (let t = 0; t < 40 && this.foeAlive(f); t++) {
      const want = wrapDeg(yawTo(c.pos, this.foeAt(f)) - 80 * side);
      if (Math.abs(wrapDeg(want - c.yaw)) < 4) break;
      c.yaw = turnTowards(c.yaw, want, 3.5);
      c.lookYaw = clamp(wrapDeg(yawTo(c.pos, this.foeAt(f)) - c.yaw), -70, 70);
      if (t % 8 === 4) {
        const feet = this.shuffleFeet();
        sound(c.dim, "basiliskra.iii.step", c.anchor(feet[(t >> 3) % feet.length]), 96, 0.8, 0.95);
      }
      yield;
    }
    if (!this.foeAlive(f)) return;
    yield* this.duelClub(side, f);
  }

  protected *duelChallenge(f: Foe): Act {
    const c = this.c;
    c.halt();
    yield* this.face(this.foeAt(f), 60);
    c.lookAt(this.foeMiddle(f), 85, 35);
    yield* this.roar(false);
  }

  protected *duelSquare(f: Foe): Act {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < 14 && this.foeAlive(f); t++) {
      c.yaw = turnTowards(c.yaw, yawTo(c.pos, this.foeAt(f)), 2.5);
      c.lookAt(this.foeMiddle(f), 70, 40);
      yield;
    }
  }

  /** In to arm's length (his breath is not ready): whatever is underfoot is trodden. */
  protected *duelClose(f: Foe): Act {
    const c = this.c;
    c.smash = true;
    for (let t = 0; t < 400 && this.foeAlive(f); t++) {
      const at = this.foeAt(f), reach = c.girth + (f.g ? f.g.girth : 4) + 8;
      c.setPhase("move");
      c.goTo(at, 0.2, reach);
      c.lookAt(this.foeMiddle(f), 60, 30);
      this.footfalls();
      if (distXZ(at, c.pos) < reach + 1 || c.blocked > 60) break;
      yield;
    }
    c.halt();
    c.smash = false;
    c.setPhase("idle");
  }

  /** Where a blow lands: the noise of it, the shake, the ground under it. */
  protected duelImpact(at: V3, big: boolean): void {
    const c = this.c;
    sound(c.dim, "random.explode", at, 160, 1.6, big ? 0.5 : 0.62);
    sound(c.dim, "basiliskra.iii.step", at, 160, 1, 0.5);
    particle(c.dim, "basiliskra:impact_blast", at, 160);
    particle(c.dim, "basiliskra:impact_debris", at, 128);
    particle(c.dim, "basiliskra:impact_ring", { x: at.x, y: c.pos.y + 0.4, z: at.z }, 160);
    particle(c.dim, "minecraft:huge_explosion_emitter", at, 160);
    shake(c, 128, big ? 1.2 : 0.8, 0.5);
  }

  /** Form III's jaws: his head drawn back, then thrown forward with his weight behind it (the client: phase `bite`). */
  protected *duelBite(f: Foe): Act {
    const c = this.c;
    c.halt();
    yield* this.face(this.foeAt(f), 24);
    c.lookAhead();
    c.setPhase("bite");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.85);
    for (let t = 0; t < 25; t++) {
      if (t === 9) {
        const front = add(c.pos, mul(c.forward, c.girth + 8));
        for (const g of otherGiants(c)) {
          if (distXZ(g.pos, c.pos) > c.girth + g.girth + 14 || Math.abs(wrapDeg(yawTo(c.pos, g.pos) - c.yaw)) > 60) continue;
          g.takeBlow(c, this.blows.bite, true);
          g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, 4);
          this.duelImpact(c.anchor("mouth"), false);
        }
        // another add-on's monster has no body of ours: it is bitten where it stands
        if (!f.g && this.foeAlive(f) && distXZ(f.e.location, front) < c.girth + 12) {
          try { f.e.applyDamage(c.mobHit(this.blows.bite), { cause: EntityDamageCause.entityAttack, damagingEntity: c.entity }); } catch { /* gone */ }
        }
        blast(c.dim, front, 8, 12, c.mobHit(26), 1.3, (p, n) => c.hurt(p, n), c.entity, c.pos);
      }
      yield;
    }
    c.setPhase("idle");
  }

  /** Form III's club: his tail winds away, then swings round to the side his head has turned to (phase `sweep`). */
  protected *duelClub(side: 1 | -1, f?: Foe): Act {
    const c = this.c;
    c.halt();
    c.lookYaw = 70 * side; c.lookPitch = 0;
    c.setPhase("sweep");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.78);
    for (let t = 0; t < 36; t++) {
      c.lookYaw = 70 * side;
      if (t === 11) sound(c.dim, "basiliskra.iii.club_swing", c.anchor("club_core"), 160, 1, 0.9);
      if (t === 15) {
        let struck = false;
        for (const g of otherGiants(c)) {
          const b = wrapDeg(yawTo(c.pos, g.pos) - c.yaw) * side;
          if (b < 35 || distXZ(g.pos, c.pos) > c.girth + g.girth + 24) continue;
          g.takeBlow(c, this.blows.tail, true);
          g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, 7);
          this.duelImpact({ x: (g.pos.x + c.pos.x) / 2, y: c.pos.y + 8, z: (g.pos.z + c.pos.z) / 2 }, true);
          struck = true;
        }
        // another add-on's monster has no body of ours: it is struck where it stands, if it is on that side and in reach
        if (f && !f.g && this.foeAlive(f)) {
          const at = f.e.location, b = wrapDeg(yawTo(c.pos, at) - c.yaw) * side;
          if (b >= 35 && distXZ(at, c.pos) <= c.girth + 28) {
            try { f.e.applyDamage(c.mobHit(this.blows.tail), { cause: EntityDamageCause.entityAttack, damagingEntity: c.entity }); } catch { /* gone */ }
            this.duelImpact({ x: (at.x + c.pos.x) / 2, y: c.pos.y + 8, z: (at.z + c.pos.z) / 2 }, true);
            struck = true;
          }
        }
        for (const deg of [65, 105, 145]) {
          const fw = { x: -Math.sin((c.yaw + deg * side) * Math.PI / 180), y: 0, z: Math.cos((c.yaw + deg * side) * Math.PI / 180) };
          const at = { x: c.pos.x + fw.x * 20, y: c.pos.y + 1.5, z: c.pos.z + fw.z * 20 };
          if (!isLoaded(c.dim, at)) continue;
          blast(c.dim, at, 9, 14, c.mobHit(30), 1.6, (p, n) => c.hurt(p, n), c.entity, c.pos);
          if (wither()) carve(c.dim, at, 3.6, 120, false);
          particle(c.dim, "basiliskra:step_dust", at, 128);
        }
        sound(c.dim, "basiliskra.iii.club_plant", c.anchor("club_core"), 160, 1, 1.2);
        if (!struck) shake(c, 96, 0.5, 0.4);
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
  }

  /**
   * He leaps back from what he is fighting, to have room to breathe at it: a crouch; off the ground and back over it
   * (from 0.35 s to 1.15 s, the client draws the same), still facing it; the landing, which the ground feels.  He comes
   * down on open, loaded ground near his own height, as far back as there is such ground (at least half his leap).
   * Returns false, having done nothing, if there is none.
   */
  protected *leapBack(f: Foe): Generator<void, boolean, void> {
    const c = this.c;
    const { far, high } = this.leapReach();
    const from = this.foeAt(f);
    const away = norm({ x: c.pos.x - from.x, y: 0, z: c.pos.z - from.z });
    let land: V3 | null = null;
    for (let k = far; k >= far * 0.5; k -= 2) {
      const x = c.pos.x + away.x * k, z = c.pos.z + away.z * k;
      if (!isLoaded(c.dim, { x, y: c.pos.y, z })) continue;
      const g = groundY(c.dim, x, z, c.pos.y + 12, 28);
      if (typeof g !== "number" || Math.abs(g - c.pos.y) > 10) continue;
      land = { x, y: g, z };
      break;
    }
    if (!land) return false;
    const start = { ...c.pos };
    c.halt();
    c.setPhase("leap");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.8);
    for (let t = 0; t < 7; t++) { c.lookAt(this.foeMiddle(f), 70, 40); yield; }
    sound(c.dim, "basiliskra.iii.step", start, 160, 1, 0.6);
    particle(c.dim, "basiliskra:step_dust", start, 128);
    shake(c, 128, 0.7, 0.4);
    c.airborne = true;
    try {
      const n = 16;
      for (let t = 0; t < n; t++) {
        const u = (t + 1) / n, s = u * u * (3 - 2 * u);
        c.pos = { x: start.x + (land.x - start.x) * s, y: start.y + (land.y - start.y) * s + high * Math.sin(Math.PI * u), z: start.z + (land.z - start.z) * s };
        if (this.foeAlive(f)) { c.yaw = turnTowards(c.yaw, yawTo(c.pos, this.foeAt(f)), 2); c.lookAt(this.foeMiddle(f), 70, 40); }
        yield;
      }
    } finally {
      c.airborne = false;
    }
    c.pos = { ...land };
    // the landing
    sound(c.dim, "basiliskra.iii.step", land, 192, 1, 0.5);
    sound(c.dim, "random.explode", land, 160, 1.2, 0.6);
    particle(c.dim, "basiliskra:impact_ring", { x: land.x, y: land.y + 0.4, z: land.z }, 192);
    particle(c.dim, "basiliskra:step_dust", land, 160);
    particle(c.dim, "basiliskra:impact_debris", land, 128);
    shake(c, 160, 1.1, 0.6);
    blast(c.dim, land, 4 * c.scale, 10, c.mobHit(20), 1.2, (p, n) => c.hurt(p, n), c.entity, land);
    if (wither()) c.stompWave(14, 4, 34);
    for (let t = 0; t < 7; t++) yield;
    c.setPhase("idle");
    return true;
  }

  /** Back, then his breath at it as he lands (if he could not leap, he breathes where he stands). */
  protected *leapAndBreathe(f: Foe): Act {
    yield* this.leapBack(f);
    if (!this.foeAlive(f)) return;
    yield* this.breatheAt(f);
  }

  /** How long, from the end of one breath at another giant, until the next: the time he spends fighting it with his body. */
  protected breathGap(): number { return 22 * TICKS.second; }

  /** His breath at another giant; the wait for the next is counted from the end of this one, so he goes in between. */
  protected *breatheAt(f: Foe): Act {
    this.inDuel = true;
    try { yield* this.duelBreath(f.e); } finally {
      this.inDuel = false;
      this.rest("beam", this.breathGap());
      this.rest("leap", this.breathGap());
    }
  }

  protected *raze(town: V3): Act {
    const c = this.c;
    for (let leg = 0; leg < 4; leg++) {
      const there = distXZ(c.pos, town) < 60;
      const a = hash(this.now, leg, 51) * Math.PI * 2, r = there ? 22 + 34 * hash(this.now, leg, 52) : 12 * hash(this.now, leg, 53);
      const got = yield* this.walk({ x: town.x + Math.cos(a) * r, y: town.y, z: town.z + Math.sin(a) * r }, this.c.form === 4 ? 0.16 : 0.14, 9, 1500);
      if (!got) break;
      // something alive within reach: that comes first
      if (nearbyPlayers(c, 80).length || this.creatures().length) break;
      if (leg % 2 === 1 && there) c.say("basiliskra.iii.growl", c.anchor("nose"), 96, 1, 0.9);
    }
    c.setPhase("idle");
    yield* wait(30);
  }

  // ---- four footfalls --------------------------------------------------------------------------
  /** Walk, landing one foot every quarter stride: left hind, left fore, right hind, right fore. */
  *walk(target: V3, speed: number, arrive: number, timeout: number, phase: "move" | "stalk" = "move"): Generator<void, boolean, void> {
    const c = this.c;
    c.setPhase(phase);
    c.goTo(target, speed, arrive);
    c.smash = phase === "move";
    let t = 0;
    while (!c.arrived()) {
      if (++t > timeout || c.blocked > 50) { c.halt(); c.smash = false; return false; }
      this.footfalls();
      yield;
    }
    c.halt();
    c.smash = false;
    return true;
  }

  protected footfalls(): void {
    const c = this.c;
    // where the client's walk cycle is (the same sum it does): the hit volumes on his legs follow it
    c.walkPhase = (((this.beat - 1) & 3) + clamp((c.travelled - this.stepAt) / (STRIDE_III / 4), 0, 1.15)) * 90;
    if (c.travelled - this.stepAt < STRIDE_III / 4) return;
    // exactly a quarter stride on from the last one (what he overshot within the tick is not lost), unless he has been far
    this.stepAt = c.travelled - this.stepAt < STRIDE_III / 2 ? this.stepAt + STRIDE_III / 4 : c.travelled;
    // name the foot that lands: every client's walk cycle is locked to this, so the sound and the sole agree
    const k = this.beat & 3;
    c.set(PROP.gait, k);
    const foot = add(c.anchor(FEET[k]), mul(c.forward, STANCE_III / 2));       // it lands half a stance ahead of the hip
    this.beat++;
    this.rec.mut.overland += STRIDE_III / 4;
    sound(c.dim, this.voices.step, foot, 112, 1, 0.86 + (this.beat & 3) * 0.03);
    const ground = { x: foot.x, y: c.pos.y + 0.1, z: foot.z };
    particle(c.dim, "basiliskra:step_dust", ground, 72);
    for (const p of witnesses(c.dim, foot, 40)) {
      const f = 1 - dist(p.location, foot) / 40;
      try { p.runCommand(`camerashake add @s ${(0.06 + 0.16 * f).toFixed(2)} 0.25 positional`); } catch { /* commands unavailable: the sound carries it */ }
    }
    // whatever is under the foot when it comes down; and the shock of it rolls on ahead of him
    // (his feet are close under him: the ground they land on is not broken, or he would walk himself into a trench)
    blast(c.dim, ground, 2.2 * c.scale, 6, 14 * c.might, 0.9, (p, n) => c.hurt(p, n), c.entity, ground);
    if (c.smash && wither()) c.stompWave(14, 4, 34);
    if (!CONFIG.marks) return;
    // a print pressed into natural ground: never into a floor
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const at = { x: Math.floor(foot.x) + dx, y: Math.floor(c.pos.y - 0.5), z: Math.floor(foot.z) + dz };
      const b = takesMark(c.dim, at);
      const to = b ? printOf(b.typeId) : undefined;
      if (b && to) { try { b.setType(to); } catch { /* protected */ } }
    }
  }

  protected *roam(): Act {
    const c = this.c;
    // he keeps near whoever is about (a Creative player too: he will not hunt them, but he stays where they are)
    const near = watchersNear(c, 110);
    let target: V3;
    if (near.length) {
      const p = near[0].location;
      const a = hash(this.now, 41) * Math.PI * 2;
      const r = 22 + 12 * hash(this.now, 42);
      target = { x: p.x + Math.cos(a) * r, y: p.y, z: p.z + Math.sin(a) * r };
    } else {
      // nobody about: where he was last brought; else the coast that called him; else the seam; else where he stands
      const home = this.rec.home ?? this.rec.origin ?? this.rec.rift ?? c.pos;
      const a = hash(this.now, 43) * Math.PI * 2;
      target = { x: home.x + Math.cos(a) * 40, y: c.pos.y, z: home.z + Math.sin(a) * 40 };
    }
    yield* this.walk(target, 0.13, 6, 1500);
    c.setPhase("idle");
    for (let t = 0; t < 140; t++) {
      if (t === 30) c.say(hash(this.now, 17) < 0.5 ? "basiliskra.iii.breath" : "basiliskra.iii.grunt", c.anchor("nose"), 64, 0.9, 0.95);
      yield;
    }
  }

  // ---- the eye at the window ------------------------------------------------------------------------
  protected indoors(p: Player): boolean {
    const c = this.c, head = p.getHeadLocation();
    let roof = false;
    for (let y = 1; y <= 7 && !roof; y++) roof = isSolidBlock(blockAt(c.dim, { x: head.x, y: head.y + y, z: head.z }));
    if (!roof) return false;
    let walls = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = 1; r <= 7; r++) if (isSolidBlock(blockAt(c.dim, { x: head.x + dx * r, y: head.y, z: head.z + dz * r }))) { walls++; break; }
    }
    return walls >= 3;
  }

  /**
   * Which way out of the room is there glass or an opening, how far off, and where is the middle of
   * the pane?  Of several, the one nearest to where he already is.
   */
  protected windowDir(p: Player): { dir: V3; reach: number; pane: V3 } {
    const c = this.c, head = p.getHeadLocation();
    const toHim = norm({ x: c.pos.x - head.x, y: 0, z: c.pos.z - head.z });
    const glassy = (x: number, y: number, z: number) => /glass|iron_bars/.test(idAt(c.dim, { x, y, z }) ?? "");
    let best = toHim, score = -2, reach = 3, pane = add(head, mul(toHim, 3));
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, d = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      let open = false, at = 3, mid = add(head, mul(d, 3));
      for (let r = 1; r <= 9; r++) {
        const q = { x: head.x + d.x * r, y: head.y, z: head.z + d.z * r };
        const b = blockAt(c.dim, q);
        if (!b) break;
        if (/glass|iron_bars|fence_gate/.test(b.typeId)) {
          // the pane runs along the wall: find both ends of it, and aim at the middle
          const bx = Math.floor(q.x), by = Math.floor(q.y), bz = Math.floor(q.z);
          const along = Math.abs(d.x) >= Math.abs(d.z) ? { x: 0, z: 1 } : { x: 1, z: 0 };
          let lo = 0, hi = 0;
          while (lo > -3 && glassy(bx + along.x * (lo - 1), by, bz + along.z * (lo - 1))) lo--;
          while (hi < 3 && glassy(bx + along.x * (hi + 1), by, bz + along.z * (hi + 1))) hi++;
          mid = { x: bx + 0.5 + along.x * (lo + hi) / 2, y: head.y, z: bz + 0.5 + along.z * (lo + hi) / 2 };
          open = true; at = r; break;
        }
        if (isSolidBlock(b)) break;
        if (r === 9) open = true;                 // a doorway, a missing wall: he comes as near as to a wall three blocks off
      }
      if (open && dot(d, toHim) > score) { score = dot(d, toHim); best = d; reach = at; pane = mid; }
    }
    return { dir: best, reach, pane };
  }

  /** Turn where he stands: the feet shuffle round, one planted at a time. */
  /** The feet he shuffles on when he turns on the spot (Form IV and the Titan stand on two). */
  protected shuffleFeet(): string[] { return FEET; }

  protected *face(target: V3, limit = 400): Act {
    const c = this.c;
    c.setPhase("move");
    for (let t = 0; t < limit; t++) {
      const want = yawTo(c.pos, target);
      if (Math.abs(wrapDeg(want - c.yaw)) < 2) break;
      c.yaw = turnTowards(c.yaw, want, 1.1);
      if (t % 18 === 9) {
        // a shuffle on the spot: heard, but it is not a stride (the walk cycle is left where it stood)
        const feet = this.shuffleFeet();
        const foot = c.anchor(feet[Math.floor(t / 18) % feet.length]);
        sound(c.dim, "basiliskra.iii.step", foot, 72, 0.7, 0.98);
      }
      yield;
    }
  }

  protected *window(p: Player): Act {
    const c = this.c;
    const ok = () => { try { return p.isValid && p.dimension.id === c.dim.id; } catch { return false; } };
    const { dir: out, pane } = this.windowDir(p);
    // He comes round to the side with the glass and stops well short of it.  Where he ends is measured from
    // the pane, not from the player: with the neck brought down, his left eye hangs a stride outside the
    // middle of it (the eye sits a little to the right of his line once the skull has turned).
    const left = leftOf(yawTo(out, { x: 0, y: 0, z: 0 }));
    const line = (d: number): V3 => add(add(pane, mul(out, d)), mul(left, WINDOW_EYE_LEFT));
    const RUN = STRIDE_III;                                 // four quarter-strides
    if (!(yield* this.walk(line(WINDOW_STANDOFF + RUN), 0.13, 0.4, 2400))) return;
    if (!ok()) return;
    yield* this.face(line(0));
    c.setPhase("idle");
    yield* wait(50);
    if (!ok()) return;
    // four footfalls, evenly spaced, and nothing after the fourth: he stops dead on the last one, exactly
    // where the lowered head reaches the glass.  The neck comes down as he walks them (there is no room
    // to bring that head down once he stands at the wall), so the eye arrives at the pane with the last step.
    c.setPhase("stalk");
    c.goTo(line(WINDOW_STANDOFF - 6), STRIDE_III / 4 / KNOCK_GAP_TICKS, 0.3);
    c.speed = STRIDE_III / 4 / KNOCK_GAP_TICKS;             // from the first tick: four equal intervals, one beat each
    this.stepAt = c.travelled;
    const first = this.beat;
    for (let t = 0; t < 200 && this.beat - first < 4 && c.blocked < 20; t++) {
      this.footfalls();
      if (this.beat - first < 4) yield;
    }
    c.halt(); c.speed = 0;
    if (!ok()) return;
    c.setPhase("window");
    for (let t = 0; t < 260 && ok(); t++) {
      // one small eye, level with the window.  The pose brings the head down; only its turn follows the player.
      c.lookAt(p.getHeadLocation(), 18, 0);
      if (t % 80 === 10) { try { p.playSound("basiliskra.iii.window_breath", { location: c.anchor("nose"), volume: 1 }); } catch { /* gone */ } }
      yield;
    }
    c.lookAhead();
    // he leaves as he came, head still down, and only lifts it once he is clear of the house
    yield* this.walk(line(WINDOW_STANDOFF + RUN + 3), 0.12, 2.5, 500, "stalk");
    c.setPhase("idle");
    yield* wait(50);
    yield* this.walk(add(c.pos, mul(out, 24)), 0.13, 5, 700);
  }

  // ---- the roar ----------------------------------------------------------------------------------------
  /**
   * His roar: head up, jaw open, the ground carrying it.  The whole of it for the things that happen once
   * (the last change, the last crossing); the short bellow for the things that happen again.
   */
  *roar(whole: boolean): Act {
    const c = this.c;
    c.halt();
    c.setPhase("roar");
    c.say(whole ? "basiliskra.roar" : "basiliskra.roar_short", c.anchor("mouth"), whole ? 192 : 160);
    // the screen shakes, and a shockwave runs out from his feet: it throws and hurts, and breaks what is brittle
    const fx = new RoarFx(c, whole, whole ? 40 : 30, whole ? 7 : 5);
    const ticks = whole ? 160 : 88;          // as long as the sound (10 s and 4.4 s)
    for (let t = 0; t < ticks; t++) { fx.tick(); yield; }
    c.setPhase("idle");
  }

  // ---- he remembers you --------------------------------------------------------------------------------
  protected *remember(g: Player): Act {
    const c = this.c;
    const ok = () => { try { return g.isValid && targetable(g) && g.dimension.id === c.dim.id; } catch { return false; } };
    c.halt();
    // his feet stay where they were pointed; only the head comes round.  A few seconds to move.
    c.setPhase("look");
    c.say("basiliskra.iii.neck_turn", c.anchor("nose"), 48);
    for (let t = 0; t < 110 && ok(); t++) {
      c.lookAt(g.getHeadLocation(), 85, 35);
      if (t === 36) c.say("basiliskra.iii.growl", c.anchor("nose"), 72);
      yield;
    }
    if (!ok()) return;
    yield* this.roar(false);
    if (!ok()) return;
    // from now it is that player he follows: lead him into the open and everyone else has a way out
    this.prey = g.id;
    this.preyUntil = this.now + 70 * TICKS.second;
    c.lookAhead();
  }

  /** After it: players at a walk he can keep up with, creatures until he is on them; whatever is underfoot is trodden. */
  protected *pursue(g: Quarry): Act {
    const c = this.c;
    const player = isPlayer(g);
    c.smash = true;
    for (let t = 0; t < 360; t++) {
      let at: V3;
      try { if (!g.isValid || g.dimension.id !== c.dim.id || (player && !targetable(g as Player))) break; at = g.location; } catch { break; }
      c.setPhase("move");
      const keep = standOff(c, g, 17 * c.scale * 0.6, 3);
      if (t === 0 && dist(at, c.pos) < keep + 1) { yield* this.watch(g, 30); break; }
      c.goTo(at, 0.15, keep);
      c.lookAt(headOf(g), 60, 25);
      this.footfalls();
      if (dist(at, c.pos) < keep + 1) break;
      if (t % 100 === 50) c.say(this.voices.grunt, c.anchor("nose"), 72, 1, 0.92 + hash(t) * 0.1);
      yield;
    }
    c.halt();
    c.smash = false;
  }

  /** Already as near as he means to come: he stands and watches it for a moment. */
  protected *watch(g: Quarry, ticks: number): Act {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < ticks; t++) {
      try { if (!g.isValid || g.dimension.id !== c.dim.id) break; c.lookAt(headOf(g), 70, 40); } catch { break; }
      yield;
    }
  }

  // ---- grounding ------------------------------------------------------------------------------------------
  /** A point on the planted club that is above the ground it rests on. */
  protected clubTop(): V3 {
    const k = this.c.anchor("club_core");
    return { x: k.x, y: Math.max(k.y, this.c.pos.y + 1.6), z: k.z };
  }

  /** Rods seen near the club during this charge, by layer: the whole reach is read once every twelve ticks. */
  protected rodSeen = new Map<string, V3>();
  protected rodLayer = 0;
  protected scanRods(layers = 1): void {
    const c = this.c;
    const club = c.anchor("club_core");
    const y0 = Math.floor(c.pos.y), cx = Math.floor(club.x), cz = Math.floor(club.z);
    for (let n = 0; n < layers; n++) {
      const y = y0 - 3 + (this.rodLayer++ % 12);
      for (let dx = -ROD_REACH; dx <= ROD_REACH; dx++) for (let dz = -ROD_REACH; dz <= ROD_REACH; dz++) {
        if (dx * dx + dz * dz > ROD_REACH * ROD_REACH) continue;
        const p = { x: cx + dx, y, z: cz + dz };
        const id = idAt(c.dim, p);
        const key = `${p.x},${p.y},${p.z}`;
        if (id && ROD.test(id)) this.rodSeen.set(key, p); else this.rodSeen.delete(key);
      }
    }
  }
  /** The nearest usable rod among those seen (still a rod, not recovering from the last strike). */
  protected findRod(): V3 | null {
    const c = this.c;
    const club = c.anchor("club_core");
    let best: V3 | null = null, bd = 1e9;
    for (const [key, p] of this.rodSeen) {
      const id = idAt(c.dim, p);
      if (!id || !ROD.test(id)) { this.rodSeen.delete(key); continue; }
      if ((rodReady.get(key) ?? 0) > this.now) continue;      // still recovering from the last strike
      const d = Math.hypot(p.x + 0.5 - club.x, p.z + 0.5 - club.z);
      if (d <= ROD_REACH && d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** The discharge leaves one particular spike tip for the rod; the ridge collapses; the throat goes dark. */
  protected *ground(rod: V3): Act {
    const c = this.c;
    const top = { x: rod.x + 0.5, y: rod.y + 1, z: rod.z + 0.5 };
    let tip = c.anchor("spike_tip_0"), bd = 1e9;
    for (let k = 0; k < 12; k++) { const s = c.anchor(`spike_tip_${k}`); const d = dist(s, top); if (d < bd) { bd = d; tip = s; } }
    rodReady.set(`${rod.x},${rod.y},${rod.z}`, this.now + 30 * TICKS.second);
    if (rodReady.size > 64) rodReady.clear();
    this.rec.learned.rods++;
    this.groundedAt = { tick: this.now, rod };
    addFallout(rod, 2.5, 0.5);                                         // the charge goes to ground there
    c.setPhase("grounded");
    sound(c.dim, "basiliskra.iii.ground", top, 96);
    const steps = Math.max(4, Math.ceil(dist(tip, top) * 1.6));
    for (let t = 0; t < 50; t++) {
      if (t < 14 && t % 2 === 0) {
        // a forked scarlet arc: particles only, never real lightning
        for (let i = 0; i <= steps; i++) {
          const k = i / steps;
          const j = (i === 0 || i === steps) ? 0 : 0.7;
          particle(c.dim, "basiliskra:arc_seg", {
            x: tip.x + (top.x - tip.x) * k + (hash(t, i, 1) - 0.5) * j,
            y: tip.y + (top.y - tip.y) * k + (hash(t, i, 2) - 0.5) * j,
            z: tip.z + (top.z - tip.z) * k + (hash(t, i, 3) - 0.5) * j }, 128);
        }
      }
      c.setCharge(c.charge - 1.5);
      if (t === 16) c.say("basiliskra.iii.fizzle", c.anchor("mouth"), 64);
      yield;
    }
    c.setCharge(0);
    // robbed of it, he roars
    yield* wait(14);
    yield* this.roar(false);
  }

  // ---- the red beam -----------------------------------------------------------------------------------------
  protected *vent(): Act {
    const c = this.c;
    c.setPhase("vent");
    for (let k = 0; k < 3; k++) {
      // the same three knocks he made under the water
      c.say("basiliskra.knock.vent", c.anchor("gill_l"), 64, 1, 1 - k * 0.03);
      c.pulse(3);
      for (let i = 0; i < KNOCK_GAP_TICKS; i++) { c.setCharge(c.charge - 0.34); yield; }
    }
    c.setCharge(0);
  }

  *beam(target: Quarry | null): Act {
    const c = this.c;
    const tier = this.tier();
    const T = TIERS[tier];
    c.set(PROP.tier, tier);
    const ok = () => { try { return !target || (target.isValid && target.dimension.id === c.dim.id); } catch { return false; } };
    const flying = !!target && isFlyer(target);
    const aimAt = (): V3 => (target ? aimOf(target) : add(c.anchor("mouth"), mul(c.forward, 30)));
    const pitchMax = flying ? 80 : 40;
    // (1.9) at anything on the ground: his head goes down, black smoke pours out onto the ground and catches, he
    // rears back to the sky, and slams forward into the shot (pour.ts); what flies is watched instead
    const pour = !flying;
    const ps = freshPour();
    const charging = (): V3 => (pour ? groundAhead(c, aimAt()) : aimAt());
    const chargeMax = pour ? 80 : pitchMax;
    const spec: BeamSpec = { ...T, fallout: [0, 3, 4, 5][tier], rough: tier === 1 };
    c.halt();
    // 1. the club plants first, and the breath begins: the charge lasts exactly as long as its sound
    c.setPhase("charge");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 112);
    c.say("basiliskra.iii.charge", c.anchor("throat"), 128);
    this.chargeSounding = true;
    this.rodSeen.clear(); this.rodLayer = 0;
    for (let t = 0; t < PLANT_TICKS; t++) { c.setCharge(t / 7); if (ok()) c.trackTo(charging(), 3, 80, chargeMax); this.scanRods(); yield; }
    // 2. the ridge lights, tail to shoulders, and the whole hide with it
    let rod: V3 | null = null;
    let lit = 1;
    const light = LIGHT_END - PLANT_TICKS;
    if (pour) c.setPhase("pour");
    for (let t = 0; t < light; t++) {
      if (!ok()) return;                     // (onFinish cuts the sound)
      const aim = aimAt();
      let off: number;
      if (pour) {
        // the smoke, then the fire, poured onto the ground in front of him
        pourTick(c, spec, ps, t, light, aimAt, (hit) => this.scorch(hit));
        off = Math.abs(c.lookYaw) > 70 ? 1 : 0;
      } else off = c.aimAt(aim, 80, pitchMax);
      if (off > 0) c.yaw = turnTowards(c.yaw, yawTo(c.pos, aim), flying ? 1.4 : 0.6);      // feet shuffle only if the neck cannot reach
      c.setCharge(2 + (t / light) * 13.4);                                     // 15 at most: 16 is the lock, and the eye still follows here
      const zone = Math.floor(c.charge / 2);
      if (zone > lit) {
        lit = zone;
        sound(c.dim, "basiliskra.iii.charge_tick", c.anchor(zone >= 6 ? "throat" : zone >= 3 ? "plate_tip_5" : "club_core"), 72, 0.55, 0.75 + zone * 0.09);
      }
      if (t % 20 === 10) shake(c, 48, 0.12 + 0.2 * (t / light), 1.0);           // the ground hums under him
      this.scanRods();
      yield;
    }
    // 3. the eye stops following.  From here the aim is fixed: step sideways and it misses.
    rod = this.findRod();
    if (rod && clearLine(c.dim, this.clubTop(), { x: rod.x + 0.5, y: rod.y + 1.2, z: rod.z + 0.5 })) {
      this.chargeSounding = false;
      stopSound(c.dim, "basiliskra.iii.charge", c.pos);
      yield* this.ground(rod);
      yield* wait(30);
      this.recoverUntil = this.now + 8 * TICKS.second;
      return;
    }
    const lock = CHARGE_TICKS - LIGHT_END;
    // (the place he means to hit is fixed here: the beam sweeps up to it, not to wherever the quarry has gone since)
    const mark = aimAt();
    // he rears back: head thrown up to the sky, the light gathering in his mouth
    if (pour) c.setPhase("rear");
    for (let t = 0; t < lock; t++) {
      c.setCharge(16 + (t / lock) * 2);
      if (pour) rearTick(c, spec, ps, t, lock, mark);
      // (what flies is not given the chance to step aside: his eye keeps after it)
      if (flying && ok()) c.trackTo(aimAt(), 4, 80, 80);
      // a thin line down the path it will take: this is where not to be standing
      if (t % 2 === 0) {
        // (his head is down: the line is drawn where the beam will end up, from his mouth to what he means to hit)
        const { from, dir: d0 } = c.aim();
        const dir = pour ? norm(sub(aimAt(), from)) : d0;
        particle(c.dim, "basiliskra:beam_aim", from, 128, beamVars(dir, clearRange(c, from, dir, T.range), 0.22 + 0.5 * (t / lock)));
      }
      yield;
    }
    // 4. fire, on the moment the recording does
    c.setPhase("fire");
    c.setCharge(20);
    this.rec.mut.beams++;
    this.rec.mut.lastEncounter = this.now;
    this.chargeSounding = false;
    c.say("basiliskra.iii.beam", c.anchor("mouth"), 160);
    {
      // the moment it lights: a flare and a shock ring at his mouth, and every screen near him whites out for an instant
      const { from, dir } = c.aim();
      particle(c.dim, "basiliskra:muzzle_flash", from, 160, beamVars(dir, 1, TIERS[this.tier()].width));
      particle(c.dim, "basiliskra:muzzle_shock", from, 160, beamVars(dir, 1, TIERS[this.tier()].width));
      flash(c.dim, from, 56, { red: 1, green: 0.5, blue: 0.42 }, 0.03, 0.04, 0.3);
      shake(c, 96, 0.9, 0.5);
    }
    // where the beam is landing: it blasts out a crater there (it does not bore on for ever), the poison gathers
    // there, and when his aim moves on, so does the crater
    const st: BeamState = { ground: null };
    // he slams forward: the beam goes into the burning ground in front of him and sweeps up to its mark
    if (pour) yield* slamAndLift(c, spec, ps, st, () => mark, (hit) => this.scorch(hit));
    // (the sweep is the start of the shot: it still lasts as long as its recording)
    for (let t = pour ? POUR.lift : 0; t < FIRE_FULL + FIRE_FADE; t++) {
      const fade = t < FIRE_FULL ? 1 : 1 - (t - FIRE_FULL) / FIRE_FADE;
      // the focused beam is walked slowly after its quarry; the raw one wanders where it will
      // (never as fast as a player walks sideways at the range he fires from: stepping out of the line still works)
      if (flying && target && ok() && (!isPlayer(target) || targetable(target as Player))) {
        // after something that flies he swings his head round with it, ahead of it
        c.trackTo(aimOf(target), tier === 1 ? 2.2 : 3.2, 80, 80);
      } else if (tier >= 2 && target && ok() && (!isPlayer(target) || targetable(target as Player))) {
        const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
        const rate = tier === 2 ? 0.22 : 0.3;
        c.lookYaw += clamp(want - c.lookYaw, -rate, rate);
      } else if (tier === 1) c.lookYaw = clamp(c.lookYaw + Math.sin(t * 0.09) * 0.12, -80, 80);
      // (the raw beam sputters: three ticks in every seventeen it is not there at all)
      if (!(tier === 1 && t % 17 >= 14)) beamTick(c, spec, t, fade, st, { scorch: (hit) => this.scorch(hit) });
      if (t % 10 === 0) shake(c, 64, 0.32 * fade + 0.08, 0.6);
      yield;
    }
    // 5. heat leaves by the old gills, three knocks, while the breath's long tail plays out; then he roars
    yield* this.vent();
    yield* this.roar(tier === 3 && hash(this.now, 61) < 0.3);
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
    yield* wait(40);
  }

  /** Mark what the beam touched.  Natural ground only; never a block with an inventory, a bed, a portal or redstone. */
  protected scorch(at: V3): void {
    if (CONFIG.terrain === "none") return;
    const c = this.c;
    // if what the beam met is not the world's own ground (glass, planks, a chest, anything built), nothing is touched
    const hit = blockAt(c.dim, at);
    if (!hit || !isNaturalGround(hit.typeId)) return;
    const free = (x: number, y: number, z: number) => { const b = blockAt(c.dim, { x, y, z }); return !!b && !isSolidBlock(b); };
    const built = (x: number, y: number, z: number) => { const b = blockAt(c.dim, { x, y, z }); return !!b && isSolidBlock(b) && !isNaturalGround(b.typeId) && !isPlantBlock(b.typeId); };
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
      const x = Math.floor(at.x) + dx, y = Math.floor(at.y) + dy, z = Math.floor(at.z) + dz;
      const b = blockAt(c.dim, { x, y, z });
      if (!b) continue;
      const id = b.typeId;
      if (Math.abs(dx) + Math.abs(dz) <= 1 && fuse(b)) continue;            // sand the beam touches fuses into scarlet trinitite
      const to = scorchOf(id);
      if (!to && !(CONFIG.terrain === "break" && isBreakableNatural(id))) continue;
      // ground is backed by ground: a block open on two opposite sides is a wall or a pillar somebody raised,
      // and a block touching anything built is part of the build
      if ((free(x + 1, y, z) && free(x - 1, y, z)) || (free(x, y, z + 1) && free(x, y, z - 1))) continue;
      if (built(x + 1, y, z) || built(x - 1, y, z) || built(x, y, z + 1) || built(x, y, z - 1) || built(x, y + 1, z) || built(x, y - 1, z)) continue;
      try {
        if (CONFIG.terrain === "break" && dx === 0 && dy === 0 && dz === 0 && isBreakableNatural(id)) b.setType("minecraft:air");
        else if (to) b.setType(to);
      } catch { /* protected area */ }
    }
  }

  // ---- the ridge scatter ---------------------------------------------------------------------------------------
  protected *scatter(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("scatter");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 96);
    this.rodSeen.clear(); this.rodLayer = 0;
    for (let t = 0; t < 34; t++) { c.setCharge((t / 34) * 18); this.scanRods(); if (t % 5 === 0) sound(c.dim, "basiliskra.iii.charge_tick", c.anchor("plate_tip_4"), 64, 0.8, 1.5 - t * 0.02); yield; }
    const rod = this.findRod();
    if (rod && clearLine(c.dim, this.clubTop(), { x: rod.x + 0.5, y: rod.y + 1.2, z: rod.z + 0.5 })) { yield* this.ground(rod); return; }
    c.setCharge(20);
    c.say("basiliskra.iii.scatter", c.anchor("plate_tip_5"), 112);
    const l = leftOf(c.yaw);
    for (let t = 0; t < 56; t++) {
      // a fan of thin rays from the plate tips that closes towards the ground: the safe place is in front of him
      const elev = (70 - (t / 56) * 58) * Math.PI / 180;
      for (let k = 0; k < 10; k++) {
        if ((t + k) % 2) continue;
        const side = k % 2 ? 1 : -1;
        const from = c.anchor(`plate_tip_${k}`);
        const dir = norm({ x: l.x * side * Math.cos(elev) + c.forward.x * (k - 4.5) * -0.05, y: Math.sin(elev), z: l.z * side * Math.cos(elev) + c.forward.z * (k - 4.5) * -0.05 });
        let length = 26;
        try {
          const hit = c.dim.getBlockFromRay(from, dir, { maxDistance: 26, includeLiquidBlocks: false, includePassableBlocks: false });
          if (hit) {
            length = Math.max(0.5, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })));
            if (t % 10 === 0) addFallout(hit.block.location, 2, 0.05);
          }
        } catch { length = 4; }
        particle(c.dim, "basiliskra:beam_core", from, 96, beamVars(dir, length, 0.22));
        if (t % 5 === 0) {
          for (const p of nearbyPlayers(c, 34)) {
            if (segDist(add(p.location, { x: 0, y: 0.9, z: 0 }), from, dir, length) <= 0.75) c.hurt(p, 4);
          }
        }
      }
      yield;
    }
    this.rec.mut.lastEncounter = this.now;
    yield* this.vent();
    this.recoverUntil = this.now + 8 * TICKS.second;
  }
}
