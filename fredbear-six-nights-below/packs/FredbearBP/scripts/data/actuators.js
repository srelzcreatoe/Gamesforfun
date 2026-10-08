// Command-block actuator modules (the control room under the parking lot).
//
// OWNERSHIP: command blocks own PHYSICAL actuation (blocks, light blocks,
// scripted sound sequences, camera shakes). They never decide anything: the
// night director (script) decides and triggers a module by placing a
// redstone block on its pad. The module's first chain block clears the pad.
//
// MODULE LAYOUT (all facing east, +X):
//   pad (x0)  -> impulse CB (x0+1, Needs Redstone, unconditional)
//             -> chain CBs (x0+2 ..., Always Active, unconditional unless noted)
// Rows run west->east at y = -9 (local) inside the CONTROL room; a wall sign
// north of each impulse block names the module.
//
// Commands use WORLD coordinates (local + ORIGIN). No /execute is used, so
// the command-block command version cannot change command semantics.

import { ORIGIN } from './layout.js';

const W = (x, y, z) => `${x + ORIGIN.x} ${y + ORIGIN.y} ${z + ORIGIN.z}`;
const BOX = (x1, y1, z1, x2, y2, z2) => `${W(x1, y1, z1)} ${W(x2, y2, z2)}`;
const SND = (id, x, y, z, vol = 1, pitch = 1) => `playsound ${id} @a ${W(x, y, z)} ${vol} ${pitch}`;

// Office geometry (local)
const DOOR_L = BOX(94, 0, 129, 94, 2, 130);
const DOOR_R = BOX(106, 0, 129, 106, 2, 130);
const ALCOVE_L = BOX(91, 0, 127, 93, 3, 133);
const ALCOVE_R = BOX(107, 0, 127, 109, 3, 133);
const HATCH = BOX(99, -1, 136, 100, -1, 137);
const HATCH_CAP = BOX(99, 0, 136, 100, 1, 137);
const OFFICE_AIR = BOX(95, 0, 127, 105, 5, 139);
const IND = { doorL: W(94, 3, 129), lightL: W(94, 3, 130), doorR: W(106, 3, 129), lightR: W(106, 3, 130), hatch: W(99, 3, 140), hatch2: W(100, 3, 140), breaker: W(101, 3, 140) };
const OFFICE_LAMP_A = W(100, 5, 135);
const OFFICE_LAMP_B = W(100, 5, 129);
const TRAPDOOR = (open) => `iron_trapdoor ["direction"=0,"open_bit"=${open},"upside_down_bit"=true]`;

const M = (id, section, purpose, cmds, extra = {}) => Object.freeze({
  id, section, purpose,
  cmds: Object.freeze(cmds.map((c) => Object.freeze(typeof c === 'string' ? { c } : c))),
  ...extra,
});
const D = (c, delay) => ({ c, delay }); // chain command with tick delay

export const SECTIONS = Object.freeze({
  A: 'Setup & initialisation',
  B: 'Lobby & tutorial',
  C: 'Night controls',
  D: 'Office doors, lights & hatch',
  E: 'Camera controls',
  F: 'Power & emergency systems',
  G: 'Room triggers (exploration events)',
  H: 'Animatronic signals',
  I: 'Environmental events',
  J: 'Jumpscare coordination',
  K: 'Win & lose transitions',
  L: 'Reset & diagnostics',
});

const meterSegments = Array.from({ length: 10 }, (_, k) => 96 + k);

