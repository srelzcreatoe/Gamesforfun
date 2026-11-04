"""Assemble the Bedrock resource pack, behavior pack, .mcaddon and Blockbench project."""
import json, os, shutil, sys, uuid, zipfile
from PIL import Image

SRC = 'out'
DST = sys.argv[1]
RP = os.path.join(DST, 'resource_pack')
BP = os.path.join(DST, 'behavior_pack')
ID = 'brine:brinesleeper'

# fixed UUIDs so re-running the script produces the same packs
RP_H, RP_M = '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e01', '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e02'
BP_H, BP_M = '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e03', '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e04'
VER = [1, 0, 0]


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')


for d in (RP, BP):
    if os.path.exists(d):
        shutil.rmtree(d)

# ------------------------------------------------------------------ resource pack
write(f'{RP}/manifest.json', {
    'format_version': 2,
    'header': {'name': 'Brinesleeper Resources', 'description': 'The Brinesleeper - aquatic cave dweller (model, texture, animations)',
               'uuid': RP_H, 'version': VER, 'min_engine_version': [1, 20, 0]},
    'modules': [{'type': 'resources', 'uuid': RP_M, 'version': VER}],
})
os.makedirs(f'{RP}/models/entity', exist_ok=True)
os.makedirs(f'{RP}/textures/entity', exist_ok=True)
os.makedirs(f'{RP}/animations', exist_ok=True)
shutil.copy(f'{SRC}/brinesleeper.geo.json', f'{RP}/models/entity/brinesleeper.geo.json')
shutil.copy(f'{SRC}/brinesleeper.png', f'{RP}/textures/entity/brinesleeper.png')
shutil.copy(f'{SRC}/brinesleeper.animation.json', f'{RP}/animations/brinesleeper.animation.json')

write(f'{RP}/entity/brinesleeper.entity.json', {
    'format_version': '1.10.0',
    'minecraft:client_entity': {
        'description': {
            'identifier': ID,
            'materials': {'default': 'entity_alphatest'},
            'textures': {'default': 'textures/entity/brinesleeper'},
            'geometry': {'default': 'geometry.brinesleeper'},
            'animations': {
                'watch': 'animation.brinesleeper.watch',
                'idle_water': 'animation.brinesleeper.idle_water',
                'walk': 'animation.brinesleeper.walk',
                'stalk': 'animation.brinesleeper.crouch_stalk',
                'run': 'animation.brinesleeper.run',
                'swim': 'animation.brinesleeper.swim',
                'lunge': 'animation.brinesleeper.lunge',
                'grasp': 'animation.brinesleeper.grasp',
                'emerge': 'animation.brinesleeper.emerge',
                'submerge': 'animation.brinesleeper.submerge',
                'look_at_target': 'animation.brinesleeper.look_at_target',
                'move': 'controller.animation.brinesleeper.move',
                'attack': 'controller.animation.brinesleeper.attack',
                'look': 'controller.animation.brinesleeper.look',
            },
            'scripts': {'animate': ['move', 'attack', 'look']},
            'render_controllers': ['controller.render.brinesleeper'],
            'spawn_egg': {'base_color': '#2b2427', 'overlay_color': '#c9bcc1'},
        }
    }
})
write(f'{RP}/render_controllers/brinesleeper.render_controllers.json', {
    'format_version': '1.8.0',
    'render_controllers': {'controller.render.brinesleeper': {
        'geometry': 'Geometry.default', 'materials': [{'*': 'Material.default'}], 'textures': ['Texture.default']}},
})
moving = 'query.modified_move_speed > 0.02'
write(f'{RP}/animation_controllers/brinesleeper.animation_controllers.json', {
    'format_version': '1.10.0',
    'animation_controllers': {
        'controller.animation.brinesleeper.move': {
            'initial_state': 'land_idle',
            'states': {
                'land_idle': {'animations': ['watch'], 'blend_transition': 0.3, 'transitions': [
                    {'water_idle': 'query.is_in_water'}, {'run': 'query.modified_move_speed > 0.55'},
                    {'stalk': f'{moving} && query.has_target'}, {'walk': moving}]},
                'walk': {'animations': ['walk'], 'blend_transition': 0.25, 'transitions': [
                    {'water_idle': 'query.is_in_water'}, {'run': 'query.modified_move_speed > 0.55'},
                    {'stalk': 'query.has_target'}, {'land_idle': f'!({moving})'}]},
                'stalk': {'animations': ['stalk'], 'blend_transition': 0.3, 'transitions': [
                    {'water_idle': 'query.is_in_water'}, {'run': 'query.modified_move_speed > 0.55'},
                    {'walk': f'!query.has_target && {moving}'}, {'land_idle': f'!({moving})'}]},
                'run': {'animations': ['run'], 'blend_transition': 0.2, 'transitions': [
                    {'water_idle': 'query.is_in_water'},
                    {'stalk': 'query.modified_move_speed <= 0.5 && query.has_target'}, {'walk': 'query.modified_move_speed <= 0.5'}]},
                'water_idle': {'animations': ['idle_water'], 'blend_transition': 0.4, 'transitions': [
                    {'land_idle': '!query.is_in_water'}, {'swim': 'query.modified_move_speed > 0.05'}]},
                'swim': {'animations': ['swim'], 'blend_transition': 0.4, 'transitions': [
                    {'land_idle': '!query.is_in_water'}, {'water_idle': 'query.modified_move_speed <= 0.05'}]},
            },
        },
        'controller.animation.brinesleeper.attack': {
            'initial_state': 'default',
            'states': {
                'default': {'transitions': [
                    {'grasp': 'query.is_in_water && variable.attack_time > 0'}, {'lunge': 'variable.attack_time > 0'}]},
                'lunge': {'animations': ['lunge'], 'blend_transition': 0.15, 'transitions': [{'default': 'query.all_animations_finished'}]},
                'grasp': {'animations': ['grasp'], 'blend_transition': 0.15, 'transitions': [{'default': 'query.all_animations_finished'}]},
            },
        },
        'controller.animation.brinesleeper.look': {
            'initial_state': 'default',
            'states': {'default': {'animations': ['look_at_target']}},
        },
    },
})
write(f'{RP}/texts/languages.json', ['en_US'])
os.makedirs(f'{RP}/texts', exist_ok=True)
with open(f'{RP}/texts/en_US.lang', 'w') as f:
    f.write(f'entity.{ID}.name=Brinesleeper\nitem.spawn_egg.entity.{ID}.name=Spawn Brinesleeper\n')

