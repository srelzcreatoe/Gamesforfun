import * as THREE from 'three';
import { buildModel, applyAnimation } from '/bedrock_model.js';

const texLoader = new THREE.TextureLoader();
const cache = new Map();
async function json(url) { if (!cache.has(url)) cache.set(url, fetch(url).then((r) => r.json())); return cache.get(url); }
function tex(url) {
  if (!cache.has(url)) cache.set(url, new Promise((res, rej) => texLoader.load(url, (t) => { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; res(t); }, undefined, rej)));
  return cache.get(url);
}

/** Model scale: a number, or [x, y, z] (the client entity's scaleX/scaleY/scaleZ, in the entity's own frame). */
function scale3(s) { return Array.isArray(s) ? s : [s ?? 1, s ?? 1, s ?? 1]; }

async function buildScene(S) {
  const transparent = S.background === 'transparent';
  const scene = new THREE.Scene();
  if (!transparent) scene.background = new THREE.Color(S.background ?? '#202024');
  if (S.fog) scene.fog = new THREE.FogExp2(S.fog.color, S.fog.density);
  scene.add(new THREE.HemisphereLight(S.hemi?.sky ?? '#c8d0ff', S.hemi?.ground ?? '#302820', S.hemi?.intensity ?? 0.6));
  for (const L of S.lights || []) {
    let l;
    if (L.type === 'dir') { l = new THREE.DirectionalLight(L.color, L.intensity); l.position.set(...L.pos); if (L.target) l.target.position.set(...L.target); scene.add(l.target);
      if (L.shadow) { l.castShadow = true; l.shadow.mapSize.set(2048, 2048); const c = l.shadow.camera; c.left = -L.shadow; c.right = L.shadow; c.top = L.shadow; c.bottom = -L.shadow; c.near = 0.1; c.far = 200; l.shadow.bias = -0.0005; } }
    else if (L.type === 'point') { l = new THREE.PointLight(L.color, L.intensity, L.distance ?? 0, L.decay ?? 2); l.position.set(...L.pos); if (L.shadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.002; } }
    else if (L.type === 'spot') { l = new THREE.SpotLight(L.color, L.intensity, L.distance ?? 0, (L.angle ?? 30) * Math.PI / 180, L.penumbra ?? 0.4, L.decay ?? 2); l.position.set(...L.pos); l.target.position.set(...L.target); scene.add(l.target); if (L.shadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0015; } }
    else if (L.type === 'ambient') l = new THREE.AmbientLight(L.color, L.intensity);
    scene.add(l);
  }
  for (const M of S.models || []) {
    const [geo, map] = await Promise.all([json(M.geo), tex(M.texture)]);
    const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: M.roughness ?? 0.75, metalness: M.metalness ?? 0.05, side: THREE.FrontSide });
    if (M.emissiveMap) { mat.emissiveMap = await tex(M.emissiveMap); mat.emissive = new THREE.Color('#ffffff'); mat.emissiveIntensity = M.emissiveIntensity ?? 2; }
    const model = buildModel(geo, mat);
    // M.animation: an inline animation object (e.g. a candidate pose); M.anim + M.animName: from a file
    const animObj = M.animation ?? (M.anim ? (await json(M.anim)).animations[M.animName] : null);
    if (animObj) applyAnimation(model, animObj, M.t ?? 0);
    const holder = new THREE.Group();
    holder.add(model.root);
    if (M.eyes) {
      const em = await tex(M.eyes);
      const emat = new THREE.MeshBasicMaterial({ map: em, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
      emat.color.setScalar(M.eyesBoost ?? 2.2);
      const eyesModel = buildModel(geo, emat);
      if (animObj) applyAnimation(eyesModel, animObj, M.t ?? 0);
      eyesModel.root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
      holder.add(eyesModel.root);
    }
    holder.position.set(...(M.pos || [0, 0, 0]));
    holder.rotation.y = Math.PI - (M.yaw ?? 0) * Math.PI / 180;
    holder.scale.set(...scale3(M.scale));
    scene.add(holder);
  }
  // simple reference boxes (scale bars, a 1.8-block "player" marker...)
  for (const B of S.boxes || []) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...B.size), new THREE.MeshStandardMaterial({ color: B.color ?? '#888', roughness: 0.9, transparent: (B.opacity ?? 1) < 1, opacity: B.opacity ?? 1 }));
    m.position.set(...B.pos); m.castShadow = !!B.shadow; m.receiveShadow = true;
    scene.add(m);
  }
  if (S.floor) {
    const fm = new THREE.Mesh(new THREE.PlaneGeometry(S.floor.size ?? 40, S.floor.size ?? 40), new THREE.MeshStandardMaterial({ color: S.floor.color ?? '#333', roughness: 0.9 }));
    fm.rotation.x = -Math.PI / 2; fm.receiveShadow = true; scene.add(fm);
    if (S.floor.grid) { const g = new THREE.GridHelper(S.floor.size ?? 40, S.floor.size ?? 40, S.floor.grid, S.floor.grid); g.position.y = 0.002; scene.add(g); }
  }
  const cam = S.camera.ortho
    ? new THREE.OrthographicCamera(-S.camera.ortho * S.width / S.height, S.camera.ortho * S.width / S.height, S.camera.ortho, -S.camera.ortho, 0.05, 500)
    : new THREE.PerspectiveCamera(S.camera.fov ?? 50, S.width / S.height, 0.05, 500);
  cam.position.set(...S.camera.pos); cam.lookAt(new THREE.Vector3(...S.camera.target));
  return { scene, cam, transparent };
}

