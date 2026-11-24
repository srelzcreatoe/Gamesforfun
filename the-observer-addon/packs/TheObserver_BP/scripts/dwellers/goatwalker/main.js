// @ts-nocheck
import * as __dw from "../../link/shared.js";
// =============================================================================
//  THE GOATWALKER  -  director
//  Script API: @minecraft/server 2.9.0 + @minecraft/server-ui 2.0.0 (stable).  No experiments.
//
//  He is the scapegoat that came back.  He lives in the Stellar Taiga, roams the edges of the
//  taiga beyond it, and follows the guilty further.  Every animal you kill adds to his burden.
//  He learns your habits, your routes and your escapes.  When the last candle at his shrine
//  burns out, he hunts.  By day he is mostly a figure in the fog.  Mostly.
// =============================================================================
import { world, system, BlockVolume, GameMode, ItemStack } from "@minecraft/server";
import {
  NS, GW, TAG, PREY, OVERWORLD, STELLAR_IDS, biomeId, SHRINE_AT, RING_AT, CANDLE_BURN, ANIMALS, CANDLES, SMOKE, V, now, rnd, rint, chance, clamp, lerp,
  safe, alive, blockAt, findStand, playAt, playFor, particle, isNight, isDusk, dayIndex, timeOfDay, peaceful, pace, survivalish,
  eye, lineClear, visibleSpot, inCone, scanForest, nearbyTrunks, markTrunk, isIndoors, isUnderground, domainAt, st, saveState,
  STATE, addAnger, inWoods, nearWoods, popFog, clearFogs, music, loadDecay, processDecay, angleOf, shakeCam, hint, say,
  isEclipse, wrathOf, WRATH_NAMES, WRATH_AT, pushFog, fromAngle, jumpscare, } from "./core.js";
import {
  mind, saveMind, observe, observeFight, dailyDecay, habits, usualHour, learnedNode, roomAt, routeAhead, homeOf, describe,
  noteRanged, noteMelee, ESCAPES, ADAPT_AT, adapted, escapeUsed,
} from "./mind.js";
import { WALKERS, Walker, nearestWalker } from "./body.js";
import { Hunt, buildShrine, setRing, burnOne, litCount, tryOffering } from "./hunt.js";
import {
  SignBell, SignHooves, SignGouge, SignScream, SignKnock, Snuff, Flock, AshTrail, EnvShift, Gnaw, Watch, DayWatch,
  TreelineWalk, CaveWatch, Peek, Follow, Breath, Roof, HomeVisit, Stalk, Standoff, Siege, RouteAmbush, Aftermath, ENC_BY_NAME,
  approachReflex, faceYou, Eyes, Mimic, Meta, Behind, Charge, Many, TooSlow, Glimpse, glimpse,
} from "./encounters.js";
import * as SX from "./stellar.js";
import { cfg, setCfg, PACE_NAMES, PACE_OPTS } from "./config.js";
import { openWheel, WHEEL } from "./wheel.js";

system.beforeEvents.startup.subscribe((ev) => SX.registerComponents(ev));

const VERSION = "3.1";
// seconds between one thing and the next, by the tier of the thing that just happened (v3.0: about 40% shorter)
const GAP = { sign: [22, 50], watch: [32, 66], intrude: [38, 76], confront: [50, 95], attack: [60, 110], hunt: [120, 180], after: [40, 80] };
// what his wrath does to the mix: fewer hints and far-off figures, more of him, and then attacks   (by wrath 0..4)
const TIER_W = { sign: [1, 0.9, 0.5, 0.35, 0.25], watch: [1, 1, 0.8, 0.5, 0.35], intrude: [1, 1, 1.2, 1.1, 1.0], confront: [1, 1, 1.4, 1.6, 1.6], attack: [1, 1, 1.4, 1.8, 2.2] };
const GAP_W = [1, 0.95, 0.85, 0.7, 0.55];           // ... and how much less time he leaves you between things
const CHASE_GAP = 20 * 60 * 6;        // at least six minutes between two "Too Slow" chases

// =============================================================== choosing what happens next
function chooseEncounter(p, s) {
  const M = mind(p), H = habits(M);
  const loc = p.location;
  const night = isNight();
  const indoor = isIndoors(p, s), under = s.under, woods = inWoods(s), edge = nearWoods(s);
  const a = s.anger, day = dayIndex();
  const home = homeOf(p, M);
  const atHome = !!home && V.dist(home, loc) < 28;
  if (s.intro < 3 && edge && night && !under && !indoor) {
    const first = [SignBell, SignHooves, woods ? Gnaw : SignGouge][s.intro];
    return [first, [], () => { s.intro++; s.dirty = true; }];
  }
  const pool = [];
  const lastTier = s.lastTier || "";
  // what his anger unlocks: he comes closer at 10, confronts you at 22, and ATTACKS (without waiting for a hunt) at 40
  const gate = { sign: 1, watch: a >= 4 ? 1 : 0.5, intrude: a >= 8 ? 1 : 0, confront: a >= 18 ? 1 : 0, attack: a >= 30 ? 1 : 0 };
  const wr = wrathOf(s);
  const chaseOk = cfg().chase && a >= 34 && now() - (s.lastChase ?? -1e9) > CHASE_GAP;
  const grp = s.group;
  const payoff = !!s.payoff;
  s.payoff = false;
  const add = (cls, w, tier, ...args) => {
    if (!(w > 0) || cls.name === s.last) return;
    let k = w * (gate[tier] ?? 1) * (TIER_W[tier] ? TIER_W[tier][wr] : 1);
    if (tier === lastTier && (tier === "intrude" || tier === "confront" || tier === "attack")) k *= 0.45;   // pacing: let it breathe
    if (payoff && tier === "sign") k = 0;                                                  // the sound was the set-up: now him
    if (payoff && tier === "watch") k *= 0.4;
    if (grp.n >= 1 && !grp.straggler && (tier === "intrude" || tier === "confront" || tier === "attack")) k *= tier === "intrude" ? 0.4 : 0.3;
    if (k > 0) pool.push([cls, k, args]);
  };
  const shiftsOk = s.shiftDay !== day || s.shifts < 2;
  const node = gate.confront ? learnedNode(M, loc, 60) : null;
  const nodeOk = node && V.dist(node, loc) > 18;
  const room = roomAt(M, loc);
  const siegeOk = room && room.c >= 2 && gate.confront && (indoor || under);

  if (under) {
    add(CaveWatch, 5 * (0.6 + H.cave * 2), "watch");
    add(SignHooves, 1, "sign"); add(SignScream, a >= 20 ? 1 : 0, "sign"); add(Snuff, 2, "sign");
    add(Mimic, 2, "sign"); add(Eyes, 2, "sign"); add(Meta, a >= 28 ? 0.7 : 0, "sign"); add(Behind, 2, "intrude"); add(Glimpse, a >= 8 ? 1.5 : 0, "sign");
    if (nodeOk) add(RouteAmbush, 4, "confront", node);
    if (siegeOk) add(Siege, 5, "confront", room);
  } else if (indoor) {
    add(Roof, 3, "intrude"); add(Roof, 1, "sign"); add(Snuff, 2, "sign");
    add(Mimic, 2, "sign"); add(Meta, a >= 28 ? 0.8 : 0, "sign"); add(Behind, a >= 30 ? 1.5 : 0, "intrude");
    if (night && s.knockDay !== day && atHome) add(HomeVisit, 2 + 5 * H.home, "intrude");
    if (siegeOk) add(Siege, 5, "confront", room);
    if (shiftsOk) add(EnvShift, 1, "sign");
  } else if (night) {
    add(SignBell, 2, "sign"); add(SignHooves, 2, "sign"); add(SignGouge, woods ? 2 : 0, "sign"); add(SignKnock, edge ? 1.5 : 0, "sign");
    add(SignScream, a >= 20 ? 1 : 0, "sign"); add(AshTrail, a >= 15 ? 1.5 : 0, "sign"); add(Snuff, 1.5, "sign");
    if (shiftsOk) add(EnvShift, edge ? 1.5 : 0.5, "sign");
    add(Watch, 3, "watch"); add(Watch, woods ? 1.5 : 0, "watch", true);
    if (routeAhead(p, M)) add(Watch, 1 + 6 * H.travel, "watch", false, { route: true });
    add(Gnaw, woods ? 2 : 0, "watch"); add(TreelineWalk, edge ? 2 : 0.5, "watch");
    add(Peek, woods ? 2 : 0, "intrude"); add(Follow, grp.straggler ? 9 : 3, "intrude"); add(Breath, woods ? 1.5 : 0, "intrude");
    add(Stalk, grp.straggler ? 3 : 2, "confront"); add(Standoff, 3, "confront");
    if (nodeOk) add(RouteAmbush, 3, "confront", node);
    // v3.0: eyes in the dark, sounds that should not be there, him behind you, three of him, and the attacks
    add(Eyes, edge ? 2.5 : 1, "sign"); add(Mimic, 2.5, "sign"); add(Meta, a >= 28 ? 0.8 : 0, "sign"); add(Glimpse, a >= 8 ? 3 : 1, "sign");
    add(Behind, 3, "intrude"); add(Many, a >= 40 ? 2.5 : 0, "confront");
    add(Charge, 3.5, "attack"); add(TooSlow, chaseOk ? 3 : 0, "attack");
  } else {
    // by day: mostly a figure in the fog, deep in his own woods
    add(SignGouge, woods ? 2 : 0, "sign"); add(SignKnock, 1, "sign"); if (shiftsOk) add(EnvShift, 1.5, "sign");
    add(DayWatch, 4, "watch"); add(TreelineWalk, 3, "watch"); add(Gnaw, woods ? 1.5 : 0, "watch");
    if (routeAhead(p, M)) add(Watch, 1 + 3 * H.travel, "watch", false, { route: true });
    add(Peek, woods ? 1.5 : 0, "intrude"); add(Follow, a >= 30 ? (grp.straggler ? 4 : 1) : 0, "intrude");
    add(Standoff, a >= 45 ? 1 : 0, "confront");
    if (nodeOk) add(RouteAmbush, 1, "confront", node);
    add(Mimic, 1.5, "sign"); add(Eyes, woods ? 1 : 0, "sign"); add(Behind, a >= 26 ? 2 : 0, "intrude"); add(Glimpse, woods ? 1.5 : 0, "sign");
    add(Many, a >= 60 ? 1 : 0, "confront"); add(Charge, a >= 55 ? 1.5 : 0, "attack"); add(TooSlow, chaseOk && a >= 70 ? 1 : 0, "attack");
  }
  if (!pool.length) return null;
  const total = pool.reduce((t, x) => t + x[1], 0);
  let r = Math.random() * total;
  for (const [cls, w, args] of pool) if ((r -= w) <= 0) return [cls, args, null];
  return [pool[0][0], pool[0][2], null];
}
function startEnc(p, s, cls, args = [], after) {
  const e = new cls(p, s, ...args);
  const ok = safe(() => e.begin(), false);
  if (!ok) { if (e.w) e.w.remove(); return false; }
  s.enc = e;
  s.last = cls.name;
  s.lastTier = e.tier;
  if (after) after();
  return true;
}
function nearOtherWalker(p) {
  for (const w of WALKERS) if (w.ok && w.owner.id !== p.id && w.e.dimension.id === p.dimension.id && V.dist(w.loc, p.location) < 64) return true;
  return false;
}
function scheduleNext(p, s, tier) {
  const M = mind(p), H = habits(M);
  const [a, b] = GAP[tier] || GAP.watch;
  let k = (1 - Math.min(s.sins, 40) / 160) / pace();
  if (!isNight()) k *= 2.4 / (1 + (1 - H.night));             // rarer by day ... less so if you only ever play by day
  if (isEclipse()) k *= 0.6;
  k *= clamp(1.15 - 0.3 * usualHour(M), 0.8, 1.15);            // a little busier at the hours you usually play
  const wr = wrathOf(s);
  k *= GAP_W[wr];
  s.nextAt = now() + Math.floor(rnd(a, b) * k * 20);
  // set-up and pay-off: once he is stalking you, a sound in the dark is often followed, within seconds, by him
  if (tier === "sign" && wr >= 2 && isNight() && chance(wr >= 3 ? 0.5 : 0.3)) { s.nextAt = now() + rint(120, 300); s.payoff = true; }
}

