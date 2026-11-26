// Shin Godzilla add-on: beams, the smoke-and-fire pour, and the light show on his back.
import { ANCHORS } from "./anchors.js";
import {
  S, add, sub, mul, len, norm, dist, clamp, rand, D2R, toWorld, particle, share, dirVars, sized, wide, sound,
  groundY, canGrief, igniteAt, hurt, victims, light, isLiving, KAIJU, center,
} from "./lib.js";

const A4 = ANCHORS.f4;
export const ORANGE = [1.0, 0.5, 0.12], WHITE = [1.0, 0.95, 0.8], MAGENTA = [1.0, 0.22, 0.72], VIOLET = [0.66, 0.34, 1.0], CRIMSON = [1.0, 0.16, 0.2];
export const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function beamVars(d, length, width, col) {
  return dirVars(d, { len: length, width, cr: col[0], cg: col[1], cb: col[2] });
}

/**
 * The atomic beam: long quads laid end to end from `o` along `d` for `l` blocks, in three
 * layers (glow, plasma sheath, white core).  `W` is the half-width of the sheath in blocks.
 * The beam leaves the mouth narrow and opens to full width over the first fourteen blocks.
 */
export function drawBeam(dim, o, d, l, W, t, col = VIOLET, landed = false) {
  const pulse = 1 + 0.12 * Math.sin(t * 1.25);
  let s = 0;
  while (s < l - 0.01) {
    // three short steps out of the mouth (hidden in its flare), then long full-width runs
    const seg = Math.min(l - s, s < 6 ? 6 : s < 14 ? 8 : s < 38 ? 24 : 44);
    const w = W * pulse * (s < 6 ? 0.62 : s < 14 ? 0.82 : 1);
    const at = add(o, mul(d, s));
    const v = beamVars(d, seg, w, col);
    particle(dim, "sg:beam_glow", at, v);
    particle(dim, "sg:beam_halo", at, v);
    particle(dim, "sg:beam_core", at, v);
    s += seg;
  }
  const v = beamVars(d, l, W, col);
  particle(dim, "sg:beam_pulse", o, v);
  if (t % 2 === 0) {
    particle(dim, "sg:mouth_burst", o, v);
    particle(dim, "sg:beam_sparks", o, v);
  }
  if (t % 4 === 1) particle(dim, "sg:mouth_star", o, v);
  if (t % 5 === 0) particle(dim, "sg:beam_ring", o, v);
  if (t % 3 === 1) particle(dim, "sg:beam_bolt", o, v);
  if (t % 4 === 3 && share(1)) particle(dim, "sg:beam_wisp", o, v);
  void landed;
}

/** A thin ray (dorsal plates, the tail): the same beam in two layers and a single reach. */
export function drawRay(dim, o, d, l, W, t, col = VIOLET) {
  let s = 0;
  while (s < l - 0.01) {
    const seg = Math.min(l - s, 56);
    const at = add(o, mul(d, s));
    const v = beamVars(d, seg, W, col);
    particle(dim, "sg:beam_halo", at, v);
    particle(dim, "sg:beam_core", at, v);
    if (t % 2 === 0) particle(dim, "sg:beam_glow", at, v);
    s += seg;
  }
  if (t % 3 === 0) particle(dim, "sg:mouth_burst", o, beamVars(d, l, W * 1.4, col));
}

/** Where a beam lands: a boiling blast, a glare, rings across the ground, a fountain of sparks, smoke. */
export function impactFx(dim, p, t, size, heavy = true) {
  if (t % 3 === 0) particle(dim, "sg:impact_blast", p, sized(size));
  if (t % 4 === 2) particle(dim, "sg:impact_glare", p, sized(size));
  if (!heavy) return;
  if (t % 10 === 5) particle(dim, "sg:impact_ring", p, sized(size));
  if (t % 8 === 1) particle(dim, "sg:impact_fountain", p);
  if (t % 6 === 3 && share(1)) particle(dim, "sg:impact_smoke", p, sized(size));
  if (t % 7 === 0) particle(dim, "sg:impact_fire", p, sized(size * 0.8));
  if (t % 3 === 0) light(dim, { x: p.x, y: p.y + 2, z: p.z }, 12);
}

