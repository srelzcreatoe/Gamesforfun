/**
 * The two things a player holds: the journal (how angry he is, and when he comes) and the config wheel
 * (operators: settings, and calling or sending him on purpose).  Both are plain server-ui forms, opened from
 * the items or from /basiliskra:journal and /basiliskra:config.
 */
import { ItemStack, Player, PlayerPermissionLevel, system, world } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { pace } from "./brain";
import { CONFIG, JOURNAL_ITEM, OVERWORLD, TICKS, WHEEL_ITEM } from "./config";
import type { Controller } from "./controller";
import { angerAt, angriest, halfLifeDays, type Anger } from "./harm";
import { doseAt, falloutCount, nearestFallout } from "./fallout";
import { saveSettings, resetSettings } from "./settings";
import { store } from "./store";
import type { V3 } from "./vec";
import { NONE, UNLOADED, groundY, overworld } from "./world";

const ROMAN = ["", "I", "II", "III"];
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
  L.push(`${here ? "§fWhere you stand" : `§fThe angriest place: around ${Math.floor(a.center.x)}, ${Math.floor(a.center.z)} §7(${compass(p.location, a.center)})`}§r`);
  L.push(`  ${bar(a.pct)} §l${pct(a.pct)}§r`);
  L.push(`  §7Animals killed by players: §f${pct(a.animals)}§7   Trees, reeds, shore plants cut: §f${pct(a.habitat)}§7   Together: §f${pct(a.total)}`);
  if (a.fired) L.push("  §7He has already been called from here.");
  else if (a.pct < 1) L.push(`  §7To call him from here: about §f${a.moreKills}§7 more animal${a.moreKills === 1 ? "" : "s"} killed and §f${a.moreLogs}§7 more logs (or reeds and shore plants) cut.`);
  const total = Object.values(a.by).reduce((s, v) => s + v, 0);
  const mine = a.by[p.id] ?? 0;
  if (total > 0) L.push(`  §7Your share of it: §f${pct(mine / total)}`);
  return L;
}

function evolveLines(): string[] {
  const rec = store.rec, now = rec.clock, L: string[] = [];
  const days = Math.min(1, (now - rec.mut.formSince) / pace(2 * TICKS.day));
  if (rec.evolve) { L.push("§cHe is changing right now."); return L; }
  if (rec.form === 1) {
    const s = Math.min(1, rec.mut.surfacings / 6), e = Math.min(1, rec.mut.episodes / 3), f = Math.min(days, s, e);
    L.push(`§fBecoming Basiliskra II: ${bar(f, "§6")} §l${pct(f)}§r`);
    L.push(`  §7Days in the water ${pct(days)} · seen at the surface ${Math.min(rec.mut.surfacings, 6)} of 6 · spasms ${Math.min(rec.mut.episodes, 3)} of 3`);
    L.push("  §7He surfaces near boats and swimmers; the spasms come near piers and in open water at dusk. Then he beaches on a sand or gravel shore with someone near.");
  } else if (rec.form === 2) {
    const o = Math.min(1, (rec.mut.overland * CONFIG.pacing) / 220), f = Math.min(days, o);
    L.push(`§fBecoming Basiliskra III: ${bar(f, "§6")} §l${pct(f)}§r`);
    L.push(`  §7Days on the shore ${pct(days)} · dragged overland ${Math.floor(Math.min(220, rec.mut.overland * CONFIG.pacing))} of 220 blocks`);
    L.push("  §7The change comes at night or in rain, with someone near.");
  } else {
    L.push("§fThe last crossing");
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
    if (CONFIG.fallout === "land") L.push("§7In it, grass and dirt turn to irradiated soil, plants wither and wild leaves fall. Sand his beam touches becomes scarlet trinitite. As it fades, the soil heals.");
    if (CONFIG.sickness) L.push("§7Strong fallout makes you hungry, then weak and sick. Milk clears it. A Geiger counter (trinitite, copper ingot, redstone) reads it.");
  }
  return L;
}

export function journalText(p: Player, ctl: Controller): string {
  const now = store.rec.clock, L: string[] = [];
  L.push("§l§4HIS ANGER§r");
  let here: Anger | null = null;
  try { if (p.dimension.id === OVERWORLD) here = angerAt(p.location, now); } catch { here = null; }
  if (here) L.push(...angerLines(p, here, true));
  else L.push("§7Only what is done in the Overworld counts.");
  const top = angriest(now);
  if (top && (!here || top.key !== here.key)) { L.push(""); L.push(...angerLines(p, top, false)); }
  L.push(`§8Left alone, anger halves every ${halfLifeDays().toFixed(1)} in-game days. One meal or one tree counts for almost nothing.`);
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
  const d = [0, 15, 19, 27][form] ?? 24;
  const pl = p.location;
  const pos = { x: pl.x + (v.x / n) * d, y: pl.y, z: pl.z + (v.z / n) * d };
  const g = groundY(overworld(), pos.x, pos.z, pl.y + 24, 48);
  if (g !== UNLOADED && g !== NONE) pos.y = g as number;
  const yaw = (Math.atan2(-(pl.x - pos.x), pl.z - pos.z) * 180) / Math.PI;
  return { at: pos, yaw };
}

