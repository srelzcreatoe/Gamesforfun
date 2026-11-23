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
import dread

NS = 'brine'
ID = f'{NS}:brinesleeper'
SHADE = f'{NS}:apparition'
HERE = os.path.dirname(os.path.abspath(__file__))
ACTS = ['none', 'watch', 'submerged_watch', 'shoreline_stalk', 'corner_watch', 'distant_observer', 'full_stand', 'emerge',
        'submerge', 'ledge_watch', 'behind_cover', 'head_tilt', 'shadow_hide', 'tunnel_crawl', 'retreat', 'water_rise',
        'hunting_stance', 'slow_approach', 'patient_strike', 'veil_stalk', 'reflection_lurk', 'idle_water', 'swim', 'emerge_roar',
        'run', 'stalk', 'walk', 'ceiling_lurk', 'crawl_still', 'head_turn', 'twitch']
# how long the blend into each pose takes: rising onto two legs and dropping back down are slow, deliberate blends
BLEND = {'full_stand': 1.2, 'hunting_stance': 1.0, 'submerge': 0.6, 'emerge': 0.4, 'water_rise': 0.8, 'retreat': 0.6}
HOLD = ('emerge', 'submerge', 'water_rise', 'retreat', 'emerge_roar')
BLEND.update({'emerge_roar': 0.3, 'swim': 0.6, 'run': 0.3, 'stalk': 0.5, 'walk': 0.5, 'tunnel_crawl': 0.5, 'ceiling_lurk': 0.8, 'crawl_still': 0.4, 'head_turn': 1.0, 'twitch': 0.25})     # one-shot poses keep their last frame
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
    modes = ['brine:ai_roam_land', 'brine:ai_roam_water', 'brine:ai_hold', 'brine:ai_observe', 'brine:ai_stalk', 'brine:ai_hunt',
             'brine:ai_withdraw']
    # every mode group re-declares movement and physics: removing a group that overrode a component removes the
    # component itself, so the next mode must always bring its own
    move = lambda land, water: {'minecraft:movement': {'value': land}, 'minecraft:underwater_movement': {'value': water},
                                'minecraft:physics': {}}
    mode = lambda keep: {'remove': {'component_groups': [m for m in modes if m != keep]}, 'add': {'component_groups': [keep]}}
    still = {**move(0, 0), 'minecraft:behavior.look_at_player': {'priority': 1, 'look_distance': 64, 'probability': 1.0}}
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
                # Since 6.0 the script moves it, every step (brain.js): along your trail, through the water, up the bank.
                # The old AI modes are kept only so a creature saved by an older version loads cleanly; none of them
                # moves it any more (the vanilla pathfinder is what wedged it under ledges and on top of blocks).
                'brine:ai_roam_land': still,
                'brine:ai_roam_water': still,
                'brine:ai_stalk': still,
                'brine:ai_hunt': still,
                'brine:ai_withdraw': still,
                # held exactly where the script puts it: no AI, no gravity (it can float at the waterline, hang from a ceiling)
                'brine:ai_hold': {**move(0, 0), 'minecraft:physics': {'has_gravity': False, 'has_collision': True}},
                # standing still on its own feet, its eyes following you
                'brine:ai_observe': {
                    **move(0, 0),
                    'minecraft:behavior.look_at_player': {'priority': 1, 'look_distance': 64, 'probability': 1.0},
                },
                'brine:vanish': {'minecraft:instant_despawn': {}},
                # full height, or (under low ceilings) down on all fours so it can follow you into any tunnel
                # minecraft:scale multiplies the collision box: these are unscaled sizes (1.15 x 3.91 standing and
                # 1.15 x 1.61 crawling in the game). Before 6.0 the scale was applied twice: a 4.5-block-tall hitbox
                'brine:standing': {'minecraft:collision_box': {'width': 1.0, 'height': 3.4}},
                'brine:crawling': {'minecraft:collision_box': {'width': 1.0, 'height': 1.4}},
            },
            'components': {
                'minecraft:type_family': {'family': ['brinesleeper', 'monster', 'mob']},
                'minecraft:health': {'value': 150, 'max': 150},
                'minecraft:attack': {'damage': 8},
                # a little taller than before (4 blocks), and the hitbox matches the model
                'minecraft:scale': {'value': SCALE},
                'minecraft:collision_box': {'width': 1.0, 'height': 3.4},
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
                'minecraft:knockback_resistance': {'value': 1.0},
                'minecraft:nameable': {},
                'minecraft:persistent': {},
                'minecraft:follow_range': {'value': 64, 'max': 64},
                'minecraft:ambient_sound_interval': {'value': 12, 'range': 16, 'event_name': 'ambient'},
                'minecraft:damage_sensor': {'triggers': [{'cause': 'fall', 'deals_damage': 'no'}, {'cause': 'drowning', 'deals_damage': 'no'},
                                                         {'cause': 'suffocation', 'deals_damage': 'no'}]},
            },
            'events': {
                'minecraft:entity_spawned': {'add': {'component_groups': ['brine:ai_hold', 'brine:threat_2', 'brine:standing']}},
                'brine:crawl_on': {'remove': {'component_groups': ['brine:standing']}, 'add': {'component_groups': ['brine:crawling']}},
                'brine:crawl_off': {'remove': {'component_groups': ['brine:crawling']}, 'add': {'component_groups': ['brine:standing']}},
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


def _first(channel):
    """a channel's value at the start of the animation (constant, keyframed, or pre/post keyframes)"""
    if isinstance(channel, list):
        return channel
    first = channel[min(channel, key=float)]
    if isinstance(first, dict):
        first = first.get('post', first.get('pre'))
    return first


def crawl_still(crawl):
    """down on all fours and not moving: the first frame of the tunnel crawl, held, with only the head alive.
    Used whenever it is still under a low roof, so it never crawls on the spot"""
    bones = {}
    for bone, chans in crawl['bones'].items():
        out = {}
        for ch, v in chans.items():
            val = _first(v)
            if isinstance(val, list) and all(isinstance(e, (int, float)) for e in val):
                out[ch] = [round(e, 3) for e in val]
        if bone == 'head' and 'rotation' in out:
            bx, by, bz = out['rotation']
            out['rotation'] = [f'{bx} + math.sin(query.anim_time * 40) * 4', f'{by} + math.sin(query.anim_time * 23) * 9', bz]
        if out:
            bones[bone] = out
    return {'loop': True, 'animation_length': 6.0, 'bones': bones}


def wrong_pose(stand, kind):
    """two uncanny holds built on its full height:
    turn: it stands with its back to you and its head turned all the way round to look at you (slowly settling)
    twitch: it stands still, but its head snaps from angle to angle, never smoothly"""
    bones = {}
    for bone, chans in stand['bones'].items():
        out = {}
        for ch, v in chans.items():
            val = _first(v)
            if isinstance(val, list) and all(isinstance(e, (int, float)) for e in val):
                out[ch] = [round(e, 3) for e in val]
        if out:
            bones[bone] = out
    hx, hy, hz = bones.get('head', {}).get('rotation', [0, 0, 0])
    if kind == 'turn':
        bones.setdefault('head', {})['rotation'] = [f'{hx} + math.sin(query.anim_time * 30) * 3', 180 + hy, f'{hz} + 12 + math.sin(query.anim_time * 17) * 4']
    else:
        step = lambda rate, n: f'math.mod(math.floor(query.anim_time * {rate}), {n})'
        bones.setdefault('head', {})['rotation'] = [f'{hx} + ({step(5.3, 3)} - 1) * 16', f'{hy} + ({step(3.7, 2)} * 2 - 1) * 24',
                                                    f'{hz} + ({step(6.1, 2)} * 2 - 1) * 28']
    return {'loop': True, 'animation_length': 6.0, 'bones': bones}


def client_files(RP, SRC):
    anims = {
        'watch': 'animation.brinesleeper.watch', 'idle_water': 'animation.brinesleeper.idle_water', 'walk': 'animation.brinesleeper.walk',
        'stalk': 'animation.brinesleeper.crouch_stalk', 'run': 'animation.brinesleeper.run', 'swim': 'animation.brinesleeper.swim',
        'lunge': 'animation.brinesleeper.lunge', 'grasp': 'animation.brinesleeper.grasp', 'emerge': 'animation.brinesleeper.emerge',
        'submerge': 'animation.brinesleeper.submerge', 'look_at_target': 'animation.brinesleeper.look_at_target',
        **{n: f'animation.brinesleeper.{n}' for n in POSES},
        'crawl_still': 'animation.brinesleeper.crawl_still',
        'head_turn': 'animation.brinesleeper.head_turn', 'twitch': 'animation.brinesleeper.twitch',
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
    anim['animations']['animation.brinesleeper.crawl_still'] = crawl_still(anim['animations']['animation.brinesleeper.tunnel_crawl'])
    stand = anim['animations']['animation.brinesleeper.full_stand']
    anim['animations']['animation.brinesleeper.head_turn'] = wrong_pose(stand, 'turn')
    anim['animations']['animation.brinesleeper.twitch'] = wrong_pose(stand, 'twitch')
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


# =================================================================== sounds: every one built by dread.py (plus two of the repository's recordings)
SOUND_EVENTS = {
    'mob.brinesleeper.breathe': (['mob/brinesleeper/breathe'], 0.8, 'hostile'),
    'mob.brinesleeper.click': (['mob/brinesleeper/click1', 'mob/brinesleeper/click2'], 1.0, 'hostile'),
    'mob.brinesleeper.call': (['mob/brinesleeper/call'], 1.0, 'hostile'),
    'mob.brinesleeper.lunge': (['mob/brinesleeper/lunge'], 1.0, 'hostile'),
    'mob.brinesleeper.grasp': (['mob/brinesleeper/grasp'], 1.0, 'hostile'),
    'mob.brinesleeper.hurt': (['mob/brinesleeper/hurt'], 1.0, 'hostile'),
    'mob.brinesleeper.death': (['mob/brinesleeper/death'], 1.0, 'hostile'),
    'mob.brinesleeper.emerge': (['mob/brinesleeper/emerge'], 1.0, 'hostile'),
    'mob.brinesleeper.submerge': (['mob/brinesleeper/submerge'], 0.9, 'hostile'),
    'mob.brinesleeper.step': (['mob/brinesleeper/step1', 'mob/brinesleeper/step2'], 0.75, 'hostile'),
    'mob.brinesleeper.roar': (['mob/brinesleeper/roar'], 1.0, 'hostile'),
    'mob.brinesleeper.hiss': (['mob/brinesleeper/hiss'], 0.8, 'hostile'),
    'mob.brinesleeper.moan': (['mob/brinesleeper/moan'], 1.0, 'hostile'),
    'brine.fx.splash_far': (['brine_fx/splash_far'], 1.0, 'ambient'),
    'brine.fx.surge': (['brine_fx/surge'], 1.0, 'ambient'),
    'brine.fx.bubbles': (['brine_fx/bubbles'], 0.8, 'ambient'),
    'brine.fx.ripple': (['brine_fx/ripple'], 0.7, 'ambient'),
    'brine.fx.drip': (['brine_fx/drip'], 0.7, 'ambient'),
    'brine.fx.knock': (['brine_fx/knock'], 0.9, 'ambient'),
    'brine.fx.thump': (['brine_fx/thump'], 1.0, 'ambient'),
    'brine.fx.snuff': (['brine_fx/snuff'], 0.7, 'block'),
    'brine.fx.burst': (['brine_fx/burst'], 1.0, 'hostile'),
    'brine.heartbeat': (['brine_fx/heartbeat'], 1.0, 'player'),
    'brine.spotted': (['brine_fx/spotted'], 1.0, 'hostile'),
    'brine.jumpscare': (['brine_fx/jumpscare'], 1.0, 'hostile'),
}
# the music: five calm tracks for the caves (each with its own character), two "near" loops, the chase loop, stings
CALM = [(110, 41.2, 'air'), (111, 36.7, 'metal'), (112, 43.65, 'voices'), (113, 38.9, 'deep'), (114, 46.25, 'still')]
MUSIC = {
    **{f'music/brine/stillwater_{i + 1}': (lambda c=c: dread.calm_track(c[0], c[1], 80.0, c[2])) for i, c in enumerate(CALM)},
    'music/brine/near_1': lambda: dread.near_loop(150),
    'music/brine/near_2': lambda: dread.near_loop(151),
    'music/brine/chase': lambda: dread.exe_chase(202),
    'music/brine/sting_1': lambda: dread.sting(301),
    'music/brine/sting_2': lambda: dread.sting(302),
    'music/brine/sting_3': lambda: dread.sting(303),
}


def _recording(path):
    """one of the repository's own recordings, at the sound engine's rate"""
    a = biome._load_wav(path)
    return np.interp(np.arange(0, len(a) - 1, biome.SR / dread.SR), np.arange(len(a)), a)


def encode(x, out, sr, quality=4, normalize=True):
    """mono or stereo (2 x n) to Ogg Vorbis. Mastered music keeps its level; effects are peak-normalized"""
    x = np.asarray(x, dtype=float)
    if normalize:
        x = x / (np.max(np.abs(x)) or 1.0) * 0.89
    else:
        x = np.clip(x, -0.999, 0.999)
    st = x.ndim == 2
    pcm = ((x.T if st else x) * 32767).astype(np.int16)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, 'a.wav')
        with wave.open(wav_path, 'w') as w:
            w.setnchannels(2 if st else 1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav_path, '-c:a', 'libvorbis', '-q:a', str(quality), out], check=True)


