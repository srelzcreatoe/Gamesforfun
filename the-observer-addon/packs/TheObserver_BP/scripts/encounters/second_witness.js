// @ts-check
// E15 "Second Witness" (multiplayer) — it watches one player from where only another player can
// see it. The witness hears a faint chime from its direction. If the witness looks, it turns its
// head toward them. If they warn the target and the target turns in time, both have seen it.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS } from "../core/constants.js";
import { V, safe, allPlayers } from "../core/util.js";
import { findSpot } from "../world/space.js";
import { visibility } from "../world/sight.js";
import { sighting, acknowledge } from "./common.js";
import { world, GameMode } from "@minecraft/server";

register({
  id: "second_witness",
  tier: 2,
  minStage: 2,
  needsBody: true,
  cooldown: 900,
  benign: true,
  weight(c) {
    if (c.water || c.gliding) return 0;
    const others = allPlayers().filter((o) => o.id !== c.p.id && o.dimension.id === c.p.dimension.id && V.dist(o.location, c.p.location) < 40
      && safe(() => o.getGameMode(), GameMode.Survival) !== GameMode.Spectator);
    return others.length ? 14 : 0;
  },
  prepare(enc) {
    const p = enc.p;
    for (const w of enc.witnesses(40)) {
      const spot = findSpot(p, { minDist: 14, maxDist: 24, bearings: [180], spread: 50, concealment: "hidden", watchLOSIgnoringView: true, showTo: [w], samples: 30 });
      if (spot) {
        enc.data.spot = spot;
        enc.data.witness = w;
        return true;
      }
    }
    return false;
  },
  async run(enc) {
    const p = enc.p;
    const { spot, witness } = enc.data;
    if (!enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop, side: spot.side })) return enc.result("deferred");
    await enc.wait(50);
    if (witness.isValid) safe(() => witness.playSound(SOUNDS.tell, { location: { x: spot.loc.x, y: spot.loc.y + 2, z: spot.loc.z }, volume: 0.6 }));
    enc.caption("caption.chime", [witness]);
    let witnessSaw = false, targetSaw = false;
    for (let t = 0; t < 20 * 16; t += 2) {
      await enc.wait(2);
      const b = body.get();
      if (!b) return;
      if (!witnessSaw && witness.isValid && visibility(witness, b.e.location, { stooped: b.stoop, fov: 24 }).points > 0) {
        witnessSaw = true;
        sighting(enc, witness);
        b.faceTarget = false;
        body.faceTo(witness.getHeadLocation());
        body.setState("tilt");
      }
      if (visibility(p, b.e.location, { stooped: b.stoop, fov: 30 }).points > 0) {
        targetSaw = true;
        break;
      }
    }
    if (targetSaw) {
      sighting(enc, p);
      if (witnessSaw) enc.discover("second_witness", p);
      await acknowledge(enc, 8, 14);
      enc.result(witnessSaw ? "both_saw" : "target_saw", true);
    } else enc.result(witnessSaw ? "witness_only" : "unseen", witnessSaw);
  },
});
