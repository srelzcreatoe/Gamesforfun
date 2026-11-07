// Horror dweller AI: compiled state machines must be internally consistent and
// only reference things that exist in the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import vanilla from '../data/vanilla.json' with { type: 'json' };
import catalog from '../data/catalog.json' with { type: 'json' };
import { newProject } from '../src/core/model.js';
import { PRESETS, entityFromPreset } from '../src/core/presets.js';
import { buildPacks } from '../src/core/packgen.js';
import { ARCHETYPES, SEEN_REACTIONS, HORROR_STATES, hProp } from '../src/core/horror.js';
import { validateProject } from '../src/core/validate.js';
import { isObj } from '../src/core/util.js';

const HORROR = PRESETS.filter((p) => p.group === 'horror');
const PARTICLES = new Set(['minecraft:sculk_soul_particle', 'minecraft:basic_smoke_particle', 'minecraft:soul_particle', 'minecraft:basic_portal_particle']);

function walk(node, fn) {
  if (Array.isArray(node)) node.forEach((v) => walk(v, fn));
  else if (isObj(node)) { fn(node); Object.values(node).forEach((v) => walk(v, fn)); }
}

function checkEntity(ent, ns, label) {
  const groups = new Set(Object.keys(ent.component_groups || {}));
  const events = new Set([...Object.keys(ent.events || {}), 'minecraft:entity_spawned']);
  const prop = ent.description.properties?.[hProp(ns)];
  assert.ok(prop, `${label}: horror_state property`);
  assert.deepEqual(prop.values, HORROR_STATES);
  // Every add/remove targets a real group; every set_property uses a valid state.
  walk(ent.events, (o) => {
    for (const k of ['add', 'remove']) for (const g of o[k]?.component_groups || []) assert.ok(groups.has(g), `${label}: event uses missing group ${g}`);
    if (o.set_property?.[hProp(ns)]) assert.ok(HORROR_STATES.includes(o.set_property[hProp(ns)]), `${label}: bad state value`);
    if (o.test === 'enum_property' && o.domain === hProp(ns)) assert.ok(HORROR_STATES.includes(o.value), `${label}: filter on unknown state ${o.value}`);
    if (typeof o.trigger === 'string') assert.ok(events.has(o.trigger), `${label}: trigger ${o.trigger} missing`);
    for (const c of o.queue_command?.command || []) {
      const ps = c.match(/^particle (\S+)/);
      if (ps) assert.ok(PARTICLES.has(ps[1]), `${label}: particle ${ps[1]}`);
      const snd = c.match(/^playsound (\S+)/);
      if (snd) assert.ok(vanilla.sounds.includes(snd[1]), `${label}: sound ${snd[1]} not in vanilla`);
      assert.match(c, /^(playsound|camerashake add|effect|title|fog|particle) /, `${label}: unexpected command ${c}`);
    }
  });
  // Every event fired by a component exists on the entity.
  walk([ent.components, ent.component_groups], (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'event' && typeof v === 'string' && v) assert.ok(events.has(v), `${label}: component fires missing event ${v}`);
    }
  });
  // Pitfall guard: no component may live both in base and in a horror state group.
  const horrorGroups = Object.entries(ent.component_groups).filter(([n]) => n.startsWith(`${ns}:horror_`));
  for (const [gn, comps] of horrorGroups) for (const id of Object.keys(comps)) assert.ok(!ent.components[id], `${label}: ${id} is in base and ${gn}`);
  // minecraft:movement exists only in state groups, so every moving state has it.
  assert.ok(!ent.components['minecraft:movement'], `${label}: base movement should be moved into state groups`);
  assert.ok(ent.component_groups[`${ns}:horror_mobile`]['minecraft:movement'].value > 0);
  for (const id of Object.keys(ent.components)) assert.ok(catalog.components[id], `${label}: unknown component ${id}`);
  for (const g of Object.values(ent.component_groups)) for (const id of Object.keys(g)) assert.ok(catalog.components[id], `${label}: unknown component ${id}`);
  const lights = ent.component_groups[`${ns}:horror_hunting`]['minecraft:break_blocks']?.breakable_blocks || [];
  for (const b of lights) assert.ok(vanilla.blocks.includes(b), `${label}: ${b} is not a vanilla block`);
}

