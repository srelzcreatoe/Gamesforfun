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
import { Skeleton, drawScale, poseOf, toWorld, type Form, type PoseAdd } from "./rig";
import { BETA_III, LIFT_III, STANCE_MODEL_III } from "./generated/rig";
import { crush, wither } from "./havoc";
import { store } from "./store";
import { add, clamp, dist, distXZ, forwardOf, leftOf, len, mul, norm, sub, turnTowards, wrapDeg, yawTo, type V3 } from "./vec";
import { NONE, UNLOADED, blockAt, clearLine, footprintY, groundY, isLoaded, isSolidBlock, isWaterId, trunkBlocked, waterColumn, waterOver } from "./world";

type Leg = "fl" | "fr" | "bl" | "br";
/** `size`: edge of the cube in model blocks (scaled with the form).  `leg`: follows that leg's walk cycle (`swing` of it). */
interface PartDef { bone: string; at: [number, number, number]; size: number; tag: "head" | "tail" | "limb" | "body"; leg?: Leg; swing?: number }
/** Edges of the hit volume sizes the helper entity offers (packs/BP/entities/basiliskra_hitbox.json, size_0 ..). */
const SIZES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 9, 11, 13];
const sizeIndex = (edge: number): number => {
  let best = 0;
  for (let i = 1; i < SIZES.length; i++) if (Math.abs(SIZES[i] - edge) < Math.abs(SIZES[best] - edge)) best = i;
  return best;
};

/** Hit volumes along the body, in each bone's rest coordinates (model units). */
const PARTS: Record<Form, PartDef[]> = {
  1: [
    { bone: "head", at: [0, 36, -70], size: 3.5, tag: "head" }, { bone: "head", at: [0, 36, -40], size: 4.5, tag: "head" },
    { bone: "seg2", at: [0, 36, 72], size: 5.5, tag: "body" }, { bone: "seg4", at: [0, 36, 136], size: 4.5, tag: "body" },
    { bone: "seg6", at: [0, 36, 200], size: 4.5, tag: "body" }, { bone: "seg8", at: [0, 36, 264], size: 3.5, tag: "tail" },
    { bone: "seg10", at: [0, 36, 328], size: 2.5, tag: "tail" }, { bone: "tailfin", at: [0, 36, 376], size: 3.5, tag: "tail" },
  ],
  2: [
    { bone: "head", at: [0, 84, -125], size: 4.5, tag: "head" }, { bone: "neck", at: [0, 84, -50], size: 4.5, tag: "head" },
    { bone: "claw_l", at: [54, 6, -30], size: 2.5, tag: "limb" }, { bone: "claw_r", at: [-54, 6, -30], size: 2.5, tag: "limb" },
    { bone: "forearm_l", at: [54, 40, -8], size: 2.5, tag: "limb" }, { bone: "forearm_r", at: [-54, 40, -8], size: 2.5, tag: "limb" },
    { bone: "mid", at: [0, 60, 66], size: 6.5, tag: "body" }, { bone: "hips", at: [0, 38, 126], size: 5.5, tag: "body" },
    { bone: "tail2", at: [0, 30, 192], size: 4.5, tag: "tail" }, { bone: "tail4", at: [0, 26, 248], size: 3.5, tag: "tail" },
    { bone: "tail6", at: [0, 23, 304], size: 3.5, tag: "tail" }, { bone: "knob", at: [0, 32, 358], size: 4.5, tag: "tail" },
  ],
  3: [
    { bone: "head", at: [0, 114, -262], size: 4.5, tag: "head" }, { bone: "neck4", at: [0, 114, -186], size: 4.5, tag: "head" },
    { bone: "neck2", at: [0, 114, -152], size: 4.5, tag: "head" }, { bone: "chest", at: [0, 106, -96], size: 6.5, tag: "body" },
    { bone: "hips", at: [0, 110, 78], size: 6.5, tag: "body" }, { bone: "body", at: [0, 104, -10], size: 6.5, tag: "body" },
    // the legs: a volume at the knee and one at the sole, each carried with its own leg through the walk
    { bone: "leg_fl_lower", at: [40, 40, -100], size: 3.5, tag: "limb", leg: "fl", swing: 0.5 }, { bone: "leg_fr_lower", at: [-40, 40, -100], size: 3.5, tag: "limb", leg: "fr", swing: 0.5 },
    { bone: "leg_bl_lower", at: [40, 40, 84], size: 3.5, tag: "limb", leg: "bl", swing: 0.5 }, { bone: "leg_br_lower", at: [-40, 40, 84], size: 3.5, tag: "limb", leg: "br", swing: 0.5 },
    { bone: "foot_fl", at: [40, 4, -112], size: 2.5, tag: "limb", leg: "fl", swing: 1 }, { bone: "foot_fr", at: [-40, 4, -112], size: 2.5, tag: "limb", leg: "fr", swing: 1 },
    { bone: "foot_bl", at: [40, 4, 72], size: 2.5, tag: "limb", leg: "bl", swing: 1 }, { bone: "foot_br", at: [-40, 4, 72], size: 2.5, tag: "limb", leg: "br", swing: 1 },
    { bone: "tail2", at: [0, 112, 158], size: 4.5, tag: "tail" }, { bone: "tail4", at: [0, 112, 219], size: 3.5, tag: "tail" },
    { bone: "tail6", at: [0, 112, 278], size: 2.5, tag: "tail" }, { bone: "tail8", at: [0, 112, 336], size: 2.5, tag: "tail" },
    { bone: "club", at: [0, 112, 374], size: 4.5, tag: "tail" },
  ],
};
/** Where each leg is in the four-beat cycle, relative to the left hind (the same offsets as the client walk). */
const LEG_PHASE: Record<Leg, number> = { bl: 0, fl: 270, br: 180, fr: 90 };

