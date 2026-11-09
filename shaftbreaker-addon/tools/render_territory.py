#!/usr/bin/env python3
"""Renders a cut-away preview of a territory region dumped by tools/sim/run-sim.mjs.

Uses the add-on's real block textures, Minecraft-style light propagation from glowing blocks,
and an orthographic camera. Purely a preview tool.
usage: render_territory.py region.json out.png
"""
import json
import math
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'RP', 'textures', 'blocks')

reg = json.load(open(sys.argv[1]))
R, Y0, Y1 = reg['R'], reg['Y0'], reg['Y1']
pal = reg['pal']
data = np.array(reg['data'], dtype=np.int32).reshape((Y1 - Y0 + 1, 2 * R + 1, 2 * R + 1))  # [y][z][x]
NY, NZ, NX = data.shape


def ident(i):
    s = pal[i]
    return s.split('|')[0], (json.loads(s.split('|')[1]) if '|' in s else {})


rng = np.random.default_rng(3)


def stone_tex(base, var):
    t = np.zeros((16, 16, 4), np.uint8)
    n = rng.integers(-var, var + 1, (16, 16))
    for c in range(3):
        t[..., c] = np.clip(base[c] + n, 0, 255)
    t[..., 3] = 255
    return t


cache = {}


def tex(name):
    if name in cache:
        return cache[name]
    if name == 'stone':
        t = stone_tex((125, 125, 125), 14)
    elif name == 'deepslate':
        t = stone_tex((72, 72, 78), 10)
    elif name == 'andesite':
        t = stone_tex((136, 136, 134), 12)
    else:
        im = Image.open(os.path.join(TEX, name + '.png')).convert('RGBA')
        t = np.asarray(im)[:16, :16].copy()
    cache[name] = t
    return t


FULL = {
    'minecraft:stone': ('stone', 'stone'), 'minecraft:andesite': ('andesite', 'andesite'),
    'minecraft:deepslate': ('deepslate', 'deepslate'), 'minecraft:bedrock': ('deepslate', 'deepslate'),
    'shaftbreaker:veinstone': ('veinstone', 'veinstone'), 'shaftbreaker:deep_veinstone': ('deep_veinstone_top', 'deep_veinstone'),
    'shaftbreaker:cracked_veinstone': ('cracked_veinstone', 'cracked_veinstone'), 'shaftbreaker:fleshstone': ('fleshstone', 'fleshstone'),
    'shaftbreaker:pulsing_flesh': ('pulsing_flesh', 'pulsing_flesh'), 'shaftbreaker:organ_core': ('organ_core', 'organ_core'),
    'shaftbreaker:cracked_organ_core': ('cracked_organ_core', 'cracked_organ_core'),
    'shaftbreaker:dwelling_heart': ('dwelling_heart', 'dwelling_heart'), 'shaftbreaker:bloodmoss': ('bloodmoss', 'bloodmoss_side'),
    'shaftbreaker:ribstone': ('ribstone_top', 'ribstone_side'),
    'shaftbreaker:scored_stone': ('scored_stone_2', 'scored_stone_2'), 'shaftbreaker:scored_deepslate': ('scored_deepslate_2', 'scored_deepslate_2'),
}
SPRITE = {'shaftbreaker:bloodroot_vines': 'bloodroot_vines', 'shaftbreaker:hanging_tissue': 'hanging_tissue',
          'shaftbreaker:crimson_thorns': 'crimson_thorns', 'shaftbreaker:glowspore_cluster': 'glowspore_cluster',
          'shaftbreaker:skull_pile': 'skull_pile', 'shaftbreaker:bone_chime': 'bone_chime'}
LIGHT = {'shaftbreaker:cracked_veinstone': 5, 'shaftbreaker:pulsing_flesh': 3, 'shaftbreaker:organ_core': 7,
         'shaftbreaker:dwelling_heart': 10, 'shaftbreaker:glowspore_cluster': 8, 'shaftbreaker:crimson_thorns': 2,
         'shaftbreaker:watcher_pod': 1, 'shaftbreaker:watcher_pod_open': 6}

