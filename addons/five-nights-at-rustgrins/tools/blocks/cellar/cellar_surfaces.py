"""The cellar's full cubes: the old supper club's wall, floor and ceiling finishes, fifty years on, and the raw
cellar's damp concrete."""
import math

from propkit import prop, block_json, mi_set
from pal import GRIME, WET, RUST  # noqa: F401
from cellar_pal import *  # noqa: F403


def cube(out, name, painter, map_color, destroy=1.5, variant=None):
    out.tex(name, face_sheet(name, painter, variant=variant))
    out.block(name, block_json(name, geometry='minecraft:geometry.full_block', materials=mi_set(name, render='opaque'),
                               facing=False, collision=True, selection=True, map_color=map_color, destroy=destroy,
                               light_dampening=15))


# ---------------------------------------------------------------- old gold wallpaper
DAMASK = ['...##...', '..#..#..', '.#.##.#.', '#.####.#', '#.####.#', '.#.##.#.', '..#..#..', '...##...']


def _wallpaper(r):
    r.fill(GOLDPAPER, 4, amp=0.45, white_amp=0.35, cell=5)
    # a half-drop damask: darker figures, a paler pinstripe between the columns
    for y in range(16):
        for x in range(16):
            if DAMASK[(y + (4 if x >= 8 else 0)) % 8][x % 8] == '#':
                r.shift(x, y, -1)
        r.shift(0, y, 1)
        r.shift(8, y, 1)
    # fifty years of damp: a brown tide line creeping down from the top, streaks, a faded patch
    for x in range(16):
        d = 1 + int(1.5 + 1.4 * math.sin(x * 0.9) + 0.9 * math.sin(x * 2.3 + 1))
        for y in range(max(0, d)):
            r.shift(x, y, -1)
        if d > 0 and (x * 5) % 7 < 3:
            r.px(x, d, WATERSTAIN, 2)
    r.drip(WATERSTAIN, 1, 5, 3, 9, seed=1)
    r.drip(WATERSTAIN, 2, 12, 2, 7, seed=2)
    r.stain(GOLDPAPER, 6, 11, 11, 2.2, 2.0, seed=3, p=0.5)
    r.darken_noise(0.22, -1, bottom=0.5)
    r.speck(MOULD, 2, 0.02)


def _wallpaper_torn(r):
    _wallpaper(r)
    # a strip has come away from the top right: plaster behind it, the paper's curled edge, mould in the damp
    edge = [9, 9, 8, 8, 7, 8, 8, 9, 10, 10, 11, 12, 13]
    for y, x0 in enumerate(edge):
        for x in range(x0, 16):
            r.px(x, y, OLDPLASTER, 2 + (x * 3 + y * 5) % 3)
        r.px(x0, y, GOLDPAPER, 6)
        if y % 3 == 0:
            r.px(x0 - 1, y, GOLDPAPER, 1)
    for (x, y) in ((12, 2), (13, 3), (13, 4), (14, 4), (12, 5), (15, 7), (14, 8)):
        r.px(x, y, MOULD, 1 + (x + y) % 3)
    for x in range(12, 16):  # a brick shows where the plaster fell too
        for y in range(9, 12):
            r.px(x, y, BRICKRED, 2 + (x + y) % 2)
    r.hline(12, 12, 4, OLDPLASTER, 0)
    # a second tear low on the left, hanging
    for (x, y) in ((2, 11), (3, 11), (2, 12), (3, 12), (4, 12), (2, 13), (3, 13)):
        r.px(x, y, OLDPLASTER, 3)
    r.px(4, 11, GOLDPAPER, 6); r.px(1, 12, GOLDPAPER, 0); r.px(3, 14, GOLDPAPER, 6)


@prop
def gold_wallpaper(out):
    cube(out, 'gold_wallpaper', _wallpaper, '#665324')


@prop
def torn_gold_wallpaper(out):
    cube(out, 'torn_gold_wallpaper', _wallpaper_torn, '#5d5749')


