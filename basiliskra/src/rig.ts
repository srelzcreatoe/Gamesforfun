/**
 * One rig everywhere.  The model kit writes the same skeleton it built the geometry from into
 * generated/rig.ts; the server poses it with the same weights the client animation uses, so
 * the mouth, gills, feet, club and hit volumes are measured on the skeleton the player sees.
 *
 * Model ("file") space: 1/16 block, +Y up, -Z is the animal's front, +X its left.
 *   v' = Rz(-rz) Ry(ry) Rx(-rx) (v - pivot) + pivot
 */
import { BODY_DROP_III, RIGS, LOOK, SCALE, TAIL_LIFT_III, WINDOW_CROUCH_III, WINDOW_HEAD, WINDOW_NECK, WING_FOLD } from "./generated/rig";
import { D2R, forwardOf, leftOf, type V3 } from "./vec";

export type Form = 1 | 2 | 3 | 4;
export type PoseAdd = Record<string, [number, number, number]>;
type Mat = number[];   // 3x4, row-major

function rotation(rx: number, ry: number, rz: number): number[] {
  const ax = -rx * D2R, ay = ry * D2R, az = -rz * D2R;
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

function about(R: number[], p: number[]): Mat {
  return [
    R[0], R[1], R[2], p[0] - (R[0] * p[0] + R[1] * p[1] + R[2] * p[2]),
    R[3], R[4], R[5], p[1] - (R[3] * p[0] + R[4] * p[1] + R[5] * p[2]),
    R[6], R[7], R[8], p[2] - (R[6] * p[0] + R[7] * p[1] + R[8] * p[2]),
  ];
}

function mulM(a: Mat, b: Mat): Mat {
  const o = new Array<number>(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}

function apply(m: Mat, p: number[]): number[] {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

/** `wings`: how far Basiliskra IV's wings are open (0 folded .. 1 spread); `plant`: his club driven into the ground; `pivot`: turning on it. */
export interface PoseState { lookYaw: number; lookPitch: number; bend: number; pitch: number; charge?: number; drink?: number; window?: number;
                             wings?: number; plant?: number; pivot?: number;
                             /** What the client adds while he breathes fire (degrees, model units): the jaw dropped, the body
                              *  ridden lower, leaning back on its heels and carried back (the skid), the chest pitched. */
                             jaw?: number; drop?: number; lean?: number; back?: number; chest?: number }

/** The steady-state pose the client settles into for these synchronised values. */
export function poseOf(form: Form, s: PoseState): PoseAdd {
  const p: PoseAdd = {};
  const L = LOOK[form];
  const yawW = L.yaw as Record<string, number>, pitchW = L.pitch as Record<string, number>;
  const set = (b: string, x: number, y: number, z = 0) => {
    const c = p[b] ?? (p[b] = [0, 0, 0]);
    c[0] += x; c[1] += y; c[2] += z;
  };
  for (const [b, w] of Object.entries(yawW)) set(b, 0, s.lookYaw * w);
  for (const [b, w] of Object.entries(pitchW)) set(b, s.lookPitch * w, 0);
  set("body", s.pitch + (s.lean ?? 0), 0);
  if (s.jaw) set("jaw", s.jaw, 0);
  if (s.chest) set("chest", s.chest, 0);
  const charge = s.charge ?? 0, drink = s.drink ?? 0;
  if (form === 1) {
    set("head", 0, s.bend * 0.6);
    for (let i = 1; i <= 10; i++) set(`seg${i}`, 0, -s.bend);
    set("tailfin", 0, -s.bend);
  } else if (form === 2) {
    set("neck", 22 * drink, 0);
    set("head", 16 * drink, 0);
    set("chest", 6 * drink, 0);
    set("mid", 0, -s.bend * 0.5);
    set("hips", 0, -s.bend * 0.8);
    for (let i = 1; i <= 6; i++) set(`tail${i}`, 0, -s.bend * (0.5 + 0.1 * i));
  } else if (form === 4) {
    for (const n of ["neck1", "neck2"]) set(n, -2 * charge, 0);
    set("head", -4 * charge, 0);
    const plant = s.plant ?? 0, pivot = s.pivot ?? 0;
    for (let i = 1; i <= 10; i++) set(`tail${i}`, i >= 5 ? -2.6 * plant : 0, -s.bend * (0.12 + 0.03 * i) * (1 - 0.7 * pivot));
    // his wings are folded unless something has opened them
    const fold = 1 - (s.wings ?? 0);
    for (const [side, sg] of [["l", 1], ["r", -1]] as const) {
      set(`wing_${side}`, WING_FOLD.root[0] * fold, sg * WING_FOLD.root[1] * fold, sg * WING_FOLD.root[2] * fold);
      set(`wing_${side}_arm`, 0, sg * WING_FOLD.arm[0] * fold, sg * WING_FOLD.arm[1] * fold);
      WING_FOLD.fingers.forEach((a, i) => set(`wing_${side}_f${i + 1}`, 0, 0, sg * a * fold));
    }
  } else {
    set("hips", 0, -s.bend * 0.3);
    const win = s.window ?? 0;
    for (let i = 1; i <= 5; i++) set(`neck${i}`, -1.5 * charge + WINDOW_NECK[i - 1] * win, 0);
    set("head", -4 * charge + WINDOW_HEAD[0] * win, WINDOW_HEAD[1] * win, WINDOW_HEAD[2] * win);
    for (let i = 1; i <= 8; i++) set(`tail${i}`, -1.7 * charge + (i === 1 ? TAIL_LIFT_III : 0), -s.bend * (0.35 + 0.09 * i));
  }
  return p;
}

export class Skeleton {
  private cache = new Map<string, Mat>();
  /** `window`: 0..1, how far into the window crouch (Form III).  `body`: [x, y, z] the body is carried (model units). */
  constructor(readonly form: Form, private pose: PoseAdd, private window = 0, private body: number[] = [0, 0, 0]) {}

  private bone(name: string): Mat {
    const hit = this.cache.get(name);
    if (hit) return hit;
    const b = RIGS[this.form].bones[name];
    if (!b) throw new Error(`rig ${this.form}: no bone ${name}`);
    const add = this.pose[name];
    const R = rotation(b.rot[0] + (add ? add[0] : 0), b.rot[1] + (add ? add[1] : 0), b.rot[2] + (add ? add[2] : 0));
    const local = about(R, b.pivot);
    // he rides this far below the bind pose (see gen_client.py), and lower still at a window
    if (this.form === 3 && name === "body") local[7] -= BODY_DROP_III + WINDOW_CROUCH_III * this.window;
    if (name === "body") { local[3] += this.body[0]; local[7] += this.body[1]; local[11] += this.body[2]; }
    const m = b.parent ? mulM(this.bone(b.parent), local) : local;
    this.cache.set(name, m);
    return m;
  }

  /** Model-space position of a locator. */
  locator(name: string): number[] {
    const l = RIGS[this.form].locators[name];
    if (!l) throw new Error(`rig ${this.form}: no locator ${name}`);
    return apply(this.bone(l.bone), l.pos);
  }

  /** Model-space position of a point given in a bone's rest coordinates. */
  point(bone: string, p: number[]): number[] { return apply(this.bone(bone), p); }
  /** The same point, but with this bone at its rest angle (its parent posed): where a locator on the jaw is with the mouth shut. */
  restPoint(bone: string, p: number[]): number[] {
    const b = RIGS[this.form].bones[bone];
    const local = about(rotation(b.rot[0], b.rot[1], b.rot[2]), b.pivot);
    return apply(b.parent ? mulM(this.bone(b.parent), local) : local, p);
  }
  pivot(bone: string): number[] { return apply(this.bone(bone), RIGS[this.form].bones[bone].pivot); }
}

/** How much larger than modelled each form is drawn (the client entity's scale). */
export const drawScale = (form: Form): number => SCALE[form];

/** Model space -> world, for an entity standing at `at` with Minecraft yaw `yaw`, drawn `scale` times its model size. */
export function toWorld(at: V3, yaw: number, m: number[], scale = 1): V3 {
  const l = leftOf(yaw), f = forwardOf(yaw);
  const k = scale / 16;
  const x = m[0] * k, y = m[1] * k, z = -m[2] * k;
  return { x: at.x + l.x * x + f.x * z, y: at.y + y, z: at.z + l.z * x + f.z * z };
}

export function rigMeta(form: Form) { return RIGS[form].meta; }
