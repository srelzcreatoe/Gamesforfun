// Hand / arm / prop clipping report for the animatronics' animations.
// Samples every animation of every character (packs/RP, same bone math as tools/render/bedrock_model.js),
// builds an oriented box per cube and measures how deep forearms, hands, fingers and props sink into the
// torso, waist, head, legs, the tail or the other arm (separating-axis depth, in model pixels). Overlaps that
// already exist in the rest pose (e.g. the shoulder joint) are subtracted.
//
//   node tools/entities/check_hands.mjs [--ids cat,purple_rat] [--anims pose_1] [--min 1.0] [--step 0.05] [--rp dir] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildModel, applyAnimation } from '../render/bedrock_model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IDS = ['rustgrin', 'mirehop', 'noxbriar', 'purple_rat', 'cat', 'top_hat_rat'];
const PROPS = { microphone: 'right', right_maraca: 'right', left_maraca: 'left', right_cane: 'right' };

/** Which part a bone belongs to. */
export function partOf(name) {
  for (const s of ['right', 'left']) {
    if (name === `${s}_arm`) return `${s}.upper`;
    if (name === `${s}_forearm`) return `${s}.fore`;
    if (name === `${s}_hand` || name.startsWith(`${s}_finger`) || name.startsWith(`${s}_thumb`)) return `${s}.hand`;
    if (name === `${s}_leg` || name === `${s}_shin` || name === `${s}_foot`) return `${s}.leg`;
  }
  if (PROPS[name]) return `${PROPS[name]}.prop`;
  if (name === 'guitar') return 'guitar';
  if (/^tail/.test(name)) return 'tail';
  if (['head', 'jaw', 'hat', 'right_ear', 'left_ear'].includes(name)) return 'head';
  if (name === 'torso') return 'torso';
  if (name === 'waist') return 'waist';
  return 'other';
}

// pairs (a, b) to test; a = moving arm part
function pairsFor(parts) {
  const out = [];
  for (const s of ['right', 'left']) {
    const o = s === 'right' ? 'left' : 'right';
    for (const a of ['fore', 'hand', 'prop']) {
      for (const b of ['torso', 'waist', 'head', 'tail', `${s}.leg`, `${o}.leg`, `${o}.upper`, `${o}.fore`, `${o}.hand`, `${o}.prop`]) out.push([`${s}.${a}`, b]);
    }
    out.push([`${s}.upper`, 'head']);
    out.push([`${s}.upper`, 'torso']);
    out.push([`${s}.fore`, `${s}.leg`]);
    out.push([`${s}.prop`, `${s}.upper`]);
    out.push([`${s}.prop`, `${s}.fore`]);
  }
  out.push(['right.fore', 'guitar'], ['left.fore', 'guitar']);
  // de-duplicate symmetric pairs (left.hand vs right.fore and right.fore vs left.hand)
  const seen = new Set();
  return out.filter(([a, b]) => { const k = [a, b].sort().join('|'); if (seen.has(k) || !parts.has(a) || !parts.has(b)) return false; seen.add(k); return true; });
}

/** World-space oriented boxes of every cube, grouped by part. */
function boxes(model) {
  model.root.updateMatrixWorld(true);
  const out = new Map();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  model.root.traverse((m) => {
    if (!m.isMesh) return;
    const part = partOf(m.userData.bone);
    m.matrixWorld.decompose(p, q, s);
    const g = m.geometry.parameters;
    const e = m.matrixWorld.elements;
    const axes = [new THREE.Vector3(e[0], e[1], e[2]).normalize(), new THREE.Vector3(e[4], e[5], e[6]).normalize(), new THREE.Vector3(e[8], e[9], e[10]).normalize()];
    const half = [g.width / 2 * s.x * 16, g.height / 2 * s.y * 16, g.depth / 2 * s.z * 16];
    if (half.some((h) => h < 0.02)) return; // hidden (scale 0) or degenerate
    const box = { c: p.clone().multiplyScalar(16), axes, half, bone: m.userData.bone };
    if (!out.has(part)) out.set(part, []);
    out.get(part).push(box);
  });
  return out;
}

/** SAT penetration depth of two oriented boxes (0 = apart). */
function depth(A, B) {
  const d = B.c.clone().sub(A.c);
  let best = Infinity;
  const test = (ax) => {
    const l = ax.length();
    if (l < 1e-6) return true;
    const n = ax.clone().divideScalar(l);
    let ra = 0, rb = 0;
    for (let i = 0; i < 3; i++) { ra += A.half[i] * Math.abs(A.axes[i].dot(n)); rb += B.half[i] * Math.abs(B.axes[i].dot(n)); }
    const ov = ra + rb - Math.abs(d.dot(n));
    if (ov <= 0) return false;
    best = Math.min(best, ov);
    return true;
  };
  for (const a of A.axes) if (!test(a)) return 0;
  for (const b of B.axes) if (!test(b)) return 0;
  for (const a of A.axes) for (const b of B.axes) if (!test(a.clone().cross(b))) return 0;
  return best;
}

