/**
 * Basiliskra II -- the shore.
 */
import { Player, system, world } from "@minecraft/server";
import { CONFIG, PROP, TICKS } from "../config";
import { Act, anyoneNear, Brain, changeTicks, Choice, isNight, nearbyPlayers, pace, wait, watchersNear } from "../brain";
import { Creature } from "../creature";
import { particle, sound, witnesses } from "../fx";
import { GAIT_TICKS } from "../generated/rig";
import { RoarFx } from "../roar";
import { add, clamp, dist, distXZ, hash, mul, norm, sub, wrapDeg, yawTo, type V3 } from "../vec";
import { blockAt, furrowOf, idAt, isLoaded, isSolidBlock, isWaterId, takesMark } from "../world";

/** What a street is lit with: redstone lamps first, and every lantern, bulb and torch a village hangs out. */
const LAMP = /^minecraft:((lit_)?redstone_lamp|(soul_)?lantern|.*copper_lantern|sea_lantern|glowstone|.*copper_bulb|(soul_|redstone_|copper_)?torch|shroomlight|.*froglight)$/;

const STONE = /^minecraft:(stone|cobblestone|mossy_cobblestone|stone_bricks|andesite|diorite|granite|deepslate|tuff|.*_slab|stone_.*|polished_.*|smooth_stone|gravel)$/;

export class BrainTwo extends Brain {
  private lure: V3 | null = null;
  private splash: { at: V3; t: number } | null = null;
  private startle: V3 | null = null;
  private otherSound = 0;
  private lamps: V3[] = [];
  private lampsAt = -9999;
  private gaitStep = 2;

  protected onFinish(): void { this.c.set(PROP.gait, this.gaitStep === 5 ? 5 : 2); }

  protected interrupt(): Choice | null {
    if (this.startle && this.actName !== "flinch") {
      const from = this.startle; this.startle = null;
      return { name: "flinch", run: this.flinch(from), limit: 20 * TICKS.second };
    }
    if (this.lure && (this.actName === "well" || this.actName === "wander" || this.actName === "pin")) {
      const at = this.lure; this.lure = null;
      return { name: "lure", run: this.toLure(at), limit: 50 * TICKS.second };
    }
    return null;
  }

  protected choose(): Choice | null {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world.getTimeOfDay();
    // repeated overland exertion drives the last mutation; it happens on a wet night, with someone there to hear it
    if (!rec.evolve && now - rec.mut.formSince >= changeTicks(2)) {
      rec.evolve = { to: 3, step: 0, t0: now, at: { ...c.pos } };
      return { name: "evolve", run: wait(900), limit: 900 };
    }
    // he has learned which bell it was
    if (rec.learned.bell && rec.learned.bellUses >= 4 && this.ready("pin") && distXZ(rec.learned.bell, c.pos) < 56 && isLoaded(c.dim, rec.learned.bell)) {
      this.rest("pin", 6 * TICKS.minute);
      return { name: "pin", run: this.silenceBell(rec.learned.bell), limit: 2 * TICKS.minute };
    }
    if (this.ready("well")) {
      const w = this.findWater();
      if (w) { this.rest("well", 4 * TICKS.minute); return { name: "well", run: this.well(w), limit: 2 * TICKS.minute }; }
      this.rest("well", 40 * TICKS.second);
    }
    if (this.ready("arc") && this.onWetStone()) {
      this.rest("arc", TICKS.minute);
      return { name: "arc", run: this.discharge(), limit: 12 * TICKS.second };
    }
    // now and then he bellows at nothing
    if (!this.cooldown.has("rroar")) this.rest("rroar", (60 + 60 * hash(now, 81)) * TICKS.second);
    if (this.ready("rroar")) {
      this.rest("rroar", (90 + 180 * hash(now, 82)) * TICKS.second);
      if (hash(now, 83) < 0.5 && anyoneNear(c, 72)) return { name: "roar", run: this.roar(), limit: 8 * TICKS.second };
    }
    return { name: "wander", run: this.wander(), limit: 90 * TICKS.second };
  }

