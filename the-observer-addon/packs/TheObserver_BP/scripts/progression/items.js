// @ts-check
// Tools and defences. Few, each with a clear job:
//   Field Notes     journal: discoveries, learned tells, the vigil, settings (operators)
//   Tally Chalk     mark up to 8 spots; a mark smudges (sound + message) when the Observer changes
//                   anything within 4 blocks of it — attention made into a tool
//   Witness Lens    look at it through the lens: it recoils and withdraws (20 s cooldown);
//                   with nothing to hold, the lens shows where it has walked (its trails, its effigies)
//   Ward Lantern    it will not stand or change blocks within 12 blocks (protects a build)
//   Vestige         fragments from effigies and discoveries; crafting material
//   Observer's Eye  reward for the vigil; opens the "after" choice
import { world, system, GameMode } from "@minecraft/server";
import { ITEMS, BLOCKS, SOUNDS, PARTICLES, OBSERVER_ID, ENTITY_ENC_PROP } from "../core/constants.js";
import { W, ps, now, markWorldDirty, markPlayerDirty } from "../core/state.js";
import { V, safe, dimIndex, blockKey, emit, allPlayers } from "../core/util.js";
import * as ledger from "../world/ledger.js";
import * as body from "../observer/body.js";
import { visibility } from "../world/sight.js";
import { discover, give } from "./discoveries.js";
import { openJournal, openAfter, showLater } from "../ui/forms.js";

/** @typedef {import("@minecraft/server").Player} Player */

const MAX_MARKS = 8;
const MAX_WARDS = 64;
/** @type {Map<string, number>} */
const lensUsed = new Map();

/** Pressure on the Observer from a player (lens, blows). Enough pressure buys a long quiet spell. */
function pressure(p) {
  const s = ps(p);
  s.composure -= 1;
  if (s.composure <= 0) {
    s.quietUntil = Math.max(s.quietUntil, now() + 900);
    s.composure = 3;
    safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.withdrawn" }] }));
  }
  markPlayerDirty(p);
}

/** @param {Player} p */
function consumeSelected(p) {
  if (safe(() => p.getGameMode(), GameMode.Survival) === GameMode.Creative) return;
  const inv = p.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  const slot = p.selectedSlotIndex;
  const it = inv.getItem(slot);
  if (!it) return;
  if (it.amount <= 1) inv.setItem(slot, undefined);
  else {
    it.amount -= 1;
    inv.setItem(slot, it);
  }
}

// ---------------------------------------------------------------- chalk

/** @param {Player} p */
function useChalk(p) {
  const hit = safe(() => p.getBlockFromViewDirection({ maxDistance: 6 }));
  if (!hit) return;
  const s = ps(p);
  const d = dimIndex(p.dimension.id);
  const bl = hit.block.location;
  const fl = hit.faceLocation;
  const local = fl.x >= -0.01 && fl.x <= 1.01 && fl.y >= -0.01 && fl.y <= 1.01 && fl.z >= -0.01 && fl.z <= 1.01;
  const pt = local ? { x: bl.x + fl.x, y: bl.y + fl.y, z: bl.z + fl.z } : { x: fl.x, y: fl.y, z: fl.z };
  const existing = s.marks.findIndex((m) => m[0] === d && V.dist({ x: m[1], y: m[2], z: m[3] }, pt) < 1.2);
  if (p.isSneaking && existing >= 0) {
    s.marks.splice(existing, 1);
    safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.chalk_removed" }] }));
  } else {
    s.marks.push([d, Math.round(pt.x * 100) / 100, Math.round(pt.y * 100) / 100, Math.round(pt.z * 100) / 100, 0, bl.x, bl.y, bl.z]);
    while (s.marks.length > MAX_MARKS) s.marks.shift();
    consumeSelected(p);
    safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.chalk_marked", with: [String(s.marks.length), String(MAX_MARKS)] }] }));
  }
  safe(() => p.playSound(SOUNDS.chalk, { location: pt, volume: 0.6 }));
  markPlayerDirty(p);
}

/** Ledger change near a mark -> smudge it and tell the player (always shown: it is the tool's purpose). */
function smudgeNear(e) {
  for (const p of allPlayers()) {
    const s = ps(p);
    for (const m of s.marks) {
      if (m[0] !== e.d || m[4]) continue;
      if (V.dist({ x: m[5], y: m[6], z: m[7] }, { x: e.x, y: e.y, z: e.z }) > 4) continue;
      m[4] = 1;
      markPlayerDirty(p);
      emit("smudge", { player: p.name, x: m[5], y: m[6], z: m[7] });
      safe(() => p.playSound(SOUNDS.chalk, { location: { x: m[1], y: m[2], z: m[3] }, volume: 0.9, pitch: 0.7 }));
      safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.chalk_smudged" }] }));
    }
  }
}

/** Every 2 s: draw each player's own marks near them. */
export function renderMarks() {
  for (const p of allPlayers()) {
    const s = ps(p);
    if (!s.marks.length) continue;
    const d = dimIndex(p.dimension.id);
    for (const m of s.marks) {
      if (m[0] !== d) continue;
      const pt = { x: m[1], y: m[2], z: m[3] };
      if (V.dist(pt, p.location) > 24) continue;
      safe(() => p.spawnParticle(m[4] ? PARTICLES.chalkSmudged : PARTICLES.chalk, pt));
    }
  }
}

// ---------------------------------------------------------------- lens

/** Seconds; matches the item's minecraft:cooldown component (category observer_lens). */
const LENS_COOLDOWN = 20;

