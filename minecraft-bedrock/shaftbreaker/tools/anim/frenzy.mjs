#!/usr/bin/env node
// frenzy.mjs: generator for the Shaftbreaker FRENZY animations (Minecraft Bedrock add-on).
//   writes Shaftbreaker_RP/animations/shaftbreaker.frenzy.animation.json
//     animation.shaftbreaker.frenzy_idle   time-driven loop (IDLE_LEN s): wide, low coiled crouch (knees bent and
//                                          swivelled forward-out, rear heel up, ready to spring), face held up out of
//                                          the ruff so the gaping mouth reads, arms spread wide with the claws open,
//                                          jaw hanging open, rapid uneven panting (chest / shoulders / jaw / mane),
//                                          a slow predatory weight shift, one "coil" (sink back, surge forward,
//                                          claws clench and re-open) and sharp head / finger twitches.
//     animation.shaftbreaker.frenzy_run    distance-driven loop (anim time = blocks moved; RUN.n stride cycles of
//                                          RUN.cyc blocks): full sprint, torso pitched ~45 deg, long bounding strides
//                                          with heavy knee drive (thigh near horizontal), the planted foot locked to
//                                          the ground through the shared two-bone leg IK and peeling off over the
//                                          toe edge, arms flung forward/out alternately (contralateral), claws
//                                          spread on the fling, jaw wide open, head stabilised and locked forward,
//                                          mane flared and jolting on every footfall, one head-tossing screech per
//                                          loop. step + step_dust on every footfall.
//     animation.shaftbreaker.frenzy_lunge  one-shot (LUNGE_LEN s): a full pose (the attack controller fades the
//                                          phase pose out): wind-up (sink back onto the rear leg, rear up, arms
//                                          drawn back and wide, claws spread, screech), explosive lunge (front foot
//                                          stamps forward, torso throws forward, both claws sweep in and cross),
//                                          follow-through, recoil back into the frenzy_idle crouch.
// Run from minecraft-bedrock/shaftbreaker:  node tools/anim/frenzy.mjs        (--probe <idle|run|lunge> <t> prints a pose)
// Never hand-edit the JSON: change this file (or lib_frenzy.mjs) and regenerate. Deterministic output.
//
// Rotation conventions: SPEC.md §2 (hip flexion -X, knee +X, shoulder flexion -X, elbow -X, finger curl -X,
// jaw open +X, torso hunch +X, +Y turns the front toward the creature's RIGHT (-X), right limb +Z = abduction).
// Everything is baked from smooth functions into dense LINEAR keys (no catmullrom anywhere: one interpolation mode
// per channel), simplified within a small tolerance. Loops: t = 0 and t = length come from the same periodic
// functions, so they are exactly seamless.
import path from 'node:path';
import {
  ADDON_ROOT, UPB, Pose, bake, writeJSON, setLeg, setArm, handRot, localFor, ankleFromContact, boneFrame, pointOn,
  add3, sub3, scale3, lerp, clamp, cyc, hspline, bump, twitch, shudder, wrap01, smooth, fmtT, TAU,
} from './lib_frenzy.mjs';

const OUT = path.join(ADDON_ROOT, 'Shaftbreaker_RP/animations/shaftbreaker.frenzy.animation.json');
const SIDES = ['right', 'left'];
const FINGERS = [1, 2, 3, 4];
const TORSO = ['body', 'waist', 'chest', 'neck'];
const SHOULDER = { right: [-11, 65, 0], left: [11, 65, 0] }; // rest pivots of arm_*_upper (on the chest)
const TOE = [0, -6, -7.5]; // front toe edge of the foot relative to the ankle pivot (level foot frame)
const SOLE = [0, -6, 0]; // sole point under the ankle
const sgn = (s) => (s === 'right' ? 1 : -1); // mirror sign for Y / Z rotations (right limb +Z = abduction)
const mx = (s, v) => [s === 'right' ? v[0] : -v[0], v[1], v[2]]; // author on the RIGHT side, mirror to the left

