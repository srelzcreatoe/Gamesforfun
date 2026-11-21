/**
 * Basiliskra III -- four footfalls.
 *
 * His own breath: the tail club plants, the ridge lights section by section from tail to
 * shoulders, the light climbs his throat and the whole hide stands lit; the eye stops following,
 * and then a white-hot core wrapped in spiralling scarlet leaves his mouth.  It is not the same
 * beam every time.  The first firings are a ragged, short plume; he learns to focus it; later it
 * is a thin white lance.  Players who hide at his flank meet the ridge scatter instead.
 */
import { EntityDamageCause, Player, world } from "@minecraft/server";
import { CONFIG, KNOCK_GAP_TICKS, PROP, TICKS } from "../config";
import { Act, Brain, Choice, isNight, nearbyPlayers, pace, travel, wait } from "../brain";
import { Creature, targetable } from "../creature";
import { beamVars, particle, players, sound, witnesses } from "../fx";
import { STRIDE_III } from "../generated/rig";
import { store } from "../store";
import { add, clamp, dist, distXZ, dot, hash, leftOf, mul, norm, sub, turnTowards, wrapDeg, yawTo, type V3 } from "../vec";
import { blockAt, clearLine, idAt, isBreakableNatural, isLoaded, isSolidBlock, printOf, scorchOf } from "../world";

const TIERS = {
  1: { range: 28, radius: 1.4, damage: 4, ticks: 40, sfx: "basiliskra.iii.beam_raw", width: 1.5 },
  2: { range: 48, radius: 0.95, damage: 6, ticks: 60, sfx: "basiliskra.iii.beam", width: 0.9 },
  3: { range: 64, radius: 0.8, damage: 8, ticks: 70, sfx: "basiliskra.iii.beam", width: 0.6 },
} as const;
const ROD = "minecraft:lightning_rod";
const ROD_REACH = 10;
const FEET = ["foot_bl", "foot_fl", "foot_br", "foot_fr"];

/** Rods that have just taken a charge need time before they can take another. */
const rodReady = new Map<string, number>();

function segDist(p: V3, a: V3, d: V3, length: number): number {
  const t = clamp(dot(sub(p, a), d), 0, length);
  return dist(p, add(a, mul(d, t)));
}

export class BrainThree extends Brain {
  private beat = 0;
  private stepAt = 0;
  private prey: string | null = null;        // the one he remembers
  private preyUntil = 0;
  private recoverUntil = 0;
  /** Set when a charge is grounded: the ending listens for it. */
  groundedAt: { tick: number; rod: V3 } | null = null;
  /** The ending asks for a charge aimed at nothing in particular, beside the seam. */
  wantCharge = false;

  protected onFinish(): void { this.c.set(PROP.tier, this.tier()); }

  tier(): 1 | 2 | 3 {
    const b = this.rec.mut.beams;
    return b < 2 ? 1 : b < 5 ? 2 : 3;
  }

