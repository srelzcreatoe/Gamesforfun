// Plays the pack's own particle definitions (the subset of components the pack uses) so the
// previews show the shipped effects rather than stand-ins.
import * as THREE from 'three';
import { expr } from './molang.js';

const MAX = 6000;
const VERT = `attribute vec4 color; varying vec4 vC; varying vec2 vUv; varying float vDepth;
void main(){ vC = color; vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const FRAG = `uniform sampler2D map; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uAdd;
varying vec4 vC; varying vec2 vUv; varying float vDepth;
void main(){ vec4 t = texture2D(map, vUv); float a = t.a * vC.a; if (a < 0.01) discard;
  float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  vec3 c = vC.rgb * t.rgb;
  gl_FragColor = uAdd > 0.5 ? vec4(c * a * (1.0 - f), 1.0) : vec4(mix(c, uFogColor, f * 0.7), a); }`;

function num(e, V) { return typeof e === 'number' ? e : expr(e)({}, V); }

export class Particles {
  /** textures: one sheet, or {texture path: sheet} with the default first (each effect draws from the sheet it names). */
  constructor(defs, textures, env) {
    this.defs = defs; this.live = []; this.emitters = [];
    this.sheets = textures && textures.isTexture ? { default: textures } : textures;
    this.first = Object.keys(this.sheets)[0];
    this.layers = {};
    this.group = new THREE.Group();
    for (const [sheet, texture] of Object.entries(this.sheets)) {
      for (const [mode, add] of [['blend', 0], ['add', 1]]) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 12), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(MAX * 8), 2).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX * 16), 4).setUsage(THREE.DynamicDrawUsage));
        const idx = new Uint32Array(MAX * 6);
        for (let i = 0; i < MAX; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        const m = new THREE.ShaderMaterial({
          uniforms: { map: { value: texture }, uFogColor: env.uFogColor, uFogNear: env.uFogNear, uFogFar: env.uFogFar, uAdd: { value: add } },
          vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = add ? 9 : 8;
        this.layers[`${sheet}|${mode}`] = mesh;
        this.group.add(mesh);
      }
    }
  }

  _sheet(def) {
    const t = def.description.basic_render_parameters?.texture;
    return t && this.sheets[t] ? t : this.first;
  }

  _emit(def, origin, vars, em = null) {
    const c = def.components;
    const V = { ...vars, particle_random_1: Math.random(), particle_random_2: Math.random(), particle_random_3: Math.random(), particle_random_4: Math.random(), particle_age: 0, particle_lifetime: 1 };
    const pos = origin.clone();
    let dir = new THREE.Vector3(0, 1, 0);
    const rnd = () => new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const dirOf = (d, off) => {
      if (Array.isArray(d)) return new THREE.Vector3(num(d[0], V), num(d[1], V), num(d[2], V)).normalize();
      if (d === 'inwards') return off.clone().multiplyScalar(-1).normalize();
      return off.lengthSq() > 1e-9 ? off.clone().normalize() : rnd();
    };
    if (c['minecraft:emitter_shape_sphere']) {
      const s = c['minecraft:emitter_shape_sphere'];
      const off = rnd().multiplyScalar(num(s.radius ?? 0, V) * Math.cbrt(Math.random()));
      pos.add(off); dir = dirOf(s.direction ?? 'outwards', off);
    } else if (c['minecraft:emitter_shape_box']) {
      const s = c['minecraft:emitter_shape_box'], h = s.half_dimensions;
      const off = new THREE.Vector3((Math.random() * 2 - 1) * num(h[0], V), (Math.random() * 2 - 1) * num(h[1], V), (Math.random() * 2 - 1) * num(h[2], V));
      if (s.offset) pos.add(new THREE.Vector3(num(s.offset[0], V), num(s.offset[1], V), num(s.offset[2], V)));
      pos.add(off); dir = dirOf(s.direction ?? 'outwards', off);
    } else if (c['minecraft:emitter_shape_disc']) {
      const s = c['minecraft:emitter_shape_disc'];
      const a = Math.random() * Math.PI * 2, r = num(s.radius ?? 1, V) * Math.sqrt(Math.random());
      const off = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      pos.add(off); dir = dirOf(s.direction ?? 'outwards', off);
    } else if (c['minecraft:emitter_shape_point']) {
      const s = c['minecraft:emitter_shape_point'];
      if (s.offset) pos.add(new THREE.Vector3(num(s.offset[0], V), num(s.offset[1], V), num(s.offset[2], V)));
      dir = s.direction ? dirOf(s.direction, new THREE.Vector3()) : rnd();
    }
    const speed = num(c['minecraft:particle_initial_speed'] ?? 0, V);
    const life = num(c['minecraft:particle_lifetime_expression']?.max_lifetime ?? 1, V);
    const md = c['minecraft:particle_motion_dynamic'] || {};
    const bb = c['minecraft:particle_appearance_billboard'];
    const u = bb.uv, tw = u.texture_width ?? 1, th = u.texture_height ?? 1;
    V.particle_lifetime = life;
    if (this.live.length >= MAX) return;
    const local = em && em.object && c['minecraft:emitter_local_space'] ? em : null;
    this.live.push({
      def, V, p: pos, rel: local ? pos.clone().sub(origin) : null, em: local, v: dir.clone().multiplyScalar(speed), dir, age: 0, life,
      acc: md.linear_acceleration || [0, 0, 0], drag: md.linear_drag_coefficient || 0,
      size: bb.size, facing: bb.facing_camera_mode,
      uv: [num(u.uv[0], V) / tw, num(u.uv[1], V) / th, (num(u.uv[0], V) + num(u.uv_size[0], V)) / tw, (num(u.uv[1], V) + num(u.uv_size[1], V)) / th],
      sheet: this._sheet(def),
      tint: c['minecraft:particle_appearance_tinting']?.color ?? [1, 1, 1, 1],
      add: def.description.basic_render_parameters.material === 'particles_add',
    });
  }

  /** One server-style spawn: the emitter fires its instant burst at a world position. */
  spawn(id, pos, vars = {}) {
    const def = this.defs[id];
    if (!def) throw new Error('no particle definition for ' + id);
    const V = {};
    for (const [k, v] of Object.entries(vars || {})) V[k.replace(/^variable\./, '')] = v;
    const c = def.components;
    const inst = c['minecraft:emitter_rate_instant'];
    const origin = new THREE.Vector3(pos[0], pos[1], pos[2]);
    if (inst) { const n = num(inst.num_particles, V); for (let i = 0; i < n; i++) this._emit(def, origin, V); }
    else this.emitters.push({ def, V, origin, object: null, t: 0, carry: 0, once: c['minecraft:emitter_lifetime_once']?.active_time ?? null });
  }

  /** A locator-bound emitter that runs until stopped (animation-controller state effects). */
  attach(id, object) {
    const def = this.defs[id];
    if (!def) throw new Error('no particle definition for ' + id);
    const c = def.components;
    const em = { def, V: {}, origin: new THREE.Vector3(), object, t: 0, carry: 0, once: c['minecraft:emitter_lifetime_once']?.active_time ?? null, dead: false };
    if (c['minecraft:emitter_rate_instant']) { object.getWorldPosition(em.origin); const n = num(c['minecraft:emitter_rate_instant'].num_particles, {}); for (let i = 0; i < n; i++) this._emit(def, em.origin, {}, em); em.dead = true; }
    else this.emitters.push(em);
    return em;
  }

  /** Age and move everything (call once per simulated frame, drawn or not). */
  advance(dt) {
    for (const em of this.emitters) {
      if (em.dead) continue;
      em.t += dt;
      if (em.once != null && em.t > em.once) { em.dead = true; continue; }
      if (em.object) em.object.getWorldPosition(em.origin);
      const st = em.def.components['minecraft:emitter_rate_steady'];
      if (!st) continue;
      em.carry += num(st.spawn_rate, em.V) * dt;
      while (em.carry >= 1) { em.carry -= 1; this._emit(em.def, em.origin, em.V, em); }
    }
    this.emitters = this.emitters.filter((e) => !e.dead);
    const out = [];
    for (const p of this.live) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.v.x += (p.acc[0] - p.drag * p.v.x) * dt; p.v.y += (p.acc[1] - p.drag * p.v.y) * dt; p.v.z += (p.acc[2] - p.drag * p.v.z) * dt;
      if (p.em) { p.rel.addScaledVector(p.v, dt); p.p.copy(p.em.origin).add(p.rel); } else p.p.addScaledVector(p.v, dt);
      p.V.particle_age = p.age;
      out.push(p);
    }
    this.live = out;
  }

  /** Build the quads for this camera. */
  draw(camera) {
    const cr = new THREE.Vector3(), cu = new THREE.Vector3(), cf = new THREE.Vector3();
    camera.matrixWorld.extractBasis(cr, cu, cf);
    const count = {};
    for (const k of Object.keys(this.layers)) count[k] = 0;
    for (const p of this.live) {
      const sx = num(p.size[0], p.V), sy = num(p.size[1], p.V);
      let ax, ay;
      if (p.facing === 'lookat_direction') {
        // the quad's x axis lies along the direction and it turns about that axis to face the camera
        ax = (p.v.lengthSq() > 1e-10 ? p.v.clone().normalize() : p.dir.clone());
        const toCam = camera.position.clone().sub(p.p);
        ay = new THREE.Vector3().crossVectors(toCam, ax).normalize();
      } else if (p.facing === 'emitter_transform_xz') { ax = new THREE.Vector3(1, 0, 0); ay = new THREE.Vector3(0, 0, 1); }
      else if (p.facing === 'lookat_y' || p.facing === 'rotate_y') { ax = new THREE.Vector3(cr.x, 0, cr.z).normalize(); ay = new THREE.Vector3(0, 1, 0); }
      else { ax = cr; ay = cu; }
      let col = p.tint;
      if (!Array.isArray(col)) {
        const keys = Object.keys(col.gradient).map(Number).sort((a, b) => a - b);
        const t = Math.min(Math.max(p.age / p.life, 0), 1);
        let i = 0; while (i < keys.length - 2 && t >= keys[i + 1]) i++;
        const find = (k) => col.gradient[Object.keys(col.gradient).find((s) => Number(s) === k)];
        const a = find(keys[i]), b = find(keys[Math.min(i + 1, keys.length - 1)]);
        const k = keys[i + 1] > keys[i] ? Math.min(Math.max((t - keys[i]) / (keys[i + 1] - keys[i]), 0), 1) : 0;
        col = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
      }
      const layer = `${p.sheet}|${p.add ? 'add' : 'blend'}`, L = this.layers[layer], n = count[layer]++;
      if (n >= MAX) continue;
      const P = L.geometry.attributes.position.array, U = L.geometry.attributes.uv.array, Cc = L.geometry.attributes.color.array;
      const corners = [[-1, -1, p.uv[0], p.uv[3]], [1, -1, p.uv[2], p.uv[3]], [1, 1, p.uv[2], p.uv[1]], [-1, 1, p.uv[0], p.uv[1]]];
      for (let k = 0; k < 4; k++) {
        const [a, b, uu, vv] = corners[k];
        P[n * 12 + k * 3] = p.p.x + ax.x * a * sx + ay.x * b * sy;
        P[n * 12 + k * 3 + 1] = p.p.y + ax.y * a * sx + ay.y * b * sy;
        P[n * 12 + k * 3 + 2] = p.p.z + ax.z * a * sx + ay.z * b * sy;
        U[n * 8 + k * 2] = uu; U[n * 8 + k * 2 + 1] = vv;
        Cc.set(col, n * 16 + k * 4);
      }
    }
    for (const key of Object.keys(this.layers)) {
      const g = this.layers[key].geometry;
      g.setDrawRange(0, count[key] * 6);
      g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true; g.attributes.color.needsUpdate = true;
    }
  }
}
