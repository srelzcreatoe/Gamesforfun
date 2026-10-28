// Browser module for preview3d.mjs: builds a voxel scene from fnar block
// definitions (packs/BP/blocks), resolves textures through terrain_texture.json
// and texture sets (MER -> metal/emissive/roughness, heightmap -> bump), adds
// point lights for light-emitting blocks and renders with bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildModel } from '/bedrock_model.js';

const cache = new Map();
const once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const json = (u) => once('j:' + u, () => fetch(u).then((r) => (r.ok ? r.json() : null)));
const img = (u) => once('i:' + u, () => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = u; }));

function canvasOf(image) {
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0);
  return [c, g.getImageData(0, 0, c.width, c.height)];
}
function tex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

async function material(short, opts = {}) {
  return once(`m:${short}:${opts.style}:${opts.dim}`, async () => {
    const terrain = await json('/RP/textures/terrain_texture.json');
    const entry = terrain.texture_data[short];
    if (!entry) throw new Error('no terrain texture ' + short);
    const path = Array.isArray(entry.textures) ? entry.textures[0] : entry.textures;
    const dir = path.split('/').slice(0, -1).join('/');
    const col = await img(`/RP/${path}.png`);
    const ts = await json(`/RP/${path}.texture_set.json`);
    const [cc, cd] = canvasOf(col);
    const m = new THREE.MeshStandardMaterial({ map: tex(cc, true), alphaTest: 0.5, side: THREE.FrontSide });
    if (ts && opts.style !== 'flat') {
      const s = ts['minecraft:texture_set'];
      const mer = await img(`/RP/${dir}/${s.metalness_emissive_roughness}.png`);
      if (mer) {
        const [, md] = canvasOf(mer);
        const w = col.width, h = col.height;
        const orm = document.createElement('canvas'); orm.width = w; orm.height = h;
        const emi = document.createElement('canvas'); emi.width = w; emi.height = h;
        const od = orm.getContext('2d').createImageData(w, h);
        const ed = emi.getContext('2d').createImageData(w, h);
        let anyEmit = false;
        for (let i = 0; i < w * h; i++) {
          const r = md.data[i * 4], g = md.data[i * 4 + 1], b = md.data[i * 4 + 2];
          od.data[i * 4] = 255; od.data[i * 4 + 1] = b; od.data[i * 4 + 2] = r; od.data[i * 4 + 3] = 255;
          for (let k = 0; k < 3; k++) ed.data[i * 4 + k] = cd.data[i * 4 + k] * g / 255;
          ed.data[i * 4 + 3] = 255;
          if (g > 0) anyEmit = true;
        }
        orm.getContext('2d').putImageData(od, 0, 0);
        emi.getContext('2d').putImageData(ed, 0, 0);
        m.roughnessMap = tex(orm, false); m.metalnessMap = m.roughnessMap; m.roughness = 1; m.metalness = 1;
        if (anyEmit) { m.emissiveMap = tex(emi, true); m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = opts.emissive ?? 2.2; }
      }
      const hgt = s.heightmap ? await img(`/RP/${dir}/${s.heightmap}.png`) : null;
      if (hgt) { const [hc] = canvasOf(hgt); m.bumpMap = tex(hc, false); m.bumpScale = opts.bump ?? 1.2; }
    } else {
      m.roughness = 0.9; m.metalness = 0;
    }
    return m;
  });
}

// ---------------------------------------------------------------- block definitions
function parseValue(s) {
  s = s.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^'.*'$/.test(s)) return s.slice(1, -1);
  return Number(s);
}
function evalCond(cond, st) {
  return cond.split('||').some((alt) => alt.split('&&').every((term) => {
    const m = term.match(/(?:query|q)\.block_state\(\s*'([^']+)'\s*\)\s*(==|!=)\s*(.+)/);
    if (!m) return false;
    const v = st[m[1]]; const want = parseValue(m[3]);
    return m[2] === '==' ? v === want : v !== want;
  }));
}
async function resolve(name, states) {
  const def = await json(`/BP/blocks/${name}.json`);
  if (!def) throw new Error('no block ' + name);
  const b = def['minecraft:block'];
  const st = {};
  for (const [k, v] of Object.entries(b.description.states || {})) st[k] = Array.isArray(v) ? v[0] : (v.values?.min ?? v.values?.[0]);
  if (b.description.traits?.['minecraft:placement_direction']) st['minecraft:cardinal_direction'] = 'north';
  Object.assign(st, states || {});
  const comps = { ...b.components };
  for (const p of b.permutations || []) if (evalCond(p.condition, st)) Object.assign(comps, p.components);
  return comps;
}
function instTexture(mi, face) {
  let e = mi[face] ?? mi['*'];
  for (let i = 0; i < 4 && typeof e === 'string'; i++) e = mi[e];
  return e?.texture;
}

const FACES = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };

