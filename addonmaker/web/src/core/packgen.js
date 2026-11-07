// Turns a Mobsmith project into Bedrock behavior + resource packs.
import { clone, base64ToBytes, slug, utf8, isObj } from './util.js';
import { geometryJSON, autoPaint } from './geo.js';
import { buildAnimations } from './anim.js';
import { Raster } from './png.js';
import { makeZip } from './zip.js';
import { TARGETS } from './model.js';
import { compileHorror, directorFunctions, dwellerSpawn, hProp, migrateHorror } from './horror.js';
import { addLimitParts, limitFunctions, limitOf } from './limits.js';

const J = (o) => JSON.stringify(o, null, 2) + '\n';
const ver3 = (v) => (Array.isArray(v) && v.length === 3 ? v.map((x) => Math.max(0, parseInt(x, 10) || 0)) : [1, 0, 0]);

export function packFolderName(project) {
  return (project.name || 'Addon').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 40) || 'Addon';
}

export const lootPath = (project, e) => `loot_tables/entities/${project.namespace}/${e.name}.json`;
export const gearPath = (project, e) => `loot_tables/entities/${project.namespace}/${e.name}_gear.json`;
export const tradePath = (project, e) => `trading/${project.namespace}/${e.name}_trades.json`;
export const activityGroup = (project, act) => `${project.namespace}:activity_${slug(act)}`;
export const activityEvent = (project, act) => `${project.namespace}:schedule_${slug(act)}`;

/** Drops empty add/remove lists that the editor may leave behind. */
function cleanAction(a) {
  if (!isObj(a)) return a;
  for (const k of ['add', 'remove']) {
    if (isObj(a[k]) && Array.isArray(a[k].component_groups) && !a[k].component_groups.length) delete a[k];
  }
  for (const k of ['randomize', 'sequence']) if (Array.isArray(a[k])) a[k] = a[k].map(cleanAction);
  return a;
}

function hasComponentAnywhere(e, id) {
  return !!e.components[id] || e.groups.some((g) => g.components[id]);
}

function propertiesJSON(e) {
  if (!e.properties?.length) return undefined;
  const out = {};
  for (const p of e.properties) {
    const o = { type: p.type };
    if (p.type === 'enum') {
      o.values = (p.values || []).filter(Boolean);
      o.default = o.values.includes(p.def) ? p.def : o.values[0];
    } else if (p.type === 'bool') {
      o.default = typeof p.def === 'string' && p.def !== 'true' && p.def !== 'false' ? p.def : p.def === true || p.def === 'true';
    } else {
      const lo = Number(p.range?.[0] ?? 0), hi = Number(p.range?.[1] ?? 10);
      o.range = p.type === 'int' ? [Math.round(lo), Math.round(hi)] : [lo, hi];
      const d = typeof p.def === 'string' && isNaN(Number(p.def)) ? p.def : Number(p.def) || 0;
      o.default = typeof d === 'number' && p.type === 'int' ? Math.round(d) : d;
    }
    if (p.clientSync) o.client_sync = true;
    out[p.name] = o;
  }
  return out;
}

function scheduleParts(project, e) {
  const s = e.schedule;
  if (!s?.enabled || !s.activities?.length) return null;
  const groups = {}, events = {};
  const names = s.activities.map((a) => a.name);
  for (const a of s.activities) {
    groups[activityGroup(project, a.name)] = clone(a.components || {});
    events[activityEvent(project, a.name)] = {
      add: { component_groups: [activityGroup(project, a.name)] },
      ...(names.length > 1 ? { remove: { component_groups: names.filter((n) => n !== a.name).map((n) => activityGroup(project, n)) } } : {}),
    };
  }
  const scheduled = (s.slots || []).filter((sl) => names.includes(sl.activity)).map((sl) => {
    const from = Math.max(0, Math.min(24000, Math.round(sl.from))), to = Math.max(0, Math.min(24000, Math.round(sl.to)));
    const a = { test: 'hourly_clock_time', operator: '>=', value: from };
    const b = { test: 'hourly_clock_time', operator: '<', value: to };
    return { filters: from <= to ? { all_of: [a, b] } : { any_of: [a, b] }, event: activityEvent(project, sl.activity) };
  });
  return {
    groups, events,
    scheduler: { min_delay_secs: 0, max_delay_secs: 10, scheduled_events: scheduled },
    first: s.slots?.[0]?.activity,
  };
}

