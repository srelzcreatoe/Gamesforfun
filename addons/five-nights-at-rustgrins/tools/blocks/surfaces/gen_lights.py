"""Light blocks (section A): ceiling troffer, EXIT sign, wall sconce, stage
spotlight, hanging lamp. Writes the custom geometries (RP models/blocks) and
the lit/unlit texture sets (<name>_on / <name>_off).

Models face north (front towards -Z); wall-mounted ones have their back on the
south side of the cell (z = +8).
Run: python3 tools/blocks/surfaces/gen_lights.py [preview.png]
"""
import numpy as np

from font import render
from geo import Model
from pixlib import Tex, hexc, mix, rng, shade, tile_noise, white


# ------------------------------------------------------------------ models
def model_exit_sign():
    m = Model('exit_sign', 16, 16)
    b = m.bone('sign')
    # 14 x 7 x 2 box hanging at the top of the cell, back against the south wall
    m.cube(b, [-7, 9, 6], [14, 7, 2], {'north': ('exit_face', 'glow'), 'south': 'housing', 'east': 'housing',
                                        'west': 'housing', 'up': 'housing', 'down': 'housing'})
    return m


def model_wall_sconce():
    m = Model('wall_sconce', 32, 32)
    b = m.bone('sconce')
    g = ('glass', 'glow')
    m.cube(b, [-3, 6, 4], [6, 6, 1], {'north': g, 'east': g, 'west': g, 'up': ('glass_top', 'glow'),
                                       'down': ('glass_bottom', 'glow')})
    m.cube(b, [-4, 6, 5], [8, 6, 2], {'north': g, 'east': g, 'west': g, 'south': g, 'up': ('glass_top', 'glow'),
                                       'down': ('glass_bottom', 'glow')})
    m.cube(b, [-2, 6, 3], [4, 6, 1], {'north': g, 'east': g, 'west': g, 'up': ('glass_top', 'glow'),
                                       'down': ('glass_bottom', 'glow')})
    m.cube(b, [-2, 4, 7], [4, 9, 1], {'north': 'brass', 'east': 'brass', 'west': 'brass', 'up': 'brass',
                                       'down': 'brass'})
    m.cube(b, [-1, 5, 4], [2, 1, 2], {'*': 'brass'})
    return m


def model_stage_spotlight():
    m = Model('stage_spotlight', 32, 32)
    mount = m.bone('mount')
    m.cube(mount, [-3, 15, -3], [6, 1, 6], {'north': 'metal_dark', 'south': 'metal_dark', 'east': 'metal_dark',
                                             'west': 'metal_dark', 'down': 'metal_dark'})
    m.cube(mount, [-1, 12, -1], [2, 3, 2], {'north': 'metal_dark', 'south': 'metal_dark', 'east': 'metal_dark',
                                             'west': 'metal_dark'})
    m.cube(mount, [-5, 11, -1], [10, 1, 2], {'*': 'yoke'})
    m.cube(mount, [-5, 6, -1], [1, 5, 2], {'north': 'yoke', 'south': 'yoke', 'east': 'yoke', 'west': 'yoke',
                                            'down': 'yoke'})
    m.cube(mount, [4, 6, -1], [1, 5, 2], {'north': 'yoke', 'south': 'yoke', 'east': 'yoke', 'west': 'yoke',
                                           'down': 'yoke'})
    # the can tilts forward-down around the yoke pins
    can = m.bone('can', pivot=[0, 8.5, 0], rotation=[35, 0, 0], parent='mount')
    m.cube(can, [-3, 5.5, -4], [6, 6, 8], {'south': 'can_back', 'east': 'can', 'west': 'can', 'up': 'can_top',
                                            'down': 'can'})
    m.cube(can, [-3.5, 5, -5], [7, 7, 1], {'north': ('lens', 'glow'), 'south': 'can_rim', 'east': 'can_rim',
                                            'west': 'can_rim', 'up': 'can_rim', 'down': 'can_rim'})
    m.cube(can, [-2, 6.5, 4], [4, 4, 1], {'*': 'can_back'})
    # barn door above the lens
    m.cube(can, [-3.5, 12, -7], [7, 0, 3], {'up': 'yoke', 'down': 'yoke'})
    return m


