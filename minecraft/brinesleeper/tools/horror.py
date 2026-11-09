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
  BP scripts/                     the director (index.js entry), copied from tools/scripts/
  BP items/ RP textures/items/     the Brinesleeper Settings wheel
  RP sounds/music/                four ambient tracks for the caves, a chase theme, sighting stings
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
        'hunting_stance', 'slow_approach', 'patient_strike', 'veil_stalk', 'reflection_lurk', 'idle_water', 'swim', 'emerge_roar']
# how long the blend into each pose takes: rising onto two legs and dropping back down are slow, deliberate blends
BLEND = {'full_stand': 1.2, 'hunting_stance': 1.0, 'submerge': 0.6, 'emerge': 0.4, 'water_rise': 0.8, 'retreat': 0.6}
HOLD = ('emerge', 'submerge', 'water_rise', 'retreat', 'emerge_roar')
BLEND.update({'emerge_roar': 0.3, 'swim': 0.6})     # one-shot poses keep their last frame
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
THREATS = {1: (100, 6), 2: (150, 8), 3: (220, 11)}      # health, melee damage (the script adds the lunge and grasp)
SCALE = 1.15                                             # the model at 115%: just over 4 blocks tall


def creature_bp(BP, spawn_conditions):
    players = lambda dist: [{'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'}, 'max_dist': dist}]
    modes = ['brine:ai_roam_land', 'brine:ai_roam_water', 'brine:ai_hold', 'brine:ai_observe', 'brine:ai_stalk', 'brine:ai_hunt',
             'brine:ai_withdraw']
    # every mode group re-declares movement and physics: removing a group that overrode a component removes the
    # component itself, so the next mode must always bring its own
    move = lambda land, water: {'minecraft:movement': {'value': land}, 'minecraft:underwater_movement': {'value': water},
                                'minecraft:physics': {}}
    mode = lambda keep: {'remove': {'component_groups': [m for m in modes if m != keep]}, 'add': {'component_groups': [keep]}}
    fight_back = {'minecraft:behavior.hurt_by_target': {'priority': 1},
                  'minecraft:behavior.melee_attack': {'priority': 3, 'speed_multiplier': 1.5, 'track_target': True}}
    threat = {f'brine:threat_{k}': {'minecraft:health': {'value': hp, 'max': hp}, 'minecraft:attack': {'damage': dmg}}
              for k, (hp, dmg) in THREATS.items()}
    threat_events = {f'brine:threat_{k}': {'remove': {'component_groups': [g for g in threat if g != f'brine:threat_{k}']},
                                           'add': {'component_groups': [f'brine:threat_{k}']}} for k in THREATS}
    write(f'{BP}/entities/brinesleeper.json', {
        'format_version': '1.21.0',
        'minecraft:entity': {
            'description': {
                'identifier': ID, 'is_spawnable': True, 'is_summonable': True, 'is_experimental': False,
                'properties': {f'{NS}:act': {'type': 'int', 'range': [0, 31], 'default': 0, 'client_sync': True}},
            },
            'component_groups': {
                **threat,
                # wandering, on land: strolls the shores and makes for land if it finds itself swimming
                'brine:ai_roam_land': {
                    **move(0.28, 0.27), **fight_back,
                    'minecraft:behavior.move_to_land': {'priority': 4, 'search_range': 16, 'search_height': 5, 'goal_radius': 0.5},
                    'minecraft:behavior.random_stroll': {'priority': 6, 'speed_multiplier': 0.8},
                    'minecraft:behavior.look_at_player': {'priority': 8, 'look_distance': 24, 'probability': 0.08},
                    'minecraft:behavior.random_look_around': {'priority': 9},
                },
                # wandering, in the water: swims the lakes and makes for the water if it finds itself ashore
                'brine:ai_roam_water': {
                    **move(0.28, 0.27), **fight_back,
                    'minecraft:behavior.move_to_water': {'priority': 4, 'search_range': 24, 'search_height': 8, 'search_count': 1,
                                                         'goal_radius': 1.5, 'speed_multiplier': 1.2},
                    'minecraft:behavior.random_swim': {'priority': 6, 'speed_multiplier': 1.2, 'xz_dist': 12, 'y_dist': 6},
                    'minecraft:behavior.look_at_player': {'priority': 8, 'look_distance': 24, 'probability': 0.08},
                },
                # held perfectly still in a pose the script chose: no AI, no gravity (it can float at the waterline)
                'brine:ai_hold': {**move(0, 0), 'minecraft:physics': {'has_gravity': False, 'has_collision': True}},
                # standing off: still, staring, its eyes follow you
                'brine:ai_observe': {
                    **move(0, 0),
                    'minecraft:behavior.look_at_player': {'priority': 1, 'look_distance': 64, 'probability': 1.0},
                },
                # stalking: creeps toward you (crouched on land), stopping when the script says so
                'brine:ai_stalk': {
                    **move(0.24, 0.3),
                    'minecraft:behavior.nearest_attackable_target': {
                        'priority': 2, 'must_see': False, 'reselect_targets': True, 'within_radius': 64, 'entity_types': players(64)},
                    'minecraft:behavior.move_towards_target': {'priority': 3, 'speed_multiplier': 1.0, 'within_radius': 64},
                    'minecraft:behavior.look_at_player': {'priority': 4, 'look_distance': 64, 'probability': 1.0},
                },
                # the hunt: faster than you on land, much faster in the water; leaps, strikes
                'brine:ai_hunt': {
                    **move(0.36, 0.38),
                    'minecraft:behavior.hurt_by_target': {'priority': 1},
                    'minecraft:behavior.nearest_attackable_target': {
                        'priority': 2, 'must_see': False, 'reselect_targets': True, 'within_radius': 48, 'entity_types': players(48)},
                    'minecraft:behavior.leap_at_target': {'priority': 3, 'yd': 0.45, 'must_be_on_ground': False},
                    'minecraft:behavior.melee_attack': {'priority': 4, 'speed_multiplier': 1.55, 'track_target': True},
                },
                # backs off fast and makes for the water
                'brine:ai_withdraw': {
                    **move(0.4, 0.36),
                    'minecraft:behavior.move_to_water': {'priority': 1, 'search_range': 32, 'search_height': 8, 'search_count': 1,
                                                         'goal_radius': 1.5, 'speed_multiplier': 1.6},
                    'minecraft:behavior.avoid_mob_type': {'priority': 2, 'entity_types': [
                        {'filters': {'test': 'is_family', 'subject': 'other', 'value': 'player'}, 'max_dist': 32,
                         'walk_speed_multiplier': 1.4, 'sprint_speed_multiplier': 1.8}]},
                    'minecraft:behavior.random_swim': {'priority': 6, 'speed_multiplier': 1.3, 'xz_dist': 14, 'y_dist': 6},
                },
                'brine:vanish': {'minecraft:instant_despawn': {}},
            },
            'components': {
                'minecraft:type_family': {'family': ['brinesleeper', 'monster', 'mob']},
                'minecraft:health': {'value': 150, 'max': 150},
                'minecraft:attack': {'damage': 8},
                # a little taller than before (4 blocks), and the hitbox matches the model
                'minecraft:scale': {'value': SCALE},
                'minecraft:collision_box': {'width': round(1.0 * SCALE, 2), 'height': round(3.4 * SCALE, 2)},
                'minecraft:loot': {'table': 'loot_tables/entities/brinesleeper.json'},
                'minecraft:experience_reward': {'on_death': 'query.last_hit_by_player ? 80 : 0'},
                **move(0.28, 0.27),
                # it climbs out onto ledges a full block high instead of bumping against the bank (no more stuck in the water)
                'minecraft:variable_max_auto_step': {'base_value': 1.0625, 'controlled_value': 1.0625, 'jump_prevented_value': 0.5625},
                'minecraft:navigation.generic': {'is_amphibious': True, 'can_path_over_water': False, 'can_swim': True, 'can_walk': True,
                                                 'can_sink': False, 'can_breach': True, 'avoid_damage_blocks': True},
                'minecraft:movement.amphibious': {'max_turn': 20},
                'minecraft:jump.static': {},
                'minecraft:breathable': {'total_supply': 15, 'suffocate_time': 0, 'breathes_water': True, 'breathes_air': True},
                'minecraft:pushable': {'is_pushable': False, 'is_pushable_by_piston': True},
                'minecraft:knockback_resistance': {'value': 0.75},
                'minecraft:nameable': {},
                'minecraft:persistent': {},
                'minecraft:follow_range': {'value': 64, 'max': 64},
                'minecraft:ambient_sound_interval': {'value': 12, 'range': 16, 'event_name': 'ambient'},
                'minecraft:damage_sensor': {'triggers': [{'cause': 'fall', 'deals_damage': 'no'}, {'cause': 'drowning', 'deals_damage': 'no'},
                                                         {'cause': 'suffocation', 'deals_damage': 'no'}]},
            },
            'events': {
                'minecraft:entity_spawned': {'add': {'component_groups': ['brine:ai_roam_water', 'brine:threat_2']}},
                'brine:staged': {},
                'brine:vanish': {'add': {'component_groups': ['brine:vanish']}},
                **{f'brine:mode_{m.split("ai_")[1]}': mode(m) for m in modes},
                **threat_events,
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
            'component_groups': {'brine:vanish': {'minecraft:instant_despawn': {}},
                                 # the shape under the water is bigger than it should be
                                 'brine:huge': {'minecraft:scale': {'value': 1.8}}},
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
            'events': {'brine:vanish': {'add': {'component_groups': ['brine:vanish']}},
                       'brine:huge': {'add': {'component_groups': ['brine:huge']}}},
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


# =================================================================== music, heartbeat, roars: the atmosphere layer
MSR = 32000                                        # music sample rate (smaller files, same feel)


def lp(x, cutoff, sr=MSR, order=4):
    """gentle low-pass in the frequency domain (fast on long signals)"""
    n = len(x)
    N = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, N)
    f = np.fft.rfftfreq(N, 1 / sr)
    return np.fft.irfft(X / (1 + (f / cutoff) ** order), N)[:n]


def hp(x, cutoff, sr=MSR):
    return x - lp(x, cutoff, sr, 2)


def fftconv(x, ir):
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:n]


def hall(x, seconds, seed, wet=0.7, damp=2200, sr=MSR):
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    tt = np.arange(n) / sr
    ir = lp(rng.normal(0, 1, n) * np.exp(-tt / (seconds / 5.5)), damp, sr)
    ir[0] = 0
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    y = fftconv(x, ir)
    y /= np.max(np.abs(y)) + 1e-9
    d = np.concatenate([x / (np.max(np.abs(x)) + 1e-9), np.zeros(len(y) - len(x))])
    return (1 - wet) * d + wet * y


def tone(freq, dur, sr=MSR, harmonics=6, phase=0.0):
    tt = np.arange(int(dur * sr)) / sr
    f = freq if np.isscalar(freq) else freq[: len(tt)]
    ph = 2 * np.pi * (f * tt if np.isscalar(f) else np.cumsum(f) / sr) + phase
    return sum(np.sin(k * ph) / k for k in range(1, harmonics + 1))


def env(n, a, r, sr=MSR):
    tt = np.arange(n) / sr
    return np.clip(np.minimum(tt / max(a, 1e-3), (n / sr - tt) / max(r, 1e-3)), 0, 1)


def place(buf, x, at, sr=MSR):
    s = int(at * sr)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(x))
    buf[s:e] += x[: e - s]


def ambient_track(seed, root, dur=78.0):
    """a dark drone for the flooded halls: low pads, dissonant shimmers, something calling far away under the water"""
    rng = np.random.default_rng(seed)
    n = int(dur * MSR)
    tt = np.arange(n) / MSR
    out = np.zeros(n)
    swell = 0.55 + 0.45 * np.sin(2 * np.pi * tt / rng.uniform(18, 30) + rng.uniform(0, 6))
    for f, amp in ((root, 1.0), (root * 1.5, 0.35), (root * 2 * 2 ** (1 / 12), 0.25)):     # root, fifth, a minor second above
        for det in (-0.004, 0.0, 0.005):
            out += amp * tone(f * (1 + det), dur, harmonics=7, phase=rng.uniform(0, 6))
    out = lp(out, 420) * swell
    for _ in range(rng.integers(3, 6)):                       # high dissonant shimmers that come and go
        at, ln = rng.uniform(4, dur - 14), rng.uniform(8, 14)
        f0 = root * 16 * 2 ** (rng.integers(0, 12) / 12)
        cl = sum(np.sin(2 * np.pi * f0 * 2 ** (k / 12) * np.arange(int(ln * MSR)) / MSR) for k in (0, 1, 6))
        trem = 0.6 + 0.4 * np.sin(2 * np.pi * rng.uniform(4, 7) * np.arange(int(ln * MSR)) / MSR)
        place(out, 0.06 * cl * trem * env(int(ln * MSR), ln * 0.45, ln * 0.45), at)
    for _ in range(rng.integers(2, 4)):                       # a long call, far off, under the water
        at, ln = rng.uniform(6, dur - 10), rng.uniform(4, 7)
        m = int(ln * MSR)
        tc = np.arange(m) / MSR
        f = rng.uniform(140, 260) * (1 + 0.35 * np.sin(np.pi * tc / ln) - 0.2 * tc / ln) * (1 + 0.012 * np.sin(2 * np.pi * 5 * tc))
        call = np.sin(2 * np.pi * np.cumsum(f) / MSR) + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / MSR)
        place(out, 0.22 * lp(call, 900) * env(m, ln * 0.4, ln * 0.5), at)
    for _ in range(rng.integers(3, 6)):                       # something heavy, deep below
        at = rng.uniform(3, dur - 4)
        m = int(1.6 * MSR)
        tc = np.arange(m) / MSR
        place(out, 0.9 * np.sin(2 * np.pi * np.cumsum(46 - 14 * tc) / MSR) * np.exp(-tc / 0.5), at)
    for _ in range(rng.integers(2, 4)):                       # a scrape of claw on stone
        at, ln = rng.uniform(5, dur - 5), rng.uniform(1.2, 2.2)
        m = int(ln * MSR)
        nz = rng.normal(0, 1, m)
        band = lp(hp(nz, rng.uniform(1800, 2600)), rng.uniform(3500, 5000))
        place(out, 0.08 * band * env(m, 0.3, 0.6), at)
    for _ in range(rng.integers(6, 12)):                      # drips
        at = rng.uniform(1, dur - 1)
        m = int(0.09 * MSR)
        tc = np.arange(m) / MSR
        place(out, 0.18 * np.sin(2 * np.pi * np.cumsum(1300 * np.exp(-tc / 0.03) + 420) / MSR) * np.exp(-tc / 0.025), at)
    out = hall(out, 4.0, seed, wet=0.55)[:n]
    return out * env(n, 4.0, 5.0)


