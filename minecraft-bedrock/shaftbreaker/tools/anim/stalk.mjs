#!/usr/bin/env node
// stalk.mjs: generator for the Shaftbreaker STALKING animations (Minecraft Bedrock add-on).
//   writes Shaftbreaker_RP/animations/shaftbreaker.stalking.animation.json
//     animation.shaftbreaker.stalk_idle   time-driven loop (6.4 s): the stalking crouch held, slow uneven breathing,
//                                         weight sway, head stabilised in space (locked on the player), arms hanging
//                                         like pendulums behind the torso, a slow creeping finger-flex wave, one
//                                         sharp "on edge" head twitch.
//     animation.shaftbreaker.stalk_walk   distance-driven loop (anim time = blocks moved, WALK_LEN blocks per two
//                                         steps): slow creeping walk, high careful knee lifts, long reach, toe-first
//                                         placement and heel peel, planted feet locked to the ground through the
//                                         shared two-bone leg IK (tools/lib/legik.mjs), lagging arms / fingers / mane,
//                                         head level and locked forward.
// Run from minecraft-bedrock/shaftbreaker:  node tools/anim/stalk.mjs
// Never hand-edit the JSON: change this file (or lib_stalk.mjs) and regenerate. Deterministic output.
//
// Rotation conventions: SPEC.md §2 (hip flexion -X, knee +X, shoulder flexion -X, elbow -X, finger curl -X,
// torso hunch +X, +Y turns the front toward the creature's RIGHT (-X), right limb +Z = abduction).
// Every key is baked from smooth periodic functions and written as LINEAR keys (no catmullrom anywhere), dense
// enough to be smooth and simplified within a small tolerance; t = 0 and t = length come from the same periodic
// functions, so the loops are exactly seamless.
import fs from 'node:fs';
import path from 'node:path';
import {
  ADDON_ROOT, UPB, Pose, bake, boneFrame, setLeg, localFor, setArm, handRot, ankleFromContact, boneRotation, mulv3,
  add3, sub3, scale3, cyc, hspline, bump, twitch, psin, pcos, wrap01, smooth, stringifyCompact,
} from './lib_stalk.mjs';

const OUT = path.join(ADDON_ROOT, 'Shaftbreaker_RP/animations/shaftbreaker.stalking.animation.json');
const FINGERS = ['1', '2', '3', '4'];
const SIDES = ['right', 'left'];

// ============================================================================================ base stalking pose
// STALKING panel (tools/reference/stalk_full.png): torso hunched forward (pelvis 18 + waist 14 + chest 16 = 48 deg
// at the ribcage; the hip -> shoulder line leans ~35 deg), hips lowered with bent knees, head thrust forward out of
// the mane and level, shoulders up, the near (right) arm hanging out wide and slightly forward (elbow ~35 deg), the far
// (left) arm reaching forward with the wrist flexed so the hand hangs, palms at about knee height and the curled
// claws hanging to mid-shin, clear of the legs, wide staggered stance (left foot forward, right foot back).
// Arms use a two-bone IK (lib_stalk.setArm, soft reach limit so the elbow keeps a bend) on wrist targets; hands twist
// the palms toward the body (handRot) so the finger curl reads in profile from the front, and the fingers are fanned
// in the palm plane and bent at both knuckles: the cage-like hands of tools/reference/dormant_hands.png.
// (Critic pass: wrists raised ~1-3 units, moved out / forward and the fingers curled + fanned; before, the near claws
// dangled straight down to the ankles beside the shin and scraped the ground in the walk.)
const BASE = {
  body: { pos: [0, -4, 3], rot: [18, 0, 0] },
  waist: [14, 0, 0],
  chest: [16, 0, 0],
  neck: { rot: [-34, 0, 0], pos: [0, 2.5, -8.5] }, // thrust the head forward out of the ruff (neck takes
  // part of the counter-pitch so the head keeps range for look_at)
  mane: { front: [0, 0, 0], back: [-9, 0, 0], right: [0, 0, 6], left: [0, 0, -6] }, // shoulders' spikes raised
  headWorld: [-2, 0, 0], // eyes level on the player (look_at adds the aim on top)
  jaw: 1.5,
  shrug: [0, 1.8, 0],
  wrist: { right: [-27, 30.5, -11.5], left: [19.5, 32.5, -24.5] },
  pole: { right: [-0.4, 0.2, 1], left: [0.25, 0.2, 1] },
  hand: { right: { flex: 30, twist: -54, side: 0 }, left: { flex: 44, twist: 50, side: 0 } },
  curlA: { 1: -20, 2: -15, 3: -17, 4: -22 },
  curlB: { 1: -24, 2: -18, 3: -20, 4: -26 },
  fan: { 1: -12, 2: -4, 3: 4, 4: 13 }, // fingers fanned in the palm plane (+ = toward the little-finger side, outward)
  thumb: { right: [-26, -34], left: [-28, -36] },
};
const LEFT_CURL_EXTRA = { a: -3, b: -2 }; // asymmetry: the left claw is a little tighter