function makeRenderer(S, transparent) {
  const renderer = new THREE.WebGLRenderer({ antialias: S.antialias ?? true, preserveDrawingBuffer: true, alpha: transparent });
  if (transparent) renderer.setClearColor(0x000000, 0);
  renderer.setSize(S.width, S.height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = S.exposure ?? 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

window.renderScene = async (S) => {
  const { scene, cam, transparent } = await buildScene(S);
  const renderer = makeRenderer(S, transparent);
  document.body.appendChild(renderer.domElement);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.dispose(); renderer.forceContextLoss();
  return url;
};

/**
 * Contact sheet: one WebGL renderer, many cells composed into a 2D canvas with labels.
 * Sh = { cols, cellW, cellH, title?, background?, cells: [{ scene: <renderScene scene minus width/height>, label }] }
 */
window.renderSheet = async (Sh) => {
  const { cols, cellW, cellH } = Sh;
  const rows = Math.ceil(Sh.cells.length / cols);
  const titleH = Sh.title ? 28 : 0;
  const out = document.createElement('canvas');
  out.width = cols * cellW; out.height = rows * cellH + titleH;
  const g = out.getContext('2d');
  g.fillStyle = Sh.background ?? '#18181c'; g.fillRect(0, 0, out.width, out.height);
  if (Sh.title) { g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.fillText(Sh.title, 8, 20); }
  const renderer = makeRenderer({ width: cellW, height: cellH, exposure: Sh.exposure, antialias: true }, false);
  for (let i = 0; i < Sh.cells.length; i++) {
    const C = Sh.cells[i];
    if (!C.scene) continue;
    const { scene, cam } = await buildScene({ width: cellW, height: cellH, ...C.scene });
    renderer.toneMappingExposure = C.scene.exposure ?? Sh.exposure ?? 1;
    renderer.render(scene, cam);
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH + titleH;
    g.drawImage(renderer.domElement, x, y);
    g.strokeStyle = '#444'; g.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
    if (C.label) {
      g.font = '12px sans-serif';
      const lines = String(C.label).split('\n');
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y, cellW, 15 * lines.length + 4);
      g.fillStyle = '#fff';
      lines.forEach((l, k) => g.fillText(l, x + 4, y + 14 + 15 * k));
    }
  }
  renderer.dispose(); renderer.forceContextLoss();
  return out.toDataURL('image/png');
};
window.__ready = true;
