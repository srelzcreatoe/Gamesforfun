// Builds every preset into real packs, then checks them three ways:
//  1. Mobsmith's own validator reports no errors,
//  2. every generated file is valid JSON / PNG / ZIP,
//  3. entity, spawn-rule and trade files validate against Mojang's official
//     JSON schemas (when the bedrock-samples metadata is available locally).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import Ajv from 'ajv';
import catalog from '../data/catalog.json' with { type: 'json' };
import vanilla from '../data/vanilla.json' with { type: 'json' };
import { newProject } from '../src/core/model.js';
import { PRESETS, entityFromPreset } from '../src/core/presets.js';
import { buildPacks, makeAddon } from '../src/core/packgen.js';
import { validateProject } from '../src/core/validate.js';
import { readZip } from '../src/core/zip.js';

const META = process.env.BEDROCK_META || '/home/user/mojang/bedrock-samples/metadata';
const SCHEMAS = path.join(META, 'json_schemas');

function fullProject() {
  const p = newProject('Test Pack');
  for (const pr of PRESETS) p.entities.push(entityFromPreset(p, pr.id, `${pr.id}_mob`));
  return p;
}

test('every preset validates with no errors', () => {
  const p = fullProject();
  const issues = validateProject(p, catalog, vanilla);
  const errors = issues.filter((i) => i.level === 'error');
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  const warns = issues.filter((i) => i.level === 'warn');
  assert.deepEqual(warns, [], JSON.stringify(warns, null, 2));
});

