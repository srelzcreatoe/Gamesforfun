// Movement through native navigation only: motion component groups, targeting (player or an inert waypoint helper), posture (crawl)
// with real collision changes, gradual facing while stationary, and progress tracking. No teleports, no script pathfinding.
import { IDS, EVENTS, MOTIONS, PARTICLES } from './constants.js';
import { S } from './state.js';
import { dist, flatDist, safe, isValid, yawTo, turnToward, yawToDir, clamp } from './util.js';
import { standRoom, lightApprox } from './world_scan.js';
import * as perception from './perception.js';

const TURN_RATE = 3.0; // degrees per tick when still (60°/s)
const MAX_WAYPOINTS = 2;

export function setMotion(name, entity) {
  const e = entity || S.active; const r = S.record || (S.preview && S.preview.record);
  if (!MOTIONS.includes(name) || !isValid(e)) return false;
  if (r && r.motion === name) return true;
  if (r) r.motion = name;
  safe(() => e.triggerEvent(EVENTS.move(name)));
  return true;
}
export function stop(entity) { return setMotion('still', entity); }

/** Crawl posture changes the real collision box. Standing back up requires 3 blocks of clearance. */
export function setPosture(low, entity) {
  const e = entity || S.active; const r = S.record; if (!isValid(e) || !r) return false;
  if (r.low === low) return true;
  if (!low && !standRoom(e.dimension, e.location, 3)) return false;
  r.low = low;
  safe(() => e.triggerEvent(low ? EVENTS.CROUCH : EVENTS.STAND));
  return true;
}
/** Is the passage here or 0.85 blocks ahead too low to stand? */
export function crampedAhead(entity) {
  const e = entity || S.active; if (!isValid(e)) return false;
  const v = safe(() => e.getViewDirection(), { x: 0, y: 0, z: 1 });
  const here = e.location; const ahead = { x: here.x + v.x * 0.85, y: here.y, z: here.z + v.z * 0.85 };
  const lowHere = !standRoom(e.dimension, here, 3) && standRoom(e.dimension, here, 2);
  const lowAhead = !standRoom(e.dimension, ahead, 3) && standRoom(e.dimension, ahead, 2);
  return lowHere || lowAhead;
}

export function targetPlayer(player, entity) {
  const e = entity || S.active; if (!isValid(e)) return;
  perception.setTargetTag(player);
  clearWaypoints();
  safe(() => e.triggerEvent(EVENTS.TARGET_PLAYER));
}
export function targetNone(entity) {
  const e = entity || S.active;
  perception.clearTargetTags(); clearWaypoints();
  if (isValid(e)) safe(() => e.triggerEvent(EVENTS.TARGET_NONE));
}
/** Steer toward a point using one inert waypoint helper (bounded, namespaced, self-expiring). */
export function targetWaypoint(point, entity) {
  const e = entity || S.active; if (!isValid(e) || !point) return false;
  clearWaypoints();
  const wp = safe(() => e.dimension.spawnEntity(IDS.WAYPOINT, { x: point.x, y: point.y + 0.5, z: point.z }), undefined);
  if (!wp) return false;
  S.waypoints.push(wp.id);
  while (S.waypoints.length > MAX_WAYPOINTS) { const old = S.waypoints.shift(); removeWaypoint(old); }
  perception.clearTargetTags();
  safe(() => e.triggerEvent(EVENTS.TARGET_WAYPOINT));
  return true;
}
function removeWaypoint(id) {
  const wp = safe(() => S.active && isValid(S.active) ? S.active.dimension.getEntities({ type: IDS.WAYPOINT }).find((x) => x.id === id) : undefined, undefined);
  if (wp) safe(() => wp.remove());
}
export function clearWaypoints() {
  for (const id of S.waypoints) removeWaypoint(id);
  S.waypoints.length = 0;
}
/** Remove every waypoint helper in the creature's dimension (cleanup safety net). */
export function sweepWaypoints(dimension) {
  if (!dimension) return;
  for (const wp of safe(() => dimension.getEntities({ type: IDS.WAYPOINT }), [])) safe(() => wp.remove());
  S.waypoints.length = 0;
}
export function waypointReached(point, entity, radius = 1.6) {
  const e = entity || S.active; if (!isValid(e) || !point) return false;
  return flatDist(e.location, point) <= radius && Math.abs(e.location.y - point.y) < 2.5;
}

