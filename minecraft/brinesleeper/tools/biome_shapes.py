"""Shapes for the Stillwater Caves' structure features, shared by biome.py (which writes them as .mcstructure
files) and biome_preview.py (which stamps the very same voxels into its preview cavern).

Every shape is a Shape: a grid of palette indices (-1 = structure void, which leaves the world untouched)
plus a palette of (block name, states) using Bedrock's own state names and types (checked against Mojang's
bedrock-samples metadata/vanilladata_modules/mojang-blocks.json).

The flooded halls are the heart of the biome. A custom biome cannot reshape terrain, so the halls are
carved by structure features instead: each hall piece is a rounded dome of explicit air over a bowl of
water, with void everywhere else. Every piece shares one waterline row (HALL_D) and the feature rule
pins that row to a fixed world height, so overlapping pieces always agree (water only ever below the
line, air only above it) and merge into one big, irregular lake with natural rock left standing between
them.
"""
import math

import numpy as np

NS = 'brine'
HALL_W = 23                 # hall piece footprint (blocks); centred on the placement position
HALL_D = 10                 # rows below the waterline (deepest water is 10 blocks)
HALL_U = 15                 # rows above the waterline (tallest dome)
PILLAR_BELOW = 12           # a pillar reaches this far under the waterline...
PILLAR_H = 29               # ...and this tall in all, so it always meets the lakebed and the ceiling
STAL_LENGTHS = range(2, 8)  # pale stalactite columns


class Byte(int):
    """an NBT byte (Bedrock stores boolean block states as bytes)"""


class Shape:
    def __init__(self, sx, sy, sz):
        self.g = np.full((sx, sy, sz), -1, np.int16)
        self.pal, self._key = [], {}

    @property
    def size(self):
        return self.g.shape

    def idx(self, name, states=None):
        states = dict(states or {})
        k = (name, tuple(sorted((a, int(b) if isinstance(b, Byte) else b) for a, b in states.items())))
        if k not in self._key:
            self._key[k] = len(self.pal)
            self.pal.append((name, states))
        return self._key[k]

    def put(self, x, y, z, name, states=None):
        sx, sy, sz = self.g.shape
        if 0 <= x < sx and 0 <= y < sy and 0 <= z < sz:
            self.g[x, y, z] = self.idx(name, states)

    def cells(self):
        """(x, y, z, name, states) for every non-void cell"""
        for x, y, z in zip(*np.nonzero(self.g >= 0)):
            name, states = self.pal[self.g[x, y, z]]
            yield int(x), int(y), int(z), name, states


DEEPSLATE = ('minecraft:deepslate', {'pillar_axis': 'y'})
AIR = ('minecraft:air', {})
WATER = ('minecraft:water', {'liquid_depth': 0})


def bone(axis='y'):
    return 'minecraft:bone_block', {'deprecated': 0, 'pillar_axis': axis}


def candle(n, red=False):
    return ('minecraft:red_candle' if red else 'minecraft:candle'), {'candles': n - 1, 'lit': Byte(1)}


# ------------------------------------------------------------------ smooth 2D noise for outlines and relief
def _noise2(rng, n, cells):
    g = rng.random((cells + 2, cells + 2))
    u = np.linspace(0, cells, n)
    i = np.floor(u).astype(int)
    t = u - i
    t = t * t * (3 - 2 * t)
    a = g[np.ix_(i, i)] * (1 - t)[:, None] + g[np.ix_(i + 1, i)] * t[:, None]
    b = g[np.ix_(i, i + 1)] * (1 - t)[:, None] + g[np.ix_(i + 1, i + 1)] * t[:, None]
    return a * (1 - t)[None, :] + b * t[None, :]


def _wobble(rng, ang, amp, terms=3):
    out = np.zeros_like(ang)
    for k in range(terms):
        out += amp * rng.random() / (k + 1) * np.cos((k + 2) * ang + rng.random() * 2 * math.pi)
    return out


# ------------------------------------------------------------------ flooded hall pieces
HALL_KINDS = {
    #            water  bowl radius   depth     dome ceiling  pillar
    'lake_wide': (True, (8.2, 9.6), (7.0, 10.0), (10.0, 13.0), 0.0),
    'lake_deep': (True, (6.8, 8.2), (9.0, 10.0), (11.0, 15.0), 0.0),
    'lake_pillar': (True, (7.6, 9.2), (6.0, 9.0), (11.0, 14.0), 2.3),
    'shore_dome': (False, (0.0, 0.0), (0.0, 0.0), (11.0, 15.0), 0.0),
    'shore_pillar': (False, (0.0, 0.0), (0.0, 0.0), (12.0, 15.0), 2.6),
}