def chase_loop(seed, dur=32.0, bpm=132):
    """the chase: a pounding double heartbeat, grinding low strings and a rising shriek"""
    rng = np.random.default_rng(seed)
    n = int(dur * MSR)
    out = np.zeros(n)
    beat = 60 / bpm
    m = int(0.35 * MSR)
    tc = np.arange(m) / MSR
    thump = np.sin(2 * np.pi * np.cumsum(62 - 30 * tc / 0.35) / MSR) * np.exp(-tc / 0.09)
    k = 0
    while k * beat < dur:
        place(out, thump, k * beat)
        place(out, 0.6 * thump, k * beat + beat * 0.32)
        k += 1
    root = 41.2
    for i in range(int(dur / (beat / 2))):                    # eighth-note stabs, a minor second apart
        at = i * beat / 2
        f = root * (2 ** (1 / 12) if (i // 8) % 2 else 1.0)
        m = int(beat / 2 * MSR)
        st = tone(f * 2, beat / 2, harmonics=9) + 0.7 * tone(f * 2 * 2 ** (1 / 12), beat / 2, harmonics=9)
        place(out, 0.35 * lp(st, 700) * np.exp(-np.arange(m) / MSR / 0.12), at)
    tt = np.arange(n) / MSR
    shriek = sum(np.sin(2 * np.pi * (660 * 2 ** (j / 12)) * tt * (1 + 0.15 * tt / dur)) for j in (0, 1, 6))
    out += 0.05 * shriek * (0.6 + 0.4 * np.sin(2 * np.pi * 11 * tt)) * np.clip(tt / dur, 0, 1)
    out = hall(out, 1.6, seed, wet=0.3)[:n]
    return out * env(n, 0.02, 0.05)


def sting(seed, dur=4.5):
    """a sighting: a cluster that swells out of nothing, then a hit"""
    rng = np.random.default_rng(seed)
    n = int(dur * MSR)
    tt = np.arange(n) / MSR
    base = rng.uniform(220, 330)
    cl = sum(np.sin(2 * np.pi * base * 2 ** (k / 12) * tt * (1 + 0.01 * k * tt)) for k in (0, 1, 2, 6, 7, 11, 13))
    sw = cl * np.clip(tt / (dur * 0.7), 0, 1) ** 2.5
    hit = np.zeros(n)
    place(hit, (lp(rng.normal(0, 1, int(0.6 * MSR)), 1500) + 2 * np.sin(2 * np.pi * 38 * np.arange(int(0.6 * MSR)) / MSR))
          * np.exp(-np.arange(int(0.6 * MSR)) / MSR / 0.18), dur * 0.7)
    out = hall(0.12 * sw + hit, 3.0, seed, wet=0.5)[:n]
    return out * env(n, 0.05, 0.8)


def heartbeat():
    m = int(0.62 * MSR)
    out = np.zeros(m)
    for at, amp in ((0.0, 1.0), (0.27, 0.7)):                 # lub-dub
        k = int(0.22 * MSR)
        tc = np.arange(k) / MSR
        place(out, amp * np.sin(2 * np.pi * np.cumsum(58 - 22 * tc / 0.22) / MSR) * np.exp(-tc / 0.06), at)
    return lp(out, 240)


def creature_fx(audio):
    rng = np.random.default_rng(77)
    splash = _wav(os.path.join(audio, 'splash.wav'))
    sp = np.interp(np.arange(0, len(splash) - 1, SR / MSR * 0.55), np.arange(len(splash)), splash)
    fx = {}
    m = int(2.3 * MSR)
    tc = np.arange(m) / MSR
    roar = sum(np.tanh(2.5 * tone(np.full(m, 1.0) * f * (1.25 - 0.45 * tc / 2.3), 2.3, harmonics=10)) for f in (95, 142, 71))
    roar = lp(roar + 0.9 * lp(rng.normal(0, 1, m), 1400) * (0.5 + 0.5 * np.sin(2 * np.pi * 13 * tc)), 2600) * env(m, 0.08, 0.9)
    fx['mob/brinesleeper/roar'] = hall(roar, 2.4, 1, wet=0.45)
    m = int(1.4 * MSR)
    tc = np.arange(m) / MSR
    fx['mob/brinesleeper/hiss'] = hall(hp(rng.normal(0, 1, m), 2500) * env(m, 0.5, 0.6) * (0.6 + 0.4 * np.sin(2 * np.pi * 7 * tc)), 1.8, 2)
    m = int(3.6 * MSR)
    tc = np.arange(m) / MSR
    moan = tone(np.full(m, 1.0) * 62 * (1 - 0.25 * tc / 3.6) * (1 + 0.02 * np.sin(2 * np.pi * 4 * tc)), 3.6, harmonics=8)
    fx['mob/brinesleeper/moan'] = hall(lp(moan, 380) * env(m, 0.9, 1.4), 4.5, 3, wet=0.7)
    m = int(1.4 * MSR)
    kn = np.zeros(m)
    for at in (0.0, 0.33, 0.66):
        k = int(0.2 * MSR)
        tk = np.arange(k) / MSR
        place(kn, (lp(rng.normal(0, 1, k), 900) + 1.5 * np.sin(2 * np.pi * 170 * tk)) * np.exp(-tk / 0.035), at)
    fx['brine_fx/knock'] = hall(kn, 2.4, 4, wet=0.5)
    m = int(0.9 * MSR)
    tc = np.arange(m) / MSR
    thump = 1.4 * np.sin(2 * np.pi * np.cumsum(48 - 16 * tc) / MSR) * np.exp(-tc / 0.18)
    fx['brine_fx/thump'] = lp(thump + 0.3 * fit(_bubbles(0.9, 10, rng) if False else rng.normal(0, 0.2, m), m), 500)
    m = int(0.6 * MSR)
    fx['brine_fx/snuff'] = hp(rng.normal(0, 1, m), 3000) * np.exp(-np.arange(m) / MSR / 0.16)
    m = int(1.8 * MSR)
    burst = fit(sp, m) * 1.4 + 0.8 * lp(rng.normal(0, 1, m), 1800) * np.exp(-np.arange(m) / MSR / 0.35)
    fx['brine_fx/burst'] = hall(burst, 2.0, 5, wet=0.4)
    fx['brine_fx/heartbeat'] = heartbeat()
    return fx


MUSIC = {
    'music/brine/stillwater_1': lambda: ambient_track(101, 41.2),
    'music/brine/stillwater_2': lambda: ambient_track(102, 36.7),
    'music/brine/stillwater_3': lambda: ambient_track(103, 43.65),
    'music/brine/stillwater_4': lambda: ambient_track(104, 38.9),
    'music/brine/chase': lambda: chase_loop(201),
    'music/brine/sting_1': lambda: sting(301),
    'music/brine/sting_2': lambda: sting(302),
    'music/brine/sting_3': lambda: sting(303),
}
EXTRA_EVENTS = {
    'mob.brinesleeper.roar': (['mob/brinesleeper/roar'], 1.0, 'hostile'),
    'mob.brinesleeper.hiss': (['mob/brinesleeper/hiss'], 0.7, 'hostile'),
    'mob.brinesleeper.moan': (['mob/brinesleeper/moan'], 1.0, 'hostile'),
    'brine.fx.knock': (['brine_fx/knock'], 0.9, 'ambient'),
    'brine.fx.thump': (['brine_fx/thump'], 1.0, 'ambient'),
    'brine.fx.snuff': (['brine_fx/snuff'], 0.7, 'block'),
    'brine.fx.burst': (['brine_fx/burst'], 1.0, 'hostile'),
    'brine.heartbeat': (['brine_fx/heartbeat'], 1.0, 'player'),
}


def encode(x, out, sr):
    x = x / (np.max(np.abs(x)) or 1.0) * 0.85
    pcm = (x * 32767).astype(np.int16)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, 'a.wav')
        with wave.open(wav_path, 'w') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav_path, '-c:a', 'libvorbis', '-q:a', '3', out], check=True)


