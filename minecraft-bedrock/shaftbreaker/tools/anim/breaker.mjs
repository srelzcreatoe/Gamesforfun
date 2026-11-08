#!/usr/bin/env node
// breaker.mjs: generator for the Shaftbreaker BREAKER animations (Minecraft Bedrock add-on).
//   writes Shaftbreaker_RP/animations/shaftbreaker.breaker.animation.json
//     animation.shaftbreaker.breaker_smash  time-driven loop (1.8 s): wide low lunge stance, torso pitched well forward,
//                                           alternating claw strikes (windmill): each arm cocks high out to the side
//                                           (elbow out/back, claws above the head), whips up-and-forward into the wall
//                                           at its own side (impact hold + rake; never across the skull), tears down,
//                                           digs its claws into the floor ahead and rips the rubble back while the
//                                           other arm strikes. Torso twists / dips with every blow, head and mane
//                                           lag, claws open on the wind-up and clench on impact.
//                                           debris + smash on each impact, scrape on each low rip.
//     animation.shaftbreaker.breaker_walk   distance-driven loop (anim time = blocks moved, WALK_LEN blocks per two
//                                           steps): heavy stomping shove forward in the same low hunch, arms clawing
//                                           ahead alternately (contralateral to the legs), planted feet locked to
//                                           the ground through the shared two-bone leg IK, step + step_dust on each
//                                           footfall.
// Run from minecraft-bedrock/shaftbreaker:  node tools/anim/breaker.mjs
// Never hand-edit the JSON: change this file (or lib_breaker.mjs) and regenerate. Deterministic output.
//
// Rotation conventions: SPEC.md §2 (hip flexion -X, knee +X, shoulder flexion -X, elbow -X, finger curl -X,
// jaw open +X, torso hunch +X, +Y turns the front toward the creature's RIGHT (-X), right limb +Z = abduction).
// Everything is baked from smooth periodic functions into dense LINEAR keys (no catmullrom anywhere, so one
// interpolation mode per channel) simplified within a small tolerance; t = 0 and t = length are sampled from the
// same periodic functions, so both loops are exactly seamless.
import path from 'node:path';
import {
  ADDON_ROOT, UPB, Pose, bake, boneRotation, mul3, transpose3, writeJSON, setLeg, setArm, handRot, localFor, ankleFromContact, boneFrame, pointOn, mulv3, norm3, unwrapTrack, limitsOf,
  add3, sub3, scale3, mirrorX, lerp, clamp, cyc, hspline, bump, twitch, shudder, psin, pcos, wrap01, smooth, fmtT,
} from './lib_breaker.mjs';

const OUT = path.join(ADDON_ROOT, 'Shaftbreaker_RP/animations/shaftbreaker.breaker.animation.json');
const SIDES = ['right', 'left'];
const FINGERS = [1, 2, 3, 4];
const Z3 = () => [0, 0, 0];

// ============================================================================================ shared pose builder
// D = one frame's description:
//   bodyPos, bodyRot, waist, chest, neck, neckPos, headWorld (world rotation the head is stabilised to), jaw,
//   mane {front, back, right, left}, arm[side] = { wrist (world), pole (world dir), shrug, hand [flex, twist, side],
//   curlA[4], curlB[4], splay, thumb }, foot[side] = { ankle (world), rot (world) }
function buildPose(D) {
  const p = new Pose();
  p.pos('body', D.bodyPos).rot('body', D.bodyRot);
  p.rot('waist', D.waist).rot('chest', D.chest);
  p.rot('neck', D.neck).pos('neck', D.neckPos);
  for (const m of ['front', 'back', 'right', 'left']) p.rot(`mane_${m}`, D.mane[m]);
  p.setRot('head', localFor(p, ['body', 'waist', 'chest', 'neck'], D.headWorld));
  p.rot('jaw', [Math.max(0, D.jaw), 0, 0]);
  for (const s of SIDES) {
    const A = D.arm[s];
    const k = s === 'right' ? 1 : -1; // mirror sign for Y / Z rotations
    p.pos(`arm_${s}_upper`, [0, A.shrug, A.thrust || 0]);
    setArm(p, s, A.wrist, A.poleChest ? mulv3(boneFrame(p, 'chest').R, A.poleChest) : A.pole);
    p.setRot(`hand_${s}`, handRot(A.hand[0], k * A.hand[1], k * A.hand[2]));
    FINGERS.forEach((f, i) => {
      const spl = A.splay * [-0.8, -0.25, 0.35, 1][i];
      p.rot(`finger_${s}_${f}_a`, [Math.min(12, A.curlA[i]), 0, k * spl]);
      p.rot(`finger_${s}_${f}_b`, [Math.min(8, A.curlB[i]), 0, 0]);
    });
    p.rot(`thumb_${s}_a`, [A.thumb, 0, -k * 6]);
    p.rot(`thumb_${s}_b`, [A.thumb * 1.2, 0, 0]);
  }
  for (const s of SIDES) setLeg(p, s, D.foot[s].ankle, D.foot[s].rot);
  return p;
}

