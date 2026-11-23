/**
 * The people of his cities (basiliskra:civilian, tools/kit/gen_civilian.py).  They walk the streets until a giant
 * comes into sight: then they throw their arms up and run from it, and keep running for a while after they last
 * saw it.  Near enough (a few dozen blocks) they feel the ground shake and need no line of sight; further off they
 * must see him, past whatever stands between.  Bounded: a query per giant twice a second, and at most a couple of
 * dozen sight lines a pass.
 */
import { Entity, world } from "@minecraft/server";
import { CIVILIAN, NS } from "./config";
import type { Creature } from "./creature";
import { dist } from "./vec";
import { clearLine } from "./world";

/** How far off a giant is seen (blocks), and how near it is felt without being seen. */
const SIGHT = 110, FELT = 36;
/** How long the fright lasts after the giant was last seen (ticks). */
const FRIGHT = 300;
const SCARED = `${NS}:scared`;

/** Civilian id -> the tick their fright runs out. */
const frightened = new Map<string, number>();

function panic(e: Entity): void {
  try { e.triggerEvent(`${NS}:panic`); e.setProperty(SCARED, true); } catch { /* gone */ }
}
function calm(e: Entity): void {
  try { e.triggerEvent(`${NS}:calm`); e.setProperty(SCARED, false); } catch { /* gone */ }
}

/** Twice a second, from the controller: who has seen a giant, and who has stopped running. */
export function civiliansTick(now: number, giants: Creature[]): void {
  if (now % 10 !== 4) return;
  for (const g of giants) {
    if (!g.valid) continue;
    let near: Entity[] = [];
    try { near = g.dim.getEntities({ type: CIVILIAN, location: g.pos, maxDistance: SIGHT }); } catch { continue; }
    const mid = g.middle();
    let looks = 0;
    for (const e of near) {
      let d = 1e9;
      try { d = dist(e.location, g.pos); } catch { continue; }
      let sees = d < FELT + g.girth;
      if (!sees && looks < 24) {
        looks++;
        try { sees = clearLine(g.dim, e.getHeadLocation(), mid); } catch { sees = false; }
      }
      if (!sees) continue;
      if ((frightened.get(e.id) ?? -1) <= now) panic(e);
      frightened.set(e.id, now + FRIGHT);
    }
  }
  for (const [id, until] of frightened) {
    if (until > now) continue;
    frightened.delete(id);
    let e: Entity | undefined;
    try { e = world.getEntity(id); } catch { e = undefined; }
    if (e) calm(e);
  }
}

/** How many are frightened just now (for the test report). */
export const frightenedCount = (now: number): number => [...frightened.values()].filter((t) => t > now).length;