// ============================================================================================ pose builder
// D = one frame:
//   bodyPos, bodyRot, waist, chest, neck, neckPos, headWorld (world rotation the head is held at), jaw,
//   mane {front, back, right, left} (flare amounts, + = flared out), arm[side] = { off (wrist offset from the
//   shoulder, WORLD axes, authored for the RIGHT side and mirrored), pole (elbow direction, right side), shrug,
//   hand [flex (+ = fingers back), twist (+ = palm turns toward the body), side], curlA[4], curlB[4], splay,
//   thumb [curl, abduction] }, foot[side] = { ankle (world), rot (world foot rotation) }
function buildPose(D) {
  const p = new Pose();
  p.pos('body', D.bodyPos).rot('body', D.bodyRot);
  p.rot('waist', D.waist).rot('chest', D.chest);
  p.rot('neck', D.neck).pos('neck', D.neckPos);
  // mane flare: front / back spikes swing their tips out (-X), shoulder spikes bristle up (hackles raised)
  const M = D.mane;
  p.rot('mane_front', [-M.front, 0, 0]);
  p.rot('mane_back', [-M.back, 0, 0]);
  p.rot('mane_right', [0, 0, M.right]);
  p.rot('mane_left', [0, 0, -M.left]);
  p.setRot('head', localFor(p, TORSO, D.headWorld));
  // soft limit: approaches 54 deg (limit 55) asymptotically instead of flattening against a hard clamp
  const jw = D.jaw <= 44 ? D.jaw : 44 + 10 * Math.tanh((D.jaw - 44) / 10);
  p.rot('jaw', [clamp(jw, 0, 54), 0, 0]);
  for (const s of SIDES) {
    const A = D.arm[s];
    const k = sgn(s);
    p.pos(`arm_${s}_upper`, [0, A.shrug || 0, 0]);
    const S = pointOn(p, 'chest', SHOULDER[s]);
    setArm(p, s, add3(S, mx(s, A.off)), mx(s, A.pole));
    p.setRot(`hand_${s}`, handRot(A.hand[0], -k * A.hand[1], k * A.hand[2]));
    FINGERS.forEach((f, i) => {
      const spl = clamp(A.splay * [-0.9, -0.3, 0.35, 1][i], -29, 29);
      p.rot(`finger_${s}_${f}_a`, [clamp(A.curlA[i], -110, 12), 0, k * spl]);
      p.rot(`finger_${s}_${f}_b`, [clamp(A.curlB[i], -110, 8), 0, 0]);
    });
    p.rot(`thumb_${s}_a`, [clamp(A.thumb[0], -110, 12), 0, -k * A.thumb[1]]);
    p.rot(`thumb_${s}_b`, [clamp(A.thumb[0] * 1.1, -110, 8), 0, 0]);
  }
  for (const s of SIDES) setLeg(p, s, D.foot[s].ankle, D.foot[s].rot, 'frenzy', D.foot[s].swivel || 0);
  return p;
}

// claw shape: open = 1 -> fingers fanned wide, bent moderately at both knuckles (cage-like, claws hooking);
// open = 0 -> clenched hook.
function clawShape(open, curlBias = 0) {
  const c = lerp(-58, -20, open) + curlBias;
  return {
    curlA: [c * 0.85, c, c * 0.95, c * 0.8],
    curlB: [c * 1.1, c * 1.2, c * 1.2, c * 1.05].map((v) => v - 6),
    splay: Math.min(29, lerp(4, 28, open)),
    thumb: [lerp(-46, -14, open), lerp(4, 22, open)],
  };
}

// ============================================================================================ frenzy_idle
const IDLE_LEN = 4.0;
const IDLE = {
  bodyPos: [0, -12.5, 1.0],
  bodyRot: [22, 0, 0],
  waist: [10, 0, 0],
  chest: [10, 0, 0],
  neck: [-28, 0, 0],
  neckPos: [0, 2.5, -8.5],
  headWorld: [5, -3, 4.5], // face up out of the ruff, eyes on the prey, a slight crazed tilt
  jaw: 42,
  mane: { front: 8, back: 8, right: 5, left: 5 },
  arm: {
    right: { off: [-27, -12, -12], pole: [-0.9, 0.6, 0.5], hand: [12, 20, 0], open: 0.95 },
    left: { off: [-26, -15, -9], pole: [-0.9, 0.5, 0.6], hand: [14, 24, 0], open: 0.88 },
  },
  // wide, low, coiled crouch: both knees deeply bent and pointing forward-out; the rear foot is only a short step
  // back on its toe edge (heel up, ready to spring) so its shin stays steep instead of lying along the ground
  foot: {
    right: { contact: [-12.5, 0, 3], rel: TOE, rot: [24, 16, 0], swivel: 22 }, // rear foot on the toe edge, heel up
    left: { contact: [11, 0, -13], rel: SOLE, rot: [0, -16, 0], swivel: 18 }, // front foot flat, toes out
  },
};

function idleBaseD() {
  const D = {
    bodyPos: IDLE.bodyPos.slice(), bodyRot: IDLE.bodyRot.slice(), waist: IDLE.waist.slice(), chest: IDLE.chest.slice(),
    neck: IDLE.neck.slice(), neckPos: IDLE.neckPos.slice(), headWorld: IDLE.headWorld.slice(), jaw: IDLE.jaw,
    mane: { ...IDLE.mane }, arm: {}, foot: {},
  };
  for (const s of SIDES) {
    const A = IDLE.arm[s];
    D.arm[s] = { off: A.off.slice(), pole: A.pole.slice(), shrug: 0, hand: A.hand.slice(), ...clawShape(A.open) };
    const F = IDLE.foot[s];
    D.foot[s] = { ankle: ankleFromContact(F.contact, F.rel, F.rot), rot: F.rot.slice(), swivel: F.swivel || 0 };
  }
  return D;
}

// rapid, uneven panting: sharp inhale, slower exhale; amplitude varies over the loop
const pant = (ph, n) => { const x = ph * n; return Math.sin(TAU * x + 0.45 * Math.sin(TAU * x)); };