// ------------------------------------------------------------------ the pour
/** Where the stream from the mouth meets the ground in front of him (the centre of the flood). */
export function pourOrigin(dim, mouth, d, fallbackY) {
  const flat = norm({ x: d.x, y: 0, z: d.z });
  // the ray from the mouth, or straight down from a point ahead if it meets nothing
  let p;
  try {
    const hit = dim.getBlockFromRay(mouth, d, { maxDistance: 110, includeLiquidBlocks: true, includePassableBlocks: false });
    if (hit) p = { x: hit.block.location.x + 0.5, y: hit.block.location.y + 1, z: hit.block.location.z + 0.5 };
  } catch { /* ignore */ }
  if (!p) {
    const ahead = add(mouth, mul(flat, 24));
    p = { x: ahead.x, y: groundY(dim, ahead.x, ahead.z, mouth.y, 90) ?? fallbackY, z: ahead.z };
  }
  return { at: p, heading: Math.atan2(-flat.x, flat.z) / D2R };
}

function fan(origin, heading, r, i, n) {
  // most of the points ride the advancing front, the rest fill in behind it
  const a = (heading + (Math.random() - 0.5) * 124) * D2R;
  const d = r * (i < n * 0.62 ? 0.7 + 0.3 * Math.random() : Math.random());
  return { x: origin.x - Math.sin(a) * d, z: origin.z + Math.cos(a) * d, out: { x: -Math.sin(a), y: 0, z: Math.cos(a) } };
}

/** Black smoke rolling out across the ground from where the stream lands. */
export function soot(dim, origin, heading, r, t, width, amount = 1) {
  const n = share((t % 2 === 0 ? 3 : 1) * amount);
  for (let i = 0; i < n; i++) {
    const f = fan(origin, heading, r, i, n);
    const g = groundY(dim, f.x, f.z, origin.y + 12, 30);
    if (g === undefined) continue;
    const at = { x: f.x, y: g + width * 0.35, z: f.z };
    particle(dim, "sg:soot_billow", at, wide(width, f.out));
    if (i === 0 && t % 3 === 0) particle(dim, "sg:soot_ember", at, wide(width, f.out));
  }
}

/** The fire that follows it: rolling flame, tall tongues, embers, and the ground left burning. */
export function flood(e, origin, heading, r, t, width, amount = 1, burn = true) {
  const dim = e.dimension;
  const n = share((t % 2 === 0 ? 4 : 2) * amount);
  for (let i = 0; i < n; i++) {
    const f = fan(origin, heading, r, i, n);
    const g = groundY(dim, f.x, f.z, origin.y + 12, 30);
    if (g === undefined) continue;
    const at = { x: f.x, y: g + width * 0.3, z: f.z };
    particle(dim, "sg:flood_fire", at, wide(width, f.out));
    if (i % 2 === 0) particle(dim, "sg:flood_flame", { x: f.x, y: g + 0.2, z: f.z }, wide(width, f.out));
    if (i % 3 === 0) particle(dim, "sg:flood_ember", { x: f.x, y: g + 0.5, z: f.z }, wide(width, f.out));
    if (i === 0 && t % 4 === 0) particle(dim, "sg:flood_smoke", { x: f.x, y: g + width, z: f.z }, wide(width, f.out));
    if (burn && i < 2 && t % 2 === 0 && Math.random() < 0.6) igniteAt(dim, f.x, g, f.z);
    if (i === 0 && t % 5 === 0) light(dim, { x: f.x, y: g + 2, z: f.z }, 14);
  }
  if (!burn || t % 5 !== 0) return;
  // anything standing in the fan of fire
  for (const en of victims(e, origin, r + 3)) {
    const dx = en.location.x - origin.x, dz = en.location.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > r + 2 || Math.abs(en.location.y - origin.y) > 14) continue;
    if (d > 5) {
      const b = Math.atan2(-dx, dz) / D2R;
      let off = (b - heading + 540) % 360 - 180;
      if (Math.abs(off) > 66) continue;
    }
    hurt(en, 7, e, 6, 0.0025);
  }
}

// ------------------------------------------------------------------ the light show
const SURGE = A4.surge;                       // centre plate tips, tail's end -> nape (charge pose)

/** One step of the light that runs from the tip of the tail, up the back, to the nape (k = 0..1). */
export function surgeAt(e, sc, k, size) {
  const n = SURGE.length;
  const i = Math.floor(clamp(k, 0, 0.999) * n);
  const v = sized(size);
  for (let j = 0; j < 3 && i + j < n; j++) particle(e.dimension, "sg:surge", toWorld(e, SURGE[i + j], sc), v);
}
export function surgeAll(e, sc, size) {
  for (let i = 0; i < SURGE.length; i += 2) particle(e.dimension, "sg:surge", toWorld(e, SURGE[i], sc), sized(size));
}

