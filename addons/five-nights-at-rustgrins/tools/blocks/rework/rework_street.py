"""Outside: a striped awning, the dumpster, a concrete planter with a dead shrub, a downpipe, a bollard, a wheel
stop, an air-conditioning condenser and a stack of pallets. Models face north, wall props have their back at
z = +8."""
from propkit import Geo, Face, prop, panel, block_json, box, mi_set, bs
from rework_pal import *  # noqa: F403


def _stripes(r, along='x'):
    """Red and cream awning stripes, 4 px each, faded and streaked by the weather."""
    for y in range(r.h):
        for x in range(r.w):
            k = (x if along == 'x' else y) // 4
            m = CANVAS_R if k % 2 == 0 else CANVAS_W
            r.px(x, y, m, 3 + ((x * 3 + y * 5) % 7 == 0) - ((x * 5 + y * 3) % 11 == 0))
    r.darken_noise(0.3, -1, cell=4)
    r.stain(GRIME, 2, r.w * 0.7, r.h * 0.4, 3, 2, seed=1, p=0.45)


# =============================================================== the awning
@prop
def awning(out):
    """One cell of a striped canvas awning on a wall (cells side by side along x): it slopes from the top of the
    cell at the wall down to a scalloped valance at the front."""
    g = Geo('awning', 64, 64)

    def valance(r):
        _stripes(r)
        for x in range(r.w):
            if x % 4 in (0, 3):
                r.px(x, r.h - 1, None)                                   # the scallops
        r.hline(0, 0, r.w, CANVAS_W, 5)

    g.bone('slope', pivot=(0, 16, 8), rotation=(-23, 0, 0))
    g.box('slope', (-8, 15.5, -9.4), (8, 16, 8), {'up': Face(_stripes, 'top'), 'down': Face(_stripes, 'top')})
    g.box('front', (-8, 6, -8.2), (8, 9.5, -8), {'north': valance, 'south': Face(valance, 'vb')})
    g.box('front', (-8, 9, -8), (-7.5, 9.5, 8), {'*': Face(steel(2, 0.2, 'h', None), 'arm')})
    out.geo(g)
    out.tex('awning', g.paint())
    out.block('awning', block_json('awning', geometry='geometry.fnar.awning', materials=mi_set('awning'), collision=False,
                                   selection=box(-8, 6, -8, 8, 16, 8), map_color='#872422', destroy=1.0))


# =============================================================== the dumpster
@prop
def dumpster(out):
    """One half of a steel dumpster (its closed end on the west: the other half is the same block turned round).
    Dented green paint, rust at every seam, a black lid that no longer shuts on the bags."""
    g = Geo('dumpster', 64, 64)

    def body(r):
        r.fill(GREEN_P, 3, amp=0.5, white_amp=0.3)
        r.bevel(1, -1)
        for x in range(3, r.w, 5):
            r.vline(x, 1, r.h - 2, GREEN_P, 1); r.vline(x + 1, 1, r.h - 2, GREEN_P, 5)   # pressed ribs
        if r.face in ('north', 'south'):
            r.rect(r.w - 6, 4, 5, 3, BLACK, 0)                                     # the fork pocket
        r.stain(RUST, 3, r.w * 0.3, r.h - 1.5, r.w * 0.3, 1.6, seed=1, p=0.7)
        r.drip(RUST, 2, 5, 2, 7, seed=2); r.drip(RUST, 3, r.w - 4, 1, 5, seed=3)
        r.darken_noise(0.3, -1, bottom=0.9)

    def bags(r):
        r.fill(BLACK, 2, amp=0.9, white_amp=0.5, cell=2)
        r.speck(GREYPLAST, 3, 0.06)

    g.box('bin', (-7, 0, -6), (8, 12, 6), {'north': body, 'south': Face(body, 'bs'), 'west': Face(body, 'bw'), 'down': Face(panel(BLACK, 1, bevel=None), 'bd')})
    g.box('bin', (-7.5, 11, -6.5), (8, 12.5, 6.5), {'sides': Face(panel(BLACK, 2, bevel=None), 'rim')})
    g.box('bin', (-6, 12, -5), (8, 14, 5), {'up': Face(bags, 'bags'), 'sides': Face(bags, 'bagss')})
    g.bone('lid', pivot=(0, 12.5, 6.5), rotation=(11, 0, 0))
    g.box('lid', (-7.5, 12.5, -6.5), (8, 13.5, 6.5), {'up': Face(panel(BLACK, 3, grime=0.3), 'lid'), 'down': Face(panel(BLACK, 1, bevel=None), 'lidd'), 'north': Face(panel(BLACK, 2, bevel=None), 'lide'), 'west': Face(panel(BLACK, 2, bevel=None), 'lidw')})
    for x in (-6, 4):
        g.box('bin', (x, 0, -5), (x + 2, 1, -3), {'sides': Face(panel(BLACK, 3, bevel=None), 'wheel')})
    out.geo(g)
    out.tex('dumpster', g.paint())
    out.block('dumpster', block_json('dumpster', geometry='geometry.fnar.dumpster', materials=mi_set('dumpster', render='opaque'),
                                     collision=box(-8, 0, -6, 8, 13, 6), selection=box(-8, 0, -6.5, 8, 16, 6.5), map_color='#1d432d', destroy=3.0))