function idleDyn(t) {
  const ph = t / IDLE_LEN;
  const D = idleBaseD();
  const amp = 1 + 0.35 * Math.sin(TAU * (ph * 2 + 0.1)); // breath depth varies
  const br = pant(ph, 10) * amp; // 0.4 s per breath
  const brLag = pant(ph - 0.012, 10) * amp;
  const sway = Math.sin(TAU * 2 * ph); // weight shift, 2 s
  const swayLag = Math.sin(TAU * (2 * ph - 0.08));
  const swayLag2 = Math.sin(TAU * (2 * ph - 0.16));
  // the coil: sink back onto the rear leg, then surge forward, settle (t ~ 2.1 .. 3.0 s)
  const coil = cyc([[0, [0, 0, 0]], [0.5, [0, 0, 0], true], [0.58, [0, -3.4, 3.0], true], [0.64, [0, -1.0, -3.2]], [0.72, [0, 0.3, -0.8]], [0.8, [0, 0, 0], true]], ph);
  const coilA = bump(ph, 0.6, 0.1); // anticipation amount (0..1)
  const surge = twitch(ph, 0.645, 0.025, 0.12); // forward surge peak
  // head twitches: sharp snap, slow settle
  const tw1 = twitch(ph, 0.22, 0.012, 0.11), tw2 = twitch(ph, 0.79, 0.012, 0.12), tw3 = twitch(ph, 0.43, 0.01, 0.06);

  D.bodyPos = add3(D.bodyPos, [1.4 * sway, 0.35 * br, 0]);
  D.bodyPos = add3(D.bodyPos, coil);
  D.bodyRot = add3(D.bodyRot, [0.7 * br - 3 * coilA + 4 * surge, -4 * swayLag, -2.2 * sway]);
  D.waist = add3(D.waist, [-0.6 * brLag, 2 * swayLag, 0.8 * swayLag]);
  D.chest = add3(D.chest, [-2.4 * brLag - 2 * coilA + 2 * surge, 3 * swayLag2, 1.2 * swayLag]);
  D.neck = add3(D.neck, [0.8 * brLag, -1.5 * swayLag2 + 5 * tw1 - 3 * tw2, -2 * tw1 + 3 * tw2]);
  D.headWorld = add3(D.headWorld, [
    -1.0 * brLag - 4 * coilA + 3 * surge + 3 * tw3,
    6 * tw1 - 10 * tw2 + 3 * tw3 + 2 * swayLag2,
    -5 * tw1 + 6 * tw2 + 1.5 * swayLag,
  ]);
  D.jaw += 6 * brLag + 10 * coilA - 14 * surge + 8 * tw2;
  const fl = 3 * brLag + 4 * coilA - 2 * surge;
  D.mane = { front: D.mane.front + fl + 3 * tw1, back: D.mane.back + fl, right: D.mane.right + 0.6 * fl + 1.5 * tw1, left: D.mane.left + 0.6 * fl - 2 * tw2 };
  for (const s of SIDES) {
    const A = D.arm[s];
    const side = sgn(s); // +1 right, -1 left
    const lag = s === 'right' ? 0.02 : 0.035;
    const swA = Math.sin(TAU * (2 * ph - 0.12 - lag));
    const brA = pant(ph - lag, 10) * amp;
    // weight shift drags the arms; panting bobs the shoulders; coil cocks the arms back and wide, surge flings them
    const cA = bump(ph, 0.6 + lag, 0.1), sA = twitch(ph, 0.655 + lag, 0.03, 0.13);
    A.shrug = 1.0 * brA + 1.2 * cA;
    A.off = add3(A.off, [-1.5 * side * swA - 3 * cA + 2 * sA, 0.6 * brA + 2 * cA + 1 * sA, 1.2 * side * swA + 5 * cA - 6 * sA]);
    // claws: slow open/close breathing, clench on the coil, re-open wide on the surge, a twitch per hand
    const twAt = s === 'right' ? 0.37 : 0.88;
    const openAt = (q) => clamp(IDLE.arm[s].open + 0.06 * Math.sin(TAU * (4 * q - lag * 3)) - 0.55 * bump(q, 0.6 + lag, 0.07) + 0.12 * twitch(q, 0.655 + lag, 0.03, 0.13), 0, 1.15);
    FINGERS.forEach((f, i) => {
      const lagF = 0.006 * (4 - f);
      A.curlA[i] = clawShape(openAt(ph - lagF)).curlA[i] - 16 * twitch(ph - 0.004 * f, twAt, 0.008, 0.07);
      A.curlB[i] = clawShape(openAt(ph - lagF - 0.01)).curlB[i] - 22 * twitch(ph - 0.006 * f, twAt + 0.002, 0.008, 0.08);
    });
    const cs = clawShape(openAt(ph));
    const twF = twitch(ph, twAt, 0.008, 0.07);
    A.splay = cs.splay + 3 * twF;
    A.thumb = cs.thumb;
    A.hand = add3(A.hand, [3 * cA - 6 * sA - 6 * twF, 0, 0]);
  }
  return D;
}
const idlePose = (t) => buildPose(idleDyn(t));

