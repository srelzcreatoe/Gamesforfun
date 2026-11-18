#!/usr/bin/env python3
"""Builds the daytime guest entity fnar:guest (BP + RP): people, not animatronics.

Everything is generated here, nothing is copied from the game or anywhere else:
  - a humanoid geometry of our own (head, body, arms with elbows, legs with knees, plus a few small
    parts every skin can use or leave transparent: hair volume, a jacket layer, a cap brim, a ponytail,
    pigtails, a party hat, a backpack, a pizza slice in the hand while eating)
  - the skins: 64 x 64 pixel art in the classic layout, small-town 1991 clothes, adults and children,
    painted procedurally from the specs in SKINS below
  - the animations (Molang, looping: idle, walk, hurry, clap, cheer, wave, point, play, talk, and
    seated: sit, eat, sit_clap, sit_talk, sit_wave, sit_cheer), the head look, the size layer and the
    hand-in-hand arm
  - the animation controller, the render controller (the skin is picked by fnar:skin), the client
    entity and the behaviour entity.

Entity properties (scripts: packs/BP/scripts/mc/guests.js):
  fnar:anim    enum  one of ANIMS
  fnar:skin    int   index into SKINS
  fnar:size    int   percent of adult height (children are small: the root bone scales, the head a
                     little less, so a child's head is bigger for its body)
  fnar:hold    int   0 no, 1 left hand out, 2 right hand out, 3 both (walking hand in hand)
  fnar:look_yaw / fnar:look_pitch  int  head turn in degrees (yaw + = to its right, pitch - = up), smoothed client side

Run:  python3 tools/entities/build_guest.py     (also writes tools/entities/guest_skins.json for the tools)
"""
import json, os, random
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RP = os.path.join(ROOT, 'packs', 'RP')
BP = os.path.join(ROOT, 'packs', 'BP')

ID = 'guest'
# The player's own render scale: a 32 px figure stands 1.875 blocks tall at fnar:size 100.
SCALE = 0.9375
COLLISION = {'width': 0.6, 'height': 1.8}
VISIBLE_BOUNDS = {'width': 3, 'height': 3, 'offset': [0, 1.25, 0]}
SIZE_RANGE = [40, 115]

ANIMS = ['idle', 'walk', 'hurry', 'clap', 'cheer', 'wave', 'point', 'play', 'talk',
         'sit', 'eat', 'sit_clap', 'sit_talk', 'sit_wave', 'sit_cheer']
assert len(ANIMS) <= 16  # Bedrock's limit for an enum property


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1)
        f.write('\n')


# ============================================================================ geometry
def box_uv(u, v, w, h, d):
    """Per-face UVs of a w x h x d cube in the classic box layout whose top-left corner is (u, v)."""
    return {
        'north': {'uv': [u + d, v + d], 'uv_size': [w, h]},
        'east': {'uv': [u, v + d], 'uv_size': [d, h]},
        'south': {'uv': [u + 2 * d + w, v + d], 'uv_size': [w, h]},
        'west': {'uv': [u + d + w, v + d], 'uv_size': [d, h]},
        'up': {'uv': [u + d + w, v + d], 'uv_size': [-w, -d]},
        'down': {'uv': [u + d + 2 * w, v], 'uv_size': [-w, d]},
    }


def limb_uv(u, v, upper):
    """A 4 x 12 x 4 limb of the classic layout cut in two at the elbow / knee. The two cut faces get
    the two unused 4 x 4 corners of the limb's block: (u + 12, v) under the upper half, (u, v) on top of
    the lower half."""
    f = box_uv(u, v, 4, 12, 4)
    row = 0 if upper else 6
    for k in ('north', 'east', 'south', 'west'):
        f[k] = {'uv': [f[k]['uv'][0], f[k]['uv'][1] + row], 'uv_size': [4, 6]}
    if upper:
        f['down'] = {'uv': [u + 16, v], 'uv_size': [-4, 4]}
    else:
        f['up'] = {'uv': [u + 4, v + 4], 'uv_size': [-4, -4]}
    return f


def cube(origin, size, uv, inflate=None):
    c = {'origin': origin, 'size': size, 'uv': uv}
    if inflate:
        c['inflate'] = inflate
    return c


# Where each part's box sits on the 64 x 64 skin: (u, v, w, h, d). The classic head, body and limb blocks;
# the hair and jacket layers on the classic overlay blocks; the small parts on the unused overlay space.
UV = {
    'head': (0, 0, 8, 8, 8), 'hat': (32, 0, 8, 8, 8),
    'body': (16, 16, 8, 12, 4), 'jacket': (16, 32, 8, 12, 4),
    'right_arm': (40, 16, 4, 12, 4), 'left_arm': (32, 48, 4, 12, 4),
    'right_leg': (0, 16, 4, 12, 4), 'left_leg': (16, 48, 4, 12, 4),
    'party_hat_1': (0, 32, 4, 2, 4), 'party_hat_2': (0, 38, 3, 2, 3), 'party_hat_3': (0, 43, 2, 2, 2), 'party_hat_4': (8, 43, 1, 1, 1),
    'cap_brim': (40, 32, 8, 1, 3), 'cap_back': (40, 36, 8, 1, 3),
    'ponytail': (40, 40, 2, 5, 2), 'pigtail_r': (48, 40, 2, 4, 2), 'pigtail_l': (56, 40, 2, 4, 2),
    'backpack': (0, 48, 5, 7, 3),
    'slice': (48, 48, 3, 4, 1),
}


def geometry():
    U = lambda k: box_uv(*UV[k])  # noqa: E731
    bones = [
        {'name': 'root', 'pivot': [0, 0, 0]},
        {'name': 'body', 'parent': 'root', 'pivot': [0, 12, 0], 'cubes': [
            cube([-4, 12, -2], [8, 12, 4], U('body')),
            cube([-4, 12, -2], [8, 12, 4], U('jacket'), inflate=0.3),
        ]},
        {'name': 'backpack', 'parent': 'body', 'pivot': [0, 18, 2], 'cubes': [cube([-2.5, 15.5, 2.3], [5, 7, 3], U('backpack'))]},
        {'name': 'head', 'parent': 'body', 'pivot': [0, 24, 0], 'cubes': [
            cube([-4, 24, -4], [8, 8, 8], U('head')),
            cube([-4, 24, -4], [8, 8, 8], U('hat'), inflate=0.5),
            cube([-4, 28.4, -7.5], [8, 1, 3], U('cap_brim')),
            cube([-4, 28.4, 4.5], [8, 1, 3], U('cap_back')),
            cube([-1, 23.6, 4.4], [2, 5, 2], U('ponytail')),
            cube([-6.4, 23.5, -1], [2, 4, 2], U('pigtail_r')),
            cube([4.4, 23.5, -1], [2, 4, 2], U('pigtail_l')),
        ]},
        {'name': 'party_hat', 'parent': 'head', 'pivot': [0, 32, 0], 'rotation': [-6, 0, 7], 'cubes': [
            cube([-2, 32.4, -2], [4, 2, 4], U('party_hat_1')),
            cube([-1.5, 34.4, -1.5], [3, 2, 3], U('party_hat_2')),
            cube([-1, 36.4, -1], [2, 2, 2], U('party_hat_3')),
            cube([-0.5, 38.4, -0.5], [1, 1, 1], U('party_hat_4')),
        ]},
        {'name': 'right_arm', 'parent': 'body', 'pivot': [-5, 22, 0], 'cubes': [cube([-8, 18, -2], [4, 6, 4], limb_uv(40, 16, True))]},
        {'name': 'right_forearm', 'parent': 'right_arm', 'pivot': [-6, 18, 0], 'cubes': [cube([-8, 12, -2], [4, 6, 4], limb_uv(40, 16, False))]},
        # a pizza slice in the right hand, shown only while eating (render controller)
        {'name': 'slice', 'parent': 'right_forearm', 'pivot': [-6, 12, 0], 'cubes': [cube([-7.5, 8.2, -1.6], [3, 4, 1], U('slice'))]},
        {'name': 'left_arm', 'parent': 'body', 'pivot': [5, 22, 0], 'cubes': [cube([4, 18, -2], [4, 6, 4], limb_uv(32, 48, True))]},
        {'name': 'left_forearm', 'parent': 'left_arm', 'pivot': [6, 18, 0], 'cubes': [cube([4, 12, -2], [4, 6, 4], limb_uv(32, 48, False))]},
        {'name': 'right_leg', 'parent': 'root', 'pivot': [-2, 12, 0], 'cubes': [cube([-4, 6, -2], [4, 6, 4], limb_uv(0, 16, True))]},
        {'name': 'right_shin', 'parent': 'right_leg', 'pivot': [-2, 6, 0], 'cubes': [cube([-4, 0, -2], [4, 6, 4], limb_uv(0, 16, False))]},
        {'name': 'left_leg', 'parent': 'root', 'pivot': [2, 12, 0], 'cubes': [cube([0, 6, -2], [4, 6, 4], limb_uv(16, 48, True))]},
        {'name': 'left_shin', 'parent': 'left_leg', 'pivot': [2, 6, 0], 'cubes': [cube([0, 0, -2], [4, 6, 4], limb_uv(16, 48, False))]},
    ]
    return {
        'format_version': '1.16.0',
        'minecraft:geometry': [{
            'description': {
                'identifier': f'geometry.fnar.{ID}', 'texture_width': 64, 'texture_height': 64,
                'visible_bounds_width': VISIBLE_BOUNDS['width'], 'visible_bounds_height': VISIBLE_BOUNDS['height'],
                'visible_bounds_offset': list(VISIBLE_BOUNDS['offset']),
            },
            'bones': bones,
        }],
    }


