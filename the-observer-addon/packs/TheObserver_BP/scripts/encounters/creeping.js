// @ts-check
// E19 "Closer Each Time" — at night, in darkness or underground, it stands in plain view and comes
// for you, but only while nobody is looking at it.
//   * a low hum and soft fog announce it; it appears ahead of you, eyes glowing, staring
//   * every time you look away, it is suddenly several blocks closer (a click from where it now stands)
//   * keep it in view for 8 seconds and it backs off and tears apart (held gaze)
//   * stand in bright light (12+) and it will not come nearer; stay lit for 3 s and it leaves
//   * the Witness Lens or a blow make it recoil; getting 56 blocks away escapes it
//   * if it reaches you: a shriek and the telegraphed strike (avoidable by stepping back);
//     with aggression "never" it only stops in front of you, and everything goes dark
//   * climbing up something does not help: the next time you look away it is on the wall just below
//     you, hanging there (observer/climb.js)
//   * it learns (observer/learn.js): used to light, it puts the lights out first and needs more;
//     used to stares, it starts behind you and must be held longer; outrun, it follows further
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { aggression } from "../core/settings.js";
import { standNear } from "../world/space.js";
import { litLightsNear } from "../world/manipulate.js";
import { findSpotLoose, sighting, relentless } from "./common.js";
import * as learn from "../observer/learn.js";
import * as climb from "../observer/climb.js";

register({
  id: "creeping",
  reactNear: false,
  tier: 3,
  minStage: 3,
  needsBody: true,
  cooldown: 1200,
  weight(c) {
    if (c.water || c.gliding || c.elevated) return 0;
    if (!(c.night || c.light <= 7 || c.underground)) return 0;
    return 8;
  },
  prepare(enc) {
    const p = enc.p;
    const yMode = enc.ctx.underground ? "near" : "surface";
    const behind = learn.adapted(enc.s) === "gaze";
    const spot = findSpotLoose(p, [
      ...(behind ? [{ minDist: 18, maxDist: 28, bearings: [180, 155, -155], spread: 15, concealment: /** @type {"hidden"} */ ("hidden"), needLOS: true, yMode }] : []),
      { minDist: 20, maxDist: 30, bearings: [0, 25, -25], spread: 15, concealment: "visible", needLOS: true, yMode },
      { minDist: 14, maxDist: 32, concealment: "any", needLOS: true, yMode, samples: 36 },
    ]);
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    const spot = enc.data.spot;
    enc.sound(SOUNDS.hum, p.location, 0.6, 1, "caption.hum");
    enc.fog("soft");
    if (learn.adapted(enc.s) === "light") {
      // it has learned that you stand in the light: it puts out what is near you first
      for (const l of litLightsNear(dim, p.location, 10, 6)) {
        if (enc.snuff(l, 300)) enc.sound(SOUNDS.snuff, l, 0.6);
        await enc.wait(4);
      }
    }
    await enc.wait(30);
    const lightNeed = 12 + learn.lightBonus(enc);
    const lightHold = 60 * learn.holdFactor(enc, "light");
    const gazeHold = 160 * learn.holdFactor(enc, "gaze");
    const escapeAt = 56 + learn.outrunBonus(enc);
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop, autoPeek: false })) return enc.result("deferred");
    let unwatched = 0, heldStreak = 0, lit = 0, moves = 0;
    for (let t = 0; t < 20 * 75; t += 2) {
      await enc.wait(2);
      const bl = body.loc();
      if (!bl) return enc.result("vanished");
      const d = V.dist(bl, p.location);
      if (d > escapeAt) {
        body.despawn("left_behind");
        return enc.result("escaped", true);
      }
      if (enc.data.lensed || enc.data.hit) {
        body.setState("recoil");
        await enc.wait(16);
        body.despawn("repelled");
        return enc.result("repelled", true);
      }
      const light = safe(() => dim.getLightLevel(p.getHeadLocation()), 0) ?? 0;
      lit = light >= lightNeed ? lit + 2 : 0;
      if (lit >= lightHold) {
        body.setState("recoil");
        await enc.wait(16);
        enc.discover("light_it_doesnt_make");
        body.despawn("repelled_by_light");
        return enc.result("repelled_by_light", true);
      }
      const watched = enc.updateGaze() || body.watchedBy(enc.watchers(), 30);
      if (watched) {
        unwatched = 0;
        heldStreak += 2;
        body.setState(body.get()?.clinging ? "climb" : "stare");
        if (heldStreak >= gazeHold) {
          sighting(enc, enc.gaze.lastWatcher ?? p);
          enc.discover("held_gaze");
          body.setState("recoil");
          await enc.wait(16);
          body.despawn("stared_down");
          return enc.result("stared_down", true);
        }
        continue;
      }
      heldStreak = 0;
      unwatched += 2;
      // it moves the moment you look away for half a second, never into light you stand in
      if (unwatched < 10 || lit > 0) continue;
      unwatched = 0;
      // up a pillar or a ledge: next time you look, it is on the wall just below you
      if (climb.needed(enc)) {
        const route = climb.plan(dim, p, bl);
        if (route && route.cling) {
          const b = body.get();
          body.setMode("still");
          if (b) {
            b.clinging = b.hung = true;
            b.autoPeek = false;
          }
          body.setState("climb");
          const at = { x: route.col.x + 0.5, y: route.y, z: route.col.z + 0.5 };
          body.moveTo(at, p.getHeadLocation());
          moves++;
          enc.worldSound(SOUNDS.notice, { x: at.x, y: at.y + 3, z: at.z }, Math.min(1, 0.45 + moves * 0.1));
          enc.emit("creep", { d: V.dist(at, p.location), moves, clinging: true });
          enc.emit("climb", { what: "cling", y: at.y });
          if (V.dist(at, p.location) <= 3.4) {
            enc.worldSound(SOUNDS.shriek, { x: at.x, y: at.y + 3, z: at.z }, 1);
            enc.caption("caption.shriek");
            await relentless(enc);
            return;
          }
          continue;
        }
      }
      const step = Math.min(Math.max(d * 0.3, 3), 6);
      const to = V.add(bl, V.scale(V.flat(V.sub(p.location, bl)), Math.min(step, d - 2)));
      const st = standNear(dim, to.x, to.z, to.y);
      if (!st) continue;
      body.moveTo(st.loc, p.getHeadLocation());
      moves++;
      enc.worldSound(SOUNDS.notice, { x: st.loc.x, y: st.loc.y + 3, z: st.loc.z }, Math.min(1, 0.45 + moves * 0.1));
      enc.emit("creep", { d: V.dist(st.loc, p.location), moves });
      if (d < 12) enc.darkness(2);
      if (V.dist(st.loc, p.location) <= 3.4) {
        enc.worldSound(SOUNDS.shriek, { x: st.loc.x, y: st.loc.y + 3, z: st.loc.z }, 1);
        enc.caption("caption.shriek");
        await relentless(enc);
        return;
      }
    }
    body.despawn("endured");
    enc.result("endured", true);
  },
});
