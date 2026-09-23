// Harmless preview mode: shows the model for two minutes, lets you pick any of the 21 clips, never targets or damages anyone.
// The preview creature occupies the same one-per-world reservation as a real encounter (mode 'preview').
import { world } from '@minecraft/server';
import { IDS, EVENTS, CLIPS, CLIP_NAMES, ANIM_PREFIX } from './constants.js';
import { S } from './state.js';
import { safe, isValid, sub, norm } from './util.js';
import * as timers from './timers.js';
import * as reservation from './reservation.js';
import * as navigation from './navigation.js';
import * as animation from './animation.js';
import * as scan from './world_scan.js';
import { cue } from './text.js';

const LIFETIME = 2400; // 2 minutes
const TAG = 'preview';

function entity() {
  const p = S.preview; if (!p) return undefined;
  const e = safe(() => world.getEntity(p.entityId), undefined);
  return isValid(e) ? e : undefined;
}
function player() {
  const p = S.preview; if (!p) return undefined;
  const pl = safe(() => world.getEntity(p.playerId), undefined);
  return isValid(pl) ? pl : undefined;
}
function normalizeClip(name) {
  if (!name) return undefined;
  let n = String(name).trim().toLowerCase();
  if (n.startsWith(ANIM_PREFIX)) n = n.slice(ANIM_PREFIX.length);
  return CLIP_NAMES.includes(n) ? n : undefined;
}
export function active() { return !!S.preview; }
export function listText() {
  return 'Clips: ' + CLIP_NAMES.join(', ') + '. Use "preview <clip>", "preview next", "preview loop" (cycles all 21), "preview stop". Locomotion clips play in place.';
}

/** Spawn the preview creature ~5 blocks ahead of the player. Returns a message. */
export function start(pl, clip) {
  if (!isValid(pl)) return 'Run this as a player.';
  if (S.preview) return play(clip || 'idle');
  if (S.record || reservation.current()) return 'An encounter is active or reserved; end it first (/function grinshackle/end).';
  const loc = pl.location; const view = safe(() => pl.getViewDirection(), { x: 0, y: 0, z: 1 });
  const flat = norm({ x: view.x, y: 0, z: view.z });
  const ahead = { x: loc.x + flat.x * 5, y: loc.y, z: loc.z + flat.z * 5 };
  let point = scan.walkableNear(pl.dimension, ahead, 3, { height: 3 });
  if (!point) { const q = { x: Math.floor(ahead.x) + 0.5, y: Math.floor(ahead.y), z: Math.floor(ahead.z) + 0.5 }; if (scan.standRoom(pl.dimension, q, 3) && scan.isSolidFloor(pl.dimension, q)) point = q; }
  if (!point) return 'No clear floor with three blocks of headroom found ahead of you.';
  const e = safe(() => pl.dimension.spawnEntity(IDS.ENTITY, point), undefined);
  if (!e) return 'Spawn failed.';
  reservation.reserve(e, 'preview');
  S.preview = { entityId: e.id, playerId: pl.id, until: S.tick + LIFETIME, record: { pose: 'emerge', action: 0, actionUntil: 0, overlay: 0, track: false, motion: 'still', low: false, faceYaw: undefined }, clipIndex: 0, loopMode: false, nextClipAt: 0 };
  safe(() => e.triggerEvent(EVENTS.TARGET_NONE));
  navigation.stop(e);
  navigation.snapFace(pl.location, e);
  cue(pl, 'preview');
  const requested = normalizeClip(clip);
  if (requested) { animation.previewPlay(e, requested); S.preview.clipIndex = CLIP_NAMES.indexOf(requested); }
  else timers.schedule(CLIPS.emerge.ticks, () => { const en = entity(); if (en && S.preview) animation.previewPlay(en, 'idle'); }, TAG);
  return `Preview started (harmless, ${LIFETIME / 20} s). ${listText()}`;
}
/** Play one clip by name, or 'loop' to cycle all 21, or 'list'. */
export function play(clip) {
  const e = entity(); if (!e || !S.preview) return 'No preview running. Use /function grinshackle/preview first.';
  const n = String(clip || '').trim().toLowerCase();
  if (n === 'list' || n === '') return listText();
  if (n === 'loop') { S.preview.loopMode = true; S.preview.clipIndex = -1; return next(); }
  const c = normalizeClip(n); if (!c) return `Unknown clip "${clip}". ${listText()}`;
  S.preview.loopMode = false; S.preview.clipIndex = CLIP_NAMES.indexOf(c);
  timers.cancelTag(TAG);
  const ticks = animation.previewPlay(e, c);
  return `Playing ${c} (${(ticks / 20).toFixed(2)} s${CLIPS[c].loop === true ? ', loops' : ''}).`;
}
export function next() {
  const e = entity(); if (!e || !S.preview) return 'No preview running.';
  S.preview.clipIndex = (S.preview.clipIndex + 1) % CLIP_NAMES.length;
  const c = CLIP_NAMES[S.preview.clipIndex];
  timers.cancelTag(TAG);
  const ticks = animation.previewPlay(e, c);
  S.preview.nextClipAt = S.tick + Math.max(ticks, 60) + 10;
  return `Playing ${c} (${S.preview.clipIndex + 1}/${CLIP_NAMES.length}).`;
}
export function stop() {
  const had = !!S.preview;
  const e = entity();
  timers.cancelTag(TAG);
  if (e) safe(() => e.remove());
  const res = reservation.current();
  if (res && res.mode === 'preview') reservation.release();
  S.preview = undefined;
  return had ? 'Preview ended.' : 'No preview was running.';
}
/** Per tick from main.js. */
export function tick() {
  const p = S.preview; if (!p) return;
  const e = entity();
  if (!e) { stop(); return; }
  if (S.tick >= p.until) { stop(); return; }
  animation.syncFromRecord(e);
  const pl = player();
  if (pl && S.tick % 5 === 0 && p.record.pose !== 'collapse' && p.record.pose !== 'vanish') navigation.faceToward(pl.location, 4, e);
  if (p.loopMode && S.tick >= p.nextClipAt) next();
  if (p.record.motion !== 'still') navigation.stop(e);
}
