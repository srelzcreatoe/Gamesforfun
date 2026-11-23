/**
 * The two things a player holds: the journal (how angry he is, and when he comes) and the config wheel
 * (operators: settings, and calling or sending him on purpose).  Both are plain server-ui forms, opened from
 * the items or from /basiliskra:journal and /basiliskra:config.
 */
import { ItemStack, Player, PlayerPermissionLevel, system, world } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { pace, changeTicks } from "./brain";
import { CONFIG, JOURNAL_ITEM, OVERWORLD, TICKS, WHEEL_ITEM } from "./config";
import type { Controller } from "./controller";
import { angerNear, angriest, halfLifeDays, tallyOf, type Anger } from "./harm";
import { doseAt, falloutCount, nearestFallout } from "./fallout";
import { raiseCity } from "./city";
import { saveSettings, resetSettings } from "./settings";
import { store } from "./store";
import type { V3 } from "./vec";
import { NONE, UNLOADED, groundY, overworld } from "./world";

const ROMAN = ["", "I", "II", "III", "IV"];
const FALLOUT = ["off", "visual", "land"] as const;
const DUSK = 11800;

// ---- small helpers -------------------------------------------------------------------------------------------
export function canAdmin(p: Player): boolean {
  try { if (p.playerPermissionLevel === PlayerPermissionLevel.Operator) return true; } catch { /* older engine */ }
  try { return world.getAllPlayers().length <= 1; } catch { return false; }     // the only player of a single-player world
}

const pct = (f: number): string => `${Math.floor(Math.max(0, Math.min(1, f)) * 100)}%`;

function bar(f: number, colour = "§c"): string {
  const n = Math.round(Math.max(0, Math.min(1, f)) * 20);
  return `${colour}${"|".repeat(n)}§8${"|".repeat(20 - n)}§r`;
}

function mins(ticks: number): string {
  const m = Math.max(0, ticks) / TICKS.minute;
  if (m < 1) return "less than a minute";
  if (m < 90) return `about ${Math.round(m)} minute${Math.round(m) === 1 ? "" : "s"}`;
  return `about ${(m / 60).toFixed(1)} hours`;
}

function compass(from: V3, to: V3): string {
  const dx = to.x - from.x, dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 4) return "right here";
  const names = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"];   // Minecraft: +Z is south
  const a = (Math.atan2(-dx, dz) * 180) / Math.PI;                                                         // 0 = south, 90 = west
  return `${Math.round(Math.hypot(dx, dz))} blocks ${names[((Math.round(a / 45) % 8) + 8) % 8]}`;
}

const at = (v: V3): string => `${Math.floor(v.x)}, ${Math.floor(v.y)}, ${Math.floor(v.z)}`;

async function present<R extends { canceled: boolean; cancelationReason?: string }>(p: Player, show: () => Promise<R>): Promise<R | undefined> {
  // a form cannot open over chat or another screen: try again for a few seconds
  for (let i = 0; i < 20; i++) {
    let r: R;
    try { r = await show(); } catch { return undefined; }
    if (r.canceled && r.cancelationReason === FormCancelationReason.UserBusy) { await new Promise<void>((res) => system.runTimeout(() => res(), 8)); continue; }
    return r;
  }
  return undefined;
}

