"""Material ramps (dark -> light) for the rework's blocks, and a few shared painters. Same rules as
tools/blocks/props/pal.py: short ramps, a little desaturated, grime on everything, PBR intent on the material."""
from propkit import Mat, Geo, Face, solid, panel, block_json, mi_set, FONT_3x5, FONT_3x4
from pal import *  # noqa: F401,F403
from pal import STEEL, CHROME, BLACK, GRIME, RUST, WOOD

# wood, laminate, cloth
OAK = Mat('rw_oak', ['#2a1a10', '#3a2416', '#4b301d', '#5d3c25', '#6e492d', '#7f5636', '#8f6340'], rough=160, h=138, hk=4)
PINE = Mat('rw_pine', ['#5a4526', '#705731', '#86693c', '#9b7c48', '#ae8f57', '#bfa268'], rough=190, h=138, hk=4)
LAM = Mat('rw_laminate', ['#5a4a36', '#6b5a43', '#7c6a50', '#8c7a5e', '#9a886b', '#a69476'], rough=90, h=140, hk=3)
STALL = Mat('rw_stall', ['#2f3d44', '#3b4b53', '#485a63', '#566a74', '#657a85', '#758b96'], rough=120, h=140, hk=3)
CORD = Mat('rw_corduroy', ['#2b1c12', '#3a2618', '#4a311f', '#5a3d27', '#6a4930', '#7a563a'], rough=245, h=136, hk=4)
CANVAS_R = Mat('rw_canvas_red', ['#3a0e0e', '#531414', '#6d1b1a', '#872422', '#9f302b', '#b33f37'], rough=235, h=136, hk=3)
CANVAS_W = Mat('rw_canvas_cream', ['#6b6450', '#847c64', '#9c9478', '#b2aa8c', '#c5bd9f', '#d5ceb2'], rough=235, h=136, hk=3)
FELT = Mat('rw_felt', ['#0c2a1a', '#123a24', '#184b2f', '#1f5d3a', '#286f46'], rough=245, h=136, hk=2)
VINYL_R = Mat('rw_vinyl_red', ['#330a0c', '#4b0f12', '#641518', '#7e1c1f', '#972628', '#ad3433'], rough=100, h=140, hk=3)
SOIL = Mat('rw_soil', ['#120d08', '#1b140c', '#261c11', '#322517', '#3e2e1d'], rough=250, h=132, hk=5)
TWIG = Mat('rw_twig', ['#1c140c', '#2a1e12', '#3a2a19', '#4b3721', '#5c452b'], rough=235, h=138, hk=3)
CONC = Mat('rw_concrete', ['#3c3b37', '#4a4944', '#595751', '#68665f', '#77756d', '#86847b', '#95938a'], rough=235, h=134, hk=3)

STAINLESS = Mat('rw_stainless', ['#4a4f55', '#5f656b', '#757b82', '#8b9198', '#a1a7ad', '#b6bbc0', '#c9cdd1'], metal=110, rough=100, h=140, hk=4)

# tile, enamel, plastic
TILE_W = Mat('rw_tile_white', ['#6c6a62', '#858278', '#9e9a8e', '#b5b1a4', '#c7c3b6', '#d6d2c5', '#e2ded2'], rough=70, h=142, hk=3)
TILE_M = Mat('rw_tile_mint', ['#3a5a4e', '#497060', '#5a8573', '#6c9a87', '#80ae9b', '#96c0ae', '#abd0bf'], rough=70, h=142, hk=3)
GROUT = Mat('rw_grout', ['#5a564c', '#6a665b', '#7a766a', '#8a8679'], rough=240, h=128, hk=2)
ENAMEL = Mat('rw_enamel', ['#55534d', '#6e6b64', '#88857c', '#a19d93', '#b7b3a8', '#cac6bb', '#dad6cb'], rough=70, h=142, hk=3)
GREEN_P = Mat('rw_green_paint', ['#0e2318', '#153222', '#1d432d', '#265539', '#316846', '#3e7b54'], metal=60, rough=150, h=138, hk=3)
BLUE_P = Mat('rw_blue_paint', ['#0e1a3a', '#152650', '#1d3468', '#274481', '#34569a', '#4469b0'], rough=110, h=140, hk=3)
RED_P = Mat('rw_red_paint', ['#3a0c0c', '#561111', '#731716', '#8f1f1c', '#aa2a25', '#c23a32'], rough=105, h=140, hk=3)
YEL_P = Mat('rw_yellow_paint', ['#5a4410', '#7a5c15', '#9a771c', '#b89224', '#d0aa30', '#e2bf46'], rough=110, h=140, hk=3)
PURP_P = Mat('rw_purple_paint', ['#1f1030', '#2e1848', '#3f2261', '#522e7b', '#673d95', '#7d50ae'], rough=110, h=140, hk=3)
TEAL_P = Mat('rw_teal_paint', ['#0c2c2e', '#124044', '#19565a', '#226d71', '#2e8589', '#3e9da0'], rough=110, h=140, hk=3)
CREAM = Mat('rw_cream', ['#6a6046', '#857958', '#a0936c', '#b8ab82', '#ccc099', '#dcd2b0', '#e9e1c6'], rough=200, h=140, hk=3)

