// @ts-check
// The Config Wheel's page for its dwellers (1.6.0): the Goatwalker, the Brinesleeper and the Shaftbreaker. For each:
// on or off, how often, how dangerous (fixed choices taken from its own settings: nothing can be set out of range),
// its own full settings (its own wheel, opened from here), its own wheel to keep, and — to see it — sent after you now.
import { ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { DWELLERS, isOn, setOn, sendNow } from "../link/dwellers.js";
import { safe } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").RawMessage} RawMessage */
/** @param {string} key @param {...(string|number|RawMessage)} args @returns {RawMessage} */
const tr = (key, ...args) => {
  if (!args.length) return { translate: key };
  return { translate: key, with: { rawtext: args.map((a) => (typeof a === "object" ? a : { text: String(a) })) } };
};
/** @param {...(string|RawMessage)} parts @returns {RawMessage} */
const raw = (...parts) => ({ rawtext: parts.map((x) => (typeof x === "string" ? { text: x } : x)) });
/** @param {Player} p @param {RawMessage} m */
const say = (p, m) => safe(() => p.sendMessage(m));

/** The list of its dwellers. @param {Player} p */
export async function dwellersPage(p) {
  const f = new ActionFormData().title(tr("observer.dw.title")).body(tr("observer.dw.body"));
  for (const d of DWELLERS) f.button(raw(tr(`observer.dw.${d.name}`), "\n", tr(isOn(d) ? "observer.dw.is_on" : "observer.dw.is_off")));
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  const d = DWELLERS[r.selection];
  if (d) await dwellerPage(p, d);
}

/** One dweller. @param {Player} p @param {import("../link/dwellers.js").Dweller} d */
async function dwellerPage(p, d) {
  const now = tr("observer.dw.now", tr(isOn(d) ? "observer.dw.is_on" : "observer.dw.is_off"), d.often[d.getOften()] ?? "?", d.danger[d.getDanger()] ?? "?");
  const f = new ActionFormData().title(tr(`observer.dw.${d.name}`)).body(raw(tr(`observer.dw.${d.name}.about`), "\n\n", now));
  /** @type {(() => any)[]} */
  const acts = [];
  const add = (/** @type {string} */ key, /** @type {() => any} */ fn) => {
    f.button(tr(key));
    acts.push(fn);
  };
  add("observer.dw.btn_settings", () => dwellerSettings(p, d));
  add("observer.dw.btn_own", () => {
    if (!isOn(d)) return say(p, raw(tr("observer.dw.is_off_now", tr(`observer.dw.${d.name}`))));
    return d.open(p);
  });
  add("observer.dw.btn_wheel", () => {
    safe(() => p.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack(d.wheel, 1)));
    say(p, raw(tr("observer.dw.given", tr(`observer.dw.${d.name}`))));
  });
  add("observer.dw.btn_send", () => {
    if (!isOn(d)) return say(p, raw(tr("observer.dw.is_off_now", tr(`observer.dw.${d.name}`))));
    const r = sendNow(d.name, p);
    say(p, raw(tr(r && !(typeof r === "string" && /^(no |unknown)/.test(r)) ? "observer.dw.sent" : "observer.dw.not_here", tr(`observer.dw.${d.name}`))));
  });
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  await acts[r.selection]?.();
}

/** On/off, how often, how dangerous. @param {Player} p @param {import("../link/dwellers.js").Dweller} d */
async function dwellerSettings(p, d) {
  const f = new ModalFormData()
    .title(tr(`observer.dw.${d.name}`))
    .toggle(tr("observer.dw.set_on"), { defaultValue: isOn(d) })
    .dropdown(tr("observer.dw.set_often"), d.often, { defaultValueIndex: d.getOften() })
    .dropdown(tr("observer.dw.set_danger"), d.danger, { defaultValueIndex: d.getDanger() });
  const r = await f.show(p);
  if (r.canceled || !r.formValues) return;
  const [on, often, danger] = r.formValues;
  safe(() => d.setOften(Number(often)));
  safe(() => d.setDanger(Number(danger)));
  setOn(d.name, !!on);
  say(p, raw(tr("observer.dw.saved", tr(`observer.dw.${d.name}`), tr(on ? "observer.dw.is_on" : "observer.dw.is_off"), d.often[d.getOften()] ?? "?", d.danger[d.getDanger()] ?? "?")));
}
