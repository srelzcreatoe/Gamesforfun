#!/usr/bin/env python3
"""Generates the synthetic custom-block test pack used by the world renderer tests.

Writes tools/render/test/fixtures/{BP,RP}: blocks, geometries, textures (+ MER, heightmaps,
texture sets), terrain_texture.json, flipbook_textures.json and local_lighting.json.
Namespace `fnartest:` so it never collides with the real add-on blocks.
Run:  python3 tools/render/test/fixtures/make_fixtures.py
"""
import json
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BP = os.path.join(HERE, 'BP')
RP = os.path.join(HERE, 'RP')
TEX = os.path.join(RP, 'textures/blocks/fnartest')

FONT = {  # 3x5 pixel font
    'N': ['101', '111', '111', '111', '101'], 'S': ['111', '100', '111', '001', '111'], 'E': ['111', '100', '111', '100', '111'],
    'W': ['101', '101', '111', '111', '101'], 'U': ['101', '101', '101', '101', '111'], 'D': ['110', '101', '101', '101', '110'],
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'], 'F': ['111', '100', '110', '100', '100'], 'X': ['101', '101', '010', '101', '101'],
}


def save(img, name):
    os.makedirs(TEX, exist_ok=True)
    img.save(os.path.join(TEX, name + '.png'))


def glyph(img, ch, x0, y0, col, scale=2):
    for y, row in enumerate(FONT[ch]):
        for x, c in enumerate(row):
            if c == '1':
                for dy in range(scale):
                    for dx in range(scale):
                        img.putpixel((x0 + x * scale + dx, y0 + y * scale + dy), col)


def tile(bg, ch, fg=(255, 255, 255, 255)):
    """16x16 orientation tile: letter at the top, an up-arrow at the bottom-left, a dot top-left."""
    im = Image.new('RGBA', (16, 16), bg)
    for i in range(16):
        im.putpixel((i, 0), tuple(max(0, c - 60) for c in bg[:3]) + (255,))
        im.putpixel((i, 15), tuple(max(0, c - 60) for c in bg[:3]) + (255,))
        im.putpixel((0, i), tuple(max(0, c - 60) for c in bg[:3]) + (255,))
        im.putpixel((15, i), tuple(max(0, c - 60) for c in bg[:3]) + (255,))
    glyph(im, ch, 5, 2, fg)
    # up arrow bottom-left (shows 'up' direction of the texture)
    for k, row in enumerate(['010', '111', '010', '010']):
        for x, c in enumerate(row):
            if c == '1':
                im.putpixel((2 + x, 10 + k), (20, 20, 20, 255))
    im.putpixel((1, 1), (255, 255, 0, 255))  # top-left marker
    return im


def flat(w, h, col):
    return Image.new('RGBA', (w, h), col)


def texture_set(name, mer=True, height=False, color=None):
    d = {'color': color or name}
    if mer:
        d['metalness_emissive_roughness'] = name + '_mer'
    if height:
        d['heightmap'] = name + '_height'
    with open(os.path.join(TEX, name + '.texture_set.json'), 'w') as f:
        json.dump({'format_version': '1.21.30', 'minecraft:texture_set': d}, f, indent=2)


def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2)


FACE_COL = {'N': (40, 70, 200, 255), 'S': (200, 50, 50, 255), 'E': (40, 160, 60, 255), 'W': (200, 160, 30, 255), 'U': (230, 230, 230, 255), 'D': (90, 40, 140, 255)}
FACE_FG = {'U': (0, 0, 0, 255)}
terrain = {}


def reg(short, rel):
    terrain[short] = {'textures': 'textures/blocks/fnartest/' + rel}


# ---- orientation tiles (full_block per-face instances)
for ch in 'NSEWUD':
    nm = 'orient_' + ch.lower()
    save(tile(FACE_COL[ch], ch, FACE_FG.get(ch, (255, 255, 255, 255))), nm)
    reg('fnartest_' + nm, nm)

# ---- orientation atlas 64x32 for custom geometry: row0 N E S W, row1 U D F X
atlas = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
for i, ch in enumerate('NESW'):
    atlas.paste(tile(FACE_COL[ch], ch, FACE_FG.get(ch, (255, 255, 255, 255))), (i * 16, 0))
