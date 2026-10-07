// @ts-check
// Discoveries are earned by *noticing* or *responding to* the Observer, never by exposure alone.
// Each one adds a page to the Field Notes, teaches a tell, and grants a Vestige.
import { ItemStack, system } from "@minecraft/server";
import { ITEMS, SOUNDS } from "../core/constants.js";
import { ps, markPlayerDirty } from "../core/state.js";
import { safe, trace, emit } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */

/** id -> lang key suffix (title + text in texts/en_US.lang as observer.disc.<id>.title / .text / .lesson) */
export const DISCOVERIES = [
  "the_figure", "out_of_step", "quiet_feet", "someone_was_home", "put_back", "small_likeness",
  "something_facing", "the_door", "lights_out", "light_it_doesnt_make", "held_gaze", "behind_left",
  "borrowed_work", "echo_ahead", "wrong_way", "breathing_room", "second_witness", "while_you_slept",
  "elsewhere_too", "the_window", "close", "through_the_lens",
];
export const VIGIL_REQUIREMENT = 12;

/** Stage thresholds on exposure points. Stage 1 begins when the grace period ends. */
export const STAGE_EXPOSURE = [0, 0, 4, 10, 18, 30];
export const STAGE_MIN_ENCOUNTERS = [0, 0, 2, 4, 7, 10];

/** @param {Player} p @param {string} id @returns {boolean} newly unlocked */
export function discover(p, id) {
  const s = ps(p);
  if (!DISCOVERIES.includes(id) || s.disc.includes(id)) return false;
  s.disc.push(id);
  markPlayerDirty(p);
  trace(`discovery ${id} for ${p.name}`);
  emit("discovery", { id, player: p.name, count: s.disc.length });
  system.runTimeout(() => {
    if (!p.isValid) return;
    safe(() => p.playSound(SOUNDS.discovery, { volume: 0.7 }));
    safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.discovery", with: { rawtext: [{ translate: `observer.disc.${id}.title` }] } }] }));
    give(p, ITEMS.vestige, 1);
    if (!s.notesGiven) {
      s.notesGiven = true;
      give(p, ITEMS.notes, 1);
      safe(() => p.sendMessage({ rawtext: [{ translate: "observer.msg.notes_given" }] }));
    }
  }, 30);
  return true;
}

/** @param {Player} p @param {string} id @param {number} n */
export function give(p, id, n) {
  const inv = p.getComponent("minecraft:inventory")?.container;
  const stack = new ItemStack(id, n);
  const rest = inv ? safe(() => inv.addItem(stack), stack) : stack;
  if (rest) safe(() => p.dimension.spawnItem(rest, p.location));
}

/** Award exposure and advance stage when thresholds are met. @param {Player} p @param {number} pts */
export function expose(p, pts) {
  const s = ps(p);
  s.exposure += pts;
  while (s.stage < 5 && s.stage >= 1 && s.exposure >= STAGE_EXPOSURE[s.stage + 1] && s.encCount >= STAGE_MIN_ENCOUNTERS[s.stage + 1]) {
    s.stage++;
    trace(`${p.name} reached stage ${s.stage}`);
  }
  markPlayerDirty(p);
}

export const hasAll = (p) => ps(p).disc.length >= VIGIL_REQUIREMENT;