// =============================================================== once a second, per player
function perSecond(p, s, players) {
  const dim = p.dimension;
  const inOver = dim.id === OVERWORLD;
  const night = isNight(), dusk = isDusk();
  const day = dayIndex();
  if (safe(() => p.getGameMode(), GameMode.Survival) === GameMode.Spectator) return;
  const M = mind(p);
  if (inOver && now() - s.domainAt >= 40) { s.domainAt = now(); s.domain = domainAt(dim, p.location); s.under = isUnderground(p); }
  if (!inOver) s.domain = "other";
  if (now() - s.forest.at > 100 && inOver) scanForest(p, s);
  const resting = s.restUntil >= day;
  dailyDecay(M);
  if (inOver) observe(p, s, M);

  // ---------- who is with you (multiplayer)
  const others = players.filter((o) => o.id !== p.id && o.dimension.id === dim.id && survivalish(o));
  const near = others.filter((o) => V.dist(o.location, p.location) < 16).length;
  const far = others.filter((o) => V.dist(o.location, p.location) < 64).length;
  const known = nearWoods(s) || now() - (s.walkerNear || -9999) < 1200;        // he cannot know where everyone is
  s.group = { n: near, straggler: near === 0 && far >= 1 && known };

  // ---------- dawn: anger cools, the hunt clock stops, and sometimes the flock is waiting at your bed
  const tod = timeOfDay();
  if ((s.lastTod < 23000 && tod >= 23000) || (s.lastTod > tod && s.lastTod < 23000)) dawn(p, s);
  s.lastTod = tod;

  // ---------- bleeding
  if (s.bleed && now() >= s.bleed.next) {
    s.bleed.next = now() + 40;
    s.bleed.left--;
    safe(() => p.applyDamage(2, { cause: "magic" }));
    particle(dim, `${NS}:blood_drip`, V.up(p.location, 1.0));
    if (s.bleed.left <= 0) s.bleed = null;
  }
  const nw = nearestWalker(p.location, dim.id, 48);
  if (nw) s.walkerNear = now();
  SX.ambience(p, s, !!nw || (s.enc && s.enc.name === "hunt"));

  if (!inOver || resting) return;

  // ---------- anger drifts
  const hunting0 = !!(s.enc && (s.enc.name === "hunt" || s.enc.name === "tooslow"));
  const P = pace();
  const ecl = isEclipse() ? 1.5 : 1;
  if (night) {
    if (s.domain === "stellar" || s.forest.woods) addAnger(s, (7.0 / 60) * P * ecl * (1 + Math.min(s.sins, 40) / 25));
    else if (nearWoods(s)) addAnger(s, ((s.sins >= 8 ? 2.0 : 0.8) / 60) * P);
    else if (s.sins >= 20 || s.anger >= 40) addAnger(s, (0.8 / 60) * P);   // a heavy burden, or once he is angry: he follows you home
  } else if (s.domain === "stellar") addAnger(s, (1.6 / 60) * P);  // he notices you in his woods by day too
  else if (!s.enc) addAnger(s, -(0.4 / 60));

  // ---------- wrath: what his anger has made him.  You are told when it changes, and the woods change with it.
  const wr = wrathOf(s);
  if (wr !== (s.wrath ?? 0)) {
    if (wr > (s.wrath ?? 0) && now() - (s.wrathSaid || 0) > 200) {
      s.wrathSaid = now();
      hint(p, ["", "§8Something has noticed you.", "§7He is following you.", "§4He is angry.", "§4§lHE IS COMING FOR YOU."][wr]);
      if (wr >= 3) { playFor(p, wr === 4 ? "goatwalker.roar" : "goatwalker.growl", V.add(eye(p), V.mul(fromAngle(rnd(0, 6.28)), 18)), 1.4, 0.85); shakeCam(p, 0.08, 0.8); }
      else if (wr === 2) playFor(p, "goatwalker.laugh.far", V.add(eye(p), V.mul(fromAngle(rnd(0, 6.28)), 24)), 1.0);
    }
    s.wrath = wr;
  }
  // ---------- once he is stalking you: a glimpse of him, at the edge of your eye, between everything else
  if (wr >= 2 && !s.enc && (night || s.domain === "stellar") && (nearWoods(s) || s.domain === "stellar" || s.under)
      && now() >= (s.glimpseAt || 0) && chance((wr >= 3 ? 1 / 35 : 1 / 60) * P)) {
    s.glimpseAt = now() + 20 * 25;
    glimpse(p);
  }
  const brooding = wr >= 3 && !hunting0 && (nearWoods(s) || night);
  if (brooding) { pushFog(p, s, "wrath"); if (!s.music) music(p, s, "goatwalker.music.wrath"); }
  else { popFog(p, s, "wrath"); if (s.music === "goatwalker.music.wrath") music(p, s, ""); }

  // ---------- smoke at night draws him
  if (night && now() >= s.nextSmoke) {
    s.nextSmoke = now() + 600;
    const c = V.floor(p.location);
    const src = safe(() => {
      const vol = new BlockVolume({ x: c.x - 14, y: c.y - 6, z: c.z - 14 }, { x: c.x + 14, y: c.y + 6, z: c.z + 14 });
      for (const l of dim.getBlocks(vol, { includeTypes: SMOKE }, false).getBlockLocationIterator()) {
        const b = blockAt(dim, l);
        if (b && b.typeId.includes("campfire") && b.permutation.getState("extinguished") === true) continue;
        return { x: l.x, y: l.y, z: l.z };
      }
      return null;
    }, null);
    if (src) { s.smoke = { pos: src, at: now() }; if (nearWoods(s) || s.sins >= 8) addAnger(s, 1.0 * P); }
  }

  // ---------- shrine: forms, lights, burns down
  const hunting = !!(s.enc && s.enc.name === "hunt");
  if (!s.shrine && s.anger >= SHRINE_AT && night && nearWoods(s) && !s.under && now() % 200 < 20) buildShrine(p, s);
  if (s.shrine && night && !s.shrine.lit && s.anger >= RING_AT && !hunting && s.lastHuntDay !== day) {
    s.shrine.lit = true;
    setRing(p, s, 8);
    s.shrine.nextBurn = now() + Math.floor(CANDLE_BURN * 20 / P);
    playFor(p, "goatwalker.bell.far", V.add(eye(p), V.mul(V.normH(V.sub(s.shrine, p.location)), 26)), 1.0, 0.9);
    s.dirty = true;
  }
  if (s.shrine && s.shrine.lit && night && !hunting && now() >= s.shrine.nextBurn
      && !((s.shrine.litMem ?? 8) <= 1 && (tod > 21400 || peaceful()))) {   // never the last candle at dawn (or in peaceful)
    const burn = CANDLE_BURN / (1 + Math.min(s.sins, 50) / 60) / P * (s.anger >= 90 ? 0.5 : 1) * (isEclipse() ? 0.7 : 1);
    s.shrine.nextBurn = now() + Math.floor(burn * 20);
    const left = burnOne(p, s);
    if (left <= 0 && !hunting && !nearOtherWalker(p)) {
      if (s.enc) s.enc.finish(0);
      s.enc = null;
      startEnc(p, s, Hunt);
    }
  }
  // no shrine could be built: the hunt comes at full anger instead
  if (!s.shrine && s.anger >= 99 && night && !hunting && s.lastHuntDay !== day && !peaceful() && !nearOtherWalker(p)) {
    if (s.enc) s.enc.finish(0);
    s.enc = null;
    startEnc(p, s, Hunt);
  }

  // ---------- the bell: if you can hear it, you are safe.  When it stops, run.
  if (night && s.anger >= 25 && !hunting && now() >= s.nextBell && !(s.enc && s.enc.w)) {
    const left = s.shrine && s.shrine.lit ? (s.shrine.litMem ?? 8) : 9;
    s.nextBell = now() + (left <= 2 ? rint(120, 170) : s.anger >= RING_AT ? rint(300, 600) : rint(500, 1000));
    if (left > 0) {
      const a = s.shrine && chance(0.6) ? angleOf(V.normH(V.sub(s.shrine, p.location))) + rnd(-0.5, 0.5) : rnd(0, 6.28);
      playFor(p, "goatwalker.bell.far", V.add(eye(p), { x: Math.cos(a) * rnd(24, 34), y: 3, z: Math.sin(a) * rnd(24, 34) }), 1.0, rnd(0.95, 1.03));
    }
  }

  // ---------- he waits on your roof after the hooves
  if (s.roofWatch && now() > s.roofWatch.until) s.roofWatch = null;
  if (s.roofWatch && !s.enc && night && !isIndoors(p, s)) {
    const rw = s.roofWatch;
    s.roofWatch = null;
    const pos = findStand(dim, rw.at.x, rw.at.z, rw.y + 1, { up: 3, down: 3, allowLeaves: true });
    if (pos && !visibleSpot(p, pos)) startEnc(p, s, Watch, [true, { at: pos, limit: 40 }]);
  }

  // ---------- dusk: the flock turns (once a day, once he knows you)
  if (dusk && !s.enc && s.anger >= 12 && s.flockDay !== day && nearWoods(s)) {
    s.flockDay = day;
    if (chance(0.6)) startEnc(p, s, Flock);
  }

  // ---------- forest dressing: old gouges and gnawed bark appear deep in the trees, by day too
  if (inWoods(s) && now() >= s.nextDress) {
    s.nextDress = now() + rint(300, 600);
    if (s.decor < 40 && chance(0.6)) {
      for (const t of nearbyTrunks(p, s, 16, 30).slice(0, 6)) {
        const at = { x: t.bx ?? t.x, y: t.y0 + rint(1, 2), z: t.bz ?? t.z };
        if (visibleSpot(p, at, 0.3)) continue;
        if (markTrunk(dim, at, chance(0.35) ? 2 : 1, p.location)) { s.decor++; break; }
      }
    }
  }

  // ---------- aftermath: traces of him where you hid, and sometimes him
  if (s.after && !s.enc && now() >= s.after.at) {
    const info = s.after;
    s.after = null;
    startEnc(p, s, Aftermath, [info]);
  }

  // ---------- scheduled encounters (night, and by day in his woods)
  if (s.enc || now() < s.nextAt || now() < s.quietUntil || nearOtherWalker(p)) return;
  const H = habits(M);
  const eligible = night
    ? (nearWoods(s) || s.sins >= 8 || s.anger >= 25 || (s.anger >= 12 && !!homeOf(p, M) && V.dist(homeOf(p, M), p.location) < 28))
    : (s.domain === "stellar" || (s.domain === "taiga" && s.sins >= 12) || (H.night < 0.3 && H.seasoned && s.anger >= 20 && nearWoods(s)));
  if (!eligible || (!night && !cfg().day)) { s.nextAt = now() + 400; return; }
  const pickd = chooseEncounter(p, s);
  if (!pickd) { s.nextAt = now() + 200; return; }
  const [cls, args, after] = pickd;
  if (startEnc(p, s, cls, args || [], after || undefined)) scheduleNext(p, s, s.enc ? s.enc.tier : "watch");
  else s.nextAt = now() + 200;
}