def sounds(RP, audio):
    """its voice and body, the water, the heartbeat and the spotted sting: mono, positional"""
    fx = dread.creature(_recording(os.path.join(audio, 'splash.wav')), _recording(os.path.join(audio, 'step_stone.wav')))
    fx['brine_fx/spotted'] = dread.spotted()
    fx['brine_fx/jumpscare'] = dread.jumpscare_scream()
    for rel, x in fx.items():
        fade = np.minimum(1.0, (len(x) - np.arange(len(x))) / (0.25 * dread.SR))
        encode(x * fade, f'{RP}/sounds/{rel}.ogg', dread.SR, 4)
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


def atmosphere(RP, audio):
    """the music (stereo, streamed) and the stings"""
    for rel, fn in MUSIC.items():
        x = fn()
        encode(x, f'{RP}/sounds/{rel}.ogg', dread.SR, 2 if np.ndim(x) == 2 else 4, normalize=False)
    defs_path = f'{RP}/sounds/sound_definitions.json'
    defs = load(defs_path)
    defs['sound_definitions']['music.brine.stillwater'] = {'category': 'music', 'sounds': [
        {'name': f'sounds/music/brine/stillwater_{i}', 'stream': True, 'volume': 1.0} for i in range(1, 6)]}
    defs['sound_definitions']['music.brine.near'] = {'category': 'music', 'sounds': [
        {'name': f'sounds/music/brine/near_{i}', 'stream': True, 'volume': 1.0} for i in range(1, 3)]}
    defs['sound_definitions']['music.brine.chase'] = {'category': 'music', 'sounds': [
        {'name': 'sounds/music/brine/chase', 'stream': True, 'volume': 1.0}]}
    defs['sound_definitions']['music.brine.sting'] = {'category': 'music', 'sounds': [
        {'name': f'sounds/music/brine/sting_{i}', 'volume': 1.0} for i in range(1, 4)]}
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
