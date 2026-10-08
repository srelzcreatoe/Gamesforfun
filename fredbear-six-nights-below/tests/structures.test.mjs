// Round-trip tests for the generated command-block structures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readNbt, plain } from '../tools/lib/nbt.mjs';
import { allCommandBlocks, structureGroups, buildStructure, BLOCK_VERSION, COMMAND_VERSION } from '../tools/gen_structures.mjs';
import { validateCommand } from '../tools/validate_commands.mjs';
import { isKnownInputAction } from '../packs/FredbearBP/scripts/data/input_actions.js';
import { INPUTS, inputCbPos } from '../packs/FredbearBP/scripts/data/inputs.js';
import { layoutModules } from '../packs/FredbearBP/scripts/data/actuators.js';

const DIR = new URL('../packs/FredbearBP/structures/fb/', import.meta.url).pathname;

test('every generated .mcstructure parses and matches the register exactly', () => {
  const groups = structureGroups();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mcstructure'));
  assert.equal(files.length, groups.size);
  let total = 0;
  for (const [name, blocks] of groups) {
    const buf = fs.readFileSync(path.join(DIR, `${name}.mcstructure`));
    assert.deepEqual(buf, buildStructure(blocks).buf, `${name} is stale; rerun tools/gen_structures.mjs`);
    const { root, bytes } = readNbt(buf);
    assert.equal(bytes, buf.length, 'no trailing bytes');
    const s = plain(root);
    assert.equal(s.format_version, 1);
    const [sx, sy, sz] = s.size;
    const [l0, l1] = s.structure.block_indices;
    assert.equal(l0.length, sx * sy * sz);
    assert.ok(l1.every((v) => v === -1), 'no waterlogging layer');
    const pal = s.structure.palette.default.block_palette;
    for (const p of pal) {
      assert.match(p.name, /^minecraft:(command_block|chain_command_block|repeating_command_block)$/);
      assert.equal(p.version, BLOCK_VERSION);
      assert.deepEqual(Object.keys(p.states).sort(), ['conditional_bit', 'facing_direction']);
    }
    const pos = s.structure.palette.default.block_position_data;
    for (const b of blocks) {
      const [x, y, z] = [b.world[0] - s.structure_world_origin[0], b.world[1] - s.structure_world_origin[1], b.world[2] - s.structure_world_origin[2]];
      const idx = (x * sy + y) * sz + z; // ZYX order, z fastest
      assert.ok(l0[idx] >= 0, `${b.id} missing from index`);
      const be = pos[String(idx)].block_entity_data;
      assert.equal(be.id, 'CommandBlock');
      assert.equal(be.Command, b.command);
      assert.equal(be.TickDelay, b.delay);
      assert.equal(be.auto, b.alwaysActive ? 1 : 0);
      assert.equal(be.conditionalMode, 0);
      assert.equal(be.Version, COMMAND_VERSION);
      assert.deepEqual([be.x, be.y, be.z], b.world);
      total++;
    }
    assert.equal(l0.filter((v) => v >= 0).length, blocks.length, `${name}: unexpected extra blocks`);
  }
  assert.equal(total, allCommandBlocks().length);
});

test('every command-block command is valid 1.26.50 syntax and every input action has a handler', () => {
  for (const b of allCommandBlocks()) {
    const errs = validateCommand(b.command, { scriptEvents: isKnownInputAction });
    assert.deepEqual(errs, [], `${b.id}: ${b.command}`);
  }
});

test('modules: impulse needs redstone, chain blocks always active, the first block clears its own pad', () => {
  const blocks = allCommandBlocks();
  for (const { module: m, pad } of layoutModules().modules) {
    const chain = blocks.filter((b) => b.module === m.id).sort((a, b) => a.local[0] - b.local[0]);
    assert.equal(chain[0].type, 'impulse');
    assert.equal(chain[0].alwaysActive, false);
    assert.equal(chain[0].command, `setblock ${pad[0]} ${pad[1] - 50} ${pad[2]} air`);
    for (const c of chain.slice(1)) {
      assert.equal(c.type, 'chain');
      assert.equal(c.alwaysActive, true);
    }
    // contiguous along +X starting right after the pad
    chain.forEach((c, k) => assert.deepEqual(c.local, [pad[0] + 1 + k, pad[1], pad[2]]));
  }
});

test('no command block shares a position with another, a pad, or a console', () => {
  const seen = new Map();
  for (const b of allCommandBlocks()) {
    const k = b.local.join(',');
    assert.ok(!seen.has(k), `${b.id} overlaps ${seen.get(k)}`);
    seen.set(k, b.id);
  }
  for (const { module: m, pad } of layoutModules().modules) assert.ok(!seen.has(pad.join(',')), `pad of ${m.id} is occupied`);
  for (const inp of INPUTS) assert.deepEqual(seen.get(inputCbPos(inp).join(',')), `${inp.id}#0`);
});

test('only one repeating command block exists (event-driven design)', () => {
  assert.equal(allCommandBlocks().filter((b) => b.type === 'repeating').length, 1);
});
