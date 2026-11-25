"""The lobby, the showroom and the halls: the host stand, coat hooks, a tall prize cabinet, the jukebox, the sound
booth's mixing desk, wall piers for the halls, a fire extinguisher, a drinking fountain, a bar stool and the
Fun Zone's shoe cubby. Models face north, wall props have their back at z = +8."""
from propkit import Geo, Face, prop, panel, block_json, box, mi_set, glow, bs
from rework_pal import *  # noqa: F403

HALF = {'fnar:half': {'values': {'min': 0, 'max': 1}}}


def _upper(name, light=None):
    comps = {'minecraft:geometry': f'geometry.fnar.{name}_upper'}
    if light:
        comps['minecraft:light_emission'] = light
    return (bs('fnar:half', 1), comps)


# =============================================================== the host stand
@prop
def host_stand(out):
    """The host's stand inside the doors: a panelled oak podium with a gold star, a brass rail, the seating book
    open on top and a little bell."""
    g = Geo('host_stand', 64, 64)

    def front(r):
        wood(OAK, 3)(r)
        r.frame_rect(1, 1, r.w - 2, r.h - 2, OAK, 1)
        cx, cy = r.w // 2, r.h // 2
        for (dx, dy) in ((0, -2), (-1, -1), (0, -1), (1, -1), (-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0), (-1, 1), (0, 1), (1, 1), (-2, 2), (-1, 2), (1, 2), (2, 2)):
            r.px(cx + dx, cy + dy, GOLD, 4 + (dx + dy) % 2, metal=120)
        r.hline(1, r.h - 2, r.w - 2, RED_P, 3)

    def book(r):
        r.fill(PAPER, 4, amp=0.3)
        r.vline(r.w // 2, 0, r.h, PAPER, 1)
        for y in range(1, r.h - 1, 2):
            r.hline(1, y, r.w // 2 - 2, GRIME, 1); r.hline(r.w // 2 + 2, y, r.w // 2 - 3, GRIME, 2)
        r.rot180()

    g.box('stand', (-6, 0, -4), (6, 1, 5), {'sides': Face(wood(OAK, 1, bevel=None), 'plinth'), 'up': Face(wood(OAK, 2), 'plinthu')})
    g.box('stand', (-5, 1, -3), (5, 12, 4), {'north': front, 'south': Face(wood(OAK, 2), 'back'), 'east': Face(wood(OAK, 3), 'side'), 'west': Face(wood(OAK, 3), 'side')})
    g.box('stand', (-6, 12, -4), (6, 13, 5), {'up': Face(wood(OAK, 4, 'h'), 'top'), 'sides': Face(wood(OAK, 4, 'h', bevel=None), 'tope'), 'down': Face(wood(OAK, 1), 'topd')})
    g.box('stand', (-6, 13, 4), (6, 15, 5), {'sides': Face(panel(BRASS, 3, bevel=None), 'rail'), 'up': Face(panel(BRASS, 4, bevel=None), 'railu')})
    g.box('stand', (-4, 13, -3), (3, 13.5, 2), {'up': book, 'sides': Face(flat(RED_P, 2, 0, None), 'cover')})
    g.box('stand', (4, 13, -2), (5.5, 14.5, -0.5), {'sides': Face(panel(BRASS, 4, bevel=None), 'bell'), 'up': Face(panel(BRASS, 5, bevel=None), 'bellu')})
    out.geo(g)
    out.tex('host_stand', g.paint())
    out.block('host_stand', block_json('host_stand', geometry='geometry.fnar.host_stand', materials=mi_set('host_stand'),
                                       collision=box(-6, 0, -4, 6, 13, 5), selection=box(-6, 0, -4, 6, 15, 5), map_color='#5d3c25', destroy=1.5))


# =============================================================== coat hooks
@prop
def coat_hooks(out):
    """A rail of brass coat hooks on the wall. fnar:kind 0 a grown-up's coat, a child's red jacket and a cap left
    behind; 1 empty but for a scarf."""
    g = Geo('coat_hooks', 64, 64)
    TAN = Mat('rw_coat_tan', ['#3e3222', '#52432e', '#67553b', '#7c6848', '#907b57'], rough=235, h=136, hk=4)

    def cloth(m):
        def p(r):
            r.fill(m, 2, amp=0.6, white_amp=0.35, streak='v')
            r.bevel(1, -1)
            if r.face == 'north' and r.w >= 4:
                r.vline(r.w // 2, 1, r.h - 1, m, 0)
                for y in range(3, r.h - 2, 3):
                    r.px(r.w // 2 + 1, y, BRASS, 4)
            r.darken_noise(0.25, -1, bottom=0.7)
        return p

    g.box('rail', (-8, 11, 7), (8, 13, 8), {'north': Face(wood(OAK, 3, 'h'), 'rail'), 'ends': Face(wood(OAK, 4, 'h', bevel=None), 'railu'), 'sides': Face(wood(OAK, 2, bevel=None), 'raile')})
    for x in (-6, -2, 2, 6):
        g.box('rail', (x - 0.5, 11.5, 5.5), (x + 0.5, 12.5, 7), {'*': Face(panel(BRASS, 4, bevel=None), 'hook')})
    g.box('k0', (-8, 1, 5), (-3, 12, 7), {'north': cloth(TAN), 'sides': Face(cloth(TAN), 'c0s'), 'ends': Face(cloth(TAN), 'c0e')})
    g.box('k0', (0, 5, 5.5), (4, 12, 7), {'north': cloth(RED_P), 'sides': Face(cloth(RED_P), 'c1s'), 'ends': Face(cloth(RED_P), 'c1e')})
    g.box('k0', (4.5, 10, 4.5), (7.5, 12, 7), {'sides': Face(cloth(BLUE_P), 'cap'), 'up': Face(cloth(BLUE_P), 'capu'), 'down': Face(cloth(BLUE_P), 'capu')})
    g.box('k1', (1, 3, 6), (3, 12, 7), {'north': cloth(GREEN_P), 'sides': Face(cloth(GREEN_P), 'sc'), 'ends': Face(cloth(GREEN_P), 'sce')})
    out.geo(g, {'geometry.fnar.coat_hooks': (['rail', 'k0'], (0, 0, 0)), 'geometry.fnar.coat_hooks_1': (['rail', 'k1'], (0, 0, 0))})
    out.tex('coat_hooks', g.paint())
    out.block('coat_hooks', block_json('coat_hooks', geometry='geometry.fnar.coat_hooks', materials=mi_set('coat_hooks'), states={'fnar:kind': [0, 1]},
                                       collision=False, selection=box(-8, 1, 4.5, 8, 13, 8), map_color='#52432e', destroy=1.0,
                                       perms=[(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.coat_hooks_1'})]))


# =============================================================== the tall prize cabinet
@prop
def display_case(out):
    """A tall glass prize cabinet, two blocks tall (fnar:half): an oak base, glass shelves of prizes (a plush, a
    toy car, a ball; a trophy and a tin robot above), a lit cap (light 5 on the upper half)."""
    g = Geo('display_case', 64, 64)
    g.box('lower', (-8, 0, -6), (8, 5, 8), {'sides': Face(wood(OAK, 3), 'base'), 'up': Face(flat(VINYL_R, 2, 0.3), 'floor')})
    for bone, y0, y1 in (('lower', 5, 16), ('upper', 16, 28)):
        for (x, z) in ((-8, -6), (7, -6), (-8, 7), (7, 7)):
            g.box(bone, (x, y0, z), (x + 1, y1, z + 1), {'sides': Face(panel(BRASS, 3, bevel=None, streak='v'), 'post')})
        g.box(bone, (-7, y0, -6), (7, y1, -5.9), {'north': Face(glass, f'gl_{bone}')})
        for x in (-8, 7.9):
            g.box(bone, (x, y0, -5), (x + 0.1, y1, 7), {'east': Face(glass, f'gs_{bone}'), 'west': Face(glass, f'gs_{bone}')})
        g.box(bone, (-7, y0, 7.5), (7, y1, 8), {'north': Face(flat(VINYL_R, 1, 0.2), f'bk_{bone}')})
    g.box('lower', (-7, 10, -5), (7, 10.5, 7), {'up': Face(glass, 'shelf'), 'down': Face(glass, 'shelf'), 'north': Face(panel(BRASS, 4, bevel=None), 'se')})
    g.box('upper', (-7, 22, -5), (7, 22.5, 7), {'up': Face(glass, 'shelf'), 'down': Face(glass, 'shelf'), 'north': Face(panel(BRASS, 4, bevel=None), 'se')})
    prize = lambda m, b=3: Face(flat(m, b, 0.1), f'pz_{m.name}')
    g.box('lower', (-5, 5, -2), (-1, 9, 2), {'*': prize(PURP_P)})                      # a plush
    g.box('lower', (-4.5, 9, -1.5), (-1.5, 10, 1.5), {'sides': prize(PURP_P, 4)})
    g.box('lower', (2, 5, -3), (6, 7, 0), {'*': prize(RED_P)})                         # a toy car
    g.box('lower', (-5, 10.5, 0), (-2, 13.5, 3), {'*': prize(YEL_P, 4)})               # a ball
    g.box('lower', (1, 10.5, -2), (5, 14.5, 1), {'*': prize(BLUE_P)})
    g.box('upper', (-5, 16, -1), (-2, 21, 2), {'*': prize(TEAL_P)})                    # a tin robot
    g.box('upper', (2, 16, -2), (5, 18, 1), {'*': prize(GREEN_P)})
    g.box('upper', (-1, 22.5, -1), (1, 27, 1), {'*': Face(panel(GOLD, 4, bevel=(1, -1)), 'trophy')})
    g.box('upper', (-2, 26, -2), (2, 27.5, 2), {'sides': Face(panel(GOLD, 5, bevel=None), 'cup')})
    g.box('upper', (3, 22.5, 2), (6, 25.5, 5), {'*': prize(PINK)})
    g.box('upper', (-8, 28, -6), (8, 30, 8), {'sides': Face(wood(OAK, 4, 'h'), 'cap'), 'up': Face(wood(OAK, 2), 'capu'),
                                              'down': Face(lambda r: r.fill(BULB, 3, amp=0.4), 'lamp', mi='lit')})
    out.geo(g, {'geometry.fnar.display_case': (['lower'], (0, 0, 0)), 'geometry.fnar.display_case_upper': (['upper'], (0, -16, 0))})
    out.tex('display_case', g.paint())
    out.block('display_case', block_json('display_case', geometry='geometry.fnar.display_case', materials=mi_set('display_case', {'lit': glow('display_case')}),
                                         states=HALF, collision=box(-8, 0, -6, 8, 16, 8), selection=box(-8, 0, -6, 8, 16, 8), map_color='#5d3c25', destroy=2.0,
                                         perms=[_upper('display_case', 5)]))
    out.light('display_case', '#ffd9a0', 'static_light')


# =============================================================== the jukebox
@prop
def jukebox_revue(out):
    """The showroom's jukebox, two blocks tall (fnar:half): a walnut cabinet with a gold grille, an arched top with
    bubble tubes down each side and the title cards lit behind glass. It still glows at night (light 7, upper)."""
    g = Geo('jukebox_revue', 64, 64)

    def lower(r):
        wood(OAK, 2)(r)
        r.rect(2, 2, 10, 9, GOLD, 2, metal=140)
        for y in range(2, 11):
            for x in range(2, 12):
                if (x + y) % 2:
                    r.px(x, y, BLACK, 1)
        r.frame_rect(1, 1, 12, 11, BRASS, 4)
        r.rect(5, 13, 4, 2, BLACK, 1); r.px(6, 13, N_RED, 2)
        for y in range(1, 15):
            r.px(0, y, N_YEL, 1 + y % 3); r.px(13, y, N_RED, 1 + (y + 1) % 3)

    def upper(r):
        wood(OAK, 2)(r)
        r.rect(2, 4, 10, 6, CREAM, 5, emit=170)
        for y in range(5, 10, 2):
            r.hline(3, y, 3, RED_P, 3, emit=120); r.hline(8, y, 3, BLUE_P, 3, emit=120)
        r.frame_rect(1, 3, 12, 8, BRASS, 4)
        r.rect(3, 0, 8, 2, N_PURP, 2)
        for y in range(0, r.h):
            r.px(0, y, (N_YEL, N_GRN, N_TEAL)[y % 3], 2); r.px(13, y, (N_RED, N_PINK, N_PURP)[y % 3], 2)

    side = Face(wood(OAK, 3), 'side')
    g.box('lower', (-7, 0, -5), (7, 16, 8), {'north': Face(lower, mi='lit'), 'east': side, 'west': side, 'south': Face(wood(OAK, 1), 'back')})
    g.box('upper', (-7, 16, -5), (7, 26, 8), {'north': Face(upper, mi='lit'), 'east': Face(wood(OAK, 3), 'side2'), 'west': Face(wood(OAK, 3), 'side2'), 'south': Face(wood(OAK, 1), 'back2')})
    g.box('upper', (-5, 26, -5), (5, 29, 8), {'north': Face(lambda r: (r.fill(N_PURP, 2, amp=0.5), r.hline(0, 0, r.w, BRASS, 4)), 'arch', mi='lit'), 'sides': Face(wood(OAK, 3, 'h'), 'archs'), 'up': Face(wood(OAK, 2), 'archu')})
    g.box('upper', (-7, 26, -5), (-5, 27.5, 8), {'*': Face(wood(OAK, 3, 'h', 0, None), 'sh')})
    g.box('upper', (5, 26, -5), (7, 27.5, 8), {'*': Face(wood(OAK, 3, 'h', 0, None), 'sh')})
    out.geo(g, {'geometry.fnar.jukebox_revue': (['lower'], (0, 0, 0)), 'geometry.fnar.jukebox_revue_upper': (['upper'], (0, -16, 0))})
    out.tex('jukebox_revue', g.paint())
    out.block('jukebox_revue', block_json('jukebox_revue', geometry='geometry.fnar.jukebox_revue', materials=mi_set('jukebox_revue', {'lit': glow('jukebox_revue')}),
                                          states=HALF, collision=box(-7, 0, -5, 7, 16, 8), selection=box(-7, 0, -5, 7, 16, 8), map_color='#4b301d', destroy=2.0, light=3,
                                          perms=[_upper('jukebox_revue', 7)]))
    out.light('jukebox_revue', '#ffb070', 'point_light')


# =============================================================== the sound booth's desk
@prop
def mixing_desk(out):
    """One cell of the sound-and-light booth's console (side by side along x): rows of faders and coloured knobs
    on a sloped black desk, a strip of meters still lit (light 2)."""
    g = Geo('mixing_desk', 64, 64)

    def surface(r):
        r.fill(BLACK, 2, amp=0.3)
        for x in range(1, r.w - 1, 2):
            r.vline(x, 5, 6, BLACK, 0)
            r.px(x, 5 + (x * 7) % 5, PAPER, 5)                           # fader caps
            r.px(x, 1, (RED_P, YEL_P, BLUE_P, GREEN_P)[(x // 2) % 4], 5)   # knobs
            r.px(x, 3, GREYPLAST, 4)
        r.rot180()

    def meters(r):
        r.fill(BLACK, 1, amp=0.2)
        for x in range(1, r.w - 1, 2):
            n = 1 + (x * 5) % 3
            for k in range(n):
                r.px(x, r.h - 2 - k, N_GRN if k < 2 else N_YEL, 2)
            r.px(x, 0, N_RED, 1, emit=40)

    g.box('desk', (-8, 0, -3), (8, 9, 6), {'sides': Face(panel(BLACK, 2, grime=0.3), 'body')})
    g.box('desk', (-8, 9, -6), (8, 10, 6), {'up': surface, 'sides': Face(panel(BLACK, 3, bevel=None), 'edge'), 'down': Face(panel(BLACK, 1, bevel=None), 'under')})
    g.box('desk', (-8, 10, 3), (8, 14, 6), {'north': Face(meters, mi='lit'), 'south': Face(panel(BLACK, 2), 'mb'), 'up': Face(panel(BLACK, 3, bevel=None), 'mu'),
                                            'east': Face(panel(BLACK, 2, bevel=None), 'me'), 'west': Face(panel(BLACK, 2, bevel=None), 'me')})
    out.geo(g)
    out.tex('mixing_desk', g.paint())
    out.block('mixing_desk', block_json('mixing_desk', geometry='geometry.fnar.mixing_desk', materials=mi_set('mixing_desk', {'lit': glow('mixing_desk')}),
                                        collision=box(-8, 0, -6, 8, 10, 6), selection=box(-8, 0, -6, 8, 14, 6), map_color='#1a1a1e', destroy=1.5, light=2))


# =============================================================== wall piers for the halls
@prop
def wall_pier(out):
    """A shallow pier against a wall (3 px proud): charcoal paint, chipped at the corners. fnar:kind 0 the shaft,
    1 the foot (a taller plinth), 2 the head (a cap with the halls' red line)."""
    g = Geo('wall_pier', 64, 64)
    CHAR = Mat('rw_charcoal', ['#17191d', '#202328', '#2a2d33', '#353940', '#41464e', '#4e545d'], rough=170, h=138, hk=3)

    def shaft(r):
        r.fill(CHAR, 2, amp=0.5, white_amp=0.3)
        r.vline(0, 0, r.h, CHAR, 4); r.vline(r.w - 1, 0, r.h, CHAR, 0)
        r.speck(PAPER, 2, 0.012)
        r.darken_noise(0.25, -1, bottom=0.5)
        if r.cube.bone == 'k2':
            r.hline(0, 3, r.w, RED, 4); r.hline(0, 4, r.w, RED, 2)

    side = lambda b: Face(panel(CHAR, 1, bevel=None), f'side{b}')
    for k in range(3):
        g.box(f'k{k}', (-5, 0, 5), (5, 16, 8), {'north': shaft, 'east': side(k), 'west': side(k)})
    g.box('k1', (-6, 0, 4), (6, 5, 8), {'north': Face(panel(CHAR, 3, grime=0.4), 'plinth'), 'east': Face(panel(CHAR, 1, bevel=None), 'pe'), 'west': Face(panel(CHAR, 1, bevel=None), 'pe'), 'up': Face(panel(CHAR, 4, bevel=None), 'pu')})
    g.box('k2', (-6, 13, 4), (6, 16, 8), {'north': Face(panel(CHAR, 4), 'cap'), 'east': Face(panel(CHAR, 2, bevel=None), 'ce'), 'west': Face(panel(CHAR, 2, bevel=None), 'ce'), 'down': Face(panel(CHAR, 1, bevel=None), 'cd')})
    out.geo(g, {f'geometry.fnar.wall_pier{"" if k == 0 else f"_{k}"}': ([f'k{k}'], (0, 0, 0)) for k in range(3)})
    out.tex('wall_pier', g.paint())
    perms = [(bs('fnar:kind', k), {'minecraft:geometry': f'geometry.fnar.wall_pier_{k}'}) for k in (1, 2)]
    out.block('wall_pier', block_json('wall_pier', geometry='geometry.fnar.wall_pier', materials=mi_set('wall_pier', render='opaque'), states={'fnar:kind': [0, 1, 2]},
                                      collision=box(-6, 0, 5, 6, 16, 8), selection=box(-6, 0, 4, 6, 16, 8), map_color='#2a2d33', destroy=1.5, perms=perms))


# =============================================================== a fire extinguisher, a drinking fountain
@prop
def fire_extinguisher(out):
    """A fire extinguisher on its wall bracket under a red sign plate."""
    g = Geo('fire_extinguisher', 64, 64)

    def tank(r):
        r.fill(RED_P, 3, amp=0.4, streak='v')
        r.bevel(1, -1)
        if r.face == 'north':
            r.rect(0, 3, r.w, 3, CREAM, 5); r.hline(1, 4, r.w - 2, BLACK, 2)
        r.darken_noise(0.2, -1, bottom=0.6)

    def plate(r):
        r.fill(RED_P, 4, amp=0.3)
        r.frame_rect(0, 0, r.w, r.h, CREAM, 5)
        for (x, y) in ((3, 1), (2, 2), (3, 2), (4, 2), (2, 3), (3, 3)):
            r.px(x, y, CREAM, 6)

    g.box('ext', (-2, 2, 4), (2, 11, 8), {'north': tank, 'sides': Face(tank, 'ts'), 'down': Face(flat(RED_P, 1, 0, None), 'td'), 'up': Face(flat(RED_P, 4, 0, None), 'tu')})
    g.box('ext', (-1, 11, 5), (1, 13, 7), {'sides': Face(chrome(3), 'neck'), 'up': Face(panel(BLACK, 3, bevel=None), 'necku')})
    g.box('ext', (1, 6, 4.5), (3, 12, 5.5), {'*': Face(panel(BLACK, 2, bevel=None), 'hose')})
    g.box('ext', (-3, 5, 7.5), (3, 6, 8), {'north': Face(steel(2, 0, 'h', None), 'strap')})
    g.box('ext', (-3.5, 13.5, 7.5), (3.5, 16, 8), {'north': plate})
    out.geo(g)
    out.tex('fire_extinguisher', g.paint())
    out.block('fire_extinguisher', block_json('fire_extinguisher', geometry='geometry.fnar.fire_extinguisher', materials=mi_set('fire_extinguisher'),
                                              collision=False, selection=box(-3.5, 2, 4, 3.5, 16, 8), map_color='#8f1f1c', destroy=1.0))


@prop
def water_fountain(out):
    """A stainless drinking fountain on the wall: a bowl, a bubbler, a push bar, a rust streak under the drain."""
    g = Geo('water_fountain', 64, 64)

    def bowl(r):
        r.fill(STEEL, 4, amp=0.4, streak='h')
        r.rect(2, 1, r.w - 4, r.h - 3, STEEL, 2)
        r.px(r.w // 2, r.h // 2, BLACK, 0)
        r.stain(RUST, 3, r.w / 2 + 1, r.h / 2, 1.5, 1.5, p=0.6)
        r.rot180()

    g.box('fountain', (-5, 9, 1), (5, 13, 8), {'up': bowl, 'sides': Face(steel(3, 0.3), 'body'), 'down': Face(steel(1, 0.2), 'under')})
    g.box('fountain', (-4, 3, 4), (4, 9, 8), {'north': Face(lambda r: (steel(2, 0.4)(r), r.drip(RUST, 3, r.w // 2, 0, 5)), 'apron'), 'sides': Face(steel(2, 0.3), 'aprons')})
    g.box('fountain', (2, 13, 4), (3, 14.5, 5), {'sides': Face(chrome(4), 'bub'), 'up': Face(chrome(5), 'bubu')})
    g.box('fountain', (-4, 10, 0.5), (4, 11.5, 1), {'*': Face(chrome(3), 'bar')})
    out.geo(g)
    out.tex('water_fountain', g.paint())
    out.block('water_fountain', block_json('water_fountain', geometry='geometry.fnar.water_fountain', materials=mi_set('water_fountain'),
                                           collision=box(-5, 3, 1, 5, 13, 8), selection=box(-5, 3, 0.5, 5, 14.5, 8), map_color='#747a81', destroy=1.5))


# =============================================================== a stool, the shoe cubby
@prop
def bar_stool(out):
    """A chrome stool with a split red vinyl top, bolted to the floor in front of the counter and the machines."""
    g = Geo('bar_stool', 64, 64)

    def seat(r):
        r.fill(VINYL_R, 3, amp=0.4)
        r.bevel(1, -1)
        r.px(3, 4, VINYL_R, 0); r.px(4, 4, VINYL_R, 0); r.px(4, 5, PAPER, 3)

    g.box('stool', (-3, 0, -3), (3, 1, 3), {'sides': Face(chrome(2), 'foot'), 'up': Face(chrome(3), 'footu')})
    g.box('stool', (-1, 1, -1), (1, 9, 1), {'sides': Face(chrome(3), 'stem')})
    g.box('stool', (-3, 4, -3), (3, 4.5, 3), {'sides': Face(chrome(4), 'ring'), 'up': Face(chrome(3), 'ringu'), 'down': Face(chrome(2), 'ringu')})
    g.box('stool', (-4, 9, -4), (4, 11, 4), {'up': seat, 'sides': Face(flat(VINYL_R, 2, 0.1, None), 'side'), 'down': Face(chrome(2), 'sd')})
    out.geo(g)
    out.tex('bar_stool', g.paint())
    out.block('bar_stool', block_json('bar_stool', geometry='geometry.fnar.bar_stool', materials=mi_set('bar_stool'), facing=False,
                                      collision=box(-4, 0, -4, 4, 11, 4), selection=box(-4, 0, -4, 4, 11, 4), map_color='#7e1c1f', destroy=1.0))


@prop
def shoe_cubby(out):
    """The play area's shoe cubby: nine pigeonholes in painted plywood, small shoes left in a few of them."""
    g = Geo('shoe_cubby', 64, 64)

    def front(r):
        r.fill(YEL_P, 3, amp=0.4)
        cols = (RED_P, BLUE_P, None, None, CREAM, GREEN_P, PURP_P, None, RED_P)
        for k in range(9):
            x0, y0 = 1 + (k % 3) * 5, 1 + (k // 3) * 5
            r.rect(x0, y0, 4, 4, BLACK, 0)
            c = cols[k]
            if c:
                r.px(x0, y0 + 3, c, 4); r.px(x0 + 1, y0 + 3, c, 3); r.px(x0 + 1, y0 + 2, c, 4); r.px(x0 + 3, y0 + 3, c, 3)
        r.darken_noise(0.2, -1, bottom=0.6, only=YEL_P)

    side = Face(flat(BLUE_P, 3, 0.3), 'side')
    g.box('cubby', (-8, 0, -4), (8, 16, 8), {'north': front, 'east': side, 'west': side, 'south': Face(flat(BLUE_P, 2, 0.3), 'back'), 'up': Face(flat(RED_P, 3, 0.4), 'top')})
    out.geo(g)
    out.tex('shoe_cubby', g.paint())
    out.block('shoe_cubby', block_json('shoe_cubby', geometry='geometry.fnar.shoe_cubby', materials=mi_set('shoe_cubby', render='opaque'),
                                       collision=box(-8, 0, -4, 8, 16, 8), selection=box(-8, 0, -4, 8, 16, 8), map_color='#b89224', destroy=1.5))
