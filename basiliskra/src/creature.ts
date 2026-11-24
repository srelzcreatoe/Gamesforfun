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
import { CONFIG, PHASE, PROP, hitboxId, type PhaseName } from "./config";
import { particle, sound, witnesses } from "./fx";
import { Skeleton, drawScale, poseOf, quad, toWorld, type Form, type PoseAdd } from "./rig";
import { BETA_III, BETA_IV, LIFT_III, LIFT_IV, RIGS, STANCE_MODEL_III, STANCE_MODEL_IV, VOICE_KIND } from "./generated/rig";
import { crush, ploughBox, ploughNoise, wither } from "./havoc";
import { Planner } from "./path";
import { store } from "./store";
import { add, clamp, dist, distXZ, forwardOf, leftOf, len, mul, norm, sub, turnTowards, wrapDeg, yawTo, type V3 } from "./vec";
import { NONE, UNLOADED, blockAt, clearLine, footprintY, groundY, isLoaded, isNaturalGround, isPlantBlock, isSolidBlock, isWaterId, trunkBlocked, waterColumn, waterOver } from "./world";

type Leg = "fl" | "fr" | "bl" | "br" | "l" | "r";
type PartTag = "head" | "tail" | "limb" | "body";
/** One hit volume: a cube of edge SIZES[si], centred on `at` (model units, in the bone's own frame). */
interface PartDef { bone: string; at: [number, number, number]; si: number; tag: PartTag; leg?: Leg; swing?: number }
/** Edges of the hit volume entities (basiliskra:hitbox_0 .., see tools/kit/gen_hitbox.py). */
export const SIZES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 9, 11, 13];

const partCache = new Map<Form, PartDef[]>();
/**
 * His hit volumes, hung on every solid part of the skeleton the model kit built (the box round each bone's
 * flesh: `RIGS[form].boxes`), so that every form is covered from the tip of the nose to the end of the tail
 * and nothing has to be kept in step by hand.  Big parts first; a part already inside what bigger ones cover
 * gets none of its own; a part longer than it is thick gets a row of them.
 */
export function partsFor(form: Form): PartDef[] {
  const hit = partCache.get(form);
  if (hit) return hit;
  const scale = drawScale(form), k = scale / 16;                 // model units -> blocks as he is drawn
  const rest = new Skeleton(form, {});
  const maxEdge = SIZES[SIZES.length - 1] / k / 1.02;
  const bones = Object.entries(RIGS[form].boxes)
    .map(([bone, [lo, hi]]) => ({ bone, lo, hi, d: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] }))
    .sort((p, q) => q.d[0] * q.d[1] * q.d[2] - p.d[0] * p.d[1] * p.d[2]);
  const placed: { c: number[]; h: number }[] = [];               // in rest-pose model space: centre and half-edge
  const inside = (p: number[]) => placed.some((b) => Math.abs(p[0] - b.c[0]) <= b.h && Math.abs(p[1] - b.c[1]) <= b.h && Math.abs(p[2] - b.c[2]) <= b.h);
  const out: PartDef[] = [];
  for (const { bone, lo, hi, d } of bones) {
    const sorted = [...d].sort((x, y) => y - x), L = sorted[0], M = sorted[1];
    if (L * k < 1.0) continue;                                    // an eye, a gill flap: not worth a volume
    // (Basiliskra IV is so large that the bones of his wing fingers, a block thick and forty long, would take two
    // hundred volumes between them: his wings are struck at the arm; and his parts are tiled more loosely)
    const big = form === 4;
    if (big && M * k < 3) continue;
    // is it already covered by what has been placed for bigger parts?
    let got = 0, all = 0;
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) for (const fz of [0.1, 0.5, 0.9]) {
      all++;
      if (inside(rest.point(bone, [lo[0] + d[0] * fx, lo[1] + d[1] * fy, lo[2] + d[2] * fz]))) got++;
    }
    if (got / all >= 0.85) continue;
    const edge = Math.min(L / M < 1.3 ? L : M, maxEdge);
    let si = SIZES.findIndex((sz) => sz >= edge * k * 1.02);
    if (si < 0) si = SIZES.length - 1;
    const half = SIZES[si] / 2 / k;
    const n = d.map((len) => Math.max(1, Math.ceil((len - edge * (big ? 0.35 : 0.2)) / edge)));
    const tag: PartTag = /^(head|jaw|neck)/.test(bone) ? "head" : /^(tail|club|knob|seg(8|9|10)$|tailfin)/.test(bone) ? "tail"
      : /^(leg|foot|arm|forearm|claw|hand|wing|fin)/.test(bone) ? "limb" : "body";
    const lm = quad(form) ? /^(?:leg|foot)_(fl|fr|bl|br)(_lower)?$/.exec(bone) : form === 4 ? /^(?:leg|foot)_(l|r)(_lower)?$/.exec(bone) : null;
    const leg = lm ? (lm[1] as Leg) : undefined;
    const swing = lm ? (bone.startsWith("foot") ? 1 : lm[2] ? 0.55 : 0.25) : undefined;
    for (let ix = 0; ix < n[0]; ix++) for (let iy = 0; iy < n[1]; iy++) for (let iz = 0; iz < n[2]; iz++) {
      const at = [ix, iy, iz].map((i, ax) => (n[ax] === 1 ? (lo[ax] + hi[ax]) / 2 : lo[ax] + edge / 2 + (i * (d[ax] - edge)) / (n[ax] - 1))) as [number, number, number];
      out.push({ bone, at, si, tag, leg, swing });
      placed.push({ c: rest.point(bone, at), h: half });
    }
  }
  partCache.set(form, out);
  return out;
}