// ============================================================================================ frenzy_run
// Leg timing per stride cycle (phase u in cycles): right touchdown at 0, left at 0.5. A foot is planted for
// RUN.duty of the cycle (> 0.5, so one foot is always on the ground: no flight phase, the checker does not
// allow one for frenzy_run). While planted it moves backward (+Z) at exactly UPB units per block: first flat,
// then (after heelOff) it peels over its front toe edge, which stays locked to the ground.
const RUN = {
  cyc: 3.3, // blocks per stride cycle (two steps)
  n: 4, // stride cycles per loop (upper-body variation + one screech per loop)
  duty: 0.53,
  toeTD: -26.5, // toe-edge z at touchdown (entity space)
  heelOff: 0.27, // fraction of the cycle (from touchdown) where the heel starts to peel
  pitchLO: 50, // foot pitch at toe-off
  x: { right: -6.5, left: 6.5 },
  yaw: { right: 4, left: -4 },
};
const RUN_LEN = RUN.cyc * RUN.n;
const V = UPB * RUN.cyc; // ground travel (units) per cycle

function stanceFoot(side, u) {
  const x = RUN.x[side];
  const toeZ = RUN.toeTD + V * u;
  const k = clamp((u - RUN.heelOff) / (RUN.duty - RUN.heelOff), 0, 1);
  const rot = [RUN.pitchLO * Math.pow(k, 1.6), RUN.yaw[side], 0];
  return { ankle: ankleFromContact([x, 0, toeZ], TOE, rot), rot, toe: [x, 0, toeZ] };
}

// swing: Hermite path from toe-off to touchdown, velocities matched to the ground at both ends (no slap / skate),
// tucked heel behind the hip, then a heavy knee drive (foot under the high knee), reach, paw back onto the ground.
function swingFoot(side, s, body) {
  const x = RUN.x[side];
  const e = 1e-4;
  const lo = stanceFoot(side, RUN.duty), lo2 = stanceFoot(side, RUN.duty - e);
  const vLo = scale3(sub3(lo.ankle, lo2.ankle), (1 - RUN.duty) / e);
  const td = stanceFoot(side, 0);
  const vTd = [0, -9, V * (1 - RUN.duty)];
  const hz = body.z; // hip z
  const kd = side === 'right' ? 1.0 : 0.94; // asymmetry: the right knee drives a little higher
  const ankle = hspline([
    { u: 0, v: lo.ankle, m: vLo },
    { u: 0.3, v: [x, 20 * kd, hz + 6.5] },
    { u: 0.58, v: [x, 17 * kd, hz - 8.5] },
    { u: 0.82, v: [x, 11, td.ankle[2] - 5.5] },
    { u: 1, v: td.ankle, m: vTd },
  ], s);
  const pitch = hspline([
    { u: 0, v: RUN.pitchLO, m: 40 },
    { u: 0.28, v: 60 },
    { u: 0.57, v: 22 },
    { u: 0.82, v: -7 },
    { u: 1, v: 0, m: 0 },
  ], s);
  return { ankle, rot: [pitch, RUN.yaw[side], 0] };
}

function runFoot(side, u, body) {
  const lu = wrap01(u - (side === 'right' ? 0 : 0.5));
  if (lu < RUN.duty) return stanceFoot(side, lu);
  return swingFoot(side, (lu - RUN.duty) / (1 - RUN.duty), body);
}

// arm swing (RIGHT arm, local arm phase a: 0 = flung forward/out at its peak, 0.5 = drawn back/low)
const RUN_ARM_OFF = [
  [0.00, [-24, -5, -17], true],
  [0.16, [-27, -11, -10]],
  [0.34, [-25, -18, 5]],
  [0.50, [-21, -21, 12], true],
  [0.66, [-26, -17, 0]],
  [0.84, [-27, -9, -14]],
];
const RUN_ARM_POLE = [
  [0.00, [-0.5, 1, 0.2]],
  [0.25, [-0.8, 0.6, 0.6]],
  [0.50, [-0.6, 0.4, 1]],
  [0.75, [-0.9, 0.6, 0.5]],
];
const RUN_ARM_HAND = [ // [flex, twist, side]
  [0.00, [16, 26, 0], true],
  [0.30, [2, 34, 0]],
  [0.50, [-6, 40, 0], true],
  [0.75, [8, 30, 0]],
];
const RUN_ARM_OPEN = [[0.0, 1.05, true], [0.28, 0.7], [0.5, 0.42, true], [0.8, 0.95]];

