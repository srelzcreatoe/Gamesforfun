/**
 * The loaded animal: one entity, walked and swum by the script.
 *
 * At this size vanilla gravity, collision and pathfinding do not help, so each tick the script
 * turns him (at a limited rate), steps him, and settles him on the lower median of nine ground
 * columns (land) or inside the water column (Form I).  The same skeleton the client draws gives
 * the world positions of his mouth, gills, feet and club, and of the hit volumes that cover
 * his whole body.
 */
import { Dimension, Entity, EntityDamageCause, GameMode, Player, system, world } from "@minecraft/server";
import { CONFIG, HITBOX, PHASE, PROP, type PhaseName } from "./config";
import { particle, sound, witnesses } from "./fx";
import { Skeleton, poseOf, toWorld, type Form, type PoseAdd } from "./rig";
import { store } from "./store";
import { add, clamp, dist, distXZ, forwardOf, len, mul, norm, sub, turnTowards, wrapDeg, yawTo, type V3 } from "./vec";
import { NONE, UNLOADED, blockAt, footprintY, isLoaded, isSolidBlock, isWaterId, waterColumn } from "./world";

interface PartDef { bone: string; at: [number, number, number]; size: number; tag: "head" | "tail" | "limb" | "body" }
const SIZES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];

/** Hit volumes along the body, in each bone's rest coordinates (model units). */
const PARTS: Record<Form, PartDef[]> = {
  1: [
    { bone: "head", at: [0, 36, -70], size: 2, tag: "head" }, { bone: "head", at: [0, 36, -40], size: 3, tag: "head" },
    { bone: "seg2", at: [0, 36, 72], size: 4, tag: "body" }, { bone: "seg4", at: [0, 36, 136], size: 3, tag: "body" },
    { bone: "seg6", at: [0, 36, 200], size: 3, tag: "body" }, { bone: "seg8", at: [0, 36, 264], size: 2, tag: "tail" },
    { bone: "seg10", at: [0, 36, 328], size: 1, tag: "tail" }, { bone: "tailfin", at: [0, 36, 376], size: 2, tag: "tail" },
  ],
  2: [
    { bone: "head", at: [0, 84, -125], size: 3, tag: "head" }, { bone: "neck", at: [0, 84, -50], size: 3, tag: "head" },
    { bone: "claw_l", at: [54, 6, -30], size: 1, tag: "limb" }, { bone: "claw_r", at: [-54, 6, -30], size: 1, tag: "limb" },
    { bone: "forearm_l", at: [54, 40, -8], size: 1, tag: "limb" }, { bone: "forearm_r", at: [-54, 40, -8], size: 1, tag: "limb" },
    { bone: "mid", at: [0, 60, 66], size: 5, tag: "body" }, { bone: "hips", at: [0, 38, 126], size: 4, tag: "body" },
    { bone: "tail2", at: [0, 30, 192], size: 3, tag: "tail" }, { bone: "tail4", at: [0, 26, 248], size: 2, tag: "tail" },
    { bone: "tail6", at: [0, 23, 304], size: 2, tag: "tail" }, { bone: "knob", at: [0, 32, 358], size: 3, tag: "tail" },
  ],
  3: [
    { bone: "head", at: [0, 114, -262], size: 3, tag: "head" }, { bone: "neck4", at: [0, 114, -186], size: 3, tag: "head" },
    { bone: "neck2", at: [0, 114, -152], size: 3, tag: "head" }, { bone: "chest", at: [0, 106, -96], size: 5, tag: "body" },
    { bone: "hips", at: [0, 110, 78], size: 5, tag: "body" },
    { bone: "leg_fl_lower", at: [40, 40, -100], size: 2, tag: "limb" }, { bone: "leg_fr_lower", at: [-40, 40, -100], size: 2, tag: "limb" },
    { bone: "leg_bl_lower", at: [40, 40, 84], size: 2, tag: "limb" }, { bone: "leg_br_lower", at: [-40, 40, 84], size: 2, tag: "limb" },
    { bone: "foot_fl", at: [40, 4, -112], size: 1, tag: "limb" }, { bone: "foot_fr", at: [-40, 4, -112], size: 1, tag: "limb" },
    { bone: "foot_bl", at: [40, 4, 72], size: 1, tag: "limb" }, { bone: "foot_br", at: [-40, 4, 72], size: 1, tag: "limb" },
    { bone: "tail2", at: [0, 112, 158], size: 3, tag: "tail" }, { bone: "tail4", at: [0, 112, 219], size: 2, tag: "tail" },
    { bone: "tail6", at: [0, 112, 278], size: 1, tag: "tail" }, { bone: "tail8", at: [0, 112, 336], size: 1, tag: "tail" },
    { bone: "club", at: [0, 112, 374], size: 3, tag: "tail" },
  ],
};

