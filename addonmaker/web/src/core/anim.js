// Procedural animations. Each motion is described once as data ("terms") and
// turned into BOTH Bedrock Molang (for the exported pack) and a JS evaluator
// (for the in-app 3D preview), so what you preview is what ships.
import { uid } from './util.js';

const SRC = {
  dist: 'query.modified_distance_moved',
  time: 'query.life_time',
  attack: 'variable.attack_time',
  tx: 'query.target_x_rotation',
  ty: 'query.target_y_rotation',
};
const num = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
};
// term: { src, fn: 'cos'|'sin'|'sin_half'|'lin', f (deg per unit), ph (deg), a (amp), add }
const T = (src, fn, f, ph, a, add = 0) => ({ src, fn, f, ph, a, add });

export function termToMolang(t) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  let core;
  if (t.fn === 'lin') core = `${SRC[t.src]} * ${num(t.a)}`;
  else {
    const fn = t.fn === 'cos' ? 'math.cos' : 'math.sin';
    const inner = `${SRC[t.src]} * ${num(t.f)}${t.ph ? ` + ${num(t.ph)}` : ''}`;
    core = `${fn}(${inner}) * ${num(t.a)}`;
  }
  return t.add ? `${core} + ${num(t.add)}` : core;
}
export function termEval(t, s) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  const v = s[t.src] ?? 0;
  if (t.fn === 'lin') return v * t.a + (t.add || 0);
  const ang = ((v * t.f + (t.ph || 0)) * Math.PI) / 180;
  return (t.fn === 'cos' ? Math.cos(ang) : Math.sin(ang)) * t.a + (t.add || 0);
}

export const ANIM_KINDS = {
  walk: { label: 'Walk cycle', help: 'Legs and arms swing while moving (blended by movement speed).' },
  look: { label: 'Look at target', help: 'Head turns toward what the entity is looking at.' },
  idle: { label: 'Idle motion', help: 'Breathing bob, tail and arm sway.' },
  attack: { label: 'Attack swing', help: 'Arms swing (or head lunges) when it attacks.' },
  fly: { label: 'Wing flap', help: 'Wings flap and the body bobs.' },
  swim: { label: 'Swim sway', help: 'Tail and fins sway.' },
};

export function defaultAnims(template) {
  return {
    walk: { on: template !== 'fish' && template !== 'blob', amp: template === 'golem' ? 45 : 70, speed: template === 'golem' ? 0.55 : 1 },
    look: { on: template !== 'fish' },
    idle: { on: true, amp: 1 },
    attack: { on: template === 'humanoid' || template === 'golem' || template === 'quadruped', amp: 1, both: template === 'golem' },
    fly: { on: template === 'flyer', amp: 1, speed: 1, when: 'always' },
    swim: { on: template === 'fish', amp: 1, speed: 1, when: 'always' },
    custom: [],
  };
}

