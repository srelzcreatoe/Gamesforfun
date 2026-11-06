"""The second remake (after the reference pictures): star-back chairs, cafe tables, padded booths, a disco ball,
brass stanchions with velvet ropes, coloured PAR cans, a popcorn machine and a gumball machine."""
from propkit import Geo, Face, Mat, prop, panel, block_json, box, mi_set, glow, bs
from pal import *  # noqa: F403

MAROON = Mat('vinyl_maroon', ['#200a0e', '#2e0f15', '#3e151c', '#4e1b24', '#5f222c', '#702a35'], rough=110, h=140, hk=3)
TAN = Mat('vinyl_tan', ['#4a2410', '#622f14', '#7a3c1a', '#934a21', '#a85a2a', '#bb6b34'], rough=105, h=140, hk=3)
OAK = Mat('wood_mid', ['#3a2414', '#4a2f1a', '#5b3a21', '#6c4628', '#7c5230', '#8b5e39'], rough=150, h=138, hk=4)
LAMINATE = Mat('laminate', ['#5a4a36', '#6b5a43', '#7c6a50', '#8c7a5e', '#9a886b', '#a69476'], rough=90, h=140, hk=3)
MIRROR = Mat('mirror', ['#2a2e36', '#454b56', '#6a7280', '#9aa2b0', '#c8ced8', '#eef2f8'], metal=240, rough=30, h=150, hk=2)
GLINT = Mat('mirror_glint', ['#e8eef8', '#f6f9ff', '#ffffff'], metal=200, rough=20, emit=[120, 170, 220], h=150, hk=1)
VELVET = Mat('velvet', ['#2a0508', '#3c080d', '#520c13', '#68121a', '#7e1a22'], rough=245, h=138, hk=3)
POPCORN = Mat('popcorn', ['#8a7a4a', '#a8965c', '#c4b070', '#d8c688', '#e8daa2', '#f4ead0'], rough=230, h=150, hk=3)
GLASS_HI = Mat('glass_hi', ['#3a4a52', '#566a74', '#7a8e98', '#a8b8c0', '#d0dce2'], metal=0, rough=20, h=150, hk=1)
LENSES = [('red', ['#3a0a0a', '#6a1212', '#a01c1c', '#d83030', '#ff5a4a', '#ffa090']),
          ('pink', ['#3a0a24', '#6a1440', '#a0205e', '#d8388a', '#ff6ab4', '#ffb0d8']),
          ('blue', ['#0a1a3a', '#12306a', '#1c4aa0', '#3070d8', '#5a9aff', '#a0c8ff']),
          ('green', ['#0a3a14', '#126a24', '#1ca03a', '#30d858', '#5aff80', '#a8ffc0'])]
GUM = [Mat(f'gum{i}', [c, c, c], rough=60, h=150, hk=0) for i, c in enumerate(('#c23a3a', '#d8b43a', '#3a6ad0', '#3aa856', '#e0e0e0', '#e0782a', '#9a4ac8'))]
LENS_MATS = {(i, lit): Mat(f'lens_{c}_{"on" if lit else "off"}', ramp, rough=40, emit=[60, 110, 170, 220, 250, 255] if lit else 0, h=150, hk=1)
             for i, (c, ramp) in enumerate(LENSES) for lit in (True, False)}


def star_mask(cx, cy):
    """A 5-pointed star a few texels across, as a set of (x, y) offsets around a centre."""
    pts = [(0, -2), (-1, -1), (0, -1), (1, -1), (-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0), (-1, 1), (0, 1), (1, 1),
           (-2, 2), (-1, 2), (1, 2), (2, 2)]
    return [(cx + dx, cy + dy) for dx, dy in pts]


