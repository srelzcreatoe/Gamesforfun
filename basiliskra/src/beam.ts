/**
 * One tick of his beam: where it goes, what is drawn, what it breaks and whom it burns.  Basiliskra III and IV
 * both breathe through this; each decides for itself where the head points and for how long.
 *
 * Obstruction is decided once, here, and the damage, the destruction and the picture all use the same answer.
 */
import { Dimension, EntityDamageCause, MolangVariableMap, Player } from "@minecraft/server";
import { CONFIG } from "./config";
import { Creature, otherGiants, targetable } from "./creature";
import { addFallout, sear } from "./fallout";
import { beamVars, particle, particleFor, players, sound } from "./fx";
import { blast, carve, mobsNear, segDist, wither } from "./havoc";
import { add, clamp, dist, dot, hash, mul, norm, sub, type V3 } from "./vec";
import { clearLine, isLoaded } from "./world";

/** How far the bodies of the biggest creatures reach from the point they stand at (blocks). */
const BIG: Record<string, number> = { "minecraft:ender_dragon": 6, "minecraft:ghast": 2.5, "minecraft:happy_ghast": 2.5, "minecraft:wither": 1.4,
  "minecraft:ravager": 1.2, "minecraft:iron_golem": 0.8, "minecraft:warden": 0.8, "minecraft:elder_guardian": 1.2, "minecraft:sniffer": 1.0 };

/** How deep a crater one landing place of the beam is blown to (blocks from where it first struck). */
export const CRATER = 6;

export interface BeamSpec {
  range: number; radius: number; damage: number; width: number; carve: number;
  /** Radius of the fallout left where it lands. */
  fallout: number;
  /** The raw beam: its width flutters. */
  rough?: boolean;
}
/** Where the beam is landing: it blasts out a crater there (it does not bore on for ever), the poison gathers there, and when the aim moves on, so does the crater. */
export interface BeamState { ground: V3 | null }
export interface BeamShot {
  /** From where and which way, if not from his mouth along his muzzle. */
  from?: V3; dir?: V3;
  /** Called at an impact when he is not destroying (the gentler modes mark the ground instead). */
  scorch?: (hit: V3) => void;
  /** Draw and burn, but break and poison nothing (a beam that is only a line of light). */
  harmless?: boolean;
  /** Break and burn, but leave no fallout or slag (the pour's lift: the poison gathers where the beam comes to rest). */
  clean?: boolean;
}

