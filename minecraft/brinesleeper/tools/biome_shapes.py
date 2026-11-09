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


# ------------------------------------------------------------------ the great halls (placed by the script, so every visit has one)
GH_W, GH_H, GH_D = 80, 44, 14          # footprint, height, waterline row (lake water fills rows below GH_D)


def _dilate(mask, r):
    out = mask.copy()
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            for dz in range(-r, r + 1):
                if dx * dx + dy * dy + dz * dz > r * r + 0.5:
                    continue
                out |= np.roll(np.roll(np.roll(mask, dx, 0), dy, 1), dz, 2)
    return out


def great_hall(seed):
    """A vast flooded cavern like the reference pictures: a domed hall over a black lake up to 12 deep, great pillars,
    islands, pale and red curtains from the ceiling, glowing veins, shores of coral, bloodroot and pallid caps, a sunken
    shrine and a ribcage, lit candles, loot chests, and a tunnel out of the middle of every side. A 3-block rock shell
    seals it (no leaks, nothing of older caves left floating inside); structure void beyond the shell."""
    rng = np.random.default_rng(seed)
    W, H, D = GH_W, GH_H, GH_D
    c = (W - 1) / 2
    xs, zs = np.meshgrid(np.arange(W) - c, np.arange(W) - c, indexing='ij')
    ang, rad = np.arctan2(zs, xs), np.hypot(xs, zs)
    R = np.minimum(33.0 + _wobble(rng, ang, 2.0, 4), 35.0)
    Rl = R * rng.uniform(0.74, 0.8) + _wobble(rng, ang, 1.2)
    ceil = rng.uniform(21, 25) * (0.82 + 0.2 * _noise2(rng, W, 7))
    bed = 0.72 + 0.28 * _noise2(rng, W, 5)
    dmax = rng.uniform(10.5, 12)
    AIR_, WAT, ROCK = 1, 2, 3
    reg = np.zeros((W, H, W), np.int8)
    for x in range(W):
        for z in range(W):
            r, Rx = rad[x, z], R[x, z]
            if r >= Rx:
                continue
            top = min(H - 4, D + int(ceil[x, z] * (1 - (r / Rx) ** 2) ** 0.42))
            if r < Rl[x, z]:
                d = max(1, int(round(dmax * bed[x, z] * (1 - (r / Rl[x, z]) ** 2) ** 0.5)))
                reg[x, D - d:D, z] = WAT
                lo = D
            else:
                lo = D + 1 + int((r - Rl[x, z]) * 0.3)
            if top > lo:
                reg[x, lo:top, z] = AIR_
    # islands rising out of the lake
    islands = []
    for _ in range(rng.integers(2, 4)):
        for _try in range(20):
            a, rr = rng.uniform(0, 2 * math.pi), rng.uniform(5, 19)
            ix, iz = int(c + math.cos(a) * rr), int(c + math.sin(a) * rr)
            if all(math.hypot(ix - p[0], iz - p[1]) > 9 for p in islands):
                break
        rad_i = rng.uniform(2.6, 4.2)
        islands.append((ix, iz, rad_i))
        for x in range(max(0, ix - 6), min(W, ix + 7)):
            for z in range(max(0, iz - 6), min(W, iz + 7)):
                if math.hypot(x - ix, z - iz) < rad_i + 0.6 * rng.random() and reg[x, D - 1, z] == WAT:
                    reg[x, :D + 1, z] = np.where(reg[x, :D + 1, z] > 0, ROCK, reg[x, :D + 1, z])
    # great pillars from the lakebed to the ceiling, flared at both ends
    for _ in range(rng.integers(7, 11)):
        a, rr = rng.uniform(0, 2 * math.pi), rng.uniform(5, 28)
        px, pz = c + math.cos(a) * rr, c + math.sin(a) * rr
        base, mid = rng.uniform(3.0, 4.0), rng.uniform(1.6, 2.4)
        for y in range(H):
            col = (reg[int(px), y, int(pz)] > 0)
            t = y / (H - 1)
            r_y = mid + (base - mid) * (max(0, 1 - t / 0.35) ** 1.5 + max(0, (t - 0.65) / 0.35) ** 1.5)
            for x in range(int(px - 5), int(px + 6)):
                for z in range(int(pz - 5), int(pz + 6)):
                    if 0 <= x < W and 0 <= z < W and math.hypot(x - px, z - pz) < r_y and reg[x, y, z] in (AIR_, WAT):
                        reg[x, y, z] = ROCK
    # a tunnel out of the middle of every side, at walking height, through the shell to the edge
    for ax, sx in ((0, 1), (0, -1), (2, 1), (2, -1)):
        off = int(rng.integers(-4, 5))
        for step in range(int(c) - 20, W // 2 + 1):
            u = int(c + sx * step) if sx > 0 else int(c - step)
            u = min(W - 1, max(0, u))
            for k in range(-2, 2):
                v = int(c) + off + k
                for y in range(D + 1, D + 6):
                    p = (u, y, v) if ax == 0 else (v, y, u)
                    if reg[p] == 0 or reg[p] == ROCK:
                        reg[p] = AIR_
                p = (u, D, v) if ax == 0 else (v, D, u)
                if reg[p] in (0, AIR_):
                    reg[p] = ROCK
    cav = reg > 0
    shell = _dilate(cav, 3) & ~cav
    reg[shell] = ROCK
    reg[(reg == 0)] = 0
    # ---- materials
    s = Shape(W, H, W)
    n3 = np.random.default_rng(seed + 1)
    band = (np.arange(H) % rng.integers(5, 8) == 0)
    air = lambda p: 0 <= p[1] < H and reg[p] == AIR_
    for x in range(W):
        for z in range(W):
            for y in range(H):
                k = reg[x, y, z]
                if k == 0:
                    continue
                if k == WAT:
                    s.g[x, y, z] = s.idx(*WATER)
                    continue
                if k == AIR_:
                    s.g[x, y, z] = s.idx(*AIR)
                    continue
                above = reg[x, y + 1, z] if y + 1 < H else 0
                below = reg[x, y - 1, z] if y > 0 else 0
                side_air = any(0 <= x + dx < W and 0 <= z + dz < W and reg[x + dx, y, z + dz] == AIR_ for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                roll = n3.random()
                if above == WAT:                                        # lakebed
                    b = pick_w(n3, [((f'{NS}:veined_deepslate', {}), 1), (('minecraft:mud', {}), 4), (('minecraft:gravel', {}), 2),
                                    (('minecraft:clay', {}), 2), (DEEPSLATE, 3)])
                elif above == AIR_:                                     # shores and island tops
                    b = pick_w(n3, [(('minecraft:gravel', {}), 3), (('minecraft:mud', {}), 3), (DEEPSLATE, 4), (('minecraft:tuff', {}), 1),
                                    ((f'{NS}:tracked_mud', {}), 0.4)])
                elif below == AIR_:                                     # ceilings: blood and pale stone
                    b = (f'{NS}:bloodstained_deepslate', {}) if roll < 0.28 else ('minecraft:calcite', {}) if roll < 0.3 else DEEPSLATE
                elif side_air and D <= y <= D + 4 and roll < 0.12:      # claw marks and blood by the water
                    b = (f'{NS}:clawed_deepslate', {}) if roll < 0.05 else (f'{NS}:bloodstained_deepslate', {})
                elif side_air and roll < 0.03:
                    b = (f'{NS}:veined_deepslate', {})
                elif band[y] and roll < 0.7:
                    b = ('minecraft:tuff', {})
                else:
                    b = DEEPSLATE if roll < 0.9 else ('minecraft:smooth_basalt', {}) if roll < 0.95 else ('minecraft:cobbled_deepslate', {})
                s.g[x, y, z] = s.idx(*b)
    # ---- the hanging curtains: pale dripstone and red vines, the brown stalactites of the old caves
    for x in range(W):
        for z in range(W):
            for y in range(H - 1, D, -1):
                if not (reg[x, y, z] == AIR_ and reg[x, y + 1, z] == ROCK):
                    continue
                roll = n3.random()
                room = 0
                while y - room > D + 1 and reg[x, y - room, z] == AIR_:
                    room += 1
                if roll < 0.1 and room >= 4:
                    n = int(min(room - 2, n3.integers(2, 8)))
                    parts = pale_thickness(n)
                    for i, part in enumerate(parts):
                        s.g[x, y - i, z] = s.idx(f'{NS}:pale_dripstone_{part}')
                elif roll < 0.17 and room >= 4:
                    n = int(min(room - 2, n3.integers(2, 13)))
                    for i in range(n):
                        s.g[x, y - i, z] = s.idx('minecraft:weeping_vines', {'weeping_vines_age': 0})
                elif roll < 0.2 and room >= 4:
                    n = int(min(room - 2, n3.integers(2, 5)))
                    th = ['tip'] if n == 1 else ['frustum', 'tip'] if n == 2 else ['base'] + ['middle'] * (n - 3) + ['frustum', 'tip']
                    for i, part in enumerate(th):
                        s.g[x, y - i, z] = s.idx('minecraft:pointed_dripstone', {'dripstone_thickness': part, 'hanging': Byte(1)})
                break
    # ---- shores: coral, bloodroot, caps
    floors = []
    for x in range(W):
        for z in range(W):
            for y in range(D + 1, H - 1):
                if reg[x, y, z] == AIR_ and reg[x, y - 1, z] == ROCK and s.g[x, y, z] == s.idx(*AIR):
                    floors.append((x, y, z))
                    roll = n3.random()
                    if roll < 0.07:
                        s.g[x, y, z] = s.idx(f'{NS}:bone_coral')
                    elif roll < 0.15:
                        s.g[x, y, z] = s.idx(f'{NS}:bloodroot')
                    elif roll < 0.18:
                        s.g[x, y, z] = s.idx(f'{NS}:pallid_cap')
                    break
    # ---- the shrine with its chest, chests on the islands, candles, cobwebs, a ribcage in the shallows
    def flat_spot(cx, cz, need=3, near=None):
        best = None
        for (x, y, z) in floors:
            if near and math.hypot(x - near[0], z - near[1]) > near[2]:
                continue
            ok = all(0 <= x + dx < W and 0 <= z + dz < W and reg[x + dx, y, z + dz] == AIR_ and reg[x + dx, y - 1, z + dz] == ROCK
                     for dx in range(-need, need + 1) for dz in range(-need, need + 1))
            if ok:
                d = math.hypot(x - cx, z - cz)
                if best is None or d < best[0]:
                    best = (d, x, y, z)
        return best

    def put(x, y, z, b):
        if 0 <= x < W and 0 <= y < H and 0 <= z < W:
            s.g[x, y, z] = s.idx(*b)

    face = lambda x, z: 'north' if abs(z - c) >= abs(x - c) and z > c else 'south' if abs(z - c) >= abs(x - c) else 'west' if x > c else 'east'
    a = rng.uniform(0, 2 * math.pi)
    spot = flat_spot(c + math.cos(a) * 22, c + math.sin(a) * 22, 3)
    if spot:
        _, x0, y0, z0 = spot
        sh = shrine(int(rng.integers(1, 99)))
        for (i, j, k, name, st) in sh.cells():
            if j == 0:
                continue                                                # the foundation row is the floor itself
            put(x0 - 3 + i, y0 + j - 1, z0 - 3 + k, (name, st))
        put(x0, y0 + 1, z0 - 2, ('minecraft:chest', {'minecraft:cardinal_direction': face(x0, z0)}))
        put(x0 + 2, y0, z0 + 3, ('minecraft:web', {}))
    chest_spots = [min(((math.hypot(x - ix, z - iz), x, y, z) for (x, y, z) in floors), default=None) for (ix, iz, ri) in islands]
    a = rng.uniform(0, 2 * math.pi)                                     # and one hidden at the foot of the wall
    chest_spots.append(min(((abs(math.hypot(x - c, z - c) - (R.mean() - 3)) + abs(math.atan2(z - c, x - c) - a), x, y, z)
                            for (x, y, z) in floors), default=None))
    for sp in chest_spots:
        if sp is None:
            continue
        _, x, y, z = sp
        put(x, y, z, ('minecraft:chest', {'minecraft:cardinal_direction': face(x, z)}))
        put(x + 1, y, z, candle(int(rng.integers(2, 5)), red=True))
        if 0 <= z + 1 < W and reg[x - 1, y, z + 1] == AIR_:
            put(x - 1, y, z + 1, candle(int(rng.integers(1, 4))))
    for _ in range(int(rng.integers(5, 9))):                            # candles somebody left on the shores
        x, y, z = floors[int(n3.integers(0, len(floors)))]
        if s.g[x, y, z] == s.idx(*AIR):
            put(x, y, z, candle(int(n3.integers(1, 5)), red=n3.random() < 0.6))
    for (x, y, z) in floors:                                            # a ribcage in the shallows by the shore
        if reg[x, D - 1, z] == WAT and math.hypot(x - c, z - c) > 14:
            continue
    rc = ribcage(int(rng.integers(1, 99)))
    for _try in range(40):
        a = rng.uniform(0, 2 * math.pi)
        x0, z0 = int(c + math.cos(a) * (Rl.mean() - 2)), int(c + math.sin(a) * (Rl.mean() - 2))
        if 2 <= x0 < W - 13 and 2 <= z0 < W - 16 and reg[x0 + 5, D - 1, z0 + 7] == WAT and reg[x0 + 5, D - 3, z0 + 7] != WAT:
            for (i, j, k, name, st) in rc.cells():
                yy = D - 2 + j
                if 0 <= yy < H and reg[x0 + i, yy, z0 + k] in (AIR_, WAT):
                    put(x0 + i, yy, z0 + k, (name, st))
            break
    return s


def pick_w(rng, options):
    total = sum(w for _, w in options)
    r = rng.random() * total
    for b, w in options:
        r -= w
        if r <= 0:
            return b
    return options[-1][0]


def great_halls():
    return {f'great_hall_{v}': great_hall(5000 + 31 * v) for v in range(3)}