for i, ch in enumerate('UD'):
    atlas.paste(tile(FACE_COL[ch], ch, FACE_FG.get(ch, (255, 255, 255, 255))), (i * 16, 16))
atlas.paste(tile((120, 120, 120, 255), 'F'), (32, 16))
atlas.paste(tile((60, 60, 60, 255), 'X'), (48, 16))
save(atlas, 'orient_atlas')
reg('fnartest_orient_atlas', 'orient_atlas')

# ---- glossy checker tile with heightmap grout (MER + height)
im = Image.new('RGBA', (16, 16))
mer = Image.new('RGBA', (16, 16))
hm = Image.new('RGBA', (16, 16))
for y in range(16):
    for x in range(16):
        grout = x % 8 == 0 or y % 8 == 0
        dark = ((x // 8) + (y // 8)) % 2 == 1
        if grout:
            c = (90, 86, 80)
        elif dark:
            c = (28, 28, 32) if (x * 7 + y * 3) % 11 else (40, 40, 44)
        else:
            c = (208, 204, 194) if (x * 5 + y * 7) % 13 else (190, 186, 176)
        im.putpixel((x, y), c + (255,))
        mer.putpixel((x, y), (0, 0, 200 if grout else 60, 255))
        hm.putpixel((x, y), (60, 60, 60, 255) if grout else (200, 200, 200, 255))
save(im, 'tile'); save(mer, 'tile_mer'); save(hm, 'tile_height'); texture_set('tile', height=True)
reg('fnartest_tile', 'tile')

# ---- metal (high metalness)
im = Image.new('RGBA', (16, 16)); mer = Image.new('RGBA', (16, 16)); hm = Image.new('RGBA', (16, 16))
for y in range(16):
    for x in range(16):
        rib = y % 4 == 0
        rivet = (x in (2, 13)) and (y % 4 == 2)
        v = 150 + ((x * 13 + y * 7) % 5) * 6 - (40 if rib else 0) + (40 if rivet else 0)
        im.putpixel((x, y), (v, v + 4, v + 10, 255))
        mer.putpixel((x, y), (230, 0, 110 if not rib else 170, 255))
        hm.putpixel((x, y), ((40 if rib else 150) + (100 if rivet else 0),) * 3 + (255,))
save(im, 'metal'); save(mer, 'metal_mer'); save(hm, 'metal_height'); texture_set('metal', height=True)
reg('fnartest_metal', 'metal')

# ---- lamp: frame + glowing diffuser; and the dead version
for lit in (True, False):
    nm = 'lamp_on' if lit else 'lamp_off'
    im = Image.new('RGBA', (16, 16)); mer = Image.new('RGBA', (16, 16))
    for y in range(16):
        for x in range(16):
            edge = x < 2 or x > 13 or y < 2 or y > 13
            tube = (y in (5, 6, 9, 10)) and 2 < x < 13
            if edge:
                c, m = (110, 112, 118), (200, 0, 120)
            elif lit:
                c, m = ((240, 246, 255) if tube else (196, 206, 222)), (0, 255 if tube else 170, 40)
            else:
                c, m = ((120, 124, 130) if tube else (92, 96, 104)), (0, 0, 90)
            im.putpixel((x, y), c + (255,)); mer.putpixel((x, y), m + (255,))
    save(im, nm); save(mer, nm + '_mer'); texture_set(nm)
    reg('fnartest_' + nm, nm)

# ---- grate (alpha test)
im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
for y in range(16):
    for x in range(16):
        if x in (0, 15) or y in (0, 15) or (y % 3 == 1):
            v = 70 + (x * 3 % 7) * 5
            im.putpixel((x, y), (v, v, v + 6, 255))
save(im, 'grate'); reg('fnartest_grate', 'grate')

# ---- translucent glass (blend)
im = Image.new('RGBA', (16, 16))
for y in range(16):
    for x in range(16):
        frame = x in (0, 15) or y in (0, 15)
        im.putpixel((x, y), (60, 70, 80, 255) if frame else (120, 170, 220, 90 + ((x + y) % 4) * 6))
save(im, 'glass'); reg('fnartest_glass', 'glass')

# ---- flipbook (4 frames, 16x64): only frame 0 (green "0") must be visible; emissive
im = Image.new('RGBA', (16, 64), (10, 10, 10, 255)); mer = Image.new('RGBA', (16, 64), (0, 0, 255, 255))
for f in range(4):
    col = (60, 255, 110, 255) if f == 0 else (255, 40, 40, 255)
    glyph(im, str(f), 5, f * 16 + 3, col)
    for y in range(16):
        for x in range(16):
            if im.getpixel((x, f * 16 + y))[1] > 100 or im.getpixel((x, f * 16 + y))[0] > 100:
                mer.putpixel((x, f * 16 + y), (0, 255, 80, 255))
save(im, 'flip'); save(mer, 'flip_mer'); texture_set('flip')
reg('fnartest_flip', 'flip')

# ---- poster tiles 0..3 (2x2 picture), top-left = 0; big white digit on a coloured tile
POSTER_BG = [(150, 40, 40, 255), (40, 120, 50, 255), (40, 60, 150, 255), (150, 120, 30, 255)]
for t in range(4):
    im = Image.new('RGBA', (16, 16), POSTER_BG[t])
    glyph(im, str(t), 4, 0, (250, 250, 250, 255), 3)
    for i in range(16):
        im.putpixel((i, 15), (20, 20, 20, 255))
    save(im, 'poster_%d' % t); reg('fnartest_poster_%d' % t, 'poster_%d' % t)

wjson(os.path.join(RP, 'textures/terrain_texture.json'), {'resource_pack_name': 'fnartest', 'texture_name': 'atlas.terrain', 'padding': 8, 'num_mip_levels': 4, 'texture_data': terrain})
wjson(os.path.join(RP, 'textures/flipbook_textures.json'), [{'flipbook_texture': 'textures/blocks/fnartest/flip', 'atlas_tile': 'fnartest_flip', 'ticks_per_frame': 4}])
wjson(os.path.join(RP, 'local_lighting/local_lighting.json'), {'format_version': '1.21.120', 'minecraft:local_light_settings': {
    'fnartest:lamp': {'light_color': '#dfe8ff', 'light_type': 'point'},
    'fnartest:flip_sign': {'light_color': '#3cff6e', 'light_type': 'static'},
}})

# ---------------------------------------------------------------- geometries (Blockbench export style)
def face(u, v, w, h, inst=None):
    d = {'uv': [u, v], 'uv_size': [w, h]}
    if inst:
        d['material_instance'] = inst
    return d


def geo(ident, tw, th, bones):
    return {'format_version': '1.12.0', 'minecraft:geometry': [{'description': {'identifier': ident, 'texture_width': tw, 'texture_height': th,
            'visible_bounds_width': 2, 'visible_bounds_height': 2.5, 'visible_bounds_offset': [0, 0.75, 0]}, 'bones': bones}]}


# orientation cube: atlas tiles per face (up/down negative sizes like Blockbench exports),
# plus a marker cube on the north-west top edge (file +X == world west).
orient_uv = {'north': face(0, 0, 16, 16), 'east': face(16, 0, 16, 16), 'south': face(32, 0, 16, 16), 'west': face(48, 0, 16, 16),
             'up': face(16, 32, -16, -16), 'down': face(32, 32, -16, -16)}
wjson(os.path.join(RP, 'models/blocks/orient.geo.json'), geo('geometry.fnartest.orient', 64, 32, [
    {'name': 'body', 'pivot': [0, 0, 0], 'cubes': [{'origin': [-6, 0, -6], 'size': [12, 12, 12], 'uv': {
        'north': face(2, 2, 12, 12), 'east': face(18, 2, 12, 12), 'south': face(34, 2, 12, 12), 'west': face(50, 2, 12, 12),
        'up': face(14, 30, -12, -12), 'down': face(30, 30, -12, -12)}}]},
    {'name': 'marker', 'parent': 'body', 'pivot': [0, 0, 0], 'cubes': [{'origin': [2, 12, -6], 'size': [4, 4, 4], 'uv': {
        'north': face(32, 16, 4, 4), 'east': face(32, 16, 4, 4), 'south': face(32, 16, 4, 4), 'west': face(32, 16, 4, 4), 'up': face(36, 20, -4, -4), 'down': face(36, 20, -4, -4)}}]},
]))
# ceiling lamp: frame flush with the ceiling + diffuser (material instance "glow") + bulb bone
wjson(os.path.join(RP, 'models/blocks/lamp.geo.json'), geo('geometry.fnartest.lamp', 16, 16, [
    {'name': 'frame', 'pivot': [0, 16, 0], 'cubes': [{'origin': [-7, 14, -7], 'size': [14, 2, 14], 'uv': {
        'north': face(0, 0, 14, 2), 'east': face(0, 0, 14, 2), 'south': face(0, 0, 14, 2), 'west': face(0, 0, 14, 2), 'up': face(15, 15, -14, -14), 'down': face(15, 15, -14, -14, 'glow')}}]},
    {'name': 'bulb', 'parent': 'frame', 'pivot': [0, 14, 0], 'cubes': [{'origin': [-1, 12, -1], 'size': [2, 2, 2], 'uv': {
        'north': face(6, 6, 2, 2, 'glow'), 'east': face(6, 6, 2, 2, 'glow'), 'south': face(6, 6, 2, 2, 'glow'), 'west': face(6, 6, 2, 2, 'glow'), 'down': face(8, 8, -2, -2, 'glow')}}]},
]))
# wall panel (back on the south side of the cell, facing north)
wjson(os.path.join(RP, 'models/blocks/panel.geo.json'), geo('geometry.fnartest.panel', 16, 16, [
    {'name': 'panel', 'pivot': [0, 0, 0], 'cubes': [{'origin': [-8, 0, 7], 'size': [16, 16, 1], 'uv': {
        'north': face(0, 0, 16, 16), 'east': face(0, 0, 1, 16), 'west': face(15, 0, 1, 16), 'up': face(16, 1, -16, -1), 'down': face(16, 16, -16, -1)}}]},
]))
# ceiling vent grate (alpha test) and a translucent glass pane (blend), a flipbook sign
wjson(os.path.join(RP, 'models/blocks/grate.geo.json'), geo('geometry.fnartest.grate', 16, 16, [
    {'name': 'g', 'pivot': [0, 0, 0], 'cubes': [{'origin': [-8, 15, -8], 'size': [16, 1, 16], 'uv': {
        'north': face(0, 0, 16, 1), 'east': face(0, 0, 16, 1), 'south': face(0, 0, 16, 1), 'west': face(0, 0, 16, 1), 'up': face(16, 16, -16, -16), 'down': face(16, 16, -16, -16)}}]},
]))
wjson(os.path.join(RP, 'models/blocks/glass_panel.geo.json'), geo('geometry.fnartest.glass_panel', 16, 16, [
    {'name': 'g', 'pivot': [0, 0, 0], 'cubes': [{'origin': [-8, 0, -1], 'size': [16, 16, 2], 'uv': {
        'north': face(0, 0, 16, 16), 'south': face(0, 0, 16, 16), 'east': face(0, 0, 2, 16), 'west': face(0, 0, 2, 16), 'up': face(16, 2, -16, -2), 'down': face(16, 2, -16, -2)}}]},
]))
wjson(os.path.join(RP, 'models/blocks/flip_sign.geo.json'), geo('geometry.fnartest.flip_sign', 16, 16, [
    {'name': 's', 'pivot': [0, 0, 0], 'cubes': [{'origin': [-5, 10, 6], 'size': [10, 5, 2], 'uv': {
        'north': face(3, 3, 10, 10), 'south': face(3, 3, 10, 10), 'east': face(0, 0, 2, 5), 'west': face(0, 0, 2, 5), 'up': face(10, 2, -10, -2), 'down': face(10, 2, -10, -2)}}]},
]))

# ---------------------------------------------------------------- blocks
def block(ident, components, states=None, traits=None, permutations=None):
    desc = {'identifier': ident, 'menu_category': {'category': 'construction'}}
    if states:
        desc['states'] = states
    if traits:
        desc['traits'] = traits
    b = {'description': desc, 'components': components}
    if permutations:
        b['permutations'] = permutations
    return {'format_version': '1.26.50', 'minecraft:block': b}


CARD = {'enabled_states': ['minecraft:cardinal_direction'], 'y_rotation_offset': 180}
ROT = [{'condition': "q.block_state('minecraft:cardinal_direction') == '%s'" % d, 'components': {'minecraft:transformation': {'rotation': r}}}
       for d, r in (('north', [0, 0, 0]), ('west', [0, 90, 0]), ('south', [0, 180, 0]), ('east', [0, -90, 0]))]
blocks = {
    'orient_cube': block('fnartest:orient_cube', {
        'minecraft:geometry': 'minecraft:geometry.full_block',
        'minecraft:material_instances': {**{f: {'texture': 'fnartest_orient_' + f[0], 'render_method': 'opaque'} for f in ('north', 'south', 'east', 'west', 'up', 'down')}, '*': {'texture': 'fnartest_orient_n'}},
    }, traits={'minecraft:placement_direction': CARD}, permutations=ROT),
    'orient_geo': block('fnartest:orient_geo', {
        'minecraft:geometry': 'geometry.fnartest.orient',
        'minecraft:material_instances': {'*': {'texture': 'fnartest_orient_atlas', 'render_method': 'alpha_test'}},
        'minecraft:light_dampening': 0,
    }, traits={'minecraft:placement_direction': CARD}, permutations=ROT),
    'tile': block('fnartest:tile', {'minecraft:material_instances': {'*': {'texture': 'fnartest_tile', 'render_method': 'opaque'}}}),
    'metal': block('fnartest:metal', {'minecraft:geometry': 'minecraft:geometry.full_block', 'minecraft:material_instances': {'*': {'texture': 'fnartest_metal', 'render_method': 'opaque'}}}),
    'lamp': block('fnartest:lamp', {
        'minecraft:geometry': {'identifier': 'geometry.fnartest.lamp', 'bone_visibility': {'bulb': "q.block_state('fnartest:lit')"}},
        'minecraft:material_instances': {'*': {'texture': 'fnartest_metal', 'render_method': 'opaque'}, 'glow': {'texture': 'fnartest_lamp_off', 'render_method': 'opaque', 'face_dimming': False}},
        'minecraft:light_dampening': 0,
    }, states={'fnartest:lit': [False, True]}, permutations=[
        {'condition': "query.block_state('fnartest:lit') == true", 'components': {
            'minecraft:light_emission': 13,
            'minecraft:material_instances': {'*': {'texture': 'fnartest_metal', 'render_method': 'opaque'}, 'glow': {'texture': 'fnartest_lamp_on', 'render_method': 'opaque', 'face_dimming': False, 'ambient_occlusion': False}}}},
    ]),
    'panel': block('fnartest:panel', {
        'minecraft:geometry': 'geometry.fnartest.panel',
        'minecraft:material_instances': {'*': {'texture': 'fnartest_poster_0', 'render_method': 'alpha_test'}},
        'minecraft:light_dampening': 0,
    }, states={'fnartest:tile': {'values': {'min': 0, 'max': 3}}}, traits={'minecraft:placement_direction': CARD},
        permutations=ROT + [{'condition': "q.block_state('fnartest:tile') == %d" % t, 'components': {
            'minecraft:material_instances': {'*': {'texture': 'fnartest_poster_%d' % t, 'render_method': 'alpha_test'}}}} for t in range(4)]),
    'grate': block('fnartest:grate', {
        'minecraft:geometry': 'geometry.fnartest.grate',
        'minecraft:material_instances': {'*': {'texture': 'fnartest_grate', 'render_method': 'alpha_test'}},
        'minecraft:light_dampening': 0,
    }),
    'glass_panel': block('fnartest:glass_panel', {
        'minecraft:geometry': 'geometry.fnartest.glass_panel',
        'minecraft:material_instances': {'*': {'texture': 'fnartest_glass', 'render_method': 'blend'}},
        'minecraft:light_dampening': 0,
    }, traits={'minecraft:placement_direction': CARD}, permutations=ROT),
    'flip_sign': block('fnartest:flip_sign', {
        'minecraft:geometry': 'geometry.fnartest.flip_sign',
        'minecraft:material_instances': {'*': {'texture': 'fnartest_flip', 'render_method': 'alpha_test'}},
        'minecraft:light_dampening': 0, 'minecraft:light_emission': 5,
    }, traits={'minecraft:placement_direction': CARD}, permutations=ROT),
}
for name, b in blocks.items():
    wjson(os.path.join(BP, 'blocks', name + '.json'), b)
print('fixtures written:', len(blocks), 'blocks,', len(terrain), 'textures')
