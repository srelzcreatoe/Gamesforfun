// "How many can exist at once": slot tags, removal event, director guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newProject, migrateProject } from '../src/core/model.js';
import { dwellerFromPreset } from '../src/core/dwellers.js';
import { entityFromPreset } from '../src/core/presets.js';
import { buildPacks } from '../src/core/packgen.js';
import { validateProject } from '../src/core/validate.js';
import { limitTag, limitEvent } from '../src/core/limits.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cmdFile = path.resolve(HERE, '../../../../mojang/bedrock-samples/metadata/command_modules/mojang-commands.json');
const known = fs.existsSync(cmdFile) ? new Set(JSON.parse(fs.readFileSync(cmdFile, 'utf8')).commands.map((c) => c.name)) : null;
const fn = (bp, p) => bp.files.find((f) => f.path === p)?.data;
const ent = (bp, name) => JSON.parse(fn(bp, `entities/${name}.json`))['minecraft:entity'];

test('dwellers and bosses default to one at a time; normal mobs have no limit', () => {
  const p = newProject('Lim');
  assert.deepEqual(dwellerFromPreset(p, 'night_grinner').limit, { on: true, max: 1 });
  assert.deepEqual(entityFromPreset(p, 'boss', 'b').limit, { on: true, max: 1 });
  assert.equal(entityFromPreset(p, 'melee', 'm').limit.on, false);
  // Old projects: dwellers keep their "one at a time" choice.
  const old = migrateProject({ name: 'Old', namespace: 'old', entities: [{ name: 'x', components: {}, groups: [], events: [], properties: [], anims: {}, sounds: {}, horror: { enabled: true, appear: { oneAtATime: true } } }] });
  assert.deepEqual(old.entities[0].limit, { on: true, max: 1 });
});

test('limit function keeps the first N and removes extra copies', () => {
  const p = newProject('Unique');
  const d = dwellerFromPreset(p, 'hollow_grinner', 'hg');
  const m = entityFromPreset(p, 'melee', 'grunt');
  m.limit = { on: true, max: 3 };
  const free = entityFromPreset(p, 'pet', 'dog');
  p.entities.push(d, m, free);
  const issues = validateProject(p).filter((i) => i.level === 'error');
  assert.deepEqual(issues, []);
  const { bp } = buildPacks(p);
  const ns = p.namespace;
  const tick = JSON.parse(fn(bp, 'functions/tick.json'));
  assert.ok(tick.values.includes(`${ns}/limits`));
  const lim = fn(bp, `functions/${ns}/limits.mcfunction`);
  const sec = fn(bp, `functions/${ns}/limits_second.mcfunction`);
  assert.ok(lim && sec);
  for (const [name, n] of [['hg', 1], ['grunt', 3]]) {
    const id = `${ns}:${name}`;
    const tags = Array.from({ length: n }, (_, i) => limitTag(ns, name, i + 1));
    for (const t of tags) assert.ok(lim.includes(`execute unless entity @e[type=${id},tag=${t}] run tag @e[type=${id},${tags.map((x) => `tag=!${x}`).join(',')},c=1] add ${t}`));
    assert.ok(lim.includes(`run event entity @e[type=${id},${tags.map((x) => `tag=!${x}`).join(',')}] ${limitEvent(ns)}`));
    const e = ent(bp, name);
    assert.ok(e.component_groups[`${ns}:limit_remove`]['minecraft:instant_despawn'], `${name} can be removed`);
    assert.deepEqual(e.events[limitEvent(ns)], { add: { component_groups: [`${ns}:limit_remove`] } });
    assert.ok(!e.components['minecraft:instant_despawn'], 'not in base components');
  }
  assert.ok(!lim.includes(`${ns}:dog`), 'unlimited mob untouched');
  assert.ok(!ent(bp, 'dog').events[limitEvent(ns)]);
  // Valid commands, short objective names, unique tags.
  for (const line of [...lim.split('\n'), ...sec.split('\n')].filter((l) => l && !l.startsWith('#'))) {
    if (known) assert.ok(known.has(line.split(' ')[0]), line);
    for (const o of line.matchAll(/(?:objectives add|players \w+ \S+) (ms[_a-z0-9]+)/g)) assert.ok(o[1].length <= 16, o[1]);
  }
  assert.notEqual(limitTag(ns, 'hg', 1), limitTag(ns, 'grunt', 1));
  // The appearance timer only summons while there's room.
  const dir = fn(bp, `functions/${ns}/dwellers/hg.mcfunction`);
  assert.match(dir, new RegExp(`execute as @e\\[type=${ns}:hg\\] run scoreboard players add #n \\S+ 1`));
  assert.match(dir, /if score #n \S+ matches \.\.0 run summon/);
});

test('no limit: no limit function, and the timer can bring several', () => {
  const p = newProject('Many');
  const d = dwellerFromPreset(p, 'night_grinner', 'ng');
  d.limit = { on: false, max: 1 };
  p.entities.push(d);
  const { bp } = buildPacks(p);
  assert.ok(!fn(bp, `functions/${p.namespace}/limits.mcfunction`));
  assert.deepEqual(JSON.parse(fn(bp, 'functions/tick.json')).values, [`${p.namespace}/dwellers/tick`]);
  assert.ok(!fn(bp, `functions/${p.namespace}/dwellers/ng.mcfunction`).includes('#n'));
});
