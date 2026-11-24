// @ts-check
// Its dwellers (1.6.0). The Goatwalker is its servant of the woods, the Shaftbreaker of the caves, the Brinesleeper of
// the water: three creatures of the user's own, merged into this pack (tools/merge_dwellers.py), each still itself.
//   * each can be switched on or off on the Config Wheel; off, it sees nobody, whatever it was doing ends, its music
//     stops, and its creatures are gone (and stay gone: any that turns up is removed);
//   * "how often" and "how dangerous" map onto each one's own settings, through fixed choices only (nothing can be set
//     out of range); the rest of each one's settings stay on its own wheel, which the Config Wheel opens;
//   * near the Observer they answer to it: stronger, faster and harder to hurt while it is close, and sent after the
//     one it has come for.
import { world, system } from "@minecraft/server";
import * as shared from "./shared.js";
import { S, updateSettings } from "../core/settings.js";
import { PARTICLES } from "../core/constants.js";
import { safe, emit, V, allPlayers } from "../core/util.js";
import * as body from "../observer/body.js";
// the dwellers themselves (their entry modules start them)
import * as gwMain from "../dwellers/goatwalker/main.js";
import * as gwCfg from "../dwellers/goatwalker/config.js";
import "../dwellers/brinesleeper/index.js";
import * as brCfg from "../dwellers/brinesleeper/config.js";
import * as brMain from "../dwellers/brinesleeper/main.js";
import * as brBrain from "../dwellers/brinesleeper/brain.js";
import * as brMenu from "../dwellers/brinesleeper/menu.js";
import "../dwellers/shaftbreaker/main.js";
import * as sbCfg from "../dwellers/shaftbreaker/core/config.js";
import * as sbCreature from "../dwellers/shaftbreaker/ai/creature.js";
import * as sbDirector from "../dwellers/shaftbreaker/ai/director.js";
import * as sbUi from "../dwellers/shaftbreaker/ui.js";
import * as sbBrain from "../dwellers/shaftbreaker/ai/brain.js";
import * as sbMemory from "../dwellers/shaftbreaker/ai/memory.js";
import * as sbHunt from "../dwellers/shaftbreaker/ai/encounters/hunt.js";
import { worldTicks as sbTicks } from "../dwellers/shaftbreaker/core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */

const BR_FREQ = [50, 75, 100, 150, 200];

/**
 * @typedef {Object} Dweller
 * @property {string} name        lang key part and settings key part
 * @property {"dwGoatwalker"|"dwBrinesleeper"|"dwShaftbreaker"} key   its switch in the Observer's settings
 * @property {string[]} entities  its creatures (removed while it is off)
 * @property {string} creature    the one that answers to the Observer
 * @property {string} wheel       its own settings item
 * @property {string[]} often     "how often" choices
 * @property {() => number} getOften
 * @property {(i:number) => void} setOften
 * @property {string[]} danger    "how dangerous" choices
 * @property {() => number} getDanger
 * @property {(i:number) => void} setDanger
 * @property {(p:Player) => any} open      its own wheel
 * @property {(on:boolean) => void} own    its own on/off flag, kept in step
 * @property {() => void} shutdown         everything it is doing ends, its creatures gone
 * @property {(p:Player) => any} command   sent after this player
 */

