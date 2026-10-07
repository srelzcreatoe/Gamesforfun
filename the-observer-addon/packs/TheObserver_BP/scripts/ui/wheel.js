// @ts-check
// The Config Wheel: one item that opens every setting and test tool for The Observer.
//   * everyone: status, their own sound captions
//   * operators (or the only player in the world): See it now, Start it for me now, presets, all
//     settings, a toggle for each encounter type, Test an encounter, Undo its changes
import { system, GameMode } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { ps, now, markPlayerDirty } from "../core/state.js";
import { S, updateSettings, PRESETS, captionsOn } from "../core/settings.js";
import { safe, allPlayers } from "../core/util.js";
import * as ledger from "../world/ledger.js";
import * as director from "../director/director.js";
import { isOperator, openSettings } from "./forms.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").RawMessage} RawMessage */
/** Translation with arguments that may themselves be translations. @param {string} key @param {...(string|number|RawMessage)} args @returns {RawMessage} */
const tr = (key, ...args) => {
  if (!args.length) return { translate: key };
  if (args.every((a) => typeof a !== "object")) return { translate: key, with: args.map(String) };
  return { translate: key, with: { rawtext: args.map((a) => (typeof a === "object" ? a : { text: String(a) })) } };
};
/** @param {...(string|import("@minecraft/server").RawMessage)} parts @returns {import("@minecraft/server").RawMessage} */
const raw = (...parts) => ({ rawtext: parts.map((p) => (typeof p === "string" ? { text: p } : p)) });
/** @param {Player} p @param {import("@minecraft/server").RawMessage} m */
const say = (p, m) => safe(() => p.sendMessage(m));

/** Encounter types players can switch on and off (not the vigil or the preview). */
export const TOGGLEABLE = () => director.REGISTRY.filter((d) => !d.preview && d.id !== "vigil");

/** Operators — and in a single-player world, the player — may configure everything. @param {Player} p */
export function canConfigure(p) {
  return isOperator(p) || allPlayers().length === 1;
}

/** @param {Player} p */
function survivalLike(p) {
  const gm = safe(() => p.getGameMode());
  return gm === GameMode.Survival || gm === GameMode.Adventure;
}

/** The status block at the top of the wheel. @param {Player} p */
function status(p) {
  const s = ps(p);
  const c = S();
  const lines = [];
  lines.push(tr(c.enabled ? "observer.wheel.on" : "observer.wheel.off", tr(`observer.preset.${c.preset}`)));
  lines.push("\n");
  if (s.stage === 0) {
    const left = Math.max(0, Math.ceil((c.graceMinutes * 60 - s.play) / 60));
    lines.push(tr("observer.wheel.grace", left));
  } else lines.push(tr("observer.wheel.stage", s.stage, tr(`observer.wheel.stage.${Math.min(5, s.stage)}`)));
  lines.push("\n");
  const t = now();
  const wait = Math.max(s.nextAt, s.quietUntil, s.recoveryUntil) - t;
  if (s.stage > 0 && c.enabled) lines.push(tr(wait > 60 ? "observer.wheel.next_later" : "observer.wheel.next_soon"), "\n");
  if (!survivalLike(p)) lines.push(tr("observer.wheel.not_survival"), "\n");
  const off = c.off.length;
  if (off) lines.push(tr("observer.wheel.off_count", off), "\n");
  lines.push(tr("observer.wheel.changes", ledger.count()));
  return raw(...lines);
}

/** @param {Player} p */
export async function openWheel(p) {
  const admin = canConfigure(p);
  const f = new ActionFormData().title(tr("observer.wheel.title")).body(status(p));
  /** @type {(() => any)[]} */
  const actions = [];
  const add = (key, fn) => {
    f.button(tr(key));
    actions.push(fn);
  };
  if (admin) {
    add("observer.wheel.btn_see", () => seeItNow(p));
    add(ps(p).stage === 0 ? "observer.wheel.btn_start" : "observer.wheel.btn_soon", () => startNow(p));
    add(S().enabled ? "observer.wheel.btn_disable" : "observer.wheel.btn_enable", () => toggleEnabled(p));
    add("observer.wheel.btn_presets", () => presets(p));
    add("observer.wheel.btn_settings", () => openSettings(p));
    add("observer.wheel.btn_toggles", () => toggles(p));
    add("observer.wheel.btn_test", () => testEncounter(p));
    add("observer.wheel.btn_undo", () => undoChanges(p));
  }
  add(captionsOn(p) ? "observer.ui.btn_captions_on" : "observer.ui.btn_captions_off", () => {
    const s = ps(p);
    s.captions = !captionsOn(p);
    markPlayerDirty(p);
    say(p, raw(tr(s.captions ? "observer.msg.captions_on" : "observer.msg.captions_off")));
  });
  if (!admin) f.body(raw(status(p), "\n\n", tr("observer.wheel.ops_only")));
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  await actions[r.selection]?.();
}

