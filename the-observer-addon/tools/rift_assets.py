#!/usr/bin/env python3
"""The Rift's own blocks (1.6.0), all original: drawn, modelled and defined here.

  observer:rift_bark          dead pine wood: grey-black bark split by pale cracks (a log: it turns with the face it sits on)
  observer:rift_needles       what is left of a pine's needles: sparse, dark, dead
  observer:rift_moss          the dead woods' ground: black-green moss over wet soil
  observer:rift_bricks        old masonry seeping red at the joints   (+ observer:rift_bricks_cracked)
  observer:rift_glass         crimson glass in black lead
  observer:rift_lamp          a crimson lamp, glowing
  observer:blood              blood on the ground, four splashes
  observer:corpse             a body wrapped in sacking, one grey hand out of it
  observer:hanged             a body hanged from a branch (two blocks: observer:part 1 the upper, 0 the lower)
  observer:skeleton           a skeleton lying where it fell
  observer:gravestone         a headstone, its name worn off

Writes RP textures/blocks/rift/*.png, RP models/blocks/rift_*.geo.json, BP blocks/rift/*.json, and registers the
textures (terrain_texture.json), sounds (blocks.json) and names (en_US.lang). Safe to re-run.
Usage: python3 tools/rift_assets.py
"""
import json
import math
import os
import random

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
rng = random.Random(1600)


def save(img, name):
    p = os.path.join(RP, "textures", "blocks", "rift", name + ".png")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)
    return p


def noise_img(base, var, w=16, h=16, seed=0):
    r = random.Random(seed)
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            d = r.randint(-var, var)
            px[x, y] = (max(0, min(255, base[0] + d)), max(0, min(255, base[1] + d)), max(0, min(255, base[2] + d)), 255)
    return img, px


# ----------------------------------------------------------------------------- textures
# (1.7.0) Redrawn in the game's own manner: each one a small palette of four or five shades, laid in clusters (not
# single noisy pixels) by noise that wraps round at the edges, so it tiles without a seam; bricks bevelled light at the
# top and dark at the foot, a log's top in rings with its bark round the edge, the lamp in a frame like a lamp's.

def tile_noise(seed, period, x, y):
    """Value noise on a 16 px tile, wrapping (period cells across the tile), smoothly interpolated: 0..1."""
    r = random.Random(seed * 7919 + period)
    grid = [[r.random() for _ in range(period)] for _ in range(period)]
    c = 16 / period
    fx, fy = x / c, y / c
    ix, iy = int(math.floor(fx)), int(math.floor(fy))
    tx, ty = fx - ix, fy - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    g = lambda i, j: grid[j % period][i % period]
    a = g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx
    b = g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx
    return a * (1 - ty) + b * ty


def field(seed, octaves=((4, 0.55), (8, 0.3)), jitter=0.15, sx=1.0, sy=1.0):
    """A 16x16 field of clustered noise, 0..1 (sx, sy stretch it along x or y: bark runs in long vertical streaks)."""
    r = random.Random(seed)
    out = [[0.0] * 16 for _ in range(16)]
    for y in range(16):
        for x in range(16):
            v = sum(w * tile_noise(seed + k, per, (x * sx) % 16, (y * sy) % 16) for k, (per, w) in enumerate(octaves))
            out[y][x] = v / sum(w for _, w in octaves) + r.uniform(-jitter, jitter)
    lo = min(min(row) for row in out)
    hi = max(max(row) for row in out)
    return [[(v - lo) / max(1e-6, hi - lo) for v in row] for row in out]


def shade(pal, v):
    """A palette colour for a value 0..1 (dark to light)."""
    return pal[max(0, min(len(pal) - 1, int(v * len(pal))))]


def paint(pal, f, alpha=255):
    img = Image.new("RGBA", (16, 16))
    px = img.load()
    for y in range(16):
        for x in range(16):
            px[x, y] = (*shade(pal, f[y][x]), alpha)
    return img, px


BARK = [(23, 22, 22), (34, 32, 31), (46, 44, 42), (59, 56, 52), (76, 72, 66)]


