/**
 * The Seam Lance: the one weapon made for him.  A laser of his own crimson, straight along the line of sight:
 * it strikes whichever of his hit volumes it meets first (his head counts for more, his tail for less), and
 * does a fraction of that to anything else alive.  Solid blocks stop it.  One shot every 0.6 seconds.
 *
 * It is a held item with no use of its own in the game's eyes: the script hears "item used" and does the rest.
 */
import { Dimension, EntityDamageCause, Player } from "@minecraft/server";
import { drawBeam } from "./beam";
import { isHitbox, NS, TITAN, TYPE } from "./config";
import type { Creature } from "./creature";
import { particle, sound, witnesses } from "./fx";
import { add, mul, norm, sub, type V3 } from "./vec";

export const LANCE_ITEM = `${NS}:seam_lance`;
const CATEGORY = `${NS}_lance`;
export const LANCE = { range: 140, cooldown: 12, damage: 34, head: 1.5, tail: 0.7, other: 9 };
/** The laser as drawn: how wide, and for how many ticks it stands in the air. */
export const LASER = { width: 0.9, ticks: 7 };
/**
 * Where its muzzle is, in blocks (tools/kit/gen_lance.py works it out from the model and the game's arm poses):
 * in the shooter's own first-person view, from their eye (right, up, along the view); and as everyone else sees it
 * held, from their feet (right, up, ahead of where they face).
 */
const MUZZLE_FP = { right: 0.74, up: -0.37, fwd: 2.9 };
const MUZZLE_TP = { right: 0.35, up: 1.06, fwd: 1.5 };

interface Laser { dim: Dimension; shooter: Player; fp: V3; tp: V3; end: V3; landed: boolean; t: number }
const lasers: Laser[] = [];

/** Each tick: every laser still in the air is drawn again (the shooter from their gun as they see it, the rest as it is held). */
export function lanceTick(): void {
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i];
    let ok = true;
    try { ok = L.shooter.isValid; } catch { ok = false; }
    if (!ok || L.t >= LASER.ticks) { lasers.splice(i, 1); continue; }
    const fade = L.t < LASER.ticks - 3 ? 1 : (LASER.ticks - L.t) / 3;
    const w = LASER.width * fade * (1 + 0.12 * Math.sin(L.t * 2.1));
    for (const [from, to, but] of [[L.fp, [L.shooter], undefined], [L.tp, undefined, L.shooter]] as [V3, Player[] | undefined, Player | undefined][]) {
      const d = sub(L.end, from), len = Math.max(0.5, Math.hypot(d.x, d.y, d.z));
      drawBeam(L.dim, from, norm(d), len, w, L.t * 3 + 4, L.landed, L.end, to, but);      // (so that every layer comes round)
    }
    L.t++;
  }
}

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
  // the laser: from the muzzle of the gun to where it struck, held in the air for a moment
  const end = add(from, mul(dir, reach));
  const landed = struck !== "nothing" || reach < LANCE.range - 1;
  const flat = norm({ x: dir.x, y: 0, z: dir.z });
  const right = norm({ x: -dir.z, y: 0, z: dir.x });               // (the cross of the view and up: facing +Z, that is -X)
  const camUp = { x: right.y * dir.z - right.z * dir.y, y: right.z * dir.x - right.x * dir.z, z: right.x * dir.y - right.y * dir.x };
  let feet: V3 = from;
  try { feet = p.location; } catch { /* as from the eye */ }
  const fp = add(add(add(from, mul(right, MUZZLE_FP.right)), mul(camUp, MUZZLE_FP.up)), mul(dir, MUZZLE_FP.fwd));
  const tp = add(add(add(feet, mul(right, MUZZLE_TP.right)), { x: 0, y: MUZZLE_TP.up, z: 0 }), mul(flat, MUZZLE_TP.fwd));
  lasers.push({ dim, shooter: p, fp, tp, end, landed, t: 0 });
  if (lasers.length > 32) lasers.shift();
  lanceTick();
  // the muzzle: a flash and a shock ring; at the far end, what it hits flies apart
  for (const [at, to] of [[fp, true], [tp, false]] as [V3, boolean][]) {
    for (const w of witnesses(dim, at, 96)) {
      if ((w.id === p.id) !== to) continue;
      try { w.spawnParticle("basiliskra:muzzle_flash", at); w.spawnParticle("basiliskra:lamp_flare", at); } catch { /* left */ }
    }
  }
  if (landed) {
    particle(dim, "basiliskra:beam_impact", end, 96);
    particle(dim, "basiliskra:impact_blast", end, 96);
    particle(dim, "basiliskra:impact_glare", end, 128);
    particle(dim, "basiliskra:crystal_break", end, 64);
    sound(dim, "break.amethyst_cluster", end, 48, 0.9, 0.7);
    sound(dim, "random.explode", end, 48, 0.35, 1.6);
  }
  sound(dim, "crossbow.shoot", from, 48, 1, 0.6);
  sound(dim, "firework.blast", from, 64, 0.8, 1.5);
  sound(dim, "beacon.deactivate", from, 32, 0.6, 1.9);
  try { p.runCommand("camerashake add @s 0.12 0.1 rotational"); } catch { /* no commands */ }
  return struck;
}
