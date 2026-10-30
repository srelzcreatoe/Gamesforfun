"""Decay props for the dying pizzeria (docs/BLOCKS.md section C): spare animatronic heads, endoskeleton
parts, an empty costume slumped against a wall, the last birthday cake, a knocked-over chair, floor
decals (ticket stubs, puddles, footprints, debris), hanging wires, Walter's things, boarded windows and
a red emergency light. Same conventions as the other prop files (models face north, wall props have
their back at z = +8, every random choice is seeded)."""
import math

from propkit import Geo, Face, Mat, prop, panel, block_json, box, mi_set, glow, bs, pillar_views
from pal import *  # noqa: F403

# ---------------------------------------------------------------- the cast's colours (tools/blocks/surfaces/sprites.py PAL)
# fur ramps dark -> light, muzzle ramps dark -> light, plus the accent each head carries
CAST = {
    'rustgrin': dict(
        fur=Mat('fur_rustgrin', ['#262422', '#3c3936', '#4a4743', '#58544f', '#67625c', '#77726a', '#878177'], rough=235, h=138, hk=4),
        muz=Mat('muz_rustgrin', ['#6f685c', '#867e70', '#9c9382', '#b3aa98', '#cbc2b0'], rough=225, h=140, hk=3),
        ear='bear', hat='rustgrin', inner='muz'),
    'mirehop': dict(
        fur=Mat('fur_mirehop', ['#1c2612', '#26331a', '#2e3d1c', '#3a4d22', '#465e27', '#536e2e', '#617d35'], rough=235, h=138, hk=4),
        muz=Mat('muz_mirehop', ['#5e553c', '#72684a', '#877b58', '#9d9068', '#b4a679'], rough=225, h=140, hk=3),
        ear='rabbit', hat=None, inner='muz'),
    'noxbriar': dict(
        fur=Mat('fur_noxbriar', ['#0b0a0c', '#141316', '#1b1a1e', '#232126', '#2c292f', '#36323a', '#423d46'], rough=235, h=138, hk=4),
        muz=Mat('muz_noxbriar', ['#262226', '#2f2b30', '#363136', '#423c41', '#4c464b'], rough=225, h=140, hk=3),
        ear='bear', hat='noxbriar', inner='muz'),
    'cat': dict(
        fur=Mat('fur_cat', ['#1f141b', '#30202a', '#3a2832', '#45303a', '#503842', '#5c414b', '#694b56'], rough=235, h=138, hk=4),
        muz=Mat('muz_cat', ['#6e5a52', '#887066', '#a2867a', '#b89c8f', '#cfb2a4'], rough=225, h=140, hk=3),
        ear='cat', hat=None, inner='pink'),
    'purple_rat': dict(
        fur=Mat('fur_purple_rat', ['#301e2d', '#4a3046', '#563a51', '#63435d', '#71506b', '#7f5d78', '#8d6a86'], rough=235, h=138, hk=4),
        muz=Mat('muz_purple_rat', ['#6a5a69', '#847283', '#9e8a9d', '#b5a1b4', '#cbb8ca'], rough=225, h=140, hk=3),
        ear='rat', hat=None, inner='pink'),
}
HEAD_CHARS = ['rustgrin', 'mirehop', 'noxbriar', 'cat', 'purple_rat']
HAT_RED = Mat('hat_red', ['#3a0a0d', '#55111a', '#6b151a', '#86191f', '#a3232a', '#b8363a'], rough=200, h=140, hk=3)
VIOLET = Mat('bow_violet', ['#25163a', '#341f4f', '#4a2c66', '#5c3a7c', '#6e4892', '#8460a8'], rough=210, h=140, hk=3)
TEETH = Mat('teeth', ['#5f5a4e', '#7d776a', '#9a9384', '#b4ad9c', '#cbc4b2', '#ddd6c4'], rough=110, h=146, hk=3)
EYEBALL = Mat('eyeball', ['#6d6a62', '#8b877d', '#a8a498', '#c3bfb2', '#d8d4c7'], rough=60, h=146, hk=2)
WIRE_RED = Mat('wire_red', ['#3a0c0b', '#5a1512', '#7a1f19', '#962a20'], rough=120, h=140, hk=2)
WIRE_YEL = Mat('wire_yel', ['#4a3a0e', '#6e5714', '#94761c', '#b08f26'], rough=120, h=140, hk=2)
COPPER = Mat('copper', ['#3a1d10', '#5c2f18', '#7e4422', '#a05d2e', '#c27a40'], metal=210, rough=90, h=142, hk=3)
SPONGE = Mat('sponge', ['#5c4426', '#79592f', '#967039', '#ae8645', '#c49c58'], rough=235, h=136, hk=3)
ICING = Mat('icing', ['#6e665e', '#8c8378', '#aaa194', '#c4bcae', '#d8d1c3', '#e6e0d3'], rough=150, h=142, hk=3)
ICING_PINK = Mat('icing_pink', ['#5a2a36', '#7a3a4a', '#9a4c5e', '#b46074', '#c87a8c'], rough=150, h=144, hk=3)
JAM = Mat('jam', ['#3a0c10', '#561218', '#701a20'], rough=120, h=134, hk=2)
WAX = Mat('wax', ['#5a5a6e', '#6e7fa0', '#8aa0c4', '#a8bcdc'], rough=120, h=142, hk=2)
WAX_P = Mat('wax_pink', ['#6a3a4a', '#8a4a60', '#b06a80', '#cc8aa0'], rough=120, h=142, hk=2)
WAX_Y = Mat('wax_yel', ['#6a5a2a', '#8c7a36', '#b49e48', '#cdb85e'], rough=120, h=142, hk=2)
FLAME = Mat('flame', ['#b0461a', '#e0782a', '#ffb050', '#ffe08a', '#fff6d0'], rough=60, emit=[180, 220, 245, 255, 255], h=150, hk=1)
FOIL = Mat('foil', ['#4a4232', '#6a5e44', '#8a7c58', '#a8986c', '#c4b484'], metal=180, rough=80, h=136, hk=2)
NAVY = Mat('navy', ['#0b0f1c', '#111829', '#182137', '#202b45', '#2a3755', '#354466'], rough=210, h=138, hk=3)
GREYWOOD = Mat('greywood', ['#24201b', '#332d26', '#433b31', '#53493d', '#635849', '#736755', '#837662'], rough=230, h=136, hk=5)
LENS = Mat('lens_lit', ['#c8b890', '#e8dcb8', '#fff4d8', '#fffcf0'], rough=40, emit=[200, 235, 255, 255], h=146, hk=1)
TICKET = Mat('ticket', ['#3e1310', '#5a1a16', '#74241c', '#8c3024', '#a3402e', '#b4553c'], rough=230, h=134, hk=1)
TICKET_INK = Mat('ticket_ink', ['#d0b98a', '#e0cc9e'], rough=230, h=135, hk=1)
TILE_CHUNK = Mat('tile_chunk', ['#4e4b40', '#6c685a', '#8b8673', '#a09a83', '#b3ad95', '#c0ba9f'], rough=245, h=150, hk=4)
WET = Mat('wet', ['#06080a', '#0b0f12', '#11171b', '#1a2228', '#2a3640', '#45525c'], metal=0, rough=12, h=124, hk=1)
FIBER = Mat('fiber', ['#6a4a2e', '#8c6438', '#b08648', '#c8a05c', '#dab874'], rough=250, h=140, hk=4)


def fur_panel(c, base=3, grime=0.3):
    """Worn fake fur: noisy fill, bevel, grime from below and a few bald patches showing the shell."""
    def p(r):
        m = CAST[r.variant][c] if isinstance(c, str) else c
        r.fill(m, base, amp=0.7, white_amp=0.7, cell=2)
        r.bevel(1, -1)
        if grime:
            r.darken_noise(grime, -1, bottom=0.5 if r.face not in ('up', 'down') else 0)
        r.speck(m, 1, 0.06)
    return p