// ============================================================================================ breaker_smash
// BREAKER panel (tools/reference/breaker_full.png): deep lunge (left foot forward, right foot far back, hips low),
// torso pitched ~45 deg forward, left arm thrust up/forward into the wall, right arm low clawing at the floor.
const SM_LEN = 1.8; // s, two strikes (left at phase 0.25, right at 0.75)
const IMPACT = 0.25; // local arm phase of the wall impact
const RIP = 0.68; // local arm phase where the low rip starts (claws poised over the rubble)
const SCRAPE = RIP; // the claws bite the floor here and rake back (scrape sound), ~0.13 s before the other arm's smash
const TOE = [0, -6, -7.5]; // toe tip relative to the ankle pivot (level foot frame)
const SM_FEET = {
  left: { contact: [10.5, 0, -17], yaw: -5, pitch: 0, rel: [0, -6, 0] }, // front foot flat, planted out wide
  right: { contact: [-14, 0, 19], yaw: 10, pitch: 26, rel: TOE }, // back foot: heel raised, on the toe roots
};
const SM_BODY = { pos: [0, -10, 3], rot: [29, 0, 0] };
const SM_WAIST = [12, 0, 0];
const SM_CHEST = [13, 0, 0];

// LEFT arm timeline in its local phase a (right arm: a = phase - 0.5, mirrored). [phase, value, flat?]
// wrist: world entity space
const ARM_WRIST = [
  [0.00, [28, 32, 6]], // lifting out of the rip, swinging up and out beside the body
  [0.06, [33, 45, -2]],
  [0.12, [31, 60, -5]],
  [0.18, [27, 66, -7], true], // cocked high at the side, hand up above and outside the shoulder (peak anticipation)
  [0.25, [26, 57, -35], true], // IMPACT: thrust up and forward into the wall at the front-left (the panel's arm)
  [0.31, [26, 51, -36]], // claws rake down the wall
  [0.38, [26.5, 43, -38]], // tear down along the wall, arm kept long, outside the shoulder line
  [0.46, [26, 33, -36]],
  [0.54, [24.5, 26, -28]], // reach low ahead
  [0.62, [25, 21, -21], true], // claws poised over the rubble, out beside the front foot
  [RIP, [27.5, 19.7, -17]], // claws bite into the floor (outside the front foot) ...
  [0.80, [26, 21, -2], true], // ... and rip back toward the hip
  [0.90, [27, 25, 6]], // lift out
];
// elbow direction in WORLD (entity) space for the LEFT arm (+x = lateral, -z = forward); the IK only uses the part
// perpendicular to the shoulder->wrist line. Elbow back when low, down/out while cocked, down at the impact (palm
// to the wall), out/back while tearing down the wall.
const ARM_POLE = [
  [0.00, [0.4, 0.0, 1.0]],
  [0.06, [0.45, -0.25, 0.85]], // swinging out and up: elbow back (never along the arm: no IK flip)
  [0.12, [0.45, -0.15, 0.9]],
  [0.18, [0.5, 0.0, 0.85], true], // cocked: upper arm up and out to the side, elbow out/back, claws high
  [0.25, [0.1, 0.85, 0.5], true], // impact: arm nearly straight, elbow just above the line (no twist)
  [0.33, [0.3, 0.4, 0.85]],
  [0.45, [0.45, -0.2, 0.85]],
  [0.60, [0.4, 0.0, 1.0], true],
  [0.80, [0.4, 0.0, 1.0], true],
  [0.92, [0.4, -0.1, 1.0]],
];
// hand [flex (+ = extension, fingers back), twist, side] relative to the forearm
const ARM_HAND = [
  [0.00, [16, 0, 0]],
  [0.12, [30, 0, 0]],
  [0.18, [36, 0, 0], true], // cocked back
  [0.25, [46, -5, 15], true], // impact: palm planted on the wall, fingers up, claws hooked into the stone
  [0.31, [34, -12, 10]],
  [0.45, [4, -25, 0]],
  [0.62, [5, -58, -15], true], // fingers stood down on the floor, claws hooked in under the hand
  [0.80, [18, -55, -5], true],
  [0.90, [20, -20, 0]],
];
// finger curl (0 = model's rest curl, negative = tighter), splay (+ = fanned wider), thumb curl
const ARM_GRIP = [ // [curl, splay, thumb]
  [0.00, [-10, 0, -8]],
  [0.12, [8, 10, 4]], // open wide on the wind-up
  [0.21, [10, 12, 6], true], // claws spread just before the hit
  [0.26, [-26, -2, -20]], // clench into the wall
  [0.33, [-24, 0, -18], true],
  [0.45, [-4, 6, -4]],
  [0.58, [6, 10, 2]], // open for the floor
  [0.64, [-6, 10, -8], true], // dig: fingers splayed like a rake
  [0.80, [-12, 8, -12], true], // rip
  [0.90, [-14, 2, -10]],
];

// per-arm asymmetry: the right (second) strike lands lower and harder, the left one higher
const ARM_ASYM = {
  left: { wrist: [0, 2, 0], hit: 1.0 },
  right: { wrist: [0, -3, -1], hit: 1.15 },
};

