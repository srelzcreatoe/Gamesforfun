// @ts-nocheck
// =============================================================================
//  THE GOATWALKER  -  the Stellar Taiga: its blocks, items and atmosphere
//
//  * void doors (two halves), trapdoors, slab stacking, log stripping, hanging banners
//  * flares (thrown; light the ground for ~20 s), the Lens, the old map, ritual notes,
//    field kits, antler charms
//  * ash drifting in the air, faintly glowing corpse-caps and rift embers, eclipse nights
//  * a fallback that fills structure chests if the loot table did not apply
//  * vanilla parity for his woods: shears clip leaves/moss/ferns at once, leaves left hanging
//    after a tree is cut down decay, hoes till and shovels path the soil, bone meal grows it
// =============================================================================
import { world, system, BlockVolume, ItemStack, EquipmentSlot, GameMode } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import {
  NS, V, now, rnd, rint, pick, chance, safe, alive, blockAt, isGround, PASS_RE, playAt, playFor, particle,
  setPerm, track, st, eye, survivalish, consumeHeld, dirIndex, domainAt, isEclipse, pushFog, popFog, music,
  hint, OVERWORLD, angleOf, fromAngle,
} from "./core.js";
import { FLARES, onExtinguish } from "./hunt.js";
import { mind, learnedNode, homeOf } from "./mind.js";

const DOOR = `${NS}:void_door_block`;
const OFF = { Up: { x: 0, y: 1, z: 0 }, Down: { x: 0, y: -1, z: 0 }, North: { x: 0, y: 0, z: -1 }, South: { x: 0, y: 0, z: 1 },
  East: { x: 1, y: 0, z: 0 }, West: { x: -1, y: 0, z: 0 } };
const REPLACEABLE = /^minecraft:air$|short_grass|tall_grass|fern$|snow_layer|stellar_grass|rift_fern|goatwalker:(ash_print|blood_ash)/;

// =================================================================== custom block components
export function registerComponents(ev) {
  ev.blockComponentRegistry.registerCustomComponent(`${NS}:door`, {
    onPlayerInteract(e) { toggleDoor(e.block, e.player); },
    onPlayerBreak(e) {
      const upper = safe(() => e.brokenBlockPermutation.getState(`${NS}:upper`)) === true;
      const other = upper ? e.block.below() : e.block.above();
      if (other && other.typeId === DOOR) safe(() => other.setType("minecraft:air"));
    },
  });
  ev.blockComponentRegistry.registerCustomComponent(`${NS}:trapdoor`, {
    onPlayerInteract(e) {
      const b = e.block;
      const open = safe(() => b.permutation.getState(`${NS}:open`)) === true;
      safe(() => b.setPermutation(b.permutation.withState(`${NS}:open`, !open)));
      playAt(b.dimension, open ? "close.wooden_trapdoor" : "open.wooden_trapdoor", V.add(b.location, { x: 0.5, y: 0.5, z: 0.5 }), 1, rnd(0.9, 1.0));
    },
  });
  ev.blockComponentRegistry.registerCustomComponent(`${NS}:banner`, {
    onPlayerBreak(e) {
      const part = safe(() => e.brokenBlockPermutation.getState(`${NS}:part`));
      const other = part === 1 ? e.block.above() : e.block.below();
      if (other && other.typeId === `${NS}:hanging_banner`) safe(() => other.setType("minecraft:air"));
    },
  });
}

function toggleDoor(b, p) {
  if (!b || b.typeId !== DOOR) return;
  const upper = safe(() => b.permutation.getState(`${NS}:upper`)) === true;
  const lower = upper ? b.below() : b;
  const top = upper ? b : b.above();
  const open = safe(() => lower.permutation.getState(`${NS}:open`)) === true;
  for (const x of [lower, top]) if (x && x.typeId === DOOR) safe(() => x.setPermutation(x.permutation.withState(`${NS}:open`, !open)));
  playAt(b.dimension, open ? "close.wooden_door" : "open.wooden_door", V.add(lower.location, { x: 0.5, y: 1, z: 0.5 }), 1, rnd(0.9, 1.0));
}

