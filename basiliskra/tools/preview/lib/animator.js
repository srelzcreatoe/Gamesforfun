// Runs the pack's own client files: the client entity's scripts, its animation list, the
// animation controllers and the animations, with Molang evaluated per frame.  It is a
// reading of the documented behaviour, written to preview the shipped files offline.
import { expr, stmt, makeVars } from './molang.js';
import { resetPose, addPose } from './bedrock.js';

function isKeyed(ch) {
  return ch && typeof ch === 'object' && !Array.isArray(ch);
}

function evalVec(v, Q, V) {
  if (typeof v === 'number' || typeof v === 'string') { const x = expr(v)(Q, V); return [x, x, x]; }
  return [expr(v[0])(Q, V), expr(v[1])(Q, V), expr(v[2])(Q, V)];
}

function evalChannel(ch, time, Q, V) {
  if (ch == null) return null;
  if (!isKeyed(ch)) return evalVec(ch, Q, V);
  const keys = Object.keys(ch).map(Number).sort((a, b) => a - b);
  const val = (k, side) => {
    const e = ch[String(k)] ?? ch[k.toFixed(1)] ?? ch[Object.keys(ch).find((s) => Number(s) === k)];
    if (isKeyed(e)) return evalVec(e[side] ?? e.post ?? e.pre, Q, V);
    return evalVec(e, Q, V);
  };
  if (time <= keys[0]) return val(keys[0], 'pre');
  if (time >= keys[keys.length - 1]) return val(keys[keys.length - 1], 'post');
  let i = 0;
  while (i < keys.length - 2 && time >= keys[i + 1]) i++;
  const a = val(keys[i], 'post'), b = val(keys[i + 1], 'pre');
  let t = (time - keys[i]) / (keys[i + 1] - keys[i]);
  const e0 = ch[Object.keys(ch).find((s) => Number(s) === keys[i])];
  const e1 = ch[Object.keys(ch).find((s) => Number(s) === keys[i + 1])];
  const smooth = (isKeyed(e0) && e0.lerp_mode === 'catmullrom') || (isKeyed(e1) && e1.lerp_mode === 'catmullrom');
  if (smooth) t = t * t * (3 - 2 * t);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

class Clip {
  constructor(id, def) {
    this.id = id;
    this.def = def;
    this.length = def.animation_length ?? Infinity;
    this.loop = def.loop;
  }
  /** Returns true once a non-looping clip has reached its end. */
  finished(t) {
    return this.loop !== true && Number.isFinite(this.length) && t >= this.length;
  }
  apply(model, t, weight, Q, V, out) {
    let time = t;
    if (Number.isFinite(this.length)) {
      if (this.loop === true) time = this.length > 0 ? t % this.length : 0;
      else time = Math.min(t, this.length);
    }
    const prev = Q.__anim_time;
    Q.__anim_time = time;
    for (const [name, ch] of Object.entries(this.def.bones || {})) {
      const bone = model.bones.get(name);
      if (!bone) { out.missing.add(`${this.id}:${name}`); continue; }
      const rot = evalChannel(ch.rotation, time, Q, V);
      const pos = evalChannel(ch.position, time, Q, V);
      const scl = evalChannel(ch.scale, time, Q, V);
      addPose(bone,
        rot && rot.map((v) => v * weight),
        pos && pos.map((v) => v * weight),
        scl && scl.map((v) => 1 + (v - 1) * weight));
    }
    // timeline events (sounds / particles) fire when the play head crosses them
    Q.__anim_time = prev;
  }
}

export class Animator {
  /**
   * files: { entity, animations: [json...], controllers: [json...], renderControllers: [json...] }
   */
  constructor(model, files, hooks = {}) {
    this.model = model;
    this.hooks = hooks;
    this.V = makeVars();
    this.props = {};
    this.time = 0;
    this.dt = 0;
    this.state = { distance: 0, speed: 0, vspeed: 0, yawSpeed: 0, bodyYaw: 0, inWater: 0, onGround: 1, health: 300, alive: 1 };
    this.missing = new Set();
    const desc = files.entity['minecraft:client_entity'].description;
    this.desc = desc;
    this.clips = new Map();
    for (const f of files.animations) for (const [id, def] of Object.entries(f.animations || {})) this.clips.set(id, new Clip(id, def));
    this.ctrlDefs = new Map();
    for (const f of files.controllers) for (const [id, def] of Object.entries(f.animation_controllers || {})) this.ctrlDefs.set(id, def);
    this.renderDefs = new Map();
    for (const f of files.renderControllers || []) for (const [id, def] of Object.entries(f.render_controllers || {})) this.renderDefs.set(id, def);
    this.short = desc.animations || {};
    this.playing = new Map();   // top-level animate entries: short name -> {t}
    this.ctrl = new Map();      // controller short name -> runtime
    const self = this;
    this.Q = {
      __anim_time: 0,
      anim_time: () => self.Q.__anim_time,
      life_time: () => self.time,
      delta_time: () => self.dt,
      property: (n) => { const v = self.props[n]; return typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? 0); },
      has_property: (n) => (n in self.props ? 1 : 0),
      modified_distance_moved: () => self.state.distance,
      modified_move_speed: () => self.state.speed,
      ground_speed: () => self.state.speed * 20,
      vertical_speed: () => self.state.vspeed,
      yaw_speed: () => self.state.yawSpeed,
      body_y_rotation: () => self.state.bodyYaw,
      is_in_water: () => self.state.inWater,
      is_on_ground: () => self.state.onGround,
      is_moving: () => (self.state.speed > 0.001 ? 1 : 0),
      health: () => self.state.health,
      is_alive: () => self.state.alive,
      is_invisible: () => 0,
      distance_from_camera: () => self.state.cameraDistance ?? 16,
      time_of_day: () => self.state.timeOfDay ?? 0.3,
      all_animations_finished: () => (self._ctxAllDone ? 1 : 0),
      any_animation_finished: () => (self._ctxAnyDone ? 1 : 0),
    };
    for (const s of desc.scripts?.initialize || []) stmt(s)(this.Q, this.V);
  }

  setProperty(name, value) { this.props[name] = value; }

  _resolve(shortName) {
    const id = this.short[shortName];
    if (!id) throw new Error(`client entity has no animation "${shortName}"`);
    return id;
  }

  _playEntry(entry, weight, slot, dt) {
    // entry: "short" or {short: "condition / blend expression"}
    let name = entry, w = weight;
    if (typeof entry === 'object') {
      name = Object.keys(entry)[0];
      w = weight * expr(entry[name])(this.Q, this.V);
    }
    const id = this._resolve(name);
    if (id.startsWith('controller.')) {
      if (w > 0) this._stepController(name, id, w, dt);
      return { done: true };
    }
    let st = slot.get(name);
    if (!st) { st = { t: 0 }; slot.set(name, st); }
    const clip = this.clips.get(id);
    if (!clip) throw new Error(`animation not found: ${id}`);
    if (w <= 0) { st.t = 0; return { done: true }; }
    const upd = clip.def.anim_time_update;
    if (upd != null) { this.Q.__anim_time = st.t; st.t = expr(upd)(this.Q, this.V); } else st.t += dt;
    const bw = clip.def.blend_weight != null ? expr(clip.def.blend_weight)(this.Q, this.V) : 1;
    clip.apply(this.model, st.t, w * bw, this.Q, this.V, this);
    this._fireTimeline(clip, st, name);
    return { done: clip.finished(st.t) };
  }

  _fireTimeline(clip, st, name) {
    const last = st.last ?? -1e-9;
    const len = clip.length;
    let now = st.t;
    const fire = (table, kind) => {
      for (const [k, ev] of Object.entries(table || {})) {
        const tk = Number(k);
        let hit = false;
        if (clip.loop === true && Number.isFinite(len) && len > 0) {
          const a = last % len, b = now % len;
          hit = a <= b ? (tk > a && tk <= b) || (last < 0 && tk === 0) : tk > a || tk <= b;
        } else hit = tk > last && tk <= now;
        if (hit) for (const e of [].concat(ev)) this.hooks[kind]?.(e, clip.id);
      }
    };
    fire(clip.def.sound_effects, 'sound');
    fire(clip.def.particle_effects, 'particle');
    st.last = now;
  }

  _stepController(shortName, id, weight, dt) {
    const def = this.ctrlDefs.get(id);
    if (!def) throw new Error(`controller not found: ${id}`);
    let rt = this.ctrl.get(shortName);
    if (!rt) {
      rt = { state: def.initial_state || 'default', slot: new Map(), prev: null, fade: 0, fadeLen: 0, entered: false };
      this.ctrl.set(shortName, rt);
    }
    const enter = (name) => {
      const sd = def.states[name];
      if (!sd) throw new Error(`${id}: no state ${name}`);
      for (const s of sd.on_entry || []) stmt(s)(this.Q, this.V);
      for (const e of sd.sound_effects || []) this.hooks.sound?.(e, id + ':' + name);
      for (const e of sd.particle_effects || []) this.hooks.particle?.(e, id + ':' + name);
    };
    if (!rt.entered) { enter(rt.state); rt.entered = true; }
    const sd = def.states[rt.state];
    // crossfade from the previous state
    let wNow = weight;
    if (rt.prev && rt.fadeLen > 0) {
      rt.fade += dt;
      const k = Math.min(rt.fade / rt.fadeLen, 1);
      wNow = weight * k;
      const pd = def.states[rt.prev.state];
      for (const e of pd.animations || []) this._playEntry(e, weight * (1 - k), rt.prev.slot, dt);
      if (k >= 1) rt.prev = null;
    }
    let all = true, any = false;
    for (const e of sd.animations || []) {
      const r = this._playEntry(e, wNow, rt.slot, dt);
      const nm = typeof e === 'object' ? Object.keys(e)[0] : e;
      if (!this._resolve(nm).startsWith('controller.')) { all = all && r.done; any = any || r.done; }
    }
    this._ctxAllDone = all; this._ctxAnyDone = any;
    for (const tr of sd.transitions || []) {
      const to = Object.keys(tr)[0];
      if (expr(tr[to])(this.Q, this.V)) {
        for (const s of sd.on_exit || []) stmt(s)(this.Q, this.V);
        rt.prev = { state: rt.state, slot: rt.slot };
        rt.fadeLen = sd.blend_transition || 0;
        rt.fade = 0;
        if (!rt.fadeLen) rt.prev = null;
        rt.state = to;
        rt.slot = new Map();
        enter(to);
        break;
      }
    }
    this._ctxAllDone = this._ctxAnyDone = false;
  }

  /** Advance by dt seconds and pose the model. */
  update(dt) {
    this.dt = dt;
    this.time += dt;
    resetPose(this.model);
    for (const s of this.desc.scripts?.pre_animation || []) stmt(s)(this.Q, this.V);
    for (const e of this.desc.scripts?.animate || []) this._playEntry(e, 1, this.playing, dt);
    this._applyRender();
  }

  _applyRender() {
    // read the render controllers: which bones each pass draws and at what alpha
    for (const b of this.model.bones.values()) {
      if (b.base) b.base.visible = false;
      if (b.glow) { b.glow.visible = false; b.glow.material.uniforms.uAlpha.value = 0; }
    }
    for (const rc of this.desc.render_controllers || []) {
      let id = rc, cond = 1;
      if (typeof rc === 'object') { id = Object.keys(rc)[0]; cond = expr(rc[id])(this.Q, this.V); }
      if (!cond) continue;
      const def = this.renderDefs.get(id);
      if (!def) continue;
      const isGlow = def.ignore_lighting === true;
      const alpha = def.color && def.color.a != null ? expr(def.color.a)(this.Q, this.V) : 1;
      const vis = new Map();
      for (const b of this.model.bones.keys()) vis.set(b, 1);
      for (const pv of def.part_visibility || []) {
        for (const [pat, e] of Object.entries(pv)) {
          const val = expr(e)(this.Q, this.V);
          if (pat === '*') for (const b of vis.keys()) vis.set(b, val);
          else if (pat.endsWith('*')) { for (const b of vis.keys()) if (b.startsWith(pat.slice(0, -1))) vis.set(b, val); }
          else if (vis.has(pat)) vis.set(pat, val);
        }
      }
      for (const [name, on] of vis) {
        const b = this.model.bones.get(name);
        if (!on) continue;
        if (isGlow) {
          if (b.glow && alpha > 0.003) { b.glow.visible = true; b.glow.material.uniforms.uAlpha.value = Math.max(b.glow.material.uniforms.uAlpha.value, alpha); }
        } else if (b.base) b.base.visible = true;
      }
    }
  }
}