function runDyn(d) {
  const ph = d / RUN_LEN; // loop phase (RUN.n strides)
  const u = wrap01(d / RUN.cyc); // stride phase
  const D = {};
  // the screech: during the 3rd stride the head tosses up, jaw to the max, mane bristles
  const scr = twitch(ph, 0.6, 0.05, 0.16);
  const scrLag = twitch(ph, 0.61, 0.05, 0.18);
  // slow variation of the arm fling over the loop (never twice the same)
  const varA = 1 + 0.12 * Math.sin(TAU * (ph + 0.15)) + 0.06 * Math.sin(TAU * (3 * ph + 0.4));
  // pelvis: bounding bob (low at mid-stance, high just after toe-off), surge, sway over the stance foot
  const bob = Math.cos(TAU * 2 * (u - 0.04));
  const impact = twitch(u, 0.04, 0.02, 0.12) + twitch(u, 0.54, 0.02, 0.12); // footfall jolts
  const yawB = -6 * Math.cos(TAU * (u - 0.02)); // right hip forward when the right foot lands
  const body = { z: -3.5 + 0.8 * Math.cos(TAU * 2 * (u - 0.3)) };
  D.bodyPos = [-1.1 * Math.sin(TAU * (u - 0.03)), -7.5 + 1.7 * bob - 0.4 * impact, body.z];
  D.bodyRot = [26 + 1.4 * Math.cos(TAU * 2 * (u - 0.1)) + 1.2 * impact - 3 * scr, yawB, -2.5 * Math.sin(TAU * (u - 0.05))];
  // spine counter-rotates (shoulders opposite to the hips), lagging
  D.waist = [13 + 0.8 * Math.cos(TAU * 2 * (u - 0.14)) - 2 * scr, 6 * Math.cos(TAU * (u - 0.06)), 1.2 * Math.sin(TAU * (u - 0.09))];
  D.chest = [12 + 1.0 * Math.cos(TAU * 2 * (u - 0.17)) + 0.8 * impact - 3 * scrLag, 7 * Math.cos(TAU * (u - 0.09)), 1.5 * Math.sin(TAU * (u - 0.12))];
  // neck thrusts the head forward out of the ruff; head is held steady in space, eyes on the target
  D.neck = [-30 - 3 * scr, -3 * Math.cos(TAU * (u - 0.12)), 0];
  D.neckPos = [0, 2.5 + 0.5 * scr, -9 - 1.5 * scr];
  D.headWorld = [
    8 + 1.2 * Math.cos(TAU * 2 * (u - 0.16)) + 1.5 * impact - 12 * scr + 4 * twitch(ph, 0.72, 0.03, 0.1),
    -2.5 * Math.cos(TAU * (u - 0.15)) + 3 * scrLag * Math.sin(TAU * 6 * ph),
    4 + 1.5 * Math.sin(TAU * (u - 0.15)) + 1.5 * Math.sin(TAU * (ph + 0.3)) - 6 * scrLag,
  ];
  // the head is stabilised, but follows a third of the shoulders' yaw (keeps the skull out of the shoulder spikes)
  D.headWorld[1] += 0.35 * (D.bodyRot[1] + D.waist[1] + D.chest[1]);
  D.jaw = 48 + 3 * Math.cos(TAU * 2 * (u - 0.2)) + 3 * shudder(u, 0.05, 0.2, 2) + 3 * shudder(u, 0.55, 0.2, 2) + 14 * scr;
  const fl = 9 + 2 * impact + 3 * scrLag;
  const jig = 2.2 * (shudder(u, 0.06, 0.22, 2) + shudder(u, 0.56, 0.22, 2));
  D.mane = { front: fl + jig, back: fl - 0.6 * jig, right: 0.6 * fl + 0.8 * jig, left: 0.6 * fl + 0.8 * jig };
  // arms: contralateral (right arm flung forward when the LEFT foot lands), lagging the shoulders a little
  D.arm = {};
  for (const s of SIDES) {
    const a = wrap01(u - (s === 'right' ? 0.5 : 0.0) - 0.06);
    const asym = s === 'right' ? 1 : 0.92;
    const off0 = cyc(RUN_ARM_OFF, a);
    const off = [off0[0] * (0.92 + 0.08 * varA), off0[1], off0[2] * asym * varA];
    const openAt = (q) => clamp(cyc(RUN_ARM_OPEN, q) + 0.25 * scr, 0, 1.15);
    const A = { off: add3(off, [-3 * scr, 4 * scr, -2 * scr]), pole: cyc(RUN_ARM_POLE, a), shrug: 0.6 * impact + 1.5 * scr, hand: cyc(RUN_ARM_HAND, a - 0.03) };
    const c = clawShape(openAt(a - 0.04));
    A.curlA = FINGERS.map((f, i) => clawShape(openAt(a - 0.04 - 0.012 * (4 - f))).curlA[i]);
    A.curlB = FINGERS.map((f, i) => clawShape(openAt(a - 0.07 - 0.012 * (4 - f))).curlB[i]);
    A.splay = c.splay;
    A.thumb = c.thumb;
    D.arm[s] = A;
  }
  D.foot = { right: runFoot('right', u, body), left: runFoot('left', u, body) };
  return D;
}