/** A lightning bolt between two points (two jagged halves through a displaced middle). */
export function bolt(dim, a, b, jitter) {
  const mid = add(mul(add(a, b), 0.5), { x: rand(-jitter, jitter), y: rand(-jitter * 0.4, jitter), z: rand(-jitter, jitter) });
  for (const [p, q] of [[a, mid], [mid, b]]) {
    const d = sub(q, p), l = len(d);
    if (l < 0.4) continue;
    particle(dim, "sg:arc", p, dirVars(norm(d), { len: l }));
  }
}

/** Lightning crawling between the dorsal plates. */
export function arcs(e, sc, count) {
  const pts = A4.dorsal, dim = e.dimension;
  for (let c = 0; c < count; c++) {
    const i = Math.floor(Math.random() * pts.length);
    const j = clamp(i + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3)), 0, pts.length - 1);
    if (i === j) continue;
    bolt(dim, toWorld(e, pts[i], sc), toWorld(e, pts[j], sc), 1.6 * sc);
  }
}

/** Lightning striking out from the plates to the ground around him. */
export function groundStrike(e, sc) {
  const dim = e.dimension, pts = A4.dorsal;
  const from = toWorld(e, pts[Math.floor(Math.random() * pts.length)], sc);
  const a = Math.random() * 360 * D2R, r = rand(14, 34) * sc;
  const x = e.location.x + Math.cos(a) * r, z = e.location.z + Math.sin(a) * r;
  const g = groundY(dim, x, z, e.location.y + 20 * sc, 60);
  if (g === undefined) return;
  const to = { x, y: g, z };
  const mid = add(mul(add(from, to), 0.5), { x: rand(-5, 5) * sc, y: rand(2, 8) * sc, z: rand(-5, 5) * sc });
  bolt(dim, from, mid, 3 * sc);
  bolt(dim, mid, to, 3 * sc);
  particle(dim, "sg:impact_glare", to, sized(2.2 * sc + 0.6));
  particle(dim, "sg:impact_fountain", to);
  if (Math.random() < 0.35) sound(dim, "sg.surge", to, 96, 1, rand(0.85, 1.2));
  if (canGrief() && Math.random() < 0.35) igniteAt(dim, x, g, z);
  for (const en of victims(e, to, 3.5 * sc + 1)) hurt(en, 6, e, 3);
}

export function dorsalSparks(e, sc) {
  const pts = A4.dorsal;
  for (let i = 0; i < 3; i++) particle(e.dimension, "sg:dorsal_glow", toWorld(e, pts[Math.floor(Math.random() * pts.length)], sc));
}
export function dorsalPoints(e, sc) {
  return A4.dorsal.map((p) => toWorld(e, p, sc));
}
export function haze(e, sc) {
  const pts = A4.dorsal;
  particle(e.dimension, "sg:haze", toWorld(e, pts[Math.floor(Math.random() * pts.length)], sc), sized(16 * sc + 4));
}

/** Things in the air (or simply high up) that the plates should swat. */
const FLYERS = new Set(["minecraft:phantom", "minecraft:ghast", "minecraft:happy_ghast", "minecraft:blaze", "minecraft:vex",
  "minecraft:breeze", "minecraft:wither", "minecraft:ender_dragon"]);
export function airborneTargets(e, sc, picky) {
  const out = [];
  const R = 96 * Math.max(sc, 0.5);
  let ents = [];
  try { ents = e.dimension.getEntities({ location: e.location, maxDistance: R }); } catch { return out; }
  for (const en of ents) {
    if (KAIJU.has(en.typeId) || !isLiving(en)) continue;
    if (en.typeId === "minecraft:player") {
      let gm = "";
      try { gm = String(en.getGameMode()).toLowerCase(); } catch { /* ignore */ }
      if (gm === "creative" || gm === "spectator") continue;
    }
    const high = en.location.y - e.location.y > 10 * sc && (!picky || picky(en));
    if (high || FLYERS.has(en.typeId)) out.push(en);
  }
  return out.slice(0, 8);
}
void center; void S; void dist;