const Z3 = () => [0, 0, 0];
// default dynamic offsets for one frame
function dyn() {
  return {
    bodyPos: Z3(), bodyRot: Z3(), waist: Z3(), chest: Z3(), neck: Z3(), neckPos: Z3(),
    mane: { front: Z3(), back: Z3(), right: Z3(), left: Z3() },
    headWorld: Z3(), jaw: 0, shrug: { right: 0, left: 0 },
    wrist: { right: Z3(), left: Z3() }, // extra wrist offset (entity space)
    armSwing: { right: [0, 0], left: [0, 0] }, // pendulum swing of the hanging arm about the shoulder [pitch, roll]
    lag: null, // dyn() of an earlier moment: the hanging arms follow the shoulders of that moment (follow-through)
    hand: { right: { flex: 0, twist: 0, side: 0 }, left: { flex: 0, twist: 0, side: 0 } },
    curl: { right: { a: [0, 0, 0, 0], b: [0, 0, 0, 0] }, left: { a: [0, 0, 0, 0], b: [0, 0, 0, 0] } },
    thumb: { right: 0, left: 0 },
    ankle: { right: null, left: null }, footRot: { right: Z3(), left: Z3() },
  };
}

function torsoPose(D) {
  const p = new Pose();
  p.pos('body', add3(BASE.body.pos, D.bodyPos)).rot('body', add3(BASE.body.rot, D.bodyRot));
  p.rot('waist', add3(BASE.waist, D.waist)).rot('chest', add3(BASE.chest, D.chest));
  p.rot('neck', add3(BASE.neck.rot, D.neck)).pos('neck', add3(BASE.neck.pos, D.neckPos));
  for (const m of ['front', 'back', 'right', 'left']) p.rot(`mane_${m}`, add3(BASE.mane[m], D.mane[m]));
  p.setRot('head', localFor(p, ['body', 'waist', 'chest', 'neck'], add3(BASE.headWorld, D.headWorld)));
  p.rot('jaw', [Math.max(0, BASE.jaw + D.jaw), 0, 0]);
  for (const s of SIDES) p.pos(`arm_${s}_upper`, add3(BASE.shrug, [0, D.shrug[s], 0]));
  return p;
}
const shoulderOf = (p, s) => boneFrame(p, `arm_${s}_upper`).p;
// shoulders of the plain base pose: the BASE.wrist targets are defined relative to these
const SHOULDER0 = (() => { const p = torsoPose(dyn()); return { right: shoulderOf(p, 'right'), left: shoulderOf(p, 'left') }; })();

function buildPose(D) {
  const p = torsoPose(D);
  const pl = D.lag ? torsoPose(D.lag) : p;
  for (const s of SIDES) {
    // hanging arm: wrist hangs from the (lagged) shoulder, swung about it like a pendulum
    const sh = shoulderOf(pl, s);
    const rel = mulv3(boneRotation([D.armSwing[s][0], 0, D.armSwing[s][1]]), sub3(BASE.wrist[s], SHOULDER0[s]));
    setArm(p, s, add3(add3(sh, rel), D.wrist[s]), BASE.pole[s]);
    const h = BASE.hand[s], dh = D.hand[s];
    p.setRot(`hand_${s}`, handRot(h.flex + dh.flex, h.twist + dh.twist, h.side + dh.side));
    FINGERS.forEach((f, i) => {
      const ea = s === 'left' ? LEFT_CURL_EXTRA.a : 0, eb = s === 'left' ? LEFT_CURL_EXTRA.b : 0;
      const fan = (s === 'right' ? 1 : -1) * BASE.fan[f]; // right limb +Z = outward, left limb -Z = outward
      p.rot(`finger_${s}_${f}_a`, [Math.min(10, BASE.curlA[f] + ea + D.curl[s].a[i]), 0, fan]);
      p.rot(`finger_${s}_${f}_b`, [Math.min(8, BASE.curlB[f] + eb + D.curl[s].b[i]), 0, 0]);
    });
    p.rot(`thumb_${s}_a`, [BASE.thumb[s][0] + D.thumb[s], 0, 0]);
    p.rot(`thumb_${s}_b`, [BASE.thumb[s][1] + D.thumb[s] * 1.3, 0, 0]);
  }
  for (const s of SIDES) setLeg(p, s, D.ankle[s], D.footRot[s]);
  return p;
}