const MOVE = {
  1: { turn: 2.2, accel: 0.02, radius: 3.0 },
  2: { turn: 1.5, accel: 0.03, radius: 2.5 },
  3: { turn: 1.25, accel: 0.012, radius: 3.5 },
} as const;

export class Creature {
  readonly dim: Dimension;
  form: Form;
  pos: V3;
  yaw: number;
  speed = 0;
  /** Navigation request for this tick onwards. */
  goal: V3 | null = null;
  goalSpeed = 0;
  arriveDist = 2;
  /** Form I: wanted depth below the surface for the entity origin (belly). */
  swimDepth = 7;
  blocked = 0;
  blockedWhy: "none" | "edge" | "climb" | "shallow" | "unloaded" = "none";
  lookYaw = 0;
  lookPitch = 0;
  bend = 0;
  pitch = 0;
  phase: PhaseName = "idle";
  phaseTicks = 0;
  travelled = 0;
  charge = 0;
  private props = new Map<string, boolean | number | string>();
  private skel: Skeleton | null = null;
  private parts: (Entity | undefined)[] = [];
  private partPos: V3[] = [];
  private lastYaw: number;
  private fxSeq = 0;
  private pushAt = new Map<string, number>();
  tick = 0;

  constructor(readonly entity: Entity) {
    this.dim = entity.dimension;
    this.pos = { ...entity.location };
    this.yaw = entity.getRotation().y;
    this.lastYaw = this.yaw;
    this.form = store.rec.form;
    const p = entity.getProperty(PROP.phase);
    for (const [k, v] of Object.entries(PHASE)) if (v === p) this.phase = k as PhaseName;
  }

  get valid(): boolean { try { return this.entity.isValid; } catch { return false; } }

  // ---- synchronised state -----------------------------------------------------------------
  set(prop: string, value: boolean | number | string): void {
    if (this.props.get(prop) === value) return;
    this.props.set(prop, value);
    try { this.entity.setProperty(prop, value); } catch { /* unloading */ }
  }

  /** Push every synchronised value again (after a load, a rebind, or an evolution). */
  resync(): void {
    this.props.clear();
    this.set(PROP.form, this.form);
    this.set(PROP.bound, true);
    this.set(PROP.phase, PHASE[this.phase]);
    this.set(PROP.charge, Math.round(this.charge));
    this.set(PROP.lookYaw, Math.round(this.lookYaw));
    this.set(PROP.lookPitch, Math.round(this.lookPitch));
    this.set(PROP.bend, Math.round(this.bend));
    this.set(PROP.pitch, Math.round(this.pitch));
  }

  setPhase(name: PhaseName): void {
    if (this.phase !== name) { this.phase = name; this.phaseTicks = 0; }
    this.set(PROP.phase, PHASE[name]);
  }

  setCharge(v: number): void { this.charge = clamp(v, 0, 20); this.set(PROP.charge, Math.round(this.charge)); }

  /** A one-shot client effect (locator-bound particles): bump the sequence so clients see a change. */
  pulse(kind: number): void {
    this.fxSeq = (this.fxSeq + 1) & 15;
    this.set(PROP.fxKind, kind);
    this.set(PROP.fxSeq, this.fxSeq);
  }

  // ---- skeleton -----------------------------------------------------------------------------
  private pose(): PoseAdd {
    // the client only ever sees whole degrees: pose the server skeleton from the same numbers
    return poseOf(this.form, {
      lookYaw: Math.round(this.lookYaw), lookPitch: Math.round(this.lookPitch), bend: Math.round(this.bend), pitch: Math.round(this.pitch),
      charge: this.phase === "charge" || this.phase === "fire" ? 1 : 0, drink: this.phase === "drink" ? 1 : 0,
    });
  }
  skeleton(): Skeleton { return this.skel ?? (this.skel = new Skeleton(this.form, this.pose())); }
  anchor(locator: string): V3 { return toWorld(this.pos, this.yaw, this.skeleton().locator(locator)); }
  point(bone: string, at: number[]): V3 { return toWorld(this.pos, this.yaw, this.skeleton().point(bone, at)); }
  get forward(): V3 { return forwardOf(this.yaw); }
  /** Where the head is pointing: from the throat through the muzzle. */
  aim(): { from: V3; dir: V3 } {
    const from = this.anchor("mouth");
    return { from, dir: norm(sub(this.anchor("muzzle"), this.anchor("throat"))) };
  }

