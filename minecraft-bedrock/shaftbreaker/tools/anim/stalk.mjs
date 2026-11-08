#!/usr/bin/env node
// stalk.mjs: generator for the Shaftbreaker STALKING animations (Minecraft Bedrock add-on).
//   writes Shaftbreaker_RP/animations/shaftbreaker.stalking.animation.json
//     animation.shaftbreaker.stalk_idle   (time-driven loop)
//     animation.shaftbreaker.stalk_walk   (distance-driven loop: anim time = blocks moved)
// Run from minecraft-bedrock/shaftbreaker:  node tools/anim/stalk.mjs
// Never hand-edit the JSON: change this file (or lib_stalk.mjs) and regenerate. Deterministic output.
import fs from 'node:fs';
import path from 'node:path';
import {
  ADDON_ROOT, Pose, bake, setLeg, localFor,
} from './lib_stalk.mjs';

const OUT = path.join(ADDON_ROOT, 'Shaftbreaker_RP/animations/shaftbreaker.stalking.animation.json');

// ============================================================================================ base stalking pose
const BASE = {
  body: { pos: [0, -5, 2.5], rot: [15, 0, 0] },
  waist: [12, 0, 0],
  chest: [14, 0, 0],
  neck: { rot: [-12, 0, 0], pos: [0, 1, -3.5] },
  maneR: [0, 0, 6],
  maneL: [0, 0, -6],
  headWorld: [-2, 0, 0],
  jaw: [1.5, 0, 0],
  armR: { rot: [-48, 0, 20], pos: [0, 1, 0] },
  armL: { rot: [-56, 0, -18], pos: [0, 1, 0] },
  elbowR: [-26, 0, 0],
  elbowL: [-30, 0, 0],
  handR: [12, -50, 0],
  handL: [10, 50, 0],
  feet: { R: [-7, 7], L: [7, -7] },
};
const FINGERS = ['1', '2', '3', '4'];

function basePose() {
  const p = new Pose();
  p.pos('body', BASE.body.pos).rot('body', BASE.body.rot);
  p.rot('waist', BASE.waist).rot('chest', BASE.chest).rot('neck', BASE.neck.rot).pos('neck', BASE.neck.pos);
  p.rot('jaw', BASE.jaw);
  p.rot('mane_right', BASE.maneR).rot('mane_left', BASE.maneL);
  p.rot('arm_right_upper', BASE.armR.rot).pos('arm_right_upper', BASE.armR.pos);
  p.rot('arm_left_upper', BASE.armL.rot).pos('arm_left_upper', BASE.armL.pos);
  p.rot('arm_right_lower', BASE.elbowR).rot('arm_left_lower', BASE.elbowL);
  p.rot('hand_right', BASE.handR).rot('hand_left', BASE.handL);
  const curlA = { 1: -30, 2: -24, 3: -26, 4: -32 };
  const curlB = { 1: -34, 2: -30, 3: -32, 4: -38 };
  for (const f of FINGERS) {
    p.rot(`finger_right_${f}_a`, [curlA[f], 0, 0]).rot(`finger_right_${f}_b`, [curlB[f], 0, 0]);
    p.rot(`finger_left_${f}_a`, [curlA[f] - 3, 0, 0]).rot(`finger_left_${f}_b`, [curlB[f] - 2, 0, 0]);
  }
  p.rot('thumb_right_a', [-16, 0, 0]).rot('thumb_right_b', [-26, 0, 0]);
  p.rot('thumb_left_a', [-18, 0, 0]).rot('thumb_left_b', [-28, 0, 0]);
  return p;
}

function finishHead(p, world) {
  p.setRot('head', localFor(p, ['body', 'waist', 'chest', 'neck'], world));
}

// ============================================================================================ stalk_idle
const IDLE_LEN = 6.4;
function idlePose(t) {
  const p = basePose();
  finishHead(p, BASE.headWorld);
  setLeg(p, 'right', [BASE.feet.R[0], 6, BASE.feet.R[1]], [0, 8, 0]);
  setLeg(p, 'left', [BASE.feet.L[0], 6, BASE.feet.L[1]], [0, -8, 0]);
  void t;
  return p;
}

// ============================================================================================ write
const file = {
  format_version: '1.8.0',
  animations: {
    'animation.shaftbreaker.stalk_idle': {
      loop: true,
      animation_length: IDLE_LEN,
      bones: bake(IDLE_LEN, 64, idlePose),
    },
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n');
console.log('wrote', path.relative(ADDON_ROOT, OUT));
