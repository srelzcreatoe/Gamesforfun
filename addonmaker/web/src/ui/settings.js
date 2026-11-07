// App-wide preferences (per device) and the background music player.
import { render } from './store.js';

const KEY = 'mobsmith.settings';
const defaults = { mode: 'simple', music: true, volume: 0.45, track: 0, shuffle: false };
let prefs = { ...defaults };
try { prefs = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* private mode */ }

export const settings = () => prefs;
export function setSetting(k, v) {
  prefs = { ...prefs, [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  if (k === 'volume' && audio) audio.volume = v;
  if (k === 'music') v ? play() : pause();
  render();
}
export const isAdvanced = () => prefs.mode === 'advanced';

export const TRACKS = [
  { file: 'lantern_glow', title: 'Lantern Glow', mood: 'Calm creator theme', icon: '🏮', len: '3:28' },
  { file: 'deepslate_drift', title: 'Deepslate Drift', mood: 'Dark cave ambience', icon: '🕳', len: '2:30' },
  { file: 'cobble_run', title: 'Cobble Run', mood: 'Upbeat chiptune', icon: '🏃', len: '2:24' },
  { file: 'moonlit_hollow', title: 'Moonlit Hollow', mood: 'Eerie music-box waltz', icon: '🌙', len: '2:36' },
  { file: 'forge_pulse', title: 'Forge Pulse', mood: 'Driving synthwave', icon: '⚒', len: '2:54' },
];

let audio = null;
let started = false;
export const music = { playing: false, track: prefs.track || 0 };

function ensure() {
  if (audio || typeof Audio === 'undefined') return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.volume = prefs.volume;
  audio.addEventListener('ended', () => next());
  audio.addEventListener('play', () => { music.playing = true; render(); });
  audio.addEventListener('pause', () => { music.playing = false; render(); });
  return audio;
}
function load(i) {
  const a = ensure();
  if (!a) return;
  music.track = (i + TRACKS.length) % TRACKS.length;
  a.src = `music/${TRACKS[music.track].file}.ogg`;
  prefs.track = music.track;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}
export function play(i) {
  const a = ensure();
  if (!a) return;
  if (i !== undefined && i !== music.track) load(i);
  else if (!a.src) load(music.track);
  a.play().catch(() => { /* needs a user gesture first */ });
}
export function pause() { audio?.pause(); }
export function toggle() { if (music.playing) pause(); else { if (!prefs.music) setSetting('music', true); play(); } }
export function next() {
  const n = prefs.shuffle ? Math.floor(Math.random() * TRACKS.length) : music.track + 1;
  load(n);
  if (prefs.music) audio.play().catch(() => {});
}
/** Temporarily lowers the music (e.g. while previewing a sound). */
export function duck(on) { if (audio) audio.volume = on ? prefs.volume * 0.15 : prefs.volume; }

export function initMusic() {
  if (typeof window === 'undefined') return;
  const kick = () => {
    if (started) return;
    started = true;
    if (prefs.music) play();
  };
  window.addEventListener('pointerdown', kick, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (music.playing) { audio.pause(); music.resume = true; } }
    else if (music.resume && prefs.music) { music.resume = false; audio?.play().catch(() => {}); }
  });
}
