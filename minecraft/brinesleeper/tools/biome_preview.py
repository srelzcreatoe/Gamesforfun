"""Preview of the Stillwater Caves: runs the biome's own generation rules (biome.py) on a sample cavern.

This is a simulation for the preview renders, not Minecraft's generator. It carves a flooded
dripstone-style cavern, applies the biome's subsurface wall noise, then places every decoration
with the same parameters as the pack's feature rules (patches, snaps, structures, vines, plants,
pools, footprints, claw marks). Output: out/biome_scene.json for viewer/biome.html, plus preview
textures for the vanilla blocks (original pixel art in the vanilla palette, not Mojang files).
Usage: python3 biome_preview.py [out dir]
"""
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image

import biome

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
SX, SY, SZ = 80, 48, 96
Y0 = -40                      # world y of the volume's bottom layer
WATER_Y = 13                  # lake surface (local y)
R = random.Random(7)

AIR, WATER, STONE, DEEP, TUFF, BASALT, DRIP, GRAVEL, MUD, CLAY, BLOODY, CLAWED, TRACKED = range(13)
NAMES = ['air', 'water', 'stone', 'deepslate', 'tuff', 'smooth_basalt', 'dripstone_block', 'gravel', 'mud', 'clay',
         'bloodstained_deepslate', 'clawed_deepslate', 'tracked_mud']
SOLID = lambda b: b >= STONE
REPLACEABLE = {STONE, DEEP, TUFF, BASALT, DRIP, GRAVEL, MUD, CLAY}
BLOCK_ID = {'minecraft:dripstone_block': DRIP, 'minecraft:gravel': GRAVEL, 'minecraft:mud': MUD, 'minecraft:clay': CLAY,
            'brine:bloodstained_deepslate': BLOODY}


def value_noise3(shape, cell, seed):
    rng = np.random.default_rng(seed)
    gx, gy, gz = [int(math.ceil(s / c)) + 2 for s, c in zip(shape, cell)]
    g = rng.random((gx, gy, gz))
    x = np.arange(shape[0]) / cell[0]; y = np.arange(shape[1]) / cell[1]; z = np.arange(shape[2]) / cell[2]
    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    x0, y0, z0 = X.astype(int), Y.astype(int), Z.astype(int)
    fx, fy, fz = X - x0, Y - y0, Z - z0
    fx, fy, fz = [t * t * (3 - 2 * t) for t in (fx, fy, fz)]
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy) * (fz if dz else 1 - fz)
                out = out + w * g[x0 + dx, y0 + dy, z0 + dz]
    return out


def carve():
    v = np.full((SX, SY, SZ), STONE, dtype=np.int8)
    n2 = value_noise3((SX, 1, SZ), (14, 1, 14), 1)[:, 0, :]
    n2b = value_noise3((SX, 1, SZ), (20, 1, 20), 2)[:, 0, :]
    wall = value_noise3((SX, SY, SZ), (9, 7, 9), 3)
    xs = np.arange(SX)[:, None]
    zs = np.arange(SZ)[None, :]
    cx = 40 + 9 * np.sin(zs / 21.0)
    half = (26 + 6 * np.sin(zs / 13.0 + 1)) * np.clip((SZ - 6 - zs) / 18.0, 0.0, 1.0) * np.clip((zs - 1) / 4.0, 0.0, 1.0) + 1e-3
    u = np.abs(xs - cx) / half                        # 0 in the middle of the cavern, 1 at the walls
    floor = 9 + 6 * n2 + 7 * u ** 2 - 4 * np.exp(-((zs - 52) / 26.0) ** 2) * (1 - u)
    ceil = np.minimum(33 + 8 * n2b - 10 * u ** 2, SY - 4)
    for y in range(SY):
        inside = (u + 0.35 * (wall[:, y, :] - 0.5) < 1.0) & (y > floor) & (y < ceil + 3 * (wall[:, y, :] - 0.5))
        v[:, y, :][inside] = AIR
    # two dripstone columns joining floor and ceiling
    for px, pz in ((30, 60), (52, 40)):
        for y in range(SY):
            for dx in range(-1, 2):
                for dz in range(-1, 2):
                    if dx * dx + dz * dz <= 1 + (y % 3 == 0):
                        v[px + dx, y, pz + dz] = STONE
    # the lake: every cave cell up to the water line fills (an aquifer, as in vanilla)
    lake = (v == AIR) & (np.arange(SY)[None, :, None] <= WATER_Y)
    v[lake] = WATER
    return v


