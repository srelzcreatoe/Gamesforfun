/**
 * Encounters are written as generators: one `yield` is one tick.  Every way out of an
 * encounter -- finishing, timing out, being pre-empted, the chunk unloading -- goes through the
 * same `finish()`, and every encounter has a time limit.
 */
import { Player, system } from "@minecraft/server";
import { CONFIG, TICKS } from "./config";
import { Creature, targetable } from "./creature";
import { players } from "./fx";
import { store, type Rec } from "./store";
import { dist, distXZ, type V3 } from "./vec";

export type Act = Generator<void, void, void>;
export interface Choice { name: string; run: Act; limit: number }

export function* wait(ticks: number): Generator<void, void, void> {
  for (let i = 0; i < ticks; i++) yield;
}

/** Walk / swim to a point.  Returns false if he could not get there. */
export function* travel(c: Creature, target: V3, speed: number, arrive = 2, timeout = 600): Generator<void, boolean, void> {
  c.goTo(target, speed, arrive);
  let t = 0;
  while (!c.arrived()) {
    if (++t > timeout) { c.halt(); return false; }
    if (c.blocked > 50) { c.halt(); return false; }      // never loop on an unreachable goal
    yield;
  }
  c.halt();
  return true;
}

export const pace = (ticks: number): number => Math.max(1, Math.round(ticks / CONFIG.pacing));
export const isNight = (tod: number): boolean => tod >= 13000 && tod < 23000;   // from the clock, never from the sky
export const isDusk = (tod: number): boolean => tod >= 11800 && tod < 13800;

export function nearbyPlayers(c: Creature, range: number): Player[] {
  const out: Player[] = [];
  for (const p of players()) {
    try { if (p.dimension.id === c.dim.id && targetable(p) && dist(p.location, c.pos) <= range) out.push(p); } catch { /* left */ }
  }
  out.sort((a, b) => dist(a.location, c.pos) - dist(b.location, c.pos));
  return out;
}

export function anyoneNear(c: Creature, range: number): boolean {
  for (const p of players()) {
    try { if (p.dimension.id === c.dim.id && dist(p.location, c.pos) <= range) return true; } catch { /* left */ }
  }
  return false;
}

export abstract class Brain {
  protected act: Act | null = null;
  actName = "none";
  protected actTicks = 0;
  protected actLimit = 0;
  protected cooldown = new Map<string, number>();
  /** Set by the controller: a forced encounter for tests and scripted scenes. */
  forced: Choice | null = null;
  hurtAt = -9999;

  constructor(readonly c: Creature) {}
  get rec(): Rec { return store.rec; }
  get now(): number { return store.rec.clock; }

  ready(key: string): boolean { return (this.cooldown.get(key) ?? -1e9) <= this.now; }
  rest(key: string, ticks: number): void { this.cooldown.set(key, this.now + pace(ticks)); }

  /** Choose the next encounter: the first candidate that can happen here, right now. */
  protected abstract choose(): Choice | null;
  /** Something that should not wait for the current encounter to end. */
  protected interrupt(): Choice | null { return null; }

  begin(ch: Choice): void {
    this.finish();
    this.act = ch.run; this.actName = ch.name; this.actTicks = 0; this.actLimit = ch.limit;
  }

  /** The single exit for every encounter. */
  finish(): void {
    if (this.act) { try { this.act.return(); } catch { /* generator cleanup threw */ } }
    this.act = null; this.actName = "none";
    const c = this.c;
    c.halt();
    c.lookAhead();
    c.bendHold = 0;
    c.pitch = 0;
    if (c.charge > 0) c.setCharge(0);
    if (c.phase !== "idle") c.setPhase("idle");
    this.onFinish();
  }
  protected onFinish(): void { /* per form */ }

  tick(): void {
    if (this.forced) { const f = this.forced; this.forced = null; this.begin(f); }
    const pre = this.interrupt();
    if (pre) this.begin(pre);
    if (!this.act) {
      const ch = this.choose();
      if (ch) this.begin(ch);
    }
    if (!this.act) return;
    this.actTicks++;
    let done = false;
    try { done = this.act.next().done === true; } catch (e) { done = true; if (CONFIG.debug) console.warn(`[basiliskra] ${this.actName}: ${e}`); }
    if (done || this.actTicks > this.actLimit) this.finish();
  }

  onHurt(_by: Player | undefined): void { this.hurtAt = this.now; }
  onSplash(_at: V3, _by: Player | undefined): void { /* per form */ }
  onBell(_at: V3, _by: Player): void { /* per form */ }
  onNote(_at: V3): void { /* per form */ }
}