// ============================================================================================ stalk_idle
const IDLE_LEN = 6.4; // s
const IDLE_FEET = { right: [-11.5, 6, 14.5], left: [9.5, 6, -7] }; // ankle pivots (feet flat, toes turned out 8 deg)
const IDLE_FOOT_YAW = { right: 8, left: -8 };

// two uneven breaths per loop (0 = exhaled, 1 = full); flat keys = eased holds
const BREATH = [[0, 0, 1], [0.16, 1, 1], [0.46, 0.02, 1], [0.52, 0, 1], [0.665, 0.78, 1], [0.94, 0, 1]];
// jaw parts on each exhale (a hiss through the teeth)
const JAW_IDLE = [[0, 0, 1], [0.15, 0, 1], [0.27, 1, 1], [0.45, 0, 1], [0.66, 0, 1], [0.76, 0.55, 1], [0.92, 0, 1]];

const IDLE_ARM_LAG = 0.42; // s: the hanging arms trail the torso
function idleDyn(t, withLag = true) {
  const ph = t / IDLE_LEN;
  const D = dyn();
  if (withLag) D.lag = idleDyn(t - IDLE_ARM_LAG, false);
  const br = cyc(BREATH, ph);
  const brLag = cyc(BREATH, ph - 0.035); // mane / shoulders follow the ribcage
  // weight sway: onto the back (right) foot, then forward onto the left; slightly irregular
  const sw = psin(ph, 0) + 0.18 * psin(3 * ph, 0.1);
  const swLag = psin(ph, 0.035) + 0.18 * psin(3 * ph, 0.135);
  D.bodyPos = [-0.95 * sw, 0.3 * br - 0.22 * Math.abs(sw), 0.5 * pcos(ph, 0.6)];
  D.bodyRot = [0.5 * pcos(ph, 0.6), 1.1 * psin(ph, 0.2), 1.3 * swLag];
  D.waist = [-0.6 * br, -0.5 * psin(ph, 0.2), -0.8 * swLag];
  D.chest = [-2.2 * br + 0.6, 0.4 * psin(ph, 0.25), -0.7 * psin(ph, 0.07)];
  D.neck = [0.3 * br, 0, 0];
  // mane bristles on the inhale
  D.mane.back = [-2.6 * brLag, 0, 0.6 * psin(ph, 0.1)];
  D.mane.front = [-1.4 * brLag, 0, 0];
  D.mane.right = [0, 0, 3.0 * brLag];
  D.mane.left = [0, 0, -3.0 * brLag];
  D.shrug = { right: 0.45 * brLag, left: 0.5 * brLag };
  // head: stabilised in space (only slow micro-drift), one sudden tilt-twitch then a slow return
  const tw = twitch(ph, 0.585, 0.022, 0.11);
  D.headWorld = [0.8 * psin(ph, 0.4) - 2.0 * tw, 1.4 * psin(ph, 0.3) + 4.0 * tw, 7.0 * tw];
  D.mane.left = add3(D.mane.left, [0, 0, 4.5 * twitch(ph, 0.59, 0.03, 0.12)]); // the ruff gives way to the twitch
  D.jaw = 2.6 * cyc(JAW_IDLE, ph);
  // arms: pendulums hanging from the swaying shoulders (they follow the shoulders ~0.4 s late) + a slow free swing
  D.armSwing.right = [-1.2 * psin(ph, 0.35) + 0.5 * psin(2 * ph, 0.1), 0.9 * psin(ph, 0.12)];
  D.armSwing.left = [-1.0 * psin(ph, 0.62) - 0.4 * psin(2 * ph, 0.3), -0.8 * psin(ph, 0.18)];
  D.hand.right = { flex: 3 * psin(ph, 0.27), twist: 2.5 * psin(ph, 0.12), side: 1.5 * psin(ph, 0.4) };
  D.hand.left = { flex: 2.5 * psin(ph, 0.71), twist: -2 * psin(ph, 0.55), side: -1.2 * psin(ph, 0.9) };
  // fingers: breathing micro-curl + a slow creeping flex wave rolling 4 -> 1 (right at 30 %, left at 80 %)
  for (const s of SIDES) {
    const c0 = s === 'right' ? 0.29 : 0.79, amp = s === 'right' ? 1 : 0.75;
    FINGERS.forEach((f, i) => {
      const d = (3 - i) * 0.03; // finger 4 first, then 3, 2, 1
      const w = bump(ph, c0 + d, 0.1), wb = bump(ph, c0 + d + 0.012, 0.1);
      D.curl[s].a[i] = -2 * cyc(BREATH, ph - 0.05) - 20 * amp * w;
      D.curl[s].b[i] = -2.5 * cyc(BREATH, ph - 0.06) - 24 * amp * wb;
    });
    D.thumb[s] = -10 * amp * bump(ph, c0 + 0.12, 0.1);
  }
  for (const s of SIDES) { D.ankle[s] = IDLE_FEET[s]; D.footRot[s] = [0, IDLE_FOOT_YAW[s], 0]; }
  return D;
}
const idlePose = (t) => buildPose(idleDyn(t));

