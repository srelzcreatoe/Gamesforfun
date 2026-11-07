// Animations.
//  * Built-in motions are described once as data ("terms") and turned into BOTH
//    Bedrock Molang (exported) and a JS evaluator (preview).
//  * Slots (idle, walk, run, attack + dweller hunt/stalk/flee/frozen) can each
//    use the built-in motion, an imported Bedrock animation, a custom keyframe
//    animation, or be switched off.
import { uid, clone } from './util.js';
import { evalChannel, animLength, evalMolang } from './molang.js';

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
// term: { src, fn: 'cos'|'sin'|'lin'|'spike'|'abssin', f (deg per unit), ph (deg), a (amp), add }
const T = (src, fn, f, ph, a, add = 0) => ({ src, fn, f, ph, a, add });

export function termToMolang(t) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  const inner = `${SRC[t.src]} * ${num(t.f)}${t.ph ? ` + ${num(t.ph)}` : ''}`;
  let core;
  if (t.fn === 'lin') core = `${SRC[t.src]} * ${num(t.a)}`;
  else if (t.fn === 'spike') core = `math.pow(math.sin(${inner}), 16) * ${num(t.a)}`;
  else if (t.fn === 'abssin') core = `math.abs(math.sin(${inner})) * ${num(t.a)}`;
  else core = `${t.fn === 'cos' ? 'math.cos' : 'math.sin'}(${inner}) * ${num(t.a)}`;
  return t.add ? `${core} + ${num(t.add)}` : core;
}
export function termEval(t, s) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  const v = s[t.src] ?? 0;
  if (t.fn === 'lin') return v * t.a + (t.add || 0);
  const ang = ((v * t.f + (t.ph || 0)) * Math.PI) / 180;
  if (t.fn === 'spike') return Math.pow(Math.sin(ang), 16) * t.a + (t.add || 0);
  if (t.fn === 'abssin') return Math.abs(Math.sin(ang)) * t.a + (t.add || 0);
  return (t.fn === 'cos' ? Math.cos(ang) : Math.sin(ang)) * t.a + (t.add || 0);
}

export const ANIM_KINDS = {
  walk: { label: 'Walk cycle', help: 'Legs and arms swing, body bobs while moving.' },
  run: { label: 'Run cycle', help: 'Bigger, faster strides with a forward lean while chasing.' },
  look: { label: 'Look at target', help: 'Head turns toward what it is looking at.' },
  idle: { label: 'Idle motion', help: 'Breathing bob, tail and arm sway.' },
  attack: { label: 'Attack swing', help: 'Overhead swing (or head lunge) when it attacks.' },
  fly: { label: 'Wing flap', help: 'Wings flap and the body bobs.' },
  swim: { label: 'Swim sway', help: 'Tail and fins sway.' },
  twitch: { label: 'Creepy twitch', help: 'Sudden jerks of the head and arms.', horror: true },
  hunch: { label: 'Hunched pose', help: 'Leans forward with a craned neck.', horror: true },
  reach: { label: 'Reach while hunting', help: 'Arms stretch toward you while it hunts.', horror: true },
  float: { label: 'Float & drift', help: 'Hovers up and down: for bodies without legs.', horror: true },
  stalk: { label: 'Stalking creep', help: 'Crouches low and leans in while stalking.', horror: true },
  flee: { label: 'Panicked flee', help: 'Flails and looks back while running away.', horror: true },
  frozen: { label: 'Frozen pose', help: 'A rigid, unsettling pose while watched.', horror: true },
};

export const ANIM_SLOTS = [
  ['idle', 'Idle', 'Standing still'],
  ['walk', 'Walk', 'Moving'],
  ['run', 'Run', 'Chasing / hunting'],
  ['attack', 'Attack', 'Swinging at a target'],
  ['hunt', 'Hunting', 'Dweller is hunting you', true],
  ['stalk', 'Stalking', 'Dweller is stalking you', true],
  ['flee', 'Fleeing', 'Dweller runs away', true],
  ['frozen', 'Frozen', 'Dweller is being watched', true],
];
export const SLOT_KINDS = { idle: ['idle', 'twitch', 'hunch', 'float'], walk: ['walk'], run: ['run'], attack: ['attack'], hunt: ['reach'], stalk: ['stalk'], flee: ['flee'], frozen: ['frozen'] };

