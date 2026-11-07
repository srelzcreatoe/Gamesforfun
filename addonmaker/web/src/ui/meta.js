// Hand-written UI metadata for the generated component catalog: categories,
// short descriptions (our own words), useful starting values and suggestion
// lists for fields. Everything not listed here still works via the generic
// form built from the official structure.
import catalog from '../../data/catalog.json';
import vanilla from '../../data/vanilla.json';
import { titleCase, clone, isObj } from '../core/util.js';

export { catalog, vanilla };

export const CATEGORIES = [
  ['core', 'Core stats', '❤'],
  ['move', 'Movement & navigation', '👣'],
  ['combat', 'Combat & targeting', '⚔'],
  ['social', 'Taming, riding & breeding', '🐾'],
  ['village', 'Village & dwellers', '🏘'],
  ['logic', 'Sensors, timers & interaction', '⚙'],
  ['items', 'Items & inventory', '🎒'],
  ['look', 'Appearance, variants & flags', '🎨'],
  ['ai', 'Other AI goals', '🧠'],
  ['misc', 'Everything else', '…'],
  ['special', 'Vanilla-only / experimental', '⚠'],
];

const RULES = [
  ['special', /:(player\.|memory_|npc$|balloon$|tripod|exhaustion_values|managed_wandering_trader)|behavior\.(dragon|guardian_attack|enderman|silverfish|skeleton_horse|slime_|squid_|vex_|wither_|ocelotattack|sniff|dig$|emerge|roar$|sonic_boom|investigate|croak|lay_egg|jump_to_block|eat_mob|drop_item_for|transport_items|place_block|take_block|pickup_block|fire_at_target|rise_to_liquid|crawl|stalk_and_pounce|explore|fly_in_air|fertilize_farm_block_with)/],
  ['village', /:(dweller|home|scheduler|economy_trade_table|trade_table|trade_resupply|can_join_raid|raid_trigger|annotation\.(open_door|break_door)|insomnia|preferred_path)$|behavior\.(sleep|work|work_composter|hide|mingle|share_items|harvest_farm_block|fertilize_farm_block|explore_outskirts|move_towards_dwelling_restriction|move_through_village|stroll_towards_village|move_to_village|defend_village_target|offer_flower|restrict_open_door|open_door|door_interact|inspect_bookshelf|go_home|trade_with_player|look_at_trading_player|trade_interest|celebrate|celebrate_survive|raid_garden|move_to_poi|break_door|find_cover|go_and_give_items_to_owner|go_and_give_items_to_noteblock)$/],
  ['social', /:(tameable|tamemount|is_tamed|rideable|addrider|input_ground_controlled|input_air_controlled|item_controllable|boostable|breedable|ageable|offspring|is_baby|scale_by_age|leashable|leashable_to|balloonable|sittable|healable|giveable|trust|horse\.jump_strength|spawn_egg_interaction)$|behavior\.(breed|follow_parent|follow_owner|follow_mob|follow_caravan|stay_while_sitting|player_ride_tamed|controlled_by_player|mount_pathing|tempt|float_tempt|random_sitting|teleport_to_owner|make_love|ocelot_sit_on_block|beg|nap|find_mount|lay_down|snacking|feeling_happy)$/],
  ['combat', /:(attack|attack_damage|attack_cooldown|shooter|projectile|explode|area_attack|spell_effects|mob_effect|angry|anger_level|target_nearby_sensor|reflect_projectiles|apply_knockback_rules|break_blocks|on_target_acquired|on_target_escape|on_hurt|on_hurt_by_player|on_friendly_anger|on_ignite|damage_sensor|hurt_on_condition|knockback_resistance|follow_range|boss|heartbeat)$|behavior\.(melee_attack|melee_box_attack|ranged_attack|nearest_attackable_target|nearest_prioritized_attackable_target|hurt_by_target|owner_hurt_by_target|owner_hurt_target|leap_at_target|stomp_attack|delayed_attack|charge_attack|knockback_roar|ram_attack|swoop_attack|aquatic_charge_attack|circle_around_anchor|summon_entity|target_when_pushed|avoid_mob_type|avoid_block|flee_sun|restrict_sun|panic|charge_held_item|use_kinetic_weapon|defend_trusted_target|random_search_and_dig|stomp_turtle_egg)$/],
  ['move', /:(movement|movement\..+|jump\..+|navigation\..+|can_climb|can_fly|can_power_jump|physics|pushable_by_entity|pushable_by_block|push_through|underwater_movement|lava_movement|flying_speed|water_movement|friction_modifier|air_drag_modifier|buoyant|floats_in_liquid|rail_movement|walk_animation_speed|block_movement_slowdown_immunity|can_stand_on_powder_snow|bounciness|vertical_movement_action|ground_offset|body_rotation_always_follows_head|body_rotation_blocked|default_look_angle|dimension_bound|uses_legacy_friction|move_control|dash_action|teleport|rotation_axis_aligned|rotation_locked_to_vehicle|collision_box|custom_hit_test|is_collidable)$|behavior\.(float|float_wander|random_stroll|random_swim|random_fly|random_hover|swim_wander|swim_idle|swim_with_entity|swim_up_for_breath|move_to_water|move_to_land|move_to_lava|move_to_liquid|move_towards_target|move_towards_restriction|move_around_target|random_breach|random_look_around|look_at_player|look_at_entity|look_at_target|random_look_around_and_sit|go_and_give_items|move_to_random_block|move_to_block|move_indoors|move_outdoors|go_home)$/],
  ['logic', /:(timer|environment_sensor|entity_sensor|block_sensor|rail_sensor|interact|transformation|spawn_entity|spawn_on_death|on_death|on_start_landing|on_start_takeoff|on_wake_with_owner|on_equipment_changed|looked_at|lookat|inside_block_notifier|game_event_movement_tracking|vibration_listener|vibration_damper|instant_despawn|despawn|persistent|conditional_bandwidth_optimization|ambient_sound_interval|sound_volume|movement_sound_distance_offset|uses_legacy_ambient_sounds)$|behavior\.(send_event|timer_flag_1|timer_flag_2|timer_flag_3)$/],
  ['items', /:(inventory|equippable|equip_item|shareables|barter|admire_item|equipment|loot|giveable)$|behavior\.(pickup_items|equip_item|admire_item|barter|eat_carried_item|drink_potion|drink_milk|take_flower|eat_block|share_items|pickup)$/],
  ['look', /:(variant|mark_variant|skin_id|color|color2|is_.+|renders_when_invisible|scale|is_hidden_when_invisible|nameable|type_family)$/],
  ['core', /:(health|movement|breathable|experience_reward|fire_immune|freezing_immune|burns_in_daylight|luck|absorption|strength|mob_effect_immunity|cannot_be_attacked|ignore_cannot_be_attacked)$/],
  ['ai', /behavior\./],
];
export function categoryOf(id) {
  for (const [cat, re] of RULES) if (re.test(id)) return cat;
  return 'misc';
}

