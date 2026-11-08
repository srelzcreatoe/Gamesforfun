#!/usr/bin/env node
// check_anims.mjs: automated animation QA for the Shaftbreaker (Minecraft Bedrock add-on).
//
// It poses the REAL geometry (tools/lib/model.js, the same Bedrock/Blockbench conventions the renderer uses) with
// the REAL animation files (tools/lib/anim.js + tools/lib/molang.js), samples every animation over its full length
// and machine-checks the rules from SPEC.md §4 and §7. Pure Node: three.js math only, no WebGL.
//
// Usage (run from minecraft-bedrock/shaftbreaker):
//   node tools/check_anims.mjs                                   check every animation in Shaftbreaker_RP/animations
//   node tools/check_anims.mjs --anim stalk_walk                 one animation (full name, or short name / suffix)
//   node tools/check_anims.mjs --file Shaftbreaker_RP/animations/shaftbreaker.frenzy.animation.json
//   node tools/check_anims.mjs --pose stalk_walk --t 0.6         world positions of every pivot / locator / foot
//   options:
//     --anim a,b            restrict to these animations (repeatable)
//     --file f1,f2          animation file(s) to load instead of the whole animations folder (repeatable)
//     --geo path            geometry (default Shaftbreaker_RP/models/entity/shaftbreaker.geo.json)
//     --limits path         joint-limit / options file (default tools/joint_limits.json)
//     --fps 60              sampling rate (distance-driven animations: frames at the configured ground speed,
//                           at least thresholds.min_distance_samples per cycle)
//     --checks list         subset of: structure,limits,ground,feet,seam,pops,interpen (default all)
//     --query "q.x=1,v.y=2" extra Molang values while sampling
//     --json                machine-readable report on stdout
//     --verbose             also print per-bone maxima and all time ranges
//     --t <time>            (with --pose) animation time; seconds, or blocks for distance-driven animations
//   exit code: 0 = no errors (warnings allowed), 1 = at least one error, 2 = usage / load failure.
//
// Checks (thresholds in tools/joint_limits.json):
//   structure  animated bone missing from the geometry, mixed catmullrom/linear in a channel, keyframes past
//              animation_length, distance-driven animation without anim_time_update = query.modified_distance_moved
//   limits     TOTAL local rotation (rest + animation) per bone & axis against the SPEC §4 table
//   ground     lowest vertex of the whole model per frame: error below -0.5 (sinking) and, unless the
//              animation is airborne (frenzy_lunge), above +1.0 (floating)
//   feet       per foot (all cubes of foot_* bones), planted = foot's lowest point <= 0.75. Contact slip is the
//              mean horizontal motion of the foot's corner vertices that touch the ground in consecutive frames.
//              time-driven: planted feet must not slide (drift > 0.6 units = error).
//              distance-driven: the planted foot must move backward (+Z) at 16/0.58 units per block of anim time;
//              mean velocity error > 20 % or accumulated slip > max(0.6, 20 % of the stance) = error.
//              Also stride metrics: planted fraction, contacts, stance length, swing clearance, step length.
//   seam       looping animations: pose at t = 0 vs t = length per bone (rotation > 1.5 deg / position > 0.25
//              = error); velocity jump across the seam = warning
//   pops       per-frame local angular speed per bone in deg per 1/60 s: warning > 20, error > 45
//   interpen   OBB-vs-OBB (separating axis) penetration depth between cubes of non-adjacent bone groups;
//              > 0.75 units = error (mane vs arm/head = warning). Overlap already present in the rest pose is
//              subtracted per cube pair (reported once in the geometry section).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildModel, applyPose, getGeometry, eulerFromBedrock } from './lib/model.js';
import { sampleAnimation, combineLayers, animationLength } from './lib/anim.js';
import { makeContext, compileMolang } from './lib/molang.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ADDON_ROOT = path.resolve(HERE, '..');
const DEG = 180 / Math.PI;
const CHECKS = ['structure', 'limits', 'ground', 'feet', 'seam', 'pops', 'interpen'];

// ------------------------------------------------------------------------------------------------ utils
function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  const a = path.resolve(process.cwd(), p);
  if (fs.existsSync(a)) return a;
  return path.resolve(ADDON_ROOT, p);
}
const rel = (p) => path.relative(ADDON_ROOT, p) || p;
const f2 = (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
const fv = (v) => '[' + v.map(f2).join(', ') + ']';
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const globRe = (g) => new RegExp('^' + g.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (!s.startsWith('--')) { a._.push(s); continue; }
    const k = s.slice(2);
    const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (a[k] === undefined) a[k] = v;
    else a[k] = [].concat(a[k], v);
  }
  return a;
}
const listArg = (v) => (v === undefined || v === true ? [] : [].concat(v).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean));

function kvArg(v) {
  const out = {};
  for (const part of listArg(v)) {
    const i = part.lastIndexOf('=');
    if (i < 0) continue;
    const val = part.slice(i + 1).trim();
    out[part.slice(0, i).trim()] = isNaN(Number(val)) ? val : Number(val);
  }
  return out;
}

// frame index list -> [[t0, t1], ...]
function rangesOf(frames, times) {
  const out = [];
  let s = null, p = null;
  for (const f of frames) {
    if (s === null) { s = p = f; continue; }
    if (f === p + 1) { p = f; continue; }
    out.push([times[s], times[p]]);
    s = p = f;
  }
  if (s !== null) out.push([times[s], times[p]]);
  return out;
}
function fmtRanges(ranges, unit, max = 4) {
  if (!ranges || !ranges.length) return '';
  const r = ranges.slice(0, max).map(([a, b]) => (Math.abs(a - b) < 1e-9 ? `${a.toFixed(2)}` : `${a.toFixed(2)}–${b.toFixed(2)}`));
  return `${unit} ${r.join(', ')}${ranges.length > max ? ` (+${ranges.length - max} more)` : ''}`;
}

// ------------------------------------------------------------------------------------------------ config
export function loadConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exact = new Map(), globs = [];
  for (const [k, v] of Object.entries(cfg.joints || {})) {
    if (k.startsWith('$')) continue;
    if (k.includes('*')) globs.push({ key: k, re: globRe(k), lim: v });
    else exact.set(k.toLowerCase(), { key: k, lim: v });
  }
  cfg.jointFor = (bone) => exact.get(bone) || globs.find((g) => g.re.test(bone)) || null;
  const groups = [];
  for (const [g, pats] of Object.entries(cfg.groups || {})) if (!g.startsWith('$')) groups.push({ name: g, res: pats.map(globRe) });
  cfg.groupFor = (bone) => (groups.find((g) => g.res.some((r) => r.test(bone))) || {}).name || null;
  cfg.groupNames = groups.map((g) => g.name);
  cfg.footFor = (bone) => {
    for (const [side, pats] of Object.entries(cfg.feet || {})) if (pats.map(globRe).some((r) => r.test(bone))) return side;
    return null;
  };
  cfg.U = cfg.units_per_block || 16 / (cfg.render_scale || 0.58);
  cfg.T = { ...cfg.thresholds };
  return cfg;
}

function animOptions(cfg, name) {
  const d = cfg.defaults || {};
  const s = (cfg.animations || {})[name] || {};
  return {
    ...d, ...s,
    configuredDriver: s.driver,
    queries: { ...(d.queries || {}), ...(s.queries || {}) },
    properties: { ...(d.properties || {}), ...(s.properties || {}) },
  };
}

