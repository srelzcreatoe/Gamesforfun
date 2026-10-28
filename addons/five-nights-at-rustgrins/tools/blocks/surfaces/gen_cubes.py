"""Full-cube surface textures for section A (floors, walls, ceilings, fabric, metal).

Run: python3 tools/blocks/surfaces/gen_cubes.py
Writes packs/RP/textures/blocks/fnar/<name>{.png,_mer.png,_height.png,.texture_set.json}
"""
import numpy as np

from pixlib import (Tex, blur_wrap, fbm, hexc, mix, norm01, quant, ramp, rng,
                    shade, tile_noise, white)

W = H = 16
YY, XX = np.mgrid[0:H, 0:W]


# ------------------------------------------------------------------ checker floor
def tile_checker(worn=False):
    seed = 101 if not worn else 202
    r = rng(seed)
    t = Tex(rough=220, height=90)
    black = ramp('#121215', '#18181b', '#1d1d21', '#24242a', '#303037')
    whitep = ramp('#9f998b', '#b2ac9f', '#c0bbaf', '#cbc6bc', '#d6d1c7')
    grout = ramp('#3f3a31', '#4b4439', '#56514a', '#5f5a53')
    n = fbm(W, H, seed, cells=(8, 4, 2), weights=(0.3, 0.4, 0.3))
    wn = white(W, H, seed + 1)
    tone = {}
    for ty in range(2):
        for tx in range(2):
            tone[(tx, ty)] = r.normal(0, 0.06)
    for y in range(H):
        for x in range(W):
            gx, gy = x % 8, y % 8
            tx, ty = x // 8, y // 8
            is_black = (tx + ty) % 2 == 0
            if gx == 0 or gy == 0:
                # grout with grime
                v = 0.55 * n[y, x] + 0.45 * wn[y, x]
                if worn:
                    v -= 0.15
                t.rgb[y, x] = quant(np.array([v]), grout)[0]
                t.rough[y, x] = 225
                t.height[y, x] = 70 + 20 * v
                continue
            # tile interior, local coords 1..7
            v = 0.5 + 0.35 * (n[y, x] - 0.5) + 0.25 * (wn[y, x] - 0.5) + tone[(tx, ty)]
            if gx == 1 or gy == 1:
                v += 0.28  # top/left bevel catches light
            if gx == 7 or gy == 7:
                v -= 0.28
            if gx == 1 and gy == 1:
                v += 0.1
            pal = black if is_black else whitep
            idx = int(np.clip(v * 4 + 0.5, 0, 4))
            if not (gx == 1 or gy == 1) and idx == 4:
                idx = 3
            t.rgb[y, x] = pal[idx]
            t.rough[y, x] = 62 + 18 * wn[y, x] if not worn else 92 + 22 * wn[y, x]
            t.height[y, x] = 205 if not (gx in (1, 7) or gy in (1, 7)) else 190
    # glossy glint on each tile (2-px streak near top-left)
    for (tx, ty) in [(0, 0), (1, 0), (0, 1), (1, 1)]:
        is_black = (tx + ty) % 2 == 0
        bx, by = tx * 8, ty * 8
        gl = hexc('#3c3c44') if is_black else hexc('#dcd8cf')
        for (dx, dy) in [(2, 2), (3, 2), (2, 3)]:
            if worn and (tx, ty) == (1, 1):
                continue
            t.rgb[by + dy, bx + dx] = gl
            t.rough[by + dy, bx + dx] = 45 if not worn else 80
    # grime collects in grout corners
    for (x, y) in [(0, 0), (8, 8), (0, 8), (8, 0)]:
        t.rgb[y, x] = hexc('#3a352c')
    if worn:
        _wear_checker(t, r)
    return t