# glass, mirror, light
GLASSF = Mat('rw_glass', ['#1c2a30', '#2c3e46', '#42565f', '#5f757e', '#8aa0a8', '#bccdd2', '#e6f0f2'], rough=18, h=146, hk=1)
MIRR = Mat('rw_mirror', ['#2a2e36', '#454b56', '#6a7280', '#9aa2b0', '#c8ced8', '#eef2f8'], metal=240, rough=22, h=150, hk=2)
BULB = Mat('rw_bulb', ['#a86a22', '#dc9c3e', '#ffcf72', '#ffecb8', '#fffbe6'], rough=40, emit=[150, 210, 245, 255, 255], h=150, hk=1)
BULB_OFF = Mat('rw_bulb_off', ['#2c261a', '#3c3424', '#4e4430', '#62563e', '#766a50'], rough=45, h=150, hk=1)
COLD = Mat('rw_cold_light', ['#7aa0b8', '#a0c4d8', '#c4e0ee', '#e2f2fa', '#ffffff'], rough=40, emit=[140, 190, 230, 250, 255], h=148, hk=1)
SCREEN = Mat('rw_screen', ['#05070c', '#0a0e18', '#101626', '#182036', '#222c48'], rough=30, emit=[40, 60, 80, 100, 120], h=128, hk=1)


def lit(name, ramp):
    """A glowing colour (neon, screen art, lit signs)."""
    return Mat(name, ramp, rough=40, emit=[140, 190, 230, 250, 255][:len(ramp)], h=150, hk=1)


N_PINK = lit('rw_neon_pink', ['#7a1f52', '#c0337f', '#ff5fb0', '#ff9fd0', '#ffe0f0'])
N_TEAL = lit('rw_neon_teal', ['#11605a', '#1fa398', '#4ff0e0', '#a0fff4', '#e4fffc'])
N_YEL = lit('rw_neon_yellow', ['#7a5a10', '#c0921c', '#ffd84a', '#ffec98', '#fff8dc'])
N_PURP = lit('rw_neon_purple', ['#3a1a6a', '#6a35b0', '#b070ff', '#d4b0ff', '#f0e4ff'])
N_RED = lit('rw_neon_red', ['#6a1410', '#b0241a', '#ff4a34', '#ff9a86', '#ffe0d8'])
N_GRN = lit('rw_neon_green', ['#0e5a1e', '#1ca038', '#4cf070', '#a4ffb8', '#e2ffe8'])
N_BLUE = lit('rw_neon_blue', ['#102a6a', '#1c4ab0', '#4a8aff', '#a0c4ff', '#e0ecff'])
N_WHITE = lit('rw_neon_white', ['#8a8a80', '#c0c0b4', '#eeeedf', '#ffffff', '#ffffff'])
NEON = {'pink': N_PINK, 'teal': N_TEAL, 'yellow': N_YEL, 'purple': N_PURP, 'red': N_RED, 'green': N_GRN, 'blue': N_BLUE, 'white': N_WHITE}

# glyphs missing from propkit's 3x5 font
FONT_EXTRA = {
    '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'],
    '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
    'V': ['#.#', '#.#', '#.#', '#.#', '.#.'], 'J': ['..#', '..#', '..#', '#.#', '.#.'],
    'X': ['#.#', '#.#', '.#.', '#.#', '#.#'], '-': ['...', '...', '###', '...', '...'],
    'Z': ['###', '..#', '.#.', '#..', '###'], 'Q': ['.#.', '#.#', '#.#', '.#.', '..#'],
    '.': ['.', '.', '.', '.', '#'], '&': ['.#.', '#.#', '.#.', '#.#', '.##'], ':': ['.', '#', '.', '#', '.'],
    "'": ['#', '#', '.', '.', '.'], '$': ['.##', '##.', '.#.', '.##', '##.'],
}


def steel(b=3, grime=0.25, streak='h', bevel=(1, -1)):
    return panel(STAINLESS, b, amp=0.45, white_amp=0.3, streak=streak, grime=grime, bevel=bevel)


def chrome(b=3):
    return panel(CHROME, b, amp=0.5, white_amp=0.2, bevel=None, streak='v')


def wood(m=OAK, b=3, streak='v', grime=0.3, bevel=(1, -1)):
    return panel(m, b, amp=0.6, white_amp=0.35, streak=streak, grime=grime, bevel=bevel)


def flat(m, b=None, grime=0.2, bevel=(1, -1), amp=0.45):
    return panel(m, b, amp=amp, white_amp=0.3, grime=grime, bevel=bevel)


def glass(r, frame=CHROME, fi=2):
    """A pane: a thin frame, the middle left clear, two glints."""
    r.clear()
    r.frame_rect(0, 0, r.w, r.h, frame, fi)
    for k in range(min(r.w, r.h) - 3):
        if k % 3 != 2 and 2 + k < r.w - 1 and r.h - 3 - k > 0:
            r.px(2 + k, r.h - 3 - k, GLASSF, 5 if k % 2 else 4)


def face_sheet(name, painter, w=16, h=16, variant=None):
    """Paint one w x h face (a cube texture) with a propkit painter."""
    g = Geo(name, max(w, h), max(w, h))
    g.tw, g.th = w, h
    g.box('cube', (-w / 2, 0, -8), (w / 2, h, -8), {'north': painter})
    g.placements = {'cube_0.north': (0, 0, w, h)}
    g.items = g._face_items()
    return g.paint(variant)


def cube(out, name, painter, map_color, destroy=1.5, variant=None):
    """A full cube with one 16 x 16 texture on every face."""
    out.tex(name, face_sheet(name, painter, variant=variant))
    out.block(name, block_json(name, geometry='minecraft:geometry.full_block', materials=mi_set(name, render='opaque'),
                               facing=False, collision=True, selection=True, map_color=map_color, destroy=destroy,
                               light_dampening=15))


__all__ = [n for n in dir() if not n.startswith('_')]
