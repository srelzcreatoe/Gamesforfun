// Browser module: renders an fnar-voxels-1 snapshot (+ entities) with three.js.
// Driven by render_world.mjs: window.renderWorld(payload) -> { png: dataURL, log, stats }.
//
// Lighting model ("vibrant"):
//  * Minecraft block light: flood fill (0..15, -1 per step, walls block it) from every emitter,
//    coloured per emitter, curved with MC's lightmap curve and summed -> per-vertex RGB with
//    smooth lighting + ambient occlusion. Injected into MeshStandardMaterial as uniform-environment
//    irradiance/radiance (so metals and glossy tiles still read).
//  * Sky light flood fill (night sky colour) for exteriors / windows.
//  * A few real three.js point lights (clustered emitters ranked by relevance to the camera; 1-3
//    with shadows) for direct light, specular highlights and entity shadows.
//  * MER -> roughness/metalness/emissive maps, heightmap -> normal map, bloom, exp fog, ACES.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildModel, applyAnimation, faceUVs } from '/bedrock_model.js';
import { buildShape, shapeKey, bake, DIRS } from '/shapes.js';

// Soft near-field radius for punctual lights: avoids blown-out spots right next to small emitters
// (torches, end rods) while keeping inverse-square falloff further away.
THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace(
  'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );',
  'float distanceFalloff = 1.0 / ( pow( lightDistance, decayExponent ) + 1.0 );');

const logs = [];
const log = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const now = () => performance.now();
const FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north'];
const DIR_LIST = ['north', 'south', 'west', 'east', 'up', 'down'];
const AIR = { kind: 'air', full: false, shape: 'none', dampen: 0, emit: 0 };

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function hexLinear(hex) {
  const h = (hex || '#ffffff').replace('#', '');
  return [0, 2, 4].map((k) => srgbToLinear(parseInt(h.slice(k, k + 2), 16) / 255));
}
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
// Minecraft lightmap curve (level 0..15 -> brightness 0..1)
const MC_CURVE = new Float32Array(16).map((_, l) => { const f = l / 15; return f / (4 - 3 * f); });

// ------------------------------------------------------------------ textures
const texLoader = new THREE.TextureLoader();
const texPromises = new Map();
function loadTex(url, { srgb = true, mips = true } = {}) {
  const key = url + (srgb ? '|s' : '|l') + (mips ? 'm' : '');
  if (!texPromises.has(key)) {
    texPromises.set(key, new Promise((res) => texLoader.load(url, (t) => {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = mips ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
      t.generateMipmaps = mips;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      res(t);
    }, undefined, () => { log('texture load failed', url); res(null); })));
  }
  return texPromises.get(key);
}

// ------------------------------------------------------------------ world data
function decodeVoxels(b64, n) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length < n * 2) throw new Error(`voxel data too short: ${bytes.length} < ${n * 2}`);
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  return out;
}

function prepareWorld(Wp) {
  const t0 = now();
  const [sx, sy, sz] = Wp.size;
  const n = sx * sy * sz;
  const vox = decodeVoxels(Wp.data, n);
  const P = Wp.palette.map((e) => e ?? AIR);
  const full = new Uint8Array(n), damp = new Uint8Array(n);
  const emitters = [];
  const pFull = P.map((e) => (e.full ? 1 : 0));
  const pDamp = P.map((e) => (e.full ? 15 : Math.max(0, Math.min(15, e.dampen ?? 0))));
  for (let i = 0; i < n; i++) {
    const p = vox[i];
    if (p >= P.length) continue;
    full[i] = pFull[p]; damp[i] = pDamp[p];
    const e = P[p];
    if (e.emit > 0) {
      const st = e.states || {};
      const facing = st['minecraft:cardinal_direction'] ?? ['down', 'up', 'north', 'south', 'west', 'east'][st.facing_direction] ?? st['minecraft:facing_direction'] ?? 'north';
      emitters.push({ idx: i, level: Math.min(15, e.emit), color: e.lightColor || '#ffe6c8', type: e.lightType || 'static', name: e.name, facing, full: !!e.full });
    }
  }
  const W = { key: Wp.key, origin: Wp.origin, sx, sy, sz, n, vox, P, full, damp, emitters, textures: Wp.textures, geometries: Wp.geometries, signs: Wp.signs || [] };
  log(`world ${sx}x${sy}x${sz}, palette ${P.length}, emitters ${emitters.length}, decode ${(now() - t0).toFixed(0)} ms`);
  return W;
}

/** Block light (RGB, per-emitter coloured flood fill) + sky light. */
function computeLight(W) {
  const t0 = now();
  const { sx, sy, sz, n, damp } = W;
  const L = new Float32Array(n * 4);
  const stamp = new Int32Array(n).fill(-1);
  const qI = new Int32Array(n), qL = new Uint8Array(n);
  const sxz = sx * sz;
  W.emitters.forEach((em, k) => {
    const col = hexLinear(em.color);
    const m = Math.max(...col, 1e-3);
    const c = col.map((v) => v / m);
    let h = 0, t = 0;
    stamp[em.idx] = k; qI[t] = em.idx; qL[t++] = em.level;
    const add = (i, l) => { const f = MC_CURVE[l]; L[i * 4] += c[0] * f; L[i * 4 + 1] += c[1] * f; L[i * 4 + 2] += c[2] * f; };
    add(em.idx, em.level);
    while (h < t) {
      const i = qI[h], l = qL[h++];
      if (l <= 1) continue;
      const x = i % sx, z = ((i / sx) | 0) % sz, y = (i / sxz) | 0;
      for (let d = 0; d < 6; d++) {
        let j;
        if (d === 0) { if (x === 0) continue; j = i - 1; } else if (d === 1) { if (x === sx - 1) continue; j = i + 1; }
        else if (d === 2) { if (z === 0) continue; j = i - sx; } else if (d === 3) { if (z === sz - 1) continue; j = i + sx; }
        else if (d === 4) { if (y === 0) continue; j = i - sxz; } else { if (y === sy - 1) continue; j = i + sxz; }
        if (stamp[j] === k) continue;
        const dp = damp[j];
        if (dp >= 15) continue;
        const nl = l - 1 - dp;
        if (nl <= 0) continue;
        stamp[j] = k; add(j, nl); qI[t] = j; qL[t++] = nl;
      }
    }
  });
  // sky light
  const sky = new Uint8Array(n);
  let h = 0, t = 0;
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    for (let y = sy - 1; y >= 0; y--) {
      const i = x + sx * (z + sz * y);
      if (damp[i] > 0) break;
      sky[i] = 15; qI[t++] = i;
    }
  }
  while (h < t) {
    const i = qI[h++], l = sky[i];
    if (l <= 1) continue;
    const x = i % sx, z = ((i / sx) | 0) % sz, y = (i / sxz) | 0;
    for (let d = 0; d < 6; d++) {
      let j;
      if (d === 0) { if (x === 0) continue; j = i - 1; } else if (d === 1) { if (x === sx - 1) continue; j = i + 1; }
      else if (d === 2) { if (z === 0) continue; j = i - sx; } else if (d === 3) { if (z === sz - 1) continue; j = i + sx; }
      else if (d === 4) { if (y === 0) continue; j = i - sxz; } else { if (y === sy - 1) continue; j = i + sxz; }
      const dp = damp[j];
      if (dp >= 15) continue;
      const nl = l - 1 - dp;
      if (nl <= sky[j]) continue;
      sky[j] = nl; qI[t++] = j;
    }
  }
  for (let i = 0; i < n; i++) L[i * 4 + 3] = MC_CURVE[sky[i]];
  W.L = L; W.sky = sky;
  log(`light: ${W.emitters.length} emitters, ${(now() - t0).toFixed(0)} ms`);
}

