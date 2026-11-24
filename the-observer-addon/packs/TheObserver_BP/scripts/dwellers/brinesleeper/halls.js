// @ts-nocheck
import * as __dw from "../../link/shared.js";
// The great halls: every visit finds a vast flooded cavern like the pictures, and one is always near.
//  - near spawn: when a world first runs, a starter hall is placed deep under the land 140-220 blocks from the world
//    spawn
//  - wherever you go in the Stillwater Caves or the dripstone caves: if no hall is within 90 blocks, one is placed
//    45-48 blocks away along your line, its waterline at your feet, so its tunnel opens in front of you
//  - (7.0) halls come in complexes: up to two more halls are joined on, a hall's width further along, their tunnels
//    meeting, so a complex runs up to 240 blocks
//  - (7.0) every hall gets a shaft to the surface: lined with stone, a ladder all the way from the top to the bottom,
//    a sinkhole rim with candles and a sign at the top, a tunnel into the hall at the bottom
//  - inside a hall that world generation put in another biome, the Stillwater fog is pushed onto you
// Chests are filled with loot as soon as a hall stands (or when its chunks first load).
import { world, system, BlockVolume, BlockPermutation, ItemStack, EnchantmentTypes } from '@minecraft/server';
import { config } from './config.js';
import { inBiome, flat, randInt, pick, sound, debug } from './main.js';
import { HALL, halls, loadHalls, saveHalls, hallAt, biomeAt, BIOME } from './areas.js';

const IDS = ['brine:great_hall_0', 'brine:great_hall_1', 'brine:great_hall_2'];
const { W, H, D } = HALL;
const SPACING = 90;
const NATURAL = ['minecraft:stone', 'minecraft:deepslate', 'minecraft:tuff', 'minecraft:andesite', 'minecraft:diorite', 'minecraft:granite',
  'minecraft:calcite', 'minecraft:dripstone_block', 'minecraft:smooth_basalt', 'minecraft:cobbled_deepslate', 'minecraft:dirt',
  'minecraft:grass_block', 'minecraft:coarse_dirt', 'minecraft:podzol', 'minecraft:sand', 'minecraft:red_sand', 'minecraft:sandstone',
  'minecraft:gravel', 'minecraft:clay', 'minecraft:mud', 'minecraft:snow', 'minecraft:snow_layer', 'minecraft:pointed_dripstone',
  'minecraft:coal_ore', 'minecraft:iron_ore', 'minecraft:copper_ore', 'minecraft:deepslate_coal_ore', 'minecraft:deepslate_iron_ore',
  'minecraft:deepslate_copper_ore', 'minecraft:glow_lichen', 'minecraft:moss_block', 'minecraft:rooted_dirt', 'minecraft:terracotta',
  'brine:bloodstained_deepslate', 'brine:clawed_deepslate', 'brine:veined_deepslate', 'minecraft:weeping_vines',
  'brine:pale_dripstone_tip', 'brine:pale_dripstone_frustum', 'brine:pale_dripstone_middle', 'brine:pale_dripstone_base'];
/** @type {[string, number, number, number][]} [item, min, max, weight] */
const LOOT = [
  ['minecraft:diamond', 1, 3, 10], ['minecraft:emerald', 2, 7, 10], ['minecraft:gold_ingot', 3, 9, 12], ['minecraft:iron_ingot', 4, 12, 14],
  ['minecraft:golden_apple', 1, 2, 7], ['minecraft:enchanted_golden_apple', 1, 1, 1], ['minecraft:experience_bottle', 4, 12, 9],
  ['minecraft:nautilus_shell', 1, 3, 6], ['minecraft:heart_of_the_sea', 1, 1, 1], ['minecraft:trident', 1, 1, 1],
  ['minecraft:turtle_helmet', 1, 1, 2], ['minecraft:name_tag', 1, 1, 4], ['minecraft:diamond_horse_armor', 1, 1, 2],
  ['minecraft:prismarine_crystals', 3, 9, 6], ['minecraft:echo_shard', 1, 2, 3], ['minecraft:music_disc_13', 1, 1, 2],
  ['minecraft:totem_of_undying', 1, 1, 1], ['minecraft:enchanted_book', 1, 1, 8], ['minecraft:candle', 2, 6, 5], ['minecraft:bone', 3, 9, 8],
];
/** @type {[string, number][]} */
const BOOKS = [['mending', 1], ['depth_strider', 3], ['respiration', 3], ['aqua_affinity', 1], ['unbreaking', 3], ['protection', 4],
  ['feather_falling', 4], ['looting', 3], ['fortune', 3], ['efficiency', 5], ['sharpness', 5], ['riptide', 3], ['loyalty', 3], ['impaling', 5]];