/** Turn the body toward `pos` at a limited rate (only meaningful while the motion is 'still'). */
export function faceToward(pos, maxDegPerTick = TURN_RATE, entity) {
  const e = entity || S.active; const r = S.record || (S.preview && S.preview.record); if (!isValid(e) || !pos) return;
  const want = yawTo(e.location, pos);
  const cur = r && r.faceYaw !== undefined ? r.faceYaw : safe(() => e.getRotation().y, want);
  const next = turnToward(cur, want, maxDegPerTick);
  if (r) r.faceYaw = next;
  safe(() => e.setRotation({ x: 0, y: next }));
}
export function snapFace(pos, entity) { faceToward(pos, 360, entity); }
export function facePlayerGradual(player, entity) { if (isValid(player)) faceToward(player.location, TURN_RATE, entity); }
export function facingDot(entity, pos) {
  const e = entity || S.active; if (!isValid(e) || !pos) return 0;
  const r = S.record; const yaw = r && r.faceYaw !== undefined && r.motion === 'still' ? r.faceYaw : safe(() => e.getRotation().y, 0);
  const f = yawToDir(yaw); const dx = pos.x - e.location.x, dz = pos.z - e.location.z; const L = Math.hypot(dx, dz);
  return L < 0.05 ? 1 : (dx * f.x + dz * f.z) / L;
}
export function forgetFacing() { const r = S.record; if (r) r.faceYaw = undefined; }

/** Progress bookkeeping for stall detection. */
export function trackProgress(entity) {
  const e = entity || S.active; const r = S.record; if (!isValid(e) || !r) return;
  const loc = e.location;
  if (!r.lastPos) { r.lastPos = { ...loc }; r.lastProgress = S.tick; return; }
  if (flatDist(loc, r.lastPos) > 0.65 || Math.abs(loc.y - r.lastPos.y) > 0.9) { r.lastPos = { ...loc }; r.lastProgress = S.tick; }
}
export function resetProgress() { const r = S.record; if (r) { r.lastPos = undefined; r.lastProgress = S.tick; } }
export function stalled(ticks) { const r = S.record; return !!r && S.tick - r.lastProgress > ticks; }

/** Light threshold: refresh the approximation every 20 ticks; returns true while the creature should hesitate. */
export function updateLight(entity) {
  const e = entity || S.active; const r = S.record; if (!isValid(e) || !r) return false;
  if (!(S.config && S.config.lightAvoidance)) { r.lit.strong = false; r.lit.count = 0; return false; }
  if (S.tick % 20 === 0) {
    const res = lightApprox(e.dimension, e.location, 4, S.config.lightThreshold || 3);
    r.lit.count = res.count; r.lit.strong = res.strong; r.lit.threshold = S.config.lightThreshold || 3;
  }
  return r.lit.strong;
}
/** Hesitation behaviour at a strongly lit threshold: stop, inspect, show motes. Returns 'hesitate' | 'withdraw' | 'ok'. */
export function hesitateAtLight(entity) {
  const e = entity || S.active; const r = S.record; if (!isValid(e) || !r) return 'ok';
  if (!r.lit.strong) { r.lit.hesitating = false; return 'ok'; }
  if (!r.lit.hesitating) { r.lit.hesitating = true; r.lit.until = S.tick + 60 + Math.floor(Math.random() * 60); safe(() => e.dimension.spawnParticle(PARTICLES.lit_edge, { x: e.location.x, y: e.location.y + 1, z: e.location.z })); return 'hesitate'; }
  return S.tick >= r.lit.until ? 'withdraw' : 'hesitate';
}