// ------------------------------------------------------------------------------------------------ rig
export class Rig {
  constructor(geoJson, cfg) {
    this.cfg = cfg;
    this.geo = getGeometry(geoJson);
    this.model = buildModel(THREE, this.geo, new THREE.MeshBasicMaterial());
    this.bones = [];
    this.boneIndex = new Map();
    for (const [name, b] of this.model.bones) {
      const j = cfg.jointFor(name);
      const rec = { name, entry: b, def: b.def, parent: b.def.parent ? b.def.parent.toLowerCase() : null, limits: j ? j.lim : null, limitKey: j ? j.key : null, group: null, idx: this.bones.length };
      this.boneIndex.set(name, rec.idx);
      this.bones.push(rec);
    }
    // cubes
    this.cubes = [];
    this.model.root.updateMatrixWorld(true);
    this.model.root.traverse((o) => {
      if (!o.isMesh || !o.userData.cube) return;
      const c = o.userData.cube;
      const bone = o.userData.bone.toLowerCase();
      const inf = c.inflate || 0;
      const size = [c.size[0] + 2 * inf, c.size[1] + 2 * inf, c.size[2] + 2 * inf];
      const from = [-(c.origin[0] + c.size[0]) - inf, c.origin[1] - inf, c.origin[2] - inf];
      const local = new Float64Array(24);
      for (let k = 0; k < 8; k++) {
        local[k * 3] = from[0] + (k & 1 ? size[0] : 0);
        local[k * 3 + 1] = from[1] + (k & 2 ? size[1] : 0);
        local[k * 3 + 2] = from[2] + (k & 4 ? size[2] : 0);
      }
      this.cubes.push({ mesh: o, bone, boneIdx: this.boneIndex.get(bone), local, cLocal: [from[0] + size[0] / 2, from[1] + size[1] / 2, from[2] + size[2] / 2], half: size.map((s) => s / 2), group: null, foot: cfg.footFor(bone) });
    });
    const nc = this.cubes.length;
    this.corners = new Float64Array(nc * 24); // file space
    this.center = new Float64Array(nc * 3);
    this.axes = new Float64Array(nc * 9); // unit axes (file space), 3 per cube
    this.ext = new Float64Array(nc * 3);
    this.radius = new Float64Array(nc);
    this.aabb = new Float64Array(nc * 6);
    // groups: configured groups, else a group per bone with cubes
    const hasCubes = new Set(this.cubes.map((c) => c.bone));
    for (const b of this.bones) b.group = cfg.groupFor(b.name) || (hasCubes.has(b.name) ? b.name : null);
    for (const c of this.cubes) c.group = this.bones[c.boneIdx].group;
    const gnames = [...new Set(this.cubes.map((c) => c.group))];
    this.groups = gnames.map((g) => ({ name: g, cubes: this.cubes.map((c, i) => (c.group === g ? i : -1)).filter((i) => i >= 0), c: [0, 0, 0], r: 0 }));
    this.unconfiguredGroups = gnames.filter((g) => !cfg.groupNames.includes(g));
    // adjacency through the hierarchy (walk up to the nearest ancestor that has a group)
    const adj = new Set();
    const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (const b of this.bones) {
      if (!b.group) continue;
      let p = b.parent;
      while (p && !this.bones[this.boneIndex.get(p)]?.group) p = this.bones[this.boneIndex.get(p)]?.parent;
      if (!p) continue;
      const pg = this.bones[this.boneIndex.get(p)].group;
      if (pg !== b.group) adj.add(key(pg, b.group));
    }
    const ip = cfg.interpenetration || {};
    const ignore = new Set((ip.ignore_pairs || []).map(([a, b]) => key(a, b)));
    const warn = new Set((ip.warn_pairs || []).map(([a, b]) => key(a, b)));
    this.pairs = [];
    this.adjacent = [...adj];
    for (let i = 0; i < this.groups.length; i++) {
      for (let j = i + 1; j < this.groups.length; j++) {
        const k = key(this.groups[i].name, this.groups[j].name);
        if (adj.has(k) || ignore.has(k)) continue;
        this.pairs.push({ a: i, b: j, key: `${this.groups[i].name} vs ${this.groups[j].name}`, severity: warn.has(k) ? 'warning' : 'error' });
      }
    }
    // feet
    this.feet = {};
    for (const side of Object.keys(cfg.feet || {})) {
      const idx = this.cubes.map((c, i) => (c.foot === side ? i : -1)).filter((i) => i >= 0);
      if (idx.length) this.feet[side] = { side, cubes: idx, bones: [...new Set(idx.map((i) => this.cubes[i].bone))] };
    }
    // rest pose baseline
    this.pose({});
    this.restLowest = this.lowest();
    this.restPen = new Map();
    this.restOverlaps = [];
    if (ip.rest_baseline !== false) {
      for (const pr of this.pairs) {
        let best = 0, bi = -1, bj = -1;
        this.forPairCubes(pr, (i, j, d) => {
          this.restPen.set(i * 100000 + j, d);
          if (d > best) { best = d; bi = i; bj = j; }
        }, 0);
        if (best > 0) this.restOverlaps.push({ pair: pr.key, depth: best, bones: [this.cubes[bi].bone, this.cubes[bj].bone] });
      }
    }
  }

  // apply Bedrock totals {bone: {rotation, position, scale}} and refresh world data
  pose(totals) {
    applyPose(THREE, this.model, totals);
    this.model.root.updateMatrixWorld(true);
    const { cubes, corners, center, axes, ext, radius, aabb } = this;
    for (let i = 0; i < cubes.length; i++) {
      const c = cubes[i];
      const e = c.mesh.matrixWorld.elements;
      const L = c.local;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        const x = L[k * 3], y = L[k * 3 + 1], z = L[k * 3 + 2];
        const wx = -(e[0] * x + e[4] * y + e[8] * z + e[12]);
        const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
        const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const o = i * 24 + k * 3;
        corners[o] = wx; corners[o + 1] = wy; corners[o + 2] = wz;
        if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
        if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
        if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
      }
      aabb.set([x0, y0, z0, x1, y1, z1], i * 6);
      const [cx, cy, cz] = c.cLocal;
      center[i * 3] = -(e[0] * cx + e[4] * cy + e[8] * cz + e[12]);
      center[i * 3 + 1] = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
      center[i * 3 + 2] = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
      let r2 = 0;
      for (let k = 0; k < 3; k++) {
        const ax = -e[k * 4], ay = e[k * 4 + 1], az = e[k * 4 + 2];
        const l = Math.hypot(ax, ay, az) || 1;
        axes[i * 9 + k * 3] = ax / l; axes[i * 9 + k * 3 + 1] = ay / l; axes[i * 9 + k * 3 + 2] = az / l;
        ext[i * 3 + k] = c.half[k] * l;
        r2 += ext[i * 3 + k] ** 2;
      }
      radius[i] = Math.sqrt(r2);
    }
    for (const g of this.groups) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (const i of g.cubes) {
        const x = center[i * 3], y = center[i * 3 + 1], z = center[i * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      g.c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      let r = 0;
      for (const i of g.cubes) r = Math.max(r, Math.hypot(center[i * 3] - g.c[0], center[i * 3 + 1] - g.c[1], center[i * 3 + 2] - g.c[2]) + radius[i]);
      g.r = r;
    }
  }

  lowest(cubeIdx) {
    let y = Infinity, at = -1;
    const list = cubeIdx || null;
    const n = list ? list.length : this.cubes.length;
    for (let q = 0; q < n; q++) {
      const i = list ? list[q] : q;
      const v = this.aabb[i * 6 + 1];
      if (v < y) { y = v; at = i; }
    }
    return { y, cube: at, bone: at >= 0 ? this.cubes[at].bone : null };
  }

