// Each player's soundtrack, decided every second:
//   calm   in the Stillwater Caves or a great hall: one of five eerie tracks, then a long silence, then another
//   near   the Brinesleeper is close and has your attention (watching, stalking, coming across the water)
//   chase  it is coming for you
// Vanilla music is switched off in the biome (client biome music_definition ""), so these are the only music there.
import { world, system } from '@minecraft/server';
import { config } from './config.js';
import { inStillwater, pressure } from './areas.js';

const CALM_TICKS = 90 * 20;
const state = new Map();

function want(p, t) {
  const pr = pressure.get(p.id);
  if (pr && pr.until > t) return pr.level;
  return inStillwater(p.dimension, p.location) ? 'calm' : 'none';
}

function tick() {
  const t = system.currentTick;
  for (const p of world.getAllPlayers()) {
    let st = state.get(p.id);
    if (!st) { st = { track: 'none', until: 0 }; state.set(p.id, st); }
    const w = config.music ? want(p, t) : 'none';
    try {
      if (w === st.track) {
        if (w === 'calm' && t >= st.until) {                       // the track has ended: silence, then the next one
          if (!st.gap) st.gap = t + (15 + Math.floor(Math.random() * 40)) * 20;
          else if (t >= st.gap) { p.playMusic('music.brine.stillwater', { fade: 3, volume: 0.85 }); st.until = t + CALM_TICKS; st.gap = 0; }
        }
        continue;
      }
      if (w === 'chase') p.playMusic('music.brine.chase', { loop: true, fade: 0.4, volume: 0.95 });
      else if (w === 'near') p.playMusic('music.brine.near', { loop: true, fade: 2.5, volume: 0.9 });
      else if (w === 'calm') {
        if (st.track === 'none') { p.playMusic('music.brine.stillwater', { fade: 4, volume: 0.85 }); st.until = t + CALM_TICKS; }
        else { p.stopMusic(); st.until = t; st.gap = t + (6 + Math.floor(Math.random() * 10)) * 20; }   // after a chase: a breath of silence
      } else p.stopMusic();
      st.track = w;
    } catch (e) { /* player gone */ }
  }
}

world.beforeEvents.playerLeave.subscribe(({ player }) => { state.delete(player.id); });
world.afterEvents.worldLoad.subscribe(() => system.runInterval(tick, 20));
