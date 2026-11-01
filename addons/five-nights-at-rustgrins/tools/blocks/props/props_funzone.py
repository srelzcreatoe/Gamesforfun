"""Fun Zone props (docs/BLOCKS.md section D): the family fun-centre side of the pizzeria, bright by day,
abandoned and dusty at night. Padded vinyl, crawl tubes, a slide, the ball pit, skee-ball lanes, a kiddie
rocket ride, prize cases, a wall of plush prizes and a stage truss. Same conventions as the other prop
files (models face north, wall props have their back at z = +8, every random choice is seeded)."""
import math

from propkit import Geo, Face, Mat, prop, panel, block_json, box, mi_set, glow, bs
from pal import *  # noqa: F403

# ---------------------------------------------------------------- materials (bright plastics, faded)
P_RED = Mat('pl_red', ['#3c0c0c', '#5c1414', '#7c1c1a', '#9a2722', '#b5352b', '#c94a3a', '#d8654f'], rough=95, h=140, hk=3)
P_BLUE = Mat('pl_blue', ['#0c1a3a', '#122756', '#193672', '#22468c', '#2e58a2', '#416db5', '#5884c4'], rough=95, h=140, hk=3)
P_YEL = Mat('pl_yel', ['#4a360a', '#6c500f', '#8f6c16', '#b08a1e', '#c9a12a', '#dab53f', '#e6c75c'], rough=95, h=140, hk=3)
P_GRN = Mat('pl_grn', ['#0d2a14', '#143c1d', '#1c5127', '#256732', '#337c3f', '#47904f', '#5fa564'], rough=95, h=140, hk=3)
P_PUR = Mat('pl_pur', ['#22103a', '#321852', '#43226a', '#552d82', '#683b97', '#7d4fab'], rough=95, h=140, hk=3)
P_TEAL = Mat('pl_teal', ['#0a2a2c', '#103e40', '#175455', '#1f6b6a', '#2a827f', '#3a9893'], rough=95, h=140, hk=3)
P_PINK = Mat('pl_pink', ['#4a1830', '#6a2444', '#8c325a', '#ab4270', '#c45886', '#d6729c'], rough=95, h=140, hk=3)
COLORS = [('red', P_RED), ('blue', P_BLUE), ('yellow', P_YEL), ('green', P_GRN)]
FOAM = Mat('foam', ['#8a7a3a', '#a8964c', '#c2b062', '#d6c67a'], rough=250, h=134, hk=4)
MAPLE = Mat('maple', ['#4a3418', '#664922', '#82602c', '#9c7638', '#b28b46', '#c49e58', '#d2b06c'], rough=120, h=138, hk=4)
NET = Mat('rope', ['#3a3226', '#524634', '#6c5d44', '#867556', '#9c8a68'], rough=245, h=140, hk=3)
SCORE = Mat('score_led', ['#5a0c08', '#9a1a10', '#e0301c', '#ff5a3a', '#ff9a7a'], rough=60, emit=[60, 140, 230, 255, 255], h=146, hk=1)
SCORE_OFF = Mat('score_off', ['#1a0a08', '#2a100c', '#3a1610'], rough=60, h=140, hk=1)
BULB_Y = Mat('bulb_y', ['#8a6a1a', '#d0a830', '#ffd860', '#fff0b0', '#fffbe8'], rough=50, emit=[120, 200, 245, 255, 255], h=148, hk=1)
GLASS_CASE = Mat('case_glass', ['#5a6a70', '#7a8c92', '#9cb0b6', '#c8d8dc'], metal=0, rough=20, h=150, hk=1)
BALL_COLORS = [P_RED, P_BLUE, P_YEL, P_GRN, P_PUR, P_PINK]


def _face_sheet(name, painter, w=16, h=16, variant=None):
    """Paint one w x h face (a cube texture) with a propkit painter."""
    g = Geo(name, w, h)
    g.box('cube', (-w / 2, 0, -8), (w / 2, h, -8), {'north': painter})
    return g, g.paint(variant)


# =============================================================== padded vinyl (full block)
@prop
def vinyl_pad(out):
    def pad(r):
        m = dict(COLORS)[r.variant]
        r.fill(m, 4, amp=0.35, white_amp=0.25, cell=4)
        # two quilted panels split down the middle, rounded seams, a button tuft in each
        for y in range(16):
            r.px(0, y, m, 2); r.px(15, y, m, 2); r.px(7, y, m, 2); r.px(8, y, m, 3)
        for x in range(16):
            r.px(x, 0, m, 2); r.px(x, 15, m, 1)
        for (cx, cy) in ((3, 4), (11, 4), (3, 11), (11, 11)):
            r.px(cx, cy, m, 2); r.px(cx + 1, cy, m, 5)
        for x in range(1, 7):
            r.px(x, 1, m, 6)  # sheen along the top edge of the panel
        for x in range(9, 15):
            r.px(x, 1, m, 6)
        r.darken_noise(0.22, -1, bottom=0.6)  # grime from small shoes
        if r.variant == 'yellow':
            r.stain(FOAM, 2, 12.5, 12.5, 1.8, 1.2, p=0.9)  # a split seam, foam showing
        if r.variant == 'red':
            r.stain(GRIME, 2, 4.5, 13.5, 2.2, 1.0, p=0.7)
    perms = []
    for i, (c, _) in enumerate(COLORS):
        g, sh = _face_sheet(f'vinyl_pad_{c}', pad, variant=c)
        out.tex(f'vinyl_pad_{c}', sh)
        perms.append((bs('fnar:color', i), {'minecraft:material_instances': mi_set(f'vinyl_pad_{c}', render='opaque')}))
    blk = block_json('vinyl_pad', geometry='minecraft:geometry.full_block', materials=mi_set('vinyl_pad_red', render='opaque'),
                     states={'fnar:color': {'values': {'min': 0, 'max': 3}}}, facing=False,
                     collision=True, selection=True, map_color='#9a2722', destroy=1.0, perms=perms, light_dampening=15)
    out.block('vinyl_pad', blk)
    out.views('vinyl_pad', [{'label': f'color {i} {c}', 'states': {'fnar:color': i}, 'focus': [0, 0.5, 0], 'dist': 2.4}
                            for i, (c, _) in enumerate(COLORS)])