def _wear_checker(t, r):
    # scuffs: short light streaks on the black tiles, dark ones on the white tiles
    scuffs = [((3, 4), (1, 1), 3, '#323238'), ((11, 12), (1, -1), 3, '#303036'),
              ((2, 6), (1, 0), 2, '#2e2e34'), ((12, 13), (1, 0), 2, '#2e2e34'),
              ((3, 11), (1, 0), 2, '#a7a092')]
    for (x, y), (dx, dy), ln, col in scuffs:
        for i in range(ln):
            xx, yy = x + dx * i, y + dy * i
            if xx % 8 == 0 or yy % 8 == 0:
                continue
            t.rgb[yy, xx] = hexc(col)
            t.rough[yy, xx] = 150
    # hairline crack across the top-right white tile (jagged, with a chipped corner)
    crack = [(9, 3), (10, 3), (11, 4), (11, 5), (12, 5), (13, 6), (14, 6)]
    for (x, y) in crack:
        t.rgb[y, x] = hexc('#5f594e')
        t.height[y, x] = 150
        t.rough[y, x] = 200
    for (x, y) in [(10, 2), (12, 4)]:
        t.rgb[y, x] = hexc('#dbd6cc')  # chipped edge catches light
    for (x, y) in [(11, 6), (13, 7)]:
        t.rgb[y, x] = hexc('#99938a')
    # dried stain spanning the grout at the bottom-left/centre
    stain = {(4, 9): 0, (5, 9): 1, (6, 9): 1, (3, 10): 1, (4, 10): 2, (5, 10): 2, (6, 10): 2, (7, 10): 1,
             (8, 10): 1, (9, 10): 0, (3, 11): 0, (4, 11): 2, (5, 11): 2, (6, 11): 2, (7, 11): 2, (8, 11): 1,
             (9, 11): 1, (4, 12): 1, (5, 12): 2, (6, 12): 2, (7, 12): 1, (8, 12): 1, (5, 13): 0, (6, 13): 1,
             (7, 13): 0}
    for (x, y), lvl in stain.items():
        base = t.rgb[y, x]
        tint = hexc('#4e3d27')
        k = (0.28, 0.42, 0.55)[lvl]
        t.rgb[y, x] = mix(base, tint * (base.mean() / 140 + 0.35), k)
        t.rough[y, x] = 175
    # rim of the stain darker (dried edge)
    for (x, y) in [(3, 10), (9, 11), (4, 12), (8, 12), (5, 13), (7, 13)]:
        t.rgb[y, x] = shade(t.rgb[y, x], 0.85)


# ------------------------------------------------------------------ small tile floors
def small_tiles(seed, pal_a, pal_b, grout, checker, grime, rough_tile, greasy=False):
    r = rng(seed)
    t = Tex(rough=220, height=80)
    n = fbm(W, H, seed, cells=(8, 4), weights=(0.6, 0.4))
    wn = white(W, H, seed + 7)
    tile_tone = r.normal(0, 0.09, (4, 4))
    dirty = r.random((4, 4))
    for y in range(H):
        for x in range(W):
            gx, gy = x % 4, y % 4
            tx, ty = x // 4, y // 4
            if gx == 0 or gy == 0:
                v = 0.6 * n[y, x] + 0.4 * wn[y, x]
                t.rgb[y, x] = quant(np.array([v]), grout)[0]
                t.height[y, x] = 70
                t.rough[y, x] = 230
                continue
            pal = pal_b if (checker and (tx + ty) % 2) else pal_a
            v = 0.5 + tile_tone[ty, tx] + 0.2 * (wn[y, x] - 0.5) + 0.15 * (n[y, x] - 0.5)
            if gx == 1 and gy == 1:
                v += 0.25
            elif gx == 3 and gy == 3:
                v -= 0.25
            elif gx == 3 or gy == 3:
                v -= 0.1
            idx = int(np.clip(v * len(pal), 0, len(pal) - 1))
            c = pal[idx]
            if dirty[ty, tx] > 0.72:
                c = mix(c, grime, 0.25 + 0.1 * wn[y, x])
            t.rgb[y, x] = c
            t.height[y, x] = 200 if not (gx == 3 or gy == 3) else 185
            t.rough[y, x] = rough_tile + 25 * wn[y, x]
    if greasy:
        g = blur_wrap(white(W, H, seed + 9), 2)
        g = norm01(g)
        m = g > 0.72
        t.rgb[m] = mix(t.rgb[m], hexc('#6b5a2c'), 0.22)
        t.rough[m] = 70  # grease film is shiny
    return t


def tile_office():
    pal = ramp('#24282d', '#2c3036', '#333840', '#3a4048', '#464d56')
    grout = ramp('#141518', '#191a1d', '#1e2023', '#24262a')
    return small_tiles(303, pal, pal, grout, False, hexc('#2a251d'), 115)


def tile_kitchen():
    red = ramp('#5a1f17', '#6a271d', '#772e22', '#843528', '#8f3d2f')
    wht = ramp('#958d7c', '#a59d8b', '#b2aa98', '#bdb6a4', '#c8c1b0')
    grout = ramp('#2b2622', '#332d28', '#3b352f', '#423b34')
    return small_tiles(404, red, wht, grout, True, hexc('#5e4a22'), 110, greasy=True)