// ============================================================================================ stalk_walk
// Distance-driven: anim time = blocks moved. One cycle (right step + left step) = WALK_LEN blocks.
// In entity space the planted foot moves backward (+Z) at UPB = 16/0.58 units per block.
const WALK_LEN = 2.2; // blocks per cycle (long creeping stride; ~1.5 s per cycle at the stalking speed ~1.45 b/s)
const V = WALK_LEN * UPB; // units of foot travel per cycle (60.7)
const DUTY = 0.62; // stance fraction (each foot on the ground 62 %, double support 24 %)
const STANCE = DUTY * V; // 37.6 units of planted travel
const TOE = [0, -6, -7.5]; // toe tip relative to the ankle pivot (flat foot frame): the rocker / contact point
const TD_PITCH = 7; // toes-first placement: foot pitched toes-down at touch-down, heel settles over SETTLE
const LO_PITCH = 30; // heel peel at lift-off (rolled onto the toe tips)
const SETTLE = 0.07; // stance fraction for the heel to settle
const PEEL = 0.16; // stance fraction of the heel peel at the end of stance
const WALK_BODY = { pos: [0, -1.0, -1.5], rot: [3, 0, 0] }; // extra crouch / lean while creeping (on top of BASE)
// arms carried a little wider than in the idle and the palms turned less toward the body (claws hook forward rather
// than medially) so the claws clear the high-stepping knees; they swing as pendulums about the lagged shoulders, the
// back extreme at the same-side footfall (contralateral), so the hand is back while its knee comes up and reaches
const WALK_ARM = { wrist: { right: [-0.5, 0, -1.5], left: [3.5, 0, 0] }, twist: { right: 20, left: -26 }, swing: 12, lag: 0.06 };
const HIP_Z = BASE.body.pos[2] + WALK_BODY.pos[2]; // hip pivot z in the walk
const STANCE_CENTER = HIP_Z - 0.5; // planted span centred slightly ahead of the hips (body leans forward)
const TRACK = { right: -8.5, left: 8.5 }; // foot track (ankle x)
const FOOT_YAW = { right: 6, left: -6 };
const PHASE = { right: 0, left: 0.5 }; // touch-down phase of each foot

// foot pitch during stance (u = stance fraction 0..DUTY)
function stancePitch(u) {
  if (u < SETTLE) return TD_PITCH * (1 - smooth(u / SETTLE));
  if (u > DUTY - PEEL) { const x = (u - (DUTY - PEEL)) / PEEL; return LO_PITCH * smooth(x); } // heel peel, eased
  return 0;
}
// toe-tip ground contact z during stance: touches down at zT0 and rides backward with the ground
const zT0 = STANCE_CENTER - STANCE / 2 + TOE[2]; // toe position at touch-down (ankle is 7.5 behind the toe)
function stanceAnkle(side, u) {
  const contact = [TRACK[side], 0, zT0 + u * V];
  return ankleFromContact(contact, TOE, [stancePitch(u), FOOT_YAW[side], 0]);
}
// numerical derivative of the stance ankle path at the ends (per unit of cycle phase)
function dStance(side, u) {
  const h = 1e-4;
  return scale3(sub3(stanceAnkle(side, u + h), stanceAnkle(side, u - h)), 1 / (2 * h));
}
function dPitch(u) { const h = 1e-4; return (stancePitch(u + h) - stancePitch(u - h)) / (2 * h); }