# =============================================================== crawl tube
@prop
def play_tube(out):
    g = Geo('play_tube', 64, 64)

    def shell(kind):
        def p(r):
            m = dict(COLORS)[r.variant]
            outside = kind == 'out'
            r.fill(m, 4 if outside else 2, amp=0.3, white_amp=0.25, cell=4)
            # moulded ribs every 4 px along the tube (the tube runs along z: rows on the sides, columns on top)
            for c in range(r.w):
                for rr in range(r.h):
                    _, _, z = r.world(c, rr)
                    if int(math.floor(z + 8)) % 4 == 0:
                        r.shift(c, rr, 1 if outside else -1)
            if outside:
                r.darken_noise(0.18, -1)
            else:
                r.darken_noise(0.4, -1)
                r.speck(m, 0, 0.06)  # scuffs inside the tube
            if kind == 'out' and r.face in ('east', 'west') and r.variant != 'yellow':
                r.speck(m, 6, 0.03)
        return p

    def porthole(kind):
        """Side wall with a round clear window (transparent texels), only on the window variant."""
        base = shell(kind)

        def p(r):
            base(r)
            if r.cube.bone != 'window':
                return
            for c in range(r.w):
                for rr in range(r.h):
                    _, y, z = r.world(c, rr)
                    d = math.hypot(z - 0.0, y - 8.0)
                    if d < 3.6:
                        r.px(c, rr, None)
                    elif d < 4.6:
                        r.px(c, rr, GREYPLAST, 4)  # rubber gasket
        return p

    rim = lambda r: (r.fill(dict(COLORS)[r.variant], 5, amp=0.3), r.bevel(1, -1))
    for bone in ('straight', 'window'):
        g.box(bone, (-5, 1, -8), (5, 3, 8), {'down': Face(shell('out'), 'bo'), 'up': Face(shell('in'), 'bi'), 'north': Face(rim, 'rb'), 'south': Face(rim, 'rb')})
        g.box(bone, (-5, 13, -8), (5, 15, 8), {'up': Face(shell('out'), 'to'), 'down': Face(shell('in'), 'ti'), 'north': Face(rim, 'rt'), 'south': Face(rim, 'rt')})
        for sx in (-1, 1):
            x0, x1 = (-7, -5) if sx < 0 else (5, 7)
            outf, inf = ('west', 'east') if sx < 0 else ('east', 'west')
            g.box(bone, (x0, 3, -8), (x1, 13, 8), {outf: Face(porthole('out'), f'so{bone}'), inf: Face(porthole('in'), f'si{bone}'),
                                                  'north': Face(rim, 'rs'), 'south': Face(rim, 'rs')})
            # bevelled corners
            for (y0, y1) in ((2, 4), (12, 14)):
                g.box(bone, (x0 + (1 if sx < 0 else 0), y0, -8), (x1 - (0 if sx < 0 else 1), y1, 8), {'up': Face(shell('out'), 'c'), 'down': Face(shell('out'), 'c'),
                                                                                                        outf: Face(shell('out'), 'cs'), 'north': Face(rim, 'rc'), 'south': Face(rim, 'rc')})
    out.geo(g, {'geometry.fnar.play_tube': (['straight'], (0, 0, 0)), 'geometry.fnar.play_tube_window': (['window'], (0, 0, 0))})
    perms = []
    for i, (c, _) in enumerate(COLORS):
        out.tex(f'play_tube_{c}', g.paint(c))
        perms.append((bs('fnar:color', i), {'minecraft:material_instances': mi_set(f'play_tube_{c}')}))
    perms.append((bs('fnar:window', True), {'minecraft:geometry': 'geometry.fnar.play_tube_window'}))
    blk = block_json('play_tube', geometry='geometry.fnar.play_tube', materials=mi_set('play_tube_red'),
                     states={'fnar:color': {'values': {'min': 0, 'max': 3}}, 'fnar:window': [False, True]},
                     collision=box(-7, 1, -8, 7, 15, 8), selection=box(-7, 1, -8, 7, 15, 8), map_color='#9a2722', destroy=1.0, perms=perms)
    out.block('play_tube', blk)
    f = {'focus': [0, 0.5, 0], 'dist': 2.2, 'dir': [0.8, 0.4, -1]}
    out.views('play_tube', [{'label': f'{c}', 'states': {'fnar:color': i, 'fnar:window': i % 2 == 1}, **f} for i, (c, _) in enumerate(COLORS)])


