// Stillwater Caves preview renderer. Draws out/biome_scene.json + out/biome_faces.bin (made by biome_preview.py from
// the biome's own generation rules) the way Bedrock lights a cave: every face carries the smooth block light and
// ambient occlusion baked by the simulation (candles, bloodroot, pallid caps and veined deepslate are the only light),
// Minecraft's directional face shading, the biome's fog and water colour, and drifting ash. The lake is a reflective
// surface; the Brinesleeper can stand chest-deep in it.
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
const B = 16;                                       // one block = 16 units

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = 0x0c1216;                               // the biome's fog colour, fixed 8..96 blocks
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 8 * B, 96 * B);
const camera = new THREE.PerspectiveCamera(60, W / H, 1, 6000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.55, 0.62);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let S = null, OFF = null, water = null, model = null;
const loader = new THREE.TextureLoader();
async function json(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }
const texCache = {};
async function tex(name) {
  if (!texCache[name]) {
    const t = await loader.loadAsync(`${ASSET}/biome_tex/${name}.png`);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    texCache[name] = t;
  }
  return texCache[name];
}
const P = (x, y, z) => new THREE.Vector3((x - OFF[0]) * B, (y - OFF[1]) * B, (z - OFF[2]) * B);

// ------------------------------------------------------------------ light: Bedrock-like curve, warm block light over a cold minimum
const AMBIENT = new THREE.Color(0.07, 0.085, 0.11);
const WARM = new THREE.Color(1.0, 0.78, 0.55);
function lightColor(level, k = 1) {
  const f = level / 15;
  const curve = f / (3 - 2 * f);                    // the vanilla light-map falloff
  return new THREE.Color(AMBIENT.r + WARM.r * curve * 1.6, AMBIENT.g + WARM.g * curve * 1.6, AMBIENT.b + WARM.b * curve * 1.6).multiplyScalar(k);
}
const SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];       // +x -x +y -y +z -z, as Minecraft shades faces
const AO = [1.0, 0.78, 0.62, 0.5];

// textures per block: [side, top, bottom]
const TEX = {
  stone: 'stone', deepslate: ['deepslate', 'deepslate_top', 'deepslate_top'], tuff: 'tuff', smooth_basalt: 'smooth_basalt',
  dripstone_block: 'dripstone_block', gravel: 'gravel', mud: 'mud', clay: 'clay', calcite: 'calcite',
  bloodstained_deepslate: ['bloodstained_deepslate', 'bloodstained_deepslate_top', 'bloodstained_deepslate_bottom'],
  clawed_deepslate: ['clawed_deepslate', 'deepslate_top_plain', 'deepslate_top_plain'],
  tracked_mud: ['mud_plain', 'tracked_mud_top', 'mud_plain'],
  veined_deepslate: ['veined_deepslate', 'veined_deepslate_top', 'veined_deepslate_top'],
  cobbled_deepslate: 'cobbled_deepslate', bone_block: ['bone_block', 'bone_block_top', 'bone_block_top'],
  deepslate_bricks: 'deepslate_bricks', cracked_deepslate_bricks: 'cracked_deepslate_bricks', deepslate_tiles: 'deepslate_tiles',
  polished_deepslate: 'polished_deepslate', chiseled_deepslate: ['chiseled_deepslate', 'polished_deepslate', 'polished_deepslate'],
  deepslate_brick_slab: 'deepslate_bricks', chest: 'chest',
};
const texFor = (name, face) => { const t = TEX[name]; if (!Array.isArray(t)) return t; return face === 2 ? t[1] : face === 3 ? t[2] : t[0]; };

// a material that shows the texture lit by the baked vertex colours; bright red pixels of glowing blocks also emit
function blockMaterial(map, glow = 0, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ map, vertexColors: true, ...opts });
  if (glow) {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n  vec3 glowTex = diffuseColor.rgb;')
        .replace('#include <opaque_fragment>',
          `float glowK = smoothstep(0.42, 0.75, glowTex.r) * (1.0 - smoothstep(0.18, 0.35, glowTex.g));
           outgoingLight += glowTex * glowK * ${glow.toFixed(2)};
           #include <opaque_fragment>`);
    };
  }
  return m;
}
const GLOW = { veined_deepslate: 1.4, veined_deepslate_top: 1.4, bloodroot: 1.6, pallid_cap: 0.0 };

// unit quads for the six faces (corner order matches biome_preview.faces: (u-,v-), (u-,v+), (u+,v-), (u+,v+))
const AX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