function dawn(p, s) {
  const day = dayIndex();
  if (s.enc && !(s.enc.name === "hunt" && s.domain === "stellar")) { s.enc.finish(0); s.enc = null; }
  for (const k of [...s.fogs]) if (k !== "hunt" || !s.enc) popFog(p, s, k);
  if (!s.enc) music(p, s, "");
  if (s.anger >= 40 || s.huntedTonight) dawnRing(p, s);
  s.anger *= 0.6;
  if (s.offerDay !== day - 1 && s.offerDay !== day) s.offers = Math.max(0, s.offers - 1);
  s.meals = Math.max(0, s.meals - 1);                      // a day without his flock or the horn: a little less each
  s.horns = Math.max(0, s.horns - 1);
  if (s.shrine && s.shrine.lit) { s.shrine.lit = false; setRing(p, s, 0); }
  s.huntedTonight = false;
  s.dirty = true;
}
/** Morning after a bad night: your sheep and goats stand in a ring around your bed, and the door is open. */
function dawnRing(p, s) {
  const sp = safe(() => p.getSpawnPoint());
  if (!sp || sp.dimension.id !== OVERWORLD) return;
  const dim = sp.dimension;
  const bed = { x: sp.x + 0.5, y: sp.y, z: sp.z + 0.5 };
  if (V.dist(bed, p.location) > 64) return;
  const flock = safe(() => dim.getEntities({ location: bed, maxDistance: 48 })
    .filter((e) => e.typeId === "minecraft:sheep" || e.typeId === "minecraft:goat").slice(0, 8), []);
  flock.forEach((e, i) => {
    const a = (i / Math.max(flock.length, 1)) * Math.PI * 2;
    const pos = findStand(dim, bed.x + Math.cos(a) * 3, bed.z + Math.sin(a) * 3, bed.y, { up: 2, down: 3, height: 2 });
    if (!pos) return;
    safe(() => e.teleport(pos, { facingLocation: V.up(bed, 0.5) }));
    safe(() => e.addEffect("slowness", 20 * 25, { amplifier: 8, showParticles: false }));
  });
  const c = V.floor(bed);
  safe(() => {
    const vol = new BlockVolume({ x: c.x - 7, y: c.y - 2, z: c.z - 7 }, { x: c.x + 7, y: c.y + 3, z: c.z + 7 });
    for (const l of dim.getBlocks(vol, { excludeTypes: ["minecraft:air"] }, false).getBlockLocationIterator()) {
      const b = blockAt(dim, l);
      if (!b) continue;
      if (/_door$/.test(b.typeId) && !b.typeId.includes("iron") && b.permutation.getState("upper_block_bit") === false) {
        b.setPermutation(b.permutation.withState("open_bit", true));
        playAt(dim, "goatwalker.door", V.add(l, { x: 0.5, y: 1, z: 0.5 }), 0.6);
        break;
      }
      if (b.typeId === `${NS}:void_door_block` && b.permutation.getState(`${NS}:upper`) === false) {
        const top = b.above();
        b.setPermutation(b.permutation.withState(`${NS}:open`, true));
        if (top && top.typeId === b.typeId) top.setPermutation(top.permutation.withState(`${NS}:open`, true));
        playAt(dim, "goatwalker.door", V.add(l, { x: 0.5, y: 1, z: 0.5 }), 0.6);
        break;
      }
    }
  });
}