// ---- the journal ---------------------------------------------------------------------------------------------
function angerLines(p: Player, a: Anger, here: boolean): string[] {
  const L: string[] = [];
  const where = `around ${Math.floor(a.center.x)}, ${Math.floor(a.center.z)}`;
  L.push(here ? `§fNear you §7(the 64-block area ${where})` : `§fThe angriest area: ${where} §7(${compass(p.location, a.center)})`);
  L.push(`  ${bar(a.progress)} §l${pct(a.progress)}§r §7of what calls him`);
  L.push(`  §7Animals killed here by players: §f${a.kills}§7 (they count as §f${a.weightA.toFixed(1)}§7 of the §f${a.needA}§7 it takes)`);
  L.push(`  §7Logs, reeds and shore plants cut here: §f${a.cut}§7 (they count as §f${a.weightH.toFixed(1)}§7 of the §f${a.needH}§7 it takes)`);
  if (a.fired) L.push("  §7He has already been called from here.");
  else if (a.pct < 1) {
    L.push(`  §7Both are needed. Still to go here: about §f${a.moreKills}§7 more animal${a.moreKills === 1 ? "" : "s"} and §f${a.moreLogs}§7 more logs.`);
    L.push("  §8The first kills of a spree and the first logs of a tree count for less; repeated harm counts in full.");
  }
  const total = Object.values(a.by).reduce((s, v) => s + v, 0);
  const mine = a.by[p.id] ?? 0;
  if (total > 0) L.push(`  §7Your share of it: §f${pct(mine / total)}`);
  return L;
}

function evolveLines(): string[] {
  const rec = store.rec, now = rec.clock, L: string[] = [];
  if (rec.evolve) { L.push("§cHe is changing right now."); return L; }
  if (rec.form < 4) {
    // time is the only thing a change waits on
    const need = changeTicks(rec.form), since = Math.max(0, now - rec.mut.formSince), f = Math.min(1, since / need);
    const left = Math.max(0, need - since);
    L.push(`§fBecoming Basiliskra ${ROMAN[rec.form + 1]}: ${bar(f, rec.form === 3 ? "§4" : "§6")} §l${pct(f)}§r`);
    L.push(f >= 1 ? "  §aThe time is up: he changes as soon as he is free to." : `  §7Only time: §f${left >= TICKS.minute ? `${Math.ceil(left / TICKS.minute)} min` : `${Math.ceil(left / TICKS.second)} s`}§7 left of ${Math.round(need / TICKS.minute)} min as Basiliskra ${ROMAN[rec.form]}.`);
    L.push("  §8Nothing else is needed. The config wheel can set the minutes, or make him change at once.");
  } else L.push("§4Basiliskra IV is his last form.");
  if (rec.form >= 3) {
    L.push(rec.form === 4 ? "§fThe last crossing §8(it still sends him home)" : "§fThe last crossing §8(sends him home)");
    L.push("  §7Carry his shed fin to the seam; play his three knocks on note blocks near it and keep playing; lead his charge into a lightning rod near the seam.");
  }
  return L;
}

