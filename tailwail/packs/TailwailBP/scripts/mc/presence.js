// Presence: the haunting between encounters.  Every event here is aimed at ONE player
// (sounds only they hear, hallucinations only near them) and never hurts anyone.
import { BlockTypes, BlockVolume, system } from "@minecraft/server";
import { PRESENCE } from "../config.js";
import { mimicSoundFor } from "../core/presence_rules.js";
import { dirFromYaw, dist, dot, hdist, lerp, norm, sub, yawTo } from "../util/vec.js";
import { findCrossPath } from "./actions.js";
import { playFor } from "./audio.js";
import { removeEcho, spawnEcho } from "./echo.js";
import * as fx from "./fx.js";
import { dlog } from "./log.js";
import { lightAt, losClear } from "./perception.js";
import { behindPoint, findGlimpseSpot, findObservationSpot, findSoundSpot } from "./spots.js";
import { headroom, isOpen, safeBlock } from "./terrain.js";
import { findTorches, snuff } from "./torches.js";

const DOORS = ["minecraft:wooden_door", "minecraft:spruce_door", "minecraft:birch_door", "minecraft:jungle_door", "minecraft:acacia_door",
  "minecraft:dark_oak_door", "minecraft:mangrove_door", "minecraft:cherry_door", "minecraft:bamboo_door", "minecraft:crimson_door",
  "minecraft:warped_door", "minecraft:pale_oak_door"];
let doorTypes = null;
const liveDoors = () => (doorTypes = doorTypes || DOORS.filter((d) => !!BlockTypes.get(d)));
const GLASS = ["minecraft:glass", "minecraft:glass_pane", "minecraft:tinted_glass", ...["white", "orange", "magenta", "light_blue", "yellow",
  "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"].flatMap((c) => [`minecraft:${c}_stained_glass`,
  `minecraft:${c}_stained_glass_pane`])];
let glassTypes = null;
const liveGlass = () => (glassTypes = glassTypes || GLASS.filter((g) => !!BlockTypes.get(g)));

const viewYaw = (p) => {
  const v = p.getViewDirection();
  return yawTo({ x: 0, z: 0 }, { x: v.x, z: v.z });
};

/** Facing cosine of a point relative to the player's view (1 = dead centre). */
function viewCos(player, point) {
  const eye = player.getHeadLocation();
  return dot(norm(sub(point, eye)), player.getViewDirection());
}

export class Presence {
  constructor(rng) {
    this.rng = rng;
    this.steps = new Map(); // player id -> footstep follower
    this.mimic = new Map(); // player id -> armed-until tick
    this.behind = new Map(); // player id -> {until, yaw0, pos}
    this.timeouts = new Set();
  }

  later(ticks, fn) {
    const id = system.runTimeout(() => {
      this.timeouts.delete(id);
      try {
        fn();
      } catch (e) {
        dlog("presence later", e);
      }
    }, Math.max(1, Math.round(ticks)));
    this.timeouts.add(id);
  }

  /** Cheap world facts used to decide which events are possible right now. */
  env(player) {
    const torches = findTorches(player.dimension, player.location, 16, 10);
    const behindTorches = torches.filter((t) => viewCos(player, { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 }) < 0.2 && dist(t, player.location) >= PRESENCE.snuffRange[0]);
    const windows = this.findWindows(player, 10);
    return {
      torch: behindTorches.length > 0,
      torches: torches.length >= 3,
      door: this.findDoors(player, PRESENCE.doorRange).length > 0,
      window: windows.length > 0,
      wall: true,
      _torches: torches,
      _behind: behindTorches,
      _windows: windows,
    };
  }

  /** Glass in front of the player with a clear line to it (a window it can look through). */
  findWindows(player, r) {
    const c = player.location;
    const eye = player.getHeadLocation();
    const out = [];
    try {
      const vol = new BlockVolume({ x: Math.floor(c.x) - r, y: Math.floor(c.y) - 1, z: Math.floor(c.z) - r }, { x: Math.floor(c.x) + r, y: Math.floor(c.y) + 3, z: Math.floor(c.z) + r });
      for (const loc of player.dimension.getBlocks(vol, { includeTypes: liveGlass() }, false).getBlockLocationIterator()) {
        const ctr = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
        const d = hdist(ctr, c);
        if (d < 3 || d > r) continue;
        if (viewCos(player, ctr) < 0.35) continue;
        if (!losClear(player.dimension, eye, ctr)) continue;
        out.push(ctr);
        if (out.length >= 6) break;
      }
    } catch (e) {
      dlog("findWindows", e);
    }
    return out;
  }

