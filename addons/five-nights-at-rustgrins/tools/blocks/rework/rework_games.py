"""The Game Room's machines: four more arcade games in the cabinet's shape, a pinball table, air hockey, a change
machine, a claw machine, and neon tubes for the walls. Models face north; a machine's player stands to its north."""
import math

from propkit import Geo, Face, prop, panel, block_json, box, mi_set, glow, bs
from rework_pal import *  # noqa: F403

HALF = {'fnar:half': {'values': {'min': 0, 'max': 1}}}
F4 = {**FONT_3x4, 'H': ['#.#', '###', '#.#', '#.#'], 'G': ['.##', '#..', '#.#', '.##'], 'W': ['#.#', '#.#', '###', '#.#'],
      'K': ['#.#', '##.', '#.#', '#.#'], 'B': ['##.', '###', '#.#', '##.'], 'F': ['###', '#..', '##.', '#..']}  # noqa: F405

# name on the marquee (two lines), cabinet colour, stripe, marquee glow, the light it throws
GAMES = [
    ('STAR', 'DUEL', BLUE_P, N_TEAL, N_BLUE),
    ('PIE', 'TOSS', RED_P, N_YEL, N_RED),
    ('DINO', 'RUN', GREEN_P, N_YEL, N_GRN),
    ('MOON', 'MICE', PURP_P, N_PINK, N_PURP),
]


def _screen(r, game):
    """12 x 7 attract screens, one per game."""
    r.fill(SCREEN, 1, amp=0.3, white_amp=0.2)
    if game == 0:      # a starfield, two ships, a shot between them
        for (x, y) in ((1, 1), (4, 0), (7, 2), (10, 1), (2, 4), (9, 5), (6, 6), (11, 4)):
            r.px(x, y, N_WHITE, 1 + (x + y) % 3)
        r.px(2, 3, N_TEAL, 2); r.px(1, 3, N_TEAL, 1); r.px(9, 3, N_RED, 2); r.px(10, 3, N_RED, 1)
        r.px(5, 3, N_YEL, 3); r.px(6, 3, N_YEL, 2)
    elif game == 1:    # pies falling on a chef's tray
        r.hline(0, 6, 12, N_RED, 1)
        for (x, y) in ((2, 1), (6, 3), (9, 0)):
            r.px(x, y, N_YEL, 2); r.px(x + 1, y, N_YEL, 3); r.px(x, y + 1, N_RED, 2); r.px(x + 1, y + 1, N_RED, 2)
        r.hline(4, 5, 4, N_WHITE, 2)
    elif game == 2:    # a dinosaur running at a cactus
        r.hline(0, 6, 12, N_YEL, 1)
        for (x, y) in ((2, 5), (3, 5), (3, 4), (3, 3), (4, 3), (2, 4), (1, 4)):
            r.px(x, y, N_GRN, 2)
        r.px(4, 2, N_GRN, 3)
        for y in (3, 4, 5):
            r.px(9, y, N_GRN, 1)
        r.px(8, 4, N_GRN, 1); r.px(10, 3, N_GRN, 1); r.px(6, 1, N_WHITE, 2); r.px(7, 1, N_WHITE, 1)
    else:              # mice on the moon
        for x in range(12):
            r.px(x, 6, N_PURP, 1); r.px(x, 5, N_PURP, 0 if (x % 5) else 2)
        r.disc(9.5, 1.5, 1.4, N_YEL, 3)
        for x in (2, 5):
            r.px(x, 4, N_PINK, 2); r.px(x + 1, 4, N_PINK, 3); r.px(x, 3, N_PINK, 1)
        r.px(1, 1, N_WHITE, 1); r.px(5, 0, N_WHITE, 2)