// =============================================================== eating his flock
/** Every sheep you eat angers him more than the last, and is added to your burden. */
function ateSheep(p) {
  const s = st(p);
  const n = s.meals;
  s.meals = n + 1;
  s.sins += 1;
  addAnger(s, Math.min(4 + 2 * n, 20) * pace());
  s.dirty = true;
  // he smells it: a scream far off at night, the bell by day; a growl if he is already close
  const a = s.shrine ? angleOf(V.normH(V.sub(s.shrine, p.location))) + rnd(-0.6, 0.6) : rnd(0, 6.28);
  const r = Math.max(26, 46 - 3 * n);
  system.runTimeout(() => {
    if (!alive(p)) return;
    const at = V.add(p.location, { x: Math.cos(a) * r, y: 4, z: Math.sin(a) * r });
    if (isNight()) playFor(p, "goatwalker.scream.far", at, 0.8 + Math.min(n, 6) * 0.05, rnd(0.9, 1.0));
    else playFor(p, "goatwalker.bell.far", at, 0.9, 0.9);
  }, rint(40, 80));
  if (s.enc && s.enc.w && s.enc.w.ok) { s.enc.w.twitch(); playAt(s.enc.w.e.dimension, "goatwalker.growl", V.up(s.enc.w.loc, 2.2), 1.1, 0.85); }
  if (n === 0) system.runTimeout(() => alive(p) && hint(p, "§8Somewhere in the trees, something smelled that."), 120);
}

// =============================================================== heartbeat
function heartbeat(p, s) {
  if (now() < s.beatAt) return;
  const hunted = !!(s.enc && s.enc.name === "hunt" && s.enc.state !== "start") || p.hasTag(PREY);
  const nw = nearestWalker(p.location, p.dimension.id, 40);
  if (!nw && !hunted) { s.beatAt = now() + 20; return; }
  const d = nw ? nw.d : 40;
  const close = clamp(1 - (d - 3) / 34, 0, 1);
  const k = clamp(0.6 * close + 0.25 * (s.anger / 100) + (hunted ? 0.3 : 0), 0, 1);
  if (k < 0.15) { s.beatAt = now() + 20; return; }
  s.beatAt = now() + Math.round(lerp(24, 8, k));
  playFor(p, "goatwalker.heartbeat", V.up(p.location, 1.0), 0.35 + 0.55 * k, 0.9 + 0.25 * k);
  if (k > 0.3) shakeCam(p, 0.01 + 0.05 * k, 0.15);
}
/** The Lens, outside a hunt: hold him in it and he jerks, and is gone. */
function lensCheck(p, s) {
  const e = s.enc;
  if (!s.lens || !e || !e.w || !e.w.ok || e.name === "hunt") return;
  const w = e.w;
  if (V.dist(w.loc, p.location) > 64 || !inCone(p, V.up(w.loc, 1.6), 0.96) || !lineClear(p.dimension, eye(p), V.up(w.loc, 2))) { e.lensed = 0; return; }
  e.lensed = (e.lensed || 0) + 0.1;
  if (e.lensed > 0.4 && !e.lensTwitch) { e.lensTwitch = true; w.twitch(); playFor(p, "goatwalker.lens", eye(p), 0.7); }
  if (e.lensed > 1.4) { w.vanish({ ash: true }); e.finish(60); s.enc = null; }
}

// =============================================================== events
function walkerOf(entity) {
  for (const w of WALKERS) if (w.isWalker(entity)) return w;
  return null;
}
function huntOwning(w) {
  for (const s of STATE.values()) if (s.enc && s.enc.name === "hunt" && s.enc.w === w) return s.enc;
  return null;
}
world.afterEvents.entityDie.subscribe((ev) => {
  const dead = ev.deadEntity;
  const killer = ev.damageSource && (ev.damageSource.damagingEntity || undefined);
  const id = safe(() => dead.typeId, "");
  if (id === GW) {
    const loc = safe(() => dead.location);
    const dim = safe(() => dead.dimension);
    if (loc && dim) { particle(dim, `${NS}:ash_burst`, loc); }
    for (const w of [...WALKERS]) {
      if (!w.isWalker(dead)) continue;
      w.dead = true; WALKERS.delete(w); w.untag();
      if (alive(w.m)) safe(() => w.m.remove());
      for (const s of STATE.values()) {
        if (!s.enc || s.enc.w !== w) continue;
        if (s.enc.name === "hunt") { s.enc.w = null; s.enc.end("killed"); } else s.enc.finish(60);
        s.enc = null;
      }
      const s = st(w.owner);
      s.anger = 0; s.restUntil = dayIndex() + 2; s.dirty = true;
      if (s.shrine) { setRing(w.owner, s, 0); s.shrine.lit = false; }
      if (alive(w.owner)) hint(w.owner, "§8...the ash settles.  For now.");
    }
    return;
  }
  if (killer && killer.typeId === "minecraft:player" && ANIMALS[id]) {
    const p = /** @type {import("@minecraft/server").Player} */ (killer);
    const s = st(p);
    s.sins += ANIMALS[id];
    s.kills.push(id === "minecraft:sheep" || id === "minecraft:goat" ? id : "bones");
    if (s.kills.length > 6) s.kills.shift();
    if (isNight() && nearWoods(s)) addAnger(s, ANIMALS[id] === 3 ? 6 : 2);
    if (ANIMALS[id] === 3 && s.enc && s.enc.w && s.enc.w.ok) playAt(s.enc.w.e.dimension, "goatwalker.growl", V.up(s.enc.w.loc, 2.2), 1.0, 0.8);
    s.dirty = true;
  }
  if (id === "minecraft:player") {
    const s = STATE.get(dead.id);
    if (s) {
      if (s.enc && s.enc.name === "hunt") s.enc.end("died");
      s.sins = Math.floor(s.sins * 0.6);                           // he carries some of it away with you
      s.bleed = null; s.dirty = true;
    }
    // hunted by someone else's hunt: that hunt moves on to the next of you, or ends
    for (const so of STATE.values()) {
      const h = so.enc;
      if (h && h.name === "hunt" && h.target && h.target.id === dead.id && !h.done) {
        const next = h.style === "cull" ? h.nextVictim() : null;
        if (next && next.id !== dead.id) h.retarget(next); else h.end("died");
      }
    }
  }
});