// =================================================================== item-on-block interactions
/** Called from world.beforeEvents.playerInteractWithBlock.  Returns true if it handled (and cancelled) the event. */
export function interact(ev) {
  const it = ev.itemStack, p = ev.player, b = ev.block;
  if (!it) return false;
  const id = it.typeId;
  if (id === `${NS}:void_door`) { ev.cancel = true; if (ev.isFirstEvent) system.run(() => placeDoor(p, b, ev.blockFace)); return true; }
  if (id === `${NS}:hanging_banner_item`) { ev.cancel = true; if (ev.isFirstEvent) system.run(() => placeBanner(p, b, ev.blockFace)); return true; }
  if (id === `${NS}:void_slab` && b.typeId === `${NS}:void_slab`) {
    const half = safe(() => b.permutation.getState("minecraft:vertical_half"));
    if ((half === "bottom" && ev.blockFace === "Up") || (half === "top" && ev.blockFace === "Down")) {
      ev.cancel = true;
      if (ev.isFirstEvent) system.run(() => {
        if (b.typeId !== `${NS}:void_slab`) return;
        safe(() => b.setType(`${NS}:void_double_slab`));
        playAt(b.dimension, "use.wood", V.add(b.location, { x: 0.5, y: 0.5, z: 0.5 }), 1, 0.8);
        if (survivalish(p)) consumeHeld(p, id);
      });
      return true;
    }
  }
  if (/_axe$/.test(id) && (b.typeId === `${NS}:void_log`)) {
    ev.cancel = true;
    if (ev.isFirstEvent) system.run(() => stripLog(p, b));
    return true;
  }
  // the soil works like vanilla dirt and grass
  const open = () => { const up = b.above(); return !!up && (up.isAir || /stellar_grass|short_grass/.test(up.typeId)); };
  if (/_hoe$/.test(id) && SOILS.includes(b.typeId) && ev.blockFace !== "Down" && open()) {
    ev.cancel = true;
    if (ev.isFirstEvent) system.run(() => turnSoil(p, b, ["minecraft:farmland"], { moisturized_amount: 0 }, "use.gravel"));
    return true;
  }
  if (/_shovel$/.test(id) && (b.typeId === `${NS}:stellar_soil` || b.typeId === `${NS}:ashen_podzol`) && ev.blockFace !== "Down" && open()) {
    ev.cancel = true;
    if (ev.isFirstEvent) system.run(() => turnSoil(p, b, ["minecraft:grass_path", "minecraft:dirt_path"], {}, "use.grass"));
    return true;
  }
  if (id === "minecraft:bone_meal" && b.typeId === `${NS}:stellar_soil` && open()) {
    ev.cancel = true;
    if (ev.isFirstEvent) system.run(() => boneMeal(p, b));
    return true;
  }
  return false;
}
function stripLog(p, b) {
  const face = safe(() => b.permutation.getState("minecraft:block_face"), "up");
  if (!setPerm(b.dimension, b.location, `${NS}:stripped_void_log`, { "minecraft:block_face": face })) return;
  playAt(b.dimension, "use.wood", V.add(b.location, { x: 0.5, y: 0.5, z: 0.5 }), 1, 0.85);
  wearHeld(p);
}
/** one point of wear on the held tool (Unbreaking honoured); breaks it when it runs out */
function wearHeld(p) {
  if (!survivalish(p)) return;
  safe(() => {
    const eq = p.getComponent("minecraft:equippable");
    const it = eq.getEquipment(EquipmentSlot.Mainhand);
    const d = it && it.getComponent("minecraft:durability");
    if (!d) return;
    const unb = safe(() => it.getComponent("minecraft:enchantable").getEnchantment("unbreaking").level, 0) || 0;
    if (unb > 0 && Math.random() >= 1 / (unb + 1)) return;
    if (d.damage + 1 >= d.maxDurability) { eq.setEquipment(EquipmentSlot.Mainhand, undefined); playAt(p.dimension, "random.break", eye(p), 1); return; }
    d.damage += 1;
    eq.setEquipment(EquipmentSlot.Mainhand, it);
  });
}