/** @type {Dweller[]} */
export const DWELLERS = [
  {
    name: "goatwalker", key: "dwGoatwalker", entities: ["goatwalker:goatwalker"], creature: "goatwalker:goatwalker", wheel: "goatwalker:config_wheel",
    often: [...gwCfg.PACE_NAMES], getOften: () => gwCfg.cfg().pace, setOften: (i) => gwCfg.setCfg({ pace: clampI(i, gwCfg.PACE_NAMES.length) }),
    danger: [...gwCfg.AGGRO_NAMES], getDanger: () => gwCfg.cfg().aggro, setDanger: (i) => gwCfg.setCfg({ aggro: clampI(i, gwCfg.AGGRO_NAMES.length) }),
    open: (p) => gwMain.__open(p),
    own: () => {},
    shutdown: () => gwMain.__shutdown(),
    command: (p) => gwMain.__command(p),
  },
  {
    name: "brinesleeper", key: "dwBrinesleeper", entities: ["brine:brinesleeper", "brine:apparition"], creature: "brine:brinesleeper", wheel: "brine:config_wheel",
    often: ["Half as often", "Less often", "As it was made", "More often", "Twice as often"],
    getOften: () => nearestIndex(BR_FREQ, Number(brCfg.config.frequency) || 100),
    setOften: (i) => brCfg.setConfig({ frequency: BR_FREQ[clampI(i, BR_FREQ.length)] }),
    danger: [1, 2, 3].map((k) => brCfg.THREATS[k].label),
    getDanger: () => clampI((Number(brCfg.config.threat) || 2) - 1, 3),
    setDanger: (i) => brCfg.setConfig({ threat: clampI(i, 3) + 1 }),
    open: (p) => brMenu.openMenu(p),
    own: (on) => brCfg.setConfig({ enabled: on }),
    shutdown: () => {
      for (const c of safe(() => brMain.creatures(), []) ?? []) safe(() => c.remove());
    },
    command: (p) => brBrain.provoke(p, "chase"),
  },
  {
    name: "shaftbreaker", key: "dwShaftbreaker", entities: ["shaftbreaker:shaftbreaker", "shaftbreaker:shaft_moth"], creature: "shaftbreaker:shaftbreaker", wheel: "shaftbreaker:breakers_wheel",
    often: sbCfg.ENUMS.frequency.map(cap), getOften: () => Math.max(0, sbCfg.ENUMS.frequency.indexOf(sbCfg.config().frequency)),
    setOften: (i) => sbCfg.setConfig("frequency", sbCfg.ENUMS.frequency[clampI(i, sbCfg.ENUMS.frequency.length)]),
    danger: sbCfg.ENUMS.difficulty.map((k) => sbCfg.DIFFICULTY[k].label), getDanger: () => Math.max(0, sbCfg.ENUMS.difficulty.indexOf(sbCfg.config().difficulty)),
    setDanger: (i) => sbCfg.setConfig("difficulty", sbCfg.ENUMS.difficulty[clampI(i, sbCfg.ENUMS.difficulty.length)]),
    open: (p) => sbUi.openWheel(p),
    own: (on) => sbCfg.setConfig("enabled", on),
    shutdown: () => safe(() => sbCreature.despawnAll(true)),
    command: (p) => sbDirector.forceEncounter(p, "hunt"),
  },
];

/** @param {number} i @param {number} n */
function clampI(i, n) {
  return Math.max(0, Math.min(n - 1, Math.round(Number(i) || 0)));
}
/** @param {number[]} list @param {number} v */
function nearestIndex(list, v) {
  let best = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - v) < Math.abs(list[best] - v)) best = i;
  return best;
}
/** @param {string} s */
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** @param {string} name */
export const byName = (name) => DWELLERS.find((d) => d.name === name);
/** @param {Dweller} d */
export const isOn = (d) => S()[d.key] !== false;
/** Every creature type of every dweller. */
const KIND = new Map(DWELLERS.flatMap((d) => d.entities.map((id) => [id, d])));
/** Is this entity one of its dwellers'? @param {Entity} e */
export const isDweller = (e) => KIND.has(safe(() => e.typeId, "") ?? "");

/** Bring the shared state and each dweller's own flag in line with the settings. @param {boolean} [initial] */
export function sync(initial = false) {
  for (const d of DWELLERS) {
    const on = isOn(d);
    const was = !shared.off.has(d.name);
    if (on) shared.off.delete(d.name);
    else shared.off.add(d.name);
    safe(() => d.own(on));
    if (!on && (was || initial)) {
      safe(() => d.shutdown());
      shared.silence(d.name);
      removeAll(d);
    }
  }
}

/** Switch a dweller on or off (the Config Wheel). @param {string} name @param {boolean} on */
export function setOn(name, on) {
  const d = byName(name);
  if (!d) return false;
  updateSettings({ [d.key]: on });
  sync();
  emit("dweller", { what: on ? "on" : "off", name });
  return true;
}

/** @param {Dweller} d */
function removeAll(d) {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    const dim = safe(() => world.getDimension(dimId));
    if (!dim) continue;
    for (const id of d.entities) for (const e of safe(() => dim.getEntities({ type: id }), []) ?? []) safe(() => e.remove());
  }
}

