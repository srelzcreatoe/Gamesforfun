// Every command string the script issues with runCommand, kept in one place
// so tools/validate_commands.mjs can check them against the 1.26.50 grammar.

import { TICKING_AREAS } from '../data/layout.js';

export const COMMAND_TEMPLATES = Object.freeze({
  tickingAreas: TICKING_AREAS.map((t) => `tickingarea add ${t.from.join(' ')} ${t.to.join(' ')} ${t.name} true`),
  tickingAreasRemove: TICKING_AREAS.map((t) => `tickingarea remove ${t.name}`),
  essentials: [
    'gamerule commandblocksenabled true',
    'gamerule commandblockoutput false',
    'gamerule sendcommandfeedback false',
    'gamerule dodaylightcycle false',
    'gamerule domobspawning false',
    'gamerule doweathercycle false',
    'time set 18000',
    'weather clear',
  ],
  stopSounds: ['stopsound @a'],
  fogPush: [1, 2, 3, 4, 5, 6, 7].map((n) => `fog @a push fb:night_${n} fb_night`),
  fogPop: ['fog @a remove fb_night'],
  // Clear "camera feed" fog on top of the night fog while the monitor is up (RP fogs/fb_camera_feed.json).
  camFogPush: ['fog @a push fb:camera_feed fb_cam'],
  camFogPop: ['fog @a remove fb_cam'],
  // Cutscenes: warm sepia memory (night 4 flashback) and the orange smoke of the burn ending.
  sceneFogFlashback: ['fog @a push fb:flashback fb_scene'],
  sceneFogFire: ['fog @a push fb:ending_fire fb_scene'],
  sceneFogPop: ['fog @a remove fb_scene'],
  sunrise: ['time set 23500'],
  hudCams: ['hud @a hide paperdoll', 'hud @a hide armor', 'hud @a hide health', 'hud @a hide hunger', 'hud @a hide status_effects'],
  hudReset: ['hud @a reset'],
});

/** Fog id per night (resource pack fogs/*.json). */
export const fogCommand = (night) => `fog @a push fb:night_${Math.max(1, Math.min(7, night))} fb_night`;