ids = [ident(i) for i in range(len(pal))]
is_solid = np.array([i[0] in FULL for i in ids])
solid = is_solid[data]
emit = np.array([LIGHT.get(i[0], 0) for i in ids])[data]

# --- Minecraft-style block light (BFS, -1 per step through non-solid blocks)
light = np.zeros(data.shape, np.int32)
q = deque()
for y, z, x in zip(*np.nonzero(emit)):
    light[y, z, x] = emit[y, z, x]
    q.append((y, z, x))
while q:
    y, z, x = q.popleft()
    lv = light[y, z, x] - 1
    if lv <= 0:
        continue
    for dy, dz, dx in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
        ny, nz, nx = y + dy, z + dz, x + dx
        if 0 <= ny < NY and 0 <= nz < NZ and 0 <= nx < NX and not solid[ny, nz, nx] and light[ny, nz, nx] < lv:
            light[ny, nz, nx] = lv
            q.append((ny, nz, nx))

ZCUT = int(sys.argv[3]) if len(sys.argv) > 3 else -6  # blocks with world z < ZCUT are removed (cut-away)
YCUT = int(sys.argv[7]) if len(sys.argv) > 7 else Y1 - 6
NOHANG = len(sys.argv) > 8 and sys.argv[8] == 'nohang'

# --- build quads: (4 world points, texture name, brightness, emissive)
quads = []


def bright(y, z, x, emissive=0):
    if 0 <= y < NY and 0 <= z < NZ and 0 <= x < NX:
        lv = max(light[y, z, x], emissive)
    else:
        lv = 0
    return 0.34 + 0.66 * (lv / 15.0) ** 1.1


def wx(x):
    return x - R


def wz(z):
    return z - R


CROP = float(sys.argv[6]) if len(sys.argv) > 6 else 1e9


def visible_cell(y, z, x):
    return wz(z) >= ZCUT and y + Y0 <= YCUT and abs(wx(x)) <= CROP and abs(wz(z)) <= CROP


