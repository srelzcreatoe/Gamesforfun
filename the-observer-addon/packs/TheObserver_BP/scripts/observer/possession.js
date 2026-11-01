// @ts-check
// What it does with its puppets outside its encounters (1.3.0):
//   its marked puppets   a kind you have marked "its puppet" (Config Wheel → Other creatures — another add-on's cave
//                        creature, say) is taken wherever it is, from the third stage. If you are up on the surface and
//                        it is down in its caves, it is brought up after you: it stands at the edge of your sight and
//                        lurks, moving only while you are not looking. From the fourth stage (aggression Standard or
//                        High) it is then turned loose on you — stronger, faster, unable to turn back — and when it is
//                        done it is put back where it was taken, as it was.
//   the one cow          at home, one of your animals is its: it always faces you, and follows you at a distance.
//                        Hit it and the possession is torn out of it — the animal is itself again, unharmed.
//   its guards           in the Weeping Mire, two of the creatures that answer to it stand among the trees, facing you,
//                        keeping you out of its home (from the fourth stage they come at you if you come too close).
//   the night they turn  once, at the fifth stage: at midnight every hostile creature around your home stops and faces
//                        your home, quite still, until dawn.
//   tribute              a creature it sends away, unseen, may leave behind something you threw away.
//   they keep away       the other creatures step away from its puppets.
// Settings: "It takes creatures for its own" (on). Nothing of another add-on is touched or read (observer/puppets.js).
import { system, world } from "@minecraft/server";
import * as puppets from "./puppets.js";
import { standing, isHeld } from "./dominion.js";
import { primaryHaunt } from "./memory.js";
import { S } from "../core/settings.js";
import { ps, now, markPlayerDirty } from "../core/state.js";
import { V, safe, emit, rand, allPlayers, DEBUG } from "../core/util.js";
import { findSpot, hideSpot } from "../world/space.js";
import { seenByAny } from "../world/sight.js";
import { discover } from "../progression/discoveries.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */

const ANIMALS = /^minecraft:(cow|mooshroom|sheep|pig|goat|chicken)$/;
const MIRE = "wmire:weeping_mire";
const on = () => S().enabled && S().puppets !== false;
const chance = (/** @type {number} */ p) => DEBUG.possess === "always" || (DEBUG.possess !== "never" && Math.random() < p);
/** Durations are shortened for the tests ("always"). @param {number} ticks */
const dur = (ticks) => (DEBUG.possess === "always" ? Math.max(20, Math.round(ticks * 0.2)) : ticks);

/** Is this creature free to be taken (not someone's, not already used)? @param {Entity} e */
function free(e) {
  return e.isValid && !puppets.isPuppet(e) && !isHeld(e.id) && !safe(() => e.nameTag, "") && !safe(() => e.hasComponent("minecraft:is_tamed"), false)
    && (safe(() => e.getComponent("minecraft:rideable")?.getRiders().length, 0) ?? 0) === 0;
}
/** Under a roof of rock (no sky above, 4+ blocks over its head). @param {Entity} e */
function underground(e) {
  const top = safe(() => e.dimension.getTopmostBlock({ x: e.location.x, z: e.location.z }), undefined);
  return !!top && top.location.y > e.location.y + 4;
}
/** Not seen by anyone, there. @param {string} dimId @param {Vec} loc */
const unseen = (dimId, loc) => !seenByAny(allPlayers().filter((o) => o.dimension.id === dimId), loc, false, [{ x: loc.x, y: loc.y + 1, z: loc.z }, { x: loc.x, y: loc.y + 1.8, z: loc.z }]);

/** @param {number} ticks */
const sleep = (ticks) => system.waitTicks(Math.max(1, Math.round(ticks)));

// ---------------------------------------------------------------- its marked puppets

/** Every second, per player. @param {Player} p @param {number} t clock */
function marked(p, t) {
  const s = ps(p);
  if (s.stage < 3 || t < (s.puppetAt ?? 0) || puppets.count("marked") > 0) return;
  const marks = S().marks ?? {};
  const kinds = Object.keys(marks).filter((k) => marks[k] === "puppet");
  if (!kinds.length) return;
  const near = (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 64 }), []) ?? [])
    .filter((e) => kinds.includes(e.typeId) && free(e))
    .sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location));
  if (!near.length) return;
  s.puppetAt = t + (DEBUG.possess === "always" ? 20 : rand(600, 900) / Math.max(0.5, S().frequency));
  markPlayerDirty(p);
  if (!chance(0.35)) return;
  markedRun(near[0], p).catch((err) => console.warn(`[Observer] puppet error: ${err}`));
}