function comingLines(p: Player, ctl: Controller): string[] {
  const rec = store.rec, now = rec.clock, L: string[] = [];
  const tod = world.getTimeOfDay();
  const toDusk = tod >= DUSK && tod < 13800 ? 0 : (DUSK - tod + 24000) % 24000;
  switch (rec.stage) {
    case "dormant":
      L.push("§7Not yet. When one place reaches §f100%§7 he is called through deep water near it.");
      L.push("§7He needs open water about §f6 blocks deep§7 with a clear run of about §f45 blocks§7 within ~90 blocks of that place. Harm far inland calls no one.");
      break;
    case "pending": {
      const pd = rec.pending!;
      L.push(`§eHe has been called§7, by what was done near §f${Math.floor(pd.site.x)}, ${Math.floor(pd.site.z)}§7 (${compass(p.location, pd.site)}).`);
      L.push(`§7He is looking for deep, open water there (search ${Math.min(12, (pd.passes ?? 0) + 1)} of 12). Someone must be within 128 blocks of that place.`);
      if ((pd.passes ?? 0) >= 4) L.push("§7No water has been deep and open enough so far. Harm nearer a coast or a big lake will call him there instead.");
      break;
    }
    case "arriving": {
      const a = rec.arrival!;
      if (a.step === 0) {
        L.push(`§eHe is coming§7, through the water at §f${at(a.water)}§7 (${compass(p.location, a.water)}).`);
        L.push(toDusk === 0 ? "§7At dusk, which is now: someone must be within 96 blocks of that water." : `§7At the next dusk, in §f${mins(toDusk)}§7, while someone is within 96 blocks of that water.`);
      } else L.push(`§cHe is coming through now§7, at §f${at(a.water)}§7 (${compass(p.location, a.water)}).`);
      break;
    }
    case "alive": {
      const c = ctl.creature;
      if (c && c.valid) {
        let hp = "";
        try { const h = c.entity.getComponent("minecraft:health"); if (h) hp = ` §7Health §f${Math.ceil(h.currentValue)}/${h.effectiveMax}`; } catch { /* unloading */ }
        L.push(`§cBasiliskra ${ROMAN[rec.form]} is here§7, ${compass(p.location, c.pos)}.${hp}`);
      } else if (rec.entityId === null && rec.down !== null) {
        const left = pace(TICKS.day) - (now - rec.down);
        L.push(`§7Driven off. He comes back through the seam at §f${rec.rift ? at(rec.rift) : "the old place"}§7 in §f${mins(left)}§7, when someone is near it.`);
      } else if (rec.last) {
        L.push(`§7Basiliskra ${ROMAN[rec.form]} is out of reach. Last seen near §f${at(rec.last)}§7 (${compass(p.location, rec.last)}), ${mins(now - rec.last.t)} ago.`);
      } else L.push(`§7Basiliskra ${ROMAN[rec.form]} is out of reach.`);
      if (rec.guiltyName) L.push(`§7He remembers §f${rec.guiltyName}§7.`);
      break;
    }
    case "departed":
      L.push("§7He has gone home. The story in this world is over; nothing calls another.");
      break;
  }
  return L;
}

function falloutLines(p: Player): string[] {
  const L: string[] = [], now = store.rec.clock;
  let at: V3;
  try { if (p.dimension.id !== OVERWORLD) return ["§7Only the Overworld carries his fallout."]; at = p.location; } catch { return L; }
  const d = doseAt(at, now);
  const word = d < 0.03 ? "§anone to speak of" : d < 0.2 ? "§6low" : d < 0.45 ? "§6rising" : d < 0.75 ? "§chigh" : "§4deadly";
  L.push(`§fRadiation where you stand: ${bar(Math.min(1, d))} §l${pct(d)}§r  ${word}`);
  const n = nearestFallout(at, now), count = falloutCount(now);
  if (!n) L.push("§7No fallout on record. His beam, his changes and his seam leave it where they touch the world.");
  else {
    L.push(`§7Fallout in §f${count}§7 place${count === 1 ? "" : "s"}. The nearest is ${compass(at, n.zone)}, at §f${pct(n.strength)}§7.`);
    L.push("§7It spreads for about a minute, stands a while, then fades and is gone within a few minutes.");
    if (CONFIG.fallout === "land") L.push("§7In it the ground glows: soil and rock turn irradiated, plants wither, wild leaves fall and crimson crystals grow (break them for shards). Where his beam lands, rock runs to glowing slag and sand fuses to scarlet trinitite. As it fades the land heals back to what it was.");
    if (CONFIG.sickness) L.push("§7It is strong: hunger, then weakness and nausea, then poison, and the heart of a fresh zone burns. Iodine tablets (2 dried kelp, sugar) keep it off for four minutes; milk clears it. A Geiger counter (trinitite or a crimson shard, copper ingot, redstone) reads it.");
  }
  return L;
}

