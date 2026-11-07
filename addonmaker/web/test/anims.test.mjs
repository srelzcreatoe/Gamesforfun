// Animation slots: imported / keyframed animations replace the built-in motion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/core/model.js';
import { dwellerFromPreset } from '../src/core/dwellers.js';
import { entityFromPreset } from '../src/core/presets.js';
import { parseAnimationFile, newCustomAnim, evalPose } from '../src/core/anim.js';
import { buildPacks } from '../src/core/packgen.js';

const FILE = {
  format_version: '1.8.0',
  animations: {
    'animation.mine.hunt': { loop: true, animation_length: 1, bones: { head: { rotation: { 0: [0, 0, 0], 0.5: [30, 0, 0], 1: [0, 0, 0] } } } },
    'animation.mine.idle': { loop: true, bones: { body: { rotation: ['math.sin(query.anim_time * 90) * 5', 0, 0] } } },
  },
};

function files(p) {
  const { bp, rp } = buildPacks(p);
  const get = (pack, path) => JSON.parse(pack.files.find((f) => f.path === path).data);
  return { bp, rp, get };
}

test('imported animations in slots export with the right conditions', () => {
  const p = newProject('Slots');
  const e = dwellerFromPreset(p, 'night_grinner', 'ng');
  const list = parseAnimationFile(FILE);
  assert.equal(list.length, 2);
  e.anims.imported = list;
  e.anims.slots = { hunt: `imp:${list[0].uid}`, idle: `imp:${list[1].uid}`, attack: 'off' };
  p.entities.push(e);
  const { rp, get } = files(p);
  const anim = get(rp, 'animations/ng.animation.json').animations;
  const ce = get(rp, 'entity/ng.entity.json')['minecraft:client_entity'].description;
  const hunt = Object.keys(anim).find((k) => k.endsWith('.slot_hunt'));
  assert.ok(hunt, 'hunt slot exported');
  assert.deepEqual(anim[hunt].bones.head.rotation['0.5'], [30, 0, 0]);
  assert.ok(Object.keys(anim).some((k) => k.endsWith('.slot_idle')));
  assert.ok(!Object.keys(anim).some((k) => k.endsWith('.attack')), 'attack slot set to nothing removes built-in attack');
  assert.ok(!Object.keys(anim).some((k) => /\.(idle|twitch|hunch|float)$/.test(k)), 'built-in idle replaced');
  const entry = ce.scripts.animate.find((x) => typeof x === 'object' && x.slot_hunt);
  assert.match(entry.slot_hunt, /horror_state'\) == 'hunting'/);
  assert.equal(ce.animations.slot_hunt, hunt);
});

test('keyframed animation can fill a slot on a normal mob', () => {
  const p = newProject('Keys');
  const e = entityFromPreset(p, 'guard', 'warden2', 'Warden');
  const ca = newCustomAnim('swing');
  ca.channels.push({ bone: e.model.bones[0].name, prop: 'rotation', keys: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [45, 0, 0] }] });
  e.anims.custom = [ca];
  e.anims.slots = { attack: `cus:${ca.uid}` };
  p.entities.push(e);
  const { rp, get } = files(p);
  const anim = get(rp, 'animations/warden2.animation.json').animations;
  const id = Object.keys(anim).find((k) => k.endsWith('.slot_attack'));
  assert.ok(id);
  assert.ok(!Object.keys(anim).some((k) => k.endsWith('.swing')), 'slotted custom anim is not exported twice');
  const pose = evalPose(e, { time: 0.5, dist: 0, speed: 0, attack: 0.5, tx: 0, ty: 0 });
  assert.ok(Math.abs(pose[e.model.bones[0].name].rot[0] - 22.5) < 0.01, 'preview plays the slot');
});