# ------------------------------------------------------------------ behavior pack
write(f'{BP}/manifest.json', {
    'format_version': 2,
    'header': {'name': 'Brinesleeper Behaviors', 'description': 'The Brinesleeper - amphibious cave hunter (starter AI)',
               'uuid': BP_H, 'version': VER, 'min_engine_version': [1, 20, 0]},
    'modules': [{'type': 'data', 'uuid': BP_M, 'version': VER}],
    'dependencies': [{'uuid': RP_H, 'version': VER}],
})
in_water = lambda v: {'test': 'in_water', 'subject': 'self', 'operator': '==', 'value': v}
write(f'{BP}/entities/brinesleeper.json', {
    'format_version': '1.16.0',
    'minecraft:entity': {
        'description': {'identifier': ID, 'is_spawnable': True, 'is_summonable': True, 'is_experimental': False},
        'component_groups': {
            'brine:wet': {'minecraft:mark_variant': {'value': 0}},
            'brine:dryland_hunt': {
                'minecraft:mark_variant': {'value': 1},
                'minecraft:timer': {'looping': False, 'time': [15, 20], 'randomInterval': True,
                                    'time_down_event': {'event': 'brine:dried_out', 'target': 'self'}},
            },
            'brine:dried_out': {
                'minecraft:mark_variant': {'value': 2},
                'minecraft:behavior.move_to_water': {'priority': 0, 'search_range': 24, 'search_height': 8,
                                                     'search_count': 1, 'goal_radius': 1.5, 'speed_multiplier': 1.4},
            },
        },
        'components': {
            'minecraft:type_family': {'family': ['brinesleeper', 'monster', 'mob']},
            'minecraft:health': {'value': 40, 'max': 40},
            'minecraft:attack': {'damage': 6},
            'minecraft:collision_box': {'width': 1.1, 'height': 3.4},
            'minecraft:movement': {'value': 0.25},
            'minecraft:underwater_movement': {'value': 0.15},
            'minecraft:navigation.generic': {'is_amphibious': True, 'can_path_over_water': False, 'can_swim': True,
                                             'can_walk': True, 'can_breach': True, 'avoid_damage_blocks': True},
            'minecraft:movement.amphibious': {'max_turn': 10},
            'minecraft:jump.static': {},
            'minecraft:breathable': {'total_supply': 15, 'suffocate_time': 0, 'breathes_water': True, 'breathes_air': True},
            'minecraft:physics': {},
            'minecraft:pushable': {'is_pushable': True, 'is_pushable_by_piston': True},
            'minecraft:nameable': {},
            'minecraft:despawn': {'despawn_from_distance': {}},
            'minecraft:follow_range': {'value': 32, 'max': 32},
            'minecraft:environment_sensor': {'triggers': [
                {'filters': {'all_of': [in_water(False), {'test': 'is_mark_variant', 'subject': 'self', 'operator': '==', 'value': 0}]},
                 'event': 'brine:left_water'},
                {'filters': {'all_of': [in_water(True), {'test': 'is_mark_variant', 'subject': 'self', 'operator': '!=', 'value': 0}]},
                 'event': 'brine:entered_water'},
            ]},
            'minecraft:behavior.hurt_by_target': {'priority': 1},
            'minecraft:behavior.nearest_attackable_target': {
                'priority': 2, 'must_see': True, 'reselect_targets': True, 'within_radius': 24,
                'entity_types': [{'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'}, 'max_dist': 24}]},
            'minecraft:behavior.melee_attack': {'priority': 3, 'speed_multiplier': 1.5, 'track_target': True},
            'minecraft:behavior.random_swim': {'priority': 6, 'speed_multiplier': 1.0, 'xz_dist': 10, 'y_dist': 5},
            'minecraft:behavior.random_stroll': {'priority': 7, 'speed_multiplier': 0.6},
            'minecraft:behavior.look_at_player': {'priority': 8, 'look_distance': 16, 'probability': 0.05},
            'minecraft:behavior.random_look_around': {'priority': 9},
        },
        'events': {
            'minecraft:entity_spawned': {'add': {'component_groups': ['brine:wet']}},
            'brine:left_water': {'remove': {'component_groups': ['brine:wet']}, 'add': {'component_groups': ['brine:dryland_hunt']}},
            'brine:dried_out': {'remove': {'component_groups': ['brine:dryland_hunt']}, 'add': {'component_groups': ['brine:dried_out']}},
            'brine:entered_water': {'remove': {'component_groups': ['brine:dryland_hunt', 'brine:dried_out']}, 'add': {'component_groups': ['brine:wet']}},
        },
    },
})
write(f'{BP}/spawn_rules/brinesleeper.json', {
    'format_version': '1.8.0',
    'minecraft:spawn_rules': {
        'description': {'identifier': ID, 'population_control': 'monster'},
        'conditions': [{
            'minecraft:spawns_underwater': {},
            'minecraft:brightness_filter': {'min': 0, 'max': 4, 'adjust_for_weather': False},
            'minecraft:height_filter': {'min': -60, 'max': 40},
            'minecraft:weight': {'default': 3},
            'minecraft:density_limit': {'surface': 1, 'underground': 2},
            'minecraft:herd': {'min_size': 1, 'max_size': 1},
            'minecraft:biome_filter': {'test': 'has_biome_tag', 'operator': '==', 'value': 'overworld'},
        }],
    },
})

# pack icons from the face close-up
face = Image.open(sys.argv[2]).convert('RGB')
s = min(face.size)
icon = face.crop(((face.width - s) // 2, 0, (face.width - s) // 2 + s, s)).resize((256, 256), Image.LANCZOS)
icon.save(f'{RP}/pack_icon.png'); icon.save(f'{BP}/pack_icon.png')

# .mcaddon (zip of both packs) for one-tap import on Bedrock
addon = os.path.join(DST, 'Brinesleeper.mcaddon')
with zipfile.ZipFile(addon, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, name in ((RP, 'Brinesleeper_RP'), (BP, 'Brinesleeper_BP')):
        for root, _, files in os.walk(base):
            for fn in files:
                full = os.path.join(root, fn)
                z.write(full, os.path.join(name, os.path.relpath(full, base)))
print('packs written to', DST)
