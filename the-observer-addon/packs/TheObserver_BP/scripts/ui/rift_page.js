// @ts-check
// The Config Wheel's page for the Rift (1.6.0): how often a rift opens (never .. constantly — and so how deadly it is
// in there), when the next one comes, a rift opened near you now, the open one shut.
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { S, updateSettings } from "../core/settings.js";
import { safe } from "../core/util.js";
import * as portal from "../rift/portal.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").RawMessage} RawMessage */
/** @param {string} key @param {...(string|number|RawMessage)} args @returns {RawMessage} */
const tr = (key, ...args) => (args.length ? { translate: key, with: { rawtext: args.map((a) => (typeof a === "object" ? a : { text: String(a) })) } } : { translate: key });
/** @param {...(string|RawMessage)} parts @returns {RawMessage} */
const raw = (...parts) => ({ rawtext: parts.map((x) => (typeof x === "string" ? { text: x } : x)) });
/** @param {Player} p @param {RawMessage} m */
const say = (p, m) => safe(() => p.sendMessage(m));

const RESULTS = { open: "open", "no room": "no_room", "one is already open": "already", "not now": "not_now", "no rift dimension": "missing",
  "could not open": "failed", "the other side could not be made": "failed", closed: "closed" };

/** @param {Player} p */
export async function riftPage(p) {
  const lv = Math.round(Number(S().rift) || 0);
  const st = portal.status();
  const when = st.open || st.opening ? tr("observer.rift.is_open") : lv <= 0 ? tr("observer.rift.next_never")
    : tr("observer.rift.next", st.next < 0 ? "?" : Math.max(1, Math.round(st.next / 60)));
  const f = new ActionFormData()
    .title(tr("observer.rift.title"))
    .body(raw(tr("observer.rift.body"), "\n\n", tr("observer.rift.body2"), "\n\n", tr("observer.rift.now_often", tr(`observer.rift.often.${lv}`)), "\n",
      tr("observer.rift.now_level", tr(`observer.rift.level.${lv}`)), "\n", when));
  /** @type {(() => any)[]} */
  const acts = [];
  const add = (/** @type {string} */ key, /** @type {() => any} */ fn) => {
    f.button(tr(key));
    acts.push(fn);
  };
  add("observer.rift.btn_often", () => often(p));
  add("observer.rift.btn_open", async () => {
    say(p, raw(tr("observer.rift.opening")));
    const r = await portal.openNear(p, { force: true });
    say(p, raw(tr(`observer.rift.r.${RESULTS[/** @type {keyof typeof RESULTS} */ (r)] ?? "failed"}`)));
  });
  if (st.open) add("observer.rift.btn_close", () => {
    portal.close("wheel");
    say(p, raw(tr("observer.rift.r.closed")));
  });
  const r = await f.show(p);
  if (r.canceled || r.selection === undefined) return;
  await acts[r.selection]?.();
}

/** How often (and so how deadly). @param {Player} p */
async function often(p) {
  const lv = Math.round(Number(S().rift) || 0);
  const f = new ModalFormData()
    .title(tr("observer.rift.title"))
    .dropdown(tr("observer.rift.set_often"), [0, 1, 2, 3, 4, 5].map((i) => raw(tr(`observer.rift.often.${i}`), " — ", tr(`observer.rift.level.${i}`))), { defaultValueIndex: lv });
  const r = await f.show(p);
  if (r.canceled || !r.formValues) return;
  const v = Math.max(0, Math.min(5, Math.round(Number(r.formValues[0]) || 0)));
  updateSettings({ rift: v });
  portal.reschedule();
  say(p, raw(tr("observer.rift.saved", tr(`observer.rift.often.${v}`))));
}
