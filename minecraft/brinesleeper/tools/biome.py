"""Stillwater Caves: the Brinesleeper's home biome (Bedrock custom biome, 1.26.30+).

Writes into the resource and behavior packs:
  BP biomes/          brine:stillwater_caves, which takes over part of the vanilla dripstone caves
  BP blocks/          five vanilla-style blocks (bloodstained/clawed deepslate, tracked mud, bone coral, bloodroot)
  BP features/        cave decorations: blood-stained ceilings with weeping vines, pointed dripstone,
  BP feature_rules/   flooded pools, shores, footprint trails, claw-marked walls
  BP structures/      tiny pointed-dripstone columns with correct tip/frustum/middle/base states
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

NS = 'brine'
BIOME = f'{NS}:stillwater_caves'
TAG = 'stillwater_caves'
FOG = f'{NS}:fog_stillwater_caves'
AMBIENT = 'ambient.brine.stillwater.additions'
BIOME_FORMAT = '1.26.30'          # minecraft:subsurface_builder + noise_gradient
FEATURE_FORMAT = '1.21.60'
SNAP_EMBED_FORMAT = '1.26.20'     # snap_to_surface "embed_in_surface"
BLOCK_FORMAT = '1.26.30'
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
                # takes over part of the vanilla dripstone caves (append new rules at the END only)
                'minecraft:replace_biomes': {'replacements': [{
                    'dimension': 'minecraft:overworld', 'targets': ['dripstone_caves'],
                    'amount': 0.55, 'noise_frequency_scale': 10}]},
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
                'minecraft:water_appearance': {'surface_color': '#1b2a30', 'surface_opacity': 0.9},
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
                # the Stillwater Curse: the music fades to nothing down here
                'minecraft:biome_music': {'music_definition': '', 'volume_multiplier': 0.0},
            },
        },
    })
    write(f'{RP}/fogs/stillwater_caves_fog_setting.json', {
        'format_version': '1.21.90',
        'minecraft:fog_settings': {
            'description': {'identifier': FOG},
            'distance': {
                'air': {'fog_start': 6.0, 'fog_end': 64.0, 'fog_color': '#0c1216', 'render_distance_type': 'fixed'},
                'weather': {'fog_start': 6.0, 'fog_end': 64.0, 'fog_color': '#0c1216', 'render_distance_type': 'fixed'},
                'water': {
                    'fog_start': 0.0, 'fog_end': 18.0, 'fog_color': '#08151a', 'render_distance_type': 'fixed',
                    'transition_fog': {
                        'init_fog': {'fog_start': 0.0, 'fog_end': 0.01, 'fog_color': '#08151a', 'render_distance_type': 'fixed'},
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
def full_block(name, seconds, resist, map_color, faces):
    return {
        'format_version': BLOCK_FORMAT,
        'minecraft:block': {
            'description': {'identifier': f'{NS}:{name}', 'menu_category': {'category': 'nature'}},
            'components': {
                'minecraft:geometry': 'minecraft:geometry.full_block',
                'minecraft:material_instances': faces,
                'minecraft:destructible_by_mining': {'seconds_to_destroy': seconds},
                'minecraft:destructible_by_explosion': {'explosion_resistance': resist},
                'minecraft:map_color': map_color,
            },
        },
    }


def plant_block(name, map_color, height):
    soil = ['minecraft:mud', 'minecraft:gravel', 'minecraft:clay', 'minecraft:dirt', 'minecraft:coarse_dirt', 'minecraft:stone',
            'minecraft:deepslate', 'minecraft:tuff', 'minecraft:smooth_basalt', 'minecraft:cobbled_deepslate', 'minecraft:dripstone_block',
            f'{NS}:tracked_mud', f'{NS}:bloodstained_deepslate', f'{NS}:clawed_deepslate']
    return {
        'format_version': BLOCK_FORMAT,
        'minecraft:block': {
            'description': {'identifier': f'{NS}:{name}', 'menu_category': {'category': 'nature', 'group': 'minecraft:itemGroup.name.grass'}},
            'components': {
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
    write(f'{BP}/blocks/tracked_mud.json', full_block(
        'tracked_mud', 0.5, 0.5, '#3a383d',
        {'*': {'texture': tex('mud_plain'), 'render_method': 'opaque'},
         'up': {'texture': tex('tracked_mud_top'), 'render_method': 'opaque'}}))
    write(f'{BP}/blocks/bone_coral.json', plant_block('bone_coral', '#dedac5', 12))
    write(f'{BP}/blocks/bloodroot.json', plant_block('bloodroot', '#7b0000', 14))

    names = ['bloodstained_deepslate', 'bloodstained_deepslate_top', 'bloodstained_deepslate_bottom', 'clawed_deepslate',
             'deepslate_top_plain', 'mud_plain', 'tracked_mud_top', 'bone_coral', 'bloodroot']
    write(f'{RP}/textures/terrain_texture.json', {
        'resource_pack_name': 'brinesleeper', 'texture_name': 'atlas.terrain', 'padding': 8, 'num_mip_levels': 4,
        'texture_data': {tex(n): {'textures': f'textures/blocks/{NS}/{n}'} for n in names},
    })
    write(f'{RP}/blocks.json', {
        'format_version': '1.19.30',
        f'{NS}:bloodstained_deepslate': {'sound': 'deepslate'},
        f'{NS}:clawed_deepslate': {'sound': 'deepslate'},
        f'{NS}:tracked_mud': {'sound': 'mud'},
        f'{NS}:bone_coral': {'sound': 'coral'},
        f'{NS}:bloodroot': {'sound': 'roots'},
    })
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
    }
    for name, img in jobs.items():
        img.save(f'{out}/{name}.png')


# =================================================================== pointed dripstone structures (.mcstructure, little-endian NBT)
class Byte(int):
    pass


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


def mcstructure(column, path):
    """column: list of (block name, states) from bottom (y = 0) to top; a 1 x n x 1 structure"""
    palette, idx = [], []
    for name, states in column:
        key = (name, tuple(sorted(states.items())))
        keys = [(p['name'], tuple(sorted(p['states'].items()))) for p in palette]
        if key not in keys:
            palette.append({'name': name, 'states': states, 'version': 18168865})
            keys.append(key)
        idx.append(keys.index(key))
    root = {
        'format_version': 1,
        'size': NList(3, [1, len(column), 1]),
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
        mcstructure(col, f'{BP}/structures/{NS}/stalactite_{n}.mcstructure')
    for n in STALAGMITES:          # standing: base at the bottom
        col = [('minecraft:pointed_dripstone', {'dripstone_thickness': t, 'hanging': Byte(0)}) for t in thickness(n)]
        mcstructure(col, f'{BP}/structures/{NS}/stalagmite_{n}.mcstructure')


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


def rule(name, places, iterations, y=(-56, 72)):
    RULES[name] = {
        'format_version': FEATURE_FORMAT,
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{name}', 'places_feature': places},
            'conditions': {'placement_pass': 'underground_pass',
                           'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': {'iterations': iterations, 'coordinate_eval_order': 'zyx',
                             'x': {'distribution': 'uniform', 'extent': [0, 15]},
                             'y': {'distribution': 'uniform', 'extent': list(y)},
                             'z': {'distribution': 'uniform', 'extent': [0, 15]}},
        },
    }


def decorations():
    air = ['minecraft:air']
    # --- pointed dripstone: hanging columns are shifted down so their base meets the ceiling
    hang = []
    for n, w in zip(STALACTITES, (3, 4, 3, 2, 1)):
        s = feat(f'stalactite_{n}', 'structure_template_feature', {
            'structure_name': f'{NS}:stalactite_{n}', 'facing_direction': 'south',
            'constraints': {'block_intersection': {'block_allowlist': air}}})
        hang.append((scatter(f'stalactite_{n}_hang', s, 1, y=-(n - 1)), w))
    stalactite = weighted('stalactite_any', hang)
    stand = []
    for n, w in zip(STALAGMITES, (3, 4, 2, 1)):
        stand.append((feat(f'stalagmite_{n}', 'structure_template_feature', {
            'structure_name': f'{NS}:stalagmite_{n}', 'facing_direction': 'south',
            'constraints': {'block_intersection': {'block_allowlist': air}}}), w))
    stalagmite = weighted('stalagmite_any', stand)

    # --- blood: weeping vines dripping from stained ceilings
    vine = feat('blood_vine', 'growing_plant_feature', {
        'height_distribution': [[{'range_min': 1, 'range_max': 3}, 6], [{'range_min': 3, 'range_max': 7}, 3], [{'range_min': 7, 'range_max': 11}, 1]],
        'growth_direction': 'DOWN', 'body_blocks': [['minecraft:weeping_vines', 1]], 'head_blocks': [['minecraft:weeping_vines', 1]],
        'allow_water': False})
    bloody_ceiling = patch('bloodstained_ceiling_patch', 'ceiling', f'{NS}:bloodstained_deepslate', vine, 0.12, (2, 4), 1,
                           vrange=10, deep_chance=0.35, edge=0.5)
    drip_ceiling = patch('dripstone_ceiling_patch', 'ceiling', 'minecraft:dripstone_block', stalactite, 0.16, (2, 5), 2,
                         vrange=10, deep_chance=0.6, edge=0.4)
    drip_floor = patch('dripstone_floor_patch', 'floor', 'minecraft:dripstone_block', stalagmite, 0.16, (2, 4), 2,
                       vrange=8, deep_chance=0.6, edge=0.4)

    # --- floor: still black pools, gravel and mud shores with pale coral and bloodroot
    coral = single('bone_coral_plant', f'{NS}:bone_coral', air)
    root = single('bloodroot_plant', f'{NS}:bloodroot', air)
    plant = weighted('shore_plant', [(coral, 3), (root, 4)])
    pool = patch('still_pool', 'floor', 'minecraft:mud', root, 0.03, (3, 7), 2, vrange=6, deep_chance=0.7, edge=0.6, waterlogged=True)
    shore = patch('shore_patch', 'floor', 'minecraft:gravel', plant, 0.14, (2, 5), 1, vrange=6, deep_chance=0.5, edge=0.5)
    # --- something walks here: three-toed prints in the mud, claw marks raked into the walls
    print_block = single('tracked_mud_block', f'{NS}:tracked_mud', ['minecraft:mud', 'minecraft:gravel', 'minecraft:clay'], survive=False)
    one_print = snap('footprint', print_block, 'floor', 4, ['minecraft:mud', 'minecraft:gravel', 'minecraft:clay'], embed=True)
    mud_life = weighted('mud_life', [(plant, 2), (one_print, 3)])
    mud = patch('mud_patch', 'floor', 'minecraft:mud', mud_life, 0.12, (2, 4), 1, vrange=6, deep_chance=0.4, edge=0.5)
    trail = scatter('footprint_trail', one_print, 6, x={'distribution': 'uniform', 'extent': [-1, 1]},
                    y={'distribution': 'uniform', 'extent': [-1, 1]}, z={'distribution': 'uniform', 'extent': [-7, 7]})
    claw_block = single('clawed_block', f'{NS}:clawed_deepslate',
                        ['minecraft:deepslate', 'minecraft:stone', 'minecraft:tuff', 'minecraft:smooth_basalt', 'minecraft:cobbled_deepslate'],
                        survive=False)
    claw_wall = snap('claw_mark', claw_block, 'random_horizontal', 10, embed=True)
    claws = scatter('claw_marks', claw_wall, 3, x={'distribution': 'uniform', 'extent': [-1, 1]},
                    y={'distribution': 'uniform', 'extent': [-1, 2]}, z={'distribution': 'uniform', 'extent': [-1, 1]})

    # --- rules: each places its feature only underground in Stillwater Caves
    rule('stillwater_bloodstained_ceilings', deep('bloodstained_ceiling_deep', bloody_ceiling), 5)
    rule('stillwater_dripstone_ceilings', deep('dripstone_ceiling_deep', drip_ceiling), 7)
    rule('stillwater_dripstone_floors', deep('dripstone_floor_deep', drip_floor), 3)
    rule('stillwater_stalactites', deep('stalactite_deep', snap('stalactite_on_ceiling', stalactite, 'ceiling', 16)), 16)
    rule('stillwater_stalagmites', deep('stalagmite_deep', snap('stalagmite_on_floor', stalagmite, 'floor', 16)), 10)
    rule('stillwater_blood_vines', deep('blood_vine_deep', snap('blood_vine_on_ceiling', vine, 'ceiling', 16)), 6)
    rule('stillwater_pools', deep('still_pool_deep', pool), 8)
    rule('stillwater_shores', deep('shore_deep', shore), 5)
    rule('stillwater_mud', deep('mud_deep', mud), 4)
    rule('stillwater_plants', deep('plant_deep', snap('plant_on_floor', plant, 'floor', 12)), 24)
    rule('stillwater_footprints', deep('footprint_deep', trail), 2)
    rule('stillwater_claw_marks', deep('claw_marks_deep', claws), 6)


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
