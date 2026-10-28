"""Office props: door/light buttons, vent cover, CRT, desk fan, phone, clutter, plush,
security camera, show tape deck."""
from propkit import Geo, Face, Mat, prop, panel, seq, block_json, box, mi_set, glow, bs, pillar_views
from pal import *  # noqa: F403

WALL_VIEWS = [
    {'label': 'north', 'env': 'wall'},
    {'label': 'east (rot -90)', 'env': 'wall', 'states': {'minecraft:cardinal_direction': 'east'},
     'camera': {'pos': [2.0, 1.25, 1.2], 'target': [0, 0.45, 0]}},
]


# CRT casing: the beige ramp, as painted sheet metal (the brief lists the CRT frame under metalness)
CRT_CASE = Mat('crt_case', ['#433d31', '#575040', '#6c6451', '#817863', '#958b74', '#a69c84', '#b6ac92'], metal=110, rough=140, h=140, hk=3)


def views_states(state, values, env='floor', extra=None, label=None):
    v = [{'label': (label or '{}={}').format(state, val) if label is None else label.format(val), 'env': env,
          'states': {state: val}} for val in values]
    return v + (extra or [])


# =============================================================== door / light buttons
def _button(out, name, off, on, light, color):
    g = Geo(name, 16, 16)

    def plate_front(r):
        r.fill(STEEL, 3, amp=0.7, white_amp=0.4)
        r.bevel(1, -1)
        # collar shadow around the button footprint (rows 0-5) and a label strip + screws below
        for x in range(6):
            r.shift(x, 0, -1)
        for y in range(0, 6):
            r.shift(0, y, -1); r.shift(5, y, -2)
        r.rect(1, 5, 4, 1, IRON, 1)
        r.hline(1, 6, 4, PAPER, 3)
        r.px(2, 6, BLACK, 2); r.px(3, 6, BLACK, 3)
        r.px(0, 7, CHROME, 3); r.px(5, 7, CHROME, 2)
        r.darken_noise(0.25, -1, bottom=0.8)

    plate = panel(STEEL, 2, amp=0.6, grime=0.2)

    def btn(face_kind):
        def p(r):
            m = on if r.variant == 'on' else off
            if face_kind == 'front':
                r.fill(m, m.base + 1, amp=0.3, white_amp=0.25)
                r.bevel(1, -1)
                r.px(0, 0, m, m.n - 1)
                if r.variant != 'on':
                    r.speck(GRIME, 3, 0.12, only=m)
            else:
                r.fill(m, m.base - 1, amp=0.3, white_amp=0.2)
                if r.face in ('east', 'west', 'down'):
                    r.shade_rect(0, 0, r.w, r.h, -1)
        return p

    g.box('plate', (-3, 4, 7), (3, 12, 8), {'north': plate_front, 'south': Face(plate, 'pb'),
                                           'sides': Face(plate, 'pe'), 'ends': Face(plate, 'pt')})
    g.box('button', (-1.5, 6.5, 5), (1.5, 11.5, 7), {'north': btn('front'), 'east': Face(btn('side'), 'bs'),
                                                    'west': Face(btn('side'), 'bs'), 'up': Face(btn('top'), 'bt'),
                                                    'down': Face(btn('top'), 'bd')})
    for sx in (-1, 1):
        x0, x1 = (-2.5, -1.5) if sx < 0 else (1.5, 2.5)
        g.box('button', (x0, 7.5, 5.5), (x1, 10.5, 7), {'north': Face(btn('front'), 'bl'),
                                                       'east' if sx > 0 else 'west': Face(btn('side'), 'bls'),
                                                       'up': Face(btn('top'), 'blt'), 'down': Face(btn('top'), 'bld')})
    out.geo(g)
    out.tex(name, g.paint('off'))
    out.tex(f'{name}_on', g.paint('on'))
    blk = block_json(
        name, geometry=f'geometry.fnar.{name}', materials=mi_set(name),
        states={'fnar:on': [False, True]},
        collision=False, selection=box(-3, 4, 5, 3, 12, 8), map_color='#5a6168', destroy=1.0,
        perms=[(bs('fnar:on', True), {'minecraft:material_instances': mi_set(f'{name}_on'),
                                      'minecraft:light_emission': light})],
        extra={'fnar:control': {}})
    out.block(name, blk)
    out.light(name, color, 'static_light')
    f = {'env': 'wall', 'focus': [0, 0.5, 0.3], 'dist': 1.0}
    out.views(name, [{'label': 'off', 'states': {'fnar:on': False}, **f},
                     {'label': 'on', 'states': {'fnar:on': True}, **f},
                     {'label': 'on, facing east', 'states': {'fnar:on': True, 'minecraft:cardinal_direction': 'east'},
                      **f, 'focus': [-0.3, 0.5, 0], 'dir': [1, 0.5, -0.4]}] + pillar_views(extra_states={"fnar:on": True}, dist=3.0))


@prop
def door_button(out):
    _button(out, 'door_button', RED, RED_GLOW, 3, '#ff3a2a')


@prop
def light_button(out):
    _button(out, 'light_button', WHITE, WHITE_GLOW, 4, '#e8eeff')