// swing (s = 0..1 across the swing): high careful knee lift, reach past the target, settle toes-first
const SWING = 1 - DUTY;
function swingFoot(side, s) {
  const A = stanceAnkle(side, DUTY), B = stanceAnkle(side, 0);
  const vA = scale3(dStance(side, DUTY - 1e-4), SWING), vB = scale3(dStance(side, 1e-4), SWING);
  const reach = 3.0; // reach this far past the touch-down point, then draw the foot back while lowering it
  const x = hspline([
    { u: 0, v: A[0], m: vA[0] },
    { u: 0.45, v: TRACK[side] + (side === 'right' ? -0.6 : 0.6) }, // swing slightly wide around the standing leg
    { u: 1, v: B[0], m: vB[0] },
  ], s);
  // ankle path: draw the foot forward under the hip while lifting, pull the knee high in front (shin hanging,
  // toes down), reach out past the spot, hover, then settle toes-first while moving back with the ground
  const z = hspline([
    { u: 0, v: A[2], m: vA[2] },
    { u: 0.07, v: A[2] + 0.4 * vA[2] * 0.07 }, // toe tip leaves the ground almost straight up
    { u: 0.22, v: HIP_Z + 7 },
    { u: 0.45, v: HIP_Z - 5 },
    { u: 0.66, v: B[2] - reach * 0.85 },
    { u: 0.84, v: B[2] - reach },
    { u: 1, v: B[2], m: vB[2] },
  ], s);
  const y = hspline([
    { u: 0, v: A[1], m: vA[1] },
    { u: 0.07, v: A[1] + 2.6 },
    { u: 0.22, v: 14.5 },
    { u: 0.45, v: side === 'right' ? 20.8 : 19.6 }, // knee pulled high (the right leg a little higher)
    { u: 0.66, v: side === 'right' ? 15.5 : 15.0 },
    { u: 0.84, v: B[1] + 3.0 }, // hover just above the spot
    { u: 1, v: B[1], m: vB[1] },
  ], s);
  const pitch = hspline([
    { u: 0, v: LO_PITCH, m: dPitch(DUTY - 1e-4) * SWING },
    { u: 0.07, v: LO_PITCH + 1.5 },
    { u: 0.22, v: 40 }, // toes hang while the foot is drawn through
    { u: 0.45, v: 30 },
    { u: 0.66, v: 13 },
    { u: 0.84, v: TD_PITCH + 2 },
    { u: 1, v: TD_PITCH, m: dPitch(1e-4) * SWING },
  ], s);
  return { ankle: [x, y, z], rot: [pitch, FOOT_YAW[side], 0] };
}

function footAt(side, ph) {
  const u = wrap01(ph - PHASE[side]);
  if (u < DUTY) { const a = stanceAnkle(side, u); return { ankle: a, rot: [stancePitch(u), FOOT_YAW[side], 0] }; }
  return swingFoot(side, (u - DUTY) / SWING);
}