// keep the foot inside its joint range (foot X -50..60): in the swing the shin folds far back, so the world pitch is
// raised until the local foot rotation is back inside [-40, 52]; while planted and peeling over the toe edge the
// heel is lifted further instead (the toe edge stays locked on the ground, the ankle is re-placed), iterated.
function runPose(d) {
  const D = runDyn(d);
  let p = buildPose(D);
  const u = wrap01(d / RUN.cyc);
  for (let it = 0; it < 4; it++) {
    let changed = false;
    for (const s of SIDES) {
      const fl = p.getRot(`foot_${s}`)[0];
      const lim = clamp(fl, -40, 52);
      if (Math.abs(lim - fl) < 0.01) continue;
      const F = D.foot[s];
      const rot = [F.rot[0] + (lim - fl), F.rot[1], F.rot[2]];
      const lu = wrap01(u - (s === 'right' ? 0 : 0.5));
      if (lu < RUN.duty) {
        if (rot[0] < 0) continue; // never tip the planted foot onto its heel
        const st = stanceFoot(s, lu);
        D.foot[s] = { ankle: ankleFromContact(st.toe, TOE, rot), rot };
      } else D.foot[s] = { ankle: F.ankle, rot };
      changed = true;
    }
    if (!changed) break;
    p = buildPose(D);
  }
  return p;
}

// ============================================================================================ frenzy_lunge
const LUNGE_LEN = 0.9;
const STEP = 12; // the front (left) foot stamps forward this far

// key descriptions (overrides of the idle base). t in seconds.
function lungeKeys() {
  const B = idleBaseD();
  const K = (o) => {
    const D = JSON.parse(JSON.stringify(B));
    for (const [k, v] of Object.entries(o)) {
      if (k === 'arm') for (const s of SIDES) Object.assign(D.arm[s], v[s] || {});
      else if (k === 'mane') D.mane = { front: v, back: v, right: 0.6 * v, left: 0.6 * v };
      else D[k] = v;
    }
    return D;
  };
  const open = (o) => clawShape(o);
  return [
    { t: 0.0, D: B, flat: true },
    // wind-up: sink back onto the rear leg, rear the chest up, head thrown back screeching, arms cocked back/wide
    { t: 0.24, flat: true, D: K({
      bodyPos: [0, -13, 5.5], bodyRot: [15, 0, 0], waist: [6, -4, 0], chest: [4, -6, 0], neck: [-16, 0, 0], neckPos: [0, 2, -5],
      headWorld: [-8, 4, 0], jaw: 54, mane: 12,
      arm: {
        right: { off: [-26, 5, 12], pole: [-0.5, 1, 0.7], hand: [32, 18, 0], shrug: 2.5, ...open(1.15) },
        left: { off: [-26, 1, 11.5], pole: [-0.5, 1, 0.7], hand: [32, 22, 0], shrug: 2.5, ...open(1.12) },
      },
    }) },
    // claws whip around wide and forward (arc, so the sweep does not pass through the body)
    { t: 0.34, D: K({
      bodyPos: [0, -8.5, -3], bodyRot: [28, 0, 0], waist: [12, 2, 0], chest: [12, 4, 0], neck: [-28, 0, 0], neckPos: [0, 2.5, -9],
      headWorld: [8, 5, 0], jaw: 50, mane: 11,
      arm: {
        right: { off: [-27, -12, -13], pole: [-0.4, 1, 0.3], hand: [22, 14, 0], shrug: 1, ...open(1.1) },
        left: { off: [-26, -15, -11], pole: [-0.4, 1, 0.35], hand: [22, 18, 0], shrug: 1, ...open(1.08) },
      },
    }) },
    // strike: both claws sweep in and cross in front of the chest (right above left), body thrown forward
    { t: 0.43, D: K({
      bodyPos: [0, -6, -16], bodyRot: [33, 0, 0], waist: [13, 4, 0], chest: [11, 5, 0], neck: [-36, 0, 0], neckPos: [0, 3, -10.5],
      headWorld: [13, 8, 3], jaw: 52, mane: 12,
      arm: {
        right: { off: [-3, -3, -30], pole: [-0.9, 0.6, 0.3], hand: [-10, 10, 0], shrug: 0, ...open(0.3) },
        left: { off: [-4, -12, -28], pole: [-0.9, 0.5, 0.4], hand: [-12, 14, 0], shrug: 0, ...open(0.25) },
      },
    }) },
    // follow-through: arms carried across and down, claws clenched, jaw snaps shut on the bite
    { t: 0.53, flat: true, D: K({
      bodyPos: [0, -7.5, -15], bodyRot: [35, 0, 0], waist: [14, 3, 0], chest: [12, 3, 0], neck: [-34, 0, 0], neckPos: [0, 2.5, -9],
      headWorld: [14, 0, 6], jaw: 8, mane: 9,
      arm: {
        right: { off: [1, -14, -25], pole: [-0.9, 0.5, 0.4], hand: [-14, 12, 0], shrug: 0, ...open(0.05) },
        left: { off: [-1, -24, -21], pole: [-0.9, 0.4, 0.6], hand: [-14, 16, 0], shrug: 0, ...open(0.0) },
      },
    }) },
    // recoil: pull back up into the crouch, arms re-open wide, jaw drops open again
    { t: 0.7, D: K({
      bodyPos: [0, -9.5, -1], bodyRot: [24, 0, 0], waist: [11, 1, 0], chest: [11, 1, 0], neck: [-28, 0, 0], neckPos: [0, 2.5, -8.5],
      headWorld: [6, -2, 3], jaw: 44, mane: 9,
      arm: {
        right: { off: [-20, -16, -18], pole: [-0.9, 0.5, 0.6], hand: [6, 24, 0], shrug: 0, ...open(0.8) },
        left: { off: [-18, -19, -16], pole: [-0.9, 0.4, 0.7], hand: [8, 28, 0], shrug: 0, ...open(0.75) },
      },
    }) },
    { t: LUNGE_LEN, D: B, flat: true },
  ];
}