# =============================================================== vent cover (in the ceiling)
@prop
def vent_cover(out):
    g = Geo('vent_cover', 64, 64)

    def frame_down(r):
        r.fill(GALV, 3, amp=0.6, white_amp=0.35)
        for c in range(r.w):
            for rr in range(r.h):
                x, _, z = r.world(c, rr)
                m = max(abs(x), abs(z))
                if m < 6.6:
                    r.shift(c, rr, -2)
                elif m > 7.4:
                    r.shift(c, rr, 1)
                if abs(abs(x) - 7) < 0.6 and abs(abs(z) - 7) < 0.6:
                    r.px(c, rr, CHROME, 2, h=10)
        r.darken_noise(0.3, -1, cell=2)

    def frame_side(r):
        r.fill(GALV, 2, amp=0.5)
        r.bevel(0, -1, t=False, l=False, r=False)

    def lining(r):
        r.fill(GALV, 3, amp=0.35, white_amp=0.3, cell=4)
        for c in range(r.w):
            for rr in range(r.h):
                _, y, _ = r.world(c, rr)
                r.shift(c, rr, -int((y - 2) // 4))  # darker deeper into the duct
        for c in range(r.w):  # lap seam with rivets
            r.shift(c, 6, -1)
            if c % 4 == 1:
                r.shift(c, 7, 2)
        r.darken_noise(0.15, -1, cell=3)
        r.speck(GRIME, 3, 0.08)

    def slat(kind):
        def p(r):
            if kind == 'down':
                r.fill(GALV, 4, amp=0.4, white_amp=0.3)
                r.speck(GRIME, 2, 0.15)
            elif kind == 'up':
                r.fill(GALV, 1, amp=0.4)
                r.speck(GRIME, 3, 0.35)
            else:
                r.fill(GALV, 2, amp=0.4)
                r.hline(0, r.h - 1, r.w, GALV, 4)
                r.darken_noise(0.3, -1)
        return p

    def hatch_down(r):
        r.fill(STEEL, 3, amp=0.4, white_amp=0.3)
        for c in range(r.w):
            for rr in range(r.h):
                if c < 2 or c >= r.w - 2 or rr < 2 or rr >= r.h - 2:  # hazard edge
                    k = ((c + rr) // 2) % 2
                    r.px(c, rr, YELLOW if k == 0 else BLACK, 5 if k == 0 else 2)
                elif c in (2, r.w - 3) or rr in (2, r.h - 3):
                    r.px(c, rr, STEEL, 2)
                elif (c + 2 * rr) % 4 == 0:  # diamond tread
                    r.px(c, rr, STEEL, 5, h=12)
                    r.px(c + 1, rr, STEEL, 1)
        r.darken_noise(0.3, -1, cell=2)
        r.speck(RUST, 2, 0.04)
        r.stain(RUST, lambda x, y: 1 + (x + y) % 3, 9.5, 3.5, 2.2, 1.5, p=0.6)

    def hatch_side(r):
        r.fill(YELLOW, 3, amp=0.4)
        for c in range(0, r.w, 4):
            r.vline(c, 0, r.h, BLACK, 2); r.vline(c + 1, 0, r.h, BLACK, 2)

    # frame flange (both states)
    fd, fs = Face(frame_down), Face(frame_side)
    g.box('frame', (-8, 0, -8), (8, 2, -6), {'down': fd, 'south': Face(frame_side, 'fsi'), 'north': fs, 'up': Face(slat('up'), 'fu')})
    g.box('frame', (-8, 0, 6), (8, 2, 8), {'down': fd, 'north': Face(frame_side, 'fsi'), 'south': fs, 'up': Face(slat('up'), 'fu')})
    g.box('frame', (-8, 0, -6), (-6, 2, 6), {'down': fd, 'east': Face(frame_side, 'fsi2'), 'west': fs, 'up': Face(slat('up'), 'fu2')})
    g.box('frame', (6, 0, -6), (8, 2, 6), {'down': fd, 'west': Face(frame_side, 'fsi2'), 'east': fs, 'up': Face(slat('up'), 'fu2')})
    # shaft lining, inner faces only
    g.box('lining', (-8, 2, -8), (8, 16, -7), {'south': Face(lining, 'l1'), 'up': Face(slat('up'), 'lu1')})
    g.box('lining', (-8, 2, 7), (8, 16, 8), {'north': Face(lining, 'l1'), 'up': Face(slat('up'), 'lu1')})
    g.box('lining', (-8, 2, -7), (-7, 16, 7), {'east': Face(lining, 'l2'), 'up': Face(slat('up'), 'lu2')})
    g.box('lining', (7, 2, -7), (8, 16, 7), {'west': Face(lining, 'l2'), 'up': Face(slat('up'), 'lu2')})
    # open: louvre slats + a centre spine
    for k in range(6):
        z0 = -5.5 + 2 * k
        g.box('slats', (-6, 0, z0), (6, 2, z0 + 1), {'down': Face(slat('down'), 'sd'), 'up': Face(slat('up'), 'su'),
                                                     'north': Face(slat('side'), 'ss'), 'south': Face(slat('side'), 'ss')})
    g.box('slats', (-0.5, 0.5, -6), (0.5, 1.5, 6), {'down': slat('down'), 'east': Face(slat('side'), 'sp'), 'west': Face(slat('side'), 'sp')})
    # closed: hatch plate
    g.box('hatch', (-6, 0, -6), (6, 2, 6), {'down': hatch_down, 'up': Face(slat('up'), 'hu'), 'sides': Face(hatch_side, 'hs')})
    out.geo(g, {'geometry.fnar.vent_cover': (['frame', 'lining', 'slats'], (0, 0, 0)),
                'geometry.fnar.vent_cover_closed': (['frame', 'lining', 'hatch'], (0, 0, 0))})
    out.tex('vent_cover', g.paint())
    blk = block_json('vent_cover', geometry='geometry.fnar.vent_cover', materials=mi_set('vent_cover'),
                     states={'fnar:closed': [False, True]}, facing=False,
                     collision=box(-8, 0, -8, 8, 2, 8), selection=box(-8, 0, -8, 8, 2, 8),
                     map_color='#6e747b', destroy=2.0,
                     perms=[(bs('fnar:closed', True), {'minecraft:geometry': 'geometry.fnar.vent_cover_closed'})])
    out.block('vent_cover', blk)
    cam = {'pos': [0.9, -1.3, -1.25], 'target': [0, 0.15, 0]}
    out.views('vent_cover', [{'label': 'open (from below)', 'env': 'ceiling', 'states': {'fnar:closed': False}, 'camera': cam, 'keyLight': [-1.5, -3, -2.5]},
                             {'label': 'closed (from below)', 'env': 'ceiling', 'states': {'fnar:closed': True}, 'camera': cam, 'keyLight': [-1.5, -3, -2.5]},
                             {'label': 'open (from the duct)', 'env': 'floor', 'states': {'fnar:closed': False}, 'camera': {'pos': [0.7, 1.9, -0.9], 'target': [0, 0.1, 0]}}])


# =============================================================== CRT monitor
@prop
def crt_monitor(out):
    g = Geo('crt_monitor', 64, 64)
    shell = lambda base=3, grime=0.3: panel(CRT_CASE, base, amp=0.6, white_amp=0.35, grime=grime)

    def screen(r):
        on = r.variant == 'on'
        # visible window: cols 2..9, rows 2..7 of the 12x10 body front
        r.fill(BEIGE, 1, amp=0.3)
        win = (2, 2, 8, 6)
        if on:
            r.fill(STATIC, 4, amp=0.5, white_amp=1.6, cell=4, rect=win)
            for c in range(2, 10):
                for rr in range(2, 8):
                    if rr % 2 == 1:
                        r.shift(c, rr, -1)
                    if (c in (2, 9)) and (rr in (2, 7)):
                        r.shift(c, rr, -2)
                    elif c in (2, 9) or rr in (2, 7):
                        r.shift(c, rr, -1)
            r.hline(3, 4, 4, STATIC, 7)  # rolling bright band fragment
        else:
            r.fill(GLASS_OFF, 2, amp=0.4, white_amp=0.4, rect=win)
            for c, rr, i in ((3, 2, 5), (2, 3, 5), (4, 2, 4), (2, 4, 4), (3, 3, 3), (8, 7, 3)):
                r.px(c, rr, GLASS_OFF, i)
            for c in range(2, 10):
                r.shift(c, 7, -1)
        return

    def bezel_bottom_front(r):
        shell(3, 0.2)(r)
        r.hline(1, 1, 3, BEIGE, 1)  # badge
        r.px(2, 1, CHROME, 3)
        r.px(9, 1, BEIGE, 5); r.px(10, 1, BEIGE, 0)  # power button + gap
        if r.variant == 'on':
            r.px(8, 1, LED_GREEN, 0)
        else:
            r.px(8, 1, LED_OFF_G, 0)
        r.px(10, 0, BEIGE, 1)

    def body_side(r):
        shell(3)(r)
        for rr in range(2, 8, 2):  # vent slots toward the back
            r.hline(0, rr, 3, BEIGE, 0) if r.face == 'west' else r.hline(r.w - 3, rr, 3, BEIGE, 0)

    def back_top(r):
        shell(3, 0.4)(r)
        for c in range(1, r.w - 1, 2):
            r.vline(c, 0, r.h - 1, BEIGE, 0)
        r.speck(GRIME, 3, 0.2)

    def stand(r):
        panel(BEIGE, 2, amp=0.5, grime=0.4)(r)

    g.box('stand', (-4, 0, -3), (4, 1, 4), {'sides': Face(stand, None), 'up': stand})
    g.box('body', (-6, 1, -5), (6, 11, 0), {'north': Face(screen, mi='screen'), 'south': shell(), 'east': Face(body_side), 'west': Face(body_side),
                                            'up': panel(BEIGE, 3, grime=0.5, grime_bottom=0), 'down': shell(2)})
    g.box('bezel', (-6, 9, -6), (6, 11, -5), {'north': shell(4, 0.15), 'east': Face(shell(3), 'b1'), 'west': Face(shell(3), 'b1'),
                                              'up': Face(shell(4), 'b2'), 'down': Face(panel(BEIGE, 1), 'b3')})
    g.box('bezel', (-6, 1, -6), (6, 3, -5), {'north': bezel_bottom_front, 'east': Face(shell(3), 'b1'), 'west': Face(shell(3), 'b1'),
                                             'up': Face(panel(BEIGE, 2), 'b4'), 'down': Face(shell(2), 'b5')})
    for x0, x1, inner in ((-6, -4, 'east'), (4, 6, 'west')):
        g.box('bezel', (x0, 3, -6), (x1, 9, -5), {'north': Face(shell(4, 0.15), 'bs'), inner: Face(panel(BEIGE, 1), 'bi'),
                                                  ('west' if inner == 'east' else 'east'): Face(shell(3), 'bo')})
    g.box('back', (-5, 2, 0), (5, 10, 3), {'south': shell(3, 0.4), 'east': Face(shell(3), 'k1'), 'west': Face(shell(3), 'k1'),
                                          'up': back_top, 'down': shell(2)})
    g.box('back', (-3, 3, 3), (3, 9, 6), {'south': shell(2, 0.5), 'east': Face(shell(2), 'k2'), 'west': Face(shell(2), 'k2'),
                                         'up': back_top, 'down': shell(1)})
    out.geo(g)
    out.tex('crt_monitor', g.paint('off'))
    out.tex('crt_monitor_on', g.paint('on'))
    mi_off = mi_set('crt_monitor', {'screen': 'crt_monitor'})
    mi_on = mi_set('crt_monitor_on', {'screen': glow('crt_monitor_on')})
    blk = block_json('crt_monitor', geometry='geometry.fnar.crt_monitor', materials=mi_off,
                     states={'fnar:on': [False, True]},
                     collision=box(-6, 0, -6, 6, 11, 6), selection=box(-6, 0, -6, 6, 11, 6), map_color='#817863',
                     perms=[(bs('fnar:on', True), {'minecraft:material_instances': mi_on, 'minecraft:light_emission': 3})])
    out.block('crt_monitor', blk)
    out.light('crt_monitor', '#7ad6c0', 'point_light')
    f = {'focus': [0, 0.35, 0], 'dist': 1.7}
    out.views('crt_monitor', [{'label': 'off', 'states': {'fnar:on': False}, **f}, {'label': 'on', 'states': {'fnar:on': True}, **f},
                              {'label': 'on, back (facing west)', 'states': {'fnar:on': True, 'minecraft:cardinal_direction': 'west'}, **f}])


# =============================================================== desk fan
def _blades(r):
    """Spinning 3-blade motion blur; frame k is rotated by 30 deg (3-fold symmetry -> seamless 4-frame loop)."""
    import math
    r.clear()
    k = r.frame
    cx, cy = r.w / 2, r.h / 2
    for c in range(r.w):
        for rr in range(r.h):
            dx, dy = c + 0.5 - cx, rr + 0.5 - cy
            d = math.hypot(dx, dy)
            if d > 4.8:
                continue
            if d < 1.2:
                r.px(c, rr, IRON, 3)
                continue
            a = (math.degrees(math.atan2(dy, dx)) - k * 30) % 120
            if a < 40:  # blade (leading edge bright)
                r.px(c, rr, GREYPLAST, 5 if a < 12 else 4)
            elif a < 85 and (c + rr + k) % 2 == 0:  # blur trail, dithered for alpha_test
                r.px(c, rr, GREYPLAST, 3 if a < 62 else 2)


@prop
def desk_fan(out):
    import math
    g = Geo('desk_fan', 32, 32)
    paint = lambda base=2, grime=0.3: panel(IRON, base, amp=0.5, white_amp=0.35, grime=grime)

    def grille(r):
        r.clear()
        cx, cy = r.w / 2, r.h / 2
        for c in range(r.w):
            for rr in range(r.h):
                dx, dy = c + 0.5 - cx, rr + 0.5 - cy
                d = math.hypot(dx, dy)
                wire = abs(d - 2.9) < 0.5 or ((abs(dx) < 0.5 or abs(dy) < 0.5) and 1.0 < d < 4.6)
                if wire:
                    r.px(c, rr, CHROME, 3 if (c * 7 + rr * 3) % 5 else 2)

    def motor_front(r):
        paint(1, 0.0)(r)
        r.disc(r.w / 2, r.h / 2, 1.0, IRON, 3)

    def base_top(r):
        paint(2, 0.2)(r)
        r.rect(2, 0, 2, 2, IRON, 0)  # switch slot
        r.hline(1, 4, 4, CHROME, 2)  # badge strip

    def badge(r):
        r.fill(CHROME, 3, amp=0.3); r.bevel(1, -1); r.px(0, 0, CHROME, 5)

    g.box('base', (-3, 0, -3), (3, 2, 2), {'sides': paint(2), 'up': base_top})
    g.box('base', (-0.5, 2, -2.5), (0.5, 3, -1.5), {'sides': Face(panel(BEIGE, 4, bevel=None), 'knob'), 'up': Face(panel(BEIGE, 5, bevel=None), 'knobt')})
    g.box('neck', (-0.5, 2, 0.5), (0.5, 9, 1.5), {'sides': Face(panel(CHROME, 3, amp=0.3, streak='v', bevel=None), 'neck')})
    g.box('motor', (-2, 9, 0), (2, 13, 3), {'north': motor_front, 'south': paint(2), 'east': Face(paint(2), 'm1'), 'west': Face(paint(2), 'm1'),
                                            'up': paint(3, 0.5), 'down': paint(1)})
    rim = lambda: Face(paint(3, 0.2), 'rim')
    rimv = lambda: Face(paint(3, 0.2), 'rimv')
    rimd = lambda: Face(paint(3, 0.2), 'rimd')
    g.box('cage', (-2, 15, -3), (2, 16, 0), {'up': rimd(), 'down': rimd(), 'north': rim(), 'south': rim()})
    g.box('cage', (-2, 6, -3), (2, 7, 0), {'up': rimd(), 'down': rimd(), 'north': rim(), 'south': rim()})
    g.box('cage', (-5, 9, -3), (-4, 13, 0), {'east': rimv(), 'west': rimv(), 'north': Face(paint(3), 'rimn'), 'south': Face(paint(3), 'rimn')})
    g.box('cage', (4, 9, -3), (5, 13, 0), {'east': rimv(), 'west': rimv(), 'north': Face(paint(3), 'rimn'), 'south': Face(paint(3), 'rimn')})
    s2 = 0.5 / math.sqrt(2)
    for (cx, cy, rz) in ((3.5 - s2, 14.5 - s2, -45), (-3.5 + s2, 14.5 - s2, 45), (3.5 - s2, 7.5 + s2, 45), (-3.5 + s2, 7.5 + s2, -45)):
        L = 4.2
        g.box('cage', (cx - L / 2, cy - 0.5, -3), (cx + L / 2, cy + 0.5, 0),
              {'up': Face(paint(3, 0.2), 'diag'), 'down': Face(paint(3, 0.2), 'diag'), 'north': Face(paint(3), 'diagn'), 'south': Face(paint(3), 'diagn')},
              rotation=(0, 0, rz), pivot=(cx, cy, -1.5))
    g.box('cage', (-5, 6, -3), (5, 16, -3), {'north': grille})
    g.box('cage', (-5, 6, -1.5), (5, 16, -1.5), {'north': Face(_blades, mi='blades', flip=4)})
    g.box('cage', (-1, 10, -3.5), (1, 12, -3), {'north': badge, 'sides': Face(panel(CHROME, 2, bevel=None), 'hub')})
    out.geo(g)
    out.tex('desk_fan', g.paint())
    out.tex('fan_blades', [g.paint(frame=k, only_flip=True) for k in range(4)])
    out.flipbook('fan_blades', 1)
    blk = block_json('desk_fan', geometry='geometry.fnar.desk_fan',
                     materials=mi_set('desk_fan', {'blades': 'fan_blades'}),
                     collision=box(-5, 0, -3.5, 5, 16, 3), selection=box(-5, 0, -3.5, 5, 16, 3), map_color='#2a2e34', destroy=1.0)
    out.block('desk_fan', blk)
    f = {'focus': [0, 0.55, 0], 'dist': 1.6}
    out.views('desk_fan', [{'label': 'frame 0', **f}, {'label': 'frame 2 (front)', 'frame': 2, 'focus': [0, 0.65, 0], 'dist': 1.3, 'dir': [0.25, 0.15, -1]},
                           {'label': 'facing east', 'states': {'minecraft:cardinal_direction': 'east'}, **f}])


# =============================================================== desk phone
@prop
def desk_phone(out):
    """1980s multi-line office phone: handset front-to-back on the left, stepped keypad console on the right."""
    g = Geo('desk_phone', 32, 32)
    shell = lambda base=3, grime=0.3: panel(BEIGE, base, amp=0.5, white_amp=0.3, grime=grime)

    def keypad(r):  # up face of the low step: 5 x 3 (x -1..4, z -2.5..0.5 -> rows north..south)
        r.fill(BEIGE, 2, amp=0.2)
        for kx in range(3):
            for kz in range(3):
                r.px(1 + kx, kz, GREYPLAST, 4 if (kx + kz) % 2 == 0 else 2, h=8)
        r.px(0, 0, RED, 3)  # hold key
        r.px(4, 1, GREYPLAST, 3)

    def console_top(r):  # up face of the high step: 5 x 3 -> line keys row + speaker
        shell(3, 0.2)(r)
        for kx in range(4):
            r.px(kx, 0, BLACK, 3 if kx % 2 else 4, h=6)
        for kx in range(0, 4, 2):
            r.px(kx + 1, 2, BEIGE, 1)

    def step_front(r):  # vertical face between the steps (5 x 1): the red line-light strip
        lit = r.variant == 'ringing'
        r.fill(BEIGE, 2)
        for c in range(1, 4):
            r.px(c, 0, LED_RED if lit else LED_OFF_R, 0)

    def handset(kind):
        def p(r):
            panel(BEIGE, 2, amp=0.4, grime=0.2)(r)
            if kind == 'cup' and r.face == 'up':
                for c in range(r.w):
                    for rr in range(r.h):
                        if (c + rr) % 2 == 0 and 0 < c < r.w - 1 and 0 < rr < r.h - 1:
                            r.px(c, rr, BEIGE, 0)
        return p

    def cord(r):
        r.fill(BEIGE, 3, amp=0.2)
        for rr in range(r.h):
            if rr % 2:
                r.hline(0, rr, r.w, BEIGE, 1)

    g.box('base', (-4, 0, -3), (4, 2, 3), {'north': shell(2, 0.3), 'south': shell(2, 0.4), 'east': Face(shell(3), 'bs'),
                                          'west': Face(shell(3), 'bs'), 'up': shell(3, 0.2)})
    g.box('base', (-1, 2, -2.5), (4, 2.75, 0.5), {'up': keypad, 'north': Face(shell(3), 'k1'), 'east': Face(shell(2), 'k2'), 'west': Face(shell(2), 'k2')})
    g.box('base', (-1, 2, 0.5), (4, 3.5, 3), {'up': console_top, 'north': Face(shell(3), 'c1'), 'south': Face(shell(2), 'c1'),
                                             'east': Face(shell(2), 'c2'), 'west': Face(shell(2), 'c2')})
    g.box('base', (-0.5, 2.75, 0.4), (3.5, 3.25, 0.5), {'north': step_front})
    # handset lying front-to-back on the cradle (earpiece at the back, mouthpiece at the front)
    for z0 in (-3, 1):
        g.box('handset', (-4, 2, z0), (-1.5, 3.5, z0 + 2), {'sides': Face(handset('end'), 'hs'), 'up': Face(handset('cup'), 'hu')})
    g.box('handset', (-3.25, 2.75, -1), (-2.25, 3.75, 1), {'sides': Face(handset('grip'), 'gs'), 'up': Face(handset('grip'), 'gu')})
    g.box('cord', (-4.75, 0.25, -2.5), (-4, 2.5, -1.75), {'sides': Face(cord, 'cord'), 'ends': Face(cord, 'corde')})
    out.geo(g)
    out.tex('desk_phone', g.paint('idle'))
    out.tex('desk_phone_ringing', g.paint('ringing'))
    blk = block_json('desk_phone', geometry='geometry.fnar.desk_phone', materials=mi_set('desk_phone'),
                     states={'fnar:ringing': [False, True]},
                     collision=False, selection=box(-5, 0, -3, 5, 4, 3), map_color='#817863', destroy=1.0,
                     perms=[(bs('fnar:ringing', True), {'minecraft:material_instances': mi_set('desk_phone_ringing'),
                                                        'minecraft:light_emission': 2})])
    out.block('desk_phone', blk)
    out.light('desk_phone', '#ff3a2a', 'static_light')
    f = {'focus': [0, 0.12, 0], 'dist': 0.95}
    out.views('desk_phone', [{'label': 'idle', 'states': {'fnar:ringing': False}, **f}, {'label': 'ringing', 'states': {'fnar:ringing': True}, **f},
                             {'label': 'ringing, facing south', 'states': {'fnar:ringing': True, 'minecraft:cardinal_direction': 'south'}, **f}])


# =============================================================== desk clutter
@prop
def desk_clutter(out):
    g = Geo('desk_clutter', 32, 32)

    def paper(lines=True, ring=False):
        def p(r):
            r.fill(PAPER, 4, amp=0.4, white_amp=0.3)
            if lines and r.face == 'up':
                for rr in range(2, r.h - 1, 2):
                    n = r.w - 2 - (rr * 7 % 3)
                    r.hline(1, rr, n, PAPER, 1)
                r.hline(1, 0, 3, BLACK, 4)
            if ring:
                for c, rr in ((3, 4), (4, 4), (5, 5), (4, 7), (2, 6), (2, 5)):
                    r.px(c, rr, PAPER, 1)
            r.darken_noise(0.2, -1)
        return p

    def mug(r):
        if r.face == 'up':
            r.fill(CERAMIC, 5, amp=0.2)
            r.rect(1, 1, r.w - 2, r.h - 2, WOOD, 0); r.px(1, 1, WOOD, 2)
            return
        r.fill(CERAMIC, 4, amp=0.3)
        r.hline(0, 1, r.w, RED, 3)
        r.bevel(1, -1, t=False, b=True, l=False, r=False)
        r.drip(CARD, 3, 1, 2, 1)

    def pencil(r):
        r.fill(YELLOW, 5, amp=0.2)
        if r.face in ('north', 'south', 'up', 'down'):
            r.px(0, 0, BLACK, 2); r.px(1, 0, CARD, 5)
            r.px(r.w - 2, 0, CHROME, 3); r.px(r.w - 1, 0, PINK, 3)
            if r.h > 1:
                r.rect(0, 1, 1, r.h - 1, BLACK, 2)

    def pen(r):
        r.fill(BLACK, 4, amp=0.2)
        if r.face in ('north', 'south', 'up', 'down'):
            r.hline(0, 0, 2, WHITE, 4); r.px(r.w - 1, 0, CHROME, 3)

    def note(r):
        r.fill(YELLOW, 6, amp=0.2)
        if r.face == 'up':
            r.hline(0, 1, 2, YELLOW, 3); r.px(1, 2, RED, 4)

    def ball(r):
        r.fill(PAPER, 4, amp=1.0, white_amp=0.8, cell=1)

    g.box('paper', (-6.5, 0, -4), (-0.5, 0.25, 4), {'up': paper(), 'sides': Face(paper(False), 'pe')}, rotation=(0, 22.5, 0), pivot=(-3.5, 0, 0))
    g.box('paper', (-6, 0.25, -3), (0, 0.5, 5), {'up': paper(True, True), 'sides': Face(paper(False), 'pe')})
    g.box('paper', (-3.5, 0.5, -2.5), (-0.5, 0.6, 0.5), {'up': note, 'sides': Face(note, 'ne')}, rotation=(0, -22.5, 0), pivot=(-2, 0.5, -1))
    g.box('mug', (2, 0, -7), (6, 3, -3), {'sides': Face(mug, 'mug'), 'up': mug})
    g.box('mug', (6, 0.75, -5.5), (7, 2.25, -4.5), {'sides': Face(lambda r: r.fill(CERAMIC, 3, amp=0.2), 'h'), 'ends': Face(lambda r: r.fill(CERAMIC, 3), 'h2')})
    g.box('pens', (0, 0, 2), (6, 0.75, 2.75), {'sides': Face(pencil, 'pc'), 'up': Face(pencil, 'pcu')}, rotation=(0, -22.5, 0), pivot=(3, 0, 2.5))
    g.box('pens', (1, 0, 4.5), (6, 0.75, 5.25), {'sides': Face(pen, 'pn'), 'up': Face(pen, 'pnu')}, rotation=(0, 22.5, 0), pivot=(3.5, 0, 5))
    g.box('ball', (4.5, 0, -1), (6, 1.5, 0.5), {'sides': Face(ball, 'b'), 'up': ball})
    out.geo(g)
    out.tex('desk_clutter', g.paint())
    blk = block_json('desk_clutter', geometry='geometry.fnar.desk_clutter', materials=mi_set('desk_clutter'),
                     collision=False, selection=box(-8, 0, -7, 8, 3, 7), map_color='#b0a896', destroy=0.5)
    out.block('desk_clutter', blk)
    f = {'focus': [0, 0.05, 0], 'dist': 1.3, 'dir': [0.5, 0.9, -1]}
    out.views('desk_clutter', [{'label': 'north', **f}, {'label': 'facing west', 'states': {'minecraft:cardinal_direction': 'west'}, **f}])


# =============================================================== plush Purple Rat
@prop
def plush_rat(out):
    g = Geo('plush_rat', 32, 32)

    def fur(base=3):
        def p(r):
            r.fill(PLUSH, base, amp=0.6, white_amp=0.7, cell=2)
            r.darken_noise(0.2, -1, bottom=0.3)
        return p

    def body_front(r):
        fur(3)(r)
        r.rect(1, 1, 2, 2, LILAC, 3)
        r.px(1, 2, LILAC, 2); r.px(2, 2, LILAC, 2)
        r.speck(GRIME, 3, 0.15, only=LILAC)

    def head_front(r):  # 5 x 4: purple brow row, lilac face mask, black button eyes
        fur(3)(r)
        r.rect(1, 1, 3, 3, LILAC, 3)
        r.px(0, 2, LILAC, 2); r.px(4, 2, LILAC, 2)
        r.px(1, 1, BLACK, 0, rough=40); r.px(3, 1, BLACK, 0, rough=40)
        r.px(2, 1, LILAC, 4)
        r.px(1, 0, PLUSH, 1); r.px(3, 0, PLUSH, 1)  # heavy brows: tired look

    def muzzle(r):
        r.fill(LILAC, 4, amp=0.3, white_amp=0.4)
        if r.face == 'north':
            r.px(1, 1, WHITE, 5)  # buck tooth
            r.px(0, 1, LILAC, 2); r.px(2, 1, LILAC, 2)

    def ear(r):
        r.fill(PLUSH, 3, amp=0.4)
        if r.face == 'north':
            r.rect(1, 1, 1, 2, PINK, 3); r.px(1, 1, PINK, 4)
        for c, rr in ((0, 0), (r.w - 1, 0)):
            r.shift(c, rr, -2)

    def nose(r):
        r.fill(PINK, 4, amp=0.2)

    def tie(r):
        r.fill(RED, 4, amp=0.3)
        if r.face == 'north':
            r.px(1, 0, RED, 2) if r.w > 2 else None

    g.box('body', (-2, 0, -1), (2, 3, 2), {'north': body_front, 'south': fur(2), 'east': Face(fur(3), 'bs'), 'west': Face(fur(3), 'bs'), 'up': fur(2)})
    for x0 in (-2, 0.5):
        g.box('leg', (x0, 0, -3), (x0 + 1.5, 1, -1), {'north': Face(lambda r: r.fill(LILAC, 3, amp=0.3), 'pad'), 'sides': Face(fur(3), 'ls'),
                                                      'up': Face(fur(4), 'lu')})
    for x0 in (-3, 2):
        g.box('arm', (x0, 0.5, -0.5), (x0 + 1, 2.5, 0.5), {'sides': Face(fur(3), 'as'), 'ends': Face(fur(2), 'ae')})
    g.box('head', (-2.5, 3, -1.5), (2.5, 7, 2), {'north': head_front, 'south': fur(2), 'east': Face(fur(3), 'hs'), 'west': Face(fur(3), 'hs'),
                                                 'up': fur(4), 'down': fur(1)})
    g.box('head', (-1.5, 3, -2.5), (1.5, 5, -1.5), {'north': muzzle, 'sides': Face(muzzle, 'ms'), 'up': Face(muzzle, 'mu')})
    g.box('head', (-0.5, 4.25, -3), (0.5, 5, -2.5), {'sides': Face(nose, 'n'), 'ends': Face(nose, 'n2')})
    g.box('body', (-1.5, 2.5, -1.5), (1.5, 3, -1), {'north': tie, 'ends': Face(tie, 't2'), 'sides': Face(tie, 't3')})
    for x0 in (-4, 1):
        g.box('ear', (x0, 5.5, 0), (x0 + 3, 8.5, 0.5), {'north': ear, 'south': ear, 'sides': Face(ear, 'es'), 'ends': Face(ear, 'ee')})
    g.box('tail', (-0.25, 0.25, 2), (0.25, 0.75, 4.5), {'sides': Face(nose, 'tl'), 'ends': Face(nose, 'te')})
    out.geo(g)
    out.tex('plush_rat', g.paint())
    blk = block_json('plush_rat', geometry='geometry.fnar.plush_rat', materials=mi_set('plush_rat'),
                     collision=False, selection=box(-4, 0, -3, 4, 8.5, 4.5), map_color='#462651', destroy=0.5)
    out.block('plush_rat', blk)
    f = {'focus': [0, 0.28, 0], 'dist': 1.0}
    out.views('plush_rat', [{'label': 'north', **f}, {'label': 'facing east', 'states': {'minecraft:cardinal_direction': 'east'}, **f}])


# =============================================================== security camera
@prop
def security_camera(out):
    g = Geo('security_camera', 32, 32)
    housing = lambda base=4, grime=0.3: panel(BEIGE, base, amp=0.5, white_amp=0.3, grime=grime)

    def front(r):  # 4 x 4 body front: lens bezel + LED
        r.fill(BEIGE, 2, amp=0.3)
        r.bevel(1, -1)
        r.px(3, 0, LED_RED, 0)

    def lens(r):
        r.fill(GLASS_OFF, 2, amp=0.3)
        if r.face == 'north':
            r.px(0, 0, GLASS_OFF, 6); r.px(1, 1, GLASS_OFF, 4)

    def side(r):
        housing(4)(r)
        for c in range(r.w - 3, r.w - 1):
            r.vline(c, 1, r.h - 2, BEIGE, 1)  # vent fins near the back
        r.hline(1, r.h - 2, 2, PAPER, 4)  # model sticker

    g.bone('head', pivot=(0, 12.5, 3), rotation=(-22.5, 0, 0))
    g.box('mount', (-1.5, 10, 7), (1.5, 15, 8), {'north': panel(STEEL, 3, grime=0.3), 'sides': Face(panel(STEEL, 2), 'ms'), 'ends': Face(panel(STEEL, 2), 'me')})
    g.box('mount', (-0.5, 12, 3), (0.5, 13, 7), {'sides': Face(panel(STEEL, 3, bevel=None), 'arm'), 'ends': Face(panel(STEEL, 3, bevel=None), 'arme')})
    g.box('mount', (-1, 11.5, 2), (1, 13.5, 4), {'sides': Face(panel(IRON, 3), 'j'), 'ends': Face(panel(IRON, 3), 'je')})
    g.box('head', (-2, 8.5, -5), (2, 12.5, 3), {'north': front, 'south': housing(3), 'east': Face(side, 's'), 'west': Face(side, 's'),
                                                'up': housing(5, 0.6), 'down': housing(2)})
    g.box('head', (-2.5, 12.5, -6), (2.5, 13, 2), {'up': panel(BEIGE, 4, grime=0.6, grime_bottom=0), 'down': panel(BEIGE, 1),
                                                   'sides': Face(panel(BEIGE, 3, bevel=None), 'hood')})
    g.box('head', (-1, 9.5, -5.5), (1, 11.5, -5), {'north': lens, 'sides': Face(lens, 'ls'), 'ends': Face(lens, 'le')})
    out.geo(g)
    out.tex('security_camera', g.paint())
    blk = block_json('security_camera', geometry='geometry.fnar.security_camera', materials=mi_set('security_camera'),
                     collision=False, selection=box(-2.5, 7, -6.5, 2.5, 16, 8), map_color='#5b5d61', destroy=1.0)
    out.block('security_camera', blk)
    f = {'env': 'wall', 'focus': [0, 0.66, 0.0], 'dist': 1.3, 'dir': [0.7, 0.1, -1]}
    out.views('security_camera', [{'label': 'north', **f}, {'label': 'side', **f, 'dir': [1, 0.3, -0.2]},
                                  {'label': 'facing west', 'states': {'minecraft:cardinal_direction': 'west'}, **f, 'dir': [-0.6, 0.2, -1]}]
              + pillar_views(dist=3.6))


# =============================================================== show tape deck
@prop
def show_tape(out):
    import math
    g = Geo('show_tape', 64, 64)
    case = lambda base=2, grime=0.3: panel(IRON, base, amp=0.5, white_amp=0.3, grime=grime)

    def front(r):  # 16 x 9 front panel (x 8..-8 as columns 0..15, rows y 14..5)
        r.fill(STEEL, 4, amp=0.3, white_amp=0.25)
        r.bevel(1, -1)
        # tape path between reels (reels sit at cols 1..6 and 9..14, rows 0..6)
        r.hline(4, 6, 8, CARD, 1)
        r.rect(7, 5, 2, 2, CHROME, 3)  # heads
        r.px(7, 5, CHROME, 5)
        # label plate "SHOW"
        r.rect(6, 1, 4, 3, BLACK, 2)
        r.text('SHOW', 6, 1, PAPER, 4, font={'S': ['#', '#'], 'H': ['#', '#'], 'O': ['#', '#'], 'W': ['#', '.']}, spacing=0) if False else None
        for c in (6, 8):
            r.vline(c, 1, 2, PAPER, 4)
        r.px(7, 1, PAPER, 4); r.px(9, 2, PAPER, 3)
        # VU meter: 4 LEDs bottom right (cols 10..13, row 8)
        lvl = int(r.variant or 0)
        on = [LED_GREEN, LED_GREEN, LED_YELLOW, LED_RED]
        off = [LED_OFF_G, LED_OFF_G, LED_OFF_Y, LED_OFF_R]
        r.rect(9, 7, 6, 2, BLACK, 1)
        for k in range(4):
            r.px(10 + k, 8, on[k] if k < lvl else off[k], 0)
        r.px(10, 7, PAPER, 2); r.px(13, 7, RED, 4)
        # transport buttons bottom left
        cols = [(BLACK, 4), (BLACK, 4), (RED, 4), (WHITE, 3), (BLACK, 4)]
        for k, (m, i) in enumerate(cols):
            r.px(1 + k, 8, m, i, h=6)
        r.hline(1, 7, 5, STEEL, 2)
        r.darken_noise(0.25, -1, bottom=0.5)
        r.speck(RUST, 2, 0.04)

    def reel(r):
        cx, cy = r.w / 2, r.h / 2
        r.clear()
        for c in range(r.w):
            for rr in range(r.h):
                d = math.hypot(c + 0.5 - cx, rr + 0.5 - cy)
                if d < 0.75:
                    r.px(c, rr, CHROME, 3)
                elif d < 2.4:
                    r.px(c, rr, CARD, 1 if (c + rr) % 2 else 2)  # wound tape
                else:
                    r.px(c, rr, CHROME, 2 if (c * 3 + rr) % 4 else 3)  # flange
        for c, rr in ((0, 0), (r.w - 1, 0), (0, r.h - 1), (r.w - 1, r.h - 1)):
            r.px(c, rr, None)
        r.speck(GRIME, 2, 0.12, only=CHROME)

    def reel_edge(r):
        r.fill(CHROME, 2, amp=0.3)

    leg = Face(panel(STEEL, 2, grime=0.4), 'leg')
    for x in (-8, 7):
        for z in (-3, 3):
            g.box('stand', (x, 0, z), (x + 1, 5, z + 1), {'sides': leg})
    g.box('stand', (-8, 1, -3), (8, 2, 4), {'up': panel(STEEL, 3, grime=0.5, grime_bottom=0), 'sides': Face(panel(STEEL, 2), 'shelf'),
                                           'down': panel(STEEL, 1)})
    g.box('deck', (-8, 5, -2), (8, 14, 4), {'north': front, 'south': case(2, 0.4), 'east': Face(case(2), 'ds'), 'west': Face(case(2), 'ds'),
                                            'up': case(3, 0.5), 'down': case(1)})
    for cx in (-4, 4):
        # three non-overlapping slices make a round reel (6 px)
        g.box('reels', (cx - 2, 7.5, -3), (cx + 2, 13.5, -2), {'north': Face(lambda r: (reel(r)), 'rc'), 'sides': Face(reel_edge, 'rce'),
                                                               'ends': Face(reel_edge, 'rct')})
        for sx in (-1, 1):
            x0 = cx + 2 if sx > 0 else cx - 3
            g.box('reels', (x0, 8.5, -2.75), (x0 + 1, 12.5, -2), {'north': Face(lambda r: (r.fill(CHROME, 2, amp=0.3), r.vline(0, 1, 2, CARD, 1)), 'rs'),
                                                                  'sides': Face(reel_edge, 'rse'), 'ends': Face(reel_edge, 'rst')})
    out.geo(g)
    for lvl in range(5):
        out.tex(f'show_tape_{lvl}', g.paint(str(lvl)))
    perms = [(bs('fnar:level', lvl), {'minecraft:material_instances': mi_set(f'show_tape_{lvl}'),
                                      **({'minecraft:light_emission': 1 if lvl < 3 else 2} if lvl else {})}) for lvl in range(5)]
    blk = block_json('show_tape', geometry='geometry.fnar.show_tape', materials=mi_set('show_tape_0'),
                     states={'fnar:level': {'values': {'min': 0, 'max': 4}}},
                     collision=box(-8, 0, -3, 8, 14, 4), selection=box(-8, 0, -3, 8, 14, 4), map_color='#2a2e34', destroy=2.0,
                     perms=perms)
    out.block('show_tape', blk)
    out.light('show_tape', '#c8ff6a', 'static_light')
    f = {'focus': [0, 0.45, 0], 'dist': 1.9}
    out.views('show_tape', [{'label': f'level {l}', 'states': {'fnar:level': l}, **f} for l in (0, 2, 4)] +
              [{'label': 'level 3, facing east', 'states': {'fnar:level': 3, 'minecraft:cardinal_direction': 'east'}, **f}])
