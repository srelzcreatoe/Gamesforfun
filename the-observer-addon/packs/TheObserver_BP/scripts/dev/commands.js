// @ts-check
// Developer and operator controls. Separate from normal play: the gameplay commands require
// cheats; settings/status require operator permission.
//
//   /observer:status [player]                 director + memory summary
//   /observer:trigger <encounter> [player]     force an encounter (bypasses timers/stage)
//   /observer:stage <0-5> [player]             set a player's stage
//   /observer:skipgrace [player]               end the grace period now
//   /observer:reset [player]                   forget everything about a player
//   /observer:restore                          restore every recorded world change now
//   /observer:abort                            abort running encounters
//   /observer:debug <on>                       dev tracing to the content log
//   /observer:preset <preset>                  apply a preset
//   /observer:settings                         open the settings form
//   /observer:journal                          open the Field Notes without the item
//   /observer:tools [player]                   give the tool set (testing)
// Each also works as /scriptevent observer:<name> <args...> (console, command blocks, tests).
import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, ItemStack } from "@minecraft/server";
import { ps, W, now, resetPlayer, markPlayerDirty, markWorldDirty, warp } from "../core/state.js";
import { S, updateSettings, PRESETS } from "../core/settings.js";
import { DEBUG, safe, V, dimIndex, allPlayers } from "../core/util.js";
import { ITEMS } from "../core/constants.js";
import { DISCOVERIES } from "../progression/discoveries.js";
import * as director from "../director/director.js";
import * as ledger from "../world/ledger.js";
import * as body from "../observer/body.js";
import { primaryHaunt, dominantHabit, routeFamiliarity } from "../observer/memory.js";
import { openSettings, openJournal, showLater } from "../ui/forms.js";
import { validateWards } from "../progression/items.js";
import { animalsFace } from "../world/manipulate.js";

/** @typedef {import("@minecraft/server").Player} Player */

export function status(p) {
  const s = ps(p);
  const t = now();
  const h = primaryHaunt(p);
  const enc = director.encounterFor(p.id);
  return [
    `§7[Observer] §f${p.name}: stage ${s.stage} exposure ${s.exposure.toFixed(0)} tension ${s.tension.toFixed(0)} encounters ${s.encCount}`,
    `§7 timers: next ${Math.max(0, s.nextAt - t).toFixed(0)}s quiet ${Math.max(0, s.quietUntil - t).toFixed(0)}s recovery ${Math.max(0, s.recoveryUntil - t).toFixed(0)}s play ${s.play.toFixed(0)}s (grace ${S().graceMinutes}m)`,
    `§7 pages ${s.disc.length}: ${s.disc.join(", ") || "-"}`,
    `§7 memory: haunt ${h ? V.str(h.center) : "-"} habit ${dominantHabit(p) ?? "-"} route ${routeFamiliarity(p)} crumbs ${s.crumbs.length} bearing ${s.bearing || "-"} attn ${s.attn.toFixed(2)}`,
    `§7 world: active ${enc ? `${enc.def.id}#${enc.id}` : "-"} body ${body.exists() ? "yes" : "no"} ledger ${ledger.count()} wards ${W.wards.length} preset ${S().preset}`,
    `§7 recent: ${s.hist.slice(-5).map((x) => `${x[0]}:${x[2]}`).join(" ") || "-"}`,
  ].join("\n");
}

