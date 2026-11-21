// A plain voxel world for the preview scenes: flat-shaded cubes with a pixel noise texture,
// water, a sky that follows the time of day, a few point lights.  Drawn by this tool from its
// own colours; no game textures are used.
import * as THREE from 'three';

const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  'minecraft:grass_block': { top: C('#5d9a3c'), side: C('#7a5a3a'), bottom: C('#7a5a3a') },
  'minecraft:dirt': C('#7a5a3a'), 'minecraft:coarse_dirt': C('#5f4630'), 'minecraft:mud': C('#3b3330'),
  'minecraft:stone': C('#7d7d7d'), 'minecraft:cobblestone': C('#6f6f6f'), 'minecraft:gravel': C('#84807c'),
  'minecraft:sand': C('#d9cf9c'), 'minecraft:smooth_basalt': C('#3a3a3f'), 'minecraft:copper_block': C('#c06c4f'),
  'minecraft:oak_planks': C('#a8854f'), 'minecraft:spruce_planks': C('#6b4f2e'), 'minecraft:oak_log': { top: C('#b39355'), side: C('#5e4a2c'), bottom: C('#b39355') },
  'minecraft:oak_door': C('#8f6f3f'), 'minecraft:oak_fence': C('#a8854f'), 'minecraft:netherrack': C('#6f3535'),
};
const SMALL = {     // blocks drawn smaller than a full cube: [half x, y0, y1, half z]
  'minecraft:oak_fence': [0.13, 0, 1, 0.13], 'minecraft:lantern': [0.19, 0.0, 0.5, 0.19], 'minecraft:torch': [0.07, 0, 0.62, 0.07],
  'minecraft:lightning_rod': [0.09, 0, 1, 0.09],
};
const EMISSIVE = { 'minecraft:lantern': C('#ffd27a'), 'minecraft:torch': C('#ffcf70') };
const SPECIAL_COLOR = { 'minecraft:lantern': C('#ffd27a'), 'minecraft:torch': C('#e8b860'), 'minecraft:lightning_rod': C('#c7714f'), 'minecraft:glass': C('#cfe8f0') };

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noiseTexture() {
  const s = 16, data = new Uint8Array(s * s * 4);
  for (let i = 0; i < s * s; i++) {
    const v = 200 + Math.floor(hash3(i % s, Math.floor(i / s), 7) * 55);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, s, s);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}

