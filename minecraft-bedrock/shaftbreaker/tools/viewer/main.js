// Shaftbreaker preview renderer. Loads the REAL resource-pack files
// (geometry, texture, animations) and renders them with Bedrock semantics.
// Driven from tools/render.mjs via window.sb.* (deterministic, frame by frame).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildModel, getGeometry, emissiveAlphaMaterial, poseModel } from '../lib/model.js';
import { makeContext } from '../lib/molang.js';
import { localTime, eventsBetween } from '../lib/anim.js';

const BLOCK = 16; // world units per block
const sb = (window.sb = {});
let renderer, scene, camera, composer, model, entity, cfg, overlay, octx, texture, debris, dust, wallProp;
const animations = {};
const helpers = [];

// ---------------------------------------------------------------- utilities
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function canvasTex(size, paint, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  paint(g, size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function noiseTile(base, spread, seed, extra) {
  return canvasTex(16, (g) => {
    const r = rng(seed);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k = (r() - 0.5) * spread;
        g.fillStyle = `rgb(${base[0] + k},${base[1] + k * 0.95},${base[2] + k * 0.9})`;
        g.fillRect(x, y, 1, 1);
      }
    if (extra) extra(g, r);
  });
}

// ---------------------------------------------------------------- init
sb.init = async (config) => {
  cfg = {
    width: 1024, height: 768, background: 'studio', scale: 0.58, bloom: false, fov: 35, glow: 1.0,
    emissive: true, exposure: 1.0, ...config,
  };
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(cfg.width, cfg.height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = cfg.background === 'mine' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = cfg.exposure;
  document.body.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(cfg.fov, cfg.width / cfg.height, 1, 6000);

  const geoJson = await (await fetch(cfg.geo)).json();
  const geo = getGeometry(geoJson, cfg.geoId);
  texture = await new THREE.TextureLoader().loadAsync(cfg.texture);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = cfg.emissive
    ? emissiveAlphaMaterial(THREE, texture, { glow: cfg.glow })
    : new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
  model = buildModel(THREE, geo, mat);
  entity = new THREE.Group();
  entity.add(model.root);
  model.root.scale.setScalar(cfg.scale);
  scene.add(entity);

  for (const f of cfg.animations || []) {
    const j = await (await fetch(f)).json();
    Object.assign(animations, j.animations || {});
  }
  if (cfg.background === 'mine') buildMine();
  else if (cfg.background === 'studio') buildStudio();
  else scene.background = new THREE.Color(cfg.background || '#202020');

  debris = makeDebrisSystem();
  scene.add(debris.group);

  if (cfg.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(cfg.width, cfg.height), cfg.bloomStrength ?? 0.55, 0.5, cfg.bloomThreshold ?? 0.82));
    composer.addPass(new OutputPass());
  }
  overlay = document.createElement('canvas');
  overlay.width = cfg.width;
  overlay.height = cfg.height;
  octx = overlay.getContext('2d');

  model.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model.root);
  return {
    bones: [...model.bones.keys()],
    animations: Object.keys(animations),
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    cubes: model.root.children.length,
  };
};

// ---------------------------------------------------------------- scenes
function buildStudio() {
  scene.background = new THREE.Color('#5d6066');
  const grid = canvasTex(64, (g, s) => {
    g.fillStyle = '#8c8f94';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#7a7d82';
    g.fillRect(0, 0, s, 2);
    g.fillRect(0, 0, 2, s);
  }, { repeat: true });
  grid.repeat.set(40, 40);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40 * BLOCK, 40 * BLOCK), new THREE.MeshLambertMaterial({ map: grid }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x50504a, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(-60, 140, -110);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.6;
  Object.assign(key.shadow.camera, { left: -90, right: 90, top: 120, bottom: -20, near: 1, far: 500 });
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(100, 60, 80);
  scene.add(fill);
}

