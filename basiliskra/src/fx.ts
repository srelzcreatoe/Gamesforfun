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

/** Sounds of his that stay small: instruments, things in a hand, a breath at a window pane. */
const QUIET = /^basiliskra\.(geiger|fin_pulse|boat_knock|splash|bell_pin|scrape_far|iii\.window_breath|music)/;
const NEAR = 40, FAR = 220;

export function sound(dim: Dimension, id: string, at: V3, range = 48, volume = 1, pitch = 1): void {
  // everything he does is heard a long way off: his steps, his voice, his breath, the rift
  if (id.startsWith("basiliskra.") && !QUIET.test(id)) { loud(dim, id, at, volume, pitch); return; }
  for (const p of witnesses(dim, at, range)) {
    try { p.playSound(id, { location: at, volume, pitch }); } catch { /* gone */ }
  }
}

/**
 * A sound that carries 200 blocks and more.  Near it, it comes from where it is.  Further off the game would
 * not play it at all, so each distant listener is sent it from a point ten blocks away in its direction,
 * quieter the further off it really is: it still has a direction, and it still fades with distance.
 */
export function loud(dim: Dimension, id: string, at: V3, volume = 1, pitch = 1, far = FAR): void {
  for (const p of playerCache) {
    try {
      if (!p.isValid || p.dimension.id !== dim.id) continue;
      const l = p.location, d = dist(l, at);
      if (d > far) continue;
      if (d <= NEAR) { p.playSound(id, { location: at, volume, pitch }); continue; }
      const k = 10 / d;
      const from = { x: l.x + (at.x - l.x) * k, y: l.y + 1.6 + (at.y - l.y) * k, z: l.z + (at.z - l.z) * k };
      const v = volume * (1 - 0.8 * Math.pow((d - NEAR) / (far - NEAR), 0.8));
      p.playSound(id, { location: from, volume: v, pitch });
    } catch { /* gone */ }
  }
}

/** Cut a sound short for everyone who could be hearing it (a charge that is grounded, an encounter cut off). */
export function stopSound(dim: Dimension, id: string, at: V3, range = 192): void {
  for (const p of witnesses(dim, at, range)) {
    try { p.runCommand(`stopsound @s ${id}`); } catch { /* commands unavailable: it plays out */ }
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

/** Every screen within `range` of a place flashes a colour for an instant (nearer is no brighter: it is a flash). */
export function flash(dim: Dimension, at: V3, range: number, color: { red: number; green: number; blue: number }, fadeIn = 0.05, hold = 0.1, fadeOut = 0.5): void {
  for (const p of players()) {
    try {
      if (p.dimension.id !== dim.id || dist(p.location, at) > range) continue;
      p.camera.fade({ fadeColor: color, fadeTime: { fadeInTime: fadeIn, holdTime: hold, fadeOutTime: fadeOut } });
    } catch { /* left, or no camera */ }
  }
}