const VERT = `
attribute vec3 color; attribute float glow;
varying vec3 vC; varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying float vDepth; varying float vGlow;
void main(){ vC = color; vUv = uv; vN = normal; vGlow = glow; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const FRAG = `
uniform sampler2D map; uniform vec3 uLight; uniform vec3 uAmbient; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
uniform vec3 uPts[10]; uniform vec3 uPtc[10]; uniform float uPtr[10]; uniform float uWaterY; uniform vec3 uWaterTint; uniform float uUnderwater; uniform float uAlpha;
varying vec3 vC; varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying float vDepth; varying float vGlow;
void main(){
  vec3 n = normalize(vN);
  float face = n.y > 0.5 ? 1.0 : (n.y < -0.5 ? 0.5 : (abs(n.z) > 0.5 ? 0.8 : 0.62));
  vec3 lit = uAmbient + uLight * face;
  for (int i = 0; i < 10; i++) {
    vec3 d = uPts[i] - vW; float a = clamp(1.0 - length(d) / uPtr[i], 0.0, 1.0);
    lit += uPtc[i] * a * a * (0.35 + 0.65 * max(dot(n, normalize(d)), 0.0));
  }
  vec3 c = vC * texture2D(map, vUv).rgb * mix(min(lit, vec3(1.3)), vec3(1.2), vGlow);
  float sub = clamp((uWaterY - vW.y) * 0.16, 0.0, 1.0) * (1.0 - uUnderwater);
  c = mix(c, c * uWaterTint * 0.8 + uWaterTint * 0.08, sub * 0.8);
  float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(c, uFogColor, f), uAlpha);
}`;

export function makeWorldEnv(env) {
  env.uPts = { value: Array.from({ length: 10 }, () => new THREE.Vector3(0, -1e5, 0)) };
  env.uPtc = { value: Array.from({ length: 10 }, () => new THREE.Color(0, 0, 0)) };
  env.uPtr = { value: Array.from({ length: 10 }, () => 1) };
  return env;
}

export class VoxelWorld {
  constructor(terrainFn, bounds, env) {
    this.fn = terrainFn; this.b = bounds; this.env = env; this.edits = new Map();
    this.group = new THREE.Group();
    this.tex = noiseTexture();
    this.mat = new THREE.ShaderMaterial({ uniforms: { ...env, map: { value: this.tex }, uAlpha: { value: 1 } }, vertexShader: VERT, fragmentShader: FRAG });
    this.glassMat = new THREE.ShaderMaterial({ uniforms: { ...env, map: { value: this.tex }, uAlpha: { value: 0.28 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { ...env, uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vW; varying float vDepth; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uLight; uniform vec3 uAmbient; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uTime; uniform float uUnderwater; uniform vec3 uPts[10]; uniform vec3 uPtc[10]; uniform float uPtr[10];
        varying vec3 vW; varying float vDepth;
        void main(){
          vec2 p = floor(vW.xz * 4.0) / 4.0;
          float r = sin(p.x * 1.7 + uTime * 1.3) * sin(p.y * 2.1 - uTime * 0.9);
          vec3 lit = uAmbient + uLight * 0.9;
          for (int i = 0; i < 10; i++) { float a = clamp(1.0 - length(uPts[i] - vW) / uPtr[i], 0.0, 1.0); lit += uPtc[i] * a * a * 1.3; }
          vec3 c = (vec3(0.13, 0.30, 0.55) + 0.06 * r) * lit;
          float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
          gl_FragColor = vec4(mix(c, uFogColor, f), mix(0.72, 0.42, uUnderwater));
        }`,
    });
    this.lights = [];
    this.rebuild();
  }
  id(x, y, z) { return this.edits.get(`${x},${y},${z}`) ?? this.fn('minecraft:overworld', x, y, z); }
  setBlock(x, y, z, id) { this.edits.set(`${x},${y},${z}`, id); this.dirty = true; }

  rebuild() {
    this.dirty = false;
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); }
    const { x0, x1, y0, y1, z0, z1 } = this.b;
    const pos = [], nor = [], uv = [], col = [], glow = [], idx = [];
    const gpos = [], gnor = [], guv = [], gcol = [], gglow = [], gidx = [];
    const wpos = [], widx = [];
    this.lights = [];
    const solid = (id) => id !== 'minecraft:air' && id !== 'minecraft:water' && !(id in SMALL) && id !== 'minecraft:glass';
    const quad = (P, N, U, Cc, G, I, a, b, c, d, n, color, g) => {
      const base = P.length / 3;
      for (const p of [a, b, c, d]) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); Cc.push(color.r, color.g, color.b); G.push(g); }
      U.push(0, 0, 1, 0, 1, 1, 0, 1);
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const box = (P, N, U, Cc, G, I, lo, hi, colors, g, neighbour) => {
      const [ax, ay, az] = lo, [bx, by, bz] = hi;
      const F = [
        [[0, 1, 0], [[ax, by, bz], [bx, by, bz], [bx, by, az], [ax, by, az]], colors.top],
        [[0, -1, 0], [[ax, ay, az], [bx, ay, az], [bx, ay, bz], [ax, ay, bz]], colors.bottom],
        [[0, 0, 1], [[ax, ay, bz], [bx, ay, bz], [bx, by, bz], [ax, by, bz]], colors.side],
        [[0, 0, -1], [[bx, ay, az], [ax, ay, az], [ax, by, az], [bx, by, az]], colors.side],
        [[1, 0, 0], [[bx, ay, bz], [bx, ay, az], [bx, by, az], [bx, by, bz]], colors.side],
        [[-1, 0, 0], [[ax, ay, az], [ax, ay, bz], [ax, by, bz], [ax, by, az]], colors.side],
      ];
      for (const [n, q, c] of F) { if (neighbour && neighbour(n)) continue; quad(P, N, U, Cc, G, I, q[0], q[1], q[2], q[3], n, c, g); }
    };
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
      const id = this.id(x, y, z);
      if (id === 'minecraft:air') continue;
      if (id === 'minecraft:water') {
        if (this.id(x, y + 1, z) !== 'minecraft:water') {
          const b = wpos.length / 3, t = y + 0.9;
          wpos.push(x, t, z, x + 1, t, z, x + 1, t, z + 1, x, t, z + 1);
          widx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        }
        continue;
      }
      const tint = 0.9 + 0.2 * hash3(x, y, z);
      if (id in SMALL) {
        const [hx, a, b, hz] = SMALL[id];
        const c = (SPECIAL_COLOR[id] ?? PALETTE[id] ?? C('#888')).clone();
        const yoff = id === 'minecraft:lantern' && this.id(x, y - 1, z) === 'minecraft:air' ? 0.45 : 0;
        box(pos, nor, uv, col, glow, idx, [x + 0.5 - hx, y + a + yoff, z + 0.5 - hz], [x + 0.5 + hx, y + b + yoff, z + 0.5 + hz], { top: c, side: c, bottom: c }, id in EMISSIVE ? 1 : 0, null);
        if (id in EMISSIVE) this.lights.push({ pos: new THREE.Vector3(x + 0.5, y + 0.6, z + 0.5), color: EMISSIVE[id], range: id === 'minecraft:torch' ? 10 : 13 });
        continue;
      }
      if (id === 'minecraft:glass') {
        const c = SPECIAL_COLOR[id];
        box(gpos, gnor, guv, gcol, gglow, gidx, [x, y, z], [x + 1, y + 1, z + 1], { top: c, side: c, bottom: c }, 0, (n) => this.id(x + n[0], y + n[1], z + n[2]) === 'minecraft:glass');
        continue;
      }
      const p = PALETTE[id] ?? C('#8a8a8a');
      const cs = p.isColor ? { top: p, side: p, bottom: p } : p;
      const colors = { top: cs.top.clone().multiplyScalar(tint), side: cs.side.clone().multiplyScalar(tint), bottom: cs.bottom.clone().multiplyScalar(tint) };
      box(pos, nor, uv, col, glow, idx, [x, y, z], [x + 1, y + 1, z + 1], colors, 0, (n) => solid(this.id(x + n[0], y + n[1], z + n[2])));
    }
    const mk = (P, N, U, Cc, G, I, mat, order = 0) => {
      if (!P.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
      g.setAttribute('glow', new THREE.Float32BufferAttribute(G, 1));
      g.setIndex(I);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = order; this.group.add(m);
    };
    mk(pos, nor, uv, col, glow, idx, this.mat);
    mk(gpos, gnor, guv, gcol, gglow, gidx, this.glassMat, 3);
    if (wpos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      g.setIndex(widx);
      const m = new THREE.Mesh(g, this.waterMat); m.frustumCulled = false; m.renderOrder = 4; this.group.add(m);
    }
  }
}

