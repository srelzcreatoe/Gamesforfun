// Keeping the Stillwater Caves the way they should be:
//  - no hostile mob but the Brinesleeper ever spawns naturally in them
//  - nothing floats: vines, stalactites and plants left hanging in mid-air (where a flooded hall from a neighbouring
//    chunk was carved after they were placed) are cleared
//  - no water walls: lake water that ends against open air (where a hall cut into an older cave) is sealed with stone,
//    so the lakes are still and whole
// Each chunk around a player is checked once, a few hundred blocks per tick.
import { world, system, BlockVolume, EntityInitializationCause } from '@minecraft/server';
import { config } from './config.js';
import { CREATURE, SHADE, inBiome, block, debug } from './main.js';

const LEVELS = [-24, 12];                       // the hall waterlines (biome.py LEVELS)
const HANGING = ['minecraft:weeping_vines', 'brine:pale_dripstone_base', 'brine:pale_dripstone_middle', 'brine:pale_dripstone_frustum',
  'brine:pale_dripstone_tip', 'minecraft:pointed_dripstone'];
const STANDING = ['brine:bone_coral', 'brine:bloodroot', 'brine:pallid_cap'];
const WATER = ['minecraft:water'];               // still water only: real waterfalls are left alone

// ------------------------------------------------------------------ no hostile mobs
world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
  if (!config.blockHostiles || cause !== EntityInitializationCause.Spawned) return;
  if (entity.typeId === CREATURE || entity.typeId === SHADE) return;
  let hostile = false;
  try { hostile = !!entity.getComponent('minecraft:type_family')?.hasTypeFamily('monster'); } catch (e) { return; }
  if (!hostile) return;
  system.run(() => {
    if (!entity.isValid) return;
    if (!inBiome(entity.dimension, entity.location)) return;
    // summoned mobs (within 16 blocks of a player) are left alone; natural and spawner mobs are not
    if (world.getAllPlayers().some((p) => p.dimension.id === entity.dimension.id &&
      Math.hypot(p.location.x - entity.location.x, p.location.z - entity.location.z) < 16)) return;
    try { entity.remove(); } catch (e) { /* gone */ }
  });
});

// ------------------------------------------------------------------ repairs, one chunk at a time
const known = new Set();                       // chunks checked or waiting to be
const queue = [];
let job = null;

function* repairChunk(dim, cx, cz, status) {
  let ops = 0;
  const budget = () => (++ops % 250 === 0);
  for (const Y of LEVELS) {
    const from = { x: cx * 16, y: Y - 12, z: cz * 16 };
    const to = { x: cx * 16 + 15, y: Y + 20, z: cz * 16 + 15 };
    let vol;
    try { vol = new BlockVolume(from, to); } catch (e) { continue; }
    try { dim.getBlocks(vol, { includeTypes: ['minecraft:bedrock'] }, false); } catch (e) { status.retry = true; return; }   // not loaded yet
    // 1. hanging things with nothing above them (top first, so a broken chain is cleared all the way down)
    let locs = [];
    try { for (const l of dim.getBlocks(vol, { includeTypes: HANGING }, false).getBlockLocationIterator()) locs.push({ x: l.x, y: l.y, z: l.z }); }
    catch (e) { locs = []; }
    locs.sort((a, b) => b.y - a.y);
    for (const l of locs) {
      if (budget()) yield 1;
      const b = block(dim, l);
      if (!b) continue;
      let hanging = true;
      if (b.typeId === 'minecraft:pointed_dripstone') {
        try { hanging = !!b.permutation.getState('hanging'); } catch (e) { hanging = true; }
      }
      const support = block(dim, { x: l.x, y: hanging ? l.y + 1 : l.y - 1, z: l.z });
      if (!support) continue;
      const ok = support.isSolid || support.typeId === b.typeId || (HANGING.includes(support.typeId) && support.typeId.startsWith('brine:pale'))
        || (b.typeId === 'minecraft:pointed_dripstone' && support.typeId === 'minecraft:pointed_dripstone');
      if (!ok) { try { b.setType('minecraft:air'); } catch (e) { /* ok */ } }
    }
    // 2. plants on nothing
    locs = [];
    try { for (const l of dim.getBlocks(vol, { includeTypes: STANDING }, false).getBlockLocationIterator()) locs.push({ x: l.x, y: l.y, z: l.z }); }
    catch (e) { locs = []; }
    for (const l of locs) {
      if (budget()) yield 1;
      const below = block(dim, { x: l.x, y: l.y - 1, z: l.z });
      if (below && !below.isSolid) { try { block(dim, l)?.setType('minecraft:air'); } catch (e) { /* ok */ } }
    }
    // 3. water that ends against open air: seal it
    locs = [];
    try { for (const l of dim.getBlocks(vol, { includeTypes: WATER }, false).getBlockLocationIterator()) locs.push({ x: l.x, y: l.y, z: l.z }); }
    catch (e) { locs = []; }
    let sealed = 0;
    for (const l of locs) {
      const w = block(dim, l);
      try { if (!w || w.permutation.getState('liquid_depth') !== 0) continue; } catch (e) { continue; }
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        if (budget()) yield 1;
        const n = block(dim, { x: l.x + dx, y: l.y + dy, z: l.z + dz });
        if (n && n.isAir) {
          try { n.setType(l.y + dy < 0 ? 'minecraft:deepslate' : 'minecraft:stone'); sealed++; } catch (e) { /* ok */ }
        }
      }
    }
    if (sealed) debug(`sealed ${sealed} leaks in chunk ${cx},${cz}`);
  }
}

function plan() {
  if (!config.repair) return;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== 'minecraft:overworld' || !inBiome(p.dimension, p.location)) continue;
    const pcx = Math.floor(p.location.x / 16), pcz = Math.floor(p.location.z / 16);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const key = `${pcx + dx},${pcz + dz}`;
      if (known.has(key)) continue;
      known.add(key);
      queue.push({ dim: p.dimension, cx: pcx + dx, cz: pcz + dz, key });
    }
  }
}
function work() {
  if (!job && queue.length) {
    const q = queue.shift();
    const status = { retry: false };
    job = { gen: repairChunk(q.dim, q.cx, q.cz, status), status, key: q.key };
  }
  if (!job) return;
  let r;
  try { r = job.gen.next(); } catch (e) { r = { done: true }; }
  if (r.done) {
    if (job.status.retry) known.delete(job.key);            // not loaded yet: try again when the player is near
    job = null;
  }
}

world.afterEvents.worldLoad.subscribe(() => {
  system.runInterval(plan, 40);
  system.runInterval(work, 1);
});
