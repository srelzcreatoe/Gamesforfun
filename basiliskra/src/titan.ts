/**
 * The Titan: Basiliskra IV's body as an entity of its own, for battles.
 *
 * It is not the one Basiliskra and has no part in his story: no rift, no changes, no leaving.  It is made on
 * purpose (its spawn egg, /summon, /basiliskra:titan, the config wheel), there may be several, and it can be
 * killed.  It has far more health than he has, its breath reaches further and burns hotter, it walks faster, and
 * it fights with its body as well: jaws and claws for what stands in front of it, its tail for what stands
 * beside or behind it, and its whole weight in a charge.  What it fights, in this order: another Titan or
 * Basiliskra himself; then anything else alive that it can reach (players in Survival included).  Left alone it
 * prowls round the place it was made.
 */
import { Dimension, Entity, ItemStack, Player, world } from "@minecraft/server";
import type { BeamSpec } from "./beam";
import type { Act, Choice } from "./brain";
import { nearbyPlayers, settlementNear } from "./brain";
import { FIN_ITEM, OVERWORLD, PROP, SHARD_ITEM, TICKS, TITAN } from "./config";
import { Creature, giants, otherGiants } from "./creature";
import { addFallout, holdsCounter } from "./fallout";
import { BrainFour } from "./forms/four";
import { aimOf, type Quarry } from "./forms/three";
import { particle, players, sound, witnesses } from "./fx";
import { TITAN_HEALTH } from "./generated/rig";
import { blast, carve, wither } from "./havoc";
import { shake } from "./roar";
import { freshRecord, store, type Rec } from "./store";
import { add, dist, distXZ, forwardOf, hash, mul, norm, wrapDeg, yawTo, type V3 } from "./vec";
import { clearLine, isLoaded } from "./world";

/** How many may stand in the world at once (each is sixty hit volumes and a brain). */
export const TITAN_MAX = 3;
export const TITAN_NAMES = ["Alpha", "Beta", "Gamma"];
/**
 * How strong it is (1.7.2: "make the titan as strong as hakaishin godzilla").  That add-on's own page could not be
 * read from here; the figures found with it are 100,000 health and 100,000 damage, and those are what it has: its
 * health (TITAN_HEALTH, from tools/kit/gen_client.py), and LETHAL for whatever smaller than a giant it strikes, so
 * that any blow of its kills a player or a creature outright.  Between giants every blow is scaled by GIANT, its
 * health against the 4,000 it had, so two Titans still fight for minutes rather than for one blow.
 */
export const LETHAL = 100000;
export { TITAN_HEALTH };
export const GIANT = TITAN_HEALTH / 4000;
/** Its breath beside his: half as far again and wider; against another giant 30 x GIANT, half of it a hit as it burns (3,750), and LETHAL to anything smaller. */
export const TITAN_SPEC: BeamSpec = { range: 220, radius: 3.4, damage: 30 * GIANT, width: 4.6, carve: 5.2, fallout: 8 };
/** What its body does to another giant, and how far it throws it. */
export const BLOW = { lunge: 85 * GIANT, tail: 130 * GIANT, ram: 110 * GIANT, swipe: 100 * GIANT };
const MIGHT = 3, HASTE = 1.35;
const TAG = "bk:titan";
const PROWL = 70;

type Saved = { n: number; home: [number, number, number] };

export class BrainTitan extends BrainFour {
  /** Set when a blow would have killed it: it goes down, and then it is gone. */
  dying = false;
  /** Set when it has gone down for good: the manager takes the body away. */
  gone = false;
  private reeling = false;
  private home: V3;

  constructor(c: Creature, own: Rec, home: V3) {
    super(c, own);
    this.home = { ...home };
    this.spec = TITAN_SPEC;
    this.giantSight = 240;
    this.blows = { bite: BLOW.lunge, tail: BLOW.tail, lunge: BLOW.lunge, swipe: BLOW.swipe, ram: BLOW.ram };
    c.set(PROP.gill, false);
  }

  /** Something its own size has struck it. */
  onBlow(_by: Creature, _amount: number, heavy: boolean): void {
    this.hurtAt = this.now;
    if (heavy && this.ready("reel")) { this.rest("reel", 5 * TICKS.second); this.reeling = true; }
  }

