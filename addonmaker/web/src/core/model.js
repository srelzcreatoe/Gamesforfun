// Project / entity data model and factories.
import { uid, uuid, slug, clone } from './util.js';
import { makeModel, TEMPLATES } from './geo.js';
import { defaultAnims } from './anim.js';

export const PROJECT_VERSION = 1;

export const TARGETS = {
  '1.26.0': { label: 'Minecraft 1.26.0+ (recommended)', engine: [1, 26, 0], entity: '1.26.0' },
  '1.26.60': { label: 'Minecraft 1.26.60+ (newest)', engine: [1, 26, 60], entity: '1.26.60' },
  '1.21.0': { label: 'Minecraft 1.21.0+ (older devices)', engine: [1, 21, 0], entity: '1.21.0' },
};

export function newProject(name = 'My Add-on') {
  const ns = slug(name, { fallback: 'mysmith' }).slice(0, 16).replace(/_+$/, '') || 'mysmith';
  return {
    v: PROJECT_VERSION,
    id: uid(),
    name,
    description: 'Made with Mobsmith',
    author: '',
    namespace: ns === 'minecraft' ? 'my' + ns : ns,
    version: [1, 0, 0],
    target: '1.26.0',
    icon: null,
    uuids: { bp: uuid(), bpModule: uuid(), rp: uuid(), rpModule: uuid() },
    entities: [],
    created: Date.now(),
    updated: Date.now(),
  };
}

export function defaultSounds() {
  return { enabled: true, volume: 1, pitch: [0.8, 1.2], interval: 8, events: {} };
}
export function defaultSpawn() {
  return { enabled: false, population: 'animal', conditions: [] };
}

export function baseEntity(name = 'new_mob', template = 'humanoid') {
  const t = TEMPLATES[template] || TEMPLATES.humanoid;
  const model = makeModel(template);
  return {
    uid: uid(),
    name: slug(name, { fallback: 'new_mob' }),
    displayName: name.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    spawnable: true,
    summonable: true,
    experimental: false,
    spawnCategory: '',
    runtimeId: '',
    egg: { enabled: true, base: '#3f6fb5', overlay: '#f2c14e' },
    components: {
      'minecraft:type_family': { family: [slug(name), 'mob'] },
      'minecraft:health': { value: 20, max: 20 },
      'minecraft:collision_box': { width: t.collision[0], height: t.collision[1] },
    },
    groups: [],
    events: [],
    properties: [],
    model,
    textures: [],
    textureSelector: 'variant',
    autoPaint: { noise: 0.07, outline: true, eyes: true },
    anims: defaultAnims(template),
    sounds: defaultSounds(),
    spawn: defaultSpawn(),
    loot: { enabled: false, pools: [] },
    gear: { enabled: false, mainhand: '', offhand: '', head: '', chest: '', legs: '', feet: '', dropChance: 0.085 },
    trades: { enabled: false, tiers: [] },
    schedule: { enabled: false, activities: [], slots: [] },
  };
}

export const newGroup = (name, components = {}) => ({ uid: uid(), name, components });
export const newEvent = (name, action = {}) => ({ uid: uid(), name, action });
export const newProperty = (name, type = 'bool') => ({
  uid: uid(), name, type, def: type === 'bool' ? false : type === 'enum' ? 'a' : 0,
  range: [0, 10], values: ['a', 'b'], clientSync: true,
});

export function entityId(project, entity) { return `${project.namespace}:${entity.name}`; }

export function duplicateEntity(e, project) {
  const c = clone(e);
  c.uid = uid();
  let n = e.name + '_copy', i = 2;
  while (project.entities.some((x) => x.name === n)) n = `${e.name}_copy${i++}`;
  c.name = n;
  c.displayName = e.displayName + ' Copy';
  for (const g of c.groups) g.uid = uid();
  for (const ev of c.events) ev.uid = uid();
  for (const b of c.model.bones) { b.uid = uid(); for (const cu of b.cubes) cu.uid = uid(); }
  return c;
}

/** Brings older or imported project data up to the current shape. */
export function migrateProject(p) {
  if (!p || typeof p !== 'object') throw new Error('Not a project');
  if (!Array.isArray(p.entities)) throw new Error('Project has no entities list');
  p.v ??= PROJECT_VERSION;
  p.uuids ??= { bp: uuid(), bpModule: uuid(), rp: uuid(), rpModule: uuid() };
  p.target ??= '1.26.0';
  p.version ??= [1, 0, 0];
  for (const e of p.entities) {
    const d = baseEntity(e.name || 'mob', e.model?.template || 'humanoid');
    for (const k of Object.keys(d)) if (e[k] === undefined) e[k] = d[k];
    e.uid ||= uid();
    for (const g of e.groups) g.uid ||= uid();
    for (const ev of e.events) ev.uid ||= uid();
    e.anims.custom ||= [];
    e.sounds.events ||= {};
  }
  return p;
}
