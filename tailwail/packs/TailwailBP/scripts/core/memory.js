// Per-player behavioural memory.  Pure: no Minecraft imports.
//
// What is stored (and nothing else):
//   * gestures Tailwail actually OBSERVED (count, decaying weight, last pitch)
//   * how encounters ended (capped counters)
//   * the player's common reactions (decaying weights)
//   * the last few setups used, for variety
// Influence is bounded and decays every encounter.  Memory never changes damage,
// never shortens the mandatory telegraph, and never grants knowledge of unseen events.
import { MEMORY } from "../config.js";
import { GESTURES } from "./gestures.js";

export const OUTCOMES = ["observed", "calm", "interrupted", "escaped", "caught", "killed", "aborted"];
export const REACTIONS = ["approach", "flee", "attack", "hide", "stare"];

export function emptyMemory() {
  const gest = {};
  for (const g of GESTURES) gest[g] = { n: 0, w: 0, p: 0 };
  const out = {};
  for (const o of OUTCOMES) out[o] = 0;
  const react = {};
  for (const r of REACTIONS) react[r] = 0;
  return { v: MEMORY.version, enc: 0, gest, out, react, recent: [], noticeAvg: 0, last: null };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const capN = (n) => Math.max(0, Math.min(MEMORY.countCap, Math.round(n)));

/** Parses stored JSON defensively; any unknown/old/corrupt data yields a fresh record. */
export function parseMemory(json) {
  if (typeof json !== "string" || json.length === 0 || json.length > MEMORY.maxBytes * 2) return emptyMemory();
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyMemory();
  }
  if (!raw || raw.v !== MEMORY.version) return emptyMemory();
  const m = emptyMemory();
  m.enc = capN(raw.enc || 0);
  for (const g of GESTURES) {
    const s = raw.gest && raw.gest[g];
    if (s) m.gest[g] = { n: capN(s.n || 0), w: clamp01(+s.w || 0), p: Math.max(-45, Math.min(45, +s.p || 0)) };
  }
  for (const o of OUTCOMES) m.out[o] = capN((raw.out && raw.out[o]) || 0);
  for (const r of REACTIONS) m.react[r] = clamp01(+(raw.react && raw.react[r]) || 0);
  if (Array.isArray(raw.recent)) m.recent = raw.recent.filter((s) => typeof s === "string").slice(-MEMORY.recentSetups);
  m.noticeAvg = Math.max(0, Math.min(300, +raw.noticeAvg || 0));
  if (raw.last && typeof raw.last.setup === "string" && OUTCOMES.includes(raw.last.outcome)) {
    m.last = { setup: raw.last.setup, outcome: raw.last.outcome };
  }
  return m;
}

export function serializeMemory(m) {
  const s = JSON.stringify(m);
  if (s.length > MEMORY.maxBytes) {
    // cannot happen with bounded fields, but never persist an oversized blob
    return JSON.stringify(emptyMemory());
  }
  return s;
}

/** A gesture Tailwail saw this encounter. */
export function recordGesture(m, type, pitch = 0) {
  const g = m.gest[type];
  if (!g) return;
  g.n = capN(g.n + 1);
  g.w = clamp01(g.w + 0.35);
  if (type === "tilt") g.p = Math.max(-45, Math.min(45, Math.round(pitch)));
}

export function recordReaction(m, reaction, amount = 0.3) {
  if (!(reaction in m.react)) return;
  m.react[reaction] = clamp01(m.react[reaction] + amount);
}

/** Called once when an encounter ends: logs the outcome, then decays all learned weights. */
export function endEncounter(m, setup, outcome, noticeSeconds) {
  m.enc = capN(m.enc + 1);
  if (OUTCOMES.includes(outcome)) m.out[outcome] = capN(m.out[outcome] + 1);
  m.recent = [...m.recent, setup].slice(-MEMORY.recentSetups);
  m.last = { setup, outcome };
  if (noticeSeconds > 0) m.noticeAvg = m.noticeAvg ? m.noticeAvg * 0.7 + noticeSeconds * 0.3 : noticeSeconds;
  for (const g of GESTURES) m.gest[g].w = clamp01(m.gest[g].w * MEMORY.decay);
  for (const r of REACTIONS) m.react[r] = clamp01(m.react[r] * MEMORY.decay);
}

/** The gesture it "remembers" best, if any is strong enough to open an encounter with. */
export function rememberedGesture(m, minCount) {
  let best = null;
  for (const g of GESTURES) {
    const s = m.gest[g];
    if (s.n >= minCount && s.w > 0.2 && (!best || s.w > best.w)) best = { type: g, w: s.w, pitch: s.p };
  }
  return best;
}

/** Weighted choice table for imitation: favours gestures this player uses, never excludes others. */
export function gestureBias(m) {
  return GESTURES.map((g) => [g, 1 + 1.5 * m.gest[g].w]);
}

/**
 * Bounded stalking-duration factor in [0.8, 1.2]:
 *  players who notice it quickly get a slightly longer, warier stalk; slow noticers a shorter one.
 */
export function stalkFactor(m) {
  if (!m.noticeAvg) return 1;
  const f = 1 + (30 - m.noticeAvg) / 150;
  return Math.max(0.8, Math.min(1.2, f));
}

/** Retreat distance factor in [1, 1.4]: players who chase it get a farther withdrawal. */
export function retreatFactor(m) {
  return 1 + 0.4 * clamp01(m.react.approach + 0.5 * m.react.attack);
}

/** Setup weights: novelty first (recent setups heavily discounted), bounded preference otherwise. */
export function setupWeights(m, setups) {
  return setups.map((s) => {
    const idx = m.recent.lastIndexOf(s);
    let w = 1;
    if (idx >= 0) w *= 0.25 + 0.75 * (1 - (idx + 1) / (m.recent.length + 1));
    if (m.last && m.last.setup === s) w = 0; // never back-to-back
    // players who stare it down get more of the openings that make staring useless;
    // players who flee get more corner peeks and ambushes
    if (s === "treeline" || s === "behind_you") w *= 1 + 0.5 * m.react.stare;
    if (s === "corner_peek" || s === "ceiling" || s === "huddle") w *= 1 + 0.5 * m.react.flee;
    return [s, w];
  });
}
