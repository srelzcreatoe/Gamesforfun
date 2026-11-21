/**
 * Sound and particles go only to the players who could witness them, never to the whole
 * dimension, and under a per-tick budget.
 */
import { Dimension, MolangVariableMap, Player, world } from "@minecraft/server";
import { dist, type V3 } from "./vec";
import { isLoaded } from "./world";

const PARTICLE_BUDGET = 96;     // particle packets per tick, all effects together
let spent = 0;
let playerCache: Player[] = [];
let cacheTick = -1;

export function beginTick(tick: number): void {
  spent = 0;
  if (tick !== cacheTick) { playerCache = world.getAllPlayers(); cacheTick = tick; }
}

export function players(): Player[] { return playerCache; }

export function witnesses(dim: Dimension, at: V3, range: number): Player[] {
  const out: Player[] = [];
  for (const p of playerCache) {
    try { if (p.isValid && p.dimension.id === dim.id && dist(p.location, at) <= range) out.push(p); } catch { /* left */ }
  }
  return out;
}

export function sound(dim: Dimension, id: string, at: V3, range = 48, volume = 1, pitch = 1): void {
  for (const p of witnesses(dim, at, range)) {
    try { p.playSound(id, { location: at, volume, pitch }); } catch { /* gone */ }
  }
}

export function particle(dim: Dimension, id: string, at: V3, range = 48, vars?: MolangVariableMap): void {
  if (!isLoaded(dim, at)) return;
  for (const p of witnesses(dim, at, range)) {
    if (spent >= PARTICLE_BUDGET) return;
    spent++;
    try { p.spawnParticle(id, at, vars); } catch { /* out of range for that client */ }
  }
}

export function beamVars(dir: V3, length: number, width: number, r = 1, g = 0.1, b = 0.1): MolangVariableMap {
  const m = new MolangVariableMap();
  m.setFloat("variable.len", length);
  m.setFloat("variable.width", width);
  m.setVector3("variable.dir", dir);
  m.setColorRGB("variable.tint", { red: r, green: g, blue: b });
  return m;
}

export function sizeVars(size: number): MolangVariableMap {
  const m = new MolangVariableMap();
  m.setFloat("variable.size", size);
  return m;
}