# ------------------------------------------------------------------ walls
def wall_checker():
    seed = 505
    t = Tex(rough=70, height=200)
    wn = white(W, H, seed)
    n = fbm(W, H, seed, cells=(8, 4), weights=(0.6, 0.4))
    black = ramp('#141417', '#1a1a1d', '#202024', '#2c2c32')
    whitep = ramp('#a39d90', '#b5afa2', '#c3beb2', '#d1ccc2')
    rule = ramp('#0d0d0f', '#121214', '#17171a')
    grout = ramp('#4a463f', '#56524b', '#615c55')
    for y in range(H):
        for x in range(W):
            if y in (0, 15):
                t.rgb[y, x] = quant(np.array([wn[y, x]]), rule)[0]
                t.rough[y, x] = 120
                t.height[y, x] = 230
                continue
            if y in (1, 14):
                t.rgb[y, x] = quant(np.array([0.5 * wn[y, x] + 0.5 * n[y, x]]), grout)[0]
                t.rough[y, x] = 200
                t.height[y, x] = 120
                continue
            cy, cx = (y - 2) // 4, x // 4
            ly, lx = (y - 2) % 4, x % 4
            is_black = (cx + cy) % 2 == 0
            pal = black if is_black else whitep
            v = 0.45 + 0.25 * (wn[y, x] - 0.5) + 0.2 * (n[y, x] - 0.5)
            if ly == 0 or lx == 0:
                v += 0.3
            if ly == 3 or lx == 3:
                v -= 0.3
            idx = int(np.clip(v * 4, 0, 3))
            t.rgb[y, x] = pal[idx]
            t.rough[y, x] = 60 + 20 * wn[y, x]
            t.height[y, x] = 200 if 0 < ly < 3 and 0 < lx < 3 else 188
    # grime creeping into the lower edge
    for x in range(W):
        if wn[13, x] > 0.6:
            t.rgb[13, x] = mix(t.rgb[13, x], hexc('#4b4234'), 0.35)
    return t


def plaster(stained=False):
    seed = 606 if not stained else 707
    r = rng(seed)
    t = Tex(rough=225, height=150)
    pal = ramp('#434a53', '#4b535c', '#535b65', '#5b636d', '#626b75', '#6a737d')
    n = fbm(W, H, seed, cells=(8, 4, 2), weights=(0.45, 0.35, 0.2))
    wn = white(W, H, seed + 3)
    v = 0.62 * n + 0.38 * wn
    v = norm01(v) * 0.9 + 0.05
    t.rgb = quant(v, pal)
    t.height = 140 + 30 * v
    t.rough = 215 + 25 * wn
    # faint vertical water streak at x=11 (with a 1-px trail at x=12 near the top)
    for y in range(H):
        k = 0.88 if (y + 3) % 7 else 0.82
        t.rgb[y, 11] = shade(t.rgb[y, 11], k)
        if y < 6:
            t.rgb[y, 12] = shade(t.rgb[y, 12], 0.93)
    if stained:
        _stain_plaster(t, r, wn, n)
    return t


def _stain_plaster(t, r, wn, n):
    base = t.rgb.copy()
    # brown tide stain from the top with a wavy (horizontally tiling) edge, two tide lines
    xs = np.arange(W)
    edge = 8.5 + 2.2 * np.sin(2 * np.pi * xs / 16 + 0.7) + 1.3 * np.sin(2 * np.pi * xs * 2 / 16 + 2.1)
    edge = np.rint(edge + (tile_noise(W, 1, 2, 917)[0] - 0.5) * 1.6).astype(int)
    for x in range(W):
        e = edge[x]
        for y in range(H):
            if y < e - 2:
                k = 0.30 + 0.12 * wn[y, x] + 0.1 * (y / e)
                t.rgb[y, x] = mix(base[y, x], hexc('#57503f'), k)
            elif y < e:
                t.rgb[y, x] = mix(base[y, x], hexc('#57503f'), 0.42)
            elif y == e:
                t.rgb[y, x] = mix(base[y, x], hexc('#3c3428'), 0.62)  # dried tide line
                t.rough[y, x] = 235
            elif y == e + 1:
                t.rgb[y, x] = mix(base[y, x], hexc('#57503f'), 0.15)
        y2 = max(0, e - 4)
        t.rgb[y2, x] = mix(t.rgb[y2, x], hexc('#3c3428'), 0.3)  # older, fainter tide line
    # drip running down from the tide line
    for y in range(edge[4] + 1, 14):
        t.rgb[y, 4] = mix(base[y, 4], hexc('#4a4234'), 0.4 if y < 12 else 0.25)
    # peeling paint: an irregular patch showing concrete at the lower right
    peel_rows = {10: (10, 13), 11: (9, 14), 12: (8, 14), 13: (9, 13), 14: (11, 12)}
    P = set()
    for y, (a, b) in peel_rows.items():
        for x in range(a, b + 1):
            P.add((x, y))
    conc = ramp('#55534e', '#5e5c57', '#68665f', '#716f68')
    for (x, y) in P:
        t.rgb[y, x] = conc[int(np.clip(wn[y, x] * 3.2 + 0.4, 0, 3))]
        t.height[y, x] = 100
        t.rough[y, x] = 245
        if (x, y - 1) not in P:
            t.rgb[y, x] = conc[0]  # paint edge casts a shadow onto the concrete
    for (x, y) in P:
        if (x, y - 1) not in P:
            t.rgb[y - 1, x] = hexc('#6d7680')  # curled paint lip catches light
            t.height[y - 1, x] = 185
        if (x, y + 1) not in P and y + 1 < H:
            t.rgb[y + 1, x] = shade(t.rgb[y + 1, x], 0.86)
        for dx in (-1, 1):
            if (x + dx, y) not in P:
                t.rgb[y, x + dx] = shade(t.rgb[y, x + dx], 0.9)
    # a small flake at the top left
    for (x, y) in [(2, 3), (3, 3), (3, 4)]:
        t.rgb[y, x] = conc[1]
        t.height[y, x] = 105
    t.rgb[2, 2] = t.rgb[2, 3] = hexc('#6a6a64')
    # mould specks along the bottom
    for x in range(W):
        if wn[15, x] > 0.55:
            t.rgb[15, x] = mix(t.rgb[15, x], hexc('#232821'), 0.5)
        if wn[14, x] > 0.8:
            t.rgb[14, x] = mix(t.rgb[14, x], hexc('#232821'), 0.35)


