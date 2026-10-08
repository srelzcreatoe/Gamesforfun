// Generates the command-block .mcstructure files and the full placement
// register (tools/out/cb_register.json) from scripts/data/actuators.js and
// scripts/data/inputs.js.
//
// .mcstructure layout (little-endian NBT, verified against a structure file
// exported by Bedrock - see docs/01_COMPATIBILITY.md):
//   format_version:int 1, size:list<int>[x,y,z], structure_world_origin:list<int>,
//   structure:{ block_indices:list<list<int>>[layer0, layer1], entities:list<compound>,
//               palette:{ default:{ block_palette:list<compound>, block_position_data:compound } } }
// block_indices are ZYX order (z fastest): i = (x*sy + y)*sz + z; -1 = structure void.
import fs from 'node:fs';
import path from 'node:path';
import { writeNbt, comp, list, int, byte, long, str } from './lib/nbt.mjs';
import { MODULES, REPEATERS, layoutModules, resolveCommand } from '../packs/FredbearBP/scripts/data/actuators.js';
import { INPUTS, inputCbPos } from '../packs/FredbearBP/scripts/data/inputs.js';
import { ORIGIN } from '../packs/FredbearBP/scripts/data/layout.js';

export const BLOCK_VERSION = 18161159; // block-state version stamped by Bedrock 1.21.30 on these blocks
export const COMMAND_VERSION = 42; // command-block 'Version' observed in a Bedrock-exported structure

const FACING = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
const TYPE_NAME = { impulse: 'minecraft:command_block', chain: 'minecraft:chain_command_block', repeating: 'minecraft:repeating_command_block' };
const LP_MODE = { impulse: 0, repeating: 1, chain: 2 };

/** All command blocks with their full configuration (local coordinates). */
export function allCommandBlocks() {
  const blocks = [];
  const { modules, repeaters } = layoutModules();
  for (const { module: m, pad, impulse, row } of modules) {
    const [x, y, z] = impulse;
    const cmds = [{ c: `setblock ${pad[0] + ORIGIN.x} ${pad[1] + ORIGIN.y} ${pad[2] + ORIGIN.z} air` }, ...m.cmds.map((c) => ({ ...c, c: resolveCommand(c.c, modules) }))];
    // impulse block runs the pad clear; each following command is a chain block.
    cmds.forEach((cmd, k) => {
      blocks.push({
        id: `${m.id}#${k}`, module: m.id, section: m.section, purpose: k === 0 ? `${m.purpose} (trigger; clears pad)` : m.purpose,
        local: [x + k, y, z], type: k === 0 ? 'impulse' : 'chain', conditional: false, alwaysActive: k !== 0,
        delay: cmd.delay ?? 0, facing: 'east', command: cmd.c, row, pad: k === 0 ? pad : null,
        trigger: k === 0 ? `script places minecraft:redstone_block at pad ${pad.join(' ')} (local)` : `previous block in ${m.id}`,
      });
    });
  }
  for (const { repeater: r, pos, row } of repeaters) {
    blocks.push({
      id: `${r.id}#0`, module: r.id, section: r.section, purpose: r.purpose, local: pos, type: 'repeating', conditional: false,
      alwaysActive: true, delay: r.delay, facing: 'east', command: r.cmd, row, pad: null, trigger: 'always active (repeats every delay ticks)',
    });
  }
  for (const inp of INPUTS) {
    blocks.push({
      id: `${inp.id}#0`, module: inp.id, section: 'IN', purpose: `Input: ${inp.label} (${inp.kind})`, local: inputCbPos(inp), type: 'impulse',
      conditional: false, alwaysActive: false, delay: 0, facing: 'up', command: `scriptevent fb:input ${inp.action}`, row: null, pad: null,
      trigger: inp.kind === 'plate' ? 'pressure plate above the floor block on top of this CB' : `${inp.kind} on top of the console block above this CB`,
    });
  }
  for (const b of blocks) b.world = [b.local[0] + ORIGIN.x, b.local[1] + ORIGIN.y, b.local[2] + ORIGIN.z];
  return blocks;
}

function blockEntity(b) {
  return comp({
    id: str('CommandBlock'),
    Command: str(b.command),
    CustomName: str(b.module),
    ExecuteOnFirstTick: byte(0),
    LPCommandMode: int(LP_MODE[b.type]),
    LPCondionalMode: byte(b.conditional ? 1 : 0),
    LPRedstoneMode: byte(b.alwaysActive ? 0 : 1),
    LastExecution: long(0),
    LastOutput: str(''),
    LastOutputParams: list('string', []),
    SuccessCount: int(0),
    TickDelay: int(b.delay),
    TrackOutput: byte(1),
    Version: int(COMMAND_VERSION),
    auto: byte(b.alwaysActive ? 1 : 0),
    conditionMet: byte(0),
    conditionalMode: byte(b.conditional ? 1 : 0),
    isMovable: byte(1),
    powered: byte(0),
    x: int(b.world[0]),
    y: int(b.world[1]),
    z: int(b.world[2]),
  });
}

