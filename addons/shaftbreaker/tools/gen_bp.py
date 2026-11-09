"""Generates behavior-pack JSON (entities, items, blocks, loot, recipes, spawn rules) and the
resource-pack definitions that pair with them. Hand-tuned values live here so they are reviewable."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, 'Shaftbreaker_BP')
RP = os.path.join(ROOT, 'Shaftbreaker_RP')
NS = 'shaftbreaker'
VERSION = [2, 1, 0]
MIN_ENGINE = [1, 21, 120]
UUID = {
    'bp_header': '6f1c2b0e-3a5d-4c7e-9b21-5d8e7a4c1f01',
    'bp_data': '6f1c2b0e-3a5d-4c7e-9b21-5d8e7a4c1f02',
    'bp_script': '6f1c2b0e-3a5d-4c7e-9b21-5d8e7a4c1f03',
    'rp_header': '9a7d3e51-2b4c-4f86-8e19-3c6b5a2d7e01',
    'rp_res': '9a7d3e51-2b4c-4f86-8e19-3c6b5a2d7e02',
}


def w(base, rel, obj):
    p = os.path.join(base, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f:
        json.dump(obj, f, indent=2)


# =============================================================== manifests
def manifests():
    w(BP, 'manifest.json', {
        'format_version': 2,
        'header': {'name': 'pack.name', 'description': 'pack.description', 'uuid': UUID['bp_header'],
                   'version': VERSION, 'min_engine_version': MIN_ENGINE},
        'modules': [
            {'type': 'data', 'uuid': UUID['bp_data'], 'version': VERSION},
            {'type': 'script', 'language': 'javascript', 'uuid': UUID['bp_script'], 'version': VERSION, 'entry': 'scripts/main.js'},
        ],
        'dependencies': [
            {'uuid': UUID['rp_header'], 'version': VERSION},
            {'module_name': '@minecraft/server', 'version': '2.3.0'},
            {'module_name': '@minecraft/server-ui', 'version': '2.0.0'},
        ],
        'metadata': {'authors': ['Shaftbreaker add-on'], 'product_type': 'addon'},
    })
    w(RP, 'manifest.json', {
        'format_version': 2,
        'header': {'name': 'pack.name', 'description': 'pack.description', 'uuid': UUID['rp_header'],
                   'version': VERSION, 'min_engine_version': MIN_ENGINE},
        'modules': [{'type': 'resources', 'uuid': UUID['rp_res'], 'version': VERSION}],
        'dependencies': [{'uuid': UUID['bp_header'], 'version': VERSION}],
        'metadata': {'authors': ['Shaftbreaker add-on'], 'product_type': 'addon'},
    })


# =============================================================== the Shaftbreaker
def mode(name, comps):
    return name, comps


def hunt_target_filter():
    return {'all_of': [
        {'test': 'is_family', 'subject': 'other', 'value': 'player'},
        {'test': 'has_tag', 'subject': 'other', 'value': 'sb_target'},
    ]}


def shaftbreaker():
    look = {'priority': 7, 'look_distance': 48, 'probability': 1.0, 'angle_of_view_horizontal': 360, 'angle_of_view_vertical': 180,
            'look_time': [4, 8]}
    hunt_target = {'priority': 1, 'must_see': False, 'reselect_targets': True, 'within_radius': 64, 'attack_interval': 1,
                   'must_see_forget_duration': 20,
                   'entity_types': [{'filters': hunt_target_filter(), 'max_dist': 64, 'must_see': False}]}

    def hunt(speed, mult, cooldown, damage=6):
        return {
            'minecraft:movement': {'value': speed},
            'minecraft:attack': {'damage': damage},
            'minecraft:behavior.nearest_attackable_target': hunt_target,
            'minecraft:behavior.delayed_attack': {'priority': 2, 'attack_once': False, 'track_target': True, 'require_complete_path': False,
                                                  'random_stop_interval': 0, 'reach_multiplier': 1.35, 'speed_multiplier': mult,
                                                  'attack_duration': 0.9, 'hit_delay_pct': 0.55, 'cooldown_time': cooldown},
            'minecraft:behavior.float': {'priority': 0},
        }

    groups = {
        'sb:mode_still': {'minecraft:movement': {'value': 0.0}, 'minecraft:behavior.look_at_player': look},
        'sb:mode_scripted': {'minecraft:movement': {'value': 0.25}},
        'sb:mode_hunt': hunt(0.36, 1.0, 0.75, 7),
        'sb:mode_frenzy': hunt(0.45, 1.12, 0.6, 8),
        # rage: it snaps (stared down, shot, struck, cornered) and comes faster than a sprinting player
        'sb:mode_rage': hunt(0.44, 1.3, 0.55, 8),
        'sb:mode_defeated': {'minecraft:movement': {'value': 0.0}, 'minecraft:body_rotation_blocked': {},
                             'minecraft:damage_sensor': {'triggers': [{'cause': 'all', 'deals_damage': 'no'}]}},
        'sb:grav_on': {'minecraft:physics': {}},
        'sb:grav_off': {'minecraft:physics': {'has_gravity': False, 'has_collision': True}},
        'sb:stance_stand': {'minecraft:collision_box': {'width': 0.8, 'height': 1.9},
                            'minecraft:custom_hit_test': {'hitboxes': [{'width': 1.2, 'height': 3.0, 'pivot': [0, 1.5, 0]}]}},
        'sb:stance_crouch': {'minecraft:collision_box': {'width': 0.8, 'height': 1.9},
                             'minecraft:custom_hit_test': {'hitboxes': [{'width': 1.2, 'height': 1.9, 'pivot': [0, 0.95, 0]}]}},
        'sb:stance_crawl': {'minecraft:collision_box': {'width': 0.8, 'height': 0.9},
                            'minecraft:custom_hit_test': {'hitboxes': [{'width': 1.5, 'height': 1.0, 'pivot': [0, 0.5, 0]}]}},
        'sb:nav_walk': {'minecraft:navigation.walk': {'can_path_over_water': True, 'avoid_damage_blocks': True, 'can_pass_doors': True,
                                                      'can_open_doors': False, 'is_amphibious': True, 'can_walk': True, 'can_sink': False}},
        'sb:nav_doors': {'minecraft:navigation.walk': {'can_path_over_water': True, 'avoid_damage_blocks': True, 'can_pass_doors': True,
                                                       'can_open_doors': True, 'is_amphibious': True, 'can_walk': True, 'can_sink': False},
                         'minecraft:annotation.open_door': {}},
        'sb:nav_climb': {'minecraft:navigation.climb': {'can_path_over_water': True, 'avoid_damage_blocks': True, 'can_pass_doors': True,
                                                        'can_open_doors': False, 'is_amphibious': True, 'can_sink': False}},
        'sb:despawn': {'minecraft:instant_despawn': {}},
    }
    cats = {
        'mode': ['sb:mode_still', 'sb:mode_hunt', 'sb:mode_frenzy', 'sb:mode_rage', 'sb:mode_scripted', 'sb:mode_defeated'],
        'grav': ['sb:grav_on', 'sb:grav_off'],
        'stance': ['sb:stance_stand', 'sb:stance_crouch', 'sb:stance_crawl'],
        'nav': ['sb:nav_walk', 'sb:nav_doors', 'sb:nav_climb'],
    }
    events = {
        'minecraft:entity_spawned': {'add': {'component_groups': ['sb:mode_still', 'sb:grav_on', 'sb:stance_stand', 'sb:nav_walk']}},
        'sb:despawn': {'add': {'component_groups': ['sb:despawn']}},
        'sb:defeated': {'sequence': [
            {'remove': {'component_groups': [g for g in cats['mode'] if g != 'sb:mode_defeated']}},
            {'add': {'component_groups': ['sb:mode_defeated']}},
            {'set_property': {'shaftbreaker:act': 29, 'shaftbreaker:phase': 'dormant'}},
        ]},
    }
    for cat, gl in cats.items():
        for g in gl:
            if g == 'sb:mode_defeated':
                continue
            events[g] = {'filters': {'test': 'bool_property', 'domain': 'shaftbreaker:defeated', 'operator': '!='},
                         'remove': {'component_groups': [o for o in gl if o != g]}, 'add': {'component_groups': [g]}}
    events['sb:defeated']['sequence'].append({'set_property': {'shaftbreaker:defeated': True}})

    ent = {
        'format_version': '1.21.90',
        'minecraft:entity': {
            'description': {
                'identifier': f'{NS}:shaftbreaker', 'is_spawnable': True, 'is_summonable': True, 'spawn_category': 'monster',
                'properties': {
                    'shaftbreaker:phase': {'type': 'enum', 'values': ['dormant', 'stalking', 'watching', 'breaker', 'frenzy'], 'default': 'dormant', 'client_sync': True},
                    'shaftbreaker:act': {'type': 'int', 'range': [0, 63], 'default': 0, 'client_sync': True},
                    'shaftbreaker:stance': {'type': 'int', 'range': [0, 2], 'default': 0, 'client_sync': True},
                    'shaftbreaker:gait': {'type': 'int', 'range': [0, 2], 'default': 0, 'client_sync': True},
                    'shaftbreaker:spectral': {'type': 'bool', 'default': False, 'client_sync': True},
                    'shaftbreaker:eyes': {'type': 'float', 'range': [0.0, 1.0], 'default': 0.85, 'client_sync': True},
                    'shaftbreaker:moving': {'type': 'float', 'range': [0.0, 1.0], 'default': 0.0, 'client_sync': True},
                    'shaftbreaker:defeated': {'type': 'bool', 'default': False, 'client_sync': False},
                },
            },
            'component_groups': groups,
            'components': {
                'minecraft:type_family': {'family': ['shaftbreaker', 'monster', 'mob']},
                'minecraft:health': {'value': 112, 'max': 112},
                'minecraft:attack': {'damage': 6},
                'minecraft:follow_range': {'value': 64, 'max': 64},
                'minecraft:movement.basic': {},
                'minecraft:jump.static': {},
                'minecraft:can_climb': {},
                'minecraft:variable_max_auto_step': {'base_value': 1.0625, 'jump_prevented_value': 0.5625},
                'minecraft:breathable': {'breathes_air': True, 'breathes_water': True, 'suffocate_time': 0, 'total_supply': 15},
                'minecraft:underwater_movement': {'value': 0.07},
                'minecraft:knockback_resistance': {'value': 0.55},
                'minecraft:pushable': {'is_pushable': False, 'is_pushable_by_piston': True},
                'minecraft:nameable': {},
                'minecraft:ambient_sound_interval': {'value': 7, 'range': 9, 'event_name': 'ambient'},
                'minecraft:conditional_bandwidth_optimization': {},
                'minecraft:despawn': {'despawn_from_distance': {'min_distance': 80, 'max_distance': 128}},
                'minecraft:loot': {'table': 'loot_tables/entities/shaftbreaker.json'},
                'minecraft:experience_reward': {'on_death': 'q.last_hit_by_player ? 45 : 0'},
                'minecraft:damage_sensor': {'triggers': [
                    # Defeat is a scripted collapse, not an instant vanilla death: once health is low the
                    # next hit is absorbed and the defeat sequence starts (see scripts/creature.js).
                    {'cause': 'all', 'deals_damage': 'no',
                     'on_damage': {'filters': {'all_of': [
                         {'test': 'actor_health', 'subject': 'self', 'operator': '<=', 'value': 22},
                         {'test': 'bool_property', 'subject': 'self', 'domain': 'shaftbreaker:defeated', 'operator': '!='}]},
                         'event': 'sb:defeated'}},
                    {'cause': 'drowning', 'deals_damage': 'no'},
                    {'cause': 'suffocation', 'deals_damage': 'no'},
                    {'cause': 'fall', 'deals_damage': 'yes', 'damage_multiplier': 0.4},
                    {'cause': 'fire', 'deals_damage': 'yes', 'damage_multiplier': 0.5},
                    {'cause': 'fire_tick', 'deals_damage': 'yes', 'damage_multiplier': 0.5},
                ]},
            },
            'events': events,
        }
    }
    w(BP, 'entities/shaftbreaker.json', ent)


def moth():
    w(BP, 'entities/shaft_moth.json', {
        'format_version': '1.21.90',
        'minecraft:entity': {
            'description': {'identifier': f'{NS}:shaft_moth', 'is_spawnable': True, 'is_summonable': True, 'spawn_category': 'ambient',
                            'properties': {'shaftbreaker:clue': {'type': 'bool', 'default': False, 'client_sync': True}}},
            'component_groups': {
                'sb:despawn': {'minecraft:instant_despawn': {}},
                'sb:wander': {
                    'minecraft:behavior.random_hover': {'priority': 4, 'xz_dist': 6, 'y_dist': 4, 'y_offset': -1, 'interval': 1, 'hover_height': [1, 3]},
                    'minecraft:behavior.avoid_mob_type': {'priority': 2, 'entity_types': [{'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'},
                                                                                           'max_dist': 3, 'walk_speed_multiplier': 1.0, 'sprint_speed_multiplier': 1.2}]},
                    'minecraft:despawn': {'despawn_from_distance': {'min_distance': 32, 'max_distance': 64}},
                },
                'sb:guide': {'minecraft:physics': {'has_gravity': False, 'has_collision': True}},
            },
            'components': {
                'minecraft:type_family': {'family': ['shaft_moth', 'ambient', 'arthropod']},
                'minecraft:health': {'value': 3, 'max': 3},
                'minecraft:collision_box': {'width': 0.4, 'height': 0.35},
                'minecraft:physics': {},
                'minecraft:can_fly': {},
                'minecraft:flying_speed': {'value': 0.12},
                'minecraft:movement': {'value': 0.25},
                'minecraft:movement.hover': {},
                'minecraft:navigation.hover': {'can_path_over_water': True, 'can_sink': False, 'can_pass_doors': False, 'can_path_from_air': True,
                                               'avoid_water': True, 'avoid_damage_blocks': True, 'avoid_sun': False},
                'minecraft:breathable': {'breathes_air': True, 'breathes_water': False, 'total_supply': 15, 'suffocate_time': 0},
                'minecraft:pushable': {'is_pushable': True, 'is_pushable_by_piston': True},
                'minecraft:damage_sensor': {'triggers': [{'cause': 'fall', 'deals_damage': 'no'}]},
                'minecraft:loot': {'table': 'loot_tables/entities/shaft_moth.json'},
                'minecraft:nameable': {},
            },
            'events': {
                'minecraft:entity_spawned': {'add': {'component_groups': ['sb:wander']}},
                'sb:become_guide': {'remove': {'component_groups': ['sb:wander']}, 'add': {'component_groups': ['sb:guide']}},
                'sb:despawn': {'add': {'component_groups': ['sb:despawn']}},
            },
        }
    })
    w(BP, 'spawn_rules/shaft_moth.json', {
        'format_version': '1.17.0',
        'minecraft:spawn_rules': {
            'description': {'identifier': f'{NS}:shaft_moth', 'population_control': 'ambient'},
            'conditions': [{
                'minecraft:spawns_underground': {},
                'minecraft:spawns_on_block_filter': ['minecraft:stone', 'minecraft:deepslate', 'minecraft:tuff', 'minecraft:andesite', 'minecraft:granite', 'minecraft:diorite'],
                'minecraft:brightness_filter': {'min': 0, 'max': 5, 'adjust_for_weather': False},
                'minecraft:height_filter': {'min': -56, 'max': 40},
                'minecraft:weight': {'default': 3},
                'minecraft:herd': {'min_size': 1, 'max_size': 2},
                'minecraft:density_limit': {'underground': 2},
                'minecraft:biome_filter': [{'test': 'has_biome_tag', 'value': 'overworld'},
                                           {'test': 'has_biome_tag', 'operator': 'not', 'value': 'deep_dark'}],
            }]
        }
    })


# =============================================================== items
def items():
    def item(ident, comps, cat='items'):
        return {'format_version': '1.21.40', 'minecraft:item': {
            'description': {'identifier': ident, 'menu_category': {'category': cat}}, 'components': comps}}
    w(BP, 'items/shaftbreaker_skull.json', item(f'{NS}:shaftbreaker_skull', {
        'minecraft:icon': 'sb_skull',
        'minecraft:display_name': {'value': 'item.shaftbreaker:shaftbreaker_skull.name'},
        'minecraft:max_stack_size': 1,
        'minecraft:wearable': {'slot': 'slot.armor.head', 'protection': 2},
        'minecraft:enchantable': {'slot': 'armor_head', 'value': 12},
        'minecraft:rarity': 'rare',
    }, 'equipment'))
    w(BP, 'items/resonance_dial.json', item(f'{NS}:resonance_dial', {
        'minecraft:icon': 'sb_resonance_dial',
        'minecraft:display_name': {'value': 'item.shaftbreaker:resonance_dial.name'},
        'minecraft:max_stack_size': 1,
        'minecraft:hand_equipped': False,
    }, 'equipment'))
    w(BP, 'items/resonance_shard.json', item(f'{NS}:resonance_shard', {
        'minecraft:icon': 'sb_resonance_shard',
        'minecraft:display_name': {'value': 'item.shaftbreaker:resonance_shard.name'},
        'minecraft:max_stack_size': 64,
    }))
    w(BP, 'recipes/resonance_dial.json', {'format_version': '1.20.10', 'minecraft:recipe_shaped': {
        'description': {'identifier': f'{NS}:resonance_dial'}, 'tags': ['crafting_table'],
        'pattern': [' C ', 'CSC', ' R '],
        'key': {'C': {'item': 'minecraft:copper_ingot'}, 'S': {'item': f'{NS}:resonance_shard'}, 'R': {'item': 'minecraft:redstone'}},
        'unlock': [{'item': 'minecraft:copper_ingot'}],
        'result': {'item': f'{NS}:resonance_dial'}}})
    w(BP, 'recipes/resonance_dial_basic.json', {'format_version': '1.20.10', 'minecraft:recipe_shaped': {
        'description': {'identifier': f'{NS}:resonance_dial_basic'}, 'tags': ['crafting_table'],
        'pattern': [' C ', 'CAC', ' R '],
        'key': {'C': {'item': 'minecraft:copper_ingot'}, 'A': {'item': 'minecraft:amethyst_shard'}, 'R': {'item': 'minecraft:redstone'}},
        'unlock': [{'item': 'minecraft:amethyst_shard'}],
        'result': {'item': f'{NS}:resonance_dial'}}})
    w(BP, 'recipes/cairn_marker.json', {'format_version': '1.20.10', 'minecraft:recipe_shaped': {
        'description': {'identifier': f'{NS}:cairn_marker'}, 'tags': ['crafting_table'],
        'pattern': ['C', 'C', 'S'],
        'key': {'C': {'item': 'minecraft:cobblestone'}, 'S': {'item': 'minecraft:stick'}},
        'unlock': [{'item': 'minecraft:cobblestone'}],
        'result': {'item': f'{NS}:cairn_marker', 'count': 4}}})


# =============================================================== blocks
def blocks():
    def blk(ident, comps, cat='nature', traits=None, perms=None, states=None):
        desc = {'identifier': ident, 'menu_category': {'category': cat}}
        if traits:
            desc['traits'] = traits
        if states:
            desc['states'] = states
        b = {'format_version': '1.21.60', 'minecraft:block': {'description': desc, 'components': comps}}
        if perms:
            b['minecraft:block']['permutations'] = perms
        return b
    w(BP, 'blocks/den_heart.json', blk(f'{NS}:den_heart', {
        'minecraft:geometry': 'minecraft:geometry.full_block',
        'minecraft:destructible_by_mining': {'seconds_to_destroy': 7},
        'minecraft:destructible_by_explosion': {'explosion_resistance': 18},
        'minecraft:light_emission': 4,
        'minecraft:map_color': '#2b2523',
        'minecraft:material_instances': {'*': {'texture': 'sb_den_heart', 'render_method': 'opaque'}},
        'minecraft:loot': 'loot_tables/blocks/den_heart.json',
    }))
    w(BP, 'blocks/den_crack.json', blk(f'{NS}:den_crack', {
        'minecraft:geometry': 'minecraft:geometry.full_block',
        'minecraft:destructible_by_mining': {'seconds_to_destroy': 2.5},
        'minecraft:destructible_by_explosion': {'explosion_resistance': 6},
        'minecraft:map_color': '#46413f',
        'minecraft:material_instances': {'*': {'texture': 'sb_den_crack', 'render_method': 'opaque'}},
        'minecraft:loot': 'loot_tables/blocks/empty.json',
    }))
    w(BP, 'blocks/den_dust.json', blk(f'{NS}:den_dust', {
        'minecraft:destructible_by_mining': {'seconds_to_destroy': 0.3},
        'minecraft:collision_box': False,
        'minecraft:selection_box': {'origin': [-8, 0, -8], 'size': [16, 1, 16]},
        'minecraft:geometry': 'geometry.sb_dust_layer',
        'minecraft:light_dampening': 0,
        'minecraft:map_color': '#6f6a64',
        'minecraft:material_instances': {'*': {'texture': 'sb_den_dust', 'render_method': 'alpha_test'}},
        'minecraft:placement_filter': {'conditions': [{'allowed_faces': ['up'], 'block_filter': [{'tags': "!q.any_tag('air')"}]}]},
        'minecraft:loot': 'loot_tables/blocks/empty.json',
    }))
    w(BP, 'blocks/den_spine.json', blk(f'{NS}:den_spine', {
        'minecraft:destructible_by_mining': {'seconds_to_destroy': 0.8},
        'minecraft:collision_box': False,
        'minecraft:selection_box': {'origin': [-4, 0, -4], 'size': [8, 14, 8]},
        'minecraft:geometry': 'geometry.sb_spine',
        'minecraft:light_dampening': 0,
        'minecraft:map_color': '#d8cdb8',
        'minecraft:material_instances': {'*': {'texture': 'sb_den_spine', 'render_method': 'alpha_test', 'face_dimming': False}},
        'minecraft:loot': 'loot_tables/blocks/den_spine.json',
    }, states={'shaftbreaker:hanging': [False, True]},
        perms=[{'condition': "q.block_state('shaftbreaker:hanging') == true",
                'components': {'minecraft:transformation': {'rotation': [180, 0, 0]}}}]))
    w(BP, 'blocks/cairn_marker.json', blk(f'{NS}:cairn_marker', {
        'minecraft:destructible_by_mining': {'seconds_to_destroy': 0.6},
        'minecraft:collision_box': {'origin': [-4, 0, -4], 'size': [8, 10, 8]},
        'minecraft:selection_box': {'origin': [-4, 0, -4], 'size': [8, 10, 8]},
        'minecraft:geometry': 'geometry.sb_cairn',
        'minecraft:light_dampening': 0,
        'minecraft:map_color': '#7a7674',
        'minecraft:material_instances': {'*': {'texture': 'sb_cairn', 'render_method': 'opaque'},
                                         'top': {'texture': 'sb_cairn_top', 'render_method': 'opaque'}},
    }, cat='construction', traits={'minecraft:placement_direction': {'enabled_states': ['minecraft:cardinal_direction']}},
        perms=[{'condition': f"q.block_state('minecraft:cardinal_direction') == '{d}'",
                'components': {'minecraft:transformation': {'rotation': [0, r, 0]}}}
               for d, r in [('north', 0), ('west', 90), ('south', 180), ('east', 270)]]))
    # loot
    w(BP, 'loot_tables/blocks/empty.json', {'pools': []})
    w(BP, 'loot_tables/blocks/den_heart.json', {'pools': [
        {'rolls': 1, 'entries': [{'type': 'item', 'name': f'{NS}:resonance_shard', 'weight': 1,
                                  'functions': [{'function': 'set_count', 'count': {'min': 2, 'max': 4}}]}]},
        {'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:bone', 'weight': 1, 'functions': [{'function': 'set_count', 'count': {'min': 1, 'max': 3}}]}]},
    ]})
    w(BP, 'loot_tables/blocks/den_spine.json', {'pools': [{'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:bone', 'weight': 1}]}]})


def loot():
    w(BP, 'loot_tables/entities/shaftbreaker.json', {'pools': [
        {'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:bone', 'weight': 1, 'functions': [{'function': 'set_count', 'count': {'min': 2, 'max': 5}}]}]},
        {'rolls': 1, 'entries': [{'type': 'item', 'name': f'{NS}:resonance_shard', 'weight': 1, 'functions': [{'function': 'set_count', 'count': {'min': 1, 'max': 3}}]}]},
        {'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:raw_iron', 'weight': 3, 'functions': [{'function': 'set_count', 'count': {'min': 1, 'max': 3}}]},
                                 {'type': 'item', 'name': 'minecraft:coal', 'weight': 3, 'functions': [{'function': 'set_count', 'count': {'min': 2, 'max': 5}}]},
                                 {'type': 'empty', 'weight': 2}]},
    ]})
    w(BP, 'loot_tables/entities/shaft_moth.json', {'pools': [{'rolls': 1, 'entries': [
        {'type': 'item', 'name': 'minecraft:glowstone_dust', 'weight': 1}, {'type': 'empty', 'weight': 4}]}]})


if __name__ == '__main__':
    manifests(); shaftbreaker(); moth(); items(); blocks(); loot()
    old = os.path.join(BP, 'entities/waypoint.json')
    if os.path.exists(old):
        os.remove(old)
    print('behavior pack JSON generated')
