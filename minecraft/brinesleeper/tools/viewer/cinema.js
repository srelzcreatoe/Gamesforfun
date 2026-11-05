// Cinematic preview renderer: plays the exported Bedrock files in a voxel cave.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildModel, applyPose, compileAnimations, samplePose, mixPoses } from './bedrock-model.js';
import { blockTextures, buildVoxels, makeWater, Particles, makeTorch, rng, fbm } from './cave.js';
import { SHOTS, STILLS } from './shots.js';

const params = new URLSearchParams(location.search);
const W = parseInt(params.get('w') || '1920'), H = parseInt(params.get('h') || '1080');
const ASSET = params.get('assets') || '/out';
const FPS = parseFloat(params.get('fps') || '30');
const MSAA = parseInt(params.get('msaa') || '0');
const BLOOM = params.get('bloom') !== '0';
const REFL = parseInt(params.get('refl') || '768');
const SHADOW = parseInt(params.get('shadow') || '1536');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, W / H, 2, 6000);

// ---------------------------------------------------------------- post: bloom + grade/vignette/grain/fade
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: MSAA }));
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.5, 0.82);
if (BLOOM) composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, fade: { value: 1 }, vig: { value: 0.75 }, grain: { value: 0.035 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, fade, vig, grain; uniform vec3 tint; varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec3 c;
      c.r = texture2D(tDiffuse, vUv - d * 0.004).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv + d * 0.004).b;
      c *= tint;
      c *= mix(1.0, smoothstep(0.62, 0.05, r2 * 1.25), vig);
      c += (rnd(vUv * vec2(1931.0, 1087.0) + fract(time * 7.13)) - 0.5) * grain;
      gl_FragColor = vec4(c * fade, 1.0);
    }`,
});
composer.addPass(grade);

// ---------------------------------------------------------------- HUD (labels/titles)
const hudCanvas = document.createElement('canvas'); hudCanvas.width = W; hudCanvas.height = H;
const hud = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas); hudTex.colorSpace = THREE.SRGBColorSpace;
const hudScene = new THREE.Scene();
const hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
hudScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, toneMapped: false, depthTest: false })));

let RW = W, RH = H;
const S = H / 1080; // ui scale
function drawHud(shot, t) {
  hud.clearRect(0, 0, W, H);
  const fadeIn = (a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  if (shot.title) {
    const a = fadeIn(shot.title.in, shot.title.in + 0.8) * (1 - fadeIn(shot.title.out, shot.title.out + 0.6));
    if (a > 0) {
      hud.globalAlpha = a;
      hud.textAlign = 'left';
      hud.fillStyle = '#d9ccc4';
      hud.font = `bold ${78 * S}px "DejaVu Serif", serif`;
      const x = 110 * S, y = 760 * S;
      hud.fillText(shot.title.small || 'THE', x, y - 84 * S);
      hud.font = `bold ${132 * S}px "DejaVu Serif", serif`;
      hud.fillText(shot.title.big || 'BRINESLEEPER', x, y + 36 * S);
      hud.fillStyle = '#9e2020';
      hud.fillRect(x, y + 64 * S, 820 * S, 5 * S);
      hud.fillRect(x, y + 76 * S, 640 * S, 3 * S);
      hud.font = `${30 * S}px "Courier 10 Pitch", "Liberation Mono", monospace`;
      hud.fillStyle = '#bdb2ad';
      (shot.title.lines || []).forEach((ln, i) => hud.fillText(ln, x, y + (130 + i * 42) * S));
      hud.globalAlpha = 1;
    }
  }
  if (shot.label) {
    const a = fadeIn(0.15, 0.6) * (1 - fadeIn(shot.dur - 0.45, shot.dur - 0.1));
    if (a > 0) {
      hud.globalAlpha = a;
      hud.font = `${40 * S}px "Courier 10 Pitch", "Liberation Mono", monospace`;
      const txt = shot.label;
      const tw = hud.measureText(txt).width;
      const x = 80 * S, y = H - 92 * S;
      hud.fillStyle = 'rgba(10,9,10,0.62)';
      hud.fillRect(x - 26 * S, y - 50 * S, tw + 52 * S, 74 * S);
      hud.fillStyle = '#9e2020';
      hud.fillRect(x - 26 * S, y - 50 * S, 6 * S, 74 * S);
      hud.fillStyle = '#e4dbd6';
      hud.textAlign = 'left';
      hud.fillText(txt, x, y);
      if (shot.sub) {
        hud.font = `${24 * S}px "Courier 10 Pitch", "Liberation Mono", monospace`;
        hud.fillStyle = '#a79d98';
        hud.fillText(shot.sub, x, y + 52 * S);
      }
      hud.globalAlpha = 1;
    }
  }
  if (shot.corner) {
    hud.globalAlpha = 0.75 * fadeIn(0.2, 0.8);
    hud.font = `${22 * S}px "Courier 10 Pitch", "Liberation Mono", monospace`;
    hud.fillStyle = '#a79d98';
    hud.textAlign = 'right';
    hud.fillText(shot.corner, W - 60 * S, 70 * S);
    hud.textAlign = 'left';
    hud.globalAlpha = 1;
  }
  hudTex.needsUpdate = true;
}

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0x4a5a78, 0x0e0e12, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xe4e4f0, 2.3);
key.castShadow = true;
key.shadow.mapSize.set(SHADOW, SHADOW);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.6;
scene.add(key); scene.add(key.target);
const rim = new THREE.DirectionalLight(0x8aa6dc, 1.0);
scene.add(rim); scene.add(rim.target);
const under = new THREE.DirectionalLight(0x3aa0b0, 0.35);
scene.add(under); scene.add(under.target);
const camFill = new THREE.DirectionalLight(0x9aa2bc, 0.75);
scene.add(camFill); scene.add(camFill.target);

// ---------------------------------------------------------------- assets
let model = null, anims = {}, meta = {}, tex = null;
const envCache = {};
let env = null, water = null, torch = null, parts = null, motes = null, lichen = null, surfaceBelow = null, shafts = null, props = null;
let current = null;

async function loadJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }

async function init() {
  const geo = await loadJSON(`${ASSET}/brinesleeper.geo.json`);
  const t = await new THREE.TextureLoader().loadAsync(`${ASSET}/brinesleeper.png`);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.58, metalness: 0.0, alphaTest: 0.5 });
  model = buildModel(geo, t, { material: mat });
  scene.add(model.root);
  anims = compileAnimations(await loadJSON(`${ASSET}/brinesleeper.animation.json`));
  meta = await loadJSON(`${ASSET}/preview_meta.json`);
  tex = blockTextures();
  parts = new Particles(4000, { additive: true });
  scene.add(parts.points);
  motes = new Particles(600, { additive: true });
  scene.add(motes.points);
}

// ---------------------------------------------------------------- environments
function ellipse(bx, bz, cx, cz, rx, rz, s, amp = 0.35) {
  const n = fbm(bx * 0.23, bz * 0.23, s) - 0.5;
  const d = ((bx - cx) / rx) ** 2 + ((bz - cz) / rz) ** 2;
  return d > 1 + n * amp * 2;
}
function stalactites(bx, bz, base, s) {
  const h = fbm(bx * 0.4, bz * 0.4, s + 3);
  const k = Math.floor(Math.max(0, h - 0.52) * 14);
  return base - k + (fbm(bx * 0.1, bz * 0.1, s + 5) > 0.6 ? -1 : 0);
}
function typer(waterBlock) {
  return (x, y, z, kind) => {
    const h = fbm(x * 0.3 + y * 0.2, z * 0.3 - y * 0.2, 5);
    if (kind === 'ceil') return h > 0.55 ? 'stone' : 'deepslate';
    if (kind === 'wall') return y <= waterBlock + 1 ? (h > 0.5 ? 'wet' : 'deepslate') : (h > 0.62 ? 'tuff' : (h > 0.45 ? 'stone' : 'deepslate'));
    if (kind === 'floor') return y <= waterBlock ? 'mud' : (h > 0.58 ? 'stone' : (h > 0.4 ? 'gravel' : 'wet'));
    if (kind === 'rock') return h > 0.5 ? 'stone' : 'deepslate';
    return 'deepslate';
  };
}

const ENVS = {
  // standing on a shore, pool in front (toward -z), wall behind with a torch
  shore: () => ({
    vox: {
      x0: -22, x1: 22, z0: -26, z1: 12, y0: -6,
      floor: (bx, bz) => (bz < -3 - (fbm(bx * 0.3, 1, 2) > 0.6 ? 1 : 0) ? -4 : 0) + (bz > 6 ? 1 : 0),
      wall: (bx, bz) => ellipse(bx, bz, 0, -7, 19, 17, 1) || bz >= 10,
      ceil: (bx, bz) => stalactites(bx, bz, 13, 1),
      type: typer(-1),
      extra: [[-7, 0, 1, 'rock'], [-8, 0, 1, 'rock'], [-7, 1, 1, 'rock'], [7, 0, -1, 'rock'], [8, 0, 0, 'rock'], [-12, 0, -2, 'rock'], [11, 0, 4, 'rock'], [11, 1, 4, 'rock']],
    },
    water: -2, torch: [-60, 0, 120], lichen: 1,
  }),
  // creature stands in a pool (water surface y=0)
  pool: () => ({
    vox: {
      x0: -22, x1: 22, z0: -28, z1: 12, y0: -8,
      floor: (bx, bz) => (Math.abs(bx) <= 9 && bz > -24 && bz < 5) ? -6 : 0 + (bz > 6 ? 1 : 0),
      wall: (bx, bz) => ellipse(bx, bz, 0, -8, 19, 18, 2) || bz >= 10,
      ceil: (bx, bz) => stalactites(bx, bz, 12, 2),
      type: typer(-1),
      extra: [[10, 0, -6, 'rock'], [10, 1, -6, 'rock'], [-10, 0, 2, 'rock'], [-11, 0, 2, 'rock'], [-10, 1, 2, 'rock']],
    },
    water: 1, torch: [150, 16, 70], lichen: 2,
  }),
  // long shallow channel for the run
  shallows: () => ({
    vox: {
      x0: -14, x1: 14, z0: -48, z1: 14, y0: -3,
      floor: (bx, bz) => 0,
      wall: (bx, bz) => Math.abs(bx) > 7 + Math.floor(fbm(bz * 0.25, 3, 4) * 4) || bz >= 13,
      ceil: (bx, bz) => stalactites(bx, bz, 10, 4),
      type: typer(0),
      extra: [[6, 1, -10, 'rock'], [-6, 1, -25, 'rock'], [6, 1, -34, 'rock']],
    },
    water: 3.5, torch: [-105, 20, -160], lichen: 3,
  }),
  underwater: () => ({
    vox: {
      x0: -24, x1: 24, z0: -40, z1: 16, y0: -10,
      floor: (bx, bz) => -6 + Math.floor(fbm(bx * 0.18, bz * 0.18, 9) * 4),
      wall: (bx, bz) => Math.abs(bx) > 20 || bz > 14,
      ceil: (bx, bz) => 40,
      type: (x, y, z, k) => (fbm(x * 0.4, z * 0.4, 3) > 0.55 ? 'gravel' : (fbm(x * 0.2, z * 0.2, 8) > 0.5 ? 'mud' : 'deepslate')),
      extra: [[-5, -4, -12, 'rock'], [-5, -3, -12, 'rock'], [-4, -4, -12, 'rock'], [8, -4, -22, 'rock'], [8, -3, -22, 'rock'], [3, -4, 4, 'rock']],
    },
    water: null, underwater: true,
  }),
  studio: () => ({ vox: null, water: null }),
};

function clearEnv() {
  for (const o of [env, water, torch, lichen, surfaceBelow, shafts]) if (o) scene.remove(o);
  env = water = torch = lichen = surfaceBelow = shafts = null;
}

function setEnv(name, opts = {}) {
  clearEnv();
  const def = ENVS[name]();
  const cacheKey = name;
  if (def.vox) {
    if (!envCache[cacheKey]) envCache[cacheKey] = buildVoxels(def.vox, tex);
    env = envCache[cacheKey];
    scene.add(env);
  }
  if (name === 'studio') {
    if (!envCache.studio) {
      const g = new THREE.Group();
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x0f0e11, roughness: 0.9 });
      const floor = new THREE.Mesh(new THREE.CircleGeometry(900, 64), floorMat);
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
      g.add(floor);
      envCache.studio = g;
    }
    env = envCache.studio; scene.add(env);
  }
  const level = opts.waterLevel ?? (def.water === null ? null : def.water);
  if (level !== null && level !== undefined) {
    water = makeWater(3000, level, { opacity: opts.waterOpacity ?? 0.9, reflect: 0.9, res: REFL });
    scene.add(water);
  }
  if (def.torch) {
    torch = makeTorch();
    torch.position.set(...def.torch);
    scene.add(torch);
  }
  if (def.lichen && env && env.userData.wallFaces) {
    lichen = new THREE.Group();
    const r = rng(def.lichen * 17);
    const m = new THREE.MeshBasicMaterial({ color: 0x2c8f80 });
    const faces = env.userData.wallFaces.filter(f => f[1] >= -1 && f[1] <= 4);
    for (let i = 0; i < 46 && faces.length; i++) {
      const [x, y, z, dx, dz] = faces[Math.floor(r() * faces.length)];
      const w = 2 + Math.floor(r() * 3), h = 2 + Math.floor(r() * 3);
      const q = new THREE.Mesh(new THREE.BoxGeometry(dx ? 0.5 : w, h, dz ? 0.5 : w), m);
      const ox = (r() - 0.5) * 10, oy = (r() - 0.5) * 10;
      q.position.set(x * 16 + 8 + dx * 8.3 + (dx ? 0 : ox), y * 16 + 8 + oy, z * 16 + 8 + dz * 8.3 + (dz ? 0 : ox));
      lichen.add(q);
    }
    scene.add(lichen);
  }
  if (def.underwater) {
    scene.fog = new THREE.FogExp2(0x0a3340, 0.0042);
    scene.background = new THREE.Color(0x0a2f3b);
    surfaceBelow = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } }, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float time; varying vec3 vW;
        void main(){ float a = sin(vW.x*0.04+time*0.8)*sin(vW.z*0.05-time*0.6) + sin((vW.x+vW.z)*0.021+time*0.5);
          float c = smoothstep(0.6, 1.6, a + 0.8); gl_FragColor = vec4(mix(vec3(0.10,0.42,0.48), vec3(0.65,0.92,0.95), c), 1.0); }`,
    }));
    surfaceBelow.rotation.x = Math.PI / 2; surfaceBelow.position.y = 230;
    scene.add(surfaceBelow);
    shafts = new THREE.Group();
    const sm = new THREE.MeshBasicMaterial({ color: 0x7fd8e6, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const r = rng(5);
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(26 + r() * 40, 520), sm);
      p.position.set(-300 + r() * 600, 0, -420 + r() * 520);
      p.rotation.set(0, r() * Math.PI, 0.25 + r() * 0.2);
      shafts.add(p);
    }
    scene.add(shafts);
  } else if (name === 'studio') {
    scene.fog = new THREE.FogExp2(0x0c0b0d, 0.0019);
    scene.background = new THREE.Color(0x0c0b0d);
  } else {
    scene.fog = new THREE.FogExp2(0x070a0f, 0.0025);
    scene.background = new THREE.Color(0x040507);
  }
}

