// @ts-check
// The horror director.
//
// Flow per player:  grace -> stage 1 (anomalies) -> 2 (suspicion) -> 3 (evidence) -> 4 (contact) -> 5 (escalation)
// Pacing: per-player gaps scaled by frequency, stage, darkness and tension; a long quiet period every
// 3-5 encounters; recovery after deaths and intense encounters; a global cooldown between any two starts.
// Multiplayer: one physical Observer. Body encounters go to the eligible player who has waited longest
// (weighted by stage); body-free encounters may run for other players at the same time.
import { world, system, GameMode } from "@minecraft/server";
import { W, ps, now, markWorldDirty, markPlayerDirty } from "../core/state.js";
import { S, typeOn } from "../core/settings.js";
import { aggression } from "../core/settings.js";
import { AbortError, rand, weightedPick, trace, DEBUG, safe, V, emit, allPlayers } from "../core/util.js";
import { context, moodFactor } from "./context.js";
import { Encounter } from "./encounter.js";
import * as body from "../observer/body.js";
import * as ledger from "../world/ledger.js";
import { manip } from "../world/manipulate.js";
import { expose } from "../progression/discoveries.js";
import { noteAttention } from "../observer/memory.js";

/** @typedef {import("./encounter.js").EncounterDef} EncounterDef */
/** @typedef {import("@minecraft/server").Player} Player */

/** @type {EncounterDef[]} */
export const REGISTRY = [];
/** @param {EncounterDef} def */
export function register(def) {
  REGISTRY.push(def);
}
export const byId = (id) => REGISTRY.find((d) => d.id === id);

/** @type {Encounter|null} body encounter */
let active = null;
/** @type {Map<string, Encounter>} body-free encounters per player */
const personal = new Map();

export const activeEncounter = () => active;
export const activeEncId = () => (active ? active.id : W.active ? W.active.enc : -1);
export const encounterFor = (pid) => (active && active.pid === pid ? active : personal.get(pid));
export const running = () => [...(active ? [active] : []), ...personal.values()];

const TIER_POINTS = [0, 1, 2, 3, 4];
const TIER_TENSION = [0, 6, 12, 22, 35];
const GLOBAL_GAP = 35;

/** Deferrals (prepare found nothing to do here): per player state -> streak and per-type retry times. Not persisted. */
const deferrals = new WeakMap();
function deferInfo(s) {
  let d = deferrals.get(s);
  if (!d) deferrals.set(s, (d = { streak: 0, until: /** @type {Record<string,number>} */ ({}) }));
  return d;
}

/** Seconds of play before the Observer starts. */
const graceSeconds = () => S().graceMinutes * 60;