/** Build one .mcstructure buffer containing `blocks` (everything else structure void). */
export function buildStructure(blocks) {
  const xs = blocks.map((b) => b.world[0]);
  const ys = blocks.map((b) => b.world[1]);
  const zs = blocks.map((b) => b.world[2]);
  const min = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
  const size = [Math.max(...xs) - min[0] + 1, Math.max(...ys) - min[1] + 1, Math.max(...zs) - min[2] + 1];
  const vol = size[0] * size[1] * size[2];
  const layer0 = new Array(vol).fill(-1);
  const layer1 = new Array(vol).fill(-1);
  const palette = [];
  const paletteKey = new Map();
  const posData = {};
  for (const b of blocks) {
    const key = `${b.type}:${b.facing}:${b.conditional}`;
    let pi = paletteKey.get(key);
    if (pi === undefined) {
      pi = palette.length;
      paletteKey.set(key, pi);
      palette.push(comp({
        name: str(TYPE_NAME[b.type]),
        states: comp({ conditional_bit: byte(b.conditional ? 1 : 0), facing_direction: int(FACING[b.facing]) }),
        version: int(BLOCK_VERSION),
      }));
    }
    const [x, y, z] = [b.world[0] - min[0], b.world[1] - min[1], b.world[2] - min[2]];
    const idx = (x * size[1] + y) * size[2] + z;
    layer0[idx] = pi;
    posData[String(idx)] = comp({ block_entity_data: blockEntity(b) });
  }
  const root = comp({
    format_version: int(1),
    size: list('int', size),
    structure: comp({
      block_indices: list('list', [list('int', layer0), list('int', layer1)]),
      entities: list('compound', []),
      palette: comp({ default: comp({ block_palette: list('compound', palette), block_position_data: comp(posData) }) }),
    }),
    structure_world_origin: list('int', min),
  });
  return { buf: writeNbt(root), min, size };
}

/** Group CBs into structure files: one per control-room row, input clusters by area. */
export function structureGroups() {
  const blocks = allCommandBlocks();
  const groups = new Map();
  for (const b of blocks) {
    let name;
    if (b.section !== 'IN') name = `cb_row_${b.row}`;
    else {
      const [x, y, z] = b.local;
      const lvl = y <= -4 ? 'b' : y >= 7 ? 'u' : 'g';
      name = `in_${lvl}_${Math.floor(x / 32)}_${Math.floor(z / 32)}`;
    }
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(b);
  }
  return groups;
}

export function generateStructures(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.mcstructure')) fs.rmSync(path.join(outDir, f));
  const manifest = [];
  for (const [name, blocks] of structureGroups()) {
    const { buf, min, size } = buildStructure(blocks);
    fs.writeFileSync(path.join(outDir, `${name}.mcstructure`), buf);
    manifest.push({ id: `fb:${name}`, file: `structures/fb/${name}.mcstructure`, worldOrigin: min, size, blocks: blocks.length, bytes: buf.length });
  }
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('../', import.meta.url).pathname;
  const manifest = generateStructures(path.join(root, 'packs/FredbearBP/structures/fb'));
  const blocks = allCommandBlocks();
  fs.mkdirSync(path.join(root, 'tools/out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/out/cb_register.json'), JSON.stringify({ blocks, structures: manifest }, null, 1));
  // Structure placement table consumed by the in-game builder.
  const js = `// GENERATED by tools/gen_structures.mjs - do not edit.\n// Command-block structure files and the WORLD position each must be placed at.\nexport const CB_STRUCTURES = Object.freeze(${JSON.stringify(manifest.map((m) => ({ id: m.id, at: m.worldOrigin, size: m.size, blocks: m.blocks })), null, 1)});\n`;
  fs.writeFileSync(path.join(root, 'packs/FredbearBP/scripts/data/cb_structures.generated.js'), js);
  const byType = blocks.reduce((a, b) => ((a[b.type] = (a[b.type] ?? 0) + 1), a), {});
  console.log(`${blocks.length} command blocks (${JSON.stringify(byType)}) in ${manifest.length} structures; ${MODULES.length} actuator modules, ${REPEATERS.length} repeater(s), ${INPUTS.length} inputs`);
}
