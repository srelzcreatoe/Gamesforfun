"""Stillwater Caves: the Brinesleeper's home biome (Bedrock custom biome, 1.26.30+).

Writes into the resource and behavior packs:
  BP biomes/          brine:stillwater_caves, which takes over most of the vanilla dripstone caves
  BP blocks/          vanilla-style blocks: bloodstained/clawed/veined deepslate, tracked mud, bone coral,
                      bloodroot, pallid caps and four sizes of pale (bleached) dripstone
  BP features/        the flooded halls (huge domed caverns over deep black lakes, carved by structure
  BP feature_rules/   features at two fixed waterlines), great stone pillars, pale and red stalactite
                      curtains, ribcages, candle-lit sunken shrines, fossils, glowing blood veins, shores
                      with coral, bloodroot and pallid caps, footprint trails and claw-marked walls
  BP structures/      the hall pieces, pillars, ribcages, ruins and stalactite columns (biome_shapes.py)
  RP biomes/ fogs/    dark fog, murky water, drifting ash, no music, echoing ambient splashes
  RP textures/ sounds/ texts/
The biome has no 'monster' tag, so no vanilla hostile mob spawns in it; the Brinesleeper's spawn
rule (SPAWN_CONDITIONS) uses the biome's own 'stillwater_caves' tag.

Usage: python3 biome.py <pack root dir>   (normally called from pack.py)
"""
import json
import math
import os
import random
import struct
import subprocess
import sys
import tempfile
import wave

import numpy as np
from PIL import Image

import biome_shapes as shapes
from biome_shapes import Byte

NS = 'brine'
BIOME = f'{NS}:stillwater_caves'
TAG = 'stillwater_caves'
FOG = f'{NS}:fog_stillwater_caves'
AMBIENT = 'ambient.brine.stillwater.additions'
BIOME_FORMAT = '1.26.30'          # minecraft:subsurface_builder + noise_gradient
FEATURE_FORMAT = '1.21.60'
SNAP_EMBED_FORMAT = '1.26.20'     # snap_to_surface "embed_in_surface" (must stay below 1.26.50, where the range key is renamed)
STRUCTURE_FORMAT = '1.21.110'
BLOCK_FORMAT = '1.26.30'
AMOUNT, FREQUENCY = 0.7, 0.3       # share of the dripstone caves taken over, and how coarse the patches are
LEVELS = (-24, 12)                # world y of the two waterlines the flooded halls are carved at
HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'assets', 'audio'))

# solid cave blocks that decorations may sit on or replace
CAVE_STONE = ['minecraft:stone', 'minecraft:deepslate', 'minecraft:tuff', 'minecraft:smooth_basalt', 'minecraft:granite',
              'minecraft:diorite', 'minecraft:andesite', 'minecraft:cobbled_deepslate', 'minecraft:calcite', 'minecraft:dripstone_block']
CAVE_SOIL = ['minecraft:gravel', 'minecraft:dirt', 'minecraft:mud', 'minecraft:clay', 'minecraft:coarse_dirt']

# the Brinesleeper only spawns here, in water or on the dark cave floor (pack.py writes the spawn rule)
SPAWN_CONDITIONS = [
    {
        'minecraft:spawns_underground': {},
        'minecraft:spawns_underwater': {},
        'minecraft:brightness_filter': {'min': 0, 'max': 7, 'adjust_for_weather': True},
        'minecraft:difficulty_filter': {'min': 'easy', 'max': 'hard'},
        'minecraft:height_filter': {'min': -60, 'max': 120},
        'minecraft:weight': {'default': 80},
        'minecraft:density_limit': {'underground': 2},
        'minecraft:herd': {'min_size': 1, 'max_size': 1},
        'minecraft:biome_filter': {'test': 'has_biome_tag', 'operator': '==', 'value': TAG},
    },
    {
        'minecraft:spawns_underground': {},
        'minecraft:brightness_filter': {'min': 0, 'max': 4, 'adjust_for_weather': True},
        'minecraft:difficulty_filter': {'min': 'easy', 'max': 'hard'},
        'minecraft:height_filter': {'min': -60, 'max': 120},
        'minecraft:weight': {'default': 25},
        'minecraft:density_limit': {'underground': 2},
        'minecraft:herd': {'min_size': 1, 'max_size': 1},
        'minecraft:biome_filter': {'test': 'has_biome_tag', 'operator': '==', 'value': TAG},
    },
]

BLOCK_NAMES = {
    'bloodstained_deepslate': 'Bloodstained Deepslate',
    'clawed_deepslate': 'Clawed Deepslate',
    'tracked_mud': 'Tracked Mud',
    'bone_coral': 'Bone Coral',
    'bloodroot': 'Bloodroot',
    'veined_deepslate': 'Veined Deepslate',
    'pallid_cap': 'Pallid Caps',
    'pale_dripstone_base': 'Pale Dripstone',
    'pale_dripstone_middle': 'Pale Dripstone',
    'pale_dripstone_frustum': 'Pale Dripstone',
    'pale_dripstone_tip': 'Pale Dripstone',
}


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')