/** Returns { kind: { bones: { boneName: { rotation?, position?, scale? } }, weight, loop } } */
function motions(model, anims) {
  const byRole = {};
  for (const b of model.bones) (byRole[b.role] ||= []).push(b.name);
  const out = {};
  const put = (kind, role, channel, vec) => {
    for (const name of byRole[role] || []) {
      out[kind] ||= { bones: {} };
      const bone = (out[kind].bones[name] ||= {});
      bone[channel] = vec;
    }
  };
  const w = anims.walk;
  if (w?.on) {
    const k = 38.17 * (w.speed || 1), A = w.amp ?? 70, Ar = A * 0.72;
    put('walk', 'legR', 'rotation', [T('dist', 'cos', k, 0, A), 0, 0]);
    put('walk', 'legL', 'rotation', [T('dist', 'cos', k, 180, A), 0, 0]);
    put('walk', 'legFL', 'rotation', [T('dist', 'cos', k, 0, A), 0, 0]);
    put('walk', 'legBR', 'rotation', [T('dist', 'cos', k, 0, A), 0, 0]);
    put('walk', 'legFR', 'rotation', [T('dist', 'cos', k, 180, A), 0, 0]);
    put('walk', 'legBL', 'rotation', [T('dist', 'cos', k, 180, A), 0, 0]);
    put('walk', 'armR', 'rotation', [T('dist', 'cos', k, 180, Ar), 0, 0]);
    put('walk', 'armL', 'rotation', [T('dist', 'cos', k, 0, Ar), 0, 0]);
    if (out.walk) out.walk.weight = 'speed';
  }
  if (anims.look?.on) put('look', 'head', 'rotation', [T('tx', 'lin', 0, 0, 1), T('ty', 'lin', 0, 0, 1), 0]);
  const i = anims.idle;
  if (i?.on) {
    const s = i.amp ?? 1;
    put('idle', 'armR', 'rotation', [0, 0, T('time', 'cos', 103.2, 0, 2.865 * s, 2.865 * s)]);
    put('idle', 'armL', 'rotation', [0, 0, T('time', 'cos', 103.2, 180, 2.865 * s, -2.865 * s)]);
    put('idle', 'tail', 'rotation', [T('time', 'sin', 60, 0, 4 * s), T('time', 'sin', 110, 0, 10 * s), 0]);
    if (model.template === 'blob') {
      put('idle', 'body', 'scale', [T('time', 'sin', 240, 0, 0.05 * s, 1), T('time', 'sin', 240, 180, 0.05 * s, 1), T('time', 'sin', 240, 0, 0.05 * s, 1)]);
    } else if (!byRole.armR) {
      put('idle', 'head', 'rotation', [T('time', 'sin', 70, 0, 2.5 * s), 0, 0]);
    }
  }
  const a = anims.attack;
  if (a?.on) {
    const s = a.amp ?? 1;
    if (byRole.armR) {
      put('attack', 'armR', 'rotation', [T('attack', 'sin', 180, 0, -95 * s), 0, 0]);
      if (a.both) put('attack', 'armL', 'rotation', [T('attack', 'sin', 180, 0, -95 * s), 0, 0]);
    } else {
      put('attack', 'head', 'rotation', [T('attack', 'sin', 180, 0, 28 * s), 0, 0]);
    }
    if (out.attack) out.attack.weight = 'attacking';
  }
  const f = anims.fly;
  if (f?.on) {
    const s = f.amp ?? 1, k = 1150 * (f.speed || 1);
    put('fly', 'wingL', 'rotation', [0, 0, T('time', 'sin', k, 0, -38 * s)]);
    put('fly', 'wingR', 'rotation', [0, 0, T('time', 'sin', k, 0, 38 * s)]);
    put('fly', 'body', 'position', [0, T('time', 'sin', k, 90, 0.6 * s), 0]);
    put('fly', 'legL', 'rotation', [35, 0, 0]);
    put('fly', 'legR', 'rotation', [35, 0, 0]);
    if (out.fly) out.fly.weight = f.when === 'air' ? 'air' : 'always';
  }
  const sw = anims.swim;
  if (sw?.on) {
    const s = sw.amp ?? 1, k = 480 * (sw.speed || 1);
    put('swim', 'tail', 'rotation', [0, T('time', 'sin', k, 0, 28 * s), 0]);
    put('swim', 'body', 'rotation', [0, T('time', 'sin', k, 120, 5 * s), 0]);
    put('swim', 'finL', 'rotation', [0, 0, T('time', 'sin', k * 1.3, 0, -22 * s)]);
    put('swim', 'finR', 'rotation', [0, 0, T('time', 'sin', k * 1.3, 0, 22 * s)]);
    if (out.swim) out.swim.weight = sw.when === 'water' ? 'water' : 'always';
  }
  return out;
}

export const WHEN_PRESETS = [
  ['always', 'Always', ''],
  ['moving', 'While moving', 'query.modified_move_speed > 0.1'],
  ['still', 'While standing still', 'query.modified_move_speed < 0.1'],
  ['attacking', 'While attacking', 'variable.attack_time > 0'],
  ['target', 'When it has a target', 'query.has_target'],
  ['water', 'In water', 'query.is_in_water'],
  ['air', 'In the air', '!query.is_on_ground'],
  ['sitting', 'Sitting', 'query.is_sitting'],
  ['sleeping', 'Sleeping', 'query.is_sleeping'],
  ['baby', 'Is a baby', 'query.is_baby'],
  ['angry', 'Is angry', 'query.is_angry'],
  ['custom', 'Custom Molang…', null],
];
const WEIGHT = { speed: 'query.modified_move_speed', attacking: 'variable.attack_time > 0', air: '!query.is_on_ground', water: 'query.is_in_water' };

export function whenExpr(anim) {
  if (anim.when === 'custom') return anim.expr || '1.0';
  const p = WHEN_PRESETS.find((w) => w[0] === anim.when);
  return p ? p[2] : '';
}

