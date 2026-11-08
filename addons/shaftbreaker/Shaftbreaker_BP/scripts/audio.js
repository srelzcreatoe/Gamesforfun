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

/** call every 5 ticks: a real rhythm, and danger fades within ~10 s once nothing is happening */
export function tickHeart(player) {
  const s = ps(player);
  s.danger *= 0.965;
  const pr = prefs(player);
  if (!pr.heartbeat || s.danger < 0.32) return;
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
  const vol = track === 'music.shaftbreaker.presence' ? 0.7 : 0.85;
  try { player.playMusic(track, { fade: 2.0, loop: true, volume: pr.reducedAudio ? vol * 0.55 : vol }); s.music = track; } catch { /* ignore */ }
}

export function currentMusic(player) { return ps(player).music; }

export function stopMusic(player) {
  const s = ps(player);
  if (!s.music) return;
  try { player.stopMusic(); } catch { /* ignore */ }
  s.music = null;
}

export function stopAllFor(player) {
  const m = ps(player).music;
  if (m === 'music.shaftbreaker.chase' || m === 'music.shaftbreaker.standoff') stopMusic(player);   // the presence bed carries on
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