world.afterEvents.entityHurt.subscribe((ev) => {
  const hurt = ev.hurtEntity;
  const by = ev.damageSource.damagingEntity;
  if (by && by.typeId === GW && hurt.typeId === "minecraft:player") {
    const p = /** @type {import("@minecraft/server").Player} */ (hurt);
    const s = st(p);
    s.bleed = { left: 3, next: now() + 40 };                      // Rupturing Strike: bleeds until milk or a field kit
    safe(() => p.camera.fade({ fadeColor: { red: 0.3, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.05, holdTime: 0.05, fadeOutTime: 0.7 } }));
    hint(p, "§4You are bleeding");
    const w = walkerOf(by);
    const h = w && huntOwning(w);
    if (h) h.onHitPlayer(p);
    return;
  }
  if (hurt.typeId === GW) {
    const w = walkerOf(hurt);
    if (!w) return;
    const ranged = ev.damageSource.cause === "projectile";
    const shooter = by && by.typeId === "minecraft:player" ? by : null;
    if (!shooter) return;
    const h = huntOwning(w);
    if (h) { h.onHurt(w, shooter, ranged); return; }
    const s = st(w.owner), M = mind(shooter);
    if (ranged) M.shots = Math.min(6, M.shots + 1);
    addAnger(s, 15);
    playAt(hurt.dimension, "goatwalker.growl", V.up(hurt.location, 2.2), 1.2, 0.8);
    w.vanish({ ash: true, blood: true });
    if (s.enc && s.enc.w === w) { s.enc.finish(60); s.enc = null; }
  }
});

// watching you fight ordinary monsters
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const p = ev.damagingEntity, mob = ev.hitEntity;
  if (!p || p.typeId !== "minecraft:player" || !mob || mob.typeId === GW) return;
  if (!safe(() => mob.matches({ families: ["monster"] }), false)) return;
  const s = st(/** @type {any} */ (p));
  s.fight = { mob, t: now() };
  noteMelee(mind(/** @type {any} */ (p)));
});
world.afterEvents.projectileHitEntity.subscribe((ev) => {
  const src = ev.source, hit = safe(() => ev.getEntityHit().entity);
  const proj = ev.projectile;
  if (safe(() => proj.typeId) === `${NS}:flare`) {
    SX.igniteFlare(proj, ev.location, ev.dimension);
    if (hit && hit.typeId === GW && src && src.typeId === "minecraft:player") {
      const w = walkerOf(hit), M = mind(/** @type {any} */ (src));
      if (w && !adapted(M, "flare")) {
        escapeUsed(/** @type {any} */ (src), M, "flare", st(/** @type {any} */ (src)));
        const h = huntOwning(w);
        if (h) h.startMan("cover", h.pd);
        else { w.twitch(); w.vanish({ ash: true }); const s = st(w.owner); if (s.enc && s.enc.w === w) { s.enc.finish(60); s.enc = null; } }
      }
    }
    return;
  }
  if (src && src.typeId === "minecraft:player" && hit && hit.typeId !== GW && safe(() => hit.matches({ families: ["monster"] }), false)) {
    const s = st(/** @type {any} */ (src));
    s.fight = { mob: hit, t: now() };
    noteRanged(mind(/** @type {any} */ (src)));
  }
});
world.afterEvents.projectileHitBlock.subscribe((ev) => {
  if (safe(() => ev.projectile.typeId) === `${NS}:flare`) SX.igniteFlare(ev.projectile, ev.location, ev.dimension);
});

world.afterEvents.itemUse.subscribe((ev) => {
  const p = ev.source, id = ev.itemStack.typeId;
  if (id === WHEEL) { system.run(() => { if (alive(p)) openWheel(p, WHEEL_API); }); return; }
  if (id === `${NS}:old_map`) { SX.readMap(p); return; }
  if (id === `${NS}:ritual_note`) { SX.readNote(p); return; }
  if (p.dimension.id !== OVERWORLD) return;
  const s = st(p);
  if (id === "minecraft:goat_horn") {
    // he answers, day or night, and every call angers him more than the last.  His answer comes from closer each time.
    const n = s.horns;
    s.horns = n + 1;
    addAnger(s, Math.min(10 + 4 * n, 30) * pace());
    const a = s.shrine ? angleOf(V.normH(V.sub(s.shrine, p.location))) : rnd(0, 6.28);
    const r = Math.max(24, 52 - 6 * n);
    system.runTimeout(() => {
      if (alive(p)) playFor(p, "goatwalker.horn.answer", V.add(p.location, { x: Math.cos(a) * r, y: 6, z: Math.sin(a) * r }), 1.6);
    }, rint(50, 80));
    if (s.enc && s.enc.w && s.enc.w.ok) { s.enc.w.twitch(); playAt(s.enc.w.e.dimension, "goatwalker.growl", V.up(s.enc.w.loc, 2.2), 1.2, 0.8); }
    if (s.shrine && s.shrine.lit && s.anger >= 75) { burnOne(p, s); if (s.anger >= 90) burnOne(p, s); }
    if (n === 0) system.runTimeout(() => alive(p) && hint(p, "§8Something out there answered."), 100);
    s.dirty = true;
  } else if (id === `${NS}:goatwalker_horn`) {
    if (now() < s.hornCd) return;
    s.hornCd = now() + 20 * 20;
    const dim = p.dimension;
    playAt(dim, "goatwalker.horn.blow", eye(p), 1.4);
    playAt(dim, "goatwalker.growl", eye(p), 0.7, 0.7);
    particle(dim, `${NS}:ash_burst`, p.location);
    for (const m of safe(() => dim.getEntities({ location: p.location, maxDistance: 16, families: ["monster"] }), [])) {
      const away = V.normH(V.sub(m.location, p.location));
      safe(() => m.applyKnockback({ x: away.x * 1.6, z: away.z * 1.6 }, 0.4));
      safe(() => m.addEffect("slowness", 200, { amplifier: 1 }));
      safe(() => m.addEffect("weakness", 200, { amplifier: 1 }));
    }
    if (s.enc && s.enc.name === "hunt") {
      if (s.hornDay !== dayIndex()) { s.hornDay = dayIndex(); s.enc.end("horn"); }
      else if (s.enc.w && s.enc.w.ok) playAt(dim, "goatwalker.growl", V.up(s.enc.w.loc, 2.2), 1.3, 0.75);
    } else addAnger(s, -5);
    s.dirty = true;
  }
});
world.afterEvents.itemStartUse.subscribe((ev) => {
  if (ev.itemStack.typeId === `${NS}:the_lens`) { const s = st(ev.source); s.lens = true; s.lensAt = now(); playFor(ev.source, "goatwalker.lens", eye(ev.source), 0.5, 1.1); }
});
world.afterEvents.itemStopUse.subscribe((ev) => {
  if (!ev.itemStack || ev.itemStack.typeId === `${NS}:the_lens`) st(ev.source).lens = false;
});
world.afterEvents.itemCompleteUse.subscribe((ev) => {
  const id = ev.itemStack.typeId, p = ev.source;
  if ((id === "minecraft:mutton" || id === "minecraft:cooked_mutton") && p.dimension.id === OVERWORLD) { ateSheep(p); return; }
  if (id === `${NS}:the_lens`) st(p).lens = false;
  else if (id === `${NS}:field_kit`) SX.useKit(p);
  else if (id === "minecraft:milk_bucket") {
    const s = st(p);
    if (s.bleed) { s.bleed = null; hint(p, "§7The bleeding stops"); }
  }
});

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (SX.interact(ev)) return;
  const b = ev.block;
  if (ev.isFirstEvent && /^minecraft:(chest|barrel)$/.test(b.typeId)) SX.maybeFill(b);
  if (!ev.isFirstEvent || !ev.itemStack || ev.itemStack.typeId !== "minecraft:mutton") return;
  if (!/(_log$|_wood$|_stem$|stripped_)/.test(b.typeId)) return;
  const p = ev.player;
  system.run(() => { if (alive(p)) tryOffering(p, b); });
});
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  SX.notePlaced(ev.block);
  SX.leafPlaced(ev.block);
});
world.afterEvents.entityHitBlock.subscribe((ev) => safe(() => SX.hitBlock(ev)));

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  const p = ev.player;
  const id = ev.brokenBlockPermutation.type.id;
  safe(() => SX.logGone(ev.block.dimension, ev.block.location, id));
  if (p.dimension.id !== OVERWORLD) return;
  const s = st(p);
  // breaking his candles angers him and speeds the clock
  if (s.shrine && CANDLES.includes(id) && s.shrine.ring.some((r) => r.x === ev.block.location.x && r.y === ev.block.location.y && r.z === ev.block.location.z)) {
    addAnger(s, 12);
    if (s.shrine.lit) s.shrine.nextBurn = Math.min(s.shrine.nextBurn, now() + 60);
  }
  // his woods are his: felling his trees annoys him, and taking down his signs enrages him
  if (s.domain === "stellar" || s.forest.woods) {
    if (/goatwalker:(void_log|charred_log|carved_void_log|stripped_void_log)$/.test(id)) addAnger(s, 0.5);
    else if (/skeleton_skull$|goatwalker:(trophy_head|tattered_cloth|hanging_banner|ritual_wood)$|red_candle$/.test(id)) {
      addAnger(s, 6);
      if (now() - (s.defiledAt || 0) > 400) { s.defiledAt = now(); hint(p, "§8Something heard that."); playFor(p, "goatwalker.growl", V.add(eye(p), V.mul(fromAngle(rnd(0, 6.28)), 20)), 1.2, 0.8); }
    }
  }
  // the echo: the sound of what you just broke comes back from deep in the trees
  if (isNight() && s.anger >= 25 && nearWoods(s) && chance(0.1) && !(s.enc && s.enc.name === "hunt")) {
    const snd = /log|planks|wood|stem/.test(id) ? "dig.wood" : /dirt|grass|podzol|snow|sand|gravel|mud|soil/.test(id) ? "dig.grass" : "dig.stone";
    const back = V.mul(V.normH(p.getViewDirection()), -rnd(22, 30));
    system.runTimeout(() => {
      if (!alive(p)) return;
      const at = V.add(p.location, back);
      playFor(p, snd, at, 1.0, 0.92);
      system.runTimeout(() => alive(p) && playFor(p, snd, at, 0.9, 0.9), 9);
    }, rint(30, 55));
  }
});