function lootTableJSON(pools) {
  return { pools: clone(pools || []) };
}
function gearTableJSON(g) {
  const pools = [];
  for (const k of ['mainhand', 'offhand', 'head', 'chest', 'legs', 'feet']) {
    if (g[k]) pools.push({ rolls: 1, entries: [{ type: 'item', name: g[k], weight: 1 }] });
  }
  return { pools };
}
const GEAR_SLOT = { mainhand: 'slot.weapon.mainhand', offhand: 'slot.weapon.offhand', head: 'slot.armor.head', chest: 'slot.armor.chest', legs: 'slot.armor.legs', feet: 'slot.armor.feet' };

/** Behavior-pack entity definition, including everything Mobsmith wires automatically. */
export function behaviorEntityJSON(project, e, notes = [], extraRp = [], directors = []) {
  const id = `${project.namespace}:${e.name}`;
  const components = clone(e.components);
  const groups = {};
  for (const g of e.groups) groups[g.name] = clone(g.components);
  const events = {};
  for (const ev of e.events) events[ev.name] = cleanAction(clone(ev.action));

  const sched = scheduleParts(project, e);
  if (sched) {
    Object.assign(groups, sched.groups);
    Object.assign(events, sched.events);
    components['minecraft:scheduler'] = sched.scheduler;
    notes.push('Daily schedule → minecraft:scheduler plus one component group and event per activity');
    if (sched.first) {
      const spawnEv = events['minecraft:entity_spawned'] ||= {};
      const add = (spawnEv.add ||= {});
      const list = (add.component_groups ||= []);
      const g = activityGroup(project, sched.first);
      if (!list.includes(g)) list.push(g);
    }
  }
  if (e.loot?.enabled && e.loot.pools?.length && !hasComponentAnywhere(e, 'minecraft:loot')) {
    components['minecraft:loot'] = { table: lootPath(project, e) };
    notes.push('Loot tab → minecraft:loot');
  } else if (e.loot?.enabled) {
    for (const c of [components, ...Object.values(groups)]) if (c['minecraft:loot'] && !c['minecraft:loot'].table) c['minecraft:loot'].table = lootPath(project, e);
  }
  if (e.gear?.enabled && Object.keys(GEAR_SLOT).some((k) => e.gear[k])) {
    components['minecraft:equipment'] = {
      table: gearPath(project, e),
      slot_drop_chance: Object.keys(GEAR_SLOT).filter((k) => e.gear[k]).map((k) => ({ slot: GEAR_SLOT[k], drop_chance: Number(e.gear.dropChance) || 0 })),
    };
    notes.push('Gear → minecraft:equipment');
  }
  if (e.trades?.enabled && e.trades.tiers?.length) {
    const table = tradePath(project, e);
    let found = false;
    for (const c of [components, ...Object.values(groups)]) {
      for (const k of ['minecraft:economy_trade_table', 'minecraft:trade_table']) {
        if (c[k]) {
          found = true;
          if (!c[k].table) c[k].table = table;
          if (!c[k].display_name) c[k].display_name = `entity.${id}.name`;
        }
      }
    }
    if (!found) {
      components['minecraft:economy_trade_table'] = { display_name: `entity.${id}.name`, table, new_screen: true, persist_trades: true };
      notes.push('Trades → minecraft:economy_trade_table');
    }
    if (!hasComponentAnywhere(e, 'minecraft:behavior.trade_with_player')) {
      components['minecraft:behavior.trade_with_player'] = { priority: 2 };
      notes.push('Trades → minecraft:behavior.trade_with_player');
    }
  }
  const snd = e.sounds;
  if (snd?.enabled && snd.events?.ambient?.sound && !hasComponentAnywhere(e, 'minecraft:ambient_sound_interval')) {
    components['minecraft:ambient_sound_interval'] = { value: Number(snd.interval) || 8, range: 16, event_name: 'ambient' };
    notes.push('Ambient sound → minecraft:ambient_sound_interval');
  }

  let props = propertiesJSON(e) || {};
  if (e.horror?.enabled) {
    const r = compileHorror({ ns: project.namespace, name: e.name, h: e.horror, components, groups, events, properties: props, notes });
    extraRp.push(...r.files);
    if (r.director) { directors.push({ ...r.director, max: limitOf(e) }); notes.push(`Appearance director: first after ${r.director.ap.firstAfter} min, then every ${r.director.ap.every[0]}-${r.director.ap.every[1]} min (${r.director.ap.chance}% chance)`); }
  }

  addLimitParts(project.namespace, e, groups, events, notes);

  const description = {
    identifier: id,
    is_spawnable: !!e.spawnable,
    is_summonable: !!e.summonable,
  };
  if (e.experimental) description.is_experimental = true;
  if (e.horror?.enabled) description.spawn_category = 'monster';
  else if (e.spawnCategory) description.spawn_category = e.spawnCategory;
  if (e.runtimeId) description.runtime_identifier = e.runtimeId;
  if (Object.keys(props).length) description.properties = props;

  const body = { description };
  if (Object.keys(groups).length) body.component_groups = groups;
  body.components = components;
  if (Object.keys(events).length) body.events = events;
  const target = TARGETS[project.target] || TARGETS['1.26.0'];
  return { format_version: target.entity, 'minecraft:entity': body };
}