# =============================================================== slide
@prop
def play_slide(out):
    g = Geo('play_slide', 64, 64)

    def bed(r):
        r.fill(P_YEL, 5, amp=0.25, white_amp=0.2, cell=4)
        if r.face == 'up':
            for c in range(r.w):
                r.px(c, 0, P_YEL, 3)
            for rr in range(r.h):
                if rr % 5 == 2:
                    r.hline(1, rr, r.w - 2, P_YEL, 6)  # polished streaks where everyone slid
        else:
            r.darken_noise(0.3, -1)

    def rail(r):
        r.fill(P_RED, 4, amp=0.3, white_amp=0.25, cell=3)
        r.bevel(1, -1)
        r.darken_noise(0.2, -1)

    # 0: chute, falling one block towards the front (north) over one block
    g.bone('chute', pivot=(0, 8, 0), rotation=(45, 0, 0))
    g.box('chute', (-6, 6.5, -9.8), (6, 8, 9.8), {'up': Face(bed, 'bu'), 'down': Face(bed, 'bd'), 'sides': Face(bed, 'be'), 'ends': Face(bed, 'bx')})
    for x0 in (-7.5, 6):
        g.box('chute', (x0, 6.5, -8.2), (x0 + 1.5, 11, 8.2), {'sides': Face(rail, 'rs'), 'up': Face(rail, 'ru'), 'down': Face(rail, 'rd'), 'north': Face(rail, 'rn'), 'south': Face(rail, 'rn')})
    # 1: the run-out at the bottom, curving up into a lip
    g.box('lip', (-6, 1, -6), (6, 2.5, 8), {'up': Face(bed, 'lu'), 'sides': Face(bed, 'le'), 'down': Face(bed, 'ld')})
    g.box('lip', (-6, 1, -8), (6, 3, -6), {'up': Face(bed, 'lpu'), 'sides': Face(bed, 'lpe'), 'north': Face(rail, 'lpn')})
    for x0 in (-7.5, 6):
        g.box('lip', (x0, 1, -8), (x0 + 1.5, 5, 8), {'sides': Face(rail, 'lr'), 'up': Face(rail, 'lru'), 'north': Face(rail, 'lrn'), 'south': Face(rail, 'lrn')})
    for x0 in (-7.5, 6):
        for z0 in (-7, 5):
            g.box('lip', (x0, 0, z0), (x0 + 1.5, 1, z0 + 1.5), {'sides': Face(panel(GREYPLAST, 2, bevel=None), 'ft')})
    out.geo(g, {'geometry.fnar.play_slide': (['chute'], (0, 0, 0)), 'geometry.fnar.play_slide_lip': (['lip'], (0, 0, 0))})
    out.tex('play_slide', g.paint())
    perms = [(bs('fnar:part', 1), {'minecraft:geometry': 'geometry.fnar.play_slide_lip', 'minecraft:collision_box': box(-8, 0, -8, 8, 3, 8),
                                   'minecraft:selection_box': box(-8, 0, -8, 8, 5, 8)})]
    blk = block_json('play_slide', geometry='geometry.fnar.play_slide', materials=mi_set('play_slide'),
                     states={'fnar:part': {'values': {'min': 0, 'max': 1}}},
                     collision=box(-8, 0, -8, 8, 8, 8), selection=box(-8, 0, -8, 8, 16, 8), map_color='#c9a12a', destroy=1.0, perms=perms)
    out.block('play_slide', blk)
    f = {'focus': [0, 0.5, 0], 'dist': 2.4, 'dir': [1, 0.5, -0.4]}
    out.views('play_slide', [{'label': 'chute', 'states': {'fnar:part': 0}, **f}, {'label': 'lip', 'states': {'fnar:part': 1}, **f}])