# =============================================================== the star-back chair (ref 1)
@prop
def star_chair(out):
    """Dark wooden chair, a maroon padded seat, a yoke-shaped back with a star cut right through it."""
    g = Geo('star_chair', 32, 32)
    wood = lambda base=3: panel(OAK, base, amp=0.6, streak='v', grime=0.3)

    def back_face(r):
        wood(3)(r)
        r.bevel(1, -1)
        cx, cy = r.w // 2, r.h // 2
        for (x, y) in star_mask(cx, cy):
            r.clear(x, y, 1, 1)  # the cut-out: you see through the star

    def cushion(r):
        r.fill(MAROON, 3, amp=0.5, white_amp=0.3)
        r.bevel(1, -1)
        r.shade_rect(2, 2, r.w - 4, r.h - 4, 1)
        r.stain(GRIME, 2, 3.5, 7.5, 1.4, 1.0, p=0.6)
        r.darken_noise(0.2, -1)

    for x in (-5, 4):
        for z in (-5, 4):
            g.box('legs', (x, 0, z), (x + 1, 7, z + 1), {'sides': Face(wood(2), 'leg'), 'down': Face(wood(1), 'legd')})
    g.box('seat', (-5.5, 7, -5.5), (5.5, 7.5, 5), {'sides': Face(wood(3), 'frame'), 'down': wood(1)})
    g.box('seat', (-5, 7.5, -5), (5, 9, 4.5), {'up': cushion, 'sides': Face(panel(MAROON, 2, bevel=None), 'cush')})
    for x in (-5, 4):
        g.box('back', (x, 9, 4.5), (x + 1, 16, 5.5), {'sides': Face(wood(3), 'post'), 'up': Face(wood(4), 'postu')})
    g.box('back', (-4, 9.5, 4.7), (4, 16, 5.3), {'north': Face(back_face, 'bk'), 'south': Face(back_face, 'bk'),
                                                  'up': Face(wood(4), 'bku'), 'down': Face(wood(2), 'bkd')})
    out.geo(g)
    out.tex('star_chair', g.paint())
    blk = block_json('star_chair', geometry='geometry.fnar.star_chair', materials=mi_set('star_chair'),
                     collision=box(-5.5, 0, -5.5, 5.5, 9, 5.5), selection=box(-5.5, 0, -5.5, 5.5, 16, 5.5), map_color='#4e1b24', destroy=1.0)
    out.block('star_chair', blk)
    f = {'focus': [0, 0.5, 0], 'dist': 1.9}
    out.views('star_chair', [{'label': 'north', **f}, {'label': 'back', 'states': {'minecraft:cardinal_direction': 'south'}, **f}])


# =============================================================== the cafe table (ref 1)
@prop
def cafe_table(out):
    """A square wood-laminate dining table on a black pedestal, a chrome napkin holder on top."""
    g = Geo('cafe_table', 32, 32)

    def top(r):
        r.fill(LAMINATE, 3, amp=0.5, white_amp=0.3, streak='h')
        r.frame_rect(0, 0, r.w, r.h, OAK, 2)
        r.stain(GRIME, 2, 4.5, 9.5, 1.8, 1.3, p=0.4)  # a ring from a soda cup
        r.speck(CARD, 4, 0.03)
        r.darken_noise(0.15, -1)

    g.box('table', (-7.5, 13, -7.5), (7.5, 14.5, 7.5), {'up': top, 'down': Face(panel(OAK, 1, bevel=None), 'under'),
                                                         'sides': Face(panel(OAK, 2, bevel=None), 'edge')})
    g.box('table', (-1, 1, -1), (1, 13, 1), {'sides': Face(panel(BLACK, 2, bevel=None, streak='v'), 'col')})
    g.box('table', (-5, 0, -1), (5, 1, 1), {'sides': Face(panel(BLACK, 1, bevel=None), 'foot'), 'up': Face(panel(BLACK, 2, bevel=None), 'footu')})
    g.box('table', (-1, 0, -5), (1, 1, 5), {'sides': Face(panel(BLACK, 1, bevel=None), 'foot2'), 'up': Face(panel(BLACK, 2, bevel=None), 'footu2')})
    g.box('table', (-1.5, 14.5, -0.75), (1.5, 16, 0.75), {'sides': Face(panel(CHROME, 3, bevel=None), 'nap'), 'up': Face(panel(WHITE, 4, bevel=None), 'napu')})
    out.geo(g)
    out.tex('cafe_table', g.paint())
    blk = block_json('cafe_table', geometry='geometry.fnar.cafe_table', materials=mi_set('cafe_table'), facing=False,
                     collision=box(-7.5, 0, -7.5, 7.5, 14.5, 7.5), selection=box(-7.5, 0, -7.5, 7.5, 16, 7.5), map_color='#7c6a50', destroy=1.5)
    out.block('cafe_table', blk)
    out.views('cafe_table', [{'label': 'table', 'focus': [0, 0.5, 0], 'dist': 2.2}])