export const texturePath = (project, e, i = 0) => `textures/entity/${project.namespace}/${e.name}${i ? `_v${i}` : ''}`;
export const geoId = (project, e) => `geometry.${project.namespace}_${e.name}`;
export const animPrefix = (project, e) => `${project.namespace}_${e.name}`;
export const rcId = (project, e) => `controller.render.${project.namespace}_${e.name}`;

export function clientEntityJSON(project, e) {
  const id = `${project.namespace}:${e.name}`;
  const texCount = Math.max(1, e.textures?.length || 0);
  const textures = {};
  for (let i = 0; i < texCount; i++) textures[i === 0 ? 'default' : `v${i}`] = texturePath(project, e, i);
  const anim = buildAnimations(e, animPrefix(project, e), { ns: project.namespace });
  const desc = {
    identifier: id,
    materials: { default: e.model.material || 'entity_alphatest' },
    textures,
    geometry: { default: geoId(project, e) },
    render_controllers: [rcId(project, e)],
  };
  if (Object.keys(anim.map).length) {
    desc.animations = anim.map;
    desc.scripts = { animate: anim.animate };
  }
  if (e.model.bones.some((b) => b.role === 'item')) desc.enable_attachables = true;
  if (e.egg?.enabled !== false && e.spawnable) desc.spawn_egg = { base_color: e.egg?.base || '#3f6fb5', overlay_color: e.egg?.overlay || '#f2c14e' };
  return { file: { format_version: '1.10.0', 'minecraft:client_entity': { description: desc } }, animations: anim.file };
}

export function renderControllerJSON(project, e) {
  const n = Math.max(1, e.textures?.length || 0);
  const rc = { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }] };
  if (n > 1) {
    const q = { variant: 'query.variant', mark_variant: 'query.mark_variant', skin_id: 'query.skin_id' }[e.textureSelector] || 'query.variant';
    rc.arrays = { textures: { 'Array.skins': Array.from({ length: n }, (_, i) => (i === 0 ? 'Texture.default' : `Texture.v${i}`)) } };
    rc.textures = [`Array.skins[${q}]`];
  } else rc.textures = ['Texture.default'];
  if (e.horror?.enabled) rc.part_visibility = [{ '*': `query.property('${hProp(project.namespace)}') != 'arriving'` }];
  return { format_version: '1.8.0', render_controllers: { [rcId(project, e)]: rc } };
}

/** Spawn conditions actually exported (dwellers use their own habitat settings). */
export function spawnConditions(e) {
  if (e.horror?.enabled) {
    const h = migrateHorror(e.horror);
    return h.appear.natural ? { population: 'monster', conditions: dwellerSpawn(h) } : null;
  }
  return e.spawn?.enabled && e.spawn.conditions?.length ? { population: e.spawn.population || 'animal', conditions: e.spawn.conditions } : null;
}