# ============================================================================ skins
def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mul(c, f):
    return tuple(max(0, min(255, int(round(v * f)))) for v in c[:3])


def mix(a, b, f):
    return tuple(int(round(a[i] + (b[i] - a[i]) * f)) for i in range(3))


TONES = {'light': '#f0c8a4', 'fair': '#e8b594', 'tan': '#d39f76', 'olive': '#bd885d', 'brown': '#96603e', 'dark': '#6b432b'}
HAIR = {'black': '#1d1815', 'dkbrown': '#3a2516', 'brown': '#5f3c1f', 'auburn': '#7b3a1d', 'ginger': '#b65620',
        'blonde': '#d8b25a', 'sandy': '#b7954e', 'grey': '#989896', 'white': '#dbdbd4'}
C = {
    'white': '#e9e9e4', 'cream': '#e6dcc0', 'black': '#1e1e22', 'charcoal': '#3a3b40', 'grey': '#8d9096', 'ltgrey': '#bfc2c6',
    'red': '#b8322e', 'maroon': '#7a2230', 'pink': '#e27fa6', 'hotpink': '#e84f93', 'lilac': '#b79bd6', 'purple': '#7248a8',
    'navy': '#27335c', 'blue': '#3f63b0', 'sky': '#7fb2e0', 'denim': '#4a6591', 'acid': '#93abc8', 'teal': '#2f9a94', 'mint': '#8fd0b4',
    'green': '#3f8a45', 'forest': '#2c5a34', 'lime': '#9bd14a', 'yellow': '#e6c23c', 'mustard': '#c4952d', 'orange': '#e07f2c',
    'khaki': '#b9a57a', 'tanc': '#a98658', 'brownc': '#6d4a2e', 'cord': '#8a5a34', 'beige': '#d4c4a0',
}


def col(name):
    return rgb(C.get(name) or HAIR.get(name) or TONES.get(name) or name)


class Skin:
    """A 64 x 64 skin being painted. Coordinates are (column, row) inside a part's face, row 0 at the top."""

    def __init__(self, seed):
        self.a = np.zeros((64, 64, 4), np.uint8)
        self.r = random.Random(seed)

    def face(self, part, side):
        u, v, w, h, d = UV[part]
        return {
            'right': (u, v + d, d, h), 'front': (u + d, v + d, w, h), 'left': (u + d + w, v + d, d, h), 'back': (u + 2 * d + w, v + d, w, h),
            'top': (u + d, v, w, d), 'bottom': (u + d + w, v, w, d),
        }[side]

    def px(self, part, side, x, y, c):
        fx, fy, w, h = self.face(part, side)
        if 0 <= x < w and 0 <= y < h:
            self.a[fy + y, fx + x] = (*c[:3], 255)

    def rect(self, part, side, x0, y0, x1, y1, c):
        """Inclusive rectangle on one face."""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(part, side, x, y, c)

    def fill(self, part, c, sides=('right', 'front', 'left', 'back', 'top', 'bottom')):
        for s in sides:
            _, _, w, h = self.face(part, s)
            self.rect(part, s, 0, 0, w - 1, h - 1, c)

    def band(self, part, y0, y1, c):
        """Rows y0..y1 all the way round a part."""
        for s in ('right', 'front', 'left', 'back'):
            _, _, w, _ = self.face(part, s)
            self.rect(part, s, 0, y0, w - 1, y1, c)

    def get(self, part, side, x, y):
        fx, fy, _, _ = self.face(part, side)
        return tuple(int(v) for v in self.a[fy + y, fx + x][:3])

    def raw(self, x, y, c):
        self.a[y, x] = (*c[:3], 255)

    # ------------------------------------------------------------------ finishing
    def joint_caps(self):
        """The cut faces at the elbows and knees: the colour of the limb just above and below the cut."""
        for part in ('right_arm', 'left_arm', 'right_leg', 'left_leg'):
            u, v, _, _, _ = UV[part]
            above, below = self.get(part, 'front', 1, 5), self.get(part, 'front', 1, 6)
            for y in range(4):
                for x in range(4):
                    self.raw(u + 12 + x, v + y, mul(above, 0.9))
                    self.raw(u + x, v + y, mul(below, 0.9))

    def shade(self):
        """Soft pixel-art shading: every part a touch darker towards its bottom and on its back and sides,
        darker underneath, and a little grain so flat cloth does not look like plastic."""
        a = self.a.astype(float)
        for part, (u, v, w, h, d) in UV.items():
            for side, f in (('front', 1.0), ('right', 0.95), ('left', 0.95), ('back', 0.92), ('top', 1.04), ('bottom', 0.78)):
                fx, fy, fw, fh = self.face(part, side)
                for y in range(fh):
                    g = f * (1.03 - 0.09 * y / max(1, fh - 1)) if side in ('front', 'right', 'left', 'back') else f
                    a[fy + y, fx:fx + fw, :3] *= g
        grain = np.array([[self.r.uniform(0.965, 1.035) for _ in range(64)] for _ in range(64)])
        a[..., :3] *= grain[..., None]
        self.a = np.clip(np.round(a), 0, 255).astype(np.uint8)

    def image(self):
        return Image.fromarray(self.a, 'RGBA')