// flatten / unflatten a D (without feet) to a number vector so every channel can be splined the same way
function flatD(D) {
  const v = [...D.bodyPos, ...D.bodyRot, ...D.waist, ...D.chest, ...D.neck, ...D.neckPos, ...D.headWorld, D.jaw,
    D.mane.front, D.mane.back, D.mane.right, D.mane.left];
  for (const s of SIDES) {
    const A = D.arm[s];
    v.push(...A.off, ...A.pole, A.shrug || 0, ...A.hand, ...A.curlA, ...A.curlB, A.splay, ...A.thumb);
  }
  return v;
}
function unflatD(v) {
  let i = 0;
  const take = (n) => { const r = v.slice(i, i + n); i += n; return n === 1 ? r[0] : r; };
  const D = { bodyPos: take(3), bodyRot: take(3), waist: take(3), chest: take(3), neck: take(3), neckPos: take(3), headWorld: take(3), jaw: take(1) };
  D.mane = { front: take(1), back: take(1), right: take(1), left: take(1) };
  D.arm = {};
  for (const s of SIDES) D.arm[s] = { off: take(3), pole: take(3), shrug: take(1), hand: take(3), curlA: take(4), curlB: take(4), splay: take(1), thumb: take(2) };
  return D;
}
const LK = lungeKeys().map((k) => ({ u: k.t, v: flatD(k.D), m: k.flat ? flatD(k.D).map(() => 0) : undefined }));
const lungeAt = (t) => unflatD(hspline(LK, clamp(t, 0, LUNGE_LEN)));

function lungeDyn(t) {
  // overlap: torso leads, arms / head lag, fingers / mane lag more
  const Db = lungeAt(t), Da = lungeAt(t - 0.025), Dh = lungeAt(t - 0.03), Df = lungeAt(t - 0.05), Dm = lungeAt(t - 0.06);
  const D = { ...Db, neck: Dh.neck, neckPos: Dh.neckPos, headWorld: Dh.headWorld, jaw: Dh.jaw, mane: Dm.mane, arm: {} };
  for (const s of SIDES) D.arm[s] = { ...Da.arm[s], curlA: Df.arm[s].curlA, curlB: Df.arm[s].curlB, splay: Df.arm[s].splay, thumb: Df.arm[s].thumb };
  // impact shudder on the strike
  const sh = t > 0.4 && t < 0.7 ? Math.sin(TAU * 2.5 * (t - 0.4) / 0.3) * (1 - (t - 0.4) / 0.3) ** 2 : 0;
  D.chest = add3(D.chest, [1.5 * sh, 0, 0]);
  D.headWorld = add3(D.headWorld, [2 * sh, 0, 0]);
  // feet: the front (left) foot stamps forward STEP units during the throw and steps back on the recoil;
  // the rear (right) foot stays on its toe edge, the heel peeling up as the body throws forward
  const B = IDLE.foot;
  const lc = B.left.contact;
  const stepOut = smooth((t - 0.27) / 0.12), stepBack = smooth((t - 0.62) / 0.16);
  const zL = lc[2] - STEP * stepOut + STEP * stepBack;
  const liftL = 6.5 * Math.sin(Math.PI * clamp((t - 0.27) / 0.12, 0, 1)) + 4.5 * Math.sin(Math.PI * clamp((t - 0.62) / 0.16, 0, 1));
  const toePitchL = -10 * Math.sin(Math.PI * clamp((t - 0.27) / 0.12, 0, 1)) ** 2 + 14 * Math.sin(Math.PI * clamp((t - 0.62) / 0.16, 0, 1));
  const rotL = [toePitchL, B.left.rot[1], 0];
  const ankL = add3(ankleFromContact([lc[0], 0, zL], B.left.rel, rotL), [0, liftL, 0]);
  const heel = hspline([
    { u: 0, v: B.right.rot[0], m: 0 }, { u: 0.24, v: 20, m: 0 }, { u: 0.43, v: 50 }, { u: 0.53, v: 52, m: 0 },
    { u: 0.72, v: 38 }, { u: LUNGE_LEN, v: B.right.rot[0], m: 0 },
  ], t);
  const rotR = [heel, B.right.rot[1], 0];
  D.foot = {
    left: { ankle: ankL, rot: rotL, swivel: B.left.swivel * (1 - 0.6 * smooth((t - 0.27) / 0.12) + 0.6 * smooth((t - 0.62) / 0.16)) },
    right: { ankle: ankleFromContact(B.right.contact, B.right.rel, rotR), rot: rotR, swivel: B.right.swivel },
  };
  return D;
}
const lungePose = (t) => buildPose(lungeDyn(t));