// =================================================================== tools on his woods (vanilla parity)
const SOILS = [`${NS}:stellar_soil`, `${NS}:stellar_dirt`, `${NS}:ashen_podzol`];
function turnSoil(p, b, types, states, snd) {
  if (!alive(p) || !SOILS.includes(b.typeId)) return;
  const up = b.above();
  if (up && !up.isAir) safe(() => up.setType("minecraft:air"));          // the grass on top goes
  if (!types.some((t) => setPerm(b.dimension, b.location, t, states))) return;
  playAt(b.dimension, snd, V.add(b.location, { x: 0.5, y: 1, z: 0.5 }), 1, 0.9);
  wearHeld(p);
}
function boneMeal(p, b) {
  if (!alive(p) || b.typeId !== `${NS}:stellar_soil`) return;
  const dim = b.dimension, c = b.location;
  let grown = 0;
  for (let i = 0; i < 48 && grown < 14; i++) {
    const r = i < 8 ? 1 : i < 24 ? 2 : 3;
    const at = { x: c.x + rint(-r, r), y: c.y, z: c.z + rint(-r, r) };
    for (const dy of [0, 1, -1]) {
      const g = blockAt(dim, { x: at.x, y: at.y + dy, z: at.z });
      const top = g && g.above();
      if (!g || !top || g.typeId !== `${NS}:stellar_soil` || !top.isAir) continue;
      const kind = chance(0.82) ? `${NS}:stellar_grass` : chance(0.7) ? `${NS}:rift_fern` : `${NS}:bleeding_shrub`;
      if (safe(() => { top.setType(kind); return true; }, false)) grown++;
      break;
    }
  }
  particle(dim, "minecraft:crop_growth_emitter", V.add(c, { x: 0.5, y: 1.2, z: 0.5 }));
  playAt(dim, "item.bone_meal.use", V.add(c, { x: 0.5, y: 1, z: 0.5 }), 1, 1);
  if (survivalish(p)) consumeHeld(p, "minecraft:bone_meal");
}

// Shears: vanilla shears clip leaves, vines and grass almost instantly, but the game ignores the shears tag on
// add-on blocks -- so a hit with shears clips them here, with the block's own break sound and particles.
const SHEARABLE = {
  [`${NS}:void_leaves`]: `${NS}:void_leaves`, [`${NS}:hanging_moss`]: `${NS}:hanging_moss`,
  [`${NS}:hanging_moss_tip`]: `${NS}:hanging_moss`, [`${NS}:rift_fern`]: `${NS}:rift_fern`, [`${NS}:stellar_grass`]: `${NS}:stellar_grass`,
};
/** world.afterEvents.entityHitBlock */
export function hitBlock(ev) {
  const p = ev.damagingEntity, b = ev.hitBlock;
  if (!p || p.typeId !== "minecraft:player" || !b) return;
  const drop = SHEARABLE[b.typeId];
  if (!drop) return;
  if (safe(() => p.getGameMode(), GameMode.Creative) !== GameMode.Survival) return;
  const held = safe(() => p.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Mainhand));
  if (!held || held.typeId !== "minecraft:shears") return;
  const dim = b.dimension, l = b.location;
  if (!safe(() => { dim.runCommand(`setblock ${l.x} ${l.y} ${l.z} air destroy`); return true; }, false)) return;
  safe(() => dim.spawnItem(new ItemStack(drop, 1), V.add(l, { x: 0.5, y: 0.3, z: 0.5 })));
  wearHeld(p);
}