world.afterEvents.entityLoad.subscribe((ev) => {
  const e = ev.entity;
  if (!safe(() => e.hasTag(TAG), false)) return;
  for (const w of WALKERS) if ((w.e && w.e.id === e.id) || (w.m && w.m.id === e.id)) return;
  safe(() => e.remove());
});

// is the Stellar Taiga registered?  /locate only knows biomes that loaded, so a syntax error means it did not
let biomeName = STELLAR_IDS[0];
function locateState(p, id) {
  try {
    const r = p.runCommand(`locate biome ${id}`);
    return r && r.successCount > 0 ? "found" : "registered";
  } catch (err) {
    return /syntax|unexpected|unknown|invalid/i.test(String((err && err.message) || err)) ? "missing" : "registered";
  }
}
function biomeState(p) {
  let best = "missing";
  for (const id of STELLAR_IDS) {
    const st = locateState(p, id);
    if (st !== "missing" && best !== "found") { best = st; biomeName = id; }
  }
  return best;
}
const MISSING = `§cThe Stellar Taiga did not load in this world.§7 Check the world's packs both say ${VERSION}.0 (if not, delete the old Goatwalker packs in Settings > Storage and import again). If they do, turn on Settings > Creator > Content Log GUI, reopen the world and send a picture of the red lines.`;
let biomeChecked = false;
function checkBiomeOnce(p) {
  if (biomeChecked) return;
  biomeChecked = true;
  system.runTimeout(() => safe(() => { if (p.isValid && biomeState(p) === "missing") say(p, MISSING); }), 200);
}

// ================================================================= a new world starts at the edge of his woods
// The nearest Stellar Taiga is worked out from the world seed, and the world spawn is moved to just outside it
// (about 50 blocks short of its edge, facing it), so his woods are there from the first minute.  Only once per
// world, only in a brand-new world, and only if they are not already close.  /scriptevent goatwalker:spawn
// takes you to the edge of the nearest Stellar Taiga at any time (and sets your own spawn point there).
const SPAWN_DONE = "gw:spawnNearWoods";
function findWoods(dim, from) {
  for (const id of STELLAR_IDS) {
    const at = safe(() => dim.calculateClosestBiomeFromSeed({ x: from.x, y: 64, z: from.z }, id, { boundingSize: { x: 12000, y: 256, z: 12000 } }), undefined);
    if (at) return at;
  }
  return undefined;
}
const WAY = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"];
function wayTo(from, to) {
  const yaw = Math.atan2(-(to.x - from.x), to.z - from.z) * 180 / Math.PI;
  return WAY[((Math.round(yaw / 45) % 8) + 8) % 8];
}
function startNearWoods(p, onDemand) {
  const dim = world.getDimension(OVERWORLD);
  const from = onDemand ? p.location : (safe(() => world.getDefaultSpawnLocation(), null) || p.location);
  const at = findWoods(dim, from);
  if (!at) { if (onDemand) say(p, "§7There is no Stellar Taiga anywhere near here."); return; }
  if (!onDemand) safe(() => world.setDynamicProperty(SPAWN_DONE, true));
  const d = V.distH(from, at);
  if (d < 140) {                                           // already close
    if (onDemand) say(p, `§7His woods are already close: ${Math.round(d)} blocks to the ${wayTo(p.location, at)}.`);
    return;
  }
  const dir = V.normH(V.sub(at, from));
  const x = Math.floor(at.x - dir.x * 50), z = Math.floor(at.z - dir.z * 50);
  const settle = () => {
    if (!alive(p)) return;
    let l = p.location;
    const top = safe(() => dim.getTopmostBlock({ x: Math.floor(l.x), z: Math.floor(l.z) }), undefined);
    if (top && Math.abs(top.y + 1 - l.y) > 2) l = { x: Math.floor(l.x) + 0.5, y: top.y + 1, z: Math.floor(l.z) + 0.5 };
    const spot = { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
    safe(() => p.teleport(l, { facingLocation: { x: at.x, y: l.y + 1.6, z: at.z } }));
    safe(() => p.removeEffect("slow_falling"));
    if (!onDemand) safe(() => world.setDefaultSpawnLocation(spot));
    safe(() => p.setSpawnPoint({ dimension: dim, ...spot }));
    say(p, onDemand ? `§7The edge of his woods. Your spawn point is set here.` : `§8§oThe trees to the ${wayTo(spot, at)} are wrong. Something lives in them.`);
  };
  // spreadplayers finds solid, dry ground there (and loads it); if it can't, drop in slowly from above
  const ok = safe(() => p.runCommand(`spreadplayers ${x} ${z} 0 12 @s`).successCount > 0, false);
  if (!ok) {
    safe(() => p.addEffect("slow_falling", 400, { amplifier: 0, showParticles: false }));
    safe(() => p.teleport({ x: x + 0.5, y: 200, z: z + 0.5 }));
    system.runTimeout(settle, 60);
  } else system.runTimeout(settle, 20);
}
function maybeStartNearWoods(p) {
  if (safe(() => world.getDynamicProperty(SPAWN_DONE), false)) return;
  const age = safe(() => world.getAbsoluteTime(), 1e9);
  if (age > 20 * 60 * 5) { safe(() => world.setDynamicProperty(SPAWN_DONE, true)); return; }   // not a new world
  system.runTimeout(() => safe(() => startNearWoods(p, false)), 30);
}

/** The Wheel: you arrive with one, and you are handed another every time you die (if you do not still have one). */
function giveWheel(p) {
  if (!cfg().wheel) return;
  safe(() => {
    const inv = p.getComponent("minecraft:inventory").container;
    for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it && it.typeId === WHEEL) return; }
    inv.addItem(new ItemStack(WHEEL, 1));
    hint(p, "§7The Wheel: use it to choose how he behaves, or to make him do something.");
  });
}


