"""Dining room / stage props: party table + chair, hats, pizza boxes, plates, balloons, bunting,
arcade cabinet, stage star, stage speaker, guitar amp."""
import math

from propkit import Geo, Face, Mat, prop, panel, block_json, box, mi_set, glow, bs, FONT_3x4, pillar_views
from pal import *  # noqa: F403

# extra ramps used only here
BLUE = Mat('hat_blue', ['#0e1a33', '#152649', '#1d335f', '#284376', '#36558a', '#48699b'], rough=150, h=140, hk=3)
PURPLE = Mat('hat_purple', ['#1d0f2a', '#2a163c', '#381e4f', '#472862', '#573373', '#6a4285'], rough=150, h=140, hk=3)
GREEN = Mat('balloon_green', ['#0f2414', '#16331c', '#1f4426', '#295631', '#36693d', '#477c4c'], rough=90, h=140, hk=3)
ORANGE = Mat('balloon_orange', ['#3a1a08', '#55270c', '#723612', '#8d4619', '#a65a24', '#bb6f33'], rough=90, h=140, hk=3)
TEAL = Mat('balloon_teal', ['#0b2626', '#123636', '#1a4847', '#245a58', '#316d6a', '#43807c'], rough=90, h=140, hk=3)
SILVER = Mat('balloon_silver', ['#3d3f44', '#55585e', '#6f7279', '#8a8d94', '#a4a7ad', '#bfc1c6'], metal=150, rough=60, h=140, hk=3)
MARQ_BG = Mat('marquee_bg', ['#2a0608', '#3e0a0c', '#560f10', '#6e1614'], rough=60, emit=[70, 90, 110, 130], h=128, hk=1)
MARQ_TXT = Mat('marquee_txt', ['#c98a12', '#e6a81c', '#f7c938', '#ffe27a'], rough=50, emit=[200, 225, 245, 255], h=150, hk=1)
SCR = Mat('arcade_scr', ['#04040a', '#0a0b1e', '#141a4a', '#2836a0', '#4a5fe0'], rough=30, emit=[40, 80, 140, 200, 240], h=128, hk=0)
SCR_DOT = Mat('arcade_dot', ['#b08a50', '#e8c890', '#fff0c8'], rough=30, emit=[200, 230, 255], h=128, hk=0)
SCR_RAT = Mat('arcade_rat', ['#7a3a8c', '#b060c8', '#e0a0ff'], rough=30, emit=[220, 240, 255], h=128, hk=0)
SCR_CAT = Mat('arcade_cat', ['#a01818', '#e03030', '#ff7060'], rough=30, emit=[220, 240, 255], h=128, hk=0)
SCR_CHEESE = Mat('arcade_cheese', ['#c09010', '#f0c020', '#fff060'], rough=30, emit=[220, 240, 255], h=128, hk=0)
COIN_GLOW = Mat('coin_glow', ['#6a0c08', '#b01c10', '#e83a20'], rough=60, emit=[120, 180, 230], h=140, hk=1)

TABLE_PARTS = {0: 'NSEW', 1: 'NEW', 2: 'EW'}


