/**
 * Basiliskra I -- the water.
 */
import { Entity, EntityDamageCause, Player } from "@minecraft/server";
import { KNOCK_GAP_TICKS, PROP, TICKS } from "../config";
import { Act, Brain, Choice, anyoneNear, isNight, nearbyPlayers, pace, travel, wait } from "../brain";
import { Creature, targetable } from "../creature";
import { particle, sound } from "../fx";
import { add, clamp, dist, distXZ, forwardOf, hash, leftOf, mul, norm, sub, yawTo, type V3 } from "../vec";
import { NONE, UNLOADED, blockAt, clearLine, idAt, isLoaded, isSolidBlock, isWaterId, waterColumn } from "../world";
import { world } from "@minecraft/server";

function boatOf(p: Player): Entity | undefined {
  try {
    const r = p.getComponent("minecraft:riding");
    const e = r?.entityRidingOn;
    return e && e.typeId.includes("boat") ? e : undefined;
  } catch { return undefined; }
}

export class BrainOne extends Brain {
  private splash: { at: V3; t: number } | null = null;
  private lure: V3 | null = null;
  private quietSince = 0;

  protected onFinish(): void {
    this.c.swimDepth = 7;
    this.c.set(PROP.gill, this.rec.mut.surfacings > 0 || this.rec.born > 0);
  }

  protected interrupt(): Choice | null {
    if (this.lure && this.actName !== "lure" && this.actName !== "beach") {
      const at = this.lure; this.lure = null;
      return { name: "lure", run: this.investigate(at), limit: 30 * TICKS.second };
    }
    return null;
  }

  protected choose(): Choice | null {
    const c = this.c, now = this.now, rec = this.rec;
    const tod = world.getTimeOfDay();
    // the mutation that takes him out of the water
    const p = Math.max(0.25, 1 / Math.max(0.1, 1));
    if (!rec.evolve && rec.mut.surfacings >= 6 && rec.mut.episodes >= 3 && now - rec.mut.formSince >= pace(2 * TICKS.day)
      && anyoneNear(c, 96) && this.ready("beach")) {
      this.rest("beach", 2 * TICKS.minute);
      return { name: "beach", run: this.beach(), limit: 3 * TICKS.minute };
    }
    const near = nearbyPlayers(c, 64);
    for (const pl of near) {
      const boat = boatOf(pl);
      if (boat && this.ready("boat:" + pl.id) && this.ready("boat")) {
        this.rest("boat:" + pl.id, 100 * TICKS.second); this.rest("boat", 40 * TICKS.second);
        return { name: "boat", run: this.beneathBoat(pl, boat), limit: 70 * TICKS.second };
      }
      let wet = false;
      try { wet = pl.isInWater && !boat; } catch { wet = false; }
      if (wet && dist(pl.location, c.pos) < 30 && this.ready("knock")) {
        this.rest("knock", 2 * TICKS.minute);
        return { name: "knock", run: this.gillKnocks(), limit: 40 * TICKS.second };
      }
    }
    if (this.ready("echo")) {
      for (const s of rec.sites) {
        const key = `${s.x},${s.z}`;
        if (distXZ(s, c.pos) < 72 && (rec.learned.echoes[key] ?? -1e9) + pace(3 * TICKS.day) < now) {
          rec.learned.echoes[key] = now;
          this.rest("echo", 5 * TICKS.minute);
          return { name: "echo", run: this.drownedEcho(s), limit: 2 * TICKS.minute };
        }
      }
    }
    if (isNight(tod) && rec.rift && now - this.hurtAt > 2 * TICKS.minute && this.ready("sleep") && isLoaded(c.dim, rec.rift)
      && distXZ(rec.rift, c.pos) < 120) {
      this.rest("sleep", TICKS.day);
      return { name: "sleep", run: this.sleepAtSeam(), limit: 10 * TICKS.minute };
    }
    if (near.length && this.ready("harbor") && (isNight(tod) || tod > 11500)) {
      const pier = this.findPier(near[0].location);
      if (pier) {
        this.rest("harbor", 4 * TICKS.minute);
        return { name: "harbor", run: this.underHarbor(pier), limit: 2 * TICKS.minute };
      }
    }
    return { name: "patrol", run: this.patrol(), limit: 40 * TICKS.second };
  }