// ================================================================= The Wheel: what it can ask of him
/** forget whatever he was doing, and look at where you are standing now */
function freshFor(p, s) {
  scanForest(p, s);
  s.domain = domainAt(p.dimension, p.location);
  s.under = isUnderground(p);
  if (s.enc) { safe(() => s.enc.finish(0)); s.enc = null; }
  s.quietUntil = 0;
}
function shortPursuit(p, s) {
  const w = new Walker(p);
  let pos;
  const yaw = angleOf(p.getViewDirection());
  for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 2, -2, Math.PI]) {
    for (const r of [14, 11, 17]) {
      pos = findStand(p.dimension, p.location.x + Math.cos(yaw + da) * r, p.location.z + Math.sin(yaw + da) * r, p.location.y);
      if (pos) break;
    }
    if (pos) break;
  }
  if (!pos || !w.spawn(pos, p.location)) { w.remove(); return false; }
  s.enc = new Hunt(p, s, { short: true, walker: w, instant: true });
  return true;
}
/** Make him do one thing, now, to this player.  True if it started (false: there is no place for it here). */
function runTest(p, key) {
  const s = st(p), M = mind(p);
  freshFor(p, s);
  s.nextAt = Math.max(s.nextAt, now() + 20 * 25);          // and nothing else on top of it for a moment
  if (key === "hunt") return startEnc(p, s, Hunt, [{ instant: true }]);
  if (key === "pursuit" || key === "chase") return shortPursuit(p, s);
  if (key === "siege") return startEnc(p, s, Siege, [{ x: p.location.x, y: p.location.y, z: p.location.z, n: 3, c: 3, d: dayIndex(), e: -1 }]);
  if (key === "ambush") {
    const node = learnedNode(M, p.location, 120, 1) || (() => {
      const at = V.add(p.location, V.mul(V.normH(p.getViewDirection()), 28));
      return findStand(p.dimension, at.x, at.z, p.location.y);
    })();
    return !!node && startEnc(p, s, RouteAmbush, [node]);
  }
  if (key === "after") return startEnc(p, s, Aftermath, [{ loc: p.location, hid: isIndoors(p, s) }]);
  // asked for by name: the ones that have a switch, a light level or a game mode in the way are forced
  if (key === "eyes") return startEnc(p, s, Eyes, [{ force: true }]);
  if (key === "meta") return startEnc(p, s, Meta, [undefined, true]);
  if (key === "charge") return startEnc(p, s, Charge, [{ force: true }]);
  if (key === "tooslow") return startEnc(p, s, TooSlow, [{ force: true }]);
  if (key === "jumpscare") return testJumpscare(p);
  const e = ENC_BY_NAME[key];
  if (!e) return false;
  for (let i = 0; i < 4; i++) if (startEnc(p, s, e[0], e[1])) return true;     // where he stands is partly chance: try again
  return false;
}
/** The Wheel's "his face": he is simply there, in front of you, and then he is not. */
function testJumpscare(p) {
  const yaw = angleOf(p.getViewDirection());
  const pos = findStand(p.dimension, p.location.x + Math.cos(yaw) * 1.8, p.location.z + Math.sin(yaw) * 1.8, p.location.y, { up: 2, down: 3 });
  if (!pos) return false;
  const w = new Walker(p);
  if (!w.spawn(pos, p.location)) { w.remove(); return false; }
  w.calm = false; w.setPose(1); w.face(p.location, true);
  system.runTimeout(() => {
    if (!w.ok || !alive(p)) { w.remove(); return; }
    jumpscare(p, w.faceAt(), { force: true });
    system.runTimeout(() => { if (w.ok) w.vanish({ ash: true, quick: true }); }, 15);
  }, 2);
  return true;
}
const MOOD_ANGER = [0, WRATH_AT[1] + 4, WRATH_AT[2] + 4, WRATH_AT[3] + 4, WRATH_AT[4] + 6];
function statusLine(p) {
  const s = st(p);
  if (now() - s.forest.at > 20) scanForest(p, s);
  const wr = wrathOf(s);
  const col = ["§7", "§7", "§e", "§c", "§4"][wr];
  const where = s.domain === "stellar" ? "in his woods" : inWoods(s) ? "in the trees" : nearWoods(s) ? "at the edge of the trees" : s.under ? "underground" : "away from his woods";
  const doing = s.enc ? `§7Right now: §f${s.enc.name}` : `§7Next: in about ${Math.max(0, Math.round((s.nextAt - now()) / 20))} s (if you are somewhere he comes)`;
  return `§7He is ${col}${WRATH_NAMES[wr]}§7.  Anger §f${Math.round(s.anger)}§7/100.\n§7You are ${where}. It is ${isNight() ? "night" : "day"}${isEclipse() ? " (eclipse)" : ""}.\n${doing}`;
}
function mindLine(p) {
  const M = mind(p), H = habits(M);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const known = ESCAPES.filter((k) => adapted(M, k));
  return `Where you spend your time: caves ${pct(H.cave)}, home ${pct(H.home)}, travelling ${pct(H.travel)}, woods ${pct(H.woods)}, night ${pct(H.night)}.\n` +
    `Escapes he has learned to answer: ${known.length ? known.join(", ") : "none yet"}.\n` +
    `Stare-downs ${M.stares}, shots at him ${M.shots}, times you outran him ${M.outruns}, bluffs he has shown you ${M.bluffs || 0}.\n` +
    `Passages he knows: ${M.nodes.length}. Rooms you hide in: ${M.rooms.length}.`;
}
export const WHEEL_API = {
  status: statusLine,
  mind: mindLine,
  test: (p, key) => safe(() => runTest(p, key), false),
  mood: (p, level) => {
    const s = st(p);
    if (level === 0 && s.enc) { safe(() => s.enc.finish(0)); s.enc = null; }
    s.anger = MOOD_ANGER[clamp(level | 0, 0, 4)];
    s.dirty = true;
    s.quietUntil = 0;
    s.nextAt = level === 0 ? now() + 20 * 90 : Math.min(s.nextAt, now() + 20 * 8);
    say(p, level === 0 ? "He forgets his anger. For now." : `He is ${WRATH_NAMES[wrathOf(s)]}. Something will happen soon${isNight() || s.domain === "stellar" ? "" : " (he does most by night, and in or near his woods)"}.`);
  },
  toWoods: (p) => startNearWoods(p, true),
  sound: (p, id) => {
    const s = st(p);
    if (id.startsWith("m:")) {
      const track = id.slice(2);
      safe(() => __dw.musicStop("goatwalker", p));
      s.music = "";
      if (track) safe(() => __dw.musicPlay("goatwalker", p, track, { fade: 0.5, volume: 1.0, loop: false }));
    } else playFor(p, id, V.add(eye(p), V.mul(V.normH(p.getViewDirection()), 4)), 1.0);
  },
  applied: (p) => {
    const s = st(p);
    s.nextAt = Math.min(s.nextAt, now() + 20 * 30);
    if (cfg().wheel) giveWheel(p);
  },
};

world.afterEvents.playerSpawn.subscribe((ev) => {
  const p = ev.player;
  if (ev.initialSpawn) { checkBiomeOnce(p); if (cfg().spawn) maybeStartNearWoods(p); }
  system.runTimeout(() => { if (alive(p)) giveWheel(p); }, ev.initialSpawn ? 100 : 20);
  clearFogs(p);
  safe(() => p.camera.clear());                  // never left looking at his face
  const s = st(p);
  s.fogs.clear();
  s.music = "";
  s.eclipse = false;
  if (ev.initialSpawn) safe(() => p.removeTag(PREY));
});

world.beforeEvents.playerLeave.subscribe((ev) => {
  const id = ev.player.id;
  system.run(() => {
    const s = STATE.get(id);
    if (!s) return;
    if (s.enc) safe(() => s.enc.finish(0));
    for (const w of [...WALKERS]) if (w.owner.id === id) w.remove();
    STATE.delete(id);
  });
});