def wallpaper_maroon():
    seed = 808
    t = Tex(rough=232, height=150)
    pal = ramp('#280c12', '#331016', '#3d121a', '#4d1821', '#571c26', '#62232c')
    wn = white(W, H, seed + 1)
    n = tile_noise(W, H, 8, seed)
    # diamond trellis (diagonals crossing every 4 px) with a small fleur inside each diamond
    lat = (((XX + YY) % 8) == 0) | (((XX - YY) % 8) == 0)
    idx = np.full((H, W), 3)
    idx[lat] = 2
    for (cx, cy) in [(4, 0), (0, 4), (12, 0), (8, 4), (4, 8), (0, 12), (12, 8), (8, 12)]:
        idx[cy, cx] = 1
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            idx[(cy + dy) % H, (cx + dx) % W] = 2
    cross = (((XX % 4) == 0) & ((YY % 4) == 0)) & lat
    idx[cross] = 4  # embossed crossings
    jit = ((wn > 0.95).astype(int) - (wn < 0.04).astype(int)) * (idx == 3)
    idx += jit + np.rint((n - 0.5) * 0.9).astype(int) * (idx == 3)
    t.rgb = pal[np.clip(idx, 0, len(pal) - 1)]
    t.height = 150 - 12 * (idx < 3)
    # worn: a few scuffed, faded pixels and a dirty lower band
    scuff = [(5, 11), (6, 11), (6, 12), (13, 5), (14, 5), (2, 7)]
    for (x, y) in scuff:
        t.rgb[y, x] = mix(t.rgb[y, x], hexc('#6a4b4e'), 0.3)
        t.rough[y, x] = 245
    t.rgb = mix(t.rgb, hexc('#2a1a14'), np.clip((YY - 11) / 14.0, 0, 0.3) * (0.6 + 0.8 * n))
    # vertical paper seam at x = 15, slightly lifted
    for y in range(H):
        t.rgb[y, 15] = shade(t.rgb[y, 15], 1.12 if y % 5 else 1.02)
        t.height[y, 15] = 168
    return t


def wall_trim():
    seed = 909
    t = Tex(rough=150, height=170)
    pal = ramp('#1f2126', '#24272c', '#292c32', '#2e3238', '#353940')
    n = tile_noise(W, H, 4, seed)
    wn = white(W, H, seed + 1)
    # faint horizontal grain
    grain = np.repeat(tile_noise(1, H, 2, seed + 2)[:, :1], W, 1)
    v = 0.5 + 0.25 * (n - 0.5) + 0.25 * (wn - 0.5) + 0.25 * (grain - 0.5)
    t.rgb = quant(np.clip(v, 0, 0.999), pal)
    red = ramp('#5c1717', '#6c1c1c', '#7a1f1f', '#872626')
    for x in range(W):
        t.rgb[6, x] = mix(t.rgb[6, x], hexc('#4a4e56'), 0.6)  # rail top catches light
        t.rgb[7, x] = red[3] if wn[7, x] > 0.25 else red[2]
        t.rgb[8, x] = red[1] if wn[8, x] > 0.3 else red[0]
        t.rgb[9, x] = hexc('#15161a')  # shadow under the rail
        t.height[6, x] = 215
        t.height[7, x] = 225
        t.height[8, x] = 215
        t.height[9, x] = 150
        t.rough[7, x] = t.rough[8, x] = 120
    # chips in the red paint
    for (x, y) in [(4, 7), (11, 8), (12, 8)]:
        t.rgb[y, x] = hexc('#3a2e2a')
    # scuffs on the lower half
    for (x, y) in [(2, 12), (3, 12), (9, 13), (10, 13), (14, 11)]:
        t.rgb[y, x] = hexc('#3b3f46')
    return t


