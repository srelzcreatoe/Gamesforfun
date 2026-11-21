/**
 * In-game settings (the config wheel).  Saved as one world dynamic property over the defaults in config.ts,
 * so a world keeps its choices across reloads and pack updates.  Anything unknown or out of range is ignored.
 */
import { world } from "@minecraft/server";
import { CONFIG, SETTINGS, SETTINGS_KEY } from "./config";

type Cfg = typeof CONFIG;
const DEFAULTS: Cfg = { ...CONFIG };

function clean(k: string, v: unknown): unknown {
  switch (k) {
    case "pacing": return typeof v === "number" && v >= 0.25 && v <= 4 ? v : undefined;
    case "damage": return typeof v === "number" && v >= 0 && v <= 4 ? v : undefined;
    case "terrain": return v === "none" || v === "scorch" || v === "break" ? v : undefined;
    case "spawnForm": return v === 0 || v === 1 || v === 2 || v === 3 ? v : undefined;
    default: return typeof v === "boolean" ? v : undefined;
  }
}

export function loadSettings(): void {
  let raw: unknown;
  try { raw = world.getDynamicProperty(SETTINGS_KEY); } catch { raw = undefined; }
  if (typeof raw !== "string") return;
  let saved: Record<string, unknown>;
  try { saved = JSON.parse(raw); } catch { return; }
  for (const k of SETTINGS) {
    const v = clean(k, saved[k]);
    if (v !== undefined) (CONFIG as Record<string, unknown>)[k] = v;
  }
}

export function saveSettings(change: Partial<Cfg>): void {
  for (const [k, v] of Object.entries(change)) {
    if (!(SETTINGS as readonly string[]).includes(k)) continue;
    const c = clean(k, v);
    if (c !== undefined) (CONFIG as Record<string, unknown>)[k] = c;
  }
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS) out[k] = CONFIG[k];
  try { world.setDynamicProperty(SETTINGS_KEY, JSON.stringify(out)); } catch { /* closing */ }
}

export function resetSettings(): void {
  for (const k of SETTINGS) (CONFIG as Record<string, unknown>)[k] = DEFAULTS[k];
  try { world.setDynamicProperty(SETTINGS_KEY, undefined); } catch { /* closing */ }
}