def hall_piece(kind, seed):
    """a rounded hall: air dome over a water bowl (or a raised shore), structure void outside it"""
    water, rb_range, depth_range, ceil_range, pillar = HALL_KINDS[kind]
    rng = np.random.default_rng(seed)
    W, D, H = HALL_W, HALL_D, HALL_D + HALL_U
    s = Shape(W, H, W)
    air, wat = s.idx(*AIR), s.idx(*WATER)
    c = (W - 1) / 2
    xs, zs = np.meshgrid(np.arange(W) - c, np.arange(W) - c, indexing='ij')
    ang, rad = np.arctan2(zs, xs), np.hypot(xs, zs)
    dome_r = np.minimum(10.8 + _wobble(rng, ang, 0.5), 11.0)              # never reaches the box edge
    ceil = rng.uniform(*ceil_range) * (0.78 + 0.32 * _noise2(rng, W, 4))   # lumpy vaulted ceiling
    if water:
        bowl_r = rng.uniform(*rb_range) + _wobble(rng, ang, 1.4)
        depth = rng.uniform(*depth_range)
        bed = 0.75 + 0.25 * _noise2(rng, W, 3)                            # uneven lakebed
    pill_r = pillar + 0.7 * _noise2(rng, W, 2) if pillar else 0
    for x in range(W):
        for z in range(W):
            r = rad[x, z]
            if r >= dome_r[x, z] or (pillar and math.hypot(xs[x, z] + 0.6, zs[x, z] - 0.4) < pill_r[x, z]):
                continue
            top = int(round(ceil[x, z] * math.sqrt(max(0.0, 1 - (r / dome_r[x, z]) ** 2))))
            if water and r < bowl_r[x, z]:
                t = r / bowl_r[x, z]
                d = max(1, int(round(depth * bed[x, z] * (1 - t * t) ** 0.6)))
                s.g[x, D - d:D, z] = wat
                floor = D
            else:
                inner = bowl_r[x, z] if water else 2.5
                floor = D + 1 + int(max(0.0, r - inner) * (0.42 if water else 0.3))
            if top > floor - D:
                s.g[x, floor:D + top, z] = air
    return s


# ------------------------------------------------------------------ the great pillars left standing in the lakes
def pillar(seed):
    rng = np.random.default_rng(seed)
    W = 9
    s = Shape(W, PILLAR_H, W)
    c = (W - 1) / 2
    base, mid, cap = rng.uniform(3.2, 3.9), rng.uniform(1.6, 2.2), rng.uniform(3.0, 3.8)
    lean = rng.uniform(-0.04, 0.04, 2)
    band = rng.integers(3, 7)
    for y in range(PILLAR_H):
        t = y / (PILLAR_H - 1)
        r = mid + (base - mid) * max(0.0, 1 - t / 0.42) ** 1.6 + (cap - mid) * max(0.0, (t - 0.7) / 0.3) ** 1.4
        ox, oz = c + lean[0] * (y - PILLAR_BELOW), c + lean[1] * (y - PILLAR_BELOW)
        for x in range(W):
            for z in range(W):
                rr = math.hypot(x - ox, z - oz)
                if rr > r + 0.35 * rng.random():
                    continue
                outer = rr > r - 1.0
                roll = rng.random()
                if (y - PILLAR_BELOW) % band == 0 and outer:
                    b = ('minecraft:tuff', {})
                elif outer and y > PILLAR_BELOW + 4 and roll < 0.16:
                    b = (f'{NS}:bloodstained_deepslate', {})                  # old stains from above the waterline
                elif outer and roll < 0.1:
                    b = ('minecraft:cobbled_deepslate', {})
                elif y < PILLAR_BELOW and outer and roll < 0.25:
                    b = ('minecraft:mud', {})                                 # silt caked on the drowned base
                else:
                    b = DEEPSLATE
                s.put(x, y, z, *b)
    return s


# ------------------------------------------------------------------ the ribcage of something that drowned here
def ribcage(seed):
    rng = np.random.default_rng(seed)
    s = Shape(11, 10, 15)
    sx = 5
    for z in range(1, 14):                         # the spine, lying along z
        s.put(sx, 1, z, *bone('z'))
        if z % 2 == 0 and rng.random() < 0.7:
            s.put(sx, 2, z, *bone('y'))            # a vertebra's knuckle
    s.put(sx, 1, 0, *bone('z'))
    arc = [(1, 1), (2, 2), (3, 3), (4, 4), (4, 5), (4, 6), (3, 7), (2, 8)]   # (outward, up) from the spine
    for i, z in enumerate((3, 5, 7, 9, 11)):
        scale = 1.0 - 0.1 * i
        for side in (-1, 1):
            if rng.random() < 0.12:                 # a rib long gone
                continue
            cut = len(arc) if rng.random() > 0.3 else rng.integers(4, len(arc))   # snapped off
            for k, (dx, dy) in enumerate(arc[:cut]):
                x = sx + side * max(1, int(round(dx * (0.85 + 0.15 * scale))))
                y = 1 + int(round((dy - 1) * scale))
                axis = 'y' if 2 <= k <= 5 else 'x'
                s.put(x, y, z, *bone(axis))
    return s


