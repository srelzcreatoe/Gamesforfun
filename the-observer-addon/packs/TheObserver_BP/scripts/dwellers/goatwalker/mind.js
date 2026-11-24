// @ts-nocheck
// =============================================================================
//  THE GOATWALKER  -  his mind: what he remembers about you, and what he learns
//
//  Everything here is per player and persists (player dynamic property gw:mind).
//   * habits     where you spend your time (home, caves, travel, his woods), and when
//   * routes     the ground you cross again and again
//   * escapes    light, water, staring, the Lens, hitting him, running, breaking through, flares:
//                each use that works is remembered; on the third he has adapted to it
//   * nodes      the passages you escape through (he will wait there)
//   * rooms      the rooms you hide in (he gains confidence before he lays siege)
//   * fighting   how you fight ordinary monsters (backpedal, strafe, press, ranged, high ground)
// =============================================================================
import { world } from "@minecraft/server";
import { V, now, safe, clamp, chance, dayIndex, key2, isNight, STATE } from "./core.js";

export const ESCAPES = ["light", "water", "stare", "lens", "hit", "run", "break", "flare"];
export const ADAPT_AT = 3;
const TELL = {
  light: "§8Your light does not frighten it anymore.",
  water: "§8It is no longer afraid of the water.",
  stare: "§8Staring will not hold it again.",
  lens: "§8It has learned what the Lens does.",
  hit: "§8It does not flinch from your blows anymore.",
  run: "§8It knows you will run.",
  break: "§8It knows you dig your way out.",
  flare: "§8Your flares do not scare it now.",
};

function fresh() {
  return {
    v: 2,
    hab: { cave: 0, home: 0, travel: 0, woods: 0, night: 0, day: 0, total: 0 },
    tod: [0, 0, 0, 0, 0, 0],
    cells: {},          // 16-block cells -> seconds spent
    routes: {},         // 8-block cells -> times crossed
    esc: Object.fromEntries(ESCAPES.map((k) => [k, 0])),
    escDay: {},
    told: {},
    stares: 0, look: 0.3, shots: 0, outruns: 0, hits: 0, charges: 0, sneaks: 0, bluffs: 0,
    nodes: [],          // escape passages {x,y,z,n,d}
    rooms: [],          // hiding rooms {x,y,z,n,c,d}
    fight: { back: 0, strafe: 0, press: 0, ranged: 0, high: 0 },
    group: { stand: 0, scatter: 0 },
    day: dayIndex(),
  };
}

/** The mind lives on the player's runtime state; loaded lazily. */
export function mind(p) {
  const s = STATE.get(p.id);
  if (s && s.mind) return s.mind;
  let M = fresh();
  const raw = safe(() => p.getDynamicProperty("gw:mind"));
  if (typeof raw === "string") {
    const o = safe(() => JSON.parse(raw), null);
    if (o && o.v === 2) M = Object.assign(fresh(), o, { esc: Object.assign(fresh().esc, o.esc || {}), escDay: o.escDay || {}, fight: Object.assign(fresh().fight, o.fight || {}) });
  }
  if (s) s.mind = M;
  return M;
}
export function saveMind(p, M) {
  // keep it small: trim the maps before writing
  trimMap(M.cells, 24);
  trimMap(M.routes, 80);
  M.nodes = M.nodes.filter((n) => n.n > 0.3).sort((a, b) => b.n - a.n).slice(0, 12);
  M.rooms = M.rooms.filter((r) => r.c > 0.3 || r.n > 0.5).sort((a, b) => b.c - a.c).slice(0, 10);
  const round = (o) => { for (const k in o) if (typeof o[k] === "number") o[k] = Math.round(o[k] * 100) / 100; };
  round(M.hab); round(M.esc); round(M.fight);
  safe(() => p.setDynamicProperty("gw:mind", JSON.stringify(M)));
}
function trimMap(m, n) {
  const ks = Object.keys(m);
  if (ks.length <= n) return;
  ks.sort((a, b) => m[b] - m[a]);
  for (const k of ks.slice(n)) delete m[k];
}

