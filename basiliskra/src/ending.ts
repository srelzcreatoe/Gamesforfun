/**
 * The last crossing.
 *
 * A shed fin pulses faster the nearer it is carried to the place he came through.  There, three
 * note-block knocks in his own rhythm call him; the rhythm has to keep going.  When he charges
 * beside the seam and the charge is led into a lightning rod, the rift opens.  He tests it with
 * the notched tip of his tail, turns, and goes through headfirst.  Only when the tail has cleared
 * is the encounter retired.  If the rhythm stops first he backs away, and it can be tried again.
 */
import { EquipmentSlot, Player, system } from "@minecraft/server";
import { FIN_ITEM, KNOCK_GAP_TICKS, PROP, TICKS } from "./config";
import type { Controller } from "./controller";
import type { Creature } from "./creature";
import { BrainThree } from "./forms/three";
import { particle, players, sound } from "./fx";
import { RIGS } from "./generated/rig";
import { store } from "./store";
import { add, clamp, dist, distXZ, dot, forwardOf, mul, norm, sub, yawTo, type V3 } from "./vec";
import { blockAt, groundY, idAt, isLoaded, overworld } from "./world";

const NOTE = "minecraft:noteblock";
const GAP_MIN = 11, GAP_MAX = 26;        // 0.55 s .. 1.3 s between knocks counts as his rhythm
const ROD_NEAR_SEAM = 48;
const GRACE = 60;                        // ticks the rhythm may falter before he notices

function holdsFin(p: Player): boolean {
  try { return p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId === FIN_ITEM; } catch { return false; }
}

function carriesFin(p: Player): boolean {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === FIN_ITEM) return true;
  } catch { /* no inventory */ }
  return false;
}

export class Ending {
  private blocks: V3[] = [];
  private powered = new Map<string, boolean>();
  private scanY = 99;
  private lastNote = -9999;
  private streak = 0;
  private aliveUntil = -9999;
  private act: Generator<void, void, void> | null = null;
  private coolUntil = 0;
  private finNext = new Map<string, number>();

  constructor(private ctl: Controller) {}

  get rhythm(): boolean { return system.currentTick <= this.aliveUntil; }

  reset(): void {
    if (this.act) { try { this.act.return(); } catch { /* cleanup */ } }
    this.act = null;
    if (store.rec.ending) { store.rec.ending = null; store.touch(); }
  }

  /** A note sounded near the seam (a player's hand or a redstone pulse). */
  onNote(at: V3): void {
    const rift = store.rec.rift;
    if (!rift || distXZ(at, rift) > 24) return;
    const now = system.currentTick;
    const gap = now - this.lastNote;
    if (gap < 4) return;                             // one strike, heard twice
    this.streak = gap >= GAP_MIN && gap <= GAP_MAX ? this.streak + 1 : 1;
    this.lastNote = now;
    if (this.streak >= 3) this.aliveUntil = now + GAP_MAX + 14;
  }