/** @param {string} name @param {string[]} args @param {Player|undefined} caller @returns {string} */
export function run(name, args, caller) {
  const findPlayer = (n) => allPlayers().find((x) => x.name === n);
  const pick = (idx) => (args[idx] ? findPlayer(args[idx]) : caller ?? allPlayers()[0]);
  switch (name) {
    case "status": {
      const p = pick(0);
      return p ? status(p) : "no player";
    }
    case "trigger": {
      const def = director.byId(args[0]);
      const p = pick(1);
      if (!def || !p) return `usage: trigger <${director.REGISTRY.map((d) => d.id).join("|")}> [player]`;
      const enc = director.start(def, p, undefined, true);
      return enc ? `started ${def.id}#${enc.id} for ${p.name}` : "could not start";
    }
    case "stage": {
      const p = pick(1);
      const n = Math.max(0, Math.min(5, parseInt(args[0], 10) || 0));
      if (!p) return "no player";
      const s = ps(p);
      s.stage = n;
      if (n > 0 && s.play < S().graceMinutes * 60) s.play = S().graceMinutes * 60;
      markPlayerDirty(p);
      return `${p.name} stage=${n}`;
    }
    case "skipgrace": {
      const p = pick(0);
      if (!p) return "no player";
      const s = ps(p);
      s.play = Math.max(s.play, S().graceMinutes * 60);
      s.nextAt = now();
      markPlayerDirty(p);
      return `${p.name}: grace skipped`;
    }
    case "reset": {
      const p = pick(0);
      if (!p) return "no player";
      director.abortFor(p.id, "dev");
      resetPlayer(p);
      return `${p.name}: state reset`;
    }
    case "restore": {
      const r = ledger.restoreAll();
      return `restored ${r.restored}, pending (unloaded) ${r.pending}`;
    }
    case "pause":
      director.control.paused = args[0] !== "off";
      return `director ${director.control.paused ? "paused" : "running"}`;
    case "abort":
      director.abortAll("dev");
      return "aborted";
    case "debug":
      updateSettings({ dev: args[0] === "on" || args[0] === "true" });
      DEBUG.trace = S().dev;
      return `debug ${S().dev ? "on" : "off"}`;
    case "lunge":
      DEBUG.lunge = args[0] === "always" || args[0] === "never" ? args[0] : "auto";
      return `lunge ${DEBUG.lunge}`;
    case "trace":
      DEBUG.trace = args[0] !== "off";
      return `trace ${DEBUG.trace ? "on" : "off"}`;
    case "preset":
      if (!PRESETS[args[0]]) return `presets: ${Object.keys(PRESETS).join(", ")}`;
      updateSettings({ preset: args[0] });
      return `preset ${args[0]}`;
    case "set": {
      // set <key> <value> (tests): numeric/boolean settings; "set off a,b,c" switches encounter types off
      const k = args[0];
      if (k === "off") {
        updateSettings({ off: (args[1] ?? "").split(",").filter(Boolean) });
        return `off=${S().off.join(",")}`;
      }
      const v = args[1] === "true" ? true : args[1] === "false" ? false : Number(args[1]);
      updateSettings({ [k]: v, preset: "custom" });
      return `${k}=${S()[k]}`;
    }
    case "settings":
      if (caller) showLater(() => openSettings(caller));
      return "";
    case "journal":
      if (caller) showLater(() => openJournal(caller, (pl) => director.start(director.byId("vigil"), pl, undefined, true)));
      return "";
    case "tools": {
      const p = pick(0);
      if (!p) return "no player";
      const inv = p.getComponent("minecraft:inventory")?.container;
      /** @type {[string, number][]} */
      const kit = [[ITEMS.notes, 1], [ITEMS.chalk, 16], [ITEMS.lens, 1], [ITEMS.ward, 2], [ITEMS.vestige, 4]];
      for (const [id, n] of kit) safe(() => inv?.addItem(new ItemStack(id, n)));
      return `tools given to ${p.name}`;
    }
    case "sethaunt": {
      // sethaunt [x y z] [player]: make a location the player's home (testing home visits / the vigil)
      const hasXYZ = args.length >= 3 && !isNaN(Number(args[0]));
      const p = pick(hasXYZ ? 3 : 0);
      if (!p) return "no player";
      const l = hasXYZ ? { x: Number(args[0]), y: Number(args[1]), z: Number(args[2]) } : p.location;
      const s = ps(p);
      const d = dimIndex(p.dimension.id);
      s.haunts = s.haunts.filter((h) => !(h[0] === d && h[1] === Math.floor(l.x / 16) && h[2] === Math.floor(l.z / 16)));
      s.haunts.unshift([d, Math.floor(l.x / 16), Math.floor(l.z / 16), 5000, now() - 900, Math.floor(l.y)]);
      markPlayerDirty(p);
      return `${p.name}: haunt at ${V.str(l)}`;
    }
    case "grantpages": {
      const p = pick(1);
      if (!p) return "no player";
      const s = ps(p);
      const n = Math.min(DISCOVERIES.length, parseInt(args[0], 10) || 0);
      for (const id of DISCOVERIES) if (s.disc.length < n && !s.disc.includes(id)) s.disc.push(id);
      markPlayerDirty(p);
      return `${p.name}: ${s.disc.length} pages`;
    }
    case "timewarp": {
      const sec = Number(args[0]) || 0;
      warp(sec);
      return `clock advanced ${sec}s`;
    }
    case "animals": {
      // animals [player]: make nearby animals face a point 20 blocks ahead of the player (tests M8)
      const p = pick(0);
      if (!p) return "no player";
      const ahead = V.add(p.location, V.scale(V.flat(p.getViewDirection()), 20));
      const n = animalsFace(p.dimension, p.location, ahead, 24, 100);
      return `animals turned: ${n} toward ${V.str(ahead)}`;
    }
    case "wards": {
      validateWards();
      return `wards ${W.wards.length}: ` + W.wards.map((w) => w.join(",")).join(" ");
    }
    case "ledger": {
      return `ledger ${ledger.count()}: ` + ledger.all().slice(0, 12).map((e) => `${e.kind}@${e.x},${e.y},${e.z}#${e.enc}`).join(" ");
    }
    case "dump": {
      const p = pick(0);
      return p ? JSON.stringify(ps(p)).slice(0, 1500) : "no player";
    }
    default:
      return `unknown command ${name}`;
  }
}

