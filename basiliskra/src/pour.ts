/**
 * The breath, choreographed (1.8, redone in 1.9).  The owner showed how they want the breath to begin (a clip of a
 * Godzilla add-on in the game, and the film's scene) and asked for it in his own way.  His way, in four movements,
 * all inside the time his recording gives the charge and the shot:
 *
 *   1. the club plants and his head goes down to the ground in front of him, his jaw open;
 *   2. black smoke pours out of his mouth onto that ground and heaps and rolls outward over it, embers in it; then
 *      the smoke catches, and the ground in front of him is a flood of his red fire, spreading;
 *   3. he rears back: head thrown up to the sky, jaw wide, light gathering in his mouth (Basiliskra IV spreads his
 *      wings and raises his arms);
 *   4. he slams forward and fires: the beam goes into the burning ground in front of him and sweeps up to the place
 *      the aim line showed.
 *
 * No other animal's colours, jaw or back: his red, his plates, his knocks.  Used by Basiliskra III, Basiliskra IV and
 * the Titan, whenever what they fire at is not in the air.  The Titan's charge also kills whatever small stands round
 * it, as the add-on the owner compared it with does.
 */
import { EntityDamageCause, Player } from "@minecraft/server";
import { BeamSpec, BeamState, beamTick, clearRange } from "./beam";
import { CONFIG } from "./config";
import { targetable, type Creature } from "./creature";
import { beamVars, flash, particle, players, sound } from "./fx";
import { mobsNear, wither } from "./havoc";
import { shake } from "./roar";
import { add, clamp, dist, hash, mul, norm, wrapDeg, yawTo, type V3 } from "./vec";
import { blockAt, clearLine, groundY, isLoaded, isNaturalGround, isSolidBlock } from "./world";

/** Ticks of black smoke before it catches (within the charge), and ticks the beam takes to sweep up to its mark. */
export const POUR = { smoke: 42, lift: 20 };
/** How far up his head is thrown in the rear (look pitch: below 0 is up). */
const REAR_PITCH = -68;
/** How far down his head is slammed at the start of the shot (the beam goes into the ground in front of him). */
const SLAM_PITCH = 72;
/** How far round him the Titan's charge kills (blocks). */
const CHARGE_KILLS = 30;

/** What one breath remembers between its charge and its shot. */
export interface PourState { down: V3 | null; origin: V3 | null; heading: number }
export const freshPour = (): PourState => ({ down: null, origin: null, heading: 0 });

/** The ground in front of him, toward `target`: where his head goes down to while the breath charges. */
export function groundAhead(c: Creature, target: V3): V3 {
  const m = c.anchor("mouth");
  const h = norm({ x: target.x - c.pos.x, y: 0, z: target.z - c.pos.z });
  const along = Math.min(Math.hypot(target.x - m.x, target.z - m.z), c.girth * 1.2 + 4 + Math.max(0, m.y - c.pos.y) * 0.45);
  const x = m.x + h.x * along, z = m.z + h.z * along;
  const g = isLoaded(c.dim, { x, y: c.pos.y, z }) ? groundY(c.dim, x, z, c.pos.y + 8, 40) : null;
  return { x, y: (typeof g === "number" ? g : c.pos.y - 1) + 0.6, z };
}

/** How far the flood reaches, for a breath this wide (blocks). */
export const floodReach = (spec: BeamSpec): number => spec.width * 10;

const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);
const smooth = (k: number): number => k * k * (3 - 2 * k);

/**
 * 2. One tick of the pour, `t` ticks into it and `n` long: smoke for the first POUR.smoke ticks, then fire.  The head is
 * kept down on the ground toward `aimAt`; `scorch` marks the ground (the brain's own).
 */
export function pourTick(c: Creature, spec: BeamSpec, ps: PourState, t: number, n: number, aimAt: () => V3, scorch: (at: V3) => void): void {
  if (!ps.down) ps.down = groundAhead(c, aimAt());
  c.trackTo(ps.down, 3, 80, 80);
  const { from, dir } = c.aim();
  const length = clearRange(c, from, dir, 90);
  const hit = add(from, mul(dir, length));
  if (!ps.origin) {
    ps.origin = hit;
    ps.heading = yawTo(c.pos, ps.down);
    sound(c.dim, "random.fizz", hit, 160, 2, 0.4);
  }
  const reach = floodReach(spec);
  if (t < POUR.smoke) {
    // black smoke: a stream of it from his mouth down onto the ground, heaped there and rolling outward
    if (t % 2 === 0) for (let k = 0; k < 3; k++) particle(c.dim, "basiliskra:soot_stream", add(from, mul(dir, (length * k) / 3)), 192, beamVars(dir, 1, spec.width));
    soot(c, spec, ps.origin, ps.heading, 5 + reach * 0.75 * easeOut((t + 1) / POUR.smoke), t);
    if (t % 10 === 0) sound(c.dim, "mob.blaze.breathe", from, 128, 1.6, 0.45);
  } else {
    // the smoke catches: the ground in front of him is a flood of his fire, spreading
    if (t === POUR.smoke) {
      particle(c.dim, "basiliskra:impact_blast", ps.origin, 192);
      particle(c.dim, "basiliskra:impact_ring", ps.origin, 192);
      sound(c.dim, "mob.ghast.fireball", ps.origin, 192, 2, 0.5);
      flash(c.dim, ps.origin, 48, { red: 1, green: 0.35, blue: 0.2 }, 0.03, 0.05, 0.4);
      shake(c, 128, 0.8, 0.6);
    }
    // (fire, not yet the beam: a stream of it out of his mouth onto the ground)
    for (let k = 0; k < 3; k++) particle(c.dim, "basiliskra:fire_stream", add(from, mul(dir, (length * k) / 3)), 192, beamVars(dir, 1, spec.width));
    if (t % 4 === 0) particle(c.dim, "basiliskra:impact_fire", hit, 160);
    flood(c, spec, ps.origin, ps.heading, reach * easeOut((t - POUR.smoke + 1) / Math.max(1, n - POUR.smoke)), t, scorch);
    if (t % 3 === 0) soot(c, spec, ps.origin, ps.heading, reach, t, 0.4);
  }
  if (t % 6 === 0) shake(c, 96, 0.35, 0.5);
  if (c.lethal > 0 && t % 10 === 0) killRound(c, spec);
}