test('generated files are well formed', async () => {
  const p = fullProject();
  const { bp, rp, notes } = buildPacks(p);
  for (const f of [...bp.files, ...rp.files]) {
    if (f.path.endsWith('.json')) assert.doesNotThrow(() => JSON.parse(f.data), f.path);
    if (f.path.endsWith('.png')) assert.deepEqual([...f.data.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], f.path);
  }
  const names = rp.files.map((f) => f.path);
  for (const e of p.entities) {
    assert.ok(names.includes(`entity/${e.name}.entity.json`));
    assert.ok(names.includes(`models/entity/${e.name}.geo.json`));
    assert.ok(names.includes(`textures/entity/${p.namespace}/${e.name}.png`));
  }
  assert.ok(notes.villager_mob.some((n) => n.includes('schedule')));
  const zip = makeAddon(p);
  const entries = await readZip(zip);
  assert.equal(entries.length, bp.files.length + rp.files.length);
  // Cross-check with the system unzip when present.
  const tmp = path.join(os.tmpdir(), `mobsmith-${process.pid}.mcaddon`);
  fs.writeFileSync(tmp, zip);
  try {
    const outp = execFileSync('unzip', ['-t', tmp]).toString();
    assert.match(outp, /No errors detected/);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('village dweller wiring: scheduler, activity groups, trades', () => {
  const p = fullProject();
  const { bp } = buildPacks(p);
  const ent = JSON.parse(bp.files.find((f) => f.path === 'entities/villager_mob.json').data)['minecraft:entity'];
  const sched = ent.components['minecraft:scheduler'];
  assert.equal(sched.scheduled_events.length, 4);
  assert.ok(ent.component_groups['test_pack:activity_sleep']['minecraft:behavior.sleep']);
  assert.deepEqual(ent.events['test_pack:schedule_sleep'].add.component_groups, ['test_pack:activity_sleep']);
  assert.ok(ent.events['test_pack:schedule_sleep'].remove.component_groups.includes('test_pack:activity_wander'));
  assert.equal(ent.components['minecraft:economy_trade_table'].table, 'trading/test_pack/villager_mob_trades.json');
  assert.equal(ent.components['minecraft:dweller'].dweller_role, 'inhabitant');
  assert.ok(bp.files.some((f) => f.path === 'trading/test_pack/villager_mob_trades.json'));
});

const haveSchemas = fs.existsSync(SCHEMAS);
test('output matches the official Bedrock JSON schemas', { skip: !haveSchemas && 'bedrock-samples metadata not found' }, () => {
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
  const BASE = 'https://schemas.mobsmith.local';
  const walkDir = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walkDir(path.join(d, x.name)) : [path.join(d, x.name)]));
  for (const f of walkDir(SCHEMAS).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    const rel = '/' + path.relative(SCHEMAS, f).split(path.sep).map(encodeURIComponent).join('/');
    s.$id = BASE + rel.replace(/%27/g, "'");
    delete s.$schema;
    // Mojang's generated schemas use oneOf with overlapping branches (e.g. a filter
    // map that accepts any object, integer vs number). The engine reads them
    // first-match, which is anyOf semantics.
    (function fix(o) {
      if (Array.isArray(o)) return o.forEach(fix);
      if (o && typeof o === 'object') {
        if (o.oneOf) { o.anyOf = o.oneOf; delete o.oneOf; }
        Object.values(o).forEach(fix);
      }
    })(s);
    try { ajv.addSchema(s); } catch { /* duplicate ids */ }
  }
  const ver = catalog.gameVersion;
  const entity = ajv.getSchema(`${BASE}/server/entity/${ver}/ActorDocument.json`);
  const spawn = ajv.getSchema(`${BASE}/client_server/common/legacy/Spawn%20Rules.json`);
  assert.ok(entity, 'entity schema loaded');
  const p = fullProject();
  const { bp } = buildPacks(p);
  const problems = [];
  for (const f of bp.files) {
    const json = f.path.endsWith('.json') ? JSON.parse(f.data) : null;
    if (f.path.startsWith('entities/')) {
      if (!entity(json['minecraft:entity'])) problems.push(`${f.path}: ${ajv.errorsText(entity.errors, { separator: '\n  ' })}`);
    } else if (f.path.startsWith('spawn_rules/') && spawn) {
      if (!spawn(json['minecraft:spawn_rules'])) problems.push(`${f.path}: ${ajv.errorsText(spawn.errors, { separator: '\n  ' })}`);
    }
  }
  assert.equal(problems.length, 0, problems.join('\n\n'));
});

test('schema check catches wrong value types (negative control)', { skip: !haveSchemas && 'no metadata' }, () => {
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
  const BASE = 'https://schemas.mobsmith.local';
  const walkDir = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walkDir(path.join(d, x.name)) : [path.join(d, x.name)]));
  for (const f of walkDir(SCHEMAS).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    s.$id = BASE + '/' + path.relative(SCHEMAS, f).split(path.sep).map(encodeURIComponent).join('/').replace(/%27/g, "'");
    delete s.$schema;
    (function fix(o) { if (Array.isArray(o)) return o.forEach(fix); if (o && typeof o === 'object') { if (o.oneOf) { o.anyOf = o.oneOf; delete o.oneOf; } Object.values(o).forEach(fix); } })(s);
    try { ajv.addSchema(s); } catch { /* dup */ }
  }
  const entity = ajv.getSchema(`${BASE}/server/entity/${catalog.gameVersion}/ActorDocument.json`);
  const bad = { description: { identifier: 'a:b' }, components: { 'minecraft:behavior.panic': { priority: 1, speed_multiplier: 'fast' }, 'minecraft:rideable': { dismount_mode: 'sideways' } } };
  assert.equal(entity(bad), false);
  const txt = ajv.errorsText(entity.errors);
  assert.match(txt, /speed_multiplier/);
  assert.match(txt, /dismount_mode/);
  const vers = fs.readdirSync(path.join(SCHEMAS, 'client_server/entity')).sort();
  const trade = ajv.getSchema(`${BASE}/client_server/entity/${vers[vers.length - 1]}/Trade%20Table.json`);
  if (trade) {
    const p = fullProject();
    const { bp } = buildPacks(p);
    const f = bp.files.find((x) => x.path.startsWith('trading/'));
    assert.ok(trade(JSON.parse(f.data).tiers), ajv.errorsText(trade.errors));
  }
});

test('custom sounds export into the resource pack', () => {
  const p = fullProject();
  p.sounds = [{ uid: 's1', name: 'scream', ext: 'ogg', category: 'hostile', volume: 1, pitch: 0.8 }];
  p.entities[0].sounds.events.ambient = { sound: `${p.namespace}.scream`, volume: 1, pitch: 1 };
  const issues = validateProject(p, catalog, vanilla).filter((i) => i.level !== 'info');
  assert.deepEqual(issues, []);
  const { rp } = buildPacks(p, { customSounds: [{ uid: 's1', bytes: new Uint8Array([79, 103, 103, 83]) }] });
  const defs = JSON.parse(rp.files.find((f) => f.path === 'sounds/sound_definitions.json').data);
  assert.deepEqual(defs.sound_definitions[`${p.namespace}.scream`].sounds[0], { name: `sounds/${p.namespace}/scream`, volume: 1, load_on_low_memory: true, pitch: 0.8 });
  assert.ok(rp.files.some((f) => f.path === `sounds/${p.namespace}/scream.ogg`));
});