/** Smooth light + AO at a point (snapshot-local block coords). out = [r,g,b,sky,ao]. */
function sampleLight(W, px, py, pz, out, own = -1) {
  const { sx, sy, sz, L, full } = W;
  const fx = px - 0.5, fy = py - 0.5, fz = pz - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  let r = 0, g = 0, b = 0, s = 0, ws = 0, occ = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
    if (w < 1e-5) continue;
    let x = x0 + dx, y = y0 + dy, z = z0 + dz;
    const above = y >= sy;
    x = x < 0 ? 0 : x >= sx ? sx - 1 : x; y = y < 0 ? 0 : y >= sy ? sy - 1 : y; z = z < 0 ? 0 : z >= sz ? sz - 1 : z;
    const i = x + sx * (z + sz * y);
    if (full[i] && !above) { occ += w; continue; }
    r += w * L[i * 4]; g += w * L[i * 4 + 1]; b += w * L[i * 4 + 2]; s += w * (above ? 1 : L[i * 4 + 3]); ws += w;
  }
  if (ws > 1e-4) { out[0] = r / ws; out[1] = g / ws; out[2] = b / ws; out[3] = s / ws; }
  else if (own >= 0) { out[0] = L[own * 4]; out[1] = L[own * 4 + 1]; out[2] = L[own * 4 + 2]; out[3] = L[own * 4 + 3]; }
  else { out[0] = out[1] = out[2] = out[3] = 0; }
  out[4] = 1 - 0.8 * Math.min(occ, 0.75);
  return out;
}

// ------------------------------------------------------------------ geometry builder
class GeoBuilder {
  constructor() { this.nv = 0; this.ni = 0; this.cap = 0; this.icap = 0; this.grow(256); }
  grow(min) {
    const cap = Math.max(min, this.cap * 2);
    const ext = (a, k) => { const b = new Float32Array(cap * k); if (a) b.set(a.subarray(0, this.nv * k)); return b; };
    this.pos = ext(this.pos, 3); this.nor = ext(this.nor, 3); this.uv = ext(this.uv, 2); this.bl = ext(this.bl, 3); this.sk = ext(this.sk, 1);
    this.cap = cap;
    const icap = Math.ceil(cap * 1.5);
    const idx = new Uint32Array(icap); if (this.idx) idx.set(this.idx.subarray(0, this.ni)); this.idx = idx; this.icap = icap;
  }
  /** p: 12 floats (already offset), n: 3, uv: 8, light: 4x[r,g,b,sky,ao] */
  quad(p, n, uv, light, flipDiag) {
    if (this.nv + 4 > this.cap) this.grow(this.nv + 4);
    const v = this.nv;
    for (let k = 0; k < 4; k++) {
      const o = v + k;
      this.pos[o * 3] = p[k * 3]; this.pos[o * 3 + 1] = p[k * 3 + 1]; this.pos[o * 3 + 2] = p[k * 3 + 2];
      this.nor[o * 3] = n[0]; this.nor[o * 3 + 1] = n[1]; this.nor[o * 3 + 2] = n[2];
      this.uv[o * 2] = uv[k * 2]; this.uv[o * 2 + 1] = uv[k * 2 + 1];
      const l = light[k], ao = l[4];
      this.bl[o * 3] = l[0] * ao; this.bl[o * 3 + 1] = l[1] * ao; this.bl[o * 3 + 2] = l[2] * ao; this.sk[o] = l[3] * ao;
    }
    const I = this.idx, i = this.ni;
    if (!flipDiag) { I[i] = v; I[i + 1] = v + 3; I[i + 2] = v + 2; I[i + 3] = v; I[i + 4] = v + 2; I[i + 5] = v + 1; }
    else { I[i] = v; I[i + 1] = v + 3; I[i + 2] = v + 1; I[i + 3] = v + 1; I[i + 4] = v + 3; I[i + 5] = v + 2; }
    this.nv += 4; this.ni += 6;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.nv * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.nv * 2), 2));
    g.setAttribute('bl', new THREE.BufferAttribute(this.bl.slice(0, this.nv * 3), 3));
    g.setAttribute('sk', new THREE.BufferAttribute(this.sk.slice(0, this.nv), 1));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ------------------------------------------------------------------ custom block templates
