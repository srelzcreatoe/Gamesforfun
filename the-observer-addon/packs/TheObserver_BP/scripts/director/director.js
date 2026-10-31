// @ts-check
// The horror director.
//
// Flow per player:  grace -> stage 1 (anomalies) -> 2 (suspicion) -> 3 (evidence) -> 4 (contact) -> 5 (escalation)
// Pacing: per-player gaps scaled by frequency, stage, darkness and tension; a long quiet period every
// 3-5 encounters; recovery after deaths and intense encounters; a global cooldown between any two starts.
// Multiplayer: one physical Observer. Body encounters go to the eligible player who has waited longest
// (weighted by stage); body-free encounters may run for other players at the same time.
// From stage 4 its dangerous encounters are announced by silence first (observer/hush.js), and the way
// each one ends teaches it something about the player (observer/learn.js).
// The Weeping Mire is its home: there the grace period ends after 30 s, the gaps are shorter and it
// behaves as if the player were one stage further along.
// It knows each player (observer/profile.js): where they spend their time, how they react, what has worked on
// them — and chooses accordingly. Run at it and it decides on the spot (observer/charge.js).
import { world, system, GameMode } from "@minecraft/server";
import { W, ps, now, markWorldDirty, markPlayerDirty } from "../core/state.js";
import { S, typeOn } from "../core/settings.js";
import { aggression } from "../core/settings.js";
import { AbortError, rand, weightedPick, trace, DEBUG, safe, V, emit, allPlayers } from "../core/util.js";
import { context, moodFactor, effectiveStage } from "./context.js";
import * as mire from "../mire/mire.js";
import { Encounter } from "./encounter.js";
import * as body from "../observer/body.js";
import * as ledger from "../world/ledger.js";
import { manip } from "../world/manipulate.js";
import { expose } from "../progression/discoveries.js";
import { noteAttention } from "../observer/memory.js";
import * as hush from "../observer/hush.js";
import * as learn from "../observer/learn.js";
import * as profile from "../observer/profile.js";
import * as charge from "../observer/charge.js";
import { relentless } from "../encounters/common.js";

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
    // its home does not wait for the grace period to run out
    if (s.play < graceSeconds() && mire.secondsHere(p.id) < 30) return false;
    s.stage = 1;
    s.nextAt = t + rand(30, 120);
    markPlayerDirty(p);
    const home = s.play < graceSeconds();
    trace(`${p.name}: grace period over${home ? " (the Mire)" : ""}`);
    emit("grace", { player: p.name, mire: home, play: Math.floor(s.play) });
    // the only unprompted hint the add-on ever gives
    system.runTimeout(() => safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.onboard" }] })), 20 * 20);
    return false;
  }
  if (s.witnessed && s.endMode === "rest") return false;
  if (hush.get(p.id)) return false;
  // it vanished rather than be reached: when the moment favours it, it comes back at once
  if (s.ambush) {
    if (t > s.ambush.until) delete s.ambush;
    else if (!s.ambush.armed && t >= s.ambush.at + 30 && charge.favours(context(p))) {
      s.ambush.armed = true;
      s.nextAt = Math.min(s.nextAt, t + rand(5, 15));
      s.quietUntil = Math.min(s.quietUntil, t);
      markPlayerDirty(p);
      emit("ambush", { what: "armed", player: p.name });
    }
  }
  if (t < s.nextAt || t < s.quietUntil || t < s.recoveryUntil) return false;
  if (encounterFor(p.id)) return false;
  return true;
}

/** Weight of an encounter type for this player and context, or 0. */
export function eligibleWeight(def, s, c) {
  if (def.manual || !typeOn(def.id)) return 0;
  if (def.minStage > effectiveStage(s, c)) return 0;
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
  // what it knows about this player: where they are, when, what has worked on them
  w *= profile.weightFactor(s, def.id);
  // an ambush: its heavier encounters
  if (s.ambush?.armed) w *= def.tier >= 3 ? 3 : def.tier >= 2 ? 1.5 : 0.5;
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
  releaseHushes(t);
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
    // the one Observer is not given away while another player's silence is waiting for it
    const pool = REGISTRY.filter((d) => !(d.needsBody && (active || hush.reservedFor(p.id))));
    const def = weightedPick(pool, (d) => eligibleWeight(d, s, c));
    if (!def) {
      s.nextAt = t + 20;
      continue;
    }
    if (hush.wanted(def, s, c) && !hush.isSilenced(p.id)) {
      // the world goes quiet first; the encounter (or nothing) follows in 20-30 s
      hush.begin(p, def.id, t);
      W.globalCooldownUntil = t + 10;
      markWorldDirty();
      return;
    }
    start(def, p, c);
    return;
  }
}

