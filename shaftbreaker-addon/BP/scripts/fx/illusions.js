// @ts-check
// Psychological events: sounds that copy you, eyes in the dark, sightings that aren't there,
// lights going out, doors moving, claw marks appearing, the way back sealing itself.
import { world, system, MolangVariableMap } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { PHANTOM_ID, now, rand, randInt, chance, pick, dist, flat, sub, guard, alive, getBlock, weighted } from "../core/util.js";
import { solid, passable } from "../core/blocks.js";
import { T } from "../ai/threat.js";
import { getP } from "../ai/players.js";
import { playerSees, lookDot, clearLine } from "../ai/perception.js";
import { requestNav } from "../ai/navmap.js";
import { extinguishTorches, findDoor, tauntDoor, scratchWalls, sealBehind, dustFall } from "./environment.js";
import { caption } from "./audio.js";
import { unlock } from "../ui/journal.js";

/** Point roughly behind the player at a distance, inside rock if possible (sounds "through the wall"). */
function behind(pl, d, spread = 0.9) {
  const vd = flat(pl.getViewDirection());
  const a = Math.atan2(-vd.z, -vd.x) + (rand() - 0.5) * spread * 2;
  return { x: pl.location.x + Math.cos(a) * d, y: pl.location.y + randInt(-1, 2), z: pl.location.z + Math.sin(a) * d };
}
function aside(pl, d) {
  const vd = flat(pl.getViewDirection());
  const s = chance(0.5) ? 1 : -1;
  return { x: pl.location.x - vd.z * d * s + vd.x * d * 0.3, y: pl.location.y + randInt(0, 2), z: pl.location.z + vd.x * d * s + vd.z * d * 0.3 };
}

/** reachable dark cell at distance, optionally in the peripheral view */
function darkCell(pl, minD, maxD, view) {
  const p = getP(pl);
  requestNav(pl, p);
  const cells = p.nav && p.nav.cells;
  if (!cells || cells.length < 8) return null;
  const head = pl.getHeadLocation();
  for (let i = 0; i < 60; i++) {
    const c = cells[Math.floor(rand() * cells.length)];
    const pos = { x: c.x + 0.5, y: c.y, z: c.z + 0.5 };
    const d = dist(pos, pl.location);
    if (d < minD || d > maxD || c.water) continue;
    const top = { x: pos.x, y: pos.y + 1.6, z: pos.z };
    const ld = lookDot(pl, top);
    if (view === "peripheral" && (ld < 0.45 || ld > 0.86)) continue;
    if (view === "hidden" && ld > 0.3) continue;
    let light = 15;
    try { light = pl.dimension.getLightLevel({ x: c.x, y: c.y + 1, z: c.z }); } catch { /* */ }
    if (light > 4) continue;
    if (view !== "hidden" && !clearLine(pl.dimension, head, top)) continue;
    return { c, pos };
  }
  return null;
}

