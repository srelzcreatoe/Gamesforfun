// @ts-check
// The Shaftbreaker - entry point. Stable @minecraft/server 2.4.0 API only (no beta modules, no experiments).
import { world, system } from "@minecraft/server";
import { cfg, loadConfig } from "./core/config.js";
import { loadWorld, saveWorld } from "./core/state.js";
import { guard, DEBUG } from "./core/util.js";
import { PS, getP, updateMotion } from "./ai/players.js";
import { brainTick } from "./ai/dweller.js";
import { directorTick, cleanupOnLoad } from "./ai/director.js";
import { genTick, fearTick } from "./world/territory.js";
import { dwellingTick } from "./world/dwelling.js";
import { podTick, rageDecay } from "./world/organs.js";
import { heartbeatTick, musicTick, ambienceTick } from "./fx/audio.js";
import { phantomTick } from "./fx/illusions.js";
import { mothSpawnTick, mothTick } from "./creatures/moth.js";
import { chimeTick } from "./items.js";
import "./admin.js";

let started = false;

function start() {
  if (started) return;
  started = true;
  loadConfig();
  loadWorld();
  DEBUG.on = cfg.debug;
  guard("cleanup", cleanupOnLoad);
  for (const pl of world.getAllPlayers()) getP(pl);

  let tick = 0;
  system.runInterval(() => {
    tick++;
    guard("heartbeat", heartbeatTick);
    if (tick % 2 === 0) {
      guard("brain", brainTick);
      guard("phantoms", phantomTick);
    }
    if (tick % 5 === 0) {
      for (const pl of world.getAllPlayers()) guard("motion", () => updateMotion(pl, getP(pl)));
    }
    if (tick % 10 === 0) {
      guard("pods", podTick);
      guard("moths", mothTick);
      guard("chimes", chimeTick);
    }
    if (tick % 20 === 0) {
      guard("director", directorTick);
      guard("music", musicTick);
      guard("ambience", ambienceTick);
    }
    if (tick % 40 === 0) {
      guard("gen", genTick);
      guard("fear", fearTick);
      guard("mothSpawn", mothSpawnTick);
    }
    if (tick % 100 === 0) guard("dwellings", dwellingTick);
    if (tick % 200 === 0) guard("save", () => saveWorld());
    if (tick % 600 === 0) guard("rage", rageDecay);
  }, 1);
}

world.afterEvents.worldLoad.subscribe(() => start());
// if the script is reloaded (/reload) after the world already loaded
system.run(() => { try { if (world.getAllPlayers().length) start(); } catch { /* early execution: wait for worldLoad */ } });

world.afterEvents.playerLeave.subscribe((ev) => {
  PS.delete(ev.playerId);
});