// ---------------------------------------------------------------- shot evaluation
function animPose(name, t) {
  const a = anims[`animation.brinesleeper.${name}`];
  if (!a) return {};
  const tt = a.loop === true ? t : Math.min(t, a.length);
  return samplePose(a, tt);
}

function poseAt(shot, t) {
  if (!shot.timeline) return shot.anim ? animPose(shot.anim, t + (shot.animOffset || 0)) : {};
  let pose = {};
  const blend = 0.18;
  for (let i = 0; i < shot.timeline.length; i++) {
    const seg = shot.timeline[i];
    const end = seg.start + seg.dur;
    if (t < seg.start - blend || t > end + blend) continue;
    const p = animPose(seg.anim, Math.max(0, t - seg.start) + (seg.offset || 0));
    let w = 1;
    if (i > 0 && t < seg.start + blend) w = Math.max(0, Math.min(1, (t - (seg.start - blend)) / (2 * blend)));
    if (t > end - blend && i < shot.timeline.length - 1) w = Math.min(w, Math.max(0, Math.min(1, ((end + blend) - t) / (2 * blend))));
    pose = Object.keys(pose).length ? mixPoses(pose, p, w) : p;
  }
  return pose;
}

function vineTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 64;
  const g = c.getContext('2d');
  const r = rng(77);
  for (let y = 0; y < 64; y++) {
    const cx = 7 + Math.round(Math.sin(y * 0.4) * 2);
    for (let x = 0; x < 16; x++) {
      const d = Math.abs(x - cx);
      if (d <= 1 || (d <= 3 && r() < 0.55) || (y % 7 === 3 && d <= 5 && r() < 0.6)) {
        const v = r();
        g.fillStyle = v < 0.3 ? '#1f3214' : v < 0.7 ? '#304a1d' : '#4a6a2a';
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let VINE_TEX = null;
function buildProps(list) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(16, 16, 16);
  const m = new THREE.Matrix4();
  for (const pr of list || []) {
    if (pr.type === 'blocks') {
      const [x0, y0, z0, nx, ny, nz] = pr.box;
      const mat = new THREE.MeshStandardMaterial({ map: tex[pr.tex || 'deepslate'], roughness: 0.92 });
      const im = new THREE.InstancedMesh(geo, mat, nx * ny * nz);
      let i = 0;
      for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) for (let c = 0; c < nz; c++) {
        m.makeTranslation(x0 + a * 16 + 8, y0 + b * 16 + 8, z0 + c * 16 + 8); im.setMatrixAt(i++, m);
      }
      im.receiveShadow = true; im.castShadow = true;
      g.add(im);
    } else if (pr.type === 'vines') {
      VINE_TEX = VINE_TEX || vineTexture();
      const mat = new THREE.MeshStandardMaterial({ map: VINE_TEX, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
      const r = rng(pr.seed || 5);
      for (const x of pr.xs) {
        const len = pr.len || 96;
        const q = new THREE.Mesh(new THREE.PlaneGeometry(10, len), mat);
        q.position.set(x, pr.top - len / 2 + r() * 10, pr.z + r() * 6);
        q.castShadow = true;
        g.add(q);
      }
    }
  }
  return g;
}

function setShot(shot) {
  current = shot;
  if (props) { scene.remove(props); props = null; }
  if (shot.props) { props = buildProps(shot.props); scene.add(props); }
  if (shot.env !== (setShot.lastEnv || null) || shot.waterLevel !== setShot.lastLevel) {
    setEnv(shot.env, { waterLevel: shot.waterLevel, waterOpacity: shot.waterOpacity });
    setShot.lastEnv = shot.env; setShot.lastLevel = shot.waterLevel;
  }
  parts.setEmitters(shot.particles ? shot.particles(meta) : [], 7);
  motes.setEmitters(shot.env === 'studio' ? [] : [{
    t0: -8, t1: shot.dur, rate: 12, at: () => [0, 50, -60], spread: [260, 110, 220], vel: [3, 2, -1], vspread: [3, 2, 3],
    life: 14, size: shot.env === 'underwater' ? 1.1 : 0.7, color: shot.env === 'underwater' ? [0.22, 0.45, 0.5] : [0.18, 0.24, 0.28], gravity: 0, wobble: 5,
  }], 3);
  if (water && shot.ripples) {
    const list = shot.ripples(meta);
    water.material.uniforms.ripples.value.forEach((v, i) => {
      const r = list[i];
      if (r) v.set(r[0], r[1], r[2], r[3]); else v.set(0, 0, -100, 0);
    });
  }
}

function renderFrame(shot, t, opts = {}) {
  if (current !== shot) setShot(shot);
  // model placement + root motion
  const base = shot.at || [0, 0, 0];
  const speed = shot.speed !== undefined ? shot.speed : (shot.anim && meta[shot.anim] && meta[shot.anim].speed) || 0;
  model.root.position.set(base[0], base[1], base[2] - speed * t);
  model.root.rotation.y = (shot.yaw || 0) + (shot.spin ? shot.spin(t) : 0);
  applyPose(model, poseAt(shot, t));
  // camera
  const c = shot.camera(t, model.root.position.clone());
  if (opts.dolly && opts.dolly !== 1) c.pos = c.pos.map((v, i) => c.target[i] + (v - c.target[i]) * opts.dolly);
  camera.position.set(...c.pos);
  camera.fov = c.fov || 35;
  camera.aspect = RW / RH;
  camera.updateProjectionMatrix();
  camera.lookAt(new THREE.Vector3(...c.target));
  if (c.roll) camera.rotateZ(c.roll);
  // lights follow the shot
  const L = shot.lights || {};
  const mp = model.root.position;
  key.position.set(mp.x + (L.keyDir ? L.keyDir[0] : -120), mp.y + (L.keyDir ? L.keyDir[1] : 220), mp.z + (L.keyDir ? L.keyDir[2] : -200));
  key.target.position.set(mp.x, mp.y + 20, mp.z);
  key.intensity = L.key ?? 1.6;
  Object.assign(key.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 900 });
  key.shadow.camera.updateProjectionMatrix();
  rim.position.set(mp.x + 60, mp.y + 140, mp.z + 260); rim.target.position.copy(mp);
  rim.intensity = L.rim ?? 1.3;
  under.position.set(mp.x, mp.y - 100, mp.z - 120); under.target.position.set(mp.x, mp.y + 40, mp.z);
  under.intensity = L.under ?? 0.35;
  hemi.intensity = L.hemi ?? 0.85;
  camFill.position.copy(camera.position).add(new THREE.Vector3(0, 30, 0));
  camFill.target.position.set(mp.x, mp.y + 26, mp.z);
  camFill.intensity = L.fill ?? 0.8;
  renderer.toneMappingExposure = shot.exposure ?? 1.15;
  if (torch) {
    const fl = 0.85 + 0.1 * Math.sin(t * 17.3) + 0.06 * Math.sin(t * 29.1 + 1.3) + 0.05 * Math.sin(t * 7.7);
    torch.userData.light.intensity = (L.torch ?? 260) * fl;
    torch.userData.flame.scale.setScalar(0.9 + 0.15 * fl);
  }
  if (water) water.material.uniforms.time.value = t + (shot.waterTime || 0);
  if (surfaceBelow) surfaceBelow.material.uniforms.time.value = t;
  parts.update(t);
  motes.update(t);
  // grade
  const fd = shot.fade ?? 0.25;
  let f = 1;
  if (fd > 0) f = Math.min(1, t / fd, (shot.dur - t) / fd);
  grade.uniforms.fade.value = opts.noFade ? 1 : Math.max(0, f);
  grade.uniforms.time.value = t + (shot.index || 0) * 3.1;
  grade.uniforms.vig.value = shot.vignette ?? 0.75;
  grade.uniforms.grain.value = opts.noGrain ? 0 : (shot.grain ?? 0.03);
  grade.uniforms.tint.value.set(...(shot.tint || [1, 1, 1]));
  bloom.strength = shot.bloom ?? 0.55;
  renderer.clear();
  composer.render();
  if (!opts.noHud) {
    drawHud(shot, t);
    renderer.render(hudScene, hudCam);
  }
}

// ---------------------------------------------------------------- API
function timeline() {
  let t0 = 0;
  return SHOTS.map((s, i) => { const o = { ...s, index: i, start: t0 }; t0 += s.dur; return o; });
}
let TL = null;

window.api = {
  ready: init().then(() => { TL = timeline(); return true; }),
  duration: () => TL.reduce((a, s) => a + s.dur, 0),
  frames: () => Math.round(TL.reduce((a, s) => a + s.dur, 0) * FPS),
  shots: () => TL.map(s => ({ name: s.name, start: s.start, dur: s.dur })),
  frame(i, fmt = 'png') {
    const t = i / FPS;
    let shot = TL[TL.length - 1];
    for (const s of TL) if (t >= s.start && t < s.start + s.dur) { shot = s; break; }
    renderFrame(shot, Math.min(t - shot.start, shot.dur - 1e-4));
    return renderer.domElement.toDataURL(fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
  },
  still(name, t, dolly) {
    const s = STILLS[name];
    const shot = { ...s, index: 99, name };
    current = null;
    renderFrame(shot, t ?? s.t ?? 0, { noFade: true, noHud: s.hud !== true, noGrain: true, dolly });
    return renderer.domElement.toDataURL('image/png');
  },
  render(job) {
    if (job.w && job.h && (job.w !== renderer.domElement.width || job.h !== renderer.domElement.height)) this.resize(job.w, job.h);
    if (job.silhouette) {
      const m = model.material;
      const flat = new THREE.MeshBasicMaterial({ color: 0x8c8c8c });
      model.root.traverse(o => { if (o.isMesh) o.material = flat; });
      const shot = { ...STILLS[job.still], index: 99, name: job.still };
      current = null;
      const env0 = shot.env;
      renderFrame({ ...shot, env: 'studio', exposure: 1.0 }, job.t ?? 0, { noFade: true, noHud: true, noGrain: true });
      model.root.traverse(o => { if (o.isMesh) o.material = m; });
      return renderer.domElement.toDataURL('image/png');
    }
    return this.still(job.still, job.t, job.dolly);
  },
  resize(w, h) {
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    hudCanvas.width = w; hudCanvas.height = h;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    RW = w; RH = h;
  },
};
