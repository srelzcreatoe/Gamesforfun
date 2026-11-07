#!/usr/bin/env node
// Validator for the Shaftbreaker Bedrock add-on (Shaftbreaker_RP + Shaftbreaker_BP).
//
//   node tools/validate.mjs            full report (exit code 1 when there are errors)
//   node tools/validate.mjs --quiet    only print problems and the summary
//   node tools/validate.mjs --strict   treat warnings as errors (exit code 1)
//   node tools/validate.mjs --no-schema  skip JSON-schema validation (cross-checks only)
//   node tools/validate.mjs --root <dir>  validate the packs in another add-on folder (testing)
//
// What it does
//  1. Parses every .json in both packs (Bedrock-style // and /* */ comments are tolerated) and
//     validates it against the matching Blockception schema (tools/.cache/bedrock-schemas) with ajv.
//     $refs to other schema files are resolved by loading those files; refs that cannot be resolved
//     are reported as warnings and treated as "anything goes".
//  2. Cross-checks references between files (see the check* functions below): animation / controller
//     names, bones and locators, timeline effects, Molang syntax (tools/lib/molang.js) and unknown
//     queries / unassigned variables, textures, geometry identifier, UV bounds, PNG density,
//     manifests, lang keys, entity properties / events / component groups, block and item ids
//     (tools/data/vanilla_ids.json, from Mojang bedrock-samples metadata), sounds and particles.
//  Files produced by other build steps (geometry, texture, animations) may be missing: that is a
//  warning, and the checks that depend on them are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compileMolang } from './lib/molang.js';
import { faceRects } from './lib/model.js';

const require = createRequire(import.meta.url);
const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ARGV = process.argv.slice(2);
const rootIdx = ARGV.indexOf('--root');
const ROOT = rootIdx >= 0 && ARGV[rootIdx + 1] ? path.resolve(ARGV[rootIdx + 1]) : path.resolve(TOOLS, '..');
const RP = path.join(ROOT, 'Shaftbreaker_RP');
const BP = path.join(ROOT, 'Shaftbreaker_BP');
const SCHEMAS = path.join(TOOLS, '.cache', 'bedrock-schemas');
const VANILLA = path.join(TOOLS, '.cache', 'vanilla');
const IDS_FILE = path.join(TOOLS, 'data', 'vanilla_ids.json');

const ARGS = new Set(ARGV);
const QUIET = ARGS.has('--quiet');
const STRICT = ARGS.has('--strict');
const NO_SCHEMA = ARGS.has('--no-schema');

// --------------------------------------------------------------------------- SPEC contract
// SPEC.md §7 (animation short name -> full name) and §4 (rig + locators).
const SPEC_ANIMATIONS = {
  dormant: 'animation.shaftbreaker.dormant',
  look_at: 'animation.shaftbreaker.look_at',
  stalk_idle: 'animation.shaftbreaker.stalk_idle',
  stalk_walk: 'animation.shaftbreaker.stalk_walk',
  watch: 'animation.shaftbreaker.watch',
  breaker_smash: 'animation.shaftbreaker.breaker_smash',
  breaker_walk: 'animation.shaftbreaker.breaker_walk',
  frenzy_idle: 'animation.shaftbreaker.frenzy_idle',
  frenzy_run: 'animation.shaftbreaker.frenzy_run',
  frenzy_lunge: 'animation.shaftbreaker.frenzy_lunge',
};
const SPEC_BONES = [
  'root', 'body', 'waist', 'chest', 'mane_front', 'mane_back', 'mane_left', 'mane_right', 'neck', 'head', 'jaw',
  ...['right', 'left'].flatMap((s) => [
    `arm_${s}_upper`, `arm_${s}_lower`, `hand_${s}`,
    ...[1, 2, 3, 4].flatMap((n) => [`finger_${s}_${n}_a`, `finger_${s}_${n}_b`]),
    `thumb_${s}_a`, `thumb_${s}_b`, `leg_${s}_upper`, `leg_${s}_lower`, `foot_${s}`,
  ]),
];
const SPEC_LOCATORS = ['claw_right', 'claw_left', 'mouth', 'foot_right', 'foot_left', 'lead'];

// --------------------------------------------------------------------------- reporting
const errors = [];
const warnings = [];
const rel = (f) => (f ? path.relative(ROOT, f).split(path.sep).join('/') : '(add-on)');
function err(file, msg) { errors.push(`${rel(file)}: ${msg}`); }
function warn(file, msg) { warnings.push(`${rel(file)}: ${msg}`); }
function info(msg) { if (!QUIET) console.log(msg); }

// --------------------------------------------------------------------------- file helpers
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out.sort();
}

// Remove // and /* */ comments outside of strings (Bedrock tolerates them).
function stripComments(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[++i] ?? ''; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') out += '\n'; i++; }
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

const jsonCache = new Map();
function readJson(file, { report = true } = {}) {
  if (jsonCache.has(file)) return jsonCache.get(file);
  let value = null;
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    value = JSON.parse(stripComments(raw));
  } catch (e) {
    if (report) err(file, `invalid JSON: ${e.message}`);
  }
  jsonCache.set(file, value);
  return value;
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function readLang(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim() || line.startsWith('##')) return;
    const eq = line.indexOf('=');
    if (eq <= 0) { warn(file, `line ${i + 1}: not a key=value line`); return; }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).replace(/\t##.*$/, '').trimEnd();
    if (map.has(key)) warn(file, `duplicate key ${key}`);
    if (!value) warn(file, `empty value for ${key}`);
    map.set(key, value);
  });
  return map;
}

const nsId = (id) => (id.includes(':') ? id : `minecraft:${id}`);
const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// --------------------------------------------------------------------------- Molang
const QUERY_RE = /\b(?:query|q)\.([a-z_][a-z0-9_]*)/gi;
const VAR_READ_RE = /\b(?:variable|v)\.([a-z_][a-z0-9_.]*)/gi;
const VAR_WRITE_RE = /\b(?:variable|v)\.([a-z_][a-z0-9_]*)\s*=(?!=)/gi;
const PROP_CMP_RES = [
  /(?:query|q)\.property\(\s*'([^']+)'\s*\)\s*(?:==|!=)\s*'([^']*)'/gi,
  /'([^']*)'\s*(?:==|!=)\s*(?:query|q)\.property\(\s*'([^']+)'\s*\)/gi,
];
const molangUses = []; // { file, where, src, side: 'client'|'server'|'particle' }

function molang(file, where, src, side = 'client') {
  if (typeof src === 'number' || typeof src === 'boolean') return;
  if (typeof src !== 'string') { err(file, `${where}: expected a Molang string or number, got ${JSON.stringify(src)}`); return; }
  try {
    compileMolang(src);
  } catch (e) {
    err(file, `${where}: Molang does not parse: ${e.message}`);
    return;
  }
  molangUses.push({ file, where, src, side });
}

// --------------------------------------------------------------------------- vanilla reference data
let vanillaIds = null;
function ids() {
  if (vanillaIds) return vanillaIds;
  if (!fs.existsSync(IDS_FILE)) { warn(null, `${rel(IDS_FILE)} missing: block/item ids not checked`); vanillaIds = { blocks: null, items: null }; return vanillaIds; }
  const j = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));
  vanillaIds = { blocks: new Set(j.blocks), items: new Set(j.items) };
  return vanillaIds;
}

