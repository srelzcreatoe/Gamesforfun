// Replays a recording of the behaviour script (build/replays/*.json) with the pack's own
// geometry, textures, client entity, animations, animation controllers, render controllers and
// particle definitions.  The place (terrain, sky, rain, the stand-in player and boat) is drawn
// by this tool.  The result is an offline reference render, not a capture of the game.
import * as THREE from 'three';
import { VoxelWorld, applySky, setLights } from './world.js';
import { Particles } from './particles.js';
import { reseed } from './molang.js';

const FORM_KEY = { 1: 'i', 2: 'ii', 3: 'iii' };
const wrap = (a) => ((a + 540) % 360) - 180;
const ease = (k) => k * k * (3 - 2 * k);

function figure(parts) {
  const g = new THREE.Group();
  g.userData.mats = [];
  for (const [w, h, d, x, y, z, c] of parts) {
    const mat = new THREE.MeshBasicMaterial({ color: c });
    mat.userData.base = new THREE.Color(c);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m); g.userData.mats.push(mat);
  }
  return g;
}
const playerFigure = () => figure([
  [0.5, 0.75, 0.25, 0, 0.375, 0, 0x3b4fa8], [0.5, 0.75, 0.25, 0, 1.125, 0, 0x2aa7a0],
  [0.25, 0.75, 0.25, -0.375, 1.125, 0, 0xc69a78], [0.25, 0.75, 0.25, 0.375, 1.125, 0, 0xc69a78], [0.5, 0.5, 0.5, 0, 1.75, 0, 0xc69a78],
]);
const boatFigure = () => figure([
  [1.3, 0.12, 2.7, 0, 0.06, 0, 0x8a6a3a], [0.12, 0.45, 2.7, -0.65, 0.3, 0, 0xa8854f], [0.12, 0.45, 2.7, 0.65, 0.3, 0, 0xa8854f],
  [1.3, 0.45, 0.12, 0, 0.3, -1.35, 0xa8854f], [1.3, 0.45, 0.12, 0, 0.3, 1.35, 0xa8854f],
]);

export class ScenePlayer {
  constructor(BK, replay, terrainFn, shot) {
    this.BK = BK; this.r = replay; this.shot = shot;
    this.byTick = new Map(replay.frames.map((f) => [f.t, f]));
    this.t0 = replay.frames[0].t; this.tEnd = replay.frames[replay.frames.length - 1].t;
    this.duration = (this.tEnd - this.t0) / 20;
    this.time = 0; this.cursor = this.t0 - 1; this.pi = 0; this.bi = 0;
    this.props = {}; this.model = null; this.lastPos = null; this.seamAt = -1e9; this.flash = 0;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.present = false;
    const initial = new Map((replay.initialEdits || []).map((e) => [`${e.x},${e.y},${e.z}`, e.id]));
    this.world = new VoxelWorld((dim, x, y, z) => initial.get(`${x},${y},${z}`) ?? terrainFn(dim, x, y, z), shot.bounds, BK.env);
    BK.scene.add(this.world.group);
    BK.env.uWaterY.value = shot.waterY ?? -1e5;
    this.players = new Map(); this.boats = [];
    reseed(4242);
  }

  async init(files, particleDefs, spriteTex) {
    const BK = this.BK;
    let form = 3;
    for (const f of this.r.frames) if (f.props && 'basiliskra:form' in f.props) { form = f.props['basiliskra:form']; break; }
    this.key = FORM_KEY[form];
    await BK.loadForm(this.key, files.form(this.key));
    this.model = BK.models[this.key];
    this.particles = new Particles(particleDefs, spriteTex, BK.env);
    BK.scene.add(this.particles.group);
    const desc = () => this.model.animator.desc;
    const hooks = {
      particle: (e, tag) => {
        const id = desc().particle_effects?.[e.effect];
        const at = this.model.locators.get(e.locator) || this.model.bones.get(e.locator)?.group;
        if (!id || !at) throw new Error(`controller effect ${e.effect} @ ${e.locator} cannot be resolved`);
        const em = this.particles.attach(id, at);
        em.tag = tag;
      },
    };
    await BK.makeAnimator(this.key, { ...files.client, hooks });
    this.A = this.model.animator;
    this.model.holder.visible = false;
    if (this.r.weather === 'rain') this._makeRain();
  }

