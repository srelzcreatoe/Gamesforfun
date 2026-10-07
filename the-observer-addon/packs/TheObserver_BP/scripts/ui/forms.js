// @ts-check
// Field Notes (the journal), settings, and the post-vigil choice.
import { world, system, PlayerPermissionLevel, CommandPermissionLevel } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ps, now, markPlayerDirty } from "../core/state.js";
import { S, updateSettings, PRESETS, captionsOn } from "../core/settings.js";
import { safe, V } from "../core/util.js";
import { DISCOVERIES, VIGIL_REQUIREMENT } from "../progression/discoveries.js";
import { ITEMS } from "../core/constants.js";
import * as ledger from "../world/ledger.js";
import { primaryHaunt } from "../observer/memory.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @param {string} key @param {...(string|number)} withArgs @returns {import("@minecraft/server").RawMessage} */
const tr = (key, ...withArgs) => (withArgs.length ? { translate: key, with: withArgs.map(String) } : { translate: key });
/** @param {...(string|import("@minecraft/server").RawMessage)} parts @returns {import("@minecraft/server").RawMessage} */
const raw = (...parts) => ({ rawtext: parts.map((p) => (typeof p === "string" ? { text: p } : p)) });

/** @param {Player} p */
export function isOperator(p) {
  return safe(() => p.playerPermissionLevel === PlayerPermissionLevel.Operator, false)
    || safe(() => p.commandPermissionLevel >= CommandPermissionLevel.GameDirectors, false);
}

function hasItem(p, id) {
  const inv = p.getComponent("minecraft:inventory")?.container;
  if (!inv) return false;
  for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === id) return true;
  return false;
}

/** Vigil availability and the reason it is not available. @param {Player} p */
export function vigilStatus(p) {
  const s = ps(p);
  if (s.witnessed) return { ok: false, why: "observer.ui.vigil_done" };
  if (s.disc.length < VIGIL_REQUIREMENT) return { ok: false, why: "observer.ui.vigil_need_pages" };
  if (!hasItem(p, ITEMS.lens)) return { ok: false, why: "observer.ui.vigil_need_lens" };
  const tod = world.getTimeOfDay();
  if (p.dimension.id !== "minecraft:overworld" || tod < 13000 || tod > 22500) return { ok: false, why: "observer.ui.vigil_need_night" };
  const h = primaryHaunt(p, 120);
  if (!h || V.hdist(p.location, h.center) > 24) return { ok: false, why: "observer.ui.vigil_need_home" };
  return { ok: true, why: "" };
}

/** A vague, diegetic status line instead of numbers. */
function mood(p) {
  const s = ps(p);
  if (s.witnessed) return "observer.ui.mood_witnessed";
  if (s.stage === 0) return "observer.ui.mood_0";
  if (now() < s.quietUntil || now() < s.recoveryUntil) return "observer.ui.mood_quiet";
  if (s.tension > 55) return "observer.ui.mood_near";
  return `observer.ui.mood_${Math.min(5, s.stage)}`;
}

/** @param {Player} p @param {(p:Player)=>void} startVigil */
export async function openJournal(p, startVigil) {
  const s = ps(p);
  const vs = vigilStatus(p);
  const f = new ActionFormData()
    .title(tr("observer.ui.notes_title"))
    .body(raw(tr(mood(p)), "\n\n", tr("observer.ui.pages", s.disc.length, DISCOVERIES.length), "\n", tr(vs.ok ? "observer.ui.vigil_ready" : vs.why)));
  const actions = [];
  f.button(tr("observer.ui.btn_pages"));
  actions.push(() => openDiscoveries(p));
  f.button(tr("observer.ui.btn_lessons"));
  actions.push(() => openLessons(p));
  if (vs.ok) {
    f.button(tr("observer.ui.btn_vigil"));
    actions.push(() => startVigil(p));
  }
  if (s.witnessed) {
    f.button(tr("observer.ui.btn_after"));
    actions.push(() => openAfter(p));
  }
  f.button(tr(captionsOn(p) ? "observer.ui.btn_captions_on" : "observer.ui.btn_captions_off"));
  actions.push(() => {
    s.captions = !captionsOn(p);
    markPlayerDirty(p);
    safe(() => p.sendMessage(raw(tr(s.captions ? "observer.msg.captions_on" : "observer.msg.captions_off"))));
  });
  if (isOperator(p)) {
    f.button(tr("observer.ui.btn_settings"));
    actions.push(() => openSettings(p));
  }
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  await actions[r.selection]?.();
}

/** @param {Player} p */
async function openDiscoveries(p) {
  const s = ps(p);
  const f = new ActionFormData().title(tr("observer.ui.btn_pages")).body(tr("observer.ui.pages_body"));
  for (const id of DISCOVERIES) f.button(s.disc.includes(id) ? tr(`observer.disc.${id}.title`) : tr("observer.ui.unwritten"));
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  const id = DISCOVERIES[r.selection];
  if (!s.disc.includes(id)) return;
  await new ActionFormData().title(tr(`observer.disc.${id}.title`)).body(raw(tr(`observer.disc.${id}.text`), "\n\n§7", tr(`observer.disc.${id}.lesson`))).button(tr("observer.ui.back")).show(p);
}

