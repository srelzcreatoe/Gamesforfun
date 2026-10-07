// @ts-check
// E6 "Something Facing You" — an ordinary object (carved pumpkin, jack o'lantern, stonecutter,
// anvil) quietly turns to face the player while they look elsewhere. A faint scrape and a little
// dust are the only cues. Looking at it within the window records the discovery. The change is
// recorded and reverts later unless the player turns it themselves.
import { register } from "../director/director.js";
import { TURNABLE, SOUNDS } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { findBlocks } from "../world/manipulate.js";
import { viewAngle, lineOfSight } from "../world/sight.js";

register({
  id: "turned_object",
  tier: 1,
  minStage: 1,
  needsBody: false,
  minManip: 1,
  cooldown: 360,
  benign: true,
  weight(c) {
    if (c.water || c.gliding) return 0;
    return 9;
  },
  prepare(enc) {
    const p = enc.p;
    const blocks = findBlocks(enc.dim, p.location, 14, 5, TURNABLE, 12).filter((b) => {
      const c = { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
      return V.dist(c, p.location) > 3 && viewAngle(p, c) > 75 && lineOfSight(enc.dim, p.getHeadLocation(), c).clear;
    });
    if (blocks.length === 0) return false;
    enc.data.block = blocks[0];
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const b = enc.data.block;
    const c = { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
    // wait until it's still out of view, then turn it
    const ok = await enc.until(() => viewAngle(p, c) > 75, 200, 4);
    if (!ok) return enc.result("watched");
    const dir = enc.turn(b, p.location, 12 * 60);
    if (!dir) return enc.result("blocked");
    enc.sound(SOUNDS.turn, c, 0.45, 1, "caption.scrape");
    enc.log(`turned ${V.str(b)} -> ${dir}`);
    let look = 0;
    for (let t = 0; t < 20 * 40; t += 4) {
      await enc.wait(4);
      if (viewAngle(p, c) < 12 && V.dist(p.getHeadLocation(), c) < 18 && lineOfSight(enc.dim, p.getHeadLocation(), c).clear) look += 4;
      if (look >= 16) {
        enc.result("noticed", true);
        enc.discover("something_facing");
        safe(() => p.spawnParticle("observer:dust", c));
        break;
      }
      // only a player putting it back counts (not a ward, an explosion or a restore)
      if (enc.released.some((r) => r.player && (r.how === "player_restored" || r.how === "player_changed"))) {
        enc.result("turned_back", true);
        enc.discover("something_facing");
        enc.discover("put_back");
        break;
      }
    }
    if (!enc.noticed) enc.result("unnoticed");
    enc.restoreDelay = 10 * 60;
  },
});