  // ---- finding water ------------------------------------------------------------------------
  private openWater(from: V3, minDist: number, maxDist: number, salt: number): V3 | null {
    const c = this.c;
    for (let i = 0; i < 10; i++) {
      const a = hash(this.now, salt, i) * Math.PI * 2;
      const r = minDist + hash(this.now, salt, i, 7) * (maxDist - minDist);
      const x = from.x + Math.cos(a) * r, z = from.z + Math.sin(a) * r;
      const col = waterColumn(c.dim, x, z, c.pos.y + 3, 12);
      if (col !== NONE && col !== UNLOADED && col.surface - col.floor >= 5) return { x, y: col.surface - 6, z };
    }
    return null;
  }

  /** Follow the bank: if rock is close on one side, slide the goal away from it. */
  private bankNudge(): void {
    const c = this.c;
    const l = leftOf(c.yaw);
    for (const side of [1, -1]) {
      const probe = add(add(c.pos, mul(l, side * 5)), { x: 0, y: 2, z: 0 });
      if (isSolidBlock(blockAt(c.dim, probe)) && c.goal) {
        c.goal = add(c.goal, mul(l, -side * 0.6));
        if (c.tick % 9 === 0) particle(c.dim, "basiliskra:silt_puff", c.anchor(side > 0 ? "fin_l" : "fin_r"), 32);
      }
    }
  }

  private *patrol(): Act {
    const c = this.c;
    const near = nearbyPlayers(c, 96);
    const focus = near.length ? near[0].location : (this.rec.rift ?? c.pos);
    const target = this.openWater(focus, 14, 34, 1) ?? this.openWater(c.pos, 8, 24, 2);
    if (!target) { yield* wait(40); return; }
    c.setPhase("move");
    c.goTo(target, 0.2, 3);
    let t = 0;
    while (!c.arrived() && t++ < 500) {
      this.bankNudge();
      if (c.blocked > 24) {
        // head through, shoulders not: he jams, and must back out
        const headWet = isWaterId(idAt(c.dim, add(c.pos, mul(c.forward, 8))));
        if (headWet && c.blockedWhy !== "unloaded") { yield* this.jam(); }
        break;
      }
      if (c.tick % 70 === 0) c.say(`basiliskra.i.${c.tick % 140 === 0 ? "breath" : "swim"}`, c.pos, 40, 0.8);
      yield;
    }
    c.setPhase("idle");
    yield* wait(30 + Math.floor(hash(this.now, 3) * 60));
  }

  private *jam(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("jam");
    c.say("basiliskra.i.jam", c.anchor("back"), 48);
    for (let i = 0; i < 44; i++) {
      if (i % 8 === 0) particle(c.dim, "basiliskra:silt_puff", c.anchor(i % 16 === 0 ? "gill_l" : "gill_r"), 32);
      yield;
    }
    // reverse out along his own length, as far as there is water behind him, then find other water
    const step = mul(c.forward, -0.15);
    for (let i = 0; i < 60; i++) {
      const to = add(c.pos, step), tail = add(to, mul(c.forward, -6));
      if (!isWaterId(idAt(c.dim, { x: to.x, y: to.y + 1, z: to.z })) || !isWaterId(idAt(c.dim, { x: tail.x, y: to.y + 1, z: tail.z }))) break;
      c.pos = to;
      yield;
    }
    c.blocked = 0;
  }

