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
import { findSpotLoose, lunge, sighting } from "./common.js";

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
        if (aggression() === 0) {
          body.setMode("still");
          body.setState("stare");
          enc.fade(0.1, 0.8, 1.0);
          await enc.wait(12);
          body.despawn("caught");
          return enc.result("caught");
        }
        const r = await body.strike(p);
        enc.result(r === "hit" ? "struck" : "dodged", true);
        await enc.wait(12);
        body.despawn("struck");
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
    const spot = peekSpot(enc.p) ?? findSpot(enc.p, { minDist: 6, maxDist: 16, bearings: [0, 45, -45], spread: 30, concealment: "partial", needLOS: true, yMode: "near", samples: 40 });
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "peek", stoop: spot.stoop, side: spot.side })) return enc.result("deferred");
    for (let t = 0; t < 20 * 10; t += 4) {
      await enc.wait(4);
      enc.updateGaze();
      if (enc.gaze.seenTicks >= 60) break; // looked at for 3 s: it slips away
    }
    safe(() => body.despawn("peek_done"));
    enc.result("shown");
  },
});
