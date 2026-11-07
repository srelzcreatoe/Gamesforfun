// Generates data/catalog.json and data/vanilla.json from the official Bedrock
// metadata published in Mojang/bedrock-samples (metadata/ folder).
//
// Only STRUCTURAL facts are extracted (component ids, field names, value types,
// defaults, enum options and vanilla identifiers) so the editor can build forms
// for every entity component the game understands. No documentation prose is
// copied; the app links to the public Microsoft Learn reference instead.
//
// Usage: node tools/gen-catalog.mjs [path/to/bedrock-samples/metadata] [samplesRoot]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const META = process.argv[2] || process.env.BEDROCK_META || '/home/user/mojang/bedrock-samples/metadata';
const SAMPLES = process.argv[3] || path.resolve(META, '..');
const OUT = path.resolve(HERE, '../data');
const SCHEMA_ROOT = path.join(META, 'json_schemas');

// Pick the newest released (non-beta) server entity schema version.
const entityVersions = fs.readdirSync(path.join(SCHEMA_ROOT, 'server/entity'))
  .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
  .sort((a, b) => cmpVer(a, b));
const VER = entityVersions[entityVersions.length - 1];

function cmpVer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const cache = new Map();
function load(file) {
  if (!cache.has(file)) cache.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
  return cache.get(file);
}
function resolveRef(fromFile, ref) {
  const [p, frag] = ref.split('#');
  const file = p ? path.resolve(path.dirname(fromFile), decodeURIComponent(p)) : fromFile;
  let node = load(file);
  if (frag) for (const part of frag.split('/').filter(Boolean)) node = node[part];
  return { file, node };
}
const base = (f) => path.basename(f, '.json');

// Shared sub-schemas mapped to dedicated editor widgets.
const SPECIAL = {
  'Filter Group': { t: 'f' },
  'Filter Group Map': { t: 'f' },
  'Filter Test': { t: 'f' },
  ActorDefinitionTrigger: { t: 'tr' },
  FloatRange: { t: 'fr' },
  IntRange: { t: 'ir' },
  vec3: { t: 'v3' },
  Vec2: { t: 'v2' },
  'Expression Node': { t: 'm' },
  'Molang string': { t: 'm' },
  'Molang expression (object representation)': { t: 'm' },
  'Item Descriptor': { t: 'item' },
  'Block Descriptor': { t: 'block' },
  'Block Specifier': { t: 'block' },
  BlockDescriptorProxy: { t: 'block' },
  'Reference 0': { t: 'block' },
  LevelSoundEvent: { t: 'e', o: '@soundEvents' },
  ActorDamageCause: { t: 'e', o: '@causes' },
  'Color255RGB': { t: 'col' },
  hashed_string: { t: 's' },
};

function cleanDefault(d) {
  if (d === undefined || d === null) return undefined;
  if (d === 'undefined') return undefined;
  if (typeof d === 'number') return Number.isInteger(d) ? d : Number(d.toPrecision(6));
  if (Array.isArray(d)) return d.map(cleanDefault).filter((v) => v !== undefined);
  if (typeof d === 'object') {
    const vals = Object.values(d);
    if (vals.length && vals.every((v) => v === null)) return undefined; // empty filter
    const out = {};
    for (const [k, v] of Object.entries(d)) { const c = cleanDefault(v); if (c !== undefined) out[k] = c; }
    return out;
  }
  return d;
}

