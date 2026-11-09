#!/usr/bin/env python3
"""Grinning Moth: geometry, texture (64x32, vanilla-style pixel art) and animations.

The moth's furry head carries a tiny pale face like the Shaftbreaker's (glowing amber eyes and a
wide grin), and when the wings are spread, the wing markings form a second, larger grinning face.
"""
import json
import os
import random

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rnd = random.Random(1337)

TW, TH = 64, 32
tex = np.zeros((TH, TW, 4), dtype=np.uint8)


def put(x, y, c, a=255):
    tex[y, x] = [c[0], c[1], c[2], a]


def fill_noise(x0, y0, w, h, pal, alpha=255):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            put(x, y, pal[rnd.randrange(len(pal))], alpha)


FUR = [(58, 46, 40), (70, 56, 48), (84, 68, 58), (50, 40, 36), (96, 80, 68)]
PALE = [(214, 200, 182), (198, 184, 166), (226, 214, 198)]
WING = [(92, 84, 78), (104, 96, 88), (82, 74, 70), (116, 106, 96), (74, 66, 62)]
WING_DARK = [(46, 38, 36), (56, 46, 42)]
GLOW = (255, 196, 120)
RED = (122, 30, 28)

# ---- head (5x5x4): north face is the grinning face
HX, HY = 0, 0
fill_noise(HX, HY, 5, 5, PALE)
for x, y in [(0, 0), (4, 0), (0, 4), (4, 4)]:
    put(HX + x, HY + y, FUR[1])
put(HX + 1, HY + 1, (20, 12, 12)); put(HX + 3, HY + 1, (20, 12, 12))
put(HX + 1, HY + 1, GLOW, 25); put(HX + 3, HY + 1, GLOW, 25)  # glowing pupils (emissive alpha)
for x in range(0, 5):
    put(HX + x, HY + 3, (24, 14, 14))
for x in (0, 2, 4):
    put(HX + x, HY + 3, (236, 228, 210), 200)  # teeth, faint glow
put(HX + 0, HY + 2, (24, 14, 14)); put(HX + 4, HY + 2, (24, 14, 14))  # grin corners curl up
# head sides/top/bottom/back: fur
fill_noise(5, 0, 4, 5, FUR); fill_noise(9, 0, 4, 5, FUR); fill_noise(13, 0, 5, 4, FUR)
fill_noise(18, 0, 5, 4, FUR); fill_noise(23, 0, 5, 5, FUR)
# ---- body 3x3x8
fill_noise(28, 0, 3, 3, FUR); fill_noise(31, 0, 3, 3, FUR)
for (x0, w, h) in [(34, 8, 3), (42, 8, 3)]:
    fill_noise(x0, 0, w, h, FUR)
    for x in range(x0, x0 + w, 2):
        put(x, 1, FUR[3])  # abdomen bands
fill_noise(50, 0, 3, 8, FUR); fill_noise(53, 0, 3, 8, FUR)
for y in range(1, 8, 2):
    put(51, y, FUR[3]); put(54, y, FUR[3])


# ---- wings (cutout shapes). forewing 11x9, hindwing 8x6. u axis: 0 = body side.
def wing_shape(w, h, fore=True):
    m = np.zeros((h, w), bool)
    for y in range(h):
        for x in range(w):
            # rounded trailing edge, pointed tip at outer front
            fx, fy = x / (w - 1), y / (h - 1)
            if fore:
                inside = fy <= 0.15 + 0.95 * (1 - fx ** 2.2) and not (fx > 0.85 and fy > 0.55)
            else:
                inside = (fx - 0.0) ** 2 / 1.0 + (fy - 0.35) ** 2 / 0.6 <= 1.0
            m[y, x] = inside
    return m


def draw_wing(x0, y0, w, h, fore, side, underside):
    m = wing_shape(w, h, fore)
    for y in range(h):
        for x in range(w):
            if not m[y, x]:
                tex[y0 + y, x0 + (x if side == 'L' else w - 1 - x)] = 0
                continue
            c = WING[rnd.randrange(len(WING))]
            if underside:
                c = tuple(int(v * 0.8) for v in c)
            # vein lines
            if (x + y) % 4 == 0 and rnd.random() < 0.5:
                c = WING_DARK[0]
            # edge darkening
            edge = (y + 1 < h and not m[y + 1, x]) or (x + 1 < w and not m[y, x + 1]) or y == 0
            if edge:
                c = WING_DARK[1]
            px = x0 + (x if side == 'L' else w - 1 - x)
            tex[y0 + y, px] = [c[0], c[1], c[2], 255]
    if fore and not underside:
        # eye-spot (one per wing) + half of a wide grin: together the spread wings form a face
        ex, ey = 4, 2
        for dx, dy in [(0, 0), (1, 0), (0, 1), (1, 1)]:
            px = x0 + ((ex + dx) if side == 'L' else w - 1 - (ex + dx))
            tex[y0 + ey + dy, px] = [24, 16, 14, 255]
        px = x0 + ((ex + 1) if side == 'L' else w - 1 - (ex + 1))
        tex[y0 + ey, px] = [230, 170, 110, 255]  # pale glint in the eye-spot
        # grin: arc from body edge toward the outer wing
        for gx in range(0, 7):
            gy = 6 - (1 if gx >= 5 else 0) - (1 if gx >= 6 else 0)
            px = x0 + (gx if side == 'L' else w - 1 - gx)
            if m[gy, gx]:
                tex[y0 + gy, px] = [30, 18, 16, 255]
                if gx % 2 == 0 and gy - 1 >= 0 and m[gy - 1, gx]:
                    tex[y0 + gy - 1, px] = [218, 206, 186, 255]  # teeth
        # pale "cheek" dusting
        for gx, gy in [(2, 4), (3, 5), (7, 4)]:
            if m[gy, gx]:
                tex[y0 + gy, x0 + (gx if side == 'L' else w - 1 - gx)] = [150, 136, 124, 255]