const vanilla = (() => {
  const v = { available: fs.existsSync(VANILLA), soundDefs: new Map(), soundFiles: new Set(), particles: new Set(), textures: new Set(), materials: new Set(), queries: new Set(), engineVars: new Set(), entitySoundEvents: new Set(), renderControllers: new Set() };
  if (!v.available) return v;
  const rpv = path.join(VANILLA, 'resource_pack');
  const sd = readJson(path.join(rpv, 'sounds', 'sound_definitions.json'), { report: false });
  if (sd) {
    for (const [k, def] of Object.entries(sd.sound_definitions || {})) {
      v.soundDefs.set(k, def);
      for (const s of def.sounds || []) v.soundFiles.add(typeof s === 'string' ? s : s.name);
    }
  }
  const sj = readJson(path.join(rpv, 'sounds.json'), { report: false });
  for (const e of Object.values(sj?.entity_sounds?.entities || {})) for (const k of Object.keys(e.events || {})) v.entitySoundEvents.add(k);
  for (const k of Object.keys(sj?.entity_sounds?.defaults?.events || {})) v.entitySoundEvents.add(k);
  for (const f of walk(path.join(rpv, 'particles'))) {
    const j = readJson(f, { report: false });
    const id = j?.particle_effect?.description?.identifier;
    if (id) v.particles.add(id);
  }
  for (const f of walk(path.join(rpv, 'textures'))) v.textures.add(path.relative(rpv, f).split(path.sep).join('/').replace(/\.(png|tga|jpg)$/i, ''));
  // Materials, queries and engine-provided variables as used by vanilla client files.
  const assigned = new Set();
  const read = new Set();
  const scan = (s) => {
    for (const m of s.matchAll(QUERY_RE)) v.queries.add(m[1].toLowerCase());
    for (const m of s.matchAll(VAR_WRITE_RE)) assigned.add(m[1].toLowerCase());
    for (const m of s.matchAll(VAR_READ_RE)) read.add(m[1].toLowerCase());
  };
  for (const dir of ['entity', 'animations', 'animation_controllers', 'render_controllers', 'particles']) {
    for (const f of walk(path.join(rpv, dir))) {
      const text = fs.readFileSync(f, 'utf8');
      scan(text);
      if (dir === 'entity') {
        const j = readJson(f, { report: false });
        for (const m of Object.values(j?.['minecraft:client_entity']?.description?.materials || {})) v.materials.add(m);
      }
      if (dir === 'render_controllers') {
        const j = readJson(f, { report: false });
        for (const k of Object.keys(j?.render_controllers || {})) v.renderControllers.add(k);
      }
    }
  }
  for (const r of read) if (!assigned.has(r)) v.engineVars.add(r);
  return v;
})();
// Engine materials (RP materials/entity.material) commonly used by add-ons; vanilla client
// entities only reference a subset directly.
const KNOWN_MATERIALS = new Set([
  'entity', 'entity_alphatest', 'entity_alphablend', 'entity_emissive', 'entity_emissive_alpha',
  'entity_emissive_alpha_one_sided', 'entity_alphatest_one_sided', 'entity_custom', 'entity_nocull',
  'entity_change_color', 'entity_alphatest_change_color', 'entity_multitexture', 'entity_glint',
  'entity_alphatest_glint', 'entity_beam', 'entity_static', 'entity_flat_color_line', 'entity_loyalty_rope',
]);
const PARTICLE_VARS = new Set([
  'particle_age', 'particle_lifetime', 'particle_random_1', 'particle_random_2', 'particle_random_3', 'particle_random_4',
  'emitter_age', 'emitter_lifetime', 'emitter_random_1', 'emitter_random_2', 'emitter_random_3', 'emitter_random_4',
]);

// --------------------------------------------------------------------------- JSON schema validation
const SCHEMA_RULES = [
  [/^Shaftbreaker_(RP|BP)\/manifest\.json$/, 'general/manifest.json'],
  [/^Shaftbreaker_(RP|BP)\/texts\/languages\.json$/, 'language/languages.json'],
  [/^Shaftbreaker_RP\/entity\/.+\.json$/, 'resource/entity/entity.json'],
  [/^Shaftbreaker_RP\/animation_controllers\/.+\.json$/, 'resource/animation_controllers/animation_controller.json'],
  [/^Shaftbreaker_RP\/animations\/.+\.json$/, 'resource/animations/actor_animation.json'],
  [/^Shaftbreaker_RP\/render_controllers\/.+\.json$/, 'resource/render_controllers/render_controllers.json'],
  [/^Shaftbreaker_RP\/models\/entity\/.+\.json$/, 'resource/models/entity/model_entity.json'],
  [/^Shaftbreaker_RP\/particles\/.+\.json$/, 'resource/particles/particles.json'],
  [/^Shaftbreaker_RP\/sounds\.json$/, 'resource/sounds.json'],
  [/^Shaftbreaker_RP\/sounds\/sound_definitions\.json$/, 'resource/sounds/sound_definitions.json'],
  [/^Shaftbreaker_BP\/entities\/.+\.json$/, 'behavior/entities/entities.json'],
  [/^Shaftbreaker_BP\/spawn_rules\/.+\.json$/, 'behavior/spawn_rules/spawn_rules.json'],
  [/^Shaftbreaker_BP\/loot_tables\/.+\.json$/, 'behavior/loot_tables/loot_tables.json'],
];

let ajv = null;
const validators = new Map();
function getAjv() {
  if (ajv) return ajv;
  const Ajv = require('ajv').default || require('ajv');
  ajv = new Ajv({ strict: false, unicodeRegExp: false, allErrors: true, validateSchema: false, validateFormats: false, allowUnionTypes: true, verbose: false, logger: false });
  return ajv;
}

// Deep-copy a schema, dropping $schema/$id (Blockception uses non-URI ids that would confuse
// resolution) and rewriting refs to other files to absolute keys registered with ajv.
function prepareSchema(file, node, external) {
  if (Array.isArray(node)) return node.map((n) => prepareSchema(file, n, external));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema' || k === '$id' || k === 'id' && typeof v === 'string' && v.startsWith('#')) continue;
    if (k === '$ref' && typeof v === 'string' && !v.startsWith('#')) {
      const [target, frag = ''] = v.split('#');
      const abs = /^https?:/.test(target) ? null : path.resolve(path.dirname(file), target);
      if (abs && fs.existsSync(abs)) { external.add(abs); out[k] = `file://${abs}#${frag}`; }
      else out[k] = `unresolved://${v}`;
      continue;
    }
    out[k] = prepareSchema(file, v, external);
  }
  return out;
}

function loadSchemaInto(a, abs, seen) {
  if (seen.has(abs)) return;
  seen.add(abs);
  const external = new Set();
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const prepared = prepareSchema(abs, raw, external);
  if (!a.getSchema(`file://${abs}`)) a.addSchema(prepared, `file://${abs}`);
  for (const e of external) loadSchemaInto(a, e, seen);
}

function patchRef(node, ref) {
  if (Array.isArray(node)) { node.forEach((n) => patchRef(n, ref)); return; }
  if (!node || typeof node !== 'object') return;
  if (node.$ref && (node.$ref === ref || node.$ref.endsWith(ref))) { delete node.$ref; }
  for (const v of Object.values(node)) patchRef(v, ref);
}

