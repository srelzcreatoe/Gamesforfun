// @ts-check
// What the Observer remembers about each player. Everything here is bounded and
// derived from observable gameplay signals:
//
//   crumbs   last 32 positions, one every ~6 s of movement      -> where you have been (evidence, borrowed sounds)
//   haunts   up to 6 16x16 cells scored by time spent + your bed -> "home" (home visits, the vigil)
//   route    up to 96 8x8 cells with distinct-visit counts       -> familiar routes (route alteration)
//   habits   decayed counters of mining/chopping/building/...   -> which sounds it borrows, which tests it favours
//   lastAct  where each habit last happened                      -> where borrowed sounds come from
//   attn     how often you notice its cues (0..1, EMA)           -> adapts how obvious cues are
import { world, system } from "@minecraft/server";
import { ps, now, markPlayerDirty } from "../core/state.js";
import { V, dimIndex, safe } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */

const CRUMB_MAX = 32;
const HAUNT_MAX = 6;
const ROUTE_MAX = 96;

/** @type {Map<string, {loc:any, dim:number, t:number, still:number, speed:number, lastCrumb:any, cell:string, sleeping:boolean, sleptAt:number}>} */
const live = new Map();

/** Runtime (non-persistent) movement info for a player. @param {Player} p */
export function motion(p) {
  let m = live.get(p.id);
  if (!m) {
    m = { loc: p.location, dim: dimIndex(p.dimension.id), t: system.currentTick, still: 0, speed: 0, lastCrumb: null, cell: "", sleeping: false, sleptAt: -1 };
    live.set(p.id, m);
  }
  return m;
}
export const forget = (id) => live.delete(id);

/** Called every 20 ticks per player. */
export function sample(p) {
  const s = ps(p);
  const m = motion(p);
  const d = dimIndex(p.dimension.id);
  const loc = p.location;
  const dt = Math.max(1, system.currentTick - m.t) / 20;
  const moved = m.dim === d ? V.hdist(loc, m.loc) : 0;
  m.speed = moved / dt;
  m.still = moved < 0.4 ? m.still + dt : 0;
  m.loc = loc;
  m.t = system.currentTick;
  m.dim = d;
  s.play += dt;
  const t = now();

  // breadcrumbs
  if (!m.lastCrumb || m.lastCrumb[0] !== d || V.hdist(loc, { x: m.lastCrumb[1], y: 0, z: m.lastCrumb[3] }) > 6) {
    const c = [d, Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z), Math.floor(t)];
    s.crumbs.push(c);
    if (s.crumbs.length > CRUMB_MAX) s.crumbs.shift();
    m.lastCrumb = c;
    markPlayerDirty(p);
  }

  // haunts: time spent per 16x16 cell
  const hx = Math.floor(loc.x / 16), hz = Math.floor(loc.z / 16);
  let h = s.haunts.find((x) => x[0] === d && x[1] === hx && x[2] === hz);
  if (!h) {
    h = [d, hx, hz, 0, t, Math.floor(loc.y)];
    s.haunts.push(h);
  }
  h[3] += dt * (m.speed < 1 ? 1.5 : 0.5);
  if (t - h[4] > 1) h[5] = Math.round((h[5] * 3 + loc.y) / 4);
  h[4] = t;
  if (s.haunts.length > HAUNT_MAX) {
    s.haunts.sort((a, b) => b[3] - a[3]);
    s.haunts.length = HAUNT_MAX;
  }

  // route familiarity: distinct visits to 8x8 cells (a visit = arriving after 2+ minutes away)
  const cell = `${d}:${Math.floor(loc.x / 8)}:${Math.floor(loc.z / 8)}`;
  if (cell !== m.cell) {
    m.cell = cell;
    const r = s.route[cell];
    if (!r) s.route[cell] = [1, t];
    else {
      if (t - r[1] > 120) r[0]++;
      r[1] = t;
    }
    const keys = Object.keys(s.route);
    if (keys.length > ROUTE_MAX) {
      keys.sort((a, b) => s.route[a][1] - s.route[b][1]);
      for (const k of keys.slice(0, keys.length - ROUTE_MAX)) delete s.route[k];
    }
  }

  // sleeping transitions (used by the night visit)
  const sleeping = safe(() => p.isSleeping, false);
  if (sleeping && !m.sleeping) m.sleptAt = system.currentTick;
  m.sleeping = !!sleeping;
}

