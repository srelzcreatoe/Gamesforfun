// @ts-check
// The world goes quiet. From stage 4, before one of its dangerous encounters (the chase, the sealed
// tunnel, Closer Each Time), the music stops for that player alone and a faint ringing slowly rises
// in its place, for 20-30 seconds. Then it comes — or, about one time in four, nothing does, so the
// silence alone never tells you for certain. The silence lasts until the encounter is over.
// Music is per player (Player.playMusic / stopMusic), so nobody else on a server is affected.
// And whenever it is around (1.1.0) — one of its encounters running for you, or its body within 64 blocks —
// your music is cut completely and (1.1.2) its own theme plays in its place, looping: "lurking" in the Weeping Mire,
// its home, the other one everywhere else. Once it has been gone a few seconds, the game's music fades back in.
// 1.5.0: from the fourth stage its music is no longer the user's two themes but its own broken ones (original, made for
// it: detuned, slowed, reversed, bit-crushed): "stalk" everywhere, "mire" in its home, "end" at the fifth stage — and
// "chase" whenever it, or its pack, is coming for you, at any stage.
import * as channel from "../link/shared.js";
import { ps } from "../core/state.js";
import { S } from "../core/settings.js";
import { safe, rand, emit, trace, DEBUG, allPlayers } from "../core/util.js";
import { SOUNDS } from "../core/constants.js";
import { effectiveStage } from "../director/context.js";

/** @typedef {import("@minecraft/server").Player} Player */

/** Encounters that are announced by the silence. */
export const DANGEROUS = new Set(["pursuit", "closed_path", "creeping"]);
export const FALSE_ALARM = 0.25;

/**
 * @typedef {Object} Hush
 * @property {number} until      clock when the wait is over
 * @property {string} def        encounter it announces ("" for a false alarm / test)
 * @property {boolean} falseAlarm
 * @property {string} dimId
 * @property {boolean} [test]   Config Wheel / dev test: changes nothing about the player's pacing
 */

/** @type {Map<string, Hush>} player id -> pending silence */
const pending = new Map();
/** @type {Set<string>} players whose music is currently replaced by the silence (or its theme) */
const silenced = new Set();
/** @type {Map<string, string>} player id -> its theme playing for them */
const themed = new Map();

/** Should this encounter be announced by the silence for this player? @param {{id:string}} def @param {any} s @param {{mire?:boolean}} [c] */
export function wanted(def, s, c) {
  return S().quiet !== false && DANGEROUS.has(def.id) && effectiveStage(s, c) >= 4;
}

/** @param {string} pid */
export const get = (pid) => pending.get(pid);
/** A real silence (not a false alarm) waiting on the one Observer, for a player other than pid. @param {string} pid */
export const reservedFor = (pid) => [...pending.entries()].some(([id, h]) => id !== pid && !h.falseAlarm && h.def);
export const isSilenced = (pid) => silenced.has(pid);

/** @param {Player} p @returns {boolean} the music call was accepted */
function silence(p) {
  if (silenced.has(p.id)) return true;
  silenced.add(p.id);
  channel.observerTake(p);
  return !!safe(() => {
    p.playMusic(SOUNDS.silence, { loop: true, volume: 1, fade: 2 });
    return true;
  }, false);
}

/** Its theme in place of their music, looping (switching themes crossfades). @param {Player} p @param {string} track */
function theme(p, track) {
  silenced.add(p.id);
  channel.observerTake(p);
  themed.set(p.id, track);
  return !!safe(() => {
    p.playMusic(track, { loop: true, volume: 1, fade: 2.5 });
    return true;
  }, false);
}

/**
 * Begin the silence for a player.
 * @param {Player} p @param {string} defId @param {{seconds?:number, falseAlarm?:boolean, test?:boolean}} [o]
 * @param {number} t clock
 */
