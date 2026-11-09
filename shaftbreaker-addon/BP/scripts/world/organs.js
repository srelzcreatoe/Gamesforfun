// @ts-check
// Territory organs. Organ Cores (pulse knots) give the creature strength inside its Hollow; Watcher
// Pods (listening organs) open when someone is near and tell it what they hear. Damaging organs makes
// the creature angrier now, but leaves that territory weaker afterwards. A muffler quiets an organ.
import { world, system } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { W, markDirty, hollowState } from "../core/state.js";
import { getBlock, dist, now, guard, rand, alive } from "../core/util.js";
import { territoryAt } from "./territory.js";
import { onHeartBroken } from "./dwelling.js";
import { makeNoise } from "../ai/perception.js";

export const organHooks = {
  /** @type {null | ((loc:any, kind:string, player:any) => void)} */ onOrganBroken: null,
  /** @type {null | ((loc:any, player:any) => void)} */ onPodSees: null,
};

/** @param {{x:number,y:number,z:number}} loc */
export function isMuffled(loc) {
  const t = W.ticks;
  for (const m of W.muffled) if (m[3] > t && Math.abs(m[0] - loc.x) < 1 && Math.abs(m[1] - loc.y) < 1 && Math.abs(m[2] - loc.z) < 1) return true;
  return false;
}
/** @param {{x:number,y:number,z:number}} loc */
export function muffle(loc) {
  W.muffled = W.muffled.filter((m) => m[3] > W.ticks);
  W.muffled.push([Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z), W.ticks + 6000]);
  if (W.muffled.length > 64) W.muffled.shift();
  markDirty();
}

/** Territory health 0..1 for buffs (fewer intact organs = weaker creature there). @param {string} hid */
export function organHealth(hid) {
  const hs = hollowState(hid);
  const total = Math.max(4, hs.organs);
  return Math.max(0, 1 - (hs.organsBroken + hs.podsBroken * 0.5) / total);
}

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  if (!cfg.enabled) return;
  guard("organBreak", () => {
    const id = ev.brokenBlockPermutation.type.id;
    if (!id.startsWith("shaftbreaker:")) return;
    const loc = ev.block.location;
    const dim = ev.dimension;
    const t = territoryAt(loc);
    const muffled = isMuffled(loc);
    const center = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
    if (id === "shaftbreaker:organ_core") {
      dim.spawnParticle("shaftbreaker:organ_burst", center);
      dim.playSound("shaftbreaker.block.organ_burst", center, { volume: 1.0 });
      // the spent husk remains as a permanent reminder
      system.run(() => guard("husk", () => {
        const b = getBlock(dim, loc);
        if (b && b.isAir) b.setType("shaftbreaker:cracked_organ_core");
      }));
      W.anger = Math.min(100, W.anger + (muffled ? 4 : 10));
      if (t) {
        const hs = hollowState(t.h.id);
        hs.organsBroken++;
        hs.rage = Math.min(100, hs.rage + (muffled ? 6 : 16));
      }
      makeNoise(center, muffled ? 16 : 64, "organ", ev.player.id);
      markDirty();
      organHooks.onOrganBroken && organHooks.onOrganBroken(center, "core", ev.player);
    } else if (id === "shaftbreaker:watcher_pod" || id === "shaftbreaker:watcher_pod_open") {
      dim.spawnParticle("shaftbreaker:organ_burst", center);
      dim.playSound("shaftbreaker.block.organ_burst", center, { volume: 0.7, pitch: 1.3 });
      W.anger = Math.min(100, W.anger + (muffled ? 2 : 5));
      if (t) {
        const hs = hollowState(t.h.id);
        hs.podsBroken++;
        hs.rage = Math.min(100, hs.rage + (muffled ? 3 : 8));
        hs.pods = hs.pods.filter((p) => !(p[0] === loc.x && p[1] === loc.y && p[2] === loc.z));
      }
      makeNoise(center, muffled ? 12 : 40, "organ", ev.player.id);
      markDirty();
      organHooks.onOrganBroken && organHooks.onOrganBroken(center, "pod", ev.player);
    } else if (id === "shaftbreaker:dwelling_heart") {
      dim.spawnParticle("shaftbreaker:organ_burst", center);
      dim.spawnParticle("shaftbreaker:blood_mist", center);
      dim.playSound("shaftbreaker.block.organ_burst", center, { volume: 1.4, pitch: 0.7 });
      onHeartBroken(loc, ev.player);
    } else if (t && (id === "shaftbreaker:fleshstone" || id === "shaftbreaker:pulsing_flesh" || id === "shaftbreaker:hanging_tissue")) {
      const hs = hollowState(t.h.id);
      hs.rage = Math.min(100, hs.rage + 0.35);
      markDirty();
    }
  });
});

const openPods = new Map(); // key -> tick opened

/** every 10 ticks: watcher pods open for nearby players and report them */
export function podTick() {
  if (!cfg.enabled || !cfg.territory) return;
  const dim = world.getDimension("overworld");
  const t0 = now();
  for (const pl of dim.getPlayers()) {
    const t = territoryAt(pl.location);
    if (!t) continue;
    const hs = hollowState(t.h.id);
    for (const p of hs.pods) {
      const loc = { x: p[0], y: p[1], z: p[2] };
      const d = dist(pl.location, { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 });
      if (d > 14) continue;
      const k = p.join(",");
      const b = getBlock(dim, loc);
      if (!b) continue;
      let id = "";
      try { id = b.typeId; } catch { continue; }
      if (id !== "shaftbreaker:watcher_pod" && id !== "shaftbreaker:watcher_pod_open") continue;
      const muffled = isMuffled(loc);
      if (d < 5.5 && id === "shaftbreaker:watcher_pod" && !muffled) {
        guard("podOpen", () => {
          b.setType("shaftbreaker:watcher_pod_open");
          dim.playSound("shaftbreaker.block.pod_open", { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 });
        });
        openPods.set(k, t0);
      } else if (id === "shaftbreaker:watcher_pod_open") {
        if (d > 8 || muffled) {
          guard("podClose", () => b.setType("shaftbreaker:watcher_pod"));
          openPods.delete(k);
        } else if (!muffled && t0 - (openPods.get(k) || t0) > 30) {
          organHooks.onPodSees && organHooks.onPodSees(loc, pl);
          openPods.set(k, t0 - 10);
        }
      }
    }
  }
}

/** Is any intact, un-muffled listening organ near this noise? @param {{x:number,y:number,z:number}} loc */
export function podHears(loc) {
  const t = territoryAt(loc);
  if (!t) return false;
  const hs = hollowState(t.h.id);
  for (const p of hs.pods) {
    if (dist(loc, { x: p[0], y: p[1], z: p[2] }) < 16 && !isMuffled({ x: p[0], y: p[1], z: p[2] })) return true;
  }
  return false;
}

/** Slow rage decay (every 600 ticks) */
export function rageDecay() {
  W.anger = Math.max(0, W.anger - 1);
  for (const id in W.hollows) {
    const hs = W.hollows[id];
    if (hs.rage > 0) hs.rage = Math.max(0, hs.rage - 1.5);
  }
  markDirty();
}

export { alive, rand };