  // ---- the dragging gait ------------------------------------------------------------------------
  /** Claws hook, elbows pull, hips scrape, the body rests.  The rest is the gap a player can cross. */
  private *drag(target: V3, arrive: number, timeout: number): Generator<void, boolean, void> {
    const c = this.c;
    const [reach, pull, rest] = GAIT_TICKS;
    let t = 0, stuck = 0;
    c.setPhase("move");
    while (distXZ(c.pos, target) > arrive) {
      if (t > timeout || stuck >= 3) { c.halt(); return false; }      // three pulls that gained nothing: he cannot get there
      const left = this.gaitStep === 5 || this.gaitStep === 2 ? (this.gaitStep === 5) : true;
      const base = this.gaitStep === 5 ? 0 : 3;
      // reach
      this.gaitStep = base; c.set(PROP.gait, base);
      c.halt();
      for (let i = 0; i < reach; i++, t++) {
        c.yaw = wrapDeg(c.yaw + clamp(wrapDeg(yawTo(c.pos, target) - c.yaw), -0.9, 0.9));
        yield;
      }
      const claw = c.anchor(base === 0 ? "claw_l" : "claw_r");
      c.say("basiliskra.ii.claw", claw, 48, 0.9, 0.95 + hash(t) * 0.1);
      particle(c.dim, "basiliskra:grit", claw, 32);
      // pull: the chest comes forward to the planted claw
      this.gaitStep = base + 1; c.set(PROP.gait, base + 1);
      c.say("basiliskra.ii.drag", c.anchor("hip_l"), 64);
      const before = c.travelled;
      c.goTo(target, 0.085, arrive);             // drawn 1.25 times his model size, a pull covers 1.25 times the ground
      for (let i = 0; i < pull; i++, t++) {
        if (i % 4 === 0) this.furrow();
        yield;
      }
      c.halt();
      stuck = c.planning ? 0 : c.travelled - before < 0.25 ? stuck + 1 : 0;      // (working out a way round is not being stuck)
      this.rec.mut.overland += c.travelled - before;
      // rest
      this.gaitStep = base + 2; c.set(PROP.gait, base + 2);
      c.say("basiliskra.ii.rest", c.pos, 48, 0.8);
      for (let i = 0; i < rest; i++, t++) yield;
      if (t % 5 === 0) c.say("basiliskra.ii.breath", c.anchor("nose"), 40, 0.8);
      this.wetStoneArc();
    }
    c.halt();
    return true;
  }

  /** Two thin furrows behind the hind feet, on natural ground only: floors and builds are left alone. */
  private furrow(): void {
    if (!CONFIG.marks) return;
    const c = this.c;
    for (const side of ["hip_l", "hip_r"]) {
      const p = c.anchor(side);
      const at = { x: Math.floor(p.x), y: Math.floor(c.pos.y - 0.5), z: Math.floor(p.z) };
      const b = takesMark(c.dim, at);
      const to = b ? furrowOf(b.typeId) : undefined;
      if (b && to) {
        try { b.setType(to); } catch { /* protected */ }
      } else if (c.tick % 8 === 0) particle(c.dim, "basiliskra:grit", { x: p.x, y: c.pos.y + 0.1, z: p.z }, 32);
    }
  }

  private onWetStone(): boolean {
    const c = this.c;
    const k = c.anchor("knob_core");
    const under = idAt(c.dim, { x: k.x, y: c.pos.y - 0.5, z: k.z }) ?? "";
    if (!STONE.test(under)) return false;
    if (this.rec.weather !== "clear") return true;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (isWaterId(idAt(c.dim, { x: k.x + dx, y: c.pos.y, z: k.z + dz }))) return true;
    return false;
  }

  private wetStoneArc(): void {
    const c = this.c;
    if (this.onWetStone() && hash(this.now, 5) < 0.35) {
      c.say("basiliskra.ii.arc", c.anchor("horn_l"), 48, 0.7);
      c.pulse(2);
    }
  }

  private *wander(): Act {
    const c = this.c;
    const near = watchersNear(c, 96);
    let target: V3;
    if (near.length) {
      // he circles what he can hear: never straight at a door, always somewhere outside it
      const p = near[0].location;
      const a = hash(this.now, 21) * Math.PI * 2;
      target = { x: p.x + Math.cos(a) * 14, y: p.y, z: p.z + Math.sin(a) * 14 };
      // a village hears scraping outside for days before it hears anything else
      for (const w of witnesses(c.dim, c.pos, 80)) {
        if (dist(w.location, c.pos) > 26 && hash(this.now, 23) < 0.6) {
          try { w.playSound("basiliskra.scrape_far", { location: c.pos, volume: 0.9 }); } catch { /* gone */ }
        }
      }
    } else {
      const a = hash(this.now, 25) * Math.PI * 2;
      target = { x: c.pos.x + Math.cos(a) * 18, y: c.pos.y, z: c.pos.z + Math.sin(a) * 18 };
    }
    yield* this.drag(target, 4, 1400);
    c.setPhase("idle");
    yield* wait(120 + Math.floor(hash(this.now, 27) * 200));
  }