# =============================================================== the padded booth (ref 4)
@prop
def booth_seat(out):
    """One cell of a diner booth: a tan tufted vinyl seat and tall channelled back on a dark wood plinth;
    cells side by side make a long bench."""
    g = Geo('booth_seat', 64, 64)

    def seat_top(r):
        r.fill(TAN, 3, amp=0.5, white_amp=0.3)
        for c in range(0, r.w, 8):
            r.vline(c, 0, r.h, TAN, 1)
        r.shade_rect(0, 0, r.w, 2, 1)
        r.stain(GRIME, 2, 9, 4, 2.0, 1.2, p=0.5)
        r.px(4, 6, TAN, 0); r.px(5, 6, TAN, 0); r.px(5, 7, TAN, 0)  # a split in the vinyl
        r.darken_noise(0.2, -1)

    def back_front(r):
        r.fill(TAN, 3, amp=0.4, white_amp=0.25)
        for c in range(r.w):
            for rr in range(r.h):
                if c % 4 == 0 or rr in (0, r.h - 1):
                    r.px(c, rr, TAN, 1)  # the stitched channels
                elif c % 4 == 2 and 0 < rr < r.h - 1:
                    r.px(c, rr, TAN, 4)  # the puffed middle of each channel
        r.hline(0, 0, r.w, TAN, 5)
        r.darken_noise(0.2, -1, bottom=0.5)

    plinth = Face(panel(WOOD, 2, amp=0.5, streak='h', grime=0.4), 'plinth')
    g.box('booth', (-8, 0, -6), (8, 6, 8), {'north': plinth, 'east': Face(panel(WOOD, 2, bevel=None), 'pe'),
                                            'west': Face(panel(WOOD, 2, bevel=None), 'pe')})
    g.box('booth', (-8, 6, -6.5), (8, 8.5, 5), {'up': seat_top, 'north': Face(panel(TAN, 2), 'sf'),
                                                 'east': Face(panel(TAN, 2, bevel=None), 'se'), 'west': Face(panel(TAN, 2, bevel=None), 'se')})
    g.box('booth', (-8, 6, 5), (8, 16, 8), {'north': back_front, 'south': Face(panel(WOOD, 2, streak='v'), 'bs'),
                                            'up': Face(panel(WOOD, 3, bevel=None), 'bu'),
                                            'east': Face(panel(TAN, 2, bevel=None), 'be'), 'west': Face(panel(TAN, 2, bevel=None), 'be')})
    out.geo(g)
    out.tex('booth_seat', g.paint())
    blk = block_json('booth_seat', geometry='geometry.fnar.booth_seat', materials=mi_set('booth_seat', render='opaque'),
                     collision=box(-8, 0, -6.5, 8, 16, 8), selection=box(-8, 0, -6.5, 8, 16, 8), map_color='#785b37', destroy=1.5,
                     light_dampening=0)
    out.block('booth_seat', blk)
    out.views('booth_seat', [{'label': 'north', 'focus': [0, 0.5, 0], 'dist': 2.4}])


