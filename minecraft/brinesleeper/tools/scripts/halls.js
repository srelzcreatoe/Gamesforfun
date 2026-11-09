// The great halls: every visit to the Stillwater Caves finds a vast flooded cavern like the pictures.
// When a player is in the caves and no hall is near, one of the pack's great hall structures (80 x 44 x 80, built by
// biome_shapes.great_hall) is placed 45-48 blocks away along their line, its waterline just under their feet, so the
// tunnel out of its near side ends right in front of them; the last few blocks of rock are opened up to them.
// Its chests are filled with loot the moment it stands.
import { world, system, BlockVolume, ItemStack, EnchantmentTypes } from '@minecraft/server';
import { config } from './config.js';
import { inBiome, flat, randInt, pick, sound, debug } from './main.js';

const IDS = ['brine:great_hall_0', 'brine:great_hall_1', 'brine:great_hall_2'];
const W = 80, H = 44, D = 14;                      // biome_shapes.GH_W, GH_H, GH_D
const SPACING = 130;                               // one hall per this many blocks
const STONEY = ['minecraft:stone', 'minecraft:deepslate', 'minecraft:tuff', 'minecraft:andesite', 'minecraft:diorite', 'minecraft:granite',
  'minecraft:calcite', 'minecraft:dripstone_block', 'minecraft:smooth_basalt', 'minecraft:cobbled_deepslate', 'minecraft:dirt',
  'minecraft:gravel', 'minecraft:clay', 'minecraft:mud', 'minecraft:pointed_dripstone', 'brine:bloodstained_deepslate',
  'brine:clawed_deepslate', 'brine:veined_deepslate', 'minecraft:coal_ore', 'minecraft:iron_ore', 'minecraft:copper_ore',
  'minecraft:deepslate_coal_ore', 'minecraft:deepslate_iron_ore', 'minecraft:deepslate_copper_ore', 'minecraft:glow_lichen',
  'minecraft:weeping_vines', 'brine:pale_dripstone_tip', 'brine:pale_dripstone_frustum', 'brine:pale_dripstone_middle', 'brine:pale_dripstone_base'];
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

let halls = [];
function loadHalls() {
  try { const raw = world.getDynamicProperty('brine:halls'); if (typeof raw === 'string') halls = JSON.parse(raw); } catch (e) { halls = []; }
}
function saveHalls() {
  while (halls.length > 100) halls.shift();
  try { world.setDynamicProperty('brine:halls', JSON.stringify(halls)); } catch (e) { /* too big: keep in memory */ }
}

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
/** fill every empty chest in a hall; false while any part of it is not loaded yet */
function fillChests(dim, h) {
  let list;
  try {
    list = dim.getBlocks(new BlockVolume({ x: h.x - W / 2, y: h.y - D, z: h.z - W / 2 }, { x: h.x + W / 2 - 1, y: h.y - D + H - 1, z: h.z + W / 2 - 1 }),
      { includeTypes: ['minecraft:chest'] }, false);
  } catch (e) { return false; }
  let n = 0;
  for (const loc of list.getBlockLocationIterator()) {
    const b = dim.getBlock(loc);
    const inv = b?.getComponent('minecraft:inventory')?.container;
    if (!inv || inv.emptySlotsCount < inv.size) continue;
    for (let i = randInt(6, 10); i > 0; i--) {
      try { inv.setItem(randInt(0, inv.size - 1), lootStack()); } catch (e) { /* unknown item on this version: skip it */ }
    }
    n++;
  }
  debug(`filled ${n} chests`);
  return true;
}