/** How far Basiliskra IV's wings stand open in each phase (the client eases to the same figures), and when his club is in the ground. */
const WINGS: Partial<Record<PhaseName, number>> = { recoil: 1, roar: 0.85, evolve: 1, rise: 0.7, fire: 0.3, rear: 1, pivot: 0.45, bite: 0.5, fall: 0.6 };
const PLANTED = new Set<PhaseName>(["charge", "fire", "pour", "rear", "pivot", "skid"]);
/** Where each leg is in the four-beat cycle, relative to the left hind (the same offsets as the client walk). */
const LEG_PHASE: Record<Leg, number> = { bl: 0, fl: 270, br: 180, fr: 90, l: 0, r: 180 };

/** Per form, in world blocks (Forms II and III are drawn 1.25 and 1.7 times their model size). */
const MOVE = {
  1: { turn: 2.2, accel: 0.02, radius: 3.0 },
  2: { turn: 1.4, accel: 0.03, radius: 3.1 },
  3: { turn: 1.0, accel: 0.011, radius: 6.0 },
  4: { turn: 0.75, accel: 0.012, radius: 9.0 },
  // Vathrok (2.0): longer and taller than Form III, on the same four-beat walk
  5: { turn: 0.95, accel: 0.012, radius: 7.0 },
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
  4: { built: [6, 11], cliff: 15, front: 11, look: [0.6, 4, 14, 24, 34], wade: 16, climb: 7.4, top: 24 },
  5: { built: [5, 8.5], cliff: 10, front: 12, look: [0.6, 3, 12, 20, 28], wade: 10, climb: 6.0, top: 16 },
} as const;
type Walker = 2 | 3 | 4 | 5;

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

  /** How much harder than Basiliskra himself this body hits, and how much faster it walks (the Titan). */
  might = 1;
  /** If set, what any blow of its does to a player or a creature, whatever the blow (the Titan: they die of it). */
  lethal = 0;
  /** Whose colours its breath is drawn in: "" his red, "v" Vathrok's green (beam.ts tint). */
  hue = "";
  haste = 1;

  constructor(readonly entity: Entity, form: Form = store.rec.form) {
    this.dim = entity.dimension;
    this.pos = { ...entity.location };
    this.yaw = entity.getRotation().y;
    this.lastYaw = this.yaw;
    this.form = form;
    giants.set(entity.id, this);
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
    const b = this.breathPose();
    return poseOf(this.form, {
      lookYaw: Math.round(this.lookYaw), lookPitch: Math.round(this.lookPitch), bend: Math.round(this.bend), pitch: Math.round(this.pitch),
      charge: b.charge, drink: this.phase === "drink" ? 1 : 0,
      window: this.phase === "window" || this.phase === "stalk" ? 1 : 0,
      wings: WINGS[this.phase] ?? 0, plant: PLANTED.has(this.phase) ? 1 : 0, pivot: this.phase === "pivot" ? 1 : 0,
      jaw: b.jaw, lean: b.lean, chest: b.chest,
    });
  }
  /**
   * What the client animation adds to his jaw, chest and body in the phases of a breath, once it has settled (the
   * same numbers as tools/kit/gen_client.py): the mouth the beam leaves by must be where it is drawn.
   */
  private breathPose(): { charge: number; jaw: number; lean: number; chest: number; body: number[] } {
    const ph = this.phase, f = this.form;
    const charging = ph === "charge" || ph === "fire" || ph === "pour" || ph === "rear" || (f === 4 && (ph === "skid" || ph === "pivot"));
    const firing = ph === "fire" || (f === 4 && (ph === "skid" || ph === "pivot"));
    const pour = ph === "pour" ? 10 : ph === "rear" ? 22 : 0;
    const skid = f === 4 && (ph === "skid" || ph === "pivot");
    if (f === 3) {
      return { charge: charging ? 1 : 0, jaw: (charging ? this.charge * 0.9 : 0) + (firing ? 16 : 0) + pour + (ph === "vent" ? 6 : 0) + (ph === "grounded" ? 8 : 0),
               lean: 0, chest: (firing ? -1.5 : 0) + (ph === "pour" ? 3 : ph === "rear" ? -8 : 0), body: [0, charging ? -3 : 0, 0] };
    }
    if (f === 4) {
      return { charge: charging ? 1 : 0, jaw: (charging ? this.charge * 0.8 : 0) + (firing ? 14 : 0) + pour + (ph === "vent" ? 6 : 0) + (ph === "grounded" ? 8 : 0) + (ph === "recoil" ? 24 : 0),
               lean: skid ? -6 : 0, chest: (firing ? -2 : 0) + (ph === "pour" ? 12 : ph === "rear" ? -30 : 0), body: [0, (charging ? -4 : 0) + (skid ? -5 : 0), skid ? 5 : 0] };
    }
    return { charge: 0, jaw: 0, lean: 0, chest: 0, body: [0, 0, 0] };
  }
  /** How much larger than modelled he is drawn. */
  get scale(): number { return drawScale(this.form); }
  skeleton(): Skeleton {
    // (a skeleton built for the animal he was is no use for the animal he has just become)
    if (this.skel && this.skelForm !== this.form) this.skel = null;
    if (!this.skel) { this.skel = new Skeleton(this.form, this.pose(), this.phase === "window" || this.phase === "stalk" ? 1 : 0, this.breathPose().body); this.skelForm = this.form; }
    return this.skel;
  }
  private skelForm: Form = 1;
  anchor(locator: string): V3 { return toWorld(this.pos, this.yaw, this.skeleton().locator(locator), this.scale); }
  point(bone: string, at: number[]): V3 { return toWorld(this.pos, this.yaw, this.skeleton().point(bone, at), this.scale); }

  /** Model-unit offset (forward, up) of a sole from its rest place, at this point of the walk (as the client solves it). */
  private legOffset(leg: Leg): [number, number] {
    const p = (((this.walkPhase + LEG_PHASE[leg]) % 360) + 360) % 360 / 360;
    const four = this.form === 4, beta = four ? BETA_IV : BETA_III, stance = four ? STANCE_MODEL_IV : STANCE_MODEL_III, lift = four ? LIFT_IV : LIFT_III;
    if (p < beta) return [stance * (0.5 - p / beta), 0];
    const su = (p - beta) / (1 - beta);
    return [-stance / 2 + stance * su * su * (3 - 2 * su), lift * Math.sin(Math.PI * su) * (this.phase === "move" || this.phase === "stalk" || this.phase === "carry" ? 1 : 0)];
  }
  get forward(): V3 { return forwardOf(this.yaw); }
  /**
   * Where his breath leaves him, and the way his head points (from the throat through the muzzle).  It leaves by the
   * middle of the open mouth: half way between the line of his upper jaw (the mouth locator as it is with the jaw
   * shut) and the dropped lower jaw (the same locator as the jaw is drawn).
   */
  aim(): { from: V3; dir: V3 } {
    const dir = norm(sub(this.anchor("muzzle"), this.anchor("throat")));
    const loc = RIGS[this.form].locators.mouth;
    if (!loc || loc.bone !== "jaw") return { from: this.anchor("mouth"), dir };
    const sk = this.skeleton();
    const open = sk.point("jaw", loc.pos), shut = sk.restPoint("jaw", loc.pos);
    const mid = [(open[0] + shut[0]) / 2, (open[1] + shut[1]) / 2, (open[2] + shut[2]) / 2];
    return { from: toWorld(this.pos, this.yaw, mid, this.scale), dir };
  }
  /** How wide his mouth stands open, in blocks (the breath is drawn to fill it). */
  mouthGap(): number {
    const loc = RIGS[this.form].locators.mouth;
    if (!loc || loc.bone !== "jaw") return 0;
    const sk = this.skeleton();
    const a = sk.point("jaw", loc.pos), b = sk.restPoint("jaw", loc.pos);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * this.scale / 16;
  }

  /** Turn the head (not the feet) towards a point; returns how far off the limit it is. */
  lookAt(target: V3, maxYaw = 80, maxPitch = 40): number {
    const base = this.form === 1 ? this.anchor("throat")
      : this.form === 5 ? this.point("neck1", RIGS[5].bones.neck1.pivot)
      : this.point(this.form === 2 ? "neck" : "neck1", this.form === 2 ? [0, 84, -32] : this.form === 4 ? [0, 336, -22] : [0, 114, -126]);
    const want = wrapDeg(yawTo(base, target) - this.yaw);
    const flat = Math.max(0.5, distXZ(base, target));
    const pitch = Math.atan2(base.y - target.y, flat) * 180 / Math.PI;
    this.lookYaw = clamp(want, -maxYaw, maxYaw);
    this.lookPitch = clamp(pitch, -maxPitch, maxPitch);
    return Math.abs(want) - maxYaw;
  }
  lookAhead(): void { this.lookYaw = 0; this.lookPitch = 0; }
  /** The look was set by hand: the skeleton (and so the muzzle) is posed afresh. */
  relook(): void { this.skel = null; }

  /**
   * Turn the head toward a point, but no faster than `rate` degrees a tick on each axis (what is aimed at moves; a
   * head this size does not snap round).  The muzzle is pointed as aimAt points it; if the neck cannot reach, the
   * feet shuffle round.  Returns the error left, in degrees.
   */
  trackTo(target: V3, rate: number, maxYaw = 80, maxPitch = 80): number {
    const y0 = this.lookYaw, p0 = this.lookPitch;
    const reach = this.aimAt(target, maxYaw, maxPitch);
    const wantY = this.lookYaw, wantP = this.lookPitch;
    this.lookYaw = y0 + clamp(wantY - y0, -rate, rate);
    this.lookPitch = p0 + clamp(wantP - p0, -rate, rate);
    this.skel = null;
    if (reach > 0) this.yaw = turnTowards(this.yaw, yawTo(this.pos, target), Math.min(1.2, rate * 0.5));
    return Math.hypot(wantY - this.lookYaw, wantP - this.lookPitch);
  }

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
    // a route belongs to the place it leads to (a pause on the way there does not lose it)
    if (!this.routeGoal || distXZ(this.routeGoal, target) > 1.5) { this.route = []; this.planner = null; this.routeGoal = { ...target }; this.planAt = -999; }
    this.goal = target; this.goalSpeed = speed * this.haste; this.arriveDist = arrive;
  }
  halt(): void { this.goal = null; this.goalSpeed = 0; this.blocked = 0; this.steerOff = 0; this.steerSide = 0; this.goalWalled = false; }

  // ---- a way round -------------------------------------------------------------------------------
  private planner: Planner | null = null;
  private route: V3[] = [];
  private routeGoal: V3 | null = null;
  private planAt = -999;
  private planSeen = new Map<string, boolean>();
  /** He has been stopped and is working out another way: not the moment to give up on him. */
  get planning(): boolean { return this.planner !== null; }
  private cell(): number { return this.form === 1 ? 5 : Math.max(4, Math.round(MOVE[this.form].radius)); }

  /** Could his middle be at x,z, coming from height y?  The floor (or swimming height) there, or null. */
  private passable = (x: number, z: number, y: number, fx: number, fz: number): number | null | false => {
    const n = Math.max(1, Math.ceil(Math.hypot(x - fx, z - fz)));
    if (this.form === 1) {
      // water all the way there, deep enough to carry him
      for (let i = 1; i <= n; i += 2) {
        const col = waterColumn(this.dim, fx + ((x - fx) * i) / n, fz + ((z - fz) * i) / n, y + 2, 10, 28);
        if (col === UNLOADED || col === NONE || col.surface - col.floor < 3.5) return i >= n - 1 ? null : false;
      }
      return y;
    }
    const b = BODY[this.form as Walker];
    const g = groundY(this.dim, x, z, y + b.top, DROP + b.top);
    if (typeof g !== "number") return null;
    // room for the whole of him with a little to spare (a route that shaves the end of a wall is no route): every
    // column under his body is looked at once per search (neighbouring cells share most of them)
    const R = MOVE[this.form].radius + 1.5, hy = Math.floor(g + b.built[0]);
    const cx = Math.floor(x), cz = Math.floor(z), n0 = Math.ceil(R);
    for (let dx = -n0; dx <= n0; dx++) for (let dz = -n0; dz <= n0; dz++) {
      if (dx * dx + dz * dz > R * R) continue;
      const key = `${cx + dx},${hy},${cz + dz}`;
      let wall = this.planSeen.get(key);
      if (wall === undefined) {
        const q = blockAt(this.dim, { x: cx + dx, y: hy, z: cz + dz });
        wall = !!q && isSolidBlock(q) && !isPlantBlock(q.typeId) && !isNaturalGround(q.typeId);
        this.planSeen.set(key, wall);
      }
      if (wall) return null;
    }
    if (trunkBlocked(this.dim, { x, y: g, z }, g, MOVE[this.form].radius, [], b.cliff, true)) return null;      // a cliff face
    if (!this.wade && waterOver(this.dim, x, z, g, b.wade)) return null;
    if (g - y > b.climb + this.cell() * 0.5) return false;
    // nothing built standing across the line from there to here (a wall one block thick is still a wall)
    for (let i = 1; i < n; i++) {
      const px = fx + ((x - fx) * i) / n, pz = fz + ((z - fz) * i) / n;
      for (const h of b.built) {
        const q = blockAt(this.dim, { x: px, y: Math.max(y, g) + h, z: pz });
        if (q && isSolidBlock(q) && !isPlantBlock(q.typeId)) return false;
      }
    }
    return g;
  };

  /** Stopped for a while with somewhere to be: look for a route.  A few questions of the world a tick. */
  private plan(): void {
    if (this.planner) {
      this.blocked = Math.min(this.blocked, 20);                    // those who wait on him wait a little longer
      if (!this.planner.step(this.form >= 3 ? 5 : 8)) return;
      this.route = this.planner.path;
      this.planner = null;
      this.planAt = this.tick;
      this.blocked = this.route.length ? 0 : Math.max(this.blocked, 60);
      this.steerOff = 0; this.steerSide = 0; this.goalWalled = false;
      return;
    }
    if (!this.goal || this.blocked < 14 || this.route.length || this.tick - this.planAt < 80 || this.smashing()) return;
    // (Basiliskra I with his head through a gap and his shoulders caught is meant to jam there, not to find a way)
    if (this.form === 1 && this.blockedWhy === "wall") return;
    if (this.blockedWhy === "unloaded") return;
    this.planSeen.clear();
    this.planner = new Planner(this.passable, this.cell(), { ...this.pos }, this.goal, 84);
  }
  arrived(): boolean { return !this.goal || distXZ(this.pos, this.goal) <= this.arriveDist; }

  // ---- walls -----------------------------------------------------------------------------------
  private walled(at: V3, full: boolean): boolean {
    const b = BODY[this.form as Walker];
    // afloat, a bank is judged from the water line, not from the depth he hangs at: he can haul out over a low one
    const feet = this.afloat && this.surfY != null ? Math.max(this.pos.y, this.surfY - 1.2) : this.pos.y;
    // ploughing through (wither mode), nothing above the ground he walks on is in his way: it is in front of him
    if (this.smashing()) return false;
    return trunkBlocked(this.dim, at, feet, MOVE[this.form].radius, b.built, b.cliff, full);
  }

  /** Is there room for his middle here (used by the few moves that carry him without stepping)? */
  roomAt(at: V3): boolean {
    for (const dy of [1, 3]) {
      const b = blockAt(this.dim, { x: at.x, y: at.y + dy, z: at.z });
      if (b && isSolidBlock(b)) return false;
    }
    return true;
  }

  private smashing(): boolean { return this.smash && this.form >= 3 && wither(); }

  /**
   * He walks THROUGH what stands in his path.  In a slab ahead of his shoulders, as wide as he is and as high as
   * his back: everything built and everything grown goes, from the ground up; and the world's own rock goes
   * where it rises higher than he can step (a cliff is cut down to a step; a slope is simply walked up).  The
   * ground he walks on is never touched, so he does not sink.  A cheap probe first; the slab is only read when
   * the probe finds something standing in it.
   */
  private crushAhead(): void {
    if (this.tick - this.crushAt < 3) return;
    const b = BODY[this.form as Walker], r = MOVE[this.form].radius;
    const step = Math.floor(b.climb) - 1;
    if (this.form === 4) {
      // he is too big to clear block by block: the slab ahead of him goes in two engine calls (see havoc.ploughBox)
      if (this.tick - this.crushAt < 5 || this.speed < 0.01) return;
      this.crushAt = this.tick;
      const rock = this.afloat || this.inDeep() ? null : step;
      const broke = ploughBox(this.dim, this.pos, this.forward, b.front - 3, Math.ceil(r) + 3, 56, 7, rock);
      // (if the engine will not empty a box for us, the old way: block by block, within a budget, as high as it reaches)
      if (broke < 0) { crush(this.dim, this.pos, this.forward, b.front - 2, Math.ceil(r) + 1, 0, 26, 5, 220, rock, this.tick - this.crushSoundAt >= 14); return; }
      if (broke > 12 && this.tick - this.crushSoundAt >= 14) { this.crushSoundAt = this.tick; ploughNoise(this.dim, add(this.pos, mul(this.forward, b.front)), broke); }
      // and whatever stood higher than he does on what he walked through comes down with it
      if (broke > 0) ploughBox(this.dim, { x: this.pos.x, y: this.pos.y + 57, z: this.pos.z }, this.forward, b.front - 3, Math.ceil(r) + 3, 50, 7, null);
      return;
    }
    const top = Math.round(9.6 * this.scale);
    const f = this.forward, l = leftOf(this.yaw);
    let found = false;
    probe: for (const s of [b.front, b.front + 2]) for (const side of [-0.8, 0, 0.8]) for (const h of [1.2, step + 0.5, top * 0.55, top - 1]) {
      const q = blockAt(this.dim, { x: this.pos.x + f.x * s + l.x * side * r, y: this.pos.y + h, z: this.pos.z + f.z * s + l.z * side * r });
      if (!q || q.isAir || q.isLiquid) continue;
      // the ground itself rising gently in front of him is not something in his way
      if (h < step && isNaturalGround(q.typeId) && !isPlantBlock(q.typeId)) continue;
      found = true;
      break probe;
    }
    if (!found) return;
    this.crushAt = this.tick;
    const loud = this.tick - this.crushSoundAt >= 14;
    // (swimming or wading, where he "stands" is not the ground: the shore ahead is something to climb, not to cut)
    const broke = crush(this.dim, this.pos, this.forward, b.front - 2, Math.ceil(r) + 2, 0, top, 6, 260, this.afloat || this.inDeep() ? null : step, loud);
    if (broke) {
      this.speed *= 0.8; if (loud) this.crushSoundAt = this.tick;      // it costs him a little
      // what stood on what he has just walked through comes down with it: a tower cut at the knees does not hang in the air
      // (anything built or grown above the slab, as high as towers go; the world's own rock stays)
      ploughBox(this.dim, { x: this.pos.x, y: this.pos.y + top + 1, z: this.pos.z }, this.forward, b.front - 2, Math.ceil(r) + 2, 70, 6, null);
    }
  }
  private crushSoundAt = -99;

  /**
   * A footfall's shock rolling out ahead of him: a band wider than he is, sweeping forward two blocks a tick from his
   * shoulders, and everything built or grown in it goes (never the ground itself).  `reach`: how far it rolls;
   * `extra`: how much wider than his body; `top`: how high it reaches.  In the destructive setting only.
   */
  stompWave(reach: number, extra: number, top: number): void {
    if (!this.smashing() || this.afloat || this.inDeep()) return;
    const front = BODY[this.form as Walker].front;
    this.waves.push({ pos: { ...this.pos }, fwd: this.forward, d: front - 1, end: front + reach, half: Math.ceil(MOVE[this.form].radius) + extra, top });
    if (this.waves.length > 3) this.waves.shift();
  }
  private waves: { pos: V3; fwd: V3; d: number; end: number; half: number; top: number }[] = [];
  private waveTick(): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const n = ploughBox(this.dim, w.pos, w.fwd, w.d, w.half, w.top, 2, null);
      if (n > 8) {
        const at = add(w.pos, mul(w.fwd, w.d + 1));
        particle(this.dim, "basiliskra:impact_debris", { x: at.x, y: at.y + 2, z: at.z }, 96);
        particle(this.dim, "basiliskra:step_dust", { x: at.x, y: at.y + 0.5, z: at.z }, 96);
        if (n > 30 && this.tick - this.crushSoundAt >= 6) { this.crushSoundAt = this.tick; ploughNoise(this.dim, at, n); }
      }
      w.d += 2;
      if (n < 0 || w.d >= w.end) this.waves.splice(i, 1);
    }
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
    for (const s of BODY[this.form as Walker].look) {
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
      else if (!this.route.length && d < 16 && this.walled(this.goal!, false)) this.goalWalled = true;      // the goal itself is inside something
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
    const front = mul(this.forward, BODY[this.form as Walker].front);
    // the middle is judged a little ahead, as the steering judges it: a crawl past a corner is not refused for a ring point
    const ahead = add(this.pos, mul(this.forward, Math.max(0.6, this.speed)));
    if (moving && (this.walled(add(next, front), true) || this.walled(ahead, false)) && !this.walled(this.pos, false)) { this.blockedWhy = "wall"; return null; }
    // water: found from where he is, a few times a second.  Deeper than he stands in, he swims at his depth
    // rather than sink to the bed, and a bank he could not step up he can haul himself out over.
    const lim = BODY[this.form as Walker].wade;
    if (this.tick % 5 === 0 || this.surfY === undefined) {
      const wc = waterColumn(this.dim, next.x, next.z, this.pos.y + lim, 8, 2);
      this.surfY = wc === NONE || wc === UNLOADED ? null : wc.surface;
    }
    const floatY = this.surfY !== null && this.surfY !== undefined ? this.surfY - lim : null;
    const top = BODY[this.form as Walker].top;
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
    if (!swims && rise > (this.afloat ? lim + 1.6 : BODY[this.form as Walker].climb)) { this.blockedWhy = "climb"; return null; }
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
    this.plan();
    if (this.goal) {
      const d = distXZ(this.pos, this.goal);
      if (d > this.arriveDist) {
        // with a route, its next way-point is where he heads; without one, the place itself
        while (this.route.length && distXZ(this.pos, this.route[0]) < this.cell() * 0.8) this.route.shift();
        const via = this.route.length ? this.route[0] : this.goal;
        const want = this.steer(yawTo(this.pos, via), this.route.length ? distXZ(this.pos, via) : d);
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
        else if (this.blockedWhy === "edge" && this.pos.y > this.dim.heightRange.min + 8) {
          // put down in mid-air (called by someone flying, or the ground under him gone): he comes down to it
          this.pos = { x: this.pos.x, y: this.pos.y - 4.5, z: this.pos.z };
          this.unsettled = true;
        }
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
    const defs = partsFor(this.form);
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      let c = this.point(d.bone, d.at);
      if (d.leg) {
        // the server skeleton stands its legs at rest: carry the volume to where the client's walk has put that leg
        const [fwd, up] = this.legOffset(d.leg);
        const k = (d.swing ?? 1) * this.scale / 16;
        c = add(add(c, mul(this.forward, fwd * k)), { x: 0, y: up * k, z: 0 });
      }
      const si = d.si;
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
          part = this.dim.spawnEntity(hitboxId(si), at);
          partOwner.set(part.id, { creature: this, tag: d.tag });
          this.parts[i] = part;
          this.partIds[i] = part.id;
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
    if (this.partIds[i]) { partOwner.delete(this.partIds[i]!); this.partIds[i] = undefined; }
    if (!p) return;
    try { if (p.isValid) p.remove(); } catch { /* gone */ }
    this.parts[i] = undefined;
  }

  dropParts(): void {
    for (let i = 0; i < this.parts.length; i++) this.dropPart(i);
    this.parts.length = 0;
  }

  /**
   * Where a ray (a player's reach along their line of sight) first meets one of his hit volumes: the distance
   * along it and which part, or null.  The boxes are where they were last put (the same ones the game is hit on).
   */
  rayHit(from: V3, dir: V3, reach: number): { dist: number; tag: PartTag } | null {
    const defs = partsFor(this.form);
    let best: { dist: number; tag: PartTag } | null = null;
    for (let i = 0; i < defs.length; i++) {
      const at = this.partPos[i];
      if (!at) continue;
      const h = SIZES[defs[i].si] / 2;
      const lo = [at.x - h, at.y, at.z - h], hi = [at.x + h, at.y + 2 * h, at.z + h];
      const o = [from.x, from.y, from.z], d = [dir.x, dir.y, dir.z];
      let t0 = 0, t1 = reach, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) ok = false; continue; }
        let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) ok = false;
      }
      if (ok && (!best || t0 < best.dist)) best = { dist: t0, tag: defs[i].tag };
    }
    return best;
  }

  /** Centre and radius of each body volume, for contact checks. */
  volumes(): { at: V3; r: number; tag: PartTag }[] {
    const k = this.scale;
    const out = partsFor(this.form).map((d) => ({ at: this.point(d.bone, d.at), r: SIZES[d.si] / 2, tag: d.tag as PartTag }));
    const trunk = this.form === 1 ? { h: 4.4, r: 3.0 } : this.form === 2 ? { h: 7.2 * k, r: 3.3 * k } : this.form === 4 ? { h: 20 * k, r: 5 * k } : this.form === 5 ? { h: 12 * k, r: 5 * k } : { h: 9.6 * k, r: 4.3 * k };
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
            this.hurt(p, this.form >= 3 ? 4 : 2);
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
    if (this.waves.length) this.waveTick();
    return moved;
  }
  /** Curl held while not moving (sleeping at the seam). */
  bendHold = 0;

  /** A sound from him.  If it is his voice, his mouth moves with it (the client times the jaw to the recording). */
  say(id: string, at?: V3, range = 56, volume = 1, pitch = 1): void {
    sound(this.dim, id, at ?? this.pos, range, volume, pitch);
    const m = /^basiliskra\.(?:[a-z]+\.)?(grunt|growl|breath|huff|hurt|roar|roar_short|roar_under)$/.exec(id);
    if (m) this.pulse(VOICE_KIND[(m[1] === "huff" ? "breath" : m[1]) as keyof typeof VOICE_KIND]);
  }
  emit(id: string, at: V3, range = 56): void { particle(this.dim, id, at, range); }

  /** Damage a player from him (never on Peaceful when configured so; never Creative/Spectator). */
  hurt(p: Player, amount: number, cause: EntityDamageCause = EntityDamageCause.entityAttack): boolean {
    if (!targetable(p)) return false;
    if (CONFIG.harmlessOnPeaceful && String(world.getDifficulty()).toLowerCase() === "peaceful") return false;
    const dealt = this.lethal > 0 ? this.lethal : amount * this.might;
    try { return p.applyDamage(dealt * CONFIG.damage, { cause, damagingEntity: this.entity }); } catch { return false; }
  }
  /** What a blow of `base` does to a creature that is not a giant. */
  mobHit(base: number): number { return this.lethal > 0 ? this.lethal : base * this.might; }

  /** How far his trunk reaches from his middle, on the ground. */
  get girth(): number { return MOVE[this.form].radius; }

  /** Told of every blow another giant lands on this body (`heavy`: its jaws, its tail, its weight; not its breath). */
  onBlow: ((by: Creature, amount: number, heavy: boolean) => void) | null = null;
  /** A blow from another giant (its breath, its jaws, its tail). */
  takeBlow(by: Creature, amount: number, heavy = false): boolean {
    if (amount <= 0 || !this.valid) return false;
    try { this.onBlow?.(by, amount, heavy); } catch { /* its brain is its own affair */ }
    try { return this.entity.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: by.entity }); } catch { return false; }
  }

  /** The middle of his trunk: what another giant aims at. */
  middle(): V3 {
    const h = this.form === 1 ? 2.2 : this.form === 2 ? 3.6 * this.scale : this.form === 4 ? 12 * this.scale : this.form === 5 ? 8.5 * this.scale : 4.8 * this.scale;
    return { x: this.pos.x, y: this.pos.y + h, z: this.pos.z };
  }

  /** Thrown back by a blow from something his own size: he gives ground if there is ground to give. */
  shove(away: V3, blocks: number): void {
    if (this.form === 1) return;
    const d = norm({ x: away.x, y: 0, z: away.z });
    for (let k = blocks; k > 0.4; k -= 1) {
      const to = { x: this.pos.x + d.x * k, y: this.pos.y, z: this.pos.z + d.z * k };
      if (!isLoaded(this.dim, to)) continue;
      const settled = this.stepLand(to, false);
      if (settled && Math.abs(settled.y - this.pos.y) < 6) { this.pos = settled; return; }
    }
  }
}

