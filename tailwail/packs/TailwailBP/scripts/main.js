// Tailwail: The Rehearsal - entry point.
// Stable modules only: @minecraft/server 2.11.0, @minecraft/server-ui 2.3.0.
import { system, world } from "@minecraft/server";
import { ADDON_VERSION, GUIDE_ITEM_ID } from "./config.js";
import { registerCommands, runDebug } from "./mc/commands.js";
import { Director } from "./mc/director.js";
import { errorText, warn } from "./mc/log.js";
import { showGuide } from "./mc/ui.js";

const director = new Director();

system.beforeEvents.startup.subscribe((ev) => {
  try {
    registerCommands(ev.customCommandRegistry, director);
  } catch (e) {
    warn("command registration failed", errorText(e));
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  director.start();
  warn(`v${ADDON_VERSION} ready`);
});

world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack && ev.itemStack.typeId === GUIDE_ITEM_ID) system.run(() => showGuide(ev.source));
});

// Console / command-block access to diagnostics (operators): /scriptevent tailwail:debug status
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "tailwail:debug") return;
  const [op, arg] = (ev.message || "status").split(" ");
  const src = ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player" ? ev.sourceEntity : undefined;
  runDebug(director, src, op, arg);
});

export { director };