  // SAT penetration depth between cube OBBs i, j (0 if separated)
  sat(i, j) {
    const { center: C, axes: A, ext: E } = this;
    const T = [C[j * 3] - C[i * 3], C[j * 3 + 1] - C[i * 3 + 1], C[j * 3 + 2] - C[i * 3 + 2]];
    const a = [0, 1, 2].map((k) => [A[i * 9 + k * 3], A[i * 9 + k * 3 + 1], A[i * 9 + k * 3 + 2]]);
    const b = [0, 1, 2].map((k) => [A[j * 9 + k * 3], A[j * 9 + k * 3 + 1], A[j * 9 + k * 3 + 2]]);
    const ea = [E[i * 3], E[i * 3 + 1], E[i * 3 + 2]], eb = [E[j * 3], E[j * 3 + 1], E[j * 3 + 2]];
    let min = Infinity;
    const test = (L) => {
      const rA = ea[0] * Math.abs(a[0][0] * L[0] + a[0][1] * L[1] + a[0][2] * L[2]) + ea[1] * Math.abs(a[1][0] * L[0] + a[1][1] * L[1] + a[1][2] * L[2]) + ea[2] * Math.abs(a[2][0] * L[0] + a[2][1] * L[1] + a[2][2] * L[2]);
      const rB = eb[0] * Math.abs(b[0][0] * L[0] + b[0][1] * L[1] + b[0][2] * L[2]) + eb[1] * Math.abs(b[1][0] * L[0] + b[1][1] * L[1] + b[1][2] * L[2]) + eb[2] * Math.abs(b[2][0] * L[0] + b[2][1] * L[1] + b[2][2] * L[2]);
      const o = rA + rB - Math.abs(T[0] * L[0] + T[1] * L[1] + T[2] * L[2]);
      if (o < min) min = o;
      return o > 0;
    };
    for (let k = 0; k < 3; k++) if (!test(a[k])) return 0;
    for (let k = 0; k < 3; k++) if (!test(b[k])) return 0;
    for (let k = 0; k < 3; k++) {
      for (let l = 0; l < 3; l++) {
        const u = a[k], v = b[l];
        const L = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const n = Math.hypot(L[0], L[1], L[2]);
        if (n < 1e-6) continue;
        L[0] /= n; L[1] /= n; L[2] /= n;
        if (!test(L)) return 0;
      }
    }
    return Math.max(0, min);
  }

  // call fn(i, j, depth) for every penetrating cube pair of a group pair with depth > minDepth
  forPairCubes(pr, fn, minDepth) {
    const A = this.groups[pr.a], B = this.groups[pr.b];
    const dgx = A.c[0] - B.c[0], dgy = A.c[1] - B.c[1], dgz = A.c[2] - B.c[2];
    if (dgx * dgx + dgy * dgy + dgz * dgz > (A.r + B.r) ** 2) return;
    const { center: C, radius: R, aabb: X } = this;
    for (const i of A.cubes) {
      const dx0 = C[i * 3] - B.c[0], dy0 = C[i * 3 + 1] - B.c[1], dz0 = C[i * 3 + 2] - B.c[2];
      if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > (R[i] + B.r) ** 2) continue;
      for (const j of B.cubes) {
        const dx = C[i * 3] - C[j * 3], dy = C[i * 3 + 1] - C[j * 3 + 1], dz = C[i * 3 + 2] - C[j * 3 + 2];
        const rr = R[i] + R[j];
        if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
        if (X[i * 6] > X[j * 6 + 3] || X[j * 6] > X[i * 6 + 3] || X[i * 6 + 1] > X[j * 6 + 4] || X[j * 6 + 1] > X[i * 6 + 4] || X[i * 6 + 2] > X[j * 6 + 5] || X[j * 6 + 2] > X[i * 6 + 5]) continue;
        const d = this.sat(i, j);
        if (d > minDepth) fn(i, j, d);
      }
    }
  }

  bonePivotWorld(name) {
    const b = this.model.bones.get(name);
    const p = new THREE.Vector3().setFromMatrixPosition(b.obj.matrixWorld);
    return [-p.x, p.y, p.z];
  }
  locatorWorld(name) {
    const l = this.model.locators.get(name);
    const p = new THREE.Vector3().setFromMatrixPosition(l.matrixWorld);
    return [-p.x, p.y, p.z];
  }
}

// ------------------------------------------------------------------------------------------------ animations
export function loadAnimationFiles(files) {
  const out = [];
  for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`cannot parse ${rel(f)}: ${e.message}`); }
    for (const [name, anim] of Object.entries(j.animations || {})) out.push({ name, anim, file: f, format_version: j.format_version });
  }
  return out;
}

function makeCtx(opt, extraQueries, variant) {
  const props = opt.properties || {};
  return makeContext({ ...opt.queries, ...(variant || {}), ...(extraQueries || {}) }, { 'query.property': (n) => props[n] ?? 0 });
}

function sampleTotals(anim, t, ctx, life, dist) {
  ctx.values['query.life_time'] = life;
  ctx.values['query.modified_distance_moved'] = dist;
  return combineLayers([{ pose: sampleAnimation(anim, t, ctx), weight: 1 }]);
}

function driverOf(rec, opt, cfg) {
  const upd = rec.anim.anim_time_update;
  const detected = typeof upd === 'string' && /modified_distance_moved/i.test(upd);
  const driver = opt.configuredDriver === 'distance' || detected ? 'distance' : 'time';
  let k = 1;
  if (driver === 'distance' && detected) {
    try {
      const fn = compileMolang(upd);
      const ctx = makeContext({ 'query.anim_time': 0, 'query.delta_time': 0, 'query.modified_distance_moved': 0 });
      const v0 = Number(fn(ctx));
      ctx.values['query.modified_distance_moved'] = 1;
      const v1 = Number(fn(ctx));
      if (Number.isFinite(v1 - v0) && Math.abs(v1 - v0) > 1e-9) k = v1 - v0;
    } catch { /* keep 1 */ }
  }
  const speed = opt.speed_blocks_per_second || 1.5;
  return { driver, detected, k, speed, secPerUnit: driver === 'distance' ? 1 / (Math.abs(k) * speed) : 1, groundSpeed: cfg.U / k, unit: driver === 'distance' ? 'd' : 't' };
}

function structureChecks(rig, rec, opt, drv, add) {
  const { anim } = rec;
  const len = animationLength(anim);
  for (const [bone, chans] of Object.entries(anim.bones || {})) {
    if (!rig.boneIndex.has(bone.toLowerCase())) add('structure', 'error', `bone "${bone}" does not exist in the geometry (its channels have no effect)`, { bone });
    for (const ch of ['rotation', 'position', 'scale']) {
      const c = chans && chans[ch];
      if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
      const keys = Object.keys(c);
      const cat = keys.filter((t) => c[t] && typeof c[t] === 'object' && !Array.isArray(c[t]) && c[t].lerp_mode === 'catmullrom').length;
      if (cat && cat !== keys.length) add('structure', 'warning', `${bone}.${ch}: catmullrom on ${cat}/${keys.length} keyframes (SPEC §7: all or none)`, { bone });
      if (typeof anim.animation_length === 'number') {
        const late = keys.filter((t) => parseFloat(t) > anim.animation_length + 1e-6);
        if (late.length) add('structure', 'warning', `${bone}.${ch}: keyframe(s) ${late.join(', ')} after animation_length ${anim.animation_length}`, { bone });
      }
    }
  }
  const keyframed = Object.values(anim.bones || {}).some((ch) => ch && ['rotation', 'position', 'scale'].some((c) => ch[c] && typeof ch[c] === 'object' && !Array.isArray(ch[c])));
  if (anim.loop === true && typeof anim.animation_length !== 'number' && keyframed) add('structure', 'warning', `looping animation without animation_length (length = last keyframe ${len})`);
  if (drv.driver === 'distance') {
    if (!drv.detected) add('structure', 'error', `configured as distance-driven but has no "anim_time_update": "query.modified_distance_moved" (SPEC §7)`);
    if (typeof anim.animation_length !== 'number') add('structure', 'error', 'distance-driven animation needs animation_length (= blocks per full stride cycle)');
  } else if (opt.configuredDriver === 'time' && drv.detected) add('structure', 'warning', 'configured as time-driven but anim_time_update uses query.modified_distance_moved');
}