def atmosphere(RP, audio):
    for rel, x in creature_fx(audio).items():
        encode(x, f'{RP}/sounds/{rel}.ogg', MSR)
    for rel, fn in MUSIC.items():
        encode(fn(), f'{RP}/sounds/{rel}.ogg', MSR)
    defs_path = f'{RP}/sounds/sound_definitions.json'
    defs = load(defs_path)
    for ev, (files, vol, cat) in EXTRA_EVENTS.items():
        defs['sound_definitions'][ev] = {'category': cat, 'max_distance': 48.0, 'min_distance': 2.0,
                                         'sounds': [{'name': f'sounds/{f}', 'volume': vol, 'load_on_low_memory': True} for f in files]}
    # the biome's own music (biome_music in the client biome) and the director's chase theme and stings
    defs['sound_definitions']['music.brine.stillwater'] = {'category': 'music', 'sounds': [
        {'name': f'sounds/music/brine/stillwater_{i}', 'stream': True, 'volume': 0.75} for i in range(1, 5)]}
    defs['sound_definitions']['music.brine.chase'] = {'category': 'music', 'sounds': [
        {'name': 'sounds/music/brine/chase', 'stream': True, 'volume': 0.85}]}
    defs['sound_definitions']['music.brine.sting'] = {'category': 'music', 'sounds': [
        {'name': f'sounds/music/brine/sting_{i}', 'volume': 0.9} for i in range(1, 4)]}
    write(defs_path, defs)
    write(f'{RP}/sounds/music_definitions.json', {
        'brine_stillwater': {'event_name': 'music.brine.stillwater', 'min_delay': 20, 'max_delay': 70}})