def model_hanging_lamp():
    m = Model('hanging_lamp', 32, 32)
    b = m.bone('lamp')
    m.cube(b, [-5, 5, -5], [10, 2, 10], {'north': 'enamel_band', 'south': 'enamel_band', 'east': 'enamel_band',
                                          'west': 'enamel_band', 'up': 'enamel_top10',
                                          'down': ('shade_inside', 'glow')})
    m.cube(b, [-4, 7, -4], [8, 1, 8], {'north': 'enamel', 'south': 'enamel', 'east': 'enamel', 'west': 'enamel',
                                        'up': 'enamel_top8'})
    m.cube(b, [-3, 8, -3], [6, 1, 6], {'north': 'enamel', 'south': 'enamel', 'east': 'enamel', 'west': 'enamel',
                                        'up': 'enamel_top6'})
    m.cube(b, [-2, 9, -2], [4, 1, 4], {'north': 'enamel', 'south': 'enamel', 'east': 'enamel', 'west': 'enamel',
                                        'up': 'enamel_top4'})
    m.cube(b, [-0.5, 10, -0.5], [1, 5, 1], {'north': 'cord', 'south': 'cord', 'east': 'cord', 'west': 'cord'})
    m.cube(b, [-1.5, 15, -1.5], [3, 1, 3], {'north': 'metal_dark', 'south': 'metal_dark', 'east': 'metal_dark',
                                             'west': 'metal_dark', 'down': 'metal_dark'})
    m.cube(b, [-1, 4, -1], [2, 2, 2], {'north': ('bulb', 'glow'), 'south': ('bulb', 'glow'), 'east': ('bulb', 'glow'),
                                        'west': ('bulb', 'glow'), 'down': ('bulb_tip', 'glow')})
    return m


MODELS = {
    'exit_sign': model_exit_sign,
    'wall_sconce': model_wall_sconce,
    'stage_spotlight': model_stage_spotlight,
    'hanging_lamp': model_hanging_lamp,
}


# ------------------------------------------------------------------ painters
def _region(t, r):
    u, v, w, h = r
    return slice(v, v + h), slice(u, u + w), w, h


def _metal(t, r, base, hi, lo, seed, metal=170, rough=115):
    ys, xs, w, h = _region(t, r)
    wn = white(w, h, seed)
    col = np.zeros((h, w, 3)) + hexc(base)
    col = shade(col, 0.94 + 0.12 * wn)
    if h > 1:
        col[0] = hexc(hi)
        col[-1] = hexc(lo)
    t.rgb[ys, xs] = col
    t.a[ys, xs] = 255
    t.metal[ys, xs] = metal
    t.rough[ys, xs] = rough + 30 * wn
    t.height[ys, xs] = 170


