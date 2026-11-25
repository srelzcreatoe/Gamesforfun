"""The kitchen, the pizza counter and the restrooms: deck ovens, prep tables, wire shelving, the walk-in freezer's
door, a lit drinks cooler, a pot rack, the soda fountain and the till, the salad bar; toilet stalls, mirrors,
urinals and a hand dryer. Models face north, wall props have their back at z = +8, one texel per model pixel."""
from propkit import Geo, Face, prop, panel, block_json, box, mi_set, glow, bs
from rework_pal import *  # noqa: F403

FONT = {**FONT_3x5, **FONT_EXTRA}  # noqa: F405


def _half_perm(name, light=None, sel=None):
    comps = {'minecraft:geometry': f'geometry.fnar.{name}_upper'}
    if light:
        comps['minecraft:light_emission'] = light
    if sel:
        comps['minecraft:collision_box'] = sel
        comps['minecraft:selection_box'] = sel
    return (bs('fnar:half', 1), comps)


HALF = {'fnar:half': {'values': {'min': 0, 'max': 1}}}


# =============================================================== the deck oven
@prop
def pizza_oven(out):
    """A two-deck pizza oven, two blocks tall (fnar:half 0 / 1): stainless, a black glass door with a long handle on
    each deck, a thermostat and a pilot light, the flue box on top."""
    g = Geo('pizza_oven', 64, 64)

    def door(r):
        steel(3)(r)
        r.rect(1, 3, r.w - 5, r.h - 6, GLASS_OFF, 2)
        r.frame_rect(1, 3, r.w - 5, r.h - 6, BLACK, 1)
        r.hline(2, r.h - 5, r.w - 7, RED_GLOW, 0, emit=70)       # the last of the heat behind the glass
        r.px(3, 4, GLASS_OFF, 5); r.px(4, 5, GLASS_OFF, 4)
        x = r.w - 3
        r.rect(x, 2, 2, r.h - 4, BLACK, 2)
        r.px(x, 4, CHROME, 4); r.px(x + 1, 4, CHROME, 2)         # the thermostat
        r.px(x, 7, RED_GLOW, 2, emit=200)                         # pilot light
        r.px(x, 9, BLACK, 4); r.px(x + 1, 9, BLACK, 4)
        r.stain(GRIME, 1, r.w * 0.4, r.h - 1.5, 4, 1.2, seed=2, p=0.6, rough=230)
        r.speck(GRIME, 2, 0.03)

    side = Face(steel(3, 0.35), 'side')
    back = Face(steel(2, 0.4), 'back')
    for bone, y0 in (('lower', 0), ('upper', 16)):
        top = 16 if bone == 'lower' else 12
        if bone == 'lower':
            for (x, z) in ((-7, -5), (5, -5), (-7, 6), (5, 6)):
                g.box(bone, (x, 0, z), (x + 2, 3, z + 2), {'sides': Face(panel(BLACK, 2, bevel=None), 'leg')})
        b = 3 if bone == 'lower' else 0
        g.box(bone, (-8, y0 + b, -6), (8, y0 + top, 8), {'north': door, 'east': side, 'west': side, 'south': back,
                                                         'up': Face(steel(4, 0.3), 'top'), 'down': Face(steel(1, 0.2), 'bot')})
        g.box(bone, (-6, y0 + top - 3, -7.5), (4, y0 + top - 2, -6), {'*': Face(chrome(3), 'handle')})
    g.box('upper', (-4, 28, 0), (4, 32, 7), {'sides': Face(steel(2, 0.4), 'flue'), 'up': Face(panel(BLACK, 1, bevel=None), 'fluet')})
    out.geo(g, {'geometry.fnar.pizza_oven': (['lower'], (0, 0, 0)), 'geometry.fnar.pizza_oven_upper': (['upper'], (0, -16, 0))})
    out.tex('pizza_oven', g.paint())
    out.block('pizza_oven', block_json('pizza_oven', geometry='geometry.fnar.pizza_oven', materials=mi_set('pizza_oven'), states=HALF,
                                       collision=box(-8, 0, -6, 8, 16, 8), selection=box(-8, 0, -7.5, 8, 16, 8), map_color='#60666d', destroy=3.0,
                                       perms=[_half_perm('pizza_oven')]))


