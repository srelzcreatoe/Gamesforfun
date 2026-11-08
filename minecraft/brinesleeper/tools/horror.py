"""The horror layer of the Brinesleeper add-on ("The Water Remembers"): everything the director script drives.

Writes into the packs (called from pack.py after biome.build):
  BP entities/brinesleeper.json   70 HP amphibious hunter whose AI is switched by events (roam, hold, observe, hunt,
                                  withdraw) and whose pose is the client-synced property brine:act
  BP entities/apparition.json     brine:apparition: a harmless, untouchable shape (silhouette, reflection, hand)
  RP entity/ render_controllers/ animation_controllers/ animations/
                                  act controller (every pose blends into every other: the crawl-to-stand rise is
                                  a 1.2 s blend, never a snap), shade texture, hand-only geometry, inverted reflection
  RP particles/                   brine:ripple, brine:bubbles, brine:drips, brine:splash
  RP sounds/                      synthesized creature and water sounds (merged into the biome's sound files)
  BP scripts/main.js              copied from tools/scripts/main.js
ACTS must match the ACT table in scripts/main.js (validate_packs.py checks it).
"""
import copy
import json
import math
import os
import shutil
import subprocess
import tempfile
import wave

import numpy as np
from PIL import Image

import biome

NS = 'brine'
ID = f'{NS}:brinesleeper'
SHADE = f'{NS}:apparition'
HERE = os.path.dirname(os.path.abspath(__file__))
ACTS = ['none', 'watch', 'submerged_watch', 'shoreline_stalk', 'corner_watch', 'distant_observer', 'full_stand', 'emerge',
        'submerge', 'ledge_watch', 'behind_cover', 'head_tilt', 'shadow_hide', 'tunnel_crawl', 'retreat', 'water_rise',
        'hunting_stance', 'slow_approach', 'patient_strike', 'veil_stalk', 'reflection_lurk', 'idle_water']
# how long the blend into each pose takes: rising onto two legs and dropping back down are slow, deliberate blends
BLEND = {'full_stand': 1.2, 'hunting_stance': 1.0, 'submerge': 0.6, 'emerge': 0.4, 'water_rise': 0.8, 'retreat': 0.6}
HOLD = ('emerge', 'submerge', 'water_rise', 'retreat', 'emerge_roar')     # one-shot poses keep their last frame
POSES = ('submerged_watch', 'shoreline_stalk', 'corner_watch', 'ceiling_lurk', 'distant_observer', 'veil_stalk',
         'reflection_lurk', 'tunnel_crawl', 'patient_strike', 'shadow_hide', 'full_stand', 'head_tilt', 'slow_approach',
         'emerge_roar', 'water_rise', 'hunting_stance', 'behind_cover', 'ledge_watch', 'retreat')


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')


def load(path):
    with open(path) as f:
        return json.load(f)


q = lambda name: f"query.property('{NS}:{name}')"


