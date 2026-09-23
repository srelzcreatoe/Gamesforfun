// Animation synchronisation. The client plays clips from three entity properties (pose / action / overlay) plus the head-track flag.
// The script only writes a property when it changes, and resets one-shot actions one tick before the clip ends.
import { IDS, ACTIONS, ACTION_NAMES, CLIPS, POSES, OVERLAYS } from './constants.js';
import { S } from './state.js';
import { safe, isValid } from './util.js';

function entity(e) { return e || S.active; }
function rec() { return S.record || (S.preview && S.preview.record); }

export function setPose(name, e) {
  const ent = entity(e); const r = rec();
  if (!POSES.includes(name) || !isValid(ent)) return false;
  if (r && r.pose === name) return true;
  if (r) r.pose = name;
  safe(() => ent.setProperty(IDS.P_POSE, name));
  safe(() => ent.setDynamicProperty(IDS.ENT_POSE_SAVED, name));
  return true;
}
/** Start a one-shot clip. Returns its duration in ticks (0 if unknown). The action is cleared automatically at ticks-1. */
export function setAction(name, e) {
  const ent = entity(e); const r = rec();
  const id = ACTIONS[name]; const clip = CLIPS[name];
  if (id === undefined || !clip || !isValid(ent)) return 0;
  if (r) { r.action = id; r.actionUntil = S.tick + Math.max(1, clip.ticks - 1); }
  safe(() => ent.setProperty(IDS.P_ACTION, id));
  return clip.ticks;
}
export function clearAction(e) {
  const ent = entity(e); const r = rec();
  if (r) { r.action = 0; r.actionUntil = 0; }
  if (isValid(ent)) safe(() => ent.setProperty(IDS.P_ACTION, 0));
}
export function currentAction() { const r = rec(); return r ? ACTION_NAMES[r.action] || 'none' : 'none'; }
export function actionActive() { const r = rec(); return !!r && r.action !== 0 && S.tick < r.actionUntil; }

export function setOverlay(n, e) {
  const ent = entity(e); const r = rec();
  const id = typeof n === 'string' ? OVERLAYS[n] : n;
  if (id === undefined || !isValid(ent)) return;
  if (r && r.overlay === id) return;
  if (r) r.overlay = id;
  safe(() => ent.setProperty(IDS.P_OVERLAY, id));
}
export function setTrack(on, e) {
  const ent = entity(e); const r = rec();
  if (!isValid(ent)) return;
  if (r && r.track === !!on) return;
  if (r) r.track = !!on;
  safe(() => ent.setProperty(IDS.P_TRACK, !!on));
}

/** Per-tick: clears a finished one-shot action. */
export function syncFromRecord(e) {
  const r = rec(); const ent = entity(e);
  if (!r || !isValid(ent)) return;
  if (r.action !== 0 && S.tick >= r.actionUntil) clearAction(ent);
}

/** Preview helper: looping clips become the pose, one-shots become the action. Returns the clip length in ticks. */
export function previewPlay(ent, clipName) {
  const clip = CLIPS[clipName]; if (!clip || !isValid(ent)) return 0;
  if (clip.loop === true) { setPose(clipName, ent); clearAction(ent); return clip.ticks; }
  if (clipName === 'emerge' || clipName === 'vanish' || clipName === 'collapse') { clearAction(ent); setPose(clipName, ent); return clip.ticks; }
  setAction(clipName, ent); return clip.ticks;
}
export function resetVisual(e) {
  const ent = entity(e); if (!isValid(ent)) return;
  setPose('idle', ent); clearAction(ent); setOverlay(0, ent); setTrack(false, ent);
}