# =================================================================== biome (behavior + client)
def biome_files(RP, BP):
    write(f'{BP}/biomes/stillwater_caves.biome.json', {
        'format_version': BIOME_FORMAT,
        'minecraft:biome': {
            'description': {'identifier': BIOME},
            'components': {
                'minecraft:climate': {'temperature': 0.4, 'downfall': 0.7},
                'minecraft:humidity': {'is_humid': True},
                'minecraft:overworld_height': {'noise_type': 'default'},
                # where the cave biome reaches daylight it looks like vanilla dripstone caves
                'minecraft:surface_builder': {'builder': {
                    'type': 'minecraft:overworld', 'sea_floor_depth': 7, 'sea_floor_material': 'minecraft:gravel',
                    'foundation_material': 'minecraft:stone', 'mid_material': 'minecraft:dirt',
                    'top_material': 'minecraft:stone', 'sea_material': 'minecraft:water'}},
                # cave walls: dark deepslate with bands of tuff and smooth basalt, plain stone between
                'minecraft:subsurface_builder': {'builder': {
                    'type': 'minecraft:noise_gradient',
                    'noise_descriptor': {'name': f'{NS}:stillwater_walls', 'first_octave': -6, 'amplitudes': [1.0, 0.5, 0.25]},
                    'non_replaceable_blocks': ['minecraft:bedrock'],
                    'noise_block_specifiers': [
                        {'range': {'min': -1.0, 'max': -0.12}, 'block': 'minecraft:deepslate'},
                        {'range': {'min': -0.12, 'max': -0.05}, 'block': 'minecraft:tuff'},
                        {'range': {'min': 0.18, 'max': 0.3}, 'block': 'minecraft:smooth_basalt'},
                        {'range': {'min': 0.3, 'max': 1.0}, 'block': 'minecraft:deepslate'},
                    ]}},
                # takes over most of the vanilla dripstone caves (append new rules at the END only).
                # Targets need the full 'minecraft:' identifier: the game reports "No biome found with name"
                # for a bare 'dripstone_caves', whatever the docs say. The low noise_frequency_scale makes the
                # replaced regions big and contiguous (fewer, larger cave systems instead of speckles).
                'minecraft:replace_biomes': {'replacements': [{
                    'dimension': 'minecraft:overworld', 'targets': ['minecraft:dripstone_caves'],
                    'amount': AMOUNT, 'noise_frequency_scale': FREQUENCY}]},
                # no 'monster' tag: vanilla zombies, skeletons, creepers, spiders, witches, endermen, slimes and
                # cave spiders cannot spawn; no 'dripstone_caves' tag: no drowned
                'minecraft:tags': {'tags': ['caves', 'overworld', TAG]},
            },
        },
    })
    write(f'{RP}/biomes/stillwater_caves.client_biome.json', {
        'format_version': '1.21.120',
        'minecraft:client_biome': {
            'description': {'identifier': BIOME},
            'components': {
                'minecraft:fog_appearance': {'fog_identifier': FOG},
                # murky: you can't see what is under you
                'minecraft:water_appearance': {'surface_color': '#0c171c', 'surface_opacity': 0.92},
                'minecraft:sky_color': {'sky_color': '#0b1013'},
                'minecraft:atmosphere_identifier': {'atmosphere_identifier': 'minecraft:default_atmospherics'},
                'minecraft:color_grading_identifier': {'color_grading_identifier': 'minecraft:default_color_grading'},
                'minecraft:lighting_identifier': {'lighting_identifier': 'minecraft:default_lighting'},
                'minecraft:water_identifier': {'water_identifier': 'minecraft:default_water'},
                'minecraft:ambient_sounds': {
                    'addition': {'asset': AMBIENT, 'chance': 0.006},
                    'mood': 'ambient.cave',
                    'underwater_addition': {'asset': 'ambient.underwater.additions', 'chance': 0.01},
                    'underwater_loop': 'ambient.underwater.loop',
                },
                'minecraft:precipitation': {'ash': 0.035},
                # its own music: four slow, dark tracks with long silences between them (music_definitions.json)
                'minecraft:biome_music': {'music_definition': 'brine_stillwater', 'volume_multiplier': 1.0},
            },
        },
    })
    write(f'{RP}/fogs/stillwater_caves_fog_setting.json', {
        'format_version': '1.21.90',
        'minecraft:fog_settings': {
            'description': {'identifier': FOG},
            'distance': {
                'air': {'fog_start': 8.0, 'fog_end': 96.0, 'fog_color': '#0c1216', 'render_distance_type': 'fixed'},
                'weather': {'fog_start': 8.0, 'fog_end': 96.0, 'fog_color': '#0c1216', 'render_distance_type': 'fixed'},
                # under the surface you see 9 blocks into near-black water, and less the deeper you go
                'water': {
                    'fog_start': 0.0, 'fog_end': 9.0, 'fog_color': '#040b0e', 'render_distance_type': 'fixed',
                    'transition_fog': {
                        'init_fog': {'fog_start': 0.0, 'fog_end': 0.01, 'fog_color': '#040b0e', 'render_distance_type': 'fixed'},
                        'min_percent': 0.25, 'mid_seconds': 5, 'mid_percent': 0.6, 'max_seconds': 30},
                },
                'lava': {'fog_start': 0.0, 'fog_end': 0.64, 'fog_color': '#991A00', 'render_distance_type': 'fixed'},
                'lava_resistance': {'fog_start': 2.0, 'fog_end': 4.0, 'fog_color': '#991A00', 'render_distance_type': 'fixed'},
            },
            'volumetric': {
                'density': {'air': {'max_density': 0.12, 'zero_density_height': 320.0, 'max_density_height': 320.0}},
                'media_coefficients': {'air': {'scattering': [0.08, 0.09, 0.1], 'absorption': [0.02, 0.02, 0.015]}},
                'henyey_greenstein_g': {'air': {'henyey_greenstein_g': 0.35}},
            },
        },
    })


# =================================================================== blocks
def full_block(name, seconds, resist, map_color, faces, light=0):
    comps = {
        'minecraft:geometry': 'minecraft:geometry.full_block',
        'minecraft:material_instances': faces,
        'minecraft:destructible_by_mining': {'seconds_to_destroy': seconds},
        'minecraft:destructible_by_explosion': {'explosion_resistance': resist},
        'minecraft:map_color': map_color,
    }
    if light:
        comps['minecraft:light_emission'] = light
    return {
        'format_version': BLOCK_FORMAT,
        'minecraft:block': {
            'description': {'identifier': f'{NS}:{name}', 'menu_category': {'category': 'nature'}},
            'components': comps,
        },
    }


SUPPORT = CAVE_STONE + CAVE_SOIL + [f'{NS}:bloodstained_deepslate', f'{NS}:clawed_deepslate', f'{NS}:veined_deepslate',
                                    f'{NS}:tracked_mud', 'minecraft:cobblestone', 'minecraft:mossy_cobblestone']


def plant_block(name, map_color, height, light=0):
    soil = ['minecraft:mud', 'minecraft:gravel', 'minecraft:clay', 'minecraft:dirt', 'minecraft:coarse_dirt', 'minecraft:stone',
            'minecraft:deepslate', 'minecraft:tuff', 'minecraft:smooth_basalt', 'minecraft:cobbled_deepslate', 'minecraft:dripstone_block',
            'minecraft:calcite', f'{NS}:tracked_mud', f'{NS}:bloodstained_deepslate', f'{NS}:clawed_deepslate', f'{NS}:veined_deepslate']
    comps = {
        'minecraft:geometry': 'minecraft:geometry.cross',
        'minecraft:material_instances': {'*': {'texture': f'{NS}_{name}', 'render_method': 'alpha_test_single_sided',
                                               'ambient_occlusion': 0.0, 'face_dimming': False}},
        'minecraft:collision_box': False,
        'minecraft:selection_box': {'origin': [-6, 0, -6], 'size': [12, height, 12]},
        'minecraft:destructible_by_mining': {'seconds_to_destroy': 0.0},
        'minecraft:destructible_by_explosion': {'explosion_resistance': 0.0},
        'minecraft:light_dampening': 0,
        'minecraft:replaceable': {},
        'minecraft:placement_filter': {'conditions': [{'allowed_faces': ['up'], 'block_filter': soil}]},
        'minecraft:liquid_detection': {'detection_rules': [{'liquid_type': 'water', 'on_liquid_touches': 'popped'}]},
        'minecraft:map_color': map_color,
    }
    if light:
        comps['minecraft:light_emission'] = light
    return {
        'format_version': BLOCK_FORMAT,
        'minecraft:block': {
            'description': {'identifier': f'{NS}:{name}', 'menu_category': {'category': 'nature', 'group': 'minecraft:itemGroup.name.grass'}},
            'components': comps,
        },
    }


PALE_PARTS = ('base', 'middle', 'frustum', 'tip')
PALE_WIDTH = {'base': 12, 'middle': 10, 'frustum': 8, 'tip': 6}


