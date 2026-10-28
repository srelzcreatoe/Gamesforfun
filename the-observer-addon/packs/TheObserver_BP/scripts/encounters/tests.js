// @ts-check
// Behaviours that normally only happen inside other encounters, available on their own under
// Config Wheel → Test an encounter. They count for nothing (no progress, no pacing, no scare
// budget) and are never chosen by the director. Damage follows the normal rules: aggression,
// Peaceful difficulty and the cap that stops a single strike from killing.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { aggression } from "../core/settings.js";
import { findSpot, standNear, coverSide } from "../world/space.js";
import { lineOfSight } from "../world/sight.js";
import { findSpotLoose, lunge, sighting, relentless } from "./common.js";
import * as illusions from "../observer/illusions.js";

/** @typedef {{x:number,y:number,z:number}} Vec */

const TEST = { tier: 0, minStage: 0, needsBody: true, cooldown: 0, manual: true, preview: true, testOnly: true, weight: () => 0 };

/** A visible spot ahead of the player. */
function ahead(p, min, max) {
  return findSpotLoose(p, [
    { minDist: min, maxDist: max, bearings: [0], spread: 30, concealment: "visible", needLOS: true, yMode: "near", samples: 36 },
    { minDist: Math.max(4, min - 4), maxDist: max + 6, concealment: "any", needLOS: true, yMode: "near", samples: 48 },
  ]);
}

// ---- The Strike: it walks up to you and makes its telegraphed attack
register({
  ...TEST,
  id: "test_strike",
  reactNear: false,
  prepare(enc) {
    const spot = ahead(enc.p, 8, 12);
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop, autoPeek: false })) return enc.result("deferred");
    await enc.wait(30);
    enc.worldSound(SOUNDS.shriek, { x: spot.loc.x, y: spot.loc.y + 3, z: spot.loc.z }, 0.9);
    body.setMode("pursue");
    body.setState("run");
    for (let t = 0; t < 20 * 15; t += 2) {
      await enc.wait(2);
      const l = body.loc();
      if (!l) return enc.result("vanished");
      const d = V.dist(l, p.location);
      // if it cannot find a path, it simply closes the distance
      if (t === 20 * 8 && d > 4) {
        const near = V.add(p.location, V.scale(V.flat(V.sub(l, p.location)), 3));
        const st = standNear(enc.dim, near.x, near.z, near.y);
        if (st) body.moveTo(st.loc, p.getHeadLocation());
      }
      if (d <= 2.7) {
        await relentless(enc);
        return;
      }
    }
    body.despawn("timeout");
    enc.result("no_contact");
  },
});

// ---- The Lunge: look at it, and it comes at you
register({
  ...TEST,
  id: "test_lunge",
  reactNear: false,
  prepare(enc) {
    const spot = ahead(enc.p, 18, 26);
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop })) return enc.result("deferred");
    // it waits to be seen (up to 12 s), then lunges either way
    await enc.until(() => {
      enc.updateGaze();
      return enc.gaze.seenTicks >= 10;
    }, 20 * 12, 2);
    if (enc.gaze.seenTicks >= 10) sighting(enc, enc.gaze.lastWatcher ?? enc.p);
    await lunge(enc, { test: true });
  },
});

// ---- Peeking: it stands beside the nearest cover (a trunk, a wall corner) and leans out at you
/** A standing spot 5-14 blocks ahead with cover on exactly one side and a clear view of the player. */
function peekSpot(p) {
  const dim = p.dimension;
  const eye = p.getHeadLocation();
  const yaw = p.getRotation().y;
  for (let d = 5; d <= 14; d++) {
    for (const a of [0, 10, -10, 20, -20, 30, -30, 40, -40, 50, -50, 60, -60]) {
      const dir = V.fromYaw(yaw + a);
      const st = standNear(dim, p.location.x + dir.x * d, p.location.z + dir.z * d, p.location.y);
      if (!st) continue;
      const head = { x: st.loc.x, y: st.loc.y + (st.stoop ? 2.45 : 3.4), z: st.loc.z };
      if (!lineOfSight(dim, head, eye).clear) continue;
      const cover = coverSide(dim, st.loc, eye);
      if (cover.one) return { ...st, side: cover.side };
    }
  }
  return undefined;
}

register({
  ...TEST,
  id: "test_peek",
  prepare(enc) {
    // only beside real cover; with no trunk or wall corner ahead, it tells you so instead
    const spot = peekSpot(enc.p);
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "peek", stoop: spot.stoop, side: spot.side, autoPeek: true })) return enc.result("deferred");
    for (let t = 0; t < 20 * 10; t += 4) {
      await enc.wait(4);
      enc.updateGaze();
      if (enc.gaze.seenTicks >= 60) break; // looked at for 3 s: it slips away
    }
    safe(() => body.despawn("peek_done"));
    enc.result("shown");
  },
});

// ---- Taiga shadow: the illusion, here anywhere (normally only in taiga forests)
register({
  ...TEST,
  id: "test_illusion",
  needsBody: false,
  reactNear: false,
  async run(enc) {
    const p = enc.p;
    if (!illusions.spawnFor(p, { force: true })) return enc.result("deferred");
    await enc.until(() => !illusions.hasShadow(p.id), 20 * 50, 4);
    enc.result(illusions.lastResult.get(p.id) === "seen" ? "seen" : "faded", illusions.lastResult.get(p.id) === "seen");
  },
});

// ---- Getting too close: it stands and watches; walk up to it and it tears apart (or, sometimes, strikes)
register({
  ...TEST,
  id: "test_near",
  prepare(enc) {
    const spot = ahead(enc.p, 10, 14);
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop })) return enc.result("deferred");
    // the director's too-close check ends this the moment a player comes within 4-8 blocks
    await enc.wait(20 * 30);
    body.despawn("timeout");
    enc.result("not_approached");
  },
});