// ------------------------------------------------------------------------------------------------ analysis of one variant
function runVariant(rig, cfg, rec, opt, drv, variant, cli) {
  const T = cfg.T;
  const anim = rec.anim;
  const checks = cli.checks;
  const issues = [];
  const add = (check, severity, message, extra = {}) => { if (checks.has(check)) issues.push({ check, severity, message, ...extra }); };
  const len = animationLength(anim);
  const loop = anim.loop === true;
  const fps = cli.fps;
  let N = 0;
  if (len > 0) {
    N = drv.driver === 'distance' ? Math.max(T.min_distance_samples || 120, Math.ceil(len * drv.secPerUnit * fps)) : Math.max(2, Math.round(len * fps));
  }
  const dt = N ? len / N : 0;
  const dtSec = dt * drv.secPerUnit; // seconds per frame step
  const times = Array.from({ length: N + 1 }, (_, i) => i * dt);
  const ctx = makeCtx(opt, cli.query, variant);
  const nb = rig.bones.length;
  const eul = new Float32Array((N + 1) * nb * 3); // TOTAL local rotation per frame/bone
  const pos = new Float32Array((N + 1) * nb * 3); // animation position offsets
  const animated = new Set(Object.keys(anim.bones || {}).map((b) => b.toLowerCase()).filter((b) => rig.boneIndex.has(b)));
  // per-frame data
  const lowest = new Float64Array(N + 1);
  const lowestBone = new Array(N + 1);
  const feet = Object.values(rig.feet).map((f) => ({ ...f, low: new Float64Array(N + 1), lowXZ: new Float64Array((N + 1) * 2), corners: new Float64Array((N + 1) * f.cubes.length * 24) }));
  const limitHits = new Map();
  const pen = new Map(); // pair key -> record
  const minDepth = T.penetration_min_depth;
  const baseline = (cfg.interpenetration || {}).rest_baseline !== false;
  const doPen = checks.has('interpen');

  for (let fi = 0; fi <= N; fi++) {
    const t = times[fi];
    const totals = sampleTotals(anim, t, ctx, t * drv.secPerUnit, drv.driver === 'distance' ? t / drv.k : 0);
    // local totals + joint limits
    for (const b of rig.bones) {
      const tt = totals[b.name];
      const rr = b.entry.restRot;
      const o = (fi * nb + b.idx) * 3;
      for (let ax = 0; ax < 3; ax++) {
        const v = rr[ax] + (tt && tt.rotation ? tt.rotation[ax] : 0);
        eul[o + ax] = v;
        pos[o + ax] = tt && tt.position ? tt.position[ax] : 0;
        const lim = b.limits && b.limits['xyz'[ax]];
        if (lim && (v < lim[0] - T.limit_epsilon_deg || v > lim[1] + T.limit_epsilon_deg)) {
          const key = `${b.name}.${'xyz'[ax]}`;
          let h = limitHits.get(key);
          if (!h) limitHits.set(key, (h = { bone: b.name, axis: 'xyz'[ax], limit: lim, worst: v, worstT: t, frames: [] }));
          const over = (x) => (x < lim[0] ? lim[0] - x : x - lim[1]);
          if (over(v) > over(h.worst)) { h.worst = v; h.worstT = t; }
          h.frames.push(fi);
        }
      }
    }
    rig.pose(totals);
    const lo = rig.lowest();
    lowest[fi] = lo.y;
    lowestBone[fi] = lo.bone;
    for (const f of feet) {
      const flo = rig.lowest(f.cubes);
      f.low[fi] = flo.y;
      const base = fi * f.cubes.length * 24;
      for (let q = 0; q < f.cubes.length; q++) f.corners.set(rig.corners.subarray(f.cubes[q] * 24, f.cubes[q] * 24 + 24), base + q * 24);
      // horizontal position of the lowest vertex
      let by = Infinity;
      for (let k = 0; k < f.cubes.length * 8; k++) {
        const y = f.corners[base + k * 3 + 1];
        if (y < by) { by = y; f.lowXZ[fi * 2] = f.corners[base + k * 3]; f.lowXZ[fi * 2 + 1] = f.corners[base + k * 3 + 2]; }
      }
    }
    if (doPen && (!loop || fi < N || N === 0)) {
      for (const pr of rig.pairs) {
        let best = 0, bi = -1, bj = -1;
        rig.forPairCubes(pr, (i, j, d) => {
          if (baseline) { const r0 = rig.restPen.get(i * 100000 + j) || 0; if (d - r0 <= minDepth) return; }
          if (d > best) { best = d; bi = i; bj = j; }
        }, minDepth);
        if (best > 0) {
          let r = pen.get(pr.key);
          if (!r) pen.set(pr.key, (r = { pair: pr.key, severity: pr.severity, depth: 0, t: 0, bones: null, frames: [] }));
          r.frames.push(fi);
          if (best > r.depth) { r.depth = best; r.t = t; r.bones = [rig.cubes[bi].bone, rig.cubes[bj].bone]; r.rest = rig.restPen.get(bi * 100000 + bj) || 0; }
        }
      }
    }
  }
  const U = drv.unit;
  const metrics = { frames: N + 1, dt, dtSec };

  // ---------------------------------------------------------------- limits
  for (const h of limitHits.values()) {
    add('limits', 'error', `${h.bone}.${h.axis} = ${f2(h.worst)}° (allowed ${h.limit[0]}…${h.limit[1]}) at ${fmtRanges(rangesOf(h.frames, times), U)}`, { bone: h.bone, axis: h.axis, value: h.worst, limit: h.limit, time: h.worstT, ranges: rangesOf(h.frames, times) });
  }

  // ---------------------------------------------------------------- ground
  {
    let mn = 0, mx = 0;
    for (let i = 1; i <= N; i++) { if (lowest[i] < lowest[mn]) mn = i; if (lowest[i] > lowest[mx]) mx = i; }
    metrics.ground = { min: lowest[mn], minT: times[mn], minBone: lowestBone[mn], max: lowest[mx], maxT: times[mx] };
    const sink = [], flt = [];
    for (let i = 0; i <= N; i++) { if (lowest[i] < T.ground_sink_below) sink.push(i); if (lowest[i] > T.ground_float_above) flt.push(i); }
    if (sink.length) add('ground', 'error', `sinking: lowest point y = ${f2(lowest[mn])} (${lowestBone[mn]}) at ${U}=${times[mn].toFixed(2)}; below ${T.ground_sink_below} at ${fmtRanges(rangesOf(sink, times), U)}`, { value: lowest[mn], time: times[mn], bone: lowestBone[mn], ranges: rangesOf(sink, times) });
    if (flt.length && !opt.airborne) add('ground', 'error', `floating: lowest point y = ${f2(lowest[mx])} at ${U}=${times[mx].toFixed(2)}; above +${T.ground_float_above} at ${fmtRanges(rangesOf(flt, times), U)} (only airborne animations may leave the ground)`, { value: lowest[mx], time: times[mx], ranges: rangesOf(flt, times) });
  }

  // ---------------------------------------------------------------- feet
  if (N > 0 && !opt.additive) {
    const h = T.foot_planted_height;
    const nF = N; // number of steps
    const cyc = loop;
    metrics.feet = {};
    const touchdowns = {};
    for (const f of feet) {
      const nv = f.cubes.length * 8;
      const planted = Array.from({ length: N + 1 }, (_, i) => f.low[i] <= h);
      const stepPlanted = Array.from({ length: nF }, (_, i) => planted[i] && planted[i + 1]);
      const disp = (i) => {
        const a = i * nv * 3, b = (i + 1) * nv * 3;
        let dx = 0, dz = 0, n = 0;
        for (let k = 0; k < nv; k++) {
          if (f.corners[a + k * 3 + 1] <= h && f.corners[b + k * 3 + 1] <= h) {
            dx += f.corners[b + k * 3] - f.corners[a + k * 3];
            dz += f.corners[b + k * 3 + 2] - f.corners[a + k * 3 + 2];
            n++;
          }
        }
        return n ? [dx / n, dz / n] : null;
      };
      // planted intervals over steps (cyclic for loops)
      const intervals = [];
      const all = stepPlanted.every(Boolean);
      if (all) intervals.push(Array.from({ length: nF }, (_, i) => i));
      else {
        let start = 0;
        if (cyc) start = stepPlanted.findIndex((p) => !p);
        let cur = null;
        for (let q = 0; q < nF; q++) {
          const i = cyc ? (start + q) % nF : q;
          if (stepPlanted[i]) { (cur ||= []).push(i); } else if (cur) { intervals.push(cur); cur = null; }
        }
        if (cur) intervals.push(cur);
      }
      const plantedFrames = cyc ? planted.slice(0, N).filter(Boolean).length / N : planted.filter(Boolean).length / (N + 1);
      const m = { planted: plantedFrames, contacts: intervals.length, stance: 0, clearance: 0, slide: 0 };
      // swing clearance
      for (let i = 0; i <= N; i++) if (!planted[i]) m.clearance = Math.max(m.clearance, f.low[i]);
      // touchdown / liftoff
      m.touchdowns = []; m.liftoffs = [];
      const lastF = cyc ? N : N + 1;
      for (let i = cyc ? 0 : 1; i < lastF; i++) {
        const p = cyc ? (i - 1 + N) % N : i - 1;
        if (planted[i] && !planted[p]) m.touchdowns.push(times[i]);
        if (!planted[i] && planted[p]) m.liftoffs.push(times[i]);
      }
      const velErrs = [];
      let worstVel = { e: 0, t: 0 };
      let worstSlip = { s: 0, ranges: null, exp: 0 };
      const stanceLens = [];
      const slides = [];
      for (const iv of intervals) {
        const pts = [[0, 0]];
        let cx = 0, cz = 0, ex = 0, ez = 0;
        for (const i of iv) {
          const d = disp(i);
          if (d) { cx += d[0]; cz += d[1]; }
          if (drv.driver === 'distance') {
            ez += drv.groundSpeed * dt;
            if (d) {
              const vx = d[0] / dt, vz = d[1] / dt;
              const e = Math.hypot(vx, vz - drv.groundSpeed) / Math.abs(drv.groundSpeed);
              velErrs.push(e);
              if (e > worstVel.e) worstVel = { e, t: times[i] };
            }
            pts.push([cx - ex, cz - ez]);
          } else pts.push([cx, cz]);
        }
        // path diameter = how far the contact drifted (time) / slipped relative to the ground (distance)
        let diam = 0;
        for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) diam = Math.max(diam, Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]));
        stanceLens.push(Math.hypot(cx, cz));
        const ivRanges = rangesOf(iv.slice().sort((x, y) => x - y), times);
        if (drv.driver === 'distance') {
          if (diam > worstSlip.s) worstSlip = { s: diam, ranges: ivRanges, exp: ez };
        } else {
          slides.push({ drift: diam, ranges: ivRanges });
          m.slide = Math.max(m.slide, diam);
        }
      }
      m.stance = stanceLens.length ? Math.max(...stanceLens) : 0;
      const side = f.side;
      const label = `foot_${side}`;
      if (drv.driver === 'distance') {
        const mean = velErrs.length ? velErrs.reduce((a, b) => a + b, 0) / velErrs.length : null;
        m.speedErrMean = mean;
        m.speedErrMax = worstVel.e;
        m.speedErrMaxT = worstVel.t;
        m.slip = worstSlip.s;
        const slipTol = Math.max(T.foot_slide_max, T.foot_speed_tolerance * worstSlip.exp);
        m.pass = mean !== null && mean <= T.foot_speed_tolerance && worstSlip.s <= slipTol;
        if (mean === null) add('feet', 'error', `${label} is never planted during the cycle (walk/run cycles need ground contact)`, { foot: side });
        else {
          if (mean > T.foot_speed_tolerance) add('feet', 'error', `${label} ground speed: mean error ${(mean * 100).toFixed(0)}% (max ${(worstVel.e * 100).toFixed(0)}% at ${U}=${worstVel.t.toFixed(2)}); planted foot must move +Z at ${f2(drv.groundSpeed)} units per anim-time unit (tolerance ${(T.foot_speed_tolerance * 100).toFixed(0)}%)`, { foot: side, value: mean });
          if (worstSlip.s > slipTol) add('feet', 'error', `${label} slips ${f2(worstSlip.s)} units against the ground while planted at ${fmtRanges(worstSlip.ranges, U)} (limit ${f2(slipTol)})`, { foot: side, value: worstSlip.s, ranges: worstSlip.ranges });
          else if (worstSlip.s > Math.max(T.foot_slide_max, (T.foot_slip_warn_fraction ?? 0.05) * worstSlip.exp)) add('feet', 'warning', `${label} slips ${f2(worstSlip.s)} units against the ground while planted at ${fmtRanges(worstSlip.ranges, U)} (visible skating; error above ${f2(slipTol)})`, { foot: side, value: worstSlip.s, ranges: worstSlip.ranges });
          if (worstVel.e > T.foot_speed_frame_warn && worstSlip.s <= slipTol) add('feet', 'warning', `${label} ground speed spikes to ${(worstVel.e * 100).toFixed(0)}% error at ${U}=${worstVel.t.toFixed(2)} (touch-down / lift-off not matched to the ground)`, { foot: side, value: worstVel.e, time: worstVel.t });
        }
        touchdowns[side] = m.touchdowns.map((t) => {
          // footprint along the travel direction: contact z at touchdown minus body travel
          const i = Math.round(t / dt);
          return { t, x: f.lowXZ[i * 2], z: f.lowXZ[i * 2 + 1] - drv.groundSpeed * t };
        });
      } else {
        for (const s of slides) {
          if (s.drift > T.foot_slide_max) {
            const sev = opt.foot_slide_severity || 'error';
            if (sev !== 'off') add('feet', sev, `${label} slides ${f2(s.drift)} units while planted at ${fmtRanges(s.ranges, U)} (limit ${T.foot_slide_max})`, { foot: side, value: s.drift, ranges: s.ranges });
          }
        }
        if (!opt.airborne && intervals.length === 0 && plantedFrames === 0) add('feet', 'warning', `${label} never touches the ground`, { foot: side });
        // repositioning step lengths (lift-off -> next touchdown) in model space
        m.steps = [];
        for (const lt of m.liftoffs) {
          const i0 = Math.round(lt / dt) - 1;
          const td = m.touchdowns.find((t) => t > lt) ?? (cyc ? m.touchdowns[0] : undefined);
          if (td === undefined) continue;
          const i1 = Math.round(td / dt);
          m.steps.push(Math.hypot(f.lowXZ[i1 * 2] - f.lowXZ[Math.max(0, i0) * 2], f.lowXZ[i1 * 2 + 1] - f.lowXZ[Math.max(0, i0) * 2 + 1]));
        }
      }
      metrics.feet[side] = m;
    }
    if (drv.driver === 'distance') {
      const cycleUnits = drv.groundSpeed * len;
      metrics.stride = { blocks: len / drv.k, units: cycleUnits, seconds: len * drv.secPerUnit };
      const R = touchdowns.right || [], L = touchdowns.left || [];
      const stepLen = (from, to) => {
        if (!from.length || !to.length) return null;
        const out = [];
        for (const a of from) {
          // next touchdown of the other foot (wrapping one cycle ahead)
          let b = to.find((x) => x.t > a.t);
          let shift = 0;
          if (!b) { b = to[0]; shift = -cycleUnits; }
          out.push(Math.abs(b.z + shift - a.z));
        }
        return out.reduce((p, q) => p + q, 0) / out.length;
      };
      metrics.stepRL = stepLen(R, L);
      metrics.stepLR = stepLen(L, R);
      if (R.length && L.length) metrics.phaseOffset = ((((L[0].t - R[0].t) / len) % 1) + 1) % 1;
      // support pattern
      const fr = feet.find((f) => f.side === 'right'), fl = feet.find((f) => f.side === 'left');
      if (fr && fl) {
        let dbl = 0, fly = 0;
        const n = loop ? N : N + 1;
        for (let i = 0; i < n; i++) {
          const a = fr.low[i] <= h, b = fl.low[i] <= h;
          if (a && b) dbl++;
          if (!a && !b) fly++;
        }
        metrics.doubleSupport = dbl / n;
        metrics.flight = fly / n;
      }
    }
  }

  // ---------------------------------------------------------------- seam
  if (loop && len > 0) {
    const life = len * drv.secPerUnit, dist = drv.driver === 'distance' ? len / drv.k : 0;
    const a = sampleTotals(anim, 0, ctx, life, dist);
    const b = sampleTotals(anim, len, ctx, life, dist);
    let worst = 0;
    for (const bone of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!rig.boneIndex.has(bone)) continue;
      const pa = a[bone] || { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] };
      const pb = b[bone] || { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] };
      const dr = Math.max(...[0, 1, 2].map((k) => Math.abs(wrapDeg(pb.rotation[k] - pa.rotation[k]))));
      const dp = Math.max(...[0, 1, 2].map((k) => Math.abs(pb.position[k] - pa.position[k])));
      const ds = Math.max(...[0, 1, 2].map((k) => Math.abs(pb.scale[k] - pa.scale[k])));
      worst = Math.max(worst, dr);
      if (dr > T.seam_rotation_deg || dp > T.seam_position || ds > T.seam_scale) {
        const parts = [];
        if (dr > T.seam_rotation_deg) parts.push(`rotation ${fv(pa.rotation)} -> ${fv(pb.rotation)} (Δ${f2(dr)}°)`);
        if (dp > T.seam_position) parts.push(`position ${fv(pa.position)} -> ${fv(pb.position)} (Δ${f2(dp)})`);
        if (ds > T.seam_scale) parts.push(`scale Δ${ds.toFixed(3)}`);
        add('seam', 'error', `${bone}: t=0 vs t=${len} differ: ${parts.join('; ')}`, { bone, value: dr, position: dp });
      }
    }
    metrics.seamMax = worst;
    // catmullrom tangents at the loop seam. anim.js (like the renderer) clamps the missing neighbour of the first
    // and last keyframe, so a catmullrom channel slows down at the loop point unless the motion is at rest there.
    // Compare the clamped seam velocity with the velocity a wrapped spline would have (deg per 1/60 s).
    if (N >= 1) {
      const perFrame = 1 / (drv.secPerUnit * 60);
      for (const [boneName, chans] of Object.entries(anim.bones || {})) {
        const bone = boneName.toLowerCase();
        if (!rig.boneIndex.has(bone)) continue;
        const c = chans && chans.rotation;
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const kfs = Object.keys(c).map((t) => ({ t: parseFloat(t), raw: c[t] })).sort((x, y) => x.t - y.t);
        const m = kfs.length - 1;
        if (m < 2 || Math.abs(kfs[0].t) > 1e-6 || Math.abs(kfs[m].t - len) > 1e-6) continue;
        const isCat = (k) => k.raw && typeof k.raw === 'object' && !Array.isArray(k.raw) && k.raw.lerp_mode === 'catmullrom';
        const val = (k, which) => {
          const r = k.raw && typeof k.raw === 'object' && !Array.isArray(k.raw) ? (k.raw[which] ?? k.raw.post ?? k.raw.pre) : k.raw;
          const v = Array.isArray(r) ? r : [r, r, r];
          return v.map((e) => (typeof e === 'number' ? e : NaN));
        };
        const v0 = val(kfs[0], 'post'), v1 = val(kfs[1], 'pre'), vm1 = val(kfs[m - 1], 'post'), vm = val(kfs[m], 'pre');
        const d0 = kfs[1].t - kfs[0].t, dm = kfs[m].t - kfs[m - 1].t;
        let dip = 0;
        for (let ax = 0; ax < 3; ax++) {
          if (![v0, v1, vm1, vm].every((v) => Number.isFinite(v[ax]))) continue;
          const ideal = 0.5 * (v1[ax] - vm1[ax]);
          if (isCat(kfs[0]) || isCat(kfs[1])) dip = Math.max(dip, (Math.abs(0.5 * (v1[ax] - v0[ax]) - ideal) / d0) * perFrame);
          if (isCat(kfs[m - 1]) || isCat(kfs[m])) dip = Math.max(dip, (Math.abs(0.5 * (vm[ax] - vm1[ax]) - ideal) / dm) * perFrame);
        }
        if (dip > T.seam_velocity_warn_deg_per_frame) add('seam', 'warning', `${bone}.rotation: catmullrom tangents are clamped at the loop seam, the motion hitches by ${f2(dip)}°/frame there (place the loop point where this channel is at an extreme, or keep the first/last keyframe gaps short)`, { bone, value: dip });
      }
    }
  }

  // ---------------------------------------------------------------- pops
  if (N > 0) {
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    const scale = 1 / (dtSec * 60);
    let overall = { v: 0, bone: null, t: 0 };
    for (const b of rig.bones) {
      if (!animated.has(b.name)) continue;
      let mx = 0, mt = 0, pm = 0, pt = 0;
      const warnF = [], errF = [];
      for (let i = 1; i <= N; i++) {
        const o0 = ((i - 1) * nb + b.idx) * 3, o1 = (i * nb + b.idx) * 3;
        qa.setFromEuler(eulerFromBedrock(THREE, [eul[o0], eul[o0 + 1], eul[o0 + 2]]));
        qb.setFromEuler(eulerFromBedrock(THREE, [eul[o1], eul[o1 + 1], eul[o1 + 2]]));
        const ang = 2 * Math.acos(Math.min(1, Math.abs(qa.dot(qb)))) * DEG * scale;
        if (ang > mx) { mx = ang; mt = times[i]; }
        if (ang > T.pop_error_deg_per_frame) errF.push(i); else if (ang > T.pop_warn_deg_per_frame) warnF.push(i);
        const pd = Math.hypot(pos[o1] - pos[o0], pos[o1 + 1] - pos[o0 + 1], pos[o1 + 2] - pos[o0 + 2]) * scale;
        if (pd > pm) { pm = pd; pt = times[i]; }
      }
      if (mx > overall.v) overall = { v: mx, bone: b.name, t: mt };
      if (errF.length) add('pops', 'error', `${b.name}: ${f2(mx)}°/frame (1/60 s) at ${U}=${mt.toFixed(2)}; > ${T.pop_error_deg_per_frame} at ${fmtRanges(rangesOf(errF, times), U)}`, { bone: b.name, value: mx, time: mt });
      else if (warnF.length) add('pops', 'warning', `${b.name}: ${f2(mx)}°/frame (1/60 s) at ${U}=${mt.toFixed(2)} (> ${T.pop_warn_deg_per_frame})`, { bone: b.name, value: mx, time: mt });
      if (pm > T.pop_position_warn_per_frame) add('pops', 'warning', `${b.name}: position jumps ${f2(pm)} units/frame at ${U}=${pt.toFixed(2)}`, { bone: b.name, value: pm, time: pt });
    }
    metrics.popMax = overall;
  }

  // ---------------------------------------------------------------- interpenetration
  for (const r of pen.values()) {
    add('interpen', r.severity, `${r.pair}: depth ${f2(r.depth)} (${r.bones[0]} / ${r.bones[1]}${r.rest ? `, rest ${f2(r.rest)}` : ''}) at ${U}=${r.t.toFixed(2)}; > ${minDepth} at ${fmtRanges(rangesOf(r.frames, times), U)}`, { pair: r.pair, value: r.depth, time: r.t, bones: r.bones, ranges: rangesOf(r.frames, times) });
  }
  return { issues, metrics };
}