  findDoors(player, r) {
    const c = player.location;
    const out = [];
    try {
      const vol = new BlockVolume({ x: Math.floor(c.x) - r, y: Math.floor(c.y) - 3, z: Math.floor(c.z) - r }, { x: Math.floor(c.x) + r, y: Math.floor(c.y) + 3, z: Math.floor(c.z) + r });
      for (const loc of player.dimension.getBlocks(vol, { includeTypes: liveDoors() }, false).getBlockLocationIterator()) {
        if (hdist(loc, c) >= 2.5) out.push({ x: loc.x, y: loc.y, z: loc.z });
      }
    } catch (e) {
      dlog("findDoors", e);
    }
    return out;
  }

  /** Runs one event.  Returns true if it actually happened. */
  run(id, player, env) {
    const fn = this["ev_" + id];
    if (!fn) return false;
    try {
      return !!fn.call(this, player, env || {});
    } catch (e) {
      dlog(`presence ${id} failed`, e);
      return false;
    }
  }

  // ------------------------------------------------------------------ the events
  ev_footsteps(player) {
    const now = system.currentTick;
    this.steps.set(player.id, {
      until: now + Math.round(this.rng.range(PRESENCE.footstepFollow[0], PRESENCE.footstepFollow[1]) * 20),
      behind: this.rng.range(PRESENCE.footstepBehind[0], PRESENCE.footstepBehind[1]),
      last: { ...player.location },
      acc: 0,
      movedAt: now,
      extra: true,
    });
    return true;
  }

  ev_mimic(player) {
    this.mimic.set(player.id, system.currentTick + PRESENCE.mimicWindow * 20);
    return true;
  }

  ev_knock(player) {
    const dim = player.dimension;
    const base = viewYaw(player) + 180 + this.rng.range(-50, 50);
    const d = dirFromYaw(base);
    const h = player.getHeadLocation();
    for (let k = 2; k <= 7; k++) {
      const p = { x: Math.floor(h.x + d.x * k), y: Math.floor(h.y - 0.5), z: Math.floor(h.z + d.z * k) };
      const b = safeBlock(dim, p);
      if (b && !isOpen(b)) {
        const at = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
        playFor(player, "tailwail.knock", at, 1.0, this.rng.range(0.85, 1.0), "Three knocks");
        return true;
      }
    }
    return false;
  }

  ev_breath(player) {
    const p = behindPoint(player, 1.4, false);
    const h = player.getHeadLocation();
    playFor(player, "tailwail.breath_behind", { x: p.x, y: h.y + 0.3, z: p.z }, 1.0, this.rng.range(0.9, 1.0), "Breathing right behind you");
    return true;
  }

  ev_whisper(player) {
    const p = behindPoint(player, 0.7, false);
    const h = player.getHeadLocation();
    playFor(player, "tailwail.whisper", { x: p.x, y: h.y, z: p.z }, 0.9, this.rng.range(0.92, 1.05));
    const name = player.name.toLowerCase().split("").join(" ");
    this.later(14, () => player.isValid && fx.actionbar(player, `§8§o. . . ${name} . . .`));
    return true;
  }

  ev_snuff(player, env) {
    const list = env._behind || [];
    if (!list.length) return false;
    const t = this.rng.pick(list);
    return snuff(player.dimension, t);
  }

  ev_lights_out(player, env) {
    const list = (env._torches || []).slice().sort((a, b) => dist(b, player.location) - dist(a, player.location)).slice(0, 6);
    if (list.length < 3) return false;
    let delay = 0;
    for (const t of list) {
      delay += this.rng.range(10, 18);
      this.later(delay, () => snuff(player.dimension, t));
    }
    this.later(delay + 30, () => player.isValid && this.ev_breath(player));
    return true;
  }