/** @param {Player} p @param {(enc:any)=>void} onLensed */
function useLens(p, onLensed) {
  const t = now();
  if (t - (lensUsed.get(p.id) ?? -99) < LENS_COOLDOWN) return;
  lensUsed.set(p.id, t);
  safe(() => p.playSound(SOUNDS.lens, { volume: 0.7 }));
  const b = body.get();
  if (b && b.e.dimension.id === p.dimension.id && V.dist(b.e.location, p.location) < 80) {
    const v = visibility(p, b.e.location, { stooped: b.stoop, fov: 15 });
    if (v.points > 0) {
      body.setState("recoil");
      onLensed(b.enc);
      discover(p, "through_the_lens");
      pressure(p);
      return;
    }
  }
  // nothing to hold: the lens shows where it has walked
  const d = dimIndex(p.dimension.id);
  let shown = 0;
  for (const tr of W.traces) {
    if (tr.d !== d) continue;
    for (const pt of tr.pts) {
      if (Math.hypot(pt[0] - p.location.x, pt[2] - p.location.z) > 28) continue;
      safe(() => p.spawnParticle(PARTICLES.footprint, { x: pt[0], y: pt[1] + 0.05, z: pt[2] }));
      shown++;
    }
  }
  for (const e of ledger.all()) {
    if (e.kind !== "effigy" || e.d !== d) continue;
    if (V.dist({ x: e.x, y: e.y, z: e.z }, p.location) > 40) continue;
    for (let h = 0; h < 4; h++) safe(() => p.spawnParticle(PARTICLES.motes, { x: e.x + 0.5, y: e.y + 0.6 + h, z: e.z + 0.5 }));
    shown++;
  }
  safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: shown ? "observer.ui.lens_traces" : "observer.ui.lens_nothing" }] }));
}

// ---------------------------------------------------------------- wards

/** Validate wards whose chunks are loaded (every 60 s). */
export function validateWards() {
  const keep = [];
  for (const w of W.wards) {
    const dim = world.getDimension(["minecraft:overworld", "minecraft:nether", "minecraft:the_end"][w[0]]);
    const loc = { x: w[1], y: w[2], z: w[3] };
    if (!safe(() => dim.isChunkLoaded(loc), false)) {
      keep.push(w);
      continue;
    }
    if (safe(() => dim.getBlock(loc)?.typeId) === BLOCKS.ward) keep.push(w);
  }
  if (keep.length !== W.wards.length) {
    W.wards = keep;
    markWorldDirty();
  }
}

// ---------------------------------------------------------------- registration

/**
 * @param {{startVigil:(p:Player)=>void, onLensed:(enc:number)=>void, onBodyHit:(p:Player, enc:number)=>void, openWheel:(p:Player)=>Promise<void>}} hooks
 */
export function registerEvents(hooks) {
  world.afterEvents.itemUse.subscribe((ev) => {
    const p = ev.source;
    const id = ev.itemStack.typeId;
    if (id === ITEMS.notes) showLater(() => openJournal(p, hooks.startVigil));
    else if (id === ITEMS.lens) useLens(p, hooks.onLensed);
    else if (id === ITEMS.chalk) useChalk(p);
    else if (id === ITEMS.eye) showLater(() => openAfter(p));
    else if (id === ITEMS.wheel) showLater(() => hooks.openWheel(p));
  });

  ledger.onChange(smudgeNear);

  // effigies: breaking one yields a Vestige (no loot table, so no duplication)
  ledger.onRelease((e, how, player) => {
    if (e.kind !== "effigy" || how !== "broken" || !player) return;
    const loc = { x: e.x + 0.5, y: e.y + 0.4, z: e.z + 0.5 };
    give(player, ITEMS.vestige, 1);
    discover(player, "small_likeness");
    safe(() => player.dimension.playSound(SOUNDS.effigy, loc, { volume: 0.8 }));
    safe(() => player.dimension.spawnParticle(PARTICLES.unravel, loc));
  });

  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    if (ev.block.typeId !== BLOCKS.ward) return;
    const d = dimIndex(ev.block.dimension.id);
    const l = ev.block.location;
    if (W.wards.length >= MAX_WARDS) W.wards.shift();
    W.wards.push([d, l.x, l.y, l.z]);
    markWorldDirty();
    safe(() => ev.player.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.ward_placed" }] }));
    // a new ward releases anything the Observer changed inside its radius
    for (const e of ledger.all()) if (e.d === d && V.dist({ x: e.x, y: e.y, z: e.z }, l) <= 12) ledger.restore(e);
  });
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    if (ev.brokenBlockPermutation.type.id !== BLOCKS.ward) return;
    const d = dimIndex(ev.dimension.id);
    const k = blockKey(d, ev.block.location);
    W.wards = W.wards.filter((w) => blockKey(w[0], { x: w[1], y: w[2], z: w[3] }) !== k);
    markWorldDirty();
  });

  // blows: the body recoils; puppets just flinch
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    const e = ev.hitEntity;
    if (e.typeId !== OBSERVER_ID || ev.damagingEntity.typeId !== "minecraft:player") return;
    const p = /** @type {Player} */ (ev.damagingEntity);
    if (safe(() => e.getDynamicProperty(ENTITY_ENC_PROP)) === undefined) {
      safe(() => e.setProperty("observer:state", "recoil"));
      system.runTimeout(() => safe(() => e.setProperty("observer:state", "watch")), 20);
      return;
    }
    safe(() => e.dimension.playSound(SOUNDS.fabric, e.location, { volume: 0.9 }));
    pressure(p);
    hooks.onBodyHit(p, /** @type {number} */ (safe(() => e.getDynamicProperty(ENTITY_ENC_PROP))));
  });
}
