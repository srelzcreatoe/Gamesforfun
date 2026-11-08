#!/usr/bin/env node
// dormant.mjs: deterministic generator for the Shaftbreaker "dormant" animation group.
//   node tools/anim/dormant.mjs            (run from minecraft-bedrock/shaftbreaker)
// Writes (never hand-edit these, regenerate):
//   Shaftbreaker_RP/animations/shaftbreaker.dormant.animation.json    animation.shaftbreaker.dormant, .look_at
//   Shaftbreaker_RP/animations/shaftbreaker.watching.animation.json   animation.shaftbreaker.watch
//
// All values follow SPEC.md section 2 (Bedrock FILE convention): hip flexion -X, knee +X (>= 0), shoulder flexion -X,
// elbow -X (<= 0), finger curl -X, jaw open +X, torso hunch +X, +Y turns the front toward the creature's RIGHT (-X),
// right limb +Z = abduction, left limb -Z = abduction. Legs are solved with tools/lib/legik.mjs at every sample.
import path from 'node:path';
import {
  ANIM_DIR, clamp, lerp, smooth, smoother, easeOut, pulse, shudder, breath, add3, scale3, mirror3,
  solveLegs, bakeAnimation, writeAnimationFile, keyStats,
} from './lib_dormant.mjs';

const ORDER = [
  'root', 'body', 'waist', 'chest', 'mane_front', 'mane_back', 'mane_left', 'mane_right', 'neck', 'head', 'jaw',
  'arm_right_upper', 'arm_right_lower', 'hand_right',
  'finger_right_1_a', 'finger_right_1_b', 'finger_right_2_a', 'finger_right_2_b', 'finger_right_3_a', 'finger_right_3_b',
  'finger_right_4_a', 'finger_right_4_b', 'thumb_right_a', 'thumb_right_b',
  'arm_left_upper', 'arm_left_lower', 'hand_left',
  'finger_left_1_a', 'finger_left_1_b', 'finger_left_2_a', 'finger_left_2_b', 'finger_left_3_a', 'finger_left_3_b',
  'finger_left_4_a', 'finger_left_4_b', 'thumb_left_a', 'thumb_left_b',
  'leg_right_upper', 'leg_right_lower', 'foot_right', 'leg_left_upper', 'leg_left_lower', 'foot_left',
];

// ------------------------------------------------------------------------------------------- pose helpers
const Z = () => [0, 0, 0];
function clonePose(p) {
  const o = {};
  for (const [b, v] of Object.entries(p)) o[b] = { rotation: v.rotation ? v.rotation.slice() : undefined, position: v.position ? v.position.slice() : undefined };
  return o;
}
function rot(P, bone, v) { (P[bone] ||= {}).rotation = add3(P[bone].rotation || Z(), v); }
function pos(P, bone, v) { (P[bone] ||= {}).position = add3(P[bone].position || Z(), v); }
// a hand description for the RIGHT side; left = mirror with its own overrides
function handPose(side, h) {
  const out = {};
  const m = side === 'right' ? (v) => v : mirror3;
  out[`arm_${side}_upper`] = { rotation: m(h.upper) };
  out[`arm_${side}_lower`] = { rotation: m(h.lower) };
  out[`hand_${side}`] = { rotation: m(h.hand) };
  for (let i = 1; i <= 4; i++) {
    out[`finger_${side}_${i}_a`] = { rotation: m(h.fingers[i - 1][0]) };
    out[`finger_${side}_${i}_b`] = { rotation: m(h.fingers[i - 1][1]) };
  }
  out[`thumb_${side}_a`] = { rotation: m(h.thumb[0]) };
  out[`thumb_${side}_b`] = { rotation: m(h.thumb[1]) };
  return out;
}

