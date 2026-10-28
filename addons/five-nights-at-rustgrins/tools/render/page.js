import * as THREE from 'three';
import { buildModel, applyAnimation } from '/bedrock_model.js';

const texLoader = new THREE.TextureLoader();
const cache = new Map();
async function json(url) { if (!cache.has(url)) cache.set(url, fetch(url).then((r) => r.json())); return cache.get(url); }
function tex(url) {
  if (!cache.has(url)) cache.set(url, new Promise((res, rej) => texLoader.load(url, (t) => { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; res(t); }, undefined, rej)));
  return cache.get(url);
}

window.renderScene = async (S) => {
  const transparent = S.background === 'transparent';
  const renderer = new THREE.WebGLRenderer({ antialias: S.antialias ?? true, preserveDrawingBuffer: true, alpha: transparent });
  if (transparent) renderer.setClearColor(0x000000, 0);
  renderer.setSize(S.width, S.height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = S.exposure ?? 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
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
    if (M.anim) { const a = await json(M.anim); applyAnimation(model, a.animations[M.animName], M.t ?? 0); }
    const holder = new THREE.Group();
    holder.add(model.root);
    if (M.eyes) {
      const em = await tex(M.eyes);
      const emat = new THREE.MeshBasicMaterial({ map: em, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
      emat.color.setScalar(M.eyesBoost ?? 2.2);
      const eyesModel = buildModel(geo, emat);
      if (M.anim) { const a = await json(M.anim); applyAnimation(eyesModel, a.animations[M.animName], M.t ?? 0); }
      eyesModel.root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
      holder.add(eyesModel.root);
    }
    holder.position.set(...(M.pos || [0, 0, 0]));
    holder.rotation.y = Math.PI - (M.yaw ?? 0) * Math.PI / 180;
    holder.scale.setScalar(M.scale ?? 1);
    scene.add(holder);
  }
  if (S.floor) {
    const fm = new THREE.Mesh(new THREE.PlaneGeometry(S.floor.size ?? 40, S.floor.size ?? 40), new THREE.MeshStandardMaterial({ color: S.floor.color ?? '#333', roughness: 0.9 }));
    fm.rotation.x = -Math.PI / 2; fm.receiveShadow = true; scene.add(fm);
  }
  const cam = new THREE.PerspectiveCamera(S.camera.fov ?? 50, S.width / S.height, 0.05, 500);
  cam.position.set(...S.camera.pos); cam.lookAt(new THREE.Vector3(...S.camera.target));
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.dispose(); renderer.forceContextLoss();
  return url;
};
window.__ready = true;