def bark():
    # the side: ridges of grey-black bark running up the trunk, split by dark furrows, pale where it has peeled
    r = random.Random(11)
    streak = field(101, octaves=((4, 0.6), (16, 0.4)), jitter=0.08, sy=0.18)
    ridge_at = []
    x = 0
    while x < 16:
        w = r.choice((3, 3, 4, 4, 5))
        ridge_at += [i / max(1, w - 1) for i in range(w)]
        x += w
    img = Image.new("RGBA", (16, 16))
    px = img.load()
    for y in range(16):
        for x in range(16):
            ridge = math.sin(math.pi * ridge_at[x])            # 0 in a furrow, 1 on a ridge's crown
            v = 0.15 + 0.55 * ridge + 0.4 * streak[y][x] - 0.2
            px[x, y] = (*shade(BARK, v), 255)
    for _ in range(5):                                         # bark peeled off: the pale dead wood under it
        x, y = r.randint(0, 15), r.randint(0, 15)
        for k in range(r.randint(2, 4)):
            px[x, (y + k) % 16] = (92, 87, 80, 255)
            if k == 0:
                px[x, (y - 1) % 16] = BARK[1] + (255,)
    save(img, "rift_bark")
    # the top: the rings of a dead tree, a little out of round, the bark all round the edge, a dark heart
    rings = [(74, 68, 60), (98, 91, 81), (120, 112, 100)]
    wob = field(102, octaves=((4, 1.0),), jitter=0.0)
    top = Image.new("RGBA", (16, 16))
    tp = top.load()
    for y in range(16):
        for x in range(16):
            dx, dy = abs(x - 7.5), abs(y - 7.5)
            if max(dx, dy) > 6.6:
                tp[x, y] = (*BARK[1 + (x * 3 + y) % 3], 255)
                continue
            d = 0.6 * max(dx, dy) + 0.4 * math.hypot(dx, dy) + 0.7 * wob[y][x]
            band = int(d / 1.5)
            tp[x, y] = (*(rings[1] if band % 2 else rings[2]), 255)
            if band % 3 == 2 and (x + y) % 3 == 0:
                tp[x, y] = (*rings[0], 255)
    for (x, y) in ((7, 7), (8, 7), (7, 8), (8, 8)):
        tp[x, y] = (*rings[0], 255)
    for k in range(4):                                         # a dry split from the heart outward
        tp[9 + k, 7 - (k // 2)] = (*BARK[1], 255)
    save(top, "rift_bark_top")


def needles():
    # what is left of the needles: clumps of dark, dead green with holes through them, a few gone brown
    pal = [(20, 26, 22), (29, 36, 30), (40, 48, 38), (53, 60, 46)]
    f = field(103, octaves=((8, 0.7), (4, 0.3)), jitter=0.12)
    holes = field(104, octaves=((8, 1.0),), jitter=0.2)
    r = random.Random(3)
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y in range(16):
        for x in range(16):
            if holes[y][x] < 0.38:
                continue
            c = shade(pal, f[y][x])
            if r.random() < 0.06:
                c = (66, 54, 40)
            px[x, y] = (*c, 255)
    save(img, "rift_needles")


MOSS = [(27, 33, 26), (35, 43, 32), (45, 54, 39), (57, 65, 46)]
SOIL = [(37, 30, 25), (47, 38, 31), (57, 46, 37), (68, 56, 45)]


def moss():
    f = field(105, octaves=((8, 0.6), (4, 0.4)), jitter=0.14)
    top, tp = paint(MOSS, f)
    r = random.Random(41)
    for _ in range(4):                                         # pale specks of dead growth, in little clumps
        x, y = r.randint(0, 15), r.randint(0, 15)
        for (dx, dy) in ((0, 0), (1, 0), (0, 1)):
            if r.random() < 0.8:
                tp[(x + dx) % 16, (y + dy) % 16] = (70, 76, 54, 255)
    save(top, "rift_moss_top")
    soil, sp = paint(SOIL, field(106, octaves=((8, 0.6), (4, 0.4)), jitter=0.16))
    for _ in range(6):                                         # pebbles
        x, y = r.randint(0, 15), r.randint(0, 15)
        sp[x, y] = (82, 76, 70, 255)
        sp[(x + 1) % 16, y] = (66, 61, 56, 255)
        sp[x, (y + 1) % 16] = (52, 48, 44, 255)
    save(soil, "rift_soil")
    side = soil.copy()
    sd = side.load()
    depth = field(107, octaves=((8, 1.0),), jitter=0.0)
    for x in range(16):
        d = 2 + int(depth[0][x] * 2.5) + (2 if r.random() < 0.12 else 0)
        for y in range(d):
            sd[x, y] = tp[x, y]
        sd[x, d] = (*SOIL[0], 255)                             # the shadow under the moss's edge
    save(side, "rift_moss_side")


BRICK = [(29, 26, 30), (38, 35, 40), (48, 45, 51), (59, 55, 62), (72, 68, 76)]
MORTAR = (19, 16, 19)


def bricks(cracked):
    # old masonry, in courses four high, every brick a shade of its own, bevelled, seeping red at the joints
    r = random.Random(70 + cracked)
    grain = field(108 + cracked, octaves=((8, 1.0),), jitter=0.2)
    img = Image.new("RGBA", (16, 16))
    px = img.load()
    shades = {}
    for y in range(16):
        for x in range(16):
            row = y // 4
            off = 4 if row % 2 else 0
            bx = (x + off) // 8
            if y % 4 == 3 or (x + off) % 8 == 7:
                px[x, y] = (*MORTAR, 255)
                if r.random() < 0.22:
                    px[x, y] = (94, 12, 18, 255) if r.random() < 0.6 else (66, 9, 13, 255)
                continue
            base = shades.setdefault((row, bx % 2), r.randint(1, 3))
            v = base + (1 if y % 4 == 0 else 0) - (1 if y % 4 == 2 else 0) + (1 if grain[y][x] > 0.8 else -1 if grain[y][x] < 0.15 else 0)
            px[x, y] = (*BRICK[max(0, min(4, v))], 255)
    # red seeping down from a joint here and there
    for _ in range(3):
        x = r.randint(0, 15)
        y = r.choice((4, 8, 12))
        px[x, y] = (88, 12, 18, 255)
        if r.random() < 0.5:
            px[x, (y + 1) % 16] = (66, 10, 14, 255)
    if cracked:
        for start in ((3, 0), (11, 7)):
            x, y = start
            for _ in range(r.randint(7, 10)):
                if px[x % 16, y % 16][:3] != MORTAR:
                    px[x % 16, y % 16] = (15, 13, 15, 255)
                    if px[(x + 1) % 16, y % 16][:3] != MORTAR:
                        px[(x + 1) % 16, y % 16] = (*BRICK[4], 255)
                x += r.choice((-1, 0, 1, 1))
                y += 1
    save(img, "rift_bricks_cracked" if cracked else "rift_bricks")


def glass():
    # crimson glass, like the game's stained glass: a pale rim, clear red in the middle, two streaks of glint
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y in range(16):
        for x in range(16):
            if x in (0, 15) or y in (0, 15):
                px[x, y] = (150, 30, 40, 230)
            else:
                px[x, y] = (112, 12, 22, 120)
    for (x0, y0, n) in ((3, 4, 4), (4, 6, 2), (10, 9, 3)):
        for k in range(n):
            if 0 < x0 + k < 15 and 0 < y0 - k < 15:
                px[x0 + k, y0 - k] = (205, 90, 96, 170)
    save(img, "rift_glass")


def lamp():
    # a crimson lamp, lit: an iron frame with a bolt at each corner, and behind it the light, blotched like a lamp's
    pal = [(96, 10, 16), (150, 18, 26), (198, 34, 40), (236, 70, 62), (255, 130, 112)]
    f = field(109, octaves=((8, 0.6), (4, 0.4)), jitter=0.12)
    img = Image.new("RGBA", (16, 16))
    px = img.load()
    for y in range(16):
        for x in range(16):
            edge = min(x, y, 15 - x, 15 - y)
            if edge == 0:
                px[x, y] = (28, 22, 24, 255)
            elif edge == 1:
                px[x, y] = (54, 44, 46, 255) if (x + y) % 2 else (44, 36, 38, 255)
            else:
                v = f[y][x] * 0.8 + 0.25 * (1 - math.hypot(x - 7.5, y - 7.5) / 7)
                px[x, y] = (*shade(pal, v), 255)
    for (x, y) in ((1, 1), (14, 1), (1, 14), (14, 14)):
        px[x, y] = (96, 86, 86, 255)
    for k in range(2, 14):                                    # the cross bars of its cage
        if px[k, 7][0] < 236:
            px[k, 7] = (60, 30, 32, 255)
        if px[7, k][0] < 236:
            px[7, k] = (60, 30, 32, 255)
    save(img, "rift_lamp")


def blood():
    for v in range(4):
        img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        px = img.load()
        r = random.Random(90 + v)
        cx, cy = 7.5 + r.uniform(-2, 2), 7.5 + r.uniform(-2, 2)
        rad = r.uniform(3.5, 5.5)
        for y in range(16):
            for x in range(16):
                a = math.atan2(y - cy, x - cx)
                edge = rad + 1.6 * math.sin(a * 5 + v) + 0.8 * math.sin(a * 11 + v * 2)
                d = math.hypot(x - cx, y - cy)
                if d < edge:
                    k = d / max(edge, 0.1)
                    c = (122, 8, 14) if k < 0.45 else (100, 7, 12) if k < 0.8 else (74, 5, 9)
                    px[x, y] = (*c, 235)
        hx, hy = int(cx - 1), int(cy - 1)
        px[hx, hy] = (168, 34, 40, 235)                        # wet: a glint
        for _ in range(4 + v):                                 # spatters
            x, y = r.randint(0, 15), r.randint(0, 15)
            px[x, y] = (96, 6, 10, 230)
            if r.random() < 0.4:
                px[(x + 1) % 16, y] = (74, 5, 9, 230)
        save(img, f"blood_{v}")


def cloth():
    # sacking: a coarse weave, dirty, stiff with old blood in two great stains
    pal = [(50, 42, 33), (60, 51, 40), (71, 61, 48), (84, 73, 57)]
    f = field(110, octaves=((8, 0.7), (4, 0.3)), jitter=0.1)
    img = Image.new("RGBA", (16, 16))
    px = img.load()
    stain = field(111, octaves=((4, 1.0),), jitter=0.05)
    for y in range(16):
        for x in range(16):
            weave = 0.18 if (x % 2) ^ (y % 2) else -0.12
            if x % 4 == 0:
                weave -= 0.1
            c = shade(pal, f[y][x] * 0.8 + 0.2 + weave)
            if stain[y][x] > 0.8:
                c = (78, 26, 20) if stain[y][x] < 0.9 else (62, 17, 15)
            px[x, y] = (*c, 255)
    save(img, "corpse_cloth")


def skin():
    # dead skin: grey going green, mottled, bruised dark in places
    pal = [(104, 106, 96), (116, 118, 106), (128, 129, 116), (140, 140, 126)]
    f = field(112, octaves=((8, 0.6), (4, 0.4)), jitter=0.12)
    img, px = paint(pal, f)
    bruise = field(113, octaves=((4, 1.0),), jitter=0.05)
    for y in range(16):
        for x in range(16):
            if bruise[y][x] > 0.8:
                px[x, y] = (88, 80, 92, 255) if bruise[y][x] < 0.9 else (72, 64, 78, 255)
    save(img, "corpse_skin")


BONE = [(160, 153, 135), (178, 171, 151), (194, 188, 167), (209, 203, 184), (223, 218, 201)]


def bone():
    f = field(114, octaves=((8, 0.6), (4, 0.4)), jitter=0.1, sy=0.6)
    img, px = paint(BONE, f)
    r = random.Random(15)
    for _ in range(5):                                         # pits
        x, y = r.randint(0, 15), r.randint(0, 15)
        px[x, y] = (136, 128, 112, 255)
        px[(x + 1) % 16, (y + 1) % 16] = (*BONE[4], 255)
    save(img, "skeleton_bone")
    face, fp = paint(BONE, field(115, octaves=((8, 0.6), (4, 0.4)), jitter=0.1))
    for (x0, y0) in ((4, 6), (10, 6)):                         # the eyes: deep sockets, a lighter brow over them
        for dx in range(2):
            for dy in range(2):
                fp[x0 + dx, y0 + dy] = (20, 17, 16, 255) if dy else (34, 29, 26, 255)
            fp[x0 + dx, y0 - 1] = (*BONE[4], 255)
        fp[x0 - 1, y0] = (*BONE[1], 255)
    for (x, y) in ((7, 10), (8, 10)):
        fp[x, y] = (28, 24, 22, 255)
    for x in range(4, 12):                                     # the teeth
        fp[x, 13] = (40, 34, 30, 255) if x % 2 == 0 else (*BONE[3], 255)
        fp[x, 12] = (*BONE[1], 255)
    save(face, "skull_face")


STONE = [(80, 80, 85), (92, 92, 97), (105, 105, 110), (119, 119, 124)]


def gravestone():
    # a headstone like the game's stone: grey in clusters, a cross cut into it, lichen climbing from the ground
    img, px = paint(STONE, field(116, octaves=((8, 0.6), (4, 0.4)), jitter=0.12))
    cut = [(7, y) for y in range(3, 12)] + [(8, y) for y in range(3, 12)] + [(x, 5) for x in range(5, 11)] + [(x, 6) for x in range(5, 11)]
    for (x, y) in cut:
        px[x, y] = (52, 52, 57, 255)
    for (x, y) in cut:                                         # its edges catch the light below and to the right
        for (dx, dy) in ((1, 0), (0, 1)):
            if (x + dx, y + dy) not in cut:
                px[x + dx, y + dy] = (134, 134, 139, 255)
    lichen = field(117, octaves=((8, 1.0),), jitter=0.15)
    for y in range(16):
        for x in range(16):
            if lichen[y][x] + (y - 8) * 0.06 > 0.85:
                px[x, y] = (66, 80, 58, 255) if lichen[y][x] > 0.6 else (56, 68, 50, 255)
    save(img, "gravestone")


# ----------------------------------------------------------------------------- models (blocks: 16 px = a block)

def cube(origin, size, uv, faces=("north", "south", "east", "west", "up", "down"), inst=None):
    u = {}
    for f in faces:
        e = {"uv": uv[:2], "uv_size": uv[2:]}
        if inst:
            e["material_instance"] = inst.get(f, inst.get("*")) if isinstance(inst, dict) else inst
        u[f] = e
    return {"origin": origin, "size": size, "uv": u}


def geo(ident, cubes, w=16, h=16):
    return {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": ident, "texture_width": w, "texture_height": h, "visible_bounds_width": 3,
                        "visible_bounds_height": 2, "visible_bounds_offset": [0, 0.5, 0]},
        "bones": [{"name": "root", "pivot": [0, 0, 0], "cubes": cubes}]}]}