async function buildBlocks() {
  const buf = await (await fetch(`${ASSET}/biome_faces.bin`)).arrayBuffer();
  const F = new Int16Array(buf);
  const N = F.length / 9;
  const groups = {};
  for (let i = 0; i < N; i++) {
    const o = i * 9, face = F[o + 3], name = S.names[F[o + 4]];
    const t = texFor(name, face);
    (groups[t] ||= []).push(o);
  }
  for (const [t, list] of Object.entries(groups)) {
    const pos = new Float32Array(list.length * 12), uv = new Float32Array(list.length * 8), col = new Float32Array(list.length * 12);
    const idx = new Uint32Array(list.length * 6);
    list.forEach((o, n) => {
      const x = F[o], y = F[o + 1], z = F[o + 2], f = F[o + 3];
      const d = AX[f];
      const axes = [0, 1, 2].filter(a => d[a] === 0);
      const ua = axes[0], ub = axes[1];
      const c = [x + 0.5 + d[0] * 0.5, y + 0.5 + d[1] * 0.5, z + 0.5 + d[2] * 0.5];
      let k = 0;
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const p = c.slice(); p[ua] += su * 0.5; p[ub] += sv * 0.5;
        const w = P(p[0], p[1], p[2]);
        pos.set([w.x, w.y, w.z], n * 12 + k * 3);
        // texture coordinates: u along the face's horizontal axis, v up the side (top and bottom: x and z)
        let u, v;
        if (f === 2 || f === 3) { u = p[0] - x; v = p[2] - z; }
        else if (f === 0 || f === 1) { u = p[2] - z; v = p[1] - y; }
        else { u = p[0] - x; v = p[1] - y; }
        uv.set([u, v], n * 8 + k * 2);
        const cv = F[o + 5 + k], ao = cv & 3, lv = (cv >> 2) / 4;
        const cc = lightColor(lv, SHADE[f] * AO[ao]);
        col.set([cc.r, cc.g, cc.b], n * 12 + k * 3);
        k++;
      }
      const b = n * 4;
      idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], n * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const map = await tex(t); map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const mesh = new THREE.Mesh(g, blockMaterial(map, GLOW[t] || 0, { side: THREE.DoubleSide }));
    scene.add(mesh);
  }
}

// cross planes (plants, dripstone, vines) with the light of their own cell
async function crossPlanes(items, texOf, opts = {}) {
  const groups = {};
  for (const it of items) (groups[texOf(it)] ||= []).push(it);
  for (const [t, list] of Object.entries(groups)) {
    const pos = [], uv = [], col = [], idx = [];
    for (const it of list) {
      const [x, y, z] = it, lv = it[it.length - 1];
      const flip = opts.flip && opts.flip(it);
      const cc = lightColor(lv, 0.95);
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const ca = Math.cos(a) * 0.5, sa = Math.sin(a) * 0.5;
        const base = pos.length / 3;
        for (const [s, h] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
          const w = P(x + 0.5 + ca * s, y + h, z + 0.5 + sa * s);
          pos.push(w.x, w.y, w.z);
          uv.push((s + 1) / 2, flip ? 1 - h : h);
          col.push(cc.r, cc.g, cc.b);
        }
        idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const map = await tex(t);
    scene.add(new THREE.Mesh(g, blockMaterial(map, GLOW[t] || 0, { alphaTest: 0.5, side: THREE.DoubleSide })));
  }
}

// lit candles: vanilla's 1-4 candle arrangements, wax lit by their own light, flames that bloom
const CANDLE_SPOTS = [[[8, 8]], [[6, 8], [10, 7]], [[8, 6], [6, 9], [10, 9]], [[6, 6], [10, 6], [6, 10], [9, 10]]];
const CANDLE_H = [[6], [6, 5], [6, 5, 3], [6, 5, 4, 3]];
async function buildCandles() {
  const flames = [];
  for (const [x, y, z, n, red, lv] of S.candles) {
    const m = new THREE.MeshBasicMaterial({ map: await tex(red ? 'red_candle' : 'candle'), color: lightColor(Math.max(lv, 9), 1.0) });
    CANDLE_SPOTS[n - 1].forEach(([px, pz], i) => {
      const h = CANDLE_H[n - 1][i];
      const g = new THREE.BoxGeometry(2, h, 2);
      const mesh = new THREE.Mesh(g, m);
      const w = P(x + px / 16, y + h / 32, z + pz / 16);
      mesh.position.copy(w);
      scene.add(mesh);
      flames.push(P(x + px / 16, y + (h + 1.6) / 16, z + pz / 16));
    });
  }
  const fg = new THREE.BufferGeometry().setFromPoints(flames);
  scene.add(new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffd27a, size: 3.2, sizeAttenuation: true, transparent: true, opacity: 1.0 })));
  const halo = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xff9a3c, size: 9, sizeAttenuation: true, transparent: true,
    opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(halo);
}