// ----------------------------------------------------------------- daily forgetting
export function dailyDecay(M) {
  const d = dayIndex();
  if (d === M.day) return;
  const days = clamp(d - M.day, 1, 10);
  M.day = d;
  for (const k of Object.keys(M.hab)) M.hab[k] *= Math.pow(0.85, days);
  for (let i = 0; i < 6; i++) M.tod[i] *= Math.pow(0.85, days);
  for (const k of Object.keys(M.cells)) { M.cells[k] *= Math.pow(0.9, days); if (M.cells[k] < 5) delete M.cells[k]; }
  for (const k of Object.keys(M.routes)) { M.routes[k] *= Math.pow(0.9, days); if (M.routes[k] < 0.5) delete M.routes[k]; }
  // a trick left unused for a long while slowly stops being "known" (counterplay: let it rest)
  for (const k of ESCAPES) {
    const idle = d - (M.escDay[k] ?? d);
    if (idle >= 5) M.esc[k] = Math.max(0, M.esc[k] - 0.25 * days);
    if (M.esc[k] < ADAPT_AT) delete M.told[k];
  }
  M.charges = (M.charges || 0) * Math.pow(0.85, days);   // he forgets, slowly, how often you rushed him
  M.sneaks = (M.sneaks || 0) * Math.pow(0.85, days);     // ... and crept up on him
  M.bluffs = Math.max(0, (M.bluffs || 0) - 0.5 * days);  // ... and how many times he has bluffed you (so he can again)
  for (const n of M.nodes) n.n -= 0.15 * days;           // escape routes you stop using fade
  for (const r of M.rooms) { r.c -= 0.1 * days; r.n -= 0.1 * days; }
}

// ----------------------------------------------------------------- habits (called once a second)
export function observe(p, s, M) {
  const loc = p.location;
  const home = homeOf(p, M);
  const atHome = !!home && V.dist(home, loc) < 28;
  const moving = s.lastLoc ? V.distH(loc, s.lastLoc) : 0;
  s.lastLoc = { x: loc.x, y: loc.y, z: loc.z };
  const H = M.hab;
  H.total += 1;
  if (s.under) H.cave += 1;
  else if (atHome) H.home += 1;
  if (!atHome && moving > 3 && !s.under) H.travel += 1;
  if (s.domain === "stellar") H.woods += 1;
  if (isNight()) H.night += 1; else H.day += 1;
  const t = world.getTimeOfDay();
  M.tod[Math.floor(t / 4000) % 6] += 1;
  if (moving < 1.5) {
    const k = key2(loc, 16);
    M.cells[k] = (M.cells[k] || 0) + 1;
  }
  // routes: count each 8-block cell once per crossing
  const rk = key2(loc, 8);
  if (moving > 1.2 && rk !== s.routeCell) {
    s.routeCell = rk;
    M.routes[rk] = (M.routes[rk] || 0) + 1;
  }
}
/** Fractions of play time: where and when this player spends it. */
export function habits(M) {
  const H = M.hab, T = Math.max(60, H.total);
  return { cave: H.cave / T, home: H.home / T, travel: H.travel / T, woods: H.woods / T,
    night: H.night / Math.max(1, H.night + H.day), seasoned: H.total > 1800 };
}
/** Is now one of the times this player usually plays? (0..1) */
export function usualHour(M) {
  const tot = M.tod.reduce((a, b) => a + b, 0) || 1;
  return M.tod[Math.floor(world.getTimeOfDay() / 4000) % 6] / tot * 6 / 2;     // 0.5 = average
}
export function homeOf(p, M) {
  const sp = safe(() => p.getSpawnPoint());
  if (sp && sp.dimension.id === p.dimension.id) return { x: sp.x + 0.5, y: sp.y, z: sp.z + 0.5 };
  let best = null, bw = 120;
  for (const [k, w] of Object.entries(M.cells)) if (w > bw) { bw = w; best = k; }
  if (!best) return null;
  const [x, z] = best.split(",").map(Number);
  return { x: x * 16 + 8, y: p.location.y, z: z * 16 + 8 };
}
/** A cell you cross often, ahead of you along your heading, `min..max` blocks away. */
export function routeAhead(p, M, min = 24, max = 48) {
  const loc = p.location;
  const head = V.normH(p.getViewDirection());
  let best = null, bs = 0;
  for (const [k, n] of Object.entries(M.routes)) {
    if (n < 3) continue;
    const [x, z] = k.split(",").map(Number);
    const c = { x: x * 8 + 4, y: loc.y, z: z * 8 + 4 };
    const d = V.distH(c, loc);
    if (d < min || d > max) continue;
    const ahead = V.dot(V.normH(V.sub(c, loc)), head);
    const sc = n * (0.5 + ahead);
    if (ahead > 0.2 && sc > bs) { bs = sc; best = c; }
  }
  return best;
}

