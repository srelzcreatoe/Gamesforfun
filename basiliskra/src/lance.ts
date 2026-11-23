/**
 * The Seam Lance: the one weapon made for him.  A bolt of his own crimson, straight along the line of sight:
 * it strikes whichever of his hit volumes it meets first (his head counts for more, his tail for less), and
 * does a fraction of that to anything else alive.  Solid blocks stop it.  One shot every 0.6 seconds.
 *
 * It is a held item with no use of its own in the game's eyes: the script hears "item used" and does the rest.
 */
import { EntityDamageCause, Player } from "@minecraft/server";
import { isHitbox, NS, TITAN, TYPE } from "./config";
import type { Creature } from "./creature";
import { beamVars, particle, sound } from "./fx";
import { add, mul, type V3 } from "./vec";

export const LANCE_ITEM = `${NS}:seam_lance`;
const CATEGORY = `${NS}_lance`;
export const LANCE = { range: 140, cooldown: 12, damage: 34, head: 1.5, tail: 0.7, other: 9 };

const firedAt = new Map<string, number>();

/** A player has pulled the trigger.  `targets`: every Basiliskra there is to hit.  Returns what it struck. */
export function fireLance(p: Player, targets: readonly (Creature | null)[], now: number): "him" | "other" | "nothing" | "cooling" {
  // one shot per cooldown (the item's own cooldown shows it on the hotbar; the script's clock is what is trusted)
  if (now - (firedAt.get(p.id) ?? -99) < LANCE.cooldown) return "cooling";
  firedAt.set(p.id, now);
  if (firedAt.size > 64) for (const [k, t] of firedAt) if (now - t > 200) firedAt.delete(k);
  try { p.startItemCooldown(CATEGORY, LANCE.cooldown); } catch { /* shown or not, it fires */ }
  const dim = p.dimension;
  let from: V3, dir: V3;
  try { from = p.getHeadLocation(); dir = p.getViewDirection(); } catch { return "nothing"; }
  // what stops it: the first solid block in the line
  let reach = LANCE.range;
  try {
    const b = dim.getBlockFromRay(from, dir, { maxDistance: LANCE.range, includeLiquidBlocks: false, includePassableBlocks: false });
    if (b) reach = Math.max(0.5, Math.hypot(b.block.location.x + 0.5 - from.x, b.block.location.y + 0.5 - from.y, b.block.location.z + 0.5 - from.z) - 0.4);
  } catch { /* unloaded: it flies as far as it is drawn */ }
  let struck: "him" | "other" | "nothing" = "nothing";
  let best: { c: Creature; dist: number; tag: string } | null = null;
  for (const c of targets) {
    try {
      if (!c || !c.valid || c.dim.id !== dim.id) continue;
      const h = c.rayHit(from, dir, reach);
      if (h && (!best || h.dist < best.dist)) best = { c, dist: h.dist, tag: h.tag };
    } catch { /* unloading */ }
  }
  if (best) {
    reach = Math.max(0.5, best.dist);
    const amount = LANCE.damage * (best.tag === "head" ? LANCE.head : best.tag === "tail" ? LANCE.tail : 1);
    try { best.c.entity.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: p }); struck = "him"; } catch { /* gone */ }
    try { p.playSound("random.orb", { volume: 0.5, pitch: best.tag === "head" ? 1.6 : 1.1 }); } catch { /* left */ }
  } else {
    // anything else alive in the line takes a little of it
    try {
      for (const r of dim.getEntitiesFromRay(from, dir, { maxDistance: reach })) {
        const e = r.entity;
        if (e.id === p.id || e.typeId === "minecraft:item" || e.typeId === TYPE || e.typeId === TITAN || isHitbox(e.typeId)) continue;
        reach = Math.max(0.5, r.distance);
        e.applyDamage(LANCE.other, { cause: EntityDamageCause.entityAttack, damagingEntity: p });
        struck = "other";
        break;
      }
    } catch { /* unloading */ }
  }
  // the bolt, drawn from just ahead of the muzzle so that it does not blind whoever fired it
  const start = add(from, { x: dir.x * 1.4, y: dir.y * 1.4 - 0.3, z: dir.z * 1.4 });
  const len = Math.max(0.5, reach - 1.4);
  particle(dim, "basiliskra:beam_core", start, 128, beamVars(dir, len, 0.26));
  particle(dim, "basiliskra:beam_halo", start, 128, beamVars(dir, len, 0.8));
  const end = add(from, mul(dir, reach));
  if (struck !== "nothing" || reach < LANCE.range - 1) {
    particle(dim, "basiliskra:beam_impact", end, 96);
    particle(dim, "basiliskra:crystal_break", end, 64);
    sound(dim, "break.amethyst_cluster", end, 48, 0.9, 0.7);
  }
  sound(dim, "crossbow.shoot", from, 48, 1, 0.6);
  sound(dim, "firework.blast", from, 64, 0.7, 1.7);
  try { p.runCommand("camerashake add @s 0.12 0.1 rotational"); } catch { /* no commands */ }
  return struck;
}
