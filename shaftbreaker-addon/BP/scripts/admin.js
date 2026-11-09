// @ts-check
// /scriptevent commands for operators and testing:
//   /scriptevent shaftbreaker:menu            open the Config Wheel menu
//   /scriptevent shaftbreaker:journal         open the Field Journal
//   /scriptevent shaftbreaker:spawn stalk|standoff|hunt
//   /scriptevent shaftbreaker:phase stalk|standoff|hunt|search|leave|vanish
//   /scriptevent shaftbreaker:cancel
//   /scriptevent shaftbreaker:illusion [name]  (extraPickaxe, delayedFootstep, eyesInDark, phantom, torches, door, scratches, ...)
//   /scriptevent shaftbreaker:locate | hollow_here | dwelling_here | info
//   /scriptevent shaftbreaker:preset atmospheric|balanced|relentless|harmless
//   /scriptevent shaftbreaker:enable | disable | reset_memory
import { system } from "@minecraft/server";
import { cfg, saveConfig, applyPreset } from "./core/config.js";
import { guard, fmt, dist } from "./core/util.js";
import { T } from "./ai/threat.js";
import { getP } from "./ai/players.js";
import { newProfile } from "./core/state.js";
import { startEncounter } from "./ai/director.js";
import { forceState, vanish } from "./ai/dweller.js";
import { runIllusion } from "./fx/illusions.js";
import { nearestHollow, forceHollow } from "./world/territory.js";
import { buildSmall } from "./world/dwelling.js";
import { openConfig, info } from "./ui/menus.js";
import { openJournal } from "./ui/journal.js";

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("shaftbreaker:")) return;
  guard("scriptevent", () => {
    const cmd = ev.id.slice("shaftbreaker:".length);
    const arg = (ev.message || "").trim();
    const pl = /** @type {any} */ (ev.sourceEntity);
    const isPl = pl && pl.typeId === "minecraft:player";
    const say = (m) => { if (isPl) pl.sendMessage("§7[Shaftbreaker] " + m); else console.warn("[Shaftbreaker] " + m); };
    switch (cmd) {
      case "menu": if (isPl) openConfig(pl); break;
      case "journal": if (isPl) openJournal(pl); break;
      case "spawn":
        if (!isPl) break;
        if (T.brain) { say("It is already here."); break; }
        say(startEncounter(pl, getP(pl), arg === "hunt" ? "scream" : arg === "standoff" ? "standoff" : "stalk") ? "Something is coming." : "No valid hidden spot nearby - try in a cave.");
        break;
      case "phase": if (isPl) say(forceState(arg, pl) ? "Phase forced: " + arg : "No active creature or unknown phase."); break;
      case "cancel": if (T.brain) vanish(T.brain, true); say("Encounter cancelled."); break;
      case "illusion": if (isPl) say(runIllusion(pl, getP(pl), arg || undefined) ? "..." : "That illusion couldn't play here."); break;
      case "locate": {
        if (!isPl) break;
        const h = nearestHollow(pl.location);
        say(h ? `Nearest Hollow: ${fmt({ x: h.cx, y: h.cy, z: h.cz })} (${Math.round(dist(pl.location, { x: h.cx, y: pl.location.y, z: h.cz }))} blocks)` : "No Hollow found.");
        break;
      }
      case "hollow_here": if (isPl) { forceHollow(pl.location); say("A Hollow will grow around this spot."); } break;
      case "dwelling_here":
        if (isPl) system.runJob((function* () { const ok = yield* buildSmall(pl.dimension, pl.location); say(ok ? "Dwelling built." : "Needs a cave floor."); })());
        break;
      case "info": if (isPl) say("\n" + info(pl)); break;
      case "preset": applyPreset(arg); say("Preset: " + arg); break;
      case "enable": cfg.enabled = true; saveConfig(); say("Enabled."); break;
      case "disable": cfg.enabled = false; saveConfig(); if (T.brain) vanish(T.brain, false); say("Disabled."); break;
      case "reset_memory": if (isPl) { const p = getP(pl); p.profile = Object.assign(newProfile(), { journal: p.profile.journal, gotItems: true }); p.profDirty = true; say("Memory reset."); } break;
      default: say("Unknown command: " + cmd);
    }
  });
});
