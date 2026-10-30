// Field guide and settings forms (@minecraft/server-ui, stable).
// World behaviour is operator-only; presentation preferences belong to each player.
import { CommandPermissionLevel, PlayerPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ADDON_VERSION, PRESETS } from "../config.js";
import { setDebug } from "./log.js";
import { getPrefs, getSettings, presetSettings, resetMemory, saveSettings, setPrefs } from "./store.js";

export function isOperator(p) {
  try {
    if (p.playerPermissionLevel === PlayerPermissionLevel.Operator) return true;
  } catch {
    /* fall through */
  }
  try {
    const lvl = p.commandPermissionLevel;
    return lvl === CommandPermissionLevel.GameDirectors || lvl === CommandPermissionLevel.Admin ||
      lvl === CommandPermissionLevel.Host || lvl === CommandPermissionLevel.Owner;
  } catch {
    return false;
  }
}

const PAGES = [
  {
    title: "What it is",
    body: [
      "§lTailwail§r is a towering, patient primate-like predator that lives in dark caves.",
      "It watches you. It rehearses you. Then it stops pretending.",
      "",
      "It is never random. Every encounter follows the same rules, and every rule has a sign you can learn.",
      "It hunts by sight. It cannot see through stone, and it cannot learn what it did not see.",
    ],
  },
  {
    title: "Its signs",
    body: [
      "§lPhase 1 - Watching§r: breathing far off, a tail dragging across stone, a hand at the edge of a pillar.",
      "While you look straight at it, it will not walk. When you look away, it moves.",
      "",
      "§lPhase 2 - Stand-off§r: it steps into view 8-12 blocks away and copies you, a second or two late.",
      "§7Dragging tail, slow breath§r: calm.",
      "§eTwitching tail, throat clicks, imitation gone wrong§r: it is getting agitated.",
      "§cRigid tail, silence, rising to full height§r: it has committed. This sign is never a bluff.",
      "",
      "§lPhase 3 - Pursuit§r: a long wind-up, then the wail. Looking at it no longer stops it.",
    ],
  },
  {
    title: "Surviving it",
    body: [
      "§lDuring a stand-off§r: brief glances are safe. Long stares, getting close, sprinting nearby and hitting it all make it worse.",
      "Backing away calmly, without sprinting, can end the encounter with no attack.",
      "",
      "§lAfter the wail§r: it is faster than you in the open. Break line of sight, turn corners, put walls between you.",
      "Its pursuit is finite. Out of sight for about 8 seconds and far enough away, and you are free.",
      "It can follow you into 2-high tunnels on all fours. It cannot fit through a 1-block-high gap.",
      "It can open wooden doors (hosts can disable this). It cannot open iron doors or break blocks.",
      "",
      "It never strikes through walls, and every strike is wound up first.",
    ],
  },
  {
    title: "It remembers",
    body: [
      "Tailwail keeps a small memory of what it has seen you do: crouching, looking up or down, stopping dead.",
      "One day it may do your gesture first.",
      "",
      "Memory is per player, small, and fades over time. It never makes it hit harder or warn you less.",
      "You can erase your own record in Settings.",
    ],
  },
  {
    title: "Troubleshooting",
    body: [
      "§lNo encounters?§r New players get a quiet grace period. Encounters need you underground in the dark,",
      "in Survival or Adventure, and never happen on Peaceful. After each one there is a cooldown.",
      "Operators can type §f/tailwail:debug status§r to see why.",
      "",
      "§lStuck or broken?§r Operators: §f/tailwail:debug end§r removes every Tailwail cleanly.",
      "§lNo sound?§r Check your Tailwail volume in Settings, then the game's Hostile Creatures volume.",
      "",
      "Install: import the .mcaddon, then enable both Tailwail packs on the world. No experiments needed.",
    ],
  },
];

export async function showGuide(player) {
  for (;;) {
    const f = new ActionFormData()
      .title("Tailwail Field Guide")
      .body(`§7v${ADDON_VERSION}. Read this before you go deep.`);
    for (const p of PAGES) f.button(p.title);
    f.button("Settings");
    const r = await f.show(player);
    if (r.canceled || r.selection === undefined) return;
    if (r.selection === PAGES.length) return showSettings(player);
    const page = PAGES[r.selection];
    const back = await new ActionFormData().title(page.title).body(page.body.join("\n")).button("Back").button("Close").show(player);
    if (back.canceled || back.selection === 1) return;
  }
}

