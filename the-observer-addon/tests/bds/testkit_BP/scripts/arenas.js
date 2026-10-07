// Deterministic arenas for integration tests (built with commands in a fresh world).
import { world, system, BlockPermutation } from "@minecraft/server";

export const Y = 140; // standing height on the platform (floor blocks at Y-1)
export const FIELD = { x: 950, y: Y, z: 1000 };
export const HOUSE = { x0: 1076, x1: 1084, z0: 996, z1: 1004, door: { x: 1076, y: Y, z: 1000 }, pumpkin: { x: 1083, y: Y, z: 1003 },
  stonecutter: { x: 1083, y: Y, z: 997 }, center: { x: 1080.5, y: Y, z: 1000.5 }, torches: [{ x: 1077, y: Y, z: 997 }, { x: 1077, y: Y, z: 1003 }, { x: 1081, y: Y, z: 1003 }, { x: 1081, y: Y, z: 997 }] };
export const TUNNEL = { x0: 902, x1: 958, y: 125, z0: 1085, z1: 1086 };
export const NETHER = { x: 40, y: 70, z: 40 };
export const POOL = { x0: 996, x1: 1060, z0: 964, z1: 1036, center: { x: 1028.5, y: Y - 1, z: 1000.5 } };
export const PILLAR = { x: 960, z: 990, top: Y + 20 };

const ow = () => world.getDimension("overworld");

function run(dim, cmd) {
  try {
    return dim.runCommand(cmd).successCount;
  } catch (e) {
    console.warn(`[OTEST] cmd failed: ${cmd} -> ${e}`);
    return 0;
  }
}

async function waitLoaded(dim, pts) {
  for (let i = 0; i < 200; i++) {
    if (pts.every((p) => dim.isChunkLoaded(p))) return true;
    await system.waitTicks(5);
  }
  return false;
}

function setBlock(dim, loc, id, states) {
  dim.getBlock(loc).setPermutation(BlockPermutation.resolve(id, states));
}