  /** Turn the head (not the feet) towards a point; returns how far off the limit it is. */
  lookAt(target: V3, maxYaw = 80, maxPitch = 40): number {
    const base = this.form === 1 ? this.anchor("throat") : this.point(this.form === 2 ? "neck" : "neck1", this.form === 2 ? [0, 84, -32] : [0, 114, -126]);
    const want = wrapDeg(yawTo(base, target) - this.yaw);
    const flat = Math.max(0.5, distXZ(base, target));
    const pitch = Math.atan2(base.y - target.y, flat) * 180 / Math.PI;
    this.lookYaw = clamp(want, -maxYaw, maxYaw);
    this.lookPitch = clamp(pitch, -maxPitch, maxPitch);
    return Math.abs(want) - maxYaw;
  }
  lookAhead(): void { this.lookYaw = 0; this.lookPitch = 0; }

  /**
   * Point the muzzle itself at a target: look, measure where the skeleton actually aims in its
   * current pose, and correct.  Returns the remaining error in degrees.
   */
  aimAt(target: V3, maxYaw = 80, maxPitch = 40): number {
    let reach = this.lookAt(target, maxYaw, maxPitch);
    let err = 0;
    for (let i = 0; i < 3; i++) {
      this.skel = null;
      const { from, dir } = this.aim();
      const want = norm(sub(target, from));
      const dy = wrapDeg(Math.atan2(-want.x, want.z) * 180 / Math.PI - Math.atan2(-dir.x, dir.z) * 180 / Math.PI);
      const dp = (-Math.asin(clamp(want.y, -1, 1)) + Math.asin(clamp(dir.y, -1, 1))) * 180 / Math.PI;
      err = Math.hypot(dy, dp);
      if (Math.abs(this.lookYaw + dy) > maxYaw) reach = Math.max(reach, Math.abs(this.lookYaw + dy) - maxYaw);
      this.lookYaw = clamp(this.lookYaw + dy, -maxYaw, maxYaw);
      this.lookPitch = clamp(this.lookPitch + dp, -maxPitch, maxPitch);
    }
    this.skel = null;
    return reach > 0 ? reach : -err;
  }

  // ---- movement -----------------------------------------------------------------------------
  goTo(target: V3, speed: number, arrive = 2): void {
    // a new destination starts with a clean slate: being stuck on the way to the last one says nothing about this one
    if (!this.goal || distXZ(this.goal, target) > 1.5) this.blocked = 0;
    this.goal = target; this.goalSpeed = speed; this.arriveDist = arrive;
  }
  halt(): void { this.goal = null; this.goalSpeed = 0; this.blocked = 0; }
  arrived(): boolean { return !this.goal || distXZ(this.pos, this.goal) <= this.arriveDist; }

  private stepLand(next: V3): V3 | null {
    const r = MOVE[this.form].radius;
    const g = footprintY(this.dim, next, r, this.pos.y + (this.form === 3 ? 6 : 3), 24);
    if (g === UNLOADED) { this.blockedWhy = "unloaded"; return null; }
    if (g === NONE) { this.blockedWhy = "edge"; return null; }
    const rise = (g as number) - this.pos.y;
    if (rise > (this.form === 3 ? 3.2 : 1.6)) { this.blockedWhy = "climb"; return null; }
    // never more than 0.45 up or 0.9 down in a tick: no jolts
    return { x: next.x, y: this.pos.y + clamp(rise, -0.9, 0.45), z: next.z };
  }