export async function showSettings(player) {
  if (isOperator(player)) {
    const r = await new ActionFormData()
      .title("Tailwail Settings")
      .body("World behaviour affects everyone. Presentation is just for you.")
      .button("My presentation")
      .button("World behaviour (operator)")
      .show(player);
    if (r.canceled) return;
    if (r.selection === 1) return showWorldSettings(player);
  }
  return showPrefs(player);
}

async function showPrefs(player) {
  const p = getPrefs(player);
  const r = await new ModalFormData()
    .title("My Tailwail presentation")
    .slider("Tailwail volume (%)", 0, 100, { defaultValue: Math.round(p.volume * 100), valueStep: 10 })
    .dropdown("Optional effects", ["Off", "Subtle (no camera shake)", "Full"], { defaultValueIndex: p.effects })
    .toggle("Captions for important sounds", { defaultValue: p.captions })
    .toggle("Erase what Tailwail remembers about me", { defaultValue: false })
    .submitButton("Save")
    .show(player);
  if (r.canceled || !r.formValues) return;
  const [vol, fx, cap, erase] = r.formValues;
  setPrefs(player, { ...p, volume: Number(vol) / 100, effects: Number(fx), captions: !!cap });
  if (erase) {
    resetMemory(player);
    player.sendMessage("§7[Tailwail] Your memory record was erased.");
  }
  player.sendMessage("§7[Tailwail] Presentation saved.");
}

async function showWorldSettings(player) {
  if (!isOperator(player)) return showPrefs(player);
  const s = getSettings();
  const presets = ["balanced", "intense", "custom"];
  const r = await new ModalFormData()
    .title("Tailwail world behaviour")
    .toggle("Encounters enabled", { defaultValue: s.enabled })
    .dropdown("Preset (Balanced / Intense apply their values; Custom uses the sliders)", ["Balanced", "Intense - more often, harder, same rules", "Custom"], { defaultValueIndex: presets.indexOf(s.preset) })
    .slider("Encounter frequency (%)", 25, 200, { defaultValue: Math.round(s.frequency * 100), valueStep: 25 })
    .slider("Cooldown minimum (minutes)", 2, 30, { defaultValue: Math.round(s.cooldownMin / 60), valueStep: 1 })
    .slider("Cooldown maximum (minutes)", 3, 40, { defaultValue: Math.round(s.cooldownMax / 60), valueStep: 1 })
    .slider("New-player grace period (minutes)", 0, 30, { defaultValue: Math.round(s.graceSeconds / 60), valueStep: 1 })
    .slider("Strike damage (half-hearts)", 2, 20, { defaultValue: Math.round(s.damageHearts * 2), valueStep: 1 })
    .slider("Pursuit duration (seconds)", 15, 45, { defaultValue: s.pursuitSeconds, valueStep: 1 })
    .slider("Imitation frequency (%)", 0, 100, { defaultValue: Math.round(s.imitationChance * 100), valueStep: 5 })
    .toggle("Cave encounters", { defaultValue: s.caveEncounters })
    .toggle("Night woodland encounters (secondary, less tested)", { defaultValue: s.surfaceEncounters })
    .toggle("Can open wooden doors", { defaultValue: s.openDoors })
    .slider("Max simultaneous Tailwails in the world", 1, 3, { defaultValue: s.maxConcurrent, valueStep: 1 })
    .toggle("Debug logging to content log", { defaultValue: s.debugLog })
    .submitButton("Apply")
    .show(player);
  if (r.canceled || !r.formValues) return;
  const v = r.formValues;
  const presetName = presets[Number(v[1])];
  let next = {
    ...s,
    enabled: !!v[0],
    preset: presetName,
    frequency: Number(v[2]) / 100,
    cooldownMin: Number(v[3]) * 60,
    cooldownMax: Number(v[4]) * 60,
    graceSeconds: Number(v[5]) * 60,
    damageHearts: Number(v[6]) / 2,
    pursuitSeconds: Number(v[7]),
    imitationChance: Number(v[8]) / 100,
    caveEncounters: !!v[9],
    surfaceEncounters: !!v[10],
    openDoors: !!v[11],
    maxConcurrent: Number(v[12]),
    debugLog: !!v[13],
  };
  if (presetName !== "custom" && presetName !== s.preset) next = presetSettings(next, presetName);
  const saved = saveSettings(next);
  setDebug(saved.debugLog);
  player.sendMessage(`§7[Tailwail] World settings applied (${saved.preset}). New values apply to the next encounter.`);
}

export const PRESET_NAMES = Object.keys(PRESETS);