export const MODULES = Object.freeze([
  // ---------------------------------------------------------------- A setup
  M('init.policy', 'A', 'World policy (re-applied on every return to the lobby)', [
    'gamerule commandblockoutput false', 'gamerule sendcommandfeedback false', 'gamerule dodaylightcycle false',
    'gamerule doweathercycle false', 'gamerule domobspawning false', 'gamerule keepinventory true',
    'gamerule doimmediaterespawn true', 'gamerule showdeathmessages false', 'gamerule mobgriefing false',
    'gamerule falldamage false', 'gamerule dotiledrops false', 'gamerule pvp false',
  ]),
  M('init.time', 'A', 'Midnight, clear sky', ['time set 18000', 'weather clear', 'difficulty normal']),
  // ---------------------------------------------------------------- B lobby & tutorial
  ...[1, 2, 3, 4, 5, 6].map((n) => M(`lobby.lamp_${n}`, 'B', `Time-clock lamp: night ${n} unlocked`, [`setblock ${W(184, 3, 104 + n * 2)} verdant_froglight`])),
  M('lobby.lamps_reset', 'B', 'Time-clock lamps: all locked', [`fill ${BOX(184, 3, 106, 184, 3, 116)} gray_concrete`]),
  M('lobby.accept', 'B', 'Lobby choice accepted', [SND('fb.ui.accept', 180, 1, 112)]),
  M('lobby.deny', 'B', 'Lobby choice denied (locked)', [SND('fb.ui.deny', 180, 1, 112)]),
  ...[['door_l', 96], ['light_l', 97], ['cams', 98], ['strobe', 100], ['hatch', 99]].map(([k, x]) => M(`tut.hl_${k}`, 'B', `Training: highlight the ${k} console`, [
    `particle minecraft:villager_happy ${W(x, 1.5, 130)}`, SND('fb.ui.blip', x, 1, 130),
  ])),
  // ---------------------------------------------------------------- C night
  M('night.begin', 'C', 'Start of shift: seal doorways with barriers, office lights on', [
    `fill ${DOOR_L} barrier`, `fill ${DOOR_R} barrier`, `fill ${HATCH_CAP} barrier`, `fill ${HATCH} ${TRAPDOOR(false)}`,
    `setblock ${OFFICE_LAMP_A} light_block_11`, `setblock ${OFFICE_LAMP_B} light_block_10`,
    `setblock ${IND.doorL} verdant_froglight`, `setblock ${IND.doorR} verdant_froglight`, `setblock ${IND.lightL} gray_concrete`,
    `setblock ${IND.lightR} gray_concrete`, `setblock ${IND.hatch} gray_concrete`, `setblock ${IND.breaker} verdant_froglight`,
    `fill ${BOX(96, 4, 126, 105, 4, 126)} verdant_froglight`, `fill ${BOX(97, 5, 126, 102, 5, 126)} gray_concrete`,
    SND('fb.night.start', 100, 1, 133),
  ]),
  M('night.end', 'C', 'End of shift: open doorways, clear light blocks, stop sounds', [
    `fill ${DOOR_L} air`, `fill ${DOOR_R} air`, `fill ${HATCH_CAP} air`, `fill ${HATCH} ${TRAPDOOR(false)}`,
    `fill ${ALCOVE_L} air replace light_block_14`, `fill ${ALCOVE_R} air replace light_block_14`,
    `fill ${ALCOVE_L} air replace light_block_7`, `fill ${ALCOVE_R} air replace light_block_7`,
    `fill ${OFFICE_AIR} air replace light_block_15`, `setblock ${OFFICE_LAMP_A} light_block_11`, `setblock ${OFFICE_LAMP_B} light_block_10`,
    'stopsound @a', 'camerashake stop @a',
  ]),
  M('night.hour', 'C', 'Hour chime', [SND('fb.clock.hour', 100, 3, 133, 0.6)]),
  ...[0, 1, 2, 3, 4, 5].map((h) => M(`night.hour_${h}`, 'C', `Office clock lamp for ${h === 0 ? 12 : h} AM lights (night.begin clears the strip)`, [
    `setblock ${W(97 + h, 5, 126)} ochre_froglight`,
  ])),
  M('night.maint_begin', 'C', 'Maintenance: unlock the office, alarm', [
    `fill ${DOOR_L} air`, `fill ${DOOR_R} air`, SND('fb.power.alarm', 100, 2, 133), D(SND('fb.power.alarm', 100, 2, 133), 30),
  ]),
  M('night.maint_end', 'C', 'Maintenance over: re-seal the office', [`fill ${DOOR_L} barrier`, `fill ${DOOR_R} barrier`, SND('fb.power.reserve', 100, 2, 133)]),
  // ---------------------------------------------------------------- D office
  M('door_l_close', 'D', 'Left door closes', [`fill ${DOOR_L} iron_block`, SND('fb.door.close', 94, 1, 129.5), `setblock ${IND.doorL} ochre_froglight`]),
  M('door_l_open', 'D', 'Left door opens (barrier keeps the guard inside)', [`fill ${DOOR_L} barrier`, SND('fb.door.open', 94, 1, 129.5), `setblock ${IND.doorL} verdant_froglight`]),
  M('door_r_close', 'D', 'Right door closes', [`fill ${DOOR_R} iron_block`, SND('fb.door.close', 106, 1, 129.5), `setblock ${IND.doorR} ochre_froglight`]),
  M('door_r_open', 'D', 'Right door opens', [`fill ${DOOR_R} barrier`, SND('fb.door.open', 106, 1, 129.5), `setblock ${IND.doorR} verdant_froglight`]),
  M('light_l_on', 'D', 'Left hall light on', [`fill ${ALCOVE_L} light_block_14 replace air`, `setblock ${IND.lightL} verdant_froglight`, SND('fb.light.buzz', 92, 3, 130)]),
  M('light_l_off', 'D', 'Left hall light off', [`fill ${ALCOVE_L} air replace light_block_14`, `setblock ${IND.lightL} gray_concrete`]),
  M('light_r_on', 'D', 'Right hall light on', [`fill ${ALCOVE_R} light_block_14 replace air`, `setblock ${IND.lightR} verdant_froglight`, SND('fb.light.buzz', 108, 3, 130)]),
  M('light_r_off', 'D', 'Right hall light off', [`fill ${ALCOVE_R} air replace light_block_14`, `setblock ${IND.lightR} gray_concrete`]),
  M('hatch_close', 'D', 'Office hatch sealed', [`fill ${HATCH} ${TRAPDOOR(false)}`, `setblock ${IND.hatch} ochre_froglight`, SND('fb.door.close', 99.5, 0, 136.5, 0.8, 0.8)]),
  M('hatch_open', 'D', 'Office hatch opened', [`fill ${HATCH} ${TRAPDOOR(true)}`, `setblock ${IND.hatch} gray_concrete`, SND('fb.door.open', 99.5, 0, 136.5, 0.8, 0.8)]),
  // ---------------------------------------------------------------- E cameras
  M('cam.up', 'E', 'Monitor raised (office sound)', [SND('fb.cam.up', 98, 1, 130)]),
  M('cam.down', 'E', 'Monitor lowered', [SND('fb.cam.down', 98, 1, 130)]),
  M('cam.server_fault', 'E', 'Camera server sparks (upper floor) during disruption', [
    `particle minecraft:electric_spark_particle ${W(110, 9.5, 141)}`, SND('fb.breaker.trip', 110, 9, 141, 0.7),
    D(`particle minecraft:electric_spark_particle ${W(113, 9.5, 141)}`, 8),
  ]),
  // ---------------------------------------------------------------- F power
  M('pwr.out', 'F', 'Power out: office lights die, indicators dark', [
    `setblock ${OFFICE_LAMP_A} air`, `setblock ${OFFICE_LAMP_B} air`, `fill ${BOX(96, 4, 126, 105, 4, 126)} gray_concrete`,
    `setblock ${IND.doorL} gray_concrete`, `setblock ${IND.doorR} gray_concrete`, `setblock ${IND.lightL} gray_concrete`,
    `setblock ${IND.lightR} gray_concrete`, `setblock ${IND.breaker} red_concrete`, SND('fb.power.down', 100, 2, 133),
  ]),
  M('pwr.dark', 'F', 'Power out: final darkness', [SND('fb.power.dark', 100, 2, 133), 'camerashake add @a 0.15 2 rotational']),
  M('pwr.reserve', 'F', 'Emergency reserve engaged: lights back', [
    `setblock ${OFFICE_LAMP_A} light_block_11`, `setblock ${OFFICE_LAMP_B} light_block_10`, `setblock ${IND.breaker} verdant_froglight`,
    `setblock ${IND.doorL} verdant_froglight`, `setblock ${IND.doorR} verdant_froglight`, SND('fb.power.reserve', 100, 2, 133),
  ]),
  M('pwr.strobe', 'F', 'Emergency strobe flash (office + entries)', [
    `fill ${OFFICE_AIR} light_block_15 replace air`, `fill ${ALCOVE_L} light_block_15 replace air`, `fill ${ALCOVE_R} light_block_15 replace air`,
    SND('fb.strobe.fire', 100, 2, 133), 'camerashake add @a 0.4 0.4 rotational',
    D(`fill ${OFFICE_AIR} air replace light_block_15`, 4), `fill ${ALCOVE_L} air replace light_block_15`, `fill ${ALCOVE_R} air replace light_block_15`,
  ]),
  M('pwr.breaker_trip', 'F', "Chica's sabotage: kitchen breaker trips", [
    `particle minecraft:electric_spark_particle ${W(178, 2, 47)}`, SND('fb.breaker.trip', 178, 1, 47), SND('fb.breaker.trip', 100, 2, 133, 0.5),
    `setblock ${IND.breaker} red_concrete`, `setblock ${IND.lightL} red_concrete`, `setblock ${IND.lightR} red_concrete`,
  ]),
  M('pwr.breaker_reset', 'F', 'Breaker reset in progress', [`setblock ${IND.breaker} ochre_froglight`, SND('fb.breaker.reset', 101, 1, 130)]),
  M('pwr.breaker_ok', 'F', 'Breaker restored', [
    `setblock ${IND.breaker} verdant_froglight`, `setblock ${IND.lightL} gray_concrete`, `setblock ${IND.lightR} gray_concrete`, SND('fb.ui.accept', 101, 1, 130),
  ]),
  ...meterSegments.map((x, k) => M(`pwr.meter_${k + 1}`, 'F', `Power meter: segment ${k + 1} (${(k + 1) * 10}%) goes dark`, [`setblock ${W(x, 4, 126)} gray_concrete`])),
  M('pwr.meter_full', 'F', 'Power meter: all segments lit', [`fill ${BOX(96, 4, 126, 105, 4, 126)} verdant_froglight`]),
  ...[0, 1, 2, 3, 4].map((n) => M(`pwr.charges_${n}`, 'F', `Strobe charge lamps: ${n}${n === 4 ? '+' : ''}`, [
    `fill ${BOX(102, 3, 140, 105, 3, 140)} gray_concrete`,
    ...(n > 0 ? [`fill ${BOX(102, 3, 140, 101 + n, 3, 140)} pearlescent_froglight`] : []),
  ])),
  // ---------------------------------------------------------------- G room triggers
  M('zone.cove', 'G', 'Exploration: Starlight Cove curtain shiver', [
    `fill ${BOX(28, 0, 54, 28, 2, 57)} purple_wool`, SND('fb.amb.creak', 28, 1, 56), D(`fill ${BOX(28, 0, 54, 28, 2, 57)} air`, 12),
  ]),
  M('zone.freezer', 'G', 'Exploration: freezer knock', [SND('fb.door.bang', 183, 1, 72, 0.6), D(SND('fb.door.bang', 183, 1, 72, 0.6), 14)]),
  M('zone.diner', 'G', 'Exploration: diner jukebox wakes', [SND('fb.fredbear.musicbox', 18, -8, 94, 0.6), `particle minecraft:note_particle ${W(18, -7.5, 94)}`]),
  M('zone.chamber', 'G', 'Exploration: golden shrine glows', [`particle minecraft:totem_particle ${W(34.5, -8, 36.5)}`, SND('fb.fredbear.chime', 34, -8, 36)]),
  M('zone.attic', 'G', 'Exploration: footsteps above the attic', [SND('fb.step.fredbear', 30, 13, 128, 0.7), D(SND('fb.step.fredbear', 36, 13, 128, 0.7), 12)]),
  // ---------------------------------------------------------------- H animatronic signals
  M('sig.fredbear_glow_l', 'H', 'Fredbear telegraph: golden glow at the left door', [`fill ${ALCOVE_L} light_block_7 replace air`, `particle minecraft:totem_particle ${W(92.5, 1.5, 130)}`]),
  M('sig.fredbear_glow_r', 'H', 'Fredbear telegraph: golden glow at the right door', [`fill ${ALCOVE_R} light_block_7 replace air`, `particle minecraft:totem_particle ${W(107.5, 1.5, 130)}`]),
  M('sig.fredbear_glow_h', 'H', 'Fredbear telegraph: golden glow under the hatch', [`particle minecraft:totem_particle ${W(100, 0.5, 137)}`, D(`particle minecraft:totem_particle ${W(100, 0.5, 137)}`, 10)]),
  M('sig.fredbear_glow_off', 'H', 'Fredbear glow cleared', [`fill ${ALCOVE_L} air replace light_block_7`, `fill ${ALCOVE_R} air replace light_block_7`]),
  M('sig.strain_l', 'H', 'Fredbear forcing the left door', [SND('fb.door.bang', 94, 1, 129.5), 'camerashake add @a 0.25 2 positional', `setblock ${IND.doorL} red_concrete`]),
  M('sig.strain_r', 'H', 'Fredbear forcing the right door', [SND('fb.door.bang', 106, 1, 129.5), 'camerashake add @a 0.25 2 positional', `setblock ${IND.doorR} red_concrete`]),
  M('sig.strain_h', 'H', 'Fredbear forcing the hatch', [SND('fb.door.bang', 99.5, 0, 136.5), 'camerashake add @a 0.25 2 positional', `setblock ${IND.hatch2} red_concrete`]),
  M('sig.jam_l', 'H', 'Left door jammed open (barrier keeps the guard inside)', [`fill ${DOOR_L} barrier`, `setblock ${IND.doorL} red_concrete`, SND('fb.door.jam', 94, 1, 129.5)]),
  M('sig.jam_r', 'H', 'Right door jammed open (barrier keeps the guard inside)', [`fill ${DOOR_R} barrier`, `setblock ${IND.doorR} red_concrete`, SND('fb.door.jam', 106, 1, 129.5)]),
  M('sig.jam_h', 'H', 'Hatch jammed open', [`fill ${HATCH} ${TRAPDOOR(true)}`, `setblock ${IND.hatch2} red_concrete`, SND('fb.door.jam', 99.5, 0, 136.5)]),
  M('sig.unjam_l', 'H', 'Left door released', [`fill ${DOOR_L} barrier`, `setblock ${IND.doorL} verdant_froglight`]),
  M('sig.unjam_r', 'H', 'Right door released', [`fill ${DOOR_R} barrier`, `setblock ${IND.doorR} verdant_froglight`]),
  M('sig.unjam_h', 'H', 'Hatch released', [`setblock ${IND.hatch2} gray_concrete`]),
  M('sig.blackout_on', 'H', 'Fredbear blackout: office lights out', [`setblock ${OFFICE_LAMP_A} air`, `setblock ${OFFICE_LAMP_B} air`, SND('fb.power.dark', 100, 2, 133, 0.8)]),
  M('sig.blackout_off', 'H', 'Blackout over', [`setblock ${OFFICE_LAMP_A} light_block_11`, `setblock ${OFFICE_LAMP_B} light_block_10`, SND('fb.light.buzz', 100, 4, 133)]),
  M('sig.finale', 'H', 'Night 6 Golden Hour begins', [SND('fb.fredbear.finale', 100, 2, 133), 'camerashake add @a 0.2 3 rotational', `particle minecraft:totem_particle ${W(100, 1, 133)}`]),
  M('sig.diner_unseal', 'H', 'The bricked diner entrance is broken open', [`fill ${BOX(64, -9, 84, 64, -7, 86)} air`, SND('fb.door.bang', 64, -8, 85)]),
  M('sig.diner_seal', 'H', 'Diner entrance bricked up (baseline)', [`fill ${BOX(64, -9, 84, 64, -7, 86)} brick_block`]),
  M('sig.chamber_open', 'H', "Fredbear's chamber wall opens", [`fill ${BOX(33, -9, 44, 35, -6, 44)} air`]),
  M('sig.chamber_close', 'H', "Fredbear's chamber wall sealed (baseline)", [`fill ${BOX(33, -9, 44, 35, -6, 44)} cracked_stone_bricks`]),
  M('sig.stage_lights_off', 'H', 'Show stage spotlights off for the night', [`fill ${BOX(82, 6, 14, 118, 6, 30)} air replace light_block_9`]),
  M('sig.stage_lights_on', 'H', 'Show stage spotlights on (lobby / free roam)', [
    `setblock ${W(100, 6, 22)} light_block_9`, `setblock ${W(93, 6, 23)} light_block_9`, `setblock ${W(107, 6, 23)} light_block_9`,
  ]),
  // ---------------------------------------------------------------- I environment
  M('env.flicker_whall', 'I', 'West hall lights flicker', [
    `fill ${BOX(85, 5, 101, 89, 5, 133)} light_block_9 replace light_block_1`, D(`fill ${BOX(85, 5, 101, 89, 5, 133)} light_block_1 replace light_block_9`, 3),
    D(`fill ${BOX(85, 5, 101, 89, 5, 133)} light_block_9 replace light_block_1`, 4), D(`fill ${BOX(85, 5, 101, 89, 5, 133)} light_block_1 replace light_block_9`, 2),
  ]),
  M('env.flicker_ehall', 'I', 'East hall lights flicker', [
    `fill ${BOX(111, 5, 101, 115, 5, 133)} light_block_9 replace light_block_1`, D(`fill ${BOX(111, 5, 101, 115, 5, 133)} light_block_1 replace light_block_9`, 3),
    D(`fill ${BOX(111, 5, 101, 115, 5, 133)} light_block_9 replace light_block_1`, 4), D(`fill ${BOX(111, 5, 101, 115, 5, 133)} light_block_1 replace light_block_9`, 2),
  ]),
  M('env.distant_music', 'I', 'Faint music from the show stage', [SND('fb.amb.distant_music', 100, 3, 22, 0.8)]),
  M('env.pipes', 'I', 'Basement pipes knock', [SND('fb.amb.pipes', 100, -6, 60, 1), D(SND('fb.amb.pipes', 140, -6, 90, 0.8), 20)]),
  M('env.phone_ring', 'I', 'Office phone rings', [SND('fb.phone.ring', 102, 1, 130), D(SND('fb.phone.ring', 102, 1, 130), 30), D(SND('fb.phone.ring', 102, 1, 130), 30)]),
  // ---------------------------------------------------------------- J jumpscares
  M('js.common', 'J', 'Jumpscare: camera shake + light burst (the script plays the character scream at the player)', [
    'camerashake add @a 1.2 1.6 rotational', `fill ${OFFICE_AIR} light_block_15 replace air`,
    D(`fill ${OFFICE_AIR} air replace light_block_15`, 3), D('camerashake stop @a', 30),
  ]),
  // ---------------------------------------------------------------- K win / lose
  M('win.six_am', 'K', '6 AM: chimes and lights', [
    SND('fb.clock.chime', 100, 3, 133, 1.2), D(SND('fb.clock.chime', 100, 3, 133, 1.2), 25), D(SND('fb.clock.chime', 100, 3, 133, 1.2), 25),
    D(SND('fb.clock.cheer', 100, 3, 133, 1), 10), `fill ${OFFICE_AIR} light_block_12 replace air`, D(`fill ${OFFICE_AIR} air replace light_block_12`, 60),
  ]),
  M('lose.static', 'K', 'Game over static', [`playsound fb.cam.static @a ${W(100, 1.6, 131.5)} 1 1`, D(`playsound fb.cam.static @a ${W(100, 1.6, 131.5)} 1 0.8`, 20)]),
  M('win.campaign', 'K', 'Campaign complete fanfare', [
    SND('fb.ending.theme', 100, 3, 150, 1), `particle minecraft:totem_particle ${W(100, 3, 156)}`, D(`particle minecraft:totem_particle ${W(96, 3, 156)}`, 10),
    D(`particle minecraft:totem_particle ${W(104, 3, 156)}`, 10),
  ]),
  // ---------------------------------------------------------------- L reset & diagnostics
  M('reset.world', 'L', 'Full reset: runs night.end (via its pad), then restores indicators and clears items/titles', [
    'TRIGGER:night.end', `fill ${OFFICE_AIR} air replace light_block_12`,
    `setblock ${IND.doorL} verdant_froglight`, `setblock ${IND.doorR} verdant_froglight`, `setblock ${IND.lightL} gray_concrete`,
    `setblock ${IND.lightR} gray_concrete`, `setblock ${IND.hatch} gray_concrete`, `setblock ${IND.hatch2} gray_concrete`,
    `setblock ${IND.breaker} verdant_froglight`, 'kill @e[type=item]', 'title @a clear',
  ]),
  M('diag.ping', 'L', 'Actuator-bus round trip test (answers the script)', ['scriptevent fb:diag pong']),
  M('diag.lamp_test', 'L', 'Indicator lamp test (all office lamps on for 2 s)', [
    `fill ${BOX(96, 4, 126, 105, 4, 126)} ochre_froglight`, D(`fill ${BOX(96, 4, 126, 105, 4, 126)} verdant_froglight`, 40),
  ]),
]);

