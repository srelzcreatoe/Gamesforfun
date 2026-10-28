// Custom slash commands (registered at startup):
//   /fnar:setup [rebuild]          build the pizzeria where you stand (cheats on)
//   /fnar:lobby                    back to the time clock (full reset)
//   /fnar:debug <action> [a] [b]   developer controls, try /fnar:debug help

import { system, world, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from '@minecraft/server';
import { CAST, CUSTOM_NIGHT } from '../core/config.js';
import { log } from './log.js';

const HELP = [
  '/fnar:debug status           version, build, night, cameras and animatronics (paste it when reporting a problem)',
  '/fnar:debug night <1-7>      start a night (7 = custom, all 10)',
  '/fnar:debug win | lose       end the running night',
  '/fnar:debug power <0-100>    set power',
  '/fnar:debug hour <0-5>       jump the clock',
  '/fnar:debug ai <who> <0-20>  set one AI level (mirehop noxbriar rustgrin cat purple_rat top_hat_rat)',
  '/fnar:debug tape <0-100>     set the show tape',
  '/fnar:debug cat <0-3>        set the Cabaret stage',
  '/fnar:debug overlay          toggle the AI overlay',
  '/fnar:debug roam | lobby     free roam / lobby',
  '/fnar:debug stars <0-3>      set earned stars',
  '/fnar:debug unlock           unlock every night',
].join('\n');

/**
 * @param {import('@minecraft/server').CustomCommandRegistry} registry
 * @param {() => import('./game.js').Game | undefined} getGame
 */
export function registerCommands(registry, getGame) {
  const ok = (message) => ({ status: CustomCommandStatus.Success, message });
  const playerOf = (origin) => (origin.sourceEntity?.typeId === 'minecraft:player' ? origin.sourceEntity : undefined);
  registry.registerCommand({
    name: 'fnar:setup', description: "Build Rustgrin's Pizza Revue where you stand", permissionLevel: CommandPermissionLevel.GameDirectors,
    cheatsRequired: true, optionalParameters: [{ name: 'rebuild', type: CustomCommandParamType.Boolean }],
  }, (origin, rebuild) => {
    const p = playerOf(origin);
    system.run(() => getGame()?.setup(!!rebuild, p));
    return ok('Building the pizzeria... keep the world open until it reports completion.');
  });
  registry.registerCommand({
    name: 'fnar:lobby', description: 'Return to the time clock (full reset)', permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: true,
  }, () => {
    system.run(() => getGame()?.enterLobby());
    return ok('Back to the time clock.');
  });
  registry.registerCommand({
    name: 'fnar:debug', description: 'Five Nights at Rustgrin\'s developer controls (try: /fnar:debug help)', permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: true,
    mandatoryParameters: [{ name: 'action', type: CustomCommandParamType.String }],
    optionalParameters: [{ name: 'arg1', type: CustomCommandParamType.String }, { name: 'arg2', type: CustomCommandParamType.String }],
  }, (origin, action, a1, a2) => {
    const p = playerOf(origin);
    system.run(() => {
      const g = getGame();
      if (g) debug(g, String(action), a1, a2, p);
    });
    return ok(action === 'help' ? HELP : `fnar:debug ${action}`);
  });
}

function say(p, text) {
  try {
    (p ?? world.getAllPlayers()[0])?.sendMessage(`§7[FNaR] §f${text}`);
  } catch {
    // ignore
  }
  log.info(text);
}

/** @param {import('./game.js').Game} g */
function debug(g, action, a1, a2, p) {
  const s = g.session;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  switch (action) {
    case 'help':
      return say(p, 'see the command output');
    case 'status':
      for (const line of g.statusLines()) say(p, line);
      return undefined;
    case 'night': {
      const n = Math.max(1, Math.min(CUSTOM_NIGHT, num(a1, 1)));
      const pl = p ?? world.getAllPlayers()[0];
      if (!pl) return undefined;
      return g.startNight(pl, n, n === CUSTOM_NIGHT ? { ai: Object.fromEntries(CAST.map((id) => [id, 10])) } : {});
    }
    case 'win':
      if (s) g.debugWin();
      return undefined;
    case 'lose':
      if (s) s.kill(a1 && CAST.includes(a1) ? a1 : 'mirehop');
      return undefined;
    case 'power':
      if (s) s.power = Math.max(1, Math.min(100, num(a1, 50))) * 1000;
      return undefined;
    case 'hour':
      if (s) s.t = Math.max(0, Math.min(5, num(a1, 0))) * s.ticksPerHour;
      return undefined;
    case 'ai':
      if (s && s.chars[a1]) s.chars[a1].baseAi = Math.max(0, Math.min(20, num(a2, 10)));
      return say(p, s ? `${a1} -> ${s.chars[a1]?.baseAi}` : 'no night running');
    case 'tape':
      if (s) s.chars.top_hat_rat.tape = Math.max(0, Math.min(100, num(a1, 50))) * 1000;
      return undefined;
    case 'cat':
      if (s) s.chars.cat.setStage(Math.max(0, Math.min(3, num(a1, 0))));
      return undefined;
    case 'overlay':
      g.save.settings.debugOverlay = !g.save.settings.debugOverlay;
      return say(p, `overlay ${g.save.settings.debugOverlay ? 'on' : 'off'}`);
    case 'roam':
      return g.enterFreeRoam();
    case 'lobby':
      return g.enterLobby();
    case 'stars':
      g.save.stars = Math.max(0, Math.min(3, num(a1, 0)));
      g.updateStars();
      return undefined;
    case 'unlock':
      g.save.beaten = [1, 2, 3, 4, 5, 6];
      g.save.next = 5;
      return say(p, 'all nights unlocked');
    default:
      return say(p, `unknown debug action ${action}`);
  }
}