# ------------------------------------------------------------------ sunken shrines: someone came down here, once
BRICKS = ('minecraft:deepslate_bricks', {})
CRACKED = ('minecraft:cracked_deepslate_bricks', {})
TILES = ('minecraft:deepslate_tiles', {})
POLISHED = ('minecraft:polished_deepslate', {})
CHISELED = ('minecraft:chiseled_deepslate', {})
SLAB = ('minecraft:deepslate_brick_slab', {'minecraft:vertical_half': 'bottom'})


def _brick(rng):
    return CRACKED if rng.random() < 0.35 else BRICKS


def shrine(seed):
    rng = np.random.default_rng(seed)
    s = Shape(7, 6, 7)
    for x in range(1, 6):
        for z in range(1, 6):
            s.put(x, 0, z, *(POLISHED if rng.random() < 0.7 else CRACKED))          # sunk into the floor
            if rng.random() < 0.85:
                s.put(x, 1, z, *(TILES if rng.random() < 0.75 else POLISHED))
    for x, z in ((1, 1), (5, 1), (1, 5), (5, 5)):
        h = int(rng.integers(1, 5))
        for y in range(2, 2 + h):
            s.put(x, y, z, *_brick(rng))
        if h >= 3:
            s.put(x, 2 + h, z, *SLAB)
    s.put(0, 1, int(rng.integers(1, 6)), *_brick(rng))                               # a fallen block
    s.put(3, 1, 3, *CHISELED)
    s.put(3, 2, 3, *CHISELED)
    s.put(3, 3, 3, *candle(4, red=True))                                             # the altar
    for x, z, n in ((2, 2, 2), (4, 3, 1), (3, 4, 3), (2, 4, 1)):
        if rng.random() < 0.8:
            s.put(x, 2, z, *candle(n, red=rng.random() < 0.5))
    s.put(4, 2, 2, *bone('x'))
    return s


def arch(seed):
    rng = np.random.default_rng(seed)
    s = Shape(9, 8, 3)
    for x in range(9):
        for z in range(3):
            if rng.random() < 0.8:
                s.put(x, 0, z, *POLISHED)
    for x in (1, 7):
        for y in range(1, 6):
            for z in (0, 1, 2):
                if z == 1 or y < 3:
                    s.put(x, y, z, *_brick(rng))
    for x in range(1, 8):                                   # the span, broken on the right
        if x >= 5 and rng.random() < 0.85:
            continue
        s.put(x, 6, 1, *_brick(rng))
    for x in (2, 6):
        s.put(x, 5, 1, *(TILES if x == 2 else CRACKED))
    s.put(int(rng.integers(5, 8)), 1, 0, *_brick(rng))     # rubble from the fall
    s.put(2, 1, 1, *candle(3, red=True))
    s.put(6, 1, 1, *candle(2))
    s.put(1, 6, 1, *candle(1))
    return s


def wall(seed):
    rng = np.random.default_rng(seed)
    s = Shape(9, 6, 2)
    tops = [int(rng.integers(1, 6)) for _ in range(9)]
    tops[4] = max(tops[4], 4)
    for x in range(9):
        s.put(x, 0, 0, *POLISHED)
        s.put(x, 0, 1, *POLISHED)
        for y in range(1, tops[x] + 1):
            if x == 4 and y == 2:
                continue                                    # the niche
            s.put(x, y, 1, *(TILES if y == 1 else _brick(rng)))
    s.put(4, 1, 1, *CHISELED)
    s.put(4, 2, 1, *candle(3))
    for x in (2, 6):
        if rng.random() < 0.7:
            s.put(x, 1, 0, *candle(int(rng.integers(1, 3)), red=True))
    return s


RUINS = {'shrine': shrine, 'arch': arch, 'wall': wall}


# ------------------------------------------------------------------ pale stalactites (the biome's own bleached dripstone)
def pale_thickness(n):
    if n == 1:
        return ['tip']
    if n == 2:
        return ['frustum', 'tip']
    return ['base'] + ['middle'] * (n - 3) + ['frustum', 'tip']


def pale_stalactite(n):
    """hanging column: base on top (against the ceiling), tip at the bottom"""
    s = Shape(1, n, 1)
    for i, t in enumerate(reversed(pale_thickness(n))):
        s.put(0, i, 0, f'{NS}:pale_dripstone_{t}')
    return s


def all_structures():
    """name -> Shape for every structure file the biome ships (besides the vanilla pointed dripstone columns)"""
    out = {}
    for i, kind in enumerate(HALL_KINDS):
        for v in range(2):
            out[f'hall_{kind}_{v}'] = hall_piece(kind, 1000 + 17 * i + v)
    for v in range(3):
        out[f'pillar_{v}'] = pillar(2000 + v)
    for v in range(2):
        out[f'ribcage_{v}'] = ribcage(3000 + v)
    for name, fn in RUINS.items():
        out[f'ruin_{name}'] = fn(4000 + len(name))
    for n in STAL_LENGTHS:
        out[f'pale_stalactite_{n}'] = pale_stalactite(n)
    return out