def pale_dripstone_block(part):
    """bleached dripstone: a hanging cross-shaped spike like vanilla pointed dripstone, held up by the block above"""
    hold = SUPPORT + [f'{NS}:pale_dripstone_{p}' for p in PALE_PARTS]
    w = PALE_WIDTH[part]
    return {
        'format_version': BLOCK_FORMAT,
        'minecraft:block': {
            'description': {'identifier': f'{NS}:pale_dripstone_{part}', 'menu_category': {'category': 'nature'}},
            'components': {
                'minecraft:geometry': 'minecraft:geometry.cross',
                'minecraft:material_instances': {'*': {'texture': f'{NS}_pale_dripstone_{part}', 'render_method': 'alpha_test_single_sided',
                                                       'ambient_occlusion': 0.0, 'face_dimming': False}},
                'minecraft:collision_box': {'origin': [-w / 4, 0, -w / 4], 'size': [w / 2, 16, w / 2]},
                'minecraft:selection_box': {'origin': [-w / 2, 0, -w / 2], 'size': [w, 16, w]},
                'minecraft:destructible_by_mining': {'seconds_to_destroy': 1.5},
                'minecraft:destructible_by_explosion': {'explosion_resistance': 3.0},
                'minecraft:light_dampening': 0,
                # hangs from the underside of the block above, like a stalactite; breaks if that block goes
                'minecraft:placement_filter': {'conditions': [{'allowed_faces': ['down'], 'block_filter': hold}]},
                'minecraft:map_color': '#cfc9b6',
            },
        },
    }


def block_files(RP, BP):
    tex = lambda n: f'{NS}_{n}'
    write(f'{BP}/blocks/bloodstained_deepslate.json', full_block(
        'bloodstained_deepslate', 3.0, 6.0, '#4a2a2c',
        {'*': {'texture': tex('bloodstained_deepslate'), 'render_method': 'opaque'},
         'up': {'texture': tex('bloodstained_deepslate_top'), 'render_method': 'opaque'},
         'down': {'texture': tex('bloodstained_deepslate_bottom'), 'render_method': 'opaque'}}))
    write(f'{BP}/blocks/clawed_deepslate.json', full_block(
        'clawed_deepslate', 3.0, 6.0, '#464649',
        {'*': {'texture': tex('clawed_deepslate'), 'render_method': 'opaque'},
         'up': {'texture': tex('deepslate_top_plain'), 'render_method': 'opaque'},
         'down': {'texture': tex('deepslate_top_plain'), 'render_method': 'opaque'}}))
    write(f'{BP}/blocks/veined_deepslate.json', full_block(
        'veined_deepslate', 3.0, 6.0, '#5a1418',
        {'*': {'texture': tex('veined_deepslate'), 'render_method': 'opaque'},
         'up': {'texture': tex('veined_deepslate_top'), 'render_method': 'opaque'},
         'down': {'texture': tex('veined_deepslate_top'), 'render_method': 'opaque'}}, light=3))
    write(f'{BP}/blocks/tracked_mud.json', full_block(
        'tracked_mud', 0.5, 0.5, '#3a383d',
        {'*': {'texture': tex('mud_plain'), 'render_method': 'opaque'},
         'up': {'texture': tex('tracked_mud_top'), 'render_method': 'opaque'}}))
    write(f'{BP}/blocks/bone_coral.json', plant_block('bone_coral', '#dedac5', 12))
    write(f'{BP}/blocks/bloodroot.json', plant_block('bloodroot', '#7b0000', 14, light=5))
    write(f'{BP}/blocks/pallid_cap.json', plant_block('pallid_cap', '#d8d2c2', 10, light=3))
    for part in PALE_PARTS:
        write(f'{BP}/blocks/pale_dripstone_{part}.json', pale_dripstone_block(part))

    names = ['bloodstained_deepslate', 'bloodstained_deepslate_top', 'bloodstained_deepslate_bottom', 'clawed_deepslate',
             'deepslate_top_plain', 'veined_deepslate', 'veined_deepslate_top', 'mud_plain', 'tracked_mud_top', 'bone_coral',
             'bloodroot', 'pallid_cap'] + [f'pale_dripstone_{p}' for p in PALE_PARTS]
    write(f'{RP}/textures/terrain_texture.json', {
        'resource_pack_name': 'brinesleeper', 'texture_name': 'atlas.terrain', 'padding': 8, 'num_mip_levels': 4,
        'texture_data': {tex(n): {'textures': f'textures/blocks/{NS}/{n}'} for n in names},
    })
    sounds = {f'{NS}:bloodstained_deepslate': 'deepslate', f'{NS}:clawed_deepslate': 'deepslate', f'{NS}:veined_deepslate': 'deepslate',
              f'{NS}:tracked_mud': 'mud', f'{NS}:bone_coral': 'coral', f'{NS}:bloodroot': 'roots', f'{NS}:pallid_cap': 'fungus'}
    sounds.update({f'{NS}:pale_dripstone_{p}': 'pointed_dripstone' for p in PALE_PARTS})
    write(f'{RP}/blocks.json', {'format_version': '1.19.30', **{k: {'sound': v} for k, v in sounds.items()}})
    textures(f'{RP}/textures/blocks/{NS}')


# ------------------------------------------------------------------ 16x16 textures in the vanilla palette
DEEP_SIDE = ['#2f2f37', '#3d3d43', '#515151', '#646464', '#797979']
DEEP_TOP = ['#3d3d43', '#4b4b50', '#5a5a5a', '#646464', '#747474']
MUD = ['#322d36', '#33323a', '#3a383d', '#3e3836', '#434445', '#46403e', '#494a4c']
BLOOD = ['#3a0608', '#5a0000', '#6a0400', '#7b0000', '#941818', '#a42429']
BONE = ['#8e8a78', '#b5ae95', '#cfc9b2', '#dedac5', '#e9e6d4', '#f3f1e4']
ROOT = ['#3a0418', '#50062a', '#660627', '#920636', '#ad101c', '#c8243a']


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def tile_noise(rng, sx, sy, octaves=((4, 1.0), (8, 0.5), (16, 0.25))):
    """periodic value noise on a 16x16 tile; sx/sy stretch it (horizontal streaks for deepslate)"""
    out = np.zeros((16, 16))
    for cells, amp in octaves:
        cx, cy = max(1, int(cells / sx)), max(1, int(cells / sy))
        g = rng.random((cy, cx))
        ys, xs = np.mgrid[0:16, 0:16]
        fx, fy = xs * cx / 16.0, ys * cy / 16.0
        x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
        tx, ty = fx - x0, fy - y0
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        a = g[y0 % cy, x0 % cx]; b = g[y0 % cy, (x0 + 1) % cx]
        c = g[(y0 + 1) % cy, x0 % cx]; d = g[(y0 + 1) % cy, (x0 + 1) % cx]
        out += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty)
    out -= out.min()
    return out / max(out.max(), 1e-9)


def paint(noise, palette, cuts, rng=None, speck=0.0):
    img = Image.new('RGBA', (16, 16))
    for y in range(16):
        for x in range(16):
            v = noise[y, x]
            if rng is not None and rng.random() < speck:
                v = rng.random()
            i = sum(v > c for c in cuts)
            img.putpixel((x, y), rgb(palette[min(i, len(palette) - 1)]) + (255,))
    return img


def deepslate_side(seed):
    rng = np.random.default_rng(seed)
    n = tile_noise(rng, 2.5, 0.6)
    img = paint(n, DEEP_SIDE, [0.18, 0.4, 0.66, 0.9], rng, speck=0.04)
    # the layered look: a few dark horizontal seams
    r = random.Random(seed)
    for _ in range(4):
        y, x, ln = r.randrange(16), r.randrange(16), r.randint(3, 7)
        for k in range(ln):
            img.putpixel(((x + k) % 16, y), rgb(DEEP_SIDE[0 if r.random() < 0.5 else 1]) + (255,))
    return img


def deepslate_top(seed):
    rng = np.random.default_rng(seed)
    return paint(tile_noise(rng, 1.0, 1.0), DEEP_TOP, [0.2, 0.42, 0.64, 0.88], rng, speck=0.05)


