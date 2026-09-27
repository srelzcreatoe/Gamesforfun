"""Block-built brainrots, batch og_d: the rarest originals from Steal a Brainrot.

Espresso Signora, Gattatino Neonino, Graipuss Medussi, Chicleteira
Bicicleteira, Nuclearo Dinossauro, Dragon Cannelloni, Strawberry Elephant,
La Grande Combinasion and Los Tralaleritos.
"""

import math
import random

import numpy as np

from blocky import design, shade

BLACK = "#16161a"
WHITE = "#ffffff"


# -- helpers -------------------------------------------------------------------


def exposed(m):
    """Six masks: filled voxels whose -x, +x, -y, +y, -z, +z neighbour is empty."""
    f = m.grid > 0
    p = np.pad(f, 1)
    return (
        f & ~p[:-2, 1:-1, 1:-1],
        f & ~p[2:, 1:-1, 1:-1],
        f & ~p[1:-1, :-2, 1:-1],
        f & ~p[1:-1, 2:, 1:-1],
        f & ~p[1:-1, 1:-1, :-2],
        f & ~p[1:-1, 1:-1, 2:],
    )


def edge_mask(m, region):
    """Filled voxels in `region` that sit on an edge: open on two different axes."""
    nx, px, ny, py, nz, pz = exposed(m)
    count = (nx | px).astype(int) + (ny | py).astype(int) + (nz | pz).astype(int)
    return region & (count >= 2)


def absorb_orphans(m, limit=40):
    """Hands tiny loose bits of a piece to the piece they touch, so nothing
    is left hanging when the pieces move."""
    from scipy import ndimage

    filled = m.grid > 0
    for part in range(len(m.limbs) + 1):
        piece = filled & (m.part == part)
        labels, count = ndimage.label(piece)
        if count < 2:
            continue
        sizes = ndimage.sum(piece, labels, range(1, count + 1))
        main = int(np.argmax(sizes)) + 1
        for c in range(1, count + 1):
            if c == main or sizes[c - 1] > limit:
                continue
            bit = labels == c
            touching = m.part[neighbours(bit) & filled & (m.part != part)]
            if len(touching):
                m.part[bit] = int(np.bincount(touching).argmax())


def neighbours(mask):
    """Voxels next to a mask (6-connected), not including the mask."""
    p = np.pad(mask, 1)
    grown = (p[:-2, 1:-1, 1:-1] | p[2:, 1:-1, 1:-1] | p[1:-1, :-2, 1:-1] | p[1:-1, 2:, 1:-1]
             | p[1:-1, 1:-1, :-2] | p[1:-1, 1:-1, 2:])
    return grown & ~mask


def neon(m, region, colour, glow):
    """Paints the edges of a region as a neon tube with a dim glow beside it."""
    edges = edge_mask(m, region)
    surface = np.logical_or.reduce(exposed(m))
    m.paint(neighbours(edges) & region & surface, glow)
    m.paint(edges, colour)
    return edges


def polyline(m, points, radius, radius_end=None, full=False):
    """A tube along a polyline. Returns (mask, s) where s is the arc length
    along the line of the closest point, for stripes and ridges; with
    full=True also the distance to the line and the tube radius there."""
    xs, ys, zs = m._centres
    p = np.stack([xs, ys, zs], axis=-1)
    best = np.full(xs.shape, np.inf)
    best_s = np.zeros(xs.shape)
    best_r = np.zeros(xs.shape)
    total = sum(np.linalg.norm(np.subtract(b, a)) for a, b in zip(points, points[1:]))
    radius_end = radius if radius_end is None else radius_end
    s0 = 0.0
    for a, b in zip(points, points[1:]):
        a, b = np.array(a, float), np.array(b, float)
        ab = b - a
        length = float(np.linalg.norm(ab))
        t = np.clip(((p - a) @ ab) / max(1e-9, ab @ ab), 0, 1)
        d = np.linalg.norm(p - (a + t[..., None] * ab), axis=-1)
        s = s0 + t * length
        r = radius + (radius_end - radius) * (s / total)
        closer = d - r < best - best_r
        best = np.where(closer, d, best)
        best_s = np.where(closer, s, best_s)
        best_r = np.where(closer, r, best_r)
        s0 += length
    if full:
        return best <= best_r, best_s, best, best_r
    return best <= best_r, best_s


# The radiation trefoil, 13 x 13: y = yellow disc, k = black.
RADIATION = [
    "....yyyyy....",
    "..yyyyyyyyy..",
    ".yykyyyyykyy.",
    ".ykkkyyykkky.",
    "ykkkkyyykkkky",
    "ykkkkykykkkky",
    "yyyyykkkyyyyy",
    "yyyyyykyyyyyy",
    "yyyyyyyyyyyyy",
    ".yyyykkkyyyy.",
    ".yyykkkkkyyy.",
    "..yykkkkkyy..",
    "....yyyyy....",
]


def rounded_box_mask(m, x0, y0, z0, x1, y1, z1, vertical_only=False):
    """A box with its edges shaved off by one voxel (all 12 edges, or only
    the four upright ones)."""
    mask = m.box_mask(x0, y0, z0, x1, y1, z1)
    xs, ys, zs = m._centres
    ex = (xs < x0 + 1) | (xs > x1)
    ey = (ys < y0 + 1) | (ys > y1)
    ez = (zs < z0 + 1) | (zs > z1)
    if vertical_only:
        return mask & ~(ex & ez)
    return mask & ~((ex & ez) | (ex & ey) | (ey & ez))


# -- Espresso Signora ------------------------------------------------------------


@design("EspressoSignora", width=32, height=48, depth=28)
def espresso_signora(m):
    cx, cz = 16, 14
    porcelain, porcelain_shade, porcelain_dark = "#fbf8f2", "#e6e0d6", "#cbc2b5"
    gold = "#eebd2e"
    coffee = "#3b1d0c"
    crema, crema_light, crema_dark = "#c98a45", "#e8b374", "#9b5a26"
    skin, skin_shade = "#f7cba6", "#e2a985"
    hair, hair_light, hair_dark = "#6d3a1c", "#8e5129", "#4a230e"
    lips, lips_light = "#e0182d", "#ff5a67"
    heel, heel_dark = "#d3122c", "#8e0a1c"
    pearl, pearl_shade = "#fffdf5", "#ddd5c2"
    blush = "#f79a9a"

    # Long thin legs on red stiletto heels.
    for side, x0 in ((0, 12), (1, 18)):
        leg = m.limb("Leg", pivot=(x0 + 1, 13, 14), phase=side)
        x1 = x0 + 1
        m.box(x0, 4, 13, x1, 13, 14, skin, part=leg)
        m.box(x0, 4, 13, x1, 4, 14, skin_shade, part=leg)
        m.box(x0, 0, 9, x1, 1, 11, heel, part=leg)          # pointed toe
        m.box(x0, 0, 9, x1, 0, 9, heel_dark, part=leg)
        m.box(x0, 2, 11, x1, 2, 12, heel, part=leg)         # arch
        m.box(x0, 3, 12, x1, 3, 15, heel, part=leg)         # heel cup
        m.box(x0, 0, 15, x1, 2, 15, heel_dark, part=leg)    # stiletto

    # The saucer is her skirt: a porcelain plate with a raised gold rim.
    m.cylinder(cx, 13, cz, 6.6, 0.99, porcelain_dark)
    m.cylinder(cx, 14, cz, 11.4, 0.99, porcelain_shade)
    m.cylinder(cx, 15, cz, 13.4, 0.99, porcelain)
    rim = m.cylinder_mask(cx, 16, cz, 13.5, 0.99) & ~m.cylinder_mask(cx, 16, cz, 12.0, 0.99)
    m.mask(rim, gold)
    m.paint(m.cylinder_mask(cx, 15, cz, 10.6, 0.99) & ~m.cylinder_mask(cx, 15, cz, 9.7, 0.99), gold)

    # The espresso cup body, gently flaring, with gold bands.
    for y in range(16, 29):
        r = {16: 6.8, 17: 8.0}.get(y, 8.6 + (y - 18) * 0.1)
        m.cylinder(cx, y, cz, r, 0.99, porcelain)
    m.paint(m.cylinder_mask(cx, 16, cz, 9, 1.99), porcelain_shade)
    m.paint(m.cylinder_mask(cx, 26, cz, 12, 0.99), gold)
    m.paint(m.cylinder_mask(cx, 18, cz, 12, 0.99), gold)
    # Hollow top filled with espresso and golden crema.
    m.clear(m.cylinder_mask(cx, 28, cz, 8.3, 0.99))
    top = m.cylinder_mask(cx, 27, cz, 8.3, 0.99)
    m.paint(top, coffee)
    m.paint(top & m.cylinder_mask(cx, 27, cz, 7.2, 0.99), crema)
    rng = random.Random(7)
    for _ in range(22):
        a, d = rng.uniform(0, 2 * math.pi), rng.uniform(2.8, 6.8)
        x, z = int(cx + d * math.cos(a)), int(cz + d * math.sin(a))
        m.paint(m.box_mask(x, 27, z, x, 27, z) & m.cylinder_mask(cx, 27, cz, 7.2, 0.99), rng.choice((crema_light, crema_dark)))
    m.paint(m.cylinder_mask(cx, 27, cz, 3.4, 0.99), crema_light)
    # A coffee bean emblem on the front of the cup, a gold heart on the back.
    m.pixels(14, 20, [".bb.", "bbdb", "bdbb", "bdbb", ".bb."], {"b": "#6b3a1a", "d": "#2e1608"})
    m.pixels(13, 20, [".gg.gg.", "ggggggg", ".ggggg.", "..ggg..", "...g..."], {"g": gold}, face="back")

    # The handle on her right hip.
    loop = m.ellipsoid_mask(27.3, 22.0, cz, 3.6, 4.2, 1.6) & ~m.ellipsoid_mask(27.6, 22.0, cz, 1.5, 2.1, 9)
    loop &= m.box_mask(24, 0, 0, 31, 46, 27)
    m.mask(loop, porcelain)
    m.paint(loop & m.box_mask(24, 0, 0, 31, 19, 27), porcelain_shade)

    # Thin arms from the rim with gold bangles and red nails.
    for side, x0 in ((0, 6), (1, 24)):
        arm = m.limb("Arm", pivot=(x0 + 1, 27.5, 9), phase=side)
        m.box(x0, 19, 8, x0 + 1, 27, 9, skin, part=arm)
        m.box(x0, 21, 8, x0 + 1, 21, 9, gold, part=arm)
        m.box(x0, 18, 8, x0 + 1, 18, 9, lips, part=arm)
        m.box(x0, 27, 8, x0 + 1, 27, 9, skin_shade, part=arm)

    # Neck rising from the crema, with a pearl necklace.
    m.cylinder(cx, 27, cz, 1.9, 4.99, skin)
    ring = m.cylinder_mask(cx, 29, cz, 3.3, 0.99) & ~m.cylinder_mask(cx, 29, cz, 1.9, 0.99)
    m.mask(ring, pearl)
    xs, ys, zs = m._centres
    m.paint(ring & (((xs + zs).astype(int) % 2) == 0), pearl_shade)
    m.box(15, 28, 10, 16, 28, 10, pearl)

    # Her head: a peachy face under a glossy brown updo with a big bun.
    head = m.limb("Head", pivot=(cx, 31, cz))
    m.mask(rounded_box_mask(m, 10, 31, 8, 21, 40, 16, vertical_only=True), skin, part=head)
    m.box(11, 31, 8, 20, 31, 15, skin_shade, part=head)
    hairdo = m.ellipsoid_mask(15.5, 37.5, 14.2, 7.0, 7.2, 6.3) & m.box_mask(0, 33, 0, 31, 47, 27)
    m.mask(hairdo & ~m.box_mask(10, 31, 0, 21, 40, 10), hair, part=head)
    m.box(9, 33, 9, 9, 40, 11, hair, part=head)
    m.box(22, 33, 9, 22, 40, 11, hair, part=head)
    m.box(9, 33, 9, 9, 33, 9, hair_dark, part=head)
    m.box(22, 33, 9, 22, 33, 9, hair_dark, part=head)
    # A fringe swept to one side.
    m.box(10, 40, 7, 21, 41, 8, hair, part=head)
    m.box(11, 42, 8, 20, 42, 9, hair, part=head)
    m.box(10, 39, 7, 14, 39, 8, hair, part=head)
    m.box(10, 38, 7, 11, 38, 8, hair, part=head)
    m.box(21, 39, 8, 21, 39, 8, hair, part=head)
    m.paint_face(m.box_mask(14, 40, 0, 20, 41, 27), hair_light, face="front")
    m.paint_face(m.box_mask(15, 41, 0, 18, 41, 27), "#b06a3a", face="front")
    m.paint_face(m.box_mask(10, 38, 0, 12, 39, 27), hair_dark, face="front")
    m.paint_face(m.ellipsoid_mask(14, 44, 12, 3, 1.5, 3), hair_light, face="top")
    m.paint_face(m.ellipsoid_mask(15, 41, 17, 3, 3, 3), hair_light, face="back")
    # The bun on top, tied with a red ribbon and a gold pin.
    m.sphere(16, 45.2, 14.8, 3.2, hair_light, part=head)
    m.paint(m.ellipsoid_mask(15, 46.8, 13, 1.5, 1.1, 1.6), "#b06a3a")
    m.paint(m.ellipsoid_mask(17, 44.5, 17.8, 1.5, 1.5, 1.2), hair)
    ribbon = m.cylinder_mask(16, 43, 14.8, 3.4, 0.99) & ~m.cylinder_mask(16, 43, 14.8, 1.5, 0.99)
    m.mask(ribbon, lips, part=head)
    m.box(12, 43, 13, 12, 44, 16, lips, part=head)
    m.box(19, 43, 13, 19, 44, 16, lips, part=head)
    # Pearl earrings.
    m.box(9, 31, 12, 9, 32, 12, pearl, part=head)
    m.box(22, 31, 12, 22, 32, 12, pearl, part=head)
    # Face: big glossy eyes with flicked lashes, blush, lipstick, a beauty mark.
    face = {"k": BLACK, "h": WHITE, "p": blush, "r": lips, "l": lips_light, "d": heel_dark, "m": "#5a2c14"}
    m.pixels(10, 34, [
        "............",
        ".khk....hkk.",
        "..kk....kk..",
        "..kk....kk..",
        "pp........pp",
    ], face, part=head)
    m.pixels(14, 32, ["rrlr", ".dd."], face, part=head)
    m.pixels(18, 33, ["m"], face, part=head)