// The blow itself is not a spline ease: from STRIKE0 the claw ACCELERATES along an arc over the top (quadratic
// Bezier through STRIKE_CTRL) and stops dead at the wall on IMPACT (velocity discontinuity = the hit).
const STRIKE0 = 0.195;
const STRIKE_CTRL = [27, 70, -20];
function strikeWrist(a) {
  const p0 = cyc(ARM_WRIST, STRIKE0), p2 = cyc(ARM_WRIST, IMPACT);
  const u = (a - STRIKE0) / (IMPACT - STRIKE0);
  const e = u * u * (0.35 + 0.65 * u) + 0.0 * u; // slow start, whip into the wall
  const q = (k) => (1 - e) * (1 - e) * p0[k] + 2 * (1 - e) * e * STRIKE_CTRL[k] + e * e * p2[k];
  return [q(0), q(1), q(2)];
}

function armAt(side, ph) {
  const a = wrap01(ph - (side === 'left' ? 0 : 0.5));
  const as = ARM_ASYM[side];
  let wrist = a >= STRIKE0 && a < IMPACT ? strikeWrist(a) : cyc(ARM_WRIST, a);
  wrist = add3(wrist, scale3(as.wrist, bump(a, IMPACT, 0.12)));
  // impact jolt: claws shudder in the wall
  const sh = shudder(a, IMPACT, 0.1, 2) * as.hit;
  wrist = add3(wrist, [0, -1.2 * sh, 0.8 * sh]);
  let pole = cyc(ARM_POLE, a);
  const hand = cyc(ARM_HAND, a - 0.012); // the hand trails the forearm a little (follow-through)
  const g = cyc(ARM_GRIP, a);
  // fingers: claws curl with a ripple (lateral finger 4 leads, medial follows; distal segments lag)
  const curlA = FINGERS.map((f, i) => cyc(ARM_GRIP, a - 0.008 * (4 - f))[0] * [0.85, 1.0, 1.0, 0.9][i]);
  const curlB = FINGERS.map((f, i) => cyc(ARM_GRIP, a - 0.015 - 0.01 * (4 - f))[0] * [1.0, 1.1, 1.1, 1.0][i]);
  // shoulder: hunches up on the wind-up, drives forward/down into the blow
  const shrug = 1.2 * bump(a, 0.15, 0.1) - 0.9 * bump(a, 0.27, 0.06);
  const thrust = -1.8 * bump(a, 0.27, 0.08);
  if (side === 'right') { wrist = mirrorX(wrist); pole = mirrorX(pole); }
  return { wrist, pole, hand, curlA, curlB, splay: g[1], thumb: g[2], shrug, thrust, a };
}

// torso channels (global phase). Yaw: + turns the chest's front toward its right = left shoulder forward.
const SM_YAW = [
  [0.00, -12], [0.10, -15], [0.18, -21, true], [0.25, 13], [0.30, 17, true], [0.42, 9], [0.58, 15],
  [0.68, 23, true], [0.75, -14], [0.80, -19, true], [0.92, -10],
];
// pitch offset: rear up a little on the wind-ups (stays well hunched, as in the panel), dip on the blows
const SM_PITCH = [
  [0.00, -3], [0.10, -8], [0.18, -11, true], [0.255, 9], [0.30, 11, true], [0.42, 2],
  [0.52, -4], [0.60, -9], [0.68, -13, true], [0.755, 11], [0.80, 13, true], [0.92, 2],
];
// roll (+ = top leans to its LEFT): stretch away from the raised arm, crunch onto the striking side
const SM_ROLL = [
  [0.00, -3], [0.18, -9, true], [0.26, 6], [0.36, 3], [0.5, 2],
  [0.68, 9, true], [0.76, -6], [0.86, -3], [0.95, -2],
];

