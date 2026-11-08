// Minimal Bedrock geometry + animation previewer (Blockbench conventions).
import * as THREE from './node_modules/three/build/three.module.js';

const D2R = Math.PI / 180;
const W = window;

// ---------- Molang (subset) ----------
const MolangMath = {
  sin: (d) => Math.sin(d * D2R), cos: (d) => Math.cos(d * D2R), abs: Math.abs,
  clamp: (v, a, b) => Math.min(Math.max(v, a), b), lerp: (a, b, t) => a + (b - a) * t,
  min: Math.min, max: Math.max, pow: Math.pow, sqrt: Math.sqrt, floor: Math.floor,
  ceil: Math.ceil, round: Math.round, mod: (a, b) => a % b, exp: Math.exp, ln: Math.log,
  trunc: Math.trunc, pi: Math.PI, atan2: (y, x) => Math.atan2(y, x) / D2R, atan: (x) => Math.atan(x) / D2R,
  asin: (x) => Math.asin(x) / D2R, acos: (x) => Math.acos(x) / D2R, random: (a, b) => (a + b) / 2,
  hermite_blend: (t) => 3 * t * t - 2 * t * t * t, sign: Math.sign,
  lerprotate: (a, b, t) => a + (b - a) * t, die_roll: () => 0, random_integer: (a) => a,
};
const molangCache = new Map();
function compileMolang(src) {
  if (molangCache.has(src)) return molangCache.get(src);
  let s = String(src).toLowerCase();
  s = s.replace(/\bmath\./g, 'M.').replace(/\b(query|q)\./g, 'Q.').replace(/\b(variable|v)\./g, 'V.')
    .replace(/\b(temp|t)\./g, 'V.').replace(/\bthis\b/g, '0');
  s = s.replace(/return\s+/g, '');
  if (s.includes(';')) s = s.split(';').filter((x) => x.trim()).pop();
  let fn;
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('Q', 'V', 'M', `return (${s});`);
    fn = (Q, V) => { try { const r = f(Q, V, MolangMath); return Number.isFinite(+r) ? +r : 0; } catch { return 0; } };
  } catch (e) {
    console.warn('molang compile failed', src, e.message);
    fn = () => 0;
  }
  molangCache.set(src, fn);
  return fn;
}
function evalVal(v, Q, V) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return compileMolang(v)(Q, V);
  return 0;
}
function evalVec(v, Q, V) {
  if (Array.isArray(v)) return [evalVal(v[0], Q, V), evalVal(v[1], Q, V), evalVal(v[2], Q, V)];
  const s = evalVal(v, Q, V); return [s, s, s];
}

// ---------- animation sampling ----------
function keyframesOf(chan) {
  if (Array.isArray(chan) || typeof chan !== 'object') return null; // static
  const ks = Object.keys(chan).map((t) => {
    const raw = chan[t];
    let pre, post, lerp = 'linear';
    if (raw && !Array.isArray(raw) && typeof raw === 'object') {
      post = raw.post ?? raw.vector ?? raw.pre; pre = raw.pre ?? post; lerp = raw.lerp_mode || 'linear';
    } else { pre = post = raw; }
    return { t: parseFloat(t), pre, post, lerp };
  });
  ks.sort((a, b) => a.t - b.t);
  return ks;
}
function sampleChannel(chan, time, Q, V) {
  const ks = keyframesOf(chan);
  if (!ks) return evalVec(chan, Q, V);
  if (time <= ks[0].t) return evalVec(ks[0].pre, Q, V);
  const last = ks[ks.length - 1];
  if (time >= last.t) return evalVec(last.post, Q, V);
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].t <= time) i++;
  const a = ks[i], b = ks[i + 1];
  const u = (time - a.t) / (b.t - a.t);
  const va = evalVec(a.post, Q, V), vb = evalVec(b.pre, Q, V);
  if (a.lerp === 'catmullrom' || b.lerp === 'catmullrom') {
    const p0 = evalVec((ks[i - 1] || a).post, Q, V), p3 = evalVec((ks[i + 2] || b).pre, Q, V);
    return [0, 1, 2].map((k) => {
      const P0 = p0[k], P1 = va[k], P2 = vb[k], P3 = p3[k];
      const t2 = u * u, t3 = t2 * u;
      return 0.5 * ((2 * P1) + (-P0 + P2) * u + (2 * P0 - 5 * P1 + 4 * P2 - P3) * t2 + (-P0 + 3 * P1 - 3 * P2 + P3) * t3);
    });
  }
  if (a.lerp === 'step') return va;
  return [0, 1, 2].map((k) => va[k] + (vb[k] - va[k]) * u);
}