def paint_head(s, sp):
    tone = col(sp['tone'])
    hair = col(sp['hair'][1])
    style = sp['hair'][0]
    kid = sp['kind'] == 'child'
    s.fill('head', tone)
    s.fill('head', mul(tone, 0.88), sides=('bottom',))
    # ---- the face (front, 8 x 8)
    eye = col(sp.get('eyes', '#3b2a1c'))
    white = (236, 236, 232)
    if kid:
        for y in (3, 4):
            s.px('head', 'front', 1, y, white), s.px('head', 'front', 2, y, eye)
            s.px('head', 'front', 5, y, eye), s.px('head', 'front', 6, y, white)
        s.px('head', 'front', 2, 3, mul(eye, 0.6)), s.px('head', 'front', 5, 3, mul(eye, 0.6))
        blush = mix(tone, (226, 120, 120), 0.4)
        s.px('head', 'front', 1, 5, blush), s.px('head', 'front', 6, 5, blush)
        s.rect('head', 'front', 3, 6, 4, 6, mix(tone, (120, 40, 40), 0.75))
        if 'grin' in sp.get('face', ()):
            s.rect('head', 'front', 2, 6, 5, 6, mix(tone, (120, 40, 40), 0.75))
            s.rect('head', 'front', 3, 6, 4, 6, white)
        if 'freckles' in sp.get('face', ()):
            for x, y in ((2, 5), (5, 5), (3, 5)):
                s.px('head', 'front', x, y, mix(tone, (150, 80, 40), 0.5))
    else:
        s.px('head', 'front', 1, 4, white), s.px('head', 'front', 2, 4, eye)
        s.px('head', 'front', 5, 4, eye), s.px('head', 'front', 6, 4, white)
        brow = mix(tone, hair, 0.7)
        s.rect('head', 'front', 1, 3, 2, 3, brow), s.rect('head', 'front', 5, 3, 6, 3, brow)
        s.rect('head', 'front', 3, 5, 4, 5, mul(tone, 0.86))  # the nose
        lips = mix(tone, (150, 50, 50), 0.6 if 'lipstick' not in sp.get('face', ()) else 0.95)
        s.rect('head', 'front', 3, 6, 4, 6, lips)
        if 'smile' in sp.get('face', ()):
            s.rect('head', 'front', 2, 6, 5, 6, lips)
        if 'moustache' in sp.get('face', ()):
            s.rect('head', 'front', 2, 6, 5, 6, mul(hair, 1.05))
            s.rect('head', 'front', 3, 7, 4, 7, lips)
        if 'beard' in sp.get('face', ()):
            s.rect('head', 'front', 1, 6, 6, 7, hair), s.rect('head', 'front', 0, 5, 0, 7, hair), s.rect('head', 'front', 7, 5, 7, 7, hair)
            s.rect('head', 'front', 3, 6, 4, 6, lips)
            for side in ('right', 'left'):
                s.rect('head', side, 0, 5, 7, 7, hair)
            s.rect('head', 'bottom', 0, 0, 7, 3, hair)
        if 'stubble' in sp.get('face', ()):
            st = mix(tone, hair, 0.3)
            s.rect('head', 'front', 1, 6, 6, 7, st), s.rect('head', 'front', 3, 6, 4, 6, lips)
        if 'glasses' in sp.get('face', ()):
            # wire rims: a line over the eyes, the bridge, the temples back to the ears
            fr = col(sp.get('rims', '#b8963f'))
            s.rect('head', 'front', 1, 3, 2, 3, fr), s.rect('head', 'front', 5, 3, 6, 3, fr)
            for x in (0, 3, 4, 7):
                s.px('head', 'front', x, 4, fr)
            s.px('head', 'front', 1, 5, mix(tone, fr, 0.55)), s.px('head', 'front', 6, 5, mix(tone, fr, 0.55))
            s.rect('head', 'right', 4, 4, 7, 4, fr), s.rect('head', 'left', 0, 4, 3, 4, fr)
    # ---- the hair: how far it comes down on the front (f), the sides (sd) and the back (b), in rows
    cuts = {
        'short': (1, 3, 6), 'flat': (1, 2, 5), 'bowl': (2, 4, 6), 'bob': (1, 6, 7), 'long': (1, 8, 8), 'mullet': (1, 3, 8),
        'curly': (2, 6, 7), 'afro': (2, 6, 7), 'bald': (0, 0, 0), 'pony': (1, 3, 5), 'pigtails': (2, 4, 5), 'cap': (0, 3, 5), 'braids': (1, 3, 6),
    }
    f, sd, b = cuts[style]
    lo = mul(hair, 0.82)

    def strands(part, side, x0, y0, x1, y1):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                s.px(part, side, x, y, hair if (x * 3 + y * 5 + s.r.randint(0, 2)) % 4 else lo)

    for part in ('head', 'hat'):
        if style == 'bald':
            if part == 'hat':
                continue
            # a horseshoe of hair round a bare crown
            for side in ('right', 'left'):
                strands(part, side, 0, 2, 7, 4)
            strands(part, 'back', 0, 2, 7, 5)
            s.rect(part, 'top', 2, 2, 5, 5, mul(tone, 1.06))
            for x in range(8):
                for y in range(8):
                    if not (2 <= x <= 5 and 1 <= y <= 6):
                        s.px(part, 'top', x, y, hair)
            continue
        if part == 'hat' and style in ('short', 'flat', 'cap', 'braids'):
            continue  # close-cropped: no volume
        strands(part, 'top', 0, 0, 7, 7)
        if f:
            strands(part, 'front', 0, 0, 7, f - 1)
        if style in ('short', 'pony', 'mullet', 'braids', 'flat'):
            s.px(part, 'front', 0, f, hair), s.px(part, 'front', 7, f, hair)  # temples
        if style in ('long', 'bob'):
            strands(part, 'front', 0, f, 0, min(7, sd - 1)), strands(part, 'front', 7, f, 7, min(7, sd - 1))
        if style in ('curly', 'afro'):
            strands(part, 'front', 0, f, 0, 5), strands(part, 'front', 7, f, 7, 5)
        for side in ('right', 'left'):
            if sd:
                strands(part, side, 0, 0, 7, sd - 1)
            # behind the ear the hair hangs as low as at the back
            back_cols = range(5, 8) if side == 'right' else range(0, 3)
            for x in back_cols:
                strands(part, side, x, 0, x, b - 1)
        if b:
            strands(part, 'back', 0, 0, 7, b - 1)
    if style in ('curly', 'afro'):
        # big hair: the volume layer everywhere but the face, in tight curls
        for side, x0, x1 in (('front', 0, 7), ('right', 0, 7), ('left', 0, 7), ('back', 0, 7), ('top', 0, 7)):
            for y in range(8):
                for x in range(x0, x1 + 1):
                    if side == 'front' and y >= 2 and 1 <= x <= 6:
                        continue
                    if side != 'top' and y > (5 if style == 'afro' else 6):
                        continue
                    s.px('hat', side, x, y, lo if s.r.random() < 0.38 else hair)
    if style == 'cap':
        capc, peak = col(sp['cap'][0]), col(sp['cap'][1])
        s.fill('hat', capc, sides=('top',))
        for side in ('front', 'right', 'left', 'back'):
            s.rect('hat', side, 0, 0, 7, 2, capc)
        s.rect('hat', 'front', 2, 0, 5, 2, mix(capc, (255, 255, 255), 0.85) if sp['cap'][2] == 'trucker' else capc)
        s.px('hat', 'front', 3, 1, peak), s.px('hat', 'front', 4, 1, peak)
        s.px('hat', 'top', 3, 3, mul(capc, 0.7)), s.px('hat', 'top', 4, 4, mul(capc, 0.7))  # the button
        part = 'cap_back' if sp['cap'][2] == 'backwards' else 'cap_brim'
        s.fill(part, peak)
        s.fill(part, mul(peak, 0.75), sides=('bottom',))
        if sp['cap'][2] == 'backwards':
            s.rect('hat', 'front', 2, 2, 5, 2, tone)  # the strap gap shows the forehead
            s.rect('hat', 'front', 0, 0, 7, 1, capc)
    if style == 'pony':
        s.fill('ponytail', hair)
        for side in ('right', 'left', 'back', 'front'):
            s.rect('ponytail', side, 0, 0, 1, 0, col(sp.get('tie', 'hotpink')))
            s.px('ponytail', side, s.r.randint(0, 1), 3, lo)
    if style in ('pigtails', 'braids'):
        for part in ('pigtail_r', 'pigtail_l'):
            s.fill(part, hair)
            for side in ('right', 'left', 'back', 'front'):
                s.rect(part, side, 0, 0, 1, 0, col(sp.get('tie', 'hotpink')))
                if style == 'braids':
                    s.px(part, side, 0, 2, lo), s.px(part, side, 1, 3, col(sp.get('tie', 'yellow')))
    if 'headband' in sp.get('face', ()):
        hb = col(sp.get('tie', 'hotpink'))
        for side in ('front', 'right', 'left', 'back'):
            s.rect('hat', side, 0, 1, 7, 1, hb)
    if 'bow' in sp.get('face', ()):
        bw = col(sp.get('tie', 'red'))
        s.rect('hat', 'top', 2, 1, 5, 2, bw), s.px('hat', 'top', 3, 1, mul(bw, 0.7)), s.px('hat', 'top', 4, 2, mul(bw, 0.7))
        s.rect('hat', 'front', 2, 0, 5, 0, bw)
    if sp.get('party_hat'):
        a, b2 = col(sp['party_hat'][0]), col(sp['party_hat'][1])
        for i, part in enumerate(('party_hat_1', 'party_hat_2', 'party_hat_3')):
            s.fill(part, a if i % 2 == 0 else b2)
            for side in ('front', 'right', 'left', 'back'):
                _, _, w, _ = s.face(part, side)
                for x in range(w):
                    s.px(part, side, x, (x + i) % 2, b2 if i % 2 == 0 else a)
        s.fill('party_hat_4', (240, 240, 236))