  ev_door(player) {
    const doors = this.findDoors(player, PRESENCE.doorRange);
    if (!doors.length) return false;
    const dim = player.dimension;
    for (const loc of doors) {
      const b = safeBlock(dim, loc);
      if (!b) continue;
      let upper = false;
      let open = false;
      try {
        upper = !!b.permutation.getState("upper_block_bit");
        open = !!b.permutation.getState("open_bit");
      } catch {
        continue;
      }
      if (upper) continue;
      try {
        b.setPermutation(b.permutation.withState("open_bit", !open));
        const top = safeBlock(dim, { x: loc.x, y: loc.y + 1, z: loc.z });
        if (top && top.typeId === b.typeId) top.setPermutation(top.permutation.withState("open_bit", !open));
        dim.playSound(open ? "random.door_close" : "random.door_open", { x: loc.x + 0.5, y: loc.y + 1, z: loc.z + 0.5 }, { volume: 1, pitch: 0.85 });
        return true;
      } catch (e) {
        dlog("door", e);
      }
    }
    return false;
  }

  /** Vanish rule for hallucinations: once you have seen it, it is gone the next time you look away. */
  watcher(player, minNear) {
    const st = { seen: 0, noticed: false };
    return (e) => {
      if (!player.isValid || player.dimension.id !== e.dimension.id) return true;
      const pos = e.location;
      const mid = { x: pos.x, y: pos.y + 2.0, z: pos.z };
      const d = dist(player.location, pos);
      if (d < minNear) return true;
      const c = viewCos(player, mid);
      const visible = c >= 0.3 && losClear(e.dimension, player.getHeadLocation(), mid);
      if (visible && c >= 0.8) {
        st.seen += 0.2;
        if (st.seen >= 0.25) st.noticed = true;
      }
      return st.noticed && !visible;
    };
  }

  ev_glimpse(player) {
    const spot = findGlimpseSpot({ player, dim: player.dimension, rng: this.rng, near: PRESENCE.glimpseRange[0], far: PRESENCE.glimpseRange[1], headroom: 4 });
    if (!spot) return false;
    const pose = spot.head >= 5 ? this.rng.pick(["reach", "tall", "tall", "watch", "neck"]) : "watch_low";
    return !!spawnEcho(player.dimension, spot, spot.facing, pose, PRESENCE.glimpseLife + 6, this.watcher(player, 12));
  }

  ev_peek(player) {
    const spot = findObservationSpot({
      near: PRESENCE.peekRange[0], far: Math.min(18, PRESENCE.peekRange[1]), partial: true, headroom: 3,
      rng: this.rng, dim: player.dimension, creaturePos: player.location, target: player, players: [player],
    });
    const side = spot ? /** @type {any} */ (spot).side : null;
    if (!spot || !side) return false;
    return !!spawnEcho(player.dimension, spot, yawTo(spot, player.location), side, 14, this.watcher(player, 8));
  }

  ev_behind(player) {
    const pos = behindPoint(player, 1.9, true);
    if (!pos || headroom(player.dimension, pos) < 4) return false;
    this.behind.set(player.id, { until: system.currentTick + Math.round(PRESENCE.behindWindow * 20), yaw0: viewYaw(player), pos });
    this.ev_breath(player);
    return true;
  }

  // ------------------------------------------------------------------ v3 events
  /** Claws scraping somewhere inside the rock beside you. */
  ev_scrape(player) {
    const dim = player.dimension;
    const h = player.getHeadLocation();
    const base = viewYaw(player) + this.rng.range(60, 300);
    const d = dirFromYaw(base);
    for (let k = 2; k <= 6; k++) {
      const p = { x: Math.floor(h.x + d.x * k), y: Math.floor(h.y - 0.5), z: Math.floor(h.z + d.z * k) };
      const b = safeBlock(dim, p);
      if (b && !isOpen(b)) {
        const at = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
        playFor(player, "tailwail.scrape", at, 1.0, this.rng.range(0.8, 0.95), "Claws scraping inside the stone");
        this.later(this.rng.range(25, 45), () => player.isValid && playFor(player, "tailwail.scrape", at, 0.9, this.rng.range(0.7, 0.85)));
        return true;
      }
    }
    return false;
  }