# =================================================================== behavior: the creature and the apparition
def creature_bp(BP, spawn_conditions):
    in_water = lambda v: {'test': 'in_water', 'subject': 'self', 'operator': '==', 'value': v}
    variant = lambda op, v: {'test': 'is_mark_variant', 'subject': 'self', 'operator': op, 'value': v}
    players = [{'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'}, 'max_dist': 24}]
    modes = ['brine:ai_roam', 'brine:ai_hold', 'brine:ai_observe', 'brine:ai_hunt', 'brine:ai_withdraw']
    # every mode group re-declares movement and physics: removing a group that overrode a component removes the
    # component itself, so the next mode must always bring its own
    move = lambda land, water: {'minecraft:movement': {'value': land}, 'minecraft:underwater_movement': {'value': water},
                                'minecraft:physics': {}}
    mode = lambda keep: {'remove': {'component_groups': [m for m in modes if m != keep]}, 'add': {'component_groups': [keep]}}
    write(f'{BP}/entities/brinesleeper.json', {
        'format_version': '1.21.0',
        'minecraft:entity': {
            'description': {
                'identifier': ID, 'is_spawnable': True, 'is_summonable': True, 'is_experimental': False,
                'properties': {f'{NS}:act': {'type': 'int', 'range': [0, 31], 'default': 0, 'client_sync': True}},
            },
            'component_groups': {
                # natural spawns may despawn; the director's staged creature never does (it removes it itself)
                'brine:natural': {'minecraft:despawn': {'despawn_from_distance': {}}},
                # what it does on its own: wanders the water and the shores, watches, does not hunt
                'brine:ai_roam': {
                    **move(0.25, 0.15),
                    'minecraft:behavior.random_swim': {'priority': 6, 'speed_multiplier': 1.0, 'xz_dist': 10, 'y_dist': 5},
                    'minecraft:behavior.random_stroll': {'priority': 7, 'speed_multiplier': 0.6},
                    'minecraft:behavior.look_at_player': {'priority': 8, 'look_distance': 16, 'probability': 0.05},
                    'minecraft:behavior.random_look_around': {'priority': 9},
                    'minecraft:behavior.hurt_by_target': {'priority': 1},
                    'minecraft:behavior.melee_attack': {'priority': 3, 'speed_multiplier': 1.5, 'track_target': True},
                },
                # held perfectly still in a pose the script chose: no AI, no gravity (it can float at the waterline)
                'brine:ai_hold': {
                    **move(0, 0),
                    'minecraft:physics': {'has_gravity': False, 'has_collision': True},
                },
                # still, but its eyes follow you
                'brine:ai_observe': {
                    **move(0, 0),
                    'minecraft:behavior.look_at_player': {'priority': 1, 'look_distance': 48, 'probability': 1.0},
                },
                # the hunt: fast on land, faster in the water, strikes for 5 (the script adds the 7-damage lunge)
                'brine:ai_hunt': {
                    **move(0.3, 0.2),
                    'minecraft:behavior.hurt_by_target': {'priority': 1},
                    'minecraft:behavior.nearest_attackable_target': {
                        'priority': 2, 'must_see': False, 'reselect_targets': True, 'within_radius': 32, 'entity_types': players},
                    'minecraft:behavior.melee_attack': {'priority': 3, 'speed_multiplier': 1.4, 'track_target': True},
                },
                # backs away from players and makes for the water
                'brine:ai_withdraw': {
                    **move(0.28, 0.18),
                    'minecraft:behavior.move_to_water': {'priority': 1, 'search_range': 24, 'search_height': 8, 'search_count': 1,
                                                         'goal_radius': 1.5, 'speed_multiplier': 1.5},
                    'minecraft:behavior.avoid_mob_type': {'priority': 2, 'entity_types': [
                        {'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'}, 'max_dist': 16,
                         'walk_speed_multiplier': 1.2, 'sprint_speed_multiplier': 1.5}]},
                    'minecraft:behavior.random_swim': {'priority': 6, 'speed_multiplier': 1.2, 'xz_dist': 12, 'y_dist': 6},
                },
                # Dryland Hunt: it can only stay out of the water for 15-20 s before it must go back
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
                'minecraft:health': {'value': 70, 'max': 70},
                'minecraft:attack': {'damage': 5},
                'minecraft:collision_box': {'width': 1.1, 'height': 3.4},
                'minecraft:movement': {'value': 0.25},
                'minecraft:underwater_movement': {'value': 0.15},
                'minecraft:navigation.generic': {'is_amphibious': True, 'can_path_over_water': False, 'can_swim': True,
                                                 'can_walk': True, 'can_breach': True, 'avoid_damage_blocks': True},
                'minecraft:movement.amphibious': {'max_turn': 10},
                'minecraft:jump.static': {},
                'minecraft:breathable': {'total_supply': 15, 'suffocate_time': 0, 'breathes_water': True, 'breathes_air': True},
                'minecraft:physics': {},
                'minecraft:pushable': {'is_pushable': False, 'is_pushable_by_piston': True},
                'minecraft:knockback_resistance': {'value': 0.6},
                'minecraft:nameable': {},
                'minecraft:persistent': {},
                'minecraft:follow_range': {'value': 32, 'max': 48},
                'minecraft:ambient_sound_interval': {'value': 14, 'range': 18, 'event_name': 'ambient'},
                'minecraft:damage_sensor': {'triggers': [{'cause': 'fall', 'deals_damage': 'no'}, {'cause': 'drowning', 'deals_damage': 'no'}]},
                'minecraft:environment_sensor': {'triggers': [
                    {'filters': {'all_of': [in_water(False), variant('==', 0)]}, 'event': 'brine:left_water'},
                    {'filters': {'all_of': [in_water(True), variant('!=', 0)]}, 'event': 'brine:entered_water'},
                ]},
            },
            'events': {
                'minecraft:entity_spawned': {'add': {'component_groups': ['brine:wet', 'brine:natural', 'brine:ai_roam']}},
                'brine:staged': {'remove': {'component_groups': ['brine:natural']}},
                'brine:mode_roam': mode('brine:ai_roam'),
                'brine:mode_hold': mode('brine:ai_hold'),
                'brine:mode_observe': mode('brine:ai_observe'),
                'brine:mode_hunt': mode('brine:ai_hunt'),
                'brine:mode_withdraw': mode('brine:ai_withdraw'),
                'brine:left_water': {'remove': {'component_groups': ['brine:wet']}, 'add': {'component_groups': ['brine:dryland_hunt']}},
                'brine:dried_out': {'remove': {'component_groups': ['brine:dryland_hunt']}, 'add': {'component_groups': ['brine:dried_out']}},
                'brine:entered_water': {'remove': {'component_groups': ['brine:dryland_hunt', 'brine:dried_out']},
                                        'add': {'component_groups': ['brine:wet']}},
            },
        },
    })
    write(f'{BP}/spawn_rules/brinesleeper.json', {
        'format_version': '1.8.0',
        'minecraft:spawn_rules': {
            'description': {'identifier': ID, 'population_control': 'monster'},
            # only in its home biome, the Stillwater Caves (see biome.py); the script keeps it to one per world
            'conditions': spawn_conditions,
        },
    })