window.renderBlocks = async (S) => {
  const W = S.width ?? 1280, H = S.height ?? 720;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = S.exposure ?? 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(S.background ?? '#050507');
  if (S.fog) scene.fog = new THREE.FogExp2(S.fog.color, S.fog.density);
  const flat = S.style === 'flat';
  if (!flat && S.env !== 0) {
    // dim reflection environment so metals/gloss read roughly like Vibrant Visuals' probes
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = S.env ?? 0.12;
  }
  scene.add(new THREE.HemisphereLight(S.hemi?.sky ?? '#8890a8', S.hemi?.ground ?? '#201a14', S.hemi?.intensity ?? (flat ? 2.2 : 0.12)));
  if (flat) { const d = new THREE.DirectionalLight('#ffffff', 1.6); d.position.set(4, 9, 7); scene.add(d); }
  const lighting = (await json('/RP/local_lighting/local_lighting.json'))?.['minecraft:local_light_settings'] ?? {};

  const occ = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const resolved = [];
  for (const B of S.blocks) {
    const c = await resolve(B.name, B.states);
    resolved.push([B, c]);
    if (c['minecraft:geometry'] === 'minecraft:geometry.full_block') occ.set(key(...B.pos), true);
  }
  const lights = [];
  for (const [B, c] of resolved) {
    const [x, y, z] = B.pos;
    const mi = c['minecraft:material_instances'] || {};
    const rot = c['minecraft:transformation']?.rotation?.[1] ?? 0;
    if (c['minecraft:geometry'] === 'minecraft:geometry.full_block') {
      for (const [face, n] of Object.entries(FACES)) {
        if (occ.has(key(x + n[0], y + n[1], z + n[2]))) continue;
        const t = instTexture(mi, face);
        const mat = await material(t, { style: S.style, emissive: S.emissive, bump: S.bump });
        const g = new THREE.PlaneGeometry(1, 1);
        const mesh = new THREE.Mesh(g, mat);
        mesh.position.set(x + 0.5 + n[0] * 0.5, y + 0.5 + n[1] * 0.5, z + 0.5 + n[2] * 0.5);
        mesh.lookAt(mesh.position.x + n[0], mesh.position.y + n[1], mesh.position.z + n[2]);
        if (face === 'up' || face === 'down') mesh.rotateZ(Math.PI);
        mesh.receiveShadow = true; mesh.castShadow = true;
        scene.add(mesh);
      }
    } else {
      const id = c['minecraft:geometry'];
      const file = id.replace('geometry.fnar.', '');
      const geo = await json(`/RP/models/blocks/${file}.geo.json`);
      const mat = await material(instTexture(mi, 'north'), { style: S.style, emissive: S.emissive, bump: S.bump });
      const model = buildModel(geo, mat);
      const holder = new THREE.Group();
      holder.position.set(x + 0.5, y, z + 0.5);
      holder.rotation.y = rot * Math.PI / 180;
      holder.add(model.root);
      scene.add(holder);
    }
    const lvl = c['minecraft:light_emission'] ?? 0;
    if (lvl > 0 && !flat) {
      const ll = lighting[`fnar:${B.name}`];
      const off = B.lightOffset ?? [0, 0.5, 0];
      const p = new THREE.Vector3(off[0], off[1], off[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * Math.PI / 180);
      lights.push({ pos: [x + 0.5 + p.x, y + p.y, z + 0.5 + p.z], color: ll?.light_color ?? '#ffd9a0', level: lvl, name: B.name, rot, spot: B.spot });
    }
  }
  // the brightest / nearest lights become real lights
  const cam = new THREE.Vector3(...S.camera.pos);
  lights.sort((a, b) => (b.level - a.level) || (cam.distanceTo(new THREE.Vector3(...a.pos)) - cam.distanceTo(new THREE.Vector3(...b.pos))));
  let shadows = S.shadows ?? 2;
  for (const L of lights.slice(0, S.maxLights ?? 10)) {
    const inten = (S.lightScale ?? 0.35) * L.level;
    let l;
    if (L.spot) {
      l = new THREE.SpotLight(L.color, inten * 3, 14, 0.5, 0.5, 1.6);
      l.position.set(...L.pos);
      l.target.position.set(...L.spot);
      scene.add(l.target);
    } else {
      l = new THREE.PointLight(L.color, inten, L.level * 0.9, 1.6);
      l.position.set(...L.pos);
    }
    if (shadows-- > 0) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.002; }
    scene.add(l);
  }
  for (const E of S.extra_lights || []) { const l = new THREE.PointLight(E.color, E.intensity, E.distance ?? 0, 1.6); l.position.set(...E.pos); scene.add(l); }

  const camera = new THREE.PerspectiveCamera(S.camera.fov ?? 60, W / H, 0.05, 200);
  camera.position.set(...S.camera.pos); camera.lookAt(new THREE.Vector3(...S.camera.target));
  if (S.camera.ortho) {
    const k = S.camera.ortho;
    const oc = new THREE.OrthographicCamera(-k * W / H, k * W / H, k, -k, 0.05, 200);
    oc.position.copy(camera.position); oc.lookAt(new THREE.Vector3(...S.camera.target));
    renderer.render(scene, oc);
  } else if (flat || S.bloom === false) {
    renderer.render(scene, camera);
  } else {
    const comp = new EffectComposer(renderer);
    comp.addPass(new RenderPass(scene, camera));
    const bl = S.bloomParams ?? { strength: 0.7, radius: 0.5, threshold: 0.75 };
    comp.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), bl.strength, bl.radius, bl.threshold));
    comp.addPass(new OutputPass());
    comp.render();
  }
  const url = renderer.domElement.toDataURL('image/png');
  renderer.dispose(); renderer.forceContextLoss();
  return url;
};
window.__blocksReady = true;