  // ---- every tick, whether or not he is loaded ----------------------------------------------
  tick(c: Creature | null): void {
    const rec = store.rec, now = system.currentTick;
    const rift = rec.rift;
    if (rec.stage !== "alive" || !rift) return;
    const dim = overworld();
    if (now % 5 === 0) {
      for (const p of players()) {
        let pl: V3;
        try { if (p.dimension.id !== dim.id) continue; pl = p.location; } catch { continue; }
        if (!holdsFin(p)) { this.finNext.delete(p.id); continue; }
        if ((this.finNext.get(p.id) ?? 0) > now) continue;
        // the fin pulses faster, and points, as it nears the place he came through
        const d = dist(pl, rift);
        this.finNext.set(p.id, now + Math.round(clamp(8 + d * 0.3, 8, 70)));
        const eye = p.getHeadLocation();
        const to = norm(sub(rift, eye));
        try {
          p.playSound("basiliskra.fin_pulse", { volume: clamp(1.2 - d / 160, 0.35, 1) });
          p.spawnParticle("basiliskra:fin_spark", add(eye, mul(to, 1.3)));
        } catch { /* left */ }
      }
    }
    if (now % 100 === 0 && rec.form >= 2 && rec.beach && now - rec.learned.fragmentAt > 10 * TICKS.minute) {
      // another fragment lies at his old beach for whoever has lost the first
      for (const p of players()) {
        try {
          if (p.dimension.id === dim.id && dist(p.location, rec.beach) < 7 && !carriesFin(p) && isLoaded(dim, rec.beach)) {
            const lying = dim.getEntities({ location: rec.beach, maxDistance: 10, type: "minecraft:item" }).some((e) => {
              try { return e.getComponent("minecraft:item")?.itemStack.typeId === FIN_ITEM; } catch { return false; }
            });
            if (!lying) this.ctl.dropFin(dim, rec.beach);
            else { rec.learned.fragmentAt = now; }
            break;
          }
        } catch { /* left */ }
      }
    }
    if (rec.form !== 3) return;
    const someone = players().some((p) => { try { return p.dimension.id === dim.id && distXZ(p.location, rift) < 40; } catch { return false; } });
    if (!someone || !isLoaded(dim, rift)) return;
    // teach the timing: the seam itself gives three faint pulses, his knocks, over and over
    const cyc = now % 140;
    if (cyc === 0 || cyc === KNOCK_GAP_TICKS || cyc === KNOCK_GAP_TICKS * 2) {
      particle(dim, "basiliskra:seam_pulse", { x: rift.x, y: rift.y + 5, z: rift.z }, 40);
      if (!this.rhythm) sound(dim, "basiliskra.knock.gill", rift, 24, 0.35);
    }
    // note blocks near the seam: found a layer at a time, then watched for a redstone edge
    if (now % 4 === 0) {
      if (this.scanY > 8) { if (now % 120 === 0) { this.scanY = -4; this.blocks = []; } }
      else {
        const y = Math.floor(rift.y) + 4 + this.scanY;
        for (let dx = -14; dx <= 14; dx++) for (let dz = -14; dz <= 14; dz++) {
          if (this.blocks.length >= 24) break;
          if (idAt(dim, { x: rift.x + dx, y, z: rift.z + dz }) === NOTE) this.blocks.push({ x: Math.floor(rift.x + dx), y, z: Math.floor(rift.z + dz) });
        }
        this.scanY++;
      }
    }
    for (const b of this.blocks) {
      const k = `${b.x},${b.y},${b.z}`;
      let on = false;
      try { on = (blockAt(dim, b)?.getRedstonePower() ?? 0) > 0; } catch { on = false; }
      if (on && !this.powered.get(k)) this.onNote(b);
      this.powered.set(k, on);
    }
  }

  // ---- taking over the animal ------------------------------------------------------------------
  /** Returns true while the ending is driving him (the ordinary encounters are suspended). */
  drive(c: Creature): boolean {
    const rec = store.rec, now = system.currentTick;
    if (rec.form !== 3 || !rec.rift) return false;
    if (!this.act) {
      if (!this.rhythm || now < this.coolUntil || distXZ(c.pos, rec.rift) > 130) return false;
      const brain = this.ctl.brain;
      if (!(brain instanceof BrainThree)) return false;
      brain.finish();
      rec.ending = { step: 1, t0: now, tries: rec.ending?.tries ?? 0 };
      store.touch();
      this.act = this.sequence(c, brain);
    }
    let done = true;
    try { done = this.act.next().done === true; } catch { done = true; }
    if (done) {
      this.act = null;
      if (store.rec.stage === "alive") {
        c.set(PROP.visHi, 8);
        c.setPhase("idle");
        c.halt();
        // an interrupted attempt keeps its count; anything else is simply over
        if (store.rec.ending && store.rec.ending.step !== 0) { store.rec.ending = null; store.touch(); }
      }
    }
    return true;
  }

  private faltered = 0;
  private holding(): boolean {
    this.faltered = this.rhythm ? 0 : this.faltered + 1;
    return this.faltered <= GRACE;
  }

  private *sequence(c: Creature, brain: BrainThree): Generator<void, void, void> {
    const rec = store.rec, rift = rec.rift!, dim = c.dim;
    const seam = (t: number) => { if (t % 4 === 0) particle(dim, "basiliskra:seam", rift, 96); if (t % 60 === 0) sound(dim, "basiliskra.rift.hum", rift, 64); };
    this.faltered = 0;
    // 1. called: he comes to the water's edge nearest the seam (wherever he was) and turns his tail to it
    const surface = rift.y + 5.5;
    let u = norm({ x: c.pos.x - rift.x, y: 0, z: c.pos.z - rift.z });
    if (!u.x && !u.z) u = { x: 1, y: 0, z: 0 };
    let shore = 8, found = 1e9;
    const toHim = u;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, d0 = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      for (let d = 8; d <= 64 && d < found + 6; d += 2) {
        const g = groundY(dim, rift.x + d0.x * d, rift.z + d0.z * d, surface + 10, 40);
        if (typeof g !== "number" || g < surface - 4) continue;
        // nearest bank; between banks about as near, the one on his side
        const cost = d - 5 * dot(d0, toHim);
        if (cost < found) { found = cost; shore = d; u = d0; }
        break;
      }
    }
    const out = (d: number): V3 => ({ x: rift.x + u.x * d, y: c.pos.y, z: rift.z + u.z * d });
    for (const [d, arrive] of [[shore + 2, 5], [shore + 24, 2.5]] as const) {
      const walk = brain.walk(out(d), 0.15, arrive, 2400);
      for (;;) { if (!this.holding()) return; if (walk.next().done) break; yield; }
    }