const HORROR_BODIES = ['gaunt', 'crawler', 'shade', 'grinner', 'lurker', 'brute', 'longneck', 'doll', 'wraith', 'hound', 'spider'];
const QUADS = ['quadruped', 'crawler', 'hound', 'spider'];
const LEGLESS = ['fish', 'blob', 'shade', 'wraith'];

export function defaultAnims(template) {
  const horror = HORROR_BODIES.includes(template);
  const quad = QUADS.includes(template);
  const legless = LEGLESS.includes(template);
  const heavy = ['golem', 'brute', 'grinner'].includes(template);
  return {
    walk: { on: !legless, amp: heavy ? 42 : horror && !quad ? 40 : 70, speed: heavy ? 0.6 : template === 'gaunt' || template === 'lurker' ? 0.7 : quad && horror ? 1.4 : 1 },
    run: { on: !legless && template !== 'flyer', amp: 1 },
    look: { on: template !== 'fish' },
    idle: { on: true, amp: 1 },
    attack: { on: !['fish', 'blob', 'flyer'].includes(template), amp: 1, both: heavy },
    fly: { on: template === 'flyer', amp: 1, speed: 1, when: 'always' },
    swim: { on: template === 'fish', amp: 1, speed: 1, when: 'always' },
    twitch: { on: horror, amp: 1 },
    hunch: { on: horror && !quad && !legless && template !== 'doll', amp: 1 },
    reach: { on: horror && !quad, amp: 1 },
    float: { on: template === 'shade' || template === 'wraith', amp: 1 },
    stalk: { on: horror, amp: 1 },
    flee: { on: horror && !quad, amp: 1 },
    frozen: { on: horror && !quad, amp: 1 },
    custom: [],
    imported: [],
    slots: {},
  };
}

