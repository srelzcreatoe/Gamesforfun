// Ready-made entity setups. Each preset is a complete, working mob: components,
// component groups, events, model colours, sounds, spawn rules and loot.
import { baseEntity, newGroup, newEvent, newProperty } from './model.js';
import { uid } from './util.js';
import { makeModel } from './geo.js';
import { defaultAnims } from './anim.js';
import { DWELLER_PRESETS, DWELLER_ALIASES, applyDwellerPreset } from './dwellers.js';

const fam = (...f) => ({ family: f });
const isFam = (value, subject = 'other') => ({ test: 'is_family', subject, value });
const ev = (event, target = 'self') => ({ event, target });

function essentials(e, { health = 20, speed = 0.25, walk = true } = {}) {
  Object.assign(e.components, {
    'minecraft:health': { value: health, max: health },
    'minecraft:movement': { value: speed },
    ...(walk ? {
      'minecraft:movement.basic': {},
      'minecraft:navigation.walk': { can_path_over_water: true, avoid_water: true, avoid_damage_blocks: true },
      'minecraft:jump.static': {},
      'minecraft:can_climb': {},
    } : {}),
    'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
    'minecraft:nameable': {},
    'minecraft:physics': {},
    'minecraft:pushable_by_entity': {},
    'minecraft:pushable_by_block': {},
    'minecraft:hurt_on_condition': { damage_conditions: [{ filters: { test: 'in_lava', subject: 'self' }, cause: 'lava', damage_per_tick: 4 }] },
    'minecraft:conditional_bandwidth_optimization': {},
    'minecraft:is_hidden_when_invisible': {},
    'minecraft:behavior.float': { priority: 0 },
    ...(walk ? { 'minecraft:behavior.random_stroll': { priority: 7, speed_multiplier: 1 } } : {}),
    'minecraft:behavior.look_at_player': { priority: 8, look_distance: 6, probability: 0.02 },
    'minecraft:behavior.random_look_around': { priority: 9 },
  });
}

function setModel(e, template, colors = {}) {
  e.model = makeModel(template);
  for (const b of e.model.bones) {
    const c = colors[b.role] || colors[b.name];
    if (c) Object.assign(b, typeof c === 'string' ? { color: c } : c);
  }
  e.anims = defaultAnims(template);
}

const sounds = (map, pitch = [0.8, 1.2]) => ({
  enabled: true, volume: 1, pitch, interval: 8,
  events: Object.fromEntries(Object.entries(map).map(([k, s]) => [k, { sound: s, volume: k === 'step' ? 0.25 : 1, pitch: 1 }])),
});

const lootPool = (item, min, max, extra = {}) => ({
  rolls: 1,
  entries: [{ type: 'item', name: item, weight: 1, functions: [
    { function: 'set_count', count: { min, max } },
    { function: 'looting_enchant', count: { min: 0, max: 1 } },
  ] }],
  ...extra,
});