# =============================================================== a planter
@prop
def planter(out):
    """A square concrete planter, the shrub in it long dead: bare twigs, a crisp packet in the soil."""
    g = Geo('planter', 64, 64)

    def conc(r):
        r.fill(CONC, 3, amp=0.5, white_amp=0.35, cell=4)
        r.bevel(1, -1)
        r.hline(0, 2, r.w, CONC, 1)
        r.darken_noise(0.3, -1, bottom=0.8)
        r.stain(GREEN_P, 1, 2, r.h - 2, 2, 1.5, p=0.5)                   # moss at the foot

    def soil(r):
        r.fill(SOIL, 2, amp=0.8, white_amp=0.5, cell=2)
        r.frame_rect(0, 0, r.w, r.h, CONC, 4)
        r.px(4, 5, RED_P, 4); r.px(5, 5, RED_P, 3); r.px(9, 8, PAPER, 4)

    def twigs(r):
        r.clear()
        for (x0, lean) in ((3, -1), (6, 0), (8, 1), (10, -1)):
            x = x0
            for y in range(r.h - 1, 0, -1):
                r.px(x, y, TWIG, 2 + (y % 3 == 0))
                if y % 3 == 0:
                    x += lean
                    r.px(x + (1 if lean <= 0 else -1), y - 1, TWIG, 3)

    g.box('pot', (-7, 0, -7), (7, 7, 7), {'sides': Face(conc, 'conc'), 'up': soil})
    g.box('shrub', (-6, 7, 0), (6, 16, 0), {'north': Face(twigs, 'tw'), 'south': Face(twigs, 'tw')})
    g.box('shrub', (0, 7, -6), (0, 16, 6), {'east': Face(twigs, 'tw'), 'west': Face(twigs, 'tw')})
    out.geo(g)
    out.tex('planter', g.paint())
    out.block('planter', block_json('planter', geometry='geometry.fnar.planter', materials=mi_set('planter'), facing=False,
                                    collision=box(-7, 0, -7, 7, 7, 7), selection=box(-7, 0, -7, 7, 16, 7), map_color='#68665f', destroy=2.0))