// ----------------------------------------------------------------- escapes
export function adapted(M, kind) { return (M.esc[kind] || 0) >= ADAPT_AT; }
/** An escape worked.  Returns true if this use just taught him. */
export function escapeUsed(p, M, kind, s) {
  if (s) {
    s.escUsed = s.escUsed || {};
    if (s.escUsed[kind] === s.encId) return false;     // count each trick once per encounter
    s.escUsed[kind] = s.encId;
  }
  const before = M.esc[kind] || 0;
  M.esc[kind] = Math.round(before) + 1;
  M.escDay[kind] = dayIndex();
  if (before < ADAPT_AT && M.esc[kind] >= ADAPT_AT && !M.told[kind]) {
    M.told[kind] = true;
    const msg = TELL[kind];
    // said later, quietly, once it is over
    if (s) s.tellLater = (s.tellLater || []).concat([msg]);
    return true;
  }
  return false;
}
/** Seconds of being stared at before he snaps (shrinks every time you stare him down). */
export function snapAt(M) { return clamp(4.2 - 0.55 * M.stares, 1.2, 4.2); }
/** How far he creeps each time you look away (grows the more you look away). */
export function creepStep(M) { return 3 + 6 * clamp(M.look, 0, 1); }
/** How far away he starts a pursuit (closer each time you outran him). */
export function startDist(M) { return Math.max(6, 14 - 2 * Math.min(M.outruns, 4)); }
/** How strongly he prefers cover (grows each time you shoot him). */
export function coverBias(M) { return clamp(M.shots / 3, 0, 1); }
export function noteLook(M, lookingAway) { M.look = M.look * 0.985 + (lookingAway ? 0.015 : 0); }