  // ---- beneath the boat -----------------------------------------------------------------------
  private *beneathBoat(pl: Player, boat: Entity): Act {
    const c = this.c;
    const ok = () => { try { return pl.isValid && boat.isValid && targetable(pl) && pl.dimension.id === c.dim.id && boatOf(pl)?.id === boat.id; } catch { return false; } };
    c.setPhase("move");
    c.swimDepth = 7.5;
    // close in from behind and below
    for (let t = 0; t < 400 && ok(); t++) {
      const b = boat.location;
      if (distXZ(b, c.pos) < 7) break;
      c.goTo(b, 0.42, 5);
      yield;
    }
    if (!ok()) return;
    // match the hull's speed; his wake shows first, bending off to one side
    for (let t = 0; t < 150 && ok(); t++) {
      const b = boat.location, v = boat.getVelocity();
      const lead = add(b, mul({ x: v.x, y: 0, z: v.z }, 12));
      c.goTo(lead, clamp(Math.hypot(v.x, v.z) + 0.03, 0.06, 0.5), 1.2);
      if (t % 4 === 0) {
        const col = waterColumn(c.dim, c.pos.x, c.pos.z, c.pos.y + 3, 12);
        if (col !== NONE && col !== UNLOADED) {
          const side = mul(leftOf(c.yaw), Math.sin(t * 0.09) * 2.4 + 1.6);
          particle(c.dim, "basiliskra:bubble_trail", { x: c.pos.x + side.x, y: col.surface - 0.1, z: c.pos.z + side.z }, 40);
        }
      }
      yield;
    }
    if (!ok()) return;
    // the back rises under the hull until one eye breaks the surface beside the oar
    c.setPhase("rise");
    c.swimDepth = 4.5;
    c.say("basiliskra.i.surface", c.anchor("back"), 56);
    this.rec.mut.surfacings++;
    this.rec.mut.lastEncounter = this.now;
    for (let t = 0; t < 110 && ok(); t++) {
      const b = boat.location, v = boat.getVelocity();
      c.goTo(add(b, mul({ x: v.x, y: 0, z: v.z }, 10)), clamp(Math.hypot(v.x, v.z) + 0.02, 0.05, 0.5), 1);
      c.lookAt(pl.getHeadLocation(), 40, 30);
      if (t > 40 && t < 64 && dist(c.anchor("back"), b) < 3.2) {
        // lift the hull: the rider stays seated, the boat is the thing that moves
        try { boat.applyImpulse({ x: 0, y: 0.05, z: 0 }); } catch { /* not this tick */ }
      }
      if (t % 10 === 0) particle(c.dim, "basiliskra:fin_break", { ...c.anchor("spine_2"), y: b.y }, 40);
      yield;
    }
    if (!ok()) return;
    // he dives and swings wide for the bite; a sharp early turn carries the boat across his path
    c.setPhase("move");
    c.lookAhead();
    c.swimDepth = 6.5;
    const away = add(c.pos, mul(c.forward, 16));
    c.goTo(away, 0.5, 3);
    for (let t = 0; t < 70 && !c.arrived(); t++) yield;
    for (let t = 0; t < 260 && ok(); t++) {
      const b = boat.location, v = boat.getVelocity();
      c.swimDepth = 3.4;
      c.goTo(add(b, mul({ x: v.x, y: 0, z: v.z }, 8)), 0.52, 1);
      if (dist(c.anchor("muzzle"), b) < 6) {
        c.setPhase("bite");
        c.say("basiliskra.i.bite", c.anchor("mouth"), 48);
        yield* wait(5);
        // the bite lives at his head: a hull beside his flank is not in it
        if (ok() && dist(c.anchor("mouth"), boat.location) < 2.8) {
          c.hurt(pl, 9);
          try { boat.applyImpulse(mul(norm(sub(boat.location, c.anchor("mouth"))), 0.5)); } catch { /* gone */ }
        }
        yield* wait(14);
        break;
      }
      yield;
    }
  }