// Short descriptions written for this app.
export const DESC = {
  'minecraft:health': 'How many hit points it has (2 = one heart).',
  'minecraft:attack': 'Melee damage it deals, plus an optional potion effect on hit.',
  'minecraft:movement': 'Base walking speed. Players are about 0.1; most mobs 0.2–0.3.',
  'minecraft:collision_box': 'Hitbox size in blocks (width × height).',
  'minecraft:scale': 'Visual and physical size multiplier.',
  'minecraft:type_family': 'Tags other mobs and filters use to recognise it (e.g. monster, villager).',
  'minecraft:experience_reward': 'XP dropped on death or when bred (Molang allowed).',
  'minecraft:follow_range': 'How far away (blocks) it can notice and chase targets.',
  'minecraft:knockback_resistance': '0 = normal knockback, 1 = immovable.',
  'minecraft:breathable': 'Air, water or lava breathing and how long it can hold its breath.',
  'minecraft:nameable': 'Lets players rename it with a name tag.',
  'minecraft:boss': 'Shows a boss health bar to nearby players.',
  'minecraft:fire_immune': 'Takes no damage from fire or lava.',
  'minecraft:burns_in_daylight': 'Catches fire in sunlight (like zombies).',
  'minecraft:persistent': 'Never despawns.',
  'minecraft:despawn': 'When and how it despawns (distance, chance, inactivity).',
  'minecraft:loot': 'Loot table dropped on death. Mobsmith fills this from the Loot tab.',
  'minecraft:equipment': 'Gear it spawns holding/wearing. Mobsmith fills this from the Gear section.',
  'minecraft:damage_sensor': 'React to damage: block a cause (e.g. fall), multiply it, or fire an event.',
  'minecraft:hurt_on_condition': 'Takes damage while a condition is true (e.g. in lava).',
  'minecraft:movement.basic': 'Standard ground movement control.',
  'minecraft:movement.amphibious': 'Moves on land and in water.',
  'minecraft:movement.fly': 'Flying movement control.',
  'minecraft:movement.hover': 'Hover in place and drift (bees, allays).',
  'minecraft:movement.jump': 'Moves by hopping (slimes).',
  'minecraft:movement.skip': 'Moves in skips (rabbits).',
  'minecraft:movement.sway': 'Swims with a side-to-side sway (fish).',
  'minecraft:movement.generic': 'Generic movement in any medium.',
  'minecraft:movement.glide': 'Glides through the air.',
  'minecraft:navigation.walk': 'Pathfinding on land: doors, water, danger avoidance.',
  'minecraft:navigation.climb': 'Pathfinding that can climb walls (spiders).',
  'minecraft:navigation.fly': 'Pathfinding through the air.',
  'minecraft:navigation.hover': 'Pathfinding for hovering mobs.',
  'minecraft:navigation.swim': 'Pathfinding in water.',
  'minecraft:navigation.float': 'Pathfinding for floating mobs (bats).',
  'minecraft:navigation.generic': 'Pathfinding on land and in water.',
  'minecraft:jump.static': 'Lets it jump up blocks.',
  'minecraft:can_climb': 'Can climb ladders and vines.',
  'minecraft:can_fly': 'Marks it as a flyer (no fall pathing).',
  'minecraft:physics': 'Gravity and collision with blocks.',
  'minecraft:pushable_by_entity': 'Other entities can push it.',
  'minecraft:pushable_by_block': 'Pistons can push it.',
  'minecraft:underwater_movement': 'Speed while swimming.',
  'minecraft:flying_speed': 'Speed while flying.',
  'minecraft:shooter': 'What projectile it fires with a ranged attack.',
  'minecraft:projectile': 'Makes THIS entity a projectile: damage on hit, gravity, power.',
  'minecraft:explode': 'Explodes (fuse, power, fire, block damage).',
  'minecraft:area_attack': 'Damages anything that touches it.',
  'minecraft:spell_effects': 'Adds or removes potion effects on itself when added.',
  'minecraft:mob_effect': 'Applies an effect to nearby entities.',
  'minecraft:angry': 'Angry state: duration, call allies, calm-down event.',
  'minecraft:target_nearby_sensor': 'Fires events when its target gets close or far.',
  'minecraft:on_target_acquired': 'Event when it picks a target.',
  'minecraft:on_target_escape': 'Event when its target escapes.',
  'minecraft:on_hurt': 'Event when it is hurt.',
  'minecraft:on_hurt_by_player': 'Event when a player hurts it.',
  'minecraft:tameable': 'Tame it by feeding items; fires an event when tamed.',
  'minecraft:tamemount': 'Tame by riding/feeding until temper is reached (horses).',
  'minecraft:is_tamed': 'Flag: currently tamed.',
  'minecraft:rideable': 'Seats for riders: how many, who can ride, seat positions.',
  'minecraft:input_ground_controlled': 'The rider can steer it on the ground.',
  'minecraft:item_controllable': 'Steer it with an item (carrot on a stick style).',
  'minecraft:breedable': 'Breeding: items, mate types, baby type.',
  'minecraft:ageable': 'Babies grow up after a time (faster when fed).',
  'minecraft:is_baby': 'Flag: is a baby.',
  'minecraft:leashable': 'Can be put on a lead.',
  'minecraft:sittable': 'Can be told to sit (tamed pets).',
  'minecraft:healable': 'Items that heal it when fed.',
  'minecraft:dweller': 'Joins villages as an inhabitant, defender, pet or raider.',
  'minecraft:home': 'Remembers a home position/blocks and stays near them.',
  'minecraft:scheduler': 'Fires events at times of day. The Dweller tab builds this for you.',
  'minecraft:economy_trade_table': 'Villager-style trading with levels and discounts.',
  'minecraft:trade_table': 'Simple trading table (wandering trader style).',
  'minecraft:trade_resupply': 'Restocks trades over time.',
  'minecraft:preferred_path': 'Prefers walking on certain blocks (paths, cobblestone).',
  'minecraft:can_join_raid': 'Can join raids.',
  'minecraft:annotation.open_door': 'Allows opening doors (with navigation.can_open_doors).',
  'minecraft:annotation.break_door': 'Allows breaking doors (with navigation.can_break_doors).',
  'minecraft:timer': 'Fires an event after a (random) time, optionally repeating.',
  'minecraft:environment_sensor': 'Fires events while a condition is true (time, weather, health…).',
  'minecraft:entity_sensor': 'Fires events when certain entities are within range.',
  'minecraft:block_sensor': 'Fires events when nearby blocks are broken.',
  'minecraft:interact': 'What happens when a player uses an item on it / taps it.',
  'minecraft:transformation': 'Turns into another entity (after a delay).',
  'minecraft:spawn_entity': 'Periodically spawns an entity or item (like chickens laying eggs).',
  'minecraft:inventory': 'Gives it an inventory (chest-like).',
  'minecraft:equippable': 'Slots players can equip (saddles, armor, chests).',
  'minecraft:shareables': 'Items it wants to pick up and hold.',
  'minecraft:variant': 'Number used to pick a skin/texture variant.',
  'minecraft:mark_variant': 'Second variant number (markings, biome skin).',
  'minecraft:skin_id': 'Third variant number.',
  'minecraft:color': 'Primary dye colour (0–15).',
  'minecraft:color2': 'Secondary dye colour (0–15).',
  'minecraft:ambient_sound_interval': 'How often it plays its ambient sound.',
  'minecraft:custom_hit_test': 'Custom hitboxes for hit detection.',
  'minecraft:mob_effect_immunity': 'Potion effects it cannot receive.',
  'minecraft:conditional_bandwidth_optimization': 'Network optimisation; keep it on most mobs.',
  'minecraft:is_hidden_when_invisible': 'Hidden from mobs while invisible.',
  'minecraft:behavior.float': 'Swims up so it doesn\'t drown.',
  'minecraft:behavior.panic': 'Runs around when hurt.',
  'minecraft:behavior.random_stroll': 'Wanders around.',
  'minecraft:behavior.random_look_around': 'Looks around randomly.',
  'minecraft:behavior.look_at_player': 'Looks at nearby players.',
  'minecraft:behavior.look_at_entity': 'Looks at nearby entities matching a filter.',
  'minecraft:behavior.melee_attack': 'Classic melee attack on its target.',
  'minecraft:behavior.melee_box_attack': 'Melee attack using a hit box (current vanilla style).',
  'minecraft:behavior.ranged_attack': 'Shoots its target (needs Shooter).',
  'minecraft:behavior.nearest_attackable_target': 'Picks the nearest matching entity as a target.',
  'minecraft:behavior.hurt_by_target': 'Targets whatever hurt it (and can alert its friends).',
  'minecraft:behavior.owner_hurt_by_target': 'Targets whatever hurt its owner.',
  'minecraft:behavior.owner_hurt_target': 'Targets whatever its owner attacks.',
  'minecraft:behavior.leap_at_target': 'Pounces at its target.',
  'minecraft:behavior.avoid_mob_type': 'Runs away from certain mobs.',
  'minecraft:behavior.tempt': 'Follows players holding certain items.',
  'minecraft:behavior.follow_owner': 'Follows its owner (and teleports when far).',
  'minecraft:behavior.follow_parent': 'Babies follow their parent.',
  'minecraft:behavior.breed': 'Looks for a mate when in love.',
  'minecraft:behavior.stay_while_sitting': 'Stays still while sitting.',
  'minecraft:behavior.player_ride_tamed': 'Lets a player ride it once tamed.',
  'minecraft:behavior.random_swim': 'Swims around randomly.',
  'minecraft:behavior.swim_wander': 'Wanders in water.',
  'minecraft:behavior.swim_idle': 'Idles in water.',
  'minecraft:behavior.random_fly': 'Flies around randomly.',
  'minecraft:behavior.random_hover': 'Hovers around randomly.',
  'minecraft:behavior.move_to_water': 'Heads to water.',
  'minecraft:behavior.move_to_land': 'Heads to land.',
  'minecraft:behavior.flee_sun': 'Hides from sunlight.',
  'minecraft:behavior.restrict_sun': 'Avoids walking into sunlight.',
  'minecraft:behavior.eat_block': 'Eats a block (sheep eating grass).',
  'minecraft:behavior.pickup_items': 'Picks up items it wants.',
  'minecraft:behavior.equip_item': 'Equips items it picked up.',
  'minecraft:behavior.summon_entity': 'Summons helpers or spells.',
  'minecraft:behavior.send_event': 'Casts events to nearby entities.',
  'minecraft:behavior.stomp_attack': 'Stomping melee attack.',
  'minecraft:behavior.delayed_attack': 'Wind-up melee attack.',
  'minecraft:behavior.charge_attack': 'Charges at its target.',
  'minecraft:behavior.knockback_roar': 'Roar that knocks back everything nearby.',
  'minecraft:behavior.move_towards_target': 'Moves towards its target.',
  'minecraft:behavior.sleep': 'Goes to a bed and sleeps (dweller schedules).',
  'minecraft:behavior.work': 'Goes to its job block and works.',
  'minecraft:behavior.hide': 'Hides in a house during raids.',
  'minecraft:behavior.mingle': 'Meets up and chats with others of its kind.',
  'minecraft:behavior.share_items': 'Gives surplus items to friends.',
  'minecraft:behavior.harvest_farm_block': 'Harvests and replants crops.',
  'minecraft:behavior.explore_outskirts': 'Explores the edge of the village.',
  'minecraft:behavior.move_towards_dwelling_restriction': 'Stays inside its village bounds.',
  'minecraft:behavior.move_through_village': 'Patrols through the village (guards).',
  'minecraft:behavior.stroll_towards_village': 'Wanders towards a nearby village.',
  'minecraft:behavior.move_to_village': 'Travels to a village (raiders).',
  'minecraft:behavior.defend_village_target': 'Attacks whatever threatens its village.',
  'minecraft:behavior.offer_flower': 'Offers a flower to villager children.',
  'minecraft:behavior.trade_with_player': 'Opens the trade screen when a player interacts.',
  'minecraft:behavior.look_at_trading_player': 'Looks at the player it is trading with.',
  'minecraft:behavior.trade_interest': 'Shows interest in what a player holds.',
  'minecraft:behavior.go_home': 'Returns to its home block.',
  'minecraft:behavior.open_door': 'Opens and closes doors.',
  'minecraft:behavior.restrict_open_door': 'Stays indoors at night.',
  'minecraft:behavior.timer_flag_1': 'Generic timer goal that fires start/end events.',
  'minecraft:behavior.nap': 'Takes naps (foxes).',
  'minecraft:behavior.random_sitting': 'Sits down sometimes.',
  'minecraft:behavior.teleport_to_owner': 'Teleports back to its owner.',
  'minecraft:behavior.mount_pathing': 'Moves while ridden (mob riders).',
  'minecraft:behavior.controlled_by_player': 'Player steering while riding (newer style).',
};