/** Silences whose wait is over: start what they announced if it still fits, else end quietly. @param {number} t */
function releaseHushes(t) {
  for (const p of allPlayers()) {
    const h = hush.get(p.id);
    if (!h || t < h.until) continue;
    hush.release(p.id);
    const s = ps(p);
    if (h.falseAlarm || !h.def || !S().enabled || control.paused || p.dimension.id !== h.dimId || encounterFor(p.id)) {
      hush.end(p, p.id, h.falseAlarm ? "false_alarm" : "nothing");
      if (!h.test) {
        s.nextAt = Math.max(s.nextAt, t + rand(60, 120));
        markPlayerDirty(p);
      }
      continue;
    }
    const c = context(p);
    // what it announced, or another of its dangerous encounters that fits where the player is now
    const first = byId(h.def);
    const pool = REGISTRY.filter((d) => hush.DANGEROUS.has(d.id) && !(d.needsBody && active));
    const def = c.eligible ? (first && pool.includes(first) && eligibleWeight(first, s, c) > 0 ? first : weightedPick(pool, (d) => eligibleWeight(d, s, c))) : undefined;
    const enc = def ? start(def, p, c) : null;
    if (enc) enc.data.hushed = true;
    else {
      hush.end(p, p.id, "nothing");
      s.nextAt = Math.max(s.nextAt, t + rand(60, 120));
      markPlayerDirty(p);
    }
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
  if (enc.s.ambush?.armed && def.tier >= 2 && !force) {
    emit("ambush", { what: "sprung", player: p.name, type: def.id });
    delete enc.s.ambush;
    markPlayerDirty(p);
  }
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
    // a reaction of its (a strike when walked up to, an attack when charged) plays out first
    if (enc.data.reaction) await enc.data.reaction.catch(() => {});
    await cleanup(enc);
    finish(enc);
  }
}

