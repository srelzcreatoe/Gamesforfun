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
  fogPush: [1, 2, 3, 4, 5, 6].map((n) => `fog @a push fb:night_${n} fb_night`),
  fogPop: ['fog @a remove fb_night'],
  hudCams: ['hud @a hide paperdoll', 'hud @a hide armor', 'hud @a hide health', 'hud @a hide hunger', 'hud @a hide status_effects'],
  hudReset: ['hud @a reset'],
});

/** Fog id per night (resource pack fogs/*.json). */
export const fogCommand = (night) => `fog @a push fb:night_${Math.max(1, Math.min(6, night))} fb_night`;