/** Per form, in world blocks (Forms II and III are drawn 1.25 and 1.7 times their model size). */
const MOVE = {
  1: { turn: 2.2, accel: 0.02, radius: 3.0 },
  2: { turn: 1.4, accel: 0.03, radius: 3.1 },
  3: { turn: 1.0, accel: 0.011, radius: 6.0 },
} as const;
/**
 * What stops a body on land.  `built` and `cliff` are heights above his feet (see trunkBlocked);
 * `front` is how far ahead of his middle the shoulders are; `look` is how far ahead he reads the
 * ground when he chooses a heading (his turning circle is wide: he has to decide early).
 */
/** How far below his feet he will still find a floor to step down to (a sea bed, a ravine side). */
const DROP = 30;
const BODY = {
  2: { built: [1.8, 3.2], cliff: 4.5, front: 4.4, look: [0.6, 2, 5, 9, 13], wade: 2, climb: 2.0, top: 4 },
  3: { built: [4.2, 6.1], cliff: 8.2, front: 9.4, look: [0.6, 3, 10, 17, 24], wade: 8, climb: 5.4, top: 10 },
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
  blockedWhy: "none" | "edge" | "climb" | "shallow" | "unloaded" | "wall" | "deep" = "none";
  private steerOff = 0;
  private steerSide = 0;
  private steerAt = -99;
  private goalWalled = false;
  /** Land forms keep out of water deeper than they can stand in, unless something (the last crossing) sends them in. */
  wade = false;
  /** Swimming: in water over his depth, held at that depth instead of walking the bed. */
  afloat = false;
  private surfY: number | null | undefined = undefined;
  private partIds: (string | undefined)[] = [];
  private partSize: number[] = [];
  /** Form III: where the walk cycle is, in degrees (0 = left hind landing), kept by the brain from its footfalls. */
  walkPhase = 0;
  /** Smash through what is built in his way (wither mode, Form III, set by the brain while he walks). */
  smash = false;
  private crushAt = -99;
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
  private crushedAt = new Map<string, number>();
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
      window: this.phase === "window" || this.phase === "stalk" ? 1 : 0,
    });
  }
  /** How much larger than modelled he is drawn. */
  get scale(): number { return drawScale(this.form); }
  skeleton(): Skeleton {
    return this.skel ?? (this.skel = new Skeleton(this.form, this.pose(), this.phase === "window" || this.phase === "stalk" ? 1 : 0));
  }
  anchor(locator: string): V3 { return toWorld(this.pos, this.yaw, this.skeleton().locator(locator), this.scale); }
  point(bone: string, at: number[]): V3 { return toWorld(this.pos, this.yaw, this.skeleton().point(bone, at), this.scale); }

  /** Model-unit offset (forward, up) of a sole from its rest place, at this point of the walk (as the client solves it). */
  private legOffset(leg: Leg): [number, number] {
    const p = (((this.walkPhase + LEG_PHASE[leg]) % 360) + 360) % 360 / 360;
    if (p < BETA_III) return [STANCE_MODEL_III * (0.5 - p / BETA_III), 0];
    const su = (p - BETA_III) / (1 - BETA_III);
    return [-STANCE_MODEL_III / 2 + STANCE_MODEL_III * su * su * (3 - 2 * su), LIFT_III * Math.sin(Math.PI * su) * (this.phase === "move" || this.phase === "stalk" ? 1 : 0)];
  }
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
    if (!this.goal || distXZ(this.goal, target) > 1.5) { this.blocked = 0; this.steerOff = 0; this.steerSide = 0; this.steerAt = -99; this.goalWalled = false; }
    this.goal = target; this.goalSpeed = speed; this.arriveDist = arrive;
  }
  halt(): void { this.goal = null; this.goalSpeed = 0; this.blocked = 0; this.steerOff = 0; this.steerSide = 0; this.goalWalled = false; }
  arrived(): boolean { return !this.goal || distXZ(this.pos, this.goal) <= this.arriveDist; }

  // ---- walls -----------------------------------------------------------------------------------
  private walled(at: V3, full: boolean): boolean {
    const b = BODY[this.form as 2 | 3];
    // afloat, a bank is judged from the water line, not from the depth he hangs at: he can haul out over a low one
    const feet = this.afloat && this.surfY != null ? Math.max(this.pos.y, this.surfY - 1.2) : this.pos.y;
    // smashing his way, only the world's own rock turns him: what is built is in front of him, not in his way
    return trunkBlocked(this.dim, at, feet, MOVE[this.form].radius, b.built, b.cliff, full, this.smashing());
  }

  /** Is there room for his middle here (used by the few moves that carry him without stepping)? */
  roomAt(at: V3): boolean {
    for (const dy of [1, 3]) {
      const b = blockAt(this.dim, { x: at.x, y: at.y + dy, z: at.z });
      if (b && isSolidBlock(b)) return false;
    }
    return true;
  }

  private smashing(): boolean { return this.smash && this.form === 3 && wither(); }

  /** Clear what is built in the slab in front of his shoulders.  Cheap probe first; the slab only when it is needed. */
  private crushAhead(): void {
    if (this.tick - this.crushAt < 3) return;
    const b = BODY[3];
    const ahead = add(this.pos, mul(this.forward, b.front));
    if (!trunkBlocked(this.dim, ahead, this.pos.y, MOVE[3].radius * 0.8, b.built, 99, false)) return;
    this.crushAt = this.tick;
    const broke = crush(this.dim, this.pos, this.forward, b.front - 1, Math.round(MOVE[3].radius * 0.85), 1, Math.round(9.6 * this.scale), 3, 96);
    if (broke) this.speed *= 0.7;           // it costs him something
  }

  /** Water deeper than this form wades: Form II drags through shallows, Form III stands belly-deep. */
  private tooDeep(at: V3, floorY: number): boolean {
    if (this.wade || this.form === 1) return false;
    return waterOver(this.dim, at.x, at.z, floorY, BODY[this.form].wade);
  }

  /** Already in water over his depth (swimming, or sunk to the bed): then every way is a way out. */
  private inDeep(): boolean { return this.afloat || this.tooDeep(this.pos, this.pos.y); }

  private clearAlong(yaw: number, reach: number): boolean {
    const f = forwardOf(yaw);
    for (const s of BODY[this.form as 2 | 3].look) {
      if (s > reach) break;
      const at = add(this.pos, mul(f, s));
      // the same ring the step itself is checked with: at his size the diagonals matter
      if (this.walled(at, true)) return false;
      // a drop with no floor in reach is a wall too: he walks the brink, not off it; and so is water over his depth
      const floor = groundY(this.dim, at.x, at.z, this.pos.y + 6, DROP + 6);
      if (floor === NONE) return false;
      if (typeof floor === "number" && !this.inDeep() && this.tooDeep(at, floor)) return false;
    }
    return true;
  }

  /**
   * The heading to hold on the way to the goal.  Straight at it when the way is clear; otherwise the
   * smallest turn that clears the wall, and the same way round until the wall is behind him.
   */
  private steer(want: number, d: number): number {
    if (this.form === 1) return want;
    if (this.tick - this.steerAt >= 4) {
      this.steerAt = this.tick;
      let off = 0;
      if (this.clearAlong(want, d + 1)) this.steerSide = 0;
      else if (d < 16 && this.walled(this.goal!, false)) this.goalWalled = true;      // the goal itself is inside something
      else {
        const sides = this.steerSide ? [this.steerSide, -this.steerSide] : (wrapDeg(this.yaw - want) >= 0 ? [1, -1] : [-1, 1]);
        search: for (const a of [25, 50, 75, 100, 130]) for (const s of sides) {
          if (this.clearAlong(want + s * a, 1e9)) { off = s * a; this.steerSide = s; break search; }
        }
      }
      this.steerOff = off;
    }
    return want + this.steerOff;
  }

  private stepLand(next: V3, moving = true): V3 | null {
    const r = MOVE[this.form].radius;
    // never into a wall, a cliff face or a building (unless he already stands in one: then any way out)
    const front = mul(this.forward, BODY[this.form as 2 | 3].front);
    // the middle is judged a little ahead, as the steering judges it: a crawl past a corner is not refused for a ring point
    const ahead = add(this.pos, mul(this.forward, Math.max(0.6, this.speed)));
    if (moving && (this.walled(add(next, front), true) || this.walled(ahead, false)) && !this.walled(this.pos, false)) { this.blockedWhy = "wall"; return null; }
    // water: found from where he is, a few times a second.  Deeper than he stands in, he swims at his depth
    // rather than sink to the bed, and a bank he could not step up he can haul himself out over.
    const lim = BODY[this.form as 2 | 3].wade;
    if (this.tick % 5 === 0 || this.surfY === undefined) {
      const wc = waterColumn(this.dim, next.x, next.z, this.pos.y + lim, 8, 2);
      this.surfY = wc === NONE || wc === UNLOADED ? null : wc.surface;
    }
    const floatY = this.surfY !== null && this.surfY !== undefined ? this.surfY - lim : null;
    const top = BODY[this.form as 2 | 3].top;
    const yTop = this.pos.y + top + (this.afloat ? lim + 2 : 0);
    const mid = groundY(this.dim, next.x, next.z, yTop, DROP + top);                     // the ground under his middle
    if (moving && !this.wade && !this.inDeep() && typeof mid === "number" && this.tooDeep(next, mid)) { this.blockedWhy = "deep"; return null; }
    let g = footprintY(this.dim, next, r, yTop, DROP + top, floatY);
    if (g === UNLOADED) { this.blockedWhy = "unloaded"; return null; }
    if (g === NONE) { this.blockedWhy = "edge"; return null; }
    // leaving the water, the bank under his middle is where he stands, whatever the water round it says
    if (floatY !== null && (g as number) <= floatY + 0.01 && typeof mid === "number" && mid > floatY) g = mid;
    const rise = (g as number) - this.pos.y;
    const swims = floatY !== null && (g as number) <= floatY + 0.01 && isWaterId(blockAt(this.dim, { x: next.x, y: floatY, z: next.z })?.typeId);
    if (!swims && rise > (this.afloat ? lim + 1.6 : BODY[this.form as 2 | 3].climb)) { this.blockedWhy = "climb"; return null; }
    this.afloat = swims || (this.afloat && rise > 0.5);          // still hauling himself up the bank
    // never more than 0.45 up or 0.9 down in a tick: no jolts
    return { x: next.x, y: this.pos.y + clamp(rise, -0.9, 0.45), z: next.z };
  }

  private stepWater(next: V3, moving = true): V3 | null {
    const col = waterColumn(this.dim, next.x, next.z, this.pos.y + 2, 10, 28);
    if (col === UNLOADED) { this.blockedWhy = "unloaded"; return null; }
    if (col === NONE) { this.blockedWhy = "edge"; return null; }
    const depth = col.surface - col.floor;
    if (depth < 3.5) { this.blockedWhy = "shallow"; return null; }
    if (moving) {
      // the head must have water too
      const head = add(next, mul(this.forward, 7));
      const hb = blockAt(this.dim, { x: head.x, y: this.pos.y + 1.5, z: head.z });
      if (hb && !isWaterId(hb.typeId)) { this.blockedWhy = "edge"; return null; }
      // the shoulders: a pier post, a bridge footing, a wall in the water stops him where the head found room
      const l = leftOf(this.yaw), sh = add(next, mul(this.forward, 3));
      for (const side of [-2.6, 2.6]) for (const dy of [0.8, 2.8]) {
        if (isSolidBlock(blockAt(this.dim, { x: sh.x + l.x * side, y: next.y + dy, z: sh.z + l.z * side }))) { this.blockedWhy = "wall"; return null; }
      }
    }
    const want = clamp(col.surface - this.swimDepth, col.floor + 0.2, Math.max(col.floor + 0.2, col.surface - 2.6));
    return { x: next.x, y: this.pos.y + clamp(want - this.pos.y, -0.18, 0.18), z: next.z };
  }

  /**
   * Form I out of water (the pond was drained, ice closed over, something carried him): look for the
   * nearest deep column in loaded chunks and slide back into it.  He is never left lying in rock.
   */
  private unsettled = true;
  private dry = 0;
  private keepWet(): void {
    const here = blockAt(this.dim, { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z });
    if (!here || isWaterId(here.typeId)) { this.dry = 0; return; }
    if (++this.dry < 40 || this.dry % 10) return;
    for (let r = 4; r <= 36; r += 4) for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
      const col = waterColumn(this.dim, x, z, this.pos.y + 2, 12);
      if (col === UNLOADED || col === NONE || col.surface - col.floor < 4) continue;
      const to = { x, y: clamp(this.pos.y, col.floor + 0.2, col.surface - 3), z };
      this.pos = add(this.pos, mul(norm(sub(to, this.pos)), Math.min(2.5, dist(to, this.pos))));
      return;
    }
  }

  /** One tick of locomotion.  Returns the distance covered. */
  private locomote(): number {
    const m = MOVE[this.form];
    let wantSpeed = 0;
    if (this.goal) {
      const d = distXZ(this.pos, this.goal);
      if (d > this.arriveDist) {
        const want = this.steer(yawTo(this.pos, this.goal), d);
        const off = Math.abs(wrapDeg(want - this.yaw));
        this.yaw = turnTowards(this.yaw, want, m.turn);
        // slow into a turn he cannot make: the wide turn a boat can cut inside
        wantSpeed = this.goalSpeed * (off > 70 ? 0.35 : off > 35 ? 0.7 : 1) * Math.min(1, d / 3 + 0.25);
        if (this.goalWalled) { wantSpeed = 0; this.blocked++; this.blockedWhy = "wall"; }
      }
    }
    this.speed += clamp(wantSpeed - this.speed, -m.accel * 2, m.accel);
    let moved = 0;
    if (!this.goalWalled) this.blockedWhy = "none";
    if (this.speed > 0.002) {
      if (this.smashing()) this.crushAhead();
      const next = add(this.pos, mul(this.forward, this.speed));
      const settled = this.form === 1 ? this.stepWater(next) : this.stepLand(next);
      if (settled) { moved = distXZ(this.pos, settled); this.pos = settled; if (!this.goalWalled) this.blocked = 0; }
      else { this.blocked++; this.speed *= 0.5; }
    } else {
      // standing: still settle onto the ground (a few times a second is plenty) / into the water
      if (this.form === 1) { const settled = this.stepWater(this.pos, false); if (settled) this.pos = settled; }
      else if (this.tick % 5 === 0 || this.unsettled) {
        const settled = this.stepLand(this.pos, false);
        this.unsettled = !!settled && Math.abs(settled.y - this.pos.y) > 0.01;
        if (settled) this.pos = settled;
      }
    }
    if (this.form === 1) this.keepWet();
    return moved;
  }

  /** Hand the result to the engine: velocity for smooth client motion, a teleport only to recover. */
  private apply(): void {
    const e = this.entity;
    // carried through a portal (the entity is dimension-bound, but nothing here relies on that): bring him back
    if (this.tick % 10 === 0) {
      try { if (e.dimension.id !== this.dim.id) { e.teleport(this.pos, { dimension: this.dim, rotation: { x: 0, y: this.yaw } }); return; } } catch { /* unloading */ }
    }
    let loc: V3;
    try { loc = e.location; } catch { return; }       // removed or unloading this very tick
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
      let c = this.point(d.bone, d.at);
      if (d.leg) {
        // the server skeleton stands its legs at rest: carry the volume to where the client's walk has put that leg
        const [fwd, up] = this.legOffset(d.leg);
        const k = (d.swing ?? 1) * this.scale / 16;
        c = add(add(c, mul(this.forward, fwd * k)), { x: 0, y: up * k, z: 0 });
      }
      const si = sizeIndex(d.size * this.scale);
      const s = SIZES[si];
      // the box stands on its lowest point: a foot's box starts at the ground it stands on, never below it
      const at = { x: c.x, y: Math.max(c.y - s / 2, this.pos.y - 0.25), z: c.z };
      let part = this.parts[i];
      let ok = false;
      try { ok = !!part && part.isValid; } catch { ok = false; }
      if (!ok) {
        if (this.partIds[i]) { partOwner.delete(this.partIds[i]!); this.partIds[i] = undefined; }
        if (!isLoaded(this.dim, at)) continue;
        try {
          part = this.dim.spawnEntity(HITBOX, at);
          part.triggerEvent(`basiliskra:size_${si}`);
          this.partSize[i] = si;
          partOwner.set(part.id, { creature: this, tag: d.tag });
          this.parts[i] = part;
          this.partIds[i] = part.id;
          this.partPos[i] = at;
        } catch { this.parts[i] = undefined; }
        continue;
      }
      if (this.partSize[i] !== si) { try { part!.triggerEvent(`basiliskra:size_${si}`); this.partSize[i] = si; } catch { /* gone */ } }
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
    if (this.partIds[i]) { partOwner.delete(this.partIds[i]!); this.partIds[i] = undefined; }
    if (!p) return;
    try { if (p.isValid) p.remove(); } catch { /* gone */ }
    this.parts[i] = undefined;
  }

  dropParts(): void {
    for (let i = 0; i < this.parts.length; i++) this.dropPart(i);
    this.parts.length = 0;
  }

  /** Centre and radius of each body volume, for contact checks. */
  volumes(): { at: V3; r: number; tag: PartDef["tag"] }[] {
    const k = this.scale;
    const out = PARTS[this.form].map((d) => ({ at: this.point(d.bone, d.at), r: SIZES[sizeIndex(d.size * k)] / 2, tag: d.tag }));
    const trunk = this.form === 1 ? { h: 4.4, r: 3.0 } : this.form === 2 ? { h: 7.2 * k, r: 3.3 * k } : { h: 9.6 * k, r: 4.3 * k };
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
          if (!clearLine(this.dim, v.at, c)) continue;
          const away = norm({ x: c.x - v.at.x, y: 0, z: c.z - v.at.z });
          try { p.applyKnockback({ x: (away.x || 0.01) * 0.55, z: (away.z || 0.01) * 0.55 }, 0.08); } catch { /* riding */ }
          this.pushAt.set(p.id, this.tick);
          // he does not step round you: under a walking giant you are trodden on
          if (this.form !== 1 && this.speed > 0.04 && this.tick - (this.crushedAt.get(p.id) ?? -99) >= 12) {
            this.crushedAt.set(p.id, this.tick);
            this.hurt(p, this.form === 3 ? 4 : 2);
          }
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
