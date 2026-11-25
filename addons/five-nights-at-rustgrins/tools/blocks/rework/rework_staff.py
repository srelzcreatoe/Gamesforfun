"""Backstage and the Staff Room: a costume rail, a make-up mirror ringed with bulbs, a vending machine, the break
table, a worn sofa, and the kitchenette's coffee machine and microwave. Models face north, wall props have their
back at z = +8."""
from propkit import Geo, Face, prop, panel, block_json, box, mi_set, glow, bs
from rework_pal import *  # noqa: F403

HALF = {'fnar:half': {'values': {'min': 0, 'max': 1}}}
FUR_G = Mat('rw_fur_grey', ['#2c2a28', '#3c3936', '#4c4945', '#5d5954', '#6e6a63'], rough=245, h=138, hk=5)
FUR_N = Mat('rw_fur_green', ['#1f2a13', '#2e3d1c', '#3e5226', '#4f6730', '#617d3a'], rough=245, h=138, hk=5)
FUR_K = Mat('rw_fur_black', ['#0e0d10', '#151418', '#1e1c21', '#28262c', '#333038'], rough=245, h=138, hk=5)
MAROON = Mat('rw_maroon', ['#200a0e', '#2e0f15', '#3e151c', '#4e1b24', '#5f222c'], rough=235, h=136, hk=3)
SATIN = Mat('rw_satin', ['#2a1440', '#3b1d58', '#4d2871', '#61358b', '#7645a4'], rough=120, h=138, hk=3)