/** Returns { kind: { bones: { boneName: { rotation?, position?, scale? } }, weight } } */
function motions(model, anims, skip = new Set()) {
  const byRole = {};
  for (const b of model.bones) (byRole[b.role] ||= []).push(b.name);
  const quad = !!(byRole.legFL || byRole.legFR);
  const out = {};
  const put = (kind, role, channel, vec) => {
    for (const name of byRole[role] || []) {
      out[kind] ||= { bones: {} };
      const bone = (out[kind].bones[name] ||= {});
      bone[channel] = vec;
    }
  };
  const on = (k) => anims[k]?.on && !skip.has(k);
  const w = anims.walk;
  const k = 38.17 * (w?.speed || 1), A = w?.amp ?? 70, Ar = A * 0.72;
  const legs = (kind, amp, armAmp) => {
    put(kind, 'legR', 'rotation', [T('dist', 'cos', k, 0, amp), 0, 0]);
    put(kind, 'legL', 'rotation', [T('dist', 'cos', k, 180, amp), 0, 0]);
    put(kind, 'legFL', 'rotation', [T('dist', 'cos', k, 0, amp), 0, 0]);
    put(kind, 'legBR', 'rotation', [T('dist', 'cos', k, 0, amp), 0, 0]);
    put(kind, 'legFR', 'rotation', [T('dist', 'cos', k, 180, amp), 0, 0]);
    put(kind, 'legBL', 'rotation', [T('dist', 'cos', k, 180, amp), 0, 0]);
    put(kind, 'armR', 'rotation', [T('dist', 'cos', k, 180, armAmp), 0, 0]);
    put(kind, 'armL', 'rotation', [T('dist', 'cos', k, 0, armAmp), 0, 0]);
  };
  if (on('walk')) {
    legs('walk', A, Ar);
    put('walk', 'body', 'position', [0, T('dist', 'abssin', k, 0, -0.6), 0]);
    if (quad) put('walk', 'body', 'rotation', [T('dist', 'cos', k * 2, 0, 1.5), 0, 0]);
    out.walk && (out.walk.weight = 'speed');
  }
  if (on('run')) {
    const s = anims.run.amp ?? 1;
    legs('run', A * 1.35 * s, Ar * 1.25 * s);
    put('run', 'body', 'position', [0, T('dist', 'abssin', k, 0, -1.2 * s), 0]);
    if (!quad) {
      const lean = { rotation: [14 * s, T('dist', 'cos', k, 0, 4 * s), 0] };
      put('run', 'body', 'rotation', lean.rotation);
      put('run', 'head', 'rotation', [-12 * s, 0, 0]);
    } else put('run', 'body', 'rotation', [T('dist', 'cos', k * 2, 0, 3 * s), 0, 0]);
    out.run && (out.run.weight = 'running');
  }
  if (on('look')) put('look', 'head', 'rotation', [T('tx', 'lin', 0, 0, 1), T('ty', 'lin', 0, 0, 1), 0]);
  if (on('idle')) {
    const s = anims.idle.amp ?? 1;
    put('idle', 'armR', 'rotation', [0, 0, T('time', 'cos', 103.2, 0, 2.865 * s, 2.865 * s)]);
    put('idle', 'armL', 'rotation', [0, 0, T('time', 'cos', 103.2, 180, 2.865 * s, -2.865 * s)]);
    put('idle', 'tail', 'rotation', [T('time', 'sin', 60, 0, 4 * s), T('time', 'sin', 110, 0, 10 * s), 0]);
    if (model.template === 'blob') {
      put('idle', 'body', 'scale', [T('time', 'sin', 240, 0, 0.05 * s, 1), T('time', 'sin', 240, 180, 0.05 * s, 1), T('time', 'sin', 240, 0, 0.05 * s, 1)]);
    } else {
      put('idle', 'head', 'rotation', [T('time', 'sin', 70, 0, 2.5 * s), 0, 0]);
      if (!quad) put('idle', 'body', 'position', [0, T('time', 'sin', 80, 0, 0.25 * s), 0]);
    }
  }
  if (on('attack')) {
    const s = anims.attack.amp ?? 1;
    if (byRole.armR) {
      put('attack', 'armR', 'rotation', [T('attack', 'sin', 180, 0, -115 * s), 0, T('attack', 'sin', 180, 0, 18 * s)]);
      if (anims.attack.both) put('attack', 'armL', 'rotation', [T('attack', 'sin', 180, 0, -115 * s), 0, T('attack', 'sin', 180, 0, -18 * s)]);
      put('attack', 'body', 'rotation', [T('attack', 'sin', 180, 0, 10 * s), T('attack', 'sin', 360, 0, 12 * s), 0]);
    } else {
      put('attack', 'head', 'rotation', [T('attack', 'sin', 180, 0, 28 * s), 0, 0]);
    }
    out.attack && (out.attack.weight = 'attacking');
  }
  if (on('fly')) {
    const f = anims.fly, s = f.amp ?? 1, kf = 1150 * (f.speed || 1);
    put('fly', 'wingL', 'rotation', [0, 0, T('time', 'sin', kf, 0, -38 * s)]);
    put('fly', 'wingR', 'rotation', [0, 0, T('time', 'sin', kf, 0, 38 * s)]);
    put('fly', 'body', 'position', [0, T('time', 'sin', kf, 90, 0.6 * s), 0]);
    put('fly', 'legL', 'rotation', [35, 0, 0]);
    put('fly', 'legR', 'rotation', [35, 0, 0]);
    out.fly && (out.fly.weight = f.when === 'air' ? 'air' : 'always');
  }
  if (on('twitch')) {
    const s = anims.twitch.amp ?? 1;
    put('twitch', 'head', 'rotation', [T('time', 'spike', 23, 90, -14 * s), T('time', 'spike', 17, 30, 10 * s), T('time', 'spike', 37, 0, 26 * s)]);
    put('twitch', 'armR', 'rotation', [0, 0, T('time', 'spike', 29, 40, 9 * s)]);
    put('twitch', 'armL', 'rotation', [0, 0, T('time', 'spike', 31, 10, -9 * s)]);
  }
  if (on('hunch') && byRole.body) {
    const s = anims.hunch.amp ?? 1;
    put('hunch', 'body', 'rotation', [18 * s, 0, 0]);
    put('hunch', 'head', 'rotation', [-24 * s, 0, 0]);
    put('hunch', 'armR', 'rotation', [-16 * s, 0, 6 * s]);
    put('hunch', 'armL', 'rotation', [-16 * s, 0, -6 * s]);
  }
  if (on('reach')) {
    const s = anims.reach.amp ?? 1;
    put('reach', 'armR', 'rotation', [-85 * s, 0, 0]);
    put('reach', 'armL', 'rotation', [-85 * s, 0, 0]);
    out.reach && (out.reach.weight = 'hunting');
  }
  if (on('float')) {
    const s = anims.float.amp ?? 1;
    put('float', 'body', 'position', [0, T('time', 'sin', 95, 0, 1.2 * s, 1.5 * s), 0]);
    put('float', 'armR', 'rotation', [T('time', 'sin', 60, 0, 6 * s, -8 * s), 0, 0]);
    put('float', 'armL', 'rotation', [T('time', 'sin', 60, 180, 6 * s, -8 * s), 0, 0]);
  }
  if (on('stalk')) {
    const s = anims.stalk.amp ?? 1;
    put('stalk', 'body', 'position', [0, -2.5 * s, 0]);
    put('stalk', 'body', 'rotation', [24 * s, 0, T('time', 'sin', 90, 0, 3 * s)]);
    put('stalk', 'head', 'rotation', [-26 * s, T('time', 'sin', 40, 0, 12 * s), 0]);
    put('stalk', 'armR', 'rotation', [-28 * s, 0, 4 * s]);
    put('stalk', 'armL', 'rotation', [-28 * s, 0, -4 * s]);
    out.stalk && (out.stalk.weight = 'stalking');
  }
  if (on('flee')) {
    const s = anims.flee.amp ?? 1;
    put('flee', 'armR', 'rotation', [T('time', 'sin', 720, 0, 55 * s, -25 * s), 0, 20 * s]);
    put('flee', 'armL', 'rotation', [T('time', 'sin', 720, 180, 55 * s, -25 * s), 0, -20 * s]);
    put('flee', 'head', 'rotation', [0, 55 * s, 0]);
    put('flee', 'body', 'rotation', [10 * s, 0, 0]);
    out.flee && (out.flee.weight = 'fleeing');
  }
  if (on('frozen')) {
    const s = anims.frozen.amp ?? 1;
    put('frozen', 'head', 'rotation', [10 * s, 0, 24 * s]);
    put('frozen', 'armR', 'rotation', [-75 * s, 0, 8 * s]);
    put('frozen', 'armL', 'rotation', [-40 * s, 0, -12 * s]);
    put('frozen', 'body', 'rotation', [8 * s, 0, -4 * s]);
    out.frozen && (out.frozen.weight = 'frozen');
  }
  if (on('swim')) {
    const sw = anims.swim, s = sw.amp ?? 1, ks = 480 * (sw.speed || 1);
    put('swim', 'tail', 'rotation', [0, T('time', 'sin', ks, 0, 28 * s), 0]);
    put('swim', 'body', 'rotation', [0, T('time', 'sin', ks, 120, 5 * s), 0]);
    put('swim', 'finL', 'rotation', [0, 0, T('time', 'sin', ks * 1.3, 0, -22 * s)]);
    put('swim', 'finR', 'rotation', [0, 0, T('time', 'sin', ks * 1.3, 0, 22 * s)]);
    out.swim && (out.swim.weight = sw.when === 'water' ? 'water' : 'always');
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

export function whenExpr(anim) {
  if (anim.when === 'custom') return anim.expr || '1.0';
  const p = WHEN_PRESETS.find((w) => w[0] === anim.when);
  return p ? p[2] : '';
}

export function newCustomAnim(name = 'dance') {
  return { uid: uid(), name, loop: true, length: 1, when: 'always', expr: '', channels: [] };
}

/** Slot conditions (Molang) for this entity. */
export function slotConditions(entity, ns) {
  const hp = entity.horror?.enabled && ns ? (v) => `query.property('${ns}:horror_state') == '${v}'` : null;
  return {
    idle: 'query.modified_move_speed < 0.05',
    walk: 'query.modified_move_speed > 0.05',
    run: hp ? `${hp('hunting')} && query.modified_move_speed > 0.05` : 'query.has_target && query.modified_move_speed > 0.3',
    attack: 'variable.attack_time > 0',
    hunt: hp ? hp('hunting') : 'query.has_target',
    stalk: hp ? hp('stalking') : null,
    flee: hp ? hp('fleeing') : null,
    frozen: hp ? hp('frozen') : null,
  };
}

function slotUse(anims) {
  const slots = anims.slots || {};
  const skip = new Set();
  const assigned = {};
  for (const [slot] of ANIM_SLOTS) {
    const v = slots[slot] || 'builtin';
    if (v === 'builtin') continue;
    for (const k of SLOT_KINDS[slot]) skip.add(k);
    if (v.startsWith('imp:')) { const a = (anims.imported || []).find((x) => x.uid === v.slice(4)); if (a) assigned[slot] = { type: 'imp', a }; }
    if (v.startsWith('cus:')) { const a = (anims.custom || []).find((x) => x.uid === v.slice(4)); if (a) assigned[slot] = { type: 'cus', a }; }
  }
  const runActive = (anims.run?.on && !skip.has('run')) || !!assigned.run;
  return { skip, assigned, runActive };
}

function customToBedrock(ca) {
  const bones = {};
  for (const ch of ca.channels || []) {
    if (!ch.bone || !ch.keys?.length) continue;
    const keys = {};
    for (const k of [...ch.keys].sort((a, b) => a.t - b.t)) keys[num(k.t)] = k.v.map((x) => Number(x) || 0);
    (bones[ch.bone] ||= {})[ch.prop || 'rotation'] = keys;
  }
  return { loop: ca.loop === 'hold' ? 'hold_on_last_frame' : !!ca.loop, animation_length: Number(ca.length) || 1, bones };
}

/**
 * Builds Bedrock animation JSON plus the client-entity wiring.
 * @returns {{file:object, map:Object<string,string>, animate:Array}}
 */
export function buildAnimations(entity, prefix, opts = {}) {
  const model = entity.model, anims = entity.anims || {};
  const animations = {}, map = {}, animate = [];
  const { skip, assigned, runActive } = slotUse(anims);
  const cond = slotConditions(entity, opts.ns);
  const weightExpr = (w) => ({
    speed: runActive ? `(${cond.run}) ? 0.0 : query.modified_move_speed` : 'query.modified_move_speed',
    running: cond.run, attacking: cond.attack, hunting: cond.hunt, stalking: cond.stalk, fleeing: cond.flee, frozen: cond.frozen,
    air: '!query.is_on_ground', water: 'query.is_in_water',
  }[w]);
  const ms = motions(model, anims, skip);
  for (const [kind, m] of Object.entries(ms)) {
    const wexpr = m.weight && m.weight !== 'always' ? weightExpr(m.weight) : '';
    if (wexpr === null) continue; // e.g. stalking motion on a non-dweller
    const id = `animation.${prefix}.${kind}`;
    const bones = {};
    for (const [bn, ch] of Object.entries(m.bones)) {
      bones[bn] = {};
      for (const [c, vec] of Object.entries(ch)) bones[bn][c] = vec.map(termToMolang);
    }
    animations[id] = { loop: true, bones };
    const short = kind === 'look' ? 'look_at_target' : kind;
    map[short] = id;
    animate.push(wexpr ? { [short]: wexpr } : short);
  }
  const slotted = new Set();
  for (const [slot, { type, a }] of Object.entries(assigned)) {
    let c = cond[slot];
    if (!c) continue;
    if (slot === 'walk' && runActive) c = `${c} && !(${cond.run})`;
    const id = `animation.${prefix}.slot_${slot}`;
    animations[id] = type === 'imp' ? clone(a.data) : customToBedrock(a);
    map[`slot_${slot}`] = id;
    animate.push({ [`slot_${slot}`]: c });
    if (type === 'cus') slotted.add(a.uid);
  }
  for (const ca of anims.custom || []) {
    if (slotted.has(ca.uid) || !ca.channels?.length) continue;
    const id = `animation.${prefix}.${ca.name}`;
    animations[id] = customToBedrock(ca);
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
 * Evaluates everything for the preview.
 * state: { time, dist, speed, attack, tx, ty, air, water, running, hunting, stalking, fleeing, frozen, only?:Set, custom?:name }
 * returns { boneName: { rot:[x,y,z], pos:[x,y,z], scale:[x,y,z] } }
 */
export function evalPose(entity, state) {
  const anims = entity.anims || {};
  const { skip, assigned, runActive } = slotUse(anims);
  const ms = motions(entity.model, anims, skip);
  const pose = {};
  const get = (bn) => (pose[bn] ||= { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1] });
  const dweller = !!entity.horror?.enabled;
  const flags = {
    speed: runActive && state.running ? 0 : state.speed,
    running: state.running ? 1 : 0, attacking: state.attack > 0 ? 1 : 0, hunting: state.hunting ? 1 : 0,
    stalking: dweller && state.stalking ? 1 : 0, fleeing: dweller && state.fleeing ? 1 : 0, frozen: dweller && state.frozen ? 1 : 0,
    air: state.air ? 1 : 0, water: state.water ? 1 : 0, always: 1,
  };
  for (const [kind, m] of Object.entries(ms)) {
    if (state.only && !state.only.has(kind)) continue;
    const wt = m.weight ? flags[m.weight] : 1;
    if (!wt) continue;
    for (const [bn, ch] of Object.entries(m.bones)) {
      const p = get(bn);
      if (ch.rotation) ch.rotation.forEach((t, i) => { p.rot[i] += termEval(t, state) * wt; });
      if (ch.position) ch.position.forEach((t, i) => { p.pos[i] += termEval(t, state) * wt; });
      if (ch.scale) ch.scale.forEach((t, i) => { p.scale[i] *= 1 + (termEval(t, state) - 1) * wt; });
    }
  }
  const restPose = state.only && state.only.size === 0;
  // Slot animations (imported / custom keyframes).
  const active = {
    idle: state.speed < 0.05, walk: state.speed > 0.05 && !(runActive && state.running), run: !!state.running, attack: state.attack > 0,
    hunt: !!state.hunting, stalk: dweller && !!state.stalking, flee: dweller && !!state.fleeing, frozen: dweller && !!state.frozen,
  };
  const vars = {
    'query.life_time': state.time, 'query.modified_distance_moved': state.dist, 'query.modified_move_speed': state.speed,
    'variable.attack_time': state.attack, 'query.is_on_ground': state.air ? 0 : 1, 'query.is_in_water': state.water ? 1 : 0,
    'query.target_x_rotation': state.tx, 'query.target_y_rotation': state.ty, 'query.has_target': state.hunting ? 1 : 0,
  };
  for (const [slot, { type, a }] of Object.entries(assigned)) {
    if (restPose || !active[slot]) continue;
    const data = type === 'imp' ? a.data : customToBedrock(a);
    applyBedrockAnim(data, state.time, vars, get);
  }
  const ca = state.custom && (anims.custom || []).find((c) => c.name === state.custom);
  if (ca) applyBedrockAnim(customToBedrock(ca), state.time, vars, get);
  const ia = state.imported && (anims.imported || []).find((c) => c.uid === state.imported);
  if (ia) applyBedrockAnim(ia.data, state.time, vars, get);
  return pose;
}

function applyBedrockAnim(data, time, vars, get) {
  const len = animLength(data);
  let at = time;
  if (data.anim_time_update) at = evalMolang(String(data.anim_time_update).replace(/query\.anim_time\s*\+?\s*/g, ''), { vars }) || time;
  if (data.loop === true) at = at % len;
  else at = Math.min(at, len);
  const ctx = { vars: { ...vars, 'query.anim_time': at } };
  for (const [bn, ch] of Object.entries(data.bones || {})) {
    const p = get(bn);
    const r = evalChannel(ch.rotation, at, ctx); if (r) r.forEach((x, i) => { p.rot[i] += x; });
    const q = evalChannel(ch.position, at, ctx); if (q) q.forEach((x, i) => { p.pos[i] += x; });
    const s = evalChannel(ch.scale, at, ctx); if (s) s.forEach((x, i) => { p.scale[i] *= x; });
  }
}

/** Parses a Bedrock .animation.json into importable entries. */
export function parseAnimationFile(json) {
  const anims = json?.animations;
  if (!anims || typeof anims !== 'object') throw new Error('No "animations" found in this file');
  return Object.entries(anims).map(([id, data]) => ({ uid: uid(), name: id.split('.').pop() || id, source: id, data }));
}