  protected choose(): Choice | null {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world.getTimeOfDay();
    if (this.wantCharge) {
      this.wantCharge = false;
      return { name: "charge", run: this.beam(null), limit: 30 * TICKS.second };
    }
    const near = nearbyPlayers(c, 72);
    // he remembers who drew him here
    if (rec.origin && rec.guilty && this.ready("remember") && distXZ(rec.origin, c.pos) < 90) {
      const g = near.find((p) => p.id === rec.guilty);
      if (g) { this.rest("remember", TICKS.day); return { name: "remember", run: this.remember(g), limit: 100 * TICKS.second }; }
    }
    if (now >= this.recoverUntil) {
      const hunted = this.prey && now < this.preyUntil ? near.filter((p) => p.id === this.prey) : near;
      // players sheltering at his flank or behind him: the ridge answers, not the mouth
      if (this.tier() === 3 && this.ready("scatter")) {
        const flank = hunted.find((p) => dist(p.location, c.pos) < 18 && Math.abs(wrapDeg(yawTo(c.pos, p.location) - c.yaw)) > 100);
        if (flank) { this.rest("scatter", 45 * TICKS.second); return { name: "scatter", run: this.scatter(), limit: 20 * TICKS.second }; }
      }
      if (this.ready("beam")) {
        for (const p of hunted) {
          const d = dist(p.location, c.anchor("mouth"));
          if (d < 10 || d > TIERS[this.tier()].range - 2) continue;
          if (!clearLine(c.dim, c.anchor("mouth"), p.getHeadLocation())) continue;     // line of sight, from the mouth itself
          this.rest("beam", 25 * TICKS.second);
          return { name: "beam", run: this.beam(p), limit: 30 * TICKS.second };
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
    if (this.prey && now < this.preyUntil) {
      const g = near.find((p) => p.id === this.prey);
      if (g) return { name: "pursue", run: this.pursue(g), limit: 20 * TICKS.second };
    }
    return { name: "roam", run: this.roam(), limit: 80 * TICKS.second };
  }

  // ---- four footfalls --------------------------------------------------------------------------
  /** Walk, landing one foot every quarter stride: left hind, left fore, right hind, right fore. */
  *walk(target: V3, speed: number, arrive: number, timeout: number): Generator<void, boolean, void> {
    const c = this.c;
    c.setPhase("move");
    c.goTo(target, speed, arrive);
    let t = 0;
    while (!c.arrived()) {
      if (++t > timeout || c.blocked > 50) { c.halt(); return false; }
      this.footfalls();
      yield;
    }
    c.halt();
    return true;
  }

  private footfalls(): void {
    const c = this.c;
    if (c.travelled - this.stepAt < STRIDE_III / 4) return;
    this.stepAt = c.travelled;
    const foot = c.anchor(FEET[this.beat & 3]);
    this.beat++;
    this.rec.mut.overland += STRIDE_III / 4;
    sound(c.dim, "basiliskra.iii.step", foot, 96, 1, 0.94 + (this.beat & 3) * 0.03);
    particle(c.dim, "basiliskra:step_dust", { x: foot.x, y: c.pos.y + 0.1, z: foot.z }, 56);
    for (const p of witnesses(c.dim, foot, 28)) {
      try { p.runCommand("camerashake add @s 0.08 0.2 positional"); } catch { /* commands unavailable: the sound carries it */ }
    }
    if (!CONFIG.marks) return;
    // a print pressed into natural ground: never into a floor
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const at = { x: Math.floor(foot.x) + dx, y: Math.floor(c.pos.y - 0.5), z: Math.floor(foot.z) + dz };
      const b = blockAt(c.dim, at);
      const above = blockAt(c.dim, { x: at.x, y: at.y + 1, z: at.z });
      if (!b || !above) continue;
      const to = printOf(b.typeId);
      if (to && (above.isAir || !isSolidBlock(above))) { try { b.setType(to); } catch { /* protected */ } }
    }
  }

  private *roam(): Act {
    const c = this.c;
    const near = nearbyPlayers(c, 110);
    let target: V3;
    if (near.length) {
      const p = near[0].location;
      const a = hash(this.now, 41) * Math.PI * 2;
      target = { x: p.x + Math.cos(a) * 22, y: p.y, z: p.z + Math.sin(a) * 22 };
    } else {
      const home = this.rec.origin ?? this.rec.rift ?? c.pos;
      const a = hash(this.now, 43) * Math.PI * 2;
      target = { x: home.x + Math.cos(a) * 40, y: c.pos.y, z: home.z + Math.sin(a) * 40 };
    }
    yield* this.walk(target, 0.14, 6, 1300);
    c.setPhase("idle");
    for (let t = 0; t < 140; t++) {
      if (t % 80 === 0) c.say("basiliskra.iii.breath", c.anchor("nose"), 48, 0.8);
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

  private *window(p: Player): Act {
    const c = this.c;
    const ok = () => { try { return p.isValid && p.dimension.id === c.dim.id; } catch { return false; } };
    const pl = p.location;
    const out = norm({ x: c.pos.x - pl.x, y: 0, z: c.pos.z - pl.z });
    // four measured steps bring him to stand off the wall; then the neck comes down
    const stand = add(pl, mul(out, 17));
    if (!(yield* this.walk(stand, STRIDE_III / 4 / 18, 4, 1800))) return;
    if (!ok()) return;
    c.yaw = turnTowards(c.yaw, yawTo(c.pos, p.location), 30);
    c.setPhase("window");
    for (let t = 0; t < 260 && ok(); t++) {
      // one small eye, level with the window
      c.lookAt(p.getHeadLocation(), 75, 50);
      if (t % 80 === 10) { try { p.playSound("basiliskra.iii.window_breath", { location: c.anchor("nose"), volume: 1 }); } catch { /* gone */ } }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
    yield* wait(60);
    yield* this.walk(add(c.pos, mul(out, 28)), 0.13, 5, 700);
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
    // from now it is that player he follows: lead him into the open and everyone else has a way out
    this.prey = g.id;
    this.preyUntil = this.now + 70 * TICKS.second;
    c.lookAhead();
  }

  private *pursue(g: Player): Act {
    const c = this.c;
    for (let t = 0; t < 300; t++) {
      let at: V3;
      try { if (!g.isValid || g.dimension.id !== c.dim.id) return; at = g.location; } catch { return; }
      c.setPhase("move");
      c.goTo(at, 0.16, 16);
      c.lookAt(at, 60, 25);
      this.footfalls();
      if (dist(at, c.pos) < 17) break;
      yield;
    }
    c.halt();
  }

  // ---- grounding ------------------------------------------------------------------------------------------
  /** A point on the planted club that is above the ground it rests on. */
  private clubTop(): V3 {
    const k = this.c.anchor("club_core");
    return { x: k.x, y: Math.max(k.y, this.c.pos.y + 1.6), z: k.z };
  }

  private findRod(): V3 | null {
    const c = this.c;
    const club = c.anchor("club_core");
    let best: V3 | null = null, bd = 1e9;
    const y0 = Math.floor(c.pos.y);
    for (let dx = -ROD_REACH; dx <= ROD_REACH; dx++) for (let dz = -ROD_REACH; dz <= ROD_REACH; dz++) {
      if (dx * dx + dz * dz > ROD_REACH * ROD_REACH) continue;
      for (let dy = -3; dy <= 8; dy++) {
        const p = { x: Math.floor(club.x) + dx, y: y0 + dy, z: Math.floor(club.z) + dz };
        if (idAt(c.dim, p) !== ROD) continue;
        const key = `${p.x},${p.y},${p.z}`;
        if ((rodReady.get(key) ?? 0) > this.now) continue;      // still recovering from the last strike
        const d = Math.hypot(dx, dz);
        if (d < bd) { bd = d; best = p; }
      }
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
            z: tip.z + (top.z - tip.z) * k + (hash(t, i, 3) - 0.5) * j }, 64);
        }
      }
      c.setCharge(c.charge - 1.5);
      if (t === 16) c.say("basiliskra.iii.fizzle", c.anchor("mouth"), 64);
      yield;
    }
    c.setCharge(0);
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

  *beam(target: Player | null): Act {
    const c = this.c;
    const tier = this.tier();
    const T = TIERS[tier];
    c.set(PROP.tier, tier);
    const ok = () => { try { return !target || (target.isValid && target.dimension.id === c.dim.id); } catch { return false; } };
    const aimAt = (): V3 => (target ? target.getHeadLocation() : add(c.anchor("mouth"), mul(c.forward, 30)));
    c.halt();
    // 1. the club plants first
    c.setPhase("charge");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 96);
    c.say("basiliskra.iii.charge", c.pos, 96);
    for (let t = 0; t < 14; t++) { c.setCharge(t / 7); if (ok()) c.aimAt(aimAt(), 80, 40); yield; }
    // 2. the ridge lights, tail to shoulders, and the whole hide with it
    let rod: V3 | null = null;
    let lit = 1;
    for (let t = 0; t < 54; t++) {
      if (!ok()) return;
      const aim = aimAt();
      const off = c.aimAt(aim, 80, 40);
      if (off > 0) c.yaw = turnTowards(c.yaw, yawTo(c.pos, aim), 0.6);      // feet shuffle only if the neck cannot reach
      c.setCharge(2 + (t / 54) * 14);
      const zone = Math.floor(c.charge / 2);
      if (zone > lit) {
        lit = zone;
        sound(c.dim, "basiliskra.iii.charge_tick", c.anchor(zone >= 6 ? "throat" : zone >= 3 ? "plate_tip_5" : "club_core"), 72, 0.9, 0.75 + zone * 0.09);
      }
      if (t === 20) rod = this.findRod();
      yield;
    }
    // 3. the eye stops following.  From here the aim is fixed: step sideways and it misses.
    if (!rod) rod = this.findRod();
    if (rod && clearLine(c.dim, this.clubTop(), { x: rod.x + 0.5, y: rod.y + 1.2, z: rod.z + 0.5 })) {
      yield* this.ground(rod);
      yield* wait(30);
      this.recoverUntil = this.now + 8 * TICKS.second;
      return;
    }
    for (let t = 0; t < 24; t++) { c.setCharge(16 + (t / 24) * 2); yield; }
    // 4. fire
    c.setPhase("fire");
    c.setCharge(20);
    this.rec.mut.beams++;
    this.rec.mut.lastEncounter = this.now;
    c.say(T.sfx, c.anchor("mouth"), 128);
    let lastHit: V3 | null = null;
    for (let t = 0; t < T.ticks; t++) {
      // the focused beam can be walked slowly after its target; the raw one cannot be steered at all
      if (tier >= 2 && target && ok() && targetable(target)) {
        const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
        c.lookYaw += clamp(want - c.lookYaw, -0.35, 0.35);
      }
      const sputter = tier === 1 && (t % 13 === 9 || t % 13 === 10 || t % 13 === 11);
      const { from, dir } = c.aim();
      // obstruction is decided here, once, and both the damage and the picture use the same answer
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
        if (t % 2 === 0) {
          particle(c.dim, "basiliskra:beam_core", from, 128, beamVars(dir, length, T.width * (tier === 1 ? 0.8 + hash(t) * 0.6 : 1)));
          particle(c.dim, "basiliskra:beam_halo", from, 128, beamVars(dir, length, T.width * 2.6));
        }
        // scarlet winding round the core
        const side = norm({ x: -dir.z, y: 0, z: dir.x });
        const up = norm({ x: dir.y * side.z - dir.z * side.y, y: dir.z * side.x - dir.x * side.z, z: dir.x * side.y - dir.y * side.x });
        for (let i = 0; i < 6; i++) {
          const along = ((t * 2.3 + i * (length / 6)) % length);
          const a = along * 1.1 + t * 0.9;
          const r = T.width * 0.9 + 0.25;
          particle(c.dim, "basiliskra:beam_spiral", add(add(from, mul(dir, along)), add(mul(side, Math.cos(a) * r), mul(up, Math.sin(a) * r))), 96);
        }
        if (hitBlock) {
          if (t % 3 === 0) particle(c.dim, "basiliskra:beam_impact", end, 96);
          if (t % 10 === 0) sound(c.dim, "basiliskra.iii.beam_impact", end, 96);
          if (t % 6 === 0) this.scorch(hitBlock);
          lastHit = end;
        }
        if (t % 4 === 0) {
          for (const p of players()) {
            try {
              if (p.dimension.id !== c.dim.id || !targetable(p)) continue;
              const body = add(p.location, { x: 0, y: 0.9, z: 0 });
              if (segDist(body, from, dir, length) <= T.radius + 0.4) c.hurt(p, T.damage, EntityDamageCause.entityAttack);
            } catch { /* left */ }
          }
        }
      }
      yield;
    }
    // 5. heat leaves by the old gills, three knocks; then a long recovery a player on foot can use
    yield* this.vent();
    this.recoverUntil = this.now + 7 * TICKS.second;
    c.setPhase("idle");
    yield* wait(50);
  }

  /** Mark what the beam touched.  Natural ground only; never a block with an inventory, a bed, a portal or redstone. */
  private scorch(at: V3): void {
    if (CONFIG.terrain === "none") return;
    const c = this.c;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
      const b = blockAt(c.dim, { x: at.x + dx, y: at.y + dy, z: at.z + dz });
      if (!b) continue;
      const id = b.typeId;
      try {
        if (CONFIG.terrain === "break" && dx === 0 && dy === 0 && dz === 0 && isBreakableNatural(id)) b.setType("minecraft:air");
        else { const to = scorchOf(id); if (to) b.setType(to); }
      } catch { /* protected area */ }
    }
  }

  // ---- the ridge scatter ---------------------------------------------------------------------------------------
  private *scatter(): Act {
    const c = this.c;
    c.halt();
    c.setPhase("scatter");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 96);
    for (let t = 0; t < 34; t++) { c.setCharge((t / 34) * 18); if (t % 5 === 0) sound(c.dim, "basiliskra.iii.charge_tick", c.anchor("plate_tip_4"), 64, 0.8, 1.5 - t * 0.02); yield; }
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
          if (hit) length = Math.max(0.5, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })));
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