// a switched-off dweller's creatures do not come back on their own (natural spawning, an egg, its own scripts)
world.afterEvents.entitySpawn.subscribe((ev) => {
  const d = KIND.get(safe(() => ev.entity.typeId, "") ?? "");
  if (d && !isOn(d)) system.run(() => safe(() => ev.entity.isValid && ev.entity.remove()));
});

// ---------------------------------------------------------------- they answer to it

/** When each dweller was last sent after each player. @type {Map<string, number>} */
const sentAt = new Map();
const SEND_EVERY = 20 * 75;
const NEAR = 48;

/** Every second: the dwellers near the Observer are its — strengthened, and sent after the one it has come for. */
export function tick() {
  const b = body.get();
  if (!b || !b.e.isValid) return;
  const at = b.e.location;
  const dim = b.e.dimension;
  const target = b.target?.isValid && b.target.dimension.id === dim.id ? b.target : undefined;
  const near = (safe(() => dim.getEntities({ location: at, maxDistance: NEAR }), []) ?? []).filter((e) => {
    const d = KIND.get(e.typeId);
    return !!d && isOn(d) && e.typeId === d.creature;
  });
  const t = system.currentTick;
  for (const e of near) {
    const d = /** @type {Dweller} */ (KIND.get(e.typeId));
    // stronger, faster, harder to hurt while it is close (renewed every second, gone a few seconds after it leaves)
    for (const [fx, amp] of /** @type {[string, number][]} */ ([["strength", 1], ["speed", 0], ["resistance", 0], ["regeneration", 0]])) {
      safe(() => e.addEffect(fx, 60, { amplifier: amp, showParticles: false }));
    }
    if (t % 40 < 20) safe(() => dim.spawnParticle(PARTICLES.glitchAura, { x: e.location.x, y: e.location.y + 1.2, z: e.location.z }));
    safe(() => dim.spawnParticle(PARTICLES.servantEyes, { x: e.location.x, y: e.location.y + 1.8, z: e.location.z }));
    emit("dweller", { what: "buff", name: d.name, id: e.id });
    // and sent after the one it has come for
    if (target && V.dist(e.location, target.location) < 96) {
      const k = `${d.name}:${target.id}`;
      if (t - (sentAt.get(k) ?? -1e9) >= SEND_EVERY) {
        sentAt.set(k, t);
        const r = safe(() => d.command(target));
        emit("dweller", { what: "sent", name: d.name, player: target.name, result: String(r) });
      }
    }
  }
}

/** For tests and the Config Wheel: send this dweller after this player now. @param {string} name @param {Player} p */
export function sendNow(name, p) {
  const d = byName(name);
  if (!d || !isOn(d)) return false;
  return safe(() => d.command(p)) ?? false;
}

world.afterEvents.worldLoad.subscribe(() => system.run(() => sync(true)));
world.beforeEvents.playerLeave.subscribe((ev) => {
  const id = ev.player.id;
  system.run(() => shared.forget(id));
});

/** Players the dwellers see (tests). */
export const seen = (name) => shared.players(name).map((p) => p.name);
export { allPlayers };

/**
 * The Shaftbreaker and the surface (1.7.0; tests): where it stands with this player — underground or on the surface,
 * whether it may come for them where they are, and how long it will follow them up out of the caves.
 * @param {Player} p
 */
export function sbWits(p) {
  const s = sbDirector.pstate(p);
  const pf = sbMemory.profile(p);
  const left = Math.max(0, (pf.followUntil || 0) - sbTicks());
  return { underground: !!s.underground, surface: !!s.night, may: sbBrain.presenceEligible(p), followsFor: Math.round(left / 20), escapes: pf.escapesSinceFollow || 0 };
}

/** As if this player had got away from it n times (0: it stops following them up). @param {Player} p @param {number} n */
export function sbEscaped(p, n) {
  const pf = sbMemory.profile(p);
  if (!n) {
    pf.followUntil = 0;
    pf.escapesSinceFollow = 0;
    return sbWits(p);
  }
  for (let i = 0; i < n; i++) sbHunt.learnFromHunt({ player: p, huntLog: [], tel: { notes: [] }, ps: {} }, "escaped");
  return sbWits(p);
}

/** Whatever the Shaftbreaker is doing ends, and it is gone (tests). */
export function sbStop() {
  safe(() => sbDirector.stopEncounter());
}