def paint_limb(s, part, tone, sleeve, length, cuff=None, hand=True):
    """An arm: skin, then a sleeve of `length` rows (12 = to the wrist)."""
    s.fill(part, tone)
    if length:
        s.band(part, 0, min(11, length - 1), sleeve)
        s.fill(part, sleeve, sides=('top',))
        if cuff and length < 12:
            s.band(part, length - 1, length - 1, cuff)
    if length >= 10 and hand:
        s.band(part, 10, 11, tone)
        if cuff:
            s.band(part, 9, 9, cuff)
    s.fill(part, mul(tone, 0.9), sides=('bottom',))


def paint_body(s, sp):
    tone = col(sp['tone'])
    top = sp['top']
    kind = top[0]
    a = col(top[1])
    b = col(top[2]) if len(top) > 2 else mul(a, 0.8)
    s.fill('body', a)
    sleeve = a
    length = {'long': 12, 'short': 4, 'elbow': 6, 'none': 0}[sp.get('sleeves', 'long')]
    cuff = None
    if kind == 'stripes':
        for y in range(12):
            if (y // top[3] if len(top) > 3 else y) % 2:
                s.band('body', y, y, b)
    elif kind == 'plaid':
        for y in range(12):
            for side in ('front', 'back', 'right', 'left'):
                _, _, w, _ = s.face('body', side)
                for x in range(w):
                    if x % 3 == 1 and y % 3 == 1:
                        s.px('body', side, x, y, mix(a, b, 0.5))
                    elif x % 3 == 1 or y % 3 == 1:
                        s.px('body', side, x, y, b)
    elif kind == 'polo':
        s.rect('body', 'front', 2, 0, 5, 0, b), s.rect('body', 'front', 3, 1, 4, 2, mul(a, 0.8)), s.px('body', 'front', 3, 0, tone), s.px('body', 'front', 4, 0, tone)
        s.rect('body', 'back', 2, 0, 5, 0, b)
        cuff = b
    elif kind == 'jersey':
        s.band('body', 0, 0, b), s.band('body', 11, 11, b)
        for x, y in ((3, 3), (4, 3), (4, 4), (3, 5), (4, 5), (4, 6), (3, 7), (4, 7)):  # a "3"
            s.px('body', 'front', x, y, b)
        s.rect('body', 'back', 2, 3, 5, 3, b), s.rect('body', 'back', 3, 4, 4, 7, b)
        cuff = b
    elif kind == 'sweater':
        s.band('body', 3, 3, b), s.band('body', 5, 5, b)
        for side in ('front', 'back'):
            for x in range(8):
                s.px('body', side, x, 4, b if x % 2 else mix(a, (255, 255, 255), 0.7))
        s.band('body', 11, 11, mul(a, 0.8))
        cuff = mul(a, 0.8)
    elif kind == 'windbreaker':
        c3 = col(top[3])
        s.band('body', 0, 3, a), s.band('body', 4, 6, b), s.band('body', 7, 11, c3)
        s.rect('body', 'front', 3, 0, 4, 11, mul(a, 0.7))  # the zip
        s.px('body', 'front', 1, 5, (240, 240, 240)), s.px('body', 'front', 6, 5, (240, 240, 240))
        cuff = b
    elif kind == 'hawaiian':
        for side in ('front', 'back', 'right', 'left'):
            _, _, w, _ = s.face('body', side)
            for y in range(12):
                for x in range(w):
                    k = (x * 7 + y * 5 + len(side)) % 11
                    if k == 0:
                        s.px('body', side, x, y, b)
                    elif k == 4:
                        s.px('body', side, x, y, col(top[3]))
        s.rect('body', 'front', 3, 0, 4, 1, tone)  # the open collar
    elif kind == 'logo':
        # a souvenir shirt: a grey bear's face (the mascot) on the chest
        g = (150, 150, 156)
        s.rect('body', 'front', 2, 3, 5, 6, g), s.px('body', 'front', 2, 2, g), s.px('body', 'front', 5, 2, g)
        s.px('body', 'front', 3, 4, (20, 20, 24)), s.px('body', 'front', 4, 4, (20, 20, 24)), s.rect('body', 'front', 3, 6, 4, 6, (230, 226, 210))
        s.band('body', 0, 0, b)
        cuff = b
    elif kind == 'band':
        # a black band tee: a jagged logo
        for x, y in ((2, 3), (3, 4), (4, 3), (5, 4), (2, 5), (3, 5), (4, 5), (5, 5), (3, 7), (4, 7)):
            s.px('body', 'front', x, y, b)
    elif kind == 'blouse':
        s.rect('body', 'front', 3, 0, 4, 1, tone), s.px('body', 'front', 2, 0, b), s.px('body', 'front', 5, 0, b)
        for y in (3, 5, 7, 9):
            s.px('body', 'front', 4, y, b)
        cuff = b
    elif kind == 'turtleneck':
        s.band('body', 0, 1, mul(a, 1.12))
        for x in range(8):
            if x % 2:
                s.rect('body', 'front', x, 2, x, 11, mul(a, 0.94))
        cuff = mul(a, 0.85)
    elif kind == 'dress':
        s.band('body', 7, 7, b)  # the waist
        s.rect('body', 'front', 3, 0, 4, 0, tone)
        if len(top) > 3:
            for side in ('front', 'back', 'right', 'left'):
                _, _, w, _ = s.face('body', side)
                for y in range(12):
                    for x in range(w):
                        if (x * 5 + y * 3) % 7 == 0:
                            s.px('body', side, x, y, col(top[3]))
    elif kind == 'overalls':
        d = col(top[3]) if len(top) > 3 else col('denim')
        s.band('body', 6, 11, d)
        s.rect('body', 'front', 2, 3, 5, 5, d), s.rect('body', 'front', 1, 0, 1, 3, d), s.rect('body', 'front', 6, 0, 6, 3, d)
        s.rect('body', 'back', 1, 0, 1, 5, d), s.rect('body', 'back', 6, 0, 6, 5, d), s.rect('body', 'back', 2, 4, 5, 5, d)
        s.px('body', 'front', 1, 3, (220, 190, 80)), s.px('body', 'front', 6, 3, (220, 190, 80))
        s.rect('body', 'front', 3, 4, 4, 4, mul(d, 0.8))
    elif kind == 'letterman':
        sleeve = b
        s.band('body', 11, 11, b), s.rect('body', 'front', 3, 0, 4, 11, mul(a, 0.8))
        for x, y in ((1, 2), (1, 3), (1, 4), (2, 2), (2, 4)):  # the letter
            s.px('body', 'front', x, y, (240, 232, 200))
        cuff = a
    elif kind == 'tee':
        if len(top) > 2:
            s.band('body', 0, 0, b)
            cuff = b
    if 'belt' in sp.get('extras', ()):
        s.band('body', 11, 11, (48, 36, 28)), s.rect('body', 'front', 3, 11, 4, 11, (214, 184, 84))
    if sp.get('sleeve_color'):
        sleeve = col(sp['sleeve_color'])
    for part in ('right_arm', 'left_arm'):
        paint_limb(s, part, tone, sleeve, length, cuff)
        if kind == 'stripes' and length:
            for y in range(min(length, 12)):
                if (y // top[3] if len(top) > 3 else y) % 2:
                    s.band(part, y, y, b)
            if length >= 10:
                s.band(part, 10, 11, tone)
        if kind == 'plaid' and length:
            for y in range(min(length, 10)):
                if y % 3 == 1:
                    s.band(part, y, y, b)
        if kind == 'windbreaker':
            s.band(part, 0, 3, col(top[3])), s.band(part, 4, 9, a)
    # ---- an open jacket over it (the jacket layer; the arms take its colour)
    jk = sp.get('jacket')
    if jk:
        jc, jl = col(jk[1]), col(jk[2]) if len(jk) > 2 else mul(col(jk[1]), 0.78)
        for side in ('right', 'left', 'back'):
            _, _, w, h = s.face('jacket', side)
            s.rect('jacket', side, 0, 0, w - 1, h - 2, jc)
        s.rect('jacket', 'front', 0, 0, 2, 10, jc), s.rect('jacket', 'front', 5, 0, 7, 10, jc)
        s.rect('jacket', 'front', 2, 0, 2, 3, jl), s.rect('jacket', 'front', 5, 0, 5, 3, jl)  # lapels
        s.fill('jacket', jc, sides=('top',))
        s.rect('jacket', 'top', 2, 1, 5, 2, (0, 0, 0))
        fx, fy, _, _ = s.face('jacket', 'top')
        s.a[fy + 1:fy + 3, fx + 2:fx + 6, 3] = 0  # the neck hole
        if jk[0] == 'plaid':
            for side in ('right', 'left', 'back', 'front'):
                _, _, w, h = s.face('jacket', side)
                for y in range(h - 1):
                    for x in range(w):
                        if s.a[s.face('jacket', side)[1] + y, s.face('jacket', side)[0] + x, 3] and (x % 3 == 1 or y % 3 == 1):
                            s.px('jacket', side, x, y, jl)
        if jk[0] == 'denim':
            s.px('jacket', 'front', 1, 3, mul(jc, 1.25)), s.px('jacket', 'front', 6, 3, mul(jc, 1.25))
            s.rect('jacket', 'back', 1, 2, 6, 2, mul(jc, 0.8))
        for part in ('right_arm', 'left_arm'):
            paint_limb(s, part, tone, jc, 12, jl)
            if jk[0] == 'plaid':
                for y in range(10):
                    if y % 3 == 1:
                        s.band(part, y, y, jl)
    if sp.get('backpack'):
        bc, bd = col(sp['backpack'][0]), col(sp['backpack'][1])
        s.fill('backpack', bc)
        s.rect('backpack', 'back', 1, 3, 3, 5, bd), s.rect('backpack', 'back', 0, 0, 4, 0, bd)
        s.rect('body', 'front', 1, 0, 1, 6, bd), s.rect('body', 'front', 6, 0, 6, 6, bd)  # the straps


def paint_legs(s, sp):
    tone = col(sp['tone'])
    kind, a = sp['bottom'][0], col(sp['bottom'][1])
    shoe = col(sp['shoes'][0])
    sole = col(sp['shoes'][1]) if len(sp['shoes']) > 1 else mul(shoe, 0.6)
    for part in ('right_leg', 'left_leg'):
        s.fill(part, tone)
        if kind in ('jeans', 'slacks', 'khakis', 'leggings', 'cords', 'acid'):
            s.band(part, 0, 9, a)
            s.fill(part, a, sides=('top',))
            if kind in ('jeans', 'acid'):
                s.rect(part, 'front', 1, 3, 2, 6, mul(a, 1.12))  # worn thighs
                _, _, w, _ = s.face(part, 'right')
                s.rect(part, 'right' if part == 'right_leg' else 'left', 1, 0, 1, 9, mul(a, 0.82))  # the outer seam
            if kind == 'acid':
                for y in range(10):
                    for side in ('front', 'back', 'right', 'left'):
                        for x in range(4):
                            if s.r.random() < 0.3:
                                s.px(part, side, x, y, mul(a, s.r.choice((0.86, 1.14))))
            if kind == 'cords':
                for x in (1, 3):
                    for side in ('front', 'back'):
                        s.rect(part, side, x, 0, x, 9, mul(a, 0.88))
            if 'ripped' in sp.get('extras', ()):
                s.px(part, 'front', 1, 6, tone), s.px(part, 'front', 2, 6, mul(a, 1.3))
        elif kind == 'shorts':
            s.band(part, 0, 4, a)
            s.fill(part, a, sides=('top',))
            sock = col(sp.get('socks', 'white'))
            s.band(part, 8, 9, sock)
            if 'bandage' in sp.get('extras', ()) and part == 'left_leg':
                s.px(part, 'front', 1, 6, (226, 196, 150)), s.px(part, 'front', 2, 6, (226, 196, 150))
        elif kind == 'skirt':
            s.band(part, 0, 5, a)
            s.fill(part, a, sides=('top',))
            if len(sp['bottom']) > 2:
                s.band(part, 6, 9, col(sp['bottom'][2]))  # tights
        # the dress carries on over the thighs
        if sp['top'][0] == 'dress':
            dc = col(sp['top'][1])
            s.band(part, 0, 4, dc)
            s.fill(part, dc, sides=('top',))
            s.band(part, 4, 4, col(sp['top'][2]))
            if len(sp['top']) > 3:
                for side in ('front', 'back', 'right', 'left'):
                    for y in range(4):
                        for x in range(4):
                            if (x * 5 + y * 3 + 2) % 7 == 0:
                                s.px(part, side, x, y, col(sp['top'][3]))
        if sp['top'][0] == 'overalls':
            d = col(sp['top'][3]) if len(sp['top']) > 3 else col('denim')
            s.band(part, 0, 9, d)
            s.fill(part, d, sides=('top',))
            s.band(part, 9, 9, mul(d, 1.2))  # turned-up hems
        if 'legwarmers' in sp.get('extras', ()):
            s.band(part, 6, 9, col(sp.get('socks', 'hotpink')))
        s.band(part, 10, 11, shoe)
        s.band(part, 11, 11, sole)
        s.fill(part, sole, sides=('bottom',))
        s.px(part, 'front', 1, 10, mix(shoe, (255, 255, 255), 0.5)), s.px(part, 'front', 2, 10, mix(shoe, (255, 255, 255), 0.5))  # laces
        if len(sp['shoes']) > 2:
            for side in ('right', 'left'):
                s.rect(part, side, 1, 10, 2, 10, col(sp['shoes'][2]))  # a stripe


def paint_slice(s):
    cheese, crust, pep = (232, 190, 84), (176, 122, 62), (176, 48, 36)
    s.fill('slice', cheese)
    for side in ('front', 'back'):
        s.rect('slice', side, 0, 0, 2, 0, crust)
        s.px('slice', side, 1, 2, pep)
        s.px('slice', side, 0, 3, (0, 0, 0)), s.px('slice', side, 2, 3, (0, 0, 0))
        fx, fy, _, _ = s.face('slice', side)
        s.a[fy + 3, fx, 3] = 0
        s.a[fy + 3, fx + 2, 3] = 0  # the point of the slice
    s.fill('slice', crust, sides=('top',))


def make_skin(i, sp):
    s = Skin(1991 + i * 7919)
    paint_legs(s, sp)
    paint_body(s, sp)
    paint_head(s, sp)
    paint_slice(s)
    s.joint_caps()
    s.shade()
    return s.image()


# Every guest of Rustgrin's Pizza Revue, November 1991. `kind` decides the build: adults are fnar:size
# 92-102, teens 86-94, children 54-72 (packs/BP/scripts/data/guests.js reads the list this file exports).
SKINS = [
    # ---- adults
    dict(name='dad_flannel', kind='adult', tone='light', hair=('short', 'brown'), face=('moustache',), top=('tee', 'white'), sleeves='long',
         jacket=('plaid', 'red', 'black'), bottom=('jeans', 'denim'), shoes=('brownc', '#3a2819'), extras=('belt',)),
    dict(name='mom_windbreaker', kind='adult', tone='light', hair=('curly', 'blonde'), face=('lipstick', 'smile'), eyes='#3f6f9a',
         top=('windbreaker', 'teal', 'purple', 'hotpink'), sleeves='long', bottom=('acid', 'acid'), shoes=('white', 'ltgrey', 'hotpink')),
    dict(name='grandpa', kind='adult', tone='fair', hair=('bald', 'grey'), face=('glasses',), top=('polo', 'white', 'ltgrey'), sleeves='long',
         jacket=('cardigan', 'beige', 'tanc'), bottom=('slacks', 'brownc'), shoes=('#3a2819', '#241a12'), extras=('belt',)),
    dict(name='grandma', kind='adult', tone='fair', hair=('curly', 'white'), face=('glasses', 'smile'), top=('dress', 'lilac', 'purple', 'white'),
         sleeves='long', bottom=('skirt', 'lilac', 'beige'), shoes=('charcoal', 'black')),
    dict(name='dad_polo', kind='adult', tone='dark', hair=('short', 'black'), face=('smile',), top=('polo', 'green', 'white'), sleeves='short',
         bottom=('khakis', 'khaki'), shoes=('white', 'ltgrey', 'navy'), extras=('belt',)),
    dict(name='mom_denim', kind='adult', tone='brown', hair=('afro', 'black'), face=('lipstick', 'headband'), tie='yellow', top=('tee', 'yellow'),
         sleeves='long', jacket=('denim', 'denim', 'acid'), bottom=('leggings', 'black'), shoes=('pink', 'white')),
    dict(name='teen_metalhead', kind='teen', tone='tan', hair=('mullet', 'dkbrown'), top=('band', 'black', 'yellow'), sleeves='short',
         bottom=('jeans', 'acid'), shoes=('red', 'white'), extras=('ripped',)),
    dict(name='teen_scrunchie', kind='teen', tone='light', hair=('pony', 'auburn'), face=('lipstick',), tie='lime', eyes='#3f7a4a',
         top=('tee', 'hotpink', 'white'), sleeves='elbow', bottom=('leggings', 'lime'), shoes=('white', 'ltgrey'), extras=('legwarmers',), socks='purple'),
    dict(name='trucker', kind='adult', tone='olive', hair=('cap', 'dkbrown'), cap=('red', 'red', 'trucker'), face=('beard',), top=('tee', 'grey'),
         sleeves='short', bottom=('jeans', 'denim'), shoes=('tanc', '#3a2819'), extras=('belt',)),
    dict(name='office_mom', kind='adult', tone='olive', hair=('bob', 'black'), face=('lipstick',), top=('blouse', 'white', 'sky'), sleeves='long',
         bottom=('skirt', 'navy', 'tanc'), shoes=('black', 'black')),
    dict(name='jock', kind='teen', tone='light', hair=('flat', 'blonde'), eyes='#3f6f9a', top=('letterman', 'maroon', 'cream'), sleeves='long',
         bottom=('jeans', 'denim'), shoes=('white', 'ltgrey', 'red')),
    dict(name='aunt_floral', kind='adult', tone='brown', hair=('long', 'auburn'), face=('lipstick', 'smile'), top=('dress', 'teal', 'forest', 'yellow'),
         sleeves='short', bottom=('skirt', 'teal'), shoes=('tanc', 'brownc')),
    dict(name='uncle_hawaiian', kind='adult', tone='tan', hair=('bald', 'brown'), face=('moustache',), top=('hawaiian', 'sky', 'yellow', 'hotpink'),
         sleeves='short', bottom=('shorts', 'khaki'), socks='white', shoes=('brownc', '#3a2819')),
    dict(name='mom_turtleneck', kind='adult', tone='fair', hair=('long', 'black'), face=('smile',), top=('turtleneck', 'mint'), sleeves='long',
         bottom=('jeans', 'navy'), shoes=('white', 'ltgrey'), extras=('belt',)),
    dict(name='dad_sweater', kind='adult', tone='brown', hair=('short', 'black'), face=('glasses', 'stubble'), top=('sweater', 'navy', 'red'),
         sleeves='long', bottom=('cords', 'cord'), shoes=('charcoal', 'black')),
    dict(name='skater', kind='teen', tone='light', hair=('cap', 'sandy'), cap=('purple', 'teal', 'backwards'), top=('stripes', 'white', 'teal', 2),
         sleeves='elbow', bottom=('shorts', 'charcoal'), socks='white', shoes=('black', 'white', 'white')),
    # ---- children
    dict(name='boy_stripes', kind='child', tone='light', hair=('bowl', 'brown'), face=('grin',), top=('stripes', 'red', 'white', 1), sleeves='short',
         bottom=('shorts', 'blue'), socks='white', shoes=('white', 'ltgrey', 'red')),
    dict(name='girl_pigtails', kind='child', tone='light', hair=('pigtails', 'blonde'), face=('grin', 'bow'), tie='red', eyes='#3f6f9a',
         top=('dress', 'pink', 'hotpink', 'white'), sleeves='short', bottom=('skirt', 'pink', 'white'), shoes=('black', 'black')),
    dict(name='boy_overalls', kind='child', tone='dark', hair=('short', 'black'), face=('grin',), top=('overalls', 'yellow', 'yellow', 'denim'),
         sleeves='short', bottom=('jeans', 'denim'), shoes=('red', 'white')),
    dict(name='girl_braids', kind='child', tone='brown', hair=('braids', 'black'), tie='yellow', top=('logo', 'purple', 'white'), sleeves='short',
         bottom=('leggings', 'teal'), shoes=('white', 'ltgrey', 'hotpink')),
    dict(name='boy_cap', kind='child', tone='tan', hair=('cap', 'dkbrown'), cap=('red', 'navy', 'backwards'), face=('grin',), top=('jersey', 'green', 'white'),
         sleeves='short', bottom=('jeans', 'denim'), shoes=('white', 'ltgrey', 'green'), backpack=('blue', 'yellow')),
    dict(name='birthday_girl', kind='child', tone='olive', hair=('pony', 'black'), tie='yellow', face=('grin',), top=('dress', 'yellow', 'orange'),
         sleeves='short', bottom=('skirt', 'yellow', 'white'), shoes=('white', 'ltgrey'), party_hat=('hotpink', 'sky')),
    dict(name='boy_ginger', kind='child', tone='light', hair=('short', 'ginger'), face=('freckles',), eyes='#3f7a4a', top=('sweater', 'blue', 'white'),
         sleeves='long', bottom=('cords', 'cord'), shoes=('brownc', '#3a2819'), party_hat=('lime', 'purple')),
    dict(name='girl_souvenir', kind='child', tone='fair', hair=('bob', 'dkbrown'), face=('grin',), top=('logo', 'red', 'white'), sleeves='short',
         bottom=('shorts', 'denim'), socks='white', shoes=('white', 'ltgrey', 'sky'), extras=('bandage',)),
]


# ============================================================================ animations
T = 'variable.fnar_t'        # seconds, offset per guest so a crowd is never in step
W = 'variable.fnar_w'        # the walk cycle's phase in degrees (faster for short legs)
HL, HR = 'variable.fnar_hl', 'variable.fnar_hr'   # 1 while the left / right hand is held out to someone
HA = 'variable.fnar_ha'      # how far that arm is lifted sideways (a child reaches up, a parent down)


def breathe(amount=1.0):
    return {'body': {'rotation': [f'math.sin({T} * 95) * {0.9 * amount:.2f}', 0, 0]},
            'head': {'rotation': [f'math.sin({T} * 37) * {1.2 * amount:.2f} - math.sin({T} * 95 + 60) * {0.9 * amount:.2f}', f'math.sin({T} * 23) * {2.0 * amount:.2f}', 0]}}


def merge(*parts):
    out = {}
    for p in parts:
        for bone, chans in p.items():
            out.setdefault(bone, {}).update(chans)
    return out


def held(side, free_x, free_z='0'):
    """An arm's rotation: its own swing (free_x, free_z) unless the hand is held out to someone."""
    h = HL if side == 'left' else HR
    sign = '-' if side == 'left' else '+'
    return {'rotation': [f'(1 - {h}) * ({free_x})', 0, f'(1 - {h}) * ({free_z}) {sign} {h} * {HA}']}


SIT_LEGS = {
    # thighs level, knees bent; the shins a little longer than standing so an adult's feet reach the floor
    # from a 9 px seat (a 12 px leg cannot: under the table nobody sees the trick)
    'right_leg': {'rotation': [-84, 7, 0]}, 'left_leg': {'rotation': [-84, -7, 0]},
    'right_shin': {'rotation': [f'82 + math.sin({T} * 61) * 3', 0, 0], 'scale': [1, 1.4, 1]},
    'left_shin': {'rotation': [f'82 + math.sin({T} * 53 + 40) * 3', 0, 0], 'scale': [1, 1.4, 1]},
}
SIT_ARMS = {
    'right_arm': {'rotation': [-34, 0, 4]}, 'right_forearm': {'rotation': [-48, 0, 0]},
    'left_arm': {'rotation': [-34, 0, -4]}, 'left_forearm': {'rotation': [-48, 0, 0]},
}
CLAP_ARMS = {
    'right_arm': {'rotation': [-58, f'-22 + math.sin({T} * 1500) * 9', 0]}, 'right_forearm': {'rotation': [-62, 0, 0]},
    'left_arm': {'rotation': [-58, f'22 - math.sin({T} * 1500) * 9', 0]}, 'left_forearm': {'rotation': [-62, 0, 0]},
}
CHEER_ARMS = {
    # both arms thrown up in a V, pumping
    'right_arm': {'rotation': [f'-172 + math.sin({T} * 700) * 7', 0, f'-34 + math.sin({T} * 350) * 7']}, 'right_forearm': {'rotation': [f'-10 + math.sin({T} * 700) * 6', 0, 0]},
    'left_arm': {'rotation': [f'-172 + math.sin({T} * 700 + 90) * 7', 0, f'34 - math.sin({T} * 350) * 7']}, 'left_forearm': {'rotation': [f'-10 + math.sin({T} * 700 + 90) * 6', 0, 0]},
}
WAVE_ARM = {
    # the right arm up and out, the forearm wagging from the elbow
    'right_arm': {'rotation': [f'-164 + math.sin({T} * 300) * 4', 0, -32]}, 'right_forearm': {'rotation': [-8, 0, f'math.sin({T} * 1000) * 26']},
}
TALK_ARM = {
    'right_arm': {'rotation': [f'-24 + math.sin({T} * 170) * 8', 0, 6]}, 'right_forearm': {'rotation': [f'-62 + math.sin({T} * 310) * 22', 0, 0]},
}


def animations():
    A = {}
    A['idle'] = merge(breathe(), {
        # weight from one foot to the other, arms loose
        'root': {'position': [f'math.sin({T} * 41) * 0.35', 0, 0]},
        'body': {'rotation': [f'math.sin({T} * 95) * 0.9', 0, f'math.sin({T} * 41) * 1.6']},
        'right_arm': held('right', f'math.sin({T} * 63) * 3', f'3 + math.sin({T} * 95) * 1.2'),
        'left_arm': held('left', f'math.sin({T} * 63 + 140) * 3', f'-3 - math.sin({T} * 95) * 1.2'),
        'right_forearm': {'rotation': [-6, 0, 0]}, 'left_forearm': {'rotation': [-6, 0, 0]},
    })

    def walk(swing, knee, arm, lean, bob, speed):
        w = f'{W} * {speed}' if speed != 1 else W
        return {
            'root': {'position': [0, f'math.abs(math.sin({w})) * {bob}', 0]},
            'body': {'rotation': [lean, f'math.sin({w}) * 4', 0]},
            'head': {'rotation': [round(-lean * 0.7, 2), f'0 - math.sin({w}) * 3', 0]},
            'right_leg': {'rotation': [f'math.sin({w}) * {swing}', 0, 0]}, 'left_leg': {'rotation': [f'0 - math.sin({w}) * {swing}', 0, 0]},
            'right_shin': {'rotation': [f'math.max(0, 0 - math.cos({w})) * {knee}', 0, 0]}, 'left_shin': {'rotation': [f'math.max(0, math.cos({w})) * {knee}', 0, 0]},
            'right_arm': held('right', f'0 - math.sin({w}) * {arm}', '2'), 'left_arm': held('left', f'math.sin({w}) * {arm}', '-2'),
            'right_forearm': {'rotation': [f'-10 - math.max(0, math.sin({w})) * 14 - {HR} * 4', 0, 0]},
            'left_forearm': {'rotation': [f'-10 - math.max(0, 0 - math.sin({w})) * 14 - {HL} * 4', 0, 0]},
        }

    A['walk'] = walk(30, 44, 24, 1.5, 0.45, 1)
    A['hurry'] = merge(walk(40, 62, 34, 9, 0.9, 1.55), {
        'right_forearm': {'rotation': [f'-58 * (1 - {HR}) - 6', 0, 0]}, 'left_forearm': {'rotation': [f'-58 * (1 - {HL}) - 6', 0, 0]},
    })
    A['clap'] = merge(breathe(1.4), CLAP_ARMS, {'root': {'position': [0, f'math.abs(math.sin({T} * 330)) * 0.35', 0]}})
    A['cheer'] = merge(CHEER_ARMS, {
        'root': {'position': [0, f'math.abs(math.sin({T} * 520)) * 1.6', 0]},
        'head': {'rotation': [f'-8 + math.sin({T} * 520) * 3', 0, 0]},
        'right_leg': {'rotation': [0, 0, 3]}, 'left_leg': {'rotation': [0, 0, -3]},
        'right_shin': {'rotation': [f'math.abs(math.cos({T} * 520)) * 10', 0, 0]}, 'left_shin': {'rotation': [f'math.abs(math.cos({T} * 520)) * 10', 0, 0]},
    })
    A['wave'] = merge(breathe(), WAVE_ARM, {'left_arm': {'rotation': [0, 0, -3]}, 'head': {'rotation': [0, 0, 4]}})
    A['point'] = merge(breathe(), {
        'right_arm': {'rotation': [f'-104 + math.sin({T} * 140) * 3', 8, 0]}, 'right_forearm': {'rotation': [-4, 0, 0]},
        'left_arm': {'rotation': [0, 0, -3]}, 'body': {'rotation': [2, -6, 0]},
    })
    A['play'] = {
        # at a cabinet: both hands on the controls, small quick moves, eyes on the screen
        'body': {'rotation': [f'6 + math.sin({T} * 210) * 1.5', f'math.sin({T} * 130) * 3', 0]},
        'head': {'rotation': [f'-4 + math.sin({T} * 170) * 2', 0, 0]},
        'right_arm': {'rotation': [f'-46 + math.sin({T} * 900) * 4', -8, 0]}, 'right_forearm': {'rotation': [f'-46 + math.sin({T} * 1300) * 7', 0, 0]},
        'left_arm': {'rotation': [f'-46 + math.sin({T} * 640 + 70) * 5', 8, 0]}, 'left_forearm': {'rotation': [f'-46 + math.sin({T} * 1100 + 30) * 6', 0, 0]},
        'right_leg': {'rotation': [0, 0, 2]}, 'left_leg': {'rotation': [0, 0, -2]},
    }
    A['talk'] = merge(breathe(1.2), TALK_ARM, {
        'head': {'rotation': [f'math.sin({T} * 240) * 3', f'math.sin({T} * 67) * 5', 0]},
        'left_arm': {'rotation': [0, 0, -3]}, 'left_forearm': {'rotation': [-8, 0, 0]},
    })
    A['sit'] = merge(breathe(), SIT_LEGS, SIT_ARMS)
    A['eat'] = merge(SIT_LEGS, SIT_ARMS, {
        # a bite every few seconds: the slice comes up, the head dips to meet it, then chewing
        'right_arm': {'rotation': [f'-34 - math.clamp(math.sin({T} * 120) * 3, 0, 1) * 38', f'0 - math.clamp(math.sin({T} * 120) * 3, 0, 1) * 14', 4]},
        'right_forearm': {'rotation': [f'-48 - math.clamp(math.sin({T} * 120) * 3, 0, 1) * 74', 0, 0]},
        'head': {'rotation': [f'math.clamp(math.sin({T} * 120) * 3, 0, 1) * 9 + math.sin({T} * 900) * math.clamp(math.sin({T} * 120 + 180) * 3, 0, 1) * 1.5', 0, 0]},
        'body': {'rotation': [f'3 + math.clamp(math.sin({T} * 120) * 3, 0, 1) * 4', 0, 0]},
    })
    A['sit_clap'] = merge(breathe(1.4), SIT_LEGS, CLAP_ARMS)
    A['sit_talk'] = merge(breathe(1.2), SIT_LEGS, SIT_ARMS, TALK_ARM, {'head': {'rotation': [f'math.sin({T} * 240) * 3', f'math.sin({T} * 67) * 5', 0]}})
    A['sit_wave'] = merge(breathe(), SIT_LEGS, SIT_ARMS, WAVE_ARM)
    A['sit_cheer'] = merge(SIT_LEGS, CHEER_ARMS, {'body': {'rotation': [-4, f'math.sin({T} * 260) * 5', 0]}, 'head': {'rotation': [-6, 0, 0]}})
    out = {f'animation.fnar.{ID}.{k}': {'loop': True, 'bones': v} for k, v in A.items()}
    # layers that always play: the head look (smoothed property values; the pitch is a Minecraft pitch, negative =
    # up, like the animatronics' and the vanilla look-at-target animation), and the size
    out[f'animation.fnar.{ID}.look'] = {'loop': True, 'bones': {'head': {'rotation': ['variable.fnar_lp', 'variable.fnar_ly', 0]}}}
    out[f'animation.fnar.{ID}.size'] = {'loop': True, 'bones': {
        'root': {'scale': ['variable.fnar_size', 'variable.fnar_size', 'variable.fnar_size']},
        'head': {'scale': ['variable.fnar_head', 'variable.fnar_head', 'variable.fnar_head']},
    }}
    return {'format_version': '1.8.0', 'animations': out}


def controller():
    states = {}
    for v in ANIMS:
        states[v] = {
            'animations': [v],
            'blend_transition': 0.25,
            'transitions': [{o: f"variable.fnar_anim == '{o}'"} for o in ANIMS if o != v],
        }
    return {'format_version': '1.10.0', 'animation_controllers': {f'controller.animation.fnar.{ID}': {'initial_state': 'idle', 'states': states}}}


def client_entity():
    anims = {v: f'animation.fnar.{ID}.{v}' for v in ANIMS}
    anims.update({'look': f'animation.fnar.{ID}.look', 'size': f'animation.fnar.{ID}.size', 'ctrl': f'controller.animation.fnar.{ID}'})
    return {
        'format_version': '1.10.0',
        'minecraft:client_entity': {
            'description': {
                'identifier': f'fnar:{ID}',
                'materials': {'default': 'entity_alphatest'},
                'textures': {f's{i}': f'textures/entity/fnar/{ID}_{i:02d}' for i in range(len(SKINS))} | {'default': f'textures/entity/fnar/{ID}_00'},
                'geometry': {'default': f'geometry.fnar.{ID}'},
                'scripts': {
                    'scale': f'{SCALE}',
                    'pre_animation': [
                        "variable.fnar_anim = query.property('fnar:anim');",
                        "variable.fnar_size = query.property('fnar:size') * 0.01;",
                        # a child's head is bigger for its body
                        'variable.fnar_head = 1.0 + math.clamp(0.92 - variable.fnar_size, 0.0, 0.45) * 0.8;',
                        "variable.fnar_t = query.life_time + query.property('fnar:skin') * 0.73;",
                        # two strides a second for an adult, quicker little steps for short legs
                        'variable.fnar_w = variable.fnar_t * 700.0 / variable.fnar_size;',
                        "variable.fnar_hold = query.property('fnar:hold');",
                        'variable.fnar_hl = variable.fnar_hold == 1 || variable.fnar_hold == 3;',
                        'variable.fnar_hr = variable.fnar_hold >= 2;',
                        'variable.fnar_ha = variable.fnar_size < 0.8 ? 98.0 : 34.0;',
                        "variable.fnar_ly = math.lerp(variable.fnar_ly ?? 0, query.property('fnar:look_yaw'), 0.12);",
                        "variable.fnar_lp = math.lerp(variable.fnar_lp ?? 0, query.property('fnar:look_pitch'), 0.12);",
                    ],
                    'animate': ['ctrl', 'look', 'size'],
                },
                'animations': anims,
                'render_controllers': [f'controller.render.fnar.{ID}'],
                'enable_attachables': False,
            }
        },
    }


def render_controller():
    return {
        'format_version': '1.10.0',
        'render_controllers': {
            f'controller.render.fnar.{ID}': {
                'arrays': {'textures': {'Array.skin': [f'Texture.s{i}' for i in range(len(SKINS))]}},
                'geometry': 'Geometry.default',
                'materials': [{'*': 'Material.default'}],
                'textures': ["Array.skin[query.property('fnar:skin')]"],
                # the pizza slice is in the hand only while eating
                'part_visibility': [{'*': True}, {'slice': "variable.fnar_anim == 'eat'"}],
            },
        },
    }


def behavior_entity():
    return {
        'format_version': '1.26.50',
        'minecraft:entity': {
            'description': {
                'identifier': f'fnar:{ID}',
                'is_spawnable': False,
                'is_summonable': True,
                'is_experimental': False,
                'spawn_category': 'misc',
                'properties': {
                    'fnar:anim': {'type': 'enum', 'values': ANIMS, 'default': 'idle', 'client_sync': True},
                    'fnar:skin': {'type': 'int', 'range': [0, len(SKINS) - 1], 'default': 0, 'client_sync': True},
                    'fnar:size': {'type': 'int', 'range': list(SIZE_RANGE), 'default': 100, 'client_sync': True},
                    'fnar:hold': {'type': 'int', 'range': [0, 3], 'default': 0, 'client_sync': True},
                    'fnar:look_yaw': {'type': 'int', 'range': [-90, 90], 'default': 0, 'client_sync': True},
                    'fnar:look_pitch': {'type': 'int', 'range': [-45, 45], 'default': 0, 'client_sync': True},
                },
            },
            # Driven by teleport from the scripts, like the animatronics: nothing here moves, falls, takes damage,
            # can be pushed (no pushable components), drops loot or despawns.
            'components': {
                'minecraft:type_family': {'family': ['fnar_guest', 'inanimate']},
                'minecraft:collision_box': dict(COLLISION),
                'minecraft:physics': {'has_gravity': False, 'has_collision': False},
                'minecraft:damage_sensor': {'triggers': [{'cause': 'all', 'deals_damage': 'no'}]},
                'minecraft:health': {'value': 20, 'max': 20},
                'minecraft:knockback_resistance': {'value': 1.0},
                'minecraft:fire_immune': {},
                'minecraft:persistent': {},
                'minecraft:nameable': {'always_show': False, 'allow_name_tag_renaming': False},
            },
            'events': {},
        },
    }


def main():
    tex_dir = os.path.join(RP, 'textures', 'entity', 'fnar')
    os.makedirs(tex_dir, exist_ok=True)
    for i, sp in enumerate(SKINS):
        make_skin(i, sp).save(os.path.join(tex_dir, f'{ID}_{i:02d}.png'))
    write_json(os.path.join(RP, 'models', 'entity', f'fnar_{ID}.geo.json'), geometry())
    write_json(os.path.join(RP, 'animations', f'fnar_{ID}.animation.json'), animations())
    write_json(os.path.join(RP, 'animation_controllers', f'fnar_{ID}.animation_controllers.json'), controller())
    write_json(os.path.join(RP, 'render_controllers', f'fnar_{ID}.render_controllers.json'), render_controller())
    write_json(os.path.join(RP, 'entity', f'fnar_{ID}.entity.json'), client_entity())
    write_json(os.path.join(BP, 'entities', f'{ID}.json'), behavior_entity())
    # what the tools (skin sheet, previews) need to know about the cast of guests
    write_json(os.path.join(HERE, 'guest_skins.json'), {'scale': SCALE, 'anims': ANIMS, 'skins': [{'name': sp['name'], 'kind': sp['kind']} for sp in SKINS]})
    print(f'guest built: {len(SKINS)} skins ({sum(sp["kind"] == "child" for sp in SKINS)} children), {len(ANIMS)} animations')


if __name__ == '__main__':
    main()
