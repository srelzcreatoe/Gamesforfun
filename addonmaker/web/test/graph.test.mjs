// The node board and the settings must describe the same dweller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/core/model.js';
import { DWELLER_PRESETS, dwellerFromPreset } from '../src/core/dwellers.js';
import { graphFromConfig, applyGraph, canLink, addLink } from '../src/core/graph.js';
import { buildPacks } from '../src/core/packgen.js';
import { clone } from '../src/core/util.js';

const KEYS = (h) => ({
  type: h.type, time: h.time, appear: h.appear, seen: h.senses.seen, detect: h.senses.detect, stalk: h.stalk.on && h.stalk.keep,
  huntAfter: h.stalk.on ? h.stalk.huntAfter : 0, onClose: h.hunt.onClose, onHurt: h.hunt.onHurt, after: h.hunt.after, duration: h.hunt.duration,
  traits: h.traits, sun: h.weakness.sunlight, fire: h.weakness.fire, damage: h.hunt.damage,
});

test('config → board → config round-trips for all 22 dwellers', () => {
  const p = newProject('Graph');
  for (const d of DWELLER_PRESETS) {
    const e = dwellerFromPreset(p, d.id);
    const before = clone(KEYS(e.horror));
    const hp = e.components['minecraft:health'].value;
    e.horror.graph = graphFromConfig(e);
    applyGraph(e);
    assert.deepEqual(KEYS(e.horror), before, d.id);
    assert.equal(e.components['minecraft:health'].value, hp);
  }
});

test('rewiring the board changes the exported behaviour', () => {
  const p = newProject('Wires');
  const e = dwellerFromPreset(p, 'night_grinner', 'nw');
  e.horror.graph = graphFromConfig(e);
  const g = e.horror.graph;
  assert.equal(canLink('seen', 'freeze'), null);
  assert.ok(canLink('seen', 'rest'));
  assert.ok(canLink('scream#x', 'stalk'));
  g.nodes.push({ id: 'freeze', x: 0, y: 0, data: {} });
  addLink(g, 'seen', 'freeze');
  g.nodes.push({ id: 'scream#extra', x: 0, y: 0, data: { sound: 'mob.ghast.scream' } });
  addLink(g, 'scream#extra', 'seen');
  g.links = g.links.filter((l) => l.from !== 'timer');
  applyGraph(e);
  assert.equal(e.horror.senses.seen, 'freeze');
  assert.equal(e.horror.appear.director, false);
  assert.ok(e.horror.moments.seen.includes('scream'));
  p.entities.push(e);
  const { bp } = buildPacks(p);
  const ent = JSON.parse(bp.files.find((f) => f.path === 'entities/nw.json').data)['minecraft:entity'];
  assert.ok(ent.component_groups[`${p.namespace}:horror_frozen`]);
  assert.ok(!bp.files.some((f) => f.path === 'functions/tick.json'), 'timer disconnected → no director');
});