function customQuads(e, W) {
  const C = e.custom;
  let quads = [];
  if (C.geometry === 'full_block') {
    const f = [0, 0, 0], t = [16, 16, 16];
    const faces = {};
    for (const d of DIR_LIST) faces[d] = { tex: d, cull: d };
    // full_block in model space: centre at origin, x/z -0.5..0.5, y 0..1
    quads = bake([{ from: f, to: t, faces }]).map((q) => ({ ...q, p: q.p.map((v, k) => (k % 3 === 1 ? v : v - 0.5)) }));
  } else {
    const geo = W.geometries[C.geometry];
    const dummy = new THREE.MeshBasicMaterial();
    const model = buildModel(geo, dummy);
    for (const [bone, vis] of Object.entries(C.boneVisibility || {})) { const b = model.bones.get(bone); if (b && !vis) b.node.visible = false; }
    model.root.updateMatrixWorld(true);
    const nm = new THREE.Matrix3();
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    model.root.traverse((m) => {
      if (!m.isMesh) return;
      for (let o = m; o; o = o.parent) if (!o.visible) return;
      const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal;
      nm.getNormalMatrix(m.matrixWorld);
      const faces = new Set();
      for (const i of g.index.array) faces.add(Math.floor(i / 4));
      const cube = m.userData.cube;
      for (const fi of faces) {
        const order = [fi * 4, fi * 4 + 1, fi * 4 + 3, fi * 4 + 2]; // TL TR BR BL
        const p = [], u = [];
        for (const vi of order) { v.fromBufferAttribute(pos, vi).applyMatrix4(m.matrixWorld); p.push(v.x, v.y, v.z); u.push(uv.getX(vi), uv.getY(vi)); }
        nn.fromBufferAttribute(nor, order[0]).applyMatrix3(nm).normalize();
        const fname = FACE_ORDER[fi];
        const inst = (cube && !Array.isArray(cube.uv) && cube.uv?.[fname]?.material_instance) || fname;
        // drop degenerate faces (zero-size cube sides)
        const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2], bx = p[9] - p[0], by = p[10] - p[1], bz = p[11] - p[2];
        const area = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
        if (area < 1e-5) continue;
        quads.push({ p, uv: u, n: [nn.x, nn.y, nn.z], tex: inst, cull: null });
      }
    });
  }
  // transformation (about the block centre), then into cell-local coords (0..1)
  const tr = C.transform;
  const M = new THREE.Matrix4();
  if (tr) {
    const c = new THREE.Vector3(0, 0.5, 0);
    const rp = c.clone().add(new THREE.Vector3(...tr.rotation_pivot));
    const sp = c.clone().add(new THREE.Vector3(...tr.scale_pivot));
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...tr.rotation.map((a) => a * Math.PI / 180), 'XYZ'));
    const S = new THREE.Matrix4().makeScale(...tr.scale);
    M.multiply(new THREE.Matrix4().makeTranslation(...tr.translation));
    M.multiply(new THREE.Matrix4().makeTranslation(rp.x, rp.y, rp.z)).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-rp.x, -rp.y, -rp.z));
    M.multiply(new THREE.Matrix4().makeTranslation(sp.x, sp.y, sp.z)).multiply(S).multiply(new THREE.Matrix4().makeTranslation(-sp.x, -sp.y, -sp.z));
  }
  M.premultiply(new THREE.Matrix4().makeTranslation(0.5, 0, 0.5));
  const NM = new THREE.Matrix3().getNormalMatrix(M);
  const v = new THREE.Vector3();
  return quads.map((q) => {
    const p = [];
    for (let k = 0; k < 4; k++) { v.set(q.p[k * 3], q.p[k * 3 + 1], q.p[k * 3 + 2]).applyMatrix4(M); p.push(v.x, v.y, v.z); }
    const nv = new THREE.Vector3(...q.n).applyMatrix3(NM).normalize();
    let cull = null;
    for (const d of DIR_LIST) {
      const D = DIRS[d];
      if (nv.x * D[0] + nv.y * D[1] + nv.z * D[2] < 0.999) continue;
      const ax = D[0] ? 0 : D[1] ? 1 : 2, val = D[0] + D[1] + D[2] > 0 ? 1 : 0;
      if ([0, 1, 2, 3].every((k) => Math.abs(p[k * 3 + ax] - val) < 1e-4)) cull = d;
    }
    return { p, uv: q.uv, n: [nv.x, nv.y, nv.z], tex: q.tex, cull };
  });
}

// ------------------------------------------------------------------ meshing
const CHUNK = 16;
function meshWorld(W) {
  const t0 = now();
  const { sx, sy, sz, vox, P, full } = W;
  const builders = new Map(); // chunkKey|matKey -> { builder, matKey, chunk }
  const staticCache = new Map(), dynCache = new Map(), customCache = new Map();
  const signs = [];
  const tmpP = new Array(12);
  const light = [[0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1]];
  let quadsOut = 0;
  const texInfo = W.textures;
  const matInfo = new Map();
  const matKeyFor = (texId, render, ds, fdim) => {
    const k = `${texId}|${render}|${ds ? 1 : 0}|${fdim ? 1 : 0}`;
    if (!matInfo.has(k)) matInfo.set(k, { texId, render, ds, fdim });
    return k;
  };
  const vanillaRender = (texId) => { const t = texInfo[texId]; const a = t?.alpha ?? 'opaque'; return a === 'blend' ? 'blend' : a === 'cutout' ? 'alpha_test' : 'opaque'; };
  const pickVariant = (texId, x, y, z) => {
    const t = texInfo[texId];
    if (!t?.variants) return texId;
    const ws = t.weights; const tot = ws.reduce((a, b) => a + b, 0);
    let r = (hash3(x, y, z) % 1000) / 1000 * tot;
    for (let k = 0; k < ws.length; k++) { r -= ws[k]; if (r < 0) return t.variants[k]; }
    return t.variants[0];
  };
  const sxz = sx * sz;
  const getP = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? AIR : P[vox[x + sx * (z + sz * y)]] ?? AIR);

  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = x + sx * (z + sz * y);
    const pid = vox[i];
    const e = P[pid];
    if (!e || e.kind === 'air' || e.kind === 'invisible') continue;
    const nb = (dx, dy, dz) => getP(x + dx, y + dy, z + dz);
    let quads;
    if (e.kind === 'custom') {
      if (!customCache.has(pid)) { try { customCache.set(pid, customQuads(e, W)); } catch (err) { log('custom block failed', e.name, String(err)); customCache.set(pid, []); } }
      quads = customCache.get(pid);
    } else {
      const key = shapeKey(e, nb);
      if (key === null) {
        if (!staticCache.has(pid)) staticCache.set(pid, buildShape(e, nb));
        const s = staticCache.get(pid);
        quads = s.quads; if (s.sign) signs.push({ x, y, z, q: s.sign });
      } else {
        const k = pid + ':' + key;
        if (!dynCache.has(k)) dynCache.set(k, buildShape(e, nb));
        quads = dynCache.get(k).quads;
      }
    }
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), cz = Math.floor(z / CHUNK);
    const ox = cx * CHUNK, oy = cy * CHUNK, oz = cz * CHUNK;
    for (const q of quads) {
      if (q.cull) {
        const D = DIRS[q.cull];
        const nx = x + D[0], ny = y + D[1], nz = z + D[2];
        if (nx >= 0 && ny >= 0 && nz >= 0 && nx < sx && ny < sy && nz < sz) {
          const j = nx + sx * (nz + sz * ny);
          if (full[j]) continue;
          if (e.cullSame && vox[j] === pid) continue;
        }
      }
      let texId, render, ds, fdim = true, ao = true;
      if (e.kind === 'custom') {
        const m = e.custom.materials[q.tex] ?? e.custom.materials['*'] ?? Object.values(e.custom.materials)[0];
        texId = m.tex; render = m.render; ds = m.doubleSided || m.render !== 'opaque'; fdim = m.faceDimming; ao = m.ao;
      } else {
        texId = q.tex; render = vanillaRender(texId); ds = render !== 'opaque' || e.shape === 'cross' || e.shape === 'chain' || e.shape === 'ladder';
      }
      texId = pickVariant(texId, x + W.origin[0], y + W.origin[1], z + W.origin[2]);
      const matKey = matKeyFor(texId, render, ds, fdim);
      const bkey = `${cx},${cy},${cz}|${matKey}`;
      let B = builders.get(bkey);
      if (!B) { B = { builder: new GeoBuilder(), matKey, origin: [ox, oy, oz] }; builders.set(bkey, B); }
      const n = q.n;
      for (let k = 0; k < 4; k++) {
        const px = x + q.p[k * 3], py = y + q.p[k * 3 + 1], pz = z + q.p[k * 3 + 2];
        tmpP[k * 3] = px - ox; tmpP[k * 3 + 1] = py - oy; tmpP[k * 3 + 2] = pz - oz;
        sampleLight(W, px + n[0] * 0.5, py + n[1] * 0.5, pz + n[2] * 0.5, light[k], full[i] ? -1 : i);
        if (!ao) light[k][4] = 1;
      }
      let uv = q.uv;
      if (e.isotropic && e.cubeLike && (q.cull === 'up' && e.isotropic.up || q.cull === 'down' && e.isotropic.down)) {
        const r = hash3(x + W.origin[0], y + W.origin[1], z + W.origin[2]) & 3;
        if (r) { uv = new Array(8); for (let k = 0; k < 4; k++) { const s = (k + r) % 4; uv[k * 2] = q.uv[s * 2]; uv[k * 2 + 1] = q.uv[s * 2 + 1]; } }
      }
      const b = (l) => l[0] + l[1] + l[2] + l[3] + l[4] * 0.5;
      const flip = b(light[0]) + b(light[2]) < b(light[1]) + b(light[3]) - 1e-4;
      B.builder.quad(tmpP, n, uv, light, flip);
      quadsOut++;
    }
  }
  W.chunks = [...builders.values()];
  W.matInfo = matInfo;
  W.signAnchors = signs;
  log(`mesh: ${quadsOut} quads, ${W.chunks.length} chunk meshes, ${matInfo.size} materials, ${(now() - t0).toFixed(0)} ms`);
}

