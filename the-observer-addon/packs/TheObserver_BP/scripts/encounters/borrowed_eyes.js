// @ts-check
// E23 "Borrowed Eyes" — it watches through something else. A villager, a cow, a zombie in front of
// the player stops what it is doing and turns its head to follow them, wherever they go, for a few
// long seconds. Then it simply walks on as if nothing happened. No sound, no figure.
// Stage 2+, at most every 10 minutes; nothing is harmed and nothing changes.
import { register } from "../director/director.js";
import { V, safe, rand } from "../core/util.js";
import { lineOfSight, viewAngle } from "../world/sight.js";

const HOSTS = new Set([
  "minecraft:villager_v2", "minecraft:wandering_trader", "minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:chicken",
  "minecraft:goat", "minecraft:horse", "minecraft:donkey", "minecraft:llama", "minecraft:mooshroom", "minecraft:rabbit",
  "minecraft:fox", "minecraft:cat", "minecraft:wolf", "minecraft:camel", "minecraft:armadillo",
  "minecraft:zombie", "minecraft:husk", "minecraft:skeleton", "minecraft:stray", "minecraft:zombie_villager_v2",
]);

/** A creature 6-24 blocks away in front of the player that they can see. @param {import("@minecraft/server").Player} p */
export function hostFor(p) {
  const eye = p.getHeadLocation();
  const list = safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 24 }), []) ?? [];
  let best, bestScore = -1;
  for (const m of list) {
    if (!HOSTS.has(m.typeId) || !m.isValid) continue;
    const d = V.dist(m.location, p.location);
    if (d < 6) continue;
    const head = safe(() => m.getHeadLocation(), m.location) ?? m.location;
    const ang = viewAngle(p, head);
    if (ang > 70) continue;
    if (!lineOfSight(p.dimension, eye, head).clear) continue;
    const score = (70 - ang) / 10 + (24 - d) / 6 + Math.random();
    if (score > bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

register({
  id: "borrowed_eyes",
  tier: 1,
  minStage: 2,
  needsBody: false,
  benign: true,
  cooldown: 600,
  weight(c) {
    if (c.water || c.gliding || c.underground) return 0;
    return 6;
  },
  prepare(enc) {
    const m = hostFor(enc.p);
    if (!m) return false;
    enc.data.host = m;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    /** @type {import("@minecraft/server").Entity} */
    const m = enc.data.host;
    const total = Math.floor(rand(140, 220));
    let watched = 0;
    // it stands still and follows the player with its head; heavy slowness keeps it planted
    safe(() => m.addEffect("slowness", total + 10, { amplifier: 10, showParticles: false }));
    enc.emit("borrowed", { what: "start", host: m.typeId });
    try {
      for (let t = 0; t < total; t += 2) {
        await enc.wait(2);
        if (!m.isValid) return enc.result("host_gone");
        const head = safe(() => m.getHeadLocation(), m.location) ?? m.location;
        const eye = p.getHeadLocation();
        safe(() => m.setRotation({ x: V.pitchTo(head, eye), y: V.yawTo(m.location, eye) }));
        safe(() => m.clearVelocity());
        if (viewAngle(p, head) < 14 && lineOfSight(enc.dim, eye, head).clear) watched += 2;
        // looked at long enough, it holds the stare a moment longer and lets go
        if (watched >= 40 && t < total - 30) t = total - 30;
      }
    } finally {
      safe(() => m.isValid && m.removeEffect("slowness"));
    }
    enc.emit("borrowed", { what: "end", watched });
    enc.result(watched >= 20 ? "noticed" : "unnoticed", watched >= 20);
  },
});
