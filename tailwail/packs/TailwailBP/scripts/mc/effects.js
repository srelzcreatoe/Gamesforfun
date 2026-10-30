// Optional presentation effects.  Only a short camera shake exists, and only for
// players who chose "full" effects.  Nothing persists: the shake times out by itself
// and is explicitly stopped on cleanup.
import { getPrefs } from "./store.js";

export function shake(player, intensity, seconds) {
  try {
    if (getPrefs(player).effects < 2) return;
    player.runCommand(`camerashake add @s ${intensity.toFixed(2)} ${seconds.toFixed(2)} positional`);
  } catch {
    /* command unavailable: effect is optional */
  }
}

export function stopShake(player) {
  try {
    player.runCommand("camerashake stop @s");
  } catch {
    /* nothing to stop */
  }
}

/** Per-player visual intensity (0..2) mirrored onto the entity for that viewer only. */
export function applyViewerFx(player, tw) {
  try {
    player.setPropertyOverrideForEntity(tw, "tailwail:fx", getPrefs(player).effects);
  } catch {
    /* entity gone */
  }
}
