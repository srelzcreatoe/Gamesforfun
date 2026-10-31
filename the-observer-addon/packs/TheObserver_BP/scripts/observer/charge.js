// @ts-check
// Running at it (1.1.0). When it is watching and a player runs straight at it, it does not wait to be reached:
// it decides. It attacks when the moment is its own — dark, the player hurt or alone, nothing in their hands
// that has driven it off before, its temper already up — and the more often this player has charged it, the
// more it stands its ground. Otherwise it is gone before they get there, and it waits for a better moment: the
// next time things favour it (night or darkness, a cave, the player badly hurt), it comes back at once, and it
// comes with something worse (an ambush: its heavier encounters, weighted up).
import { ps, now, markPlayerDirty } from "../core/state.js";
import { aggression } from "../core/settings.js";
import { V, safe, emit, DEBUG, allPlayers } from "../core/util.js";
import { ITEMS } from "../core/constants.js";
import { context, effectiveStage } from "../director/context.js";
import { habit } from "./profile.js";

/** @typedef {import("@minecraft/server").Player} Player */

/** Held, these have hurt it before: it thinks twice. */
const WARDING = new Set([ITEMS.lens, ITEMS.flare]);

/**
 * Attack, or not? @param {{data:Record<string, any>}} enc @param {Player} p
 * @returns {{attack:boolean, score:number, why:string[]}}
 */
export function decide(enc, p) {
  if (DEBUG.charge === "attack") return { attack: true, score: 1, why: ["forced"] };
  if (DEBUG.charge === "vanish") return { attack: false, score: 0, why: ["forced"] };
  const s = ps(p);
  const c = context(p);
  if (aggression() === 0 || s.witnessed || effectiveStage(s, c) < 2) return { attack: false, score: 0, why: ["not yet"] };
  const why = [];
  let score = 0.3;
  if (c.night || c.light <= 7) {
    score += 0.2;
    why.push("dark");
  } else if (c.light >= 12) {
    score -= 0.2;
    why.push("bright");
  }
  if (c.hp < 0.6) {
    score += 0.15;
    why.push("hurt");
  }
  const company = allPlayers().some((o) => o.id !== p.id && o.dimension.id === p.dimension.id && V.dist(o.location, p.location) < 32);
  score += company ? -0.15 : 0.1;
  why.push(company ? "not alone" : "alone");
  const held = safe(() => p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex)?.typeId, undefined);
  if (held && WARDING.has(held)) {
    score -= 0.35;
    why.push("armed");
  }
  const learned = habit(s, "charge");
  if (learned > 0.2) why.push("learned");
  score += 0.35 * learned;
  score += Math.min(0.25, (enc.data.anger ?? 0) / 400);
  score = Math.max(0.05, Math.min(0.92, score));
  return { attack: Math.random() < score, score: Math.round(score * 100) / 100, why };
}

/** It is gone, and waits for its moment with this player. @param {Player} p */
export function setAmbush(p) {
  const s = ps(p);
  s.ambush = { at: Math.floor(now()), until: Math.floor(now()) + 1800 };
  markPlayerDirty(p);
  emit("ambush", { what: "set", player: p.name });
}

/** Does the moment favour it? @param {any} c context */
export const favours = (c) => c.night || c.light <= 7 || c.underground || c.hp < 0.5;