// Leaf decay: add-on leaves never decay on their own, so a felled tree would leave its crown floating.
// When a log goes, the leaves that touched it are followed out through the crown: if that whole clump of
// leaves no longer touches anything solid (another log, a branch, a roof, the ground), it falls away over
// the next few seconds, like vanilla leaves do.  Leaves you placed yourself never decay.  The search is
// spread over several ticks so even the giant crowns cost nothing noticeable.
const LEAF = `${NS}:void_leaves`;
const LOGS = [`${NS}:void_log`, `${NS}:stripped_void_log`, `${NS}:charred_log`, `${NS}:carved_void_log`, `${NS}:gouged_spruce_log`];
// what does NOT hold leaves up: air, things that hang, and other trees' leaves (vanilla decay ignores those too)
const SOFT = /^minecraft:(air|iron_chain|chain|web|skeleton_skull|lantern|soul_lantern|water|light_block.*)$|leaves$|^goatwalker:(hanging_moss|hanging_moss_tip)$/;
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const JOBS = [];
const DOOMED = new Set();                                  // leaves already falling
const CLUMP_MAX = 6000;
let LEAF_LAST = "";
export function leafJobs() { return `${JOBS.length} ${LEAF_LAST}`; }
const lkey = (x, y, z) => `${x},${y},${z}`;
/** world.afterEvents.playerBreakBlock (any log of his woods) */
export function logGone(dim, loc, id) {
  if (!LOGS.includes(id) || JOBS.length > 16) return;
  for (const [a, b, c] of N6) {
    const at = { x: loc.x + a, y: loc.y + b, z: loc.z + c };
    const bl = blockAt(dim, at);
    if (!bl || bl.typeId !== LEAF) continue;
    const k = lkey(at.x, at.y, at.z);
    if (JOBS.some((j) => j.seen.has(k))) continue;
    JOBS.push({ dim, seen: new Set([k]), fr: [[at.x, at.y, at.z]], clump: [[at.x, at.y, at.z]], at: now() + 8 });
  }
}
/** placing leaves by hand makes them permanent */
export function leafPlaced(b) {
  if (b.typeId === LEAF) safe(() => b.setPermutation(b.permutation.withState(`${NS}:persistent`, true)));
}
/** every 10 ticks: follows the clumps, a few hundred leaves per call across the queue */
export function tickLeafDecay() {
  let budget = 600;
  while (JOBS.length && budget > 0) {
    const job = JOBS[0];
    if (now() < job.at) return;
    if (job.clump.length === 1 && DOOMED.has(lkey(...job.clump[0]))) { JOBS.shift(); continue; }
    budget = followClump(job, budget);
  }
}
function followClump(job, budget) {
  const dim = job.dim;
  while (job.fr.length && budget-- > 0) {
    const [x, y, z] = job.fr.pop();
    for (const [a, b, c] of N6) {
      const nx = x + a, ny = y + b, nz = z + c;
      const k = lkey(nx, ny, nz);
      if (job.seen.has(k)) continue;
      const bl = blockAt(dim, { x: nx, y: ny, z: nz });
      if (!bl) { LEAF_LAST = `unloaded ${k}`; JOBS.shift(); return budget; }   // runs into unloaded ground: leave it be
      const t = bl.typeId;
      if (t === LEAF) {
        job.seen.add(k);
        job.fr.push([nx, ny, nz]);
        job.clump.push([nx, ny, nz]);
        if (job.clump.length > CLUMP_MAX) { JOBS.shift(); return budget; }
      } else if (!SOFT.test(t) && !PASS_RE.test(t)) { LEAF_LAST = `held by ${t} at ${k}`; JOBS.shift(); return budget; }   // it still rests on something
    }
  }
  if (job.fr.length) return budget;                       // more next time
  JOBS.shift();
  // nothing holds it up: it falls apart, leaf by leaf
  if (DOOMED.size > 20000) DOOMED.clear();
  for (const [x, y, z] of job.clump) {
    const k = lkey(x, y, z);
    if (DOOMED.has(k)) continue;
    DOOMED.add(k);
    system.runTimeout(() => {
      DOOMED.delete(k);
      const b = blockAt(dim, { x, y, z });
      if (!b || b.typeId !== LEAF || safe(() => b.permutation.getState(`${NS}:persistent`)) === true) return;
      safe(() => dim.runCommand(`setblock ${x} ${y} ${z} air destroy`));
    }, rint(4, 30 + Math.min(200, job.clump.length / 6)));
  }
}

