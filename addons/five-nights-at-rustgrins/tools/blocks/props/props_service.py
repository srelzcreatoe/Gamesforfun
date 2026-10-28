"""Service / back-of-house props: PA horn, time clock, wet floor sign, mop bucket, trash can,
parts shelf, toilet, sink, staff locker."""
import math

from propkit import Geo, Face, Mat, prop, panel, block_json, box, mi_set, bs, pillar_views
from pal import *  # noqa: F403

LOCKER = Mat('locker_paint', ['#2c3236', '#363d42', '#41484e', '#4c545a', '#576067', '#636c72', '#6f787e'], metal=90, rough=140, h=140, hk=4)
PAINT_GREY = Mat('pa_grey', ['#2c2e2f', '#3a3c3d', '#494b4c', '#595b5b', '#6a6c6b', '#7c7e7c'], metal=60, rough=170, h=140, hk=4)
CREAM_CARD = Mat('time_card', ['#8c8470', '#a59c86', '#bbb29b', '#cdc4ad'], rough=230, h=140, hk=2)


def rusty(mat, base=3, rust=0.12, grime=0.3, drips=2):
    """Painted metal with rust patches growing from the bottom and a couple of drip streaks."""
    def p(r):
        r.fill(mat, base, amp=0.5, white_amp=0.35)
        r.bevel(1, -1)
        r.darken_noise(grime, -1, bottom=0.6)
        if r.face not in ('up', 'down'):
            r.stain(RUST, lambda x, y: 1 + (x * 3 + y) % 3, r.w * 0.3, r.h + 0.5, r.w * 0.35, 2.2, p=rust * 5)
            for k in range(drips):
                x = (r.seed('d', k) % max(1, r.w))
                r.drip(RUST, 3, x, r.seed('dy', k) % max(1, r.h // 2), max(2, r.h // 2))
        r.speck(RUST, 2, rust * 0.4)
    return p


# =============================================================== PA horn speaker
@prop
def pa_speaker(out):
    g = Geo('pa_speaker', 32, 32)

    def mouth(r):  # 8 x 8 horn mouth: rim, dark throat, phase plug
        r.fill(PAINT_GREY, 4, amp=0.4)
        r.rect(1, 1, 6, 6, PAINT_GREY, 1)
        r.rect(2, 2, 4, 4, IRON, 1)
        r.rect(3, 3, 2, 2, SHADOW, 0)
        r.bevel(1, -1)
        r.stain(RUST, 2, 5.5, 7.5, 2.5, 1.2, p=0.7)
        r.speck(RUST, 2, 0.05)

    g.box('mount', (-1.5, 8, 7), (1.5, 15, 8), {'north': rusty(STEEL, 3, 0.1, drips=1), 'sides': Face(panel(STEEL, 2), 'ms'), 'ends': Face(panel(STEEL, 2), 'me')})
    g.box('mount', (-0.5, 11, 5), (0.5, 12, 7), {'sides': Face(panel(STEEL, 3, bevel=None), 'arm'), 'ends': Face(panel(STEEL, 3, bevel=None), 'arme')})
    g.bone('horn', pivot=(0, 11.5, 4.5), rotation=(-22.5, 0, 0))
    g.box('horn', (-1.5, 10, 3), (1.5, 13, 6), {'sides': Face(rusty(PAINT_GREY, 2, 0.1, drips=1), 'drv'), 'ends': Face(rusty(PAINT_GREY, 2), 'drvt')})
    g.box('horn', (-2, 9.5, 1), (2, 13.5, 3), {'sides': Face(rusty(PAINT_GREY, 3, 0.1), 'h1'), 'ends': Face(rusty(PAINT_GREY, 3), 'h1t')})
    g.box('horn', (-3, 8.5, -1), (3, 14.5, 1), {'south': rusty(PAINT_GREY, 3), 'east': Face(rusty(PAINT_GREY, 3, 0.15), 'h2'), 'west': Face(rusty(PAINT_GREY, 3, 0.15), 'h2'),
                                                 'up': Face(rusty(PAINT_GREY, 4, 0.1), 'h2t'), 'down': Face(rusty(PAINT_GREY, 2, 0.2), 'h2b')})
    g.box('horn', (-4, 7.5, -3), (4, 15.5, -1), {'north': mouth, 'south': rusty(PAINT_GREY, 3), 'east': Face(rusty(PAINT_GREY, 3, 0.15, drips=2), 'h3'),
                                                  'west': Face(rusty(PAINT_GREY, 3, 0.15, drips=2), 'h3'), 'up': Face(rusty(PAINT_GREY, 4, 0.1), 'h3t'),
                                                  'down': Face(rusty(PAINT_GREY, 2, 0.25), 'h3b')})
    out.geo(g)
    out.tex('pa_speaker', g.paint())
    blk = block_json('pa_speaker', geometry='geometry.fnar.pa_speaker', materials=mi_set('pa_speaker'),
                     collision=False, selection=box(-4, 4, -4, 4, 16, 8), map_color='#595b5b', destroy=1.0)
    out.block('pa_speaker', blk)
    f = {'env': 'wall', 'focus': [0, 0.65, 0.05], 'dist': 1.6, 'dir': [0.7, 0.05, -1]}
    out.views('pa_speaker', [{'label': 'north', **f}, {'label': 'side', 'env': 'wall', 'focus': [0, 0.65, 0.1], 'dist': 1.4, 'dir': [1, 0.2, -0.2]},
                             {'label': 'facing east', 'states': {'minecraft:cardinal_direction': 'east'}, **f, 'dir': [1, 0.2, -0.5]}] + pillar_views(dist=3.6))


# =============================================================== time clock
@prop
def time_clock(out):
    g = Geo('time_clock', 32, 32)
    shell = lambda base=4, grime=0.3: panel(BEIGE, base, amp=0.5, white_amp=0.3, grime=grime)

    def front(r):  # 7 x 11 body front: (dial is a separate cube on top part) card slot + brand plate
        shell(4, 0.35)(r)
        r.rect(2, 6, 3, 1, SHADOW, 1)  # card slot
        r.hline(2, 7, 3, BEIGE, 2)
        r.px(5, 9, RED, 3)  # IN / OUT indicator
        r.rect(1, 9, 3, 1, BRASS, 3)  # brand plate
        r.px(1, 9, BRASS, 5)

    def dial(r):  # 5 x 5 round face showing 3 o'clock (an L of hands reads best at this size)
        r.fill(BEIGE, 4)
        r.disc(2.5, 2.5, 2.45, PAPER, 5)
        r.px(2, 1, BLACK, 2); r.px(2, 2, BLACK, 1); r.px(3, 2, BLACK, 3)
        r.px(1, 1, PAPER, 6)  # glass glint

    def rack(r):  # 3 x 10 rack front: three pockets
        r.fill(STEEL, 3, amp=0.4)
        for y in (2, 5, 8):
            r.hline(0, y, r.w, STEEL, 1)
            r.hline(0, y + 1, r.w, STEEL, 5)
        r.bevel(1, -1)
        r.speck(RUST, 2, 0.05)

    def card(r):
        r.fill(CREAM_CARD, 2, amp=0.3)
        if r.face in ('north', 'south'):
            r.hline(0, 0, r.w, CREAM_CARD, 3)
            for rr in range(1, r.h, 2):
                r.px(1 % r.w, rr, CREAM_CARD, 0)
            r.px(0, 1, RED, 3)

    g.box('clock', (-5, 3, 3), (2, 15, 8), {'north': front, 'east': Face(shell(3), 'side'), 'west': Face(shell(3), 'side'),
                                           'up': shell(5, 0.5), 'down': shell(2)})
    g.box('clock', (-4, 9, 2.5), (1, 14, 3), {'north': dial, 'sides': Face(panel(CHROME, 3, bevel=None), 'ds'), 'ends': Face(panel(CHROME, 3, bevel=None), 'de')})
    g.box('rack', (2, 2, 6.5), (5, 12, 8), {'north': rack, 'east': Face(panel(STEEL, 2), 'rs'), 'west': Face(panel(STEEL, 2), 'rs'),
                                           'up': Face(panel(STEEL, 3), 'ru'), 'down': Face(panel(STEEL, 2), 'ru')})
    for k, (y, h) in enumerate(((9, 4), (6, 3.5), (3, 4))):
        g.box('rack', (2.5 + 0.5 * (k % 2), y, 6.1), (4.5 + 0.5 * (k % 2) - (k % 2), y + h, 6.5), {'north': Face(card, f'c{k}'), 'sides': Face(card, 'ce'),
                                                                                                  'up': Face(card, 'ct')})

    out.geo(g)
    out.tex('time_clock', g.paint())
    blk = block_json('time_clock', geometry='geometry.fnar.time_clock', materials=mi_set('time_clock'),
                     collision=False, selection=box(-5, 2, 2.5, 5, 15, 8), map_color='#958b74', destroy=1.5)
    out.block('time_clock', blk)
    f = {'env': 'wall', 'focus': [0, 0.55, 0.3], 'dist': 1.5, 'dir': [0.4, 0.15, -1]}
    out.views('time_clock', [{'label': 'north', **f}, {'label': 'facing west', 'states': {'minecraft:cardinal_direction': 'west'}, **f, 'focus': [-0.3, 0.55, 0], 'dir': [-1, 0.2, -0.5]}]
              + pillar_views(dist=3.6))


# =============================================================== wet floor sign
@prop
def wet_floor_sign(out):
    g = Geo('wet_floor_sign', 32, 32)

    def board(r):  # 8 x 12
        r.fill(YELLOW, 5, amp=0.4, white_amp=0.3)
        r.rect(0, 1, 8, 3, BLACK, 2)
        for c in range(1, 7):  # "CAUTION" squeezed into pixel marks
            if c != 4:
                r.px(c, 2, YELLOW, 6 if c % 2 else 5)
        man = ['...##...',
               '.######.',
               '...##...',
               '...##...',
               '..#..#..',
               '.#....#.']
        r.blit(man, {'#': (BLACK, 1)}, 0, 4)
        r.bevel(1, -1)
        r.darken_noise(0.3, -1, bottom=0.8)
        r.speck(GRIME, 2, 0.05)

    def edge(r):
        r.fill(YELLOW, 3, amp=0.3)
        r.darken_noise(0.2, -1, bottom=0.8)

    g.bone('front', pivot=(0, 11.1, 0), rotation=(22.5, 0, 0))
    g.bone('back', pivot=(0, 11.1, 0), rotation=(-22.5, 0, 0))
    g.box('front', (-4, -0.9, -1), (4, 11.1, 0), {'north': Face(board, 'board'), 'south': Face(edge, 'inner'), 'sides': Face(edge, 'edge'),
                                                  'ends': Face(edge, 'end')})
    g.box('back', (-4, -0.9, 0), (4, 11.1, 1), {'south': Face(board, 'board'), 'north': Face(edge, 'inner'), 'sides': Face(edge, 'edge'),
                                                'ends': Face(edge, 'end')})
    g.box('handle', (-1.5, 11, -0.5), (1.5, 12.5, 0.5), {'sides': Face(edge, 'hs'), 'up': Face(edge, 'hu')})
    out.geo(g)
    out.tex('wet_floor_sign', g.paint())
    blk = block_json('wet_floor_sign', geometry='geometry.fnar.wet_floor_sign', materials=mi_set('wet_floor_sign'),
                     collision=False, selection=box(-4, 0, -5, 4, 12.5, 5), map_color='#b48f26', destroy=0.5)
    out.block('wet_floor_sign', blk)
    f = {'focus': [0, 0.4, 0], 'dist': 1.6}
    out.views('wet_floor_sign', [{'label': 'north', **f}, {'label': 'side', **f, 'dir': [1, 0.3, -0.1]},
                                 {'label': 'facing east', 'states': {'minecraft:cardinal_direction': 'east'}, **f}])


# =============================================================== mop bucket
@prop
def mop_bucket(out):
    g = Geo('mop_bucket', 32, 32)
    plastic = lambda base=4, grime=0.4: panel(YELLOW, base, amp=0.4, white_amp=0.3, grime=grime)

    def water(r):
        r.fill(WATER, 2, amp=0.6, white_amp=0.5, cell=2)
        r.speck(GRIME, 3, 0.15)
        r.px(1, 1, WATER, 4)

    def bucket_side(r):
        plastic(4, 0.45)(r)
        if r.face == 'north':
            r.hline(1, 1, 6, YELLOW, 6)  # moulded rim highlight
            r.hline(2, 2, 4, YELLOW, 2)
        r.drip(GRIME, 2, 1, 0, 3)

    def strings(r):
        r.fill(CLOTH, 2, amp=0.8, white_amp=0.8, cell=1)
        for c in range(0, r.w, 2):
            r.vline(c, 0, r.h, CLOTH, 1)
        r.speck(GRIME, 2, 0.2)

    for x in (-4, 3):
        for z in (-4, 3):
            g.box('bucket', (x, 0, z), (x + 1, 1, z + 1), {'sides': Face(panel(BLACK, 2, bevel=None), 'wheel')})
    g.box('bucket', (-4, 1, -4), (4, 5, 4), {'sides': Face(bucket_side, 'low'), 'up': water, 'down': plastic(2)})
    for (x0, z0, x1, z1) in ((-4, -4, 4, -3), (-4, 3, 4, 4), (-4, -3, -3, 3), (3, -3, 4, 3)):
        g.box('bucket', (x0, 5, z0), (x1, 7, z1), {'sides': Face(plastic(4, 0.2), f'rim{x1 - x0:g}x{z1 - z0:g}'), 'up': Face(plastic(5, 0.1), f'rimt{x1 - x0:g}{z1 - z0:g}')})
    g.box('wringer', (-3, 7, 1), (3, 9, 3), {'sides': Face(panel(GREYPLAST, 3, grime=0.3), 'wr'), 'up': Face(panel(GREYPLAST, 4), 'wrt')})
    g.box('wringer', (2.5, 9, 1.5), (3.5, 12, 2.5), {'sides': Face(panel(GREYPLAST, 3, bevel=None), 'lever')})
    g.box('mop', (-2.5, 4, -3), (0.5, 6, 0), {'sides': Face(strings, 'str'), 'up': Face(strings, 'stru')})
    g.bone('handle', pivot=(-1, 3, -1.5), rotation=(0, 0, 22.5))
    g.box('handle', (-1.5, 3, -2), (-0.5, 16.5, -1), {'sides': Face(panel(WOOD, 3, streak='v', bevel=None), 'h'), 'up': Face(panel(BLACK, 3), 'ht')})
    g.box('handle', (-1.75, 14.5, -2.25), (-0.25, 16.5, -0.75), {'sides': Face(panel(BLACK, 3, bevel=None), 'grip'), 'up': Face(panel(BLACK, 3), 'gt')})
    out.geo(g)
    out.tex('mop_bucket', g.paint())
    blk = block_json('mop_bucket', geometry='geometry.fnar.mop_bucket', materials=mi_set('mop_bucket'),
                     collision=box(-4, 0, -4, 4, 7, 4), selection=box(-7, 0, -4, 4, 16, 4), map_color='#b48f26', destroy=1.0)
    out.block('mop_bucket', blk)
    f = {'focus': [0, 0.4, 0], 'dist': 1.9}
    out.views('mop_bucket', [{'label': 'north', **f}, {'label': 'facing south', 'states': {'minecraft:cardinal_direction': 'south'}, **f}])


# =============================================================== trash can
@prop
def trash_can(out):
    g = Geo('trash_can', 32, 32)

    def body(r):
        r.fill(GALV, 3, amp=0.35, white_amp=0.35, streak='v')
        for rr in range(r.h):  # corrugated ribs
            _, y, _ = r.world(0, rr)
            if int(y) in (2, 8):
                r.hline(0, rr, r.w, GALV, 5)
            elif int(y) in (3, 9):
                r.hline(0, rr, r.w, GALV, 1)
        r.hline(0, 0, r.w, BLACK, 1)  # liner bag folded over the rim
        r.stain(GALV, 2, r.w * 0.6, r.h * 0.45, 1.6, 1.4, p=0.9)  # dent shadow
        r.stain(GALV, 4, r.w * 0.6 - 1, r.h * 0.45 - 1, 1.0, 0.8, p=0.9)  # dent highlight
        r.stain(RUST, lambda x, y: 1 + (x + y) % 3, r.w * 0.4, r.h + 0.5, r.w * 0.5, 2.5, p=0.7)
        r.darken_noise(0.15, -1, bottom=0.8)

    def lid(r):
        r.fill(GALV, 4, amp=0.5, white_amp=0.35)
        if r.face == 'up':
            for c in range(r.w):
                for rr in range(r.h):
                    x, _, z = r.world(c, rr)
                    if max(abs(x), abs(z)) > 3.6:
                        r.shift(c, rr, -1)
            r.speck(GRIME, 3, 0.1)
        r.speck(RUST, 2, 0.04)

    for (x0, z0, x1, z1, k) in ((-5, -4, 5, 4, 'a'), (-4, -5, 4, -4, 'n'), (-4, 4, 4, 5, 's')):
        g.box('can', (x0, 0, z0), (x1, 11, z1), {'sides': Face(body, f'b{k}'), 'down': Face(panel(GALV, 1), f'bd{k}')})
    for (x0, z0, x1, z1, k) in ((-5.5, -4.5, 5.5, 4.5, 'a'), (-4.5, -5.5, 4.5, -4.5, 'n'), (-4.5, 4.5, 4.5, 5.5, 's')):
        g.box('lid', (x0, 11, z0), (x1, 12, z1), {'sides': Face(lid, f'l{k}'), 'up': Face(lid, f'lu{k}'), 'down': Face(panel(GALV, 1), f'ld{k}')})
    g.box('lid', (-1.5, 12, -0.5), (1.5, 13, 0.5), {'sides': Face(panel(GALV, 4, bevel=None), 'hd'), 'up': Face(panel(GALV, 5), 'hdu')})
    out.geo(g)
    out.tex('trash_can', g.paint())
    blk = block_json('trash_can', geometry='geometry.fnar.trash_can', materials=mi_set('trash_can'),
                     collision=box(-5.5, 0, -5.5, 5.5, 13, 5.5), selection=box(-5.5, 0, -5.5, 5.5, 13, 5.5), map_color='#626970', destroy=1.5)
    out.block('trash_can', blk)
    f = {'focus': [0, 0.4, 0], 'dist': 1.9}
    out.views('trash_can', [{'label': 'north', **f}, {'label': 'facing west', 'states': {'minecraft:cardinal_direction': 'west'}, **f}])


# =============================================================== parts shelf
@prop
def parts_shelf(out):
    g = Geo('parts_shelf', 64, 64)

    def post(r):
        r.fill(GALV, 3, amp=0.4)
        for rr in range(1, r.h, 3):
            r.px(r.w // 2, rr, GALV, 0)  # slotted angle holes
        r.speck(RUST, 2, 0.08)
        r.darken_noise(0.3, -1, bottom=0.8)

    def board(r):
        r.fill(GALV, 4 if r.face == 'up' else 3, amp=0.5, white_amp=0.3)
        if r.face == 'up':
            r.speck(GRIME, 3, 0.25)
            r.stain(GRIME, 2, r.w * 0.7, r.h * 0.5, 2.5, 1.5, p=0.5)
        elif r.face == 'north':
            r.bevel(1, -1)
        r.speck(RUST, 2, 0.05)

    def cardbox(label):
        def p(r):
            r.fill(CARD, 3, amp=0.5, white_amp=0.4)
            r.bevel(1, -1)
            if r.face == 'up':
                r.vline(r.w // 2, 0, r.h, PAPER, 4)  # tape
            elif r.face == 'north' and label:
                r.rect(1, 1, min(4, r.w - 2), 2, PAPER, 4)
                r.hline(1, 1, 3, BLACK, 3)
            r.darken_noise(0.25, -1, bottom=0.6)
        return p

    def coil(r):
        r.fill(BLACK, 3, amp=0.4)
        for c in range(r.w):
            for rr in range(r.h):
                if (c + rr * 2) % 3 == 0:
                    r.px(c, rr, BLACK, 5)
        r.speck(RED, 3, 0.12); r.speck(YELLOW, 4, 0.08)

    def endo(r):
        r.fill(IRON, 3, amp=0.5, white_amp=0.4)
        r.bevel(1, -1)
        r.speck(CHROME, 3, 0.15)
        r.speck(RUST, 2, 0.08)

    def finger(r):
        r.fill(IRON, 4, amp=0.3)
        if r.face in ('east', 'west', 'up'):
            for k in range(0, r.w if r.face == 'up' else r.w, 2):
                r.vline(k, 0, r.h, CHROME, 3) if r.face == 'up' else r.vline(k, 0, r.h, IRON, 1)

    def wires(r):
        r.clear()
        for c, m, i in ((0, RED, 3), (1, BLACK, 4), (2, YELLOW, 4)):
            n = r.h - (c * 2 + 1)
            for rr in range(n):
                r.px(c + (1 if rr > n - 3 and c < 2 else 0), rr, m, i)

    def can(r):
        r.fill(CHROME, 3, amp=0.4)
        if r.face == 'up':
            r.px(0, 0, CHROME, 5)
        else:
            r.hline(0, 1, r.w, RED, 3)

    for x in (-8, 7):
        for z in (0, 7):
            g.box('frame', (x, 0, z), (x + 1, 16, z + 1), {'sides': Face(post, 'post')})
    for y in (1, 8, 15):
        g.box('frame', (-7, y, 0), (7, y + 1, 8), {'up': Face(board, 'bu'), 'down': Face(board, 'bd'), 'north': Face(board, 'bn')})
    g.box('stuff', (-6, 2, 1), (0, 7, 7), {'north': cardbox(True), 'east': Face(cardbox(False), 'cb'), 'west': Face(cardbox(False), 'cb'), 'up': cardbox(False)})
    g.box('stuff', (1, 2, 2), (6, 4, 7), {'sides': Face(coil, 'coil'), 'up': Face(coil, 'coilu')})
    g.box('stuff', (2, 4, 3), (5, 5, 6), {'sides': Face(coil, 'coil2'), 'up': Face(coil, 'coil2u')})
    g.box('stuff', (2, 9, 2), (7, 13, 7), {'north': cardbox(True), 'east': Face(cardbox(False), 'cb2'), 'west': Face(cardbox(False), 'cb2'),
                                          'up': Face(cardbox(False), 'cb2u')}, rotation=(0, -22.5, 0), pivot=(4.5, 9, 4.5))
    g.box('stuff', (-1.5, 9, 4), (0.5, 11, 6), {'sides': Face(can, 'can'), 'up': Face(can, 'canu')})
    # spare endoskeleton hand: palm + four fingers hanging over the shelf edge + thumb
    g.box('hand', (-6, 9, 1), (-2.5, 10, 4), {'sides': Face(endo, 'palm'), 'up': Face(endo, 'palmu')})
    for k in range(4):
        x = -6 + k * 0.9
        g.box('hand', (x, 9.25, -2 + (k % 2) * 0.5), (x + 0.6, 9.85, 1), {'sides': Face(finger, 'f'), 'up': Face(finger, 'fu'), 'north': Face(endo, 'ft')})
    g.box('hand', (-2.5, 9.2, 1.5), (-0.5, 9.8, 2.1), {'sides': Face(finger, 'th'), 'up': Face(finger, 'thu')})
    g.box('hand', (-5.5, 9, 4), (-3, 10, 6.5), {'sides': Face(endo, 'wrist'), 'up': Face(endo, 'wristu')})
    g.box('wires', (3, 3, -0.25), (6, 8, -0.25), {'north': wires})
    out.geo(g)
    out.tex('parts_shelf', g.paint())
    blk = block_json('parts_shelf', geometry='geometry.fnar.parts_shelf', materials=mi_set('parts_shelf'),
                     collision=box(-8, 0, 0, 8, 16, 8), selection=box(-8, 0, -2, 8, 16, 8), map_color='#626970', destroy=2.0)
    out.block('parts_shelf', blk)
    f = {'focus': [0, 0.5, 0.2], 'dist': 2.5, 'dir': [0.45, 0.35, -1]}
    out.views('parts_shelf', [{'label': 'north', 'env': 'wall', **f}, {'label': 'facing east', 'env': 'wall', 'states': {'minecraft:cardinal_direction': 'east'},
                                                                         **f, 'focus': [-0.2, 0.5, 0], 'dir': [1, 0.35, -0.45]}])


# =============================================================== toilet
@prop
def toilet(out):
    g = Geo('toilet', 64, 64)
    cer = lambda base=4, grime=0.35: panel(CERAMIC, base, amp=0.4, white_amp=0.3, grime=grime)

    def bowl_top(r):  # 8 x 8 bowl top: water in the middle (seen through the seat hole)
        cer(3)(r)
        r.rect(2, 1, 4, 5, WATER, 2)
        r.rect(3, 2, 2, 3, WATER, 1)
        r.stain(GRIME, 3, 4, 4.5, 2.3, 2.6, p=0.4, only=WATER)
        r.frame_rect(2, 1, 4, 5, RUST, 3)  # scale ring at the water line

    def seat(r):
        r.fill(WHITE, 4, amp=0.3, white_amp=0.3)
        r.darken_noise(0.3, -1)
        if r.face == 'up':
            r.speck(GRIME, 3, 0.08)

    def tank_front(r):
        cer(4, 0.3)(r)
        r.drip(RUST, 3, 2, 2, 3)
        r.px(7, 4, CERAMIC, 1)  # chipped corner

    def tank_lid(r):
        cer(5, 0.2)(r)
        if r.face == 'up':
            for c, rr in ((3, 1), (4, 2), (5, 2), (6, 3)):  # hairline crack
                r.px(c, rr, CERAMIC, 1)

    def base_side(r):
        cer(3, 0.5)(r)
        r.stain(GRIME, 2, r.w / 2, r.h + 0.5, r.w * 0.6, 1.8, p=0.7)

    g.box('base', (-2.5, 0, -1), (2.5, 4, 5), {'sides': Face(base_side, 'ped'), 'ends': Face(cer(3), 'pedt')})
    g.box('bowl', (-4, 4, -4), (4, 6, 4), {'sides': Face(cer(4), 'bowl'), 'up': bowl_top, 'down': cer(2)})
    for (x0, z0, x1, z1, k) in ((-4, -4, 4, -2.5, 'f'), (-4, 1.5, 4, 3, 'b'), (-4, -2.5, -2, 1.5, 's'), (2, -2.5, 4, 1.5, 's')):
        g.box('seat', (x0, 6, z0), (x1, 7.5, z1), {'sides': Face(seat, f'ss{k}'), 'up': Face(seat, f'su{k}')})
    g.box('seat', (-3.5, 7.5, 3), (3.5, 13.5, 3.5), {'north': Face(seat, 'lid'), 'south': Face(seat, 'lidb'), 'sides': Face(seat, 'lide'), 'ends': Face(seat, 'lidt')})
    g.box('tank', (-5, 6, 4), (5, 11, 8), {'north': tank_front, 'east': Face(cer(4), 'ts'), 'west': Face(cer(4), 'ts'), 'down': cer(2)})
    g.box('tank', (-5, 11, 3.5), (5, 12, 8), {'up': tank_lid, 'north': Face(cer(5), 'tl'), 'east': Face(cer(4), 'tle'), 'west': Face(cer(4), 'tle'), 'down': Face(cer(2), 'tld')})
    g.box('tank', (2.5, 10, 3.25), (4.5, 10.5, 4), {'sides': Face(panel(CHROME, 3, bevel=None), 'lever'), 'ends': Face(panel(CHROME, 4, bevel=None), 'levert')})
    g.box('pipe', (-4, 1, 6.5), (-3, 6, 7.5), {'sides': Face(panel(CHROME, 2, streak='v', bevel=None), 'pipe')})
    out.geo(g)
    out.tex('toilet', g.paint())
    blk = block_json('toilet', geometry='geometry.fnar.toilet', materials=mi_set('toilet'),
                     collision=box(-5, 0, -4, 5, 12, 8), selection=box(-5, 0, -4, 5, 13.5, 8), map_color='#a8a296', destroy=2.0)
    out.block('toilet', blk)
    f = {'focus': [0, 0.4, 0.1], 'dist': 2.0, 'dir': [0.6, 0.6, -1]}
    out.views('toilet', [{'label': 'north', 'env': 'wall', **f}, {'label': 'facing west', 'env': 'wall', 'states': {'minecraft:cardinal_direction': 'west'},
                                                                   **f, 'focus': [-0.1, 0.4, 0], 'dir': [-1, 0.6, -0.6]}])


# =============================================================== sink
@prop
def sink(out):
    g = Geo('sink', 64, 64)
    cer = lambda base=4, grime=0.35: panel(CERAMIC, base, amp=0.4, white_amp=0.3, grime=grime)

    def basin_floor(r):  # 10 x 6 inside floor (rows north..south): drain + rust trail from the tap
        cer(3, 0.3)(r)
        r.px(5, 3, SHADOW, 1); r.px(4, 3, IRON, 2)
        for rr in range(3, r.h):
            r.px(5, rr, RUST, 3 if rr % 2 else 2)
        r.px(6, 4, RUST, 4)

    def front(r):  # 12 x 6 outer front with overflow stains
        cer(4, 0.4)(r)
        r.drip(RUST, 3, 8, 0, 5)
        r.stain(GRIME, 3, 3, 4.5, 2.5, 1.2, p=0.5)
        r.hline(0, r.h - 1, r.w, CERAMIC, 2)

    def tap(r):
        r.fill(CHROME, 3, amp=0.4); r.speck(RUST, 2, 0.1)

    g.box('basin', (-6, 10, 0), (6, 13, 8), {'north': front, 'east': Face(cer(4), 'bs'), 'west': Face(cer(4), 'bs'), 'down': cer(2)})
    g.box('basin', (-5, 13, 1), (5, 13, 7), {'up': basin_floor})
    g.box('basin', (-6, 13, 0), (6, 16, 1), {'north': cer(4, 0.3), 'south': Face(cer(3), 'rin'), 'up': Face(cer(5, 0.1), 'rimf'), 'east': Face(cer(4), 're'), 'west': Face(cer(4), 're')})
    g.box('basin', (-6, 13, 7), (6, 16, 8), {'north': Face(cer(3), 'rin'), 'up': Face(cer(5, 0.1), 'rimf'), 'east': Face(cer(4), 're'), 'west': Face(cer(4), 're')})
    for x0 in (-6, 5):
        g.box('basin', (x0, 13, 1), (x0 + 1, 16, 7), {'east' if x0 < 0 else 'west': Face(cer(3), 'rins'), 'west' if x0 < 0 else 'east': Face(cer(4), 'rout'),
                                                    'up': Face(cer(5, 0.1), 'rims')})
    g.box('tap', (-1, 14, 5.5), (1, 15.5, 7), {'sides': Face(tap, 'tb'), 'up': Face(tap, 'tbu')})
    g.box('tap', (-0.5, 14.5, 4), (0.5, 15.5, 5.5), {'sides': Face(tap, 'sp'), 'ends': Face(tap, 'spe')})
    for x0, m in ((-3, RED), (2, BLUE_DOT)):
        g.box('tap', (x0, 14, 5.75), (x0 + 1, 15, 6.75), {'sides': Face(tap, 'kn'), 'up': Face(lambda r, m=m: (r.fill(CHROME, 4), r.px(0, 0, m, 3)), f'knu{x0}')})
    g.box('pipe', (-0.75, 5, 3), (0.75, 10, 4.5), {'sides': Face(panel(CHROME, 2, streak='v', grime=0.4, bevel=None), 'p1'), 'down': Face(panel(CHROME, 2), 'p1d')})
    g.box('pipe', (-0.75, 5, 4.5), (0.75, 6.5, 8), {'sides': Face(panel(CHROME, 2, streak='h', grime=0.4, bevel=None), 'p2'), 'ends': Face(panel(CHROME, 2), 'p2e')})
    g.box('pipe', (-1.25, 5, 7.5), (1.25, 7, 8), {'north': Face(panel(CHROME, 3), 'esc'), 'sides': Face(panel(CHROME, 3), 'escs'), 'ends': Face(panel(CHROME, 3), 'esct')})
    out.geo(g)
    out.tex('sink', g.paint())
    blk = block_json('sink', geometry='geometry.fnar.sink', materials=mi_set('sink'),
                     collision=box(-6, 10, 0, 6, 16, 8), selection=box(-6, 5, 0, 6, 16, 8), map_color='#a8a296', destroy=2.0)
    out.block('sink', blk)
    f = {'focus': [0, 0.72, 0.2], 'dist': 1.8, 'dir': [0.5, 0.7, -1]}
    out.views('sink', [{'label': 'north (from above)', 'env': 'wall', **f}, {'label': 'north (from below)', 'env': 'wall', **f, 'dir': [0.6, -0.25, -1]},
                       {'label': 'facing east', 'env': 'wall', 'states': {'minecraft:cardinal_direction': 'east'}, **f, 'focus': [-0.2, 0.72, 0], 'dir': [1, 0.6, -0.5]}]
              + pillar_views(dist=3.8))


BLUE_DOT = Mat('tap_blue', ['#1d3a6e', '#2c55a0', '#4a78c8'], rough=80)


# =============================================================== staff locker (2 blocks tall)
@prop
def locker(out):
    g = Geo('locker', 64, 64)

    def door(r):
        """Front face of either half, painted in world space so the door reads as one panel."""
        r.fill(LOCKER, 4, amp=0.2, white_amp=0.2, cell=4, streak='h')
        for c in range(r.w):
            for rr in range(r.h):
                x, y, _ = r.world(c, rr)
                if abs(x) > 6 or y > 30.5 or y < 1.5:  # frame around the door
                    r.shift(c, rr, -1)
                if abs(abs(x) - 6) < 0.5 and 1.5 < y < 30.5:  # door gap
                    r.px(c, rr, LOCKER, 0)
                if 25 < y < 29 and abs(x) < 4.5 and int(y) % 2 == 0:  # vent louvres
                    r.px(c, rr, SHADOW, 1)
                elif 25 < y < 29 and abs(x) < 4.5:
                    r.px(c, rr, LOCKER, 6)
                if 21 < y < 23 and -1.5 < x < 1.5:  # name card slot
                    r.px(c, rr, CHROME, 3 if y > 22 else 2)
                if 21.2 < y < 22.2 and -1 < x < 1:
                    r.px(c, rr, PAPER, 4)
                if 4 < y < 7 and abs(x) < 4.5 and int(y) == 5:  # lower vent slot
                    r.px(c, rr, SHADOW, 1)
        # dents + rust creeping up from the floor
        r.stain(LOCKER, 3, r.w * 0.35, r.h * 0.55, 1.8, 1.4, p=0.9)
        r.stain(LOCKER, 5, r.w * 0.35 - 1, r.h * 0.55 - 1, 0.9, 0.7, p=0.9)
        if r.cube.bone == 'lower':
            r.stain(RUST, lambda x, y: 1 + (x + y) % 3, r.w * 0.5, r.h + 0.5, r.w * 0.6, 2.5, p=0.6)
            r.drip(RUST, 2, 3, 6, 6)
        else:
            r.px(r.w - 4, 3, YELLOW, 4); r.px(r.w - 3, 3, RED, 3); r.px(r.w - 4, 4, YELLOW, 3)  # faded sticker
        r.darken_noise(0.1, -1, bottom=0.5)

    def side(r):
        r.fill(LOCKER, 3, amp=0.2, white_amp=0.2, cell=4, streak='h')
        r.bevel(1, -1, t=False, b=False)
        if r.cube.bone == 'lower':
            r.stain(RUST, 2, r.w * 0.6, r.h + 0.5, r.w * 0.5, 2.0, p=0.5)
        r.stain(LOCKER, 2, r.w * 0.3, r.h * 0.4, 1.5, 2.0, p=0.8)
        r.darken_noise(0.12, -1, bottom=0.6)

    def top(r):
        r.fill(LOCKER, 3, amp=0.5)
        r.speck(GRIME, 3, 0.35)
        r.bevel(1, -1)

    g.box('lower', (-6.5, 0, -6.5), (6.5, 1, 6.5), {'sides': Face(panel(BLACK, 2, bevel=None), 'plinth')})
    g.box('lower', (-7, 1, -7), (7, 16, 7), {'north': door, 'east': Face(side, 'ls'), 'west': Face(side, 'ls'), 'south': side, 'down': Face(panel(LOCKER, 1), 'ld')})
    g.box('upper', (-7, 16, -7), (7, 32, 7), {'north': door, 'east': Face(side, 'us'), 'west': Face(side, 'us'), 'south': side, 'up': top})
    g.box('upper', (-5.5, 17, -7.5), (-4.5, 20, -7), {'north': Face(panel(CHROME, 3), 'latch'), 'sides': Face(panel(CHROME, 2, bevel=None), 'latchs'),
                                                      'ends': Face(panel(CHROME, 2, bevel=None), 'latche')})
    out.geo(g, {'geometry.fnar.locker': (['lower'], (0, 0, 0)), 'geometry.fnar.locker_upper': (['upper'], (0, -16, 0))})
    out.tex('locker', g.paint())
    perms = [(bs('fnar:half', 1), {'minecraft:geometry': 'geometry.fnar.locker_upper',
                                   'minecraft:selection_box': box(-7, 0, -7.5, 7, 16, 7)})]
    blk = block_json('locker', geometry='geometry.fnar.locker', materials=mi_set('locker'),
                     states={'fnar:half': {'values': {'min': 0, 'max': 1}}},
                     collision=box(-7, 0, -7, 7, 16, 7), selection=box(-7, 0, -7, 7, 16, 7), map_color='#4c545b', destroy=2.5, perms=perms)
    out.block('locker', blk)
    two = lambda d, x=0: [{'states': {'fnar:half': 0, 'minecraft:cardinal_direction': d}, 'pos': [x, 0, 0]},
                          {'states': {'fnar:half': 1, 'minecraft:cardinal_direction': d}, 'pos': [x, 1, 0]}]
    out.views('locker', [{'label': 'both halves', 'parts': two('north'), 'focus': [0, 1.0, 0], 'dist': 3.8},
                         {'label': 'row of two, facing east', 'parts': two('east', 0) + [{**p, 'pos': [p['pos'][0], p['pos'][1], 1]} for p in two('east')],
                          'focus': [0, 1.0, 0.5], 'dist': 4.5, 'dir': [1, 0.4, -0.5]}])
