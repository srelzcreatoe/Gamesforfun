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
import { Act, Brain, Choice, anyoneNear, isNight, nearbyPlayers, pace, travel, wait, watchersNear } from "../brain";
import { Creature, targetable } from "../creature";
import { beamVars, flash, particle, players, sound, stopSound, witnesses } from "../fx";
import { STANCE_III, STRIDE_III } from "../generated/rig";
import { alive, blast, carve, mobsNear, segDist, wither } from "../havoc";
import { RoarFx, shake } from "../roar";
import { store } from "../store";
import { addFallout, fuse } from "../fallout";
import { add, clamp, dist, distXZ, dot, hash, leftOf, mul, norm, sub, turnTowards, wrapDeg, yawTo, type V3 } from "../vec";
import { blockAt, clearLine, idAt, isBreakableNatural, isLoaded, isNaturalGround, isPlantBlock, isSolidBlock, printOf, scorchOf, takesMark } from "../world";

/**
 * The atomic breath is one recording (basiliskra.iii.charge, then basiliskra.iii.beam): 6.86 s of charging, then
 * the shot at full force for 7.05 s and its fall.  The charge and the beam last exactly as long as it does.
 */
const CHARGE_TICKS = 137, PLANT_TICKS = 14, LIGHT_END = 112;
const FIRE_FULL = 141, FIRE_FADE = 14;
const TIERS = {
  1: { range: 40, radius: 1.9, damage: 5, width: 2.4, carve: 2.0 },
  2: { range: 60, radius: 1.6, damage: 7, width: 1.9, carve: 2.6 },
  3: { range: 76, radius: 1.4, damage: 9, width: 1.6, carve: 3.1 },
} as const;
/** How deep a crater one landing place of the beam is blown to (blocks from where it first struck). */
const CRATER = 6;
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
type Quarry = Entity;
const isPlayer = (e: Entity): e is Player => { try { return e.typeId === "minecraft:player"; } catch { return false; } };
function headOf(e: Entity): V3 { try { return e.getHeadLocation(); } catch { return e.location; } }

export class BrainThree extends Brain {
  private beat = 0;
  private stepAt = 0;
  private prey: string | null = null;        // the one he remembers
  private preyUntil = 0;
  private recoverUntil = 0;
  /** Creatures about him, looked up every two seconds. */
  private mobs: Entity[] = [];
  private mobsAt = -999;
  private lastQuarry: string | null = null;
  private roarSeed = 0;
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
  private chargeSounding = false;

  /** Creatures he could go after (not players): cached, the entity query runs every two seconds at most. */
  private creatures(): Entity[] {
    if (!CONFIG.huntMobs) return [];
    if (this.now - this.mobsAt >= 40) { this.mobsAt = this.now; this.mobs = mobsNear(this.c.dim, this.c.pos, 72); }
    return this.mobs.filter(alive);
  }

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
    const near = nearbyPlayers(c, 90);
    // he remembers who drew him here
    if (rec.origin && rec.guilty && this.ready("remember") && distXZ(rec.origin, c.pos) < 90) {
      const g = near.find((p) => p.id === rec.guilty);
      if (g) { this.rest("remember", TICKS.day); return { name: "remember", run: this.remember(g), limit: 100 * TICKS.second }; }
    }
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
    return { name: "roam", run: this.roam(), limit: 80 * TICKS.second };
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

