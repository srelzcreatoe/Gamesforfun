/**
 * The breath, poured (1.8).  The owner asked for the breath to begin as it does in a scene they showed (the head
 * down, the ground ahead flooded with fire, then the fire drawn into a beam that lifts), in his own way.  His way:
 * while it charges his head goes down to the ground in front of him; the shot comes out of his mouth as a gush that
 * floods that ground with his red fire, rolling outward in a fan, setting what will burn alight and scorching the
 * rest; then the gush narrows into the beam and his head comes up, and the beam ploughs a burning line across the
 * ground up to whatever he means to hit.  No other animal's colours, jaw or back: his plates, his red, his knocks.
 *
 * Used by Basiliskra III, Basiliskra IV and the Titan, whenever what they fire at is not in the air.
 */
import { EntityDamageCause, Player } from "@minecraft/server";
import { BeamSpec, BeamState, beamTick, clearRange, drawBeam } from "./beam";
import { CONFIG } from "./config";
import { targetable, type Creature } from "./creature";
import { beamVars, particle, players } from "./fx";
import { mobsNear, wither } from "./havoc";
import { shake } from "./roar";
import { add, dist, hash, mul, norm, wrapDeg, type V3 } from "./vec";
import { blockAt, clearLine, groundY, isLoaded, isNaturalGround, isSolidBlock } from "./world";

/** Ticks the breath floods the ground, and ticks it takes to narrow into the beam and lift to the target. */
export const POUR = { flood: 36, lift: 24 };

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

/**
 * The pour, then the lift: `POUR.flood + POUR.lift` ticks.  `aimAt` is where the beam is going in the end;
 * `scorch` marks the ground the beam crosses (the brain's own).
 */
export function* pourAndLift(c: Creature, spec: BeamSpec, aimAt: () => V3, st: BeamState, scorch: (at: V3) => void): Generator<void, void, void> {
  c.setPhase("pour");
  const reach = floodReach(spec);
  const down = groundAhead(c, aimAt());
  let origin: V3 | null = null, heading = c.yaw;
  for (let t = 0; t < POUR.flood; t++) {
    c.aimAt(down, 80, 80);
    const { from, dir } = c.aim();
    const length = clearRange(c, from, dir, 90);
    const hit = add(from, mul(dir, length));
    if (!origin) {
      origin = hit;
      heading = Math.atan2(-(down.x - c.pos.x), down.z - c.pos.z) * 180 / Math.PI;
      particle(c.dim, "basiliskra:impact_blast", hit, 192);
      particle(c.dim, "basiliskra:impact_ring", hit, 192);
    }
    // the gush itself: his breath, twice as wide as the beam it will become, from his mouth down onto the ground
    drawBeam(c.dim, from, dir, length, spec.width * (2.1 + 0.25 * Math.sin(t * 0.9)), t, true, hit);
    flood(c, spec, origin, heading, reach * easeOut((t + 1) / POUR.flood), t, scorch);
    if (t % 6 === 0) shake(c, 96, 0.5, 0.5);
    yield;
  }
  // the gush narrows, and his head comes up: the beam ploughs a line across the ground to where it is going
  c.setPhase("fire");
  const start = origin ?? down;
  for (let t = 0; t < POUR.lift; t++) {
    const k = smooth((t + 1) / POUR.lift);
    const goal = aimAt();
    c.aimAt({ x: start.x + (goal.x - start.x) * k, y: start.y + (goal.y - start.y) * k, z: start.z + (goal.z - start.z) * k }, 80, 80);
    // (it is still gathering itself: a third of its full weight, so a breath does no more to a giant than before)
    beamTick(c, { ...spec, width: spec.width * (2.0 - k), damage: spec.damage * 0.3 }, t, 1, st, { scorch, clean: true });
    // the flood still burns behind the beam as it lifts
    if (origin && t % 3 === 0) flood(c, spec, origin, heading, reach, POUR.flood + t, scorch, 0.5);
    if (t % 8 === 0) shake(c, 96, 0.45, 0.5);
    yield;
  }
  // where the beam has come to rest is where its crater is dug (not where the sweep happened to start one)
  st.ground = null;
}

const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);
const smooth = (k: number): number => k * k * (3 - 2 * k);

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