function placeAt(b, face) {
  if (REPLACEABLE.test(b.typeId)) return b.location;
  return V.add(b.location, OFF[face] || OFF.Up);
}
function free(dim, at) { const x = blockAt(dim, at); return !!x && REPLACEABLE.test(x.typeId); }
function placeDoor(p, b, face) {
  if (!alive(p)) return;
  const dim = p.dimension;
  const at = placeAt(b, face);
  if (!free(dim, at) || !free(dim, V.up(at, 1)) || !isGround(blockAt(dim, V.up(at, -1)))) return;
  const centre = V.add(at, { x: 0.5, y: 0, z: 0.5 });
  const toP = V.sub(p.location, centre);
  const facing = dirIndex(toP);                         // the panel hugs the side nearest you
  const fv = [{ x: 0, z: -1 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }][facing];
  const side = { x: -fv.z, y: 0, z: fv.x };
  const hinge = V.dot(toP, side) > 0;
  const st_ = (upper) => ({ [`${NS}:facing`]: facing, [`${NS}:open`]: false, [`${NS}:hinge`]: hinge, [`${NS}:upper`]: upper });
  if (!setPerm(dim, at, DOOR, st_(false))) return;
  setPerm(dim, V.up(at, 1), DOOR, st_(true));
  playAt(dim, "use.wood", V.add(centre, { x: 0, y: 1, z: 0 }), 1, 0.8);
  if (survivalish(p)) consumeHeld(p, `${NS}:void_door`);
}
function placeBanner(p, b, face) {
  if (!alive(p)) return;
  const dim = p.dimension;
  // hangs from the underside of a block, or from the face of a wall
  const at = face === "Down" ? V.add(b.location, OFF.Down) : face === "Up" ? null : V.add(b.location, OFF[face]);
  if (!at || !free(dim, at) || !free(dim, V.up(at, -1))) return;
  const facing = face === "Down" ? dirIndex(V.sub(p.location, V.add(at, { x: 0.5, y: 0, z: 0.5 })))
    : { North: 2, South: 0, West: 3, East: 1 }[face];
  setPerm(dim, at, `${NS}:hanging_banner`, { [`${NS}:part`]: 0, [`${NS}:facing`]: facing });
  setPerm(dim, V.up(at, -1), `${NS}:hanging_banner`, { [`${NS}:part`]: 1, [`${NS}:facing`]: facing });
  playAt(dim, "use.cloth", V.add(at, { x: 0.5, y: 0, z: 0.5 }), 1, 0.9);
  if (survivalish(p)) consumeHeld(p, `${NS}:hanging_banner_item`);
}

// =================================================================== flares
const FLARE_LIFE = 22;          // seconds
export function igniteFlare(proj, loc, dim) {
  // find air at (or right beside) where it landed and light it
  let at = V.floor(loc);
  if (!free(dim, at)) {
    for (const o of Object.values(OFF)) { const n = V.add(at, o); if (free(dim, n)) { at = n; break; } }
  }
  if (!free(dim, at)) return;
  const b = blockAt(dim, at);
  if (b && !b.isAir && PASS_RE.test(b.typeId)) safe(() => b.setType("minecraft:air"));
  setPerm(dim, at, "minecraft:light_block_15", {});
  track("light", at, { life: FLARE_LIFE + 4 });
  const f = { x: at.x + 0.5, y: at.y + 0.2, z: at.z + 0.5, until: now() + FLARE_LIFE * 20, dim: dim.id, e: proj, b: at, burn: 0 };
  FLARES.push(f);
  playAt(dim, "goatwalker.flare.ignite", f, 1.2);
  particle(dim, `${NS}:flare_burn`, f);
}
export function extinguish(f) {
  const dim = world.getDimension(f.dim);
  const b = blockAt(dim, f.b);
  if (b && b.typeId.startsWith("minecraft:light_block")) safe(() => b.setType("minecraft:air"));
  if (alive(f.e)) safe(() => f.e.remove());
  particle(dim, `${NS}:smoke_wisp`, f);
  playAt(dim, "extinguish.candle", f, 1, 0.7);
  f.until = 0;
  const i = FLARES.indexOf(f);
  if (i >= 0) FLARES.splice(i, 1);
}
onExtinguish(extinguish);
/** twice a second */
export function tickFlares() {
  for (const f of [...FLARES]) {
    if (now() >= f.until) { extinguish(f); continue; }
    const dim = world.getDimension(f.dim);
    particle(dim, `${NS}:flare_burn`, f);
    if (++f.burn % 4 === 0) playAt(dim, "goatwalker.flare.burn", f, 0.8, rnd(0.9, 1.1));
  }
}