export function analyzeAnimation(rig, cfg, rec, cli) {
  const opt = animOptions(cfg, rec.name);
  const drv = driverOf(rec, opt, cfg);
  const issues = [];
  structureChecks(rig, rec, opt, drv, (check, severity, message, extra = {}) => { if (cli.checks.has(check)) issues.push({ check, severity, message, ...extra }); });
  const variants = opt.sweep && opt.sweep.length ? opt.sweep : [null];
  let metrics = null;
  for (const v of variants) {
    const r = runVariant(rig, cfg, rec, opt, drv, v, cli);
    const label = v ? ' [' + Object.entries(v).map(([k, x]) => `${k.replace(/^query\./, 'q.').replace(/^variable\./, 'v.')}=${x}`).join(' ') + ']' : '';
    for (const i of r.issues) issues.push(label ? { ...i, variant: v, message: i.message + label } : i);
    metrics ||= r.metrics;
  }
  // collapse identical messages from several sweep variants
  const len = animationLength(rec.anim);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return {
    name: rec.name, file: rel(rec.file), loop: rec.anim.loop === true ? true : rec.anim.loop ?? false, length: len,
    driver: drv.driver, timePerBlock: drv.driver === 'distance' ? drv.k : undefined, speedBlocksPerSecond: drv.driver === 'distance' ? drv.speed : undefined,
    airborne: !!opt.airborne, additive: !!opt.additive, variants: variants.length,
    errors, warnings, metrics, pass: errors.length === 0,
  };
}