  _makeRain() {
    const N = 1400, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rainSeed = Array.from({ length: N }, (_, i) => [Math.random(), Math.random(), Math.random(), 0.8 + Math.random() * 0.5]);
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8f9bbd, transparent: true, opacity: 0.32, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.renderOrder = 7;
    this.BK.scene.add(this.rain);
  }
  _updateRain(cam) {
    const P = this.rain.geometry.attributes.position.array, W = 56, H = 34, sp = 24;
    for (let i = 0; i < this.rainSeed.length; i++) {
      const [a, b, c, l] = this.rainSeed[i];
      const x = cam.x + ((a * W - cam.x % W + W * 10) % W) - W / 2;
      const z = cam.z + ((c * W - cam.z % W + W * 10) % W) - W / 2;
      const y = cam.y + H / 2 - ((b * H + this.time * sp * l) % H);
      P.set([x, y, z, x + 0.12, y - 0.9 * l, z + 0.05], i * 6);
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  /** World position of a bone or locator of the animal (after this frame's pose). */
  loc(name) {
    const m = this.model;
    const o = m.locators.get(name) || m.bones.get(name)?.group;
    if (!o) throw new Error('no bone/locator ' + name);
    m.holder.updateMatrixWorld(true);
    return o.getWorldPosition(new THREE.Vector3());
  }

  step(dt) {
    this.dt = dt; this.time += dt;
    const T = Math.min(this.t0 + this.time * 20, this.tEnd), F = Math.floor(T);
    while (this.cursor < F) {
      const f = this.byTick.get(++this.cursor);
      if (f?.props) Object.assign(this.props, f.props);
    }
    const P = this.r.particles, B = this.r.blocks;
    for (; this.pi < P.length && P[this.pi].t <= T; this.pi++) {
      const p = P[this.pi];
      this.particles.spawn(p.id, p.pos, p.vars);
      if (p.id === 'basiliskra:seam' || p.id === 'basiliskra:seam_close') { this.seamAt = this.time; this.seamPos = p.pos; }
      if (p.id === 'basiliskra:beam_core') { this.beamAt = this.time; this.beam = p; }
      if (p.id === 'basiliskra:arc_seg') { this.arcAt = this.time; this.arcPos = p.pos; }
    }
    for (; this.bi < B.length && B[this.bi].t <= T; this.bi++) this.world.setBlock(B[this.bi].x, B[this.bi].y, B[this.bi].z, B[this.bi].id);
    if (this.world.dirty) this.world.rebuild();

    const a = this.byTick.get(F), b = this.byTick.get(Math.min(F + 1, this.tEnd)), k = T - F;
    this.frame = a;
    this.present = !!(a && a.pos);
    this.model.holder.visible = this.present;
    if (this.present) {
      const q = b && b.pos ? b : a;
      this.pos.set(a.pos[0] + (q.pos[0] - a.pos[0]) * k, a.pos[1] + (q.pos[1] - a.pos[1]) * k, a.pos[2] + (q.pos[2] - a.pos[2]) * k);
      this.yaw = a.yaw + wrap(q.yaw - a.yaw) * k;
      this.model.holder.position.copy(this.pos);
      this.model.holder.rotation.y = Math.PI - this.yaw * Math.PI / 180;
      const moved = this.lastPos ? Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z) : 0;
      this.lastPos = this.pos.clone();
      Object.assign(this.A.props, this.props);
      this.A.state.distance += moved; this.A.state.speed = moved / dt / 20;
      this.A.update(dt);
      // a controller state's effects end when the state is left
      const live = new Set();
      for (const [short, rt] of this.A.ctrl) live.add(`${this.A.short[short]}:${rt.state}`);
      for (const em of this.particles.emitters) if (em.tag && !live.has(em.tag)) em.dead = true;
    }
    // the stand-ins
    for (const p of a?.players || []) {
      let g = this.players.get(p.name);
      if (!g) { g = playerFigure(); this.players.set(p.name, g); this.BK.scene.add(g); }
      g.position.lerp(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]), g.userData.placed ? 0.35 : 1); g.userData.placed = true;
      if (this.present) g.rotation.y = Math.atan2(this.pos.x - g.position.x, this.pos.z - g.position.z);
    }
    (a?.boats || []).forEach((bp, i) => {
      if (!this.boats[i]) { this.boats[i] = boatFigure(); this.BK.scene.add(this.boats[i]); this.boats[i].userData.last = bp; }
      const g = this.boats[i], last = g.userData.last;
      const kick = Math.hypot(bp[0] - last[0], bp[2] - last[2]) + Math.abs(bp[1] - last[1]);
      g.userData.rock = (g.userData.rock || 0) * 0.97 + kick * 3;
      g.userData.last = bp;
      g.position.lerp(new THREE.Vector3(bp[0], (this.shot.waterY ?? bp[1]) - 0.12, bp[2]), g.userData.placed ? 0.2 : 1); g.userData.placed = true;
      g.rotation.z = Math.sin(this.time * 7) * Math.min(0.5, g.userData.rock) + Math.sin(this.time * 1.3) * 0.02;
      g.rotation.y = 0.5;
    });
  }

  /** Camera for the current time from the shot's keyframes. */
  cameraAt(t) {
    const K = this.shot.keys;
    const point = (v) => {
      if (Array.isArray(v)) return new THREE.Vector3(v[0], v[1], v[2]);
      if (v && v.rel) { const o = this.present ? this.pos : new THREE.Vector3(...(this.shot.home || [0, 64, 0])); return new THREE.Vector3(o.x + v.rel[0], o.y + v.rel[1], o.z + v.rel[2]); }
      if (v && v.at) { if (!this.present) return new THREE.Vector3(...(v.or || this.shot.home || [0, 64, 0])); const p = this.loc(v.at); if (v.up) p.y += v.up; return p; }
      throw new Error('bad camera point ' + JSON.stringify(v));
    };
    let i = 0;
    while (i < K.length - 1 && t >= K[i + 1].t) i++;
    const A = K[i], B = K[Math.min(i + 1, K.length - 1)];
    let k = B.t > A.t ? Math.min(Math.max((t - A.t) / (B.t - A.t), 0), 1) : 0;
    if (B.cut) k = 0;
    k = ease(k);
    const pos = point(A.pos).lerp(point(B.pos), k), tgt = point(A.tgt).lerp(point(B.tgt), k);
    return { pos, tgt, fov: (A.fov ?? 60) + ((B.fov ?? 60) - (A.fov ?? 60)) * k };
  }

  render(w, h) {
    const BK = this.BK, env = BK.env;
    const c = this.cameraAt(this.time);
    const cam = new THREE.PerspectiveCamera(c.fov, w / h, 0.08, 700);
    cam.position.copy(c.pos); cam.lookAt(c.tgt); cam.updateMatrixWorld(true);
    const under = this.shot.waterY != null && c.pos.y < this.shot.waterY;
    const sky = applySky(env, BK.renderer, this.frame?.tod ?? 6000, { rain: this.r.weather === 'rain', underwater: under });
    if (!under && this.shot.fog) { env.uFogNear.value = this.shot.fog[0]; env.uFogFar.value = this.shot.fog[1]; }
    // lights the animal makes
    const dyn = [];
    const charge = this.present ? (this.A.V.charge || 0) : 0;
    if (charge > 0.3) {
      const k = Math.min(charge / 18, 1.25);
      dyn.push({ pos: this.loc(this.key === 'iii' ? 'heart' : (this.key === 'ii' ? 'heart' : 'back')).add(new THREE.Vector3(0, 3, 0)), color: new THREE.Color(1, 0.12, 0.08), power: 0.9 * k, range: 30 });
      dyn.push({ pos: this.loc(this.key === 'iii' ? 'club_core' : (this.key === 'ii' ? 'knob_core' : 'tail_tip')), color: new THREE.Color(1, 0.15, 0.1), power: 0.8 * Math.min(charge / 4, 1), range: 16 });
    }
    if (this.beam && this.time - this.beamAt < 0.2) {
      const p = this.beam.pos, d = this.beam.vars['variable.dir'], L = this.beam.vars['variable.len'];
      dyn.unshift({ pos: new THREE.Vector3(p[0] + d.x * L, p[1] + d.y * L + 1.5, p[2] + d.z * L), color: new THREE.Color(1, 0.45, 0.35), power: 2.2, range: 26 });
      dyn.unshift({ pos: new THREE.Vector3(p[0], p[1], p[2]), color: new THREE.Color(1, 0.5, 0.4), power: 2.0, range: 30 });
      dyn.push({ pos: new THREE.Vector3(p[0] + d.x * L * 0.5, p[1] + d.y * L * 0.5 + 1, p[2] + d.z * L * 0.5), color: new THREE.Color(1, 0.2, 0.15), power: 1.2, range: 22 });
    }
    if (this.time - this.seamAt < 0.5) dyn.push({ pos: new THREE.Vector3(this.seamPos[0], this.seamPos[1] + 3, this.seamPos[2]), color: new THREE.Color(1, 0.1, 0.08), power: 1.5, range: 24 });
    if (this.arcPos && this.time - this.arcAt < 0.25) dyn.push({ pos: new THREE.Vector3(this.arcPos[0], this.arcPos[1] + 1, this.arcPos[2]), color: new THREE.Color(1, 0.3, 0.25), power: 1.6, range: 18 });
    setLights(env, this.world.lights, dyn, c.tgt);
    // stand-ins are unlit materials: follow the scene's brightness
    const lum = Math.min(1, 0.22 + sky.bright * 0.8) * (under ? 0.8 : 1);
    for (const g of [...this.players.values(), ...this.boats]) for (const m of g.userData.mats) m.color.copy(m.userData.base).multiplyScalar(lum);
    this.world.waterMat.uniforms.uTime.value = this.time;
    if (this.rain) { this.rain.visible = !under; this._updateRain(c.pos); }
    this.particles.update(this.dt || 0, cam);
    BK.renderer.setSize(w, h, false);
    BK.renderer.render(BK.scene, cam);
    const fwd = c.tgt.clone().sub(c.pos).normalize();
    return { pos: c.pos.toArray(), fwd: fwd.toArray(), under };
  }
}
