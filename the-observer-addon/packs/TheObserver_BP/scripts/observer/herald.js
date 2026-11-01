// @ts-check
// Its herald (1.3.0). From the third stage, before one of its heavier encounters (two times in five), it sends one of
// the creatures that answer to it ahead: a zombie, a spider, another add-on's creature walks out — in its twitches,
// its eyes in it — to stand about sixteen blocks from you and stare. Some twelve seconds later the encounter comes, and
// the herald is let go. The director waits for it as it waits for a silence (director.js).
import * as puppets from "./puppets.js";
import { standing, isHeld } from "./dominion.js";
import { S } from "../core/settings.js";
import { V, safe, emit, DEBUG } from "../core/util.js";
import { standNear } from "../world/space.js";

/** @typedef {import("@minecraft/server").Player} Player */

/** player id -> the encounter it heralds, when it comes, and the herald @type {Map<string, {def:string, at:number, id:string}>} */
const pending = new Map();
const SECONDS = 12;

/** Should this encounter be heralded? @param {{tier:number}} def @param {any} s */
export function wanted(def, s) {
  if (!S().enabled || S().puppets === false || S().creatures === false || def.tier < 2 || s.stage < 3) return false;
  return DEBUG.herald === "always" || (DEBUG.herald !== "never" && Math.random() < 0.4);
}

/**
 * Send a herald ahead of an encounter. @param {Player} p @param {string} defId @param {number} t clock
 * @returns {boolean} one went (the director then waits)
 */
export function begin(p, defId, t) {
  const near = (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 40, families: ["monster"] }), []) ?? [])
    .filter((e) => standing(e) === "kin" && !isHeld(e.id) && !puppets.isPuppet(e) && V.dist(e.location, p.location) >= 10)
    .sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location));
  const e = near[0];
  if (!e) return false;
  const dir = V.flat(V.sub(e.location, p.location));
  const want = V.add(p.location, V.scale(dir, 16));
  const st = standNear(p.dimension, want.x, want.z, p.location.y);
  const pp = puppets.take(e, "herald", { p, mode: "walk", seconds: SECONDS + 20 });
  if (!pp) return false;
  if (st && Math.abs(st.loc.y - p.location.y) < 4) puppets.setMode(pp, "walk", { to: st.loc, after: "stand" });
  else puppets.setMode(pp, "stand");
  pending.set(p.id, { def: defId, at: t + SECONDS, id: pp.id });
  emit("herald", { what: "sent", player: p.name, def: defId, type: e.typeId, id: e.id });
  return true;
}

/** @param {string} pid */
export const get = (pid) => pending.get(pid);

/** Heralds whose encounter is due. @param {number} t @returns {[string, {def:string, at:number, id:string}][]} */
export const due = (t) => [...pending.entries()].filter(([, h]) => t >= h.at);

/** The encounter came (or could not): the herald is let go. @param {string} pid @param {string} why */
export function end(pid, why) {
  const h = pending.get(pid);
  pending.delete(pid);
  if (!h) return;
  puppets.release(h.id, "quiet");
  emit("herald", { what: "end", why, def: h.def });
}

/** A player left. @param {string} pid */
export const forget = (pid) => end(pid, "left");