function smashDyn(t) {
  const ph = t / SM_LEN;
  const D = {};
  const yaw = cyc(SM_YAW, ph), yawLag = cyc(SM_YAW, ph - 0.03), yawLag2 = cyc(SM_YAW, ph - 0.06);
  const pit = cyc(SM_PITCH, ph), pitLag = cyc(SM_PITCH, ph - 0.03), pitLag2 = cyc(SM_PITCH, ph - 0.06);
  const roll = cyc(SM_ROLL, ph), rollLag = cyc(SM_ROLL, ph - 0.03);
  // impact jolts (left at 0.25, right at 0.75)
  const hitL = twitch(ph, 0.255, 0.02, 0.14), hitR = twitch(ph, 0.755, 0.02, 0.14) * 1.15;
  const hit = hitL + hitR;
  const shk = shudder(ph, 0.25, 0.12, 2) + 1.15 * shudder(ph, 0.75, 0.12, 2);
  // pelvis: drops and lunges onto the front foot on each blow, rises on the wind-ups
  const rear = bump(ph, 0.17, 0.1) + bump(ph, 0.67, 0.1);
  D.bodyPos = add3(SM_BODY.pos, [0.6 * psin(ph, 0.05), -1.5 * rear - 2.2 * hit, 1.5 * rear - 2.0 * hit]);
  D.bodyRot = add3(SM_BODY.rot, [0.3 * pit, 0.2 * yaw, 0.25 * roll]);
  D.waist = add3(SM_WAIST, [0.3 * pitLag, 0.4 * yawLag, 0.35 * rollLag]);
  D.chest = add3(SM_CHEST, [0.4 * pitLag + 0.8 * shk, 0.5 * yawLag, 0.4 * rollLag]);
  // head: locked on the wall ahead, lags the chest; tips back a little as the jaw roars open on each blow
  const roar = twitch(ph, 0.27, 0.06, 0.16) + twitch(ph, 0.77, 0.06, 0.16) * 1.1;
  D.neck = [-30 - 4 * roar, 0.15 * yawLag2, 0];
  D.neckPos = [0, 2.5 + 1.5 * roar, -3.5 - 1.0 * roar];
  D.headWorld = [4 + 0.5 * Math.max(0, pitLag2) - 3 * roar + 1.5 * shudder(ph, 0.26, 0.14, 2) + 1.5 * shudder(ph, 0.76, 0.14, 2), 0.4 * cyc(SM_YAW, ph + 0.01), 0.55 * rollLag];
  D.jaw = 2 + 26 * roar;
  // mane: flares on each blow (lags the chest) and rattles
  const fl = twitch(ph, 0.28, 0.04, 0.2) + twitch(ph, 0.78, 0.04, 0.2) * 1.1;
  const rat = shudder(ph, 0.27, 0.16, 3) + shudder(ph, 0.77, 0.16, 3);
  D.mane = {
    front: [-5 * fl + 1.5 * rat, 0, 0],
    back: [-6.5 - 4 * fl - 0.8 * rat, 0.1 * yawLag2, 0], // tipped back to clear the raised skull (total <= 12 deg)
    right: [0, 0, -6 * fl - 1.5 * rat], // spikes beside the head tip outward (away from the skull)
    left: [0, 0, 6 * fl + 1.5 * rat],
  };
  D.arm = { right: armAt('right', ph), left: armAt('left', ph) };
  D.foot = {};
  for (const s of SIDES) {
    const F = SM_FEET[s];
    const rot = [F.pitch, F.yaw, 0];
    D.foot[s] = { ankle: ankleFromContact(F.contact, F.rel, rot), rot };
  }
  return D;
}
const smashPose = (t) => buildPose(smashDyn(t));

// ============================================================================================ breaker_walk
// Distance-driven: anim time = blocks moved; one cycle (right step + left step) = WALK_LEN blocks. In entity space a
// planted foot moves backward (+Z) at UPB = 16/0.58 units per block. Same low hunch as the smash (so the idle <-> walk
// blend in the breaker state is clean), heavy flat-footed stomps (high knee, foot driven down, body drops and lurches
// on each footfall), arms clawing ahead alternately: each arm reaches out high, rakes down and back through the rock
// as the OPPOSITE foot stamps down (contralateral shove), then swings out and around for the next swipe.
const WALK_LEN = 2.2; // blocks per cycle (~1.26 s per cycle at the breaker speed ~1.75 b/s)
const V = WALK_LEN * UPB; // units of foot travel per cycle (60.7)
const DUTY = 0.62; // stance fraction
const W_TOE = [0, -6, -7.5]; // toe tip relative to the ankle pivot (flat foot frame): heel-peel rocker point
const W_TD = { right: 0.04, left: 0.54 }; // touch-down phase of each foot
const W_BODY = { pos: [0, -10.5, 3], rot: [21, 0, 0] };
const W_WAIST = [16, 0, 0];
const W_CHEST = [17, 0, 0];
const W_HIP_Z = W_BODY.pos[2];
const W_STANCE_CENTER = W_HIP_Z - 2.5; // planted span centred a little ahead of the hips (heavy forward lean)
const W_TRACK = { right: -8.5, left: 8.5 }; // ankle x: wide, heavy gait
const W_YAW = { right: 3, left: -3 }; // toes turned out a little
const PEEL = 0.17; // stance fraction of the heel peel before toe-off
const LO_PITCH = 26;
const STANCE = DUTY * V;
const zToe0 = W_STANCE_CENTER - STANCE / 2 + W_TOE[2]; // toe tip z at touch-down

