// Studio / turnaround renderer used for checking the model against the sheet.
import * as THREE from 'three';
import { buildModel, applyPose, compileAnimations, samplePose } from './bedrock-model.js';

const params = new URLSearchParams(location.search);
const W = parseInt(params.get('w') || '800'), Hh = parseInt(params.get('h') || '1000');
const ASSET = params.get('assets') || '/out';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(1);
renderer.setSize(W, Hh);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(14, W / Hh, 10, 5000);
const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);

const hemi = new THREE.HemisphereLight(0x9aa6c0, 0x1a1418, 0.9);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1ea, 2.2);
key.position.set(-60, 120, -140);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -80, right: 80, top: 100, bottom: -40, near: 1, far: 600 });
scene.add(key);
const rim = new THREE.DirectionalLight(0x8fb4ff, 1.4);
rim.position.set(80, 90, 160);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffd9c4, 0.5);
fill.position.set(140, 30, -40);
scene.add(fill);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.ShadowMaterial({ opacity: 0.45 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

let model = null, anims = {};

async function loadJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }

async function init() {
  const geo = await loadJSON(`${ASSET}/brinesleeper.geo.json?${Date.now()}`);
  const tex = await new THREE.TextureLoader().loadAsync(`${ASSET}/brinesleeper.png?${Date.now()}`);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  model = buildModel(geo, tex);
  scene.add(model.root);
  try { anims = compileAnimations(await loadJSON(`${ASSET}/brinesleeper.animation.json?${Date.now()}`)); } catch (e) { anims = {}; }
}

// view: {yaw (deg, 0 = looking at the creature's face), pitch, dist, target:[x,y,z] (three space), fov, anim, time, bg, exposure}
function render(view) {
  if (view.w && view.h) { renderer.setSize(view.w, view.h); camera.aspect = view.w / view.h; }
  const yaw = (view.yaw || 0) * Math.PI / 180, pitch = (view.pitch || 0) * Math.PI / 180;
  const dist = view.dist || 420, fov = view.fov || 14;
  const tgt = new THREE.Vector3(...(view.target || [0, 28, 0]));
  camera.fov = fov; if (!view.w) camera.aspect = W / Hh; camera.updateProjectionMatrix();
  // creature faces -Z; yaw 0 puts the camera in front of it (negative z)
  camera.position.set(tgt.x - Math.sin(yaw) * Math.cos(pitch) * dist, tgt.y + Math.sin(pitch) * dist, tgt.z - Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(tgt);
  let cam = camera;
  if (view.ortho) {
    // ortho: [left, right, bottom, top] in model px, relative to target
    const [l, r, b, t] = view.ortho;
    ocam.left = l; ocam.right = r; ocam.bottom = b; ocam.top = t; ocam.near = 1; ocam.far = 5000;
    ocam.position.copy(camera.position); ocam.quaternion.copy(camera.quaternion); ocam.updateProjectionMatrix();
    cam = ocam;
  }
  const poses = view.anim && anims[view.anim] ? samplePose(anims[view.anim], view.time || 0) : {};
  applyPose(model, poses);
  scene.background = view.bg === 'transparent' ? null : new THREE.Color(view.bg || '#0d0c0e');
  renderer.toneMappingExposure = view.exposure || 1.0;
  floor.visible = view.floor !== false;
  hemi.intensity = view.hemi ?? 0.9; key.intensity = view.key ?? 2.2; rim.intensity = view.rim ?? 1.4; fill.intensity = view.fill ?? 0.5;
  if (view.camLights !== false) {
    // light every view from the camera side like a turnaround sheet
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    key.position.copy(tgt).addScaledVector(fwd, -200).addScaledVector(right, -70).add(new THREE.Vector3(0, 150, 0));
    key.target.position.copy(tgt); key.target.updateMatrixWorld();
    fill.position.copy(tgt).addScaledVector(fwd, -150).addScaledVector(right, 160).add(new THREE.Vector3(0, 20, 0));
    rim.position.copy(tgt).addScaledVector(fwd, 220).add(new THREE.Vector3(0, 120, 0));
  }
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
}

window.api = { ready: init(), render, anims: () => Object.keys(anims) };