function conv(node, file, depth, seen) {
  if (!node || typeof node !== 'object') return { t: 'j' };
  if (depth > 7) return { t: 'j' };
  if (node.$ref) {
    const r = resolveRef(file, node.$ref);
    const b = base(r.file);
    if (SPECIAL[b]) return { ...SPECIAL[b] };
    if (seen.has(r.file)) return { t: 'j' };
    const s2 = new Set(seen); s2.add(r.file);
    return conv(r.node, r.file, depth + 1, s2);
  }
  if (Array.isArray(node.enum)) return { t: 'e', o: node.enum };
  const alts = node.oneOf || node.anyOf;
  if (alts) {
    const specs = alts.map((a) => conv(a, file, depth + 1, seen)).filter((s) => s.t !== 'j' || alts.length === 1);
    const uniq = [];
    for (const s of specs) if (!uniq.some((u) => JSON.stringify(u) === JSON.stringify(s))) uniq.push(s);
    if (uniq.length === 0) return { t: 'j' };
    if (uniq.length === 1) return uniq[0];
    // Prefer the richest representation first: list of objects > object > list > scalar.
    const rank = { ol: 0, o: 1, tr: 1, f: 1, fr: 2, ir: 2, v3: 2, l: 3, item: 4, block: 4, m: 5, e: 5, n: 6, i: 6, s: 7, b: 7, j: 9 };
    uniq.sort((a, b) => (rank[a.t] ?? 8) - (rank[b.t] ?? 8));
    return { t: 'alt', a: uniq };
  }
  const type = node.type;
  if (Array.isArray(type)) {
    return { t: 'alt', a: type.map((tp) => conv({ ...node, type: tp }, file, depth + 1, seen)) };
  }
  switch (type) {
    case 'boolean': return { t: 'b' };
    case 'integer': return withMinMax({ t: 'i' }, node);
    case 'number': return withMinMax({ t: 'n' }, node);
    case 'string': return { t: 's' };
    case 'array': {
      const it = node.items ? conv(node.items, file, depth + 1, seen) : { t: 's' };
      if (it.t === 'o') return { t: 'ol', f: it.f };
      if (Array.isArray(node.items) || node.minItems === 2 && node.maxItems === 2 && it.t === 'n') return { t: 'ar' };
      return { t: 'l', it };
    }
    case 'object':
    default: {
      if (node.properties) return { t: 'o', f: fields(node.properties, file, depth, seen, node.required) };
      if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        return { t: 'map', v: conv(node.additionalProperties, file, depth + 1, seen) };
      }
      return { t: 'j' };
    }
  }
}
function withMinMax(spec, node) {
  if (typeof node.minimum === 'number') spec.min = node.minimum;
  if (typeof node.maximum === 'number') spec.max = node.maximum;
  return spec;
}
function fields(props, file, depth, seen, required) {
  const entries = Object.entries(props)
    .filter(([k]) => k !== 'control_flags')
    .sort((a, b) => (a[1]['x-ordinal-index'] ?? 99) - (b[1]['x-ordinal-index'] ?? 99));
  return entries.map(([k, p]) => {
    const spec = { k, ...conv(p, file, depth + 1, seen) };
    const d = cleanDefault(p.default);
    if (d !== undefined && spec.t !== 'f') spec.d = d;
    if (typeof p.minimum === 'number' && spec.min === undefined) spec.min = p.minimum;
    if (typeof p.maximum === 'number' && spec.max === undefined) spec.max = p.maximum;
    if (required && required.includes(k)) spec.req = 1;
    return spec;
  });
}