  /** The nearest giant that is not itself. */
  foe(): Creature | null {
    let best: Creature | null = null, bd = this.giantSight;
    for (const g of otherGiants(this.c)) {
      const d = dist(g.pos, this.c.pos);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  protected interrupt(): Choice | null {
    if (this.dying) return this.actName === "fall" ? null : { name: "fall", run: this.fall(), limit: 12 * TICKS.second };
    if (this.reeling) {
      this.reeling = false;
      // a breath being drawn or let go is not broken off by a blow, nor a roar
      if (["charge", "fire", "pour", "skid", "pivot", "roar", "vent", "fall", "swipe", "leap"].includes(this.c.phase)) return null;
      return { name: "reel", run: this.reel(), limit: 3 * TICKS.second };
    }
    // with no giant to fight, small things that come within reach of its claws are swiped at (as he does)
    return this.foe() ? null : super.interrupt();
  }

  protected choose(): Choice | null {
    const c = this.c, now = this.now;
    const foe = this.foe();
    if (!foe) {
      // with nothing its own size about: whoever and whatever lives near (as Basiliskra IV does), else it prowls
      const near = nearbyPlayers(c, 170);
      if (near.length || this.creatures().length) return super.choose();
      const town = settlementNear(c, now);
      if (town && distXZ(town, this.home) < 160) return { name: "raze", run: this.raze(town), limit: 150 * TICKS.second };
      if (this.ready("rroar") && hash(now, 93) < 0.4) { this.rest("rroar", (60 + 80 * hash(now, 92)) * TICKS.second); return { name: "roar", run: this.roar(hash(now, 94) < 0.3), limit: 12 * TICKS.second }; }
      return { name: "roam", run: this.roam(), limit: 60 * TICKS.second };
    }
    const d = distXZ(foe.pos, c.pos), reach = c.girth + foe.girth;
    const bearing = wrapDeg(yawTo(c.pos, foe.pos) - c.yaw);
    // it lets a new enemy know
    if (foe.entity.id !== this.lastQuarry) {
      this.lastQuarry = foe.entity.id;
      if (this.ready("lockroar")) { this.rest("lockroar", 40 * TICKS.second); return { name: "lock", run: this.challenge(foe), limit: 14 * TICKS.second }; }
    }
    if (d < reach + 14) {
      // at arm's length: the tail for what is beside or behind it, jaws and claws for what is in front
      if (Math.abs(bearing) > 55 && this.ready("tail")) { this.rest("tail", 6 * TICKS.second); return { name: "tail", run: this.tail(bearing >= 0 ? 1 : -1), limit: 4 * TICKS.second }; }
      if (this.ready("lunge")) { this.rest("lunge", 3.5 * TICKS.second); return { name: "lunge", run: this.lunge({ g: foe, e: foe.entity }), limit: 5 * TICKS.second }; }
      // (1.8) its claws, while its jaws are not ready (now and then: it also walks round between blows)
      if (Math.abs(bearing) <= 60 && this.ready("swipe") && hash(now, 88) < 0.6) {
        this.rest("swipe", 7 * TICKS.second);
        return { name: "swipe", run: this.swipe(() => foe.middle(), foe, BLOW.swipe), limit: 4 * TICKS.second };
      }
      // between blows it walks round the enemy, which brings the enemy to its side: where the tail is
      if (this.ready("circle") && this.ready("tail")) { this.rest("circle", 9 * TICKS.second); return { name: "circle", run: this.circle(foe), limit: 8 * TICKS.second }; }
    }
    // the breath: from as far as it can see, and in the enemy's face when it comes to that
    if (this.ready("beam") && now >= this.recoverUntil && d < this.spec.range - 10) {
      if (d < reach + 16 && this.ready("leap")) {
        // too close to breathe at it: it leaps back to have room, and breathes as it lands (2.3)
        this.rest("leap", 12 * TICKS.second);
        this.rest("beam", 16 * TICKS.second);
        return { name: "leap", run: this.leapAndBreathe({ g: foe, e: foe.entity }), limit: 60 * TICKS.second };
      }
      if (d < reach + 14 && hash(now, 81) < 0.55) this.rest("beam", 5 * TICKS.second);       // not yet: it keeps to its hands
      else if (clearLine(c.dim, c.anchor("mouth"), foe.middle())) {
        this.rest("beam", 15 * TICKS.second);
        return { name: "beam", run: this.breatheAt({ g: foe, e: foe.entity }), limit: 60 * TICKS.second };
      }
    }
    if (d > reach + 34 && this.ready("ram")) { this.rest("ram", 22 * TICKS.second); return { name: "ram", run: this.ram(foe), limit: 30 * TICKS.second }; }
    if (d >= reach + 14) return { name: "pursue", run: this.pursue(foe.entity), limit: 20 * TICKS.second };
    // toe to toe with nothing ready: it turns to keep the enemy in front of it
    return { name: "square", run: this.square(foe), limit: 2 * TICKS.second };
  }

  protected leapReach(): { far: number; high: number } { return { far: 32, high: 9 }; }
  /** Its breath at another giant (when it leaps back first). */
  protected duelBreath(e: Entity): Act { return this.breath(e); }
  protected breathGap(): number { return 16 * TICKS.second; }

  /** Its breath is whole every time: nothing fails in its mouth, nothing is swallowed, no plate is shed. */
  protected *breath(target: Quarry): Act {
    const g = giants.get(target.id);
    // (where it last was, if it dies or goes while the breath is under way)
    let last: V3 = { ...target.location };
    const mark = (): V3 => {
      try { last = g && g.valid ? g.middle() : target.isValid ? aimOf(target) : last; } catch { /* gone: where it was */ }
      return last;
    };
    const got = yield* this.charge(target, mark, false);
    if (got !== "lock") { this.cutCharge(); return; }
    yield* this.fire(target, mark);
    yield* this.vent();
    // the time between two breaths is counted from the end of the first: that is when it uses its body
    // (16 s from 1.8: the pour made each breath three seconds longer, and two Titans stopped closing with each other)
    this.rest("beam", 16 * TICKS.second);
    this.recoverUntil = this.now + 3 * TICKS.second;
    this.c.setPhase("idle");
  }
  private aimPoint(e: Entity): V3 { try { return e.getHeadLocation(); } catch { return this.c.pos; } }

  private *challenge(foe: Creature): Act {
    yield* this.turnTo(foe.pos, 2.5, 60);
    this.c.lookAt(foe.middle(), 80, 40);
    yield* this.roar(false);
  }

  private *square(foe: Creature): Act {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < 14 && foe.valid; t++) {
      c.yaw = wrapDeg(c.yaw + Math.max(-2.5, Math.min(2.5, wrapDeg(yawTo(c.pos, foe.pos) - c.yaw))));
      c.lookAt(foe.middle(), 70, 40);
      yield;
    }
  }

  /** A quarter of the way round the enemy, at arm's length: it ends side-on to it. */
  private *circle(foe: Creature): Act {
    const c = this.c;
    const side = hash(this.now, 83) < 0.5 ? 1 : -1;
    const r = c.girth + foe.girth + 8;
    const a = Math.atan2(c.pos.z - foe.pos.z, c.pos.x - foe.pos.x) + side * 1.25;
    const to = { x: foe.pos.x + Math.cos(a) * r, y: c.pos.y, z: foe.pos.z + Math.sin(a) * r };
    for (let t = 0; t < 130; t++) {
      if (!foe.valid) break;
      c.setPhase("move");
      c.goTo(to, 0.2, 3);
      c.lookAt(foe.middle(), 80, 40);
      this.footfalls();
      if (distXZ(to, c.pos) < 4 || c.blocked > 30) break;
      // near enough, and the enemy already beside it: that will do
      if (t > 30 && Math.abs(wrapDeg(yawTo(c.pos, foe.pos) - c.yaw)) > 65 && distXZ(foe.pos, c.pos) < r + 6) break;
      yield;
    }
    c.halt();
  }

  /** Its whole weight, at a run: it does not stop until it has hit the enemy or lost it. */
  private *ram(foe: Creature): Act {
    const c = this.c;
    yield* this.turnTo(foe.pos, 2.5, 50);
    c.say("basiliskra.roar_short", c.anchor("mouth"), 192);
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
        // (the faster it is going, the harder it lands)
        foe.takeBlow(c, BLOW.ram * Math.min(1, 0.5 + c.speed / 0.5), true);
        foe.shove(away, 11);
        this.duelImpact({ x: (foe.pos.x + c.pos.x) / 2, y: c.pos.y + 22, z: (foe.pos.z + c.pos.z) / 2 }, true);
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

  /** Staggered by a blow from something its own size: its wings fly open and it loses a second. */
  private *reel(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("recoil");
    c.say("basiliskra.hurt", c.anchor("nose"), 128, 1, 0.82);
    for (let t = 0; t < 18; t++) yield;
    c.setPhase("idle");
  }

  /** Round the place it was made: never far from where a second one will be put down to meet it. */
  protected *roam(): Act {
    const c = this.c, now = this.now;
    const a = hash(now, 51) * Math.PI * 2, r = 20 + hash(now, 52) * (PROWL - 20);
    const to = { x: this.home.x + Math.cos(a) * r, y: c.pos.y, z: this.home.z + Math.sin(a) * r };
    yield* this.walk(to, 0.14, 8, 900);
    c.setPhase("idle");
    for (let t = 0; t < 100; t++) {
      if (t === 30) c.say(hash(now, 17) < 0.5 ? "basiliskra.iii.breath" : "basiliskra.iii.growl", c.anchor("nose"), 96, 0.9, 0.78);
      if (this.foe()) break;
      yield;
    }
  }

  /** Beaten: onto its knees, the fire in it failing, and then nothing of it but ash and what it leaves. */
  private *fall(): Act {
    const c = this.c;
    c.halt();
    c.smash = false;
    c.setCharge(0);
    c.lookAhead();
    c.setPhase("fall");
    c.say("basiliskra.roar_short", c.anchor("mouth"), 224, 1, 0.9);
    for (let t = 0; t < 96; t++) {
      c.setPhase("fall");
      if (t % 7 === 3) {
        const v = c.volumes();
        const at = v[Math.floor(hash(this.now, t) * v.length)].at;
        particle(c.dim, "minecraft:huge_explosion_emitter", at, 192);
        particle(c.dim, "basiliskra:impact_fire", at, 160);
        sound(c.dim, "random.explode", at, 160, 1.2, 0.55 + hash(t, 5) * 0.2);
      }
      if (t === 44) {
        // its knees reach the ground
        const f = forwardOf(c.yaw);
        const at = { x: c.pos.x + f.x * 6, y: c.pos.y + 0.5, z: c.pos.z + f.z * 6 };
        sound(c.dim, "basiliskra.iii.step", at, 192, 1, 0.45);
        particle(c.dim, "basiliskra:impact_ring", at, 192);
        particle(c.dim, "basiliskra:step_dust", at, 160);
        shake(c, 160, 1.6, 0.9);
        blast(c.dim, at, 12, 8, c.mobHit(30), 1.6, (p, n) => c.hurt(p, n), c.entity, c.pos);
      }
      yield;
    }
    // gone
    const mid = c.middle();
    for (const v of c.volumes()) {
      if (hash(v.at.x, v.at.z) < 0.4) particle(c.dim, "basiliskra:fallout_ash", v.at, 160);
      if (hash(v.at.z, v.at.y) < 0.25) particle(c.dim, "basiliskra:impact_smoke", v.at, 192);
    }
    particle(c.dim, "basiliskra:impact_glare", mid, 224);
    particle(c.dim, "minecraft:huge_explosion_emitter", mid, 224);
    sound(c.dim, "random.explode", mid, 224, 2, 0.4);
    addFallout({ x: Math.floor(c.pos.x), y: Math.floor(c.pos.y), z: Math.floor(c.pos.z) }, 9, 0.6);
    try {
      c.dim.spawnItem(new ItemStack(SHARD_ITEM, 24), { x: c.pos.x, y: c.pos.y + 1.5, z: c.pos.z });
      c.dim.spawnItem(new ItemStack(FIN_ITEM, 1), { x: c.pos.x + 1, y: c.pos.y + 1.5, z: c.pos.z });
    } catch { /* unloading: it leaves nothing */ }
    this.gone = true;
    yield;
  }
}

interface Titan { c: Creature; brain: BrainTitan; rec: Rec; n: number }

function tellNear(dim: Dimension, at: V3, msg: string): void {
  for (const p of witnesses(dim, at, 96)) { try { p.sendMessage(msg); } catch { /* left */ } }
}

export class Titans {
  readonly list = new Map<string, Titan>();
  /** More rows for the health line: the Vathrok Titans' (2.0; set from main.ts, so neither module loads the other). */
  extraRows: () => { c: Creature; text: string }[] = () => [];
  private hurtCry = new Map<string, number>();

  get count(): number { return this.list.size; }
  /** The body an entity is, if it is a Titan that has been taken up. */
  of(e: Entity): Titan | undefined { try { return this.list.get(e.id); } catch { return undefined; } }
  creatures(): Creature[] { return [...this.list.values()].map((t) => t.c); }
  /** Are any of them at each other, or at him, just now? */
  fighting(): boolean { for (const t of this.list.values()) if (t.brain.foe()) return true; return false; }
  /** The one nearest a place (for the music). */
  nearest(dimId: string, at: V3): Creature | null {
    let best: Creature | null = null, bd = 1e9;
    for (const t of this.list.values()) {
      if (!t.c.valid || t.c.dim.id !== dimId) continue;
      const d = dist(t.c.pos, at);
      if (d < bd) { bd = d; best = t.c; }
    }
    return best;
  }

  /** An entity of the Titan's type has appeared or loaded: it is taken up, or (one too many, the wrong world) removed. */
  inspect(e: Entity): void {
    let id: string, dimId: string, at: V3;
    try { if (!e.isValid || e.typeId !== TITAN) return; id = e.id; dimId = e.dimension.id; at = { ...e.location }; } catch { return; }
    if (this.list.has(id)) return;
    if (dimId !== OVERWORLD) {
      tellNear(e.dimension, at, "§7A Titan can only stand in the Overworld.");
      try { e.remove(); } catch { /* gone */ }
      return;
    }
    if (this.list.size >= TITAN_MAX) {
      tellNear(e.dimension, at, `§7There are ${TITAN_MAX} Titans in the world already: that is as many as there can be.`);
      try { e.remove(); } catch { /* gone */ }
      return;
    }
    this.adopt(e, at);
  }

  private adopt(e: Entity, at: V3): void {
    let saved: Saved | null = null;
    try { const s = e.getDynamicProperty(TAG); if (typeof s === "string") saved = JSON.parse(s) as Saved; } catch { saved = null; }
    const taken = new Set([...this.list.values()].map((t) => t.n));
    let n = saved && Number.isInteger(saved.n) && !taken.has(saved.n) ? saved.n : -1;
    if (n < 0) for (n = 0; taken.has(n); n++) { /* the first name not in use */ }
    const home = saved && Array.isArray(saved.home) ? { x: saved.home[0], y: saved.home[1], z: saved.home[2] } : at;
    const fresh = !saved;
    try {
      e.triggerEvent("basiliskra:bind");
      e.setDynamicProperty(TAG, JSON.stringify({ n, home: [Math.round(home.x), Math.round(home.y), Math.round(home.z)] } as Saved));
      e.nameTag = `Titan ${TITAN_NAMES[n % TITAN_NAMES.length]}`;
    } catch { return; }
    const c = new Creature(e, 4);
    c.might = MIGHT; c.haste = HASTE; c.lethal = LETHAL;
    c.resync();
    c.set(PROP.visLo, 0);
    c.set(PROP.visHi, 8);
    c.set(PROP.gait, 1);
    const rec = freshRecord();
    rec.stage = "alive"; rec.form = 4; rec.home = home;
    rec.born = rec.mut.formSince = store.rec.clock;
    rec.four = { debut: true, shots: 0, plate: null };
    const brain = new BrainTitan(c, rec, home);
    c.onBlow = (by, amount, heavy) => brain.onBlow(by, amount, heavy);
    this.list.set(e.id, { c, brain, rec, n });
    if (fresh) {
      tellNear(e.dimension, at, `§4Titan ${TITAN_NAMES[n % TITAN_NAMES.length]}§7 stands here. (${this.list.size} of ${TITAN_MAX}.)`);
      brain.forced = { name: "roar", run: brain.roar(true), limit: 12 * TICKS.second };
    }
  }

  /** Make one here (the command and the config wheel).  Returns what happened, in words. */
  spawn(dim: Dimension, at: V3, yaw: number): string {
    if (dim.id !== OVERWORLD) return "A Titan can only stand in the Overworld.";
    if (this.list.size >= TITAN_MAX) return `There are ${TITAN_MAX} Titans in the world already: that is as many as there can be.`;
    if (!isLoaded(dim, at)) return "That place is not loaded.";
    const before = this.list.size;
    try {
      const e = dim.spawnEntity(TITAN, at, { initialRotation: yaw });
      this.inspect(e);
    } catch { return "A Titan could not be made here."; }
    return this.list.size > before ? "A Titan stands here." : "A Titan could not be made here.";
  }

  /** Take every Titan out of the world.  Returns how many there were. */
  clear(): number {
    const n = this.list.size;
    for (const t of [...this.list.values()]) this.drop(t, true);
    return n;
  }

  private drop(t: Titan, remove: boolean): void {
    let id = "";
    for (const [k, v] of this.list) if (v === t) id = k;
    t.c.dropParts();
    if (id) { this.list.delete(id); giants.delete(id); this.hurtCry.delete(id); }
    if (remove) { try { t.c.entity.setProperty(PROP.bound, false); t.c.entity.remove(); } catch { /* already gone */ } }
  }

  onRemoving(e: Entity): void {
    const t = this.of(e);
    if (t) this.drop(t, false);
  }

  /**
   * A blow is about to land on a Titan.  Returns the damage it may do: all of it; or, when it would kill, none
   * (the Titan goes down in its own time, and is removed when it has).
   */
  beforeHurt(e: Entity, damage: number): number {
    const t = this.of(e);
    if (!t) return damage;
    if (t.brain.dying) return 0;
    let health = 1;
    try { health = e.getComponent("minecraft:health")?.currentValue ?? 1; } catch { health = 1; }
    if (damage >= health - 1) { t.brain.dying = true; return 0; }
    return damage;
  }

  onHurt(e: Entity, by: Entity | undefined, amount: number): void {
    const t = this.of(e);
    if (!t || amount <= 0) return;
    let player: Player | undefined;
    try { if (by && by.typeId === "minecraft:player") player = by as Player; } catch { player = undefined; }
    t.brain.onHurt(player);
    const now = store.rec.clock;
    if (amount >= 20 && now - (this.hurtCry.get(e.id) ?? -999) > 90 && !t.brain.dying) {
      this.hurtCry.set(e.id, now);
      t.c.say("basiliskra.hurt", t.c.anchor("nose"), 96, 1, 0.9);
    }
  }

  /** Health of each, for whoever is near enough to be watching the fight. */
  private hud(): void {
    const rows: { c: Creature; text: string }[] = [];
    for (const t of this.list.values()) {
      let h = 0;
      try { h = t.c.entity.getComponent("minecraft:health")?.currentValue ?? 0; } catch { continue; }
      if (t.brain.dying) h = 0;
      const k = Math.max(0, Math.min(10, Math.ceil((h / TITAN_HEALTH) * 10)));
      rows.push({ c: t.c, text: `§4${TITAN_NAMES[t.n % TITAN_NAMES.length]} §c${"█".repeat(k)}§8${"█".repeat(10 - k)} §7${Math.max(0, Math.round(h))}` });
    }
    rows.push(...this.extraRows());
    if (!rows.length) return;
    for (const p of players()) {
      try {
        // (whoever is holding a Geiger counter is reading that instead)
        if (holdsCounter(p)) continue;
        const mine = rows.filter((r) => r.c.dim.id === p.dimension.id && dist(r.c.pos, p.location) < 150);
        if (mine.length) p.onScreenDisplay.setActionBar(mine.map((r) => r.text).join("§r   "));
      } catch { /* left */ }
    }
  }

  tick(now: number): void {
    if (now % 20 === 7) {
      // any that loaded or appeared without our hearing of it
      try { for (const e of store.loaded ? worldTitans() : []) this.inspect(e); } catch { /* unloading */ }
    }
    for (const t of [...this.list.values()]) {
      if (!t.c.valid) { this.drop(t, false); continue; }
      t.brain.tick();
      if (t.brain.gone) { this.drop(t, true); continue; }
      t.c.update();
    }
    if (now % 10 === 3) this.hud();
  }
}

function worldTitans(): Entity[] {
  try { return world.getDimension(OVERWORLD).getEntities({ type: TITAN }); } catch { return []; }
}

export const titans = new Titans();