def eye_particles(RP):
    base = lambda ident, comps: {'format_version': '1.10.0', 'particle_effect': {
        'description': {'identifier': ident, 'basic_render_parameters': {'material': 'particles_add', 'texture': 'textures/particle/brine_fx'}},
        'components': comps}}
    uv = lambda u, v, s: {'texture_width': 32, 'texture_height': 32, 'uv': [u, v], 'uv_size': [s, s]}
    # eye shine: two pale points in the dark, a little apart, watching (particles are drawn unlit, so they glow)
    write(f'{RP}/particles/brine_eyes.json', base(f'{NS}:eyes', {
        'minecraft:emitter_rate_instant': {'num_particles': 1},
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_shape_point': {},
        'minecraft:particle_lifetime_expression': {'max_lifetime': 1.15},
        'minecraft:particle_initial_speed': 0,
        'minecraft:particle_motion_dynamic': {},
        'minecraft:particle_appearance_billboard': {'size': [0.055, 0.055], 'facing_camera_mode': 'lookat_xyz', 'uv': uv(16, 0, 8)},
        'minecraft:particle_appearance_tinting': {'color': [1.0, 0.86, 0.78,
                                                            '(0.6 + 0.4 * math.sin(variable.particle_age * 900)) * math.min(1, (variable.particle_lifetime - variable.particle_age) * 4)']},
    }))
    write(f'{RP}/particles/brine_smoke.json', {'format_version': '1.10.0', 'particle_effect': {
        'description': {'identifier': f'{NS}:smoke', 'basic_render_parameters': {'material': 'particles_blend', 'texture': 'textures/particle/brine_fx'}},
        'components': {
            'minecraft:emitter_rate_instant': {'num_particles': 6},
            'minecraft:emitter_lifetime_once': {'active_time': 0.1},
            'minecraft:emitter_shape_sphere': {'radius': 0.15, 'direction': 'outwards'},
            'minecraft:particle_lifetime_expression': {'max_lifetime': '0.9 + variable.particle_random_1 * 0.6'},
            'minecraft:particle_initial_speed': 0.3,
            'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 0.8, 0], 'linear_drag_coefficient': 1.5},
            'minecraft:particle_appearance_billboard': {'size': ['0.1 + variable.particle_age * 0.2', '0.1 + variable.particle_age * 0.2'],
                                                        'facing_camera_mode': 'lookat_xyz', 'uv': uv(16, 0, 8)},
            'minecraft:particle_appearance_tinting': {'color': [0.18, 0.18, 0.2, '0.7 * (1 - variable.particle_age / variable.particle_lifetime)']},
        }}})


