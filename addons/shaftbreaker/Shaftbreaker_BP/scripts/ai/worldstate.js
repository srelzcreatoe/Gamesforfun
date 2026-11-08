// @ts-check
import { world } from '@minecraft/server';
import { parseJSON, clamp, worldTicks, distXZ } from '../core/util.js';

/** World-level personality: danger budget, territory, dens, encounter history. Never overwrites player memory. */
const KEY = 'sb:world';
let st = null;
let dirty = false;

function blank() {
  return {
    v: 1,
    danger: 10,            // 0..100 global danger budget
    dens: [],              // {id,x,y,z,created,cleansed,crack:[keys],tier}
    nextDenId: 1,
    history: [],           // ring of {id,f,p,t,o} (encounter id, family, player name, world tick, outcome)
    lastRare: -1e9,        // world tick of last rare cinematic
    lastHuntEnd: -1e9,
    defeatedUntil: -1e9,   // after a defeat the territory falls silent for a while
    defeats: 0,
    suppress: [],          // {x,z,r,until} regional suppression from cleansed dens
    hunts: 0,
  };
}

export function ws() {
  if (st) return st;
  st = { ...blank(), ...parseJSON(/** @type {string} */ (world.getDynamicProperty(KEY)), {}) };
  return st;
}

export function wsDirty() { dirty = true; }

export function wsSave() {
  if (!dirty || !st) return;
  try {
    if (st.history.length > 40) st.history = st.history.slice(-40);
    world.setDynamicProperty(KEY, JSON.stringify(st));
    dirty = false;
  } catch (e) { console.warn('[Shaftbreaker] world state save failed ' + e); }
}

export function wsReset() { st = blank(); dirty = true; wsSave(); }

export function addDanger(v) { const s = ws(); s.danger = clamp(s.danger + v, 0, 100); dirty = true; }

export function pushHistory(rec) { const s = ws(); s.history.push(rec); if (s.history.length > 40) s.history.shift(); dirty = true; }

export function activeDens() { return ws().dens.filter((d) => !d.cleansed); }

export function nearestDen(pos, maxDist = 1e9, includeCleansed = false) {
  let best = null, bd = maxDist;
  for (const d of ws().dens) {
    if (d.cleansed && !includeCleansed) continue;
    const dd = distXZ(pos, d);
    if (dd < bd && Math.abs(pos.y - d.y) < 64) { bd = dd; best = d; }
  }
  return best ? { den: best, dist: bd } : null;
}

/** 0..1 suppression factor at a position (1 = fully suppressed) */
export function suppressionAt(pos) {
  const t = worldTicks();
  let s = 0;
  for (const z of ws().suppress) {
    if (z.until < t) continue;
    if (distXZ(pos, z) < z.r) s = Math.max(s, 0.85);
  }
  return s;
}

export function pruneSuppression() {
  const t = worldTicks();
  const s = ws();
  const n = s.suppress.length;
  s.suppress = s.suppress.filter((z) => z.until > t);
  if (s.suppress.length !== n) dirty = true;
}