const ILLUSIONS = {
  /** Your mining continues after you stop - from somewhere else, in your rhythm. */
  extraPickaxe(pl, p) {
    if (p.streak < 4 || now() - p.lastBreak < 30 || now() - p.lastBreak > 160) return false;
    const at = behind(pl, randInt(11, 19), 1.4);
    const n = randInt(3, 6);
    const gap = Math.max(5, Math.min(22, Math.round(p.profile.rhythm || 12)));
    for (let i = 0; i < n; i++) {
      system.runTimeout(() => guard("pick", () => pl.dimension.playSound("dig.stone", at, { volume: 0.85, pitch: 0.92 + rand() * 0.1 })), i * gap + randInt(0, 2));
    }
    caption(pl, "Mining, somewhere else");
    return true;
  },
  /** You stop walking. One more step lands behind you. */
  delayedFootstep(pl, p) {
    if (p.still < 6 || p.still > 30 || p.wasMovingTicks < 40) return false;
    const vd = flat(pl.getViewDirection());
    const at = { x: pl.location.x - vd.x * 3, y: pl.location.y, z: pl.location.z - vd.z * 3 };
    system.runTimeout(() => guard("dstep", () => pl.dimension.playSound("step.stone", at, { volume: 0.9, pitch: 0.85 })), 6);
    if (chance(0.4)) system.runTimeout(() => guard("dstep2", () => pl.dimension.playSound("shaftbreaker.step", at, { volume: 0.35 })), 16);
    caption(pl, "A footstep behind you");
    return true;
  },
  /** Something answers your knocking. */
  answeringKnock(pl, p) {
    if (now() - p.lastBreak > 200 && now() - p.lastPlace > 200) return false;
    const at = behind(pl, randInt(16, 28), 2.5);
    system.runTimeout(() => guard("knock", () => pl.dimension.playSound("shaftbreaker.knock", at, { volume: 0.9 })), randInt(20, 50));
    caption(pl, "Knocking, deeper in the rock");
    return true;
  },
  /** Footsteps approach out of the dark... and stop. */
  unfinishedApproach(pl) {
    const start = behind(pl, 22, 1.2);
    const end = behind(pl, 7, 0.1);
    const steps = randInt(6, 9);
    for (let i = 0; i < steps; i++) {
      const f = i / (steps - 1);
      const at = { x: start.x + (end.x - start.x) * f, y: start.y + (end.y - start.y) * f, z: start.z + (end.z - start.z) * f };
      system.runTimeout(() => guard("appr", () => pl.dimension.playSound("shaftbreaker.step", at, { volume: 0.5 + f * 0.4 })), i * 13);
    }
    caption(pl, "Heavy footsteps approaching");
    return true;
  },
  /** A pair of glowing eyes in the dark, only you can see. */
  eyesInDark(pl) {
    const s = darkCell(pl, 12, 26, "peripheral");
    if (!s) return false;
    const toP = flat(sub(pl.location, s.pos));
    const side = { x: -toP.z * 0.17, y: 0, z: toP.x * 0.17 };
    const y = s.pos.y + (s.c.tall ? 2.55 : 1.55);
    const vars = new MolangVariableMap();
    vars.setFloat("variable.eye_life", randInt(18, 32) / 10);
    const red = chance(0.2);
    const id = red ? "shaftbreaker:eye_glint_red" : "shaftbreaker:eye_glint";
    guard("eyes", () => {
      pl.spawnParticle(id, { x: s.pos.x + side.x, y, z: s.pos.z + side.z }, vars);
      pl.spawnParticle(id, { x: s.pos.x - side.x, y, z: s.pos.z - side.z }, vars);
    });
    return true;
  },
  /** It's standing over there. Look again. */
  phantom(pl) {
    if (!cfg.phantoms || T.brain || T.phantoms.length) return false;
    const s = darkCell(pl, 18, 34, chance(0.5) ? "peripheral" : "hidden");
    if (!s) return false;
    let e;
    try { e = pl.dimension.spawnEntity(PHANTOM_ID, s.pos); } catch { return false; }
    guard("phInit", () => {
      e.setRotation({ x: 0, y: (Math.atan2(-(pl.location.x - s.pos.x), pl.location.z - s.pos.z) * 180) / Math.PI });
      e.setProperty("shaftbreaker:state", s.c.tall ? pick(["watch", "watch", "peek_l", "peek_r"]) : "stalk");
      e.setProperty("shaftbreaker:eyes", 1);
      e.setDynamicProperty("shaftbreaker:watcher", pl.id);
      e.setDynamicProperty("shaftbreaker:born", now());
      e.setDynamicProperty("shaftbreaker:life", randInt(160, 280));
    });
    T.phantoms.push(e);
    return true;
  },
  torches(pl, p) {
    if (cfg.torchMode < 2 && !T.brain) return false;
    if (cfg.torchMode <= 0) return false;
    const n = extinguishTorches(pl, pl.location, randInt(1, 3), 14);
    if (n) { unlock(pl, "torches"); caption(pl, "A torch fizzles out"); }
    return n > 0 && p !== null;
  },
  door(pl) {
    if (!cfg.doors) return false;
    const d = findDoor(pl.dimension, pl.location, 9);
    if (!d) return false;
    if (T.brain && dist(T.brain.e.location, d.location) < 10) {
      tauntDoor(d, randInt(2, 4));
      unlock(pl, "doors");
    } else {
      // no one is there: the door just creaks
      guard("creak", () => pl.dimension.playSound("random.door_open", { x: d.location.x + 0.5, y: d.location.y + 1, z: d.location.z + 0.5 }, { volume: 0.7, pitch: 0.8 }));
    }
    return true;
  },
  scratches(pl, p) {
    if (!cfg.scratchMarks) return false;
    const at = behind(pl, randInt(6, 12), 1.0);
    const lvl = Math.min(3, Math.floor(p.profile.enc / 3) + (p.terrS > 0.4 ? 1 : 0));
    const n = scratchWalls(pl.dimension, at, randInt(2, 5), lvl);
    if (n) {
      guard("scr", () => pl.dimension.playSound("shaftbreaker.scrape", at, { volume: 0.6 }));
      unlock(pl, "scratches");
    }
    return n > 0;
  },
  whisper(pl) {
    const vd = flat(pl.getViewDirection());
    const at = { x: pl.location.x - vd.x * 1.4 + vd.z * 0.6, y: pl.location.y + 1.7, z: pl.location.z - vd.z * 1.4 - vd.x * 0.6 };
    guard("wh", () => pl.dimension.playSound("shaftbreaker.whisper", at, { volume: 0.7 }));
    caption(pl, "Whispering, right behind you");
    return true;
  },
  caveIn(pl) {
    guard("rumble", () => pl.playSound("shaftbreaker.rumble", { volume: 0.9 }));
    dustFall(pl.dimension, pl.location, 5);
    caption(pl, "The cave rumbles");
    return true;
  },
  distantScream(pl) {
    const at = behind(pl, randInt(40, 60), 3);
    guard("scrf", () => pl.dimension.playSound("shaftbreaker.scream_far", at, { volume: 0.9 * cfg.screamVolume }));
    caption(pl, "A distant scream");
    return true;
  },
  lightDim(pl) {
    if (!cfg.screenEffects) return false;
    guard("dim", () => pl.addEffect("darkness", 70, { amplifier: 0, showParticles: false }));
    guard("tin", () => pl.playSound("shaftbreaker.tinnitus", { volume: 0.4 }));
    return true;
  },
  footstepEcho(pl, p) {
    if (p.moving < 30) return false;
    for (let i = 0; i < 4; i++) {
      system.runTimeout(() => guard("echo", () => {
        const vd = flat(pl.getViewDirection());
        pl.dimension.playSound("step.stone", { x: pl.location.x - vd.x * 5, y: pl.location.y, z: pl.location.z - vd.z * 5 }, { volume: 0.55 });
      }), 24 + i * 9);
    }
    return true;
  },
  movement(pl) {
    const at = aside(pl, randInt(10, 18));
    guard("mv", () => pl.dimension.playSound(chance(0.5) ? "shaftbreaker.move_far" : "shaftbreaker.crawl", at, { volume: 0.8 }));
    caption(pl, "Something moving in the tunnels");
    return true;
  },
  seal(pl) {
    return sealBehind(pl);
  },
};