def config_wheel(RP, BP):
    """the settings item: a dark iron cog with a drop of red at its hub (vanilla item-style pixel art)"""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y in range(16):
        for x in range(16):
            dx, dy = x - 7.5, y - 7.5
            r, a = math.hypot(dx, dy), math.atan2(dy, dx)
            tooth = 6.9 if math.cos(a * 8) > 0.35 else 5.6
            if r <= tooth:
                if r < 2.2:
                    px[x, y] = (150, 24, 30, 255) if r < 1.3 else (92, 12, 16, 255)
                elif r < 3.3:
                    px[x, y] = (34, 34, 40, 255)
                else:
                    shade = 0.75 + 0.25 * math.cos(a + 2.3)
                    c = int(96 * shade) + (14 if r < 4.4 else 0)
                    px[x, y] = (c, c, c + 8, 255)
                if r > tooth - 1:
                    px[x, y] = (40, 40, 46, 255)
    os.makedirs(f'{RP}/textures/items', exist_ok=True)
    img.save(f'{RP}/textures/items/brine_config_wheel.png')
    write(f'{RP}/textures/item_texture.json', {'resource_pack_name': 'brinesleeper', 'texture_name': 'atlas.items',
                                               'texture_data': {'brine_config_wheel': {'textures': 'textures/items/brine_config_wheel'}}})
    write(f'{BP}/items/config_wheel.json', {
        'format_version': '1.21.0',
        'minecraft:item': {
            'description': {'identifier': f'{NS}:config_wheel', 'menu_category': {'category': 'items'}},
            'components': {
                'minecraft:icon': 'brine_config_wheel',
                'minecraft:max_stack_size': 1,
                'minecraft:display_name': {'value': 'Brinesleeper Settings'},
                'minecraft:glint': False,
                'minecraft:hand_equipped': False,
            },
        },
    })