function buildMine() {
  scene.background = new THREE.Color('#0b0806');
  scene.fog = new THREE.FogExp2(0x120c09, 0.0042);
  const stone = noiseTile([98, 88, 84], 34, 11, (g, r) => {
    g.fillStyle = 'rgba(40,32,30,0.55)';
    for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 1);
  });
  const deep = noiseTile([58, 52, 54], 22, 21, (g) => {
    g.fillStyle = 'rgba(20,18,20,0.5)';
    for (let y = 0; y < 16; y += 4) g.fillRect(0, y, 16, 1);
  });
  const dirt = noiseTile([86, 66, 50], 30, 31);
  const planks = canvasTex(16, (g) => {
    const r = rng(41);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k = (r() - 0.5) * 18 + (y % 4 === 3 ? -28 : 0);
        g.fillStyle = `rgb(${120 + k},${82 + k * 0.8},${48 + k * 0.6})`;
        g.fillRect(x, y, 1, 1);
      }
    g.fillStyle = 'rgba(40,25,12,0.6)';
    g.fillRect(3, 0, 1, 4); g.fillRect(11, 4, 1, 4); g.fillRect(6, 8, 1, 4); g.fillRect(13, 12, 1, 4);
  });
  const log = canvasTex(16, (g) => {
    const r = rng(51);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k = (r() - 0.5) * 16 + (x % 5 === 0 ? -26 : 0);
        g.fillStyle = `rgb(${98 + k},${66 + k * 0.8},${40 + k * 0.6})`;
        g.fillRect(x, y, 1, 1);
      }
  });
  const mats = {
    stone: new THREE.MeshLambertMaterial({ map: stone }),
    deep: new THREE.MeshLambertMaterial({ map: deep }),
    dirt: new THREE.MeshLambertMaterial({ map: dirt }),
    planks: new THREE.MeshLambertMaterial({ map: planks }),
    log: new THREE.MeshLambertMaterial({ map: log }),
  };
  const cube = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
  const r = rng(7);
  const blocks = { stone: [], deep: [], dirt: [] };
  const place = (kind, x, y, z) => blocks[kind].push([x, y, z]);
  // corridor runs along Z; floor at y = -1, walls irregular
  for (let z = -26; z <= 34; z++) {
    for (let x = -9; x <= 9; x++) {
      place(r() < 0.25 ? 'dirt' : r() < 0.5 ? 'deep' : 'stone', x, -1, z);
      const wallStart = 4 + Math.floor(r() * 2.2);
      if (Math.abs(x) >= wallStart) {
        const top = 7 + Math.floor(r() * 3);
        for (let y = 0; y < top; y++) place(y < 2 ? 'deep' : r() < 0.3 ? 'deep' : 'stone', x, y, z);
      }
      if (Math.abs(x) < 6) {
        const ceil = 6 + Math.floor(r() * 2);
        place(r() < 0.4 ? 'deep' : 'stone', x, ceil, z);
      }
    }
  }
  for (const [kind, list] of Object.entries(blocks)) {
    const inst = new THREE.InstancedMesh(cube, mats[kind], list.length);
    const m = new THREE.Matrix4();
    list.forEach(([x, y, z], i) => {
      m.makeTranslation(x * BLOCK, y * BLOCK + BLOCK / 2, z * BLOCK);
      inst.setMatrixAt(i, m);
    });
    inst.receiveShadow = true;
    inst.castShadow = true;
    scene.add(inst);
  }
  // timber supports every 6 blocks
  const beam = (w, h, d, x, y, z, mat, rz = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, y, z);
    b.rotation.z = rz;
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
  };
  const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  const lanternFrame = new THREE.MeshLambertMaterial({ color: 0x2a2420 });
  for (const z of [-24, -18, -12, -6, 0, 6, 12, 18, 24, 30]) {
    const zz = z * BLOCK;
    beam(10, 5.6 * BLOCK, 10, -3.6 * BLOCK, 2.8 * BLOCK, zz, mats.log);
    beam(10, 5.6 * BLOCK, 10, 3.6 * BLOCK, 2.8 * BLOCK, zz, mats.log);
    beam(7.6 * BLOCK, 10, 12, 0, 5.6 * BLOCK, zz, mats.planks);
    beam(1.8 * BLOCK, 6, 6, -2.9 * BLOCK, 4.9 * BLOCK, zz, mats.planks, -0.75);
    beam(1.8 * BLOCK, 6, 6, 2.9 * BLOCK, 4.9 * BLOCK, zz, mats.planks, 0.75);
  }
  // rails
  const railMat = new THREE.MeshLambertMaterial({ color: 0x6d6560 });
  for (let z = -26; z <= 34; z++) {
    beam(14, 1.5, 3.5, 4.2 * BLOCK - BLOCK * 6.5, 0.75, z * BLOCK, mats.planks);
    beam(14, 1.5, 3.5, 4.2 * BLOCK - BLOCK * 6.5, 0.75, z * BLOCK + 8, mats.planks);
  }
  beam(1.2, 1.6, 61 * BLOCK, 4.2 * BLOCK - BLOCK * 6.5 - 4.5, 2.2, 4 * BLOCK, railMat);
  beam(1.2, 1.6, 61 * BLOCK, 4.2 * BLOCK - BLOCK * 6.5 + 4.5, 2.2, 4 * BLOCK, railMat);
  // rubble
  const rubbleMat = mats.stone;
  for (let i = 0; i < 70; i++) {
    const s = 2 + r() * 6;
    const b = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), rubbleMat);
    b.position.set((r() - 0.5) * 7 * BLOCK, s / 2, (r() - 0.5) * 40 * BLOCK);
    b.rotation.y = r() * Math.PI;
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
  }
  // lanterns with warm point lights
  for (const [x, z] of [[2.6, -6], [-2.6, 6], [2.6, 18], [-2.6, -18]]) {
    const g = new THREE.Group();
    g.position.set(x * BLOCK, 4.6 * BLOCK, z * BLOCK);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 5), lanternMat);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(6, 1.5, 6), lanternFrame);
    cap.position.y = 3.6;
    const chain = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8 * BLOCK, 1), lanternFrame);
    chain.position.y = 3.6 + 0.4 * BLOCK;
    g.add(glass, cap, chain);
    const light = new THREE.PointLight(cfg.lanternColor ?? 0xffa860, cfg.lantern ?? 700, 13 * BLOCK, 1.6);
    light.position.y = -2;
    g.add(light);
    scene.add(g);
  }
  scene.add(new THREE.HemisphereLight(cfg.ambientColor ?? 0x5a4e48, 0x120c08, cfg.ambient ?? 0.6));
  const key = new THREE.SpotLight(cfg.keyColor ?? 0xffe8d8, cfg.key ?? 2600, 40 * BLOCK, 0.55, 0.6, 1.4);
  key.position.set(-1.5 * BLOCK, 5.4 * BLOCK, -7 * BLOCK);
  key.target.position.set(0, 1.6 * BLOCK, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.6;
  scene.add(key, key.target);
  const rim = new THREE.SpotLight(cfg.rimColor ?? 0xffa868, cfg.rim ?? 3200, 40 * BLOCK, 0.6, 0.7, 1.4);
  rim.position.set(2.5 * BLOCK, 4.8 * BLOCK, 8 * BLOCK);
  rim.target.position.set(0, 2 * BLOCK, 0);
  scene.add(rim, rim.target);
  sb.keyLight = key;
  sb.rimLight = rim;
  // drifting dust
  const N = 900;
  const pos = new Float32Array(N * 3);
  const rr = rng(99);
  for (let i = 0; i < N; i++) pos.set([(rr() - 0.5) * 9 * BLOCK, rr() * 6 * BLOCK, (rr() - 0.5) * 30 * BLOCK], i * 3);
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xd8b088, size: 0.7, transparent: true, opacity: 0.55, depthWrite: false }));
  dust.userData.base = pos.slice();
  scene.add(dust);
  wallProp = makeWallProp(mats.stone, mats.deep);
}