// ------------------------------------------------------------------ materials
const LIGHT_UNIFORMS = () => ({
  uBlock: { value: 1 }, uSky: { value: new THREE.Color(0, 0, 0) }, uAmb: { value: new THREE.Color(0, 0, 0) },
  uFaceDim: { value: 0 }, uSpec: { value: 1 }, uGamma: { value: 1 }, uCurve: { value: 1 }, uBright: { value: 0.5 },
});
function injectLight(mat, U, { classic = false, fdim = true, attr = true } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.uniforms.uFdimOn = { value: fdim ? 1 : 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 bl; attribute float sk; varying vec3 vBL; varying float vSK; varying vec3 vWN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${attr ? 'vBL = bl; vSK = sk;' : 'vBL = vec3(0.0); vSK = 0.0;'}\nvWN = normalize(mat3(modelMatrix) * normal);`);
    const pre = `uniform float uBlock; uniform vec3 uSky; uniform vec3 uAmb; uniform float uFaceDim; uniform float uFdimOn; uniform float uSpec; uniform float uGamma; uniform float uCurve; uniform float uBright;
varying vec3 vBL; varying float vSK; varying vec3 vWN;
float faceShade(vec3 n) { vec3 a = n * n; float up = n.y > 0.0 ? 1.0 : 0.5; return a.x * 0.6 + a.z * 0.8 + a.y * up; }
vec3 bakedLight() {
  float fd = mix(1.0, faceShade(normalize(vWN)), uFaceDim * uFdimOn);
  vec3 b = max(vBL, vec3(0.0));
  float m = max(max(b.r, b.g), b.b);
  b *= pow(max(m, 1e-4), uCurve - 1.0); // steeper falloff, hue preserved
  return (b * uBlock + vSK * uSky + uAmb) * fd;
}`;
    if (!classic) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${pre}`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n{ vec3 bk = bakedLight(); iblIrradiance += bk * PI; radiance += bk * uSpec; }`);
    } else {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${pre}`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\n{ vec3 bk = clamp(bakedLight(), 0.0, 1.0); bk = mix(bk, 1.0 - pow(1.0 - bk, vec3(4.0)), uBright); diffuseColor.rgb *= pow(bk, vec3(uGamma)); }`);
    }
  };
  mat.customProgramCacheKey = () => (classic ? 'fnar-classic' : 'fnar-vibrant') + (attr ? 'a' : 'n');
}

async function makeWorldMaterial(info, W, style, U) {
  const t = W.textures[info.texId] ?? {};
  const map = t.url ? await loadTex(t.url) : null;
  const common = { map, side: info.ds ? THREE.DoubleSide : THREE.FrontSide };
  if (info.render === 'alpha_test') common.alphaTest = 0.5;
  if (info.render === 'blend') { common.transparent = true; common.depthWrite = false; common.alphaTest = 0.02; }
  let mat;
  if (style === 'classic') {
    mat = new THREE.MeshBasicMaterial(common);
    injectLight(mat, U, { classic: true, fdim: info.fdim });
  } else {
    mat = new THREE.MeshStandardMaterial({ ...common, roughness: 0.85, metalness: 0.0 });
    if (t.pbr) {
      const pbr = await loadTex(t.pbr, { srgb: false });
      mat.roughnessMap = pbr; mat.metalnessMap = pbr; mat.roughness = 1; mat.metalness = 1;
    } else if (t.mersUniform) {
      const m = t.mersUniform; mat.metalness = (m[0] ?? 0) / 255; mat.roughness = Math.max(0.04, (m[2] ?? 217) / 255);
    }
    if (t.emi) { mat.emissiveMap = await loadTex(t.emi); mat.emissive = new THREE.Color(1, 1, 1); mat.emissiveIntensity = U.__emissive ?? 3.0; }
    if (t.nrm) { mat.normalMap = await loadTex(t.nrm, { srgb: false }); mat.normalScale = new THREE.Vector2(U.__normal ?? 1, U.__normal ?? 1); }
    injectLight(mat, U, { classic: false, fdim: info.fdim });
  }
  mat.name = info.texId;
  return mat;
}

// ------------------------------------------------------------------ lights
function lightPosition(W, idx) {
  const { sx, sz } = W;
  const x = idx % sx, z = ((idx / sx) | 0) % sz, y = (idx / (sx * sz)) | 0;
  const p = [x + 0.5, y + 0.5, z + 0.5];
  if (W.full[idx]) {
    let ox = 0, oy = 0, oz = 0, c = 0;
    for (const d of DIR_LIST) {
      const D = DIRS[d]; const nx = x + D[0], ny = y + D[1], nz = z + D[2];
      if (nx < 0 || ny < 0 || nz < 0 || nx >= W.sx || ny >= W.sy || nz >= W.sz) continue;
      if (!W.full[nx + sx * (nz + sz * ny)]) { ox += D[0]; oy += D[1]; oz += D[2]; c++; }
    }
    if (c) { const l = Math.hypot(ox, oy, oz) || 1; p[0] += ox / l * 0.62; p[1] += oy / l * 0.62; p[2] += oz / l * 0.62; }
  }
  return p;
}
function lineOfSight(W, a, b) { // snapshot-local coords
  const { sx, sy, sz, full } = W;
  let x = Math.floor(a[0]), y = Math.floor(a[1]), z = Math.floor(a[2]);
  const ex = Math.floor(b[0]), ey = Math.floor(b[1]), ez = Math.floor(b[2]);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const st = d.map(Math.sign);
  const tD = d.map((v) => (v !== 0 ? Math.abs(1 / v) : Infinity));
  const tM = [0, 1, 2].map((k) => (d[k] === 0 ? Infinity : ((st[k] > 0 ? Math.floor(a[k]) + 1 - a[k] : a[k] - Math.floor(a[k])) * tD[k])));
  for (let it = 0; it < 512; it++) {
    if (x === ex && y === ey && z === ez) return true;
    if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && it > 0 && full[x + sx * (z + sz * y)]) return false;
    const k = tM[0] < tM[1] ? (tM[0] < tM[2] ? 0 : 2) : (tM[1] < tM[2] ? 1 : 2);
    if (tM[k] > 1) return true;
    if (k === 0) x += st[0]; else if (k === 1) y += st[1]; else z += st[2];
    tM[k] += tD[k];
  }
  return true;
}

function selectLights(W, cam, S) {
  const o = W.origin;
  const camL = [cam.position.x - o[0], cam.position.y - o[1], cam.position.z - o[2]];
  const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  // spotlight blocks -> real spot lights aimed along the block's facing, tilted down
  const spots = [];
  const spotConf = (name) => S.lights.spots?.[name] ?? (/spotlight/i.test(name) ? {} : null);
  for (const em of W.emitters) {
    const conf = spotConf(em.name);
    if (!conf) continue;
    const F = DIRS[em.facing] ?? DIRS.north;
    const pitch = (conf.pitch ?? 40) * Math.PI / 180;
    const dir = new THREE.Vector3(F[0] * Math.cos(pitch), -Math.sin(pitch) + F[1], F[2] * Math.cos(pitch)).normalize();
    const x = em.idx % W.sx, z = ((em.idx / W.sx) | 0) % W.sz, y = (em.idx / (W.sx * W.sz)) | 0;
    const p = [x + 0.5 + F[0] * 0.25, y + 0.55, z + 0.5 + F[2] * 0.25];
    const wp = new THREE.Vector3(p[0] + o[0], p[1] + o[1], p[2] + o[2]);
    const range = conf.range ?? em.level * 1.3 + 4;
    // beam length: march until an opaque voxel
    let len = range;
    for (let t = 0.6; t < range; t += 0.25) {
      const q = [p[0] + dir.x * t, p[1] + dir.y * t, p[2] + dir.z * t].map(Math.floor);
      if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[0] >= W.sx || q[1] >= W.sy || q[2] >= W.sz) { len = t; break; }
      if (W.full[q[0] + W.sx * (q[2] + W.sz * q[1])]) { len = t; break; }
    }
    const tgt = wp.clone().addScaledVector(dir, Math.max(2, len));
    const vis = frustum.intersectsSphere(new THREE.Sphere(tgt, 4)) || frustum.intersectsSphere(new THREE.Sphere(wp, 2));
    if (!vis) continue;
    spots.push({ ...em, conf, p, wp, dir, len, range, tgt, dist: wp.distanceTo(cam.position) });
  }
  spots.sort((a, b) => a.dist - b.dist);
  spots.splice(S.lights.maxSpots ?? 6);
  spots.forEach((sp, k) => { sp.shadow = k < (S.lights.spotShadows ?? 3); });
  const spotIdx = new Set(spots.map((sp) => sp.idx));
  // cluster point-type emitters on a 3-block grid per colour
  const clusters = new Map();
  for (const em of W.emitters) {
    if (spotIdx.has(em.idx) || spotConf(em.name)) continue;
    if (em.type === 'static' && !S.lights.includeStatic) continue;
    if (em.level < (S.lights.minLevel ?? 6)) continue;
    const p = lightPosition(W, em.idx);
    const key = `${Math.floor(p[0] / 3)},${Math.floor(p[1] / 3)},${Math.floor(p[2] / 3)},${em.color}`;
    let c = clusters.get(key);
    if (!c) { c = { p: [0, 0, 0], n: 0, level: 0, color: em.color, names: new Set(), full: false }; clusters.set(key, c); }
    c.p[0] += p[0]; c.p[1] += p[1]; c.p[2] += p[2]; c.n++; c.level = Math.max(c.level, em.level); c.names.add(em.name); c.full ||= em.full;
  }
  const cand = [];
  for (const c of clusters.values()) {
    const p = c.p.map((v) => v / c.n);
    const wp = new THREE.Vector3(p[0] + o[0], p[1] + o[1], p[2] + o[2]);
    const dist = wp.distanceTo(cam.position);
    const range = c.level * 1.1 + 2;
    if (dist > (S.lights.maxDistance ?? 48)) continue;
    const inFrustum = frustum.intersectsSphere(new THREE.Sphere(wp, range * 0.7));
    if (!inFrustum) continue;
    const los = lineOfSight(W, camL, p);
    const ahead = Math.max(0.15, wp.clone().sub(cam.position).normalize().dot(fwd));
    const score = (c.level * c.level) * Math.sqrt(c.n) / (4 + dist * dist * 0.15) * (los ? 1 : 0.35) * (0.4 + ahead);
    cand.push({ ...c, p, wp, dist, los, score, range });
  }
  cand.sort((a, b) => b.score - a.score);
  const max = S.lights.max ?? 8;
  const sel = cand.slice(0, max);
  const shadowN = S.lights.shadows ?? 2;
  [...sel].filter((c) => c.los || c.dist < 10).sort((a, b) => b.score - a.score).slice(0, shadowN).forEach((c) => { c.shadow = true; });
  return { selected: sel, candidates: cand.length, spots };
}

// ------------------------------------------------------------------ entities
async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`); return r.json(); }