// =================================================================== reading things
const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
function bearing(from, to) {
  const a = angleOf(V.sub(to, from));               // 0 = +x (east), pi/2 = +z (south)
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
function nearestStellar(p) {
  const dim = p.dimension;
  if (domainAt(dim, p.location) === "stellar") return "here";
  for (const r of [48, 96, 160, 240, 320, 448]) {
    let best = null;
    for (let i = 0; i < 16; i++) {
      const at = V.add(p.location, V.mul(fromAngle((i / 16) * Math.PI * 2), r));
      if (domainAt(dim, { x: at.x, y: 64, z: at.z }) === "stellar") { best = at; break; }
    }
    if (best) return { r, dir: bearing(p.location, best) };
  }
  return null;
}
export function readMap(p) {
  const s = st(p), M = mind(p);
  const lines = [];
  const where = nearestStellar(p);
  if (where === "here") lines.push("§7The dark woods are inked all around the spot where you stand.");
  else if (where) lines.push(`§7Dark woods are drawn to the §f${where.dir}§7, about §f${where.r}§7 paces away.`);
  else lines.push("§7The map shows nothing you recognise from here.");
  if (s.shrine) lines.push(`§7A ring of candles is drawn §f${Math.round(V.distH(s.shrine, p.location))}§7 paces §f${bearing(p.location, s.shrine)}§7.`);
  const node = learnedNode(M, p.location, 400);
  if (node) lines.push(`§cA passage you use is circled in red, ${Math.round(V.dist(node, p.location))} paces ${bearing(p.location, node)}. Beside it: §4"HE WAITS HERE."`);
  const room = M.rooms.find((r) => r.c >= 1.5);
  if (room) lines.push(`§cA room ${Math.round(V.dist(room, p.location))} paces ${bearing(p.location, room)} is crossed out. §4"He knows this one."`);
  const home = homeOf(p, M);
  if (home && M.hab.home > 600) lines.push("§8Your own house is on it.  You did not draw it.");
  new ActionFormData().title("Old Map").body(lines.join("\n\n")).button("Fold it away").show(p).catch(() => { });
}
const NOTES = [
  "Day 3.  It will not come into the light.  Torches all round the camp.  It stood at the edge of the glow all night.\nDay 9.  The torches are all out.  I did not put them out.",
  "Do not look away from it for long.  Every time I looked back it was closer.  If you must stare, do not stare too long.  It does not like that either.",
  "The water saved me twice.  The third time it walked in after me.",
  "It learns.  Whatever you do to get away, do it once, twice - and then never again.  It will be ready for it.",
  "I always went down the old stair to the mine.  Last night it was standing at the bottom of the stair.  It was waiting.",
  "We were five when we came into these woods.  It never came at all of us.  It waited for whoever fell behind.",
  "The candles at its altar burn down one by one.  When the last goes out, run.  Mutton laid on a log by four lit candles buys time.  Not forever.",
  "Throw a flare and it will not cross the light.  For a while.",
  "Through the Lens it cannot move.  I held it there until my arms shook.  The next night it would not stand where I could see it.",
  "It does not hit like a beast.  It watched me fight the dead for a week, and when it came, it came from the side I always back away to.",
  "If you hear the bell, it is far.  When the bell stops, it is close.",
  "I hid in the same cellar three nights running.  On the third night I heard it breathing at the door until dawn.",
];
export function readNote(p) {
  const n = pick(NOTES);
  new ActionFormData().title("Ritual Note").body(`§7${n}`).button("...").show(p).catch(() => { });
}
export function useKit(p) {
  const s = st(p);
  s.bleed = null;
  safe(() => p.addEffect("instant_health", 1, { amplifier: 0, showParticles: false }));
  safe(() => p.addEffect("regeneration", 120, { amplifier: 0, showParticles: false }));
  playFor(p, "armor.equip_leather", eye(p), 1, 0.8);
  hint(p, "§7You bind the wound.");
}

// =================================================================== atmosphere (once a second per player)
const MOTE_IDS = [`${NS}:mooncap`, `${NS}:bleeding_stone`];
export function ambience(p, s, near) {
  const dim = p.dimension;
  if (dim.id !== OVERWORLD) return;
  const inBiome = s.domain === "stellar";
  // ash drifting down through the trees
  if (inBiome && !s.under) particle(dim, `${NS}:stardust`, V.up(p.location, 3));
  // glowing things nearby breathe out light
  if (inBiome && ++s.motes % 3 === 0) {
    const c = V.floor(p.location);
    safe(() => {
      const vol = new BlockVolume({ x: c.x - 9, y: c.y - 4, z: c.z - 9 }, { x: c.x + 9, y: c.y + 5, z: c.z + 9 });
      let n = 0;
      for (const l of dim.getBlocks(vol, { includeTypes: MOTE_IDS }, false).getBlockLocationIterator()) {
        if (!chance(0.35)) continue;
        const b = blockAt(dim, l);
        if (!b) continue;
        if (b.typeId === `${NS}:bleeding_stone`) {
          const up = b.above();
          if (up && up.isAir) particle(dim, `${NS}:rift_ember`, V.add(l, { x: 0.5, y: 1.05, z: 0.5 }));
          if (chance(0.05)) playAt(dim, "goatwalker.rift_hum", V.add(l, { x: 0.5, y: 1, z: 0.5 }), 0.6);
        } else if (chance(0.4)) particle(dim, `${NS}:mooncap_glow`, V.add(l, { x: 0.5, y: 0.5, z: 0.5 }));
        if (++n > 6) break;
      }
    });
  }
  // eclipse nights: the red fog and the choir, inside his woods
  const ecl = inBiome && isEclipse();
  if (ecl !== s.eclipse) {
    s.eclipse = ecl;
    if (ecl) { pushFog(p, s, "eclipse"); if (!s.music) music(p, s, "goatwalker.music.eclipse"); hint(p, "§4The moon has gone dark."); }
    else { popFog(p, s, "eclipse"); if (s.music === "goatwalker.music.eclipse") music(p, s, ""); }
  }
  // the antler charm turns some of his blows
  if (near) {
    const off = safe(() => p.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Offhand));
    if (off && off.typeId === `${NS}:antler_charm`) safe(() => p.addEffect("resistance", 40, { amplifier: 0, showParticles: false }));
  }
}