@prop
def arcade_machine(out):
    """Four more games in the arcade cabinet's shape (fnar:game 0 STAR DUEL, 1 PIE TOSS, 2 DINO RUN, 3 MOON MICE;
    fnar:half 0 / 1): each its own colours, marquee and attract screen. Light 6 on the upper half."""
    g = Geo('arcade_machine', 64, 64)
    paint = lambda base=2, grime=0.3: panel(BLACK, base, amp=0.5, white_amp=0.35, grime=grime)

    def side_art(r):
        _, _, body, stripe, _ = GAMES[r.variant]
        r.fill(body, 2, amp=0.4, white_amp=0.3)
        for c in range(r.w):
            for rr in range(r.h):
                _, y, z = r.world(c, rr)
                t = y + 0.9 * (z + 8)
                if 13 < t < 17:
                    r.px(c, rr, body, 5)
                elif 17 <= t < 19:
                    r.px(c, rr, stripe, 1, emit=0)
                elif 27 < t < 28.5:
                    r.px(c, rr, stripe, 0, emit=0)
        edge = r.w - 1 if r.face == 'east' else 0
        for rr in range(r.h):
            r.px(edge, rr, CHROME, 3)
        r.darken_noise(0.25, -1, bottom=0.4)
        r.speck(GREYPLAST, 1, 0.04)

    def coin_door(r):
        _, _, body, stripe, _ = GAMES[r.variant]
        r.fill(body, 1, amp=0.4, white_amp=0.3)
        r.rect(4, 2, 6, 6, STEEL, 3); r.frame_rect(4, 2, 6, 6, STEEL, 1)
        for cx in (5, 8):
            r.px(cx, 4, stripe, 2); r.px(cx, 5, BLACK, 0)
        r.hline(6, 6, 2, BLACK, 1); r.px(9, 7, CHROME, 4)
        r.speck(RUST, 2, 0.05, only=STEEL)
        r.darken_noise(0.3, -1, bottom=0.6)

    def deck_top(r):
        _, _, _, stripe, _ = GAMES[r.variant]
        r.fill(BLACK, 3, amp=0.3)
        r.hline(0, 0, r.w, stripe, 1, emit=0)
        r.px(9, 1, RED, 5); r.px(11, 1, YELLOW, 5); r.px(10, 2, WHITE, 3)

    def marquee(r):
        a, b, body, stripe, glow_m = GAMES[r.variant]
        r.fill(body, 1, amp=0.4, white_amp=0.3)
        r.frame_rect(0, 0, r.w, r.h, glow_m, 1)
        r.text(a, (r.w - r.text_width(a, F4)) // 2, 0, glow_m, 3, font=F4)
        r.text(b, (r.w - r.text_width(b, F4) + 1) // 2, 5, stripe, 3, font=F4)

    def screen(r):
        _screen(r, r.variant)

    g.box('lower', (-7, 0, -5), (7, 1, 7), {'sides': Face(panel(BLACK, 1, bevel=None), 'plinth')})
    g.box('lower', (-7, 1, -4), (7, 11, 7), {'north': coin_door, 'east': Face(side_art), 'west': Face(side_art), 'south': paint(1, 0.4), 'up': Face(paint(2), 'lu')})
    g.box('lower', (-7, 11, -7), (7, 13, -2), {'up': deck_top, 'north': Face(paint(2, 0.1), 'df'), 'east': Face(side_art), 'west': Face(side_art), 'down': paint(1)})
    g.box('lower', (-7, 11, -2), (7, 16, 7), {'north': paint(1, 0.2), 'east': Face(side_art), 'west': Face(side_art), 'south': paint(1, 0.4)})
    g.box('lower', (-4, 13, -5.5), (-3, 14.5, -4.5), {'sides': Face(panel(BLACK, 3, bevel=None), 'stick')})
    g.box('lower', (-4.25, 14.5, -5.75), (-2.75, 16, -4.25), {'sides': Face(panel(RED, 4, bevel=None), 'ball'), 'up': Face(panel(RED, 5, bevel=None), 'ballt')})
    for x0, x1 in ((-7, -6), (6, 7)):
        inner, outer = ('east', 'west') if x0 < 0 else ('west', 'east')
        g.box('upper', (x0, 16, -3), (x1, 23, 7), {outer: Face(side_art), inner: Face(paint(1), 'pin'), 'north': Face(paint(3), 'pfront')})
    g.box('upper', (-6, 16, -1), (6, 23, 7), {'north': Face(screen, mi='screen'), 'south': paint(1, 0.4)})
    g.box('upper', (-8, 23, -4), (8, 32, 7), {'north': Face(marquee, mi='screen'), 'east': Face(side_art), 'west': Face(side_art),
                                              'up': Face(paint(2), 'mu'), 'down': Face(paint(1), 'md'), 'south': paint(1, 0.4)})
    out.geo(g, {'geometry.fnar.arcade_machine': (['lower'], (0, 0, 0)), 'geometry.fnar.arcade_machine_upper': (['upper'], (0, -16, 0))})
    for k in range(4):
        out.tex(f'arcade_machine_{k}', g.paint(k))
    perms = [(bs('fnar:game', k), {'minecraft:material_instances': mi_set(f'arcade_machine_{k}', {'screen': glow(f'arcade_machine_{k}')})}) for k in range(4)]
    perms.append((bs('fnar:half', 1), {'minecraft:geometry': 'geometry.fnar.arcade_machine_upper', 'minecraft:light_emission': 6,
                                       'minecraft:collision_box': box(-8, 0, -4, 8, 16, 7), 'minecraft:selection_box': box(-8, 0, -4, 8, 16, 7)}))
    out.block('arcade_machine', block_json('arcade_machine', geometry='geometry.fnar.arcade_machine', materials=mi_set('arcade_machine_0', {'screen': glow('arcade_machine_0')}),
                                           states={'fnar:game': [0, 1, 2, 3], **HALF}, collision=box(-7, 0, -7, 7, 16, 7), selection=box(-7, 0, -7, 7, 16, 7),
                                           map_color='#1d3468', destroy=2.5, perms=perms))
    out.light('arcade_machine', '#8ad8ff', 'point_light')


# =============================================================== pinball
@prop
def pinball_table(out):
    """A pinball table, two cells long (fnar:part 0 the player's end, 1 the far end with the lit backbox; the
    player stands to the north of part 0, like skee-ball): chrome legs, a bright playfield under glass."""
    g = Geo('pinball_table', 64, 64)

    def field(r):
        far = r.cube.bone == 'back'
        r.fill(PURP_P, 2, amp=0.5, white_amp=0.3, cell=4)
        for x in (0, r.w - 1):
            r.vline(x, 0, r.h, OAK, 2)
        if far:
            for (cx, cy, m) in ((4, 5, N_RED), (9, 4, N_YEL), (6, 10, N_TEAL)):
                r.disc(cx, cy, 1.6, m, 1, emit=90); r.px(cx - 1, cy - 1, N_WHITE, 2, emit=120)
            r.hline(2, 1, r.w - 4, N_PINK, 1, emit=80)
            for y in range(12, 16):
                r.px(2, y, N_YEL, 0, emit=60); r.px(r.w - 3, y, N_YEL, 0, emit=60)
        else:
            for k in range(5):
                r.px(2 + k, 2 + k, N_TEAL, 1, emit=70); r.px(r.w - 3 - k, 2 + k, N_TEAL, 1, emit=70)
            r.hline(3, 9, 3, CREAM, 6); r.hline(r.w - 6, 9, 3, CREAM, 6)        # the flippers
            r.px(r.w // 2, 6, CHROME, 5)                                          # the ball
            r.hline(1, 13, r.w - 2, BLACK, 1); r.hline(1, 14, r.w - 2, CHROME, 4)  # the lockdown bar
        for k in range(0, r.h, 5):
            r.px(1 + (k * 3) % (r.w - 2), k, GLASSF, 6)                           # glints on the glass
        r.rot180()

    def backglass(r):
        r.fill(PURP_P, 1, amp=0.5)
        r.frame_rect(0, 0, r.w, r.h, CHROME, 3)
        r.text('RAT', 2, 1, N_YEL, 3, font=F4); r.text('PACK', 0, 6, N_PINK, 3, font=F4, spacing=0) if r.h >= 10 else None
        for x in range(2, r.w - 2, 3):
            r.px(x, r.h - 2, N_RED, 2)

    cab = lambda b=3: Face(flat(BLUE_P, b, 0.3), f'cab{b}')
    leg = Face(chrome(3), 'leg')
    g.box('front', (-6, 7, -8), (6, 11, 8), {'north': Face(lambda r: (flat(BLUE_P, 3, 0.3)(r), r.px(2, 2, N_RED, 2), r.px(r.w - 3, 2, CHROME, 4), r.rect(4, 1, 4, 2, BLACK, 1)), 'cf'), 'east': cab(3), 'west': cab(3), 'down': cab(1)})
    g.box('front', (-6, 11, -8), (6, 11.5, 8), {'up': field})
    for x in (-6.5, 5.5):
        g.box('front', (x, 0, -7.5), (x + 1, 7, -6.5), {'sides': leg})
    g.box('back', (-6, 8, -8), (6, 12, 8), {'south': cab(2), 'east': cab(3), 'west': cab(3), 'down': cab(1)})
    g.box('back', (-6, 12, -8), (6, 12.5, 4), {'up': field})
    for x in (-6.5, 5.5):
        g.box('back', (x, 0, 6.5), (x + 1, 8, 7.5), {'sides': leg})
    g.box('back', (-7, 12, 4), (7, 24, 8), {'north': Face(backglass, mi='lit'), 'south': Face(flat(BLUE_P, 2, 0.4), 'bb'), 'east': Face(flat(BLUE_P, 3, 0.3), 'bs'), 'west': Face(flat(BLUE_P, 3, 0.3), 'bs'),
                                            'up': Face(flat(BLUE_P, 2, 0.5), 'bu')})
    out.geo(g, {'geometry.fnar.pinball_table': (['front'], (0, 0, 0)), 'geometry.fnar.pinball_table_back': (['back'], (0, 0, 0))})
    out.tex('pinball_table', g.paint())
    out.block('pinball_table', block_json('pinball_table', geometry='geometry.fnar.pinball_table', materials=mi_set('pinball_table', {'lit': glow('pinball_table')}),
                                          states={'fnar:part': {'values': {'min': 0, 'max': 1}}}, collision=box(-6, 0, -8, 6, 12, 8), selection=box(-7, 0, -8, 7, 16, 8),
                                          map_color='#3f2261', destroy=2.0,
                                          perms=[(bs('fnar:part', 1), {'minecraft:geometry': 'geometry.fnar.pinball_table_back', 'minecraft:light_emission': 5})]))
    out.light('pinball_table', '#ff8ad0', 'static_light')


# =============================================================== air hockey
@prop
def air_hockey(out):
    """One end of an air hockey table (two of them back to back make the table; the goal is at the front): a white
    field with its blue lines and red crease, blue rails, a puck, a mallet."""
    g = Geo('air_hockey', 64, 64)

    def field(r):
        r.fill(ENAMEL, 5, amp=0.3, white_amp=0.2)
        for y in range(r.h):
            for x in range(r.w):
                d = math.hypot(x + 0.5 - r.w / 2, y + 0.5)        # top of the texture = the goal end (north)
                if 4.2 < d < 5.2:
                    r.px(x, y, RED_P, 4)
                if abs(math.hypot(x + 0.5 - r.w / 2, y + 0.5 - r.h) - 4) < 0.55:
                    r.px(x, y, BLUE_P, 4)
        r.hline(0, r.h - 1, r.w, BLUE_P, 4)
        r.speck(GRIME, 3, 0.03)
        for (x, y) in ((3, 7), (4, 8), (9, 11), (10, 11)):         # scuffs
            r.px(x, y, ENAMEL, 2)

    rail = Face(flat(BLUE_P, 3, 0.2), 'rail')
    railu = Face(flat(BLUE_P, 4, 0.1, None), 'railu')
    g.box('table', (-8, 5, -8), (8, 10, 8), {'north': Face(lambda r: (flat(BLUE_P, 2, 0.4)(r), r.rect(5, 1, 6, 2, BLACK, 0)), 'end'), 'east': Face(flat(BLUE_P, 2, 0.4), 'side'), 'west': Face(flat(BLUE_P, 2, 0.4), 'side'), 'down': Face(panel(BLACK, 1, bevel=None), 'under')})
    g.box('table', (-7, 10, -7), (7, 10.2, 8), {'up': field})
    for (a, b) in (((-8, 10, -8), (-7, 12, 8)), ((7, 10, -8), (8, 12, 8))):
        g.box('table', a, b, {'east': rail, 'west': rail, 'up': railu, 'north': Face(flat(BLUE_P, 3, 0, None), 'railn')})
    for (a, b) in (((-7, 10, -8), (-3, 12, -7)), ((3, 10, -8), (7, 12, -7))):
        g.box('table', a, b, {'north': Face(flat(BLUE_P, 3, 0.2), 'endr'), 'south': Face(flat(BLUE_P, 3, 0.2), 'endr'), 'up': Face(flat(BLUE_P, 4, 0, None), 'endu')})
    for x in (-7, 5):
        g.box('table', (x, 0, -7), (x + 2, 5, -5), {'sides': Face(panel(BLACK, 2, bevel=None), 'leg')})
    g.box('table', (2, 10.2, -1), (5, 11.5, 2), {'sides': Face(flat(RED_P, 3, 0, None), 'mallet'), 'up': Face(flat(RED_P, 4, 0, (1, -1)), 'malletu')})
    g.box('table', (3, 11.5, 0), (4, 13, 1), {'sides': Face(flat(RED_P, 4, 0, None), 'knob'), 'up': Face(flat(RED_P, 5, 0, None), 'knobu')})
    g.box('table', (-4, 10.2, 3), (-2, 10.7, 5), {'sides': Face(flat(YEL_P, 3, 0, None), 'puck'), 'up': Face(flat(YEL_P, 5, 0, None), 'pucku')})
    out.geo(g)
    out.tex('air_hockey', g.paint())
    out.block('air_hockey', block_json('air_hockey', geometry='geometry.fnar.air_hockey', materials=mi_set('air_hockey'),
                                       collision=box(-8, 0, -8, 8, 12, 8), selection=box(-8, 0, -8, 8, 12, 8), map_color='#1d3468', destroy=2.0))


# =============================================================== the change machine
@prop
def change_machine(out):
    """A change machine, two blocks tall (fnar:half): a grey steel cabinet, a bill slot under a green lamp, the coin
    cup, CHANGE lit across the top (light 4 on the upper half)."""
    g = Geo('change_machine', 64, 64)

    def front(r):
        up = r.cube.bone == 'upper'
        steel(3, 0.3)(r)
        if up:
            r.rect(1, 1, r.w - 2, 11, YEL_P, 4, emit=170)
            r.text('CHA', 2, 2, BLACK, 1, font=F4, emit=0); r.text('NGE', 2, 7, BLACK, 1, font=F4, emit=0)
            r.rect(3, 13, 6, 2, BLACK, 1); r.px(10, 13, N_GRN, 2); r.hline(4, 14, 4, GREEN_P, 4)
        else:
            r.rect(2, 2, r.w - 4, 5, PAPER, 4); r.hline(3, 3, r.w - 6, GRIME, 1); r.hline(3, 5, r.w - 7, GRIME, 1)
            r.rect(4, 9, 6, 4, BLACK, 0); r.hline(4, 13, 6, CHROME, 4)
            r.px(11, 8, CHROME, 4)
            r.px(5, 12, GOLD, 5, metal=160); r.px(7, 12, GOLD, 4, metal=160)
            r.darken_noise(0.3, -1, bottom=0.9)

    side = Face(steel(2, 0.35, 'v'), 'side')
    for bone, y0 in (('lower', 0), ('upper', 16)):
        g.box(bone, (-7, y0, -5), (7, y0 + 16, 8), {'north': Face(front, mi='lit') if bone == 'upper' else front, 'east': side, 'west': side, 'south': Face(steel(1, 0.4), 'back'), 'up': Face(steel(3, 0.5), 'top')})
    out.geo(g, {'geometry.fnar.change_machine': (['lower'], (0, 0, 0)), 'geometry.fnar.change_machine_upper': (['upper'], (0, -16, 0))})
    out.tex('change_machine', g.paint())
    out.block('change_machine', block_json('change_machine', geometry='geometry.fnar.change_machine', materials=mi_set('change_machine', {'lit': glow('change_machine')}),
                                           states=HALF, collision=box(-7, 0, -5, 7, 16, 8), selection=box(-7, 0, -5, 7, 16, 8), map_color='#60666d', destroy=2.5,
                                           perms=[(bs('fnar:half', 1), {'minecraft:geometry': 'geometry.fnar.change_machine_upper', 'minecraft:light_emission': 4})]))
    out.light('change_machine', '#ffd84a', 'static_light')


# =============================================================== the claw machine
@prop
def claw_machine(out):
    """A claw machine, two blocks tall (fnar:half): a red cabinet with the joystick and the prize door; above it a
    glass box heaped with plush, the claw hanging over them, CLAW lit on the header (light 5)."""
    g = Geo('claw_machine', 64, 64)

    def front(r):
        flat(RED_P, 3, 0.35)(r)
        r.rect(3, 8, 7, 6, BLACK, 0); r.frame_rect(3, 8, 7, 6, CHROME, 3)
        r.px(5, 12, PURP_P, 4); r.px(6, 12, PURP_P, 3); r.px(6, 11, PURP_P, 5)      # one prize nobody collected
        r.rect(11, 9, 3, 4, STEEL, 3); r.px(12, 10, N_YEL, 2); r.px(12, 12, BLACK, 0)
        for x in range(1, r.w - 1, 2):
            r.px(x, 1, YEL_P, 5)

    def header(r):
        r.fill(YEL_P, 4, amp=0.3)
        r.frame_rect(0, 0, r.w, r.h, RED_P, 4)
        r.text('CLAW', (r.w - 15) // 2, 0 if r.h < 6 else 1, RED_P, 2, font=F4)

    def plush(r):
        cols = (PURP_P, PINK, YEL_P, TEAL_P, RED_P, CREAM)
        for y in range(r.h):
            for x in range(r.w):
                r.px(x, y, cols[((x // 2) * 3 + (y // 2) * 5 + (x // 5)) % 6], 3 + (x + y) % 2)
        r.speck(BLACK, 1, 0.06)

    side = Face(flat(RED_P, 3, 0.35), 'side')
    g.box('lower', (-8, 0, -6), (8, 16, 8), {'north': front, 'east': side, 'west': side, 'south': Face(flat(RED_P, 2, 0.4), 'back')})
    g.box('lower', (-6, 12, -8), (6, 14, -6), {'up': Face(lambda r: (r.fill(BLACK, 2), r.px(3, 0, RED_P, 5), r.px(8, 0, YEL_P, 5)), 'panel'), 'sides': Face(panel(BLACK, 2, bevel=None), 'pe'), 'down': Face(panel(BLACK, 1, bevel=None), 'pd')})
    g.box('lower', (-3.5, 14, -7.5), (-2.5, 16, -6.5), {'sides': Face(chrome(3), 'stick'), 'up': Face(flat(RED_P, 5, 0, None), 'sticku')})
    for (x, z) in ((-8, -6), (7, -6), (-8, 7), (7, 7)):
        g.box('upper', (x, 16, z), (x + 1, 27, z + 1), {'sides': Face(flat(RED_P, 3, 0.2), 'post')})
    g.box('upper', (-7, 16, -6), (7, 27, -5.9), {'north': Face(glass, 'gf')})
    for x in (-8, 7.9):
        g.box('upper', (x, 16, -5), (x + 0.1, 27, 7), {'east': Face(glass, 'gs'), 'west': Face(glass, 'gs')})
    g.box('upper', (-7, 16, 7.5), (7, 27, 8), {'north': Face(flat(TEAL_P, 2, 0.2), 'bk')})
    g.box('upper', (-7, 16, -5), (7, 21, 7), {'up': Face(plush, 'pu'), 'north': Face(plush, 'pn'), 'east': Face(plush, 'pe2'), 'west': Face(plush, 'pe2')})
    g.box('upper', (-0.25, 23.5, 0), (0.25, 27, 0.5), {'sides': Face(chrome(3), 'rope')})
    g.box('upper', (-1.5, 22, -1), (1.5, 23.5, 1.5), {'*': Face(chrome(4), 'claw')})
    for x in (-2, 1.5):
        g.box('upper', (x, 21, 0), (x + 0.5, 22.5, 0.5), {'sides': Face(chrome(2), 'finger')})
    g.box('upper', (-8, 27, -6), (8, 32, 8), {'north': Face(header, mi='lit'), 'east': Face(flat(RED_P, 4, 0.2), 'hs'), 'west': Face(flat(RED_P, 4, 0.2), 'hs'), 'south': Face(flat(RED_P, 2, 0.3), 'hb'),
                                              'up': Face(flat(RED_P, 2, 0.5), 'hu'), 'down': Face(lambda r: r.fill(BULB, 2, amp=0.4), 'lamp', mi='lit')})
    out.geo(g, {'geometry.fnar.claw_machine': (['lower'], (0, 0, 0)), 'geometry.fnar.claw_machine_upper': (['upper'], (0, -16, 0))})
    out.tex('claw_machine', g.paint())
    out.block('claw_machine', block_json('claw_machine', geometry='geometry.fnar.claw_machine', materials=mi_set('claw_machine', {'lit': glow('claw_machine')}),
                                         states=HALF, collision=box(-8, 0, -6, 8, 16, 8), selection=box(-8, 0, -8, 8, 16, 8), map_color='#8f1f1c', destroy=2.5,
                                         perms=[(bs('fnar:half', 1), {'minecraft:geometry': 'geometry.fnar.claw_machine_upper', 'minecraft:light_emission': 5})]))
    out.light('claw_machine', '#ffe2a0', 'static_light')


# =============================================================== neon tubes
def _neon(out, colour, mat, light_hex):
    """fnar:kind 0 a tube across the cell at mid height, 1 a tube up the cell, 2 a zigzag, 3 a tube along the top."""
    name = f'neon_{colour}'
    g = Geo(name, 64, 64)

    def tube(r):
        r.fill(mat, 2, amp=0.3, white_amp=0.2)
        if r.w > r.h:
            r.hline(0, 0, r.w, mat, 3)
        else:
            r.vline(0, 0, r.h, mat, 3)

    def zig(r):
        r.clear()
        for x in range(r.w):
            y = 3 + abs((x % 8) - 4) * 2
            for dy in (0, 1):
                r.px(x, y + dy, mat, 3 - dy)
            r.px(x, y - 1, mat, 1) if x % 4 == 0 else None

    clip = Face(panel(BLACK, 3, bevel=None), 'clip')
    g.box('k0', (-8, 7, 6.5), (8, 9, 7.5), {'north': Face(tube, 'h', mi='lit'), 'up': Face(tube, 'hu', mi='lit'), 'down': Face(tube, 'hu', mi='lit')})
    for x in (-5, 4):
        g.box('k0', (x, 6.5, 7.5), (x + 1, 9.5, 8), {'sides': clip})
    g.box('k1', (-1, 0, 6.5), (1, 16, 7.5), {'north': Face(tube, 'v', mi='lit'), 'east': Face(tube, 've', mi='lit'), 'west': Face(tube, 've', mi='lit')})
    for y in (3, 12):
        g.box('k1', (-1.5, y, 7.5), (1.5, y + 1, 8), {'sides': clip})
    g.box('k2', (-8, 0, 7.4), (8, 16, 7.5), {'north': Face(zig, 'z', mi='lit')})
    g.box('k3', (-8, 13, 6.5), (8, 15, 7.5), {'north': Face(tube, 'h', mi='lit'), 'up': Face(tube, 'hu', mi='lit'), 'down': Face(tube, 'hu', mi='lit')})
    for x in (-5, 4):
        g.box('k3', (x, 12.5, 7.5), (x + 1, 15.5, 8), {'sides': clip})
    out.geo(g, {f'geometry.fnar.{name}{"" if k == 0 else f"_{k}"}': ([f'k{k}'], (0, 0, 0)) for k in range(4)})
    out.tex(name, g.paint())
    perms = [(bs('fnar:kind', k), {'minecraft:geometry': f'geometry.fnar.{name}_{k}'}) for k in (1, 2, 3)]
    out.block(name, block_json(name, geometry=f'geometry.fnar.{name}', materials=mi_set(name, {'lit': glow(name)}), states={'fnar:kind': [0, 1, 2, 3]},
                               collision=False, selection=box(-8, 0, 6.5, 8, 16, 8), map_color=light_hex, destroy=0.5, light=4, perms=perms))
    out.light(name, light_hex, 'static_light')


@prop
def neon_pink(out):
    _neon(out, 'pink', N_PINK, '#ff5fb0')


@prop
def neon_teal(out):
    _neon(out, 'teal', N_TEAL, '#4ff0e0')


@prop
def neon_yellow(out):
    _neon(out, 'yellow', N_YEL, '#ffd84a')