// ------------------------------------------------------------------------------------------------ pose mode
export function poseReport(rig, cfg, rec, t, cli) {
  let totals = {};
  let unit = 't';
  if (rec) {
    const opt = animOptions(cfg, rec.name);
    const drv = driverOf(rec, opt, cfg);
    unit = drv.unit;
    const ctx = makeCtx(opt, cli.query, null);
    totals = sampleTotals(rec.anim, t, ctx, t * drv.secPerUnit, drv.driver === 'distance' ? t / drv.k : 0);
  }
  rig.pose(totals);
  const bones = rig.bones.map((b) => {
    const tt = totals[b.name];
    return {
      bone: b.name, parent: b.parent,
      pivot: rig.bonePivotWorld(b.name),
      rotation: [0, 1, 2].map((k) => b.entry.restRot[k] + (tt && tt.rotation ? tt.rotation[k] : 0)),
      position: tt && tt.position ? tt.position : [0, 0, 0],
    };
  });
  const locators = [...rig.model.locators.keys()].map((l) => ({ locator: l, position: rig.locatorWorld(l) }));
  const feet = {};
  for (const f of Object.values(rig.feet)) {
    let by = Infinity, bp = null;
    const h = cfg.T.foot_planted_height;
    let cx = 0, cz = 0, n = 0;
    for (const i of f.cubes) for (let k = 0; k < 8; k++) {
      const o = i * 24 + k * 3;
      const p = [rig.corners[o], rig.corners[o + 1], rig.corners[o + 2]];
      if (p[1] < by) { by = p[1]; bp = p; }
      if (p[1] <= h) { cx += p[0]; cz += p[2]; n++; }
    }
    const footBone = `foot_${f.side}`;
    const hipBone = `leg_${f.side}_upper`;
    const fb = rig.boneIndex.has(footBone) ? rig.bonePivotWorld(footBone) : null;
    const hb = rig.boneIndex.has(hipBone) ? rig.bonePivotWorld(hipBone) : null;
    feet[f.side] = {
      lowest: bp, planted: by <= h, contactCentroid: n ? [cx / n, 0, cz / n] : null,
      ankle: fb, hip: hb, ankleRelHip: fb && hb ? [fb[0] - hb[0], fb[1] - hb[1], fb[2] - hb[2]] : null,
    };
  }
  const lo = rig.lowest();
  return { animation: rec ? rec.name : 'none (rest pose)', t, unit, bones, locators, feet, lowest: { y: lo.y, bone: lo.bone } };
}

