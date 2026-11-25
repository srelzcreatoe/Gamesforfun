"""The rework's full cubes: panelled oak wainscot, glazed wall tile for the kitchen and the restrooms, stainless
sheet for the kitchen's equipment, a road case for backstage, cream panelling with a gold line for the columns."""
from propkit import prop
from rework_pal import *  # noqa: F403


@prop
def wainscot_oak(out):
    """Dark oak wainscot: one raised panel per block under a moulded cap, a skirting board at the foot."""
    def paint(r):
        r.fill(OAK, 3, amp=0.6, white_amp=0.35, streak='v', cell=3)
        r.hline(0, 0, 16, OAK, 6); r.hline(0, 1, 16, OAK, 4); r.hline(0, 2, 16, OAK, 1)   # the cap rail
        for y in range(3, 13):
            for x in (0, 15):
                r.shift(x, y, -1)
        r.frame_rect(2, 4, 12, 8, OAK, 1)                                                  # the panel's groove
        r.hline(3, 5, 10, OAK, 5); r.vline(3, 5, 6, OAK, 5)                                # raised field, lit from the top left
        r.hline(3, 10, 10, OAK, 2); r.vline(12, 5, 6, OAK, 2)
        r.hline(0, 13, 16, OAK, 1); r.hline(0, 14, 16, OAK, 4); r.hline(0, 15, 16, OAK, 2)  # skirting
        r.darken_noise(0.3, -1, bottom=0.8, cell=3)
        r.speck(GRIME, 2, 0.02)
        for (x, y) in ((6, 12), (7, 13), (10, 14)):                                         # scuffs from chair backs and shoes
            r.px(x, y, OAK, 6)
    cube(out, 'wainscot_oak', paint, '#4b301d')


def _tile(mat):
    def paint(r):
        for y in range(16):
            for x in range(16):
                gx, gy = x % 4, y % 4
                t = (x // 4) * 3 + (y // 4) * 5
                if gx == 3 or gy == 3:
                    r.px(x, y, GROUT, 1 + (x + y) % 2, h=-16)
                else:
                    i = 3 + t % 3 + (1 if gx == 0 and gy == 0 else 0) - (1 if gx == 2 and gy == 2 else 0)
                    r.px(x, y, mat, i)
        for (x, y) in ((8, 5), (9, 5), (9, 6), (10, 6)):                                    # one tile cracked across
            r.px(x, y, mat, 1, h=-10)
        r.drip(GRIME, 2, 6, 3, 6, seed=1, rough=200)
        r.darken_noise(0.25, -1, bottom=0.9, cell=4)
        r.speck(GRIME, 3, 0.02, rough=220)
    return paint


@prop
def wall_tile_white(out):
    cube(out, 'wall_tile_white', _tile(TILE_W), '#a5a194')


@prop
def wall_tile_mint(out):
    cube(out, 'wall_tile_mint', _tile(TILE_M), '#5c8373')


@prop
def steel_panel(out):
    """Brushed stainless sheet, a folded seam at the edges, a rivet in each corner, fingerprints and a dent."""
    def paint(r):
        r.fill(STAINLESS, 4, amp=0.5, white_amp=0.25, streak='h', cell=4)
        r.bevel(1, -1)
        for (x, y) in ((1, 1), (14, 1), (1, 14), (14, 14)):
            r.px(x, y, STAINLESS, 6); r.px(x + 1 if x < 8 else x - 1, y + 1 if y < 8 else y - 1, STAINLESS, 2)
        r.stain(STAINLESS, 2, 10, 9, 2.5, 1.6, seed=1, p=0.5)
        r.stain(GRIME, 3, 4, 13, 2.2, 1.2, seed=2, p=0.45, rough=220, metal=40)
        r.darken_noise(0.18, -1, bottom=0.6)
    cube(out, 'steel_panel', paint, '#747a81', destroy=2.5)


@prop
def road_case(out):
    """A touring road case: black laminate in an aluminium frame, ball corners, a recessed handle, a stencil."""
    def paint(r):
        r.fill(BLACK, 2, amp=0.5, white_amp=0.4, cell=4)
        r.frame_rect(0, 0, 16, 16, STEEL, 3)
        r.frame_rect(1, 1, 14, 14, STEEL, 5)
        r.hline(1, 14, 14, STEEL, 2); r.vline(14, 1, 14, STEEL, 2)
        for (x, y) in ((0, 0), (13, 0), (0, 13), (13, 13)):
            r.rect(x, y, 3, 3, CHROME, 3); r.px(x + 1, y + 1, CHROME, 5)
        r.rect(5, 9, 6, 3, BLACK, 0); r.hline(6, 10, 4, CHROME, 3)                   # the handle in its dish
        r.text('RR', 5, 3, PAPER, 3)
        r.speck(STEEL, 4, 0.02, only=BLACK)                                                 # chips in the laminate
        r.darken_noise(0.2, -1, bottom=0.5)
    cube(out, 'road_case', paint, '#1a1a1e', destroy=2.0)


@prop
def column_cream(out):
    """Cream-painted panelling for columns and pilasters: a sunk field between two gold lines, chipped at the foot."""
    def paint(r):
        r.fill(CREAM, 4, amp=0.5, white_amp=0.3, cell=5)
        for x in (0, 15):
            r.vline(x, 0, 16, CREAM, 2)
        r.vline(1, 0, 16, CREAM, 6); r.vline(14, 0, 16, CREAM, 3)
        for x in (3, 12):
            r.vline(x, 0, 16, GOLD, 4, metal=90)
        r.vline(4, 0, 16, CREAM, 2); r.vline(11, 0, 16, CREAM, 5)
        r.shade_rect(5, 0, 6, 16, -1)
        r.drip(GRIME, 3, 7, 2, 9, seed=3)
        r.darken_noise(0.22, -1, bottom=0.8, cell=4)
        r.speck(GRIME, 3, 0.015)
    cube(out, 'column_cream', paint, '#b8ab82')


@prop
def column_cap(out):
    """The same column's capital: a stepped cream moulding, a gold band, a red star."""
    def paint(r):
        r.fill(CREAM, 4, amp=0.4, white_amp=0.3)
        r.hline(0, 0, 16, CREAM, 6); r.hline(0, 1, 16, CREAM, 5); r.hline(0, 2, 16, CREAM, 2)
        r.hline(0, 3, 16, GOLD, 4, metal=90); r.hline(0, 4, 16, GOLD, 2, metal=90)
        r.hline(0, 13, 16, CREAM, 2); r.hline(0, 14, 16, GOLD, 3, metal=90); r.hline(0, 15, 16, CREAM, 3)
        for (x, y) in ((8, 6), (7, 7), (8, 7), (9, 7), (5, 8), (6, 8), (7, 8), (8, 8), (9, 8), (10, 8), (11, 8), (6, 9), (7, 9), (8, 9), (9, 9), (10, 9),
                       (7, 10), (8, 10), (9, 10), (6, 11), (7, 11), (9, 11), (10, 11)):
            r.px(x - 1, y, RED_P, 3 + (x + y) % 2)
        r.darken_noise(0.2, -1, cell=4)
    cube(out, 'column_cap', paint, '#ccc099')