for y in range(NY):
    for z in range(NZ):
        for x in range(NX):
            if not visible_cell(y, z, x):
                continue
            bid, st = ids[data[y, z, x]]
            X, Y, Z = wx(x), y + Y0, wz(z)
            if bid in FULL:
                top, side = FULL[bid]
                em = LIGHT.get(bid, 0)
                for dy, dz, dx, name in ((1, 0, 0, top), (0, -1, 0, side), (0, 0, -1, side), (0, 0, 1, side), (0, 1, 0, side), (-1, 0, 0, top)):
                    ny, nz, nx = y + dy, z + dz, x + dx
                    open_n = not (0 <= ny < NY and 0 <= nz < NZ and 0 <= nx < NX) or not solid[ny, nz, nx] or not visible_cell(ny, nz, nx)
                    if not open_n:
                        continue
                    cut = not (0 <= ny < NY and 0 <= nz < NZ and 0 <= nx < NX) or (solid[ny, nz, nx] and not visible_cell(ny, nz, nx)) or not visible_cell(ny, nz, nx)
                    if cut:
                        continue
                    # back-face culling for a camera above and in front (looking toward +z, downward)
                    if dy == -1 or dz == 1:
                        continue
                    b = bright(ny, nz, nx, em)
                    if dy == 1:
                        pts = [(X, Y + 1, Z), (X + 1, Y + 1, Z), (X + 1, Y + 1, Z + 1), (X, Y + 1, Z + 1)]
                    elif dy == -1:
                        pts = [(X, Y, Z + 1), (X + 1, Y, Z + 1), (X + 1, Y, Z), (X, Y, Z)]
                    elif dz == -1:
                        pts = [(X, Y + 1, Z), (X + 1, Y + 1, Z), (X + 1, Y, Z), (X, Y, Z)]
                    elif dz == 1:
                        pts = [(X + 1, Y + 1, Z + 1), (X, Y + 1, Z + 1), (X, Y, Z + 1), (X + 1, Y, Z + 1)]
                    elif dx == -1:
                        pts = [(X, Y + 1, Z + 1), (X, Y + 1, Z), (X, Y, Z), (X, Y, Z + 1)]
                    else:
                        pts = [(X + 1, Y + 1, Z), (X + 1, Y + 1, Z + 1), (X + 1, Y, Z + 1), (X + 1, Y, Z)]
                    shade = {1: 1.0, -1: 0.5}.get(dy, 0.8 if dz else 0.65)
                    quads.append((pts, name, b * shade, cut))
            elif (bid in SPRITE or bid == 'shaftbreaker:dripfang') and not (NOHANG and bid in ('shaftbreaker:dripfang', 'shaftbreaker:bloodroot_vines', 'shaftbreaker:hanging_tissue', 'shaftbreaker:bone_chime')):
                if bid == 'shaftbreaker:dripfang':
                    name = ['dripfang_base', 'dripfang_middle', 'dripfang_tip'][int(st.get('shaftbreaker:segment', 2))]
                else:
                    name = SPRITE[bid]
                    if st.get('shaftbreaker:end') and bid in ('shaftbreaker:bloodroot_vines', 'shaftbreaker:hanging_tissue'):
                        name += '_end'
                b = bright(y, z, x, LIGHT.get(bid, 0))
                c = 0.5
                quads.append(([(X, Y + 1, Z), (X + 1, Y + 1, Z + 1), (X + 1, Y, Z + 1), (X, Y, Z)], name, b, False))
                quads.append(([(X + 1, Y + 1, Z), (X, Y + 1, Z + 1), (X, Y, Z + 1), (X + 1, Y, Z)], name, b, False))
            elif bid in ('shaftbreaker:dweller_droppings', 'shaftbreaker:bloodmoss_carpet'):
                name = 'dweller_droppings' if 'dropp' in bid else 'bloodmoss'
                h = 0.03 if 'dropp' in bid else 0.07
                quads.append(([(X, Y + h, Z), (X + 1, Y + h, Z), (X + 1, Y + h, Z + 1), (X, Y + h, Z + 1)], name, bright(y, z, x), False))
            elif bid in ('shaftbreaker:watcher_pod', 'shaftbreaker:watcher_pod_open'):
                side = 'watcher_pod_open' if 'open' in bid else 'watcher_pod'
                topn = side + '_top'
                a, b2, hgt = 0.125, 0.875, 0.75
                bb = bright(y, z, x, LIGHT.get(bid, 0))
                quads.append(([(X + a, Y + hgt, Z + a), (X + b2, Y + hgt, Z + a), (X + b2, Y + hgt, Z + b2), (X + a, Y + hgt, Z + b2)], topn, bb, False))
                quads.append(([(X + a, Y + hgt, Z + a), (X + b2, Y + hgt, Z + a), (X + b2, Y, Z + a), (X + a, Y, Z + a)], side, bb * 0.8, False))
                quads.append(([(X + a, Y + hgt, Z + b2), (X + a, Y + hgt, Z + a), (X + a, Y, Z + a), (X + a, Y, Z + b2)], side, bb * 0.65, False))
                quads.append(([(X + b2, Y + hgt, Z + a), (X + b2, Y + hgt, Z + b2), (X + b2, Y, Z + b2), (X + b2, Y, Z + a)], side, bb * 0.65, False))
            elif bid == 'shaftbreaker:sinew_membrane':
                ax = int(st.get('shaftbreaker:axis', 0))
                b = bright(y, z, x)
                if ax == 0:
                    quads.append(([(X, Y + 1, Z + 0.5), (X + 1, Y + 1, Z + 0.5), (X + 1, Y, Z + 0.5), (X, Y, Z + 0.5)], 'sinew_membrane', b, False))
                else:
                    quads.append(([(X + 0.5, Y + 1, Z + 1), (X + 0.5, Y + 1, Z), (X + 0.5, Y, Z), (X + 0.5, Y, Z + 1)], 'sinew_membrane', b, False))