function wStancePitch(u) {
  if (u > DUTY - PEEL) return LO_PITCH * smooth((u - (DUTY - PEEL)) / PEEL);
  return 0;
}
function wStanceAnkle(side, u) {
  return ankleFromContact([W_TRACK[side], 0, zToe0 + u * V], W_TOE, [wStancePitch(u), W_YAW[side], 0]);
}
const dW = (side, u) => { const h = 1e-4; return scale3(sub3(wStanceAnkle(side, u + h), wStanceAnkle(side, u - h)), 1 / (2 * h)); };
const dWP = (u) => { const h = 1e-4; return (wStancePitch(u + h) - wStancePitch(u - h)) / (2 * h); };
const W_SWING = 1 - DUTY;
// swing s = 0..1: peel off, knee driven high, foot carried forward hanging toes-down, then stamped down flat
function wSwingFoot(side, s) {
  const A = wStanceAnkle(side, DUTY), B = wStanceAnkle(side, 0);
  const vA = scale3(dW(side, DUTY - 1e-4), W_SWING), vB = scale3(dW(side, 1e-4), W_SWING);
  const out = side === 'right' ? -1 : 1;
  const x = hspline([{ u: 0, v: A[0], m: vA[0] }, { u: 0.5, v: W_TRACK[side] - out * 0.8 }, { u: 1, v: B[0], m: vB[0] }], s);
  const z = hspline([
    { u: 0, v: A[2], m: vA[2] },
    { u: 0.08, v: A[2] + 0.3 * vA[2] * 0.08 }, // toe leaves the ground almost straight up
    { u: 0.4, v: W_HIP_Z + 1 },
    { u: 0.68, v: B[2] - 4 }, // carried past the spot, high
    { u: 0.88, v: B[2] - 1.2 },
    { u: 1, v: B[2], m: vB[2] },
  ], s);
  const y = hspline([
    { u: 0, v: A[1], m: vA[1] },
    { u: 0.08, v: A[1] + 2.5 },
    { u: 0.4, v: 13.5 },
    { u: 0.64, v: 14.5 }, // knee high: the stamp's wind-up
    { u: 0.86, v: B[1] + 5.5 },
    { u: 1, v: B[1], m: -55 }, // driven down hard: lands with downward speed (a stamp, not a placement)
  ], s);
  const pitch = hspline([
    { u: 0, v: LO_PITCH, m: dWP(DUTY - 1e-4) * W_SWING },
    { u: 0.08, v: LO_PITCH + 4 },
    { u: 0.4, v: 26 },
    { u: 0.66, v: 12 },
    { u: 0.86, v: 2 },
    { u: 1, v: 0, m: 0 },
  ], s);
  return { ankle: [x, y, z], rot: [pitch, W_YAW[side], 0] };
}
function wFootAt(side, ph) {
  const u = wrap01(ph - W_TD[side]);
  if (u < DUTY) return { ankle: wStanceAnkle(side, u), rot: [wStancePitch(u), W_YAW[side], 0] };
  return wSwingFoot(side, (u - DUTY) / W_SWING);
}

// LEFT arm claw cycle in its local phase b (b = 0 at the RIGHT foot's stamp; right arm mirrored, b = phase - 0.5)
const W_ARM_WRIST = [
  [0.00, [19.5, 38, -35], true], // reached out ahead and down (clawing at the ground ahead, not a zombie reach), claws open
  [0.10, [21.5, 33, -31]], // rake down through the rock (fast: driven by the opposite foot's stamp) ...
  [0.24, [26.5, 28.5, -14]],
  [0.40, [26.5, 27.5, 1.5], true], // ... and drag it back low beside the knee, the arm hanging long, outside the leg
  [0.58, [27.5, 29, 1]], // swing out
  [0.76, [28, 31, -14]], // and around, low and long (no folded T-rex forearm)
  [0.90, [23, 34.5, -32]],
];
const W_ARM_POLE = [ // chest frame (+x lateral for the left arm, +z = back)
  [0.00, [0.6, -0.5, 0.6], true],
  [0.20, [0.45, -0.1, 0.9]],
  [0.42, [0.3, 0.0, 1.0], true], // elbow back while dragging: a pull, not a sideways T
  [0.62, [0.4, -0.2, 0.9]],
  [0.80, [0.55, -0.4, 0.7]],
];
const W_ARM_HAND = [ // [flex, twist, side]
  [0.00, [-12, -68, 0], true], // palm rolled down, fingers forward, claws hooked
  [0.20, [-16, -60, 0]], // wrist flicks the claws down through the rake
  [0.42, [20, -30, 0], true],
  [0.62, [12, -10, 0]],
  [0.82, [-4, -40, 0]],
];
const W_ARM_GRIP = [ // [curl, splay, thumb]
  [0.00, [8, 10, 4], true], // open
  [0.10, [-24, 0, -18]], // clench as it rakes
  [0.40, [-20, 0, -16], true],
  [0.60, [-6, 4, -6]],
  [0.86, [6, 9, 3]],
];
const W_ASYM = { left: { k: 1.0, wrist: [0, 0, 0] }, right: { k: 1.0, wrist: [0.8, -0.3, 0.5] } }; // right claw sweeps a touch lower and wider

function walkArmAt(side, ph) {
  const b = wrap01(ph - (side === 'left' ? W_TD.right : W_TD.left));
  let wrist = add3(cyc(W_ARM_WRIST, b), W_ASYM[side].wrist);
  let poleChest = cyc(W_ARM_POLE, b);
  const hand = cyc(W_ARM_HAND, b);
  const g = cyc(W_ARM_GRIP, b);
  const curlA = FINGERS.map((f, i) => cyc(W_ARM_GRIP, b - 0.01 * (4 - f))[0] * [0.85, 1.0, 1.0, 0.9][i]);
  const curlB = FINGERS.map((f, i) => cyc(W_ARM_GRIP, b - 0.02 - 0.01 * (4 - f))[0] * [1.0, 1.1, 1.1, 1.0][i]);
  if (side === 'right') { wrist = mirrorX(wrist); poleChest = mirrorX(poleChest); }
  return { wrist, poleChest, hand, curlA, curlB, splay: g[1], thumb: g[2], shrug: 0, a: b };
}