# =============================================================== prep tables
@prop
def prep_table(out):
    """A stainless work table with an undershelf; tables side by side make a line. fnar:kind 0 a cutting board and a
    knife, 1 dough balls, a rolling pin and flour, 2 a cold rail of topping pans, 3 a sink with a swan-neck tap."""
    g = Geo('prep_table', 64, 64)
    DOUGH = Mat('rw_dough', ['#8a7a58', '#a8966e', '#c2b088', '#d6c6a0', '#e6d9b8'], rough=220, h=144, hk=3)

    def top(r):
        r.fill(STAINLESS, 4, amp=0.45, white_amp=0.25, streak='h')
        r.bevel(1, -1)
        if r.variant == 1:
            r.speck(DOUGH, 4, 0.16)                                # flour everywhere
            r.stain(DOUGH, 3, 9, 7, 4, 3, seed=1, p=0.55)
        elif r.variant == 3:
            r.rect(3, 3, 10, 8, STEEL, 1); r.frame_rect(3, 3, 10, 8, STEEL, 5)
            r.px(8, 7, BLACK, 0); r.stain(RUST, 3, 10, 8, 2, 1.5, seed=2, p=0.6)
        else:
            r.stain(GRIME, 3, 11, 9, 3, 2, seed=3, p=0.4, rough=200)
        r.darken_noise(0.15, -1)

    def pan(colour):
        def p(r):
            r.fill(colour, None, amp=0.7, white_amp=0.5, cell=2)
            r.frame_rect(0, 0, r.w, r.h, STEEL, 5)
        return p

    leg = Face(steel(2, 0.3, 'v', None), 'leg')
    for (x, z) in ((-8, -7), (7, -7), (-8, 6), (7, 6)):
        g.box('base', (x, 0, z), (x + 1, 13, z + 1), {'sides': leg})
    g.box('base', (-8, 13, -7), (8, 15, 7), {'up': top, 'sides': Face(steel(3, 0.2), 'edge'), 'down': Face(steel(1, 0.1), 'under')})
    g.box('base', (-7, 4, -6), (7, 5, 6), {'up': Face(steel(2, 0.4), 'shelf'), 'sides': Face(steel(2, 0.2), 'shelfe'), 'down': Face(steel(1, 0.1), 'shelfd')})
    g.box('base', (-6, 5, -4), (-1, 10, 2), {'sides': Face(flat(ENAMEL, 3, 0.4), 'tub'), 'up': Face(flat(ENAMEL, 4, 0.2), 'tubu')})
    g.box('base', (1, 5, -3), (5, 9, 1), {'sides': Face(flat(RED_P, 3, 0.3), 'can'), 'up': Face(steel(4, 0.1), 'canu')})
    # kind 0: a cutting board, a knife
    g.box('k0', (-5, 15, -4), (3, 15.5, 3), {'up': Face(wood(PINE, 3, 'h'), 'board'), 'sides': Face(wood(PINE, 2, 'h', bevel=None), 'boarde')})
    g.box('k0', (4, 15, -3), (5, 15.4, 4), {'up': Face(lambda r: (r.fill(CHROME, 4, amp=0.3), r.rect(0, 0, 1, 2, BLACK, 2)), 'knife')})
    # kind 1: dough
    for (x, z) in ((-6, -4), (-2, -5), (2, -3)):
        g.box('k1', (x, 15, z), (x + 3, 17, z + 3), {'sides': Face(flat(DOUGH, 3, 0, bevel=None), 'dough'), 'up': Face(flat(DOUGH, 4, 0, bevel=(1, 0)), 'doughu')})
    g.box('k1', (-5, 15, 2), (5, 16.5, 3.5), {'*': Face(wood(PINE, 4, 'h', 0), 'pin')})
    # kind 2: the cold rail
    g.box('k2', (-8, 15, -1), (8, 18, 7), {'sides': Face(steel(3, 0.2), 'rail'), 'up': Face(steel(4, 0.1), 'railu')})
    for k, c in enumerate((RED_P, DOUGH, GREEN_P, RUST)):
        x = -7 + k * 3.75
        g.box('k2', (x, 18, 0), (x + 3, 18.2, 6), {'up': Face(pan(c), f'pan{k}')})
    # kind 3: the tap
    g.box('k3', (-0.5, 15, 5), (0.5, 21, 6), {'sides': Face(chrome(3), 'tap')})
    g.box('k3', (-0.5, 20, 1), (0.5, 21, 5), {'*': Face(chrome(4), 'spout')})
    for x in (-3, 2):
        g.box('k3', (x, 15, 5), (x + 1, 17, 6), {'sides': Face(chrome(2), 'valve'), 'up': Face(flat(RED_P if x < 0 else BLUE_P, 4, 0, None), f'valve{x}')})
    out.geo(g, {f'geometry.fnar.prep_table{"" if k == 0 else f"_{k}"}': (['base', f'k{k}'], (0, 0, 0)) for k in range(4)})
    for k in range(4):
        out.tex(f'prep_table_{k}', g.paint(k))
    perms = [(bs('fnar:kind', k), {'minecraft:geometry': f'geometry.fnar.prep_table{"" if k == 0 else f"_{k}"}',
                                   'minecraft:material_instances': mi_set(f'prep_table_{k}')}) for k in range(4)]
    out.block('prep_table', block_json('prep_table', geometry='geometry.fnar.prep_table', materials=mi_set('prep_table_0'), states={'fnar:kind': [0, 1, 2, 3]},
                                       collision=box(-8, 0, -7, 8, 15, 7), selection=box(-8, 0, -7, 8, 15, 7), map_color='#747a81', destroy=2.0, perms=perms))