/**
 * Repeating command blocks (always active). Kept to one: a slow heartbeat so
 * the script can detect that command blocks are enabled and the control room
 * is loaded.
 */
export const REPEATERS = Object.freeze([
  Object.freeze({ id: 'diag.heartbeat', section: 'L', purpose: 'Heartbeat every 100 ticks (command blocks enabled + control room loaded)', cmd: 'scriptevent fb:diag heartbeat', delay: 100 }),
]);

export const MODULE_BY_ID = Object.freeze(Object.fromEntries(MODULES.map((m) => [m.id, m])));

// ------------------------------------------------------------------ physical layout
export const CONTROL = Object.freeze({ x1: 22, x2: 177, y: -9, rows: Object.freeze([169, 172, 175, 178, 181, 184, 187, 190, 193]) });

/** Assign every module a pad position. Deterministic packing west->east, row by row. */
export function layoutModules() {
  /** @type {any[]} */
  const placed = [];
  let row = 0;
  /** @type {number} */
  let x = CONTROL.x1;
  /** @type {string | null} */
  let lastSection = null;
  for (const m of MODULES) {
    const len = 2 + m.cmds.length; // pad + impulse + chains (first chain clears the pad)
    const need = len + 1;
    if (lastSection && lastSection !== m.section && x !== CONTROL.x1) x += 2; // gap between sections
    if (x + need > CONTROL.x2) {
      row++;
      x = CONTROL.x1;
    }
    if (row >= CONTROL.rows.length) throw new Error('control room full');
    placed.push({ module: m, row, z: CONTROL.rows[row], pad: [x, CONTROL.y, CONTROL.rows[row]], impulse: [x + 1, CONTROL.y, CONTROL.rows[row]], length: len });
    x += need;
    lastSection = m.section;
  }
  // Repeaters at the end of the last row.
  /** @type {any[]} */
  const rep = [];
  for (const r of REPEATERS) {
    if (x + 2 > CONTROL.x2) {
      row++;
      x = CONTROL.x1;
    }
    rep.push({ repeater: r, row, z: CONTROL.rows[row], pos: [x + 1, CONTROL.y, CONTROL.rows[row]] });
    x += 3;
  }
  return { modules: placed, repeaters: rep };
}

/**
 * Resolve module-chaining tokens: 'TRIGGER:<module id>' becomes a setblock of
 * a redstone block on that module's pad (command blocks chaining modules).
 */
export function resolveCommand(cmd, placed) {
  const m = /^TRIGGER:(.+)$/.exec(cmd);
  if (!m) return cmd;
  const target = placed.find((p) => p.module.id === m[1]);
  if (!target) throw new Error(`TRIGGER to unknown module ${m[1]}`);
  return `setblock ${W(...target.pad)} redstone_block`;
}

export { W as worldCoords };