/** Picks and runs an appropriate illusion for this player. */
export function runIllusion(pl, p, forced) {
  if (!cfg.illusions && !forced) return false;
  if (forced) {
    const fn = ILLUSIONS[forced];
    return fn ? !!guard("ill", () => fn(pl, p)) : false;
  }
  const terr = p.terrS > 0.3;
  const used = p.illusionUsed;
  const t = now();
  const w = {
    extraPickaxe: p.streak >= 4 ? 5 : 0,
    delayedFootstep: p.still > 5 && p.still < 30 ? 4 : 0,
    answeringKnock: 2,
    unfinishedApproach: 2,
    eyesInDark: 3 + (terr ? 2 : 0),
    phantom: cfg.phantoms ? 2.2 + (terr ? 1 : 0) : 0,
    torches: cfg.torchMode >= 2 && p.torches.length ? 2 : 0,
    door: cfg.doors ? 0.8 : 0,
    scratches: cfg.scratchMarks ? 1.8 : 0,
    whisper: 1.5 + (terr ? 1 : 0),
    caveIn: 1,
    distantScream: 1.2,
    lightDim: cfg.screenEffects ? 0.8 : 0,
    footstepEcho: p.moving > 30 ? 1.5 : 0,
    movement: 2,
    seal: cfg.pathSealing && terr ? 1.2 : 0,
  };
  // repeated-event suppression: recently used scares are much less likely
  for (const k in w) if (used[k] && t - used[k] < 6000) w[k] *= 0.15;
  for (let i = 0; i < 4; i++) {
    const k = weighted(w);
    if (!k) return false;
    const ok = guard("ill", () => ILLUSIONS[k](pl, p));
    if (ok) {
      used[k] = t;
      return true;
    }
    w[k] = 0;
  }
  return false;
}

/** every 2 ticks: phantoms disappear when looked at, approached, or after a while */
export function phantomTick() {
  const keep = [];
  for (const e of T.phantoms) {
    if (!alive(e)) continue;
    let gone = false;
    guard("ph", () => {
      const wid = e.getDynamicProperty("shaftbreaker:watcher");
      const born = Number(e.getDynamicProperty("shaftbreaker:born") || 0);
      const life = Number(e.getDynamicProperty("shaftbreaker:life") || 200);
      const pl = typeof wid === "string" ? /** @type {any} */ (world.getEntity(wid)) : undefined;
      if (!pl || now() - born > life || T.brain) { gone = true; return; }
      const d = dist(pl.location, e.location);
      const seen = playerSees(pl, e, 0, false);
      const looked = Number(e.getDynamicProperty("shaftbreaker:looked") || 0) + (seen === 2 ? 2 : 0);
      e.setDynamicProperty("shaftbreaker:looked", looked);
      if (seen && !e.getDynamicProperty("shaftbreaker:spotted")) {
        e.setDynamicProperty("shaftbreaker:spotted", true);
        guard("phs", () => pl.playSound("shaftbreaker.spotted", { volume: 0.6 }));
      }
      if (looked >= 8 || d < 13) {
        gone = true;
        unlock(pl, "phantom");
        if (chance(0.35)) {
          e.setProperty("shaftbreaker:state", "vanish");
          system.runTimeout(() => guard("phv", () => { if (alive(e)) { e.dimension.spawnParticle("shaftbreaker:phase_out", e.location); e.remove(); } }), 22);
          return;
        }
      }
    });
    if (gone) {
      if (alive(e) && e.getProperty("shaftbreaker:state") !== "vanish") guard("phrm", () => e.remove());
      continue;
    }
    keep.push(e);
  }
  T.phantoms = keep;
}

export { solid, passable, getBlock };