def apparition_bp(BP):
    write(f'{BP}/entities/apparition.json', {
        'format_version': '1.21.0',
        'minecraft:entity': {
            'description': {
                'identifier': SHADE, 'is_spawnable': False, 'is_summonable': True, 'is_experimental': False,
                'properties': {f'{NS}:form': {'type': 'int', 'range': [0, 3], 'default': 0, 'client_sync': True},
                               f'{NS}:act': {'type': 'int', 'range': [0, 31], 'default': 0, 'client_sync': True}},
            },
            'component_groups': {'brine:vanish': {'minecraft:instant_despawn': {}}},
            'components': {
                'minecraft:type_family': {'family': ['brine_apparition', 'inanimate']},
                'minecraft:health': {'value': 1, 'max': 1},
                'minecraft:damage_sensor': {'triggers': [{'cause': 'all', 'deals_damage': 'no'}]},
                'minecraft:collision_box': {'width': 0.1, 'height': 0.1},
                'minecraft:physics': {'has_gravity': False, 'has_collision': False},
                'minecraft:pushable': {'is_pushable': False, 'is_pushable_by_piston': False},
                'minecraft:knockback_resistance': {'value': 1.0},
                'minecraft:fire_immune': True,
                'minecraft:breathable': {'total_supply': 15, 'suffocate_time': 0, 'breathes_water': True, 'breathes_air': True},
                # a safety net: whatever happens to the script, an apparition never outlives 40 seconds
                'minecraft:timer': {'looping': False, 'time': 40, 'time_down_event': {'event': 'brine:vanish', 'target': 'self'}},
            },
            'events': {'brine:vanish': {'add': {'component_groups': ['brine:vanish']}}},
        },
    })


# =================================================================== resource: client entities, controllers, looks
def act_controller():
    states = {'none': {'transitions': [{f'act_{a}': f"{q('act')} == {i}"} for i, a in enumerate(ACTS) if i]}}
    for i, a in enumerate(ACTS):
        if not i:
            continue
        states[f'act_{a}'] = {
            'animations': [a], 'blend_transition': BLEND.get(a, 0.8), 'blend_via_shortest_path': True,
            'transitions': [{'none': f"{q('act')} == 0"}] + [{f'act_{b}': f"{q('act')} == {j}"} for j, b in enumerate(ACTS) if j and j != i],
        }
    return {'initial_state': 'none', 'states': states}