export function spawnRulesJSON(project, e) {
  const sc = spawnConditions(e);
  return {
    format_version: '1.8.0',
    'minecraft:spawn_rules': {
      description: { identifier: `${project.namespace}:${e.name}`, population_control: sc?.population || 'animal' },
      conditions: clone(sc?.conditions || []),
    },
  };
}

export function fallbackIcon(project) {
  const R = new Raster(64, 64);
  const seed = [...(project.name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = seed % 360;
  const hsl = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const c = hsl(hue, 0.45, 0.28 + (y / 64) * 0.22);
    R.set(x, y, c[0], c[1], c[2], 255);
  }
  const face = hsl((hue + 180) % 360, 0.5, 0.62);
  for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) R.set(x, y, face[0], face[1], face[2], 255);
  for (const [x, y] of [[22, 26], [38, 26]]) for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 4; dx++) R.set(x + dx, y + dy, 30, 26, 38, 255);
  for (let x = 26; x < 38; x++) for (let dy = 0; dy < 2; dy++) R.set(x, 40 + dy, 30, 26, 38, 255);
  return R.toPNG();
}

function textureBytes(e) {
  if (e.textures?.length) return e.textures.map((t) => base64ToBytes(t.data));
  return [autoPaint(e.model, e.autoPaint || {}).toPNG()];
}

/**
 * @returns {{bp:{dir:string,files:Array}, rp:{dir:string,files:Array}, notes:Object<string,string[]>}}
 */