draw_wing(0, 8, 11, 9, True, 'L', False)
draw_wing(11, 8, 11, 9, True, 'L', True)
draw_wing(22, 8, 11, 9, True, 'R', False)
draw_wing(33, 8, 11, 9, True, 'R', True)
draw_wing(0, 17, 8, 6, False, 'L', False)
draw_wing(8, 17, 8, 6, False, 'L', True)
draw_wing(16, 17, 8, 6, False, 'R', False)
draw_wing(24, 17, 8, 6, False, 'R', True)
# blood-red flecks on hindwings
for (x, y) in [(3, 19), (5, 20), (20, 19), (18, 20)]:
    if tex[y, x, 3]:
        tex[y, x, :3] = RED
# antennae (feathery planes 3x5)
for x0 in (44, 47):
    for y in range(5):
        for x in range(3):
            if x == 1 or (y % 2 == 0 and y < 4):
                tex[8 + y, x0 + x] = [*FUR[4], 255]
# legs (1x3)
fill_noise(50, 8, 1, 3, FUR)

os.makedirs(os.path.join(ROOT, 'RP/textures/entity'), exist_ok=True)
Image.fromarray(tex, 'RGBA').save(os.path.join(ROOT, 'RP/textures/entity/grinning_moth.png'))


# ---------------------------------------------------------------- geometry
def face(u, v, w, h):
    return {'uv': [u, v], 'uv_size': [w, h]}


def cube(origin, size, faces, pivot=None, rotation=None):
    c = {'origin': origin, 'size': size, 'uv': faces}
    if pivot:
        c['pivot'] = pivot
    if rotation:
        c['rotation'] = rotation
    return c


bones = [
    {'name': 'root', 'pivot': [0, 0, 0]},
    {'name': 'body', 'parent': 'root', 'pivot': [0, 4, 0], 'cubes': [
        cube([-1.5, 3, -3], [3, 3, 8], {'north': face(28, 0, 3, 3), 'south': face(31, 0, 3, 3), 'east': face(34, 0, 8, 3),
                                        'west': face(42, 0, 8, 3), 'up': face(50, 0, 3, 8), 'down': face(53, 0, 3, 8)})]},
    {'name': 'head', 'parent': 'body', 'pivot': [0, 4.5, -3], 'cubes': [
        cube([-2.5, 2, -7], [5, 5, 4], {'north': face(0, 0, 5, 5), 'east': face(5, 0, 4, 5), 'west': face(9, 0, 4, 5),
                                        'up': face(13, 0, 5, 4), 'down': face(18, 0, 5, 4), 'south': face(23, 0, 5, 5)})],
     'locators': {'face': [0, 4.5, -7]}},
    {'name': 'antenna_left', 'parent': 'head', 'pivot': [1, 7, -6], 'rotation': [-30, -20, 0], 'cubes': [
        cube([0.5, 7, -6.5], [0, 5, 3], {'east': face(44, 8, 3, 5), 'west': face(44, 8, 3, 5)})]},
    {'name': 'antenna_right', 'parent': 'head', 'pivot': [-1, 7, -6], 'rotation': [-30, 20, 0], 'cubes': [
        cube([-0.5, 7, -6.5], [0, 5, 3], {'east': face(47, 8, 3, 5), 'west': face(47, 8, 3, 5)})]},
    {'name': 'wing_left', 'parent': 'body', 'pivot': [1.5, 6, -2], 'cubes': [
        cube([1.5, 6, -3], [11, 0, 9], {'up': face(0, 8, 11, 9), 'down': face(11, 8, 11, 9)})]},
    {'name': 'wing_right', 'parent': 'body', 'pivot': [-1.5, 6, -2], 'cubes': [
        cube([-12.5, 6, -3], [11, 0, 9], {'up': face(22, 8, 11, 9), 'down': face(33, 8, 11, 9)})]},
    {'name': 'wing_left_hind', 'parent': 'body', 'pivot': [1.5, 5.9, 3], 'cubes': [
        cube([1.5, 5.9, 3], [8, 0, 6], {'up': face(0, 17, 8, 6), 'down': face(8, 17, 8, 6)})]},
    {'name': 'wing_right_hind', 'parent': 'body', 'pivot': [-1.5, 5.9, 3], 'cubes': [
        cube([-9.5, 5.9, 3], [8, 0, 6], {'up': face(16, 17, 8, 6), 'down': face(24, 17, 8, 6)})]},
    {'name': 'legs', 'parent': 'body', 'pivot': [0, 3, 0], 'cubes': [
        cube([-1.5, 0, -1], [0.5, 3, 0.5], {'north': face(50, 8, 1, 3), 'south': face(50, 8, 1, 3), 'east': face(50, 8, 1, 3), 'west': face(50, 8, 1, 3)}),
        cube([1, 0, -1], [0.5, 3, 0.5], {'north': face(50, 8, 1, 3), 'south': face(50, 8, 1, 3), 'east': face(50, 8, 1, 3), 'west': face(50, 8, 1, 3)}),
        cube([-1.5, 0, 2], [0.5, 3, 0.5], {'north': face(50, 8, 1, 3), 'south': face(50, 8, 1, 3), 'east': face(50, 8, 1, 3), 'west': face(50, 8, 1, 3)}),
        cube([1, 0, 2], [0.5, 3, 0.5], {'north': face(50, 8, 1, 3), 'south': face(50, 8, 1, 3), 'east': face(50, 8, 1, 3), 'west': face(50, 8, 1, 3)})]},
]
geo = {'format_version': '1.12.0', 'minecraft:geometry': [{
    'description': {'identifier': 'geometry.shaftbreaker.grinning_moth', 'texture_width': TW, 'texture_height': TH,
                    'visible_bounds_width': 3, 'visible_bounds_height': 2, 'visible_bounds_offset': [0, 0.5, 0]},
    'bones': bones}]}