def cinderblock_painted():
    seed = 1001
    t = Tex(rough=235, height=170)
    pal = ramp('#7c7d79', '#868783', '#90918d', '#999a96', '#a2a39f', '#abaca8')
    n = fbm(W, H, seed, cells=(8, 4, 2), weights=(0.4, 0.35, 0.25))
    wn = white(W, H, seed + 2)
    v = 0.6 + 0.3 * (n - 0.5) + 0.25 * (wn - 0.5)
    mortar = np.zeros((H, W), bool)
    mortar[7, :] = True
    mortar[15, :] = True
    mortar[0:7, 15] = True
    mortar[8:15, 7] = True
    # bevel: top/left of each block face lighter, bottom/right darker
    top = np.zeros((H, W), bool)
    top[0, :] = True
    top[8, :] = True
    left = np.zeros((H, W), bool)
    left[0:7, 0] = True
    left[8:15, 8] = True
    bot = np.zeros((H, W), bool)
    bot[6, :] = True
    bot[14, :] = True
    v[top | left] += 0.15
    v[bot] -= 0.15
    # grime rising from the bottom
    g = np.clip((YY - 10) / 6.0, 0, 1) * (0.6 + 0.4 * tile_noise(W, H, 4, seed + 9))
    v -= 0.35 * g
    t.rgb = quant(np.clip(v, 0, 0.999), pal)
    t.rgb = mix(t.rgb, hexc('#5a5040'), 0.25 * g)
    mpal = ramp('#5f605c', '#686965', '#71726e')
    for y in range(H):
        for x in range(W):
            if mortar[y, x]:
                t.rgb[y, x] = quant(np.array([wn[y, x] * (1 - 0.6 * g[y, x])]), mpal)[0]
                t.height[y, x] = 110
                t.rough[y, x] = 245
    # pores
    pores = (wn > 0.9) & ~mortar
    t.rgb[pores] = shade(t.rgb[pores], 0.84)
    t.height[pores] = 150
    t.height[top | left] = 185
    return t


# ------------------------------------------------------------------ ceilings
def ceiling_tile(stained=False):
    seed = 1101 if not stained else 1202
    t = Tex(rough=245, height=150)
    pal = ramp('#958f78', '#a09a83', '#aaa48c', '#b3ad95', '#bcb69e')
    bar = ramp('#5e5d58', '#6c6b66', '#7b7a74', '#8a8983')
    n = fbm(W, H, seed, cells=(8, 4), weights=(0.6, 0.4))
    wn = white(W, H, seed + 1)
    v = 0.62 + 0.25 * (n - 0.5) + 0.2 * (wn - 0.5)
    grid = (XX % 8 == 0) | (YY % 8 == 0)
    lx, ly = XX % 8, YY % 8
    v[(lx == 1) | (ly == 1)] -= 0.12  # recessed next to the T-bar
    v[(lx == 7) | (ly == 7)] += 0.05
    t.rgb = quant(np.clip(v, 0, 0.999), pal)
    # pinholes / fissures
    holes = (wn > 0.84) & ~grid
    t.rgb[holes] = shade(t.rgb[holes], 0.8)
    t.height[holes] = 120
    for y in range(H):
        for x in range(W):
            if grid[y, x]:
                hv = 0.55 + 0.3 * (wn[y, x] - 0.5)
                if x % 8 == 0 and y % 8 == 0:
                    hv -= 0.3
                t.rgb[y, x] = quant(np.array([hv]), bar)[0]
                t.height[y, x] = 190
                t.rough[y, x] = 170
                t.metal[y, x] = 60
    if stained:
        _stain_ceiling(t, wn)
    return t


def _stain_ceiling(t, wn):
    # big brown water stain spanning the top-left tile and the bar
    cx, cy = 5.5, 6.0
    d = np.sqrt(((XX - cx) / 1.1) ** 2 + (YY - cy) ** 2) + 1.2 * (tile_noise(W, H, 4, 1212) - 0.5) * 2
    inner = d < 4.6
    ring = (d >= 4.6) & (d < 5.6)
    t.rgb[inner] = mix(t.rgb[inner], hexc('#6e5534'), 0.42)
    t.rgb[ring] = mix(t.rgb[ring], hexc('#5a4024'), 0.6)
    core = d < 2.2
    t.rgb[core] = mix(t.rgb[core], hexc('#5a4024'), 0.25)
    # rust on the T-bar crossing
    for (x, y) in [(8, 3), (8, 4), (3, 8), (4, 8), (8, 8)]:
        t.rgb[y, x] = hexc('#6b4a2e')
    # sagging dark tile at bottom-right (x 9..15, y 9..15)
    for y in range(9, 16):
        for x in range(9, 16):
            lx, ly = x - 9, y - 9
            sag = 1 - (abs(lx - 3) + abs(ly - 3)) / 7.0
            k = 0.74 - 0.12 * sag
            t.rgb[y, x] = mix(shade(t.rgb[y, x], k), hexc('#4a3c27'), 0.3)
            t.height[y, x] = 120 - 30 * sag
            t.rough[y, x] = 250
    # gap where the tile dropped: black void along its top and left edge
    for x in range(10, 16):
        t.rgb[9, x] = hexc('#2a241b') if x % 4 else hexc('#1a1610')
    for y in range(10, 16):
        t.rgb[y, 9] = hexc('#3a3226')


