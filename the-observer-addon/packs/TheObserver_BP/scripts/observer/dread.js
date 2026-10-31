// @ts-check
// Its presence, felt (1.1.0). While it is near — seen or not — a player hears their own heart: a heartbeat only
// they hear, from about 60 beats a minute when it is barely there to 150 when it is on them. It is stronger when
// it is close but out of sight (you feel it before you see it), in a standoff as its temper rises, and highest
// when it is coming for you. When it is close and meaning harm the view trembles on the beat — lightly, and only
// as much as the camera-effects setting allows (none / reduced: half / full). Settings: "Heartbeat" (on).
import { system } from "@minecraft/server";
import * as body from "./body.js";
import * as hush from "./hush.js";
import { S } from "../core/settings.js";
import { V, safe, emit, allPlayers } from "../core/util.js";
import { SOUNDS } from "../core/constants.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{pid:string, data:Record<string, any>, def:{id:string}}} Enc */

const DANGEROUS = new Set(["pursuit", "closed_path", "creeping"]);
/** @type {Map<string, {cur:number, next:number}>} player id -> current dread (0..1) and the tick of the next beat */
const state = new Map();

/** How much of it this player feels right now (0..1). @param {Player} p @param {Enc|undefined} enc */
function target(p, enc) {
  let d = 0;
  const b = body.get();
  if (b && b.e.dimension.id === p.dimension.id) {
    const dist = V.dist(b.e.location, p.location);
    if (dist < 48) {
      const near = 1 - dist / 48;
      // unseen and close is worse than seen
      d = near * (body.watchedBy([p], 60) ? 0.75 : 0.9);
    }
  }
  if (enc && enc.pid === p.id) {
    d = Math.max(d, 0.3);
    if (enc.data.standoff) d = Math.max(d, 0.35 + (enc.data.anger ?? 0) / 160);
    if (enc.data.reacting || DANGEROUS.has(enc.def.id)) d = Math.max(d, 0.85);
  }
  if (hush.get(p.id)) d = Math.max(d, 0.4);
  return Math.min(1, d);
}

/** Every 2 ticks. @param {(pid:string)=>Enc|undefined} encFor */
export function tick(encFor) {
  const on = S().enabled && S().heartbeat !== false;
  const now = system.currentTick;
  for (const p of allPlayers()) {
    let st = state.get(p.id);
    const want = on ? target(p, encFor(p.id)) : 0;
    if (!st) {
      if (want <= 0) continue;
      st = { cur: 0, next: now };
      state.set(p.id, st);
    }
    // it rises quickly and settles slowly
    st.cur += (want - st.cur) * (want > st.cur ? 0.12 : 0.03);
    if (st.cur < 0.05 && want <= 0) {
      state.delete(p.id);
      continue;
    }
    if (st.cur < 0.18 || now < st.next) continue;
    const bpm = 58 + 92 * st.cur;
    st.next = now + Math.round(1200 / bpm);
    safe(() => p.playSound(SOUNDS.heartbeat, { location: p.location, volume: 0.2 + 0.6 * st.cur }));
    let shake = 0;
    const cam = S().camera;
    if (st.cur >= 0.55 && cam >= 1) {
      shake = Math.round((st.cur - 0.5) * 0.1 * (cam === 1 ? 0.5 : 1) * 1000) / 1000;
      safe(() => p.runCommand(`camerashake add @s ${shake} 0.15 positional`));
    }
    emit("heartbeat", { player: p.name, bpm: Math.round(bpm), dread: Math.round(st.cur * 100) / 100, shake });
  }
}

/** @param {string} pid */
export const level = (pid) => state.get(pid)?.cur ?? 0;
/** @param {string} pid */
export const forget = (pid) => state.delete(pid);