def models():
    out = {}
    # a corpse: a long bundle of sacking, a head at one end, a grey hand out of it (lies along z, head north)
    out["rift_corpse"] = geo("geometry.observer.rift_corpse", [
        cube([-4, 0, -9], [8, 4, 20], [0, 0, 16, 16], inst="cloth"),
        cube([-2.5, 0.5, -14], [5, 4, 5], [0, 0, 16, 16], inst="skin"),
        cube([4, 0, -3], [2, 1.5, 5], [0, 0, 16, 16], inst="skin"),
        cube([-3, 4, -6], [6, 1, 9], [0, 0, 16, 16], inst="cloth"),
    ])
    # a skeleton where it fell: skull, spine, ribs, pelvis, the long bones
    out["rift_skeleton"] = geo("geometry.observer.rift_skeleton", [
        cube([-2.5, 0, -13], [5, 4, 4], [0, 0, 16, 16], inst={"north": "skull", "*": "bone"}),
        cube([-0.5, 0, -9], [1, 1, 10], [0, 0, 16, 16], inst="bone"),
        cube([-3.5, 0.5, -8], [7, 1, 1], [0, 0, 16, 16], inst="bone"),
        cube([-3.5, 0.5, -6], [7, 1, 1], [0, 0, 16, 16], inst="bone"),
        cube([-3.5, 0.5, -4], [7, 1, 1], [0, 0, 16, 16], inst="bone"),
        cube([-3, 0, 1], [6, 2, 3], [0, 0, 16, 16], inst="bone"),
        cube([-2.5, 0, 4], [1, 1, 10], [0, 0, 16, 16], inst="bone"),
        cube([1.5, 0, 4], [1, 1, 9], [0, 0, 16, 16], inst="bone"),
        cube([-6, 0, -8], [1, 1, 8], [0, 0, 16, 16], inst="bone"),
        cube([5, 0, -7], [1, 1, 7], [0, 0, 16, 16], inst="bone"),
    ])
    # a headstone, sunk a little, leaning a touch (no rotation: a step at its top)
    out["rift_gravestone"] = geo("geometry.observer.rift_gravestone", [
        cube([-5, 0, -1.5], [10, 11, 3], [0, 0, 16, 16]),
        cube([-4, 11, -1.5], [8, 2, 3], [0, 0, 16, 16]),
        cube([-2.5, 13, -1.5], [5, 1, 3], [0, 0, 16, 16]),
        cube([-6, 0, -3], [12, 1, 6], [0, 0, 16, 16]),
    ])
    # a body hanged from a branch, in two blocks: the upper (the rope, the head bowed, the shoulders) and the lower
    out["rift_hanged_upper"] = geo("geometry.observer.rift_hanged_upper", [
        cube([-0.5, 10, -0.5], [1, 6, 1], [0, 0, 16, 16], inst="rope"),
        cube([-3, 9, -3], [6, 1, 6], [0, 0, 16, 16], inst="rope"),
        cube([-2.5, 3.5, -2], [5, 5.5, 5], [0, 0, 16, 16], inst="skin"),
        cube([-4.5, 0, -2.5], [9, 3.5, 5], [0, 0, 16, 16], inst="cloth"),
    ])
    out["rift_hanged_lower"] = geo("geometry.observer.rift_hanged_lower", [
        cube([-4, 4, -2.5], [8, 12, 5], [0, 0, 16, 16], inst="cloth"),
        cube([-3, 0, -1.5], [2, 4, 3], [0, 0, 16, 16], inst="skin"),
        cube([1, 1, -1.5], [2, 3, 3], [0, 0, 16, 16], inst="skin"),
        cube([4, 6, -1], [1.5, 9, 2], [0, 0, 16, 16], inst="skin"),
    ])
    # blood: a skin of it on the ground
    out["rift_decal"] = geo("geometry.observer.rift_decal", [cube([-8, 0, -8], [16, 0.1, 16], [0, 0, 16, 16], faces=("up",))])
    for k, v in out.items():
        p = os.path.join(RP, "models", "blocks", f"{k}.geo.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(v, f, indent=1)


# ----------------------------------------------------------------------------- block definitions

def block(ident, components, extra=None, category="construction"):
    d = {"format_version": "1.26.0", "minecraft:block": {"description": {"identifier": ident, "menu_category": {"category": category}},
                                                          "components": components}}
    if extra:
        d["minecraft:block"]["description"].update(extra.get("description", {}))
        if "permutations" in extra:
            d["minecraft:block"]["permutations"] = extra["permutations"]
    return d


def solid(tex, seconds, resist, color, inst=None, light=None):
    c = {"minecraft:geometry": "minecraft:geometry.full_block",
         "minecraft:material_instances": inst or {"*": {"texture": tex, "render_method": "opaque"}},
         "minecraft:destructible_by_mining": {"seconds_to_destroy": seconds},
         "minecraft:destructible_by_explosion": {"explosion_resistance": resist},
         "minecraft:map_color": color}
    if light:
        c["minecraft:light_emission"] = light
    return c


CARDINAL = {"description": {"traits": {"minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"], "y_rotation_offset": 180}}},
            "permutations": [{"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}'",
                              "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}}
                             for d, r in (("north", 0), ("west", 90), ("south", 180), ("east", -90))]}