// =================================================================== structure chest fallback
const LOOT = {
  storage: [[`${NS}:rope`, 12, 1, 3], [`${NS}:stellar_resin`, 10, 1, 4], ["minecraft:torch", 12, 2, 8], [`${NS}:rotten_meat`, 10, 1, 4],
    [`${NS}:field_kit`, 5, 1, 1], [`${NS}:undried_tendon`, 8, 1, 3], ["minecraft:bread", 6, 1, 3], ["minecraft:arrow", 6, 4, 12],
    [`${NS}:flare`, 5, 1, 2], ["minecraft:iron_ingot", 4, 1, 3], ["minecraft:candle", 5, 1, 3], [`${NS}:old_map`, 2, 1, 1]],
  ritual: [[`${NS}:ritual_note`, 14, 1, 1], [`${NS}:antler_charm`, 3, 1, 1], [`${NS}:goat_horn_shard`, 10, 1, 2], [`${NS}:strange_relic`, 3, 1, 1],
    [`${NS}:stellar_resin`, 8, 1, 3], ["minecraft:red_candle", 8, 1, 4], [`${NS}:rift_shard`, 6, 1, 2], [`${NS}:core_essence`, 1, 1, 1],
    [`${NS}:old_map`, 3, 1, 1], ["minecraft:bone", 8, 2, 5], [`${NS}:void_fragment`, 3, 1, 1]],
  quarters: [[`${NS}:ritual_note`, 10, 1, 1], [`${NS}:old_map`, 6, 1, 1], [`${NS}:field_kit`, 6, 1, 1], ["minecraft:torch", 10, 1, 6],
    [`${NS}:rope`, 8, 1, 2], ["minecraft:paper", 8, 1, 4], [`${NS}:rotten_meat`, 6, 1, 3], [`${NS}:the_lens`, 1, 1, 1], [`${NS}:flare`, 4, 1, 2]],
  ruins: [[`${NS}:strange_relic`, 4, 1, 1], [`${NS}:goat_horn_shard`, 10, 1, 3], [`${NS}:rift_shard`, 10, 1, 3], [`${NS}:void_fragment`, 6, 1, 2],
    [`${NS}:stellar_dust`, 10, 2, 6], [`${NS}:core_essence`, 2, 1, 1], [`${NS}:antler_charm`, 3, 1, 1], [`${NS}:ritual_note`, 8, 1, 1]],
};
let FILLED = null;
function filledSet() {
  if (!FILLED) {
    const raw = safe(() => world.getDynamicProperty("gw:filled"));
    FILLED = new Set(typeof raw === "string" ? safe(() => JSON.parse(raw), []) : []);
  }
  return FILLED;
}
function saveFilled() { safe(() => world.setDynamicProperty("gw:filled", JSON.stringify([...FILLED].slice(-600)))); }
const bkey = (l) => `${l.x},${l.y},${l.z}`;
export function notePlaced(block) {
  if (/chest$|barrel$/.test(block.typeId) && domainAt(block.dimension, block.location) === "stellar") { filledSet().add(bkey(block.location)); saveFilled(); }
}
export function maybeFill(block) {
  if (!/^minecraft:(chest|barrel)$/.test(block.typeId)) return;
  if (domainAt(block.dimension, block.location) !== "stellar") return;
  const k = bkey(block.location);
  const F = filledSet();
  if (F.has(k)) return;
  const dim = block.dimension, loc = block.location;
  system.runTimeout(() => {
    const b = blockAt(dim, loc);
    const c = b && safe(() => b.getComponent("minecraft:inventory").container);
    if (!c) return;
    F.add(k); saveFilled();
    if (c.emptySlotsCount < c.size) return;                     // the real loot table already filled it
    // only fill containers that sit in a structure (built from his woods' planks), never your own
    const near = safe(() => {
      const vol = new BlockVolume({ x: loc.x - 3, y: loc.y - 2, z: loc.z - 3 }, { x: loc.x + 3, y: loc.y + 3, z: loc.z + 3 });
      let n = 0;
      for (const _ of dim.getBlocks(vol, { includeTypes: [`${NS}:aged_planks`, `${NS}:void_planks`, `${NS}:charred_log`, `${NS}:ritual_wood`, `${NS}:rift_stone`, `${NS}:cracked_rift_stone`] }, false).getBlockLocationIterator()) if (++n > 6) break;
      return n;
    }, 0);
    if (near < 4) return;
    const kind = b.typeId === "minecraft:barrel" ? "storage" : pick(["storage", "quarters", "ritual", "ruins"]);
    const table = LOOT[kind];
    const rolls = rint(3, 6);
    const total = table.reduce((a, e) => a + e[1], 0);
    for (let i = 0; i < rolls; i++) {
      let r = Math.random() * total;
      const e = table.find((x) => (r -= x[1]) <= 0) || table[0];
      const item = safe(() => new ItemStack(e[0], rint(e[2], e[3])));
      if (!item) continue;
      for (let tries = 0; tries < 6; tries++) {
        const slot = rint(0, c.size - 1);
        if (!c.getItem(slot)) { safe(() => c.setItem(slot, item)); break; }
      }
    }
  }, 1);
}