print('quads', len(quads))

# --- camera + rasterizer
W, H = int(sys.argv[4]) if len(sys.argv) > 4 else 1600, int(sys.argv[5]) if len(sys.argv) > 5 else 1000
yaw, pitch = math.radians(-32), math.radians(28)
cy_, sy_ = math.cos(yaw), math.sin(yaw)
cp, sp = math.cos(pitch), math.sin(pitch)


def proj(p):
    x, y, z = p
    # rotate around y then x; camera looks along +z (from negative z)
    x1 = x * cy_ + z * sy_
    z1 = -x * sy_ + z * cy_
    y2 = y * cp - z1 * sp
    z2 = y * sp + z1 * cp
    return x1, y2, z2


P = [[proj(p) for p in q[0]] for q in quads]
allp = np.array([p for q in P for p in q])
scale = min(W * 0.95 / (allp[:, 0].max() - allp[:, 0].min()), H * 0.95 / (allp[:, 1].max() - allp[:, 1].min()))
cx = (allp[:, 0].max() + allp[:, 0].min()) / 2
cyy = (allp[:, 1].max() + allp[:, 1].min()) / 2
img = np.zeros((H, W, 3), np.float32)
img[:] = np.array([10, 6, 7]) / 255
zbuf = np.full((H, W), 1e9, np.float32)
for (pts3, name, b, cut), pp in zip(quads, P):
    t = tex(name).astype(np.float32) / 255.0
    sp2 = np.array([[W / 2 + (p[0] - cx) * scale, H / 2 - (p[1] - cyy) * scale, p[2]] for p in pp])
    uv = np.array([[0, 0], [15.99, 0], [15.99, 15.99], [0, 15.99]])
    for tri in ((0, 1, 2), (0, 2, 3)):
        a, bb, c = sp2[list(tri)]
        ta, tb, tc = uv[list(tri)]
        minx, maxx = int(max(0, math.floor(min(a[0], bb[0], c[0])))), int(min(W - 1, math.ceil(max(a[0], bb[0], c[0]))))
        miny, maxy = int(max(0, math.floor(min(a[1], bb[1], c[1])))), int(min(H - 1, math.ceil(max(a[1], bb[1], c[1]))))
        if minx > maxx or miny > maxy:
            continue
        den = (bb[1] - c[1]) * (a[0] - c[0]) + (c[0] - bb[0]) * (a[1] - c[1])
        if abs(den) < 1e-9:
            continue
        xs, ys = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
        w0 = ((bb[1] - c[1]) * (xs - c[0]) + (c[0] - bb[0]) * (ys - c[1])) / den
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-3) & (w1 >= -1e-3) & (w2 >= -1e-3)
        if not m.any():
            continue
        z = w0 * a[2] + w1 * bb[2] + w2 * c[2]
        u = np.clip((w0 * ta[0] + w1 * tb[0] + w2 * tc[0]).astype(int), 0, 15)
        v = np.clip((w0 * ta[1] + w1 * tb[1] + w2 * tc[1]).astype(int), 0, 15)
        col = t[v, u]
        m &= col[..., 3] > 0.5
        zz = zbuf[miny:maxy + 1, minx:maxx + 1]
        m &= z < zz
        if not m.any():
            continue
        zz[m] = z[m]
        reg_ = img[miny:maxy + 1, minx:maxx + 1]
        reg_[m] = col[..., :3][m] * b
out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
# soft bloom from bright red areas
arr = np.asarray(out).astype(np.float32)
glow = np.clip(arr - 120, 0, 255)
g = Image.fromarray(glow.astype(np.uint8)).filter(ImageFilter.GaussianBlur(12))
out = Image.fromarray(np.clip(arr + np.asarray(g).astype(np.float32) * 0.6, 0, 255).astype(np.uint8))
out.save(sys.argv[2])
print('saved', sys.argv[2])
