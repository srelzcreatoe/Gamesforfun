// In-world physical inputs (buttons, levers, pressure plates).
//
// Every input uses the same verified wiring pattern so no command block is
// ever visible:
//   button/lever  -> on TOP of a console block (pedestal) at `p`
//   pedestal      -> strongly powered by the button/lever
//   command block -> directly UNDER the pedestal, inside the floor slab
//                    (impulse, needs redstone), runs `scriptevent fb:input <action>`
// Pressure plates sit on a floor block; their CB is one block below that.
//
// The script accepts an input only if the scriptevent's sourceBlock matches
// the registered CB location (see scripts/mc/inputs.js).

import { CAMERA_MAP_LAYOUT, CAMERA_BY_ID } from './cameras.js';

// I(id, action, kind, [x, y, z] pedestal top-of-floor position, label, extra)
const I = (id, action, kind, p, label, extra = {}) => Object.freeze({ id, action, kind, p: Object.freeze(p), label, ...extra });

const office = [
  I('in.office.door_l', 'door_l', 'button', [96, 0, 130], 'LEFT DOOR', { block: 'console_red' }),
  I('in.office.light_l', 'light_l', 'button', [97, 0, 130], 'LEFT LIGHT', { block: 'console_white' }),
  I('in.office.cams', 'cams_toggle', 'button', [98, 0, 130], 'MONITOR', { block: 'console_dark' }),
  I('in.office.hatch', 'hatch', 'button', [99, 0, 130], 'HATCH', { block: 'console_gold' }),
  I('in.office.strobe', 'strobe', 'button', [100, 0, 130], 'STROBE', { block: 'console_strobe' }),
  I('in.office.breaker', 'breaker', 'button', [101, 0, 130], 'RESET BREAKER', { block: 'console_dark' }),
  I('in.office.phone', 'phone', 'button', [102, 0, 130], 'PHONE', { block: 'console_dark' }),
  I('in.office.light_r', 'light_r', 'button', [103, 0, 130], 'RIGHT LIGHT', { block: 'console_white' }),
  I('in.office.door_r', 'door_r', 'button', [104, 0, 130], 'RIGHT DOOR', { block: 'console_red' }),
  I('in.office.reserve', 'reserve', 'lever', [97, 0, 139], 'EMERGENCY RESERVE', { block: 'console_gold' }),
  I('in.office.start', 'start_shift', 'button', [103, 0, 139], 'START / RESUME SHIFT', { block: 'console_green' }),
];

const map = Object.entries(CAMERA_MAP_LAYOUT).map(([cam, [c, r]]) =>
  I(`in.office.map_${cam.toLowerCase()}`, `cam:${cam}`, 'button', [98 + c, 0, 127 + r], CAMERA_BY_ID[cam].label, { block: 'console_map' }));

const lobby = [
  I('in.lobby.tutorial', 'lobby:tutorial', 'button', [181, 0, 104], 'TRAINING SHIFT', { block: 'console_dark' }),
  ...[1, 2, 3, 4, 5, 6].map((n) => I(`in.lobby.night_${n}`, `lobby:night:${n}`, 'button', [181, 0, 104 + n * 2], `NIGHT ${n}`, { block: 'console_dark', lamp: [184, 3, 104 + n * 2] })),
  I('in.lobby.continue', 'lobby:continue', 'button', [181, 0, 118], 'CONTINUE', { block: 'console_green' }),
  I('in.lobby.free_roam', 'lobby:free_roam', 'button', [181, 0, 120], 'FREE ROAM', { block: 'console_white' }),
  I('in.lobby.settings', 'lobby:settings', 'button', [178, 0, 122], 'SETTINGS', { block: 'console_dark' }),
  I('in.lobby.extras', 'lobby:extras', 'button', [174, 0, 122], 'ARCHIVE & CREDITS', { block: 'console_dark' }),
  I('in.lobby.reset', 'lobby:reset', 'button', [170, 0, 122], 'ERASE PROGRESS', { block: 'console_red' }),
];

const training = [
  I('in.training.begin', 'lobby:tutorial', 'button', [166, 0, 148], 'BEGIN TRAINING', { block: 'console_green' }),
];

const maintenance = [
  I('in.maint.kitchen_breaker', 'maint:kitchen_breaker', 'button', [178, 0, 47], 'KITCHEN BREAKER PANEL', { block: 'console_dark' }),
  I('in.maint.generator', 'maint:generator', 'lever', [135, -9, 92], 'GENERATOR RESTART', { block: 'console_gold' }),
  I('in.maint.diner_wall', 'maint:diner_wall', 'button', [69, -9, 80], 'SEALED WALL INSPECTION', { block: 'console_dark' }),
  I('in.maint.electrical', 'maint:electrical', 'lever', [170, -9, 92], 'BREAKER BANK B', { block: 'console_gold' }),
  I('in.maint.cam_server', 'maint:cam_server', 'button', [110, 8, 148], 'CAMERA SERVER REBOOT', { block: 'console_dark' }),
  I('in.maint.records_key', 'maint:records_key', 'button', [134, 8, 148], 'FILE CABINET F-87', { block: 'console_dark' }),
];