# ------------------------------------------------------------------ fabrics
def carpet_party():
    seed = 1303
    t = Tex(rough=250, height=150)
    pal = ramp('#14112a', '#191530', '#1d1937', '#221d3e', '#272246')
    wn = white(W, H, seed)
    n = tile_noise(W, H, 4, seed + 1)
    v = 0.5 + 0.35 * (wn - 0.5) + 0.25 * (n - 0.5)
    t.rgb = quant(np.clip(v, 0, 0.999), pal)
    t.height = 140 + 30 * wn
    pink, teal, yel = hexc('#b23d82'), hexc('#2b9e9a'), hexc('#c6ad3a')
    pink_d, teal_d, yel_d = hexc('#7a2c5c'), hexc('#226e6c'), hexc('#857626')
    motifs = [
        # squiggle (pink)
        (pink, pink_d, [(1, 2), (2, 1), (3, 2), (4, 3), (5, 2)]),
        # triangle outline (teal)
        (teal, teal_d, [(10, 3), (9, 4), (11, 4), (8, 5), (9, 5), (10, 5), (11, 5), (12, 5)]),
        # dots (yellow)
        (yel, yel_d, [(6, 7)]), (yel, yel_d, [(14, 10)]), (yel, yel_d, [(2, 14)]),
        # squiggle (teal), wraps around the right edge
        (teal, teal_d, [(12, 13), (13, 12), (14, 13), (15, 14), (0, 13)]),
        # triangle (pink, filled small)
        (pink, pink_d, [(4, 10), (3, 11), (4, 11), (5, 11)]),
        # zigzag (yellow)
        (yel, yel_d, [(9, 9), (10, 8), (11, 9)]),
        (pink, pink_d, [(15, 6)]), (teal, teal_d, [(7, 13)]),
    ]
    for col, dark, pts in motifs:
        for i, (x, y) in enumerate(pts):
            c = col if wn[y, x] > 0.3 else dark
            t.rgb[y, x] = mix(c, hexc('#3a3550'), 0.18)  # dusty, faded
    # wear path: slightly lighter, matted centre
    m = norm01(blur_wrap(white(W, H, seed + 4), 2)) > 0.75
    t.rgb[m] = mix(t.rgb[m], hexc('#3b364c'), 0.25)
    return t


def curtain(seed, pal, stars=False):
    t = Tex(rough=245, height=150)
    # two folds per block: brightness profile along x (period 8)
    prof = np.array([0.18, 0.38, 0.62, 0.82, 0.92, 0.78, 0.5, 0.28])
    fold = prof[XX % 8]
    streak = np.repeat(tile_noise(W, 1, 2, seed)[0][None, :], H, 0)
    vn = tile_noise(W, H, 4, seed + 1)
    wn = white(W, H, seed + 2)
    v = fold + 0.12 * (streak - 0.5) + 0.12 * (vn - 0.5) + 0.12 * (wn - 0.5)
    t.rgb = quant(np.clip(v, 0, 0.999), pal)
    t.height = 90 + 120 * fold
    t.rough = 240 + 12 * wn
    # dust on the fold crests
    crest = (fold > 0.85) & (wn > 0.75)
    t.rgb[crest] = mix(t.rgb[crest], hexc('#6f6870'), 0.18)
    if stars:
        gold = ramp('#5e4720', '#86692a', '#b08a33', '#d4a93c')
        for (sx, sy) in [(3, 3), (11, 9), (6, 13), (14, 1)]:
            lit = fold[sy, sx]
            c = 3 if lit > 0.6 else (2 if lit > 0.35 else 1)
            t.rgb[sy, sx] = gold[c]
            for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                x, y = (sx + dx) % W, (sy + dy) % H
                t.rgb[y, x] = mix(t.rgb[y, x], gold[c - 1], 0.5)
                t.metal[y, x] = 90
                t.rough[y, x] = 150
            t.metal[sy, sx] = 140
            t.rough[sy, sx] = 110
            t.height[sy, sx] += 12
    return t


def curtain_purple():
    pal = ramp('#1d0d26', '#26112f', '#2f1539', '#381a44', '#401f4f', '#4a2559', '#552c65')
    return curtain(1404, pal, stars=True)


def curtain_red():
    pal = ramp('#2c090c', '#3a0d11', '#491116', '#57151a', '#65191e', '#731e23', '#80262a')
    return curtain(1505, pal)