async function buildEntity(E, W, style, U, scene) {
  const geo = await json(E.geo);
  const anim = E.anim ? await json(E.anim) : null;
  const map = await loadTex(E.texture, { mips: true });
  let mat;
  if (style === 'classic') { mat = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5 }); injectLight(mat, U, { classic: true }); }
  else {
    mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: E.roughness ?? 0.62, metalness: E.metalness ?? 0.12 });
    if (E.pbr) { const p = await loadTex(E.pbr, { srgb: false }); mat.roughnessMap = p; mat.metalnessMap = p; mat.roughness = 1; mat.metalness = 1; }
    if (E.emissive && E.eyes !== false) { mat.emissiveMap = await loadTex(E.emissive); mat.emissive = new THREE.Color(1, 1, 1); mat.emissiveIntensity = E.eyeIntensity ?? 8; }
    injectLight(mat, U, { classic: false });
  }
  if (style === 'classic' && E.emissive && E.eyes !== false) { /* classic: eyes stay texture-coloured */ }
  const model = buildModel(geo, mat);
  const a = anim?.animations?.[E.animName];
  if (E.animName && !a) log(`entity ${E.id}: animation ${E.animName} not found`);
  applyAnimation(model, a, E.t ?? 0);
  const holder = new THREE.Group();
  holder.add(model.root);
  holder.position.set(...E.pos);
  holder.rotation.y = Math.PI - (E.yaw ?? 0) * Math.PI / 180;
  holder.scale.setScalar(E.scale ?? 1);
  scene.add(holder);
  holder.updateMatrixWorld(true);
  // per-vertex baked light
  const o = W.origin, out = [0, 0, 0, 0, 1];
  const v = new THREE.Vector3(), nn = new THREE.Vector3(), nm = new THREE.Matrix3();
  holder.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    const g = m.geometry, pos = g.attributes.position, nor = g.attributes.normal;
    nm.getNormalMatrix(m.matrixWorld);
    const bl = new Float32Array(pos.count * 3), sk = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
      nn.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
      sampleLight(W, v.x - o[0] + nn.x * 0.35, v.y - o[1] + nn.y * 0.35, v.z - o[2] + nn.z * 0.35, out);
      bl[k * 3] = out[0]; bl[k * 3 + 1] = out[1]; bl[k * 3 + 2] = out[2]; sk[k] = out[3];
    }
    g.setAttribute('bl', new THREE.BufferAttribute(bl, 3));
    g.setAttribute('sk', new THREE.BufferAttribute(sk, 1));
  });
  return holder;
}

