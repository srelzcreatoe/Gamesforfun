// Browser module for prop previews (loaded into tools/render/page.html by preview.mjs).
// Builds Bedrock block geometry with per-face material instances (Blockbench conventions,
// same maths as tools/render/bedrock_model.js), MER texture sets, flipbook frames and
// minecraft:transformation rotations, and renders a labelled contact sheet.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const D2R = Math.PI / 180;
const FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north']; // BoxGeometry px nx py ny pz nz
const imgCache = new Map();
function loadImg(url) {
  if (!imgCache.has(url)) imgCache.set(url, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img ' + url)); i.src = url; }));
  return imgCache.get(url);
}
function canvasOf(img, frame) {
  const w = img.width, fh = frame == null ? img.height : w;
  const c = document.createElement('canvas'); c.width = w; c.height = fh;
  const g = c.getContext('2d'); g.drawImage(img, 0, frame == null ? 0 : -frame * w);
  return c;
}
function texOf(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = true;
  return t;
}
const matCache = new Map();
async function material(spec, S) {
  const key = JSON.stringify(spec) + S.lighting;
  if (matCache.has(key)) return matCache.get(key);
  const p = (async () => {
    const [ci, mi, hi] = await Promise.all([loadImg(spec.color), spec.mer ? loadImg(spec.mer) : null, spec.height ? loadImg(spec.height) : null]);
    const frame = spec.flip ? (spec.frame ?? 0) % Math.max(1, Math.round(ci.height / ci.width)) : null;
    const cc = canvasOf(ci, frame);
    const m = new THREE.MeshStandardMaterial({ map: texOf(cc, true), roughness: 1, metalness: 1 });
    if (mi) {
      const mc = canvasOf(mi, frame);
      const md = mc.getContext('2d').getImageData(0, 0, mc.width, mc.height);
      const cd = cc.getContext('2d').getImageData(0, 0, cc.width, cc.height);
      const mr = document.createElement('canvas'); mr.width = mc.width; mr.height = mc.height;
      const em = document.createElement('canvas'); em.width = mc.width; em.height = mc.height;
      const mrd = mr.getContext('2d').createImageData(mc.width, mc.height);
      const emd = em.getContext('2d').createImageData(mc.width, mc.height);
      let anyE = false;
      for (let i = 0; i < md.data.length; i += 4) {
        const R = md.data[i], G = md.data[i + 1], B = md.data[i + 2];
        mrd.data[i] = 0; mrd.data[i + 1] = B; mrd.data[i + 2] = R; mrd.data[i + 3] = 255;
        const e = G / 255; if (G > 0) anyE = true;
        emd.data[i] = cd.data[i] * e; emd.data[i + 1] = cd.data[i + 1] * e; emd.data[i + 2] = cd.data[i + 2] * e; emd.data[i + 3] = 255;
      }
      mr.getContext('2d').putImageData(mrd, 0, 0); em.getContext('2d').putImageData(emd, 0, 0);
      const mrt = texOf(mr, false);
      m.roughnessMap = mrt; m.metalnessMap = mrt;
      if (anyE) { m.emissiveMap = texOf(em, true); m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = S.lighting === 'night' ? 2.2 : 1.3; }
    } else { m.roughness = 0.8; m.metalness = 0; }
    if (hi && S.bump !== false) { m.bumpMap = texOf(canvasOf(hi, frame), false); m.bumpScale = 0.6; }
    const rm = spec.render || 'alpha_test';
    if (rm === 'opaque') { m.side = THREE.FrontSide; } else { m.side = THREE.DoubleSide; m.alphaTest = 0.5; }
    if (rm === 'blend') { m.transparent = true; m.alphaTest = 0.01; }
    m.shadowSide = THREE.DoubleSide;
    return m;
  })();
  matCache.set(key, p);
  return p;
}

function bbRot(r) { return new THREE.Euler(-(r?.[0] || 0) * D2R, -(r?.[1] || 0) * D2R, (r?.[2] || 0) * D2R, 'ZYX'); }
function faceUVs(cube) {
  const out = {};
  for (const k of FACE_ORDER) {
    const f = cube.uv?.[k];
    if (!f) { out[k] = null; continue; }
    const [u, v] = f.uv; const [us, vs] = f.uv_size ?? [0, 0];
    out[k] = { r: (k === 'up' || k === 'down') ? [u + us, v + vs, u, v] : [u, v, u + us, v + vs], mi: f.material_instance };
  }
  return out;
}

async function buildBlock(part, S) {
  const geo = part.geo['minecraft:geometry'].find((g) => g.description.identifier === part.identifier);
  if (!geo) throw new Error('no geometry ' + part.identifier);
  const tw = geo.description.texture_width, th = geo.description.texture_height;
  const resolve = async (face, mi) => {
    const M = part.materials;
    const spec = (mi && M[mi]) || M[face] || M['*'];
    return material(spec, S);
  };
  const root = new THREE.Group();
  const nodes = new Map();
  const byName = new Map(geo.bones.map((b) => [b.name, b]));
  const pivotOf = (b) => new THREE.Vector3(-(b.pivot?.[0] || 0), b.pivot?.[1] || 0, b.pivot?.[2] || 0);
  const make = async (b) => {
    if (nodes.has(b.name)) return nodes.get(b.name);
    const node = new THREE.Group();
    const piv = pivotOf(b);
    const parent = b.parent && byName.get(b.parent);
    const ppiv = parent ? pivotOf(parent) : new THREE.Vector3();
    node.position.copy(piv.clone().sub(ppiv).multiplyScalar(1 / 16));
    node.rotation.copy(bbRot(b.rotation));
    nodes.set(b.name, node);
    (parent ? await make(parent) : root).add(node);
    for (const c of b.cubes || []) {
      const [sx, sy, sz] = c.size;
      const g = new THREE.BoxGeometry(Math.max(sx, 0.002) / 16, Math.max(sy, 0.002) / 16, Math.max(sz, 0.002) / 16);
      const uvs = faceUVs(c);
      const uv = g.attributes.uv;
      g.clearGroups();
      const mats = [];
      for (let fi = 0; fi < 6; fi++) {
        const k = FACE_ORDER[fi]; const f = uvs[k];
        if (!f) continue;
        const r = f.r;
        const pts = [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]];
        for (let i = 0; i < 4; i++) uv.setXY(fi * 4 + i, pts[i][0] / tw, 1 - pts[i][1] / th);
        mats.push(await resolve(k, f.mi));
        g.addGroup(fi * 6, 6, mats.length - 1);
      }
      uv.needsUpdate = true;
      const mesh = new THREE.Mesh(g, mats);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const from = new THREE.Vector3(-(c.origin[0] + sx), c.origin[1], c.origin[2]);
      const center = from.clone().add(new THREE.Vector3(sx / 2, sy / 2, sz / 2));
      if (c.rotation) {
        const cp = new THREE.Vector3(-(c.pivot?.[0] || 0), c.pivot?.[1] || 0, c.pivot?.[2] || 0);
        const holder = new THREE.Group();
        holder.position.copy(cp.clone().sub(piv).multiplyScalar(1 / 16));
        holder.rotation.copy(bbRot(c.rotation));
        mesh.position.copy(center.clone().sub(cp).multiplyScalar(1 / 16));
        holder.add(mesh); node.add(holder);
      } else {
        mesh.position.copy(center.clone().sub(piv).multiplyScalar(1 / 16));
        node.add(mesh);
      }
    }
    return node;
  };
  for (const b of geo.bones) await make(b);
  const holder = new THREE.Group();
  holder.add(root);
  holder.rotation.y = (part.rotY || 0) * D2R; // minecraft:transformation rotation (right-handed, Y up)
  holder.position.set(...(part.pos || [0, 0, 0]));
  return holder;
}