/** 3. One tick of the rear, `t` of `n`: the head thrown up to the sky, the light gathering in his mouth. */
export function rearTick(c: Creature, spec: BeamSpec, ps: PourState, t: number, n: number, mark: V3): void {
  c.lookPitch += clamp(REAR_PITCH - c.lookPitch, -7, 7);
  c.relook();
  c.lookYaw += clamp(clamp(wrapDeg(yawTo(c.pos, mark) - c.yaw), -45, 45) - c.lookYaw, -2, 2);
  const mouth = c.anchor("mouth");
  if (t % 3 === 0) particle(c.dim, "basiliskra:mouth_star", mouth, 192);
  if (t % 4 === 1) particle(c.dim, "basiliskra:impact_glare", mouth, 192);
  if (t % 6 === 0) sound(c.dim, "basiliskra.iii.charge_tick", mouth, 128, 0.8, 1.2 + (t / n) * 0.8);
  // the ground he poured on still burns
  if (ps.origin && t % 2 === 0) flood(c, spec, ps.origin, ps.heading, floodReach(spec), 1000 + t, () => { /* nothing more is scorched */ }, 0.45);
  if (t % 5 === 0) shake(c, 128, 0.3 + 0.5 * (t / n), 0.5);
  if (c.lethal > 0 && t % 10 === 0) killRound(c, spec);
}

/**
 * 4. The slam and the sweep: POUR.lift ticks at the start of the shot.  The beam goes into the burning ground in front
 * of him and sweeps up to `mark` (the place fixed when the aim line showed: stepping out of the line still works).
 */
export function* slamAndLift(c: Creature, spec: BeamSpec, ps: PourState, st: BeamState, mark: () => V3, scorch: (at: V3) => void): Generator<void, void, void> {
  shake(c, 160, 1.1, 0.6);
  for (let t = 0; t < POUR.lift; t++) {
    const k = smooth((t + 1) / POUR.lift);
    const goal = mark();
    c.aimAt(goal, 80, 80);
    // (the burning ground is almost under his mouth once he has slammed forward, so the sweep is made by angle: from
    // steeply down into it, up to the mark; and if the muzzle check throws his head round sideways, it is kept on the
    // line to the mark)
    const ahead = clamp(wrapDeg(yawTo(c.pos, goal) - c.yaw), -80, 80);
    if (Math.abs(wrapDeg(c.lookYaw - ahead)) > 25) c.lookYaw = ahead;
    c.lookPitch += (Math.max(c.lookPitch, SLAM_PITCH) - c.lookPitch) * (1 - k);
    c.relook();
    // (it is still narrowing: a third of its full weight, so a breath does no more to a giant than before)
    beamTick(c, { ...spec, width: spec.width * (2.0 - k), damage: spec.damage * 0.3 }, t, 1, st, { scorch, clean: true });
    if (ps.origin && t % 3 === 0) flood(c, spec, ps.origin, ps.heading, floodReach(spec), 2000 + t, scorch, 0.5);
    if (t % 8 === 0) shake(c, 96, 0.45, 0.5);
    yield;
  }
  // where the beam has come to rest is where its crater is dug (not where the sweep happened to start one)
  st.ground = null;
}