// ------------------------------------------------------------------ signs
function signTexture(lines) {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#141210';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const ls = (lines || []).slice(0, 4);
  ls.forEach((t, k) => {
    let size = 17;
    g.font = `bold ${size}px "DejaVu Sans Mono", "Liberation Mono", monospace`;
    while (g.measureText(t).width > 176 && size > 8) { size--; g.font = `bold ${size}px "DejaVu Sans Mono", monospace`; }
    g.fillText(String(t), 96, 96 * (0.5 + (k - 1.5) * 0.235));
  });
  // hard alpha (pixel look)
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let k = 3; k < d.data.length; k += 4) d.data[k] = d.data[k] > 110 ? 255 : 0;
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ post
const CameraFeedShader = {
  uniforms: { tDiffuse: { value: null }, seed: { value: 1.0 }, grain: { value: 0.09 }, scan: { value: 0.16 }, vignette: { value: 0.55 }, distort: { value: 0.12 }, tint: { value: new THREE.Color('#a9c2a2') }, chroma: { value: 0.1 }, gamma: { value: 0.8 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float seed, grain, scan, vignette, distort, chroma, gamma; uniform vec3 tint; varying vec2 vUv;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21) + seed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 c = vUv - 0.5; float r2 = dot(c, c);
  vec2 uv = 0.5 + c * (1.0 - distort * 0.25 + distort * r2);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 col = texture2D(tDiffuse, uv).rgb;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  l = pow(clamp(l, 0.0, 1.0), gamma);
  vec3 g = l * tint * 1.08;
  g = mix(g, col * 0.9, chroma);
  float n = hash(floor(gl_FragCoord.xy)) - 0.5;
  float n2 = hash(floor(gl_FragCoord.xy * 0.5) + 7.0) - 0.5;
  g += (n * 0.75 + n2 * 0.5) * grain;
  float s = mod(floor(gl_FragCoord.y), 3.0) < 1.0 ? 1.0 - scan : 1.0;
  g *= s;
  g *= 1.0 - vignette * smoothstep(0.08, 0.5, r2);
  gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
}`,
};

// ------------------------------------------------------------------ main
const cacheWorlds = new Map();
window.hasWorld = (key) => cacheWorlds.has(key);

const STYLE_DEFAULTS = {
  vibrant: { exposure: 1.0, block: 0.8, curve: 1.3, sky: '#1d2740', skyInt: 0.55, amb: '#020203', faceDim: 0.3, spec: 0.5, lightScale: 1.0, bloom: { strength: 0.45, radius: 0.45, threshold: 0.9 }, fog: { color: '#07080c', density: 0.03 }, emissive: 2.4, normal: 1.0 },
  classic: { exposure: 1.0, block: 1.0, sky: '#3a4566', skyInt: 0.8, amb: '#060607', faceDim: 1.0, spec: 0, lightScale: 0, bloom: null, fog: { color: '#0a0b10', density: 0.02 }, gamma: 2.2 },
  camera_feed: { exposure: 1.5, block: 1.2, curve: 1.2, sky: '#2a3550', skyInt: 0.6, amb: '#262626', faceDim: 0.4, spec: 0.4, lightScale: 0.6, bloom: { strength: 0.35, radius: 0.5, threshold: 0.95 }, fog: { color: '#0d0f0d', density: 0.022 }, emissive: 2.0, normal: 0.8 },
};

window.renderWorld = async (payload) => {
  logs.length = 0;
  const T0 = now();
  const S0 = payload.scene;
  const style = S0.style ?? 'vibrant';
  const D = STYLE_DEFAULTS[style] ?? STYLE_DEFAULTS.vibrant;
  const S = { ...S0, lights: { ...(S0.lights || {}) } };
  if (S.time === 'day') { // simple daylight preset: bright sky light + shadowed sun (night is the default)
    S.lighting = { sky: '#d8e4ff', skyIntensity: 1.0, ambient: '#101214', ...(S.lighting || {}) };
    S.fog = S.fog === null ? null : { color: '#a9bcd6', density: 0.006, ...(S.fog || {}) };
    S.background = S.background ?? '#8fb3e8';
    S.sun = S.sun ?? { dir: [-0.45, -0.8, -0.35], color: '#fff3df', intensity: 2.2 };
  }
  // ---- world (cached)
  let W = cacheWorlds.get(payload.worldKey);
  if (!W) {
    W = prepareWorld(payload.world);
    computeLight(W);
    meshWorld(W);
    cacheWorlds.set(payload.worldKey, W);
  }
  const o = W.origin;
  // ---- renderer
  const width = S.width ?? 1920, height = S.height ?? 1080;
  if (!window.__renderer) {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    window.__renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    window.__renderer.setPixelRatio(1);
  }
  const renderer = window.__renderer;
  renderer.setSize(width, height);
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.shadowMap.enabled = style !== 'classic';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = style === 'classic' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = (S.exposure ?? 1) * D.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // ---- uniforms
  const U = LIGHT_UNIFORMS();
  const L = S.lighting || {};
  U.uBlock.value = L.block ?? D.block;
  U.uSky.value = new THREE.Color(L.sky ?? D.sky).multiplyScalar(L.skyIntensity ?? D.skyInt);
  U.uAmb.value = new THREE.Color(L.ambient ?? D.amb);
  U.uFaceDim.value = L.faceDim ?? D.faceDim;
  U.uSpec.value = L.spec ?? D.spec;
  U.uGamma.value = D.gamma ?? 1;
  U.uCurve.value = L.curve ?? D.curve ?? 1;
  U.uBright.value = L.brightness ?? 0.5; // classic: Minecraft brightness/gamma option (0..1)
  U.__emissive = L.emissive ?? D.emissive;
  U.__normal = L.normal ?? D.normal;
  // ---- scene
  const scene = new THREE.Scene();
  const fogS = S.fog === null ? null : { ...D.fog, ...(S.fog || {}) };
  if (fogS && fogS.density > 0) scene.fog = new THREE.FogExp2(fogS.color, fogS.density);
  scene.background = new THREE.Color(S.background ?? fogS?.color ?? '#05060a');
  const worldGroup = new THREE.Group();
  worldGroup.position.set(o[0], o[1], o[2]);
  scene.add(worldGroup);
  const t1 = now();
  const mats = new Map();
  await Promise.all([...W.matInfo.entries()].map(async ([k, info]) => mats.set(k, await makeWorldMaterial(info, W, style, U))));
  for (const C of W.chunks) {
    if (!C.geom) { C.geom = C.builder.geometry(); C.builder = null; }
    const m = new THREE.Mesh(C.geom, mats.get(C.matKey));
    m.position.set(...C.origin);
    m.castShadow = style !== 'classic' && mats.get(C.matKey).transparent !== true;
    m.receiveShadow = true;
    if (mats.get(C.matKey).transparent) m.renderOrder = 1;
    worldGroup.add(m);
  }
  log(`materials ${mats.size} ready in ${(now() - t1).toFixed(0)} ms`);
  // ---- signs
  for (const a of W.signAnchors) {
    const s = W.signs.find((g) => g.pos[0] - o[0] === a.x && g.pos[1] - o[1] === a.y && g.pos[2] - o[2] === a.z);
    if (!s || !s.lines?.some((l) => String(l).trim())) continue;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(12), bl = new Float32Array(12), sk = new Float32Array(4), out = [0, 0, 0, 0, 1];
    for (let k = 0; k < 4; k++) {
      p[k * 3] = a.x + a.q.p[k * 3] + a.q.n[0] * 0.002; p[k * 3 + 1] = a.y + a.q.p[k * 3 + 1] + a.q.n[1] * 0.002; p[k * 3 + 2] = a.z + a.q.p[k * 3 + 2] + a.q.n[2] * 0.002;
      sampleLight(W, p[k * 3] + a.q.n[0] * 0.5, p[k * 3 + 1] + a.q.n[1] * 0.5, p[k * 3 + 2] + a.q.n[2] * 0.5, out);
      bl[k * 3] = out[0]; bl[k * 3 + 1] = out[1]; bl[k * 3 + 2] = out[2]; sk[k] = out[3];
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([...a.q.n, ...a.q.n, ...a.q.n, ...a.q.n]), 3));
    g.setAttribute('bl', new THREE.BufferAttribute(bl, 3)); g.setAttribute('sk', new THREE.BufferAttribute(sk, 1));
    g.setIndex([0, 3, 2, 0, 2, 1]);
    const tex = signTexture(s.lines);
    const mat = style === 'classic' ? new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5 }) : new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.9 });
    injectLight(mat, U, { classic: style === 'classic' });
    worldGroup.add(new THREE.Mesh(g, mat));
  }
  // ---- camera
  const cam = new THREE.PerspectiveCamera(S.camera?.fov ?? 70, width / height, 0.05, 400);
  cam.position.set(...S.camera.pos);
  cam.lookAt(new THREE.Vector3(...S.camera.target));
  if (S.camera.roll) cam.rotateZ(S.camera.roll * Math.PI / 180);
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  // ---- real lights
  const lightScale = (S.lights.scale ?? 1) * D.lightScale;
  let lightInfo = { selected: [], candidates: 0 };
  if (lightScale > 0 && style !== 'classic') {
    lightInfo = selectLights(W, cam, S);
    for (const c of lightInfo.selected) {
      const col = new THREE.Color(c.color);
      const I = lightScale * (S.lights.intensity ?? 16) * Math.pow(c.level / 15, 2) * Math.pow(c.n, 0.5) * (c.full ? 1.5 : 0.55);
      const pl = new THREE.PointLight(col, I, c.range, 2);
      pl.position.copy(c.wp);
      if (c.shadow) {
        pl.castShadow = true; pl.shadow.mapSize.set(S.lights.shadowSize ?? 768, S.lights.shadowSize ?? 768);
        pl.shadow.bias = -0.003; pl.shadow.normalBias = 0.03; pl.shadow.radius = 3; pl.shadow.camera.near = 0.1; pl.shadow.camera.far = c.range;
      }
      scene.add(pl);
    }
    for (const sp of lightInfo.spots) {
      const C = sp.conf;
      const l = new THREE.SpotLight(new THREE.Color(sp.color), lightScale * (C.intensity ?? 90) * Math.pow(sp.level / 15, 2), sp.range, (C.angle ?? 24) * Math.PI / 180, C.penumbra ?? 0.45, 2);
      l.position.copy(sp.wp); l.target.position.copy(sp.tgt);
      scene.add(l.target);
      if (sp.shadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0015; l.shadow.normalBias = 0.03; l.shadow.camera.near = 0.2; }
      scene.add(l);
      // volumetric-looking beam in the haze
      const beam = S.beams ?? (style === 'classic' ? 0 : 1);
      if (beam > 0 && fogS) {
        const len = sp.len, rad = Math.tan((C.angle ?? 24) * Math.PI / 180) * len;
        const geo = new THREE.ConeGeometry(rad, len, 32, 1, true);
        geo.translate(0, -len / 2, 0);
        const mat = new THREE.ShaderMaterial({
          uniforms: { col: { value: new THREE.Color(sp.color) }, strength: { value: 0.15 * beam * Math.min(2, fogS.density / 0.03) }, len: { value: len } },
          vertexShader: 'varying float vT; varying vec3 vN; varying vec3 vV; uniform float len; void main(){ vT = -position.y / len; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
          fragmentShader: 'uniform vec3 col; uniform float strength; varying float vT; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = strength * pow(1.0 - clamp(vT,0.0,1.0), 1.8) * edge; gl_FragColor = vec4(col * a, 1.0); }',
          blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(sp.wp);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), sp.dir);
        m.renderOrder = 2;
        scene.add(m);
      }
    }
    if (lightInfo.spots.length) log(`spot lights: ${lightInfo.spots.length} (${lightInfo.spots.map((sp) => sp.name).join(', ')})`);
    log(`real lights: ${lightInfo.selected.length}/${lightInfo.candidates} (shadows ${lightInfo.selected.filter((c) => c.shadow).length}): ` + lightInfo.selected.map((c) => `${[...c.names][0]}@${c.wp.toArray().map((v) => v.toFixed(1)).join(',')}x${c.n}${c.shadow ? '*' : ''}`).join(' '));
  }
  for (const X of S.extra_lights || []) {
    let l;
    const col = new THREE.Color(X.color ?? '#ffffff');
    if (X.type === 'spot') {
      l = new THREE.SpotLight(col, X.intensity ?? 10, X.distance ?? 0, (X.angle ?? 30) * Math.PI / 180, X.penumbra ?? 0.4, X.decay ?? 2);
      l.target.position.set(...(X.target ?? [X.pos[0], X.pos[1] - 1, X.pos[2]])); scene.add(l.target);
    } else if (X.type === 'ambient') l = new THREE.AmbientLight(col, X.intensity ?? 0.1);
    else if (X.type === 'dir') { l = new THREE.DirectionalLight(col, X.intensity ?? 1); l.target.position.set(...(X.target ?? [0, 0, 0])); scene.add(l.target); }
    else l = new THREE.PointLight(col, X.intensity ?? 5, X.distance ?? 0, X.decay ?? 2);
    if (X.pos) l.position.set(...X.pos);
    if (X.shadow && l.shadow) {
      l.castShadow = true; l.shadow.mapSize.set(X.shadowMapSize ?? 1024, X.shadowMapSize ?? 1024); l.shadow.bias = -0.002; l.shadow.normalBias = 0.03;
      if (X.type === 'dir') { const c = l.shadow.camera, e = X.shadowExtent ?? 30; c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 0.5; c.far = X.shadowFar ?? 200; c.updateProjectionMatrix(); l.shadow.bias = -0.0005; }
    }
    scene.add(l);
  }
  if (S.sun) {
    const d = new THREE.Vector3(...(S.sun.dir ?? [-0.45, -0.8, -0.35])).normalize();
    const c = new THREE.Vector3(o[0] + W.sx / 2, o[1] + W.sy / 2, o[2] + W.sz / 2);
    const ext = Math.max(W.sx, W.sy, W.sz) * 0.75;
    const l = new THREE.DirectionalLight(new THREE.Color(S.sun.color ?? '#fff3df'), S.sun.intensity ?? 2.2);
    l.position.copy(c).addScaledVector(d, -ext * 2); l.target.position.copy(c); scene.add(l.target);
    if (style !== 'classic') { l.castShadow = true; l.shadow.mapSize.set(2048, 2048); const sc = l.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 0.5; sc.far = ext * 4; l.shadow.bias = -0.0006; l.shadow.normalBias = 0.04; }
    scene.add(l);
  }
  // ---- halos (light scattering in the haze)
  const haloStrength = S.halo ?? (style === 'classic' ? 0 : 1);
  if (haloStrength > 0 && fogS) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const ht = new THREE.CanvasTexture(c);
    const sel = lightInfo.selected;
    for (const L2 of sel) {
      const m = new THREE.SpriteMaterial({ map: ht, color: new THREE.Color(L2.color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: Math.min(1, 0.06 * haloStrength * (L2.level / 15) * Math.sqrt(L2.n) * (fogS.density / 0.03)), fog: false });
      const sp = new THREE.Sprite(m);
      sp.position.copy(L2.wp);
      const sz = 2.2 + L2.level * 0.22;
      sp.scale.set(sz, sz, 1);
      scene.add(sp);
    }
  }
  // ---- entities
  const ents = [];
  const tEnt = now();
  for (const E of payload.entities || []) {
    try { ents.push(await buildEntity(E, W, style, U, scene)); } catch (err) { log(`entity ${E.id} failed: ${err.message}`); }
  }
  // ---- render
  const t2 = now();
  let composer = null;
  const bloomS = S.bloom === null ? null : (D.bloom ? { ...D.bloom, ...(S.bloom || {}) } : (S.bloom || null));
  const needPost = style !== 'classic' || bloomS;
  if (needPost) {
    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: S.msaa ?? 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, cam));
    if (bloomS && bloomS.strength > 0) composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), bloomS.strength, bloomS.radius, bloomS.threshold));
    composer.addPass(new OutputPass());
    if (style === 'camera_feed') {
      const cf = new ShaderPass(CameraFeedShader);
      const F = S.camera_feed || {};
      for (const k of ['grain', 'scan', 'vignette', 'distort', 'chroma', 'gamma']) if (F[k] !== undefined) cf.uniforms[k].value = F[k];
      if (F.tint) cf.uniforms.tint.value = new THREE.Color(F.tint);
      cf.uniforms.seed.value = F.seed ?? 0.37;
      composer.addPass(cf);
    }
    composer.render();
  } else renderer.render(scene, cam);
  const gl = renderer.getContext();
  { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  log(`entities ${ents.length}: ${(t2 - tEnt).toFixed(0)} ms`);
  log(`render ${width}x${height} ${style}: ${(now() - t2).toFixed(0)} ms (draw calls ${renderer.info.render.calls}, tris ${renderer.info.render.triangles})`);
  const t3 = now();
  const png = renderer.domElement.toDataURL('image/png');
  log(`png encode ${(now() - t3).toFixed(0)} ms`);
  // cleanup (keep world geometry cached)
  for (const m of mats.values()) m.dispose();
  composer?.dispose?.();
  scene.traverse((x) => { if (x.isLight && x.shadow?.map) x.shadow.map.dispose(); });
  log(`total ${(now() - T0).toFixed(0)} ms`);
  return { png, log: logs.slice() };
};
window.__ready = true;