export function journalText(p: Player, ctl: Controller): string {
  const now = store.rec.clock, L: string[] = [];
  L.push("§l§4HIS ANGER§r");
  let here: Anger | null = null;
  try { if (p.dimension.id === OVERWORLD) here = angerNear(p.location, now); } catch { here = null; }
  if (here) L.push(...angerLines(p, here, true));
  else L.push("§7Only what is done in the Overworld counts.");
  const top = angriest(now);
  if (top && (!here || top.key !== here.key)) { L.push(""); L.push(...angerLines(p, top, false)); }
  const [k, c] = tallyOf(p.id);
  L.push(`§7You, everywhere: §f${k}§7 animal${k === 1 ? "" : "s"} killed, §f${c}§7 log${c === 1 ? "" : "s"} and plants cut.`);
  L.push(`§8Anger is kept per 64-block area. Left alone, an area's anger halves every ${halfLifeDays().toFixed(1)} in-game days.`);
  L.push("");
  L.push("§l§4WHEN HE COMES§r");
  L.push(...comingLines(p, ctl));
  if (store.rec.stage === "alive" || store.rec.stage === "arriving") { L.push(""); L.push("§l§4HIM§r"); L.push(...evolveLines()); }
  if (CONFIG.fallout !== "off") { L.push(""); L.push("§l§4FALLOUT§r"); L.push(...falloutLines(p)); }
  return L.join("\n");
}

export async function openJournal(p: Player, ctl: Controller): Promise<void> {
  for (;;) {
    const f = new ActionFormData().title("Basiliskra Journal").body(journalText(p, ctl)).button("Read again").button("Close");
    if (canAdmin(p)) f.button("Config wheel");
    const r = await present(p, () => f.show(p));
    if (!r || r.canceled) return;
    if (r.selection === 0) continue;
    if (r.selection === 2) await openWheel(p, ctl);
    return;
  }
}

// ---- the config wheel -----------------------------------------------------------------------------------------
/** Where a call from the wheel or the command puts him: in front of the player, far enough off, facing them. */
export function placeFor(p: Player, form: number): { at: V3; yaw: number } {
  const v = p.getViewDirection();
  const n = Math.hypot(v.x, v.z) || 1;
  const d = [0, 15, 24, 46, 52][form] ?? 30;            // his head reaches this far in front of his middle (II and III are drawn larger)
  const pl = p.location;
  const pos = { x: pl.x + (v.x / n) * d, y: pl.y, z: pl.z + (v.z / n) * d };
  // the ground there, however high above it the caller is (flying): searched all the way down
  const dimension = overworld();
  let g = groundY(dimension, pos.x, pos.z, pl.y + 24, 48);
  if (g === NONE) g = groundY(dimension, pos.x, pos.z, pl.y - 24, pl.y - 24 - dimension.heightRange.min);
  if (g !== UNLOADED && g !== NONE) pos.y = g as number;
  const yaw = (Math.atan2(-(pl.x - pos.x), pl.z - pos.z) * 180) / Math.PI;
  return { at: pos, yaw };
}

function formOf(rec = store.rec): number { return rec.born > 0 ? rec.form : 0; }

/** Choices offered for a number (no sliders: they cannot be dragged on every touch screen), with a box to type any other. */
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const MINUTES = [0, 1, 2, 5, 10, 20, 30, 60];
const DAMAGES = [0, 0.25, 0.5, 1, 1.5, 2, 3, 4];
const TERRAIN = ["none", "scorch", "break", "wither"] as const;

function presetList(values: number[], current: number, def: number, word: (v: number) => string): { items: string[]; index: number } {
  const items = values.map((v) => `${word(v)}${v === def ? " (default)" : ""}`);
  let index = values.indexOf(current);
  items.push(index < 0 ? `Custom: x${current}` : "Custom (type it in the box below)");
  if (index < 0) index = values.length;
  return { items, index };
}

/** The preset picked, or what was typed (typed wins when it is a number in range); otherwise the value as it was. */
/** A number typed into a box ("1.5", "x1.5", "1,5"), or undefined if the box is empty; NaN if it is not a number. */
function typedNumber(typed: unknown): number | undefined {
  const t = typeof typed === "string" ? typed.trim().replace(/^x/i, "").replace(",", ".") : "";
  return t === "" ? undefined : Number(t);
}
const typedBad = (typed: unknown, lo: number, hi: number): boolean => {
  const n = typedNumber(typed);
  return n !== undefined && !(n >= lo && n <= hi);
};

