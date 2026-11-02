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
// 1.4.0:
//   its pack             in its rage, the creatures it holds near you are not just let go: they hunt you as one. The
//                        nearest comes straight at you, the next cuts you off where you are running to, and the rest
//                        wait in the doorways and gaps ahead of you (observer/chase.js).
//   the procession       from the fourth stage, one night: the villagers of a village near you walk out of their houses
//                        and stand in a line at the village's edge, facing the Mire, still, until dawn — then they are
//                        back where they were, as if nothing happened.
//   mine first           another creature is about to reach you: it stops it dead, turns it to look at you a moment,
//                        and walks it off into the dark. It is not saving you; you are its, and it does not share.
//   kept below           a kind whatever made it takes back whenever it is up on the surface is kept below: its marked
//                        puppets of that kind are taken only while you are down there too.
// Settings: "It takes creatures for its own" (on). Nothing of another add-on is touched or read (observer/puppets.js).
import { system, world } from "@minecraft/server";
import * as puppets from "./puppets.js";
import { standing, isHeld } from "./dominion.js";
import { primaryHaunt } from "./memory.js";
import { S } from "../core/settings.js";
import { W, ps, now, markPlayerDirty } from "../core/state.js";
import { V, safe, emit, rand, allPlayers, DEBUG } from "../core/util.js";
import { findSpot, hideSpot, standNear } from "../world/space.js";
import { seenByAny, visibility, lineOfSight } from "../world/sight.js";
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
  // a kind taken back from it whenever it is up on the surface is kept below: only while they are down there too
  const up = !underground(p);
  const near = (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 64 }), []) ?? [])
    .filter((e) => kinds.includes(e.typeId) && free(e) && !(up && puppets.keepBelow(e.typeId)))
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


// ---------------------------------------------------------------- its pack (1.4.0)

/**
 * Its rage: the creatures it let go near them (and its own already hunting them) hunt them as one — the nearest comes
 * straight at them, the next cuts them off, the rest wait in the doorways and gaps ahead. @param {Player} p
 * @param {Entity[]} ents @returns {number} how many hunt them
 */
export function packHunt(p, ents) {
  if (!on() || !puppets.mayHunt(p)) return 0;
  const pack = `pack_${system.currentTick}_${p.id}`;
  /** @type {import("./puppets.js").Puppet[]} */
  const members = [];
  for (const pp of puppets.all()) if (pp.p?.id === p.id && pp.mode === "hunt" && !pp.pack) members.push(pp);
  for (const e of ents) {
    if (members.length >= 5) break;
    const pp = puppets.take(e, "pack", { p, mode: "stand", seconds: 30 });
    if (pp) members.push(pp);
  }
  if (!members.length) return 0;
  members.sort((a, b) => V.dist(a.e.location, p.location) - V.dist(b.e.location, p.location));
  members.forEach((pp, i) => {
    pp.pack = pack;
    pp.role = i === 0 ? "driver" : i === 1 ? "cutter" : "blocker";
    puppets.setMode(pp, "hunt");
  });
  packs.set(pack, { pid: p.id, seen: false });
  emit("puppet", { what: "pack", pack, player: p.name, n: members.length, roles: members.map((m) => m.role), ids: members.map((m) => m.id) });
  return members.length;
}
/** pack -> who it hunts, and whether they have seen two of it at once @type {Map<string, {pid:string, seen:boolean}>} */
const packs = new Map();

/** They see two of its pack at once: they know. @param {Player} p */
function packSeen(p) {
  for (const [pack, k] of packs) {
    const members = puppets.packOf(pack);
    if (!members.length) {
      packs.delete(pack);
      continue;
    }
    if (k.pid !== p.id || k.seen) continue;
    const seen = members.filter((m) => visibility(p, m.e.location, { fov: 70 }).points > 0).length;
    if (seen < 2) continue;
    k.seen = true;
    emit("puppet", { what: "pack_seen", pack, player: p.name, seen });
    discover(p, "they_hunt_as_one");
  }
}

// ---------------------------------------------------------------- the procession (1.4.0)

/** player id -> the procession walked out for them tonight @type {Map<string, {until:number, ids:string[], seen:boolean}>} */
const processions = new Map();