// ---------------------------------------------------------------- test / tuning commands
//   /scriptevent goatwalker:status            /scriptevent goatwalker:mind
//   /scriptevent goatwalker:anger 70          /scriptevent goatwalker:sins 30
//   /scriptevent goatwalker:pace fast|normal|slow
//   /scriptevent goatwalker:encounter watch|perch|route|peek|gnaw|follow|stalk|breath|roof|snuff|flock|ash|bell|hooves|
//                                     gouge|scream|knock|door|shift|daywatch|treeline|cave|standoff|
//                                     eyes|mimic|meta|behind|charge|many|tooslow
//   /scriptevent goatwalker:wheel   (another Wheel; everything here is also on The Wheel)
//   /scriptevent goatwalker:hunt   (full hunt)       /scriptevent goatwalker:chase  (short pursuit)
//   /scriptevent goatwalker:siege  /scriptevent goatwalker:ambush  /scriptevent goatwalker:after
//   /scriptevent goatwalker:teach light|water|stare|lens|hit|run|break|flare|all    (pretend he has learned it)
//   /scriptevent goatwalker:shrine            /scriptevent goatwalker:reset   /scriptevent goatwalker:forget
//   /scriptevent goatwalker:biome   (is the Stellar Taiga loaded?  which biome am I in?)
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith(`${NS}:`)) return;
  const p = ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player" ? /** @type {import("@minecraft/server").Player} */ (ev.sourceEntity) : __dw.players("goatwalker")[0];
  if (!p) return;
  const s = st(p), M = mind(p);
  const c = ev.id.slice(NS.length + 1), arg = ev.message.trim();
  if (c === "status") {
    if (now() - s.forest.at > 20) scanForest(p, s);
    say(p, `anger ${s.anger.toFixed(1)}  sins ${s.sins}  where ${s.domain}${s.under ? " (underground)" : ""}  woods ${inWoods(s) ? "yes" : nearWoods(s) ? "edge" : "no"} (${s.forest.trunks.length} trunks)  ` +
      `shrine ${s.shrine ? `${s.shrine.x} ${s.shrine.y} ${s.shrine.z} lit ${s.shrine.lit ? litCount(s) : "no"}` : "none"}  ` +
      `offers ${s.offers}  sheep eaten ${s.meals}  horns ${s.horns}  encounter ${s.enc ? `${s.enc.name}/${s.enc.state}` : "-"}  next in ${Math.max(0, Math.round((s.nextAt - now()) / 20))}s  pace ${pace()}  group ${s.group.n}${s.group.straggler ? " (straggler)" : ""}`);
  } else if (c === "mind") say(p, describe(M));
  else if (c === "anger") { s.anger = clamp(Number(arg) || 0, 0, 100); s.dirty = true; say(p, `anger ${s.anger}`); }
  else if (c === "sins") { s.sins = Math.max(0, Number(arg) || 0); s.dirty = true; say(p, `sins ${s.sins}`); }
  else if (c === "pace") {          // (the same setting as on The Wheel)
    const i = { "very-slow": 0, slow: 1, normal: 2, fast: 3, relentless: 4 }[arg] ?? 2;
    safe(() => world.setDynamicProperty("gw:pace", undefined));
    setCfg({ pace: i });
    say(p, `pace: ${PACE_NAMES[i]} (${PACE_OPTS[i]}x)`);
  }
  else if (c === "encounter") {
    if (!ENC_BY_NAME[arg]) { say(p, `unknown: ${arg}`); return; }
    say(p, runTest(p, arg) ? `started ${arg}` : `no place for ${arg} here`);
  } else if (c === "hunt") { runTest(p, "hunt"); say(p, "hunt"); }
  else if (c === "chase") say(p, runTest(p, "pursuit") ? "short pursuit" : "no room");
  else if (c === "siege") say(p, runTest(p, "siege") ? "siege" : "no entrance found (stand inside a room)");
  else if (c === "ambush") say(p, runTest(p, "ambush") ? "ambush" : "no place");
  else if (c === "after") say(p, runTest(p, "after") ? "aftermath" : "nothing");
  else if (c === "tooslow") say(p, runTest(p, "tooslow") ? "too slow" : "no room");
  else if (c === "wheel") { safe(() => p.getComponent("minecraft:inventory").container.addItem(new ItemStack(WHEEL, 1))); say(p, "The Wheel"); }
  else if (c === "teach") {
    const kinds = arg === "all" ? ESCAPES : [arg];
    for (const k of kinds) if (ESCAPES.includes(k)) { M.esc[k] = ADAPT_AT; M.told[k] = true; }
    saveMind(p, M);
    say(p, `learned: ${kinds.join(", ")}`);
  } else if (c === "shrine") {
    scanForest(p, s);
    s.shrine = null;
    say(p, buildShrine(p, s) ? `shrine at ${s.shrine.x} ${s.shrine.y} ${s.shrine.z}` : "no flat ground for a shrine nearby");
  } else if (c === "reset") {
    if (s.enc) s.enc.finish(0);
    Object.assign(s, { anger: 0, sins: 0, offers: 0, kills: [], intro: 0, shrine: null, enc: null, bleed: null, restUntil: -1, lastHuntDay: -9, nextAt: now() + 400, after: null });
    s.dirty = true;
    say(p, "reset");
  } else if (c === "biome" || c === "version") {
    // is the Stellar Taiga actually loaded in this world?
    const state = biomeState(p);
    const here = biomeId(p.dimension, p.location) || "?";
    say(p, `The Goatwalker v${VERSION}  |  you are standing in: §f${here}§7`);
    if (state === "missing") say(p, MISSING);
    else if (state === "found") say(p, `§aThe Stellar Taiga is loaded.§7 Type §f/locate biome ${biomeName}§7 for its coordinates.`);
    else say(p, "§aThe Stellar Taiga is loaded§7, but none is close.  It only grows in NEW land: travel to unexplored taiga, or start a new world.");
  } else if (c === "spawn") {
    startNearWoods(p, true);
  } else if (c === "forget") {
    s.mind = undefined;
    safe(() => p.setDynamicProperty("gw:mind", undefined));
    say(p, "he forgets you");
  }
});

// ================================================================= main loop
let tickN = 0;
function loop() {
  tickN++;
  const players = __dw.players("goatwalker");
  for (const p of players) {
    const s = st(p);
    if (s.enc) {
      if (s.enc.done) s.enc = null;
      else {
        let took = false;                                   // too near: he vanishes (or, rarely, comes at you)
        try { took = approachReflex(s.enc); } catch (err) { console.warn(`[goatwalker] reflex: ${err}`); }
        if (!took && s.enc && !s.enc.done) {
          try { s.enc.tick(); } catch (err) { console.warn(`[goatwalker] ${s.enc && s.enc.name}: ${err}`); if (s.enc) s.enc.finish(30); }
          safe(() => faceYou(s.enc));                      // standing still, he keeps turning to face you
        }
        if (s.enc && s.enc.done) s.enc = null;
      }
    }
    try { lensCheck(p, s); heartbeat(p, s); } catch (err) { console.warn(`[goatwalker] senses: ${err}`); }
    if (tickN % 5 === 0) safe(() => observeFight(p, s, mind(p)));
    if (tickN % 10 === 0) {
      try { perSecond(p, s, players); } catch (err) { console.warn(`[goatwalker] director: ${err}`); }
    }
    if (tickN % 200 === 0 && s.dirty) saveState(p, s);
    if (tickN % 600 === 0) saveMind(p, mind(p));
  }
  if (tickN % 5 === 0) safe(() => SX.tickFlares());
  if (tickN % 5 === 2) safe(() => SX.tickLeafDecay());
  if (tickN % 100 === 0) safe(processDecay);
}

world.afterEvents.worldLoad.subscribe(() => {
  loadDecay();
  const dim = world.getDimension(OVERWORLD);
  for (const e of safe(() => dim.getEntities({ tags: [TAG] }), [])) safe(() => e.remove());
  for (const p of __dw.players("goatwalker")) { clearFogs(p); safe(() => p.removeTag(PREY)); }
  system.runInterval(loop, 2);
});

// ---------------------------------------------------------------- merged into The Observer (1.6.0)
/** Switched off on the Config Wheel: whatever he is doing ends, and he is gone. */
export function __shutdown() {
  for (const s of STATE.values()) { if (s.enc) safe(() => s.enc.finish(0)); s.enc = null; }
  for (const w of [...WALKERS]) safe(() => w.remove());
  for (const p of world.getAllPlayers()) { safe(() => clearFogs(p)); }
}
/** The Observer sends him after someone: his anger is up and something happens soon. */
export function __command(p) {
  const s = st(p);
  s.anger = Math.max(s.anger, MOOD_ANGER[3]);
  s.dirty = true;
  s.quietUntil = 0;
  s.nextAt = Math.min(s.nextAt, now() + 20 * 6);
}
/** His own Wheel, from the Config Wheel. */
export function __open(p) { return openWheel(p, WHEEL_API); }