export function pickNumber(values: number[], index: unknown, typed: unknown, current: number, lo: number, hi: number): number {
  const n = typedNumber(typed);
  if (n !== undefined && n >= lo && n <= hi) return Math.round(n * 100) / 100;
  const i = Number(index);
  return Number.isInteger(i) && i >= 0 && i < values.length ? values[i] : current;
}

async function settingsForm(p: Player): Promise<void> {
  const speed = presetList(SPEEDS, CONFIG.pacing, 1, (v) => `x${v}${v < 1 ? " (slower)" : v > 1 ? " (faster)" : ""}`);
  const dmg = presetList(DAMAGES, CONFIG.damage, 1, (v) => (v === 0 ? "None (x0)" : `x${v}`));
  const f = new ModalFormData().title("Basiliskra Settings")
    .dropdown("Story speed", speed.items, { defaultValueIndex: speed.index, tooltip: "x2 halves every wait and threshold; x0.5 doubles them." })
    .textField("...or type a story speed (0.25 to 4)", "e.g. 1.25")
    .dropdown("What his beam, roar and weight do to the world", ["Nothing (light and sound only)", "Scorch natural ground", "Scorch and break natural ground",
      "Destroy everything, like the Wither (default)"], { defaultValueIndex: Math.max(0, TERRAIN.indexOf(CONFIG.terrain)) })
    .toggle("Spare chests, beds, furnaces and portals", { defaultValue: CONFIG.spareStorage })
    .toggle("Footprints and furrows in natural ground", { defaultValue: CONFIG.marks })
    .dropdown("Damage to players", dmg.items, { defaultValueIndex: dmg.index })
    .textField("...or type a damage multiplier (0 to 4)", "e.g. 0.75")
    .toggle("Harmless on Peaceful", { defaultValue: CONFIG.harmlessOnPeaceful })
    .toggle("He hunts animals and other creatures too", { defaultValue: CONFIG.huntMobs })
    .toggle("Spawn eggs and /summon bring him to you", { defaultValue: CONFIG.allowSummon })
    .dropdown("A spawn egg makes", ["His stage in the story", "Basiliskra I", "Basiliskra II", "Basiliskra III", "Basiliskra IV"], { defaultValueIndex: CONFIG.spawnForm })
    .toggle("Give new players the journal", { defaultValue: CONFIG.giveJournal })
    .toggle("Give operators the config wheel", { defaultValue: CONFIG.giveWheel })
    .toggle("Debug messages in the content log", { defaultValue: CONFIG.debug })
    .dropdown("His fallout", ["Off", "Glowing motes and Geiger clicks only", "Also changes the land (natural ground only)"], { defaultValueIndex: FALLOUT.indexOf(CONFIG.fallout) })
    .toggle("Radiation sickness for players", { defaultValue: CONFIG.sickness })
    .toggle("Cutscenes (the rift, each transformation)", { defaultValue: CONFIG.cutscenes })
    .toggle("His music", { defaultValue: CONFIG.music })
    .dropdown("Minutes in each form before he changes (time is all it takes)", MINUTES.map((m) => (m ? `${m} minutes` : "The story's timing: 40, 40, 60 (at story speed 1)")),
      { defaultValueIndex: Math.max(0, MINUTES.indexOf(CONFIG.changeMinutes)) })
    .toggle("Cities rise on coasts as you explore (never over anything built)", { defaultValue: CONFIG.cities })
    .toggle("§cRestore every default", { defaultValue: false })
    .submitButton("Save");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  if (v[20] === true) { resetSettings(); p.sendMessage("§7[Basiliskra] Settings restored to the defaults."); return; }
  const pacing = pickNumber(SPEEDS, v[0], v[1], CONFIG.pacing, 0.25, 4);
  const damage = pickNumber(DAMAGES, v[5], v[6], CONFIG.damage, 0, 4);
  const bad = typedBad(v[1], 0.25, 4) || typedBad(v[6], 0, 4);
  saveSettings({
    pacing, terrain: TERRAIN[Number(v[2])] ?? "wither", spareStorage: v[3] === true, marks: v[4] === true, damage,
    harmlessOnPeaceful: v[7] === true, huntMobs: v[8] === true, allowSummon: v[9] === true, spawnForm: (Number(v[10]) as 0 | 1 | 2 | 3 | 4),
    giveJournal: v[11] === true, giveWheel: v[12] === true, debug: v[13] === true, fallout: FALLOUT[Number(v[14])] ?? "land", sickness: v[15] === true,
    cutscenes: v[16] === true, music: v[17] === true, changeMinutes: MINUTES[Number(v[18])] ?? 0, cities: v[19] === true,
  });
  p.sendMessage(`§7[Basiliskra] Settings saved with this world. Story speed §fx${CONFIG.pacing}§7, damage §fx${CONFIG.damage}§7.`);
  if (bad) p.sendMessage("§7[Basiliskra] A number you typed was not in range, so the choice above it was used.");
}