  // ---- three gill knocks ------------------------------------------------------------------------
  private *knocks(sfx: string): Act {
    const c = this.c;
    for (let k = 0; k < 3; k++) {
      const g = c.anchor("gill_l");
      c.say(sfx, g, 56, 1, 1 - k * 0.03);
      particle(c.dim, "basiliskra:silt_ring", g, 48);
      c.pulse(1);
      yield* wait(KNOCK_GAP_TICKS);
    }
  }

  private *gillKnocks(): Act {
    const c = this.c;
    c.swimDepth = 64;                    // settle on the bed, left gill down
    c.halt();
    yield* wait(50);
    c.setPhase("knock");
    c.set(PROP.gill, true);
    yield* wait(2);
    yield* this.knocks("basiliskra.knock.gill");
    // on the third knock the gill draws water: loose things and swimmers nearby are pulled, then let go
    const g = c.anchor("gill_l");
    c.say("basiliskra.i.pull", g, 40);
    for (let t = 0; t < 24; t++) {
      if (t % 3 === 0) {
        for (const e of c.dim.getEntities({ location: g, maxDistance: 11, excludeTypes: ["basiliskra:basiliskra", "basiliskra:hitbox"] })) {
          let pull = false;
          try { pull = e.typeId === "minecraft:item" || (e.typeId === "minecraft:player" && e.isInWater && targetable(e as Player)); } catch { pull = false; }
          if (!pull) continue;
          const at = e.typeId === "minecraft:player" ? (e as Player).getHeadLocation() : e.location;
          // a solid block between you and his gills is shelter
          if (!clearLine(c.dim, g, at)) continue;
          const d = norm(sub(g, at));
          try {
            if (e.typeId === "minecraft:player") (e as Player).applyKnockback({ x: d.x * 0.42, z: d.z * 0.42 }, d.y * 0.2);
            else e.applyImpulse(mul(d, 0.14));
          } catch { /* riding or removed */ }
        }
      }
      yield;
    }
    particle(c.dim, "basiliskra:gravel_cloud", g, 48);
    c.setPhase("idle");
    yield* wait(40);
  }

