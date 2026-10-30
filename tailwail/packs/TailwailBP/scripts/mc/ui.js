// The torn journal and the settings forms (@minecraft/server-ui, stable).
// World behaviour is operator-only; presentation preferences belong to each player.
import { CommandPermissionLevel, PlayerPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ADDON_VERSION, PRESETS } from "../config.js";
import { JOURNAL } from "../core/journal.js";
import { setDebug } from "./log.js";
import { getPrefs, getSchedule, getSettings, presetSettings, resetMemory, saveSettings, setPrefs } from "./store.js";

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

const HELP = [
  "§lTAILWAIL§r v" + ADDON_VERSION,
  "",
  "It lives in the dark: caves, mines, ravines, and outside at night.",
  "It watches you first. Not for long. Then it comes, faster than you can run.",
  "",
  "§lIf it grabs you:§r read the prompt. Mash JUMP, mash SNEAK, alternate, or stay still.",
  "It is different every time.",
  "",
  "§lNo sign of it?§r Spend time underground (or outside at night) in Survival. It gets",
  "worse the longer you play. Never on Peaceful.",
  "§lOperators:§r §f/tailwail:debug status§r explains what it is waiting for;",
  "§f/tailwail:debug end§r removes every Tailwail and restores every player.",
  "",
  "Install: import the .mcaddon and enable both packs. No experiments needed.",
];

export async function showGuide(player) {
  for (;;) {
    const s = getSchedule(player);
    const f = new ActionFormData().title("Torn Journal").body("§7The handwriting gets worse toward the end.");
    const pages = JOURNAL.map((p, i) => ({ p, open: (s.jr & (1 << i)) !== 0 }));
    for (const { p, open } of pages) f.button(open ? p.title : "§8(torn out)");
    f.button("§lSettings");
    f.button("Help");
    const r = await f.show(player);
    if (r.canceled || r.selection === undefined) return;
    if (r.selection === pages.length) return showSettings(player);
    if (r.selection === pages.length + 1) {
      const back = await new ActionFormData().title("Help").body(HELP.join("\n")).button("Back").button("Close").show(player);
      if (back.canceled || back.selection === 1) return;
      continue;
    }
    const pg = pages[r.selection];
    const body = pg.open ? pg.p.text : "§8This page has been torn out. Maybe you haven't lived it yet.";
    const back = await new ActionFormData().title(pg.open ? pg.p.title : "Torn out").body(body).button("Back").button("Close").show(player);
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
    .dropdown("Camera effects (shake, FOV, fades)", ["Off", "Reduced (gentle shake only)", "Full"], { defaultValueIndex: p.camera })
    .toggle("Music during encounters", { defaultValue: p.music })
    .toggle("Dread fog during encounters", { defaultValue: p.fog })
    .toggle("Captions for important sounds", { defaultValue: p.captions })
    .toggle("Erase everything Tailwail knows about me (memory, stage, journal)", { defaultValue: false })
    .submitButton("Save")
    .show(player);
  if (r.canceled || !r.formValues) return;
  const [vol, cam, mus, fog, cap, erase] = r.formValues;
  setPrefs(player, { ...p, volume: Number(vol) / 100, camera: Number(cam), music: !!mus, fog: !!fog, captions: !!cap });
  if (erase) {
    resetMemory(player);
    player.sendMessage("§7[Tailwail] It has forgotten you. For now.");
  }
  player.sendMessage("§7[Tailwail] Presentation saved.");
}

async function showWorldSettings(player) {
  if (!isOperator(player)) return showPrefs(player);
  const s = getSettings();
  const presets = [...Object.keys(PRESETS), "custom"];
  const r = await new ModalFormData()
    .title("Tailwail world behaviour")
    .toggle("Tailwail enabled", { defaultValue: s.enabled })
    .dropdown("Difficulty (Custom keeps the sliders below)", ["Calm", "Standard", "Nightmare", "Custom"], { defaultValueIndex: Math.max(0, presets.indexOf(s.preset)) })
    .slider("Encounter frequency (%)", 25, 200, { defaultValue: Math.round(s.frequency * 100), valueStep: 25 })
    .dropdown("Haunting between encounters", ["Off", "Rare", "Normal", "Constant"], { defaultValueIndex: s.presence })
    .toggle("Grab and struggle (off: plain strikes)", { defaultValue: s.grab })
    .toggle("Jumpscares (behind you, bed visits)", { defaultValue: s.jumpscares })
    .toggle("Fake chat messages (only the haunted player sees them)", { defaultValue: s.fakeChat })
    .toggle("It puts out torches (they can be relit)", { defaultValue: s.torchSnuff })
    .toggle("Cave encounters", { defaultValue: s.caveEncounters })
    .toggle("Night encounters outside", { defaultValue: s.surfaceEncounters })
    .toggle("Can open wooden doors", { defaultValue: s.openDoors })
    .dropdown("Breaks through", ["Nothing", "Doors, trapdoors, gates", "Doors and glass"], { defaultValueIndex: s.breakBlocks })
    .toggle("Climbs walls to reach you", { defaultValue: s.climbing })
    .toggle("Ceiling and corner ambushes", { defaultValue: s.ambushes })
    .slider("Rake damage (half-hearts)", 1, 20, { defaultValue: s.swipeDamage, valueStep: 1 })
    .slider("Bite damage (half-hearts)", 1, 30, { defaultValue: s.biteDamage, valueStep: 1 })
    .slider("Struggle: fewest presses", 2, 16, { defaultValue: s.struggleMin, valueStep: 1 })
    .slider("Struggle: most presses", 3, 20, { defaultValue: s.struggleMax, valueStep: 1 })
    .slider("Seconds out of sight before it loses you", 4, 16, { defaultValue: s.lostSeconds, valueStep: 1 })
    .slider("Max Tailwails in the world at once", 1, 3, { defaultValue: s.maxConcurrent, valueStep: 1 })
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
    presence: Number(v[3]),
    grab: !!v[4],
    jumpscares: !!v[5],
    fakeChat: !!v[6],
    torchSnuff: !!v[7],
    caveEncounters: !!v[8],
    surfaceEncounters: !!v[9],
    openDoors: !!v[10],
    breakBlocks: Number(v[11]),
    climbing: !!v[12],
    ambushes: !!v[13],
    swipeDamage: Number(v[14]),
    biteDamage: Number(v[15]),
    struggleMin: Number(v[16]),
    struggleMax: Math.max(Number(v[16]), Number(v[17])),
    lostSeconds: Number(v[18]),
    maxConcurrent: Number(v[19]),
    debugLog: !!v[20],
  };
  if (presetName !== "custom" && presetName !== s.preset) next = presetSettings(next, presetName);
  const saved = saveSettings(next);
  setDebug(saved.debugLog);
  player.sendMessage(`§7[Tailwail] World settings applied (${saved.preset}). New values apply to the next encounter.`);
}
