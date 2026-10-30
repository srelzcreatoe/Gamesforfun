// Cue playback.  Each player hears Tailwail through their own volume preference;
// creature cues are positional at its head so distance attenuation is natural, and
// presence sounds are played to ONE player only (nobody else hears your hallucinations).
import { system } from "@minecraft/server";
import { AUDIO } from "../config.js";
import { CUES, createPlayerBudget, spend } from "../core/audio_rules.js";
import { getPrefs } from "./store.js";

const budgets = new Map(); // player id -> rate budget

const HEAD_Y = { crawl: 1.0, hunch: 2.0, tall: 3.4 };

export function playCue(tw, name, posture, rng) {
  const c = CUES[name];
  if (!c || !tw.isValid) return;
  const l = tw.location;
  const at = { x: l.x, y: l.y + (HEAD_Y[posture] || 3.0), z: l.z };
  const t = system.currentTick / 20;
  let players = [];
  try {
    players = tw.dimension.getPlayers({ location: at, maxDistance: Math.min(c.range, AUDIO.hearing * 2) });
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

/** A sound only this player hears, at a location (or at the player when omitted). */
export function playFor(player, sound, location, volume = 1, pitch = 1, caption) {
  try {
    const prefs = getPrefs(player);
    if (prefs.volume <= 0.001) return;
    player.playSound(sound, { location: location || player.getHeadLocation(), volume: volume * prefs.volume, pitch });
    if (caption && prefs.captions) player.onScreenDisplay.setActionBar(`§7[${caption}]`);
  } catch {
    /* player left */
  }
}

export function forgetPlayer(id) {
  budgets.delete(id);
}