/** Returns where the beam ended, the block it struck (if any) and its length. */
export function beamTick(c: Creature, T: BeamSpec, t: number, fade: number, st: BeamState, shot: BeamShot = {}): { end: V3; hit: V3 | null; length: number; from: V3; dir: V3; struck: Creature | null } {
  const aim = shot.from && shot.dir ? { from: shot.from, dir: shot.dir } : c.aim();
  const from = aim.from, dir = aim.dir;
  const smash = wither() && !shot.harmless;
  let length: number = T.range;
  let hitBlock: V3 | null = null;
  if (isLoaded(c.dim, from)) {
    try {
      const hit = c.dim.getBlockFromRay(from, dir, { maxDistance: T.range, includeLiquidBlocks: false, includePassableBlocks: false });
      if (hit) { hitBlock = hit.block.location; length = Math.max(1, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })) - 0.4); }
    } catch { length = 6; }
  }
  // never draw or burn into chunks that are not loaded
  while (length > 4 && !isLoaded(c.dim, add(from, mul(dir, length)))) length -= 4;
  // another giant in its way stops it: a body that size is as solid to the light as a hill is
  let struck: Creature | null = null;
  for (const g of otherGiants(c)) {
    if (dist(g.pos, from) > length + 70) continue;
    for (const v of g.volumes()) {
      const along = dot(sub(v.at, from), dir);
      if (along <= 0 || along >= length + v.r) continue;
      if (dist(v.at, add(from, mul(dir, along))) > v.r + T.radius * 0.5) continue;
      const stop = Math.max(1, along - v.r * 0.6);
      if (stop < length) { length = stop; hitBlock = null; struck = g; }
    }
  }
  const end = add(from, mul(dir, length));
  if (struck) {
    if (t % 3 === 0) particle(c.dim, "basiliskra:beam_impact", end, 128);
    if (t % 4 === 2) particle(c.dim, "basiliskra:impact_glare", end, 160);
    if (t % 7 === 0) particle(c.dim, "basiliskra:impact_fire", end, 128);
    if (t % 6 === 3) particle(c.dim, "basiliskra:impact_smoke", end, 144);
    if (t % 10 === 0) sound(c.dim, "basiliskra.iii.beam_impact", end, 128);
    // (half of it: a body that size soaks up light, and giants that only stood off and burned each other would never close)
    if (t % 4 === 0) struck.takeBlow(c, T.damage * 0.5 * Math.max(0.3, fade));
  }
  // it throbs, about as fast as a heart racing (the width is the breath's: drawn to fill the mouth it leaves by)
  const w = T.width * fade * (T.rough ? 0.85 + hash(t) * 0.4 : 1) * (1 + 0.14 * Math.sin(t * 1.25));
  drawBeam(c.dim, from, dir, length, w, t, hitBlock !== null || struck !== null, end);
  // scarlet winding round the core
  const side = norm({ x: -dir.z, y: 0, z: dir.x });
  const up = norm({ x: dir.y * side.z - dir.z * side.y, y: dir.z * side.x - dir.x * side.z, z: dir.x * side.y - dir.y * side.x });
  for (let i = 0; i < 4; i++) {
    const along = ((t * 2.3 + i * (length / 4)) % length);
    const a = along * 1.1 + t * 0.9;
    const r = w * 0.45 + 0.3;
    particle(c.dim, "basiliskra:beam_spiral", add(add(from, mul(dir, along)), add(mul(side, Math.cos(a) * r), mul(up, Math.sin(a) * r))), 112);
  }
  if (hitBlock) {
    if (t % 3 === 0) particle(c.dim, "basiliskra:beam_impact", end, 112);
    if (t % 5 === 0) particle(c.dim, "basiliskra:impact_blast", end, 128);
    if (t % 6 === 3) particle(c.dim, "basiliskra:impact_smoke", end, 144);
    if (t % 7 === 0) particle(c.dim, "basiliskra:impact_fire", end, 112);
    if (t % 4 === 2) particle(c.dim, "basiliskra:impact_glare", end, 160);
    if (t % 10 === 5) particle(c.dim, "basiliskra:impact_ring", { x: end.x, y: end.y + 0.4, z: end.z }, 144);
    if (t % 8 === 1) particle(c.dim, "basiliskra:impact_fountain", end, 144);
    if (t % 10 === 0) sound(c.dim, "basiliskra.iii.beam_impact", end, 112);
    if (!st.ground || dist(st.ground, hitBlock) > CRATER + 3) st.ground = hitBlock;
    if (smash) {
      // like the Wither: what his light meets is blown out of the world, and the edges burn
      if (t % 4 === 0 && dist(st.ground, hitBlock) <= CRATER) {
        const got = carve(c.dim, hitBlock, T.carve * fade + 0.5, 110, true);
        if (got.broken) particle(c.dim, "basiliskra:impact_debris", end, 128);
        // rock runs to glowing slag, sand fuses (not on the sweep: slag cools only as the fallout round it fades)
        if (!shot.clean) sear(c.dim, got.floor, 5);
      }
      if (t % 12 === 0) {
        particle(c.dim, "minecraft:huge_explosion_emitter", end, 144);
        sound(c.dim, "random.explode", end, 128, 1.4, 0.7 + hash(t, 3) * 0.2);
      }
      if (t % 8 === 4) blast(c.dim, end, T.carve + 3.5, 4, c.mobHit(12), 0.8, (p, n) => c.hurt(p, n), c.entity, end);
    } else if (t % 6 === 0 && !shot.harmless) shot.scorch?.(hitBlock);
    if (t % 6 === 0 && !shot.harmless && !shot.clean) {
      addFallout(st.ground, T.fallout + (smash ? 1 : 0), 0.13);    // where his light lands, the ground is poisoned
      if (CONFIG.fallout !== "off") particle(c.dim, "basiliskra:fallout_ash", end, 64);
    }
  }
  if (t % 4 === 0) {
    const reach = T.radius * Math.max(0.5, fade) + 0.4;
    for (const p of players()) {
      try {
        if (p.dimension.id !== c.dim.id || !targetable(p)) continue;
        const body = add(p.location, { x: 0, y: 0.9, z: 0 });
        if (segDist(body, from, dir, length) > reach) continue;
        // the nearest point of the beam must see the player: a wall he hugs from behind still shelters him
        const along = clamp(dot(sub(body, from), dir), 0, Math.max(0, length - 0.6));
        if (!clearLine(c.dim, add(from, mul(dir, along)), body)) continue;
        c.hurt(p, T.damage, EntityDamageCause.entityAttack);
        try { (p as Player).setOnFire(3, true); } catch { /* fire-proof */ }
      } catch { /* left */ }
    }
    // and every creature in its path (the big ones by the whole of their bodies, not the point they stand at)
    for (const e of mobsNear(c.dim, add(from, mul(dir, length / 2)), length / 2 + 10)) {
      try {
        // (the whole height of a tall one, another add-on's giant say, not only its feet)
        let tall = 1.6;
        try { tall = Math.max(1, e.getHeadLocation().y - e.location.y); } catch { /* no head */ }
        const big = BIG[e.typeId] ?? (tall > 6 ? Math.min(6, 1.5 + tall * 0.12) : 0);
        const heights = tall > 4 ? [0.6, tall * 0.5, tall * 0.9] : [0.6 + big * 0.4];
        if (Math.min(...heights.map((h) => segDist(add(e.location, { x: 0, y: h, z: 0 }), from, dir, length))) > reach + 0.6 + big) continue;
        e.applyDamage(c.lethal > 0 ? c.lethal : T.damage * 2, { cause: EntityDamageCause.entityAttack, damagingEntity: c.entity });
        e.setOnFire(5, true);
      } catch { /* gone */ }
    }
  }
  return { end, hit: hitBlock, length, from, dir, struck };
}