# =============================================================== the disco ball (ref 4)
@prop
def disco_ball(out):
    """A mirror ball hanging on its rod: a grid of little mirror tiles, a few catching the light."""
    g = Geo('disco_ball', 32, 32)

    def tiles(r):
        for y in range(r.h):
            for x in range(r.w):
                k = (x * 7 + y * 3 + (x * y) % 5) % 6
                grout = (x % 2 == 1 and y % 2 == 1)
                r.px(x, y, MIRROR, 0 if grout else max(1, k))
        for i, (x, y) in enumerate(((1, 1), (r.w - 2, 2), (2, r.h - 3), (r.w // 2, r.h // 2))):
            if 0 <= x < r.w and 0 <= y < r.h:
                r.px(x, y, GLINT, 2 - i % 2)

    rod = Face(panel(CHROME, 2, bevel=None), 'rod')
    g.box('ball', (-0.5, 11, -0.5), (0.5, 16, 0.5), {'sides': rod})
    g.box('ball', (-1.5, 15.5, -1.5), (1.5, 16, 1.5), {'sides': Face(panel(CHROME, 3, bevel=None), 'cap'), 'down': Face(panel(CHROME, 2, bevel=None), 'capd')})
    g.box('ball', (-3.5, 3.5, -3.5), (3.5, 10.5, 3.5), {'*': Face(tiles, 'core')})
    g.box('ball', (-2.5, 2.5, -2.5), (2.5, 11.5, 2.5), {'*': Face(tiles, 'tall')})
    g.box('ball', (-4.5, 4.5, -2.5), (4.5, 9.5, 2.5), {'*': Face(tiles, 'wide')})
    g.box('ball', (-2.5, 4.5, -4.5), (2.5, 9.5, 4.5), {'*': Face(tiles, 'deep')})
    out.geo(g)
    out.tex('disco_ball', g.paint())
    blk = block_json('disco_ball', geometry='geometry.fnar.disco_ball', materials=mi_set('disco_ball'), facing=False,
                     collision=False, selection=box(-4.5, 2.5, -4.5, 4.5, 16, 4.5), map_color='#9aa2b0', destroy=1.0)
    out.block('disco_ball', blk)
    out.views('disco_ball', [{'label': 'mirror ball', 'focus': [0, 0.45, 0], 'dist': 1.6}])


# =============================================================== brass stanchion + velvet rope (ref 2)
@prop
def stanchion(out):
    """A polished brass rope post with a ball finial on a round weighted foot."""
    g = Geo('stanchion', 16, 16)
    brass = lambda b=3: panel(BRASS, b, amp=0.4, bevel=None, streak='v')
    g.box('post', (-2.5, 0, -2.5), (2.5, 0.75, 2.5), {'sides': Face(brass(2), 'foot'), 'up': Face(brass(4), 'footu')})
    g.box('post', (-0.75, 0.75, -0.75), (0.75, 13, 0.75), {'sides': Face(brass(3), 'pole')})
    g.box('post', (-1.25, 13, -1.25), (1.25, 15.5, 1.25), {'sides': Face(brass(4), 'ball'), 'ends': Face(brass(5), 'ballu')})
    out.geo(g)
    out.tex('stanchion', g.paint())
    blk = block_json('stanchion', geometry='geometry.fnar.stanchion', materials=mi_set('stanchion'), facing=False,
                     collision=False, selection=box(-2.5, 0, -2.5, 2.5, 15.5, 2.5), map_color='#957329', destroy=1.0)
    out.block('stanchion', blk)
    out.views('stanchion', [{'label': 'post', 'focus': [0, 0.5, 0], 'dist': 1.6}])


@prop
def velvet_rope(out):
    """A red velvet rope sagging between two stanchions (placed in the cell between the posts, running
    east-west for facing north/south): brass clips at both ends."""
    g = Geo('velvet_rope', 32, 32)
    rope = lambda: panel(VELVET, 3, amp=0.5, bevel=None, streak='h')
    segs = [(-14.5, -10, 11.2), (-10, -6, 10.0), (-6, -2, 9.2), (-2, 2, 9.0), (2, 6, 9.2), (6, 10, 10.0), (10, 14.5, 11.2)]
    for i, (x0, x1, y) in enumerate(segs):
        g.box('rope', (x0, y, -0.5), (x1, y + 1, 0.5), {'sides': Face(rope(), f'r{i}'), 'ends': Face(rope(), f're{i}')})
    for x0 in (-14.5, 13.5):
        g.box('rope', (x0, 11, -0.6), (x0 + 1, 12.5, 0.6), {'*': Face(panel(BRASS, 4, bevel=None), 'clip')})
    out.geo(g)
    out.tex('velvet_rope', g.paint())
    blk = block_json('velvet_rope', geometry='geometry.fnar.velvet_rope', materials=mi_set('velvet_rope'),
                     collision=False, selection=box(-8, 8.5, -1, 8, 12.5, 1), map_color='#68121a', destroy=0.5)
    out.block('velvet_rope', blk)
    out.views('velvet_rope', [{'label': 'rope', 'focus': [0, 0.6, 0], 'dist': 2.4}])


# =============================================================== PAR cans (ref 1, ref 3)
@prop
def par_can(out):
    """A coloured PAR can on a clamp, tilted down at the stage or the room; fnar:color picks the gel (red, pink,
    blue, green), fnar:lit switches it with the stage lights."""
    g = Geo('par_can', 32, 32)

    def lens(r):
        lit = r.variant[1] == 'on'
        m = LENS_MATS[(int(r.variant[0]), lit)]
        r.fill(m, 2 if lit else 1, amp=0.3, white_amp=0.2)
        r.disc(r.w / 2, r.h / 2, max(1, r.w / 2 - 1.5), m, 3 if lit else 2)
        r.disc(r.w / 2, r.h / 2, 1.2, m, 5 if lit else 2)
        r.frame_rect(0, 0, r.w, r.h, BLACK, 2)

    body = lambda b=2: panel(BLACK, b, amp=0.4, bevel=None, grime=0.2)
    g.box('mount', (-1, 14, -1), (1, 16, 1), {'sides': Face(panel(STEEL, 3, bevel=None), 'clamp')})
    g.box('mount', (-3.5, 13, -0.5), (3.5, 14, 0.5), {'*': Face(panel(STEEL, 2, bevel=None), 'yoke')})
    for x in (-3.5, 2.5):
        g.box('mount', (x, 9, -0.5), (x + 1, 13, 0.5), {'*': Face(panel(STEEL, 2, bevel=None), 'yarm')})
    g.bone('can', pivot=(0, 10.5, 0), rotation=(30, 0, 0), parent='mount')
    g.box('can', (-2.5, 8, -3), (2.5, 13, 3.5), {'sides': Face(body(), 'canside'), 'up': Face(body(3), 'cantop'), 'down': Face(body(1), 'canbot'),
                                                  'south': Face(body(1), 'canback')})
    g.box('can', (-2.75, 7.75, -3.5), (2.75, 13.25, -3), {'north': Face(lens, 'lens', mi='lens'), 'sides': Face(body(3), 'rim'), 'ends': Face(body(3), 'rimu')})
    out.geo(g)
    names = []
    for i, (cname, _) in enumerate(LENSES):
        for st in ('on', 'off'):
            n = f'par_can_{cname}_{st}'
            out.tex(n, g.paint((str(i), st)))
            names.append((i, st == 'on', n))
    perms = [(f"{bs('fnar:color', i)} && {bs('fnar:lit', lit)}",
              {'minecraft:material_instances': mi_set(n, {'lens': glow(n) if lit else n}), 'minecraft:light_emission': 7 if lit else 0})
             for i, lit, n in names]
    blk = block_json('par_can', geometry='geometry.fnar.par_can', materials=mi_set('par_can_red_off', {'lens': 'par_can_red_off'}),
                     states={'fnar:color': {'values': {'min': 0, 'max': 3}}, 'fnar:lit': [True, False]},
                     collision=False, selection=box(-3.5, 6, -4, 3.5, 16, 4), map_color='#222227', destroy=1.0, light=7, perms=perms)
    out.block('par_can', blk)
    out.light('par_can', '#ffe0c8', 'point_light')
    out.views('par_can', [{'label': f'{c} {st}', 'states': {'fnar:color': i, 'fnar:lit': st == 'on'}, 'focus': [0, 0.6, 0], 'dist': 1.4}
                          for i, (c, _) in enumerate(LENSES) for st in ('on',)])


# =============================================================== the popcorn machine (ref 2)
@prop
def popcorn_machine(out):
    """A countertop popcorn machine: red base and roof, a glass cabinet full of popcorn, a chrome kettle."""
    g = Geo('popcorn_machine', 32, 32)

    def glass(r):
        for y in range(r.h):
            for x in range(r.w):
                if y >= r.h // 2:
                    r.px(x, y, POPCORN, 2 + (x * 3 + y * 5) % 4)
                else:
                    r.px(x, y, GLASS_HI, 0 if (x + y) % 5 else 1)
        for y in range(r.h // 2 - 1):
            if y + 1 < r.w:
                r.px(y + 1, y, GLASS_HI, 3)  # a reflection streak
        r.frame_rect(0, 0, r.w, r.h, RED, 3)

    red = lambda b=3: panel(RED, b, amp=0.4, grime=0.3)
    g.box('pop', (-4, 0, -3), (4, 4, 3), {'north': Face(red(3), 'base'), 'sides': Face(red(2), 'bases'), 'up': Face(red(2), 'baseu')})
    g.box('pop', (-4, 4, -3), (4, 11, 3), {'north': Face(glass, 'gl'), 'south': Face(glass, 'gl'), 'east': Face(glass, 'gls'), 'west': Face(glass, 'gls')})
    g.box('pop', (-4.5, 11, -3.5), (4.5, 12.5, 3.5), {'*': Face(red(4), 'roof')})
    g.box('pop', (-1.5, 9, -1.5), (1.5, 10.5, 1.5), {'sides': Face(panel(CHROME, 3, bevel=None), 'kettle')})
    g.box('pop', (-0.5, 12.5, -0.5), (0.5, 14, 0.5), {'*': Face(panel(YELLOW, 4, bevel=None), 'finial')})
    out.geo(g)
    out.tex('popcorn_machine', g.paint())
    blk = block_json('popcorn_machine', geometry='geometry.fnar.popcorn_machine', materials=mi_set('popcorn_machine'),
                     collision=box(-4, 0, -3, 4, 12.5, 3), selection=box(-4.5, 0, -3.5, 4.5, 14, 3.5), map_color='#8b2824', destroy=1.0)
    out.block('popcorn_machine', blk)
    out.views('popcorn_machine', [{'label': 'popcorn', 'focus': [0, 0.4, 0], 'dist': 1.5}])


# =============================================================== the gumball machine (ref 1)
@prop
def gumball_machine(out):
    """A floor-standing gumball machine: red pedestal, chrome coin mechanism, a glass globe of gumballs."""
    g = Geo('gumball_machine', 32, 32)

    def globe(r):
        for y in range(r.h):
            for x in range(r.w):
                if (x + 2 * y) % 3 == 0 or y >= 2:
                    r.px(x, y, GUM[(x * 5 + y * 3) % len(GUM)], 1)
                else:
                    r.px(x, y, GLASS_HI, 1)
        r.px(1, 0, GLASS_HI, 4)
        r.px(1, 1, GLASS_HI, 3)

    red = lambda b=3: panel(RED, b, amp=0.4, grime=0.2)
    g.box('gum', (-3, 0, -3), (3, 0.75, 3), {'sides': Face(red(2), 'plate'), 'up': Face(red(3), 'plateu')})
    g.box('gum', (-1, 0.75, -1), (1, 7, 1), {'sides': Face(red(3), 'ped')})
    g.box('gum', (-2.5, 7, -2.5), (2.5, 10, 2.5), {'north': Face(panel(CHROME, 3, bevel=None), 'mech'), 'sides': Face(red(3), 'box'),
                                                    'ends': Face(red(2), 'boxe')})
    g.box('gum', (-3, 10, -3), (3, 14.5, 3), {'sides': Face(globe, 'globe'), 'up': Face(globe, 'globeu')})
    g.box('gum', (-1.5, 14.5, -1.5), (1.5, 15.5, 1.5), {'*': Face(red(4), 'cap')})
    out.geo(g)
    out.tex('gumball_machine', g.paint())
    blk = block_json('gumball_machine', geometry='geometry.fnar.gumball_machine', materials=mi_set('gumball_machine'),
                     collision=box(-3, 0, -3, 3, 15.5, 3), selection=box(-3, 0, -3, 3, 15.5, 3), map_color='#8b2824', destroy=1.0)
    out.block('gumball_machine', blk)
    out.views('gumball_machine', [{'label': 'gumballs', 'focus': [0, 0.5, 0], 'dist': 1.7}])