function lootStack() {
  const total = LOOT.reduce((a, l) => a + l[3], 0);
  let r = Math.random() * total;
  let row = LOOT[0];
  for (const l of LOOT) { r -= l[3]; if (r <= 0) { row = l; break; } }
  const stack = new ItemStack(row[0], randInt(row[1], row[2]));
  if (row[0] === 'minecraft:enchanted_book') {
    const [id, max] = pick(BOOKS);
    const type = EnchantmentTypes.get(id);
    const ench = stack.getComponent('minecraft:enchantable');
    if (!type || !ench) return new ItemStack('minecraft:experience_bottle', randInt(4, 8));
    ench.addEnchantment({ type, level: randInt(1, max) });
  }
  return stack;
}
const box = (h) => new BlockVolume({ x: h.x - W / 2, y: h.y - D, z: h.z - W / 2 }, { x: h.x + W / 2 - 1, y: h.y - D + H - 1, z: h.z + W / 2 - 1 });
function fillChests(dim, h) {
  let list;
  try { list = dim.getBlocks(box(h), { includeTypes: ['minecraft:chest'] }, false); } catch (e) { return false; }
  for (const loc of list.getBlockLocationIterator()) {
    const inv = dim.getBlock(loc)?.getComponent('minecraft:inventory')?.container;
    if (!inv || inv.emptySlotsCount < inv.size) continue;
    for (let i = randInt(6, 10); i > 0; i--) {
      try { inv.setItem(randInt(0, inv.size - 1), lootStack()); } catch (e) { /* an item this version lacks */ }
    }
  }
  return true;
}

/** carve along an axis from a hall's tunnel mouth (on side dx/dz) to a point outside, at tunnel height */
function openMouth(dim, h, dx, dz, toward) {
  const y0 = h.y + 1, y1 = h.y + 4;
  const alongX = dx !== 0;
  const edge = alongX ? (dx > 0 ? h.x + W / 2 - 1 : h.x - W / 2) : (dz > 0 ? h.z + W / 2 - 1 : h.z - W / 2);
  const open = [];
  for (let u = -8; u <= 8; u++) {
    const at = alongX ? { x: edge, y: y0 + 1, z: Math.floor(h.z) + u } : { x: Math.floor(h.x) + u, y: y0 + 1, z: edge };
    try { if (dim.getBlock(at)?.isAir) open.push(u); } catch (e) { /* ok */ }
  }
  if (!open.length) return false;
  const lo = Math.min(...open), hi = Math.max(...open);
  const t = Math.floor(alongX ? toward.x : toward.z);
  const [a0, a1] = edge < t ? [edge + 1, t] : [t, edge - 1];
  if (a1 < a0) return true;
  const c = Math.floor(alongX ? h.z : h.x);
  const a = alongX ? { x: a0, y: y0, z: c + lo } : { x: c + lo, y: y0, z: a0 };
  const b = alongX ? { x: a1, y: y1, z: c + hi } : { x: c + hi, y: y1, z: a1 };
  try { dim.fillBlocks(new BlockVolume(a, b), 'minecraft:air', { blockFilter: { includeTypes: NATURAL } }); } catch (e) { /* ok */ }
  return true;
}