/** The black smoke over the ground: billows heaped along the front of it and behind, embers in it. */
function soot(c: Creature, spec: BeamSpec, origin: V3, heading: number, r: number, t: number, share = 1): void {
  const dim = c.dim;
  const n = Math.round((t % 2 === 0 ? 6 : 2) * share);
  for (let i = 0; i < n; i++) {
    const a = (heading + (hash(c.tick, i, 61) - 0.5) * 110) * Math.PI / 180;
    const d = r * (i < n * 0.6 ? 0.7 + 0.3 * hash(c.tick, i, 62) : hash(c.tick, i, 63));
    const x = origin.x - Math.sin(a) * d, z = origin.z + Math.cos(a) * d;
    if (!isLoaded(dim, { x, y: origin.y, z })) continue;
    const g = groundY(dim, x, z, origin.y + 10, 24);
    if (typeof g !== "number") continue;
    const out = norm({ x: -Math.sin(a), y: 0, z: Math.cos(a) });
    particle(dim, "basiliskra:soot_billow", { x, y: g + 1.5, z }, 192, beamVars(out, 1, spec.width));
    if (i % 3 === 0) particle(dim, "basiliskra:soot_ember", { x, y: g + 1, z }, 128, beamVars(out, 1, spec.width));
  }
}

/**
 * One tick of the flood: fire rolling outward over a fan of ground `r` blocks deep in front of him (60 degrees each
 * side of `heading`), smoke, embers; what it reaches burns.  `share` thins it as it dies down.
 */
function flood(c: Creature, spec: BeamSpec, origin: V3, heading: number, r: number, t: number, scorch: (at: V3) => void, share = 1): void {
  const dim = c.dim;
  const n = Math.round((t % 2 === 0 ? 7 : 3) * share);
  for (let i = 0; i < n; i++) {
    // most of it along the front of the flood, the rest behind it
    const a = (heading + (hash(c.tick, i, 71) - 0.5) * 120) * Math.PI / 180;
    const d = r * (i < n * 0.65 ? 0.72 + 0.28 * hash(c.tick, i, 72) : hash(c.tick, i, 73));
    const x = origin.x - Math.sin(a) * d, z = origin.z + Math.cos(a) * d;
    if (!isLoaded(dim, { x, y: origin.y, z })) continue;
    const g = groundY(dim, x, z, origin.y + 10, 24);
    if (typeof g !== "number") continue;
    const at = { x, y: g + 1.2, z };
    const out = norm({ x: -Math.sin(a), y: 0, z: Math.cos(a) });
    particle(dim, "basiliskra:flood_fire", at, 192, beamVars(out, 1, spec.width));
    if (i % 3 === 0) particle(dim, "basiliskra:flood_ember", at, 128, beamVars(out, 1, spec.width));
    if (i === 0 && t % 4 === 0) particle(dim, "basiliskra:flood_smoke", { ...at, y: at.y + 2 }, 192, beamVars(out, 1, spec.width));
    // what it reaches: the ground scorches, and anything that will burn catches
    if (CONFIG.terrain !== "none" && i < 2 && t % 2 === 0) {
      scorch({ x, y: g, z });
      const above = blockAt(dim, { x, y: g + 1, z }), under = blockAt(dim, { x, y: g, z });
      if (above && above.isAir && under && isSolidBlock(under) && (wither() || isNaturalGround(under.typeId)) && hash(c.tick, i, 74) < 0.5) {
        try { above.setType("minecraft:fire"); } catch { /* protected */ }
      }
    }
  }
  if (t % 4 !== 0) return;
  // whatever stands in its heart burns: straight ahead of where it lands, and in sight of it (the fire seen rolling
  // out to the sides is for show: a player who stepped out of the line during the lock is still out of it, and a
  // wall still shelters)
  const eye = { x: origin.x, y: origin.y + 1.5, z: origin.z };
  const near = (p: V3): boolean => {
    const d = dist({ x: p.x, y: origin.y, z: p.z }, origin);
    if (d > r + 1.5 || Math.abs(p.y - origin.y) > 6) return false;
    if (d >= 4) {
      const b = Math.atan2(-(p.x - origin.x), p.z - origin.z) * 180 / Math.PI;
      if (Math.abs(wrapDeg(b - heading)) > 18) return false;
    }
    return clearLine(dim, eye, { x: p.x, y: p.y + 1, z: p.z });
  };
  for (const p of players()) {
    try {
      if (p.dimension.id !== dim.id || !targetable(p) || !near(p.location)) continue;
      c.hurt(p, spec.damage * 0.6, EntityDamageCause.fire);
      (p as Player).setOnFire(4, true);
    } catch { /* left */ }
  }
  for (const e of mobsNear(dim, origin, r + 2)) {
    try {
      if (!near(e.location)) continue;
      e.applyDamage(c.mobHit(spec.damage), { cause: EntityDamageCause.fire, damagingEntity: c.entity });
      e.setOnFire(6, true);
    } catch { /* gone */ }
  }
}

/** The Titan's charge: whatever small stands within CHARGE_KILLS of it dies (players it may not hurt are spared). */
function killRound(c: Creature, spec: BeamSpec): void {
  const r = CHARGE_KILLS + c.girth;
  for (const p of players()) {
    try {
      if (p.dimension.id !== c.dim.id || !targetable(p) || dist(p.location, c.pos) > r) continue;
      c.hurt(p, spec.damage, EntityDamageCause.fire);
    } catch { /* left */ }
  }
  for (const e of mobsNear(c.dim, c.pos, r)) {
    try { e.applyDamage(c.lethal, { cause: EntityDamageCause.fire, damagingEntity: c.entity }); } catch { /* gone */ }
  }
}
