// FREDBEAR: SIX NIGHTS BELOW - behavior pack entry point.
// Target: Minecraft Bedrock 1.26.50, @minecraft/server 2.10.0, @minecraft/server-ui 2.2.0.
//
// Scripts start in early-execution mode: world APIs are only touched after
// world load. Custom slash commands are registered during startup.

import { system, world } from '@minecraft/server';
import { Game } from './mc/game.js';
import { registerCommands, installDebug } from './mc/debug.js';
import { log } from './mc/log.js';

/** @type {Game | undefined} */
let game;

system.beforeEvents.startup.subscribe((ev) => {
  try {
    registerCommands(ev.customCommandRegistry, () => game);
  } catch (e) {
    log.error('custom command registration failed', e);
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  try {
    game = new Game();
    installDebug(game);
    game.start();
    log.info('FREDBEAR: Six Nights Below loaded');
  } catch (e) {
    log.error('startup failed', e);
  }
});