export function buildPacks(project, opts = {}) {
  const target = TARGETS[project.target] || TARGETS['1.26.0'];
  const version = ver3(project.version);
  const base = packFolderName(project);
  const bpDir = `${base} BP`, rpDir = `${base} RP`;
  const icon = opts.icon || (project.icon ? base64ToBytes(project.icon) : fallbackIcon(project));
  const authors = project.author ? { metadata: { authors: [project.author] } } : {};
  const bp = [], rp = [];
  const notes = {};

  bp.push({ path: 'manifest.json', data: J({
    format_version: 2,
    header: { name: `${project.name} (Behavior)`, description: project.description || '', uuid: project.uuids.bp, version, min_engine_version: target.engine },
    modules: [{ type: 'data', uuid: project.uuids.bpModule, version }],
    dependencies: [{ uuid: project.uuids.rp, version }],
    ...authors,
  }) });
  rp.push({ path: 'manifest.json', data: J({
    format_version: 2,
    header: { name: `${project.name} (Resources)`, description: project.description || '', uuid: project.uuids.rp, version, min_engine_version: target.engine },
    modules: [{ type: 'resources', uuid: project.uuids.rpModule, version }],
    ...authors,
  }) });
  bp.push({ path: 'pack_icon.png', data: icon });
  rp.push({ path: 'pack_icon.png', data: icon });

  const lang = [`pack.name=${project.name}`, `pack.description=${(project.description || '').replace(/\n/g, ' ')}`];
  const soundEntities = {};
  const directors = [];
  for (const e of project.entities) {
    const id = `${project.namespace}:${e.name}`;
    const n = (notes[e.name] = []);
    const extraRp = [];
    bp.push({ path: `entities/${e.name}.json`, data: J(behaviorEntityJSON(project, e, n, extraRp, directors)) });
    for (const f of extraRp) rp.push({ path: f.path, data: J(f.json) });
    if (spawnConditions(e)) bp.push({ path: `spawn_rules/${e.name}.json`, data: J(spawnRulesJSON(project, e)) });
    if (e.loot?.enabled && e.loot.pools?.length) bp.push({ path: lootPath(project, e), data: J(lootTableJSON(e.loot.pools)) });
    if (e.gear?.enabled && Object.keys(GEAR_SLOT).some((k) => e.gear[k])) bp.push({ path: gearPath(project, e), data: J(gearTableJSON(e.gear)) });
    if (e.trades?.enabled && e.trades.tiers?.length) bp.push({ path: tradePath(project, e), data: J({ tiers: clone(e.trades.tiers) }) });

    const ce = clientEntityJSON(project, e);
    rp.push({ path: `entity/${e.name}.entity.json`, data: J(ce.file) });
    if (Object.keys(ce.animations.animations).length) rp.push({ path: `animations/${e.name}.animation.json`, data: J(ce.animations) });
    rp.push({ path: `models/entity/${e.name}.geo.json`, data: J(geometryJSON(e.model, geoId(project, e))) });
    rp.push({ path: `render_controllers/${e.name}.render_controllers.json`, data: J(renderControllerJSON(project, e)) });
    textureBytes(e).forEach((bytes, i) => rp.push({ path: `${texturePath(project, e, i)}.png`, data: bytes }));
    lang.push(`entity.${id}.name=${e.displayName || e.name}`);
    if (e.spawnable && e.egg?.enabled !== false) lang.push(`item.spawn_egg.entity.${id}.name=Spawn ${e.displayName || e.name}`);

    const s = e.sounds;
    if (s?.enabled) {
      const evs = {};
      for (const [k, v] of Object.entries(s.events || {})) {
        if (!v?.sound) continue;
        const one = { sound: v.sound };
        if (v.volume !== undefined && Number(v.volume) !== 1) one.volume = Number(v.volume);
        if (v.pitch !== undefined && Number(v.pitch) !== 1) one.pitch = Number(v.pitch);
        evs[k] = Object.keys(one).length === 1 ? v.sound : one;
      }
      if (Object.keys(evs).length) soundEntities[id] = { volume: Number(s.volume) || 1, pitch: Array.isArray(s.pitch) ? s.pitch.map(Number) : Number(s.pitch) || 1, events: evs };
    }
  }
  if (Object.keys(soundEntities).length) rp.push({ path: 'sounds.json', data: J({ entity_sounds: { entities: soundEntities } }) });
  // Appearance director: per-player timers in BP functions, run every tick.
  // "Only N at once": slot tags kept by a tick function.
  const dirFiles = directorFunctions(project.namespace, project, directors);
  const limFiles = limitFunctions(project.namespace, project.entities);
  const ticks = [];
  if (dirFiles.length) { bp.push(...dirFiles); ticks.push(`${project.namespace}/dwellers/tick`); }
  if (limFiles.length) { bp.push(...limFiles); ticks.push(`${project.namespace}/limits`); }
  if (ticks.length) bp.push({ path: 'functions/tick.json', data: J({ values: ticks }) });
  // Custom audio: files under sounds/<ns>/ plus sound_definitions.json so the
  // ids (<ns>.<name>) work in sounds.json, /playsound and the horror scares.
  const custom = project.sounds || [];
  if (custom.length) {
    const defs = {};
    const bytes = new Map((opts.customSounds || []).map((c) => [c.uid, c.bytes]));
    for (const cs of custom) {
      const file = `sounds/${project.namespace}/${cs.name}`;
      const one = { name: file, volume: Number(cs.volume) || 1, load_on_low_memory: true };
      if (Number(cs.pitch) && Number(cs.pitch) !== 1) one.pitch = Number(cs.pitch);
      if (cs.stream) one.stream = true;
      defs[`${project.namespace}.${cs.name}`] = { category: cs.category || 'hostile', ...(cs.maxDistance ? { max_distance: Number(cs.maxDistance) } : {}), sounds: [one] };
      if (bytes.has(cs.uid)) rp.push({ path: `${file}.${cs.ext || 'ogg'}`, data: bytes.get(cs.uid) });
    }
    rp.push({ path: 'sounds/sound_definitions.json', data: J({ format_version: '1.14.0', sound_definitions: defs }) });
  }
  const langText = lang.join('\n') + '\n';
  for (const p of [bp, rp]) {
    p.push({ path: 'texts/en_US.lang', data: langText });
    p.push({ path: 'texts/languages.json', data: J(['en_US']) });
  }
  return { bp: { dir: bpDir, files: bp }, rp: { dir: rpDir, files: rp }, notes };
}

const withDir = (dir, files) => files.map((f) => ({ path: `${dir}/${f.path}`, data: f.data }));

export function makeAddon(project, opts) {
  const { bp, rp } = buildPacks(project, opts);
  return makeZip([...withDir(bp.dir, bp.files), ...withDir(rp.dir, rp.files)]);
}
export function makePack(project, kind, opts) {
  const packs = buildPacks(project, opts);
  return makeZip(packs[kind].files);
}
export function fileText(f) {
  return typeof f.data === 'string' ? f.data : null;
}
export { utf8 };