# ---------------------------------------------------------------- rotten panelling
@prop
def rotten_panelling(out):
    def paint(r):
        r.fill(ROTWOOD, 3, amp=0.6, white_amp=0.35, streak='v', cell=3)
        # a moulded cap, two stiles, a sunk panel, a skirting board
        r.hline(0, 0, 16, ROTWOOD, 6); r.hline(0, 1, 16, ROTWOOD, 4); r.hline(0, 2, 16, ROTWOOD, 1)
        for y in range(3, 14):
            for x in (0, 1, 14, 15):
                r.shift(x, y, 1)
            r.px(2, y, ROTWOOD, 1)
            r.px(13, y, ROTWOOD, 5)
        r.hline(3, 3, 10, ROTWOOD, 1)
        r.hline(3, 12, 10, ROTWOOD, 5)
        r.hline(0, 13, 16, ROTWOOD, 1)
        r.hline(0, 14, 16, ROTWOOD, 4); r.hline(0, 15, 16, ROTWOOD, 2)
        # rot: the bottom has gone soft and black, a hole eaten through, pale mould climbing the stile
        r.darken_noise(0.45, -1, bottom=0.9, cell=3)
        r.darken_noise(0.25, -1, bottom=1.2, seed=4)
        for (x, y) in ((5, 11), (6, 11), (5, 10), (6, 12), (7, 11), (7, 12), (4, 12)):
            r.px(x, y, INK, 0, h=-30)
        r.px(4, 11, ROTWOOD, 5); r.px(6, 10, ROTWOOD, 5); r.px(8, 12, ROTWOOD, 0)
        for (x, y) in ((14, 9), (15, 10), (14, 11), (15, 12), (14, 12), (13, 13), (1, 13), (0, 12), (10, 14)):
            r.px(x, y, MOULD, 2 + (x + y) % 3)
        r.speck(DUST, 1, 0.03)
    cube(out, 'rotten_panelling', paint, '#2d2015')


# ---------------------------------------------------------------- the gold stage curtain
@prop
def gold_curtain(out):
    FOLD = [1, 2, 4, 5, 6, 4, 2, 1, 0, 1, 3, 5, 5, 3, 2, 0]

    def paint(r):
        r.fill(VELVETGOLD, 3, amp=0.4, white_amp=0.4, cell=4)
        for y in range(16):
            for x in range(16):
                r.px(x, y, VELVETGOLD, FOLD[x] + (1 if (x * 7 + y * 3) % 11 == 0 else 0) - (1 if (x * 5 + y * 11) % 13 == 0 else 0))
        # moth holes with ragged edges, the black of the stage behind
        for (cx, cy, pts) in ((4, 4, ((0, 0), (1, 0), (0, 1), (1, 1), (1, 2))), (11, 9, ((0, 0), (1, 0), (2, 0), (1, 1), (0, -1))),
                              (6, 12, ((0, 0), (0, 1), (1, 1))), (13, 2, ((0, 0), (0, 1))), (2, 9, ((0, 0),))):
            for dx, dy in pts:
                r.px(cx + dx, cy + dy, INK, 0, h=-40)
            r.px(cx - 1, cy, VELVETGOLD, 0)
            r.px(cx, cy + 3 if (cx, cy) == (4, 4) else cy - 2, VELVETGOLD, 1)
        r.darken_noise(0.25, -1, cell=3)
        r.speck(DUST, 2, 0.05)  # dust lying in the folds
    cube(out, 'gold_curtain', paint, '#5e4414', destroy=1.0)


# ---------------------------------------------------------------- the Gold Room's carpet
@prop
def gold_room_carpet(out):
    FIG = ['..#..', '.#.#.', '#.#.#', '.#.#.', '..#..']

    def paint(r):
        r.fill(CARPETRED, 3, amp=0.5, white_amp=0.55, cell=3)
        for (cx, cy) in ((1, 1), (9, 9)):  # small gold medallions on a half-drop
            for yy, row in enumerate(FIG):
                for xx, ch in enumerate(row):
                    if ch == '#':
                        r.px(cx + xx, cy + yy, DULLGOLD, 2 + (xx + yy) % 2, metal=0, rough=240)
        for (x, y) in ((11, 3), (3, 11)):
            r.px(x, y, DULLGOLD, 1, metal=0, rough=240)
        # worn through to the backing where people walked; damp; a spill
        r.stain(GRIME, 1, 12, 5, 2.6, 1.8, seed=1, p=0.75)
        r.stain(GRIME, 0, 4, 13, 2.0, 1.4, seed=2, p=0.6)
        r.darken_noise(0.3, -1, cell=4)
        r.speck(DUST, 1, 0.04)
    cube(out, 'gold_room_carpet', paint, '#2b1013', destroy=1.0)