function formOf(rec = store.rec): number { return rec.born > 0 ? rec.form : 0; }

async function settingsForm(p: Player): Promise<void> {
  const terrain = ["none", "scorch", "break"] as const;
  const f = new ModalFormData().title("Basiliskra Settings")
    .slider("Story speed (x)", 0.25, 4, { valueStep: 0.25, defaultValue: CONFIG.pacing, tooltip: "2 halves every wait and threshold; 0.5 doubles them." })
    .dropdown("What his beam does to the ground", ["Nothing (light only)", "Scorches natural ground", "Scorches and breaks natural ground"], { defaultValueIndex: terrain.indexOf(CONFIG.terrain) })
    .toggle("Footprints and furrows in natural ground", { defaultValue: CONFIG.marks })
    .slider("Damage to players (x)", 0, 3, { valueStep: 0.25, defaultValue: CONFIG.damage })
    .toggle("Harmless on Peaceful", { defaultValue: CONFIG.harmlessOnPeaceful })
    .toggle("Spawn eggs and /summon bring him to you", { defaultValue: CONFIG.allowSummon })
    .dropdown("A spawn egg makes", ["His stage in the story", "Basiliskra I", "Basiliskra II", "Basiliskra III"], { defaultValueIndex: CONFIG.spawnForm })
    .toggle("Give new players the journal", { defaultValue: CONFIG.giveJournal })
    .toggle("Give operators the config wheel", { defaultValue: CONFIG.giveWheel })
    .toggle("Debug messages in the content log", { defaultValue: CONFIG.debug })
    .dropdown("His fallout", ["Off", "Glowing motes and Geiger clicks only", "Also changes the land (natural ground only)"], { defaultValueIndex: FALLOUT.indexOf(CONFIG.fallout) })
    .toggle("Radiation sickness for players", { defaultValue: CONFIG.sickness })
    .toggle("§cRestore every default", { defaultValue: false })
    .submitButton("Save");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  if (v[12] === true) { resetSettings(); p.sendMessage("§7[Basiliskra] Settings restored to the defaults."); return; }
  saveSettings({
    pacing: Number(v[0]), terrain: terrain[Number(v[1])] ?? "scorch", marks: v[2] === true, damage: Number(v[3]),
    harmlessOnPeaceful: v[4] === true, allowSummon: v[5] === true, spawnForm: (Number(v[6]) as 0 | 1 | 2 | 3), giveJournal: v[7] === true,
    giveWheel: v[8] === true, debug: v[9] === true, fallout: FALLOUT[Number(v[10])] ?? "land", sickness: v[11] === true,
  });
  p.sendMessage("§7[Basiliskra] Settings saved with this world.");
}

async function bringForm(p: Player, ctl: Controller): Promise<void> {
  const f = new ActionFormData().title("Bring him here")
    .body(`§7The one Basiliskra comes to you: moved here if he is about, made here if he is not. There is never more than one.\n§7Now: ${store.rec.born > 0 ? `Basiliskra ${ROMAN[store.rec.form]}` : "he has never come"}.`)
    .button("As he is in the story").button("Basiliskra I (the water)").button("Basiliskra II (the shore)").button("Basiliskra III (four footfalls)");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || r.selection === undefined) return;
  if (p.dimension.id !== OVERWORLD) { p.sendMessage("§7[Basiliskra] He only lives in the Overworld."); return; }
  const want = r.selection as 0 | 1 | 2 | 3;
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
  const f = new ActionFormData().title("Basiliskra Config Wheel")
    .body(`§7Stage: §f${store.rec.stage}§7 · Form: §f${store.rec.born > 0 ? ROMAN[store.rec.form] : "-"}§7 · Story speed §fx${CONFIG.pacing}§7 · Damage §fx${CONFIG.damage}`)
    .button("Settings")
    .button("Bring him here")
    .button("Call him (opens the rift at the next dusk)")
    .button("Skip to dusk")
    .button("Send him back through the seam")
    .button("Journal")
    .button("§cReset the story");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled) return;
  switch (r.selection) {
    case 0: await settingsForm(p); break;
    case 1: await bringForm(p, ctl); break;
    case 2:
      if (p.dimension.id !== OVERWORLD) { p.sendMessage("§7[Basiliskra] He only lives in the Overworld."); break; }
      p.sendMessage(`§7[Basiliskra] ${ctl.callNow(p.location, p)}`);
      break;
    case 3: world.setTimeOfDay(DUSK + 100); p.sendMessage("§7[Basiliskra] Dusk."); break;
    case 4:
      if (!ctl.creature) { p.sendMessage("§7[Basiliskra] He is not about to send anywhere."); break; }
      ctl.driveOff(true);
      p.sendMessage("§7[Basiliskra] He has gone back through a seam. He returns in a day, when someone is near.");
      break;
    case 5: await openJournal(p, ctl); break;
    case 6:
      if (await confirm(p, "Reset the story", "Forget him, his form, everything he has learned and all the anger on record, as if the pack had just been added. He is removed from the world.")) {
        ctl.resetStory();
        p.sendMessage("§7[Basiliskra] The story has been reset.");
      }
      break;
  }
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