// ============================================================================================ DORMANT
// "Stands unnaturally still, staring forward in silence." Upright, A-pose arms with the claws hanging in a loose cage,
// feet planted a little wider than the hips. Only uncanny micro-motion: an irregular, barely visible breath that the
// head does NOT follow (it stays locked on its stare), two sharp 2-degree head jolts that creep back, sudden tiny
// finger twitches (different hands, different fingers, never symmetric) and a faint rattle of the mane spikes.
// Hands (dormant_hands.png): the palm is turned in toward the thigh (forearm -20 + wrist -42 deg of Y, mirrored on the
// left) and every knuckle is bent a little more (-8..-12 / -13..-16), so the model's built-in claw hook, which curls
// toward the palm, reads from the front as the art's inward-hooking cage. 12.5-13 deg of shoulder abduction keeps the
// claw tips >= 2 units clear of the shins (thumb included) through the whole loop, twitches included.
const D_LEN = 8.0;
const D_FEET = {
  right: { ground: [-9.25, -0.5], yaw: 7 },
  left: { ground: [9, 0.25], yaw: -5 },
};
const D_HAND_R = {
  upper: [-1.5, 0, 12.5],
  lower: [-5, -20, 5],
  hand: [0, -42, 2],
  fingers: [
    [[-10, 2, -3], [-14, 0, 0]],
    [[-9, 0, -1], [-13, 0, 0]],
    [[-8, 0, 2], [-15, 0, 0]],
    [[-11, -2, 5], [-16, 0, 0]],
  ],
  thumb: [[-12, 0, -6], [-10, 0, 0]],
};
const D_HAND_L = {
  upper: [-1, 0, 13],
  lower: [-6, -18, 4.5],
  hand: [1, -44, 2],
  fingers: [
    [[-9, 2, -3], [-15, 0, 0]],
    [[-10, 0, -1], [-12, 0, 0]],
    [[-7, 0, 2], [-16, 0, 0]],
    [[-12, -2, 4], [-14, 0, 0]],
  ],
  thumb: [[-13, 0, -6], [-9, 0, 0]],
};
const D_BASE = {
  root: { position: [0, 0, 0] },
  body: { rotation: [0, 0, 0], position: [0, -0.45, 0] },
  waist: { rotation: [0, 0, 0] },
  chest: { rotation: [0.5, 0, 0], position: [0, 0, 0] },
  neck: { rotation: [0, 0, 0] },
  head: { rotation: [-0.5, 0, 0] },
  mane_front: { rotation: [0, 0, 0] },
  mane_back: { rotation: [0, 0, 0] },
  mane_left: { rotation: [0, 0, 0] },
  mane_right: { rotation: [0, 0, 0] },
  ...handPose('right', D_HAND_R),
  ...handPose('left', D_HAND_L),
};
const D_BREATHS = [
  { start: 0.55, inhale: 1.35, hold: 0.35, exhale: 2.15, depth: 1.0 },
  { start: 4.6, inhale: 1.15, hold: 0.2, exhale: 2.3, depth: 0.8 },
];