def client_files(RP, SRC):
    anims = {
        'watch': 'animation.brinesleeper.watch', 'idle_water': 'animation.brinesleeper.idle_water', 'walk': 'animation.brinesleeper.walk',
        'stalk': 'animation.brinesleeper.crouch_stalk', 'run': 'animation.brinesleeper.run', 'swim': 'animation.brinesleeper.swim',
        'lunge': 'animation.brinesleeper.lunge', 'grasp': 'animation.brinesleeper.grasp', 'emerge': 'animation.brinesleeper.emerge',
        'submerge': 'animation.brinesleeper.submerge', 'look_at_target': 'animation.brinesleeper.look_at_target',
        **{n: f'animation.brinesleeper.{n}' for n in POSES},
    }
    write(f'{RP}/entity/brinesleeper.entity.json', {
        'format_version': '1.10.0',
        'minecraft:client_entity': {'description': {
            'identifier': ID,
            'materials': {'default': 'entity_alphatest'},
            'textures': {'default': 'textures/entity/brinesleeper'},
            'geometry': {'default': 'geometry.brinesleeper'},
            'animations': {**anims, 'move': 'controller.animation.brinesleeper.move', 'attack': 'controller.animation.brinesleeper.attack',
                           'look': 'controller.animation.brinesleeper.look', 'act': 'controller.animation.brinesleeper.act'},
            'scripts': {'animate': ['move', 'attack', 'look', 'act']},
            'render_controllers': ['controller.render.brinesleeper'],
            'spawn_egg': {'base_color': '#2b2427', 'overlay_color': '#c9bcc1'},
        }},
    })
    write(f'{RP}/entity/apparition.entity.json', {
        'format_version': '1.10.0',
        'minecraft:client_entity': {'description': {
            'identifier': SHADE,
            'materials': {'default': 'entity_alphatest'},
            'textures': {'default': 'textures/entity/brinesleeper', 'shade': 'textures/entity/brinesleeper_shade'},
            'geometry': {'default': 'geometry.brinesleeper', 'hand': 'geometry.brinesleeper_hand'},
            'animations': {**anims, 'invert': 'animation.brinesleeper.invert', 'act': 'controller.animation.brinesleeper.act'},
            # reflection (1) and hand (2) hang upside down from the waterline; the hand's arm then points up out of it
            'scripts': {'animate': ['act', {'invert': f"{q('form')} >= 1"}]},
            'render_controllers': ['controller.render.brinesleeper_apparition'],
        }},
    })
    write(f'{RP}/render_controllers/brinesleeper.render_controllers.json', {
        'format_version': '1.8.0',
        'render_controllers': {
            'controller.render.brinesleeper': {
                'geometry': 'Geometry.default', 'materials': [{'*': 'Material.default'}], 'textures': ['Texture.default']},
            'controller.render.brinesleeper_apparition': {
                'arrays': {'geometries': {'Array.geos': ['Geometry.default', 'Geometry.hand']},
                           'textures': {'Array.skins': ['Texture.shade', 'Texture.default']}},
                'geometry': f"Array.geos[{q('form')} == 2]", 'materials': [{'*': 'Material.default'}],
                'textures': [f"Array.skins[{q('form')} == 2]"]},
        },
    })
    moving = 'query.modified_move_speed > 0.02'
    scripted = {'scripted': f"{q('act')} != 0"}
    write(f'{RP}/animation_controllers/brinesleeper.animation_controllers.json', {
        'format_version': '1.10.0',
        'animation_controllers': {
            'controller.animation.brinesleeper.move': {
                'initial_state': 'land_idle',
                'states': {
                    # a scripted pose owns the whole body; locomotion resumes when it ends
                    'scripted': {'blend_transition': 0.5, 'transitions': [{'land_idle': f"{q('act')} == 0"}]},
                    'land_idle': {'animations': ['watch'], 'blend_transition': 0.3, 'transitions': [
                        scripted, {'water_idle': 'query.is_in_water'}, {'run': 'query.modified_move_speed > 0.55'},
                        {'stalk': f'{moving} && query.has_target'}, {'walk': moving}, {'hunt': 'query.has_target'}]},
                    'hunt': {'animations': ['hunting_stance'], 'blend_transition': 0.25, 'transitions': [
                        scripted, {'water_idle': 'query.is_in_water'}, {'run': 'query.modified_move_speed > 0.55'},
                        {'stalk': moving}, {'land_idle': '!query.has_target'}]},
                    'walk': {'animations': ['walk'], 'blend_transition': 0.25, 'transitions': [
                        scripted, {'water_idle': 'query.is_in_water'}, {'run': 'query.modified_move_speed > 0.55'},
                        {'stalk': 'query.has_target'}, {'land_idle': f'!({moving})'}]},
                    'stalk': {'animations': ['stalk'], 'blend_transition': 0.3, 'transitions': [
                        scripted, {'water_idle': 'query.is_in_water'}, {'run': 'query.modified_move_speed > 0.55'},
                        {'walk': f'!query.has_target && {moving}'}, {'land_idle': f'!({moving})'}]},
                    'run': {'animations': ['run'], 'blend_transition': 0.2, 'transitions': [
                        scripted, {'water_idle': 'query.is_in_water'},
                        {'stalk': 'query.modified_move_speed <= 0.5 && query.has_target'}, {'walk': 'query.modified_move_speed <= 0.5'}]},
                    'water_idle': {'animations': ['idle_water'], 'blend_transition': 0.4, 'transitions': [
                        scripted, {'land_idle': '!query.is_in_water'}, {'swim': 'query.modified_move_speed > 0.05'}]},
                    'swim': {'animations': ['swim'], 'blend_transition': 0.4, 'transitions': [
                        scripted, {'land_idle': '!query.is_in_water'}, {'water_idle': 'query.modified_move_speed <= 0.05'}]},
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
            'controller.animation.brinesleeper.look': {'initial_state': 'default', 'states': {'default': {'animations': ['look_at_target']}}},
            'controller.animation.brinesleeper.act': act_controller(),
        },
    })
    # animations: one-shot poses hold their last frame while scripted; add the reflection's inversion
    anim = load(f'{SRC}/brinesleeper.animation.json')
    for n in HOLD:
        anim['animations'][f'animation.brinesleeper.{n}']['loop'] = 'hold_on_last_frame'
    anim['animations']['animation.brinesleeper.invert'] = {'loop': True, 'bones': {'root': {'rotation': [180, 0, 0]}}}
    write(f'{RP}/animations/brinesleeper.animation.json', anim)
    # geometry: the full model plus a hand-only copy (every cube removed except the right arm's)
    geo = load(f'{SRC}/brinesleeper.geo.json')
    write(f'{RP}/models/entity/brinesleeper.geo.json', geo)
    hand = copy.deepcopy(geo)
    g = hand['minecraft:geometry'][0]
    g['description']['identifier'] = 'geometry.brinesleeper_hand'
    for b in g['bones']:
        if not (b['name'].startswith('right_') and not b['name'].startswith('right_leg') and not b['name'].startswith('right_shin')
                and not b['name'].startswith('right_foot') and not b['name'].startswith('right_toe')):
            b.pop('cubes', None)
    write(f'{RP}/models/entity/brinesleeper_hand.geo.json', hand)
    # textures: the model, and a dark, cold "shade" of it for silhouettes and reflections
    os.makedirs(f'{RP}/textures/entity', exist_ok=True)
    shutil.copy(f'{SRC}/brinesleeper.png', f'{RP}/textures/entity/brinesleeper.png')
    img = np.asarray(Image.open(f'{SRC}/brinesleeper.png').convert('RGBA')).astype(np.float32)
    lum = img[..., :3] @ np.array([0.3, 0.59, 0.11])
    shade = np.stack([lum * 0.16 + 6, lum * 0.19 + 8, lum * 0.24 + 11, img[..., 3]], -1).clip(0, 255).astype(np.uint8)
    Image.fromarray(shade, 'RGBA').save(f'{RP}/textures/entity/brinesleeper_shade.png')


# =================================================================== particles
def particles(RP):
    tex = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    px = tex.load()
    for y in range(16):                      # a ripple ring
        for x in range(16):
            r = math.hypot(x - 7.5, y - 7.5)
            if 5.6 < r < 7.4:
                px[x, y] = (210, 228, 236, int(255 * (1 - abs(r - 6.5) / 0.9)))
    for y in range(8):                       # a bubble
        for x in range(8):
            r = math.hypot(x - 3.5, y - 3.5)
            if r < 3.6:
                px[16 + x, y] = (200, 226, 240, 230 if r > 2.4 else 70)
    for (x, y, a) in ((27, 1, 160), (27, 2, 220), (26, 3, 230), (27, 3, 255), (28, 3, 230), (27, 4, 220), (27, 5, 140)):
        px[x, y] = (150, 182, 196, a)        # a drip
    for (x, y) in ((19, 10), (20, 9), (20, 10), (21, 10), (20, 11), (22, 12), (18, 13)):
        px[x, y] = (205, 222, 230, 235)      # spray
    os.makedirs(f'{RP}/textures/particle', exist_ok=True)
    tex.save(f'{RP}/textures/particle/brine_fx.png')
    base = lambda ident, comps: {'format_version': '1.10.0', 'particle_effect': {
        'description': {'identifier': ident, 'basic_render_parameters': {'material': 'particles_blend', 'texture': 'textures/particle/brine_fx'}},
        'components': comps}}
    uv = lambda u, v, s: {'texture_width': 32, 'texture_height': 32, 'uv': [u, v], 'uv_size': [s, s]}
    write(f'{RP}/particles/brine_ripple.json', base(f'{NS}:ripple', {
        'minecraft:emitter_rate_instant': {'num_particles': 2},
        'minecraft:emitter_lifetime_once': {'active_time': 0.6},
        'minecraft:emitter_shape_point': {'offset': [0, 0.06, 0]},
        'minecraft:particle_lifetime_expression': {'max_lifetime': '1.6 + variable.particle_random_1 * 0.6'},
        'minecraft:particle_initial_speed': 0,
        'minecraft:particle_motion_dynamic': {},
        'minecraft:particle_appearance_billboard': {
            'size': ['0.25 + variable.particle_age * 1.3', '0.25 + variable.particle_age * 1.3'],
            'facing_camera_mode': 'emitter_transform_xz', 'uv': uv(0, 0, 16)},
        'minecraft:particle_appearance_tinting': {'color': [0.82, 0.9, 0.95, '0.55 * (1 - variable.particle_age / variable.particle_lifetime)']},
    }))
    write(f'{RP}/particles/brine_bubbles.json', base(f'{NS}:bubbles', {
        'minecraft:emitter_rate_instant': {'num_particles': 10},
        'minecraft:emitter_lifetime_once': {'active_time': 0.2},
        'minecraft:emitter_shape_disc': {'radius': 0.5, 'plane_normal': [0, 1, 0], 'offset': [0, -0.6, 0], 'direction': [0, 1, 0]},
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.6 + variable.particle_random_1 * 0.6'},
        'minecraft:particle_initial_speed': '0.6 + variable.particle_random_2',
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 1.5, 0], 'linear_drag_coefficient': 2},
        'minecraft:particle_appearance_billboard': {'size': ['0.05 + variable.particle_random_3 * 0.07', '0.05 + variable.particle_random_3 * 0.07'],
                                                    'facing_camera_mode': 'lookat_xyz', 'uv': uv(16, 0, 8)},
    }))
    write(f'{RP}/particles/brine_drips.json', base(f'{NS}:drips', {
        'minecraft:emitter_rate_instant': {'num_particles': 4},
        'minecraft:emitter_lifetime_once': {'active_time': 0.1},
        'minecraft:emitter_shape_disc': {'radius': 0.35, 'plane_normal': [0, 1, 0], 'offset': [0, 0.6, 0]},
        'minecraft:particle_lifetime_expression': {'max_lifetime': 0.9},
        'minecraft:particle_initial_speed': 0,
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -9, 0]},
        'minecraft:particle_motion_collision': {'coefficient_of_restitution': 0, 'collision_radius': 0.05, 'expire_on_contact': True},
        'minecraft:particle_appearance_billboard': {'size': [0.06, 0.1], 'facing_camera_mode': 'lookat_y', 'uv': uv(24, 0, 8)},
    }))
    write(f'{RP}/particles/brine_splash.json', base(f'{NS}:splash', {
        'minecraft:emitter_rate_instant': {'num_particles': 26},
        'minecraft:emitter_lifetime_once': {'active_time': 0.1},
        'minecraft:emitter_shape_disc': {'radius': 0.6, 'plane_normal': [0, 1, 0], 'direction': 'outwards'},
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.5 + variable.particle_random_1 * 0.5'},
        'minecraft:particle_initial_speed': '2 + variable.particle_random_2 * 2',
        'minecraft:particle_initial_spin': {},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -14, 0]},
        'minecraft:particle_motion_collision': {'coefficient_of_restitution': 0, 'collision_radius': 0.05, 'expire_on_contact': True},
        'minecraft:particle_appearance_billboard': {'size': [0.12, 0.12], 'facing_camera_mode': 'lookat_xyz', 'uv': uv(16, 8, 8)},
    }))