/** Lessons: the rules a player has learned, in their own notes. @param {Player} p */
async function openLessons(p) {
  const s = ps(p);
  /** @type {(string|import("@minecraft/server").RawMessage)[]} */
  const parts = [tr("observer.ui.lessons_intro")];
  for (const id of DISCOVERIES) if (s.disc.includes(id)) parts.push("\n• ", tr(`observer.disc.${id}.lesson`));
  if (s.disc.length === 0) parts.push("\n", tr("observer.ui.lessons_none"));
  await new ActionFormData().title(tr("observer.ui.btn_lessons")).body(raw(...parts)).button(tr("observer.ui.back")).show(p);
}

/** @param {Player} p */
export async function openAfter(p) {
  const s = ps(p);
  const modes = ["attendant", "endless", "rest"];
  const f = new ActionFormData().title(tr("observer.ui.after_title")).body(tr("observer.ui.after_body"));
  for (const m of modes) f.button(tr(`observer.ui.after_${m}`));
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  s.endMode = modes[r.selection];
  if (s.endMode === "endless") s.stage = 5;
  markPlayerDirty(p);
  safe(() => p.sendMessage(raw(tr(`observer.msg.after_${s.endMode}`))));
}

/** @param {Player} p */
export async function openSettings(p) {
  if (!isOperator(p)) {
    safe(() => p.sendMessage(raw(tr("observer.msg.ops_only"))));
    return;
  }
  const c = S();
  const presets = ["atmosphere", "standard", "relentless", "custom"];
  const f = new ModalFormData()
    .title(tr("observer.ui.settings_title"))
    .toggle(tr("observer.set.enabled"), { defaultValue: c.enabled })
    .dropdown(tr("observer.set.preset"), presets.map((x) => tr(`observer.preset.${x}`)), { defaultValueIndex: Math.max(0, presets.indexOf(c.preset)) })
    .slider(tr("observer.set.frequency"), 25, 200, { valueStep: 25, defaultValue: Math.round(c.frequency * 100) })
    .dropdown(tr("observer.set.aggression"), [0, 1, 2, 3].map((i) => tr(`observer.set.aggression.${i}`)), { defaultValueIndex: c.aggression })
    .dropdown(tr("observer.set.manipulation"), [0, 1, 2, 3].map((i) => tr(`observer.set.manipulation.${i}`)), { defaultValueIndex: c.manipulation })
    .dropdown(tr("observer.set.scares"), [0, 1, 2].map((i) => tr(`observer.set.scares.${i}`)), { defaultValueIndex: c.scares })
    .dropdown(tr("observer.set.camera"), [0, 1, 2].map((i) => tr(`observer.set.camera.${i}`)), { defaultValueIndex: c.camera })
    .toggle(tr("observer.set.captions"), { defaultValue: c.captions })
    .slider(tr("observer.set.grace"), 0, 60, { valueStep: 1, defaultValue: c.graceMinutes })
    .toggle(tr("observer.set.world_effects"), { defaultValue: c.worldEffects })
    .toggle(tr("observer.set.dev"), { defaultValue: c.dev });
  const r = await f.show(p);
  if (r.canceled || !r.formValues) return;
  const v = r.formValues;
  const chosenPreset = presets[Number(v[1])];
  /** @type {any} */
  const patch = {
    enabled: !!v[0], frequency: Number(v[2]) / 100, aggression: Number(v[3]), manipulation: Number(v[4]),
    scares: Number(v[5]), camera: Number(v[6]), captions: !!v[7], graceMinutes: Number(v[8]), worldEffects: !!v[9], dev: !!v[10],
  };
  // choosing a named preset applies it; otherwise individual values make it "custom"
  if (chosenPreset !== c.preset && chosenPreset !== "custom") {
    updateSettings({ ...patch, preset: chosenPreset, ...PRESETS[chosenPreset] });
  } else {
    const p0 = PRESETS[c.preset];
    const changed = p0 && ["frequency", "aggression", "manipulation", "scares", "camera", "graceMinutes"].some((k) => patch[k] !== p0[k]);
    updateSettings({ ...patch, preset: changed ? "custom" : c.preset });
  }
  safe(() => p.sendMessage(raw(tr("observer.msg.settings_saved", S().preset))));
  if (!S().enabled || S().manipulation === 0) {
    const res = ledger.restoreAll();
    safe(() => p.sendMessage(raw(tr("observer.msg.restored", res.restored, res.pending))));
  }
}

export function showLater(fn) {
  system.run(() => fn().catch((e) => console.warn(`[Observer] form error ${e}`)));
}