  // ---- the village well ---------------------------------------------------------------------------
  /** A reachable water opening with a rim: a village well, else a pond or an irrigation ditch. */
  private findWater(): V3 | null {
    const c = this.c;
    let well: V3 | null = null, pond: V3 | null = null, wd = 1e9, pd = 1e9;
    const y0 = Math.floor(c.pos.y);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(c.pos.x + (hash(this.now, i, 31) - 0.5) * 72);
      const z = Math.floor(c.pos.z + (hash(this.now, i, 33) - 0.5) * 72);
      for (let y = y0 + 3; y >= y0 - 3; y--) {
        if (!isWaterId(idAt(c.dim, { x, y, z }))) continue;
        const above = blockAt(c.dim, { x, y: y + 1, z });
        if (!above || !above.isAir) break;
        const d = Math.hypot(x - c.pos.x, z - c.pos.z);
        if (d < 8) break;
        let water = 0, rim = 0;
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
          const id = idAt(c.dim, { x: x + dx, y, z: z + dz });
          if (isWaterId(id)) water++;
          else if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && id && id !== "minecraft:air") rim++;
        }
        if (water <= 12 && rim >= 6) { if (d < wd) { wd = d; well = { x: x + 0.5, y, z: z + 0.5 }; } }
        else if (d < pd) { pd = d; pond = { x: x + 0.5, y, z: z + 0.5 }; }
        break;
      }
    }
    return well ?? (pd < 48 ? pond : null);
  }

  private *well(at: V3): Act {
    const c = this.c;
    // he stops where his shoulders catch on the rim: the snout reaches, the rest cannot follow
    if (!(yield* this.drag(at, 8.5, 1800))) return;
    c.yaw = yawTo(c.pos, at);
    c.setPhase("drink");
    for (let t = 0; t < 700; t++) {
      if (t % 52 === 0) c.say("basiliskra.ii.drink", c.anchor("muzzle"), 32);
      yield;
    }
  }

  private *toLure(at: V3): Act {
    const c = this.c;
    c.setPhase("idle");
    for (let t = 0; t < 24; t++) { c.lookAt(at, 70, 20); yield; }
    c.lookAhead();
    yield* this.drag(at, 6, 900);
    c.setPhase("idle");
    yield* wait(100);
  }

  onSplash(at: V3, _by: Player | undefined): void {
    const c = this.c;
    if (dist(at, c.pos) > 40) return;
    this.otherSound = this.now;
    const prev = this.splash;
    if (prev && this.now - prev.t <= 100 && dist(prev.at, at) <= 6 && this.rec.learned.lureUntil <= this.now) {
      this.lure = at;
      this.rec.learned.lures++;
      this.rec.learned.lureUntil = this.now + pace(40 * TICKS.second);
      this.splash = null;
    } else this.splash = { at, t: this.now };
  }

  // ---- the first discharge -----------------------------------------------------------------------------
  private *discharge(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("arc");
    this.rec.mut.episodes++;
    if (this.now - this.lampsAt > 30 * TICKS.second) {
      // the street's lamps, a layer a tick while the arc gathers
      this.lamps = []; this.lampsAt = this.now;
      for (let dy = -1; dy <= 4; dy++) { this.scanLamps(dy); yield; }
    }
    const from = c.anchor("knob_core");
    const lit = this.lamps.map((l) => ({ l, d: dist(l, from) })).sort((a, b) => a.d - b.d);
    for (let t = 0; t < 60; t++) {
      if (t === 2 || t === 14 || t === 27) { c.say("basiliskra.ii.arc", c.anchor("horn_l"), 56); c.pulse(2); }
      // lamps appear to flare in turn, near to far.  Purely visual: no block or wire is touched.
      for (const { l, d } of lit) {
        if (Math.floor(d * 1.6) + 4 === t) particle(c.dim, "basiliskra:lamp_flare", { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 }, 48);
      }
      yield;
    }
    yield* this.roar();
  }

  /** The same voice, younger: the short bellow, pitched up. */
  *roar(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("roar");
    c.say("basiliskra.roar_short", c.anchor("mouth"), 128, 1, 1.18);
    // younger and smaller than he will be, but the ground still takes it
    const fx = new RoarFx(c, false, 20, 3, true, 1.18);
    for (let t = 0; t < 76; t++) { fx.tick(); yield; }       // 4.4 s of bellow, played 1.18 times as fast
    c.setPhase("idle");
  }

  /** Lamps along the street (anything a village lights itself with): one layer of a bounded box round the knob. */
  private scanLamps(dy: number): void {
    const c = this.c;
    const k = c.anchor("knob_core");
    const y = Math.floor(c.pos.y) + dy;
    for (let dx = -14; dx <= 14; dx += 1) for (let dz = -14; dz <= 14; dz += 1) {
      if (this.lamps.length >= 24) return;
      const id = idAt(c.dim, { x: k.x + dx, y, z: k.z + dz });
      if (id && LAMP.test(id)) this.lamps.push({ x: Math.floor(k.x + dx), y, z: Math.floor(k.z + dz) });
    }
  }

  // ---- the bell ---------------------------------------------------------------------------------------------
  onBell(at: V3, _by: Player): void {
    const c = this.c, rec = this.rec;
    if (dist(at, c.pos) > 48) return;
    if (this.actName === "pin") {
      const same = rec.learned.bell && dist(rec.learned.bell, at) < 2;
      if (same) {
        // his claw is on the frame: the ring is choked
        sound(c.dim, "basiliskra.bell_pin", at, 32);
        particle(c.dim, "basiliskra:grit", { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }, 24);
      } else this.otherSound = this.now;      // a second bell is a second sound source
      return;
    }
    if (rec.learned.bellUses < 3) {
      // early on a bell really does startle him
      rec.learned.bellUses++;
      rec.learned.bell = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
      this.startle = at;
    } else if (rec.learned.bellUses === 3) {
      rec.learned.bellUses = 4;                // the fourth ring teaches him nothing new; he has it
      rec.learned.bell = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
    }
  }

  onNote(_at: V3): void { this.otherSound = this.now; }

  private *flinch(from: V3): Act {
    const c = this.c;
    c.halt();
    c.setPhase("flinch");
    c.say("basiliskra.ii.growl", c.anchor("nose"), 56);
    yield* wait(24);
    const away = add(c.pos, mul(norm({ x: c.pos.x - from.x, y: 0, z: c.pos.z - from.z }), 12));
    yield* this.drag(away, 3, 400);
  }

  /** The nearest door to a place, read a layer a tick. */
  private *nearestDoor(around: V3): Generator<void, V3 | null, void> {
    const c = this.c;
    let best: V3 | null = null, bd = 1e9;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
        const p = { x: around.x + dx, y: around.y + dy, z: around.z + dz };
        const id = idAt(c.dim, p);
        if (id && id.endsWith("_door")) { const d = Math.hypot(dx, dz); if (d < bd) { bd = d; best = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 }; } }
      }
      yield;
    }
    return best;
  }

  private *silenceBell(bell: V3): Act {
    const c = this.c;
    if (idAt(c.dim, bell) !== "minecraft:bell") { this.rec.learned.bell = null; return; }
    if (!(yield* this.drag(bell, 7.5, 1600))) return;
    c.yaw = yawTo(c.pos, bell);
    // one claw rests against the frame, and he waits with his eye on the nearest door
    c.setPhase("pin");
    c.say("basiliskra.ii.claw", { x: bell.x + 0.5, y: bell.y, z: bell.z + 0.5 }, 40);
    const door = yield* this.nearestDoor(bell);
    const began = this.now;
    for (let t = 0; t < 1200; t++) {
      const watch = door ?? nearbyPlayers(c, 40)[0]?.location;
      if (watch) c.lookAt(watch, 70, 20);
      // a second sound source draws the claw away
      if (this.otherSound > began + 10) break;
      if (t % 80 === 0) c.say("basiliskra.ii.breath", c.anchor("nose"), 40, 0.7);
      yield;
    }
  }
}
