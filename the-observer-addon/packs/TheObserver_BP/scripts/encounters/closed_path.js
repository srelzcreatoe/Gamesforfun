// @ts-check
// E4 SIGNATURE "The Closed Path"
// Stalking + manipulation + a real threat with a warning, a response window and several outs.
// In a tunnel or enclosed corridor: a low hum (warning), the nearby lights die, and the way the
// player came is sealed by Veil. When they turn back toward where they were going, it is there.
// Rules it follows:
//   * it only moves while nobody is looking at it; held in view it waits, held long enough it backs off
//   * it will not step into light it did not make; a lit player (light >= 11) drives it away
//   * the Veil breaks by hand in under a second: breaking through and getting away is an escape
//   * the Witness Lens or a blow makes it recoil
// If it reaches the player it telegraphs a strike (0.6 s wind-up, avoidable by stepping back).
// Aggression 0 replaces the strike with contact and a blackout, no damage.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS, PARTICLES } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { aggression } from "../core/settings.js";
import { corridorBehind, findSpot } from "../world/space.js";
import { litLightsNear } from "../world/manipulate.js";
import { arriveUnseen, sighting, travelDir } from "./common.js";

register({
  id: "closed_path",
  tier: 3,
  minStage: 4,
  needsBody: true,
  minManip: 1,
  cooldown: 1500,
  weight(c) {
    if (c.water || c.gliding || !c.moving) return 0;
    if (!(c.underground || (c.sheltered && c.light < 10))) return 0;
    return 9;
  },
  prepare(enc) {
    const p = enc.p;
    const dir = travelDir(p);
    const seal = corridorBehind(p, dir);
    if (!seal) return false;
    const ahead = findSpot(p, { minDist: 12, maxDist: 20, bearings: [0], spread: 22, concealment: "any", needLOS: true, yMode: "near",
      baseYaw: V.yawTo({ x: 0, y: 0, z: 0 }, dir) });
    if (!ahead) return false;
    enc.data.seal = seal;
    enc.data.ahead = ahead;
    enc.data.dir = dir;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    const { seal, ahead } = enc.data;
    enc.restoreDelay = 5;

    // ---- warning: hum + lights die
    enc.sound(SOUNDS.hum, ahead.loc, 0.9, 1, "caption.hum");
    enc.fog("dread");
    // the lights die around the player and along the way it will come
    const lights = [...litLightsNear(dim, p.location, 9, 6), ...litLightsNear(dim, ahead.loc, 8, 4)];
    for (const l of lights) {
      if (enc.snuff(l)) enc.sound(SOUNDS.snuff, l, 0.6);
      await enc.wait(5);
    }
    await enc.wait(20);

    // ---- the way back is sealed
    const n = enc.veil(seal.cells, 120);
    if (n === 0) return enc.result("no_seal");
    for (const c of seal.cells) safe(() => p.spawnParticle(PARTICLES.unravel, { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }));
    enc.sound(SOUNDS.seal, seal.center, 1, 1, "caption.seal");
    enc.log(`sealed ${n} cells ${seal.dist} behind`);

    // ---- it arrives ahead while they look back at the seal
    await enc.until(() => V.angle(p.getViewDirection(), V.sub(seal.center, p.location)) < 80, 60, 2);
    if (!(await arriveUnseen(enc, ahead, { state: "stare" }, 120))) return enc.result("no_arrival");
    body.setMode("still");

    // ---- response window, then it closes in while unwatched
    let held = 0, heldStreak = 0, litTicks = 0, recoiled = 0;
    const startDist = V.dist(p.location, ahead.loc);
    await enc.wait(30);
    for (let t = 0; t < 20 * 45; t += 4) {
      await enc.wait(4);
      const bl = body.loc();
      if (!bl) return enc.result("vanished");
      const dist = V.dist(p.location, bl);
      const watched = enc.updateGaze() || body.watchedBy(enc.watchers(), 30);
      // escape: broke through the seal and got away
      const broken = enc.released.some((r) => r.kind === "veil" && r.how === "broken");
      if (broken && dist > startDist + 10) {
        enc.result("escaped", true);
        enc.discover("wrong_way");
        return;
      }
      if (enc.data.lensed || enc.data.hit) {
        body.setMode("still");
        body.setState("recoil");
        enc.data.lensed = enc.data.hit = false;
        await enc.wait(20);
        if (++recoiled >= 1) return enc.result("repelled", true);
      }
      const playerLight = safe(() => dim.getLightLevel(p.getHeadLocation()), 0) ?? 0;
      litTicks = playerLight >= 11 ? litTicks + 4 : 0;
      if (litTicks >= 60) {
        body.setMode("still");
        body.setState("recoil");
        await enc.wait(16);
        enc.result("repelled_by_light", true);
        enc.discover("light_it_doesnt_make");
        return;
      }
      if (watched) {
        held += 4;
        heldStreak += 4;
        body.setMode("still");
        body.setState("stare");
        if (held >= 60) enc.discover("held_gaze");
        if (heldStreak >= 120) {
          body.setState("recoil");
          await enc.wait(16);
          sighting(enc, enc.gaze.lastWatcher ?? p);
          return enc.result("held_off", true);
        }
        continue;
      }
      heldStreak = 0;
      // it will not step into light it did not make: test one step toward the player
      const step = V.add(bl, V.scale(V.flat(V.sub(p.location, bl)), 1.5));
      const lightAhead = safe(() => dim.getLightLevel({ x: step.x, y: step.y + 1, z: step.z }), 0) ?? 0;
      if (lightAhead >= 11) {
        body.setMode("still");
        body.setState("stare");
        continue;
      }
      body.setMode("approach");
      body.setState("walk");
      if (dist <= 2.6) {
        if (aggression() === 0) {
          body.setMode("still");
          body.setState("stare");
          enc.sound(SOUNDS.ring, p.getHeadLocation(), 0.6);
          enc.fade(0.15, 1.2, 1.2);
          await enc.wait(16);
          body.despawn("contact");
          return enc.result("caught");
        }
        const r = await body.strike(p);
        enc.result(r === "hit" ? "struck" : "dodged", true);
        await enc.wait(10);
        return;
      }
    }
    enc.result("endured", held > 0);
  },
});