# =============================================================== wire shelving
@prop
def wire_shelf(out):
    """Chrome wire shelving against a wall, two blocks tall (fnar:half): flour sacks and sauce tins below, stacked
    pizza boxes and jars above."""
    g = Geo('wire_shelf', 64, 64)

    def wire(r):
        r.clear()
        for y in range(r.h):
            for x in range(r.w):
                if x % 3 == 0 or y in (0, r.h - 1) or x == r.w - 1:
                    r.px(x, y, CHROME, 3 + (x + y) % 2)

    def sack(r):
        r.fill(PAPER, 3, amp=0.6, white_amp=0.4)
        r.bevel(1, -1)
        if r.face == 'north':
            r.rect(2, 2, r.w - 4, 3, RED_P, 3); r.hline(2, 6, r.w - 4, PAPER, 1)
        r.darken_noise(0.25, -1, bottom=0.6)

    def tin(r):
        r.fill(RED_P, 3, amp=0.4)
        r.hline(0, 0, r.w, STEEL, 5); r.hline(0, r.h - 1, r.w, STEEL, 2)
        if r.w >= 4:
            r.rect(1, 2, r.w - 2, 2, CREAM, 5)

    def pbox(r):
        r.fill(CARD, 4, amp=0.5, white_amp=0.3)
        for y in range(3, r.h, 4):
            r.hline(0, y, r.w, CARD, 1)
        if r.face == 'north':
            for y in range(1, r.h, 4):
                r.hline(3, y, 4, RED_P, 4)

    def jar(r):
        r.fill(GLASSF, 3, amp=0.5)
        r.hline(0, 0, r.w, STEEL, 4)
        r.rect(0, 2, r.w, r.h - 3, RUST if r.cube.name.endswith('a') else GREEN_P, 3)

    post = Face(chrome(3), 'post')
    for bone, y0 in (('lower', 0), ('upper', 16)):
        for (x, z) in ((-8, -4), (7, -4), (-8, 7), (7, 7)):
            g.box(bone, (x, y0, z), (x + 1, y0 + 16, z + 1), {'sides': post})
        for y in (3, 11):
            g.box(bone, (-8, y0 + y, -4), (8, y0 + y + 0.5, 8), {'up': Face(wire, 'wire'), 'down': Face(wire, 'wire'), 'north': Face(chrome(2), 'lip')})
    g.box('lower', (-7, 3.5, -3), (-1, 9.5, 5), {'sides': Face(sack, 'sack'), 'up': Face(sack, 'sacku')})
    g.box('lower', (0, 3.5, -2), (6, 8.5, 6), {'sides': Face(sack, 'sack2'), 'up': Face(sack, 'sack2u')})
    for k in range(3):
        g.box('lower', (-7 + k * 5, 11.5, -3), (-3 + k * 5, 16, 1), {'sides': Face(tin, 'tin'), 'up': Face(steel(4, 0), 'tinu')})
    g.box('upper', (-7, 19.5, -3), (5, 27, 7), {'sides': Face(pbox, 'pbox'), 'up': Face(pbox, 'pboxu')})
    for k, nm in enumerate(('ja', 'jb', 'ja', 'jb')):
        g.box('upper', (-7 + k * 3.5, 27.5, -3), (-4.5 + k * 3.5, 31.5, -0.5), {'sides': Face(jar, nm), 'up': Face(steel(4, 0), 'jaru')}, name=f'jar_{k}_{nm}')
    out.geo(g, {'geometry.fnar.wire_shelf': (['lower'], (0, 0, 0)), 'geometry.fnar.wire_shelf_upper': (['upper'], (0, -16, 0))})
    out.tex('wire_shelf', g.paint())
    out.block('wire_shelf', block_json('wire_shelf', geometry='geometry.fnar.wire_shelf', materials=mi_set('wire_shelf'), states=HALF,
                                       collision=box(-8, 0, -4, 8, 16, 8), selection=box(-8, 0, -4, 8, 16, 8), map_color='#8b9198', destroy=1.5,
                                       perms=[_half_perm('wire_shelf')]))


