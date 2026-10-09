// Every action a physical input may send with `scriptevent fb:input <action>`.
// The script's input router handles exactly these (validated in tests).

import { CAMERA_ORDER } from './cameras.js';
import { LOBBY_NIGHTS } from './inputs.js';

export const NIGHT_ACTIONS = Object.freeze(['door_l', 'door_r', 'light_l', 'light_r', 'cams_toggle', 'hatch', 'strobe', 'breaker', 'reserve', 'phone', 'start_shift']);
export const CAMERA_ACTIONS = Object.freeze(CAMERA_ORDER.map((c) => `cam:${c}`));
export const LOBBY_ACTIONS = Object.freeze(['lobby:tutorial', 'lobby:continue', 'lobby:free_roam', 'lobby:settings', 'lobby:extras', 'lobby:reset', 'lobby:challenges', 'lobby:clippings', ...LOBBY_NIGHTS.map((n) => `lobby:night:${n}`)]);
export const MAINT_ACTIONS = Object.freeze(['maint:kitchen_breaker', 'maint:generator', 'maint:diner_wall', 'maint:electrical', 'maint:cam_server', 'maint:records_key']);
export const SECRET_ACTIONS = Object.freeze(Array.from({ length: 12 }, (_, i) => `secret:${String(i + 1).padStart(2, '0')}`));
export const ZONE_ACTIONS = Object.freeze(['zone:cove', 'zone:backstage', 'zone:freezer', 'zone:basement', 'zone:diner', 'zone:chamber', 'zone:attic']);
export const DEV_ACTIONS = Object.freeze(['dev:exit', 'dev:selftest', 'dev:overlay', 'dev:deterministic', 'dev:menu', 'dev:graph', 'dev:state', 'dev:puppets', 'dev:skip_hour', 'dev:reset']);

const ALL = new Set([...NIGHT_ACTIONS, ...CAMERA_ACTIONS, ...LOBBY_ACTIONS, ...MAINT_ACTIONS, ...SECRET_ACTIONS, ...ZONE_ACTIONS, ...DEV_ACTIONS]);

export function isKnownInputAction(action) {
  return ALL.has(action);
}

export const ALL_INPUT_ACTIONS = Object.freeze([...ALL]);