/** @param {Player} p @param {number} t */
function procession(p, t) {
  const s = ps(p);
  const tod = safe(() => world.getTimeOfDay(), 6000) ?? 6000;
  const cur = processions.get(p.id);
  if (cur) {
    const mine = puppets.all().filter((pp) => pp.why === "procession" && pp.p?.id === p.id);
    // until dawn (or seven minutes): then they are back where they were, as if nothing happened
    if (tod >= 23000 || tod < 12000 || system.currentTick > cur.until || !mine.length) {
      processions.delete(p.id);
      for (const pp of mine) puppets.release(pp.id, "home");
      emit("puppet", { what: "procession_dawn", player: p.name });
      return;
    }
    if (!cur.seen) {
      const inLine = mine.filter((pp) => pp.mode === "stand" && visibility(p, pp.e.location, { fov: 70 }).points > 0).length;
      if (inLine >= 3) {
        cur.seen = true;
        emit("puppet", { what: "procession_seen", player: p.name, n: inLine });
        discover(p, "the_procession");
      }
    }
    return;
  }
  if (s.stage < 4 || DEBUG.possess === "never" || t < (s.processionAt ?? 0)) return;
  if (!(tod >= 17600 && tod <= 18800) && DEBUG.possess !== "always") return;
  const vs = (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 64, type: "minecraft:villager_v2" }), []) ?? []).filter(free);
  if (vs.length < 3) return;
  // one night in a few
  s.processionAt = t + 600;
  markPlayerDirty(p);
  if (!chance(0.3)) return;
  s.processionAt = t + (DEBUG.possess === "always" ? 30 : 3600);
  walkOut(p, vs.slice(0, 8));
}

/** The villagers walk out and stand in a line at the village's edge, facing the Mire. @param {Player} p @param {Entity[]} vs */
function walkOut(p, vs) {
  const c = vs.reduce((a, e) => V.add(a, e.location), { x: 0, y: 0, z: 0 });
  const center = V.scale(c, 1 / vs.length);
  const r = Math.max(...vs.map((e) => V.hdist(e.location, center)));
  // toward the Mire, if anyone has stood in it; else out into the dark, away from them
  const mire = W.mireAt ? { x: W.mireAt[0], y: center.y, z: W.mireAt[1] } : undefined;
  const dir = mire && V.hdist(mire, center) > 4 ? V.flat(V.sub(mire, center)) : V.flat(V.sub(center, p.location));
  const base = V.add(center, V.scale(dir, r + 5));
  const across = V.rotY(dir, 90);
  const n = vs.length;
  const ids = [];
  let i = 0;
  for (const v of vs) {
    const slot = V.add(base, V.scale(across, (i - (n - 1) / 2) * 1.7));
    i++;
    const st = standNear(p.dimension, slot.x, slot.z, base.y);
    if (!st) continue;
    const pp = puppets.take(v, "procession", { p, mode: "stand", seconds: 420, home: true });
    if (!pp) continue;
    const face = V.add(st.loc, V.scale(dir, 16));
    puppets.setMode(pp, "walk", { to: st.loc, after: "stand", face: { x: face.x, y: st.loc.y + 1.6, z: face.z } });
    ids.push(pp.id);
  }
  if (!ids.length) return;
  processions.set(p.id, { until: system.currentTick + 20 * 420, ids, seen: false });
  emit("puppet", { what: "procession", player: p.name, n: ids.length, dir: { x: Math.round(dir.x * 100) / 100, z: Math.round(dir.z * 100) / 100 }, mire: !!mire });
}

/** Tests: walk the procession out for them now. @param {Player} p */
export function processionNow(p) {
  ps(p).processionAt = 0;
  const was = DEBUG.possess;
  DEBUG.possess = "always";
  const vs = (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 64, type: "minecraft:villager_v2" }), []) ?? []).filter(free);
  if (vs.length >= 3) walkOut(p, vs.slice(0, 8));
  DEBUG.possess = was;
  return processions.has(p.id);
}

// ---------------------------------------------------------------- mine first (1.4.0)

/** Distance from each creature to each player at the last look: is it coming? @type {Map<string, number>} */
const lastD = new Map();

/** Hostile to them: answers to it, or a kind marked as its puppet or rival, or a monster. @param {Entity} e */
function hostile(e) {
  const m = S().marks?.[e.typeId];
  if (m === "ignore") return false;
  if (m === "puppet" || m === "rival" || m === "kin") return true;
  return standing(e) === "kin" || !!safe(() => e.matches({ families: ["monster"] }), false);
}