function getValidator(schemaRel) {
  if (validators.has(schemaRel)) return validators.get(schemaRel);
  const abs = path.join(SCHEMAS, schemaRel);
  let fn = null;
  if (!fs.existsSync(abs)) {
    warn(null, `schema ${schemaRel} not found in ${rel(SCHEMAS)}; files of that kind are not schema-checked`);
  } else {
    const a = getAjv();
    try {
      loadSchemaInto(a, abs, new Set());
      for (let attempt = 0; attempt < 100 && !fn; attempt++) {
        try {
          fn = a.getSchema(`file://${abs}`);
        } catch (e) {
          const missing = e.missingRef || (/can't resolve reference (\S+)/.exec(e.message) || [])[1];
          if (!missing) throw e;
          warn(null, `schema ${schemaRel}: unresolved $ref ${missing.replace(/^unresolved:\/\//, '')} (treated as "any")`);
          const key = `file://${abs}`;
          const schema = a.getSchema(key)?.schema || a.schemas?.[key]?.schema;
          a.removeSchema(key);
          const copy = JSON.parse(JSON.stringify(schema || prepareSchema(abs, JSON.parse(fs.readFileSync(abs, 'utf8')), new Set())));
          patchRef(copy, missing);
          a.addSchema(copy, key);
        }
      }
    } catch (e) {
      warn(null, `schema ${schemaRel} could not be compiled (${e.message.split('\n')[0]}); skipped`);
      fn = null;
    }
  }
  validators.set(schemaRel, fn);
  return fn;
}

// Reduce ajv's oneOf/anyOf noise to the most specific messages.
function summarizeAjvErrors(list) {
  // Combinator errors only say "a branch failed"; the branch errors carry the detail.
  const specific = list.filter((e) => !['oneOf', 'anyOf', 'if', 'allOf', 'not'].includes(e.keyword));
  const depth = (e) => (e.instancePath.match(/\//g) || []).length;
  const pick = (specific.length ? specific : list).slice().sort((a, b) => depth(b) - depth(a));
  const seen = new Set();
  const out = [];
  for (const e of pick) {
    let msg = `${e.instancePath || '/'} ${e.message}`;
    if (e.keyword === 'additionalProperties') msg += ` ("${e.params.additionalProperty}")`;
    if (e.keyword === 'enum') msg += ` (${(e.params.allowedValues || []).slice(0, 12).join(', ')}${(e.params.allowedValues || []).length > 12 ? ', ...' : ''})`;
    if (e.keyword === 'const') msg += ` (${JSON.stringify(e.params.allowedValue)})`;
    if (!seen.has(msg)) { seen.add(msg); out.push(msg); }
  }
  return out;
}

function schemaCheck(file, json) {
  if (NO_SCHEMA) return;
  const r = rel(file);
  const rule = SCHEMA_RULES.find(([re]) => re.test(r));
  if (!rule) { warn(file, 'no Blockception schema mapped for this file'); return; }
  if (!fs.existsSync(SCHEMAS)) return;
  const fn = getValidator(rule[1]);
  if (!fn) return;
  if (fn(json)) { info(`  schema ok   ${r}  (${rule[1]})`); return; }
  const msgs = summarizeAjvErrors(fn.errors || []);
  for (const m of msgs.slice(0, 10)) err(file, `schema ${rule[1]}: ${m}`);
  if (msgs.length > 10) err(file, `schema: ... ${msgs.length - 10} more`);
}

// --------------------------------------------------------------------------- load packs
function loadPack(dir) {
  const files = walk(dir);
  const json = new Map();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const j = readJson(f);
    if (j !== null) json.set(f, j);
  }
  return { dir, files, json };
}

info('Shaftbreaker add-on validator');
info(`  root: ${ROOT}`);
if (!fs.existsSync(RP)) err(RP, 'resource pack folder missing');
if (!fs.existsSync(BP)) err(BP, 'behavior pack folder missing');
if (!fs.existsSync(SCHEMAS)) warn(null, `${rel(SCHEMAS)} missing: JSON-schema validation skipped`);
if (!vanilla.available) warn(null, `${rel(VANILLA)} missing: vanilla sounds/particles/textures/queries cannot be cross-checked`);

const rp = loadPack(RP);
const bp = loadPack(BP);

info('\n[1] JSON schema validation');
for (const pack of [rp, bp]) for (const [f, j] of pack.json) schemaCheck(f, j);

const inDir = (pack, sub) => [...pack.json.entries()].filter(([f]) => rel(f).startsWith(`${rel(pack.dir)}/${sub}`));

// ---- collect RP data
const clientEntities = new Map(); // id -> { file, desc }
for (const [f, j] of inDir(rp, 'entity/')) {
  const desc = j['minecraft:client_entity']?.description;
  if (!desc) { err(f, 'missing minecraft:client_entity.description'); continue; }
  if (clientEntities.has(desc.identifier)) err(f, `duplicate client entity ${desc.identifier}`);
  clientEntities.set(desc.identifier, { file: f, desc, fv: j.format_version });
}
const animations = new Map(); // full name -> { file, anim, fv }
for (const [f, j] of inDir(rp, 'animations/')) {
  for (const [name, anim] of Object.entries(j.animations || {})) {
    if (animations.has(name)) err(f, `animation ${name} is also defined in ${rel(animations.get(name).file)}`);
    animations.set(name, { file: f, anim, fv: j.format_version });
  }
}
const controllers = new Map();
for (const [f, j] of inDir(rp, 'animation_controllers/')) {
  for (const [name, ctrl] of Object.entries(j.animation_controllers || {})) {
    if (controllers.has(name)) err(f, `animation controller ${name} defined twice`);
    controllers.set(name, { file: f, ctrl });
  }
}
const geometries = new Map(); // id -> { file, geo }
for (const [f, j] of inDir(rp, 'models/')) {
  for (const g of j['minecraft:geometry'] || []) {
    const id = g.description?.identifier;
    if (!id) { err(f, 'geometry without description.identifier'); continue; }
    if (geometries.has(id)) err(f, `duplicate geometry ${id}`);
    geometries.set(id, { file: f, geo: g });
  }
  for (const k of Object.keys(j)) if (k.startsWith('geometry.')) warn(f, `legacy geometry format for ${k}; use format_version 1.12.0+ "minecraft:geometry"`);
}
const renderControllers = new Map();
for (const [f, j] of inDir(rp, 'render_controllers/')) {
  for (const [name, rc] of Object.entries(j.render_controllers || {})) renderControllers.set(name, { file: f, rc });
}
const particles = new Map();
for (const [f, j] of inDir(rp, 'particles/')) {
  const id = j.particle_effect?.description?.identifier;
  if (!id) { err(f, 'particle without description.identifier'); continue; }
  if (particles.has(id)) err(f, `duplicate particle ${id}`);
  particles.set(id, { file: f, p: j.particle_effect });
}
const soundDefsFile = path.join(RP, 'sounds', 'sound_definitions.json');
const soundDefs = new Map(Object.entries(rp.json.get(soundDefsFile)?.sound_definitions || {}));
const soundsJsonFile = path.join(RP, 'sounds.json');
const soundsJson = rp.json.get(soundsJsonFile);
const rpLang = readLang(path.join(RP, 'texts', 'en_US.lang'));
const bpLang = readLang(path.join(BP, 'texts', 'en_US.lang'));

// ---- collect BP data
const bpEntities = new Map(); // id -> { file, ent, props }
for (const [f, j] of inDir(bp, 'entities/')) {
  const ent = j['minecraft:entity'];
  const id = ent?.description?.identifier;
  if (!id) { err(f, 'missing minecraft:entity.description.identifier'); continue; }
  bpEntities.set(id, { file: f, ent, fv: j.format_version, props: ent.description.properties || {} });
}
const allProps = new Map(); // name -> def (union over BP entities)
for (const { props } of bpEntities.values()) for (const [k, d] of Object.entries(props)) allProps.set(k, d);

// --------------------------------------------------------------------------- [2] manifests
info('\n[2] Manifests');
function checkManifests() {
  const mf = (pack) => pack.json.get(path.join(pack.dir, 'manifest.json'));
  const rm = mf(rp);
  const bm = mf(bp);
  if (!rm) err(path.join(RP, 'manifest.json'), 'missing');
  if (!bm) err(path.join(BP, 'manifest.json'), 'missing');
  if (!rm || !bm) return;
  const uuids = new Map();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const [pack, m, type] of [[rp, rm, 'resources'], [bp, bm, 'data']]) {
    const f = path.join(pack.dir, 'manifest.json');
    if (m.format_version !== 2) warn(f, `format_version ${m.format_version} (expected 2)`);
    const all = [['header', m.header?.uuid], ...(m.modules || []).map((mod, i) => [`modules[${i}]`, mod.uuid])];
    for (const [where, u] of all) {
      if (!uuidRe.test(u || '')) err(f, `${where}.uuid "${u}" is not a valid uuid4`);
      if (uuids.has(u)) err(f, `${where}.uuid duplicates ${uuids.get(u)}`);
      uuids.set(u, `${rel(f)} ${where}`);
    }
    if (!(m.modules || []).some((mod) => mod.type === type)) err(f, `no module of type "${type}"`);
    for (const k of ['version', 'min_engine_version']) {
      const v = m.header?.[k];
      if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isInteger)) err(f, `header.${k} must be [major, minor, patch]`);
    }
    for (const k of ['name', 'description']) {
      const v = m.header?.[k];
      const lang = pack === rp ? rpLang : bpLang;
      if (/^pack\.(name|description)$/.test(v || '') && !lang?.has(v)) err(f, `header.${k} uses lang key ${v} which is missing from texts/en_US.lang`);
    }
    if (!fs.existsSync(path.join(pack.dir, 'pack_icon.png'))) warn(f, 'pack_icon.png missing');
  }
  const dep = (bm.dependencies || []).find((d) => d.uuid === rm.header.uuid);
  if (!dep) err(path.join(BP, 'manifest.json'), `dependencies do not include the resource pack header uuid ${rm.header.uuid}`);
  else if (JSON.stringify(dep.version) !== JSON.stringify(rm.header.version)) err(path.join(BP, 'manifest.json'), `dependency version ${JSON.stringify(dep.version)} != RP header version ${JSON.stringify(rm.header.version)}`);
  for (const d of bm.dependencies || []) if (d.uuid && d.uuid !== rm.header.uuid) warn(path.join(BP, 'manifest.json'), `extra dependency ${d.uuid}`);
  info(`  RP ${rm.header.uuid} v${rm.header.version.join('.')} (min engine ${rm.header.min_engine_version.join('.')}), BP ${bm.header.uuid} v${bm.header.version.join('.')} (min engine ${bm.header.min_engine_version.join('.')})`);
}
checkManifests();