async function cleanup(enc) {
  enc.clearFog();
  // any encounter that still owns the body removes it (some body-free encounters borrow it)
  const b = body.get();
  if (b && b.enc === enc.id) {
    if (enc.aborted === "flared") {
      // the flare's glare: it recoils, then tears apart
      body.setMode("still");
      body.setState("recoil");
      await system.waitTicks(8);
      if (body.get() === b) body.despawn("flare");
    } else if (enc.aborted) body.despawn(enc.aborted === "struck" ? "unravel" : "abort");
    else {
      // it does not walk off: it is simply gone
      try {
        await body.vanish();
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
  // the silence lasts until its encounter is over
  if (!hush.get(enc.pid) && hush.isSilenced(enc.pid)) hush.end(enc.p.isValid ? enc.p : undefined, enc.pid, "encounter_over");
  if (enc.def.preview) {
    // a preview from the Config Wheel is not part of the story: no history, pacing or progress
    markWorldDirty();
    trace(`END enc=${enc.id} type=${enc.def.id} outcome=${enc.outcome || "done"} (preview)`);
    emit("end", { enc: enc.id, type: enc.def.id, outcome: enc.outcome || "done", noticed: enc.noticed, target: enc.p.isValid ? enc.p.name : enc.pid, aborted: enc.aborted });
    return;
  }
  const deferred = enc.outcome === "deferred";
  const di = deferInfo(s);
  // how the player got away teaches it something
  const method = learn.methodOf(enc.def.id, enc.outcome, enc.data);
  if (method && enc.p.isValid) learn.note(enc.p, method);
  if (method === "outrun" && enc.p.isValid) profile.note(enc.p, "flee");
  // and whether this encounter got a reaction out of them at all
  if (!deferred && !enc.aborted && enc.p.isValid) profile.outcome(enc.p, enc.def.id, enc.noticed);
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
    const gap = rand(110, 240) / freq * (1 - 0.04 * s.stage) * moodFactor(enc.ctx) * (1 + s.tension / 150);
    s.nextAt = t + gap;
    s.sinceQuiet++;
    if (s.sinceQuiet >= Math.floor(rand(3, 6))) {
      s.quietUntil = t + rand(240, 480) / freq;
      s.sinceQuiet = 0;
      trace(`${enc.p.isValid ? enc.p.name : enc.pid}: quiet period`);
    }
    if (enc.def.tier >= 3) s.recoveryUntil = Math.max(s.recoveryUntil, t + rand(180, 240));
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
 * Unlike the timer path it ignores nextAt, but respects stage, settings, quiet/recovery and cooldown
 * (anyway: also ignores quiet/recovery and the type's cooldown — the last torn page).
 * @param {string} id @param {Player} p @param {{anyway?:boolean}} [o]
 */
export function tryManual(id, p, o = {}) {
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
  if (!o.anyway && (t < s.quietUntil || t < s.recoveryUntil)) return null;
  const last = s.typeLast[def.id];
  if (!o.anyway && last !== undefined && t - last < def.cooldown) return null;
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


/**
 * Called every 5 ticks. Walk right up to it and it does not wait for you: after a short, varying moment
 * it tears apart before you can touch it — or, now and then (stage 2+, aggression above "never", at most
 * every 75 s per player, about 30 %), it rises, comes at you through the air and strikes once first. The distance that sets it off
 * varies per appearance (4-8 blocks). Encounters that bring it close on purpose opt out (reactNear: false).
 */
export function nearCheck() {
  const enc = active;
  if (!enc || enc.def.reactNear === false || enc.data.reacting || enc.aborted) return;
  const b = body.get();
  if (!b || b.enc !== enc.id || b.mode !== "still" || b.e.dimension.id !== enc.dimId) return;
  if (system.currentTick - b.spawnedTick < 10) return;
  if (enc.data.nearDist === undefined) enc.data.nearDist = rand(4, 8);
  const l = b.e.location;
  // running straight at it while it watches: it decides, before they get there
  /** @type {Map<string, {d:number, n:number}>} */
  const track = enc.data.chargeTrack ?? (enc.data.chargeTrack = new Map());
  for (const p of allPlayers()) {
    if (p.dimension.id !== enc.dimId) continue;
    const d = V.dist(p.location, l);
    const prev = track.get(p.id);
    const n = prev && prev.d - d >= 1.15 ? prev.n + 1 : 0; // 1.15+ blocks closer every 5 ticks: 4.6+ b/s, faster than a walk
    track.set(p.id, { d, n });
    if (n >= 2 && d <= 32 && d > enc.data.nearDist + 1 && body.watchedBy([p], 30)) {
      enc.data.reacting = true;
      enc.data.reaction = reactCharge(enc, p, d).catch(() => body.despawn("charged"));
      return;
    }
  }
  let near, best = enc.data.nearDist;
  for (const p of allPlayers()) {
    if (p.dimension.id !== enc.dimId) continue;
    const d = V.dist(p.location, l);
    if (d < best) {
      best = d;
      near = p;
    }
  }
  if (!near) return;
  enc.data.reacting = true;
  enc.data.reaction = reactNear(enc, near, best).catch(() => body.despawn("too_close"));
}

/**
 * Charged. It attacks (a rage: observer/charge.js decides from the moment and from this player), or it is gone
 * before they arrive and waits for a better moment (an ambush).
 * @param {Encounter} enc @param {Player} p @param {number} d
 */
async function reactCharge(enc, p, d) {
  const dec = charge.decide(enc, p);
  profile.note(p, "charge");
  emit("charge", { enc: enc.id, player: p.name, attack: dec.attack, score: dec.score, why: dec.why, d: Math.round(d * 10) / 10 });
  if (dec.attack) {
    enc.result("charged", true);
    const l = body.loc();
    if (l) enc.worldSound("observer.crack", { x: l.x, y: l.y + 3, z: l.z }, 1);
    body.setState("stare");
    await system.waitTicks(4);
    await relentless(enc, { rage: true });
  } else {
    enc.result("charge_vanished", true);
    const b = body.get();
    if (b && b.enc === enc.id) body.despawn("charged");
    charge.setAmbush(p);
  }
  enc.abort("charged");
}

/** @param {Encounter} enc @param {Player} p @param {number} d */
async function reactNear(enc, p, d) {
  const s = ps(p);
  const gm = safe(() => p.getGameMode());
  const survival = gm === GameMode.Survival || gm === GameMode.Adventure;
  const roll = DEBUG.nearStrike === "always" ? true : DEBUG.nearStrike === "never" ? false : Math.random() < 0.3;
  const strike = survival && aggression() >= 1 && s.stage >= 2 && roll && (DEBUG.nearStrike === "always" || now() - (s.nearStrikeAt ?? -1e9) > 75);
  emit("near", { enc: enc.id, strike, d });
  if (strike) {
    s.nearStrikeAt = now();
    markPlayerDirty(p);
    const l = body.loc();
    // it does not step in: it rises and comes at you through the air
    body.surge();
    if (l) {
      enc.worldSound("observer.shriek", { x: l.x, y: l.y + 3, z: l.z }, 0.9);
      const at = V.add(p.location, V.scale(V.flat(V.sub(l, p.location)), 1.8));
      const g = body.groundNear(enc.dim, at);
      if (g) body.moveTo(g, p.getHeadLocation());
    }
    const r = await body.strike(p, { recover: 6 });
    enc.result(r === "hit" ? "struck_close" : "dodged_close", true);
  } else {
    await system.waitTicks(Math.floor(rand(0, 9)));
    enc.result("too_close", true);
  }
  const b = body.get();
  if (b && b.enc === enc.id) body.despawn("too_close");
  enc.abort("too_close");
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
  hush.end(p, p.id, "died");
  markPlayerDirty(p);
}