export async function build() {
  const dim = ow();
  run(dim, "tickingarea remove_all");
  run(dim, `tickingarea add 896 0 960 1120 0 1040 arena_main true`);
  run(dim, `tickingarea add 896 0 1078 964 0 1092 arena_tunnel true`);
  const grid = [];
  for (let x = 900; x <= 1120; x += 16) for (let z = 960; z <= 1040; z += 16) grid.push({ x, y: Y, z });
  for (let x = 900; x <= 960; x += 16) grid.push({ x, y: 125, z: 1085 });
  grid.push({ x: 960, y: 125, z: 1089 });
  const ok = await waitLoaded(dim, grid);
  if (!ok) throw new Error("arena chunks did not load");
  // platform: clear air above, grass floor, stone under
  for (let x = 900; x <= 1120; x += 30) {
    const x1 = Math.min(1120, x + 29);
    run(dim, `fill ${x} ${Y} 960 ${x1} ${Y + 12} 1040 air`);
    run(dim, `fill ${x} ${Y - 3} 960 ${x1} ${Y - 2} 1040 stone`);
    run(dim, `fill ${x} ${Y - 1} 960 ${x1} ${Y - 1} 1040 grass_block`);
  }
  // field cover: log pillars ("trees") and a few low walls
  const trees = [[930, 990], [940, 1015], [962, 985], [968, 1012], [925, 1005], [955, 1025], [975, 995], [945, 975], [985, 1020], [920, 980]];
  for (const [x, z] of trees) run(dim, `fill ${x} ${Y} ${z} ${x} ${Y + 4} ${z} oak_log`);
  run(dim, `fill 990 ${Y} 990 990 ${Y + 2} 996 cobblestone`);
  run(dim, `fill 910 ${Y} 1010 916 ${Y + 2} 1010 cobblestone`);
  // a broad, shallow pool (water surface at Y-1)
  for (let x = POOL.x0; x <= POOL.x1; x += 30) run(dim, `fill ${x} ${Y - 2} ${POOL.z0} ${Math.min(POOL.x1, x + 29)} ${Y - 1} ${POOL.z1} water`);
  // a 20-block pillar to stand on
  run(dim, `fill ${PILLAR.x} ${Y} ${PILLAR.z} ${PILLAR.x} ${PILLAR.top - 1} ${PILLAR.z} stone`);
  // house
  const H = HOUSE;
  run(dim, `fill ${H.x0} ${Y} ${H.z0} ${H.x1} ${Y + 4} ${H.z1} stonebrick`);
  run(dim, `fill ${H.x0 + 1} ${Y} ${H.z0 + 1} ${H.x1 - 1} ${Y + 3} ${H.z1 - 1} air`);
  run(dim, `fill ${H.x0} ${Y - 1} ${H.z0} ${H.x1} ${Y - 1} ${H.z1} oak_planks`);
  // windows (glass panes) on north and south walls
  run(dim, `fill ${H.x0 + 3} ${Y + 1} ${H.z0} ${H.x0 + 5} ${Y + 2} ${H.z0} glass_pane`);
  run(dim, `fill ${H.x0 + 3} ${Y + 1} ${H.z1} ${H.x0 + 5} ${Y + 2} ${H.z1} glass_pane`);
  // door in the west wall
  setBlock(dim, H.door, "minecraft:wooden_door", { upper_block_bit: false, open_bit: false, "minecraft:cardinal_direction": "east" });
  setBlock(dim, { x: H.door.x, y: Y + 1, z: H.door.z }, "minecraft:wooden_door", { upper_block_bit: true, open_bit: false, "minecraft:cardinal_direction": "east" });
  for (const t of H.torches) setBlock(dim, t, "minecraft:torch", { torch_facing_direction: "top" });
  setBlock(dim, H.pumpkin, "minecraft:carved_pumpkin", { "minecraft:cardinal_direction": "north" });
  setBlock(dim, H.stonecutter, "minecraft:stonecutter_block", { "minecraft:cardinal_direction": "north" });
  setBlock(dim, { x: H.x0 - 2, y: Y, z: H.z0 + 6 }, "minecraft:lantern", { hanging: false });
  // tunnel inside a stone box
  const T = TUNNEL;
  const a = run(dim, `fill 900 ${T.y - 3} 1082 960 ${T.y + 11} 1089 stone`);
  const b = run(dim, `fill ${T.x0} ${T.y} ${T.z0} ${T.x1} ${T.y + 2} ${T.z1} air`);
  console.warn(`[OTEST] tunnel fill stone=${a} air=${b} block=${dim.getBlock({ x: 930, y: T.y, z: 1085 })?.typeId}`);
  for (let x = T.x0 + 4; x <= T.x1; x += 8) setBlock(dim, { x, y: T.y, z: T.z0 }, "minecraft:torch", { torch_facing_direction: "top" });
  // nether platform
  const nether = world.getDimension("nether");
  run(nether, `tickingarea add ${NETHER.x - 16} 0 ${NETHER.z - 16} ${NETHER.x + 16} 0 ${NETHER.z + 16} arena_nether true`);
  if (await waitLoaded(nether, [NETHER])) {
    run(nether, `fill ${NETHER.x - 12} ${NETHER.y} ${NETHER.z - 12} ${NETHER.x + 12} ${NETHER.y + 6} ${NETHER.z + 12} air`);
    run(nether, `fill ${NETHER.x - 12} ${NETHER.y - 1} ${NETHER.z - 12} ${NETHER.x + 12} ${NETHER.y - 1} ${NETHER.z + 12} netherrack`);
  }
  run(dim, "gamerule domobspawning false");
  run(dim, "gamerule dodaylightcycle false");
  run(dim, "gamerule doweathercycle false");
  run(dim, "time set noon");
  run(dim, "kill @e[type=item]");
}

/** Reset the house fixtures between tests. */
export function resetHouse() {
  const dim = ow();
  const H = HOUSE;
  setBlock(dim, H.door, "minecraft:wooden_door", { upper_block_bit: false, open_bit: false, "minecraft:cardinal_direction": "east" });
  setBlock(dim, { x: H.door.x, y: Y + 1, z: H.door.z }, "minecraft:wooden_door", { upper_block_bit: true, open_bit: false, "minecraft:cardinal_direction": "east" });
  for (const t of H.torches) setBlock(dim, t, "minecraft:torch", { torch_facing_direction: "top" });
  setBlock(dim, H.pumpkin, "minecraft:carved_pumpkin", { "minecraft:cardinal_direction": "north" });
  run(dim, `fill ${H.x0 + 1} ${Y} ${H.z0 + 1} ${H.x1 - 1} ${Y} ${H.z1 - 1} air replace observer:effigy`);
}