function site(player, force = false) {
  const p = player.location;
  const dim = player.dimension;
  const y = Math.floor(p.y) - 1;
  if (y - D < -63 || y + (H - D) > 300) return undefined;
  const v = player.getViewDirection();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort((a, b) => (b[0] * v.x + b[1] * v.z) - (a[0] * v.x + a[1] * v.z));
  for (const [dx, dz] of dirs) {
    const dist = W / 2 + randInt(5, 8);
    const x = Math.floor(p.x) + dx * dist, z = Math.floor(p.z) + dz * dist;
    const b1 = biomeAt(dim, { x, y: y + 2, z }), b2 = biomeAt(dim, { x, y: y - 6, z });
    const caves = (b) => b === BIOME || b === 'minecraft:dripstone_caves';
    if (!force && !caves(b1) && !caves(b2)) continue;
    let top;
    try { top = dim.getTopmostBlock({ x, z }); } catch (e) { top = undefined; }
    if (top && top.location.y < y + (H - D) + 8) continue;
    return { x, y, z, dx, dz };
  }
  return undefined;
}

export function buildHall(player, force = false) {
  const s = site(player, force);
  if (!s) return false;
  try { world.structureManager.place(pick(IDS), player.dimension, { x: s.x - W / 2, y: s.y - D, z: s.z - W / 2 }); }
  catch (e) { debug(`great hall failed: ${e}`); return false; }
  const h = { x: s.x, y: s.y, z: s.z, dx: s.dx, dz: s.dz, filled: false };
  halls.push(h);
  saveHalls();
  system.runTimeout(() => {
    if (!player.isValid) return;
    openMouth(player.dimension, h, -s.dx, -s.dz, player.location);
    h.filled = fillChests(player.dimension, h);
    saveHalls();
    sound(player.dimension, 'brine.fx.splash_far', { x: player.location.x + s.dx * 10, y: player.location.y, z: player.location.z + s.dz * 10 }, 1.2, 0.8);
  }, 10);
  grow(player.dimension, h, 2);
  return true;
}
/** join more halls onto a hall, one hall's width further along (their tunnels meet), one every ten seconds */
function grow(dim, h, more) {
  const dirs = [[h.dx || 1, h.dz], [h.dz, h.dx || 1], [-h.dz, -(h.dx || 1)]];
  let placed = 0;
  dirs.forEach(([dx, dz], i) => {
    system.runTimeout(() => {
      if (placed >= more) return;
      const x = h.x + dx * W, z = h.z + dz * W, y = h.y;
      if (halls.some((o) => Math.hypot(o.x - x, o.z - z) < W * 0.9)) return;
      let top;
      try { top = dim.getTopmostBlock({ x, z }); } catch (e) { return; }              // not loaded yet: the complex stays smaller
      if (!top || top.location.y < y + (H - D) + 8) return;                         // too near the surface or the sea floor
      try { world.structureManager.place(pick(IDS), dim, { x: x - W / 2, y: y - D, z: z - W / 2 }); } catch (e) { return; }
      placed++;
      const n = { x, y, z, dx, dz, filled: false, of: halls.indexOf(h) };
      halls.push(n);
      saveHalls();
      debug(`hall joined on at ${x} ${y} ${z}`);
    }, 200 * (i + 1));
  });
}