function dormantPose(t) {
  const L = D_LEN;
  const P = clonePose(D_BASE);
  const br = (lag = 0) => breath(t - lag, L, D_BREATHS);

  // --- breathing: ribcage lifts and opens, waist barely follows, mane spikes ride it with a little lag
  const b = br(), b2 = br(0.18), b3 = br(0.3);
  rot(P, 'chest', [-0.55 * b, 0, 0]);
  pos(P, 'chest', [0, 0.12 * b, 0]);
  rot(P, 'waist', [-0.2 * b, 0, 0]);
  rot(P, 'mane_front', [-0.7 * b2, 0, 0]);
  rot(P, 'mane_back', [0.5 * b2, 0, 0]);
  rot(P, 'mane_left', [0, 0, -0.6 * b3]);
  rot(P, 'mane_right', [0, 0, 0.6 * b3]);
  // the arms hang like dead weight: they swing a touch late against the ribcage pitch
  rot(P, 'arm_right_upper', [0.55 * br(0.35), 0, 0.15 * b2]);
  rot(P, 'arm_left_upper', [0.5 * br(0.4), 0, -0.15 * b2]);
  // the stare is LOCKED: the neck/head cancel the ribcage motion exactly (uncanny, bird-like stabilisation)
  rot(P, 'neck', [0.75 * b, 0, 0]);

  // --- head jolt 1 (t 2.35): a sudden 2 deg twitch toward its right with a hint of roll, holds, then creeps back
  const j1 = pulse(t, L, 2.35, 0.06, 1.05, 1.7);
  rot(P, 'head', [0.3 * j1, 2.0 * j1, -0.7 * j1]);
  rot(P, 'neck', [0, 0.35 * pulse(t, L, 2.4, 0.12, 0.9, 1.8), 0]);
  // --- head jolt 2 (t 5.75): a sharp little drop and tilt to its left, quicker return
  const j2 = pulse(t, L, 5.75, 0.05, 0.55, 1.25);
  rot(P, 'head', [1.6 * j2, -0.6 * j2, 1.2 * j2]);
  rot(P, 'neck', [0.3 * pulse(t, L, 5.8, 0.1, 0.45, 1.3), 0, 0]);
  // the stone mane rattles after each jolt (damped, a few frames late)
  for (const [m, s] of [['mane_left', 1], ['mane_right', -1], ['mane_front', 0.6], ['mane_back', -0.5]]) {
    const r = shudder(t, L, 2.42, 0.45, 8, 0.9) + shudder(t, L, 5.82, 0.4, 9, 0.7);
    rot(P, m, m === 'mane_front' || m === 'mane_back' ? [r * s, 0, 0] : [0, 0, r * s]);
  }
  // jaw: sealed (0.3 deg keeps catmullrom undershoot above the 0 deg jaw limit); a tiny grinding click with jolt 1
  rot(P, 'jaw', [0.3 + 0.6 * pulse(t, L, 2.33, 0.05, 0.1, 0.25), 0, 0]);

  // --- finger twitches (sudden curl, slow release); never both hands at once
  const tw = (t0, a, h, r) => pulse(t, L, t0, a, h, r);
  const r3 = tw(1.15, 0.05, 0.12, 0.65), r2 = tw(1.19, 0.06, 0.08, 0.6);
  rot(P, 'finger_right_3_a', [-7 * r3, 0, 0]);
  rot(P, 'finger_right_3_b', [-9 * r3, 0, 0]);
  rot(P, 'finger_right_2_a', [-3 * r2, 0, 0]);
  rot(P, 'finger_right_2_b', [-3.5 * r2, 0, 0]);
  rot(P, 'hand_right', [-0.8 * tw(1.17, 0.07, 0.1, 0.7), 0, 0]);
  const l1 = tw(4.05, 0.06, 0.1, 0.55), lt = tw(4.09, 0.06, 0.12, 0.6);
  rot(P, 'finger_left_1_a', [-6 * l1, 0, 0]);
  rot(P, 'finger_left_1_b', [-6 * l1, 0, 0]);
  rot(P, 'thumb_left_a', [-5 * lt, 0, 0]);
  rot(P, 'thumb_left_b', [-4 * lt, 0, 0]);
  // a double flick of the right outer claw late in the loop
  const d1 = tw(6.7, 0.05, 0.04, 0.22), d2 = tw(6.98, 0.05, 0.06, 0.45);
  rot(P, 'finger_right_4_a', [-4 * (d1 + d2), 0, 0]);
  rot(P, 'finger_right_4_b', [-5 * (d1 + d2), 0, 0]);
  rot(P, 'finger_right_1_b', [-2.5 * tw(6.75, 0.06, 0.05, 0.5), 0, 0]);

  // --- legs: feet stay planted flat exactly where they are, whatever the pelvis does
  Object.assign(P, solveLegs({ root: P.root, body: P.body }, D_FEET));
  return P;
}