/** Every few ticks, per player: something about to reach them? @param {Player} p */
function mineFirst(p) {
  const s = ps(p);
  if (s.stage < 2 || DEBUG.mine === "never" || now() < (s.mineAt ?? 0) || puppets.count("mine") > 0) return;
  const near = safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 8, excludeTypes: ["minecraft:player", "minecraft:item"] }), []) ?? [];
  /** @type {Entity|undefined} */
  let coming;
  for (const e of near) {
    if (e.typeId.startsWith("observer:") || !free(e) || !hostile(e)) continue;
    const d = V.hdist(e.location, p.location);
    const k = `${e.id}|${p.id}`;
    const was = lastD.get(k);
    lastD.set(k, d);
    if (d < 2 || d > 7) continue;
    const v = safe(() => e.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
    const toward = V.flat(V.sub(p.location, e.location));
    const closing = v.x * toward.x + v.z * toward.z > 0.04 || (was !== undefined && was - d > 0.15);
    if (!closing) continue;
    const head = safe(() => e.getHeadLocation(), e.location) ?? e.location;
    if (!lineOfSight(p.dimension, head, p.getHeadLocation()).clear) continue;
    coming = e;
    break;
  }
  if (lastD.size > 400) lastD.clear();
  if (!coming) return;
  if (DEBUG.mine !== "always" && Math.random() > 0.35) {
    s.mineAt = now() + 20;
    return;
  }
  s.mineAt = now() + (DEBUG.mine === "always" ? 4 : rand(180, 360) / Math.max(0.5, S().frequency));
  markPlayerDirty(p);
  stopIt(coming, p).catch((err) => console.warn(`[Observer] mine first error: ${err}`));
}

/** It stops it dead, turns it to look at them, and walks it off into the dark. @param {Entity} e @param {Player} p */
async function stopIt(e, p) {
  const pp = puppets.take(e, "mine", { p, mode: "stand", seconds: 40 });
  if (!pp) return;
  const seen = visibility(p, e.location, { fov: 80 }).points > 0;
  emit("puppet", { what: "mine_first", id: pp.id, type: pp.type, player: p.name, seen, d: Math.round(V.hdist(e.location, p.location) * 10) / 10 });
  safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.mine_first" }] }));
  if (seen) discover(p, "mine_first");
  await sleep(30);
  if (puppets.get(pp.id) !== pp) return;
  // off into the dark: away from them, the way it came
  const away = V.flat(V.sub(pp.e.location, p.location));
  /** @type {Vec|undefined} */
  let to;
  for (const off of [0, 30, -30, 60, -60]) {
    const dir = V.rotY(away, off);
    for (const dist of [20, 16, 24]) {
      const at = V.add(p.location, V.scale(dir, dist));
      const st = standNear(p.dimension, at.x, at.z, pp.e.location.y);
      if (!st) continue;
      if (!to) to = st.loc;
      if ((safe(() => p.dimension.getLightLevel({ x: st.loc.x, y: st.loc.y + 1, z: st.loc.z }), 15) ?? 15) <= 7) {
        to = st.loc;
        break;
      }
    }
    if (to) break;
  }
  if (!to) return puppets.release(pp.id, "quiet");
  puppets.setMode(pp, "walk", { to, after: "stand" });
  emit("puppet", { what: "mine_walks_off", id: pp.id, x: to.x, y: to.y, z: to.z });
  for (let i = 0; i < 20 * 20 && puppets.get(pp.id) === pp; i += 10) {
    if (pp.mode === "stand" && V.hdist(pp.e.location, p.location) > 12) break;
    await sleep(10);
  }
  if (puppets.get(pp.id) !== pp) return;
  // let go there; one of Minecraft's own, unseen, is simply gone
  const l = pp.e.location;
  puppets.release(pp.id, pp.type.startsWith("minecraft:") && unseen(pp.dimId, l) ? "gone" : "quiet");
}

/** Every 4 ticks. */
export function fast() {
  if (!on()) return;
  for (const p of allPlayers()) safe(() => mineFirst(p));
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
    safe(() => procession(p, t));
    safe(() => packSeen(p));
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