def blocks():
    defs = {}
    defs["rift_bark"] = block("observer:rift_bark", solid(None, 2.6, 3, "#2a2827", inst={
        "*": {"texture": "observer_rift_bark", "render_method": "opaque"},
        "up": {"texture": "observer_rift_bark_top", "render_method": "opaque"},
        "down": {"texture": "observer_rift_bark_top", "render_method": "opaque"}}), extra={
        "description": {"traits": {"minecraft:placement_position": {"enabled_states": ["minecraft:block_face"]}}},
        "permutations": [
            {"condition": "q.block_state('minecraft:block_face') == 'east' || q.block_state('minecraft:block_face') == 'west'",
             "components": {"minecraft:transformation": {"rotation": [0, 0, 90]}}},
            {"condition": "q.block_state('minecraft:block_face') == 'north' || q.block_state('minecraft:block_face') == 'south'",
             "components": {"minecraft:transformation": {"rotation": [90, 0, 0]}}}]}, category="nature")
    defs["rift_bark"]["minecraft:block"]["components"]["minecraft:flammable"] = {"catch_chance_modifier": 5, "destroy_chance_modifier": 5}
    defs["rift_needles"] = block("observer:rift_needles", {
        "minecraft:geometry": "minecraft:geometry.full_block",
        "minecraft:material_instances": {"*": {"texture": "observer_rift_needles", "render_method": "alpha_test"}},
        "minecraft:light_dampening": 1, "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.3},
        "minecraft:destructible_by_explosion": {"explosion_resistance": 0.2}, "minecraft:map_color": "#1e221e",
        "minecraft:flammable": {"catch_chance_modifier": 30, "destroy_chance_modifier": 60},
        "minecraft:loot": "loot_tables/rift/nothing.json"}, category="nature")
    defs["rift_moss"] = block("observer:rift_moss", solid(None, 0.7, 0.6, "#222820", inst={
        "*": {"texture": "observer_rift_moss_side", "render_method": "opaque"},
        "up": {"texture": "observer_rift_moss_top", "render_method": "opaque"},
        "down": {"texture": "observer_rift_soil", "render_method": "opaque"}}), category="nature")
    defs["rift_bricks"] = block("observer:rift_bricks", solid("observer_rift_bricks", 4.0, 12, "#333234"))
    defs["rift_bricks_cracked"] = block("observer:rift_bricks_cracked", solid("observer_rift_bricks_cracked", 4.0, 12, "#2e2d2f"))
    defs["rift_glass"] = block("observer:rift_glass", {
        "minecraft:geometry": "minecraft:geometry.full_block",
        "minecraft:material_instances": {"*": {"texture": "observer_rift_glass", "render_method": "blend"}},
        "minecraft:light_dampening": 0, "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.5},
        "minecraft:destructible_by_explosion": {"explosion_resistance": 0.3}, "minecraft:map_color": "#5a0a10",
        "minecraft:loot": "loot_tables/rift/nothing.json"})
    defs["rift_lamp"] = block("observer:rift_lamp", solid("observer_rift_lamp", 0.5, 0.3, "#a0141c", light=12))
    blood_perms = [{"condition": f"q.block_state('observer:splash') == {v}",
                    "components": {"minecraft:material_instances": {"*": {"texture": f"observer_blood_{v}", "render_method": "alpha_test"}}}}
                   for v in range(1, 4)]
    defs["blood"] = block("observer:blood", {
        "minecraft:geometry": "geometry.observer.rift_decal",
        "minecraft:material_instances": {"*": {"texture": "observer_blood_0", "render_method": "alpha_test"}},
        "minecraft:collision_box": False, "minecraft:selection_box": {"origin": [-8, 0, -8], "size": [16, 0.5, 16]},
        "minecraft:light_dampening": 0, "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.0},
        "minecraft:destructible_by_explosion": {"explosion_resistance": 0.0}, "minecraft:map_color": "#5a0a10",
        "minecraft:loot": "loot_tables/rift/nothing.json"},
        extra={"description": {"states": {"observer:splash": [0, 1, 2, 3]}}, "permutations": blood_perms}, category="nature")
    figure = lambda geom, inst, sel: {
        "minecraft:geometry": geom, "minecraft:material_instances": inst,
        "minecraft:collision_box": False, "minecraft:selection_box": sel, "minecraft:light_dampening": 0,
        "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.4}, "minecraft:destructible_by_explosion": {"explosion_resistance": 0.2},
        "minecraft:map_color": "#3a3028", "minecraft:loot": "loot_tables/rift/bones.json"}
    defs["corpse"] = block("observer:corpse", figure("geometry.observer.rift_corpse", {
        "*": {"texture": "observer_corpse_cloth", "render_method": "opaque"},
        "cloth": {"texture": "observer_corpse_cloth", "render_method": "opaque"},
        "skin": {"texture": "observer_corpse_skin", "render_method": "opaque"}},
        {"origin": [-6, 0, -8], "size": [12, 6, 16]}), extra=CARDINAL, category="nature")
    defs["skeleton"] = block("observer:skeleton", figure("geometry.observer.rift_skeleton", {
        "*": {"texture": "observer_skeleton_bone", "render_method": "opaque"},
        "bone": {"texture": "observer_skeleton_bone", "render_method": "opaque"},
        "skull": {"texture": "observer_skull_face", "render_method": "opaque"}},
        {"origin": [-6, 0, -8], "size": [12, 4, 16]}), extra=CARDINAL, category="nature")
    hanged = figure("geometry.observer.rift_hanged_lower", {
        "*": {"texture": "observer_corpse_cloth", "render_method": "opaque"},
        "cloth": {"texture": "observer_corpse_cloth", "render_method": "opaque"},
        "rope": {"texture": "observer_rift_bark", "render_method": "opaque"},
        "skin": {"texture": "observer_corpse_skin", "render_method": "opaque"}},
        {"origin": [-5, 0, -3], "size": [10, 16, 6]})
    hx = {"description": {"states": {"observer:part": [0, 1]}, **CARDINAL["description"]},
          "permutations": [{"condition": "q.block_state('observer:part') == 1",
                            "components": {"minecraft:geometry": "geometry.observer.rift_hanged_upper"}}] + CARDINAL["permutations"]}
    defs["hanged"] = block("observer:hanged", hanged, extra=hx, category="nature")
    gs = figure("geometry.observer.rift_gravestone", {"*": {"texture": "observer_gravestone", "render_method": "opaque"}},
                {"origin": [-6, 0, -3], "size": [12, 14, 6]})
    gs["minecraft:collision_box"] = {"origin": [-5, 0, -1.5], "size": [10, 14, 3]}
    gs["minecraft:loot"] = "loot_tables/rift/nothing.json"
    defs["gravestone"] = block("observer:gravestone", gs, extra=CARDINAL)
    for k, v in defs.items():
        p = os.path.join(BP, "blocks", "rift", f"{k}.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(v, f, indent=2)
            f.write("\n")
    # loot for what they drop: bones from the dead, nothing from blood, glass and needles
    lt = os.path.join(BP, "loot_tables", "rift")
    os.makedirs(lt, exist_ok=True)
    with open(os.path.join(lt, "nothing.json"), "w") as f:
        json.dump({"pools": []}, f, indent=2)
    with open(os.path.join(lt, "bones.json"), "w") as f:
        json.dump({"pools": [{"rolls": 1, "entries": [{"type": "item", "name": "minecraft:bone", "weight": 1,
                                                      "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}}]}]}]}, f, indent=2)
    return defs


TEX = ["rift_bark", "rift_bark_top", "rift_needles", "rift_moss_top", "rift_moss_side", "rift_soil", "rift_bricks", "rift_bricks_cracked",
       "rift_glass", "rift_lamp", "blood_0", "blood_1", "blood_2", "blood_3", "corpse_cloth", "corpse_skin", "skeleton_bone", "skull_face", "gravestone"]
SOUNDS = {"rift_bark": "wood", "rift_needles": "grass", "rift_moss": "grass", "rift_bricks": "stone", "rift_bricks_cracked": "stone",
          "rift_glass": "glass", "rift_lamp": "glass", "blood": "slime", "corpse": "cloth", "hanged": "cloth", "skeleton": "bone_block", "gravestone": "stone"}
NAMES = {"rift_bark": "Rift Bark", "rift_needles": "Dead Needles", "rift_moss": "Rift Moss", "rift_bricks": "Rift Bricks",
         "rift_bricks_cracked": "Cracked Rift Bricks", "rift_glass": "Crimson Glass", "rift_lamp": "Crimson Lamp", "blood": "Blood",
         "corpse": "Corpse", "hanged": "Hanged Body", "skeleton": "Skeleton", "gravestone": "Gravestone"}


def register():
    p = os.path.join(RP, "textures", "terrain_texture.json")
    tt = json.load(open(p))
    for t in TEX:
        tt["texture_data"][f"observer_{t}"] = {"textures": f"textures/blocks/rift/{t}"}
    with open(p, "w") as f:
        json.dump(tt, f, indent=2)
        f.write("\n")
    p = os.path.join(RP, "blocks.json")
    bj = json.load(open(p))
    for k, s in SOUNDS.items():
        bj[f"observer:{k}"] = {"sound": s}
    with open(p, "w") as f:
        json.dump(bj, f, indent=2)
        f.write("\n")
    p = os.path.join(RP, "texts", "en_US.lang")
    text = open(p, encoding="utf-8").read()
    text = "\n".join(l for l in text.split("\n") if not any(l.startswith(f"tile.observer:{k}.name=") for k in NAMES))
    marker = "## ---- merged: "
    block_lines = "".join(f"tile.observer:{k}.name={v}\n" for k, v in NAMES.items())
    i = text.find(marker)
    text = (text[:i].rstrip("\n") + "\n" + block_lines + "\n" + text[i:]) if i >= 0 else text.rstrip("\n") + "\n" + block_lines
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


def main():
    bark()
    needles()
    moss()
    bricks(0)
    bricks(1)
    glass()
    lamp()
    blood()
    cloth()
    skin()
    bone()
    gravestone()
    models()
    blocks()
    register()
    print("rift assets written")


if __name__ == "__main__":
    main()