# =============================================================== spare animatronic head
def _head_parts(g, bone, x0=0.0, y0=0.0, z0=1.0, ears=True, hats=True, rat_teeth=True, s=1.25):
    """The shared spare head: skull, snout, slack jaw, nose, neck ring, then per-character ears and hats
    (bones named <bone>_<kind> so each character's geometry can pick its own). Authored at 10 px wide and
    scaled by `s` (1.25: the size of the performers' own heads at their render scale)."""
    o = lambda x, y, z: (x * s + x0, y * s + y0, z * s + z0)

    def face(r):
        ch = CAST[r.variant]
        fur, muz = ch['fur'], ch['muz']
        r.fill(fur, 3, amp=0.6, white_amp=0.6, cell=2)
        r.bevel(1, -1)
        # heavy, tired brows over wide hollow sockets: nothing behind them
        for (cx, cy) in ((1, 2), (6, 2)):
            r.hline(cx, cy - 1, 3, fur, 0)
            r.rect(cx, cy, 3, 2, SHADOW, 0)
            r.px(cx + 1, cy, SHADOW, 1)
            r.hline(cx, cy + 2, 3, fur, 1)  # sunken lower lids
        r.px(1, 1, fur, 1); r.px(8, 1, fur, 1)
        if r.variant == 'rustgrin':
            r.px(7, 3, RED_GLOW, 1, emit=110)  # one pupil still holds a little charge
        # cheeks catch the light; only a sliver of the mouth cavity shows between snout and jaw
        r.px(0, 5, fur, 5); r.px(9, 5, fur, 5)
        r.rect(3, 7, 4, 1, SHADOW, 1)
        r.darken_noise(0.25, -1, bottom=0.6)
        r.speck(IRON, 3, 0.04)  # bald spots: the shell shows through

    def skull_side(r):
        fur_panel('fur', 3, 0.35)(r)
        if r.face in ('east', 'west'):
            for rr in range(1, r.h - 1, 2):
                r.px(r.w // 2, rr, CAST[r.variant]['fur'], 1)  # seam stitches
            r.stain(IRON, 2, r.w * 0.7, r.h * 0.3, 1.2, 1.0, p=0.7)  # torn fur, metal underneath

    def skull_top(r):
        fur_panel('fur', 4, 0.2)(r)
        r.speck(GRIME, 3, 0.15)  # dust settled on top

    def snout(r):
        m = CAST[r.variant]['muz']
        r.fill(m, 3, amp=0.5, white_amp=0.5, cell=2)
        r.bevel(1, -1)
        if r.face == 'north' and r.variant not in ('purple_rat',):
            for c in range(r.w):
                r.px(c, r.h - 1, TEETH, 4 if c % 2 else 3)  # upper teeth along the lip
            r.px(r.w // 2, r.h - 1, SHADOW, 1)  # a missing tooth
        if r.face == 'up':
            r.speck(GRIME, 2, 0.2)
        r.darken_noise(0.2, -1)

    def jaw(r):
        m = CAST[r.variant]['muz']
        r.fill(m, 2, amp=0.5, white_amp=0.5, cell=2)
        if r.face == 'north':
            for c in range(r.w):
                r.px(c, 0, TEETH, 4 if (c + 1) % 2 else 2)
        if r.face == 'up':
            r.fill(SHADOW, 1)
            for c in range(r.w):
                r.px(c, r.h - 1, TEETH, 3)
        r.darken_noise(0.3, -1)

    def nose(r):
        r.fill(BLACK, 2, amp=0.3)
        r.px(0, 0, BLACK, 5)

    def neck(r):
        r.fill(IRON, 2, amp=0.5)
        r.speck(RUST, 2, 0.15)
        if r.face == 'down':
            r.fill(SHADOW, 0)

    def ear(r):
        ch = CAST[r.variant]
        r.fill(ch['fur'], 3, amp=0.5, white_amp=0.5, cell=2)
        if r.face == 'north':
            inner = PINK if ch['inner'] == 'pink' else ch['muz']
            r.rect(1, 1, max(1, r.w - 2), max(1, r.h - 2), inner, 2)
            r.px(1, 1, inner, 3)
        r.bevel(1, -1)
        r.darken_noise(0.25, -1)

    def torn_end(r):
        r.fill(SHADOW, 1)
        r.speck(FIBER, 3, 0.3)  # stuffing
        r.px(0, 0, WIRE_RED, 2)

    def hat(r):
        if r.variant == 'noxbriar':
            r.fill(BLACK, 3, amp=0.4)
            if r.face in ('north', 'south', 'east', 'west') and r.h > 2:
                r.hline(0, r.h - 2, r.w, VIOLET, 3)
        else:
            r.fill(HAT_RED, 4, amp=0.4)
            if r.face in ('north', 'south', 'east', 'west') and r.h > 2:
                r.hline(0, r.h - 2, r.w, BLACK, 2)
        r.bevel(1, -1)
        r.speck(GRIME, 2, 0.1)

    def wire(m):
        return lambda r: (r.fill(m, 2, amp=0.4), r.px(0, 0, m, m.n - 1))

    g.box(bone, o(-3, 0, -2.5), o(3, 1.5, 3.5), {'sides': Face(neck, 'neck'), 'down': Face(neck, 'neckd')})
    g.box(bone, o(-5, 1, -4), o(5, 10, 5), {'north': face, 'east': Face(skull_side, 'hs'), 'west': Face(skull_side, 'hs'),
                                            'south': Face(fur_panel('fur', 2, 0.3), 'hb'), 'up': Face(skull_top, 'ht'),
                                            'down': Face(fur_panel('fur', 1, 0), 'hd')})
    g.box(bone, o(-3, 3, -6.5), o(3, 5.5, -4), {'north': Face(snout, 'sn'), 'east': Face(snout, 'ss'), 'west': Face(snout, 'ss'),
                                                'up': Face(snout, 'su'), 'down': Face(jaw, 'sd')})
    g.box(bone, o(-2.5, 1, -5.5), o(2.5, 2.5, -4), {'north': Face(jaw, 'jn'), 'east': Face(jaw, 'js'), 'west': Face(jaw, 'js'),
                                                    'up': Face(jaw, 'ju'), 'down': Face(jaw, 'jd')})
    g.box(bone, o(-1, 4.5, -7), o(1, 5.5, -6.5), {'north': Face(nose, 'nn'), 'sides': Face(nose, 'ns'), 'ends': Face(nose, 'ne')})
    # cables trailing out of the neck along the shelf
    g.box(bone, o(-1.5, 0, 3.5), o(-1, 0.4, 5.5), {'sides': Face(wire(WIRE_RED), 'w1'), 'up': Face(wire(WIRE_RED), 'w1u')})
    g.box(bone, o(0.5, 0, 3.5), o(1, 0.4, 5.2), {'sides': Face(wire(BLACK), 'w2'), 'up': Face(wire(BLACK), 'w2u')})
    if ears:
        for sx in (-1, 1):
            a, b = (-5.5, -2.5) if sx < 0 else (2.5, 5.5)
            g.box(f'{bone}_bear', o(a, 8.5, 0.5), o(b, 11.5, 2), {'north': Face(ear, 'eb'), 'south': Face(ear, 'ebb'), 'sides': Face(ear, 'ebs'),
                                                                 'ends': Face(ear, 'ebt')})
            a, b = (-6.25, -2.5) if sx < 0 else (2.5, 6.25)
            g.box(f'{bone}_rat', o(a, 8, 1), o(b, 12, 2), {'north': Face(ear, 'er'), 'south': Face(ear, 'erb'), 'sides': Face(ear, 'ers'),
                                                          'ends': Face(ear, 'ert')})
            for k, (w, y, h) in enumerate(((3, 8.5, 1.5), (2, 10, 1.5), (1, 11.5, 1))):
                c0 = -4.5 if sx < 0 else 4.5 - w
                c0 += 0.0 if k == 0 else (0.5 * k if sx < 0 else -0.5 * k)
                g.box(f'{bone}_cat', o(c0, y, 0), o(c0 + w, y + h, 1.5), {'north': Face(ear, f'ec{k}'), 'south': Face(ear, f'ecb{k}'),
                                                                         'sides': Face(ear, f'ecs{k}'), 'ends': Face(ear, f'ect{k}')})
        # rabbit: one ear torn off to a stub, the other bent over at the base
        g.box(f'{bone}_rabbit', o(-4, 9.5, 0.5), o(-1.5, 12.5, 2), {'north': Face(ear, 'ea'), 'south': Face(ear, 'eab'), 'sides': Face(ear, 'eas'),
                                                                   'ends': Face(torn_end, 'eat')})
        g.bone(f'{bone}_rabbit_bent', pivot=o(2.75, 9.5, 1.25), rotation=(0, 0, -45))
        g.box(f'{bone}_rabbit_bent', o(1.5, 9.5, 0.5), o(3.75, 12.5, 2), {'north': Face(ear, 'ea2'), 'south': Face(ear, 'eab2'), 'sides': Face(ear, 'eas2'),
                                                                      'ends': Face(ear, 'eat2')})
    if hats:
        g.box(f'{bone}_hat_rustgrin', o(-2.5, 10, -1.5), o(2.5, 10.5, 2.5), {'sides': Face(hat, 'hb1'), 'ends': Face(hat, 'hb1t')})
        g.box(f'{bone}_hat_rustgrin', o(-1.5, 10.5, -0.5), o(1.5, 12.75, 1.5), {'sides': Face(hat, 'hc1'), 'ends': Face(hat, 'hc1t')})
        g.box(f'{bone}_hat_noxbriar', o(-3, 10, -2), o(3, 10.5, 3), {'sides': Face(hat, 'hb2'), 'ends': Face(hat, 'hb2t')})
        g.box(f'{bone}_hat_noxbriar', o(-2, 10.5, -1), o(2, 12.75, 2), {'sides': Face(hat, 'hc2'), 'ends': Face(hat, 'hc2t')})
    if rat_teeth:
        g.box(f'{bone}_teeth', o(-1, 2, -6.75), o(1, 3, -6.5), {'north': Face(lambda r: (r.fill(TEETH, 4), r.px(1, 0, TEETH, 2)), 'bt'),
                                                                 'sides': Face(lambda r: r.fill(TEETH, 3), 'bts')})


def _char_bones(bone, ch):
    c = CAST[ch]
    bones = [bone]
    bones += {'bear': [f'{bone}_bear'], 'rabbit': [f'{bone}_rabbit', f'{bone}_rabbit_bent'], 'cat': [f'{bone}_cat'], 'rat': [f'{bone}_rat']}[c['ear']]
    if c['hat']:
        bones.append(f'{bone}_hat_{c["hat"]}')
    if ch == 'purple_rat':
        bones.append(f'{bone}_teeth')
    return bones


@prop
def spare_head(out):
    g = Geo('spare_head', 64, 64)
    _head_parts(g, 'head')
    variants = {}
    for i, ch in enumerate(HEAD_CHARS):
        ident = 'geometry.fnar.spare_head' if i == 0 else f'geometry.fnar.spare_head_{ch}'
        variants[ident] = (_char_bones('head', ch), (0, 0, 0))
    out.geo(g, variants)
    perms = []
    for i, ch in enumerate(HEAD_CHARS):
        out.tex(f'spare_head_{ch}', g.paint(ch))
        comps = {'minecraft:material_instances': mi_set(f'spare_head_{ch}')}
        if i:
            comps['minecraft:geometry'] = f'geometry.fnar.spare_head_{ch}'
        perms.append((bs('fnar:char', i), comps))
    blk = block_json('spare_head', geometry='geometry.fnar.spare_head', materials=mi_set('spare_head_rustgrin'),
                     states={'fnar:char': {'values': {'min': 0, 'max': len(HEAD_CHARS) - 1}}},
                     collision=box(-6.25, 0, -7, 6.25, 12.5, 7.25), selection=box(-7.8, 0, -7.75, 7.8, 16, 7.9), map_color='#58544f', destroy=1.0,
                     perms=perms)
    out.block('spare_head', blk)
    f = {'focus': [0, 0.4, 0], 'dist': 1.5, 'dir': [0.55, 0.3, -1]}
    out.views('spare_head', [{'label': f'char {i} {ch}', 'states': {'fnar:char': i}, **f} for i, ch in enumerate(HEAD_CHARS)])


# =============================================================== endoskeleton parts
ENDO_PARTS = ['skull', 'arm', 'stand']


def _endo_skull(g, bone, x0=0.0, y0=0.0, z0=0.0, tilt=None):
    """Endoskull, 9 x 7 x 7 px, jaw at y0; `tilt` rolls it about its own centre."""
    o = lambda x, y, z: (x + x0, y + y0, z + z0)

    def plate(base=3):
        def p(r):
            r.fill(IRON, base, amp=0.6, white_amp=0.5)
            r.bevel(1, -1)
            r.speck(CHROME, 3, 0.12)
            r.speck(RUST, 2, 0.1)
            r.darken_noise(0.2, -1, bottom=0.4)
        return p

    def face(r):
        plate(3)(r)
        r.hline(0, 0, r.w, IRON, 5)  # brow ridge
        r.rect(1, 1, r.w - 2, 2, SHADOW, 1)  # deep sockets behind the eyeballs
        r.rect(2, r.h - 2, r.w - 4, 1, SHADOW, 0)

    def eye(r):
        r.fill(EYEBALL, 3, amp=0.4, white_amp=0.3)
        if r.face == 'north':
            r.px(0, 0, EYEBALL, 4)
            r.px(1, 1, BLACK, 1)  # pupil, staring a little to one side
            r.px(1, 0, IRON, 2)  # half-lidded
            r.px(0, 1, EYEBALL, 2)

    def teeth(r):
        r.fill(TEETH, 3, amp=0.3)
        if r.face == 'north':
            for c in range(1, r.w, 2):
                r.px(c, 0, SHADOW, 1)
        r.speck(GRIME, 2, 0.15)

    def servo(r):
        r.fill(CHROME, 3, amp=0.4)
        r.px(0, 0, CHROME, 5)
        r.speck(RUST, 2, 0.2)

    if tilt:
        g.bone(bone, pivot=o(0, 4, 0.5), rotation=tilt)
    g.box(bone, o(-3.5, 2, -2.5), o(3.5, 7, 3.5), {'north': face, 'sides': Face(plate(3), 'sk'), 'up': Face(plate(4), 'sku'),
                                                  'south': Face(plate(2), 'skb'), 'down': Face(plate(1), 'skd')})
    for xa in (-3, 0.5):
        g.box(bone, o(xa, 4, -3.25), o(xa + 2.5, 6, -1.75), {'north': Face(eye, 'en'), 'sides': Face(eye, 'es'), 'ends': Face(eye, 'ee')})
    g.box(bone, o(-2.5, 1.5, -3.5), o(2.5, 2.5, -1.5), {'north': Face(teeth, 'tu'), 'sides': Face(teeth, 'tus'), 'ends': Face(teeth, 'tue')})
    g.box(bone, o(-2.5, 0, -3.5), o(2.5, 1, 0), {'north': Face(teeth, 'tl'), 'sides': Face(plate(2), 'jl'), 'up': Face(teeth, 'tlu'),
                                                'down': Face(plate(1), 'jd')})
    for xa in (-4.5, 3.5):
        g.box(bone, o(xa, 3.5, -0.5), o(xa + 1, 5.5, 1.5), {'sides': Face(servo, 'sv'), 'ends': Face(servo, 'sve')})


@prop
def endo_parts(out):
    g = Geo('endo_parts', 64, 64)

    def rod(m=STEEL, base=3):
        def p(r):
            r.fill(m, base, amp=0.4, streak='v' if r.face not in ('up', 'down') else None)
            r.speck(RUST, 2, 0.12)
        return p

    def joint(r):
        r.fill(CHROME, 3, amp=0.4)
        r.bevel(1, -1)
        r.px(r.w // 2, r.h // 2, IRON, 1)
        r.speck(RUST, 2, 0.15)

    def plate(base=3):
        def p(r):
            r.fill(IRON, base, amp=0.6, white_amp=0.5)
            r.bevel(1, -1)
            r.speck(CHROME, 3, 0.1)
            r.speck(RUST, 2, 0.12)
        return p

    def finger(r):
        r.fill(IRON, 3, amp=0.3)
        if r.face == 'up':
            for c in range(0, r.w, 2):
                r.px(c, 0, CHROME, 4)

    def wire(m):
        return lambda r: (r.fill(m, 2, amp=0.4), r.px(0, 0, m, m.n - 1))

    # ---- 0: an endoskull on its own, staring
    _endo_skull(g, 'skull', 0, 0, 0)
    g.box('skull', (-1, 0, 3.5), (-0.5, 0.5, 7.5), {'sides': Face(wire(WIRE_RED), 'sw1'), 'up': Face(wire(WIRE_RED), 'sw1u')})
    g.box('skull', (0.5, 0, 3.5), (1, 0.5, 6), {'sides': Face(wire(WIRE_YEL), 'sw2'), 'up': Face(wire(WIRE_YEL), 'sw2u')})

    # ---- 1: a forearm and hand lying on the bench, fingers half curled
    g.bone('arm', pivot=(0, 0, 0), rotation=(0, 22.5, 0))
    g.box('arm', (-0.5, 0.5, 1), (0.5, 1.5, 7.5), {'sides': Face(rod(), 'ar1'), 'ends': Face(rod(), 'ar1e')})
    g.box('arm', (-2, 0.5, 1.5), (-1.25, 1.25, 7), {'sides': Face(rod(CHROME, 3), 'ar2'), 'ends': Face(rod(CHROME), 'ar2e')})
    g.box('arm', (-1.5, 0, 6.5), (1.5, 2, 8), {'sides': Face(joint, 'elb'), 'ends': Face(joint, 'elbe')})
    g.box('arm', (-1.5, 0, -1), (1.5, 2, 1), {'sides': Face(joint, 'wr'), 'ends': Face(joint, 'wre')})
    g.box('arm', (-2.5, 0, -4.5), (2.5, 1, -1), {'north': Face(plate(3), 'pn'), 'sides': Face(plate(3), 'ps'), 'up': Face(plate(4), 'pu'),
                                                'down': Face(plate(1), 'pd')})
    for k in range(4):
        x = -2.4 + k * 1.3
        g.box('arm', (x, 0, -7 + (k % 2) * 0.75), (x + 0.8, 0.8, -4.5), {'sides': Face(finger, 'fg'), 'up': Face(finger, 'fgu'), 'north': Face(joint, 'fgt')})
    g.box('arm', (2.5, 0, -3.5), (4.5, 0.8, -2.7), {'sides': Face(finger, 'th'), 'up': Face(finger, 'thu')})
    g.box('arm', (0.25, 0, 7.75), (0.75, 0.5, 8), {'sides': Face(wire(WIRE_RED), 'aw')})

    # ---- 2: a headless-no-more endoskeleton bust on a repair stand
    def base(r):
        r.fill(STEEL, 2, amp=0.5)
        r.bevel(1, -1)
        r.speck(RUST, 2, 0.15)
        r.darken_noise(0.3, -1)

    g.box('stand', (-4, 0, -4), (4, 1, 4), {'sides': Face(base, 'b'), 'up': Face(base, 'bu'), 'down': Face(base, 'bd')})
    g.box('stand', (-0.75, 1, -0.75), (0.75, 3.5, 0.75), {'sides': Face(rod(STEEL, 2), 'pole')})
    g.box('stand', (-3, 3.5, -1.5), (3, 4.75, 1.5), {'sides': Face(plate(2), 'hip'), 'ends': Face(plate(3), 'hipe')})
    g.box('stand', (-0.75, 4.75, 0), (0.75, 8, 1.5), {'sides': Face(rod(CHROME, 2), 'spine')})
    for y in (5.25, 6.25, 7.25):
        g.box('stand', (-3.5, y, -1.5), (3.5, y + 0.6, 1.75), {'north': Face(rod(STEEL, 3), 'rib'), 'sides': Face(rod(STEEL), 'ribs'),
                                                              'ends': Face(rod(STEEL), 'ribe')})
    g.box('stand', (-5.5, 7.5, -0.5), (5.5, 8.5, 1), {'sides': Face(rod(STEEL, 3), 'sh'), 'ends': Face(rod(STEEL), 'she')})
    for sx in (-1, 1):
        x0 = -5.5 if sx < 0 else 4
        g.box('stand', (x0, 4, -0.25), (x0 + 1.5, 7.5, 0.75), {'sides': Face(rod(STEEL, 2), 'ua'), 'ends': Face(joint, 'uae')})
    g.box('stand', (-1.5, 6, 1.75), (-1, 6.5, 2.5), {'sides': Face(wire(WIRE_RED), 'cw1')})
    g.box('stand', (0.5, 4.5, 1.75), (1, 8, 2.25), {'sides': Face(wire(WIRE_YEL), 'cw2')})
    _endo_skull(g, 'stand_head', 0, 7.75, -0.5, tilt=(0, 0, 22.5))
    out.geo(g, {'geometry.fnar.endo_parts': (['skull'], (0, 0, 0)), 'geometry.fnar.endo_parts_arm': (['arm'], (0, 0, 0)),
                'geometry.fnar.endo_parts_stand': (['stand', 'stand_head'], (0, 0, 0))})
    out.tex('endo_parts', g.paint())
    perms = [(bs('fnar:part', 1), {'minecraft:geometry': 'geometry.fnar.endo_parts_arm', 'minecraft:selection_box': box(-6, 0, -8, 6, 2, 8),
                                   'minecraft:collision_box': False}),
             (bs('fnar:part', 2), {'minecraft:geometry': 'geometry.fnar.endo_parts_stand', 'minecraft:selection_box': box(-6, 0, -4, 6, 16, 4),
                                   'minecraft:collision_box': box(-4, 0, -4, 4, 16, 4)})]
    blk = block_json('endo_parts', geometry='geometry.fnar.endo_parts', materials=mi_set('endo_parts'),
                     states={'fnar:part': {'values': {'min': 0, 'max': 2}}},
                     collision=False, selection=box(-4.5, 0, -4, 4.5, 7, 7.5), map_color='#363b42', destroy=1.5, perms=perms)
    out.block('endo_parts', blk)
    f = {'focus': [0, 0.25, 0], 'dist': 1.3, 'dir': [0.55, 0.45, -1]}
    out.views('endo_parts', [{'label': 'skull', 'states': {'fnar:part': 0}, **f}, {'label': 'arm', 'states': {'fnar:part': 1}, **f},
                             {'label': 'stand', 'states': {'fnar:part': 2}, 'focus': [0, 0.55, 0], 'dist': 2.0, 'dir': [0.55, 0.3, -1]}])


# =============================================================== an empty costume slumped against the wall
SUIT_CHARS = ['rustgrin', 'mirehop']


@prop
def slumped_suit(out):
    g = Geo('slumped_suit', 64, 64)

    def fur(base=3, grime=0.35):
        return fur_panel('fur', base, grime)

    def belly(r):
        ch = CAST[r.variant]
        fur(3)(r)
        r.rect(2, 2, r.w - 4, r.h - 3, ch['muz'], 2)
        r.darken_noise(0.3, -1, bottom=0.5)
        # bow tie at the collar and a split seam with the dark empty inside showing
        r.rect(r.w // 2 - 2, 0, 4, 1, HAT_RED, 3)
        r.px(r.w // 2 - 1, 0, HAT_RED, 1); r.px(r.w // 2, 0, HAT_RED, 1)
        for rr in range(3, r.h - 2):
            r.px(r.w // 2 + (rr % 2), rr, SHADOW, 0)
        r.px(r.w // 2 + 1, r.h - 3, WIRE_RED, 2)

    def paw(r):
        ch = CAST[r.variant]
        fur(2)(r)
        if r.face == 'north':
            r.rect(1, 1, max(1, r.w - 2), max(1, r.h - 2), ch['muz'], 1)
            r.px(1, 1, BLACK, 2); r.px(r.w - 2, 1, BLACK, 2)
        r.darken_noise(0.4, -1)

    def head_face(r):
        ch = CAST[r.variant]
        r.fill(ch['fur'], 3, amp=0.6, white_amp=0.6, cell=2)
        r.bevel(1, -1)
        for (cx, cy) in ((1, 2), (5, 2)):
            r.rect(cx, cy, 2, 2, SHADOW, 0)  # empty sockets: there is nobody inside
        r.hline(1, 1, 2, ch['fur'], 0); r.hline(5, 1, 2, ch['fur'], 0)
        r.darken_noise(0.25, -1)

    def snout(r):
        ch = CAST[r.variant]
        r.fill(ch['muz'], 3, amp=0.5, white_amp=0.5, cell=2)
        r.bevel(1, -1)
        if r.face == 'north':
            r.px(r.w // 2 - 1, 0, BLACK, 2); r.px(r.w // 2, 0, BLACK, 1)
            for c in range(r.w):
                r.px(c, r.h - 1, TEETH, 3 if c % 2 else 1)
        r.darken_noise(0.25, -1)

    def ear(r):
        ch = CAST[r.variant]
        r.fill(ch['fur'], 3, amp=0.5, white_amp=0.5, cell=2)
        if r.face == 'north':
            r.rect(1, 1, max(1, r.w - 2), max(1, r.h - 2), ch['muz'], 2)
        r.darken_noise(0.25, -1)

    def collar(r):
        r.fill(SHADOW, 0)
        r.speck(WIRE_RED, 2, 0.15)
        r.speck(IRON, 3, 0.1)

    # body: sitting on the floor, back against the wall
    g.box('body', (-4.5, 0, 1), (4.5, 3.5, 7.5), {'north': Face(fur(2), 'sn'), 'sides': Face(fur(3), 'ss'), 'up': Face(fur(3), 'su'),
                                                  'south': Face(fur(1), 'sb'), 'down': Face(fur(1), 'sd')})
    g.box('body', (-5, 3.5, 2.5), (5, 9, 7.5), {'north': belly, 'east': Face(fur(3), 'ts'), 'west': Face(fur(3), 'ts'),
                                                 'south': Face(fur(1), 'tb'), 'up': Face(fur(4), 'tu')})
    g.box('body', (-2.5, 9, 3.5), (2.5, 9.5, 6.5), {'up': Face(collar, 'col'), 'sides': Face(fur(2), 'cols')})
    for sx in (-1, 1):
        x0 = -4.5 if sx < 0 else 0.5
        g.box('body', (x0, 0, -4), (x0 + 4, 3.5, 1), {'sides': Face(fur(3), 'thigh'), 'up': Face(fur(4), 'thighu'), 'north': Face(fur(2), 'thighn')})
    # feet, toes up; the right one fallen outward
    g.box('body', (-4.5, 0, -7), (-0.5, 4.5, -4), {'north': Face(paw, 'pawn'), 'sides': Face(fur(3), 'paws'), 'up': Face(fur(3), 'pawu')})
    g.bone('foot_r', pivot=(2.5, 0, -4), rotation=(0, -22.5, 0))
    g.box('foot_r', (0.5, 0, -7), (4.5, 4.5, -4), {'north': Face(paw, 'pawn'), 'sides': Face(fur(3), 'paws'), 'up': Face(fur(3), 'pawu')})
    # arms hanging down, paws on the floor
    for sx in (-1, 1):
        x0 = -7 if sx < 0 else 5
        g.box('body', (x0, 1.5, 3), (x0 + 2, 8.5, 6), {'sides': Face(fur(3), 'arm'), 'up': Face(fur(4), 'armu')})
        g.box('body', (x0, 0, 1.5), (x0 + 2, 1.5, 5.5), {'north': Face(paw, 'hpn'), 'sides': Face(fur(2), 'hps'),
                                                                                          'up': Face(fur(3), 'hpu')})
    # the head has dropped forward and to one side
    g.bone('head', pivot=(0, 9, 5), rotation=(-22.5, 0, 0))
    g.bone('headroll', pivot=(0, 9, 5), rotation=(0, 0, 22.5), parent='head')
    g.box('headroll', (-4, 9, 1.5), (4, 14.5, 7), {'north': head_face, 'east': Face(fur(3), 'hs'), 'west': Face(fur(3), 'hs'), 'up': Face(fur(4), 'hu'),
                                                'south': Face(fur(2), 'hb'), 'down': Face(collar, 'hd')})
    g.box('headroll', (-2.5, 9.5, -0.5), (2.5, 12, 1.5), {'north': Face(snout, 'mn'), 'sides': Face(snout, 'ms'), 'up': Face(snout, 'mu'), 'down': Face(snout, 'md')})
    # bear ears (the grey suit) / flopped rabbit ears lying back against the wall (the green suit)
    g.bone('ears_bear', pivot=(0, 9, 5), parent='headroll')
    for sx in (-1, 1):
        a, b = (-4.5, -2) if sx < 0 else (2, 4.5)
        g.box('ears_bear', (a, 13, 3.5), (b, 15, 5), {'north': Face(ear, 'eb'), 'south': Face(ear, 'ebb'), 'sides': Face(ear, 'ebs'), 'ends': Face(ear, 'ebt')})
        a, b = (-3.5, -1) if sx < 0 else (1, 3.5)
        g.box('ears_rabbit', (a, 7, 7), (b, 14, 8), {'north': Face(ear, 'er'), 'south': Face(ear, 'erb'), 'sides': Face(ear, 'ers'), 'ends': Face(ear, 'ert')})
    out.geo(g, {'geometry.fnar.slumped_suit': (['body', 'foot_r', 'head', 'headroll', 'ears_bear'], (0, 0, 0)),
                'geometry.fnar.slumped_suit_mirehop': (['body', 'foot_r', 'head', 'headroll', 'ears_rabbit'], (0, 0, 0))})
    perms = []
    for i, ch in enumerate(SUIT_CHARS):
        out.tex(f'slumped_suit_{ch}', g.paint(ch))
        comps = {'minecraft:material_instances': mi_set(f'slumped_suit_{ch}')}
        if i:
            comps['minecraft:geometry'] = f'geometry.fnar.slumped_suit_{ch}'
        perms.append((bs('fnar:char', i), comps))
    blk = block_json('slumped_suit', geometry='geometry.fnar.slumped_suit', materials=mi_set('slumped_suit_rustgrin'),
                     states={'fnar:char': {'values': {'min': 0, 'max': len(SUIT_CHARS) - 1}}},
                     collision=box(-7, 0, -7, 7, 10, 8), selection=box(-7, 0, -7, 7, 16, 8), map_color='#58544f', destroy=2.0, perms=perms)
    out.block('slumped_suit', blk)
    f = {'env': 'wall', 'focus': [0, 0.45, 0.1], 'dist': 2.2, 'dir': [0.55, 0.35, -1]}
    out.views('slumped_suit', [{'label': f'char {i} {ch}', 'states': {'fnar:char': i}, **f} for i, ch in enumerate(SUIT_CHARS)]
              + [{'label': 'facing east', 'env': 'wall', 'states': {'fnar:char': 1, 'minecraft:cardinal_direction': 'east'}, **f,
                  'focus': [-0.1, 0.45, 0], 'dir': [1, 0.35, -0.5]}])


# =============================================================== the last birthday cake
@prop
def birthday_cake(out):
    g = Geo('birthday_cake', 32, 32)

    def board(r):
        r.fill(FOIL, 3, amp=0.5, white_amp=0.4)
        if r.face == 'up':
            for c in range(r.w):
                for rr in range(r.h):
                    if (c * 3 + rr) % 5 == 0:
                        r.shift(c, rr, 1)  # crinkled foil
            r.speck(ICING, 4, 0.05)
            r.stain(GRIME, 2, 3, 9.5, 1.6, 1.2, p=0.6)

    def side(r):
        r.fill(ICING, 4, amp=0.3, white_amp=0.3)
        # piped pink border on top, drips running down
        r.hline(0, 0, r.w, ICING_PINK, 3)
        for c in range(0, r.w, 3):
            r.px(c, 1, ICING_PINK, 2)
            if c % 2 == 0:
                r.px(c, 2, ICING_PINK, 1)
        r.hline(0, r.h - 1, r.w, ICING, 2)
        r.darken_noise(0.25, -1, bottom=0.5)

    def cut(r):  # the inside where a slice was taken: sponge layers with jam
        r.fill(SPONGE, 3, amp=0.6, white_amp=0.6, cell=1)
        r.hline(0, 0, r.w, ICING, 4)
        r.hline(0, r.h // 2, r.w, JAM, 1)
        r.darken_noise(0.2, -1)

    def top(r):
        r.fill(ICING, 4, amp=0.3, white_amp=0.3)
        for c in range(r.w):
            for rr in range(r.h):
                if c in (0, r.w - 1) or rr in (0, r.h - 1):
                    if (c + rr) % 2 == 0:
                        r.px(c, rr, ICING_PINK, 3)  # rosettes
        r.speck(WAX_P, 2, 0.06)  # wax drips
        r.speck(GRIME, 2, 0.05)  # dust: nobody has touched it for days

    def candle(m):
        def p(r):
            r.fill(m, 2, amp=0.3)
            if r.face != 'up':
                for rr in range(r.h):
                    if rr % 2 == 0:
                        r.px(0, rr, ICING, 4)  # striped candle
            else:
                r.fill(m, 3)
                r.px(0, 0, BLACK, 1)  # burnt wick
        return p

    def flame(r):
        if r.variant == 'out':
            r.clear()
            return
        r.fill(FLAME, 3, amp=0.2)
        if r.face in ('north', 'south', 'east', 'west'):
            r.px(0, r.h - 1, FLAME, 1)
            r.px(0, 0, FLAME, 4)

    def wick(r):
        r.fill(BLACK, 1)

    g.box('cake', (-6, 0, -6), (6, 0.5, 6), {'up': Face(board, 'bu'), 'sides': Face(board, 'bs'), 'down': Face(board, 'bd')})
    # a cake with one slice taken from its front-right quarter
    g.box('cake', (-4, 0.5, -1), (4, 4.5, 4), {'north': Face(cut, 'cut1'), 'south': Face(side, 'sideS'), 'west': Face(side, 'sideW'),
                                              'east': Face(side, 'sideE'), 'up': Face(top, 'top1')})
    g.box('cake', (-4, 0.5, -4), (0, 4.5, -1), {'north': Face(side, 'sideN'), 'east': Face(cut, 'cut2'), 'west': Face(side, 'sideW2'),
                                               'up': Face(top, 'top2')})
    for (x, z, m, h) in ((-3, 2, WAX, 2.0), (2, 2.5, WAX_Y, 1.5), (-2.5, -3, WAX, 1.0)):
        g.box('cake', (x, 4.5, z), (x + 0.75, 4.5 + h, z + 0.75), {'sides': Face(candle(m), f'c{m.name}{h}'), 'up': Face(candle(m), f'cu{m.name}')})
    # one candle knocked over on the icing
    g.box('cake', (0.5, 4.5, 0), (3.5, 5.25, 0.75), {'sides': Face(candle(WAX_P), 'cfall'), 'ends': Face(candle(WAX_P), 'cfalle')})
    # the one still burning
    g.box('cake', (-1, 4.5, 0.5), (-0.25, 7.5, 1.25), {'sides': Face(candle(WAX_P), 'clit'), 'up': Face(wick, 'clitu')})
    g.box('cake', (-0.875, 7.5, 0.625), (-0.375, 9, 1.125), {'sides': Face(flame, 'fl', mi='flame'), 'up': Face(flame, 'flu', mi='flame')})
    out.geo(g)
    out.tex('birthday_cake', g.paint('lit'))
    out.tex('birthday_cake_out', g.paint('out'))
    lit = mi_set('birthday_cake', {'flame': glow('birthday_cake')})
    dark = mi_set('birthday_cake_out', {'flame': {'texture': 'fnar_birthday_cake_out', 'render_method': 'alpha_test'}})
    blk = block_json('birthday_cake', geometry='geometry.fnar.birthday_cake', materials=lit,
                     states={'fnar:lit': [True, False]},
                     collision=False, selection=box(-6, 0, -6, 6, 9, 6), map_color='#c4bcae', destroy=0.5, light=4,
                     perms=[(bs('fnar:lit', False), {'minecraft:material_instances': dark, 'minecraft:light_emission': 0})])
    out.block('birthday_cake', blk)
    out.light('birthday_cake', '#ffb867', 'point_light')
    f = {'focus': [0, 0.3, 0], 'dist': 1.3, 'dir': [0.6, 0.6, -1]}
    out.views('birthday_cake', [{'label': 'lit', 'states': {'fnar:lit': True}, **f}, {'label': 'out', 'states': {'fnar:lit': False}, **f},
                                {'label': 'lit, facing south', 'states': {'fnar:lit': True, 'minecraft:cardinal_direction': 'south'}, **f}])


# =============================================================== a party chair knocked over on its back
def _tip(frm, to):
    """The upright party chair's box, tipped over backwards: up -> south, north -> up."""
    (x0, y0, z0), (x1, y1, z1) = frm, to
    return (x0, -z1 + 5.5, y0 - 7.75), (x1, -z0 + 5.5, y1 - 7.75)


TIP_FACE = {'up': 'south', 'down': 'north', 'north': 'up', 'south': 'down', 'east': 'east', 'west': 'west'}


@prop
def fallen_chair(out):
    g = Geo('fallen_chair', 32, 32)
    plastic = lambda base=3, grime=0.3: panel(RED, base, amp=0.5, white_amp=0.3, grime=grime)

    def seat_top(r):
        plastic(4, 0.2)(r)
        r.bevel(1, -1)
        r.shade_rect(2, 2, r.w - 4, r.h - 4, -1)
        r.stain(GRIME, 2, 3, 6.5, 1.3, 1.0, p=0.8)
        r.speck(RED, 1, 0.06)

    def back_front(r):
        plastic(3, 0.15)(r)
        r.bevel(1, -1)
        r.rect(3, 1, 4, 1, RED, 1)
        r.speck(GRIME, 3, 0.1)  # floor dust on the side it landed on

    tube = Face(panel(CHROME, 3, amp=0.4, streak='v', grime=0.3, bevel=None), 'tube')
    cap = Face(panel(BLACK, 1, bevel=None), 'cap')

    def add(bone, frm, to, faces):
        f2, t2 = _tip(frm, to)
        mapped = {}
        for k, v in faces.items():
            if k in ('sides', 'ends', '*'):
                mapped[k] = v
            else:
                mapped[TIP_FACE[k]] = v
        g.box(bone, f2, t2, mapped)

    for x in (-5, 4):
        for z in (-5, 4):
            add('legs', (x, 0.5, z), (x + 1, 7, z + 1), {'north': tube, 'south': tube, 'east': tube, 'west': tube})
            add('legs', (x, 0, z), (x + 1, 0.5, z + 1), {'north': cap, 'south': cap, 'east': cap, 'west': cap, 'down': cap})
    add('seat', (-5.5, 7, -5.5), (5.5, 8, 5), {'up': seat_top, 'down': plastic(1), 'north': Face(plastic(3), 'se'), 'south': Face(plastic(3), 'se2'),
                                               'east': Face(plastic(3), 'ss'), 'west': Face(plastic(3), 'ss')})
    for x in (-4.5, 3.5):
        add('back', (x, 8, 4.25), (x + 1, 10.5, 5.25), {'north': Face(panel(CHROME, 3, bevel=None), 'post'), 'south': Face(panel(CHROME, 3, bevel=None), 'post'),
                                                       'east': Face(panel(CHROME, 3, bevel=None), 'post2'), 'west': Face(panel(CHROME, 3, bevel=None), 'post2')})
    add('back', (-5.5, 10.5, 4), (5.5, 15.5, 5.5), {'north': back_front, 'south': plastic(2, 0.4), 'east': Face(plastic(3), 'be'),
                                                    'west': Face(plastic(3), 'be'), 'up': plastic(4), 'down': plastic(1)})
    out.geo(g)
    out.tex('fallen_chair', g.paint())
    blk = block_json('fallen_chair', geometry='geometry.fnar.fallen_chair', materials=mi_set('fallen_chair'),
                     collision=box(-5.5, 0, -8, 5.5, 3, 8), selection=box(-5.5, 0, -8, 5.5, 11, 8), map_color='#731c1b', destroy=1.0)
    out.block('fallen_chair', blk)
    f = {'focus': [0, 0.3, 0], 'dist': 1.9, 'dir': [0.8, 0.6, -1]}
    out.views('fallen_chair', [{'label': 'north', **f}, {'label': 'facing east', 'states': {'minecraft:cardinal_direction': 'east'}, **f}])


# =============================================================== floor decals
DECALS = ['tickets', 'tickets_b', 'confetti', 'puddle', 'prints', 'prints_faint', 'debris', 'drag']


def _ticket(r, x, y, w, h, seed=0, stub=False):
    """An ADMIT ONE ticket: faded red card, a light border dot row, the tear on one end."""
    for yy in range(h):
        for xx in range(w):
            edge = xx in (0, w - 1) or yy in (0, h - 1)
            r.px(x + xx, y + yy, TICKET, 2 if edge else 3)
    horiz = w >= h
    if horiz:
        for xx in range(1, w - 1, 2):
            r.px(x + xx, y + h // 2, TICKET_INK, 0)  # "ADMIT ONE" at this size: a dotted line of print
        tx = x + (w - 1 if not stub else 0)
        for yy in range(h):
            if (yy + seed) % 2 == 0:
                r.px(tx, y + yy, TICKET, 5)  # torn, lighter fibres
    else:
        for yy in range(1, h - 1, 2):
            r.px(x + w // 2, y + yy, TICKET_INK, 0)
        ty = y + (h - 1 if not stub else 0)
        for xx in range(w):
            if (xx + seed) % 2 == 0:
                r.px(x + xx, ty, TICKET, 5)


def _print(r, x, y, mat, idx, faint=False, flip=False):
    """An animatronic footprint: a broad pad and three round toes, heel towards +y (walking towards -y)."""
    pad = ['.###.', '#####', '#####', '#####', '.###.', '.###.', '..#..']
    toes = ['#.#.#', '.....']
    rows = toes + pad
    for yy, row in enumerate(rows):
        for xx, ch in enumerate(row[::-1] if flip else row):
            if ch == '#':
                if faint and (xx * 7 + yy * 3 + x) % 3 == 0:
                    continue
                r.px(x + xx, y + yy, mat, idx)


def _decal(r):
    k = r.variant
    r.clear()
    if k == 'tickets':
        _ticket(r, 1, 2, 6, 3, 1)
        _ticket(r, 10, 4, 3, 6, 2)
        _ticket(r, 4, 10, 6, 3, 3, stub=True)
        for (x, y) in ((8, 1), (13, 13), (2, 14)):
            r.px(x, y, TICKET, 4)
    elif k == 'tickets_b':
        _ticket(r, 7, 1, 6, 3, 4)
        _ticket(r, 2, 7, 3, 6, 5, stub=True)
        _ticket(r, 9, 11, 4, 3, 6, stub=True)
        r.px(14, 7, PAPER, 3); r.px(5, 3, PAPER, 2)
    elif k == 'confetti':
        cols = [(RED, 4), (YELLOW, 5), (PINK, 4), (TEAL_C, 3), (PAPER, 5), (WAX, 3)]
        n = 0
        for yy in range(16):
            for xx in range(16):
                s = (xx * 73 + yy * 151 + xx * yy * 7) % 23
                if s == 0:
                    m, i = cols[n % len(cols)]
                    r.px(xx, yy, m, i)
                    n += 1
        # a curled streamer
        for (xx, yy) in ((3, 9), (4, 9), (5, 10), (5, 11), (4, 12), (3, 12), (2, 11), (2, 10), (6, 12), (7, 13), (8, 13), (9, 12)):
            r.px(xx, yy, YELLOW, 4)
        # a flattened party blower
        for xx in range(9, 14):
            r.px(xx, 4, RED, 3 if xx % 2 else 4)
        r.px(14, 4, PAPER, 4)
    elif k == 'puddle':
        cx, cy = 8.0, 8.5
        for yy in range(16):
            for xx in range(16):
                ang = math.atan2(yy + 0.5 - cy, xx + 0.5 - cx)
                rad = 5.6 + 1.3 * math.sin(ang * 3 + 0.7) + 0.8 * math.sin(ang * 5 + 2.1)
                d = math.hypot(xx + 0.5 - cx, (yy + 0.5 - cy) * 1.15)
                if d < rad:
                    i = 1 if d < rad - 1.6 else 2
                    if d >= rad - 0.8:
                        r.px(xx, yy, GRIME, 1, rough=200)  # dirty rim
                    else:
                        r.px(xx, yy, WET, i)
        for (xx, yy) in ((6, 6), (7, 6), (10, 9), (5, 10)):
            r.px(xx, yy, WET, 5)  # reflected light
        r.px(13, 3, WET, 2); r.px(12, 14, WET, 2)  # stray drops
    elif k in ('prints', 'prints_faint'):
        faint = k == 'prints_faint'
        m, i = (WET, 2) if not faint else (GRIME, 1)
        _print(r, 2, 0, m, i, faint)
        _print(r, 9, 7, m, i, faint, flip=True)
        if not faint:
            # the wet sheen catches the light along the toes and the pad's leading edge
            for (x, y) in ((2, 0), (4, 0), (6, 0), (3, 2), (4, 2), (5, 2), (9, 7), (11, 7), (13, 7), (10, 9), (11, 9), (12, 9)):
                r.px(x, y, WET, 5)
            r.px(4, 10, WET, 1); r.px(11, 15, WET, 1)
    elif k == 'debris':
        chunks = [(2, 3, 4, 3), (9, 2, 3, 2), (6, 9, 5, 3), (12, 11, 2, 2), (3, 12, 2, 1)]
        for n, (x, y, w, h) in enumerate(chunks):
            for yy in range(h):
                for xx in range(w):
                    edge = yy == h - 1 or xx == w - 1
                    r.px(x + xx, y + yy, TILE_CHUNK, 2 if edge else 4 - (n % 2), h=6)
        r.speck(TILE_CHUNK, 5, 0.12)  # plaster dust
        r.px(14, 6, CHROME, 3); r.px(1, 8, IRON, 2)  # a ceiling clip, a screw
    elif k == 'drag':
        for yy in range(16):
            for x0 in (4, 10):
                wob = (yy * 5 // 16) % 2
                for xx in (x0 + wob, x0 + wob + 1):
                    if (xx * 3 + yy * 7) % 9:
                        r.px(xx, yy, GRIME, 0 if xx == x0 + wob else 1, rough=230)
        r.px(7, 3, WIRE_RED, 2); r.px(7, 4, WIRE_RED, 1)  # a scrap of insulation left behind


TEAL_C = Mat('confetti_teal', ['#123c3a', '#1d5654', '#2a706c', '#3a8a84'], rough=180, h=134, hk=1)


@prop
def floor_decal(out):
    g = Geo('floor_decal', 16, 16)
    g.box('decal', (-8, 0.1, -8), (8, 0.1, 8), {'up': _decal})
    out.geo(g)
    perms = []
    for i, k in enumerate(DECALS):
        out.tex(f'floor_decal_{k}', g.paint(k))
        perms.append((bs('fnar:kind', i), {'minecraft:material_instances': mi_set(f'floor_decal_{k}')}))
    blk = block_json('floor_decal', geometry='geometry.fnar.floor_decal', materials=mi_set('floor_decal_tickets'),
                     states={'fnar:kind': {'values': {'min': 0, 'max': len(DECALS) - 1}}},
                     collision=False, selection=box(-8, 0, -8, 8, 0.5, 8), map_color='#5a1a16', destroy=0.2, perms=perms)
    out.block('floor_decal', blk)
    f = {'focus': [0, 0.0, 0], 'dist': 1.4, 'dir': [0.3, 1, -0.6]}
    out.views('floor_decal', [{'label': f'kind {i} {k}', 'states': {'fnar:kind': i}, **f} for i, k in enumerate(DECALS)])


# =============================================================== wires hanging from the ceiling
@prop
def hanging_wires(out):
    g = Geo('hanging_wires', 32, 32)

    def wire(m, base=2):
        def p(r):
            r.fill(m, base, amp=0.4)
            r.speck(GRIME, 2, 0.1)
        return p

    def tip(r):
        r.fill(COPPER, 3, amp=0.3)
        r.px(0, 0, COPPER, 4)

    def jbox(r):
        r.fill(GALV, 3, amp=0.5)
        r.bevel(1, -1)
        if r.face == 'north':
            r.rect(1, 1, r.w - 2, r.h - 2, SHADOW, 1)
            r.px(1, r.h - 2, WIRE_RED, 2); r.px(2, r.h - 2, WIRE_YEL, 2)
        r.speck(RUST, 2, 0.15)

    def fluff(r):
        r.fill(FIBER, 2, amp=1.0, white_amp=0.9, cell=1)
        for c in range(r.w):
            for rr in range(r.h):
                if rr > r.h - 3 and (c + rr) % 2:
                    r.px(c, rr, None)  # ragged bottom edge

    # 0: a loose bundle of three cut cables
    g.box('bundle', (-2.5, 5, 0), (-2, 16, 0.5), {'sides': Face(wire(BLACK), 'w1')})
    g.box('bundle', (-2.5, 4.5, 0), (-2, 5, 0.5), {'sides': Face(tip, 't1'), 'down': Face(tip, 't1d')})
    g.box('bundle', (1, 8.5, -1.5), (1.5, 16, -1), {'sides': Face(wire(WIRE_RED), 'w2')})
    g.box('bundle', (1, 8, -1.5), (1.5, 8.5, -1), {'sides': Face(tip, 't2'), 'down': Face(tip, 't2d')})
    g.box('bundle', (3, 11, 1.5), (3.5, 16, 2), {'sides': Face(wire(WIRE_YEL), 'w3')})
    g.bone('bundle_bend', pivot=(3.25, 11, 1.75), rotation=(0, 0, 22.5))
    g.box('bundle_bend', (3, 6, 1.5), (3.5, 11, 2), {'sides': Face(wire(WIRE_YEL), 'w3b')})
    g.box('bundle_bend', (3, 5.5, 1.5), (3.5, 6, 2), {'sides': Face(tip, 't3'), 'down': Face(tip, 't3d')})
    # 1: a junction box dangling on its conduit, and a torn strip of insulation
    g.box('jbox', (-0.5, 9, -0.5), (0.5, 16, 0.5), {'sides': Face(wire(GALV, 3), 'cd')})
    g.bone('jbox_swing', pivot=(0, 9, 0), rotation=(22.5, 0, 0))
    g.box('jbox_swing', (-2, 5, -1), (2, 9, 1.5), {'north': Face(jbox, 'jn'), 'south': Face(jbox, 'js'), 'sides': Face(jbox, 'je'),
                                                   'ends': Face(jbox, 'jt')})
    g.box('jbox_swing', (-1, 3.5, 0), (-0.5, 5, 0.5), {'sides': Face(wire(WIRE_RED), 'jw1')})
    g.box('jbox_swing', (0.5, 2.5, 0), (1, 5, 0.5), {'sides': Face(wire(BLACK), 'jw2')})
    g.box('jbox', (-6, 8, 4), (-2, 16, 4), {'north': Face(fluff, 'fl'), 'south': Face(fluff, 'flb')})
    out.geo(g, {'geometry.fnar.hanging_wires': (['bundle', 'bundle_bend'], (0, 0, 0)),
                'geometry.fnar.hanging_wires_box': (['jbox', 'jbox_swing'], (0, 0, 0))})
    out.tex('hanging_wires', g.paint())
    perms = [(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.hanging_wires_box', 'minecraft:selection_box': box(-6, 2.5, -2, 6, 16, 4.5)})]
    blk = block_json('hanging_wires', geometry='geometry.fnar.hanging_wires', materials=mi_set('hanging_wires'),
                     states={'fnar:kind': {'values': {'min': 0, 'max': 1}}},
                     collision=False, selection=box(-4, 4.5, -2, 4, 16, 2.5), map_color='#2a2a30', destroy=0.5, perms=perms)
    out.block('hanging_wires', blk)
    f = {'focus': [0, 0.6, 0], 'dist': 1.8, 'dir': [0.6, -0.2, -1]}
    out.views('hanging_wires', [{'label': 'bundle', 'states': {'fnar:kind': 0}, **f}, {'label': 'junction box', 'states': {'fnar:kind': 1}, **f}])


# =============================================================== Walter's things
WALTER = ['desk', 'flashlight']


@prop
def walter_things(out):
    g = Geo('walter_things', 32, 32)

    def mug(r):
        if r.face == 'up':
            r.fill(CERAMIC, 5, amp=0.2)
            r.rect(1, 1, r.w - 2, r.h - 2, WOOD, 0)  # cold coffee, a skin on top
            r.px(1, 1, WOOD, 2)
            return
        r.fill(CERAMIC, 4, amp=0.3)
        if r.face == 'north':
            r.rect(0, 1, r.w, 1, NAVY, 3)  # a blue band: SECURITY
            r.px(1, 1, GOLD, 4)
        r.drip(WOOD, 2, 0, 1, 2)
        r.bevel(1, -1, t=False, l=False, r=False)

    def note(r):
        r.fill(PAPER, 5, amp=0.3, white_amp=0.3)
        if r.face == 'up':
            # ruled lines, and a few words pressed hard into the paper, then a line trailing off the edge
            for rr in (1, 3, 5, 7):
                r.hline(0, rr, r.w, PAPER, 3)
            for (c, rr) in ((1, 2), (2, 2), (3, 2), (1, 4), (2, 4), (4, 4), (1, 6), (2, 6), (3, 7), (4, 8)):
                r.px(c, rr, NAVY, 2)
            r.rot180()

    def cap(r):
        r.fill(NAVY, 3, amp=0.4)
        r.bevel(1, -1)
        if r.face == 'north':
            r.px(r.w // 2, 1, GOLD, 5)  # badge
            r.px(r.w // 2 - 1, 1, GOLD, 3)
        r.speck(GRIME, 2, 0.08)

    def brim(r):
        r.fill(BLACK, 3, amp=0.3)
        r.px(0, 0, BLACK, 5)

    def pen(r):
        r.fill(BLACK, 4, amp=0.2)
        r.px(0, 0, CHROME, 3)

    def torch_body(r):
        r.fill(BLACK, 2, amp=0.4, streak='h' if r.face != 'north' else None)
        if r.face in ('east', 'west', 'up'):
            for c in range(1, r.w - 1, 2):
                r.px(c, 0, BLACK, 4)  # knurled grip
            r.px(r.w // 2, r.h - 1, YELLOW, 4)  # the switch, still pushed forward
        r.speck(GRIME, 3, 0.1)

    def torch_head(r):
        r.fill(CHROME, 2, amp=0.4)
        r.bevel(1, -1)
        r.speck(RUST, 2, 0.08)

    def lens(r):
        r.fill(LENS, 2, amp=0.3)
        r.px(1, 1, LENS, 3)
        r.px(0, 0, LENS, 1)

    # 0: the desk set: his mug, his note, his cap, his pen
    g.box('desk', (2.5, 0, -5.5), (5, 3, -3), {'sides': Face(mug, 'mug'), 'up': Face(mug, 'mugu')})
    g.box('desk', (5, 0.75, -4.75), (5.75, 2.25, -3.75), {'sides': Face(lambda r: r.fill(CERAMIC, 3, amp=0.2), 'mh'), 'ends': Face(lambda r: r.fill(CERAMIC, 3), 'mh2')})
    g.box('desk', (-3.5, 0, -2.5), (1, 0.25, 3), {'up': Face(note, 'note'), 'sides': Face(lambda r: r.fill(PAPER, 4), 'ne')}, rotation=(0, -22.5, 0), pivot=(-1.25, 0, 0.25))
    g.box('desk', (-7, 0, 2), (-2.5, 2, 6), {'north': Face(cap, 'capn'), 'sides': Face(cap, 'caps'), 'up': Face(cap, 'capu')})
    g.box('desk', (-6.5, 0, -0.5), (-3, 0.5, 2), {'sides': Face(brim, 'br'), 'up': Face(brim, 'bru')})
    g.box('desk', (1.5, 0, 3), (6, 0.5, 3.5), {'sides': Face(pen, 'pen'), 'up': Face(pen, 'penu')}, rotation=(0, 22.5, 0), pivot=(3.75, 0, 3.25))
    # 1: his flashlight, dropped on the floor and still on
    g.bone('flash', pivot=(0, 0, 0), rotation=(0, 22.5, 0))
    g.box('flash', (-1, 0, -2), (1, 2, 4.5), {'sides': Face(torch_body, 'tb'), 'south': Face(torch_head, 'tbs')})
    g.box('flash', (-1.5, 0, -4.5), (1.5, 3, -2), {'sides': Face(torch_head, 'th'), 'ends': Face(torch_head, 'tht'), 'north': Face(torch_head, 'thn')})
    g.box('flash', (-1.25, 0.25, -4.55), (1.25, 2.75, -4.55), {'north': Face(lens, 'lens', mi='lens')})
    out.geo(g, {'geometry.fnar.walter_things': (['desk'], (0, 0, 0)), 'geometry.fnar.walter_things_flashlight': (['flash'], (0, 0, 0))})
    out.tex('walter_things', g.paint())
    mats = mi_set('walter_things', {'lens': glow('walter_things')})
    perms = [(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.walter_things_flashlight', 'minecraft:light_emission': 6,
                                   'minecraft:selection_box': box(-3, 0, -6, 3, 3, 6)})]
    blk = block_json('walter_things', geometry='geometry.fnar.walter_things', materials=mats,
                     states={'fnar:kind': {'values': {'min': 0, 'max': 1}}},
                     collision=False, selection=box(-7, 0, -6, 7, 3, 6.5), map_color='#202b45', destroy=0.5, perms=perms)
    out.block('walter_things', blk)
    out.light('walter_things', '#ffe9c0', 'point_light')
    f = {'focus': [0, 0.1, 0], 'dist': 1.2, 'dir': [0.5, 0.8, -1]}
    out.views('walter_things', [{'label': 'desk', 'states': {'fnar:kind': 0}, **f}, {'label': 'flashlight', 'states': {'fnar:kind': 1}, **f}])


# =============================================================== boarded-up window
@prop
def boarded_planks(out):
    g = Geo('boarded_planks', 64, 64)

    def plank(seed):
        def p(r):
            r.fill(GREYWOOD, 4, amp=0.5, white_amp=0.4, streak='h' if r.w >= r.h else 'v', seed=seed)
            r.bevel(1, -1)
            if r.face == 'north':
                long = r.w >= r.h
                n = r.w if long else r.h
                for k in (1, n - 2):  # nail heads near both ends
                    for j in (0, 1):
                        c, rr = (k, 1 + j * (r.h - 3)) if long else (1 + j * (r.w - 3), k)
                        r.px(c, rr, IRON, 3)
                        r.px(c + (0 if long else 0), rr + (1 if long else 0), RUST, 2)
                r.speck(GREYWOOD, 1, 0.06)  # knots and cracks
                r.darken_noise(0.25, -1, bottom=0.3)
        return p

    # 0: three planks across, the middle one slipped
    g.box('across', (-8, 2, 6.5), (8, 5, 8), {'north': plank(1), 'sides': Face(plank(1), 'ae'), 'ends': Face(plank(1), 'at')})
    g.box('across', (-8, 11.5, 6.5), (8, 14.5, 8), {'north': plank(2), 'sides': Face(plank(2), 'ae'), 'ends': Face(plank(2), 'at')})
    g.bone('across_slip', pivot=(0, 8, 7.25), rotation=(0, 0, -22.5))
    g.box('across_slip', (-7.5, 6.5, 5.5), (6.5, 9.5, 6.5), {'north': plank(3), 'south': Face(plank(3), 'asb'), 'sides': Face(plank(3), 'ase'),
                                                             'ends': Face(plank(3), 'ast')})
    # 1: two planks nailed in an X
    g.bone('cross_a', pivot=(0, 8, 7.25), rotation=(0, 0, 45))
    g.box('cross_a', (-9, 6.5, 6.5), (9, 9.5, 8), {'north': plank(4), 'sides': Face(plank(4), 'cae'), 'ends': Face(plank(4), 'cat')})
    g.bone('cross_b', pivot=(0, 8, 7.25), rotation=(0, 0, -45))
    g.box('cross_b', (-9, 6.5, 5), (9, 9.5, 6.5), {'north': plank(5), 'south': Face(plank(5), 'cbb'), 'sides': Face(plank(5), 'cbe'),
                                                   'ends': Face(plank(5), 'cbt')})
    out.geo(g, {'geometry.fnar.boarded_planks': (['across', 'across_slip'], (0, 0, 0)),
                'geometry.fnar.boarded_planks_x': (['cross_a', 'cross_b'], (0, 0, 0))})
    out.tex('boarded_planks', g.paint())
    perms = [(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.boarded_planks_x'})]
    blk = block_json('boarded_planks', geometry='geometry.fnar.boarded_planks', materials=mi_set('boarded_planks'),
                     states={'fnar:kind': {'values': {'min': 0, 'max': 1}}},
                     collision=False, selection=box(-8, 0, 5, 8, 16, 8), map_color='#53493d', destroy=1.5, perms=perms)
    out.block('boarded_planks', blk)
    f = {'env': 'wall', 'focus': [0, 0.5, 0.3], 'dist': 1.9, 'dir': [0.35, 0.15, -1]}
    out.views('boarded_planks', [{'label': 'across', 'states': {'fnar:kind': 0}, **f}, {'label': 'x', 'states': {'fnar:kind': 1}, **f}]
              + pillar_views(dist=3.8))


# =============================================================== red emergency light
@prop
def emergency_light(out):
    g = Geo('emergency_light', 32, 32)

    def housing(r):
        r.fill(RED, 2, amp=0.4)
        r.bevel(1, -1)
        r.speck(RUST, 2, 0.12)
        r.darken_noise(0.3, -1, bottom=0.6)

    def plate(r):
        r.fill(STEEL, 2, amp=0.5)
        r.bevel(1, -1)
        r.px(1, 1, CHROME, 3); r.px(r.w - 2, r.h - 2, CHROME, 2)
        r.speck(RUST, 2, 0.1)

    def dome(r):
        lit = r.variant == 'on'
        m = RED_GLOW if lit else RED
        r.fill(m, 2 if lit else 4, amp=0.4, white_amp=0.3)
        if r.face != 'down':
            for c in (0, r.w - 1):
                r.vline(c, 0, r.h, STEEL, 2)  # wire cage over the glass
            if r.face == 'up':
                r.hline(0, r.h // 2, r.w, STEEL, 2)
            else:
                r.hline(0, r.h // 2, r.w, STEEL, 1)
        if lit:
            r.px(1, 0, m, 4)
            r.px(1, 1, m, 3)
        else:
            r.speck(GRIME, 2, 0.2)

    g.box('mount', (-2.5, 8, 7), (2.5, 14, 8), {'north': plate, 'sides': Face(plate, 'ps'), 'ends': Face(plate, 'pe')})
    g.box('mount', (-1, 9, 4), (1, 10, 7), {'sides': Face(housing, 'arm'), 'ends': Face(housing, 'arme')})
    g.box('mount', (-2, 9.5, 2.5), (2, 10.5, 6.5), {'sides': Face(housing, 'base'), 'ends': Face(housing, 'baset')})
    g.box('mount', (-1.5, 10.5, 3), (1.5, 13.5, 6), {'sides': Face(dome, 'dome', mi='dome'), 'up': Face(dome, 'domeu', mi='dome')})
    g.box('mount', (-0.5, 13.5, 4), (0.5, 14, 5), {'sides': Face(housing, 'cap'), 'up': Face(housing, 'capu')})
    out.geo(g)
    out.tex('emergency_light', g.paint('off'))
    out.tex('emergency_light_on', g.paint('on'))
    blk = block_json('emergency_light', geometry='geometry.fnar.emergency_light',
                     materials=mi_set('emergency_light_on', {'dome': glow('emergency_light_on')}),
                     states={'fnar:lit': [True, False]},
                     collision=False, selection=box(-2.5, 8, 2.5, 2.5, 14, 8), map_color='#8b2824', destroy=1.0, light=6,
                     perms=[(bs('fnar:lit', False), {'minecraft:material_instances': mi_set('emergency_light', {'dome': 'emergency_light'}),
                                                     'minecraft:light_emission': 0})])
    out.block('emergency_light', blk)
    out.light('emergency_light', '#ff2a1a', 'point_light')
    f = {'env': 'wall', 'focus': [0, 0.7, 0.25], 'dist': 1.2, 'dir': [0.6, 0.1, -1]}
    out.views('emergency_light', [{'label': 'lit', 'states': {'fnar:lit': True}, **f}, {'label': 'off', 'states': {'fnar:lit': False}, **f}]
              + pillar_views(extra_states={'fnar:lit': True}, dist=3.2))