/** Slow decay so habits reflect the recent past (called every 60 s). */
export function decay(p) {
  const s = ps(p);
  for (const k of Object.keys(s.habits)) {
    s.habits[k] *= 0.97;
    if (s.habits[k] < 0.05) delete s.habits[k];
  }
  for (const h of s.haunts) h[3] *= 0.995;
}

/** @param {Player} p @param {string} habit @param {number} [w] */
export function noteHabit(p, habit, w = 1) {
  const s = ps(p);
  s.habits[habit] = (s.habits[habit] || 0) + w;
  const l = p.location;
  s.lastAct[habit] = [dimIndex(p.dimension.id), Math.floor(l.x), Math.floor(l.y), Math.floor(l.z), Math.floor(now())];
  markPlayerDirty(p);
}

/** @param {Player} p */
export function dominantHabit(p, allowed) {
  const s = ps(p);
  let best, n = 0;
  for (const [k, v] of Object.entries(s.habits)) if ((!allowed || allowed.includes(k)) && v > n) { best = k; n = v; }
  return best;
}

/** The player's strongest haunt in their current dimension (bed spawn counts double). */
export function primaryHaunt(p, minScore = 240) {
  const s = ps(p);
  const d = dimIndex(p.dimension.id);
  const spawn = safe(() => p.getSpawnPoint());
  let best, bestScore = 0;
  for (const h of s.haunts) {
    if (h[0] !== d) continue;
    let score = h[3];
    if (spawn && dimIndex(spawn.dimension.id) === d && Math.floor(spawn.x / 16) === h[1] && Math.floor(spawn.z / 16) === h[2]) score *= 2;
    if (score > bestScore) { best = h; bestScore = score; }
  }
  if (!best || bestScore < minScore) return undefined;
  // centre on the bed when it lies in this cell, otherwise the cell centre
  let center = { x: best[1] * 16 + 8, y: best[5], z: best[2] * 16 + 8 };
  if (spawn && Math.floor(spawn.x / 16) === best[1] && Math.floor(spawn.z / 16) === best[2]) center = { x: spawn.x, y: spawn.y, z: spawn.z };
  return { center, score: bestScore, lastVisit: best[4], cell: best };
}

/** Distinct visits to the 8x8 cell the player stands in. */
export function routeFamiliarity(p) {
  const s = ps(p);
  const l = p.location;
  const r = s.route[`${dimIndex(p.dimension.id)}:${Math.floor(l.x / 8)}:${Math.floor(l.z / 8)}`];
  return r ? r[0] : 0;
}

/** Update the attentiveness estimate after an encounter. @param {boolean} noticed */
export function noteAttention(p, noticed) {
  const s = ps(p);
  s.attn = s.attn * 0.8 + (noticed ? 0.2 : 0);
  markPlayerDirty(p);
}

/** Habit classification from gameplay events. */
export function registerEvents() {
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    const t = ev.brokenBlockPermutation.type.id;
    let h = "mine";
    if (/log|wood|stem|hyphae|planks/.test(t)) h = "chop";
    else if (/dirt|grass|sand|gravel|clay|mud|soul_s|snow/.test(t)) h = "dig";
    else if (/wheat|carrot|potato|beetroot|melon|pumpkin|cane|bamboo|berry/.test(t)) h = "farm";
    noteHabit(ev.player, h, 0.3);
  });
  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    const t = ev.block.typeId;
    noteHabit(ev.player, /torch|lantern|candle|campfire|lamp|glowstone|froglight|shroomlight/.test(t) ? "light" : "build", 0.3);
  });
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    if (!ev.isFirstEvent) return;
    const t = ev.block.typeId;
    if (/door|trapdoor|fence_gate/.test(t)) noteHabit(ev.player, "doors", 0.4);
    else if (/chest|barrel|shulker/.test(t)) noteHabit(ev.player, "store", 0.4);
  });
  world.afterEvents.itemCompleteUse.subscribe((ev) => {
    if (ev.source.typeId === "minecraft:player") noteHabit(/** @type {Player} */ (ev.source), "eat", 0.3);
  });
  world.afterEvents.entityHurt.subscribe((ev) => {
    const src = ev.damageSource.damagingEntity;
    if (src && src.typeId === "minecraft:player" && ev.hurtEntity.typeId !== "minecraft:player") noteHabit(/** @type {Player} */ (src), "fight", 0.3);
  });
}