// ============================================================================================ write
// bake tolerances (max deviation of the linear keys from the sampled curves): tight on the legs and pelvis (planted
// feet must stay locked), looser on fingers / mane / jaw where 0.5 deg is invisible
const legTol = {};
for (const s of SIDES) {
  for (const b of [`leg_${s}_upper`, `leg_${s}_lower`, `foot_${s}`]) legTol[b] = { rotation: 0.05 };
  legTol[`arm_${s}_upper`] = { rotation: 0.2, position: 0.05 };
  legTol[`arm_${s}_lower`] = { rotation: 0.2 };
  legTol[`hand_${s}`] = { rotation: 0.3 };
  for (const f of FINGERS) for (const seg of ['a', 'b']) legTol[`finger_${s}_${f}_${seg}`] = { rotation: 0.5 };
  for (const seg of ['a', 'b']) legTol[`thumb_${s}_${seg}`] = { rotation: 0.5 };
}
for (const m of ['front', 'back', 'right', 'left']) legTol[`mane_${m}`] = { rotation: 0.3 };
legTol.jaw = { rotation: 0.3 };
legTol.body = { rotation: 0.05, position: 0.015 };
const ev = (pairs) => Object.fromEntries(pairs.sort((a, b) => a[0] - b[0]).map(([t, v]) => [fmtT(t), v]));

function runEvents() {
  const snd = [], par = [];
  for (let c = 0; c < RUN.n; c++) {
    for (const [side, off] of [['right', 0], ['left', 0.5]]) {
      const t = (c + off + 0.005) * RUN.cyc;
      snd.push([t, { effect: 'step' }]);
      par.push([t, { effect: 'step_dust', locator: `foot_${side}` }]);
    }
  }
  snd.push([0.555 * RUN_LEN, { effect: 'screech' }]);
  return { sound_effects: ev(snd), particle_effects: ev(par) };
}

function buildFile() {
  return {
    format_version: '1.8.0',
    animations: {
      'animation.shaftbreaker.frenzy_idle': {
        loop: true,
        animation_length: IDLE_LEN,
        bones: bake(IDLE_LEN, 480, idlePose, { bones: legTol }),
      },
      'animation.shaftbreaker.frenzy_run': {
        loop: true,
        animation_length: RUN_LEN,
        anim_time_update: 'query.modified_distance_moved',
        bones: bake(RUN_LEN, 120 * RUN.n, runPose, { bones: legTol }),
        ...runEvents(),
      },
      'animation.shaftbreaker.frenzy_lunge': {
        loop: false,
        animation_length: LUNGE_LEN,
        bones: bake(LUNGE_LEN, 108, lungePose, { bones: legTol }),
        sound_effects: ev([[0.0, { effect: 'screech' }], [0.39, { effect: 'step' }], [0.42, { effect: 'scrape' }]]),
        particle_effects: ev([[0.39, { effect: 'step_dust', locator: 'foot_left' }]]),
      },
    },
  };
}

if (process.argv.includes('--trace')) {
  // --trace <idle|run|lunge> <bone> [from] [to] [n]: local rotation of one bone over time (tuning aid)
  const i = process.argv.indexOf('--trace');
  const [which, bone] = [process.argv[i + 1], process.argv[i + 2]];
  const from = Number(process.argv[i + 3] || 0), to = Number(process.argv[i + 4] || (which === 'run' ? RUN.cyc : which === 'lunge' ? LUNGE_LEN : IDLE_LEN));
  const n = Number(process.argv[i + 5] || 40);
  const f = which === 'run' ? runPose : which === 'lunge' ? lungePose : idlePose;
  for (let k = 0; k <= n; k++) {
    const t = from + ((to - from) * k) / n;
    const p = f(t);
    console.log(t.toFixed(3).padStart(7), JSON.stringify(p.getRot(bone).map((v) => +v.toFixed(1))), JSON.stringify(boneFrame(p, bone).p.map((v) => +v.toFixed(1))));
  }
} else if (process.argv.includes('--probe')) {
  const i = process.argv.indexOf('--probe');
  const which = process.argv[i + 1] || 'idle';
  const t = Number(process.argv[i + 2] || 0);
  const p = which === 'run' ? runPose(t) : which === 'lunge' ? lungePose(t) : idlePose(t);
  for (const b of ['body', 'chest', 'neck', 'head', 'jaw', 'arm_right_upper', 'arm_right_lower', 'hand_right', 'arm_left_upper', 'arm_left_lower', 'hand_left',
    'leg_right_upper', 'leg_right_lower', 'foot_right', 'leg_left_upper', 'leg_left_lower', 'foot_left']) {
    console.log(b.padEnd(16), boneFrame(p, b).p.map((v) => v.toFixed(1)).join(', ').padEnd(22), JSON.stringify(p.getRot(b).map((v) => +v.toFixed(1))));
  }
} else {
  // --out <file> writes elsewhere (scratch iterations); default: the RP animation file
  const oi = process.argv.indexOf('--out');
  const out = oi > 0 ? path.resolve(process.argv[oi + 1]) : OUT;
  writeJSON(out, buildFile());
  console.log(`wrote ${path.relative(ADDON_ROOT, out)}`);
}