  private stepWater(next: V3): V3 | null {
    const col = waterColumn(this.dim, next.x, next.z, this.pos.y + 2, 10);
    if (col === UNLOADED) { this.blockedWhy = "unloaded"; return null; }
    if (col === NONE) { this.blockedWhy = "edge"; return null; }
    const depth = col.surface - col.floor;
    if (depth < 3.5) { this.blockedWhy = "shallow"; return null; }
    // the head must have water too
    const head = add(next, mul(this.forward, 7));
    const hc = waterColumn(this.dim, head.x, head.z, this.pos.y + 2, 10);
    if (hc === NONE) { this.blockedWhy = "edge"; return null; }
    const want = clamp(col.surface - this.swimDepth, col.floor + 0.2, Math.max(col.floor + 0.2, col.surface - 2.6));
    return { x: next.x, y: this.pos.y + clamp(want - this.pos.y, -0.18, 0.18), z: next.z };
  }

  /** One tick of locomotion.  Returns the distance covered. */
  private locomote(): number {
    const m = MOVE[this.form];
    let wantSpeed = 0;
    if (this.goal) {
      const d = distXZ(this.pos, this.goal);
      if (d > this.arriveDist) {
        const want = yawTo(this.pos, this.goal);
        const off = Math.abs(wrapDeg(want - this.yaw));
        this.yaw = turnTowards(this.yaw, want, m.turn);
        // slow into a turn he cannot make: the wide turn a boat can cut inside
        wantSpeed = this.goalSpeed * (off > 70 ? 0.35 : off > 35 ? 0.7 : 1) * Math.min(1, d / 3 + 0.25);
      }
    }
    this.speed += clamp(wantSpeed - this.speed, -m.accel * 2, m.accel);
    let moved = 0;
    this.blockedWhy = "none";
    if (this.speed > 0.002) {
      const next = add(this.pos, mul(this.forward, this.speed));
      const settled = this.form === 1 ? this.stepWater(next) : this.stepLand(next);
      if (settled) { moved = distXZ(this.pos, settled); this.pos = settled; this.blocked = 0; }
      else { this.blocked++; this.speed *= 0.5; }
    } else {
      // standing: still settle onto the ground / into the water
      const settled = this.form === 1 ? this.stepWater(this.pos) : this.stepLand(this.pos);
      if (settled) this.pos = settled;
    }
    return moved;
  }

  /** Hand the result to the engine: velocity for smooth client motion, a teleport only to recover. */
  private apply(): void {
    const e = this.entity;
    const loc = e.location;
    const want = sub(this.pos, loc);
    try {
      if (len(want) > 8) e.teleport(this.pos, { rotation: { x: 0, y: this.yaw } });
      else {
        const v = e.getVelocity();
        e.applyImpulse(sub(want, v));
      }
      e.setRotation({ x: 0, y: this.yaw });
    } catch {
      try { e.teleport(this.pos, { rotation: { x: 0, y: this.yaw } }); } catch { /* unloading */ }
    }
  }