# =================================================================== sounds (synthesized, plus the repository's own recordings)
SR = biome.SR


def _wav(path):
    return biome._load_wav(path)


def fit(x, n):
    """pad with silence or cut to exactly n samples"""
    return np.pad(x, (0, max(0, n - len(x))))[:n]


def _env(n, attack, release):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-3)) * np.minimum(1, (n / SR - t) / max(release, 1e-3)).clip(0, 1)


def _bubbles(seconds, count, rng, f_lo=500, f_hi=1400):
    n = int(seconds * SR)
    out = np.zeros(n)
    for _ in range(count):
        s = int(rng.uniform(0, seconds - 0.08) * SR)
        m = int(0.06 * SR)
        t = np.arange(m) / SR
        f = rng.uniform(f_lo, f_hi) * (1 + 2.5 * t / 0.06)
        out[s:s + m] += np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.018) * rng.uniform(0.3, 1)
    return out


def _growl(seconds, f0, f1, rng, rough=0.6):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f = np.linspace(f0, f1, n) * (1 + 0.04 * np.sin(2 * np.pi * 5.5 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = sum(np.sin(k * ph) / k for k in range(1, 12))
    x = np.tanh(x * 2.2) + rough * biome._lowpass(rng.normal(0, 1, n), 900) * (0.6 + 0.4 * np.sin(2 * np.pi * 9 * t))
    return biome._lowpass(x, 1800)


def synth(audio):
    rng = np.random.default_rng(31)
    splash = _wav(os.path.join(audio, 'splash.wav'))
    step = _wav(os.path.join(audio, 'step_stone.wav'))
    clips = {}
    n = int(1.7 * SR)
    t = np.arange(n) / SR
    rasp = biome._lowpass(rng.normal(0, 1, n), 1300) - biome._lowpass(rng.normal(0, 1, n), 250)
    clips['mob/brinesleeper/breathe'] = biome._cave_reverb(rasp * (np.sin(np.pi * t / 1.7) ** 2) * (0.7 + 0.3 * np.sin(2 * np.pi * 3 * t)), 1.8, 1)
    for i in range(2):
        x = np.zeros(int(0.7 * SR))
        pos = 0.02
        while pos < 0.55:
            s = int(pos * SR)
            m = int(0.006 * SR)
            x[s:s + m] += rng.normal(0, 1, m) * np.exp(-np.arange(m) / (0.0015 * SR))
            pos += rng.uniform(0.03, 0.12)
        clips[f'mob/brinesleeper/click{i + 1}'] = biome._cave_reverb(x - biome._lowpass(x, 1500), 1.2, 3 + i)
    clips['mob/brinesleeper/call'] = biome._cave_reverb(_growl(2.6, 92, 64, rng, 0.35) * _env(int(2.6 * SR), 0.5, 1.0), 3.2, 5)
    clips['mob/brinesleeper/lunge'] = biome._cave_reverb(
        np.tanh(3 * (_growl(0.7, 620, 260, rng, 0.9) + 0.5 * rng.normal(0, 1, int(0.7 * SR)))) * _env(int(0.7 * SR), 0.01, 0.3), 1.4, 6)
    churn = biome._lowpass(rng.normal(0, 1, int(1.1 * SR)), 700) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 4 * np.arange(int(1.1 * SR)) / SR)))
    clips['mob/brinesleeper/grasp'] = biome._cave_reverb(churn + 0.6 * _growl(1.1, 70, 58, rng, 0.3) + _bubbles(1.1, 14, rng), 1.2, 7)
    clips['mob/brinesleeper/hurt'] = biome._cave_reverb(_growl(0.4, 160, 110, rng, 0.8) * _env(int(0.4 * SR), 0.01, 0.15), 1.0, 8)
    clips['mob/brinesleeper/death'] = biome._cave_reverb(
        (_growl(1.9, 130, 40, rng, 0.6) + _bubbles(1.9, 24, rng, 300, 900)) * _env(int(1.9 * SR), 0.05, 0.9), 2.4, 9)
    slow = np.interp(np.arange(0, len(splash) - 1, 0.62), np.arange(len(splash)), splash)
    clips['mob/brinesleeper/emerge'] = biome._cave_reverb(biome._lowpass(slow, 1600), 2.0, 10)
    clips['mob/brinesleeper/submerge'] = biome._cave_reverb(_bubbles(1.3, 22, rng) + 0.3 * biome._lowpass(fit(slow, int(1.3 * SR)), 600), 1.6, 11)
    for i, pitch in enumerate((0.85, 0.75)):
        st = np.interp(np.arange(0, len(step) - 1, pitch), np.arange(len(step)), step)
        wet = biome._lowpass(st, 1400) + 0.25 * biome._lowpass(fit(splash, len(st)), 2500)
        clips[f'mob/brinesleeper/step{i + 1}'] = biome._cave_reverb(wet, 1.4, 12 + i)
    far = np.interp(np.arange(0, len(splash) - 1, 0.8), np.arange(len(splash)), splash)
    clips['brine_fx/splash_far'] = biome._cave_reverb(biome._lowpass(far, 900), 3.0, 14)
    clips['brine_fx/surge'] = biome._cave_reverb(biome._lowpass(slow, 1100) + 0.4 * fit(_bubbles(len(slow) / SR, 10, rng), len(slow)), 2.2, 15)
    clips['brine_fx/bubbles'] = biome._cave_reverb(_bubbles(1.0, 16, rng, 350, 900), 1.6, 16)
    n = int(0.9 * SR)
    lap = biome._lowpass(rng.normal(0, 1, n), 500) * np.sin(np.pi * np.arange(n) / n) ** 2
    clips['brine_fx/ripple'] = biome._cave_reverb(lap, 1.5, 17)
    m = int(0.09 * SR)
    tt = np.arange(m) / SR
    drop = np.sin(2 * np.pi * np.cumsum(1300 * np.exp(-tt / 0.03) + 420) / SR) * np.exp(-tt / 0.025)
    clips['brine_fx/drip'] = biome._cave_reverb(drop, 2.2, 18)
    return clips


