// @ts-check
// Grinning Moths: the creature's eyes. They drift through its territory (and around anyone it is
// stalking), gather at torchlight, perch on walls to stare with that grin, and when they giggle, it
// knows where you are.
import { world } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { MOTH_ID, now, rand, randInt, chance, dist, guard, alive, getBlock, flat, sub } from "../core/util.js";
import { solid } from "../core/blocks.js";
import { T } from "../ai/threat.js";
import { getP } from "../ai/players.js";
import { clearLine } from "../ai/perception.js";
import { notice } from "../ai/dweller.js";
import { unlock } from "../ui/journal.js";

const state = new Map(); // moth id -> {perchUntil, watch, giggleT}

/** every 40 ticks: spawn moths near players in the territory / being stalked */
export function mothSpawnTick() {
  if (!cfg.enabled || !cfg.moths) return;
  const dim = world.getDimension("overworld");
  for (const pl of dim.getPlayers()) {
    const p = getP(pl);
    if (!p.underground) continue;
    const stalked = T.brain && T.brain.targetId === pl.id && T.brain.state !== "hunt";
    const want = Math.round((p.terrS > 0.15 ? 2 + p.terrS * 4 : 0) + (stalked ? 2 : 0));
    if (!want) continue;
    let count = 0;
    try { count = dim.getEntities({ type: MOTH_ID, location: pl.location, maxDistance: 40 }).length; } catch { continue; }
    if (count >= want || !chance(0.35)) continue;
    for (let i = 0; i < 8; i++) {
      const a = rand() * Math.PI * 2;
      const d = randInt(9, 18);
      const pos = { x: pl.location.x + Math.cos(a) * d, y: pl.location.y + randInt(1, 4), z: pl.location.z + Math.sin(a) * d };
      const b = getBlock(dim, pos);
      const b2 = getBlock(dim, { x: pos.x, y: pos.y + 1, z: pos.z });
      if (!b || !b2 || !b.isAir || !b2.isAir) continue;
      let light = 15;
      try { light = dim.getLightLevel({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }); } catch { /* */ }
      if (light > 6) continue;
      guard("mothSpawn", () => dim.spawnEntity(MOTH_ID, pos));
      break;
    }
  }
}

/** every 10 ticks: moth behaviour */
export function mothTick() {
  if (!cfg.enabled || !cfg.moths) return;
  const dim = world.getDimension("overworld");
  const t = now();
  for (const pl of dim.getPlayers()) {
    let moths = [];
    try { moths = dim.getEntities({ type: MOTH_ID, location: pl.location, maxDistance: 28 }); } catch { continue; }
    for (const m of moths) {
      guard("moth", () => {
        let s = state.get(m.id);
        if (!s) { s = { perchUntil: 0, watch: 0, giggleT: t + randInt(60, 300) }; state.set(m.id, s); }
        const d = dist(m.location, pl.location);
        if (d < 3.2) {
          // flutter away from a close player
          if (s.perchUntil) { s.perchUntil = 0; m.triggerEvent("shaftbreaker:moth_fly"); m.setProperty("shaftbreaker:perched", false); }
          const away = flat(sub(m.location, pl.location));
          m.applyImpulse({ x: away.x * 0.35, y: 0.12, z: away.z * 0.35 });
          return;
        }
        if (s.perchUntil) {
          if (t > s.perchUntil) {
            s.perchUntil = 0;
            m.triggerEvent("shaftbreaker:moth_fly");
            m.setProperty("shaftbreaker:perched", false);
            return;
          }
          const sees = d < 16 && clearLine(dim, m.location, pl.getHeadLocation());
          if (sees) {
            s.watch += 10;
            if (s.watch >= 80) {
              s.watch = 0;
              m.dimension.playSound("shaftbreaker.moth.giggle", m.location, { volume: 0.8 });
              notice(pl.location, pl);
              const p = getP(pl);
              if (!T.brain) p.tension = Math.min(100, p.tension + 7);
              p.mothReports++;
              unlock(pl, "moth");
            }
          }
          return;
        }
        if (t > s.giggleT && d < 14) {
          s.giggleT = t + randInt(200, 500);
          if (chance(0.5)) m.dimension.playSound("shaftbreaker.moth.giggle", m.location, { volume: 0.6 });
        }
        if (d < 14 && chance(0.05)) {
          // perch on a nearby wall / ceiling, facing the player
          const l = m.location;
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
            if (solid(getBlock(dim, { x: l.x + dx, y: l.y + dy, z: l.z + dz }))) {
              s.perchUntil = t + randInt(120, 320);
              s.watch = 0;
              m.triggerEvent("shaftbreaker:moth_perch");
              m.setProperty("shaftbreaker:perched", true);
              m.clearVelocity();
              unlock(pl, "moth");
              break;
            }
          }
        }
        if (!cfg.reducedParticles && chance(0.15)) {
          try { pl.spawnParticle("shaftbreaker:moth_dust", m.location); } catch { /* */ }
        }
      });
    }
  }
  if (state.size > 200) for (const k of [...state.keys()].slice(0, 100)) state.delete(k);
}

export { alive };