# =============================================================== the walk-in freezer's door
@prop
def freezer_door(out):
    """The walk-in freezer's door, two blocks tall (fnar:half), set in a stainless wall: a heavy latch, strap
    hinges, a frosted porthole, KEEP SHUT."""
    g = Geo('freezer_door', 64, 64)

    def front(r):
        up = r.cube.bone == 'upper'
        r.fill(STAINLESS, 4, amp=0.45, white_amp=0.25, streak='h')
        r.vline(1, 0, 16, STAINLESS, 1); r.vline(14, 0, 16, STAINLESS, 1)        # the door's edge in its frame
        r.vline(2, 0, 16, STAINLESS, 6)
        if up:
            r.hline(1, 1, 14, STAINLESS, 1); r.hline(2, 2, 12, STAINLESS, 6)
            r.rect(5, 4, 6, 5, GLASSF, 1); r.frame_rect(5, 4, 6, 5, BLACK, 2)
            for (x, y) in ((6, 5), (7, 5), (9, 6), (6, 7), (8, 7), (9, 7)):
                r.px(x, y, GLASSF, 6)                                     # frost
            r.rect(4, 11, 9, 3, YEL_P, 4)
            r.hline(5, 12, 7, BLACK, 1)
        else:
            r.hline(1, 14, 14, STAINLESS, 1)
            r.speck(RUST, 3, 0.04, rect=(1, 11, 14, 4))
            r.darken_noise(0.3, -1, bottom=1.0)
        for y in ((3, 4), (11, 12)):
            r.rect(11, y[0], 4, 2, STAINLESS, 2); r.px(14, y[0], CHROME, 5)   # strap hinges

    side = Face(steel(4, 0.25), 'wall')
    for bone, y0 in (('lower', 0), ('upper', 16)):
        g.box(bone, (-8, y0, -6), (8, y0 + 16, 8), {'north': front, 'south': side, 'east': side, 'west': side, 'up': side, 'down': side})
    g.box('lower', (-7, 10, -7.5), (-4, 16, -6), {'*': Face(chrome(3), 'latch')})
    g.box('lower', (-6.5, 12, -8), (-5, 13.5, -7.5), {'*': Face(panel(BLACK, 3, bevel=None), 'knob')})
    out.geo(g, {'geometry.fnar.freezer_door': (['lower'], (0, 0, 0)), 'geometry.fnar.freezer_door_upper': (['upper'], (0, -16, 0))})
    out.tex('freezer_door', g.paint())
    out.block('freezer_door', block_json('freezer_door', geometry='geometry.fnar.freezer_door', materials=mi_set('freezer_door', render='opaque'), states=HALF,
                                         collision=True, selection=True, map_color='#747a81', destroy=3.0, light_dampening=15,
                                         perms=[_half_perm('freezer_door')]))


# =============================================================== the drinks cooler
@prop
def drinks_cooler(out):
    """A glass-door drinks cooler, two blocks tall (fnar:half): rows of bottles behind the glass, a lit header.
    It is still running: light 7 (cold white) on the upper half, the only light in the kitchen at night."""
    g = Geo('drinks_cooler', 64, 64)

    def front(r):
        up = r.cube.bone == 'upper'
        r.fill(COLD, 1, amp=0.3, white_amp=0.2)
        r.frame_rect(0, 0, 16, 16, BLACK, 2)
        y0 = 5 if up else 0
        if up:
            r.rect(1, 1, 14, 3, RED_P, 4, emit=120)
            r.text('COLA', 1, 0, N_WHITE, 3, font=FONT_3x4, spacing=0)
            r.hline(0, 4, 16, BLACK, 2)
        cols = (RED_P, GREEN_P, YEL_P, BLUE_P, RUST, PURP_P)
        for row in range(2):
            y = y0 + row * (6 if up else 8)
            for k in range(6):
                x = 2 + k * 2
                c = cols[(k + row + (3 if up else 0)) % 6]
                r.px(x, y + 1, c, 5, emit=60); r.px(x, y + 2, c, 4, emit=60); r.px(x, y + 3, c, 3, emit=40); r.px(x, y + 4, c, 3, emit=40)
            r.hline(1, y + 5, 14, STEEL, 2)
        r.vline(14, 2 if not up else 6, 8, CHROME, 4)                      # the handle
        for (x, y) in ((3, 12), (4, 11)):
            r.px(x, y, COLD, 4)

    side = Face(flat(ENAMEL, 3, 0.35), 'side')
    for bone, y0 in (('lower', 0), ('upper', 16)):
        g.box(bone, (-8, y0, -6), (8, y0 + 16, 8), {'north': Face(front, mi='lit'), 'east': side, 'west': side, 'south': Face(steel(2, 0.4), 'back'),
                                                    'up': Face(flat(ENAMEL, 3, 0.5), 'top'), 'down': Face(panel(BLACK, 1, bevel=None), 'bot')})
    out.geo(g, {'geometry.fnar.drinks_cooler': (['lower'], (0, 0, 0)), 'geometry.fnar.drinks_cooler_upper': (['upper'], (0, -16, 0))})
    out.tex('drinks_cooler', g.paint())
    out.block('drinks_cooler', block_json('drinks_cooler', geometry='geometry.fnar.drinks_cooler', materials=mi_set('drinks_cooler', {'lit': glow('drinks_cooler')}),
                                          states=HALF, collision=box(-8, 0, -6, 8, 16, 8), selection=box(-8, 0, -6, 8, 16, 8), map_color='#a0c4d8', destroy=2.5,
                                          perms=[_half_perm('drinks_cooler', light=7)]))
    out.light('drinks_cooler', '#cfe6ff', 'point_light')


