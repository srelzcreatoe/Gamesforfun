"""Preview of the Stillwater Caves: runs the biome's generation rules (biome.py + biome_shapes.py) on a
112 x 60 x 112 block sample of deep rock, then bakes Minecraft-style block light for the renderer.

This is a simulation for the preview renders, not Minecraft's generator. It follows the pack's feature
rules chunk by chunk with the same numbers: flooded hall clusters stamped from the very same hall pieces
the pack ships (same waterline, random rotation, 7 pieces around a cluster origin), pillars and ribcages
gated on the lake probe, ore-style veins/stains/silt/calcite, ceiling patches with pale and vanilla
stalactites and blood vines, shores with coral, bloodroot and pallid caps, ruins and candles. Light
spreads from candles (3 per candle), bloodroot (4), pallid caps (3) and veined deepslate (3) the way block
light does: one level per block, a little more through water.
Output (in OUT): biome_scene.json + biome_faces.bin for viewer/biome.html, and biome_tex/ textures.
Usage: python3 biome_preview.py [out dir] [seed]
"""
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image

import biome
import biome_shapes as shapes

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 11
SX, SY, SZ = 112, 60, 112
WY = 26                                   # local y of the waterline row (world y -24 = the lower hall level)
Y0 = biome.LEVELS[0] - WY
R = random.Random(SEED)

NAMES = ['air', 'water', 'stone', 'deepslate', 'tuff', 'smooth_basalt', 'dripstone_block', 'gravel', 'mud', 'clay', 'calcite',
         'bloodstained_deepslate', 'clawed_deepslate', 'tracked_mud', 'veined_deepslate', 'cobbled_deepslate', 'bone_block',
         'deepslate_bricks', 'cracked_deepslate_bricks', 'deepslate_tiles', 'polished_deepslate', 'chiseled_deepslate',
         'deepslate_brick_slab']
ID = {n: i for i, n in enumerate(NAMES)}
AIR, WATER, STONE, DEEP, TUFF, BASALT = 0, 1, 2, 3, 4, 5
SOLID = lambda b: b >= STONE
ROCK = {ID[n] for n in ('stone', 'deepslate', 'tuff', 'smooth_basalt', 'dripstone_block', 'gravel', 'mud', 'clay', 'calcite',
                        'cobbled_deepslate')}
SOIL = ROCK | {ID['tracked_mud'], ID['bloodstained_deepslate'], ID['clawed_deepslate'], ID['veined_deepslate']}
LIGHT = {ID['veined_deepslate']: 3}


def value_noise3(shape, cell, seed):
    rng = np.random.default_rng(seed)
    gx, gy, gz = [int(math.ceil(s / c)) + 2 for s, c in zip(shape, cell)]
    g = rng.random((gx, gy, gz))
    x = np.arange(shape[0]) / cell[0]; y = np.arange(shape[1]) / cell[1]; z = np.arange(shape[2]) / cell[2]
    ix, iy, iz = x.astype(int), y.astype(int), z.astype(int)
    tx, ty, tz = [(a - a.astype(int)) for a in (x, y, z)]
    tx, ty, tz = [t * t * (3 - 2 * t) for t in (tx, ty, tz)]
    out = np.zeros(shape)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (tx if dx else 1 - tx)[:, None, None] * (ty if dy else 1 - ty)[None, :, None] * (tz if dz else 1 - tz)[None, None, :]
                out += w * g[np.ix_(ix + dx, iy + dy, iz + dz)]
    return out


# ------------------------------------------------------------------ the rock, the biome's wall noise, a few ordinary tunnels
def terrain():
    v = np.full((SX, SY, SZ), DEEP, np.int16)
    n = value_noise3((SX, SY, SZ), (24, 9, 24), SEED) * 0.6 + value_noise3((SX, SY, SZ), (9, 5, 9), SEED + 1) * 0.4
    n = n * 2 - 1                                                   # the subsurface_builder bands
    v[(n > -0.12) & (n < -0.05)] = TUFF
    v[(n > 0.18) & (n < 0.3)] = BASALT
    v[(n >= -0.05) & (n <= 0.18) & (np.arange(SY)[None, :, None] + Y0 > 0)] = STONE
    # two wandering tunnels (the ordinary dripstone-cave passages the biome replaces)
    for t in range(2):
        p = np.array([R.uniform(0, SX), R.uniform(WY + 2, WY + 10), R.uniform(0, SZ)])
        yaw, pitch = R.uniform(0, 2 * math.pi), 0.0
        for i in range(160):
            r = 1.6 + 0.8 * math.sin(i * 0.21 + t)
            lo = np.maximum(np.floor(p - r - 1).astype(int), 0)
            hi = np.minimum(np.ceil(p + r + 1).astype(int), (SX, SY, SZ))
            for x in range(lo[0], hi[0]):
                for y in range(lo[1], hi[1]):
                    for z in range(lo[2], hi[2]):
                        if (x - p[0]) ** 2 + ((y - p[1]) * 1.4) ** 2 + (z - p[2]) ** 2 < r * r:
                            v[x, y, z] = AIR
            yaw += R.uniform(-0.3, 0.3); pitch = max(-0.4, min(0.4, pitch + R.uniform(-0.15, 0.15)))
            p += np.array([math.cos(yaw), math.sin(pitch) * 0.5, math.sin(yaw)])
    return v


# ------------------------------------------------------------------ structure stamping (the game's rotate_around_center)
def rotated(shape, turns):
    g = shape.g
    for _ in range(turns):
        g = np.rot90(g, 1, axes=(0, 2))
    return g


