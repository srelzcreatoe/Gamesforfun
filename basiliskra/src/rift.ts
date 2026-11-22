/**
 * The rift as it is seen and heard: a tall crimson tear with a white-hot core, lightning crawling off it,
 * rings of light running out from it and sparks streaming into it.  `at` is its foot; `size` its height.
 * (What comes through it, and when, is the controller's business.)
 */
import { Dimension, MolangVariableMap } from "@minecraft/server";
import { loud, particle, players, sound } from "./fx";
import { dist, hash, type V3 } from "./vec";

function vars(size: number): MolangVariableMap {
  const m = new MolangVariableMap();
  m.setFloat("variable.size", size);
  return m;
}

/** The moment it tears open: a flash that every screen near it shows, thunder, a burst of light. */
export function riftOpen(dim: Dimension, at: V3, size: number): void {
  const v = vars(size);
  particle(dim, "basiliskra:rift_flash", at, 200, v);
  particle(dim, "basiliskra:rift_burst", at, 160, v);
  particle(dim, "basiliskra:rift_ring", at, 200, v);
  loud(dim, "basiliskra.rift.open", at, 1, 0.85);
  loud(dim, "ambient.weather.thunder", at, 0.9, 0.6);
  for (const p of players()) {
    try {
      if (p.dimension.id !== dim.id) continue;
      const d = dist(p.location, at);
      if (d > 120) continue;
      p.camera.fade({ fadeColor: { red: 0.9, green: 0.08, blue: 0.06 }, fadeTime: { fadeInTime: 0.05, holdTime: 0.1, fadeOutTime: 0.6 } });
      p.runCommand(`camerashake add @s ${(0.5 * (1 - d / 120) + 0.1).toFixed(2)} 0.8 positional`);
    } catch { /* left, or no camera: the particles carry it */ }
  }
}

/** Once a tick while it stands open.  `power` 0..1 scales how violent it is (it swells as he comes through). */
export function riftTick(dim: Dimension, at: V3, size: number, t: number, power = 1): void {
  const v = vars(size);
  if (t % 3 === 0) particle(dim, "basiliskra:rift_tear", at, 200, v);
  if (t % 2 === 0) particle(dim, "basiliskra:rift_core", at, 200, v);
  if (t % Math.max(2, Math.round(6 - 4 * power)) === 0) particle(dim, "basiliskra:rift_arc", at, 160, v);
  if (t % 8 === 0) particle(dim, "basiliskra:rift_suck", at, 128, v);
  if (t % 22 === 0) particle(dim, "basiliskra:rift_ring", at, 200, v);
  if (t % 60 === 0) loud(dim, "basiliskra.rift.hum", at, 1, 1);
  if (t % 34 === 17 && hash(t, 5) < 0.5 + 0.4 * power) loud(dim, "basiliskra.ii.arc", { x: at.x, y: at.y + size * hash(t, 6), z: at.z }, 0.9, 0.6 + 0.3 * hash(t, 7));
}

/** It closes: the light is thrown outward, and it is gone. */
export function riftClose(dim: Dimension, at: V3, size: number): void {
  const v = vars(size);
  particle(dim, "basiliskra:rift_flash", at, 200, v);
  particle(dim, "basiliskra:rift_burst", at, 160, v);
  particle(dim, "basiliskra:rift_ring", at, 200, v);
  particle(dim, "basiliskra:seam_close", { x: at.x, y: at.y + size * 0.4, z: at.z }, 128);
  loud(dim, "basiliskra.rift.close", at, 1, 0.9);
}

/** How tall the rift stands for each form (blocks). */
export const RIFT_SIZE = [0, 14, 16, 30, 46];

export { sound };