# =============================================================== party table
@prop
def party_table(out):
    g = Geo('party_table', 64, 64)

    def cloth_top(r):
        r.fill(CLOTH, 4, amp=0.5, white_amp=0.35, cell=4)
        for c in range(0, r.w, 4):  # faint woven checks
            for rr in range(r.h):
                if (rr // 4) % 2 == 0:
                    r.shift(c, rr, -1)
        r.stain(CLOTH_RED, 4, 4.5, 11.5, 1.6, 1.1, p=0.45)  # sauce
        r.stain(CLOTH, 2, 11.5, 4.5, 1.8, 1.8, p=0.35)  # soda ring
        r.stain(CLOTH, 3, 9, 9, 4.5, 3.0, p=0.3)
        r.speck(CARD, 5, 0.03)  # crumbs
        r.darken_noise(0.2, -1, cell=3)

    def drape(inner=False):
        def p(r):  # 16 x 6: folds + red/white checker hem in the bottom 2 rows
            r.fill(CLOTH, 3 if inner else 4, amp=0.4, white_amp=0.3)
            for c in range(r.w):
                k = c % 5
                if k == 0:
                    r.vline(c, 0, r.h - 2, CLOTH, 2)
                elif k == 1:
                    r.vline(c, 0, r.h - 2, CLOTH, 5 if not inner else 3)
            for c in range(r.w):
                for rr in (r.h - 2, r.h - 1):
                    if (c // 2 + rr) % 2 == 0:
                        r.px(c, rr, CLOTH_RED, 3 if rr == r.h - 2 else 2)
                    else:
                        r.px(c, rr, CLOTH, 4 if rr == r.h - 2 else 3)
            r.darken_noise(0.25, -1, bottom=0.6)
            if inner:
                r.shade_rect(0, 0, r.w, r.h, -1)
        return p

    def hem(r):
        for c in range(r.w):
            r.px(c, 0, CLOTH_RED if (c // 2) % 2 == 0 else CLOTH, 2)

    def under(r):
        r.fill(WOOD, 2, amp=0.6, streak='h')
        r.darken_noise(0.3, -1)

    leg = Face(panel(STEEL, 3, amp=0.4, streak='v', grime=0.4, bevel=None), 'leg')
    foot = Face(panel(BLACK, 2, bevel=None), 'foot')
    variants = {}
    for part, sides in TABLE_PARTS.items():
        bn = f'p{part}'
        g.box(bn, (-8, 13, -8), (8, 16, 8), {'up': Face(cloth_top, 'top'), 'down': Face(under, 'under')})
        for s in sides:
            if s in 'NS':
                z0 = -8 if s == 'N' else 7.5
                fz = 'north' if s == 'N' else 'south'
                iz = 'south' if s == 'N' else 'north'
                g.box(bn, (-8, 10, z0), (8, 16, z0 + 0.5), {fz: Face(drape(), 'drape'), iz: Face(drape(True), 'drapei'),
                                                             'down': Face(hem, 'hem'), 'east': Face(drape(), 'dend'), 'west': Face(drape(), 'dend')})
            else:
                x0 = -8 if s == 'W' else 7.5
                zlo = -7.5 if 'N' in sides else -8
                zhi = 7.5 if 'S' in sides else 8
                fx = 'west' if s == 'W' else 'east'
                ix = 'east' if s == 'W' else 'west'
                k = f'{zhi - zlo:g}'
                g.box(bn, (x0, 10, zlo), (x0 + 0.5, 16, zhi), {fx: Face(drape(), 'drape' + k), ix: Face(drape(True), 'drapei' + k),
                                                                'down': Face(hem, 'hem' + k)})
        legs = {0: [(-6.5, -6.5), (5.5, -6.5), (-6.5, 5.5), (5.5, 5.5)], 1: [(-6.5, -6.5), (5.5, -6.5)], 2: [(-6.5, -0.5), (5.5, -0.5)]}[part]
        for (x, z) in legs:
            g.box(bn, (x, 0.5, z), (x + 1, 13, z + 1), {'sides': leg})
            g.box(bn, (x - 0.25, 0, z - 0.25), (x + 1.25, 0.5, z + 1.25), {'sides': foot, 'up': Face(panel(BLACK, 2, bevel=None), 'footu')})
        variants[{0: 'geometry.fnar.party_table', 1: 'geometry.fnar.party_table_end', 2: 'geometry.fnar.party_table_middle'}[part]] = ([bn], (0, 0, 0))
    out.geo(g, variants)
    out.tex('party_table', g.paint())
    perms = [(bs('fnar:part', 1), {'minecraft:geometry': 'geometry.fnar.party_table_end'}),
             (bs('fnar:part', 2), {'minecraft:geometry': 'geometry.fnar.party_table_middle'})]
    blk = block_json('party_table', geometry='geometry.fnar.party_table', materials=mi_set('party_table'),
                     states={'fnar:part': {'values': {'min': 0, 'max': 2}}},
                     collision=box(-8, 0, -8, 8, 16, 8), selection=box(-8, 0, -8, 8, 16, 8), map_color='#a8a294', destroy=1.5,
                     perms=perms)
    out.block('party_table', blk)
    f = {'focus': [0, 0.5, 0], 'dist': 2.4}
    run = [{'states': {'fnar:part': 1, 'minecraft:cardinal_direction': 'north'}, 'pos': [0, 0, -1]},
           {'states': {'fnar:part': 2, 'minecraft:cardinal_direction': 'north'}, 'pos': [0, 0, 0]},
           {'states': {'fnar:part': 1, 'minecraft:cardinal_direction': 'south'}, 'pos': [0, 0, 1]}]
    run_ew = [{'states': {'fnar:part': 1, 'minecraft:cardinal_direction': 'east'}, 'pos': [1, 0, 0]},
              {'states': {'fnar:part': 1, 'minecraft:cardinal_direction': 'west'}, 'pos': [0, 0, 0]}]
    out.views('party_table', [{'label': 'single', 'states': {'fnar:part': 0}, **f},
                              {'label': 'end+middle+end (N-S run)', 'parts': run, 'focus': [0, 0.4, 0], 'dist': 3.6},
                              {'label': 'end west + end east (E-W run)', 'parts': run_ew, 'focus': [0.5, 0.4, 0], 'dist': 3.2},
                              {'label': 'middle (from below)', 'states': {'fnar:part': 2}, 'focus': [0, 0.5, 0], 'dist': 2.2, 'dir': [0.8, 0.12, -1]}])


# =============================================================== party chair
@prop
def party_chair(out):
    g = Geo('party_chair', 32, 32)
    plastic = lambda base=3, grime=0.3: panel(RED, base, amp=0.5, white_amp=0.3, grime=grime)

    def seat_top(r):
        plastic(4, 0.2)(r)
        r.bevel(1, -1)
        r.shade_rect(2, 2, r.w - 4, r.h - 4, -1)  # dished seat
        r.px(6, 3, RED, 5); r.px(7, 3, RED, 5)
        r.stain(GRIME, 2, 3, 6.5, 1.3, 1.0, p=0.8)  # old gum
        r.speck(RED, 1, 0.06)

    def back_front(r):
        plastic(3, 0.15)(r)
        r.bevel(1, -1)
        r.rect(3, 1, 4, 1, RED, 1)  # hand slot
        r.px(1, 3, RED, 5)

    tube = Face(panel(CHROME, 3, amp=0.4, streak='v', grime=0.3, bevel=None), 'tube')
    cap = Face(panel(BLACK, 1, bevel=None), 'cap')
    for x in (-5, 4):
        for z in (-5, 4):
            g.box('legs', (x, 0.5, z), (x + 1, 7, z + 1), {'sides': tube})
            g.box('legs', (x, 0, z), (x + 1, 0.5, z + 1), {'sides': cap})
    g.box('seat', (-5.5, 7, -5.5), (5.5, 8, 5), {'up': seat_top, 'down': plastic(1), 'north': Face(plastic(3), 'se'), 'south': Face(plastic(3), 'se'),
                                                 'east': Face(plastic(3), 'ss'), 'west': Face(plastic(3), 'ss')})
    for x in (-4.5, 3.5):
        g.box('back', (x, 8, 4.25), (x + 1, 10.5, 5.25), {'sides': Face(panel(CHROME, 3, bevel=None), 'post')})
    g.box('back', (-5.5, 10.5, 4), (5.5, 15.5, 5.5), {'north': back_front, 'south': plastic(2, 0.4), 'east': Face(plastic(3), 'be'),
                                                      'west': Face(plastic(3), 'be'), 'up': plastic(4), 'down': plastic(1)})
    out.geo(g)
    out.tex('party_chair', g.paint())
    blk = block_json('party_chair', geometry='geometry.fnar.party_chair', materials=mi_set('party_chair'),
                     collision=box(-5.5, 0, -5.5, 5.5, 8, 5.5), selection=box(-5.5, 0, -5.5, 5.5, 15.5, 5.5), map_color='#731c1b', destroy=1.0)
    out.block('party_chair', blk)
    f = {'focus': [0, 0.45, 0], 'dist': 1.9}
    out.views('party_chair', [{'label': 'north', **f}, {'label': 'facing east', 'states': {'minecraft:cardinal_direction': 'east'}, **f}])


# =============================================================== party hat
HAT_COLORS = [('red', RED, WHITE), ('blue', BLUE, YELLOW), ('purple', PURPLE, GOLD), ('yellow', YELLOW, RED)]


@prop
def party_hat(out):
    g = Geo('party_hat', 16, 16)

    def cone(r):
        base, stripe = HAT_COLORS[int(r.variant)][1:]
        r.fill(base, 4, amp=0.4, white_amp=0.3)
        if r.face != 'up':
            for c in range(r.w):
                for rr in range(r.h):
                    x, y, z = r.world(c, rr)
                    u = x + z if r.face in ('north', 'south') else z - x
                    if int(math.floor(y + u + 40)) % 3 == 0:
                        r.px(c, rr, stripe, 4 if stripe is not WHITE else 5)
            r.bevel(1, -1, t=False, b=False)
        else:
            r.shade_rect(0, 0, r.w, r.h, -1)
        r.darken_noise(0.2, -1)

    def pom(r):
        r.fill(WHITE, 4, amp=0.8, white_amp=0.8, cell=1)
        r.speck(HAT_COLORS[int(r.variant)][2], 4, 0.15)

    for k in range(7):
        h = 2 - 0.25 * k
        g.box('hat', (-h, k, -h), (h, k + 1, h), {'sides': cone, 'up': cone})
    g.box('hat', (-0.75, 7, -0.75), (0.75, 8.5, 0.75), {'sides': Face(pom, 'pom'), 'ends': Face(pom, 'pomt')})
    out.geo(g)
    for i, (cname, _, _) in enumerate(HAT_COLORS):
        out.tex(f'party_hat_{cname}', g.paint(str(i)))
    perms = [(bs('fnar:color', i), {'minecraft:material_instances': mi_set(f'party_hat_{c}')}) for i, (c, _, _) in enumerate(HAT_COLORS)]
    blk = block_json('party_hat', geometry='geometry.fnar.party_hat', materials=mi_set('party_hat_red'),
                     states={'fnar:color': {'values': {'min': 0, 'max': 3}}}, facing=False,
                     collision=False, selection=box(-2, 0, -2, 2, 8.5, 2), map_color='#731c1b', destroy=0.3, perms=perms)
    out.block('party_hat', blk)
    f = {'focus': [0, 0.27, 0], 'dist': 1.15}
    out.views('party_hat', [{'label': f'color {i} {c}', 'states': {'fnar:color': i}, **f} for i, (c, _, _) in enumerate(HAT_COLORS)])


# =============================================================== pizza box
@prop
def pizza_box(out):
    g = Geo('pizza_box', 32, 32)

    def top(r):  # 12 x 12 lid with the red Rustgrin's logo
        r.fill(CARD, 4, amp=0.5, white_amp=0.35)
        r.bevel(1, -1)
        r.disc(6, 6.5, 5.6, RED, 3)
        r.disc(6, 6.5, 5.6, RED, 1, ring=0.9)
        logo = ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#']  # bold 'R' monogram
        r.blit(logo, {'#': (PAPER, 5)}, 4, 3)
        r.blit(['####', '#...', '#...', '####', '#.#.', '#..#', '#...'], {'#': (PAPER, 4)}, 4, 3)
        r.stain(CARD, 2, 10.5, 1.5, 1.6, 1.3, p=0.7)  # grease spot
        r.darken_noise(0.2, -1)
        r.rot180()  # read upright from the front of the block

    def side(r):  # 12 x 2: lid edge over base, corrugation
        r.fill(CARD, 3, amp=0.4)
        r.hline(0, 0, r.w, CARD, 4)
        for c in range(1, r.w, 2):
            r.px(c, 1, CARD, 1)
        if r.face == 'north':
            r.hline(r.w // 2 - 2, 0, 4, RED, 3)

    def bottom(r):
        r.fill(CARD, 2, amp=0.4)
        r.stain(GRIME, 1, 6, 6, 3, 3, p=0.5)

    faces = {'up': Face(top, 'top'), 'down': Face(bottom, 'bot'), 'north': Face(side, 'sn'), 'south': Face(side, 'ss'),
             'east': Face(side, 'se'), 'west': Face(side, 'sw')}
    g.box('box1', (-6, 0, -6), (6, 2, 6), faces)
    g.box('box2', (-6, 2, -6), (6, 4, 6), faces, rotation=(0, -22.5, 0), pivot=(0, 3, 0))
    g.box('box3', (-5, 4, -7), (7, 6, 5), faces)
    out.geo(g, {'geometry.fnar.pizza_box': (['box1'], (0, 0, 0)), 'geometry.fnar.pizza_box_2': (['box1', 'box2'], (0, 0, 0)),
                'geometry.fnar.pizza_box_3': (['box1', 'box2', 'box3'], (0, 0, 0))})
    out.tex('pizza_box', g.paint())
    perms = [(bs('fnar:count', 2), {'minecraft:geometry': 'geometry.fnar.pizza_box_2', 'minecraft:selection_box': box(-8, 0, -8, 8, 4, 8)}),
             (bs('fnar:count', 3), {'minecraft:geometry': 'geometry.fnar.pizza_box_3', 'minecraft:selection_box': box(-8, 0, -8, 8, 6, 8)})]
    blk = block_json('pizza_box', geometry='geometry.fnar.pizza_box', materials=mi_set('pizza_box'),
                     states={'fnar:count': {'values': {'min': 1, 'max': 3}}},
                     collision=False, selection=box(-6, 0, -6, 6, 2, 6), map_color='#715332', destroy=0.5, perms=perms)
    out.block('pizza_box', blk)
    f = {'focus': [0, 0.15, 0], 'dist': 1.4, 'dir': [0.6, 0.8, -1]}
    out.views('pizza_box', [{'label': f'count {n}', 'states': {'fnar:count': n}, **f} for n in (1, 2, 3)] +
              [{'label': 'count 3, facing east', 'states': {'fnar:count': 3, 'minecraft:cardinal_direction': 'east'}, **f}])


# =============================================================== plate set
@prop
def plate_set(out):
    g = Geo('plate_set', 32, 32)

    def plate(r):
        r.fill(PAPER, 5, amp=0.3, white_amp=0.3)
        if r.face == 'up':
            for c in range(r.w):
                for rr in range(r.h):
                    x, _, z = r.world(c, rr)
                    if c in (0, r.w - 1) or rr in (0, r.h - 1):
                        r.shift(c, rr, -1)
            r.speck(CLOTH_RED, 3, 0.12)  # sauce smears
            r.speck(CARD, 4, 0.06)
        else:
            r.shade_rect(0, 0, r.w, r.h, -1)

    def crust(r):
        r.fill(CARD, 4, amp=0.6, white_amp=0.5)
        if r.face == 'up':
            r.px(0, 0, CARD, 5)

    def cup(r):
        if r.face == 'up':
            r.fill(RED, 1); r.px(0, 0, RED, 4); r.px(1, 1, BLACK, 1)
            return
        r.fill(RED, 3, amp=0.3)
        r.hline(0, 0, r.w, PAPER, 5)
        r.bevel(1, -1, t=False, b=False)

    def straw(r):
        r.fill(WHITE, 5)
        for rr in range(0, r.h, 2):
            r.px(0, rr, RED, 4)

    for (cx, cz) in ((-3, -2), (3, 3)):
        g.box('plates', (cx - 2, 0, cz - 3), (cx + 2, 0.5, cz + 3), {'up': Face(plate, f'pu{cx}'), 'sides': Face(plate, 'ps')})
        for sx in (-1, 1):
            x0 = cx + 2 if sx > 0 else cx - 3
            g.box('plates', (x0, 0, cz - 2), (x0 + 1, 0.5, cz + 2), {'up': Face(plate, f'pw{cx}{sx}'), 'sides': Face(plate, 'pws')})
    g.box('food', (-4, 0.5, -3), (-2, 1.25, -2), {'sides': Face(crust, 'c'), 'up': Face(crust, 'cu')}, rotation=(0, 22.5, 0), pivot=(-3, 0.5, -2.5))
    g.box('food', (-3, 0.5, -0.5), (-1.5, 1.25, 0.5), {'sides': Face(crust, 'c2'), 'up': Face(crust, 'cu2')})
    g.box('food', (2, 0.5, 2), (4, 1.25, 3), {'sides': Face(crust, 'c'), 'up': Face(crust, 'cu')}, rotation=(0, -45, 0), pivot=(3, 0.5, 2.5))
    g.box('cup', (3, 0, -6), (5, 3, -4), {'sides': Face(cup, 'cup'), 'up': Face(cup, 'cupu')})
    g.box('cup', (4, 3, -5.25), (4.5, 5, -4.75), {'sides': Face(straw, 'straw')}, rotation=(0, 0, -22.5), pivot=(4.25, 3, -5))
    out.geo(g)
    out.tex('plate_set', g.paint())
    blk = block_json('plate_set', geometry='geometry.fnar.plate_set', materials=mi_set('plate_set'), facing=False,
                     collision=False, selection=box(-6, 0, -6, 6, 3, 6.5), map_color='#c0b8a5', destroy=0.3)
    out.block('plate_set', blk)
    out.views('plate_set', [{'label': 'top', 'focus': [0, 0.05, 0], 'dist': 1.3, 'dir': [0.5, 1, -0.8]}])


# =============================================================== balloons
BALLOON_SETS = [(RED, YELLOW, BLUE), (PURPLE, GREEN, ORANGE), (PINK, TEAL, SILVER)]


@prop
def balloons(out):
    g = Geo('balloons', 32, 32)

    def skin(k):
        def p(r):
            m = BALLOON_SETS[int(r.variant)][k]
            r.fill(m, 3, amp=0.3, white_amp=0.25)
            if r.face in ('north', 'south', 'east', 'west'):
                r.px(1, 1, m, 5); r.px(1, 2, m, 4); r.px(2, 1, m, 4)  # specular spot
                r.hline(0, r.h - 1, r.w, m, 2)
                r.speck(GRIME, 3, 0.06)
            elif r.face == 'up':
                r.px(1, 1, m, 5)
            else:
                r.shade_rect(0, 0, r.w, r.h, -1)
        return p

    def string(r):
        r.fill(PAPER, 4)
        for rr in range(0, r.h, 3):
            r.px(0, rr, PAPER, 2)

    def weight(r):
        r.fill(IRON, 3, amp=0.4); r.bevel(1, -1)

    g.box('weight', (-1, 0, -1), (1, 1, 1), {'sides': Face(weight, 'w'), 'up': weight})
    specs = [('b0', (0, 0, 22.5), 9, 0), ('b1', (0, 0, -22.5), 8, 1), ('b2', (-22.5, 0, 0), 9.4, 2)]
    for name, rot, L, k in specs:
        g.bone(name, pivot=(0, 1, 0), rotation=rot)
        top = 1 + L
        g.box(name, (-0.25, 1, 0), (0.25, top, 0), {'north': Face(string, 'str')})
        g.box(name, (0, 1, -0.25), (0, top, 0.25), {'east': Face(string, 'str')})
        sk = skin(k)
        g.box(name, (-0.5, top, -0.5), (0.5, top + 1, 0.5), {'sides': Face(sk, f'k{k}'), 'down': Face(sk, f'kd{k}')})
        g.box(name, (-1, top + 1, -1), (1, top + 2, 1), {'sides': Face(sk, f't{k}'), 'down': Face(sk, f'td{k}')})
        g.box(name, (-2, top + 2, -2), (2, top + 5, 2), {'sides': Face(sk, f's{k}'), 'down': Face(sk, f'd{k}')})
        g.box(name, (-1.5, top + 5, -1.5), (1.5, top + 6, 1.5), {'sides': Face(sk, f'c{k}'), 'up': Face(sk, f'u{k}')})
    out.geo(g)
    for i in range(len(BALLOON_SETS)):
        out.tex(f'balloons_{i}', g.paint(str(i)))
    perms = [(bs('fnar:color', i), {'minecraft:material_instances': mi_set(f'balloons_{i}')}) for i in range(len(BALLOON_SETS))]
    blk = block_json('balloons', geometry='geometry.fnar.balloons', materials=mi_set('balloons_0'),
                     states={'fnar:color': {'values': {'min': 0, 'max': 2}}},
                     collision=False, selection=box(-7, 0, -7, 7, 16, 4), map_color='#8b2824', destroy=0.3, perms=perms)
    out.block('balloons', blk)
    f = {'focus': [0, 0.6, 0], 'dist': 2.8, 'dir': [0.25, 0.3, -1]}
    out.views('balloons', [{'label': f'color {i}', 'states': {'fnar:color': i}, **f} for i in range(3)])


# =============================================================== bunting
@prop
def bunting(out):
    g = Geo('bunting', 16, 16)
    cols = [RED, YELLOW, BLUE, GREEN]

    def flags(r):  # 16 x 7 plane: sagging string + 4 triangle flags, transparent elsewhere
        r.clear()
        sag = [1 + round(math.sin(math.pi * (c + 0.5) / 16) * 1.3) for c in range(16)]
        for c in range(16):
            r.px(c, sag[c] - 1 if c in (0, 15) else sag[c], PAPER, 2)
        for k in range(4):
            c0 = 4 * k + 1
            m = cols[k]
            top = max(sag[c0:c0 + 3]) + 1
            tri = [(0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (2, 1), (1, 2), (1, 3)]
            if k % 2:
                tri += [(0, 2), (2, 2)]
            for dx, dy in tri:
                r.px(c0 + dx, top + dy, m, 4 if dy == 0 else 3)
            r.px(c0, top, m, 5)
            r.px(c0 + 2, top + 1, m, 2)
        r.darken_noise(0.3, -1, cell=2)

    g.box('flags', (-8, 9, 7.5), (8, 16, 7.5), {'north': flags})
    out.geo(g)
    out.tex('bunting', g.paint())
    blk = block_json('bunting', geometry='geometry.fnar.bunting', materials=mi_set('bunting'),
                     collision=False, selection=box(-8, 9, 7, 8, 16, 8), map_color='#8b2824', destroy=0.3)
    out.block('bunting', blk)
    rowp = [{'states': {}, 'pos': [x, 0, 0]} for x in (-1, 0, 1)]
    out.views('bunting', [{'label': 'three in a row', 'env': 'wall', 'parts': rowp, 'focus': [0, 0.75, 0.3], 'dist': 2.6, 'dir': [0.3, 0.1, -1]}])


# =============================================================== arcade cabinet (2 blocks tall)
def _arcade_screen(r):
    """12 x 7 'RAT RACE' maze game; frame = r.frame (rat runs right along the corridor, cat follows)."""
    k = r.frame
    maze = ['############',
            '#o o o o oC#',
            '# ## ## ## #',
            '#o o o o o #',
            '# ## ## ## #',
            '#Co o o o o#',
            '############']
    for rr, row in enumerate(maze):
        for c, ch in enumerate(row):
            if ch == '#':
                r.px(c, rr, SCR, 3 if (rr in (0, 6) or c in (0, 11)) else 2)
            elif ch == 'o':
                r.px(c, rr, SCR_DOT, 0)
            elif ch == 'C':
                r.px(c, rr, SCR_CHEESE, 1 + (k % 2))
            else:
                r.px(c, rr, SCR, 0)
    rat_x = 2 + 2 * k  # the rat runs right along the middle corridor, eating dots
    for c in range(1, rat_x + 1):
        r.px(c, 3, SCR, 0)
    r.px(rat_x, 3, SCR_RAT, 2); r.px(rat_x - 1, 3, SCR_RAT, 0)
    cat = [(10, 5), (10, 4) if False else (9, 5), (8, 5), (7, 5)][k]  # the cat prowls the bottom corridor
    r.px(cat[0], cat[1], SCR_CAT, 2)


@prop
def arcade_cabinet(out):
    g = Geo('arcade_cabinet', 64, 64)
    paint = lambda base=2, grime=0.3: panel(BLACK, base, amp=0.5, white_amp=0.35, grime=grime)

    def side_art(r):
        """Side panels: black with a purple sweep and a yellow racing stripe, continuous over both halves."""
        r.fill(BLACK, 3, amp=0.4, white_amp=0.3)
        for c in range(r.w):
            for rr in range(r.h):
                x, y, z = r.world(c, rr)
                t = y - 0.9 * (z + 8)
                if 4 < t < 9:
                    r.px(c, rr, PURPLE, 3 if 5 < t < 8 else 2)
                elif 9 <= t < 10.5:
                    r.px(c, rr, YELLOW, 5)
                if z < -0.5 + (-3 if y > 16 else 0) and False:
                    pass
        # T-molding along the front edge (first/last column depending on side)
        edge = r.w - 1 if r.face == 'east' else 0
        for rr in range(r.h):
            r.px(edge, rr, YELLOW, 3)
        r.darken_noise(0.25, -1, bottom=0.4)
        r.speck(GREYPLAST, 1, 0.04)  # scuffs

    def coin_door(r):  # body front 14 x 10
        paint(2, 0.4)(r)
        r.rect(4, 2, 6, 6, STEEL, 3); r.frame_rect(4, 2, 6, 6, STEEL, 1)
        r.px(4, 2, STEEL, 5)
        for cx in (5, 8):
            r.px(cx, 4, COIN_GLOW, 2); r.px(cx, 5, BLACK, 0)  # lit coin slots
        r.hline(6, 6, 2, BLACK, 1)  # coin return
        r.px(9, 7, CHROME, 4)  # lock
        r.speck(RUST, 2, 0.05, only=STEEL)

    def deck_top(r):  # control panel 14 x 4 (rows north..south)
        r.fill(BLACK, 3, amp=0.3)
        r.hline(0, 0, r.w, YELLOW, 3)
        r.px(10, 1, RED, 5); r.px(12, 1, YELLOW, 5)  # buttons
        r.px(12, 2, WHITE, 3)
        r.blit(['#.##', '.#.#'], {'#': (PAPER, 3)}, 1, 2) if False else None
        r.darken_noise(0.2, -1)

    def deck_front(r):
        r.fill(BLACK, 2, amp=0.3)
        r.hline(0, 0, r.w, YELLOW, 2)
        r.text('1P', 2, 0, PAPER, 2, font={'1': ['#', '#'], 'P': ['##', '#.']}) if r.h >= 2 else None

    def bezel(r):
        paint(1, 0.2)(r)

    def marquee(r):  # 16 x 9 lit header "RAT" / "RACE"
        r.fill(MARQ_BG, 2, amp=0.4, white_amp=0.3)
        r.frame_rect(0, 0, r.w, r.h, MARQ_BG, 0)
        f = dict(FONT_3x4)
        f['E'] = ['###', '#..', '##.', '###']
        w1 = r.text_width('RAT', f)
        r.text('RAT', (r.w - w1) // 2, 0, MARQ_TXT, 3, font=f)
        w2 = r.text_width('RACE', f)
        r.text('RACE', (r.w - w2 + 1) // 2, 5, MARQ_TXT, 2, font=f)
        r.speck(MARQ_BG, 0, 0.08, only=MARQ_BG)

    def marquee_frame(r):
        r.fill(BLACK, 2, amp=0.3)
        if r.face == 'up':
            r.speck(GRIME, 3, 0.4)

    # ---- lower half (y 0..16)
    g.box('lower', (-7, 0, -5), (7, 1, 7), {'sides': Face(panel(BLACK, 1, bevel=None), 'plinth')})
    g.box('lower', (-7, 1, -4), (7, 11, 7), {'north': coin_door, 'east': Face(side_art), 'west': Face(side_art), 'south': paint(1, 0.4),
                                            'up': Face(paint(2), 'lu')})
    g.box('lower', (-7, 11, -7), (7, 13, -2), {'up': deck_top, 'north': deck_front, 'east': Face(side_art), 'west': Face(side_art),
                                              'down': paint(1)})
    g.box('lower', (-7, 11, -2), (7, 16, 7), {'north': bezel, 'east': Face(side_art), 'west': Face(side_art), 'south': paint(1, 0.4)})
    g.box('lower', (-4, 13, -5.5), (-3, 14.5, -4.5), {'sides': Face(panel(BLACK, 3, bevel=None), 'stick')})
    g.box('lower', (-4.25, 14.5, -5.75), (-2.75, 16, -4.25), {'sides': Face(panel(RED, 4, bevel=None), 'ball'), 'up': Face(panel(RED, 5, bevel=None), 'ballt')})
    # ---- upper half (y 16..32)
    for x0, x1 in ((-7, -6), (6, 7)):
        inner = 'east' if x0 < 0 else 'west'
        outer = 'west' if x0 < 0 else 'east'
        g.box('upper', (x0, 16, -3), (x1, 23, 7), {outer: Face(side_art), inner: Face(paint(1), f'pin'), 'north': Face(paint(3), 'pfront')})
    g.box('upper', (-6, 16, -1), (6, 23, 7), {'north': Face(_arcade_screen, mi='screen', flip=4), 'south': paint(1, 0.4)})
    g.box('upper', (-8, 23, -4), (8, 32, 7), {'north': Face(marquee, mi='marquee'), 'east': Face(side_art), 'west': Face(side_art),
                                              'up': marquee_frame, 'down': marquee_frame, 'south': paint(1, 0.4)})
    out.geo(g, {'geometry.fnar.arcade_cabinet': (['lower'], (0, 0, 0)), 'geometry.fnar.arcade_cabinet_upper': (['upper'], (0, -16, 0))})
    out.tex('arcade_cabinet', g.paint())
    out.tex('arcade_screen', [g.paint(frame=k, only_flip=True) for k in range(4)])
    out.flipbook('arcade_screen', 6)
    mats = mi_set('arcade_cabinet', {'screen': glow('arcade_screen'), 'marquee': glow('arcade_cabinet')})
    perms = [(bs('fnar:half', 1), {'minecraft:geometry': 'geometry.fnar.arcade_cabinet_upper', 'minecraft:light_emission': 6,
                                   'minecraft:collision_box': box(-8, 0, -4, 8, 16, 7), 'minecraft:selection_box': box(-8, 0, -4, 8, 16, 7)})]
    blk = block_json('arcade_cabinet', geometry='geometry.fnar.arcade_cabinet', materials=mats,
                     states={'fnar:half': {'values': {'min': 0, 'max': 1}}},
                     collision=box(-7, 0, -7, 7, 16, 7), selection=box(-7, 0, -7, 7, 16, 7), map_color='#1a1a1e', destroy=2.5, perms=perms)
    out.block('arcade_cabinet', blk)
    out.light('arcade_cabinet', '#c890ff', 'point_light')
    two = lambda d: [{'states': {'fnar:half': 0, 'minecraft:cardinal_direction': d}, 'pos': [0, 0, 0]},
                     {'states': {'fnar:half': 1, 'minecraft:cardinal_direction': d}, 'pos': [0, 1, 0]}]
    f = {'focus': [0, 1.0, 0], 'dist': 4.0}
    out.views('arcade_cabinet', [{'label': 'both halves', 'parts': two('north'), **f},
                                 {'label': 'screen + marquee, frame 2', 'parts': two('north'), 'frame': 2, 'focus': [0, 1.55, 0], 'dist': 1.9, 'dir': [0.2, 0.05, -1]},
                                 {'label': 'facing west', 'parts': two('west'), **f}])


# =============================================================== stage star
@prop
def stage_star(out):
    g = Geo('stage_star', 32, 32)

    def star_mask(c, rr, grow=0.0):
        # five-point star centred in a 14 x 14 face, point up
        x, y = c + 0.5 - 7, 7 - (rr + 0.5) + 0.6
        a = math.atan2(x, y)
        d = math.hypot(x, y)
        k = (a % (2 * math.pi / 5)) / (2 * math.pi / 5)
        tri = abs(k - 0.5) * 2  # 1 at points, 0 between
        rad = 3.0 + 4.1 * tri ** 1.6
        return d <= rad + grow

    def front(r):
        r.clear()
        for c in range(r.w):
            for rr in range(r.h):
                if star_mask(c, rr):
                    edge = not (star_mask(c - 1, rr) and star_mask(c + 1, rr) and star_mask(c, rr - 1) and star_mask(c, rr + 1))
                    if edge:
                        r.px(c, rr, GOLD, 6, emit=90)
                    else:
                        r.px(c, rr, GOLD, 4)
        r.fill(GOLD, 4, amp=0.6, white_amp=0.4, cell=3, rect=None) if False else None
        for c in range(r.w):
            for rr in range(r.h):
                m_, i_ = r.get(c, rr)
                if m_ is GOLD and i_ == 4:
                    x, y = c - 7, rr - 7
                    if x + y < -3:
                        r.shift(c, rr, 1)
                    elif x + y > 4:
                        r.shift(c, rr, -1)
        r.speck(WOOD, 2, 0.08, only=GOLD)  # chipped paint shows the wood
        r.speck(GOLD, 2, 0.1, only=GOLD)

    def back(r):
        r.clear()
        for c in range(r.w):
            for rr in range(r.h):
                if star_mask(c, rr, 0.9):
                    r.px(c, rr, WOOD, 1)

    g.box('star', (-7, 1, 7.25), (7, 15, 7.25), {'north': front})
    g.box('star', (-7, 1, 7.75), (7, 15, 7.75), {'north': back})
    out.geo(g)
    out.tex('stage_star', g.paint())
    blk = block_json('stage_star', geometry='geometry.fnar.stage_star', materials=mi_set('stage_star'),
                     collision=False, selection=box(-7, 1, 7, 7, 15, 8), map_color='#a8822c', destroy=0.5, light=2)
    out.block('stage_star', blk)
    out.light('stage_star', '#ffd27a', 'static_light')
    out.views('stage_star', [{'label': 'north', 'env': 'wall', 'focus': [0, 0.5, 0.4], 'dist': 1.7, 'dir': [0.35, 0.2, -1]},
                             {'label': 'oblique', 'env': 'wall', 'focus': [0, 0.5, 0.4], 'dist': 1.6, 'dir': [1, 0.3, -0.6]}] + pillar_views(dist=3.8))


# =============================================================== stage speaker
@prop
def stage_speaker(out):
    g = Geo('stage_speaker', 64, 64)
    cab = lambda base=2, grime=0.35: panel(BLACK, base, amp=0.5, white_amp=0.35, grime=grime)

    def grille(r):  # 14 x 14 cloth: weave + faint woofer/horn outlines
        r.fill(GREYPLAST, 1, amp=0.25, white_amp=0.3)
        for c in range(r.w):
            for rr in range(r.h):
                if (c + rr) % 2 == 0:
                    r.shift(c, rr, -1)
        r.disc(7, 9, 4.6, GRILLE, 2, ring=0.9)
        r.disc(7, 9, 1.6, GREYPLAST, 2)
        r.disc(7, 3, 1.6, GRILLE, 2, ring=0.8)
        r.speck(GREYPLAST, 1, 0.04)  # lint
        r.darken_noise(0.25, -1, bottom=0.8)

    def frame(r):
        cab(3, 0.3)(r)
        r.speck(GREYPLAST, 2, 0.08)  # scuffs

    def corner(r):
        r.fill(STEEL, 4, amp=0.3); r.bevel(1, -1)
        r.px(0, 0, CHROME, 4)

    def side(r):
        cab(2)(r)
        r.rect(r.w // 2 - 2, 3, 4, 2, BLACK, 0)  # recessed handle
        r.hline(r.w // 2 - 2, 3, 4, BLACK, 1)
        r.speck(GREYPLAST, 1, 0.05)

    def badge(r):
        r.fill(GOLD, 4); r.bevel(1, -1); r.px(1, 0, GOLD, 6)

    g.box('cab', (-8, 0, -4), (8, 16, 5), {'north': grille, 'south': cab(2), 'east': Face(side, 'side'), 'west': Face(side, 'side'),
                                           'up': cab(3, 0.5), 'down': cab(1)})
    fr = lambda k: Face(frame, k)
    g.box('frame', (-8, 15, -5), (8, 16, -4), {'north': fr('h'), 'down': fr('hd'), 'up': fr('hu'), 'east': fr('e'), 'west': fr('e')})
    g.box('frame', (-8, 0, -5), (8, 1, -4), {'north': fr('h'), 'up': fr('hd'), 'east': fr('e'), 'west': fr('e')})
    g.box('frame', (-8, 1, -5), (-7, 15, -4), {'north': fr('v'), 'east': fr('vi'), 'west': fr('vi')})
    g.box('frame', (7, 1, -5), (8, 15, -4), {'north': fr('v'), 'east': fr('vi'), 'west': fr('vi')})
    for x in (-8, 6):
        for y in (0, 14):
            g.box('corners', (x, y, -5.5), (x + 2, y + 2, -5), {'north': Face(corner, 'cn'), 'sides': Face(corner, 'cs'), 'ends': Face(corner, 'ce')})
    g.box('frame', (-1.5, 1.5, -4.5), (1.5, 2.5, -4), {'north': Face(badge, 'b'), 'sides': Face(badge, 'bs'), 'ends': Face(badge, 'be')})
    out.geo(g)
    out.tex('stage_speaker', g.paint())
    blk = block_json('stage_speaker', geometry='geometry.fnar.stage_speaker', materials=mi_set('stage_speaker'),
                     collision=box(-8, 0, -5, 8, 16, 5), selection=box(-8, 0, -5.5, 8, 16, 5), map_color='#141418', destroy=2.0)
    out.block('stage_speaker', blk)
    f = {'focus': [0, 0.5, 0], 'dist': 2.6}
    out.views('stage_speaker', [{'label': 'north', **f}, {'label': 'facing west', 'states': {'minecraft:cardinal_direction': 'west'}, **f}])


# =============================================================== guitar amp (Mirehop's)
@prop
def guitar_amp(out):
    g = Geo('guitar_amp', 32, 32)
    tolex = lambda base=3, grime=0.3: panel(TOLEX, base, amp=0.7, white_amp=0.6, cell=1.5, grime=grime)

    def front(r):  # 12 x 10: control strip on top, grille cloth with piping and an 'M' badge
        tolex(3)(r)
        r.hline(1, 1, 10, CHROME, 3)
        r.px(1, 1, CHROME, 5)
        r.rect(1, 3, 10, 6, GRILLE, 3)
        for c in range(1, 11):
            for rr in range(3, 9):
                if (c + rr) % 2 == 0:
                    r.px(c, rr, TOLEX, 2)
        r.frame_rect(1, 3, 10, 6, CLOTH, 2)  # piping
        r.blit(['#...#', '##.##', '#.#.#'], {'#': (GOLD, 5)}, 2, 4)  # 'M' badge (Mirehop)
        r.bevel(1, -1)
        r.speck(GRIME, 2, 0.05)

    def back(r):
        tolex(2)(r)
        r.rect(1, 2, 10, 6, GRILLE, 1)
        r.disc(6, 5, 2.6, BLACK, 3)

    def knob(r):
        if r.face == 'up':
            r.fill(CHROME, 4)
        else:
            r.fill(BLACK, 2 if r.face == 'north' else 1)

    g.box('amp', (-6, 0, -3), (6, 10, 4), {'north': front, 'south': back, 'east': Face(tolex(3), 'side'), 'west': Face(tolex(3), 'side'),
                                           'up': tolex(4, 0.4), 'down': tolex(1)})
    for k in range(5):
        x = 4.5 - 2 * k
        g.box('knobs', (x - 0.375, 8.625, -3.5), (x + 0.375, 9.375, -3), {'north': Face(knob, 'kn'), 'sides': Face(knob, 'ks'), 'up': Face(knob, 'ku')})
    g.box('handle', (-2.5, 10, -0.5), (2.5, 10.75, 0.5), {'sides': Face(panel(BLACK, 3, bevel=None), 'h'), 'up': Face(panel(BLACK, 4, bevel=None), 'hu')})
    for x in (-3, 2.5):
        g.box('handle', (x, 10, -0.75), (x + 0.5, 11, 0.75), {'sides': Face(panel(CHROME, 3, bevel=None), 'hc'), 'up': Face(panel(CHROME, 4), 'hcu')})
    out.geo(g)
    out.tex('guitar_amp', g.paint())
    blk = block_json('guitar_amp', geometry='geometry.fnar.guitar_amp', materials=mi_set('guitar_amp'),
                     collision=box(-6, 0, -3.75, 6, 10, 4), selection=box(-6, 0, -3.75, 6, 11, 4), map_color='#1a261d', destroy=1.5)
    out.block('guitar_amp', blk)
    f = {'focus': [0, 0.32, 0], 'dist': 1.6}
    out.views('guitar_amp', [{'label': 'north', **f}, {'label': 'back (facing south)', 'states': {'minecraft:cardinal_direction': 'south'}, **f}])