/** open up the rock between the tunnel mouth on the hall's edge and the player */
function connect(dim, h, player) {
  const p = player.location;
  const y0 = h.y + 1, y1 = h.y + 4;
  const lateral = h.dx !== 0 ? 'z' : 'x';
  const edge = h.dx > 0 ? h.x - W / 2 : h.dx < 0 ? h.x + W / 2 - 1 : h.dz > 0 ? h.z - W / 2 : h.z + W / 2 - 1;
  // where the tunnel actually meets the edge
  const open = [];
  for (let u = -8; u <= 8; u++) {
    const at = lateral === 'z' ? { x: edge, y: y0 + 1, z: Math.floor(h.z) + u } : { x: Math.floor(h.x) + u, y: y0 + 1, z: edge };
    try { if (dim.getBlock(at)?.isAir) open.push(u); } catch (e) { /* ok */ }
  }
  if (!open.length) return;
  const lo = Math.min(...open), hi = Math.max(...open);
  const from = h.dx > 0 ? Math.floor(p.x) : h.dx < 0 ? edge + 1 : h.dz > 0 ? Math.floor(p.z) : edge + 1;
  const to = h.dx > 0 ? edge - 1 : h.dx < 0 ? Math.floor(p.x) : h.dz > 0 ? edge - 1 : Math.floor(p.z);
  if (to < from) return;
  const c = lateral === 'z' ? Math.floor(h.z) : Math.floor(h.x);
  const a = lateral === 'z' ? { x: from, y: y0, z: c + lo } : { x: c + lo, y: y0, z: from };
  const b = lateral === 'z' ? { x: to, y: y1, z: c + hi } : { x: c + hi, y: y1, z: to };
  try { dim.fillBlocks(new BlockVolume(a, b), 'minecraft:air', { blockFilter: { includeTypes: STONEY } }); } catch (e) { /* ok */ }
}

function site(player, force = false) {
  const p = player.location;
  const dim = player.dimension;
  const y = Math.floor(p.y) - 1;                    // the waterline: the tunnel floor is the ground you stand on
  if (y - D < -63 || y + (H - D) > 300) return undefined;
  const v = player.getViewDirection();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort((a, b) => (b[0] * v.x + b[1] * v.z) - (a[0] * v.x + a[1] * v.z));
  for (const [dx, dz] of dirs) {
    const dist = W / 2 + randInt(5, 8);
    const x = Math.floor(p.x) + dx * dist, z = Math.floor(p.z) + dz * dist;
    if (!force && !inBiome(dim, { x, y: y + 2, z }) && !inBiome(dim, { x, y: y - 6, z })) continue;
    let top;
    try { top = dim.getTopmostBlock({ x, z }); } catch (e) { top = undefined; }
    if (top && top.location.y < y + (H - D) + 8) continue;          // keep a roof of rock over it, away from the surface and the sea
    return { x, y, z, dx, dz };
  }
  return undefined;
}

export function buildHall(player, force = false) {
  const s = site(player, force);
  if (!s) return false;
  const id = IDS[randInt(0, IDS.length - 1)];
  try {
    world.structureManager.place(id, player.dimension, { x: s.x - W / 2, y: s.y - D, z: s.z - W / 2 });
  } catch (e) {
    debug(`great hall failed: ${e}`);
    return false;
  }
  const h = { x: s.x, y: s.y, z: s.z, dx: s.dx, dz: s.dz, filled: false };
  halls.push(h);
  saveHalls();
  system.runTimeout(() => {
    if (!player.isValid) return;
    connect(player.dimension, h, player);
    h.filled = fillChests(player.dimension, h);
    saveHalls();
    // it calls you in: something heavy moves in the water ahead
    const mouth = { x: player.location.x + s.dx * 10, y: player.location.y, z: player.location.z + s.dz * 10 };
    sound(player.dimension, 'brine.fx.splash_far', mouth, 1.2, 0.8);
  }, 10);
  debug(`great hall ${id} at ${s.x} ${s.y} ${s.z}`);
  return true;
}

function tick() {
  if (!config.halls) return;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== 'minecraft:overworld') continue;
    for (const h of halls) {                         // chests that were not loaded when the hall was placed
      if (!h.filled && flat(h, p.location) < 70) { h.filled = fillChests(p.dimension, h); if (h.filled) saveHalls(); }
    }
    if (!inBiome(p.dimension, p.location)) continue;
    if (halls.some((h) => flat(h, p.location) < SPACING)) continue;
    buildHall(p);
  }
}

world.afterEvents.worldLoad.subscribe(() => {
  loadHalls();
  system.runInterval(tick, 40);
});