async function bringForm(p: Player, ctl: Controller): Promise<void> {
  const f = new ActionFormData().title("Bring him here")
    .body(`§7The one Basiliskra comes to you: moved here if he is about, made here if he is not. There is never more than one.\n§7Now: ${store.rec.born > 0 ? `Basiliskra ${ROMAN[store.rec.form]}` : "he has never come"}.`)
    .button("As he is in the story").button("Basiliskra I (the water)").button("Basiliskra II (the shore)").button("Basiliskra III (four footfalls)").button("Basiliskra IV (the last form)");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || r.selection === undefined) return;
  if (p.dimension.id !== OVERWORLD) { p.sendMessage("§7[Basiliskra] He only lives in the Overworld."); return; }
  const want = r.selection as 0 | 1 | 2 | 3 | 4;
  const place = placeFor(p, want || formOf() || 3);
  p.sendMessage(`§7[Basiliskra] ${ctl.bringHere(place.at, place.yaw, want)}`);
}

async function confirm(p: Player, title: string, body: string): Promise<boolean> {
  const f = new MessageFormData().title(title).body(body).button1("Yes").button2("No");
  const r = await present(p, () => f.show(p));
  return !!r && !r.canceled && r.selection === 0;
}

export async function openWheel(p: Player, ctl: Controller): Promise<void> {
  if (!canAdmin(p)) { p.sendMessage("§7[Basiliskra] Only an operator can use the config wheel."); return; }
  const rec = store.rec;
  const here = ctl.creature && ctl.creature.valid;
  const state = here ? `§cBasiliskra ${ROMAN[rec.form]} is here` : rec.stage === "arriving" ? "§ehe is coming through" : rec.stage === "alive" ? `§7Basiliskra ${ROMAN[rec.form]} is away, owed back` : "§7he is not in this world";
  const f = new ActionFormData().title("Basiliskra Config Wheel")
    .body(`${state}§7 · Story speed §fx${CONFIG.pacing}§7 · Damage §fx${CONFIG.damage}`)
    .button("Settings")
    .button("Call him now (the rift opens)")
    .button("Bring him here (no rift, pick a form)")
    .button("Make him change now (next form)")
    .button("Send him away (until he is called)")
    .button("Skip to dusk")
    .button("Journal")
    .button("§cReset the story")
    .button("Raise a city here (a beach, and a very deep sea)");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled) return;
  switch (r.selection) {
    case 0: await settingsForm(p); break;
    case 1: {
      if (p.dimension.id !== OVERWORLD) { p.sendMessage("§7[Basiliskra] He only lives in the Overworld."); break; }
      // (a rift on land needs somewhere to stand: in front of the caller, on the ground)
      const form = rec.stage === "alive" && rec.born > 0 ? rec.form : 1;
      p.sendMessage(`§7[Basiliskra] ${ctl.callNow(p.location, p, form > 1 ? placeFor(p, form) : undefined)}`);
      break;
    }
    case 2: await bringForm(p, ctl); break;
    case 3: p.sendMessage(`§7[Basiliskra] ${ctl.evolveNow()}`); break;
    case 4:
      if (await confirm(p, "Send him away", "He leaves through a seam and stays gone until you call him again (or until the land is harmed enough to call him). The story starts again from Basiliskra I; the anger on record and his fallout stay.")) {
        p.sendMessage(ctl.sendAway() ? "§7[Basiliskra] He is gone. Call him now opens the rift again, whenever you want it." : "§7[Basiliskra] He was not in this world.");
      }
      break;
    case 5: world.setTimeOfDay(DUSK + 100); p.sendMessage("§7[Basiliskra] Dusk."); break;
    case 6: await openJournal(p, ctl); break;
    case 8: await cityForm(p); break;
    case 7:
      if (await confirm(p, "Reset the story", "Forget him, his form, everything he has learned and all the anger on record, as if the pack had just been added. He is removed from the world.")) {
        ctl.resetStory();
        p.sendMessage("§7[Basiliskra] The story has been reset.");
      }
      break;
  }
}