// ------------------------------------------------------------------ the starter hall near spawn, and its well
export function starterHall() { return halls.find((h) => h.starter); }
function placeStarter() {
  if (world.getDynamicProperty('brine:starter') || !config.halls) return;
  world.setDynamicProperty('brine:starter', true);
  const sp = world.getDefaultSpawnLocation();
  const a = Math.random() * Math.PI * 2, r = randInt(140, 220);
  const x = Math.floor(sp.x + Math.cos(a) * r), z = Math.floor(sp.z + Math.sin(a) * r), y = -24;
  try { world.structureManager.place(pick(IDS), world.getDimension('overworld'), { x: x - W / 2, y: y - D, z: z - W / 2 }); }
  catch (e) { debug(`starter hall failed: ${e}`); return; }
  const h = { x, y, z, dx: 1, dz: 0, filled: false, starter: true, well: false };
  halls.push(h);
  saveHalls();
  grow(world.getDimension('overworld'), h, 2);
  debug(`starter hall at ${x} ${y} ${z}`);
}
const SOFT = ['minecraft:air', 'minecraft:oak_leaves', 'minecraft:spruce_leaves', 'minecraft:birch_leaves', 'minecraft:jungle_leaves',
  'minecraft:acacia_leaves', 'minecraft:dark_oak_leaves', 'minecraft:mangrove_leaves', 'minecraft:cherry_leaves', 'minecraft:azalea_leaves',
  'minecraft:oak_log', 'minecraft:spruce_log', 'minecraft:birch_log', 'minecraft:jungle_log', 'minecraft:acacia_log', 'minecraft:dark_oak_log',
  'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:large_fern', 'minecraft:snow_layer', 'minecraft:vine'];
/**
 * A way down from the surface: a 3 x 3 shaft lined with stone, a ladder the whole way from the top to the bottom,
 * a landing and a tunnel into the hall at the bottom; at the top a sinkhole rim of mossy stone, two red candles and
 * a sign. Dug beside the hall's east tunnel, once a player is near enough for the whole column to be loaded.
 */
function digShaft(dim, h) {
  const sx = Math.floor(h.x + W / 2 + 3), sz = Math.floor(h.z);
  let top;
  try { top = dim.getTopmostBlock({ x: sx, z: sz }); } catch (e) { return false; }
  if (!top) return false;
  if (top.isLiquid) { h.well = true; saveHalls(); return false; }    // under the sea: no shaft
  let gy = top.location.y;
  while (gy > h.y + 8 && SOFT.includes(dim.getBlock({ x: sx, y: gy, z: sz })?.typeId ?? 'minecraft:air')) gy--;
  if (gy < h.y + 10) { h.well = true; saveHalls(); return false; }
  const vol = (x0, y0, z0, x1, y1, z1) => new BlockVolume({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 });
  const fill = (v, blk) => { try { dim.fillBlocks(v, blk, { ignoreChunkBoundErrors: true }); } catch (e) { /* ok */ } };
  try {
    // the lining: stone all round (it seals off caves and water it passes), deepslate down deep
    const yb = h.y, ys = Math.min(gy, -1), ya = Math.max(h.y, 0);
    for (const [y0, y1, blk] of [[yb, ys, 'minecraft:cobbled_deepslate'], [ya, gy, 'minecraft:stone_bricks']]) {
      if (y1 < y0) continue;
      fill(vol(sx - 2, y0, sz - 2, sx + 2, y1, sz - 2), blk);
      fill(vol(sx - 2, y0, sz + 2, sx + 2, y1, sz + 2), blk);
      fill(vol(sx - 2, y0, sz - 1, sx - 2, y1, sz + 1), blk);
      fill(vol(sx + 2, y0, sz - 1, sx + 2, y1, sz + 1), blk);
    }
    fill(vol(sx - 1, h.y + 1, sz - 1, sx + 1, gy + 3, sz + 1), 'minecraft:air');           // the shaft
    fill(vol(sx - 1, h.y, sz - 1, sx + 1, h.y, sz + 1), 'minecraft:cobbled_deepslate');   // the landing
    // the ladder, against the north wall, from the landing to the top
    const ladder = BlockPermutation.resolve('minecraft:ladder', { facing_direction: 3 });
    for (let y = h.y + 1; y <= gy + 1; y++) dim.getBlock({ x: sx, y, z: sz - 1 })?.setPermutation(ladder);
    // claw marks and old blood, now and then
    for (let i = 0; i < 10; i++) {
      const y = h.y + 2 + Math.floor(Math.random() * Math.max(1, gy - h.y - 4));
      const [x, z] = pick([[sx - 2, sz], [sx + 2, sz], [sx - 1, sz + 2], [sx + 1, sz + 2]]);
      dim.getBlock({ x, y, z })?.setType(y < 0 ? pick(['brine:clawed_deepslate', 'brine:bloodstained_deepslate']) : 'minecraft:mossy_stone_bricks');
    }
    // the way into the hall: through the lining at the bottom, then the hall's east tunnel
    fill(vol(sx - 2, h.y + 1, sz - 1, sx - 2, h.y + 4, sz + 1), 'minecraft:air');
    // the sinkhole at the top: the ground cleared round it, a rim of mossy stone, two candles, a sign
    try { dim.fillBlocks(vol(sx - 3, gy + 1, sz - 3, sx + 3, gy + 4, sz + 3), 'minecraft:air', { blockFilter: { includeTypes: SOFT.filter((b) => b !== 'minecraft:air') } }); } catch (e) { /* ok */ }
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== 3) continue;
      dim.getBlock({ x: sx + dx, y: gy + 1, z: sz + dz })?.setType(Math.random() < 0.5 ? 'minecraft:mossy_cobblestone' : 'minecraft:cobblestone');
    }
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
      const b = dim.getBlock({ x: sx + dx, y: gy, z: sz + dz });
      if (b && (b.isAir || SOFT.includes(b.typeId))) b.setType('minecraft:mossy_cobblestone');
    }
    const candle = BlockPermutation.resolve('minecraft:red_candle', { lit: true, candles: 2 });
    for (const [dx, dz] of [[3, 3], [-3, -3]]) dim.getBlock({ x: sx + dx, y: gy + 2, z: sz + dz })?.setPermutation(candle);
    const sign = dim.getBlock({ x: sx, y: gy + 2, z: sz + 3 });
    if (sign) {
      sign.setPermutation(BlockPermutation.resolve('minecraft:standing_sign', { ground_sign_direction: 0 }));
      sign.getComponent('minecraft:sign')?.setText('§0It is always\n§0darker at the\n§0bottom.\n§4Don\'t go down.');
    }
  } catch (e) { debug(`shaft: ${e}`); return false; }
  openMouth(dim, h, 1, 0, { x: sx - 2, y: h.y + 1, z: sz });
  h.well = true;
  h.wellAt = { x: sx, y: gy + 1, z: sz };
  saveHalls();
  debug(`shaft to the surface at ${sx} ${gy + 1} ${sz}`);
  return true;
}