/** Is this player ready for an encounter now? */
function ready(p, t) {
  const s = ps(p);
  if (s.stage === 0) {
    if (s.play < graceSeconds()) return false;
    s.stage = 1;
    s.nextAt = t + rand(30, 120);
    markPlayerDirty(p);
    trace(`${p.name}: grace period over`);
    // the only unprompted hint the add-on ever gives
    system.runTimeout(() => safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.onboard" }] })), 20 * 20);
    return false;
  }
  if (s.witnessed && s.endMode === "rest") return false;
  if (t < s.nextAt || t < s.quietUntil || t < s.recoveryUntil) return false;
  if (encounterFor(p.id)) return false;
  return true;
}

/** Weight of an encounter type for this player and context, or 0. */
export function eligibleWeight(def, s, c) {
  if (def.manual || !typeOn(def.id)) return 0;
  if (def.minStage > s.stage) return 0;
  if ((def.minManip ?? 0) > manip()) return 0;
  if ((def.minAggression ?? 0) > 0 && (aggression() < def.minAggression || (s.witnessed))) return 0;
  if (s.witnessed && s.endMode === "attendant" && !def.benign) return 0;
  if ((deferInfo(s).until[def.id] ?? 0) > now()) return 0;
  const last = s.typeLast[def.id];
  if (last !== undefined && now() - last < def.cooldown / Math.max(0.5, S().frequency)) return 0;
  let w = def.weight(c, s);
  if (w <= 0) return 0;
  const recent = s.hist.slice(-6).map((h) => h[0]);
  if (recent[recent.length - 1] === def.id) w *= 0.15;
  else if (recent.slice(-3).includes(def.id)) w *= 0.45;
  else if (recent.includes(def.id)) w *= 0.75;
  // tension fit: when tension is high prefer subtle encounters, when low allow heavier ones
  if (s.tension > 60 && def.tier >= 3) w *= 0.3;
  if (s.tension < 25 && def.tier >= 3) w *= 1.3;
  return w;
}

/** Developer switch: pause the timer-driven director (forced triggers still run). */
export const control = { paused: false };

/** Called once per second. */
export function tick() {
  const t = now();
  for (const p of allPlayers()) {
    const s = ps(p);
    if (s.tension > 0) s.tension = Math.max(0, s.tension - 0.05);
  }
  if (!S().enabled || control.paused) return;
  if (t < W.globalCooldownUntil) return;
  const candidates = allPlayers().filter((p) => ready(p, t));
  if (candidates.length === 0) return;
  // fairness: whoever has waited longest (scaled by stage) goes first; ineligible players
  // (creative, sleeping, dead) are skipped without using up one of the two attempts
  candidates.sort((a, b) => score(b, t) - score(a, t));
  let attempts = 0;
  for (const p of candidates) {
    const c = context(p);
    if (!c.eligible) continue;
    if (++attempts > 2) break;
    const s = ps(p);
    const pool = REGISTRY.filter((d) => !(d.needsBody && active));
    const def = weightedPick(pool, (d) => eligibleWeight(d, s, c));
    if (!def) {
      s.nextAt = t + 20;
      continue;
    }
    start(def, p, c);
    return;
  }
}

function score(p, t) {
  const s = ps(p);
  const last = s.hist.length ? s.hist[s.hist.length - 1][1] : s.first;
  return (t - last) * (1 + 0.15 * s.stage) * rand(0.85, 1.15);
}

/**
 * Start an encounter (also used by dev commands with force=true).
 * @param {EncounterDef} def @param {Player} p @param {any} [c] @param {boolean} [force]
 */
export function start(def, p, c, force = false) {
  if (def.needsBody && active) {
    if (!force) return null;
    active.abort("replaced");
  }
  const prev = personal.get(p.id);
  if (prev) {
    if (!force) return null;
    prev.abort("replaced");
  }
  const ctx = c ?? context(p);
  const id = W.nextEnc++;
  const enc = new Encounter(def, p, ctx, id);
  const t = now();
  if (def.needsBody) {
    active = enc;
    W.active = { enc: id, type: def.id, target: p.id, started: t };
  } else personal.set(p.id, enc);
  if (!def.preview) W.globalCooldownUntil = t + GLOBAL_GAP * (def.needsBody ? 1.5 : 0.6);
  markWorldDirty();
  trace(`START enc=${id} type=${def.id} target=${p.name} stage=${enc.s.stage}`);
  emit("start", { enc: id, type: def.id, target: p.name, stage: enc.s.stage, forced: force });
  run(enc);
  return enc;
}

async function run(enc) {
  try {
    let ok = true;
    if (enc.def.prepare) ok = (await enc.def.prepare(enc)) !== false;
    if (!ok) enc.result("deferred");
    else await enc.def.run(enc);
  } catch (e) {
    if (e instanceof AbortError) enc.outcome = enc.outcome || `aborted:${e.reason}`;
    else {
      enc.outcome = "error";
      console.warn(`[Observer] encounter ${enc.def.id} error: ${e} ${e && e.stack ? e.stack : ""}`);
    }
  } finally {
    await cleanup(enc);
    finish(enc);
  }
}

async function cleanup(enc) {
  enc.clearFog();
  // any encounter that still owns the body removes it (some body-free encounters borrow it)
  const b = body.get();
  if (b && b.enc === enc.id) {
    if (enc.aborted) body.despawn(enc.aborted === "struck" ? "unravel" : "abort");
    else {
      try {
        await body.withdraw(enc.p.isValid ? enc.watchers() : [], 120);
      } catch {
        body.despawn("cleanup");
      }
    }
  }
  ledger.scheduleEncounter(enc.id, enc.aborted ? Math.min(enc.restoreDelay, 30) : enc.restoreDelay);
}

function finish(enc) {
  const t = now();
  const s = enc.s;
  if (active === enc) {
    active = null;
    W.active = null;
  }
  if (personal.get(enc.pid) === enc) personal.delete(enc.pid);
  if (enc.def.preview) {
    // a preview from the Config Wheel is not part of the story: no history, pacing or progress
    markWorldDirty();
    trace(`END enc=${enc.id} type=${enc.def.id} outcome=${enc.outcome || "done"} (preview)`);
    emit("end", { enc: enc.id, type: enc.def.id, outcome: enc.outcome || "done", noticed: enc.noticed, target: enc.p.isValid ? enc.p.name : enc.pid, aborted: enc.aborted });
    return;
  }
  const deferred = enc.outcome === "deferred";
  const di = deferInfo(s);
  if (deferred) {
    // nothing fitted here: free the director for other players at once, back this player off a
    // little more each time (15, 30, 60, 120, 240 s) and don't retry this type for a while
    di.streak++;
    s.nextAt = Math.max(s.nextAt, t + Math.min(240, 15 * 2 ** (di.streak - 1)));
    di.until[enc.def.id] = t + 90 + 30 * di.streak;
    W.globalCooldownUntil = Math.min(W.globalCooldownUntil, t + 5);
  } else {
    di.streak = 0;
    s.typeLast[enc.def.id] = t;
    s.hist.push([enc.def.id, Math.floor(t), enc.outcome, enc.ctx.d, Math.floor(enc.startLoc.x), Math.floor(enc.startLoc.z)]);
    if (s.hist.length > 12) s.hist.shift();
    s.encCount++;
    W.stats.encounters++;
    W.stats.byType[enc.def.id] = (W.stats.byType[enc.def.id] || 0) + 1;
    s.tension = Math.min(100, s.tension + TIER_TENSION[enc.def.tier]);
    const freq = Math.max(0.25, S().frequency);
    const gap = rand(150, 320) / freq * (1 - 0.04 * s.stage) * moodFactor(enc.ctx) * (1 + s.tension / 150);
    s.nextAt = t + gap;
    s.sinceQuiet++;
    if (s.sinceQuiet >= Math.floor(rand(3, 6))) {
      s.quietUntil = t + rand(360, 720) / freq;
      s.sinceQuiet = 0;
      trace(`${enc.p.isValid ? enc.p.name : enc.pid}: quiet period`);
    }
    if (enc.def.tier >= 3) s.recoveryUntil = Math.max(s.recoveryUntil, t + rand(240, 360));
    if (!enc.outcome.startsWith("aborted") && enc.p.isValid) {
      expose(enc.p, TIER_POINTS[enc.def.tier] + (enc.noticed ? 1 : 0) + enc.points);
      noteAttention(enc.p, enc.noticed);
    }
  }
  markWorldDirty();
  if (enc.p.isValid) markPlayerDirty(enc.p);
  trace(`END enc=${enc.id} type=${enc.def.id} outcome=${enc.outcome || "done"} noticed=${enc.noticed}`);
  emit("end", { enc: enc.id, type: enc.def.id, outcome: enc.outcome || "done", noticed: enc.noticed, target: enc.p.isValid ? enc.p.name : enc.pid, aborted: enc.aborted });
}

/**
 * Start an event-triggered encounter (sleep, dimension change) if the player's state allows it.
 * Unlike the timer path it ignores nextAt, but respects stage, settings, quiet/recovery and cooldown.
 * @param {string} id @param {Player} p
 */
export function tryManual(id, p) {
  const def = byId(id);
  if (!def || !S().enabled || !typeOn(id)) return null;
  const s = ps(p);
  const t = now();
  if (def.minStage > s.stage || (def.minManip ?? 0) > manip()) return null;
  // the same eligibility as the timer path, except that sleeping is allowed (the night visit)
  const gm = safe(() => p.getGameMode());
  if (gm !== GameMode.Survival && gm !== GameMode.Adventure) return null;
  if (s.witnessed && s.endMode === "rest") return null;
  if (s.witnessed && s.endMode === "attendant" && !def.benign) return null;
  if (t < s.quietUntil || t < s.recoveryUntil) return null;
  const last = s.typeLast[def.id];
  if (last !== undefined && t - last < def.cooldown) return null;
  if ((def.needsBody && active) || encounterFor(p.id)) return null;
  return start(def, p, undefined, false);
}

/** Abort everything involving a player (left, died, changed dimension). */
export function abortFor(pid, reason) {
  for (const e of running()) if (e.pid === pid) e.abort(reason);
}
export function abortAll(reason) {
  for (const e of running()) e.abort(reason);
}


/** After a reload: an encounter that was running when the world closed is cleaned up. */
export function recoverInterrupted() {
  if (!W.active) return;
  trace(`recovering interrupted encounter ${W.active.enc} (${W.active.type})`);
  ledger.scheduleEncounter(W.active.enc, 20);
  W.active = null;
  markWorldDirty();
}

/** Death: recovery period and tension relief. @param {Player} p */
export function onDeath(p) {
  const s = ps(p);
  s.deaths++;
  s.recoveryUntil = now() + 300;
  s.tension = Math.max(0, s.tension - 30);
  abortFor(p.id, "target_died");
  markPlayerDirty(p);
}