function walkDyn(t) {
  const ph = t / WALK_LEN;
  const D = {};
  // stamp impulses (0 -> 1 right after each footfall, decaying)
  const stR = twitch(ph, W_TD.right + 0.03, 0.03, 0.16), stL = twitch(ph, W_TD.left + 0.03, 0.03, 0.16) * 0.92;
  const stamp = stR + stL;
  const stampLag = twitch(ph, W_TD.right + 0.07, 0.04, 0.2) + twitch(ph, W_TD.left + 0.07, 0.04, 0.2) * 0.92;
  // weight side: +1 on the right foot (its mid-stance), -1 on the left
  const onR = pcos(ph, W_TD.right + DUTY / 2 - 0.06), onRlag = pcos(ph, W_TD.right + DUTY / 2 - 0.01);
  // rise during each swing (pushing off), drop hard into each stamp
  const rise = bump(ph, W_TD.left - 0.12, 0.2) + bump(ph, W_TD.right - 0.12 + 1, 0.2);
  D.bodyPos = add3(W_BODY.pos, [-1.4 * onR, 1.2 * rise - 2.2 * stamp, -0.8 * stamp]);
  // pelvis: yaw swings the stepping hip forward, roll drops the swing-side hip, pitch lurches on each stamp
  D.bodyRot = add3(W_BODY.rot, [2.5 * stamp, -5 * pcos(ph, W_TD.right - 0.02), 2.2 * onR]);
  // shoulders turn against the hips and with the clawing arm; spine lurches forward after each stamp
  const twist = pcos(ph, W_TD.right + 0.06); // + = left shoulder forward (left arm rakes at the right stamp)
  D.waist = add3(W_WAIST, [1.5 * stampLag, 3.5 * twist, -2.4 * onRlag]);
  D.chest = add3(W_CHEST, [2.5 * stampLag - 1.2 * rise, 6 * pcos(ph, W_TD.right + 0.09), -1.2 * onRlag]);
  // head: level and locked ahead, rides the jolts a little late; jaw hangs and snaps on the stamps
  D.neck = [-24 - 2 * stampLag, -2 * twist, 0];
  D.neckPos = [0, 2.5, -4.5];
  D.headWorld = [3 + 2.5 * stampLag - 1.5 * rise, 1.5 * pcos(ph, W_TD.right + 0.3), 1.2 * onRlag];
  D.jaw = 3 + 7 * stampLag;
  // mane: bounces after each stamp, sways with the roll
  const bo = twitch(ph, W_TD.right + 0.09, 0.05, 0.22) + twitch(ph, W_TD.left + 0.09, 0.05, 0.22);
  D.mane = {
    front: [2.5 * bo, 0, 0],
    back: [-10 + 2 * bo, 0, 1.5 * onRlag], // tipped back to clear the raised skull
    right: [0, 0, 3 * bo],
    left: [0, 0, -3 * bo],
  };
  D.arm = { right: walkArmAt('right', ph), left: walkArmAt('left', ph) };
  D.foot = { right: wFootAt('right', ph), left: wFootAt('left', ph) };
  return D;
}
const walkPose = (t) => buildPose(walkDyn(t));

// ============================================================================================ write
const legTol = {};
for (const s of SIDES) for (const b of [`leg_${s}_upper`, `leg_${s}_lower`, `foot_${s}`]) legTol[b] = { rotation: 0.04 };
legTol.body = { rotation: 0.04, position: 0.01 };
// fingers / thumbs / mane / jaw: small, fast-reading parts; a looser tolerance keeps the file compact
for (const s of SIDES) {
  for (const f of FINGERS) for (const seg of ['a', 'b']) legTol[`finger_${s}_${f}_${seg}`] = { rotation: 0.3 };
  for (const seg of ['a', 'b']) legTol[`thumb_${s}_${seg}`] = { rotation: 0.3 };
}
for (const m of ['front', 'back', 'left', 'right']) legTol[`mane_${m}`] = { rotation: 0.25 };
legTol.jaw = { rotation: 0.25 };

const ev = (pairs) => Object.fromEntries(pairs.map(([t, v]) => [fmtT(t), v]));
const smash = {
  loop: true,
  animation_length: SM_LEN,
  bones: bake(SM_LEN, 216, smashPose, { bones: legTol }),
  sound_effects: ev([
    [(SCRAPE - 0.5) * SM_LEN, { effect: 'scrape' }],
    [IMPACT * SM_LEN, { effect: 'smash' }],
    [SCRAPE * SM_LEN, { effect: 'scrape' }],
    [(IMPACT + 0.5) * SM_LEN, { effect: 'smash' }],
  ]),
  particle_effects: ev([
    [IMPACT * SM_LEN, { effect: 'debris', locator: 'claw_left' }],
    [(IMPACT + 0.5) * SM_LEN, { effect: 'debris', locator: 'claw_right' }],
  ]),
};