// ---------- model ----------
let renderer, scene, camera, model = null, bonesByName = {}, restState = {}, texture, ANIMS = {};
function init(w, h, opts = {}) {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: !!opts.transparent });
  renderer.setSize(w, h);
  renderer.setPixelRatio(1);
  document.body.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = opts.transparent ? null : new THREE.Color(opts.bg ?? 0x1b1715);
  if (opts.transparent) renderer.setClearColor(0x000000, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-40, 80, -60); scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffeedd, 0.6); dl2.position.set(60, 30, 50); scene.add(dl2);
  camera = new THREE.PerspectiveCamera(30, w / h, 1, 5000);
  if (!opts.noGrid) { const grid = new THREE.GridHelper(160, 10, 0x554433, 0x332a24); scene.add(grid); }
  if (opts.fog) scene.fog = new THREE.Fog(opts.bg ?? 0x1b1715, opts.fog[0], opts.fog[1]);
}

function faceCorners(x1, y1, z1, x2, y2, z2) {
  return {
    north: [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]],
    south: [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]],
    east: [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]],
    west: [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]],
    up: [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]],
    down: [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]],
  };
}

function buildModel(geoJson, texW, texH) {
  const geo = geoJson['minecraft:geometry'][0];
  const tw = geo.description.texture_width, th = geo.description.texture_height;
  const mat = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: 0.05, transparent: false });
  model = new THREE.Group();
  bonesByName = {}; restState = {};
  const bonesJ = geo.bones;
  const pivots = {};
  for (const b of bonesJ) pivots[b.name] = b.pivot || [0, 0, 0];
  for (const b of bonesJ) {
    const g = new THREE.Group(); g.name = b.name;
    g.rotation.order = 'ZYX';
    const p = pivots[b.name];
    const pp = b.parent ? pivots[b.parent] : [0, 0, 0];
    g.position.set(-(p[0]) - (-(pp[0])), p[1] - pp[1], p[2] - pp[2]);
    const r = b.rotation || [0, 0, 0];
    g.rotation.set(-r[0] * D2R, -r[1] * D2R, r[2] * D2R);
    restState[b.name] = { pos: g.position.clone(), rot: g.rotation.clone() };
    bonesByName[b.name] = g;
    // cubes (in bone-local space relative to bone pivot)
    const positions = [], uvs = [], idx = [];
    for (const c of (b.cubes || [])) {
      const inf = c.inflate || 0;
      let x1 = -(c.origin[0] + c.size[0]) - inf, x2 = -c.origin[0] + inf;
      let y1 = c.origin[1] - inf, y2 = c.origin[1] + c.size[1] + inf;
      let z1 = c.origin[2] - inf, z2 = c.origin[2] + c.size[2] + inf;
      const fc = faceCorners(x1, y1, z1, x2, y2, z2);
      let m = null;
      if (c.rotation) {
        const cp = c.pivot || [0, 0, 0];
        const e = new THREE.Euler(-c.rotation[0] * D2R, -c.rotation[1] * D2R, c.rotation[2] * D2R, 'ZYX');
        const piv = new THREE.Vector3(-cp[0], cp[1], cp[2]);
        m = new THREE.Matrix4().makeTranslation(piv.x, piv.y, piv.z)
          .multiply(new THREE.Matrix4().makeRotationFromEuler(e))
          .multiply(new THREE.Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z));
      }
      for (const fname of Object.keys(fc)) {
        const f = c.uv && c.uv[fname];
        if (!f) continue;
        let [u, v] = f.uv; let [uw, vh] = f.uv_size;
        let u1 = u, v1 = v, u2 = u + uw, v2 = v + vh;
        if (fname === 'up' || fname === 'down') { [u1, u2] = [u2, u1]; [v1, v2] = [v2, v1]; }
        const quv = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
        const base = positions.length / 3;
        fc[fname].forEach((pt, k) => {
          const vec = new THREE.Vector3(pt[0], pt[1], pt[2]);
          if (m) vec.applyMatrix4(m);
          positions.push(vec.x - (-p[0]), vec.y - p[1], vec.z - p[2]);
          uvs.push(quv[k][0] / tw, 1 - quv[k][1] / th);
        });
        idx.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
      }
    }
    if (positions.length) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      bg.setIndex(idx); bg.computeVertexNormals();
      g.add(new THREE.Mesh(bg, mat));
    }
  }
  for (const b of bonesJ) {
    const g = bonesByName[b.name];
    if (b.parent && bonesByName[b.parent]) bonesByName[b.parent].add(g); else model.add(g);
  }
  scene.add(model);
}

