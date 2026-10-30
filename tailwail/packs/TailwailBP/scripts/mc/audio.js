// Cue playback.  Each player hears Tailwail through their own volume preference;
// sounds are positional at the creature's head so distance attenuation is natural.
import { system } from "@minecraft/server";
import { AUDIO } from "../config.js";
import { CUES, createPlayerBudget, spend } from "../core/audio_rules.js";
import { getPrefs } from "./store.js";

const budgets = new Map(); // player id -> rate budget

export function playCue(tw, name, posture, rng) {
  const c = CUES[name];
  if (!c || !tw.isValid) return;
  const l = tw.location;
  const at = { x: l.x, y: l.y + (posture === "crawl" ? 1.0 : posture === "hunch" ? 2.0 : 3.2), z: l.z };
  const t = system.currentTick / 20;
  let players = [];
  try {
    players = tw.dimension.getPlayers({ location: at, maxDistance: Math.min(c.range, AUDIO.hearing) });
  } catch {
    return;
  }
  for (const p of players) {
    const prefs = getPrefs(p);
    if (prefs.volume <= 0.001) continue;
    let b = budgets.get(p.id);
    if (!b) budgets.set(p.id, (b = createPlayerBudget(AUDIO.perPlayerPerSecond)));
    if (!spend(b, t)) continue;
    try {
      p.playSound(c.sound, { location: at, volume: c.volume * prefs.volume, pitch: 0.94 + (rng ? rng.next() : 0.5) * 0.12 });
      if (prefs.captions && c.caption) p.onScreenDisplay.setActionBar(`§7[${c.caption}]`);
    } catch {
      /* player left this tick */
    }
  }
}

export function forgetPlayer(id) {
  budgets.delete(id);
}