# =============================================================== a pot rack
@prop
def pot_rack(out):
    """Pots, pans and ladles on a steel rail hung from the ceiling (the top of the cell), along the facing's axis x."""
    g = Geo('pot_rack', 64, 64)
    COPPER = Mat('rw_copper', ['#3a1c0e', '#552a14', '#72391b', '#8f4a24', '#aa5e30', '#c2743f'], metal=200, rough=110, h=140, hk=3)
    g.box('rack', (-8, 13, -0.5), (8, 14, 0.5), {'*': Face(steel(3, 0.2, 'h', None), 'rail')})
    for x in (-6, 5):
        g.box('rack', (x, 14, -0.25), (x + 0.5, 16, 0.25), {'sides': Face(steel(2, 0, 'v', None), 'hang')})
    g.box('rack', (-7, 6, -3), (-2, 10, 2), {'sides': Face(panel(COPPER, 3, grime=0.3), 'pot'), 'down': Face(panel(COPPER, 2, bevel=None), 'potd'), 'up': Face(panel(BLACK, 1, bevel=None), 'potu')})
    g.box('rack', (-5, 10, -0.5), (-4, 13, 0.5), {'sides': Face(steel(2, 0, 'v', None), 'h1')})
    g.box('rack', (0, 5, -0.5), (5, 10, 0.5), {'north': Face(panel(BLACK, 2, grime=0.2), 'panf'), 'south': Face(panel(BLACK, 2, grime=0.2), 'panf'), 'sides': Face(panel(BLACK, 1, bevel=None), 'pane')})
    g.box('rack', (2, 10, -0.25), (3, 13, 0.25), {'sides': Face(panel(BLACK, 3, bevel=None), 'h2')})
    g.box('rack', (6.5, 4, -0.25), (7, 13, 0.25), {'sides': Face(chrome(3), 'ladle')})
    g.box('rack', (6, 2, -1), (7.5, 4, 1), {'*': Face(chrome(2), 'ladleb')})
    out.geo(g)
    out.tex('pot_rack', g.paint())
    out.block('pot_rack', block_json('pot_rack', geometry='geometry.fnar.pot_rack', materials=mi_set('pot_rack'), collision=False,
                                     selection=box(-8, 2, -3, 8, 16, 3), map_color='#8f4a24', destroy=1.0))


# =============================================================== the soda fountain and the till
@prop
def soda_fountain(out):
    """A counter-top soda fountain: four taps under a lit panel (light 4), a drip tray, a tower of paper cups."""
    g = Geo('soda_fountain', 64, 64)

    def face(r):
        r.fill(BLACK, 2, amp=0.3)
        r.rect(1, 1, r.w - 2, 4, RED_P, 4, emit=150)
        r.text('SODA', 1, 1, N_WHITE, 3, font={**FONT_3x4, 'D': ['##.', '#.#', '#.#', '##.']}, spacing=0)
        for k, c in enumerate((N_RED, N_YEL, N_GRN, N_PURP)):
            r.px(2 + k * 3, 7, c, 2); r.px(2 + k * 3, 8, CHROME, 4); r.px(2 + k * 3, 9, CHROME, 2)

    g.box('body', (-7, 0, -1), (7, 12, 6), {'north': Face(face, mi='lit'), 'sides': Face(steel(3, 0.3), 'side'), 'up': Face(steel(4, 0.2), 'top')})
    g.box('body', (-7, 0, -5), (7, 1, -1), {'up': Face(lambda r: (r.fill(BLACK, 1, amp=0.3), [r.hline(0, y, r.w, STEEL, 2) for y in range(0, r.h, 2)]), 'tray'), 'sides': Face(steel(2, 0.2), 'traye')})
    g.box('cups', (4, 12, 1), (7, 16, 4), {'sides': Face(lambda r: (r.fill(ENAMEL, 5, amp=0.3), [r.hline(0, y, r.w, RED_P, 4) for y in range(1, r.h, 2)]), 'cups'), 'up': Face(flat(ENAMEL, 6, 0, None), 'cupsu')})
    out.geo(g)
    out.tex('soda_fountain', g.paint())
    out.block('soda_fountain', block_json('soda_fountain', geometry='geometry.fnar.soda_fountain', materials=mi_set('soda_fountain', {'lit': glow('soda_fountain')}),
                                          collision=box(-7, 0, -5, 7, 12, 6), selection=box(-7, 0, -5, 7, 16, 6), map_color='#60666d', destroy=1.5, light=4))
    out.light('soda_fountain', '#ff9a86', 'static_light')