export const PRESETS = [
  {
    id: 'blank', label: 'Blank mob', icon: '◻', blurb: 'The essentials: health, walking, wandering. Build anything from here.',
    build(e) { essentials(e); },
  },
  {
    id: 'animal', label: 'Farm animal', icon: '🐄', blurb: 'Breeds with food, has babies that grow up, panics when hit, spawns in grassy biomes.',
    build(e, id, ns) {
      setModel(e, 'quadruped');
      essentials(e, { health: 10 });
      Object.assign(e.components, {
        'minecraft:collision_box': { width: 0.9, height: 1.0 },
        'minecraft:leashable': {},
        'minecraft:despawn': { despawn_from_distance: {} },
        'minecraft:behavior.panic': { priority: 1, speed_multiplier: 1.25 },
        'minecraft:behavior.breed': { priority: 3, speed_multiplier: 1 },
        'minecraft:behavior.tempt': { priority: 4, speed_multiplier: 1.2, items: ['minecraft:wheat'] },
      });
      e.groups.push(
        newGroup(`${ns}:baby`, {
          'minecraft:is_baby': {},
          'minecraft:scale': { value: 0.5 },
          'minecraft:ageable': { duration: 1200, feed_items: ['minecraft:wheat'], grow_up: ev(`${ns}:grow_up`) },
          'minecraft:behavior.follow_parent': { priority: 5, speed_multiplier: 1.1 },
        }),
        newGroup(`${ns}:adult`, {
          'minecraft:experience_reward': { on_bred: 'Math.Random(1,7)', on_death: 'query.last_hit_by_player ? Math.Random(1,3) : 0' },
          'minecraft:breedable': {
            require_tame: false, breed_items: ['minecraft:wheat'],
            breeds_with: [{ mate_type: id, baby_type: id, breed_event: ev('minecraft:entity_born', 'baby') }],
          },
        }),
      );
      e.events.push(
        newEvent('minecraft:entity_spawned', { randomize: [
          { weight: 95, add: { component_groups: [`${ns}:adult`] } },
          { weight: 5, add: { component_groups: [`${ns}:baby`] } },
        ] }),
        newEvent('minecraft:entity_born', { add: { component_groups: [`${ns}:baby`] } }),
        newEvent(`${ns}:grow_up`, { remove: { component_groups: [`${ns}:baby`] }, add: { component_groups: [`${ns}:adult`] } }),
      );
      e.spawn = { enabled: true, population: 'animal', conditions: [{
        'minecraft:spawns_on_surface': {},
        'minecraft:spawns_on_block_filter': 'minecraft:grass_block',
        'minecraft:brightness_filter': { min: 7, max: 15, adjust_for_weather: false },
        'minecraft:weight': { default: 8 },
        'minecraft:herd': { min_size: 2, max_size: 4 },
        'minecraft:biome_filter': { test: 'has_biome_tag', operator: '==', value: 'animal' },
      }] };
      e.spawnCategory = 'creature';
      e.loot = { enabled: true, pools: [lootPool('minecraft:leather', 0, 2)] };
      e.sounds = sounds({ ambient: 'mob.cow.say', hurt: 'mob.cow.hurt', death: 'mob.cow.hurt', step: 'mob.cow.step' });
      e.egg = { enabled: true, base: '#c98f5e', overlay: '#f0d2b0' };
    },
  },
  {
    id: 'pet', label: 'Tameable pet', icon: '🐺', blurb: 'Tame it with a bone, then it follows you, sits on command and defends you.',
    build(e, id, ns) {
      setModel(e, 'quadruped', { body: { color: '#d8d2c8', pattern: 'spots', color2: '#8c7a66' }, head: '#e2ddd4', legBR: '#cfc8bc', legBL: '#cfc8bc', legFR: '#cfc8bc', legFL: '#cfc8bc', tail: '#cfc8bc' });
      essentials(e, { health: 16, speed: 0.3 });
      Object.assign(e.components, {
        'minecraft:collision_box': { width: 0.6, height: 0.85 },
        'minecraft:leashable': {},
        'minecraft:attack': { damage: 4 },
        'minecraft:behavior.melee_box_attack': { priority: 4 },
        'minecraft:behavior.hurt_by_target': { priority: 2 },
      });
      e.groups.push(
        newGroup(`${ns}:wild`, {
          'minecraft:tameable': { probability: 0.33, tame_items: ['minecraft:bone'], tame_event: ev(`${ns}:on_tame`) },
          'minecraft:despawn': { despawn_from_distance: {} },
        }),
        newGroup(`${ns}:tame`, {
          'minecraft:is_tamed': {},
          'minecraft:sittable': {},
          'minecraft:behavior.stay_while_sitting': { priority: 3 },
          'minecraft:behavior.owner_hurt_by_target': { priority: 1 },
          'minecraft:behavior.owner_hurt_target': { priority: 2 },
          'minecraft:behavior.follow_owner': { priority: 6, speed_multiplier: 1, start_distance: 10, stop_distance: 2 },
          'minecraft:healable': { items: [{ item: 'minecraft:cooked_beef', heal_amount: 8 }, { item: 'minecraft:beef', heal_amount: 3 }] },
          'minecraft:health': { value: 30, max: 30 },
        }),
      );
      e.events.push(
        newEvent('minecraft:entity_spawned', { add: { component_groups: [`${ns}:wild`] } }),
        newEvent(`${ns}:on_tame`, { remove: { component_groups: [`${ns}:wild`] }, add: { component_groups: [`${ns}:tame`] } }),
      );
      e.spawn = { enabled: true, population: 'animal', conditions: [{
        'minecraft:spawns_on_surface': {},
        'minecraft:brightness_filter': { min: 7, max: 15, adjust_for_weather: false },
        'minecraft:weight': { default: 6 },
        'minecraft:herd': { min_size: 1, max_size: 3 },
        'minecraft:biome_filter': { test: 'has_biome_tag', operator: '==', value: 'forest' },
      }] };
      e.spawnCategory = 'creature';
      e.sounds = sounds({ ambient: 'mob.wolf.bark', hurt: 'mob.wolf.hurt', death: 'mob.wolf.death', step: 'mob.wolf.step' });
      e.egg = { enabled: true, base: '#d8d2c8', overlay: '#8c7a66' };
    },
  },
  {
    id: 'monster', label: 'Melee monster', icon: '🧟', blurb: 'Hunts players at night, hits hard, spawns in the dark.',
    build(e, id, ns) {
      setModel(e, 'humanoid', { body: '#5b4a7a', head: '#7fae6a', armR: '#7fae6a', armL: '#7fae6a', legR: '#2f2a40', legL: '#2f2a40' });
      essentials(e, { health: 24, speed: 0.23 });
      e.components['minecraft:type_family'] = fam(e.name, 'monster', 'mob');
      Object.assign(e.components, {
        'minecraft:attack': { damage: 4 },
        'minecraft:follow_range': { value: 32 },
        'minecraft:despawn': { despawn_from_distance: {} },
        'minecraft:experience_reward': { on_death: 'query.last_hit_by_player ? 5 : 0' },
        'minecraft:behavior.hurt_by_target': { priority: 1 },
        'minecraft:behavior.nearest_attackable_target': {
          priority: 2, must_see: true, reselect_targets: true, within_radius: 25,
          entity_types: [{ filters: { any_of: [isFam('player'), isFam('irongolem'), isFam('villager')] }, max_dist: 32 }],
        },
        'minecraft:behavior.melee_box_attack': { priority: 3 },
      });
      e.spawn = { enabled: true, population: 'monster', conditions: [{
        'minecraft:spawns_on_surface': {},
        'minecraft:spawns_underground': {},
        'minecraft:brightness_filter': { min: 0, max: 7, adjust_for_weather: true },
        'minecraft:difficulty_filter': { min: 'easy', max: 'hard' },
        'minecraft:weight': { default: 40 },
        'minecraft:herd': { min_size: 1, max_size: 2 },
        'minecraft:biome_filter': { test: 'has_biome_tag', operator: '==', value: 'monster' },
      }] };
      e.spawnCategory = 'monster';
      e.loot = { enabled: true, pools: [lootPool('minecraft:rotten_flesh', 0, 2), {
        rolls: 1,
        conditions: [{ condition: 'killed_by_player_or_pets' }, { condition: 'random_chance_with_looting', chance: 0.05, looting_multiplier: 0.01 }],
        entries: [{ type: 'item', name: 'minecraft:emerald', weight: 1 }],
      }] };
      e.sounds = sounds({ ambient: 'mob.zombie.say', hurt: 'mob.zombie.hurt', death: 'mob.zombie.death', step: 'mob.zombie.step' });
      e.egg = { enabled: true, base: '#5b4a7a', overlay: '#7fae6a' };
    },
  },
  {
    id: 'ranged', label: 'Ranged shooter', icon: '🏹', blurb: 'Keeps its distance and fires projectiles at players.',
    build(e, id, ns) {
      setModel(e, 'humanoid', { body: '#3d5c3a', head: '#d9cfae', armR: '#d9cfae', armL: '#d9cfae', legR: '#2c2c2c', legL: '#2c2c2c' });
      essentials(e, { health: 20, speed: 0.25 });
      e.components['minecraft:type_family'] = fam(e.name, 'monster', 'mob');
      Object.assign(e.components, {
        'minecraft:shooter': { def: 'minecraft:arrow' },
        'minecraft:despawn': { despawn_from_distance: {} },
        'minecraft:experience_reward': { on_death: 'query.last_hit_by_player ? 5 : 0' },
        'minecraft:behavior.hurt_by_target': { priority: 1 },
        'minecraft:behavior.nearest_attackable_target': { priority: 2, must_see: true, reselect_targets: true, entity_types: [{ filters: isFam('player'), max_dist: 24 }] },
        'minecraft:behavior.ranged_attack': { priority: 3, attack_interval: { min: 1.5, max: 3 }, attack_range: { min: 0, max: 15 } },
      });
      e.gear = { enabled: true, mainhand: 'minecraft:bow', offhand: '', head: '', chest: '', legs: '', feet: '', dropChance: 0.085 };
      e.spawn = { enabled: true, population: 'monster', conditions: [{
        'minecraft:spawns_on_surface': {}, 'minecraft:spawns_underground': {},
        'minecraft:brightness_filter': { min: 0, max: 7, adjust_for_weather: true },
        'minecraft:difficulty_filter': { min: 'easy', max: 'hard' },
        'minecraft:weight': { default: 25 }, 'minecraft:herd': { min_size: 1, max_size: 2 },
        'minecraft:biome_filter': { test: 'has_biome_tag', operator: '==', value: 'monster' },
      }] };
      e.spawnCategory = 'monster';
      e.loot = { enabled: true, pools: [lootPool('minecraft:arrow', 0, 3), lootPool('minecraft:bone', 0, 2)] };
      e.sounds = sounds({ ambient: 'mob.skeleton.say', hurt: 'mob.skeleton.hurt', death: 'mob.skeleton.death', step: 'mob.skeleton.step' });
      e.egg = { enabled: true, base: '#3d5c3a', overlay: '#d9cfae' };
    },
  },
  {
    id: 'mount', label: 'Rideable mount', icon: '🐎', blurb: 'Feed it until it trusts you, then ride and steer it.',
    build(e, id, ns) {
      setModel(e, 'quadruped', { body: { color: '#8a5a3c', pattern: 'gradient', color2: '#4a2f1f' }, head: '#93624a', tail: '#3a2618' });
      essentials(e, { health: 30, speed: 0.3 });
      Object.assign(e.components, {
        'minecraft:collision_box': { width: 1.3, height: 1.5 },
        'minecraft:scale': { value: 1.3 },
        'minecraft:leashable': {},
        'minecraft:behavior.panic': { priority: 3, speed_multiplier: 1.3 },
      });
      e.groups.push(
        newGroup(`${ns}:wild`, {
          'minecraft:rideable': { seat_count: 1, family_types: ['player'], interact_text: 'action.interact.mount', seats: [{ position: [0, 1.15, 0] }] },
          'minecraft:behavior.mount_pathing': { priority: 2, speed_multiplier: 1.5, target_dist: 0, track_target: true },
          'minecraft:tamemount': {
            min_temper: 0, max_temper: 40, feed_text: 'action.interact.feed', ride_text: 'action.interact.mount',
            feed_items: [{ item: 'minecraft:wheat', temper_mod: 5 }, { item: 'minecraft:apple', temper_mod: 8 }],
            tame_event: ev(`${ns}:on_tame`),
          },
        }),
        newGroup(`${ns}:tamed`, {
          'minecraft:is_tamed': {},
          'minecraft:rideable': { seat_count: 1, family_types: ['player'], crouching_skip_interact: true, interact_text: 'action.interact.ride.horse', seats: [{ position: [0, 1.15, 0] }] },
          'minecraft:input_ground_controlled': {},
          'minecraft:behavior.player_ride_tamed': { priority: 1 },
          'minecraft:can_power_jump': {},
          'minecraft:horse.jump_strength': { value: 0.7 },
        }),
      );
      e.events.push(
        newEvent('minecraft:entity_spawned', { add: { component_groups: [`${ns}:wild`] } }),
        newEvent(`${ns}:on_tame`, { remove: { component_groups: [`${ns}:wild`] }, add: { component_groups: [`${ns}:tamed`] } }),
      );
      e.spawn = { enabled: true, population: 'animal', conditions: [{
        'minecraft:spawns_on_surface': {}, 'minecraft:spawns_on_block_filter': 'minecraft:grass_block',
        'minecraft:brightness_filter': { min: 7, max: 15, adjust_for_weather: false },
        'minecraft:weight': { default: 3 }, 'minecraft:herd': { min_size: 1, max_size: 3 },
        'minecraft:biome_filter': { test: 'has_biome_tag', operator: '==', value: 'plains' },
      }] };
      e.spawnCategory = 'creature';
      e.sounds = sounds({ ambient: 'mob.horse.idle', hurt: 'mob.horse.hit', death: 'mob.horse.death', step: 'mob.horse.wood' });
      e.egg = { enabled: true, base: '#8a5a3c', overlay: '#3a2618' };
    },
  },
  {
    id: 'flyer', label: 'Flying critter', icon: '🦋', blurb: 'Hovers and flutters around, never takes fall damage.',
    build(e, id, ns) {
      setModel(e, 'flyer');
      essentials(e, { health: 10, speed: 0.3, walk: false });
      Object.assign(e.components, {
        'minecraft:collision_box': { width: 0.6, height: 0.6 },
        'minecraft:can_fly': {},
        'minecraft:flying_speed': { value: 0.15 },
        'minecraft:movement.hover': {},
        'minecraft:navigation.hover': { can_path_over_water: true, can_sink: false, can_pass_doors: false, can_path_from_air: true, avoid_water: true, avoid_damage_blocks: true, avoid_sun: false },
        'minecraft:jump.static': {},
        'minecraft:damage_sensor': { triggers: [{ cause: 'fall', deals_damage: 'no' }] },
        'minecraft:behavior.random_hover': { priority: 6, xz_dist: 8, y_dist: 8, y_offset: -1, interval: 1, hover_height: { min: 1, max: 4 } },
        'minecraft:behavior.panic': { priority: 1, speed_multiplier: 1.4 },
      });
      e.spawn = { enabled: true, population: 'ambient', conditions: [{
        'minecraft:spawns_on_surface': {},
        'minecraft:brightness_filter': { min: 7, max: 15, adjust_for_weather: false },
        'minecraft:weight': { default: 5 }, 'minecraft:herd': { min_size: 2, max_size: 5 },
        'minecraft:biome_filter': { test: 'has_biome_tag', operator: '==', value: 'flower_forest' },
      }] };
      e.spawnCategory = 'ambient';
      e.sounds = sounds({ ambient: 'mob.parrot.idle', hurt: 'mob.parrot.hurt', death: 'mob.parrot.death' }, [1.1, 1.4]);
      e.egg = { enabled: true, base: '#6fb0d8', overlay: '#e6b84a' };
    },
  },
  {
    id: 'swimmer', label: 'Water creature', icon: '🐟', blurb: 'Lives underwater, swims in schools, drowns on land.',
    build(e, id, ns) {
      setModel(e, 'fish');
      e.components = {
        'minecraft:type_family': fam(e.name, 'fish', 'mob'),
        'minecraft:health': { value: 6, max: 6 },
        'minecraft:collision_box': { width: 0.5, height: 0.4 },
        'minecraft:breathable': { total_supply: 15, suffocate_time: 0, breathes_water: true, breathes_air: false, generates_bubbles: false },
        'minecraft:movement': { value: 0.12 },
        'minecraft:underwater_movement': { value: 0.13 },
        'minecraft:movement.sway': { sway_amplitude: 0 },
        'minecraft:navigation.generic': { is_amphibious: false, can_path_over_water: false, can_swim: true, can_walk: false, can_breach: false, can_sink: false },
        'minecraft:physics': {},
        'minecraft:pushable_by_entity': {},
        'minecraft:pushable_by_block': {},
        'minecraft:nameable': {},
        'minecraft:despawn': { despawn_from_distance: {} },
        'minecraft:conditional_bandwidth_optimization': {},
        'minecraft:behavior.panic': { priority: 1, speed_multiplier: 1.25 },
        'minecraft:behavior.random_swim': { priority: 3, speed_multiplier: 1, xz_dist: 16, y_dist: 4, interval: 0 },
        'minecraft:behavior.swim_idle': { priority: 5, idle_time: 5, success_rate: 0.1 },
        'minecraft:behavior.swim_wander': { priority: 4, interval: 0.1, look_ahead: 2, speed_multiplier: 1, wander_time: 5 },
      };
      e.spawn = { enabled: true, population: 'water_animal', conditions: [{
        'minecraft:spawns_underwater': {},
        'minecraft:height_filter': { min: 0, max: 64 },
        'minecraft:weight': { default: 15 }, 'minecraft:herd': { min_size: 3, max_size: 6 },
        'minecraft:biome_filter': { test: 'has_biome_tag', operator: '==', value: 'ocean' },
      }] };
      e.spawnCategory = 'water_creature';
      e.loot = { enabled: true, pools: [lootPool('minecraft:cod', 1, 1)] };
      e.sounds = sounds({ hurt: 'mob.fish.hurt', death: 'mob.fish.hurt' });
      e.egg = { enabled: true, base: '#e88b3c', overlay: '#fbe3c4' };
    },
  },
  {
    id: 'villager', label: 'Village dweller', icon: '🏘', blurb: 'Joins villages, keeps a daily schedule (wander, gather, sleep) and trades with players.',
    build(e, id, ns) {
      setModel(e, 'humanoid', { body: '#7a5a3a', head: '#d9a57c', armR: '#7a5a3a', armL: '#7a5a3a', legR: '#5e4630', legL: '#5e4630' });
      essentials(e, { health: 20, speed: 0.5 });
      e.components['minecraft:type_family'] = fam(e.name, 'villager', 'peasant', 'mob');
      Object.assign(e.components, {
        'minecraft:dweller': { dwelling_type: 'village', dweller_role: 'inhabitant', update_interval_base: 60, update_interval_variant: 40, can_find_poi: true, can_migrate: true, first_founding_reward: 0 },
        'minecraft:navigation.walk': { can_path_over_water: true, can_pass_doors: true, can_open_doors: true, avoid_water: true },
        'minecraft:annotation.open_door': {},
        'minecraft:inventory': { inventory_size: 8, private: true },
        'minecraft:economy_trade_table': { display_name: '', table: '', new_screen: true, persist_trades: true },
        'minecraft:behavior.trade_with_player': { priority: 2 },
        'minecraft:behavior.look_at_trading_player': { priority: 3 },
        'minecraft:behavior.panic': { priority: 1, speed_multiplier: 0.6 },
        'minecraft:behavior.avoid_mob_type': { priority: 4, entity_types: [{ filters: { any_of: [isFam('zombie'), isFam('illager')] }, max_dist: 8, walk_speed_multiplier: 0.6, sprint_speed_multiplier: 0.6 }] },
        'minecraft:behavior.move_towards_dwelling_restriction': { priority: 10, speed_multiplier: 0.6 },
      });
      delete e.components['minecraft:behavior.random_stroll'];
      e.schedule = {
        enabled: true,
        activities: [
          { uid: uid(), name: 'wander', components: { 'minecraft:behavior.random_stroll': { priority: 8, speed_multiplier: 0.6 } } },
          { uid: uid(), name: 'gather', components: { 'minecraft:behavior.mingle': { priority: 7, speed_multiplier: 0.5, duration: 30, cooldown_time: 10, mingle_partner_type: id, mingle_distance: 2 } } },
          { uid: uid(), name: 'sleep', components: { 'minecraft:behavior.sleep': { priority: 3, sleep_collider_height: 0.3, sleep_collider_width: 1, sleep_y_offset: 0.6, speed_multiplier: 0.6, timeout_cooldown: 10 } } },
        ],
        slots: [
          { from: 0, to: 8000, activity: 'wander' },
          { from: 8000, to: 10000, activity: 'gather' },
          { from: 10000, to: 12000, activity: 'wander' },
          { from: 12000, to: 24000, activity: 'sleep' },
        ],
      };
      e.trades = { enabled: true, tiers: [
        { total_exp_required: 0, groups: [{ num_to_select: 2, trades: [
          { wants: [{ item: 'minecraft:wheat', quantity: 20, price_multiplier: 0.05 }], gives: [{ item: 'minecraft:emerald', quantity: 1 }], trader_exp: 2, max_uses: 16, reward_exp: true },
          { wants: [{ item: 'minecraft:emerald', quantity: 1 }], gives: [{ item: 'minecraft:bread', quantity: 6 }], trader_exp: 1, max_uses: 16, reward_exp: true },
          { wants: [{ item: 'minecraft:carrot', quantity: 22, price_multiplier: 0.05 }], gives: [{ item: 'minecraft:emerald', quantity: 1 }], trader_exp: 2, max_uses: 16, reward_exp: true },
        ] }] },
        { total_exp_required: 10, groups: [{ num_to_select: 1, trades: [
          { wants: [{ item: 'minecraft:emerald', quantity: 3 }], gives: [{ item: 'minecraft:golden_carrot', quantity: 3 }], trader_exp: 5, max_uses: 12, reward_exp: true },
          { wants: [{ item: 'minecraft:emerald', quantity: 1 }], gives: [{ item: 'minecraft:cookie', quantity: 8 }], trader_exp: 5, max_uses: 12, reward_exp: true },
        ] }] },
      ] };
      e.spawnable = true;
      e.sounds = sounds({ ambient: 'mob.villager.idle', hurt: 'mob.villager.hit', death: 'mob.villager.death', 'haggle': 'mob.villager.haggle', 'haggle.yes': 'mob.villager.yes', 'haggle.no': 'mob.villager.no' });
      e.egg = { enabled: true, base: '#7a5a3a', overlay: '#d9a57c' };
    },
  },
  {
    id: 'guard', label: 'Village guard', icon: '🛡', blurb: 'A defender dweller: patrols the village at night and fights monsters that threaten it.',
    build(e, id, ns) {
      setModel(e, 'golem', { body: { color: '#7d8a99', pattern: 'spots', color2: '#4e6b8a' }, head: '#a4afbd', armR: '#7d8a99', armL: '#7d8a99', legR: '#66717f', legL: '#66717f' });
      essentials(e, { health: 100, speed: 0.25 });
      e.components['minecraft:type_family'] = fam(e.name, 'guard', 'mob');
      Object.assign(e.components, {
        'minecraft:collision_box': { width: 1.4, height: 2.9 },
        'minecraft:dweller': { dwelling_type: 'village', dweller_role: 'defender', update_interval_base: 60, update_interval_variant: 40, can_find_poi: false, can_migrate: true, first_founding_reward: 0 },
        'minecraft:attack': { damage: [7, 21] },
        'minecraft:knockback_resistance': { value: 1 },
        'minecraft:follow_range': { value: 64 },
        'minecraft:persistent': {},
        'minecraft:damage_sensor': { triggers: [{ cause: 'fall', deals_damage: 'no' }] },
        'minecraft:behavior.defend_village_target': { priority: 1, must_reach: true, entity_types: [{ filters: { any_of: [isFam('mob'), isFam('player')] } }] },
        'minecraft:behavior.nearest_attackable_target': { priority: 2, within_radius: 20, reselect_targets: true, entity_types: [{ filters: { all_of: [isFam('monster'), { test: 'is_family', subject: 'other', operator: '!=', value: 'creeper' }] }, max_dist: 16 }] },
        'minecraft:behavior.melee_box_attack': { priority: 3 },
        'minecraft:behavior.move_through_village': { priority: 4, speed_multiplier: 0.6, only_at_night: true },
        'minecraft:behavior.move_towards_dwelling_restriction': { priority: 5, speed_multiplier: 1 },
        'minecraft:behavior.hurt_by_target': { priority: 2 },
      });
      e.components['minecraft:behavior.random_stroll'] = { priority: 7, speed_multiplier: 0.6, xz_dist: 16 };
      e.loot = { enabled: true, pools: [lootPool('minecraft:iron_ingot', 3, 5)] };
      e.sounds = sounds({ hurt: 'mob.irongolem.hit', death: 'mob.irongolem.death', step: 'mob.irongolem.walk' }, [0.8, 1.0]);
      e.egg = { enabled: true, base: '#7d8a99', overlay: '#4e6b8a' };
    },
  },
  {
    id: 'boss', label: 'Boss', icon: '👑', blurb: 'Huge health bar, darkens the sky, and enrages at half health (second phase).',
    build(e, id, ns) {
      setModel(e, 'golem', { body: { color: '#5a1e2e', pattern: 'stripes', color2: '#f2a541' }, head: '#7a2a3c', armR: '#5a1e2e', armL: '#5a1e2e', legR: '#3a1420', legL: '#3a1420' });
      essentials(e, { health: 300, speed: 0.28 });
      e.components['minecraft:type_family'] = fam(e.name, 'monster', 'mob');
      e.properties.push({ ...newProperty(`${ns}:phase`, 'int'), def: 0, range: [0, 1] });
      Object.assign(e.components, {
        'minecraft:collision_box': { width: 1.4, height: 2.9 },
        'minecraft:scale': { value: 1.2 },
        'minecraft:boss': { name: e.displayName, should_darken_sky: true, hud_range: 55 },
        'minecraft:attack': { damage: 12 },
        'minecraft:knockback_resistance': { value: 1 },
        'minecraft:fire_immune': {},
        'minecraft:persistent': {},
        'minecraft:follow_range': { value: 48 },
        'minecraft:experience_reward': { on_death: '100' },
        'minecraft:damage_sensor': { triggers: [{ cause: 'fall', deals_damage: 'no' }] },
        'minecraft:behavior.hurt_by_target': { priority: 1 },
        'minecraft:behavior.nearest_attackable_target': { priority: 2, must_see: false, reselect_targets: true, within_radius: 48, entity_types: [{ filters: isFam('player'), max_dist: 48 }] },
        'minecraft:behavior.melee_box_attack': { priority: 3 },
        'minecraft:environment_sensor': { triggers: [{
          filters: { all_of: [{ test: 'actor_health', operator: '<', value: 150 }, { test: 'int_property', domain: `${ns}:phase`, operator: '==', value: 0 }] },
          event: `${ns}:enrage`,
        }] },
      });
      e.groups.push(newGroup(`${ns}:enraged`, {
        'minecraft:movement': { value: 0.36 },
        'minecraft:attack': { damage: 18 },
        'minecraft:area_attack': { damage_range: 1.5, damage_per_tick: 2, cause: 'magic', entity_filter: isFam('player') },
      }));
      e.events.push(newEvent(`${ns}:enrage`, {
        set_property: { [`${ns}:phase`]: 1 },
        add: { component_groups: [`${ns}:enraged`] },
        queue_command: { command: ['say I am ENRAGED!'] },
      }));
      e.spawnable = true;
      e.loot = { enabled: true, pools: [lootPool('minecraft:diamond', 3, 6), { rolls: 1, entries: [{ type: 'item', name: 'minecraft:totem_of_undying', weight: 1 }] }] };
      e.sounds = sounds({ hurt: 'mob.irongolem.hit', death: 'mob.irongolem.death', step: 'mob.irongolem.walk' }, [0.5, 0.7]);
      e.egg = { enabled: true, base: '#5a1e2e', overlay: '#f2a541' };
    },
  },
  {
    id: 'projectile', label: 'Projectile', icon: '☄', blurb: 'Something to shoot: set another mob\'s Shooter to this entity.',
    build(e, id, ns) {
      setModel(e, 'blob', { body: '#f2a541' });
      e.model.bones[0].cubes[0] = { ...e.model.bones[0].cubes[0], origin: [-2, 0, -2], size: [4, 4, 4] };
      e.model.autoUv = true;
      e.anims = { ...defaultAnims('blob'), idle: { on: false, amp: 1 }, look: { on: false } };
      e.autoPaint = { noise: 0.15, outline: true, eyes: false };
      e.spawnable = false;
      e.egg.enabled = false;
      e.components = {
        'minecraft:type_family': fam(e.name, 'projectile'),
        'minecraft:collision_box': { width: 0.25, height: 0.25 },
        'minecraft:projectile': {
          on_hit: { impact_damage: { damage: { min: 6, max: 6 }, knockback: true, destroy_on_hit: true }, remove_on_hit: {} },
          power: 1.6, gravity: 0.03, uncertainty_base: 1, uncertainty_multiplier: 0, anchor: 'eye_height', offset: [0, -0.1, 0],
        },
        'minecraft:physics': {},
        'minecraft:conditional_bandwidth_optimization': {},
      };
      e.sounds = { enabled: false, volume: 1, pitch: [1, 1], interval: 8, events: {} };
    },
  },
];

for (const d of DWELLER_PRESETS) {
  PRESETS.push({ id: d.id, group: 'horror', label: d.label, icon: d.icon, blurb: d.blurb, signature: !!d.signature, build(e, id, ns) { applyDwellerPreset(e, d, ns); } });
}

export function entityFromPreset(project, presetId, name, displayName) {
  const p = PRESETS.find((x) => x.id === (DWELLER_ALIASES[presetId] || presetId)) || PRESETS[0];
  const e = baseEntity(name, 'humanoid');
  if (displayName) e.displayName = displayName;
  const id = `${project.namespace}:${e.name}`;
  p.build(e, id, project.namespace);
  if (e.components['minecraft:type_family'] && !e.components['minecraft:type_family'].family.includes(e.name)) {
    e.components['minecraft:type_family'].family.unshift(e.name);
  }
  e.preset = p.id;
  return e;
}