os.makedirs(os.path.join(ROOT, 'RP/models/entity'), exist_ok=True)
json.dump(geo, open(os.path.join(ROOT, 'RP/models/entity/grinning_moth.geo.json'), 'w'), indent=1)


# ---------------------------------------------------------------- animations
def kf(pairs):
    return {('%.4g' % t if '.' in '%.4g' % t else '%.4g.0' % t): v for t, v in pairs}


flap = {'loop': True, 'animation_length': 0.24, 'bones': {
    'wing_left': {'rotation': kf([(0, [0, 0, -55]), (0.12, [0, 0, 40]), (0.24, [0, 0, -55])])},
    'wing_right': {'rotation': kf([(0, [0, 0, 55]), (0.12, [0, 0, -40]), (0.24, [0, 0, 55])])},
    'wing_left_hind': {'rotation': kf([(0, [0, 0, -45]), (0.12, [0, 0, 32]), (0.24, [0, 0, -45])])},
    'wing_right_hind': {'rotation': kf([(0, [0, 0, 45]), (0.12, [0, 0, -32]), (0.24, [0, 0, 45])])},
    'body': {'position': kf([(0, [0, 0.4, 0]), (0.12, [0, -0.4, 0]), (0.24, [0, 0.4, 0])])},
    'legs': {'rotation': [30, 0, 0]},
}}
# perched / watching: wings spread flat so the face pattern shows, slow "breathing" wing tremble
perch = {'loop': True, 'animation_length': 3.0, 'bones': {
    'wing_left': {'rotation': kf([(0, [0, 0, 6]), (1.5, [0, 0, 12]), (3.0, [0, 0, 6])])},
    'wing_right': {'rotation': kf([(0, [0, 0, -6]), (1.5, [0, 0, -12]), (3.0, [0, 0, -6])])},
    'antenna_left': {'rotation': kf([(0, [0, 0, 0]), (1.0, [8, 0, 0]), (2.0, [-4, 0, 0]), (3.0, [0, 0, 0])])},
    'antenna_right': {'rotation': kf([(0, [0, 0, 0]), (1.2, [6, 0, 0]), (2.2, [-6, 0, 0]), (3.0, [0, 0, 0])])},
}}
look = {'loop': True, 'bones': {'head': {'rotation': ['math.clamp(query.target_x_rotation, -40, 40)',
                                                      'math.clamp(query.target_y_rotation, -60, 60)', 0]}}}
anims = {'format_version': '1.8.0', 'animations': {
    'animation.grinning_moth.flap': flap, 'animation.grinning_moth.perch': perch, 'animation.grinning_moth.look': look}}
json.dump(anims, open(os.path.join(ROOT, 'RP/animations/grinning_moth.animation.json'), 'w'), indent=1)
ctrl = {'format_version': '1.10.0', 'animation_controllers': {
    'controller.animation.grinning_moth.wings': {
        'initial_state': 'fly',
        'states': {
            'fly': {'animations': ['flap'], 'transitions': [{'perch': "query.property('shaftbreaker:perched')"}],
                    'blend_transition': 0.2},
            'perch': {'animations': ['perch'], 'transitions': [{'fly': "!query.property('shaftbreaker:perched')"}],
                      'blend_transition': 0.3}}}}}
json.dump(ctrl, open(os.path.join(ROOT, 'RP/animation_controllers/grinning_moth.animation_controllers.json'), 'w'), indent=1)
print('moth ok')