const file = {
  format_version: '1.8.0',
  animations: {
    'animation.shaftbreaker.breaker_smash': smash,
    'animation.shaftbreaker.breaker_walk': {
      loop: true,
      animation_length: WALK_LEN,
      anim_time_update: 'query.modified_distance_moved',
      bones: bake(WALK_LEN, 176, walkPose, { bones: legTol }),
      sound_effects: ev([[W_TD.right * WALK_LEN, { effect: 'step' }], [W_TD.left * WALK_LEN, { effect: 'step' }]]),
      particle_effects: ev([
        [W_TD.right * WALK_LEN, { effect: 'step_dust', locator: 'foot_right' }],
        [W_TD.left * WALK_LEN, { effect: 'step_dust', locator: 'foot_left' }],
      ]),
    },
  },
};

if (process.argv.includes('--handsearch')) {
  // diagnostic: LEFT hand [flex, twist, side] at arm phase a that best points the palm (-Z of the hand) and the
  // fingers (-Y of the hand) along the wanted world directions: --handsearch a px,py,pz fx,fy,fz [walk]
  const i = process.argv.indexOf('--handsearch');
  const a = Number(process.argv[i + 1]);
  const want = (s) => norm3(s.split(',').map(Number));
  const P = want(process.argv[i + 2]), F = want(process.argv[i + 3]);
  const isWalk = process.argv.includes('walk');
  const t = isWalk ? wrap01(a + W_TD.right) * WALK_LEN : wrap01(a) * SM_LEN;
  const D = isWalk ? walkDyn(t) : smashDyn(t);
  const res = [];
  for (let fl = -80; fl <= 70; fl += 5) for (let tw = -70; tw <= 70; tw += 5) for (let sd = -40; sd <= 40; sd += 10) {
    const D2 = { ...D, arm: { ...D.arm, left: { ...D.arm.left, hand: [fl, tw, sd] } } };
    const p = buildPose(D2);
    const H = boneFrame(p, 'hand_left').R;
    const palm = [-H[2], -H[5], -H[8]], fing = [-H[1], -H[4], -H[7]];
    const sc = (palm[0] * P[0] + palm[1] * P[1] + palm[2] * P[2]) + (fing[0] * F[0] + fing[1] * F[1] + fing[2] * F[2]);
    const loc = unwrapTrack('hand_left', [p.getRot('hand_left')])[0];
    const hl = limitsOf('hand_left');
    const over = ['x', 'y', 'z'].reduce((s2, k, j) => s2 + Math.max(0, hl[k][0] - loc[j], loc[j] - hl[k][1]), 0);
    if (over < 0.01) res.push({ h: [fl, tw, sd], sc, palm, fing, loc });
  }
  res.sort((x, y) => y.sc - x.sc);
  const f = (v) => v.map((x) => x.toFixed(2).padStart(6)).join('');
  console.log('current hand', D.arm.left.hand.map((x) => x.toFixed(0)).join(','));
  res.slice(0, 8).forEach((r) => console.log('hand', r.h.join(','), ' score', r.sc.toFixed(2), ' palm', f(r.palm), ' fing', f(r.fing), ' local', f(r.loc)));
} else if (process.argv.includes('--polesearch')) {
  // diagnostic: for the LEFT arm at arm phase a (smash: local arm phase; walk: arm phase b), sweep elbow pole
  // directions (world) and list those whose upper-arm rotation stays inside the joint limits, with the elbow position
  const a = Number(process.argv[process.argv.indexOf('--polesearch') + 1] || 0);
  const isWalk = process.argv.includes('walk');
  const t = isWalk ? wrap01(a + W_TD.right) * WALK_LEN : wrap01(a) * SM_LEN;
  const D = isWalk ? walkDyn(t) : smashDyn(t);
  const lim = limitsOf('arm_left_upper');
  const rows = [];
  for (let th = 0; th < 360; th += 20) for (let ph = -80; ph <= 80; ph += 20) {
    const pole = [Math.cos(ph * Math.PI / 180) * Math.sin(th * Math.PI / 180), Math.sin(ph * Math.PI / 180), Math.cos(ph * Math.PI / 180) * Math.cos(th * Math.PI / 180)];
    const D2 = { ...D, arm: { ...D.arm, left: { ...D.arm.left, pole, poleChest: undefined } } };
    const p = buildPose(D2);
    const u = unwrapTrack('arm_left_upper', [p.getRot('arm_left_upper')])[0];
    const over = ['x', 'y', 'z'].reduce((s, k, j) => s + Math.max(0, lim[k][0] - u[j], u[j] - lim[k][1]), 0);
    const E = boneFrame(p, 'arm_left_lower').p;
    rows.push({ pole, u, over, E });
  }
  const byX = process.argv.includes('--byx');
  rows.sort((x, y) => (byX ? (x.over > 0.5) - (y.over > 0.5) || y.E[0] - x.E[0] : x.over - y.over || Math.abs(x.u[1]) - Math.abs(y.u[1])));
  const f = (v) => v.map((x) => x.toFixed(1).padStart(7)).join('');
  console.log('wrist', f(D.arm.left.wrist), ' current pole', f(D.arm.left.pole || D.arm.left.poleChest));
  rows.slice(0, 40).forEach((r) => console.log('pole', f(r.pole), ' upper', f(r.u), ' over', r.over.toFixed(1).padStart(6), ' elbow', f(r.E)));
} else if (process.argv.includes('--speed')) {
  // true local angular speed (deg per 1/60 s) per bone from the pose functions (before baking)
  const isWalk = process.argv.includes('walk');
  const LEN = isWalk ? WALK_LEN : SM_LEN, poseFn = isWalk ? walkPose : smashPose;
  const secPer = isWalk ? 1 / 1.75 : 1; // walk: anim units are blocks (~1.75 b/s)
  const N = Math.round((LEN * secPer) * 60);
  const ang = (A, B) => { const R = mul3(transpose3(A), B); return Math.acos(Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2))) * 180 / Math.PI; };
  let prev = poseFn(0);
  const worst = {};
  for (let i = 1; i <= N; i++) {
    const t = (LEN * i) / N, cur = poseFn(t);
    for (const b of Object.keys(cur.b)) {
      const v = ang(boneRotation(prev.getRot(b)), boneRotation(cur.getRot(b)));
      if (!worst[b] || v > worst[b].v) worst[b] = { v, t };
    }
    prev = cur;
  }
  Object.entries(worst).sort((a, b) => b[1].v - a[1].v).slice(0, 8).forEach(([b, w]) => console.log(b.padEnd(18), w.v.toFixed(1), 'at', w.t.toFixed(3)));
} else if (process.argv.includes('--scan')) {
  const side = process.argv[process.argv.indexOf('--scan') + 1] || 'left';
  const isWalk = process.argv.includes('walk');
  const LEN = isWalk ? WALK_LEN : SM_LEN, dynFn = isWalk ? walkDyn : smashDyn;
  const fmt = (v, d = 0) => v.map((x) => x.toFixed(d).padStart(d ? 6 : 5)).join(',');
  const rows = [];
  for (let i = 0; i <= 50; i++) {
    const t = (LEN * i) / 50;
    const D = dynFn(t), p = buildPose(D), A = D.arm[side];
    const S = boneFrame(p, `arm_${side}_upper`).p, H = boneFrame(p, `hand_${side}`).R;
    const claw = pointOn(p, `hand_${side}`, side === 'right' ? [-15.5, 12, -10.25] : [15.5, 12, -10.25]);
    rows.push({ a: A.a, reach: Math.hypot(...sub3(A.wrist, S)), up: p.getRot(`arm_${side}_upper`), el: p.getRot(`arm_${side}_lower`)[0], hand: p.getRot(`hand_${side}`), palm: [-H[2], -H[5], -H[8]], fing: [-H[1], -H[4], -H[7]], claw });
  }
  const ups = unwrapTrack(`arm_${side}_upper`, rows.map((r) => r.up));
  const lim = limitsOf(`arm_${side}_upper`);
  rows.forEach((r, i) => {
    const u = ups[i];
    const bad = ['x', 'y', 'z'].some((k, j) => u[j] < lim[k][0] || u[j] > lim[k][1]) ? ' !!' : '';
    console.log(`a=${r.a.toFixed(2)} reach ${r.reach.toFixed(1).padStart(5)} up ${fmt(u)} el ${r.el.toFixed(0).padStart(4)} hand ${fmt(r.hand)} palm ${fmt(r.palm, 2)} fing ${fmt(r.fing, 2)} claw ${fmt(r.claw, 1)}${bad}`);
  });
} else if (process.argv.includes('--probe')) {
  const t = Number(process.argv[process.argv.indexOf('--probe') + 1] || 0);
  const p = smashPose(t);
  for (const b of ['body', 'chest', 'neck', 'head', 'arm_right_upper', 'arm_left_upper', 'hand_right', 'hand_left']) {
    console.log(b.padEnd(16), boneFrame(p, b).p.map((v) => v.toFixed(1)).join(', '), JSON.stringify(p.getRot(b).map((v) => +v.toFixed(1))));
  }
  for (const s of SIDES) {
    const A = smashDyn(t).arm[s];
    const S = boneFrame(p, `arm_${s}_upper`).p;
    const H = boneFrame(p, `hand_${s}`).R;
    const fmt = (v) => v.map((x) => x.toFixed(2)).join(',');
    console.log(s, 'palm(-Z) ->', fmt([-H[2], -H[5], -H[8]]), ' fingers(-Y) ->', fmt([-H[1], -H[4], -H[7]]));
    console.log(s, 'reach', Math.hypot(...sub3(A.wrist, S)).toFixed(1), '/ 34', 'claw', pointOn(p, `hand_${s}`, s === 'right' ? [-15.5, 12, -10.25] : [15.5, 12, -10.25]).map((v) => v.toFixed(1)).join(', '));
  }
} else {
  writeJSON(OUT, file);
  console.log(`wrote ${path.relative(ADDON_ROOT, OUT)}`);
}