const VALUE = (v) => ({ value: v });
const STARTERS = {
  'minecraft:health': { value: 20, max: 20 },
  'minecraft:attack': { damage: 3 },
  'minecraft:movement': VALUE(0.25),
  'minecraft:collision_box': { width: 0.6, height: 1.8 },
  'minecraft:scale': VALUE(1),
  'minecraft:type_family': { family: ['mob'] },
  'minecraft:experience_reward': { on_death: 'query.last_hit_by_player ? 5 : 0' },
  'minecraft:follow_range': VALUE(16),
  'minecraft:knockback_resistance': VALUE(0.5),
  'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
  'minecraft:boss': { name: '', should_darken_sky: false, hud_range: 55 },
  'minecraft:despawn': { despawn_from_distance: {} },
  'minecraft:loot': { table: '' },
  'minecraft:underwater_movement': VALUE(0.13),
  'minecraft:lava_movement': VALUE(0.1),
  'minecraft:flying_speed': VALUE(0.15),
  'minecraft:navigation.walk': { can_path_over_water: true, avoid_water: true, avoid_damage_blocks: true },
  'minecraft:navigation.fly': { can_path_over_water: true, can_path_from_air: true },
  'minecraft:navigation.hover': { can_path_over_water: true, can_path_from_air: true, avoid_damage_blocks: true },
  'minecraft:navigation.swim': { can_swim: true, can_walk: false },
  'minecraft:navigation.generic': { can_swim: true, can_walk: true, is_amphibious: true },
  'minecraft:navigation.climb': { can_path_over_water: true },
  'minecraft:hurt_on_condition': { damage_conditions: [{ filters: { test: 'in_lava', subject: 'self' }, cause: 'lava', damage_per_tick: 4 }] },
  'minecraft:damage_sensor': { triggers: [{ cause: 'fall', deals_damage: 'no' }] },
  'minecraft:tameable': { probability: 0.33, tame_items: ['minecraft:bone'], tame_event: { event: '', target: 'self' } },
  'minecraft:breedable': { require_tame: false, breed_items: ['minecraft:wheat'], breeds_with: [] },
  'minecraft:ageable': { duration: 1200, feed_items: ['minecraft:wheat'], grow_up: { event: '', target: 'self' } },
  'minecraft:rideable': { seat_count: 1, family_types: ['player'], interact_text: 'action.interact.ride', seats: [{ position: [0, 1, 0] }] },
  'minecraft:tamemount': { min_temper: 0, max_temper: 50, feed_items: [{ item: 'minecraft:wheat', temper_mod: 5 }], tame_event: { event: '', target: 'self' } },
  'minecraft:healable': { items: [{ item: 'minecraft:apple', heal_amount: 4 }] },
  'minecraft:interact': { interactions: [{ on_interact: { filters: { test: 'is_family', subject: 'other', value: 'player' }, event: '', target: 'self' }, interact_text: 'action.interact.use', swing: true }] },
  'minecraft:timer': { looping: true, randomInterval: true, time: { min: 10, max: 20 }, time_down_event: { event: '', target: 'self' } },
  'minecraft:environment_sensor': { triggers: [{ filters: { test: 'is_daytime', value: true }, event: '' }] },
  'minecraft:entity_sensor': { subsensors: [{ event: '', range: [8, 4], minimum_count: 1, event_filters: { test: 'is_family', subject: 'other', value: 'player' } }] },
  'minecraft:shooter': { def: 'minecraft:arrow' },
  'minecraft:projectile': { on_hit: { impact_damage: { damage: { min: 4, max: 4 }, knockback: true, destroy_on_hit: true }, remove_on_hit: {} }, power: 1.5, gravity: 0.03 },
  'minecraft:explode': { fuse_length: [1.5, 1.5], fuse_lit: true, power: 3, causes_fire: false, breaks_blocks: true },
  'minecraft:area_attack': { damage_range: 0.5, damage_per_tick: 2, cause: 'contact' },
  'minecraft:spell_effects': { add_effects: [{ effect: 'speed', duration: 10, amplifier: 0 }] },
  'minecraft:transformation': { into: 'minecraft:zombie', delay: { value: 5 } },
  'minecraft:dweller': { dwelling_type: 'village', dweller_role: 'inhabitant', update_interval_base: 60, update_interval_variant: 40, can_find_poi: true, can_migrate: true, first_founding_reward: 0 },
  'minecraft:home': { restriction_radius: 16, home_block_list: [] },
  'minecraft:economy_trade_table': { display_name: '', table: '', new_screen: true, persist_trades: true },
  'minecraft:inventory': { inventory_size: 9, container_type: 'inventory' },
  'minecraft:variant': VALUE(0),
  'minecraft:mark_variant': VALUE(0),
  'minecraft:skin_id': VALUE(0),
  'minecraft:color': VALUE(0),
  'minecraft:ambient_sound_interval': { value: 8, range: 16, event_name: 'ambient' },
  'minecraft:angry': { duration: 25, broadcast_anger: true, broadcast_range: 20, calm_event: { event: '', target: 'self' } },
  'minecraft:on_target_acquired': { event: '', target: 'self' },
  'minecraft:on_target_escape': { event: '', target: 'self' },
  'minecraft:on_hurt': { event: '', target: 'self' },
  'minecraft:on_hurt_by_player': { event: '', target: 'self' },
  'minecraft:preferred_path': { max_fall_blocks: 1, jump_cost: 5, default_block_cost: 1.5, preferred_path_blocks: [{ cost: 0, blocks: ['minecraft:grass_path'] }, { cost: 1, blocks: ['minecraft:cobblestone', 'minecraft:stone_bricks', 'minecraft:oak_planks'] }] },
  'minecraft:behavior.panic': { speed_multiplier: 1.25 },
  'minecraft:behavior.random_stroll': { speed_multiplier: 1 },
  'minecraft:behavior.look_at_player': { look_distance: 6, probability: 0.02 },
  'minecraft:behavior.tempt': { speed_multiplier: 1.2, items: ['minecraft:wheat'] },
  'minecraft:behavior.follow_owner': { speed_multiplier: 1, start_distance: 10, stop_distance: 2 },
  'minecraft:behavior.follow_parent': { speed_multiplier: 1.1 },
  'minecraft:behavior.breed': { speed_multiplier: 1 },
  'minecraft:behavior.nearest_attackable_target': { must_see: true, reselect_targets: true, within_radius: 16, entity_types: [{ filters: { test: 'is_family', subject: 'other', value: 'player' }, max_dist: 16 }] },
  'minecraft:behavior.hurt_by_target': {},
  'minecraft:behavior.avoid_mob_type': { entity_types: [{ filters: { test: 'is_family', subject: 'other', value: 'player' }, max_dist: 8, walk_speed_multiplier: 1, sprint_speed_multiplier: 1.2 }] },
  'minecraft:behavior.ranged_attack': { attack_interval: { min: 1, max: 3 }, attack_range: { min: 0, max: 15 } },
  'minecraft:behavior.leap_at_target': { yd: 0.4, must_be_on_ground: false },
  'minecraft:behavior.sleep': { sleep_collider_height: 0.3, sleep_collider_width: 1, sleep_y_offset: 0.6, speed_multiplier: 0.6, timeout_cooldown: 10 },
  'minecraft:behavior.mingle': { speed_multiplier: 0.5, duration: 30, cooldown_time: 10, mingle_distance: 2 },
  'minecraft:behavior.defend_village_target': { must_reach: true, entity_types: [{ filters: { any_of: [{ test: 'is_family', subject: 'other', value: 'mob' }, { test: 'is_family', subject: 'other', value: 'player' }] } }] },
  'minecraft:behavior.move_through_village': { speed_multiplier: 0.6, only_at_night: true },
  'minecraft:behavior.move_towards_dwelling_restriction': { speed_multiplier: 0.6 },
  'minecraft:behavior.stroll_towards_village': { speed_multiplier: 1, goal_radius: 3, cooldown_time: 10, search_range: 32, start_chance: 0.005 },
  'minecraft:behavior.move_to_village': { speed_multiplier: 1, goal_radius: 2 },
  'minecraft:behavior.hide': { speed_multiplier: 0.8, poi_type: 'bed', duration: 30 },
  'minecraft:behavior.share_items': { max_dist: 3, goal_radius: 2, speed_multiplier: 0.5, entity_types: [{ filters: { test: 'is_family', subject: 'other', value: 'villager' } }] },
  'minecraft:behavior.explore_outskirts': { speed_multiplier: 0.6, explore_dist: 6 },
  'minecraft:behavior.trade_interest': { within_radius: 6, interest_time: 45, remove_item_time: 1, carried_item_switch_time: 2, cooldown: 2 },
  'minecraft:behavior.random_swim': { speed_multiplier: 1, xz_dist: 16, y_dist: 4 },
  'minecraft:behavior.random_hover': { xz_dist: 8, y_dist: 8, y_offset: -1, interval: 1, hover_height: { min: 1, max: 4 } },
  'minecraft:behavior.random_fly': { speed_multiplier: 1, xz_dist: 12, y_dist: 6 },
  'minecraft:behavior.eat_block': { success_chance: 'query.is_baby ? 0.02 : 0.001', time_until_eat: 1.8, eat_and_replace_block_pairs: [{ eat_block: 'minecraft:short_grass', replace_block: 'minecraft:air' }] },
  'minecraft:behavior.timer_flag_1': { cooldown_range: { min: 10, max: 20 }, duration_range: { min: 2, max: 4 } },
};