/** Sky, fog and light for a Minecraft time of day (0..24000) and weather. */
export function applySky(env, renderer, tod, opts = {}) {
  const t = ((tod % 24000) + 24000) % 24000;
  const key = [
    [0, '#f6b47a', '#ffd9a8', 0.86], [1500, '#8fb7ef', '#fff7e6', 1.0], [10500, '#8fb7ef', '#fff7e6', 1.0], [11800, '#f09a5c', '#ffc98f', 0.8],
    [12600, '#a2506a', '#c97c6a', 0.5], [13400, '#1c2244', '#5a6ea8', 0.26], [18000, '#0a0e1f', '#46578c', 0.2], [22600, '#1c2244', '#5a6ea8', 0.26], [24000, '#f6b47a', '#ffd9a8', 0.86],
  ];
  let i = 0;
  while (i < key.length - 2 && t >= key[i + 1][0]) i++;
  const [t0, s0, l0, b0] = key[i], [t1, s1, l1, b1] = key[i + 1];
  const k = (t - t0) / Math.max(1, t1 - t0);
  const sky = new THREE.Color(s0).lerp(new THREE.Color(s1), k);
  const light = new THREE.Color(l0).lerp(new THREE.Color(l1), k);
  let bright = b0 + (b1 - b0) * k;
  if (opts.rain) { sky.lerp(new THREE.Color('#1a1e2a'), 0.55); bright *= 0.75; }
  env.uLight.value.copy(light).multiplyScalar(bright * 0.62);
  env.uAmbient.value.copy(sky).multiplyScalar(0.34).add(new THREE.Color(0.06, 0.065, 0.085));
  const under = opts.underwater ? 1 : 0;
  env.uUnderwater.value = under;
  const fog = under ? new THREE.Color('#0b2a44').multiplyScalar(0.35 + bright * 0.9) : sky;
  env.uFogColor.value.copy(fog);
  env.uFogNear.value = under ? 4 : (opts.rain ? 30 : 60);
  env.uFogFar.value = under ? 52 : (opts.rain ? 110 : 190);
  renderer.setClearColor(fog, 1);
  return { sky, bright };
}

/** Point lights: the nearest fixed ones plus whatever the scene adds this frame. */
export function setLights(env, fixed, dynamic, focus) {
  const all = [...dynamic, ...fixed.slice().sort((a, b) => a.pos.distanceTo(focus) - b.pos.distanceTo(focus))].slice(0, 10);
  for (let i = 0; i < 10; i++) {
    const l = all[i];
    if (l) { env.uPts.value[i].copy(l.pos); env.uPtc.value[i].copy(l.color).multiplyScalar(l.power ?? 1); env.uPtr.value[i] = l.range; }
    else { env.uPts.value[i].set(0, -1e5, 0); env.uPtc.value[i].setRGB(0, 0, 0); env.uPtr.value[i] = 1; }
  }
  // the model shader has a single point light: give it the strongest nearby one
  const best = all[0];
  if (best) { env.uPoint.value.copy(best.pos); env.uPointColor.value.copy(best.color).multiplyScalar(best.power ?? 1); env.uPointRange.value = best.range; }
  else env.uPointColor.value.setRGB(0, 0, 0);
}