// ------------------------------------------------------------------ fog inside halls outside the biome
const fogged = new Set();
function fog(player) {
  const inside = !!hallAt(player.location) && !inBiome(player.dimension, player.location);
  if (inside && !fogged.has(player.id)) {
    try { player.runCommand('fog @s push brine:fog_stillwater_caves brine_hall'); fogged.add(player.id); } catch (e) { /* ok */ }
  } else if (!inside && fogged.has(player.id)) {
    try { player.runCommand('fog @s remove brine_hall'); } catch (e) { /* ok */ }
    fogged.delete(player.id);
  }
}

function tick() {
  for (const p of __dw.players("brinesleeper")) {
    if (p.dimension.id !== 'minecraft:overworld') continue;
    fog(p);
    if (!config.halls) continue;
    for (const h of halls) {
      if (!h.filled && flat(h, p.location) < 70) { h.filled = fillChests(p.dimension, h); if (h.filled) saveHalls(); }
      if (!h.well && h.of === undefined && flat(h, p.location) < 72) digShaft(p.dimension, h);
    }
    const b = biomeAt(p.dimension, p.location);
    if (b !== BIOME && b !== 'minecraft:dripstone_caves') continue;
    if (halls.some((h) => flat(h, p.location) < SPACING)) continue;
    buildHall(p);
  }
}

world.afterEvents.worldLoad.subscribe(() => {
  loadHalls();
  system.runTimeout(placeStarter, 60);
  system.runInterval(tick, 40);
});