def subsurface(v):
    """biome.py's minecraft:subsurface_builder ranges over a 3D noise in [-1, 1]"""
    n = value_noise3(v.shape, (14, 10, 14), 5) * 0.6 + value_noise3(v.shape, (6, 5, 6), 6) * 0.3 + value_noise3(v.shape, (3, 3, 3), 8) * 0.1
    n = (n - 0.5) * 2.2
    stone = v == STONE
    for lo, hi, blk in ((-1.0, -0.12, DEEP), (-0.12, -0.05, TUFF), (0.18, 0.3, BASALT), (0.3, 1.0, DEEP)):
        v[stone & (n >= lo) & (n < hi)] = blk
    # below world y 0 the vanilla terrain is deepslate anyway
    v[:, :max(0, -Y0 - 8), :][v[:, :max(0, -Y0 - 8), :] == STONE] = DEEP


class Decorator:
    def __init__(self, v):
        self.v = v
        self.plants, self.drip, self.vines = {}, {}, {}

    def inb(self, x, y, z):
        return 0 <= x < SX and 0 <= y < SY and 0 <= z < SZ

    def at(self, x, y, z):
        return self.v[x, y, z] if self.inb(x, y, z) else STONE

    def free(self, x, y, z):
        return self.inb(x, y, z) and self.v[x, y, z] == AIR and (x, y, z) not in self.plants and (x, y, z) not in self.drip \
            and (x, y, z) not in self.vines

    # snap_to_surface: the origin must be in air, then search down (floor) or up (ceiling)
    def snap(self, x, y, z, surface, rng=12):
        if not self.free(x, y, z):
            return None
        step = -1 if surface == 'floor' else 1
        for k in range(rng - 2):
            ny = y + step * k
            nxt = ny + step
            if not self.inb(x, ny, z) or not self.free(x, ny, z):
                return None
            if SOLID(self.at(x, nxt, z)):
                return ny
        return None

    def wall(self, x, y, z, rng=10):
        if not self.free(x, y, z):
            return None
        dx, dz = R.choice(((1, 0), (-1, 0), (0, 1), (0, -1)))
        for k in range(1, rng):
            if not self.inb(x + dx * k, y, z + dz * k):
                return None
            b = self.at(x + dx * k, y, z + dz * k)
            if SOLID(b):
                return (x + dx * k, y, z + dz * k)
            if b != AIR:
                return None
        return None

    def column(self, x, y, z, n, hanging):
        cells = [(x, y - i if hanging else y + i, z) for i in range(n)]
        if not all(self.free(*c) for c in cells):
            return False
        states = biome.thickness(n)          # from the attached end
        for c, t in zip(cells, states):
            self.drip[c] = (t, hanging)
        return True

    def stalactite(self, x, y, z):
        return self.column(x, y, z, R.choices(list(biome.STALACTITES), (3, 4, 3, 2, 1))[0], True)

    def stalagmite(self, x, y, z):
        return self.column(x, y, z, R.choices(list(biome.STALAGMITES), (3, 4, 2, 1))[0], False)

    def vine(self, x, y, z):
        h = R.choices([R.randint(1, 3), R.randint(3, 7), R.randint(7, 11)], (6, 3, 1))[0]
        placed = 0
        for i in range(h):
            if not self.free(x, y - i, z):
                break
            self.vines[(x, y - i, z)] = 0
            placed += 1
        if placed:
            self.vines[(x, y - placed + 1, z)] = 1    # the tip
        return placed > 0

    def plant(self, x, y, z):
        if not self.free(x, y, z) or self.at(x, y - 1, z) not in REPLACEABLE | {TRACKED, BLOODY, CLAWED}:
            return False
        self.plants[(x, y, z)] = R.choices(['bone_coral', 'bloodroot'], (3, 4))[0]
        return True

    def footprint(self, x, y, z):
        fy = self.snap(x, y, z, 'floor', 4)
        if fy is None or self.at(x, fy - 1, z) not in (MUD, GRAVEL, CLAY):
            return False
        self.v[x, fy - 1, z] = TRACKED
        return True

    def patch(self, cx, cy, cz, surface, ground, veg, chance, radius, depth, vrange, deep_chance, edge, waterlogged=False):
        r = R.randint(*radius)
        cols = []
        for dx in range(-r - 1, r + 2):
            for dz in range(-r - 1, r + 2):
                border = max(abs(dx), abs(dz)) == r + 1
                if border and (abs(dx) == abs(dz) or R.random() > edge):
                    continue
                x, z = cx + dx, cz + dz
                if not (0 <= x < SX and 0 <= z < SZ):
                    continue
                # search both ways for an air/solid boundary
                for k in sorted(range(-vrange, vrange + 1), key=abs):
                    y = cy + k
                    if not (1 <= y < SY - 1):
                        continue
                    if surface == 'floor' and self.v[x, y, z] == AIR and self.v[x, y - 1, z] in REPLACEABLE:
                        cols.append((x, y - 1, z)); break
                    if surface == 'ceiling' and self.v[x, y, z] == AIR and self.v[x, y + 1, z] in REPLACEABLE:
                        cols.append((x, y + 1, z)); break
        step = -1 if surface == 'floor' else 1
        tops = []
        for x, y, z in cols:
            d = depth + (1 if R.random() < deep_chance else 0)
            for i in range(d):
                yy = y + step * i
                if self.inb(x, yy, z) and self.v[x, yy, z] in REPLACEABLE:
                    self.v[x, yy, z] = ground
            tops.append((x, y, z))
        if waterlogged and surface == 'floor':
            for x, y, z in tops:
                if all(self.at(x + a, y, z + b) != AIR for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    self.v[x, y, z] = WATER
        for x, y, z in tops:
            if R.random() < chance and self.v[x, y, z] != WATER:
                veg(x, y - step, z)
        return bool(tops)


def decorate(v):
    d = Decorator(v)
    chunks = [(cx, cz) for cx in range(0, SX, 16) for cz in range(0, SZ, 16)]

    def rand_pos(cx, cz):
        return cx + R.randrange(16), R.randrange(1, SY - 1), cz + R.randrange(16)

    def stal_on_ceiling(x, y, z):
        cy = d.snap(x, y, z, 'ceiling', 16)
        return cy is not None and d.stalactite(x, cy, z)

    def stag_on_floor(x, y, z):
        fy = d.snap(x, y, z, 'floor', 16)
        return fy is not None and d.stalagmite(x, fy, z)

    def vine_on_ceiling(x, y, z):
        cy = d.snap(x, y, z, 'ceiling', 16)
        return cy is not None and d.vine(x, cy, z)

    def plant_on_floor(x, y, z):
        fy = d.snap(x, y, z, 'floor', 12)
        return fy is not None and d.plant(x, fy, z)

    def mud_life(x, y, z):
        return d.plant(x, y, z) if R.random() < 0.4 else d.footprint(x, y, z)

    def claws(x, y, z):
        fy = d.snap(x, y, z, 'floor', 12)
        if fy is None:
            return
        for _ in range(20):
            cx, cy, cz = x + R.randint(-5, 5), fy + R.randint(0, 3), z + R.randint(-5, 5)
            if d.inb(cx, cy, cz) and d.v[cx, cy, cz] in (DEEP, STONE, TUFF, BASALT) and \
                    any(d.at(cx + a, cy, cz + b) == AIR for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                d.v[cx, cy, cz] = CLAWED

    def trail(x, y, z):
        for _ in range(6):
            d.footprint(x + R.randint(-1, 1), y + R.randint(-1, 1), z + R.randint(-7, 7))

    # (iterations per chunk, action) - the same order and counts as biome.decorations()
    plan = [
        (5, lambda p: d.patch(*p, 'ceiling', BLOODY, lambda x, y, z: d.vine(x, y, z), 0.12, (2, 4), 1, 10, 0.35, 0.5)),
        (7, lambda p: d.patch(*p, 'ceiling', DRIP, lambda x, y, z: d.stalactite(x, y, z), 0.16, (2, 5), 2, 10, 0.6, 0.4)),
        (3, lambda p: d.patch(*p, 'floor', DRIP, lambda x, y, z: d.stalagmite(x, y, z), 0.16, (2, 4), 2, 8, 0.6, 0.4)),
        (16, lambda p: stal_on_ceiling(*p)),
        (10, lambda p: stag_on_floor(*p)),
        (6, lambda p: vine_on_ceiling(*p)),
        (8, lambda p: d.patch(*p, 'floor', MUD, lambda x, y, z: None, 0.0, (3, 7), 2, 6, 0.7, 0.6, waterlogged=True)),
        (5, lambda p: d.patch(*p, 'floor', GRAVEL, lambda x, y, z: d.plant(x, y, z), 0.14, (2, 5), 1, 6, 0.5, 0.5)),
        (4, lambda p: d.patch(*p, 'floor', MUD, mud_life, 0.12, (2, 4), 1, 6, 0.4, 0.5)),
        (24, lambda p: plant_on_floor(*p)),
        (2, lambda p: trail(*p)),
        (10, lambda p: claws(*p)),
    ]
    for n, act in plan:
        for cx, cz in chunks:
            for _ in range(n):
                act(rand_pos(cx, cz))
    return d


# ------------------------------------------------------------------ preview-only textures for vanilla blocks
def tex_noise(palette, cuts, seed, sx=1.0, sy=1.0, speck=0.05):
    rng = np.random.default_rng(seed)
    return biome.paint(biome.tile_noise(rng, sx, sy), palette, cuts, rng, speck=speck)


def preview_textures(out):
    os.makedirs(out, exist_ok=True)
    stone = ['#5f5f62', '#6c6c6f', '#7a7a7d', '#88888a']
    tuff = ['#4d5046', '#5d5d52', '#6a6e6f', '#85837b']
    basalt = ['#1b2632', '#32333d', '#3a3b48', '#4f4b4f', '#5c5c5c']
    drip = ['#634a47', '#735450', '#836356', '#927965', '#a08d71']
    gravel = ['#5a5252', '#6e6766', '#817f7f', '#968e8e', '#a9a2a1']
    clay = ['#8f949f', '#9aa3b3', '#a1a7b1', '#acaebd']
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
    }
    # pointed dripstone (cross planes): tip, frustum, middle, base drawn as a tapering spike
    widths = {'tip': [0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4], 'frustum': [3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6],
              'middle': [5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7], 'base': [6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]}
    for name, ws in widths.items():
        img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        for y in range(16):
            w = ws[y]
            for x in range(8 - w, 8 + w):
                c = drip[min(4, max(0, (x - (8 - w)) * 5 // max(1, 2 * w)))]
                img.putpixel((x, y), biome.rgb(c) + (255,))
        imgs[f'pointed_dripstone_{name}'] = img          # drawn point-up (standing); flipped for hanging
    vine = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    tip = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    r = random.Random(3)
    for img, ln in ((vine, 16), (tip, 11)):
        for sx in (4, 7, 9, 12):
            x = sx
            for y in range(ln if img is tip else 16):
                c = biome.BLOOD[r.choice((1, 2, 3))]
                img.putpixel((x, y), biome.rgb(c) + (255,))
                if r.random() < 0.3:
                    x = max(1, min(14, x + r.choice((-1, 1))))
            if img is tip:
                img.putpixel((x, ln), biome.rgb(biome.BLOOD[4]) + (255,))
    imgs['weeping_vines'] = vine
    imgs['weeping_vines_tip'] = tip
    for k, img in imgs.items():
        img.save(f'{out}/{k}.png')
    return list(imgs)


def los(v, a, b):
    a, b = np.array(a, float), np.array(b, float)
    n = int(np.linalg.norm(b - a) * 3) + 1
    for i in range(1, n):
        p = a + (b - a) * i / n
        c = tuple(np.floor(p).astype(int))
        if not (0 <= c[0] < SX and 0 <= c[1] < SY and 0 <= c[2] < SZ) or v[c] >= STONE:
            if np.linalg.norm(p - b) > 1.2:
                return False
    return True


def clearance(v, x, y, z, r=2):
    sub = v[max(0, x - r):x + r + 1, max(0, y - r):y + r + 1, max(0, z - r):z + r + 1]
    return not (sub >= STONE).any()


def pick_views(d):
    v, views = d.v, {}
    # lake: near end of the cavern, a few blocks above the water, looking down its length
    best = None
    for z in range(4, 14):
        for x in range(20, 60):
            y = WATER_Y + 5
            if v[x, y, z] == AIR and clearance(v, x, y, z, 2):
                look = (x + 2, WATER_Y + 1, z + 48)
                score = -abs(x - 40) - abs(z - 6) * 0.5
                if los(v, (x + .5, y + .5, z + .5), look) and (best is None or score > best[0]):
                    best = (score, (x + 0.5, y + 0.5, z + 0.5), look)
    views['lake'] = {'cam': best[1], 'look': best[2]}
    # the Brinesleeper: deepest lake cell 26-40 blocks down the view
    cam = np.array(best[1]); dirv = np.array(best[2]) - cam; dirv /= np.linalg.norm(dirv)
    cand = []
    for x, z in ((x, z) for x in range(SX) for z in range(SZ)):
        if v[x, WATER_Y, z] == WATER and v[x, WATER_Y + 1, z] == AIR:
            depth = sum(1 for y in range(WATER_Y, -1, -1) if v[x, y, z] == WATER)
            rel = np.array([x + .5, WATER_Y, z + .5]) - cam
            along = rel @ dirv
            off = np.linalg.norm(rel - along * dirv)
            if 12 < along < 18 and off < 4 and depth >= 3:
                cand.append((off, x, z))
    if cand:
        _, mx, mz = min(cand)
        views['model'] = [mx + 0.5, WATER_Y + 1, mz + 0.5]
    # shore: tracked mud or plants seen from 5-8 blocks away, standing in open air
    targets = [k for k in zip(*np.nonzero(v == TRACKED))] or list(d.plants)
    def density(t):
        return sum(1 for p in d.plants if abs(p[0] - t[0]) < 6 and abs(p[2] - t[2]) < 6 and abs(p[1] - t[1]) < 4)
    for t in sorted(targets, key=lambda t: -density(t)):
        look = (t[0] + .5, t[1] + 1.2, t[2] + .5)
        opts = []
        for dist in (6, 7, 8, 5):
            for a in range(0, 360, 20):
                for h in (3, 4, 2):
                    cx, cz = t[0] + dist * math.cos(math.radians(a)), t[2] + dist * math.sin(math.radians(a))
                    c = (int(cx), int(t[1] + h), int(cz))
                    if 0 < c[0] < SX - 1 and 0 < c[1] < SY - 1 and 0 < c[2] < SZ - 1 and v[c] == AIR and clearance(v, *c, 1):
                        if los(v, (cx, t[1] + h + .5, cz), look):
                            opts.append((dist, (cx, t[1] + h + .5, cz)))
        if opts:
            views['shore'] = {'cam': min(opts)[1], 'look': look}
            break
    # ceiling: looking up at the densest patch of vines and stalactites
    hang = [p for p in d.vines]
    def hdens(t):
        return sum(1 for p in hang if abs(p[0] - t[0]) < 6 and abs(p[2] - t[2]) < 6)
    for t in sorted(hang, key=lambda t: -hdens(t))[:200]:
        top = t[1]
        while top + 1 < SY and (v[t[0], top + 1, t[2]] == AIR):
            top += 1
        look = (t[0] + .5, top + .5, t[2] + .5)
        found = None
        for dist in (12, 11, 13, 10):
            for a in range(0, 360, 30):
                cx, cz = t[0] + dist * math.cos(math.radians(a)), t[2] + dist * math.sin(math.radians(a))
                for dy in (6, 7, 8, 5):
                    c = (int(cx), int(top - dy), int(cz))
                    if 0 < c[0] < SX - 1 and WATER_Y < c[1] < SY - 1 and 0 < c[2] < SZ - 1 and v[c] == AIR and clearance(v, *c, 2):
                        if los(v, (cx, top - dy + .5, cz), look):
                            found = (cx, top - dy + .5, cz); break
                if found: break
            if found: break
        if found:
            views['ceiling'] = {'cam': found, 'look': look}
            break
    return views


def export(d, path):
    v = d.v
    solid = v >= STONE
    exposed = np.zeros_like(solid)
    for axis in range(3):
        for sh in (1, -1):
            nb = np.roll(v, sh, axis=axis)
            exposed |= solid & (nb < STONE)
    blocks = [[int(x), int(y), int(z), int(v[x, y, z])] for x, y, z in zip(*np.nonzero(exposed))]
    water = [[int(x), int(y), int(z)] for x, y, z in zip(*np.nonzero(v == WATER)) if y + 1 < SY and v[x, y + 1, z] != WATER]
    scene = {
        'size': [SX, SY, SZ], 'y0': Y0, 'names': NAMES, 'blocks': blocks, 'water_tops': water,
        'plants': [[x, y, z, t] for (x, y, z), t in d.plants.items()],
        'dripstone': [[x, y, z, t, int(h)] for (x, y, z), (t, h) in d.drip.items()],
        'vines': [[x, y, z, tip] for (x, y, z), tip in d.vines.items()],
        'water_y': WATER_Y,
        'views': pick_views(d),
    }
    with open(path, 'w') as f:
        json.dump(scene, f, separators=(',', ':'))
    return scene


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    vox = carve()
    subsurface(vox)
    deco = decorate(vox)
    sc = export(deco, f'{OUT}/biome_scene.json')
    preview_textures(f'{OUT}/biome_tex')
    biome.textures(f'{OUT}/biome_tex')
    counts = {NAMES[i]: int((deco.v == i).sum()) for i in range(len(NAMES))}
    print('scene', sc['size'], 'exposed blocks', len(sc['blocks']), 'water tops', len(sc['water_tops']))
    print('decorations: plants', len(deco.plants), 'dripstone blocks', len(deco.drip), 'vine blocks', len(deco.vines),
          'tracked mud', counts['tracked_mud'], 'clawed', counts['clawed_deepslate'], 'bloodstained', counts['bloodstained_deepslate'])
