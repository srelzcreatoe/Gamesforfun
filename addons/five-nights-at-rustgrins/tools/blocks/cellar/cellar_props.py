"""The cellar's props: the ghost light on the Golden Dog's stage, bare bulbs, the boiler's pipes, the Other
Office's dead controls, the supper club's tables and chairs, its fallen chandelier and its bar, the black
water in the flooded corner, and the paw prints he leaves upstairs. Conventions as in tools/blocks/props:
models face north, wall props have their back at z = +8, one texel per model pixel."""
import math

from propkit import Geo, Face, prop, panel, block_json, box, mi_set, glow, bs
from pal import IRON, RUST, STEEL, GRIME, BLACK, RED, WHITE, CHROME  # noqa: F401
from cellar_pal import *  # noqa: F403


# =============================================================== the ghost light
@prop
def ghost_light(out):
    """A theatre's ghost light: one bare caged bulb on a tall stand, left burning on a dark stage.
    23 px tall (it reaches 7 px into the cell above). fnar:lit; light 12."""
    g = Geo('ghost_light', 32, 32)
    iron = lambda b=2, s=None: panel(IRON, b, amp=0.5, bevel=None, streak=s, grime=0.2)

    def bulb(r):
        m = BULBWARM if r.variant == 'on' else BULBDEAD
        r.fill(m, 3, amp=0.3, white_amp=0.2)
        r.px(r.w // 2, r.h // 2, m, 4)
        if r.face not in ('up', 'down'):
            r.hline(0, r.h - 1, r.w, m, 1)

    def pole(r):
        iron(3, 'v')(r)
        for y in range(4, r.h, 6):
            r.px(0, y, RUST, 3)
        r.px(0, r.h - 2, RUST, 2)

    g.box('stand', (-3, 0, -3), (3, 1, 3), {'sides': Face(iron(2), 'base'), 'up': Face(panel(IRON, 3, bevel=(1, -1), grime=0.3), 'baseu')})
    g.box('stand', (-1.5, 1, -1.5), (1.5, 2, 1.5), {'sides': Face(iron(3), 'hub'), 'up': Face(iron(4), 'hubu')})
    g.box('stand', (-0.5, 2, -0.5), (0.5, 18, 0.5), {'sides': Face(pole, 'pole')})
    g.box('stand', (-1, 18, -1), (1, 19.5, 1), {'sides': Face(panel(OLDBRASS, 3, bevel=None), 'sock'), 'ends': Face(panel(OLDBRASS, 2, bevel=None), 'socke')})
    g.box('bulb', (-1.5, 19.5, -1.5), (1.5, 22.5, 1.5), {'*': Face(bulb, 'bulb', mi='bulb')})
    for (x, z) in ((-2.25, -2.25), (1.75, -2.25), (-2.25, 1.75), (1.75, 1.75)):
        g.box('cage', (x, 19, z), (x + 0.5, 23, z + 0.5), {'sides': Face(iron(3), 'cg')})
    g.box('cage', (-2.25, 22.75, -0.25), (2.25, 23, 0.25), {'*': Face(iron(3), 'cgt')})
    g.box('cage', (-0.25, 22.75, -2.25), (0.25, 23, 2.25), {'*': Face(iron(3), 'cgt2')})
    g.box('cord', (-0.25, 0, 3), (0.25, 0.5, 8), {'up': Face(iron(1), 'cord'), 'east': Face(iron(1), 'cords'), 'west': Face(iron(1), 'cords')})
    out.geo(g)
    out.tex('ghost_light', g.paint('off'))
    out.tex('ghost_light_on', g.paint('on'))
    blk = block_json('ghost_light', geometry='geometry.fnar.ghost_light', facing=False,
                     materials=mi_set('ghost_light_on', {'bulb': glow('ghost_light_on')}), states={'fnar:lit': [True, False]},
                     collision=box(-1.5, 0, -1.5, 1.5, 16, 1.5), selection=box(-3, 0, -3, 3, 16, 3), map_color='#2a2e34', destroy=1.0, light=12,
                     perms=[(bs('fnar:lit', False), {'minecraft:material_instances': mi_set('ghost_light', {'bulb': 'ghost_light'}), 'minecraft:light_emission': 0})])
    out.block('ghost_light', blk)
    out.light('ghost_light', '#ffd08a', 'point_light')


# =============================================================== a bare bulb on its flex
@prop
def bare_bulb(out):
    """A bare bulb on a twisted flex, hanging from the top of the cell. fnar:lit; light 11 (the cellar by day)."""
    g = Geo('bare_bulb', 16, 16)

    def bulb(r):
        m = BULBWARM if r.variant == 'on' else BULBDEAD
        r.fill(m, 2, amp=0.3, white_amp=0.2)
        r.px(r.w // 2, r.h // 2, m, 4 if r.variant == 'on' else 3)

    flex = panel(GRIME, 1, amp=0.4, bevel=None, streak='v')
    g.box('flex', (-1, 15.5, -1), (1, 16, 1), {'sides': Face(panel(OLDBRASS, 2, bevel=None), 'rose'), 'down': Face(panel(OLDBRASS, 3, bevel=None), 'rosed')})
    g.box('flex', (-0.25, 9, -0.25), (0.25, 15.5, 0.25), {'sides': Face(flex, 'flex')})
    g.box('flex', (-0.75, 7, -0.75), (0.75, 9, 0.75), {'sides': Face(panel(OLDBRASS, 3, bevel=None), 'sock'), 'up': Face(panel(OLDBRASS, 2, bevel=None), 'socku')})
    g.box('bulb', (-1.25, 4, -1.25), (1.25, 7, 1.25), {'*': Face(bulb, 'bulb', mi='bulb')})
    out.geo(g)
    out.tex('bare_bulb', g.paint('off'))
    out.tex('bare_bulb_on', g.paint('on'))
    blk = block_json('bare_bulb', geometry='geometry.fnar.bare_bulb', facing=False,
                     materials=mi_set('bare_bulb_on', {'bulb': glow('bare_bulb_on')}), states={'fnar:lit': [True, False]},
                     collision=False, selection=box(-2, 4, -2, 2, 16, 2), map_color='#4b3817', destroy=0.5, light=11,
                     perms=[(bs('fnar:lit', False), {'minecraft:material_instances': mi_set('bare_bulb', {'bulb': 'bare_bulb'}), 'minecraft:light_emission': 0})])
    out.block('bare_bulb', blk)
    out.light('bare_bulb', '#ffc47a', 'point_light')


# =============================================================== the boiler's pipes
@prop
def cellar_pipes(out):
    """fnar:kind 0: a lagged steam pipe and a copper pipe running under the ceiling (along the facing's axis);
    1: the same pair rising up a wall (back at z = +8), a red hand wheel on the copper one."""
    g = Geo('cellar_pipes', 64, 64)

    def lagging(r):
        r.fill(OLDCLOTH, 3, amp=0.5, white_amp=0.3, streak='h' if r.cube.bone == 'run' else 'v')
        n = r.w if r.cube.bone == 'run' else r.h
        for k in range(0, n, 5):  # the wire bands round the lagging, rust running from them
            for j in range(r.h if r.cube.bone == 'run' else r.w):
                x, y = (k, j) if r.cube.bone == 'run' else (j, k)
                r.px(x, y, PIPE, 2)
        r.stain(RUST, 2, r.w * 0.6, r.h * 0.6, 2.2, 1.2, seed=1, p=0.6)
        r.stain(PIPE, 1, r.w * 0.25, r.h * 0.3, 1.6, 1.0, seed=2, p=0.8)  # lagging gone: the iron under it
        r.darken_noise(0.3, -1, cell=3)

    def copper(r):
        r.fill(COPPERPIPE, 3, amp=0.5, white_amp=0.3, streak='h' if r.cube.bone == 'run' else 'v')
        if r.cube.bone == 'run':
            r.hline(0, 0, r.w, COPPERPIPE, 5)
        else:
            r.vline(0, 0, r.h, COPPERPIPE, 5)
        r.stain(VERDIGRIS, 2, r.w * 0.3, r.h * 0.5, 1.8, 1.0, seed=3, p=0.8)
        r.stain(VERDIGRIS, 3, r.w * 0.8, r.h * 0.4, 1.2, 1.0, seed=4, p=0.7)
        r.darken_noise(0.2, -1, cell=3)

    iron = lambda b=3: panel(PIPE, b, amp=0.5, bevel=(1, -1), grime=0.3)

    def wheel(r):
        r.clear()
        for y in range(r.h):
            for x in range(r.w):
                d = math.hypot(x + 0.5 - r.w / 2, y + 0.5 - r.h / 2)
                if 1.3 < d <= 2.3 or abs(x + 0.5 - r.w / 2) < 0.6 or abs(y + 0.5 - r.h / 2) < 0.6:
                    r.px(x, y, VALVE, 2 + (x + y) % 2)
        r.px(r.w // 2, r.h // 2, PIPE, 4)

    # ---- kind 0: the run, along z under the ceiling
    g.box('run', (-5, 11, -8), (-2, 14, 8), {'east': Face(lagging, 'lag'), 'west': Face(lagging, 'lag'), 'up': Face(lagging, 'lagt'), 'down': Face(lagging, 'lagt')})
    g.box('run', (1, 12, -8), (3, 14, 8), {'east': Face(copper, 'cu'), 'west': Face(copper, 'cu'), 'up': Face(copper, 'cut'), 'down': Face(copper, 'cut')})
    g.box('run', (-5.5, 10.5, -1), (-1.5, 14.5, 1), {'*': Face(iron(2), 'flange')})
    g.box('run', (-3.75, 14, -0.5), (-3.25, 16, 0.5), {'sides': Face(iron(2), 'hang')})
    g.box('run', (1.75, 14, 4), (2.25, 16, 5), {'sides': Face(iron(2), 'hang')})
    # ---- kind 1: the riser, against the wall
    g.bone('riser')
    g.box('riser', (-5, 0, 4), (-2, 16, 7), {'north': Face(lagging, 'rlag'), 'east': Face(lagging, 'rlag'), 'west': Face(lagging, 'rlag')})
    g.box('riser', (1, 0, 5), (3, 16, 7), {'north': Face(copper, 'rcu'), 'east': Face(copper, 'rcu'), 'west': Face(copper, 'rcu')})
    g.box('riser', (-5.5, 5, 3.5), (-1.5, 7, 7.5), {'*': Face(iron(2), 'rflange')})
    g.box('riser', (0.5, 8, 4.5), (3.5, 11, 7.5), {'*': Face(iron(3), 'valve')})
    g.box('riser', (1.5, 9, 3), (2.5, 10, 4.5), {'sides': Face(iron(4), 'stem')})
    g.box('riser', (-0.5, 7, 2.5), (4.5, 12, 3), {'north': Face(wheel, 'wheel'), 'south': Face(wheel, 'wheel')})
    out.geo(g, {'geometry.fnar.cellar_pipes': (['run'], (0, 0, 0)), 'geometry.fnar.cellar_pipes_riser': (['riser'], (0, 0, 0))})
    out.tex('cellar_pipes', g.paint())
    blk = block_json('cellar_pipes', geometry='geometry.fnar.cellar_pipes', materials=mi_set('cellar_pipes'),
                     states={'fnar:kind': [0, 1]}, collision=False, selection=box(-5.5, 10.5, -8, 5.5, 16, 8), map_color='#3f362e', destroy=1.5,
                     perms=[(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.cellar_pipes_riser',
                                                  'minecraft:selection_box': box(-5.5, 0, 2.5, 5.5, 16, 8)})])
    out.block('cellar_pipes', blk)


# =============================================================== the Other Office's dead controls
@prop
def dead_button(out):
    """What is left of a door / light button in the Other Office: a rusted plate, a cracked cap (fnar:kind 0,
    the door's red one) or an empty socket (1, the light's), a wire hanging out. Does nothing: not a control."""
    g = Geo('dead_button', 16, 16)

    def plate(r):
        r.fill(STEEL, 1, amp=0.6, white_amp=0.4)
        r.bevel(1, -1)
        r.stain(RUST, 2, 1.5, 6, 1.6, 2.2, seed=1, p=0.85)
        r.stain(RUST, 3, 4.5, 1.5, 1.4, 1.0, seed=2, p=0.8)
        r.px(0, 0, RUST, 4); r.px(r.w - 1, r.h - 1, RUST, 1)
        r.darken_noise(0.35, -1, bottom=0.7)

    def cap(r):
        if r.variant == 'door':
            r.fill(RED, 1, amp=0.4, white_amp=0.3)
            r.bevel(1, -1)
            for (x, y) in ((1, 0), (1, 1), (2, 2), (2, 3), (1, 4)):  # cracked across
                r.px(x, y, INK, 1)
        else:
            r.fill(INK, 1, amp=0.3)  # the cap is gone: an empty socket, two contacts
            r.frame_rect(0, 0, r.w, r.h, WHITE, 1)
            if r.w >= 3 and r.h >= 3:
                r.px(1, 1, OLDBRASS, 3); r.px(r.w - 2, r.h - 2, OLDBRASS, 2)
        r.speck(DUST, 2, 0.1)

    wire = panel(GRIME, 1, amp=0.3, bevel=None)
    g.box('plate', (-3, 4, 7), (3, 12, 8), {'north': plate, 'sides': Face(panel(STEEL, 1, bevel=None), 'pe'), 'ends': Face(panel(STEEL, 1, bevel=None), 'pt')})
    g.box('cap', (-1.5, 6.5, 6), (1.5, 11.5, 7), {'north': cap, 'sides': Face(panel(BLACK, 2, bevel=None), 'cs'), 'ends': Face(panel(BLACK, 2, bevel=None), 'ct')})
    g.box('wire', (-0.25, 1, 7.5), (0.25, 4, 8), {'north': Face(wire, 'w'), 'east': Face(wire, 'w'), 'west': Face(wire, 'w'), 'down': Face(panel(COPPERPIPE, 4, bevel=None), 'wd')})
    g.box('wire', (1, 2.5, 7.5), (1.5, 4, 8), {'north': Face(wire, 'w2'), 'east': Face(wire, 'w2'), 'west': Face(wire, 'w2'), 'down': Face(panel(COPPERPIPE, 4, bevel=None), 'wd')})
    out.geo(g)
    out.tex('dead_button', g.paint('door'))
    out.tex('dead_button_light', g.paint('light'))
    blk = block_json('dead_button', geometry='geometry.fnar.dead_button', materials=mi_set('dead_button'), states={'fnar:kind': [0, 1]},
                     collision=False, selection=box(-3, 1, 6, 3, 12, 8), map_color='#3b4046', destroy=1.0,
                     perms=[(bs('fnar:kind', 1), {'minecraft:material_instances': mi_set('dead_button_light')})])
    out.block('dead_button', blk)


@prop
def dead_monitor(out):
    """The Other Office's monitor. fnar:kind 0: its carcass on the desk, flat on its back, the tube smashed in
    (4 px tall: it hides nothing of the hall behind the desk); 1: a dead set standing upright, the glass cracked."""
    g = Geo('dead_monitor', 64, 64)
    case = lambda b=3, gr=0.35: panel(CASE, b, amp=0.6, white_amp=0.35, grime=gr)

    def smashed(r):  # the front, looking up at the ceiling: the bezel round a black hole, shards of glass in it
        case(3, 0.2)(r)
        for yy in range(2, r.h - 2):
            for xx in range(2, r.w - 2):
                r.px(xx, yy, INK, 0, h=-30)
        for (x, y, i) in ((3, 2, 4), (4, 3, 3), (2, 5, 4), (8, 7, 5), (9, 6, 3), (7, 3, 2), (5, 7, 3), (6, 5, 1), (3, 6, 2)):
            if x < r.w - 2 and y < r.h - 2:
                r.px(x, y, DEADGLASS, i)
        r.px(1, 1, CASE, 5); r.px(r.w - 2, r.h - 2, CASE, 0)
        r.speck(DUST, 3, 0.12)

    def side(r):
        case(2)(r)
        for x in range(1, r.w - 1, 2):
            r.px(x, 1, CASE, 0)
        r.darken_noise(0.3, -1, bottom=0.8)

    def screen(r):  # upright and dead: black glass, a crack from one corner, thick dust
        case(2, 0.3)(r)
        r.rect(2, 2, r.w - 4, r.h - 4, DEADGLASS, 1)
        for (x, y) in ((2, 2), (3, 3), (4, 3), (5, 4), (5, 5), (6, 6), (4, 4), (3, 5)):
            r.px(x, y, DEADGLASS, 5)
        for x in range(2, r.w - 2):
            r.px(x, r.h - 3, DUST, 1)
            if x % 3:
                r.px(x, r.h - 4, DUST, 0)

    # ---- kind 0: flat on its back
    g.box('flat', (-6, 0, -5), (6, 4, 5), {'up': smashed, 'sides': Face(side, 'fs')})
    g.box('flat', (-0.5, 0, 5), (0.5, 1, 8), {'up': Face(panel(BLACK, 1, bevel=None), 'cab'), 'east': Face(panel(BLACK, 1, bevel=None), 'cabs'), 'west': Face(panel(BLACK, 1, bevel=None), 'cabs')})
    # ---- kind 1: upright
    g.bone('up')
    g.box('up', (-4, 0, -3), (4, 1, 4), {'sides': Face(case(2), 'st'), 'up': Face(case(2), 'stu')})
    g.box('up', (-6, 1, -6), (6, 11, 0), {'north': screen, 'south': Face(case(2), 'ub'), 'east': Face(side, 'us'), 'west': Face(side, 'us'),
                                          'up': Face(panel(CASE, 3, grime=0.5, grime_bottom=0), 'ut'), 'down': Face(case(1), 'ud')})
    g.box('up', (-4, 2, 0), (4, 9, 5), {'south': Face(case(1), 'bk'), 'east': Face(case(2), 'bks'), 'west': Face(case(2), 'bks'),
                                        'up': Face(case(2), 'bkt'), 'down': Face(case(1), 'bkd')})
    out.geo(g, {'geometry.fnar.dead_monitor': (['flat'], (0, 0, 0)), 'geometry.fnar.dead_monitor_up': (['up'], (0, 0, 0))})
    out.tex('dead_monitor', g.paint())
    blk = block_json('dead_monitor', geometry='geometry.fnar.dead_monitor', materials=mi_set('dead_monitor'), states={'fnar:kind': [0, 1]},
                     collision=box(-6, 0, -5, 6, 4, 5), selection=box(-6, 0, -5, 6, 4, 5), map_color='#4d4737', destroy=1.0,
                     perms=[(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.dead_monitor_up',
                                                  'minecraft:collision_box': box(-6, 0, -6, 6, 11, 5), 'minecraft:selection_box': box(-6, 0, -6, 6, 11, 5)})])
    out.block('dead_monitor', blk)


# =============================================================== the supper club's tables and chairs
@prop
def club_table(out):
    """A round supper table under what is left of its cloth: grey, stained, hanging in rags; a dead candle lamp."""
    g = Geo('club_table', 64, 64)

    def cloth_top(r):
        r.fill(OLDCLOTH, 3, amp=0.6, white_amp=0.35, cell=4)
        for c in range(r.w):
            for rr in range(r.h):
                x, _, z = r.world(c, rr)
                d = math.hypot(x, z)
                if 3.2 < d < 4.2 and (c + rr) % 3:
                    r.px(c, rr, WATERSTAIN, 2)  # the ring a bottle left
                if (x - 3) ** 2 + (z + 2) ** 2 < 3.5:
                    r.px(c, rr, INK, 1, h=-20)  # rotted through: the dark wood under it
        r.darken_noise(0.3, -1, cell=3)
        r.speck(DUST, 3, 0.08)

    def skirt(r):
        r.fill(OLDCLOTH, 2, amp=0.6, white_amp=0.35, streak='v')
        r.hline(0, 0, r.w, OLDCLOTH, 4)
        for c in range(r.w):  # the hem hangs in rags
            cut = (c * 7 + r.w * 3 + (0 if r.face in ('north', 'south') else 2)) % 5
            for k in range(min(r.h - 1, cut // 2 + (1 if c % 4 == 0 else 0))):
                r.px(c, r.h - 1 - k, None)
        r.darken_noise(0.4, -1, bottom=0.9)
        r.speck(MOULD, 2, 0.04)

    wood = lambda b=2: panel(ROTWOOD, b, amp=0.5, bevel=None, streak='v')
    Y0, Y1 = 8, 13
    parts = [((-4, -7), (4, 7), ('north', 'south')), ((-7, -4), (-4, 4), ('north', 'south', 'west')), ((4, -4), (7, 4), ('north', 'south', 'east')),
             ((-6, -6), (-4, -4), ('north', 'west')), ((4, -6), (6, -4), ('north', 'east')), ((-6, 4), (-4, 6), ('south', 'west')), ((4, 4), (6, 6), ('south', 'east'))]
    for i, ((x0, z0), (x1, z1), sides) in enumerate(parts):
        faces = {'up': cloth_top}
        for s in sides:
            faces[s] = Face(skirt, f'sk{int(abs(x1 - x0) if s in ("north", "south") else abs(z1 - z0))}')
        g.box('table', (x0, Y0, z0), (x1, Y1, z1), faces, name=f'top{i}')
    g.box('table', (-5, 11.5, -5), (5, 12.5, 5), {'down': Face(wood(1), 'under')})
    g.box('table', (-1, 1, -1), (1, 11.5, 1), {'sides': Face(wood(2), 'ped')})
    g.box('table', (-4, 0, -4), (4, 1, 4), {'sides': Face(wood(1), 'foot'), 'up': Face(wood(2), 'footu')})
    g.box('lamp', (-1, 13, -1), (1, 15, 1), {'sides': Face(panel(BOTTLE_A, 2, amp=0.4, bevel=(1, -1)), 'lamp'), 'up': Face(panel(BOTTLE_A, 1, bevel=None), 'lampu')})
    g.box('lamp', (-0.5, 15, -0.5), (0.5, 15.75, 0.5), {'*': Face(panel(OLDBRASS, 3, bevel=None), 'lampt')})
    out.geo(g)
    out.tex('club_table', g.paint())
    blk = block_json('club_table', geometry='geometry.fnar.club_table', materials=mi_set('club_table'), facing=False,
                     collision=box(-7, 0, -7, 7, 13, 7), selection=box(-7, 0, -7, 7, 16, 7), map_color='#585348', destroy=1.5)
    out.block('club_table', blk)


def _tip(frm, to):
    """An upright chair's box, tipped over backwards: up -> south, north -> up."""
    (x0, y0, z0), (x1, y1, z1) = frm, to
    return (x0, -z1 + 5, y0 - 8), (x1, -z0 + 5, y1 - 8)


TIP_FACE = {'up': 'south', 'down': 'north', 'north': 'up', 'south': 'down', 'east': 'east', 'west': 'west'}


@prop
def club_chair(out):
    """The supper club's chair: gilt wood, a round back, a red velvet seat gone bald. fnar:fallen: on its back."""
    g = Geo('club_chair', 32, 32)
    gilt = lambda b=3: panel(DULLGOLD, b, amp=0.5, white_amp=0.35, bevel=None, grime=0.35)

    def seat(r):
        r.fill(CARPETRED, 4, amp=0.5, white_amp=0.4)
        r.bevel(1, -1)
        r.stain(GRIME, 2, r.w * 0.6, r.h * 0.5, 2.0, 1.6, seed=1, p=0.7)  # worn bald
        r.frame_rect(0, 0, r.w, r.h, DULLGOLD, 2)
        r.speck(DUST, 2, 0.08)

    def back(r):
        gilt(3)(r)
        r.bevel(1, -1)
        for y in range(2, r.h - 1):
            for x in range(2, r.w - 2):
                r.px(x, y, CARPETRED, 2 + (x + y) % 2)
        r.px(2, 2, DULLGOLD, 3); r.px(r.w - 3, 2, DULLGOLD, 3)  # the pad's rounded corners
        r.px(r.w // 2, 4, INK, 1); r.px(r.w // 2 + 1, 5, INK, 1)  # a split
        r.darken_noise(0.3, -1)

    def build(bone, tip):
        def add(frm, to, faces):
            if tip:
                frm, to = _tip(frm, to)
                faces = {(k if k in ('sides', 'ends', '*') else TIP_FACE[k]): v for k, v in faces.items()}
            g.box(bone, frm, to, faces)
        for x in (-4.5, 3.5):
            for z in (-4.5, 3.5):
                add((x, 0, z), (x + 1, 7, z + 1), {'north': Face(gilt(2), 'leg'), 'south': Face(gilt(2), 'leg'), 'east': Face(gilt(2), 'leg'), 'west': Face(gilt(2), 'leg'), 'down': Face(gilt(1), 'legd')})
        add((-5, 7, -5), (5, 9, 5), {'up': Face(seat, 'seat'), 'down': Face(gilt(1), 'seatd'), 'north': Face(gilt(3), 'sf'), 'south': Face(gilt(2), 'sf'),
                                     'east': Face(gilt(3), 'sf'), 'west': Face(gilt(3), 'sf')})
        for x in (-4.5, 3.5):
            add((x, 9, 4), (x + 1, 11, 5), {'north': Face(gilt(3), 'post'), 'south': Face(gilt(2), 'post'), 'east': Face(gilt(3), 'post'), 'west': Face(gilt(3), 'post')})
        add((-5, 11, 4), (5, 16, 5), {'north': Face(back, 'back'), 'south': Face(back, 'back'), 'east': Face(gilt(3), 'be'), 'west': Face(gilt(3), 'be'),
                                      'up': Face(gilt(4), 'bt'), 'down': Face(gilt(1), 'bt')})

    build('chair', False)
    g.bone('fallen')
    build('fallen', True)
    out.geo(g, {'geometry.fnar.club_chair': (['chair'], (0, 0, 0)), 'geometry.fnar.club_chair_fallen': (['fallen'], (0, 0, 0))})
    out.tex('club_chair', g.paint())
    blk = block_json('club_chair', geometry='geometry.fnar.club_chair', materials=mi_set('club_chair'), states={'fnar:fallen': [False, True]},
                     collision=box(-5, 0, -5, 5, 9, 5), selection=box(-5, 0, -5, 5, 16, 5), map_color='#644c18', destroy=1.0,
                     perms=[(bs('fnar:fallen', True), {'minecraft:geometry': 'geometry.fnar.club_chair_fallen',
                                                       'minecraft:collision_box': box(-5, 0, -8, 5, 3, 8), 'minecraft:selection_box': box(-5, 0, -8, 5, 10, 8)})])
    out.block('club_chair', blk)


# =============================================================== the fallen chandelier
@prop
def fallen_chandelier(out):
    """The Gold Room's chandelier where it came down on the dance floor: a brass stem and four arms lying over
    on one side, dead candles, crystal drops, links of its chain. Bigger than its cell (about 24 px across)."""
    g = Geo('fallen_chandelier', 64, 64)
    brass = lambda b=3: panel(OLDBRASS, b, amp=0.6, white_amp=0.35, bevel=None, grime=0.3)

    def brass_v(r):
        brass(3)(r)
        r.stain(VERDIGRIS, 2, r.w * 0.5, r.h * 0.4, 1.0, 1.6, seed=1, p=0.7)

    def crystal(r):
        r.fill(CRYSTAL, 3, amp=0.9, white_amp=0.8, cell=2)
        r.px(0, 0, CRYSTAL, 5)

    def candle(r):
        r.fill(IVORY, 3, amp=0.4, white_amp=0.3)
        if r.face not in ('up', 'down'):
            r.px(0, 0, INK, 2)  # the burnt wick end
            r.px(r.w - 1, 1, IVORY, 5)  # a run of wax

    P = (2.5, 1.2, 0)  # the pivot: its bottom finial, on the floor
    g.bone('chandelier', pivot=P, rotation=(6, 0, 35))

    def add(frm, to, faces, name=None):
        g.box('chandelier', tuple(a + b for a, b in zip(frm, P)), tuple(a + b for a, b in zip(to, P)), faces, name=name)

    add((-1.5, 0, -1.5), (1.5, 2, 1.5), {'*': Face(brass(4), 'ball')})
    add((-1, 2, -1), (1, 14, 1), {'sides': Face(brass_v, 'stem')})
    add((-2, 4, -2), (2, 7, 2), {'*': Face(brass(3), 'hub')})
    add((-1.5, 13, -1.5), (1.5, 14.5, 1.5), {'*': Face(brass(2), 'cap')})
    for i, (dx, dz) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
        if dx:
            a, b = (2 * dx, 5, -0.5), (10 * dx, 6, 0.5)
        else:
            a, b = (-0.5, 5, 2 * dz), (0.5, 6, 10 * dz)
        lo = tuple(min(p, q) for p, q in zip(a, b)); hi = tuple(max(p, q) for p, q in zip(a, b))
        add(lo, hi, {'*': Face(brass(3), 'armx' if dx else 'armz')})
        cx, cz = 10 * dx, 10 * dz
        add((cx - 1, 6, cz - 1), (cx + 1, 7, cz + 1), {'*': Face(brass(4), 'cup')})
        if i != 1:  # one candle snapped off in the fall
            add((cx - 0.5, 7, cz - 0.5), (cx + 0.5, 10, cz + 0.5), {'sides': Face(candle, 'candle'), 'up': Face(candle, 'candleu')})
        add((cx - 0.5, 3, cz - 0.5), (cx + 0.5, 5, cz + 0.5), {'*': Face(crystal, 'drop')})
    for (x, z) in ((5, 5), (-5, 5), (5, -5), (-5, -5)):
        add((x - 0.5, 4, z - 0.5), (x + 0.5, 6, z + 0.5), {'*': Face(crystal, 'drop2')})
        add((x - 0.25, 6, z - 0.25), (x + 0.25, 7.5, z + 0.25), {'sides': Face(brass(2), 'link')})
    # ---- what lies round it on the floor: the snapped candle, crystals, the chain
    g.bone('debris')
    g.box('debris', (-11, 0, 4), (-8, 1, 5), {'*': Face(candle, 'cfl')})
    for (x, z) in ((-6, -7), (5, 8), (9, -4), (-2, 9), (11, 3)):
        g.box('debris', (x, 0, z), (x + 1, 1, z + 1), {'*': Face(crystal, 'drop3')})
    for k, (x, z) in enumerate(((-9, -3), (-10.5, -5), (-12, -7.5))):
        g.box('debris', (x, 0, z), (x + 1, 1, z + 2.5), {'*': Face(brass(2), 'chain')}, rotation=(0, 30, 0))
    out.geo(g)
    out.tex('fallen_chandelier', g.paint())
    blk = block_json('fallen_chandelier', geometry='geometry.fnar.fallen_chandelier', materials=mi_set('fallen_chandelier'),
                     collision=box(-8, 0, -8, 8, 6, 8), selection=box(-8, 0, -8, 8, 14, 8), map_color='#644c1f', destroy=2.0)
    out.block('fallen_chandelier', blk)


# =============================================================== the bar
@prop
def bar_bottles(out):
    """fnar:kind 0: a row of dusty bottles (the back bar); 1: what was left on the counter, glasses, an ashtray,
    a bottle on its side."""
    g = Geo('bar_bottles', 32, 32)

    def glass(mat, base=3):
        def p(r):
            r.fill(mat, base, amp=0.5, white_amp=0.3)
            if r.face not in ('up', 'down'):
                r.vline(0, 0, r.h, mat, min(mat.n - 1, base + 2))  # a highlight down one edge
                if r.h >= 4:
                    r.rect(0, r.h // 2, r.w, max(1, r.h // 4), OLDPAPER, 2 + (r.w + r.h) % 2)  # what is left of a label
                r.hline(0, r.h - 1, r.w, mat, 1)
            else:
                r.fill(DUST, 1, amp=0.4)
        return p

    row = [(-6, 6, BOTTLE_G), (-3, 8, BOTTLE_A), (0, 5, BOTTLE_C), (3, 7, BOTTLE_G), (6, 6, BOTTLE_A)]
    for i, (cx, h, m) in enumerate(row):
        z = 4 if i % 2 else 3
        g.box('row', (cx - 1, 0, z), (cx + 1, h, z + 2), {'sides': Face(glass(m), f'b{h}{m.name}'), 'up': Face(glass(m), f'bu{m.name}')}, name=f'bot{i}')
        g.box('row', (cx - 0.5, h, z + 0.5), (cx + 0.5, h + 2.5, z + 1.5), {'sides': Face(glass(m, 2), f'n{m.name}'), 'up': Face(panel(OLDBRASS, 2, bevel=None), 'cork')}, name=f'neck{i}')
    g.bone('bar')
    for i, (x, z) in enumerate(((-5, -3), (1, -5), (4, 1))):
        g.box('bar', (x, 0, z), (x + 2, 2.5, z + 2), {'sides': Face(glass(BOTTLE_C, 2), 'tumbler'), 'up': Face(glass(BOTTLE_C), 'tumbleru')}, name=f'gl{i}')
    g.box('bar', (-2, 0, 2), (2, 1, 6), {'sides': Face(panel(BOTTLE_C, 1, bevel=None), 'ash'), 'up': Face(panel(DUST, 1, amp=0.6, bevel=(1, -1)), 'ashu')})
    g.box('bar', (-7, 0, 4), (-2, 2, 6), {'north': Face(glass(BOTTLE_G), 'lyn'), 'south': Face(glass(BOTTLE_G), 'lyn'), 'up': Face(glass(BOTTLE_G, 4), 'lyu'),
                                         'east': Face(glass(BOTTLE_G, 2), 'lye'), 'west': Face(glass(BOTTLE_G, 2), 'lye')}, name='lying')
    g.box('bar', (-9.5, 0.5, 4.5), (-7, 1.5, 5.5), {'sides': Face(glass(BOTTLE_G, 2), 'lyneck'), 'ends': Face(glass(BOTTLE_G, 2), 'lyneck2')}, name='lyneck')
    out.geo(g, {'geometry.fnar.bar_bottles': (['row'], (0, 0, 0)), 'geometry.fnar.bar_bottles_bar': (['bar'], (0, 0, 0))})
    out.tex('bar_bottles', g.paint())
    blk = block_json('bar_bottles', geometry='geometry.fnar.bar_bottles', materials=mi_set('bar_bottles'), states={'fnar:kind': [0, 1]},
                     collision=False, selection=box(-7, 0, -6, 7, 10, 6), map_color='#244c2e', destroy=0.5,
                     perms=[(bs('fnar:kind', 1), {'minecraft:geometry': 'geometry.fnar.bar_bottles_bar'})])
    out.block('bar_bottles', blk)


# =============================================================== the flooded corner
@prop
def flood_water(out):
    """Black standing water, 12 px up the cell (the floor under it has sunk a block): no collision, you wade in."""
    g = Geo('flood_water', 16, 16)

    def water(r):
        r.fill(BLACKWATER, 2, amp=0.9, white_amp=0.3, cell=6)
        for (x, y, n) in ((2, 3, 4), (9, 6, 5), (5, 11, 3), (11, 13, 3)):  # slow ripples catching what light there is
            r.hline(x, y, n, BLACKWATER, 5)
            r.px(x + n, y + 1, BLACKWATER, 4)
        for (x, y) in ((13, 2), (14, 2), (13, 3), (3, 8), (7, 14), (8, 14)):  # scum, a floating scrap of paper
            r.px(x, y, SCUM, 2 + (x + y) % 2)
        r.px(10, 10, OLDPAPER, 2); r.px(11, 10, OLDPAPER, 1)

    g.box('water', (-8, 12, -8), (8, 12, 8), {'up': water})
    out.geo(g)
    out.tex('flood_water', g.paint())
    blk = block_json('flood_water', geometry='geometry.fnar.flood_water', materials=mi_set('flood_water'), facing=False,
                     collision=False, selection=box(-8, 11, -8, 8, 12, 8), map_color='#080b0f', destroy=0.2)
    out.block('flood_water', blk)


# =============================================================== his paw prints
@prop
def floor_decal_paws(out):
    """Big dog's paw prints in gold dust (fnar:kind 0) or nearly gone (1); they walk towards the facing.
    The Golden Dog's gilding puts them on a hall floor for a moment (CELLAR.gild). Flat, no collision."""
    g = Geo('floor_decal_paws', 16, 16)
    PAW = ['.#.#.', '#.#.#', '.....', '.###.', '#####', '#####', '.###.']

    def paws(r):
        r.clear()
        faint = r.variant == 'faint'
        for (x0, y0) in ((1, 0), (9, 8)):
            for yy, row in enumerate(PAW):
                for xx, ch in enumerate(row):
                    if ch != '#' or (faint and (xx * 5 + yy * 3 + x0) % 3 == 0):
                        continue
                    r.px(x0 + xx, y0 + yy, DULLGOLD, (1 if faint else 3) + (xx + yy) % 2, metal=40 if faint else 120, rough=200 if faint else 120)
        if not faint:
            for (x, y) in ((7, 3), (8, 12), (2, 9), (13, 5)):
                r.px(x, y, DULLGOLD, 2, metal=60)  # dust shaken off

    g.box('decal', (-8, 0.1, -8), (8, 0.1, 8), {'up': paws})
    out.geo(g)
    out.tex('floor_decal_paws', g.paint('gold'))
    out.tex('floor_decal_paws_faint', g.paint('faint'))
    blk = block_json('floor_decal_paws', geometry='geometry.fnar.floor_decal_paws', materials=mi_set('floor_decal_paws'), states={'fnar:kind': [0, 1]},
                     collision=False, selection=box(-8, 0, -8, 8, 0.5, 8), map_color='#7f6221', destroy=0.2,
                     perms=[(bs('fnar:kind', 1), {'minecraft:material_instances': mi_set('floor_decal_paws_faint')})])
    out.block('floor_decal_paws', blk)