function walkDyn(t, withLag = true) {
  const ph = t / WALK_LEN;
  const D = dyn();
  if (withLag) D.lag = walkDyn(t - WALK_ARM.lag * WALK_LEN, false);
  // stance-side signal: +1 = weight on the right foot (right stance centre at DUTY/2), -1 = on the left
  const mid = DUTY / 2;
  const onR = pcos(ph, mid + 0.04), onRlag = pcos(ph, mid + 0.09);
  // bob: sink into each placement, rise as the swing leg passes (two per cycle)
  const bob = -pcos(2 * ph, 2 * 0.1);
  D.bodyPos = add3(WALK_BODY.pos, [-1.2 * onR, 0.9 * bob, 0]);
  // pelvis: yaw brings the stepping hip forward, roll drops the swing-side hip, slight pitch lurch per step
  const lurch = bump(2 * ph % 1, 0.12, 0.3);
  D.bodyRot = add3(WALK_BODY.rot, [0.8 * lurch, -4.5 * pcos(ph, 0.02), 1.8 * onR]);
  // spine: counter-roll and counter-yaw (shoulders turn against the hips), lurch forward after each placement
  D.waist = [0.6 * bump(2 * ph % 1, 0.16, 0.3), 2.6 * pcos(ph, 0.05), -2.4 * onRlag];
  D.chest = [0.9 * bump(2 * ph % 1, 0.2, 0.3) - 0.5, 3.4 * pcos(ph, 0.08), -0.9 * onRlag];
  // head: level and locked forward; neck takes a little of the bob so the skull glides
  D.neck = [-0.6 * bob, 0, 0];
  D.headWorld = [0.4 * pcos(2 * ph, 0.3), 0, 0];
  D.jaw = 0.6 * psin(2 * ph, 0.35) + 0.4;
  // mane: bounces after each footfall (lags the chest), sways with the roll
  D.mane.back = [1.8 * pcos(2 * ph, 0.2 + 0.08), 1.2 * pcos(ph, 0.15), 1.5 * pcos(ph, mid + 0.12)];
  D.mane.front = [1.0 * pcos(2 * ph, 0.26), 0, 0];
  D.mane.right = [0, 0, 1.2 * pcos(2 * ph, 0.25)];
  D.mane.left = [0, 0, -1.2 * pcos(2 * ph, 0.27)];
  D.shrug = { right: 0.3 * pcos(ph, 0.55), left: 0.3 * pcos(ph, 0.05) };
  // arms: slight swing opposite to the legs, trailing the shoulders (lag 0.06 cycle); hands and claws trail further
  const armLag = WALK_ARM.lag;
  for (const s of SIDES) {
    const fwd = s === 'right' ? 0.5 : 0.0; // right arm forward when the left foot lands
    const sw = pcos(ph, fwd + 0.02); // +1 = forward extreme (back extreme at the same-side footfall)
    const k = s === 'right' ? 1.0 : 0.8;
    D.wrist[s] = WALK_ARM.wrist[s];
    D.armSwing[s] = [-WALK_ARM.swing * sw * k, (s === 'right' ? 1 : -1) * 1.0 * pcos(ph, mid + 0.04 + armLag)];
    const hs = pcos(ph, fwd + armLag + 0.08);
    D.hand[s] = { flex: 7 * hs, twist: WALK_ARM.twist[s] + (s === 'right' ? 3 : -3) * pcos(ph, fwd + 0.3), side: 0 };
    FINGERS.forEach((f, i) => {
      const fl = pcos(ph, fwd + armLag + 0.12 + 0.015 * (3 - i)); // claws drag behind the swing
      D.curl[s].a[i] = -5 - 5 * fl;
      D.curl[s].b[i] = -6 - 6 * fl;
    });
    D.thumb[s] = -3 - 3 * pcos(ph, fwd + armLag + 0.15);
  }
  for (const s of SIDES) { const f = footAt(s, ph); D.ankle[s] = f.ankle; D.footRot[s] = f.rot; }
  return D;
}
const walkPose = (t) => buildPose(walkDyn(t));

// ============================================================================================ write
const legTol = {};
for (const s of SIDES) for (const b of [`leg_${s}_upper`, `leg_${s}_lower`, `foot_${s}`]) legTol[b] = { rotation: 0.04 };
legTol.body = { rotation: 0.04, position: 0.01 };

const file = {
  format_version: '1.8.0',
  animations: {
    'animation.shaftbreaker.stalk_idle': {
      loop: true,
      animation_length: IDLE_LEN,
      bones: bake(IDLE_LEN, 160, idlePose, { bones: legTol }),
    },
    'animation.shaftbreaker.stalk_walk': {
      loop: true,
      animation_length: WALK_LEN,
      anim_time_update: 'query.modified_distance_moved',
      bones: bake(WALK_LEN, 132, walkPose, { bones: legTol }),
    },
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, stringifyCompact(file) + '\n');
const keys = Object.values(file.animations).map((a) => Object.values(a.bones).reduce((n, b) => n + Object.values(b).reduce((m, c) => m + (Array.isArray(c) ? 1 : Object.keys(c).length), 0), 0));
console.log(`wrote ${path.relative(ADDON_ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, keys: idle ${keys[0]}, walk ${keys[1]})`);