// ----------------------------------------------------------------- escape passages ("he waits by your staircase")
/** crumbs: [{x,y,z,sky}] sampled once a second during a pursuit, oldest first. */
export function noteEscapePath(M, crumbs) {
  if (crumbs.length < 4) return null;
  let at = null;
  // where you went underground, or dropped down a shaft or staircase
  for (let i = crumbs.length - 1; i > 0; i--) {
    const a = crumbs[i - 1], b = crumbs[i];
    if ((a.sky > 0 && b.sky === 0) || (a.y - b.y >= 3 && V.distH(a, b) < 7)) { at = b.door || a; break; }
  }
  // otherwise: where you entered somewhere enclosed
  if (!at) for (let i = crumbs.length - 1; i > 0; i--) if (!crumbs[i - 1].in && crumbs[i].in) { at = crumbs[i - 1]; break; }
  if (!at) return null;
  const d = dayIndex();
  let n = M.nodes.find((x) => V.dist(x, at) < 7);
  if (n) { n.n += 1; n.d = d; n.x = (n.x + at.x) / 2; n.y = (n.y + at.y) / 2; n.z = (n.z + at.z) / 2; }
  else { n = { x: at.x, y: at.y, z: at.z, n: 1, d }; M.nodes.push(n); }
  return n;
}
/** A passage you have escaped through at least twice, near `loc`. */
export function learnedNode(M, loc, maxDist = 70, minN = 2) {
  let best = null, bd = maxDist;
  for (const n of M.nodes) {
    if (n.n < minN) continue;
    const d = V.dist(n, loc);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// ----------------------------------------------------------------- hiding rooms ("he waits outside")
/** You are hiding somewhere enclosed while he is about: count it once per encounter. */
export function noteRoom(M, loc, s) {
  const d = dayIndex();
  let r = M.rooms.find((x) => V.dist(x, loc) < 6);
  if (!r) { r = { x: loc.x, y: loc.y, z: loc.z, n: 0, c: 0, d, e: -1 }; M.rooms.push(r); }
  if (r.e === s.encId) return r;
  r.e = s.encId;
  r.n += 1;
  // confidence only grows once he has seen you hide here more than once
  if (r.n >= 2) r.c += 1;
  r.d = d;
  return r;
}
export function roomAt(M, loc) { return M.rooms.find((x) => V.dist(x, loc) < 6) || null; }

// ----------------------------------------------------------------- watching you fight
/** Called twice a second while the player is fighting an ordinary monster. */
export function observeFight(p, s, M) {
  const f = s.fight;
  if (!f || now() - f.t > 60) return;
  const mob = f.mob;
  if (!safe(() => mob.isValid, false)) return;
  const d = V.dist(mob.location, p.location);
  if (d > 10) return;
  const mv = safe(() => p.inputInfo.getMovementVector(), { x: 0, y: 0 });
  const a = 0.04;
  const F = M.fight;
  const ema = (k, v) => { F[k] = F[k] * (1 - a) + v * a; };
  ema("back", mv.y < -0.35 ? 1 : 0);
  ema("strafe", Math.abs(mv.x) > 0.5 && Math.abs(mv.y) < 0.35 ? 1 : 0);
  ema("press", mv.y > 0.5 && d < 4 ? 1 : 0);
  ema("high", p.location.y - mob.location.y > 1.6 ? 1 : 0);
}
export function noteRanged(M) { M.fight.ranged = M.fight.ranged * 0.9 + 0.1; }
export function noteMelee(M) { M.fight.ranged = M.fight.ranged * 0.97; }
/** His read on how you fight, as rough tendencies (never perfect prediction). */
export function tendency(M) {
  const F = M.fight;
  const list = [["flank", F.back], ["lead", F.strafe], ["cover", Math.max(F.ranged, coverBias(M) * 0.7)], ["feint", F.press], ["under", F.high]];
  list.sort((a, b) => b[1] - a[1]);
  const [kind, w] = list[0];
  // subtle: a strong habit is only exploited some of the time, and with some noise
  if (w < 0.18 || !chance(clamp(w * 0.9, 0, 0.5))) return null;
  return kind;
}

// ----------------------------------------------------------------- report (for /scriptevent goatwalker:mind)
export function describe(M) {
  const h = habits(M);
  const esc = ESCAPES.map((k) => `${k} ${M.esc[k].toFixed(1)}${adapted(M, k) ? "*" : ""}`).join("  ");
  const F = M.fight;
  return `habits: caves ${(h.cave * 100) | 0}%  home ${(h.home * 100) | 0}%  travel ${(h.travel * 100) | 0}%  woods ${(h.woods * 100) | 0}%  night ${(h.night * 100) | 0}%\n` +
    `escapes: ${esc}\n` +
    `stares ${M.stares}  look-away ${M.look.toFixed(2)}  shots ${M.shots}  outruns ${M.outruns}  charges ${(M.charges || 0).toFixed(1)}  -> snap ${snapAt(M).toFixed(1)}s  creep ${creepStep(M).toFixed(1)}  start ${startDist(M)}\n` +
    `fights: back ${F.back.toFixed(2)} strafe ${F.strafe.toFixed(2)} press ${F.press.toFixed(2)} ranged ${F.ranged.toFixed(2)} high ${F.high.toFixed(2)}\n` +
    `passages: ${M.nodes.map((n) => `${n.x | 0},${n.y | 0},${n.z | 0} x${n.n.toFixed(1)}`).join(" | ") || "-"}\n` +
    `rooms: ${M.rooms.map((r) => `${r.x | 0},${r.y | 0},${r.z | 0} n${r.n.toFixed(1)} c${r.c.toFixed(1)}`).join(" | ") || "-"}`;
}