# ---------------------------------------------------------------- old plaster ceilings
def _plaster(r):
    stained = r.variant == 'stained'
    r.fill(OLDPLASTER, 4, amp=0.6, white_amp=0.35, cell=5)
    # hairline cracks
    for pts in (((1, 3), (2, 4), (3, 4), (4, 5), (5, 5), (6, 6), (6, 7), (7, 8)), ((10, 1), (10, 2), (11, 3), (11, 4), (12, 5)),
                ((13, 11), (12, 12), (12, 13), (11, 14), (11, 15))):
        for (x, y) in pts:
            r.px(x, y, OLDPLASTER, 1, h=-14)
    if stained:
        # a brown ring where the water came through, and the plaster fallen off the laths in the middle of it
        for y in range(16):
            for x in range(16):
                d = math.hypot(x + 0.5 - 9, (y + 0.5 - 8) * 1.1) + 0.8 * math.sin(x * 1.3 + y * 0.7)
                if 5.0 < d < 6.2:
                    r.px(x, y, WATERSTAIN, 2)
                elif d <= 5.0:
                    r.px(x, y, WATERSTAIN, 3 + (x + y) % 2)
                if d < 2.7:
                    r.px(x, y, LATH, 3 if y % 3 else 0, h=-26)
        r.speck(MOULD, 2, 0.05)
    else:
        r.stain(WATERSTAIN, 4, 3, 12, 2.2, 1.6, seed=5, p=0.55)
    r.darken_noise(0.2, -1, cell=4)


@prop
def old_plaster_ceiling(out):
    cube(out, 'old_plaster_ceiling', _plaster, '#6e6858', destroy=1.0, variant='plain')


@prop
def stained_plaster_ceiling(out):
    cube(out, 'stained_plaster_ceiling', _plaster, '#5d5749', destroy=1.0, variant='stained')


# ---------------------------------------------------------------- the Other Office's floor
@prop
def old_office_tile(out):
    def paint(r):
        for y in range(16):
            for x in range(16):
                gx, gy = x % 4, y % 4
                t = (x // 4) * 3 + (y // 4) * 5
                if gx == 0 or gy == 0:
                    r.px(x, y, GRIME, 0 + (x + y) % 2, rough=240, h=-18)
                else:
                    i = 2 + t % 3 + (1 if gx == 1 or gy == 1 else 0) - (1 if gx == 3 and gy == 3 else 0)
                    r.px(x, y, SLATE, i, rough=150)
        # two tiles gone (the screed under them), one cracked across, a rust-brown stain
        for (tx, ty) in ((2, 1), (0, 3)):
            for y in range(ty * 4 + 1, ty * 4 + 4):
                for x in range(tx * 4 + 1, tx * 4 + 4):
                    r.px(x, y, CONCRETE, 1 + (x + y) % 2, h=-16)
        for (x, y) in ((5, 9), (6, 10), (7, 10), (5, 5), (6, 6), (7, 7)):
            r.px(x, y, INK, 2, h=-12)
        r.stain(WATERSTAIN, 1, 12, 12, 2.4, 2.0, seed=2, p=0.7)
        r.darken_noise(0.3, -1, cell=4)
        r.speck(DUST, 1, 0.05)
    cube(out, 'old_office_tile', paint, '#23272b')


# ---------------------------------------------------------------- the raw cellar's floor
def _concrete(r):
    r.fill(CONCRETE, 3, amp=0.9, white_amp=0.4, cell=5)
    r.speck(CONCRETE, 5, 0.05, seed=1)  # aggregate
    r.speck(CONCRETE, 1, 0.05, seed=2)
    for (x, y) in ((2, 13), (3, 12), (4, 12), (5, 11), (6, 11), (7, 10), (7, 9), (8, 8)):
        r.px(x, y, CONCRETE, 0, h=-16)
    r.darken_noise(0.3, -1, cell=5)
    if r.variant == 'puddle':
        cx, cy = 8.0, 8.0
        for yy in range(16):
            for xx in range(16):
                ang = math.atan2(yy + 0.5 - cy, xx + 0.5 - cx)
                rad = 5.2 + 1.2 * math.sin(ang * 3 + 0.4) + 0.7 * math.sin(ang * 5 + 2.0)
                d = math.hypot(xx + 0.5 - cx, (yy + 0.5 - cy) * 1.1)
                if d < rad - 0.9:
                    r.px(xx, yy, WET, 1 if d < rad - 2.4 else 2, h=-8)
                elif d < rad:
                    r.px(xx, yy, CONCRETE, 0, rough=120)  # the damp rim
        for (xx, yy) in ((6, 6), (7, 6), (10, 9)):
            r.px(xx, yy, WET, 5, h=-8)


@prop
def cellar_concrete(out):
    cube(out, 'cellar_concrete', _concrete, '#3e3e3a', destroy=2.0, variant='dry')


@prop
def cellar_puddle(out):
    cube(out, 'cellar_puddle', _concrete, '#31312e', destroy=2.0, variant='puddle')