# =================================================================== what it leaves behind
def loot_tables(BP):
    count = lambda lo, hi: [{'function': 'set_count', 'count': {'min': lo, 'max': hi}}]
    write(f'{BP}/loot_tables/entities/brinesleeper.json', {'pools': [
        {'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:diamond', 'weight': 1, 'functions': count(1, 3)}]},
        {'rolls': {'min': 2, 'max': 4}, 'entries': [
            {'type': 'item', 'name': 'minecraft:prismarine_crystals', 'weight': 10, 'functions': count(2, 6)},
            {'type': 'item', 'name': 'minecraft:emerald', 'weight': 8, 'functions': count(2, 6)},
            {'type': 'item', 'name': 'minecraft:gold_ingot', 'weight': 8, 'functions': count(2, 7)},
            {'type': 'item', 'name': 'minecraft:experience_bottle', 'weight': 6, 'functions': count(3, 8)},
            {'type': 'item', 'name': 'minecraft:nautilus_shell', 'weight': 6, 'functions': count(1, 2)},
            {'type': 'item', 'name': 'minecraft:bone', 'weight': 10, 'functions': count(3, 8)},
            {'type': 'item', 'name': 'minecraft:ink_sac', 'weight': 6, 'functions': count(2, 5)},
            {'type': 'item', 'name': 'minecraft:golden_apple', 'weight': 3, 'functions': count(1, 2)},
        ]},
        {'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:heart_of_the_sea', 'weight': 1}, {'type': 'empty', 'weight': 5}]},
        {'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:trident', 'weight': 1, 'functions': [{'function': 'enchant_randomly'}]},
                                 {'type': 'empty', 'weight': 6}]},
        {'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:enchanted_book', 'weight': 1, 'functions': [{'function': 'enchant_randomly'}]},
                                 {'type': 'empty', 'weight': 2}]},
    ]})


# =================================================================== entry point
def lang_lines():
    return f'entity.{SHADE}.name=???\nitem.{NS}:config_wheel=Brinesleeper Settings\n'


def build(RP, BP, SRC, spawn_conditions, audio):
    creature_bp(BP, spawn_conditions)
    apparition_bp(BP)
    client_files(RP, SRC)
    particles(RP)
    eye_particles(RP)
    sounds(RP, audio)
    atmosphere(RP, audio)
    config_wheel(RP, BP)
    loot_tables(BP)
    shutil.copytree(os.path.join(HERE, 'scripts'), f'{BP}/scripts', dirs_exist_ok=True)
