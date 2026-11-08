// Procedural voxel cave environments + water + particles for the Brinesleeper preview.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z, s) {
  let h = (x * 374761393 + z * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
}
export function fbm(x, z, s) { return 0.6 * vnoise(x, z, s) + 0.3 * vnoise(x * 2.1, z * 2.1, s + 7) + 0.1 * vnoise(x * 4.3, z * 4.3, s + 13); }

// ------------------------------------------------------------------ block textures (16x16, pixel art)
function canvasTex(draw, w = 16, h = 16) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseTex(seed, base, amp, extra) {
  return canvasTex((g, w, h) => {
    const r = rng(seed);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let k = (r() - 0.5) * amp;
      let col = base.map(v => v + k);
      if (extra) col = extra(x, y, r, col);
      g.fillStyle = `rgb(${col.map(v => Math.max(0, Math.min(255, v | 0))).join(',')})`;
      g.fillRect(x, y, 1, 1);
    }
  });
}
export function blockTextures() {
  return {
    deepslate: noiseTex(11, [46, 47, 55], 16, (x, y, r, c) => (y % 4 === 0 && r() < 0.6) ? c.map(v => v - 10) : (r() < 0.06 ? c.map(v => v + 14) : c)),
    stone: noiseTex(23, [78, 77, 80], 22, (x, y, r, c) => r() < 0.08 ? c.map(v => v - 20) : c),
    gravel: noiseTex(37, [64, 60, 58], 30, (x, y, r, c) => r() < 0.2 ? c.map(v => v + 22) : (r() < 0.2 ? c.map(v => v - 18) : c)),
    mud: noiseTex(41, [44, 38, 36], 12, (x, y, r, c) => r() < 0.1 ? c.map(v => v + 10) : c),
    wet: noiseTex(53, [40, 46, 48], 14, (x, y, r, c) => r() < 0.07 ? [c[0] + 10, c[1] + 26, c[2] + 24] : c),
    tuff: noiseTex(67, [70, 72, 66], 18, (x, y, r, c) => (x % 5 === 0 && r() < 0.5) ? c.map(v => v - 12) : c),
  };
}

// ------------------------------------------------------------------ voxel environment
// spec: {x0,x1,z0,z1 (blocks), floor(bx,bz)->top height in blocks, wall(bx,bz)->bool, ceil(bx,bz)->bottom of ceiling in blocks,
//        y0 (lowest block), type(bx,by,bz,kind)->texture key}
export function buildVoxels(spec, tex) {
  const B = 16;
  const solid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const types = {};
  const put = (x, y, z, kind) => { solid.set(key(x, y, z), kind); };
  for (let bx = spec.x0; bx <= spec.x1; bx++) {
    for (let bz = spec.z0; bz <= spec.z1; bz++) {
      const top = spec.floor(bx, bz);
      const ceil = spec.ceil(bx, bz);
      if (spec.wall(bx, bz)) {
        for (let by = spec.y0; by <= ceil + 2; by++) put(bx, by, bz, 'wall');
        continue;
      }
      for (let by = spec.y0; by < top; by++) put(bx, by, bz, by === top - 1 ? 'floor' : 'under');
      for (let by = ceil; by <= ceil + 2; by++) put(bx, by, bz, 'ceil');
    }
  }
  if (spec.extra) for (const [x, y, z, k] of spec.extra) put(x, y, z, k);
  const wallFaces = [];
  const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [k, kind] of solid) {
    const [x, y, z] = k.split(',').map(Number);
    let open = false;
    for (const [dx, dy, dz] of nb) if (!solid.has(key(x + dx, y + dy, z + dz))) {
      open = true;
      if (kind === 'wall' && dy === 0) wallFaces.push([x, y, z, dx, dz]);
    }
    if (!open) continue;
    const t = spec.type(x, y, z, kind);
    (types[t] = types[t] || []).push([x, y, z]);
  }
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(B, B, B);
  const r = rng(99);
  for (const [t, list] of Object.entries(types)) {
    const mat = new THREE.MeshStandardMaterial({ map: tex[t], roughness: t === 'wet' ? 0.45 : 0.92, metalness: 0 });
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    list.forEach(([x, y, z], i) => {
      m.makeTranslation(x * B + B / 2, y * B + B / 2, z * B + B / 2);
      im.setMatrixAt(i, m);
      const v = 0.5 + r() * 0.28;
      im.setColorAt(i, col.setRGB(v, v, v));
    });
    im.receiveShadow = true;
    im.castShadow = false;
    group.add(im);
  }
  group.userData.count = [...Object.values(types)].reduce((a, l) => a + l.length, 0);
  group.userData.wallFaces = wallFaces;
  return group;
}