export function isBehavior(id) { return id.startsWith('minecraft:behavior.'); }

export function nextPriority(components) {
  let max = -1;
  for (const [id, v] of Object.entries(components)) if (isBehavior(id) && isObj(v) && typeof v.priority === 'number') max = Math.max(max, v.priority);
  return max + 1;
}

export function starterFor(id, components = {}) {
  const spec = catalog.components[id];
  let v = STARTERS[id] ? clone(STARTERS[id]) : {};
  if (!STARTERS[id] && spec) for (const f of spec.f) if (f.req && f.d !== undefined) v[f.k] = clone(f.d);
  if (isBehavior(id)) v = { priority: nextPriority(components), ...v };
  return v;
}

export function label(id) { return titleCase(id); }
export function docsUrl(id) {
  return `https://learn.microsoft.com/en-us/search/?terms=${encodeURIComponent(id)}&category=Documentation`;
}

export function allComponents() {
  return Object.keys(catalog.components).map((id) => ({ id, cat: categoryOf(id), label: label(id), desc: DESC[id] || '' }));
}

const FIELD_HELP = {
  priority: 'Lower runs first. Goals with the same priority can run together.',
  speed_multiplier: 'Multiplies its movement speed while doing this.',
  filters: 'Conditions that must be true.',
  event: 'Event to run (define it in the Events tab).',
  target: 'Who receives the event.',
  within_radius: 'Search radius in blocks.',
  look_distance: 'Blocks.',
  probability: '0–1 chance each tick.',
  max_dist: 'Blocks.',
  must_see: 'Only targets it can see.',
};
export const fieldHelp = (k) => FIELD_HELP[k] || '';

/** Which shared <datalist> a free-text field should suggest from. */
export function suggestList(key = '', spec = {}) {
  if (spec.t === 'item') return 'dl-items';
  if (spec.t === 'block') return 'dl-blocks';
  const k = String(key);
  if (/^(family|family_types|families)$/.test(k)) return 'dl-families';
  if (/(^|_)items?$|_item$|^item$|feed_items|tame_items|breed_items|drop_items|result_item|transform_to_item|^def_item/.test(k)) return 'dl-items';
  if (/block/.test(k)) return 'dl-blocks';
  if (/(^event$|_event$|^on_)/.test(k)) return 'dl-events';
  if (/^(entity_type|mate_type|baby_type|into|def|spawn_entity|mingle_partner_type|entity|identifier)$/.test(k)) return 'dl-entities';
  if (/effect/.test(k)) return 'dl-effects';
  if (/sound/.test(k)) return 'dl-sounds';
  if (k === 'component_groups') return 'dl-groups';
  if (k === 'domain') return 'dl-props';
  return null;
}

export const TARGET_SUBJECTS = ['self', 'other', 'player', 'target', 'parent', 'baby', 'damager', 'block'];
