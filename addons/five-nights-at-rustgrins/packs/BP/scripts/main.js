// FIVE NIGHTS AT RUSTGRIN'S - behavior pack entry point.
// Target: Minecraft Bedrock 1.26.50+, @minecraft/server 2.10.0, @minecraft/server-ui 2.2.0.
//
// Startup registers the slash commands and the block custom component used
// by the office wall buttons; world APIs are only touched after world load.

import { system, world } from '@minecraft/server';
import { Game } from './mc/game.js';
import { registerCommands } from './mc/commands.js';
import { log } from './mc/log.js';

/** @type {Game | undefined} */
let game;

system.beforeEvents.startup.subscribe((ev) => {
  try {
    registerCommands(ev.customCommandRegistry, () => game);
  } catch (e) {
    log.error('custom command registration failed', e);
  }
  try {
    // Office wall buttons (door / light): blocks with "fnar:control": {} in their components.
    ev.blockComponentRegistry.registerCustomComponent('fnar:control', {
      onPlayerInteract(e) {
        if (e.player) game?.onControl(e.player, e.block);
      },
    });
  } catch (e) {
    log.error('custom component registration failed', e);
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  try {
    game = new Game();
    game.start();
    log.info("FIVE NIGHTS AT RUSTGRIN'S loaded");
  } catch (e) {
    log.error('startup failed', e);
  }
});