// A stone wall the Breaker phase tears through (blocks pop out progressively)
function makeWallProp(m1, m2) {
  const group = new THREE.Group();
  const r = rng(5);
  const blocks = [];
  const geom = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
  for (let x = -3; x <= 3; x++)
    for (let y = 0; y < 5; y++) {
      const b = new THREE.Mesh(geom, r() < 0.35 ? m2 : m1);
      b.position.set(x * BLOCK, y * BLOCK + BLOCK / 2, 0);
      b.castShadow = b.receiveShadow = true;
      b.userData.order = Math.abs(x) * 1.2 + Math.abs(y - 2) * 0.8 + r() * 1.5;
      blocks.push(b);
      group.add(b);
    }
  group.visible = false;
  scene.add(group);
  return { group, blocks, broken: new Set() };
}

// ---------------------------------------------------------------- debris particles
function makeDebrisSystem() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a7a72 });
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const parts = [];
  return {
    group,
    burst(origin, count, power, seed, dir = new THREE.Vector3(0, 0.6, -1)) {
      const r = rng(seed);
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(geom, mat);
        const s = 1.2 + r() * 3.2;
        m.scale.setScalar(s);
        m.position.copy(origin);
        m.castShadow = true;
        const v = new THREE.Vector3((r() - 0.5) * 1.6 + dir.x, r() * 1.2 + dir.y, (r() - 0.5) * 1.6 + dir.z).multiplyScalar(power);
        parts.push({ m, v, spin: new THREE.Vector3(r() * 9, r() * 9, r() * 9), life: 2.5 + r() });
        group.add(m);
      }
    },
    step(dt) {
      for (const p of parts) {
        if (p.life <= 0) continue;
        p.v.y -= 9.8 * BLOCK * 0.35 * dt;
        p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y < p.m.scale.y / 2) {
          p.m.position.y = p.m.scale.y / 2;
          p.v.multiplyScalar(0.35);
          p.v.y = Math.abs(p.v.y) * 0.3;
        }
        p.m.rotation.x += p.spin.x * dt * (p.v.length() > 2 ? 1 : 0);
        p.m.rotation.y += p.spin.y * dt * (p.v.length() > 2 ? 1 : 0);
        p.life -= dt;
        if (p.life <= 0) group.remove(p.m);
      }
    },
    clear() { parts.length = 0; group.clear(); },
  };
}

