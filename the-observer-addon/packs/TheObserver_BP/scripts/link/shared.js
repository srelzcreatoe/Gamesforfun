// @ts-check
// What the Observer shares with its dwellers (1.6.0) — the Goatwalker, the Brinesleeper and the Shaftbreaker, merged
// into this pack by tools/merge_dwellers.py, which routes their code through here:
//   * players(name): who a dweller can see — nobody while it is switched off on the Config Wheel, and nobody in the
//     Rift (the Rift is the Observer's alone);
//   * one music channel per player. Four creatures each used to play and stop music on their own and would cut each
//     other off. Now each says what it wants (musicPlay / musicStop); the Observer's own silence and themes come first
//     (observerTake / observerRelease), and when it lets go, whatever a dweller still wants plays again.
import { world } from "@minecraft/server";
import { emit } from "../core/util.js";

export const RIFT = "observer:rift";
/** The dwellers' own settings wheels are not handed out unasked: the Config Wheel opens them. */
export const GIVE_OWN_WHEELS = false;

/** Dwellers switched off on the Config Wheel (kept in step by link/dwellers.js). @type {Set<string>} */
export const off = new Set();

/** @typedef {import("@minecraft/server").Player} Player */

/** Who this dweller can see now. @param {string} name @returns {Player[]} */
export function players(name) {
  if (off.has(name)) return [];
  return world.getAllPlayers().filter((p) => {
    try {
      return p.dimension.id !== RIFT;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------- the music channel

/** What each source wants playing for each player. @type {Map<string, Map<string, {track:string, opts:any, at:number}>>} */
const wants = new Map();
/** Who is playing for each player right now (a dweller's name), if a dweller is. @type {Map<string, string>} */
const playing = new Map();
/** Players whose music the Observer holds (its silence, its themes). @type {Set<string>} */
const held = new Set();
let seq = 0;

/** @param {string} pid */
function wantsOf(pid) {
  let m = wants.get(pid);
  if (!m) wants.set(pid, (m = new Map()));
  return m;
}

/** A dweller wants this track for this player. @param {string} src @param {Player} p @param {string} track @param {any} [opts] */
export function musicPlay(src, p, track, opts) {
  wantsOf(p.id).set(src, { track, opts: opts ?? {}, at: ++seq });
  if (held.has(p.id)) return emit("channel", { what: "waits", src, track, player: p.name });
  playing.set(p.id, src);
  emit("channel", { what: "play", src, track, player: p.name });
  try {
    p.playMusic(track, opts);
  } catch {
    /* gone */
  }
}

/** A dweller no longer wants music for this player. @param {string} src @param {Player} p */
export function musicStop(src, p) {
  wantsOf(p.id).delete(src);
  if (held.has(p.id)) return;
  const cur = playing.get(p.id);
  if (cur && cur !== src) return emit("channel", { what: "kept", src, keep: cur, player: p.name }); // another's track plays on
  playing.delete(p.id);
  if (!resume(p)) {
    try {
      p.stopMusic();
    } catch {
      /* gone */
    }
  }
}

/** The most recent track a dweller still wants, played again. @param {Player} p @returns {boolean} */
function resume(p) {
  /** @type {string|undefined} */
  let src;
  /** @type {{track:string, opts:any, at:number}|undefined} */
  let w;
  for (const [s, x] of wantsOf(p.id)) if (!off.has(s) && (!w || x.at > w.at)) [src, w] = [s, x];
  if (!src || !w) return false;
  playing.set(p.id, src);
  emit("channel", { what: "resume", src, track: w.track, player: p.name });
  try {
    p.playMusic(w.track, { ...w.opts, loop: true });
  } catch {
    return false;
  }
  return true;
}

/** The Observer takes this player's music (its silence or theme). @param {Player} p */
export function observerTake(p) {
  if (!held.has(p.id)) emit("channel", { what: "observer", player: p.name });
  held.add(p.id);
  playing.delete(p.id);
}

/** The Observer lets go: a dweller's track plays again if one still wants to. @param {Player} p @returns {boolean} */
export function observerRelease(p) {
  if (!held.delete(p.id)) return false;
  return resume(p);
}

/** Does the Observer hold this player's music? @param {string} pid */
export const observerHolds = (pid) => held.has(pid);

/** A dweller switched off: its music stops wherever it was playing. @param {string} src */
export function silence(src) {
  for (const p of world.getAllPlayers()) {
    const w = wants.get(p.id);
    if (!w?.has(src)) continue;
    w.delete(src);
    if (playing.get(p.id) === src && !held.has(p.id)) {
      playing.delete(p.id);
      if (!resume(p)) {
        try {
          p.stopMusic();
        } catch {
          /* gone */
        }
      }
    }
  }
}

/** @param {string} pid */
export function forget(pid) {
  wants.delete(pid);
  playing.delete(pid);
  held.delete(pid);
}

/** What a dweller just decided, for the record (tests; 1.7.0). @param {string} name @param {Record<string, any>} data */
export function note(name, data) {
  emit("dweller", { name, ...data });
}