async function buildWorld() {
  S = await json(`${ASSET}/biome_scene.json`);
  OFF = [S.size[0] / 2, S.water_y, S.size[2] / 2];
  await buildBlocks();
  await crossPlanes(S.plants, it => it[3]);
  await crossPlanes(S.pale, it => `pale_dripstone_${it[3]}`);
  await crossPlanes(S.vines, it => (it[3] ? 'weeping_vines_tip' : 'weeping_vines'));
  await crossPlanes(S.dripstone, it => `pointed_dripstone_${it[3]}`, { flip: it => it[4] === 1 });
  await buildCandles();
  water = makeWater(S.size[0] * B * 1.2, -2, { color: 0x14222a, glint: 0x8fb4c8, opacity: 0.78, reflect: 0.85, res: 1536, waves: 0.22 });
  water.position.x = 0; water.position.z = 0;
  scene.add(water);
  // drifting ash (the biome's minecraft:precipitation)
  const r = rng(5), n = 5000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (r() - 0.5) * S.size[0] * B; pos[i * 3 + 1] = (r() * 18 + 0.5) * B; pos[i * 3 + 2] = (r() - 0.5) * S.size[2] * B;
  }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x7c838c, size: 1.2, transparent: true, opacity: 0.32, depthWrite: false })));
}

const hemi = new THREE.HemisphereLight(0x6f8094, 0x1c1f26, 0.9);    // lights only the creature model
const glowLight = new THREE.PointLight(0xffc18a, 0, 0, 1.2);
scene.add(hemi, glowLight);

async function buildModelInLake() {
  const geo = await json(`${ASSET}/brinesleeper.geo.json`);
  const t = await loader.loadAsync(`${ASSET}/brinesleeper.png`);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  model = buildModel(geo, t, { material: new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5 }) });
  model.anims = compileAnimations(await json(`${ASSET}/brinesleeper.animation.json`));
  model.root.scale.setScalar(1.15);               // the in-game scale (horror.py SCALE)
  scene.add(model.root);
}

function render(job) {
  if (job.w && job.h && (job.w !== W || job.h !== H)) {
    W = job.w; H = job.h; renderer.setSize(W, H); composer.setSize(W, H); camera.aspect = W / H;
  }
  const v = S.views[job.view] || {};
  const cam = job.cam || v.cam, look = job.look || v.look;
  camera.fov = job.fov || 62; camera.updateProjectionMatrix();
  camera.position.copy(P(...cam)); camera.lookAt(P(...look));
  if (job.roll) camera.rotateZ(job.roll);
  scene.fog.far = (job.fogFar ?? 96) * B; scene.fog.near = (job.fogNear ?? 8) * B;
  renderer.clippingPlanes = job.cutaway ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), (job.cutaway - OFF[1]) * B)] : [];
  if (model) {
    const m = job.view === 'lurk' ? S.views.lurk.model : S.views.model;
    model.root.visible = !!job.creature && !!m;
    if (m && job.creature) {
      applyPose(model, samplePose(model.anims[`animation.brinesleeper.${job.anim || 'idle_water'}`], job.animTime ?? 1.2));
      const p = P(m[0], m[1], m[2]);
      model.root.position.set(p.x, p.y - 2 - 33 * 1.15, p.z);  // chest-deep: the pose's waterline is 33 px up, scaled
      const dx = cam[0] - m[0], dz = cam[2] - m[2];
      model.root.rotation.y = Math.atan2(-dx, -dz);             // facing the viewer (the model faces -z)
      // the strongest candle group near the creature lights it, as block light would
      let best = null;
      for (const c of S.candles) {
        const d = Math.hypot(c[0] - m[0], c[2] - m[2]);
        if (d < 24 && (!best || c[3] / d > best[3] / best.d)) { best = c; best.d = d; }
      }
      if (best) { glowLight.position.copy(P(best[0] + 0.5, best[1] + 1, best[2] + 0.5)); glowLight.intensity = 2200 * best[3] / 4; }
      else glowLight.intensity = 0;
    }
  }
  if (water) water.material.uniforms.time.value = job.time ?? 2.0;
  renderer.toneMappingExposure = job.exposure ?? 1.5;
  bloom.strength = job.bloom ?? 0.7;
  composer.render();
  return renderer.domElement.toDataURL('image/png');
}

window.api = { ready: (async () => { await buildWorld(); await buildModelInLake(); return true; })(), render };