/** @param {Entity} e @param {Player} p */
async function markedRun(e, p) {
  const pp = puppets.take(e, "marked", { p, mode: "stand", seconds: 240, home: true });
  if (!pp) return;
  const alive = () => puppets.get(pp.id) === pp && pp.e.isValid && p.isValid && p.dimension.id === pp.dimId;
  await sleep(dur(60));
  if (!alive()) return;
  // you are up on the surface and it is down in the dark (or far off): it is brought up after you, unseen
  if (!underground(p) && (underground(pp.e) || V.dist(pp.e.location, p.location) > 32)) {
    const spot = findSpot(p, { minDist: 16, maxDist: 28, bearings: [90, -90, 140, -140], spread: 40, concealment: "hidden", watchLOSIgnoringView: true, yMode: "near", samples: 48 })
      ?? findSpot(p, { minDist: 14, maxDist: 32, concealment: "hidden", yMode: "near", samples: 48 });
    if (spot && puppets.place(pp, spot.loc, p.getHeadLocation())) emit("puppet", { what: "surfaced", id: pp.id, d: Math.round(V.dist(spot.loc, p.location) * 10) / 10 });
  }
  // it lurks at the edge of your sight, and moves only while you are not looking
  puppets.setMode(pp, "lurk", { keep: 10 });
  const lurk = dur(rand(600, 1200));
  for (let i = 0; i < lurk && alive(); i += 10) {
    if (V.dist(pp.e.location, p.location) < 9) break;
    await sleep(10);
  }
  if (!alive()) return;
  // turned loose on you
  if (puppets.mayHunt(p)) {
    puppets.setMode(pp, "hunt");
    emit("puppet", { what: "hunt", id: pp.id, player: p.name });
    for (let i = 0; i < dur(600) && alive(); i += 10) {
      if (V.dist(pp.e.location, p.location) > 48 || (p.getComponent("minecraft:health")?.currentValue ?? 1) <= 0) break;
      await sleep(10);
    }
  }
  if (puppets.get(pp.id) === pp) puppets.release(pp.id, "home");
}

// ---------------------------------------------------------------- the one cow

/** @param {Player} p @param {number} t */
function cow(p, t) {
  const mine = puppets.all().filter((pp) => pp.why === "cow" && pp.p?.id === p.id);
  for (const pp of mine) if (!p.isValid || p.dimension.id !== pp.dimId || V.dist(pp.e.location, p.location) > 40) puppets.release(pp.id, "quiet");
  if (mine.length) return;
  const s = ps(p);
  if (s.stage < 2 || t < (s.cowAt ?? 0)) return;
  const h = primaryHaunt(p);
  if (!h || V.hdist(p.location, h.center) > 24) return;
  const near = (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 20 }), []) ?? []).filter((e) => ANIMALS.test(e.typeId) && free(e));
  if (!near.length) return;
  s.cowAt = t + 10;
  if (!chance(0.1)) return;
  s.cowAt = t + rand(1500, 2400) / Math.max(0.5, S().frequency);
  markPlayerDirty(p);
  const a = near[Math.floor(Math.random() * near.length)];
  puppets.take(a, "cow", { p, mode: "follow", keep: 7, seconds: 300 });
}

// ---------------------------------------------------------------- its guards in the Mire

/** @param {Player} p @param {number} t */
function guards(p, t) {
  const mine = puppets.all().filter((pp) => pp.why === "guard" && pp.p?.id === p.id);
  const inMire = p.dimension.id === "minecraft:overworld" && safe(() => p.dimension.getBiome(p.location)?.id, "") === MIRE;
  if (!inMire) {
    for (const pp of mine) puppets.release(pp.id, unseen(pp.dimId, pp.e.location) ? "gone" : "quiet");
    return;
  }
  const s = ps(p);
  // from the fourth stage, come too close to one and it comes at you
  for (const pp of mine) if (pp.mode === "stand" && puppets.mayHunt(p) && V.dist(pp.e.location, p.location) < 6) puppets.setMode(pp, "hunt");
  if (s.stage < 2 || mine.length >= 2 || t < (s.guardAt ?? 0)) return;
  s.guardAt = t + (DEBUG.possess === "always" ? 2 : 20);
  const near = (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 48, families: ["monster"] }), []) ?? [])
    .filter((e) => standing(e) === "kin" && free(e));
  if (!near.length) return emit("puppet", { what: "guard_none", why: "no creature" });
  // a post among the weeping trees, facing you, put there while nobody sees
  const tree = hideSpot(p, { minDist: 12, maxDist: 26 });
  const post = tree ?? findSpot(p, { minDist: 14, maxDist: 24, concealment: "hidden", watchLOSIgnoringView: true, yMode: "near", samples: 40 });
  const biome = post ? safe(() => p.dimension.getBiome(post.loc)?.id, "") : "";
  if (!post || biome !== MIRE || !unseen(p.dimension.id, post.loc)) return emit("puppet", { what: "guard_none", why: !post ? "no post" : biome !== MIRE ? `biome ${biome}` : "seen", tree: !!tree });
  const pp = puppets.take(near[0], "guard", { p, mode: "stand", seconds: 180 });
  if (pp && puppets.place(pp, post.loc, p.getHeadLocation())) emit("puppet", { what: "guard", id: pp.id, player: p.name });
}

// ---------------------------------------------------------------- the night they all turn