function reply(caller, msg) {
  if (!msg) return;
  if (caller) safe(() => caller.sendMessage(msg));
  console.warn(`[Observer] ${msg.replace(/§./g, "")}`);
}

export function register() {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (!ev.id.startsWith("observer:")) return;
    const name = ev.id.slice("observer:".length);
    const args = ev.message.trim().length ? ev.message.trim().split(/\s+/) : [];
    const caller = ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player" ? /** @type {Player} */ (ev.sourceEntity) : undefined;
    reply(caller, run(name, args, caller));
  });
}

const DESCRIPTIONS = {
  "status": "Show The Observer's state for a player",
  "trigger": "Force a specific encounter (testing)",
  "stage": "Set a player's Observer stage (testing)",
  "skipgrace": "End a player's grace period now (testing)",
  "reset": "Forget everything The Observer knows about a player",
  "restore": "Restore every block The Observer changed",
  "abort": "Abort running encounters",
  "debug": "Toggle developer tracing",
  "preset": "Apply a settings preset",
  "settings": "Open The Observer settings",
  "journal": "Open your Field Notes",
  "tools": "Give The Observer tool set (testing)"
};

/** Custom slash commands (registered during startup). */
export function registerCommands(registry) {
  registry.registerEnum("observer:encounter", director.REGISTRY.map((d) => d.id));
  registry.registerEnum("observer:preset", Object.keys(PRESETS));
  const P = CustomCommandParamType;
  const defs = [
    { name: "status", cheats: false, opt: [{ name: "player", type: P.PlayerSelector }] },
    { name: "trigger", cheats: true, man: [{ name: "observer:encounter", type: P.Enum }], opt: [{ name: "player", type: P.PlayerSelector }] },
    { name: "stage", cheats: true, man: [{ name: "stage", type: P.Integer }], opt: [{ name: "player", type: P.PlayerSelector }] },
    { name: "skipgrace", cheats: true, opt: [{ name: "player", type: P.PlayerSelector }] },
    { name: "reset", cheats: true, opt: [{ name: "player", type: P.PlayerSelector }] },
    { name: "restore", cheats: false },
    { name: "abort", cheats: true },
    { name: "debug", cheats: true, man: [{ name: "enabled", type: P.Boolean }] },
    { name: "preset", cheats: false, man: [{ name: "observer:preset", type: P.Enum }] },
    { name: "settings", cheats: false },
    { name: "journal", cheats: false, perm: CommandPermissionLevel.Any },
    { name: "tools", cheats: true, opt: [{ name: "player", type: P.PlayerSelector }] },
  ];
  for (const d of defs) {
    registry.registerCommand({
      name: `observer:${d.name}`,
      description: DESCRIPTIONS[d.name] ?? d.name,
      permissionLevel: d.perm ?? CommandPermissionLevel.GameDirectors,
      cheatsRequired: d.cheats,
      mandatoryParameters: d.man ?? [],
      optionalParameters: d.opt ?? [],
    }, (origin, ...vals) => {
      const caller = origin.sourceEntity && origin.sourceEntity.typeId === "minecraft:player" ? /** @type {Player} */ (origin.sourceEntity) : undefined;
      const args = vals.map((v) => (Array.isArray(v) ? (v[0]?.name ?? "") : typeof v === "boolean" ? (v ? "on" : "off") : String(v)));
      system.run(() => reply(caller, run(d.name, args, caller)));
      return { status: CustomCommandStatus.Success };
    });
  }
}
