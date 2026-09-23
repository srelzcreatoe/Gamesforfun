// Combat. One damaging hit per committed attack, at the clip's impact tick, only after every recheck passes.
// No native melee: the entity has no minecraft:attack component and no melee goal, so nothing can double a hit.
import { world, Difficulty, EntityDamageCause } from '@minecraft/server';
import { ATTACKS, ACTION_NAMES, MIN_ATTACK_GAP, SOUNDS, PARTICLES } from './constants.js';
import { S } from './state.js';
import { dist, safe, isValid, chance, sub } from './util.js';
import { playerEligible, worldAllowsEncounters, masterEnabled } from './gates.js';
import * as reservation from './reservation.js';
import * as perception from './perception.js';
import * as navigation from './navigation.js';
import * as animation from './animation.js';
import * as audio from './audio.js';
import * as memory from './memory.js';
import { cue } from './text.js';

const FACE_LOCK_BEFORE_IMPACT = 6; // ticks before impact after which the body no longer tracks the target

export function pending() { return S.record ? S.record.pendingAttack : null; }
export function canStart(kind, entity, player) {
  const r = S.record; const a = ATTACKS[kind];
  if (!a || !r || !isValid(entity) || !isValid(player)) return false;
  if (r.pendingAttack || S.tick < r.nextAttack) return false;
  if (!reservation.validate(entity) || !playerEligible(player)) return false;
  if (dist(entity.location, player.location) > a.start) return false;
  if (Math.abs(entity.location.y - player.location.y) > a.vertical) return false;
  return perception.lineOfSight(entity, player);
}
/** Choose which strike to use. Crawling always uses the low strike; players who rush into melee get the slower, clearly telegraphed slam. */
export function chooseKind(player) {
  const r = S.record; if (r && r.low) return 'attack_crawl';
  const t = player ? memory.traits(player.id) : {};
  return chance(t.rusher ? 0.6 : 0.3) ? 'slam' : 'attack';
}
export function start(kind, entity, player) {
  const r = S.record; const a = ATTACKS[kind]; if (!a || !r || !isValid(entity)) return false;
  r.pendingAttack = { kind, startTick: S.tick, hitDone: false, targetId: player ? player.id : undefined };
  navigation.stop(entity);
  navigation.snapFace(player ? player.location : entity.location, entity);
  animation.setAction(kind, entity);
  audio.fxAt(SOUNDS.windup, entity, { volume: 0.8, radius: 18 });
  if (player) cue(player, kind === 'slam' ? 'windup_slam' : 'windup');
  return true;
}
/** Per tick. Returns 'running' | 'done' | 'idle'. */
export function update(entity) {
  const r = S.record; if (!r || !r.pendingAttack) return 'idle';
  const pa = r.pendingAttack; const a = ATTACKS[pa.kind]; const age = S.tick - pa.startTick;
  if (!isValid(entity) || !reservation.validate(entity) || !masterEnabled() || !worldAllowsEncounters()) { cancel('invalid'); return 'done'; }
  const player = perception.targetOf(r);
  if (age < a.impact - FACE_LOCK_BEFORE_IMPACT && isValid(player)) navigation.faceToward(player.location, 6, entity);
  if (age >= a.impact && !pa.hitDone) { pa.hitDone = true; resolveImpact(entity, player, pa.kind); }
  if (age >= a.duration) {
    r.pendingAttack = null;
    r.nextAttack = S.tick + MIN_ATTACK_GAP + Math.floor(a.duration * 0.3);
    navigation.forgetFacing();
    return 'done';
  }
  return 'running';
}
/** All rechecks happen here, once, at impact time. */
export function resolveImpact(entity, player, kind) {
  const r = S.record; const a = ATTACKS[kind]; if (!r || !a) return false;
  audio.fxAt(SOUNDS.strike, entity, { volume: 0.8, radius: 18 });
  if (!isValid(entity) || !reservation.validate(entity)) return false;
  if (!isValid(player) || !playerEligible(player) || !worldAllowsEncounters() || !masterEnabled()) return false;
  if (safe(() => player.dimension.id, 'a') !== safe(() => entity.dimension.id, 'b')) return false;
  const d = dist(entity.location, player.location);
  if (d > a.range) { noteDodge(player, entity); return false; }
  if (Math.abs(entity.location.y - player.location.y) > a.vertical) return false;
  if (navigation.facingDot(entity, player.location) < a.facing) { noteDodge(player, entity); return false; }
  if (!perception.lineOfSight(entity, player)) return false;
  const diff = safe(() => world.getDifficulty(), Difficulty.Normal);
  const mult = diff === Difficulty.Easy ? 0.65 : diff === Difficulty.Hard ? 1.25 : 1.0;
  const scale = S.config ? S.config.damageScale : 1;
  const enraged = S.tick < r.enragedUntil;
  const damage = Math.round((a.damage + (enraged ? 2 : 0)) * mult * scale);
  if (damage <= 0) return false;
  const hit = safe(() => player.applyDamage(damage, { cause: EntityDamageCause.entityAttack, damagingEntity: entity }), false);
  if (hit) {
    const dx = player.location.x - entity.location.x, dz = player.location.z - entity.location.z; const L = Math.hypot(dx, dz) || 1;
    safe(() => player.applyKnockback({ x: dx / L * 0.55, z: dz / L * 0.55 }, 0.16));
    audio.fx(SOUNDS.impact, player.location, { volume: 0.85, radius: 18, dimensionId: safe(() => player.dimension.id, undefined) });
    safe(() => entity.dimension.spawnParticle(PARTICLES.ink_puff, { x: player.location.x, y: player.location.y + 1, z: player.location.z }));
    memory.observe(player.id, 'rush', d < 1.6 ? 1 : 0);
  }
  return !!hit;
}
function noteDodge(player, entity) {
  if (!isValid(player) || !isValid(entity)) return;
  const f = safe(() => entity.getViewDirection(), { x: 0, y: 0, z: 1 });
  const rel = sub(player.location, entity.location);
  const side = f.z * rel.x - f.x * rel.z; // sign of the cross product: which side of the creature's facing the player ended up on
  memory.observe(player.id, side > 0 ? 'dodgeL' : 'dodgeR', 1);
}
export function cancel(reason) {
  const r = S.record; if (!r) return;
  if (r.pendingAttack) { r.pendingAttack = null; animation.clearAction(); }
  navigation.forgetFacing();
}
export function describe() {
  const r = S.record; if (!r || !r.pendingAttack) return 'no attack pending';
  return `${r.pendingAttack.kind} age ${S.tick - r.pendingAttack.startTick} hit ${r.pendingAttack.hitDone}`;
}
