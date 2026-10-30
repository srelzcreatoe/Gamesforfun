// @ts-check
// Behaviours that normally only happen inside other encounters, available on their own under
// Config Wheel → Test an encounter. They count for nothing (no progress, no pacing, no scare
// budget) and are never chosen by the director. Damage follows the normal rules: aggression,
// Peaceful difficulty and the cap that stops a single strike from killing.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS, ITEMS } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { aggression } from "../core/settings.js";
import { findSpot, standNear, coverSide } from "../world/space.js";
import { lineOfSight } from "../world/sight.js";
import { findSpotLoose, lunge, sighting, relentless } from "./common.js";
import * as illusions from "../observer/illusions.js";
import * as hush from "../observer/hush.js";
import * as pages from "../observer/pages.js";
import * as returns from "../observer/returns.js";
import { primaryHaunt } from "../observer/memory.js";
import { now } from "../core/state.js";
import { give } from "../progression/discoveries.js";
import * as climb from "../observer/climb.js";

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

// ---- The Flare: it stands and watches; throw a flare near it (one is handed over if you have none)
register({
  ...TEST,
  id: "test_flare",
  reactNear: false,
  prepare(enc) {
    const spot = ahead(enc.p, 12, 16);
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const spot = enc.data.spot;
    const inv = p.getComponent("minecraft:inventory")?.container;
    let has = false;
    for (let i = 0; inv && i < inv.size; i++) if (inv.getItem(i)?.typeId === ITEMS.flare) has = true;
    if (!has) give(p, ITEMS.flare, 1);
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop, autoPeek: false })) return enc.result("deferred");
    // it waits up to 40 s; a burning flare within 16 blocks ends this as "flared"
    await enc.wait(20 * 40);
    body.despawn("timeout");
    enc.result("not_flared");
  },
});

// ---- The world goes quiet: 20 s of silence (the music stops, a faint ringing rises), then nothing
register({
  ...TEST,
  id: "test_quiet",
  needsBody: false,
  reactNear: false,
  async run(enc) {
    const p = enc.p;
    hush.begin(p, "", now(), { seconds: 20, falseAlarm: true, test: true });
    await enc.wait(20 * 20);
    hush.end(p, p.id, "test");
    enc.result("quiet");
  },
});

// ---- A page you didn't write: one turns up in your Field Notes now (from what it has seen you do)
register({
  ...TEST,
  id: "test_page",
  needsBody: false,
  reactNear: false,
  async run(enc) {
    const p = enc.p;
    const s = enc.s;
    if (!s.notesGiven) {
      s.notesGiven = true;
      give(p, ITEMS.notes, 1);
    }
    const key = pages.write(p);
    enc.result(key ? `page_${key}` : "nothing", !!key);
  },
});

// ---- It returns what you threw away: drop something, walk away, and it is moved to your doorstep
register({
  ...TEST,
  id: "test_returns",
  needsBody: false,
  reactNear: false,
  prepare(enc) {
    return !!primaryHaunt(enc.p);
  },
  async run(enc) {
    const p = enc.p;
    const before = returns.tracked(p.id);
    // up to 60 s to drop an item and walk 10 blocks from it
    const done = await enc.until(() => returns.tracked(p.id) > before && returns.returnNow(p, { minAway: 10 }), 20 * 60, 10);
    enc.result(done ? "returned" : "nothing_dropped", done);
  },
});

// ---- The floating chase: it comes at you through the air (harmless here: it tears apart 3 blocks short)
register({
  ...TEST,
  id: "test_float",
  reactNear: false,
  prepare(enc) {
    const spot = ahead(enc.p, 18, 26);
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop, autoPeek: false })) return enc.result("deferred");
    await enc.wait(30);
    body.setSilent(true);
    for (let t = 0; t < 20 * 20; t += 4) {
      await enc.wait(4);
      const l = body.loc();
      if (!l) return enc.result("vanished");
      if (t % 40 === 0) enc.worldSound(SOUNDS.drift, { x: l.x, y: l.y + 2, z: l.z }, 0.8);
      // watched: it drifts, upright and limp; unwatched: it surges
      if (enc.updateGaze() || body.watchedBy(enc.watchers(), 30)) {
        body.setMode("approach");
        body.setState("float");
      } else {
        body.setMode("pursue");
        body.setState("surge");
      }
      if (V.dist(l, p.location) <= 3.5) {
        body.setMode("still");
        body.setState("float");
        await enc.wait(16);
        body.despawn("test_float");
        return enc.result("reached", true);
      }
    }
    body.despawn("timeout");
    enc.result("no_contact");
  },
});

// ---- Climbing: stand on something 3+ blocks high (pillar up); it comes and climbs up after you (harmless)
register({
  ...TEST,
  id: "test_climb",
  reactNear: false,
  prepare(enc) {
    // only when the player is up on something: it starts on the ground below, 8-16 blocks away
    const p = enc.p;
    const spot = findSpotLoose(p, [
      { minDist: 8, maxDist: 14, concealment: "any", needLOS: false, yMode: "below", samples: 48 },
      { minDist: 6, maxDist: 16, concealment: "any", yMode: "surface", samples: 48 },
    ]);
    if (!spot || p.location.y - spot.loc.y < 2.5) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop, autoPeek: false })) return enc.result("deferred");
    await enc.wait(20);
    for (let t = 0; t < 20 * 25; t += 2) {
      await enc.wait(2);
      const l = body.loc();
      if (!l) return enc.result("vanished");
      if (climb.needed(enc) || body.get()?.clinging) {
        if (await climb.after(enc, { state: "run" })) {
          const b = body.get();
          if (b?.hung || V.dist(body.loc() ?? l, p.location) <= 3) {
            // right below you on the wall: it stares up at you, then lets go and is gone
            await enc.wait(30);
            body.despawn("test_climb");
            return enc.result("climbed", true);
          }
          continue;
        }
      }
      if (V.dist(l, p.location) <= 3) {
        body.despawn("test_climb");
        return enc.result("reached", true);
      }
      body.setMode("pursue");
      body.setState("run");
    }
    body.despawn("timeout");
    enc.result("no_climb");
  },
});