function printPose(p) {
  const out = [];
  out.push(`pose ${p.animation} @ ${p.unit}=${p.t}   (file space units: +Y up, ground y=0, -Z = creature's front, -X = creature's RIGHT)`);
  out.push('bone                 pivot (world)                 local rotation (rest+anim)      position offset');
  for (const b of p.bones) out.push(`${b.bone.padEnd(20)} ${fv(b.pivot).padEnd(29)} ${fv(b.rotation).padEnd(31)} ${fv(b.position)}`);
  out.push('locators');
  for (const l of p.locators) out.push(`  ${l.locator.padEnd(18)} ${fv(l.position)}`);
  out.push('feet');
  for (const [side, f] of Object.entries(p.feet)) {
    out.push(`  ${side.padEnd(6)} lowest point ${fv(f.lowest)}${f.planted ? ' (planted)' : ''}${f.contactCentroid ? `  contact centroid ${fv(f.contactCentroid)}` : ''}`);
    if (f.ankle) out.push(`         ankle pivot ${fv(f.ankle)}  hip pivot ${fv(f.hip)}  ankle rel hip ${fv(f.ankleRelHip)}`);
  }
  out.push(`lowest point of the model: y = ${f2(p.lowest.y)} (${p.lowest.bone})`);
  return out.join('\n');
}

