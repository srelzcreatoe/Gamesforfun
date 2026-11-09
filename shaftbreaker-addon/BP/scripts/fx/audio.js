// @ts-check
// Dynamic audio: the player's heartbeat (faster and louder as it gets closer), cave and territory
// ambience, organ pulses, drips and rumbles, and phase-dependent music that escalates from a quiet
// stalking bed to the standoff theme to full chase music.
import { world } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { now, clamp, randInt, rand, getBlock, guard, dist, pick } from "../core/util.js";
import { solid } from "../core/blocks.js";
import { T, threatDist } from "../ai/threat.js";
import { PS, getP } from "../ai/players.js";
import { hollowState } from "../core/state.js";
import { dustFall } from "./environment.js";

const TRACK_LEN = { stalk: 45, encounter: 27.8, chase: 25.6, final: 39.3 };

/** @param {import("@minecraft/server").Player} pl @param {string} text */
export function caption(pl, text) {
  if (!cfg.captions) return;
  const p = getP(pl);
  if (now() < p.captionNext) return;
  p.captionNext = now() + 40;
  try { pl.onScreenDisplay.setActionBar("§7[" + text + "]"); } catch { /* */ }
}

/** Stinger when the player spots the creature. */
export function stinger(pl, strong = false) {
  const p = getP(pl);
  if (now() - p.lastStinger < 400) return;
  p.lastStinger = now();
  try {
    pl.playSound("shaftbreaker.spotted", { volume: 0.9 * cfg.screamVolume });
    if (strong && rand() < 0.5) pl.playSound("shaftbreaker.tinnitus", { volume: 0.5 });
  } catch { /* */ }
  caption(pl, "A sharp dissonant sting");
}

/** every tick: heartbeat scheduling */
export function heartbeatTick() {
  if (!cfg.enabled || cfg.heartbeatVolume <= 0) return;
  const t = now();
  for (const pl of world.getAllPlayers()) {
    const p = PS.get(pl.id);
    if (!p || t < p.hbNext) continue;
    const b = T.brain;
    let interval = 0;
    let vol = 0;
    const d = threatDist(pl);
    if (b && d < 44) {
      const close = clamp(1 - d / 44, 0, 1);
      const st = b.state;
      if (st === "hunt" || st === "escape") {
        interval = b.targetId === pl.id ? 8 : 10;
        vol = Math.max(0.8, 0.5 + close * 0.5);
      } else if (st === "standoff") {
        interval = d < 12 ? 10 : 12;
        vol = 0.5 + close * 0.5;
      } else if (st !== "leave") {
        interval = Math.round(20 - close * 8);
        vol = 0.25 + close * 0.6;
      }
    } else {
      // a phantom nearby gives a false alarm
      for (const ph of T.phantoms) {
        try {
          if (ph.isValid && ph.dimension.id === pl.dimension.id && dist(ph.location, pl.location) < 36) { interval = 16; vol = 0.4; break; }
        } catch { /* */ }
      }
    }
    if (!interval) { p.hbLevel = 0; continue; }
    p.hbLevel = interval;
    const file = interval <= 9 ? "shaftbreaker.heartbeat.fast" : interval <= 13 ? "shaftbreaker.heartbeat.med" : "shaftbreaker.heartbeat.slow";
    guard("hb", () => pl.playSound(file, { volume: clamp(vol * cfg.heartbeatVolume, 0.05, 1.5) }));
    p.hbNext = t + interval + (rand() < 0.3 ? 1 : 0);
    if (interval <= 10) caption(pl, "Your heart is pounding");
  }
}

/** desired music for a player */
function desiredTrack(pl, p) {
  const b = T.brain;
  if (!b) return null;
  const d = threatDist(pl);
  if (d > 56) return null;
  if (b.state === "hunt" || b.state === "escape") return b.final ? "final" : "chase";
  if (b.state === "scream") return b.final ? "final" : "chase";
  if (b.state === "standoff") return "encounter";
  if ((b.state === "stalk" || b.state === "search" || b.state === "ambush") && now() - p.spottedAt < 900) return "stalk";
  return null;
}