    // 2. he charges there.  Without a rod in reach of the club he simply fires, and must be called again.
    brain.groundedAt = null;
    const charge = brain.beam(null);
    for (;;) { this.holding(); if (charge.next().done) break; yield; }
    const g = brain.groundedAt as { tick: number; rod: V3 } | null;
    // the rod has to stand by the seam: within 48 blocks of it
    if (!g || distXZ(g.rod, rift) > ROD_NEAR_SEAM || !this.holding()) { this.coolUntil = system.currentTick + 20 * TICKS.second; return; }

    // 3. the rift opens.  He tests it with the notched tip of his tail.
    rec.ending = { step: 3, t0: system.currentTick, tries: rec.ending?.tries ?? 0 };
    store.save();
    sound(dim, "basiliskra.rift.open", rift, 96);
    let t = 0;
    const near = brain.walk(out(3), 0.14, 4, 1400);
    for (;;) { seam(t++); if (!this.holding()) { yield* this.backAway(c, null); return; } if (near.next().done) break; yield; }
    const back = brain.walk(out(25.5), 0.13, 1.5, 900);       // walking outward leaves his tail at the seam
    for (;;) { seam(t++); if (!this.holding()) { yield* this.backAway(c, null); return; } if (back.next().done) break; yield; }
    c.setPhase("crossing");
    for (let i = 0; i < 70; i++) {
      seam(t++);
      if (!this.holding()) { yield* this.backAway(c, null); return; }
      if (i % 10 === 0) particle(dim, "basiliskra:arc_seg", c.anchor("tail_notch"), 64);
      yield;
    }

    // 4. he turns
    const turn = brain.walk(out(54), 0.14, 5, 1200);
    for (;;) { seam(t++); if (!this.holding()) { yield* this.backAway(c, null); return; } if (turn.next().done) break; yield; }

    // 5. and goes through headfirst.  Keep the rhythm going until the tail clears.
    const travel = mul(u, -1);
    const yaw = yawTo({ x: 0, y: 0, z: 0 }, travel);
    c.setPhase("depart");
    c.goTo(out(-70), 0.13, 2);
    sound(dim, "basiliskra.iii.growl", c.anchor("nose"), 72);
    for (let i = 0; i < 3000; i++) {
      seam(t++);
      const hi = this.visibleUpTo(c, rift, travel);
      c.set(PROP.visHi, hi);
      if (hi < 0) break;
      if (!this.holding()) { yield* this.backAway(c, travel); return; }
      // once his head is in, the ground on the far side does not matter: carry him through
      if (hi < 8) { c.pos = add(c.pos, mul(travel, 0.13)); c.yaw = yaw; c.halt(); }
      yield;
    }

    // 6. fully across
    sound(dim, "basiliskra.crossing", rift, 96);
    sound(dim, "basiliskra.rift.close", rift, 96);
    particle(dim, "basiliskra:seam_close", rift, 96);
    this.ctl.retire();
  }

  /** Highest zone still on this side of the seam (-1: the tail has cleared). */
  private visibleUpTo(c: Creature, rift: V3, travel: V3): number {
    const zones = RIGS[c.form].zones;
    let hi = 8;
    for (let z = 8; z >= 0; z--) {
      const bones = zones[String(z)];
      if (!bones || !bones.length) continue;
      const p = c.point(bones[0], RIGS[c.form].bones[bones[0]].pivot);
      if (dot(sub(p, rift), travel) > 0) hi = z - 1; else break;
    }
    return hi;
  }

  /** Interrupted: he backs out of the seam, it closes, and another attempt is allowed. */
  private *backAway(c: Creature, travel: V3 | null): Generator<void, void, void> {
    const rec = store.rec, rift = rec.rift!;
    c.halt();
    if (travel) {
      for (let i = 0; i < 220; i++) {
        c.pos = add(c.pos, mul(travel, -0.12));
        const hi = this.visibleUpTo(c, rift, travel);
        c.set(PROP.visHi, hi);
        if (hi >= 8 && i > 20) break;
        yield;
      }
    }
    c.set(PROP.visHi, 8);
    sound(c.dim, "basiliskra.rift.close", rift, 96);
    particle(c.dim, "basiliskra:seam_close", rift, 96);
    this.coolUntil = system.currentTick + 30 * TICKS.second;
    rec.ending = { step: 0, t0: system.currentTick, tries: (rec.ending?.tries ?? 0) + 1 };
    store.save();
    this.aliveUntil = -9999;
    this.streak = 0;
  }
}