  /** Heavy running steps coming up fast from behind... and stopping right behind you. */
  ev_run_steps(player) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const d = 22 - i * 2.4;
      this.later(i * 4.5, () => {
        if (!player.isValid) return;
        const p = behindPoint(player, Math.max(1.2, d), false);
        playFor(player, "tailwail.step_heavy", { x: p.x, y: player.location.y + 0.5, z: p.z }, 1.0, this.rng.range(0.8, 0.95));
      });
    }
    this.later(n * 4.5 + 10, () => {
      if (!player.isValid) return;
      this.ev_breath(player);
      fx.shake(player, 0.12, 0.4);
    });
    return true;
  }

  /** A scream, very far away. */
  ev_distant_scream(player) {
    const spot = findSoundSpot({ player, dim: player.dimension, rng: this.rng, near: 36, far: 56 });
    playFor(player, "tailwail.scream_far", { x: spot.x, y: spot.y + 3, z: spot.z }, 1.0, this.rng.range(0.92, 1.05), "A scream, far away");
    this.later(30, () => player.isValid && fx.shake(player, 0.08, 1.2));
    return true;
  }

  /** Something huge gallops across the dark in front of you, then is gone. */
  ev_runner(player) {
    const path = findCrossPath({ rng: this.rng, dim: player.dimension, player });
    if (!path) return false;
    const e = spawnEcho(player.dimension, path.a, yawTo(path.a, path.b), "gallop", 6, null);
    if (!e) return false;
    const total = hdist(path.a, path.b);
    const steps = Math.max(8, Math.round(total / 0.39)); // ~7.8 blocks per second: its chase speed
    let i = 0;
    const id = system.runInterval(() => {
      if (!e.isValid || i >= steps || !player.isValid) {
        system.clearRun(id);
        removeEcho(e);
        return;
      }
      i += 1;
      const p = lerp(path.a, path.b, i / steps);
      try {
        e.teleport(p, { facingLocation: { x: path.b.x, y: p.y + 1.5, z: path.b.z } });
      } catch {
        i = steps;
      }
      if (i % 3 === 0) playFor(player, "tailwail.step_heavy", p, 0.9, this.rng.range(0.8, 0.95));
    }, 1);
    return true;
  }

  /** Something hammers on a door near you. */
  ev_door_bang(player) {
    const doors = this.findDoors(player, PRESENCE.doorRange);
    if (!doors.length) return false;
    doors.sort((a, b) => dist(a, player.location) - dist(b, player.location));
    const d = doors[0];
    const at = { x: d.x + 0.5, y: d.y + 1, z: d.z + 0.5 };
    const hits = this.rng.int(3, 6);
    let t = 0;
    for (let i = 0; i < hits; i++) {
      t += this.rng.range(8, 13);
      this.later(t, () => {
        if (!player.isValid) return;
        playFor(player, "tailwail.door_bang", at, 1.0, this.rng.range(0.85, 1.0), "Something hammers on the door");
        playFor(player, "mob.zombie.wood", at, 0.8, 0.7);
        fx.shake(player, dist(at, player.location) < 6 ? 0.2 : 0.08, 0.2);
      });
    }
    return true;
  }

  /** A face at the window: gone the moment you look away again. */
  ev_window(player, env) {
    const list = env._windows || this.findWindows(player, 10);
    for (const g of list) {
      const eye = player.getHeadLocation();
      const dir = norm({ x: g.x - eye.x, y: 0, z: g.z - eye.z });
      const outside = { x: g.x + dir.x * 1.7, y: g.y, z: g.z + dir.z * 1.7 };
      const ground = safeBlock(player.dimension, { x: Math.floor(outside.x), y: Math.floor(outside.y) - 2, z: Math.floor(outside.z) });
      let y = Math.floor(outside.y) - 1;
      if (ground && isOpen(ground)) y -= 1;
      const pos = { x: Math.floor(outside.x) + 0.5, y, z: Math.floor(outside.z) + 0.5 };
      if (headroom(player.dimension, pos) < 3) continue;
      const watch = this.watcher(player, 2.5);
      let stung = false;
      const e = spawnEcho(player.dimension, pos, yawTo(pos, player.location), this.rng.pick(["neck", "watch"]), 12, (ent) => {
        if (!stung && player.isValid && viewCos(player, { x: ent.location.x, y: ent.location.y + 2.6, z: ent.location.z }) > 0.85) {
          stung = true;
          playFor(player, "tailwail.stinger", player.getHeadLocation(), 1.0, 1.0);
          fx.shake(player, 0.3, 0.3, true);
        }
        return watch(ent);
      });
      if (e) return true;
    }
    return false;
  }

  /** The bed visit: while you sleep, it stands at the foot of your bed and watches. */
  bedVisit(player) {
    const yaw = player.getRotation().y;
    const dim = player.dimension;
    for (const k of [2.2, 2.8, 1.8]) {
      for (const off of [0, 30, -30, 60, -60]) {
        const d = dirFromYaw(yaw + off);
        const p = { x: player.location.x + d.x * k, y: player.location.y, z: player.location.z + d.z * k };
        const ground = safeBlock(dim, { x: Math.floor(p.x), y: Math.floor(p.y) - 1, z: Math.floor(p.z) });
        if (!ground || isOpen(ground) || headroom(dim, p) < 3) continue;
        const e = spawnEcho(dim, { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y), z: Math.floor(p.z) + 0.5 }, yawTo(p, player.location), "neck", 9,
          () => !player.isValid || !player.isSleeping);
        if (e) {
          playFor(player, "tailwail.breath_behind", { x: p.x, y: p.y + 2.5, z: p.z }, 0.9, 0.85);
          return true;
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ follow-ups (every few ticks)
  tick(getPlayer) {
    const now = system.currentTick;
    for (const [id, fs] of this.steps) {
      const p = getPlayer(id);
      if (!p || now > fs.until) {
        this.steps.delete(id);
        continue;
      }
      const l = p.location;
      const moved = hdist(l, fs.last);
      fs.last = { ...l };
      if (moved > 0.05) {
        fs.acc += moved;
        fs.movedAt = now;
        fs.extra = false;
      }
      while (fs.acc >= 1.5) {
        fs.acc -= 1.5;
        this.later(6, () => this.stepBehind(p, fs.behind));
      }
      // it takes one more step than you do
      if (!fs.extra && now - fs.movedAt >= 12) {
        fs.extra = true;
        this.later(8, () => this.stepBehind(p, fs.behind * 0.85));
      }
    }
    for (const [id, bh] of this.behind) {
      const p = getPlayer(id);
      if (!p || now > bh.until) {
        this.behind.delete(id);
        continue;
      }
      const turned = Math.abs(((viewYaw(p) - bh.yaw0 + 540) % 360) - 180);
      if (turned >= 110) {
        this.behind.delete(id);
        const e = spawnEcho(p.dimension, bh.pos, yawTo(bh.pos, p.location), "behind", 0.8);
        if (e) {
          playFor(p, "tailwail.stinger", p.getHeadLocation(), 1.0, 1.0);
          fx.shake(p, 0.5, 0.4, true);
          this.later(14, () => removeEcho(e));
        }
      }
    }
    for (const [id, until] of this.mimic) if (now > until || !getPlayer(id)) this.mimic.delete(id);
  }

  stepBehind(player, d) {
    if (!player.isValid) return;
    const p = behindPoint(player, d, false);
    const under = safeBlock(player.dimension, { x: Math.floor(p.x), y: Math.floor(player.location.y) - 1, z: Math.floor(p.z) });
    const s = mimicSoundFor("step", under ? under.typeId : "minecraft:stone");
    playFor(player, s.sound, { x: p.x, y: player.location.y, z: p.z }, 0.9, this.rng.range(0.68, 0.78));
  }

  /** A player did something audible.  If a mimic is armed, it is repeated from the dark. */
  onAction(player, action, blockId) {
    const until = this.mimic.get(player.id);
    if (until === undefined || system.currentTick > until) return false;
    const s = mimicSoundFor(action, blockId || "");
    if (!s) return false;
    this.mimic.delete(player.id);
    const spot = findSoundSpot({ player, dim: player.dimension, rng: this.rng, near: 10, far: 18 });
    const delay = this.rng.range(PRESENCE.mimicDelay[0], PRESENCE.mimicDelay[1]) * 20;
    this.later(delay, () => player.isValid && playFor(player, s.sound, { x: spot.x, y: spot.y + 1, z: spot.z }, 0.95, s.pitch, "Your own sound, from the dark"));
    return true;
  }

  forget(id) {
    this.steps.delete(id);
    this.mimic.delete(id);
    this.behind.delete(id);
  }

  describe(id) {
    const out = [];
    if (this.steps.has(id)) out.push("footsteps");
    if (this.mimic.has(id)) out.push("mimic-armed");
    if (this.behind.has(id)) out.push("behind-armed");
    return out.join(",") || "-";
  }
}

export { lightAt };