// --------------------------------------------------------------------------- [3] lang
info('\n[3] Texts');
function checkLang() {
  for (const pack of [rp, bp]) {
    const lj = pack.json.get(path.join(pack.dir, 'texts', 'languages.json'));
    if (!lj) err(path.join(pack.dir, 'texts', 'languages.json'), 'missing');
    else for (const code of lj) if (!fs.existsSync(path.join(pack.dir, 'texts', `${code}.lang`))) err(path.join(pack.dir, 'texts', 'languages.json'), `lists ${code} but texts/${code}.lang is missing`);
  }
  if (!rpLang) { err(path.join(RP, 'texts', 'en_US.lang'), 'missing'); return; }
  for (const id of new Set([...clientEntities.keys(), ...bpEntities.keys()])) {
    for (const key of [`entity.${id}.name`, `item.spawn_egg.entity.${id}.name`]) {
      if (!rpLang.has(key)) err(path.join(RP, 'texts', 'en_US.lang'), `missing ${key}`);
      if (bpLang && !bpLang.has(key)) warn(path.join(BP, 'texts', 'en_US.lang'), `missing ${key}`);
    }
  }
  for (const [name, def] of soundDefs) if (def.subtitle && !rpLang.has(def.subtitle)) warn(soundDefsFile, `${name}: subtitle key ${def.subtitle} missing from RP en_US.lang`);
  info(`  RP en_US.lang ${rpLang.size} keys, BP en_US.lang ${bpLang ? bpLang.size : 0} keys`);
}
checkLang();