export function begin(p, defId, t, o = {}) {
  const falseAlarm = o.falseAlarm ?? (DEBUG.hush === "real" ? false : DEBUG.hush === "false" ? true : Math.random() < FALSE_ALARM);
  const secs = o.seconds ?? rand(20, 30);
  pending.set(p.id, { until: t + secs, def: falseAlarm ? "" : defId, falseAlarm, dimId: p.dimension.id, test: !!o.test });
  const music = silence(p);
  trace(`${p.name}: the world goes quiet (${falseAlarm ? "false alarm" : defId}, ${secs.toFixed(0)} s)`);
  emit("hush", { what: "start", player: p.name, def: defId, falseAlarm, seconds: secs, music });
  if (!o.test) ps(p).hushAt = t;
}

/** The wait is over: what it announced may now start (the caller decides). @param {string} pid */
export function release(pid) {
  pending.delete(pid);
}

/** The game's own music for where the player is, faded back in. */
const MUSIC = { "minecraft:overworld": "music.game", "minecraft:nether": "music.game.nether", "minecraft:the_end": "music.game.end" };

/** End the silence and give the player their music back, fading in. @param {Player|undefined} p @param {string} pid @param {string} why */
export function end(p, pid, why) {
  pending.delete(pid);
  around.delete(pid);
  themed.delete(pid);
  if (!silenced.has(pid)) return;
  silenced.delete(pid);
  const music = p && p.isValid ? !!safe(() => {
    // (1.6.0) a dweller's music that was waiting plays again; else the game's own
    if (channel.observerRelease(p)) return true;
    const track = MUSIC[p.dimension.id];
    if (track) p.playMusic(track, { fade: 4, loop: false, volume: 1 });
    else p.stopMusic();
    return true;
  }, false) : false;
  emit("hush", { what: "end", player: p?.name ?? pid, why, music });
}

/** @type {Map<string, number>} player id -> clock when it was last around them */
const around = new Map();
/** Players it is coming for right now (its chase, its pack's hunt), and what is coming: the chase music. @type {Map<string, Set<string>>} */
const chasing = new Map();
/** It (or its pack) is coming for this player now / no longer. @param {string} pid @param {boolean} on @param {string} [src] */
export function chase(pid, on, src = "it") {
  const set = chasing.get(pid) ?? new Set();
  if (on) set.add(src);
  else set.delete(src);
  if (set.size) chasing.set(pid, set);
  else chasing.delete(pid);
}
/** Which of its music for this player now. @param {Player} p @param {boolean} mire */
function trackFor(p, mire) {
  if (chasing.has(p.id)) return SOUNDS.musicChase;
  const st = ps(p).stage;
  if (st >= 5) return SOUNDS.musicEnd;
  if (st >= 4) return mire ? SOUNDS.musicMire : SOUNDS.musicStalk;
  return mire ? SOUNDS.themeMire : SOUNDS.themeAround;
}
const THEME_NAME = { [SOUNDS.themeMire]: "lurking", [SOUNDS.themeAround]: "around", [SOUNDS.musicChase]: "chase", [SOUNDS.musicEnd]: "end",
  [SOUNDS.musicMire]: "mire", [SOUNDS.musicStalk]: "stalk" };

/**
 * Every second: while it is around a player their music is replaced by its theme (once it arrives, even a silence
 * before an attack gives way to it); when it has been gone 3 s, the game's music fades back.
 * @param {number} t clock @param {(p:Player)=>boolean} isAround @param {(p:Player)=>boolean} inMire
 */
export function presence(t, isAround, inMire) {
  const on = S().quiet !== false && S().enabled;
  for (const p of allPlayers()) {
    if (on && (isAround(p) || chasing.has(p.id))) {
      const track = trackFor(p, inMire(p));
      if (themed.get(p.id) !== track) emit("hush", { what: "presence", player: p.name, theme: THEME_NAME[track] ?? track, music: theme(p, track) });
      around.set(p.id, t);
      continue;
    }
    const last = around.get(p.id);
    if (last === undefined || (on && t - last < 3)) continue;
    around.delete(p.id);
    if (!pending.has(p.id)) end(p, p.id, "gone");
  }
}
/** Is the music cut for this player because it is around? @param {string} pid */
export const isAroundFor = (pid) => around.has(pid);

/** Player left the world. @param {string} pid */
export function forget(pid) {
  pending.delete(pid);
  silenced.delete(pid);
  around.delete(pid);
  themed.delete(pid);
  chasing.delete(pid);
}