  // ---- hit volumes ----------------------------------------------------------------------------
  private syncParts(): void {
    const defs = PARTS[this.form];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const c = this.point(d.bone, d.at);
      const s = SIZES[d.size];
      const at = { x: c.x, y: c.y - s / 2, z: c.z };
      let part = this.parts[i];
      let ok = false;
      try { ok = !!part && part.isValid; } catch { ok = false; }
      if (!ok) {
        if (!isLoaded(this.dim, at)) continue;
        try {
          part = this.dim.spawnEntity(HITBOX, at);
          part.triggerEvent(`basiliskra:size_${d.size}`);
          partOwner.set(part.id, { creature: this, tag: d.tag });
          this.parts[i] = part;
          this.partPos[i] = at;
        } catch { this.parts[i] = undefined; }
        continue;
      }
      const last = this.partPos[i];
      if (!last || dist(last, at) > 0.2) {
        try { part!.teleport(at); this.partPos[i] = at; } catch { this.parts[i] = undefined; }
      }
      if (this.tick % 100 === 0) { try { part!.triggerEvent("basiliskra:keep"); } catch { /* gone */ } }
    }
    for (let i = defs.length; i < this.parts.length; i++) this.dropPart(i);
    this.parts.length = defs.length;
  }

  private dropPart(i: number): void {
    const p = this.parts[i];
    if (!p) return;
    try { partOwner.delete(p.id); if (p.isValid) p.remove(); } catch { /* gone */ }
    this.parts[i] = undefined;
  }

  dropParts(): void {
    for (let i = 0; i < this.parts.length; i++) this.dropPart(i);
    this.parts.length = 0;
  }

  /** Centre and radius of each body volume, for contact checks. */
  volumes(): { at: V3; r: number; tag: PartDef["tag"] }[] {
    const out = PARTS[this.form].map((d) => ({ at: this.point(d.bone, d.at), r: SIZES[d.size] / 2, tag: d.tag }));
    const trunk = this.form === 1 ? { h: 4.4, r: 3.0 } : this.form === 2 ? { h: 7.2, r: 3.3 } : { h: 9.6, r: 4.3 };
    out.push({ at: { x: this.pos.x, y: this.pos.y + trunk.h / 2, z: this.pos.z }, r: trunk.r, tag: "body" });
    return out;
  }

  /** His body is solid to players: anyone inside a volume is eased out of it. */
  private pushPlayers(): void {
    const near = witnesses(this.dim, this.pos, 44);
    if (!near.length) return;
    const vols = this.volumes();
    for (const p of near) {
      if (!targetable(p)) continue;
      const last = this.pushAt.get(p.id) ?? -99;
      if (this.tick - last < 4) continue;
      const pl = p.location;
      const c = { x: pl.x, y: pl.y + 0.9, z: pl.z };
      for (const v of vols) {
        const d = dist(c, v.at);
        if (d < v.r + 0.35) {
          const away = norm({ x: c.x - v.at.x, y: 0, z: c.z - v.at.z });
          try { p.applyKnockback({ x: (away.x || 0.01) * 0.55, z: (away.z || 0.01) * 0.55 }, 0.08); } catch { /* riding */ }
          this.pushAt.set(p.id, this.tick);
          break;
        }
      }
    }
  }

  // ---- per tick -------------------------------------------------------------------------------
  update(): number {
    this.tick++;
    this.phaseTicks++;
    this.skel = null;
    const moved = this.locomote();
    this.travelled += moved;
    const yawRate = wrapDeg(this.yaw - this.lastYaw);
    this.lastYaw = this.yaw;
    // how sharply the body is curved: per-joint angle a trailing spine takes on this turn
    const seg = this.form === 1 ? 2.0 : 1.8;
    const curve = this.speed > 0.03 ? clamp((yawRate * seg) / Math.max(this.speed, 0.08), -24, 24) : this.bendHold;
    this.bend += clamp(curve - this.bend, -1.2, 1.2);
    this.apply();
    this.set(PROP.lookYaw, Math.round(this.lookYaw));
    this.set(PROP.lookPitch, Math.round(this.lookPitch));
    this.set(PROP.bend, Math.round(this.bend));
    this.set(PROP.pitch, Math.round(this.pitch));
    this.skel = null;
    if (this.tick % 2 === 0) { this.syncParts(); this.pushPlayers(); }
    return moved;
  }
  /** Curl held while not moving (sleeping at the seam). */
  bendHold = 0;

  say(id: string, at?: V3, range = 56, volume = 1, pitch = 1): void { sound(this.dim, id, at ?? this.pos, range, volume, pitch); }
  emit(id: string, at: V3, range = 56): void { particle(this.dim, id, at, range); }

  /** Damage a player from him (never on Peaceful when configured so; never Creative/Spectator). */
  hurt(p: Player, amount: number, cause: EntityDamageCause = EntityDamageCause.entityAttack): boolean {
    if (!targetable(p)) return false;
    if (CONFIG.harmlessOnPeaceful && String(world.getDifficulty()).toLowerCase() === "peaceful") return false;
    try { return p.applyDamage(amount * CONFIG.damage, { cause, damagingEntity: this.entity }); } catch { return false; }
  }
}

/** Hit volume entity id -> the creature it belongs to. */
export const partOwner = new Map<string, { creature: Creature; tag: PartDef["tag"] }>();

export function targetable(p: Player): boolean {
  try {
    if (!p.isValid) return false;
    const gm = p.getGameMode();
    return gm !== GameMode.Creative && gm !== GameMode.Spectator;
  } catch { return false; }
}

export function inWater(dim: Dimension, at: V3): boolean { return isWaterId(blockAt(dim, at)?.typeId); }
export function standingBlockSolid(dim: Dimension, at: V3): boolean { return isSolidBlock(blockAt(dim, { x: at.x, y: at.y - 1, z: at.z })); }