function gridTexture(a, b) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * 16, y * 16, 16, 16); }
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 64; i += 16) { g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let envTex = null;
async function renderItem(renderer, it, S) {
  const scene = new THREE.Scene();
  if (!envTex) { const pm = new THREE.PMREMGenerator(renderer); envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; }
  scene.environment = envTex;
  scene.environmentIntensity = S.lighting === 'night' ? 0.1 : 0.7;
  scene.background = new THREE.Color(S.lighting === 'night' ? '#0b0b10' : (S.background ?? '#3a3d46'));
  const night = S.lighting === 'night';
  scene.add(new THREE.HemisphereLight(night ? '#5a6080' : '#e6ecff', night ? '#1a1410' : '#4a4038', night ? 0.35 : 1.0));
  const key = new THREE.DirectionalLight(night ? '#ffd8a8' : '#fff4e2', night ? 0.5 : 2.0);
  key.position.set(...(it.keyLight || [-2.2, 4.0, -3.0])); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); const sc = key.shadow.camera; sc.left = -2; sc.right = 2; sc.top = 3; sc.bottom = -1; sc.near = 0.1; sc.far = 20; key.shadow.bias = -0.0008;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#a8b8ff', night ? 0.15 : 0.6); fill.position.set(3, 1.5, -1); scene.add(fill);
  const rim = new THREE.DirectionalLight('#ffffff', night ? 0.1 : 0.5); rim.position.set(1, 3, 4); scene.add(rim);
  const blockMat = new THREE.MeshStandardMaterial({ map: gridTexture('#4a4a50', '#56565c'), roughness: 0.95 });
  if (it.floor !== false) {
    const fm = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), blockMat);
    fm.material.map.repeat.set(1, 1); fm.rotation.x = -Math.PI / 2; fm.position.set(0, it.floorY ?? 0, 0); fm.receiveShadow = true; scene.add(fm);
  }
  for (const w of it.walls || []) {
    const wm = new THREE.Mesh(new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]), new THREE.MeshStandardMaterial({ map: gridTexture('#5d6670', '#56606a'), roughness: 0.95 }));
    const g = new THREE.Group(); g.add(wm); wm.position.set(...w.pos); g.rotation.y = (w.rotY || 0) * D2R; wm.receiveShadow = true; wm.castShadow = true; scene.add(g);
  }
  for (const p of it.parts) scene.add(await buildBlock(p, S));
  const cam = new THREE.PerspectiveCamera(it.camera?.fov ?? 35, S.tile[0] / S.tile[1], 0.02, 100);
  const tgt = it.camera?.target || it.focus || [0, 0.45, 0];
  let cpos = it.camera?.pos;
  if (!cpos) { const d = it.dist ?? 2.4; const dir = new THREE.Vector3(...(it.dir || [0.62, 0.5, -1])).normalize(); cpos = [tgt[0] + dir.x * d, tgt[1] + dir.y * d, tgt[2] + dir.z * d]; }
  cam.position.set(...cpos); cam.lookAt(new THREE.Vector3(...tgt));
  if (night) { const pl = new THREE.PointLight('#ffc98a', 3, 6, 2); pl.position.set(-1.2, 1.6, -1.5); scene.add(pl); }
  renderer.render(scene, cam);
}

window.renderSheet = async (S) => {
  const [tw, th] = S.tile;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(tw, th);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = S.exposure ?? 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cols = Math.min(S.cols, S.items.length), rows = Math.ceil(S.items.length / cols);
  const head = S.title ? 34 : 0;
  const out = document.createElement('canvas'); out.width = cols * tw; out.height = rows * (th + 22) + head;
  const g = out.getContext('2d'); g.fillStyle = '#18181c'; g.fillRect(0, 0, out.width, out.height);
  if (S.title) { g.fillStyle = '#e8e2d0'; g.font = 'bold 20px monospace'; g.fillText(S.title, 10, 24); }
  for (let i = 0; i < S.items.length; i++) {
    const it = S.items[i];
    await renderItem(renderer, it, S);
    const x = (i % cols) * tw, y = head + Math.floor(i / cols) * (th + 22);
    g.drawImage(renderer.domElement, x, y);
    g.fillStyle = '#d8d2c0'; g.font = '13px monospace'; g.fillText(it.label, x + 6, y + th + 15);
  }
  renderer.dispose(); renderer.forceContextLoss();
  return out.toDataURL('image/png');
};
window.__propsReady = true;
