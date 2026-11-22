#!/usr/bin/env node
// Evaluate the shipped client pose for given synchronised properties, in the offline Molang runtime, and write
// it as a static pose (for render.cjs --pose).  The script side is imitated just enough: time passes, he covers
// ground at a speed, and the foot that landed last is named as the server would name it.
//   node pose_eval.mjs <1..4> '{"phase":1,"charge":0,...}' [--walk blocks] [--speed b/s] [--seconds s] [--pt s] > pose.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expr, stmt, makeVars } from './lib/molang.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RP = path.join(HERE, '../../packs/RP');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const form = parseInt(args[0], 10), tag = ['', 'i', 'ii', 'iii', 'iv'][form];
const given = JSON.parse(args[1] || '{}');
const walk = parseFloat(opt('walk', '0')), speed = parseFloat(opt('speed', '3')), seconds = parseFloat(opt('seconds', '3'));
const half = { 3: 11.9 / 4, 4: 7 }[form] ?? 1, beats = form === 4 ? 2 : 4;

const desc = JSON.parse(fs.readFileSync(path.join(RP, 'entity/basiliskra.entity.json'), 'utf8'))['minecraft:client_entity'].description;
const anim = JSON.parse(fs.readFileSync(path.join(RP, 'animations/basiliskra.animation.json'), 'utf8')).animations[`animation.basiliskra.${tag}.pose`];
const props = { form, bound: 1, phase: 0, charge: 0, look_yaw: 0, look_pitch: 0, bend: 0, pitch: 0, gait: 0, gill: 0, fx_kind: 0, fx_seq: 0, tier: 1, vis_lo: 0, vis_hi: 8 };
const st = { t: 0, dt: 1 / 30, dist: 0, speed: 0 };
const Q = {
  life_time: () => st.t, delta_time: () => st.dt, anim_time: () => st.t,
  property: (n) => props[n.replace('basiliskra:', '')] ?? 0,
  modified_distance_moved: () => st.dist, ground_speed: () => st.speed, modified_move_speed: () => st.speed / 20,
};
const V = makeVars();
for (const s of desc.scripts.initialize) stmt(s)(Q, V);
const pre = desc.scripts.pre_animation.map((s) => stmt(s));
const step = () => { st.t += st.dt; for (const f of pre) f(Q, V); };
// settle standing, then walk (phase "move"), then hold the asked-for state
for (let i = 0; i < 30; i++) step();
if (walk > 0) {
  props.phase = 1; st.speed = speed;
  let landed = 0;
  while (st.dist < walk) {
    st.dist += speed * st.dt;
    if (st.dist >= (landed + 1) * half) { landed++; props.gait = landed % beats; }
    step();
  }
  st.speed = 0;
}
Object.assign(props, given);
for (let i = 0; i < Math.round(seconds * 30); i++) step();
const out = {};
for (const [bone, ch] of Object.entries(anim.bones)) {
  const vec = (v, d) => (v == null ? undefined : (Array.isArray(v) ? v : [v, v, v]).map((e) => +expr(e)(Q, V).toFixed(3)));
  out[bone] = { rot: vec(ch.rotation), pos: vec(ch.position), scl: vec(ch.scale) };
}
process.stdout.write(JSON.stringify(out));
