// @ts-check
import { world } from '@minecraft/server';
import { now, sec, valid, compassName, rand, clamp } from './core/util.js';
import { config, prefs } from './core/config.js';

/** World-positioned sound everyone nearby hears (3D, from a real location). */
export function playAt(dim, id, pos, volume = 1, pitch = 1) {
  try { dim.playSound(id, pos, { volume, pitch }); } catch { /* unloaded */ }
}

/** A sound only one player hears, still positioned in 3D. */
export function playFor(player, id, pos, volume = 1, pitch = 1) {
  try {
    const pr = prefs(player);
    const v = pr.reducedAudio ? volume * 0.55 : volume;
    player.playSound(id, pos ? { location: pos, volume: v, pitch } : { volume: v, pitch });
  } catch { /* ignore */ }
}

/** optional threat captions (accessibility) */
export function caption(player, text, from) {
  try {
    if (!prefs(player).captions && config().preset !== 'accessibility') return;
    const dir = from ? ` §7(${compassName(player.location, from)})` : '';
    player.onScreenDisplay.setActionBar(`§8[§7${text}${dir}§8]`);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ heartbeat & music per player
/** @type {Map<string, {danger:number,nextBeat:number,music:string|null,musicUntil:number,drone:number}>} */
const state = new Map();
function ps(player) {
  let s = state.get(player.id);
  if (!s) { s = { danger: 0, nextBeat: 0, music: null, musicUntil: 0, drone: 0 }; state.set(player.id, s); }
  return s;
}

/** set the perceived danger (0..1) for a player; heartbeat follows it smoothly */
export function setDanger(player, d) { const s = ps(player); s.danger = clamp(Math.max(d, s.danger * 0.92), 0, 1); }

export function tickHeart(player) {
  const s = ps(player);
  s.danger *= 0.985;
  const pr = prefs(player);
  if (!pr.heartbeat || s.danger < 0.28) return;
  const t = now();
  if (t < s.nextBeat) return;
  const bpm = 64 + s.danger * 86;
  s.nextBeat = t + Math.round(1200 / bpm);
  playFor(player, 'shaftbreaker.heartbeat', undefined, 0.25 + s.danger * (pr.reducedAudio ? 0.25 : 0.55), 0.95 + s.danger * 0.1);
}

export function startMusic(player, track) {
  const cfg = config();
  const pr = prefs(player);
  if (track === 'music.shaftbreaker.chase' && (!cfg.chaseMusic || pr.reducedChase)) return;
  const s = ps(player);
  if (s.music === track) return;
  try { player.playMusic(track, { fade: 1.0, loop: true, volume: pr.reducedAudio ? 0.45 : 0.8 }); s.music = track; } catch { /* ignore */ }
}

export function stopMusic(player) {
  const s = ps(player);
  if (!s.music) return;
  try { player.stopMusic(); } catch { /* ignore */ }
  s.music = null;
}

export function stopAllFor(player) {
  stopMusic(player);
  try { player.runCommand('stopsound @s shaftbreaker.breath'); } catch { /* ignore */ }
  const s = ps(player); s.danger = 0;
}

export function stopAllMusic() { for (const p of world.getAllPlayers()) stopAllFor(p); }

export function forgetAudio(id) { state.delete(id); }

/** low cave room tone layer (L56/L65): occasional, never constant */
export function maybeRoomTone(player, intensity) {
  const s = ps(player);
  const t = now();
  if (t < s.drone) return;
  s.drone = t + sec(rand(70, 140) / Math.max(0.5, intensity));
  playFor(player, 'shaftbreaker.room_tone', undefined, 0.25 + 0.2 * intensity, rand(0.9, 1.05));
}

export { valid };