def mud_tex(seed):
    rng = np.random.default_rng(seed)
    return paint(tile_noise(rng, 1.2, 1.0), MUD, [0.14, 0.3, 0.45, 0.6, 0.74, 0.88], rng, speck=0.08)


def put(img, x, y, col):
    if 0 <= x < 16 and 0 <= y < 16:
        img.putpixel((x, y), rgb(col) + (255,))


def bloodstained_side(seed):
    img = deepslate_side(seed)
    r = random.Random(seed + 7)
    for x in r.sample(range(16), 5):
        ln = r.randint(4, 15)
        for y in range(ln):
            t = y / max(ln - 1, 1)
            col = BLOOD[3] if t < 0.35 else BLOOD[2] if t < 0.7 else BLOOD[1]
            put(img, x, y, col)
            if r.random() < 0.18 and y < ln - 2:
                put(img, x + r.choice((-1, 1)), y, BLOOD[0])
        put(img, x, ln, BLOOD[4])              # the bead of a drip about to fall
    for _ in range(6):                          # dried flecks
        put(img, r.randrange(16), r.randrange(4), BLOOD[0])
    return img


def bloodstained_bottom(seed):
    img = deepslate_top(seed)
    r = random.Random(seed + 3)
    for _ in range(5):                          # pooled drops on the underside, wet centres
        cx, cy, rad = r.randrange(16), r.randrange(16), r.choice((1, 1, 2))
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if dx * dx + dy * dy <= rad * rad + 0.5:
                    put(img, (cx + dx) % 16, (cy + dy) % 16, BLOOD[2] if (dx or dy) else BLOOD[4])
    for _ in range(10):
        put(img, r.randrange(16), r.randrange(16), BLOOD[r.choice((0, 1))])
    return img


def bloodstained_top(seed):
    img = deepslate_top(seed)
    r = random.Random(seed + 5)
    for _ in range(7):
        put(img, r.randrange(16), r.randrange(16), BLOOD[r.choice((0, 1, 1, 2))])
    return img


def clawed_side(seed):
    img = deepslate_side(seed)
    r = random.Random(seed + 11)
    # three claw gouges raked diagonally (upper right to lower left), well apart, of uneven depth
    for x0, y0, ln in ((13, 1, 12), (9, 2, 13), (5, 4, 10)):
        for k in range(ln):
            y = y0 + k
            x = int(round(x0 - k * 0.5))
            put(img, x, y, '#1b1b21')                                  # the cut
            put(img, x + 1, y, '#8f8f93' if k % 4 else '#adadb0')      # pale torn lip
            if 2 < k < ln - 3 and r.random() < 0.45:
                put(img, x - 1, y, '#26262c')                          # deeper middle of the stroke
            if 3 < k < ln - 2 and r.random() < 0.28:
                put(img, x, y, BLOOD[1])                               # dried blood in the groove
        put(img, int(round(x0 - ln * 0.5)), y0 + ln, '#2f2f37')        # the claw tip drags out
    for _ in range(5):                                                  # chips knocked off the stone
        put(img, r.randrange(16), r.randrange(16), '#9a9a9e')
    return img


def tracked_mud_top(seed):
    img = mud_tex(seed)
    dark, rim, sheen = '#222127', '#2c2a31', '#5a5e68'
    # a three-toed clawed print, toes pointing north
    heel = [(6, 11), (7, 11), (8, 11), (9, 11), (6, 12), (7, 12), (8, 12), (9, 12), (7, 13), (8, 13)]
    for x, y in heel:
        put(img, x, y, dark)
    toes = [[(7, 10), (7, 9), (7, 8), (8, 8), (7, 7), (8, 7), (7, 6), (8, 6), (7, 5)],
            [(5, 10), (5, 9), (4, 8), (4, 7), (3, 6), (3, 5)],
            [(10, 10), (10, 9), (11, 8), (11, 7), (12, 6), (12, 5)]]
    for toe in toes:
        for x, y in toe:
            put(img, x, y, dark)
        tx, ty = toe[-1]
        put(img, tx, ty - 1, rim)            # claw prick beyond the toe
        put(img, tx, ty - 2, '#1a191e')
    for x, y in ((10, 11), (10, 12), (9, 13), (8, 14)):
        put(img, x, y, sheen)                # wet sheen on the heel's edge
    for x, y in ((8, 9), (6, 8), (9, 8)):
        put(img, x, y, rim)
    return img


BONE_CORAL = [
    '................',
    '...e......e.....',
    '...a..e...a..e..',
    '...ab.a...ab.a..',
    '....b.ab..b..ab.',
    '.e..bc.b.bc..b..',
    '.a...bcbbc..bc..',
    '.ab...bbc..bc..e',
    '..bc..bfc.bc...a',
    '...bc.bbcbc...ac',
    '....bcbbcc...bc.',
    '.....bbfcc.bcc..',
    '......bbcccc....',
    '.......bcc......',
    '.......bcd......',
    '......dbcdd.....',
]


def bone_coral(seed):
    """pale branching coral like bleached bone (hand-placed pixels in the vanilla dead-coral style)"""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    key = {'e': BONE[5], 'a': BONE[4], 'b': BONE[3], 'c': BONE[2], 'd': BONE[1], 'f': BONE[0]}
    for y, row in enumerate(BONE_CORAL):
        for x, ch in enumerate(row):
            if ch in key:
                put(img, x, y, key[ch])
    return img


def bloodroot(seed):
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    r = random.Random(seed)
    for x0, h, lean in ((4, 10, -0.25), (7, 14, 0.1), (9, 12, 0.3), (12, 9, 0.35)):
        x = float(x0)
        for k in range(h):
            y = 15 - k
            t = k / max(h - 1, 1)
            col = ROOT[1] if t < 0.3 else ROOT[2] if t < 0.6 else ROOT[3] if t < 0.85 else ROOT[4]
            put(img, int(round(x)), y, col)
            if 0.35 < t < 0.8 and r.random() < 0.22:          # little thorny leaves
                put(img, int(round(x)) + r.choice((-1, 1)), y, ROOT[2])
            x += lean * (0.5 + t)
        put(img, int(round(x)), 15 - h, ROOT[5])               # glistening red bud
    for x in range(3, 13):
        if r.random() < 0.35:
            put(img, x, 15, ROOT[0])
    return img


PALE = ['#4f4a42', '#6c665a', '#8c8576', '#aaa392', '#c6bfad', '#ddd7c6', '#eeeadd']
VEIN = ['#2a0507', '#4e0a0f', '#7d1218', '#b3202a', '#e0453f']


def veins(img, seed, n=3):
    """branching crimson veins with bright glowing cores, drawn over a stone tile"""
    r = random.Random(seed)
    for _ in range(n):
        x, y = r.randrange(16), r.randrange(16)
        dx = r.choice((-1, 1))
        for k in range(r.randint(9, 15)):
            core = 3 < k < 11
            put(img, x % 16, y % 16, VEIN[3] if core else VEIN[2])
            if core and r.random() < 0.3:
                put(img, x % 16, y % 16, VEIN[4])
            put(img, (x + 1) % 16, y % 16, VEIN[1]) if r.random() < 0.35 else None
            if r.random() < 0.18:                                     # a short side branch
                bx, by = x, y
                for _ in range(r.randint(2, 4)):
                    bx += r.choice((-1, 1)); by += r.choice((-1, 0, 1))
                    put(img, bx % 16, by % 16, VEIN[1] if r.random() < 0.6 else VEIN[2])
            y += 1
            if r.random() < 0.55:
                x += dx
            if r.random() < 0.2:
                dx = -dx
    return img


