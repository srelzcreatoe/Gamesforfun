// The numbers the game keeps about a model (mc/game.js HEAD_Y, JUMPSCARE_EYE_Y, JUMPSCARE_DIST; mc/puppets.js
// BODY_HEIGHT), measured from the built pack (packs/RP) at the entity's render scale, in blocks:
//
//   node tools/entities/measure.mjs [ids...]        default: every animatronic
//
//   standing    total height, width (across the arms / ears) and depth in the idle stance; eye height
//   jumpscare   eye height on the held (last) frame; how far the head's nearest point reaches in front of the
//               feet on the held frame and at its furthest during the lunge
//   slump, pose the same box for pose_2 and pose_1
// Same bone maths as the renderer (tools/render/bedrock_model.js); props held in a hand are not counted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../node_modules/three/build/three.module.js';
import { PNG } from '../node_modules/pngjs/lib/png.js';
import { buildModel, applyAnimation } from '../render/bedrock_model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALL = ['rustgrin', 'mirehop', 'noxbriar', 'purple_rat', 'cat', 'top_hat_rat', 'golden_dog'];
const PROPS = new Set(['microphone', 'guitar', 'right_maraca', 'left_maraca', 'right_cane']);
const HEAD = new Set(['head', 'jaw', 'hat', 'right_ear', 'left_ear']);
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r2 = (v) => Math.round(v * 100) / 100;

function eyePoint(id, geo) {
  const png = PNG.sync.read(fs.readFileSync(`${ROOT}/packs/RP/textures/entity/fnar/${id}_eyes.png`));
  for (const b of geo['minecraft:geometry'][0].bones) {
    for (const c of b.cubes ?? []) {
      const n = c.uv?.north;
      if (!n) continue;
      const [u, v] = n.uv, [us, vs] = n.uv_size;
      let hit = 0, sx = 0, sy = 0;
      for (let y = Math.floor(Math.min(v, v + vs)); y < Math.ceil(Math.max(v, v + vs)); y++) {
        for (let x = Math.floor(Math.min(u, u + us)); x < Math.ceil(Math.max(u, u + us)); x++) {
          if (png.data[(y * png.width + x) * 4 + 3] > 200) { hit++; sx += (x + 0.5 - u) / us; sy += (y + 0.5 - v) / vs; }
        }
      }
      if (hit) return { bone: b.name, pivot: b.pivot, p: [c.origin[0] + c.size[0] * (1 - sx / hit), c.origin[1] + c.size[1] * (1 - sy / hit), c.origin[2]] };
    }
  }
  throw new Error(`${id}: no eye pixels`);
}

/** Box of the posed model (blocks, model's front = +forward): { lo, hi } over all cubes, and over the head's. */
function boxes(M, S) {
  M.root.updateMatrixWorld(true);
  const all = new THREE.Box3(), head = new THREE.Box3();
  const v = new THREE.Vector3();
  M.root.traverse((m) => {
    if (!m.isMesh || PROPS.has(m.userData.bone)) return;
    const s = new THREE.Vector3();
    m.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    if (Math.abs(s.x) < 1e-3) return;
    const g = m.geometry.parameters;
    for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
      v.set(dx * g.width, dy * g.height, dz * g.depth).applyMatrix4(m.matrixWorld).multiplyScalar(S);
      all.expandByPoint(v);
      if (HEAD.has(m.userData.bone)) head.expandByPoint(v);
    }
  });
  return { all, head };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const out = {};
for (const id of ids) {
  const geo = readJ(`${ROOT}/packs/RP/models/entity/fnar_${id}.geo.json`);
  const anims = readJ(`${ROOT}/packs/RP/animations/fnar_${id}.animation.json`).animations;
  const S = Number(readJ(`${ROOT}/packs/RP/entity/fnar_${id}.entity.json`)['minecraft:client_entity'].description.scripts.scale);
  const M = buildModel(geo, null);
  const eye = eyePoint(id, geo);
  const A = (n) => anims[`animation.fnar.${id}.${n}`];
  const eyeAt = () => {
    M.root.updateMatrixWorld(true);
    const ev = new THREE.Vector3(-(eye.p[0] - eye.pivot[0]) / 16, (eye.p[1] - eye.pivot[1]) / 16, (eye.p[2] - eye.pivot[2]) / 16);
    M.bones.get(eye.bone).node.localToWorld(ev);
    return ev.multiplyScalar(S);
  };
  const res = { scale: S };
  // rest pose and the standing animations (averaged over the idle loop for the eye; the box is the largest seen)
  applyAnimation(M, null, 0);
  res.rest_height = r2(boxes(M, S).all.max.y);
  for (const [key, name] of [['standing', 'idle'], ['pose', 'pose_1'], ['slump', 'pose_2']]) {
    const a = A(name), len = a.animation_length ?? 0;
    let ey = 0, n = 0, top = 0, wide = 0, deep = 0, fwd = 0;
    for (let t = 0; t < len + 1e-6; t += 0.1) {
      applyAnimation(M, a, t);
      const e = eyeAt();
      const b = boxes(M, S).all;
      ey += e.y; n++;
      top = Math.max(top, b.max.y); wide = Math.max(wide, b.max.x - b.min.x); deep = Math.max(deep, b.max.z - b.min.z); fwd = Math.max(fwd, -b.min.z);
    }
    res[key] = { eye_y: r2(ey / n), height: r2(top), width: r2(wide), depth: r2(deep), front: r2(fwd) };
  }
  // the jumpscare: the held frame, and the furthest reach on the way
  const js = A('jumpscare'), len = js.animation_length;
  applyAnimation(M, js, len);
  const e = eyeAt();
  const held = boxes(M, S);
  let reach = 0, reachT = 0, low = 9;
  for (let t = 0; t <= len + 1e-6; t += 0.01) {
    applyAnimation(M, js, t);
    const b = boxes(M, S);
    if (-b.head.min.z > reach) { reach = -b.head.min.z; reachT = t; }
    low = Math.min(low, eyeAt().y);
  }
  res.jumpscare = { eye_y: r2(e.y), eye_forward: r2(-e.z), head_front: r2(-held.head.min.z), head_front_max: r2(reach), at: r2(reachT), body_front: r2(-held.all.min.z), height: r2(held.all.max.y), width: r2(held.all.max.x - held.all.min.x), eye_y_min: r2(low) };
  out[id] = res;
}
for (const [id, r] of Object.entries(out)) {
  console.log(`${id}  (scale ${r.scale}, rest pose ${r.rest_height} blocks tall)`);
  for (const k of ['standing', 'pose', 'slump', 'jumpscare']) console.log(`   ${k.padEnd(10)} ${Object.entries(r[k]).map(([a, b]) => `${a} ${b}`).join('  ')}`);
}