/** Every giant there is to hit: Basiliskra himself and the Titans, by entity id (one body per entity). */
export const giants = new Map<string, Creature>();
/** The giant an entity is, if it is one (and still here). */
export function giantOf(e: Entity | undefined): Creature | null {
  try { if (!e) return null; const g = giants.get(e.id); return g && g.valid ? g : null; } catch { return null; }
}
/**
 * Giants are solid to each other: two whose trunks overlap are eased apart (each half the overlap, onto ground it
 * can stand on).  Once a tick, from the controller.
 */
export function separateGiants(): void {
  const all = [...giants.values()].filter((g) => g.valid && g.form >= 2);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.dim.id !== b.dim.id) continue;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
    const min = (a.girth + b.girth) * 0.75;
    if (d >= min) continue;
    const away = d > 0.01 ? { x: dx / d, y: 0, z: dz / d } : { x: 1, y: 0, z: 0 };
    const push = (min - d) / 2 + 0.1;
    b.shove(away, push);
    a.shove({ x: -away.x, y: 0, z: -away.z }, push);
  }
}

/** The giants in his world other than himself. */
export function otherGiants(c: Creature): Creature[] {
  const out: Creature[] = [];
  for (const [id, g] of giants) {
    if (!g.valid) { giants.delete(id); continue; }
    if (g !== c && g.dim.id === c.dim.id) out.push(g);
  }
  return out;
}

/** Hit volume entity id -> the creature it belongs to. */
export const partOwner = new Map<string, { creature: Creature; tag: PartTag }>();

export function targetable(p: Player): boolean {
  try {
    if (!p.isValid) return false;
    const gm = p.getGameMode();
    return gm !== GameMode.Creative && gm !== GameMode.Spectator;
  } catch { return false; }
}

export function inWater(dim: Dimension, at: V3): boolean { return isWaterId(blockAt(dim, at)?.typeId); }
export function standingBlockSolid(dim: Dimension, at: V3): boolean { return isSolidBlock(blockAt(dim, { x: at.x, y: at.y - 1, z: at.z })); }