def veined_side(seed):
    return veins(deepslate_side(seed), seed + 1, 3)


def veined_top(seed):
    return veins(deepslate_top(seed), seed + 2, 2)


def pallid_cap(seed):
    """a cluster of three pale cave mushrooms on thin stems (vanilla mushroom-style pixel art)"""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    r = random.Random(seed)
    stem, stem_dk = PALE[4], PALE[2]
    for cx, h, cw in ((8, 8, 7), (3, 4, 4), (13, 5, 4)):
        for y in range(15, 15 - h, -1):                            # stem
            put(img, cx, y, stem if y % 3 else stem_dk)
            if cw >= 6:
                put(img, cx - 1, y, PALE[3])
        top = 15 - h
        half = cw // 2
        for dx in range(-half, half + 1):                          # cap: domed, gills dark underneath
            ux = cx + dx
            put(img, ux, top, PALE[2] if abs(dx) == half else PALE[1])
            put(img, ux, top - 1, PALE[4] if abs(dx) >= half - 1 else PALE[5])
            if abs(dx) < half:
                put(img, ux, top - 2, PALE[6] if abs(dx) < half - 1 else PALE[5])
            if abs(dx) < half - 1 and cw >= 6:
                put(img, ux, top - 3, PALE[5])
        for _ in range(2 if cw >= 6 else 1):                       # faint spots
            put(img, cx + r.randint(-half + 1, half - 1), top - 1 - r.randint(0, 1), PALE[3])
    return img


PALE_SPAN = {'base': (10.0, 8.5), 'middle': (8.0, 7.0), 'frustum': (7.0, 3.0), 'tip': (3.6, 0.0)}


def pale_dripstone(part, seed):
    """bleached hanging dripstone in the vanilla pointed-dripstone shape: wide at the ceiling, narrowing to a point"""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    r = random.Random(seed)
    w0, w1 = PALE_SPAN[part]
    rows = 12 if part == 'tip' else 16
    streak = r.randrange(5, 11) if part in ('base', 'middle') else None
    for y in range(rows):
        f = y / max(rows - 1, 1)
        w = w0 + (w1 - w0) * f
        if w < 0.6:
            break
        left = 7.5 - w / 2
        x0, x1 = int(math.floor(left + 0.5)), int(math.floor(left + w + 0.5))
        band = (y + seed) % 4 == 0                                   # growth rings
        for x in range(x0, max(x1, x0 + 1)):
            u = (x + 0.5 - left) / max(w, 1)
            i = 1 if u < 0.22 else 3 if u < 0.45 else 5 if u < 0.7 else 4 if u < 0.86 else 2
            if band:
                i -= 1
            if r.random() < 0.12:
                i += r.choice((-1, 1))
            put(img, x, y, PALE[max(0, min(6, i))])
        if streak is not None and x0 <= streak < x1 and r.random() < 0.6:
            put(img, streak, y, BLOOD[2] if r.random() < 0.7 else BLOOD[1])   # old red runs down the stone
    if part == 'tip':
        put(img, 7, 13, '#9fb3bb')                                   # a bead of water about to fall
        put(img, 8, 13, '#c7d6dc')
        put(img, 7, 14, '#b4c6cd')
    return img


def textures(out):
    os.makedirs(out, exist_ok=True)
    jobs = {
        'bloodstained_deepslate': bloodstained_side(41),
        'bloodstained_deepslate_top': bloodstained_top(42),
        'bloodstained_deepslate_bottom': bloodstained_bottom(43),
        'clawed_deepslate': clawed_side(44),
        'deepslate_top_plain': deepslate_top(45),
        'mud_plain': mud_tex(46),
        'tracked_mud_top': tracked_mud_top(46),
        'bone_coral': bone_coral(47),
        'bloodroot': bloodroot(48),
        'veined_deepslate': veined_side(49),
        'veined_deepslate_top': veined_top(50),
        'pallid_cap': pallid_cap(51),
    }
    for i, part in enumerate(PALE_PARTS):
        jobs[f'pale_dripstone_{part}'] = pale_dripstone(part, 52 + i)
    for name, img in jobs.items():
        img.save(f'{out}/{name}.png')


# =================================================================== structures (.mcstructure, little-endian NBT)
class NList(list):
    def __init__(self, tag, items):
        super().__init__(items)
        self.tag = tag


def _s(s):
    b = s.encode('utf-8')
    return struct.pack('<H', len(b)) + b


def _tag(v):
    if isinstance(v, Byte):
        return 1
    if isinstance(v, bool) or isinstance(v, int):
        return 3
    if isinstance(v, str):
        return 8
    if isinstance(v, NList):
        return 9
    if isinstance(v, dict):
        return 10
    raise TypeError(type(v))


def _payload(v):
    if isinstance(v, Byte):
        return struct.pack('<b', int(v))
    if isinstance(v, int):
        return struct.pack('<i', int(v))
    if isinstance(v, str):
        return _s(v)
    if isinstance(v, NList):
        return bytes([v.tag]) + struct.pack('<i', len(v)) + b''.join(_payload(i) for i in v)
    if isinstance(v, dict):
        return b''.join(bytes([_tag(x)]) + _s(k) + _payload(x) for k, x in v.items()) + b'\x00'
    raise TypeError(type(v))