def paint(t, key, r, lit, seed):
    style, w, h = key
    ys, xs, _, _ = _region(t, r)
    wn = white(w, h, seed)
    t.a[ys, xs] = 255
    t.emit[ys, xs] = 0
    if style == 'metal_dark':
        _metal(t, r, '#2a2b2f', '#3c3e43', '#1d1e21', seed)
    elif style == 'yoke':
        _metal(t, r, '#3d4045', '#55595f', '#2a2c30', seed, metal=190, rough=100)
        if w >= 6:
            t.rgb[v_(r) + h // 2, u_(r) + 1] = hexc('#6a6e74')  # bolt
    elif style in ('can', 'can_top', 'can_rim', 'can_back'):
        _metal(t, r, '#1c1c1f', '#2e2e33', '#121214', seed, metal=150, rough=120)
        u, v = r[0], r[1]
        if style == 'can_top' and h >= 6:
            for yy in range(1, h - 1, 2):  # cooling vents
                for xx in range(1, w - 1):
                    t.rgb[v + yy, u + xx] = hexc('#0c0c0d')
        if style == 'can' and w >= 6:
            t.rgb[v + h // 2, u + 1:u + w - 1] = hexc('#2a2a2e')  # seam
            # heat-scorched paint near the lens end
            for yy in range(h):
                t.rgb[v + yy, u] = mix(t.rgb[v + yy, u], hexc('#3a2a1e'), 0.5)
        if style == 'can_back' and w >= 4:
            t.rgb[v + h // 2, u + w // 2] = hexc('#5a1414' if not lit else '#c0302a')  # pilot light
            if lit:
                t.emit[v + h // 2, u + w // 2] = 160
    elif style == 'lens':
        u, v = r[0], r[1]
        _metal(t, r, '#1c1c1f', '#2e2e33', '#121214', seed, metal=150, rough=120)
        cx, cy = (w - 1) / 2, (h - 1) / 2
        for yy in range(1, h - 1):
            for xx in range(1, w - 1):
                d = max(abs(xx - cx), abs(yy - cy)) + 0.4 * min(abs(xx - cx), abs(yy - cy))
                if lit:
                    col, em = (('#fffbea', 255) if d < 1.2 else ('#ffeab8', 240) if d < 2.2 else ('#f2c77e', 200))
                else:
                    col, em = (('#3d3b35', 0) if d < 2.2 else ('#2c2b27', 0))
                t.rgb[v + yy, u + xx] = hexc(col)
                t.emit[v + yy, u + xx] = em
                t.metal[v + yy, u + xx] = 0
                t.rough[v + yy, u + xx] = 35
                t.height[v + yy, u + xx] = 190
        if not lit:
            t.rgb[v + 2, u + 2] = hexc('#77746a')  # reflection on dead glass
    elif style == 'brass':
        _metal(t, r, '#8a6a2c', '#b48e40', '#5c461c', seed, metal=220, rough=95)
        u, v = r[0], r[1]
        if w >= 3 and h >= 6:
            t.rgb[v + 1, u + w // 2] = hexc('#3a2c12')  # screw
            t.rgb[v + h - 2, u + w // 2] = hexc('#3a2c12')
            for yy in range(h):  # tarnish streak
                if wn[yy, 0] > 0.6:
                    t.rgb[v + yy, u] = hexc('#4f5a3a')
    elif style == 'glass':
        u, v = r[0], r[1]
        for yy in range(h):
            for xx in range(w):
                rib = (xx % 2 == 0)
                if yy in (0, h - 1):
                    col, em = ('#9a7834', 0)
                elif lit:
                    col, em = (('#ffd592', 225) if rib else ('#f0b45e', 190))
                    if yy == h - 2:
                        col, em = ('#e09a48', 170)
                else:
                    col, em = (('#6e5536', 0) if rib else ('#5c452a', 0))
                    if wn[yy, xx] > 0.85:
                        col = '#4a3a26'  # dead fly / grime
                t.rgb[v + yy, u + xx] = hexc(col)
                t.emit[v + yy, u + xx] = em
                t.metal[v + yy, u + xx] = 200 if yy in (0, h - 1) else 0
                t.rough[v + yy, u + xx] = 90 if yy in (0, h - 1) else 45
                t.height[v + yy, u + xx] = 180
    elif style in ('glass_top', 'glass_bottom'):
        u, v = r[0], r[1]
        for yy in range(h):
            for xx in range(w):
                edge = xx in (0, w - 1)
                if edge:
                    col, em = ('#9a7834', 0)
                elif lit:
                    col, em = (('#fff4d6', 255) if style == 'glass_top' else ('#ffe3a8', 230))
                else:
                    col, em = ('#2e261d', 0)
                t.rgb[v + yy, u + xx] = hexc(col)
                t.emit[v + yy, u + xx] = em
                t.rough[v + yy, u + xx] = 60
                t.height[v + yy, u + xx] = 150
    elif style == 'cord':
        _metal(t, r, '#18181a', '#232326', '#101012', seed, metal=0, rough=210)
    elif style in ('enamel', 'enamel_band') or style.startswith('enamel_top'):
        u, v = r[0], r[1]
        base, hi, lo = hexc('#2c4637'), hexc('#3f6150'), hexc('#1f3127')
        for yy in range(h):
            for xx in range(w):
                c = base * (0.95 + 0.1 * wn[yy, xx])
                if style.startswith('enamel_top'):
                    # conical top: lighter toward the north-west (light from the top-left)
                    if xx == 0 or yy == 0:
                        c = hi
                    elif xx == w - 1 or yy == h - 1:
                        c = lo
                elif style == 'enamel_band':
                    c = hi if yy == 0 else base
                    if yy == h - 1:
                        c = hexc('#c9c4b4')  # white enamel lip at the rim
                if wn[yy, xx] > 0.96:
                    c = hexc('#4b3a2a')  # chipped enamel showing rust
                t.rgb[v + yy, u + xx] = c
                t.rough[v + yy, u + xx] = 70
                t.metal[v + yy, u + xx] = 0
                t.height[v + yy, u + xx] = 175
    elif style == 'shade_inside':
        u, v = r[0], r[1]
        cx, cy = (w - 1) / 2, (h - 1) / 2
        for yy in range(h):
            for xx in range(w):
                d = max(abs(xx - cx), abs(yy - cy))
                if d > cx - 0.6:
                    col, em = ('#2c4637', 0)
                elif d > cx - 1.6:
                    col, em = ('#bdb8a8', 60 if lit else 0)
                elif lit:
                    col, em = (('#fff1d2', 255) if d < 2.5 else ('#f4e2bc', 200))
                else:
                    col, em = ('#9d9888', 0) if d > 2.5 else ('#7d786a', 0)
                t.rgb[v + yy, u + xx] = hexc(col)
                t.emit[v + yy, u + xx] = em
                t.rough[v + yy, u + xx] = 80
                t.height[v + yy, u + xx] = 150
    elif style in ('bulb', 'bulb_tip'):
        u, v = r[0], r[1]
        for yy in range(h):
            for xx in range(w):
                if lit:
                    col, em = ('#fff6dc', 255) if (xx + yy) % 3 else ('#ffe7b0', 245)
                else:
                    col, em = ('#8d887c', 0) if (xx + yy) % 2 else ('#6b675e', 0)
                t.rgb[v + yy, u + xx] = hexc(col)
                t.emit[v + yy, u + xx] = em
                t.rough[v + yy, u + xx] = 30
                t.height[v + yy, u + xx] = 200
    elif style == 'housing':
        _metal(t, r, '#33373a', '#4a4f53', '#25282a', seed, metal=150, rough=125)
    elif style == 'exit_face':
        u, v = r[0], r[1]
        _metal(t, r, '#33373a', '#4a4f53', '#25282a', seed, metal=150, rough=125)
        bg = '#14301c' if lit else '#121a14'
        for yy in range(1, h - 1):
            for xx in range(1, w - 1):
                t.rgb[v + yy, u + xx] = hexc(bg)
                t.emit[v + yy, u + xx] = 40 if lit else 0
                t.metal[v + yy, u + xx] = 0
                t.rough[v + yy, u + xx] = 50
        m = render('EXIT', cond_chars={'E'})
        mh, mw = m.shape
        ox, oy = u + (w - mw) // 2, v + (h - mh) // 2
        for yy, xx in zip(*np.nonzero(m)):
            t.rgb[oy + yy, ox + xx] = hexc('#7dffa0' if lit else '#2e5a3a')
            t.emit[oy + yy, ox + xx] = 255 if lit else 0
            t.height[oy + yy, ox + xx] = 190
    else:
        raise KeyError(style)


def u_(r):
    return r[0]


def v_(r):
    return r[1]


def lamp_textures(model, lit):
    t = Tex(model.tw, model.th, rough=200)
    t.a[:] = 0
    for i, (key, r) in enumerate(sorted(model.regions.items(), key=lambda kv: (kv[1][1], kv[1][0]))):
        paint(t, key, r, lit, 5000 + i)
    z = t.a == 0
    t.rgb[z] = 0
    t.height[z] = 0
    return t


# ------------------------------------------------------------------ ceiling troffer (full block, bottom face)
def troffer(lit):
    t = Tex(16, 16, rough=120, metal=0, height=150)
    wn = white(16, 16, 5101)
    frame, frame_hi, frame_lo, recess = hexc('#8f908b'), hexc('#a9aaa5'), hexc('#676863'), hexc('#4d4e4a')
    for y in range(16):
        for x in range(16):
            if x in (0, 15) or y in (0, 15):
                c = frame_hi if (x == 0 or y == 0) else frame_lo
                if (x, y) in ((0, 15), (15, 0)):
                    c = frame
                t.rgb[y, x] = shade(c, 0.95 + 0.08 * wn[y, x])
                t.metal[y, x] = 170
                t.rough[y, x] = 110
                t.height[y, x] = 200
                continue
            if x in (1, 14) or y in (1, 14):
                t.rgb[y, x] = recess
                t.metal[y, x] = 120
                t.rough[y, x] = 150
                t.height[y, x] = 120
                continue
            # prismatic diffuser over two tubes running east-west (rows 4-5 and 10-11)
            tube = y in (4, 5, 10, 11)
            near = y in (3, 6, 9, 12)
            prism = (x + y) % 2 == 0
            if lit:
                if tube:
                    c, e = ('#f6f9ff', 255) if prism else ('#e8eefb', 245)
                elif near:
                    c, e = ('#dbe3f2', 215) if prism else ('#cdd6e6', 200)
                else:
                    c, e = ('#c4cddd', 175) if prism else ('#b5bfcf', 160)
            else:
                if tube:
                    c, e = ('#8c9096', 0) if prism else ('#81858b', 0)
                else:
                    c, e = ('#71757b', 0) if prism else ('#686c72', 0)
            col = hexc(c)
            if not lit:
                col = mix(col, hexc('#5f574a'), 0.15 * wn[y, x])  # dust film
            t.rgb[y, x] = col
            t.emit[y, x] = e
            t.rough[y, x] = 95
            t.height[y, x] = 140 if prism else 132
    # dead bugs collected in the diffuser, dust along one edge
    for (x, y) in ((4, 8), (11, 3), (12, 12), (5, 12)):
        t.rgb[y, x] = hexc('#2a2622')
        t.emit[y, x] = 0
    for x in range(2, 14):
        if wn[13, x] > 0.5:
            t.rgb[13, x] = mix(t.rgb[13, x], hexc('#5f574a'), 0.35)
            t.emit[13, x] = min(t.emit[13, x], 90)
    # frame screws
    for (x, y) in ((1, 1), (14, 1), (1, 14), (14, 14)):
        t.rgb[y, x] = hexc('#3a3b38')
    return t


# ------------------------------------------------------------------ the broken troffer (flipbook flicker)
# frame states for the surviving tube: 1 = full, 0.55 = dim, 0 = dark. The other tube is dead for good.
BROKEN_FRAMES = (1.0, 0.55, 0.0, 0.8)
# the order the frames play in (2 ticks each): mostly on, with stutters and short blackouts
BROKEN_SEQUENCE = [0] * 9 + [1, 0, 0, 2, 0] + [0] * 14 + [3, 1, 2, 2, 0, 0, 1] + [0] * 20 + [2, 0, 2, 2, 2, 3, 0] + [0] * 6


def troffer_broken(level):
    """Troffer with a cracked diffuser (one panel gone, the tube bare behind it), one dead tube, one
    flickering at `level`."""
    t = troffer(True)
    wn = white(16, 16, 5102)
    for y in range(2, 14):
        for x in range(2, 14):
            if y in (10, 11, 9, 12):  # the dead lower tube, greyed and dusty
                c = hexc('#7b7f86' if (x + y) % 2 == 0 else '#6f737a')
                t.rgb[y, x] = mix(c, hexc('#5f574a'), 0.2 * wn[y, x])
                t.emit[y, x] = 0
            elif y in (4, 5, 3, 6):
                k = level
                base = t.rgb[y, x] if level > 0 else hexc('#8c9096' if (x + y) % 2 == 0 else '#81858b')
                t.rgb[y, x] = mix(hexc('#80848a'), base, k) if level > 0 else base
                t.emit[y, x] = t.emit[y, x] * k
            else:
                t.rgb[y, x] = mix(t.rgb[y, x], hexc('#686c72'), 1 - 0.6 * level)
                t.emit[y, x] = t.emit[y, x] * 0.5 * level
    # blackened tube ends (the ballast is going) and a missing diffuser panel over the right end
    for y in (4, 5):
        for x in (2, 3, 12, 13):
            t.rgb[y, x] = hexc('#3a3632')
            t.emit[y, x] = 0
    for y in range(2, 8):
        for x in range(10, 14):
            if x + (7 - y) >= 12:
                t.rgb[y, x] = hexc('#1c1c1e') if y not in (4, 5) else (hexc('#fbfdff') * level + hexc('#5a5c60') * (1 - level))
                t.emit[y, x] = 255 * level if y in (4, 5) else 0
                t.height[y, x] = 100
    # a long crack across the diffuser
    for x in range(3, 11):
        y = 7 + (x // 3) % 2
        t.rgb[y, x] = hexc('#3a3a3c')
        t.emit[y, x] = 0
    return t


def broken_lamp_texture():
    frames = [troffer_broken(v) for v in BROKEN_FRAMES]
    t = Tex(16, 16 * len(frames))
    for i, f in enumerate(frames):
        sl = slice(16 * i, 16 * i + 16)
        t.rgb[sl], t.a[sl], t.metal[sl], t.emit[sl], t.rough[sl], t.height[sl] = f.rgb, f.a, f.metal, f.emit, f.rough, f.height
    return t


def build():
    out = {}
    t = broken_lamp_texture()
    t.save('ceiling_lamp_broken')
    out['ceiling_lamp_broken'] = t
    for name, fn in MODELS.items():
        m = fn()
        m.save()
        for lit in (True, False):
            t = lamp_textures(m, lit)
            n = f'{name}_{"on" if lit else "off"}'
            t.save(n)
            out[n] = t
    for lit in (True, False):
        n = f'ceiling_lamp_{"on" if lit else "off"}'
        t = troffer(lit)
        t.save(n)
        out[n] = t
    return out


if __name__ == '__main__':
    import sys
    from pixlib import contact_sheet
    res = build()
    if len(sys.argv) > 1:
        contact_sheet([(n, t.color()) for n, t in res.items()], sys.argv[1], scale=8, tile3=False, cols=5)
    print('lights:', ', '.join(res))
