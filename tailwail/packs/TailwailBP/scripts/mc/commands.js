// Slash commands (stable custom-command registry).
//   /tailwail:journal           anyone
//   /tailwail:settings          anyone (world section is operator-only)
//   /tailwail:debug <op> [arg]  game directors / operators only
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { PRESENCE_IDS } from "../core/presence_rules.js";
import { emptySchedule } from "../core/scheduler.js";
import { SETUP_IDS } from "../core/setups.js";
import * as fx from "./fx.js";
import { setDebug } from "./log.js";
import { getMemory, getSchedule, getSettings, resetMemory, saveSchedule, saveSettings } from "./store.js";
import { showGuide, showSettings } from "./ui.js";

const OPS = ["status", "spawn", "presence", "end", "stage", "memory", "resetmemory", "cooldown", "journal", "log", "setups", "restore"];

export function registerCommands(registry, director) {
  registry.registerEnum("tailwail:debug_op", OPS);
  const ok = () => ({ status: CustomCommandStatus.Success });
  const playerOf = (origin) => {
    const e = origin.sourceEntity || origin.initiator;
    return e instanceof Player ? e : undefined;
  };

  registry.registerCommand(
    { name: "tailwail:journal", description: "Open the torn journal", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const p = playerOf(origin);
      if (!p) return { status: CustomCommandStatus.Failure, message: "Run this as a player." };
      system.run(() => showGuide(p));
      return ok();
    },
  );

  registry.registerCommand(
    { name: "tailwail:settings", description: "Tailwail settings (world options need operator)", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const p = playerOf(origin);
      if (!p) return { status: CustomCommandStatus.Failure, message: "Run this as a player." };
      system.run(() => showSettings(p));
      return ok();
    },
  );

  registry.registerCommand(
    {
      name: "tailwail:debug",
      description: "Tailwail diagnostics (operators)",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      mandatoryParameters: [{ name: "tailwail:debug_op", type: CustomCommandParamType.Enum }],
      optionalParameters: [{ name: "arg", type: CustomCommandParamType.String }],
    },
    (origin, op, arg) => {
      const p = playerOf(origin);
      system.run(() => runDebug(director, p, op, arg));
      return ok();
    },
  );
}

export function runDebug(director, p, op, arg) {
  const say = (m) => (p ? p.sendMessage(m) : console.warn("[Tailwail] " + m.replace(/§./g, "")));
  switch (op) {
    case "status":
      say(director.status(p));
      break;
    case "spawn":
      if (!p) return say("spawn needs a player");
      say("§7" + director.forceEncounter(p, arg && SETUP_IDS.includes(arg) ? arg : undefined));
      break;
    case "presence":
      if (!p) return say("presence needs a player");
      say("§7" + director.forcePresence(p, arg || "glimpse"));
      break;
    case "end":
      director.endAll("aborted");
      say("§7All Tailwail encounters ended and cleaned up.");
      break;
    case "stage": {
      if (!p) return;
      const s = getSchedule(p);
      const n = Math.max(0, Math.min(3, parseInt(arg || "0", 10) || 0));
      s.stage = n;
      saveSchedule(p, s);
      say(`§7Your escalation stage is now ${n}.`);
      break;
    }
    case "memory":
      if (p) say("§7" + JSON.stringify(getMemory(p)) + "\n" + JSON.stringify(getSchedule(p)));
      break;
    case "resetmemory":
      if (p) resetMemory(p);
      say("§7Memory, stage and journal reset.");
      break;
    case "cooldown":
      if (p) {
        const s = getSchedule(p);
        saveSchedule(p, { ...emptySchedule(), ...s, wait: 0, presWait: 0 });
      }
      say("§7Waits cleared for you.");
      break;
    case "journal":
      if (p) {
        const s = getSchedule(p);
        s.jr = (1 << 13) - 1;
        saveSchedule(p, s);
        say("§7Every journal page unlocked.");
      }
      break;
    case "log": {
      const s = getSettings();
      const on = arg ? arg === "on" : !s.debugLog;
      saveSettings({ ...s, debugLog: on });
      setDebug(on);
      say(`§7Debug log ${on ? "on" : "off"}.`);
      break;
    }
    case "setups":
      say("§7Setups: " + SETUP_IDS.join(", ") + "\n§7Presence: " + PRESENCE_IDS.join(", "));
      break;
    case "restore":
      if (p) fx.clearAll(p, true);
      say("§7Camera, FOV, fog, music and input restored.");
      break;
    default:
      say("§7Unknown op. " + OPS.join(", "));
  }
}