export function newCustomAnim(name = 'dance') {
  return { uid: uid(), name, loop: true, length: 1, when: 'always', expr: '', channels: [] };
}

/**
 * Builds Bedrock animation JSON plus the client-entity wiring.
 * @returns {{file:object, map:Object<string,string>, animate:Array}}
 */
export function buildAnimations(entity, prefix) {
  const model = entity.model, anims = entity.anims || {};
  const animations = {}, map = {}, animate = [];
  const ms = motions(model, anims);
  for (const [kind, m] of Object.entries(ms)) {
    const id = `animation.${prefix}.${kind}`;
    const bones = {};
    for (const [bn, ch] of Object.entries(m.bones)) {
      bones[bn] = {};
      for (const [c, vec] of Object.entries(ch)) bones[bn][c] = vec.map(termToMolang);
    }
    animations[id] = { loop: true, bones };
    const short = kind === 'look' ? 'look_at_target' : kind;
    map[short] = id;
    const wexpr = WEIGHT[m.weight];
    animate.push(wexpr ? { [short]: wexpr } : short);
  }
  for (const ca of anims.custom || []) {
    if (!ca.channels?.length) continue;
    const id = `animation.${prefix}.${ca.name}`;
    const bones = {};
    for (const ch of ca.channels) {
      if (!ch.bone || !ch.keys?.length) continue;
      const keys = {};
      for (const k of [...ch.keys].sort((a, b) => a.t - b.t)) keys[num(k.t)] = k.v.map((x) => Number(x) || 0);
      (bones[ch.bone] ||= {})[ch.prop || 'rotation'] = keys;
    }
    const o = { loop: ca.loop === 'hold' ? 'hold_on_last_frame' : !!ca.loop, animation_length: Number(ca.length) || 1, bones };
    animations[id] = o;
    map[ca.name] = id;
    const e = whenExpr(ca);
    animate.push(e ? { [ca.name]: e } : ca.name);
  }
  return { file: { format_version: '1.8.0', animations }, map, animate };
}

function lerpKeys(keys, t) {
  const ks = [...keys].sort((a, b) => a.t - b.t);
  if (!ks.length) return [0, 0, 0];
  if (t <= ks[0].t) return ks[0].v.map(Number);
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.v.map((x, j) => Number(x) + (Number(b.v[j]) - Number(x)) * u);
    }
  }
  return ks[ks.length - 1].v.map(Number);
}

/**
 * Evaluates the same animations for the preview.
 * state: { time, dist, speed (0..1), attack (0..1), tx, ty, air, water, play: Set of kinds or 'all', custom: name }
 * returns { boneName: { rot:[x,y,z], pos:[x,y,z], scale:[x,y,z] } }
 */
export function evalPose(entity, state) {
  const ms = motions(entity.model, entity.anims || {});
  const pose = {};
  const get = (bn) => (pose[bn] ||= { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1] });
  const weightOf = (w) => w === 'speed' ? state.speed : w === 'attacking' ? (state.attack > 0 ? 1 : 0) : w === 'air' ? (state.air ? 1 : 0) : w === 'water' ? (state.water ? 1 : 0) : 1;
  for (const [kind, m] of Object.entries(ms)) {
    if (state.only && !state.only.has(kind)) continue;
    const wt = weightOf(m.weight);
    if (!wt) continue;
    for (const [bn, ch] of Object.entries(m.bones)) {
      const p = get(bn);
      if (ch.rotation) ch.rotation.forEach((t, i) => { p.rot[i] += termEval(t, state) * wt; });
      if (ch.position) ch.position.forEach((t, i) => { p.pos[i] += termEval(t, state) * wt; });
      if (ch.scale) ch.scale.forEach((t, i) => { p.scale[i] *= 1 + (termEval(t, state) - 1) * wt; });
    }
  }
  const ca = state.custom && (entity.anims?.custom || []).find((c) => c.name === state.custom);
  if (ca) {
    const len = Number(ca.length) || 1;
    const t = ca.loop === true ? state.time % len : Math.min(state.time, len);
    for (const ch of ca.channels || []) {
      if (!ch.bone) continue;
      const v = lerpKeys(ch.keys || [], t);
      const p = get(ch.bone);
      if ((ch.prop || 'rotation') === 'rotation') v.forEach((x, i) => { p.rot[i] += x; });
      else if (ch.prop === 'position') v.forEach((x, i) => { p.pos[i] += x; });
      else v.forEach((x, i) => { p.scale[i] *= x; });
    }
  }
  return pose;
}