// ------------------------------------------------------------------------------------------------ report
function printReport(rep, verbose) {
  const L = [];
  L.push(`Shaftbreaker animation check: geometry ${rep.geometry.file} (${rep.geometry.bones} bones, ${rep.geometry.cubes} cubes), limits ${rep.limits}, ${rep.fps} fps`);
  L.push('');
  L.push('[geometry] rest pose');
  const g = rep.geometry;
  L.push(`  lowest point y = ${f2(g.restLowest.y)} (${g.restLowest.bone}); ${g.pairs} group pairs tested for interpenetration, ${g.adjacent.length} adjacent pairs skipped`);
  for (const i of g.errors) L.push(`  ERROR ${i.check.padEnd(9)} ${i.message}`);
  for (const i of g.warnings) L.push(`  WARN  ${i.check.padEnd(9)} ${i.message}`);
  if (verbose) for (const i of g.info) L.push(`  info  ${i}`);
  for (const a of rep.animations) {
    L.push('');
    L.push(`[${a.name}]  ${a.file}`);
    const m = a.metrics || {};
    const drvTxt = a.driver === 'distance'
      ? `distance-driven (anim time = ${a.timePerBlock === 1 ? '' : a.timePerBlock + ' × '}blocks moved; length ${a.length} = ${f2(m.stride ? m.stride.blocks : a.length)} blocks/cycle ≈ ${f2(m.stride ? m.stride.seconds : 0)} s at ${a.speedBlocksPerSecond} b/s)`
      : `time-driven (length ${a.length} s)`;
    L.push(`  ${a.loop === true ? 'loop' : a.loop === 'hold_on_last_frame' ? 'hold_on_last_frame' : 'one-shot'}, ${drvTxt}, ${m.frames || 0} frames${a.variants > 1 ? ` × ${a.variants} query variants` : ''}${a.airborne ? ', airborne allowed' : ''}${a.additive ? ', additive' : ''}`);
    for (const i of a.errors) L.push(`  ERROR ${i.check.padEnd(9)} ${i.message}`);
    for (const i of a.warnings) L.push(`  WARN  ${i.check.padEnd(9)} ${i.message}`);
    // metrics
    const parts = [];
    if (m.ground) parts.push(`ground lowest y ${f2(m.ground.min)}…${f2(m.ground.max)}`);
    if (m.popMax && m.popMax.bone) parts.push(`max ang. speed ${f2(m.popMax.v)}°/frame (${m.popMax.bone})`);
    if (m.seamMax !== undefined) parts.push(`seam Δ ${f2(m.seamMax)}°`);
    if (parts.length) L.push(`  metrics: ${parts.join('; ')}`);
    if (m.feet) {
      for (const [side, f] of Object.entries(m.feet)) {
        let s = `  foot ${side.padEnd(5)} planted ${(f.planted * 100).toFixed(0)}% (${f.contacts} contact${f.contacts === 1 ? '' : 's'}), stance ${f2(f.stance)} u, swing clearance ${f2(f.clearance)} u`;
        if (a.driver === 'distance') s += f.speedErrMean !== null && f.speedErrMean !== undefined ? `, ground-speed error mean ${(f.speedErrMean * 100).toFixed(1)}% max ${(f.speedErrMax * 100).toFixed(0)}%, slip ${f2(f.slip)} u: ${f.pass ? 'PASS' : 'FAIL'}` : ', never planted: FAIL';
        else s += `, max drift while planted ${f2(f.slide)} u${f.steps && f.steps.length ? `, step(s) ${f.steps.map(f2).join(', ')} u` : ''}`;
        if (verbose) s += `  touchdowns ${f.touchdowns.map((x) => x.toFixed(2)).join(',') || '-'} liftoffs ${f.liftoffs.map((x) => x.toFixed(2)).join(',') || '-'}`;
        L.push(s);
      }
      if (m.stride) L.push(`  stride ${f2(m.stride.units)} u = ${f2(m.stride.blocks)} blocks per cycle; step R→L ${m.stepRL != null ? f2(m.stepRL) : '-'} u, L→R ${m.stepLR != null ? f2(m.stepLR) : '-'} u; phase offset L-R ${m.phaseOffset != null ? m.phaseOffset.toFixed(2) : '-'}; double support ${m.doubleSupport != null ? (m.doubleSupport * 100).toFixed(0) + '%' : '-'}, flight ${m.flight != null ? (m.flight * 100).toFixed(0) + '%' : '-'}`);
    }
    L.push(`  RESULT ${a.pass ? 'PASS' : 'FAIL'} (${a.errors.length} error${a.errors.length === 1 ? '' : 's'}, ${a.warnings.length} warning${a.warnings.length === 1 ? '' : 's'})`);
  }
  L.push('');
  const nf = rep.animations.filter((a) => !a.pass).length;
  const nw = rep.animations.reduce((s, a) => s + a.warnings.length, 0) + rep.geometry.warnings.length;
  L.push(`SUMMARY: ${rep.animations.length} animation(s), ${rep.animations.length - nf} pass, ${nf} fail, ${rep.errorCount} error(s), ${nw} warning(s): ${rep.pass ? 'PASS' : 'FAIL'}`);
  return L.join('\n');
}

// ------------------------------------------------------------------------------------------------ main
function findAnim(recs, want) {
  const w = want.toLowerCase();
  return recs.find((r) => r.name.toLowerCase() === w) || recs.find((r) => r.name.toLowerCase() === `animation.shaftbreaker.${w}`) || recs.find((r) => r.name.toLowerCase().endsWith('.' + w));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return 0;
  }
  const limitsPath = resolvePath(args.limits || 'tools/joint_limits.json');
  const cfg = loadConfig(limitsPath);
  const geoPath = resolvePath(args.geo || cfg.geometry || 'Shaftbreaker_RP/models/entity/shaftbreaker.geo.json');
  if (!fs.existsSync(geoPath)) throw new Error(`geometry not found: ${geoPath}`);
  const t0 = Date.now();
  const rig = new Rig(JSON.parse(fs.readFileSync(geoPath, 'utf8')), cfg);
  const cli = {
    fps: args.fps ? Number(args.fps) : 60,
    query: kvArg(args.query),
    checks: new Set(args.checks ? listArg(args.checks) : CHECKS),
  };
  for (const c of cli.checks) if (!CHECKS.includes(c)) throw new Error(`unknown check "${c}" (use ${CHECKS.join(',')})`);
  // animation files
  let files = listArg(args.file).map(resolvePath);
  if (!files.length) {
    const dir = resolvePath(cfg.animations_dir || 'Shaftbreaker_RP/animations');
    files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f)) : [];
  }
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`animation file not found: ${f}`);
  const recs = loadAnimationFiles(files);

  if (args.pose !== undefined) {
    const name = args.pose === true ? 'none' : String(args.pose);
    const rec = name === 'none' ? null : findAnim(recs, name);
    if (name !== 'none' && !rec) throw new Error(`animation "${name}" not found (have: ${recs.map((r) => r.name).join(', ') || 'none'})`);
    const p = poseReport(rig, cfg, rec, Number(args.t || 0), cli);
    console.log(args.json ? JSON.stringify(p, null, 2) : printPose(p));
    return 0;
  }

  let selected = recs;
  const wanted = listArg(args.anim);
  if (wanted.length) {
    selected = [];
    for (const w of wanted) {
      const r = findAnim(recs, w);
      if (!r) throw new Error(`animation "${w}" not found (have: ${recs.map((x) => x.name).join(', ') || 'none'})`);
      selected.push(r);
    }
  }
  // geometry section
  const geoIssues = { errors: [], warnings: [], info: [] };
  const gl = rig.restLowest;
  if (gl.y < cfg.T.ground_sink_below || gl.y > cfg.T.ground_float_above) geoIssues.errors.push({ check: 'ground', severity: 'error', message: `rest pose lowest point y = ${f2(gl.y)} (${gl.bone}); the model must stand on y = 0` });
  if (cli.checks.has('interpen')) for (const o of rig.restOverlaps) {
    const pr = rig.pairs.find((p) => p.key === o.pair);
    if (o.depth > cfg.T.penetration_min_depth) geoIssues.warnings.push({ check: 'interpen', severity: 'warning', message: `rest-pose overlap ${o.pair}: depth ${f2(o.depth)} (${o.bones[0]} / ${o.bones[1]}); used as baseline${pr && pr.severity === 'warning' ? '' : ' (modelling overlap between non-adjacent parts)'}` });
  }
  const noLimit = rig.bones.filter((b) => !b.limits && b.name !== 'root').map((b) => b.name);
  if (noLimit.length) geoIssues.info.push(`bones without joint limits: ${noLimit.join(', ')}`);
  if (rig.unconfiguredGroups.length) geoIssues.info.push(`bones with cubes outside the configured groups (own group): ${rig.unconfiguredGroups.join(', ')}`);
  geoIssues.info.push(`adjacent (skipped) group pairs: ${rig.adjacent.join(', ')}`);
  for (const side of Object.keys(cfg.feet || {})) if (!rig.feet[side]) geoIssues.warnings.push({ check: 'feet', severity: 'warning', message: `no cubes for foot "${side}"` });

  const results = selected.map((r) => analyzeAnimation(rig, cfg, r, cli));
  const errorCount = geoIssues.errors.length + results.reduce((s, a) => s + a.errors.length, 0);
  const rep = {
    geometry: { file: rel(geoPath), bones: rig.bones.length, cubes: rig.cubes.length, restLowest: rig.restLowest, pairs: rig.pairs.length, adjacent: rig.adjacent, restOverlaps: rig.restOverlaps, ...geoIssues },
    limits: rel(limitsPath), fps: cli.fps, files: files.map(rel), animations: results, errorCount, pass: errorCount === 0, seconds: (Date.now() - t0) / 1000,
  };
  if (!recs.length && !args.json) console.log(`(no animation files found${files.length ? '' : ` in ${cfg.animations_dir}`}; only the geometry was checked)`);
  console.log(args.json ? JSON.stringify(rep, null, 2) : printReport(rep, !!args.verbose) + `\n(${rep.seconds.toFixed(1)} s)`);
  return rep.pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => { console.error('check_anims: ' + (e && e.message ? e.message : e)); process.exit(2); });
}