/** Preview: the Observer appears in front of you and shows its animations. @param {Player} p */
function seeItNow(p) {
  const def = director.byId("showcase");
  if (!def) return;
  const enc = director.start(def, p, undefined, true);
  if (!enc) return say(p, raw(tr("observer.wheel.busy")));
  system.runTimeout(() => {
    if (enc.outcome === "deferred") say(p, raw(tr("observer.wheel.no_room")));
  }, 10);
}

/** Skip the grace period (or the current wait) for this player. @param {Player} p */
function startNow(p) {
  const s = ps(p);
  const t = now();
  if (s.stage === 0) {
    s.play = Math.max(s.play, S().graceMinutes * 60);
    s.stage = 1;
  }
  s.nextAt = t + 20;
  s.quietUntil = Math.min(s.quietUntil, t);
  s.recoveryUntil = Math.min(s.recoveryUntil, t);
  markPlayerDirty(p);
  if (!S().enabled) updateSettings({ enabled: true });
  say(p, raw(tr(survivalLike(p) ? "observer.wheel.started" : "observer.wheel.started_creative")));
}

/** @param {Player} p */
function toggleEnabled(p) {
  const on = !S().enabled;
  updateSettings({ enabled: on });
  say(p, raw(tr(on ? "observer.wheel.enabled" : "observer.wheel.disabled")));
  if (!on) {
    const res = ledger.restoreAll();
    say(p, raw(tr("observer.msg.restored", res.restored, res.pending)));
  }
}

/** @param {Player} p */
async function presets(p) {
  const names = Object.keys(PRESETS);
  const f = new ActionFormData().title(tr("observer.wheel.btn_presets")).body(tr("observer.wheel.presets_body", tr(`observer.preset.${S().preset}`)));
  for (const n of names) f.button(tr(`observer.preset.${n}`));
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  updateSettings({ preset: names[r.selection] });
  say(p, raw(tr("observer.msg.settings_saved", S().preset)));
  if (S().manipulation === 0) ledger.restoreAll();
}

/** One toggle per encounter type. @param {Player} p */
async function toggles(p) {
  const defs = TOGGLEABLE();
  const f = new ModalFormData().title(tr("observer.wheel.btn_toggles"));
  for (const d of defs) f.toggle(raw(tr(`observer.enc.${d.id}`), " ", tr("observer.wheel.from_stage", d.minStage)), { defaultValue: !S().off.includes(d.id) });
  const r = await f.show(p);
  if (r.canceled || !r.formValues) return;
  const off = defs.filter((d, i) => !r.formValues?.[i]).map((d) => d.id);
  updateSettings({ off });
  say(p, raw(tr("observer.wheel.toggles_saved", defs.length - off.length, defs.length)));
}

/** Start any encounter on yourself now. @param {Player} p */
async function testEncounter(p) {
  if (!survivalLike(p)) return say(p, raw(tr("observer.wheel.need_survival")));
  const defs = TOGGLEABLE();
  const f = new ActionFormData().title(tr("observer.wheel.btn_test")).body(tr("observer.wheel.test_body"));
  for (const d of defs) f.button(raw(tr(`observer.enc.${d.id}`), "\n", tr(`observer.enc.${d.id}.where`)));
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  const def = defs[r.selection];
  const s = ps(p);
  // tests run at the encounter's own stage at least, so stage-dependent behaviour is shown
  if (s.stage < Math.max(1, def.minStage)) {
    s.stage = Math.max(1, def.minStage);
    s.play = Math.max(s.play, S().graceMinutes * 60);
    markPlayerDirty(p);
  }
  const enc = director.start(def, p, undefined, true);
  if (!enc) return say(p, raw(tr("observer.wheel.busy")));
  say(p, raw(tr("observer.wheel.test_started", tr(`observer.enc.${def.id}`))));
  system.runTimeout(() => {
    if (enc.outcome === "deferred") say(p, raw(tr("observer.wheel.test_deferred", tr(`observer.enc.${def.id}.where`))));
  }, 10);
}

/** @param {Player} p */
async function undoChanges(p) {
  const n = ledger.count();
  const f = new MessageFormData().title(tr("observer.wheel.btn_undo")).body(tr("observer.wheel.undo_body", n))
    .button1(tr("observer.wheel.undo_yes")).button2(tr("observer.wheel.cancel"));
  const r = await f.show(p);
  if (r.canceled || r.selection !== 0) return;
  director.abortAll("undo");
  const res = ledger.restoreAll();
  say(p, raw(tr("observer.msg.restored", res.restored, res.pending)));
}