// ---------------------------------------------------------------- per-frame
const prevLocal = new Map();
sb.frame = (o = {}) => {
  const values = {
    'query.life_time': o.lifeTime ?? 0,
    'query.modified_move_speed': 0,
    'query.modified_distance_moved': 0,
    'query.ground_speed': 0,
    'query.is_on_ground': 1,
    'query.is_alive': 1,
    'query.target_x_rotation': 0,
    'query.target_y_rotation': 0,
    'query.delta_time': o.dt ?? 1 / 30,
    'variable.attack_time': -1,
    ...(o.query || {}),
  };
  const props = o.properties || {};
  const ctx = makeContext(values, { 'query.property': (n) => props[n] ?? 0 });
  // layers
  const layers = [];
  for (const L of o.layers || []) {
    const anim = animations[L.anim];
    if (!anim) throw new Error('Unknown animation ' + L.anim + ' (have: ' + Object.keys(animations).join(', ') + ')');
    const lt = L.raw ? { t: L.time, finished: false } : localTime(anim, L.time);
    if (lt.finished && anim.loop !== 'hold_on_last_frame' && !L.hold) continue;
    layers.push({ anim, time: lt.t, weight: L.weight ?? 1 });
    // particle / sound events -> debris in the mine scene
    const key = L.anim + (L.id || '');
    const prev = prevLocal.get(key);
    if (prev !== undefined && o.events !== false) {
      for (const ev of eventsBetween(anim, prev, lt.t)) {
        if (ev.type === 'particle_effects' && ev.locator) {
          const loc = model.locators.get(ev.locator.toLowerCase());
          if (loc) {
            model.root.updateMatrixWorld(true);
            const p = new THREE.Vector3().setFromMatrixPosition(loc.matrixWorld);
            debris.burst(p, 14, 70, Math.floor(lt.t * 1000) + 3, new THREE.Vector3(0, 0.5, -0.8));
          }
        }
      }
    }
    prevLocal.set(key, lt.t);
  }
  const totals = poseModel(THREE, model, layers, ctx);
  // entity transform
  const e = o.entity || {};
  entity.position.set((e.x || 0) * BLOCK, (e.y || 0) * BLOCK, (e.z || 0) * BLOCK);
  entity.rotation.set(0, ((e.yaw || 0) * Math.PI) / 180, 0);
  // props
  if (wallProp) {
    const w = o.wall;
    wallProp.group.visible = !!w;
    if (w) {
      wallProp.group.position.set((w.x || 0) * BLOCK, 0, (w.z || 0) * BLOCK);
      for (const b of wallProp.blocks) {
        const gone = b.userData.order < w.progress * 6;
        if (gone && !wallProp.broken.has(b)) {
          wallProp.broken.add(b);
          const p = new THREE.Vector3();
          b.getWorldPosition(p);
          debris.burst(p, 10, 90, wallProp.broken.size * 13, new THREE.Vector3(0, 0.5, -1));
        }
        b.visible = !gone;
      }
    }
  }
  if (o.burst) for (const bst of o.burst) debris.burst(new THREE.Vector3(...bst.at.map((v) => v * BLOCK)), bst.count || 20, bst.power || 80, bst.seed || 1, new THREE.Vector3(...(bst.dir || [0, 0.6, -1])));
  debris.step(o.dt ?? 1 / 30);
  if (dust) {
    const a = dust.geometry.attributes.position;
    const base = dust.userData.base;
    const t = o.lifeTime || 0;
    for (let i = 0; i < a.count; i++) {
      a.array[i * 3] = base[i * 3] + Math.sin(t * 0.3 + i) * 4;
      a.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.21 + i * 1.7) * 3;
      a.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.25 + i * 0.7) * 4;
    }
    a.needsUpdate = true;
  }
  // camera
  setCamera(o.camera || {});
  // debug helpers
  for (const h of helpers) h.parent && h.parent.remove(h);
  helpers.length = 0;
  if (o.debugBones) {
    for (const [, b] of model.bones) {
      const ax = new THREE.AxesHelper(4);
      ax.material.depthTest = false;
      ax.renderOrder = 10;
      b.obj.add(ax);
      helpers.push(ax);
    }
  }
  if (composer) composer.render();
  else renderer.render(scene, camera);
  drawOverlay(o.title, o.caption);
  return { totals };
};