# =============================================================== small things
@prop
def drainpipe(out):
    """A galvanised downpipe on a wall. fnar:kind 0 a straight length with a bracket, 1 the foot (a shoe that kicks
    out over a rust stain)."""
    g = Geo('drainpipe', 64, 64)

    def pipe(r):
        r.fill(GALV, 3, amp=0.5, white_amp=0.3, streak='v')
        r.vline(0, 0, r.h, GALV, 5); r.vline(r.w - 1, 0, r.h, GALV, 1)
        r.drip(RUST, 3, r.w // 2, 2, 8, seed=1)
        r.darken_noise(0.25, -1, bottom=0.6)

    for k in range(2):
        g.box(f'k{k}', (-1.5, 3 if k else 0, 5), (1.5, 16, 8), {'north': pipe, 'east': Face(pipe, 'ps'), 'west': Face(pipe, 'ps')})
    g.box('k0', (-2.5, 8, 4.5), (2.5, 9.5, 8), {'sides': Face(steel(2, 0.2, 'h', None), 'br'), 'ends': Face(steel(2, 0, 'h', None), 'bre')})
    g.box('k1', (-1.5, 0, 1), (1.5, 3, 8), {'sides': Face(pipe, 'shoe'), 'up': Face(pipe, 'shoeu'), 'down': Face(panel(BLACK, 0, bevel=None), 'shoed')})
    out.geo(g, {'geometry.fnar.drainpipe': (['k0'], (0, 0, 0)), 'geometry.fnar.drainpipe_1': (['k1'], (0, 0, 0))})
    out.tex('drainpipe', g.paint())
    out.block('drainpipe', block_json('drainpipe', geometry='geometry.fnar.drainpipe', materials=mi_set('drainpipe', render='opaque'), states={'fnar:kind': [0, 1]},
                                      collision=False, selection=box(-2.5, 0, 4.5, 2.5, 16, 8), map_color='#6e747b', destroy=1.0,
                                      perms=[(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.drainpipe_1'})]))


@prop
def bollard(out):
    """A steel bollard in chipped safety yellow, a black band near the top."""
    g = Geo('bollard', 64, 64)

    def post(r):
        r.fill(YEL_P, 3, amp=0.5, white_amp=0.3)
        r.vline(0, 0, r.h, YEL_P, 5); r.vline(r.w - 1, 0, r.h, YEL_P, 1)
        r.hline(0, 2, r.w, BLACK, 2); r.hline(0, 3, r.w, BLACK, 2)
        r.speck(RUST, 3, 0.08); r.darken_noise(0.3, -1, bottom=0.9)

    g.box('post', (-2, 0, -2), (2, 14, 2), {'sides': Face(post, 'post'), 'up': Face(flat(YEL_P, 4, 0.3), 'cap')})
    g.box('post', (-3, 0, -3), (3, 1, 3), {'sides': Face(steel(1, 0.3, 'h', None), 'flange'), 'up': Face(steel(2, 0.4), 'flangeu')})
    out.geo(g)
    out.tex('bollard', g.paint())
    out.block('bollard', block_json('bollard', geometry='geometry.fnar.bollard', materials=mi_set('bollard', render='opaque'), facing=False,
                                    collision=box(-2, 0, -2, 2, 14, 2), selection=box(-3, 0, -3, 3, 14, 3), map_color='#b89224', destroy=2.0))


@prop
def parking_block(out):
    """A concrete wheel stop across a parking bay (along x), a faded yellow stripe, one corner broken off."""
    g = Geo('parking_block', 64, 64)

    def conc(r):
        r.fill(CONC, 4, amp=0.5, white_amp=0.35, cell=4)
        r.bevel(1, -1)
        if r.face in ('north', 'south', 'up'):
            r.rect(2, 0 if r.face == 'up' else 1, r.w - 4, 1, YEL_P, 3)
        r.darken_noise(0.3, -1)

    g.box('stop', (-7, 0, -2), (8, 3, 2), {'sides': Face(conc, 's'), 'up': conc})
    g.box('stop', (-8, 0, -2), (-7, 2, 2), {'sides': Face(conc, 'c'), 'up': Face(conc, 'cu')})
    out.geo(g)
    out.tex('parking_block', g.paint())
    out.block('parking_block', block_json('parking_block', geometry='geometry.fnar.parking_block', materials=mi_set('parking_block', render='opaque'),
                                          collision=box(-8, 0, -2, 8, 3, 2), selection=box(-8, 0, -2, 8, 3, 2), map_color='#77756d', destroy=2.0))


@prop
def ac_unit(out):
    """An air-conditioning condenser: a louvred steel box, the fan under its grille, a rust line down one side."""
    g = Geo('ac_unit', 64, 64)

    def louvres(r):
        r.fill(GALV, 3, amp=0.4, white_amp=0.3)
        r.bevel(1, -1)
        for y in range(2, r.h - 2, 2):
            r.hline(2, y, r.w - 4, GALV, 1); r.hline(2, y + 1, r.w - 4, GALV, 5)
        r.drip(RUST, 3, 3, 1, 10, seed=1); r.drip(RUST, 2, r.w - 4, 3, 8, seed=2)
        r.darken_noise(0.3, -1, bottom=0.8)

    def fan(r):
        r.fill(GALV, 3, amp=0.4)
        r.bevel(1, -1)
        for y in range(r.h):
            for x in range(r.w):
                d = ((x + 0.5 - r.w / 2) ** 2 + (y + 0.5 - r.h / 2) ** 2) ** 0.5
                if d < 6:
                    r.px(x, y, BLACK, 1 if (x + y) % 2 else 3, h=-20)
                elif d < 7:
                    r.px(x, y, GALV, 5)
        r.px(r.w // 2, r.h // 2, GALV, 4)

    g.box('unit', (-8, 1, -7), (8, 15, 7), {'sides': Face(louvres, 'lv'), 'up': fan})
    for (x, z) in ((-7, -6), (5, -6), (-7, 4), (5, 4)):
        g.box('unit', (x, 0, z), (x + 2, 1, z + 2), {'sides': Face(panel(BLACK, 2, bevel=None), 'foot')})
    out.geo(g)
    out.tex('ac_unit', g.paint())
    out.block('ac_unit', block_json('ac_unit', geometry='geometry.fnar.ac_unit', materials=mi_set('ac_unit', render='opaque'), facing=False,
                                    collision=box(-8, 0, -7, 8, 15, 7), selection=box(-8, 0, -7, 8, 15, 7), map_color='#6e747b', destroy=2.5))


@prop
def pallets(out):
    """Wooden pallets in a stack. fnar:count 1-3."""
    g = Geo('pallets', 64, 64)

    def boards(r):
        r.clear()
        for y in range(r.h):
            for x in range(r.w):
                if (x % 4) != 3:
                    r.px(x, y, PINE, 2 + (x // 4 + y) % 3)
        r.darken_noise(0.35, -1, cell=3)

    def edge(r):
        r.clear()
        for x in range(r.w):
            r.px(x, 0, PINE, 4)
            if r.h > 3:
                r.px(x, r.h - 1, PINE, 2)
            if x % 7 < 2:
                for y in range(1, r.h - 1):
                    r.px(x, y, PINE, 1)

    for k in range(3):
        y0 = k * 4.5
        dx = (0, 1, -0.5)[k]
        g.box(f'p{k}', (-8 + abs(dx) + dx, y0, -8 + abs(dx)), (8 - abs(dx) + dx, y0 + 4, 8 - abs(dx)), {'up': Face(boards, 'top'), 'down': Face(boards, 'top'), 'sides': Face(edge, 'edge')})
    out.geo(g, {f'geometry.fnar.pallets{"" if n == 1 else f"_{n}"}': ([f'p{k}' for k in range(n)], (0, 0, 0)) for n in (1, 2, 3)})
    out.tex('pallets', g.paint())
    perms = [(bs('fnar:count', n), {'minecraft:geometry': f'geometry.fnar.pallets_{n}', 'minecraft:collision_box': box(-8, 0, -8, 8, min(16, n * 4.5), 8)}) for n in (2, 3)]
    out.block('pallets', block_json('pallets', geometry='geometry.fnar.pallets', materials=mi_set('pallets'), facing=False, states={'fnar:count': [1, 2, 3]},
                                    collision=box(-8, 0, -8, 8, 4, 8), selection=box(-8, 0, -8, 8, 13.5, 8), map_color='#86693c', destroy=1.5, perms=perms))