// ============================================================================================ LOOK_AT
// Pure Molang additive layer (weight = variable.look_weight from the client entity: 0 in dormant, 1 elsewhere).
// Signs follow vanilla look_at_target (rotation [target_x, target_y, 0] on the head): +target_x = look down
// (+X pitches the head forward), +target_y = turn toward the creature's right (+Y). Clamped (pitch -24..30, yaw +-50),
// 35 % on the neck, 65 % on the head.
// The tall stone collar sits round the skull, and every phase except dormant already holds the head tipped back over a
// hunched chest, so looking UP or far to the SIDE would grind the skull into the spikes. Like a vulture, it cranes:
//   * the neck slides up out of the collar (position in chest space, so "up" is up-and-forward when hunched):
//     0.11 per degree of up-pitch + 0.065 per degree of yaw, capped at 5 units;
//   * the side spikes flare away from the turning skull (0.22 deg per deg of yaw, <= 11 deg) and the back spikes lay
//     back when it looks up (0.4 deg per deg, <= 9.6 deg).
// Tested (tools/_scratch/anim_dormant/critic/lookeval.mjs) over watch, stalk_idle, frenzy_idle and breaker_smash at
// 11 target directions incl. up+side corners: the worst skull-vs-collar overlap this layer ADDS is 0.7 units (stalk_idle,
// 20 up + 40 side), versus 4 units with plain clamped rotations.
const LOOK = { up: 24, down: 30, yaw: 50, neck: 0.35, liftUp: 0.11, liftYaw: 0.065, liftMax: 5, flareYaw: 0.22, layBack: 0.4 };
function lookAt() {
  const L = LOOK;
  const px = `math.clamp(query.target_x_rotation, ${-L.up}, ${L.down})`;
  const py = `math.clamp(query.target_y_rotation, ${-L.yaw}, ${L.yaw})`;
  const up = `math.max(0.0, -${px})`;
  const ay = `math.abs(${py})`;
  const hs = +(1 - L.neck).toFixed(2);
  return {
    loop: true,
    bones: {
      mane_back: { rotation: [`${up} * ${-L.layBack}`, 0, 0] },
      mane_left: { rotation: [0, 0, `${ay} * ${L.flareYaw}`] },
      mane_right: { rotation: [0, 0, `${ay} * ${-L.flareYaw}`] },
      neck: {
        rotation: [`${px} * ${L.neck}`, `${py} * ${L.neck}`, 0],
        position: [0, `math.min(${up} * ${L.liftUp} + ${ay} * ${L.liftYaw}, ${L.liftMax})`, 0],
      },
      head: { rotation: [`${px} * ${hs}`, `${py} * ${hs}`, 0] },
    },
  };
}

// ============================================================================================ WATCH
// "Observes from a distance, partly turned and on edge." Hips turned 40 deg to its left and the torso twisted 18 deg
// further (shoulders ~58 deg, which is what watch_full.png shows from the front), head and neck twisted back to stare
// straight at the viewer, weight on the left leg (left hip up, right hip dropped, right knee soft), near-upright with
// a slight hunch (24 deg spread over body/waist/chest). The head is craned up and forward out of the collar (neck
// position offset) so the face, both rows of teeth and the chin stay clear of the spikes (>= 1 unit through the loop);
// its tilt (~15 deg toward its left) mostly comes from the twisted, leaning torso, so the head's own roll is small.
// The arms hang plumb in the world (shoulder flexion cancels the hunch), the near claws >= 2.8 units off the shin. Tense claws that ripple and twitch, an occasional sharp bird-like head tilt that
// bristles the mane, a quick glance, and a weight re-settle; quicker, shallower breathing than dormant.
const W_LEN = 6.0;
const W_ROOT_YAW = -40;
const yawXZ = (x, z, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c * x + s * z, -s * x + c * z]; };
// stance-frame offset -> entity-space root position (root position is applied in the entity frame, before its yaw)
const stancePos = (x, y, z) => { const [ex, ez] = yawXZ(x, z, W_ROOT_YAW); return [ex, y, ez]; };
// feet given in the turned stance frame, rotated into entity space: left (weighted) under its hip, right (free) out
// to the side and a little back, toes turned out
const W_FEET = (() => {
  const r = yawXZ(-11, 3.0, W_ROOT_YAW), l = yawXZ(5.75, 0.25, W_ROOT_YAW);
  return { right: { ground: r, yaw: W_ROOT_YAW + 12 }, left: { ground: l, yaw: W_ROOT_YAW - 4 } };
})();
const W_HAND_R = { // near arm: hangs plumb, just forward of the thigh, palm turned in, claws tense and hooked inward
  upper: [-20, 0, 9.5],
  lower: [-11, -22, 3],
  hand: [-2, -36, 2],
  fingers: [
    [[-9, 3, -4], [-12, 0, 0]],
    [[-8, 0, -2], [-12, 0, 0]],
    [[-7, 0, 2], [-13, 0, 0]],
    [[-10, -3, 5], [-14, 0, 0]],
  ],
  thumb: [[-11, 0, -8], [-9, 0, 0]],
};
const W_HAND_L = { // far arm: hangs plumb a little further forward, elbow softer
  upper: [-24, 0, 8.5],
  lower: [-16, -18, 3],
  hand: [0, -36, 2],
  fingers: [
    [[-10, 3, -3], [-13, 0, 0]],
    [[-8, 0, -1], [-11, 0, 0]],
    [[-6, 0, 2], [-14, 0, 0]],
    [[-11, -3, 4], [-12, 0, 0]],
  ],
  thumb: [[-12, 0, -8], [-8, 0, 0]],
};
const W_BASE = {
  // pelvis shifted over the left (weighted) foot, along the turned stance's left axis
  root: { rotation: [0, W_ROOT_YAW, 0], position: stancePos(1.3, 0, 0) },
  body: { rotation: [5, -5, -4], position: [0, -1.2, 0] },
  waist: { rotation: [5, -6, 2] },
  chest: { rotation: [14, -7, 4], position: [0, 0, 0] },
  // the head is craned up and forward OUT of the collar (stone neck vertebrae slide: position offset), turned back
  // toward the viewer: total face yaw ~0 (root -40, torso -18, neck +21, head +37)
  neck: { rotation: [12, 21, -3], position: [0, 1.6, -1.6] },
  head: { rotation: [-25, 37, -7] },
  jaw: { rotation: [0.4, 0, 0] },
  // on edge: the collar spikes stand slightly raised the whole time
  mane_front: { rotation: [-2, 0, 0] },
  mane_back: { rotation: [-3, 0, 0] },
  mane_left: { rotation: [0, 0, 4] },
  mane_right: { rotation: [0, 0, -4] },
  ...handPose('right', W_HAND_R),
  ...handPose('left', W_HAND_L),
};
const W_BREATHS = [
  { start: 0.2, inhale: 0.75, hold: 0.1, exhale: 1.2, depth: 1.0 },
  { start: 2.35, inhale: 0.6, hold: 0.05, exhale: 1.05, depth: 0.7 },
  { start: 4.15, inhale: 0.8, hold: 0.15, exhale: 1.15, depth: 0.9 },
];