// ---- Documentation-module fallback (structure only) ----
function parseDocDefault(s, t) {
  if (s === undefined) return undefined;
  const str = String(s).trim();
  if (str === '' || str === 'NaN' || str === 'not set') return undefined;
  if (t === 'b') return str === 'true' ? true : str === 'false' ? false : undefined;
  if (t === 'n' || t === 'i') { const n = Number(str); return Number.isFinite(n) ? n : undefined; }
  if (t === 'ar' || t === 'v3' || t === 'v2' || t === 'l') {
    try { const v = JSON.parse(str.replace(/'/g, '"')); return Array.isArray(v) ? v : undefined; } catch { return undefined; }
  }
  if (t === 's' || t === 'e' || t === 'm') return str.replace(/^"|"$/g, '');
  return undefined;
}
function convDoc(n) {
  const kids = (n.nodes || []).filter((c) => c.name);
  const typed = kids.filter((c) => c.type);
  let spec;
  switch (n.type) {
    case 'Decimal': spec = { t: 'n' }; break;
    case 'Integer': case 'Positive Integer': spec = { t: 'i' }; break;
    case 'Boolean': spec = { t: 'b' }; break;
    case 'String':
    case 'Enumerator':
      spec = kids.length && !typed.length ? { t: 'e', o: kids.map((c) => c.name) } : { t: 's' };
      break;
    case 'List': case 'Array':
      spec = typed.length ? { t: 'ol', f: typed.map(docField) } : { t: 'l', it: { t: 's' } };
      break;
    case 'JSON Object':
      spec = typed.length ? { t: 'o', f: typed.map(docField) } : { t: 'j' };
      break;
    case 'Minecraft Filter': spec = { t: 'f' }; break;
    case 'Trigger': spec = { t: 'tr' }; break;
    case 'Range [a, b]': spec = { t: 'ar' }; break;
    case 'Vector [a, b, c]': spec = { t: 'v3' }; break;
    case 'Vector [a, b]': spec = { t: 'v2' }; break;
    case 'Molang': spec = { t: 'm' }; break;
    default: spec = typed.length ? { t: 'o', f: typed.map(docField) } : { t: 'j' };
  }
  return spec;
}
function docField(n) {
  const spec = { k: n.name, ...convDoc(n) };
  const d = parseDocDefault(n.default, spec.t);
  if (d !== undefined) spec.d = d;
  return spec;
}

// ---- Hand-written specs for components with no published structure ----
const VALUE_MAX = [{ k: 'value', t: 'n', d: 1 }, { k: 'max', t: 'n' }];
const HAND = {
  'minecraft:health': [{ k: 'value', t: 'alt', a: [{ t: 'i' }, { t: 'o', f: [{ k: 'range_min', t: 'i' }, { k: 'range_max', t: 'i' }] }], d: 20 }, { k: 'max', t: 'i', d: 20 }],
  'minecraft:movement': [{ k: 'value', t: 'n', d: 0.25 }, { k: 'max', t: 'n' }],
  'minecraft:underwater_movement': [{ k: 'value', t: 'n', d: 0.02 }],
  'minecraft:lava_movement': [{ k: 'value', t: 'n', d: 0.02 }],
  'minecraft:follow_range': [{ k: 'value', t: 'i', d: 16 }, { k: 'max', t: 'i' }],
  'minecraft:knockback_resistance': [{ k: 'value', t: 'n', d: 0, min: 0, max: 1 }, { k: 'max', t: 'n' }],
  'minecraft:luck': VALUE_MAX,
  'minecraft:attack_damage': [{ k: 'value', t: 'n', d: 2 }],
  'minecraft:absorption': VALUE_MAX,
  'minecraft:friction_modifier': [{ k: 'value', t: 'n', d: 1 }],
  'minecraft:air_drag_modifier': [{ k: 'value', t: 'n', d: 1 }],
  'minecraft:bounciness': [{ k: 'value', t: 'n', d: 0 }],
  'minecraft:horse.jump_strength': [{ k: 'value', t: 'alt', a: [{ t: 'n' }, { t: 'o', f: [{ k: 'range_min', t: 'n' }, { k: 'range_max', t: 'n' }] }], d: 0.7 }],
  'minecraft:dweller': [
    { k: 'dwelling_type', t: 'e', o: ['village'], d: 'village' },
    { k: 'dweller_role', t: 'e', o: ['inhabitant', 'defender', 'hostile', 'passive'], d: 'inhabitant' },
    { k: 'preferred_profession', t: 's' },
    { k: 'update_interval_base', t: 'n', d: 60 },
    { k: 'update_interval_variant', t: 'n', d: 40 },
    { k: 'can_find_poi', t: 'b', d: false },
    { k: 'can_migrate', t: 'b', d: false },
    { k: 'first_founding_reward', t: 'i', d: 0 },
  ],
  'minecraft:movement.dolphin': [],
  'minecraft:balloonable': [
    { k: 'soft_distance', t: 'n', d: 2 }, { k: 'max_distance', t: 'n', d: 10 }, { k: 'mass', t: 'n', d: 1 },
    { k: 'on_balloon', t: 'tr' }, { k: 'on_unballoon', t: 'tr' },
  ],
};

// ---- Build the component catalog ----
const defsFile = path.join(SCHEMA_ROOT, `server/entity/${VER}/Entity component definitions.json`);
const defs = load(defsFile);
const docRoot = load(path.join(META, 'doc_modules/entities.json'));
const serverDoc = docRoot.nodes.find((n) => n.name === 'Server Entity Documentation');
const docIndex = {};
for (const sec of serverDoc.nodes) {
  for (const n of sec.nodes || []) {
    const id = (n.name || '').split(' ')[0];
    if (id.startsWith('minecraft:')) docIndex[id] = { sec: sec.name, node: n };
  }
}

const components = {};
const stats = { schema: 0, doc: 0, hand: 0, opaque: 0 };
for (const [id, entry] of Object.entries(defs.properties)) {
  let f, src;
  if (entry.$ref) {
    const r = resolveRef(defsFile, entry.$ref);
    const s = conv(r.node, r.file, 0, new Set([r.file]));
    f = s.t === 'o' ? s.f : s.t === 'alt' && s.a.find((x) => x.t === 'o') ? s.a.find((x) => x.t === 'o').f : [];
    src = 'schema';
  } else if (docIndex[id]) {
    f = (docIndex[id].node.nodes || []).filter((c) => c.type).map(docField);
    src = 'doc';
  } else if (HAND[id]) {
    f = HAND[id]; src = 'hand';
  } else {
    f = null; src = 'opaque';
  }
  // Behaviors always take a priority even when the doc table omits it.
  if (id.startsWith('minecraft:behavior.') && f && !f.some((x) => x.k === 'priority')) f.unshift({ k: 'priority', t: 'i', d: 0, min: 0 });
  if (f) {
    const pi = f.findIndex((x) => x.k === 'priority');
    if (pi > 0) f.unshift(f.splice(pi, 1)[0]);
  }
  stats[src]++;
  components[id] = { src, f: f || [], ...(f && f.length === 0 ? { m: 1 } : {}), ...(f === null ? { opaque: 1 } : {}) };
}
// Hand specs override thin doc entries when they add structure.
for (const [id, f] of Object.entries(HAND)) {
  if (!components[id] || components[id].opaque || components[id].f.length === 0) components[id] = { src: 'hand', f, ...(f.length ? {} : { m: 1 }) };
}

// ---- Field patches where the published docs are too loose to drive a form ----
const TRIG = { t: 'tr' };
const PATCH = {
  'minecraft:scheduler': { _replace: [
    { k: 'min_delay_secs', t: 'i', d: 0 }, { k: 'max_delay_secs', t: 'i', d: 0 },
    { k: 'scheduled_events', t: 'ol', f: [{ k: 'filters', t: 'f' }, { k: 'event', t: 's' }] }] },
  'minecraft:breedable': {
    breeds_with: { t: 'ol', f: [{ k: 'mate_type', t: 's' }, { k: 'baby_type', t: 's' }, { k: 'breed_event', ...TRIG }] },
    breed_items: { t: 'l', it: { t: 'item' } },
  },
  'minecraft:damage_sensor': {
    triggers: { t: 'ol', f: [
      { k: 'cause', t: 'e', o: '@causes' },
      { k: 'deals_damage', t: 'alt', a: [{ t: 'b' }, { t: 'e', o: ['yes', 'no', 'no_but_side_effects_apply'] }] },
      { k: 'damage_multiplier', t: 'n', d: 1 }, { k: 'damage_modifier', t: 'n', d: 0 },
      { k: 'on_damage', ...TRIG }, { k: 'on_damage_sound_event', t: 'e', o: '@soundEvents' }] },
  },
  'minecraft:equipment': { slot_drop_chance: { t: 'ol', f: [{ k: 'slot', t: 'e', o: ['slot.weapon.mainhand', 'slot.weapon.offhand', 'slot.armor.head', 'slot.armor.chest', 'slot.armor.legs', 'slot.armor.feet', 'slot.armor.body'] }, { k: 'drop_chance', t: 'n', d: 0.085 }] } },
  'minecraft:attack': { damage: { t: 'alt', a: [{ t: 'n' }, { t: 'ar' }] }, effect_name: { t: 'e', o: '@effects' } },
  'minecraft:environment_sensor': { triggers: { t: 'ol', f: [{ k: 'filters', t: 'f' }, { k: 'event', t: 's' }, { k: 'target', t: 'e', o: ['self', 'other', 'player', 'target', 'parent', 'baby', 'damager', 'block'] }] } },
  'minecraft:tameable': { tame_items: { t: 'l', it: { t: 'item' } }, tame_event: TRIG },
  'minecraft:ageable': { feed_items: { t: 'l', it: { t: 'item' } }, grow_up: TRIG, drop_items: { t: 'l', it: { t: 'item' } } },
  'minecraft:hurt_on_condition': { damage_conditions: { t: 'ol', f: [{ k: 'filters', t: 'f' }, { k: 'cause', t: 'e', o: '@causes' }, { k: 'damage_per_tick', t: 'i', d: 1 }] } },
};
for (const [id, patch] of Object.entries(PATCH)) {
  const c = components[id];
  if (!c) continue;
  if (patch._replace) { c.f = patch._replace; delete c.m; c.src = 'hand'; continue; }
  for (const [k, spec] of Object.entries(patch)) {
    const i = c.f.findIndex((x) => x.k === k);
    const merged = { k, ...spec, ...(i >= 0 && c.f[i].d !== undefined && spec.d === undefined ? { d: c.f[i].d } : {}) };
    if (i >= 0) c.f[i] = merged; else c.f.push(merged);
  }
}
// Strip noisy nested defaults from every field.
(function walk(list) {
  for (const f of list || []) {
    if (f.d !== undefined) { const c = cleanDefault(f.d); if (c === undefined) delete f.d; else f.d = c; }
    if (f.f) walk(f.f);
    if (f.a) walk(f.a);
    if (f.it) walk([f.it]);
    if (f.v) walk([f.v]);
  }
})(Object.values(components).flatMap((c) => c.f));

// ---- Filter tests ----
const filterDoc = docRoot.nodes.find((n) => n.name === 'Filters');
const filters = {};
for (const n of filterDoc.nodes || []) {
  const params = {};
  for (const p of n.nodes || []) {
    const spec = convDoc(p);
    const d = parseDocDefault(p.default, spec.t);
    params[p.name] = { ...spec, ...(d !== undefined ? { d } : {}) };
  }
  filters[n.name] = params;
}

// ---- Vanilla identifiers ----
const vd = (f) => load(path.join(META, 'vanilladata_modules', f)).data_items.map((x) => x.name).sort();
const findDoc = (n, name) => {
  if (n.name === name) return n;
  for (const c of n.nodes || []) { const r = findDoc(c, name); if (r) return r; }
  return null;
};
const biomeTags = (findDoc(docRoot, 'Biome Tags')?.nodes || []).map((n) => n.name);
const taggedBiomes = findDoc(docRoot, 'Tagged Biomes');
const extraTags = new Set();
for (const b of taggedBiomes?.nodes || []) for (const t of String(b.description || '').split(',')) if (t.trim()) extraTags.add(t.trim());
for (const t of biomeTags) extraTags.add(t);

let sounds = [];
const sdFile = path.join(SAMPLES, 'resource_pack/sounds/sound_definitions.json');
const sdAlt = process.env.SOUND_DEFS;
for (const f of [sdAlt, sdFile].filter(Boolean)) {
  if (fs.existsSync(f)) { sounds = Object.keys(load(f).sound_definitions).filter((k) => /^(mob|random|ambient|game\.player|note|block\.bell|damage)\./.test(k)).sort(); break; }
}

// Entity families and vanilla events used across vanilla behavior packs (identifiers only).
const families = new Set();
const entDir = path.join(SAMPLES, 'behavior_pack/entities');
if (fs.existsSync(entDir)) {
  for (const f of fs.readdirSync(entDir)) {
    try {
      const txt = fs.readFileSync(path.join(entDir, f), 'utf8');
      for (const m of txt.matchAll(/"family"\s*:\s*\[([^\]]*)\]/g)) for (const fam of m[1].matchAll(/"([a-z0-9_]+)"/g)) families.add(fam[1]);
    } catch { /* ignore */ }
  }
}

const soundEvents = (() => {
  const f = fs.readdirSync(path.join(SCHEMA_ROOT, 'server/common')).sort(cmpVer).reverse()
    .map((v) => path.join(SCHEMA_ROOT, 'server/common', v, 'LevelSoundEvent.json')).find((p) => fs.existsSync(p));
  return f ? load(f).enum : [];
})();
const causes = (() => {
  for (const v of [...entityVersions].reverse()) {
    const p = path.join(SCHEMA_ROOT, 'server/entity', v, 'ActorDamageCause.json');
    if (fs.existsSync(p)) return load(p).enum;
  }
  return [];
})();

fs.mkdirSync(OUT, { recursive: true });
const catalog = { gameVersion: VER, generated: 'gen-catalog.mjs', components, filters };
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog));
const vanilla = {
  gameVersion: VER,
  items: vd('mojang-items.json'),
  blocks: vd('mojang-blocks.json'),
  entities: vd('mojang-entities.json'),
  effects: vd('mojang-effects.json').map((s) => s.replace('minecraft:', '')),
  enchantments: vd('mojang-enchantments.json'),
  biomes: vd('mojang-biomes.json'),
  biomeTags: [...extraTags].sort(),
  families: [...families].sort(),
  sounds,
  soundEvents,
  causes,
};
fs.writeFileSync(path.join(OUT, 'vanilla.json'), JSON.stringify(vanilla));
console.log(`game ${VER}: ${Object.keys(components).length} components`, stats,
  `| ${Object.keys(filters).length} filter tests | items ${vanilla.items.length} blocks ${vanilla.blocks.length} entities ${vanilla.entities.length} sounds ${sounds.length} families ${families.size}`);
console.log('catalog.json', (fs.statSync(path.join(OUT, 'catalog.json')).size / 1024).toFixed(0), 'KB; vanilla.json', (fs.statSync(path.join(OUT, 'vanilla.json')).size / 1024).toFixed(0), 'KB');
