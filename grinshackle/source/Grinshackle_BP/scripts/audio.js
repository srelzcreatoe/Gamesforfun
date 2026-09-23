// All Grinshackle audio. Every sound is played per listener through Player.playSound so each player's own volume preference applies,
// and it is scoped to players near the source. Music uses Player.playMusic / stopMusic on the target player only.
import { world } from '@minecraft/server';
import { SOUNDS } from './constants.js';
import { S } from './state.js';
import { safe, isValid, dist, clamp } from './util.js';
import { prefs } from './config.js';

const DEFAULT_RADIUS = 24;
let masterMuted = false;

export function mute(flag) { masterMuted = !!flag; if (flag) stopAll(); }
export function isMuted() { return masterMuted; }
function cfg(k, d) { return S.config && k in S.config ? S.config[k] : d; }

/** Play a one-shot effect at `pos` for every player within `radius`. */
export function fx(id, pos, opts = {}) {
  if (masterMuted || !pos) return;
  const base = clamp((opts.volume ?? 1) * cfg('effectsVolume', 1) * (cfg('quietPreset', false) ? 0.55 : 1), 0, 1);
  if (base <= 0) return;
  const radius = opts.radius ?? DEFAULT_RADIUS;
  const dimId = opts.dimensionId;
  for (const p of safe(() => world.getAllPlayers(), [])) {
    if (!isValid(p)) continue;
    if (dimId && safe(() => p.dimension.id, '') !== dimId) continue;
    const d = dist(safe(() => p.location, pos), pos);
    if (d > radius) continue;
    const pr = prefs(p);
    if (pr.muted) continue;
    const vol = clamp(base * pr.effectsVolume, 0, 1);
    if (vol <= 0.01) continue;
    safe(() => p.playSound(id, { location: pos, volume: vol, pitch: opts.pitch ?? 1 }));
  }
}
export function fxAt(id, entity, opts = {}) {
  if (!isValid(entity)) return;
  fx(id, safe(() => entity.location, undefined), { ...opts, dimensionId: safe(() => entity.dimension.id, undefined) });
}

/** Chain drag "loop": 1-second segments while the creature moves and its chains are not gathered. */
export function chainDrag(entity, moving, gathered) {
  if (!isValid(entity) || gathered || !moving) return;
  const next = S.loops.get('drag') || 0;
  if (S.tick < next) return;
  S.loops.set('drag', S.tick + 20);
  fxAt(SOUNDS.chain_drag, entity, { volume: 0.55, radius: 14, pitch: 0.95 + Math.random() * 0.1 });
}
export function wristClick(entity) { fxAt(SOUNDS.wrist_click, entity, { volume: 0.35, radius: 10 }); }
export function breath(entity) {
  const next = S.loops.get('breath') || 0; if (S.tick < next) return;
  S.loops.set('breath', S.tick + 60 + Math.floor(Math.random() * 60));
  fxAt(SOUNDS.breath, entity, { volume: 0.3, radius: 9 });
}

/** Music for one player: 'stalk' | 'hunt' | null. */
export function music(player, track) {
  if (!isValid(player)) return;
  const cur = S.music.get(player.id);
  if (masterMuted) track = null;
  if (cur === track) return;
  const pr = prefs(player);
  const vol = clamp(cfg('musicVolume', 0.6) * pr.musicVolume * (cfg('quietPreset', false) ? 0.6 : 1), 0, 1);
  if (track && vol > 0.01 && !pr.muted) {
    const id = track === 'hunt' ? SOUNDS.music_hunt : SOUNDS.music_stalk;
    safe(() => player.playMusic(id, { volume: vol, fade: 1.5, loop: true }));
    S.music.set(player.id, track);
  } else if (cur) {
    safe(() => player.stopMusic());
    S.music.delete(player.id);
  }
}

/** Stop every Grinshackle sound for everyone. Idempotent. */
export function stopAll() {
  for (const p of safe(() => world.getAllPlayers(), [])) {
    if (!isValid(p)) continue;
    if (S.music.has(p.id)) safe(() => p.stopMusic());
    safe(() => p.runCommand('stopsound @s gs.chain_drag'));
    safe(() => p.runCommand('stopsound @s gs.music.stalk'));
    safe(() => p.runCommand('stopsound @s gs.music.hunt'));
  }
  S.music.clear(); S.loops.clear();
}
export function stopFor(player) {
  if (!isValid(player)) return;
  if (S.music.has(player.id)) { safe(() => player.stopMusic()); S.music.delete(player.id); }
}

/** Visual equivalent of an audio warning (actionbar), only when the player wants subtitles. */
export function subtitle(player, text) {
  if (!isValid(player) || !cfg('subtitles', true)) return;
  if (!prefs(player).subtitles) return;
  safe(() => player.onScreenDisplay.setActionBar('§7' + text));
}