function watchPose(t) {
  const L = W_LEN;
  const P = clonePose(W_BASE);
  const br = (lag = 0) => breath(t - lag, L, W_BREATHS);
  const b = br(), b2 = br(0.15);
  rot(P, 'chest', [-0.8 * b, 0, 0]);
  pos(P, 'chest', [0, 0.15 * b, 0]);
  rot(P, 'waist', [-0.3 * b, 0, 0]);
  rot(P, 'mane_front', [-0.8 * b2, 0, 0]);
  rot(P, 'mane_back', [0.6 * b2, 0, 0]);
  rot(P, 'mane_left', [0, 0, -0.6 * b2]);
  rot(P, 'mane_right', [0, 0, 0.6 * b2]);
  rot(P, 'neck', [0.7 * b, 0, 0]);

  // --- weight re-settle (t 3.0): it eases a little more onto the left leg, then drifts back (feet stay planted)
  const ws = pulse(t, L, 2.9, 0.7, 0.6, 1.5, smooth, smoother);
  pos(P, 'root', stancePos(0.6 * ws, -0.25 * ws, 0));
  rot(P, 'body', [0, 0, -1.2 * ws]);
  rot(P, 'chest', [0, 0, 0.8 * ws]);
  rot(P, 'arm_right_upper', [0, 0, 0.6 * pulse(t, L, 3.05, 0.8, 0.5, 1.5, smooth, smoother)]);
  rot(P, 'arm_left_upper', [0, 0, 0.8 * pulse(t, L, 3.1, 0.8, 0.5, 1.5, smooth, smoother)]);

  // --- sharp on-edge head tilt (t 1.55): snaps to a stronger tilt, the mane bristles, then it slowly rights itself
  const tilt = pulse(t, L, 1.55, 0.11, 0.85, 0.75);
  rot(P, 'head', [-2 * tilt, 3 * tilt, 9 * tilt]);
  const tiltN = pulse(t, L, 1.6, 0.16, 0.7, 0.85);
  rot(P, 'neck', [0, 1.5 * tiltN, 2.5 * tiltN]);
  const bristle = pulse(t, L, 1.62, 0.12, 0.6, 1.3);
  // side spikes splay AWAY from the skull (left +Z / right -Z), back and front spikes rise
  rot(P, 'mane_left', [0, 0, 2.5 * bristle]);
  rot(P, 'mane_right', [0, 0, -2.5 * bristle]);
  rot(P, 'mane_back', [-4 * bristle, 0, 0]);
  rot(P, 'mane_front', [-3 * bristle, 0, 0]);
  rot(P, 'chest', [-0.6 * pulse(t, L, 1.6, 0.15, 0.3, 0.9), 0, 0]);

  // --- quick glance (t 4.55): eyes flick to the creature's left and back (head only, then neck catches up a bit)
  const g = pulse(t, L, 4.55, 0.08, 0.32, 0.45);
  rot(P, 'head', [-1.5 * g, -6 * g, -1.5 * g]);
  rot(P, 'neck', [0, -1.5 * pulse(t, L, 4.62, 0.14, 0.2, 0.5), 0]);
  // tiny jaw click with the glance
  rot(P, 'jaw', [1.5 * pulse(t, L, 4.57, 0.05, 0.15, 0.3), 0, 0]);

  // --- tense claws: rippling curl waves (outer -> inner) at different times per hand, plus single twitches
  const ripple = (side, t0, amp, gap) => {
    for (let i = 4; i >= 1; i--) {
      const e = pulse(t, L, t0 + (4 - i) * gap, 0.07, 0.12, 0.45);
      rot(P, `finger_${side}_${i}_a`, [-amp * e, 0, 0]);
      rot(P, `finger_${side}_${i}_b`, [-amp * 1.2 * e, 0, 0]);
    }
  };
  ripple('right', 0.7, 6, 0.06);
  ripple('left', 3.4, 7, 0.07);
  ripple('right', 5.05, 4, 0.05);
  const tr = pulse(t, L, 2.45, 0.05, 0.08, 0.4);
  rot(P, 'finger_right_2_a', [-5 * tr, 0, 0]);
  rot(P, 'finger_right_2_b', [-6 * tr, 0, 0]);
  rot(P, 'thumb_right_a', [-4 * pulse(t, L, 2.5, 0.06, 0.1, 0.4), 0, 0]);
  const tl = pulse(t, L, 5.6, 0.05, 0.06, 0.35);
  rot(P, 'finger_left_3_a', [-6 * tl, 0, 0]);
  rot(P, 'finger_left_3_b', [-6 * tl, 0, 0]);
  // wrists flex a hair with the ripples
  rot(P, 'hand_right', [-1.5 * pulse(t, L, 0.72, 0.1, 0.2, 0.6), 0, 0]);
  rot(P, 'hand_left', [-1.5 * pulse(t, L, 3.42, 0.1, 0.25, 0.6), 0, 0]);

  Object.assign(P, solveLegs({ root: P.root, body: P.body }, W_FEET));
  return P;
}

// ============================================================================================ write
const dormant = bakeAnimation(dormantPose, { length: D_LEN, order: ORDER, rotTol: 0.03, posTol: 0.01 });
const watch = bakeAnimation(watchPose, { length: W_LEN, order: ORDER, rotTol: 0.04, posTol: 0.01 });
const f1 = writeAnimationFile(path.join(ANIM_DIR, 'shaftbreaker.dormant.animation.json'), {
  'animation.shaftbreaker.dormant': dormant,
  'animation.shaftbreaker.look_at': lookAt(),
});
const f2 = writeAnimationFile(path.join(ANIM_DIR, 'shaftbreaker.watching.animation.json'), {
  'animation.shaftbreaker.watch': watch,
});
for (const [n, a] of [['dormant', dormant], ['watch', watch]]) {
  const s = keyStats(a);
  console.log(`${n}: ${Object.keys(a.bones).length} bones, ${s.channels} channels, ${s.keys} keys`);
}
console.log('wrote', path.relative(process.cwd(), f1));
console.log('wrote', path.relative(process.cwd(), f2));
void [clamp, lerp, easeOut, scale3];