# =============================================================== the costume rail
@prop
def costume_rack(out):
    """One cell of a rolling costume rail (cells side by side along x make a long one): a chrome rail on a post,
    costumes on hangers. fnar:kind 0 the band's spare suits (grey, green, black fur), 1 the Midway's wardrobe (a
    maroon tailcoat, purple satin, a red cape), 2 bare hangers and one shirt."""
    g = Geo('costume_rack', 64, 64)

    def cloth(m, trim=None):
        def p(r):
            r.fill(m, 2, amp=0.7, white_amp=0.4, streak='v', cell=3)
            r.bevel(1, -1)
            if trim is not None and r.h > 6:
                r.hline(0, 3, r.w, trim, 3); r.px(r.w // 2, 5, trim, 4)
            r.darken_noise(0.3, -1, bottom=0.7)
        return p

    def hanger(r):
        r.clear()
        for x in range(r.w):
            r.px(x, min(r.h - 1, abs(x - r.w // 2) // 2), STEEL, 4)

    g.box('rail', (-8, 14, -0.5), (8, 15, 0.5), {'*': Face(chrome(3), 'rail')})
    g.box('rail', (-8, 0, -0.5), (-7, 14, 0.5), {'sides': Face(chrome(3), 'post')})
    g.box('rail', (-8, 0, -5), (-7, 1, 5), {'sides': Face(panel(BLACK, 2, bevel=None), 'foot'), 'up': Face(panel(BLACK, 3, bevel=None), 'footu')})
    sets = {'k0': ((FUR_G, None), (FUR_N, None), (FUR_K, PURP_P)), 'k1': ((MAROON, GOLD), (SATIN, None), (CANVAS_R, GOLD)), 'k2': ((None, None), (CLOTH, None), (None, None))}
    for bone, items in sets.items():
        for k, (m, trim) in enumerate(items):
            x = -5.5 + k * 4.5
            g.box(bone, (x + 1, 12, -3), (x + 1, 14, 3), {'east': Face(hanger, 'hg'), 'west': Face(hanger, 'hg')})
            if m is None:
                continue
            h0 = (2, 4, 3)[k]
            g.box(bone, (x, h0, -4), (x + 2, 12, 4), {'east': cloth(m, trim), 'west': Face(cloth(m, trim), f'{bone}w{k}'), 'north': Face(cloth(m), f'{bone}n{k}'), 'south': Face(cloth(m), f'{bone}n{k}'),
                                                     'up': Face(cloth(m), f'{bone}u{k}'), 'down': Face(cloth(m), f'{bone}u{k}')})
    out.geo(g, {f'geometry.fnar.costume_rack{"" if k == 0 else f"_{k}"}': (['rail', f'k{k}'], (0, 0, 0)) for k in range(3)})
    out.tex('costume_rack', g.paint())
    perms = [(bs('fnar:kind', k), {'minecraft:geometry': f'geometry.fnar.costume_rack_{k}'}) for k in (1, 2)]
    out.block('costume_rack', block_json('costume_rack', geometry='geometry.fnar.costume_rack', materials=mi_set('costume_rack'), states={'fnar:kind': [0, 1, 2]},
                                         collision=box(-8, 0, -4, 8, 15, 4), selection=box(-8, 0, -5, 8, 15, 5), map_color='#4c4945', destroy=1.0, perms=perms))


# =============================================================== the make-up mirror
@prop
def vanity_mirror(out):
    """A dressing-room mirror on the wall, ringed with bulbs. fnar:lit: the bulbs burn (light 9, warm); two are dead
    either way."""
    g = Geo('vanity_mirror', 64, 64)

    def face(r):
        on = r.variant == 'on'
        r.fill(MIRR, 3, amp=0.5, white_amp=0.15, cell=5)
        for k in range(7):
            r.px(4 + k, 10 - k, MIRR, 5)
        r.frame_rect(0, 0, r.w, r.h, OAK, 2); r.frame_rect(1, 1, r.w - 2, r.h - 2, OAK, 4)
        spots = [(x, 0) for x in range(2, r.w - 1, 3)] + [(x, r.h - 1) for x in range(2, r.w - 1, 3)] + [(0, y) for y in range(3, r.h - 2, 3)] + [(r.w - 1, y) for y in range(3, r.h - 2, 3)]
        for k, (x, y) in enumerate(spots):
            dead = k in (3, 9)
            if on and not dead:
                r.px(x, y, BULB, 3)
            else:
                r.px(x, y, BULB_OFF, 1 if dead else 3)
        r.speck(GRIME, 2, 0.04, rough=200, metal=0, only=MIRR)

    g.box('mirror', (-7, 1, 7), (7, 15, 8), {'north': Face(face, mi='lit'), 'sides': Face(wood(OAK, 2, bevel=None), 'e'), 'ends': Face(wood(OAK, 3, bevel=None), 'e2')})
    out.geo(g)
    out.tex('vanity_mirror', g.paint('off'))
    out.tex('vanity_mirror_on', g.paint('on'))
    out.block('vanity_mirror', block_json('vanity_mirror', geometry='geometry.fnar.vanity_mirror', materials=mi_set('vanity_mirror_on', {'lit': glow('vanity_mirror_on')}),
                                          states={'fnar:lit': [True, False]}, collision=False, selection=box(-7, 1, 7, 7, 15, 8), map_color='#9aa2b0', destroy=0.8, light=9,
                                          perms=[(bs('fnar:lit', False), {'minecraft:material_instances': mi_set('vanity_mirror', {'lit': 'vanity_mirror'}), 'minecraft:light_emission': 0})]))
    out.light('vanity_mirror', '#ffd08a', 'point_light')


# =============================================================== the vending machine
@prop
def vending_machine(out):
    """A cola machine, two blocks tall (fnar:half): a big lit front (light 6 on the upper half), a column of
    selection buttons, the dispensing bin, a coin return. Still humming in the Staff Room."""
    g = Geo('vending_machine', 64, 64)

    def front(r):
        up = r.cube.bone == 'upper'
        r.fill(RED_P, 4, amp=0.4, white_amp=0.25)
        r.frame_rect(0, 0, 16, 16, BLACK, 2)
        if up:
            r.rect(1, 1, 11, 15, RED_P, 5, emit=150)
            for x in range(1, 12):                                       # a white wave across the panel
                y = 9 + int(round(2.2 * __import__('math').sin(x * 0.7)))
                r.px(x, y, N_WHITE, 2); r.px(x, y + 1, N_WHITE, 1)
            r.text('COLA', 1, 2, N_WHITE, 3, font=FONT_3x4, spacing=0)
            for y in range(2, 14, 2):
                r.px(13, y, N_WHITE if y != 8 else N_RED, 1); r.px(14, y, BLACK, 3)
        else:
            r.rect(1, 0, 11, 5, RED_P, 5, emit=150)
            r.rect(2, 8, 10, 5, BLACK, 0); r.frame_rect(2, 8, 10, 5, STEEL, 3)
            r.rect(13, 2, 2, 3, STEEL, 3); r.px(13, 3, BLACK, 0); r.px(14, 7, CHROME, 4)
            r.darken_noise(0.3, -1, bottom=1.0)

    side = Face(flat(RED_P, 2, 0.35), 'side')
    for bone, y0 in (('lower', 0), ('upper', 16)):
        g.box(bone, (-8, y0, -6), (8, y0 + 16, 8), {'north': Face(front, mi='lit'), 'east': side, 'west': side, 'south': Face(steel(1, 0.4), 'back'), 'up': Face(flat(RED_P, 2, 0.5), 'top')})
    out.geo(g, {'geometry.fnar.vending_machine': (['lower'], (0, 0, 0)), 'geometry.fnar.vending_machine_upper': (['upper'], (0, -16, 0))})
    out.tex('vending_machine', g.paint())
    out.block('vending_machine', block_json('vending_machine', geometry='geometry.fnar.vending_machine', materials=mi_set('vending_machine', {'lit': glow('vending_machine')}),
                                            states=HALF, collision=box(-8, 0, -6, 8, 16, 8), selection=box(-8, 0, -6, 8, 16, 8), map_color='#8f1f1c', destroy=2.5, light=2,
                                            perms=[(bs('fnar:half', 1), {'minecraft:geometry': 'geometry.fnar.vending_machine_upper', 'minecraft:light_emission': 6})]))
    out.light('vending_machine', '#ff8a7a', 'point_light')


# =============================================================== the break table
@prop
def break_table(out):
    """The Staff Room's table: chipped laminate on a steel pedestal; two mugs, a full ashtray, last week's paper,
    a hand of cards nobody finished."""
    g = Geo('break_table', 64, 64)

    def top(r):
        r.fill(LAM, 3, amp=0.5, white_amp=0.3)
        r.bevel(1, -1)
        for cx, cy in ((4, 4), (11, 10)):
            r.disc(cx, cy, 1.8, GRIME, 3, ring=0.9)                        # coffee rings
        r.px(13, 3, LAM, 0); r.px(14, 3, LAM, 0); r.px(14, 4, BLACK, 2)

    def paper(r):
        r.fill(PAPER, 4, amp=0.3)
        r.rect(1, 1, r.w - 2, 2, GRIME, 1)
        for y in range(4, r.h - 1, 2):
            r.hline(1, y, r.w - 2, GRIME, 3)

    g.box('table', (-7, 11, -7), (7, 12.5, 7), {'up': top, 'sides': Face(panel(BLACK, 3, bevel=None), 'edge'), 'down': Face(panel(BLACK, 1, bevel=None), 'under')})
    g.box('table', (-1.5, 1, -1.5), (1.5, 11, 1.5), {'sides': Face(steel(2, 0.3, 'v'), 'ped')})
    g.box('table', (-5, 0, -5), (5, 1, 5), {'sides': Face(steel(2, 0.2), 'foot'), 'up': Face(steel(3, 0.4), 'footu')})
    for (x, z, m) in ((-5, -5, ENAMEL), (3, 1, BLUE_P)):
        g.box('things', (x, 12.5, z), (x + 2, 15, z + 2), {'sides': Face(flat(m, 4, 0.1, None), f'mug{m.name}'), 'up': Face(lambda r: (r.fill(GRIME, 0), r.frame_rect(0, 0, r.w, r.h, ENAMEL, 5)), 'coffee')})
    g.box('things', (-2, 12.5, 3), (1, 13.2, 6), {'sides': Face(panel(GLASSF, 3, bevel=None), 'ash'), 'up': Face(lambda r: (r.fill(GRIME, 2, amp=0.8), r.px(1, 1, PAPER, 5), r.px(2, 1, RUST, 4)), 'ashu')})
    g.box('things', (-6, 12.5, 0), (-1, 12.8, 5), {'up': paper, 'sides': Face(flat(PAPER, 2, 0, None), 'pe')})
    for k in range(3):
        g.box('things', (2 + k * 1.5, 12.5, -5 + k), (3.5 + k * 1.5, 12.6, -3 + k), {'up': Face(lambda r: (r.fill(ENAMEL, 6, amp=0.1), r.px(0, 0, RED_P, 4)), 'card')})
    out.geo(g)
    out.tex('break_table', g.paint())
    out.block('break_table', block_json('break_table', geometry='geometry.fnar.break_table', materials=mi_set('break_table'), facing=True,
                                        collision=box(-7, 0, -7, 7, 12.5, 7), selection=box(-7, 0, -7, 7, 15, 7), map_color='#7c6a50', destroy=1.5))


# =============================================================== the sofa
@prop
def sofa(out):
    """One cell of a brown corduroy sofa. fnar:kind 0 its left end (an arm on the west), 1 a middle seat, 2 its
    right end. Sagging, patched with tape."""
    g = Geo('sofa', 64, 64)

    def cord(b=3):
        def p(r):
            r.fill(CORD, b, amp=0.5, white_amp=0.3)
            for x in range(0, r.w, 2):
                r.vline(x, 0, r.h, CORD, b - 1)                         # the wales of the corduroy
            r.bevel(1, -1)
            r.darken_noise(0.25, -1, bottom=0.5)
        return p

    def seat(r):
        cord(3)(r)
        r.stain(CORD, 1, r.w / 2, r.h / 2, 4, 3, p=0.5)
        r.rect(9, 3, 4, 2, STEEL, 4, metal=0, rough=120)                # silver tape over a tear

    g.box('base', (-8, 0, -6), (8, 3, 8), {'sides': Face(wood(OAK, 1, 'h', 0.4), 'plinth')})
    g.box('base', (-8, 3, -7), (8, 8, 5), {'up': seat, 'north': Face(cord(2), 'sf'), 'east': Face(cord(2), 'se'), 'west': Face(cord(2), 'se')})
    g.box('base', (-8, 8, 4), (8, 15, 8), {'north': cord(3), 'south': Face(cord(1), 'bb'), 'up': Face(cord(4), 'bu'), 'east': Face(cord(2), 'be'), 'west': Face(cord(2), 'be')})
    arm = {'sides': Face(cord(3), 'arm'), 'up': Face(cord(4), 'armu')}
    g.box('k0', (-8, 3, -7), (-5, 11, 8), dict(arm))
    g.box('k2', (5, 3, -7), (8, 11, 8), dict(arm))
    g.bone('k1')
    out.geo(g, {f'geometry.fnar.sofa{"" if k == 0 else f"_{k}"}': (['base', f'k{k}'], (0, 0, 0)) for k in range(3)})
    out.tex('sofa', g.paint())
    perms = [(bs('fnar:kind', k), {'minecraft:geometry': f'geometry.fnar.sofa_{k}'}) for k in (1, 2)]
    out.block('sofa', block_json('sofa', geometry='geometry.fnar.sofa', materials=mi_set('sofa', render='opaque'), states={'fnar:kind': [0, 1, 2]},
                                 collision=box(-8, 0, -7, 8, 8, 8), selection=box(-8, 0, -7, 8, 15, 8), map_color='#4a311f', destroy=1.5, perms=perms))


# =============================================================== the kitchenette
@prop
def kitchenette(out):
    """Counter-top things for the Staff Room. fnar:kind 0 a filter coffee machine with a stained glass jug, 1 a
    microwave oven, its clock blinking."""
    g = Geo('kitchenette', 64, 64)

    def mw(r):
        r.fill(BEIGE, 3, amp=0.3)
        r.rect(1, 1, r.w - 5, r.h - 2, GLASS_OFF, 2); r.frame_rect(1, 1, r.w - 5, r.h - 2, BLACK, 2)
        r.px(r.w - 3, 1, N_GRN, 2); r.px(r.w - 2, 1, N_GRN, 1)
        for y in range(3, r.h - 1, 2):
            r.px(r.w - 3, y, BLACK, 4); r.px(r.w - 2, y, BLACK, 4)

    g.box('k0', (-4, 0, -2), (4, 2, 6), {'sides': Face(panel(BLACK, 2, bevel=None), 'cb'), 'up': Face(steel(3, 0.3), 'hot')})
    g.box('k0', (-4, 2, 3), (4, 12, 6), {'sides': Face(panel(BLACK, 2), 'ct')})
    g.box('k0', (-4, 10, -2), (4, 12, 3), {'sides': Face(panel(BLACK, 3, bevel=None), 'ch'), 'up': Face(panel(BLACK, 3), 'chu'), 'down': Face(panel(BLACK, 1, bevel=None), 'chd')})
    g.box('k0', (-2.5, 2, -1.5), (2.5, 7, 2.5), {'sides': Face(lambda r: (r.fill(GLASSF, 4, amp=0.4), r.rect(0, 2, r.w, r.h - 2, GRIME, 1), r.hline(0, 0, r.w, BLACK, 2)), 'jug'), 'up': Face(panel(BLACK, 2, bevel=None), 'jugu')})
    g.box('k1', (-7, 0, -3), (7, 9, 7), {'north': mw, 'east': Face(flat(BEIGE, 3, 0.3), 'ms'), 'west': Face(flat(BEIGE, 3, 0.3), 'ms'), 'south': Face(steel(1, 0.3), 'mb'), 'up': Face(flat(BEIGE, 4, 0.4), 'mu')})
    out.geo(g, {'geometry.fnar.kitchenette': (['k0'], (0, 0, 0)), 'geometry.fnar.kitchenette_1': (['k1'], (0, 0, 0))})
    out.tex('kitchenette', g.paint())
    out.block('kitchenette', block_json('kitchenette', geometry='geometry.fnar.kitchenette', materials=mi_set('kitchenette'), states={'fnar:kind': [0, 1]},
                                        collision=box(-7, 0, -3, 7, 9, 7), selection=box(-7, 0, -3, 7, 12, 7), map_color='#57504a', destroy=1.0,
                                        perms=[(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.kitchenette_1'})]))