// --------------------------------------------------------------------------- [4] BP entity
info('\n[4] Behavior pack entity');
function walkObj(node, fn, p = '') {
  if (Array.isArray(node)) { node.forEach((n, i) => walkObj(n, fn, `${p}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;
  fn(node, p);
  for (const [k, v] of Object.entries(node)) walkObj(v, fn, p ? `${p}.${k}` : k);
}

function checkPropertyFilter(file, where, node, props) {
  const t = node.test;
  if (!['enum_property', 'int_property', 'bool_property', 'float_property', 'has_property'].includes(t)) return;
  const name = t === 'has_property' ? node.value : node.domain;
  const d = props[name];
  if (!d) { err(file, `${where}: filter ${t} uses undefined property ${name}`); return; }
  if (t === 'has_property') return;
  const want = { enum_property: 'enum', int_property: 'int', bool_property: 'bool', float_property: 'float' }[t];
  if (d.type !== want) err(file, `${where}: filter ${t} on ${name} which is a ${d.type} property`);
  if (t === 'enum_property' && !d.values.includes(node.value)) err(file, `${where}: "${node.value}" is not a value of ${name} (${d.values.join(', ')})`);
  if (t === 'int_property' && d.range && (node.value < d.range[0] || node.value > d.range[1])) warn(file, `${where}: ${node.value} outside ${name} range ${d.range}`);
}

function checkBpEntity(id, { file, ent, props }) {
  const events = ent.events || {};
  const groups = ent.component_groups || {};
  const ce = clientEntities.get(id);
  if (!ce) err(file, `no client entity in the RP for ${id}`);
  // property definitions
  for (const [name, d] of Object.entries(props)) {
    if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(name)) warn(file, `property ${name} should be namespaced lower_snake (ns:name)`);
    if (d.type === 'enum') {
      if (!Array.isArray(d.values) || !d.values.length) err(file, `enum property ${name} has no values`);
      else if (!d.values.includes(d.default)) err(file, `enum property ${name} default "${d.default}" not in values`);
      for (const v of d.values || []) if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(v)) err(file, `enum value "${v}" of ${name} must be an identifier of at most 32 characters`);
    }
    if (d.type === 'int' || d.type === 'float') {
      if (!Array.isArray(d.range) || d.range.length !== 2) err(file, `${d.type} property ${name} needs range [min, max]`);
      else if (typeof d.default === 'number' && (d.default < d.range[0] || d.default > d.range[1])) err(file, `property ${name} default outside range`);
    }
  }
  // client-synced properties read by the RP
  const eventRefs = [];
  const groupRefs = [];
  walkObj(ent, (node, p) => {
    if (typeof node.event === 'string' && !p.startsWith('events.') || (typeof node.event === 'string' && /\.(sequence|randomize|first_valid)\[/.test(p))) eventRefs.push([p, node.event]);
    if (p.startsWith('events.')) {
      if (typeof node.event === 'string' && !/\.trigger$/.test(p)) eventRefs.push([p, node.event]);
      if (node.trigger !== undefined) {
        for (const t of asArray(node.trigger)) eventRefs.push([`${p}.trigger`, typeof t === 'string' ? t : t.event]);
      }
      for (const k of ['add', 'remove']) for (const g of node[k]?.component_groups || []) groupRefs.push([`${p}.${k}`, g]);
      if (node.set_property) {
        for (const [name, value] of Object.entries(node.set_property)) {
          const d = props[name];
          if (!d) { err(file, `${p}.set_property: undefined property ${name}`); continue; }
          if (d.type === 'enum') {
            if (typeof value !== 'string') err(file, `${p}.set_property ${name}: enum value must be a string`);
            else if (!d.values.includes(value)) {
              // A bare word must be one of the enum values; anything else must be a real Molang expression.
              if (/^[A-Za-z0-9_]+$/.test(value)) err(file, `${p}.set_property ${name}: "${value}" is not one of ${d.values.join(', ')}`);
              else { molang(file, `${p}.set_property ${name}`, value, 'server'); warn(file, `${p}.set_property ${name}: Molang expression; its result must be one of ${d.values.join(', ')}`); }
            }
          } else {
            molang(file, `${p}.set_property ${name}`, value, 'server');
            if (typeof value === 'number' && d.range && (value < d.range[0] || value > d.range[1])) err(file, `${p}.set_property ${name}: ${value} outside range ${d.range}`);
          }
        }
      }
      if (node.play_sound?.sound) checkEntitySoundEvent(file, `${p}.play_sound`, id, node.play_sound.sound);
    }
    if (node.test) checkPropertyFilter(file, p, node, props);
  });
  for (const [p, e] of eventRefs) {
    if (!e) continue;
    if (!events[e]) (e.startsWith('minecraft:') ? warn : err)(file, `${p}: event ${e} is not defined in events`);
  }
  for (const [p, g] of groupRefs) if (!groups[g]) err(file, `${p}: component group ${g} is not defined`);
  const usedGroups = new Set(groupRefs.map(([, g]) => g));
  for (const g of Object.keys(groups)) if (!usedGroups.has(g)) warn(file, `component group ${g} is never added`);
  const usedEvents = new Set(eventRefs.map(([, e]) => e));
  for (const e of Object.keys(events)) if (!usedEvents.has(e) && !e.startsWith('minecraft:')) info(`  note: event ${e} is only reachable via /event`);
  // per-component checks (base + groups)
  const containers = [['components', ent.components || {}], ...Object.entries(groups).map(([g, c]) => [`component_groups.${g}`, c])];
  for (const [where, comps] of containers) {
    for (const [cname, c] of Object.entries(comps)) {
      const w = `${where}.${cname}`;
      if (cname === 'minecraft:break_blocks' && ids().blocks) {
        for (const b of c.breakable_blocks || []) if (!ids().blocks.has(nsId(b))) err(file, `${w}: unknown block id ${b}`);
      }
      if (cname === 'minecraft:loot' && c.table && !fs.existsSync(path.join(BP, c.table))) err(file, `${w}: loot table ${c.table} not found in BP`);
      if (cname === 'minecraft:experience_reward') for (const k of ['on_death', 'on_bred']) if (c[k] !== undefined) molang(file, `${w}.${k}`, c[k], 'server');
      if (cname === 'minecraft:ambient_sound_interval') {
        const names = [c.event_name ?? 'ambient', ...(c.event_names || []).map((x) => x.event_name)];
        for (const n of names) if (n !== 'undefined') checkEntitySoundEvent(file, w, id, n);
        for (const x of c.event_names || []) if (x.condition) molang(file, `${w}.event_names.condition`, x.condition, 'server');
      }
      if (cname === 'minecraft:collision_box' && ce) info(`  collision box ${c.width} x ${c.height}`);
    }
  }
  info(`  ${id}: ${Object.keys(groups).length} component groups, ${Object.keys(events).length} events, properties: ${Object.entries(props).map(([k, d]) => `${k}${d.client_sync ? ' (client_sync)' : ''}`).join(', ')}`);
}

function checkEntitySoundEvent(file, where, id, eventName) {
  if (!soundsJson) return;
  const ev = soundsJson.entity_sounds?.entities?.[id]?.events || {};
  if (!(eventName in ev)) warn(file, `${where}: sound event "${eventName}" has no mapping in RP sounds.json for ${id} (would use the default)`);
  if (vanilla.available && vanilla.entitySoundEvents.size && !vanilla.entitySoundEvents.has(eventName)) warn(file, `${where}: "${eventName}" is not a sound event name used by vanilla sounds.json`);
}

for (const [id, e] of bpEntities) checkBpEntity(id, e);
if (!bpEntities.size) err(path.join(BP, 'entities'), 'no entity files');

// spawn rules + loot tables
for (const [f, j] of inDir(bp, 'spawn_rules/')) {
  const sr = j['minecraft:spawn_rules'];
  const id = sr?.description?.identifier;
  if (!bpEntities.has(id)) err(f, `spawn rules for unknown entity ${id}`);
  for (const [i, cond] of (sr?.conditions || []).entries()) {
    for (const k of ['minecraft:spawns_on_block_filter', 'minecraft:spawns_on_block_prevented_filter', 'minecraft:spawns_above_block_filter']) {
      const raw = k === 'minecraft:spawns_above_block_filter' ? cond[k]?.blocks : cond[k];
      for (const b of asArray(raw)) {
        const name = typeof b === 'string' ? b : b?.name;
        if (name && ids().blocks && !ids().blocks.has(nsId(name))) err(f, `conditions[${i}].${k}: unknown block ${name}`);
      }
    }
    const hf = cond['minecraft:height_filter'];
    if (hf && (hf.min < -64 || hf.max > 320 || hf.min > hf.max)) err(f, `conditions[${i}].minecraft:height_filter out of world bounds`);
  }
  info(`  spawn rules for ${id}: ${(sr?.conditions || []).length} condition set(s)`);
}
for (const [f, j] of inDir(bp, 'loot_tables/')) {
  walkObj(j, (node, p) => {
    if (node.type === 'item' && node.name && ids().items && !ids().items.has(nsId(node.name))) err(f, `${p}: unknown item ${node.name}`);
    if (node.type === 'loot_table' && node.name && !fs.existsSync(path.join(BP, node.name))) err(f, `${p}: loot table ${node.name} not found`);
  });
}

// --------------------------------------------------------------------------- [5] client entity
info('\n[5] Client entity');
const texExists = (t) => ['.png', '.tga', '.jpg'].some((ext) => fs.existsSync(path.join(RP, t + ext)));
function textureRef(file, where, t) {
  if (texExists(t)) return true;
  if (vanilla.textures.has(t)) return true;
  if (vanilla.available) warn(file, `${where}: texture ${t} not in the RP and not found in the vanilla cache (only a few vanilla textures are cached; verify it exists in the game)`);
  else warn(file, `${where}: texture ${t} not in the RP; cannot verify vanilla textures without ${rel(VANILLA)}`);
  return false;
}

const animFilesPresent = animations.size > 0;
const geoPresent = geometries.size > 0;
if (!animFilesPresent) warn(path.join(RP, 'animations'), 'no animation files yet: animation, bone and timeline-effect checks are skipped');
if (!geoPresent) warn(path.join(RP, 'models', 'entity'), 'no geometry yet: bone, locator and UV checks are skipped');

function entityGeos(desc) { return Object.values(desc.geometry || {}).map((g) => geometries.get(g)).filter(Boolean); }

function checkClientEntity(id, { file, desc, fv }) {
  if (!bpEntities.has(id)) err(file, `no behavior entity ${id} in the BP`);
  if (fv !== '1.10.0') warn(file, `format_version ${fv} (SPEC expects 1.10.0)`);
  for (const [k, m] of Object.entries(desc.materials || {})) {
    if (!KNOWN_MATERIALS.has(m) && !vanilla.materials.has(m)) warn(file, `materials.${k}: "${m}" is not a known vanilla entity material`);
  }
  for (const [k, t] of Object.entries(desc.textures || {})) {
    if (!texExists(t)) (vanilla.textures.has(t) ? () => {} : (t.includes('shaftbreaker') ? warn : err))(file, `textures.${k}: ${t}.png not found${t.includes('shaftbreaker') ? ' (generated by tools/build_model.py)' : ''}`);
  }
  for (const [k, g] of Object.entries(desc.geometry || {})) {
    if (!geometries.has(g)) (geoPresent ? err : warn)(file, `geometry.${k}: ${g} not found in RP/models${geoPresent ? '' : ' (not generated yet)'}`);
  }
  for (const rc of desc.render_controllers || []) {
    const name = typeof rc === 'string' ? rc : Object.keys(rc)[0];
    if (typeof rc === 'object') molang(file, `render_controllers.${name}`, Object.values(rc)[0]);
    if (!renderControllers.has(name) && !vanilla.renderControllers.has(name)) err(file, `render controller ${name} not defined`);
  }
  const anims = desc.animations || {};
  for (const [short, full] of Object.entries(anims)) {
    if (full.startsWith('controller.animation.')) { if (!controllers.has(full)) err(file, `animations.${short}: controller ${full} not defined`); }
    else if (!animations.has(full)) (animFilesPresent ? err : warn)(file, `animations.${short}: ${full} not defined${animFilesPresent ? '' : ' (animation files not present yet)'}`);
  }
  for (const [short, full] of Object.entries(SPEC_ANIMATIONS)) {
    if (anims[short] !== full) err(file, `SPEC §7: animations.${short} must be "${full}" (found ${anims[short] ? `"${anims[short]}"` : 'nothing'})`);
  }
  const s = desc.scripts || {};
  for (const [i, line] of (s.initialize || []).entries()) molang(file, `scripts.initialize[${i}]`, line);
  for (const [i, line] of (s.pre_animation || []).entries()) molang(file, `scripts.pre_animation[${i}]`, line);
  for (const k of ['scale', 'scalex', 'scaley', 'scalez', 'should_update_effects_offscreen', 'should_update_bones_and_effects_offscreen']) if (s[k] !== undefined) molang(file, `scripts.${k}`, s[k]);
  for (const entry of s.animate || []) {
    const [name, weight] = typeof entry === 'string' ? [entry, null] : Object.entries(entry)[0];
    if (!anims[name]) err(file, `scripts.animate: "${name}" is not a key of animations`);
    if (weight !== null) molang(file, `scripts.animate.${name}`, weight);
  }
  for (const [k, pid] of Object.entries(desc.particle_effects || {})) {
    if (!particles.has(pid) && !vanilla.particles.has(pid)) err(file, `particle_effects.${k}: particle ${pid} not defined (RP or vanilla)`);
  }
  for (const [k, sid] of Object.entries(desc.sound_effects || {})) {
    if (!soundDefs.has(sid) && !vanilla.soundDefs.has(sid)) err(file, `sound_effects.${k}: sound event ${sid} not defined (RP sound_definitions or vanilla)`);
  }
  const egg = desc.spawn_egg;
  if (egg) for (const k of ['base_color', 'overlay_color']) if (egg[k] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(egg[k])) err(file, `spawn_egg.${k} must be #rrggbb`);
  // texture density (SPEC §3: PNG = 4x declared size)
  for (const g of entityGeos(desc)) {
    for (const t of Object.values(desc.textures || {})) {
      const png = path.join(RP, `${t}.png`);
      if (!fs.existsSync(png)) continue;
      const sz = pngSize(png);
      const tw = g.geo.description.texture_width;
      const th = g.geo.description.texture_height;
      if (!sz) { err(png, 'not a PNG'); continue; }
      const kx = sz.w / tw;
      const ky = sz.h / th;
      if (kx !== ky || !Number.isInteger(kx)) err(png, `${sz.w}x${sz.h} is not an integer multiple of the declared ${tw}x${th} (UVs would be distorted)`);
      else if (kx !== 4) warn(png, `${sz.w}x${sz.h} is ${kx}x the declared ${tw}x${th} (SPEC §3 expects 4x)`);
      else info(`  texture ${rel(png)} ${sz.w}x${sz.h} = 4 x ${tw}x${th}`);
    }
  }
  info(`  ${id}: ${Object.keys(anims).length} animation entries, ${(s.animate || []).length} animate entries, scale ${s.scale}`);
}
for (const [id, ce] of clientEntities) checkClientEntity(id, ce);
if (!clientEntities.size) err(path.join(RP, 'entity'), 'no client entity files');

// Which client entities reference an animation / controller (by full name)
function referencers(fullName) {
  const out = [];
  for (const [id, ce] of clientEntities) for (const [short, full] of Object.entries(ce.desc.animations || {})) if (full === fullName) out.push({ id, ce, short });
  return out;
}

// --------------------------------------------------------------------------- [6] animation controllers
info('\n[6] Animation controllers');
function checkStateEffects(file, where, state, ce) {
  for (const pe of state.particle_effects || []) {
    if (!ce.desc.particle_effects?.[pe.effect]) err(file, `${where}.particle_effects: effect ${pe.effect} not defined in the client entity`);
    if (pe.pre_effect_script) molang(file, `${where}.pre_effect_script`, pe.pre_effect_script);
  }
  for (const se of state.sound_effects || []) if (!ce.desc.sound_effects?.[se.effect]) err(file, `${where}.sound_effects: effect ${se.effect} not defined in the client entity`);
}
for (const [name, { file, ctrl }] of controllers) {
  const refs = referencers(name);
  if (!refs.length) warn(file, `${name} is not referenced by any client entity`);
  const states = ctrl.states || {};
  const initial = ctrl.initial_state || 'default';
  if (!states[initial]) err(file, `${name}: initial_state "${initial}" is not a state`);
  for (const [sname, st] of Object.entries(states)) {
    const w = `${name}.states.${sname}`;
    for (const a of st.animations || []) {
      const [short, weight] = typeof a === 'string' ? [a, null] : Object.entries(a)[0];
      for (const { ce } of refs) if (!ce.desc.animations?.[short]) err(file, `${w}: animation "${short}" is not in the client entity animations map`);
      if (weight !== null) molang(file, `${w}.animations.${short}`, weight);
    }
    for (const t of st.transitions || []) {
      const [target, cond] = Object.entries(t)[0];
      if (!states[target]) err(file, `${w}: transition to undefined state "${target}"`);
      molang(file, `${w}.transitions.${target}`, cond);
    }
    for (const k of ['on_entry', 'on_exit']) for (const [i, line] of (st[k] || []).entries()) molang(file, `${w}.${k}[${i}]`, line);
    if (st.blend_transition !== undefined && typeof st.blend_transition === 'number' && st.blend_transition < 0) err(file, `${w}: negative blend_transition`);
    for (const { ce } of refs) checkStateEffects(file, w, st, ce);
    const reachable = Object.values(states).some((o) => (o.transitions || []).some((t) => Object.keys(t)[0] === sname));
    if (sname !== initial && !reachable) warn(file, `${w}: state is unreachable`);
  }
  info(`  ${name}: ${Object.keys(states).length} states (initial ${initial})`);
}

// --------------------------------------------------------------------------- [7] animations
info('\n[7] Animations');
const CHANNELS = ['rotation', 'position', 'scale'];
function checkChannel(file, where, ch, isRot) {
  if (Array.isArray(ch) || typeof ch !== 'object' || ch === null) {
    for (const v of asArray(ch)) molang(file, where, v);
    return;
  }
  let catm = 0;
  let total = 0;
  for (const [t, kf] of Object.entries(ch)) {
    if (!Number.isFinite(parseFloat(t))) err(file, `${where}: keyframe time "${t}" is not a number`);
    total++;
    const parts = kf && typeof kf === 'object' && !Array.isArray(kf) ? kf : { post: kf };
    if (parts.lerp_mode === 'catmullrom') catm++;
    if (parts.lerp_mode && !['linear', 'catmullrom', 'step'].includes(parts.lerp_mode)) err(file, `${where}@${t}: unknown lerp_mode ${parts.lerp_mode}`);
    for (const k of ['pre', 'post']) if (parts[k] !== undefined) for (const v of asArray(parts[k])) molang(file, `${where}@${t}${parts === kf ? '.' + k : ''}`, v);
  }
  if (catm && catm !== total) warn(file, `${where}: lerp_mode catmullrom on ${catm}/${total} keyframes (SPEC §7: all or none)`);
}
for (const [full, { file, anim, fv }] of animations) {
  const refs = referencers(full);
  if (!refs.length) warn(file, `${full} is not referenced by any client entity`);
  if (fv !== '1.8.0') warn(file, `format_version ${fv} (SPEC expects 1.8.0)`);
  const w = full;
  for (const k of ['anim_time_update', 'blend_weight', 'start_delay', 'loop_delay']) if (anim[k] !== undefined) molang(file, `${w}.${k}`, anim[k]);
  if (anim.loop !== undefined && ![true, false, 'hold_on_last_frame'].includes(anim.loop)) err(file, `${w}.loop must be true, false or "hold_on_last_frame"`);
  for (const [t, lines] of Object.entries(anim.timeline || {})) for (const l of asArray(lines)) molang(file, `${w}.timeline@${t}`, l);
  const geos = refs.flatMap(({ ce }) => entityGeos(ce.desc));
  const boneSet = new Map();
  const locSet = new Set();
  for (const g of geos) {
    for (const b of g.geo.bones || []) {
      boneSet.set(b.name, true);
      for (const l of Object.keys(b.locators || {})) locSet.add(l);
    }
  }
  const lowerBones = new Map([...boneSet.keys()].map((b) => [b.toLowerCase(), b]));
  for (const [bone, chans] of Object.entries(anim.bones || {})) {
    if (geos.length) {
      if (!boneSet.has(bone)) {
        if (lowerBones.has(bone.toLowerCase())) warn(file, `${w}: bone "${bone}" differs in case from geometry bone "${lowerBones.get(bone.toLowerCase())}"`);
        else err(file, `${w}: bone "${bone}" does not exist in the geometry`);
      }
    }
    for (const c of Object.keys(chans || {})) if (!CHANNELS.includes(c) && c !== 'relative_to') warn(file, `${w}.bones.${bone}: unknown channel ${c}`);
    for (const c of CHANNELS) if (chans?.[c] !== undefined) checkChannel(file, `${w}.bones.${bone}.${c}`, chans[c], c === 'rotation');
  }
  for (const [kind, key] of [['particle_effects', 'particle_effects'], ['sound_effects', 'sound_effects']]) {
    for (const [t, evs] of Object.entries(anim[kind] || {})) {
      for (const ev of asArray(evs)) {
        const where = `${w}.${kind}@${t}`;
        if (!Number.isFinite(parseFloat(t))) err(file, `${where}: time is not a number`);
        for (const { ce } of refs) if (!ce.desc[key]?.[ev.effect]) err(file, `${where}: effect "${ev.effect}" is not defined in the client entity ${key}`);
        if (ev.locator) {
          if (geos.length && !locSet.has(ev.locator)) err(file, `${where}: locator "${ev.locator}" does not exist in the geometry`);
        }
        if (ev.pre_effect_script) molang(file, `${where}.pre_effect_script`, ev.pre_effect_script);
      }
    }
  }
  const len = anim.animation_length;
  if (len !== undefined && !(typeof len === 'number' && len > 0)) err(file, `${w}.animation_length must be a positive number`);
}
info(`  ${animations.size} animations in ${new Set([...animations.values()].map((a) => a.file)).size} file(s)`);

// --------------------------------------------------------------------------- [8] geometry
info('\n[8] Geometry');
for (const [gid, { file, geo }] of geometries) {
  const d = geo.description;
  const tw = d.texture_width;
  const th = d.texture_height;
  if (!(tw > 0 && th > 0)) err(file, `${gid}: texture_width/texture_height must be positive`);
  const names = new Map();
  let cubes = 0;
  let uvErrors = 0;
  const locators = new Set();
  for (const b of geo.bones || []) {
    if (names.has(b.name.toLowerCase())) err(file, `${gid}: duplicate bone ${b.name}`);
    names.set(b.name.toLowerCase(), b);
  }
  for (const b of geo.bones || []) {
    if (b.parent && !names.has(b.parent.toLowerCase())) err(file, `${gid}: bone ${b.name} has unknown parent ${b.parent}`);
    for (const l of Object.keys(b.locators || {})) {
      if (locators.has(l)) err(file, `${gid}: duplicate locator ${l}`);
      locators.add(l);
    }
    for (const [i, c] of (b.cubes || []).entries()) {
      cubes++;
      if (!Array.isArray(c.size) || c.size.some((x) => x < 0)) { err(file, `${gid}: ${b.name}.cubes[${i}] invalid size`); continue; }
      if (c.uv === undefined) { warn(file, `${gid}: ${b.name}.cubes[${i}] has no uv`); continue; }
      const rects = faceRects(c);
      for (const [face, r] of Object.entries(rects)) {
        const u0 = Math.min(r[0], r[2]);
        const u1 = Math.max(r[0], r[2]);
        const v0 = Math.min(r[1], r[3]);
        const v1 = Math.max(r[1], r[3]);
        const eps = 1e-6;
        if (u0 < -eps || v0 < -eps || u1 > tw + eps || v1 > th + eps) {
          if (uvErrors++ < 12) err(file, `${gid}: ${b.name}.cubes[${i}].${face} UV [${u0}, ${v0}]..[${u1}, ${v1}] lies outside ${tw}x${th}`);
        }
      }
    }
  }
  if (uvErrors > 12) err(file, `${gid}: ... ${uvErrors - 12} more UV rects outside the texture`);
  const missingBones = SPEC_BONES.filter((n) => !names.has(n));
  if (missingBones.length) err(file, `${gid}: SPEC §4 bones missing: ${missingBones.join(', ')}`);
  const missingLoc = SPEC_LOCATORS.filter((n) => !locators.has(n));
  if (missingLoc.length) err(file, `${gid}: SPEC §4 locators missing: ${missingLoc.join(', ')}`);
  const referenced = [...clientEntities.values()].some((ce) => Object.values(ce.desc.geometry || {}).includes(gid));
  if (!referenced) warn(file, `${gid} is not used by any client entity`);
  info(`  ${gid}: ${geometries.get(gid).geo.bones?.length || 0} bones, ${cubes} cubes, ${locators.size} locators, texture ${tw}x${th}`);
}

// --------------------------------------------------------------------------- [9] render controllers
info('\n[9] Render controllers');
for (const [name, { file, rc }] of renderControllers) {
  const users = [...clientEntities.values()].filter((ce) => (ce.desc.render_controllers || []).some((r) => (typeof r === 'string' ? r : Object.keys(r)[0]) === name));
  if (!users.length) warn(file, `${name} is not used by any client entity`);
  const refCheck = (where, expr, kind, mapKey) => {
    molang(file, where, expr);
    for (const m of String(expr).matchAll(new RegExp(`\\b${kind}\\.([a-z0-9_]+)`, 'gi'))) {
      for (const ce of users) if (!ce.desc[mapKey]?.[m[1]]) err(file, `${where}: ${kind}.${m[1]} is not defined in ${rel(ce.file)} ${mapKey}`);
    }
  };
  if (rc.geometry) refCheck(`${name}.geometry`, rc.geometry, 'Geometry', 'geometry');
  for (const m of rc.materials || []) for (const [bone, expr] of Object.entries(m)) refCheck(`${name}.materials.${bone}`, expr, 'Material', 'materials');
  for (const t of rc.textures || []) refCheck(`${name}.textures`, t, 'Texture', 'textures');
  for (const k of ['is_hurt_color', 'on_fire_color', 'overlay_color', 'color']) {
    if (rc[k]) for (const v of Object.values(rc[k])) molang(file, `${name}.${k}`, v);
  }
  info(`  ${name}: used by ${users.map((u) => u.desc.identifier).join(', ') || 'nobody'}`);
}

// --------------------------------------------------------------------------- [10] particles
info('\n[10] Particles');
const PARTICLE_ENUM_KEYS = new Set(['facing_camera_mode', 'mode', 'plane_normal', 'material', 'texture', 'identifier', 'event', 'events']);
const PARTICLE_ENUM_STRINGS = new Set(['outwards', 'inwards', 'x', 'y', 'z']);
for (const [pid, { file, p }] of particles) {
  const tex = p.description?.basic_render_parameters?.texture;
  if (tex) textureRef(file, 'basic_render_parameters.texture', tex);
  walkObj(p.components || {}, (node, where) => {
    for (const [k, v] of Object.entries(node)) {
      if (PARTICLE_ENUM_KEYS.has(k)) continue;
      const vals = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : typeof v === 'string' ? [v] : [];
      for (const s of vals) if (!PARTICLE_ENUM_STRINGS.has(s)) molang(file, `components.${where ? where + '.' : ''}${k}`, s, 'particle');
    }
  });
  if (!pid.includes(':')) err(file, `identifier ${pid} must be namespaced`);
  const used = [...clientEntities.values()].some((ce) => Object.values(ce.desc.particle_effects || {}).includes(pid));
  if (!used) warn(file, `${pid} is not used by any client entity`);
  info(`  ${pid}: texture ${tex}`);
}

// --------------------------------------------------------------------------- [11] sounds
info('\n[11] Sounds');
const soundExists = (name) => soundDefs.has(name) || vanilla.soundDefs.has(name);
if (soundsJson) {
  for (const [ent, def] of Object.entries(soundsJson.entity_sounds?.entities || {})) {
    if (!bpEntities.has(ent) && !clientEntities.has(ent)) warn(soundsJsonFile, `entity_sounds.entities.${ent}: no such custom entity`);
    for (const [ev, v] of Object.entries(def.events || {})) {
      const name = typeof v === 'string' ? v : v.sound;
      if (name && !soundExists(name)) err(soundsJsonFile, `${ent}.events.${ev}: sound event ${name} is not defined (RP sound_definitions or vanilla)`);
      if (vanilla.entitySoundEvents.size && !vanilla.entitySoundEvents.has(ev)) warn(soundsJsonFile, `${ent}.events.${ev}: "${ev}" is not a level sound event name used by vanilla`);
    }
    for (const req of ['hurt', 'death', 'step', 'ambient']) if (!def.events?.[req]) warn(soundsJsonFile, `${ent}: no "${req}" sound`);
  }
}
for (const [name, def] of soundDefs) {
  if (!name.includes('.')) warn(soundDefsFile, `${name}: use a dotted, namespaced event name`);
  if (vanilla.soundDefs.has(name)) warn(soundDefsFile, `${name} overrides a vanilla sound event`);
  for (const s of def.sounds || []) {
    const file = typeof s === 'string' ? s : s.name;
    const local = ['.ogg', '.wav', '.fsb'].some((ext) => fs.existsSync(path.join(RP, file + ext)));
    if (!local && vanilla.available && !vanilla.soundFiles.has(file)) err(soundDefsFile, `${name}: sound file ${file} is neither in the RP nor used by vanilla sound_definitions`);
  }
}
const usedSoundDefs = new Set();
for (const ce of clientEntities.values()) for (const s of Object.values(ce.desc.sound_effects || {})) usedSoundDefs.add(s);
for (const def of Object.values(soundsJson?.entity_sounds?.entities || {})) for (const v of Object.values(def.events || {})) usedSoundDefs.add(typeof v === 'string' ? v : v.sound);
for (const name of soundDefs.keys()) if (!usedSoundDefs.has(name)) warn(soundDefsFile, `${name} is not used`);
info(`  ${soundDefs.size} sound definitions, ${Object.keys(soundsJson?.entity_sounds?.entities || {}).length} entity sound set(s)`);

// --------------------------------------------------------------------------- [12] Molang semantics
info('\n[12] Molang references');
{
  const assigned = new Set();
  for (const u of molangUses) for (const m of u.src.matchAll(VAR_WRITE_RE)) assigned.add(m[1].toLowerCase());
  const reported = new Set();
  for (const u of molangUses) {
    for (const m of u.src.matchAll(QUERY_RE)) {
      const q = m[1].toLowerCase();
      if (u.side === 'server') continue;
      if (vanilla.queries.size && !vanilla.queries.has(q) && !reported.has('q' + q)) {
        reported.add('q' + q);
        warn(u.file, `${u.where}: query.${q} is not used anywhere in vanilla client files; check the spelling`);
      }
    }
    for (const m of u.src.matchAll(VAR_READ_RE)) {
      const v = m[1].toLowerCase();
      if (u.side === 'particle' && (PARTICLE_VARS.has(v) || v.startsWith('emitter_') || v.startsWith('particle_'))) continue;
      if (u.side === 'server') continue;
      if (assigned.has(v) || vanilla.engineVars.has(v) || v === 'attack_time') continue;
      if (!reported.has('v' + v)) { reported.add('v' + v); warn(u.file, `${u.where}: variable.${v} is read but never assigned`); }
    }
    for (const re of PROP_CMP_RES) {
      for (const m of u.src.matchAll(re)) {
        const [name, value] = re === PROP_CMP_RES[0] ? [m[1], m[2]] : [m[2], m[1]];
        const d = allProps.get(name);
        if (!d) { err(u.file, `${u.where}: q.property('${name}') is not a property of any BP entity`); continue; }
        if (d.type !== 'enum') err(u.file, `${u.where}: compares ${name} (${d.type}) with a string`);
        else if (!d.values.includes(value)) err(u.file, `${u.where}: '${value}' is not a value of ${name} (${d.values.join(', ')})`);
      }
    }
    for (const m of u.src.matchAll(/(?:query|q)\.property\(\s*'([^']+)'\s*\)/gi)) {
      const d = allProps.get(m[1]);
      if (!d) err(u.file, `${u.where}: q.property('${m[1]}') is not defined in the BP`);
      else if (u.side !== 'server' && !d.client_sync) err(u.file, `${u.where}: property ${m[1]} is read on the client but is not client_sync`);
    }
  }
  info(`  ${molangUses.length} Molang expressions parsed`);
}

// --------------------------------------------------------------------------- summary
console.log('');
for (const w of warnings) console.log(`WARN   ${w}`);
for (const e of errors) console.log(`ERROR  ${e}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length || (STRICT && warnings.length) ? 1 : 0);