/** every 20 ticks */
export function musicTick() {
  if (!cfg.enabled) return;
  const t = now();
  for (const pl of world.getAllPlayers()) {
    const p = PS.get(pl.id);
    if (!p) continue;
    guard("music", () => {
      const want = cfg.musicMode === 0 ? null : desiredTrack(pl, p);
      if (want !== p.music) {
        if (cfg.musicMode !== 2 && p.music) pl.stopMusic();
        if (cfg.musicMode === 1 && want) pl.playMusic("shaftbreaker.music." + want, { fade: 1.2, loop: true, volume: cfg.musicVolume });
        p.music = want;
        p.musicNext = t;
      }
      if (cfg.musicMode === 2 && want && t >= p.musicNext) {
        pl.playSound("shaftbreaker.sfx_music." + want, { volume: cfg.musicVolume });
        p.musicNext = t + Math.floor(TRACK_LEN[want] * 20) - 2;
      }
    });
  }
}

/** Stops encounter music immediately for everyone (creature gone / feature disabled). */
export function stopAllMusic() {
  for (const pl of world.getAllPlayers()) {
    const p = PS.get(pl.id);
    if (p && p.music) {
      guard("stopMusic", () => { if (cfg.musicMode === 1) pl.stopMusic(); });
      p.music = null;
    }
  }
}

/** every 20 ticks: ambience beds, drips, rumbles, territory organ pulses and motes */
export function ambienceTick() {
  if (!cfg.enabled) return;
  const t = now();
  for (const pl of world.getAllPlayers()) {
    const p = PS.get(pl.id);
    if (!p || !p.underground) continue;
    guard("amb", () => {
      const dim = pl.dimension;
      const loc = pl.location;
      const busy = threatDist(pl) < 48;
      if (t >= p.ambNext && !busy && cfg.ambienceVolume > 0 && t >= p.silenceUntil) {
        const terr = p.terrS > 0.3;
        pl.playSound(terr ? "shaftbreaker.territory" : "shaftbreaker.ambience", { volume: cfg.ambienceVolume * (terr ? 0.9 : 0.75) });
        p.ambNext = t + randInt(520, 1100);
      }
      if (t >= p.dripNext) {
        const dl = { x: loc.x + randInt(-8, 8), y: loc.y + randInt(1, 5), z: loc.z + randInt(-8, 8) };
        dim.playSound("shaftbreaker.drip", dl, { volume: 0.6 * cfg.ambienceVolume, pitch: 0.9 + rand() * 0.25 });
        p.dripNext = t + randInt(110, 340);
      }
      if (t >= p.rumbleNext) {
        pl.playSound("shaftbreaker.rumble", { volume: 0.7 * cfg.ambienceVolume });
        dustFall(dim, loc, 3);
        p.rumbleNext = t + randInt(3600, 8400);
      }
      if (p.terrS > 0.2 && p.terr) {
        if (t >= p.pulseNext && t >= p.silenceUntil) {
          const hs = hollowState(p.terr.h.id);
          const near = hs.pods.filter((q) => dist({ x: q[0], y: q[1], z: q[2] }, loc) < 24);
          const at = near.length && rand() < 0.6
            ? (() => { const q = pick(near); return { x: q[0] + 0.5, y: q[1] + 0.5, z: q[2] + 0.5 }; })()
            : { x: loc.x + randInt(-9, 9), y: loc.y + randInt(0, 4), z: loc.z + randInt(-9, 9) };
          dim.playSound("shaftbreaker.block.organ_pulse", at, { volume: 0.55 + p.terrS * 0.4, pitch: 0.85 + rand() * 0.2 });
          p.pulseNext = t + Math.floor(randInt(40, 100) * (1 - p.terrS * 0.45));
        }
        if (!cfg.reducedParticles && t >= p.partNext) {
          const pos = { x: loc.x, y: loc.y + 1.5, z: loc.z };
          try {
            pl.spawnParticle(rand() < 0.6 ? "shaftbreaker:spore" : "shaftbreaker:ash", pos);
          } catch { /* */ }
          // drips of blood from nearby Dripfang tips
          for (let i = 0; i < 4; i++) {
            const x = Math.floor(loc.x) + randInt(-6, 6);
            const z = Math.floor(loc.z) + randInt(-6, 6);
            for (let y = Math.floor(loc.y); y < Math.floor(loc.y) + 9; y++) {
              const b = getBlock(dim, { x, y, z });
              if (!b) break;
              if (b.typeId === "shaftbreaker:dripfang") {
                try { if (b.permutation.getState(/** @type {any} */ ("shaftbreaker:segment")) === 2) pl.spawnParticle("shaftbreaker:drip", { x: x + 0.5, y: y - 0.05, z: z + 0.5 }); } catch { /* */ }
                break;
              }
              if (solid(b)) break;
            }
          }
          p.partNext = t + 40;
        }
      }
    });
  }
}