@prop
def cash_register(out):
    """An 80s electronic till: beige, a sloped keyboard, a green two-line display on a stalk, the drawer ajar."""
    g = Geo('cash_register', 64, 64)

    def keys(r):
        r.fill(BEIGE, 3, amp=0.3)
        for y in range(1, r.h - 1, 2):
            for x in range(1, r.w - 1, 2):
                r.px(x, y, BLACK if x < r.w - 4 else RED_P, 3)

    def disp(r):
        r.fill(BLACK, 1, amp=0.2)
        r.frame_rect(0, 0, r.w, r.h, BEIGE, 2)
        for x in range(2, r.w - 2):
            if x % 4 != 1:
                r.px(x, r.h // 2, N_GRN, 2)

    g.box('till', (-6, 0, -5), (6, 4, 6), {'sides': Face(flat(BEIGE, 3, 0.3), 'body'), 'up': Face(flat(BEIGE, 4, 0.2), 'bodyu')})
    g.box('till', (-5.5, 1, -7), (5.5, 3, -5), {'sides': Face(flat(BLACK, 2, 0.1), 'drawer'), 'up': Face(lambda r: (r.fill(BLACK, 1), r.px(2, 0, PAPER, 4), r.px(5, 0, GREEN_P, 4), r.px(8, 0, PAPER, 3)), 'drawu')})
    g.box('till', (-6, 4, -5), (6, 6, 2), {'up': keys, 'sides': Face(flat(BEIGE, 2, 0.2, None), 'kb')})
    g.box('till', (-1, 4, 3), (1, 9, 5), {'sides': Face(flat(BEIGE, 2, 0, None), 'stalk')})
    g.box('till', (-5, 9, 2.5), (5, 13, 5.5), {'north': Face(disp, mi='lit'), 'south': Face(disp, 'dispb'), 'sides': Face(flat(BEIGE, 3, 0, None), 'dispe'), 'up': Face(flat(BEIGE, 4, 0, None), 'dispu')})
    out.geo(g)
    out.tex('cash_register', g.paint())
    out.block('cash_register', block_json('cash_register', geometry='geometry.fnar.cash_register', materials=mi_set('cash_register', {'lit': glow('cash_register')}),
                                          collision=box(-6, 0, -5, 6, 6, 6), selection=box(-6, 0, -7, 6, 13, 6), map_color='#817863', destroy=1.0))


# =============================================================== the salad bar
@prop
def salad_bar(out):
    """One cell of the salad bar (cells side by side along x make the bar): a panelled base, a steel top with two
    wells, a glass sneeze guard on chrome posts. fnar:kind 0 greens and tomatoes, 1 cheese and cucumber, 2 scraped
    empty."""
    g = Geo('salad_bar', 64, 64)
    FOOD = {0: (GREEN_P, RED_P), 1: (YEL_P, GREEN_P), 2: (STEEL, STEEL)}

    def top(r):
        r.fill(STEEL, 4, amp=0.4, white_amp=0.25, streak='h')
        r.bevel(1, -1)
        a, b = FOOD[r.variant]
        for k, c in enumerate((a, b)):
            x0 = 1 + k * 8
            r.rect(x0, 3, 6, 8, c, 1 if r.variant == 2 else 3)
            if r.variant != 2:
                r.speck(c, 5, 0.35, seed=k, rect=(x0, 3, 6, 8)); r.speck(c, 1, 0.25, seed=k + 5, rect=(x0, 3, 6, 8))
            else:
                r.speck(GRIME, 2, 0.3, seed=k, rect=(x0, 3, 6, 8))
            r.frame_rect(x0, 3, 6, 8, STEEL, 6)
        r.rect(6, 12, 4, 1, CHROME, 5)                                      # tongs

    def base(r):
        r.fill(OAK, 3, amp=0.6, streak='v')
        r.frame_rect(1, 1, r.w - 2, r.h - 2, OAK, 1); r.hline(2, 2, r.w - 4, OAK, 5)
        r.hline(0, r.h - 1, r.w, BLACK, 1)
        r.darken_noise(0.3, -1, bottom=0.8)

    g.box('bar', (-8, 0, -6), (8, 9, 6), {'north': base, 'south': Face(base, 'bs'), 'east': Face(wood(OAK, 2), 'be'), 'west': Face(wood(OAK, 2), 'be')})
    g.box('bar', (-8, 9, -7), (8, 10, 7), {'up': top, 'sides': Face(steel(3, 0.1), 'edge'), 'down': Face(steel(1, 0), 'under')})
    for x in (-7.5, 6.5):
        g.box('guard', (x, 10, -0.5), (x + 1, 15, 0.5), {'sides': Face(chrome(3), 'post')})
    g.box('guard', (-8, 15, -5), (8, 15.5, 5), {'up': Face(glass, 'pane'), 'down': Face(glass, 'pane'), 'north': Face(chrome(4), 'pe'), 'south': Face(chrome(4), 'pe')})
    out.geo(g)
    for k in range(3):
        out.tex(f'salad_bar_{k}', g.paint(k))
    perms = [(bs('fnar:kind', k), {'minecraft:material_instances': mi_set(f'salad_bar_{k}')}) for k in range(3)]
    out.block('salad_bar', block_json('salad_bar', geometry='geometry.fnar.salad_bar', materials=mi_set('salad_bar_0'), states={'fnar:kind': [0, 1, 2]},
                                      collision=box(-8, 0, -7, 8, 10, 7), selection=box(-8, 0, -7, 8, 16, 7), map_color='#5d3c25', destroy=2.0, perms=perms))


# =============================================================== toilet stalls
@prop
def stall_panel(out):
    """A toilet stall's laminate partition on the edge of its cell (its back at z = +8, like a wall prop), two
    blocks tall (fnar:half), a gap at the floor. fnar:kind 0 a partition, 1 a door (shut), 2 a door standing ajar."""
    g = Geo('stall_panel', 64, 64)

    def lam(r):
        r.fill(STALL, 3, amp=0.45, white_amp=0.3)
        r.bevel(1, -1)
        r.darken_noise(0.25, -1, bottom=0.6)
        if r.w >= 12 and r.cube.bone.startswith('p0'):
            for (x, y) in ((4, 3), (5, 4), (6, 4), (7, 5), (9, 3), (9, 4)):   # scratched into it
                r.px(x, y, STALL, 5)

    def door(r):
        lam(r)
        if r.cube.bone.endswith('l') and r.face == 'north':
            r.rect(0, 2, 2, 3, CHROME, 3); r.px(1, 3, RED_P, 4)               # the latch: ENGAGED

    edge = Face(steel(3, 0, 'v', None), 'edge')
    post = Face(steel(3, 0.2, 'v'), 'post')
    for half, y0, (a, b), bone in ((0, 0, (4, 16), 'l'), (1, 16, (0, 9), 'u')):
        g.box(f'p0{bone}', (-8, y0 + a, 7), (8, y0 + b, 8), {'north': lam, 'south': Face(lam, 'ps'), 'up': edge, 'down': edge})
        if half == 0:
            for x in (-7, 6):
                g.box(f'p0{bone}', (x, 0, 7), (x + 1, 4, 8), {'sides': Face(steel(2, 0.3, 'v', None), 'foot')})
        else:
            g.box(f'p0{bone}', (-8, y0 + 9, 6.5), (8, y0 + 10, 8), {'*': Face(steel(4, 0, 'h', None), 'head')})
        for k in (1, 2):
            pb = f'p{k}{bone}'
            for x in (-8, 6):
                g.box(pb, (x, y0, 7), (x + 2, y0 + (16 if half == 0 else 10), 8), {'sides': post, 'up': edge})
            if half:
                g.box(pb, (-8, y0 + 9, 6.5), (8, y0 + 10, 8), {'*': Face(steel(4, 0, 'h', None), 'head')})
            kw = {} if k == 1 else {'rotation': [0, -35, 0], 'pivot': [6, y0 + 8, 7.5]}
            g.box(pb, (-6, y0 + a, 7), (6, y0 + min(b, 8 if half else 16), 8), {'north': door, 'south': Face(lam, 'ds'), 'up': edge, 'down': edge, 'west': edge}, **kw)
    out.geo(g, {f'geometry.fnar.stall_panel_{k}{h}': ([f'p{k}{"lu"[h]}'], (0, -16 * h, 0)) for k in range(3) for h in range(2)})
    out.tex('stall_panel', g.paint())
    perms = [(f"{bs('fnar:kind', k)} && {bs('fnar:half', h)}", {'minecraft:geometry': f'geometry.fnar.stall_panel_{k}{h}'}) for k in range(3) for h in range(2)]
    out.block('stall_panel', block_json('stall_panel', geometry='geometry.fnar.stall_panel_00', materials=mi_set('stall_panel'),
                                        states={'fnar:kind': [0, 1, 2], **HALF}, collision=box(-8, 0, 7, 8, 16, 8), selection=box(-8, 0, 6.5, 8, 16, 8),
                                        map_color='#485a63', destroy=1.5, perms=perms))


@prop
def restroom_mirror(out):
    """A mirror in a chrome frame on the wall. fnar:kind 0 whole (and speckled), 1 cracked from a corner."""
    g = Geo('restroom_mirror', 64, 64)

    def face(r):
        r.fill(MIRR, 3, amp=0.5, white_amp=0.15, cell=5)
        for k in range(8):
            r.px(3 + k, 10 - k, MIRR, 5); r.px(4 + k, 10 - k, MIRR, 4)
        r.frame_rect(0, 0, r.w, r.h, CHROME, 3)
        r.speck(GRIME, 2, 0.05, rough=200, metal=0)
        r.darken_noise(0.2, -1, bottom=0.8)
        if r.variant == 1:
            for pts in (((1, 1), (2, 2), (3, 3), (4, 3), (5, 4), (6, 6), (7, 7)), ((3, 3), (3, 4), (2, 6), (2, 7), (1, 9)), ((5, 4), (7, 4), (9, 3), (11, 3))):
                for (x, y) in pts:
                    r.px(x, y, BLACK, 1, metal=0, rough=200)

    g.box('mirror', (-7, 1, 7), (7, 15, 8), {'north': face, 'sides': Face(chrome(2), 'e'), 'ends': Face(chrome(2), 'e2')})
    out.geo(g)
    for k in range(2):
        out.tex(f'restroom_mirror_{k}', g.paint(k))
    out.block('restroom_mirror', block_json('restroom_mirror', geometry='geometry.fnar.restroom_mirror', materials=mi_set('restroom_mirror_0'),
                                            states={'fnar:kind': [0, 1]}, collision=False, selection=box(-7, 1, 7, 7, 15, 8), map_color='#9aa2b0', destroy=0.8,
                                            perms=[(bs('fnar:kind', 1), {'minecraft:material_instances': mi_set('restroom_mirror_1')})]))


@prop
def urinal(out):
    """A wall urinal: stained ceramic, a chrome flush valve on its pipe."""
    g = Geo('urinal', 64, 64)
    cer = lambda b=4, gr=0.35: panel(CERAMIC, b, amp=0.4, white_amp=0.25, grime=gr)

    def bowl(r):
        cer(4)(r)
        r.rect(1, 1, r.w - 2, r.h - 2, CERAMIC, 1)
        r.stain(RUST, 3, r.w / 2, r.h - 2, 2, 1.2, p=0.7)
        r.px(r.w // 2, r.h // 2, BLACK, 0)

    g.box('urinal', (-4, 3, 6), (4, 16, 8), {'north': cer(4, 0.5), 'sides': Face(cer(3), 'bs'), 'up': Face(cer(5), 'bu')})
    g.box('urinal', (-4, 3, 1), (4, 9, 6), {'up': bowl, 'sides': Face(cer(4), 'bowl'), 'down': Face(cer(2), 'bowld')})
    g.box('urinal', (-4, 9, 4), (-3, 14, 6), {'sides': Face(cer(4), 'wing'), 'up': Face(cer(5), 'wingu')})
    g.box('urinal', (3, 9, 4), (4, 14, 6), {'sides': Face(cer(4), 'wing'), 'up': Face(cer(5), 'wingu')})
    g.box('urinal', (-0.5, 12, 4.5), (0.5, 16, 5.5), {'sides': Face(chrome(3), 'pipe')})
    g.box('urinal', (-1.5, 13, 3.5), (1.5, 14.5, 4.5), {'*': Face(chrome(4), 'valve')})
    g.box('urinal', (-0.5, 0, 6.5), (0.5, 3, 7.5), {'sides': Face(chrome(2), 'waste')})
    out.geo(g)
    out.tex('urinal', g.paint())
    out.block('urinal', block_json('urinal', geometry='geometry.fnar.urinal', materials=mi_set('urinal'), collision=box(-4, 3, 1, 4, 16, 8),
                                   selection=box(-4, 0, 1, 4, 16, 8), map_color='#958f84', destroy=1.5))


@prop
def hand_dryer(out):
    """A hot-air hand dryer on the wall: chipped white enamel, a chrome nozzle and push button."""
    g = Geo('hand_dryer', 64, 64)

    def face(r):
        flat(ENAMEL, 4, 0.3)(r)
        r.disc(r.w / 2, 2.5, 1.6, CHROME, 4)
        r.speck(RUST, 3, 0.04)
        r.hline(2, r.h - 2, r.w - 4, BLACK, 2)

    g.box('dryer', (-4, 6, 4), (4, 13, 8), {'north': face, 'sides': Face(flat(ENAMEL, 3, 0.3), 's'), 'up': Face(flat(ENAMEL, 5, 0.1), 'u'), 'down': Face(flat(ENAMEL, 2, 0), 'd')})
    g.box('dryer', (-1.5, 4, 4.5), (1.5, 6, 7), {'sides': Face(chrome(3), 'noz'), 'down': Face(panel(BLACK, 0, bevel=None), 'nozd')})
    out.geo(g)
    out.tex('hand_dryer', g.paint())
    out.block('hand_dryer', block_json('hand_dryer', geometry='geometry.fnar.hand_dryer', materials=mi_set('hand_dryer'), collision=False,
                                       selection=box(-4, 4, 4, 4, 13, 8), map_color='#a19d93', destroy=1.0))