/** A city, where the operator stands: the promenade under their feet, the streets behind them, the sea ahead. */
export async function cityForm(p: Player): Promise<void> {
  if (!canAdmin(p)) { p.sendMessage("§7[Basiliskra] Only an operator can raise a city."); return; }
  if (p.dimension.id !== OVERWORLD) { p.sendMessage("§7[Basiliskra] Cities stand in the Overworld."); return; }
  const f = new ActionFormData().title("Raise a city here")
    .body("§7You will be standing on its promenade. §fBehind you§7: streets, towers, houses, people. §fAhead of you§7 (the way you are looking): a beach, and beyond it a sea cut a hundred blocks deep, with things on the bottom.\n§cEverything in that area is replaced§7: about 180 by 160 blocks of city and beach, and 200 by 140 of sea. It takes under a minute.")
    .button("A full city (175 by 119)").button("A small one (91 by 63)").button("Not here");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || r.selection === undefined || r.selection > 1) return;
  let v = { x: 0, y: 0, z: 1 };
  try { v = p.getViewDirection(); } catch { /* left */ }
  const dir = (Math.abs(v.z) >= Math.abs(v.x) ? (v.z >= 0 ? 0 : 2) : (v.x < 0 ? 1 : 3)) as 0 | 1 | 2 | 3;
  const at = { ...p.location };
  const said = raiseCity(at, dir, r.selection === 1);
  p.sendMessage(`§7[Basiliskra] ${said}`);
  // the promenade is laid a little above the sea whatever stood here: put them on it
  if (/rising/.test(said)) { try { p.teleport({ x: at.x, y: Math.max(64, Math.min(83, Math.floor(at.y))) + 1.2, z: at.z }); } catch { /* left */ } }
}

// ---- handing them out -----------------------------------------------------------------------------------------
export function giveStarterItems(p: Player): void {
  try { if (p.getDynamicProperty("bk:given") === true) return; } catch { return; }
  const items: string[] = [];
  if (CONFIG.giveJournal) items.push(JOURNAL_ITEM);
  if (CONFIG.giveWheel && canAdmin(p)) items.push(WHEEL_ITEM);
  for (const id of items) {
    try {
      const left = p.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack(id, 1));
      if (left) p.dimension.spawnItem(left, p.location);
    } catch { /* inventory unavailable */ }
  }
  try { p.setDynamicProperty("bk:given", true); } catch { /* left */ }
  if (items.length) p.sendMessage(`§7[Basiliskra] ${items.length > 1 ? "A journal and a config wheel are" : "A journal is"} in your inventory. Use the journal to see how angry he is, and when he will come.`);
}