function setCamera(c) {
  const e = entity.position;
  const yaw = entity.rotation.y;
  const target = new THREE.Vector3(...(c.target || [0, 1.55, 0]).map((v) => v * BLOCK));
  if (!c.absolute) target.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(e);
  if (c.position) {
    camera.position.set(...c.position.map((v) => v * BLOCK));
    if (!c.absolute) camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(e);
  } else {
    const presets = { front: 0, threequarter: 35, right: 90, back: 180, left: -90, threequarter_left: -35 };
    const az = (((c.azimuth ?? presets[c.preset || 'front']) || 0) * Math.PI) / 180 + yaw;
    const el = ((c.elevation ?? 8) * Math.PI) / 180;
    const d = (c.distance ?? 7.5) * BLOCK;
    // azimuth 0 = in front of the entity (render -Z), +90 = entity's right side (render +X)
    camera.position.set(target.x + Math.sin(az) * Math.cos(el) * d, target.y + Math.sin(el) * d, target.z - Math.cos(az) * Math.cos(el) * d);
  }
  camera.fov = c.fov ?? cfg.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
  if (c.roll) camera.rotateZ((c.roll * Math.PI) / 180);
}

function drawOverlay(title, caption) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  octx.drawImage(renderer.domElement, 0, 0);
  const W = overlay.width, H = overlay.height;
  if (cfg.vignette !== false && cfg.background === 'mine') {
    const g = octx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    octx.fillStyle = g;
    octx.fillRect(0, 0, W, H);
  }
  if (title && title.alpha > 0) {
    octx.save();
    octx.globalAlpha = title.alpha;
    octx.textAlign = 'center';
    const y = title.y ?? H * 0.82;
    octx.fillStyle = 'rgba(10,6,4,0.55)';
    octx.fillRect(0, y - H * 0.075, W, H * (title.sub ? 0.15 : 0.1));
    octx.font = `600 ${Math.round(H * 0.058)}px "DejaVu Serif", "Liberation Serif", serif`;
    octx.fillStyle = '#ead8c8';
    octx.shadowColor = 'rgba(0,0,0,0.8)';
    octx.shadowBlur = 8;
    octx.fillText(spaced(title.text), W / 2, y);
    if (title.sub) {
      octx.strokeStyle = 'rgba(200,170,150,0.7)';
      octx.lineWidth = 1;
      octx.beginPath();
      octx.moveTo(W * 0.33, y + H * 0.022);
      octx.lineTo(W * 0.67, y + H * 0.022);
      octx.stroke();
      octx.font = `italic ${Math.round(H * 0.03)}px "Liberation Serif", "DejaVu Serif", serif`;
      octx.fillStyle = '#d9c6b6';
      octx.fillText(title.sub, W / 2, y + H * 0.06);
    }
    octx.restore();
  }
  if (caption) {
    octx.save();
    octx.font = `${Math.round(H * 0.022)}px "DejaVu Sans Mono", monospace`;
    octx.fillStyle = 'rgba(255,255,255,0.85)';
    octx.textAlign = 'left';
    octx.fillText(caption, 12, H - 14);
    octx.restore();
  }
}
function spaced(s) { return s.split('').join(' '); }

sb.capture = (type = 'image/png', q = 0.92) => overlay.toDataURL(type, q);
sb.resetEvents = () => { prevLocal.clear(); debris.clear(); if (wallProp) { wallProp.broken.clear(); wallProp.blocks.forEach((b) => (b.visible = true)); } };
sb.setLight = (name, props) => Object.assign(sb[name], props);
sb.worldPoints = (names) => {
  model.root.updateMatrixWorld(true);
  const out = {};
  for (const n of names) {
    const b = model.bones.get(n.toLowerCase()) || { obj: model.locators.get(n.toLowerCase()) };
    if (!b.obj) continue;
    out[n] = new THREE.Vector3().setFromMatrixPosition(b.obj.matrixWorld).toArray();
  }
  return out;
};
window.__sbReady = true;
