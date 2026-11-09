// @ts-check
// The Config Wheel: in-game settings (presets, pacing, creature, learning, environment, territory,
// audio, accessibility) and admin/testing tools.
import { world, system, PlayerPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { cfg, saveConfig, applyPreset, PRESETS, resetConfig } from "../core/config.js";
import { W, markDirty, saveWorld } from "../core/state.js";
import { guard, fmt, dist, DEBUG } from "../core/util.js";
import { T } from "../ai/threat.js";
import { getP } from "../ai/players.js";
import { newProfile } from "../core/state.js";
import { openJournal, showForm } from "./journal.js";
import { nearestHollow, territoryAt, forceHollow, genStats } from "../world/territory.js";
import { buildSmall } from "../world/dwelling.js";
import { startEncounter } from "../ai/director.js";
import { forceState, vanish } from "../ai/dweller.js";
import { abilities } from "../ai/memory.js";
import { runIllusion } from "../fx/illusions.js";

function isOp(pl) {
  try { return pl.playerPermissionLevel === PlayerPermissionLevel.Operator; } catch { return true; }
}
const canEdit = (pl) => !cfg.opsOnlyConfig || isOp(pl);
const pct = (v) => Math.round(v * 100);

/** @param {import("@minecraft/server").Player} pl */
export function openConfig(pl) {
  const status = T.brain ? `§cActive: ${T.brain.state}§r` : "§7Nothing is hunting right now§r";
  const tr = territoryAt(pl.location);
  const f = new ActionFormData().title("§4The Shaftbreaker§r - Config Wheel")
    .body(`${cfg.enabled ? "§aEnabled" : "§cDisabled"}§r   Preset: ${PRESETS[cfg.preset] ? PRESETS[cfg.preset].label : "Custom"}\n${status}` +
      (tr ? `\n§4You are inside its territory (${pct(tr.s)}%).§r` : "") + (canEdit(pl) ? "" : "\n§eOnly operators can change settings."));
  const items = [
    ["Presets", () => presetMenu(pl)],
    ["Encounters & Pacing", () => pacingMenu(pl)],
    ["The Creature", () => creatureMenu(pl)],
    ["Adaptive AI", () => learningMenu(pl)],
    ["Illusions & Environment", () => envMenu(pl)],
    ["Territory & Dwellings", () => territoryMenu(pl)],
    ["Audio", () => audioMenu(pl)],
    ["Accessibility", () => accessMenu(pl)],
    ["Field Journal", () => openJournal(pl)],
  ];
  if (isOp(pl)) items.push(["§8Admin & Testing Tools", () => adminMenu(pl)]);
  for (const [label] of items) f.button(/** @type {string} */ (label));
  showForm(pl, f, (r) => {
    if (r.canceled || r.selection === undefined) return;
    const it = items[r.selection];
    if (it) /** @type {any} */ (it[1])();
  });
}

function guardEdit(pl, fn) {
  if (!canEdit(pl)) { pl.sendMessage("§eOnly operators can change Shaftbreaker settings."); return; }
  fn();
}

function presetMenu(pl) {
  const keys = Object.keys(PRESETS);
  const f = new ActionFormData().title("Presets").body(keys.map((k) => `§l${PRESETS[k].label}§r: ${PRESETS[k].desc}`).join("\n\n"));
  for (const k of keys) f.button((cfg.preset === k ? "§2> " : "") + PRESETS[k].label);
  f.button("Reset everything to defaults");
  f.button("Back");
  showForm(pl, f, (r) => {
    if (r.canceled || r.selection === undefined) return;
    if (r.selection < keys.length) guardEdit(pl, () => { applyPreset(keys[r.selection]); pl.sendMessage(`§7Preset: ${PRESETS[keys[r.selection]].label}`); });
    else if (r.selection === keys.length) guardEdit(pl, () => { resetConfig(); pl.sendMessage("§7Settings reset."); });
    else openConfig(pl);
  });
}

/** builds a modal from a field list and applies values back to cfg */
function modal(pl, title, fields, after) {
  const f = new ModalFormData().title(title);
  for (const fd of fields) {
    if (fd.t === "toggle") f.toggle(fd.label, { defaultValue: !!cfg[fd.k] });
    else if (fd.t === "slider") f.slider(fd.label, fd.min, fd.max, { valueStep: fd.step || 1, defaultValue: Math.round((fd.scale ? cfg[fd.k] * fd.scale : cfg[fd.k])) });
    else if (fd.t === "dropdown") f.dropdown(fd.label, fd.items, { defaultValueIndex: fd.values ? Math.max(0, fd.values.indexOf(cfg[fd.k])) : cfg[fd.k] });
  }
  f.submitButton("Save");
  showForm(pl, f, (r) => {
    if (r.canceled || !r.formValues) { openConfig(pl); return; }
    guardEdit(pl, () => {
      const vals = r.formValues;
      fields.forEach((fd, i) => {
        const v = vals[i];
        if (v === undefined) return;
        if (fd.t === "toggle") cfg[fd.k] = !!v;
        else if (fd.t === "slider") cfg[fd.k] = fd.scale ? Number(v) / fd.scale : Number(v);
        else if (fd.t === "dropdown") cfg[fd.k] = fd.values ? fd.values[Number(v)] : Number(v);
      });
      cfg.preset = "custom";
      saveConfig();
      if (after) after(vals);
      pl.sendMessage("§7Shaftbreaker settings saved.");
    });
    openConfig(pl);
  });
}

function pacingMenu(pl) {
  modal(pl, "Encounters & Pacing", [
    { t: "toggle", k: "enabled", label: "The Shaftbreaker is active (master switch)" },
    { t: "slider", k: "graceMinutes", label: "Grace period before the first encounter (minutes)", min: 0, max: 60 },
    { t: "slider", k: "encounterRate", label: "Encounter frequency (%)", min: 25, max: 300, step: 5, scale: 100 },
    { t: "slider", k: "minEncounterGap", label: "Minimum gap between encounters (seconds)", min: 30, max: 900, step: 10 },
    { t: "slider", k: "recoverySeconds", label: "Quiet period after a hunt (seconds)", min: 30, max: 1200, step: 15 },
    { t: "slider", k: "maxHuntSeconds", label: "Maximum hunt duration (seconds)", min: 20, max: 300, step: 5 },
    { t: "toggle", k: "minorEvents", label: "Sounds and illusions between encounters" },
  ], () => { if (!cfg.enabled && T.brain) vanish(T.brain, false); });
}

function creatureMenu(pl) {
  modal(pl, "The Creature", [
    { t: "dropdown", k: "tier", label: "Toughness (health and damage)", items: ["Easy", "Normal", "Brutal"], values: ["easy", "normal", "brutal"] },
    { t: "slider", k: "aggression", label: "Aggression (%) - 0 = Harmless (never attacks)", min: 0, max: 200, step: 5, scale: 100 },
    { t: "slider", k: "speed", label: "Chase speed (%)", min: 70, max: 140, step: 5, scale: 100 },
    { t: "toggle", k: "surfacePursuit", label: "May follow you to the surface during a chase" },
    { t: "toggle", k: "lowHealthEscape", label: "Flees when badly wounded" },
    { t: "toggle", k: "shieldDisable", label: "Its strikes can disable shields" },
    { t: "toggle", k: "darknessOnHit", label: "Darkness effect when it hits you" },
  ]);
}

function learningMenu(pl) {
  modal(pl, "Adaptive AI", [
    { t: "toggle", k: "learning", label: "It learns from how you play" },
    { t: "slider", k: "learningStrength", label: "Learning speed (%)", min: 25, max: 200, step: 5, scale: 100 },
  ]);
}

function envMenu(pl) {
  modal(pl, "Illusions & Environment", [
    { t: "toggle", k: "illusions", label: "Illusions (false sounds, eyes in the dark...)" },
    { t: "slider", k: "illusionRate", label: "Illusion frequency (%)", min: 25, max: 250, step: 5, scale: 100 },
    { t: "toggle", k: "phantoms", label: "False sightings of the creature" },
    { t: "dropdown", k: "torchMode", label: "Torch extinguishing", items: ["Off", "During encounters", "Frequent"] },
    { t: "toggle", k: "doors", label: "Door interaction (opening, taunting)" },
    { t: "dropdown", k: "breakMode", label: "Block breaking", items: ["Never", "Natural stone only", "Natural + basic walls (cobble, dirt, planks, glass)"] },
    { t: "toggle", k: "scratchMarks", label: "Claw marks appear in the stone" },
    { t: "toggle", k: "pathSealing", label: "Sinew seals passages behind you (territory)" },
  ]);
}

function territoryMenu(pl) {
  modal(pl, "Territory & Dwellings", [
    { t: "toggle", k: "territory", label: "Generate its territory (the Hollow)" },
    { t: "dropdown", k: "territoryFrequency", label: "Territory frequency (new areas)", items: ["Rare", "Normal", "Common"] },
    { t: "dropdown", k: "territorySize", label: "Territory size (new areas)", items: ["Small", "Normal", "Large"] },
    { t: "toggle", k: "mobFear", label: "Mobs avoid its territory" },
    { t: "toggle", k: "moths", label: "Grinning Moths" },
    { t: "toggle", k: "dwellings", label: "Dwellings" },
    { t: "toggle", k: "loneDwellings", label: "Rare lone Dwellings in ordinary caves" },
    { t: "slider", k: "protectRadius", label: "Protected radius around a destroyed Dwelling", min: 16, max: 160, step: 8 },
    { t: "slider", k: "finalConfrontation", label: "Chance of a final confrontation (%)", min: 0, max: 100, step: 5 },
  ]);
}

function audioMenu(pl) {
  modal(pl, "Audio", [
    { t: "slider", k: "heartbeatVolume", label: "Heartbeat volume (%)", min: 0, max: 150, step: 5, scale: 100 },
    { t: "slider", k: "ambienceVolume", label: "Ambience volume (%)", min: 0, max: 150, step: 5, scale: 100 },
    { t: "slider", k: "screamVolume", label: "Scream / stinger volume (%)", min: 0, max: 150, step: 5, scale: 100 },
    { t: "dropdown", k: "musicMode", label: "Encounter music", items: ["Off", "Music channel", "Sound-effect channel"] },
    { t: "slider", k: "musicVolume", label: "Music volume (%)", min: 0, max: 150, step: 5, scale: 100 },
  ]);
}

function accessMenu(pl) {
  modal(pl, "Accessibility", [
    { t: "toggle", k: "screenEffects", label: "Screen effects (darkness pulses)" },
    { t: "toggle", k: "reducedParticles", label: "Reduced particles" },
    { t: "toggle", k: "captions", label: "Sound captions (action bar)" },
    { t: "toggle", k: "opsOnlyConfig", label: "Only operators may change settings" },
    { t: "toggle", k: "debug", label: "Debug messages" },
  ], () => { DEBUG.on = cfg.debug; });
}

function adminMenu(pl) {
  const f = new ActionFormData().title("Admin & Testing Tools").body(info(pl));
  const acts = [
    ["Summon: stalking (near me)", () => startEncounter(pl, getP(pl), "stalk")],
    ["Summon: standoff", () => startEncounter(pl, getP(pl), "standoff")],
    ["Summon: hunting", () => startEncounter(pl, getP(pl), "scream")],
    ["Force phase: stalk", () => forceState("stalk", pl)],
    ["Force phase: standoff", () => forceState("standoff", pl)],
    ["Force phase: hunt", () => forceState("hunt", pl)],
    ["Cancel the encounter", () => { if (T.brain) vanish(T.brain, true); }],
    ["Play a random illusion", () => runIllusion(pl, getP(pl))],
    ["Locate the nearest Hollow", () => {
      const h = nearestHollow(pl.location);
      pl.sendMessage(h ? `§7Nearest Hollow centre: ${fmt({ x: h.cx, y: h.cy, z: h.cz })} (${Math.round(dist(pl.location, { x: h.cx, y: pl.location.y, z: h.cz }))} blocks)` : "§7No Hollow nearby (territory disabled?)");
    }],
    ["Create a Hollow centred here (testing)", () => { forceHollow(pl.location); pl.sendMessage("§7A Hollow will grow around this spot."); }],
    ["Build a lone Dwelling here (testing)", () => system.runJob((function* () { const ok = yield* buildSmall(pl.dimension, pl.location); pl.sendMessage(ok ? "§7Dwelling built." : "§7Couldn't build here (needs a cave floor)."); })())],
    ["Reset what it learned about me", () => { const p = getP(pl); const keep = p.profile.journal; p.profile = newProfile(); p.profile.journal = keep; p.profile.gotItems = true; p.profDirty = true; pl.sendMessage("§7Its memory of you is gone."); }],
    ["Reset encounter cooldowns", () => { W.lastEncounterEnd = -999999; W.deathCooldownUntil = 0; W.ticks = Math.max(W.ticks, cfg.graceMinutes * 1200); markDirty(); saveWorld(true); }],
  ];
  for (const [label] of acts) f.button(/** @type {string} */ (label));
  f.button("Back");
  showForm(pl, f, (r) => {
    if (r.canceled || r.selection === undefined) return;
    const a = acts[r.selection];
    if (a) guard("admin", () => /** @type {any} */ (a[1])());
    else openConfig(pl);
  });
}

export function info(pl) {
  const p = getP(pl);
  const b = T.brain;
  const h = nearestHollow(pl.location);
  const ab = abilities(p);
  return [
    `Creature: ${b ? `${b.state} (pose ${b.pose}, target ${b.targetId === pl.id ? "you" : "other"}, aware ${Math.round(b.awareness)})` : "none"}`,
    `Your tension: ${Math.round(p.tension)}  underground: ${p.underground}  territory: ${pct(p.terrS)}%`,
    `World play time: ${Math.floor(W.ticks / 1200)} min  grace: ${cfg.graceMinutes} min  encounters: ${W.encounters}`,
    `Anger: ${Math.round(W.anger)}  dwellings: ${W.dwellings.filter((d) => d.alive).length} alive / ${W.dwellings.length}`,
    `Nearest Hollow: ${h ? fmt({ x: h.cx, y: h.cy, z: h.cz }) : "-"}  generated chunks this session: ${genStats.chunks}`,
    `Learned: ${Object.entries(ab).map(([k, v]) => k + " " + v).join(", ")}`,
  ].join("\n");
}

export { world };