  // ---- the drowned echo ---------------------------------------------------------------------------
  private *drownedEcho(site: { x: number; y: number; z: number; s: string }): Act {
    const c = this.c;
    const col = waterColumn(c.dim, site.x, site.z, site.y, 8);
    // only a kill site that has water under or beside it can echo
    let at: V3 | null = col !== NONE && col !== UNLOADED ? { x: site.x + 0.5, y: col.surface - 1, z: site.z + 0.5 } : null;
    if (!at) {
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [6, 6], [-6, -6], [6, -6], [-6, 6]]) {
        const cc = waterColumn(c.dim, site.x + dx, site.z + dz, site.y, 8);
        if (cc !== NONE && cc !== UNLOADED) { at = { x: site.x + dx, y: cc.surface - 1, z: site.z + dz }; break; }
      }
    }
    if (!at) return;
    // one remembered call, from under the dock
    sound(c.dim, site.s, at, 40, 0.9, 0.72);
    c.halt();
    // his head turns before the rest of him follows
    for (let t = 0; t < 46; t++) { c.lookAt(at, 70, 25); yield; }
    c.setPhase("move");
    c.swimDepth = 5;
    yield* travel(c, at, 0.24, 5, 700);
    c.lookAhead();
    c.setPhase("idle");
    yield* wait(70);
    sound(c.dim, site.s, at, 24, 0.45, 0.66);
    yield* wait(80);
  }

  // ---- the second splash ----------------------------------------------------------------------------
  onSplash(at: V3, _by: Player | undefined): void {
    const c = this.c;
    if (dist(at, c.pos) > 56) return;
    const prev = this.splash;
    if (prev && this.now - prev.t <= 80 && dist(prev.at, at) <= 6 && this.rec.learned.lureUntil <= this.now) {
      // two splashes close together: he comes.  Each lure buys less: he is learning.
      this.lure = at;
      this.rec.learned.lures++;
      this.rec.learned.lureUntil = this.now + pace(30 * TICKS.second + Math.min(this.rec.learned.lures, 8) * 15 * TICKS.second);
      this.splash = null;
    } else {
      // one splash: only an eye turns
      this.splash = { at, t: this.now };
      if (this.actName === "patrol" || this.actName === "none") c.lookAt(at, 60, 20);
    }
  }

  private *investigate(at: V3): Act {
    const c = this.c;
    c.setPhase("move");
    c.swimDepth = 5;
    c.lookAt(at, 60, 20);
    yield* travel(c, at, 0.3, 7, 500);
    c.lookAhead();
    // the tail sweeps what made the noise: readable from the dock, and it only hits at the tail
    c.setPhase("sweep");
    c.say("basiliskra.i.sweep", c.anchor("tail_tip"), 56);
    for (let t = 0; t < 34; t++) {
      if (t === 12 || t === 16) {
        const tail = c.anchor("tail_tip");
        particle(c.dim, "basiliskra:fin_break", tail, 40);
        for (const p of nearbyPlayers(c, 48)) {
          if (dist(p.location, tail) < 4.6) {
            c.hurt(p, 5);
            const d = norm(sub(p.location, tail));
            try { p.applyKnockback({ x: d.x * 1.4, z: d.z * 1.4 }, 0.5); } catch { /* riding */ }
          }
        }
        for (const e of c.dim.getEntities({ location: tail, maxDistance: 5, families: ["boat"] })) {
          try { e.applyImpulse(mul(norm(sub(e.location, tail)), 0.6)); } catch { /* gone */ }
        }
      }
      yield;
    }
    c.setPhase("idle");
    yield* wait(60);
  }

  // ---- under the harbour -------------------------------------------------------------------------------
  private findPier(around: V3): V3 | null {
    const c = this.c;
    for (let i = 0; i < 20; i++) {
      const x = Math.floor(around.x + (hash(this.now, i, 11) - 0.5) * 44);
      const z = Math.floor(around.z + (hash(this.now, i, 13) - 0.5) * 44);
      const col = waterColumn(c.dim, x, z, around.y - 1, 8);
      if (col === NONE || col === UNLOADED || col.surface - col.floor < 5) continue;
      for (let dy = 0; dy <= 2; dy++) {
        const id = idAt(c.dim, { x, y: col.surface + dy, z }) ?? "";
        if (/planks|_slab|_stairs|fence|_log|trapdoor/.test(id)) return { x: x + 0.5, y: col.surface - 5, z: z + 0.5 };
      }
    }
    return null;
  }

  private *underHarbor(pier: V3): Act {
    const c = this.c;
    c.setPhase("move");
    c.swimDepth = 5.2;
    if (!(yield* travel(c, pier, 0.2, 3, 700))) return;
    c.setPhase("idle");
    yield* wait(200 + Math.floor(hash(this.now, 17) * 160));
    // a spasm runs down his back: red fin tips break the water one after another round the pier
    c.setPhase("spasm");
    c.say("basiliskra.i.spasm", c.anchor("back"), 56);
    this.rec.mut.episodes++;
    this.rec.mut.surfacings++;
    this.rec.mut.lastEncounter = this.now;
    const col = waterColumn(c.dim, c.pos.x, c.pos.z, c.pos.y + 3, 12);
    const surface = col !== NONE && col !== UNLOADED ? col.surface : c.pos.y + 5;
    for (let t = 0; t < 84; t++) {
      const k = Math.floor((t - 6) / 7);
      if (t >= 6 && (t - 6) % 7 === 0 && k <= 10) {
        const s = c.anchor(`spine_${k}`);
        particle(c.dim, "basiliskra:fin_break", { x: s.x, y: surface + 0.05, z: s.z }, 48);
        if (k % 3 === 0) c.say("basiliskra.splash", { x: s.x, y: surface, z: s.z }, 24, 0.6, 0.8);
      }
      yield;
    }
    c.setPhase("idle");
    yield* wait(200);       // and the water goes quiet again
  }

  // ---- sleeping at the seam --------------------------------------------------------------------------------
  private *sleepAtSeam(): Act {
    const c = this.c, rift = this.rec.rift!;
    c.setPhase("move");
    c.swimDepth = 64;
    // lie beside the seam so the open C closes round the exact place he came through
    const side = add(rift, mul(leftOf(rift.yaw), -9));
    if (!(yield* travel(c, side, 0.18, 4, 1200))) return;
    c.halt();
    c.bendHold = 19;        // ten joints: an open C, with a gap his head can pass through
    c.setPhase("sleep");
    let t = 0;
    while (isNight(world.getTimeOfDay()) && t++ < 9000) {
      // a careful boat can drift past the scarred tail; the head is the thing that wakes him
      const head = c.anchor("muzzle");
      let woke = this.now - this.hurtAt < 40;
      for (const p of nearbyPlayers(c, 40)) if (dist(p.location, head) < 7) woke = true;
      if (woke) break;
      if (t % 90 === 0) c.say("basiliskra.i.breath", c.anchor("back"), 32, 0.6, 0.8);
      yield;
    }
    // three knocks warn that he is waking
    c.setPhase("wake");
    yield* wait(2);
    yield* this.knocks("basiliskra.knock.gill");
    c.bendHold = 0;
    yield* wait(40);
  }

  // ---- the first claws ----------------------------------------------------------------------------------------
  private findShelf(): { water: V3; shore: V3 } | null {
    const c = this.c;
    let best: { water: V3; shore: V3 } | null = null, bestD = 1e9;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      let lastWater: V3 | null = null;
      for (let r = 6; r <= 64; r += 2) {
        const x = c.pos.x + Math.cos(a) * r, z = c.pos.z + Math.sin(a) * r;
        const col = waterColumn(c.dim, x, z, c.pos.y + 4, 14);
        if (col === UNLOADED) break;
        if (col !== NONE) { lastWater = { x, y: col.surface - 3, z }; continue; }
        if (!lastWater) break;
        // first dry column on this bearing: is it a gravel or sand shelf at the waterline?
        for (let y = Math.floor(lastWater.y + 6); y >= Math.floor(lastWater.y); y--) {
          const id = idAt(c.dim, { x, y, z });
          if (!id || id === "minecraft:air") continue;
          if (/^minecraft:(sand|gravel|red_sand|clay|dirt|grass_block|coarse_dirt|mud|stone)$/.test(id) && r < bestD) {
            bestD = r; best = { water: lastWater, shore: { x, y: y + 1, z } };
          }
          break;
        }
        break;
      }
    }
    return best;
  }

  private *beach(): Act {
    const c = this.c;
    const shelf = this.findShelf();
    if (!shelf) return;
    c.setPhase("move");
    c.swimDepth = 3.6;
    yield* travel(c, shelf.water, 0.22, 5, 1600);
    if (distXZ(c.pos, shelf.water) > 12) return;
    // he hauls himself out: the body is carried onto the shelf whatever the water says
    c.halt();
    c.setPhase("beach");
    c.say("basiliskra.i.surface", c.pos, 64);
    const from = { ...c.pos };
    const to = add(shelf.shore, mul(norm({ x: shelf.shore.x - shelf.water.x, y: 0, z: shelf.shore.z - shelf.water.z }), 5));
    c.yaw = yawTo(from, to);
    for (let t = 0; t <= 80; t++) {
      const k = t / 80;
      c.pos = { x: from.x + (to.x - from.x) * k, y: from.y + (shelf.shore.y - from.y) * Math.min(1, k * 1.3), z: from.z + (to.z - from.z) * k };
      yield;
    }
    // from here the controller owns it: the evolution is saved in the record and resumes after a restart
    this.rec.evolve = { to: 2, step: 0, t0: this.now, at: { ...c.pos } };
    this.rec.beach = { x: Math.floor(c.pos.x), y: Math.floor(c.pos.y), z: Math.floor(c.pos.z) };
    yield* wait(600);
  }
}