# -- Gattatino Neonino -----------------------------------------------------------


@design("GattatinoNeonino", width=26, height=37, depth=40)
def gattatino_neonino(m):
    dark, dark_top = "#1d1033", "#2b1a4a"
    pink, pink_core, pink_glow = "#ff2d9b", "#ffc2e4", "#6e1a55"
    cyan, cyan_core, cyan_glow = "#18f2ff", "#c8fdff", "#105466"
    yellow, yellow_hot, yellow_glow = "#ffe81a", "#fffbb0", "#8a6d00"

    # Four chunky legs; diagonal pairs step together.
    legs = []
    for x0, z0, phase in ((6, 13, 0), (16, 13, 1), (6, 28, 1), (16, 28, 0)):
        leg = m.limb("Leg", pivot=(x0 + 2, 10, z0 + 2), phase=phase)
        legs.append((leg, x0, z0))
        m.box(x0, 0, z0, x0 + 3, 10, z0 + 3, dark, part=leg)

    # The body: a dark neon-sign box.
    m.box(6, 10, 12, 19, 20, 33, dark)
    m.paint_face(m.box_mask(6, 10, 12, 19, 20, 33), dark_top, face="top")

    # Tail: a curling neon tube, pink with cyan bands.
    tail = m.limb("Tail", pivot=(13, 18, 33.5))
    tube, s = polyline(m, [(13, 17.5, 33), (13, 20.5, 36.3), (13, 26, 37.2), (13, 31, 36.2), (13, 34, 37.2), (13, 33.5, 39.5)], 1.8, 1.3)
    tube &= m.box_mask(0, 0, 34, 25, 36, 39)
    m.mask(tube & ((s // 4) % 2 == 0), pink, part=tail)
    m.mask(tube & ((s // 4) % 2 == 1), cyan, part=tail)

    # The head, with pointy ears.
    head = m.limb("Head", pivot=(13, 18, 13))
    m.box(4, 16, 3, 21, 30, 14, dark, part=head)
    for k in range(5):
        m.box(4, 31 + k, 7, 9 - k, 31 + k, 10, dark, part=head)
        m.box(16 + k, 31 + k, 7, 21, 31 + k, 10, dark, part=head)
    m.box(11, 14, 6, 14, 15, 9, dark, part=head)             # chin for the bell

    # Neon outlines on every edge: pink on the head, cyan on the body and legs.
    head_region = m.part == head
    body_region = m.part == 0
    neon(m, head_region, pink, pink_glow)
    neon(m, body_region & ~m.box_mask(0, 0, 34, 25, 36, 39), cyan, cyan_glow)
    for leg, x0, z0 in legs:
        region = m.part == leg
        m.paint(edge_mask(m, region), pink)
        # Glowing paws with toe lines.
        m.paint(region & m.box_mask(x0, 0, z0, x0 + 3, 1, z0 + 3), cyan)
        m.paint_face(m.box_mask(x0, 0, 0, x0 + 3, 1, 39), cyan_core, face="front")
        m.pixels(x0, 0, [".k.k"[::1]], {"k": dark})
    # Inner ears in cyan.
    for k in range(4):
        m.paint_face(m.box_mask(5, 31 + k, 0, 8 - k, 31 + k, 39), cyan, face="front")
        m.paint_face(m.box_mask(17 + k, 31 + k, 0, 20, 31 + k, 39), cyan, face="front")

    # Face: glowing yellow eyes with slit pupils, a pink nose and a cyan mouth.
    face = {"y": yellow, "h": yellow_hot, "k": "#0a0612", "p": pink, "c": cyan, "o": yellow_glow, "q": pink_core}
    eye = [
        ".yyy.",
        "hykyy",
        "yykyy",
        "yykyy",
        ".yyy.",
    ]
    m.pixels(6, 22, eye, face)
    m.pixels(15, 22, eye, face)
    m.pixels(10, 17, [
        "qppppq",
        ".pppp.",
        "..cc..",
        "c.cc.c",
        ".c..c.",
    ], face)
    # Neon whiskers.
    for y in (18, 20):
        m.box(0, y, 3, 3, y, 3, cyan, part=head)
        m.box(22, y, 3, 25, y, 3, cyan, part=head)
    # A glowing bell on the collar.
    m.box(11, 14, 5, 14, 15, 5, yellow, part=head)
    m.box(12, 13, 5, 13, 13, 6, yellow, part=head)
    m.box(12, 14, 4, 13, 14, 4, yellow_hot, part=head)

    # Flanks: a neon heart and tabby stripes.
    heart = [
        ".pp.pp.",
        "pqqpqqp",
        "pqqqqqp",
        ".pqqqp.",
        "..pqp..",
        "...p...",
    ]
    m.pixels(22, 12, heart, {"p": pink, "q": pink_glow}, face="left")
    m.pixels(22, 12, heart, {"p": pink, "q": pink_glow}, face="right")
    for z in (16, 18, 30):
        m.paint_face(m.box_mask(0, 15, z, 25, 19, z), cyan, face="left")
        m.paint_face(m.box_mask(0, 15, z, 25, 19, z), cyan, face="right")
    for z in (17, 21, 25, 29):
        m.paint_face(m.box_mask(9, 20, z, 16, 20, z), pink, face="top")


# -- Graipuss Medussi ------------------------------------------------------------


@design("GraipussMedussi", width=32, height=42, depth=30)
def graipuss_medussi(m):
    cx, cy, cz = 16, 21, 15
    grape_shades = ("#4b1382", "#7422a8", "#a040c8")
    grape_deep, grape_light = "#2c0a48", "#e2b8ff"
    jelly, jelly_dark, jelly_light = "#e0a6f7", "#bb7ee6", "#f7ddff"
    frill, frill_dark = "#f38fd8", "#cc5db3"
    stem, stem_dark = "#6f8f2c", "#4b6419"
    leaf, leaf_dark, leaf_light = "#4caf3a", "#2e7d22", "#7fd35e"
    rx, ry, rz = 12.0, 12.2, 11.0

    # The bell: a dome packed with round grapes in three shades.
    clip = m.box_mask(0, cy, 0, 31, 41, 29)
    m.mask(m.ellipsoid_mask(cx, cy, cz, rx - 1.2, ry - 1.2, rz - 1.2) & clip, grape_deep)
    rng = random.Random(5)
    grapes = []
    for elevation, count, offset in ((7, 10, 0.0), (35, 9, 0.5), (61, 5, 0.1), (90, 1, 0)):
        phi = math.radians(elevation)
        for n in range(count):
            theta = 2 * math.pi * (n + offset) / count
            ux, uy, uz = math.cos(phi) * math.sin(theta), math.sin(phi), -math.cos(phi) * math.cos(theta)
            grapes.append((cx + ux * (rx - 1.5), cy + uy * (ry - 1.5), cz + uz * (rz - 1.5)))
    xs, ys, zs = m._centres
    radius = 3.4
    dist = np.stack([np.sqrt((xs - gx) ** 2 + (ys - gy) ** 2 + (zs - gz) ** 2) for gx, gy, gz in grapes])
    order = np.argsort(dist, axis=0)
    nearest = np.take_along_axis(dist, order[:1], 0)[0]
    second = np.take_along_axis(dist, order[1:2], 0)[0]
    owner = order[0]
    bunch = (nearest <= radius) & clip
    m.mask(bunch, grape_shades[0])
    for i in range(len(grapes)):
        m.paint(bunch & (owner == i), grape_shades[(i * 2 + rng.randint(0, 1)) % 3])
    m.paint(bunch & (second - nearest < 0.55) & (m.grid > 0), grape_deep)
    for gx, gy, gz in grapes:
        spot = m.ellipsoid_mask(gx - 1.3, gy + 1.7, gz - 2.0, 1.1)
        m.paint(spot & (m.surface("front", 1) | m.surface("top", 1) | m.surface("left", 1)), grape_light)

    # The jelly margin under the bell, scalloped, and the frilly mouth-arms.
    angle = np.arctan2(zs - cz, xs - cx)
    margin = (m.ellipsoid_mask(cx, cy, cz, rx + 0.3, 1.6, rz + 0.3) & m.box_mask(0, cy - 1, 0, 31, cy, 29))
    m.mask(margin, jelly)
    m.paint(margin & (np.cos(angle * 8) > 0.3), jelly_light)
    m.paint(margin & m.box_mask(0, cy - 1, 0, 31, cy - 1, 29), jelly_dark)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        x0, z0 = cx + 2.5 * math.cos(a), cz + 2.5 * math.sin(a)
        arm, s = polyline(m, [(x0, cy - 1, z0), (x0 + 1.2 * math.cos(a), cy - 5, z0 + 1.2 * math.sin(a)), (x0, cy - 9, z0)], 1.4, 0.7)
        m.mask(arm, frill)
        m.paint(arm & ((s // 2) % 2 == 1), frill_dark)

    # Wavy tentacles: each one wags on its own.
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        ca, sa = math.cos(a), math.sin(a)
        r0 = 8.4
        x0, z0 = cx + r0 * ca, cz + r0 * sa
        length = 19 if k % 2 == 0 else 15.5
        points = []
        for i in range(11):
            t = i / 10
            wave = math.sin(t * math.pi * 2.2 + k * 1.3) * 1.6 * min(1, t * 3)
            out = r0 + 2.4 * math.sin(t * math.pi * 0.8)
            points.append((cx + out * ca - wave * sa, cy - 1 - t * length, cz + out * sa + wave * ca))
        tentacle = m.limb("Tail", pivot=(x0, cy - 0.5, z0), phase=k % 2)
        tube, s = polyline(m, points, 1.6, 0.9)
        tube &= m.box_mask(0, 0, 0, 31, cy - 2, 29)
        m.mask(tube, jelly, part=tentacle)
        m.paint(tube & (s < 5), jelly_dark)
        m.paint(tube & (s > 8) & (s < 9.5), jelly_dark)
        m.paint(tube & (s > length - 4), jelly_light)
    # The vine on top: a stem, a big grape leaf and a curly tendril.
    m.box(15, 33, 14, 16, 37, 15, stem)
    m.box(16, 37, 14, 17, 38, 15, stem)
    m.paint_face(m.box_mask(15, 33, 0, 17, 38, 29), stem_dark, face="back")
    # A grape leaf on a tilted plane, with darker veins.
    origin = np.array([17.0, 36.6, 14.5])
    u_axis = np.array([math.cos(math.radians(22)), math.sin(math.radians(22)), 0.0])
    v_axis = np.array([0.0, 0.0, 1.0])
    normal = np.cross(u_axis, v_axis)
    rel = np.stack([xs - origin[0], ys - origin[1], zs - origin[2]], axis=-1)
    u, v, w = rel @ u_axis, rel @ v_axis, rel @ normal
    shape = np.zeros(m.grid.shape, dtype=bool)
    for lu, lv, lr in ((5.5, 0, 3.4), (8.8, 0, 2.2), (6.0, -3.6, 2.4), (6.0, 3.6, 2.4), (3.2, -3.4, 2.0), (3.2, 3.4, 2.0), (2.0, 0, 1.6)):
        shape |= (u - lu) ** 2 + (v - lv) ** 2 <= lr ** 2
    leaf_mask = shape & (np.abs(w) <= 0.72) & (m.grid == 0)
    m.mask(leaf_mask, leaf)
    m.paint(leaf_mask & (w > 0) & ((u - 5.5) ** 2 + v ** 2 <= 4), leaf_light)
    veins = (np.abs(v) <= 0.5) | (np.abs(v - (u - 2) * 0.9) <= 0.5) | (np.abs(v + (u - 2) * 0.9) <= 0.5)
    m.paint(leaf_mask & veins & (u > 1), leaf_dark)
    m.box(17, 37, 14, 19, 38, 15, stem)
    tendril, _ = polyline(m, [(15.5, 37.5, 14.5), (13.2, 38.4, 14.5), (11.4, 37.8, 14.0), (11.0, 36.4, 13.0), (12.2, 35.6, 12.2), (13.4, 36.2, 12.4)], 0.85)
    m.mask(tendril & (m.grid == 0), leaf_light)

    # Face: big googly eyes and a happy mouth on the grapes.
    for ex in (11.5, 20.5):
        m.ellipsoid(ex, 28.5, 5.2, 2.7, 2.7, 1.9, WHITE)
    face = {"k": BLACK, "h": WHITE, "t": "#ff6f91", "m": "#2a0838", "p": "#ff9ecf"}
    m.pixels(10, 27, ["hkk", "kkk", "kkk"], face)
    m.pixels(19, 27, ["hkk", "kkk", "kkk"], face)
    m.pixels(12, 22, [
        "m......m",
        ".mmmmmm.",
        "..mttm..",
    ], face)
    m.pixels(8, 25, ["pp"], face)
    m.pixels(22, 25, ["pp"], face)


# -- Chicleteira Bicicleteira ----------------------------------------------------


def yz_line(m, a, b, radius, x0, x1):
    """A tube in the side (y-z) plane, filled across x0..x1."""
    mask, _ = polyline(m, [(0, a[0], a[1]), (0, b[0], b[1])], radius)
    column = mask[0:1, :, :]
    out = np.zeros(m.grid.shape, dtype=bool)
    out[x0:x1 + 1] = column
    return out


@design("ChicleteiraBicicleteira", width=22, height=44, depth=40)
def chicleteira_bicicleteira(m):
    cx = 11
    red, red_dark, red_light = "#dd1f3a", "#9c0f22", "#ff5b6e"
    pink, pink_dark, pink_light = "#ff7ec4", "#e0529f", "#ffd1ea"
    glass, glass_light, glass_edge = "#cdeefe", "#ffffff", "#9fd6f0"
    chrome, chrome_dark = "#d6dce2", "#8d969f"
    frame, frame_dark = "#2ec4b6", "#1b877d"
    tyre, tyre_light = "#1f1f24", "#3a3a42"
    gold = "#f2c12e"
    gum_colours = ("#ff3b3b", "#ffd21f", "#2f8bff", "#35d05a", "#ff8a1f", "#ffffff", "#ff5fb8", "#9b5cff")

    # Wheels: tyre, chrome rim, spokes and a gold hub. Each one rolls.
    for zc in (7.0, 31.0):
        wheel = m.limb("Prop", pivot=(cx, 6.5, zc), axis="X")
        disc = m.cylinder_mask(cx - 1, 6.5, zc, 6.6, 2, axis="X")
        m.mask(disc & ~m.cylinder_mask(cx - 1, 6.5, zc, 5.2, 2, axis="X"), tyre, part=wheel)
        xs, ys, zs = m._centres
        ang = np.arctan2(ys - 6.5, zs - zc)
        m.paint(disc & ~m.cylinder_mask(cx - 1, 6.5, zc, 6.0, 2, axis="X") & (np.cos(ang * 10) > 0.4), tyre_light)
        m.mask(m.cylinder_mask(cx - 1, 6.5, zc, 5.2, 2, axis="X") & ~m.cylinder_mask(cx - 1, 6.5, zc, 4.3, 2, axis="X"), chrome, part=wheel)
        spokes = m.cylinder_mask(cx - 1, 6.5, zc, 4.4, 2, axis="X") & (
            (np.abs(ys - 6.5) < 0.5) | (np.abs(zs - zc) < 0.5)
            | (np.abs((ys - 6.5) - (zs - zc)) < 0.6) | (np.abs((ys - 6.5) + (zs - zc)) < 0.6))
        m.mask(spokes, chrome_dark, part=wheel)
        m.mask(m.cylinder_mask(cx - 1, 6.5, zc, 1.5, 2, axis="X"), gold, part=wheel)

    # Pink mudguards over the wheels, and a chrome rack at the back.
    for zc in (7.0, 31.0):
        guard = m.cylinder_mask(cx - 1, 6.5, zc, 8.5, 2, axis="X") & ~m.cylinder_mask(cx - 1, 6.5, zc, 7.0, 2, axis="X")
        m.mask(guard & m.box_mask(0, 10, 0, 21, 44, 39), pink)
    m.box(cx - 2, 15, 24, cx + 1, 15, 33, chrome)
    m.box(cx - 2, 15, 24, cx - 2, 15, 33, chrome_dark)
    m.box(cx + 1, 15, 24, cx + 1, 15, 33, chrome_dark)
    m.mask(yz_line(m, (15.2, 32.5), (7.0, 31.0), 0.9, cx - 2, cx - 2), chrome_dark)
    m.mask(yz_line(m, (15.2, 32.5), (7.0, 31.0), 0.9, cx + 1, cx + 1), chrome_dark)

    # The bicycle frame.
    tubes = [
        ((6.5, 20.5), (12.5, 9.8)),   # down tube
        ((14.5, 22.8), (15.2, 10.3)), # top tube
        ((6.5, 20.5), (15.5, 23.2)),  # seat tube
        ((12.5, 9.8), (16.5, 10.4)),  # head tube
    ]
    for a, b in tubes:
        m.mask(yz_line(m, a, b, 0.9, cx - 1, cx), frame)
    for a, b in (((6.5, 20.5), (6.5, 31)), ((15.0, 23.0), (6.5, 31))):   # chain and seat stays
        m.mask(yz_line(m, a, b, 0.95, cx - 2, cx - 2), frame_dark)
        m.mask(yz_line(m, a, b, 0.95, cx + 1, cx + 1), frame_dark)
    m.mask(yz_line(m, (12.5, 9.8), (6.5, 7.0), 0.95, cx - 2, cx - 2), frame_dark)   # fork
    m.mask(yz_line(m, (12.5, 9.8), (6.5, 7.0), 0.95, cx + 1, cx + 1), frame_dark)
    m.box(cx - 2, 5, 19, cx + 1, 7, 21, frame_dark)                                  # bottom bracket
    # Stem and handlebars with pink grips and streamers.
    m.box(cx - 1, 16, 9, cx, 21, 10, chrome)
    m.box(3, 21, 8, 18, 21, 9, chrome)
    m.box(1, 21, 8, 3, 22, 9, pink)
    m.box(18, 21, 8, 20, 22, 9, pink)
    m.box(1, 18, 8, 1, 20, 8, pink_light)
    m.box(20, 18, 8, 20, 20, 8, pink_light)
    m.box(2, 19, 8, 2, 20, 8, "#8fe3ff")
    m.box(19, 19, 8, 19, 20, 8, "#8fe3ff")
    m.box(cx - 1, 17, 7, cx, 18, 8, "#ffe36b")          # a bell
    # Saddle.
    m.box(8, 16, 20, 13, 16, 27, "#2a2a30")
    m.box(9, 16, 19, 12, 16, 19, "#2a2a30")

    # Pedals on a golden chainring: spin with the wheels.
    crank = m.limb("Prop", pivot=(cx, 6.5, 20.5), axis="X")
    m.mask(m.cylinder_mask(cx + 2, 6.5, 20.5, 2.7, 1, axis="X"), gold, part=crank)
    m.mask(m.cylinder_mask(cx + 2, 6.5, 20.5, 1.2, 1, axis="X"), "#c99a14", part=crank)
    m.box(cx - 3, 6, 20, cx - 3, 6, 20, chrome_dark, part=crank)
    m.box(cx + 3, 3, 20, cx + 3, 6, 20, chrome_dark, part=crank)
    m.box(cx + 3, 2, 19, cx + 5, 2, 21, "#2a2a30", part=crank)
    m.box(cx - 4, 6, 20, cx - 4, 10, 20, chrome_dark, part=crank)
    m.box(cx - 6, 10, 19, cx - 4, 10, 21, "#2a2a30", part=crank)

    # The gumball machine: a red base with a coin dial and a chute.
    for y in range(17, 25):
        grow = 1 if y < 19 else 0
        m.box(5 - grow, y, 17 - grow, 16 + grow, y, 28 + grow, red)
    m.paint_face(m.box_mask(0, 17, 0, 21, 18, 39), red_dark, face="front")
    m.paint_face(m.box_mask(0, 24, 0, 21, 24, 39), red_light, face="top")
    m.cylinder(cx, 20.5, 15, 2.6, 1.99, chrome, axis="Z")         # coin dial
    m.cylinder(cx, 20.5, 14, 1.2, 1, chrome_dark, axis="Z")
    m.box(cx - 1, 20, 13, cx, 20, 13, chrome_dark)                 # slot handle
    m.box(cx - 2, 22, 15, cx + 1, 22, 15, "#3a3a42")
    m.box(cx - 2, 16, 14, cx + 1, 17, 15, chrome)                 # gumball chute
    m.box(cx - 1, 16, 14, cx, 16, 14, chrome_dark)
    for x in (4, 17):
        m.paint_face(m.box_mask(x, 20, 0, x, 21, 39), gold, face="left" if x == 4 else "right")
    m.pixels(18, 22, ["ggg", "g.g", "ggg"], {"g": gold}, face="right")      # coin slot
    # Neck ring and the glass globe full of gumballs.
    m.cylinder(cx, 25, 23, 5.2, 1.99, pink)
    m.paint(m.cylinder_mask(cx, 25, 23, 5.2, 0.99), pink_dark)
    xs, ys, zs = m._centres
    globe = m.ellipsoid_mask(cx, 33, 23, 8.4, 8.2, 8.4)
    m.mask(globe, glass_edge)
    rng = random.Random(11)
    inside = globe & (ys < 38.5)
    for gy in np.arange(25.4, 39, 2.3):
        for gx in np.arange(3.0, 20, 2.35):
            for gz in np.arange(14.6, 32, 2.35):
                jx, jz = rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35)
                ball = m.ellipsoid_mask(gx + jx + (gy % 2) * 0.6, gy, gz + jz, 1.3) & inside
                m.paint(ball, rng.choice(gum_colours))
    m.paint(globe & (ys >= 38.5), glass)
    shine = globe & m.ellipsoid_mask(cx - 4.8, 36.0, 17, 1.3, 2.8, 2.4)
    m.paint(shine & (m.surface("front", 1) | m.surface("left", 1)), glass_light)
    m.paint(globe & m.ellipsoid_mask(cx + 5.6, 29, 17, 0.9, 1.4, 1.6) & m.surface("front", 1), glass_light)
    m.paint(globe & m.ellipsoid_mask(cx + 3, 38, 29, 1.3, 1.8, 2.4) & m.surface("back", 1), glass_light)
    # Red lid with a round knob.
    m.cylinder(cx, 40, 23, 4.6, 0.99, pink_dark)
    m.cylinder(cx, 41, 23, 4.2, 0.99, pink)
    m.paint(m.cylinder_mask(cx, 41, 23, 3.0, 0.99), pink_light)
    m.sphere(cx, 42.6, 23, 1.4, pink)
    m.paint(m.ellipsoid_mask(cx - 0.5, 43.2, 22.5, 0.8), pink_light)

    # Face on the glass: big eyes, and pink lips blowing a bubble.
    face = {"w": WHITE, "k": BLACK, "h": WHITE, "b": "#6b3b1a"}
    for ex in (7.0, 15.0):
        m.ellipsoid(ex, 34.5, 16.6, 2.6, 2.8, 1.9, WHITE)
    m.pixels(6, 33, ["hk", "kk", "kk"], face)
    m.pixels(14, 33, ["hk", "kk", "kk"], face)
    m.pixels(5, 37, ["kkk"], face, z=16)
    m.pixels(14, 37, ["kkk"], face, z=16)
    m.sphere(cx, 27.6, 12.2, 4.4, pink)
    m.paint(m.ellipsoid_mask(cx - 1.8, 29.6, 8.6, 1.5, 1.5, 1.5), pink_light)
    m.paint(m.ellipsoid_mask(cx, 23.8, 12.2, 3.2, 1.2, 3.2), pink_dark)
    lips = m.cylinder_mask(cx, 27.6, 15.2, 3.4, 1.2, axis="Z") & ~m.cylinder_mask(cx, 27.6, 15.2, 2.0, 1.2, axis="Z")
    m.mask(lips, red_dark)

    # Little arms holding the handlebars.
    for x_side, grip in ((4.5, 2.5), (16.5, 18.5)):
        arm, _ = polyline(m, [(x_side, 21.5, 18.5), (grip, 21.8, 13), (grip, 21.5, 10)], 0.8)
        m.mask(arm & (m.grid == 0), chrome)
        m.box(int(grip) - 1, 21, 9, int(grip) + 1, 23, 11, WHITE)


# -- Nuclearo Dinossauro ---------------------------------------------------------


def spike_plate(m, y0, z0, height, length, colour, tip, part=0, x0=13, x1=14, up=False):
    """A dorsal plate: a triangle in the side plane, pointing back (or up)."""
    for k in range(length):
        half = max(0, round((height - 1) / 2 * (1 - k / length)))
        if up:
            m.box(x0, y0 + k, z0 - half, x1, y0 + k, z0 + half, tip if k == length - 1 else colour, part=part)
        else:
            m.box(x0, y0 - half, z0 + k, x1, y0 + half, z0 + k, tip if k == length - 1 else colour, part=part)


@design("NuclearoDinossauro", width=28, height=46, depth=46)
def nuclearo_dinossauro(m):
    cx = 14
    scale, scale_dark, scale_light = "#358a30", "#215c1d", "#52ad46"
    belly, belly_dark = "#a9c96b", "#86a84f"
    glow, glow_core, glow_dark = "#7dff1a", "#e0ffb0", "#4ccf16"
    yellow, black = "#ffd60a", "#141414"
    tooth, claw = "#fbf8e8", "#e8e2c8"
    rng = random.Random(9)

    # Big legs with three-toed feet (drawn first so the body covers the hips).
    for side, (x0, x1) in ((0, (2, 8)), (1, (19, 25))):
        xc = (x0 + x1 + 1) / 2
        leg = m.limb("Leg", pivot=(xc, 15, 25), phase=side)
        m.ellipsoid(xc, 13, 25, 3.6, 5.2, 4.8, scale, part=leg)
        m.box(x0 + 1, 3, 23, x1 - 1, 9, 27, scale, part=leg)
        m.box(x0, 0, 19, x1, 2, 28, scale_dark, part=leg)
        m.box(x0, 3, 21, x1, 3, 28, scale, part=leg)
        m.paint_face(m.box_mask(x0, 0, 0, x1, 2, 45), scale, face="top")
        for tx in (x0, x0 + 3, x1 - 1):
            m.box(tx, 0, 17, tx + 1, 1, 18, claw, part=leg)
        m.paint_face(m.box_mask(x0, 9, 0, x1, 17, 45), scale_dark, face="left" if side == 0 else "right")

    # The body: an upright, pot-bellied torso and a thick neck.
    m.ellipsoid(cx, 17, 24, 8.8, 8.8, 9.2, scale)
    m.ellipsoid(cx, 25, 22, 7.6, 7.5, 7.8, scale)
    m.cylinder(cx, 26, 21, 5.2, 5, scale)
    # Tiger-like dark stripes over the back.
    xs, ys, zs = m._centres
    for y in (13, 18, 23, 28):
        band = (np.abs(ys - (y + (zs - 24) * 0.25)) < 0.9) & (zs > 24)
        m.paint(band & (m.part == 0), scale_dark)
    # Belly plate with scutes and the radiation sign.
    m.paint_face(m.box_mask(7, 10, 0, 20, 29, 23), belly, face="front")
    for y in range(11, 30, 3):
        m.paint_face(m.box_mask(7, y, 0, 20, y, 23), belly_dark, face="front")
    m.pixels(8, 13, RADIATION, {"y": yellow, "k": black})

    # Tail: long and thick, sweeping back to the ground.
    tail = m.limb("Tail", pivot=(cx, 15, 31))
    tube, _ = polyline(m, [(cx, 16, 29), (cx, 13, 35), (cx, 9.5, 40), (cx, 8, 43.5), (cx, 9, 45.5)], 4.6, 1.3)
    tube &= m.box_mask(0, 0, 31, 27, 45, 45)
    m.mask(tube, scale, part=tail)
    m.paint(tube & m.surface("bottom", 2), belly)
    for z in (34, 38.5):
        m.paint(tube & (np.abs(zs - z) < 0.8) & (ys > 9), scale_dark)

    # Tiny arms with claws.
    for side, x0 in ((0, 7), (1, 19)):
        arm = m.limb("Arm", pivot=(x0 + 1, 25.5, 17), phase=side)
        m.box(x0, 24, 14, x0 + 1, 25, 17, scale, part=arm)
        m.box(x0, 22, 13, x0 + 1, 24, 14, scale, part=arm)
        m.box(x0, 21, 12, x0, 22, 12, claw, part=arm)
        m.box(x0 + 1, 21, 12, x0 + 1, 21, 12, claw, part=arm)

    # The big head: skull, snout, a jaw full of teeth and a glowing mouth.
    head = m.limb("Head", pivot=(cx, 29, 18))
    m.mask(rounded_box_mask(m, 7, 27, 9, 20, 40, 19), scale, part=head)
    m.mask(rounded_box_mask(m, 8, 31, 2, 19, 36, 10), scale, part=head)
    m.mask(rounded_box_mask(m, 8, 26, 4, 19, 28, 12), scale, part=head)
    m.box(9, 29, 5, 18, 30, 9, glow_dark, part=head)
    m.box(10, 29, 7, 17, 30, 9, glow, part=head)
    for x in range(9, 19):
        m.voxel(x, 30 if x % 2 == 0 else 29, 3 if x % 2 == 0 else 4, tooth, part=head)
    for z in range(5, 10):
        m.voxel(8 if z % 2 else 19, 30, z, tooth, part=head)
        m.voxel(19 if z % 2 else 8, 29, z, tooth, part=head)
    m.paint_face(m.box_mask(8, 36, 0, 19, 36, 45), scale_light, face="top")
    m.paint_face(m.box_mask(7, 40, 0, 20, 40, 45), scale_light, face="top")
    m.paint_face(m.box_mask(8, 26, 0, 19, 26, 45), belly, face="bottom")
    m.paint_face(m.box_mask(8, 26, 0, 19, 27, 12), belly, face="front")
    m.pixels(10, 35, ["kk....kk"], {"k": scale_dark})   # nostrils
    # Scaly stripes and glowing freckles on the head.
    for z in (12, 15, 18):
        m.paint_face(m.box_mask(0, 33, z, 27, 39, z), scale_dark, face="left")
        m.paint_face(m.box_mask(0, 33, z, 27, 39, z), scale_dark, face="right")
    for x, y, z in ((7, 35, 13), (7, 31, 16), (20, 34, 14), (20, 31, 11), (12, 40, 14), (16, 40, 17)):
        m.paint(m.box_mask(x, y, z, x, y, z + 1) & (m.part == head), glow_dark)
    m.paint_face(m.box_mask(8, 26, 0, 19, 28, 16), belly, face="left")
    m.paint_face(m.box_mask(8, 26, 0, 19, 28, 16), belly, face="right")
    # Glowing eyes under heavy, angry brows.
    m.pixels(8, 37, [
        "............",
        "ggcg....gcgg",
        "gkkg....gkkg",
    ], {"g": glow, "c": glow_core, "k": black})
    m.pixels(8, 39, ["dddd....dddd"], {"d": scale_dark}, z=8, part=head)
    m.pixels(8, 38, ["...d....d..."], {"d": scale_dark}, z=8, part=head)
    # A crest of glowing plates from the head down the back.
    spike_plate(m, 41, 12, 3, 2, glow, glow_core, part=head, up=True)
    spike_plate(m, 41, 15, 5, 3, glow, glow_core, part=head, up=True)
    spike_plate(m, 41, 18, 3, 2, glow, glow_core, part=head, up=True)
    spike_plate(m, 36, 20, 5, 3, glow, glow_core, part=head)
    filled = m.grid > 0
    for y0, h, length in ((30, 5, 3), (26, 7, 4), (21, 7, 5), (16, 6, 4)):
        column = np.nonzero(filled[13, y0, :] & (m.part[13, y0, :] == 0))[0]
        spike_plate(m, y0, int(column.max()) + 1, h, length, glow, glow_core)
    for z, h in ((35, 7), (39, 5), (43, 3)):
        column = np.nonzero(filled[13, :, z] & (m.part[13, :, z] == tail))[0]
        spike_plate(m, int(column.max()) + 1, z, h, max(2, h // 2 + 1), glow, glow_core, part=tail, up=True)

    # Radioactive glowing spots on the scales.
    surface = m.surface("left") | m.surface("right") | m.surface("back") | m.surface("top")
    for _ in range(34):
        x, y, z = rng.randint(3, 24), rng.randint(6, 40), rng.randint(10, 44)
        spot = m.box_mask(x, y, z, x + 1, y, z + 1) & surface & ~m.box_mask(7, 10, 0, 20, 29, 22)
        spot &= (m.grid == m.colour(scale)) | (m.grid == m.colour(scale_dark))
        m.paint(spot, glow_dark)
    absorb_orphans(m)


# -- Dragon Cannelloni -----------------------------------------------------------


@design("DragonCannelloni", width=44, height=36, depth=52)
def dragon_cannelloni(m):
    pasta, pasta_light, pasta_dark, pasta_edge = "#f3d27a", "#fbe7aa", "#d9ad52", "#c28a33"
    sauce, sauce_dark, sauce_light = "#d62b1e", "#9e160d", "#ff5a3c"
    basil, basil_dark, basil_light = "#2e9e3e", "#1c6b28", "#5fcf62"
    ricotta, spinach = "#fff3d2", "#4f8f2f"
    cheese = "#fffbea"
    horn, horn_light = "#a8581a", "#d48a3a"
    whisker = "#ffb300"
    xs, ys, zs = m._centres
    rng = random.Random(4)

    def cannellone(x, y, z0, z1, r, part=0, open_back=False, open_front=False):
        """A ridged pasta tube along z; open ends show the ricotta filling."""
        tube = m.cylinder_mask(x, y, z0, r, z1 - z0 + 1, axis="Z")
        m.mask(tube, pasta, part=part)
        angle = np.arctan2(ys - y, xs - x)
        m.paint(tube & (np.cos(angle * 9) > 0.55), pasta_dark)
        m.paint(tube & (ys > y + r * 0.6) & (np.cos(angle * 9) <= 0.55), pasta_light)
        rim = tube & (zs < z0 + 1) | tube & (zs > z1)
        m.paint(rim, pasta_edge)
        filling = m.cylinder_mask(x, y, z0, r - 1.3, z1 - z0 + 1, axis="Z")
        for is_open, end in ((open_back, zs > z1), (open_front, zs < z0 + 1)):
            if is_open:
                face = tube & end & filling
                m.paint(face, ricotta)
                m.paint(face & (((xs * 3 + ys * 5).astype(int) % 4) == 0), spinach)
        # A ribbon of sauce over the top.
        drape = tube & (ys > y + r * 0.35) & (np.abs(zs - (z0 + z1 + 1) / 2) < 1.8)
        m.paint(drape & m.surface("top", 2), sauce)
        return tube

    def blob(x, y, z, r, part=0):
        m.mask(m.ellipsoid_mask(x, y, z, r, r, 1.9), sauce, part=part)
        m.paint(m.ellipsoid_mask(x - r * 0.4, y + r * 0.5, z - 0.5, 1.0), sauce_light)

    # The body: a wavy chain of cannelloni tubes glued with tomato sauce.
    tubes = [(22, 13, 12, 17, 4.6), (22, 15, 20, 25, 4.8), (20, 21, 28, 33, 4.6), (23.5, 16.5, 36, 40, 4.2)]
    for i, (x, y, z0, z1, r) in enumerate(tubes):
        cannellone(x, y, z0, z1, r, open_front=i > 0)
        if i + 1 < len(tubes):
            nx, ny, nz0, _, _ = tubes[i + 1]
            blob((x + nx) / 2, (y + ny) / 2, (z1 + nz0 + 1) / 2, min(r, tubes[i + 1][4]) - 1.9)
    # Sauce spines and basil leaves along the crest.
    for i, (x, y, z0, z1, r) in enumerate(tubes):
        top = int(y + r)
        zc = (z0 + z1) // 2
        m.box(int(x), top, zc - 1, int(x), top + 2, zc + 1, sauce)
        m.box(int(x), top + 3, zc, int(x), top + 3, zc, sauce_dark)
        m.ellipsoid(x + 0.5, top + 0.8, z1 - 0.2, 1.4, 0.9, 1.3, basil)
        m.paint(m.ellipsoid_mask(x + 0.5, top + 1.3, z1 - 0.4, 0.7, 0.5, 0.7), basil_light)
    tops = np.argwhere(m.surface("top", 1) & (m.grid == m.colour(sauce)))
    for i in rng.sample(range(len(tops)), min(12, len(tops))):
        x, y, z = tops[i]
        m.voxel(x, y, z, cheese)

    # The tail: a thinner tube curling up, with an open ricotta end and basil.
    tail = m.limb("Tail", pivot=(24.5, 15.5, 41))
    blob(25, 14, 42, 2.4, part=tail)
    cannellone(26, 12, 43, 47, 3.2, part=tail, open_back=True, open_front=True)
    t2, _ = polyline(m, [(26, 12, 48), (25.5, 15, 50), (25, 19, 50.5), (25, 24, 49.5)], 2.0, 1.2)
    m.mask(t2 & (m.grid == 0), pasta, part=tail)
    m.paint(t2 & (m.part == tail) & ((np.floor(ys) % 3) == 0), pasta_edge)
    for dx, dy, dz in ((0, 1.6, 0), (-1.5, 0.6, 0.3), (1.5, 0.6, 0.3), (0, 0.6, 1.3), (0, 0.8, -1.3)):
        m.mask(m.ellipsoid_mask(25 + dx, 24.5 + dy, 49.5 + dz, 1.3, 1.1, 1.1) & (m.grid == 0), basil, part=tail)
    m.paint(m.ellipsoid_mask(25, 26.3, 49.5, 1.0, 0.6, 1.0), basil_light)

    # Lasagna-sheet wings, spread up and out, with ruffled golden edges.
    for side in (0, 1):
        sign = -1 if side == 0 else 1
        root_x = 17.5 if side == 0 else 26.5
        wing = m.limb("Wing", pivot=(root_x, 17.0, 22.5), phase=side)
        d = (xs - root_x) * sign
        top_edge = 18.5 + 0.95 * d
        bottom_edge = 13.0 + 0.3 * d + 2.2 * np.abs(np.sin(np.pi * d / 4.6))
        sheet = (d >= -1.5) & (d <= 16.5) & (ys <= top_edge) & (ys >= bottom_edge) & (zs >= 22) & (zs <= 23)
        sheet &= ~((d > 13.8) & (ys < top_edge - 4.5))
        m.mask(sheet & (m.grid == 0), pasta_light, part=wing)
        sheet &= m.part == wing
        edge = sheet & (ys < bottom_edge + 1.3)
        m.paint(edge, pasta_edge)
        ruffle = edge & ((np.floor(d) % 2) == 0)
        m.mask(np.roll(ruffle, 1, axis=2) & (m.grid == 0), pasta_edge, part=wing)
        for rib in (4.6, 9.2, 13.8):
            m.paint(sheet & (np.abs(d - rib) < 0.55) & (ys > bottom_edge + 1.3), pasta)
        m.paint(sheet & (np.abs(d - 7) < 1.2) & (np.abs(ys - (top_edge - 3.5)) < 1.2), sauce)
        m.paint(sheet & (np.abs(d - 11.5) < 1.0) & (np.abs(ys - (top_edge - 3.2)) < 1.0), sauce)
        m.paint(sheet & (np.abs(d - 3) < 0.8) & (np.abs(ys - (top_edge - 2.5)) < 0.8), sauce)
        bone, _ = polyline(m, [(root_x, 18.5, 22.5), (root_x + sign * 16.5, 18.5 + 0.95 * 16.5, 22.5)], 1.25, 0.9)
        m.mask(bone & ((m.grid == 0) | (m.part == wing)), pasta, part=wing)
        m.paint(bone & (m.part == wing) & ((np.floor(xs) % 3) == 0), pasta_edge)
        m.mask(m.ellipsoid_mask(root_x + sign * 17, 18.5 + 0.95 * 17, 22.5, 1.4) & (m.grid == 0), sauce, part=wing)

    # The head: a pasta dragon with bulging eyes, whiskers and antlers.
    head = m.limb("Head", pivot=(22, 16, 12))
    m.mask(rounded_box_mask(m, 16, 15, 4, 27, 24, 13), pasta, part=head)
    m.mask(rounded_box_mask(m, 17, 16, 0, 26, 21, 5), pasta, part=head)
    m.mask(rounded_box_mask(m, 17, 11, 1, 26, 13, 11), pasta, part=head)
    m.box(18, 14, 3, 25, 15, 5, "#5a0a0a", part=head)           # open mouth
    m.box(21, 13, 0, 22, 13, 3, sauce_light, part=head)          # tongue
    m.box(20, 12, 0, 20, 12, 0, sauce_light, part=head)
    m.box(23, 12, 0, 23, 12, 0, sauce_light, part=head)
    m.box(21, 12, 0, 22, 12, 0, sauce_light, part=head)
    for x in (17, 26):
        m.box(x, 14, 1, x, 15, 1, WHITE, part=head)                # fangs
    for x in (18, 19, 24, 25):
        m.box(x, 15, 2 if x in (19, 24) else 1, x, 15, 2 if x in (19, 24) else 1, WHITE, part=head)
    for y in (17, 19, 23):
        m.paint_face(m.box_mask(16, y, 0, 27, y, 13), pasta_dark, face="left")
        m.paint_face(m.box_mask(16, y, 0, 27, y, 13), pasta_dark, face="right")
    m.paint_face(m.box_mask(16, 24, 0, 27, 24, 13), pasta_light, face="top")
    # Baked tomato sauce and cheese over the top of the head.
    m.paint(m.box_mask(17, 24, 6, 26, 24, 12) & m.surface("top", 1), sauce)
    for x, z in ((17, 6), (20, 5), (24, 6), (26, 9)):
        m.paint(m.box_mask(x, 22, z, x, 24, z) & (m.surface("front", 1) | m.surface("left", 1) | m.surface("right", 1)), sauce)
    for x, z in ((19, 8), (23, 10), (21, 11), (25, 8)):
        m.paint(m.box_mask(x, 24, z, x, 24, z), cheese)
    m.paint_face(m.box_mask(17, 11, 0, 26, 11, 13), pasta_edge, face="bottom")
    # Big curled nostrils on the snout.
    for x in (18, 24):
        m.box(x, 21, 0, x + 1, 22, 1, pasta_edge, part=head)
        m.voxel(x + (1 if x == 18 else 0), 21, 0, "#3a1a08", part=head)
    # Bulging eyes with basil brows.
    for x in (17, 23):
        m.box(x, 21, 3, x + 3, 24, 3, WHITE, part=head)
    face = {"k": BLACK, "h": WHITE, "g": basil, "d": basil_dark}
    m.pixels(17, 21, ["....", ".hk.", ".kk.", "...."], face, z=3, part=head)
    m.pixels(23, 21, ["....", ".hk.", ".kk.", "...."], face, z=3, part=head)
    m.pixels(16, 25, ["ggggg..ggggg"], face, z=4, part=head)
    m.pixels(16, 25, ["ddddd..ddddd"], face, z=5, part=head)
    # Golden whiskers.
    for side in (0, 1):
        sign = -1 if side == 0 else 1
        x0 = 16.5 if side == 0 else 26.5
        w, _ = polyline(m, [(x0, 18.5, 2.5), (x0 + sign * 3, 17.8, 3), (x0 + sign * 6, 18.6, 5.5), (x0 + sign * 8, 20.2, 8.5), (x0 + sign * 8.4, 22, 11)], 0.8)
        m.mask(w & (m.grid == 0), whisker, part=head)
    # Baked-crust antlers.
    for side in (0, 1):
        sign = -1 if side == 0 else 1
        x0 = 19 if side == 0 else 25
        h1, _ = polyline(m, [(x0, 24, 10), (x0 + sign * 1, 28, 12), (x0 + sign * 2, 31.5, 15.5)], 1.05, 0.8)
        h2, _ = polyline(m, [(x0 + sign * 1, 28, 12), (x0 + sign * 3.5, 29.5, 10.5)], 0.85)
        m.mask((h1 | h2) & (m.grid == 0), horn, part=head)
        m.paint((h1 | h2) & (ys > 29), horn_light)
    # A mane of basil leaves behind the head.
    for x, y in ((16, 20), (15, 23), (18, 26), (27, 20), (28, 23), (25, 26), (21.5, 25.6)):
        m.mask(m.ellipsoid_mask(x, y, 13.5, 1.5, 1.2, 1.8) & (m.grid == 0), basil, part=head)
        m.paint(m.ellipsoid_mask(x, y + 0.6, 13, 0.8, 0.6, 1.0), basil_light)


# -- Strawberry Elephant ---------------------------------------------------------


def strawberry_seeds(m, region, seed, dimple, light=None, spacing=11):
    """Yellow seeds scattered over the visible surface of a region, each with a
    darker dimple above it."""
    xs, ys, zs = m._centres
    surface = np.logical_or.reduce(exposed(m)) & region
    pick = ((xs.astype(int) * 3 + ys.astype(int) * 5 + zs.astype(int) * 7) % spacing) == 0
    seeds = surface & pick
    above = np.roll(seeds, 1, axis=1) & surface & ~seeds
    m.paint(above, dimple)
    m.paint(seeds, seed)
    return seeds


@design("StrawberryElephant", width=34, height=38, depth=38)
def strawberry_elephant(m):
    cx = 17
    red, red_dark, red_light = "#e8283a", "#a8121f", "#ff6470"
    seed, dimple = "#ffd84a", "#c41a2a"
    core, core_light = "#ffb3b8", "#fff0ee"
    leaf, leaf_dark, leaf_light = "#3fae3a", "#23772a", "#7ad65a"
    nail, tusk = "#fff1d8", "#fffdf4"
    xs, ys, zs = m._centres

    # Four sturdy legs with pale toenails; diagonal pairs step together.
    legs = []
    for x0, z0, phase in ((7, 16, 0), (22, 16, 1), (7, 28, 1), (22, 28, 0)):
        leg = m.limb("Leg", pivot=(x0 + 2.5, 9.5, z0 + 2.5), phase=phase)
        m.mask(rounded_box_mask(m, x0, 0, z0, x0 + 4, 10, z0 + 4, vertical_only=True), red, part=leg)
        m.box(x0, 0, z0, x0 + 4, 0, z0 + 4, red_dark, part=leg)
        for nx in (x0, x0 + 2, x0 + 4):
            m.box(nx, 0, z0 - 1 if nx == x0 + 2 else z0, nx, 1, z0 - 1 if nx == x0 + 2 else z0, nail, part=leg)
        legs.append(leg)

    # The body: a big round strawberry.
    body = m.ellipsoid_mask(cx, 16.5, 25, 11, 9, 11.5)
    m.mask(body, red)
    m.paint(body & (ys < 11), red_dark)
    m.paint(body & m.surface("top", 1) & (ys > 24.5) & (np.abs(xs - cx) < 5), red_light)

    # A little tail with a leafy tip.
    tail = m.limb("Tail", pivot=(cx, 19, 36))
    t, _ = polyline(m, [(cx, 19, 35.5), (cx, 17, 37.2), (cx, 14, 37.5)], 0.9)
    m.mask(t & (m.grid == 0), red_dark, part=tail)
    m.mask(m.ellipsoid_mask(cx, 12.8, 37.2, 1.5, 1.6, 0.9) & (m.grid == 0), leaf, part=tail)

    # The head: a strawberry wider at the top, with floppy strawberry-half ears.
    head = m.limb("Head", pivot=(cx, 20, 15))
    taper = np.clip(0.72 + 0.28 * (ys - 14) / 16, 0.72, 1.0)
    head_mask = ((xs - cx) / (8.8 * taper)) ** 2 + ((ys - 23) / 8.5) ** 2 + ((zs - 11) / (8.2 * taper)) ** 2 <= 1
    m.mask(head_mask, red, part=head)
    m.paint(head_mask & (ys < 17), red_dark)
    m.paint(head_mask & m.surface("top", 1), red_light)
    for side in (0, 1):
        sign = -1 if side == 0 else 1
        ex = cx + sign * 11.5
        ear = m.ellipsoid_mask(ex, 22, 11.5, 6.0, 7.2, 1.2) & ((xs - cx) * sign > 6)
        m.mask(ear & (m.grid == 0), red, part=head)
        # The front of the ear shows the inside of a cut strawberry.
        inner = m.ellipsoid_mask(ex, 22, 11.5, 4.6, 5.8, 9) & ear
        m.paint(inner & m.surface("front", 1), core)
        m.paint(m.ellipsoid_mask(ex + sign * 0.5, 22.5, 11.5, 2.2, 3.4, 9) & ear & m.surface("front", 1), core_light)
        m.mask(m.ellipsoid_mask(ex, 22, 12.6, 5.0, 6.2, 0.8) & (m.grid == 0), red_dark, part=head)
    # Trunk: long, wrinkled, curling forward at the tip.
    trunk, s = polyline(m, [(cx, 18, 4.5), (cx, 14, 3.2), (cx, 10, 3.0), (cx, 6.5, 2.4), (cx, 4.5, 1.2), (cx, 5.2, 0.5)], 2.6, 1.6)
    trunk &= m.grid == 0
    m.mask(trunk, red, part=head)
    m.paint(trunk & ((s % 2.5) < 0.8), red_dark)
    m.pixels(16, 4, ["kk"], {"k": "#5a0a12"}, z=0, part=head)
    # Tusks.
    for side in (0, 1):
        sign = -1 if side == 0 else 1
        t, _ = polyline(m, [(cx + sign * 3.2, 16, 5), (cx + sign * 4.2, 13.5, 3), (cx + sign * 4.0, 12.2, 1.2)], 0.9)
        m.mask(t & (m.grid == 0), tusk, part=head)
    # Face: sweet eyes with a highlight, rosy cheeks.
    face = {"k": "#1b1010", "h": WHITE, "p": "#ff9ab0", "l": "#1b1010"}
    m.pixels(11, 21, [
        "hk......hk",
        "kk......kk",
        "kk......kk",
    ], face)
    m.pixels(9, 19, ["pp..........pp"], {"p": "#ff9ab0"})
    # The leafy crown on top of the head: pointed sepals drooping over the
    # sides, and a curly stem.
    for k in range(7):
        a = 2 * math.pi * k / 7 + 0.25
        ca, sa = math.cos(a), math.sin(a)
        pts = [(cx + r * ca, y, 11 + r * sa * 0.95) for r, y in ((0, 32.2), (3, 31.6), (5.5, 30.6), (7.6, 28.6), (8.8, 26.4))]
        sepal, s_leaf = polyline(m, pts, 1.8, 0.75)
        m.mask(sepal, leaf if k % 2 else leaf_dark, part=head)
        m.paint(sepal & m.surface("top", 1) & (s_leaf > 1.5) & (s_leaf < 6), leaf_light if k % 2 else leaf)
    m.mask(m.cylinder_mask(cx, 31, 11, 2.3, 2), leaf_dark, part=head)
    stem, _ = polyline(m, [(cx, 32.5, 11), (cx, 35, 11.5), (cx + 1.4, 36.3, 12.6)], 0.9)
    m.mask(stem, "#5d8f2a", part=head)

    # Seeds everywhere red.
    reds = (m.grid == m.colour(red)) | (m.grid == m.colour(red_dark)) | (m.grid == m.colour(red_light))
    strawberry_seeds(m, reds, seed, dimple)


# -- Tralalero sharks (for La Grande Combinasion and Los Tralaleritos) --------------

SHARK = "#3a8ee6"
SHARK_DARK = "#2360b4"
SHARK_LIGHT = "#74b6f5"
SHARK_BELLY = "#f1f6fb"
SNEAKER = "#1f63e0"
SNEAKER_DARK = "#1547a8"


def sneaker(m, x0, x1, y0, z0, z1, part=0, outer="left"):
    """A blue sneaker with a white sole, laces and swoosh, toe at z0."""
    m.box(x0, y0, z0, x1, y0, z1, WHITE, part=part)                     # sole
    m.box(x0, y0 + 1, z0, x1, y0 + 2, z1, SNEAKER, part=part)
    m.box(x0, y0 + 3, z0 + 2, x1, y0 + 3, z1, SNEAKER, part=part)
    m.box(x0, y0 + 1, z0, x1, y0 + 1, z0, SNEAKER_DARK, part=part)      # toe cap
    m.box(x0 + 1 if x1 - x0 > 1 else x0, y0 + 3, z0 + 2, x1 - 1 if x1 - x0 > 1 else x1, y0 + 3, z0 + 2, WHITE, part=part)  # laces
    m.box(x0, y0 + 2, z1, x1, y0 + 3, z1, SNEAKER_DARK, part=part)      # heel
    swoosh_x = x0 if outer == "left" else x1
    m.box(swoosh_x, y0 + 1, z0 + 1, swoosh_x, y0 + 1, z1 - 1, WHITE, part=part)
    m.box(swoosh_x, y0 + 2, z1 - 1, swoosh_x, y0 + 2, z1 - 1, WHITE, part=part)


def upright_shark(m, cx, y0, cz, size, leg_phases=None, tail_part=0, fin_back=8.0):
    """Tralalero Tralala: a blue shark standing up on three legs in sneakers,
    snout up, mouth wide open. cx, cz: centre on the ground; y0: sole height;
    size 1 is about 11 voxels wide and 24 tall. With leg_phases the three legs
    walk (front-left, front-right, back). Returns the top y."""
    xs, ys, zs = m._centres
    k = size
    by = y0 + 11.0 * k
    # Three legs in sneakers: two in front, one behind.
    feet = ((cx - 2.6 * k, cz - 1.2 * k), (cx + 2.6 * k, cz - 1.2 * k), (cx, cz + 2.2 * k))
    leg_top = int(round(by - 4 * k))
    legs = []
    for i, ((fx, fz), outer) in enumerate(zip(feet, ("left", "right", "left"))):
        x0 = int(math.floor(fx - 0.5))
        x1 = x0 + 1
        z0 = int(round(fz - 2.5 * k))
        z1 = z0 + int(round(4 * k))
        part = 0
        if leg_phases is not None:
            part = m.limb("Leg", pivot=(x0 + 1.0, leg_top + 1.0, z0 + 3.0), phase=leg_phases[i])
            legs.append(part)
        sneaker(m, x0, x1, y0, z0, z1, part=part, outer=outer)
        m.box(x0, y0 + 4, z0 + 2, x1, leg_top, z0 + 3, SHARK, part=part)
    # The body: a torpedo lofted along a curved spine, snout pointing up.
    spine = [(-7.2, 2.6, 1.6), (-4.0, 1.0, 3.8), (0.0, 0.0, 4.6), (4.0, -0.6, 4.3), (7.0, -2.2, 3.7), (8.8, -5.0, 2.9), (9.3, -7.6, 1.9), (9.0, -9.2, 1.1)]
    body = np.zeros(m.grid.shape, dtype=bool)
    for (y1, z1, r1), (y2, z2, r2) in zip(spine, spine[1:]):
        for t in np.linspace(0, 1, 9):
            y, z, r = y1 + (y2 - y1) * t, z1 + (z2 - z1) * t, r1 + (r2 - r1) * t
            body |= m.ellipsoid_mask(cx, by + y * k, cz + z * k, r * k * 1.05, r * k * 0.95, r * k)
    m.mask(body, SHARK)
    sy = np.array([p[0] for p in spine]) * k + by
    sz = np.interp(ys, sy, np.array([p[1] for p in spine]) * k + cz)
    sr = np.interp(ys, sy, np.array([p[2] for p in spine]) * k)
    m.paint(body & (zs < sz - 0.35 * sr) & (np.abs(xs - cx) < 2.6 * k) & (ys < by + 4.8 * k), SHARK_BELLY)
    m.paint(body & (zs > sz + 0.55 * sr), SHARK_DARK)
    m.paint(body & m.surface("top", 1) & (ys > by + 6 * k), SHARK_LIGHT)
    # A big open mouth carved into the front, with rows of teeth.
    mh0, mh1 = by + 4.6 * k, by + 6.8 * k
    mw = 2.8 * k
    front = m.surface("front", 2) & body & (np.abs(xs - cx) < mw) & (ys >= mh0) & (ys <= mh1)
    m.clear(front)
    inside = m.surface("front", 1) & body & (np.abs(xs - cx) < mw) & (ys >= mh0 - 1) & (ys <= mh1 + 1)
    m.paint(inside, "#7a1020")
    m.paint(inside & (ys < mh0 + 0.9), "#e0506a")
    lip = m.surface("front", 1) & body & (np.abs(xs - cx) < mw + 0.2)
    m.paint(lip & (ys > mh1) & (ys < mh1 + 1.0) & ((xs.astype(int) % 2) == 0), WHITE)
    m.paint(lip & (ys < mh0) & (ys > mh0 - 1.0) & ((xs.astype(int) % 2) == 1), WHITE)
    # Eyes on the sides of the head, above the corners of the mouth.
    ey = int(round(by + 7.6 * k))
    for side in (-1, 1):
        ex = int(round(cx + side * 2.4 * k)) - (1 if side < 0 else 0)
        eye = m.box_mask(ex, ey, 0, ex + 1, ey + 1, 60) & m.surface("front", 1) & body
        m.paint(eye, BLACK)
        m.paint(m.box_mask(ex, ey + 1, 0, ex, ey + 1, 60) & eye, WHITE)
    # Gill slits.
    for g in range(3):
        gy = by + (2.0 + g * 1.2) * k
        for face in ("left", "right"):
            m.paint_face(m.box_mask(0, gy, cz - 1 * k, 60, gy, cz + 1 * k), SHARK_DARK, face=face)
    # Dorsal fin, pectoral fins and a tail fin by the feet.
    for i in range(int(round(5 * k))):
        half = max(0.0, (4.0 * k - i * 0.75) / 2)
        z = int(round(cz + 3.8 * k + i))
        m.box(cx - 1, by + 1.5 * k - half + i * 0.6, z, cx, by + 1.5 * k + half + i * 0.6, z, SHARK_DARK)
    for side in (-1, 1):
        fin, _ = polyline(m, [(cx + side * 4.6 * k, by + 0.5 * k, cz), (cx + side * 7.2 * k, by - 2.8 * k, cz + 1.0 * k)], 1.25 * k, 0.65)
        m.mask(fin & (m.grid == 0), SHARK_DARK)
    tb = (cx, by - 7.0 * k, cz + 2.8 * k)
    upper, _ = polyline(m, [tb, (cx, by - 4.2 * k, cz + 7.2 * k)], 1.3 * k, 0.95)
    lower, _ = polyline(m, [tb, (cx, by - 6.8 * k, cz + 6.2 * k), (cx, y0 + 0.8, cz + fin_back * k)], 1.3 * k, 0.95)
    fin = (upper | lower) & (m.grid == 0) & (xs > cx - 1) & (xs < cx + 1)
    m.mask(fin, SHARK_DARK, part=tail_part)
    # Hips sit where each leg now meets the body.
    for part in legs:
        top_y = int(np.nonzero(((m.part == part) & (m.grid > 0)).any(axis=(0, 2)))[0].max())
        px, _, pz = m.limbs[part - 1].pivot
        m.limbs[part - 1].pivot = (px, top_y + 1.0, pz)
    return int(np.nonzero((m.grid > 0).any(axis=(0, 2)))[0].max())


# -- Los Tralaleritos ------------------------------------------------------------


@design("LosTralaleritos", width=42, height=34, depth=25)
def los_tralaleritos(m):
    gold, gold_dark, gold_light = "#f2c230", "#c28e12", "#ffe27a"
    steel, steel_dark = "#9aa3ad", "#4a4f57"

    def front_z(x, y):
        column = np.nonzero(m.grid[x, y, :] > 0)[0]
        return int(column.min()) if len(column) else None

    # The little golden stage.
    m.box(1, 0, 1, 40, 1, 23, gold)
    m.box(1, 0, 1, 40, 0, 23, gold_dark)
    m.paint_face(m.box_mask(1, 1, 0, 40, 1, 24), gold_light, face="top")
    for x in range(3, 40, 4):
        m.paint_face(m.box_mask(x, 0, 0, x + 1, 0, 24), gold_light, face="front")
    # Three sharks side by side, every one marching in its sneakers; the lead
    # singer in the middle is a little bigger.
    band = ((8, 13, 0.95), (21, 11, 1.1), (34, 13, 0.95))
    for cx, cz, k in band:
        upright_shark(m, cx, 0, cz, k, leg_phases=(0, 1, 1))

    # Left: a red electric guitar slung across the belly.
    cx, cz, k = band[0]
    by = 11.0 * k
    guitar = {}
    for x in range(cx - 4, cx + 6):
        for y in range(int(by - 6), int(by + 7)):
            lower = (x + 0.5 - (cx - 1)) ** 2 / 2.6 ** 2 + (y + 0.5 - (by - 2.5)) ** 2 / 2.4 ** 2 <= 1
            upper = (x + 0.5 - (cx + 0.3)) ** 2 / 1.9 ** 2 + (y + 0.5 - (by + 0.2)) ** 2 / 1.9 ** 2 <= 1
            if lower or upper:
                guitar[(x, y)] = "#e0282e"
    for i in range(7):
        guitar[(cx + 1 + i // 2 + (1 if i > 4 else 0), int(by + 1 + i))] = "#8a5a2b"
    guitar[(cx + 5, int(by + 7))] = "#3a2a1a"
    guitar[(cx + 4, int(by + 7))] = "#3a2a1a"
    guitar[(cx - 1, int(by - 2))] = "#1b1b1b"
    guitar[(cx, int(by - 2))] = "#1b1b1b"
    guitar[(cx - 2, int(by - 3))] = WHITE
    guitar[(cx - 1, int(by - 4))] = WHITE
    for (x, y), colour in guitar.items():
        z = front_z(x, y)
        if z is not None:
            m.voxel(x, y, z - 1, colour)

    # Middle: a microphone on a stand, right at the singer's mouth.
    cx, cz, k = band[1]
    by = 11.0 * k
    mouth_y = int(by + 5.4 * k)
    mz = front_z(cx, mouth_y) - 2
    m.box(cx - 1, 2, mz - 1, cx + 1, 2, mz + 1, steel_dark)
    m.box(cx, 3, mz, cx, mouth_y - 2, mz, steel)
    m.box(cx, mouth_y - 1, mz, cx, mouth_y - 1, mz + 1, steel)
    m.box(cx, mouth_y, mz + 1, cx, mouth_y, mz + 1, steel_dark)
    m.box(cx - 1, mouth_y - 1, mz, cx, mouth_y, mz + 1, "#2a2a2e")
    m.box(cx - 1, mouth_y, mz, cx, mouth_y, mz, "#5a5a62")
    # ... and a gold chain.
    for x in range(cx - 3, cx + 3):
        y = int(by + 2.8 * k - (0 if abs(x + 0.5 - cx) > 2 else 1) - (1 if abs(x + 0.5 - cx) < 1 else 0))
        z = front_z(x, y)
        m.voxel(x, y, z, gold if x % 2 else gold_light)
    m.voxel(cx - 1, int(by + 2.8 * k) - 3, front_z(cx - 1, int(by + 2.8 * k) - 3) - 1, gold)
    m.voxel(cx, int(by + 2.8 * k) - 3, front_z(cx, int(by + 2.8 * k) - 3) - 1, gold)

    # Right: cool sunglasses.
    cx, cz, k = band[2]
    by = 11.0 * k
    ey = int(round(by + 7.6 * k))
    for x in range(int(cx - 3.6 * k), int(cx + 3.6 * k) + 1):
        for y in (ey, ey + 1):
            z = front_z(x, y)
            if z is None:
                continue
            lens = abs(x + 0.5 - cx) > 0.8
            if y == ey + 1 or lens:
                m.voxel(x, y, z - (1 if lens else 0), "#141418")
    for x in (int(cx - 2.6 * k), int(cx + 1.6 * k)):
        z = front_z(x, ey + 1)
        m.voxel(x, ey + 1, z, "#8fd8ff")


# -- La Grande Combinasion -------------------------------------------------------


@design("LaGrandeCombinasion", width=32, height=58, depth=30)
def la_grande_combinasion(m):
    cx, cz = 16, 14
    wood, wood_dark, wood_light, wood_ring = "#b5763a", "#86511f", "#d39556", "#ebc084"
    bat, bat_dark = "#e0b57a", "#b88748"
    croc, croc_dark, croc_light = "#4f9a3a", "#30681f", "#7cc65a"
    helmet, helmet_dark = "#7a4a24", "#54300f"
    rim, lens, lens_light = "#3b3b40", "#8fd8ff", "#e4f7ff"
    gold, gold_dark, gold_light = "#f6c21a", "#c38f07", "#ffe37a"
    xs, ys, zs = m._centres

    # Tung Tung Tung Sahur at the bottom: a log on two stubby wooden legs.
    for side, x0 in ((0, 12), (1, 17)):
        leg = m.limb("Leg", pivot=(x0 + 1.5, 6, cz), phase=side)
        m.box(x0, 2, cz - 1, x0 + 2, 6, cz + 1, wood, part=leg)
        m.box(x0, 0, cz - 3, x0 + 2, 1, cz + 1, wood_dark, part=leg)
        m.box(x0, 2, cz - 3, x0 + 2, 2, cz - 2, wood_dark, part=leg)
    log = m.cylinder_mask(cx, 6, cz, 6.6, 13)
    m.mask(log, wood)
    angle = np.arctan2(zs - cz, xs - cx)
    m.paint(log & (np.cos(angle * 11) > 0.55), wood_dark)
    m.paint(log & (np.cos(angle * 11 + 1.2) > 0.85), wood_light)
    ring = m.cylinder_mask(cx, 18, cz, 6.6, 0.99) & ~m.cylinder_mask(cx, 18, cz, 5.5, 0.99)
    m.paint(ring & m.surface("top", 1), wood_dark)
    m.paint(m.cylinder_mask(cx, 18, cz, 5.5, 0.99), wood_ring)
    m.paint(m.cylinder_mask(cx, 18, cz, 3.5, 0.99) & ~m.cylinder_mask(cx, 18, cz, 2.6, 0.99), wood_light)
    for kx, ky, kz in ((10.0, 8.5, 9), (22.5, 15, 13)):
        m.paint(m.ellipsoid_mask(kx, ky, kz, 1.2, 1.4, 1.2) & m.surface("front", 1) | m.ellipsoid_mask(kx, ky, kz, 1.2, 1.4, 9) & m.surface("right", 1), wood_dark)
    # His face: huge round eyes and a wide grin.
    face = {"w": WHITE, "k": "#1a0f08", "h": WHITE, "m": "#3a1c0a", "t": "#d0604a"}
    m.pixels(10, 13, [
        ".kkk...kkk.",
        "kwwwk.kwwwk",
        "kwkkk.kkkwk",
        "kwkhk.khkwk",
        ".kkk...kkk.",
    ], face)
    m.pixels(11, 8, [
        "m.......m",
        ".mmmmmmm.",
        "..mtttm..",
    ], face)
    # Arms: one hangs, the other swings his baseball bat.
    left_arm = m.limb("Arm", pivot=(8, 15.5, cz), phase=0)
    m.box(7, 9, cz - 1, 8, 15, cz, wood, part=left_arm)
    m.box(7, 8, cz - 1, 8, 9, cz, wood_dark, part=left_arm)
    right_arm = m.limb("Arm", pivot=(24, 15.5, cz), phase=1)
    m.box(23, 10, cz - 1, 24, 15, cz, wood, part=right_arm)
    m.box(23, 9, cz - 2, 24, 10, cz, wood_dark, part=right_arm)
    club, s = polyline(m, [(24, 9.5, cz - 1.5), (26.5, 16, cz - 3), (29, 25, cz - 5)], 0.8, 1.8)
    m.mask(club & (m.grid == 0), bat, part=right_arm)
    m.paint(club & (s < 3), bat_dark)
    m.paint(club & (np.abs(s - 12) < 0.6), bat_dark)

    # Tralalero Tralala standing on the log in his sneakers; his tail wags.
    tail = m.limb("Tail", pivot=(cx, 23, cz + 3))
    top = upright_shark(m, cx, 19, cz, 1.12, tail_part=tail, fin_back=5.6)

    # Bombardiro Crocodilo's head on top, in a pilot's cap and goggles, crowned.
    head = m.limb("Head", pivot=(cx, top - 1, cz - 1))
    base = top - 1
    m.mask(rounded_box_mask(m, 10, base, 9, 21, base + 6, 20), croc, part=head)          # skull
    m.mask(rounded_box_mask(m, 11, base + 3, 0, 20, base + 5, 9), croc, part=head)       # upper jaw
    m.mask(rounded_box_mask(m, 11, base, 1, 20, base + 1, 10, vertical_only=True), croc_light, part=head)
    m.box(12, base + 2, 2, 19, base + 2, 9, "#5a1010", part=head)                         # the mouth
    m.paint_face(m.box_mask(11, base + 5, 0, 20, base + 5, 9), croc_dark, face="top")
    m.paint_face(m.box_mask(11, base + 3, 0, 20, base + 3, 9), croc_dark, face="front")
    for x in range(12, 20):
        m.voxel(x, base + 2, 1 if x % 2 else 2, WHITE, part=head)
    for z in range(2, 10):
        m.voxel(11, base + 2, z, WHITE if z % 2 else croc_dark, part=head)
        m.voxel(20, base + 2, z, WHITE if z % 2 else croc_dark, part=head)
    m.box(12, base + 5, 0, 13, base + 5, 1, croc_dark, part=head)                        # nostrils
    m.box(18, base + 5, 0, 19, base + 5, 1, croc_dark, part=head)
    m.box(12, base + 6, 0, 12, base + 6, 0, croc_dark, part=head)
    m.box(19, base + 6, 0, 19, base + 6, 0, croc_dark, part=head)
    for x, z in ((13, 4), (17, 6), (15, 2), (14, 7)):
        m.paint(m.box_mask(x, base + 5, z, x + 1, base + 5, z) & m.surface("top", 1), croc_light)
    # Bulging eyes on top of the snout.
    for x0 in (11, 17):
        m.box(x0, base + 5, 7, x0 + 3, base + 8, 9, croc, part=head)
        m.pixels(x0, base + 6, ["wkhw", "wkkw"], {"w": "#f5e663", "k": BLACK, "h": WHITE}, z=6, part=head)
    # The leather aviator cap with ear flaps, and goggles pushed up on it.
    cap = m.ellipsoid_mask(15.5, base + 5.5, 15, 7.0, 4.6, 6.8) & (ys > base + 5)
    m.mask(cap, helmet, part=head)
    m.paint(cap & (np.abs(xs - 15.5) < 0.6), helmet_dark)
    m.paint(cap & (np.abs(zs - 15) < 0.6) & (ys < base + 9), helmet_dark)
    m.box(9, base + 1, 13, 9, base + 6, 17, helmet, part=head)
    m.box(22, base + 1, 13, 22, base + 6, 17, helmet, part=head)
    m.box(9, base + 1, 14, 9, base + 1, 16, helmet_dark, part=head)
    m.box(22, base + 1, 14, 22, base + 1, 16, helmet_dark, part=head)
    m.box(9, base + 8, 8, 22, base + 8, 8, rim, part=head)
    for x0 in (10, 17):
        m.box(x0, base + 7, 7, x0 + 4, base + 10, 8, rim, part=head)
        m.box(x0 + 1, base + 8, 7, x0 + 3, base + 9, 7, lens, part=head)
        m.voxel(x0 + 1, base + 9, 7, lens_light, part=head)
    # The golden crown with jewels.
    c0 = base + 9
    crown_ring = m.cylinder_mask(cx - 0.5, c0, 15, 5.2, 2) & ~m.cylinder_mask(cx - 0.5, c0, 15, 3.6, 2)
    m.mask(crown_ring, gold, part=head)
    m.paint(crown_ring & (ys < c0 + 1), gold_dark)
    for a in range(0, 360, 45):
        px = cx - 0.5 + 4.6 * math.cos(math.radians(a))
        pz = 15 + 4.6 * math.sin(math.radians(a))
        m.box(px - 0.5, c0 + 2, pz - 0.5, px + 0.4, c0 + 3 + (1 if a % 90 == 0 else 0), pz + 0.4, gold, part=head)
        m.voxel(px, c0 + 4 + (1 if a % 90 == 0 else 0), pz, gold_light, part=head) if a % 90 == 0 else None
    for gx, gz, gem in ((cx - 1, 10, "#e0213a"), (cx - 5, 14, "#2a6cf0"), (cx + 4, 14, "#2a6cf0"), (cx - 1, 19, "#20b050")):
        m.paint(m.box_mask(gx, c0, gz, gx + 1, c0 + 1, gz + 1) & crown_ring & (m.surface("front", 1) | m.surface("left", 1) | m.surface("right", 1) | m.surface("back", 1)), gem)