# =============================================================== ball pit
def _balls(r, seed, density=1.0, dust=0.0):
    """Packed plastic balls: 3-4 px discs in six colours with a highlight, dark gaps between them."""
    r.fill(SHADOW, 1)
    rng = __import__('random').Random(seed)
    # a jittered grid of balls so they read as round and packed, not as noise
    for gy in range(-1, r.h // 4 + 1):
        for gx in range(-1, r.w // 4 + 1):
            cx = gx * 4 + 2 + rng.uniform(-0.7, 0.7) + (2 if gy % 2 else 0)
            cy = gy * 4 + 2 + rng.uniform(-0.7, 0.7)
            rad = rng.uniform(1.9, 2.4) * (density ** 0.1)
            m = rng.choice(BALL_COLORS)
            for c in range(r.w):
                for rr in range(r.h):
                    d = math.hypot(c + 0.5 - cx, rr + 0.5 - cy)
                    if d < rad:
                        i = 4 if d < rad * 0.5 else 3
                        if d >= rad - 0.6:
                            i = 2
                        if abs(c + 0.5 - (cx - rad * 0.35)) < 0.6 and abs(rr + 0.5 - (cy - rad * 0.35)) < 0.6:
                            i = 6  # the shine
                        r.px(c, rr, m, i, rough=40)
    if dust:
        r.speck(PAPER, 1, dust)  # a film of dust: nobody has played in here for a long time


@prop
def ball_pit(out):
    def cube(r):
        _balls(r, 9100, 1.2, dust=0.08)
    _, sh = _face_sheet('ball_pit', cube)
    out.tex('ball_pit', sh)
    g = Geo('ball_pit_top', 64, 64)

    def top(r):
        _balls(r, r.seed('b') % 10000, 1.0, dust=0.12 if r.face == 'up' else 0.04)

    # a lumpy surface: balls heaped unevenly, a hollow where someone sat
    heights = [[5, 6, 4, 5], [4, 3, 2, 5], [6, 3, 4, 6], [5, 6, 5, 4]]
    for i in range(4):
        for j in range(4):
            h = heights[j][i]
            g.box('top', (-8 + i * 4, 0, -8 + j * 4), (-4 + i * 4, h, -4 + j * 4), {'up': Face(top, f'u{i}{j}'), 'sides': Face(top, f's{i}{j}')})
    out.geo(g)
    out.tex('ball_pit_top', g.paint())
    perms = [(bs('fnar:layer', 1), {'minecraft:geometry': 'geometry.fnar.ball_pit_top', 'minecraft:material_instances': mi_set('ball_pit_top'),
                                    'minecraft:collision_box': False, 'minecraft:selection_box': box(-8, 0, -8, 8, 6, 8),
                                    'minecraft:light_dampening': 0})]
    blk = block_json('ball_pit', geometry='minecraft:geometry.full_block', materials=mi_set('ball_pit', render='opaque'),
                     states={'fnar:layer': {'values': {'min': 0, 'max': 1}}}, facing=False,
                     collision=True, selection=True, map_color='#7c1c1a', destroy=0.5, perms=perms, light_dampening=15)
    out.block('ball_pit', blk)
    out.views('ball_pit', [{'label': 'top layer on a full layer', 'parts': [{'states': {'fnar:layer': 0}, 'pos': [0, 0, 0]}, {'states': {'fnar:layer': 1}, 'pos': [0, 1, 0]}],
                            'focus': [0, 1.0, 0], 'dist': 2.4, 'dir': [0.7, 0.8, -1]}])


# =============================================================== skee-ball lane (2 blocks long)
@prop
def skeeball_lane(out):
    g = Geo('skeeball_lane', 64, 64)
    cab = lambda base=4, m=P_BLUE: panel(m, base, amp=0.35, white_amp=0.25, grime=0.3)

    def cab_side(r):
        cab(4)(r)
        for c in range(r.w):  # a racing stripe down the side
            for rr in range(r.h):
                _, y, _ = r.world(c, rr)
                if 3.5 < y < 5.5:
                    r.px(c, rr, P_YEL, 5)
                elif 5.5 <= y < 6.5:
                    r.px(c, rr, P_RED, 4)

    def front(r):  # the player end: coin door with a lit slot, the ticket mouth
        cab(3)(r)
        r.rect(3, 3, 10, 5, IRON, 2)
        r.frame_rect(3, 3, 10, 5, CHROME, 3)
        r.px(5, 5, RED_GLOW, 3, emit=200); r.px(10, 5, RED_GLOW, 3, emit=200)
        r.rect(6, 1, 4, 1, SHADOW, 0)  # ticket slot
        r.px(7, 0, PAPER, 5); r.px(8, 0, PAPER, 4)  # a ticket still hanging out

    def lane(r):
        r.fill(MAPLE, 4, amp=0.4, white_amp=0.3, streak='v')
        for c in (0, r.w - 1):
            r.vline(c, 0, r.h, MAPLE, 2)
        r.speck(GRIME, 2, 0.05)

    def ball(r):
        r.fill(WOOD, 4, amp=0.3)
        r.px(0, 0, WOOD, 5)

    def target(r):  # the ring board: holes worth 10 to 50, 100 in the corners
        r.fill(P_BLUE, 2, amp=0.3)
        cx, cy = r.w / 2, r.h * 0.62
        for c in range(r.w):
            for rr in range(r.h):
                d = math.hypot(c + 0.5 - cx, (rr + 0.5 - cy) * 1.2)
                if abs(d - 5.2) < 0.6 or abs(d - 3.4) < 0.6:
                    r.px(c, rr, P_YEL, 5)
                elif d < 1.3:
                    r.px(c, rr, SHADOW, 0)
        for (c, rr) in ((1, 1), (r.w - 2, 1)):
            r.px(c, rr, SHADOW, 0)
        r.speck(GRIME, 2, 0.05)

    def board(r):  # the backboard: score readout (lit) and a marquee stripe
        r.fill(P_RED, 3, amp=0.3)
        r.bevel(1, -1)
        lit = r.variant != 'off'
        m = SCORE if lit else SCORE_OFF
        r.rect(2, 2, r.w - 4, 4, BLACK, 1)
        for k, ch in enumerate('000'):
            x0 = 3 + k * 4
            for (dx, dy) in ((0, 0), (1, 0), (2, 0), (0, 1), (2, 1), (0, 2), (1, 2), (2, 2)):
                if x0 + dx < r.w - 2:
                    r.px(x0 + dx, 2 + dy, m, 2, **({'emit': 220} if lit else {}))
        for c in range(1, r.w - 1, 2):
            r.px(c, r.h - 2, BULB_Y if lit else YELLOW, 2 if lit else 1)

    # ---- part 0, the player end (front at -z)
    g.box('front', (-7, 0, -8), (7, 7, 8), {'north': front, 'east': Face(cab_side, 'cs'), 'west': Face(cab_side, 'cs'), 'down': Face(cab(1), 'cd')})
    g.box('front', (-6, 7, -6), (6, 7.5, 8), {'up': Face(lane, 'lane0')})
    g.box('front', (-7, 7, -8), (-6, 10, 8), {'sides': Face(cab(5, P_RED), 'rail'), 'up': Face(cab(5, P_RED), 'railu')})
    g.box('front', (6, 7, -8), (7, 10, 8), {'sides': Face(cab(5, P_RED), 'rail'), 'up': Face(cab(5, P_RED), 'railu')})
    g.box('front', (-6, 7, -8), (6, 9, -6), {'north': Face(cab(4), 'trayn'), 'up': Face(lambda r: (r.fill(SHADOW, 1), r.speck(GRIME, 2, 0.2)), 'tray')})
    for k in range(3):  # wooden balls waiting in the return tray
        x = -5 + k * 3.5
        g.box('front', (x, 7.5, -7.75), (x + 2.5, 10, -6.25), {'sides': Face(ball, 'ball'), 'up': Face(ball, 'ballu')})
    # ---- part 1, the far end: the hump, the ring board, the backboard
    g.box('back', (-7, 0, -8), (7, 7, 8), {'east': Face(cab_side, 'cs'), 'west': Face(cab_side, 'cs'), 'south': Face(cab(2), 'bs')})
    g.box('back', (-6, 7, -8), (6, 7.5, -3), {'up': Face(lane, 'lane1')})
    g.bone('hump', pivot=(0, 7.5, -3), rotation=(-22.5, 0, 0))
    g.box('hump', (-6, 7, -3), (6, 8, 0), {'up': Face(lane, 'hump'), 'north': Face(lane, 'humpn')})
    g.bone('rings', pivot=(0, 8, 0), rotation=(-22.5, 0, 0))
    g.box('rings', (-6, 8, 0), (6, 16, 1), {'north': Face(target, 'target'), 'south': Face(cab(2), 'tb'), 'sides': Face(cab(3), 'te')})
    for x0 in (-7, 6):
        g.box('back', (x0, 7, -8), (x0 + 1, 16, 8), {'sides': Face(cab(4, P_RED), 'brail'), 'up': Face(cab(5, P_RED), 'brailu'), 'north': Face(cab(5, P_RED), 'brailn')})
    g.box('back', (-6, 11, 5), (6, 16, 7), {'north': Face(board, 'board', mi='board'), 'up': Face(cab(4), 'bu'), 'south': Face(cab(2), 'bbs')})
    out.geo(g, {'geometry.fnar.skeeball_lane': (['front'], (0, 0, 0)), 'geometry.fnar.skeeball_lane_back': (['back', 'hump', 'rings'], (0, 0, 0))})
    out.tex('skeeball_lane', g.paint('on'))
    perms = [(bs('fnar:part', 1), {'minecraft:geometry': 'geometry.fnar.skeeball_lane_back', 'minecraft:light_emission': 3})]
    blk = block_json('skeeball_lane', geometry='geometry.fnar.skeeball_lane', materials=mi_set('skeeball_lane', {'board': glow('skeeball_lane')}),
                     states={'fnar:part': {'values': {'min': 0, 'max': 1}}},
                     collision=box(-7, 0, -8, 7, 10, 8), selection=box(-7, 0, -8, 7, 16, 8), map_color='#22468c', destroy=2.0, perms=perms)
    out.block('skeeball_lane', blk)
    out.light('skeeball_lane', '#ff5a3a', 'static_light')
    two = lambda d='north': [{'states': {'fnar:part': 0, 'minecraft:cardinal_direction': d}, 'pos': [0, 0, 0]},
                             {'states': {'fnar:part': 1, 'minecraft:cardinal_direction': d}, 'pos': [0, 0, -1]}]
    out.views('skeeball_lane', [{'label': 'lane', 'parts': two(), 'focus': [0, 0.5, -0.5], 'dist': 3.0, 'dir': [0.6, 0.6, -1]},
                                {'label': 'from the player', 'parts': two(), 'focus': [0, 0.5, -0.5], 'dist': 2.6, 'dir': [0.1, 0.5, -1]}])


# =============================================================== kiddie rocket ride
@prop
def kiddie_ride(out):
    g = Geo('kiddie_ride', 64, 64)

    def base(r):
        r.fill(STEEL, 3, amp=0.4)
        if r.face != 'up':
            for c in range(r.w):  # hazard edge
                if (c // 2) % 2 == 0:
                    r.px(c, 0, YELLOW, 4)
                else:
                    r.px(c, 0, BLACK, 2)
        else:
            r.speck(GRIME, 3, 0.15)
        r.speck(RUST, 2, 0.06)

    def coin(r):
        r.fill(P_YEL, 4, amp=0.3)
        r.bevel(1, -1)
        if r.face == 'north':
            r.rect(1, 1, r.w - 2, 2, BLACK, 1)
            r.px(1, 1, RED_GLOW, 3, emit=200)  # INSERT COIN, still blinking
            r.px(r.w - 2, 3, CHROME, 4)

    def hull(r):
        r.fill(P_RED, 4, amp=0.3, white_amp=0.2, cell=4)
        for c in range(r.w):
            for rr in range(r.h):
                _, y, _ = r.world(c, rr)
                if 6.5 < y < 7.5:
                    r.px(c, rr, WHITE, 5)  # the white stripe
        r.bevel(1, -1, t=False, b=False)
        r.darken_noise(0.15, -1, bottom=0.5)
        r.speck(WHITE, 4, 0.02)  # chips in the paint

    def nose(r):
        r.fill(CHROME, 3, amp=0.4)
        r.bevel(1, -1)

    def fin(r):
        r.fill(P_BLUE, 4, amp=0.3)
        r.bevel(1, -1)
        if r.face in ('east', 'west', 'north', 'south'):
            r.px(r.w // 2, 1, BULB_Y, 2)

    def seat(r):
        r.fill(SHADOW, 1)
        if r.face == 'up':
            r.rect(1, 1, r.w - 2, r.h - 2, BLACK, 3)
            r.speck(GRIME, 3, 0.2)

    def screen(r):
        r.fill(GLASS_OFF, 3, amp=0.3)
        r.px(0, 0, GLASS_OFF, 6)

    g.box('ride', (-6, 0, -6), (6, 2, 6), {'sides': Face(base, 'bs'), 'up': Face(base, 'bu'), 'down': Face(base, 'bd')})
    g.box('ride', (-2, 2, 4), (2, 6, 6), {'north': Face(coin, 'coinn'), 'sides': Face(coin, 'coins'), 'up': Face(coin, 'coinu')})
    g.box('ride', (-1, 2, -1), (1, 4, 1), {'sides': Face(panel(CHROME, 2, bevel=None), 'pole')})
    g.box('ride', (-3.5, 4, -5), (3.5, 10, 4), {'north': Face(hull, 'hn'), 'south': Face(hull, 'hs'), 'east': Face(hull, 'he'), 'west': Face(hull, 'he'),
                                                'down': Face(hull, 'hd'), 'up': Face(hull, 'hu')})
    g.box('ride', (-2.5, 5, -7), (2.5, 9, -5), {'sides': Face(nose, 'n1'), 'ends': Face(nose, 'n1e'), 'north': Face(nose, 'n1n')})
    g.box('ride', (-1.5, 6, -8), (1.5, 8, -7), {'sides': Face(nose, 'n2'), 'ends': Face(nose, 'n2e')})
    g.box('ride', (-2.5, 10, -1), (2.5, 10.25, 3), {'up': Face(seat, 'seat')})
    g.box('ride', (-2, 10, -3), (2, 12, -2.5), {'north': Face(screen, 'scr'), 'sides': Face(screen, 'scrs'), 'ends': Face(screen, 'scre')})
    for (x0, x1, y0, y1) in ((-6, -3.5, 4, 9), (3.5, 6, 4, 9), (-0.75, 0.75, 10, 14)):
        g.box('ride', (x0, y0, 2), (x1, y1, 5), {'sides': Face(fin, f'fin{y1}'), 'ends': Face(fin, f'fine{y1}')})
    g.box('ride', (-2, 5, 4), (2, 9, 5.5), {'south': Face(lambda r: (r.fill(BLACK, 1), r.disc(r.w / 2, r.h / 2, 1.6, RED_GLOW, 2, emit=150)), 'exh'),
                                           'sides': Face(nose, 'exs')})
    out.geo(g)
    out.tex('kiddie_ride', g.paint())
    blk = block_json('kiddie_ride', geometry='geometry.fnar.kiddie_ride', materials=mi_set('kiddie_ride'),
                     collision=box(-6, 0, -6, 6, 10, 6), selection=box(-6, 0, -8, 6, 14, 6), map_color='#b5352b', destroy=2.0, light=3)
    out.block('kiddie_ride', blk)
    out.light('kiddie_ride', '#ffd860', 'static_light')
    f = {'focus': [0, 0.45, 0], 'dist': 1.9, 'dir': [0.8, 0.5, -1]}
    out.views('kiddie_ride', [{'label': 'north', **f}, {'label': 'facing east', 'states': {'minecraft:cardinal_direction': 'east'}, **f}])


# =============================================================== prize case (glass counter)
@prop
def prize_case(out):
    g = Geo('prize_case', 64, 64)
    wood = lambda base=3: panel(MAPLE, base, amp=0.3, white_amp=0.3, streak='h', grime=0.3)

    def front(r):
        wood(4)(r)
        r.hline(0, r.h - 2, r.w, BLACK, 2)  # kick plate
        r.hline(0, r.h - 1, r.w, BLACK, 1)
        r.hline(0, 0, r.w, CHROME, 4)
        r.speck(GRIME, 2, 0.06)

    def glass(r):
        # clear glass: only the edges and a couple of glints show (vanilla glass style), dust in one corner
        r.clear()
        r.frame_rect(0, 0, r.w, r.h, GLASS_CASE, 2)
        for c in range(r.w):
            for rr in range(r.h):
                if (c + rr) in (4, 5, 11) and 0 < c < r.w - 1 and 0 < rr < r.h - 1:
                    r.px(c, rr, GLASS_CASE, 3)
        r.px(r.w - 2, r.h - 2, GLASS_CASE, 1); r.px(r.w - 3, r.h - 2, GLASS_CASE, 1)

    def felt(r):
        r.fill(CLOTH_RED, 2, amp=0.4)
        r.speck(GRIME, 3, 0.1)

    def tag(r):
        r.fill(PAPER, 5)
        r.px(0, 0, RED, 3)

    def toy(m, i=4):
        return lambda r: (r.fill(m, i, amp=0.3), r.bevel(1, -1))

    g.box('case', (-8, 0, -6), (8, 10, 6), {'north': front, 'south': Face(wood(2), 'back'), 'east': Face(wood(3), 'side'), 'west': Face(wood(3), 'side')})
    g.box('case', (-8, 10, -6), (8, 10.5, 6), {'up': felt})
    g.box('case', (-8, 15.5, -6), (8, 16, 6), {'up': Face(glass, 'gtop', mi='glass'), 'down': Face(glass, 'gtopd', mi='glass'), 'sides': Face(panel(CHROME, 3, bevel=None), 'gtrim')})
    g.box('case', (-8, 10.5, -6), (8, 15.5, -6), {'north': Face(glass, 'gfront', mi='glass')})
    for x in (-8, 8):
        g.box('case', (x, 10.5, -6), (x, 15.5, 6), {'east' if x > 0 else 'west': Face(glass, 'gside', mi='glass')})
    # the prizes: a bouncy ball, a stuffed bear, a slinky, a toy car, a ring pop, a little rocket
    items = [((-6.5, -4), (2, 2, 2), P_PINK), ((-3.5, -1.5), (3, 4, 2), GREYPLAST), ((0.5, -4.5), (3, 2, 3), CHROME),
             ((4, -1), (3, 1.5, 2), P_BLUE), ((-6, 1.5), (1.5, 2, 1.5), P_YEL), ((1.5, 2), (2, 3, 2), P_RED)]
    for k, ((x, z), (w, h, d), m) in enumerate(items):
        g.box('case', (x, 10.5, z), (x + w, 10.5 + h, z + d), {'sides': Face(toy(m), f'it{k}'), 'up': Face(toy(m, 5), f'itu{k}')})
        g.box('case', (x, 10.5, z - 0.75), (x + 1.5, 11.5, z - 0.75), {'north': Face(tag, f'tag{k}')})
    out.geo(g)
    out.tex('prize_case', g.paint())
    mats = mi_set('prize_case', {'glass': 'prize_case'})
    blk = block_json('prize_case', geometry='geometry.fnar.prize_case', materials=mats,
                     collision=box(-8, 0, -6, 8, 16, 6), selection=box(-8, 0, -6, 8, 16, 6), map_color='#9c7638', destroy=2.0)
    out.block('prize_case', blk)
    f = {'focus': [0, 0.6, 0], 'dist': 2.0, 'dir': [0.5, 0.6, -1]}
    out.views('prize_case', [{'label': 'north', **f}])


# =============================================================== the wall of plush prizes
PLUSH_KINDS = [('bear_grey', '#8a8478', '#d8d0bc', 'bear'), ('rabbit_green', '#5f8a34', '#d0c08a', 'rabbit'), ('bear_black', '#3a363e', '#8a8090', 'bear'),
               ('cat', '#9a4a5a', '#e8c4b4', 'cat'), ('rat', '#8e5a9a', '#e0c8e8', 'rat'), ('star', '#e0b030', '#fff0a0', 'star'),
               ('pink_bear', '#d06a8a', '#f8c8d8', 'bear'), ('blue_dog', '#3a6ad0', '#d0e0ff', 'bear')]


@prop
def plush_wall(out):
    g = Geo('plush_wall', 64, 64)
    mats = {k: Mat(f'pw_{k}', [mix_hex(c, '#000000', 0.35), c, mix_hex(c, c2, 0.5), c2], rough=245, h=140, hk=2) for k, c, c2, _ in PLUSH_KINDS}
    PEG = Mat('pegboard', ['#6c6658', '#8a8472', '#a8a28e', '#bfb9a4', '#cfc9b4'], rough=230, h=136, hk=2)

    def board(r):
        r.fill(PEG, 3, amp=0.3)
        for c in range(1, r.w, 2):
            for rr in range(1, r.h, 2):
                r.px(c, rr, PEG, 0)  # pegboard holes
        r.darken_noise(0.2, -1, bottom=0.5)

    def plush(kind, part):
        def p(r):
            m = mats[kind]
            r.fill(m, 1, amp=0.4, white_amp=0.4)
            if part == 'face' and r.face == 'north':
                r.hline(1, r.h - 1, r.w - 2, m, 3)  # a lighter muzzle
                r.px(0, 1, BLACK, 1); r.px(r.w - 1, 1, BLACK, 1)  # button eyes, set wide
            r.bevel(1, -1)
        return p

    rng = __import__('random').Random(9300)
    for row, y in enumerate((10.5, 6, 1.5)):
        x = -7.6
        k = row * 3
        while x + 4 <= 7.6:
            kind, _, _, shape = PLUSH_KINDS[(k + row) % len(PLUSH_KINDS)]
            w, h = 4, 3.5
            tilt = rng.choice((0, 0, 22.5, -22.5)) if -6 < x < 2 else 0
            bone = f'p{row}_{k}'
            g.bone(bone, pivot=(x + w / 2, y + h + 0.5, 6.5), rotation=(0, 0, tilt) if tilt else None)
            g.box(bone, (x, y, 4.5), (x + w, y + h, 7), {'north': Face(plush(kind, 'face'), f'f{kind}'), 'sides': Face(plush(kind, 'b'), f's{kind}'),
                                                        'ends': Face(plush(kind, 'b'), f'e{kind}')})
            if shape in ('bear', 'cat', 'rat'):
                for ex in (x - 0.25, x + w - 0.75):
                    g.box(bone, (ex, y + h - 0.5, 5), (ex + 1, y + h + 0.5, 6.5), {'sides': Face(plush(kind, 'b'), f'ear{kind}'), 'ends': Face(plush(kind, 'b'), f'eare{kind}')})
            if shape == 'rabbit':
                for ex in (x + 0.5, x + w - 1.5):
                    g.box(bone, (ex, y + h, 5.5), (ex + 1, y + h + 1.5, 6.5), {'sides': Face(plush(kind, 'b'), f'rab{kind}')})
            g.box(bone, (x + w / 2 - 0.25, y + h, 6.5), (x + w / 2 + 0.25, y + h + 0.5, 7.5), {'sides': Face(panel(CHROME, 3, bevel=None), 'peg')})
            x += w + 0.4
            k += 1
    g.box('board', (-8, 0, 7), (8, 16, 8), {'north': board, 'sides': Face(panel(PEG, 2, bevel=None), 'be')})
    out.geo(g)
    out.tex('plush_wall', g.paint())
    blk = block_json('plush_wall', geometry='geometry.fnar.plush_wall', materials=mi_set('plush_wall'),
                     collision=box(-8, 0, 4.5, 8, 16, 8), selection=box(-8, 0, 4, 8, 16, 8), map_color='#bfb9a4', destroy=1.0)
    out.block('plush_wall', blk)
    out.views('plush_wall', [{'label': 'north', 'env': 'wall', 'focus': [0, 0.5, 0.3], 'dist': 1.9, 'dir': [0.3, 0.1, -1]}])


def mix_hex(a, b, t):
    ca, cb = [int(a[i:i + 2], 16) for i in (1, 3, 5)], [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#%02x%02x%02x' % tuple(int(round(x * (1 - t) + y * t)) for x, y in zip(ca, cb))


# =============================================================== stage truss
@prop
def stage_truss(out):
    g = Geo('stage_truss', 64, 64)
    alu = lambda base=3: panel(CHROME, base, amp=0.3, white_amp=0.3, streak='v', bevel=None)

    # a box truss running along z (north-south), hanging under the ceiling (y 9..15)
    for (x0, y0) in ((-4.5, 9), (3.5, 9), (-4.5, 14), (3.5, 14)):
        g.box('truss', (x0, y0, -8), (x0 + 1, y0 + 1, 8), {'sides': Face(alu(3), 'chord'), 'ends': Face(alu(4), 'chorde')})
    for z in (-6, 0, 6):  # rungs
        for (y0,) in ((9,), (14,)):
            g.box('truss', (-3.5, y0, z - 0.5), (3.5, y0 + 1, z + 0.5), {'sides': Face(alu(4), 'rung'), 'ends': Face(alu(4), 'runge')})
        for x0 in (-4.5, 3.5):
            g.box('truss', (x0, 10, z - 0.5), (x0 + 1, 14, z + 0.5), {'sides': Face(alu(4), 'post'), 'ends': Face(alu(4), 'poste')})
    # zig-zag diagonals on both sides
    for k, z in enumerate((-3, 3)):
        for x0 in (-4.25, 3.75):
            bone = f'diag{k}{x0}'
            g.bone(bone, pivot=(x0 + 0.25, 12, z), rotation=(45 if k == 0 else -45, 0, 0))
            g.box(bone, (x0, 9.5, z - 0.25), (x0 + 0.5, 14.5, z + 0.25), {'sides': Face(alu(3), 'dg'), 'ends': Face(alu(3), 'dge')})
    # a clamp and safety cable up to the ceiling
    g.box('truss', (-0.5, 15, -0.5), (0.5, 16, 0.5), {'sides': Face(panel(IRON, 2, bevel=None), 'clamp')})
    out.geo(g)
    out.tex('stage_truss', g.paint())
    blk = block_json('stage_truss', geometry='geometry.fnar.stage_truss', materials=mi_set('stage_truss'),
                     collision=False, selection=box(-5, 9, -8, 5, 16, 8), map_color='#b6bcc2', destroy=1.5)
    out.block('stage_truss', blk)
    out.views('stage_truss', [{'label': 'run of three', 'parts': [{'states': {'minecraft:cardinal_direction': 'north'}, 'pos': [0, 0, z]} for z in (-1, 0, 1)],
                               'focus': [0, 0.7, 0], 'dist': 3.0, 'dir': [1, -0.3, -0.6]}])