// Hidden lore buttons (Archive collection). Positions are chosen inside the
// room kits in build_plan.js so they sit in plausible, partially hidden spots.
const secrets = [
  I('in.secret.01', 'secret:01', 'button', [48, 0, 14], 'Parts bin', { block: 'console_hidden' }),
  I('in.secret.02', 'secret:02', 'button', [74, 0, 14], 'Spare head shelf', { block: 'console_hidden' }),
  I('in.secret.03', 'secret:03', 'button', [18, 0, 68], 'Cove backstage', { block: 'console_hidden' }),
  I('in.secret.04', 'secret:04', 'button', [182, 0, 78], 'Freezer crate', { block: 'console_hidden' }),
  I('in.secret.05', 'secret:05', 'button', [168, 0, 98], 'Restroom mirror', { block: 'console_hidden' }),
  I('in.secret.06', 'secret:06', 'button', [126, 0, 138], 'Janitor bucket', { block: 'console_hidden' }),
  I('in.secret.07', 'secret:07', 'button', [18, 8, 150], 'Attic box', { block: 'console_hidden' }),
  I('in.secret.08', 'secret:08', 'button', [146, 8, 118], "Manager's safe", { block: 'console_hidden' }),
  I('in.secret.09', 'secret:09', 'button', [118, -9, 80], 'Archive drawer', { block: 'console_hidden' }),
  I('in.secret.10', 'secret:10', 'button', [18, -9, 94], 'Diner jukebox', { block: 'console_hidden' }),
  I('in.secret.11', 'secret:11', 'button', [18, -9, 30], 'Golden shrine', { block: 'console_hidden' }),
  I('in.secret.12', 'secret:12', 'button', [118, 8, 128], 'Crawlspace note', { block: 'console_hidden' }),
];

// Exploration room triggers (stone pressure plates). Ignored during nights.
const zones = [
  I('in.zone.cove', 'zone:cove', 'plate', [30, 0, 60], 'Starlight Cove'),
  I('in.zone.backstage', 'zone:backstage', 'plate', [58, 0, 34], 'Backstage'),
  I('in.zone.freezer', 'zone:freezer', 'plate', [176, 0, 72], 'Freezer'),
  I('in.zone.basement', 'zone:basement', 'plate', [160, -9, 78], 'Basement'),
  I('in.zone.diner', 'zone:diner', 'plate', [56, -9, 88], 'Sealed diner'),
  I('in.zone.chamber', 'zone:chamber', 'plate', [24, -9, 34], "Fredbear's chamber"),
  I('in.zone.attic', 'zone:attic', 'button', [34, 8, 128], 'Attic light switch', { block: 'console_hidden' }),
];

// Developer panel in the control room.
const dev = [
  I('in.dev.exit', 'dev:exit', 'button', [26, -9, 166], 'EXIT TO LOBBY', { block: 'console_green' }),
  I('in.dev.selftest', 'dev:selftest', 'button', [28, -9, 166], 'SELF-TEST', { block: 'console_dark' }),
  I('in.dev.overlay', 'dev:overlay', 'button', [30, -9, 166], 'DEBUG OVERLAY', { block: 'console_dark' }),
  I('in.dev.deterministic', 'dev:deterministic', 'button', [32, -9, 166], 'DETERMINISTIC SEED', { block: 'console_dark' }),
  I('in.dev.menu', 'dev:menu', 'button', [34, -9, 166], 'DEBUG MENU', { block: 'console_gold' }),
  I('in.dev.graph', 'dev:graph', 'button', [36, -9, 166], 'VALIDATE ROUTES', { block: 'console_dark' }),
  I('in.dev.state', 'dev:state', 'button', [38, -9, 166], 'DUMP STATE', { block: 'console_dark' }),
  I('in.dev.puppets', 'dev:puppets', 'button', [40, -9, 166], 'RESPAWN PUPPETS', { block: 'console_dark' }),
  I('in.dev.skip_hour', 'dev:skip_hour', 'button', [42, -9, 166], 'SKIP HOUR', { block: 'console_red' }),
  I('in.dev.reset', 'dev:reset', 'button', [44, -9, 166], 'FULL RESET', { block: 'console_red' }),
];

export const INPUTS = Object.freeze([...office, ...map, ...lobby, ...training, ...maintenance, ...secrets, ...zones, ...dev]);

/** Local position of the command block for an input. */
export function inputCbPos(inp) {
  const [x, y, z] = inp.p;
  // pedestal at (x, y, z) sits on the floor; CB replaces the floor block below it.
  // plates: plate at (x, y, z) on floor block (x, y-1, z); CB one lower.
  return inp.kind === 'plate' ? [x, y - 2, z] : [x, y - 1, z];
}

/** Local position of the button/lever/plate block itself. */
export function inputControlPos(inp) {
  const [x, y, z] = inp.p;
  return inp.kind === 'plate' ? [x, y, z] : [x, y + 1, z];
}

export const INPUT_BY_ID = Object.freeze(Object.fromEntries(INPUTS.map((i) => [i.id, i])));
