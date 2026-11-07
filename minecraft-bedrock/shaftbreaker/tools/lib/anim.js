// Bedrock animation sampling (pure JS, no three.js dependency).
// Mirrors Bedrock / Blockbench semantics:
//  * channel value forms: number | 'molang' | [x, y, z] | { "time": value | {pre, post, lerp_mode} }
//  * keyframe interpolation: linear by default; catmullrom if either neighbouring
//    keyframe declares "lerp_mode": "catmullrom" (author both to be safe)
//  * looping: loop true -> wrap, "hold_on_last_frame" -> clamp, false -> play once
//  * all values are in Bedrock FILE convention (degrees, model units)
import { compileMolang } from './molang.js';

const AXES = 3;

function toVec(v, ctx, isScale) {
  if (Array.isArray(v)) {
    return [0, 1, 2].map((i) => {
      const e = v[i] === undefined ? v[0] : v[i];
      return typeof e === 'number' ? e : Number(compileMolang(e)(ctx)) || 0;
    });
  }
  const n = typeof v === 'number' ? v : Number(compileMolang(v)(ctx)) || 0;
  return isScale ? [n, n, n] : [n, n, n];
}

function kfParts(raw) {
  // returns { pre, post, lerp }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const pre = raw.pre !== undefined ? raw.pre : raw.post;
    const post = raw.post !== undefined ? raw.post : raw.pre;
    return { pre, post, lerp: raw.lerp_mode || 'linear' };
  }
  return { pre: raw, post: raw, lerp: 'linear' };
}

const keyframeCache = new WeakMap();
function keyframesOf(channel) {
  let k = keyframeCache.get(channel);
  if (!k) {
    k = Object.keys(channel)
      .map((t) => ({ t: parseFloat(t), ...kfParts(channel[t]) }))
      .sort((a, b) => a.t - b.t);
    keyframeCache.set(channel, k);
  }
  return k;
}

function isKeyframed(channel) {
  return channel && typeof channel === 'object' && !Array.isArray(channel);
}

function catmull(t, p0, p1, p2, p3) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function sampleChannel(channel, time, ctx, isScale = false) {
  if (channel === undefined || channel === null) return null;
  if (!isKeyframed(channel)) return toVec(channel, ctx, isScale);
  const kfs = keyframesOf(channel);
  if (kfs.length === 0) return null;
  if (time <= kfs[0].t) return toVec(kfs[0].pre, ctx, isScale);
  const last = kfs[kfs.length - 1];
  if (time >= last.t) return toVec(last.post, ctx, isScale);
  let i = 0;
  while (i < kfs.length - 1 && !(time >= kfs[i].t && time < kfs[i + 1].t)) i++;
  const a = kfs[i], b = kfs[i + 1];
  const alpha = (time - a.t) / (b.t - a.t);
  const va = toVec(a.post, ctx, isScale);
  const vb = toVec(b.pre, ctx, isScale);
  if (a.lerp === 'catmullrom' || b.lerp === 'catmullrom') {
    const before = kfs[i - 1] ? toVec(kfs[i - 1].post, ctx, isScale) : va;
    const after = kfs[i + 2] ? toVec(kfs[i + 2].pre, ctx, isScale) : vb;
    return [0, 1, 2].map((j) => catmull(alpha, before[j], va[j], vb[j], after[j]));
  }
  if (a.lerp === 'step') return va;
  return [0, 1, 2].map((j) => va[j] + (vb[j] - va[j]) * alpha);
}

export function animationLength(anim) {
  if (typeof anim.animation_length === 'number') return anim.animation_length;
  let len = 0;
  for (const bone of Object.values(anim.bones || {})) {
    for (const ch of ['rotation', 'position', 'scale']) {
      if (isKeyframed(bone[ch])) for (const t of Object.keys(bone[ch])) len = Math.max(len, parseFloat(t));
    }
  }
  for (const key of ['sound_effects', 'particle_effects', 'timeline']) {
    if (anim[key]) for (const t of Object.keys(anim[key])) len = Math.max(len, parseFloat(t));
  }
  return len;
}

// Resolve local animation time given wall time since the animation started.
export function localTime(anim, elapsed) {
  const len = animationLength(anim);
  if (anim.loop === true && len > 0) return { t: elapsed % len, finished: false, len };
  if (anim.loop === 'hold_on_last_frame') return { t: Math.min(elapsed, len), finished: elapsed >= len, len };
  return { t: Math.min(elapsed, len), finished: elapsed >= len, len };
}

// Sample a whole animation -> { boneNameLower: {rotation, position, scale, override} }
export function sampleAnimation(anim, t, ctx) {
  ctx.values['query.anim_time'] = t;
  const out = {};
  for (const [name, bone] of Object.entries(anim.bones || {})) {
    out[name.toLowerCase()] = {
      rotation: sampleChannel(bone.rotation, t, ctx),
      position: sampleChannel(bone.position, t, ctx),
      scale: sampleChannel(bone.scale, t, ctx, true),
    };
  }
  return out;
}

// Combine several sampled layers [{pose, weight}] into per-bone totals.
// Bedrock adds weighted rotation/position offsets on top of the rest pose.
export function combineLayers(layers) {
  const total = {};
  for (const { pose, weight } of layers) {
    if (!pose || !weight) continue;
    for (const [name, p] of Object.entries(pose)) {
      const tgt = (total[name] ||= { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] });
      for (let i = 0; i < AXES; i++) {
        if (p.rotation) tgt.rotation[i] += p.rotation[i] * weight;
        if (p.position) tgt.position[i] += p.position[i] * weight;
        if (p.scale) tgt.scale[i] *= 1 + (p.scale[i] - 1) * weight;
      }
    }
  }
  return total;
}

// Collect timeline events (sound / particle) between two local times.
export function eventsBetween(anim, t0, t1) {
  const ev = [];
  for (const key of ['sound_effects', 'particle_effects']) {
    if (!anim[key]) continue;
    for (const [ts, val] of Object.entries(anim[key])) {
      const t = parseFloat(ts);
      const hit = t0 <= t1 ? t > t0 && t <= t1 : t > t0 || t <= t1; // wrap-around for loops
      if (hit) for (const e of Array.isArray(val) ? val : [val]) ev.push({ type: key, t, ...e });
    }
  }
  return ev;
}
