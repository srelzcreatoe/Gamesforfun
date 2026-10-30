// Slash commands (stable custom-command registry).
//   /tailwail:journal           anyone
//   /tailwail:settings          anyone (world section is operator-only)
//   /tailwail:debug <op> [arg]  game directors / operators only
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { ACT, SHOT } from "../core/ids.js";
import { JOURNAL } from "../core/journal.js";
import { PRESENCE_IDS } from "../core/presence_rules.js";
import { emptySchedule } from "../core/scheduler.js";
import { SETUP_IDS } from "../core/setups.js";
import * as fx from "./fx.js";
import { setDebug } from "./log.js";
import { getMemory, getSchedule, getSettings, resetMemory, saveSchedule, saveSettings } from "./store.js";
import { showGuide, showSettings } from "./ui.js";

const OPS = ["status", "spawn", "presence", "end", "stage", "memory", "resetmemory", "cooldown", "journal", "log", "setups", "restore", "anim"];

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
        s.jr = (1 << JOURNAL.length) - 1;
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
    case "anim":
      if (!p) return say("anim needs a player");
      director.rpCheck(p);
      say("§7" + animShowcase(director, p, arg));
      break;
    default:
      say("§7Unknown op. " + OPS.join(", "));
  }
}

/**
 * /tailwail:debug anim [name]  Spawns a passive Tailwail in front of you and plays every body
 * state and one-shot in turn (or just the named one), captioned, so you can see that the
 * resource pack's animations work.  If it stands still in one pose, the resource pack is
 * not the 3.x one (the chat line above says so too).
 */
function animShowcase(director, p, only) {
  const acts = Object.keys(ACT).filter((a) => a !== "shot" && a !== "death");
  const shots = Object.keys(SHOT);
  const list = [];
  for (const a of acts) if (!only || only === a) list.push({ kind: "act", name: a });
  for (const s of shots) if (!only || only === s) list.push({ kind: "shot", name: s });
  if (!list.length) return `unknown clip; acts: ${acts.join(", ")}; one-shots: ${shots.join(", ")}`;
  const view = p.getViewDirection();
  const h = Math.hypot(view.x, view.z) || 1;
  const at = { x: p.location.x + (view.x / h) * 7, y: p.location.y, z: p.location.z + (view.z / h) * 7 };
  let tw;
  try {
    tw = director.spawnShowcaseDummy(p, at);
  } catch (e) {
    return "could not spawn: " + e;
  }
  if (!tw) return "could not spawn";
  let i = 0;
  const next = () => {
    if (!tw.isValid || !p.isValid) return;
    if (i >= list.length) {
      tw.remove();
      p.onScreenDisplay.setActionBar("§7[Tailwail] showcase done");
      return;
    }
    const it = list[i++];
    let secs = 3;
    try {
      if (it.kind === "act") {
        tw.setProperty("tailwail:act", ACT[it.name]);
      } else {
        tw.setProperty("tailwail:act", SHOT[it.name].partial ? ACT.loco : ACT.shot);
        tw.playAnimation(SHOT[it.name].anim, { controller: SHOT[it.name].partial ? "tailwail_partial" : "tailwail_shot", blendOutTime: 0.15 });
        secs = Math.max(1.5, SHOT[it.name].len + 0.8);
      }
      p.onScreenDisplay.setActionBar(`§7[${i}/${list.length}] §f${it.kind === "act" ? "state" : "one-shot"}: ${it.name}`);
    } catch (e) {
      p.sendMessage("§c" + e);
    }
    system.runTimeout(next, Math.round(secs * 20));
  };
  system.runTimeout(next, 10);
  return `showcase: ${list.length} clips, about ${Math.round(list.length * 2.8)} s`;
}