def stamp(v, shape, x, y, z, ground=0, centre=True, turns=None, extra=None):
    turns = R.randrange(4) if turns is None else turns
    g = rotated(shape, turns)
    sx, sy, sz = g.shape
    ox, oz = (x - sx // 2, z - sz // 2) if centre else (x, z)
    oy = y - ground
    for (i, j, k) in zip(*np.nonzero(g >= 0)):
        X, Y, Z = int(ox + i), int(oy + j), int(oz + k)
        if 0 <= X < SX and 0 <= Y < SY and 0 <= Z < SZ:
            name, states = shape.pal[g[i, j, k]]
            short = name.split(':')[1]
            if short in ID:
                v[X, Y, Z] = ID[short]
            elif extra is not None:
                extra(X, Y, Z, name, states)
    return turns


# ------------------------------------------------------------------ decorations (same parameters as the pack's rules)
class World:
    def __init__(self, v):
        self.v = v
        self.plants, self.drip, self.pale, self.vines, self.candles = {}, {}, {}, {}, {}

    def inb(self, x, y, z):
        return 0 <= x < SX and 0 <= y < SY and 0 <= z < SZ

    def at(self, x, y, z):
        return self.v[x, y, z] if self.inb(x, y, z) else STONE

    def free(self, x, y, z):
        c = (x, y, z)
        return self.inb(*c) and self.v[c] == AIR and c not in self.plants and c not in self.drip and c not in self.pale \
            and c not in self.vines and c not in self.candles

    def snap(self, x, y, z, surface, rng=12):
        if not self.free(x, y, z):
            return None
        step = -1 if surface == 'floor' else 1
        for k in range(rng - 2):
            ny = y + step * k
            if not self.free(x, ny, z):
                return None
            if SOLID(self.at(x, ny + step, z)):
                return ny
        return None

    def column(self, store, x, y, z, parts, hanging):
        cells = [(x, y - i if hanging else y + i, z) for i in range(len(parts))]
        if not all(self.free(*c) for c in cells):
            return False
        for c, t in zip(cells, parts):
            store[c] = (t, hanging)
        return True

    def stalactite(self, x, y, z):
        n = R.choices(list(biome.STALACTITES), (3, 4, 3, 2, 1))[0]
        return self.column(self.drip, x, y, z, biome.thickness(n), True)

    def pale_stalactite(self, x, y, z):
        n = R.choices(list(shapes.STAL_LENGTHS), (3, 4, 4, 3, 2, 2))[0]
        return self.column(self.pale, x, y, z, shapes.pale_thickness(n), True)

    def stalagmite(self, x, y, z):
        n = R.choices(list(biome.STALAGMITES), (3, 4, 2, 1))[0]
        return self.column(self.drip, x, y, z, biome.thickness(n), False)

    def vine(self, x, y, z):
        h = R.choices([R.randint(1, 2), R.randint(3, 6), R.randint(7, 12)], (6, 3, 2))[0]
        placed = 0
        for i in range(h):
            if not self.free(x, y - i, z):
                break
            self.vines[(x, y - i, z)] = 0
            placed += 1
        if placed:
            self.vines[(x, y - placed + 1, z)] = 1
        return placed > 0

    def plant(self, x, y, z):
        if not self.free(x, y, z) or self.at(x, y - 1, z) not in SOIL:
            return False
        self.plants[(x, y, z)] = R.choices(['bone_coral', 'bloodroot', 'pallid_cap'], (4, 4, 2))[0]
        return True

    def candle(self, x, y, z):
        if not self.free(x, y, z) or not SOLID(self.at(x, y - 1, z)):
            return False
        n, red = R.choices([(1, True), (2, True), (3, False), (4, True), (1, False)], (3, 3, 2, 1, 2))[0]
        self.candles[(x, y, z)] = (n, red)
        return True

    def patch(self, cx, cy, cz, surface, ground, veg, chance, radius, depth, vrange, deep_chance, edge, waterlogged=False):
        r = R.randint(*radius)
        cols = []
        for dx in range(-r - 1, r + 2):
            for dz in range(-r - 1, r + 2):
                if max(abs(dx), abs(dz)) == r + 1 and (abs(dx) == abs(dz) or R.random() > edge):
                    continue
                x, z = cx + dx, cz + dz
                if not (0 <= x < SX and 0 <= z < SZ):
                    continue
                for k in sorted(range(-vrange, vrange + 1), key=abs):
                    y = cy + k
                    if not (1 <= y < SY - 1):
                        continue
                    if surface == 'floor' and self.v[x, y, z] == AIR and self.v[x, y - 1, z] in ROCK:
                        cols.append((x, y - 1, z)); break
                    if surface == 'ceiling' and self.v[x, y, z] == AIR and self.v[x, y + 1, z] in ROCK:
                        cols.append((x, y + 1, z)); break
        step = -1 if surface == 'floor' else 1
        for x, y, z in cols:
            for i in range(depth + (1 if R.random() < deep_chance else 0)):
                if self.inb(x, y + step * i, z) and self.v[x, y + step * i, z] in ROCK:
                    self.v[x, y + step * i, z] = ground
        if waterlogged and surface == 'floor':
            for x, y, z in cols:
                if all(self.at(x + a, y, z + b) != AIR for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    self.v[x, y, z] = WATER
        for x, y, z in cols:
            if R.random() < chance and self.v[x, y, z] != WATER:
                veg(x, y - step, z)
        return bool(cols)

    def ore(self, x, y, z, block, count, replace=ROCK):
        """vanilla-style vein: a short string of blobs whose size grows with count"""
        ang = R.uniform(0, math.pi)
        ln = count / 8
        a = np.array([x + math.sin(ang) * ln, y + R.uniform(-1, 1), z + math.cos(ang) * ln])
        b = np.array([x - math.sin(ang) * ln, y + R.uniform(-1, 1), z - math.cos(ang) * ln])
        for i in range(count):
            p = a + (b - a) * i / max(count - 1, 1)
            rad = (math.sin(math.pi * i / count) + 1) * (R.random() * count / 16 + 1) / 2
            for X in range(int(p[0] - rad), int(p[0] + rad) + 1):
                for Y in range(int(p[1] - rad), int(p[1] + rad) + 1):
                    for Z in range(int(p[2] - rad), int(p[2] + rad) + 1):
                        if (X - p[0]) ** 2 + (Y - p[1]) ** 2 + (Z - p[2]) ** 2 < rad * rad and self.inb(X, Y, Z) \
                                and self.v[X, Y, Z] in replace:
                            self.v[X, Y, Z] = block


def generate():
    v = terrain()
    w = World(v)
    chunks = [(cx, cz) for cx in range(SX // 16) for cz in range(SZ // 16)]
    U = lambda lo, hi: R.randrange(lo, hi)
    # first_pass: the flooded halls
    kinds = [('lake_wide', 5), ('lake_deep', 3), ('lake_pillar', 2), ('shore_dome', 3), ('shore_pillar', 2)]
    pieces = {f'hall_{k}_{i}': shapes.hall_piece(k, 1000 + 17 * list(shapes.HALL_KINDS).index(k) + i) for k, _ in kinds for i in range(2)}
    for cx, cz in chunks:
        if R.random() >= 3 / 5:
            continue
        ox, oz = cx * 16 + U(4, 12), cz * 16 + U(4, 12)
        for _ in range(7):
            k = R.choices([k for k, _ in kinds], [wgt for _, wgt in kinds])[0]
            stamp(v, pieces[f'hall_{k}_{R.randrange(2)}'], ox + U(-8, 9), WY, oz + U(-8, 9), ground=shapes.HALL_D)
    # before_underground_pass: pillars and ribcages (only where the probe finds lake water), stone dressing
    pillars = [shapes.pillar(2000 + i) for i in range(3)]
    ribs = [shapes.ribcage(3000 + i) for i in range(2)]
    for cx, cz in chunks:
        for _ in range(2):
            x, z = cx * 16 + U(0, 16), cz * 16 + U(0, 16)
            if R.random() < 0.5 and v[x, WY - 1, z] == WATER:
                stamp(v, R.choice(pillars), x, WY - 1, z, ground=shapes.PILLAR_BELOW - 1)
        x, z = cx * 16 + U(0, 16), cz * 16 + U(0, 16)
        if R.random() < 1 / 4 and v[x, WY - 1, z] == WATER:
            rc = R.choice(ribs)
            turns = R.randrange(4)
            g = rotated(rc, turns)
            spine = [(i, k) for i, j, k in zip(*np.nonzero(g >= 0)) if j == 1]
            done = False
            for rad in range(0, 9):                       # adjustment_radius 8: nearest grounded spot
                for dx in range(-rad, rad + 1):
                    for dz in range(-rad, rad + 1):
                        if done or max(abs(dx), abs(dz)) != rad:
                            continue
                        px, pz = x + dx, z + dz
                        ox, oz = px - g.shape[0] // 2, pz - g.shape[2] // 2
                        if all(w.inb(ox + i, WY - 2, oz + k) and SOLID(v[ox + i, WY - 2, oz + k]) for i, k in spine):
                            stamp(v, rc, px, WY - 1, pz, ground=1, turns=turns)
                            done = True
        for _ in range(6):
            w.ore(cx * 16 + U(0, 16), U(WY - 12, WY + 1), cz * 16 + U(0, 16), R.choice([ID['mud']] * 3 + [ID['clay']] * 2 + [ID['gravel']] * 2), 20)
        for _ in range(5):
            w.ore(cx * 16 + U(0, 16), U(WY - 12, WY + 10), cz * 16 + U(0, 16), ID['veined_deepslate'], 10, {DEEP, TUFF, STONE, BASALT})
        for _ in range(4):
            w.ore(cx * 16 + U(0, 16), U(WY - 1, WY + 14), cz * 16 + U(0, 16), ID['bloodstained_deepslate'], 14, {DEEP, STONE, TUFF})

    # underground_pass: ceilings, shores, floors
    def rp(cx, cz, lo, hi):
        return cx * 16 + U(0, 16), U(lo, hi), cz * 16 + U(0, 16)

    def on_ceiling(f, rng=16):
        return lambda x, y, z: (lambda yy: yy is not None and f(x, yy, z))(w.snap(x, y, z, 'ceiling', rng))

    def on_floor(f, rng=12):
        return lambda x, y, z: (lambda yy: yy is not None and f(x, yy, z))(w.snap(x, y, z, 'floor', rng))

    def claws(x, y, z):
        fy = w.snap(x, y, z, 'floor', 12)
        if fy is None:
            return
        for _ in range(20):
            cx_, cy_, cz_ = x + U(-5, 6), fy + U(0, 4), z + U(-5, 6)
            if w.inb(cx_, cy_, cz_) and v[cx_, cy_, cz_] in (DEEP, STONE, TUFF, BASALT, ID['cobbled_deepslate']) and \
                    any(w.at(cx_ + a, cy_, cz_ + b) == AIR for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                v[cx_, cy_, cz_] = ID['clawed_deepslate']

    def trail(x, y, z):
        for _ in range(6):
            px, py, pz = x + U(-1, 2), y + U(-1, 2), z + U(-7, 8)
            fy = w.snap(px, py, pz, 'floor', 4)
            if fy is not None and w.at(px, fy - 1, pz) in (ID['mud'], ID['gravel'], ID['clay']):
                v[px, fy - 1, pz] = ID['tracked_mud']

    plan = [
        (3, WY + 5, WY + 16, lambda p: w.patch(*p, 'ceiling', DEEP, w.pale_stalactite, 0.3, (1, 3), 1, 12, 0.3, 0.4)),
        (4, WY + 5, WY + 16, lambda p: w.patch(*p, 'ceiling', ID['bloodstained_deepslate'], w.vine, 0.16, (2, 4), 1, 12, 0.35, 0.5)),
        (9, WY + 3, WY + 15, lambda p: on_ceiling(w.pale_stalactite)(*p)),
        (6, WY + 3, WY + 15, lambda p: on_ceiling(w.stalactite)(*p)),
        (14, WY + 3, WY + 15, lambda p: on_ceiling(w.vine)(*p)),
        (3, WY, WY + 5, lambda p: w.patch(*p, 'floor', ID['gravel'], w.plant, 0.18, (2, 5), 1, 6, 0.5, 0.5)),
        (26, WY, WY + 6, lambda p: on_floor(w.plant)(*p)),
        (3, WY + 1, WY + 6, lambda p: on_floor(w.stalagmite, 16)(*p)),
        (4, WY, WY + 4, lambda p: claws(*p)),
        (1, WY + 1, WY + 4, lambda p: trail(*p)),
        # the ordinary tunnels: the biome-wide rules
        (3, 0, SY, lambda p: w.patch(*p, 'ceiling', ID['dripstone_block'], w.stalactite, 0.16, (2, 5), 2, 10, 0.6, 0.4)),
        (4, 0, SY, lambda p: on_ceiling(w.pale_stalactite)(*p)),
        (6, 0, SY, lambda p: on_ceiling(w.vine)(*p)),
        (12, 0, SY, lambda p: on_floor(w.plant)(*p)),
    ]
    for n, lo, hi, act in plan:
        for cx, cz in chunks:
            for _ in range(n):
                act(rp(cx, cz, lo, hi))
    # after_underground_pass: ruins and candles on the shores
    ruins = {k: fn(4000 + len(k)) for k, fn in shapes.RUINS.items()}

    def keep_candle(X, Y, Z, name, states):
        if 'candle' in name:
            w.candles[(X, Y, Z)] = (states['candles'] + 1, name.startswith('minecraft:red'))
    for cx, cz in chunks:
        for _ in range(3):
            if R.random() >= 1 / 3:
                continue
            x, y, z = rp(cx, cz, WY + 1, WY + 5)
            fy = w.snap(x, y, z, 'floor', 6)
            if fy is None:
                continue
            shape = ruins[R.choices(['shrine', 'arch', 'wall'], (2, 2, 3))[0]]
            stamp(v, shape, x, fy, z, ground=1, centre=False, extra=keep_candle)
        for _ in range(2):
            if R.random() < 1 / 2:
                x, y, z = rp(cx, cz, WY + 1, WY + 8)
                fy = w.snap(x, y, z, 'floor', 12)
                if fy is None:
                    continue
                for _ in range(5):
                    on_floor(w.candle, 4)(x + U(-2, 3), fy + U(0, 2), z + U(-2, 3))
    # nothing may float: decorations whose support was carved away later are dropped
    for store in (w.plants, w.candles):
        for c in [c for c in store if not SOLID(w.at(c[0], c[1] - 1, c[2])) or v[c] != AIR]:
            del store[c]
    return w


# ------------------------------------------------------------------ block light (Minecraft-style flood fill)
def block_light(w):
    v = w.v
    L = np.zeros(v.shape, np.int16)
    for c, t in w.plants.items():
        L[c] = {'bloodroot': 5, 'pallid_cap': 3}.get(t, 0)
    for c, (n, _) in w.candles.items():
        L[c] = 3 * n
    src = np.zeros(v.shape, np.int16)
    for b, lv in LIGHT.items():
        src[v == b] = lv
    open_ = (v == AIR) | (v == WATER)
    cost = np.where(v == WATER, 2, 1)
    seed_ = L.copy()
    for _ in range(15):
        both = np.maximum(L, src)
        nb = np.zeros_like(L)
        for axis in range(3):
            for sh in (1, -1):
                nb = np.maximum(nb, np.roll(both, sh, axis=axis))
        L = np.where(open_, np.maximum(seed_, np.maximum(L, nb - cost)), L)
    return np.clip(L, 0, 15)


# ------------------------------------------------------------------ export: exposed faces with smooth light, decorations, views
FACE_DIRS = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]


def faces(w, L):
    """every visible block face: x, y, z, face, block, then 4 corner values (light * 64 + ambient occlusion 0-3)"""
    v = w.v
    solid = v >= STONE
    openv = ~solid
    Lf = np.where(openv, L, 0).astype(np.int32)
    out = []
    for f, (dx, dy, dz) in enumerate(FACE_DIRS):
        nb = np.roll(v, (-dx, -dy, -dz), axis=(0, 1, 2))
        vis = solid & (nb < STONE)
        if dx == 1: vis[-1] = False
        if dx == -1: vis[0] = False
        if dy == 1: vis[:, -1] = False
        if dy == -1: vis[:, 0] = False
        if dz == 1: vis[:, :, -1] = False
        if dz == -1: vis[:, :, 0] = False
        ua, ub = [a for a in range(3) if (dx, dy, dz)[a] == 0]
        xs, ys, zs = np.nonzero(vis)
        n = np.stack([xs + dx, ys + dy, zs + dz], 1)
        corners = []
        for su in (-1, 1):
            for sv in (-1, 1):
                acc = np.zeros(len(n)); cnt = np.zeros(len(n))
                for a, b in ((0, 0), (su, 0), (0, sv), (su, sv)):
                    p = n.copy(); p[:, ua] += a; p[:, ub] += b
                    ok = (p >= 0).all(1) & (p[:, 0] < SX) & (p[:, 1] < SY) & (p[:, 2] < SZ)
                    pc = np.clip(p, 0, [SX - 1, SY - 1, SZ - 1])
                    o = ok & openv[pc[:, 0], pc[:, 1], pc[:, 2]]
                    acc += np.where(o, Lf[pc[:, 0], pc[:, 1], pc[:, 2]], 0); cnt += o
                light = np.round(acc / np.maximum(cnt, 1) * 4)            # quarter light levels, 0..60
                corners.append(light.astype(int) * 4 + (4 - cnt).clip(0, 3).astype(int))
        out.append(np.stack([xs, ys, zs, np.full(len(xs), f), v[xs, ys, zs]] + corners, 1))
    return np.concatenate(out).astype(np.int16)


def tex_noise(palette, cuts, seed, sx=1.0, sy=1.0, speck=0.05):
    rng = np.random.default_rng(seed)
    return biome.paint(biome.tile_noise(rng, sx, sy), palette, cuts, rng, speck=speck)


def preview_textures(out):
    """look-alike textures for the vanilla blocks in the preview (original pixel art, not Mojang's files)"""
    os.makedirs(out, exist_ok=True)
    stone = ['#5f5f62', '#6c6c6f', '#7a7a7d', '#88888a']
    tuff = ['#4d5046', '#5d5d52', '#6a6e6f', '#85837b']
    basalt = ['#1b2632', '#32333d', '#3a3b48', '#4f4b4f', '#5c5c5c']
    drip = ['#634a47', '#735450', '#836356', '#927965', '#a08d71']
    gravel = ['#5a5252', '#6e6766', '#817f7f', '#968e8e', '#a9a2a1']
    clay = ['#8f949f', '#9aa3b3', '#a1a7b1', '#acaebd']
    calcite = ['#c9c9c4', '#d6d6d1', '#dfe0dc', '#e8e8e4']
    cobbled = ['#2d2d33', '#3c3c42', '#4d4d52', '#606064']
    bricks = ['#2a2a30', '#3a3a40', '#47474d', '#55555a']
    imgs = {
        'stone': tex_noise(stone, [0.3, 0.55, 0.8], 101),
        'deepslate': biome.deepslate_side(102),
        'deepslate_top': biome.deepslate_top(103),
        'tuff': tex_noise(tuff, [0.28, 0.52, 0.78], 104, 1.0, 0.7),
        'smooth_basalt': tex_noise(basalt, [0.15, 0.35, 0.6, 0.85], 105),
        'dripstone_block': tex_noise(drip, [0.2, 0.42, 0.66, 0.86], 106, 0.6, 1.6),
        'gravel': tex_noise(gravel, [0.2, 0.42, 0.64, 0.84], 107, speck=0.25),
        'mud': biome.mud_tex(108),
        'clay': tex_noise(clay, [0.3, 0.55, 0.8], 109),
        'calcite': tex_noise(calcite, [0.25, 0.55, 0.8], 110, speck=0.08),
        'cobbled_deepslate': tex_noise(cobbled, [0.25, 0.5, 0.75], 111, 0.5, 0.5, speck=0.15),
    }
    bone_side = Image.new('RGBA', (16, 16)); bone_top = Image.new('RGBA', (16, 16))
    r = random.Random(4)
    for x in range(16):
        for y in range(16):
            c = biome.BONE[1] if x in (0, 15) else biome.BONE[r.choice((2, 3, 3, 4))]
            bone_side.putpixel((x, y), biome.rgb(c) + (255,))
            d = max(abs(x - 7.5), abs(y - 7.5))
            bone_top.putpixel((x, y), biome.rgb(biome.BONE[1] if d > 6.5 else biome.BONE[0] if d < 2.5 else biome.BONE[r.choice((2, 3))]) + (255,))
    imgs['bone_block'], imgs['bone_block_top'] = bone_side, bone_top

    def masonry(rows, cols, palette, seed, crack=False):
        img = tex_noise(palette, [0.3, 0.55, 0.8], seed)
        rr = random.Random(seed)
        for y in range(16):
            for x in range(16):
                row = y // (16 // rows)
                off = (16 // cols // 2) * (row % 2)
                if y % (16 // rows) == 0 or (x + off) % (16 // cols) == 0:
                    img.putpixel((x, y), biome.rgb('#1c1c21') + (255,))
        if crack:
            x, y = rr.randrange(4, 12), 0
            while y < 16:
                img.putpixel((x % 16, y), biome.rgb('#121216') + (255,))
                y += 1; x += rr.choice((-1, 0, 1))
        return img
    imgs['deepslate_bricks'] = masonry(4, 2, bricks, 112)
    imgs['cracked_deepslate_bricks'] = masonry(4, 2, bricks, 113, crack=True)
    imgs['deepslate_tiles'] = masonry(4, 4, ['#26262b', '#333338', '#3e3e44'], 114)
    imgs['polished_deepslate'] = tex_noise(['#3a3a3f', '#46464b', '#525257'], [0.4, 0.75], 115, speck=0.02)
    chis = imgs['polished_deepslate'].copy()
    for i in range(2, 14):
        for j in (2, 13):
            chis.putpixel((i, j), biome.rgb('#202025') + (255,)); chis.putpixel((j, i), biome.rgb('#202025') + (255,))
    imgs['chiseled_deepslate'] = chis
    widths = {'tip': [0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4], 'frustum': [3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6],
              'middle': [5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7], 'base': [6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]}
    for name, ws in widths.items():
        img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        for y in range(16):
            ww = ws[y]
            for x in range(8 - ww, 8 + ww):
                c = drip[min(4, max(0, (x - (8 - ww)) * 5 // max(1, 2 * ww)))]
                img.putpixel((x, y), biome.rgb(c) + (255,))
        imgs[f'pointed_dripstone_{name}'] = img          # drawn point-up (standing); flipped for hanging
    vine = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); tip = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for img, ln in ((vine, 16), (tip, 11)):
        for sx_ in (4, 7, 9, 12):
            x = sx_
            for y in range(ln):
                img.putpixel((x, y), biome.rgb(biome.BLOOD[r.choice((1, 2, 3))]) + (255,))
                if r.random() < 0.3:
                    x = max(1, min(14, x + r.choice((-1, 1))))
            if img is tip:
                img.putpixel((x, ln), biome.rgb(biome.BLOOD[4]) + (255,))
    imgs['weeping_vines'], imgs['weeping_vines_tip'] = vine, tip
    chest = tex_noise(['#5b3a1e', '#6e4825', '#7d532b'], [0.4, 0.75], 116, 2.0, 0.5)
    for i in range(16):
        chest.putpixel((i, 5), biome.rgb('#2b1c10') + (255,)); chest.putpixel((0, i), biome.rgb('#2b1c10') + (255,))
        chest.putpixel((15, i), biome.rgb('#2b1c10') + (255,))
    for (i, j) in ((7, 5), (8, 5), (7, 6), (8, 6), (7, 7), (8, 7)):
        chest.putpixel((i, j), biome.rgb('#b9b9b9') + (255,))
    imgs['chest'] = chest
    for name, pal in (('candle', ['#c9b98f', '#e2d3a8', '#efe3c0']), ('red_candle', ['#6e1414', '#8f1d1d', '#a82a2a'])):
        img = Image.new('RGBA', (16, 16))
        for x in range(16):
            for y in range(16):
                img.putpixel((x, y), biome.rgb(pal[0] if x < 5 else pal[2] if x > 10 else pal[1]) + (255,))
        imgs[name] = img
    for k, img in imgs.items():
        img.save(f'{out}/{k}.png')
    return list(imgs)


def clearance(v, x, y, z, r=2):
    sub = v[max(0, x - r):x + r + 1, max(0, y - r):y + r + 1, max(0, z - r):z + r + 1]
    return not (sub >= STONE).any()


def los(v, a, b):
    a, b = np.array(a, float), np.array(b, float)
    n = int(np.linalg.norm(b - a) * 3) + 1
    for i in range(1, n):
        p = a + (b - a) * i / n
        c = tuple(np.floor(p).astype(int))
        if not (0 <= c[0] < SX and 0 <= c[1] < SY and 0 <= c[2] < SZ) or v[c] >= STONE:
            if np.linalg.norm(p - b) > 1.5:
                return False
    return True


def openness(v, x, y, z, yaw, dist=48):
    """how far you can see across the hall from here in a direction (a vista score)"""
    d = np.array([math.cos(yaw), -0.06, math.sin(yaw)])
    p = np.array([x + 0.5, y + 0.5, z + 0.5])
    for k in range(1, dist):
        q = np.floor(p + d * k).astype(int)
        if not (0 <= q[0] < SX and 0 <= q[1] < SY and 0 <= q[2] < SZ) or v[tuple(q)] >= STONE:
            return k
    return dist


def pick_views(w, L):
    v = w.v
    lake = (v[:, WY - 1, :] == WATER) & (v[:, WY, :] == AIR)
    views = {}
    # vista: low over the water, from inside the sample, looking across open water at pillars, curtains and candlelight;
    # a view that would see past the edge of the sample is never chosen
    def ray(x, y, z, yaw, dist=46):
        d = np.array([math.cos(yaw), 0.0, math.sin(yaw)])
        p = np.array([x + 0.5, y + 0.5, z + 0.5])
        for k in range(1, dist):
            q = np.floor(p + d * k).astype(int)
            if not (0 <= q[0] < SX and 0 <= q[2] < SZ):
                return -1
            if v[q[0], q[1], q[2]] >= STONE:
                return k
        return dist
    gx, gz = np.meshgrid(np.arange(SX), np.arange(SZ), indexing='ij')
    pillar_cells = (v[:, WY + 3, :] >= STONE) & np.roll(lake, 2, 0) & np.roll(lake, -2, 0)
    cand_light = np.zeros((SX, SZ), bool)
    for (cx_, cy_, cz_) in w.candles:
        cand_light[cx_, cz_] = True
    best = None
    for x in range(14, SX - 14, 2):
        for z in range(14, SZ - 14, 2):
            y = WY + 3
            if v[x, y, z] != AIR or not clearance(v, x, y, z, 1) or not lake[x, z]:
                continue
            ang = np.arctan2(gz - z, gx - x)
            dist = np.hypot(gx - x, gz - z)
            for a in range(0, 360, 10):
                yaw = math.radians(a)
                rays = [ray(x, y, z, yaw + dd) for dd in (-0.45, -0.22, 0, 0.22, 0.45)]
                if min(rays) < 0:
                    continue
                cone = (np.abs((ang - yaw + np.pi) % (2 * np.pi) - np.pi) < 0.5) & (dist > 8) & (dist < 44)
                score = min(rays) * 0.4 + sum(rays) * 0.12 + (lake & cone).sum() * 0.02 + (pillar_cells & cone).sum() * 0.25 \
                    + (cand_light & cone).sum() * 3.0
                if best is None or score > best[0]:
                    best = (score, x, y, z, yaw)
    if best is None:
        best = (0, SX // 2, WY + 3, SZ // 2, 0.0)
    _, x, y, z, yaw = best
    views['vista'] = {'cam': [x + 0.5, y + 0.6, z + 0.5], 'look': [x + 0.5 + 30 * math.cos(yaw), WY + 6.0, z + 0.5 + 30 * math.sin(yaw)]}
    # the Brinesleeper: chest-deep in deep water 14-22 blocks down that view
    cam = np.array(views['vista']['cam']); dv = np.array(views['vista']['look']) - cam; dv /= np.linalg.norm(dv)
    cand = []
    for (lx, lz) in zip(*np.nonzero(lake)):
        depth = sum(1 for yy in range(WY - 1, 0, -1) if v[lx, yy, lz] == WATER)
        rel = np.array([lx + .5, WY, lz + .5]) - cam
        along = rel @ dv
        off = np.linalg.norm(rel - along * dv)
        if 14 < along < 22 and depth >= 4:
            cand.append((abs(off - 3), lx, lz))
    if cand:
        _, mx, mz = min(cand)
        views['model'] = [mx + 0.5, WY, mz + 0.5]
    # lurk: the Brinesleeper waiting in deep water off a candle-lit shore, seen side-on from across the water
    depth_at = lambda x, z: sum(1 for yy in range(WY - 1, 0, -1) if v[x, yy, z] == WATER)
    best = None
    for c in w.candles:
        n = w.candles[c][0]
        for dx in range(-7, 8):
            for dz in range(-7, 8):
                lx, lz = c[0] + dx, c[2] + dz
                if not (2 <= lx < SX - 2 and 2 <= lz < SZ - 2) or not lake[lx, lz] or not 3 <= math.hypot(dx, dz) <= 7:
                    continue
                if depth_at(lx, lz) < 4 or not clearance(v, lx, WY + 2, lz, 1):
                    continue
                ang = math.atan2(lz - c[2], lx - c[0])
                for dist in (8, 9, 7, 10, 12):
                    for da in (1.0, -1.0, 0.7, -0.7, 1.3, -1.3, 0.4, -0.4, 1.7, -1.7):
                        cx, cz = lx + dist * math.cos(ang + da), lz + dist * math.sin(ang + da)
                        cc = (int(cx), WY + 2, int(cz))
                        if not (1 <= cc[0] < SX - 1 and 1 <= cc[2] < SZ - 1) or v[cc] != AIR or not clearance(v, *cc, 1):
                            continue
                        if not los(v, (cx, WY + 2.6, cz), (lx + .5, WY + 2.5, lz + .5)):
                            continue
                        open_water = int(lake[max(0, lx - 8):lx + 9, max(0, lz - 8):lz + 9].sum())
                        view = math.degrees(abs((math.atan2(c[2] - cz, c[0] - cx) - math.atan2(lz - cz, lx - cx) + math.pi) % (2 * math.pi) - math.pi))
                        if view > 24:
                            continue
                        score = n * 2 + sum(1 for d in w.candles if abs(d[0] - c[0]) + abs(d[2] - c[2]) < 6) + open_water * 0.08 \
                            + openness(v, cc[0], cc[1], cc[2], math.atan2(lz - cz, lx - cx)) * 0.2 - abs(dist - 8) * 0.8
                        if best is None or score > best[0]:
                            best = (score, (cx, WY + 2.6, cz), (lx + .5, WY, lz + .5))
    if best:
        views['lurk'] = {'cam': list(best[1]), 'look': [best[2][0], WY + 2.2, best[2][2]], 'model': list(best[2])}
    # overview: the whole sample from high above with the ceiling cut away, to show the scale of the halls
    views['overview'] = {'cam': [SX * 0.5, WY + 78, -SZ * 0.32], 'look': [SX * 0.5, WY - 4, SZ * 0.45]}
    # shrine: the biggest candle group, from a few blocks away
    if w.candles:
        cs = list(w.candles)
        t = max(cs, key=lambda c: sum(1 for d in cs if abs(d[0] - c[0]) + abs(d[2] - c[2]) < 6))
        look = (t[0] + .5, t[1] + 1.0, t[2] + .5)
        opts = []
        for dist in (7, 8, 9, 6, 10):
            for a in range(0, 360, 15):
                for h in (2, 3, 4):
                    cx, cz = t[0] + dist * math.cos(math.radians(a)), t[2] + dist * math.sin(math.radians(a))
                    c = (int(cx), int(t[1] + h), int(cz))
                    if 0 < c[0] < SX - 1 and 0 < c[1] < SY - 1 and 0 < c[2] < SZ - 1 and v[c] == AIR and clearance(v, *c, 1) \
                            and los(v, (cx, t[1] + h + .5, cz), look):
                        opts.append((-openness(v, c[0], c[1], c[2], math.atan2(t[2] - cz, t[0] - cx)), (cx, t[1] + h + .5, cz)))
            if opts:
                break
        if opts:
            views['shrine'] = {'cam': min(opts)[1], 'look': look}
    # ceiling: looking up into the densest pale/red curtains
    hang = list(w.pale) + list(w.vines)
    grid = {}
    for p in hang:
        grid[(p[0] // 6, p[2] // 6)] = grid.get((p[0] // 6, p[2] // 6), 0) + 1
    for (gx, gz), _ in sorted(grid.items(), key=lambda kv: -kv[1])[:30]:
        tx, tz = gx * 6 + 3, gz * 6 + 3
        top = max((p[1] for p in hang if p[0] // 6 == gx and p[2] // 6 == gz), default=WY + 10)
        look = (tx + .5, top + 1.5, tz + .5)
        found = None
        for dist in (13, 15, 11, 17):
            for a in range(0, 360, 20):
                cx, cz = tx + dist * math.cos(math.radians(a)), tz + dist * math.sin(math.radians(a))
                c = (int(cx), WY + 2, int(cz))
                if 0 < c[0] < SX - 1 and 0 < c[2] < SZ - 1 and v[c] == AIR and clearance(v, *c, 1) and los(v, (cx, WY + 2.5, cz), look):
                    found = (cx, WY + 2.5, cz); break
            if found:
                break
        if found:
            views['ceiling'] = {'cam': found, 'look': look}
            break
    # shore: plants and coral at the water's edge, seen from just above the waterline
    def near_lake(c):
        return any(lake[min(SX - 1, max(0, c[0] + a)), min(SZ - 1, max(0, c[2] + b))] for a in (-2, 0, 2) for b in (-2, 0, 2))
    shore = [c for c in w.plants if c[1] in (WY, WY + 1) and near_lake(c)]
    if shore:
        t = max(shore, key=lambda c: sum(1 for d in w.plants if abs(d[0] - c[0]) < 5 and abs(d[2] - c[2]) < 5))
        look = (t[0] + .5, t[1] + 0.6, t[2] + .5)
        for dist in (8, 9, 7, 10):
            done = False
            for a in range(0, 360, 15):
                cx, cz = t[0] + dist * math.cos(math.radians(a)), t[2] + dist * math.sin(math.radians(a))
                c = (int(cx), WY + 2, int(cz))
                if 0 < c[0] < SX - 1 and 0 < c[2] < SZ - 1 and v[c] == AIR and clearance(v, *c, 1) and los(v, (cx, WY + 2.6, cz), look):
                    views['shore'] = {'cam': [cx, WY + 2.6, cz], 'look': look}
                    done = True
                    break
            if done:
                break
    return views


def render_map(w, path, scale=6):
    """top-down map of the hall level: lake shaded by depth, shores, rock, pillars, ruins, ribs and candles, chunk grid"""
    from PIL import ImageDraw
    v = w.v
    img = Image.new('RGB', (SX * scale, SZ * scale), (16, 16, 19))
    px = img.load()
    rock_top = {ID['gravel']: (96, 90, 90), ID['mud']: (60, 56, 62), ID['clay']: (128, 133, 145), ID['tracked_mud']: (70, 62, 66),
                ID['bloodstained_deepslate']: (92, 40, 42), ID['veined_deepslate']: (120, 30, 34), ID['bone_block']: (214, 208, 186)}
    for x in range(SX):
        for z in range(SZ):
            if v[x, WY - 1, z] == WATER and v[x, WY, z] != WATER and not SOLID(v[x, WY, z]):
                d = sum(1 for yy in range(WY - 1, 0, -1) if v[x, yy, z] == WATER)
                k = min(d, 10) / 10
                col = (int(44 - 32 * k), int(86 - 62 * k), int(100 - 66 * k))
            else:
                col = (22, 22, 26)
                for yy in range(WY, WY + 8):                 # the first floor with open air above it
                    if SOLID(v[x, yy, z]) and not SOLID(v[x, yy + 1, z]):
                        b = int(v[x, yy, z])
                        base = rock_top.get(b, (70, 70, 76))
                        f = 1.0 - 0.07 * (yy - WY)
                        col = tuple(int(c * f) for c in base)
                        if b in (ID['deepslate_bricks'], ID['cracked_deepslate_bricks'], ID['deepslate_tiles'], ID['polished_deepslate'],
                                 ID['chiseled_deepslate']):
                            col = (150, 120, 96)
                        break
            for i in range(scale):
                for j in range(scale):
                    px[x * scale + i, z * scale + j] = col
    d = ImageDraw.Draw(img)
    for x in range(0, SX + 1, 16):
        d.line((x * scale, 0, x * scale, SZ * scale), fill=(40, 46, 52))
    for z in range(0, SZ + 1, 16):
        d.line((0, z * scale, SX * scale, z * scale), fill=(40, 46, 52))
    for (x, y, z), t in w.plants.items():
        if abs(y - WY) < 4:
            d.rectangle((x * scale + 2, z * scale + 2, x * scale + 3, z * scale + 3),
                        fill={'bloodroot': (210, 40, 60), 'bone_coral': (225, 220, 200), 'pallid_cap': (200, 196, 180)}[t])
    for (x, y, z), (n, red) in w.candles.items():
        d.ellipse((x * scale - 3, z * scale - 3, x * scale + scale + 3, z * scale + scale + 3), fill=(255, 196, 96))
    img.save(path)
    return img


def export(w, out):
    L = block_light(w)
    fc = faces(w, L)
    fc.tofile(f'{out}/biome_faces.bin')
    lv = lambda c: int(L[c])
    scene = {
        'size': [SX, SY, SZ], 'y0': Y0, 'water_y': WY, 'names': NAMES, 'faces': int(len(fc)),
        'plants': [[*c, t, lv(c)] for c, t in w.plants.items()],
        'dripstone': [[*c, t, int(h), lv(c)] for c, (t, h) in w.drip.items()],
        'pale': [[*c, t, lv(c)] for c, (t, h) in w.pale.items()],
        'vines': [[*c, tip, lv(c)] for c, tip in w.vines.items()],
        'candles': [[*c, n, int(red), lv(c)] for c, (n, red) in w.candles.items()],
        'water': [[int(x), int(z), int(L[x, WY - 1, z]), int(L[x, WY, z])] for x, z in zip(*np.nonzero((w.v[:, WY - 1, :] == WATER)))],
        'views': pick_views(w, L),
    }
    with open(f'{out}/biome_scene.json', 'w') as f:
        json.dump(scene, f, separators=(',', ':'))
    return scene, L


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    world = generate()
    sc, light = export(world, OUT)
    preview_textures(f'{OUT}/biome_tex')
    biome.textures(f'{OUT}/biome_tex')
    render_map(world, f'{OUT}/biome_map.png')
    v = world.v
    print('scene', sc['size'], 'faces', sc['faces'], 'lake cells', int(((v[:, WY - 1, :] == WATER)).sum()),
          'water blocks', int((v == WATER).sum()), 'air', int((v == AIR).sum()))
    print('plants', len(world.plants), 'pale', len(world.pale), 'dripstone', len(world.drip), 'vines', len(world.vines),
          'candles', len(world.candles), 'bone', int((v == ID['bone_block']).sum()), 'veined', int((v == ID['veined_deepslate']).sum()),
          'ruin blocks', int(sum((v == ID[n]).sum() for n in ('deepslate_bricks', 'cracked_deepslate_bricks', 'deepslate_tiles', 'polished_deepslate'))))
    print('views', {k: (vv if k == 'model' else vv['cam']) for k, vv in sc['views'].items()})
