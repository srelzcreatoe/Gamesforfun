// Stillwater Caves preview: renders out/biome_scene.json (made by biome_preview.py from the biome's own
// generation rules) with the pack's block textures, the biome's fog and water colour, drifting ash, and
// the Brinesleeper standing in the lake.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildModel, applyPose, compileAnimations, samplePose } from './bedrock-model.js';
import { makeWater, rng } from './cave.js';

const params = new URLSearchParams(location.search);
let W = parseInt(params.get('w') || '1600'), H = parseInt(params.get('h') || '900');
const ASSET = params.get('assets') || '/out';
const B = 16;                                       // one block = 16 model pixels

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = 0x0c1216;                               // the biome's fog colour, fixed 6..64 blocks
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 6 * B, 64 * B);
const camera = new THREE.PerspectiveCamera(62, W / H, 1, 4000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.6, 0.8));
composer.addPass(new OutputPass());

let S = null, OFF = null, water = null, model = null;
const loader = new THREE.TextureLoader();
async function json(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }
async function tex(name, flipY = true) {
  const t = await loader.loadAsync(`${ASSET}/biome_tex/${name}.png`);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = flipY;
  return t;
}
const P = (x, y, z) => new THREE.Vector3((x - OFF[0]) * B, (y - OFF[1]) * B, (z - OFF[2]) * B);

// faces: [+x, -x, +y, -y, +z, -z] texture names per block type
const FACES = {
  stone: 'stone', deepslate: ['deepslate', 'deepslate', 'deepslate_top', 'deepslate_top', 'deepslate', 'deepslate'],
  tuff: 'tuff', smooth_basalt: 'smooth_basalt', dripstone_block: 'dripstone_block', gravel: 'gravel', mud: 'mud', clay: 'clay',
  bloodstained_deepslate: ['bloodstained_deepslate', 'bloodstained_deepslate', 'bloodstained_deepslate_top', 'bloodstained_deepslate_bottom',
    'bloodstained_deepslate', 'bloodstained_deepslate'],
  clawed_deepslate: ['clawed_deepslate', 'clawed_deepslate', 'deepslate_top_plain', 'deepslate_top_plain', 'clawed_deepslate', 'clawed_deepslate'],
  tracked_mud: ['mud_plain', 'mud_plain', 'tracked_mud_top', 'mud_plain', 'mud_plain', 'mud_plain'],
};
const SHADE = [0.78, 0.78, 1.0, 0.55, 0.88, 0.88];   // Minecraft-style directional face shading

async function buildWorld() {
  S = await json(`${ASSET}/biome_scene.json`);
  OFF = [S.size[0] / 2, 14, 0];                    // y 14 = the lake surface sits at world y ~ 0
  const cache = {};
  const mat = async (n, shade) => {
    const k = n + shade;
    if (!cache[k]) cache[k] = new THREE.MeshLambertMaterial({ map: await tex(n), color: new THREE.Color(shade, shade, shade) });
    return cache[k];
  };
  const byType = {};
  for (const [x, y, z, t] of S.blocks) (byType[t] ||= []).push([x, y, z]);
  const geo = new THREE.BoxGeometry(B, B, B);
  const m4 = new THREE.Matrix4();
  for (const [t, list] of Object.entries(byType)) {
    const name = S.names[t];
    const f = FACES[name];
    const names = Array.isArray(f) ? f : Array(6).fill(f);
    const mats = await Promise.all(names.map((n, i) => mat(n, SHADE[i])));
    const im = new THREE.InstancedMesh(geo, mats, list.length);
    list.forEach(([x, y, z], i) => { const p = P(x + 0.5, y + 0.5, z + 0.5); m4.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, m4); });
    scene.add(im);
  }
  // cross-plane plants, vines and pointed dripstone
  const cross = async (list, texFor, flipFor) => {
    const groups = {};
    for (const it of list) { const k = texFor(it) + (flipFor && flipFor(it) ? '|f' : ''); (groups[k] ||= []).push(it); }
    for (const [k, items] of Object.entries(groups)) {
      const [n, fl] = k.split('|');
      const t = await tex(n, !fl);
      const m = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide });
      const g = new THREE.PlaneGeometry(B * 0.98, B * 0.98);
      const im = new THREE.InstancedMesh(g, m, items.length * 2);
      let i = 0;
      for (const [x, y, z] of items) {
        const p = P(x + 0.5, y + 0.5, z + 0.5);
        for (const a of [Math.PI / 4, -Math.PI / 4]) {
          m4.makeRotationY(a).setPosition(p.x, p.y, p.z); im.setMatrixAt(i++, m4);
        }
      }
      scene.add(im);
    }
  };
  await cross(S.plants, it => it[3]);
  await cross(S.vines, it => (it[3] ? 'weeping_vines_tip' : 'weeping_vines'));
  await cross(S.dripstone, it => `pointed_dripstone_${it[3]}`, it => it[4] === 1);
  // the lake: one reflective plane at the aquifer level; pools elsewhere get flat murky quads
  const lakeY = S.water_tops.reduce((m, w) => Math.max(m, w[1]), -99);
  water = makeWater(4000, (lakeY + 0.875 - OFF[1]) * B, { color: 0x1b2a30, glint: 0x8fb4c8, opacity: 0.9, reflect: 0.7, res: 1024 });
  scene.add(water);
  const pools = S.water_tops.filter(w => w[1] < lakeY);
  if (pools.length) {
    const g = new THREE.PlaneGeometry(B, B); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshPhongMaterial({ color: 0x1b2a30, transparent: true, opacity: 0.9, shininess: 90, specular: 0x334450 });
    const im = new THREE.InstancedMesh(g, m, pools.length);
    pools.forEach(([x, y, z], i) => { const p = P(x + 0.5, y + 0.875, z + 0.5); m4.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, m4); });
    scene.add(im);
  }
  // drifting ash (the biome's minecraft:precipitation)
  const r = rng(5), n = 2400, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (r() - 0.5) * S.size[0] * B; pos[i * 3 + 1] = (r() * 28 - 6) * B; pos[i * 3 + 2] = r() * S.size[2] * B;
  }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x8a8f96, size: 1.6, transparent: true, opacity: 0.55, depthWrite: false })));
}