/** Players for whom it is happening tonight: player id -> its home. @type {Map<string, {home:Vec, until:number}>} */
const night = new Map();

/** @param {Player} p @param {number} t */
function nightTurn(p, t) {
  const s = ps(p);
  const tod = safe(() => world.getTimeOfDay(), 6000) ?? 6000;
  const n = night.get(p.id);
  if (n) {
    // until dawn (or seven minutes at most)
    if (tod >= 23000 || tod < 12000 || t > n.until) {
      night.delete(p.id);
      for (const pp of puppets.all()) if (pp.why === "night" && pp.p?.id === p.id) puppets.release(pp.id, "quiet");
      emit("puppet", { what: "dawn", player: p.name });
      return;
    }
    let n2 = puppets.all().filter((pp) => pp.why === "night" && pp.p?.id === p.id).length;
    for (const e of safe(() => p.dimension.getEntities({ location: n.home, maxDistance: 64, families: ["monster"] }), []) ?? []) {
      if (n2 >= 24) break;
      if (standing(e) !== "kin" || !free(e)) continue;
      if (puppets.take(e, "night", { p, mode: "stand", face: { x: n.home.x, y: n.home.y + 1, z: n.home.z }, seconds: 420 })) n2++;
    }
    return;
  }
  if (s.stage < 5 || s.nightTurned || DEBUG.possess === "never") return;
  if (!(tod >= 17600 && tod <= 18800) && DEBUG.possess !== "always") return;
  const h = primaryHaunt(p);
  if (!h || V.hdist(p.location, h.center) > 64) return;
  s.nightTurned = true;
  markPlayerDirty(p);
  night.set(p.id, { home: h.center, until: system.currentTick + 20 * 420 });
  safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.night_turned" }] }));
  emit("puppet", { what: "night", player: p.name, home: h.center });
  discover(p, "the_night_they_turned");
}

/** Tests: begin the night they all turn for a player now (once again). @param {Player} p */
export function nightNow(p) {
  const s = ps(p);
  s.nightTurned = false;
  const was = DEBUG.possess;
  DEBUG.possess = "always";
  nightTurn(p, now());
  DEBUG.possess = was;
  return night.has(p.id);
}

// ---------------------------------------------------------------- tribute

/**
 * A creature it sent away left something behind: the newest thing this player threw away (and walked off from) is
 * moved to where the creature was. At most once every 10 minutes per player. @param {Vec} loc @param {string} dimId
 * @param {(p:Player, minAway:number)=>Entity|undefined} pickItem
 */
export function tribute(loc, dimId, pickItem) {
  if (!on()) return;
  for (const p of allPlayers()) {
    if (p.dimension.id !== dimId || V.dist(p.location, loc) > 64) continue;
    const s = ps(p);
    const t = now();
    if (t < (s.tributeAt ?? 0) || s.stage < 2 || !chance(0.3)) continue;
    const it = pickItem(p, 20);
    if (!it) continue;
    if (!safe(() => {
      it.teleport({ x: loc.x, y: loc.y + 0.2, z: loc.z });
      it.clearVelocity();
      return true;
    }, false)) continue;
    s.tributeAt = t + 600;
    markPlayerDirty(p);
    emit("puppet", { what: "tribute", player: p.name, item: safe(() => it.getComponent("minecraft:item")?.itemStack.typeId, "?"), x: loc.x, y: loc.y, z: loc.z });
    return;
  }
}

// ---------------------------------------------------------------- the rest

/** The other creatures step away from its puppets. */
function keepAway() {
  for (const pp of puppets.all()) {
    if (pp.quiet) continue;
    for (const e of safe(() => pp.e.dimension.getEntities({ location: pp.e.location, maxDistance: 4, families: ["monster"] }), []) ?? []) {
      if (e.id === pp.id || puppets.isPuppet(e) || isHeld(e.id) || standing(e) !== "kin") continue;
      const away = V.flat(V.sub(e.location, pp.e.location));
      safe(() => e.applyImpulse({ x: away.x * 0.35, y: 0, z: away.z * 0.35 }));
      emit("puppet", { what: "kept_away", id: e.id });
    }
  }
}

/** Every second. */
export function tick() {
  if (!on()) return;
  const t = now();
  for (const p of allPlayers()) {
    safe(() => marked(p, t));
    safe(() => cow(p, t));
    safe(() => guards(p, t));
    safe(() => nightTurn(p, t));
  }
  safe(() => keepAway());
}

/** Someone was hurt: the one cow, hit, has the possession torn out of it. @param {Entity} hurt @param {Entity|undefined} by */
export function onHurt(hurt, by) {
  if (!by || by.typeId !== "minecraft:player") return;
  const pp = puppets.get(hurt.id);
  if (!pp || pp.why !== "cow") return;
  puppets.release(pp.id, "torn_out");
  const p = /** @type {Player} */ (by);
  const s = ps(p);
  s.puppets = s.puppets ?? { taken: 0, seen: 0, torn: 0 };
  s.puppets.torn++;
  markPlayerDirty(p);
  discover(p, "its_puppets");
}
