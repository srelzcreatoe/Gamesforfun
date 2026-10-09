// Developer controls: custom slash commands, the in-game self-test, route
// validation, deterministic scenarios and diagnostics.
//
//   /fb:setup [rebuild]          build (or rebuild) the map
//   /fb:lobby                    full reset back to the time clock
//   /fb:debug <action> [a] [b]   see HELP below
// The same actions are reachable from the control-room developer panel.

import { system, world, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from '@minecraft/server';
import { EDGES, edgePolyline, NODE_BY_ID } from '../data/nodes.js';
import { CAMERAS, CAMERA_ORDER, CAMERA_BY_ID } from '../data/cameras.js';
import { CB_STRUCTURES } from '../data/cb_structures.generated.js';
import { layoutModules } from '../data/actuators.js';
import { INPUTS, inputCbPos } from '../data/inputs.js';
import { ANCHORS } from '../data/layout.js';
import { checkPalette, dim, W, Wv } from './world_io.js';
import { storeSave } from './persistence.js';
import { restorePlayerView } from './camera_view.js';
import { resolveStructureId } from './builder.js';
import * as ui from './ui.js';
import { log, setVerbose } from './log.js';
import { CONFIG, LAST_NIGHT } from '../core/config.js';

const HELP = [
  'lobby | overlay | selftest | graph | state | puppets | camtour',
  'night <0-7> | hour <0-5> | power <pct> | seed <n> | unlock <1-7>',
  'challenge <no_doors|fredbear_only|double_drain|no_cams> | ending <seal|burn> | flashback | holiday <halloween|christmas|none> | shadow',
  'ai <who> <0-20> | place <who> <node> | approach <who> <L|R|H>',
  'scenario <slice|boundary|power_zero|double|freddy|fredbear_hatch|fredbear_left|blackout|finale>',
  'win | lose | maint | skip | verbose',
].join('\n');

/** Deterministic test scenarios (fixed seed 4242). */
export const SCENARIOS = Object.freeze({
  slice: { night: 0, note: 'Vertical slice: 2-minute test night, Bonnie only, lethal', setup: () => {} },
  boundary: { night: 2, note: 'Bonnie telegraphing at the left door at 5:59 AM (6 AM must win)', setup: (s) => {
    for (const id of ['chica', 'freddy']) s.setAggression(id, 0);
    s.setTick(s.length - 60);
    s.place('bonnie', 'W_DOOR', 'TELEGRAPH');
    s.anim.bonnie.entry = 'L';
    s.director.entries.L = 'bonnie';
    s.anim.bonnie.timer = 80;
  } },
  power_zero: { night: 3, note: 'Power at 1% on night 3 (reserve lever window)', setup: (s) => s.setPowerPercent(1) },
  double: { night: 3, note: 'Bonnie and Chica telegraph at both doors at once', setup: (s) => {
    s.setAggression('freddy', 0);
    s.forceApproach('bonnie', 'L');
    s.forceApproach('chica', 'R');
  } },
  freddy: { night: 5, note: 'Freddy lurking at the right corner', setup: (s) => {
    for (const id of ['bonnie', 'chica', 'fredbear']) s.setAggression(id, 0);
    s.place('freddy', 'EH_S', 'STALK');
  } },
  fredbear_hatch: { night: 4, note: 'Fredbear climbing to the hatch (close hatch, then strobe)', setup: (s) => {
    for (const id of ['bonnie', 'chica', 'freddy']) s.setAggression(id, 0);
    s.place('fredbear', 'SUB_N', 'PATROL');
    s.anim.fredbear.target = 'H';
  } },
  fredbear_left: { night: 5, note: 'Fredbear relocating to the west hall (close left door, then strobe)', setup: (s) => {
    for (const id of ['bonnie', 'chica', 'freddy']) s.setAggression(id, 0);
    s.place('fredbear', 'DINER_STAGE', 'PATROL');
    s.anim.fredbear.target = 'L';
    s.anim.fredbear.cool.relocate = 0;
  } },
  blackout: { night: 5, note: 'Forced Fredbear blackout (60 ticks)', setup: (s) => {
    for (const id of s.order) s.setAggression(id, 0);
    s.startBlackout(40, 60);
  } },
  finale: { night: 6, note: 'Night 6 at 4:58 AM (Golden Hour finale)', setup: (s) => s.setTick(7960) },
});

export function installDebug(game) {
  game.debugHook = (action, player) => handleDev(game, action, player);
  game.debugCommand = (action, a1, a2, player) => handleDebug(game, action, a1, a2, player);
}

export function registerCommands(registry, getGame) {
  const ok = (message) => ({ status: CustomCommandStatus.Success, message });
  registry.registerCommand({
    name: 'fb:setup', description: 'Build (or rebuild) the FREDBEAR: Six Nights Below map', permissionLevel: CommandPermissionLevel.GameDirectors,
    cheatsRequired: true, optionalParameters: [{ name: 'rebuild', type: CustomCommandParamType.Boolean }],
  }, (_origin, rebuild) => {
    system.run(() => getGame()?.setup(!!rebuild));
    return ok('Building the map... keep the world open until it reports completion.');
  });
  registry.registerCommand({
    name: 'fb:lobby', description: 'Return to the time-clock lobby (full reset)', permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: true,
  }, () => {
    system.run(() => getGame()?.fullReset('lobby'));
    return ok('Reset.');
  });
  registry.registerCommand({
    name: 'fb:debug', description: 'FREDBEAR developer controls (try: /fb:debug help)', permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: true,
    mandatoryParameters: [{ name: 'action', type: CustomCommandParamType.String }],
    optionalParameters: [{ name: 'arg1', type: CustomCommandParamType.String }, { name: 'arg2', type: CustomCommandParamType.String }],
  }, (origin, action, a1, a2) => {
    const player = origin.sourceEntity?.typeId === 'minecraft:player' ? origin.sourceEntity : undefined;
    system.run(() => {
      const g = getGame();
      if (g) handleDebug(g, String(action), a1, a2, player);
    });
    return ok(action === 'help' ? HELP : `fb:debug ${action}`);
  });
}

function say(player, text) {
  try {
    (player ?? world.getAllPlayers()[0])?.sendMessage(`§7[FB] §f${text}`);
  } catch {
    // ignore
  }
  log.info(text);
}

function handleDev(game, action, player) {
  const map = {
    'dev:exit': () => game.fullReset('lobby'),
    'dev:selftest': () => selfTest(game, player),
    'dev:overlay': () => handleDebug(game, 'overlay', undefined, undefined, player),
    'dev:deterministic': () => handleDebug(game, 'seed', String(game.save.settings.seed), undefined, player),
    'dev:menu': () => say(player, HELP),
    'dev:graph': () => validateRoutes(player),
    'dev:state': () => dumpState(game, player),
    'dev:puppets': () => handleDebug(game, 'puppets', undefined, undefined, player),
    'dev:skip_hour': () => handleDebug(game, 'skip', undefined, undefined, player),
    'dev:reset': () => game.fullReset('lobby'),
  };
  map[action]?.();
  return true;
}

export function handleDebug(game, action, a1, a2, player) {
  const s = game.session;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  switch (action) {
    case 'help':
      return say(player, HELP);
    case 'lobby':
      game.fullReset('lobby');
      return say(player, 'full reset: back at the time clock');
    case 'overlay':
      game.overlay = !game.overlay;
      game.save.settings.debugOverlay = game.overlay;
      storeSave(game.save);
      return say(player, `debug overlay ${game.overlay ? 'on' : 'off'}`);
    case 'verbose':
      setVerbose(true);
      return say(player, 'verbose content-log output on');
    case 'selftest':
      return selfTest(game, player);
    case 'graph':
      return validateRoutes(player);
    case 'state':
      return dumpState(game, player);
    case 'puppets':
      for (const who of ['freddy', 'bonnie', 'chica', 'fredbear']) {
        try {
          for (const e of dim().getEntities({ type: `fb:${who}` })) e.remove();
        } catch {
          // ignore
        }
      }
      game.puppets.ents = Object.create(null);
      game.puppets.applied = Object.create(null);
      return say(player, 'puppets respawned');
    case 'camtour':
      return camTour(player ?? game.guard());
    case 'night':
      game.guardId = player?.id ?? game.guardId;
      game.fullReset('office');
      return game.beginNight(Math.max(0, Math.min(LAST_NIGHT, num(a1, 1))), { teleport: true });
    case 'challenge': {
      const c = CONFIG.challenges[a1];
      if (!c) return say(player, `challenges: ${Object.keys(CONFIG.challenges).join(', ')}`);
      game.guardId = player?.id ?? game.guardId;
      game.fullReset('office');
      game.challenge = { id: a1, ...c };
      game.beginNight(c.base, { teleport: true });
      return say(player, `challenge ${c.title}`);
    }
    case 'ending':
      game.guardId = player?.id ?? game.guardId;
      game.startFinalEnding();
      if (a1 === 'seal' || a1 === 'burn') {
        game.ending.choice = a1;
        game.ending.next = system.currentTick + 10;
      }
      return say(player, 'night 7 ending');
    case 'flashback':
      game.guardId = player?.id ?? game.guardId;
      game.fullReset('lobby');
      game.night = 4;
      game.state = 'INTRO';
      game.intro = { started: system.currentTick, task: undefined, taskDone: false, deadline: system.currentTick + 6000 };
      game.applyGates(4);
      game.startFlashback();
      return say(player, 'night 4 flashback');
    case 'holiday':
      game.holidays.sync(a1 === 'halloween' || a1 === 'christmas' ? a1 : null);
      return say(player, `holiday decorations: ${a1 ?? 'none'} (the device date decides again at the next lobby visit)`);
    case 'scenario': {
      const sc = SCENARIOS[a1];
      if (!sc) return say(player, `scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
      game.save.settings.deterministic = true;
      game.save.settings.seed = 4242;
      game.guardId = player?.id ?? game.guardId;
      game.fullReset('office');
      game.beginNight(sc.night, { teleport: true, scenario: sc.setup });
      return say(player, `scenario ${a1}: ${sc.note} (seed 4242)`);
    }
    case 'seed':
      game.save.settings.deterministic = true;
      game.save.settings.seed = num(a1, 1983);
      storeSave(game.save);
      return say(player, `deterministic seed ${game.save.settings.seed} (next night)`);
    case 'unlock':
      game.save.unlocked = Math.max(1, Math.min(LAST_NIGHT, num(a1, 6)));
      if (game.save.unlocked === LAST_NIGHT) game.save.campaignDone = true;
      storeSave(game.save);
      return say(player, `unlocked up to night ${game.save.unlocked}`);
    default:
  }
  if (!s) return say(player, 'no night running (try /fb:debug night 1)');
  switch (action) {
    case 'hour':
      s.setTick(num(a1) * s.tph);
      return say(player, `jumped to ${num(a1)} AM`);
    case 'skip':
      s.setTick(Math.min(s.length - 1, (s.hour + 1) * s.tph));
      return say(player, `skipped to hour ${s.hour}`);
    case 'power':
      s.setPowerPercent(num(a1, 50));
      return say(player, `power ${num(a1, 50)}%`);
    case 'ai':
      s.setAggression(a1, num(a2, 10));
      return say(player, `${a1} aggression ${num(a2, 10)}`);
    case 'place':
      if (!NODE_BY_ID[a2] || !s.anim[a1]) return say(player, 'usage: place <who> <node>');
      s.place(a1, a2);
      return say(player, `${a1} placed at ${a2}`);
    case 'approach':
      s.forceApproach(a1, (a2 ?? 'L').toUpperCase());
      return say(player, `${a1} approaching ${a2}`);
    case 'win':
      s.setTick(s.length - 1);
      return say(player, 'skipping to 6 AM');
    case 'lose':
      if (s.director.requestAttack(a1 && s.anim[a1] ? a1 : 'bonnie')) s.beginJumpscare(a1 && s.anim[a1] ? a1 : 'bonnie');
      return undefined;
    case 'maint':
      if (s.phase === 'RUNNING') s.beginMaintenance(a1 === 'electrical' ? 'electrical' : 'generator');
      return undefined;
    case 'shadow':
      s.shadowRng = { chance: () => true };
      s.maybeShadow(Math.max(1, s.hour));
      return say(player, 'shadow Fredbear on the stage (CAM 01)');
    default:
      return say(player, `unknown debug action '${action}'. ${HELP}`);
  }
}

function dumpState(game, player) {
  const s = game.session;
  const lines = [`state ${game.state} night ${game.night} seed ${game.seed ?? '-'}`, `bus ${JSON.stringify(game.bus.stats)} heartbeat ${game.bus.commandBlocksAlive() ? 'ok' : 'MISSING'}`, `puppets ${JSON.stringify(game.puppets.status())}`];
  if (s) {
    const snap = s.snapshot();
    lines.push(`t ${snap.t} phase ${snap.phase} power ${snap.powerPct}% usage ${snap.usage} entries ${JSON.stringify(snap.entries)}`);
    for (const [id, a] of Object.entries(snap.anim)) lines.push(`${id}: ${a.state} @${a.node}${a.moving ? `>${a.to}` : ''} A${a.aggression}`);
    lines.push(...s.log.slice(-8).map((l) => `  ${l.t} ${l.who} ${l.from}->${l.to} ${l.reason}`));
  }
  lines.push(...log.recent(6));
  for (const l of lines) say(player, l);
}

/** In-world route check: every sampled body cell along every edge must be passable. */
function validateRoutes(player) {
  const passable = (t) => t === undefined ? false : t === 'minecraft:air' || t.startsWith('minecraft:light_block') || t.includes('sign') || t.includes('ladder') || t.includes('carpet') || t.includes('trapdoor') || t === 'minecraft:web' || t.includes('button') || t.includes('chain') || t.includes('lantern') || t === 'minecraft:barrier';
  let samples = 0;
  const bad = [];
  for (const e of EDGES) {
    const pts = edgePolyline(e, e.a);
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0, z0] = pts[k - 1];
      const [x1, y1, z1] = pts[k];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 0.5));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const p = { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, z: z0 + (z1 - z0) * f };
        const cells = e.mode === 'vent' || e.mode === 'climb' ? [0] : [0, 1];
        for (const dy of cells) {
          samples++;
          let t;
          try {
            t = dim().getBlock(Wv({ x: Math.floor(p.x), y: Math.floor(p.y + 0.01) + dy, z: Math.floor(p.z) }))?.typeId;
          } catch {
            t = undefined;
          }
          if (!passable(t) && !e.gate) bad.push(`${e.id} @${p.x.toFixed(1)},${p.z.toFixed(1)} (${t})`);
        }
      }
    }
  }
  say(player, `route check: ${samples} samples, ${bad.length} blocked${bad.length ? `: ${bad.slice(0, 6).join('; ')}` : ''}`);
  return bad;
}

async function camTour(player) {
  if (!player) return;
  for (const id of CAMERA_ORDER) {
    const c = CAMERA_BY_ID[id];
    player.camera.setCamera('minecraft:free', { location: Wv({ x: c.loc[0], y: c.loc[1], z: c.loc[2] }), facingLocation: Wv({ x: c.look[0], y: c.look[1], z: c.look[2] }) });
    player.onScreenDisplay.setActionBar(c.label);
    await new Promise((r) => system.runTimeout(() => r(undefined), 60));
  }
  restorePlayerView(player);
}

/** In-game self-test. Every line reports PASS/FAIL with evidence. */
export async function selfTest(game, player) {
  const out = [];
  const add = (ok, text) => out.push(`${ok ? '§aPASS' : '§cFAIL'}§f ${text}`);
  const badPal = checkPalette();
  add(!badPal.length, `palette resolves in this game version (${badPal.length} invalid)`);
  const ids = new Set(world.structureManager.getPackStructureIds());
  const missingS = CB_STRUCTURES.filter((s) => !resolveStructureId(s.id, ids)).map((s) => s.id);
  add(!missingS.length, `${CB_STRUCTURES.length} command-block structures present in the pack${missingS.length ? ` (missing ${missingS.slice(0, 3)})` : ''}`);
  let cbOk = 0;
  const cbBad = [];
  for (const { module: m, impulse } of layoutModules().modules) {
    const t = dim().getBlock(W(...impulse))?.typeId;
    if (t === 'minecraft:command_block') cbOk++;
    else cbBad.push(m.id);
  }
  for (const i of INPUTS) {
    const t = dim().getBlock(W(...inputCbPos(i)))?.typeId;
    if (t === 'minecraft:command_block') cbOk++;
    else cbBad.push(i.id);
  }
  add(!cbBad.length, `command blocks in place: ${cbOk}${cbBad.length ? ` (missing: ${cbBad.slice(0, 4).join(', ')})` : ''}`);
  const pingAt = system.currentTick;
  game.bus.trigger('diag.ping');
  await new Promise((r) => system.runTimeout(() => r(undefined), 20));
  add(game.bus.pong >= pingAt, `actuator bus round trip (script -> pad -> command block -> scriptevent)`);
  // The heartbeat repeats every 100 ticks: right after a world load it may not have reported yet.
  for (let waited = 0; waited < 120 && !game.bus.commandBlocksAlive(); waited += 10) await new Promise((r) => system.runTimeout(() => r(undefined), 10));
  add(game.bus.commandBlocksAlive(), 'repeating heartbeat command block reporting');
  const blocked = validateRoutes(player);
  add(!blocked.length, `AI routes clear in the built world (${blocked.length} blocked samples)`);
  const camBad = CAMERAS.filter((c) => dim().getBlock(Wv({ x: Math.floor(c.loc[0]), y: Math.floor(c.loc[1]), z: Math.floor(c.loc[2]) }))?.typeId !== 'minecraft:air').map((c) => c.id);
  add(!camBad.length, `camera positions in open air${camBad.length ? ` (${camBad})` : ''}`);
  const counts = game.puppets.status();
  add(Object.values(counts).every((n) => n === 1), `exactly one puppet per animatronic ${JSON.stringify(counts)}`);
  const loaded = [ANCHORS.officeSeat, { x: 100, y: 0, z: 22 }, { x: 34, y: -9, z: 36 }, { x: 160, y: -9, z: 180 }].every((a) => dim().isChunkLoaded(Wv(a)));
  add(loaded, 'office, stage, chamber and control room chunks loaded (ticking areas)');
  const text = out.join('\n');
  log.warn(`self-test\n${text.replace(/§./g, '')}`);
  if (player) ui.messageBox(player, 'Self-test', text);
  return out;
}