SOUND_EVENTS = {
    'mob.brinesleeper.breathe': (['mob/brinesleeper/breathe'], 0.7, 'hostile'),
    'mob.brinesleeper.click': (['mob/brinesleeper/click1', 'mob/brinesleeper/click2'], 0.9, 'hostile'),
    'mob.brinesleeper.call': (['mob/brinesleeper/call'], 1.0, 'hostile'),
    'mob.brinesleeper.lunge': (['mob/brinesleeper/lunge'], 1.0, 'hostile'),
    'mob.brinesleeper.grasp': (['mob/brinesleeper/grasp'], 1.0, 'hostile'),
    'mob.brinesleeper.hurt': (['mob/brinesleeper/hurt'], 1.0, 'hostile'),
    'mob.brinesleeper.death': (['mob/brinesleeper/death'], 1.0, 'hostile'),
    'mob.brinesleeper.emerge': (['mob/brinesleeper/emerge'], 1.0, 'hostile'),
    'mob.brinesleeper.submerge': (['mob/brinesleeper/submerge'], 0.9, 'hostile'),
    'mob.brinesleeper.step': (['mob/brinesleeper/step1', 'mob/brinesleeper/step2'], 0.6, 'hostile'),
    'brine.fx.splash_far': (['brine_fx/splash_far'], 1.0, 'ambient'),
    'brine.fx.surge': (['brine_fx/surge'], 1.0, 'ambient'),
    'brine.fx.bubbles': (['brine_fx/bubbles'], 0.8, 'ambient'),
    'brine.fx.ripple': (['brine_fx/ripple'], 0.6, 'ambient'),
    'brine.fx.drip': (['brine_fx/drip'], 0.6, 'ambient'),
}