  private footfalls(): void {
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
    sound(c.dim, "basiliskra.iii.step", foot, 112, 1, 0.86 + (this.beat & 3) * 0.03);
    const ground = { x: foot.x, y: c.pos.y + 0.1, z: foot.z };
    particle(c.dim, "basiliskra:step_dust", ground, 72);
    for (const p of witnesses(c.dim, foot, 40)) {
      const f = 1 - dist(p.location, foot) / 40;
      try { p.runCommand(`camerashake add @s ${(0.06 + 0.16 * f).toFixed(2)} 0.25 positional`); } catch { /* commands unavailable: the sound carries it */ }
    }
    // whatever is under the foot when it comes down
    blast(c.dim, ground, 2.2 * c.scale, 6, 14, 0.9, (p, n) => c.hurt(p, n), c.entity, ground);
    if (!CONFIG.marks) return;
    // a print pressed into natural ground: never into a floor
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const at = { x: Math.floor(foot.x) + dx, y: Math.floor(c.pos.y - 0.5), z: Math.floor(foot.z) + dz };
      const b = takesMark(c.dim, at);
      const to = b ? printOf(b.typeId) : undefined;
      if (b && to) { try { b.setType(to); } catch { /* protected */ } }
    }
  }

  private *roam(): Act {
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
  private indoors(p: Player): boolean {
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
  private windowDir(p: Player): { dir: V3; reach: number; pane: V3 } {
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
  private *face(target: V3, limit = 400): Act {
    const c = this.c;
    c.setPhase("move");
    for (let t = 0; t < limit; t++) {
      const want = yawTo(c.pos, target);
      if (Math.abs(wrapDeg(want - c.yaw)) < 2) break;
      c.yaw = turnTowards(c.yaw, want, 1.1);
      if (t % 18 === 9) {
        // a shuffle on the spot: heard, but it is not a stride (the walk cycle is left where it stood)
        const foot = c.anchor(FEET[Math.floor(t / 18) & 3]);
        sound(c.dim, "basiliskra.iii.step", foot, 72, 0.7, 0.98);
      }
      yield;
    }
  }

  private *window(p: Player): Act {
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
  private *remember(g: Player): Act {
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
  private *pursue(g: Quarry): Act {
    const c = this.c;
    const player = isPlayer(g);
    c.smash = true;
    for (let t = 0; t < 360; t++) {
      let at: V3;
      try { if (!g.isValid || g.dimension.id !== c.dim.id || (player && !targetable(g as Player))) break; at = g.location; } catch { break; }
      c.setPhase("move");
      c.goTo(at, 0.15, player ? 17 * c.scale * 0.6 : 3);
      c.lookAt(at, 60, 25);
      this.footfalls();
      if (dist(at, c.pos) < (player ? 17 * c.scale * 0.6 : 4)) break;
      if (t % 100 === 50) c.say("basiliskra.iii.grunt", c.anchor("nose"), 72, 1, 0.92 + hash(t) * 0.1);
      yield;
    }
    c.halt();
    c.smash = false;
  }

  // ---- grounding ------------------------------------------------------------------------------------------
  /** A point on the planted club that is above the ground it rests on. */
  private clubTop(): V3 {
    const k = this.c.anchor("club_core");
    return { x: k.x, y: Math.max(k.y, this.c.pos.y + 1.6), z: k.z };
  }

  /** Rods seen near the club during this charge, by layer: the whole reach is read once every twelve ticks. */
  private rodSeen = new Map<string, V3>();
  private rodLayer = 0;
  private scanRods(layers = 1): void {
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
  private findRod(): V3 | null {
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
  private *ground(rod: V3): Act {
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
  private *vent(): Act {
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
    const aimAt = (): V3 => (target ? headOf(target) : add(c.anchor("mouth"), mul(c.forward, 30)));
    c.halt();
    // 1. the club plants first, and the breath begins: the charge lasts exactly as long as its sound
    c.setPhase("charge");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 112);
    c.say("basiliskra.iii.charge", c.anchor("throat"), 128);
    this.chargeSounding = true;
    this.rodSeen.clear(); this.rodLayer = 0;
    for (let t = 0; t < PLANT_TICKS; t++) { c.setCharge(t / 7); if (ok()) c.aimAt(aimAt(), 80, 40); this.scanRods(); yield; }
    // 2. the ridge lights, tail to shoulders, and the whole hide with it
    let rod: V3 | null = null;
    let lit = 1;
    const light = LIGHT_END - PLANT_TICKS;
    for (let t = 0; t < light; t++) {
      if (!ok()) return;                     // (onFinish cuts the sound)
      const aim = aimAt();
      const off = c.aimAt(aim, 80, 40);
      if (off > 0) c.yaw = turnTowards(c.yaw, yawTo(c.pos, aim), 0.6);      // feet shuffle only if the neck cannot reach
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
    for (let t = 0; t < lock; t++) {
      c.setCharge(16 + (t / lock) * 2);
      // a thin line down the path it will take: this is where not to be standing
      if (t % 2 === 0) {
        const { from, dir } = c.aim();
        particle(c.dim, "basiliskra:beam_aim", from, 128, beamVars(dir, this.clearRange(from, dir, T.range), 0.22 + 0.5 * (t / lock)));
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
      particle(c.dim, "basiliskra:muzzle_flash", from, 160);
      particle(c.dim, "basiliskra:muzzle_shock", from, 160, beamVars(dir, 1, 1));
      flash(c.dim, from, 56, { red: 1, green: 0.5, blue: 0.42 }, 0.03, 0.04, 0.3);
      shake(c, 96, 0.9, 0.5);
    }
    const smash = wither();
    // where the beam is landing: it blasts out a crater there (it does not bore on for ever), the poison gathers
    // there, and when his aim moves on, so does the crater
    let ground: V3 | null = null;
    for (let t = 0; t < FIRE_FULL + FIRE_FADE; t++) {
      const fade = t < FIRE_FULL ? 1 : 1 - (t - FIRE_FULL) / FIRE_FADE;
      // the focused beam is walked slowly after its quarry; the raw one wanders where it will
      // (never as fast as a player walks sideways at the range he fires from: stepping out of the line still works)
      if (tier >= 2 && target && ok() && (!isPlayer(target) || targetable(target as Player))) {
        const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
        const rate = tier === 2 ? 0.22 : 0.3;
        c.lookYaw += clamp(want - c.lookYaw, -rate, rate);
      } else if (tier === 1) c.lookYaw = clamp(c.lookYaw + Math.sin(t * 0.09) * 0.12, -80, 80);
      const sputter = tier === 1 && t % 17 >= 14;
      const { from, dir } = c.aim();
      // obstruction is decided here, once, and the damage, the destruction and the picture all use the same answer
      let length: number = T.range;
      let hitBlock: V3 | null = null;
      if (isLoaded(c.dim, from)) {
        try {
          const hit = c.dim.getBlockFromRay(from, dir, { maxDistance: T.range, includeLiquidBlocks: false, includePassableBlocks: false });
          if (hit) { hitBlock = hit.block.location; length = Math.max(1, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })) - 0.4); }
        } catch { length = 6; }
      }
      // never draw or burn into chunks that are not loaded
      while (length > 4 && !isLoaded(c.dim, add(from, mul(dir, length)))) length -= 4;
      const end = add(from, mul(dir, length));
      if (!sputter) {
        // it throbs, about as fast as a heart racing
        const w = T.width * fade * (tier === 1 ? 0.85 + hash(t) * 0.4 : 1) * (1 + 0.14 * Math.sin(t * 1.25));
        if (t % 5 === 0) particle(c.dim, "basiliskra:beam_ring", from, 144, beamVars(dir, length, w * 2.2));
        if (t % 3 === 1) particle(c.dim, "basiliskra:beam_arc", from, 128, beamVars(dir, length, w));
        if (t % 2 === 0) {
          particle(c.dim, "basiliskra:beam_core", from, 160, beamVars(dir, length, w));
          particle(c.dim, "basiliskra:beam_halo", from, 160, beamVars(dir, length, w * 2.4));
          particle(c.dim, "basiliskra:beam_glow", from, 160, beamVars(dir, length, w * 5.2));
        } else {
          // it smokes and sheds embers all along its length
          particle(c.dim, "basiliskra:beam_smoke", from, 128, beamVars(dir, length, w));
          if (t % 4 === 1) particle(c.dim, "basiliskra:beam_embers", from, 128, beamVars(dir, length, w));
        }
        // scarlet winding round the core
        const side = norm({ x: -dir.z, y: 0, z: dir.x });
        const up = norm({ x: dir.y * side.z - dir.z * side.y, y: dir.z * side.x - dir.x * side.z, z: dir.x * side.y - dir.y * side.x });
        for (let i = 0; i < 4; i++) {
          const along = ((t * 2.3 + i * (length / 4)) % length);
          const a = along * 1.1 + t * 0.9;
          const r = w * 0.9 + 0.3;
          particle(c.dim, "basiliskra:beam_spiral", add(add(from, mul(dir, along)), add(mul(side, Math.cos(a) * r), mul(up, Math.sin(a) * r))), 112);
        }
        if (hitBlock) {
          if (t % 3 === 0) particle(c.dim, "basiliskra:beam_impact", end, 112);
          if (t % 5 === 0) particle(c.dim, "basiliskra:impact_blast", end, 128);
          if (t % 6 === 3) particle(c.dim, "basiliskra:impact_smoke", end, 144);
          if (t % 7 === 0) particle(c.dim, "basiliskra:impact_fire", end, 112);
          if (t % 4 === 2) particle(c.dim, "basiliskra:impact_glare", end, 160);
          if (t % 10 === 5) particle(c.dim, "basiliskra:impact_ring", { x: end.x, y: end.y + 0.4, z: end.z }, 144);
          if (t % 8 === 1) particle(c.dim, "basiliskra:impact_fountain", end, 144);
          if (t % 10 === 0) sound(c.dim, "basiliskra.iii.beam_impact", end, 112);
          if (!ground || dist(ground, hitBlock) > CRATER + 3) ground = hitBlock;
          if (smash) {
            // like the Wither: what his light meets is blown out of the world, and the edges burn
            if (t % 4 === 0 && dist(ground, hitBlock) <= CRATER) {
              const got = carve(c.dim, hitBlock, T.carve * fade + 0.5, 110, true);
              if (got.broken) particle(c.dim, "basiliskra:impact_debris", end, 128);
            }
            if (t % 12 === 0) {
              particle(c.dim, "minecraft:huge_explosion_emitter", end, 144);
              sound(c.dim, "random.explode", end, 128, 1.4, 0.7 + hash(t, 3) * 0.2);
            }
            if (t % 8 === 4) blast(c.dim, end, T.carve + 3.5, 4, 12, 0.8, (p, n) => c.hurt(p, n), c.entity, end);
          } else if (t % 6 === 0) this.scorch(hitBlock);
          if (t % 6 === 0) {
            addFallout(ground, [0, 3, 4, 5][tier] + (smash ? 1 : 0), 0.13);    // where his light lands, the ground is poisoned
            if (CONFIG.fallout !== "off") particle(c.dim, "basiliskra:fallout_ash", end, 64);
          }
        }
        if (t % 4 === 0) {
          const reach = T.radius * Math.max(0.5, fade) + 0.4;
          for (const p of players()) {
            try {
              if (p.dimension.id !== c.dim.id || !targetable(p)) continue;
              const body = add(p.location, { x: 0, y: 0.9, z: 0 });
              if (segDist(body, from, dir, length) > reach) continue;
              // the nearest point of the beam must see the player: a wall he hugs from behind still shelters him
              const along = clamp(dot(sub(body, from), dir), 0, Math.max(0, length - 0.6));
              if (!clearLine(c.dim, add(from, mul(dir, along)), body)) continue;
              c.hurt(p, T.damage, EntityDamageCause.entityAttack);
              try { p.setOnFire(3, true); } catch { /* fire-proof */ }
            } catch { /* left */ }
          }
          // and every creature in its path
          for (const e of mobsNear(c.dim, add(from, mul(dir, length / 2)), length / 2 + 3)) {
            try {
              if (segDist(add(e.location, { x: 0, y: 0.6, z: 0 }), from, dir, length) > reach + 0.6) continue;
              e.applyDamage(T.damage * 2, { cause: EntityDamageCause.entityAttack, damagingEntity: c.entity });
              e.setOnFire(5, true);
            } catch { /* gone */ }
          }
        }
      }
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

  /** How far along a line the way is clear (up to `max`), for drawing: never into a chunk that is not loaded. */
  private clearRange(from: V3, dir: V3, max: number): number {
    const c = this.c;
    let length = max;
    if (isLoaded(c.dim, from)) {
      try {
        const hit = c.dim.getBlockFromRay(from, dir, { maxDistance: max, includeLiquidBlocks: false, includePassableBlocks: false });
        if (hit) length = Math.max(1, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })) - 0.4);
      } catch { length = 6; }
    }
    while (length > 4 && !isLoaded(c.dim, add(from, mul(dir, length)))) length -= 4;
    return length;
  }

  /** Mark what the beam touched.  Natural ground only; never a block with an inventory, a bed, a portal or redstone. */
  private scorch(at: V3): void {
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
  private *scatter(): Act {
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