function partDepth(PA, PB) {
  let best = 0, where = null;
  for (const a of PA) for (const b of PB) { const v = depth(a, b); if (v > best) { best = v; where = `${a.bone}~${b.bone}`; } }
  return { d: best, where };
}

export function analyse({ ids = IDS, anims = null, step = 0.05, rp = path.join(ROOT, 'packs/RP') } = {}) {
  const results = [];
  for (const id of ids) {
    const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/RP/models/entity', `fnar_${id}.geo.json`), 'utf8'));
    const all = JSON.parse(fs.readFileSync(path.join(rp, 'animations', `fnar_${id}.animation.json`), 'utf8')).animations;
    const model = buildModel(geo, null);
    applyAnimation(model, null, 0);
    const rest = boxes(model);
    const pairs = pairsFor(new Set(rest.keys()));
    const restD = new Map(pairs.map(([a, b]) => [`${a}|${b}`, partDepth(rest.get(a), rest.get(b)).d]));
    for (const [full, anim] of Object.entries(all)) {
      const name = full.split('.').pop();
      if (anims && !anims.includes(name)) continue;
      if (name === 'look') continue;
      const len = anim.animation_length ?? 2;
      const worst = new Map();
      for (let t = 0; t <= len + 1e-6; t += step) {
        applyAnimation(model, anim, t);
        const B = boxes(model);
        for (const [a, b] of pairs) {
          if (!B.has(a) || !B.has(b)) continue;
          const r = partDepth(B.get(a), B.get(b));
          const v = r.d - restD.get(`${a}|${b}`);
          const k = `${a}|${b}`;
          if (!worst.has(k) || v > worst.get(k).v) worst.set(k, { v, t: Math.round(t * 100) / 100, where: r.where, frames: 0 });
          if (v > 1) worst.get(k).frames++;
        }
      }
      for (const [k, w] of worst) results.push({ id, anim: name, pair: k, depth: Math.round(w.v * 100) / 100, t: w.t, where: w.where, frames: w.frames });
      // arms, hands and props below the floor (y < 0)
      let floor = { v: 0, t: 0, where: null, frames: 0 };
      for (let t = 0; t <= len + 1e-6; t += step) {
        applyAnimation(model, anim, t);
        const B = boxes(model);
        let worstHere = 0, whereHere = null;
        for (const [part, list] of B) {
          if (!/upper|fore|hand|prop|guitar/.test(part)) continue;
          for (const b of list) {
            let lo = b.c.y;
            for (let i = 0; i < 3; i++) lo -= b.half[i] * Math.abs(b.axes[i].y);
            if (-lo > worstHere) { worstHere = -lo; whereHere = b.bone; }
          }
        }
        if (worstHere > 1) floor.frames++;
        if (worstHere > floor.v) floor = { v: worstHere, t: Math.round(t * 100) / 100, where: whereHere, frames: floor.frames };
      }
      results.push({ id, anim: name, pair: 'arms|below_floor', depth: Math.round(floor.v * 100) / 100, t: floor.t, where: floor.where, frames: floor.frames });
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = {};
  let min = 1.0, jsonOut = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--ids') opt.ids = a[++i].split(',');
    else if (a[i] === '--anims') opt.anims = a[++i].split(',');
    else if (a[i] === '--step') opt.step = Number(a[++i]);
    else if (a[i] === '--min') min = Number(a[++i]);
    else if (a[i] === '--rp') opt.rp = path.resolve(a[++i]);
    else if (a[i] === '--json') jsonOut = a[++i];
  }
  const res = analyse(opt);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(res, null, 1));
  const bad = res.filter((r) => r.depth >= min).sort((x, y) => (x.id + x.anim).localeCompare(y.id + y.anim) || y.depth - x.depth);
  let cur = '';
  for (const r of bad) {
    const k = `${r.id}.${r.anim}`;
    if (k !== cur) { console.log(k); cur = k; }
    console.log(`   ${r.pair.padEnd(28)} ${String(r.depth).padStart(6)} px  t=${r.t}  frames>1px=${r.frames}  ${r.where}`);
  }
  console.log(`${bad.length} pairs >= ${min} px`);
}