const hemi = new THREE.HemisphereLight(0x8aa2b8, 0x23262e, 1.9);                // dim cave light, cold from above
const shaft = new THREE.SpotLight(0xb8d0ea, 60, 0, Math.PI / 6, 0.7, 0.0);       // faint daylight through a far crack
const torch = new THREE.PointLight(0xffe2c4, 420, 340, 1.0);                     // the player's torch
scene.add(hemi, shaft, shaft.target, torch);

async function buildModelInLake() {
  const geo = await json(`${ASSET}/brinesleeper.geo.json`);
  const t = await loader.loadAsync(`${ASSET}/brinesleeper.png`);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  model = buildModel(geo, t, { material: new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, alphaTest: 0.5 }) });
  const anims = compileAnimations(await json(`${ASSET}/brinesleeper.animation.json`));
  model.anims = anims;
  scene.add(model.root);
}

function render(job) {
  if (job.w && job.h && (job.w !== W || job.h !== H)) {
    W = job.w; H = job.h; renderer.setSize(W, H); composer.setSize(W, H); camera.aspect = W / H;
  }
  const v = S.views[job.view];
  const cam = job.cam || v.cam, look = job.look || v.look;
  camera.fov = job.fov || (job.view === 'lake' ? 52 : 58); camera.updateProjectionMatrix();
  camera.position.copy(P(...cam)); camera.lookAt(P(...look));
  // torch just above and behind the viewer; daylight shaft over the far end of the cavern
  torch.position.copy(P(cam[0], cam[1] + (job.view === 'ceiling' ? -2.5 : 1.5), cam[2]));
  torch.intensity = job.torch ?? (job.view === 'ceiling' ? 150 : 420);
  const far = job.view === 'lake' ? [look[0], S.water_y + 26, look[2] + 6] : [look[0] + 4, look[1] + 14, look[2] + 4];
  shaft.position.copy(P(...far)); shaft.target.position.copy(P(far[0], S.water_y, far[2] - 4));
  shaft.intensity = job.shaft ?? (job.view === 'lake' ? 140 : 0);
  hemi.intensity = job.hemi ?? 1.9;
  if (model) {
    const m = S.views.model;
    model.root.visible = job.view === 'lake' && !!m;
    if (m) {
      applyPose(model, samplePose(model.anims['animation.brinesleeper.idle_water'], 1.2));
      const p = P(m[0], m[1], m[2]);
      model.root.position.set(p.x, p.y - 2 - 33, p.z);         // chest-deep: the pose's waterline is 33 px up
      const dx = cam[0] - m[0], dz = cam[2] - m[2];
      model.root.rotation.y = Math.atan2(-dx, -dz);             // facing the viewer (the model faces -z)
    }
  }
  if (water) water.material.uniforms.time.value = 2.0;
  renderer.toneMappingExposure = job.exposure ?? (job.view === 'ceiling' ? 1.25 : job.view === 'lake' ? 1.8 : 1.55);
  composer.render();
  return renderer.domElement.toDataURL('image/png');
}

window.api = { ready: (async () => { await buildWorld(); await buildModelInLake(); return true; })(), render };