test('every horror preset compiles to a consistent state machine', () => {
  assert.equal(HORROR.length, 6);
  const p = newProject('Night Terrors');
  for (const pr of HORROR) p.entities.push(entityFromPreset(p, pr.id, pr.id));
  const issues = validateProject(p, catalog, vanilla).filter((i) => i.level !== 'info');
  assert.deepEqual(issues, []);
  const { bp, rp } = buildPacks(p);
  for (const pr of HORROR) {
    const ent = JSON.parse(bp.files.find((f) => f.path === `entities/${pr.id}.json`).data)['minecraft:entity'];
    checkEntity(ent, p.namespace, pr.id);
    const e = p.entities.find((x) => x.name === pr.id);
    for (const s of Object.values(e.sounds.events)) assert.ok(vanilla.sounds.includes(s.sound), `${pr.id}: ${s.sound}`);
    if (e.horror.scares.fog) assert.ok(rp.files.some((f) => f.path === `fogs/${pr.id}_dread.json`), `${pr.id}: fog file`);
  }
});

test('every seen-reaction × archetype combination stays consistent', () => {
  const p = newProject('Combo');
  let i = 0;
  for (const arch of Object.keys(ARCHETYPES)) {
    for (const [seen] of SEEN_REACTIONS) {
      for (const stalk of [true, false]) {
        const e = entityFromPreset(p, 'h_stalker', `c${i++}`);
        ARCHETYPES[arch].apply(e.horror);
        e.horror.senses.seen = seen;
        e.horror.stalk.on = stalk;
        e.horror.hunt.after = ['stalk', 'dormant', 'vanish'][i % 3];
        e.horror.traits.climb = i % 2 === 0;
        e.horror.weakness.sunlight = ['vanish', 'burn', 'none'][i % 3];
        p.entities.push(e);
      }
    }
  }
  const { bp } = buildPacks(p);
  for (const e of p.entities) {
    const ent = JSON.parse(bp.files.find((f) => f.path === `entities/${e.name}.json`).data)['minecraft:entity'];
    checkEntity(ent, p.namespace, `${e.name}/${e.horror.archetype}/${e.horror.senses.seen}`);
  }
});

test('freeze reaction: frozen while watched, hunts while unwatched', () => {
  const p = newProject('Statues');
  const e = entityFromPreset(p, 'h_statue', 'still');
  p.entities.push(e);
  const ent = JSON.parse(buildPacks(p).bp.files.find((f) => f.path === 'entities/still.json').data)['minecraft:entity'];
  const la = ent.components['minecraft:looked_at'];
  assert.equal(la.looked_at_event.event, 'statues:horror_seen');
  assert.equal(la.not_looked_at_event.event, 'statues:horror_unseen');
  assert.equal(la.line_of_sight_obstruction_type, 'collision_for_camera');
  assert.equal(ent.component_groups['statues:horror_frozen']['minecraft:movement'].value, 0);
  const seen = ent.events['statues:horror_seen'].sequence[0];
  assert.deepEqual(seen.add.component_groups, ['statues:horror_frozen']);
  assert.ok(seen.remove.component_groups.includes('statues:horror_mobile'));
  const unseen = ent.events['statues:horror_unseen'].sequence[0];
  assert.deepEqual(unseen.add.component_groups.sort(), ['statues:horror_hunting', 'statues:horror_mobile']);
});

test('user events and groups survive horror compilation', () => {
  const p = newProject('Mix');
  const e = entityFromPreset(p, 'h_stalker', 'mixer');
  e.groups.push({ uid: 'g', name: 'mix:glow', components: { 'minecraft:scale': { value: 1.2 } } });
  e.events.push({ uid: 'e', name: 'minecraft:entity_spawned', action: { add: { component_groups: ['mix:glow'] } } });
  p.entities.push(e);
  const ent = JSON.parse(buildPacks(p).bp.files.find((f) => f.path === 'entities/mixer.json').data)['minecraft:entity'];
  const sp = ent.events['minecraft:entity_spawned'];
  assert.ok(Array.isArray(sp.sequence));
  assert.deepEqual(sp.sequence[0].add.component_groups, ['mix:glow']);
  assert.ok(sp.sequence[1].add.component_groups.includes('mix:horror_dormant'));
  assert.ok(ent.component_groups['mix:glow']);
});
