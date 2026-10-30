// Player-facing effects with guaranteed cleanup: camera shake / FOV / fade, fog, music,
// heartbeat, input locks, titles.  Every effect is tracked per player so that
// clearAll(player) can restore everything; it runs on encounter end, death, leave,
// join and world load (a crash mid-chase can never leave a player locked or fogged).
//
// Respect for the player's own preferences (store.js prefs):
//   camera 0: no shake / FOV / fades   1: gentle shake only   2: everything
//   music false: no music tracks       fog false: no fog
import { CameraShakeType, EasingType, InputPermissionCategory, system } from "@minecraft/server";
import { dlog } from "./log.js";
import { getPrefs } from "./store.js";

const FOG_TAG = "tailwail";
// Held in its hands: no walking, no turning.  Jump and Sneak stay live: they are the struggle.
const LOCKS = [InputPermissionCategory.LateralMovement, InputPermissionCategory.Camera];
// restore also covers Sneak, which older versions locked
const RESTORE = [...LOCKS, InputPermissionCategory.Sneak];

/** @type {Map<string, {fog:Set<string>, music:string|null, fov:boolean, locked:boolean, beat:{rate:number, next:number, vol:number}|null, title:boolean}>} */
const live = new Map();

function st(player) {
  let s = live.get(player.id);
  if (!s) live.set(player.id, (s = { fog: new Set(), music: null, fov: false, locked: false, beat: null, title: false }));
  return s;
}

function safe(label, fn) {
  try {
    return fn();
  } catch (e) {
    dlog(`fx ${label}:`, e);
    return undefined;
  }
}

export function shake(player, intensity, seconds, rotational = false) {
  const cam = getPrefs(player).camera;
  if (cam <= 0) return;
  const k = cam === 1 ? 0.35 : 1;
  safe("shake", () => player.camera.addShake({
    intensity: Math.max(0.01, Math.min(1, intensity * k)),
    duration: Math.max(0.05, seconds),
    type: rotational && cam === 2 ? CameraShakeType.Rotational : CameraShakeType.Positional,
  }));
}

export function fov(player, value, easeTime = 0.6, easeType = EasingType.InOutSine) {
  if (getPrefs(player).camera < 2) return;
  const ok = safe("fov", () => {
    player.camera.setFov({ fov: value, easeOptions: { easeTime, easeType } });
    return true;
  });
  if (ok) st(player).fov = true;
}

export function resetFov(player, easeTime = 0.8) {
  const s = live.get(player.id);
  if (!s || !s.fov) return;
  s.fov = false;
  clearFov(player, easeTime);
}

/** Unconditional FOV clear (used by clearAll on join, where nothing is tracked yet). */
export function clearFov(player, easeTime = 0.5) {
  safe("fov clear", () => player.runCommand(`camera @s fov_clear ${easeTime.toFixed(2)} in_out_sine`));
}

export function fade(player, inS, holdS, outS, color = { red: 0, green: 0, blue: 0 }) {
  if (getPrefs(player).camera <= 0) return;
  safe("fade", () => player.camera.fade({ fadeTime: { fadeInTime: inS, holdTime: holdS, fadeOutTime: outS }, fadeColor: color }));
}

export function pushFog(player, fogId) {
  if (!getPrefs(player).fog) return;
  const s = st(player);
  if (s.fog.has(fogId)) return;
  const ok = safe("fog push", () => {
    player.fogSettings.push(fogId, FOG_TAG);
    return true;
  });
  if (ok) s.fog.add(fogId);
}

export function clearFog(player) {
  const s = live.get(player.id);
  if (s) s.fog.clear();
  safe("fog clear", () => player.fogSettings.remove(FOG_TAG));
}

export function music(player, track, volume = 0.9, fadeS = 1.5, loop = true) {
  if (!getPrefs(player).music) return;
  const s = st(player);
  if (s.music === track) return;
  const ok = safe("music", () => {
    player.playMusic(track, { fade: fadeS, loop, volume: volume * getPrefs(player).volume });
    return true;
  });
  if (ok) s.music = track;
}

export function stopMusic(player) {
  const s = live.get(player.id);
  if (s) s.music = null;
  safe("stop music", () => player.stopMusic());
}

/** Heartbeat: rate in beats per minute (0 stops it), volume 0..1. Driven by tickHeartbeats(). */
export function heartbeat(player, bpm, volume = 0.7) {
  const s = st(player);
  if (bpm <= 0) {
    s.beat = null;
    return;
  }
  if (!s.beat) s.beat = { rate: bpm, next: system.currentTick + 2, vol: volume };
  s.beat.rate = bpm;
  s.beat.vol = volume;
}

export function tickHeartbeats(getPlayer) {
  const now = system.currentTick;
  for (const [id, s] of live) {
    if (!s.beat || now < s.beat.next) continue;
    const p = getPlayer(id);
    if (!p) {
      s.beat = null;
      continue;
    }
    const v = s.beat.vol * getPrefs(p).volume;
    if (v > 0.01) safe("beat", () => p.playSound("tailwail.heartbeat", { volume: v, pitch: 0.95 + Math.min(0.15, (s.beat.rate - 60) / 600) }));
    s.beat.next = now + Math.max(5, Math.round(1200 / s.beat.rate));
  }
}

export function lockInput(player) {
  const s = st(player);
  for (const c of LOCKS) safe("lock", () => player.inputPermissions.setPermissionCategory(c, false));
  s.locked = true;
}

export function unlockInput(player) {
  const s = live.get(player.id);
  if (s) s.locked = false;
  for (const c of RESTORE) safe("unlock", () => player.inputPermissions.setPermissionCategory(c, true));
}

export function title(player, text, subtitle, stay = 1.5, fadeIn = 0, fadeOut = 0.3) {
  st(player).title = true;
  safe("title", () => player.onScreenDisplay.setTitle(text, {
    subtitle, fadeInDuration: Math.round(fadeIn * 20), stayDuration: Math.round(stay * 20), fadeOutDuration: Math.round(fadeOut * 20),
  }));
}

export function subtitle(player, text) {
  safe("subtitle", () => player.onScreenDisplay.updateSubtitle(text));
}

export function actionbar(player, text) {
  safe("actionbar", () => player.onScreenDisplay.setActionBar(text));
}

export function clearTitle(player) {
  const s = live.get(player.id);
  if (s && s.title) {
    s.title = false;
    safe("clear title", () => player.onScreenDisplay.setTitle(" ", { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }));
  }
}

/** Ends the encounter mood for this player (music, fog, FOV, heartbeat) but not locks. */
export function endMood(player) {
  const s = live.get(player.id);
  if (!s) return;
  if (s.music) stopMusic(player);
  if (s.fog.size) clearFog(player);
  resetFov(player);
  s.beat = null;
}

/** Restores EVERYTHING this add-on can change on a player. Safe to call at any time. */
export function clearAll(player, unconditional = false) {
  const s = live.get(player.id);
  if (unconditional || (s && s.music)) stopMusic(player);
  if (unconditional || (s && s.fog.size)) clearFog(player);
  if (unconditional) clearFov(player, 0.3);
  else resetFov(player, 0.5);
  if (unconditional || (s && s.locked)) unlockInput(player);
  safe("stop shake", () => player.camera.stopShaking());
  if (s && s.title) clearTitle(player);
  live.delete(player.id);
}

export function forget(id) {
  live.delete(id);
}

export function isLocked(player) {
  const s = live.get(player.id);
  return !!(s && s.locked);
}