def sounds(RP, audio):
    for rel, x in synth(audio).items():
        x = x / (np.max(np.abs(x)) or 1.0) * 0.85
        fade = np.minimum(1.0, (len(x) - np.arange(len(x))) / (0.3 * SR))
        pcm = (x * fade * 32767).astype(np.int16)
        out = f'{RP}/sounds/{rel}.ogg'
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = os.path.join(tmp, 'a.wav')
            with wave.open(wav_path, 'w') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav_path, '-c:a', 'libvorbis', '-q:a', '4', out], check=True)
    defs_path = f'{RP}/sounds/sound_definitions.json'
    defs = load(defs_path) if os.path.exists(defs_path) else {'format_version': '1.20.20', 'sound_definitions': {}}
    for ev, (files, vol, cat) in SOUND_EVENTS.items():
        defs['sound_definitions'][ev] = {'category': cat, 'max_distance': 48.0, 'min_distance': 2.0,
                                         'sounds': [{'name': f'sounds/{f}', 'volume': vol, 'load_on_low_memory': True} for f in files]}
    write(defs_path, defs)
    sj_path = f'{RP}/sounds.json'
    sj = load(sj_path) if os.path.exists(sj_path) else {}
    sj.setdefault('entity_sounds', {}).setdefault('entities', {})[ID] = {
        'volume': 1.0, 'pitch': [0.9, 1.05],
        'events': {'ambient': {'sound': 'mob.brinesleeper.breathe', 'volume': 0.6}, 'hurt': 'mob.brinesleeper.hurt',
                   'death': 'mob.brinesleeper.death', 'step': {'sound': 'mob.brinesleeper.step', 'volume': 0.35}}}
    write(sj_path, sj)


# =================================================================== entry point
def lang_lines():
    return f'entity.{SHADE}.name=???\n'


def build(RP, BP, SRC, spawn_conditions, audio):
    creature_bp(BP, spawn_conditions)
    apparition_bp(BP)
    client_files(RP, SRC)
    particles(RP)
    sounds(RP, audio)
    os.makedirs(f'{BP}/scripts', exist_ok=True)
    shutil.copy(os.path.join(HERE, 'scripts', 'main.js'), f'{BP}/scripts/main.js')