// ------------------------------------------------------------------ water (reflective, rippled)
export function makeWater(size, level, opts = {}) {
  const shader = {
    name: 'BrineWater',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
      time: { value: 0 }, waterColor: { value: new THREE.Color(opts.color || 0x0b1c22) },
      glint: { value: new THREE.Color(opts.glint || 0x9fd6ff) },
      ripples: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0)) },
      opacity: { value: opts.opacity ?? 0.9 }, reflectAmt: { value: opts.reflect ?? 0.85 }, waveAmp: { value: opts.waves ?? 1.0 },
    }]),
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix;
      varying vec4 vUv; varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float time; uniform vec3 waterColor; uniform vec3 glint;
      uniform vec4 ripples[8]; uniform float opacity; uniform float reflectAmt; uniform float waveAmp;
      varying vec4 vUv; varying vec3 vWorld;
      #include <fog_pars_fragment>
      vec2 waves(vec2 p) {
        vec2 g = vec2(0.0);
        g += vec2(cos(p.x * 0.045 + time * 0.9), 0.0) * 0.6;
        g += vec2(0.0, cos(p.y * 0.053 - time * 0.7)) * 0.6;
        g += vec2(cos((p.x + p.y) * 0.031 + time * 0.5)) * 0.5;
        g += vec2(cos(p.x * 0.11 - p.y * 0.07 + time * 1.7), cos(p.y * 0.12 + p.x * 0.05 - time * 1.3)) * 0.25;
        for (int i = 0; i < 8; i++) {
          vec4 r = ripples[i];
          float age = time - r.z;
          if (age < 0.0 || r.w <= 0.0) continue;
          vec2 d = p - r.xy; float dist = length(d) + 0.001;
          float front = age * 38.0;
          float env = exp(-abs(dist - front) * 0.09) * exp(-age * 0.9) * r.w;
          g += (d / dist) * sin(dist * 0.42 - age * 9.0) * env * 2.2;
        }
        return g;
      }
      void main() {
        vec2 g = waves(vWorld.xz) * waveAmp;
        vec4 uv = vUv; uv.xy += g * 0.014 * uv.w;
        vec3 refl = texture2DProj(tDiffuse, uv).rgb;
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vec3(-g.x * 0.08, 1.0, -g.y * 0.08));
        float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.0);
        float f = mix(0.18, 1.0, fres) * reflectAmt;
        vec3 col = mix(waterColor, refl, f);
        float spec = pow(max(dot(reflect(-V, N), normalize(vec3(-0.3, 1.0, 0.4))), 0.0), 120.0);
        col += glint * spec * 0.25;
        gl_FragColor = vec4(col, mix(opacity, 1.0, fres * 0.6));
        #include <fog_fragment>
      }`,
  };
  const water = new Reflector(new THREE.PlaneGeometry(size, size), {
    textureWidth: opts.res || 1024, textureHeight: opts.res || 1024, clipBias: 0.002, shader, multisample: 0,
  });
  water.material.fog = true;
  water.material.transparent = true;
  water.material.depthWrite = false;
  water.rotation.x = -Math.PI / 2;
  water.position.y = level;
  water.renderOrder = 2;
  return water;
}

// ------------------------------------------------------------------ deterministic particles
// emitters: [{t0, t1, rate, at(t)->[x,y,z], spread:[sx,sy,sz], vel:[vx,vy,vz], vspread:[..], life, size, color, gravity}]
export class Particles {
  constructor(max = 3000, opts = {}) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float psize; varying vec3 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = psize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
      vertexColors: true, transparent: opts.additive || false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !opts.additive,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.list = [];
  }
  setEmitters(emitters, seed = 1) {
    const r = rng(seed);
    this.list = [];
    for (const e of emitters) {
      const n = Math.max(1, Math.round((e.t1 - e.t0) * e.rate));
      for (let i = 0; i < n; i++) {
        const t0 = e.t0 + (e.t1 - e.t0) * (n === 1 ? 0 : i / n) + r() * (1 / e.rate);
        const p0 = e.at(t0);
        const sp = e.spread || [0, 0, 0], vs = e.vspread || [0, 0, 0], v = e.vel || [0, 0, 0];
        const ang = r() * Math.PI * 2, rad = Math.sqrt(r());
        this.list.push({
          t0, life: e.life * (0.6 + 0.8 * r()),
          p: [p0[0] + Math.cos(ang) * rad * sp[0], p0[1] + (r() - 0.5) * sp[1], p0[2] + Math.sin(ang) * rad * sp[2]],
          v: [v[0] + (r() - 0.5) * 2 * vs[0] + (e.radial ? Math.cos(ang) * e.radial * (0.5 + r()) : 0), v[1] + (r() - 0.5) * 2 * vs[1] + r() * (e.up || 0),
              v[2] + (r() - 0.5) * 2 * vs[2] + (e.radial ? Math.sin(ang) * e.radial * (0.5 + r()) : 0)],
          g: e.gravity ?? -240, size: e.size * (0.6 + 0.8 * r()), color: e.color, floor: e.floor ?? -1e9, wob: e.wobble || 0, ph: r() * 6.28,
        });
      }
    }
  }
  update(t) {
    let n = 0;
    for (const q of this.list) {
      const a = t - q.t0;
      if (a < 0 || a > q.life || n >= this.max) continue;
      let y = q.p[1] + q.v[1] * a + 0.5 * q.g * a * a;
      if (y < q.floor) continue;
      const fade = 1 - a / q.life;
      this.pos[n * 3] = q.p[0] + q.v[0] * a + (q.wob ? Math.sin(a * 3 + q.ph) * q.wob : 0);
      this.pos[n * 3 + 1] = y;
      this.pos[n * 3 + 2] = q.p[2] + q.v[2] * a + (q.wob ? Math.cos(a * 2.3 + q.ph) * q.wob : 0);
      const c = q.color;
      this.col[n * 3] = c[0] * (0.5 + 0.5 * fade); this.col[n * 3 + 1] = c[1] * (0.5 + 0.5 * fade); this.col[n * 3 + 2] = c[2] * (0.5 + 0.5 * fade);
      this.size[n] = q.size * (0.55 + 0.45 * fade);
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ torch
export function makeTorch(tex) {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 1 }));
  stick.position.y = 5;
  g.add(stick);
  const flame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  flame.position.y = 11;
  g.add(flame);
  const flame2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 1.4), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
  flame2.position.y = 12.4;
  g.add(flame2);
  const light = new THREE.PointLight(0xff8a3c, 1, 340, 1.5);
  light.position.y = 13;
  g.add(light);
  g.userData.light = light;
  g.userData.flame = flame;
  return g;
}