def write_shape(shape, path):
    """a biome_shapes.Shape as a .mcstructure; -1 cells are left empty (structure void: the world keeps its block)"""
    sx, sy, sz = shape.size
    idx = [int(v) for v in shape.g.reshape(-1)]          # x outermost, z innermost (the format's ZYX order)
    palette = [{'name': n, 'states': dict(s), 'version': 18168865} for n, s in shape.pal]
    root = {
        'format_version': 1,
        'size': NList(3, [sx, sy, sz]),
        'structure': {
            'block_indices': NList(9, [NList(3, idx), NList(3, [-1] * len(idx))]),
            'entities': NList(10, []),
            'palette': {'default': {'block_palette': NList(10, palette), 'block_position_data': {}}},
        },
        'structure_world_origin': NList(3, [0, 0, 0]),
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(bytes([10]) + _s('') + _payload(root))


def column(blocks):
    s = shapes.Shape(1, len(blocks), 1)
    for y, (name, states) in enumerate(blocks):
        s.put(0, y, 0, name, states)
    return s


def thickness(n):
    """dripstone thickness from the attached end to the point"""
    if n == 1:
        return ['tip']
    if n == 2:
        return ['frustum', 'tip']
    return ['base'] + ['middle'] * (n - 3) + ['frustum', 'tip']


STALACTITES = range(2, 7)
STALAGMITES = range(1, 5)


def structures(BP):
    for n in STALACTITES:          # hanging: the base is the TOP block, the tip the bottom one
        col = [('minecraft:pointed_dripstone', {'dripstone_thickness': t, 'hanging': Byte(1)}) for t in reversed(thickness(n))]
        write_shape(column(col), f'{BP}/structures/{NS}/stalactite_{n}.mcstructure')
    for n in STALAGMITES:          # standing: base at the bottom
        col = [('minecraft:pointed_dripstone', {'dripstone_thickness': t, 'hanging': Byte(0)}) for t in thickness(n)]
        write_shape(column(col), f'{BP}/structures/{NS}/stalagmite_{n}.mcstructure')
    for name, shape in shapes.all_structures().items():
        write_shape(shape, f'{BP}/structures/{NS}/{name}.mcstructure')


# =================================================================== features & feature rules
FEATURES = {}
RULES = {}


def feat(name, kind, body, fmt=FEATURE_FORMAT):
    FEATURES[name] = {'format_version': fmt, f'minecraft:{kind}': {'description': {'identifier': f'{NS}:{name}'}, **body}}
    return f'{NS}:{name}'


def deep(name, inner, below=10):
    """only ever place underground: at least `below` blocks under the estimated surface"""
    return feat(name, 'surface_relative_threshold_feature', {'feature_to_place': inner, 'minimum_distance_below_surface': below})


def snap(name, inner, surface, rng=12, allowed=None, embed=False):
    body = {'feature_to_snap': inner, 'vertical_search_range': rng, 'surface': surface}
    if allowed:
        body['allowed_surface_blocks'] = allowed
    if embed:
        body['embed_in_surface'] = True
    return feat(name, 'snap_to_surface_feature', body, SNAP_EMBED_FORMAT if embed else FEATURE_FORMAT)


def scatter(name, inner, iterations, x=0, y=0, z=0, chance=None):
    dist = {'iterations': iterations, 'x': x, 'y': y, 'z': z}
    if chance is not None:
        dist['scatter_chance'] = chance
    return feat(name, 'scatter_feature', {'places_feature': inner, 'distribution': dist})


def weighted(name, pairs):
    return feat(name, 'weighted_random_feature', {'features': [[f, w] for f, w in pairs]})


def single(name, block, replace, survive=True):
    return feat(name, 'single_block_feature', {'places_block': block, 'enforce_placement_rules': survive,
                                               'enforce_survivability_rules': survive, 'may_replace': replace})


def patch(name, surface, ground, vegetation, chance, radius, depth, vrange=8, deep_chance=0.5, edge=0.5, waterlogged=False):
    return feat(name, 'vegetation_patch_feature', {
        'replaceable_blocks': CAVE_STONE + CAVE_SOIL, 'ground_block': ground, 'surface': surface,
        'depth': depth, 'extra_deep_block_chance': deep_chance, 'vertical_range': vrange,
        'vegetation_feature': vegetation, 'vegetation_chance': chance,
        'horizontal_radius': {'range_min': radius[0], 'range_max': radius[1]},
        'extra_edge_column_chance': edge, 'waterlogged': waterlogged})


def uni(lo, hi):
    return {'distribution': 'uniform', 'extent': [lo, hi]}


def rule(name, places, iterations, y=(-56, 72), stage='underground_pass', chance=None, xz=(0, 16)):
    """y: a (low, high) range, or one fixed world height"""
    dist = {'iterations': iterations, 'coordinate_eval_order': 'zyx', 'x': uni(*xz),
            'y': y if isinstance(y, int) else uni(*y), 'z': uni(*xz)}
    if chance:
        dist['scatter_chance'] = {'numerator': chance[0], 'denominator': chance[1]}
    RULES[name] = {
        'format_version': FEATURE_FORMAT,
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{name}', 'places_feature': places},
            'conditions': {'placement_pass': stage,
                           'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': dist,
        },
    }


def structure(name, struct=None, ground=0, centre=False, facing='random', constraints=None, radius=0):
    body = {'structure_name': f'{NS}:{struct or name}', 'facing_direction': facing, 'constraints': constraints or {}}
    if centre:
        body['rotate_around_center'] = True
    if ground:
        body['ground_level'] = ground
    if radius:
        body['adjustment_radius'] = radius
    return feat(name, 'structure_template_feature', body, STRUCTURE_FORMAT)


def ore(name, block, count, replace=None):
    return feat(name, 'ore_feature', {'count': count, 'replace_rules': [
        {'places_block': block, 'may_replace': replace or CAVE_STONE}]})


def decorations():
    air = ['minecraft:air']
    only_air = {'block_intersection': {'block_allowlist': air, 'only_check_intersection_for_motion_blocking_blocks': False}}
    # --- vanilla pointed dripstone: hanging columns are shifted down so their base meets the ceiling
    hang = []
    for n, w in zip(STALACTITES, (3, 4, 3, 2, 1)):
        s = structure(f'stalactite_{n}', facing='south', constraints=only_air)
        hang.append((scatter(f'stalactite_{n}_hang', s, 1, y=-(n - 1)), w))
    stalactite = weighted('stalactite_any', hang)
    stand = [(structure(f'stalagmite_{n}', facing='south', constraints=only_air), w) for n, w in zip(STALAGMITES, (3, 4, 2, 1))]
    stalagmite = weighted('stalagmite_any', stand)
    # --- the biome's own bleached dripstone: long pale curtains like old bone
    pale = []
    for n, w in zip(shapes.STAL_LENGTHS, (3, 4, 4, 3, 2, 2)):
        s = structure(f'pale_stalactite_{n}', facing='south', constraints=only_air)
        pale.append((scatter(f'pale_stalactite_{n}_hang', s, 1, y=-(n - 1)), w))
    pale_stalactite = weighted('pale_stalactite_any', pale)

    # --- blood: weeping vines dripping from stained ceilings
    vine = feat('blood_vine', 'growing_plant_feature', {
        'height_distribution': [[{'range_min': 1, 'range_max': 3}, 6], [{'range_min': 3, 'range_max': 7}, 3], [{'range_min': 7, 'range_max': 13}, 2]],
        'growth_direction': 'down', 'body_blocks': [['minecraft:weeping_vines', 1]], 'head_blocks': [['minecraft:weeping_vines', 1]],
        'allow_water': False})
    bloody_ceiling = patch('bloodstained_ceiling_patch', 'ceiling', f'{NS}:bloodstained_deepslate', vine, 0.16, (2, 4), 1,
                           vrange=12, deep_chance=0.35, edge=0.5)
    pale_ceiling = patch('pale_ceiling_patch', 'ceiling', 'minecraft:deepslate', pale_stalactite, 0.3, (1, 3), 1,
                         vrange=12, deep_chance=0.3, edge=0.4)
    drip_ceiling = patch('dripstone_ceiling_patch', 'ceiling', 'minecraft:dripstone_block', stalactite, 0.16, (2, 5), 2,
                         vrange=10, deep_chance=0.6, edge=0.4)
    drip_floor = patch('dripstone_floor_patch', 'floor', 'minecraft:dripstone_block', stalagmite, 0.16, (2, 4), 2,
                       vrange=8, deep_chance=0.6, edge=0.4)

    # --- floor: still black pools, gravel and mud shores with pale coral, bloodroot and pallid caps
    coral = single('bone_coral_plant', f'{NS}:bone_coral', air)
    root = single('bloodroot_plant', f'{NS}:bloodroot', air)
    cap = single('pallid_cap_plant', f'{NS}:pallid_cap', air)
    plant = weighted('shore_plant', [(coral, 4), (root, 4), (cap, 2)])
    pool = patch('still_pool', 'floor', 'minecraft:mud', root, 0.03, (3, 7), 2, vrange=6, deep_chance=0.7, edge=0.6, waterlogged=True)
    shore = patch('shore_patch', 'floor', 'minecraft:gravel', plant, 0.18, (2, 5), 1, vrange=6, deep_chance=0.5, edge=0.5)
    # --- something walks here: three-toed prints in the mud, claw marks raked into the walls
    print_block = single('tracked_mud_block', f'{NS}:tracked_mud', ['minecraft:mud', 'minecraft:gravel', 'minecraft:clay'], survive=False)
    one_print = snap('footprint', print_block, 'floor', 4, ['minecraft:mud', 'minecraft:gravel', 'minecraft:clay'], embed=True)
    mud_life = weighted('mud_life', [(plant, 2), (one_print, 3)])
    mud = patch('mud_patch', 'floor', 'minecraft:mud', mud_life, 0.12, (2, 4), 1, vrange=6, deep_chance=0.4, edge=0.5)
    trail = scatter('footprint_trail', one_print, 6, x=uni(-1, 2), y=uni(-1, 2), z=uni(-7, 8))
    claw_block = feat('clawed_block', 'single_block_feature', {
        'places_block': f'{NS}:clawed_deepslate', 'enforce_placement_rules': False, 'enforce_survivability_rules': False,
        'may_replace': ['minecraft:deepslate', 'minecraft:stone', 'minecraft:tuff', 'minecraft:smooth_basalt', 'minecraft:cobbled_deepslate'],
        # a wall block: at least one of its four sides is open air
        'may_attach_to': {'sides': ['minecraft:air'], 'min_sides_must_attach': 1, 'auto_rotate': False}})
    claw_scatter = scatter('claw_marks_near_floor', claw_block, 20, x=uni(-5, 6), y=uni(0, 4), z=uni(-5, 6))
    claws = snap('claw_marks', claw_scatter, 'floor', 12)

    # --- candles somebody left burning on the shore
    lit = lambda n, red: {'name': 'minecraft:red_candle' if red else 'minecraft:candle', 'states': {'candles': n - 1, 'lit': True}}
    candle = feat('shore_candle', 'single_block_feature', {
        'places_block': [{'block': lit(1, True), 'weight': 3}, {'block': lit(2, True), 'weight': 3}, {'block': lit(3, False), 'weight': 2},
                         {'block': lit(4, True), 'weight': 1}, {'block': lit(1, False), 'weight': 2}],
        'enforce_placement_rules': True, 'enforce_survivability_rules': True, 'may_replace': air})
    candles = snap('candle_site', scatter('candle_cluster', snap('candle_on_floor', candle, 'floor', 4), 5, x=uni(-2, 3), y=uni(0, 2),
                                          z=uni(-2, 3)), 'floor', 12)

    # --- the flooded halls: overlapping domes over deep lakes, all on one waterline (biome_shapes.py)
    pieces = []
    for kind, w in (('lake_wide', 5), ('lake_deep', 3), ('lake_pillar', 2), ('shore_dome', 3), ('shore_pillar', 2)):
        for v in range(2):
            pieces.append((structure(f'hall_{kind}_{v}', centre=True, ground=shapes.HALL_D), w))
    cluster = scatter('hall_cluster', weighted('hall_piece', pieces), 7, x=uni(-8, 9), z=uni(-8, 9))
    halls = deep('hall_cluster_deep', cluster, 30)
    # a probe that only succeeds in the lake (water may only be replaced by water), so the sequence after it
    # places pillars and ribcages where the halls are, never plugging an ordinary tunnel
    in_lake = feat('in_lake_probe', 'single_block_feature', {
        'places_block': 'minecraft:water', 'enforce_placement_rules': False, 'enforce_survivability_rules': False,
        'may_replace': ['minecraft:water']})
    pillars = weighted('pillar_any', [(structure(f'pillar_{v}', centre=True, ground=shapes.PILLAR_BELOW - 1), 1) for v in range(3)])
    lake_pillar = feat('lake_pillar', 'sequence_feature', {'features': [in_lake, pillars]})
    ribs = weighted('ribcage_any', [(structure(f'ribcage_{v}', centre=True, ground=1, radius=8,
                                               constraints={'grounded': {}, 'unburied': {}}), 1) for v in range(2)])
    lake_ribs = feat('lake_ribcage', 'sequence_feature', {'features': [in_lake, ribs]})
    # no constraints: on a stepped shore the foundation sinks into the high side and shows as a ledge on the low one
    ruin = weighted('ruin_any', [(structure(f'ruin_{n}', ground=1), w) for n, w in (('shrine', 2), ('arch', 2), ('wall', 3))])
    shore_ruin = snap('ruin_on_shore', ruin, 'floor', 6)
    fossil = feat('drowned_fossil', 'fossil_feature', {'ore_block': 'minecraft:bone_block', 'max_empty_corners': 4})

    # --- stone: glowing crimson veins, blood-stained walls, silt and clay on the lakebeds
    veined = ore('veined_vein', f'{NS}:veined_deepslate', 10, ['minecraft:deepslate', 'minecraft:tuff', 'minecraft:stone', 'minecraft:smooth_basalt'])
    stained = ore('stained_wall', f'{NS}:bloodstained_deepslate', 14, ['minecraft:deepslate', 'minecraft:stone', 'minecraft:tuff'])
    silt = weighted('lakebed_silt', [(ore('silt_mud', 'minecraft:mud', 24), 3), (ore('silt_clay', 'minecraft:clay', 16), 2),
                                     (ore('silt_gravel', 'minecraft:gravel', 20), 2)])

    ceiling_snap = lambda n, f: snap(n, f, 'ceiling', 16)
    floor_snap = lambda n, f: snap(n, f, 'floor', 12)
    pale_on_ceiling = ceiling_snap('pale_stalactite_on_ceiling', pale_stalactite)
    stalactite_on_ceiling = ceiling_snap('stalactite_on_ceiling', stalactite)
    vine_on_ceiling = ceiling_snap('blood_vine_on_ceiling', vine)
    plant_on_floor = floor_snap('plant_on_floor', plant)
    stalagmite_on_floor = snap('stalagmite_on_floor', stalagmite, 'floor', 16)

    # --- the halls: one rule per waterline, carved first so every later pass decorates them
    for i, Y in enumerate(LEVELS):
        k = f'level{i}'
        rule(f'stillwater_halls_{k}', halls, 1, y=Y, stage='first_pass', chance=(3, 5) if i == 0 else (1, 2), xz=(4, 12))
        rule(f'stillwater_pillars_{k}', lake_pillar, 2, y=Y - 1, stage='before_underground_pass', chance=(1, 2))
        rule(f'stillwater_ribcages_{k}', lake_ribs, 1, y=Y - 1, stage='before_underground_pass', chance=(1, 4))
        rule(f'stillwater_silt_{k}', silt, 6, y=(Y - 12, Y + 1), stage='before_underground_pass')
        rule(f'stillwater_veins_{k}', veined, 5, y=(Y - 12, Y + 10), stage='before_underground_pass')
        rule(f'stillwater_stains_{k}', stained, 4, y=(Y - 1, Y + 14), stage='before_underground_pass')
        rule(f'stillwater_hall_pale_ceilings_{k}', pale_ceiling, 3, y=(Y + 5, Y + 16))
        rule(f'stillwater_hall_bloody_ceilings_{k}', bloody_ceiling, 4, y=(Y + 5, Y + 16))
        rule(f'stillwater_hall_pale_stalactites_{k}', pale_on_ceiling, 9, y=(Y + 3, Y + 15))
        rule(f'stillwater_hall_stalactites_{k}', stalactite_on_ceiling, 6, y=(Y + 3, Y + 15))
        rule(f'stillwater_hall_vines_{k}', vine_on_ceiling, 14, y=(Y + 3, Y + 15))
        rule(f'stillwater_hall_shores_{k}', shore, 3, y=(Y, Y + 5))
        rule(f'stillwater_hall_plants_{k}', plant_on_floor, 26, y=(Y, Y + 6))
        rule(f'stillwater_hall_stalagmites_{k}', stalagmite_on_floor, 3, y=(Y + 1, Y + 6))
        rule(f'stillwater_hall_claws_{k}', claws, 4, y=(Y, Y + 4))
        rule(f'stillwater_hall_trails_{k}', trail, 1, y=(Y + 1, Y + 4))
        rule(f'stillwater_ruins_{k}', shore_ruin, 3, y=(Y + 1, Y + 5), stage='after_underground_pass', chance=(1, 3))
        rule(f'stillwater_candles_{k}', candles, 2, y=(Y + 1, Y + 8), stage='after_underground_pass', chance=(1, 2))
        rule(f'stillwater_fossils_{k}', fossil, 1, y=(Y - 6, Y + 6), stage='before_underground_pass', chance=(1, 5))

    # --- the rest of the biome (its ordinary winding caves) keeps the original dressing
    rule('stillwater_bloodstained_ceilings', deep('bloodstained_ceiling_deep', bloody_ceiling), 5)
    rule('stillwater_pale_ceilings', deep('pale_ceiling_deep', pale_ceiling), 3)
    rule('stillwater_dripstone_ceilings', deep('dripstone_ceiling_deep', drip_ceiling), 6)
    rule('stillwater_dripstone_floors', deep('dripstone_floor_deep', drip_floor), 3)
    rule('stillwater_stalactites', deep('stalactite_deep', stalactite_on_ceiling), 12)
    rule('stillwater_pale_stalactites', deep('pale_stalactite_deep', pale_on_ceiling), 4)
    rule('stillwater_stalagmites', deep('stalagmite_deep', stalagmite_on_floor), 10)
    rule('stillwater_blood_vines', deep('blood_vine_deep', vine_on_ceiling), 6)
    rule('stillwater_pools', deep('still_pool_deep', pool), 8)
    rule('stillwater_shores', deep('shore_deep', shore), 5)
    rule('stillwater_mud', deep('mud_deep', mud), 4)
    rule('stillwater_plants', deep('plant_deep', plant_on_floor), 24)
    rule('stillwater_footprints', deep('footprint_deep', trail), 2)
    rule('stillwater_claw_marks', deep('claw_marks_deep', claws), 10)
    rule('stillwater_veins', veined, 3, stage='before_underground_pass')


def feature_files(BP):
    FEATURES.clear()
    RULES.clear()
    decorations()
    for name, body in FEATURES.items():
        write(f'{BP}/features/{name}.json', body)
    for name, body in RULES.items():
        write(f'{BP}/feature_rules/{name}.json', body)


# =================================================================== ambient sound: far-off splashes and drips
SR = 44100


def _load_wav(path):
    with wave.open(path) as w:
        sr, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
        a = np.frombuffer(w.readframes(n), dtype={1: np.int8, 2: np.int16, 4: np.int32}[sw]).astype(np.float64)
    a /= float(2 ** (8 * sw - 1))
    if ch > 1:
        a = a.reshape(-1, ch).mean(1)
    t = np.arange(int(len(a) * SR / sr)) * sr / SR
    return np.interp(t, np.arange(len(a)), a)


def _lowpass(x, cutoff):
    a = math.exp(-2 * math.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def _cave_reverb(x, seconds=2.6, seed=1):
    """convolve with a decaying noise tail: a big wet stone hall"""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-t / (seconds / 5.5))
    ir = _lowpass(ir, 2400.0)
    ir[0] = 0.0
    for d, g in ((0.043, 0.5), (0.091, 0.35), (0.167, 0.25)):      # a few discrete wall echoes
        ir[int(d * SR)] += g * 40
    wet = np.convolve(x, ir)[: len(x) + n]
    wet /= np.max(np.abs(wet)) or 1.0
    dry = np.concatenate([x, np.zeros(len(wet) - len(x))])
    return 0.25 * dry + 0.75 * wet


def ambient_sounds(RP, audio=AUDIO):
    out = f'{RP}/sounds/ambient/{NS}'
    os.makedirs(out, exist_ok=True)
    clips = {}
    splash_path = os.path.join(audio, 'splash.wav')
    rng = np.random.default_rng(9)
    if not os.path.exists(splash_path):
        raise FileNotFoundError(f'{splash_path} is needed for the ambient splashes (the repository assets/audio folder)')
    s = _load_wav(splash_path)
    for i, (pitch, cutoff) in enumerate(((0.78, 900.0), (0.92, 1300.0))):
        v = np.interp(np.arange(0, len(s) - 1, pitch), np.arange(len(s)), s)
        clips[f'stillwater_splash{i + 1}'] = _cave_reverb(_lowpass(v, cutoff), 2.8, seed=i + 1)
    for i, f0 in enumerate((1500.0, 1150.0)):          # single drops falling into still water
        n = int(0.09 * SR)
        t = np.arange(n) / SR
        f = f0 * np.exp(-t / 0.03) + 420
        drop = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.025)
        drop += 0.15 * rng.normal(0, 1, n) * np.exp(-t / 0.004)
        clips[f'stillwater_drip{i + 1}'] = _cave_reverb(drop, 2.2, seed=10 + i)
    names = []
    for name, x in clips.items():
        x = x / (np.max(np.abs(x)) or 1.0) * 0.8
        fade = np.minimum(1.0, (len(x) - np.arange(len(x))) / (0.4 * SR))
        pcm = (x * fade * 32767).astype(np.int16)
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = os.path.join(tmp, 'a.wav')
            with wave.open(wav_path, 'w') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav_path, '-c:a', 'libvorbis', '-q:a', '4',
                            f'{out}/{name}.ogg'], check=True)
        names.append(name)
    write(f'{RP}/sounds/sound_definitions.json', {
        'format_version': '1.20.20',
        'sound_definitions': {AMBIENT: {'category': 'ambient', 'sounds': [
            {'name': f'sounds/ambient/{NS}/{n}', 'volume': 0.55 if 'splash' in n else 0.4, 'load_on_low_memory': True} for n in names]}},
    })
    write(f'{RP}/sounds.json', {
        'individual_named_sounds': {'sounds': {AMBIENT: {'sound': AMBIENT, 'volume': 0.8, 'pitch': [0.85, 1.05]}}},
    })


# =================================================================== entry point
def lang_lines():
    return ''.join(f'tile.{NS}:{k}.name={v}\n' for k, v in BLOCK_NAMES.items())


def build(RP, BP, sounds=True, audio=AUDIO):
    biome_files(RP, BP)
    block_files(RP, BP)
    structures(BP)
    feature_files(BP)
    if sounds:
        ambient_sounds(RP, audio)


if __name__ == '__main__':
    root = sys.argv[1]
    build(os.path.join(root, 'resource_pack'), os.path.join(root, 'behavior_pack'))
    print('stillwater caves written to', root, '-', len(FEATURES), 'features,', len(RULES), 'feature rules')
