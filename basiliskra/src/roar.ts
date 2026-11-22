/**
 * What a roar does besides being heard: the screen shakes (hard close to him, less further off, never wild),
 * and from his feet a shockwave runs out along the ground.  As the ring passes it throws players and creatures
 * away from him and hurts them, flattens plants, blows snow and wild leaves off, and (in wither mode) shatters
 * glass, lanterns and torches.
 */
import { Entity, EntityDamageCause, MolangVariableMap } from "@minecraft/server";
import type { Creature } from "./creature";
import { particle, sound, witnesses } from "./fx";
import { brittleAround, mobsNear, shatter, shatterRing } from "./havoc";
import { clamp, distXZ, norm, type V3 } from "./vec";

/** Blocks the ring travels each tick (40 a second). */
export const WAVE_SPEED = 2;

/** Shake the screens of everyone within `range`: `peak` at his feet, a little at the edge. */
export function shake(c: Creature, range: number, peak: number, seconds = 0.6): void {
  for (const p of witnesses(c.dim, c.pos, range)) {
    try {
      const f = Math.max(0, 1 - distXZ(p.location, c.pos) / range);
      const i = clamp(0.08 + (peak - 0.08) * f, 0.05, 4);
      p.runCommand(`camerashake add @s ${i.toFixed(2)} ${seconds.toFixed(2)} positional`);
    } catch { /* commands unavailable: the sound carries it */ }
  }
}

export class Shockwave {
  private r = 0;
  private readonly mobs: Entity[];
  private readonly hit = new Set<string>();
  private n = 0;
  /** What is brittle in its reach, nearest first (null: the engine refused the query; the ring is sampled instead). */
  private brittle: V3[] | null;
  private next = 0;

  /** `power`: damage to a player at his feet (less further out); creatures take twice that. */
  constructor(private readonly c: Creature, private readonly center: V3, readonly reach: number, private readonly power: number) {
    const vars = new MolangVariableMap();
    vars.setFloat("variable.reach", reach);
    const at = { x: center.x, y: center.y + 0.4, z: center.z };
    particle(c.dim, "basiliskra:roar_wave", at, reach + 64, vars);
    particle(c.dim, "basiliskra:roar_ring", { x: center.x, y: center.y + 0.2, z: center.z }, reach + 64, vars);
    sound(c.dim, "basiliskra.iii.club_plant", center, reach + 48, 1, 0.62);         // the ground takes it
    this.mobs = mobsNear(c.dim, center, reach + 2);
    this.brittle = brittleAround(c.dim, center, reach);
  }

  get done(): boolean { return this.r >= this.reach; }

  /** Carry the ring one tick further out. */
  step(): void {
    if (this.done) return;
    const c = this.c, r0 = this.r, r1 = Math.min(this.reach, this.r + WAVE_SPEED);
    this.r = r1;
    this.n++;
    if (this.brittle) {
      // everything brittle the ring has now reached, a bounded number a tick
      let n = 0;
      while (this.next < this.brittle.length && n < 160) {
        const p = this.brittle[this.next];
        if (Math.hypot(p.x + 0.5 - this.center.x, p.z + 0.5 - this.center.z) >= r1) break;
        shatter(c.dim, p); this.next++; n++;
      }
    } else shatterRing(c.dim, this.center, r0, r1, clamp(Math.round((2 * Math.PI * r1) / 1.6), 12, 120), this.n);
    const reached = (loc: V3): number | null => {
      const d = distXZ(loc, this.center);
      return d >= r0 - 1.5 && d < r1 + 1.5 && Math.abs(loc.y - this.center.y) < 14 ? d : null;
    };
    for (const p of witnesses(c.dim, this.center, r1 + 16)) {
      try {
        if (this.hit.has(p.id)) continue;
        const d = reached(p.location);
        if (d === null) continue;
        this.hit.add(p.id);
        const f = 1 - d / (this.reach + 2);
        const away = norm({ x: p.location.x - this.center.x, y: 0, z: p.location.z - this.center.z });
        c.hurt(p, Math.max(1, Math.round(this.power * (0.35 + 0.65 * f))));
        p.applyKnockback({ x: (away.x || 0.01) * (0.8 + 1.6 * f), z: (away.z || 0.01) * (0.8 + 1.6 * f) }, 0.3 + 0.35 * f);
        p.runCommand(`camerashake add @s ${(0.2 + 0.4 * f).toFixed(2)} 0.35 rotational`);
      } catch { /* left */ }
    }
    for (const e of this.mobs) {
      try {
        if (!e.isValid || this.hit.has(e.id)) continue;
        const d = reached(e.location);
        if (d === null) continue;
        this.hit.add(e.id);
        const f = 1 - d / (this.reach + 2);
        const away = norm({ x: e.location.x - this.center.x, y: 0, z: e.location.z - this.center.z });
        e.applyDamage(Math.max(1, Math.round(this.power * 2 * (0.35 + 0.65 * f))), { cause: EntityDamageCause.entityAttack, damagingEntity: c.entity });
        e.applyKnockback({ x: (away.x || 0.01) * (0.8 + 1.6 * f), z: (away.z || 0.01) * (0.8 + 1.6 * f) }, 0.3 + 0.35 * f);
      } catch { /* gone */ }
    }
  }
}

/**
 * One roar's worth of shaking and shockwaves, ticked from the roar itself.  `big`: the whole roar of the last
 * change and the going home (two rings, wider); otherwise the short bellow (one ring).
 */
export class RoarFx {
  private t = 0;
  private waves: Shockwave[] = [];
  constructor(private readonly c: Creature, private readonly big: boolean, private readonly reach: number, private readonly power: number, private readonly ground = true) {}

  tick(): void {
    const c = this.c, t = this.t++;
    if (t % 10 === 0) shake(c, this.big ? 140 : 110, this.big ? 0.7 : 0.6);
    if (this.ground && (t === 14 || (this.big && t === 64))) this.waves.push(new Shockwave(c, { ...c.pos }, this.reach * (t === 64 ? 1.25 : 1), this.power));
    for (const w of this.waves) w.step();
    this.waves = this.waves.filter((w) => !w.done);
  }
}