/**
 * One tick of a beam as it is seen: a crackling white core, a body of scarlet plasma, fire over it and a glow round
 * it, light racing down it, a burst and a star at the mouth, rings, lightning, smoke, sparks; and at the far end, if
 * it struck something, a flash.  `w`: its width (all of it is drawn in proportion).  `to`: if given, only these
 * players are shown it (the Seam Lance draws its shooter's own view separately); `but`: everyone else.
 */
export function drawBeam(dim: Dimension, from: V3, dir: V3, length: number, w: number, t: number, landed: boolean, end: V3,
                         to?: Player[], but?: Player): void {
  const show = (id: string, at: V3, range: number, vars?: MolangVariableMap) => {
    if (to) particleFor(to, id, at, vars);
    else particle(dim, id, at, range, vars, but);
  };
  const v = beamVars(dir, length, w);
  if (t % 2 === 0) {
    show("basiliskra:beam_glow", from, 192, v);
    show("basiliskra:beam_halo", from, 192, v);
    show("basiliskra:beam_heat", from, 192, v);
    show("basiliskra:beam_core", from, 192, v);
    show("basiliskra:beam_pulse", from, 160, v);
    show("basiliskra:mouth_burst", from, 160, v);
  } else {
    // it smokes, sheds embers and throws sparks all along its length
    show("basiliskra:beam_smoke", from, 128, v);
    show("basiliskra:beam_sparks", from, 128, v);
    if (t % 4 === 1) show("basiliskra:beam_embers", from, 128, v);
  }
  if (t % 4 === 1) show("basiliskra:mouth_star", from, 160, v);
  if (t % 5 === 0) show("basiliskra:beam_ring", from, 160, v);
  if (t % 3 === 1) show("basiliskra:beam_arc", from, 128, v);
  if (landed && t % 4 === 2) show("basiliskra:impact_flash", end, 192, v);
}

/** How far along a line the way is clear (up to `max`), for drawing: never into a chunk that is not loaded. */
export function clearRange(c: Creature, from: V3, dir: V3, max: number): number {
  let length = max;
  if (isLoaded(c.dim, from)) {
    try {
      const hit = c.dim.getBlockFromRay(from, dir, { maxDistance: max, includeLiquidBlocks: false, includePassableBlocks: false });
      if (hit) length = Math.max(1, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })) - 0.4);
    } catch { length = 6; }
  }
  while (length > 4 && !isLoaded(c.dim, add(from, mul(dir, length)))) length -= 4;
  return length;
}