function applyPose(animList, Q, V, rootXform) {
  const acc = {};
  for (const name of Object.keys(bonesByName)) acc[name] = { r: [0, 0, 0], p: [0, 0, 0], s: [1, 1, 1] };
  for (const entry of animList) {
    const an = ANIMS[entry.name];
    if (!an) { console.warn('missing anim', entry.name); continue; }
    const w = entry.weight ?? 1;
    let t = entry.time ?? 0;
    const len = an.animation_length || 0;
    if (an.loop === true && len > 0) t = ((t % len) + len) % len;
    const Qx = Object.assign({ anim_time: t, life_time: t }, Q);
    for (const [bone, ch] of Object.entries(an.bones || {})) {
      const a = acc[bone]; if (!a) continue;
      if (ch.rotation !== undefined) { const r = sampleChannel(ch.rotation, t, Qx, V); for (let k = 0; k < 3; k++) a.r[k] += r[k] * w; }
      if (ch.position !== undefined) { const p = sampleChannel(ch.position, t, Qx, V); for (let k = 0; k < 3; k++) a.p[k] += p[k] * w; }
      if (ch.scale !== undefined) { const s = sampleChannel(ch.scale, t, Qx, V); for (let k = 0; k < 3; k++) a.s[k] *= 1 + (s[k] - 1) * w; }
    }
  }
  for (const [name, g] of Object.entries(bonesByName)) {
    const rs = restState[name], a = acc[name];
    g.rotation.set(rs.rot.x - a.r[0] * D2R, rs.rot.y - a.r[1] * D2R, rs.rot.z + a.r[2] * D2R);
    g.position.set(rs.pos.x - a.p[0], rs.pos.y + a.p[1], rs.pos.z + a.p[2]);
    g.scale.set(a.s[0], a.s[1], a.s[2]);
  }
  model.rotation.set((rootXform?.rotX || 0) * D2R, (rootXform?.yaw || 0) * D2R, (rootXform?.rotZ || 0) * D2R);
  model.position.set(0, rootXform?.y || 0, 0);
}

function setCamera(c) {
  const yaw = (c.yaw ?? 0) * D2R, pitch = (c.pitch ?? 8) * D2R, dist = c.dist ?? 230;
  const tgt = c.target || [0, 42, 0];
  // yaw 0 = looking at model front (front faces -Z)
  camera.position.set(tgt[0] + Math.sin(yaw) * Math.cos(pitch) * dist, tgt[1] + Math.sin(pitch) * dist, tgt[2] - Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(tgt[0], tgt[1], tgt[2]);
}

W.loadAll = async function (geoJson, texUrl, animFiles, w, h, opts) {
  init(w, h, opts || {});
  texture = await new THREE.TextureLoader().loadAsync(texUrl);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  buildModel(geoJson);
  for (const f of animFiles) Object.assign(ANIMS, f.animations);
  return Object.keys(ANIMS);
};

W.renderSheet = function (frames, cols, cw, ch) {
  const rows = Math.ceil(frames.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * cw; sheet.height = rows * ch;
  const ctx = sheet.getContext('2d');
  renderer.setSize(cw, ch); camera.aspect = cw / ch; camera.updateProjectionMatrix();
  frames.forEach((fr, i) => {
    applyPose(fr.anims || [], fr.queries || {}, fr.vars || {}, fr.root);
    setCamera(fr.camera || {});
    renderer.render(scene, camera);
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    ctx.drawImage(renderer.domElement, x, y);
    if (fr.label) { ctx.fillStyle = '#ffe9c4'; ctx.font = '13px monospace'; ctx.fillText(fr.label, x + 6, y + 16); }
  });
  return sheet.toDataURL('image/png');
};