def tent_stripe():
    seed = 1606
    t = Tex(rough=240, height=150)
    red = ramp('#5f1f1c', '#6b2420', '#762925', '#802f2a')
    cream = ramp('#a59d88', '#b2aa94', '#bdb59f', '#c6bfa9')
    wn = white(W, H, seed)
    n = fbm(W, H, seed, cells=(8, 4), weights=(0.6, 0.4))
    weave = ((XX + YY) % 2) * 0.12
    v = 0.45 + 0.25 * (n - 0.5) + 0.2 * (wn - 0.5) + weave
    stripe = (XX // 4) % 2 == 0
    t.rgb = np.where(stripe[..., None], quant(np.clip(v, 0, .999), red), quant(np.clip(v, 0, .999), cream))
    # sun-faded at the top, grimy at the bottom
    t.rgb = mix(t.rgb, hexc('#8b8070'), np.clip((4 - YY) / 10.0, 0, 0.25))
    t.rgb = mix(t.rgb, hexc('#3d342a'), np.clip((YY - 11) / 12.0, 0, 0.25) * (0.5 + n))
    # stitched seam (darker) at stripe edges every 8 px
    for y in range(0, H, 2):
        t.rgb[y, 7] = shade(t.rgb[y, 7], 0.85)
        t.rgb[y, 15] = shade(t.rgb[y, 15], 0.85)
    t.height = 140 + 25 * weave / 0.12 + 10 * wn
    return t


# ------------------------------------------------------------------ metal
def duct_metal():
    seed = 1707
    r = rng(seed)
    t = Tex(rough=135, metal=180, height=160)
    pal = ramp('#6c7176', '#767b80', '#7f8489', '#888d92', '#92979c', '#9ca1a6')
    # galvanised spangle: blocky voronoi patches
    pts = r.random((7, 2)) * 16
    vals = r.random(7)
    d = np.full((H, W), 1e9)
    v = np.zeros((H, W))
    for (px, py), val in zip(pts, vals):
        for ox in (-16, 0, 16):
            for oy in (-16, 0, 16):
                dd = (XX - px - ox) ** 2 + (YY - py - oy) ** 2
                m = dd < d
                d[m] = dd[m]
                v[m] = val
    wn = white(W, H, seed + 1)
    v = 0.45 + 0.35 * (v - 0.5) + 0.2 * (wn - 0.5)
    t.rgb = quant(np.clip(v, 0, .999), pal)
    t.rough = 120 + 40 * wn
    # seam band at rows 0 and 15 (lap joint), rivets every 4 px
    for x in range(W):
        t.rgb[15, x] = hexc('#4b4f53')
        t.rgb[0, x] = hexc('#a4a9ad')
        t.rgb[1, x] = shade(t.rgb[1, x], 0.9)
        t.height[15, x] = 110
        t.height[0, x] = 200
    for x in (2, 6, 10, 14):
        t.rgb[2, x] = hexc('#b2b6ba')
        t.rgb[3, x] = hexc('#565a5e')
        t.height[2, x] = 230
    # vertical crease (break line) at x = 8
    for y in range(4, 15):
        t.rgb[y, 8] = shade(t.rgb[y, 8], 1.08)
        t.rgb[y, 9] = shade(t.rgb[y, 9], 0.9)
    # dust: brownish-grey specks, more towards the bottom
    dust = (wn > 0.82) & (YY > 6)
    dust |= (wn > 0.94)
    t.rgb[dust] = mix(t.rgb[dust], hexc('#6a6255'), 0.3)
    t.rough[dust] = 200
    t.metal[dust] = 110
    # a dull film of dust over the whole sheet: metal reads less mirror-like
    t.rgb = mix(t.rgb, hexc('#5d5a52'), 0.12)
    return t


def stage_floor():
    seed = 1808
    r = rng(seed)
    t = Tex(rough=150, height=170)
    paint = ramp('#111010', '#151413', '#191817', '#1d1c1a', '#22201e', '#282624')
    wood = ramp('#3b2918', '#4a3420', '#59402a', '#684c33')
    wn = white(W, H, seed)
    n = tile_noise(W, H, 4, seed + 1)
    rowgrain = np.repeat(white(1, H, seed + 2), W, 1)
    v = 0.5 + 0.22 * (wn - 0.5) + 0.2 * (n - 0.5) + 0.2 * (rowgrain - 0.5)
    t.rgb = quant(np.clip(v, 0, .999), paint)
    joints = {0: 5, 1: 13, 2: 2, 3: 9}
    wear = {0: [(7, 10)], 1: [(0, 3), (14, 15)], 2: [(4, 8)], 3: [(11, 14)]}
    for b in range(4):
        y0 = b * 4
        for x in range(W):
            t.rgb[y0 + 3, x] = hexc('#090808')  # gap between boards
            t.height[y0 + 3, x] = 95
            t.rgb[y0, x] = shade(t.rgb[y0, x], 1.2)  # board edge highlight
            t.height[y0, x] = 185
        jx = joints[b]
        for y in range(y0, y0 + 3):
            t.rgb[y, jx] = hexc('#0b0a09')
            t.height[y, jx] = 105
        t.rgb[y0, (jx + 1) % W] = shade(t.rgb[y0, (jx + 1) % W], 1.2)
        # paint worn through to bare wood in short streaks along the board edge
        for (a, bb) in wear[b]:
            for x in range(a, bb + 1):
                lvl = 2 if x in (a, bb) else 3
                t.rgb[y0, x] = wood[lvl]
                t.rough[y0, x] = 205
                if wn[y0 + 1, x] > 0.55 and x not in (a, bb):
                    t.rgb[y0 + 1, x] = wood[1]
                    t.rough[y0 + 1, x] = 205
    # gaffer tape spike marks: faded yellow strip and a grey-white one
    for x in (10, 11, 12):
        t.rgb[5, x] = hexc('#8f7d36') if x != 12 else hexc('#7a6a2f')
        t.rough[5, x] = 175
        t.height[5, x] = 182
    for x in (2, 3):
        t.rgb[13, x] = hexc('#8e8c85') if x == 2 else hexc('#75736d')
        t.rough[13, x] = 175
        t.height[13, x] = 182
    return t


def door_shutter(bottom=False):
    seed = 1909 if not bottom else 2010
    r = rng(seed)
    t = Tex(rough=110, metal=200, height=160)
    slat = [hexc('#8a9096'), hexc('#6f757b'), hexc('#646a70'), hexc('#5a6066'), hexc('#3a3e43')]
    wn = white(W, H, seed)
    n = tile_noise(W, H, 4, seed + 1)
    for y in range(H):
        ly = y % 4
        for x in range(W):
            base = slat[[0, 1, 2, 4][ly]] if ly != 2 else slat[2 if wn[y, x] > 0.3 else 3]
            k = 1 + 0.08 * (n[y, x] - 0.5) + 0.06 * (wn[y, x] - 0.5)
            t.rgb[y, x] = shade(base, k)
            t.height[y, x] = [210, 190, 175, 110][ly]
            t.rough[y, x] = 100 + 40 * wn[y, x]
    # rivets at both sides of every slat
    for y0 in range(0, 16, 4):
        for x in (1, 14):
            t.rgb[y0 + 1, x] = hexc('#a7adb3')
            t.rgb[y0 + 2, x] = hexc('#3f4348')
            t.height[y0 + 1, x] = 240
    # scratches (light diagonal) and rust specks
    for (x, y) in [(4, 5), (5, 6), (6, 6), (9, 1), (10, 2), (11, 9), (12, 10)]:
        t.rgb[y, x] = hexc('#9da3a8')
        t.rough[y, x] = 70
    for (x, y) in [(7, 11), (8, 11), (3, 13), (13, 6)]:
        t.rgb[y, x] = hexc('#6a4a32')
        t.rough[y, x] = 220
        t.metal[y, x] = 40
    if bottom:
        yel, yel_d, blk = hexc('#b39224'), hexc('#8e7420'), hexc('#1c1c1c')
        for y in range(11, 16):
            for x in range(W):
                s = ((x + (15 - y)) // 3) % 2 == 0
                c = yel if s else blk
                if s and wn[y, x] > 0.8:
                    c = yel_d  # worn paint
                if s and wn[y, x] > 0.93:
                    c = hexc('#6f757b')  # scratched to steel
                t.rgb[y, x] = c
                t.metal[y, x] = 40 if c is not None else 200
                t.rough[y, x] = 150
                t.height[y, x] = 200
        for x in range(W):
            t.rgb[10, x] = hexc('#2f3337')  # lip above the hazard band
            t.height[10, x] = 120
            t.rgb[15, x] = shade(t.rgb[15, x], 0.7)  # rubber seal shadow
    return t


ALL = {
    'tile_checker': lambda: tile_checker(False),
    'tile_checker_worn': lambda: tile_checker(True),
    'tile_office': tile_office,
    'tile_kitchen': tile_kitchen,
    'wall_checker': wall_checker,
    'wall_plaster': lambda: plaster(False),
    'wall_plaster_stained': lambda: plaster(True),
    'wallpaper_maroon': wallpaper_maroon,
    'wall_trim': wall_trim,
    'cinderblock_painted': cinderblock_painted,
    'ceiling_tile': lambda: ceiling_tile(False),
    'ceiling_tile_stained': lambda: ceiling_tile(True),
    'carpet_party': carpet_party,
    'curtain_purple': curtain_purple,
    'curtain_red': curtain_red,
    'tent_stripe': tent_stripe,
    'duct_metal': duct_metal,
    'stage_floor': stage_floor,
    'door_shutter': lambda: door_shutter(False),
    'door_shutter_bottom': lambda: door_shutter(True),
}


def build():
    out = []
    for name, fn in ALL.items():
        t = fn()
        t.save(name)
        out.append((name, t))
    return out


if __name__ == '__main__':
    import sys
    from pixlib import contact_sheet
    res = build()
    path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/cubes_sheet.png'
    contact_sheet([(n, t.color()) for n, t in res], path, scale=8, cols=4)
    print('wrote', len(res), 'textures; sheet', path)
